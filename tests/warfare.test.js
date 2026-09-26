import { describe, it, expect } from 'vitest';
import { newGame, generalsIn } from '../src/game/state.js';
import { createBattle, damageFactors, defenseFactors, reachable, hexNeighbors } from '../src/game/battle.js';
import { recruitQuote } from '../src/game/military.js';
import { executeMove, gatherReinforcements } from '../src/game/actions.js';
import { changeOwner } from '../src/game/military.js';
import {
  unitAvailable, marchPaths, isSeaLink, supplyTick, fatigueTick, addFatigue, mercOffers, hireMerc, mercTick,
} from '../src/game/warfare.js';

const battle = (st, att = 'kiyat', from = 'kiy', to = 'tat') => createBattle(st, { attNation: att, attIds: generalsIn(st, from, att).map((g) => g.id), provinceId: to, fromProvince: from });
const addBarracks = (st, pid) => { const t = st.provinces[pid].city.grid.find((x) => !x.b && x.t === 'grass'); t.b = { type: 'barracks', level: 1, progress: 1 }; };

describe('固有兵種', () => {
  it('only the right culture with barracks can raise them', () => {
    const st = newGame({ seed: 2, playerNation: 'kiyat' });
    expect(unitAvailable(st, 'kiyat', 'knight').ok).toBe(false);
    addBarracks(st, 'kiy');
    expect(unitAvailable(st, 'kiyat', 'keshig', 'kiy').ok).toBe(true);
    const g = generalsIn(st, 'kiy', 'kiyat')[0];
    g.unit = null;
    st.nations.kiyat.gold = 9999;
    expect(recruitQuote(st, g.id, 'knight', 100).ok).toBe(false);
    expect(recruitQuote(st, g.id, 'keshig', 100).ok).toBe(true);
  });

  it('knights charge harder, elephants scare horses, crossbows ignore rain and walls', () => {
    const st = newGame({ seed: 2, playerNation: 'tatar' });
    const b = battle(st);
    const a = b.units.find((u) => u.side === 'att'), t = b.units.find((u) => u.side === 'def');
    const [c, r] = hexNeighbors(t.c, t.r).find(([x, y]) => b.tiles[y * 13 + x].t === 'plain') ?? hexNeighbors(t.c, t.r)[0];
    b.tiles[r * 13 + c].t = 'plain';
    b.formation = { att: 'gyorin', def: 'gyorin' };
    a.traits = []; a.fatigue = 0;
    a.type = 'cav';
    const cav = damageFactors(b, a, t, [c, r], 3).mul;
    a.type = 'knight';
    expect(damageFactors(b, a, t, [c, r], 3).mul).toBeGreaterThan(cav * 1.1);
    t.type = 'elephant';
    expect(damageFactors(b, a, t, [c, r], 0).factors.some(([l]) => l.includes('象'))).toBe(true);
    b.weather = 'rain';
    a.type = 'arch';
    const far = [t.c, Math.max(0, t.r - 2)];
    const bow = damageFactors(b, a, t, far, 0).mul;
    a.type = 'crossbow';
    expect(damageFactors(b, a, t, far, 0).mul).toBeGreaterThan(bow);
  });
});

describe('陣形', () => {
  it('formations change attack, defense and movement', () => {
    const st = newGame({ seed: 2, playerNation: 'tatar' });
    const b = battle(st);
    const a = b.units.find((u) => u.side === 'att'), t = b.units.find((u) => u.side === 'def');
    b.formation = { att: 'gyorin', def: 'gyorin' };
    const d0 = defenseFactors(b, t).mul;
    b.formation.def = 'houen';
    expect(defenseFactors(b, t).mul).toBeGreaterThan(d0);
    const m0 = reachable(b, a).size;
    b.formation.att = 'choda';
    expect(reachable(b, a).size).toBeGreaterThanOrEqual(m0);
    const hit = (f) => { b.formation.att = f; return damageFactors(b, a, t, hexNeighbors(t.c, t.r)[0], 0).mul; };
    expect(hit('hoshi')).toBeGreaterThan(hit('gyorin'));
  });
});

