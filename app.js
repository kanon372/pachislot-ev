'use strict';

// ════════════════════════════════════════════
//  管理者モード（URLに ?admin が含まれる場合）
// ════════════════════════════════════════════

const isAdmin = location.search.includes('admin');

// ════════════════════════════════════════════
//  データ管理
// ════════════════════════════════════════════

const CUSTOM_KEY = 'pachislot_custom_v1';
let allMachines = []; // 共有(JSON) + カスタム(localStorage)

async function loadMachines() {
  let shared = [];
  try {
    const res = await fetch('./machines.json');
    if (res.ok) shared = await res.json();
  } catch {}
  allMachines = [...shared, ...getCustomMachines()];
}

function getCustomMachines() {
  try {
    const d = JSON.parse(localStorage.getItem(CUSTOM_KEY));
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

function addCustomMachine(m) {
  const list = getCustomMachines();
  m.id = 'custom_' + Date.now();
  m.isCustom = true;
  list.push(m);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  allMachines = [...allMachines.filter(x => !x.isCustom), ...list];
}

function deleteCustomMachine(id) {
  const list = getCustomMachines().filter(m => String(m.id) !== String(id));
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  allMachines = allMachines.filter(m => String(m.id) !== String(id));
}

// ════════════════════════════════════════════
//  計算エンジン
// ════════════════════════════════════════════

// 1枚あたりの円価値（交換率ベース、払い出しのみに使用）
const coinYen = rate => 50 / rate;

// 1Gあたりのコスト（円）
// コイン貸し出し料は交換率に関わらず常に5枚/50円=10円/コイン固定
const cpg = hold => (50 / hold) * 10;

// 天井期待値
function calcEV(curG, ceilG, coins, hold, rate) {
  const rem = Math.max(0, ceilG - curG);
  const cost = rem * cpg(hold);
  const pay  = coins * coinYen(rate);
  return {
    ev:   Math.round(pay - cost),
    cost: Math.round(cost),
    pay:  Math.round(pay),
    rem,
    cpg:  Math.round(cpg(hold) * 10) / 10,
  };
}

// グラフ用シリーズ
function evSeries(ceilG, coins, hold, rate) {
  const out = [];
  for (let g = 0; g <= ceilG; g += 50) {
    out.push({ g, ev: calcEV(g, ceilG, coins, hold, rate).ev });
  }
  return out;
}

// 狙い目G数（EVがプラスになる最初のG数）
// 戻り値: 0=常時プラス, 正の数=そのG以降プラス, null=常時マイナス
function profitableG(ceilG, coins, hold, rate) {
  const c   = cpg(hold);
  const pay = coins * coinYen(rate);
  const be  = Math.ceil(ceilG - pay / c);
  if (be < 0)      return 0;
  if (be >= ceilG) return null;
  return be;
}

// ════════════════════════════════════════════
//  ユーティリティ
// ════════════════════════════════════════════

const $ = id => document.getElementById(id);
const fmtYen  = n => (n >= 0 ? '+' : '') + Math.round(n).toLocaleString() + '円';
const fmtAbs  = n => Math.abs(Math.round(n)).toLocaleString() + '円';
const evClass = n => n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu';

// ════════════════════════════════════════════
//  タブ切り替え
// ════════════════════════════════════════════

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'db') renderMachineList();
  });
});

// ════════════════════════════════════════════
//  機種セレクト
// ════════════════════════════════════════════

let currentMachine = null;

