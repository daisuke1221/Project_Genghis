// 水軍：港の軍船・造船・海戦・渡海の迎撃・制海権と海上封鎖・神風
import { PROVINCES } from './data.js';
import { chance, rrange, rnd } from './rng.js';
import { nationProvinces, generalsIn, log, dateStr } from './state.js';
import { isPort } from './trade.js';
import { PROV_CULTURE } from './tech.js';
import { knows } from './research.js';
import { atWar, friendsOf } from './diplomacy.js';

const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
const nameOf = (st, id) => st.nations[id]?.name ?? '';

export const SEAS = {
  east: { name: '東シナ海', ports: ['kor', 'kyu', 'jpw', 'jpe', 'song', 'gz', 'ly'] },
  med: { name: '地中海', ports: ['ita', 'gre', 'byz', 'syr', 'egy'] },
  north: { name: '北海', ports: ['eng', 'fra'] },
  south: { name: '南海', ports: ['gz', 'ind'] },
};
export const SHIP_COST = 40;
export const SHIP_UPKEEP = 1;
export const PORT_CAP = 80;
export const BUILD_PER_SEASON = 10;
export const MIN_CONTROL = 10; // 制海権を握るのに必要な軍船

// 文化ごとの操船の巧みさ
const SEAFARING = {
  greek: 1.2, korean: 1.15, chinese: 1.1, european: 1.1, japanese: 1.05, islamic: 1, indian: 0.9,
  slavic: 0.8, georgian: 0.8, mongol: 0.6, turkic: 0.6, tibetan: 0.5,
};
export const seasOf = (pid) => Object.keys(SEAS).filter((k) => SEAS[k].ports.includes(pid));
export const sharedSea = (a, b) => seasOf(a).find((s) => SEAS[s].ports.includes(b)) ?? null;

export const shipsAt = (st, pid) => st.provinces[pid]?.fleet?.ships ?? 0;
export function nationShips(st, nid) {
  return nationProvinces(st, nid).reduce((s, p) => s + (p.fleet?.ships ?? 0), 0);
}

// 操船：自国の文化か、港を持つ征服地の船大工の腕（遊牧国家も高麗・南宋の港を得れば水軍を持てる）
export function navalSkill(st, nid) {
  let best = SEAFARING[st.nations[nid]?.culture] ?? 0.8;
  for (const p of nationProvinces(st, nid)) {
    if (isPort(p.id)) best = Math.max(best, (SEAFARING[PROV_CULTURE[p.id]] ?? 0.8) * 0.9);
  }
  return Math.round(best * (knows(st, nid, 'compass') ? 1.1 : 1) * 100) / 100;
}

export function admiralAt(st, pid) {
  const o = st.provinces[pid]?.owner;
  if (!o) return null;
  return generalsIn(st, pid, o).filter((g) => !(g.wound > st.turn)).sort((a, b) => b.lead - a.lead)[0] ?? null;
}

export function fleetPower(st, pid) {
  const o = st.provinces[pid]?.owner;
  const n = shipsAt(st, pid);
  if (!o || !n) return 0;
  return n * navalSkill(st, o) * (1 + (admiralAt(st, pid)?.lead ?? 30) / 200);
}

// ある海での国（と味方）の艦隊
function seaFleets(st, sea, nids) {
  return SEAS[sea].ports.filter((pid) => nids.includes(st.provinces[pid].owner) && shipsAt(st, pid) > 0);
}
const seaPower = (st, pids) => pids.reduce((s, pid) => s + fleetPower(st, pid), 0);

function loseShips(st, pids, frac) {
  let lost = 0;
  for (const pid of pids) {
    const f = st.provinces[pid].fleet;
    const l = Math.round(f.ships * frac);
    f.ships -= l;
    lost += l;
  }
  return lost;
}

// 海戦：勝った側の損害は小さく、負けた側は大きい
export function navalBattle(st, aPids, dPids, { aExtra = 0 } = {}) {
  const ap = (seaPower(st, aPids) + aExtra) * rrange(st, 0.8, 1.2);
  const dp = seaPower(st, dPids) * rrange(st, 0.8, 1.2);
  const aWins = ap > dp;
  const ratio = Math.min(3, Math.max(ap, dp) / Math.max(1, Math.min(ap, dp)));
  const winLoss = Math.max(0.05, 0.3 - ratio * 0.08), loseLoss = Math.min(0.8, 0.3 + ratio * 0.15);
  const aLost = loseShips(st, aPids, aWins ? winLoss : loseLoss);
  const dLost = loseShips(st, dPids, aWins ? loseLoss : winLoss);
  return { winner: aWins ? 'att' : 'def', aLost, dLost, ap: Math.round(ap), dp: Math.round(dp) };
}

