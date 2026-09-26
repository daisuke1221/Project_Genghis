import { describe, it, expect } from 'vitest';
import { newGame, generalsIn, canAttack, treaty, relation } from '../src/game/state.js';
import { acceptChance, propose, breakTreaty, sign, diplomacyTick, declareWar } from '../src/game/diplomacy.js';
import { routeQuote } from '../src/game/trade.js';
import {
  personality, bonds, isRival, trustOf, hasPact, signPact, signTribute, candidateHostages, hostagesFrom,
  dealChance, proposeDeal, tradeableProvinces, provinceValue, joinSummit, statecraftTick,
} from '../src/game/statecraft.js';

const game = (p = 'kiyat', seed = 4) => newGame({ seed, playerNation: p });

describe('気質と因縁', () => {
  it('personality follows the ruler', () => {
    const st = game();
    const r = st.generals[st.nations.kiyat.rulerId];
    r.traits = ['loyal'];
    expect(personality(st, 'kiyat')).toBe('honorable');
    r.traits = ['ambitious'];
    expect(personality(st, 'kiyat')).toBe('treacherous');
    r.traits = [];
    st.nations.kiyat.aggro = 0.9;
    expect(personality(st, 'kiyat')).toBe('warlike');
  });

  it('historic rivals start hostile and are harder to befriend', () => {
    const st = game();
    expect(isRival('kiyat', 'tatar')).toBe(true);
    expect(relation(st, 'kiyat', 'tatar')).toBeLessThan(relation(st, 'kiyat', 'kereit'));
    expect(bonds(st, 'tatar', 'kiyat').some(([l]) => l === '宿敵')).toBe(true);
    expect(bonds(st, 'kereit', 'kiyat').some(([l]) => l === '同族')).toBe(true);
    st.nations.tatar.relations.kiyat = st.nations.kiyat.relations.tatar = 50;
    st.nations.kereit.relations.kiyat = st.nations.kiyat.relations.kereit = 50;
    st.nations.tatar.aggro = st.nations.kereit.aggro = 0.5;
    expect(acceptChance(st, 'tatar', 'kiyat', 'alliance')).toBeLessThan(acceptChance(st, 'kereit', 'kiyat', 'alliance'));
  });
});

describe('信用', () => {
  it('breaking a treaty costs trust and makes others less willing', () => {
    const st = game();
    st.nations.kereit.relations.kiyat = st.nations.kiyat.relations.kereit = 40;
    const before = acceptChance(st, 'kereit', 'kiyat', 'alliance');
    sign(st, 'kiyat', 'ongud', 'alliance');
    breakTreaty(st, 'kiyat', 'ongud');
    expect(trustOf(st, 'kiyat')).toBe(35);
    expect(acceptChance(st, 'kereit', 'kiyat', 'alliance')).toBeLessThan(before);
    for (let i = 0; i < 20; i++) { st.turn += 1; statecraftTick(st); }
    expect(trustOf(st, 'kiyat')).toBeGreaterThan(35);
  });
});

describe('人質', () => {
  it('a hostage makes acceptance likelier, leaves the field, and dies if the giver breaks faith', () => {
    const st = game();
    const h = candidateHostages(st, 'kiyat').find((g) => g.family) ?? candidateHostages(st, 'kiyat')[0];
    const p0 = acceptChance(st, 'kereit', 'kiyat', 'alliance');
    expect(acceptChance(st, 'kereit', 'kiyat', 'alliance', h)).toBeGreaterThan(p0);
    st.nations.kereit.relations.kiyat = st.nations.kiyat.relations.kereit = 100;
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) ok = propose(st, 'kiyat', 'kereit', 'alliance', h.id).ok;
    expect(ok).toBe(true);
    expect(h.hostageOf).toBe('kereit');
    expect(generalsIn(st, h.province, 'kiyat').includes(h)).toBe(false);
    expect(hostagesFrom(st, 'kiyat', 'kereit')).toContain(h);
    breakTreaty(st, 'kiyat', 'kereit');
    expect(h.alive).toBe(false);
  });

  it('hostages come home when the holder breaks the treaty', () => {
    const st = game();
    const h = candidateHostages(st, 'kiyat')[0];
    sign(st, 'kiyat', 'kereit', 'truce');
    h.hostageOf = 'kereit'; h.province = st.nations.kereit.capital;
    breakTreaty(st, 'kereit', 'kiyat');
    expect(h.alive).toBe(true);
    expect(h.hostageOf).toBeUndefined();
    expect(h.province).toBe(st.nations.kiyat.capital);
  });
});

describe('通商条約と朝貢', () => {
  it('a trade pact removes tariffs, boosts profit and warms relations; war ends it', () => {
    const st = game('jin');
    const from = 'kf';
    const to = Object.keys(st.provinces).find((p) => st.provinces[p].owner === 'song' && routeQuote(st, 'jin', from, p).ok);
    if (!to) return;
    const q0 = routeQuote(st, 'jin', from, to);
    signPact(st, 'jin', 'song');
    const q1 = routeQuote(st, 'jin', from, to);
    expect(q1.tariff).toBe(0);
    expect(q1.profit).toBeGreaterThan(q0.profit);
    const r0 = relation(st, 'jin', 'song');
    diplomacyTick(st);
    expect(relation(st, 'jin', 'song')).toBeGreaterThanOrEqual(r0);
    declareWar(st, 'jin', 'song');
    expect(hasPact(st, 'jin', 'song')).toBe(false);
  });

  it('tributaries pay each season and cannot be attacked', () => {
    const st = game('jin');
    signTribute(st, 'jin', 'xia');
    expect(canAttack(st, 'jin', 'xia')).toBe(false);
    st.nations.xia.lastIncome = { gold: 1000, food: 0 };
    const g0 = st.nations.jin.gold;
    statecraftTick(st);
    expect(st.nations.jin.gold).toBe(g0 + 100);
    expect(treaty(st, 'xia', 'jin')).toBe('tribute');
  });
});

describe('取引', () => {
  it('a fair gold-for-province deal can go through; a lopsided one is refused', () => {
    const st = game('jin');
    const prov = tradeableProvinces(st, 'song', 'jin')[0];
    const val = provinceValue(st, prov);
    st.nations.jin.gold = val * 5;
    st.nations.song.relations.jin = st.nations.jin.relations.song = 50;
    const cheap = { give: { gold: 100 }, get: { province: prov } };
    const rich = { give: { gold: Math.min(st.nations.jin.gold, Math.round(val * 3)) }, get: { province: prov } };
    expect(dealChance(st, 'jin', 'song', cheap)).toBeLessThan(0.1);
    expect(dealChance(st, 'jin', 'song', rich)).toBeGreaterThan(0.5);
    let done = false;
    for (let i = 0; i < 20 && !done; i++) done = proposeDeal(st, 'jin', 'song', rich).accepted;
    expect(done).toBe(true);
    expect(st.provinces[prov].owner).toBe('jin');
  });
});

describe('会盟', () => {
  it('joining a summit allies with all members', () => {
    const st = game('kiyat');
    joinSummit(st, 'kiyat', ['kereit', 'ongud'], 'jin', sign);
    expect(treaty(st, 'kiyat', 'kereit')).toBe('alliance');
    expect(treaty(st, 'kiyat', 'ongud')).toBe('alliance');
    expect(st.nations.kiyat.coalition).toBe('jin');
  });
});
