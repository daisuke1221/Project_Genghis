// 箱庭内政：都市グリッド、建設、産出計算、AIの都市開発
import { PROVINCE_TERRAIN, BUILDINGS, WALLS, SEASON_FARM, CLEAR_FOREST_COST, PROVINCES } from './data.js';
import { rnd, rint, chance, pick } from './rng.js';
import { techBonus } from './tech.js';
import { importLoyalty } from './trade.js';
import { adminMods } from './admin.js';
import { knows } from './research.js';

export const GRID = 9;
export const CENTER = 4;
const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));

export function createCity(st, def) {
  const grid = genGrid(st, def);
  return {
    pop: def.pop,
    loyalty: 60,
    walls: def.pop > 12000 ? 1 : 0,
    wallProgress: null,
    horses: def.terrain === 'steppe' ? 3000 : 600,
    grid,
    recruited: 0,
    tax: 1, order: 60, irrigation: 0, commerce: 0,
  };
}

function genGrid(st, def) {
  const T = PROVINCE_TERRAIN[def.terrain];
  const grid = [];
  for (let i = 0; i < GRID * GRID; i++) grid.push({ t: 'grass', b: null });
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < GRID && y < GRID) grid[y * GRID + x].t = t; };
  // 丘・森・砂のかたまり
  const blob = (kind, share) => {
    let n = Math.round(share * GRID * GRID);
    let guard = 0;
    while (n > 0 && guard++ < 200) {
      let x = rint(st, 0, GRID - 1), y = rint(st, 0, GRID - 1);
      const size = rint(st, 2, 6);
      for (let k = 0; k < size && n > 0; k++) {
        if (grid[y * GRID + x].t === 'grass') { set(x, y, kind); n--; }
        x = Math.max(0, Math.min(GRID - 1, x + rint(st, -1, 1)));
        y = Math.max(0, Math.min(GRID - 1, y + rint(st, -1, 1)));
      }
    }
  };
  blob('hill', T.grid.hill);
  blob('forest', T.grid.forest);
  blob('sand', T.grid.sand);
  // 川
  if (def.terrain !== 'desert' || chance(st, 0.6)) {
    const vertical = chance(st, 0.5);
    let pos = rint(st, 1, GRID - 2);
    if (Math.abs(pos - CENTER) < 1) pos = CENTER + (chance(st, 0.5) ? 2 : -2);
    for (let k = 0; k < GRID; k++) {
      if (vertical) set(pos, k, 'river'); else set(k, pos, 'river');
      if (k < GRID - 1 && chance(st, 0.3)) {
        const np = Math.max(0, Math.min(GRID - 1, pos + (chance(st, 0.5) ? 1 : -1)));
        if (Math.abs(np - CENTER) >= 1) {
          if (vertical) set(np, k, 'river'); else set(k, np, 'river');
          pos = np;
        }
      }
    }
  }
  // 宮殿
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = grid[(CENTER + dy) * GRID + CENTER + dx];
    if (c.t === 'river' && (dx || dy)) continue;
    if (!(dx || dy)) c.t = 'grass';
  }
  grid[CENTER * GRID + CENTER].b = { type: 'palace', level: 1, progress: 1 };
  return grid;
}

export const tileAt = (city, x, y) => (x < 0 || y < 0 || x >= GRID || y >= GRID ? null : city.grid[y * GRID + x]);
export function neighbors4(x, y) {
  return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < GRID && b < GRID);
}
export const effLevel = (b) => (!b ? 0 : b.progress >= 1 ? b.level : b.level - 1);

function adjCount(city, x, y, pred) {
  let n = 0;
  for (const [a, b] of neighbors4(x, y)) if (pred(tileAt(city, a, b))) n++;
  return n;
}
const isType = (type) => (t) => t.b && t.b.type === type && effLevel(t.b) > 0;

