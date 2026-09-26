// 家臣団（一覧・役職・特技）と調略のダイアログ
import { modal, esc, fmt, toast } from './ui.js';
import { audio } from '../audio/audio.js';
import { PROV_DEF, nationGenerals, age, ruler } from '../game/state.js';
import { reward } from '../game/military.js';
import {
  TRAITS, RANKS, ROLES, ROLE_ORDER, ensurePersonnel, affDist, affMark, loyaltyTarget, canPromote, promoteCost, promote,
  roleOf, roleHolder, appoint, rebelRisk, subvertChance, subvertAgents, subvert, SUBVERT_COST,
} from '../game/personnel.js';

export const traitChips = (g) => (ensurePersonnel(g).traits.map((t) => `<span class="trait ${t === 'ambitious' ? 'bad' : t === 'loyal' ? 'good' : ''}" title="${esc(TRAITS[t].desc)}">${TRAITS[t].name}</span>`).join('') || '<span class="muted">―</span>');
export const rankLabel = (g) => `${RANKS[ensurePersonnel(g).rank].name}<span class="muted small">（功${g.merit}${g.rank < RANKS.length - 1 ? `/${RANKS[g.rank + 1].merit}` : ''}）</span>`;
export function loyaltyCell(st, g) {
  const n = st.nations[g.nation];
  if (n?.rulerId === g.id) return '<span class="muted">君主</span>';
  const lt = loyaltyTarget(st, g);
  const tip = lt.items.map(([l, v]) => `${l}${v >= 0 ? '+' : ''}${v}`).join(' / ');
  const warn = rebelRisk(st, g) > 0 ? ' <span class="neg" title="謀反のおそれ">不穏</span>' : g.loyalty < 35 && !g.family ? ' <span class="neg" title="出奔のおそれ">!</span>' : '';
  return `<span title="${esc(tip)}">${g.loyalty}<span class="muted small">→${g.family ? '一門' : lt.target}</span></span>${warn}`;
}
export function compatCell(st, g) {
  const r = ruler(st, g.nation);
  if (!r || r === g) return '';
  const d = affDist(g, r);
  return `<span title="君主との相性（${d}）" class="${d < 35 ? 'pos' : d >= 55 ? 'neg' : ''}">${affMark(d)}</span>`;
}

