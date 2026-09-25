// ヘックス戦術戦闘エンジン（描画から独立。AI同士の戦闘も同じ規則で自動解決する）
import { UNIT_TYPES, PROVINCES } from './data.js';
import { rnd, rint, chance } from './rng.js';
import { generalsIn } from './state.js';

export const COLS = 13;
export const ROWS = 9;
export const BATTLE_TERRAIN = {
  plain:  { name: '平地', cost: 1, def: 1.0 },
  forest: { name: '森', cost: 2, def: 1.25 },
  hill:   { name: '丘', cost: 2, def: 1.3 },
  river:  { name: '川', cost: 3, def: 0.8 },
  castle: { name: '城郭', cost: 1, def: 1.0 },
  keep:   { name: '本丸', cost: 1, def: 1.0 },
};
const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));

// ---- ヘックス計算（odd-r オフセット座標） ----
export const inBounds = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
export const hkey = (c, r) => r * COLS + c;
function toCube(c, r) { const x = c - (r - (r & 1)) / 2; return [x, r, -x - r]; }
export function hexDist(c1, r1, c2, r2) {
  const a = toCube(c1, r1), b = toCube(c2, r2);
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}
const DIRS = [
  [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]],
  [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]],
];
export function hexNeighbors(c, r) {
  return DIRS[r & 1].map(([dc, dr]) => [c + dc, r + dr]).filter(([a, b]) => inBounds(a, b));
}

export const tileOf = (b, c, r) => b.tiles[hkey(c, r)];
export const unitAt = (b, c, r) => b.units.find((u) => !u.routed && u.c === c && u.r === r) || null;
export const activeUnits = (b, side) => b.units.filter((u) => !u.routed && (!side || u.side === side));
const other = (s) => (s === 'att' ? 'def' : 'att');
const isCastle = (t) => t === 'castle' || t === 'keep';

function brnd(b) { return rnd(b); }

// ---- 生成 ----
export function createBattle(st, { attNation, attIds, provinceId, fromProvince }) {
  const prov = st.provinces[provinceId];
  const def = PDEF[provinceId];
  const defNation = prov.owner;
  const b = {
    provinceId, fromProvince, attNation, defNation,
    walls: prov.city.walls, hasCastle: !!defNation,
    terrain: def.terrain,
    tiles: [], units: [], turn: 1, maxTurns: 20, side: 'att',
    over: false, winner: null, reason: null,
    rng: Math.floor(rnd(st) * 4294967296) >>> 0,
  };
  genMap(b);
  const mk = (g, side) => ({
    id: g.id, gid: g.id, side, name: g.name, type: g.unit.type,
    soldiers: g.unit.soldiers, start: g.unit.soldiers, training: g.unit.training,
    morale: Math.min(100, 70 + Math.round(g.cha / 5) + (side === 'def' ? 5 : 0)),
    war: g.war, lead: g.lead, c: 0, r: 0, moved: false, acted: false, routed: false, dead: false, movedDist: 0,
  });
  const att = attIds.map((id) => st.generals[id]).filter((g) => g?.unit?.soldiers > 0).map((g) => mk(g, 'att'));
  const dfd = defNation ? generalsIn(st, provinceId, defNation).filter((g) => g.unit?.soldiers > 0).map((g) => mk(g, 'def')) : [];
  deploy(b, att, 'att');
  deploy(b, dfd, 'def');
  b.units = [...att, ...dfd];
  return b;
}

