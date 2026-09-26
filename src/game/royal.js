// 後宮・王族：妃と寵愛、子の誕生、姫の婚姻（婚姻同盟・家臣への降嫁）、縁談
import { FEMALE_NAMES, NAMED_CONSORTS, NAMED_PRINCESSES, FEMALE_GENERALS, NAME_POOLS, CULTURES } from './data.js';
import { rint, pick, chance } from './rng.js';
import { consortTrait, chiefOf } from './court.js';

let hooks = { addGeneral: null, randomName: null, log: null, sign: null, relation: null };
export function setRoyalHooks(h) { hooks = { ...hooks, ...h }; }

export function femaleName(st, culture, princess = false) {
  const pool = FEMALE_NAMES[culture] ?? FEMALE_NAMES.mongol;
  if (Array.isArray(pool)) return pick(st, pool);
  if (pool.family) {
    if (princess) return pick(st, pool.princess[0]) + pick(st, pool.princess[1]) + pool.princess[2];
    return pick(st, pool.family) + pool.title;
  }
  return pick(st, pool.given) + (princess ? pool.princess : pool.wife);
}

export const age = (st, x) => st.year - x.birth;
const NAMED_SONS = [
  ['ジョチ', 'テムジン', 'ボルテ'], ['チャガタイ', 'テムジン', 'ボルテ'], ['オゴデイ', 'テムジン', 'ボルテ'], ['トルイ', 'テムジン', 'ボルテ'],
  ['セングム', 'オン・カン'], ['クチュルク', 'タヤン・カン'], ['源頼家', '源頼朝', '北条政子'], ['源実朝', '源頼朝', '北条政子'],
  ['アフダル', 'サラーフッディーン'], ['カーミル', 'アーディル'], ['エメリク', 'ベーラ3世'], ['フィリップ', 'フリードリヒ'],
  ['ハインリヒ', 'フリードリヒ'], ['コンスタンチン', 'フセヴォロド'], ['ヤロスラフ', 'フセヴォロド'], ['アラーウッディーン', 'テキシュ'],
  ['ジャラールッディーン', 'アラーウッディーン'],
];
export function isFemaleRuler(st, nid) {
  const r = st.generals[st.nations[nid]?.rulerId];
  return !!r?.female;
}

export function addConsort(st, { name, nation, husband, birth, cha, pol, origin = null, affection = 50 }) {
  const id = `c${st.nextId++}`;
  st.consorts[id] = { id, name, nation, husband, birth, cha, pol, origin, affection, alive: true, visited: -1 };
  return st.consorts[id];
}

export function addPrincess(st, { name, nation, father = null, mother = null, birth, cha, pol }) {
  const id = `p${st.nextId++}`;
  st.princesses[id] = { id, name, nation, father, mother, birth, cha, pol, married: null, alive: true };
  return st.princesses[id];
}

export function initRoyals(st, consortList = NAMED_CONSORTS, princessList = NAMED_PRINCESSES) {
  st.consorts = {};
  st.princesses = {};
  for (const g of Object.values(st.generals)) if (FEMALE_GENERALS.includes(g.name)) g.female = true;
  for (const [name, nation, birth, cha, pol] of consortList) {
    if (!st.nations[nation]) continue;
    addConsort(st, { name, nation, husband: st.nations[nation].rulerId, birth, cha, pol, affection: 80 });
  }
  for (const [name, nation, birth, cha, pol, fatherName] of princessList) {
    if (!st.nations[nation]) continue;
    const father = fatherName ? Object.values(st.generals).find((g) => g.name === fatherName)?.id : st.nations[nation].rulerId;
    const mother = Object.values(st.consorts).find((c) => c.husband === father)?.id ?? null;
    addPrincess(st, { name, nation, father, mother, birth, cha, pol });
  }
  // 史実の王子たち（父と母）
  const byName = (n) => Object.values(st.generals).find((g) => g.name === n);
  for (const [son, father, mother] of NAMED_SONS) {
    const s = byName(son), f = byName(father);
    if (!s || !f) continue;
    s.fatherId = f.id;
    const m = mother ? Object.values(st.consorts).find((c) => c.name === mother && c.husband === f.id) : null;
    if (m) { s.motherId = m.id; s.legit = true; }
  }
  // その他の君主にも妃を一人
  for (const n of Object.values(st.nations)) {
    if (isFemaleRuler(st, n.id)) continue;
    if (Object.values(st.consorts).some((c) => c.husband === n.rulerId)) continue;
    const r = st.generals[n.rulerId];
    if (st.year - r.birth > 60 && chance(st, 0.5)) continue;
    addConsort(st, {
      name: femaleName(st, n.culture), nation: n.id, husband: r.id,
      birth: Math.max(r.birth, st.year - 40) + rint(st, 0, 12), cha: rint(st, 40, 85), pol: rint(st, 30, 80), affection: rint(st, 40, 70),
    });
  }
}