function populateSelect() {
  const sel = $('sel-machine');
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- 選択してください --</option>';
  allMachines.forEach(m => {
    const opt = document.createElement('option');
    opt.value = String(m.id);
    opt.textContent = m.name + (m.maker ? `　[${m.maker}]` : '');
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

$('sel-machine').addEventListener('change', e => {
  const id = e.target.value;
  currentMachine = allMachines.find(m => String(m.id) === id) || null;

  const summary = $('machine-summary');
  if (!currentMachine) {
    summary.classList.add('hidden');
    $('btn-calc').disabled = true;
    $('results').classList.add('hidden');
    return;
  }

  const m = currentMachine;
  const czInfo = m.hasCZ && m.czCeiling
    ? `　CZ天井: ${m.czCeiling}G（CZ突入）` : '';
  summary.innerHTML = `
    <strong>${m.name}</strong>　${m.maker || ''}<br>
    機械割: ${m.rateMin}%〜${m.rateMax}%
    天井: ${m.ceiling}G（リセット後 ${m.resetCeiling || '未設定'}G）${czInfo}<br>
    コイン持ち: ${m.coinHold}G/50枚　AT純増: ${m.atGain}枚/G　天井時平均: ${m.ceilingCoins}枚
    ${m.notes ? `<br>📝 ${m.notes}` : ''}
  `;
  summary.classList.remove('hidden');
  $('btn-calc').disabled = false;

  // シャッターオプション表示切り替え
  const shutterOpt = $('shutter-option');
  if (m.shutterCeiling) {
    $('shutter-label').textContent = m.shutterLabel || `シャッター確認済み（${m.shutterCeiling}G天井）`;
    shutterOpt.classList.remove('hidden');
  } else {
    shutterOpt.classList.add('hidden');
    $('shutter-check').checked = false;
  }
});

// ════════════════════════════════════════════
//  交換率カスタム
// ════════════════════════════════════════════

$('sel-rate').addEventListener('change', e => {
  $('inp-custom-rate').classList.toggle('hidden', e.target.value !== 'custom');
});

function getRate() {
  const v = $('sel-rate').value;
  return v === 'custom' ? (parseFloat($('inp-custom-rate').value) || 5.6) : parseFloat(v);
}

// ════════════════════════════════════════════
//  計算・結果表示
// ════════════════════════════════════════════

$('btn-calc').addEventListener('click', () => {
  if (!currentMachine) return;
  const curG = parseInt($('inp-games').value) || 0;
  const rate = getRate();
  const m = currentMachine;

  // シャッターモード判定
  const useShutter = !!(m.shutterCeiling && $('shutter-check').checked);
  const effCeiling = useShutter ? m.shutterCeiling : m.ceiling;
  const effCoins   = useShutter ? m.shutterCoins   : m.ceilingCoins;

  // AT天井EV
  const cev = calcEV(curG, effCeiling, effCoins, m.coinHold, rate);

  // EVカード1：AT天井（またはシャッターモード）
  const cevEl = $('res-ceiling');
  const cevLabel = useShutter ? `シャッター天井期待値（${m.shutterCeiling}G）` : '天井期待値';
  $('res-ceiling').previousElementSibling.textContent = cevLabel;
  cevEl.textContent = fmtYen(cev.ev);
  cevEl.className = 'ev-card-value ' + evClass(cev.ev);
  $('res-ceiling-sub').textContent = `残り${cev.rem}G　投資${fmtAbs(cev.cost)}→回収${fmtAbs(cev.pay)}`;

  // EVカード2：CZ天井 or リセット天井
  const resetLabel = $('res-reset-label');
  const revEl = $('res-reset');
  const rowCzReset = $('row-cz-reset');

  if (m.hasCZ && m.czCeiling) {
    resetLabel.textContent = 'CZ天井期待値';

    if (curG < m.czCeiling) {
      const czev = calcEV(curG, m.czCeiling, m.czAvgCoins, m.coinHold, rate);
      revEl.textContent = fmtYen(czev.ev);
      revEl.className = 'ev-card-value ' + evClass(czev.ev);
      $('res-reset-sub').textContent = `残り${czev.rem}G→${m.czCeiling}G天井　投資${fmtAbs(czev.cost)}`;
    } else {
      revEl.textContent = '天井超過';
      revEl.className = 'ev-card-value neu';
      $('res-reset-sub').textContent = `CZ天井${m.czCeiling}Gは超過済み`;
    }

    if (m.resetCeiling) {
      rowCzReset.style.display = 'flex';
      if (curG < m.resetCeiling) {
        const rrev = calcEV(curG, m.resetCeiling, m.czAvgCoins, m.coinHold, rate);
        $('res-cz-reset').textContent = fmtYen(rrev.ev);
        $('res-cz-reset').className = 'info-value ' + evClass(rrev.ev);
      } else {
        $('res-cz-reset').textContent = '超過済み';
        $('res-cz-reset').className = 'info-value neu';
      }
    } else {
      rowCzReset.style.display = 'none';
    }
  } else {
    // 非CZ機：リセット天井EV
    resetLabel.textContent = 'リセット天井期待値';
    rowCzReset.style.display = 'none';

    const resetCoins = m.resetCeilingCoins ?? m.ceilingCoins;
    const rev = m.resetCeiling
      ? calcEV(curG, m.resetCeiling, resetCoins, m.coinHold, rate)
      : null;
    if (rev) {
      revEl.textContent = fmtYen(rev.ev);
      revEl.className = 'ev-card-value ' + evClass(rev.ev);
      $('res-reset-sub').textContent = `残り${rev.rem}G→${m.resetCeiling}G天井　投資${fmtAbs(rev.cost)}`;
    } else {
      revEl.textContent = '未設定';
      revEl.className = 'ev-card-value neu';
      $('res-reset-sub').textContent = 'リセット後天井G数を登録してください';
    }
  }

  // 狙い目
  const pf = profitableG(effCeiling, effCoins, m.coinHold, rate);
  const pfEl = $('res-profitable');
  if (pf === 0) {
    pfEl.textContent = '0G〜（常時プラス）';
    pfEl.className = 'info-value pos';
  } else if (pf !== null) {
    pfEl.textContent = pf.toLocaleString() + 'G〜';
    pfEl.className = 'info-value pos';
  } else {
    pfEl.textContent = 'なし（常時マイナス）';
    pfEl.className = 'info-value neg';
  }

  $('res-cpg').textContent  = cev.cpg + '円/G';
  $('res-cost').textContent = fmtAbs(cev.cost);
  $('res-pay').textContent  = fmtAbs(cev.pay);

  renderChart(evSeries(effCeiling, effCoins, m.coinHold, rate), curG, pf);

  $('results').classList.remove('hidden');
  setTimeout(() => $('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
});

// ════════════════════════════════════════════
//  グラフ
// ════════════════════════════════════════════

let chart = null;
let chartCurG = 0;
let chartPf = null;

function renderChart(series, curG, pf) {
  chartCurG = curG;
  chartPf = pf;

  const labels = series.map(p => p.g + 'G');
  const values = series.map(p => p.ev);

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update('none');
    return;
  }

  chart = new Chart($('ev-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168,85,247,0.07)',
        fill: true, tension: 0.3,
        pointRadius: 0, pointHoverRadius: 4,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => '期待値: ' + fmtYen(c.parsed.y) } },
      },
      scales: {
        x: { ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } }, grid: { color: '#1e1e35' } },
        y: { ticks: { color: '#64748b', font: { size: 11 }, callback: v => (v >= 0 ? '+' : '') + v.toLocaleString() }, grid: { color: '#1e1e35' } },
      },
    },
    plugins: [
      {
        id: 'zeroline',
        afterDraw(ch) {
          const { ctx, scales: { y } } = ch;
          const yZ = y.getPixelForValue(0);
          ctx.save();
          ctx.strokeStyle = 'rgba(100,116,139,0.4)';
          ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(ch.chartArea.left, yZ); ctx.lineTo(ch.chartArea.right, yZ);
          ctx.stroke(); ctx.restore();
        },
      },
      {
        id: 'curline',
        afterDraw(ch) {
          if (!chartCurG) return;
          const { ctx, scales: { x } } = ch;
          const idx = Math.round(chartCurG / 50);
          if (idx < 0 || idx >= ch.data.labels.length) return;
          const xp = x.getPixelForValue(idx);
          ctx.save();
          ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 2; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(xp, ch.chartArea.top); ctx.lineTo(xp, ch.chartArea.bottom); ctx.stroke();
          ctx.fillStyle = '#ec4899'; ctx.font = 'bold 11px sans-serif';
          ctx.fillText('現在 ' + chartCurG + 'G', xp + 4, ch.chartArea.top + 14);
          ctx.restore();
        },
      },
      {
        id: 'pfline',
        afterDraw(ch) {
          if (chartPf == null) return;
          const { ctx, scales: { x } } = ch;
          const idx = Math.round(chartPf / 50);
          if (idx < 0 || idx >= ch.data.labels.length) return;
          const xp = x.getPixelForValue(idx);
          ctx.save();
          ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
          ctx.beginPath(); ctx.moveTo(xp, ch.chartArea.top); ctx.lineTo(xp, ch.chartArea.bottom); ctx.stroke();
          ctx.fillStyle = '#10b981'; ctx.font = '11px sans-serif';
          ctx.fillText('狙い目 ' + chartPf + 'G', xp + 4, ch.chartArea.top + 28);
          ctx.restore();
        },
      },
    ],
  });
}

