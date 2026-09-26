// 人材：名声、在野の放浪と仕官の申し出、登用の口説き方（贈物・位階の約束・三顧の礼）、推挙、史実の在野人物、俸給
import { NEIGHBORS } from './geo.js';
import { chance, rnd, rint, pick } from './rng.js';
import { PROV_DEF, nationProvinces, nationGenerals, addGeneral, randomGeneral, log, isActive } from './state.js';
import { hasTrait, ensurePersonnel, RANKS } from './personnel.js';
import { isSeaLink } from './warfare.js';

const ruler = (st, nid) => st.generals[st.nations[nid]?.rulerId];

// ---------- 名声 ----------
export function fame(st, nid) {
  const n = st.nations[nid];
  if (!n?.alive) return 0;
  const r = ruler(st, nid);
  let f = 15 + nationProvinces(st, nid).length * 3 + ((r?.cha ?? 50) - 50) / 2 + ((n.trust ?? 60) - 60) / 4;
  if (n.crowned) f += 15;
  if (r && hasTrait(r, 'benevolent')) f += 5;
  return Math.max(0, Math.min(100, Math.round(f)));
}
export function fameLabel(f) { return f >= 80 ? '天下に轟く' : f >= 60 ? '名高い' : f >= 40 ? '知られている' : f >= 20 ? '無名に近い' : '無名'; }

// ---------- 俸給 ----------
export const stipendOf = (g) => (g.merc ? 0 : 5 + (g.rank ?? 0) * 4);
export function stipendTotal(st, nid) {
  const n = st.nations[nid];
  return nationGenerals(st, nid).filter((g) => g.id !== n.rulerId).reduce((s, g) => s + stipendOf(g), 0);
}

// ---------- 登用 ----------
// opts: { gold: 贈物の金, rank: 位階を約束するか }
export function hireChanceWith(st, nid, g, opts = {}) {
  const r = ruler(st, nid);
  ensurePersonnel(g);
  let p = 0.3 + ((r?.cha ?? 50) - 50) / 100 + (g.cha < 50 ? 0.1 : 0) + (r && hasTrait(r, 'eloquent') ? 0.15 : 0);
  p += (fame(st, nid) - 40) / 200;
  p += Math.min(0.3, (opts.gold ?? 0) / 1000);
  if (opts.rank) p += 0.15;
  const visits = g.courted?.[nid] ?? 0;
  p += Math.min(0.3, visits * 0.1); // 三顧の礼：通うほど心を動かされる
  if (g.recommendedTo === nid) p += 0.2;
  if (hasTrait(g, 'ambitious')) p += (opts.rank ? 0.1 : -0.05);
  if (hasTrait(g, 'loyal') && g.formerNation && st.nations[g.formerNation]?.alive) p -= 0.25; // 旧主を慕う
  if (g.named) p -= 0.1;
  return Math.max(0.05, Math.min(0.95, p));
}
export function hireCostOf(opts = {}) { return opts.gold ?? 0; }
export function tryHireWith(st, nid, gid, opts = {}) {
  const g = st.generals[gid];
  const nat = st.nations[nid];
  if (g.nation || !isActive(st, g)) return { ok: false, reason: '登用できません' };
  if (g.hireTried === st.turn && g.hireBy === nid) return { ok: false, reason: 'この季節はすでに断られました' };
  if ((opts.gold ?? 0) > nat.gold) return { ok: false, reason: '金が足りません' };
  nat.gold -= opts.gold ?? 0;
  g.hireTried = st.turn; g.hireBy = nid;
  if (rnd(st) < hireChanceWith(st, nid, g, opts)) {
    const moved = (g.courted?.[nid] ?? 0) >= 2;
    g.nation = nid;
    g.loyalty = 60 + Math.round(rnd(st) * 20) + Math.round((opts.gold ?? 0) / 50);
    g.loyalty = Math.min(100, g.loyalty);
    if (opts.rank && g.rank < RANKS.length - 1) { g.rank += 1; g.merit = Math.max(g.merit ?? 0, RANKS[g.rank].merit); }
    delete g.courted; delete g.recommendedTo;
    return { ok: true, success: true, text: `${g.name}が配下に加わった！${moved ? '（三顧の礼に心を動かされた）' : ''}` };
  }
  g.courted ??= {};
  g.courted[nid] = (g.courted[nid] ?? 0) + 1;
  const n = g.courted[nid];
  return { ok: true, success: false, text: `${g.name}に断られた…${n >= 2 ? `（${n}度目。通い続ければ心を動かせるかもしれない）` : ''}` };
}

