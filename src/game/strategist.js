// 軍師：見立て（成功率の見通し）・離間の計・流言・助言
import { NEIGHBORS } from './geo.js';
import { chance, rnd } from './rng.js';
import { PROV_DEF, generalsIn, nationProvinces, stackPower, treaty, log } from './state.js';
import { adjustRelation } from './military.js';
import { atWar, breakTreaty, friendsOf, enemiesOf } from './diplomacy.js';
import { roleHolder, rebelRisk, hasTrait } from './personnel.js';
import { adminOf } from './admin.js';

export const strategistOf = (st, nid) => roleHolder(st, nid, 'strategist');
const canAct = (st, g) => g && !g.moved && !(g.wound > st.turn) && !g.captiveOf;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// ---- 見立て ----
// 軍師がいなければ null。いれば政治力に応じた幅の見通し（政治100なら正確）
export function foresee(st, nid, p, key, bonus = 0) {
  const s = strategistOf(st, nid);
  if (!s) return null;
  const pol = Math.min(100, s.pol + bonus);
  const w = Math.max(0, 100 - pol) / 100 * 0.6;
  const off = (hash(`${key}:${st.turn}`) - 0.5) * w;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const lo = cl(p - w / 2 + off), hi = cl(p + w / 2 + off);
  return { lo, hi, by: s.name };
}

export function chanceText(st, nid, p, key, bonus = 0) {
  const f = foresee(st, nid, p, key, bonus);
  if (!f) return '<span class="muted" title="軍師がいないと見通せません">？</span>';
  const lo = Math.round(f.lo * 100), hi = Math.round(f.hi * 100);
  const t = hi - lo <= 2 ? `${Math.round(p * 100)}%` : `${lo}〜${hi}%`;
  return `<span title="軍師${f.by}の見立て">${t}</span>`;
}

// ---- 離間の計 ----
export const DISCORD_COST = 400;
export function discordChance(st, nid, a, b) {
  const s = strategistOf(st, nid);
  if (!s) return 0;
  const guard = Math.max(strategistOf(st, a)?.pol ?? 0, strategistOf(st, b)?.pol ?? 0);
  let p = 0.25 + (s.pol - 50) / 100 - Math.max(0, guard - 50) / 150;
  const rel = st.nations[a].relations[b] ?? 0;
  p += rel < 20 ? 0.1 : rel > 60 ? -0.1 : 0;
  if (treaty(st, a, b) === 'alliance') p -= 0.1;
  if (hasTrait(s, 'cunning')) p += 0.1;
  return Math.max(0.05, Math.min(0.8, p));
}
export function discordAvailable(st, nid, a, b) {
  const s = strategistOf(st, nid);
  if (!s) return { ok: false, reason: '軍師がいません' };
  if (!canAct(st, s)) return { ok: false, reason: `軍師${s.name}はこの季節は動けません` };
  if (st.nations[nid].gold < DISCORD_COST) return { ok: false, reason: '金が足りません' };
  if (a === b || !st.nations[a]?.alive || !st.nations[b]?.alive || a === nid || b === nid) return { ok: false, reason: '相手を選んでください' };
  if (treaty(st, a, b) === 'vassal') return { ok: false, reason: '主従の間は裂けません' };
  return { ok: true };
}
// 二国の間に偽りの噂を流し、仲を裂く
export function sowDiscord(st, nid, a, b) {
  const av = discordAvailable(st, nid, a, b);
  if (!av.ok) return av;
  const s = strategistOf(st, nid);
  st.nations[nid].gold -= DISCORD_COST;
  s.moved = true;
  const na = st.nations[a].name, nb = st.nations[b].name;
  const involved = [a, b].includes(st.playerNation);
  if (rnd(st) < discordChance(st, nid, a, b)) {
    adjustRelation(st, a, b, -(30 + Math.round(s.pol / 5)));
    let text = `離間の計が成功し、${na}と${nb}の仲は険悪になった。`;
    const t = treaty(st, a, b);
    if ((t === 'alliance' || t === 'truce') && (st.nations[a].relations[b] ?? 0) < 0) {
      breakTreaty(st, a, b, { quiet: true });
      log(st, `${na}と${nb}の${t === 'alliance' ? '同盟' : '停戦'}が決裂した。`, true);
      text = `離間の計が成功し、${na}と${nb}の${t === 'alliance' ? '同盟' : '停戦'}は決裂した！`;
    } else if (involved) log(st, `（流言が飛び交い、${na}と${nb}の関係が悪化した）`, true);
    return { ok: true, success: true, text };
  }
  const exposed = chance(st, 0.5);
  if (exposed) { adjustRelation(st, nid, a, -10); adjustRelation(st, nid, b, -10); }
  return { ok: true, success: false, text: `離間の計は失敗した。${exposed ? `${na}と${nb}は${st.nations[nid].name}の謀略に気づいた。` : ''}` };
}

