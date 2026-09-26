// 内政ダイアログ：税率・治安・治水・商業・宗教、武将による内政命令
import { modal, esc, fmt, toast, statBar } from './ui.js';
import { audio } from '../audio/audio.js';
import { CULTURES } from '../game/data.js';
import { PROV_DEF, generalsIn } from '../game/state.js';
import { cityYields } from '../game/city.js';
import {
  TAX_LEVELS, RELIGIONS, COMMANDS, COMMAND_ORDER, adminOf, adminMods, provReligion, provCulture, nationReligion,
  commandCost, commandAvailable, commandEffect, doCommand, canAdminister,
} from '../game/admin.js';

const STAT = { war: '武', pol: '政', cha: '魅' };
const sign = (v) => (v > 0 ? `+${v}` : `${v}`);
const mods = (list) => list.map(([l, v]) => `<span class="${v >= 0 ? 'pos' : 'neg'}">${esc(l)}${sign(v)}</span>`).join('・') || '<span class="muted">なし</span>';

export function adminDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  let gid = null;
  return modal({
    title: `${PROV_DEF[pid].city}の内政`,
    width: '780px',
    body: (el) => {
      const render = () => {
        const p = st.provinces[pid], c = adminOf(p.city), nat = st.nations[nid];
        const y = cityYields(st, pid);
        const m = adminMods(st, pid);
        const rel = provReligion(st, pid), mine = nationReligion(st, nid), cul = provCulture(pid);
        const gens = generalsIn(st, pid, nid);
        const free = gens.filter((g) => canAdminister(st, g));
        if (!free.some((g) => g.id === gid)) gid = free[0]?.id ?? null;
        const g = gid ? st.generals[gid] : null;
        const tagCost = (k) => { const q = commandCost(st, pid, k); return q.gold ? `${fmt(q.gold)}金` : `食糧${fmt(q.food)}`; };
        const tagEff = (k) => {
          if (!g) return '';
          const e = commandEffect(st, pid, k, g);
          if (k === 'convert') return `成功率${Math.round(e.chance * 100)}%・民忠${e.loyalty}`;
          return Object.entries(e).map(([key, v]) => `${{ loyalty: '民忠', order: '治安', irrigation: '治水', commerce: '商業' }[key]}+${v}`).join('・');
        };
        el.innerHTML = `<div class="row muted" style="gap:14px;margin-bottom:8px"><span>金 <b>${fmt(nat.gold)}</b></span><span>食糧 <b>${fmt(nat.food)}</b></span>
            <span>人口 ${fmt(c.pop)}</span><span>今季の収入 金${fmt(y.gold)}（税${fmt(y.tax)}）</span></div>
          <table class="list admin-stats">
            <tr><td>民忠</td><td>${c.loyalty} → 目標${Math.min(100, y.loyaltyTarget)}</td><td>${statBar(c.loyalty)}</td><td class="small">${mods(m.loyalty)}</td></tr>
            <tr><td>治安</td><td>${c.order} → 目標${m.orderTarget}</td><td>${statBar(c.order, 100, '#7aa0d8')}</td><td class="small">${mods(m.order)}<br><span class="muted">金の収入×${(0.85 + c.order / 400).toFixed(2)}。30未満で盗賊、低いと反乱が起きやすい</span></td></tr>
            <tr><td>治水</td><td>${c.irrigation}</td><td>${statBar(c.irrigation, 100, '#5ab0d0')}</td><td class="small">食糧+${Math.round(c.irrigation / 4)}%・${c.grid.some((t) => t.t === 'river') ? `夏の洪水の危険 ${Math.round(7 * (1 - c.irrigation / 100))}%` : '<span class="muted">川がないので洪水は起きない</span>'}</td></tr>
            <tr><td>商業</td><td>${c.commerce}</td><td>${statBar(c.commerce, 100, '#d4a94a')}</td><td class="small">金の収入+${Math.round(c.commerce / 4)}%</td></tr>
            <tr><td>信仰</td><td colspan="2">${RELIGIONS[rel].name}</td><td class="small">国教：${RELIGIONS[mine].name}${RELIGIONS[mine].tolerant ? '（寛容：異教徒も不満を持たない）' : rel !== mine ? (c.patron > st.turn ? `<span class="pos">（寺社保護中・あと${c.patron - st.turn}季）</span>` : '<span class="neg">（異教の支配：民忠の目標-10）</span>') : ''}</td></tr>
            <tr><td>文化</td><td colspan="2">${CULTURES[cul].name}</td><td class="small">${cul === nat.culture ? '自国と同じ文化' : '異民族の地。征服直後は民忠の目標が最大-6（年とともに薄れる）'}</td></tr>
          </table>
          <div class="sect"><b>税率</b> <span class="row" style="display:inline-flex;gap:4px;margin-left:8px">${TAX_LEVELS.map((t, i) => `<button class="btn small ${c.tax === i ? 'active' : ''}" data-tax="${i}" title="${esc(t.desc)}">${t.name}</button>`).join('')}</span>
            <div class="muted">${esc(TAX_LEVELS[c.tax].desc)}${TAX_LEVELS[c.tax].loyalty ? `（民忠の目標${sign(TAX_LEVELS[c.tax].loyalty)}・治安${sign(TAX_LEVELS[c.tax].order)}）` : ''}</div></div>
          <div class="sect"><b>内政命令</b> <span class="muted">命令した武将はこの季節、出陣できません。各命令は1都市につき1季1回。</span>
            ${gens.length ? `<table class="list" style="margin-top:4px"><tr><th></th><th>武将</th><th>武力</th><th>政治</th><th>魅力</th><th></th></tr>
              ${gens.map((x) => { const ok = canAdminister(st, x); return `<tr class="${ok ? 'clickable' : ''} ${x.id === gid ? 'sel' : ''}" ${ok ? `data-g="${x.id}"` : ''}>
                <td>${x.id === gid ? '▶' : ''}</td><td>${esc(x.name)}${x.id === p.governorId ? ' <span class="muted">太守</span>' : ''}</td><td>${x.war}</td><td>${x.pol}</td><td>${x.cha}</td>
                <td class="muted">${ok ? '' : x.wound > st.turn ? '負傷' : '行動済'}</td></tr>`; }).join('')}</table>` : '<p class="muted">この都市には武将がいません。</p>'}
            <div class="admin-cmds">${COMMAND_ORDER.map((k) => {
              const av = commandAvailable(st, pid, k);
              const ok = av.ok && g;
              return `<button class="btn admin-cmd" data-cmd="${k}" ${ok ? '' : 'disabled'} title="${esc(COMMANDS[k].desc)}">
                <b>${COMMANDS[k].name}</b> <span class="muted">${STAT[COMMANDS[k].stat]}・${tagCost(k)}</span><br>
                <span class="small">${av.ok ? (g ? tagEff(k) : '武将がいません') : `<span class="neg">${esc(av.reason)}</span>`}</span></button>`;
            }).join('')}</div></div>`;
      };
      el.onclick = (e) => {
        const t = e.target.closest('[data-tax]');
        if (t) { adminOf(st.provinces[pid].city).tax = Number(t.dataset.tax); audio.sfx('click'); render(); app.renderTopbar(); return; }
        const r = e.target.closest('[data-g]');
        if (r) { gid = r.dataset.g; render(); return; }
        const b = e.target.closest('[data-cmd]');
        if (b && gid) {
          const name = st.generals[gid].name;
          const res = doCommand(st, pid, b.dataset.cmd, gid);
          if (res.ok) { audio.sfx(b.dataset.cmd === 'alms' || b.dataset.cmd === 'commerce' ? 'coin' : 'build'); toast(`${name}：${COMMANDS[b.dataset.cmd].name}（${res.text}）`); } else toast(res.reason);
          render();
          app.renderTopbar();
        }
      };
      render();
    },
  });
}
