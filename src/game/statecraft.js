// 外交の拡張：君主の気質・因縁・信用・通商条約・朝貢・人質・取引・外交イベント
import { chance, pick } from './rng.js';
import { NEIGHBORS } from './geo.js';
import { PROVINCES } from './data.js';
import { PROV_DEF, nationProvinces, nationGenerals, treaty, relation, log } from './state.js';
import { adjustRelation, changeOwner, checkNationAlive, killGeneral } from './military.js';
import { hasTrait } from './personnel.js';
import { nationReligion, RELIGIONS } from './admin.js';

const nat = (st, id) => st.nations[id];
const nameOf = (st, id) => st.nations[id]?.name ?? '';
const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));

// ---------- 君主の気質 ----------
export const PERSONALITIES = {
  honorable: { name: '信義に厚い', desc: '約束を重んじ、条約を破らない。相手の信用を重く見る', treaty: 0.1, trust: 1.5 },
  treacherous: { name: '背信の気あり', desc: '有利と見れば条約を破って攻めてくる。信用を気にしない', treaty: -0.05, trust: 0.5 },
  scheming: { name: '策謀家', desc: '取引では強欲。謀略を好む', treaty: 0, trust: 1, greed: 1.25 },
  peaceful: { name: '温厚', desc: '和平・停戦を好み、贈物を送ってくることもある', treaty: 0.1, trust: 1.2, peace: 0.15 },
  warlike: { name: '好戦的', desc: '条約を好まず、弱い相手には従属や朝貢を迫る', treaty: -0.1, trust: 0.8, peace: -0.1 },
  cautious: { name: '慎重', desc: '強い相手とは争わず、停戦を結びたがる', treaty: 0.05, trust: 1.2 },
  pragmatic: { name: '実利を重んじる', desc: '損得で判断する。通商や取引に応じやすい', treaty: 0, trust: 1, trade: 0.15 },
};
export function personality(st, nid) {
  const n = nat(st, nid);
  const r = n ? st.generals[n.rulerId] : null;
  if (r) {
    if (hasTrait(r, 'loyal')) return 'honorable';
    if (hasTrait(r, 'ambitious')) return 'treacherous';
    if (hasTrait(r, 'cunning')) return 'scheming';
    if (hasTrait(r, 'benevolent')) return 'peaceful';
  }
  const a = n?.aggro ?? 0.5;
  return a >= 0.65 ? 'warlike' : a <= 0.3 ? 'cautious' : 'pragmatic';
}

