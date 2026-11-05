<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

$user = require_login(true);
header('Content-Type: application/json; charset=utf-8');

function out($data): void
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function all_items(): array
{
    return db()->query('SELECT id, name, qty, aisle, done, added_by FROM items ORDER BY done, id')->fetchAll();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    out(['items' => all_items()]);
}

if (!hash_equals(csrf(), (string) ($_SERVER['HTTP_X_CSRF'] ?? ''))) {
    http_response_code(403);
    out(['error' => 'csrf']);
}

$in = json_decode((string) file_get_contents('php://input'), true) ?: [];
$id = (int) ($in['id'] ?? 0);
$now = date('Y-m-d H:i:s');

switch ($in['action'] ?? '') {
    case 'add':
        $name = trim(preg_replace('/\s+/', ' ', (string) ($in['name'] ?? '')));
        if ($name === '') {
            http_response_code(422);
            out(['error' => 'name']);
        }
        $aisle = array_key_exists($in['aisle'] ?? '', aisles()) ? $in['aisle'] : 'autre';
        q('INSERT INTO items (name, qty, aisle, added_by, created_at) VALUES (?,?,?,?,?)',
            [mb_substr($name, 0, 160), mb_substr(trim((string) ($in['qty'] ?? '')), 0, 40), $aisle, $user, $now]);
        break;
    case 'toggle':
        q('UPDATE items SET done = 1 - done, done_at = ? WHERE id = ?', [$now, $id]);
        break;
    case 'delete':
        q('DELETE FROM items WHERE id = ?', [$id]);
        break;
    case 'clear_done':
        q('DELETE FROM items WHERE done = 1');
        break;
    default:
        http_response_code(400);
        out(['error' => 'action']);
}
out(['items' => all_items()]);
