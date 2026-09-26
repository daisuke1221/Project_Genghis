// 勢力AI：外交・人事・内政・徴兵・侵攻・兵の移動
import { UNIT_TYPES, CULTURES } from './data.js';
import { chance, shuffle, rnd } from './rng.js';
import { NEIGHBORS } from './geo.js';
import {
  NATION_DEF, nationProvinces, generalsIn, roninIn, unitCap, unitPower, stackPower,
  assignBestGovernor, canAttack, relation, treaty, log,
} from './state.js';
import { aiDevelopCity, cityYields, startWalls } from './city.js';
import { recruit, recruitQuote, tryHire, adjustRelation, searchTalent, recruitLimit } from './military.js';
import { executeMove, handleCalls } from './actions.js';
import { aiDiplomacy, sign, atWar, applyPeace, declareWar } from './diplomacy.js';
import { aiHireTech } from './tech.js';
import { aiTrade } from './trade.js';
import { becomeConsort } from './royal.js';
import { aiSieges } from './siege.js';
import { aiAdmin } from './admin.js';
import { aiSubvert } from './personnel.js';

export async function aiNationTurn(st, nid, hooks = {}) {
  const nat = st.nations[nid];
  if (!nat.alive) return;

  // 外交
  for (const pr of aiDiplomacy(st, nid)) {
    const ok = hooks.proposal ? await hooks.proposal(pr) : false;
    if (ok && pr.kind === 'marriage') {
      const p = st.princesses[pr.princess];
      if (p && !p.married) {
        becomeConsort(st, p, st.nations[st.playerNation].rulerId);
        sign(st, pr.from, st.playerNation, 'alliance');
        adjustRelation(st, pr.from, st.playerNation, 30);
      }
    } else if (pr.kind === 'peace') {
      if (ok && atWar(st, pr.from, st.playerNation)) applyPeace(st, pr.from, st.playerNation, pr.terms);
      else adjustRelation(st, pr.from, st.playerNation, -3);
    } else if (pr.kind === 'submit') {
      if (ok && atWar(st, pr.from, st.playerNation)) applyPeace(st, st.playerNation, pr.from, { kind: 'vassal' });
      else if (ok) sign(st, st.playerNation, pr.from, 'vassal', { lord: st.playerNation });
      else adjustRelation(st, pr.from, st.playerNation, -5);
    } else if (pr.kind === 'demand') {
      if (ok) sign(st, pr.from, st.playerNation, 'vassal', { lord: pr.from });
      else await handleCalls(st, declareWar(st, pr.from, st.playerNation, { reason: '（臣従の要求を拒まれて）' }), hooks);
    } else if (ok) sign(st, pr.from, st.playerNation, pr.kind);
    else adjustRelation(st, pr.from, st.playerNation, -5);
  }

  const provs = shuffle(st, nationProvinces(st, nid));
  // 人事
  for (const p of provs) {
    for (const g of roninIn(st, p.id)) if (g.hireTried !== st.turn && chance(st, 0.5)) tryHire(st, nid, g.id);
    const gov = st.generals[p.governorId];
    if (!gov || !gov.alive || gov.province !== p.id || gov.nation !== nid) assignBestGovernor(st, p.id);
  }

  // 人材探索
  const active = Object.values(st.generals).filter((g) => g.nation === nid && g.alive && !g.captiveOf).length;
  if ((nat.gold > 1500 && active < provs.length * 3 + 2) || (nat.gold > 6000 && active < provs.length * 5 + 4)) {
    const r = searchTalent(st, nid, nat.capital);
    if (r.found) tryHire(st, nid, r.found);
  }

  // 内政
  const reserve = 250 + provs.length * 120;
  for (const p of provs) {
    const budget = Math.max(0, (nat.gold - 150) * 0.7 / Math.max(1, provs.length) * 2);
    if (budget > 60) aiDevelopCity(st, p.id, { count: nat.gold > 5000 ? 2 : 1, budget });
    if (p.city.walls < 2 && p.city.wallProgress === null && nat.gold > reserve + 900 && isFrontier(st, nid, p.id) && chance(st, 0.25)) {
      startWalls(st, p.id);
    }
  }

  // 技術者・交易
  const pids = provs.map((p) => p.id);
  aiHireTech(st, nid, pids);
  if (chance(st, 0.2)) aiTrade(st, nid, pids);

  // 調略
  aiSubvert(st, nid, (t, imp) => log(st, t, imp));

  // 徴兵
  aiRecruit(st, nid, reserve);

  // 侵攻（序盤2ターンは様子見）
  await aiSieges(st, nid, hooks);
  if (!nat.alive) return;
  if (st.turn > 3) await aiAttack(st, nid, hooks);
  if (!nat.alive) return;

  // 兵の少ない武将は徴兵しやすい後方へ、満ちた武将は前線へ
  aiRegroup(st, nid);
  aiReinforce(st, nid);
  // 手の空いた武将で内政（施し・巡察・治水・商業など）
  if (nat.alive) aiAdmin(st, nid, nationProvinces(st, nid).map((p) => p.id), { reserve });
}

