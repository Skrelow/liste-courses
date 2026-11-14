<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';

$users = (array) cfg('users', []);
$err = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = (string) ($_POST['user'] ?? '');
    $hash = (string) cfg('password_hash', '');
    $plain = (string) cfg('password', '');
    $given = (string) ($_POST['password'] ?? '');
    $ok = ($hash !== '' && password_verify($given, $hash)) || ($plain !== '' && hash_equals($plain, $given));
    if (in_array($name, $users, true) && $ok) {
        session_regenerate_id(true);
        $_SESSION['user'] = $name;
        header('Location: index.php');
        exit;
    }
    sleep(1);
    $err = 'Identifiants incorrects.';
}
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connexion · Courses</title><link rel="stylesheet" href="assets/style.css?v=15"><link rel="manifest" href="manifest.json"></head>
<body><main class="login">
<h1>🛒 Courses</h1>
<?php if ($err): ?><p class="err"><?= h($err) ?></p><?php endif; ?>
<form method="post">
  <select name="user"><?php foreach ($users as $u): ?><option><?= h($u) ?></option><?php endforeach; ?></select>
  <input type="password" name="password" placeholder="Mot de passe" required autofocus>
  <button>Entrer</button>
</form></main></body></html>
