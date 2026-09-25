// プレイヤー・AI共通の軍事行動（出陣→戦闘→戦後処理）
import { planMove, moveGenerals, occupy, applyBattle, resolveCaptive, aiCaptiveDecision } from './military.js';
import { createBattle, autoResolve } from './battle.js';
import { breakTreaty } from './diplomacy.js';
import { treaty, log, PROV_DEF } from './state.js';

// hooks.battle(battle) -> Promise<battleResult>   プレイヤーが関わる戦闘
// hooks.captives(captor, gids) -> Promise<{gid: decision}>
export async function executeMove(st, nid, gids, from, to, hooks = {}) {
  const owner = st.provinces[to].owner;
  const plan = planMove(st, nid, gids, to);
  if (plan.kind === 'invalid') return plan;
  if (plan.kind === 'move') { moveGenerals(st, gids, to); return plan; }
  if (owner && treaty(st, nid, owner)) breakTreaty(st, nid, owner);
  const involved = nid === st.playerNation || owner === st.playerNation;
  if (plan.kind === 'occupy') {
    const captives = occupy(st, nid, gids, to, from);
    log(st, `${st.nations[nid].name}軍が${PROV_DEF[to].city}を占領した。`, involved);
    await handleCaptives(st, nid, captives, hooks);
    return { kind: 'occupy', captives };
  }
  const b = createBattle(st, { attNation: nid, attIds: gids, provinceId: to, fromProvince: from });
  const result = involved && hooks.battle ? await hooks.battle(b) : autoResolve(b);
  const { msgs, captives } = applyBattle(st, result, gids);
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
