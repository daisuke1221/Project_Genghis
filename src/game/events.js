// 歴史イベント：条件がそろうと一度だけ起こる史実の出来事
// プレイヤーの勢力が当事者なら選択肢を示し、AI勢力なら史実どおりに進む。
import { rint, chance, rnd } from './rng.js';
import { NEIGHBORS } from './geo.js';
import {
  PROV_DEF, generalsIn, nationGenerals, nationProvinces, addGeneral, randomGeneral, unitCap, assignBestGovernor, log, age,
  dateStr, treaty,
} from './state.js';
import { killGeneral, changeOwner, adjustRelation, checkNationAlive } from './military.js';
import { declareWar, sign, areNeighbors, nationPower } from './diplomacy.js';

// ---------- ヘルパー ----------
export const gen = (st, ...names) => Object.values(st.generals).find((g) => g.alive && names.includes(g.name)) || null;
const alive = (st, nid) => !!st.nations[nid]?.alive;
const owns = (st, nid, ...pids) => pids.every((p) => st.provinces[p]?.owner === nid);
const isRuler = (st, g) => g && g.nation && st.nations[g.nation]?.rulerId === g.id;
const nm = (st, nid) => st.nations[nid]?.name ?? '';
const cityOf = (pid) => PROV_DEF[pid].city;

function setRuler(st, nid, g) {
  const nat = st.nations[nid];
  const old = st.generals[nat.rulerId];
  g.nation = nid;
  nat.rulerId = g.id;
  g.family = true;
  g.loyalty = 100;
  if (old && old !== g) old.loyalty = Math.min(old.loyalty, 60);
}

function relAll(st, nid, list, d) { for (const o of list) if (alive(st, o)) adjustRelation(st, nid, o, d); }

function trainAll(st, nid, d) {
  for (const g of nationGenerals(st, nid)) if (g.unit) g.unit.training = Math.min(100, g.unit.training + d);
}
function loyaltyAll(st, nid, d) {
  for (const g of nationGenerals(st, nid)) if (!isRuler(st, g)) g.loyalty = Math.max(0, Math.min(100, g.loyalty + d));
}
function war(st, a, b) {
  declareWar(st, a, b);
  adjustRelation(st, a, b, -200);
}

// 新しい勢力を興す（または既存勢力に地方を渡す）
export function spawnNation(st, def, pids, leaderIds = [], specs = []) {
  let nat = st.nations[def.id];
  const oldOwners = new Set(pids.map((p) => st.provinces[p].owner).filter((o) => o && o !== def.id));
  if (!nat) {
    nat = st.nations[def.id] = {
      id: def.id, name: def.name, color: def.color, culture: def.culture, aggro: def.aggro ?? 0.5,
      rulerId: null, capital: pids[0], gold: 1000, food: 3000, alive: true, relations: {}, treaties: {},
    };
    for (const o of Object.values(st.nations)) if (o.id !== def.id) { nat.relations[o.id] = 0; o.relations[def.id] = 0; }
  } else {
    Object.assign(nat, { alive: true, name: def.name ?? nat.name });
  }
  for (const pid of pids) {
    const old = st.provinces[pid].owner;
    if (old && old !== def.id) {
      for (const g of generalsIn(st, pid, old)) {
        if (leaderIds.includes(g.id)) continue;
        const esc = NEIGHBORS[pid].find((q) => st.provinces[q].owner === old && !pids.includes(q));
        if (esc) g.province = esc;
        else { g.nation = null; g.unit = null; }
      }
    }
    changeOwner(st, pid, def.id);
  }
  nat.capital = pids[0];
  const leaders = [];
  for (const id of leaderIds) {
    const g = st.generals[id];
    if (!g?.alive) continue;
    g.nation = def.id; g.province = pids[0]; g.loyalty = Math.max(g.loyalty, 85);
    leaders.push(g);
  }
  for (const s of specs) {
    const g = addGeneral(st, { ...s, nation: def.id, province: pids[0], loyalty: 90 });
    g.named = true;
    leaders.push(g);
  }
  const need = pids.length * 2 + 1;
  for (let i = nationGenerals(st, def.id).length; i < need; i++) {
    const g = addGeneral(st, { ...randomGeneral(st, def.id, nat.culture), province: pids[i % pids.length] });
    leaders.push(g);
  }
  for (const g of leaders) {
    if (!g.unit || g.unit.soldiers <= 0) {
      const type = nat.culture === 'mongol' || nat.culture === 'turkic' ? 'harch' : rnd(st) < 0.5 ? 'inf' : 'cav';
      g.unit = { type, soldiers: Math.round(unitCap(g) * 0.7 / 50) * 50, training: rint(st, 55, 75) };
    }
  }
  const r = st.generals[nat.rulerId];
  if (!r?.alive || r.nation !== def.id) setRuler(st, def.id, leaders[0] ?? nationGenerals(st, def.id)[0]);
  for (const pid of pids) assignBestGovernor(st, pid);
  for (const o of oldOwners) { adjustRelation(st, o, def.id, -40); checkNationAlive(st, o, def.id); }
  return nat;
}