// ---------- 造船 ----------
export function canBuildShips(st, pid, n = 1) {
  const p = st.provinces[pid];
  const nat = st.nations[p.owner];
  if (!nat) return { ok: false, reason: '空白地です' };
  if (!isPort(pid)) return { ok: false, reason: '港がありません' };
  if (st.sieges?.[pid]) return { ok: false, reason: '包囲されています' };
  const built = p.fleet?.builtTurn === st.turn ? p.fleet.built : 0;
  if (built + n > BUILD_PER_SEASON) return { ok: false, reason: `1季に造れるのは${BUILD_PER_SEASON}隻まで` };
  if (shipsAt(st, pid) + n > PORT_CAP) return { ok: false, reason: `この港に置けるのは${PORT_CAP}隻まで` };
  if (nat.gold < SHIP_COST * n) return { ok: false, reason: '金が足りません' };
  return { ok: true };
}
export function buildShips(st, pid, n) {
  const av = canBuildShips(st, pid, n);
  if (!av.ok) return av;
  const p = st.provinces[pid];
  st.nations[p.owner].gold -= SHIP_COST * n;
  p.fleet ??= { ships: 0 };
  if (p.fleet.builtTurn !== st.turn) { p.fleet.builtTurn = st.turn; p.fleet.built = 0; }
  p.fleet.built += n;
  p.fleet.ships += n;
  return { ok: true };
}
export function scuttle(st, pid, n) {
  const f = st.provinces[pid].fleet;
  if (!f) return;
  f.ships = Math.max(0, f.ships - n);
}

// ---------- 渡海 ----------
const JAPAN = new Set(['kyu', 'jpw', 'jpe', 'osh']);
function armySoldiers(st, gids) { return gids.reduce((s, id) => s + (st.generals[id]?.unit?.soldiers ?? 0), 0); }
function lossArmy(st, gids, frac) {
  let lost = 0;
  for (const id of gids) {
    const u = st.generals[id]?.unit;
    if (!u) continue;
    const l = Math.round(u.soldiers * frac);
    u.soldiers -= l;
    lost += l;
  }
  return lost;
}

// 海を越えて敵地へ攻め込むとき：敵の水軍が迎え撃ち、日本の近海では夏秋に大風が吹くことがある
// 戻り値 { ok, report }。ok=false なら上陸できずに引き返した
export function seaCrossing(st, nid, gids, from, to) {
  const owner = st.provinces[to].owner;
  const sea = sharedSea(from, to) ?? seasOf(to)[0] ?? seasOf(from)[0];
  const place = `${PDEF[to].region}沖`;
  // 神風
  if (JAPAN.has(to) && (st.season === 1 || st.season === 2) && st.nations[nid].culture !== 'japanese' && chance(st, knows(st, nid, 'compass') ? 0.08 : 0.15)) {
    const lost = lossArmy(st, gids, 0.4);
    const escort = sea ? seaFleets(st, sea, [nid]) : [];
    const sunk = loseShips(st, escort, 0.5);
    const report = { kind: 'typhoon', place, nid, owner, lost, sunk, text: `${place}で大風が吹き荒れ、${nameOf(st, nid)}の船団は壊滅した。${lost}の兵が海に沈み、生き残った者は引き返した。${owner ? `${nameOf(st, owner)}の人々はこれを「神風」と呼んだ。` : ''}` };
    record(st, report, `${place}の大風`);
    return { ok: false, report };
  }
  if (!owner || !sea || !atWar(st, nid, owner)) return { ok: true };
  const defenders = [owner, ...friendsOf(st, owner).filter((f) => atWar(st, f, nid))];
  const dPids = seaFleets(st, sea, defenders);
  if (!dPids.length || seaPower(st, dPids) < 1) return { ok: true };
  const aPids = seaFleets(st, sea, [nid]);
  const soldiers = armySoldiers(st, gids);
  const r = navalBattle(st, aPids, dPids, { aExtra: soldiers / 1500 }); // 兵を満載した輸送船もわずかに戦える
  if (r.winner === 'def') {
    const lost = lossArmy(st, gids, rrange(st, 0.2, 0.35));
    const report = { kind: 'naval', place, nid, owner, ...r, lost, text: `${place}の海戦：${nameOf(st, owner)}の水軍が渡海してきた${nameOf(st, nid)}の船団を迎え撃ち、打ち破った。${nameOf(st, nid)}は軍船${r.aLost}隻と${lost}の兵を失い、上陸をあきらめた（${nameOf(st, owner)}の損害：軍船${r.dLost}隻）。` };
    record(st, report, `${place}の海戦`);
    return { ok: false, report };
  }
  const report = { kind: 'naval', place, nid, owner, ...r, lost: 0, text: `${place}の海戦：${nameOf(st, nid)}の船団が${nameOf(st, owner)}の水軍を退け、上陸に向かう（損害：${nameOf(st, nid)}の軍船${r.aLost}隻、${nameOf(st, owner)}の軍船${r.dLost}隻）。` };
  record(st, report, `${place}の海戦`);
  return { ok: true, report };
}

function record(st, report, title) {
  const involved = report.nid === st.playerNation || report.owner === st.playerNation;
  log(st, report.text, involved);
  if (report.kind === 'typhoon' || (report.aLost + report.dLost) >= 20) {
    st.chronicle ??= [];
    st.chronicle.push({ id: `sea${st.turn}_${report.nid}`, date: dateStr(st), title, text: report.text });
  }
}