// ---- 流言 ----
export const RUMOR_COST = 200;
export function rumorTargets(st, nid) {
  const own = new Set(nationProvinces(st, nid).map((p) => p.id));
  return Object.values(st.provinces).filter((p) => p.owner && p.owner !== nid && NEIGHBORS[p.id].some((q) => own.has(q))).map((p) => p.id);
}
export function rumorChance(st, nid, pid) {
  const s = strategistOf(st, nid);
  if (!s) return 0;
  const p = st.provinces[pid];
  const gov = p.governorId ? st.generals[p.governorId] : null;
  const their = strategistOf(st, p.owner);
  let c = 0.35 + (s.pol - (gov?.pol ?? 40)) / 150 - Math.max(0, (their?.pol ?? 0) - 60) / 200;
  if (hasTrait(s, 'cunning')) c += 0.1;
  return Math.max(0.05, Math.min(0.85, c));
}
export function rumorAvailable(st, nid, pid) {
  const s = strategistOf(st, nid);
  if (!s) return { ok: false, reason: '軍師がいません' };
  if (!canAct(st, s)) return { ok: false, reason: `軍師${s.name}はこの季節は動けません` };
  if (st.nations[nid].gold < RUMOR_COST) return { ok: false, reason: '金が足りません' };
  if (!rumorTargets(st, nid).includes(pid)) return { ok: false, reason: '隣接する他国の地方にしか流せません' };
  if (st.provinces[pid].rumorTurn === st.turn) return { ok: false, reason: 'この季節はすでに流言が飛んでいます' };
  return { ok: true };
}
// 敵の城下に流言を放ち、民忠と治安を下げる
export function spreadRumor(st, nid, pid) {
  const av = rumorAvailable(st, nid, pid);
  if (!av.ok) return av;
  const s = strategistOf(st, nid);
  const p = st.provinces[pid];
  const c = adminOf(p.city);
  st.nations[nid].gold -= RUMOR_COST;
  s.moved = true;
  p.rumorTurn = st.turn;
  const city = PROV_DEF[pid].city;
  if (rnd(st) < rumorChance(st, nid, pid)) {
    const dl = 8 + Math.round(s.pol / 10), dor = 10 + Math.round(s.pol / 8);
    c.loyalty = Math.max(0, c.loyalty - dl);
    c.order = Math.max(0, c.order - dor);
    if (p.owner === st.playerNation) log(st, `【${city}】不穏な流言が広まり、民心が乱れている（民忠-${dl}・治安-${dor}）。`, true);
    return { ok: true, success: true, text: `${city}に流言が広まった（民忠-${dl}・治安-${dor}）。` };
  }
  adjustRelation(st, nid, p.owner, -8);
  const det = strategistOf(st, p.owner);
  if (p.owner === st.playerNation && det) log(st, `軍師${det.name}が${st.nations[nid].name}の流言を見抜き、${city}の動揺を鎮めた。`, true);
  return { ok: true, success: false, text: `${city}への流言は広まらなかった。` };
}

