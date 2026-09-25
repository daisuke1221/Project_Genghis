// 特産品交易：各都市の特産品の生産・備蓄、距離と季節で変わる相場、隊商による交易路
import { GOODS, PROVINCES } from './data.js';
import { NEIGHBORS } from './geo.js';
import { rrange, chance } from './rng.js';
import { techBonus } from './tech.js';

const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
export const GOOD_NAMES = Object.keys(GOODS);
export const STOCK_CAP = 300;
export const ROUTE_UPKEEP = 20;

// 産地からの距離（地方数）: DIST[good][pid]
export const DIST = {};
for (const g of GOOD_NAMES) {
  const d = {};
  const q = [...GOODS[g].sources];
  for (const s of q) d[s] = 0;
  while (q.length) {
    const a = q.shift();
    for (const b of NEIGHBORS[a]) if (d[b] === undefined) { d[b] = d[a] + 1; q.push(b); }
  }
  DIST[g] = d;
}

export function initMarket(st) {
  st.market = Object.fromEntries(GOOD_NAMES.map((g) => [g, 1]));
  st.routes = st.routes || [];
  st.nextRouteId = st.nextRouteId || 1;
}

// ある都市での品物の相場（1荷あたりの金）
export function priceAt(st, pid, good) {
  const d = Math.min(9, DIST[good][pid] ?? 9);
  const g = GOODS[good];
  return Math.max(1, Math.round(g.base * (1 + 0.18 * d) * (st.market?.[good] ?? 1) * 10) / 10);
}

function caravanLevels(st, pid) {
  let n = 0, m = 0;
  for (const t of st.provinces[pid].city.grid) {
    if (!t.b || t.b.progress < 1) continue;
    if (t.b.type === 'caravan') n += t.b.level;
    if (t.b.type === 'market') m += t.b.level;
  }
  return { caravan: n, market: m };
}

export function goodsProduction(st, pid) {
  const { caravan, market } = caravanLevels(st, pid);
  return Math.round((6 + caravan * 8 + market * 2) * (1 + techBonus(st, pid).goods));
}
export function routeCapacity(st, pid) { return caravanLevels(st, pid).caravan * 12; }
export function maxRoutes(st, pid) { return caravanLevels(st, pid).caravan; }
export function maxRouteLength(st, pid) { return Math.min(12, 3 + 2 * caravanLevels(st, pid).caravan); }
export function routesFrom(st, pid) { return st.routes.filter((r) => r.from === pid); }

export function path(from, to) {
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const a = q.shift();
    if (a === to) break;
    for (const b of NEIGHBORS[a]) if (!(b in prev)) { prev[b] = a; q.push(b); }
  }
  if (!(to in prev)) return null;
  const out = [];
  for (let c = to; c; c = prev[c]) out.unshift(c);
  return out;
}

export function canTradeWith(st, nid, pid) {
  const owner = st.provinces[pid].owner;
  if (!owner) return false;
  if (owner === nid) return true;
  return !!st.nations[nid].treaties[owner] || (st.nations[nid].relations[owner] ?? 0) >= 0;
}

export function routeRisk(st, nid, p) {
  let risk = 0;
  for (const pid of p.slice(1, -1)) {
    const o = st.provinces[pid].owner;
    if (o === nid || (o && st.nations[nid].treaties[o])) continue;
    risk += o && (st.nations[nid].relations[o] ?? 0) >= 20 ? 0.03 : 0.08;
  }
  return Math.min(0.6, risk);
}

// 交易路の見積もり
export function routeQuote(st, nid, from, to, qtyOverride) {
  if (from === to) return { ok: false, reason: '同じ都市です' };
  if (st.provinces[from].owner !== nid) return { ok: false, reason: '出発地が自領ではありません' };
  if (!canTradeWith(st, nid, to)) return { ok: false, reason: '相手が交易に応じません（友好度が低い）' };
  const p = path(from, to);
  if (!p) return { ok: false, reason: '道がありません' };
  const dist = p.length - 1;
  if (dist > maxRouteLength(st, from)) return { ok: false, reason: `遠すぎます（最大${maxRouteLength(st, from)}地方）`, dist };
  const cap = routeCapacity(st, from);
  if (cap <= 0) return { ok: false, reason: '隊商宿が必要です' };
  const outGood = PDEF[from].specialty, retGood = PDEF[to].specialty;
  const stock = st.provinces[from].city.goods?.[outGood] ?? 0;
  const qty = qtyOverride ?? Math.min(cap, Math.max(stock, goodsProduction(st, from)));
  const outSell = priceAt(st, to, outGood);
  const outRevenue = qty * outSell;
  const retBuy = priceAt(st, to, retGood), retSell = priceAt(st, from, retGood);
  const retQty = retGood !== outGood && retSell > retBuy ? Math.round(cap / 2) : 0;
  const retProfit = retQty * (retSell - retBuy);
  const foreign = st.provinces[to].owner !== nid;
  const tariff = foreign ? Math.round(outRevenue * 0.1) : 0;
  const bonus = 1 + techBonus(st, from).trade;
  const cost = ROUTE_UPKEEP + 3 * dist;
  const profit = Math.round((outRevenue + retProfit) * bonus - tariff - cost);
  return {
    ok: true, path: p, dist, qty, outGood, outSell, outRevenue: Math.round(outRevenue), retGood, retQty, retBuy, retSell,
    retProfit: Math.round(retProfit), tariff, cost, profit, risk: routeRisk(st, nid, p), foreign,
  };
}

