// 内政：税率・治安・治水・商業・宗教と文化、武将による内政命令
import { PROVINCES, NATIONS, CULTURES } from './data.js';
import { chance, rnd, pick } from './rng.js';
import { PROV_CULTURE } from './tech.js';
import { hasTrait, chancellorBonus, gainExp, addMerit } from './personnel.js';
import { knows } from './research.js';
import { calamityMods, plagueOf, famineOf, cureChance, cure, relieveFamine, aiQuarantine } from './calamity.js';
import { faithMods, onConverted } from './faith.js';

export const TAX_LEVELS = [
  { name: '軽税', mul: 0.6, loyalty: 10, order: 4, grow: 1.3, desc: '税収60%・民忠↑・人口が増えやすい' },
  { name: '普通', mul: 1, loyalty: 0, order: 0, grow: 1, desc: '標準の税' },
  { name: '重税', mul: 1.4, loyalty: -10, order: -5, grow: 0.8, desc: '税収140%・民忠↓' },
  { name: '苛税', mul: 1.8, loyalty: -22, order: -12, grow: 0.5, desc: '税収180%・民忠と治安が大きく下がり、人口も減りやすい' },
];

export const RELIGIONS = {
  tengri: { name: 'テングリ信仰', tolerant: true },
  nestorian: { name: '景教' },
  buddhism: { name: '仏教' },
  islam: { name: 'イスラーム' },
  catholic: { name: 'カトリック' },
  orthodox: { name: '正教' },
  hindu: { name: 'ヒンドゥー教' },
};

const R = (religion, ids) => Object.fromEntries(ids.split(' ').map((id) => [id, religion]));
// 1189年ごろの各地方の主な信仰
export const PROV_RELIGION = {
  ...R('catholic', 'eng fra ger ita pol hun'),
  ...R('orthodox', 'gre byz kie nov vla geo'),
  ...R('islam', 'bul rum syr egy irq aze ira kho khw sam gha bal kas'),
  ...R('hindu', 'ind'),
  ...R('tengri', 'kip kaz mer kiy tat hn'),
  ...R('nestorian', 'nai ker ong'),
  ...R('buddhism', 'uig tib gan xia ty jz kf ly kor sy sc song gz dal kyu jpw jpe osh'),
};
for (const p of PROVINCES) PROV_RELIGION[p.id] ??= 'tengri';

const CULTURE_RELIGION = {
  mongol: 'tengri', turkic: 'tengri', chinese: 'buddhism', korean: 'buddhism', japanese: 'buddhism', tibetan: 'buddhism',
  islamic: 'islam', indian: 'hindu', european: 'catholic', slavic: 'orthodox', greek: 'orthodox', georgian: 'orthodox',
};
const NATION_RELIGION = { kereit: 'nestorian', naiman: 'nestorian', ongud: 'nestorian', uighur: 'buddhism', poland: 'catholic', hungary: 'catholic', bulgar: 'islam' };
for (const n of NATIONS) NATION_RELIGION[n.id] ??= CULTURE_RELIGION[n.culture];

export const provReligion = (st, pid) => st.provinces[pid].religion ?? PROV_RELIGION[pid];
export const provCulture = (pid) => PROV_CULTURE[pid];
export function nationReligion(st, nid) {
  const n = st.nations[nid];
  return n?.religion ?? NATION_RELIGION[nid] ?? CULTURE_RELIGION[n?.culture] ?? 'tengri';
}

// 旧セーブにない項目の既定値
export function adminOf(c) {
  c.tax ??= 1;
  c.order ??= 60;
  c.irrigation ??= 0;
  c.commerce ??= 0;
  return c;
}

function garrison(st, pid, nid) {
  let n = 0;
  for (const g of Object.values(st.generals)) {
    if (g.alive && g.province === pid && g.nation === nid && !g.captiveOf) n += g.unit?.soldiers ?? 0;
  }
  return n;
}

