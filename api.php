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
    $products = q('SELECT id, name, status, times_bought, last_bought FROM products ORDER BY name_key')->fetchAll();
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
$id = (int) ($in['id'] ?? 0);
$status = in_array($in['status'] ?? '', ['stock', 'buy', 'out'], true) ? $in['status'] : null;
$name = trim((string) ($in['name'] ?? ''));

switch ($in['action'] ?? '') {
    case 'add_product': // depuis la liste de courses : on veut l'acheter
        if ($name === '') {
            out(['error' => 'name'], 422);
        }
        q("UPDATE products SET status = 'buy' WHERE id = ?", [product_id($name, 'buy')]);
        break;
    case 'set_status':
        if ($status) {
            q('UPDATE products SET status = ? WHERE id = ?', [$status, $id]);
        }
        break;
    case 'bought': // coché dans la liste : acheté, donc en stock
        q("UPDATE products SET status = 'stock', times_bought = times_bought + 1, last_bought = ? WHERE id = ?", [date('Y-m-d'), $id]);
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
            q("UPDATE products SET status = 'stock', times_bought = times_bought + 1, last_bought = ? WHERE id = ?", [date('Y-m-d'), product_id((string) $n)]);
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
        q("UPDATE products SET status = 'buy' WHERE status = 'out' AND id IN (SELECT product_id FROM recipe_items WHERE recipe_id = ?)", [$id]);
        break;
    default:
        out(['error' => 'action'], 400);
}
out(snapshot());
