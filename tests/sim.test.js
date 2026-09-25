import { describe, it, expect } from 'vitest';
import { newGame, nationProvinces, generalsIn, serialize, deserialize, nationSoldiers } from '../src/game/state.js';
import { endTurn } from '../src/game/turn.js';
import { cityYields, canBuild, startBuild, GRID, tileAt, bestTile } from '../src/game/city.js';
import { createBattle, autoResolve, reachable, hexDist, hexNeighbors } from '../src/game/battle.js';
import { recruitQuote, recruit } from '../src/game/military.js';
import { executeMove } from '../src/game/actions.js';
import { NEIGHBORS } from '../src/game/geo.js';
import { PROVINCES } from '../src/game/data.js';

describe('geography', () => {
  it('all provinces are connected', () => {
    const seen = new Set(['kiy']); const q = ['kiy'];
    while (q.length) { const a = q.shift(); for (const b of NEIGHBORS[a]) if (!seen.has(b)) { seen.add(b); q.push(b); } }
    expect(seen.size).toBe(PROVINCES.length);
  });
  it('adjacency is symmetric', () => {
    for (const a in NEIGHBORS) for (const b of NEIGHBORS[a]) expect(NEIGHBORS[b]).toContain(a);
  });
});

describe('new game', () => {
  const st = newGame({ playerNation: 'kiyat', seed: 42 });
  it('every nation has a ruler and each owned province a governor', () => {
    for (const n of Object.values(st.nations)) {
      expect(st.generals[n.rulerId]).toBeTruthy();
      for (const p of nationProvinces(st, n.id)) expect(p.governorId).toBeTruthy();
    }
  });
  it('is deterministic for a seed', () => {
    const a = newGame({ seed: 7 }), b = newGame({ seed: 7 });
    expect(serialize(a)).toBe(serialize(b));
  });
  it('round-trips through save data', () => {
    expect(serialize(deserialize(serialize(st)))).toBe(serialize(st));
  });
});

describe('city', () => {
  it('farm next to river yields more', () => {
    const st = newGame({ seed: 3 });
    const p = st.provinces.kiy;
    st.nations.kiyat.gold = 99999;
    // 川に隣接する草地と、隣接しない草地を探す
    let near = null, far = null;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const t = tileAt(p.city, x, y);
      if (t.t !== 'grass' || t.b) continue;
      const adjRiver = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => tileAt(p.city, x+dx, y+dy)?.t === 'river');
      if (adjRiver && !near) near = [x, y];
      if (!adjRiver && !far) far = [x, y];
    }
    if (!near) return; // 川の無い都市
    const before = cityYields(st, 'kiy', 1).food;
    startBuild(st, 'kiy', ...near, 'farm');
    tileAt(p.city, ...near).b.progress = 1;
    const withNear = cityYields(st, 'kiy', 1).food - before;
    startBuild(st, 'kiy', ...far, 'farm');
    tileAt(p.city, ...far).b.progress = 1;
    const withFar = cityYields(st, 'kiy', 1).food - before - withNear;
    expect(withNear).toBeGreaterThan(withFar);
  });
  it('mines only on hills', () => {
    const st = newGame({ seed: 5 });
    st.nations.kiyat.gold = 99999;
    const p = st.provinces.kiy;
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const t = tileAt(p.city, x, y);
      if (t.b) continue;
      expect(canBuild(st, 'kiy', x, y, 'mine').ok).toBe(t.t === 'hill');
    }
  });
});

