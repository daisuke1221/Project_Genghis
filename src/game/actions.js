// プレイヤー・AI共通の軍事行動（出陣→戦闘→戦後処理）
import { planMove, moveGenerals, occupy, applyBattle, resolveCaptive, aiCaptiveDecision } from './military.js';
import { createBattle, autoResolve } from './battle.js';
import { declareWar, joinWar, refuseCall, atWar, friendsOf, noteConquest } from './diplomacy.js';
import { log, PROV_DEF, generalsIn, unitCap } from './state.js';
import { NEIGHBORS } from './geo.js';
import { siegeAt, canBesiege, startSiege, assault, relieve, aiChooseSiege } from './siege.js';

// 参戦要請の処理（プレイヤーへの要請は hooks.callToArms で尋ねる）
export async function handleCalls(st, calls, hooks = {}) {
  for (const c of calls) {
    const ok = hooks.callToArms ? await hooks.callToArms(c) : false;
    if (ok) joinWar(st, c.ally, c.caller, c.enemy);
    else refuseCall(st, c.ally, c.caller);
  }
}

// 隣接地方にいる味方（同盟国・宗主・従属国）の援軍。プレイヤーの武将は当事者のときだけ
export function gatherReinforcements(st, nid, enemy, target, max = 2) {
  const friends = friendsOf(st, nid).filter((f) => atWar(st, f, enemy) && f !== st.playerNation);
  const out = [];
  for (const q of NEIGHBORS[target]) {
    const o = st.provinces[q].owner;
    if (!friends.includes(o)) continue;
    const gens = generalsIn(st, q, o).filter((g) => !g.moved && g.unit?.soldiers >= unitCap(g) * 0.4 && !(g.wound > st.turn));
    if (gens.length < 2) continue; // 自国の守りを空にはしない
    gens.sort((a, b) => b.unit.soldiers - a.unit.soldiers);
    out.push(...gens.slice(0, gens.length - 1));
  }
  return out.sort((a, b) => b.unit.soldiers - a.unit.soldiers).slice(0, max).map((g) => g.id);
}

// hooks.battle(battle) -> Promise<battleResult>   プレイヤーが関わる戦闘
// hooks.captives(captor, gids) -> Promise<{gid: decision}>
export async function executeMove(st, nid, gids, from, to, hooks = {}) {
  const owner = st.provinces[to].owner;
  const plan = planMove(st, nid, gids, to);
  if (plan.kind === 'invalid') return plan;
  if (plan.kind === 'move') {
    // 包囲されている自領への移動は後詰めの合戦になる
    const sg = siegeAt(st, to);
    if (sg && owner === nid && gids.some((id) => st.generals[id]?.unit?.soldiers > 0)) {
      const r = await relieve(st, nid, gids, from, to, hooks);
      return { kind: 'relief', ...r };
    }
    moveGenerals(st, gids, to);
    return plan;
  }
  if (owner && !atWar(st, nid, owner)) await handleCalls(st, declareWar(st, nid, owner), hooks);
  const involved = nid === st.playerNation || owner === st.playerNation;
  // 城壁のある都市：強襲か包囲かを選ぶ
  if (plan.kind === 'battle' && canBesiege(st, nid, to)) {
    const existing = siegeAt(st, to);
    if (existing && existing.att !== nid) return { kind: 'invalid', reason: '他の勢力が包囲中です' };
    const mode = nid === st.playerNation && hooks.attackMode
      ? await hooks.attackMode({ nid, gids, to, from, existing: !!existing })
      : aiChooseSiege(st, nid, [...gids, ...(existing?.gids ?? [])], to);
    if (mode === 'cancel') return { kind: 'cancel' };
    startSiege(st, nid, gids, to, from);
    if (mode === 'siege') return { kind: 'siege' };
    for (const id of gids) if (st.generals[id]) st.generals[id].moved = false;
    const r = await assault(st, to, hooks);
    for (const id of gids) if (st.generals[id]) st.generals[id].moved = true;
    return { kind: 'battle', result: r.result, fell: r.fell };
  }
  if (plan.kind === 'occupy') {
    const captives = occupy(st, nid, gids, to, from);
    if (owner) noteConquest(st, nid, owner);
    log(st, `${st.nations[nid].name}軍が${PROV_DEF[to].city}を占領した。`, involved);
    await handleCaptives(st, nid, captives, hooks);
    return { kind: 'occupy', captives };
  }
  const reinforce = { att: gatherReinforcements(st, nid, owner, to), def: gatherReinforcements(st, owner, nid, to) };
  const b = createBattle(st, { attNation: nid, attIds: gids, provinceId: to, fromProvince: from, reinforce });
  const result = involved && hooks.battle ? await hooks.battle(b) : autoResolve(b);
  const { msgs, captives } = applyBattle(st, result, gids);
  for (const id of [...reinforce.att, ...reinforce.def]) if (st.generals[id]) st.generals[id].moved = true;
  if (result.winner === 'att') noteConquest(st, nid, owner);
  for (const m of msgs) log(st, m, involved);
  const captor = result.winner === 'att' ? nid : owner;
  await handleCaptives(st, captor, captives, hooks);
  return { kind: 'battle', result, msgs, captives };
}

export async function handleCaptives(st, captor, captives, hooks = {}) {
  if (!captives?.length) return {};
  let decisions;
  if (captor === st.playerNation && hooks.captives) decisions = await hooks.captives(captor, captives);
  else decisions = Object.fromEntries(captives.map((id) => [id, aiCaptiveDecision(st, captor, st.generals[id])]));
  const outcomes = {};
  for (const id of captives) {
    const name = st.generals[id].name;
    const r = resolveCaptive(st, captor, id, decisions[id] ?? 'release');
    outcomes[id] = r;
    if (captor === st.playerNation) {
      const t = { recruited: `${name}が配下に加わった。`, refused: `${name}は登用を拒み、去っていった。`, released: `${name}を解放した。`, executed: `${name}を処断した。` }[r];
      log(st, t, true);
    }
  }
  return outcomes;
}