// 民忠・治安の目標値への補正と、産出への倍率
export function adminMods(st, pid) {
  const p = st.provinces[pid];
  const c = adminOf(p.city);
  const nid = p.owner;
  const T = TAX_LEVELS[c.tax];
  const loyalty = [];
  const order = [];
  if (T.loyalty) loyalty.push([T.name, T.loyalty]);
  if (c.almsUntil > st.turn) loyalty.push(['施し', 5]);
  if (nid) {
    const rel = provReligion(st, pid), mine = nationReligion(st, nid);
    const patron = c.patron > st.turn;
    if (patron) loyalty.push(['寺社保護', 6]);
    else if (rel !== mine && !RELIGIONS[mine].tolerant) loyalty.push([`異教の支配（${RELIGIONS[rel].name}）`, -10]);
    const cul = provCulture(pid);
    if (cul !== st.nations[nid].culture) {
      const pen = Math.max(0, 6 - Math.floor((st.turn - (c.since ?? -99)) / 8));
      if (pen) loyalty.push([`異民族の支配（${CULTURES[cul].name}）`, -pen]);
    }
    const gov = p.governorId ? st.generals[p.governorId] : null;
    const gs = Math.min(25, Math.round(garrison(st, pid, nid) / 200));
    if (gs) order.push(['駐屯兵', gs]);
    const barracks = p.city.grid.filter((t) => t.b?.type === 'barracks' && t.b.progress >= 1).length;
    if (barracks) order.push(['兵舎', barracks * 4]);
    order.push(gov ? ['太守の武力', Math.round((gov.war - 50) / 5)] : ['太守不在', -5]);
    if (gov && hasTrait(gov, 'benevolent')) loyalty.push(['太守の仁政', 5]);
    if (gov?.fief === pid && gov.family) loyalty.push(['王族の封地', 6]);
    if (knows(st, nid, 'printing')) loyalty.push(['印刷術', 2]);
    order.push(['民忠', Math.round((c.loyalty - 50) / 4)]);
    if (T.order) order.push([T.name, T.order]);
    if (st.sieges?.[pid]) order.push(['包囲', -15]);
    loyalty.push(...faithMods(st, pid));
  }
  const cm = calamityMods(st, pid);
  loyalty.push(...cm.loyalty);
  order.push(...cm.order);
  const sum = (a) => a.reduce((s, [, v]) => s + v, 0);
  return {
    loyalty, order,
    loyaltyAdj: sum(loyalty),
    orderTarget: Math.max(0, Math.min(100, 40 + sum(order))),
    taxMul: T.mul,
    goldMul: (0.85 + c.order / 400) * (1 + c.commerce / 400) * (1 + chancellorBonus(st, nid)) * (govMerchant(st, p) ? 1.1 : 1) * cm.goldMul,
    farmMul: (1 + c.irrigation / 400) * cm.farmMul,
    grow: T.grow * cm.grow,
  };
}

function govMerchant(st, p) {
  const g = p.governorId ? st.generals[p.governorId] : null;
  return g && hasTrait(g, 'merchant');
}

// ---- 内政命令 ----
export const COMMANDS = {
  alms: { name: '施し', stat: 'cha', desc: '食糧を配って民忠を上げる（1年間、民忠の目標+5）' },
  patrol: { name: '巡察', stat: 'war', desc: '城下を見回って治安を上げる（兵を率いていると効果大）' },
  irrigate: { name: '治水', stat: 'pol', desc: '堤と用水路を整える。農地の食糧が増え、洪水が起きにくくなる' },
  commerce: { name: '商業振興', stat: 'pol', desc: '市を開き商人を招く。金の収入が増える' },
  patronize: { name: '寺社保護', stat: 'cha', desc: '土地の信仰を手厚く保護する（2年間、民忠の目標+6・異教の不満なし）' },
  convert: { name: '布教', stat: 'pol', desc: '国教を広める。成功すれば地方の信仰が変わるが、民忠が下がる' },
  cure: { name: '施療', stat: 'pol', desc: '医師と薬を集めて疫病の手当てをする。成功すれば病が一段軽くなり、失敗してもその季節の被害が半分になる' },
};
export const COMMAND_ORDER = ['alms', 'patrol', 'irrigate', 'commerce', 'patronize', 'convert', 'cure'];

export function commandCost(st, pid, kind) {
  const c = st.provinces[pid].city;
  switch (kind) {
    case 'alms': return { food: Math.max(200, Math.round(c.pop * 0.04)) };
    case 'patrol': return { gold: 50 };
    case 'irrigate': return { gold: 150 + Math.round(adminOf(c).irrigation * 3) };
    case 'commerce': return { gold: 150 + Math.round(adminOf(c).commerce * 3) };
    case 'patronize': return { gold: 200 + Math.round(c.pop * 0.01) };
    case 'convert': return { gold: 300 + Math.round(c.pop * 0.01) };
    case 'cure': return { gold: 150 + Math.round(c.pop * 0.008) };
  }
  return {};
}

