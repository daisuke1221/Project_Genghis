// 外交：贈物・同盟・停戦・破棄
import { chance, rnd } from './rng.js';
import { nationGenerals, nationProvinces, unitPower, treaty, relation, log } from './state.js';
import { adjustRelation } from './military.js';
import { NEIGHBORS } from './geo.js';

export const TRUCE_TURNS = 12;

export function nationPower(st, nid) {
  return nationGenerals(st, nid).reduce((s, g) => s + unitPower(g), 0) + nationProvinces(st, nid).length * 400;
}

export function areNeighbors(st, a, b) {
  return nationProvinces(st, a).some((p) => NEIGHBORS[p.id].some((q) => st.provinces[q].owner === b));
}

export function gift(st, from, to, gold) {
  const n = st.nations[from];
  if (n.gold < gold || gold <= 0) return { ok: false, reason: '金が足りません' };
  n.gold -= gold;
  st.nations[to].gold += gold;
  const gain = Math.min(25, Math.round(gold / 25));
  adjustRelation(st, from, to, gain);
  return { ok: true, gain };
}

export function acceptChance(st, target, from, kind) {
  const rel = relation(st, target, from);
  const pf = nationPower(st, from), pt = nationPower(st, target);
  const ratio = pf / Math.max(1, pt);
  const aggro = st.nations[target].aggro;
  if (kind === 'alliance') {
    let p = (rel - 25) / 60 + (ratio > 1 ? 0.15 : -0.1) - aggro * 0.2;
    return Math.max(0, Math.min(0.95, p));
  }
  // 停戦
  let p = (rel + 20) / 70 + (ratio > 1.3 ? 0.3 : ratio < 0.7 ? -0.2 : 0) - aggro * 0.15;
  return Math.max(0, Math.min(0.95, p));
}

export function propose(st, from, to, kind) {
  if (treaty(st, from, to)) return { ok: false, reason: 'すでに条約があります' };
  const p = acceptChance(st, to, from, kind);
  const ok = chance(st, p);
  if (ok) {
    const t = kind === 'alliance' ? { type: 'alliance' } : { type: 'truce', until: st.turn + TRUCE_TURNS };
    st.nations[from].treaties[to] = { ...t };
    st.nations[to].treaties[from] = { ...t };
    adjustRelation(st, from, to, 10);
    log(st, `${st.nations[from].name}と${st.nations[to].name}が${kind === 'alliance' ? '同盟' : '停戦'}を結んだ。`);
  } else {
    adjustRelation(st, from, to, -3);
  }
  return { ok, chance: p };
}

// 相手が受け入れた場合の締結（AI→プレイヤーの提案用）
export function sign(st, a, b, kind) {
  const t = kind === 'alliance' ? { type: 'alliance' } : { type: 'truce', until: st.turn + TRUCE_TURNS };
  st.nations[a].treaties[b] = { ...t };
  st.nations[b].treaties[a] = { ...t };
  adjustRelation(st, a, b, 10);
  log(st, `${st.nations[a].name}と${st.nations[b].name}が${kind === 'alliance' ? '同盟' : '停戦'}を結んだ。`);
}

export function breakTreaty(st, from, to) {
  const t = treaty(st, from, to);
  if (!t) return false;
  delete st.nations[from].treaties[to];
  delete st.nations[to].treaties[from];
  adjustRelation(st, from, to, -40);
  for (const n of Object.values(st.nations)) if (n.alive && n.id !== from && n.id !== to) adjustRelation(st, from, n.id, -5);
  log(st, `${st.nations[from].name}が${st.nations[to].name}との${t === 'alliance' ? '同盟' : '停戦'}を破棄した。`, true);
  return true;
}

// AIの外交。プレイヤー宛ての提案を返す
export function aiDiplomacy(st, nid) {
  const out = [];
  const me = st.nations[nid];
  if (!chance(st, 0.12)) return out;
  const others = Object.values(st.nations).filter((n) => n.alive && n.id !== nid && areNeighbors(st, nid, n.id));
  if (!others.length) return out;
  const target = others[Math.floor(rnd(st) * others.length)];
  if (treaty(st, nid, target.id)) return out;
  const rel = relation(st, nid, target.id);
  const myPow = nationPower(st, nid), theirPow = nationPower(st, target.id);
  let kind = null;
  if (rel > 35 && me.aggro < 0.7) kind = 'alliance';
  else if (theirPow > myPow * 1.4) kind = 'truce';
  if (!kind) return out;
  if (target.id === st.playerNation) out.push({ from: nid, kind });
  else propose(st, nid, target.id, kind);
  return out;
}
