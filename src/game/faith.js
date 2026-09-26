// 宗教の権威：教皇・カリフ・総主教・ラマ。信任と寄進、破門と贖罪、聖戦（十字軍・ジハード）、座所の陥落と移座、国教の改宗
import { PROVINCES } from './data.js';
import { chance, pick, rint } from './rng.js';
import { nationProvinces, nationGenerals, treaty, log, dateStr } from './state.js';
import { RELIGIONS, nationReligion, provReligion } from './admin.js';
import { adjustRelation } from './military.js';
import { declareWar, areNeighbors, atWar, lordOf } from './diplomacy.js';
import { handleCalls } from './actions.js';

const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
const nameOf = (st, id) => st.nations[id]?.name ?? '';

export const AUTHORITIES = {
  catholic: { title: '教皇', seat: 'ita', alt: ['fra'], ban: '破門', holyWar: '十字軍', holyLands: ['syr'] },
  orthodox: { title: '総主教', seat: 'byz', alt: ['gre'], ban: '破門', holyWar: null, holyLands: [] },
  islam: { title: 'カリフ', seat: 'irq', alt: ['egy'], ban: '異端の宣告', holyWar: 'ジハード', holyLands: ['syr', 'egy', 'irq'] },
  buddhism: { title: 'ラマ', seat: 'tib', alt: [], ban: null, holyWar: null, holyLands: [] },
};
export const DONATIONS = [200, 500, 1000];
export const HOLY_WAR_COST = 500;
export const HOLY_WAR_TERM = 12; // 季
export const BAN_TERM = 8;
const CONVERT_COOLDOWN = 40;

export const authorityOf = (rel) => AUTHORITIES[rel] ?? null;
export const nationAuthority = (st, nid) => authorityOf(nationReligion(st, nid));

// ---------- 座所と保護者 ----------
// 本来の座所が同じ信仰の国の手にあればそこ、なければ移座先、どちらもなければ空位（null）
export function seatOf(st, rel) {
  const A = authorityOf(rel);
  if (!A) return null;
  for (const pid of [A.seat, ...A.alt]) {
    const o = st.provinces[pid]?.owner;
    if (o && st.nations[o]?.alive && nationReligion(st, o) === rel) return pid;
  }
  return null;
}
export function protectorOf(st, rel) {
  const s = seatOf(st, rel);
  return s ? st.provinces[s].owner : null;
}
export const isProtector = (st, nid) => { const rel = nationReligion(st, nid); return !!authorityOf(rel) && protectorOf(st, rel) === nid; };

// ---------- 信任 ----------
export const pietyOf = (st, nid) => st.nations[nid]?.piety ?? 50;
export function changePiety(st, nid, d) {
  const n = st.nations[nid];
  if (!n || !nationAuthority(st, nid)) return;
  n.piety = Math.max(0, Math.min(100, Math.round(pietyOf(st, nid) + d)));
}
export const isBanned = (st, nid) => { const b = st.nations[nid]?.ban; return !!(b && b.until > st.turn && b.rel === nationReligion(st, nid)); };

// 国教と同じ信仰の地方の民忠（adminMods から）
export function faithMods(st, pid) {
  const nid = st.provinces[pid].owner;
  const rel = nationReligion(st, nid);
  const A = authorityOf(rel);
  if (!A || provReligion(st, pid) !== rel) return [];
  if (isBanned(st, nid)) return [[A.ban, -10]];
  const v = Math.round((pietyOf(st, nid) - 50) / 12) + (protectorOf(st, rel) === nid ? 2 : 0);
  const out = v ? [[`${A.title}の信任`, v]] : [];
  if (!seatOf(st, rel)) out.push([`${A.title}の空位`, -2]);
  return out;
}

// 外交の受諾率への補正（statecraft.bonds から）：破門された国とは同じ信仰の国が手を組みたがらない
export function faithBonds(st, target, from) {
  const rel = nationReligion(st, from);
  if (rel !== nationReligion(st, target) || !authorityOf(rel)) return [];
  if (isBanned(st, from)) return [[authorityOf(rel).ban, -0.2]];
  if (protectorOf(st, rel) === from) return [[`${authorityOf(rel).title}の保護者`, 0.05]];
  return [];
}

