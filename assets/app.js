const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Données affichées = dernier état reçu du serveur + modifications pas encore envoyées (file d'attente).
let data = store.get('courses-data', { products: [], recipes: [] });
let queue = store.get('courses-queue', []);
let offline = false;
let openRecipe = null;
let ideas = []; // idées de plats (assets/recettes.json)
let openIdea = null;
let editing = null; // id du produit dont le détail est ouvert

const AISLE_KEYS = Object.keys(window.AISLES);
const byId = (id) => data.products.find((p) => String(p.id) === String(id));
const byName = (n) => data.products.find((p) => p.name.toLowerCase() === String(n).trim().toLowerCase());
const isTmp = (p) => String(p.id).startsWith('t');
const target = (p) => (isTmp(p) ? { id: 0, ref: p.name } : { id: +p.id }); // un produit créé hors ligne n'a pas encore d'id
const ago = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'jamais');
const today = () => new Date().toISOString().slice(0, 10);
const initial = (u) => (u ? u.trim().charAt(0).toUpperCase() : '');
/** Lien Carrefour : le produit retenu s'il y en a un, sinon la recherche par nom. */
const shopUrl = (p) => p.shop_url || 'https://www.carrefour.fr/s?q=' + encodeURIComponent(p.name);
const shopLink = (p, label = '🛒', cls = 'shop') =>
  `<a class="${cls}" href="${esc(shopUrl(p))}" target="_blank" rel="noopener" title="${p.shop_url ? 'Voir le produit chez Carrefour' : 'Chercher chez Carrefour'}">${label}</a>`;

// Mode « Commande drive » : on parcourt la liste en remplissant le panier Carrefour (état gardé sur l'appareil).
let drive = store.get('courses-drive', null); // { done: [noms en minuscules], finishing: bool }
const saveDrive = () => store.set('courses-drive', drive);
const inCart = (p) => !!drive?.done.includes(p.name.toLowerCase());

/* ---------- synchronisation ---------- */

function save() {
  store.set('courses-queue', queue);
  store.set('courses-data', data);
}

/** Applique une modification localement, sans attendre le serveur. */
function applyLocal(b) {
  const p = b.id ? byId(b.id) : b.ref ? byName(b.ref) : null;
  switch (b.action) {
    case 'add_product': {
      let x = byName(b.name);
      if (!x) {
        x = { id: 't' + Date.now() + Math.random().toString(36).slice(2, 6), name: b.name.trim(), category: 'autre', note: '', times_bought: 0, last_bought: null };
        data.products.push(x);
      }
      Object.assign(x, { status: 'buy', qty: b.qty || '', added_by: window.USER });
      if (b.note) x.note = b.note;
      break;
    }
    case 'set_status':
      if (p) Object.assign(p, b.status === 'buy' ? { status: 'buy', added_by: window.USER } : { status: b.status, qty: '', added_by: null });
      break;
    case 'bought':
      if (p) Object.assign(p, { status: 'stock', qty: '', added_by: null, times_bought: +p.times_bought + 1, last_bought: today() });
      break;
    case 'update_product':
      if (p) Object.assign(p, { qty: b.qty, note: b.note }, b.category ? { category: b.category } : {}, b.name ? { name: b.name } : {}, 'shop_url' in b ? { shop_url: /^https:\/\/\S+$/.test(b.shop_url) ? b.shop_url : null } : {});
      break;
    case 'restore':
      if (p) Object.assign(p, b.fields);
      break;
    case 'recipe_to_buy': {
      const r = data.recipes.find((x) => +x.id === +b.id);
      r?.products.map(byId).forEach((x) => x && x.status === 'out' && Object.assign(x, { status: 'buy', added_by: window.USER }));
      break;
    }
  }
}

/** Envoie une modification : affichée tout de suite, envoyée dès que possible (même plus tard si hors ligne). */
function call(body) {
  applyLocal(body);
  queue.push(body);
  save();
  render();
  flush();
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  let snap = null;
  while (queue.length) {
    let r;
    try {
      r = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': window.CSRF }, body: JSON.stringify(queue[0]) });
    } catch {
      offline = true;
      break;
    }
    if (r.status === 401) return (location.href = 'login.php');
    if (r.status === 403 && !sessionStorage.getItem('csrf-reload')) {
      // page servie depuis le cache avec un jeton périmé : on recharge, la file d'attente est conservée
      sessionStorage.setItem('csrf-reload', '1');
      return location.reload();
    }
    sessionStorage.removeItem('csrf-reload');
    offline = false;
    if (r.ok) snap = await r.json();
    else toast('Une modification n’a pas pu être enregistrée.');
    queue.shift();
    store.set('courses-queue', queue);
  }
  flushing = false;
  if (snap) adopt(snap);
  else renderNet();
}