export function consortsOf(st, gid) {
  return Object.values(st.consorts).filter((c) => c.alive && c.husband === gid);
}
export function sonsOf(st, gid) {
  return Object.values(st.generals).filter((g) => g.fatherId === gid && g.alive);
}
export function daughtersOf(st, gid) {
  return Object.values(st.princesses).filter((p) => p.father === gid && p.alive);
}
export function princessesOf(st, nid) {
  return Object.values(st.princesses).filter((p) => p.alive && p.nation === nid && !p.married);
}
export function marriageable(st, nid) {
  return princessesOf(st, nid).filter((p) => age(st, p) >= 15);
}
export function orphans(st) {
  return Object.values(st.princesses).filter((p) => p.alive && !p.married && !p.nation && age(st, p) >= 15);
}

// ---- 寵愛・贈物 ----
export function visit(st, cid) {
  const c = st.consorts[cid];
  if (c.visited === st.turn) return { ok: false, reason: 'この季節はすでに訪れました' };
  const others = consortsOf(st, c.husband).filter((x) => x.id !== cid);
  if (others.some((x) => x.visited === st.turn)) return { ok: false, reason: '寵愛は一季に一人だけです' };
  c.visited = st.turn;
  c.affection = Math.min(100, c.affection + (consortTrait(c) === 'schemer' ? 18 : 12));
  for (const o of others) {
    const tr = consortTrait(o);
    o.affection = Math.max(0, o.affection - (tr === 'jealous' ? 8 : tr === 'gentle' ? 0 : tr === 'virtuous' ? 1 : 3));
  }
  return { ok: true };
}

export function giftConsort(st, cid, gold = 100) {
  const c = st.consorts[cid];
  const nat = st.nations[c.nation];
  if (nat.gold < gold) return { ok: false, reason: '金が足りません' };
  nat.gold -= gold;
  c.affection = Math.min(100, c.affection + 8);
  return { ok: true };
}

// ---- 誕生 ----
function childStats(st, father, mother) {
  const n = () => rint(st, -14, 14);
  const clamp = (v) => Math.max(15, Math.min(99, Math.round(v)));
  const tr = mother ? consortTrait(mother) : null;
  const b = { war: 0, lead: 0, pol: 0, cha: 0 };
  if (tr === 'martial') { b.war = 6; b.lead = 6; }
  if (tr === 'talented') { b.pol = 6; b.cha = 6; }
  if (tr === 'virtuous') b.cha = 4;
  return {
    war: clamp(father.war * 0.7 + 50 * 0.3 + n() + b.war),
    lead: clamp(father.lead * 0.6 + (mother?.pol ?? 50) * 0.4 + n() + b.lead),
    pol: clamp(father.pol * 0.4 + (mother?.pol ?? 50) * 0.6 + n() + b.pol),
    cha: clamp(father.cha * 0.4 + (mother?.cha ?? 50) * 0.6 + n() + b.cha),
  };
}

export function birthChance(st, c) {
  const father = st.generals[c.husband];
  if (!father?.alive || !c.alive) return 0;
  const ma = age(st, c), fa = age(st, father);
  if (ma < 16 || ma > 42 || fa > 68) return 0;
  return 0.03 + c.affection / 900 + (c.visited === st.turn ? 0.12 : 0);
}

