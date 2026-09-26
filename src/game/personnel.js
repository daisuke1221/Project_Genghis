// 人事：特技・位階と功績・能力の成長・役職・忠誠と相性・調略（引き抜き／内応）・謀反
import { NEIGHBORS } from './geo.js';
import { PROVINCES } from './data.js';
import { assignBestGovernor } from './state.js';
import { chance, rnd, rint, pick } from './rng.js';

export const TRAITS = {
  horsearch: { name: '騎射', desc: '弓騎兵を率いると攻撃+15%' },
  charge: { name: '突撃', desc: '騎馬の突撃がさらに強い（×1.3→×1.45）' },
  ironwall: { name: '鉄壁', desc: '守りが15%堅い' },
  fortify: { name: '築城', desc: '城に拠って守ると守りがさらに15%堅い' },
  hero: { name: '豪傑', desc: '一騎討ちで武力+10として戦う' },
  cunning: { name: '智謀', desc: '計略の回数+1・成功率+10%' },
  drill: { name: '練兵', desc: '率いる兵の訓練が毎季+4' },
  benevolent: { name: '仁政', desc: '太守のとき民忠の目標+5' },
  merchant: { name: '商才', desc: '太守のとき金の収入+10%' },
  eloquent: { name: '弁舌', desc: '登用・調略の成功率+15%' },
  loyal: { name: '忠義', desc: '忠誠の目標+15。出奔・謀反・寝返りをしない' },
  ambitious: { name: '野心', desc: '忠誠の目標-12。不満がたまると謀反を起こす' },
};
const TRAIT_POOL = ['horsearch', 'charge', 'ironwall', 'fortify', 'hero', 'cunning', 'drill', 'benevolent', 'merchant', 'eloquent', 'loyal', 'ambitious'];

const NAMED_TRAITS = {
  テムジン: ['cunning', 'eloquent'], カサル: ['horsearch', 'hero'], ボオルチュ: ['loyal', 'ironwall'], ジェルメ: ['loyal', 'hero'],
  ムカリ: ['loyal', 'cunning'], ジェベ: ['horsearch', 'charge'], スブタイ: ['cunning', 'charge'], ジョチ: ['horsearch'], チャガタイ: ['drill'],
  オゴデイ: ['benevolent', 'eloquent'], トルイ: ['charge'], ジャムカ: ['ambitious', 'charge'], セングム: ['ambitious'],
  クチュルク: ['ambitious', 'hero'], コリ・スベチ: ['hero'], 耶律楚材: ['benevolent', 'merchant'], 完顔陳和尚: ['hero', 'charge'],
  完顔承暉: ['loyal'], 紇石烈執中: ['ambitious'], 嵬名令公: ['fortify'], 辛棄疾: ['cunning', 'loyal'], 韓侂冑: ['ambitious'],
  畢再遇: ['hero', 'cunning'], 孟珙: ['fortify', 'loyal'], 崔忠献: ['ambitious', 'cunning'], 李義旼: ['ambitious', 'hero'],
  源頼朝: ['cunning', 'eloquent'], 北条時政: ['ambitious', 'cunning'], 北条義時: ['cunning'], 梶原景時: ['eloquent'],
  畠山重忠: ['loyal', 'hero'], 和田義盛: ['hero'], 三浦義村: ['ambitious'], 源義経: ['charge', 'cunning'], 武蔵坊弁慶: ['hero', 'loyal'],
  テキシュ: ['drill'], テルケン・ハトゥン: ['ambitious', 'eloquent'], ティムール・マリク: ['hero', 'fortify'], イナルチュク: ['ambitious'],
  ジャラールッディーン: ['hero', 'charge'], ムイッズッディーン: ['charge'], アイバク: ['ambitious', 'drill'], バフティヤール: ['charge'],
  プリトヴィーラージ: ['hero', 'charge'], ナースィル: ['eloquent', 'cunning'], サラーフッディーン: ['benevolent', 'cunning'],
  アーディル: ['eloquent', 'merchant'], タキーユッディーン: ['hero'], カラクーシュ: ['fortify'], タマル: ['benevolent', 'eloquent'],
  ダヴィト・ソスラン: ['charge'], テオドロス・ラスカリス: ['fortify'], コンチャク: ['horsearch'], ロマン: ['charge'], ムスチスラフ: ['hero'],
  フセヴォロド: ['drill'], フリードリヒ: ['charge', 'drill'], フィリップ2世: ['cunning', 'merchant'], ギヨーム・デ・バレ: ['hero'],
  リチャード: ['hero', 'fortify'], ジョン: ['ambitious'], ウィリアム・マーシャル: ['loyal', 'hero'], メルカディエ: ['drill'],
};

