// 水軍ダイアログ：港の軍船・造船・制海権
import { modal, esc, fmt, toast } from './ui.js';
import { audio } from '../audio/audio.js';
import { PROV_DEF } from '../game/state.js';
import {
  SEAS, seasOf, shipsAt, navalSkill, admiralAt, fleetPower, canBuildShips, buildShips, scuttle, SHIP_COST, SHIP_UPKEEP, PORT_CAP,
  BUILD_PER_SEASON, blockadedBy, seaControl,
} from '../game/navy.js';

export function navyDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  return modal({
    title: `${PROV_DEF[pid].city}の水軍`,
    width: '720px',
    body: (el) => {
      const render = () => {
        const n = st.nations[nid];
        const ships = shipsAt(st, pid);
        const adm = admiralAt(st, pid);
        const blk = blockadedBy(st, pid);
        el.innerHTML = `<div class="row muted" style="gap:14px;margin-bottom:8px"><span>金 <b>${fmt(n.gold)}</b></span><span>操船 ×${navalSkill(st, nid)}</span></div>
          <div class="grid2"><span>軍船</span><span><b>${ships}</b> / ${PORT_CAP}隻 <span class="muted">（維持費 毎季${SHIP_UPKEEP}金/隻）</span></span>
            <span>水軍の将</span><span>${adm ? `${esc(adm.name)}（統率${adm.lead}）` : '<span class="muted">なし（この港にいる最も統率の高い武将が率いる）</span>'}</span>
            <span>戦力</span><span>${Math.round(fleetPower(st, pid))}</span>
            ${blk ? `<span>封鎖</span><span class="neg">${esc(st.nations[blk].name)}の水軍に封鎖されている（金の収入-25%・海路の交易が止まる）</span>` : ''}</div>
          <div class="row" style="gap:6px;margin:8px 0">${[5, 10].map((k) => { const av = canBuildShips(st, pid, k); return `<button class="btn" data-build="${k}" ${av.ok ? '' : 'disabled'} title="${esc(av.reason ?? '')}">${k}隻造る（${fmt(SHIP_COST * k)}金）</button>`; }).join('')}
            <button class="btn small" data-scuttle="5" ${ships >= 5 ? '' : 'disabled'}>5隻を解く</button></div>
          <p class="muted small">1季に${BUILD_PER_SEASON}隻まで。操船の巧みさは文化で決まり（ギリシア・高麗・漢・西欧が得意、遊牧民は不得手）、港を持つ征服地の船大工も使えます。羅針盤で1割増し。<br>
            ・海を渡って敵地へ攻め込むと、敵とその味方の水軍が同じ海にいれば海戦になり、敗れると兵を失って引き返します。自国の軍船が護衛すれば勝ちやすくなります。<br>
            ・同じ海で戦争中の国の水軍どうしは季節ごとに戦います。最も強い水軍を持つ国が<b>制海権</b>を握り（${10}隻相当以上）、戦争相手の港を封鎖します。<br>
            ・軍船が${10}隻以上いる港からの海路は、嵐や海賊の危険が半分になります。夏と秋の日本近海では、大風が攻め寄せる船団を襲うことがあります。</p>
          <div class="sect"><b>制海権</b><table class="list"><tr><th>海</th><th>制海権</th><th>港</th></tr>
            ${seasOf(pid).map((s) => { const c = seaControl(st, s); return `<tr><td>${SEAS[s].name}</td><td>${c ? `<span class="swatch" style="background:${st.nations[c].color}"></span>${esc(st.nations[c].name)}` : '<span class="muted">なし</span>'}</td>
              <td class="small">${SEAS[s].ports.map((q) => { const o = st.provinces[q].owner; return `${PROV_DEF[q].city}${o ? `（${esc(st.nations[o].name)}${shipsAt(st, q) ? `・${shipsAt(st, q)}隻` : ''}）` : ''}`; }).join('、')}</td></tr>`; }).join('')}</table></div>`;
      };
      el.onclick = (e) => {
        const b = e.target.closest('[data-build]')?.dataset.build;
        if (b) { const r = buildShips(st, pid, Number(b)); if (r.ok) { audio.sfx('build'); toast(`軍船を${b}隻造った`); } else toast(r.reason); render(); app.renderTopbar(); return; }
        const s = e.target.closest('[data-scuttle]')?.dataset.scuttle;
        if (s) { scuttle(st, pid, Number(s)); render(); }
      };
      render();
    },
  });
}
