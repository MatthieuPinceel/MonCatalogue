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
    renderLegoTable(data.data || [], status);
    document.getElementById('legoStats').innerHTML = `
      <div class="stat-chip"><strong>${data.count}</strong> sets</div>
      <div class="stat-chip">Total payé : <strong>${formatPrice(data.total_paid)}</strong></div>
      <div class="stat-chip">PPC total : <strong>${formatPrice(data.total_retail)}</strong></div>
    `;
    if (status === 'wishlist') loadWishlistPrices();
  } catch (err) {
    toast(`Erreur Lego : ${err.message}`, 'error');
  }
}

function renderLegoTable(sets, status) {
  const tbody = document.getElementById('legoTbody');
  if (!sets.length) {
    const cols = status === 'wishlist' ? 9 : 8;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">${
      status === 'wishlist' ? 'Wishlist vide. Ajoutez des sets !' : 'Collection vide. Ajoutez un set !'
    }</td></tr>`;
    return;
  }
  const showPriceCol = status === 'wishlist';
  tbody.innerHTML = sets.map(s => `
    <tr>
      <td><strong>${escHtml(s.set_number)}</strong></td>
      <td>
        ${s.image_url ? `<img src="${escHtml(s.image_url)}" style="height:40px;border-radius:4px;vertical-align:middle;margin-right:6px">` : ''}
        ${escHtml(s.name)}
      </td>
      <td>${escHtml(s.theme || '—')}</td>
      <td>${s.pieces || '—'}</td>
      <td>${formatPrice(s.price_paid)}</td>
      <td>${formatPrice(s.retail_price)}</td>
      <td>${formatDate(s.date_added)}</td>
      ${showPriceCol ? `<td id="offers-${s.id}"><span style="color:var(--text-muted);font-size:.75rem">...</span></td>` : ''}
      <td>
        <button class="btn-icon" onclick="editLego(${s.id})" title="Modifier">✏️</button>
        <button class="btn-icon" onclick="deleteLego(${s.id})" title="Supprimer">🗑</button>
      </td>
    </tr>
  `).join('');

  // Mettre à jour le thead si wishlist
  const thead = document.querySelector('#legoTable thead tr');
  if (status === 'wishlist' && !document.getElementById('th-offers')) {
    const th = document.createElement('th');
    th.id = 'th-offers';
    th.textContent = 'Meilleures offres';
    thead.insertBefore(th, thead.lastElementChild);
  } else if (status !== 'wishlist') {
    const th = document.getElementById('th-offers');
    if (th) th.remove();
  }
}

async function loadWishlistPrices() {
  try {
    const items = await API.get('/lego/wishlist/prices');
    items.forEach(item => {
      const cell = document.getElementById(`offers-${item.id}`);
      if (!cell) return;
      if (!item.offers.length) {
        cell.innerHTML = `<span style="color:var(--text-muted);font-size:.75rem">Aucune offre</span>`;
        return;
      }
      cell.innerHTML = item.offers.map(o => `
        <div style="font-size:.75rem;margin-bottom:2px">
          <span style="color:var(--success);font-weight:700">${formatPrice(o.price)}</span>
          ${o.discount_percent ? `<span class="promo-badge" style="font-size:.6rem">-${o.discount_percent}%</span>` : ''}
          <span style="color:var(--text-muted)"> — ${escHtml(o.source)}</span>
          ${o.url ? `<a href="${escHtml(o.url)}" target="_blank" rel="noopener" style="margin-left:4px;font-size:.65rem">voir</a>` : ''}
        </div>
      `).join('');
    });
  } catch (e) { /* silencieux */ }
}

// ── Ajouter un set ────────────────────────────────────────────
document.getElementById('addLegoBtn').addEventListener('click', () => showLegoModal());

function showLegoModal(existing = null) {
  const title = existing ? 'Modifier le set' : 'Ajouter un set Lego';
  const s = existing || {};
  Modal.open(title, `
    <form id="legoForm">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">N° de set *</label>
          <div style="display:flex;gap:6px">
            <input name="set_number" id="legoSetNumber" class="input" value="${escHtml(s.set_number||'')}" placeholder="ex: 42170" required />
            <button type="button" class="btn btn-secondary btn-sm" id="legoLookupBtn" title="Chercher sur Rebrickable">🔍</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Thème</label>
          <input name="theme" id="legoTheme" class="input" value="${escHtml(s.theme||'')}" placeholder="ex: Technic" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nom *</label>
        <input name="name" id="legoName" class="input" value="${escHtml(s.name||'')}" placeholder="Nom du set" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Pièces</label>
          <input name="pieces" id="legoPieces" class="input" type="number" value="${s.pieces||''}" />
        </div>
        <div class="form-group">
          <label class="form-label">Statut</label>
          <select name="status" class="select">
            <option value="owned"    ${!s.status||s.status==='owned'   ?'selected':''}>Possédé</option>
            <option value="wishlist" ${s.status==='wishlist'?'selected':''}>Wishlist</option>
            <option value="sold"     ${s.status==='sold'    ?'selected':''}>Vendu</option>
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
          <input name="retail_price" id="legoRetailPrice" class="input" type="number" step="0.01" value="${s.retail_price||''}" />
        </div>
      </div>
      <div id="legoLookupImg" style="text-align:center;margin-bottom:8px"></div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input name="notes" class="input" value="${escHtml(s.notes||'')}" />
      </div>
      <input type="hidden" name="image_url" id="legoImageUrl" value="${escHtml(s.image_url||'')}" />
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>
  `);

  // Rebrickable auto-fill
  document.getElementById('legoLookupBtn').addEventListener('click', () => lookupLegoSet());
  document.getElementById('legoSetNumber').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookupLegoSet(); } });

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
  }, { once: true });
}

async function lookupLegoSet() {
  const btn = document.getElementById('legoLookupBtn');
  const num = document.getElementById('legoSetNumber').value.trim();
  if (!num) return;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const data = await API.get(`/lego/lookup/${num}`);
    if (data.name)         document.getElementById('legoName').value        = data.name;
    if (data.pieces)       document.getElementById('legoPieces').value      = data.pieces;
    if (data.retail_price) document.getElementById('legoRetailPrice').value = data.retail_price;
    if (data.image_url) {
      document.getElementById('legoImageUrl').value = data.image_url;
      document.getElementById('legoLookupImg').innerHTML =
        `<img src="${escHtml(data.image_url)}" style="max-height:80px;border-radius:6px">`;
    }
    toast(`Set trouvé : ${data.name}`, 'success');
  } catch (err) {
    toast(err.message === 'Set non trouvé' ? `Set ${num} introuvable sur Rebrickable` : `Erreur Rebrickable : ${err.message}`, 'error');
  } finally {
    btn.textContent = '🔍';
    btn.disabled = false;
  }
}

async function editLego(id) {
  try {
    const data = await API.get('/lego/collection?status=owned');
    let set = (data.data || []).find(s => s.id === id);
    if (!set) {
      const w = await API.get('/lego/collection?status=wishlist');
      set = (w.data || []).find(s => s.id === id);
    }
    if (!set) {
      const sold = await API.get('/lego/collection?status=sold');
      set = (sold.data || []).find(s => s.id === id);
    }
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
document.getElementById('legoThemeFilter').addEventListener('input', () => {
  clearTimeout(window._legoTimeout);
  window._legoTimeout = setTimeout(loadLego, 400);
});

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'lego') loadLego();
});

window.editLego   = editLego;
window.deleteLego = deleteLego;