// ---------- 家臣団 ----------
export function retainerDialog(app) {
  const st = app.st, nid = st.playerNation;
  let tab = 'list', sort = 'rank';
  return modal({
    title: '家臣団',
    width: '980px',
    body: (el) => {
      const render = () => {
        const nat = st.nations[nid];
        let html = `<div class="tabs"><button class="btn small ${tab === 'list' ? 'active' : ''}" data-tab="list">家臣一覧</button>
          <button class="btn small ${tab === 'roles' ? 'active' : ''}" data-tab="roles">役職</button>
          <button class="btn small ${tab === 'help' ? 'active' : ''}" data-tab="help">特技・位階・忠誠</button>
          <span class="muted" style="margin-left:auto">金 ${fmt(nat.gold)}</span></div>`;
        if (tab === 'list') {
          const keys = { rank: (g) => -(g.rank * 1000 + g.merit), loyalty: (g) => g.loyalty, war: (g) => -g.war, lead: (g) => -g.lead, pol: (g) => -g.pol, cha: (g) => -g.cha };
          const gens = nationGenerals(st, nid).sort((a, b) => keys[sort](a) - keys[sort](b));
          const th = (k, l) => `<th class="clickable" data-sort="${k}">${l}${sort === k ? '▼' : ''}</th>`;
          html += `<div style="max-height:60vh;overflow:auto"><table class="list"><tr><th>武将</th><th>所在</th><th>年</th>${th('war', '武')}${th('lead', '統')}${th('pol', '政')}${th('cha', '魅')}${th('rank', '位階')}<th>特技</th><th>相性</th>${th('loyalty', '忠誠→目標')}<th></th></tr>
            ${gens.map((g) => {
              const role = roleOf(st, g);
              const isRuler = nat.rulerId === g.id;
              return `<tr><td>${isRuler ? '👑' : ''}${esc(g.name)}${role ? ` <span class="role-tag">${ROLES[role].name}</span>` : ''}${g.family && !isRuler ? ' <span class="muted small">一門</span>' : ''}</td>
                <td>${PROV_DEF[g.province]?.city ?? ''}</td><td>${age(st, g)}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.cha}</td>
                <td>${rankLabel(g)}</td><td>${traitChips(g)}</td><td>${compatCell(st, g)}</td><td>${loyaltyCell(st, g)}</td>
                <td class="row">${canPromote(g) ? `<button class="btn small primary" data-promote="${g.id}">昇進（${promoteCost(g)}金）</button>` : ''}
                ${isRuler ? '' : `<button class="btn small" data-rw="${g.id}">褒美</button>`}</td></tr>`;
            }).join('')}</table></div>
            <p class="muted">忠誠は毎季、目標値に向かって少しずつ動きます（数値にカーソルを合わせると内訳）。功績が次の位階に届いた武将は昇進させないと不満を持ちます。</p>`;
        } else if (tab === 'roles') {
          const cands = nationGenerals(st, nid).filter((g) => g.id !== nat.rulerId);
          html += ROLE_ORDER.map((k) => {
            const cur = roleHolder(st, nid, k);
            const R = ROLES[k];
            return `<div class="sect"><b>${R.name}</b> <span class="muted">${esc(R.desc)}</span>
              <div class="row" style="margin-top:4px"><select data-role="${k}"><option value="">（空席）</option>
              ${cands.sort((a, b) => b[R.stat] - a[R.stat]).map((g) => `<option value="${g.id}" ${cur?.id === g.id ? 'selected' : ''}>${esc(g.name)}（武${g.war} 統${g.lead} 政${g.pol} 魅${g.cha}）${roleOf(st, g) && roleOf(st, g) !== k ? `［${ROLES[roleOf(st, g)].name}］` : ''}</option>`).join('')}</select>
              ${cur ? `<span>現在：<b>${esc(cur.name)}</b>（${PROV_DEF[cur.province]?.city ?? ''}）</span>` : ''}</div></div>`;
          }).join('') + '<p class="muted">役職に就くと忠誠が上がり、在任中は忠誠の目標も+10されます。解任すると忠誠が下がります。君主は役職に就けません。</p>';
        } else {
          html += `<h3>特技</h3><table class="list">${Object.values(TRAITS).map((t) => `<tr><td style="white-space:nowrap"><span class="trait">${t.name}</span></td><td>${esc(t.desc)}</td></tr>`).join('')}</table>
            <h3>位階と功績</h3><p>${RANKS.map((r) => `${r.name}（功績${r.merit}）`).join(' → ')}</p>
            <p class="muted">功績は合戦（勝てば多く、総大将や一騎討ちの勝者はさらに多い）・内政命令・調略の成功で貯まります。位階が1つ上がるごとに率いる兵の上限+5%、忠誠の目標+2。合戦や内政で使った能力は経験を積んで少しずつ伸び、若いほど伸びやすく、60歳を過ぎると衰えます。</p>
            <h3>忠誠</h3><p class="muted">目標値＝基本45＋君主の魅力＋君主との相性（◎〜×）＋位階＋役職＋特技（忠義・野心）−昇進の遅れ−俸給の遅れ。<br>
            忠誠が35を下回ると出奔することがあり、太守が忠誠を大きく失うと（野心家は40未満で）地方ごと謀反を起こして自立します。忠誠が低いと敵の調略にも乗りやすくなります。</p>`;
        }
        el.innerHTML = html;
      };
      el.onclick = (e) => {
        const t = e.target.closest('[data-tab],[data-sort],[data-promote],[data-rw]');
        if (!t) return;
        if (t.dataset.tab) tab = t.dataset.tab;
        if (t.dataset.sort) sort = t.dataset.sort;
        if (t.dataset.promote) {
          const r = promote(st, t.dataset.promote);
          if (r.ok) { audio.sfx('coin'); toast(`${st.generals[t.dataset.promote].name}を${r.rank}に昇進させた`); } else toast(r.reason);
          app.renderTopbar();
        }
        if (t.dataset.rw) { if (reward(st, t.dataset.rw, 100)) { audio.sfx('coin'); toast('100金を与えた（忠誠+5）'); } else toast('金が足りません'); app.renderTopbar(); }
        render();
      };
      el.onchange = (e) => {
        const k = e.target.dataset.role;
        if (!k) return;
        appoint(st, nid, k, e.target.value || null);
        audio.sfx('click');
        render();
      };
      render();
    },
  });
}

