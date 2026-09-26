import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import { sign } from '../src/game/diplomacy.js';
import { appoint, subvert, interrogate, banish, roleHolder, subvertTargets, hasTrait } from '../src/game/personnel.js';
import {
  foresee, chanceText, sowDiscord, discordAvailable, spreadRumor, rumorTargets, rumorAvailable, strategistAdvice, strategistOf,
} from '../src/game/strategist.js';

const game = (p = 'kiyat') => newGame({ seed: 5, playerNation: p });
const noStrategist = (st, nid) => appoint(st, nid, 'strategist', null);

describe('見立て', () => {
  it('without a strategist success rates are hidden', () => {
    const st = game();
    noStrategist(st, 'kiyat');
    expect(foresee(st, 'kiyat', 0.5, 'x')).toBe(null);
    expect(chanceText(st, 'kiyat', 0.5, 'x')).toBe('');
  });

  it('a wise strategist sees precisely, a mediocre one only a range', () => {
    const st = game();
    const s = roleHolder(st, 'kiyat', 'strategist');
    s.pol = 100;
    expect(chanceText(st, 'kiyat', 0.43, 'x')).toContain('五分五分');
    expect(chanceText(st, 'kiyat', 0.95, 'y')).toContain('間違いございません');
    expect(chanceText(st, 'kiyat', 0.05, 'z')).toContain('無理');
    expect(chanceText(st, 'kiyat', 0.43, 'x')).not.toMatch(/\d+%/);
    s.pol = 55;
    for (const p of [0.1, 0.43, 0.8]) {
      const f = foresee(st, 'kiyat', p, `k${p}`);
      expect(f.lo).toBeLessThanOrEqual(p);
      expect(f.hi).toBeGreaterThanOrEqual(p);
      expect(f.hi - f.lo).toBeGreaterThan(0.15);
    }
  });
});

describe('謀略の察知', () => {
  const setup = () => {
    const st = game('tatar');
    const s = roleHolder(st, 'tatar', 'strategist');
    s.pol = 100;
    noStrategist(st, 'kiyat');
    const t = subvertTargets(st, 'kiyat').find((g) => g.nation === 'tatar' && g !== s && st.nations.tatar.rulerId !== g.id && !g.family && !hasTrait(g, 'loyal'));
    const agent = generalsIn(st, 'kiy', 'kiyat').sort((a, b) => b.cha - a.cha)[0];
    st.nations.kiyat.gold = 1e6;
    return { st, t, agent };
  };

  it('the victim strategist can foil a hire-away attempt', () => {
    const { st, t, agent } = setup();
    let foiled = 0;
    for (let i = 0; i < 40; i++) {
      t.loyalty = 0; t.nation = 'tatar'; t.traits = ['ambitious'];
      agent.moved = false; st.turn += 1;
      const r = subvert(st, agent.id, t.id, 'hire');
      if (r.foiled) foiled++;
    }
    expect(foiled).toBeGreaterThan(5);
  });

  it('an exposed betrayal is marked for the player, who can interrogate or banish', () => {
    const { st, t, agent } = setup();
    let exposed = false;
    for (let i = 0; i < 40 && !exposed; i++) {
      t.loyalty = 0; t.traits = ['ambitious'];
      agent.moved = false; st.turn += 1;
      subvert(st, agent.id, t.id, 'betray');
      exposed = !!t.exposed;
    }
    expect(exposed).toBe(true);
    expect(t.betray).toBe('kiyat');
    const adv = strategistAdvice(st, 'tatar');
    expect(adv.lines.some((l) => l.includes('内通'))).toBe(true);
    const r = interrogate(st, t.id);
    expect(r.ok).toBe(true);
    if (r.success) expect(t.betray).toBeUndefined();
    else expect(t.nation).toBe('kiyat');
    const g = generalsIn(st, 'tat', 'tatar').find((x) => st.nations.tatar.rulerId !== x.id);
    if (g) { banish(st, g.id); expect(g.nation).toBe(null); }
  });
});

describe('離間の計', () => {
  it('needs a strategist and can break an alliance', () => {
    const st = game();
    st.nations.kiyat.gold = 1e6;
    sign(st, 'jin', 'xia', 'alliance');
    noStrategist(st, 'kiyat');
    expect(discordAvailable(st, 'kiyat', 'jin', 'xia').ok).toBe(false);
    const g = generalsIn(st, 'kiy', 'kiyat').find((x) => st.nations.kiyat.rulerId !== x.id);
    appoint(st, 'kiyat', 'strategist', g.id);
    g.pol = 100; g.traits = ['cunning'];
    let broke = false;
    for (let i = 0; i < 30 && !broke; i++) {
      g.moved = false; st.turn += 1;
      sowDiscord(st, 'kiyat', 'jin', 'xia');
      broke = !st.nations.jin.treaties.xia;
    }
    expect(broke).toBe(true);
    expect(g.moved).toBe(true);
  });
});

describe('流言', () => {
  it('lowers loyalty and order of an adjacent enemy city', () => {
    const st = game();
    st.nations.kiyat.gold = 1e6;
    const s = strategistOf(st, 'kiyat');
    s.pol = 95;
    const pid = rumorTargets(st, 'kiyat')[0];
    const c = st.provinces[pid].city;
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      s.moved = false; st.turn += 1;
      c.loyalty = 70; c.order = 70;
      const r = spreadRumor(st, 'kiyat', pid);
      expect(r.ok).toBe(true);
      hit = r.success;
      if (hit) { expect(c.loyalty).toBeLessThan(70); expect(c.order).toBeLessThan(70); }
    }
    expect(hit).toBe(true);
    expect(rumorAvailable(st, 'kiyat', pid).ok).toBe(false);
  });
});

describe('助言', () => {
  it('warns about disloyal retainers and threats; wiser strategists say more', () => {
    const st = game('jin');
    const g = Object.values(st.generals).find((x) => x.nation === 'jin' && !x.family && st.nations.jin.rulerId !== x.id && roleHolder(st, 'jin', 'strategist') !== x);
    g.loyalty = 20;
    for (const p of Object.values(st.provinces)) if (p.owner === 'jin') p.city.order = 20;
    const s = strategistOf(st, 'jin');
    s.pol = 30;
    const few = strategistAdvice(st, 'jin').lines.length;
    s.pol = 99;
    const adv = strategistAdvice(st, 'jin');
    expect(adv.lines.length).toBeGreaterThan(few);
    expect(adv.lines.some((l) => l.includes(g.name))).toBe(true);
    noStrategist(st, 'jin');
    expect(strategistAdvice(st, 'jin')).toBe(null);
  });
});
