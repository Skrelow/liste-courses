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
<link rel="stylesheet" href="assets/style.css?v=7">
</head><body>
<header><h1>🛒 Courses</h1><span><?= h($user) ?> · <a href="logout.php">Quitter</a></span></header>
<nav id="tabs">
  <button data-tab="buy" class="on">À acheter</button><button data-tab="stock">Placard</button><button data-tab="plats">Plats</button><button data-tab="import">Import</button>
</nav>
<main>
  <section id="buy">
    <form class="row" data-add><input list="known" placeholder="Ajouter un produit… (ex : lait x2)" autocomplete="off" required><button>＋</button></form>
    <datalist id="known"></datalist>
    <div id="drive-bar"></div>
    <div class="list"></div>
  </section>
  <section id="stock" hidden>
    <input class="search" placeholder="Rechercher un produit…" type="search">
    <div class="list"></div>
  </section>
  <section id="plats" hidden>
    <form class="stack" id="import-recipe">
      <div class="row"><input name="url" type="url" inputmode="url" placeholder="Lien d'une recette (Marmiton, 750g…)" required><button title="Importer">↓</button></div>
      <small class="hint">Trouve une recette sur <a href="https://www.marmiton.org/" target="_blank" rel="noopener">Marmiton</a> ou <a href="https://www.750g.com/" target="_blank" rel="noopener">750g</a>, copie son lien et colle-le ici.</small>
    </form>
    <form class="stack" id="recipe-form">
      <input name="name" placeholder="Nom du plat (ex : Lasagnes)" required>
      <textarea name="ingredients" rows="4" placeholder="Ingrédients, un par ligne (ex : 200 g de farine)"></textarea>
      <div class="row"><button name="save">Enregistrer le plat</button><button name="tobuy" class="plain">Enregistrer et ajouter aux courses</button></div>
    </form>
    <h2 class="aisle">Mes plats</h2>
    <div class="list"></div>
    <h2 class="aisle">Idées de plats</h2>
    <div id="ideas"></div>
  </section>
  <section id="import" hidden>
    <p class="hint">Colle ici le détail d'une commande (Carrefour Drive, ticket, mail…), un produit par ligne. Je retire les prix et quantités, tu vérifies, puis tout passe en « on en a ».</p>
    <textarea id="paste" rows="8" placeholder="Lait demi-écrémé 1L x2&#10;Pâtes spaghetti 500g&#10;…"></textarea>
    <button id="parse" class="plain">Analyser</button>
    <div class="list" id="preview"></div>
    <button id="confirm-import" hidden>Ajouter au placard</button>
  </section>
</main>
<div id="net" hidden></div>
<div id="toast" hidden><span></span><button type="button">Annuler</button></div>
<script>
window.CSRF = <?= json_encode(csrf()) ?>;
window.USER = <?= json_encode($user, JSON_UNESCAPED_UNICODE) ?>;
window.AISLES = <?= json_encode(array_map(fn($a) => $a[0], aisles()), JSON_UNESCAPED_UNICODE) ?>;
</script>
<script src="assets/app.js?v=7"></script>
</body></html>
