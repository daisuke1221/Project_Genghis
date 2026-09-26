// 統計：季節ごとに各国の国力を記録する（推移グラフ・結末の画面で使う）
import { nationProvinces, nationGenerals, dateStr } from './state.js';

export const METRICS = {
  provs: { name: '領地', unit: '地方' },
  soldiers: { name: '兵力', unit: '人' },
  income: { name: '金の収入', unit: '金/季' },
  pop: { name: '人口', unit: '人' },
  power: { name: '国力', unit: '' },
};
export const METRIC_ORDER = ['power', 'provs', 'soldiers', 'income', 'pop'];
const MAX_POINTS = 160; // これを超えたら古い半分を間引く（セーブデータを大きくしすぎない）

export function snapshot(st, nid) {
  const provs = nationProvinces(st, nid);
  const soldiers = nationGenerals(st, nid).reduce((s, g) => s + (g.unit?.soldiers ?? 0), 0);
  const pop = provs.reduce((s, p) => s + p.city.pop, 0);
  const income = Math.max(0, st.nations[nid].lastIncome?.gold ?? 0);
  return { provs: provs.length, soldiers, income, pop, power: Math.round(provs.length * 400 + soldiers + income * 4 + pop / 50) };
}
export const scoreOf = (st, nid) => (st.nations[nid]?.alive ? snapshot(st, nid).power : 0);

// history = { turns: [..], dates: [..], nations: { nid: { provs: [...], ... } } }（生まれる前・滅んだ後は null）
export function recordHistory(st) {
  const h = (st.history ??= { turns: [], dates: [], nations: {} });
  if (h.turns[h.turns.length - 1] === st.turn) return;
  const i = h.turns.length;
  h.turns.push(st.turn);
  h.dates.push(dateStr(st));
  for (const n of Object.values(st.nations)) {
    const row = (h.nations[n.id] ??= Object.fromEntries(METRIC_ORDER.map((k) => [k, []])));
    const s = n.alive ? snapshot(st, n.id) : null;
    for (const k of METRIC_ORDER) {
      while (row[k].length < i) row[k].push(null);
      row[k].push(s ? s[k] : null);
    }
  }
  if (h.turns.length > MAX_POINTS) thin(h);
}

function thin(h) {
  const half = Math.floor(h.turns.length / 2);
  const keep = (_, i) => i >= half || i % 2 === 0;
  h.turns = h.turns.filter(keep);
  h.dates = h.dates.filter(keep);
  for (const row of Object.values(h.nations)) for (const k of Object.keys(row)) row[k] = row[k].filter(keep);
}

export function series(st, nid, metric) {
  return st.history?.nations[nid]?.[metric] ?? [];
}

// 生涯の最高値
export function peakOf(st, nid, metric) {
  return Math.max(0, ...series(st, nid, metric).filter((v) => v !== null));
}

// いま生きている国の順位
export function ranking(st, metric = 'power') {
  return Object.values(st.nations).filter((n) => n.alive)
    .map((n) => ({ nid: n.id, value: snapshot(st, n.id)[metric] }))
    .sort((a, b) => b.value - a.value);
}
