import { describe, it, expect } from 'vitest';
import { newGame, addGeneral, generalsIn, serialize, deserialize } from '../src/game/state.js';
import { killGeneral } from '../src/game/military.js';
import { visit, consortsOf, marryToRuler, addPrincess } from '../src/game/royal.js';
import { breakTreaty, sign } from '../src/game/diplomacy.js';
import { trustOf } from '../src/game/statecraft.js';
import { loyaltyTarget } from '../src/game/personnel.js';
import { adminMods } from '../src/game/admin.js';
import '../src/game/events.js';
import {
  consortTrait, chiefOf, setChief, isLegit, currentHeir, designateHeir, disputeChance, assignTutor, educationYear,
  grantFief, courtTick,
} from '../src/game/court.js';

const game = (p = 'kiyat') => newGame({ seed: 6, playerNation: p });
const find = (st, name) => Object.values(st.generals).find((g) => g.name === name);

describe('妃の個性と正室', () => {
  it('named consorts have traits, the first is chief, and historic sons are legitimate heirs', () => {
    const st = game();
    const borte = Object.values(st.consorts).find((c) => c.name === 'ボルテ');
    expect(consortTrait(borte)).toBe('virtuous');
    expect(chiefOf(st, st.nations.kiyat.rulerId)).toBe(borte);
    const jochi = find(st, 'ジョチ');
    expect(isLegit(st, jochi)).toBe(true);
    expect(currentHeir(st, 'kiyat')).toBe(jochi);
  });

  it('jealous consorts sulk more when another is favored', () => {
    const st = game();
    const r = st.nations.kiyat.rulerId;
    const a = consortsOf(st, r)[0];
    const b = { ...a, id: 'cx', name: '妃B', trait: 'jealous', affection: 50, chief: false, visited: -1 };
    st.consorts.cx = b;
    visit(st, a.id);
    expect(b.affection).toBe(42);
  });

  it('changing the chief consort angers the old one', () => {
    const st = game();
    const r = st.nations.kiyat.rulerId;
    const old = chiefOf(st, r);
    st.consorts.cy = { ...old, id: 'cy', name: '妃C', chief: false, affection: 50, trait: 'gentle' };
    const a0 = old.affection;
    expect(setChief(st, 'cy').ok).toBe(true);
    expect(chiefOf(st, r).id).toBe('cy');
    expect(old.affection).toBe(a0 - 30);
  });
});

describe('後継ぎと跡目争い', () => {
  it('the designated heir succeeds; passed-over legitimate sons resent it', () => {
    const st = game();
    const tolui = find(st, 'トルイ'), jochi = find(st, 'ジョチ');
    jochi.birth = st.year - 25; tolui.birth = st.year - 18; // 成人した王子として
    const l0 = jochi.loyalty;
    expect(designateHeir(st, 'kiyat', tolui.id).ok).toBe(true);
    expect(jochi.loyalty).toBe(l0 - 15);
    killGeneral(st, st.nations.kiyat.rulerId);
    expect(st.nations.kiyat.rulerId).toBe(tolui.id);
  });

  it('an ambitious rival with a fief may rise in revolt', () => {
    const st = game('jin');
    const r = st.generals[st.nations.jin.rulerId];
    const mk = (name, birth) => { const g = addGeneral(st, { name, nation: 'jin', province: 'kf', birth, war: 80, lead: 80, pol: 50, cha: 50, loyalty: 60, family: true }); g.fatherId = r.id; return g; };
    const heir = mk('長男', st.year - 30), rival = mk('次男', st.year - 28);
    rival.traits = ['ambitious'];
    grantFief(st, rival.id, 'ty');
    expect(disputeChance(st, 'jin', heir, rival, false)).toBeGreaterThan(0.4);
    let revolt = false;
    for (let i = 0; i < 30 && !revolt; i++) {
      const s2 = deserialize(serialize(st));
      s2.rng = 1000 + i;
      s2.nations.jin.heirId = heir.id;
      killGeneral(s2, s2.nations.jin.rulerId);
      revolt = s2.provinces.ty.owner !== 'jin';
    }
    expect(revolt).toBe(true);
  });
});

describe('教育と封地', () => {
  it('a tutor raises a child toward his abilities', () => {
    const st = game();
    const r = st.generals[st.nations.kiyat.rulerId];
    const child = addGeneral(st, { name: '幼子', nation: 'kiyat', province: 'kiy', birth: st.year - 8, war: 30, lead: 30, pol: 30, cha: 30, family: true });
    child.fatherId = r.id; child.edu = 'martial';
    const t = find(st, 'スブタイ');
    assignTutor(st, child, t.id);
    st.nations.kiyat.gold = 5000;
    for (let i = 0; i < 5; i++) educationYear(st);
    expect(child.lead).toBeGreaterThan(45);
    expect(child.pol).toBe(30);
  });

  it('a royal fief raises the city loyalty target', () => {
    const st = game('jin');
    const g = generalsIn(st, 'kf', 'jin').find((x) => x.id !== st.nations.jin.rulerId);
    g.family = true;
    const before = adminMods(st, 'ty').loyaltyAdj;
    expect(grantFief(st, g.id, 'ty').ok).toBe(true);
    expect(adminMods(st, 'ty').loyaltyAdj).toBe(before + 6);
    expect(loyaltyTarget(st, g).items.some(([l]) => l === '封地')).toBe(true);
    expect(grantFief(st, g.id, st.nations.jin.capital).ok).toBe(false);
  });
});

