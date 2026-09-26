// 籠城戦：包囲・兵糧・城壁の損耗・総攻撃・出撃・後詰め・兵站
import { WALLS } from './data.js';
import { NEIGHBORS } from './geo.js';
import { PROV_DEF, generalsIn, unitPower, unitCap, log, nationProvinces } from './state.js';
import { killGeneral, applyBattle, woundGeneral, isWounded } from './military.js';
import { createBattle, autoResolve } from './battle.js';
import { atWar, friendsOf } from './diplomacy.js';
import { handleCaptives, gatherReinforcements } from './actions.js';

const city = (pid) => PROV_DEF[pid].city;
const nm = (st, nid) => st.nations[nid]?.name ?? '';
const involved = (st, ...ids) => ids.includes(st.playerNation);

export function sieges(st) { st.sieges = st.sieges || {}; return st.sieges; }
export const siegeAt = (st, pid) => sieges(st)[pid] || null;

export function besiegers(st, pid) {
  const s = siegeAt(st, pid);
  if (!s) return [];
  return s.gids.map((id) => st.generals[id]).filter((g) => g?.alive && g.nation === s.att && g.province === pid && g.unit?.soldiers > 0 && !isWounded(st, g));
}
export function defenders(st, pid) {
  const owner = st.provinces[pid].owner;
  return owner ? generalsIn(st, pid, owner).filter((g) => g.unit?.soldiers > 0) : [];
}
const powerOf = (gens) => gens.reduce((s, g) => s + unitPower(g), 0);

export function canBesiege(st, nid, pid) {
  const p = st.provinces[pid];
  return !!p.owner && p.owner !== nid && p.city.walls >= 1 && defenders(st, pid).length > 0;
}

// 籠城できる期間（季）：城壁と農地の数で決まる
export function initialSupply(st, pid) {
  const c = st.provinces[pid].city;
  const farms = c.grid.filter((t) => t.b?.type === 'farm' && t.b.progress >= 1).length;
  return 2 + c.walls + Math.min(4, Math.floor(farms / 2));
}

export function startSiege(st, nid, gids, pid, from) {
  const all = sieges(st);
  let s = all[pid];
  if (s && s.att !== nid) return { ok: false, reason: '他の勢力が包囲中です' };
  if (!s) {
    s = all[pid] = { att: nid, gids: [], since: st.turn, from, supply: initialSupply(st, pid), wallHp: st.provinces[pid].city.walls * 100 };
    log(st, `${nm(st, nid)}軍が${city(pid)}を包囲した。（${WALLS[st.provinces[pid].city.walls].name}・兵糧${s.supply}季分）`, involved(st, nid, st.provinces[pid].owner));
  }
  for (const id of gids) {
    const g = st.generals[id];
    if (!g) continue;
    g.province = pid; g.besieging = pid; g.moved = true;
    if (!s.gids.includes(id)) s.gids.push(id);
  }
  return { ok: true, siege: s };
}

function homeFor(st, nid, s) {
  if (s?.from && st.provinces[s.from]?.owner === nid) return s.from;
  const own = nationProvinces(st, nid);
  if (!own.length) return null;
  const q = [s?.from].filter(Boolean);
  const seen = new Set(q);
  while (q.length) {
    const a = q.shift();
    if (st.provinces[a].owner === nid) return a;
    for (const b of NEIGHBORS[a]) if (!seen.has(b)) { seen.add(b); q.push(b); }
  }
  return own[0].id;
}

export function liftSiege(st, pid, reason = '') {
  const s = siegeAt(st, pid);
  if (!s) return;
  const home = homeFor(st, s.att, s);
  for (const id of s.gids) {
    const g = st.generals[id];
    if (!g?.alive) continue;
    delete g.besieging;
    if (g.nation === s.att && g.province === pid) {
      if (home) g.province = home; else { g.nation = null; g.unit = null; }
    }
  }
  delete sieges(st)[pid];
  log(st, `${nm(st, s.att)}軍は${city(pid)}の包囲を解いた。${reason}`, involved(st, s.att, st.provinces[pid].owner));
}

