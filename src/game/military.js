// 軍事：徴兵・出陣・戦後処理・捕虜・勢力の滅亡と継承
import { UNIT_TYPES, CULTURES } from './data.js';
import { rnd, chance, pick } from './rng.js';
import { NEIGHBORS } from './geo.js';
import {
  PROV_DEF, NATION_DEF, generalsIn, nationProvinces, nationGenerals, unitCap, assignBestGovernor, log, ruler,
  canAttack, isActive, randomGeneral, addGeneral,
} from './state.js';
import { cityYields } from './city.js';
import { transferCityTechs, captureArtisans } from './tech.js';
import { learnFrom } from './research.js';
import { orphanNation } from './royal.js';
import { adminOnConquest } from './admin.js';
import { faithOnConquest } from './faith.js';
import { battleAftermath, hasTrait } from './personnel.js';
import { hireChanceWith, tryHireWith } from './talent.js';
import { currentHeir, successionDispute, marriageClaimant } from './court.js';

// ---- 徴兵 ----
export function recruitLimit(st, pid) {
  const y = cityYields(st, pid);
  return Math.max(0, y.recruit - st.provinces[pid].city.recruited);
}

export function recruitQuote(st, gid, type, want) {
  const g = st.generals[gid];
  const p = st.provinces[g.province];
  if (!p || p.owner !== g.nation) return { ok: false, reason: '自領にいません', amount: 0 };
  if (st.sieges?.[g.province]) return { ok: false, reason: '包囲されていて徴兵できません', amount: 0 };
  const T = UNIT_TYPES[type];
  if (g.unit && g.unit.soldiers > 0 && g.unit.type !== type) return { ok: false, reason: '兵がいる間は兵種を変えられません', amount: 0 };
  const y = cityYields(st, g.province);
  if (T.needs === 'workshop' && !y.canSiege) return { ok: false, reason: '工房か攻城技師が必要です', amount: 0 };
  if (T.cultures && !T.cultures.includes(st.nations[g.nation].culture)) return { ok: false, reason: `${T.name}はこの国では編成できません`, amount: 0 };
  if (T.needs === 'barracks' && !(y.counts.barracks > 0)) return { ok: false, reason: `${T.name}には兵舎が必要です`, amount: 0 };
  const nat = st.nations[g.nation];
  const cur = g.unit?.soldiers ?? 0;
  let amount = Math.min(
    want,
    unitCap(g) - cur,
    Math.max(0, y.recruit - p.city.recruited),
    Math.max(0, p.city.pop - 1000),
    Math.floor(nat.gold / T.cost),
    T.horses ? Math.floor(p.city.horses / T.horses) : Infinity,
  );
  amount = Math.max(0, Math.floor(amount / 10) * 10);
  let reason = '';
  if (amount <= 0) {
    if (unitCap(g) - cur <= 0) reason = '兵数が上限です';
    else if (y.recruit - p.city.recruited <= 0) reason = 'この季節の徴兵上限です（兵舎を建てよう）';
    else if (p.city.pop <= 1000) reason = '人口が足りません';
    else if (nat.gold < T.cost * 10) reason = '金が足りません';
    else reason = '馬が足りません（牧場を建てよう）';
  }
  return { ok: amount > 0, amount, cost: Math.ceil(amount * T.cost), horses: Math.ceil(amount * T.horses), reason };
}

export function recruit(st, gid, type, want) {
  const q = recruitQuote(st, gid, type, want);
  if (!q.ok) return q;
  const g = st.generals[gid];
  const p = st.provinces[g.province];
  const nat = st.nations[g.nation];
  const y = cityYields(st, g.province);
  const culture = CULTURES[st.nations[g.nation].culture];
  const base = Math.min(95, 25 + y.trainNew + (culture.nomad && UNIT_TYPES[type].horses ? 20 : 0) + (type === 'siege' ? y.tech.siegeTrain : 0));
  const cur = g.unit?.soldiers ?? 0;
  const curTr = g.unit?.training ?? base;
  g.unit = { type, soldiers: cur + q.amount, training: Math.round((curTr * cur + base * q.amount) / (cur + q.amount)) };
  nat.gold -= q.cost;
  p.city.horses -= q.horses;
  p.city.pop -= q.amount;
  p.city.recruited += q.amount;
  p.city.loyalty = Math.max(0, p.city.loyalty - q.amount / 600);
  return q;
}

export function dismiss(st, gid, amount) {
  const g = st.generals[gid];
  if (!g.unit) return 0;
  const n = Math.min(amount, g.unit.soldiers);
  g.unit.soldiers -= n;
  const p = st.provinces[g.province];
  if (p && p.owner === g.nation) p.city.pop += n;
  return n;
}