function aiRegroup(st, nid) {
  const own = new Set(nationProvinces(st, nid).map((p) => p.id));
  const room = {};
  for (const pid of own) room[pid] = recruitLimit(st, pid) - generalsIn(st, pid, nid).reduce((s, g) => s + Math.max(0, unitCap(g) - (g.unit?.soldiers ?? 0)), 0);
  for (const pid of own) {
    if (st.sieges?.[pid]) continue;
    for (const g of generalsIn(st, pid, nid)) {
      if (g.moved || g.id === st.provinces[pid].governorId) continue;
      if ((g.unit?.soldiers ?? 0) >= unitCap(g) * 0.4) continue;
      if (room[pid] > 0) continue;
      const best = NEIGHBORS[pid].filter((q) => own.has(q) && !st.sieges?.[q]).sort((a, b) => room[b] - room[a])[0];
      if (best && room[best] > room[pid] + 300) {
        g.province = best; g.moved = true;
        const need = unitCap(g) - (g.unit?.soldiers ?? 0);
        room[best] -= need; room[pid] += need;
      }
    }
  }
}

export function isFrontier(st, nid, pid) {
  return NEIGHBORS[pid].some((q) => st.provinces[q].owner !== nid);
}

function chooseType(st, nid, g, pid) {
  if (g.unit && g.unit.soldiers > 0) return g.unit.type;
  const culture = CULTURES[st.nations[nid].culture];
  const city = st.provinces[pid].city;
  const horsesOk = city.horses > 600;
  if (culture.nomad && horsesOk) return chance(st, 0.55) ? 'harch' : 'cav';
  const y = cityYields(st, pid);
  if (y.hasWorkshop && chance(st, 0.08)) return 'siege';
  if (horsesOk && (g.war > 70 || chance(st, 0.3))) return 'cav';
  return chance(st, 0.65) ? 'inf' : 'arch';
}

export function aiRecruit(st, nid, reserve = 300) {
  const nat = st.nations[nid];
  for (const p of nationProvinces(st, nid)) {
    const gens = generalsIn(st, p.id, nid).sort((a, b) => b.lead - a.lead);
    for (const g of gens) {
      if (nat.gold <= reserve) return;
      if ((g.unit?.soldiers ?? 0) >= unitCap(g) * 0.95) continue;
      if (nat.food < 300) return;
      const type = chooseType(st, nid, g, p.id);
      const q = recruitQuote(st, g.id, type, Math.floor((nat.gold - reserve) / UNIT_TYPES[type].cost));
      if (q.ok) recruit(st, g.id, type, q.amount);
      else if (type !== 'inf' && !(g.unit?.soldiers > 0)) {
        const q2 = recruitQuote(st, g.id, 'inf', Math.floor((nat.gold - reserve) / UNIT_TYPES.inf.cost));
        if (q2.ok) recruit(st, g.id, 'inf', q2.amount);
      }
    }
  }
}

function defenseValue(st, pid) {
  const p = st.provinces[pid];
  if (!p.owner) return 0;
  return stackPower(st, pid, p.owner) * (1 + 0.3 * p.city.walls);
}

