'use strict';
/* ============================================================
   promos.js — Page Promos
   ============================================================ */

let promoPage   = 0;
const PROMO_LIMIT = 24;

async function loadPromos() {
  const itemType  = document.getElementById('promoTypeFilter').value;
  const source    = document.getElementById('promoSourceFilter').value;
  const category  = document.getElementById('promoCategoryFilter').value;
  const sort      = document.getElementById('promoSortFilter').value;
  const promoOnly = document.getElementById('promoOnlyFilter').checked ? '1' : '';
  const params    = new URLSearchParams({ limit: PROMO_LIMIT, offset: promoPage * PROMO_LIMIT });
  if (itemType)  params.set('item_type',  itemType);
  if (source)    params.set('source',     source);
  if (category)  params.set('category',   category);
  if (sort)      params.set('sort',       sort);
  if (promoOnly) params.set('promo_only', promoOnly);

  try {
    const data = await API.get(`/promos?${params}`);
    renderPromos(data.data || []);
    renderPagination(data.total, data.offset, data.limit);
  } catch (err) {
    toast(`Erreur promos : ${err.message}`, 'error');
  }
}

function resetAndLoad() { promoPage = 0; loadPromos(); }

const CAT_ICONS = { TCG: '🃏', Lego: '🧱', JeuxVideo: '🎮', JeuxSociete: '♟️' };

function buildPromoCard(item) {
  const catBadge = item.category
    ? `<span style="font-size:.75rem;color:var(--text-muted)">${CAT_ICONS[item.category] || '🏷️'} ${item.category}</span>`
    : '';
  const imgEl = item.image_url
    ? `<img class="promo-img" src="${escHtml(item.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="promo-img-placeholder">${CAT_ICONS[item.category] || '🏷️'}</div>`;
  return `
    <div class="promo-card">
      ${imgEl}
      <div class="promo-body">
        <div class="promo-title">${escHtml(item.title)}</div>
        <div class="promo-price">
          <span class="promo-price-new">${formatPrice(item.price)}</span>
          ${item.original_price ? `<span class="promo-price-old">${formatPrice(item.original_price)}</span>` : ''}
          ${item.discount_percent ? `<span class="promo-badge">-${item.discount_percent}%</span>` : ''}
        </div>
        <div class="promo-source">
          ${catBadge} ${escHtml(item.source)} · ${formatDate(item.scraped_at)}
          ${item.url ? `· <a href="${escHtml(item.url)}" target="_blank" rel="noopener">voir</a>` : ''}
        </div>
      </div>
    </div>`;
}

function renderPromos(items) {
  const grid     = document.getElementById('promoGrid');
  const itemType = document.getElementById('promoTypeFilter').value;
  grid.innerHTML = '';
  if (!items.length) {
    const label  = itemType === 'catalog' ? 'catalogue' : 'promo';
    const action = itemType === 'catalog' ? 'Scanner le catalogue' : 'Lancer un scraping';
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">${itemType === 'catalog' ? '📦' : '🏷️'}</div>
        <p>Aucun article ${label} trouvé.<br>${action} ou ajustez les filtres.</p>
      </div>`;
    return;
  }
  grid.innerHTML = items.map(buildPromoCard).join('');
}

function renderPagination(total, offset, limit) {
  const container = document.getElementById('promoPagination');
  const pages     = Math.ceil(total / limit);
  const current   = Math.floor(offset / limit);
  if (pages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  if (current > 0) html += `<button class="page-btn" data-p="${current - 1}">‹ Préc</button>`;
  for (let i = Math.max(0, current - 2); i <= Math.min(pages - 1, current + 2); i++) {
    html += `<button class="page-btn ${i === current ? 'active' : ''}" data-p="${i}">${i + 1}</button>`;
  }
  if (current < pages - 1) html += `<button class="page-btn" data-p="${current + 1}">Suiv ›</button>`;
  container.innerHTML = html;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => { promoPage = parseInt(btn.dataset.p, 10); loadPromos(); });
  });
}

function categoryIcon(cat) {
  return { TCG: '🃏', Lego: '🧱', JeuxVideo: '🎮', JeuxSociete: '♟️' }[cat] || '🏷️';
}

// ── Scrape manuel ─────────────────────────────────────────────
document.getElementById('scrapeNowBtn').addEventListener('click', async () => {
  const btn = document.getElementById('scrapeNowBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Scraping...';
  try {
    const res = await API.post('/promos/scrape', {});
    toast(`Scraping : ${res.saved} enregistrés${res.deleted ? `, ${res.deleted} expirés supprimés` : ''}`, 'success');
    resetAndLoad();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Scraper maintenant';
  }
});

// ── Scanner catalogue ─────────────────────────────────────────
document.getElementById('scrapeCatalogBtn').addEventListener('click', async () => {
  const btn = document.getElementById('scrapeCatalogBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Scan...';
  try {
    const res = await API.post('/promos/scrape-catalog', {});
    toast(`Catalogue : ${res.saved} enregistrés${res.deleted ? `, ${res.deleted} expirés supprimés` : ''}`, 'success');
    resetAndLoad();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '📦 Scanner catalogue';
  }
});

// ── Vider toute la base ───────────────────────────────────────
document.getElementById('clearAllPromosBtn').addEventListener('click', async () => {
  if (!confirm('Supprimer TOUS les articles scrapés de la base ? Cette action est irréversible.')) return;
  const btn = document.getElementById('clearAllPromosBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Suppression...';
  try {
    const res = await API.del('/promos/all');
    toast(`Base vidée : ${res.deleted} articles supprimés`, 'success');
    resetAndLoad();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🗑️ Vider la base';
  }
});

// ── Filtres ───────────────────────────────────────────────────
document.getElementById('promoTypeFilter').addEventListener('change',    resetAndLoad);
document.getElementById('promoSourceFilter').addEventListener('change',  resetAndLoad);
document.getElementById('promoCategoryFilter').addEventListener('change', resetAndLoad);
document.getElementById('promoSortFilter').addEventListener('change',     resetAndLoad);
document.getElementById('promoOnlyFilter').addEventListener('change',     resetAndLoad);

// Charger les sources disponibles dans le filtre
async function loadPromoSources() {
  try {
    const sources = await API.get('/promos/sources');
    const sel     = document.getElementById('promoSourceFilter');
    sources.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.source;
      opt.textContent = `${s.source} (${s.count})`;
      sel.appendChild(opt);
    });
  } catch (e) { /* silencieux */ }
}

// ── Onglet Gmail : charger au clic ────────────────────────────
document.querySelector('[data-tab="promos-gmail"]').addEventListener('click', loadGmailPromos);

// ── Promos Gmail ───────────────────────────────────────────────
async function loadGmailPromos() {
  const container = document.getElementById('gmailPromoList');
  container.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Chargement...</p>';
  try {
    const items = await API.get('/gmail/promos');
    renderGmailPromos(items);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger);padding:1rem">Erreur : ${err.message}</p>`;
  }
}

