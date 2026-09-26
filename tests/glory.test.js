import { describe, it, expect } from 'vitest';
import { newGame, nationProvinces, serialize, deserialize } from '../src/game/state.js';
import { changeOwner } from '../src/game/military.js';
import { checkGameOver, seasonTick, advanceTime } from '../src/game/turn.js';
import { loyaltyTarget } from '../src/game/personnel.js';
import { fame } from '../src/game/talent.js';
import {
  REGIONS, REGION_OF, regionsHeld, canClaimTitle, claimTitle, tierOf, titleName, gloryTick, checkVictory, deadlineYear, ending,
} from '../src/game/glory.js';
import { recordHistory, series, ranking, peakOf } from '../src/game/history.js';
import { PROVINCES } from '../src/game/data.js';

const game = (p = 'kiyat', victory = 'unify') => newGame({ seed: 3, playerNation: p, victory });
const take = (st, nid, pids) => { for (const p of pids) changeOwner(st, p, nid); };

describe('地域', () => {
  it('every province belongs to exactly one region', () => {
    expect(Object.keys(REGION_OF).length).toBe(PROVINCES.length);
    for (const p of PROVINCES) expect(REGION_OF[p.id]).toBeTruthy();
  });

  it('holding every province of a region pacifies it', () => {
    const st = game();
    take(st, 'kiyat', REGIONS.mongolia.provs);
    expect(regionsHeld(st, 'kiyat')).toContain('mongolia');
    gloryTick(st);
    expect(st.pacified.mongolia).toBe('kiyat');
    expect(st.chronicle.some((c) => c.title === 'モンゴル高原平定')).toBe(true);
  });
});

describe('称号', () => {
  it('titles need land, regions and gold, and raise loyalty and fame', () => {
    const st = game();
    const n = st.nations.kiyat;
    n.gold = 10000;
    expect(titleName(st, 'kiyat')).toBe('ベキ');
    expect(canClaimTitle(st, 'kiyat').ok).toBe(false);
    take(st, 'kiyat', REGIONS.mongolia.provs);
    take(st, 'kiyat', ['gan', 'xia']);
    const g = Object.values(st.generals).find((x) => x.nation === 'kiyat' && x.id !== n.rulerId && !x.family);
    const l0 = loyaltyTarget(st, g).target;
    const f0 = fame(st, 'kiyat');
    const r = claimTitle(st, 'kiyat');
    expect(r.ok).toBe(true);
    expect(claimTitle(st, 'kiyat').ok).toBe(false); // 20地方と3地域が必要
    expect(titleName(st, 'kiyat')).toBe('ハン');
    expect(loyaltyTarget(st, g).target).toBeGreaterThan(l0);
    expect(fame(st, 'kiyat')).toBeGreaterThan(f0);
  });

  it('historic empires start with a higher title', () => {
    const st = game();
    expect(titleName(st, 'song')).toBe('皇帝');
    expect(tierOf(st, 'byzantium')).toBe(3);
    expect(titleName(st, 'england')).toBe('王');
    expect(titleName(st, 'kamakura')).toBe('征夷大将軍');
  });
});

describe('勝利条件', () => {
  it('hegemony: four pacified regions win', () => {
    const st = game('kiyat', 'hegemony');
    take(st, 'kiyat', [...REGIONS.mongolia.provs, ...REGIONS.east.provs, ...REGIONS.orient.provs]);
    expect(checkVictory(st)).toBeNull();
    take(st, 'kiyat', REGIONS.steppe.provs);
    expect(checkGameOver(st)?.kind).toBe('hegemony');
  });

  it('deadline: the ranking decides at the end of the era', () => {
    const st = game('kiyat', 'deadline');
    st.year = deadlineYear(st);
    const over = checkVictory(st);
    expect(over.kind).toBe('deadline');
    expect(over.rank).toBe(ranking(st).findIndex((r) => r.nid === 'kiyat') + 1);
    expect(over.type).toBe(over.rank === 1 ? 'win' : 'end');
    const e = ending(st, over);
    expect(e.heading).toContain('時代');
  });

  it('unify still wins in any mode, and endings are written for the culture', () => {
    const st = game('kiyat', 'hegemony');
    take(st, 'kiyat', PROVINCES.slice(0, 40).map((p) => p.id));
    const over = checkVictory(st);
    expect(over.kind).toBe('unify');
    expect(ending(st, over).epi).toContain('パクス・モンゴリカ');
  });
});

describe('統計', () => {
  it('records every season and survives save and load', () => {
    const st = game();
    for (let i = 0; i < 2; i++) { seasonTick(st); advanceTime(st); recordHistory(st); }
    const s = series(st, 'kiyat', 'provs');
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.at(-1)).toBe(nationProvinces(st, 'kiyat').length);
    recordHistory(st); // 同じターンは二重に記録しない
    expect(series(st, 'kiyat', 'provs').length).toBe(s.length);
    const st2 = deserialize(serialize(st));
    expect(series(st2, 'kiyat', 'power').length).toBe(s.length);
    expect(peakOf(st2, 'kiyat', 'provs')).toBeGreaterThan(0);
  });
});