async function aiAttack(st, nid, hooks) {
  const nat = st.nations[nid];
  // 攻撃候補：自領に隣接する他勢力・空白の地方
  const targets = new Set();
  for (const p of nationProvinces(st, nid)) for (const q of NEIGHBORS[p.id]) if (st.provinces[q].owner !== nid) targets.add(q);
  const threatOf = (pid) => Math.max(0, ...NEIGHBORS[pid].map((q) => {
    const o = st.provinces[q].owner;
    return o && o !== nid && !treaty(st, nid, o) ? stackPower(st, q, o) : 0;
  }));
  const plans = [];
  for (const to of targets) {
    const owner = st.provinces[to].owner;
    if (!canAttack(st, nid, owner)) continue;
    const rel = owner ? relation(st, nid, owner) : -50;
    if (rel > 45 && nat.aggro < 0.7) continue;
    const dv = defenseValue(st, to);
    // 隣接する自領から出せる武将
    const sources = NEIGHBORS[to].filter((q) => st.provinces[q].owner === nid);
    const pool = [];
    for (const src of sources) {
      if (st.sieges?.[src]) continue; // 包囲されている城からは出られない
      const gens = generalsIn(st, src, nid).filter((g) => !g.moved && g.unit?.soldiers > 0 && !(g.wound > st.turn)).sort((a, b) => unitPower(b) - unitPower(a));
      const keep = threatOf(src) > 0 && gens.length > 1 ? 1 : 0; // 脅威があれば最弱の1人を守備に残す
      for (const g of gens.slice(0, gens.length - keep)) pool.push({ g, src });
    }
    const myPow = pool.reduce((s, x) => s + unitPower(x.g), 0);
    const need = dv * (1.7 - nat.aggro * 0.5) + 50;
    if (!pool.length || myPow < need) continue;
    let score = (st.provinces[to].city.pop / 1000 + 5) * (myPow / (dv + 200));
    if (!owner) score *= 1.5;
    else if (atWar(st, nid, owner)) score *= 1.8;
    else score *= 0.7; // 新たな戦争は慎重に
    score *= 0.6 + nat.aggro * 0.8 - Math.max(0, rel) / 150;
    plans.push({ to, dv, pool, score });
  }
  plans.sort((a, b) => b.score - a.score);
  let attacks = 0;
  for (const plan of plans) {
    if (!nat.alive || st.over || attacks >= (plans.length > 3 ? 2 : 1)) return;
    if (!chance(st, 0.15 + nat.aggro * 0.4)) continue;
    const pool = plan.pool.filter((x) => !x.g.moved && x.g.alive && x.g.nation === nid && st.provinces[x.src].owner === nid);
    if (st.provinces[plan.to].owner === nid || !pool.length) continue;
    const team = [];
    let pow = 0;
    for (const x of pool) {
      if (pow >= plan.dv * 2.2 + 100 && team.length) break;
      team.push(x); pow += unitPower(x.g);
    }
    if (pow < plan.dv * (1.7 - nat.aggro * 0.5) + 50) continue;
    attacks++;
    await executeMove(st, nid, team.map((x) => x.g.id), team[0].src, plan.to, hooks);
  }
}

// 内地の武将を前線へ一歩ずつ移動
function aiReinforce(st, nid) {
  const provs = nationProvinces(st, nid);
  const own = new Set(provs.map((p) => p.id));
  const frontier = provs.filter((p) => isFrontier(st, nid, p.id)).map((p) => p.id);
  if (!frontier.length) return;
  // 前線からの距離
  const dist = {};
  const q = [...frontier];
  for (const f of frontier) dist[f] = 0;
  while (q.length) {
    const a = q.shift();
    for (const b of NEIGHBORS[a]) if (own.has(b) && dist[b] === undefined) { dist[b] = dist[a] + 1; q.push(b); }
  }
  for (const p of provs) {
    if (!dist[p.id] || st.sieges?.[p.id]) continue;
    const gens = generalsIn(st, p.id, nid).filter((g) => !g.moved && g.id !== p.governorId && g.unit?.soldiers >= unitCap(g) * 0.6);
    const next = NEIGHBORS[p.id].filter((b) => own.has(b) && dist[b] === dist[p.id] - 1 && !st.sieges?.[b]);
    if (!next.length) continue;
    for (const g of gens) {
      if (!chance(st, 0.7)) continue;
      g.province = next[Math.floor(rnd(st) * next.length)];
      g.moved = true;
    }
  }
}

// プレイヤーの委任都市
export function delegateDevelop(st, nid) {
  const nat = st.nations[nid];
  const provs = nationProvinces(st, nid).filter((p) => p.delegated);
  const reserve = 300;
  for (const p of provs) {
    const budget = Math.max(0, (nat.gold - reserve) * 0.4 / Math.max(1, provs.length));
    if (budget > 60) aiDevelopCity(st, p.id, { count: 1, budget });
  }
  aiAdmin(st, nid, provs.map((p) => p.id), { reserve: Math.max(reserve, nat.gold * 0.5) });
}

