// 軍事の拡張：固有兵種・遠征（数地方の行軍）・渡海・補給線・疲労・傭兵・陣形の選択
import { UNIT_TYPES, SEA_LINKS, FORMATIONS, CULTURES } from './data.js';
import { NEIGHBORS } from './geo.js';
import { chance, rint, pick } from './rng.js';
import { PROV_DEF, nationProvinces, generalsIn, addGeneral, randomGeneral, log, canAttack } from './state.js';
import { cityYields } from './city.js';

const SEA = new Set(SEA_LINKS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
export const isSeaLink = (a, b) => SEA.has(`${a}|${b}`);

// ---------- 兵種 ----------
export const isMountedType = (t) => !!UNIT_TYPES[t]?.mounted;
export function unitAvailable(st, nid, type, pid) {
  const T = UNIT_TYPES[type];
  if (!T) return { ok: false, reason: '不明な兵種' };
  if (T.cultures && !T.cultures.includes(st.nations[nid].culture)) return { ok: false, reason: `${T.name}は${T.cultures.map((c) => CULTURES[c].name).join('・')}の兵種です` };
  if (T.needs === 'barracks' && pid && !(cityYields(st, pid).counts.barracks > 0)) return { ok: false, reason: `${T.name}には兵舎が必要です` };
  return { ok: true };
}
export function unitTypesFor(st, nid) {
  return Object.keys(UNIT_TYPES).filter((t) => !UNIT_TYPES[t].cultures || UNIT_TYPES[t].cultures.includes(st.nations[nid].culture));
}

// ---------- 遠征（自領を通って数地方先まで） ----------
// 騎馬だけの軍は3地方、それ以外は2地方先まで進める（最後の1歩だけ敵地に入れる）
export function marchRange(st, gids) {
  const gens = gids.map((id) => st.generals[id]).filter(Boolean);
  const armed = gens.filter((g) => g.unit?.soldiers > 0);
  if (!armed.length) return 2;
  return armed.every((g) => isMountedType(g.unit.type)) ? 3 : 2;
}
function passable(st, nid, pid) {
  const p = st.provinces[pid];
  return p.owner === nid && !st.sieges?.[pid];
}
// from から到達できる地方と、そこへの経路（最後の手前が出撃地）
export function marchPaths(st, nid, from, gids = []) {
  const range = marchRange(st, gids);
  const winter = st.season === 3;
  const prev = { [from]: null };
  const dist = { [from]: 0 };
  const queue = [from];
  const out = {};
  while (queue.length) {
    const cur = queue.shift();
    if (dist[cur] >= range) continue;
    for (const q of NEIGHBORS[cur]) {
      if (q in dist) continue;
      if (winter && isSeaLink(cur, q)) continue; // 冬の海は荒れて渡れない
      const owner = st.provinces[q].owner;
      if (owner === nid) {
        dist[q] = dist[cur] + 1; prev[q] = cur;
        out[q] = { dist: dist[q], via: cur };
        if (passable(st, nid, q) && !isSeaLink(cur, q)) queue.push(q); // 海を渡った先からはその季節は進めない
      } else if (canAttack(st, nid, owner) || !owner) {
        if (!out[q] || out[q].dist > dist[cur] + 1) out[q] = { dist: dist[cur] + 1, via: cur };
      }
    }
  }
  const path = (to) => {
    if (!out[to]) return null;
    const p = [to];
    let c = out[to].via;
    while (c !== null && c !== undefined) { p.unshift(c); c = prev[c]; }
    return p;
  };
  return { targets: Object.keys(out), info: out, path };
}

// ---------- 疲労 ----------
export const fatigueOf = (g) => g?.fatigue ?? 0;
export function addFatigue(g, n) { if (g) g.fatigue = Math.max(0, Math.min(100, fatigueOf(g) + n)); }
// 季節の終わり：休んだ武将は大きく回復する
export function fatigueTick(st) {
  for (const g of Object.values(st.generals)) {
    if (!g.alive || !g.fatigue) continue;
    g.fatigue = Math.max(0, g.fatigue - (g.moved || g.besieging ? 5 : 20));
  }
}

// ---------- 補給線 ----------
// 首都から自領（と宗主・従属国の領地）を伝ってたどれない地方は補給が断たれる
export function supplyNetwork(st, nid) {
  const n = st.nations[nid];
  const cap = n?.capital;
  const ok = new Set();
  if (!cap || st.provinces[cap]?.owner !== nid) return ok;
  const friendly = (pid) => {
    const o = st.provinces[pid].owner;
    if (o === nid) return true;
    const t = n.treaties?.[o];
    return t && (t.type === 'vassal' || t.type === 'alliance');
  };
  const queue = [cap];
  ok.add(cap);
  while (queue.length) {
    const cur = queue.shift();
    for (const q of NEIGHBORS[cur]) {
      if (ok.has(q) || !friendly(q) || st.sieges?.[q]) continue;
      ok.add(q); queue.push(q);
    }
  }
  return ok;
}
export function supplyTick(st) {
  const player = st.playerNation;
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const net = supplyNetwork(st, n.id);
    for (const p of nationProvinces(st, n.id)) {
      const cut = !net.has(p.id);
      if (cut && !p.cutoff && n.id === player) log(st, `【${PROV_DEF[p.id].city}】首都との補給線が断たれた！（収入半減・駐屯兵が消耗）`, true);
      p.cutoff = cut;
      if (!cut) continue;
      for (const g of generalsIn(st, p.id, n.id)) {
        if (!g.unit?.soldiers) continue;
        g.unit.soldiers = Math.round(g.unit.soldiers * 0.95 / 10) * 10;
        g.unit.training = Math.max(10, g.unit.training - 2);
      }
    }
  }
}