// ════════════════════════════════════════════
//  台一覧
// ════════════════════════════════════════════

function renderMachineList() {
  const el = $('machine-list');

  if (allMachines.length === 0) {
    el.innerHTML = '<div class="empty">台データを読み込んでいます...</div>';
    return;
  }

  el.innerHTML = allMachines.map(m => {
    const czLine = m.hasCZ && m.czCeiling
      ? `CZ天井: ${m.czCeiling}G　CZ時平均: ${m.czAvgCoins ?? '?'}枚<br>` : '';
    const deleteBtn = (isAdmin && m.isCustom)
      ? `<button class="btn-danger" onclick="onDelete('${m.id}', '${m.name.replace(/'/g, "\\'")}')">削除</button>`
      : '';
    return `
    <div class="machine-item">
      <div class="machine-item-header">
        <span class="machine-item-name">${m.name}</span>
        ${deleteBtn}
      </div>
      <div class="machine-item-meta">
        ${m.maker || 'メーカー不明'}　／　機械割 ${m.rateMin ?? '?'}%〜${m.rateMax ?? '?'}%<br>
        天井: ${m.ceiling ?? '?'}G　リセット後: ${m.resetCeiling ? m.resetCeiling + 'G' : '未設定'}<br>
        ${czLine}コイン持ち: ${m.coinHold ?? '?'}G/50枚　天井時平均: ${m.ceilingCoins ?? '?'}枚
        ${m.notes ? `<br>📝 ${m.notes}` : ''}
      </div>
    </div>
  `;
  }).join('');
}

