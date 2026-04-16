'use strict';
/* ============================================================
   promos.js — Page Promos
   ============================================================ */

let promoPage   = 0;
const PROMO_LIMIT = 24;

async function loadPromos(reset = false) {
  if (reset) promoPage = 0;
  const source   = document.getElementById('promoSourceFilter').value;
  const category = document.getElementById('promoCategoryFilter').value;
  const params   = new URLSearchParams({ limit: PROMO_LIMIT, offset: promoPage * PROMO_LIMIT });
  if (source)   params.set('source',   source);
  if (category) params.set('category', category);

  try {
    const data = await API.get(`/promos?${params}`);
    renderPromos(data.data || [], reset);
    renderPagination(data.total, data.offset, data.limit);
  } catch (err) {
    toast(`Erreur promos : ${err.message}`, 'error');
  }
}

function renderPromos(items, reset) {
  const grid = document.getElementById('promoGrid');
  if (reset) grid.innerHTML = '';

  if (!items.length && !grid.children.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">🏷️</div>
        <p>Aucune promo trouvée.<br>Lancez un scraping ou ajustez les filtres.</p>
      </div>`;
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'promo-card';
    const imgEl = item.image_url
      ? `<img class="promo-img" src="${escHtml(item.image_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="promo-img-placeholder">${categoryIcon(item.category)}</div>`;

    card.innerHTML = `
      ${imgEl}
      <div class="promo-body">
        <div class="promo-title">${escHtml(item.title)}</div>
        <div class="promo-price">
          <span class="promo-price-new">${formatPrice(item.price)}</span>
          ${item.original_price ? `<span class="promo-price-old">${formatPrice(item.original_price)}</span>` : ''}
          ${item.discount_percent ? `<span class="promo-badge">-${item.discount_percent}%</span>` : ''}
        </div>
        <div class="promo-source">
          ${escHtml(item.source)} · ${formatDate(item.scraped_at)}
          ${item.url ? `· <a href="${escHtml(item.url)}" target="_blank" rel="noopener">voir</a>` : ''}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
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
    toast(`Scraping terminé : ${res.scraped} articles trouvés, ${res.saved} enregistrés`, 'success');
    loadPromos(true);
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Scraper maintenant';
  }
});

// ── Filtres ───────────────────────────────────────────────────
document.getElementById('promoSourceFilter').addEventListener('change', () => loadPromos(true));
document.getElementById('promoCategoryFilter').addEventListener('change', () => loadPromos(true));

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

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'promos') {
    loadPromoSources();
    loadPromos(true);
  }
});