// 建物1つの産出
export function buildingOutput(city, def, x, y, season, tb = null) {
  const tile = tileAt(city, x, y);
  const b = tile?.b;
  const out = { food: 0, gold: 0, horses: 0, popCap: 0, loyalty: 0, recruit: 0, train: 0, speed: 0, trainNew: 0, bonus: [] };
  if (!b) return out;
  const L = effLevel(b);
  if (L <= 0) return out;
  const T = PROVINCE_TERRAIN[def.terrain];
  switch (b.type) {
    case 'palace':
      out.popCap = 3000; out.gold = 50; out.food = 100; out.loyalty = 5; out.recruit = 400; break;
    case 'farm': {
      let m = T.farm;
      if (adjCount(city, x, y, (t) => t.t === 'river')) { m *= 1.5; out.bonus.push('川沿い+50%'); }
      if (tile.t === 'sand') { m *= 0.5; out.bonus.push('砂地-50%'); }
      if (tb?.farm) { m *= 1 + tb.farm; out.bonus.push(`農業技師+${Math.round(tb.farm * 100)}%`); }
      out.food = Math.round(200 * L * m * SEASON_FARM[season ?? 1]);
      break;
    }
    case 'pasture':
      out.food = 60 * L;
      out.horses = Math.round(150 * L * T.horse * (1 + (tb?.horse ?? 0)));
      if (tb?.horse) out.bonus.push(`牧夫+${Math.round(tb.horse * 100)}%`);
      if (T.horse > 1.2) out.bonus.push('草原の牧場');
      break;
    case 'house': {
      let m = 1;
      if (adjCount(city, x, y, isType('temple'))) { m = 1.25; out.bonus.push('寺院隣接+25%'); }
      out.popCap = Math.round(2000 * L * m);
      break;
    }
    case 'market': {
      const h = Math.min(4, adjCount(city, x, y, isType('house')));
      if (h) out.bonus.push(`住居隣接+${h * 15}%`);
      out.gold = Math.round(60 * L * (1 + 0.15 * h) * (1 + (tb?.market ?? 0)));
      if (tb?.market) out.bonus.push(`商人+${Math.round(tb.market * 100)}%`);
      break;
    }
    case 'workshop': {
      let m = 1;
      if (adjCount(city, x, y, isType('mine'))) { m = 1.5; out.bonus.push('鉱山隣接+50%'); }
      out.gold = Math.round(30 * L * m * (1 + (tb?.workshop ?? 0)));
      if (tb?.workshop) out.bonus.push(`工匠+${Math.round(tb.workshop * 100)}%`);
      out.trainNew = 8 * L;
      break;
    }
    case 'barracks':
      out.recruit = 500 * L; out.train = 4 * L; break;
    case 'temple':
      out.loyalty = 4 * L; break;
    case 'mine':
      out.gold = 90 * L; break;
    case 'lumber':
      out.speed = 0.15 * L; break;
    case 'caravan':
      out.gold = Math.round((30 + def.specValue) * L * (1 + (tb?.market ?? 0))); break;
  }
  return out;
}

