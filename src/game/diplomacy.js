// 外交：贈物・同盟・停戦・宣戦・参戦・和平交渉・従属（朝貢）・併合・包囲網
import { chance, rnd, pick } from './rng.js';
import { nationGenerals, nationProvinces, unitPower, treaty, relation, log, PROV_DEF } from './state.js';
import { adjustRelation, changeOwner, checkNationAlive } from './military.js';
import { NEIGHBORS } from './geo.js';
import { setRoyalHooks, aiMarriage } from './royal.js';
import { PROVINCES } from './data.js';
import {
  mood, personality, PERSONALITIES, hostageBonus, giveHostage, onTreatyBroken, changeTrust, endPact, statecraftTick, aiStatecraft,
} from './statecraft.js';

export const TRUCE_TURNS = 12;
export const TRIBUTE_RATE = 0.2;
const TREATY_NAMES = { alliance: '同盟', truce: '停戦', vassal: '従属', tribute: '朝貢' };

const nat = (st, id) => st.nations[id];
const nameOf = (st, id) => st.nations[id]?.name ?? '';
const involvesPlayer = (st, ...ids) => ids.includes(st.playerNation);

export function nationPower(st, nid) {
  return nationGenerals(st, nid).reduce((s, g) => s + unitPower(g), 0) + nationProvinces(st, nid).length * 400;
}

export function areNeighbors(st, a, b) {
  return nationProvinces(st, a).some((p) => NEIGHBORS[p.id].some((q) => st.provinces[q].owner === b));
}

// ---------- 状態の参照 ----------
export function warsOf(st, a) {
  const n = nat(st, a);
  if (!n) return {};
  n.wars = n.wars || {};
  for (const b of Object.keys(n.wars)) if (!st.nations[b]?.alive) delete n.wars[b];
  return n.wars;
}
export const atWar = (st, a, b) => !!(a && b && warsOf(st, a)[b]);
export function enemiesOf(st, a) { return Object.keys(warsOf(st, a)); }

export function lordOf(st, a) {
  const n = nat(st, a);
  for (const [b, t] of Object.entries(n?.treaties || {})) if (t.type === 'vassal' && t.lord === b && st.nations[b]?.alive) return b;
  return null;
}
export function vassalsOf(st, a) {
  return Object.entries(nat(st, a)?.treaties || {}).filter(([b, t]) => t.type === 'vassal' && t.lord === a && st.nations[b]?.alive).map(([b]) => b);
}
export const isVassalOf = (st, a, b) => lordOf(st, a) === b;

// 味方（同盟国・宗主・従属国）
export function friendsOf(st, a) {
  const out = new Set();
  for (const [b, t] of Object.entries(nat(st, a)?.treaties || {})) {
    if (!st.nations[b]?.alive) continue;
    if (t.type === 'alliance' || t.type === 'vassal') out.add(b);
  }
  return [...out];
}

export function treatyLabel(st, a, b) {
  const t = treaty(st, a, b);
  if (t === 'vassal') return isVassalOf(st, a, b) ? '従属（宗主国）' : '従属国';
  if (t === 'tribute') return nat(st, a).treaties[b].payer === a ? '朝貢（納める）' : '朝貢（受ける）';
  if (t) return TREATY_NAMES[t];
  if (atWar(st, a, b)) return '交戦中';
  return '―';
}

// ---------- 贈物 ----------
export function gift(st, from, to, gold) {
  const n = nat(st, from);
  if (n.gold < gold || gold <= 0) return { ok: false, reason: '金が足りません' };
  n.gold -= gold;
  nat(st, to).gold += gold;
  const gain = Math.min(25, Math.round(gold / 25));
  adjustRelation(st, from, to, gain);
  return { ok: true, gain };
}

