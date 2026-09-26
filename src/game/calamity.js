// 災害：疫病（広がる・武将も罹る）・飢饉（蝗害・旱魃・冷害）・地震と、その備え（施療・封鎖・施し）
import { PROVINCES } from './data.js';
import { chance, rint, pick, rnd } from './rng.js';
import { NEIGHBORS } from './geo.js';
import { generalsIn, age, log } from './state.js';
import { isHub } from './trade.js';
import { knows } from './research.js';
import { killGeneral } from './military.js';

const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
const cityName = (pid) => PDEF[pid].city;

export const PLAGUE_LEVELS = [null, { name: '流行り病' }, { name: '疫病' }, { name: '大疫' }];
export const FAMINE_KINDS = {
  locust: { name: '蝗害' },
  drought: { name: '旱魃' },
  cold: { name: '冷害' },
};
// 地震の多い地方
export const QUAKE_PROVS = new Set(['jpw', 'jpe', 'osh', 'kyu', 'rum', 'syr', 'ira', 'kho', 'aze', 'geo', 'tib', 'sc', 'gre', 'byz', 'ita', 'xia']);
const NORTH = new Set(PROVINCES.filter((p) => p.lat >= 50).map((p) => p.id));

export const plagueOf = (st, pid) => {
  const pl = st.provinces[pid]?.city.plague;
  return pl && pl.until > st.turn ? pl : null;
};
export const famineOf = (st, pid) => {
  const f = st.provinces[pid]?.city.famine;
  return f && f.until > st.turn ? f : null;
};
export const isQuarantined = (st, pid) => !!st.provinces[pid]?.city.quarantine;

// 内政の補正（adminMods から呼ばれる）
export function calamityMods(st, pid) {
  const c = st.provinces[pid].city;
  const loyalty = [], order = [];
  let goldMul = 1, farmMul = 1, grow = 1;
  const pl = plagueOf(st, pid);
  const soothe = c.patron > st.turn ? 0.5 : 1; // 寺社保護で祈祷が行われ、民の動揺が和らぐ
  if (pl) {
    loyalty.push([PLAGUE_LEVELS[pl.sev].name, -Math.round(4 * pl.sev * soothe)]);
    order.push([PLAGUE_LEVELS[pl.sev].name, -3 * pl.sev]);
    goldMul *= 1 - 0.1 * pl.sev;
    farmMul *= 1 - 0.05 * pl.sev;
    grow = 0;
  }
  const f = famineOf(st, pid);
  if (f) {
    loyalty.push([`飢饉（${FAMINE_KINDS[f.kind].name}）`, -Math.round(8 * soothe)]);
    order.push(['飢饉', -6]);
    farmMul *= 0.6;
    grow *= 0.3;
  }
  if (c.quarantine) {
    loyalty.push(['封鎖', -2]);
    goldMul *= 0.85;
  }
  return { loyalty, order, goldMul, farmMul, grow };
}

// ---------- 疫病 ----------
export function startPlague(st, pid, sev = 1, { quiet = false } = {}) {
  const c = st.provinces[pid].city;
  if (plagueOf(st, pid) || (c.immuneUntil ?? 0) > st.turn) return false;
  c.plague = { sev, since: st.turn, until: st.turn + rint(st, 3, 5) + sev };
  if (!quiet && st.provinces[pid].owner === st.playerNation) log(st, `【${cityName(pid)}】${PLAGUE_LEVELS[sev].name}が発生した！人口が減り、商いが滞る。`, true);
  return true;
}

function endPlague(st, pid) {
  const c = st.provinces[pid].city;
  delete c.plague;
  c.immuneUntil = st.turn + 12;
  if (st.provinces[pid].owner === st.playerNation) log(st, `【${cityName(pid)}】疫病がようやく収まった。`, true);
}

function outbreakChance(st, pid) {
  const p = st.provinces[pid];
  let q = 0.002;
  if (isHub(pid)) q += 0.004;
  if (p.city.pop > 15000) q += 0.002;
  if (famineOf(st, pid)) q += 0.02;
  if (st.sieges?.[pid]) q += 0.02;
  return q;
}

// 隣へうつる確率（封鎖していると大きく下がる）
export function spreadChance(st, from, to, byRoute = false) {
  const pl = plagueOf(st, from);
  if (!pl) return 0;
  let q = (byRoute ? 0.08 : 0.05) * pl.sev;
  if (isQuarantined(st, from)) q *= 0.2;
  if (isQuarantined(st, to)) q *= 0.2;
  return q;
}