// ---------- 制海権と海上封鎖 ----------
export function seaControl(st, sea) {
  const by = {};
  for (const pid of SEAS[sea].ports) {
    const o = st.provinces[pid].owner;
    if (o && shipsAt(st, pid)) by[o] = (by[o] ?? 0) + fleetPower(st, pid);
  }
  const best = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= MIN_CONTROL ? best[0] : null;
}

// 制海権を握る国と戦っている国の港は封鎖され、金の収入が減り、海路の交易が止まる
export function blockadedBy(st, pid) {
  const o = st.provinces[pid]?.owner;
  if (!o || !isPort(pid)) return null;
  for (const sea of seasOf(pid)) {
    const c = st.seaControl?.[sea];
    if (c && c !== o && atWar(st, c, o) && seaPower(st, seaFleets(st, sea, [c])) > fleetPower(st, pid) * 1.5) return c;
  }
  return null;
}
export const navyGoldMul = (st, pid) => (blockadedBy(st, pid) ? 0.75 : 1);

// 自国の軍船が守る港からの海路は、嵐や海賊の危険が減る
export const seaRouteGuard = (st, pid) => (shipsAt(st, pid) >= MIN_CONTROL ? 0.5 : 1);

// 季節：維持費、敵対する艦隊どうしの海戦、制海権の更新
export function navyTick(st) {
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    const s = nationShips(st, n.id);
    if (s) n.gold = Math.max(0, n.gold - s * SHIP_UPKEEP);
  }
  st.seaControl ??= {};
  for (const sea of Object.keys(SEAS)) {
    // 戦争中の二国がともに艦隊を持っていれば、強い方が仕掛ける
    const owners = [...new Set(SEAS[sea].ports.filter((p) => shipsAt(st, p) > 0).map((p) => st.provinces[p].owner).filter(Boolean))];
    const pairs = [];
    for (let i = 0; i < owners.length; i++) for (let j = i + 1; j < owners.length; j++) if (atWar(st, owners[i], owners[j])) pairs.push([owners[i], owners[j]]);
    if (pairs.length && chance(st, 0.5)) {
      const [a, b] = pairs[Math.floor(rnd(st) * pairs.length)];
      const aP = seaFleets(st, sea, [a]), bP = seaFleets(st, sea, [b]);
      const [att, def, atkP, defP] = seaPower(st, aP) >= seaPower(st, bP) ? [a, b, aP, bP] : [b, a, bP, aP];
      const r = navalBattle(st, atkP, defP);
      const w = r.winner === 'att' ? att : def;
      const report = { kind: 'naval', place: SEAS[sea].name, nid: att, owner: def, ...r, text: `${SEAS[sea].name}の海戦：${nameOf(st, att)}と${nameOf(st, def)}の水軍が激突し、${nameOf(st, w)}が勝った（軍船の損害：${nameOf(st, att)}${r.aLost}隻・${nameOf(st, def)}${r.dLost}隻）。` };
      record(st, report, `${SEAS[sea].name}の海戦`);
    }
    const prev = st.seaControl[sea];
    const cur = seaControl(st, sea);
    st.seaControl[sea] = cur;
    if (cur !== prev && (cur === st.playerNation || prev === st.playerNation)) {
      log(st, cur === st.playerNation ? `${SEAS[sea].name}の制海権を握った。` : `${SEAS[sea].name}の制海権を${cur ? `${nameOf(st, cur)}に奪われた` : '失った'}。`, true);
    }
  }
}

// 港が奪われたとき：軍船の半分は拿捕され、残りは沈むか逃げる
export function navyOnConquest(st, pid) {
  const f = st.provinces[pid].fleet;
  if (f) f.ships = Math.floor(f.ships / 2);
}

// ---------- AI ----------
export function aiNavy(st, nid) {
  const n = st.nations[nid];
  const ports = nationProvinces(st, nid).filter((p) => isPort(p.id));
  if (!ports.length || n.gold < 1200) return;
  let room = 30 + ports.length * 10 - nationShips(st, nid); // 国全体の上限
  for (const p of ports) {
    // 同じ海に他国の港があるときだけ水軍を持つ
    const rivals = seasOf(p.id).some((s) => SEAS[s].ports.some((q) => st.provinces[q].owner && st.provinces[q].owner !== nid));
    if (!rivals) continue;
    const enemyNear = seasOf(p.id).some((s) => SEAS[s].ports.some((q) => atWar(st, nid, st.provinces[q].owner)));
    const want = Math.min(PORT_CAP, enemyNear ? 20 + ports.length * 2 : 8);
    const k = Math.min(BUILD_PER_SEASON, want - shipsAt(st, p.id), Math.floor((n.gold - 1000) / SHIP_COST));
    const m = Math.min(k, room);
    if (m > 0 && buildShips(st, p.id, m).ok) room -= m;
  }
}

