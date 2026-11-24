<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
require __DIR__ . '/app/push.php';
require __DIR__ . '/app/accounts.php';

$token = (string) ($_GET['t'] ?? '');
$inv = find_invite($token);
$members = $inv && $inv['household_id'] !== null
    ? array_column(q('SELECT name FROM users WHERE household_id = ? ORDER BY id', [(int) $inv['household_id']])->fetchAll(), 'name')
    : [];
$err = '';
$name = '';

if ($inv && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim((string) ($_POST['user'] ?? ''));
    $pass = (string) ($_POST['password'] ?? '');
    $clean = clean_name($name);
    if (!hash_equals(csrf(), (string) ($_POST['csrf'] ?? ''))) {
        $err = 'La page a expiré, recommence.';
    } elseif ($clean === null) {
        $err = 'Choisis un prénom (lettres et chiffres, 40 caractères au plus).';
    } elseif (name_taken($clean)) {
        $err = 'Ce prénom est déjà pris : ajoute une initiale (ex : ' . $clean . ' B.).';
    } elseif ($problem = password_problem($pass, (string) ($_POST['confirm'] ?? ''))) {
        $err = $problem;
    } else {
        db()->beginTransaction();
        $household = $inv['household_id'] !== null ? (int) $inv['household_id'] : null;
        if ($household === null) { // nouvelle liste : la personne la gère (placard, imports, invitations)
            q('INSERT INTO households (name, created) VALUES (?, ?)', [$clean, time()]);
            $household = (int) db()->lastInsertId();
        }
        q('INSERT INTO users (name, name_key, household_id, pass_hash, role, created) VALUES (?,?,?,?,?,?)', [
            $clean, mb_strtolower($clean), $household, password_hash($pass, PASSWORD_DEFAULT), $inv['household_id'] === null ? 'manager' : 'member', time(),
        ]);
        $uid = (int) db()->lastInsertId();
        q('DELETE FROM invites WHERE token_hash = ?', [$inv['token_hash']]); // lien à usage unique
        db()->commit();
        login_as(['id' => $uid, 'name' => $clean]);
        header('Location: index.php');
        exit;
    }
}
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>Invitation · Courses</title><link rel="stylesheet" href="assets/style.css?v=17"><link rel="manifest" href="manifest.json"></head>
<body><main class="login">
<h1>🛒 Courses</h1>
<?php if (!$inv): ?>
  <p>Ce lien d'invitation n'est plus valable (déjà utilisé ou expiré).</p>
  <p class="hint">Demande un nouveau lien à la personne qui t'a invité, ou <a href="login.php">connecte-toi</a> si tu as déjà un compte.</p>
<?php else: ?>
  <?php if ($members): ?>
    <p><b><?= h($inv['created_by']) ?></b> t'invite à partager sa liste de courses avec <?= h(implode(', ', $members)) ?>.</p>
  <?php else: ?>
    <p><b><?= h($inv['created_by']) ?></b> t'invite à utiliser l'appli : tu auras ta propre liste de courses, rien que pour toi.</p>
  <?php endif; ?>
  <?php if ($err): ?><p class="err"><?= h($err) ?></p><?php endif; ?>
  <form method="post">
    <input type="hidden" name="csrf" value="<?= h(csrf()) ?>">
    <input name="user" placeholder="Ton prénom" value="<?= h($name) ?>" maxlength="40" autocomplete="username" autocapitalize="words" required autofocus>
    <input type="password" name="password" placeholder="Choisis un mot de passe" minlength="<?= MIN_PASSWORD ?>" autocomplete="new-password" required>
    <input type="password" name="confirm" placeholder="Retape le mot de passe" minlength="<?= MIN_PASSWORD ?>" autocomplete="new-password" required>
    <button>Créer mon accès</button>
  </form>
  <p class="hint">Ce lien ne marche qu'une fois. Ensuite, tu te connectes avec ton prénom et ton mot de passe.</p>
<?php endif; ?>
</main></body></html>
