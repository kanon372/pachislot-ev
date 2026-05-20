'use strict';

// ════════════════════════════════════════════
//  管理者モード（URLに ?admin が含まれる場合）
// ════════════════════════════════════════════

const isAdmin = location.search.includes('admin');

// ════════════════════════════════════════════
//  データ管理
// ════════════════════════════════════════════

const CUSTOM_KEY    = 'pachislot_custom_v1';
const SESSIONS_KEY  = 'pachislot_sessions_v1';
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
//  実践記録管理
// ════════════════════════════════════════════

function getSessions() {
  try {
    const d = JSON.parse(localStorage.getItem(SESSIONS_KEY));
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

function addSession(s) {
  const list = getSessions();
  s.id = 'session_' + Date.now();
  list.push(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
}

function deleteSession(id) {
  const list = getSessions().filter(s => s.id !== id);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
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
    if (tab.dataset.tab === 'log') { renderLogDashboard(); renderSessionList(); }
  });
});

// ════════════════════════════════════════════
//  機種セレクト
// ════════════════════════════════════════════

let currentMachine = null;
let currentUnit = 'G';
let chartUnit = 'G';

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
  currentUnit = m.gameUnit || 'G';
  const labelGames = $('label-games');
  if (labelGames) labelGames.textContent = `現在の${currentUnit}数`;
  const czInfo = m.hasCZ && m.czCeiling
    ? `　CZ天井: ${m.czCeiling}${currentUnit}（CZ突入）` : '';
  summary.innerHTML = `
    <strong>${m.name}</strong>　${m.maker || ''}<br>
    機械割: ${m.rateMin}%〜${m.rateMax}%
    天井: ${m.ceiling}${currentUnit}（リセット後 ${m.resetCeiling || '未設定'}${currentUnit}）${czInfo}<br>
    コイン持ち: ${m.coinHold}${currentUnit}/50枚　AT純増: ${m.atGain}枚/${currentUnit}　天井時平均: ${m.ceilingCoins}枚
    ${m.notes ? `<br>📝 ${m.notes}` : ''}
  `;
  summary.classList.remove('hidden');
  $('btn-calc').disabled = false;

  // シャッターオプション表示切り替え
  const shutterOpt = $('shutter-option');
  if (m.shutterCeiling) {
    $('shutter-label').textContent = m.shutterLabel || `シャッター確認済み（${m.shutterCeiling}${currentUnit}天井）`;
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
  const cevLabel = useShutter ? `シャッター天井期待値（${m.shutterCeiling}${currentUnit}）` : '天井期待値';
  $('res-ceiling').previousElementSibling.textContent = cevLabel;
  cevEl.textContent = fmtYen(cev.ev);
  cevEl.className = 'ev-card-value ' + evClass(cev.ev);
  $('res-ceiling-sub').textContent = `残り${cev.rem}${currentUnit}　投資${fmtAbs(cev.cost)}→回収${fmtAbs(cev.pay)}`;

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
      $('res-reset-sub').textContent = `残り${czev.rem}${currentUnit}→${m.czCeiling}${currentUnit}天井　投資${fmtAbs(czev.cost)}`;
    } else {
      revEl.textContent = '天井超過';
      revEl.className = 'ev-card-value neu';
      $('res-reset-sub').textContent = `CZ天井${m.czCeiling}${currentUnit}は超過済み`;
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
      $('res-reset-sub').textContent = `残り${rev.rem}${currentUnit}→${m.resetCeiling}${currentUnit}天井　投資${fmtAbs(rev.cost)}`;
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
    pfEl.textContent = '0' + currentUnit + '〜（常時プラス）';
    pfEl.className = 'info-value pos';
  } else if (pf !== null) {
    pfEl.textContent = pf.toLocaleString() + currentUnit + '〜';
    pfEl.className = 'info-value pos';
  } else {
    pfEl.textContent = 'なし（常時マイナス）';
    pfEl.className = 'info-value neg';
  }

  $('res-cpg').textContent  = cev.cpg + '円/' + currentUnit;
  $('res-cost').textContent = fmtAbs(cev.cost);
  $('res-pay').textContent  = fmtAbs(cev.pay);

  renderChart(evSeries(effCeiling, effCoins, m.coinHold, rate), curG, pf, currentUnit);

  $('results').classList.remove('hidden');
  setTimeout(() => $('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
});

// ════════════════════════════════════════════
//  グラフ
// ════════════════════════════════════════════

let chart = null;
let chartCurG = 0;
let chartPf = null;