// ---------- 寄進・破門・贖罪 ----------
export function donate(st, nid, gold) {
  const n = st.nations[nid];
  const A = nationAuthority(st, nid);
  if (!A) return { ok: false, reason: `${RELIGIONS[nationReligion(st, nid)].name}には寄進を受ける権威がありません` };
  if (isBanned(st, nid)) return { ok: false, reason: `${A.ban}を受けている間は寄進を受け付けてもらえません（贖罪が必要）` };
  if (!seatOf(st, nationReligion(st, nid))) return { ok: false, reason: `${A.title}は空位です` };
  if (n.gold < gold) return { ok: false, reason: '金が足りません' };
  n.gold -= gold;
  const p0 = pietyOf(st, nid);
  changePiety(st, nid, (gold / 40) * (p0 >= 80 ? 0.5 : 1));
  const prot = protectorOf(st, nationReligion(st, nid));
  if (prot && prot !== nid) st.nations[prot].gold += Math.round(gold * 0.3); // 座所を抱える国にも実入りがある
  return { ok: true, gain: pietyOf(st, nid) - p0 };
}

export function excommunicate(st, nid, why = '') {
  const A = nationAuthority(st, nid);
  if (!A?.ban || isBanned(st, nid) || isProtector(st, nid)) return false;
  const rel = nationReligion(st, nid);
  const n = st.nations[nid];
  n.ban = { rel, until: st.turn + BAN_TERM };
  n.piety = 5;
  for (const g of nationGenerals(st, nid)) if (!g.family && n.rulerId !== g.id) g.loyalty = Math.max(0, g.loyalty - 8);
  for (const o of Object.values(st.nations)) if (o.alive && o.id !== nid && nationReligion(st, o.id) === rel) adjustRelation(st, nid, o.id, -20);
  log(st, `${A.title}が${n.name}の君主に${A.ban}を言い渡した。${why}`, true);
  return true;
}

export const penanceCost = (st, nid) => 800 + nationProvinces(st, nid).length * 100;
export function doPenance(st, nid) {
  const n = st.nations[nid];
  if (!isBanned(st, nid)) return { ok: false, reason: '贖罪の必要はありません' };
  const cost = penanceCost(st, nid);
  if (n.gold < cost) return { ok: false, reason: '金が足りません' };
  n.gold -= cost;
  delete n.ban;
  n.piety = 30;
  log(st, `${n.name}の君主は${nationAuthority(st, nid).title}の前で贖罪し、${nationAuthority(st, nid).ban}を解かれた。`, true);
  return { ok: true };
}

// ---------- 他の仕組みからの知らせ ----------
export function onConverted(st, nid) { changePiety(st, nid, 3); }
// 地方の奪取：異教徒の地を取れば信任が上がり、同じ信仰の国から奪えば少し下がる
export function faithOnConquest(st, pid, winner, loser) {
  if (!winner || !loser) return;
  const rel = nationReligion(st, winner);
  if (!authorityOf(rel)) return;
  if (nationReligion(st, loser) === rel) changePiety(st, winner, -2);
  else if (provReligion(st, pid) !== rel) changePiety(st, winner, 3);
}
// 同じ信仰の国との条約を破った
export function faithOnTreatyBroken(st, from, to) {
  if (nationReligion(st, from) === nationReligion(st, to)) changePiety(st, from, -10);
}

// ---------- 国教の改宗 ----------
export function conversionOptions(st, nid) {
  const provs = nationProvinces(st, nid);
  const mine = nationReligion(st, nid);
  const count = {};
  for (const p of provs) { const r = provReligion(st, p.id); count[r] = (count[r] ?? 0) + 1; }
  return Object.entries(count).filter(([r]) => r !== mine).map(([rel, n]) => ({ rel, share: n / Math.max(1, provs.length) }))
    .filter((o) => o.share >= 0.4).sort((a, b) => b.share - a.share);
}
export function canConvertNation(st, nid, rel) {
  const n = st.nations[nid];
  if ((n.convertedTurn ?? -999) + CONVERT_COOLDOWN > st.turn) return { ok: false, reason: `改宗してから日が浅すぎます（あと${n.convertedTurn + CONVERT_COOLDOWN - st.turn}季）` };
  if (!conversionOptions(st, nid).some((o) => o.rel === rel)) return { ok: false, reason: '領内にその信仰の民が少なすぎます（4割以上が必要）' };
  return { ok: true };
}
export function convertNation(st, nid, rel) {
  const av = canConvertNation(st, nid, rel);
  if (!av.ok) return av;
  const n = st.nations[nid];
  const old = nationReligion(st, nid);
  n.religion = rel;
  n.convertedTurn = st.turn;
  n.piety = 50;
  delete n.ban;
  for (const g of nationGenerals(st, nid)) if (!g.family && n.rulerId !== g.id) g.loyalty = Math.max(0, g.loyalty - 10);
  for (const o of Object.values(st.nations)) {
    if (!o.alive || o.id === nid) continue;
    const r = nationReligion(st, o.id);
    if (r === rel) adjustRelation(st, nid, o.id, 15);
    else if (r === old && !RELIGIONS[old].tolerant) adjustRelation(st, nid, o.id, -15);
  }
  log(st, `${n.name}の君主が${RELIGIONS[rel].name}に改宗し、国教を改めた。`, true);
  return { ok: true };
}

