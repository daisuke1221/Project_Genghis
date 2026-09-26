import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import { declareWar } from '../src/game/diplomacy.js';
import { changeOwner } from '../src/game/military.js';
import { executeMove } from '../src/game/actions.js';
import { adminMods } from '../src/game/admin.js';
import {
  buildShips, canBuildShips, shipsAt, navalSkill, seaCrossing, navyTick, seaControl, blockadedBy, sharedSea, PORT_CAP, BUILD_PER_SEASON,
} from '../src/game/navy.js';

const game = (p = 'goryeo') => newGame({ seed: 11, playerNation: p });

describe('造船', () => {
  it('ports can build ships up to the seasonal and port limits', () => {
    const st = game();
    st.nations.goryeo.gold = 100000;
    expect(canBuildShips(st, 'kf', 1).ok).toBe(false); // 港がない
    expect(buildShips(st, 'kor', BUILD_PER_SEASON).ok).toBe(true);
    expect(shipsAt(st, 'kor')).toBe(BUILD_PER_SEASON);
    expect(buildShips(st, 'kor', 1).ok).toBe(false);
    st.turn += 1;
    st.provinces.kor.fleet.ships = PORT_CAP;
    expect(buildShips(st, 'kor', 1).ok).toBe(false);
  });

  it('seafaring depends on culture and conquered ports', () => {
    const st = game('kiyat');
    const nomad = navalSkill(st, 'kiyat');
    expect(navalSkill(st, 'goryeo')).toBeGreaterThan(nomad);
    changeOwner(st, 'kor', 'kiyat');
    expect(navalSkill(st, 'kiyat')).toBeGreaterThan(nomad);
  });
});

describe('渡海と海戦', () => {
  it('an enemy fleet can turn back an unescorted invasion', () => {
    const st = game();
    declareWar(st, 'goryeo', 'kamakura');
    st.provinces.kyu.fleet = { ships: 40 };
    const gids = generalsIn(st, 'kor', 'goryeo').map((g) => g.id);
    const before = gids.reduce((s, id) => s + (st.generals[id].unit?.soldiers ?? 0), 0);
    st.season = 0; // 大風の季節を避ける
    const r = seaCrossing(st, 'goryeo', gids, 'kor', 'kyu');
    expect(sharedSea('kor', 'kyu')).toBe('east');
    expect(r.ok).toBe(false);
    expect(r.report.kind).toBe('naval');
    const after = gids.reduce((s, id) => s + (st.generals[id].unit?.soldiers ?? 0), 0);
    expect(after).toBeLessThan(before);
  });

  it('a strong escort wins the crossing', async () => {
    const st = game();
    declareWar(st, 'goryeo', 'kamakura');
    st.provinces.kyu.fleet = { ships: 5 };
    st.provinces.kor.fleet = { ships: 80 };
    st.season = 0;
    const gids = generalsIn(st, 'kor', 'goryeo').map((g) => g.id);
    const res = await executeMove(st, 'goryeo', gids, 'kor', 'kyu', {});
    expect(res.kind).not.toBe('naval');
    expect(shipsAt(st, 'kyu')).toBeLessThan(5);
  });

  it('typhoons can wreck invasions of Japan in summer and autumn', () => {
    let wrecked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const st = newGame({ seed, playerNation: 'goryeo' });
      st.season = 2;
      const gids = generalsIn(st, 'kor', 'goryeo').map((g) => g.id);
      if (seaCrossing(st, 'goryeo', gids, 'kor', 'kyu').report?.kind === 'typhoon') wrecked += 1;
    }
    expect(wrecked).toBeGreaterThan(0);
    expect(wrecked).toBeLessThan(20);
  });
});

describe('制海権と封鎖', () => {
  it('the strongest fleet controls the sea and blockades enemy ports', () => {
    const st = game();
    declareWar(st, 'goryeo', 'kamakura');
    st.provinces.kor.fleet = { ships: 60 };
    const g0 = adminMods(st, 'kyu').goldMul;
    for (let i = 0; i < 2; i++) navyTick(st);
    expect(seaControl(st, 'east')).toBe('goryeo');
    expect(blockadedBy(st, 'kyu')).toBe('goryeo');
    expect(adminMods(st, 'kyu').goldMul).toBeLessThan(g0);
  });
});