// ---------- 因縁 ----------
const RIVAL_PAIRS = [
  ['kiyat', 'tatar'], ['kiyat', 'merkit'], ['kiyat', 'jin'], ['kereit', 'naiman'], ['jin', 'song'], ['jin', 'xia'],
  ['kamakura', 'oshu'], ['khwarezm', 'ghurid'], ['khwarezm', 'abbasid'], ['khwarezm', 'khitai'], ['ghurid', 'chahamana'],
  ['ayyubid', 'england'], ['ayyubid', 'france'], ['ayyubid', 'hre'], ['byzantium', 'rum'], ['georgia', 'eldiguzid'],
  ['kiev', 'kipchak'], ['vladimir', 'bulgar'], ['latin', 'byzantium'],
];
const RIVALS = new Set(RIVAL_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
export const isRival = (a, b) => RIVALS.has(`${a}|${b}`);
export function bonds(st, a, b) {
  const out = [];
  if (isRival(a, b)) out.push(['宿敵', -0.25]);
  const na = nat(st, a), nb = nat(st, b);
  if (na && nb && na.culture === nb.culture) out.push(['同族', 0.08]);
  const ra = nationReligion(st, a), rb = nationReligion(st, b);
  if (ra !== rb && !RELIGIONS[ra].tolerant && !RELIGIONS[rb].tolerant) out.push(['異教', -0.08]);
  return out;
}
// 新規ゲーム：宿敵どうしは関係が悪い
export function initStatecraft(st) {
  for (const [a, b] of RIVAL_PAIRS) {
    if (st.nations[a]?.alive && st.nations[b]?.alive) adjustRelation(st, a, b, -30);
  }
}

// ---------- 信用 ----------
export const trustOf = (st, nid) => nat(st, nid)?.trust ?? 60;
export function changeTrust(st, nid, d) {
  const n = nat(st, nid);
  if (!n) return;
  n.trust = Math.max(0, Math.min(100, (n.trust ?? 60) + d));
}

// 相手（target）が from の申し出を受ける気になるかの補正と内訳
export function mood(st, target, from, kind = 'treaty') {
  const P = PERSONALITIES[personality(st, target)];
  const items = [];
  if (kind === 'treaty' && P.treaty) items.push([P.name, P.treaty]);
  if (kind === 'trade' && P.trade) items.push([P.name, P.trade]);
  const tr = (trustOf(st, from) - 60) / 150 * (P.trust ?? 1);
  if (Math.abs(tr) >= 0.01) items.push([`信用${trustOf(st, from)}`, tr]);
  items.push(...bonds(st, target, from));
  return { add: items.reduce((s, [, v]) => s + v, 0), items };
}

// ---------- 通商条約 ----------
export const pactsOf = (st, a) => (nat(st, a).pacts ??= {});
export const hasPact = (st, a, b) => !!(a && b && nat(st, a)?.pacts?.[b] && st.nations[b]?.alive);
export function pactChance(st, target, from) {
  if (atWarLocal(st, target, from) || hasPact(st, target, from)) return 0;
  const rel = relation(st, target, from);
  const p = 0.2 + rel / 100 + mood(st, target, from, 'trade').add;
  return Math.max(0, Math.min(0.95, p));
}
export function signPact(st, a, b) {
  pactsOf(st, a)[b] = { since: st.turn };
  pactsOf(st, b)[a] = { since: st.turn };
  adjustRelation(st, a, b, 5);
  log(st, `${nameOf(st, a)}と${nameOf(st, b)}が通商条約を結んだ。`, [a, b].includes(st.playerNation));
}
export function endPact(st, a, b, byWar = false) {
  if (!hasPact(st, a, b)) return;
  delete pactsOf(st, a)[b];
  delete pactsOf(st, b)[a];
  if (!byWar) { adjustRelation(st, a, b, -10); changeTrust(st, a, -3); }
}
export function proposePact(st, from, to) {
  const p = pactChance(st, to, from);
  if (chance(st, p)) { signPact(st, from, to); return { ok: true, chance: p }; }
  adjustRelation(st, from, to, -2);
  return { ok: false, chance: p };
}
function atWarLocal(st, a, b) { return !!nat(st, a)?.wars?.[b]; }

// ---------- 朝貢 ----------
export const LIGHT_TRIBUTE = 0.1;
export function tributeChance(st, from, to) {
  // from が to に朝貢を要求する
  if (treaty(st, from, to) || atWarLocal(st, from, to)) return 0;
  const ratio = powerOf(st, from) / Math.max(1, powerOf(st, to));
  const P = PERSONALITIES[personality(st, to)];
  let p = (ratio - 1.8) * 0.25 + relation(st, to, from) / 250 - (nat(st, to).aggro ?? 0.5) * 0.2;
  if (P === PERSONALITIES.cautious || P === PERSONALITIES.peaceful) p += 0.1;
  if (isRival(from, to)) p -= 0.2;
  return Math.max(0, Math.min(0.9, p));
}
export function signTribute(st, receiver, payer) {
  const t = { type: 'tribute', receiver, payer, since: st.turn };
  nat(st, receiver).treaties[payer] = { ...t };
  nat(st, payer).treaties[receiver] = { ...t };
  adjustRelation(st, receiver, payer, 5);
  log(st, `${nameOf(st, payer)}が${nameOf(st, receiver)}に朝貢することになった。`, [receiver, payer].includes(st.playerNation));
}
export function tributeInfo(st, a, b) {
  const t = nat(st, a)?.treaties?.[b];
  return t?.type === 'tribute' ? t : null;
}

// ---------- 人質 ----------
export const hostagesHeldBy = (st, holder) => Object.values(st.generals).filter((g) => g.alive && g.hostageOf === holder);
export const hostagesFrom = (st, giver, holder) => Object.values(st.generals).filter((g) => g.alive && g.nation === giver && g.hostageOf === holder);
export function hostageBonus(st, g) {
  if (!g) return 0;
  const n = nat(st, g.nation);
  return g.family || n?.rulerId === g.id ? 0.3 : 0.15;
}
export function candidateHostages(st, nid) {
  const n = nat(st, nid);
  return nationGenerals(st, nid).filter((g) => g.id !== n.rulerId && !g.hostageOf && !g.besieging && !(g.wound > st.turn));
}
export function giveHostage(st, gid, holder) {
  const g = st.generals[gid];
  g.hostageOf = holder;
  g.hostageHome = g.province;
  g.province = nat(st, holder).capital;
  g.unit = null;
  for (const p of Object.values(st.provinces)) if (p.governorId === g.id) p.governorId = null;
  log(st, `${nameOf(st, g.nation)}の${g.name}が人質として${nameOf(st, holder)}に送られた。`, [g.nation, holder].includes(st.playerNation));
}
export function returnHostage(st, g, note = '') {
  const home = nat(st, g.nation);
  delete g.hostageOf;
  g.province = home?.alive ? home.capital : g.province;
  delete g.hostageHome;
  if (note) log(st, `${g.name}が人質から戻った。${note}`, g.nation === st.playerNation);
}
// 条約を破った側の人質は処断され、破られた側の人質は返される
export function onTreatyBroken(st, from, to) {
  for (const g of hostagesFrom(st, from, to)) {
    log(st, `${nameOf(st, from)}が約束を破ったため、人質の${g.name}は${nameOf(st, to)}に処断された。`, true);
    killGeneral(st, g.id);
  }
  for (const g of hostagesFrom(st, to, from)) returnHostage(st, g, '（相手が約束を破ったため）');
}

// ---------- 取引 ----------
// offer: { give: {gold, province, horses}, get: {gold, province, horses} }（from から見て）
export function provinceValue(st, pid) {
  const p = st.provinces[pid];
  return Math.round(p.city.pop * 0.15 + PDEF[pid].specValue * 20 + p.city.walls * 300 + 500);
}
export function tradeableProvinces(st, owner, other) {
  const n = nat(st, owner);
  return nationProvinces(st, owner).filter((p) => p.id !== n.capital && !st.sieges?.[p.id] && NEIGHBORS[p.id].some((q) => st.provinces[q].owner === other)).map((p) => p.id);
}
export function dealValue(st, from, to, offer) {
  // to から見た損得
  const P = PERSONALITIES[personality(st, to)];
  const greed = P.greed ?? 1;
  const g = offer.give ?? {}, r = offer.get ?? {};
  let v = 0;
  v += (g.gold ?? 0) + (g.horses ?? 0) * 0.5 + (g.province ? provinceValue(st, g.province) : 0);
  let cost = (r.gold ?? 0) + (r.horses ?? 0) * 0.5;
  if (r.province) cost += provinceValue(st, r.province) * (nationProvinces(st, to).length <= 2 ? 3 : 1.5);
  cost *= greed;
  if (isRival(from, to)) cost *= 1.5;
  return v - cost;
}
export function dealCheck(st, from, to, offer) {
  const g = offer.give ?? {}, r = offer.get ?? {};
  const a = nat(st, from), b = nat(st, to);
  if (!(g.gold || g.horses || g.province || r.gold || r.horses || r.province)) return { ok: false, reason: '条件を選んでください' };
  if ((g.gold ?? 0) > a.gold) return { ok: false, reason: '金が足りません' };
  if ((r.gold ?? 0) > b.gold) return { ok: false, reason: `${b.name}にはそれほどの金がありません` };
  if ((g.horses ?? 0) > (st.provinces[a.capital]?.city.horses ?? 0)) return { ok: false, reason: '首都の馬が足りません' };
  if ((r.horses ?? 0) > (st.provinces[b.capital]?.city.horses ?? 0)) return { ok: false, reason: `${b.name}の首都にはそれほどの馬がいません` };
  if (g.province && st.provinces[g.province]?.owner !== from) return { ok: false, reason: '渡す地方が不正です' };
  if (r.province && st.provinces[r.province]?.owner !== to) return { ok: false, reason: '求める地方が不正です' };
  if (atWarLocal(st, from, to)) return { ok: false, reason: '交戦中は和平交渉で' };
  return { ok: true };
}
export function dealChance(st, from, to, offer) {
  if (!dealCheck(st, from, to, offer).ok) return 0;
  const net = dealValue(st, from, to, offer) + relation(st, to, from) * 8;
  const m = mood(st, to, from, 'trade').add;
  const p = 1 / (1 + Math.exp(-net / 400)) + m - 0.1;
  return Math.max(0, Math.min(0.95, p));
}
function moveProvince(st, pid, from, to) {
  for (const g of nationGenerals(st, from).filter((x) => x.province === pid)) {
    const esc = NEIGHBORS[pid].find((q) => st.provinces[q].owner === from);
    if (esc) g.province = esc; else g.province = nat(st, from).capital;
  }
  changeOwner(st, pid, to);
  st.provinces[pid].city.loyalty = Math.max(st.provinces[pid].city.loyalty, 45);
}
export function proposeDeal(st, from, to, offer) {
  const chk = dealCheck(st, from, to, offer);
  if (!chk.ok) return chk;
  const p = dealChance(st, from, to, offer);
  if (!chance(st, p)) { adjustRelation(st, from, to, -2); return { ok: true, accepted: false, chance: p }; }
  const a = nat(st, from), b = nat(st, to);
  const g = offer.give ?? {}, r = offer.get ?? {};
  a.gold -= g.gold ?? 0; b.gold += g.gold ?? 0;
  b.gold -= r.gold ?? 0; a.gold += r.gold ?? 0;
  const ca = st.provinces[a.capital].city, cb = st.provinces[b.capital].city;
  if (g.horses) { ca.horses -= g.horses; cb.horses += g.horses; }
  if (r.horses) { cb.horses -= r.horses; ca.horses += r.horses; }
  if (g.province) moveProvince(st, g.province, from, to);
  if (r.province) moveProvince(st, r.province, to, from);
  adjustRelation(st, from, to, 5);
  changeTrust(st, from, 1); changeTrust(st, to, 1);
  const parts = [];
  if (g.gold) parts.push(`${nameOf(st, from)}が${g.gold}金`);
  if (g.horses) parts.push(`${nameOf(st, from)}が馬${g.horses}`);
  if (g.province) parts.push(`${nameOf(st, from)}が${PROV_DEF[g.province].city}`);
  if (r.gold) parts.push(`${nameOf(st, to)}が${r.gold}金`);
  if (r.horses) parts.push(`${nameOf(st, to)}が馬${r.horses}`);
  if (r.province) parts.push(`${nameOf(st, to)}が${PROV_DEF[r.province].city}`);
  log(st, `${nameOf(st, from)}と${nameOf(st, to)}の取引が成立した（${parts.join('、')}を渡す）。`, true);
  if (g.province) checkNationAlive(st, from, to);
  if (r.province) checkNationAlive(st, to, from);
  return { ok: true, accepted: true, chance: p };
}

// ---------- 季節ごとの処理 ----------
export function statecraftTick(st) {
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    // 信用はゆっくり60に戻る
    if ((st.turn % 2) === 0 && n.trust !== undefined && n.trust !== 60) n.trust += n.trust < 60 ? 1 : -1;
    // 朝貢（納める側が払う）
    for (const [b, t] of Object.entries(n.treaties || {})) {
      if (t.type !== 'tribute' || t.payer !== n.id || !st.nations[b]?.alive) continue;
      const amt = Math.min(n.gold, Math.round(Math.max(0, n.lastIncome?.gold ?? 0) * LIGHT_TRIBUTE));
      n.gold -= amt; st.nations[b].gold += amt;
      n.lastTribute = (n.lastTribute ?? 0) + amt;
    }
    // 通商条約：友好度が少しずつ上がる
    for (const b of Object.keys(n.pacts || {})) {
      if (!st.nations[b]?.alive || atWarLocal(st, n.id, b)) { delete n.pacts[b]; continue; }
      if (n.id < b && relation(st, n.id, b) < 70) adjustRelation(st, n.id, b, 1);
    }
    // 宿敵とは関係が冷え込みやすい
    for (const b of Object.keys(n.relations)) {
      if (n.id < b && isRival(n.id, b) && st.nations[b]?.alive && relation(st, n.id, b) > -20 && !treaty(st, n.id, b) && chance(st, 0.5)) adjustRelation(st, n.id, b, -1);
    }
  }
  // 条約が切れた人質は帰国する
  for (const g of Object.values(st.generals)) {
    if (!g.alive || !g.hostageOf) continue;
    if (!st.nations[g.hostageOf]?.alive || !st.nations[g.nation]?.alive || !treaty(st, g.nation, g.hostageOf)) returnHostage(st, g, '（約束の期間が終わった）');
  }
}

