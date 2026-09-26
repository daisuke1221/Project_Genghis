// ゲーム状態の生成と共通ヘルパー
import { NATIONS, PROVINCES, CULTURES, NAME_POOLS, SEASONS, UNIT_TYPES, NAMED_CONSORTS, NAMED_PRINCESSES } from './data.js';
import { buildScenario } from './scenarios.js';
import { rnd, rint, pick, chance } from './rng.js';
import { NEIGHBORS } from './geo.js';
import { createCity, aiDevelopCity, cityYields, bestTile, startBuild } from './city.js';
import { initRoyals, setRoyalHooks } from './royal.js';
import { initTechs, setTechNamer } from './tech.js';
import { initMarket } from './trade.js';

export const PROV_DEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
export const NATION_DEF = Object.fromEntries(NATIONS.map((n) => [n.id, n]));
const NATIONS_BASE = NATIONS;

export function newGame({ playerNation = 'kiyat', seed = (Date.now() & 0x7fffffff), scenario = 's1189' } = {}) {
  const { sc, nations: NATS, generals: GENS, consorts, princesses } = buildScenario(scenario);
  const NATIONS = NATS;
  if (!NATIONS.some((n) => n.id === playerNation)) playerNation = sc.recommended;
  const st = {
    scenario: sc.id,
    version: SAVE_VERSION,
    rng: seed >>> 0,
    nextId: 1,
    seed,
    year: sc.year,
    season: 0,
    turn: 1,
    playerNation,
    nations: {},
    provinces: {},
    generals: {},
    nextGeneralId: 1,
    log: [],
    over: null,
    options: { autoBattle: false },
  };

  for (const n of NATIONS) {
    st.nations[n.id] = {
      id: n.id, name: n.name, color: n.color, culture: n.culture, aggro: n.aggro,
      rulerId: null, capital: n.capital,
      gold: 600 + n.provinces.length * 250,
      food: 1500 + n.provinces.length * 700,
      alive: true, relations: {}, treaties: {},
    };
  }
  // 外交関係の初期値
  for (const a of NATIONS) {
    for (const b of NATIONS) {
      if (a.id === b.id) continue;
      if (st.nations[a.id].relations[b.id] !== undefined) continue;
      let r = rint(st, -10, 25);
      if (a.culture === b.culture) r += 20;
      const adj = a.provinces.some((p) => b.provinces.some((q) => NEIGHBORS[p].includes(q)));
      if (adj) r -= 15;
      st.nations[a.id].relations[b.id] = r;
      st.nations[b.id].relations[a.id] = r;
    }
  }
  for (const [a, b, v] of sc.relations || []) {
    if (st.nations[a] && st.nations[b]) { st.nations[a].relations[b] = v; st.nations[b].relations[a] = v; }
  }

  for (const p of PROVINCES) {
    const owner = NATIONS.find((n) => n.provinces.includes(p.id))?.id ?? null;
    st.provinces[p.id] = { id: p.id, owner, governorId: null, delegated: owner !== playerNation, city: createCity(st, p) };
  }

  // 名のある武将
  const homeCap = Object.fromEntries(NATIONS_BASE.map((n) => [n.id, n.capital]));
  for (const g of GENS) {
    const ng = addGeneral(st, { ...g, loyalty: rint(st, 85, 100) });
    ng.named = true;
    // 他勢力へ移った人物は一門ではない
    if (g.nation !== g.homeNation && !NATIONS.some((n) => n.ruler && (sc.rename?.[n.ruler] ?? n.ruler) === g.name)) ng.family = false;
    if (!ng.nation) ng.province = st.nations[g.homeNation]?.capital ?? homeCap[g.homeNation] ?? 'kiy';
  }
  // 名無しの武将を補充
  for (const n of NATIONS) {
    const have = Object.values(st.generals).filter((g) => g.nation === n.id && age(st, g) >= 15).length;
    const want = n.provinces.length * 2 + 2;
    for (let i = have; i < want; i++) addGeneral(st, randomGeneral(st, n.id, n.culture));
  }
  // 在野の武将
  for (let i = 0; i < 14; i++) {
    const p = pick(st, PROVINCES);
    const owner = st.provinces[p.id].owner;
    const culture = owner ? st.nations[owner].culture : 'mongol';
    const g = randomGeneral(st, null, culture);
    g.province = p.id;
    addGeneral(st, g);
  }

  // 君主と配置
  for (const n of NATIONS) {
    const gens = Object.values(st.generals).filter((g) => g.nation === n.id);
    const nat = st.nations[n.id];
    nat.rulerId = gens[0].id;
    gens[0].loyalty = 100;
    let i = 0;
    const active = gens.filter((g) => age(st, g) >= 15);
    for (const g of gens) {
      if (g === gens[0] || age(st, g) < 15) g.province = n.capital;
      else g.province = n.provinces[i++ % n.provinces.length];
    }
    // 各地方に最低一人
    for (const pid of n.provinces) {
      if (!active.some((g) => g.province === pid)) {
        const extra = randomGeneral(st, n.id, n.culture);
        extra.province = pid;
        addGeneral(st, extra);
      }
    }
  }

  // 初期兵力
  for (const g of Object.values(st.generals)) {
    if (!g.nation || age(st, g) < 15) continue;
    const culture = CULTURES[st.nations[g.nation].culture];
    const type = initialUnitType(st, culture, g);
    const cap = unitCap(g);
    const vet = NATIONS.find((n) => n.id === g.nation)?.veteran;
    const fill = vet ? 0.85 + rnd(st) * 0.15 : 0.35 + rnd(st) * 0.35;
    g.unit = { type, soldiers: Math.round(cap * fill / 50) * 50, training: Math.min(100, rint(st, 40, 70) + (culture.nomad ? 10 : 0) + (vet ? 20 : 0)) };
  }

  // 太守の任命と初期開発
  for (const p of Object.values(st.provinces)) {
    if (p.owner) assignBestGovernor(st, p.id);
    const def = PROV_DEF[p.id];
    const devs = Math.round(def.pop / 3500) + 2 + Math.floor((sc.year - 1189) / 8);
    aiDevelopCity(st, p.id, { free: true, count: devs });
    for (const row of p.city.grid) if (row.b) row.b.progress = 1;
    // 大都市は人口に見合う住居を持たせる
    for (let guard = 0; guard < 40 && cityYields(st, p.id).popCap < def.pop; guard++) {
      const spot = bestTile(p.city, def, 'house');
      if (spot) { startBuild(st, p.id, spot.x, spot.y, 'house', true); continue; }
      const h = p.city.grid.find((t) => t.b?.type === 'house' && t.b.level < 3);
      if (!h) break;
      h.b.level += 1;
    }
  }
  initRoyals(st, consorts, princesses);
  initTechs(st);
  initMarket(st);
  log(st, `${sc.year}年春、シナリオ「${sc.title}」開始。ユーラシアの覇権をめぐる戦いが始まった。`, true);
  return st;
}