// ---------- 在野の放浪と仕官の申し出 ----------
// 季節ごと：在野の人物は各地を渡り歩き、名声の高い国に仕官を願い出ることがある。プレイヤー宛ての申し出を返す
export function roninTick(st) {
  const petitions = [];
  const winter = st.season === 3;
  const ronin = Object.values(st.generals).filter((g) => g.alive && !g.nation && isActive(st, g) && !g.captiveOf);
  for (const g of ronin) {
    // 放浪
    if (chance(st, 0.25)) {
      const opts = NEIGHBORS[g.province]?.filter((q) => !(winter && isSeaLink(g.province, q))) ?? [];
      if (opts.length) {
        const w = opts.map((q) => ({ q, w: 1 + fame(st, st.provinces[q].owner) / 20 }));
        let x = rnd(st) * w.reduce((s, o) => s + o.w, 0);
        for (const o of w) { x -= o.w; if (x <= 0) { g.province = o.q; break; } }
      }
    }
    // 仕官の申し出（いる地方の支配国へ）
    const owner = st.provinces[g.province]?.owner;
    if (!owner || !st.nations[owner]?.alive) continue;
    if (g.petitioned === st.year) continue;
    const f = fame(st, owner);
    if (!chance(st, 0.02 + f / 800)) continue;
    g.petitioned = st.year;
    if (owner === st.playerNation) petitions.push({ kind: 'petition', gid: g.id, from: owner });
    else {
      const nat = st.nations[owner];
      const count = nationGenerals(st, owner).length;
      if (count < nationProvinces(st, owner).length * 4 + 3 && nat.gold > stipendTotal(st, owner) * 2) {
        g.nation = owner;
        g.loyalty = 70 + rint(st, 0, 15);
      }
    }
  }
  return petitions;
}
export function acceptPetition(st, gid) {
  const g = st.generals[gid];
  if (!g?.alive || g.nation) return false;
  g.nation = st.playerNation;
  g.loyalty = 75 + rint(st, 0, 15);
  log(st, `${g.name}が自ら仕官を願い出て、配下に加わった。`);
  return true;
}

// ---------- 推挙 ----------
// 毎年：人望のある家臣が知人を推挙し、その地方に在野の人物が現れる（その国には仕えやすい）
export function recommendations(st) {
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const gens = nationGenerals(st, n.id);
    if (gens.length >= nationProvinces(st, n.id).length * 4 + 4) continue;
    const pool = gens.filter((g) => g.id !== n.rulerId && (g.cha >= 70 || hasTrait(g, 'eloquent')));
    if (!pool.length || !chance(st, 0.3)) continue;
    const by = pick(st, pool);
    const r = randomGeneral(st, null, n.culture);
    // 推挙する者の得意分野に似た人物
    for (const s of ['war', 'lead', 'pol', 'cha']) r[s] = Math.min(95, Math.round((r[s] + by[s]) / 2) + rint(st, 0, 8));
    r.province = by.province;
    const g = addGeneral(st, r);
    g.recommendedTo = n.id;
    g.recommendedBy = by.id;
    if (n.id === st.playerNation) log(st, `【推挙】${by.name}が知人の${g.name}（武${g.war} 統${g.lead} 政${g.pol} 魅${g.cha}）を推挙した。${PROV_DEF[g.province]?.city ?? ''}にいる（登用しやすい）。`, true);
  }
}

// ---------- 史実の在野人物 ----------
// 名前, 文化, 生年, 武, 統, 政, 魅, 現れる年, 地方, 特技
const NAMED_RONIN = [
  ['チンカイ', 'turkic', 1169, 50, 55, 85, 70, 1195, 'ker', ['eloquent']],
  ['タタトゥンガ', 'turkic', 1170, 30, 40, 88, 65, 1196, 'nai', ['merchant']],
  ['マフムード・ヤラワチ', 'islamic', 1180, 25, 40, 92, 72, 1205, 'khw', ['merchant', 'benevolent']],
  ['郭宝玉', 'chinese', 1165, 80, 85, 70, 65, 1205, 'ty', ['cunning']],
  ['張柔', 'chinese', 1190, 82, 84, 60, 70, 1212, 'jz', ['drill']],
  ['史天沢', 'chinese', 1202, 85, 88, 75, 78, 1220, 'jz', ['loyal']],
  ['余玠', 'chinese', 1198, 72, 85, 80, 72, 1224, 'sy', ['fortify']],
  ['北条泰時', 'japanese', 1183, 70, 80, 92, 88, 1201, 'jpe', ['benevolent']],
  ['ヤークート', 'islamic', 1179, 20, 25, 80, 60, 1200, 'irq', ['merchant']],
  ['ナスィールッディーン・トゥースィー', 'islamic', 1201, 20, 40, 97, 75, 1222, 'kho', ['cunning']],
  ['シモン・ド・モンフォール', 'european', 1175, 88, 86, 60, 70, 1200, 'fra', ['charge']],
  ['金就礪', 'korean', 1172, 80, 84, 60, 70, 1205, 'kor', ['loyal']],
  ['ムハンマド・バフティヤール', 'islamic', 1170, 86, 80, 45, 55, 1195, 'gha', ['charge']],
];
export function namedRoninTick(st) {
  st.namedRonin ??= {};
  for (const [name, culture, birth, war, lead, pol, cha, year, pid, traits] of NAMED_RONIN) {
    if (st.namedRonin[name] || st.year < year) continue;
    st.namedRonin[name] = true;
    if (Object.values(st.generals).some((g) => g.name === name)) continue;
    if (st.year - birth > 65) continue;
    const g = addGeneral(st, { name, birth, war, lead, pol, cha, province: pid, loyalty: 70 });
    g.named = true;
    g.traits = [...traits];
    g.culture = culture;
    const owner = st.provinces[pid]?.owner;
    log(st, `【人材】${name}という逸材が${PROV_DEF[pid].city}に現れたという。${owner === st.playerNation ? '（自領にいる）' : ''}`, owner === st.playerNation);
  }
}