export function royalTick(st) {
  const born = [];
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const rulerId = n.rulerId;
    for (const c of consortsOf(st, rulerId)) {
      if (!chance(st, birthChance(st, c))) continue;
      const father = st.generals[rulerId];
      const s = childStats(st, father, c);
      if (chance(st, 0.5)) {
        const g = hooks.addGeneral(st, {
          name: sonName(st, n.culture, father), nation: n.id, province: n.capital, birth: st.year, ...s,
          loyalty: 100, family: true,
        });
        g.fatherId = rulerId; g.motherId = c.id;
        g.legit = chiefOf(st, rulerId) === c;
        born.push({ nation: n.id, text: `${c.name}${g.legit ? '（正室）' : '（側室）'}が男子「${g.name}」を産んだ。${g.legit ? '嫡子の誕生である。' : ''}`, son: true });
      } else {
        const p = addPrincess(st, { name: femaleName(st, n.culture, true), nation: n.id, father: rulerId, mother: c.id, birth: st.year, cha: s.cha, pol: s.pol });
        born.push({ nation: n.id, text: `${c.name}が姫「${p.name}」を産んだ。`, son: false });
      }
      break; // 一季に一人まで
    }
  }
  for (const b of born) if (b.nation === st.playerNation) hooks.log?.(st, `【後宮】${b.text}`, true);
  // 年に一度：妃が年を取り、世を去ることも
  if (st.season === 0) {
    for (const c of Object.values(st.consorts)) {
      if (c.alive && age(st, c) > 55 && chance(st, (age(st, c) - 55) / 60)) {
        c.alive = false;
        if (c.nation === st.playerNation) hooks.log?.(st, `【後宮】${c.name}が${age(st, c)}歳で世を去った。`, true);
      }
    }
    for (const p of Object.values(st.princesses)) if (p.alive && age(st, p) > 60 && chance(st, (age(st, p) - 60) / 50)) p.alive = false;
    // AIの君主は妃がいなければ国内から迎える
    for (const n of Object.values(st.nations)) {
      if (!n.alive || n.id === st.playerNation || isFemaleRuler(st, n.id)) continue;
      const r = st.generals[n.rulerId];
      if (!r || consortsOf(st, r.id).length || age(st, r) > 60 || !chance(st, 0.4)) continue;
      addConsort(st, { name: femaleName(st, n.culture), nation: n.id, husband: r.id, birth: st.year - rint(st, 16, 24), cha: rint(st, 40, 85), pol: rint(st, 30, 80) });
    }
  }
  return born;
}

// ---- 婚姻 ----
// 婚姻同盟の印（破ると信用を大きく失い、嫁いだ妃との仲も冷える）
export function markMarriage(st, a, b) {
  const ta = st.nations[a]?.treaties?.[b], tb = st.nations[b]?.treaties?.[a];
  if (ta) ta.marriage = true;
  if (tb) tb.marriage = true;
}
// 姓のある文化では、男子は父の姓を継ぐ
function sonName(st, culture, father) {
  const name = hooks.randomName(st, culture);
  const pool = NAME_POOLS[CULTURES[culture]?.names ?? 'mongol'];
  if (!pool?.family || !father) return name;
  const fam = pool.family.filter((f) => father.name.startsWith(f)).sort((a, b) => b.length - a.length)[0];
  const own = pool.family.filter((f) => name.startsWith(f)).sort((a, b) => b.length - a.length)[0];
  return fam && own ? fam + name.slice(own.length) : name;
}

export function becomeConsort(st, p, husbandId) {
  const husband = st.generals[husbandId];
  p.married = { to: husbandId, nation: husband.nation };
  return addConsort(st, { name: p.name, nation: husband.nation, husband: husbandId, birth: p.birth, cha: p.cha, pol: p.pol, origin: p.nation, affection: 55 });
}

// 姫を他国の君主に嫁がせる（婚姻同盟）
export function brideAcceptChance(st, fromNid, toNid) {
  const rel = st.nations[toNid].relations[fromNid] ?? 0;
  const r = st.generals[st.nations[toNid].rulerId];
  if (!r || r.female || age(st, r) > 70) return 0;
  return Math.max(0.05, Math.min(0.95, 0.45 + rel / 120 - st.nations[toNid].aggro * 0.15));
}

