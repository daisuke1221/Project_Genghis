// 技術革新：技術者の知恵を集めて国として新しい技術を獲得する。近隣が持つ技術は伝わりやすい
import { NEIGHBORS } from './geo.js';
import { pick, chance } from './rng.js';
import { log, nationProvinces } from './state.js';

// cost: 必要な研究点、pre: 前提、origin: 発祥の文化圏（その文化圏の国は安く習得できる）
export const INNOVATIONS = {
  paper_money: { name: '紙幣', cost: 70, origin: ['chinese'], desc: '全都市の金の収入+8%' },
  qanat: { name: 'カナート（地下水路）', cost: 60, origin: ['islamic'], desc: '農地の食糧+10%・治水の効果1.5倍' },
  composite_bow: { name: '合成弓の改良', cost: 60, origin: ['mongol', 'turkic'], desc: '弓兵・弓騎兵の攻撃+8%' },
  heavy_cavalry: { name: '重装騎兵の鎧', cost: 70, origin: ['european', 'islamic', 'greek'], desc: '騎馬の守り+8%' },
  fortification: { name: '築城術', cost: 70, origin: ['chinese', 'european', 'greek'], desc: '城壁の費用-30%・城に拠る守り+10%' },
  trebuchet: { name: '回回砲（平衡錘投石機）', cost: 90, pre: 'fortification', origin: ['islamic'], desc: '攻城兵の城攻め×1.5・包囲で城壁を削る力×1.5' },
  gunpowder: { name: '火薬（震天雷）', cost: 100, pre: 'paper_money', origin: ['chinese'], desc: '火計の成功率+15%・威力×1.5' },
  compass: { name: '羅針盤', cost: 70, origin: ['chinese'], desc: '渡海で嵐に遭わない・交易の利益+10%' },
  printing: { name: '印刷術', cost: 80, pre: 'paper_money', origin: ['chinese', 'korean'], desc: '学者の効果1.5倍・全都市の民忠の目標+2' },
  yam: { name: '駅伝制（ジャム）', cost: 90, origin: ['mongol'], desc: '遠征で進める地方+1・補給断絶の消耗が半減' },
};
export const INNOVATION_ORDER = Object.keys(INNOVATIONS);

export const knows = (st, nid, key) => !!st.nations[nid]?.innov?.[key];
export function innovCost(st, nid, key) {
  const I = INNOVATIONS[key];
  let c = I.cost;
  if (I.origin?.includes(st.nations[nid].culture)) c *= 0.7;
  // 伝播：隣国が知っている技術は学びやすい
  const neigh = new Set();
  for (const p of nationProvinces(st, nid)) for (const q of NEIGHBORS[p.id]) { const o = st.provinces[q].owner; if (o && o !== nid) neigh.add(o); }
  if ([...neigh].some((o) => knows(st, o, key))) c *= 0.75;
  return Math.round(c);
}
export function available(st, nid) {
  return INNOVATION_ORDER.filter((k) => !knows(st, nid, k) && (!INNOVATIONS[k].pre || knows(st, nid, INNOVATIONS[k].pre)));
}
// 季節ごとの研究点：技術者のLv（発明家は1.5倍）＋学者の多さ＋首都の工房
export function researchRate(st, nid) {
  let r = 1;
  for (const t of Object.values(st.techs || {})) {
    if (t.nation !== nid) continue;
    r += t.level * (t.trait === 'inventor' ? 1.5 : 1) * (t.type === 'scholar' ? 1.5 : 1);
  }
  return Math.round(r * 10) / 10;
}
export function setResearch(st, nid, key) {
  const n = st.nations[nid];
  if (key && !available(st, nid).includes(key)) return { ok: false, reason: 'まだ研究できません' };
  n.research = { key, points: n.research?.key === key ? n.research.points : 0 };
  return { ok: true };
}
export function researchTick(st) {
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    n.innov ??= {};
    if (!n.research?.key || knows(st, n.id, n.research.key)) {
      if (n.id === st.playerNation && n.research?.key) n.research = null;
      if (n.id !== st.playerNation) { const a = available(st, n.id); if (a.length) n.research = { key: pick(st, a), points: 0 }; }
      if (!n.research?.key) continue;
    }
    n.research.points += researchRate(st, n.id);
    const key = n.research.key;
    if (n.research.points >= innovCost(st, n.id, key)) {
      n.innov[key] = st.turn;
      n.research = null;
      log(st, `${n.name}が${INNOVATIONS[key].name}を獲得した。`, n.id === st.playerNation);
    }
  }
}
// 征服・交易で技術が伝わる
export function learnFrom(st, nid, from, why) {
  const cand = INNOVATION_ORDER.filter((k) => knows(st, from, k) && !knows(st, nid, k) && (!INNOVATIONS[k].pre || knows(st, nid, INNOVATIONS[k].pre)));
  if (!cand.length || !chance(st, 0.3)) return null;
  const key = pick(st, cand);
  st.nations[nid].innov ??= {};
  st.nations[nid].innov[key] = st.turn;
  log(st, `${st.nations[nid].name}は${why}${INNOVATIONS[key].name}を学び取った。`, nid === st.playerNation);
  return key;
}