export const RANKS = [
  { name: '無位', merit: 0 },
  { name: '十人長', merit: 30 },
  { name: '百人長', merit: 100 },
  { name: '千人長', merit: 250 },
  { name: '万人長', merit: 500 },
];

export const ROLES = {
  chancellor: { name: '宰相', stat: 'pol', desc: '全都市の金の収入が増える（政治50を超えた分×0.2%）' },
  strategist: { name: '軍師', stat: 'pol', desc: '出陣した合戦で敵の伏兵を見破り、味方全軍の計略の成功率+10%' },
  marshal: { name: '大将軍', stat: 'lead', desc: '出陣した合戦で味方全軍の士気+10' },
};
export const ROLE_ORDER = ['chancellor', 'strategist', 'marshal'];

// 名前とIDから決まる疑似乱数（ゲームの乱数を消費しない）
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// 旧セーブや新しく生まれた武将に人事の項目を補う
export function ensurePersonnel(g) {
  if (!g || g.traits) return g;
  const h = (k) => hash(`${g.id}:${g.name}:${k}`);
  if (NAMED_TRAITS[g.name]) g.traits = [...NAMED_TRAITS[g.name]];
  else {
    g.traits = [];
    const n = h('n') < 0.08 ? 2 : h('n') < 0.4 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const t = TRAIT_POOL[Math.floor(h(`t${i}`) * TRAIT_POOL.length)];
      if (!g.traits.includes(t) && !(t === 'loyal' && g.traits.includes('ambitious')) && !(t === 'ambitious' && g.traits.includes('loyal'))) g.traits.push(t);
    }
  }
  g.aff ??= Math.floor(h('aff') * 150);
  const best = Math.max(g.war, g.lead, g.pol);
  g.rank ??= best >= 90 ? 3 : best >= 80 ? 2 : best >= 65 ? 1 : 0;
  g.merit ??= RANKS[g.rank].merit + Math.floor(h('m') * 20);
  g.exp ??= { war: 0, lead: 0, pol: 0, cha: 0 };
  return g;
}

export const hasTrait = (g, t) => !!ensurePersonnel(g)?.traits.includes(t);

// 新規ゲーム：名のある家臣は主君と相性が良く、野心家は悪い
export function initPersonnel(st) {
  for (const g of Object.values(st.generals)) ensurePersonnel(g);
  for (const n of Object.values(st.nations)) {
    const r = st.generals[n.rulerId];
    if (!r) continue;
    for (const g of Object.values(st.generals)) {
      if (g.nation !== n.id || g === r || !g.named) continue;
      const off = hasTrait(g, 'ambitious') ? 50 + Math.floor(hash(g.id) * 25) : hasTrait(g, 'loyal') || g.family ? Math.floor(hash(g.id) * 10) : Math.floor(hash(g.id) * 35);
      g.aff = (r.aff + (hash(`${g.id}s`) < 0.5 ? off : 150 - off)) % 150;
    }
    autoRoles(st, n.id);
  }
}

