const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Données affichées = dernier état reçu du serveur + modifications pas encore envoyées (file d'attente).
// Autre liste que la dernière ouverte sur cet appareil (autre compte) : on oublie ce qui était gardé hors ligne.
if (store.get('courses-household', null) !== window.HOUSEHOLD) {
  ['courses-data', 'courses-queue', 'courses-drive', 'courses-hidden-ideas', 'courses-usual-filter'].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
  store.set('courses-household', window.HOUSEHOLD);
}
let data = store.get('courses-data', { products: [], recipes: [] });
let queue = store.get('courses-queue', []);
let offline = false;
let openRecipe = null;
let ideas = []; // idées de plats (assets/recettes.json)
let openIdea = null;
let editing = null; // id du produit dont le détail est ouvert
let usualFilter = store.get('courses-usual-filter', 'top'); // rayon affiché dans Habituels
let hiddenIdeas = store.get('courses-hidden-ideas', []); // idées de plats masquées (noms)

const AISLE_KEYS = Object.keys(window.AISLES);
const byId = (id) => data.products.find((p) => String(p.id) === String(id));
const byName = (n) => data.products.find((p) => p.name.toLowerCase() === String(n).trim().toLowerCase());
const isTmp = (p) => String(p.id).startsWith('t');
const target = (p) => (isTmp(p) ? { id: 0, ref: p.name } : { id: +p.id }); // un produit créé hors ligne n'a pas encore d'id
const ago = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'jamais');
const today = () => new Date().toISOString().slice(0, 10);
const initial = (u) => (u ? u.trim().charAt(0).toUpperCase() : '');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** Dans la liste : à acheter (buy) ou déjà dans le caddie (got) */
const listed = (p) => p.status === 'buy' || p.status === 'got';
/** minuscules sans accents, pour chercher « creme » et trouver « Crème » */
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').toLowerCase();
const img = (url, cls = '') => (url ? `<img${cls ? ` class="${cls}"` : ''} src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '');
/** Lien Carrefour : le produit retenu s'il y en a un, sinon la recherche par nom. */
const shopUrl = (p) => p.shop_url || 'https://www.carrefour.fr/s?q=' + encodeURIComponent(p.name);
const shopLink = (p, label = '🛒', cls = 'shop') =>
  `<a class="${cls}" href="${esc(shopUrl(p))}" target="_blank" rel="noopener" title="${p.shop_url ? 'Voir le produit chez Carrefour' : 'Chercher chez Carrefour'}">${label}</a>`;

/* ---------- prix ---------- */

const euros = (c) => (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
let guessCache = new Map();
let usualPriced = [];
/** Prix d'un produit (centimes) : le sien, sinon celui d'un habituel Carrefour au nom proche (« Farine » → « Farine de blé T45 »). */
function priceOf(p) {
  if (+p.price_cents) return { c: +p.price_cents, guess: false };
  const k = norm(p.name);
  if (!guessCache.has(k)) {
    const words = k.split(/[^a-z0-9]+/).filter((w) => w.length > 2).map((w) => w.replace(/[sx]$/, ''));
    // le produit Carrefour doit commencer par le même mot (« Huile » ≠ « Sardines à l'huile ») et contenir les autres
    const hit = words.length && usualPriced.find((u) => { const uw = norm(u.name).split(/[^a-z0-9]+/).filter(Boolean); return uw[0]?.startsWith(words[0]) && words.every((w) => uw.some((x) => x.startsWith(w))); });
    guessCache.set(k, hit ? +hit.price_cents : null);
  }
  const c = guessCache.get(k);
  return c ? { c, guess: true } : null;
}
/** « 2 » ou « x2 » → 2 articles ; « 500 g » → 1 article */
const units = (p) => (/^\s*[x×]?\s*(\d{1,2})\s*$/.test(p.qty || '') ? +p.qty.replace(/\D/g, '') : 1);
const linePrice = (p) => { const pr = priceOf(p); return pr ? { c: pr.c * units(p), guess: pr.guess } : null; };
const priceTag = (pr, cls = 'price') => (pr ? `<span class="${cls}">${pr.guess ? '≈ ' : ''}${euros(pr.c)}</span>` : '');
/** Total d'une liste de produits : { c: centimes, unknown: nombre sans prix } */
function total(list, withUnits = true) {
  return list.reduce((t, p) => { const pr = withUnits ? linePrice(p) : priceOf(p); pr ? (t.c += pr.c) : t.unknown++; return t; }, { c: 0, unknown: 0 });
}
/** « 200 g de farine » → « farine » (pour estimer le prix des idées de plats) */
const ingName = (l) => String(l).replace(/\([^)]*\)/g, '')
  .replace(/^\s*(?:[\d½¼¾.,\/]+|un|une|quelques)\s*(?:kg|g|cl|ml|l|c\.\s?à\s?[sc]\.|cuill[eè]res?\s+à\s+(?:soupe|caf[ée])|pinc[ée]es?|sachets?|tranches?|gousses?|bo[iî]tes?|feuilles?|boules?|cubes?|pav[ée]s?|p[âa]tes?\s+(?=bris|feuill|[àa]))?\s*(?:de\s+|d['’]\s*)?/i, '')
  .replace(/^(?:jaunes?|blancs?)\s+d['’]\s*/i, '').trim();

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
      if (p) Object.assign(p, b.status === 'buy' ? { status: 'buy', added_by: p.added_by || window.USER } : b.status === 'got' ? { status: 'got' } : { status: b.status, qty: '', added_by: null });
      break;
    case 'bought': // coché : dans le caddie, validé par « Courses faites »
      if (p) p.status = 'got';
      break;
    case 'update_product':
      if (p) {
        Object.assign(p, { qty: b.qty, note: b.note }, b.category ? { category: b.category } : {}, b.name ? { name: b.name } : {});
        if ('shop_url' in b) p.shop_url = /^https:\/\/\S+$/.test(b.shop_url) ? b.shop_url : null;
        if ('price' in b) { const v = parseFloat(String(b.price).replace(',', '.')); p.price_cents = v > 0 ? Math.round(v * 100) : null; }
      }
      break;
    case 'restore':
      if (p) Object.assign(p, b.fields);
      break;
    case 'all_bought': { // le caddie ; si rien n'est coché, toute la liste
      const from = data.products.some((x) => x.status === 'got') ? ['got'] : ['buy', 'got'];
      data.products.filter((x) => from.includes(x.status)).forEach((x) => Object.assign(x, { status: 'stock', qty: '', added_by: null, times_bought: +x.times_bought + 1, last_bought: today() }));
      break;
    }
    case 'restore_many':
      b.items.forEach((it) => { const x = byId(it.id); if (x) Object.assign(x, it.fields); });
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
function adopt(snap, announce = false) {
  const before = new Set(data.products.filter(listed).map((p) => String(p.id)));
  const hadData = data.products.length > 0; // premier chargement sur cet appareil : rien à annoncer
  data = snap;
  queue.forEach(applyLocal);
  save();
  render();
  if (announce && hadData) {
    // « Manu a ajouté : lait, pain » quand l'autre personne a rempli la liste entre-temps
    const added = data.products.filter((p) => listed(p) && !before.has(String(p.id)) && p.added_by && p.added_by !== window.USER);
    if (added.length) {
      const who = added[0].added_by, names = added.slice(0, 3).map((p) => p.name);
      toast(`${who} a ajouté : ${names.join(', ')}${added.length > 3 ? ` et ${added.length - 3} autre${added.length > 4 ? 's' : ''}` : ''}`);
    }
  }
}

async function refresh() {
  if (queue.length) return flush();
  try {
    const r = await fetch('api.php?v=' + encodeURIComponent(data.v || ''), { cache: 'no-store' });
    if (r.status === 401) return (location.href = 'login.php');
    if (!r.ok) throw new Error();
    offline = false;
    if (r.status === 204) return renderNet(); // rien n'a changé depuis la dernière fois
    adopt(await r.json(), true);
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
  const pr = priceOf(p);
  return `<form class="detail edit" data-edit="${esc(p.id)}">
    <label>Nom <input name="name" value="${esc(p.name)}" required></label>
    <div class="row"><label>Quantité <input name="qty" value="${esc(p.qty)}" placeholder="ex : 2, 500 g"></label>
    <label>Prix (€) <input name="price" inputmode="decimal" value="${p.price_cents ? (p.price_cents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="${pr ? '≈ ' + (pr.c / 100).toFixed(2).replace('.', ',') : 'ex : 2,49'}"></label></div>
    <label>Note <input name="note" value="${esc(p.note)}" placeholder="ex : marque Lactel, bio…"></label>
    <details><summary>Plus d'options</summary>
      <label>Rayon <select name="category">${AISLE_KEYS.map((k) => `<option value="${k}"${k === p.category ? ' selected' : ''}>${esc(window.AISLES[k])}</option>`).join('')}</select></label>
      <label>Lien Carrefour <input name="shop_url" type="url" inputmode="url" value="${esc(p.shop_url)}" placeholder="lien du produit (sinon : recherche par nom)"></label>
    </details>
    <div class="row"><button>Enregistrer</button><button type="button" class="plain" data-act="edit">Fermer</button></div>
  </form>`;
}

const qtyLabel = (p) => (p.qty ? ` <b class="qty">${esc(/^\d+$/.test(p.qty) ? '×' + p.qty : p.qty)}</b>` : '');
const editBlock = (p) => (String(editing) === String(p.id) ? editForm(p) : '');

/** Liste du mode drive : ce qui reste à mettre au panier d'abord (par rayon), puis ce qui y est déjà. */
function renderDrive(buy) {
  if (drive.finishing) {
    const n = buy.filter(inCart).length;
    return `<div class="detail drive-end"><p>Commande passée ? ${n ? `Coche les <b>${plural(n, 'article')}</b> mis au panier comme achetés : ils sortent de la liste.` : 'Aucun article mis au panier.'}</p>
      <div class="row">${n ? `<button data-drive="bought">Marquer ${n} comme acheté${n > 1 ? 's' : ''}</button>` : ''}
      <button class="plain" data-drive="quit">Quitter sans rien changer</button><button class="plain" data-drive="back">Revenir à la liste</button></div></div>`;
  }
  if (!buy.length) return '<p class="empty">Rien à acheter 🎉</p>';
  const todo = buy.filter((p) => !inCart(p)), done = buy.filter(inCart);
  const row = (p) => `<div class="item drive${inCart(p) ? ' done' : ''}" data-id="${esc(p.id)}">${img(p.image_url, 'thumb')}
      <span class="n" data-act="edit"><span class="nm">${esc(p.name)}${qtyLabel(p)}</span>${p.note ? `<small class="note">${esc(p.note)}</small>` : ''}${priceTag(linePrice(p), 'note price')}</span>
      ${shopLink(p, 'Ouvrir', 'shop-btn')}
      <button class="tick" data-act="cart" title="${inCart(p) ? 'Retirer du panier' : 'Mis au panier'}">${inCart(p) ? '↺' : '✓'}</button></div>${editBlock(p)}`;
  return grouped(todo).map(([k, items]) => `<h2 class="aisle">${esc(window.AISLES[k])}</h2>` + items.map(row).join('')).join('')
    + (done.length ? `<h2 class="aisle">Dans le panier</h2>` + done.map(row).join('') : '');
}

/** Onglet Habituels : tes achats fréquents Carrefour, en vignettes ; toucher = ajouter / retirer de la liste. */
function renderUsual() {
  const q = norm($('#usual .search').value.trim());
  const all = data.products.filter((p) => p.usual_rank).sort((a, b) => a.usual_rank - b.usual_rank);
  if (!all.length) {
    $('#usual .list').innerHTML = `<p class="empty">Aucun produit habituel pour l’instant.${window.ADMIN ? '<br>Importe tes achats fréquents Carrefour depuis l’onglet « Import ».' : ''}</p>`;
    return;
  }
  const card = (p) => `<button class="card${listed(p) ? ' in' : ''}" data-usual="${esc(p.id)}" title="${listed(p) ? 'Dans la liste (toucher pour retirer)' : 'Ajouter à la liste'}">
      ${p.image_url ? img(p.image_url) : '<span class="noimg">🛒</span>'}
      <span class="cn">${esc(p.name)}</span><small>${[p.format, p.price_cents ? euros(+p.price_cents) : ''].filter(Boolean).map(esc).join(' · ')}</small>${listed(p) ? '<b class="badge">✓</b>' : ''}</button>`;
  const grid = (list) => `<div class="cards">${list.map(card).join('')}</div>`;
  if (q) {
    const found = all.filter((p) => norm(p.name).includes(q));
    $('#usual .list').innerHTML = found.length ? grid(found) : '<p class="empty">Rien trouvé.</p>';
    return;
  }
  // une rangée de rayons à toucher : on n'affiche qu'un rayon à la fois (par défaut, les plus achetés)
  const groups = {};
  all.forEach((p) => (groups[AISLE_KEYS.includes(p.category) ? p.category : 'autre'] ||= []).push(p));
  if (usualFilter !== 'top' && !groups[usualFilter]) usualFilter = 'top';
  const inList = all.filter(listed);
  const chip = (k, label, n) => `<button class="chip${usualFilter === k ? ' on' : ''}" data-chip="${k}">${label}${n ? ` <small>${n}</small>` : ''}</button>`;
  const chips = `<div class="chips">${chip('top', '⭐ Les plus achetés')}${inList.length ? chip('inlist', '✓ Dans la liste', inList.length) : ''}${AISLE_KEYS.filter((k) => groups[k]).map((k) => chip(k, esc(window.AISLES[k]), groups[k].length)).join('')}</div>`;
  const shown = usualFilter === 'top' ? all.slice(0, 30) : usualFilter === 'inlist' ? inList : groups[usualFilter];
  $('#usual .list').innerHTML = chips + (shown.length ? grid(shown) : '<p class="empty">Rien dans la liste pour l’instant.</p>');
}

/** Onglet Plats : mes plats puis les idées, en vignettes avec photo ; le détail s'ouvre sous la grille. */
function renderPlats() {
  const recipes = data.recipes.map((r) => {
    const ings = r.products.map((id, i) => ({ p: byId(id), qty: r.qty?.[i] || '' })).filter((x) => x.p);
    const out = ings.filter(({ p }) => p.status === 'out').map(({ p }) => p);
    return { r, ings, out, inList: ings.filter(({ p }) => listed(p)).length, cost: total(out, false) };
  });
  const status = ({ ings, out, inList, cost }) => (!ings.length ? 'pas d’ingrédients (touche « Modifier »)' : !out.length && !inList ? '✅ tout est là'
    : out.length ? `${plural(out.length, 'ingrédient')} à acheter${cost.c ? ` · ≈ ${euros(cost.c)}` : ''}` : `🛒 ${inList} dans la liste`);
  const recipeCard = (x) => `<div class="pcard${openRecipe === +x.r.id ? ' open' : ''}" data-rid="${x.r.id}" role="button" tabindex="0">
      ${x.r.image_url ? img(x.r.image_url) : '<span class="noimg">🍽️</span>'}<span class="cn">${esc(x.r.name)}</span><small>${status(x)}</small>
      <button class="pdel" data-pdel="${x.r.id}" title="Supprimer ce plat" aria-label="Supprimer ce plat">✕</button></div>`;
  const open = recipes.find((x) => +x.r.id === openRecipe);
  const detail = open ? `<div class="detail pdetail">
      <b>${esc(open.r.name)}</b>${open.r.servings || open.r.source_url ? `<small class="hint">${esc(open.r.servings || '')}${open.r.servings && open.r.source_url ? ' · ' : ''}${open.r.source_url ? `<a href="${esc(open.r.source_url)}" target="_blank" rel="noopener">voir la recette</a>` : ''}</small>` : ''}
      ${open.ings.map(({ p, qty }) => `<div class="ing" data-pid="${esc(p.id)}">${p.status === 'stock' ? '✅' : listed(p) ? '🛒' : '❌'} ${esc(p.name)}${qty ? ` <small>${esc(qty)}</small>` : ''}${p.status === 'out' ? priceTag(priceOf(p), 'iprice') : ''}</div>`).join('') || '<em>Aucun ingrédient</em>'}
      <small class="hint">Touche un ingrédient pour dire si tu en as déjà (✅) ou pas (❌).</small>
      <div class="row">${open.out.length ? `<button data-ract="tobuy" data-rid="${open.r.id}">Ajouter les ${open.out.length} ❌ aux courses${open.cost.c ? ` (≈ ${euros(open.cost.c)})` : ''}</button>` : ''}
      <button class="plain" data-ract="edit" data-rid="${open.r.id}">Modifier</button><button class="plain" data-pdel="${open.r.id}">Supprimer</button></div></div>` : '';
  $('#plats .list').innerHTML = recipes.length ? `<div class="pcards">${recipes.map(recipeCard).join('')}</div>${detail}` : '<p class="empty">Aucun plat pour l’instant : choisis une idée ci-dessous.</p>';

  const mine = new Set(data.recipes.map((r) => r.name.toLowerCase()));
  const shown = ideas.map((r, i) => ({ r, i, cost: total(r.ingredients.map((x) => ({ name: ingName(x) })), false) }))
    .filter(({ r }) => !mine.has(r.name.toLowerCase()) && !hiddenIdeas.includes(r.name));
  const ideaCard = ({ r, i, cost }) => `<div class="pcard${openIdea === i ? ' open' : ''}" data-idea="${i}" role="button" tabindex="0">${r.image ? img(r.image) : '<span class="noimg">🍽️</span>'}
      <span class="cn">${esc(r.name)}</span><small>${esc(r.servings)}${cost.c ? ` · ≈ ${euros(cost.c)}` : ''}</small>
      <button class="pdel" data-ihide="${i}" title="Masquer cette idée" aria-label="Masquer cette idée">✕</button></div>`;
  const oi = shown.find((x) => x.i === openIdea);
  const idetail = oi ? `<div class="detail pdetail"><b>${esc(oi.r.name)}</b><small class="hint">${esc(oi.r.servings)}${oi.r.source_url ? ` · <a href="${esc(oi.r.source_url)}" target="_blank" rel="noopener">voir une recette</a>` : ''}</small>
      ${oi.r.ingredients.map((x) => `<div>• ${esc(x)}</div>`).join('')}
      <div class="row"><button data-iact="tobuy" data-idea="${oi.i}">Ajouter aux courses${oi.cost.c ? ` (≈ ${euros(oi.cost.c)})` : ''}</button><button class="plain" data-iact="save" data-idea="${oi.i}">Juste l'ajouter à mes plats</button></div>
      <small class="hint">Seuls les ingrédients que tu n'as pas déjà sont ajoutés.</small></div>` : '';
  $('#ideas').innerHTML = (shown.length ? `<div class="pcards">${shown.map(ideaCard).join('')}</div>${idetail}` : '<p class="empty">Plus d’idées à afficher.</p>')
    + (hiddenIdeas.length ? `<button class="plain wide" data-ishow>Réafficher les idées masquées (${hiddenIdeas.length})</button>` : '');
}

