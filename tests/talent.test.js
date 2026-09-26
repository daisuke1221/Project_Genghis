import { describe, it, expect } from 'vitest';
import { newGame, addGeneral, nationGenerals } from '../src/game/state.js';
import { seasonTick } from '../src/game/turn.js';
import {
  fame, hireChanceWith, tryHireWith, roninTick, acceptPetition, recommendations, namedRoninTick, stipendTotal, stipendOf,
} from '../src/game/talent.js';

const game = (p = 'kiyat') => newGame({ seed: 8, playerNation: p });
const ronin = (st, pid, extra = {}) => addGeneral(st, { name: '浪人', birth: st.year - 30, war: 60, lead: 60, pol: 60, cha: 60, province: pid, ...extra });

describe('名声', () => {
  it('large, trusted nations are more famous', () => {
    const st = game();
    expect(fame(st, 'jin')).toBeGreaterThan(fame(st, 'ongud'));
    st.nations.jin.trust = 10;
    const low = fame(st, 'jin');
    st.nations.jin.trust = 90;
    expect(fame(st, 'jin')).toBeGreaterThan(low);
  });
});

describe('登用の口説き方', () => {
  it('gifts, a promised rank and repeated visits raise the odds', () => {
    const st = game();
    const g = ronin(st, 'kiy');
    g.traits = [];
    const r = st.generals[st.nations.kiyat.rulerId];
    r.cha = 40; r.traits = [];
    const base = hireChanceWith(st, 'kiyat', g);
    expect(hireChanceWith(st, 'kiyat', g, { gold: 300 })).toBeGreaterThan(base);
    expect(hireChanceWith(st, 'kiyat', g, { rank: true })).toBeGreaterThan(base);
    g.courted = { kiyat: 2 };
    expect(hireChanceWith(st, 'kiyat', g)).toBeCloseTo(Math.min(0.95, base + 0.2), 5);
  });

  it('failed attempts are remembered and a promised rank is honored', () => {
    const st = game();
    st.nations.kiyat.gold = 10000;
    const g = ronin(st, 'kiy');
    g.traits = []; g.rank = 0;
    let res;
    for (let i = 0; i < 30; i++) {
      st.turn += 1;
      res = tryHireWith(st, 'kiyat', g.id, { rank: true, gold: 100 });
      if (res.success) break;
      expect(g.courted.kiyat).toBeGreaterThan(0);
    }
    expect(res.success).toBe(true);
    expect(g.nation).toBe('kiyat');
    expect(g.rank).toBe(1);
  });

  it('cannot be tried twice in a season', () => {
    const st = game();
    const g = ronin(st, 'kiy', { cha: 99 });
    g.traits = ['loyal']; g.formerNation = 'jin';
    const r1 = tryHireWith(st, 'kiyat', g.id);
    if (!r1.success) expect(tryHireWith(st, 'kiyat', g.id).ok).toBe(false);
  });
});

describe('放浪・仕官・推挙', () => {
  it('ronin wander and petition famous rulers', () => {
    const st = game('jin');
    const gs = Array.from({ length: 40 }, () => ronin(st, 'kf'));
    let moved = 0, petitions = [];
    for (let i = 0; i < 8; i++) { st.turn += 1; if (i % 4 === 3) st.year += 1; petitions.push(...roninTick(st)); }
    moved = gs.filter((g) => g.province !== 'kf').length;
    expect(moved).toBeGreaterThan(5);
    expect(petitions.length).toBeGreaterThan(0);
    const p = petitions[0];
    expect(acceptPetition(st, p.gid)).toBe(true);
    expect(st.generals[p.gid].nation).toBe('jin');
  });

  it('charismatic retainers recommend acquaintances', () => {
    const st = game();
    for (const g of nationGenerals(st, 'kiyat')) g.cha = 90;
    let found = null;
    for (let i = 0; i < 20 && !found; i++) {
      recommendations(st);
      found = Object.values(st.generals).find((g) => g.recommendedTo === 'kiyat');
    }
    expect(found).toBeTruthy();
    expect(found.nation).toBe(null);
    found.traits = [];
    const other = ronin(st, found.province, { war: found.war, lead: found.lead, pol: found.pol, cha: found.cha });
    other.traits = [];
    expect(hireChanceWith(st, 'kiyat', found)).toBeGreaterThan(hireChanceWith(st, 'kiyat', other));
  });

  it('historical talents appear in their year', () => {
    const st = game();
    st.year = 1196;
    namedRoninTick(st);
    const c = Object.values(st.generals).find((g) => g.name === 'チンカイ');
    expect(c).toBeTruthy();
    expect(c.nation).toBe(null);
    expect(c.named).toBe(true);
    expect(Object.values(st.generals).some((g) => g.name === '史天沢')).toBe(false);
  });
});

describe('俸給', () => {
  it('retainers draw a stipend each season', () => {
    const st = game();
    const total = stipendTotal(st, 'kiyat');
    expect(total).toBeGreaterThan(0);
    const g = nationGenerals(st, 'kiyat').find((x) => x.id !== st.nations.kiyat.rulerId);
    expect(stipendOf(g)).toBe(5 + g.rank * 4);
    st.nations.kiyat.gold = 100000;
    const before = st.nations.kiyat.gold;
    seasonTick(st);
    expect(st.nations.kiyat.gold).toBeLessThan(before + st.nations.kiyat.lastIncome.gold);
  });
});
