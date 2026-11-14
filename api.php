<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
require __DIR__ . '/app/recipes.php';
require __DIR__ . '/app/push.php';

$user = require_login(true);
header('Content-Type: application/json; charset=utf-8');

function out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** statut : stock = on en a, buy = à acheter, out = on n'en a plus / on ne sait pas. */
function snapshot(): array
{
    $products = q('SELECT id, name, status, category, qty, note, added_by, shop_url, image_url, format, usual_rank, price_cents, times_bought, last_bought FROM products ORDER BY name_key')->fetchAll();
    $recipes = q('SELECT id, name, source_url, servings, image_url FROM recipes ORDER BY name')->fetchAll();
    $links = q('SELECT recipe_id, product_id, qty FROM recipe_items')->fetchAll();
    foreach ($recipes as &$r) {
        $mine = array_values(array_filter($links, fn($l) => (int) $l['recipe_id'] === (int) $r['id']));
        $r['products'] = array_map(fn($l) => (int) $l['product_id'], $mine);
        $r['qty'] = array_map(fn($l) => (string) $l['qty'], $mine); // même ordre que products
    }
    $snap = ['products' => $products, 'recipes' => $recipes];
    $snap['v'] = md5(json_encode($snap)); // version : l'appli ne retélécharge que si ça a changé
    return $snap;
}

/**
 * Achats fréquents Carrefour : [{name, url, image, format, ean}, …] dans l'ordre (le plus acheté d'abord).
 * Retrouve chaque produit par code-barres puis par nom ; les nouveaux restent hors du placard tant qu'on ne les achète pas.
 */
function import_catalog(array $items): void
{
    $https = fn($u) => preg_match('#^https://[^\s"\'<>]{5,490}$#', (string) $u) ? (string) $u : null;
    db()->beginTransaction();
    q('UPDATE products SET usual_rank = NULL');
    foreach (array_slice($items, 0, 1500) as $rank => $it) {
        $name = mb_substr(trim(preg_replace('/\s+/', ' ', (string) ($it['name'] ?? ''))), 0, 160);
        if (mb_strlen($name) < 2) {
            continue;
        }
        $ean = preg_match('/^\d{6,14}$/', (string) ($it['ean'] ?? '')) ? (string) $it['ean'] : null;
        $id = $ean ? q('SELECT id FROM products WHERE ean = ?', [$ean])->fetchColumn() : false;
        $id = $id ?: product_id($name);
        q('UPDATE products SET ean = COALESCE(?, ean), shop_url = COALESCE(?, shop_url), image_url = COALESCE(?, image_url), format = ?, usual_rank = ?, price_cents = COALESCE(?, price_cents) WHERE id = ?', [
            $ean, $https($it['url'] ?? ''), $https($it['image'] ?? ''), mb_substr(trim((string) ($it['format'] ?? '')), 0, 40), $rank + 1, is_numeric($it['price'] ?? null) && $it['price'] > 0 ? (int) round($it['price'] * 100) : null, $id,
        ]);
    }
    // les mots-clés des rayons s'enrichissent : on reclasse les habituels et les produits restés en « Autre »
    foreach (q("SELECT id, name FROM products WHERE usual_rank IS NOT NULL OR category = 'autre' OR category IS NULL")->fetchAll() as $p) {
        q('UPDATE products SET category = ? WHERE id = ?', [guess_aisle($p['name']), $p['id']]);
    }
    db()->commit();
}

/** Met à acheter les ingrédients qu'on n'a pas, avec la quantité de la recette si aucune n'est notée. */
function recipe_to_buy(int $recipeId, string $user): void
{
    $items = q("SELECT p.id, p.qty, i.qty AS rqty FROM recipe_items i JOIN products p ON p.id = i.product_id WHERE i.recipe_id = ? AND p.status = 'out'", [$recipeId])->fetchAll();
    foreach ($items as $it) {
        q("UPDATE products SET status = 'buy', added_by = ?, qty = ? WHERE id = ?", [$user, $it['qty'] !== '' ? $it['qty'] : mb_substr((string) $it['rqty'], 0, 20), $it['id']]);
    }
    if ($items) {
        $rname = (string) q('SELECT name FROM recipes WHERE id = ?', [$recipeId])->fetchColumn();
        record_added($user, ['les ingrédients « ' . $rname . ' »']);
    }
}

/** Nom d'un produit qui entre dans la liste (pour la notification), seulement s'il n'y était pas déjà. */
function newly_listed(int $id): ?string
{
    $p = q('SELECT name, status FROM products WHERE id = ?', [$id])->fetch();
    return $p && !in_array($p['status'], ['buy', 'got'], true) ? $p['name'] : null;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['notif'])) { // lu par le service worker quand une notification arrive
        out(notification_for($user) ?? ['title' => '🛒 Courses', 'body' => 'La liste de courses a changé.']);
    }
    if (isset($_GET['vapid'])) { // clé publique pour s'abonner aux notifications
        out(['key' => vapid_keys()['public']]);
    }
    $snap = snapshot();
    if (($_GET['v'] ?? '') === $snap['v']) {
        http_response_code(204); // rien de neuf
        exit;
    }
    out($snap);
}
if (!hash_equals(csrf(), (string) ($_SERVER['HTTP_X_CSRF'] ?? ''))) {
    out(['error' => 'csrf'], 403);
}