const GMAIL_CAT_ICONS = {
  'TCG':         '🃏 TCG',
  'Lego':        '🧱 Lego',
  'JeuxVideo':   '🎮 Jeux Vidéo',
  'JeuxSociete': '♟️ Jeux de Société',
  'VentePrivee': '🏷️ Vente Privée',
  'Général':     '📬 Général',
};

function renderGmailPromos(items) {
  const container = document.getElementById('gmailPromoList');
  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📧</div>
        <p>Aucun email promo trouvé.<br>Clique sur "Scanner Gmail" pour lancer l'analyse.</p>
      </div>`;
    return;
  }

  // Grouper par catégorie
  const groups = {};
  items.forEach(item => {
    const cat = item.category || 'Général';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  const catOrder = ['TCG', 'Lego', 'JeuxVideo', 'JeuxSociete', 'VentePrivee', 'Général'];
  const sortedCats = [...new Set([...catOrder, ...Object.keys(groups)])].filter(c => groups[c]);

  container.innerHTML = sortedCats.map(cat => {
    const catItems = groups[cat];
    const catLabel = GMAIL_CAT_ICONS[cat] || cat;
    const cards = catItems.map(item => {
      const promos = item.extracted_promos || [];
      const badges = promos.map(p => {
        if (p.type === 'discount_pct') {
          return `<span class="promo-badge">${p.max ? `-${p.min}% à -${p.max}%` : `-${p.min}%`}</span>`;
        }
        if (p.type === 'price') {
          return `<span class="promo-badge">${p.sale}€ <s style="opacity:.6">${p.original}€</s></span>`;
        }
        if (p.type === 'brand_sale') {
          return `<span class="badge badge-muted">🏷 ${escHtml(p.brand)}</span>`;
        }
        return '';
      }).join(' ');

      const aiRows = (item.ai_summary || []).map(o => `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:baseline;padding:.2rem 0;font-size:.82rem">
          <span style="font-weight:600">${escHtml(o.produit || '')}</span>
          ${o.prix     ? `<span class="promo-badge">${escHtml(o.prix)}</span>` : ''}
          ${o.remise   ? `<span class="promo-badge" style="background:var(--success)">${escHtml(o.remise)}</span>` : ''}
          ${o.condition ? `<span style="color:var(--text-muted)">${escHtml(o.condition)}</span>` : ''}
          ${o.validite  ? `<span style="color:var(--text-muted);font-style:italic">${escHtml(o.validite)}</span>` : ''}
        </div>`).join('');

      return `
        <div style="padding:.85rem 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;margin-bottom:.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(item.subject)}</div>
              <div style="font-size:.78rem;color:var(--text-muted)">${escHtml(item.sender)} · ${formatDate(item.received_at)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0;flex-wrap:wrap">
              ${badges || ''}
              ${item.gmail_link ? `<a href="${escHtml(item.gmail_link)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.78rem;padding:.25rem .6rem;text-decoration:none">📨 Ouvrir</a>` : ''}
            </div>
          </div>
          ${aiRows ? `<div style="margin-top:.5rem;padding:.5rem .75rem;background:var(--bg);border-radius:6px;border-left:3px solid var(--accent)">${aiRows}</div>` : ''}
        </div>`;
    }).join('');

    const catId = `gmail-cat-${cat.replace(/\s/g,'_')}`;
    return `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none"
             onclick="toggleGmailCat('${catId}')">
          <h3 class="card-title" style="margin:0">${catLabel} <span style="font-weight:400;font-size:.85rem;color:var(--text-muted)">(${catItems.length})</span></h3>
          <span id="${catId}-icon" style="color:var(--text-muted);font-size:1.1rem;transition:transform .2s">▾</span>
        </div>
        <div id="${catId}" style="margin-top:.5rem">${cards}</div>
      </div>`;
  }).join('');
}

function toggleGmailCat(id) {
  const body = document.getElementById(id);
  const icon = document.getElementById(`${id}-icon`);
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  icon.style.transform = collapsed ? '' : 'rotate(-90deg)';
}
window.toggleGmailCat = toggleGmailCat;

document.getElementById('gmailReloadBtn').addEventListener('click', loadGmailPromos);


window.addEventListener('pagechange', (e) => {
  if (e.detail === 'promos') {
    loadPromoSources();
    resetAndLoad();
  }
});