// 疫病に罹った地方の季節の被害
function plagueDamage(st, pid, note) {
  const p = st.provinces[pid], c = p.city, pl = plagueOf(st, pid);
  const treated = pl.treated === st.turn;
  c.pop = Math.round(c.pop * (1 - 0.025 * pl.sev * (treated ? 0.5 : 1)));
  const protect = st.options?.protectRuler;
  for (const g of Object.values(st.generals)) {
    if (!g.alive || g.province !== pid || g.captiveOf || !g.nation) continue;
    if (g.unit?.soldiers) g.unit.soldiers = Math.round(g.unit.soldiers * (1 - 0.02 * pl.sev));
    const isRuler = st.nations[g.nation]?.rulerId === g.id;
    if (age(st, g) >= 50 && chance(st, 0.01 * pl.sev) && !(isRuler && protect && g.nation === st.playerNation)) {
      pl.victims = [...(pl.victims ?? []), g.name];
      killGeneral(st, g.id);
      if (g.nation === st.playerNation || isRuler) log(st, `${st.nations[g.nation]?.name ?? ''}の${g.name}が${cityName(pid)}で疫病に倒れた。`, true);
    } else if (chance(st, 0.03 * pl.sev) && !(g.wound > st.turn)) {
      g.wound = st.turn + 2;
      if (g.nation === st.playerNation) note(`${g.name}が疫病に罹り、床に伏した（2季）`);
    }
  }
  // 包囲している軍にも疫病が広がる
  const sg = st.sieges?.[pid];
  if (sg) for (const id of sg.gids) { const g = st.generals[id]; if (g?.unit?.soldiers) g.unit.soldiers = Math.round(g.unit.soldiers * (1 - 0.03 * pl.sev)); }
}

// ---------- 飢饉 ----------
export function startFamine(st, pid, kind, seasons = 4) {
  const c = st.provinces[pid].city;
  if (famineOf(st, pid)) return false;
  c.famine = { kind, since: st.turn, until: st.turn + seasons };
  return true;
}

// ---------- 地震 ----------
export function earthquake(st, pid) {
  const c = st.provinces[pid].city;
  const built = c.grid.filter((t) => t.b && t.b.progress >= 1 && t.b.type !== 'palace');
  let broken = 0;
  for (let i = 0; i < Math.min(built.length, rint(st, 1, 3)); i += 1) {
    const t = pick(st, built.filter((x) => x.b));
    if (!t) break;
    if (t.b.level > 1) t.b.level -= 1; else t.b = null;
    broken += 1;
  }
  let wall = false;
  if (c.walls > 0 && chance(st, 0.4)) { c.walls -= 1; wall = true; }
  c.pop = Math.round(c.pop * 0.97);
  c.loyalty = Math.max(0, c.loyalty - 5);
  return { broken, wall };
}

// ---------- 地方ごとの季節の判定（turn.js の randomEvent から） ----------
export function provinceCalamity(st, p, y, note) {
  const pid = p.id, c = p.city, def = PDEF[pid];
  const nat = st.nations[p.owner];
  const river = c.grid.some((t) => t.t === 'river');
  if (st.season === 1) {
    // 蝗害（夏）
    if (chance(st, 0.03)) {
      const f = Math.round(y.food * 0.8);
      nat.food = Math.max(0, nat.food - f);
      startFamine(st, pid, 'locust');
      note(`蝗の大群が畑を食い尽くした。食糧-${f}、1年間の飢饉に`);
    } else if (!river && (def.terrain === 'desert' || def.terrain === 'steppe' || def.terrain === 'farmland') && chance(st, 0.025 * (knows(st, p.owner, 'qanat') ? 0.5 : 1) * (def.terrain === 'desert' ? 1.5 : 1))) {
      startFamine(st, pid, 'drought');
      note('日照りが続き、旱魃となった。1年間、収穫が大きく減る');
    } else if (NORTH.has(pid) && chance(st, 0.02)) {
      startFamine(st, pid, 'cold');
      note('夏になっても寒さが続き、冷害で作物が実らない');
    }
  }
  if (!plagueOf(st, pid) && chance(st, outbreakChance(st, pid))) {
    if (startPlague(st, pid, famineOf(st, pid) || st.sieges?.[pid] ? 2 : chance(st, 0.2) ? 2 : 1, { quiet: true })) note(`${PLAGUE_LEVELS[c.plague.sev].name}が発生した！人口が減り、商いが滞る`);
  }
  if (QUAKE_PROVS.has(pid) && chance(st, 0.006)) {
    const r = earthquake(st, pid);
    note(`大地震が起きた！建物${r.broken}棟が損壊${r.wall ? '、城壁も崩れた' : ''}`);
  }
}

