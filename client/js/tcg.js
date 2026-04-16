'use strict';
/* ============================================================
   tcg.js — Page TCG (Pokémon + Lorcana)
   ============================================================ */

async function loadTCGCollection() {
  const game = document.getElementById('tcgGameFilter').value;
  const params = game ? `?game=${game}` : '';
  try {
    const data = await API.get(`/tcg/collection${params}`);
    renderCollection(data.data || []);
    document.getElementById('tcgSummary').innerHTML = `
      <div class="stat-chip"><strong>${data.count}</strong> cartes</div>
      <div class="stat-chip">Valeur : <strong>${formatPrice(data.total_value)}</strong></div>
    `;
  } catch (err) {
    toast(`Erreur collection TCG : ${err.message}`, 'error');
  }
}

function renderCollection(cards) {
  const tbody = document.getElementById('collectionTbody');
  if (!cards.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Collection vide. Ajoutez des cartes !</td></tr>';
    return;
  }
  tbody.innerHTML = cards.map(c => `
    <tr>
      <td><span class="badge badge-muted">${escHtml(c.game)}</span></td>
      <td>${escHtml(c.set_name || '—')}</td>
      <td>${escHtml(c.card_name)}</td>
      <td>${escHtml(c.rarity || '—')}</td>
      <td>${escHtml(c.condition)}</td>
      <td>${c.quantity}</td>
      <td>${c.market_price ? formatPrice(c.market_price) : '—'}</td>
      <td>
        <button class="btn-icon" onclick="deleteCard(${c.id})" title="Supprimer">🗑</button>
      </td>
    </tr>
  `).join('');
}

