// 特産品交易：各都市の特産品の生産・備蓄、距離と季節で変わる相場、隊商による交易路
import { GOODS, PROVINCES } from './data.js';
import { learnFrom } from './research.js';
import { hasPact } from './statecraft.js';
import { NEIGHBORS } from './geo.js';
import { rrange, chance } from './rng.js';
import { techBonus, genTech, PROV_CULTURE } from './tech.js';
import { TECH_TYPES } from './data.js';

const PDEF = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
export const GOOD_NAMES = Object.keys(GOODS);
export const STOCK_CAP = 300;
export const ROUTE_UPKEEP = 20;
export const ESCORT_COST = 30;

// 品物の種類と、輸入されたときの効果
const CAT = (cat, list) => Object.fromEntries(list.map((g) => [g, cat]));
export const GOOD_CATEGORY = {
  ...CAT('horse', ['馬', '駱駝']),
  ...CAT('arms', ['鉄', '銅', '刀剣', '硫黄']),
  ...CAT('food', ['小麦', '米', '岩塩', '蜂蜜', '砂糖', 'オリーブ', '葡萄', '茶']),
  ...CAT('knowledge', ['書物', '紙']),
  ...CAT('luxury', ['絹', '絹織物', '陶磁器', '宝石', '玉', '真珠', '砂金', '銀', '琥珀', '麝香', 'トルコ石', '漆器', '香辛料', 'ガラス', '絨毯', '葡萄酒', '毛皮', '人参']),
};
export const CATEGORY_INFO = {
  horse: { name: '馬・駱駝', desc: '届いた都市の馬が増える' },
  arms: { name: '武具の材料', desc: '新兵の訓練度+5（2種で+10）' },
  food: { name: '食料品', desc: '都市の食糧+8%（2種まで）' },
  knowledge: { name: '書物・紙', desc: '国の研究+0.5（都市ごと）' },
  luxury: { name: '贅沢品', desc: '民忠が上がりやすい。献上品として外交に使える' },
};
export const categoryOf = (good) => GOOD_CATEGORY[good] ?? null;

// 交易の要衝（シルクロードのオアシス・大交易都市）と港
export const HUBS = ['sam', 'kas', 'uig', 'gan', 'khw', 'irq', 'syr', 'byz', 'egy', 'gz', 'song'];
export const PORTS = ['eng', 'fra', 'ita', 'gre', 'byz', 'syr', 'egy', 'ind', 'gz', 'song', 'ly', 'kor', 'kyu', 'jpw', 'jpe'];
export const isHub = (pid) => HUBS.includes(pid);
export const isPort = (pid) => PORTS.includes(pid);

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
  const glut = st.provinces[pid]?.city.glut?.[good] ?? 0; // 売りさばかれた品はだぶついて値が下がる
  return Math.max(1, Math.round(g.base * (1 + 0.18 * d) * (st.market?.[good] ?? 1) * (1 - glut) * 10) / 10);
}
function addGlut(st, pid, good, qty) {
  const c = st.provinces[pid].city;
  c.glut ??= {};
  c.glut[good] = Math.min(0.5, (c.glut[good] ?? 0) + qty / 400);
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
  return Math.round((6 + caravan * 8 + market * 2) * (1 + techBonus(st, pid).goods) * (isHub(pid) ? 1.5 : 1));
}
export function routeCapacity(st, pid) { return caravanLevels(st, pid).caravan * 12; }
export function maxRoutes(st, pid) { const n = caravanLevels(st, pid).caravan; return n ? n + (isHub(pid) ? 1 : 0) : 0; }
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