function genMap(b) {
  const P = {
    steppe: { forest: 0.02, hill: 0.08, river: 0.3 },
    farmland: { forest: 0.1, hill: 0.06, river: 0.8 },
    forest: { forest: 0.32, hill: 0.08, river: 0.5 },
    desert: { forest: 0, hill: 0.12, river: 0.2 },
    mountain: { forest: 0.1, hill: 0.3, river: 0.3 },
  }[b.terrain];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const x = brnd(b);
    b.tiles.push({ t: x < P.forest ? 'forest' : x < P.forest + P.hill ? 'hill' : 'plain' });
  }
  // 塊状にする：隣の森・丘を少し広げる
  for (let k = 0; k < 2; k++) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = tileOf(b, c, r);
      if (t.t === 'plain' && brnd(b) < 0.25) {
        const n = hexNeighbors(c, r).map(([a, d]) => tileOf(b, a, d).t).filter((x) => x !== 'plain');
        if (n.length) t.t = n[Math.floor(brnd(b) * n.length)];
      }
    }
  }
  if (brnd(b) < P.river) {
    let c = 5 + Math.floor(brnd(b) * 3);
    for (let r = 0; r < ROWS; r++) {
      tileOf(b, c, r).t = 'river';
      if (brnd(b) < 0.35) c = Math.max(4, Math.min(8, c + (brnd(b) < 0.5 ? -1 : 1)));
    }
    // 浅瀬
    const fords = 2 + Math.floor(brnd(b) * 2);
    for (let i = 0; i < fords; i++) {
      const r = Math.floor(brnd(b) * ROWS);
      for (let cc = 3; cc < 10; cc++) if (tileOf(b, cc, r).t === 'river') tileOf(b, cc, r).t = 'plain';
    }
  }
  // 配置帯は平地に
  for (let r = 0; r < ROWS; r++) for (const c of [0, 1, 11, 12]) {
    if (tileOf(b, c, r).t === 'river') tileOf(b, c, r).t = 'plain';
  }
  if (b.hasCastle) {
    b.keep = [10, 4];
    tileOf(b, 10, 4).t = 'keep';
    for (const [c, r] of hexNeighbors(10, 4)) tileOf(b, c, r).t = 'castle';
  }
}

