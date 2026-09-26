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
export const WEATHER = {
  clear: { name: '晴れ', glyph: '☀' },
  rain: { name: '雨', glyph: '☂', desc: '弓の威力が落ち、火計が使えない' },
  snow: { name: '雪', glyph: '❄', desc: '移動力-1。遊牧民以外は毎ターン士気が下がる' },
  fog: { name: '霧', glyph: '≋', desc: '射程-1' },
  heat: { name: '酷暑', glyph: '♨', desc: '攻撃側は毎ターン士気が下がる' },
};

function pickWeather(b, season, terrain) {
  const x = brnd(b);
  if (season === 3) return (terrain !== 'desert' && x < 0.6) ? 'snow' : x < 0.75 ? 'rain' : 'clear';
  if (season === 1) return (terrain === 'desert' || terrain === 'steppe') && x < 0.35 ? 'heat' : x < 0.55 ? 'rain' : 'clear';
  if (season === 0) return x < 0.3 ? 'rain' : x < 0.45 ? 'fog' : 'clear';
  return x < 0.2 ? 'rain' : x < 0.4 ? 'fog' : 'clear';
}

// opts.field: 城を使わない野戦（出撃・後詰め）。opts.defNation / defIds で守備側を明示できる
export function createBattle(st, { attNation, attIds, provinceId, fromProvince, reinforce = { att: [], def: [] }, defNation: defN, defIds, field = false, starving = false }) {
  const prov = st.provinces[provinceId];
  const def = PDEF[provinceId];
  const defNation = defN ?? prov.owner;
  const b = {
    provinceId, fromProvince, attNation, defNation,
    walls: prov.city.walls, hasCastle: !field && !!defNation,
    terrain: def.terrain,
    tiles: [], units: [], turn: 1, maxTurns: 20, side: 'att',
    over: false, winner: null, reason: null, notes: [],
    rng: Math.floor(rnd(st) * 4294967296) >>> 0,
  };
  b.weather = pickWeather(b, st.season, def.terrain);
  genMap(b);
  const nomad = (nid) => ['mongol', 'turkic'].includes(st.nations[nid]?.culture);
  const rulerIds = new Set(Object.values(st.nations).map((n) => n.rulerId));
  const mk = (g, side) => ({
    id: g.id, gid: g.id, side, nation: g.nation, ally: g.nation !== (side === 'att' ? attNation : defNation), name: g.name, type: g.unit.type,
    soldiers: g.unit.soldiers, start: g.unit.soldiers, training: g.unit.training,
    morale: Math.min(100, 70 + Math.round(g.cha / 5) + (side === 'def' ? 5 : 0)),
    war: g.war, lead: g.lead, pol: g.pol, cha: g.cha, nomad: nomad(g.nation), ruler: rulerIds.has(g.id),
    c: 0, r: 0, moved: false, acted: false, routed: false, dead: false, movedDist: 0,
    tp: 1 + Math.floor(g.pol / 40), hidden: false, confused: 0, commander: false,
    protected: !!(st.options?.protectRuler && g.nation === st.playerNation && rulerIds.has(g.id)), wounded: false,
  });
  const fit = (g) => g?.unit?.soldiers > 0 && !(g.wound && g.wound > st.turn);
  const attGens = [...attIds, ...(reinforce.att || [])].map((id) => st.generals[id]);
  const defGens = defIds ? defIds.map((id) => st.generals[id]) : defNation ? [...generalsIn(st, provinceId, defNation), ...(reinforce.def || []).map((id) => st.generals[id])] : [];
  const att = attGens.filter(fit).map((g) => mk(g, 'att'));
  const dfd = defGens.filter(fit).map((g) => mk(g, 'def'));
  // 冬の遠征：遊牧民以外は凍傷で兵を失う
  if (st.season === 3) {
    let lost = 0;
    for (const u of att) if (!u.nomad) { const l = Math.round(u.soldiers * 0.05); u.soldiers -= l; u.start = u.soldiers; lost += l; }
    if (lost) b.notes.push(`冬の遠征で攻撃側は凍傷により${lost}の兵を失った`);
  }
  if (starving) { for (const u of dfd) u.morale -= 20; b.notes.push('守備側は兵糧が尽き、士気が落ちている'); }
  deploy(b, att, 'att');
  deploy(b, dfd, 'def');
  b.units = [...att, ...dfd];
  // 総大将：君主がいれば君主、いなければ最も統率の高い武将
  for (const side of ['att', 'def']) {
    const us = b.units.filter((u) => u.side === side && !u.ally);
    const pool = us.length ? us : b.units.filter((u) => u.side === side);
    const cmd = pool.find((u) => u.ruler) ?? [...pool].sort((x, y) => y.lead - x.lead)[0];
    if (cmd) cmd.commander = true;
  }
  // 伏兵：森に布陣した部隊は敵から見えない
  for (const u of b.units) if (tileOf(b, u.c, u.r).t === 'forest') u.hidden = true;
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
  return hexNeighbors(c, r).some(([a, d]) => { const x = unitAt(b, a, d); return x && x.side !== side && !x.hidden; });
}

