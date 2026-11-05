<?php
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));

function cfg(string $key, $default = null)
{
    static $c = null;
    if ($c === null) {
        $f = APP_ROOT . '/config.php';
        $c = is_file($f) ? (require $f) : [];
    }
    return $c[$key] ?? $default;
}

date_default_timezone_set((string) cfg('timezone', 'Europe/Paris'));
mb_internal_encoding('UTF-8');

session_name('courses');
session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 90, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']), 'httponly' => true, 'samesite' => 'Lax']);
ini_set('session.gc_maxlifetime', (string) (60 * 60 * 24 * 90));
session_start();

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $c = cfg('db', []);
    $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
    if (($c['driver'] ?? 'mysql') === 'sqlite') {
        $pdo = new PDO('sqlite:' . $c['path'], null, null, $opts);
        $auto = 'INTEGER PRIMARY KEY AUTOINCREMENT';
    } else {
        $pdo = new PDO(sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $c['host'] ?? 'localhost', $c['name'] ?? ''), $c['user'] ?? '', $c['password'] ?? '', $opts);
        $auto = 'INT AUTO_INCREMENT PRIMARY KEY';
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS products (
        id $auto,
        name VARCHAR(160) NOT NULL,
        name_key VARCHAR(160) NOT NULL UNIQUE,
        status VARCHAR(8) NOT NULL DEFAULT 'out',
        times_bought INT NOT NULL DEFAULT 0,
        last_bought VARCHAR(10) NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS recipes (
        id $auto,
        name VARCHAR(160) NOT NULL
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS recipe_items (
        recipe_id INT NOT NULL,
        product_id INT NOT NULL,
        PRIMARY KEY (recipe_id, product_id)
    )");
    return $pdo;
}

function q(string $sql, array $p = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($p);
    return $st;
}

/** Retourne l'id du produit portant ce nom (le crée au besoin avec le statut donné). */
function product_id(string $name, string $status = 'out'): int
{
    $name = mb_substr(trim(preg_replace('/\s+/', ' ', $name)), 0, 160);
    $key = mb_strtolower($name);
    $id = q('SELECT id FROM products WHERE name_key = ?', [$key])->fetchColumn();
    if ($id) {
        return (int) $id;
    }
    q('INSERT INTO products (name, name_key, status) VALUES (?,?,?)', [$name, $key, $status]);
    return (int) db()->lastInsertId();
}

function csrf(): string
{
    return $_SESSION['csrf'] ??= bin2hex(random_bytes(16));
}

function current_user(): ?string
{
    return $_SESSION['user'] ?? null;
}

function require_login(bool $json = false): string
{
    $u = current_user();
    if ($u) {
        return $u;
    }
    if ($json) {
        http_response_code(401);
        header('Content-Type: application/json');
        exit('{"error":"auth"}');
    }
    header('Location: login.php');
    exit;
}
