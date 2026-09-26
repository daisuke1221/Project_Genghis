import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import { createBattle, estimateDamage, damageFactors, defenseFactors, hexNeighbors, hkey, moveUnit, reachable } from '../src/game/battle.js';

function setup(seed = 1, province = 'tat') {
  const st = newGame({ seed });
  const b = createBattle(st, { attNation: 'kiyat', attIds: generalsIn(st, 'kiy', 'kiyat').map((g) => g.id), provinceId: province, fromProvince: 'kiy' });
  // 全マスを平地にして、2部隊を隣接させる
  for (const t of b.tiles) t.t = 'plain';
  b.hasCastle = false;
  b.weather = 'clear';
  const a = b.units.find((x) => x.side === 'att');
  const t = b.units.find((x) => x.side === 'def');
  for (const u of b.units) { u.hidden = false; u.commander = false; }
  b.units = [a, t];
  a.c = 5; a.r = 4; [t.c, t.r] = hexNeighbors(5, 4)[0];
  a.type = 'inf'; t.type = 'inf';
  return { st, b, a, t };
}
const tile = (b, u, kind) => { b.tiles[hkey(u.c, u.r)].t = kind; };

describe('地形効果', () => {
  it('attacking downhill is stronger, uphill weaker', () => {
    const { b, a, t } = setup();
    b.terrain = 'farmland';
    const flat = estimateDamage(b, a, t);
    tile(b, a, 'hill');
    const down = estimateDamage(b, a, t);
    tile(b, a, 'plain'); tile(b, t, 'hill');
    const up = estimateDamage(b, a, t);
    expect(down).toBeGreaterThan(flat * 1.15);
    expect(up).toBeLessThan(flat); // 丘の防御と攻め上がりの不利
    expect(damageFactors(b, a, t).factors.some(([l]) => l.includes('攻め上がる'))).toBe(true);
  });
  it('attacking from a river or right after crossing is penalized', () => {
    const { b, a, t } = setup(2);
    b.terrain = 'farmland';
    const flat = estimateDamage(b, a, t);
    tile(b, a, 'river');
    expect(estimateDamage(b, a, t)).toBeCloseTo(flat * 0.7, 0);
    tile(b, a, 'plain');
    a.crossed = true;
    expect(estimateDamage(b, a, t)).toBeCloseTo(flat * 0.85, 0);
  });
  it('river crossing is tracked when moving', () => {
    const { b, a } = setup(3);
    b.units = [a];
    a.type = 'cav'; a.c = 2; a.r = 4; a.moved = false;
    for (let r = 0; r < 9; r++) b.tiles[hkey(3, r)].t = 'river';
    const reach = reachable(b, a);
    expect(reach.has(hkey(4, 4))).toBe(true);
    moveUnit(b, a, 4, 4);
    expect(a.crossed).toBe(true);
  });
  it('cavalry is strong on the steppe and weak in forests', () => {
    const { b, a, t } = setup(4);
    a.type = 'cav';
    b.terrain = 'farmland';
    const base = estimateDamage(b, a, t);
    b.terrain = 'steppe';
    expect(estimateDamage(b, a, t)).toBeGreaterThan(base * 1.1);
    b.terrain = 'farmland';
    tile(b, t, 'forest');
    const inForest = estimateDamage(b, a, t);
    t.type = 'inf';
    expect(inForest).toBeLessThan(base * 0.7);
  });
  it('foot soldiers defend better in rough terrain; cavalry worse in forests', () => {
    const { b, a, t } = setup(5);
    tile(b, t, 'forest');
    t.type = 'inf';
    const inf = defenseFactors(b, t).factors.map(([l]) => l);
    expect(inf.some((l) => l.includes('歩兵'))).toBe(true);
    t.type = 'cav';
    const cav = defenseFactors(b, t).factors.map(([l]) => l);
    expect(cav.some((l) => l.includes('騎馬'))).toBe(true);
    void a;
  });
  it('marching into mountains costs the attacker troops', () => {
    const st = newGame({ seed: 6, playerNation: 'kiyat' });
    st.season = 0;
    const ids = generalsIn(st, 'sc', 'song').map((g) => g.id);
    const total = ids.reduce((s, id) => s + st.generals[id].unit.soldiers, 0);
    const b = createBattle(st, { attNation: 'song', attIds: ids, provinceId: 'dal', fromProvince: 'sc' });
    const after = b.units.filter((u) => u.side === 'att').reduce((s, u) => s + u.soldiers, 0);
    expect(after).toBeLessThan(total);
    expect(b.notes.join('')).toContain('山道');
  });
  it('summer desert marches hurt armies not used to the desert', () => {
    const st = newGame({ seed: 7 });
    st.season = 1;
    const ids = generalsIn(st, 'ty', 'jin').map((g) => g.id);
    const b = createBattle(st, { attNation: 'jin', attIds: ids, provinceId: 'xia', fromProvince: 'ty' });
    expect(b.notes.join('')).toContain('砂漠');
  });
});