// 到達可能なマス: Map<key, {c, r, cost, prev}>
export function reachable(b, u) {
  const mp = Math.max(1, UNIT_TYPES[u.type].move - (b.weather === 'snow' ? 1 : 0));
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
      let cost = cur.cost + moveCost(b, u, c, r);
      // 城郭へは、隣接マスからなら移動力をすべて使って必ず踏み込める
      if (cost > mp && cur.cost === 0 && u.side === 'att' && isCastle(tileOf(b, c, r).t)) cost = mp;
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
  const ev = { type: 'move', id: u.id, path, revealed: [] };
  if (u.hidden && tileOf(b, c, r).t !== 'forest') u.hidden = false;
  for (const [a, d] of hexNeighbors(c, r)) {
    const x = unitAt(b, a, d);
    if (x && x.side !== u.side && x.hidden) { x.hidden = false; ev.revealed.push(x.id); }
  }
  checkEnd(b);
  return ev;
}

// ---- 攻撃 ----
export function attackRange(b, u, c = u.c, r = u.r) {
  let rg = UNIT_TYPES[u.type].range;
  if (rg > 1 && tileOf(b, c, r).t === 'hill') rg += 1;
  if (rg > 1 && b.weather === 'fog') rg -= 1;
  return rg;
}
export function targetsFrom(b, u, c = u.c, r = u.r) {
  const rg = attackRange(b, u, c, r);
  return activeUnits(b, other(u.side)).filter((t) => !t.hidden && hexDist(c, r, t.c, t.r) <= rg);
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
  if (u.commander) d *= 1.1;
  return d;
}

export function estimateDamage(b, a, t, from = [a.c, a.r], movedDist = a.movedDist) {
  const dist = hexDist(from[0], from[1], t.c, t.r);
  const ranged = dist > 1;
  let dmg = power(a) * 0.1 / defMul(b, t);
  const castleTarget = isCastle(tileOf(b, t.c, t.r).t) && t.side === 'def';
  if (!ranged && (a.type === 'cav' || a.type === 'harch') && movedDist >= 2) dmg *= 1.3;
  if (ranged) dmg *= b.weather === 'rain' ? 0.5 : 0.8;
  if (a.hidden) dmg *= 1.5; // 伏兵の奇襲
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
  if (!u.dead && !u.wounded) {
    // 武力が高いほど生き延びやすい（武力95で約0.65倍、40で約1.2倍）
    const wmul = Math.max(0.3, 1.6 - u.war / 100);
    const pd = (u.soldiers <= 0 ? 0.12 : 0.03) * wmul;
    const pw = (u.soldiers <= 0 ? 0.25 : 0.12) * wmul;
    const x = brnd(b);
    if (x < pd) { if (u.protected) u.wounded = true; else u.dead = true; } else if (x < pd + pw) u.wounded = true;
  }
  events.push({ type: 'rout', id: u.id, dead: u.dead, wounded: u.wounded });
  for (const x of activeUnits(b, u.side)) {
    if (hexDist(x.c, x.r, u.c, u.r) <= 2) x.morale -= 8;
  }
  if (u.commander) {
    events.push({ type: 'collapse', side: u.side, id: u.id });
    b.notes.push(`${u.side === 'att' ? '攻撃' : '守備'}側の総大将${u.name}が敗走し、全軍が動揺した`);
    for (const x of activeUnits(b, u.side)) {
      x.morale -= 25;
      if (x.morale <= 0) rout(b, x, events);
    }
  }
}

