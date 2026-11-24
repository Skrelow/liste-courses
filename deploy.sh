#!/bin/sh
# Mise à jour automatique du site depuis GitHub (lancé toutes les 5 min par une tâche cron cPanel) :
#   /bin/sh /home/paro5944/repositories/liste-courses/deploy.sh
# Ne fait rien si GitHub n'a pas de nouveau commit. « deploy.sh --copy » copie seulement les fichiers
# (utilisé aussi par .cpanel.yml). config.php et data/ ne sont pas dans le dépôt : jamais écrasés.
REPO=/home/paro5944/repositories/liste-courses
DEPLOYPATH=/home/paro5944/courses.robinpastorel.com/
cd "$REPO" || exit 1

if [ "$1" != "--copy" ]; then
  git fetch -q origin main || exit 1
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
  git reset -q --hard origin/main || exit 1
  exec /bin/sh "$REPO/deploy.sh" --copy   # relance la version à jour du script
fi

/bin/cp -R app assets "$DEPLOYPATH"
/bin/cp .htaccess index.php api.php login.php logout.php acces.php invite.php manifest.json sw.js "$DEPLOYPATH"
echo "$(date '+%Y-%m-%d %H:%M') déployé $(git rev-parse --short HEAD)" >> "$REPO/../liste-courses-deploy.log"