// 季節の終わり：疫病の被害・広がり・終息、飢饉の終わり
export function calamityTick(st) {
  const hit = Object.values(st.provinces).filter((p) => plagueOf(st, p.id));
  const note = (pid) => (t) => { if (st.provinces[pid].owner === st.playerNation) log(st, `【${cityName(pid)}】${t}`, true); };
  for (const p of hit) plagueDamage(st, p.id, note(p.id));
  // 広がり：隣の地方と交易路
  const next = [];
  for (const p of hit) {
    const sev = plagueOf(st, p.id).sev;
    for (const q of NEIGHBORS[p.id]) if (chance(st, spreadChance(st, p.id, q))) next.push([q, Math.max(1, sev - (chance(st, 0.5) ? 1 : 0)), p.id]);
    for (const r of st.routes ?? []) {
      const other = r.from === p.id ? r.to : r.to === p.id ? r.from : null;
      if (other && chance(st, spreadChance(st, p.id, other, true))) next.push([other, 1, p.id]);
    }
  }
  for (const [pid, sev, from] of next) {
    if (startPlague(st, pid, sev, { quiet: true }) && st.provinces[pid].owner === st.playerNation) {
      log(st, `【${cityName(pid)}】${cityName(from)}から${PLAGUE_LEVELS[sev].name}がうつってきた！`, true);
    }
  }
  // 終息
  for (const p of Object.values(st.provinces)) {
    const c = p.city;
    if (c.plague && c.plague.until <= st.turn + 1) endPlague(st, p.id);
    if (c.famine && c.famine.until <= st.turn + 1) {
      delete c.famine;
      if (p.owner === st.playerNation) log(st, `【${cityName(p.id)}】飢饉が明け、畑に実りが戻った。`);
    }
  }
}

// ---------- 対策 ----------
// 施療（内政命令）：成功すれば疫病が一段軽くなり、失敗してもその季節の被害が半分になる
export function cureChance(st, pid, g) {
  const techs = Object.values(st.techs ?? {}).filter((t) => t.city === pid && t.type === 'scholar').length;
  return Math.min(0.85, 0.35 + g.pol / 200 + techs * 0.1 + (g.traits?.includes('benevolent') ? 0.1 : 0));
}
export function cure(st, pid, g) {
  const pl = plagueOf(st, pid);
  if (!pl) return { ok: false, text: '疫病は起きていません' };
  pl.treated = st.turn;
  let text;
  if (rnd(st) < cureChance(st, pid, g)) {
    pl.sev -= 1;
    pl.until -= 1;
    if (pl.sev <= 0) { pl.until = st.turn; endPlague(st, pid); text = '医師と薬を集め、疫病を鎮めた'; } else text = `手当てが実り、${PLAGUE_LEVELS[pl.sev].name}に和らいだ`;
  } else text = '手を尽くしたが、病の勢いは衰えない（この季節の被害は半分に）';
  if (chance(st, 0.1)) { g.wound = st.turn + 2; text += `。${g.name}も病に罹った`; }
  return { ok: true, text };
}

// 施し（内政命令）を飢饉の地で行うと、飢饉が早く明ける
export function relieveFamine(st, pid) {
  const f = famineOf(st, pid);
  if (!f) return false;
  f.until -= 2;
  if (f.until <= st.turn) delete st.provinces[pid].city.famine;
  return true;
}

export function setQuarantine(st, pid, on) {
  st.provinces[pid].city.quarantine = !!on;
}

// AI（委任都市を含む）：重い疫病の都市を封鎖し、収まれば解く
export function aiQuarantine(st, nid, pids) {
  for (const pid of pids) {
    const c = st.provinces[pid].city;
    const pl = plagueOf(st, pid);
    const near = NEIGHBORS[pid].some((q) => plagueOf(st, q)?.sev >= 2);
    if (!c.quarantine && ((pl && pl.sev >= 2) || (near && !pl && st.nations[nid].gold > 1500))) c.quarantine = true;
    else if (c.quarantine && !pl && !near) c.quarantine = false;
  }
}

// 地図・パネル用の短い表示
export function calamityTags(st, pid) {
  const out = [];
  const pl = plagueOf(st, pid);
  if (pl) out.push(PLAGUE_LEVELS[pl.sev].name);
  const f = famineOf(st, pid);
  if (f) out.push(`飢饉（${FAMINE_KINDS[f.kind].name}）`);
  if (isQuarantined(st, pid)) out.push('封鎖');
  return out;
}
