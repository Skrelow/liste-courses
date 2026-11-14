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
    migrate($pdo);
    return $pdo;
}

/** Ajoute les colonnes apparues après la première version (rayon, quantité, note, lien Carrefour, recettes…). */
function migrate(PDO $pdo): void
{
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $columns = fn(string $t) => array_column($pdo->query($sqlite ? "PRAGMA table_info($t)" : "SHOW COLUMNS FROM $t")->fetchAll(), $sqlite ? 'name' : 'Field');
    $wanted = [
        'products' => [
            'category' => 'VARCHAR(20) NULL',
            'qty' => "VARCHAR(20) NOT NULL DEFAULT ''",
            'note' => "VARCHAR(160) NOT NULL DEFAULT ''",
            'added_by' => 'VARCHAR(40) NULL',
            'shop_url' => 'VARCHAR(500) NULL',
            'image_url' => 'VARCHAR(500) NULL',
            'ean' => 'VARCHAR(20) NULL',
            'format' => "VARCHAR(40) NOT NULL DEFAULT ''",
            'usual_rank' => 'INT NULL', // rang dans les achats fréquents Carrefour (NULL = pas un habituel)
            'price_cents' => 'INT NULL', // prix estimé d'un article, en centimes
        ],
        'recipes' => [
            'source_url' => 'VARCHAR(500) NULL',
            'servings' => 'VARCHAR(40) NULL',
            'image_url' => 'VARCHAR(500) NULL',
        ],
        'recipe_items' => [
            'qty' => "VARCHAR(40) NOT NULL DEFAULT ''",
        ],
    ];
    $cols = $columns('products');
    foreach ($wanted as $table => $defs) {
        $have = $table === 'products' ? $cols : $columns($table);
        foreach ($defs as $col => $def) {
            if (!in_array($col, $have, true)) {
                $pdo->exec("ALTER TABLE $table ADD COLUMN $col $def");
            }
        }
    }
    if (!in_array('category', $cols, true)) {
        $up = $pdo->prepare('UPDATE products SET category = ? WHERE id = ?');
        foreach ($pdo->query('SELECT id, name FROM products')->fetchAll() as $p) {
            $up->execute([guess_aisle($p['name']), $p['id']]);
        }
    }
}