export function createRoute(st, nid, from, to) {
  if (routesFrom(st, from).length >= maxRoutes(st, from)) return { ok: false, reason: `この都市の交易路は${maxRoutes(st, from)}本までです（隊商宿を建て・強化しよう）` };
  if (st.routes.some((r) => r.from === from && r.to === to)) return { ok: false, reason: 'すでに交易路があります' };
  const q = routeQuote(st, nid, from, to);
  if (!q.ok) return q;
  const r = { id: st.nextRouteId++, nation: nid, from, to, last: null };
  st.routes.push(r);
  return { ok: true, route: r, quote: q };
}

export function cancelRoute(st, id) {
  st.routes = st.routes.filter((r) => r.id !== id);
}

export function sellGoods(st, pid, good, qty) {
  const c = st.provinces[pid].city;
  const have = c.goods?.[good] ?? 0;
  const n = Math.min(have, qty);
  if (n <= 0) return 0;
  c.goods[good] -= n;
  const gold = Math.round(n * priceAt(st, pid, good) * 0.8);
  st.nations[st.provinces[pid].owner].gold += gold;
  return gold;
}

// 季節ごとの交易処理。onLog(text, important) を呼ぶ
export function tradeTick(st, onLog) {
  // 相場の変動
  for (const g of GOOD_NAMES) {
    const m = st.market[g];
    st.market[g] = Math.max(0.7, Math.min(1.5, m + rrange(st, -0.1, 0.1) + (1 - m) * 0.15));
  }
  // 生産
  for (const p of Object.values(st.provinces)) {
    const c = p.city;
    c.goods = c.goods || {};
    c.imports = [];
    if (!p.owner) continue;
    const g = PDEF[p.id].specialty;
    c.goods[g] = Math.min(STOCK_CAP, (c.goods[g] ?? 0) + goodsProduction(st, p.id));
  }
  // 交易路
  for (const r of [...st.routes]) {
    const nat = st.nations[r.nation];
    const mine = r.nation === st.playerNation;
    const fromName = PDEF[r.from].city, toName = PDEF[r.to].city;
    if (!nat?.alive || st.provinces[r.from].owner !== r.nation || !canTradeWith(st, r.nation, r.to)) {
      cancelRoute(st, r.id);
      if (mine) onLog?.(`${fromName}→${toName}の交易路は、情勢の変化で途絶えた。`, true);
      continue;
    }
    const c = st.provinces[r.from].city;
    const outGood = PDEF[r.from].specialty;
    const qty = Math.min(routeCapacity(st, r.from), c.goods[outGood] ?? 0);
    const q = routeQuote(st, r.nation, r.from, r.to, qty);
    if (!q.ok) { cancelRoute(st, r.id); if (mine) onLog?.(`${fromName}→${toName}の交易路を維持できなくなった（${q.reason}）。`, true); continue; }
    c.goods[outGood] -= qty;
    if (chance(st, q.risk)) {
      nat.gold = Math.max(0, nat.gold - q.cost);
      r.last = { raided: true, profit: -q.cost, turn: st.turn };
      if (mine) onLog?.(`${fromName}→${toName}の隊商が道中で略奪にあった！`, true);
      continue;
    }
    nat.gold += q.profit;
    r.last = { raided: false, profit: q.profit, qty, turn: st.turn };
    const owner = st.provinces[r.to].owner;
    if (q.foreign) {
      st.nations[owner].gold += q.tariff;
      const v = Math.min(100, (nat.relations[owner] ?? 0) + 1);
      nat.relations[owner] = v; st.nations[owner].relations[r.nation] = v;
    } else if (qty > 0) {
      addImport(st.provinces[r.to].city, outGood);
    }
    if (q.retQty > 0) addImport(c, q.retGood);
  }
}

function addImport(city, good) {
  city.imports = city.imports || [];
  if (!city.imports.includes(good)) city.imports.push(good);
}

// 輸入品の数に応じた民忠ボーナス
export function importLoyalty(city) {
  return Math.min(4, (city.imports || []).length) * 1.5;
}

// AI：隊商宿があれば同盟国や自領の大都市へ交易路を開く
export function aiTrade(st, nid, pids) {
  for (const from of pids) {
    if (routesFrom(st, from).length >= maxRoutes(st, from)) continue;
    let best = null;
    for (const p of PROVINCES) {
      const q = routeQuote(st, nid, from, p.id);
      if (q.ok && q.risk < 0.15 && q.profit > 60 && (!best || q.profit > best.profit)) best = { ...q, to: p.id };
    }
    if (best) createRoute(st, nid, from, best.to);
  }
}