function deployCells(b, side) {
  const cells = [];
  if (side === 'att') {
    for (let c = 1; c >= 0; c--) for (const dr of [0, -1, 1, -2, 2, -3, 3, -4, 4]) cells.push([c, 4 + dr]);
    for (const dr of [0, -1, 1, -2, 2, -3, 3, -4, 4]) cells.push([2, 4 + dr]);
  } else {
    if (b.hasCastle) {
      cells.push(b.keep);
      for (const n of hexNeighbors(...b.keep)) cells.push(n);
    }
    for (let c = 11; c <= 12; c++) for (const dr of [0, -1, 1, -2, 2, -3, 3, -4, 4]) cells.push([c, 4 + dr]);
    for (const dr of [0, -1, 1, -2, 2, -3, 3, -4, 4]) cells.push([10, 4 + dr]);
  }
  const seen = new Set();
  return cells.filter(([c, r]) => {
    const k = hkey(c, r);
    if (!inBounds(c, r) || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function deploy(b, units, side) {
  const cells = deployCells(b, side);
  // 本丸には歩兵、城郭には弓兵を優先
  const pr = { inf: 0, arch: 1, siege: 2, harch: 3, cav: 4 };
  const sorted = side === 'def' ? [...units].sort((a, c) => pr[a.type] - pr[c.type]) : units;
  sorted.forEach((u, i) => {
    const [c, r] = cells[i % cells.length];
    u.c = c; u.r = r;
  });
}

// ---- 移動 ----
function moveCost(b, u, c, r) {
  const t = tileOf(b, c, r).t;
  const cav = u.type === 'cav' || u.type === 'harch';
  if (t === 'forest') return cav ? 3 : 2;
  if (isCastle(t) && u.side === 'att') return 2 + b.walls;
  return BATTLE_TERRAIN[t].cost;
}
function enemyAdjacent(b, side, c, r) {
  return hexNeighbors(c, r).some(([a, d]) => { const x = unitAt(b, a, d); return x && x.side !== side; });
}

// 到達可能なマス: Map<key, {c, r, cost, prev}>
export function reachable(b, u) {
  const mp = UNIT_TYPES[u.type].move;
  const res = new Map();
  res.set(hkey(u.c, u.r), { c: u.c, r: u.r, cost: 0, prev: null });
  if (u.moved) return res;
  const open = [{ c: u.c, r: u.r, cost: 0 }];
  while (open.length) {
    open.sort((a, d) => a.cost - d.cost);
    const cur = open.shift();
    if (cur.cost > 0 && enemyAdjacent(b, u.side, cur.c, cur.r)) continue; // 敵に接したら止まる
    for (const [c, r] of hexNeighbors(cur.c, cur.r)) {
      const x = unitAt(b, c, r);
      if (x && x.side !== u.side) continue;
      const cost = cur.cost + moveCost(b, u, c, r);
      if (cost > mp) continue;
      const k = hkey(c, r);
      const prevBest = res.get(k);
      if (prevBest && prevBest.cost <= cost) continue;
      res.set(k, { c, r, cost, prev: hkey(cur.c, cur.r) });
      open.push({ c, r, cost });
    }
  }
  // 味方がいるマスには止まれない
  for (const [k, v] of res) {
    const x = unitAt(b, v.c, v.r);
    if (x && x !== u) res.delete(k);
  }
  return res;
}

export function pathTo(reach, c, r) {
  const path = [];
  let k = hkey(c, r);
  while (k !== null && k !== undefined && reach.has(k)) {
    const n = reach.get(k);
    path.unshift([n.c, n.r]);
    k = n.prev;
  }
  return path;
}

export function moveUnit(b, u, c, r) {
  const reach = reachable(b, u);
  const n = reach.get(hkey(c, r));
  if (!n) return null;
  const path = pathTo(reach, c, r);
  u.movedDist = path.length - 1;
  u.c = c; u.r = r; u.moved = true;
  const ev = { type: 'move', id: u.id, path };
  checkEnd(b);
  return ev;
}

// ---- 攻撃 ----
export function attackRange(b, u, c = u.c, r = u.r) {
  let rg = UNIT_TYPES[u.type].range;
  if (rg > 1 && tileOf(b, c, r).t === 'hill') rg += 1;
  return rg;
}
export function targetsFrom(b, u, c = u.c, r = u.r) {
  const rg = attackRange(b, u, c, r);
  return activeUnits(b, other(u.side)).filter((t) => hexDist(c, r, t.c, t.r) <= rg);
}

function power(u) {
  const T = UNIT_TYPES[u.type];
  return u.soldiers * T.atk * (0.6 + u.training / 250) * (0.75 + (u.war * 0.6 + u.lead * 0.4) / 250) * (0.6 + Math.max(0, u.morale) / 250);
}
function defMul(b, u) {
  const T = UNIT_TYPES[u.type];
  const tt = tileOf(b, u.c, u.r).t;
  let d = T.def * BATTLE_TERRAIN[tt].def * (0.8 + u.lead / 250);
  if (isCastle(tt) && u.side === 'def') d *= 1.1 + 0.3 * b.walls + (tt === 'keep' ? 0.1 : 0);
  return d;
}

export function estimateDamage(b, a, t, from = [a.c, a.r], movedDist = a.movedDist) {
  const dist = hexDist(from[0], from[1], t.c, t.r);
  const ranged = dist > 1;
  let dmg = power(a) * 0.1 / defMul(b, t);
  const castleTarget = isCastle(tileOf(b, t.c, t.r).t) && t.side === 'def';
  if (!ranged && (a.type === 'cav' || a.type === 'harch') && movedDist >= 2) dmg *= 1.3;
  if (ranged) dmg *= 0.8;
  if (!ranged && UNIT_TYPES[a.type].range > 1) dmg *= 0.6;
  if (a.type === 'siege') dmg *= castleTarget ? 3 : 0.5;
  else if (ranged && castleTarget) dmg *= 0.6;
  const flank = hexNeighbors(t.c, t.r).filter(([c, r]) => {
    const x = unitAt(b, c, r);
    return x && x !== a && x.side === a.side;
  }).length;
  dmg *= 1 + 0.12 * flank;
  return Math.min(t.soldiers, dmg);
}

function applyLoss(b, u, loss, events) {
  const before = u.soldiers;
  u.soldiers = Math.max(0, u.soldiers - loss);
  u.morale -= (loss / Math.max(1, before)) * 120 + 2;
  if (u.soldiers < 30 || u.morale <= 0) rout(b, u, events);
}

function rout(b, u, events) {
  if (u.routed) return;
  u.routed = true;
  if (u.soldiers <= 0 && brnd(b) < 0.12) u.dead = true;
  else if (brnd(b) < 0.03) u.dead = true;
  events.push({ type: 'rout', id: u.id, dead: u.dead });
  for (const x of activeUnits(b, u.side)) {
    if (hexDist(x.c, x.r, u.c, u.r) <= 2) x.morale -= 8;
  }
}

export function attack(b, a, t) {
  const events = [];
  const dist = hexDist(a.c, a.r, t.c, t.r);
  if (dist > attackRange(b, a) || a.acted || a.routed || t.routed) return events;
  const ranged = dist > 1;
  const dmg = Math.round(Math.min(t.soldiers, estimateDamage(b, a, t) * (0.85 + brnd(b) * 0.3)));
  let counter = 0;
  const tBefore = t.soldiers;
  applyLoss(b, t, dmg, events);
  if (!ranged && !t.routed) {
    const saved = t.soldiers;
    t.soldiers = tBefore; // 反撃は攻撃前の兵力の半分程度で
    counter = Math.round(Math.min(a.soldiers, estimateDamage(b, t, a, [t.c, t.r], 0) * 0.45 * (0.85 + brnd(b) * 0.3)));
    t.soldiers = saved;
    applyLoss(b, a, counter, events);
  }
  a.acted = true; a.moved = true;
  events.unshift({ type: 'attack', id: a.id, target: t.id, dmg, counter, ranged });
  checkEnd(b);
  return events;
}

export function wait(b, u) { u.acted = true; u.moved = true; }

function checkEnd(b) {
  if (b.over) return;
  if (!activeUnits(b, 'att').length) { b.over = true; b.winner = 'def'; b.reason = 'annihilated'; return; }
  if (!activeUnits(b, 'def').length) { b.over = true; b.winner = 'att'; b.reason = 'annihilated'; return; }
  if (b.hasCastle) {
    const k = unitAt(b, ...b.keep);
    if (k && k.side === 'att') { b.over = true; b.winner = 'att'; b.reason = 'keep'; }
  }
}

export function endPhase(b) {
  if (b.over) return;
  if (b.side === 'att') b.side = 'def';
  else {
    b.side = 'att';
    b.turn += 1;
    if (b.turn > b.maxTurns) { b.over = true; b.winner = 'def'; b.reason = 'timeout'; return; }
  }
  for (const u of activeUnits(b, b.side)) {
    u.moved = false; u.acted = false; u.movedDist = 0;
    u.morale = Math.min(100, u.morale + 3);
  }
}

export function retreat(b, side) {
  b.over = true;
  b.winner = other(side);
  b.reason = 'retreat';
}

// ---- AI ----
function isRanged(u) { return UNIT_TYPES[u.type].range > 1; }

export function aiStep(b) {
  if (b.over) return null;
  const list = activeUnits(b, b.side).filter((u) => !u.acted);
  if (!list.length) return null;
  list.sort((a, c) => (isRanged(c) ? 1 : 0) - (isRanged(a) ? 1 : 0));
  return aiAct(b, list[0]);
}

function aiAct(b, u) {
  const events = [];
  const enemies = activeUnits(b, other(u.side));
  if (!enemies.length) { wait(b, u); return events; }
  const reach = reachable(b, u);
  const start = hkey(u.c, u.r);
  const onKeep = u.side === 'def' && b.hasCastle && u.c === b.keep[0] && u.r === b.keep[1];
  const holdCastle = u.side === 'def' && b.hasCastle && b.walls > 0 && isCastle(tileOf(b, u.c, u.r).t);
  let best = null, bestScore = -Infinity;
  for (const [k, cell] of reach) {
    if (onKeep && k !== start) continue;
    const tt = tileOf(b, cell.c, cell.r).t;
    if (u.side === 'att' && b.hasCastle && tt === 'keep') { best = { cell, target: null, capture: true }; bestScore = Infinity; break; }
    let pos = (BATTLE_TERRAIN[tt].def - 1) * 60;
    if (holdCastle && !isCastle(tt)) pos -= 120;
    const adjEnemies = hexNeighbors(cell.c, cell.r).filter(([c, r]) => { const x = unitAt(b, c, r); return x && x.side !== u.side; }).length;
    if (isRanged(u)) pos -= adjEnemies * 90;
    const rg = attackRange(b, u, cell.c, cell.r);
    for (const t of enemies) {
      const d = hexDist(cell.c, cell.r, t.c, t.r);
      if (d > rg) continue;
      const est = estimateDamage(b, u, t, [cell.c, cell.r], k === start ? u.movedDist : Math.max(2, cell.cost));
      const counter = d === 1 ? estimateDamage(b, t, u, [t.c, t.r], 0) * 0.45 : 0;
      let s = est - counter * 0.8 + pos;
      if (t.soldiers - est < 30) s += 150;
      if (isRanged(u) && d === 1) s -= est * 0.5;
      if (s > bestScore) { bestScore = s; best = { cell, target: t }; }
    }
  }
  if (best && (best.capture || bestScore > -80)) {
    if (hkey(best.cell.c, best.cell.r) !== start) {
      const ev = moveUnit(b, u, best.cell.c, best.cell.r);
      if (ev) events.push(ev);
    }
    if (best.target && !b.over && !u.routed) events.push(...attack(b, u, best.target));
    wait(b, u);
    return events;
  }
  // 攻撃できない：前進（城に籠る守備側は待機）
  if (holdCastle || onKeep) { wait(b, u); return events; }
  let goal;
  if (u.side === 'att' && b.hasCastle) goal = b.keep;
  else {
    let nd = Infinity;
    for (const t of enemies) { const d = hexDist(u.c, u.r, t.c, t.r); if (d < nd) { nd = d; goal = [t.c, t.r]; } }
  }
  // 守備側で城が無い場合、敵が遠ければ有利な地形で待つ
  if (u.side === 'def' && !b.hasCastle && b.turn < 3 && tileOf(b, u.c, u.r).t !== 'plain') { wait(b, u); return events; }
  let bc = null, bd = Infinity;
  for (const [, cell] of reach) {
    let d = hexDist(cell.c, cell.r, goal[0], goal[1]);
    if (isRanged(u)) d = Math.abs(d - UNIT_TYPES[u.type].range - 1) + d * 0.1;
    d -= (BATTLE_TERRAIN[tileOf(b, cell.c, cell.r).t].def - 1) * 0.8;
    if (d < bd) { bd = d; bc = cell; }
  }
  if (bc && (bc.c !== u.c || bc.r !== u.r)) {
    const ev = moveUnit(b, u, bc.c, bc.r);
    if (ev) events.push(ev);
  }
  wait(b, u);
  return events;
}

export function aiPhase(b) {
  let guard = 0;
  while (!b.over && guard++ < 50) {
    const ev = aiStep(b);
    if (ev === null) break;
  }
}

export function autoResolve(b) {
  let guard = 0;
  while (!b.over && guard++ < 200) {
    aiPhase(b);
    endPhase(b);
  }
  if (!b.over) { b.over = true; b.winner = 'def'; b.reason = 'timeout'; }
  return battleResult(b);
}

export function battleResult(b) {
  return {
    winner: b.winner, reason: b.reason, turns: b.turn,
    provinceId: b.provinceId, fromProvince: b.fromProvince, attNation: b.attNation, defNation: b.defNation,
    units: b.units.map((u) => ({ gid: u.gid, side: u.side, soldiers: u.soldiers, start: u.start, routed: u.routed, dead: u.dead })),
  };
}