function renderChart(series, curG, pf, unit = 'G') {
  chartCurG = curG;
  chartPf = pf;
  chartUnit = unit;

  const labels = series.map(p => p.g + unit);
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
          ctx.fillText('現在 ' + chartCurG + chartUnit, xp + 4, ch.chartArea.top + 14);
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
          ctx.fillText('狙い目 ' + chartPf + chartUnit, xp + 4, ch.chartArea.top + 28);
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
    const u = m.gameUnit || 'G';
    const czLine = m.hasCZ && m.czCeiling
      ? `CZ天井: ${m.czCeiling}${u}　CZ時平均: ${m.czAvgCoins ?? '?'}枚<br>` : '';
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
        天井: ${m.ceiling ?? '?'}${u}　リセット後: ${m.resetCeiling ? m.resetCeiling + u : '未設定'}<br>
        ${czLine}コイン持ち: ${m.coinHold ?? '?'}${u}/50枚　天井時平均: ${m.ceilingCoins ?? '?'}枚
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
//  実践記録 描画
// ════════════════════════════════════════════

function renderLogDashboard() {
  const sessions = getSessions();
  const el = $('log-dashboard');
  if (!el) return;

  if (sessions.length === 0) {
    el.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted);padding:24px">まだ記録がありません<br>下のフォームから記録を追加してください</div>';
    return;
  }

  const totalActual = sessions.reduce((s, r) => s + r.actualEV, 0);
  const totalTheory = sessions.reduce((s, r) => s + (r.theoreticalEV ?? 0), 0);
  const gap = totalActual - totalTheory;

  // 機種別集計
  const byMachine = {};
  sessions.forEach(r => {
    if (!byMachine[r.machineName]) byMachine[r.machineName] = { count: 0, actual: 0, payouts: [] };
    byMachine[r.machineName].count++;
    byMachine[r.machineName].actual += r.actualEV;
    if (r.payout > 0) byMachine[r.machineName].payouts.push(r.payout);
  });

  // 精度チェック（実績回収 vs 設定値）
  const calibRows = Object.entries(byMachine).map(([name, s]) => {
    const machine = allMachines.find(m => m.name === name);
    const avgPayout = s.payouts.length > 0
      ? Math.round(s.payouts.reduce((a, b) => a + b, 0) / s.payouts.length)
      : null;
    const theory = machine ? Math.round(machine.ceilingCoins * coinYen(5.6)) : null;
    const diff = (avgPayout != null && theory != null) ? avgPayout - theory : null;
    return `
      <div class="info-row">
        <span class="info-label" style="font-size:11px;flex:1">${name.replace(/（.*?）/, '')}<br>
          <span style="color:var(--text-muted);font-size:10px">${name.match(/（.*?）/)?.[0] ?? ''}</span>
        </span>
        <span class="info-value" style="font-size:12px;text-align:right">
          ${s.count}回　平均${fmtYen(Math.round(s.actual / s.count))}
          ${diff != null ? `<br><span style="color:var(--text-muted);font-size:10px">回収実績 ${avgPayout?.toLocaleString()}円 / 理論 ${theory?.toLocaleString()}円（差${diff >= 0 ? '+' : ''}${diff?.toLocaleString()}円）</span>` : ''}
        </span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="ev-cards">
      <div class="ev-card">
        <div class="ev-card-label">累計損益（実際）</div>
        <div class="ev-card-value ${evClass(totalActual)}">${fmtYen(totalActual)}</div>
        <div class="ev-card-sub">${sessions.length}回のプレイ</div>
      </div>
      <div class="ev-card">
        <div class="ev-card-label">累計EV（理論）</div>
        <div class="ev-card-value ${evClass(totalTheory)}">${fmtYen(totalTheory)}</div>
        <div class="ev-card-sub">EV通りなら${fmtYen(totalTheory)}</div>
      </div>
    </div>
    <div class="card info-card">
      <div class="info-row">
        <span class="info-label">理論との乖離</span>
        <span class="info-value ${evClass(gap)}">${fmtYen(gap)}</span>
      </div>
      <div class="info-row">
        <span class="info-label" style="color:var(--text-muted);font-size:11px">
          ${gap >= 0 ? '理論より運が良い状態です' : '理論より運が悪い状態です（長期では収束します）'}
        </span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">台別実績・精度チェック</div>
      ${calibRows}
    </div>
  `;
}

function renderSessionList() {
  const sessions = getSessions().slice().reverse();
  const el = $('log-list');
  if (!el) return;

  if (sessions.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="card">
      <h2 class="card-title">記録一覧</h2>
      ${sessions.map(s => `
        <div class="machine-item">
          <div class="machine-item-header">
            <span class="machine-item-name" style="font-size:12px">${s.machineName}</span>
            <button class="btn-danger" onclick="onDeleteSession('${s.id}')">削除</button>
          </div>
          <div class="machine-item-meta">
            ${s.date}　開始: ${s.startG}${s.gameUnit || 'G'}　交換率: ${s.rate}枚<br>
            投資 ${s.investment.toLocaleString()}円 → 回収 ${s.payout.toLocaleString()}円
            <strong class="${evClass(s.actualEV)}">${fmtYen(s.actualEV)}</strong>
            ${s.theoreticalEV != null ? `　<span style="color:var(--text-muted);font-size:11px">（理論 ${fmtYen(s.theoreticalEV)}）</span>` : ''}
            ${s.note ? `<br>📝 ${s.note}` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function onDeleteSession(id) {
  if (!confirm('この記録を削除しますか？')) return;
  deleteSession(id);
  renderLogDashboard();
  renderSessionList();
}

// 実践記録フォーム
function populateLogSelect() {
  const sel = $('log-machine');
  if (!sel) return;
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

function updateLogPreview() {
  const machineId = $('log-machine')?.value;
  const investment = parseFloat($('log-investment')?.value);
  const payout = parseFloat($('log-payout')?.value) || 0;
  const startG = parseInt($('log-start-g')?.value) || 0;
  const rate = parseFloat($('log-rate')?.value) || 5.6;
  const preview = $('log-preview');
  if (!preview) return;

  if (isNaN(investment)) { preview.classList.add('hidden'); return; }

  preview.classList.remove('hidden');
  const actualEV = payout - investment;
  $('log-prev-ev').textContent = fmtYen(actualEV);
  $('log-prev-ev').className = 'info-value ' + evClass(actualEV);

  const machine = allMachines.find(m => String(m.id) === machineId);
  if (machine) {
    const theory = calcEV(startG, machine.ceiling, machine.ceilingCoins, machine.coinHold, rate).ev;
    $('log-prev-theory').textContent = fmtYen(theory);
    $('log-prev-theory').className = 'info-value ' + evClass(theory);
  } else {
    $('log-prev-theory').textContent = '--';
    $('log-prev-theory').className = 'info-value';
  }
}

['log-machine', 'log-investment', 'log-payout', 'log-start-g', 'log-rate'].forEach(id => {
  $(`${id}`)?.addEventListener('input', updateLogPreview);
  $(`${id}`)?.addEventListener('change', updateLogPreview);
});

$('form-log')?.addEventListener('submit', e => {
  e.preventDefault();
  const machineId = $('log-machine').value;
  const machine = allMachines.find(m => String(m.id) === machineId);
  if (!machine) { showStatus('log-status', '台を選択してください', 'err'); return; }

  const investment = parseFloat($('log-investment').value);
  const payout = parseFloat($('log-payout').value) || 0;
  const startG = parseInt($('log-start-g').value) || 0;
  const rate = parseFloat($('log-rate').value) || 5.6;

  if (isNaN(investment)) { showStatus('log-status', '投資額を入力してください', 'err'); return; }

  const theoreticalEV = calcEV(startG, machine.ceiling, machine.ceilingCoins, machine.coinHold, rate).ev;

  addSession({
    date: $('log-date').value || new Date().toISOString().slice(0, 10),
    machineId: String(machine.id),
    machineName: machine.name,
    gameUnit: machine.gameUnit || 'G',
    startG, rate, investment, payout,
    actualEV: payout - investment,
    theoreticalEV,
    note: $('log-note').value.trim(),
  });

  renderLogDashboard();
  renderSessionList();
  showStatus('log-status', '記録しました', 'ok');
  e.target.reset();
  $('log-date').value = new Date().toISOString().slice(0, 10);
  $('log-preview').classList.add('hidden');
});

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
  // 管理者モード以外は管理者専用タブを非表示
  if (!isAdmin) {
    ['add', 'log'].forEach(key => {
      const tab = document.querySelector(`[data-tab="${key}"]`);
      if (tab) tab.style.display = 'none';
    });
  }

  await loadMachines();
  populateSelect();
  populateLogSelect();

  // 実践記録フォームの日付を今日に設定
  const logDate = $('log-date');
  if (logDate) logDate.value = new Date().toISOString().slice(0, 10);
}

init();