async function deleteCard(id) {
  if (!confirm('Supprimer cette carte ?')) return;
  try {
    await API.del(`/tcg/collection/${id}`);
    toast('Carte supprimée', 'success');
    loadTCGCollection();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

// ── Ajouter une carte ─────────────────────────────────────────
document.getElementById('addCardBtn').addEventListener('click', () => {
  Modal.open('Ajouter une carte', `
    <form id="addCardForm">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Jeu *</label>
          <select name="game" class="select" required>
            <option value="pokemon">Pokémon</option>
            <option value="lorcana">Lorcana</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">ID Carte *</label>
          <input name="card_id" class="input" placeholder="ex: sv7-123" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">ID Set</label>
          <input name="set_id" class="input" placeholder="ex: sv7" />
        </div>
        <div class="form-group">
          <label class="form-label">Nom du set</label>
          <input name="set_name" class="input" placeholder="ex: Stellar Crown" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nom de la carte *</label>
        <input name="card_name" class="input" placeholder="ex: Pikachu" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Rareté</label>
          <input name="rarity" class="input" placeholder="ex: Rare Holo" />
        </div>
        <div class="form-group">
          <label class="form-label">État</label>
          <select name="condition" class="select">
            <option value="NM">NM (Near Mint)</option>
            <option value="LP">LP (Light Played)</option>
            <option value="MP">MP (Moderately Played)</option>
            <option value="HP">HP (Heavily Played)</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Quantité</label>
          <input name="quantity" class="input" type="number" value="1" min="1" />
        </div>
        <div class="form-group">
          <label class="form-label">Prix payé (€)</label>
          <input name="price_paid" class="input" type="number" step="0.01" placeholder="0.00" />
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">Ajouter</button>
      </div>
    </form>
  `);

  document.getElementById('addCardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.quantity  = parseInt(body.quantity, 10);
    body.price_paid = body.price_paid ? parseFloat(body.price_paid) : null;
    try {
      await API.post('/tcg/collection', body);
      toast('Carte ajoutée !', 'success');
      Modal.close();
      loadTCGCollection();
    } catch (err) {
      toast(`Erreur : ${err.message}`, 'error');
    }
  });
});

// ── Recherche cartes ──────────────────────────────────────────
document.getElementById('searchCardBtn').addEventListener('click', async () => {
  const game = document.getElementById('searchGame').value;
  const name = document.getElementById('cardSearch').value.trim();
  if (!name) return;

  const container = document.getElementById('cardResults');
  container.innerHTML = '<div class="spinner"></div>';

  try {
    let cards = [];
    if (game === 'pokemon') {
      const data = await API.get(`/tcg/pokemon/cards?name=${encodeURIComponent(name)}`);
      cards = (data.data || []).map(c => ({
        id: c.id, name: c.name, set: c.set?.name, image: c.images?.small,
        rarity: c.rarity, price: c.cardmarket?.prices?.averageSellPrice
      }));
    } else {
      const data = await API.get(`/tcg/lorcana/cards?name=${encodeURIComponent(name)}`);
      cards = (data.results || data || []).map(c => ({
        id: c.id, name: c.name, set: c.set?.name, image: c.image?.thumbnail_url || c.image_url,
        rarity: c.rarity, price: null
      }));
    }

    if (!cards.length) {
      container.innerHTML = '<p style="color:var(--text-muted)">Aucune carte trouvée.</p>';
      return;
    }

    container.innerHTML = cards.slice(0, 40).map(c => `
      <div class="tcg-card" onclick="quickAddCard('${escHtml(game)}','${escHtml(c.id)}','${escHtml(c.name)}','${escHtml(c.set||'')}','${escHtml(c.rarity||'')}')">
        ${c.image ? `<img src="${escHtml(c.image)}" alt="${escHtml(c.name)}" loading="lazy" />` : '<div style="height:120px;background:var(--bg-hover);display:flex;align-items:center;justify-content:center;font-size:2rem">🃏</div>'}
        <div class="tcg-card-body">
          <div class="tcg-card-name">${escHtml(c.name)}</div>
          <div class="tcg-card-set">${escHtml(c.set || '')}</div>
          ${c.price ? `<div class="tcg-card-price">${formatPrice(c.price)}</div>` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger)">Erreur : ${escHtml(err.message)}</p>`;
  }
});

async function quickAddCard(game, cardId, cardName, setName, rarity) {
  try {
    await API.post('/tcg/collection', { game, card_id: cardId, card_name: cardName, set_name: setName, rarity, quantity: 1 });
    toast(`${cardName} ajoutée !`, 'success');
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

// ── Cartes manquantes ─────────────────────────────────────────
document.getElementById('checkMissingBtn').addEventListener('click', async () => {
  const game = document.getElementById('missingGame').value;
  const set  = document.getElementById('missingSet').value.trim();
  if (!set) { toast('Entrez un ID de set', 'info'); return; }

  const results = document.getElementById('missingResults');
  results.innerHTML = '<div class="spinner"></div>';

  try {
    const data = await API.get(`/tcg/missing?game=${game}&set=${encodeURIComponent(set)}`);
    results.innerHTML = `
      <div class="stat-row" style="margin-bottom:12px">
        <div class="stat-chip">Total : <strong>${data.total}</strong></div>
        <div class="stat-chip">Possédées : <strong>${data.owned}</strong></div>
        <div class="stat-chip" style="border-color:var(--danger)">Manquantes : <strong>${data.missing}</strong></div>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>N°</th><th>Carte</th><th>Rareté</th></tr></thead>
          <tbody>
            ${(data.data || []).map(c => `<tr><td>${escHtml(c.number||'—')}</td><td>${escHtml(c.name)}</td><td>${escHtml(c.rarity||'—')}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (err) {
    results.innerHTML = `<p style="color:var(--danger)">Erreur : ${escHtml(err.message)}</p>`;
  }
});

// ── Export CSV ────────────────────────────────────────────────
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const game = document.getElementById('tcgGameFilter').value;
  window.open(`/api/tcg/export${game ? `?game=${game}` : ''}`, '_blank');
});

// ── Filtres ────────────────────────────────────────────────────
document.getElementById('tcgGameFilter').addEventListener('change', loadTCGCollection);

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'tcg') loadTCGCollection();
});

// Exporter globalement
window.deleteCard   = deleteCard;
window.quickAddCard = quickAddCard;