export function commandAvailable(st, pid, kind) {
  const p = st.provinces[pid];
  const c = adminOf(p.city);
  const nat = st.nations[p.owner];
  if (!nat) return { ok: false, reason: '空白地です' };
  if ((c.acts?.turn === st.turn) && c.acts.done.includes(kind)) return { ok: false, reason: 'この季節は実施済み' };
  if (st.sieges?.[pid]) return { ok: false, reason: '包囲されています' };
  const cost = commandCost(st, pid, kind);
  if (cost.gold && nat.gold < cost.gold) return { ok: false, reason: '金が足りません' };
  if (cost.food && nat.food < cost.food) return { ok: false, reason: '食糧が足りません' };
  if (kind === 'irrigate' && c.irrigation >= 100) return { ok: false, reason: '治水は万全です' };
  if (kind === 'commerce' && c.commerce >= 100) return { ok: false, reason: '商業は最大です' };
  if (kind === 'patronize' && c.patron > st.turn) return { ok: false, reason: '保護中です' };
  if (kind === 'convert') {
    const mine = nationReligion(st, p.owner);
    if (RELIGIONS[mine].tolerant) return { ok: false, reason: `${RELIGIONS[mine].name}は布教をしません` };
    if (provReligion(st, pid) === mine) return { ok: false, reason: 'すでに同じ信仰です' };
  }
  if (kind === 'cure' && !plagueOf(st, pid)) return { ok: false, reason: '疫病は起きていません' };
  return { ok: true };
}

export const canAdminister = (st, g) => g && g.alive && !g.moved && !g.captiveOf && !(g.wound > st.turn);

// 命令の効果の見込み（UI表示用）
export function commandEffect(st, pid, kind, g) {
  const s = g[COMMANDS[kind].stat];
  const troops = (g.unit?.soldiers ?? 0) > 0;
  switch (kind) {
    case 'alms': return { loyalty: Math.round(4 + s / 12) + (famineOf(st, pid) ? 4 : 0) };
    case 'patrol': return { order: Math.round(5 + s / 8 + (troops ? 5 : 0)) };
    case 'irrigate': return { irrigation: Math.round((6 + s / 8) * (knows(st, st.provinces[pid].owner, 'qanat') ? 1.5 : 1)) };
    case 'commerce': return { commerce: Math.round(6 + s / 8) };
    case 'patronize': return { loyalty: Math.round(2 + s / 25) };
    case 'convert': return { chance: Math.min(0.8, 0.15 + s / 350 + (st.provinces[pid].city.loyalty - 50) / 250), loyalty: -8 };
    case 'cure': return { chance: cureChance(st, pid, g) };
  }
  return {};
}

export function doCommand(st, pid, kind, gid) {
  const g = st.generals[gid];
  const p = st.provinces[pid];
  if (!canAdminister(st, g) || g.province !== pid || g.nation !== p.owner) return { ok: false, reason: 'その武将は動けません' };
  const av = commandAvailable(st, pid, kind);
  if (!av.ok) return av;
  const c = p.city;
  const nat = st.nations[p.owner];
  const cost = commandCost(st, pid, kind);
  nat.gold -= cost.gold ?? 0;
  nat.food -= cost.food ?? 0;
  const e = commandEffect(st, pid, kind, g);
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
  let text = '';
  switch (kind) {
    case 'alms': c.loyalty = clamp(c.loyalty + e.loyalty); c.almsUntil = st.turn + 4; text = `民忠+${e.loyalty}${relieveFamine(st, pid) ? '・飢えた民を救い、飢饉が早く明ける' : ''}`; break;
    case 'patrol': c.order = clamp(c.order + e.order); text = `治安+${e.order}`; break;
    case 'irrigate': c.irrigation = clamp(c.irrigation + e.irrigation); text = `治水+${e.irrigation}`; break;
    case 'commerce': c.commerce = clamp(c.commerce + e.commerce); text = `商業+${e.commerce}`; break;
    case 'patronize': c.patron = st.turn + 8; c.loyalty = clamp(c.loyalty + e.loyalty); text = `民忠+${e.loyalty}・2年間保護`; break;
    case 'convert': {
      c.loyalty = clamp(c.loyalty + e.loyalty);
      if (rnd(st) < e.chance) {
        p.religion = nationReligion(st, p.owner);
        delete c.patron;
        text = `布教に成功し、この地方は${RELIGIONS[p.religion].name}に改宗した（民忠${e.loyalty}）`;
        onConverted(st, p.owner);
      } else text = `布教は実らなかった（民忠${e.loyalty}）`;
      break;
    }
    case 'cure': text = cure(st, pid, g).text; break;
  }
  if (c.acts?.turn !== st.turn) c.acts = { turn: st.turn, done: [] };
  c.acts.done.push(kind);
  g.moved = true;
  // 経験：内政に使った能力が少しずつ伸びる
  const stat = COMMANDS[kind].stat;
  gainExp(st, g, stat, 25);
  addMerit(g, 3);
  return { ok: true, text };
}