// 都市全体の産出（季節ごと）
export function cityYields(st, pid, season = st.season) {
  const p = st.provinces[pid];
  const def = PDEF[pid];
  const city = p.city;
  const gov = p.governorId ? st.generals[p.governorId] : null;
  const tb = techBonus(st, pid);
  const tot = { food: 0, gold: 0, horses: 0, popCap: 0, loyalty: 0, recruit: 0, train: 3, speed: 1, trainNew: 0, hasWorkshop: false, counts: {}, tech: tb };
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const o = buildingOutput(city, def, x, y, season, tb);
    for (const k of ['food', 'gold', 'horses', 'popCap', 'loyalty', 'recruit', 'train', 'speed', 'trainNew']) tot[k] += o[k];
    const b = tileAt(city, x, y).b;
    if (b && effLevel(b) > 0) {
      tot.counts[b.type] = (tot.counts[b.type] || 0) + 1;
      if (b.type === 'workshop') tot.hasWorkshop = true;
    }
  }
  tot.recruit += Math.round(city.pop * 0.02 / 50) * 50;
  tot.trainNew += tb.trainNew;
  tot.train += tb.train;
  tot.speed += tb.speed;
  tot.loyalty += tb.loyalty + importLoyalty(city);
  tot.canSiege = tot.hasWorkshop || tb.siege;
  const polMul = gov ? 0.8 + gov.pol / 250 : 0.75;
  const am = adminMods(st, pid);
  tot.admin = am;
  tot.tax = Math.round(city.pop * 0.012 * (0.5 + city.loyalty / 100) * (1 + tb.tax) * am.taxMul);
  tot.gold = Math.round((tot.gold + tot.tax) * polMul * am.goldMul * (p.owner && knows(st, p.owner, 'paper_money') ? 1.08 : 1));
  tot.speed += gov ? gov.pol / 100 : 0;
  tot.speed = Math.min(tot.speed, 3);
  tot.food = Math.round(tot.food * (gov ? 0.9 + gov.pol / 500 : 0.85) * am.farmMul * (p.owner && knows(st, p.owner, 'qanat') ? 1.1 : 1));
  tot.foodUse = Math.round(city.pop * 0.01);
  tot.loyaltyTarget = Math.round(45 + tot.loyalty * 2 + (gov ? (gov.cha - 50) / 4 : -5) + am.loyaltyAdj);
  return tot;
}

// ---- 建設 ----
export function buildCost(type, level) {
  return Math.round(BUILDINGS[type].cost * level * (level === 1 ? 1 : 1.25));
}

export function canBuild(st, pid, x, y, type) {
  const p = st.provinces[pid];
  const tile = tileAt(p.city, x, y);
  const gold = p.owner ? st.nations[p.owner].gold : 0;
  if (!tile) return { ok: false, reason: '範囲外' };
  if (tile.b) {
    if (tile.b.type !== type) return { ok: false, reason: '別の建物があります' };
    if (tile.b.progress < 1) return { ok: false, reason: '建設中です' };
    if (tile.b.level >= BUILDINGS[type].maxLevel) return { ok: false, reason: '最大レベルです' };
    const cost = buildCost(type, tile.b.level + 1);
    if (gold < cost) return { ok: false, reason: `金が足りません（${cost}）`, cost };
    return { ok: true, cost, upgrade: true };
  }
  if (!BUILDINGS[type].allowed.includes(tile.t)) {
    const names = { grass: '草地', sand: '砂地', hill: '丘', forest: '森', river: '川' };
    return { ok: false, reason: `${names[tile.t]}には建てられません` };
  }
  const cost = buildCost(type, 1);
  if (gold < cost) return { ok: false, reason: `金が足りません（${cost}）`, cost };
  return { ok: true, cost, upgrade: false };
}

export function startBuild(st, pid, x, y, type, free = false) {
  const chk = canBuild(st, pid, x, y, type);
  if (!chk.ok && !(free && chk.reason?.startsWith('金'))) return chk;
  const p = st.provinces[pid];
  const tile = tileAt(p.city, x, y);
  if (!free) st.nations[p.owner].gold -= chk.cost;
  if (free && tile.b && tile.b.type !== type) return { ok: false };
  if (tile.b) { tile.b.level += 1; tile.b.progress = 0; }
  else tile.b = { type, level: 1, progress: free ? 1 : 0 };
  return { ok: true, cost: chk.cost };
}

export function demolish(st, pid, x, y) {
  const tile = tileAt(st.provinces[pid].city, x, y);
  if (!tile?.b || tile.b.type === 'palace') return false;
  tile.b = null;
  return true;
}

export function clearForest(st, pid, x, y) {
  const p = st.provinces[pid];
  const tile = tileAt(p.city, x, y);
  if (!tile || tile.t !== 'forest' || tile.b) return { ok: false, reason: '森ではありません' };
  if (st.nations[p.owner].gold < CLEAR_FOREST_COST) return { ok: false, reason: '金が足りません' };
  st.nations[p.owner].gold -= CLEAR_FOREST_COST;
  tile.t = 'grass';
  return { ok: true };
}

