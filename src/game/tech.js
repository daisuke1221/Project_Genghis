// 技術者：各文化圏の専門家を招聘し、都市に配置して箱庭の産出などを高める
import { TECH_TYPES, TECH_HIRE_COST, TECH_SALARY, TECH_SLOTS, PROVINCES, NATIONS } from './data.js';
import { rnd, pick, chance } from './rng.js';
import { NEIGHBORS } from './geo.js';
import { hasTrait, gainExp } from './personnel.js';
import { knows } from './research.js';
import { fame } from './talent.js';
import { log } from './state.js';

export const TECH_TRAITS = {
  master: { name: '名人', desc: '効果が1.3倍' },
  teacher: { name: '師匠', desc: '同じ都市の技術者がよく育ち、太守も学ぶ' },
  inventor: { name: '発明家', desc: '国の研究が1.5倍進む' },
  greedy: { name: '強欲', desc: '給金1.5倍だが効果1.15倍。引き抜かれやすい' },
};
export const TECH_MAX_LEVEL = 5;
// 太守の特技と相性のよい技術者
const SYNERGY = { merchant: 'merchant', farmer: 'benevolent', smith: 'drill', artisan: 'drill', architect: 'fortify', engineer: 'fortify', scholar: 'benevolent', herder: 'horsearch' };

// 地方の本来の文化（シナリオ開始時の領主の文化）
export const PROV_CULTURE = {};
for (const p of PROVINCES) PROV_CULTURE[p.id] = NATIONS.find((n) => n.provinces.includes(p.id))?.culture ?? 'mongol';

const EMPTY = () => ({ farm: 0, horse: 0, market: 0, workshop: 0, trainNew: 0, speed: 0, siege: false, siegeTrain: 0, loyalty: 0, tax: 0, train: 0, trade: 0, goods: 0 });

export function techsIn(st, pid) {
  return Object.values(st.techs || {}).filter((t) => t.city === pid);
}

// 技術者1人の効果の倍率（個性・太守との相性・国の技術）
export function techMul(st, t, pid) {
  let m = 1;
  if (t.trait === 'master') m *= 1.3;
  if (t.trait === 'greedy') m *= 1.15;
  const p = st.provinces[pid];
  const gov = p?.governorId ? st.generals[p.governorId] : null;
  if (gov?.pol >= 80) m *= 1.1;
  if (gov && SYNERGY[t.type] && hasTrait(gov, SYNERGY[t.type])) m *= 1.25;
  if (t.type === 'scholar' && p?.owner && knows(st, p.owner, 'printing')) m *= 1.5;
  return m;
}
export function techBonus(st, pid) {
  const b = EMPTY();
  for (const t of techsIn(st, pid)) {
    const L = t.level * techMul(st, t, pid);
    switch (t.type) {
      case 'farmer': b.farm += 0.15 * L; break;
      case 'herder': b.horse += 0.25 * L; break;
      case 'merchant': b.market += 0.15 * L; b.trade += 0.15 * L; b.goods += 0.2 * L; break;
      case 'artisan': b.workshop += 0.25 * L; b.trainNew += 4 * L; break;
      case 'architect': b.speed += 0.2 * L; break;
      case 'engineer': b.siege = true; b.siegeTrain += 10 * L; break;
      case 'scholar': b.loyalty += 1.5 * L; b.tax += 0.06 * L; break;
      case 'smith': b.trainNew += 6 * L; b.train += 2 * L; break;
    }
  }
  return b;
}

export function techName(t) {
  return `${t.name}（${TECH_TYPES[t.type].name}）`;
}

let namer = null;
export function setTechNamer(fn) { namer = fn; }

export function genTech(st, pid, culture = PROV_CULTURE[pid]) {
  const types = Object.keys(TECH_TYPES).filter((k) => TECH_TYPES[k].cultures.includes(culture));
  const type = types.length ? pick(st, types) : pick(st, Object.keys(TECH_TYPES));
  const r = rnd(st);
  const id = `t${st.nextId++}`;
  st.techs[id] = {
    id, type, level: r < 0.6 ? 1 : r < 0.9 ? 2 : 3, culture,
    name: namer ? namer(st, culture) : '技術者', home: pid, nation: null, city: null, exp: 0,
  };
  if (chance(st, 0.4)) st.techs[id].trait = pick(st, Object.keys(TECH_TRAITS));
  return st.techs[id];
}

export function initTechs(st) {
  st.techs = st.techs || {};
  for (const p of PROVINCES) if (chance(st, 0.7)) genTech(st, p.id);
}

