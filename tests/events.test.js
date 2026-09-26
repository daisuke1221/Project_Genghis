import { describe, it, expect } from 'vitest';
import { newGame, nationProvinces, ruler } from '../src/game/state.js';
import { EVENTS, runEvents, gen, eventDue } from '../src/game/events.js';
import { endTurn } from '../src/game/turn.js';
import { autoResolve } from '../src/game/battle.js';

const hooks = { battle: async (b) => autoResolve(b), proposal: async () => false };
const ev = (id) => EVENTS.find((e) => e.id === id);

describe('史実イベント', () => {
  it('every event has the required fields and unique ids', () => {
    const ids = new Set();
    for (const e of EVENTS) {
      expect(ids.has(e.id)).toBe(false); ids.add(e.id);
      expect(typeof e.when).toBe('function');
      expect(typeof e.ai).toBe('function');
      expect(e.minYear).toBeLessThanOrEqual(e.maxYear);
    }
  });
  it('奥州合戦 fires for AI Kamakura in 1189 summer and Yoshitsune dies', async () => {
    const st = newGame({ seed: 1, playerNation: 'kiyat' });
    st.season = 1;
    await runEvents(st, {});
    expect(st.firedEvents).toContain('oshu_war');
    expect(gen(st, '源義経')).toBeNull();
    expect(st.chronicle.length).toBeGreaterThan(0);
  });
  it('player choices are respected', async () => {
    const st = newGame({ seed: 2, playerNation: 'oshu' });
    st.season = 1;
    await runEvents(st, { event: async () => 1 }); // 義経を守る
    expect(gen(st, '源義経')?.loyalty).toBe(100);
    expect(st.nations.oshu.relations.kamakura).toBeLessThan(-50);
  });
  it('does not kill the player\'s own people', async () => {
    const st = newGame({ seed: 3, playerNation: 'hre' });
    st.year = 1190; st.season = 1;
    await runEvents(st, {});
    expect(gen(st, 'フリードリヒ')).not.toBeNull();
  });
  it('クリルタイ crowns a Mongol ruler who unifies the plateau', async () => {
    const st = newGame({ seed: 4 });
    for (const p of ['ker', 'mer', 'tat', 'nai']) st.provinces[p].owner = 'kiyat';
    await runEvents(st, {});
    expect(st.nations.kiyat.name).toBe('モンゴル帝国');
    expect(ruler(st, 'kiyat').name).toBe('チンギス・カン');
  });
  it('第4回十字軍 creates the Latin Empire', async () => {
    const st = newGame({ seed: 5, playerNation: 'kiyat' });
    st.year = 1204; st.season = 1;
    await runEvents(st, {});
    expect(st.provinces.byz.owner).toBe('latin');
    expect(st.nations.latin.alive).toBe(true);
    expect(ruler(st, 'latin').alive).toBe(true);
    expect(nationProvinces(st, 'latin').length).toBe(1);
  });
  it('can be switched off', async () => {
    const st = newGame({ seed: 6 });
    st.options.historyEvents = false;
    st.season = 1;
    await runEvents(st, {});
    expect(st.firedEvents ?? []).toHaveLength(0);
  });
  it('events fire only once and games keep running (1206 scenario, 30 turns)', async () => {
    const st = newGame({ scenario: 's1206', seed: 7 });
    for (let i = 0; i < 30 && !st.over; i++) await endTurn(st, hooks);
    expect(new Set(st.firedEvents).size).toBe(st.firedEvents.length);
    for (const e of EVENTS) if (st.firedEvents.includes(e.id)) expect(eventDue(st, e)).toBe(false);
    console.log('fired', st.firedEvents.join(','));
  }, 60000);
});
