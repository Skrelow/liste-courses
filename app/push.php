<?php
declare(strict_types=1);

/*
 * Notifications « Robin a ajouté : lait, pain… » envoyées à l'autre personne, même appli fermée (Web Push).
 * Le message push est vide (pas de chiffrement à faire) : le service worker vient ensuite lire le texte
 * sur api.php?notif=1. Seule la signature VAPID (ES256) est nécessaire, faite avec OpenSSL.
 */

function push_tables(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $auto = db()->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    db()->exec('CREATE TABLE IF NOT EXISTS settings (k VARCHAR(50) PRIMARY KEY, v TEXT NOT NULL)');
    db()->exec("CREATE TABLE IF NOT EXISTS push_subs (id $auto, user VARCHAR(40) NOT NULL, endpoint TEXT NOT NULL, hash CHAR(32) NOT NULL UNIQUE, created INT NOT NULL)");
    db()->exec("CREATE TABLE IF NOT EXISTS events (id $auto, author VARCHAR(40) NOT NULL, item VARCHAR(200) NOT NULL, created INT NOT NULL)");
}

function b64url(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

/** Clés VAPID du site (créées une fois, gardées en base) : ['private' => PEM, 'public' => base64url] */
function vapid_keys(): array
{
    push_tables();
    $pem = q("SELECT v FROM settings WHERE k = 'vapid_private'")->fetchColumn();
    if (!$pem) {
        $opts = ['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC];
        $cnf = dirname(PHP_BINARY) . '/extras/ssl/openssl.cnf'; // PHP sous Windows (tests en local)
        if (is_file($cnf)) {
            $opts['config'] = $cnf;
        }
        $key = openssl_pkey_new($opts);
        if (!$key || !openssl_pkey_export($key, $pem, null, $opts) || !$pem) {
            throw new RuntimeException('Impossible de créer les clés de notification.');
        }
        q("DELETE FROM settings WHERE k = 'vapid_private'");
        q("INSERT INTO settings (k, v) VALUES ('vapid_private', ?)", [$pem]);
    }
    $d = openssl_pkey_get_details(openssl_pkey_get_private($pem));
    $pad = fn($b) => str_pad($b, 32, "\0", STR_PAD_LEFT);
    return ['private' => $pem, 'public' => b64url("\x04" . $pad($d['ec']['x']) . $pad($d['ec']['y']))];
}

/** Signature ECDSA DER → format brut r||s (64 octets) attendu par JWT ES256. */
function der_to_raw(string $der): string
{
    $pos = 2;
    $parts = [];
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$pos + 1]);
        $int = substr($der, $pos + 2, $len);
        $parts[] = str_pad(ltrim($int, "\0"), 32, "\0", STR_PAD_LEFT);
        $pos += 2 + $len;
    }
    return $parts[0] . $parts[1];
}

function vapid_header(string $endpoint, array $keys): string
{
    $p = parse_url($endpoint);
    $aud = $p['scheme'] . '://' . $p['host'];
    $sub = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $data = b64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . b64url(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => $sub]));
    openssl_sign($data, $sig, $keys['private'], OPENSSL_ALGO_SHA256);
    return 'vapid t=' . $data . '.' . b64url(der_to_raw($sig)) . ', k=' . $keys['public'];
}

function save_subscription(string $user, string $endpoint): bool
{
    if (!preg_match('#^https://[^\s"\'<>]{10,1000}$#', $endpoint)) {
        return false;
    }
    push_tables();
    $hash = md5($endpoint);
    q('DELETE FROM push_subs WHERE hash = ?', [$hash]);
    q('INSERT INTO push_subs (user, endpoint, hash, created) VALUES (?,?,?,?)', [$user, $endpoint, $hash, time()]);
    return true;
}

function delete_subscription(string $endpoint): void
{
    push_tables();
    q('DELETE FROM push_subs WHERE hash = ?', [md5($endpoint)]);
}

/** Note qu'un produit a été ajouté à la liste ; les autres seront prévenus à la fin de la requête. */
function record_added(string $author, array $items): void
{
    $items = array_values(array_filter(array_map(fn($s) => mb_substr(trim((string) $s), 0, 200), $items)));
    if (!$items) {
        return;
    }
    push_tables();
    foreach ($items as $it) {
        q('INSERT INTO events (author, item, created) VALUES (?,?,?)', [$author, $it, time()]);
    }
    q('DELETE FROM events WHERE created < ?', [time() - 3 * 86400]);
    static $scheduled = false;
    if (!$scheduled) {
        $scheduled = true;
        register_shutdown_function(fn() => notify_others($author));
    }
}

/** Envoie un push (vide) à tous les appareils des autres personnes. Appelé après l'envoi de la réponse. */
function notify_others(string $author): void
{
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request(); // l'appli de l'auteur n'attend pas l'envoi
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request(); // serveur LiteSpeed (o2switch)
    }
    $subs = q('SELECT endpoint FROM push_subs WHERE user <> ?', [$author])->fetchAll();
    if (!$subs) {
        return;
    }
    $keys = vapid_keys();
    foreach ($subs as $s) {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST',
            'timeout' => 8,
            'ignore_errors' => true,
            'header' => "Authorization: " . vapid_header($s['endpoint'], $keys) . "\r\nTTL: 86400\r\nUrgency: normal\r\nTopic: courses\r\nContent-Length: 0\r\n",
            'content' => '',
        ]]);
        @file_get_contents($s['endpoint'], false, $ctx);
        $code = (int) (preg_match('#^HTTP/\S+ (\d{3})#', $http_response_header[0] ?? '', $m) ? $m[1] : 0);
        if ($code === 404 || $code === 410) {
            delete_subscription($s['endpoint']); // appareil désabonné ou appli désinstallée
        }
    }
}

/** Texte de la notification pour $user : ce que les autres ont ajouté depuis sa dernière notification. */
function notification_for(string $user): ?array
{
    push_tables();
    $key = 'seen_' . mb_substr($user, 0, 40);
    $seen = (int) q('SELECT v FROM settings WHERE k = ?', [$key])->fetchColumn();
    $sql = 'SELECT id, author, item FROM events WHERE author <> ? AND id > ? AND created > ? ORDER BY id DESC LIMIT 50';
    $rows = q($sql, [$user, $seen, time() - 6 * 3600])->fetchAll();
    if (!$rows) { // rien de neuf (notification en double) : on reprend les derniers ajouts plutôt qu'un texte vague
        $rows = q($sql, [$user, 0, time() - 6 * 3600])->fetchAll();
        if (!$rows) {
            return null;
        }
    }
    q('DELETE FROM settings WHERE k = ?', [$key]);
    q('INSERT INTO settings (k, v) VALUES (?, ?)', [$key, (string) $rows[0]['id']]);
    $author = $rows[0]['author'];
    $items = [];
    foreach ($rows as $r) {
        if ($r['author'] === $author && !in_array($r['item'], $items, true)) {
            $items[] = $r['item'];
        }
    }
    $shown = array_slice($items, 0, 4);
    $more = count($items) - count($shown);
    return [
        'title' => "🛒 $author a ajouté à la liste",
        'body' => implode(', ', $shown) . ($more > 0 ? " et $more autre" . ($more > 1 ? 's' : '') : ''),
    ];
}