// 招聘できる技術者：所在地が自領か、友好的な国の領地
export function techReachable(st, nid, t) {
  const owner = st.provinces[t.home]?.owner;
  if (owner === nid) return true;
  if (!owner) return NEIGHBORS[t.home].some((q) => st.provinces[q].owner === nid);
  const tr = st.nations[nid].treaties[owner];
  return !!tr || (st.nations[nid].relations[owner] ?? 0) >= 20;
}

export function availableTechs(st, nid) {
  return Object.values(st.techs).filter((t) => !t.nation && techReachable(st, nid, t));
}

export function hireCost(t) { return TECH_HIRE_COST * t.level; }
export const salaryOf = (t) => Math.round(TECH_SALARY * t.level * (t.trait === 'greedy' ? 1.5 : 1));
// 招聘に応じる見込み：自領にいれば応じやすく、他国にいれば名声と友好度しだい
export function hireTechChance(st, nid, t) {
  const owner = st.provinces[t.home]?.owner;
  if (owner === nid) return 0.9;
  let p = 0.45 + (fame(st, nid) - 40) / 200;
  if (owner) p += (st.nations[nid].relations[owner] ?? 0) / 300;
  if (t.culture === st.nations[nid].culture) p += 0.1;
  return Math.max(0.1, Math.min(0.95, p));
}

export function hireTech(st, nid, tid, pid) {
  const t = st.techs[tid];
  const nat = st.nations[nid];
  if (!t || t.nation) return { ok: false, reason: 'すでに雇われています' };
  if (st.provinces[pid]?.owner !== nid) return { ok: false, reason: '自領の都市に配置してください' };
  if (techsIn(st, pid).length >= TECH_SLOTS) return { ok: false, reason: `1都市に置けるのは${TECH_SLOTS}人までです` };
  const cost = hireCost(t);
  if (nat.gold < cost) return { ok: false, reason: `金が足りません（${cost}）` };
  if (t.refused?.[nid] === st.turn) return { ok: false, reason: 'この季節はすでに断られました' };
  if (rnd(st) >= hireTechChance(st, nid, t)) {
    t.refused = { ...(t.refused || {}), [nid]: st.turn };
    return { ok: true, success: false, text: `${t.name}は招きに応じなかった` };
  }
  nat.gold -= cost;
  t.nation = nid;
  t.city = pid;
  t.since = st.turn;
  return { ok: true, success: true, cost, text: `${t.name}を招聘した` };
}

export function assignTech(st, tid, pid) {
  const t = st.techs[tid];
  if (st.provinces[pid]?.owner !== t.nation) return { ok: false, reason: '自領ではありません' };
  if (t.city !== pid && techsIn(st, pid).length >= TECH_SLOTS) return { ok: false, reason: `1都市に置けるのは${TECH_SLOTS}人までです` };
  t.city = pid;
  return { ok: true };
}

export function dismissTech(st, tid) {
  const t = st.techs[tid];
  t.nation = null;
  t.home = t.city ?? t.home;
  t.city = null;
}

// 都市の持ち主が変わったら、そこにいる技術者は新しい持ち主に仕える
export function transferCityTechs(st, pid, nid) {
  for (const t of techsIn(st, pid)) {
    if (nid) t.nation = nid;
    else { t.nation = null; t.home = pid; t.city = null; }
  }
}

// ---- 引き抜き：他国に仕える技術者を高い報酬で誘う ----
export function poachCost(t) { return hireCost(t) * 2; }
export function poachChance(st, nid, t) {
  if (!t.nation || t.nation === nid) return 0;
  let p = 0.2 + (fame(st, nid) - fame(st, t.nation)) / 200;
  if (t.trait === 'greedy') p += 0.2;
  if (t.culture === st.nations[nid].culture) p += 0.1;
  p -= Math.min(0.2, (st.turn - (t.since ?? st.turn)) / 80); // 長く仕えるほど義理堅い
  return Math.max(0.05, Math.min(0.8, p));
}
export function poachTargets(st, nid) {
  const n = st.nations[nid];
  return Object.values(st.techs || {}).filter((t) => t.nation && t.nation !== nid && st.nations[t.nation]?.alive
    && (NEIGHBORS[t.city ?? t.home]?.some((q) => st.provinces[q].owner === nid) || n.treaties[t.nation] || (n.relations[t.nation] ?? 0) >= 20 || (n.pacts?.[t.nation])));
}
export function poachTech(st, nid, tid, pid) {
  const t = st.techs[tid];
  const nat = st.nations[nid];
  if (!t || !poachTargets(st, nid).includes(t)) return { ok: false, reason: '誘える相手ではありません' };
  if (st.provinces[pid]?.owner !== nid) return { ok: false, reason: '自領の都市に配置してください' };
  if (techsIn(st, pid).length >= TECH_SLOTS) return { ok: false, reason: `1都市に置けるのは${TECH_SLOTS}人までです` };
  const cost = poachCost(t);
  if (nat.gold < cost) return { ok: false, reason: '金が足りません' };
  if (t.refused?.[nid] === st.turn) return { ok: false, reason: 'この季節はすでに断られました' };
  nat.gold -= cost;
  const old = t.nation;
  const rel = (d) => { nat.relations[old] = Math.max(-100, (nat.relations[old] ?? 0) + d); st.nations[old].relations[nid] = nat.relations[old]; };
  if (rnd(st) < poachChance(st, nid, t)) {
    t.nation = nid; t.city = pid; t.since = st.turn;
    rel(-10);
    return { ok: true, success: true, text: `${st.nations[old].name}に仕えていた${t.name}を引き抜いた！` };
  }
  t.refused = { ...(t.refused || {}), [nid]: st.turn };
  rel(-5);
  return { ok: true, success: false, text: `${t.name}は誘いを断った（${st.nations[old].name}との関係が悪化）` };
}

