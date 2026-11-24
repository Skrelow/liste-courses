# Liste de courses

App PHP/MySQL partagée à deux : liste « à acheter », placard (ce qu'on a / ce qui manque), plats avec vérification des
ingrédients, import du détail d'une commande. Plusieurs listes possibles : depuis la page « Accès »,
on invite un ami (il a sa propre liste) ou quelqu'un qui partagera sa liste, avec un lien à usage unique. Installation : crée une base MySQL dans cPanel, copie `config.sample.php`
en `config.php`, puis déploie via `.cpanel.yml`. Les tables se créent toutes seules.