export function marryToRuler(st, pid, toNid) {
  const p = st.princesses[pid];
  if (!p || p.married || age(st, p) < 15) return { ok: false, reason: '嫁げる姫ではありません' };
  const from = p.nation;
  if (!chance(st, brideAcceptChance(st, from, toNid))) {
    hooks.relation?.(st, from, toNid, -3);
    return { ok: false, refused: true, reason: `${st.nations[toNid].name}は縁談を断った` };
  }
  becomeConsort(st, p, st.nations[toNid].rulerId);
  hooks.sign?.(st, from, toNid, 'alliance');
  markMarriage(st, from, toNid);
  hooks.relation?.(st, from, toNid, 30);
  hooks.log?.(st, `${st.nations[from].name}の${p.name}が${st.nations[toNid].name}の${st.generals[st.nations[toNid].rulerId].name}に嫁ぎ、婚姻同盟が結ばれた。`, from === st.playerNation || toNid === st.playerNation);
  return { ok: true };
}

// 姫を家臣に降嫁させる（忠誠が最大になり、一族となる）
export function marryToVassal(st, pid, gid) {
  const p = st.princesses[pid];
  const g = st.generals[gid];
  if (!p || p.married || age(st, p) < 15) return { ok: false, reason: '嫁げる姫ではありません' };
  if (g.nation !== p.nation) return { ok: false, reason: '自国の武将ではありません' };
  if (Object.values(st.princesses).some((x) => x.married?.to === gid)) return { ok: false, reason: 'すでに妻がいます' };
  p.married = { to: gid, nation: g.nation };
  g.loyalty = 100;
  g.family = true;
  g.spouse = pid;
  hooks.log?.(st, `${p.name}が${g.name}に嫁いだ。${g.name}は一門に列した。`, p.nation === st.playerNation);
  return { ok: true };
}

// 他国に縁談を申し込み、姫を妃として迎える
export function requestBride(st, fromNid, toNid) {
  const cands = marriageable(st, toNid);
  if (!cands.length) return { ok: false, reason: '嫁げる姫がいません' };
  if (isFemaleRuler(st, fromNid)) return { ok: false, reason: '女王は妃を迎えられません' };
  const rel = st.nations[toNid].relations[fromNid] ?? 0;
  const p = cands.sort((a, b) => b.cha - a.cha)[0];
  const chanceOk = Math.max(0.05, Math.min(0.9, 0.35 + rel / 100));
  if (!chance(st, chanceOk)) {
    hooks.relation?.(st, fromNid, toNid, -3);
    return { ok: false, refused: true, reason: `${st.nations[toNid].name}は縁談を断った` };
  }
  becomeConsort(st, p, st.nations[fromNid].rulerId);
  hooks.sign?.(st, fromNid, toNid, 'alliance');
  markMarriage(st, fromNid, toNid);
  hooks.relation?.(st, fromNid, toNid, 30);
  hooks.log?.(st, `${st.nations[toNid].name}の${p.name}が${st.nations[fromNid].name}に輿入れし、婚姻同盟が結ばれた。`, fromNid === st.playerNation || toNid === st.playerNation);
  return { ok: true, princess: p };
}
export function requestChance(st, fromNid, toNid) {
  const rel = st.nations[toNid].relations[fromNid] ?? 0;
  return Math.max(0.05, Math.min(0.9, 0.35 + rel / 100));
}

// 身寄りのない姫（滅亡した国の姫）を迎える
export function adoptOrphan(st, pid, nid) {
  const p = st.princesses[pid];
  if (!p || p.nation || p.married) return { ok: false };
  p.nation = nid;
  return { ok: true };
}

// 滅亡時：妃・姫は身寄りを失う
export function orphanNation(st, nid) {
  for (const p of Object.values(st.princesses)) if (p.nation === nid && !p.married) p.nation = null;
  for (const c of Object.values(st.consorts)) if (c.nation === nid) c.alive = false;
}

// AI同士の縁談（外交の一環）
export function aiMarriage(st, nid, neighbors) {
  const brides = marriageable(st, nid);
  if (!brides.length || !chance(st, 0.08)) return null;
  const cands = neighbors.filter((o) => !isFemaleRuler(st, o) && (st.nations[nid].relations[o] ?? 0) > 20);
  if (!cands.length) return null;
  const to = pick(st, cands);
  if (to === st.playerNation) return { from: nid, kind: 'marriage', princess: brides[0].id };
  marryToRuler(st, brides[0].id, to);
  return null;
}

