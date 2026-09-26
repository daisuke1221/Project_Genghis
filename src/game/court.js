// 宮廷：妃の個性、正室と側室、嫡子と庶子、後継者の指名と跡目争い、傅役と教育、封地、婚姻の重み、後宮の出来事
import { chance, pick } from './rng.js';
import { NEIGHBORS } from './geo.js';
import { PROV_DEF, log, nationProvinces } from './state.js';
import { hasTrait, triggerRebellion, setCourtHooks } from './personnel.js';

export const CONSORT_TRAITS = {
  wise: { name: '賢妃', desc: '内助の功。正室なら家臣の忠誠の目標+3、ときに不満を抱く家臣をなだめる' },
  virtuous: { name: '良妻', desc: '慎み深い。子の魅力が伸びやすく、寵愛が下がりにくい' },
  talented: { name: '才媛', desc: '学識豊か。子の政治・魅力が高くなりやすい' },
  martial: { name: '武門の娘', desc: '武家の出。男子の武力・統率が高くなりやすい' },
  schemer: { name: '野心家', desc: '寵愛を得やすいが浪費や政への口出しが多い。我が子を跡継ぎにしようと画策する' },
  jealous: { name: '嫉妬深い', desc: '他の妃が寵愛されると大きく機嫌を損ね、後宮で揉め事を起こす' },
  gentle: { name: '温順', desc: '穏やかで揉め事を起こさない。他の妃が寵愛されても気にしない' },
};
const TRAIT_KEYS = Object.keys(CONSORT_TRAITS);
const NAMED_CONSORT_TRAITS = { ボルテ: 'virtuous', 北条政子: 'wise', グルベス: 'schemer' };

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
export function consortTrait(c) {
  if (!c) return null;
  c.trait ??= NAMED_CONSORT_TRAITS[c.name] ?? TRAIT_KEYS[Math.floor(hash(`${c.id}:${c.name}`) * TRAIT_KEYS.length)];
  return c.trait;
}
const consortsOf = (st, gid) => Object.values(st.consorts || {}).filter((c) => c.alive && c.husband === gid);

// ---------- 正室と側室 ----------
export function chiefOf(st, gid) {
  const cs = consortsOf(st, gid);
  let chief = cs.find((c) => c.chief);
  if (!chief && cs.length) { chief = cs.sort((a, b) => b.affection - a.affection)[0]; chief.chief = true; }
  return chief ?? null;
}
export function setChief(st, cid) {
  const c = st.consorts[cid];
  const old = chiefOf(st, c.husband);
  if (old === c) return { ok: false, reason: 'すでに正室です' };
  if (old) {
    old.chief = false;
    old.affection = Math.max(0, old.affection - 30);
    if (old.origin && st.nations[old.origin]?.alive) adjustRel(st, c.nation, old.origin, -15);
    // 廃された正室の男子（嫡子）は不満を持つ
    for (const g of Object.values(st.generals)) if (g.alive && g.motherId === old.id) g.loyalty = Math.max(0, g.loyalty - 10);
  }
  c.chief = true;
  c.affection = Math.min(100, c.affection + 20);
  log(st, `${c.name}が正室に立てられた。${old ? `${old.name}は側室に退いた。` : ''}`, c.nation === st.playerNation);
  return { ok: true };
}
export const isLegit = (st, g) => !!(g.motherId && st.consorts[g.motherId]?.chief) || !!g.legit;

