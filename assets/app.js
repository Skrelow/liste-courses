const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let data = { products: [], recipes: [] };
let openRecipe = null;

async function call(body) {
  const r = await fetch('api.php', body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': window.CSRF }, body: JSON.stringify(body) } : {});
  if (r.status === 401) return (location.href = 'login.php');
  if (!r.ok) return false;
  data = await r.json();
  render();
  return true;
}

const byId = (id) => data.products.find((p) => +p.id === +id);
const ago = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'jamais');

function render() {
  $('#known').innerHTML = data.products.map((p) => `<option value="${esc(p.name)}">`).join('');

  const buy = data.products.filter((p) => p.status === 'buy');
  $('#buy .list').innerHTML = buy.length
    ? buy.map((p) => `<div class="item" data-id="${p.id}"><input type="checkbox" data-act="bought"><span class="n">${esc(p.name)}</span><button class="x" data-act="out" title="Retirer de la liste">✕</button></div>`).join('')
    : '<p class="empty">Rien à acheter 🎉</p>';

  const q = $('#stock .search').value.trim().toLowerCase();
  const rows = data.products.filter((p) => p.status !== 'buy' && p.name.toLowerCase().includes(q));
  $('#stock .list').innerHTML = rows.length
    ? rows.map((p) => `<div class="item" data-id="${p.id}"><span class="n">${esc(p.name)} <small>${p.times_bought ? `acheté ${p.times_bought}× · ${ago(p.last_bought)}` : 'jamais acheté'}</small></span>
        ${p.status === 'stock' ? '<button class="pill ok" data-act="buy">On en a</button>' : '<button class="pill ko" data-act="buy">Manque</button>'}</div>`).join('')
    : '<p class="empty">Aucun produit.</p>';

  $('#plats .list').innerHTML = data.recipes.length
    ? data.recipes.map((r) => {
        const ings = r.products.map(byId).filter(Boolean);
        const missing = ings.filter((p) => p.status !== 'stock');
        const head = `<div class="item recipe-head" data-rid="${r.id}"><span class="n">${esc(r.name)} <small>${missing.length ? `❌ ${missing.length} à avoir` : '✅ tout est là'}</small></span></div>`;
        if (openRecipe !== r.id) return head;
        return head + `<div class="detail">${ings.map((p) => `<div>${p.status === 'stock' ? '✅' : p.status === 'buy' ? '🛒' : '❌'} ${esc(p.name)}</div>`).join('') || '<em>Aucun ingrédient</em>'}
          <div class="row">${missing.some((p) => p.status === 'out') ? `<button class="plain" data-ract="tobuy" data-rid="${r.id}">Ajouter le manquant aux courses</button>` : ''}
          <button class="plain" data-ract="edit" data-rid="${r.id}">Modifier</button><button class="plain" data-ract="del" data-rid="${r.id}">Supprimer</button></div></div>`;
      }).join('')
    : '<p class="empty">Aucun plat enregistré.</p>';
}

// actions sur les produits
document.addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  const row = e.target.closest('.item[data-id]');
  if (act && row) {
    const id = +row.dataset.id, p = byId(id);
    if (act === 'bought') call({ action: 'bought', id });
    if (act === 'out') call({ action: 'set_status', id, status: 'out' });
    if (act === 'buy') call({ action: 'set_status', id, status: p.status === 'stock' ? 'buy' : 'stock' }); // « On en a » → à acheter ; « Manque » → en stock
  }
  const head = e.target.closest('.recipe-head');
  if (head) { const id = +head.dataset.rid; openRecipe = openRecipe === id ? null : id; render(); }
  const ract = e.target.dataset.ract, rid = +e.target.dataset.rid;
  if (ract === 'tobuy') call({ action: 'recipe_to_buy', id: rid });
  if (ract === 'del' && confirm('Supprimer ce plat ?')) call({ action: 'delete_recipe', id: rid });
  if (ract === 'edit') {
    const r = data.recipes.find((x) => x.id == rid), f = $('#recipe-form');
    f.name.value = r.name; f.ingredients.value = r.products.map((i) => byId(i)?.name).join('\n'); f.dataset.id = rid; f.name.focus();
  }
});

// onglets
$$('#tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('main > section').forEach((s) => (s.hidden = s.id !== b.dataset.tab));
}));

$('#buy [data-add]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const i = $('input', e.target);
  if (await call({ action: 'add_product', name: i.value })) { i.value = ''; i.focus(); }
});
$('#stock .search').addEventListener('input', render);

$('#recipe-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const ingredients = f.ingredients.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (await call({ action: 'save_recipe', id: +f.dataset.id || 0, name: f.name.value, ingredients })) { f.reset(); delete f.dataset.id; }
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
$('#confirm-import').addEventListener('click', async () => {
  const names = $$('#preview input:checked').map((i) => i.value);
  if (names.length && await call({ action: 'import', names })) {
    $('#paste').value = ''; $('#preview').innerHTML = ''; $('#confirm-import').hidden = true;
    $('#tabs [data-tab=stock]').click();
  }
});

call();
setInterval(() => document.hidden || call(), 15000);
document.addEventListener('visibilitychange', () => document.hidden || call());