/** Prend l'état du serveur et y rejoue ce qui n'est pas encore parti. */
function adopt(snap) {
  data = snap;
  queue.forEach(applyLocal);
  save();
  render();
}

async function refresh() {
  if (queue.length) return flush();
  try {
    const r = await fetch('api.php', { cache: 'no-store' });
    if (r.status === 401) return (location.href = 'login.php');
    if (!r.ok) throw new Error();
    offline = false;
    adopt(await r.json());
  } catch {
    offline = true;
    renderNet();
  }
}

/* ---------- affichage ---------- */

function renderNet() {
  const n = queue.length;
  $('#net').hidden = !offline && !n;
  $('#net').textContent = offline ? `Hors ligne${n ? ` · ${n} modif${n > 1 ? 's' : ''} en attente` : ''}` : 'Synchronisation…';
}

function grouped(list) {
  const groups = {};
  list.forEach((p) => (groups[AISLE_KEYS.includes(p.category) ? p.category : 'autre'] ||= []).push(p));
  return AISLE_KEYS.filter((k) => groups[k]).map((k) => [k, groups[k].sort((a, b) => a.name.localeCompare(b.name, 'fr'))]);
}

function editForm(p) {
  return `<form class="detail edit" data-edit="${esc(p.id)}">
    <label>Nom <input name="name" value="${esc(p.name)}" required></label>
    <div class="row"><label>Quantité <input name="qty" value="${esc(p.qty)}" placeholder="ex : 2, 500 g"></label>
    <label>Rayon <select name="category">${AISLE_KEYS.map((k) => `<option value="${k}"${k === p.category ? ' selected' : ''}>${esc(window.AISLES[k])}</option>`).join('')}</select></label></div>
    <label>Note <input name="note" value="${esc(p.note)}" placeholder="ex : marque Lactel, bio…"></label>
    <label>Lien Carrefour <input name="shop_url" type="url" inputmode="url" value="${esc(p.shop_url)}" placeholder="colle ici le lien du produit (sinon : recherche par nom)"></label>
    <div class="row"><button>Enregistrer</button><button type="button" class="plain" data-act="edit">Fermer</button></div>
  </form>`;
}

const qtyLabel = (p) => (p.qty ? ` <b class="qty">${esc(/^\d+$/.test(p.qty) ? '×' + p.qty : p.qty)}</b>` : '');

/** Liste du mode drive : ce qui reste à mettre au panier d'abord (par rayon), puis ce qui y est déjà. */
function renderDrive(buy) {
  if (drive.finishing) {
    const n = buy.filter(inCart).length;
    return `<div class="detail drive-end"><p>Commande passée ? ${n ? `Tu peux noter les <b>${n}</b> article${n > 1 ? 's' : ''} mis au panier comme achetés (ils passent dans le placard).` : 'Aucun article coché comme mis au panier.'}</p>
      <div class="row">${n ? `<button data-drive="bought">Marquer ${n} comme acheté${n > 1 ? 's' : ''}</button>` : ''}
      <button class="plain" data-drive="quit">Quitter sans rien changer</button><button class="plain" data-drive="back">Revenir à la liste</button></div></div>`;
  }
  if (!buy.length) return '<p class="empty">Rien à acheter 🎉</p>';
  const todo = buy.filter((p) => !inCart(p)), done = buy.filter(inCart);
  const row = (p) => `<div class="item drive${inCart(p) ? ' done' : ''}" data-id="${esc(p.id)}">
      <span class="n" data-act="edit">${esc(p.name)}${qtyLabel(p)}${p.note ? `<small class="note">${esc(p.note)}</small>` : ''}${p.shop_url ? '' : '<small class="note">recherche par nom</small>'}</span>
      ${shopLink(p, 'Ouvrir', 'shop-btn')}
      <button class="tick" data-act="cart" title="${inCart(p) ? 'Retirer du panier' : 'Mis au panier'}">${inCart(p) ? '↺' : '✓'}</button></div>
      ${String(editing) === String(p.id) ? editForm(p) : ''}`;
  return grouped(todo).map(([k, items]) => `<h2 class="aisle">${esc(window.AISLES[k])}</h2>` + items.map(row).join('')).join('')
    + (done.length ? `<h2 class="aisle">Dans le panier</h2>` + done.map(row).join('') : '');
}

