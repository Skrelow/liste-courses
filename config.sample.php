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
    // Mot de passe commun à vous deux (ce fichier n'est ni versionné ni accessible depuis le web).
    'password' => 'CHOISIS-UN-MOT-DE-PASSE',
    // Variante plus sûre : 'password_hash' => '...' (php -r "echo password_hash('mdp', PASSWORD_DEFAULT);")
    'timezone' => 'Europe/Paris',
];