// ---------- 聖戦 ----------
export const activeHolyWar = (st, rel) => (st.holyWars ?? []).find((h) => h.rel === rel && !h.over) ?? null;

// 聖戦の的：座所を奪った異教徒 → 聖地を持つ異教徒 → 破門された同じ信仰の国（異端討伐）
export function holyWarTargets(st, rel) {
  const A = authorityOf(rel);
  if (!A?.holyWar) return [];
  const out = [];
  const add = (nid, why, goal) => { if (nid && st.nations[nid]?.alive && !out.some((o) => o.target === nid)) out.push({ target: nid, why, goal }); };
  const so = st.provinces[A.seat].owner;
  if (so && nationReligion(st, so) !== rel) add(so, `${PDEF[A.seat].city}の奪還`, [A.seat]);
  for (const pid of A.holyLands) {
    const o = st.provinces[pid].owner;
    if (o && nationReligion(st, o) !== rel) add(o, `聖地${PDEF[pid].city}の回復`, A.holyLands.filter((q) => st.provinces[q].owner === o));
  }
  for (const n of Object.values(st.nations)) if (n.alive && isBanned(st, n.id) && nationReligion(st, n.id) === rel) add(n.id, '異端の討伐', [n.capital]);
  return out;
}

export function canCallHolyWar(st, nid, target) {
  const rel = nationReligion(st, nid);
  const A = authorityOf(rel);
  if (!A?.holyWar) return { ok: false, reason: `${RELIGIONS[rel].name}には聖戦を呼びかける権威がありません` };
  if (!isProtector(st, nid) && pietyOf(st, nid) < 85) return { ok: false, reason: `${A.title}を擁する国か、信任85以上の国だけが呼びかけられます` };
  if (activeHolyWar(st, rel)) return { ok: false, reason: `いまは${activeHolyWar(st, rel).name}が行われています` };
  if ((st.faith?.[rel]?.next ?? 0) > st.turn) return { ok: false, reason: `次の${A.holyWar}まであと${st.faith[rel].next - st.turn}季` };
  if (st.nations[nid].gold < HOLY_WAR_COST) return { ok: false, reason: '金が足りません' };
  if (target && !holyWarTargets(st, rel).some((t) => t.target === target)) return { ok: false, reason: '聖戦の大義がありません' };
  return { ok: true };
}

function joinHolyWar(st, hw, nid, calls) {
  hw.members.push(nid);
  changePiety(st, nid, 10);
  for (const g of nationGenerals(st, nid)) if (g.unit) g.unit.training = Math.min(100, g.unit.training + 5);
  if (!atWar(st, nid, hw.target)) calls.push(...declareWar(st, nid, hw.target, { reason: `（${hw.name}）` }));
}

// AI の参加の見込み
function joinChance(st, nid, target) {
  if (lordOf(st, nid) === target || treaty(st, nid, target) === 'vassal') return 0;
  let p = 0.25 + pietyOf(st, nid) / 200;
  if (areNeighbors(st, nid, target)) p += 0.25;
  if (treaty(st, nid, target)) p -= 0.3;
  p -= Object.keys(st.nations[nid].wars ?? {}).length * 0.08;
  return Math.max(0, Math.min(0.9, p));
}

// 聖戦を始める。caller は呼びかけた国（なければ座所の保護者）。プレイヤーへの招きを返す
export function proclaimHolyWar(st, rel, t, caller = null) {
  const A = authorityOf(rel);
  st.holyWars ??= [];
  st.faith ??= {};
  st.faith[rel] = { ...(st.faith[rel] ?? {}), next: st.turn + rint(st, 16, 24) };
  const hw = { id: `${rel}${st.turn}`, rel, name: `${A.holyWar}（${nameOf(st, t.target)}${t.why === '異端の討伐' ? 'の異端討伐' : '討伐'}）`, target: t.target, why: t.why, goal: t.goal, members: [], since: st.turn, until: st.turn + HOLY_WAR_TERM, caller };
  st.holyWars.push(hw);
  st.chronicle ??= [];
  st.chronicle.push({ id: hw.id, date: dateStr(st), title: hw.name, text: `${A.title}が${t.why}を掲げ、${nameOf(st, t.target)}への${A.holyWar}を呼びかけた。` });
  log(st, `【${hw.name}】${A.title}が${t.why}を掲げ、${nameOf(st, t.target)}への${A.holyWar}を呼びかけた。`, true);
  for (const n of Object.values(st.nations)) {
    if (n.alive && n.id !== t.target && nationReligion(st, n.id) === rel) adjustRelation(st, n.id, t.target, -15);
  }
  return hw;
}

