<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
$user = require_login();
$admin = is_admin($user); // Robin : placard et imports en plus
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2f7d4f">
<title>Courses</title>
<link rel="manifest" href="manifest.json">
<link rel="icon" href="assets/icon.svg">
<link rel="apple-touch-icon" href="assets/icon.svg">
<link rel="stylesheet" href="assets/style.css?v=15">
</head><body>
<header><h1>🛒 Courses</h1><span><?= h($user) ?> · <a href="logout.php">Quitter</a></span></header>
<nav id="tabs">
  <button data-tab="buy" class="on">🛒 Liste</button><button data-tab="usual">⭐ Habituels</button><button data-tab="plats">🍽️ Plats</button><?php if ($admin): ?><button data-tab="stock" class="icon" title="Placard" aria-label="Placard">📦</button><button data-tab="import" class="icon" title="Import" aria-label="Import">⬇️</button><?php endif; ?>
</nav>
<main>
  <section id="buy">
    <form class="row" data-add><input list="known" placeholder="Ajouter un produit… (ex : lait x2)" autocomplete="off" required><button aria-label="Ajouter">＋</button></form>
    <datalist id="known"></datalist>
    <div id="summary"></div>
    <div id="drive-bar"></div>
    <div class="list"></div>
  </section>
  <section id="usual" hidden>
    <input class="search" placeholder="Chercher un produit…" type="search">
    <div class="list"></div>
  </section>
  <section id="plats" hidden>
    <h2 class="aisle">Mes plats</h2>
    <div class="list"></div>
    <button class="plain wide" id="new-recipe-btn">＋ Ajouter un plat</button>
    <div id="new-recipe" hidden>
      <form class="stack" id="import-recipe">
        <div class="row"><input name="url" type="url" inputmode="url" placeholder="Colle le lien d'une recette (Marmiton…)" required><button title="Importer">↓</button></div>
        <small class="hint">Trouve une recette sur <a href="https://www.marmiton.org/" target="_blank" rel="noopener">Marmiton</a>, copie son lien et colle-le ici. Ou écris-la toi-même :</small>
      </form>
      <form class="stack" id="recipe-form">
        <input name="name" placeholder="Nom du plat (ex : Lasagnes)" required>
        <textarea name="ingredients" rows="4" placeholder="Ingrédients, un par ligne (ex : 200 g de farine)"></textarea>
        <div class="row"><button name="tobuy">Enregistrer et ajouter aux courses</button><button name="save" class="plain">Juste enregistrer</button></div>
      </form>
    </div>
    <h2 class="aisle">Idées de plats</h2>
    <div id="ideas"></div>
  </section>
<?php if ($admin): ?>
  <section id="stock" hidden>
    <input class="search" placeholder="Rechercher un produit…" type="search">
    <div class="list"></div>
  </section>
  <section id="import" hidden>
    <p class="hint">Colle ici le détail d'une commande (Carrefour Drive, ticket, mail…), un produit par ligne. Je retire les prix et quantités, tu vérifies, puis tout passe en « on en a ».</p>
    <textarea id="paste" rows="8" placeholder="Lait demi-écrémé 1L x2&#10;Pâtes spaghetti 500g&#10;…"></textarea>
    <button id="parse" class="plain">Analyser</button>
    <div class="list" id="preview"></div>
    <button id="confirm-import" hidden>Ajouter au placard</button>

    <h2 class="aisle">Achats fréquents Carrefour</h2>
    <p class="hint">Pour remplir l'onglet « Habituels » avec tes produits Carrefour (photos, liens et prix) :</p>
    <ol class="hint steps">
      <li>Sur ordinateur, fais glisser ce bouton dans ta barre de favoris : <a id="bookmarklet" class="plain-link">⬇ Exporter Carrefour</a></li>
      <li>Ouvre <a href="https://www.carrefour.fr/mon-compte/achats-frequents" target="_blank" rel="noopener">tes achats fréquents</a> sur carrefour.fr (connecté) et clique sur le favori : un fichier <code>carrefour-habituels.json</code> est téléchargé.</li>
      <li>Choisis ce fichier ici : <input type="file" id="catalog-file" accept=".json,application/json"></li>
    </ol>
  </section>
<?php endif; ?>
</main>
<div id="net" hidden></div>
<div id="toast" hidden><span></span><button type="button">Annuler</button></div>
<script>
window.CSRF = <?= json_encode(csrf()) ?>;
window.USER = <?= json_encode($user, JSON_UNESCAPED_UNICODE) ?>;
window.ADMIN = <?= $admin ? 'true' : 'false' ?>;
window.AISLES = <?= json_encode(array_map(fn($a) => $a[0], aisles()), JSON_UNESCAPED_UNICODE) ?>;
</script>
<script src="assets/app.js?v=15"></script>
</body></html>
