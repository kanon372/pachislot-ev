'use strict';

// ════════════════════════════════════════════
//  データ管理（localStorage）
// ════════════════════════════════════════════

const STORAGE_KEY = 'pachislot_machines_v2';

const SEED = [
  {
    id: 1,
    name: 'スマスロ北斗の拳',
    maker: 'サミー',
    rateMin: 98.0, rateMax: 113.0,
    ceiling: 1268, resetCeiling: 800,
    coinHold: 34.7, atGain: 4.1,
    atAvgCoins: 700, ceilingCoins: 833.6,
    notes: '天井到達時は継続率84%以上優遇。設定変更後800G天井。',
  }
];

const GHOUL = {
  id: 2,
  name: 'L東京喰種（東京グール）',
  maker: 'Spiky',
  rateMin: 97.5, rateMax: 114.9,
  ceiling: 1200, resetCeiling: 200,
  coinHold: 31.1, atGain: 4.0,
  atAvgCoins: 415, ceilingCoins: 800,
  hasCZ: true,
  czCeiling: 600,
  czAvgCoins: 322,
  notes: 'CZ天井600G（CZ突入→AT期待度約77%）。AT天井1200G（AT確定）。リセット後200GでCZ天井。',
};

function getMachines() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(d) && d.length > 0) return d;
  } catch {}
  setMachines(SEED);
  return SEED;
}

function setMachines(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function saveMachine(m) {
  const list = getMachines();
  m.id = Date.now();
  list.push(m);
  setMachines(list);
}

function deleteMachine(id) {
  setMachines(getMachines().filter(m => m.id !== id));
}

// 組み込み機種を必要に応じて追加（既存データを消さない）
function initBuiltins() {
  const list = getMachines();
  const ids = new Set(list.map(m => m.id));
  const toAdd = [GHOUL].filter(b => !ids.has(b.id));
  if (toAdd.length > 0) setMachines([...list, ...toAdd]);
}

// ════════════════════════════════════════════
//  計算エンジン
// ════════════════════════════════════════════

// 1枚あたりの円価値 (交換率: 枚/50円)
const coinYen = rate => 50 / rate;

// 1Gあたりのコスト（円）
const cpg = (hold, rate) => (50 / hold) * coinYen(rate);

// 天井期待値
function calcEV(curG, ceilG, coins, hold, rate) {
  const rem = Math.max(0, ceilG - curG);
  const cost = rem * cpg(hold, rate);
  const pay  = coins * coinYen(rate);
  return {
    ev:   Math.round(pay - cost),
    cost: Math.round(cost),
    pay:  Math.round(pay),
    rem,
    cpg:  Math.round(cpg(hold, rate) * 10) / 10,
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
function profitableG(ceilG, coins, hold, rate) {
  const c = cpg(hold, rate);
  const pay = coins * coinYen(rate);
  const be = Math.ceil(ceilG - pay / c);
  return be >= 0 && be < ceilG ? be : null;
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
  getMachines().forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + (m.maker ? `　[${m.maker}]` : '');
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

$('sel-machine').addEventListener('change', e => {
  const id = Number(e.target.value);
  currentMachine = getMachines().find(m => m.id === id) || null;

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

  // AT天井EV
  const cev = calcEV(curG, m.ceiling, m.ceilingCoins, m.coinHold, rate);

  // EVカード1：AT天井
  const cevEl = $('res-ceiling');
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

    // リセット後CZ天井を情報行に表示
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

    const rev = m.resetCeiling
      ? calcEV(curG, m.resetCeiling, m.ceilingCoins, m.coinHold, rate)
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

  // 狙い目（AT天井基準）
  const pf = profitableG(m.ceiling, m.ceilingCoins, m.coinHold, rate);
  const pfEl = $('res-profitable');
  if (pf !== null) {
    pfEl.textContent = pf.toLocaleString() + 'G〜';
    pfEl.className = 'info-value pos';
  } else {
    pfEl.textContent = 'なし（常時マイナス）';
    pfEl.className = 'info-value neg';
  }

  $('res-cpg').textContent  = cev.cpg + '円/G';
  $('res-cost').textContent = fmtAbs(cev.cost);
  $('res-pay').textContent  = fmtAbs(cev.pay);

  // グラフ
  renderChart(evSeries(m.ceiling, m.ceilingCoins, m.coinHold, rate), curG, pf);

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
  const list = getMachines();
  const el = $('machine-list');

  if (list.length === 0) {
    el.innerHTML = '<div class="empty">登録済みの台がありません<br>「台を追加」タブから登録してください</div>';
    return;
  }

  el.innerHTML = list.map(m => {
    const czLine = m.hasCZ && m.czCeiling
      ? `CZ天井: ${m.czCeiling}G　CZ時平均: ${m.czAvgCoins ?? '?'}枚<br>` : '';
    return `
    <div class="machine-item">
      <div class="machine-item-header">
        <span class="machine-item-name">${m.name}</span>
        <button class="btn-danger" onclick="onDelete(${m.id}, '${m.name.replace(/'/g, "\\'")}')">削除</button>
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
  deleteMachine(id);
  renderMachineList();
  populateSelect();
  if (currentMachine?.id === id) {
    currentMachine = null;
    $('machine-summary').classList.add('hidden');
    $('results').classList.add('hidden');
    $('btn-calc').disabled = true;
    $('sel-machine').value = '';
  }
}

// ════════════════════════════════════════════
//  台を追加
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

  saveMachine(m);
  populateSelect();
  showStatus('add-status', `「${m.name}」を登録しました`, 'ok');
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

initBuiltins();
populateSelect();