// 相性：0〜75（小さいほど良い）
export function affDist(a, b) {
  const d = Math.abs(ensurePersonnel(a).aff - ensurePersonnel(b).aff) % 150;
  return Math.min(d, 150 - d);
}
export function affMark(d) { return d < 15 ? '◎' : d < 35 ? '○' : d < 55 ? '△' : '×'; }

// ---- 役職 ----
export function roleOf(st, g) {
  const r = st.nations[g.nation]?.roles;
  if (!r) return null;
  return ROLE_ORDER.find((k) => r[k] === g.id) ?? null;
}
export function roleHolder(st, nid, role) {
  const n = st.nations[nid];
  const id = n?.roles?.[role];
  const g = id ? st.generals[id] : null;
  if (!g || !g.alive || g.nation !== nid || g.captiveOf) { if (n?.roles) delete n.roles[role]; return null; }
  return g;
}
export function appoint(st, nid, role, gid) {
  const n = st.nations[nid];
  n.roles ??= {};
  const prev = roleHolder(st, nid, role);
  if (prev?.id === gid) return;
  if (prev) prev.loyalty = Math.max(0, prev.loyalty - 8);
  for (const k of ROLE_ORDER) if (n.roles[k] === gid) delete n.roles[k];
  if (!gid) { delete n.roles[role]; return; }
  n.roles[role] = gid;
  const g = st.generals[gid];
  g.loyalty = Math.min(100, g.loyalty + 10);
}
export function autoRoles(st, nid) {
  const n = st.nations[nid];
  const pool = Object.values(st.generals).filter((g) => g.nation === nid && g.alive && !g.captiveOf && g.id !== n.rulerId && st.year - g.birth >= 15);
  const used = new Set();
  const score = {
    chancellor: (g) => g.pol * 2 + g.cha,
    strategist: (g) => g.pol * 2 + g.lead + (hasTrait(g, 'cunning') ? 40 : 0),
    marshal: (g) => g.lead * 2 + g.war + (hasTrait(g, 'loyal') ? 20 : 0),
  };
  const next = {};
  for (const role of ['strategist', 'marshal', 'chancellor']) {
    const best = pool.filter((g) => !used.has(g.id)).sort((a, b) => score[role](b) - score[role](a))[0];
    if (best) { next[role] = best.id; used.add(best.id); }
  }
  n.roles ??= {};
  for (const role of ROLE_ORDER) {
    if (roleHolder(st, nid, role)) { used.add(n.roles[role]); continue; }
    if (next[role] && !ROLE_ORDER.some((k) => n.roles[k] === next[role])) appoint(st, nid, role, next[role]);
  }
}

export function chancellorBonus(st, nid) {
  const g = nid ? roleHolder(st, nid, 'chancellor') : null;
  return g ? Math.max(0, g.pol - 50) / 500 : 0;
}

// ---- 功績・位階・能力の成長 ----
export function gainExp(st, g, stat, amount) {
  ensurePersonnel(g);
  const a = st.year - g.birth;
  const m = a <= 25 ? 1.5 : a >= 55 ? 0.5 : 1;
  g.exp[stat] = (g.exp[stat] ?? 0) + amount * m;
  let up = 0;
  while (g.exp[stat] >= 100 && g[stat] < 100) { g.exp[stat] -= 100; g[stat] += 1; up++; }
  if (g[stat] >= 100) g.exp[stat] = 0;
  return up;
}
export function addMerit(g, n) { ensurePersonnel(g).merit += n; }
export const canPromote = (g) => ensurePersonnel(g).rank < RANKS.length - 1 && g.merit >= RANKS[g.rank + 1].merit;
export const promoteCost = (g) => 100 * (ensurePersonnel(g).rank + 1);
export function promote(st, gid) {
  const g = st.generals[gid];
  const nat = st.nations[g.nation];
  if (!canPromote(g)) return { ok: false, reason: '功績が足りません' };
  const cost = promoteCost(g);
  if (nat.gold < cost) return { ok: false, reason: '金が足りません' };
  nat.gold -= cost;
  g.rank += 1;
  g.loyalty = Math.min(100, g.loyalty + 8);
  return { ok: true, rank: RANKS[g.rank].name };
}
export const rankCapMul = (g) => 1 + 0.05 * (g.rank ?? 0);

