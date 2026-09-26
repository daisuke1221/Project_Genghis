import { describe, it, expect } from 'vitest';
import { newGame } from '../src/game/state.js';
import { cityYields } from '../src/game/city.js';
import { researchRate } from '../src/game/research.js';
import {
  priceAt, sellGoods, tradeTick, routeQuote, createRoute, canSail, isHub, setEmbargo, canTradeWith, giftGoods, giftGoodsSource,
  investOrtoq, ortoqTick, importEffects, categoryOf, ESCORT_COST,
} from '../src/game/trade.js';

const game = (p = 'jin') => newGame({ seed: 10, playerNation: p });
const caravan = (st, pid, level = 3) => { const t = st.provinces[pid].city.grid.find((x) => !x.b && x.t !== 'river' && x.t !== 'forest' && x.t !== 'hill'); t.b = { type: 'caravan', level, progress: 1 }; };

describe('需要と供給', () => {
  it('selling a lot in one city depresses the price, which recovers over time', () => {
    const st = game();
    const c = st.provinces.kf.city;
    const g = '陶磁器';
    c.goods ??= {};
    c.goods[g] = 300;
    const p0 = priceAt(st, 'kf', g);
    sellGoods(st, 'kf', g, 200);
    expect(priceAt(st, 'kf', g)).toBeLessThan(p0 * 0.7);
    for (let i = 0; i < 8; i++) tradeTick(st);
    expect(priceAt(st, 'kf', g)).toBeGreaterThan(p0 * 0.8);
  });
});

describe('品物の使い道', () => {
  it('imported arms, food and books have effects', () => {
    const st = game();
    const c = st.provinces.kf.city;
    const y0 = cityYields(st, 'kf');
    const r0 = researchRate(st, 'jin');
    c.imports = ['鉄', '刀剣', '米', '書物'];
    expect(categoryOf('鉄')).toBe('arms');
    expect(importEffects(c).trainNew).toBe(10);
    const y1 = cityYields(st, 'kf');
    expect(y1.trainNew).toBe(y0.trainNew + 10);
    expect(y1.food).toBeGreaterThan(y0.food);
    expect(researchRate(st, 'jin')).toBe(r0 + 0.5);
  });

  it('luxury goods make good diplomatic gifts', () => {
    const st = game();
    st.provinces.kf.city.goods = { 陶磁器: 100 };
    const src = giftGoodsSource(st, 'jin');
    expect(src.length).toBeGreaterThan(0);
    const r0 = st.nations.jin.relations.song;
    const r = giftGoods(st, 'jin', 'song', src[0].pid);
    expect(r.ok).toBe(true);
    expect(st.nations.jin.relations.song).toBe(Math.min(100, r0 + r.gain));
  });
});

describe('要衝・海路・護衛', () => {
  it('passing a foreign hub costs transit tax; escorts cut risk', () => {
    const st = game('khwarezm');
    caravan(st, 'khw', 5);
    st.nations.khwarezm.relations.khitai = st.nations.khitai.relations.khwarezm = 50;
    const q = routeQuote(st, 'khwarezm', 'khw', 'kas');
    if (q.ok && q.path.slice(1, -1).some((x) => isHub(x) && st.provinces[x].owner !== 'khwarezm')) expect(q.transit).toBeGreaterThan(0);
    const any = routeQuote(st, 'khwarezm', 'khw', 'kas', undefined, { escort: true });
    if (q.ok) { expect(any.risk).toBeCloseTo(q.risk * 0.4, 5); expect(any.cost).toBe(q.cost + ESCORT_COST); }
  });

  it('ports can be linked by sea routes', () => {
    const st = game('song');
    caravan(st, 'gz', 2);
    expect(canSail(st, 'gz', 'kor')).toBe(true);
    st.nations.song.relations.goryeo = st.nations.goryeo.relations.song = 30;
    const q = routeQuote(st, 'song', 'gz', 'kor', undefined, { sea: true });
    expect(q.ok).toBe(true);
    expect(q.sea).toBe(true);
    expect(createRoute(st, 'song', 'gz', 'kor', { sea: true }).ok).toBe(true);
    expect(st.routes.at(-1).sea).toBe(true);
  });
});

describe('禁輸とオルトク', () => {
  it('an embargo cuts trade both ways', () => {
    const st = game();
    st.nations.jin.relations.song = st.nations.song.relations.jin = 30;
    expect(canTradeWith(st, 'jin', 'song')).toBe(true);
    setEmbargo(st, 'jin', 'song');
    expect(canTradeWith(st, 'jin', 'song')).toBe(false);
    expect(canTradeWith(st, 'song', 'kf')).toBe(false);
    setEmbargo(st, 'jin', 'song', false);
    expect(canTradeWith(st, 'jin', 'song')).toBe(true);
  });

  it('ortoq investments pay dividends and return the principal', () => {
    const st = game('kiyat');
    st.nations.kiyat.gold = 5000;
    expect(investOrtoq(st, 'kiyat', 2000).ok).toBe(true);
    expect(st.nations.kiyat.gold).toBe(3000);
    for (let i = 0; i < 13; i++) { st.turn += 1; ortoqTick(st); }
    expect(st.nations.kiyat.ortoq.length).toBe(0);
    expect(st.nations.kiyat.gold).toBeGreaterThan(4000);
  });
});
