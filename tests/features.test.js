import { describe, it, expect } from 'vitest';
import { newGame, serialize, deserialize, generalsIn, treaty } from '../src/game/state.js';
import { cityYields, startBuild, tileAt, GRID } from '../src/game/city.js';
import { endTurn } from '../src/game/turn.js';
import { autoResolve } from '../src/game/battle.js';
import { consortsOf, marryToVassal, requestBride, royalTick, birthChance } from '../src/game/royal.js';
import { genTech, hireTech, techsIn, availableTechs } from '../src/game/tech.js';
import { routeQuote, createRoute, tradeTick, priceAt, DIST } from '../src/game/trade.js';
import '../src/game/diplomacy.js';

const hooks = { battle: async (b) => autoResolve(b), proposal: async () => false };

function freeTile(st, pid, kinds = ['grass']) {
  const c = st.provinces[pid].city;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const t = tileAt(c, x, y);
    if (kinds.includes(t.t) && !t.b) return [x, y];
  }
  return null;
}

describe('後宮・王族', () => {
  it('Temujin starts with Börte and daughters', () => {
    const st = newGame({ seed: 1 });
    const r = st.nations.kiyat.rulerId;
    expect(consortsOf(st, r).map((c) => c.name)).toContain('ボルテ');
    expect(Object.values(st.princesses).filter((p) => p.nation === 'kiyat').length).toBeGreaterThanOrEqual(3);
  });
  it('children are born over time', () => {
    const st = newGame({ seed: 2 });
    const before = Object.keys(st.princesses).length + Object.keys(st.generals).length;
    for (let i = 0; i < 40; i++) { royalTick(st); st.season = (st.season + 1) % 4; if (!st.season) st.year++; }
    expect(Object.keys(st.princesses).length + Object.keys(st.generals).length).toBeGreaterThan(before);
  });
  it('visiting raises birth chance', () => {
    const st = newGame({ seed: 3 });
    const c = consortsOf(st, st.nations.kiyat.rulerId)[0];
    const base = birthChance(st, c);
    c.visited = st.turn;
    expect(birthChance(st, c)).toBeGreaterThan(base);
  });
  it('marrying a daughter to a vassal makes him fully loyal family', () => {
    const st = newGame({ seed: 4 });
    const p = Object.values(st.princesses).find((x) => x.name === 'コアジン');
    st.year = 1196; // 18歳
    const g = generalsIn(st, 'kiy', 'kiyat').find((x) => !x.family);
    g.loyalty = 50;
    expect(marryToVassal(st, p.id, g.id).ok).toBe(true);
    expect(g.loyalty).toBe(100);
    expect(g.family).toBe(true);
  });
  it('a bride request can create a marriage alliance', () => {
    let done = false;
    for (let s = 0; s < 20 && !done; s++) {
      const st = newGame({ seed: 50 + s });
      st.nations.kiyat.relations.kereit = 100; st.nations.kereit.relations.kiyat = 100;
      st.year = 1206; // ソルカクタニが適齢に
      const r = requestBride(st, 'kiyat', 'kereit');
      if (r.ok) {
        done = true;
        expect(treaty(st, 'kiyat', 'kereit')).toBe('alliance');
        expect(consortsOf(st, st.nations.kiyat.rulerId).length).toBe(2);
      }
    }
    expect(done).toBe(true);
  });
});

describe('技術者', () => {
  it('a farmer technician increases food output', () => {
    const st = newGame({ seed: 6 });
    st.nations.kiyat.gold = 9999;
    const before = cityYields(st, 'kiy', 1).food;
    const t = genTech(st, 'kiy', 'chinese');
    t.type = 'farmer'; t.level = 2;
    expect(hireTech(st, 'kiyat', t.id, 'kiy').ok).toBe(true);
    expect(techsIn(st, 'kiy').length).toBe(1);
    expect(cityYields(st, 'kiy', 1).food).toBeGreaterThan(before);
  });
  it('technicians in hostile far lands are not available', () => {
    const st = newGame({ seed: 7 });
    for (const t of availableTechs(st, 'kiyat')) {
      const owner = st.provinces[t.home].owner;
      expect(owner === 'kiyat' || owner === null || (st.nations.kiyat.relations[owner] ?? 0) >= 20 || !!st.nations.kiyat.treaties[owner]).toBe(true);
    }
  });
  it('an engineer allows siege recruitment without a workshop', async () => {
    const { recruitQuote } = await import('../src/game/military.js');
    const st = newGame({ seed: 8 });
    st.nations.kiyat.gold = 9999;
    const g = generalsIn(st, 'kiy', 'kiyat')[0];
    g.unit.soldiers = 0;
    expect(recruitQuote(st, g.id, 'siege', 200).ok).toBe(false);
    const t = genTech(st, 'kiy', 'chinese');
    t.type = 'engineer';
    hireTech(st, 'kiyat', t.id, 'kiy');
    expect(recruitQuote(st, g.id, 'siege', 200).ok).toBe(true);
  });
});

describe('交易', () => {
  it('goods are more expensive far from their source', () => {
    const st = newGame({ seed: 9 });
    const far = Object.entries(DIST['絹']).sort((a, b) => b[1] - a[1])[0][0];
    expect(priceAt(st, far, '絹')).toBeGreaterThan(priceAt(st, 'song', '絹'));
  });
  it('a caravan route earns gold each season', () => {
    const st = newGame({ seed: 10 });
    st.nations.jin.gold = 9999;
    const spot = freeTile(st, 'kf', ['grass', 'sand']);
    startBuild(st, 'kf', ...spot, 'caravan');
    tileAt(st.provinces.kf.city, ...spot).b.progress = 1;
    // 自領内の遠い都市へ
    const q = routeQuote(st, 'jin', 'kf', 'hn');
    expect(q.ok).toBe(true);
    expect(q.profit).toBeGreaterThan(0);
    expect(createRoute(st, 'jin', 'kf', 'hn').ok).toBe(true);
    st.provinces.kf.city.goods = { 陶磁器: 100 };
    const g0 = st.nations.jin.gold;
    st.rng = 12345;
    tradeTick(st);
    expect(st.routes[0].last).toBeTruthy();
    if (!st.routes[0].last.raided) expect(st.nations.jin.gold).toBeGreaterThan(g0);
  });
});

describe('セーブ互換', () => {
  it('migrates v1 saves', () => {
    const st = newGame({ seed: 11 });
    const old = JSON.parse(serialize(st));
    delete old.consorts; delete old.princesses; delete old.techs; delete old.market; delete old.routes; delete old.nextId;
    old.version = 1;
    const st2 = deserialize(JSON.stringify(old));
    expect(st2.version).toBe(2);
    expect(Object.keys(st2.consorts).length).toBeGreaterThan(0);
    expect(st2.routes).toEqual([]);
  });
  it('full game with new systems runs 40 turns', async () => {
    const st = newGame({ seed: 77 });
    for (let i = 0; i < 40 && !st.over; i++) await endTurn(st, hooks);
    for (const n of Object.values(st.nations)) expect(Number.isFinite(n.gold)).toBe(true);
    const routes = st.routes.length, techs = Object.values(st.techs).filter((t) => t.nation).length;
    console.log('AI routes', routes, 'hired techs', techs, 'princesses', Object.keys(st.princesses).length, 'consorts', Object.keys(st.consorts).length);
  }, 60000);
});
