import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import {
  createBattle, reachable, tacticOptions, useTactic, targetsFrom, attack, autoResolve, activeUnits, WEATHER, hexNeighbors, hkey,
} from '../src/game/battle.js';
import { startSiege, siegeTick, siegeAt, assault, sally, besiegers, initialSupply } from '../src/game/siege.js';
import { executeMove } from '../src/game/actions.js';
import { declareWar } from '../src/game/diplomacy.js';
import { recruitQuote } from '../src/game/military.js';
import { UNIT_TYPES } from '../src/game/data.js';

const kiyIds = (st) => generalsIn(st, 'kiy', 'kiyat').map((g) => g.id);
const battle = (st, extra = {}) => createBattle(st, { attNation: 'kiyat', attIds: kiyIds(st), provinceId: 'tat', fromProvince: 'kiy', ...extra });

describe('合戦：天候・総大将・計略・伏兵', () => {
  it('always has a known weather and one commander per side', () => {
    for (let s = 0; s < 20; s++) {
      const st = newGame({ seed: s });
      st.season = s % 4;
      const b = battle(st);
      expect(WEATHER[b.weather]).toBeTruthy();
      for (const side of ['att', 'def']) expect(b.units.filter((u) => u.side === side && u.commander).length).toBe(1);
    }
  });
  it('snow reduces movement', () => {
    const st = newGame({ seed: 1 });
    const b = battle(st);
    const u = b.units.find((x) => x.side === 'att');
    b.weather = 'clear';
    const a = Math.max(...[...reachable(b, u).values()].map((c) => c.cost));
    b.weather = 'snow';
    const s = Math.max(...[...reachable(b, u).values()].map((c) => c.cost));
    expect(s).toBeLessThan(a + 0.01);
    expect(s).toBeLessThanOrEqual(UNIT_TYPES[u.type].move - 1);
  });
  it('rain disables fire; rally always works', () => {
    const st = newGame({ seed: 2 });
    const b = battle(st);
    const u = b.units.find((x) => x.side === 'att');
    b.weather = 'rain';
    expect(tacticOptions(b, u).some((o) => o.id === 'fire')).toBe(false);
    u.morale = 30;
    const evs = useTactic(b, u, 'rally', null);
    expect(evs[0].ok).toBe(true);
    expect(u.morale).toBeGreaterThan(30);
  });
  it('fire damages the target when it succeeds', () => {
    let hit = false;
    for (let s = 0; s < 30 && !hit; s++) {
      const st = newGame({ seed: 100 + s });
      const b = battle(st);
      b.weather = 'clear';
      const u = b.units.find((x) => x.side === 'att');
      const t = b.units.find((x) => x.side === 'def');
      t.hidden = false;
      // 射程内に置く
      [t.c, t.r] = hexNeighbors(u.c, u.r).find(([c, r]) => !b.units.some((x) => x !== t && x.c === c && x.r === r));
      u.pol = 99;
      const before = t.soldiers;
      const ev = useTactic(b, u, 'fire', t)[0];
      if (ev.ok) { hit = true; expect(t.soldiers).toBeLessThan(before); }
    }
    expect(hit).toBe(true);
  });
  it('hidden units cannot be targeted and ambush for extra damage', () => {
    const st = newGame({ seed: 3 });
    const b = battle(st);
    const u = b.units.find((x) => x.side === 'att');
    const t = b.units.find((x) => x.side === 'def');
    [t.c, t.r] = hexNeighbors(u.c, u.r).find(([c, r]) => !b.units.some((x) => x !== t && x.c === c && x.r === r));
    t.hidden = true;
    expect(targetsFrom(b, u)).not.toContain(t);
    t.hidden = false; u.hidden = true;
    const evs = attack(b, u, t);
    expect(evs.some((e) => e.type === 'ambush')).toBe(true);
    expect(u.hidden).toBe(false);
  });
  it('a routed commander shakes the whole army', () => {
    const st = newGame({ seed: 4 });
    const b = battle(st);
    const cmd = b.units.find((x) => x.side === 'def' && x.commander);
    const others = activeUnits(b, 'def').filter((x) => x !== cmd);
    const before = others.map((x) => x.morale);
    const a = b.units.find((x) => x.side === 'att');
    [cmd.c, cmd.r] = hexNeighbors(a.c, a.r).find(([c, r]) => !b.units.some((x) => x !== cmd && x.c === c && x.r === r));
    cmd.hidden = false; cmd.soldiers = 20; cmd.morale = 1;
    attack(b, a, cmd);
    expect(cmd.routed).toBe(true);
    others.forEach((x, i) => expect(x.morale).toBeLessThan(before[i]));
  });
  it('non-nomad attackers lose troops to frostbite in winter', () => {
    const st = newGame({ seed: 5, playerNation: 'kiyat' });
    st.season = 3;
    const ids = generalsIn(st, 'jz', 'jin').map((g) => g.id);
    const total = ids.reduce((a, id) => a + st.generals[id].unit.soldiers, 0);
    const b = createBattle(st, { attNation: 'jin', attIds: ids, provinceId: 'tat', fromProvince: 'jz' });
    const after = b.units.filter((u) => u.side === 'att').reduce((a, u) => a + u.soldiers, 0);
    expect(after).toBeLessThan(total);
  });
});

