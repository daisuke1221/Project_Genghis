import { describe, it, expect } from 'vitest';
import { newGame, relation, serialize, deserialize } from '../src/game/state.js';
import { adminMods, nationReligion } from '../src/game/admin.js';
import { changeOwner } from '../src/game/military.js';
import { atWar } from '../src/game/diplomacy.js';
import { bonds } from '../src/game/statecraft.js';
import {
  seatOf, protectorOf, pietyOf, donate, excommunicate, isBanned, doPenance, penanceCost, faithTick, holyWarTurn,
  holyWarTargets, callHolyWar, canCallHolyWar, activeHolyWar, convertNation, conversionOptions,
} from '../src/game/faith.js';

const game = (p = 'hre') => newGame({ seed: 5, playerNation: p });

describe('座所と保護者', () => {
  it('each authority sits in its historical seat', () => {
    const st = game();
    expect(protectorOf(st, 'catholic')).toBe('hre');
    expect(protectorOf(st, 'islam')).toBe('abbasid');
    expect(protectorOf(st, 'orthodox')).toBe('byzantium');
    expect(protectorOf(st, 'buddhism')).toBe('tibet');
  });

  it('when an infidel takes the seat, the authority flees and the faithful are enraged', async () => {
    const st = game('kiyat');
    const r0 = relation(st, 'ayyubid', 'kiyat');
    changeOwner(st, 'irq', 'kiyat');
    faithTick(st);
    expect(seatOf(st, 'islam')).toBe('egy');
    expect(protectorOf(st, 'islam')).toBe('ayyubid');
    expect(relation(st, 'ayyubid', 'kiyat')).toBeLessThan(r0 - 20);
    expect(st.chronicle.some((c) => c.title === 'バグダードの陥落')).toBe(true);
    await holyWarTurn(st, { proposal: async () => false });
    const hw = activeHolyWar(st, 'islam');
    expect(hw?.target).toBe('kiyat');
    expect(hw.name).toContain('ジハード');
  });
});

describe('信任・寄進・破門', () => {
  it('donations raise piety, pay the protector and improve loyalty', () => {
    const st = game('france');
    const l0 = adminMods(st, 'fra').loyaltyAdj;
    const g0 = st.nations.hre.gold;
    const p0 = pietyOf(st, 'france');
    st.nations.france.gold = 5000;
    expect(donate(st, 'france', 1000).ok).toBe(true);
    expect(pietyOf(st, 'france')).toBeGreaterThan(p0 + 15);
    expect(st.nations.hre.gold).toBe(g0 + 300);
    expect(adminMods(st, 'fra').loyaltyAdj).toBeGreaterThan(l0);
  });

  it('excommunication hurts loyalty and diplomacy until penance', () => {
    const st = game('france');
    expect(excommunicate(st, 'france')).toBe(true);
    expect(isBanned(st, 'france')).toBe(true);
    expect(adminMods(st, 'fra').loyalty.some(([l, v]) => l === '破門' && v === -10)).toBe(true);
    expect(bonds(st, 'england', 'france').some(([l]) => l === '破門')).toBe(true);
    expect(donate(st, 'france', 200).ok).toBe(false);
    st.nations.france.gold = penanceCost(st, 'france');
    expect(doPenance(st, 'france').ok).toBe(true);
    expect(isBanned(st, 'france')).toBe(false);
  });

  it('the protector cannot be excommunicated', () => {
    const st = game();
    expect(excommunicate(st, 'hre')).toBe(false);
  });

  it('survives save and load', () => {
    const st = game('france');
    excommunicate(st, 'france');
    const st2 = deserialize(serialize(st));
    expect(isBanned(st2, 'france')).toBe(true);
    expect(protectorOf(st2, 'catholic')).toBe('hre');
  });
});

describe('聖戦', () => {
  it('the protector of Rome can call a crusade for the Holy Land', async () => {
    const st = game('hre');
    st.faith.catholic.next = 0;
    st.nations.hre.gold = 5000;
    const ts = holyWarTargets(st, 'catholic');
    expect(ts[0].target).toBe('ayyubid');
    expect(canCallHolyWar(st, 'hre', 'ayyubid').ok).toBe(true);
    const r = await callHolyWar(st, 'hre', 'ayyubid', {});
    expect(r.ok).toBe(true);
    expect(atWar(st, 'hre', 'ayyubid')).toBe(true);
    expect(r.hw.members).toContain('hre');
    expect(canCallHolyWar(st, 'hre', 'ayyubid').ok).toBe(false);
    // 聖地を取れば成就
    const p0 = pietyOf(st, 'hre');
    changeOwner(st, 'syr', 'hre');
    faithTick(st);
    expect(r.hw.over).toBe('won');
    expect(pietyOf(st, 'hre')).toBeGreaterThan(p0);
  });

  it('a player invited to a holy war is asked', async () => {
    const st = game('france');
    st.faith.catholic.next = 0;
    let asked = null;
    for (let i = 0; i < 40 && !asked; i++) await holyWarTurn(st, { proposal: async (pr) => { asked = pr; return true; } });
    expect(asked?.kind).toBe('holywar');
    expect(atWar(st, 'france', asked.target)).toBe(true);
  });
});

describe('国教の改宗', () => {
  it('a nation can adopt the faith of most of its subjects', () => {
    const st = game('kiyat');
    expect(conversionOptions(st, 'kiyat')).toEqual([]);
    for (const p of Object.values(st.provinces)) if (p.owner === 'kiyat') p.religion = 'buddhism';
    expect(conversionOptions(st, 'kiyat')[0].rel).toBe('buddhism');
    expect(convertNation(st, 'kiyat', 'buddhism').ok).toBe(true);
    expect(nationReligion(st, 'kiyat')).toBe('buddhism');
    expect(convertNation(st, 'kiyat', 'buddhism').ok).toBe(false);
  });
});
