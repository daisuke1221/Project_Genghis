// シナリオ定義：開始年・勢力の版図・君主・武将の所属・史実の没年・妃と姫
// 基本は data.js の 1189年の配置で、各シナリオは差分だけを書く。
import { NATIONS, NAMED_GENERALS, NAMED_CONSORTS, NAMED_PRINCESSES } from './data.js';

const G = (name, nation, birth, war, lead, pol, cha, family = false) => ({ name, nation, birth, war, lead, pol, cha, family });

// 史実の没年（シナリオ開始年より前に亡くなった人物は登場しない）
export const DEATH_YEAR = {
  // モンゴル高原
  'オン・カン': 1203, 'ジャムカ': 1206, 'セングム': 1204, 'ジャカ・ガンボ': 1210, 'トクトア・ベキ': 1208, 'クドゥ': 1217,
  'メグジン・セウルトゥ': 1196, 'タヤン・カン': 1204, 'ブイルク・カン': 1206, 'コリ・スベチ': 1204, 'クチュルク': 1218,
  // 金・西夏・南宋・高麗・大理
  '章宗': 1208, '完顔襄': 1202, '紇石烈執中': 1213, '完顔承暉': 1215, '僕散揆': 1207,
  '仁宗': 1193, '李純佑': 1206, '李安全': 1211, '光宗': 1200, '辛棄疾': 1207, '韓侂冑': 1207, '趙汝愚': 1196, '畢再遇': 1217,
  '明宗': 1202, '崔忠献': 1219, '李義旼': 1196, '杜景升': 1197, '段智興': 1200, '高量成': 1200,
  // 日本
  '源頼朝': 1199, '北条時政': 1215, '梶原景時': 1200, '畠山重忠': 1205, '和田義盛': 1213, '源頼家': 1204, '源実朝': 1219,
  '藤原泰衡': 1189, '源義経': 1189, '藤原国衡': 1189, '武蔵坊弁慶': 1189,
  // 中央アジア・インド
  '耶律直魯古': 1213, 'タヤング': 1210, 'テキシュ': 1200, 'ギヤースッディーン': 1203, 'ムイッズッディーン': 1206, 'アイバク': 1210,
  'ユルドゥズ': 1216, 'バフティヤール': 1206, 'プリトヴィーラージ': 1192, 'カイマーサ': 1192, 'ゴーヴィンダ・ラーイ': 1192,
  // 西アジア
  'キジル・アルスラーン': 1191, 'アブー・バクル': 1210, 'サラーフッディーン': 1193, 'アーディル': 1218, 'タキーユッディーン': 1191,
  'クルチ・アルスラーン': 1192, 'カイホスロー': 1211, 'スレイマーン': 1204, 'タマル': 1213, 'ダヴィト・ソスラン': 1207, 'ザカリア': 1212,
  // ヨーロッパ
  'イサキオス': 1204, 'アレクシオス': 1211, 'コンチャク': 1203, 'スヴャトスラフ': 1194, 'ロマン': 1205, 'フセヴォロド': 1212,
  'コンスタンチン': 1218, 'ベーラ3世': 1196, 'エメリク': 1204, 'カジミェシュ': 1194, 'フリードリヒ': 1190, 'ハインリヒ': 1197,
  'フィリップ': 1208, 'オットー': 1218, 'リチャード': 1199, 'ジョン': 1216, 'メルカディエ': 1200, 'ウィリアム・マーシャル': 1219,
};

