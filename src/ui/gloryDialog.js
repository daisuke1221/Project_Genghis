// 覇業ダイアログ：勝利条件の進み具合・称号と即位・地域の平定・国力の推移グラフと順位
import { modal, esc, fmt, toast, statBar, confirmBox } from './ui.js';
import { audio } from '../audio/audio.js';
import { PROVINCES, VICTORY_SHARE } from '../game/data.js';
import { nationProvinces } from '../game/state.js';
import {
  REGIONS, regionsHeld, VICTORY_MODES, victoryMode, HEGEMONY_REGIONS, deadlineYear, tierOf, titleName, canClaimTitle, claimTitle, TITLE_REQ,
} from '../game/glory.js';
import { METRICS, METRIC_ORDER, series, ranking } from '../game/history.js';
import { lineChartHtml, bindCharts } from './chart.js';

const TOP = 6;

// 上位の国と自国の推移
export function historyChartHtml(st, metric, top = TOP) {
  const h = st.history;
  if (!h) return '<div class="muted">記録がありません。</div>';
  const nid = st.playerNation;
  const last = (id) => { const v = series(st, id, metric); for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return v[i]; return 0; };
  const ids = Object.keys(h.nations).filter((id) => st.nations[id]).sort((a, b) => last(b) - last(a)).filter((id) => id !== nid).slice(0, top - 1);
  ids.unshift(nid);
  return lineChartHtml({
    labels: h.dates,
    unit: METRICS[metric].unit,
    series: ids.map((id) => ({ name: st.nations[id].name, color: st.nations[id].color, values: series(st, id, metric), bold: id === nid })),
  });
}

export function gloryDialog(app, tab = 'overview') {
  const st = app.st, nid = st.playerNation;
  let metric = 'power';
  return modal({
    title: '覇業',
    width: '860px',
    body: (el) => {
      const render = () => {
        const n = st.nations[nid];
        const tabs = `<div class="metric-tabs"><button class="btn small ${tab === 'overview' ? 'active' : ''}" data-tab="overview">概況・称号</button><button class="btn small ${tab === 'stats' ? 'active' : ''}" data-tab="stats">国力の推移</button></div>`;
        if (tab === 'stats') {
          const rk = ranking(st, metric);
          el.innerHTML = `${tabs}<div class="metric-tabs">${METRIC_ORDER.map((k) => `<button class="btn small ${metric === k ? 'active' : ''}" data-metric="${k}">${METRICS[k].name}</button>`).join('')}</div>
            ${historyChartHtml(st, metric)}
            <p class="muted small">国力＝領地×400＋兵力＋金の収入×4＋人口÷50。上位${TOP - 1}か国と自国を表示しています。線にカーソルを合わせると各季節の値が見られます。</p>
            <table class="list"><tr><th>順位</th><th>勢力</th><th>${METRICS[metric].name}</th><th>称号</th></tr>
            ${rk.slice(0, 12).concat(rk.slice(12).filter((r) => r.nid === nid)).map((r) => `<tr class="${r.nid === nid ? 'sel' : ''}"><td>${rk.indexOf(r) + 1}</td><td><span class="swatch" style="background:${st.nations[r.nid].color}"></span>${esc(st.nations[r.nid].name)}</td><td>${fmt(r.value)}</td><td>${esc(titleName(st, r.nid))}</td></tr>`).join('')}</table>`;
          bindCharts(el);
          return;
        }
        const mode = victoryMode(st);
        const provs = nationProvinces(st, nid).length;
        const need = Math.ceil(PROVINCES.length * VICTORY_SHARE);
        const held = regionsHeld(st, nid);
        let prog = `領地 ${provs}/${need} ${statBar(provs, need, '#d4a94a')}`;
        if (mode === 'hegemony') prog += `<br>平定した地域 ${held.length}/${HEGEMONY_REGIONS} ${statBar(held.length, HEGEMONY_REGIONS, '#7fbf5a')}`;
        if (mode === 'deadline') { const rk = ranking(st).findIndex((r) => r.nid === nid) + 1; prog += `<br>期限 ${deadlineYear(st)}年（あと${deadlineYear(st) - st.year}年）・いまの国力は第${rk}位`; }
        const tier = tierOf(st, nid);
        const av = canClaimTitle(st, nid);
        el.innerHTML = `${tabs}
          <div class="sect"><b>勝利条件：${VICTORY_MODES[mode].name}</b> <span class="muted small">${esc(VICTORY_MODES[mode].desc)}</span><div style="margin-top:4px">${prog}</div></div>
          <div class="sect"><b>称号</b>：${tier ? `<span class="title-tag">${esc(titleName(st, nid))}</span>` : '<span class="muted">なし</span>'}
            <p class="muted small">国が大きくなれば、より高い称号を名乗れます。称号は家臣の忠誠の目標（1段につき+2）と名声（+5）を高め、最高位を名乗ると大国として朝貢を求めるようになりますが、同じ最高位を名乗る国や隣国には警戒されます。</p>
            <table class="list"><tr><th>段</th><th>称号</th><th>必要なもの</th><th></th></tr>
            ${[1, 2, 3].map((t) => `<tr class="${t === tier ? 'sel' : ''}"><td>${t}</td><td>${esc(titleName(st, nid, t))}</td><td class="small">${TITLE_REQ[t].provs}地方${TITLE_REQ[t].regions ? `・${TITLE_REQ[t].regions}地域の平定` : ''}・${fmt(TITLE_REQ[t].cost)}金</td>
              <td>${t <= tier ? '<span class="pos">名乗っている</span>' : t === tier + 1 ? `<button class="btn small" data-claim="1" ${av.ok ? '' : 'disabled'} title="${esc(av.reason ?? '')}">即位する</button>${av.ok ? '' : `<div class="muted small">${esc(av.reason)}</div>`}` : ''}</td></tr>`).join('')}</table></div>
          <div class="sect"><b>地域の平定</b> <span class="muted small">地域のすべての地方を支配すると平定になります。</span>
            <table class="list"><tr><th>地域</th><th>自国の支配</th><th>平定した国</th></tr>
            ${Object.entries(REGIONS).map(([k, R]) => { const mine = R.provs.filter((p) => st.provinces[p].owner === nid).length; const who = st.pacified?.[k]; return `<tr><td>${R.name}</td><td>${mine}/${R.provs.length} ${statBar(mine, R.provs.length, held.includes(k) ? '#7fbf5a' : '#8c6d2c')}</td><td>${who && st.nations[who] ? `<span class="swatch" style="background:${st.nations[who].color}"></span>${esc(st.nations[who].name)}` : '<span class="muted">―</span>'}</td></tr>`; }).join('')}</table></div>`;
      };
      el.onclick = async (e) => {
        const t = e.target.closest('[data-tab]')?.dataset.tab;
        if (t) { tab = t; audio.sfx('click'); render(); return; }
        const m = e.target.closest('[data-metric]')?.dataset.metric;
        if (m) { metric = m; audio.sfx('click'); render(); return; }
        if (e.target.closest('[data-claim]')) {
          const av = canClaimTitle(st, nid);
          if (!await confirmBox('即位', `${av.cost}金を費やして即位の儀を執り行い、「${av.title}」を名乗りますか？`)) return;
          const r = claimTitle(st, nid);
          if (r.ok) { audio.jingle?.('win'); toast(`${r.title}を名乗った！`); } else toast(r.reason);
          render(); app.renderTopbar();
        }
      };
      render();
    },
  });
}
