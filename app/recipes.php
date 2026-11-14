<?php
declare(strict_types=1);

/**
 * « 200 g de farine » → ['farine', '200 g'] ; « 3 œufs » → ['œufs', '3'] ; « 1 gousse d'ail » → ['ail', '1 gousse'].
 * Retourne [nom du produit, quantité].
 */
function parse_ingredient(string $line): array
{
    $s = trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($line), ENT_QUOTES, 'UTF-8')));
    $s = trim(preg_replace('/\([^)]*\)/u', '', $s));               // « (environ 2) »
    $s = preg_replace('/^[-–•*]\s*/u', '', $s);
    $num = '(?:\d+(?:[.,\/]\d+)?|[½¼¾⅓⅔]|un|une|deux|trois|quatre|cinq|six|quelques)';
    $unit = '(?:kg|g|mg|cl|ml|dl|l|litres?|c\.?\s?à\.?\s?[sc]\.?|cuill[eè]res?\s+à\s+(?:soupe|caf[ée])|cuill?\.?|pinc[ée]es?|sachets?|tranches?|gousses?|bo[iî]tes?|brins?|feuilles?|verres?|bottes?|morceaux?|filets?|pots?|briques?|paquets?|tasses?|bols?|noix|noisettes?|poign[ée]es?|branches?|t[eê]tes?|botte|zestes?|tiges?)';
    $qty = '';
    if (preg_match("/^($num(?:\s*(?:à|-)\s*$num)?)\s*($unit\b\.?)?\s*(?:de\s+|d['’]\s*)?(.+)$/iu", $s, $m)) {
        $qty = trim($m[1] . ' ' . ($m[2] ?? ''));
        $s = $m[3];
    } elseif (preg_match("/^($unit)\s+(?:de\s+|d['’]\s*)(.+)$/iu", $s, $m)) { // « pincée de sel »
        $qty = $m[1];
        $s = $m[2];
    }
    $s = trim(preg_replace('/\s*,.*$/u', '', $s));                  // « oignon, émincé » → « oignon »
    if (preg_match("/^((?:jaunes?|blancs?)\s+d['’]\s*)(.+)$/iu", $s, $m)) { // « jaunes d'œufs » → œufs (4 jaunes)
        $qty = trim($qty . ' ' . trim(preg_replace("/\s+d['’]\s*$/u", '', $m[1])));
        $s = $m[2];
    }
    $s = mb_strtoupper(mb_substr($s, 0, 1)) . mb_substr($s, 1);
    return [mb_substr($s, 0, 160), mb_substr($qty, 0, 40)];
}

/** Même produit malgré les accents, majuscules et pluriels (« Œufs » = « oeuf »). */
function loose_key(string $name): string
{
    return implode(' ', array_map(fn($w) => preg_replace('/(?<=..)[sx]$/', '', $w), explode(' ', fold($name))));
}

/** Id du produit correspondant à un ingrédient : réutilise un produit existant proche, sinon le crée. */
function recipe_product_id(string $name): int
{
    static $index = null;
    if ($index === null) {
        $index = [];
        foreach (q('SELECT id, name FROM products')->fetchAll() as $p) {
            $index[loose_key($p['name'])] ??= (int) $p['id'];
        }
    }
    $k = loose_key($name);
    return $index[$k] ??= product_id($name);
}

/** Enregistre les ingrédients d'un plat (remplace les anciens). */
function save_recipe_items(int $recipeId, array $lines): void
{
    q('DELETE FROM recipe_items WHERE recipe_id = ?', [$recipeId]);
    $seen = [];
    $split = [];
    foreach ($lines as $line) { // « Sel, poivre » / « sel et poivre » → deux ingrédients
        $line = (string) $line;
        $parts = preg_split('/\s*(?:,|\bet\b)\s*/u', $line);
        $short = count($parts) > 1 && !preg_match('/\d/', $line) && max(array_map(fn($p) => str_word_count($p), $parts)) <= 2;
        array_push($split, ...($short ? $parts : [$line]));
    }
    foreach (array_slice($split, 0, 80) as $line) {
        [$name, $qty] = parse_ingredient((string) $line);
        if (mb_strlen($name) < 2) {
            continue;
        }
        $pid = recipe_product_id($name);
        if (isset($seen[$pid])) {
            continue;
        }
        $seen[$pid] = true;
        q('INSERT INTO recipe_items (recipe_id, product_id, qty) VALUES (?,?,?)', [$recipeId, $pid, $qty]);
    }
}

/**
 * Lit une page de recette (Marmiton, 750g, CuisineAZ, Journal des Femmes…) via ses données schema.org.
 * Retourne ['name', 'ingredients' => [...], 'servings', 'url'] ou null.
 */
function fetch_recipe(string $url): ?array
{
    if (!preg_match('#^https?://[^\s/]+\.[a-z]{2,}(/\S*)?$#i', $url)) {
        return null;
    }
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    $ip = gethostbyname($host);
    if ($ip === $host || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        return null; // pas d'adresse interne
    }
    $ctx = stream_context_create(['http' => [
        'timeout' => 10,
        'follow_location' => 1,
        'max_redirects' => 3,
        'header' => "User-Agent: Mozilla/5.0 (compatible; ListeCourses/1.0)\r\nAccept-Language: fr-FR,fr;q=0.9\r\n",
    ]]);
    $html = @file_get_contents($url, false, $ctx, 0, 3_000_000);
    if (!$html) {
        return null;
    }
    preg_match_all('#<script[^>]+application/ld\+json[^>]*>(.*?)</script>#is', $html, $m);
    foreach ($m[1] as $json) {
        $recipe = find_recipe_node(json_decode(html_entity_decode(trim($json), ENT_QUOTES, 'UTF-8'), true) ?? json_decode(trim($json), true));
        if ($recipe && !empty($recipe['recipeIngredient'])) {
            $yield = $recipe['recipeYield'] ?? '';
            return [
                'name' => mb_substr(trim(html_entity_decode((string) ($recipe['name'] ?? 'Recette'), ENT_QUOTES, 'UTF-8')), 0, 160),
                'ingredients' => array_values(array_filter(array_map(fn($i) => trim(html_entity_decode((string) $i, ENT_QUOTES, 'UTF-8')), (array) $recipe['recipeIngredient']))),
                'servings' => mb_substr(trim(is_array($yield) ? (string) ($yield[0] ?? '') : (string) $yield), 0, 40),
                'url' => $url,
            ];
        }
    }
    return null;
}

function find_recipe_node($node): ?array
{
    if (!is_array($node)) {
        return null;
    }
    $type = $node['@type'] ?? null;
    if ($type === 'Recipe' || (is_array($type) && in_array('Recipe', $type, true))) {
        return $node;
    }
    foreach ($node as $child) {
        if (is_array($child) && ($found = find_recipe_node($child))) {
            return $found;
        }
    }
    return null;
}