function render() {
  $('#known').innerHTML = data.products.map((p) => `<option value="${esc(p.name)}">`).join('');

  const buy = data.products.filter((p) => p.status === 'buy');
  $('#drive-bar').innerHTML = drive
    ? `<div class="drive-head"><b>Commande drive</b><span>${buy.filter(inCart).length} / ${buy.length} dans le panier</span><button class="plain" data-drive="finish">Terminer</button></div>`
    : buy.length ? `<button class="plain drive-start" data-drive="start">🛒 Remplir le panier Carrefour</button>` : '';
  $('#buy .list').innerHTML = drive ? renderDrive(buy) : buy.length
    ? grouped(buy).map(([k, items]) => `<h2 class="aisle">${esc(window.AISLES[k])}</h2>` + items.map((p) => `
        <div class="item" data-id="${esc(p.id)}"><input type="checkbox" data-act="bought" aria-label="Acheté">
          <span class="n" data-act="edit">${esc(p.name)}${p.qty ? ` <b class="qty">${esc(/^\d+$/.test(p.qty) ? '×' + p.qty : p.qty)}</b>` : ''}${p.note ? `<small class="note">${esc(p.note)}</small>` : ''}</span>
          ${p.added_by ? `<span class="who" title="Ajouté par ${esc(p.added_by)}">${esc(initial(p.added_by))}</span>` : ''}
          ${shopLink(p)}<button class="x" data-act="out" title="Retirer de la liste">✕</button></div>
        ${String(editing) === String(p.id) ? editForm(p) : ''}`).join('')).join('')
    : '<p class="empty">Rien à acheter 🎉</p>';

  const q = $('#stock .search').value.trim().toLowerCase();
  const rows = data.products.filter((p) => p.status !== 'buy' && p.name.toLowerCase().includes(q));
  $('#stock .list').innerHTML = rows.length
    ? grouped(rows).map(([k, items]) => `<h2 class="aisle">${esc(window.AISLES[k])}</h2>` + items.map((p) => `
        <div class="item" data-id="${esc(p.id)}"><span class="n" data-act="edit">${esc(p.name)} <small>${+p.times_bought ? `acheté ${p.times_bought}× · ${ago(p.last_bought)}` : 'jamais acheté'}</small></span>
        ${p.status === 'stock' ? '<button class="pill ok" data-act="buy">On en a</button>' : '<button class="pill ko" data-act="buy">Manque</button>'}</div>
        ${String(editing) === String(p.id) ? editForm(p) : ''}`).join('')).join('')
    : '<p class="empty">Aucun produit.</p>';

  $('#plats .list').innerHTML = data.recipes.length
    ? data.recipes.map((r) => {
        const ings = r.products.map((id, i) => ({ p: byId(id), qty: r.qty?.[i] || '' })).filter((x) => x.p);
        const missing = ings.filter(({ p }) => p.status !== 'stock');
        const out = missing.filter(({ p }) => p.status === 'out').length, inList = missing.length - out;
        const status = !missing.length ? '✅ tout est là' : [out && `❌ ${out} à avoir`, inList && `🛒 ${inList} dans les courses`].filter(Boolean).join(' · ');
        const head = `<div class="item recipe-head" data-rid="${r.id}"><span class="n">${esc(r.name)} <small>${status}</small></span></div>`;
        if (openRecipe !== +r.id) return head;
        return head + `<div class="detail">
          ${r.servings || r.source_url ? `<small class="hint">${esc(r.servings || '')}${r.servings && r.source_url ? ' · ' : ''}${r.source_url ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">voir la recette</a>` : ''}</small>` : ''}
          ${ings.map(({ p, qty }) => `<div class="ing" data-pid="${esc(p.id)}" title="${p.status === 'buy' ? 'Déjà dans les courses' : 'Toucher pour changer'}">${p.status === 'stock' ? '✅' : p.status === 'buy' ? '🛒' : '❌'} ${esc(p.name)}${qty ? ` <small>${esc(qty)}</small>` : ''}</div>`).join('') || '<em>Aucun ingrédient</em>'}
          <small class="hint">Touche un ingrédient pour dire si tu en as (✅) ou pas (❌).</small>
          <div class="row">${missing.some(({ p }) => p.status === 'out') ? `<button data-ract="tobuy" data-rid="${r.id}">Ajouter les ❌ aux courses</button>` : ''}
          <button class="plain" data-ract="edit" data-rid="${r.id}">Modifier</button><button class="plain" data-ract="del" data-rid="${r.id}">Supprimer</button></div></div>`;
      }).join('')
    : '<p class="empty">Aucun plat enregistré.</p>';

  const mine = new Set(data.recipes.map((r) => r.name.toLowerCase()));
  const shown = ideas.map((r, i) => ({ r, i })).filter(({ r }) => !mine.has(r.name.toLowerCase()));
  $('#ideas').innerHTML = shown.map(({ r, i }) => `<div class="item idea-head" data-idea="${i}"><span class="n">${esc(r.name)} <small>${esc(r.servings)}</small></span></div>`
    + (openIdea === i ? `<div class="detail">${r.ingredients.map((x) => `<div>• ${esc(x)}</div>`).join('')}
        <div class="row"><button data-iact="tobuy" data-idea="${i}">Ajouter aux courses</button><button class="plain" data-iact="save" data-idea="${i}">Juste l'ajouter à mes plats</button></div></div>` : '')).join('')
    || '<p class="empty">Toutes les idées sont déjà dans tes plats.</p>';

  renderNet();
}

/* ---------- « Annuler » ---------- */

let toastTimer;
let undoBody = null;
function toast(msg, undo = null) {
  undoBody = undo;
  $('#toast span').textContent = msg;
  $('#toast button').hidden = !undo;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 5000);
}
$('#toast button').addEventListener('click', () => {
  if (undoBody) call(undoBody);
  undoBody = null;
  $('#toast').hidden = true;
});

/** Fait une action sur un produit et propose de l'annuler. */
function act(p, body, msg) {
  const before = { status: p.status, qty: p.qty, added_by: p.added_by, times_bought: +p.times_bought, last_bought: p.last_bought };
  call({ ...body, ...target(p) });
  toast(msg, { action: 'restore', ...target(p), fields: before });
}

/* ---------- événements ---------- */

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]')?.dataset.act;
  const row = e.target.closest('.item[data-id], form[data-edit]');
  if (a && row) {
    const p = byId(row.dataset.id ?? row.dataset.edit);
    if (!p) return;
    if (a === 'bought') act(p, { action: 'bought' }, `« ${p.name} » acheté`);
    if (a === 'out') act(p, { action: 'set_status', status: 'out' }, `« ${p.name} » retiré de la liste`);
    if (a === 'buy') {
      const toBuy = p.status === 'stock'; // « On en a » → à acheter ; « Manque » → en stock
      act(p, { action: 'set_status', status: toBuy ? 'buy' : 'stock' }, toBuy ? `« ${p.name} » ajouté aux courses` : `« ${p.name} » noté en stock`);
    }
    if (a === 'cart' && drive) {
      const k = p.name.toLowerCase();
      drive.done = drive.done.includes(k) ? drive.done.filter((x) => x !== k) : [...drive.done, k];
      saveDrive();
      render();
    }
    if (a === 'edit') { editing = String(editing) === String(p.id) ? null : p.id; render(); $(`form[data-edit="${CSS.escape(String(editing))}"] input[name=qty]`)?.focus(); }
  }
  const d = e.target.closest('[data-drive]')?.dataset.drive;
  if (d === 'start') drive = { done: [], finishing: false };
  if (d === 'finish' && drive) drive.finishing = true;
  if (d === 'back' && drive) drive.finishing = false;
  if (d === 'quit') drive = null;
  if (d === 'bought' && drive) {
    const items = data.products.filter((p) => p.status === 'buy' && inCart(p));
    items.forEach((p) => call({ action: 'bought', ...target(p) }));
    toast(`${items.length} article${items.length > 1 ? 's' : ''} passé${items.length > 1 ? 's' : ''} dans le placard`);
    drive = null;
  }
  if (d) { editing = null; saveDrive(); render(); window.scrollTo(0, 0); }

  const head = e.target.closest('.recipe-head');
  if (head) { const id = +head.dataset.rid; openRecipe = openRecipe === id ? null : id; render(); }
  const ihead = e.target.closest('.idea-head');
  if (ihead) { const i = +ihead.dataset.idea; openIdea = openIdea === i ? null : i; render(); }
  const iact = e.target.dataset.iact;
  if (iact) {
    const r = ideas[+e.target.dataset.idea];
    call({ action: 'save_recipe', id: 0, name: r.name, servings: r.servings, ingredients: r.ingredients, to_buy: iact === 'tobuy' });
    toast(iact === 'tobuy' ? `Ingrédients de « ${r.name} » ajoutés aux courses (sauf ceux que tu as déjà)` : `« ${r.name} » ajouté à tes plats`);
    openIdea = null;
  }
  const ing = e.target.closest('.ing[data-pid]');
  if (ing) {
    const p = byId(ing.dataset.pid);
    if (p && p.status !== 'buy') act(p, { action: 'set_status', status: p.status === 'stock' ? 'out' : 'stock' }, p.status === 'stock' ? `« ${p.name} » : on n'en a plus` : `« ${p.name} » : on en a`);
  }
  const ract = e.target.dataset.ract, rid = +e.target.dataset.rid;
  if (ract === 'tobuy') {
    const n = (data.recipes.find((x) => +x.id === rid)?.products || []).map(byId).filter((p) => p?.status === 'out').length;
    call({ action: 'recipe_to_buy', id: rid });
    toast(`${n} ingrédient${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} aux courses`);
  }
  if (ract === 'del' && confirm('Supprimer ce plat ?')) call({ action: 'delete_recipe', id: rid });
  if (ract === 'edit') {
    const r = data.recipes.find((x) => +x.id === rid), f = $('#recipe-form');
    f.name.value = r.name;
    f.ingredients.value = r.products.map((id, i) => { const n = byId(id)?.name; return n && (r.qty?.[i] ? `${r.qty[i]} ${n}` : n); }).filter(Boolean).join('\n');
    f.dataset.id = rid;
    f.scrollIntoView({ behavior: 'smooth' });
    f.name.focus();
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-edit]');
  if (!f) return;
  e.preventDefault();
  const p = byId(f.dataset.edit);
  const name = f.name.value.trim();
  if (p && name.toLowerCase() !== p.name.toLowerCase() && byName(name)) return toast(`« ${name} » existe déjà.`);
  const url = f.shop_url.value.trim();
  if (url && !/^https:\/\/\S+$/.test(url)) return toast('Le lien doit commencer par https://');
  if (p) call({ action: 'update_product', ...target(p), name: name !== p.name ? name : '', qty: f.qty.value.trim(), note: f.note.value.trim(), category: f.category.value, shop_url: url });
  editing = null;
  render();
});