export function attack(b, a, t) {
  const events = [];
  const dist = hexDist(a.c, a.r, t.c, t.r);
  if (dist > attackRange(b, a) || a.acted || a.routed || t.routed) return events;
  const ranged = dist > 1;
  const ambush = a.hidden;
  const dmg = Math.round(Math.min(t.soldiers, estimateDamage(b, a, t) * (0.85 + brnd(b) * 0.3)));
  let counter = 0;
  const tBefore = t.soldiers;
  if (ambush) { a.hidden = false; t.morale -= 15; events.push({ type: 'ambush', id: a.id }); }
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
    if (b.weather === 'snow' && !u.nomad) u.morale -= 2;
    if (b.weather === 'heat' && u.side === 'att') u.morale -= 2;
    if (u.confused > 0) { u.confused -= 1; u.moved = true; u.acted = true; }
  }
}

// ---- 一騎討ち ----
export const DUEL_MIN_WAR = 70;
export function duelTargets(b, u) {
  if (u.acted || u.routed || u.hidden || u.war < DUEL_MIN_WAR) return [];
  return activeUnits(b, other(u.side)).filter((t) => !t.hidden && hexDist(u.c, u.r, t.c, t.r) === 1);
}
export function duelAcceptChance(b, a, t) {
  if (t.war >= a.war - 10) return 0.9;
  return Math.max(0.15, Math.min(0.9, 0.9 - (a.war - 10 - t.war) / 40));
}
export function duelWinChance(a, t) {
  // 3本先取の勝率を近似
  const p = a.war / (a.war + t.war);
  return p * p * p * (1 + 3 * (1 - p) + 6 * (1 - p) * (1 - p));
}

export function duel(b, a, t) {
  const events = [];
  if (a.acted || a.routed || t.routed) return events;
  a.acted = true; a.moved = true;
  if (brnd(b) >= duelAcceptChance(b, a, t)) {
    t.morale -= 15;
    events.push({ type: 'duel', id: a.id, target: t.id, refused: true });
    if (t.morale <= 0) rout(b, t, events);
    checkEnd(b);
    return events;
  }
  let ha = 3, ht = 3;
  const rounds = [];
  while (ha > 0 && ht > 0 && rounds.length < 9) {
    const p = a.war / (a.war + t.war) + (brnd(b) - 0.5) * 0.15;
    if (brnd(b) < p) { ht -= 1; rounds.push('a'); } else { ha -= 1; rounds.push('t'); }
  }
  const winner = ha > 0 ? a : t, loser = winner === a ? t : a;
  const x = brnd(b);
  let outcome = x < 0.35 ? 'killed' : x < 0.7 ? 'wounded' : 'fled';
  if (outcome === 'killed' && loser.protected) outcome = 'wounded';
  winner.morale = Math.min(100, winner.morale + 20);
  for (const y of activeUnits(b, winner.side)) if (y !== winner) y.morale = Math.min(100, y.morale + 5);
  for (const y of activeUnits(b, loser.side)) if (y !== loser) y.morale -= 5;
  events.push({ type: 'duel', id: a.id, target: t.id, rounds, winner: winner.id, loser: loser.id, outcome });
  if (outcome === 'killed') { loser.dead = true; rout(b, loser, events); }
  else {
    if (outcome === 'wounded') loser.wounded = true;
    loser.morale -= outcome === 'wounded' ? 40 : 30;
    if (loser.morale <= 0) rout(b, loser, events);
  }
  checkEnd(b);
  return events;
}

// ---- 計略 ----
export const TACTICS = {
  fire: { name: '火計', range: 2, desc: '炎で敵を焼く。森や城にいる敵に大きな効果。雨・雪では使えない' },
  confuse: { name: '偽報', range: 3, desc: '偽の知らせで敵を混乱させ、次の手番を封じる' },
  rally: { name: '鼓舞', range: 0, desc: '自分と隣接する味方の士気を高める' },
};

export function tacticChance(b, u, id, t) {
  if (id === 'rally') return 1;
  const tp = t?.pol ?? 50;
  let p = id === 'fire' ? 0.35 + (u.pol - tp) / 120 : 0.3 + (u.pol - tp) / 100;
  if (id === 'fire' && t) {
    const tt = tileOf(b, t.c, t.r).t;
    if (tt === 'forest') p += 0.15;
    if (tt === 'river') p -= 0.3;
  }
  return Math.max(0.1, Math.min(0.9, p));
}

export function tacticOptions(b, u) {
  if (u.acted || u.routed || u.tp <= 0) return [];
  const out = [];
  const enemies = activeUnits(b, other(u.side)).filter((t) => !t.hidden);
  const near = (rg) => enemies.filter((t) => hexDist(u.c, u.r, t.c, t.r) <= rg);
  if (b.weather !== 'rain' && b.weather !== 'snow') {
    const ts = near(TACTICS.fire.range);
    if (ts.length) out.push({ id: 'fire', targets: ts });
  }
  const cs = near(TACTICS.confuse.range).filter((t) => !t.confused);
  if (cs.length) out.push({ id: 'confuse', targets: cs });
  out.push({ id: 'rally', targets: [] });
  return out;
}

