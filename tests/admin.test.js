import { describe, it, expect } from 'vitest';
import { newGame, generalsIn, serialize, deserialize } from '../src/game/state.js';
import { cityYields } from '../src/game/city.js';
import { seasonTick } from '../src/game/turn.js';
import { changeOwner } from '../src/game/military.js';
import {
  adminMods, doCommand, commandAvailable, provReligion, nationReligion, TAX_LEVELS, adminTick, aiAdmin,
} from '../src/game/admin.js';

const game = () => { const st = newGame({ seed: 3, playerNation: 'jin' }); st.nations.jin.gold = 50000; st.nations.jin.food = 50000; return st; };
const freeGen = (st, pid, nid) => generalsIn(st, pid, nid).find((g) => !g.moved);

describe('税率', () => {
  it('higher tax brings more gold but lowers the loyalty target', () => {
    const st = game();
    const c = st.provinces.jz.city;
    c.tax = 1; const normal = cityYields(st, 'jz');
    c.tax = 3; const harsh = cityYields(st, 'jz');
    c.tax = 0; const light = cityYields(st, 'jz');
    expect(harsh.tax).toBeGreaterThan(normal.tax);
    expect(light.tax).toBeLessThan(normal.tax);
    expect(harsh.loyaltyTarget).toBe(normal.loyaltyTarget + TAX_LEVELS[3].loyalty);
    expect(light.loyaltyTarget).toBeGreaterThan(normal.loyaltyTarget);
  });
});

describe('内政命令', () => {
  it('commands use a general, cost resources and work once per season', () => {
    const st = game();
    const g = freeGen(st, 'jz', 'jin');
    const gold = st.nations.jin.gold;
    const r = doCommand(st, 'jz', 'commerce', g.id);
    expect(r.ok).toBe(true);
    expect(st.provinces.jz.city.commerce).toBeGreaterThan(0);
    expect(st.nations.jin.gold).toBeLessThan(gold);
    expect(g.moved).toBe(true);
    expect(doCommand(st, 'jz', 'commerce', g.id).ok).toBe(false);
    const g2 = freeGen(st, 'jz', 'jin');
    expect(commandAvailable(st, 'jz', 'commerce').ok).toBe(false);
    expect(doCommand(st, 'jz', 'patrol', g2.id).ok).toBe(true);
  });

  it('commerce and irrigation raise output', () => {
    const st = game();
    const before = cityYields(st, 'kf');
    st.provinces.kf.city.commerce = 80;
    st.provinces.kf.city.irrigation = 80;
    const after = cityYields(st, 'kf');
    expect(after.gold).toBeGreaterThan(before.gold * 1.15);
    expect(after.food).toBeGreaterThan(before.food * 1.15);
  });

  it('alms raises loyalty and the target for a year', () => {
    const st = game();
    const c = st.provinces.jz.city;
    c.loyalty = 40;
    const t0 = cityYields(st, 'jz').loyaltyTarget;
    expect(doCommand(st, 'jz', 'alms', freeGen(st, 'jz', 'jin').id).ok).toBe(true);
    expect(c.loyalty).toBeGreaterThan(40);
    expect(cityYields(st, 'jz').loyaltyTarget).toBe(t0 + 5);
  });
});

describe('治安', () => {
  it('garrison and patrols raise order; low order costs gold', () => {
    const st = game();
    const withTroops = adminMods(st, 'jz').orderTarget;
    for (const g of generalsIn(st, 'jz', 'jin')) g.unit = null;
    expect(adminMods(st, 'jz').orderTarget).toBeLessThan(withTroops);
    const c = st.provinces.jz.city;
    c.order = 60;
    const high = cityYields(st, 'jz').gold;
    c.order = 10;
    expect(cityYields(st, 'jz').gold).toBeLessThan(high);
    let bandits = 0;
    for (let i = 0; i < 60; i++) { c.order = 5; adminTick(st, 'jz', cityYields(st, 'jz'), (t) => { if (t.includes('盗賊')) bandits++; }); }
    expect(bandits).toBeGreaterThan(5);
  });
});

describe('宗教と文化', () => {
  it('foreign rule by a non-tolerant faith lowers loyalty, patronage removes it', () => {
    const st = game();
    // 金（仏教）がイスラームのバグダードを支配した場合
    const base = cityYields(st, 'irq').loyaltyTarget;
    changeOwner(st, 'irq', 'jin');
    const m = adminMods(st, 'irq');
    expect(m.loyalty.some(([l]) => l.startsWith('異教'))).toBe(true);
    expect(m.loyalty.some(([l]) => l.startsWith('異民族'))).toBe(true);
    const g = freeGen(st, 'jz', 'jin');
    g.province = 'irq';
    expect(doCommand(st, 'irq', 'patronize', g.id).ok).toBe(true);
    expect(adminMods(st, 'irq').loyalty.some(([l]) => l.startsWith('異教'))).toBe(false);
    expect(base).toBeGreaterThan(0);
  });

  it('tengri rulers are tolerant and do not proselytize', () => {
    const st = game();
    changeOwner(st, 'irq', 'kiyat');
    expect(nationReligion(st, 'kiyat')).toBe('tengri');
    expect(adminMods(st, 'irq').loyalty.some(([l]) => l.startsWith('異教'))).toBe(false);
    expect(commandAvailable(st, 'irq', 'convert').ok).toBe(false);
  });

  it('conversion can change the province faith', () => {
    const st = game();
    changeOwner(st, 'irq', 'jin');
    let converted = false;
    for (let i = 0; i < 30 && !converted; i++) {
      st.turn += 1;
      const g = freeGen(st, 'jz', 'jin');
      g.province = 'irq';
      st.provinces.irq.city.loyalty = 90;
      doCommand(st, 'irq', 'convert', g.id);
      converted = provReligion(st, 'irq') === 'buddhism';
    }
    expect(converted).toBe(true);
    expect(adminMods(st, 'irq').loyalty.some(([l]) => l.startsWith('異教'))).toBe(false);
  });

  it('culture penalty fades over the years', () => {
    const st = game();
    changeOwner(st, 'irq', 'jin');
    const pen = () => adminMods(st, 'irq').loyalty.find(([l]) => l.startsWith('異民族'))?.[1] ?? 0;
    expect(pen()).toBe(-6);
    st.turn += 30;
    expect(pen()).toBeGreaterThan(-6);
    st.turn += 30;
    expect(pen()).toBe(0);
  });
});

describe('互換性とAI', () => {
  it('old saves without admin fields still work', () => {
    const st = game();
    for (const p of Object.values(st.provinces)) { delete p.city.tax; delete p.city.order; delete p.city.irrigation; delete p.city.commerce; }
    const st2 = deserialize(serialize(st));
    expect(() => seasonTick(st2)).not.toThrow();
    expect(st2.provinces.jz.city.order).toBeGreaterThan(0);
  });

  it('AI issues domestic commands with idle generals', () => {
    const st = game();
    st.provinces.jz.city.loyalty = 30;
    aiAdmin(st, 'jin', ['jz', 'kf', 'ty']);
    const acted = ['jz', 'kf', 'ty'].filter((pid) => st.provinces[pid].city.acts?.done.length);
    expect(acted.length).toBeGreaterThan(0);
    expect(st.provinces.jz.city.tax).toBe(0);
  });
});