describe('battle', () => {
  it('hex distance matches neighbors', () => {
    for (const [c, r] of hexNeighbors(5, 4)) expect(hexDist(5, 4, c, r)).toBe(1);
    for (const [c, r] of hexNeighbors(6, 3)) expect(hexDist(6, 3, c, r)).toBe(1);
  });
  it('auto-resolves to a winner', () => {
    const st = newGame({ seed: 11 });
    const atk = generalsIn(st, 'kiy', 'kiyat').map((g) => g.id);
    const b = createBattle(st, { attNation: 'kiyat', attIds: atk, provinceId: 'tat', fromProvince: 'kiy' });
    expect(b.units.length).toBeGreaterThan(1);
    const res = autoResolve(b);
    expect(['att', 'def']).toContain(res.winner);
  });
  it('a much larger army usually wins', () => {
    let wins = 0;
    for (let s = 0; s < 10; s++) {
      const st = newGame({ seed: 100 + s });
      const gens = generalsIn(st, 'kiy', 'kiyat');
      for (const g of gens) { g.unit.soldiers = 3000; g.unit.training = 80; }
      for (const g of generalsIn(st, 'tat', 'tatar')) g.unit.soldiers = 300;
      const b = createBattle(st, { attNation: 'kiyat', attIds: gens.map((g) => g.id), provinceId: 'tat', fromProvince: 'kiy' });
      if (autoResolve(b).winner === 'att') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(8);
  });
  it('units cannot move through enemies', () => {
    const st = newGame({ seed: 12 });
    const b = createBattle(st, { attNation: 'kiyat', attIds: generalsIn(st, 'kiy', 'kiyat').map((g) => g.id), provinceId: 'tat', fromProvince: 'kiy' });
    const u = b.units.find((x) => x.side === 'att');
    for (const [, cell] of reachable(b, u)) {
      const occ = b.units.find((x) => x !== u && !x.routed && x.c === cell.c && x.r === cell.r);
      expect(occ).toBeFalsy();
    }
  });
});

describe('military actions', () => {
  it('recruiting spends gold and population', async () => {
    const st = newGame({ seed: 9 });
    const g = generalsIn(st, 'kiy', 'kiyat')[0];
    g.unit.soldiers = 0;
    const gold = st.nations.kiyat.gold, pop = st.provinces.kiy.city.pop;
    const q = recruitQuote(st, g.id, 'inf', 200);
    expect(q.ok).toBe(true);
    recruit(st, g.id, 'inf', 200);
    expect(st.nations.kiyat.gold).toBeLessThan(gold);
    expect(st.provinces.kiy.city.pop).toBe(pop - q.amount);
  });
  it('conquering an undefended province changes owner', async () => {
    const st = newGame({ seed: 13 });
    for (const g of generalsIn(st, 'tat', 'tatar')) g.unit.soldiers = 0;
    const atk = generalsIn(st, 'kiy', 'kiyat').map((g) => g.id);
    await executeMove(st, 'kiyat', atk, 'kiy', 'tat');
    expect(st.provinces.tat.owner).toBe('kiyat');
  });
});

describe('long simulation', () => {
  it('runs 60 AI turns without errors and keeps invariants', async () => {
    const st = newGame({ playerNation: 'kiyat', seed: 2024 });
    // プレイヤーも自動で戦う
    const hooks = { battle: async (b) => (await import('../src/game/battle.js')).autoResolve(b), proposal: async () => false };
    for (let i = 0; i < 60 && !st.over; i++) {
      await endTurn(st, hooks);
      for (const g of Object.values(st.generals)) {
        if (g.unit) expect(g.unit.soldiers).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(g.loyalty)).toBe(true);
      }
      for (const n of Object.values(st.nations)) {
        expect(Number.isFinite(n.gold)).toBe(true);
        expect(n.gold).toBeGreaterThanOrEqual(0);
        if (n.alive) expect(st.generals[n.rulerId]?.alive).toBe(true);
      }
      for (const p of Object.values(st.provinces)) {
        expect(p.city.pop).toBeGreaterThan(0);
        if (p.owner) expect(st.nations[p.owner].alive).toBe(true);
      }
    }
    const alive = Object.values(st.nations).filter((n) => n.alive).length;
    const summary = Object.values(st.nations).filter((n) => n.alive).map((n) => `${n.name}:${nationProvinces(st, n.id).length}/${nationSoldiers(st, n.id)}/${n.gold}`);
    console.log(`year ${st.year} alive ${alive}\n` + summary.join('  '));
    expect(alive).toBeGreaterThan(1);
  }, 60000);
});
