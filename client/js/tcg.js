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

// ================================================================
// WISHLIST TCG
// ================================================================

const GAME_LABELS = { pokemon: 'Pokémon', lorcana: 'Lorcana', magic: 'Magic', one_piece: 'One Piece', autre: 'Autre' };
const TYPE_LABELS = {
  carte: '🃏 Carte', booster: '📦 Booster', display: '📦 Display',
  etb: '🎁 ETB', tin: '📦 Tin', coffret: '🎁 Coffret',
  deck: '🗂 Deck', blister: '📦 Blister', bundle: '🎁 Bundle', autre: '🏷️ Autre'
};
const GAME_COLORS = { pokemon: '#f59e0b', lorcana: '#6366f1', magic: '#22c55e', one_piece: '#ef4444', autre: '#64748b' };

async function loadWishlist() {
  const game = document.getElementById('wishlistGameFilter').value;
  const params = game ? `?game=${game}` : '';
  try {
    const items = await API.get(`/tcg/wishlist/prices${params}`);
    renderWishlist(items);
  } catch (err) {
    toast(`Erreur wishlist : ${err.message}`, 'error');
  }
}

function renderWishlist(items) {
  const grid = document.getElementById('tcgWishlistGrid');
  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">⭐</div>
        <p>Wishlist vide.<br>Ajoutez des cartes, boosters, ETB que vous voulez acheter.</p>
      </div>`;
    return;
  }
  grid.innerHTML = items.map(item => {
    const color  = GAME_COLORS[item.game] || '#64748b';
    const offers = item.offers || [];
    const bestOffer = offers[0];
    const overBudget = item.target_price && bestOffer && bestOffer.price > item.target_price;

    return `
      <div class="card" style="border-left:3px solid ${color};padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.9rem;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.name)}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <span class="badge badge-muted" style="font-size:.68rem;background:${color}22;color:${color}">${GAME_LABELS[item.game] || item.game}</span>
              <span class="badge badge-muted" style="font-size:.68rem">${TYPE_LABELS[item.product_type] || item.product_type}</span>
              ${item.set_name ? `<span class="badge badge-muted" style="font-size:.68rem">${escHtml(item.set_name)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="btn-icon" onclick="editWishlistItem(${item.id})" title="Modifier">✏️</button>
            <button class="btn-icon" onclick="deleteWishlistItem(${item.id})" title="Supprimer">🗑</button>
          </div>
        </div>
        ${item.target_price ? `<div style="font-size:.75rem;color:var(--text-muted);margin-bottom:6px">Budget max : <strong style="color:var(--text)">${formatPrice(item.target_price)}</strong></div>` : ''}
        ${offers.length ? `
          <div style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
            <div style="font-size:.7rem;color:var(--text-muted);margin-bottom:4px">Meilleures offres trouvées :</div>
            ${offers.map(o => `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:.78rem;padding:2px 0">
                <span style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${escHtml(o.source)} — ${escHtml(o.title.substring(0,35))}…</span>
                <span style="display:flex;align-items:center;gap:3px;flex-shrink:0">
                  <strong style="color:${overBudget && o === bestOffer ? 'var(--warning)' : 'var(--success)'}">${formatPrice(o.price)}</strong>
                  ${o.discount_percent ? `<span class="promo-badge" style="font-size:.6rem">-${o.discount_percent}%</span>` : ''}
                  ${o.url ? `<a href="${escHtml(o.url)}" target="_blank" rel="noopener" style="font-size:.65rem">→</a>` : ''}
                </span>
              </div>
            `).join('')}
          </div>
        ` : `<div style="font-size:.75rem;color:var(--text-muted);margin-top:4px;padding-top:6px;border-top:1px solid var(--border)">Aucune offre trouvée — lancez un scan catalogue TCG</div>`}
        ${item.notes ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:6px;font-style:italic">${escHtml(item.notes)}</div>` : ''}
      </div>`;
  }).join('');
}

function showWishlistModal(existing = null) {
  const s = existing || {};
  Modal.open(existing ? 'Modifier' : 'Ajouter à la wishlist TCG', `
    <form id="wishlistForm">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Jeu *</label>
          <select name="game" class="select">
            <option value="pokemon"   ${s.game==='pokemon'  ?'selected':''}>Pokémon</option>
            <option value="lorcana"   ${s.game==='lorcana'  ?'selected':''}>Lorcana</option>
            <option value="magic"     ${s.game==='magic'    ?'selected':''}>Magic</option>
            <option value="one_piece" ${s.game==='one_piece'?'selected':''}>One Piece</option>
            <option value="autre"     ${s.game==='autre'    ?'selected':''}>Autre</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Type *</label>
          <select name="product_type" class="select">
            <option value="booster"  ${s.product_type==='booster' ?'selected':''}>📦 Booster</option>
            <option value="display"  ${s.product_type==='display' ?'selected':''}>📦 Display / Booster Box</option>
            <option value="etb"      ${s.product_type==='etb'     ?'selected':''}>🎁 ETB (Elite Trainer Box)</option>
            <option value="coffret"  ${s.product_type==='coffret' ?'selected':''}>🎁 Coffret</option>
            <option value="tin"      ${s.product_type==='tin'     ?'selected':''}>📦 Tin</option>
            <option value="blister"  ${s.product_type==='blister' ?'selected':''}>📦 Blister</option>
            <option value="bundle"   ${s.product_type==='bundle'  ?'selected':''}>🎁 Bundle</option>
            <option value="deck"     ${s.product_type==='deck'    ?'selected':''}>🗂 Deck / Starter</option>
            <option value="carte"    ${s.product_type==='carte'   ?'selected':''}>🃏 Carte</option>
            <option value="autre"    ${s.product_type==='autre'   ?'selected':''}>Autre</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Nom *</label>
        <input name="name" class="input" value="${escHtml(s.name||'')}" placeholder="ex: Booster SV09 - Scarlet &amp; Violet" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Extension / Set</label>
          <input name="set_name" class="input" value="${escHtml(s.set_name||'')}" placeholder="ex: Stellar Crown" />
        </div>
        <div class="form-group">
          <label class="form-label">Budget max (€)</label>
          <input name="target_price" class="input" type="number" step="0.01" value="${s.target_price||''}" placeholder="ex: 6.50" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input name="notes" class="input" value="${escHtml(s.notes||'')}" placeholder="ex: Attendre une promo..." />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </form>
  `);

  document.getElementById('wishlistForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (body.target_price) body.target_price = parseFloat(body.target_price);
    try {
      if (existing) {
        await API.put(`/tcg/wishlist/${existing.id}`, body);
        toast('Mis à jour !', 'success');
      } else {
        await API.post('/tcg/wishlist', body);
        toast('Ajouté à la wishlist !', 'success');
      }
      Modal.close();
      loadWishlist();
    } catch (err) {
      toast(`Erreur : ${err.message}`, 'error');
    }
  });
}

async function editWishlistItem(id) {
  try {
    const items = await API.get('/tcg/wishlist');
    const item  = items.find(i => i.id === id);
    if (item) showWishlistModal(item);
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

async function deleteWishlistItem(id) {
  if (!confirm('Retirer de la wishlist ?')) return;
  try {
    await API.del(`/tcg/wishlist/${id}`);
    toast('Retiré de la wishlist', 'success');
    loadWishlist();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

document.getElementById('addWishlistBtn').addEventListener('click', () => showWishlistModal());
document.getElementById('wishlistGameFilter').addEventListener('change', loadWishlist);
document.getElementById('refreshWishlistPricesBtn').addEventListener('click', loadWishlist);
document.querySelector('[data-tab="tcg-wishlist"]').addEventListener('click', loadWishlist);

window.editWishlistItem   = editWishlistItem;
window.deleteWishlistItem = deleteWishlistItem;
