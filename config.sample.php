<?php
// Copie ce fichier en "config.php" et remplis les valeurs. config.php n'est jamais versionné.
return [
    'db' => [
        'driver'   => 'mysql',
        'host'     => 'localhost',
        'name'     => 'IDENTIFIANT_courses',
        'user'     => 'IDENTIFIANT_courses',
        'password' => 'MOT_DE_PASSE_BDD',
        // 'path'  => __DIR__ . '/data/courses.sqlite', // si driver = 'sqlite' (tests)
    ],
    // Prénoms proposés à la connexion
    'users' => ['Robin', 'Toi'],
    // Mot de passe commun. Génère le hash avec : php -r "echo password_hash('TON_MOT_DE_PASSE', PASSWORD_DEFAULT);"
    'password_hash' => 'COLLE-ICI-LE-HASH',
    'timezone' => 'Europe/Paris',
];
