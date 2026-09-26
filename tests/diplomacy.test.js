import { describe, it, expect } from 'vitest';
import { newGame, generalsIn, treaty } from '../src/game/state.js';
import {
  declareWar, atWar, sign, applyPeace, proposePeace, peaceChance, lordOf, vassalsOf, diplomacyTick, annexVassal,
  annexChance, warScore, hegemon, aiDiplomacy, joinWar, TRIBUTE_RATE, cedeCandidates,
} from '../src/game/diplomacy.js';
import { executeMove, gatherReinforcements } from '../src/game/actions.js';
import { createBattle } from '../src/game/battle.js';
import { endTurn } from '../src/game/turn.js';
import { autoResolve } from '../src/game/battle.js';

describe('外交の拡張', () => {
  it('attacking declares war and allies of the defender join', async () => {
    const st = newGame({ seed: 1 });
    sign(st, 'tatar', 'jin', 'alliance');
    st.nations.jin.relations.tatar = 100; st.nations.tatar.relations.jin = 100;
    for (const g of generalsIn(st, 'tat', 'tatar')) g.unit.soldiers = 0;
    await executeMove(st, 'kiyat', generalsIn(st, 'kiy', 'kiyat').map((g) => g.id), 'kiy', 'tat');
    expect(atWar(st, 'kiyat', 'tatar') || !st.nations.tatar.alive).toBe(true);
    expect(atWar(st, 'jin', 'kiyat')).toBe(true);
  });
  it('the player is asked to join an ally\'s war', async () => {
    const st = newGame({ seed: 2, playerNation: 'kiyat' });
    sign(st, 'kiyat', 'tatar', 'alliance');
    let asked = null;
    const calls = declareWar(st, 'jin', 'tatar');
    expect(calls.some((c) => c.ally === 'kiyat')).toBe(true);
    asked = calls.find((c) => c.ally === 'kiyat');
    joinWar(st, asked.ally, asked.caller, asked.enemy);
    expect(atWar(st, 'kiyat', 'jin')).toBe(true);
  });
  it('allied generals adjacent to the battlefield join as reinforcements', () => {
    const st = newGame({ seed: 3, playerNation: 'kiyat' });
    // ケレイト(トーラ)はタタルに隣接していないので、ジンの遼陽（タタル隣接）を使う
    sign(st, 'tatar', 'jin', 'alliance');
    declareWar(st, 'kiyat', 'tatar');
    joinWar(st, 'jin', 'tatar', 'kiyat');
    const help = gatherReinforcements(st, 'tatar', 'kiyat', 'tat');
    expect(help.length).toBeGreaterThan(0);
    for (const id of help) expect(st.generals[id].nation).toBe('jin');
    const b = createBattle(st, { attNation: 'kiyat', attIds: generalsIn(st, 'kiy', 'kiyat').map((g) => g.id), provinceId: 'tat', fromProvince: 'kiy', reinforce: { att: [], def: help } });
    expect(b.units.some((u) => u.side === 'def' && u.ally)).toBe(true);
  });
  it('peace terms: ceding a province', () => {
    const st = newGame({ seed: 4 });
    declareWar(st, 'jin', 'tatar');
    const cand = cedeCandidates(st, 'jin', 'tatar');
    expect(cand).toContain('tat');
    applyPeace(st, 'jin', 'tatar', { kind: 'cede', province: 'tat' });
    expect(st.provinces.tat.owner).toBe('jin');
    expect(atWar(st, 'jin', 'tatar')).toBe(false);
  });
  it('a stronger winner can impose harsher terms', () => {
    const st = newGame({ seed: 5 });
    declareWar(st, 'jin', 'tatar');
    st.nations.jin.wars.tatar.taken = 3; st.nations.tatar.wars.jin.taken = -3;
    expect(warScore(st, 'jin', 'tatar')).toBeGreaterThan(2);
    expect(peaceChance(st, 'jin', 'tatar', { kind: 'demandGold', gold: 500 })).toBeGreaterThan(peaceChance(st, 'tatar', 'jin', { kind: 'demandGold', gold: 500 }));
  });
  it('vassals pay tribute and can be annexed', () => {
    const st = newGame({ seed: 6 });
    sign(st, 'jin', 'ongud', 'vassal', { lord: 'jin' });
    expect(lordOf(st, 'ongud')).toBe('jin');
    expect(vassalsOf(st, 'jin')).toContain('ongud');
    expect(treaty(st, 'jin', 'ongud')).toBe('vassal');
    st.nations.ongud.lastIncome = { gold: 1000, food: 0 };
    st.nations.ongud.gold = 5000;
    const g0 = st.nations.jin.gold;
    diplomacyTick(st);
    expect(st.nations.jin.gold - g0).toBe(Math.round(1000 * TRIBUTE_RATE));
    st.nations.jin.treaties.ongud.since = st.turn - 20;
    st.nations.ongud.relations.jin = 100; st.nations.jin.relations.ongud = 100;
    expect(annexChance(st, 'jin', 'ongud')).toBeGreaterThan(0.5);
    let ok = false;
    for (let i = 0; i < 10 && !ok; i++) ok = annexVassal(st, 'jin', 'ongud').ok;
    expect(ok).toBe(true);
    expect(st.provinces.ong.owner).toBe('jin');
  });
  it('a hegemon triggers coalitions', () => {
    const st = newGame({ seed: 7 });
    for (const p of ['kiy', 'ker', 'mer', 'tat', 'nai', 'ong', 'ly', 'hn', 'uig', 'gan', 'ty']) st.provinces[p].owner = 'jin';
    for (const g of Object.values(st.generals)) if (g.nation === 'jin' && g.unit) g.unit.soldiers = 5000;
    expect(hegemon(st)).toBe('jin');
    const r0 = st.nations.xia.relations.jin;
    for (let i = 0; i < 5; i++) aiDiplomacy(st, 'xia');
    expect(st.nations.xia.relations.jin).toBeLessThan(r0);
    expect(st.nations.xia.coalition).toBe('jin');
  });
  it('long games keep a consistent diplomatic state', async () => {
    const st = newGame({ seed: 8 });
    const hooks = { battle: async (b) => autoResolve(b), proposal: async () => false, callToArms: async () => false };
    for (let i = 0; i < 40; i++) await endTurn(st, hooks);
    for (const n of Object.values(st.nations)) {
      if (!n.alive) continue;
      for (const [b, t] of Object.entries(n.treaties)) {
        expect(st.nations[b].treaties[n.id]?.type).toBe(t.type);
        expect(atWar(st, n.id, b)).toBe(false); // 条約国とは戦争しない
      }
      for (const b of Object.keys(n.wars || {})) expect(atWar(st, b, n.id)).toBe(true);
    }
  }, 60000);
});