// 地方と武将をまるごと併合する
function annex(st, fromNid, toNid) {
  for (const p of nationProvinces(st, fromNid)) changeOwner(st, p.id, toNid);
  for (const g of Object.values(st.generals)) if (g.nation === fromNid && g.alive) { g.nation = toNid; g.loyalty = 70; }
  st.nations[fromNid].alive = false;
  log(st, `${nm(st, fromNid)}は${nm(st, toNid)}に併合された。`, true);
}

// ---------- イベント定義 ----------
// actor(st): 当事者の勢力（プレイヤーならその勢力の選択肢を出す）
// choices(st, actor): プレイヤー向けの選択肢 [{label, hint, apply}]
// ai(st): AI の場合の史実どおりの処理
// aiOnly: プレイヤーの勢力が当事者なら起こらない（人物の死など）
// notable: 当事者でなくても「世界の動き」として知らせる
export const EVENTS = [
  {
    id: 'oshu_war', title: '奥州合戦', glyph: '奥', minYear: 1189, maxYear: 1192, notable: true,
    when: (st) => alive(st, 'kamakura') && alive(st, 'oshu') && gen(st, '源義経')?.nation === 'oshu' && st.season >= 1,
    actor: (st) => (['oshu', 'kamakura'].includes(st.playerNation) ? st.playerNation : null),
    text: () => '源頼朝は奥州の藤原泰衡に、匿っている弟・源義経の身柄を差し出すよう強く迫った。応じなければ、鎌倉の大軍が奥州へ押し寄せるであろう。',
    choices: (st, actor) => actor === 'oshu' ? [
      { label: '義経を討つ', hint: '鎌倉と停戦を結ぶが、名将を失う', apply: (s) => { killGeneral(s, gen(s, '源義経').id); sign(s, 'oshu', 'kamakura', 'truce'); return '泰衡は衣川の館を囲み、義経は自害した。鎌倉との間に一時の和が成った。'; } },
      { label: '義経を守り、鎌倉と戦う', hint: '鎌倉との関係が決定的に悪化。義経・弁慶の忠誠が最大に', apply: (s) => { war(s, 'oshu', 'kamakura'); for (const n of ['源義経', '武蔵坊弁慶']) { const g = gen(s, n); if (g) g.loyalty = 100; } s.nations.kamakura.aggro = 0.9; return '泰衡は父の遺言に従い義経を守ることを選んだ。鎌倉は奥州征伐の兵を挙げた。'; } },
    ] : [
      { label: '奥州征伐の兵を挙げる', hint: '奥州藤原氏と開戦。全武将の訓練度+5', apply: (s) => { war(s, 'kamakura', 'oshu'); trainAll(s, 'kamakura', 5); if (chance(s, 0.6)) { killGeneral(s, gen(s, '源義経').id); return '圧力に屈した泰衡は義経を討った。だが頼朝は、義経を匿った罪を問うとして奥州へ兵を向けた。'; } return '泰衡は義経を差し出さなかった。頼朝は奥州へ兵を向けた。'; } },
      { label: '静観する', hint: '何も起こらない', apply: () => '頼朝はひとまず兵を動かさなかった。' },
    ],
    ai: (st) => { killGeneral(st, gen(st, '源義経').id); war(st, 'kamakura', 'oshu'); st.nations.kamakura.aggro = 0.9; return '藤原泰衡は衣川の館に源義経を攻め、義経は自害した。しかし頼朝は奥州征伐の兵を挙げた。'; },
  },
  {
    id: 'barbarossa', title: '赤髭王の最期', glyph: '没', minYear: 1190, maxYear: 1190, aiOnly: true, notable: true,
    when: (st) => st.season === 1 && isRuler(st, gen(st, 'フリードリヒ')),
    actor: () => 'hre',
    text: () => '第3回十字軍を率いて小アジアを進軍していた神聖ローマ皇帝フリードリヒ1世（赤髭王）が、サレフ川を渡る途中で溺死した。',
    ai: (st) => { killGeneral(st, gen(st, 'フリードリヒ').id); return '赤髭王は川で溺死し、ドイツ軍の多くは帰国した。'; },
  },
  {
    id: 'third_crusade', title: '第3回十字軍', glyph: '十', minYear: 1189, maxYear: 1192, notable: true,
    when: (st) => st.season === 2 && alive(st, 'ayyubid') && (alive(st, 'england') || alive(st, 'france')) && !!gen(st, 'サラーフッディーン'),
    actor: (st) => (['england', 'france', 'ayyubid'].includes(st.playerNation) ? st.playerNation : null),
    text: () => 'サラーフッディーンによるエルサレム奪還を受け、教皇は十字軍を呼びかけた。イングランドのリチャード獅子心王とフランスのフィリップ2世が聖地を目指す。',
    choices: (st, actor) => actor === 'ayyubid' ? [
      { label: '聖戦を宣言する', hint: '全武将の訓練度+15・忠誠+5、英仏との関係悪化', apply: (s) => { trainAll(s, 'ayyubid', 15); loyaltyAll(s, 'ayyubid', 5); relAll(s, 'ayyubid', ['england', 'france', 'hre'], -50); return 'サラーフッディーンのもとにムスリムの諸侯が結集した。'; } },
      { label: '和平の道を探る', hint: '金-500、英仏との関係改善', apply: (s) => { s.nations.ayyubid.gold = Math.max(0, s.nations.ayyubid.gold - 500); relAll(s, 'ayyubid', ['england', 'france'], 25); return '使者が往来し、戦いは避けられた。'; } },
    ] : [
      { label: '十字軍に加わる', hint: '金-600、全武将の忠誠+8・君主の魅力+3、アイユーブ朝と敵対', apply: (s) => { const n = s.nations[actor]; n.gold = Math.max(0, n.gold - 600); loyaltyAll(s, actor, 8); const r = s.generals[n.rulerId]; r.cha = Math.min(100, r.cha + 3); adjustRelation(s, actor, 'ayyubid', -60); return `${n.name}の軍勢は聖地へ向かった。君主の名声は高まった。`; } },
      { label: '見送る', hint: '君主の魅力-3、他の十字軍国との関係悪化', apply: (s) => { const r = s.generals[s.nations[actor].rulerId]; r.cha = Math.max(1, r.cha - 3); relAll(s, actor, ['england', 'france', 'hre'].filter((x) => x !== actor), -20); return '十字軍には加わらなかった。諸侯は冷ややかな目を向けた。'; } },
    ],
    ai: (st) => {
      for (const n of ['england', 'france']) if (alive(st, n)) { st.nations[n].gold = Math.max(0, st.nations[n].gold - 600); adjustRelation(st, n, 'ayyubid', -60); }
      trainAll(st, 'ayyubid', 10);
      return '英仏の十字軍がアッコンに上陸し、サラーフッディーンと激戦を繰り広げた。';
    },
  },
  {
    id: 'saladin_death', title: 'サラーフッディーン逝く', glyph: '没', minYear: 1193, maxYear: 1195, aiOnly: true, notable: true,
    when: (st) => !!gen(st, 'サラーフッディーン') && gen(st, 'サラーフッディーン').nation === 'ayyubid',
    actor: () => 'ayyubid',
    text: () => '十字軍と戦い抜いた英雄サラーフッディーンが、ダマスカスで熱病により世を去った。遺された一族の間には早くも不和の影が差す。',
    ai: (st) => { killGeneral(st, gen(st, 'サラーフッディーン').id); loyaltyAll(st, 'ayyubid', -10); return 'サラーフッディーンは世を去り、アイユーブ家は内紛に揺れた。'; },
  },
  {
    id: 'choe_coup', title: '崔忠献の政変', glyph: '変', minYear: 1196, maxYear: 1205,
    when: (st) => alive(st, 'goryeo') && gen(st, '崔忠献')?.nation === 'goryeo' && !isRuler(st, gen(st, '崔忠献')),
    actor: () => 'goryeo',
    text: () => '武臣の崔忠献が専横を極める李義旼一派を打ち倒し、高麗の実権を握ろうとしている。',
    choices: () => [
      { label: '崔忠献に実権を委ねる', hint: '崔忠献が新たな君主となる', apply: (s) => { setRuler(s, 'goryeo', gen(s, '崔忠献')); return '崔忠献が高麗の実権を握り、崔氏政権が始まった。'; } },
      { label: '崔忠献の粛清を図る', hint: '成功すれば崔忠献を除けるが、失敗すれば出奔する', apply: (s) => { const g = gen(s, '崔忠献'); if (chance(s, 0.5)) { killGeneral(s, g.id); return '密命により崔忠献は討たれた。'; } g.nation = null; g.unit = null; return '計画は漏れ、崔忠献は兵を連れて出奔した。'; } },
    ],
    ai: (st) => { setRuler(st, 'goryeo', gen(st, '崔忠献')); return '崔忠献が政変を起こし、高麗の実権を握った。'; },
  },
  {
    id: 'yoritomo_death', title: '頼朝の落馬', glyph: '没', minYear: 1199, maxYear: 1201, aiOnly: true, notable: true,
    when: (st) => isRuler(st, gen(st, '源頼朝')) && gen(st, '源頼朝').nation === 'kamakura',
    actor: () => 'kamakura',
    text: () => '相模川の橋供養の帰途、源頼朝が落馬し、まもなく世を去った。鎌倉では有力御家人の合議による政治が始まる。',
    ai: (st) => { killGeneral(st, gen(st, '源頼朝').id); return '源頼朝が世を去った。'; },
  },
  {
    id: 'kurultai', title: 'クリルタイ — 大ハーンの即位', glyph: '汗', minYear: 1189, maxYear: 1300, notable: true,
    when: (st) => {
      const owner = st.provinces.kiy.owner;
      if (!owner || st.nations[owner].culture !== 'mongol' || st.nations[owner].crowned) return false;
      return owns(st, owner, 'kiy', 'ker', 'mer', 'tat', 'nai') && !st.nations[owner].name.includes('帝国');
    },
    actor: (st) => st.provinces.kiy.owner,
    text: (st) => `${st.generals[st.nations[st.provinces.kiy.owner].rulerId].name}はモンゴル高原のすべての遊牧民を統べた。オノン河の源に諸部族の長が集い、クリルタイ（大集会）が開かれる。`,
    choices: () => [{ label: '大ハーンに即位する', hint: '国号をモンゴル帝国に。全武将の忠誠+15・訓練度+10', apply: (s) => crown(s, s.provinces.kiy.owner) }],
    ai: (st) => crown(st, st.provinces.kiy.owner),
  },
  {
    id: 'fourth_crusade', title: '第4回十字軍', glyph: '十', minYear: 1203, maxYear: 1210, notable: true,
    when: (st) => alive(st, 'byzantium') && owns(st, 'byzantium', 'byz') && !alive(st, 'latin') && (alive(st, 'france') || alive(st, 'hre')) && st.season === 1,
    actor: () => 'byzantium',
    text: () => 'ヴェネツィアの艦隊に乗った十字軍が、聖地ではなくコンスタンティノープルの城壁の前に現れた。帝位争いにつけこんだ騎士たちは、莫大な報酬を要求している。',
    choices: (st) => [
      { label: '黄金を支払って撤退させる', hint: `金-3000${st.nations.byzantium.gold < 3000 ? '（足りない！　支払えなければ都は落ちる）' : ''}`, apply: (s) => { if (s.nations.byzantium.gold >= 3000) { s.nations.byzantium.gold -= 3000; return '莫大な黄金と引き換えに、十字軍は去っていった。'; } s.nations.byzantium.gold = 0; latinConquest(s); return '支払うべき黄金は足りず、怒った十字軍はコンスタンティノープルを略奪した。'; } },
      { label: '城壁に拠って迎え撃つ', hint: '都は守れるが、守備兵の4割・人口の15%を失い、城壁が1段階下がる', apply: (s) => { for (const g of generalsIn(s, 'byz', 'byzantium')) if (g.unit) g.unit.soldiers = Math.round(g.unit.soldiers * 0.6); const c = s.provinces.byz.city; c.pop = Math.round(c.pop * 0.85); c.walls = Math.max(0, c.walls - 1); relAll(s, 'byzantium', ['france', 'hre', 'hungary'], -30); return '激戦の末、十字軍は撃退されたが、都は深い傷を負った。'; } },
    ],
    ai: (st) => { latinConquest(st); return '十字軍はコンスタンティノープルを陥落させ、ラテン帝国を建てた。'; },
  },
  {
    id: 'delhi_sultanate', title: '奴隷王朝の成立', glyph: '独', minYear: 1206, maxYear: 1216, notable: true,
    when: (st) => owns(st, 'ghurid', 'ind') && gen(st, 'アイバク')?.nation === 'ghurid' && !gen(st, 'ムイッズッディーン'),
    actor: () => 'ghurid',
    text: () => 'ゴール朝の君主ムイッズッディーンが暗殺された。インドを治めていた奴隷出身の将軍アイバクは、デリーで自立しようとしている。',
    choices: () => [
      { label: '独立を認める', hint: 'デリーを失うが、新王朝と同盟を結ぶ', apply: (s) => { delhi(s); sign(s, 'ghurid', 'delhi', 'alliance'); return 'アイバクはデリーでスルターンを称し、ゴール朝と盟約を結んだ。'; } },
      { label: '認めない', hint: 'アイバクの忠誠が20に下がる（出奔・謀反のおそれ）', apply: (s) => { gen(s, 'アイバク').loyalty = 20; return 'アイバクの自立は認められなかった。不穏な空気が漂う。'; } },
    ],
    ai: (st) => { delhi(st); return 'アイバクがデリーでスルターンを称し、デリー・スルターン朝（奴隷王朝）が生まれた。'; },
  },
  {
    id: 'kaixi', title: '開禧用兵', glyph: '伐', minYear: 1204, maxYear: 1210, notable: true,
    when: (st) => alive(st, 'song') && alive(st, 'jin') && gen(st, '韓侂冑')?.nation === 'song' && areNeighbors(st, 'song', 'jin'),
    actor: (st) => (['song', 'jin'].includes(st.playerNation) ? st.playerNation : 'song'),
    text: () => '南宋の宰相・韓侂冑は、金が北方の遊牧民の脅威に苦しむ今こそ失地回復の好機と説き、北伐を主張している。',
    choices: (st, actor) => actor === 'jin' ? [
      { label: '迎え撃つ構えをとる', hint: '全武将の訓練度+10、南宋と敵対', apply: (s) => { trainAll(s, 'jin', 10); war(s, 'jin', 'song'); return '金は国境の守りを固めた。'; } },
    ] : [
      { label: '北伐を決行する', hint: '金と開戦、全武将の訓練度+10', apply: (s) => { war(s, 'song', 'jin'); trainAll(s, 'song', 10); s.nations.song.aggro = 0.8; return '宋軍は淮河を越えて金領へ攻め込んだ。'; } },
      { label: '和議を守る', hint: '韓侂冑の忠誠-30', apply: (s) => { const g = gen(s, '韓侂冑'); g.loyalty = Math.max(0, g.loyalty - 30); return '北伐は見送られた。韓侂冑は不満を募らせている。'; } },
    ],
    ai: (st) => { war(st, 'song', 'jin'); st.nations.song.aggro = 0.75; return '南宋は金への北伐を開始した。'; },
  },
  {
    id: 'uighur', title: '天山ウイグルの帰順', glyph: '帰', minYear: 1206, maxYear: 1240, notable: true,
    when: (st) => {
      const m = st.provinces.kiy.owner;
      return alive(st, 'uighur') && m && (st.nations[m].crowned || st.nations[m].name === 'モンゴル帝国') && areNeighbors(st, m, 'uighur') && nationPower(st, m) > nationPower(st, 'uighur') * 3;
    },
    actor: (st) => (st.playerNation === 'uighur' ? 'uighur' : st.provinces.kiy.owner),
    text: (st) => `天山ウイグルの君主は、西遼の圧政を嫌い、${nm(st, st.provinces.kiy.owner)}への帰順を申し出ようとしている。`,
    choices: (st, actor) => actor === 'uighur' ? [
      { label: '同盟を結ぶ', hint: `${nm(st, st.provinces.kiy.owner)}と同盟・友好度最大`, apply: (s) => { const m = s.provinces.kiy.owner; sign(s, 'uighur', m, 'alliance'); adjustRelation(s, 'uighur', m, 200); return 'ウイグルは草原の覇者と盟約を結んだ。'; } },
      { label: '独立を守る', hint: '関係が悪化する', apply: (s) => { adjustRelation(s, 'uighur', s.provinces.kiy.owner, -40); return 'ウイグルは帰順を拒んだ。'; } },
    ] : [
      { label: '帰順を受け入れる', hint: '天山ウイグルの領地と武将がすべて加わる', apply: (s) => { annex(s, 'uighur', s.provinces.kiy.owner); return 'ウイグルの君主は「第五の息子」として迎えられた。'; } },
      { label: '断る', hint: '何も起こらない', apply: () => '帰順の申し出は退けられた。' },
    ],
    ai: (st) => { annex(st, 'uighur', st.provinces.kiy.owner); return '天山ウイグルは戦わずして帰順した。'; },
  },
  {
    id: 'jin_move', title: '貞祐の南遷', glyph: '遷', minYear: 1211, maxYear: 1235, notable: true,
    when: (st) => {
      if (!alive(st, 'jin') || st.nations.jin.capital !== 'jz' || !owns(st, 'jin', 'jz', 'kf')) return false;
      return NEIGHBORS.jz.some((q) => { const o = st.provinces[q].owner; return o && o !== 'jin' && !treaty(st, 'jin', o) && nationPower(st, o) > nationPower(st, 'jin') * 0.8; });
    },
    actor: () => 'jin',
    text: () => '北方の強敵が中都に迫っている。朝廷では、黄河の南の開封へ都を移すべきだとの声が高まっている。',
    choices: () => [
      { label: '開封へ遷都する', hint: '首都が開封に。中都の民忠-20', apply: (s) => { s.nations.jin.capital = 'kf'; s.provinces.jz.city.loyalty = Math.max(0, s.provinces.jz.city.loyalty - 20); return '皇帝は中都を捨てて開封へ移った。'; } },
      { label: '中都を死守する', hint: '中都の城壁+1、中都の守備兵の訓練度+15', apply: (s) => { const c = s.provinces.jz.city; c.walls = Math.min(3, c.walls + 1); for (const g of generalsIn(s, 'jz', 'jin')) if (g.unit) g.unit.training = Math.min(100, g.unit.training + 15); return '都の防備は一層固められた。'; } },
    ],
    ai: (st) => { st.nations.jin.capital = 'kf'; st.provinces.jz.city.loyalty = Math.max(0, st.provinces.jz.city.loyalty - 20); return '金は中都を捨て、開封へ遷都した。'; },
  },
  {
    id: 'yelu', title: '耶律楚材の出仕', glyph: '士', minYear: 1206, maxYear: 1240,
    when: (st) => {
      const g = gen(st, '耶律楚材');
      const o = st.provinces.jz.owner;
      return g && age(st, g) >= 20 && o && st.nations[o].culture === 'mongol' && g.nation !== o;
    },
    actor: (st) => st.provinces.jz.owner,
    text: () => '中都に、身の丈八尺、見事な髭をたくわえた契丹の貴族がいる。天文・卜占・医術に通じ、政治の才は比類ないという。名は耶律楚材。',
    choices: () => [
      { label: '召し抱える', hint: '耶律楚材（政治99）が配下に加わる', apply: (s) => { const g = gen(s, '耶律楚材'); g.nation = s.provinces.jz.owner; g.province = 'jz'; g.loyalty = 95; return '耶律楚材は「髭の長い人（ウルツ・サハル）」と呼ばれ、重く用いられた。'; } },
      { label: '見送る', hint: '何も起こらない', apply: () => '耶律楚材は去っていった。' },
    ],
    ai: (st) => { const g = gen(st, '耶律楚材'); g.nation = st.provinces.jz.owner; g.province = 'jz'; g.loyalty = 95; return '耶律楚材が出仕した。'; },
  },
  {
    id: 'otrar', title: 'オトラル事件', glyph: '禍', minYear: 1216, maxYear: 1230, notable: true,
    when: (st) => {
      const m = st.provinces.kiy.owner;
      return m && st.nations[m].culture === 'mongol' && alive(st, 'khwarezm') && areNeighbors(st, m, 'khwarezm');
    },
    actor: (st) => (st.playerNation === 'khwarezm' ? 'khwarezm' : st.provinces.kiy.owner),
    text: (st) => `${nm(st, st.provinces.kiy.owner)}から派遣された450人の隊商が、ホラズム領のオトラルに着いた。総督イナルチュクは、彼らを間諜だと疑っている。`,
    choices: (st, actor) => actor === 'khwarezm' ? [
      { label: '隊商を処刑し、財貨を没収する', hint: '金+800、モンゴルと決定的に敵対', apply: (s) => { s.nations.khwarezm.gold += 800; war(s, 'khwarezm', s.provinces.kiy.owner); s.nations[s.provinces.kiy.owner].aggro = 1; return '隊商は皆殺しにされた。東の草原から、報復の嵐が迫る。'; } },
      { label: '隊商を丁重に遇する', hint: 'モンゴルとの友好度+40、交易が開ける', apply: (s) => { adjustRelation(s, 'khwarezm', s.provinces.kiy.owner, 40); return '隊商は無事に交易を終えて帰った。'; } },
    ] : [
      { label: '報復の遠征を決意する', hint: 'ホラズムと敵対。全武将の訓練度+10・忠誠+10', apply: (s) => { const m = s.provinces.kiy.owner; war(s, m, 'khwarezm'); trainAll(s, m, 10); loyaltyAll(s, m, 10); return '隊商は虐殺され、使者も辱められた。大ハーンは山に登り、三日三晩祈って復讐を誓った。'; } },
      { label: '賠償を求める使者を送る', hint: 'ホラズムとの関係悪化にとどめる', apply: (s) => { adjustRelation(s, s.provinces.kiy.owner, 'khwarezm', -50); return '隊商は虐殺されたが、ひとまず使者を送って責任を問うた。'; } },
    ],
    ai: (st) => { const m = st.provinces.kiy.owner; war(st, m, 'khwarezm'); st.nations[m].aggro = 1; return 'オトラルでモンゴルの隊商が虐殺された。報復の遠征が始まる。'; },
  },
  {
    id: 'magna_carta', title: '大憲章（マグナ・カルタ）', glyph: '憲', minYear: 1213, maxYear: 1220, notable: true,
    when: (st) => isRuler(st, gen(st, 'ジョン')) && gen(st, 'ジョン').nation === 'england',
    actor: () => 'england',
    text: () => '重税と失政に怒ったイングランドの諸侯がロンドンを占拠し、国王ジョンに王権を制限する文書への署名を迫っている。',
    choices: () => [
      { label: '大憲章に署名する', hint: '全武将の忠誠+15', apply: (s) => { loyaltyAll(s, 'england', 15); return 'ラニーミードの野で、王は大憲章に署名した。'; } },
      { label: '署名を拒む', hint: '一門以外の武将の忠誠-25', apply: (s) => { for (const g of nationGenerals(s, 'england')) if (!g.family) g.loyalty = Math.max(0, g.loyalty - 25); return '王は署名を拒み、諸侯との内戦が迫る。'; } },
    ],
    ai: (st) => { loyaltyAll(st, 'england', 15); return 'ジョン王は大憲章に署名した。'; },
  },
  {
    id: 'jokyu', title: '承久の乱', glyph: '乱', minYear: 1219, maxYear: 1230, notable: true,
    when: (st) => alive(st, 'kamakura') && owns(st, 'kamakura', 'jpw') && gen(st, '北条義時')?.nation === 'kamakura',
    actor: () => 'kamakura',
    text: () => '後鳥羽上皇が執権・北条義時追討の院宣を下した。御家人たちは動揺している。尼将軍・北条政子は「故右大将の恩は山よりも高く、海よりも深い」と説いた。',
    choices: () => [
      { label: '大軍を率いて京へ攻め上る', hint: '全武将の忠誠+10、京都の民忠-15、没収した所領で金+800', apply: (s) => { loyaltyAll(s, 'kamakura', 10); s.provinces.jpw.city.loyalty = Math.max(0, s.provinces.jpw.city.loyalty - 15); s.nations.kamakura.gold += 800; return '幕府軍は京を制圧し、上皇は隠岐へ流された。'; } },
      { label: '朝廷と和解する', hint: '金-300、京都の民忠+10', apply: (s) => { s.nations.kamakura.gold = Math.max(0, s.nations.kamakura.gold - 300); s.provinces.jpw.city.loyalty = Math.min(100, s.provinces.jpw.city.loyalty + 10); return '幕府は朝廷と和解し、乱は収まった。'; } },
    ],
    ai: (st) => { loyaltyAll(st, 'kamakura', 10); st.nations.kamakura.gold += 800; return '幕府軍が京を制圧し、承久の乱は幕府の勝利に終わった。'; },
  },
  {
    id: 'chinggis_death', title: '大ハーン崩御', glyph: '没', minYear: 1227, maxYear: 1240, aiOnly: true, notable: true,
    when: (st) => { const g = gen(st, 'チンギス・カン'); return g && isRuler(st, g) && st.season === 2; },
    actor: (st) => gen(st, 'チンギス・カン')?.nation,
    text: () => '西夏遠征の陣中で、チンギス・カンが崩御した。その死は固く秘され、遺骸は故郷の聖山へと運ばれたという。',
    ai: (st) => { killGeneral(st, gen(st, 'チンギス・カン').id); return 'チンギス・カンが崩御した。'; },
  },
];