// ---- 出陣 ----
export function moveTargets(st, nid, pid) {
  return NEIGHBORS[pid].filter((to) => {
    const owner = st.provinces[to].owner;
    return owner === nid || canAttack(st, nid, owner);
  });
}

// 部隊移動。敵地なら 'battle' を返す（呼び出し側が戦闘を解決）
export function planMove(st, nid, gids, to) {
  const owner = st.provinces[to].owner;
  if (owner === nid) return { kind: 'move' };
  const defenders = owner ? generalsIn(st, to, owner).filter((g) => g.unit?.soldiers > 0) : [];
  const attackers = gids.map((id) => st.generals[id]).filter((g) => g.unit?.soldiers > 0);
  if (!attackers.length) return { kind: 'invalid', reason: '兵のいない武将だけでは攻め込めません' };
  if (!defenders.length) return { kind: 'occupy' };
  return { kind: 'battle' };
}

export function moveGenerals(st, gids, to) {
  for (const id of gids) {
    const g = st.generals[id];
    g.province = to;
    g.moved = true;
  }
  const p = st.provinces[to];
  if (!p.governorId || !st.generals[p.governorId]?.alive || st.generals[p.governorId].province !== to) assignBestGovernor(st, to);
}

// 領地の占領
export function occupy(st, nid, gids, to, from) {
  const p = st.provinces[to];
  const prevOwner = p.owner;
  const captives = [];
  if (prevOwner) {
    for (const g of generalsIn(st, to, prevOwner)) {
      const esc = escapeTarget(st, g, to);
      if (esc && (g.id === st.nations[prevOwner].rulerId || chance(st, 0.7))) g.province = esc;
      else captives.push(g.id);
    }
  }
  changeOwner(st, to, nid);
  moveGenerals(st, gids, to);
  for (const id of captives) {
    const g = st.generals[id];
    if (g.unit) g.unit.soldiers = 0;
    g.captiveOf = nid;
  }
  if (prevOwner) {
    captureArtisans(st, to, nid, prevOwner);
    learnFrom(st, nid, prevOwner, `${PROV_DEF[to].city}の攻略で`);
    adjustRelation(st, prevOwner, nid, -30);
    checkNationAlive(st, prevOwner, nid);
  }
  return captives;
}

function escapeTarget(st, g, from) {
  const opts = NEIGHBORS[from].filter((q) => st.provinces[q].owner === g.nation);
  return opts.length ? pick(st, opts) : null;
}

export function changeOwner(st, pid, nid) {
  const p = st.provinces[pid];
  const prev = p.owner;
  p.owner = nid;
  const sg = st.sieges?.[pid];
  if (sg && sg.att === nid) {
    for (const id of sg.gids) if (st.generals[id]) delete st.generals[id].besieging;
    delete st.sieges[pid];
  }
  transferCityTechs(st, pid, nid);
  // 首都を失った勢力は、残った領地の中で最も人口の多い都市へ遷都する
  const pn = prev ? st.nations[prev] : null;
  if (pn && pn.capital === pid) {
    const rest = Object.values(st.provinces).filter((q) => q.owner === prev).sort((x, y) => y.city.pop - x.city.pop);
    if (rest.length) pn.capital = rest[0].id;
  }
  p.delegated = nid !== st.playerNation;
  p.city.loyalty = Math.min(p.city.loyalty, 35);
  adminOnConquest(st, pid);
  faithOnConquest(st, pid, nid, prev);
  p.city.pop = Math.round(p.city.pop * 0.92);
  p.governorId = null;
  if (p.city.wallProgress !== null) p.city.wallProgress = null;
  for (const t of p.city.grid) if (t.b && t.b.progress < 1) { if (t.b.level > 1) { t.b.level -= 1; t.b.progress = 1; } else t.b = null; }
  const nat = st.nations[nid];
  if (nat && (!st.provinces[nat.capital] || st.provinces[nat.capital].owner !== nid)) nat.capital = pid;
}

export function adjustRelation(st, a, b, d) {
  if (!a || !b || a === b) return;
  const na = st.nations[a], nb = st.nations[b];
  const v = Math.max(-100, Math.min(100, (na.relations[b] ?? 0) + d));
  na.relations[b] = v; nb.relations[a] = v;
}