// 合戦のあと：功績・経験・寝返った武将の移籍
export function battleAftermath(st, result) {
  for (const u of result.units) {
    const g = st.generals[u.gid];
    if (!g?.alive) continue;
    const won = u.side === result.winner;
    g.fatigue = Math.min(100, (g.fatigue ?? 0) + 20);
    addMerit(g, (won ? 12 : 4) + (u.commander && won ? 10 : 0) + (u.duelWins ?? 0) * 15);
    gainExp(st, g, 'lead', won ? 20 : 10);
    gainExp(st, g, 'war', 10 + (u.duelWins ?? 0) * 30);
    if (u.turncoat && !u.dead) defect(st, g, u.newNation, result.provinceId);
  }
}

// 武将を他勢力へ移籍させる
export function defect(st, g, nid, near) {
  const old = g.nation;
  g.nation = nid;
  g.loyalty = 55 + rint(st, 0, 15);
  delete g.betray; delete g.betrayUntil; delete g.besieging; delete g.exposed;
  for (const p of Object.values(st.provinces)) if (p.governorId === g.id) { p.governorId = null; if (p.owner === old) assignBestGovernor(st, p.id); }
  if (old && st.nations[old]?.roles) for (const k of ROLE_ORDER) if (st.nations[old].roles[k] === g.id) delete st.nations[old].roles[k];
  const own = (q) => st.provinces[q]?.owner === nid;
  if (near && own(near)) g.province = near;
  else g.province = (near && NEIGHBORS[near].find(own)) ?? (NEIGHBORS[g.province] ?? []).find(own) ?? st.nations[nid].capital;
}

// ---- 忠誠 ----
export function loyaltyTarget(st, g) {
  ensurePersonnel(g);
  const nat = st.nations[g.nation];
  const r = nat ? st.generals[nat.rulerId] : null;
  const items = [['基本', 45]];
  if (r && r !== g) {
    items.push(['君主の魅力', Math.round((r.cha - 50) / 4)]);
    const d = affDist(g, r);
    items.push([`相性${affMark(d)}`, Math.round(8 - d / 4)]);
  }
  if (g.rank) items.push([RANKS[g.rank].name, g.rank * 2]);
  if (roleOf(st, g)) items.push([ROLES[roleOf(st, g)].name, 10]);
  if (canPromote(g)) items.push(['功に報いられていない', -8]);
  if (hasTrait(g, 'loyal')) items.push(['忠義', 15]);
  if (hasTrait(g, 'ambitious')) items.push(['野心', -12]);
  if (nat && nat.gold <= 0) items.push(['俸給の遅れ', -10]);
  const target = Math.max(0, Math.min(100, items.reduce((s, [, v]) => s + v, 0)));
  return { target, items };
}

// 季節ごと：忠誠が目標へ近づく、練兵の訓練
export function personnelTick(st) {
  for (const g of Object.values(st.generals)) {
    if (!g.alive || !g.nation || g.captiveOf) continue;
    ensurePersonnel(g);
    const nat = st.nations[g.nation];
    if (!nat?.alive) continue;
    if (hasTrait(g, 'drill') && g.unit?.soldiers > 0) g.unit.training = Math.min(100, g.unit.training + 4);
    if (nat.rulerId === g.id || g.family) { g.loyalty = Math.max(g.loyalty, nat.rulerId === g.id ? 100 : 90); continue; }
    const t = loyaltyTarget(st, g).target;
    if (g.loyalty < t) g.loyalty += Math.min(2, t - g.loyalty);
    else if (g.loyalty > t) g.loyalty -= Math.min(3, g.loyalty - t);
    if (g.betrayUntil && g.betrayUntil <= st.turn) { delete g.betray; delete g.betrayUntil; delete g.exposed; }
  }
}

