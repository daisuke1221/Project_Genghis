import { describe, it, expect } from 'vitest';
import { newGame, nationProvinces, ruler, serialize, deserialize, generalsIn } from '../src/game/state.js';
import { SCENARIOS, DEATH_YEAR } from '../src/game/scenarios.js';
import { endTurn } from '../src/game/turn.js';
import { autoResolve } from '../src/game/battle.js';
import { PROVINCES } from '../src/game/data.js';

const hooks = { battle: async (b) => autoResolve(b), proposal: async () => false };

describe('シナリオ', () => {
  for (const sc of SCENARIOS) {
    describe(sc.title, () => {
      const st = newGame({ scenario: sc.id, seed: 5 });
      it('starts in the scenario year with a valid setup', () => {
        expect(st.year).toBe(sc.year);
        expect(st.scenario).toBe(sc.id);
        expect(st.nations[sc.recommended]?.alive).toBe(true);
        for (const n of Object.values(st.nations)) {
          const r = ruler(st, n.id);
          expect(r?.alive).toBe(true);
          expect(r.nation).toBe(n.id);
          expect(st.year - r.birth).toBeGreaterThanOrEqual(15);
          expect(nationProvinces(st, n.id).length).toBeGreaterThan(0);
          for (const p of nationProvinces(st, n.id)) expect(generalsIn(st, p.id, n.id).length).toBeGreaterThan(0);
        }
        // 各地方の持ち主は存在する勢力
        for (const p of PROVINCES) {
          const o = st.provinces[p.id].owner;
          if (o) expect(st.nations[o]).toBeTruthy();
        }
      });
      it('excludes people who died before the start year', () => {
        for (const g of Object.values(st.generals).filter((x) => x.named)) {
          const d = DEATH_YEAR[g.name];
          if (d !== undefined && sc.year > 1189) expect(d).toBeGreaterThanOrEqual(sc.year);
        }
      });
      it('runs 20 turns', async () => {
        const s = newGame({ scenario: sc.id, seed: 9 });
        for (let i = 0; i < 20 && !s.over; i++) await endTurn(s, hooks);
        expect(Object.values(s.nations).some((n) => n.alive)).toBe(true);
      }, 30000);
    });
  }
  it('1206: Mongolia is unified under Chinggis Khan', () => {
    const st = newGame({ scenario: 's1206', seed: 1 });
    expect(ruler(st, 'kiyat').name).toBe('チンギス・カン');
    expect(st.nations.kiyat.name).toBe('モンゴル帝国');
    for (const p of ['kiy', 'ker', 'mer', 'tat', 'nai']) expect(st.provinces[p].owner).toBe('kiyat');
    expect(st.nations.kereit).toBeUndefined();
    expect(st.provinces.byz.owner).toBe('latin');
    expect(st.provinces.ind.owner).toBe('delhi');
  });
  it('1219: Mongols and Khwarezm face each other', () => {
    const st = newGame({ scenario: 's1219', seed: 1 });
    expect(nationProvinces(st, 'kiyat').length).toBe(12);
    expect(st.provinces.jz.owner).toBe('kiyat');
    expect(st.provinces.sam.owner).toBe('khwarezm');
    expect(Object.values(st.generals).find((g) => g.name === '耶律楚材').nation).toBe('kiyat');
    expect(st.nations.kiyat.relations.khwarezm).toBeLessThan(-50);
  });
  it('keeps the scenario through save/load and allows another player nation', () => {
    const st = newGame({ scenario: 's1219', playerNation: 'khwarezm', seed: 2 });
    const st2 = deserialize(serialize(st));
    expect(st2.scenario).toBe('s1219');
    expect(st2.playerNation).toBe('khwarezm');
  });
});