// ---------- 調略 ----------
export function subvertDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  const owner = st.provinces[pid].owner;
  let agentId = null;
  return modal({
    title: `${PROV_DEF[pid].city}への調略`,
    width: '860px',
    body: (el) => {
      const render = () => {
        const nat = st.nations[nid];
        const targets = Object.values(st.generals).filter((g) => g.alive && g.nation === owner && g.province === pid && !g.captiveOf && age(st, g) >= 15);
        const agents = targets.length ? subvertAgents(st, nid, targets[0]) : [];
        if (!agents.some((g) => g.id === agentId)) agentId = [...agents].sort((a, b) => b.cha - a.cha)[0]?.id ?? null;
        const agent = agentId ? st.generals[agentId] : null;
        el.innerHTML = `<p class="muted">隣接する地方にいる自軍の武将を使者として送り、敵将を誘います（${SUBVERT_COST}金・使者はその季節は動けません）。<br>
          <b>引き抜き</b>：すぐに寝返らせ、兵の半分を連れてこさせる。<b>内応</b>：2年以内にこの国と合戦になったとき、戦場で寝返らせる（成功しやすい）。<br>
          失敗すると相手の忠誠が上がり、関係が悪化します。君主・一門・忠義の武将は応じません。</p>
          <div class="row" style="margin:6px 0">使者：${agents.length ? `<select data-agent>${agents.map((g) => `<option value="${g.id}" ${g.id === agentId ? 'selected' : ''}>${esc(g.name)}（魅${g.cha}）${g.traits.includes('eloquent') ? '［弁舌］' : ''}・${PROV_DEF[g.province].city}</option>`).join('')}</select>` : '<span class="neg">隣接する地方に動ける武将がいません</span>'}
          <span class="muted">金 ${fmt(nat.gold)}</span></div>
          <table class="list"><tr><th>武将</th><th>武</th><th>統</th><th>政</th><th>魅</th><th>特技</th><th>忠誠</th><th>兵</th><th>引き抜き</th><th>内応</th></tr>
          ${targets.map((g) => {
            const tried = g.subvertTried === `${nid}:${st.turn}`;
            const btn = (mode) => {
              if (!agent) return '―';
              const p = subvertChance(st, agent, g, mode);
              if (!p) return '<span class="muted">応じない</span>';
              if (mode === 'betray' && g.betray === nid) return '<span class="pos">約束済み</span>';
              return `<button class="btn small" data-sv="${g.id}" data-mode="${mode}" ${tried || nat.gold < SUBVERT_COST ? 'disabled' : ''}>${Math.round(p * 100)}%</button>`;
            };
            return `<tr><td>${esc(g.name)}${st.nations[owner].rulerId === g.id ? ' 👑' : ''}${roleOf(st, g) ? ` <span class="role-tag">${ROLES[roleOf(st, g)].name}</span>` : ''}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.cha}</td>
              <td>${traitChips(g)}</td><td>${g.loyalty}</td><td>${fmt(g.unit?.soldiers ?? 0)}</td><td>${btn('hire')}</td><td>${btn('betray')}</td></tr>`;
          }).join('')}</table>`;
      };
      el.onchange = (e) => { if (e.target.dataset.agent !== undefined) { agentId = e.target.value; render(); } };
      el.onclick = (e) => {
        const b = e.target.closest('[data-sv]');
        if (!b || !agentId) return;
        const r = subvert(st, agentId, b.dataset.sv, b.dataset.mode);
        if (!r.ok) toast(r.reason);
        else { audio.sfx(r.success ? 'coin' : 'error'); toast(r.text); }
        app.renderTopbar();
        render();
      };
      render();
    },
  });
}
