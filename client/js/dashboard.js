'use strict';
/* ============================================================
   dashboard.js — Page d'accueil : stats + graphiques
   ============================================================ */

let chartSources = null;
let chartBudget  = null;

async function loadDashboard() {
  try {
    const [promoStats, steamStats, budgetData, tcgData, legoData] = await Promise.allSettled([
      API.get('/promos/stats'),
      API.get('/steam/stats'),
      API.get('/budget/summary'),
      API.get('/tcg/collection'),
      API.get('/lego/stats')
    ]);

    // ── Stat cards ────────────────────────────────────────────
    document.getElementById('statPromosVal').textContent =
      promoStats.status === 'fulfilled' ? promoStats.value.today : '—';
    document.getElementById('statSteamVal').textContent =
      steamStats.status === 'fulfilled' ? steamStats.value.library_count : '—';
    document.getElementById('statTCGVal').textContent =
      tcgData.status === 'fulfilled' ? tcgData.value.count : '—';
    document.getElementById('statLegoVal').textContent =
      legoData.status === 'fulfilled' ? legoData.value.total : '—';

    // ── Top discounts ─────────────────────────────────────────
    if (promoStats.status === 'fulfilled') {
      renderTopDiscounts(promoStats.value.top_discounts || []);
      renderSourcesChart(promoStats.value.by_category || []);
    }

    // ── Budget chart ──────────────────────────────────────────
    if (budgetData.status === 'fulfilled') {
      renderBudgetChart(budgetData.value.summary || []);
    }

    // ── Steam wishlist on sale ────────────────────────────────
    if (steamStats.status === 'fulfilled') {
      renderSteamOnSale(steamStats.value.on_sale || []);
    }
  } catch (err) {
    toast(`Erreur dashboard: ${err.message}`, 'error');
  }
}

function renderTopDiscounts(rows) {
  const tbody = document.getElementById('topDiscountsTbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Aucune promo avec remise</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escHtml(r.title)}</td>
      <td><span class="badge badge-muted">${escHtml(r.source)}</span></td>
      <td>${formatPrice(r.price)}</td>
      <td><span class="badge badge-danger">-${r.discount_percent}%</span></td>
    </tr>
  `).join('');
}

function renderSourcesChart(byCategory) {
  const ctx = document.getElementById('chartSources').getContext('2d');
  const labels = byCategory.map(r => r.category || 'Autre');
  const data   = byCategory.map(r => r.n);

  if (chartSources) chartSources.destroy();
  chartSources = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#6366f1','#a855f7','#22c55e','#f59e0b','#ef4444','#3b82f6'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { color: '#e2e8f0', boxWidth: 12, font: { size: 12 } } }
      }
    }
  });
}

function renderBudgetChart(summary) {
  const ctx = document.getElementById('chartBudget').getContext('2d');
  const labels = summary.map(r => r.category.replace('TCG_', ''));
  const spent  = summary.map(r => r.spent);
  const limits = summary.map(r => r.limit);

  if (chartBudget) chartBudget.destroy();
  chartBudget = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Dépensé', data: spent, backgroundColor: '#6366f1', borderRadius: 4 },
        { label: 'Budget', data: limits, backgroundColor: 'rgba(255,255,255,.1)', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.05)' } },
        y: { ticks: { color: '#64748b', callback: v => v + '€' }, grid: { color: 'rgba(255,255,255,.05)' } }
      },
      plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 12 } } } }
    }
  });
}

function renderSteamOnSale(games) {
  const container = document.getElementById('steamOnSale');
  if (!games.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">Aucun jeu de la wishlist en solde.</p>';
    return;
  }
  container.innerHTML = games.slice(0, 8).map(g => `
    <a class="game-card" href="${escHtml(g.store_url || '#')}" target="_blank" rel="noopener">
      <img src="${escHtml(g.image_url || '')}" alt="" loading="lazy" onerror="this.style.display='none'" />
      <div class="game-card-body">
        <div class="game-card-name">${escHtml(g.name)}</div>
        <div class="game-card-meta">
          <span class="game-card-sale">${formatPrice(g.sale_price || g.price)}</span>
          ${g.discount ? `<span class="game-card-discount">-${g.discount}%</span>` : ''}
        </div>
      </div>
    </a>
  `).join('');
}

// Écoute les changements de page
window.addEventListener('pagechange', (e) => {
  if (e.detail === 'dashboard') loadDashboard();
});
