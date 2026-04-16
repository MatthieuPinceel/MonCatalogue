'use strict';
/* ============================================================
   lego.js — Page Lego
   ============================================================ */

async function loadLego() {
  const status = document.getElementById('legoStatusFilter').value;
  const theme  = document.getElementById('legoThemeFilter').value;
  const params = new URLSearchParams({ status });
  if (theme) params.set('theme', theme);

  try {
    const data = await API.get(`/lego/collection?${params}`);
    renderLegoTable(data.data || []);
    document.getElementById('legoStats').innerHTML = `
      <div class="stat-chip"><strong>${data.count}</strong> sets</div>
      <div class="stat-chip">Total payé : <strong>${formatPrice(data.total_paid)}</strong></div>
      <div class="stat-chip">PPC total : <strong>${formatPrice(data.total_retail)}</strong></div>
    `;
  } catch (err) {
    toast(`Erreur Lego : ${err.message}`, 'error');
  }
}

function renderLegoTable(sets) {
  const tbody = document.getElementById('legoTbody');
  if (!sets.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Collection vide. Ajoutez un set !</td></tr>';
    return;
  }
  tbody.innerHTML = sets.map(s => `
    <tr>
      <td><strong>${escHtml(s.set_number)}</strong></td>
      <td>${escHtml(s.name)}</td>
      <td>${escHtml(s.theme || '—')}</td>
      <td>${s.pieces || '—'}</td>
      <td>${formatPrice(s.price_paid)}</td>
      <td>${formatPrice(s.retail_price)}</td>
      <td>${formatDate(s.date_added)}</td>
      <td>
        <button class="btn-icon" onclick="editLego(${s.id})" title="Modifier">✏️</button>
        <button class="btn-icon" onclick="deleteLego(${s.id})" title="Supprimer">🗑</button>
      </td>
    </tr>
  `).join('');
}

// ── Ajouter un set ────────────────────────────────────────────
document.getElementById('addLegoBtn').addEventListener('click', () => {
  showLegoModal();
});

function showLegoModal(existing = null) {
  const title = existing ? 'Modifier le set' : 'Ajouter un set Lego';
  const s = existing || {};
  Modal.open(title, `
    <form id="legoForm">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">N° de set *</label>
          <input name="set_number" class="input" value="${escHtml(s.set_number||'')}" placeholder="ex: 42170" required />
        </div>
        <div class="form-group">
          <label class="form-label">Thème</label>
          <input name="theme" class="input" value="${escHtml(s.theme||'')}" placeholder="ex: Technic" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nom *</label>
        <input name="name" class="input" value="${escHtml(s.name||'')}" placeholder="Nom du set" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Pièces</label>
          <input name="pieces" class="input" type="number" value="${s.pieces||''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Statut</label>
          <select name="status" class="select">
            <option value="owned" ${!s.status||s.status==='owned'?'selected':''}>Possédé</option>
            <option value="wishlist" ${s.status==='wishlist'?'selected':''}>Wishlist</option>
            <option value="sold" ${s.status==='sold'?'selected':''}>Vendu</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Prix payé (€)</label>
          <input name="price_paid" class="input" type="number" step="0.01" value="${s.price_paid||''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Prix catalogue (€)</label>
          <input name="retail_price" class="input" type="number" step="0.01" value="${s.retail_price||''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input name="notes" class="input" value="${escHtml(s.notes||'')}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>
  `);

  document.getElementById('legoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    if (body.pieces)       body.pieces       = parseInt(body.pieces, 10);
    if (body.price_paid)   body.price_paid   = parseFloat(body.price_paid);
    if (body.retail_price) body.retail_price = parseFloat(body.retail_price);

    try {
      if (existing) {
        await API.put(`/lego/collection/${existing.id}`, body);
        toast('Set mis à jour !', 'success');
      } else {
        await API.post('/lego/collection', body);
        toast('Set ajouté !', 'success');
      }
      Modal.close();
      loadLego();
    } catch (err) {
      toast(`Erreur : ${err.message}`, 'error');
    }
  });
}

async function editLego(id) {
  try {
    const data = await API.get('/lego/collection');
    const set  = data.data.find(s => s.id === id);
    if (set) showLegoModal(set);
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

async function deleteLego(id) {
  if (!confirm('Supprimer ce set ?')) return;
  try {
    await API.del(`/lego/collection/${id}`);
    toast('Set supprimé', 'success');
    loadLego();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

document.getElementById('legoStatusFilter').addEventListener('change', loadLego);
document.getElementById('legoThemeFilter').addEventListener('input',  () => { clearTimeout(window._legoTimeout); window._legoTimeout = setTimeout(loadLego, 400); });

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'lego') loadLego();
});

window.editLego   = editLego;
window.deleteLego = deleteLego;