// ---- 戦後処理 ----
// result: battleResult(), ctx: { attIds }
export function applyBattle(st, result, attIds) {
  const { winner, provinceId: to, fromProvince: from, attNation, defNation } = result;
  const msgs = [];
  for (const u of result.units) if (u.turncoat) msgs.push(`${st.generals[u.gid]?.name}が寝返った！`);
  battleAftermath(st, result);
  for (const u of result.units) {
    const g = st.generals[u.gid];
    if (!g?.unit) continue;
    const lossDesert = u.routed ? 0.8 : 1;
    g.unit.soldiers = Math.max(0, Math.round(u.soldiers * lossDesert / 10) * 10);
    g.unit.training = Math.min(100, g.unit.training + 3);
    if (u.dead) {
      msgs.push(`${g.name}が討死した。`);
      killGeneral(st, g.id);
    } else if (u.wounded) {
      const n = woundGeneral(st, g.id);
      msgs.push(`${g.name}が負傷した（${n}季のあいだ戦えない）。`);
    }
  }
  for (const id of attIds) if (st.generals[id]?.alive) st.generals[id].moved = true;
  adjustRelation(st, attNation, defNation, -25);
  let captives = [];
  if (winner === 'att') {
    const alive = attIds.filter((id) => st.generals[id]?.alive && st.generals[id].nation === attNation);
    captives = occupy(st, attNation, alive, to, from);
    msgs.push(`${st.nations[attNation].name}軍が${PROV_DEF[to].city}を攻略した。`);
  } else {
    msgs.push(`${st.nations[defNation]?.name ?? '守備'}軍が${PROV_DEF[to].city}を守り抜いた。`);
  }
  return { msgs, captives };
}

// 捕虜の処遇 decisions: { gid: 'recruit'|'release'|'execute' }
export function recruitChance(st, captor, g) {
  if (g.nation && st.nations[g.nation]?.rulerId === g.id) return 0;
  const r = ruler(st, captor);
  let p = 0.35 + ((r?.cha ?? 50) - (g.nation ? g.loyalty : 50)) / 100;
  if (g.family) p -= 0.5;
  if (hasTrait(g, 'loyal')) p -= 0.4;
  if (r && hasTrait(r, 'eloquent')) p += 0.15;
  return Math.max(0.03, Math.min(0.95, p));
}

export function resolveCaptive(st, captor, gid, decision) {
  const g = st.generals[gid];
  delete g.captiveOf;
  const oldNation = g.nation;
  if (decision === 'execute') {
    log(st, `${st.nations[captor].name}は捕虜の${g.name}を処断した。`);
    if (oldNation) adjustRelation(st, captor, oldNation, -20);
    killGeneral(st, gid);
    return 'executed';
  }
  if (decision === 'recruit' && chance(st, recruitChance(st, captor, g))) {
    g.nation = captor;
    g.loyalty = 55 + Math.round(rnd(st) * 20);
    const own = nationProvinces(st, captor);
    if (!own.some((p) => p.id === g.province)) g.province = st.nations[captor].capital;
    return 'recruited';
  }
  // 解放
  if (oldNation && st.nations[oldNation]?.alive) {
    const home = nationProvinces(st, oldNation);
    g.province = home.length ? st.nations[oldNation].capital : g.province;
    adjustRelation(st, captor, oldNation, 5);
  } else {
    g.nation = null;
    g.unit = null;
  }
  return decision === 'recruit' ? 'refused' : 'released';
}

export function aiCaptiveDecision(st, captor, g) {
  const isRuler = g.nation && st.nations[g.nation]?.rulerId === g.id;
  if (isRuler) return chance(st, st.nations[captor].aggro * 0.5) ? 'execute' : 'release';
  if ((g.war + g.lead + g.pol) / 3 > 45) return 'recruit';
  return 'release';
}

// ---- 負傷 ----
export function isWounded(st, g) { return !!(g?.wound && g.wound > st.turn); }
export function woundGeneral(st, gid, seasons) {
  const g = st.generals[gid];
  const n = seasons ?? 2 + Math.floor(rnd(st) * 3);
  g.wound = Math.max(g.wound ?? 0, st.turn + n);
  return n;
}
// 季節ごと：傷が癒える
export function healTick(st) {
  for (const g of Object.values(st.generals)) {
    if (!g.wound || !g.alive) continue;
    if (g.wound <= st.turn) {
      delete g.wound;
      if (g.nation === st.playerNation) log(st, `${g.name}の傷が癒えた。`);
    }
  }
}

// ---- 死亡・継承・滅亡 ----
export function killGeneral(st, gid) {
  const g = st.generals[gid];
  if (!g || !g.alive) return;
  g.alive = false;
  if (g.unit) g.unit.soldiers = 0;
  for (const p of Object.values(st.provinces)) if (p.governorId === gid) assignBestGovernor(st, p.id);
  if (g.nation && st.nations[g.nation]?.rulerId === gid) succession(st, g.nation);
}