$in = json_decode((string) file_get_contents('php://input'), true) ?: [];
$action = (string) ($in['action'] ?? '');
$id = (int) ($in['id'] ?? 0);
$status = in_array($in['status'] ?? '', ['stock', 'buy', 'got', 'out'], true) ? $in['status'] : null;
$name = trim((string) ($in['name'] ?? ''));
$qty = mb_substr(trim((string) ($in['qty'] ?? '')), 0, 20);
$note = mb_substr(trim((string) ($in['note'] ?? '')), 0, 160);
$category = array_key_exists((string) ($in['category'] ?? ''), aisles()) ? (string) $in['category'] : null;

// Un produit ajouté hors ligne n'a pas encore d'id : l'appli le désigne alors par son nom (« ref »).
$productActions = ['set_status', 'bought', 'update_product', 'restore', 'delete_product'];
if (!$id && in_array($action, $productActions, true) && trim((string) ($in['ref'] ?? '')) !== '') {
    $id = product_id((string) $in['ref']);
}

switch ($action) {
    case 'add_product': // depuis la liste de courses : on veut l'acheter
        if ($name === '') {
            out(['error' => 'name'], 422);
        }
        $isNew = !q('SELECT id FROM products WHERE name_key = ?', [mb_strtolower(trim(preg_replace('/\s+/', ' ', $name)))])->fetchColumn();
        $pid = product_id($name, 'buy');
        $added = $isNew ? $name : newly_listed($pid);
        q("UPDATE products SET status = 'buy', qty = ?, added_by = ? WHERE id = ?", [$qty, $user, $pid]);
        if ($added) {
            record_added($user, [$added . ($qty !== '' ? ' (' . $qty . ')' : '')]);
        }
        if ($note !== '') {
            q('UPDATE products SET note = ? WHERE id = ?', [$note, $pid]);
        }
        break;
    case 'set_status':
        if ($status === 'buy') {
            $added = newly_listed($id); // décocher un produit du caddie ne prévient personne
            q("UPDATE products SET status = 'buy', added_by = COALESCE(added_by, ?) WHERE id = ?", [$user, $id]);
            if ($added) {
                q('UPDATE products SET added_by = ? WHERE id = ?', [$user, $id]);
                record_added($user, [$added]);
            }
        } elseif ($status === 'got') {
            q("UPDATE products SET status = 'got' WHERE id = ?", [$id]);
        } elseif ($status) {
            q("UPDATE products SET status = ?, qty = '', added_by = NULL WHERE id = ?", [$status, $id]);
        }
        break;
    case 'bought': // coché dans la liste : dans le caddie (validé par « Courses faites »)
        q("UPDATE products SET status = 'got' WHERE id = ?", [$id]);
        break;
    case 'subscribe': // cet appareil veut recevoir les notifications
        save_subscription($user, (string) ($in['endpoint'] ?? '')) ? out(['ok' => true]) : out(['error' => 'endpoint'], 422);
        // no break : out() termine le script
    case 'unsubscribe':
        delete_subscription((string) ($in['endpoint'] ?? ''));
        out(['ok' => true]);
        // no break
    case 'update_product': // quantité, note, rayon et nom
        q('UPDATE products SET qty = ?, note = ? WHERE id = ?', [$qty, $note, $id]);
        if ($category) {
            q('UPDATE products SET category = ? WHERE id = ?', [$category, $id]);
        }
        if (array_key_exists('shop_url', $in)) { // lien direct vers le produit chez Carrefour (ou vide)
            $url = trim((string) $in['shop_url']);
            q('UPDATE products SET shop_url = ? WHERE id = ?', [preg_match('#^https://\S{5,490}$#', $url) ? $url : null, $id]);
        }
        if (array_key_exists('price', $in)) { // prix estimé en euros (« 2,49 ») ; vide = inconnu
            $p = (float) str_replace(',', '.', preg_replace('/[^\d,.]/', '', (string) $in['price']));
            q('UPDATE products SET price_cents = ? WHERE id = ?', [$p > 0 && $p < 1000 ? (int) round($p * 100) : null, $id]);
        }
        if ($name !== '') {
            $name = mb_substr(preg_replace('/\s+/', ' ', $name), 0, 160);
            $other = q('SELECT id FROM products WHERE name_key = ? AND id <> ?', [mb_strtolower($name), $id])->fetchColumn();
            if ($other) {
                out(['error' => 'exists'], 422);
            }
            q('UPDATE products SET name = ?, name_key = ? WHERE id = ?', [$name, mb_strtolower($name), $id]);
        }
        break;
    case 'restore': // « Annuler » : remet le produit dans l'état d'avant
        $f = (array) ($in['fields'] ?? []);
        $last = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($f['last_bought'] ?? '')) ? $f['last_bought'] : null;
        q('UPDATE products SET status = ?, qty = ?, added_by = ?, times_bought = ?, last_bought = ? WHERE id = ?', [
            in_array($f['status'] ?? '', ['stock', 'buy', 'got', 'out'], true) ? $f['status'] : 'out',
            mb_substr((string) ($f['qty'] ?? ''), 0, 20),
            ($f['added_by'] ?? null) !== null ? mb_substr((string) $f['added_by'], 0, 40) : null,
            max(0, (int) ($f['times_bought'] ?? 0)),
            $last,
            $id,
        ]);
        break;
    case 'all_bought': // « Courses faites » : ce qui est dans le caddie est acheté ; si rien n'est coché, toute la liste
        $from = q("SELECT COUNT(*) FROM products WHERE status = 'got'")->fetchColumn() ? "'got'" : "'buy', 'got'";
        q("UPDATE products SET status = 'stock', qty = '', added_by = NULL, times_bought = times_bought + 1, last_bought = ? WHERE status IN ($from)", [date('Y-m-d')]);
        break;
    case 'restore_many': // annule « Courses faites » : [{id, fields}, …]
        foreach (array_slice((array) ($in['items'] ?? []), 0, 500) as $it) {
            $f = (array) ($it['fields'] ?? []);
            $last = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($f['last_bought'] ?? '')) ? $f['last_bought'] : null;
            q('UPDATE products SET status = ?, qty = ?, added_by = ?, times_bought = ?, last_bought = ? WHERE id = ?', [
                in_array($f['status'] ?? '', ['stock', 'buy', 'got', 'out'], true) ? $f['status'] : 'out',
                mb_substr((string) ($f['qty'] ?? ''), 0, 20),
                ($f['added_by'] ?? null) !== null ? mb_substr((string) $f['added_by'], 0, 40) : null,
                max(0, (int) ($f['times_bought'] ?? 0)),
                $last,
                (int) ($it['id'] ?? 0),
            ]);
        }
        break;
    case 'delete_product':
        q('DELETE FROM recipe_items WHERE product_id = ?', [$id]);
        q('DELETE FROM products WHERE id = ?', [$id]);
        break;
    case 'import': // commande déjà faite : tout ce qui est listé est en stock
        foreach (array_slice((array) ($in['names'] ?? []), 0, 300) as $n) {
            if (trim((string) $n) === '') {
                continue;
            }
            q("UPDATE products SET status = 'stock', qty = '', added_by = NULL, times_bought = times_bought + 1, last_bought = ? WHERE id = ?", [date('Y-m-d'), product_id((string) $n)]);
        }
        break;
    case 'import_catalog': // achats fréquents Carrefour (fichier exporté depuis carrefour.fr)
        import_catalog((array) ($in['items'] ?? []));
        break;
    case 'import_url': // lit une recette sur un site (aperçu, rien n'est enregistré)
        $recipe = fetch_recipe(trim((string) ($in['url'] ?? '')));
        $recipe ? out(['recipe' => $recipe]) : out(['error' => 'recipe'], 422);
        // no break : out() termine le script
    case 'save_recipe': // ingrédients au format libre : « 200 g de farine », « 3 œufs »…
        if ($name === '') {
            out(['error' => 'name'], 422);
        }
        $src = trim((string) ($in['source_url'] ?? ''));
        $src = preg_match('#^https?://\S{5,490}$#', $src) ? $src : null;
        $servings = mb_substr(trim((string) ($in['servings'] ?? '')), 0, 40) ?: null;
        $rimg = trim((string) ($in['image_url'] ?? ''));
        $rimg = preg_match('#^https://\S{5,490}$#', $rimg) ? $rimg : null; // photo du plat
        if ($id) {
            q('UPDATE recipes SET name = ?, source_url = COALESCE(?, source_url), servings = COALESCE(?, servings), image_url = COALESCE(?, image_url) WHERE id = ?', [mb_substr($name, 0, 160), $src, $servings, $rimg, $id]);
        } else {
            q('INSERT INTO recipes (name, source_url, servings, image_url) VALUES (?,?,?,?)', [mb_substr($name, 0, 160), $src, $servings, $rimg]);
            $id = (int) db()->lastInsertId();
        }
        save_recipe_items($id, (array) ($in['ingredients'] ?? []));
        if (!empty($in['to_buy'])) {
            recipe_to_buy($id, $user);
        }
        break;
    case 'delete_recipe':
        q('DELETE FROM recipe_items WHERE recipe_id = ?', [$id]);
        q('DELETE FROM recipes WHERE id = ?', [$id]);
        break;
    case 'recipe_to_buy': // met à acheter tout ce qui manque pour ce plat
        recipe_to_buy($id, $user);
        break;
    default:
        out(['error' => 'action'], 400);
}
out(snapshot());
