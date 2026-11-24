<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
require __DIR__ . '/app/push.php';
require __DIR__ . '/app/accounts.php';

require_login();
$me = me();
$super = is_superadmin();
$manager = is_admin();

/** Après une action : message (et lien d'invitation à transmettre) affichés une fois, puis retour sur la page. */
function done(string $msg, ?string $link = null): void
{
    $_SESSION['flash'] = ['msg' => $msg, 'link' => $link];
    header('Location: acces.php');
    exit;
}

$err = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals(csrf(), (string) ($_POST['csrf'] ?? ''))) {
        done('La page avait expiré, recommence.');
    }
    $do = (string) ($_POST['do'] ?? '');
    $target = (int) ($_POST['id'] ?? 0);
    switch ($do) {
        case 'password':
            $row = q('SELECT pass_hash FROM users WHERE id = ?', [$me['id']])->fetch();
            $new = (string) ($_POST['new'] ?? '');
            if (!password_verify((string) ($_POST['current'] ?? ''), $row['pass_hash'])) {
                sleep(1);
                $err = 'Mot de passe actuel incorrect.';
            } elseif ($problem = password_problem($new, (string) ($_POST['confirm'] ?? ''))) {
                $err = $problem;
            } else {
                q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
                done('Mot de passe changé.');
            }
            break;
        case 'invite_mine': // quelqu'un qui partagera ma liste
            if ($manager) {
                done('Lien créé : envoie-le à la personne qui partagera ta liste.', create_invite($me['household_id'], $me['name']));
            }
            break;
        case 'invite_new': // un ami qui aura sa propre liste
            if ($super) {
                done('Lien créé : envoie-le à ton ami, il aura sa propre liste.', create_invite(null, $me['name']));
            }
            break;
        case 'cancel_invite':
            $hash = (string) ($_POST['hash'] ?? '');
            $inv = q('SELECT household_id FROM invites WHERE token_hash = ?', [$hash])->fetch();
            if ($inv && ($super || ($manager && (int) $inv['household_id'] === $me['household_id']))) {
                q('DELETE FROM invites WHERE token_hash = ?', [$hash]);
                done('Invitation annulée.');
            }
            break;
        case 'delete_user':
            $u = q('SELECT id, name, household_id FROM users WHERE id = ?', [$target])->fetch();
            if ($u && (int) $u['id'] !== $me['id'] && ($super || ($manager && (int) $u['household_id'] === $me['household_id']))) {
                delete_user((int) $u['id']);
                done('Accès de ' . $u['name'] . ' supprimé.');
            }
            break;
        case 'delete_household':
            if ($super && $target !== $me['household_id']) {
                delete_household($target);
                done('Liste supprimée.');
            }
            break;
    }
    if ($err === '') {
        done('Action impossible.');
    }
}

$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);

$myMembers = q('SELECT id, name, role FROM users WHERE household_id = ? ORDER BY id', [$me['household_id']])->fetchAll();
$invSql = 'SELECT token_hash, household_id, created_by, expires FROM invites WHERE expires > ?';
$invites = $super
    ? q("$invSql ORDER BY created DESC", [time()])->fetchAll()
    : ($manager ? q("$invSql AND household_id = ? ORDER BY created DESC", [time(), $me['household_id']])->fetchAll() : []);
$households = [];
if ($super) {
    $households = q('SELECT h.id, h.name, (SELECT COUNT(*) FROM products p WHERE p.household_id = h.id) AS products FROM households h WHERE h.id <> ? ORDER BY h.id', [$me['household_id']])->fetchAll();
    foreach ($households as &$hh) {
        $hh['members'] = q('SELECT id, name FROM users WHERE household_id = ? ORDER BY id', [$hh['id']])->fetchAll();
    }
    unset($hh);
}
$roleLabel = fn($r) => ['admin' => 'gère l’appli', 'manager' => 'gère la liste', 'member' => ''][$r] ?? '';
$days = fn($t) => max(1, (int) ceil(($t - time()) / 86400));

function form(string $do, string $label, array $fields = [], string $class = 'plain', string $confirm = ''): string
{
    $html = '<form method="post" class="inline"' . ($confirm !== '' ? ' onsubmit="return confirm(' . h(json_encode($confirm, JSON_UNESCAPED_UNICODE)) . ')"' : '') . '>'
        . '<input type="hidden" name="csrf" value="' . h(csrf()) . '"><input type="hidden" name="do" value="' . h($do) . '">';
    foreach ($fields as $k => $v) {
        $html .= '<input type="hidden" name="' . h($k) . '" value="' . h((string) $v) . '">';
    }
    return $html . '<button class="' . h($class) . '">' . h($label) . '</button></form>';
}
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2f7d4f"><meta name="referrer" content="no-referrer">
<title>Accès · Courses</title>
<link rel="icon" href="assets/icon.svg">
<link rel="stylesheet" href="assets/style.css?v=17">
</head><body>
<header><h1><a href="index.php" class="back" aria-label="Retour à la liste">‹</a> Accès</h1><span><?= h($me['name']) ?> · <a href="logout.php">Quitter</a></span></header>
<main class="acces">

