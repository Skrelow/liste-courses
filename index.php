<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
$user = require_login();
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2f7d4f">
<title>Courses</title>
<link rel="manifest" href="manifest.json">
<link rel="icon" href="assets/icon.svg">
<link rel="apple-touch-icon" href="assets/icon.svg">
<link rel="stylesheet" href="assets/style.css?v=1">
</head><body>
<header><h1>🛒 Courses</h1><span><?= h($user) ?> · <a href="logout.php">Quitter</a></span></header>
<main>
  <form id="add" autocomplete="off">
    <input id="name" placeholder="Ajouter un article…" required>
    <input id="qty" placeholder="Qté" class="qty">
    <select id="aisle"><?php foreach (aisles() as $k => [$l, $e]): ?><option value="<?= h($k) ?>"><?= $e ?> <?= h($l) ?></option><?php endforeach; ?></select>
    <button>＋</button>
  </form>
  <div id="list"></div>
  <button id="clear" class="ghost" hidden>Supprimer les articles cochés</button>
</main>
<script>window.CSRF = <?= json_encode(csrf()) ?>; window.AISLES = <?= json_encode(aisles(), JSON_UNESCAPED_UNICODE) ?>;</script>
<script src="assets/app.js?v=1"></script>
</body></html>