// ---- 季節の更新 ----
export function adminTick(st, pid, y, note) {
  const p = st.provinces[pid];
  const c = adminOf(p.city);
  const m = adminMods(st, pid);
  c.order = Math.max(0, Math.min(100, Math.round(c.order + (m.orderTarget - c.order) * 0.2)));
  const nat = st.nations[p.owner];
  // 盗賊
  if (c.order < 30 && chance(st, 0.35 - c.order / 100)) {
    const loss = Math.min(nat.gold, Math.round(80 + c.pop * 0.01));
    nat.gold -= loss;
    note(`治安が乱れ、盗賊が横行している（金-${loss}）`);
  }
  // 洪水（夏、川のある都市。治水で防げる）
  if (st.season === 1 && c.grid.some((t) => t.t === 'river') && chance(st, 0.07 * (1 - c.irrigation / 100))) {
    const f = Math.round(y.food * 0.5);
    nat.food = Math.max(0, nat.food - f);
    c.pop = Math.round(c.pop * 0.97);
    const farms = [];
    c.grid.forEach((t, i) => { if (t.b?.type === 'farm' && t.b.progress >= 1 && riverSide(c, i)) farms.push(t); });
    const hit = farms.length ? pick(st, farms) : null;
    if (hit) { if (hit.b.level > 1) hit.b.level -= 1; else hit.b = null; }
    note(`川が氾濫した！食糧-${f}${hit ? '、川沿いの農地が流された' : ''}`);
  }
}

function riverSide(c, i) {
  const x = i % 9, yy = Math.floor(i / 9);
  return [[x + 1, yy], [x - 1, yy], [x, yy + 1], [x, yy - 1]].some(([a, b]) => a >= 0 && b >= 0 && a < 9 && b < 9 && c.grid[b * 9 + a].t === 'river');
}

// 所有者が変わったとき
export function adminOnConquest(st, pid) {
  const c = adminOf(st.provinces[pid].city);
  c.since = st.turn;
  c.order = Math.min(c.order, 30);
  c.commerce = Math.round(c.commerce * 0.6);
  c.tax = 1;
  delete c.patron; delete c.almsUntil;
}

// ---- AI（委任都市を含む） ----
export function aiAdmin(st, nid, pids, { reserve = 300 } = {}) {
  const nat = st.nations[nid];
  aiQuarantine(st, nid, pids);
  for (const pid of pids) {
    const p = st.provinces[pid];
    if (p.owner !== nid) continue;
    const c = adminOf(p.city);
    // 税率
    if (c.loyalty < 40) c.tax = 0;
    else if (nat.gold < 300 && c.loyalty > 60) c.tax = 2;
    else if (c.loyalty > 75 && nat.gold < 4000) c.tax = 2;
    else if (c.loyalty >= 50) c.tax = 1;
    // 手の空いた武将に一つだけ命令する
    const gens = Object.values(st.generals).filter((g) => g.nation === nid && g.province === pid && canAdminister(st, g));
    if (!gens.length) continue;
    const best = (stat) => gens.reduce((a, b) => (b[stat] > a[stat] ? b : a));
    const m = adminMods(st, pid);
    const want = [];
    if (plagueOf(st, pid)) want.push('cure');
    if (famineOf(st, pid) && nat.food > 2000) want.push('alms');
    if (c.loyalty < 45 && nat.food > 3000) want.push('alms');
    if (c.order < 45) want.push('patrol');
    if (m.loyalty.some(([l]) => l.startsWith('異教'))) want.push(nat.gold > 2500 && chance(st, 0.3) ? 'convert' : 'patronize');
    if (nat.gold > reserve + 400) {
      if (c.commerce < 60) want.push('commerce');
      if (c.irrigation < 50 && c.grid.some((t) => t.t === 'river')) want.push('irrigate');
    }
    for (const kind of want) {
      if (!commandAvailable(st, pid, kind).ok) continue;
      if (doCommand(st, pid, kind, best(COMMANDS[kind].stat).id).ok) break;
    }
  }
}