// ---------- 傭兵 ----------
export const MERC_TERM = 8;
export function mercOffers(st, nid) {
  st.mercs ??= {};
  const cur = st.mercs[nid];
  if (cur && cur.turn === st.turn) return cur.offers;
  const nat = st.nations[nid];
  const provs = nationProvinces(st, nid);
  const offers = [];
  const n = Math.min(3, 1 + Math.floor(provs.length / 3));
  for (let i = 0; i < n; i++) {
    const near = pick(st, provs)?.id ?? nat.capital;
    const nb = NEIGHBORS[near].map((q) => st.provinces[q].owner).filter(Boolean);
    const culture = st.nations[pick(st, nb.length ? nb : [nid])]?.culture ?? nat.culture;
    const nomad = CULTURES[culture]?.nomad;
    const type = nomad ? (chance(st, 0.6) ? 'harch' : 'cav') : pick(st, ['inf', 'inf', 'arch', 'cav']);
    const soldiers = rint(st, 10, 22) * 100;
    const training = rint(st, 55, 80);
    const g = randomGeneral(st, null, culture);
    g.lead = Math.max(g.lead, Math.ceil(soldiers / 30) + 5);
    offers.push({
      id: `${st.turn}-${i}`, name: g.name, culture, type, soldiers, training,
      war: g.war, lead: g.lead, pol: g.pol, cha: g.cha, birth: g.birth,
      fee: Math.round(soldiers * UNIT_TYPES[type].cost * 1.6 / 50) * 50,
      upkeep: Math.round(soldiers * 0.12 / 10) * 10,
    });
  }
  st.mercs[nid] = { turn: st.turn, offers };
  return offers;
}
export function hireMerc(st, nid, offerId, pid) {
  const offers = mercOffers(st, nid);
  const o = offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, reason: 'その傭兵はもういません' };
  const nat = st.nations[nid];
  if (nat.gold < o.fee) return { ok: false, reason: '金が足りません' };
  if (st.provinces[pid]?.owner !== nid) return { ok: false, reason: '自領で契約してください' };
  nat.gold -= o.fee;
  const g = addGeneral(st, {
    name: o.name, nation: nid, province: pid, birth: o.birth, war: o.war, lead: o.lead, pol: o.pol, cha: o.cha, loyalty: 50,
    unit: { type: o.type, soldiers: o.soldiers, training: o.training },
  });
  g.merc = { until: st.turn + MERC_TERM, upkeep: o.upkeep };
  g.moved = true;
  st.mercs[nid].offers = offers.filter((x) => x !== o);
  log(st, `傭兵隊長${g.name}が兵${o.soldiers}を率いて${st.nations[nid].name}と契約した（${MERC_TERM}季）。`, nid === st.playerNation);
  return { ok: true, general: g };
}
function dismissMerc(st, g, why) {
  const nid = g.nation;
  g.nation = null; g.unit = null;
  delete g.merc;
  for (const p of Object.values(st.provinces)) if (p.governorId === g.id) p.governorId = null;
  if (nid === st.playerNation) log(st, `傭兵隊長${g.name}は${why}、去っていった。`, true);
}
// 季節ごと：給金を払い、契約が切れた傭兵は去る
export function mercTick(st) {
  for (const g of Object.values(st.generals)) {
    if (!g.alive || !g.merc || !g.nation) continue;
    const nat = st.nations[g.nation];
    if (!nat?.alive) { delete g.merc; continue; }
    if (st.turn >= g.merc.until) { dismissMerc(st, g, '契約の期限が来て'); continue; }
    if (nat.gold < g.merc.upkeep) { dismissMerc(st, g, '給金が払われず'); continue; }
    nat.gold -= g.merc.upkeep;
  }
}
// AI：戦争中で金に余裕があれば傭兵を雇う
export function aiMercs(st, nid, atWarNow) {
  const nat = st.nations[nid];
  if (!atWarNow || nat.gold < 4000 || !chance(st, 0.1)) return;
  const offers = mercOffers(st, nid);
  const o = offers.filter((x) => x.fee < nat.gold * 0.4).sort((a, b) => b.soldiers - a.soldiers)[0];
  if (!o) return;
  const front = nationProvinces(st, nid).find((p) => NEIGHBORS[p.id].some((q) => st.provinces[q].owner && st.provinces[q].owner !== nid && !st.sieges?.[p.id]));
  hireMerc(st, nid, o.id, (front ?? st.provinces[nat.capital]).id);
}

// ---------- 陣形 ----------
export function aiFormation(b, side) {
  const us = b.units.filter((u) => u.side === side);
  const them = b.units.filter((u) => u.side !== side);
  const sum = (a) => a.reduce((s, u) => s + u.soldiers, 0);
  const ratio = sum(us) / Math.max(1, sum(them));
  const mounted = us.filter((u) => UNIT_TYPES[u.type].mounted).length / Math.max(1, us.length);
  if (side === 'def' && ratio < 0.7) return 'houen';
  if (ratio > 1.4 && us.length >= 3) return 'kakuyoku';
  if (side === 'att' && mounted > 0.6) return b.terrain === 'steppe' ? 'hoshi' : 'choda';
  return 'gyorin';
}
export const formationOf = (b, side) => FORMATIONS[b.formation?.[side] ?? 'gyorin'];