export const SCENARIOS = [
  {
    id: 's1189', year: 1189, title: '蒼き狼の目覚め',
    subtitle: '1189年 モンゴル高原統一への道',
    desc: 'モンゴル高原には諸部族が割拠し、テムジンはキヤト氏族の長として立ったばかり。東には金、西にはホラズムと西遼、さらに西ではサラーフッディーンと十字軍が相争う。小勢力から身を起こす、最も自由度の高いシナリオ。',
    recommended: 'kiyat',
  },
  {
    id: 's1206', year: 1206, title: '大モンゴル国の成立',
    subtitle: '1206年 クリルタイとチンギス・カン即位',
    desc: 'テムジンは高原を統一し、チンギス・カンとして即位した。南では南宋が金への北伐（開禧用兵）を始め、西ではゴール朝の分裂からデリー・スルターン朝が生まれ、ビザンツ帝国は第4回十字軍によってラテン帝国に取って代わられた。',
    recommended: 'kiyat',
    rename: { 'テムジン': 'チンギス・カン' },
    nations: {
      kiyat: { name: 'モンゴル帝国', provinces: ['kiy', 'ker', 'mer', 'tat', 'nai', 'ong'], aggro: 0.9, veteran: true },
      kereit: null, merkit: null, tatar: null, naiman: null, ongud: null, oshu: null, chahamana: null,
      jin: { ruler: '章宗' },
      xia: { ruler: '李安全' },
      song: { ruler: '寧宗', aggro: 0.5 },
      kamakura: { provinces: ['jpe', 'jpw', 'kyu', 'osh'], ruler: '北条時政' },
      khitai: { provinces: ['bal', 'kas', 'sam'], ruler: '耶律直魯古' },
      dali: { ruler: '段智祥' },
      khwarezm: { provinces: ['khw', 'kho', 'ira'], ruler: 'アラーウッディーン' },
      eldiguzid: { provinces: ['aze'] },
      ghurid: { provinces: ['gha'], ruler: 'ユルドゥズ' },
      goryeo: { ruler: '崔忠献' },
      byzantium: { name: 'ニカイア帝国', provinces: ['gre'], ruler: 'テオドロス・ラスカリス' },
      hungary: { ruler: 'アンドラーシュ2世' },
      poland: { ruler: 'レシェク' },
      kiev: { ruler: 'ムスチスラフ' },
      hre: { ruler: 'フィリップ' },
      england: { ruler: 'ジョン' },
    },
    newNations: [
      { id: 'delhi', name: 'デリー・スルターン朝', color: '#c46a2c', culture: 'islamic', provinces: ['ind'], aggro: 0.6, ruler: 'アイバク' },
      { id: 'latin', name: 'ラテン帝国', color: '#6a5acd', culture: 'european', provinces: ['byz'], aggro: 0.5, ruler: 'アンリ・ド・エノー' },
    ],
    generals: {
      'ダイル・ウスン': 'kiyat', 'ジャカ・ガンボ': 'kiyat', 'アラクシ': 'kiyat', 'クチュルク': 'khitai',
      'バフティヤール': 'delhi', 'イルトゥトミシュ': 'delhi', 'ユルドゥズ': 'ghurid',
    },
    extraGenerals: [
      G('寧宗', 'song', 1168, 30, 40, 50, 50, true),
      G('段智祥', 'dali', 1180, 50, 58, 75, 70, true),
      G('アンドラーシュ2世', 'hungary', 1177, 60, 60, 45, 60, true),
      G('レシェク', 'poland', 1186, 60, 62, 65, 60, true),
      G('アンリ・ド・エノー', 'latin', 1176, 82, 84, 80, 82, true),
      G('ジョフロワ・ド・ヴィルアルドゥアン', 'latin', 1160, 72, 78, 85, 70),
      G('イルトゥトミシュ', 'delhi', 1180, 85, 86, 85, 78),
    ],
    relations: [['song', 'jin', -70]],
    consorts: [
      ['ボルテ', 'kiyat', 1161, 88, 82],
      ['クラン', 'kiyat', 1180, 90, 55],
      ['イェスイ', 'kiyat', 1180, 82, 75],
      ['イェスゲン', 'kiyat', 1182, 80, 60],
      ['グルベス', 'kiyat', 1165, 88, 70],
    ],
    princesses: [
      ['チチェゲン', 'kiyat', 1183, 72, 55],
      ['アラカイ', 'kiyat', 1189, 75, 85],
      ['ルスダン', 'georgia', 1194, 80, 60],
    ],
  },
  {
    id: 's1219', year: 1219, title: '西方大遠征',
    subtitle: '1219年 ホラズム・シャー朝との決戦',
    desc: '金の中都を落とし、西遼を滅ぼしたモンゴル帝国は、隊商虐殺の報復としてホラズム・シャー朝への遠征を決意した。ユーラシアの東西に二つの大国が並び立つ。金は開封に逼塞し、ジョージアやルーシの諸公はまだ迫る嵐を知らない。',
    recommended: 'khwarezm',
    rename: { 'テムジン': 'チンギス・カン' },
    nations: {
      kiyat: { name: 'モンゴル帝国', provinces: ['kiy', 'ker', 'mer', 'tat', 'nai', 'ong', 'jz', 'ly', 'hn', 'uig', 'bal', 'kas'], aggro: 0.95, veteran: true },
      kereit: null, merkit: null, tatar: null, naiman: null, ongud: null, oshu: null, chahamana: null,
      khitai: null, qangli: null, ghurid: null, uighur: null,
      jin: { provinces: ['kf', 'ty'], ruler: '宣宗' },
      xia: { ruler: '李遵頊' },
      dali: { ruler: '段智祥' },
      song: { ruler: '寧宗', aggro: 0.4 },
      kamakura: { provinces: ['jpe', 'jpw', 'kyu', 'osh'], ruler: '北条義時' },
      goryeo: { ruler: '崔瑀' },
      khwarezm: { provinces: ['khw', 'kho', 'sam', 'gha', 'kaz', 'ira'], ruler: 'アラーウッディーン', aggro: 0.6 },
      eldiguzid: { provinces: ['aze'], ruler: 'ウズベク' },
      ayyubid: { ruler: 'カーミル' },
      rum: { ruler: 'カイカーウス' },
      georgia: { ruler: 'ギオルギ4世' },
      byzantium: { name: 'ニカイア帝国', provinces: ['gre'], ruler: 'テオドロス・ラスカリス' },
      kipchak: { ruler: 'コチャン' },
      kiev: { ruler: 'ムスチスラフ' },
      vladimir: { ruler: 'ユーリー2世' },
      hungary: { ruler: 'アンドラーシュ2世' },
      poland: { ruler: 'レシェク' },
      hre: { ruler: 'フリードリヒ2世' },
      england: { ruler: 'ヒューバート・ド・バラ' },
    },
    newNations: [
      { id: 'delhi', name: 'デリー・スルターン朝', color: '#c46a2c', culture: 'islamic', provinces: ['ind'], aggro: 0.5, ruler: 'イルトゥトミシュ' },
      { id: 'latin', name: 'ラテン帝国', color: '#6a5acd', culture: 'european', provinces: ['byz'], aggro: 0.4, ruler: 'ロベール・ド・クルトネー' },
    ],
    generals: {
      '耶律楚材': 'kiyat', 'ダイル・ウスン': 'kiyat', 'アラクシ': 'kiyat', 'バルチュク': 'kiyat', 'イナンチ・カン': 'khwarezm',
      'イルトゥトミシュ': 'delhi',
    },
    extraGenerals: [
      G('宣宗', 'jin', 1163, 30, 40, 55, 40, true),
      G('李遵頊', 'xia', 1163, 40, 50, 60, 45, true),
      G('寧宗', 'song', 1168, 30, 40, 50, 50, true),
      G('段智祥', 'dali', 1180, 50, 58, 75, 70, true),
      G('史弥遠', 'song', 1164, 30, 50, 85, 45),
      G('崔瑀', 'goryeo', 1166, 70, 80, 85, 60),
      G('ウズベク', 'eldiguzid', 1180, 45, 50, 40, 35, true),
      G('カイカーウス', 'rum', 1185, 70, 72, 68, 65, true),
      G('カイクバード', 'rum', 1188, 80, 82, 85, 80, true),
      G('ギオルギ4世', 'georgia', 1191, 88, 80, 55, 75, true),
      G('ロベール・ド・クルトネー', 'latin', 1200, 45, 45, 40, 40, true),
      G('ユーリー2世', 'vladimir', 1188, 60, 65, 60, 60, true),
      G('アンドラーシュ2世', 'hungary', 1177, 60, 60, 45, 60, true),
      G('レシェク', 'poland', 1186, 60, 62, 65, 60, true),
      G('フリードリヒ2世', 'hre', 1194, 75, 85, 95, 85, true),
      G('ヒューバート・ド・バラ', 'england', 1170, 70, 75, 85, 65),
      G('ヘンリー3世', 'england', 1207, 40, 45, 60, 55, true),
      G('イルトゥトミシュ', 'delhi', 1180, 85, 86, 85, 78),
      G('ムカリの子ボオル', 'kiyat', 1197, 70, 72, 60, 60),
    ],
    relations: [['kiyat', 'khwarezm', -80], ['kiyat', 'jin', -90], ['jin', 'song', -40]],
    consorts: [
      ['ボルテ', 'kiyat', 1161, 88, 82],
      ['クラン', 'kiyat', 1180, 90, 55],
      ['イェスイ', 'kiyat', 1180, 82, 75],
      ['イェスゲン', 'kiyat', 1182, 80, 60],
    ],
    princesses: [
      ['ルスダン', 'georgia', 1194, 80, 60, 'タマル'],
    ],
  },
];

