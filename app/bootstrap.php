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
    $pdo->exec("CREATE TABLE IF NOT EXISTS items (
        id $auto,
        name VARCHAR(160) NOT NULL,
        qty VARCHAR(40) NOT NULL DEFAULT '',
        aisle VARCHAR(40) NOT NULL DEFAULT 'autre',
        done TINYINT NOT NULL DEFAULT 0,
        added_by VARCHAR(40) NOT NULL DEFAULT '',
        created_at VARCHAR(19) NOT NULL,
        done_at VARCHAR(19) NULL
    )");
    return $pdo;
}

function q(string $sql, array $p = []): PDOStatement
{
    $st = db()->prepare($sql);
    $st->execute($p);
    return $st;
}

/** Rayons : clé => [libellé, emoji] (l'ordre = ordre d'affichage). */
function aisles(): array
{
    return [
        'fruits'   => ['Fruits & légumes', '🥦'],
        'boucherie' => ['Viande & poisson', '🥩'],
        'cremerie' => ['Crèmerie', '🧀'],
        'boulangerie' => ['Boulangerie', '🥖'],
        'epicerie' => ['Épicerie', '🥫'],
        'surgeles' => ['Surgelés', '🧊'],
        'boissons' => ['Boissons', '🥤'],
        'hygiene'  => ['Hygiène & maison', '🧴'],
        'autre'    => ['Autre', '📦'],
    ];
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