// ---------- 後継者 ----------
export function heirCandidates(st, nid) {
  const n = st.nations[nid];
  return Object.values(st.generals).filter((g) => g.alive && g.nation === nid && g.family && g.id !== n.rulerId && !g.captiveOf && st.year >= g.birth);
}
export function sonsOfRuler(st, nid) {
  const r = st.nations[nid]?.rulerId;
  return Object.values(st.generals).filter((g) => g.alive && g.fatherId === r && g.nation === nid && st.year >= g.birth);
}
// 指名がなければ：嫡子の年長 → 男子の年長 → 一門の有能な者
export function defaultHeir(st, nid) {
  const sons = sonsOfRuler(st, nid).sort((a, b) => a.birth - b.birth);
  return sons.find((g) => isLegit(st, g)) ?? sons[0] ?? null;
}
export function currentHeir(st, nid) {
  const n = st.nations[nid];
  const h = n.heirId ? st.generals[n.heirId] : null;
  if (h?.alive && h.nation === nid && !h.captiveOf) return h;
  return defaultHeir(st, nid);
}
export function designateHeir(st, nid, gid) {
  const n = st.nations[nid];
  const g = st.generals[gid];
  if (!g?.alive || g.nation !== nid || !g.family || g.id === n.rulerId) return { ok: false, reason: '一門の者しか指名できません' };
  n.heirId = gid;
  const passed = sonsOfRuler(st, nid).filter((s) => s !== g && isLegit(st, s) && s.birth < g.birth);
  for (const s of passed) s.loyalty = Math.max(0, s.loyalty - 15);
  if (passed.length) {
    const chief = chiefOf(st, n.rulerId);
    if (chief && passed.some((s) => s.motherId === chief.id)) chief.affection = Math.max(0, chief.affection - 20);
  }
  const mother = g.motherId ? st.consorts[g.motherId] : null;
  if (mother) mother.affection = Math.min(100, mother.affection + 10);
  log(st, `${g.name}が${n.name}の後継ぎに指名された。${passed.length ? `（嫡子${passed.map((s) => s.name).join('・')}をさしおいて）` : ''}`, nid === st.playerNation);
  return { ok: true };
}

// 跡目争い：継承のあと、ほかの男子が不服を唱えて兵を挙げることがある
export function disputeChance(st, nid, heir, rival, designated) {
  if (!rival || hasTrait(rival, 'loyal')) return 0;
  let p = 0.12;
  if (hasTrait(rival, 'ambitious')) p += 0.25;
  const mom = rival.motherId ? st.consorts[rival.motherId] : null;
  if (mom?.alive && consortTrait(mom) === 'schemer') p += 0.2;
  if (isLegit(st, rival) && !isLegit(st, heir)) p += 0.2;
  if (designated) p -= 0.08;
  if (rival.fief) p += 0.1;
  if (rival.loyalty > 80) p -= 0.1;
  return Math.max(0, Math.min(0.8, p));
}
export function successionDispute(st, nid, heir, oldRulerId, designated) {
  const rivals = Object.values(st.generals).filter((g) => g.alive && g.nation === nid && g.fatherId === oldRulerId && g !== heir && st.year - g.birth >= 16);
  if (!rivals.length) return null;
  const rival = rivals.sort((a, b) => (b.war + b.lead + (b.fief ? 30 : 0)) - (a.war + a.lead + (a.fief ? 30 : 0)))[0];
  const p = disputeChance(st, nid, heir, rival, designated);
  if (!chance(st, p)) {
    for (const r of rivals) r.loyalty = Math.max(0, r.loyalty - 5);
    return null;
  }
  const n = st.nations[nid];
  const base = rival.fief && st.provinces[rival.fief]?.owner === nid && rival.fief !== n.capital ? rival.fief
    : rival.province !== n.capital && st.provinces[rival.province]?.owner === nid ? rival.province
      : nationProvinces(st, nid).map((q) => q.id).find((q) => q !== n.capital && NEIGHBORS[q].length);
  if (!base || nationProvinces(st, nid).length < 2) { rival.loyalty = 15; return null; }
  rival.family = false;
  rival.loyalty = 0;
  rival.province = base;
  const followers = Object.values(st.generals).filter((g) => g.alive && g.nation === nid && g.province === base && g !== rival && !g.family && g.loyalty < 60).map((g) => g.id);
  const nat = triggerRebellion(st, rival, base, [rival.id, ...followers]);
  if (nat) log(st, `【跡目争い】${n.name}で${heir.name}の継承に不服を唱えた${rival.name}が${PROV_DEF[base].city}で兵を挙げ、「${nat.name}」を称した！`, true);
  return nat;
}