export const embargoed = (st, a, b) => !!(st.nations[a]?.embargo?.[b] || st.nations[b]?.embargo?.[a]);
export function canTradeWith(st, nid, pid) {
  const owner = st.provinces[pid].owner;
  if (!owner) return false;
  if (owner === nid) return true;
  if (embargoed(st, nid, owner)) return false;
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

// 通過税：他国が押さえる要衝を通ると売上の5%ずつ（通商条約があれば免除、最大15%）
function transitHubs(st, nid, p) {
  return p.slice(1, -1).filter((q) => isHub(q) && st.provinces[q].owner && st.provinces[q].owner !== nid && !hasPact(st, nid, st.provinces[q].owner)).slice(0, 3);
}
// 海路：港どうしを船で結ぶ（隊商宿の合計Lv2以上が必要）
export function canSail(st, from, to) {
  return from !== to && isPort(from) && isPort(to) && caravanLevels(st, from).caravan >= 2 && seaDist(from, to) <= maxRouteLength(st, from) + 2;
}
// 海路の距離（おおよその航海の長さ。地方数に換算）
export function seaDist(a, b) {
  const A = PDEF[a], B = PDEF[b];
  const lat = (A.lat + B.lat) / 2 * Math.PI / 180;
  return Math.max(2, Math.round(Math.hypot(A.lat - B.lat, (A.lon - B.lon) * Math.cos(lat)) / 10));
}

// 交易路の見積もり（opts.sea：海路、opts.escort：護衛）
export function routeQuote(st, nid, from, to, qtyOverride, opts = {}) {
  if (from === to) return { ok: false, reason: '同じ都市です' };
  if (st.provinces[from].owner !== nid) return { ok: false, reason: '出発地が自領ではありません' };
  if (!canTradeWith(st, nid, to)) return { ok: false, reason: embargoed(st, nid, st.provinces[to].owner) ? '禁輸中です' : '相手が交易に応じません（友好度が低い）' };
  const sea = !!opts.sea;
  if (sea && !canSail(st, from, to)) return { ok: false, reason: '海路には港と隊商宿（合計Lv2以上）が必要です' };
  const p = sea ? [from, to] : path(from, to);
  if (!p) return { ok: false, reason: '道がありません' };
  const dist = sea ? seaDist(from, to) : p.length - 1;
  if (!sea && dist > maxRouteLength(st, from)) return { ok: false, reason: `遠すぎます（最大${maxRouteLength(st, from)}地方）`, dist };
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
  const pact = foreign && hasPact(st, nid, st.provinces[to].owner);
  const tariff = foreign && !pact ? Math.round(outRevenue * 0.1) : 0;
  const bonus = 1 + techBonus(st, from).trade + (pact ? 0.1 : 0) + (st.nations[nid]?.innov?.compass ? 0.1 : 0);
  const hubs = sea ? [] : transitHubs(st, nid, p);
  const transit = Math.round((outRevenue + Math.max(0, retProfit)) * 0.05 * hubs.length);
  const cost = ROUTE_UPKEEP + 3 * dist + (opts.escort ? ESCORT_COST : 0);
  const profit = Math.round((outRevenue + retProfit) * bonus - tariff - transit - cost);
  let risk = sea ? Math.min(0.5, dist * (st.nations[nid]?.innov?.compass ? 0.012 : 0.03)) : routeRisk(st, nid, p);
  if (opts.escort) risk *= 0.4;
  return {
    ok: true, path: p, dist, qty, outGood, outSell, outRevenue: Math.round(outRevenue), retGood, retQty, retBuy, retSell,
    retProfit: Math.round(retProfit), tariff, transit, hubs, cost, profit, risk, foreign, sea, escort: !!opts.escort,
  };
}

export function createRoute(st, nid, from, to, opts = {}) {
  if (routesFrom(st, from).length >= maxRoutes(st, from)) return { ok: false, reason: `この都市の交易路は${maxRoutes(st, from)}本までです（隊商宿を建て・強化しよう）` };
  if (st.routes.some((r) => r.from === from && r.to === to)) return { ok: false, reason: 'すでに交易路があります' };
  const q = routeQuote(st, nid, from, to, undefined, opts);
  if (!q.ok) return q;
  const r = { id: st.nextRouteId++, nation: nid, from, to, last: null, sea: !!opts.sea, escort: !!opts.escort };
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
  addGlut(st, pid, good, n);
  return gold;
}

// 季節ごとの交易処理。onLog(text, important) を呼ぶ
export function tradeTick(st, onLog) {
  // 相場の変動
  for (const g of GOOD_NAMES) {
    const m = st.market[g];
    st.market[g] = Math.max(0.7, Math.min(1.5, m + rrange(st, -0.1, 0.1) + (1 - m) * 0.15));
  }
  // 生産（だぶつきは季節ごとに解消していく）
  for (const p of Object.values(st.provinces)) {
    const c = p.city;
    c.goods = c.goods || {};
    c.imports = [];
    if (c.glut) for (const g of Object.keys(c.glut)) { c.glut[g] *= 0.7; if (c.glut[g] < 0.01) delete c.glut[g]; }
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
    if (st.provinces[r.from].city.quarantine || st.provinces[r.to].city.quarantine) { r.last = { quarantine: true, profit: 0, turn: st.turn }; continue; } // 封鎖中は隊商が出入りできない
    const c = st.provinces[r.from].city;
    const outGood = PDEF[r.from].specialty;
    const qty = Math.min(routeCapacity(st, r.from), c.goods[outGood] ?? 0);
    const q = routeQuote(st, r.nation, r.from, r.to, qty, { sea: r.sea, escort: r.escort });
    if (!q.ok) { cancelRoute(st, r.id); if (mine) onLog?.(`${fromName}→${toName}の交易路を維持できなくなった（${q.reason}）。`, true); continue; }
    c.goods[outGood] -= qty;
    if (chance(st, q.risk)) {
      nat.gold = Math.max(0, nat.gold - q.cost);
      r.last = { raided: true, profit: -q.cost, turn: st.turn };
      if (mine) onLog?.(r.sea ? `${fromName}→${toName}の船団が嵐か海賊に遭い、積荷を失った！` : `${fromName}→${toName}の隊商が道中で略奪にあった！`, true);
      continue;
    }
    nat.gold += q.profit;
    r.last = { raided: false, profit: q.profit, qty, turn: st.turn };
    addGlut(st, r.to, outGood, qty);
    // 要衝の通過税は要衝の持ち主に入る
    if (q.transit) for (const h of q.hubs) st.nations[st.provinces[h].owner].gold += Math.round(q.transit / q.hubs.length);
    // 馬・駱駝が届けば馬が増える
    if (q.retQty > 0 && categoryOf(q.retGood) === 'horse') c.horses = Math.min(30000, c.horses + q.retQty * 15);
    if (!q.foreign && categoryOf(outGood) === 'horse') st.provinces[r.to].city.horses = Math.min(30000, st.provinces[r.to].city.horses + qty * 15);
    const owner = st.provinces[r.to].owner;
    if (q.foreign) {
      // 交易を通じて技術や職人が伝わることがある
      if (chance(st, 0.04)) learnFrom(st, r.nation, owner, '交易を通じて');
      if (chance(st, 0.02)) {
        const t = genTech(st, r.from, PROV_CULTURE[r.to]);
        if (mine) onLog?.(`${toName}から来た職人${t.name}（${TECH_TYPES[t.type].name}）が${fromName}に住みついた（招聘できる）。`, true);
      }
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

// 輸入品の数に応じた民忠ボーナス（贅沢品は倍）
export function importLoyalty(city) {
  const pts = (city.imports || []).reduce((s, g) => s + (categoryOf(g) === 'luxury' ? 2 : 1), 0);
  return Math.min(6, pts * 1.5);
}
export function importEffects(city) {
  const im = city.imports || [];
  const n = (cat) => im.filter((g) => categoryOf(g) === cat).length;
  return { trainNew: Math.min(2, n('arms')) * 5, food: Math.min(2, n('food')) * 0.08, research: n('knowledge') ? 0.5 : 0 };
}

// ---------- 献上品：自国の特産品を他国に贈る ----------
export const TRIBUTE_GOODS_QTY = 30;
export function giftGoodsSource(st, nid) {
  return Object.values(st.provinces).filter((p) => p.owner === nid).map((p) => ({ pid: p.id, good: PDEF[p.id].specialty, stock: p.city.goods?.[PDEF[p.id].specialty] ?? 0 }))
    .filter((x) => x.stock >= TRIBUTE_GOODS_QTY).sort((a, b) => GOODS[b.good].base * (categoryOf(b.good) === 'luxury' ? 1.5 : 1) - GOODS[a.good].base * (categoryOf(a.good) === 'luxury' ? 1.5 : 1));
}
export function giftGoods(st, from, to, pid) {
  const src = giftGoodsSource(st, from).find((x) => x.pid === pid);
  if (!src) return { ok: false, reason: `献上できる品（${TRIBUTE_GOODS_QTY}荷以上の在庫）がありません` };
  st.provinces[pid].city.goods[src.good] -= TRIBUTE_GOODS_QTY;
  const value = TRIBUTE_GOODS_QTY * priceAt(st, st.nations[to].capital, src.good);
  const gain = Math.min(30, Math.round(value / 20 * (categoryOf(src.good) === 'luxury' ? 1.5 : 1)));
  const a = st.nations[from], b = st.nations[to];
  const v = Math.min(100, (a.relations[to] ?? 0) + gain);
  a.relations[to] = v; b.relations[from] = v;
  return { ok: true, good: src.good, gain };
}

// ---------- 禁輸 ----------
export function setEmbargo(st, a, b, on = true) {
  const na = st.nations[a];
  na.embargo ??= {};
  if (!on) { delete na.embargo[b]; return; }
  na.embargo[b] = st.turn;
  st.routes = st.routes.filter((r) => !((r.nation === a && st.provinces[r.to].owner === b) || (r.nation === b && st.provinces[r.to].owner === a)));
  const v = Math.max(-100, (na.relations[b] ?? 0) - 15);
  na.relations[b] = v; st.nations[b].relations[a] = v;
}

// ---------- オルトク（商人組合への出資） ----------
export const ORTOQ_TERM = 12;
export function ortoqRate(st, nid) {
  const c = st.nations[nid].culture;
  const routes = st.routes.filter((r) => r.nation === nid).length;
  return 0.05 + (['mongol', 'turkic', 'islamic'].includes(c) ? 0.02 : 0) + Math.min(0.03, routes * 0.005);
}
export function investOrtoq(st, nid, amount) {
  const n = st.nations[nid];
  if (amount < 500) return { ok: false, reason: '出資は500金から' };
  if (n.gold < amount) return { ok: false, reason: '金が足りません' };
  n.gold -= amount;
  n.ortoq ??= [];
  n.ortoq.push({ amount, since: st.turn, until: st.turn + ORTOQ_TERM, rate: ortoqRate(st, nid), earned: 0 });
  return { ok: true };
}
export function ortoqTick(st, onLog) {
  for (const n of Object.values(st.nations)) {
    if (!n.alive || !n.ortoq?.length) continue;
    const mine = n.id === st.playerNation;
    for (const o of [...n.ortoq]) {
      if (chance(st, 0.04)) {
        const loss = Math.round(o.amount * 0.3);
        o.amount -= loss;
        if (mine) onLog?.(`【オルトク】出資先の隊商が消息を絶ち、元手のうち${loss}金を失った。`, true);
      }
      const gain = Math.round(o.amount * o.rate);
      n.gold += gain; o.earned += gain;
      if (st.turn >= o.until) {
        n.gold += o.amount;
        n.ortoq = n.ortoq.filter((x) => x !== o);
        if (mine) onLog?.(`【オルトク】出資の期限が来て、元手${o.amount}金が戻った（配当の合計${o.earned}金）。`, true);
      }
    }
  }
}

// AI：隊商宿があれば同盟国や自領の大都市へ交易路を開く（危ない道には護衛をつけ、港からは海路も使う）
export function aiTrade(st, nid, pids) {
  for (const from of pids) {
    if (routesFrom(st, from).length >= maxRoutes(st, from)) continue;
    let best = null;
    for (const p of PROVINCES) {
      for (const opts of [{}, { escort: true }, ...(canSail(st, from, p.id) ? [{ sea: true }] : [])]) {
        const q = routeQuote(st, nid, from, p.id, undefined, opts);
        const score = q.ok ? q.profit * (1 - q.risk) : 0;
        if (q.ok && q.risk < 0.15 && q.profit > 60 && (!best || score > best.score)) best = { to: p.id, opts, score };
      }
    }
    if (best) createRoute(st, nid, from, best.to, best.opts);
  }
  const n = st.nations[nid];
  if (n.gold > 6000 && !(n.ortoq?.length >= 2) && chance(st, 0.05)) investOrtoq(st, nid, 1000);
}
