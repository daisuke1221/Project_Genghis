// ターン進行：AIフェイズ → 季節の経済処理 → 年次イベント → 勝敗判定
import { VICTORY_SHARE, PROVINCES } from './data.js';
import { chance, shuffle, pick } from './rng.js';
import {
  PROV_DEF, NATION_DEF, nationProvinces, nationGenerals, generalsIn, age, log, dateStr, assignBestGovernor,
  randomGeneral, addGeneral,
} from './state.js';
import { cityYields, tickConstruction } from './city.js';
import { aiNationTurn, delegateDevelop } from './ai.js';
import { killGeneral, healTick } from './military.js';
import { tradeTick } from './trade.js';
import { techTick } from './tech.js';
import { royalTick } from './royal.js';
import { courtTick, educationYear } from './court.js';
import { stipendTotal, roninTick, acceptPetition, recommendations, namedRoninTick } from './talent.js';
import { runEvents } from './events.js';
import { diplomacyTick } from './diplomacy.js';
import { siegeTick, flushCaptives } from './siege.js';
import { adminTick } from './admin.js';
import { personnelTick, personnelYear, hasTrait } from './personnel.js';
import { supplyTick, mercTick, fatigueTick } from './warfare.js';
import { researchTick } from './research.js';

export async function endTurn(st, hooks = {}) {
  const player = st.playerNation;
  // AIフェイズ
  const order = shuffle(st, Object.values(st.nations).filter((n) => n.alive && n.id !== player).map((n) => n.id));
  for (const nid of order) {
    if (st.over) break;
    hooks.progress?.(st.nations[nid].name);
    await aiNationTurn(st, nid, hooks);
    checkGameOver(st);
  }
  if (st.nations[player].alive) delegateDevelop(st, player);
  seasonTick(st);
  // 在野の人物の放浪と仕官の申し出
  for (const pr of roninTick(st)) {
    const ok = hooks.proposal ? await hooks.proposal(pr) : false;
    if (ok) acceptPetition(st, pr.gid);
  }
  await flushCaptives(st, hooks);
  advanceTime(st);
  checkGameOver(st);
  if (!st.over) {
    await runEvents(st, hooks);
    checkGameOver(st);
  }
  return st;
}

export function seasonTick(st) {
  const player = st.playerNation;
  const income = {};
  tradeTick(st, (t, imp) => log(st, t, imp));
  siegeTick(st);
  supplyTick(st);
  mercTick(st);
  for (const p of Object.values(st.provinces)) {
    const c = p.city;
    if (!p.owner) {
      c.pop = Math.min(PROV_DEF[p.id].pop * 1.2, Math.round(c.pop * 1.01));
      c.recruited = 0;
      continue;
    }
    const nat = st.nations[p.owner];
    const y = cityYields(st, p.id);
    if (st.sieges?.[p.id]) { y.gold = Math.round(y.gold * 0.3); y.food = Math.round(y.food * 0.3); } // 包囲下では収入が途絶える
    else if (p.cutoff) { y.gold = Math.round(y.gold * 0.5); y.food = Math.round(y.food * 0.5); } // 補給線が断たれると収入が半減
    nat.gold += y.gold;
    nat.food += y.food - y.foodUse;
    income[p.owner] = income[p.owner] || { gold: 0, food: 0 };
    income[p.owner].gold += y.gold;
    income[p.owner].food += y.food - y.foodUse;
    c.horses = Math.min(30000, c.horses + y.horses);
    const done = tickConstruction(st, p.id);
    if (p.owner === player) for (const d of done) log(st, `${PROV_DEF[p.id].city}で${d}が完成した。`);
    // 人口
    if (nat.food > 0 && c.pop < y.popCap) c.pop += Math.round(((y.popCap - c.pop) * 0.05 * (0.4 + c.loyalty / 100) + 30) * y.admin.grow);
    else if (c.pop > y.popCap) c.pop -= Math.round((c.pop - y.popCap) * 0.1);
    // 民忠
    const target = y.loyaltyTarget - (nat.food < 0 ? 25 : 0);
    c.loyalty = Math.max(0, Math.min(100, Math.round(c.loyalty + (target - c.loyalty) * 0.25)));
    c.recruited = 0;
    // 訓練
    for (const g of generalsIn(st, p.id, p.owner)) {
      if (g.unit && g.unit.soldiers > 0) g.unit.training = Math.min(100, g.unit.training + y.train);
    }
    randomEvent(st, p, y);
  }
  // 兵糧と俸給
  for (const nat of Object.values(st.nations)) {
    if (!nat.alive) continue;
    const gens = nationGenerals(st, nat.id);
    const soldiers = gens.reduce((s, g) => s + (g.unit?.soldiers ?? 0), 0);
    nat.food -= Math.round(soldiers * 0.1);
    nat.gold -= Math.round(soldiers * 0.04) + stipendTotal(st, nat.id); // 兵の維持費と武将の俸給
    if (nat.food < 0) {
      for (const g of gens) if (g.unit) g.unit.soldiers = Math.round(g.unit.soldiers * 0.9);
      if (nat.id === player) log(st, '兵糧が尽き、兵の一部が逃亡した！', true);
      nat.food = 0;
    }
    if (nat.gold < 0) {
      nat.gold = 0;
      for (const g of gens) g.loyalty = Math.max(0, g.loyalty - 2);
    }
    nat.lastIncome = income[nat.id] ?? { gold: 0, food: 0 };
    nat.food = Math.min(nat.food, 60000);
  }
  diplomacyTick(st);
  healTick(st);
  techTick(st);
  researchTick(st);
  royalTick(st);
  courtTick(st);
  personnelTick(st);
  fatigueTick(st);
  for (const g of Object.values(st.generals)) g.moved = false;
}