// 婚姻による相続：跡継ぎのいない国は、姫の嫁ぎ先の君主が継ぐことがある
export function marriageClaimant(st, nid) {
  const daughters = Object.values(st.princesses || {}).filter((p) => p.alive && p.married && p.nation === nid && p.married.nation !== nid && st.nations[p.married.nation]?.alive
    && st.nations[p.married.nation].rulerId === p.married.to);
  if (!daughters.length) return null;
  daughters.sort((a, b) => (st.nations[nid].relations[b.married.nation] ?? 0) - (st.nations[nid].relations[a.married.nation] ?? 0));
  return { nation: daughters[0].married.nation, princess: daughters[0] };
}

// ---------- 傅役と教育 ----------
export const EDU = {
  martial: { name: '武芸', stats: ['war', 'lead'] },
  arts: { name: '学問', stats: ['pol', 'cha'] },
  balanced: { name: '文武両道', stats: ['war', 'lead', 'pol', 'cha'] },
};
export const TUTOR_FEE = 100;
export function childrenOf(st, nid) {
  const sons = Object.values(st.generals).filter((g) => g.alive && g.nation === nid && g.family && st.year - g.birth < 15 && st.year >= g.birth);
  const daughters = Object.values(st.princesses || {}).filter((p) => p.alive && p.nation === nid && !p.married && st.year - p.birth < 15);
  return { sons, daughters };
}
export function tutorCandidates(st, nid) {
  const n = st.nations[nid];
  const busy = new Set([...Object.values(st.generals), ...Object.values(st.princesses || {})].map((x) => x.tutorId).filter(Boolean));
  return Object.values(st.generals).filter((g) => g.alive && g.nation === nid && g.id !== n.rulerId && st.year - g.birth >= 20 && !g.captiveOf && !g.hostageOf && !busy.has(g.id));
}
export function assignTutor(st, child, gid) {
  if (!gid) { delete child.tutorId; return { ok: true }; }
  const t = st.generals[gid];
  if (!t?.alive) return { ok: false, reason: '不適任です' };
  child.tutorId = gid;
  t.loyalty = Math.min(100, t.loyalty + 5);
  log(st, `${t.name}が${child.name}の傅役に任じられた。`, t.nation === st.playerNation);
  return { ok: true };
}
// 毎年：教育で子の能力が伸びる
export function educationYear(st) {
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const { sons, daughters } = childrenOf(st, n.id);
    for (const c of [...sons, ...daughters]) {
      const isSon = sons.includes(c);
      const edu = EDU[c.edu ?? (isSon ? 'balanced' : 'arts')];
      const stats = edu.stats.filter((s) => isSon || s === 'pol' || s === 'cha');
      const t = c.tutorId ? st.generals[c.tutorId] : null;
      const tutor = t?.alive && t.nation === n.id ? t : null;
      if (c.tutorId && !tutor) delete c.tutorId;
      if (tutor && n.gold >= TUTOR_FEE) {
        n.gold -= TUTOR_FEE;
        for (const s of stats) c[s] = Math.min(99, c[s] + 1 + Math.round(Math.max(0, tutor[s] - c[s]) * 0.06));
        tutor.loyalty = Math.min(100, tutor.loyalty + 2);
        // 傅役の特技を受け継ぐことがある
        if (isSon && tutor.traits?.length && (c.traits?.length ?? 0) < 2 && chance(st, 0.1)) {
          const cand = tutor.traits.filter((x) => x !== 'ambitious' && !(c.traits ?? []).includes(x));
          if (cand.length) {
            const tr = pick(st, cand);
            c.traits = [...(c.traits ?? []), tr];
            if (n.id === st.playerNation) log(st, `【後宮】${c.name}は傅役${tutor.name}の薫陶を受け、特技を身につけた。`, true);
          }
        }
      } else if (chance(st, 0.5)) {
        const s = pick(st, stats);
        c[s] = Math.min(99, c[s] + 1);
      }
    }
  }
}