function initialUnitType(st, culture, g) {
  if (culture.nomad) return chance(st, 0.55) ? 'harch' : 'cav';
  const r = rnd(st);
  if (g.war > 80 && r < 0.5) return 'cav';
  if (r < 0.25) return 'cav';
  if (r < 0.7) return 'inf';
  return 'arch';
}

export function addGeneral(st, g) {
  const id = `g${st.nextGeneralId++}`;
  st.generals[id] = {
    id, name: g.name, nation: g.nation ?? null, province: g.province ?? null,
    birth: g.birth, war: g.war, lead: g.lead, pol: g.pol, cha: g.cha,
    loyalty: g.loyalty ?? 70, family: !!g.family, unit: g.unit ?? null,
    alive: true, moved: false,
  };
  return st.generals[id];
}

export function randomName(st, culture) {
  const poolKey = CULTURES[culture]?.names ?? 'mongol';
  const pool = NAME_POOLS[poolKey];
  if (Array.isArray(pool)) return pick(st, pool);
  const fam = pick(st, pool.family);
  const given = pick(st, pool.given) + (chance(st, 0.7) ? pick(st, pool.given) : '');
  return fam + given;
}

export function randomGeneral(st, nation, culture) {
  const stat = () => rint(st, 30, 72) + (chance(st, 0.12) ? rint(st, 5, 20) : 0);
  return {
    name: randomName(st, culture), nation, birth: st.year - rint(st, 18, 50),
    war: stat(), lead: stat(), pol: stat(), cha: stat(), loyalty: rint(st, 55, 85),
  };
}