// 毎年：加齢・若者の成長、AIの昇進と役職、謀反
export function personnelYear(st, onLog) {
  for (const g of Object.values(st.generals)) {
    if (!g.alive) continue;
    const a = st.year - g.birth;
    if (a >= 60 && chance(st, 0.5)) g.war = Math.max(10, g.war - 1);
    if (a >= 65 && chance(st, 0.3)) g.lead = Math.max(10, g.lead - 1);
    if (a >= 15 && a <= 25 && chance(st, 0.5)) { const s = pick(st, ['war', 'lead', 'pol', 'cha']); if (g[s] < 100) g[s] += 1; }
  }
  for (const n of Object.values(st.nations)) {
    if (!n.alive) continue;
    if (n.id !== st.playerNation) {
      autoRoles(st, n.id);
      for (const g of Object.values(st.generals)) {
        if (g.nation === n.id && g.alive && canPromote(g) && n.gold > promoteCost(g) + 500) promote(st, g.id);
      }
    }
    rebellions(st, n.id, onLog);
  }
}

export function rebelRisk(st, g) {
  const n = st.nations[g.nation];
  if (!n || n.rulerId === g.id || g.family || hasTrait(g, 'loyal')) return 0;
  if (g.loyalty >= (hasTrait(g, 'ambitious') ? 40 : 28)) return 0;
  const p = Object.values(st.provinces).find((q) => q.governorId === g.id && q.owner === g.nation);
  if (!p || p.id === n.capital) return 0;
  if (Object.values(st.provinces).filter((q) => q.owner === g.nation).length < 3) return 0;
  return (hasTrait(g, 'ambitious') ? 0.25 : 0.1) + (40 - g.loyalty) / 100;
}

let rebelHook = null;
export function setRebelHook(fn) { rebelHook = fn; }

function rebellions(st, nid, onLog) {
  for (const g of Object.values(st.generals)) {
    if (!g.alive || g.nation !== nid || g.captiveOf) continue;
    const risk = rebelRisk(st, g);
    if (!risk || !chance(st, risk)) continue;
    const p = Object.values(st.provinces).find((q) => q.governorId === g.id);
    const with_ = Object.values(st.generals).filter((x) => x.alive && x.province === p.id && x.nation === nid && x !== g && !x.family && !hasTrait(x, 'loyal') && x.loyalty < 45);
    const nat = rebelHook?.(st, g, p.id, [g.id, ...with_.map((x) => x.id)]);
    const city = PROVINCES.find((q) => q.id === p.id).city;
    if (nat) onLog?.(`${st.nations[nid].name}の${g.name}が${city}で謀反を起こし、「${nat.name}」として自立した！`, true);
    return;
  }
}

// ---- 調略 ----
export const SUBVERT_COST = 300;
export function subvertChance(st, agent, target, mode) {
  ensurePersonnel(target);
  const tn = st.nations[target.nation];
  if (!tn || tn.rulerId === target.id || target.family || hasTrait(target, 'loyal')) return 0;
  const r = st.generals[st.nations[agent.nation].rulerId];
  let p = 0.05 + (agent.cha - 50) / 200 + (70 - target.loyalty) / 100;
  if (r) { const d = affDist(target, r); p += d < 20 ? 0.1 : d > 50 ? -0.1 : 0; }
  if (hasTrait(agent, 'eloquent')) p += 0.15;
  if (hasTrait(target, 'ambitious')) p += 0.1;
  if (roleOf(st, target)) p -= 0.15;
  if (mode === 'betray') p += 0.1;
  return Math.max(0, Math.min(0.85, p));
}