describe('籠城戦', () => {
  const setup = (seed = 10) => {
    const st = newGame({ seed, playerNation: 'kiyat' });
    st.provinces.tat.city.walls = 2;
    declareWar(st, 'kiyat', 'tatar');
    return st;
  };
  it('starving the city leads to surrender', () => {
    const st = setup();
    startSiege(st, 'kiyat', kiyIds(st), 'tat', 'kiy');
    expect(siegeAt(st, 'tat').supply).toBe(initialSupply(st, 'tat'));
    for (let i = 0; i < 15 && siegeAt(st, 'tat'); i++) siegeTick(st);
    expect(st.provinces.tat.owner).toBe('kiyat');
    expect(siegeAt(st, 'tat')).toBeNull();
  });
  it('siege engines break down the walls', () => {
    const st = setup(11);
    for (const id of kiyIds(st)) { st.generals[id].unit.type = 'siege'; st.generals[id].unit.soldiers = 2000; }
    startSiege(st, 'kiyat', kiyIds(st), 'tat', 'kiy');
    siegeTick(st);
    expect(st.provinces.tat.city.walls).toBeLessThan(2);
  });
  it('the player can choose to besiege via executeMove and then assault', async () => {
    const st = setup(12);
    const r = await executeMove(st, 'kiyat', kiyIds(st), 'kiy', 'tat', { attackMode: async () => 'siege' });
    expect(r.kind).toBe('siege');
    expect(besiegers(st, 'tat').length).toBeGreaterThan(0);
    for (const g of besiegers(st, 'tat')) g.moved = false;
    const a = await assault(st, 'tat', {});
    expect(a.ok).toBe(true);
    expect(['kiyat', 'tatar']).toContain(st.provinces.tat.owner);
  });
  it('cannot recruit in a besieged city', () => {
    const st = setup(13);
    startSiege(st, 'kiyat', kiyIds(st), 'tat', 'kiy');
    const g = generalsIn(st, 'tat', 'tatar')[0];
    expect(recruitQuote(st, g.id, 'inf', 100).ok).toBe(false);
  });
  it('a strong sally lifts the siege', async () => {
    const st = setup(14);
    startSiege(st, 'kiyat', kiyIds(st), 'tat', 'kiy');
    for (const g of besiegers(st, 'tat')) g.unit.soldiers = 150;
    for (const g of generalsIn(st, 'tat', 'tatar')) { g.unit.soldiers = 3000; g.unit.training = 90; g.moved = false; }
    await sally(st, 'tat', {});
    expect(siegeAt(st, 'tat')).toBeNull();
  });
  it('a relief army breaks the siege', async () => {
    const st = newGame({ seed: 15, playerNation: 'kiyat' });
    // 金の中都を西夏が包囲し、遼陽から後詰め
    st.provinces.jz.city.walls = 2;
    declareWar(st, 'tatar', 'jin');
    const bs = generalsIn(st, 'tat', 'tatar').map((g) => g.id);
    for (const id of bs) st.generals[id].unit.soldiers = 200;
    startSiege(st, 'tatar', bs, 'jz', 'tat');
    const helpers = generalsIn(st, 'ly', 'jin').map((g) => g.id);
    for (const id of helpers) { st.generals[id].unit.soldiers = 2500; st.generals[id].moved = false; }
    const r = await executeMove(st, 'jin', helpers, 'ly', 'jz', {});
    expect(r.kind).toBe('relief');
    expect(siegeAt(st, 'jz')).toBeNull();
  });
});
