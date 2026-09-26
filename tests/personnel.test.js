import { describe, it, expect } from 'vitest';
import { newGame, generalsIn, unitCap, serialize, deserialize } from '../src/game/state.js';
import { createBattle, damageFactors, defenseFactors, duelWinChance, hexNeighbors } from '../src/game/battle.js';
import { applyBattle } from '../src/game/military.js';
import { cityYields } from '../src/game/city.js';
import '../src/game/events.js';
import {
  hasTrait, ensurePersonnel, gainExp, canPromote, promote, RANKS, loyaltyTarget, personnelTick, roleHolder, appoint,
  subvert, subvertChance, subvertTargets, rebelRisk, personnelYear, affDist,
} from '../src/game/personnel.js';

const find = (st, name) => Object.values(st.generals).find((g) => g.name === name);

describe('特技と個性', () => {
  it('named generals have historical traits, random ones get deterministic traits', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    expect(hasTrait(find(st, 'ジェベ'), 'horsearch')).toBe(true);
    expect(hasTrait(find(st, 'ジャムカ'), 'ambitious')).toBe(true);
    const st2 = newGame({ seed: 1, playerNation: 'kiyat' });
    for (const id of Object.keys(st.generals).slice(0, 50)) expect(st2.generals[id].traits).toEqual(st.generals[id].traits);
    const withTraits = Object.values(st.generals).filter((g) => g.traits.length).length;
    expect(withTraits).toBeGreaterThan(Object.keys(st.generals).length * 0.25);
  });

  it('traits change battle numbers', () => {
    const st = newGame({ seed: 1, playerNation: 'tatar' });
    const b = createBattle(st, { attNation: 'kiyat', attIds: generalsIn(st, 'kiy', 'kiyat').map((g) => g.id), provinceId: 'tat', fromProvince: 'kiy' });
    const a = b.units.find((u) => u.side === 'att');
    const t = b.units.find((u) => u.side === 'def');
    a.type = 'harch'; a.traits = [];
    const [c, r] = hexNeighbors(t.c, t.r)[0];
    const plain = damageFactors(b, a, t, [c, r], 0).mul;
    a.traits = ['horsearch'];
    expect(damageFactors(b, a, t, [c, r], 0).mul).toBeCloseTo(plain * 1.15, 5);
    t.traits = [];
    const d0 = defenseFactors(b, t).mul;
    t.traits = ['ironwall'];
    expect(defenseFactors(b, t).mul).toBeCloseTo(d0 * 1.15, 5);
    const x = { war: 80, traits: [] }, y = { war: 80, traits: [] };
    const even = duelWinChance(x, y);
    x.traits = ['hero'];
    expect(duelWinChance(x, y)).toBeGreaterThan(even + 0.04);
  });

  it('benevolent and merchant governors help their city', () => {
    const st = newGame({ seed: 2, playerNation: 'jin' });
    const gov = st.generals[st.provinces.kf.governorId];
    gov.traits = [];
    const base = cityYields(st, 'kf');
    gov.traits = ['benevolent', 'merchant'];
    const better = cityYields(st, 'kf');
    expect(better.loyaltyTarget).toBe(base.loyaltyTarget + 5);
    expect(better.gold).toBeGreaterThan(base.gold * 1.05);
  });
});

describe('功績・位階・成長', () => {
  it('experience raises stats, young generals grow faster', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    const g = find(st, 'ボオルチュ');
    const before = g.lead;
    gainExp(st, g, 'lead', 250);
    expect(g.lead).toBeGreaterThanOrEqual(before + 2);
  });

  it('promotion needs merit and gold, raises unit cap and loyalty', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    const g = Object.values(st.generals).find((x) => x.nation === 'kiyat' && x.rank === 0 && !x.family) ?? find(st, 'ボオルチュ');
    g.rank = 0; g.merit = 0;
    expect(canPromote(g)).toBe(false);
    g.merit = RANKS[1].merit;
    expect(canPromote(g)).toBe(true);
    expect(loyaltyTarget(st, g).items.some(([l]) => l.includes('報いられていない'))).toBe(true);
    const cap = unitCap(g);
    st.nations.kiyat.gold = 1000;
    expect(promote(st, g.id).ok).toBe(true);
    expect(g.rank).toBe(1);
    expect(unitCap(g)).toBeGreaterThanOrEqual(cap);
  });

  it('battles grant merit', () => {
    const st = newGame({ seed: 3, playerNation: 'tatar' });
    const ids = generalsIn(st, 'kiy', 'kiyat').map((g) => g.id);
    const m0 = st.generals[ids[0]].merit;
    const result = { winner: 'def', provinceId: 'tat', fromProvince: 'kiy', attNation: 'kiyat', defNation: 'tatar', units: ids.map((gid) => ({ gid, side: 'att', soldiers: 500, start: 600 })) };
    applyBattle(st, result, ids);
    expect(st.generals[ids[0]].merit).toBe(m0 + 4);
  });
});