// 調略を仕掛けられる相手：自領に隣接する他国の地方にいる武将
export function subvertTargets(st, nid) {
  const out = [];
  const own = new Set(Object.values(st.provinces).filter((p) => p.owner === nid).map((p) => p.id));
  for (const g of Object.values(st.generals)) {
    if (!g.alive || !g.nation || g.nation === nid || g.captiveOf || g.hostageOf || st.year - g.birth < 15) continue;
    if (!NEIGHBORS[g.province]?.some((q) => own.has(q))) continue;
    out.push(g);
  }
  return out;
}
export function subvertAgents(st, nid, target) {
  return Object.values(st.generals).filter((g) => g.nation === nid && g.alive && !g.moved && !g.captiveOf && !(g.wound > st.turn)
    && st.year - g.birth >= 15 && (g.province === target.province || NEIGHBORS[target.province]?.includes(g.province)));
}

// mode: 'hire'（引き抜き）| 'betray'（内応の約束）
export function subvert(st, agentId, targetId, mode) {
  const agent = st.generals[agentId], target = st.generals[targetId];
  const nid = agent.nation, nat = st.nations[nid];
  if (nat.gold < SUBVERT_COST) return { ok: false, reason: '金が足りません' };
  if (target.subvertTried === `${nid}:${st.turn}`) return { ok: false, reason: 'この季節はもう仕掛けました' };
  nat.gold -= SUBVERT_COST;
  agent.moved = true;
  target.subvertTried = `${nid}:${st.turn}`;
  const p = subvertChance(st, agent, target, mode);
  const old = target.nation;
  if (rnd(st) < p) {
    addMerit(agent, 10);
    gainExp(st, agent, 'cha', 20);
    if (mode === 'hire') {
      const det = plotDetected(st, old, nid);
      if (det) {
        target.loyalty = Math.min(100, target.loyalty + 5);
        adjustRel(st, nid, old, -10);
        return { ok: true, success: false, foiled: det.name, text: `${target.name}は誘いに乗りかけたが、${st.nations[old].name}の軍師${det.name}に見破られた。` };
      }
      const keep = target.unit ? Math.round(target.unit.soldiers * 0.5 / 10) * 10 : 0;
      defect(st, target, nid, agent.province);
      if (target.unit) target.unit.soldiers = keep;
      adjustRel(st, nid, old, -15);
      return { ok: true, success: true, text: `${target.name}は誘いに応じ、兵${keep}を連れて寝返った！` };
    }
    target.betray = nid;
    target.betrayUntil = st.turn + 8;
    const det = plotDetected(st, old, nid);
    if (det) {
      if (old === st.playerNation) target.exposed = nid;
      else { delete target.betray; delete target.betrayUntil; target.loyalty = Math.min(100, target.loyalty + 5); }
      return { ok: true, success: true, exposed: det.name, text: `${target.name}は内応を約束した……が、${st.nations[old].name}の軍師${det.name}に露見したようだ。` };
    }
    return { ok: true, success: true, text: `${target.name}は内応を約束した。2年以内に${st.nations[old].name}と合戦になれば、こちらに寝返る。` };
  }
  target.loyalty = Math.min(100, target.loyalty + 5);
  adjustRel(st, nid, old, -10);
  return { ok: true, success: false, text: `${target.name}は誘いを拒み、主君に報告した。` };
}

// 謀略の察知：狙われた国の軍師が見破る（仕掛けた側の軍師が優れていると見破りにくい）
export function plotDetected(st, victim, agentNid) {
  const s = victim ? roleHolder(st, victim, 'strategist') : null;
  if (!s) return null;
  const their = agentNid ? roleHolder(st, agentNid, 'strategist') : null;
  const p = Math.max(0.05, Math.min(0.85, 0.15 + s.pol / 200 - (their ? their.pol / 400 : 0)));
  return rnd(st) < p ? s : null;
}