function randomEvent(st, p, y) {
  const c = p.city;
  const def = PROV_DEF[p.id];
  const mine = p.owner === st.playerNation;
  const note = (t) => { if (mine) log(st, `【${def.city}】${t}`, true); };
  const nat = st.nations[p.owner];
  if (st.season === 2 && chance(st, 0.08)) { const f = Math.round(y.food * 0.5); nat.food += f; note(`豊作！食糧+${f}`); }
  else if (st.season === 1 && chance(st, 0.04)) { const f = Math.round(y.food * 0.8); nat.food -= f; note(`蝗害が発生。食糧-${f}`); }
  if (st.season === 3 && def.terrain === 'steppe' && chance(st, 0.12)) {
    c.horses = Math.round(c.horses * 0.6); c.pop = Math.round(c.pop * 0.97); note('寒雪害（ゾド）で家畜が大量に死んだ。');
  }
  if (chance(st, 0.015)) { c.pop = Math.round(c.pop * 0.9); note('疫病が流行し、人口が減少した。'); }
  adminTick(st, p.id, y, note);
  if (c.loyalty < 25 && chance(st, 0.3 * (c.order < 40 ? 1.5 : c.order > 70 ? 0.5 : 1))) {
    nat.gold = Math.max(0, nat.gold - 150); c.pop = Math.round(c.pop * 0.95); c.loyalty += 12;
    note('民衆が反乱を起こした！鎮圧に金を費やした。');
  }
}

export function advanceTime(st) {
  st.turn += 1;
  st.season = (st.season + 1) % 4;
  if (st.season === 0) {
    st.year += 1;
    yearlyEvents(st);
  }
}

function yearlyEvents(st) {
  const player = st.playerNation;
  for (const g of Object.values(st.generals)) {
    if (!g.alive) continue;
    const a = age(st, g);
    if (a >= 50) {
      const p = Math.pow((a - 50) / 35, 2) * 0.45;
      if (chance(st, p)) {
        const nat = g.nation ? st.nations[g.nation] : null;
        if (nat?.id === player || (nat && nat.rulerId === g.id)) log(st, `${nat.name}の${g.name}が${a}歳で病没した。`, nat.id === player);
        killGeneral(st, g.id);
        continue;
      }
    }
    if (a === 15 && g.nation) {
      if (st.nations[g.nation]?.alive) {
        g.province = st.nations[g.nation].capital;
        if (g.nation === player) log(st, `${g.name}が元服し、出仕できるようになった。`, true);
      } else g.nation = null;
    }
    // 忠誠の低い武将の出奔
    if (g.nation && st.nations[g.nation]?.rulerId !== g.id && !g.family && !hasTrait(g, 'loyal') && g.loyalty < 35 && chance(st, 0.25)) {
      if (g.nation === player) log(st, `${g.name}が出奔した！`, true);
      g.formerNation = g.nation;
      const p = st.provinces[g.province];
      g.nation = null; g.unit = null;
      if (p?.governorId === g.id) assignBestGovernor(st, p.id);
    }
  }
  personnelYear(st, (t, imp) => log(st, t, imp));
  educationYear(st);
  recommendations(st);
  namedRoninTick(st);
  // 在野武将の補充（少しずつ新しい人材が現れる）
  const ronin = Object.values(st.generals).filter((g) => g.alive && !g.nation).length;
  for (let i = ronin; i < 16; i += 1) {
    const p = pick(st, PROVINCES);
    const owner = st.provinces[p.id].owner;
    const g = randomGeneral(st, null, owner ? st.nations[owner].culture : 'mongol');
    g.province = p.id;
    addGeneral(st, g);
    if (i - ronin >= 2) break;
  }
}

export function checkGameOver(st) {
  if (st.over) return st.over;
  const player = st.playerNation;
  if (!st.nations[player].alive) {
    st.over = { type: 'lose', text: `${st.nations[player].name}は滅亡した……` };
    return st.over;
  }
  const mine = nationProvinces(st, player).length;
  if (mine >= Math.ceil(PROVINCES.length * VICTORY_SHARE)) {
    st.over = { type: 'win', text: `${dateStr(st)}、${st.nations[player].name}はユーラシアの大半を手中に収めた！` };
  }
  return st.over;
}