export function canBuildWalls(st, pid) {
  const p = st.provinces[pid];
  const c = p.city;
  if (c.wallProgress !== null) return { ok: false, reason: '建設中です' };
  if (c.walls >= WALLS.length - 1) return { ok: false, reason: '最大です' };
  const w = WALLS[c.walls + 1];
  const cost = Math.round(w.cost * (knows(st, p.owner, 'fortification') ? 0.7 : 1));
  if (st.nations[p.owner].gold < cost) return { ok: false, reason: `金が足りません（${cost}）`, cost };
  return { ok: true, cost };
}
export function startWalls(st, pid) {
  const chk = canBuildWalls(st, pid);
  if (!chk.ok) return chk;
  const p = st.provinces[pid];
  st.nations[p.owner].gold -= chk.cost;
  p.city.wallProgress = 0;
  return chk;
}

// 季節ごとの建設進行。完成したものの一覧を返す
export function tickConstruction(st, pid) {
  const p = st.provinces[pid];
  const y = cityYields(st, pid);
  const done = [];
  for (const tile of p.city.grid) {
    const b = tile.b;
    if (b && b.progress < 1) {
      b.progress = Math.min(1, b.progress + y.speed / BUILDINGS[b.type].turns);
      if (b.progress >= 1) done.push(`${BUILDINGS[b.type].name}${b.level > 1 ? `(Lv${b.level})` : ''}`);
    }
  }
  if (p.city.wallProgress !== null) {
    p.city.wallProgress += y.speed / WALLS[p.city.walls + 1].turns;
    if (p.city.wallProgress >= 1) {
      p.city.walls += 1;
      p.city.wallProgress = null;
      done.push(`城壁「${WALLS[p.city.walls].name}」`);
    }
  }
  return done;
}

// ---- 配置評価（AI・おすすめ表示に使用） ----
export function placementScore(city, def, x, y, type) {
  const tile = tileAt(city, x, y);
  if (!tile || tile.b || !BUILDINGS[type].allowed.includes(tile.t)) return -Infinity;
  const adj = (pred) => adjCount(city, x, y, pred);
  const hasB = (t) => (c) => c.b?.type === t;
  let s = rnd({ rng: (x * 31 + y * 17 + type.length) >>> 0 }) * 0.1;
  const dCenter = Math.abs(x - CENTER) + Math.abs(y - CENTER);
  switch (type) {
    case 'farm': s += adj((c) => c.t === 'river') ? 3 : 0; s -= tile.t === 'sand' ? 2 : 0; s += dCenter * 0.2; break;
    case 'pasture': s += dCenter * 0.3; s -= adj((c) => c.t === 'river') ? 0.5 : 0; break;
    case 'house': s += adj(hasB('market')) * 1.5 + adj(hasB('temple')) * 1.2 - dCenter * 0.2; break;
    case 'market': s += adj(hasB('house')) * 1.5 - dCenter * 0.3 + adj((c) => !c.b && c.t !== 'river') * 0.3; break;
    case 'workshop': s += adj(hasB('mine')) * 2; break;
    case 'temple': s += adj(hasB('house')) * 1.2 - dCenter * 0.1; break;
    default: s -= dCenter * 0.1;
  }
  return s;
}

export function bestTile(city, def, type) {
  let best = null, bs = -Infinity;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const s = placementScore(city, def, x, y, type);
    if (s > bs) { bs = s; best = { x, y }; }
  }
  return best;
}

