'use strict';
/* ============================================================
   budget.js — Page Budget
   ============================================================ */

let chartHistory = null;

function initBudgetMonth() {
  const input = document.getElementById('budgetMonth');
  if (!input.value) input.value = new Date().toISOString().slice(0, 7);
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

function renderBudgetTotal(summary) {
  const total_spent = summary.reduce((s, r) => s + r.spent, 0);
  const total_limit = summary.reduce((s, r) => s + r.limit, 0);
  const pct   = total_limit > 0 ? Math.min((total_spent / total_limit) * 100, 100) : 0;
  const color = total_spent > total_limit ? 'var(--danger)' : pct > 80 ? 'var(--warning)' : 'var(--success)';
  document.getElementById('budgetTotal').innerHTML = `
    <div class="card" style="padding:1rem 1.25rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
        <span style="font-weight:600">Budget total du mois</span>
        <span style="font-size:.9rem;color:var(--text-muted)">${formatPrice(total_spent)} / ${formatPrice(total_limit)}</span>
      </div>
      <div style="height:10px;background:var(--border);border-radius:5px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};transition:width .4s"></div>
      </div>
      <div style="text-align:right;font-size:.75rem;color:var(--text-muted);margin-top:4px">${pct.toFixed(0)}% utilisé — restant : ${formatPrice(Math.max(0, total_limit - total_spent))}</div>
    </div>`;
}

function renderBudgetGrid(summary) {
  const grid = document.getElementById('budgetGrid');
  renderBudgetTotal(summary);
  grid.innerHTML = summary.map(s => {
    const pct   = s.limit > 0 ? Math.min((s.spent / s.limit) * 100, 100) : 0;
    const cls   = s.over_budget ? 'budget-over' : pct > 80 ? 'budget-warn' : 'budget-ok';
    const label = s.category.replace('TCG_', 'TCG ');
    return `
      <div class="budget-cat-card ${cls}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="budget-cat-name">${label}</div>
          <button class="btn-icon" onclick="editCategoryLimit('${s.category}', ${s.limit})" title="Modifier le budget">✏️</button>
        </div>
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

// ── Gérer tous les budgets ────────────────────────────────────
const CATEGORIES = [
  { key: 'TCG_Pokemon',  label: 'TCG Pokémon' },
  { key: 'TCG_Lorcana',  label: 'TCG Lorcana' },
  { key: 'Lego',         label: 'Lego' },
  { key: 'JeuxVideo',    label: 'Jeux Vidéo' },
  { key: 'JeuxSociete',  label: 'Jeux de Société' },
];

document.getElementById('editLimitsBtn').addEventListener('click', async () => {
  let limits = {};
  try { limits = Object.fromEntries((await API.get('/budget/limits')).map(l => [l.category, l.monthly_limit])); }
  catch (e) {}

  const inputs = CATEGORIES.map(c => `
    <div class="form-row" style="align-items:center">
      <div class="form-group" style="flex:1.5">
        <label class="form-label">${c.label}</label>
      </div>
      <div class="form-group" style="flex:1">
        <input name="${c.key}" class="input" type="number" step="0.01" min="0"
          value="${limits[c.key] || 0}" placeholder="0.00" />
      </div>
    </div>`).join('');

  const totalCurrent = CATEGORIES.reduce((s, c) => s + (limits[c.key] || 0), 0);

  Modal.open('⚙️ Gérer les budgets mensuels', `
    <form id="limitsForm">
      <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:1rem">
        Budget total actuel : <strong>${formatPrice(totalCurrent)}</strong>
      </p>
      ${inputs}
      <div id="limitsTotal" style="margin:.75rem 0;padding:.75rem;background:var(--bg);border-radius:8px;font-size:.9rem">
        Nouveau total : <strong id="limitsTotalVal">${formatPrice(totalCurrent)}</strong>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);

  // Recalcul total en temps réel
  document.getElementById('limitsForm').querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      const total = CATEGORIES.reduce((s, c) => {
        const v = parseFloat(document.querySelector(`[name="${c.key}"]`)?.value || 0);
        return s + (isNaN(v) ? 0 : v);
      }, 0);
      document.getElementById('limitsTotalVal').textContent = formatPrice(total);
    });
  });

  document.getElementById('limitsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await Promise.all(CATEGORIES.map(c => {
        const val = parseFloat(document.querySelector(`[name="${c.key}"]`).value || 0);
        return API.put(`/budget/limits/${c.key}`, { monthly_limit: val });
      }));
      toast('Budgets mis à jour !', 'success');
      Modal.close();
      loadBudget();
    } catch (err) {
      toast(`Erreur : ${err.message}`, 'error');
    }
  });
});

// ── Modifier un budget individuel ─────────────────────────────
function editCategoryLimit(category, currentLimit) {
  const label = CATEGORIES.find(c => c.key === category)?.label || category;
  Modal.open(`Budget — ${label}`, `
    <form id="oneLimitForm">
      <div class="form-group">
        <label class="form-label">Limite mensuelle (€)</label>
        <input name="monthly_limit" class="input" type="number" step="0.01" min="0"
          value="${currentLimit}" autofocus />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </div>
    </form>
  `);
  document.getElementById('oneLimitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = parseFloat(e.target.monthly_limit.value);
    try {
      await API.put(`/budget/limits/${category}`, { monthly_limit: val });
      toast(`Budget ${label} mis à jour !`, 'success');
      Modal.close();
      loadBudget();
    } catch (err) {
      toast(`Erreur : ${err.message}`, 'error');
    }
  });
}

document.getElementById('budgetMonth').addEventListener('change', loadBudget);
document.getElementById('budgetMonth').addEventListener('input', loadBudget);

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'budget') { initBudgetMonth(); loadBudget(); }
});

window.deletePurchase = deletePurchase;
window.editCategoryLimit = editCategoryLimit;