function endSiegeAfterFall(st, pid) {
  const s = siegeAt(st, pid);
  if (!s) return;
  for (const id of s.gids) if (st.generals[id]) delete st.generals[id].besieging;
  delete sieges(st)[pid];
}

// 城壁への損害（季ごと）
export function wallDamage(st, pid) {
  const gens = besiegers(st, pid);
  let dmg = 0;
  for (const g of gens) dmg += g.unit.soldiers * (g.unit.type === 'siege' ? 0.08 : 0.01) * (0.8 + g.war / 250);
  return Math.round(dmg);
}

// 季節ごとの包囲の進行
export function siegeTick(st) {
  for (const pid of Object.keys(sieges(st))) {
    const s = siegeAt(st, pid);
    const p = st.provinces[pid];
    const att = st.nations[s.att];
    if (!att?.alive || !p.owner || p.owner === s.att || !atWar(st, s.att, p.owner)) { liftSiege(st, pid, '（情勢の変化）'); continue; }
    const bs = besiegers(st, pid);
    if (!bs.length) { liftSiege(st, pid, '（包囲軍が尽きた）'); continue; }
    const mine = involved(st, s.att, p.owner);
    // 兵站：敵地にいる兵は倍の兵糧を食う
    const soldiers = bs.reduce((a, g) => a + g.unit.soldiers, 0);
    att.food -= Math.round(soldiers * 0.1);
    const winter = st.season === 3;
    for (const g of bs) {
      let rate = winter ? (['mongol', 'turkic'].includes(att.culture) ? 0.95 : 0.9) : 0.97;
      if (att.food < 0) rate -= 0.1;
      g.unit.soldiers = Math.round(g.unit.soldiers * rate);
    }
    if (att.food < 0 && s.att === st.playerNation) log(st, `${city(pid)}の包囲軍への兵糧が届かず、兵が逃げ出している！`, true);
    // 城壁
    if (p.city.walls > 0) {
      s.wallHp -= wallDamage(st, pid);
      if (s.wallHp <= 0) {
        p.city.walls -= 1;
        s.wallHp = p.city.walls * 100;
        log(st, `${city(pid)}の城壁が破られ、「${WALLS[p.city.walls].name}」になった。`, mine);
      }
    }
    // 兵糧
    s.supply -= 1;
    const defs = defenders(st, pid);
    if (s.supply < 0) {
      for (const g of defs) g.unit.soldiers = Math.round(g.unit.soldiers * 0.85);
      p.city.loyalty = Math.max(0, p.city.loyalty - 10);
      p.city.pop = Math.round(p.city.pop * 0.95);
      if (mine) log(st, `${city(pid)}では兵糧が尽き、飢えた兵が倒れていく。`, true);
    }
    const defLeft = defs.reduce((a, g) => a + g.unit.soldiers, 0);
    if (s.supply <= -2 || defLeft < 100) surrender(st, pid);
  }
}

// 開城
function surrender(st, pid) {
  const s = siegeAt(st, pid);
  const owner = st.provinces[pid].owner;
  const gids = besiegers(st, pid).map((g) => g.id);
  endSiegeAfterFall(st, pid);
  // 守備兵は降伏（捕虜の扱いは占領と同じ）
  const result = { winner: 'att', provinceId: pid, fromProvince: s.from, attNation: s.att, defNation: owner, units: [] };
  const { captives } = applyBattle(st, result, gids);
  log(st, `${city(pid)}は兵糧が尽きて開城した。${nm(st, s.att)}が入城した。`, true);
  // 捕虜は AI の判断で処理（プレイヤーは次の画面で選べないため、登用を試みる）
  st.pendingCaptives = st.pendingCaptives || [];
  if (captives.length) st.pendingCaptives.push({ captor: s.att, gids: captives });
}