// ---------- 封地 ----------
export function fiefCandidates(st, nid) {
  const n = st.nations[nid];
  return Object.values(st.generals).filter((g) => g.alive && g.nation === nid && g.family && g.id !== n.rulerId && st.year - g.birth >= 15 && !g.hostageOf && !g.captiveOf);
}
export function grantFief(st, gid, pid) {
  const g = st.generals[gid];
  const p = st.provinces[pid];
  const n = st.nations[g.nation];
  if (!p || p.owner !== g.nation) return { ok: false, reason: '自領ではありません' };
  if (pid === n.capital) return { ok: false, reason: '首都は封地にできません' };
  if (Object.values(st.generals).some((x) => x.alive && x.fief === pid && x !== g)) return { ok: false, reason: 'すでに他の王族の封地です' };
  g.fief = pid;
  g.province = pid;
  p.governorId = g.id;
  g.loyalty = Math.min(100, g.loyalty + 10);
  log(st, `${g.name}が${PROV_DEF[pid].city}を封地として与えられた。`, g.nation === st.playerNation);
  return { ok: true };
}
export function fiefHolder(st, pid) {
  return Object.values(st.generals).find((g) => g.alive && g.fief === pid && g.nation === st.provinces[pid].owner) ?? null;
}

// ---------- 季節ごと：外戚との関係と後宮の出来事 ----------
export function courtTick(st) {
  const player = st.playerNation;
  // 外戚：他国出身の妃の寵愛しだいで実家との関係が動く
  if (st.turn % 2 === 0) {
    for (const c of Object.values(st.consorts || {})) {
      if (!c.alive || !c.origin || c.origin === c.nation || !st.nations[c.origin]?.alive || !st.nations[c.nation]?.alive) continue;
      if (c.affection >= 60) adjustRel(st, c.nation, c.origin, 1);
      else if (c.affection < 30) adjustRel(st, c.nation, c.origin, -1);
    }
  }
  // 婚姻同盟は冷え込みにくい
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    for (const [b, t] of Object.entries(n.treaties || {})) {
      if (t.marriage && n.id < b && st.nations[b]?.alive && (n.relations[b] ?? 0) < 20) adjustRel(st, n.id, b, 1);
    }
  }
  // 後宮の出来事
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const cs = consortsOf(st, n.rulerId);
    if (!cs.length) continue;
    const mine = n.id === player;
    const note = (t) => { if (mine) log(st, `【後宮】${t}`, true); };
    const top = [...cs].sort((a, b) => b.affection - a.affection)[0];
    for (const c of cs) {
      const tr = consortTrait(c);
      if (tr === 'jealous' && top !== c && top.affection - c.affection >= 40 && chance(st, 0.15)) {
        c.affection = Math.max(0, c.affection - 10);
        top.affection = Math.max(0, top.affection - 5);
        note(`${c.name}が${top.name}への寵愛を妬み、後宮で諍いが起きた。`);
      } else if (tr === 'schemer' && c.affection >= 70 && chance(st, 0.1)) {
        if (chance(st, 0.5)) {
          const loss = Math.min(n.gold, 150);
          n.gold -= loss;
          note(`${c.name}の贅沢が過ぎ、金${loss}が費やされた。`);
        } else {
          const vs = Object.values(st.generals).filter((g) => g.alive && g.nation === n.id && !g.family && g.id !== n.rulerId);
          if (vs.length) { const v = pick(st, vs); v.loyalty = Math.max(0, v.loyalty - 4); note(`${c.name}が政に口を挟み、${v.name}が眉をひそめた（忠誠-4）。`); }
        }
      } else if (tr === 'wise' && c.chief && c.affection >= 60 && chance(st, 0.08)) {
        const vs = Object.values(st.generals).filter((g) => g.alive && g.nation === n.id && !g.family && g.id !== n.rulerId).sort((a, b) => a.loyalty - b.loyalty);
        if (vs[0]) { vs[0].loyalty = Math.min(100, vs[0].loyalty + 6); note(`${c.name}の内助の功で、${vs[0].name}の不満がやわらいだ（忠誠+6）。`); }
      }
    }
  }
}

function adjustRel(st, a, b, d) {
  const na = st.nations[a], nb = st.nations[b];
  if (!na || !nb || a === b) return;
  const v = Math.max(-100, Math.min(100, (na.relations[b] ?? 0) + d));
  na.relations[b] = v; nb.relations[a] = v;
}

setCourtHooks({ chiefOf, consortTrait });