describe('遠征と渡海', () => {
  it('armies march through own land to strike further away', () => {
    const st = newGame({ seed: 2, playerNation: 'jin' });
    const mp = marchPaths(st, 'jin', 'kf', generalsIn(st, 'kf', 'jin').map((g) => g.id));
    const far = mp.targets.find((q) => mp.info[q].dist === 2 && st.provinces[q].owner !== 'jin');
    expect(far).toBeTruthy();
    const path = mp.path(far);
    expect(path[0]).toBe('kf');
    expect(path.length).toBe(3);
  });

  it('the sea cannot be crossed in winter', () => {
    const st = newGame({ seed: 2, playerNation: 'goryeo' });
    expect(isSeaLink('kor', 'kyu')).toBe(true);
    const ids = generalsIn(st, 'kor', 'goryeo').map((g) => g.id);
    expect(marchPaths(st, 'goryeo', 'kor', ids).targets).toContain('kyu');
    st.season = 3;
    expect(marchPaths(st, 'goryeo', 'kor', ids).targets).not.toContain('kyu');
  });

  it('a multi-step march stages the army next to the target', async () => {
    const st = newGame({ seed: 2, playerNation: 'kiyat' });
    const mp = marchPaths(st, 'jin', 'kf', generalsIn(st, 'kf', 'jin').map((g) => g.id));
    const own = mp.targets.find((q) => mp.info[q].dist === 2 && st.provinces[q].owner === 'jin');
    if (!own) return;
    const g = generalsIn(st, 'kf', 'jin')[0];
    const r = await executeMove(st, 'jin', [g.id], 'kf', own);
    expect(r.kind).toBe('move');
    expect(g.province).toBe(own);
    expect(g.fatigue).toBe(10);
  });
});

describe('補給線・疲労', () => {
  it('provinces cut off from the capital lose income and wear down troops', () => {
    const st = newGame({ seed: 2, playerNation: 'kiyat' });
    // 金の地方の間に割り込んで孤立させる
    changeOwner(st, 'ly', 'kiyat');
    supplyTick(st);
    expect(st.provinces.hn.cutoff).toBe(true);
    expect(st.provinces.jz.cutoff).toBe(false);
  });

  it('fatigue lowers morale and recovers with rest', () => {
    const st = newGame({ seed: 2, playerNation: 'tatar' });
    const g = generalsIn(st, 'kiy', 'kiyat')[0];
    const m0 = battle(st).units.find((u) => u.gid === g.id).morale;
    addFatigue(g, 80);
    const m1 = battle(st).units.find((u) => u.gid === g.id).morale;
    expect(m1).toBeLessThan(m0);
    g.moved = false;
    fatigueTick(st);
    expect(g.fatigue).toBe(60);
  });
});

describe('傭兵', () => {
  it('can be hired, draw wages, and leave when the contract ends', () => {
    const st = newGame({ seed: 2, playerNation: 'kiyat' });
    st.nations.kiyat.gold = 99999;
    const o = mercOffers(st, 'kiyat')[0];
    const r = hireMerc(st, 'kiyat', o.id, 'kiy');
    expect(r.ok).toBe(true);
    const g = r.general;
    expect(g.unit.soldiers).toBe(o.soldiers);
    const gold = st.nations.kiyat.gold;
    mercTick(st);
    expect(st.nations.kiyat.gold).toBe(gold - o.upkeep);
    st.turn += 9;
    mercTick(st);
    expect(g.nation).toBe(null);
  });
});

describe('迎撃', () => {
  it('generals in adjacent own provinces come to the defense', () => {
    const st = newGame({ seed: 2, playerNation: 'kiyat' });
    const src = 'ty';
    const gens = generalsIn(st, src, 'jin');
    if (gens.length < 2) return;
    for (const g of gens) if (g.unit) g.unit.soldiers = 2000;
    const ids = gatherReinforcements(st, 'jin', 'xia', 'jz', 2, true);
    expect(ids.length).toBeGreaterThan(0);
    expect(gatherReinforcements(st, 'jin', 'xia', 'jz', 2, false).length).toBe(0);
  });
});