// ---------- 条約 ----------
export function acceptChance(st, target, from, kind, hostage = null) {
  const bonus = mood(st, target, from).add + hostageBonus(st, hostage);
  const rel = relation(st, target, from);
  const pf = nationPower(st, from), pt = nationPower(st, target);
  const ratio = pf / Math.max(1, pt);
  const aggro = nat(st, target).aggro;
  const sharedEnemy = enemiesOf(st, target).some((e) => atWar(st, from, e)) ? 0.2 : 0;
  if (kind === 'alliance') {
    if (atWar(st, target, from)) return 0;
    const p = (rel - 25) / 60 + (ratio > 1 ? 0.15 : -0.1) - aggro * 0.2 + sharedEnemy + bonus;
    return Math.max(0, Math.min(0.95, p));
  }
  // 停戦
  const p = (rel + 20) / 70 + (ratio > 1.3 ? 0.3 : ratio < 0.7 ? -0.2 : 0) - aggro * 0.15 + bonus + (personality(st, target) === 'cautious' && ratio > 1 ? 0.1 : 0);
  return Math.max(0, Math.min(0.95, p));
}

export function sign(st, a, b, kind, extra = {}) {
  const t = kind === 'alliance' ? { type: 'alliance' }
    : kind === 'vassal' ? { type: 'vassal', lord: extra.lord, since: st.turn }
      : { type: 'truce', until: st.turn + (extra.turns ?? TRUCE_TURNS) };
  nat(st, a).treaties[b] = { ...t };
  nat(st, b).treaties[a] = { ...t };
  delete warsOf(st, a)[b];
  delete warsOf(st, b)[a];
  adjustRelation(st, a, b, 10);
  if (kind === 'vassal') log(st, `${nameOf(st, extra.lord === a ? b : a)}が${nameOf(st, extra.lord)}に臣従した。`, involvesPlayer(st, a, b));
  else log(st, `${nameOf(st, a)}と${nameOf(st, b)}が${TREATY_NAMES[kind]}を結んだ。`, involvesPlayer(st, a, b));
}

export function propose(st, from, to, kind, hostageId = null) {
  if (treaty(st, from, to)) return { ok: false, reason: 'すでに条約があります' };
  const hostage = hostageId ? st.generals[hostageId] : null;
  const p = acceptChance(st, to, from, kind, hostage);
  const ok = chance(st, p);
  if (ok) { sign(st, from, to, kind); if (hostage) giveHostage(st, hostage.id, to); }
  else adjustRelation(st, from, to, -3);
  return { ok, chance: p };
}

export function breakTreaty(st, from, to, { quiet = false } = {}) {
  const t = treaty(st, from, to);
  if (!t) return false;
  const fromWasVassal = t === 'vassal' && isVassalOf(st, from, to);
  const wasMarriage = !!nat(st, from).treaties[to]?.marriage;
  delete nat(st, from).treaties[to];
  delete nat(st, to).treaties[from];
  adjustRelation(st, from, to, -40);
  for (const n of Object.values(st.nations)) if (n.alive && n.id !== from && n.id !== to) adjustRelation(st, from, n.id, -2);
  changeTrust(st, from, t === 'alliance' ? -25 : t === 'truce' ? -15 : fromWasVassal ? -5 : -10);
  onTreatyBroken(st, from, to);
  if (wasMarriage) {
    // 婚姻同盟を破れば信用を大きく失い、相手国から嫁いだ妃との仲も冷える
    changeTrust(st, from, -10);
    for (const c of Object.values(st.consorts || {})) {
      if (c.alive && ((c.nation === from && c.origin === to) || (c.nation === to && c.origin === from))) c.affection = Math.max(0, c.affection - 30);
    }
  }
  if (!quiet) {
    const what = t === 'vassal' ? (fromWasVassal ? '従属関係（独立を宣言）' : '従属関係') : TREATY_NAMES[t];
    log(st, `${nameOf(st, from)}が${nameOf(st, to)}との${what}を破棄した。`, true);
  }
  return true;
}

