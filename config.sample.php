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
    // Premiers comptes, créés au premier lancement (ensuite, les accès se gèrent dans l'appli : page « Accès »).
    // Le premier prénom (ou 'admin') gère l'appli et peut inviter des amis qui auront leur propre liste.
    'users' => ['Robin', 'Toi'],
    // Mot de passe de départ de ces comptes ; chacun peut ensuite le changer dans la page « Accès ».
    'password' => 'CHOISIS-UN-MOT-DE-PASSE',
    // Variante plus sûre : 'password_hash' => '...' (php -r "echo password_hash('mdp', PASSWORD_DEFAULT);")
    'timezone' => 'Europe/Paris',
];