function render() {
  guessCache = new Map();
  usualPriced = data.products.filter((p) => p.usual_rank && +p.price_cents).sort((a, b) => a.usual_rank - b.usual_rank);
  $('#known').innerHTML = data.products.map((p) => `<option value="${esc(p.name)}">`).join('');

  const buy = data.products.filter((p) => p.status === 'buy');
  const got = data.products.filter((p) => p.status === 'got').sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const all = [...buy, ...got];
  const t = total(all);
  $('#summary').innerHTML = all.length && !drive
    ? `<div class="summary"><span><b>${buy.length ? plural(buy.length, 'article') + ' à prendre' : 'Tout est dans le caddie 🎉'}</b>${got.length && buy.length ? ` · ✓ ${got.length} dans le caddie` : ''}${t.c ? ` · <b>≈ ${euros(t.c)}</b>` : ''}${t.unknown ? `<small> · ${t.unknown} sans prix</small>` : ''}</span>
        <div class="row"><button data-done>✓ Courses faites</button>${buy.length ? '<button class="plain" data-drive="start">Commander chez Carrefour</button>' : ''}</div></div>`
    : '';
  $('#drive-bar').innerHTML = drive
    ? `<div class="drive-head"><b>Commande Carrefour</b><span>🛒 ${all.filter(inCart).length} / ${all.length}</span><button class="plain" data-drive="finish">Terminer</button></div>`
    : '';
  const row = (p) => {
    const isGot = p.status === 'got';
    return `<div class="item${isGot ? ' got' : ''}" data-id="${esc(p.id)}"><input type="checkbox" data-act="${isGot ? 'unbought' : 'bought'}"${isGot ? ' checked' : ''} aria-label="${isGot ? 'Remettre à acheter' : 'Dans le caddie'}">${img(p.image_url, 'thumb')}
      <span class="n" data-act="edit"><span class="nm">${esc(p.name)}${qtyLabel(p)}</span>${p.note ? `<small class="note">${esc(p.note)}</small>` : ''}</span>
      ${priceTag(linePrice(p))}${!isGot && p.added_by && p.added_by !== window.USER ? `<span class="who" title="Ajouté par ${esc(p.added_by)}">${esc(initial(p.added_by))}</span>` : ''}
      ${isGot ? '' : '<button class="x" data-act="out" title="Retirer de la liste">✕</button>'}</div>${editBlock(p)}`;
  };
  $('#buy .list').innerHTML = drive ? renderDrive(all) : all.length
    ? grouped(buy).map(([k, items]) => `<h2 class="aisle">${esc(window.AISLES[k])}</h2>` + items.map(row).join('')).join('')
      + (got.length ? `<h2 class="aisle got-title">✓ Dans le caddie <small>${got.length}</small></h2>` + got.map(row).join('') : '')
    : `<p class="empty">Rien à acheter 🎉<br><small>Ajoute un produit ci-dessus, ou pioche dans <a href="#" data-goto="usual">⭐ Habituels</a> et <a href="#" data-goto="plats">🍽️ Plats</a>.</small></p>`;

  if ($('#stock')) {
    const q = norm($('#stock .search').value.trim());
    // les habituels Carrefour jamais achetés via l'appli restent dans l'onglet Habituels, pas dans le placard
    const rows = data.products.filter((p) => !listed(p) && norm(p.name).includes(q) && !(p.usual_rank && p.status === 'out' && !+p.times_bought));
    $('#stock .list').innerHTML = rows.length
      ? grouped(rows).map(([k, items]) => `<h2 class="aisle">${esc(window.AISLES[k])}</h2>` + items.map((p) => `
          <div class="item" data-id="${esc(p.id)}"><span class="n" data-act="edit">${esc(p.name)} <small>${+p.times_bought ? `acheté ${p.times_bought}× · ${ago(p.last_bought)}` : 'jamais acheté'}</small></span>
          ${p.status === 'stock' ? '<button class="pill ok" data-act="buy">On en a</button>' : '<button class="pill ko" data-act="buy">Manque</button>'}</div>${editBlock(p)}`).join('')).join('')
      : '<p class="empty">Aucun produit.</p>';
  }

  if (!$('#plats').hidden) renderPlats();
  if (!$('#usual').hidden) renderUsual(); // 400+ vignettes : seulement quand l'onglet est affiché

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

function showTab(name) {
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
  $$('main > section').forEach((s) => (s.hidden = s.id !== name));
  editing = null;
  render();
  window.scrollTo(0, 0);
}

function openRecipeForm(show = true) {
  $('#new-recipe').hidden = !show;
  $('#new-recipe-btn').hidden = show;
  if (show) $('#new-recipe').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- événements ---------- */

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) { e.preventDefault(); return showTab(go.dataset.goto); }

  // « Courses faites » : ce qui est dans le caddie est acheté (si rien n'est coché : toute la liste), avec Annuler
  if (e.target.closest('[data-done]')) {
    const someGot = data.products.some((p) => p.status === 'got');
    const items = data.products.filter((p) => (someGot ? p.status === 'got' : listed(p)) && !isTmp(p));
    const left = someGot ? data.products.filter((p) => p.status === 'buy').length : 0;
    const before = items.map((p) => ({ id: +p.id, fields: { status: p.status, qty: p.qty, added_by: p.added_by, times_bought: +p.times_bought, last_bought: p.last_bought } }));
    call({ action: 'all_bought' });
    drive = null; saveDrive();
    toast(`Courses faites 🎉 ${plural(items.length, 'article')} acheté${items.length > 1 ? 's' : ''}${left ? ` · ${left} reste${left > 1 ? 'nt' : ''} dans la liste` : ''}`, { action: 'restore_many', items: before });
    return;
  }

  const a = e.target.closest('[data-act]')?.dataset.act;
  const row = e.target.closest('.item[data-id], form[data-edit]');
  if (a && row) {
    const p = byId(row.dataset.id ?? row.dataset.edit);
    if (!p) return;
    if (a === 'bought') act(p, { action: 'bought' }, `« ${p.name} » dans le caddie ✓`);
    if (a === 'unbought') act(p, { action: 'set_status', status: 'buy' }, `« ${p.name} » remis à prendre`);
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
  const ch = e.target.closest('[data-chip]');
  if (ch) {
    usualFilter = ch.dataset.chip;
    store.set('courses-usual-filter', usualFilter);
    renderUsual();
    $('#usual .chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    return;
  }
  const u = e.target.closest('[data-usual]');
  if (u) {
    const p = byId(u.dataset.usual);
    if (p) act(p, { action: 'set_status', status: listed(p) ? 'out' : 'buy' }, listed(p) ? `« ${p.name} » retiré de la liste` : `« ${p.name} » ajouté à la liste`);
  }
  const d = e.target.closest('[data-drive]')?.dataset.drive;
  if (d === 'start') drive = { done: [], finishing: false };
  if (d === 'finish' && drive) drive.finishing = true;
  if (d === 'back' && drive) drive.finishing = false;
  if (d === 'quit') drive = null;
  if (d === 'bought' && drive) {
    const items = data.products.filter((p) => listed(p) && inCart(p));
    items.forEach((p) => call({ action: 'bought', ...target(p) })); // dans le caddie…
    call({ action: 'all_bought' }); // … puis validés ; le reste de la liste ne bouge pas
    toast(`${plural(items.length, 'article')} acheté${items.length > 1 ? 's' : ''} 👍`);
    drive = null;
  }
  if (d) { editing = null; saveDrive(); render(); window.scrollTo(0, 0); }

  // ✕ sur un plat : supprimé tout de suite, avec Annuler (on le recrée à l'identique)
  const pdel = e.target.closest('[data-pdel]');
  if (pdel) {
    const r = data.recipes.find((x) => +x.id === +pdel.dataset.pdel);
    if (!r) return;
    const ingredients = r.products.map((id, i) => { const n = byId(id)?.name; return n && (r.qty?.[i] ? `${r.qty[i]} ${n}` : n); }).filter(Boolean);
    if (openRecipe === +r.id) openRecipe = null;
    call({ action: 'delete_recipe', id: +r.id });
    toast(`« ${r.name} » supprimé`, { action: 'save_recipe', id: 0, name: r.name, ingredients, servings: r.servings || '', image_url: r.image_url || '', source_url: r.source_url || '' });
    return;
  }
  // ✕ sur une idée : masquée (sur cet appareil), avec Annuler
  const ihide = e.target.closest('[data-ihide]');
  if (ihide) {
    const name = ideas[+ihide.dataset.ihide].name;
    hiddenIdeas = [...hiddenIdeas, name];
    store.set('courses-hidden-ideas', hiddenIdeas);
    if (openIdea === +ihide.dataset.ihide) openIdea = null;
    render();
    toast(`Idée « ${name} » masquée`);
    return;
  }
  if (e.target.closest('[data-ishow]')) { hiddenIdeas = []; store.set('courses-hidden-ideas', []); return render(); }

  const pc = e.target.closest('.pcard');
  if (pc?.dataset.rid) { const id = +pc.dataset.rid; openRecipe = openRecipe === id ? null : id; openIdea = null; render(); }
  if (pc?.dataset.idea) { const i = +pc.dataset.idea; openIdea = openIdea === i ? null : i; openRecipe = null; render(); }
  if (pc && !pc.classList.contains('open')) $('.pdetail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const iact = e.target.closest('[data-iact]')?.dataset.iact;
  if (iact) {
    const r = ideas[+e.target.closest('[data-iact]').dataset.idea];
    call({ action: 'save_recipe', id: 0, name: r.name, servings: r.servings, ingredients: r.ingredients, image_url: r.image || '', source_url: r.source_url || '', to_buy: iact === 'tobuy' });
    toast(iact === 'tobuy' ? `Ingrédients de « ${r.name} » ajoutés aux courses (sauf ceux que tu as déjà)` : `« ${r.name} » ajouté à tes plats`);
    openIdea = null;
  }
  const ing = e.target.closest('.ing[data-pid]');
  if (ing) {
    const p = byId(ing.dataset.pid);
    if (p && !listed(p)) act(p, { action: 'set_status', status: p.status === 'stock' ? 'out' : 'stock' }, p.status === 'stock' ? `« ${p.name} » : on n'en a plus` : `« ${p.name} » : on en a`);
  }
  const rb = e.target.closest('[data-ract]');
  const ract = rb?.dataset.ract, rid = +rb?.dataset.rid;
  if (ract === 'tobuy') {
    const n = (data.recipes.find((x) => +x.id === rid)?.products || []).map(byId).filter((p) => p?.status === 'out').length;
    call({ action: 'recipe_to_buy', id: rid });
    toast(`${plural(n, 'ingrédient')} ajouté${n > 1 ? 's' : ''} aux courses`);
  }
  if (ract === 'del' && confirm('Supprimer ce plat ?')) { openRecipe = null; call({ action: 'delete_recipe', id: rid }); }
  if (ract === 'edit') {
    const r = data.recipes.find((x) => +x.id === rid), f = $('#recipe-form');
    f.name.value = r.name;
    f.ingredients.value = r.products.map((id, i) => { const n = byId(id)?.name; return n && (r.qty?.[i] ? `${r.qty[i]} ${n}` : n); }).filter(Boolean).join('\n');
    f.dataset.id = rid;
    openRecipeForm();
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
  if (p) call({ action: 'update_product', ...target(p), name: name !== p.name ? name : '', qty: f.qty.value.trim(), note: f.note.value.trim(), category: f.category.value, shop_url: url, price: f.price.value.trim() });
  editing = null;
  render();
});

$$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

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
$('#usual .search').addEventListener('input', renderUsual);

/* ---------- plats : ajout à la main ou depuis un lien ---------- */

$('#new-recipe-btn').addEventListener('click', () => openRecipeForm());

$('#recipe-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const raw = f.ingredients.value.trim();
  // un par ligne ; si tout est sur une seule ligne, on coupe aux virgules
  const ingredients = (raw.includes('\n') ? raw.split(/[\n;]+/) : raw.split(/[,;]+/)).map((s) => s.trim()).filter(Boolean);
  const toBuy = e.submitter?.name === 'tobuy';
  call({ action: 'save_recipe', id: +f.dataset.id || 0, name: f.name.value, ingredients, source_url: f.dataset.src || '', servings: f.dataset.servings || '', image_url: f.dataset.image || '', to_buy: toBuy });
  toast(toBuy ? `« ${f.name.value} » enregistré, ingrédients manquants ajoutés aux courses` : `« ${f.name.value} » enregistré`);
  f.reset();
  delete f.dataset.id; delete f.dataset.src; delete f.dataset.servings; delete f.dataset.image;
  openRecipeForm(false);
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
    rf.name.value = j.recipe.name.replace(/\s*:\s*la meilleure recette\s*$/i, '');
    rf.ingredients.value = j.recipe.ingredients.join('\n');
    rf.dataset.src = j.recipe.url; rf.dataset.servings = j.recipe.servings || ''; rf.dataset.image = j.recipe.image || '';
    delete rf.dataset.id;
    f.reset();
    toast(`« ${rf.name.value} » importée : vérifie puis enregistre`);
  } catch {
    toast('Pas de connexion : l’import de recette a besoin d’internet.');
  } finally {
    btn.disabled = false; btn.textContent = '↓';
  }
});

fetch('assets/recettes.json?v=16').then((r) => r.json()).then((j) => { ideas = j; render(); }).catch(() => {});

/* ---------- Robin seulement : placard et imports ---------- */

if (window.ADMIN) {
  $('#stock .search').addEventListener('input', render);

  // Achats fréquents Carrefour : fichier produit par le favori « Exporter Carrefour »
  $('#catalog-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const items = JSON.parse(await file.text());
      if (!Array.isArray(items) || !items.length || !items[0].name) throw new Error();
      call({ action: 'import_catalog', items });
      toast(`${items.length} produits importés dans « Habituels »`);
      showTab('usual');
    } catch {
      toast('Ce fichier ne ressemble pas à un export Carrefour.');
    }
    e.target.value = '';
  });

  // Favori à glisser dans la barre : sur carrefour.fr/mon-compte/achats-frequents, parcourt toutes les pages et télécharge la liste (nom, lien, photo, contenance, prix).
  $('#bookmarklet').href = 'javascript:' + encodeURIComponent(`(async()=>{const S=t=>new Promise(r=>setTimeout(r,t)),M=new Map,X=()=>document.querySelectorAll('article[data-testid]').forEach(c=>{const a=c.querySelector('a[href*="/p/"]'),i=c.querySelector('img[src*="media.carrefour.fr"]'),pr=c.querySelector('.product-price__amount--main');if(!a||!/^\\d+$/.test(c.dataset.testid))return;let n=a.textContent.trim().replace(/\\s+/g,' ');const w=n.split(' ');let k=0;while(k<w.length-1&&w[k]===w[k].toUpperCase()&&/[A-Z]/.test(w[k]))k++;const b=w.slice(0,k).join(' ');if(k&&n.endsWith(' '+b))n=w.slice(k).join(' ');const f=c.querySelector('.c-tag span');const p=pr?parseFloat(pr.textContent.replace(/[^\\d,]/g,'').replace(',','.')):0;M.set(c.dataset.testid,{name:n,url:a.href,image:i&&/^https:/.test(i.src)?i.src:'',format:f?f.textContent.trim():'',ean:c.dataset.testid,price:p>0?p:null})});if(!/achats-frequents/.test(location.href))return alert('Ouvre d\\'abord « Mes achats fréquents » sur carrefour.fr');X();for(let j=0;j<60;j++){const b=[...document.querySelectorAll('button,a')].find(x=>/Produits suivants/i.test(x.textContent));if(!b||b.disabled)break;const s=M.size;b.click();for(let t=0;t<20&&M.size===s;t++){await S(500);X()}await S(800);X();if(M.size===s)break}const l=document.createElement('a');l.href=URL.createObjectURL(new Blob([JSON.stringify([...M.values()])],{type:'application/json'}));l.download='carrefour-habituels.json';document.body.appendChild(l);l.click();alert(M.size+' produits exportés : choisis le fichier dans l\\'onglet Import de l\\'appli Courses')})()`);
  $('#bookmarklet').addEventListener('click', (e) => { e.preventDefault(); toast('Fais glisser ce bouton dans ta barre de favoris, puis clique dessus sur carrefour.fr'); });

  // import : nettoie chaque ligne (prix, quantités, contenances) en gardant le nom du produit
  const clean = (line) => line
    .replace(/\d+[.,]\d{2}\s*€?|€\s*\d+[.,]?\d*/g, '')   // prix
    .replace(/\b\d+\s*[x×]\b|\b[x×]\s*\d+\b/gi, '')      // 2x, x2
    .replace(/^\s*\d+\s+(?=\D)/, '')                     // quantité en début de ligne
    .replace(/\s{2,}/g, ' ').replace(/^[\s\-–•*]+|[\s\-–•*]+$/g, '');
  /** Lignes d'un récap de commande qui ne sont pas des produits (quantités, prix, totaux, livraison…). */
  const noise = (line) => {
    const s = line.trim().toLowerCase();
    return s.length < 2
      || /^(quantit[ée]|qt[ée]|prix|total|sous-total|montant|tva|livraison|frais|remise|r[ée]duction|promo|[ée]conomis|cagnott|avantage|carte|paiement|commande|cr[ée]neau|retrait|drive|adresse|n°|num[ée]ro|date|article|produit|sous total|vos produits|r[ée]capitulatif|merci|bonjour|ajouter|retirer|voir|remplac)/.test(s)
      || /^[\d\s.,x×*\/€%+-]*(k?g|c?l|ml|cl|pi[eè]ces?|pcs|unit[ée]s?|€\s*\/\s*(kg|l)|\/\s*(kg|l))?[\d\s.,€]*$/.test(s) // « 6x1L », « 1,08 € », « 500 g », « 2,16 €/kg »
      || /^[\d\s.,]*€?\s*\/\s*(kg|l|litre|pi[eè]ce)\b/.test(s);
  };
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
    showTab('stock');
  });
}

