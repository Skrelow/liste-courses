const $ = (s) => document.querySelector(s);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let items = [];

async function call(body) {
  const r = await fetch('api.php', body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': window.CSRF }, body: JSON.stringify(body) } : {});
  if (r.status === 401) return (location.href = 'login.php');
  if (!r.ok) return;
  items = (await r.json()).items;
  render();
}

function render() {
  const list = $('#list');
  if (!items.length) { list.innerHTML = '<p class="empty">La liste est vide 🎉</p>'; $('#clear').hidden = true; return; }
  let html = '';
  for (const [key, [label, emoji]] of Object.entries(window.AISLES)) {
    const rows = items.filter((i) => i.aisle === key);
    if (!rows.length) continue;
    html += `<div class="aisle">${emoji} ${esc(label)}</div>`;
    for (const i of rows) {
      html += `<div class="item ${+i.done ? 'done' : ''}" data-id="${i.id}"><input type="checkbox" ${+i.done ? 'checked' : ''}>
        <span class="n">${esc(i.name)} ${i.qty ? `<small>× ${esc(i.qty)}</small>` : ''}</span><button class="x" aria-label="Supprimer">✕</button></div>`;
    }
  }
  list.innerHTML = html;
  $('#clear').hidden = !items.some((i) => +i.done);
}

$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#name').value.trim();
  if (!name) return;
  call({ action: 'add', name, qty: $('#qty').value, aisle: $('#aisle').value });
  $('#name').value = ''; $('#qty').value = ''; $('#name').focus();
});
$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.item');
  if (!row) return;
  const id = +row.dataset.id;
  if (e.target.closest('.x')) call({ action: 'delete', id });
  else if (e.target.matches('input')) call({ action: 'toggle', id });
});
$('#clear').addEventListener('click', () => call({ action: 'clear_done' }));

call();
setInterval(() => document.hidden || call(), 15000); // la liste de l'autre personne apparaît toute seule
document.addEventListener('visibilitychange', () => document.hidden || call());