// ---------- 戦争 ----------
// 宣戦布告。相手の味方への参戦要請を返す（プレイヤーに尋ねる必要があるもの）
export function declareWar(st, a, b, { reason = '' } = {}) {
  if (!a || !b || a === b || atWar(st, a, b)) return [];
  const t = treaty(st, a, b);
  if (t) breakTreaty(st, a, b, { quiet: true });
  warsOf(st, a)[b] = { since: st.turn, taken: 0 };
  warsOf(st, b)[a] = { since: st.turn, taken: 0 };
  endPact(st, a, b, true);
  adjustRelation(st, a, b, -20);
  log(st, `${nameOf(st, a)}が${nameOf(st, b)}に宣戦布告した。${t ? `（${TREATY_NAMES[t]}を破って）` : ''}${reason}`, involvesPlayer(st, a, b));
  // 参戦要請：守る側の味方が先、攻める側の味方も呼応する
  const calls = [];
  for (const [side, enemy] of [[b, a], [a, b]]) {
    for (const c of friendsOf(st, side)) {
      if (c === enemy || atWar(st, c, enemy)) continue;
      if (treaty(st, c, enemy) === 'alliance' || isVassalOf(st, enemy, c) || isVassalOf(st, c, enemy)) continue; // 双方の味方なら中立
      calls.push({ caller: side, ally: c, enemy });
    }
  }
  const forPlayer = [];
  for (const call of calls) {
    if (call.ally === st.playerNation) { forPlayer.push(call); continue; }
    const vassal = isVassalOf(st, call.ally, call.caller);
    const p = vassal ? 0.95 : 0.35 + relation(st, call.ally, call.caller) / 150 + (call.caller === b ? 0.2 : 0);
    if (chance(st, p)) joinWar(st, call.ally, call.caller, call.enemy);
    else adjustRelation(st, call.ally, call.caller, -10);
  }
  return forPlayer;
}

export function joinWar(st, ally, caller, enemy) {
  if (atWar(st, ally, enemy)) return;
  if (treaty(st, ally, enemy)) breakTreaty(st, ally, enemy, { quiet: true });
  warsOf(st, ally)[enemy] = { since: st.turn, taken: 0 };
  warsOf(st, enemy)[ally] = { since: st.turn, taken: 0 };
  endPact(st, ally, enemy, true);
  changeTrust(st, ally, 4);
  adjustRelation(st, ally, enemy, -25);
  adjustRelation(st, ally, caller, 8);
  log(st, `${nameOf(st, ally)}が${nameOf(st, caller)}の要請に応じ、${nameOf(st, enemy)}との戦いに参戦した。`, involvesPlayer(st, ally, caller, enemy));
}

export function refuseCall(st, ally, caller) {
  adjustRelation(st, ally, caller, -25);
  changeTrust(st, ally, -8);
  const t = treaty(st, ally, caller);
  if (t === 'alliance' && relation(st, ally, caller) < 0) {
    breakTreaty(st, caller, ally, { quiet: true });
    log(st, `参戦を拒んだ${nameOf(st, ally)}に${nameOf(st, caller)}は失望し、同盟を解消した。`, true);
  }
}

// 地方を奪った記録（和平交渉の材料）
export function noteConquest(st, winner, loser) {
  if (!atWar(st, winner, loser)) return;
  warsOf(st, winner)[loser].taken += 1;
  warsOf(st, loser)[winner].taken -= 1;
}

// 戦況：a から見た b との戦いの有利さ（1 で互角）
export function warScore(st, a, b) {
  const ratio = (nationPower(st, a) + 200) / (nationPower(st, b) + 200);
  const taken = warsOf(st, a)[b]?.taken ?? 0;
  return ratio * (1 + 0.25 * taken);
}

// ---------- 和平交渉 ----------
// terms: { kind: 'white'|'payGold'|'demandGold'|'cede'|'vassal', gold, province }
export function peaceChance(st, from, to, terms) {
  if (!atWar(st, from, to)) return 0;
  const sTo = warScore(st, to, from); // 受け手から見た戦況
  const w = warsOf(st, to)[from];
  const tired = Math.min(0.3, (st.turn - (w?.since ?? st.turn)) * 0.02);
  const rel = relation(st, to, from);
  let p;
  switch (terms.kind) {
    case 'white': p = 0.55 - (sTo - 1) * 0.35 + tired + rel / 300; break;
    case 'payGold': {
      const inc = Math.max(200, nat(st, to).lastIncome?.gold ?? 400);
      p = 0.35 - (sTo - 1) * 0.3 + tired + Math.min(0.5, terms.gold / inc * 0.15);
      break;
    }
    case 'demandGold': p = (1.5 - sTo) * 0.6 + tired - 0.1; break;
    case 'cede': p = (0.8 - sTo) * 0.9 + tired - (nationProvinces(st, to).length <= 1 ? 1 : 0); break;
    case 'vassal': p = (0.5 - sTo) * 1.2 + tired - nat(st, to).aggro * 0.2; break;
    default: p = 0;
  }
  if (nat(st, to).id === st.playerNation) return 1;
  p += PERSONALITIES[personality(st, to)].peace ?? 0;
  // 厳しい条件は、実際に戦って成果を上げてから
  const harsh = ['demandGold', 'cede', 'vassal'].includes(terms.kind);
  if (harsh && st.turn - (w?.since ?? st.turn) < 2 && (warsOf(st, from)[to]?.taken ?? 0) <= 0) p *= 0.25;
  return Math.max(0, Math.min(0.95, p));
}