function crown(st, nid) {
  const nat = st.nations[nid];
  const r = st.generals[nat.rulerId];
  const old = r.name;
  r.name = r.name === 'テムジン' ? 'チンギス・カン' : r.name.endsWith('カン') ? r.name : `${r.name}・カン`;
  nat.name = 'モンゴル帝国';
  nat.crowned = true;
  nat.aggro = Math.max(nat.aggro, 0.9);
  loyaltyAll(st, nid, 15);
  trainAll(st, nid, 10);
  r.cha = Math.min(100, r.cha + 5);
  return `${old}はクリルタイで大ハーンに推戴され、「${r.name}」と称した。国号を「モンゴル帝国（イェケ・モンゴル・ウルス）」と定めた。`;
}

function latinConquest(st) {
  const ids = [gen(st, 'アンリ・ド・エノー'), gen(st, 'ジョフロワ・ド・ヴィルアルドゥアン')].filter(Boolean).map((g) => g.id);
  const specs = [];
  if (!gen(st, 'アンリ・ド・エノー')) specs.push({ name: 'アンリ・ド・エノー', birth: 1176, war: 82, lead: 84, pol: 80, cha: 82, family: true });
  if (!gen(st, 'ジョフロワ・ド・ヴィルアルドゥアン')) specs.push({ name: 'ジョフロワ・ド・ヴィルアルドゥアン', birth: 1160, war: 72, lead: 78, pol: 85, cha: 70 });
  spawnNation(st, { id: 'latin', name: 'ラテン帝国', color: '#6a5acd', culture: 'european', aggro: 0.5 }, ['byz'], ids, specs);
  if (alive(st, 'byzantium') && gen(st, 'テオドロス・ラスカリス')?.nation === 'byzantium') {
    st.nations.byzantium.name = 'ニカイア帝国';
    setRuler(st, 'byzantium', gen(st, 'テオドロス・ラスカリス'));
  }
}