// 征服：遊牧の征服者は職人を連れ去る（モンゴルが各地の工匠を集めたように）
export function captureArtisans(st, pid, nid, prevOwner) {
  const nomad = ['mongol', 'turkic'].includes(st.nations[nid]?.culture);
  if (!chance(st, nomad ? 0.5 : 0.2)) return null;
  const t = genTech(st, pid, PROV_CULTURE[pid]);
  const cap = st.nations[nid].capital;
  t.nation = nid; t.since = st.turn;
  t.city = techsIn(st, cap).length < TECH_SLOTS ? cap : (techsIn(st, pid).length < TECH_SLOTS ? pid : null);
  if (!t.city) { t.nation = null; t.home = cap; }
  if (nid === st.playerNation) log(st, `${PROVINCES.find((p) => p.id === pid).city}の職人${t.name}（${TECH_TYPES[t.type].name}）を${t.city ? '召し抱えた' : '首都に連れ帰った'}。`, true);
  return t;
}

export function techTick(st) {
  // 給金
  for (const t of Object.values(st.techs)) {
    if (!t.nation) continue;
    const nat = st.nations[t.nation];
    if (!nat?.alive) { t.nation = null; t.home = t.city ?? t.home; t.city = null; continue; }
    nat.gold -= salaryOf(t);
    if (nat.gold < 0) {
      // 払えなければ去ってしまう
      nat.gold = 0;
      if (chance(st, 0.3)) { t.nation = null; t.home = t.city ?? t.home; t.city = null; t.left = st.turn; }
    }
  }
  // 年に一度：仕えている技術者は経験を積んで腕を上げ、太守も学ぶ
  if (st.season === 0) {
    for (const t of Object.values(st.techs)) {
      if (!t.nation || !t.city) continue;
      const here = techsIn(st, t.city);
      const p = st.provinces[t.city];
      const gov = p.governorId ? st.generals[p.governorId] : null;
      let e = 25 + (here.some((x) => x !== t && x.trait === 'teacher') ? 25 : 0) + (gov ? Math.max(0, gov.pol - 50) / 2 : 0);
      t.exp = (t.exp ?? 0) + e;
      if (t.level < TECH_MAX_LEVEL && t.exp >= 100 * t.level) {
        t.exp = 0; t.level += 1;
        if (t.nation === st.playerNation) log(st, `【技術者】${t.name}（${TECH_TYPES[t.type].name}）が腕を上げ、Lv${t.level}になった。`, true);
      }
      if (gov?.alive && gov.nation === t.nation) gainExp(st, gov, 'pol', 5 * t.level * (t.trait === 'teacher' ? 2 : 1));
    }
  }
  // 年に一度、新しい技術者が現れる
  if (st.season === 0) {
    const free = Object.values(st.techs).filter((t) => !t.nation).length;
    for (let i = free; i < 45; i++) {
      if (!chance(st, 0.5)) continue;
      genTech(st, pick(st, PROVINCES).id);
    }
  }
}

// AI：余裕があれば技術者を招聘
export function aiHireTech(st, nid, pids) {
  const nat = st.nations[nid];
  if (nat.gold < 1500 || !pids.length || !chance(st, 0.25)) return;
  const mine = Object.values(st.techs).filter((t) => t.nation === nid).length;
  if (mine >= pids.length) return;
  const cands = availableTechs(st, nid);
  if (!cands.length) return;
  const t = cands.sort((a, b) => b.level - a.level)[0];
  const pid = pids.find((p) => techsIn(st, p).length < TECH_SLOTS);
  if (pid) hireTech(st, nid, t.id, pid);
}