export function useTactic(b, u, id, t) {
  const events = [];
  if (u.acted || u.tp <= 0) return events;
  u.tp -= 1;
  u.acted = true; u.moved = true;
  if (u.hidden) u.hidden = false;
  if (id === 'rally') {
    const boost = 12 + Math.round(u.cha / 10);
    const who = [u, ...activeUnits(b, u.side).filter((x) => x !== u && hexDist(x.c, x.r, u.c, u.r) === 1)];
    for (const x of who) x.morale = Math.min(100, x.morale + boost);
    events.push({ type: 'tactic', id: u.id, tactic: id, ok: true, targets: who.map((x) => x.id) });
    return events;
  }
  const ok = brnd(b) < tacticChance(b, u, id, t);
  const ev = { type: 'tactic', id: u.id, tactic: id, ok, target: t.id };
  events.push(ev);
  if (!ok) return events;
  if (id === 'fire') {
    const tt = tileOf(b, t.c, t.r).t;
    let dmg = t.soldiers * (0.1 + u.pol / 900) * (tt === 'forest' ? 1.5 : isCastle(tt) ? 1.2 : 1);
    dmg = Math.round(Math.min(t.soldiers, dmg * (0.85 + brnd(b) * 0.3)));
    ev.dmg = dmg;
    t.morale -= 12;
    applyLoss(b, t, dmg, events);
  } else if (id === 'confuse') {
    t.confused = 1;
    t.morale -= 10;
  }
  checkEnd(b);
  return events;
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
  const enemies = activeUnits(b, other(u.side)).filter((t) => !t.hidden);
  if (!activeUnits(b, other(u.side)).length) { wait(b, u); return events; }
  // 一騎討ち：武勇に自信があれば挑む
  const dt = duelTargets(b, u).filter((t) => duelWinChance(u, t) >= 0.7);
  if (dt.length && brnd(b) < 0.2) return duel(b, u, dt.sort((x, y) => (y.commander - x.commander) || (y.soldiers - x.soldiers))[0]);
  // 計略：条件が良ければ攻撃の代わりに使う
  const tac = aiTactic(b, u);
  if (tac) return useTactic(b, u, tac.id, tac.target);
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
  // 攻撃できない：前進（城に籠る守備側・潜む伏兵は待機）
  if (holdCastle || onKeep || u.hidden) { wait(b, u); return events; }
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

function aiTactic(b, u) {
  const opts = tacticOptions(b, u);
  if (!opts.length || u.hidden) return null;
  const normalBest = Math.max(0, ...targetsFrom(b, u).map((t) => estimateDamage(b, u, t)));
  for (const o of opts) {
    if (o.id === 'fire') {
      for (const t of o.targets) {
        const p = tacticChance(b, u, 'fire', t);
        const tt = tileOf(b, t.c, t.r).t;
        const exp = p * t.soldiers * (0.1 + u.pol / 900) * (tt === 'forest' ? 1.5 : isCastle(tt) ? 1.2 : 1);
        if (p >= 0.5 && exp > normalBest * 1.1) return { id: 'fire', target: t };
      }
    }
    if (o.id === 'confuse' && u.pol >= 70 && brnd(b) < 0.3) {
      const t = [...o.targets].sort((x, y) => y.soldiers - x.soldiers)[0];
      if (tacticChance(b, u, 'confuse', t) >= 0.55 && normalBest < t.soldiers * 0.05) return { id: 'confuse', target: t };
    }
    if (o.id === 'rally') {
      const low = activeUnits(b, u.side).filter((x) => hexDist(x.c, x.r, u.c, u.r) <= 1 && x.morale < 45).length;
      if (low >= 2 || (u.morale < 35 && normalBest === 0)) return { id: 'rally', target: null };
    }
  }
  return null;
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
    provinceId: b.provinceId, fromProvince: b.fromProvince, attNation: b.attNation, defNation: b.defNation, weather: b.weather, notes: b.notes,
    units: b.units.map((u) => ({ gid: u.gid, side: u.side, soldiers: u.soldiers, start: u.start, routed: u.routed, dead: u.dead, wounded: u.wounded })),
  };
}
