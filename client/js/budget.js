'use strict';
/* ============================================================
   budget.js — Page Budget
   ============================================================ */

let chartHistory = null;

function initBudgetMonth() {
  const input = document.getElementById('budgetMonth');
  input.value = new Date().toISOString().slice(0, 7);
}

async function loadBudget() {
  const month = document.getElementById('budgetMonth').value;
  try {
    const [summary, purchases] = await Promise.all([
      API.get(`/budget/summary?month=${month}`),
      API.get(`/budget/purchases?month=${month}`)
    ]);
    renderBudgetGrid(summary.summary || []);
    renderPurchasesTable(purchases.data || []);
    renderBudgetHistoryChart(summary.history || []);
  } catch (err) {
    toast(`Erreur budget : ${err.message}`, 'error');
  }
}

function renderBudgetGrid(summary) {
  const grid = document.getElementById('budgetGrid');
  grid.innerHTML = summary.map(s => {
    const pct  = s.limit > 0 ? Math.min((s.spent / s.limit) * 100, 100) : 0;
    const cls  = s.over_budget ? 'budget-over' : pct > 80 ? 'budget-warn' : 'budget-ok';
    const label = s.category.replace('TCG_', 'TCG ');
    return `
      <div class="budget-cat-card ${cls}">
        <div class="budget-cat-name">${label}</div>
        <div class="budget-cat-bar">
          <div class="budget-cat-fill" style="width:${pct}%"></div>
        </div>
        <div class="budget-cat-nums">
          <span>${formatPrice(s.spent)}</span>
          <span>${formatPrice(s.limit)}</span>
        </div>
        ${s.over_budget ? '<div style="color:var(--danger);font-size:.75rem;margin-top:4px">⚠️ Budget dépassé</div>' : ''}
      </div>`;
  }).join('');
}

function renderPurchasesTable(purchases) {
  const tbody = document.getElementById('purchasesTbody');
  if (!purchases.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Aucun achat ce mois-ci.</td></tr>';
    return;
  }
  tbody.innerHTML = purchases.map(p => `
    <tr>
      <td>${formatDate(p.purchase_date)}</td>
      <td>${escHtml(p.name)}</td>
      <td><span class="badge badge-muted">${escHtml(p.category)}</span></td>
      <td>${escHtml(p.store || '—')}</td>
      <td><strong>${formatPrice(p.amount)}</strong></td>
      <td><button class="btn-icon" onclick="deletePurchase(${p.id})" title="Supprimer">🗑</button></td>
    </tr>
  `).join('');
}

function renderBudgetHistoryChart(history) {
  const ctx = document.getElementById('chartBudgetHistory').getContext('2d');
  const months = [...new Set(history.map(r => r.month))].sort();
  const cats   = [...new Set(history.map(r => r.category))];
  const colors = { TCG_Pokemon:'#6366f1', TCG_Lorcana:'#a855f7', Lego:'#f59e0b', JeuxVideo:'#22c55e', JeuxSociete:'#3b82f6' };

  const datasets = cats.map(cat => ({
    label: cat.replace('TCG_','TCG '),
    data: months.map(m => history.find(r => r.month === m && r.category === cat)?.spent || 0),
    backgroundColor: colors[cat] || '#64748b',
    borderRadius: 4,
    stack: 'total'
  }));

  if (chartHistory) chartHistory.destroy();
  chartHistory = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.05)' } },
        y: { stacked: true, ticks: { color: '#64748b', callback: v => v+'€' }, grid: { color: 'rgba(255,255,255,.05)' } }
      },
      plugins: { legend: { labels: { color: '#e2e8f0', font: { size: 12 } } } }
    }
  });
}

// ── Ajouter un achat ──────────────────────────────────────────
document.getElementById('addPurchaseBtn').addEventListener('click', () => {
  Modal.open('Ajouter un achat', `
    <form id="purchaseForm">
      <div class="form-group">
        <label class="form-label">Article *</label>
        <input name="name" class="input" placeholder="ex: Booster Stellar Crown" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Montant (€) *</label>
          <input name="amount" class="input" type="number" step="0.01" placeholder="0.00" required />
        </div>
        <div class="form-group">
          <label class="form-label">Catégorie *</label>
          <select name="category" class="select" required>
            <option value="TCG_Pokemon">TCG Pokémon</option>
            <option value="TCG_Lorcana">TCG Lorcana</option>
            <option value="Lego">Lego</option>
            <option value="JeuxVideo">Jeux Vidéo</option>
            <option value="JeuxSociete">Jeux de Société</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Boutique</label>
          <input name="store" class="input" placeholder="ex: King Jouet" />
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input name="purchase_date" class="input" type="date" value="${new Date().toISOString().slice(0,10)}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input name="notes" class="input" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">Ajouter</button>
      </div>
    </form>
  `);

  document.getElementById('purchaseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.amount = parseFloat(body.amount);
    try {
      await API.post('/budget/purchases', body);
      toast('Achat enregistré !', 'success');
      Modal.close();
      loadBudget();
    } catch (err) {
      toast(`Erreur : ${err.message}`, 'error');
    }
  });
});

async function deletePurchase(id) {
  if (!confirm('Supprimer cet achat ?')) return;
  try {
    await API.del(`/budget/purchases/${id}`);
    toast('Achat supprimé', 'success');
    loadBudget();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

document.getElementById('budgetMonth').addEventListener('change', loadBudget);

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'budget') { initBudgetMonth(); loadBudget(); }
});

window.deletePurchase = deletePurchase;
