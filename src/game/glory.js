// 覇業：地域と平定、君主の称号（即位）、勝利条件（天下統一・覇王・期限）と結末
import { PROVINCES, VICTORY_SHARE } from './data.js';
import { nationProvinces, nationGenerals, log, dateStr } from './state.js';
import { adjustRelation } from './military.js';
import { areNeighbors } from './diplomacy.js';
import { ranking, peakOf, scoreOf } from './history.js';

const nameOf = (st, id) => st.nations[id]?.name ?? '';

// ---------- 地域 ----------
export const REGIONS = {
  mongolia: { name: 'モンゴル高原', provs: ['nai', 'mer', 'ker', 'kiy', 'tat', 'ong'] },
  china: { name: '中華', provs: ['gan', 'xia', 'ty', 'jz', 'kf', 'ly', 'hn', 'sy', 'sc', 'song', 'gz', 'dal'] },
  east: { name: '高麗・日本', provs: ['kor', 'kyu', 'jpw', 'jpe', 'osh'] },
  central: { name: '中央アジア', provs: ['kaz', 'bal', 'kas', 'uig', 'sam', 'khw', 'tib'] },
  persia: { name: 'ペルシア・インド', provs: ['kho', 'gha', 'ind', 'ira', 'aze', 'irq'] },
  orient: { name: 'オリエント', provs: ['rum', 'syr', 'egy', 'geo'] },
  steppe: { name: 'ルーシ・キプチャク', provs: ['kip', 'bul', 'kie', 'nov', 'vla'] },
  europe: { name: 'ヨーロッパ', provs: ['eng', 'fra', 'ger', 'ita', 'pol', 'hun', 'gre', 'byz'] },
};
export const REGION_OF = Object.fromEntries(Object.entries(REGIONS).flatMap(([k, r]) => r.provs.map((p) => [p, k])));
export const regionsHeld = (st, nid) => Object.keys(REGIONS).filter((k) => REGIONS[k].provs.every((p) => st.provinces[p]?.owner === nid));

// ---------- 勝利条件 ----------
export const VICTORY_MODES = {
  unify: { name: '天下統一', desc: `全${PROVINCES.length}地方の${Math.round(VICTORY_SHARE * 100)}%（${Math.ceil(PROVINCES.length * VICTORY_SHARE)}地方）を支配する` },
  hegemony: { name: '覇王', desc: '8つの地域のうち4つを完全に平定する（天下統一でも勝利）' },
  deadline: { name: '時代の覇者', desc: '開始から50年後に国力が第1位であること（途中で天下統一しても勝利）' },
};
export const HEGEMONY_REGIONS = 4;
export const DEADLINE_YEARS = 50;
export const victoryMode = (st) => st.options?.victory ?? 'unify';
export const deadlineYear = (st) => (st.startYear ?? st.year) + DEADLINE_YEARS;

// ---------- 称号 ----------
const TITLES = {
  mongol: ['ベキ', 'ハン', '大ハーン'],
  turkic: ['ベグ', 'ハン', 'ハーカーン'],
  chinese: ['郡王', '王', '皇帝'],
  korean: ['君', '王', '皇帝'],
  japanese: ['守護', '征夷大将軍', '天下人'],
  tibetan: ['首長', '王', 'ツェンポ'],
  islamic: ['アミール', 'スルターン', 'シャーハンシャー'],
  indian: ['ラージャ', 'マハーラージャ', 'チャクラヴァルティン'],
  european: ['伯', '王', '皇帝'],
  slavic: ['公', '大公', 'ツァーリ'],
  greek: ['デスポテース', 'バシレウス', 'アウトクラトール'],
  georgian: ['エリスタヴィ', '王', '諸王の王'],
};
export const TITLE_REQ = [null, { provs: 3, regions: 0, cost: 300 }, { provs: 8, regions: 1, cost: 1200 }, { provs: 20, regions: 3, cost: 3000 }];
const EMPIRES = ['jin', 'song'];
const KINGDOMS = ['xia', 'dali', 'tibet', 'goryeo', 'kamakura', 'khitai', 'khwarezm', 'kereit', 'naiman'];
// 始まりの称号：帝国は最高位、王国やスルターン朝は二段目、それ以外は一段目
function defaultTier(n) {
  if (EMPIRES.includes(n.id) || n.name.includes('帝国')) return 3;
  if (KINGDOMS.includes(n.id) || /王国|大公国|朝$/.test(n.name)) return 2;
  return 1;
}

export const tierOf = (st, nid) => Math.max(st.nations[nid]?.tier ?? 0, st.nations[nid]?.crowned ? 3 : 0);
export function titleName(st, nid, tier = tierOf(st, nid)) {
  if (!tier) return '';
  return (TITLES[st.nations[nid]?.culture] ?? TITLES.european)[tier - 1];
}