// 同じ信仰の国々を募る（プレイヤーは hooks.proposal で尋ねる）
async function rally(st, hw, hooks) {
  const calls = [];
  const player = st.playerNation;
  for (const n of Object.values(st.nations)) {
    if (!n.alive || n.id === hw.target || nationReligion(st, n.id) !== hw.rel || hw.members.includes(n.id)) continue;
    if (n.id === hw.caller) { joinHolyWar(st, hw, n.id, calls); continue; }
    if (n.id === player) {
      if (lordOf(st, player) === hw.target) continue;
      const ok = hooks.proposal ? await hooks.proposal({ from: protectorOf(st, hw.rel) ?? hw.target, kind: 'holywar', hw: hw.id, rel: hw.rel, target: hw.target }) : false;
      if (ok) joinHolyWar(st, hw, player, calls);
      else changePiety(st, player, -8);
      continue;
    }
    if (chance(st, joinChance(st, n.id, hw.target))) joinHolyWar(st, hw, n.id, calls);
    else changePiety(st, n.id, -5);
  }
  if (hw.members.length) log(st, `${hw.name}に${hw.members.map((m) => nameOf(st, m)).join('・')}が加わった。`, hw.members.includes(player) || hw.target === player);
  else log(st, `${hw.name}の呼びかけに応じる国はなかった。`);
  await handleCalls(st, calls, hooks);
}

// プレイヤーが呼びかける
export async function callHolyWar(st, nid, target, hooks = {}) {
  const av = canCallHolyWar(st, nid, target);
  if (!av.ok) return av;
  st.nations[nid].gold -= HOLY_WAR_COST;
  const rel = nationReligion(st, nid);
  const t = holyWarTargets(st, rel).find((x) => x.target === target);
  const hw = proclaimHolyWar(st, rel, t, nid);
  await rally(st, hw, hooks);
  return { ok: true, hw };
}

// ターン終了時：座所の保護者（AI）が聖戦を呼びかけることがある
export async function holyWarTurn(st, hooks = {}) {
  st.faith ??= {};
  for (const [rel, A] of Object.entries(AUTHORITIES)) {
    if (!A.holyWar || activeHolyWar(st, rel)) continue;
    const prot = protectorOf(st, rel);
    if (!prot || prot === st.playerNation) continue;
    const urgent = st.faith[rel]?.urgent;
    if (!urgent && ((st.faith[rel]?.next ?? 12) > st.turn || !chance(st, 0.2))) continue;
    const ts = holyWarTargets(st, rel);
    if (!ts.length) continue;
    const t = urgent ? (ts.find((x) => x.target === urgent) ?? ts[0]) : ts[0].why === '異端の討伐' ? pick(st, ts) : ts[0];
    delete st.faith[rel].urgent;
    const hw = proclaimHolyWar(st, rel, t, prot);
    await rally(st, hw, hooks);
  }
}

function holyWarTick(st) {
  for (const hw of st.holyWars ?? []) {
    if (hw.over) continue;
    hw.members = hw.members.filter((m) => st.nations[m]?.alive);
    const won = !st.nations[hw.target]?.alive || hw.goal.every((pid) => {
      const o = st.provinces[pid].owner;
      return o && o !== hw.target && nationReligion(st, o) === hw.rel;
    });
    if (won) {
      hw.over = 'won';
      for (const m of hw.members) { changePiety(st, m, 15); st.nations[m].gold += 300; }
      const text = `${hw.name}は成就した。${hw.members.length ? `${hw.members.map((m) => nameOf(st, m)).join('・')}は${authorityOf(hw.rel).title}から祝福と褒賞を受けた。` : ''}`;
      st.chronicle?.push({ id: `${hw.id}_end`, date: dateStr(st), title: `${hw.name}の成就`, text });
      log(st, `【${hw.name}】${text}`, true);
    } else if (st.turn >= hw.until || !hw.members.length) {
      hw.over = 'failed';
      log(st, `【${hw.name}】聖戦は目的を果たせないまま立ち消えとなった。`, hw.members.includes(st.playerNation));
    }
  }
}