// ---- AI ----
export function aiStrategist(st, nid) {
  const nat = st.nations[nid];
  const s = strategistOf(st, nid);
  if (!canAct(st, s) || nat.gold < 1500) return;
  const enemies = enemiesOf(st, nid).filter((e) => st.nations[e]?.alive);
  if (!enemies.length) return;
  if (chance(st, 0.1)) {
    // 敵とその同盟国の仲を裂く
    for (const e of enemies) {
      const f = friendsOf(st, e).find((x) => x !== nid && treaty(st, e, x) === 'alliance');
      if (f && discordAvailable(st, nid, e, f).ok && discordChance(st, nid, e, f) > 0.3) { sowDiscord(st, nid, e, f); return; }
    }
  }
  if (chance(st, 0.15)) {
    const ts = rumorTargets(st, nid).filter((pid) => enemies.includes(st.provinces[pid].owner) && rumorAvailable(st, nid, pid).ok);
    ts.sort((a, b) => st.provinces[a].city.loyalty - st.provinces[b].city.loyalty);
    if (ts.length) spreadRumor(st, nid, ts[0]);
  }
}

// ---- 助言 ----
// 軍師が季節の始めに気づいたことを知らせる。政治力が高いほど多くのことに気づく
export function strategistAdvice(st, nid) {
  const s = strategistOf(st, nid);
  if (!s) return null;
  const nat = st.nations[nid];
  const items = [];
  const add = (pri, text) => items.push({ pri, text });
  const mine = nationProvinces(st, nid);
  // 内通が露見している家臣
  for (const g of Object.values(st.generals)) {
    if (g.alive && g.nation === nid && g.exposed && g.betray) add(100, `${g.name}は${st.nations[g.betray]?.name ?? '他国'}と内通しています。家臣団で詰問するか追放を。`);
  }
  // 謀反・出奔のおそれ
  for (const g of Object.values(st.generals)) {
    if (!g.alive || g.nation !== nid || g.family || nat.rulerId === g.id) continue;
    if (rebelRisk(st, g) > 0) add(90, `${g.name}（忠誠${g.loyalty}）が謀反を企てているかもしれません。`);
    else if (g.loyalty < 40) add(60, `${g.name}の忠誠が揺らいでいます（${g.loyalty}）。出奔や敵の調略に注意を。`);
  }
  // 侵攻の気配と攻めどき
  for (const p of mine) {
    const myPow = stackPower(st, p.id, nid);
    for (const q of NEIGHBORS[p.id]) {
      const o = st.provinces[q].owner;
      if (!o || o === nid) continue;
      const hostile = atWar(st, nid, o) || (nat.relations[o] ?? 0) < -30;
      if (!hostile) continue;
      const theirs = stackPower(st, q, o);
      if (theirs > myPow * 1.3 && theirs > 3000) add(80 + Math.min(10, theirs / Math.max(1, myPow)), `${st.nations[o].name}が${PROV_DEF[q].city}に兵を集めています。${PROV_DEF[p.id].city}が狙われるかもしれません。`);
      else if (atWar(st, nid, o) && myPow > theirs * 2 && myPow > 2000) add(50, `${PROV_DEF[q].city}（${st.nations[o].name}）は守りが手薄です。攻めどきかもしれません。`);
    }
  }
  // 内政
  for (const p of mine) {
    const c = adminOf(p.city);
    if (st.season === 0 && c.grid.some((t) => t.t === 'river') && c.irrigation < 30) add(40, `夏に${PROV_DEF[p.id].city}の川が氾濫するおそれがあります。治水を。`);
    if (c.order < 35) add(55, `${PROV_DEF[p.id].city}の治安が乱れています（${c.order}）。巡察を。`);
    if (c.loyalty < 35) add(58, `${PROV_DEF[p.id].city}の民が不満を募らせています（民忠${c.loyalty}）。反乱に注意を。`);
  }
  const soldiers = Object.values(st.generals).filter((g) => g.alive && g.nation === nid).reduce((a, g) => a + (g.unit?.soldiers ?? 0), 0);
  const net = (nat.lastIncome?.food ?? 0) - soldiers * 0.1;
  if (net < 0 && nat.food < -net * 3) add(70, `兵糧が心もとありません。このままでは${Math.max(1, Math.floor(nat.food / -net))}季ほどで尽きます。`);
  const n = 1 + Math.floor(s.pol / 30);
  const seen = new Set();
  const lines = items.sort((a, b) => b.pri - a.pri).filter((x) => !seen.has(x.text) && seen.add(x.text)).slice(0, n).map((x) => x.text);
  return { by: s.name, lines: lines.length ? lines : ['いまのところ、特に憂うべきことはございません。'] };
}
