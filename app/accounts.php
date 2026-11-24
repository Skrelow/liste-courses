<?php
declare(strict_types=1);

/*
 * Accès à l'appli : invitations (lien à usage unique, valable 7 jours) et suppression de comptes ou de foyers.
 * Seule l'empreinte du lien est gardée en base : un lien perdu ne peut pas être réaffiché, on en crée un autre.
 */

const INVITE_DAYS = 7;
const MIN_PASSWORD = 6;

/** Crée un lien d'invitation : vers $household (rejoindre ce foyer) ou null (nouveau foyer). Retourne l'URL. */
function create_invite(?int $household, string $by): string
{
    $token = rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
    q('DELETE FROM invites WHERE expires < ?', [time()]);
    q('INSERT INTO invites (token_hash, household_id, created_by, created, expires) VALUES (?,?,?,?,?)', [
        hash('sha256', $token), $household, $by, time(), time() + INVITE_DAYS * 86400,
    ]);
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/invite.php?t=' . $token;
}

/** L'invitation valable correspondant à ce lien, ou null. */
function find_invite(string $token): ?array
{
    if (!preg_match('/^[A-Za-z0-9_-]{20,40}$/', $token)) {
        return null;
    }
    return q('SELECT token_hash, household_id, created_by, expires FROM invites WHERE token_hash = ? AND expires > ?', [hash('sha256', $token), time()])->fetch() ?: null;
}

function name_taken(string $name): bool
{
    return (bool) q('SELECT 1 FROM users WHERE name_key = ?', [mb_strtolower($name)])->fetchColumn();
}

/** Supprime un compte (ses notifications avec). Les produits qu'il a ajoutés restent dans la liste du foyer. */
function delete_user(int $id): void
{
    $u = q('SELECT name FROM users WHERE id = ?', [$id])->fetch();
    if (!$u) {
        return;
    }
    push_tables();
    q('DELETE FROM push_subs WHERE user = ?', [$u['name']]);
    q('DELETE FROM settings WHERE k = ?', ['seen_' . mb_substr($u['name'], 0, 40)]);
    q('DELETE FROM users WHERE id = ?', [$id]);
}

/** Supprime un foyer, ses comptes et toutes ses données (liste, placard, plats). */
function delete_household(int $id): void
{
    foreach (q('SELECT id FROM users WHERE household_id = ?', [$id])->fetchAll() as $u) {
        delete_user((int) $u['id']);
    }
    db()->beginTransaction();
    q('DELETE FROM recipe_items WHERE recipe_id IN (SELECT id FROM recipes WHERE household_id = ?)', [$id]);
    q('DELETE FROM recipe_items WHERE product_id IN (SELECT id FROM products WHERE household_id = ?)', [$id]);
    q('DELETE FROM recipes WHERE household_id = ?', [$id]);
    q('DELETE FROM products WHERE household_id = ?', [$id]);
    q('DELETE FROM events WHERE household_id = ?', [$id]);
    q('DELETE FROM invites WHERE household_id = ?', [$id]);
    q('DELETE FROM households WHERE id = ?', [$id]);
    db()->commit();
}

/** Message d'erreur si le mot de passe ne convient pas, sinon null. */
function password_problem(string $pass, string $confirm): ?string
{
    if (mb_strlen($pass) < MIN_PASSWORD) {
        return 'Le mot de passe doit faire au moins ' . MIN_PASSWORD . ' caractères.';
    }
    return $pass === $confirm ? null : 'Les deux mots de passe ne sont pas identiques.';
}