export const getScenario = (id) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];

// シナリオを適用した勢力一覧・武将一覧を作る
export function buildScenario(id) {
  const sc = getScenario(id);
  const nations = [];
  for (const base of NATIONS) {
    const o = sc.nations?.[base.id];
    if (o === null) continue;
    const n = { ...base, ...(o || {}) };
    n.provinces = [...(o?.provinces ?? base.provinces)];
    nations.push(n);
  }
  for (const nn of sc.newNations || []) nations.push({ ...nn, provinces: [...nn.provinces] });
  // 他勢力へ移った地方は元の持ち主から外す（後に書かれた勢力を優先）
  const owner = {};
  for (const n of nations) for (const p of n.provinces) owner[p] = n.id;
  for (const n of nations) {
    n.provinces = n.provinces.filter((p) => owner[p] === n.id);
    n.capital = n.provinces[0];
  }
  const live = nations.filter((n) => n.provinces.length);
  const liveIds = new Set(live.map((n) => n.id));

  const generals = [];
  for (const g of [...NAMED_GENERALS, ...(sc.extraGenerals || [])]) {
    if (generals.some((x) => x.name === g.name)) continue;
    const died = DEATH_YEAR[g.name];
    if (sc.year > 1189 && died !== undefined && died < sc.year) continue;
    const name = sc.rename?.[g.name] ?? g.name;
    let nation = sc.generals?.[g.name] ?? g.nation;
    if (!liveIds.has(nation)) nation = null; // 滅んだ勢力の人物は在野に
    generals.push({ ...g, name, nation, homeNation: g.nation });
  }
  // 君主：指定があれば先頭へ
  for (const n of live) {
    const rname = sc.rename?.[n.ruler] ?? n.ruler;
    if (!rname) continue;
    const i = generals.findIndex((g) => g.name === rname);
    if (i >= 0) {
      const [g] = generals.splice(i, 1);
      g.nation = n.id;
      g.family = true;
      generals.unshift(g);
    }
  }
  const consorts = sc.consorts ?? NAMED_CONSORTS;
  const princesses = sc.princesses ?? NAMED_PRINCESSES;
  return { sc, nations: live, generals, consorts, princesses };
}