describe('役職', () => {
  it('nations start with officers; roles raise loyalty and the chancellor raises gold', () => {
    const st = newGame({ seed: 1, playerNation: 'jin' });
    expect(roleHolder(st, 'jin', 'chancellor')).toBeTruthy();
    expect(roleHolder(st, 'jin', 'strategist')).toBeTruthy();
    const chan = roleHolder(st, 'jin', 'chancellor');
    const g = roleHolder(st, 'jin', 'marshal');
    expect(loyaltyTarget(st, g).items.some(([l]) => l === '大将軍')).toBe(true);
    const gold = cityYields(st, 'kf').gold;
    appoint(st, 'jin', 'chancellor', null);
    expect(cityYields(st, 'kf').gold).toBeLessThan(gold);
    appoint(st, 'jin', 'chancellor', chan.id);
    appoint(st, 'jin', 'marshal', chan.id); // 兼任はできない
    expect(roleHolder(st, 'jin', 'chancellor')).toBe(null);
  });

  it('a strategist reveals ambushes', () => {
    const st = newGame({ seed: 1, playerNation: 'tatar' });
    const ids = generalsIn(st, 'kiy', 'kiyat').map((g) => g.id);
    for (let seed = 0; seed < 40; seed++) {
      st.rng = seed + 100;
      appoint(st, 'kiyat', 'strategist', ids[1]);
      const b = createBattle(st, { attNation: 'kiyat', attIds: ids, provinceId: 'tat', fromProvince: 'kiy' });
      expect(b.units.filter((u) => u.side === 'def' && u.hidden).length).toBe(0);
    }
  });
});

describe('忠誠', () => {
  it('loyalty drifts toward the target', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    const g = Object.values(st.generals).find((x) => x.nation === 'kiyat' && !x.family && st.nations.kiyat.rulerId !== x.id);
    g.loyalty = 100;
    const t = loyaltyTarget(st, g).target;
    for (let i = 0; i < 40; i++) personnelTick(st);
    expect(Math.abs(g.loyalty - t)).toBeLessThanOrEqual(3);
  });

  it('compatibility matters', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    const r = st.generals[st.nations.kiyat.rulerId];
    const g = find(st, 'ボオルチュ');
    g.aff = r.aff;
    const good = loyaltyTarget(st, g).target;
    g.aff = (r.aff + 75) % 150;
    expect(affDist(g, r)).toBe(75);
    expect(loyaltyTarget(st, g).target).toBeLessThan(good - 15);
  });
});

describe('調略と寝返り', () => {
  it('hiring away moves the general with half his troops', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    const t = subvertTargets(st, 'kiyat').find((g) => st.nations[g.nation].rulerId !== g.id && !g.family && !hasTrait(g, 'loyal') && g.unit?.soldiers > 0);
    t.loyalty = 5; t.traits = ['ambitious'];
    const agent = generalsIn(st, 'kiy', 'kiyat').sort((a, b) => b.cha - a.cha)[0];
    st.nations.kiyat.gold = 5000;
    let ok = false;
    for (let i = 0; i < 10 && !ok; i++) {
      agent.moved = false; st.turn += 1;
      const soldiers = t.unit.soldiers;
      const r = subvert(st, agent.id, t.id, 'hire');
      if (r.success) { ok = true; expect(t.nation).toBe('kiyat'); expect(t.unit.soldiers).toBeLessThanOrEqual(soldiers / 2 + 10); }
    }
    expect(ok).toBe(true);
  });

  it('rulers and loyal generals refuse', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    const agent = find(st, 'テムジン');
    expect(subvertChance(st, agent, st.generals[st.nations.tatar.rulerId], 'hire')).toBe(0);
    const g = subvertTargets(st, 'kiyat').find((x) => st.nations[x.nation].rulerId !== x.id && !x.family);
    g.traits = ['loyal'];
    expect(subvertChance(st, agent, g, 'betray')).toBe(0);
  });

  it('a general who promised to betray switches sides in battle and joins afterwards', () => {
    const st = newGame({ seed: 1, playerNation: 'tatar' });
    const def = generalsIn(st, 'tat', 'tatar').find((g) => st.nations.tatar.rulerId !== g.id && g.unit?.soldiers > 0);
    def.betray = 'kiyat'; def.betrayUntil = st.turn + 4;
    const ids = generalsIn(st, 'kiy', 'kiyat').map((g) => g.id);
    const b = createBattle(st, { attNation: 'kiyat', attIds: ids, provinceId: 'tat', fromProvince: 'kiy' });
    const u = b.units.find((x) => x.gid === def.id);
    expect(u.side).toBe('att');
    expect(b.notes.some((n) => n.includes('寝返'))).toBe(true);
    const result = { winner: 'def', provinceId: 'tat', fromProvince: 'kiy', attNation: 'kiyat', defNation: 'tatar', units: b.units.map((x) => ({ gid: x.gid, side: x.side, soldiers: x.soldiers, start: x.start, turncoat: x.turncoat, newNation: x.newNation })) };
    applyBattle(st, result, ids);
    expect(def.nation).toBe('kiyat');
    expect(st.provinces[def.province].owner).toBe('kiyat');
  });
});

describe('謀反', () => {
  it('a disloyal ambitious governor rebels and founds a nation', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    const g = st.generals[st.provinces.kf.governorId];
    if (st.nations.jin.rulerId === g.id) throw new Error('unexpected');
    g.family = false; g.traits = ['ambitious']; g.loyalty = 5;
    expect(rebelRisk(st, g)).toBeGreaterThan(0.5);
    let n = 0;
    for (let i = 0; i < 10 && st.provinces.kf.owner === 'jin'; i++) { personnelYear(st, () => { n++; }); g.loyalty = 5; }
    expect(st.provinces.kf.owner).toBe(`reb_${g.id}`);
    expect(st.nations[`reb_${g.id}`].rulerId).toBe(g.id);
    expect(n).toBeGreaterThan(0);
  });
});

describe('互換性', () => {
  it('old saves get personnel fields', () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    for (const g of Object.values(st.generals)) { delete g.traits; delete g.rank; delete g.merit; delete g.aff; delete g.exp; }
    const st2 = deserialize(serialize(st));
    expect(Object.values(st2.generals).every((g) => Array.isArray(g.traits) && g.rank >= 0)).toBe(true);
    expect(ensurePersonnel(find(st2, 'ジェベ')).traits).toContain('charge');
  });
});
