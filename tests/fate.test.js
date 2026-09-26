import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import { createBattle, attack, duel, duelTargets, duelWinChance, hexNeighbors, autoResolve } from '../src/game/battle.js';
import { applyBattle, woundGeneral, isWounded, healTick } from '../src/game/military.js';

const kiyIds = (st) => generalsIn(st, 'kiy', 'kiyat').map((g) => g.id);
const battle = (st) => createBattle(st, { attNation: 'kiyat', attIds: kiyIds(st), provinceId: 'tat', fromProvince: 'kiy' });

// 敵部隊を隣に置き、必ず壊滅させて討死・負傷の割合を数える
function destroyMany(war, n = 400, protect = false) {
  let dead = 0, wounded = 0;
  const st = newGame({ seed: 1, playerNation: 'tatar' });
  if (protect) st.options.protectRuler = true;
  for (let i = 0; i < n; i++) {
    st.rng = 1000 + i;
    const b = battle(st);
    b.rng = 5000 + i;
    const a = b.units.find((x) => x.side === 'att');
    const t = protect ? b.units.find((x) => x.side === 'def' && x.protected) : b.units.find((x) => x.side === 'def');
    t.war = war; t.hidden = false; t.soldiers = 1; t.morale = 1;
    [t.c, t.r] = hexNeighbors(a.c, a.r).find(([c, r]) => !b.units.some((x) => x !== t && x.c === c && x.r === r));
    attack(b, a, t);
    if (t.dead) dead++; else if (t.wounded) wounded++;
  }
  return { dead, wounded };
}

describe('討死・負傷', () => {
  it('strong warriors die less often than weak ones', () => {
    const strong = destroyMany(98), weak = destroyMany(30);
    expect(strong.dead).toBeLessThan(weak.dead);
    expect(strong.wounded + strong.dead).toBeLessThan(weak.wounded + weak.dead);
  });
  it('a protected player ruler is only ever wounded', () => {
    const r = destroyMany(40, 300, true);
    expect(r.dead).toBe(0);
    expect(r.wounded).toBeGreaterThan(0);
  });
  it('wounded generals sit out battles and heal', () => {
    const st = newGame({ seed: 3 });
    const g = generalsIn(st, 'kiy', 'kiyat')[0];
    woundGeneral(st, g.id, 2);
    expect(isWounded(st, g)).toBe(true);
    const b = battle(st);
    expect(b.units.some((u) => u.gid === g.id)).toBe(false);
    st.turn += 2;
    healTick(st);
    expect(isWounded(st, g)).toBe(false);
  });
  it('battle results apply wounds', () => {
    const st = newGame({ seed: 4 });
    const g = generalsIn(st, 'kiy', 'kiyat')[0];
    const res = { winner: 'def', provinceId: 'tat', fromProvince: 'kiy', attNation: 'kiyat', defNation: 'tatar', units: [{ gid: g.id, side: 'att', soldiers: 100, start: 1000, routed: true, dead: false, wounded: true }] };
    applyBattle(st, res, [g.id]);
    expect(isWounded(st, g)).toBe(true);
  });
});

describe('一騎討ち', () => {
  it('resolves with a winner and a fate for the loser', () => {
    let fought = 0;
    for (let s = 0; s < 40; s++) {
      const st = newGame({ seed: 20 + s });
      const b = battle(st);
      const a = b.units.find((x) => x.side === 'att');
      const t = b.units.find((x) => x.side === 'def');
      a.war = 95; t.war = 90; t.hidden = false; a.hidden = false;
      [t.c, t.r] = hexNeighbors(a.c, a.r).find(([c, r]) => !b.units.some((x) => x !== t && x.c === c && x.r === r));
      expect(duelTargets(b, a)).toContain(t);
      const ev = duel(b, a, t).find((e) => e.type === 'duel');
      if (ev.refused) continue;
      fought++;
      expect([a.id, t.id]).toContain(ev.winner);
      expect(['killed', 'wounded', 'fled']).toContain(ev.outcome);
      const loser = ev.loser === a.id ? a : t;
      if (ev.outcome === 'killed') expect(loser.dead).toBe(true);
      if (ev.outcome === 'wounded') expect(loser.wounded).toBe(true);
    }
    expect(fought).toBeGreaterThan(20);
  });
  it('the stronger warrior usually wins', () => {
    expect(duelWinChance({ war: 99 }, { war: 60 })).toBeGreaterThan(0.7);
    expect(duelWinChance({ war: 99 }, { war: 40 })).toBeGreaterThan(0.85);
    expect(duelWinChance({ war: 60 }, { war: 60 })).toBeCloseTo(0.5, 2);
  });
  it('weak generals cannot challenge', () => {
    const st = newGame({ seed: 5 });
    const b = battle(st);
    const a = b.units.find((x) => x.side === 'att');
    a.war = 50;
    expect(duelTargets(b, a)).toHaveLength(0);
  });
  it('AI battles with duels still finish', () => {
    for (let s = 0; s < 10; s++) {
      const st = newGame({ seed: 60 + s });
      for (const g of Object.values(st.generals)) g.war = 95;
      const r = autoResolve(battle(st));
      expect(['att', 'def']).toContain(r.winner);
    }
  });
});