/** Rayons dans l'ordre d'un parcours de magasin, avec des mots-clés pour deviner le rayon d'un produit. */
function aisles(): array
{
    return [
        'fruits' => ['Fruits & légumes', 'pomme, poire, banane, orange, citron, clémentine, mandarine, pamplemousse, kiwi, fraise, framboise, myrtille, raisin, melon, pastèque, pêche, nectarine, abricot, prune, cerise, ananas, mangue, avocat, tomate, salade, laitue, mâche, roquette, carotte, oignon, ail, échalote, pomme de terre, pommes de terre, patate, courgette, aubergine, poivron, concombre, champignon, brocoli, chou, chou-fleur, épinard, haricots verts, poireau, navet, radis, betterave, céleri, fenouil, persil, coriandre, basilic, menthe, ciboulette, gingembre, courge, potiron, butternut, asperge, poêlée de légumes'],
        'pain' => ['Pain & viennoiseries', 'pain, baguette, brioche, croissant, pain au chocolat, viennoiserie, biscotte, wrap, tortilla, pita, burger, pain burger, muffin'],
        'frais' => ['Crèmerie & frais', 'lait, yaourt, yogourt, skyr, fromage, fromage blanc, beurre, crème, crème fraîche, oeuf, emmental, gruyère, comté, mozzarella, parmesan, feta, chèvre, camembert, raclette, ricotta, mascarpone, jambon, lardon, bacon, chorizo, saucisson, rillettes, pâté, surimi, houmous, gnocchi, ravioli, tortellini, flan, pâte feuilletée, pâte brisée, pâte à pizza, charcuterie, burrata, margarine, poitrine fumée, raviole, tarama, sushi, parmigiano, dessert fruitier, taboulé, salade taboulé, crème dessert, liégeois, mousse au chocolat'],
        'viande' => ['Viande & poisson', 'viande, poulet, dinde, boeuf, veau, porc, agneau, canard, steak, steak haché, viande hachée, escalope, côte, côtelette, rôti, saucisse, merguez, chipolata, filet, cuisse, poisson, saumon, cabillaud, colin, truite, crevette, moule, gambas'],
        'epicerie' => ['Épicerie salée', 'pâte, spaghetti, tagliatelle, penne, coquillette, riz, semoule, couscous, quinoa, boulgour, lentille, pois chiche, haricot, farine, maïzena, huile, vinaigre, sel, poivre, épice, curry, paprika, cumin, moutarde, ketchup, mayonnaise, sauce, sauce tomate, pesto, bouillon, soupe, conserve, thon, sardine, maquereau, maïs, olive, cornichon, chips, cacahuète, apéritif, crackers, purée, tomates concassées, concentré de tomate, amande, pistache, noix de cajou, chapelure, cannelle, piment, graine, nouille, fajitas, kit fajitas, wasabi, sauce soja'],
        'sucre' => ['Sucré & petit-déj', "sucre, chocolat, café, thé, tisane, infusion, cacao, céréale, muesli, flocons d'avoine, confiture, miel, biscuit, gâteau, madeleine, nutella, pâte à tartiner, compote, bonbon, levure, crêpe, cassonade, spéculoos, noix de coco râpée, chewing-gum, chewing gum, tablette de chocolat, framboises enrobées, barre, barre céréales"],
        'boissons' => ['Boissons', "eau, eau gazeuse, jus, jus d'orange, soda, coca, limonade, sirop, bière, vin, rosé, champagne, ice tea, perrier, boisson, boisson végétale, kombucha, boisson énergisante"],
        'surgeles' => ['Surgelés', 'surgelé, glace, sorbet, frites, pizza, poisson pané, nuggets, poêlée'],
        'hygiene' => ['Hygiène & beauté', 'shampoing, shampooing, après-shampoing, gel douche, savon, dentifrice, brosse à dents, déodorant, déo, coton, coton-tige, rasoir, mouchoir, papier toilette, serviette hygiénique, tampon, crème solaire, crème hydratante, démaquillant, brossette, mousse coiffante, coton-tige'],
        'entretien' => ['Maison & entretien', 'lessive, adoucissant, liquide vaisselle, pastille lave-vaisselle, tablette lave-vaisselle, éponge, sac poubelle, essuie-tout, sopalin, javel, nettoyant, vinaigre blanc, papier alu, papier aluminium, film alimentaire, papier cuisson, allumette, ampoule, pile, bicarbonate, désodorisant, gel wc, lingette, liquide de rinçage, parfum de linge, tablettes activateur, activateur linge, détartrant'],
        'animaux' => ['Animaux', 'chat, chien, pour chat, pour chien, litière, croquette, pâtée, herbe à chat'],
        'autre' => ['Autre', ''],
    ];
}

function fold(string $s): string
{
    $s = strtr(mb_strtolower($s), ['é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'à' => 'a', 'â' => 'a', 'î' => 'i', 'ï' => 'i', 'ô' => 'o', 'ù' => 'u', 'û' => 'u', 'ç' => 'c', 'œ' => 'oe']);
    return trim(preg_replace('/[^a-z0-9]+/', ' ', $s));
}

/**
 * Rayon le plus probable. Le premier mot d'un nom dit ce qu'est le produit (« Chips… pommes de terre », « Soda au citron ») :
 * un mot-clé en tête de nom l'emporte ; sinon le mot-clé le plus long (« crème solaire » bat « crème »). Pluriels acceptés.
 */
function guess_aisle(string $name): string
{
    $name = ' ' . fold($name) . ' ';
    $best = 'autre';
    $bestScore = 0;
    foreach (aisles() as $key => [, $kw]) {
        foreach (explode(',', $kw) as $w) {
            $w = fold($w);
            if ($w === '') {
                continue;
            }
            $re = implode(' ', array_map(fn($x) => preg_quote($x, '/') . '[sx]?', explode(' ', $w)));
            if (!preg_match('/ ' . $re . ' /', $name, $m, PREG_OFFSET_CAPTURE)) {
                continue;
            }
            $score = strlen($w) + ($m[0][1] === 0 ? 100 : 0);
            if ($score > $bestScore) {
                $best = $key;
                $bestScore = $score;
            }
        }
    }
    return $best;
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
    q('INSERT INTO products (name, name_key, status, category) VALUES (?,?,?,?)', [$name, $key, $status, guess_aisle($name)]);
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

/** Celui qui gère l'appli (placard, imports) : 'admin' dans config.php, sinon le premier prénom. */
function is_admin(?string $user): bool
{
    return $user !== null && $user === (string) cfg('admin', ((array) cfg('users', []))[0] ?? '');
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