export function canClaimTitle(st, nid) {
  const tier = tierOf(st, nid) + 1;
  if (tier > 3) return { ok: false, reason: 'すでに最高の称号です' };
  const req = TITLE_REQ[tier];
  const n = st.nations[nid];
  const provs = nationProvinces(st, nid).length;
  const regions = regionsHeld(st, nid).length;
  const title = titleName(st, nid, tier);
  if (provs < req.provs) return { ok: false, tier, title, reason: `${title}を名乗るには${req.provs}地方が必要です（いま${provs}）` };
  if (regions < req.regions) return { ok: false, tier, title, reason: `${title}を名乗るには${req.regions}つの地域の平定が必要です（いま${regions}）` };
  if (n.gold < req.cost) return { ok: false, tier, title, reason: `即位の儀には${req.cost}金が必要です` };
  return { ok: true, tier, title, cost: req.cost };
}

export function claimTitle(st, nid) {
  const av = canClaimTitle(st, nid);
  if (!av.ok) return av;
  const n = st.nations[nid];
  n.gold -= av.cost;
  n.tier = av.tier;
  const r = st.generals[n.rulerId];
  for (const g of nationGenerals(st, nid)) if (g !== r) g.loyalty = Math.min(100, g.loyalty + 5 * av.tier);
  if (av.tier === 3) {
    n.crowned = true;
    // 天に二つの日なし：同じ最高位を名乗る国や隣国は警戒する
    for (const o of Object.values(st.nations)) {
      if (!o.alive || o.id === nid) continue;
      if (tierOf(st, o.id) === 3) adjustRelation(st, nid, o.id, -20);
      else if (areNeighbors(st, nid, o.id)) adjustRelation(st, nid, o.id, -8);
    }
  }
  const text = `${r?.name ?? n.name}が${av.title}を名乗り、即位の儀を執り行った。`;
  st.chronicle ??= [];
  st.chronicle.push({ id: `title_${nid}_${st.turn}`, date: dateStr(st), title: `${n.name}の${av.title}即位`, text });
  log(st, `【即位】${n.name}の${text}`, nid === st.playerNation || av.tier === 3);
  return { ok: true, ...av };
}

export function initGlory(st) {
  st.startYear ??= st.year;
  for (const n of Object.values(st.nations)) n.tier ??= defaultTier(n);
}

// ---------- 季節：地域の平定と AI の即位 ----------
export function gloryTick(st) {
  st.pacified ??= {};
  for (const n of Object.values(st.nations)) n.tier ??= defaultTier(n); // 途中で興った国
  for (const [k, R] of Object.entries(REGIONS)) {
    const o = R.provs.every((p) => st.provinces[p].owner && st.provinces[p].owner === st.provinces[R.provs[0]].owner) ? st.provinces[R.provs[0]].owner : null;
    if (o && st.pacified[k] !== o) {
      st.pacified[k] = o;
      const text = `${nameOf(st, o)}が${R.name}を平定した。`;
      st.chronicle ??= [];
      st.chronicle.push({ id: `region_${k}_${st.turn}`, date: dateStr(st), title: `${R.name}平定`, text });
      log(st, `【${R.name}平定】${text}`, true);
    } else if (!o && st.pacified[k]) delete st.pacified[k];
  }
  for (const n of Object.values(st.nations)) {
    if (!n.alive || n.id === st.playerNation) continue;
    const av = canClaimTitle(st, n.id);
    if (av.ok && n.gold > av.cost * 1.5) claimTitle(st, n.id);
  }
}

// ---------- 勝敗 ----------
export function checkVictory(st) {
  const player = st.playerNation;
  const nat = st.nations[player];
  if (!nat.alive) return { type: 'lose', kind: 'destroyed', text: `${nat.name}は滅亡した……` };
  const mode = victoryMode(st);
  const mine = nationProvinces(st, player).length;
  if (mine >= Math.ceil(PROVINCES.length * VICTORY_SHARE)) return { type: 'win', kind: 'unify', text: `${dateStr(st)}、${nat.name}はユーラシアの大半を手中に収めた！` };
  if (mode === 'hegemony' && regionsHeld(st, player).length >= HEGEMONY_REGIONS) {
    return { type: 'win', kind: 'hegemony', text: `${dateStr(st)}、${nat.name}は${regionsHeld(st, player).map((k) => REGIONS[k].name).join('・')}を平定し、覇王となった！` };
  }
  if (mode === 'deadline' && st.year >= deadlineYear(st)) {
    const rank = ranking(st).findIndex((r) => r.nid === player) + 1;
    return rank === 1
      ? { type: 'win', kind: 'deadline', rank, text: `${st.year}年、${nat.name}は時代の覇者として並ぶものなき国となった。` }
      : { type: 'end', kind: 'deadline', rank, text: `${st.year}年、時代は移ろった。${nat.name}は国力で第${rank}位の国として歴史に名を残した。` };
  }
  return null;
}