describe('婚姻の重み', () => {
  it('breaking a marriage alliance costs extra trust and cools the consort', () => {
    const st = game('kiyat');
    const p = addPrincess(st, { name: '姫', nation: 'kereit', birth: st.year - 18, cha: 70, pol: 50 });
    st.nations.kereit.relations.kiyat = st.nations.kiyat.relations.kereit = 100;
    let ok = false;
    for (let i = 0; i < 20 && !ok; i++) ok = marryToRuler(st, p.id, 'kiyat').ok;
    expect(ok).toBe(true);
    expect(st.nations.kiyat.treaties.kereit.marriage).toBe(true);
    const c = Object.values(st.consorts).find((x) => x.name === '姫');
    const a0 = c.affection;
    breakTreaty(st, 'kiyat', 'kereit');
    expect(trustOf(st, 'kiyat')).toBe(60 - 25 - 10);
    expect(c.affection).toBe(Math.max(0, a0 - 30));
  });

  it('a nation whose line ends can pass to the husband of its princess', () => {
    const st = game('jin');
    const p = addPrincess(st, { name: '姫', nation: 'tatar', birth: st.year - 18, cha: 70, pol: 50 });
    p.married = { to: st.nations.kereit.rulerId, nation: 'kereit' };
    for (const g of Object.values(st.generals)) if (g.nation === 'tatar' && g.id !== st.nations.tatar.rulerId) g.alive = false;
    killGeneral(st, st.nations.tatar.rulerId);
    expect(st.provinces.tat.owner).toBe('kereit');
  });

  it('in-laws warm to a nation whose ruler loves their daughter', () => {
    const st = game('kiyat');
    sign(st, 'kiyat', 'kereit', 'truce');
    const c = consortsOf(st, st.nations.kiyat.rulerId)[0];
    c.origin = 'kereit'; c.affection = 90;
    const r0 = st.nations.kiyat.relations.kereit;
    st.turn = 2;
    courtTick(st);
    expect(st.nations.kiyat.relations.kereit).toBe(r0 + 1);
  });
});

import { destroyNation } from '../src/game/military.js';
import { widows, takeWidow } from '../src/game/royal.js';
import { brideCandidates, takeDomesticBride, vassalBrideCandidates, marryVassalDaughter } from '../src/game/court.js';

describe('妃を迎える', () => {
  it('a bride from a domestic noble house costs gold', () => {
    const st = game();
    st.nations.kiyat.gold = 1000;
    const r = st.nations.kiyat.rulerId;
    const n0 = consortsOf(st, r).length;
    const c = brideCandidates(st, 'kiyat')[0];
    expect(takeDomesticBride(st, 'kiyat', c.id).ok).toBe(true);
    expect(consortsOf(st, r).length).toBe(n0 + 1);
    expect(st.nations.kiyat.gold).toBe(700);
    expect(brideCandidates(st, 'kiyat').length).toBe(1);
  });

  it("marrying a vassal's daughter makes him an in-law, once a year", () => {
    const st = game();
    st.nations.kiyat.gold = 1000;
    const v = vassalBrideCandidates(st, 'kiyat')[0] ?? (() => { const g = find(st, 'ボオルチュ'); g.birth = st.year - 40; g.family = false; return g; })();
    const res = marryVassalDaughter(st, 'kiyat', v.id);
    expect(res.ok).toBe(true);
    expect(loyaltyTarget(st, v).items.some(([l]) => l === '外戚')).toBe(true);
    const other = vassalBrideCandidates(st, 'kiyat')[0];
    if (other) expect(marryVassalDaughter(st, 'kiyat', other.id).ok).toBe(false);
  });

  it('consorts of a fallen nation can be taken as widows', () => {
    const st = game();
    const tr = st.nations.tatar.rulerId;
    const c = consortsOf(st, tr)[0];
    if (!c) return;
    c.birth = st.year - 25;
    destroyNation(st, 'tatar', 'kiyat');
    expect(widows(st)).toContain(c);
    expect(takeWidow(st, c.id, 'kiyat').ok).toBe(true);
    expect(c.husband).toBe(st.nations.kiyat.rulerId);
    expect(c.affection).toBe(30);
  });
});
