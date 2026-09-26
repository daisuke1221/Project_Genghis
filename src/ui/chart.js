// 折れ線グラフ（SVG）：国ごとの推移。色は各国の地図の色（国を識別する色）をそのまま使う
import { esc, fmt } from './ui.js';

const W = 720, H = 300, PAD = { l: 56, r: 110, t: 12, b: 28 };

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// series: [{ name, color, values: (number|null)[], bold }], labels: string[]
export function lineChartHtml({ series, labels, unit = '' }) {
  const n = labels.length;
  if (n < 2) return '<div class="muted">まだ記録が足りません（1季進めると表示されます）。</div>';
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v !== null))));
  const x = (i) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(max * f)}" y2="${y(max * f)}" class="ch-grid"/>
    <text x="${PAD.l - 6}" y="${y(max * f) + 4}" class="ch-axis" text-anchor="end">${fmt(Math.round(max * f))}</text>`).join('');
  // 目盛りは年の初め（春）だけ、多すぎれば間引く
  const years = labels.map((l, i) => [i, l.replace(/ .*/, '')]).filter(([i, y], k, arr) => k === 0 || arr[k - 1][1] !== y);
  const step = Math.max(1, Math.ceil(years.length / 7));
  const xt = years.filter((_, k) => k % step === 0).map(([i, y]) => `<text x="${x(i)}" y="${H - 8}" class="ch-axis" text-anchor="middle">${esc(y)}</text>`).join('');
  // 線の端に国名（重なりは少しずらす）
  const ends = [];
  const lines = series.map((s) => {
    let d = '', pen = false, last = null;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true; last = [i, v];
    });
    if (last) ends.push({ s, yy: y(last[1]), xx: x(last[0]) });
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold ? 3 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  ends.sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 12) ends[i].yy = ends[i - 1].yy + 12;
  const endLabels = ends.map((e) => `<circle cx="${e.xx}" cy="${y(e.s.values.filter((v) => v !== null).at(-1))}" r="3.5" fill="${e.s.color}" class="ch-dot"/>
    <text x="${W - PAD.r + 8}" y="${e.yy + 4}" class="ch-label${e.s.bold ? ' b' : ''}">${esc(e.s.name)}</text>`).join('');
  const legend = series.map((s) => `<span class="ch-key"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  const data = esc(JSON.stringify({ labels, unit, series: series.map((s) => ({ n: s.name, c: s.color, v: s.values })), x0: PAD.l, x1: W - PAD.r, W }));
  return `<div class="chart" data-chart="${data}">
    <div class="ch-legend">${legend}</div>
    <div class="ch-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${grid}${xt}${lines}${endLabels}
      <line class="ch-cross" x1="0" x2="0" y1="${PAD.t}" y2="${H - PAD.b}" visibility="hidden"/></svg>
      <div class="ch-tip hidden"></div></div></div>`;
}

// ホバー：縦線と、その季節の各国の値
export function bindCharts(root) {
  for (const el of root.querySelectorAll('.chart')) {
    const d = JSON.parse(el.dataset.chart);
    const svg = el.querySelector('svg'), cross = el.querySelector('.ch-cross'), tip = el.querySelector('.ch-tip');
    const n = d.labels.length;
    svg.onmousemove = (e) => {
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * d.W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((sx - d.x0) / (d.x1 - d.x0)) * (n - 1))));
      const cx = d.x0 + (i / (n - 1)) * (d.x1 - d.x0);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      const rows = d.series.filter((s) => s.v[i] !== null && s.v[i] !== undefined).sort((a, b) => b.v[i] - a.v[i]);
      tip.innerHTML = `<b>${esc(d.labels[i])}</b>${rows.map((s) => `<div><i style="background:${s.c}"></i>${esc(s.n)}<span>${fmt(s.v[i])}${d.unit ? ` ${esc(d.unit)}` : ''}</span></div>`).join('')}`;
      tip.classList.remove('hidden');
      const left = (cx / d.W) * r.width;
      tip.style.left = `${left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12}px`;
    };
    svg.onmouseleave = () => { cross.setAttribute('visibility', 'hidden'); tip.classList.add('hidden'); };
  }
}