/* ---------- notifications : « Robin a ajouté : lait, pain… » ---------- */

const other = () => (window.OTHERS || []).join(' ou ') || 'l’autre';
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** 'on' | 'off' | 'denied' | 'ios' (iPhone : il faut l'appli sur l'écran d'accueil) | 'no' (pas possible) */
async function pushState() {
  if (!pushSupported) return isIOS && !standalone ? 'ios' : 'no';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const b64ToBytes = (s) => { const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const post = (body) => fetch('api.php', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': window.CSRF }, body: JSON.stringify(body) });

async function enablePush() {
  const state = await pushState();
  if (state === 'ios') return toast('Sur iPhone : ouvre ce site dans Safari, touche Partager puis « Sur l’écran d’accueil », et active les notifications depuis l’appli.');
  if (state === 'no') return toast('Ce navigateur ne gère pas les notifications.');
  if (state === 'denied') return toast('Notifications bloquées : autorise-les dans les réglages du navigateur pour ce site.');
  if (await Notification.requestPermission() !== 'granted') return toast('Notifications non autorisées.');
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await fetch('api.php?vapid=1', { cache: 'no-store' }).then((r) => r.json());
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
    const r = await post({ action: 'subscribe', endpoint: sub.endpoint });
    if (!r.ok) throw new Error();
    store.set('courses-notif-hint', 'done');
    toast('🔔 Notifications activées : tu seras prévenu quand quelqu’un ajoute un produit.');
  } catch {
    toast('Impossible d’activer les notifications pour l’instant.');
  }
  updateBell();
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await post({ action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  toast('🔕 Notifications désactivées sur cet appareil.');
  updateBell();
}

async function updateBell() {
  const state = await pushState().catch(() => 'no');
  const bell = $('#bell');
  bell.hidden = state === 'no';
  bell.textContent = state === 'on' ? '🔔' : '🔕';
  bell.title = state === 'on' ? 'Notifications activées (toucher pour couper)' : 'Activer les notifications';
  // petit bandeau proposé une fois dans la liste
  const hint = $('#notif-hint');
  hint.hidden = state === 'on' || state === 'no' || state === 'denied' || store.get('courses-notif-hint', '') === 'done';
  hint.innerHTML = `<div class="hint-bar"><span>🔔 Être prévenu quand ${esc(other())} ajoute un produit ?</span><button data-notif="on">Activer</button><button class="plain x" data-notif="later" aria-label="Plus tard">✕</button></div>`;
  if (state === 'on') { // garde l'abonnement associé à la bonne personne côté serveur
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) post({ action: 'subscribe', endpoint: sub.endpoint }).catch(() => {});
  }
}

$('#bell').addEventListener('click', async () => ((await pushState()) === 'on' ? disablePush() : enablePush()));
document.addEventListener('click', (e) => {
  const n = e.target.closest('[data-notif]')?.dataset.notif;
  if (n === 'on') enablePush();
  if (n === 'later') { store.set('courses-notif-hint', 'done'); $('#notif-hint').hidden = true; }
});

/* ---------- démarrage ---------- */

render();
refresh();
setInterval(() => document.hidden || editing || refresh(), 15000);
document.addEventListener('visibilitychange', () => document.hidden || refresh());
window.addEventListener('online', refresh);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(updateBell).catch(() => {});
else updateBell();
// une notification touchée remet l'appli au premier plan : on recharge la liste
navigator.serviceWorker?.addEventListener('message', (e) => e.data === 'refresh' && refresh());