// AIの都市開発。opts: { free, count, budget }
export function aiDevelopCity(st, pid, opts = {}) {
  const p = st.provinces[pid];
  const def = PDEF[pid];
  const city = p.city;
  const nat = p.owner ? st.nations[p.owner] : null;
  let count = opts.count ?? 1;
  let budget = opts.budget ?? Infinity;
  let built = 0;
  if (opts.free) {
    // 初期配置は決まった比率で
    const recipe = ['farm', 'house', 'market', 'farm', 'house', 'pasture', 'temple', 'farm', 'market', 'house', 'barracks', 'mine', 'farm', 'house', 'market', 'caravan', 'workshop', 'house', 'farm', 'lumber'];
    const extra = def.terrain === 'steppe' ? ['pasture', 'pasture'] : [];
    const list = [...extra, ...recipe];
    for (let i = 0; i < count; i++) {
      const type = list[i % list.length];
      const spot = bestTile(city, def, type);
      if (spot) { startBuild(st, pid, spot.x, spot.y, type, true); built++; }
    }
    return built;
  }
  while (count-- > 0) {
    if (!opts.free && city.grid.some((t) => t.b && t.b.progress < 1)) {
      // 並行して建てるのは2件まで
      if (city.grid.filter((t) => t.b && t.b.progress < 1).length >= 2) break;
    }
    const y = cityYields(st, pid, 1);
    const c = y.counts;
    const n = (t) => c[t] || 0;
    const cands = [];
    const food = nat ? nat.food : 3000;
    cands.push(['farm', (food < 2000 ? 2.4 : food < 8000 ? 1.0 : 0.2) + (n('farm') < 2 ? 1 : 0)]);
    cands.push(['house', city.pop > y.popCap * 0.8 ? 2.2 : 0.4]);
    cands.push(['market', n('house') > n('market') ? 1.4 : 0.7]);
    cands.push(['pasture', (def.terrain === 'steppe' ? 1.6 : 0.5) - n('pasture') * 0.3]);
    cands.push(['barracks', n('barracks') < 1 ? 1.9 : n('barracks') < 2 ? 0.5 : 0]);
    cands.push(['temple', city.loyalty < 55 && n('temple') < 3 ? 1.6 : n('temple') < 1 ? 0.6 : 0]);
    cands.push(['workshop', n('workshop') < 1 ? 0.7 : 0.1]);
    cands.push(['mine', n('mine') < 3 ? 1.3 : 0.5]);
    cands.push(['lumber', n('lumber') < 1 ? 0.6 : 0]);
    cands.push(['caravan', n('caravan') < 1 ? 0.9 : 0.2]);
    cands.sort((a, b) => b[1] - a[1] + (rnd(st) - 0.5) * 0.4);
    let done = false;
    for (const [type, score] of cands) {
      if (score <= 0) continue;
      // 新築 or 既存の強化
      const spot = bestTile(city, def, type);
      const cost1 = buildCost(type, 1);
      if (spot && (opts.free || (nat && nat.gold >= cost1 && budget >= cost1))) {
        startBuild(st, pid, spot.x, spot.y, type, !!opts.free);
        if (!opts.free) budget -= cost1;
        built++; done = true; break;
      }
      if (!spot && !opts.free && nat) {
        const up = city.grid.map((t, i) => ({ t, i })).find(({ t }) => t.b?.type === type && t.b.progress >= 1 && t.b.level < BUILDINGS[type].maxLevel);
        if (up) {
          const cost = buildCost(type, up.t.b.level + 1);
          if (nat.gold >= cost && budget >= cost) {
            startBuild(st, pid, up.i % GRID, Math.floor(up.i / GRID), type);
            budget -= cost; built++; done = true; break;
          }
        }
      }
    }
    if (!done) {
      // 空き地が無ければ既存建物の強化
      if (!opts.free && nat) {
        const ups = city.grid.map((t, i) => ({ t, i })).filter(({ t }) => t.b && t.b.type !== 'palace' && t.b.progress >= 1 && t.b.level < BUILDINGS[t.b.type].maxLevel);
        if (ups.length) {
          const u = pick(st, ups);
          const cost = buildCost(u.t.b.type, u.t.b.level + 1);
          if (nat.gold >= cost && budget >= cost) {
            startBuild(st, pid, u.i % GRID, Math.floor(u.i / GRID), u.t.b.type);
            budget -= cost; built++; continue;
          }
        }
      }
      break;
    }
  }
  return built;
}
