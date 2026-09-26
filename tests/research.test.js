import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import { cityYields, canBuildWalls } from '../src/game/city.js';
import { createBattle, damageFactors, tacticChance } from '../src/game/battle.js';
import { occupy } from '../src/game/military.js';
import {
  techsIn, genTech, hireTech, techMul, techTick, poachTech, poachChance, poachTargets, hireTechChance, TECH_MAX_LEVEL,
} from '../src/game/tech.js';
import { INNOVATIONS, available, innovCost, researchRate, setResearch, researchTick, knows, learnFrom } from '../src/game/research.js';
import { marchRange } from '../src/game/warfare.js';

const game = (p = 'jin') => newGame({ seed: 9, playerNation: p });
const place = (st, nid, pid, type = 'merchant', level = 1) => {
  const t = genTech(st, pid);
  Object.assign(t, { type, level, nation: nid, city: pid, trait: undefined, since: st.turn });
  return t;
};

describe('技術者の成長と個性', () => {
  it('technicians grow with experience up to the maximum level', () => {
    const st = game();
    for (const t of techsIn(st, 'kf')) t.city = null;
    const t = place(st, 'jin', 'kf');
    st.season = 0;
    for (let i = 0; i < 40; i++) techTick(st);
    expect(t.level).toBe(TECH_MAX_LEVEL);
  });

  it('master and governor synergy multiply the effect', () => {
    const st = game();
    const t = place(st, 'jin', 'kf');
    const gov = st.generals[st.provinces.kf.governorId];
    gov.pol = 60; gov.traits = [];
    const base = techMul(st, t, 'kf');
    t.trait = 'master';
    expect(techMul(st, t, 'kf')).toBeCloseTo(base * 1.3, 5);
    gov.traits = ['merchant'];
    expect(techMul(st, t, 'kf')).toBeCloseTo(base * 1.3 * 1.25, 5);
  });
});

describe('招聘と引き抜き', () => {
  it('foreign technicians can refuse; home ones rarely do', () => {
    const st = game();
    const home = genTech(st, 'kf');
    const away = genTech(st, 'song');
    expect(hireTechChance(st, 'jin', home)).toBeGreaterThan(hireTechChance(st, 'jin', away));
  });

  it('technicians serving another nation can be poached', () => {
    const st = game();
    st.nations.jin.gold = 1e6;
    const t = place(st, 'song', 'sy', 'scholar', 2);
    t.trait = 'greedy';
    for (const x of techsIn(st, 'kf')) x.city = null;
    expect(poachTargets(st, 'jin')).toContain(t);
    expect(poachChance(st, 'jin', t)).toBeGreaterThan(0.2);
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) { st.turn += 1; ok = poachTech(st, 'jin', t.id, 'kf').success; }
    expect(ok).toBe(true);
    expect(t.nation).toBe('jin');
  });
});

describe('技術革新', () => {
  it('research accumulates from technicians and unlocks innovations', () => {
    const st = game();
    place(st, 'jin', 'kf', 'scholar', 3);
    expect(researchRate(st, 'jin')).toBeGreaterThan(4);
    expect(setResearch(st, 'jin', 'gunpowder').ok).toBe(false); // 前提（紙幣）が必要
    expect(setResearch(st, 'jin', 'paper_money').ok).toBe(true);
    for (let i = 0; i < 40 && !knows(st, 'jin', 'paper_money'); i++) researchTick(st);
    expect(knows(st, 'jin', 'paper_money')).toBe(true);
    expect(available(st, 'jin')).toContain('gunpowder');
  });

  it('origin cultures and neighbors make innovations cheaper', () => {
    const st = game();
    expect(innovCost(st, 'jin', 'paper_money')).toBeLessThan(INNOVATIONS.paper_money.cost);
    const c0 = innovCost(st, 'xia', 'yam');
    st.nations.jin.innov = { yam: 1 };
    expect(innovCost(st, 'xia', 'yam')).toBeLessThan(c0);
  });

  it('innovations change the economy, sieges and battles', () => {
    const st = game();
    const g0 = cityYields(st, 'kf').gold;
    const w0 = canBuildWalls(st, 'kf').cost;
    st.nations.jin.innov = { paper_money: 1, fortification: 1, gunpowder: 1, composite_bow: 1 };
    expect(cityYields(st, 'kf').gold).toBeGreaterThan(g0);
    if (w0) expect(canBuildWalls(st, 'kf').cost).toBeLessThan(w0);
    const b = createBattle(st, { attNation: 'jin', attIds: generalsIn(st, 'kf', 'jin').map((g) => g.id), provinceId: 'sy', fromProvince: 'kf' });
    const a = b.units.find((u) => u.side === 'att'), t = b.units.find((u) => u.side === 'def');
    const p1 = tacticChance(b, a, 'fire', t);
    b.innov.att = [];
    expect(tacticChance(b, a, 'fire', t)).toBeLessThan(p1);
  });

  it('the yam extends marches; conquest can teach innovations', () => {
    const st = game();
    const ids = generalsIn(st, 'kf', 'jin').map((g) => g.id);
    const r0 = marchRange(st, ids);
    st.nations.jin.innov = { yam: 1 };
    expect(marchRange(st, ids)).toBe(r0 + 1);
    st.nations.song.innov = { compass: 1, printing: 1, paper_money: 1 };
    let learned = false;
    for (let i = 0; i < 30 && !learned; i++) learned = !!learnFrom(st, 'jin', 'song', 'テストで');
    expect(learned).toBe(true);
  });
});
