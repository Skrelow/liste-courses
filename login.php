<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

$err = '';
$name = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim((string) ($_POST['user'] ?? ''));
    $u = q('SELECT id, name, pass_hash FROM users WHERE name_key = ?', [mb_strtolower($name)])->fetch();
    if ($u && password_verify((string) ($_POST['password'] ?? ''), $u['pass_hash'])) {
        login_as($u);
        header('Location: index.php');
        exit;
    }
    sleep(1);
    $err = 'Prénom ou mot de passe incorrect.';
}
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion · Courses</title><link rel="stylesheet" href="assets/style.css?v=17"><link rel="manifest" href="manifest.json"></head>
<body><main class="login">
<h1>🛒 Courses</h1>
<?php if ($err): ?><p class="err"><?= h($err) ?></p><?php endif; ?>
<form method="post">
  <input name="user" placeholder="Prénom" value="<?= h($name) ?>" autocomplete="username" autocapitalize="words" required <?= $name === '' ? 'autofocus' : '' ?>>
  <input type="password" name="password" placeholder="Mot de passe" autocomplete="current-password" required <?= $name !== '' ? 'autofocus' : '' ?>>
  <button>Entrer</button>
</form></main></body></html>