export function cedeCandidates(st, from, to) {
  // to が from に割譲できる地方：from の領地に隣接するもの
  return nationProvinces(st, to).filter((p) => NEIGHBORS[p.id].some((q) => st.provinces[q].owner === from)).map((p) => p.id);
}

export function applyPeace(st, from, to, terms) {
  delete warsOf(st, from)[to];
  delete warsOf(st, to)[from];
  let desc = '白紙講和';
  if (terms.kind === 'payGold') {
    const g = Math.min(terms.gold, nat(st, from).gold);
    nat(st, from).gold -= g; nat(st, to).gold += g;
    desc = `${nameOf(st, from)}が賠償金${g}を支払う`;
  } else if (terms.kind === 'demandGold') {
    const g = Math.min(terms.gold, nat(st, to).gold);
    nat(st, to).gold -= g; nat(st, from).gold += g;
    desc = `${nameOf(st, to)}が賠償金${g}を支払う`;
  } else if (terms.kind === 'cede' && terms.province && st.provinces[terms.province].owner === to) {
    for (const g of nationGenerals(st, to).filter((x) => x.province === terms.province)) {
      const esc = NEIGHBORS[terms.province].find((q) => st.provinces[q].owner === to);
      if (esc) g.province = esc; else { g.nation = null; g.unit = null; }
    }
    changeOwner(st, terms.province, from);
    desc = `${nameOf(st, to)}が${PROV_DEF[terms.province].city}を割譲する`;
    checkNationAlive(st, to, from);
  } else if (terms.kind === 'vassal') {
    sign(st, from, to, 'vassal', { lord: from });
    desc = `${nameOf(st, to)}が${nameOf(st, from)}に臣従する`;
  }
  if (terms.kind !== 'vassal') sign(st, from, to, 'truce');
  changeTrust(st, from, 1); changeTrust(st, to, 1);
  adjustRelation(st, from, to, 15);
  log(st, `${nameOf(st, from)}と${nameOf(st, to)}が和平を結んだ（${desc}）。`, involvesPlayer(st, from, to));
  return desc;
}

export function proposePeace(st, from, to, terms) {
  const p = peaceChance(st, from, to, terms);
  if (!chance(st, p)) { adjustRelation(st, from, to, -2); return { ok: false, chance: p }; }
  return { ok: true, chance: p, desc: applyPeace(st, from, to, terms) };
}

// ---------- 従属 ----------
// from が to に臣従を申し出る
export function submitChance(st, from, to) {
  if (lordOf(st, from) || vassalsOf(st, from).length) return 0;
  const ratio = nationPower(st, to) / Math.max(1, nationPower(st, from));
  return Math.max(0, Math.min(0.95, 0.3 + (ratio - 1.5) * 0.25 + relation(st, to, from) / 200));
}
// from が to に従属を要求する
export function demandChance(st, from, to) {
  if (lordOf(st, to) || vassalsOf(st, to).length || lordOf(st, from) === to) return 0;
  const ratio = nationPower(st, from) / Math.max(1, nationPower(st, to));
  const threat = atWar(st, from, to) ? 0.15 : 0;
  return Math.max(0, Math.min(0.9, (ratio - 2.5) * 0.18 + threat + relation(st, to, from) / 250 - nat(st, to).aggro * 0.2 - (nationProvinces(st, to).length - 1) * 0.08));
}
export function offerSubmission(st, from, to) {
  const p = submitChance(st, from, to);
  if (!chance(st, p)) return { ok: false, chance: p };
  sign(st, from, to, 'vassal', { lord: to });
  return { ok: true, chance: p };
}
export function demandVassal(st, from, to) {
  const p = demandChance(st, from, to);
  if (!chance(st, p)) {
    adjustRelation(st, from, to, -15);
    return { ok: false, chance: p };
  }
  sign(st, from, to, 'vassal', { lord: from });
  return { ok: true, chance: p };
}
export function declareIndependence(st, vassal) {
  const lord = lordOf(st, vassal);
  if (!lord) return [];
  breakTreaty(st, vassal, lord);
  return declareWar(st, lord, vassal, { reason: '（独立を認めず）' });
}

