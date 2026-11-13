<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

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
    $products = q('SELECT id, name, status, category, qty, note, added_by, times_bought, last_bought FROM products ORDER BY name_key')->fetchAll();
    $recipes = q('SELECT id, name FROM recipes ORDER BY name')->fetchAll();
    $links = q('SELECT recipe_id, product_id FROM recipe_items')->fetchAll();
    foreach ($recipes as &$r) {
        $r['products'] = array_values(array_map(fn($l) => (int) $l['product_id'], array_filter($links, fn($l) => (int) $l['recipe_id'] === (int) $r['id'])));
    }
    return ['products' => $products, 'recipes' => $recipes];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    out(snapshot());
}
if (!hash_equals(csrf(), (string) ($_SERVER['HTTP_X_CSRF'] ?? ''))) {
    out(['error' => 'csrf'], 403);
}

$in = json_decode((string) file_get_contents('php://input'), true) ?: [];
$action = (string) ($in['action'] ?? '');
$id = (int) ($in['id'] ?? 0);
$status = in_array($in['status'] ?? '', ['stock', 'buy', 'out'], true) ? $in['status'] : null;
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
        $pid = product_id($name, 'buy');
        q("UPDATE products SET status = 'buy', qty = ?, added_by = ? WHERE id = ?", [$qty, $user, $pid]);
        if ($note !== '') {
            q('UPDATE products SET note = ? WHERE id = ?', [$note, $pid]);
        }
        break;
    case 'set_status':
        if ($status === 'buy') {
            q("UPDATE products SET status = 'buy', added_by = ? WHERE id = ?", [$user, $id]);
        } elseif ($status) {
            q("UPDATE products SET status = ?, qty = '', added_by = NULL WHERE id = ?", [$status, $id]);
        }
        break;
    case 'bought': // coché dans la liste : acheté, donc en stock
        q("UPDATE products SET status = 'stock', qty = '', added_by = NULL, times_bought = times_bought + 1, last_bought = ? WHERE id = ?", [date('Y-m-d'), $id]);
        break;
    case 'update_product': // quantité, note, rayon et nom
        q('UPDATE products SET qty = ?, note = ? WHERE id = ?', [$qty, $note, $id]);
        if ($category) {
            q('UPDATE products SET category = ? WHERE id = ?', [$category, $id]);
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
            in_array($f['status'] ?? '', ['stock', 'buy', 'out'], true) ? $f['status'] : 'out',
            mb_substr((string) ($f['qty'] ?? ''), 0, 20),
            ($f['added_by'] ?? null) !== null ? mb_substr((string) $f['added_by'], 0, 40) : null,
            max(0, (int) ($f['times_bought'] ?? 0)),
            $last,
            $id,
        ]);
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
    case 'save_recipe':
        if ($name === '') {
            out(['error' => 'name'], 422);
        }
        if ($id) {
            q('UPDATE recipes SET name = ? WHERE id = ?', [mb_substr($name, 0, 160), $id]);
            q('DELETE FROM recipe_items WHERE recipe_id = ?', [$id]);
        } else {
            q('INSERT INTO recipes (name) VALUES (?)', [mb_substr($name, 0, 160)]);
            $id = (int) db()->lastInsertId();
        }
        foreach (array_slice((array) ($in['ingredients'] ?? []), 0, 60) as $n) {
            if (trim((string) $n) !== '') {
                q('INSERT INTO recipe_items (recipe_id, product_id) VALUES (?,?) ' . (db()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'ON CONFLICT DO NOTHING' : 'ON DUPLICATE KEY UPDATE recipe_id = recipe_id'), [$id, product_id((string) $n)]);
            }
        }
        break;
    case 'delete_recipe':
        q('DELETE FROM recipe_items WHERE recipe_id = ?', [$id]);
        q('DELETE FROM recipes WHERE id = ?', [$id]);
        break;
    case 'recipe_to_buy': // met à acheter tout ce qui manque pour ce plat
        q("UPDATE products SET status = 'buy', added_by = ? WHERE status = 'out' AND id IN (SELECT product_id FROM recipe_items WHERE recipe_id = ?)", [$user, $id]);
        break;
    default:
        out(['error' => 'action'], 400);
}
out(snapshot());