// ---------- 季節の更新 ----------
function updateSeats(st, quiet = false) {
  st.faith ??= {};
  for (const [rel, A] of Object.entries(AUTHORITIES)) {
    const f = (st.faith[rel] ??= {});
    const at = seatOf(st, rel);
    const holder = at ? st.provinces[at].owner : null;
    const origOwner = st.provinces[A.seat].owner;
    const lost = origOwner && nationReligion(st, origOwner) !== rel;
    if (!quiet && f.init) {
      if (lost && f.lostTo !== origOwner) {
        // 座所の陥落：同じ信仰の国々の怒りを買い、聖戦の的になる
        for (const n of Object.values(st.nations)) if (n.alive && n.id !== origOwner && nationReligion(st, n.id) === rel) adjustRelation(st, n.id, origOwner, -30);
        const where = at ? `${A.title}は${PDEF[at].city}へ逃れた` : `${A.title}は空位となった`;
        const text = `${nameOf(st, origOwner)}が${PDEF[A.seat].city}を攻め取り、${where}。${RELIGIONS[rel].name}の国々は憤っている。`;
        st.chronicle ??= [];
        st.chronicle.push({ id: `seat_${rel}_${st.turn}`, date: dateStr(st), title: `${PDEF[A.seat].city}の陥落`, text });
        log(st, `【${PDEF[A.seat].city}の陥落】${text}`, true);
        if (A.holyWar) f.urgent = origOwner;
      } else if (!lost && f.lostTo) log(st, `${PDEF[A.seat].city}が${RELIGIONS[rel].name}の手に戻り、${A.title}が帰還した。`, true);
      else if (holder && holder !== f.holder) {
        changePiety(st, holder, 20);
        log(st, `${nameOf(st, holder)}が${A.title}の保護者となった（座所：${PDEF[at].city}）。`, holder === st.playerNation || f.holder === st.playerNation);
      } else if (!holder && f.holder) log(st, `${A.title}は空位となった。`, true);
    }
    f.init = true;
    f.at = at;
    f.holder = holder;
    f.lostTo = lost ? origOwner : null;
    if (f.next === undefined) f.next = st.turn + 12;
  }
}

export function faithTick(st) {
  updateSeats(st);
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const rel = nationReligion(st, n.id);
    const A = authorityOf(rel);
    if (!A) continue;
    if (n.ban && n.ban.until <= st.turn) {
      delete n.ban;
      n.piety = 30;
      log(st, `${n.name}への${A.ban}が解かれた。`, n.id === st.playerNation);
    }
    const prot = protectorOf(st, rel);
    const base = prot === n.id ? 80 : 50;
    const p = pietyOf(st, n.id);
    if (!isBanned(st, n.id) && p !== base) n.piety = p + Math.sign(base - p);
    // 座所の保護者と戦う国は信任を失う
    if (prot && prot !== n.id && atWar(st, n.id, prot)) changePiety(st, n.id, -3);
    if (A.ban && prot && !isBanned(st, n.id) && pietyOf(st, n.id) < 10 && chance(st, 0.2)) {
      excommunicate(st, n.id, prot && atWar(st, n.id, prot) ? `（${A.title}を擁する${nameOf(st, prot)}に弓を引いたため）` : '（神をも恐れぬ振る舞いのため）');
    }
  }
  holyWarTick(st);
}

// 新規ゲーム・旧セーブ
export function initFaith(st) {
  updateSeats(st, true);
}

// ---------- AI ----------
export function aiFaith(st, nid) {
  const n = st.nations[nid];
  const rel = nationReligion(st, nid);
  const A = authorityOf(rel);
  if (A) {
    if (isBanned(st, nid) && n.gold > penanceCost(st, nid) * 2 && chance(st, 0.5)) doPenance(st, nid);
    else if (!isBanned(st, nid) && seatOf(st, rel) && n.gold > 3000 && pietyOf(st, nid) < 65 && chance(st, 0.15)) donate(st, nid, n.gold > 6000 ? 1000 : 500);
  }
  // 寛容な遊牧国家も、領民の大半が一つの信仰になれば改宗することがある（イルハン朝・ジョチ・ウルスのように）
  if (RELIGIONS[rel].tolerant && st.turn > 20 && chance(st, 0.01)) {
    const o = conversionOptions(st, nid).find((x) => x.share >= 0.7);
    if (o) convertNation(st, nid, o.rel);
  }
}