// 捕虜が残っていれば処理する（ターン処理から呼ぶ）
export async function flushCaptives(st, hooks) {
  const list = st.pendingCaptives || [];
  st.pendingCaptives = [];
  for (const c of list) await handleCaptives(st, c.captor, c.gids, hooks);
}

// 総攻撃（城攻めの合戦）
export async function assault(st, pid, hooks = {}) {
  const s = siegeAt(st, pid);
  if (!s) return { ok: false };
  const gens = besiegers(st, pid).filter((g) => !g.moved);
  if (!gens.length) return { ok: false, reason: '動ける武将がいません' };
  const owner = st.provinces[pid].owner;
  const attIds = gens.map((g) => g.id);
  const reinforce = { att: [], def: gatherReinforcements(st, owner, s.att, pid) };
  const b = createBattle(st, { attNation: s.att, attIds, provinceId: pid, fromProvince: s.from, reinforce, starving: s.supply < 0 });
  const inv = involved(st, s.att, owner);
  const result = inv && hooks.battle ? await hooks.battle(b) : autoResolve(b);
  for (const id of [...attIds, ...reinforce.def]) if (st.generals[id]) st.generals[id].moved = true;
  if (result.winner === 'att') {
    endSiegeAfterFall(st, pid);
    const { msgs, captives } = applyBattle(st, result, attIds);
    for (const m of msgs) log(st, m, inv);
    await handleCaptives(st, s.att, captives, hooks);
    return { ok: true, result, fell: true };
  }
  applyLosses(st, result);
  log(st, `${nm(st, s.att)}軍の${city(pid)}総攻撃は失敗した。`, inv);
  if (powerOf(besiegers(st, pid)) < powerOf(defenders(st, pid)) * 0.5) liftSiege(st, pid, '（総攻撃の失敗で力尽きた）');
  return { ok: true, result, fell: false };
}

// 合戦の損害だけを反映する（占領を伴わない野戦用）
function applyLosses(st, result) {
  for (const u of result.units) {
    const g = st.generals[u.gid];
    if (!g?.unit) continue;
    g.unit.soldiers = Math.max(0, Math.round(u.soldiers * (u.routed ? 0.8 : 1) / 10) * 10);
    g.unit.training = Math.min(100, g.unit.training + 3);
    if (u.dead) { log(st, `${g.name}が討死した。`, true); killGeneral(st, g.id); }
    else if (u.wounded) { const n = woundGeneral(st, g.id); log(st, `${g.name}が負傷した（${n}季のあいだ戦えない）。`, g.nation === st.playerNation); }
  }
}

// 出撃：守備側が城から打って出て、包囲軍と野戦する
export async function sally(st, pid, hooks = {}) {
  const s = siegeAt(st, pid);
  if (!s) return { ok: false };
  const owner = st.provinces[pid].owner;
  const gens = defenders(st, pid).filter((g) => !g.moved && !isWounded(st, g));
  if (!gens.length) return { ok: false, reason: '動ける武将がいません' };
  const ids = gens.map((g) => g.id);
  const bids = besiegers(st, pid).map((g) => g.id);
  const b = createBattle(st, { attNation: owner, attIds: ids, provinceId: pid, fromProvince: pid, defNation: s.att, defIds: bids, field: true });
  const inv = involved(st, s.att, owner);
  const result = inv && hooks.battle ? await hooks.battle(b) : autoResolve(b);
  applyLosses(st, result);
  for (const id of [...ids, ...bids]) if (st.generals[id]) st.generals[id].moved = true;
  if (result.winner === 'att') liftSiege(st, pid, `（${city(pid)}の守備兵が出撃して打ち破った）`);
  else log(st, `${city(pid)}の守備兵の出撃は押し返された。`, inv);
  return { ok: true, result };
}

