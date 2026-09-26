// 信仰ダイアログ：国教と権威・信任・寄進・贖罪・聖戦・改宗、各地の災害
import { modal, esc, fmt, toast, statBar, confirmBox } from './ui.js';
import { audio } from '../audio/audio.js';
import { PROV_DEF, nationProvinces } from '../game/state.js';
import { RELIGIONS, nationReligion } from '../game/admin.js';
import {
  AUTHORITIES, authorityOf, seatOf, protectorOf, pietyOf, isBanned, donate, DONATIONS, penanceCost, doPenance,
  holyWarTargets, canCallHolyWar, callHolyWar, HOLY_WAR_COST, activeHolyWar, conversionOptions, canConvertNation, convertNation,
} from '../game/faith.js';
import { calamityTags } from '../game/calamity.js';

export function faithDialog(app) {
  const st = app.st, nid = st.playerNation;
  return modal({
    title: '信仰と災害',
    width: '820px',
    body: (el) => {
      const render = () => {
        const n = st.nations[nid];
        const rel = nationReligion(st, nid);
        const A = authorityOf(rel);
        const seat = A ? seatOf(st, rel) : null;
        const prot = A ? protectorOf(st, rel) : null;
        const piety = pietyOf(st, nid);
        const banned = isBanned(st, nid);
        let html = `<div class="row muted" style="gap:14px;margin-bottom:8px"><span>金 <b>${fmt(n.gold)}</b></span><span>国教 <b>${RELIGIONS[rel].name}</b>${RELIGIONS[rel].tolerant ? '（寛容：異教徒も不満を持たない）' : ''}</span></div>`;
        if (A) {
          html += `<div class="sect"><b>${A.title}</b>：${seat ? `${PROV_DEF[seat].city}（${esc(st.nations[prot].name)}${prot === nid ? '・<span class="pos">我が国が保護者</span>' : 'が保護'}）${seat !== A.seat ? ' <span class="neg">移座中</span>' : ''}` : '<span class="neg">空位</span>'}
            <div class="grid2" style="margin-top:4px"><span>信任</span><span>${banned ? `<span class="neg">${A.ban}（あと${n.ban.until - st.turn}季）</span>` : `${piety} ${statBar(piety, 100, '#c8b070')}`}</span></div>
            <p class="muted small">信任が高いほど、${RELIGIONS[rel].name}の地方の民忠が上がります（50を基準に±4、保護者は+2）。寄進・布教・異教徒の地の征服・聖戦で上がり、同じ信仰の国を攻めたり条約を破ったり、${A.title}を擁する国と戦ったりすると下がります。${A.ban ? `信任が尽きると${A.ban}され、民忠-10・家臣の忠誠低下・同じ信仰の国との外交が難しくなります。` : ''}</p>
            <div class="row" style="gap:6px">${banned
              ? `<button class="btn" data-penance="1" ${n.gold >= penanceCost(st, nid) ? '' : 'disabled'}>贖罪する（${fmt(penanceCost(st, nid))}金）</button>`
              : DONATIONS.map((g) => `<button class="btn small" data-donate="${g}" ${n.gold >= g && seat ? '' : 'disabled'}>寄進 ${fmt(g)}金</button>`).join('')}</div></div>`;
          if (A.holyWar) {
            const hw = activeHolyWar(st, rel);
            const ts = holyWarTargets(st, rel);
            const can = canCallHolyWar(st, nid);
            html += `<div class="sect"><b>${A.holyWar}</b> ${hw ? `：<span class="neg">${esc(hw.name)}</span>（${esc(hw.why)}・参加：${hw.members.map((m) => esc(st.nations[m]?.name ?? '')).join('、') || 'なし'}・あと${hw.until - st.turn}季）` : ''}
              <p class="muted small">${A.title}を擁する国（または信任85以上の国）は、聖地や座所を奪った異教徒、破門された国に対して${A.holyWar}を呼びかけられます（${HOLY_WAR_COST}金）。同じ信仰の国々が加わって宣戦し、兵の訓練度+5・信任+10。${HOLY_WAR_TERM_TEXT}目的の地方を取れば、参加国は信任+15と褒賞300金を得ます。呼びかけに応じないと信任が下がります。</p>
              ${ts.length ? `<div class="row" style="gap:6px;flex-wrap:wrap">${ts.map((t) => {
                const c = canCallHolyWar(st, nid, t.target);
                return `<button class="btn small" data-holy="${t.target}" ${c.ok ? '' : 'disabled'} title="${esc(c.ok ? '' : c.reason)}">${esc(st.nations[t.target].name)}へ（${esc(t.why)}）</button>`;
              }).join('')}</div>${can.ok ? '' : `<div class="muted small">${esc(can.reason)}</div>`}` : '<div class="muted small">いまは聖戦の大義となる相手がいません。</div>'}</div>`;
          }
        } else html += `<div class="sect muted">${RELIGIONS[rel].name}には、国々を束ねる宗教の権威はありません。</div>`;
        // 改宗
        const opts = conversionOptions(st, nid);
        html += `<div class="sect"><b>国教を改める</b> <span class="muted small">領内の4割以上がその信仰なら改宗できます。家臣の忠誠-10、新しい信仰の国とは友好+15、元の信仰の国とは-15。</span>
          ${opts.length ? `<div class="row" style="gap:6px;margin-top:4px">${opts.map((o) => { const c = canConvertNation(st, nid, o.rel); return `<button class="btn small" data-convert="${o.rel}" ${c.ok ? '' : 'disabled'} title="${esc(c.ok ? '' : c.reason)}">${RELIGIONS[o.rel].name}（領内の${Math.round(o.share * 100)}%）</button>`; }).join('')}</div>` : '<div class="muted small">改宗できる信仰はありません。</div>'}</div>`;
        // 世界の権威
        html += `<div class="sect"><b>諸宗教の権威</b><table class="list"><tr><th>権威</th><th>座所</th><th>保護者</th><th>聖戦</th></tr>
          ${Object.entries(AUTHORITIES).map(([r, a]) => { const s = seatOf(st, r), p = protectorOf(st, r), hw = activeHolyWar(st, r); return `<tr><td>${a.title}（${RELIGIONS[r].name}）</td><td>${s ? PROV_DEF[s].city : '<span class="neg">空位</span>'}${s && s !== a.seat ? ' <span class="muted small">移座</span>' : ''}</td><td>${p ? `<span class="swatch" style="background:${st.nations[p].color}"></span>${esc(st.nations[p].name)}` : '―'}</td><td class="small">${hw ? esc(hw.name) : a.holyWar ? '<span class="muted">なし</span>' : '<span class="muted">―</span>'}</td></tr>`; }).join('')}</table></div>`;
        // 災害
        const hit = nationProvinces(st, nid).map((p) => [p.id, calamityTags(st, p.id)]).filter(([, t]) => t.length);
        html += `<div class="sect"><b>領内の災害</b> <span class="muted small">疫病は隣の地方や交易路を通って広がります。都市の「内政命令・税率」から施療・封鎖を、飢饉の地では施しを。</span>
          ${hit.length ? `<table class="list">${hit.map(([pid, t]) => `<tr><td>${PROV_DEF[pid].city}</td><td class="neg">${t.join('・')}</td></tr>`).join('')}</table>` : '<div class="muted small">いまのところ領内に災害はありません。</div>'}</div>`;
        el.innerHTML = html;
      };
      el.onclick = async (e) => {
        const d = e.target.closest('[data-donate]')?.dataset.donate;
        if (d) {
          const r = donate(st, nid, Number(d));
          if (r.ok) { audio.sfx('coin'); toast(`寄進した（信任+${r.gain}）`); } else toast(r.reason);
          render(); app.renderTopbar(); return;
        }
        if (e.target.closest('[data-penance]')) {
          const r = doPenance(st, nid);
          if (r.ok) { audio.sfx('coin'); toast('贖罪が認められた'); } else toast(r.reason);
          render(); app.renderTopbar(); return;
        }
        const h = e.target.closest('[data-holy]')?.dataset.holy;
        if (h) {
          if (!await confirmBox('聖戦の呼びかけ', `${st.nations[h].name}への聖戦を呼びかけますか？ ${st.nations[h].name}と戦争になります。`)) return;
          const r = await callHolyWar(st, nid, h, app.hooks);
          if (r.ok) { audio.sfx('horn'); toast(`${r.hw.name}を呼びかけた`); } else toast(r.reason);
          render(); app.renderTopbar(); app.refresh(); return;
        }
        const c = e.target.closest('[data-convert]')?.dataset.convert;
        if (c) {
          if (!await confirmBox('国教を改める', `国教を${RELIGIONS[c].name}に改めますか？ 家臣の忠誠が下がり、元の信仰の国々との関係が悪化します。`)) return;
          const r = convertNation(st, nid, c);
          if (r.ok) { audio.sfx('build'); toast(`国教を${RELIGIONS[c].name}に改めた`); } else toast(r.reason);
          render(); app.refresh();
        }
      };
      render();
    },
  });
}

const HOLY_WAR_TERM_TEXT = '期限は3年。';