// 宗主による併合（長く従属し、関係が良好な小国）
export function annexChance(st, lord, vassal) {
  const t = nat(st, lord).treaties[vassal];
  if (!t || t.type !== 'vassal' || t.lord !== lord) return 0;
  const years = (st.turn - (t.since ?? st.turn)) / 4;
  if (years < 3 || nationProvinces(st, vassal).length > 3) return 0;
  return Math.max(0, Math.min(0.9, (relation(st, vassal, lord) - 40) / 80 + (years - 3) * 0.05));
}
export function annexVassal(st, lord, vassal) {
  const p = annexChance(st, lord, vassal);
  if (!chance(st, p)) { adjustRelation(st, lord, vassal, -10); return { ok: false, chance: p }; }
  for (const p2 of nationProvinces(st, vassal)) changeOwner(st, p2.id, lord);
  for (const g of Object.values(st.generals)) if (g.nation === vassal && g.alive) { g.nation = lord; g.loyalty = 70; }
  nat(st, vassal).alive = false;
  log(st, `${nameOf(st, vassal)}は${nameOf(st, lord)}に併合された。`, true);
  return { ok: true, chance: p };
}

// 季節ごと：朝貢と友好度の変化
export function diplomacyTick(st) {
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const lord = lordOf(st, n.id);
    if (lord) {
      const t = Math.round(Math.max(0, n.lastIncome?.gold ?? 0) * TRIBUTE_RATE);
      const paid = Math.min(t, n.gold);
      n.gold -= paid;
      nat(st, lord).gold += paid;
      n.lastTribute = paid;
    } else n.lastTribute = 0;
  }
  statecraftTick(st);
  const alive = Object.values(st.nations).filter((n) => n.alive);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i].id, b = alive[j].id;
    const r = relation(st, a, b);
    let d = 0;
    if (atWar(st, a, b)) d = -1;
    else if (treaty(st, a, b)) d = r < 60 ? 1 : 0;
    else if (r > 0) d = -1; else if (r < 0) d = 1;
    if (d) adjustRelation(st, a, b, d);
  }
}

// ---------- 覇権国と包囲網 ----------
export function hegemon(st) {
  const list = Object.values(st.nations).filter((n) => n.alive).map((n) => ({ id: n.id, prov: nationProvinces(st, n.id).length, pow: nationPower(st, n.id) }))
    .sort((a, b) => b.pow - a.pow);
  if (list.length < 2) return null;
  const top = list[0];
  if (top.prov >= Math.ceil(PROVINCES.length * 0.2) && top.pow > list[1].pow * 1.6) return top.id;
  return null;
}