// onglets
$$('#tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('main > section').forEach((s) => (s.hidden = s.id !== b.dataset.tab));
  editing = null;
  render();
}));

/** « lait x2 », « lait ×2 » ou « 2 lait » → nom + quantité */
function parseAdd(s) {
  s = s.trim();
  let m = s.match(/^(.+?)\s+[x×]\s?(\d+)$/i);
  if (m) return { name: m[1], qty: m[2] };
  m = s.match(/^(\d+)\s*[x×]?\s+(\D.*)$/i);
  if (m) return { name: m[2], qty: m[1] };
  return { name: s, qty: '' };
}
$('#buy [data-add]').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $('input', e.target);
  const { name, qty } = parseAdd(i.value);
  if (!name) return;
  call({ action: 'add_product', name, qty });
  i.value = '';
  i.focus();
});
$('#stock .search').addEventListener('input', render);

$('#recipe-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const raw = f.ingredients.value.trim();
  // un par ligne ; si tout est sur une seule ligne, on coupe aux virgules
  const ingredients = (raw.includes('\n') ? raw.split(/[\n;]+/) : raw.split(/[,;]+/)).map((s) => s.trim()).filter(Boolean);
  const toBuy = e.submitter?.name === 'tobuy';
  call({ action: 'save_recipe', id: +f.dataset.id || 0, name: f.name.value, ingredients, source_url: f.dataset.src || '', servings: f.dataset.servings || '', to_buy: toBuy });
  toast(toBuy ? `« ${f.name.value} » enregistré, ingrédients manquants ajoutés aux courses` : `« ${f.name.value} » enregistré`);
  f.reset();
  delete f.dataset.id; delete f.dataset.src; delete f.dataset.servings;
});