export function succession(st, nid) {
  const nat = st.nations[nid];
  const old = st.generals[nat.rulerId];
  const cands = nationGenerals(st, nid).filter((g) => g.alive && g.id !== nat.rulerId && !g.captiveOf);
  if (!cands.length || !nationProvinces(st, nid).length) {
    // 婚姻による相続：姫の嫁ぎ先の君主が国を継ぐ
    const claim = nationProvinces(st, nid).length ? marriageClaimant(st, nid) : null;
    if (claim) { inheritByMarriage(st, nid, claim); return null; }
    destroyNation(st, nid, null);
    return null;
  }
  // 一門の跡継ぎがいなければ、姫の嫁ぎ先が婚姻による相続を主張することがある（AIの国のみ）
  if (nid !== st.playerNation && !cands.some((g) => g.family)) {
    const claim = marriageClaimant(st, nid);
    if (claim && (nat.relations[claim.nation] ?? 0) >= 30 && chance(st, 0.35)) { inheritByMarriage(st, nid, claim); return null; }
  }
  const designated = nat.heirId && st.generals[nat.heirId]?.alive ? nat.heirId : null;
  const planned = currentHeir(st, nid);
  let heir = planned && cands.includes(planned) ? planned : null;
  if (!heir) {
    const fam = cands.filter((g) => g.family);
    const pool = fam.length ? fam : cands;
    pool.sort((a, b) => (b.lead + b.pol + b.cha) - (a.lead + a.pol + a.cha));
    heir = pool[0];
  }
  delete nat.heirId;
  nat.rulerId = heir.id;
  heir.loyalty = 100;
  if (!heir.family) for (const g of cands) g.loyalty = Math.max(0, g.loyalty - 10);
  heir.family = true;
  log(st, `${nat.name}の${old?.name ?? '君主'}が世を去り、${heir.name}が後を継いだ。`, true);
  if (old) successionDispute(st, nid, heir, old.id, !!designated && designated === heir.id);
  return heir;
}

function inheritByMarriage(st, nid, claim) {
  const nat = st.nations[nid], to = claim.nation;
  for (const p of nationProvinces(st, nid)) changeOwner(st, p.id, to);
  for (const g of Object.values(st.generals)) if (g.nation === nid && g.alive) { g.nation = to; g.loyalty = 60; g.family = false; }
  nat.alive = false;
  orphanNation(st, nid);
  for (const o of Object.values(st.nations)) delete o.treaties[nid];
  log(st, `${nat.name}の家系が絶え、${claim.princess.name}の嫁ぎ先である${st.nations[to].name}が婚姻による相続で国を継いだ。`, true);
}

export function checkNationAlive(st, nid, byNid) {
  if (!st.nations[nid]?.alive) return;
  if (nationProvinces(st, nid).length === 0) destroyNation(st, nid, byNid);
}

export function destroyNation(st, nid, byNid) {
  const nat = st.nations[nid];
  if (!nat.alive) return;
  nat.alive = false;
  for (const g of Object.values(st.generals)) {
    if (g.nation === nid) { g.formerNation = nid; g.nation = null; g.unit = null; }
  }
  for (const p of Object.values(st.provinces)) if (p.owner === nid) { p.owner = null; p.governorId = null; transferCityTechs(st, p.id, null); }
  orphanNation(st, nid);
  for (const other of Object.values(st.nations)) { delete other.treaties[nid]; }
  log(st, `${nat.name}は滅亡した。${byNid ? `（${st.nations[byNid].name}による）` : ''}`, true);
}

// ---- 人事 ----
export function hireChance(st, nid, g, opts = {}) {
  return hireChanceWith(st, nid, g, opts);
}
export function tryHire(st, nid, gid, opts = {}) {
  return !!tryHireWith(st, nid, gid, opts).success;
}

export const SEARCH_COST = 200;
// 人材探索：金を払って在野の人材を探す。見つかれば在野武将として現れる
export function searchTalent(st, nid, pid) {
  const nat = st.nations[nid];
  if (nat.gold < SEARCH_COST) return { ok: false, reason: '金が足りません' };
  nat.gold -= SEARCH_COST;
  if (!chance(st, 0.55)) return { ok: true, found: null };
  const g = randomGeneral(st, null, st.nations[nid].culture);
  g.province = pid;
  return { ok: true, found: addGeneral(st, g).id };
}

export function reward(st, gid, gold) {
  const g = st.generals[gid];
  const nat = st.nations[g.nation];
  if (nat.gold < gold) return false;
  nat.gold -= gold;
  g.loyalty = Math.min(100, g.loyalty + Math.round(gold / 20));
  return true;
}