// ---------- 結末 ----------
const EPILOGUE = {
  mongol: '草原の騎馬の民は、東西の果てまでを一つの天の下に結んだ。駅伝の早馬が大陸を駆け、隊商は安んじて絹の道を往来した。後の世の人々はこの時代を「パクス・モンゴリカ」と呼んだ。',
  turkic: 'テュルクの騎士たちは草原からオアシスの都まで覇を唱え、その言葉は大陸の諸王の宮廷に響いた。ハーカーンの旗の下で、東と西の商人が行き交った。',
  chinese: '乱世は終わり、天下は再び一つとなった。大運河には米を積んだ船が連なり、市には紙幣が行き交い、書院では新しい学問が花開いた。人々は太平の世の再来を寿いだ。',
  korean: '半島の小国と侮られた国は、海と陸の要を押さえて大国となった。開京の仏寺には大蔵経が納められ、青磁は遠く異国の王の食卓を飾った。',
  japanese: '海を隔てた島国の武士たちは、太刀と弓馬の技をもって大陸に覇を唱えた。鎌倉に開かれた武家の府は、やがて海の彼方の国々までをその威に服させた。',
  tibetan: '雪の国の王は、高原から諸国を見下ろした。仏法は王権と結びつき、ラサの宮殿には各地の使者が膝を折った。',
  islamic: 'スルターンの旗の下、バグダードからサマルカンドまでのモスクで、その名が金曜の説教で唱えられた。学者たちは古の知を受け継ぎ、天文台では星々の運行が測られた。',
  indian: 'ガンジスの王は四海の主（チャクラヴァルティン）となり、その宮廷には詩人と学僧が集った。寺院の塔は天を衝き、香料と宝石の富が国を潤した。',
  european: '西方の王は、ローマの栄光の再来を唱えた。大聖堂の鐘が鳴り響き、騎士たちの武勲は吟遊詩人によって長く歌い継がれた。',
  slavic: '森と川の国の公は、諸公国を束ねて大国を築いた。黄金のドームの聖堂で戴冠した君主は、ツァーリと呼ばれた。',
  greek: '千年の帝国は再び甦った。コンスタンティノープルの城壁は揺るがず、聖ソフィアの穹窿の下で、皇帝は東西の王たちの使節を迎えた。',
  georgian: 'カフカスの山の王国は、諸王の王の名のもとに東西の交わる地を治めた。詩人ルスタヴェリの歌は、その黄金時代をたたえた。',
};

export function ending(st, over) {
  const nid = st.playerNation;
  const n = st.nations[nid];
  const r = st.generals[n.rulerId];
  const heading = over.type === 'win' ? { unify: '天下統一', hegemony: '覇王', deadline: '時代の覇者' }[over.kind] ?? '勝利'
    : over.type === 'end' ? `時代の終わり（第${over.rank}位）` : '滅亡';
  let epi;
  if (over.type === 'win') epi = EPILOGUE[n.culture] ?? EPILOGUE.european;
  else if (over.type === 'end') epi = `天下を一つにする夢は果たせなかったが、${n.name}は群雄の一角として${st.year - (st.startYear ?? st.year)}年の歳月を戦い抜いた。その名は年代記に刻まれ、後の世の人々に語り継がれた。`;
  else {
    const killer = Object.values(st.nations).filter((x) => x.alive).sort((a, b) => nationProvinces(st, b.id).length - nationProvinces(st, a.id).length)[0];
    epi = `${n.name}の旗は地に落ち、その名は歴史の彼方へと消えていった。${killer ? `この時代の主役となったのは、${killer.name}であった。` : ''}`;
  }
  const stats = [
    ['治世', `${st.year - (st.startYear ?? st.year)}年`],
    ['領地', `${nationProvinces(st, nid).length}地方`],
    ['最大の領地', `${peakOf(st, nid, 'provs')}地方`],
    ['最大の兵力', `${peakOf(st, nid, 'soldiers').toLocaleString()}`],
    ['平定した地域', `${regionsHeld(st, nid).length}`],
    ['称号', titleName(st, nid) || 'なし'],
    ['国力', `${scoreOf(st, nid).toLocaleString()}`],
    ['年表の出来事', `${st.chronicle?.length ?? 0}件`],
  ];
  return { heading, epi, stats, ruler: r?.name ?? '', title: titleName(st, nid) };
}