// 後詰め：味方が救援に駆けつけ、包囲軍と野戦する
export async function relieve(st, nid, gids, from, pid, hooks = {}) {
  const s = siegeAt(st, pid);
  if (!s) return { ok: false };
  const owner = st.provinces[pid].owner;
  const garrison = defenders(st, pid).filter((g) => !g.moved && g.nation === nid).map((g) => g.id);
  const bids = besiegers(st, pid).map((g) => g.id);
  const b = createBattle(st, { attNation: nid, attIds: [...gids, ...garrison], provinceId: pid, fromProvince: from, defNation: s.att, defIds: bids, field: true });
  const inv = involved(st, s.att, owner, nid);
  const result = inv && hooks.battle ? await hooks.battle(b) : autoResolve(b);
  applyLosses(st, result);
  for (const id of [...gids, ...garrison, ...bids]) if (st.generals[id]) st.generals[id].moved = true;
  if (result.winner === 'att') {
    liftSiege(st, pid, `（${nm(st, nid)}の後詰めに敗れた）`);
    if (owner === nid) for (const id of gids) if (st.generals[id]?.alive) st.generals[id].province = pid;
  } else log(st, `${nm(st, nid)}の後詰めは${city(pid)}の包囲を破れなかった。`, inv);
  return { ok: true, result };
}

// AI：攻める際に強襲か包囲かを選ぶ
export function aiChooseSiege(st, nid, gids, pid) {
  const att = powerOf(gids.map((id) => st.generals[id]).filter(Boolean));
  const walls = st.provinces[pid].city.walls;
  const def = powerOf(defenders(st, pid)) * (1 + 0.35 * walls);
  if (att > def * 1.4) return 'assault';
  return att > powerOf(defenders(st, pid)) * 0.9 ? 'siege' : 'assault';
}

// AI の包囲関連の行動（総攻撃・撤退・出撃・後詰め）
export async function aiSieges(st, nid, hooks = {}) {
  for (const pid of Object.keys(sieges(st))) {
    const s = siegeAt(st, pid);
    if (!s) continue;
    const owner = st.provinces[pid].owner;
    const bp = powerOf(besiegers(st, pid));
    const dp = powerOf(defenders(st, pid));
    const walls = st.provinces[pid].city.walls;
    if (s.att === nid && nid !== st.playerNation) {
      const ratio = bp / Math.max(1, dp * (1 + 0.3 * walls));
      if (bp < dp * 0.6) liftSiege(st, pid, '（不利を悟って撤退した）');
      else if ((walls === 0 && ratio > 1.1) || (s.supply < 0 && ratio > 0.9) || ratio > 2.2) await assault(st, pid, hooks);
    } else if (owner === nid && nid !== st.playerNation) {
      if (dp > bp * 1.3) { await sally(st, pid, hooks); continue; }
      // 後詰め：隣接する自領・同盟国の兵で救援
      const helpers = [];
      for (const q of NEIGHBORS[pid]) {
        const o = st.provinces[q].owner;
        if (o !== nid || siegeAt(st, q)) continue;
        const gens = generalsIn(st, q, o).filter((g) => !g.moved && g.unit?.soldiers >= unitCap(g) * 0.5 && g.id !== st.provinces[q].governorId);
        helpers.push(...gens.map((g) => ({ g, from: q })));
      }
      const hp = powerOf(helpers.map((h) => h.g));
      if (helpers.length && hp + dp * 0.5 > bp * 1.2) {
        await relieve(st, nid, helpers.map((h) => h.g.id), helpers[0].from, pid, hooks);
      }
    }
  }
}

export function siegeInfo(st, pid) {
  const s = siegeAt(st, pid);
  if (!s) return null;
  return {
    ...s, besiegers: besiegers(st, pid), defenders: defenders(st, pid), walls: st.provinces[pid].city.walls,
    wallMax: st.provinces[pid].city.walls * 100, damage: wallDamage(st, pid), friends: friendsOf(st, st.provinces[pid].owner),
  };
}