// ---- 参照ヘルパー ----
export const age = (st, g) => st.year - g.birth;
export const isActive = (st, g) => g.alive && age(st, g) >= 15;
export const unitCap = (g) => Math.round(g.lead * 30 / 50) * 50;
export const dateStr = (st) => `${st.year}年 ${SEASONS[st.season]}`;

export function nationProvinces(st, nid) {
  return Object.values(st.provinces).filter((p) => p.owner === nid);
}
export function nationGenerals(st, nid, activeOnly = true) {
  return Object.values(st.generals).filter((g) => g.nation === nid && g.alive && !g.captiveOf && (!activeOnly || age(st, g) >= 15));
}
export function generalsIn(st, pid, nid) {
  return Object.values(st.generals).filter((g) => g.province === pid && g.alive && !g.captiveOf && age(st, g) >= 15 && (nid === undefined || g.nation === nid));
}
export function roninIn(st, pid) {
  return Object.values(st.generals).filter((g) => g.province === pid && g.alive && !g.nation && age(st, g) >= 15);
}
export function ruler(st, nid) { return st.generals[st.nations[nid].rulerId]; }
export function nationSoldiers(st, nid) {
  return nationGenerals(st, nid).reduce((s, g) => s + (g.unit?.soldiers ?? 0), 0);
}

export function unitPower(g) {
  if (!g.unit || g.unit.soldiers <= 0) return 0;
  const T = UNIT_TYPES[g.unit.type];
  return g.unit.soldiers * T.atk * (0.6 + g.unit.training / 250) * (0.75 + (g.war * 0.6 + g.lead * 0.4) / 250);
}
export function stackPower(st, pid, nid) {
  return generalsIn(st, pid, nid).reduce((s, g) => s + unitPower(g), 0);
}

export function assignBestGovernor(st, pid) {
  const p = st.provinces[pid];
  const cands = generalsIn(st, pid, p.owner);
  if (!cands.length) { p.governorId = null; return null; }
  cands.sort((a, b) => (b.pol - a.pol));
  p.governorId = cands[0].id;
  return cands[0];
}

export function log(st, text, important = false) {
  st.log.push({ turn: st.turn, date: dateStr(st), text, important });
  if (st.log.length > 300) st.log.splice(0, st.log.length - 300);
}

export function relation(st, a, b) { return st.nations[a]?.relations[b] ?? 0; }
export function treaty(st, a, b) {
  const t = st.nations[a]?.treaties[b];
  if (!t) return null;
  if (t.until && t.until < st.turn) { delete st.nations[a].treaties[b]; delete st.nations[b].treaties[a]; return null; }
  return t.type;
}
export function canAttack(st, a, b) {
  if (!b) return true;
  if (a === b) return false;
  return !treaty(st, a, b);
}

// ---- セーブ / ロード ----
export function serialize(st) { return JSON.stringify(st); }
export const SAVE_VERSION = 2;
export function deserialize(s) {
  const st = JSON.parse(s);
  if (!st || !st.version || st.version > SAVE_VERSION) throw new Error('対応していないセーブデータです');
  if (st.version < 2) {
    // v1 → v2：後宮・技術者・交易を追加
    st.nextId = st.nextId || 1;
    initRoyals(st, NAMED_CONSORTS, NAMED_PRINCESSES);
    initTechs(st);
    initMarket(st);
    st.version = 2;
  }
  return st;
}

setRoyalHooks({ addGeneral, randomName, log });
setTechNamer((st, culture) => randomName(st, culture));