<?php if ($flash): ?>
  <div class="flash">
    <p><?= h($flash['msg']) ?></p>
    <?php if ($flash['link']): ?>
      <div class="row"><input id="invite-link" value="<?= h($flash['link']) ?>" readonly onclick="this.select()"><button type="button" class="plain" id="copy">Copier</button><button type="button" id="share" hidden>Envoyer</button></div>
      <p class="hint">Valable <?= INVITE_DAYS ?> jours, une seule fois. Ce lien ne sera plus affiché : copie-le maintenant.</p>
    <?php endif; ?>
  </div>
<?php endif; ?>

<h2 class="aisle">Ma liste</h2>
<?php foreach ($myMembers as $m): ?>
  <div class="item"><span class="n"><?= h($m['name']) ?><?= (int) $m['id'] === $me['id'] ? ' (toi)' : '' ?> <small class="hint"><?= h($roleLabel($m['role'])) ?></small></span>
  <?php if ($manager && (int) $m['id'] !== $me['id']): ?><?= form('delete_user', 'Retirer', ['id' => $m['id']], 'plain small', 'Retirer l’accès de ' . $m['name'] . ' ? La liste reste intacte.') ?><?php endif; ?></div>
<?php endforeach; ?>
<?php if ($manager): ?>
  <?= form('invite_mine', '＋ Inviter quelqu’un à partager ma liste', [], 'plain wide') ?>
<?php endif; ?>

<?php if ($super): ?>
  <h2 class="aisle">Amis (chacun sa liste)</h2>
  <p class="hint">Chaque ami a sa propre liste, son placard et ses plats. Il ne voit pas ta liste, et tu ne vois pas la sienne dans l’appli.</p>
  <?php foreach ($households as $hh): ?>
    <div class="item"><span class="n"><?= h(implode(', ', array_column($hh['members'], 'name')) ?: '(plus personne)') ?> <small class="hint"><?= (int) $hh['products'] ?> produit<?= (int) $hh['products'] > 1 ? 's' : '' ?></small></span>
    <?= form('delete_household', 'Supprimer', ['id' => $hh['id']], 'plain small', 'Supprimer cette liste, ses accès et toutes ses données ? C’est définitif.') ?></div>
  <?php endforeach; ?>
  <?php if (!$households): ?><p class="empty small">Aucun ami pour l’instant.</p><?php endif; ?>
  <?= form('invite_new', '＋ Inviter un ami (nouvelle liste)', [], 'wide') ?>
<?php endif; ?>

<?php if ($invites): ?>
  <h2 class="aisle">Invitations en attente</h2>
  <?php foreach ($invites as $inv): ?>
    <div class="item"><span class="n"><?= $inv['household_id'] === null ? 'Nouvelle liste' : ((int) $inv['household_id'] === $me['household_id'] ? 'Partager ma liste' : 'Rejoindre une autre liste') ?>
      <small class="hint">par <?= h($inv['created_by']) ?> · expire dans <?= $days((int) $inv['expires']) ?> j</small></span>
    <?= form('cancel_invite', 'Annuler', ['hash' => $inv['token_hash']], 'plain small') ?></div>
  <?php endforeach; ?>
<?php endif; ?>

<h2 class="aisle">Mon mot de passe</h2>
<?php if ($err): ?><p class="err"><?= h($err) ?></p><?php endif; ?>
<form method="post" class="stack">
  <input type="hidden" name="csrf" value="<?= h(csrf()) ?>"><input type="hidden" name="do" value="password">
  <input type="hidden" name="user" value="<?= h($me['name']) ?>" autocomplete="username">
  <input type="password" name="current" placeholder="Mot de passe actuel" autocomplete="current-password" required>
  <input type="password" name="new" placeholder="Nouveau mot de passe" minlength="<?= MIN_PASSWORD ?>" autocomplete="new-password" required>
  <input type="password" name="confirm" placeholder="Retape le nouveau" minlength="<?= MIN_PASSWORD ?>" autocomplete="new-password" required>
  <button>Changer</button>
</form>
</main>
<script>
const link = document.getElementById('invite-link');
if (link) {
  const copy = document.getElementById('copy');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(link.value); } catch { link.select(); document.execCommand('copy'); }
    copy.textContent = 'Copié ✓';
  };
  const share = document.getElementById('share');
  if (navigator.share) {
    share.hidden = false;
    share.onclick = () => navigator.share({ title: 'Liste de courses', text: 'Voici ton accès à l’appli de liste de courses :', url: link.value }).catch(() => {});
  }
}
</script>
</body></html>
