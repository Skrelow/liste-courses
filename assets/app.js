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
let editing = null; // id du produit dont le détail est ouvert

const AISLE_KEYS = Object.keys(window.AISLES);
const byId = (id) => data.products.find((p) => String(p.id) === String(id));
const byName = (n) => data.products.find((p) => p.name.toLowerCase() === String(n).trim().toLowerCase());
const isTmp = (p) => String(p.id).startsWith('t');
const target = (p) => (isTmp(p) ? { id: 0, ref: p.name } : { id: +p.id }); // un produit créé hors ligne n'a pas encore d'id
const ago = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'jamais');
const today = () => new Date().toISOString().slice(0, 10);
const initial = (u) => (u ? u.trim().charAt(0).toUpperCase() : '');

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
      if (p) Object.assign(p, { qty: b.qty, note: b.note }, b.category ? { category: b.category } : {}, b.name ? { name: b.name } : {});
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
    <div class="row"><button>Enregistrer</button><button type="button" class="plain" data-act="edit">Fermer</button></div>
  </form>`;
}

function render() {
  $('#known').innerHTML = data.products.map((p) => `<option value="${esc(p.name)}">`).join('');

  const buy = data.products.filter((p) => p.status === 'buy');
  $('#buy .list').innerHTML = buy.length
    ? grouped(buy).map(([k, items]) => `<h2 class="aisle">${esc(window.AISLES[k])}</h2>` + items.map((p) => `
        <div class="item" data-id="${esc(p.id)}"><input type="checkbox" data-act="bought" aria-label="Acheté">
          <span class="n" data-act="edit">${esc(p.name)}${p.qty ? ` <b class="qty">${esc(/^\d+$/.test(p.qty) ? '×' + p.qty : p.qty)}</b>` : ''}${p.note ? `<small class="note">${esc(p.note)}</small>` : ''}</span>
          ${p.added_by ? `<span class="who" title="Ajouté par ${esc(p.added_by)}">${esc(initial(p.added_by))}</span>` : ''}
          <button class="x" data-act="out" title="Retirer de la liste">✕</button></div>
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
        const ings = r.products.map(byId).filter(Boolean);
        const missing = ings.filter((p) => p.status !== 'stock');
        const head = `<div class="item recipe-head" data-rid="${r.id}"><span class="n">${esc(r.name)} <small>${missing.length ? `❌ ${missing.length} à avoir` : '✅ tout est là'}</small></span></div>`;
        if (openRecipe !== +r.id) return head;
        return head + `<div class="detail">${ings.map((p) => `<div>${p.status === 'stock' ? '✅' : p.status === 'buy' ? '🛒' : '❌'} ${esc(p.name)}</div>`).join('') || '<em>Aucun ingrédient</em>'}
          <div class="row">${missing.some((p) => p.status === 'out') ? `<button class="plain" data-ract="tobuy" data-rid="${r.id}">Ajouter le manquant aux courses</button>` : ''}
          <button class="plain" data-ract="edit" data-rid="${r.id}">Modifier</button><button class="plain" data-ract="del" data-rid="${r.id}">Supprimer</button></div></div>`;
      }).join('')
    : '<p class="empty">Aucun plat enregistré.</p>';

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
    if (a === 'edit') { editing = String(editing) === String(p.id) ? null : p.id; render(); $(`form[data-edit="${CSS.escape(String(editing))}"] input[name=qty]`)?.focus(); }
  }
  const head = e.target.closest('.recipe-head');
  if (head) { const id = +head.dataset.rid; openRecipe = openRecipe === id ? null : id; render(); }
  const ract = e.target.dataset.ract, rid = +e.target.dataset.rid;
  if (ract === 'tobuy') call({ action: 'recipe_to_buy', id: rid });
  if (ract === 'del' && confirm('Supprimer ce plat ?')) call({ action: 'delete_recipe', id: rid });
  if (ract === 'edit') {
    const r = data.recipes.find((x) => +x.id === rid), f = $('#recipe-form');
    f.name.value = r.name; f.ingredients.value = r.products.map((i) => byId(i)?.name).join('\n'); f.dataset.id = rid; f.name.focus();
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-edit]');
  if (!f) return;
  e.preventDefault();
  const p = byId(f.dataset.edit);
  const name = f.name.value.trim();
  if (p && name.toLowerCase() !== p.name.toLowerCase() && byName(name)) return toast(`« ${name} » existe déjà.`);
  if (p) call({ action: 'update_product', ...target(p), name: name !== p.name ? name : '', qty: f.qty.value.trim(), note: f.note.value.trim(), category: f.category.value });
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
  const ingredients = f.ingredients.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  call({ action: 'save_recipe', id: +f.dataset.id || 0, name: f.name.value, ingredients });
  f.reset();
  delete f.dataset.id;
});

// import : nettoie chaque ligne (prix, quantités, contenances) en gardant le nom du produit
function clean(line) {
  return line
    .replace(/\d+[.,]\d{2}\s*€?|€\s*\d+[.,]?\d*/g, '')   // prix
    .replace(/\b\d+\s*[x×]\b|\b[x×]\s*\d+\b/gi, '')      // 2x, x2
    .replace(/^\s*\d+\s+(?=\D)/, '')                     // quantité en début de ligne
    .replace(/\s{2,}/g, ' ').replace(/^[\s\-–•*]+|[\s\-–•*]+$/g, '');
}
$('#parse').addEventListener('click', () => {
  const names = [...new Set($('#paste').value.split('\n').map(clean).filter((s) => s.length > 1))];
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