// ---------- AI の外交。プレイヤー宛ての提案を返す ----------
export function aiDiplomacy(st, nid) {
  const out = [];
  const me = nat(st, nid);
  const neigh = Object.values(st.nations).filter((n) => n.alive && n.id !== nid && areNeighbors(st, nid, n.id));
  const m = aiMarriage(st, nid, neigh.map((n) => n.id));
  if (m) out.push(m);
  const player = st.playerNation;

  // 戦争中の相手との講和・臣従
  for (const e of enemiesOf(st, nid)) {
    const w = warsOf(st, nid)[e];
    if (st.turn - w.since < 3) continue;
    const s = warScore(st, nid, e);
    if (s < 0.35 && nationProvinces(st, nid).length <= 2 && !lordOf(st, nid) && chance(st, 0.35)) {
      if (e === player) out.push({ from: nid, kind: 'submit' });
      else if (chance(st, submitChance(st, nid, e) + 0.3)) { applyPeace(st, e, nid, { kind: 'vassal' }); }
      continue;
    }
    if (s < 0.8 && chance(st, 0.25)) {
      const gold = Math.round(Math.min(me.gold * 0.4, 400 + (0.8 - s) * 1500) / 50) * 50;
      const terms = gold >= 100 ? { kind: 'payGold', gold } : { kind: 'white' };
      if (e === player) out.push({ from: nid, kind: 'peace', terms });
      else proposePeace(st, nid, e, terms);
    } else if (s > 2.2 && e === player && chance(st, 0.15)) {
      out.push({ from: nid, kind: 'peace', terms: { kind: 'demandGold', gold: Math.round(Math.min(nat(st, player).gold * 0.5, 1500) / 50) * 50 } });
    }
  }

  // 包囲網：覇権国の隣国どうしが手を組む
  const heg = hegemon(st);
  if (heg && heg !== nid && areNeighbors(st, nid, heg) && !lordOf(st, nid)) {
    adjustRelation(st, nid, heg, -2);
    me.coalition = heg;
    if (chance(st, 0.2)) {
      const partners = neigh.filter((n) => n.id !== heg && areNeighbors(st, n.id, heg) && !treaty(st, nid, n.id) && !atWar(st, nid, n.id) && relation(st, nid, n.id) > -30 && n.id !== player);
      if (partners.length) {
        const p = pick(st, partners);
        sign(st, nid, p.id, 'alliance');
        adjustRelation(st, nid, p.id, 10);
        log(st, `${me.name}と${p.name}が、強大化する${nameOf(st, heg)}に対抗して手を結んだ（${nameOf(st, heg)}包囲網）。`, heg === player);
      } else if (heg !== player) {
        // プレイヤーも包囲網に誘う
        const invite = neigh.find((n) => n.id === player && areNeighbors(st, player, heg) && !treaty(st, nid, player) && !atWar(st, nid, player));
        if (invite && chance(st, 0.5)) out.push({ from: nid, kind: 'alliance', coalition: heg });
      }
    }
    // 覇権国が包囲網の誰かと戦っていれば加勢する
    const fighting = enemiesOf(st, heg).filter((x) => treaty(st, nid, x) === 'alliance');
    if (fighting.length && !atWar(st, nid, heg) && !treaty(st, nid, heg) && chance(st, 0.3)) {
      const calls = declareWar(st, nid, heg, { reason: '（包囲網として）' });
      void calls;
    }
  }

  // 強国は弱い隣国に従属を迫る
  if (me.aggro >= 0.5 && chance(st, 0.06)) {
    const weak = neigh.filter((n) => !treaty(st, nid, n.id) && !lordOf(st, n.id) && !vassalsOf(st, n.id).length && nationPower(st, nid) > nationPower(st, n.id) * 3);
    if (weak.length) {
      const t = pick(st, weak);
      if (t.id === player) out.push({ from: nid, kind: 'demand' });
      else demandVassal(st, nid, t.id);
    }
  }

  // 宗主による併合
  for (const v of vassalsOf(st, nid)) if (v !== player && chance(st, 0.1)) {
    const p = annexChance(st, nid, v);
    if (p > 0.4) annexVassal(st, nid, v);
  }

  out.push(...aiStatecraft(st, nid, { hegemon, areNeighbors, breakTreaty, declareWar, sign }));

  // 従来の同盟・停戦の申し入れ
  if (!chance(st, 0.12)) return out;
  if (!neigh.length) return out;
  const target = neigh[Math.floor(rnd(st) * neigh.length)];
  if (treaty(st, nid, target.id) || atWar(st, nid, target.id)) return out;
  const rel = relation(st, nid, target.id);
  const myPow = nationPower(st, nid), theirPow = nationPower(st, target.id);
  let kind = null;
  if (rel > 35 && me.aggro < 0.7) kind = 'alliance';
  else if (theirPow > myPow * 1.4) kind = 'truce';
  if (!kind) return out;
  if (target.id === player) out.push({ from: nid, kind });
  else propose(st, nid, target.id, kind);
  return out;
}

setRoyalHooks({ sign, relation: adjustRelation });