// importer une recette depuis un site : pré-remplit le formulaire pour vérifier avant d'enregistrer
$('#import-recipe').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = $('button', f);
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': window.CSRF }, body: JSON.stringify({ action: 'import_url', url: f.url.value.trim() }) });
    if (r.status === 401) return (location.href = 'login.php');
    const j = await r.json();
    if (!r.ok || !j.recipe) return toast('Impossible de lire cette recette. Essaie un lien Marmiton ou 750g.');
    const rf = $('#recipe-form');
    rf.name.value = j.recipe.name;
    rf.ingredients.value = j.recipe.ingredients.join('\n');
    rf.dataset.src = j.recipe.url; rf.dataset.servings = j.recipe.servings || '';
    delete rf.dataset.id;
    f.reset();
    toast(`« ${j.recipe.name} » importée : vérifie puis enregistre`);
    rf.scrollIntoView({ behavior: 'smooth' });
  } catch {
    toast('Pas de connexion : l’import de recette a besoin d’internet.');
  } finally {
    btn.disabled = false; btn.textContent = '↓';
  }
});

fetch('assets/recettes.json?v=7').then((r) => r.json()).then((j) => { ideas = j; render(); }).catch(() => {});

// import : nettoie chaque ligne (prix, quantités, contenances) en gardant le nom du produit
function clean(line) {
  return line
    .replace(/\d+[.,]\d{2}\s*€?|€\s*\d+[.,]?\d*/g, '')   // prix
    .replace(/\b\d+\s*[x×]\b|\b[x×]\s*\d+\b/gi, '')      // 2x, x2
    .replace(/^\s*\d+\s+(?=\D)/, '')                     // quantité en début de ligne
    .replace(/\s{2,}/g, ' ').replace(/^[\s\-–•*]+|[\s\-–•*]+$/g, '');
}
/** Lignes d'un récap de commande qui ne sont pas des produits (quantités, prix, totaux, livraison…). */
function noise(line) {
  const s = line.trim().toLowerCase();
  return s.length < 2
    || /^(quantit[ée]|qt[ée]|prix|total|sous-total|montant|tva|livraison|frais|remise|r[ée]duction|promo|[ée]conomis|cagnott|avantage|carte|paiement|commande|cr[ée]neau|retrait|drive|adresse|n°|num[ée]ro|date|article|produit|sous total|vos produits|r[ée]capitulatif|merci|bonjour|ajouter|retirer|voir|remplac)/.test(s)
    || /^[\d\s.,x×*\/€%+-]*(k?g|c?l|ml|cl|pi[eè]ces?|pcs|unit[ée]s?|€\s*\/\s*(kg|l)|\/\s*(kg|l))?[\d\s.,€]*$/.test(s) // « 6x1L », « 1,08 € », « 500 g », « 2,16 €/kg »
    || /^[\d\s.,]*€?\s*\/\s*(kg|l|litre|pi[eè]ce)\b/.test(s);
}
$('#parse').addEventListener('click', () => {
  const names = [...new Set($('#paste').value.split('\n').filter((l) => !noise(l)).map(clean).filter((s) => s.length > 1 && !noise(s)))];
  $('#preview').innerHTML = names.map((n) => `<label class="item"><input type="checkbox" checked value="${esc(n)}"><span class="n">${esc(n)}</span></label>`).join('') || '<p class="empty">Rien à importer.</p>';
  $('#confirm-import').hidden = !names.length;
});
$('#confirm-import').addEventListener('click', () => {
  const names = $$('#preview input:checked').map((i) => i.value);
  if (!names.length) return;
  call({ action: 'import', names });
  $('#paste').value = ''; $('#preview').innerHTML = ''; $('#confirm-import').hidden = true;
  $('#tabs [data-tab=stock]').click();
});

/* ---------- démarrage ---------- */

render();
refresh();
setInterval(() => document.hidden || editing || refresh(), 15000);
document.addEventListener('visibilitychange', () => document.hidden || refresh());
window.addEventListener('online', refresh);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
