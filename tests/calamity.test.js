import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import { adminMods, commandAvailable, doCommand, adminOf } from '../src/game/admin.js';
import { cityYields } from '../src/game/city.js';
import { createRoute, tradeTick } from '../src/game/trade.js';
import { NEIGHBORS } from '../src/game/geo.js';
import {
  startPlague, plagueOf, startFamine, famineOf, calamityTick, spreadChance, setQuarantine, earthquake, calamityTags,
} from '../src/game/calamity.js';

const game = (p = 'jin') => newGame({ seed: 7, playerNation: p });

describe('疫病', () => {
  it('hurts loyalty, order, gold and growth while it lasts', () => {
    const st = game();
    const m0 = adminMods(st, 'kf');
    const g0 = cityYields(st, 'kf').gold;
    startPlague(st, 'kf', 3);
    const m1 = adminMods(st, 'kf');
    expect(m1.loyaltyAdj).toBeLessThan(m0.loyaltyAdj);
    expect(m1.orderTarget).toBeLessThan(m0.orderTarget);
    expect(m1.grow).toBe(0);
    expect(cityYields(st, 'kf').gold).toBeLessThan(g0);
    expect(calamityTags(st, 'kf')).toContain('大疫');
  });

  it('kills people each season, then ends and leaves the city immune for a while', () => {
    const st = game();
    const c = st.provinces.kf.city;
    startPlague(st, 'kf', 2);
    const pop0 = c.pop;
    calamityTick(st);
    expect(c.pop).toBeLessThan(pop0);
    for (let i = 0; i < 12 && plagueOf(st, 'kf'); i++) { calamityTick(st); st.turn += 1; }
    expect(plagueOf(st, 'kf')).toBeNull();
    expect(startPlague(st, 'kf', 1)).toBe(false);
  });

  it('spreads to neighbours; quarantine cuts the risk', () => {
    const st = game();
    const q = NEIGHBORS.kf[0];
    startPlague(st, 'kf', 2);
    const open = spreadChance(st, 'kf', q);
    setQuarantine(st, 'kf', true);
    expect(spreadChance(st, 'kf', q)).toBeLessThan(open * 0.3);
    expect(adminMods(st, 'kf').loyalty.some(([l]) => l === '封鎖')).toBe(true);
  });

  it('quarantine stops caravans', () => {
    const st = game();
    const t = st.provinces.kf.city.grid.find((x) => !x.b && x.t === 'grass');
    t.b = { type: 'caravan', level: 3, progress: 1 };
    st.provinces.kf.city.goods = { 陶磁器: 100 };
    const to = Object.keys(st.provinces).find((pid) => pid !== 'kf' && st.provinces[pid].owner === 'jin');
    const r = createRoute(st, 'jin', 'kf', to);
    expect(r.ok).toBe(true);
    setQuarantine(st, 'kf', true);
    tradeTick(st);
    expect(st.routes[0].last.quarantine).toBe(true);
  });

  it('the cure command is only available during a plague and eases it', () => {
    const st = game();
    const g = generalsIn(st, 'kf', 'jin')[0];
    expect(commandAvailable(st, 'kf', 'cure').ok).toBe(false);
    startPlague(st, 'kf', 3);
    st.nations.jin.gold = 5000;
    g.pol = 100;
    const r = doCommand(st, 'kf', 'cure', g.id);
    expect(r.ok).toBe(true);
    const pl = plagueOf(st, 'kf');
    expect(pl.treated).toBe(st.turn);
  });
});

describe('飢饉と地震', () => {
  it('famine cuts food and alms shortens it', () => {
    const st = game();
    const f0 = cityYields(st, 'kf').food;
    startFamine(st, 'kf', 'drought');
    expect(cityYields(st, 'kf').food).toBeLessThan(f0 * 0.7);
    const until = famineOf(st, 'kf').until;
    const g = generalsIn(st, 'kf', 'jin')[0];
    st.nations.jin.food = 50000;
    const r = doCommand(st, 'kf', 'alms', g.id);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('飢饉');
    expect(famineOf(st, 'kf')?.until ?? 0).toBeLessThan(until);
  });

  it('earthquakes damage buildings and walls', () => {
    const st = game('kamakura');
    const c = adminOf(st.provinces.jpw.city);
    c.walls = 2;
    const levels = () => c.grid.reduce((s, t) => s + (t.b && t.b.type !== 'palace' ? t.b.level : 0), 0);
    const l0 = levels();
    const r = earthquake(st, 'jpw');
    expect(levels()).toBeLessThan(l0);
    expect(r.broken).toBeGreaterThan(0);
  });
});