function delhi(st) {
  const aibak = gen(st, 'アイバク');
  const ids = [aibak.id];
  const iltut = gen(st, 'イルトゥトミシュ');
  if (iltut) ids.push(iltut.id);
  const specs = iltut ? [] : [{ name: 'イルトゥトミシュ', birth: 1180, war: 85, lead: 86, pol: 85, cha: 78 }];
  spawnNation(st, { id: 'delhi', name: 'デリー・スルターン朝', color: '#c46a2c', culture: 'islamic', aggro: 0.6 }, ['ind'], ids, specs);
  setRuler(st, 'delhi', aibak);
}

// ---------- 実行 ----------
export function eventDue(st, ev) {
  if (st.firedEvents?.includes(ev.id)) return false;
  if (st.year < ev.minYear || st.year > ev.maxYear) return false;
  try { return !!ev.when(st); } catch { return false; }
}

// hooks.event({ ev, title, text, choices, date, involved }) -> Promise<選択肢の番号>
export async function runEvents(st, hooks = {}) {
  if (st.options?.historyEvents === false) return [];
  st.firedEvents = st.firedEvents || [];
  st.chronicle = st.chronicle || [];
  const fired = [];
  for (const ev of EVENTS) {
    if (!eventDue(st, ev)) continue;
    const actor = ev.actor?.(st) ?? null;
    const involved = actor && actor === st.playerNation;
    st.firedEvents.push(ev.id);
    if (ev.aiOnly && involved) continue; // プレイヤー自身の人物は史実で殺さない
    const text = ev.text(st);
    const date = dateStr(st);
    let result;
    if (involved && ev.choices) {
      const choices = ev.choices(st, actor);
      let idx = 0;
      if (hooks.event && choices.length > 1) idx = await hooks.event({ ev, title: ev.title, text, choices, date, involved: true });
      else if (hooks.event) await hooks.event({ ev, title: ev.title, text, choices, date, involved: true });
      result = choices[Math.max(0, Math.min(choices.length - 1, idx ?? 0))].apply(st);
    } else {
      result = ev.ai(st);
      if (ev.notable && hooks.event) await hooks.event({ ev, title: ev.title, text, result, date, involved: false });
    }
    st.chronicle.push({ id: ev.id, date, title: ev.title, text: result || text });
    log(st, `【${ev.title}】${result || ''}`, involved || ev.notable);
    fired.push(ev.id);
  }
  return fired;
}

