// 技術者：各文化圏の専門家を招聘し、都市に配置して箱庭の産出などを高める
import { TECH_TYPES, TECH_HIRE_COST, TECH_SALARY, TECH_SLOTS, PROVINCES, NATIONS } from './data.js';
import { rnd, pick, chance } from './rng.js';
import { NEIGHBORS } from './geo.js';

// 地方の本来の文化（シナリオ開始時の領主の文化）
export const PROV_CULTURE = {};
for (const p of PROVINCES) PROV_CULTURE[p.id] = NATIONS.find((n) => n.provinces.includes(p.id))?.culture ?? 'mongol';

const EMPTY = () => ({ farm: 0, horse: 0, market: 0, workshop: 0, trainNew: 0, speed: 0, siege: false, siegeTrain: 0, loyalty: 0, tax: 0, train: 0, trade: 0, goods: 0 });

export function techsIn(st, pid) {
  return Object.values(st.techs || {}).filter((t) => t.city === pid);
}

export function techBonus(st, pid) {
  const b = EMPTY();
  for (const t of techsIn(st, pid)) {
    const L = t.level;
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
    name: namer ? namer(st, culture) : '技術者', home: pid, nation: null, city: null,
  };
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

export function hireTech(st, nid, tid, pid) {
  const t = st.techs[tid];
  const nat = st.nations[nid];
  if (!t || t.nation) return { ok: false, reason: 'すでに雇われています' };
  if (st.provinces[pid]?.owner !== nid) return { ok: false, reason: '自領の都市に配置してください' };
  if (techsIn(st, pid).length >= TECH_SLOTS) return { ok: false, reason: `1都市に置けるのは${TECH_SLOTS}人までです` };
  const cost = hireCost(t);
  if (nat.gold < cost) return { ok: false, reason: `金が足りません（${cost}）` };
  nat.gold -= cost;
  t.nation = nid;
  t.city = pid;
  return { ok: true, cost };
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

export function techTick(st) {
  // 給金
  for (const t of Object.values(st.techs)) {
    if (!t.nation) continue;
    const nat = st.nations[t.nation];
    if (!nat?.alive) { t.nation = null; t.home = t.city ?? t.home; t.city = null; continue; }
    nat.gold -= TECH_SALARY * t.level;
    if (nat.gold < 0) {
      // 払えなければ去ってしまう
      nat.gold = 0;
      if (chance(st, 0.3)) { t.nation = null; t.home = t.city ?? t.home; t.city = null; t.left = st.turn; }
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