// 内通が露見した家臣への処置
export function interrogateChance(st, g) {
  const r = st.generals[st.nations[g.nation].rulerId];
  return Math.max(0.1, Math.min(0.9, 0.3 + (r?.cha ?? 50) / 250 + g.loyalty / 250));
}
export function interrogate(st, gid) {
  const g = st.generals[gid];
  const to = g.betray;
  if (!to) { delete g.exposed; return { ok: false, reason: '内通していません' }; }
  if (rnd(st) < interrogateChance(st, g)) {
    delete g.betray; delete g.betrayUntil; delete g.exposed;
    g.loyalty = Math.min(100, g.loyalty + 8);
    return { ok: true, success: true, text: `${g.name}は非を認め、二心を捨てると誓った。` };
  }
  const keep = g.unit ? Math.round(g.unit.soldiers * 0.5 / 10) * 10 : 0;
  delete g.exposed;
  if (st.nations[to]?.alive) {
    defect(st, g, to, g.province);
    if (g.unit) g.unit.soldiers = keep;
    return { ok: true, success: false, text: `${g.name}は問い詰められて出奔し、兵${keep}を連れて${st.nations[to].name}へ走った！` };
  }
  banish(st, gid);
  return { ok: true, success: false, text: `${g.name}は出奔した。` };
}
export function banish(st, gid) {
  const g = st.generals[gid];
  const old = g.nation;
  for (const k of ROLE_ORDER) if (st.nations[old]?.roles?.[k] === g.id) delete st.nations[old].roles[k];
  g.nation = null; g.unit = null;
  delete g.betray; delete g.betrayUntil; delete g.exposed; delete g.besieging;
  for (const p of Object.values(st.provinces)) if (p.governorId === g.id) { p.governorId = null; if (p.owner === old) assignBestGovernor(st, p.id); }
  return { ok: true, text: `${g.name}を追放した。` };
}

function adjustRel(st, a, b, d) {
  const na = st.nations[a], nb = st.nations[b];
  if (!na || !nb) return;
  const v = Math.max(-100, Math.min(100, (na.relations[b] ?? 0) + d));
  na.relations[b] = v; nb.relations[a] = v;
}

// AI：敵対する隣国の不満を抱えた武将に調略を仕掛ける
export function aiSubvert(st, nid, onLog) {
  const nat = st.nations[nid];
  if (nat.gold < 1500 || !chance(st, 0.15)) return;
  const enemies = subvertTargets(st, nid).filter((g) => (nat.relations[g.nation] ?? 0) < -20 && g.loyalty < 60);
  let best = null;
  for (const t of enemies) {
    const agents = subvertAgents(st, nid, t);
    if (!agents.length) continue;
    const a = agents.sort((x, y) => y.cha - x.cha)[0];
    const mode = t.unit?.soldiers > 1000 && chance(st, 0.6) ? 'betray' : 'hire';
    const p = subvertChance(st, a, t, mode);
    if (p > 0.3 && (!best || p > best.p)) best = { a, t, mode, p };
  }
  if (!best) return;
  const victim = best.t.nation;
  const r = subvert(st, best.a.id, best.t.id, best.mode);
  if (!r.ok) return;
  if (victim === st.playerNation) {
    if (r.foiled) onLog?.(`軍師${r.foiled}が${st.nations[nid].name}の調略を見破り、${best.t.name}の引き抜きを未然に防いだ。`, true);
    else if (r.exposed) onLog?.(`軍師${r.exposed}の探索で、${best.t.name}が${st.nations[nid].name}に内応を約束していることが分かった！（家臣団で処置できます）`, true);
    else if (!r.success) onLog?.(`${st.nations[nid].name}が${best.t.name}に調略を仕掛けたが、${best.t.name}は拒んで報告してきた。`, true);
    else if (best.mode === 'hire') onLog?.(`${best.t.name}が${st.nations[nid].name}に寝返った！`, true);
  }
}