function powerOf(st, nid) {
  return nationGenerals(st, nid).reduce((s, g) => s + (g.unit?.soldiers ?? 0), 0) + nationProvinces(st, nid).length * 400;
}

// ---------- AI：外交イベントと気質に応じた行動。プレイヤー宛ての提案を返す ----------
export function aiStatecraft(st, nid, { hegemon, areNeighbors, breakTreaty, declareWar, sign }) {
  const out = [];
  const me = nat(st, nid);
  const player = st.playerNation;
  const kind = personality(st, nid);
  const neigh = Object.values(st.nations).filter((n) => n.alive && n.id !== nid && areNeighbors(st, nid, n.id));
  const myPow = powerOf(st, nid);

  // 背信：有利と見れば条約を破る
  if ((kind === 'treacherous' || (kind === 'warlike' && trustOf(st, nid) < 40)) && chance(st, 0.04)) {
    const prey = neigh.filter((n) => ['truce', 'alliance'].includes(treaty(st, nid, n.id)) && myPow > powerOf(st, n.id) * 2.2 && !hostagesFrom(st, nid, n.id).length);
    if (prey.length) {
      const t = pick(st, prey);
      out.push({ from: nid, kind: 'calls', calls: declareWar(st, nid, t.id, { reason: '（盟約を踏みにじって）' }) });
    }
  }

  // 力をつけた朝貢国は朝貢をやめる
  for (const [b, t] of Object.entries(me.treaties || {})) {
    if (t.type === 'tribute' && t.payer === nid && st.nations[b]?.alive && myPow > powerOf(st, b) * 1.2 && chance(st, 0.08)) {
      breakTreaty(st, nid, b);
      break;
    }
  }

  // 使者の贈物
  if ((kind === 'peaceful' || kind === 'cautious' || kind === 'honorable') && chance(st, 0.04) && me.gold > 800) {
    const t = neigh.filter((n) => relation(st, nid, n.id) > 10 && !atWarLocal(st, nid, n.id));
    if (t.length) {
      const to = pick(st, t);
      const gold = Math.round(Math.min(me.gold * 0.1, 300) / 50) * 50;
      if (gold >= 100) {
        me.gold -= gold; to.gold += gold;
        adjustRelation(st, nid, to.id, Math.round(gold / 25));
        if (to.id === player) out.push({ from: nid, kind: 'gift', gold });
      }
    }
  }

  // 通商条約
  if ((kind === 'pragmatic' || kind === 'peaceful' || kind === 'scheming') && chance(st, 0.08)) {
    const t = neigh.filter((n) => !hasPact(st, nid, n.id) && !atWarLocal(st, nid, n.id) && relation(st, nid, n.id) > 5);
    if (t.length) {
      const to = pick(st, t);
      if (to.id === player) out.push({ from: nid, kind: 'pact' });
      else proposePact(st, nid, to.id);
    }
  }

  // 大ハーン・覇権国・好戦的な強国は、弱い隣国に朝貢を迫る
  const heg = hegemon(st);
  if ((me.crowned || heg === nid || kind === 'warlike') && chance(st, me.crowned ? 0.15 : 0.08)) {
    const weak = neigh.filter((n) => !treaty(st, nid, n.id) && !atWarLocal(st, nid, n.id) && myPow > powerOf(st, n.id) * 2);
    if (weak.length) {
      const t = pick(st, weak);
      if (t.id === player) out.push({ from: nid, kind: 'tribute' });
      else if (chance(st, tributeChance(st, nid, t.id))) signTribute(st, nid, t.id);
      else { adjustRelation(st, nid, t.id, -15); if (chance(st, 0.4)) out.push({ from: nid, kind: 'calls', calls: declareWar(st, nid, t.id, { reason: '（朝貢を拒まれて）' }) }); }
    }
  }

  // 会盟：春、覇権国に対抗する国々が集い、互いに同盟を結ぶ
  if (heg && st.season === 0 && me.coalition === heg && heg !== nid) {
    st.summits ??= {};
    if (!st.summits[st.year]) {
      st.summits[st.year] = true;
      const members = Object.values(st.nations).filter((n) => n.alive && n.coalition === heg && n.id !== heg && n.id !== player);
      if (members.length >= 2) {
        for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
          const a = members[i].id, b = members[j].id;
          if (!treaty(st, a, b) && !atWarLocal(st, a, b)) sign(st, a, b, 'alliance');
        }
        log(st, `${members.map((n) => n.name).join('・')}の君主が会盟し、${nameOf(st, heg)}に対抗することを誓った。`, true);
        const invite = player !== heg && st.nations[player].alive && areNeighbors(st, player, heg) && !atWarLocal(st, player, nid) && treaty(st, player, heg) !== 'vassal';
        if (invite) out.push({ from: nid, kind: 'summit', members: members.map((n) => n.id), against: heg });
      }
    }
  }
  return out;
}

// 会盟に加わる
export function joinSummit(st, nid, members, against, sign) {
  for (const m of members) if (st.nations[m]?.alive && !treaty(st, nid, m) && !atWarLocal(st, nid, m)) sign(st, nid, m, 'alliance');
  adjustRelation(st, nid, against, -20);
  st.nations[nid].coalition = against;
  changeTrust(st, nid, 3);
}