function onDelete(id, name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  deleteCustomMachine(id);
  renderMachineList();
  populateSelect();
  if (String(currentMachine?.id) === String(id)) {
    currentMachine = null;
    $('machine-summary').classList.add('hidden');
    $('results').classList.add('hidden');
    $('btn-calc').disabled = true;
    $('sel-machine').value = '';
  }
}

// ════════════════════════════════════════════
//  台を追加（管理者のみ）
// ════════════════════════════════════════════

$('form-add').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const m = {};
  fd.forEach((v, k) => {
    m[k] = ['name', 'maker', 'notes'].includes(k) ? v.trim() : (v !== '' ? parseFloat(v) : null);
  });

  if (!m.name) { showStatus('add-status', '機種名は必須です', 'err'); return; }

  if (m.czCeiling && m.czCeiling > 0) m.hasCZ = true;

  addCustomMachine(m);
  populateSelect();
  showStatus('add-status', `「${m.name}」を登録しました（このブラウザのみ）`, 'ok');
  e.target.reset();
});

function showStatus(id, msg, type) {
  const el = $(id);
  el.textContent = msg;
  el.className = 'status-msg ' + type;
  setTimeout(() => { el.className = 'status-msg'; }, 3000);
}

// ════════════════════════════════════════════
//  起動
// ════════════════════════════════════════════

async function init() {
  // 管理者モード以外は「台を追加」タブを非表示
  if (!isAdmin) {
    const addTab = document.querySelector('[data-tab="add"]');
    if (addTab) addTab.style.display = 'none';
  }

  await loadMachines();
  populateSelect();
}

init();
