// 後宮・技術者・交易のダイアログ
import { modal, esc, fmt, toast, statBar } from './ui.js';
import { portrait } from './portrait.js';
import { audio } from '../audio/audio.js';
import { TECH_TYPES, TECH_SALARY, TECH_SLOTS, PROVINCES, CULTURES, GOODS } from '../game/data.js';
import { PROV_DEF, nationProvinces, nationGenerals, ruler, age } from '../game/state.js';
import {
  consortsOf, sonsOf, visit, giftConsort, birthChance, marriageable, marryToRuler, marryToVassal,
  requestBride, requestChance, brideAcceptChance, orphans, becomeConsort, adoptOrphan, isFemaleRuler, widows, takeWidow,
} from '../game/royal.js';
import { chanceText } from '../game/strategist.js';

const riskWord = (r) => (r < 0.05 ? '<span class="pos">安全</span>' : r < 0.15 ? 'やや危険' : '<span class="neg">危険</span>');
import { techsIn, availableTechs, hireTech, hireCost, assignTech, dismissTech } from '../game/tech.js';
import {
  priceAt, routeQuote, createRoute, cancelRoute, routesFrom, maxRoutes, maxRouteLength, routeCapacity, goodsProduction,
  sellGoods, GOOD_NAMES, DIST,
} from '../game/trade.js';
import { cityYields } from '../game/city.js';
import { TRAITS } from '../game/personnel.js';
import {
  CONSORT_TRAITS, consortTrait, chiefOf, setChief, isLegit, currentHeir, heirCandidates, designateHeir, EDU, TUTOR_FEE,
  tutorCandidates, assignTutor, fiefCandidates, grantFief, brideCandidates, takeDomesticBride, vassalBrideCandidates, marryVassalDaughter,
  DOMESTIC_BRIDE_COST, VASSAL_BRIDE_COST,
} from '../game/court.js';
import { areNeighbors } from '../game/diplomacy.js';

const cultureOfNation = (st, nid) => st.nations[nid]?.culture ?? 'mongol';

// ================= 後宮 =================
export function haremDialog(app) {
  const st = app.st, nid = st.playerNation;
  const nat = st.nations[nid];
  let tab = 'consorts';
  return modal({
    title: '後宮・王族',
    width: '860px',
    body: (el) => {
      const r = ruler(st, nid);
      const culture = cultureOfNation(st, nid);
      const render = () => {
        const female = isFemaleRuler(st, nid);
        let html = `<div class="tabs">
          <button class="btn small ${tab === 'consorts' ? 'active' : ''}" data-tab="consorts">妃</button>
          <button class="btn small ${tab === 'family' ? 'active' : ''}" data-tab="family">王族（子女）</button>
          <button class="btn small ${tab === 'match' ? 'active' : ''}" data-tab="match">縁談</button></div>`;
        if (tab === 'consorts') {
          const cs = consortsOf(st, r.id);
          html += `<p class="muted">君主 ${esc(r.name)}（${age(st, r)}歳）の妃たち。寵愛（一季に一人）で子を授かりやすくなります。男子は15歳で一門の武将として出仕し、姫は婚姻外交に用いることができます。</p>`;
          if (female) html += '<p>女王のため、妃はいません。王族の姫は「縁談」から迎えられます。</p>';
          if (!cs.length && !female) html += '<p>妃がいません。「縁談」で他国から迎えましょう。</p>';
          html += '<div class="cards">';
          for (const c of cs) {
            const oc = c.origin ? cultureOfNation(st, c.origin) : culture;
            html += `<div class="card">${portrait(c, oc, c.origin ? st.nations[c.origin]?.color : nat.color)}
              <div class="info"><b>${esc(c.name)}</b>（${age(st, c)}歳）<div class="muted">出身：${c.fatherGen ? `家臣${esc(st.generals[c.fatherGen]?.name ?? '')}の娘` : c.formerName ? `旧${esc(c.formerName)}の妃` : c.origin ? esc(st.nations[c.origin]?.name ?? '滅亡国') : '国内'}</div>
              <div>${chiefOf(st, r.id) === c ? '<span class="role-tag">正室</span>' : '<span class="muted">側室</span>'} <span class="trait ${['schemer', 'jealous'].includes(consortTrait(c)) ? 'bad' : ['wise', 'virtuous', 'gentle'].includes(consortTrait(c)) ? 'good' : ''}" title="${esc(CONSORT_TRAITS[consortTrait(c)].desc)}">${CONSORT_TRAITS[consortTrait(c)].name}</span></div>
              <div class="muted">魅力${c.cha}・政治${c.pol}</div>
              <div>寵愛 ${c.affection}${statBar(c.affection, 100, '#e07a9a')}</div>
              <div class="row" style="margin-top:4px">
                <button class="btn small" data-visit="${c.id}" ${c.visited === st.turn ? 'disabled' : ''}>${c.visited === st.turn ? '寵愛済み' : '寵愛する'}</button>
                <button class="btn small" data-gift="${c.id}" ${nat.gold >= 100 ? '' : 'disabled'}>贈物（100金）</button>
                ${chiefOf(st, r.id) !== c ? `<button class="btn small" data-chief="${c.id}" title="正室の子が嫡子になります。退けられた正室は寵愛を失い、その子や実家は不満を抱きます">正室に立てる</button>` : ''}</div></div></div>`;
          }
          html += '</div>';
          if (!female) {
            const cands = brideCandidates(st, nid);
            const vs = vassalBrideCandidates(st, nid).sort((a, b) => b.loyalty - a.loyalty);
            html += `<h3>妃を迎える</h3>
              <div class="sect"><b>国内の名家から</b> <span class="muted">（${DOMESTIC_BRIDE_COST}金・候補は毎年入れ替わる）</span>
              ${cands.length ? `<table class="list">${cands.map((c) => `<tr><td>${esc(c.name)}（${st.year - c.birth}歳）</td><td>魅力${c.cha}・政治${c.pol}</td>
                <td><span class="trait" title="${esc(CONSORT_TRAITS[c.trait].desc)}">${CONSORT_TRAITS[c.trait].name}</span></td>
                <td><button class="btn small" data-domestic="${c.id}" ${nat.gold < DOMESTIC_BRIDE_COST ? 'disabled' : ''}>迎える</button></td></tr>`).join('')}</table>` : '<p class="muted">今年の縁組はもうありません。</p>'}</div>
              <div class="sect"><b>家臣の娘を娶る</b> <span class="muted">（${VASSAL_BRIDE_COST}金・年に一度。その家臣は外戚となり忠誠が大きく上がる）</span>
              ${vs.length ? `<div class="row"><select data-vassal-bride>${vs.map((g) => `<option value="${g.id}">${esc(g.name)}（${age(st, g)}歳・忠誠${g.loyalty}・政${g.pol} 魅${g.cha}）</option>`).join('')}</select>
                <button class="btn small" data-vbride="1" ${nat.vassalBrideYear === st.year || nat.gold < VASSAL_BRIDE_COST ? 'disabled' : ''}>娶る</button>${nat.vassalBrideYear === st.year ? '<span class="muted">今年はすでに迎えた</span>' : ''}</div>` : '<p class="muted">娘を嫁がせられる家臣（32歳以上）がいません。</p>'}</div>
              <p class="muted">他国の姫は「縁談」から、滅びた国の妃や姫も「縁談」の下から迎えられます。</p>`;
          }
        } else if (tab === 'family') {
          const sons = sonsOf(st, r.id).filter((g) => st.year >= g.birth);
          const daughters = Object.values(st.princesses).filter((p) => p.alive && p.nation === nid && !p.married);
          const married = Object.values(st.princesses).filter((p) => p.alive && p.married && (p.nation === nid));
          const heir = currentHeir(st, nid);
          const hc = heirCandidates(st, nid);
          const tutors = tutorCandidates(st, nid);
          const tutorSel = (x, kind) => `<select data-tutor="${kind}:${x.id}"><option value="">傅役なし</option>${[...(x.tutorId && st.generals[x.tutorId]?.alive ? [st.generals[x.tutorId]] : []), ...tutors].map((t) => `<option value="${t.id}" ${x.tutorId === t.id ? 'selected' : ''}>${esc(t.name)}（武${t.war} 統${t.lead} 政${t.pol} 魅${t.cha}）</option>`).join('')}</select>`;
          const eduSel = (x, kind) => `<select data-edu="${kind}:${x.id}">${Object.entries(EDU).filter(([k]) => kind === 'g' || k === 'arts').map(([k, e]) => `<option value="${k}" ${(x.edu ?? (kind === 'g' ? 'balanced' : 'arts')) === k ? 'selected' : ''}>${e.name}</option>`).join('')}</select>`;
          const fiefs = nationProvinces(st, nid).filter((p) => p.id !== nat.capital);
          const fiefSel = (g) => `<select data-fief="${g.id}"><option value="">${g.fief ? `封地：${PROV_DEF[g.fief]?.city}` : '封地を与える…'}</option>${fiefs.filter((p) => p.id !== g.fief).map((p) => `<option value="${p.id}">${PROV_DEF[p.id].city}</option>`).join('')}</select>`;
          html += `<div class="sect"><b>後継ぎ</b>：${heir ? `${esc(heir.name)}（${heir.fatherId === r.id ? (isLegit(st, heir) ? '嫡子' : '庶子') : '一門'}・${nat.heirId === heir.id ? '指名' : '慣例'}）${age(st, heir) < 15 ? '<span class="muted">※まだ幼く、成人前に代替わりすれば一門の成人が継ぐ</span>' : ''}` : '<span class="neg">なし（一門がいなければ家臣が継ぎます）</span>'}
            ${hc.length ? `<select data-heir><option value="">後継ぎを指名…</option>${hc.map((g) => `<option value="${g.id}">${esc(g.name)}（${age(st, g)}歳${g.fatherId === r.id ? (isLegit(st, g) ? '・嫡子' : '・庶子') : '・一門'}）</option>`).join('')}</select>` : ''}
            <div class="muted">指名がなければ嫡子（正室の子）の年長が継ぎます。嫡子をさしおいて指名すると、嫡子と正室が不満を抱きます。継承のとき、不満を持つ男子（野心家・母が野心家・封地持ちほど）が跡目争いで兵を挙げることがあります。</div></div>`;
          html += `<h3>男子</h3>${sons.length ? `<table class="list"><tr><th>名前</th><th>母</th><th>年齢</th><th>武</th><th>統</th><th>政</th><th>魅</th><th>忠誠</th><th>養育・封地</th></tr>
            ${sons.map((g) => `<tr><td>${esc(g.name)} ${isLegit(st, g) ? '<span class="role-tag">嫡子</span>' : '<span class="muted small">庶子</span>'}${(g.traits ?? []).map((t) => ` <span class="trait" title="${esc(TRAITS[t]?.desc ?? '')}">${TRAITS[t]?.name ?? ''}</span>`).join('')}</td>
              <td class="small">${esc(st.consorts[g.motherId]?.name ?? '―')}</td><td>${age(st, g)}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.cha}</td><td>${age(st, g) >= 15 ? g.loyalty : '-'}</td>
              <td>${age(st, g) >= 15 ? `出仕（${PROV_DEF[g.province]?.city ?? ''}） ${fiefSel(g)}` : `元服まで${15 - age(st, g)}年<br>${tutorSel(g, 'g')} ${eduSel(g, 'g')}`}</td></tr>`).join('')}</table>
            <div class="muted">傅役をつけると毎年${TUTOR_FEE}金で、傅役の能力に近づくように育ち、特技を受け継ぐこともあります。封地を与えた王族は太守となり、その都市の民忠が上がります。</div>` : '<p class="muted">君主の男子はまだいません。</p>'}
            <h3>姫</h3>`;
          if (!daughters.length) html += '<p class="muted">未婚の姫はいません。</p>';
          html += '<div class="cards">';
          for (const p of daughters) {
            const ok = age(st, p) >= 15;
            html += `<div class="card">${portrait(p, culture, nat.color, 64, age(st, p) < 13)}<div class="info"><b>${esc(p.name)}</b>（${age(st, p)}歳）
              <div class="muted">魅力${p.cha}・政治${p.pol}${p.father ? `・父 ${esc(st.generals[p.father]?.name ?? '')}` : ''}</div>
              ${!ok ? `<div style="margin-top:3px">${tutorSel(p, 'p')}</div>` : ''}
              ${ok ? `<div class="row" style="margin-top:4px"><button class="btn small" data-wed-foreign="${p.id}">他国へ嫁がせる</button><button class="btn small" data-wed-vassal="${p.id}">家臣に嫁がせる</button></div>` : `<div class="muted">成人（15歳）まで${15 - age(st, p)}年</div>`}
              </div></div>`;
          }
          html += '</div>';
          if (married.length) html += `<h3>嫁いだ姫</h3><p class="muted">${married.map((p) => `${esc(p.name)} → ${esc(st.generals[p.married.to]?.name ?? '')}（${esc(st.nations[p.married.nation]?.name ?? '')}）`).join('／')}</p>`;
        } else {
          const list = Object.values(st.nations).filter((n) => n.alive && n.id !== nid && marriageable(st, n.id).length)
            .sort((a, b) => (st.nations[nid].relations[b.id] ?? 0) - (st.nations[nid].relations[a.id] ?? 0));
          html += `<p class="muted">他国に縁談を申し込み、姫を妃に迎えます。成立すれば婚姻同盟が結ばれます（友好度が高いほど成功しやすい）。</p>`;
          if (female) html += '<p class="neg">女王のため、妃を迎えることはできません。</p>';
          html += `<table class="list"><tr><th>勢力</th><th>姫</th><th>友好</th><th>軍師の見立て</th><th></th></tr>
            ${list.map((n) => {
              const p = marriageable(st, n.id).sort((a, b) => b.cha - a.cha)[0];
              const tried = st.nations[nid].brideAsked?.[n.id] === st.turn;
              return `<tr><td><span class="swatch" style="background:${n.color}"></span>${n.name}${areNeighbors(st, nid, n.id) ? '' : ' <span class="muted">(遠方)</span>'}</td>
                <td>${esc(p.name)}（${age(st, p)}歳・魅${p.cha}）</td><td>${st.nations[nid].relations[n.id] ?? 0}</td><td>${chanceText(st, nid, requestChance(st, nid, n.id), `bride:${n.id}`)}</td>
                <td><button class="btn small" data-ask="${n.id}" ${female || tried ? 'disabled' : ''}>${tried ? '今季は申込済' : '縁談を申し込む'}</button></td></tr>`;
            }).join('') || '<tr><td colspan="5" class="muted">適齢の姫がいる国はありません。</td></tr>'}</table>`;
          const wd = female ? [] : widows(st);
          if (wd.length) {
            html += `<h3>滅びた国の妃</h3><p class="muted">国を失った妃たち。迎えることはできますが、恨みを抱いているため寵愛は低いところから始まります。</p><div class="cards">
              ${wd.map((c) => `<div class="card">${portrait(c, st.nations[c.formerNation]?.culture ?? 'mongol', '#777')}<div class="info"><b>${esc(c.name)}</b>（${age(st, c)}歳）<div class="muted">旧${esc(c.formerName ?? '')}の妃・魅力${c.cha}・政治${c.pol}</div>
                <div><span class="trait" title="${esc(CONSORT_TRAITS[consortTrait(c)].desc)}">${CONSORT_TRAITS[consortTrait(c)].name}</span></div>
                <button class="btn small" data-widow="${c.id}">妃に迎える</button></div></div>`).join('')}</div>`;
          }
          const orph = orphans(st);
          if (orph.length) {
            html += `<h3>身寄りのない姫</h3><p class="muted">滅亡した国の姫たち。迎え入れることができます。</p><div class="cards">
              ${orph.map((p) => `<div class="card">${portrait(p, 'mongol', '#777')}<div class="info"><b>${esc(p.name)}</b>（${age(st, p)}歳）<div class="muted">魅力${p.cha}・政治${p.pol}</div>
                <button class="btn small" data-orphan="${p.id}">${female ? '養女に迎える' : '妃に迎える'}</button></div></div>`).join('')}</div>`;
          }
        }
        el.innerHTML = html;
      };
      el.onchange = (e) => {
        const d = e.target.dataset;
        const pick = (key) => { const [kind, id] = key.split(':'); return kind === 'g' ? st.generals[id] : st.princesses[id]; };
        if (d.heir !== undefined && e.target.value) { const res = designateHeir(st, nid, e.target.value); toast(res.ok ? `${st.generals[e.target.value].name}を後継ぎに指名した` : res.reason); }
        if (d.tutor) { const res = assignTutor(st, pick(d.tutor), e.target.value || null); if (!res.ok) toast(res.reason); }
        if (d.edu) pick(d.edu).edu = e.target.value;
        if (d.fief && e.target.value) { const res = grantFief(st, d.fief, e.target.value); toast(res.ok ? `${PROV_DEF[e.target.value].city}を封地として与えた` : res.reason); }
        render();
        app.refresh();
      };
      el.onclick = async (e) => {
        const t = e.target.closest('button');
        if (!t) return;
        const d = t.dataset;
        if (d.tab) { tab = d.tab; render(); return; }
        if (d.visit) { const res = visit(st, d.visit); if (!res.ok) toast(res.reason); else { audio.sfx('coin'); toast(`${st.consorts[d.visit].name}のもとを訪れた`); } }
        if (d.gift) { const res = giftConsort(st, d.gift); if (!res.ok) toast(res.reason); else audio.sfx('coin'); app.renderTopbar(); }
        if (d.ask) {
          st.nations[nid].brideAsked = { ...(st.nations[nid].brideAsked || {}), [d.ask]: st.turn };
          const res = requestBride(st, nid, d.ask);
          toast(res.ok ? `${res.princess.name}を妃に迎えた！婚姻同盟が成立した` : res.reason);
          if (res.ok) audio.jingle('win');
        }
        if (d.orphan) {
          const p = st.princesses[d.orphan];
          if (isFemaleRuler(st, nid)) adoptOrphan(st, p.id, nid);
          else { p.nation = nid; becomeConsort(st, p, r.id); }
          toast(`${p.name}を迎え入れた`);
        }
        if (d.domestic) { const res = takeDomesticBride(st, nid, d.domestic); if (res.ok) { audio.sfx('coin'); toast(`${res.consort.name}を妃に迎えた`); } else toast(res.reason); }
        if (d.vbride) { const sel = el.querySelector('[data-vassal-bride]'); const res = marryVassalDaughter(st, nid, sel?.value); if (res.ok) { audio.sfx('coin'); toast(`${res.consort.name}を妃に迎えた`); } else toast(res.reason); }
        if (d.widow) { const res = takeWidow(st, d.widow, nid); toast(res.ok ? `${st.consorts[d.widow].name}を妃に迎えた` : res.reason); }
        if (d.chief) { const res = setChief(st, d.chief); if (!res.ok) toast(res.reason); else toast(`${st.consorts[d.chief].name}を正室に立てた`); }
        if (d.wedForeign) await wedForeign(app, d.wedForeign);
        if (d.wedVassal) await wedVassal(app, d.wedVassal);
        render();
        app.refresh();
      };
      render();
    },
  });
}

function wedForeign(app, pid) {
  const st = app.st, nid = st.playerNation;
  const p = st.princesses[pid];
  const list = Object.values(st.nations).filter((n) => n.alive && n.id !== nid && !isFemaleRuler(st, n.id))
    .sort((a, b) => (areNeighbors(st, nid, b.id) - areNeighbors(st, nid, a.id)) || ((st.nations[nid].relations[b.id] ?? 0) - (st.nations[nid].relations[a.id] ?? 0)));
  return modal({
    title: `${p.name}を他国へ嫁がせる`,
    body: (el, api) => {
      el.innerHTML = `<p class="muted">相手の君主の妃となり、婚姻同盟が結ばれます。姫は二度と戻りません。</p>
        <table class="list"><tr><th>勢力</th><th>君主</th><th>友好</th><th>軍師の見立て</th><th></th></tr>
        ${list.map((n) => `<tr><td><span class="swatch" style="background:${n.color}"></span>${n.name}</td><td>${esc(ruler(st, n.id)?.name ?? '')}（${age(st, ruler(st, n.id))}歳）</td>
          <td>${st.nations[nid].relations[n.id] ?? 0}</td><td>${chanceText(st, nid, brideAcceptChance(st, nid, n.id), `wed:${n.id}:${p.id}`)}</td><td><button class="btn small" data-n="${n.id}">申し込む</button></td></tr>`).join('')}</table>`;
      el.onclick = (e) => {
        const to = e.target.dataset.n;
        if (!to) return;
        const res = marryToRuler(st, pid, to);
        toast(res.ok ? `${p.name}は${st.nations[to].name}へ嫁いだ。婚姻同盟が成立した` : res.reason);
        if (res.ok) audio.jingle('win');
        api.close(true);
      };
    },
  });
}

function wedVassal(app, pid) {
  const st = app.st, nid = st.playerNation;
  const p = st.princesses[pid];
  const taken = new Set(Object.values(st.princesses).filter((x) => x.married).map((x) => x.married.to));
  const list = nationGenerals(st, nid).filter((g) => g.id !== st.nations[nid].rulerId && !taken.has(g.id) && !g.female)
    .sort((a, b) => a.loyalty - b.loyalty);
  return modal({
    title: `${p.name}を家臣に嫁がせる`,
    body: (el, api) => {
      el.innerHTML = `<p class="muted">嫁いだ家臣は一門となり、忠誠が100になります（出奔しなくなります）。</p>
        <table class="list"><tr><th>武将</th><th>年齢</th><th>武</th><th>統</th><th>政</th><th>忠誠</th><th></th></tr>
        ${list.map((g) => `<tr><td>${esc(g.name)}${g.family ? '（一門）' : ''}</td><td>${age(st, g)}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.loyalty}</td><td><button class="btn small" data-g="${g.id}">嫁がせる</button></td></tr>`).join('')}</table>`;
      el.onclick = (e) => {
        const gid = e.target.dataset.g;
        if (!gid) return;
        const res = marryToVassal(st, pid, gid);
        toast(res.ok ? `${p.name}が${st.generals[gid].name}に嫁いだ` : res.reason);
        api.close(true);
      };
    },
  });
}

// ================= 技術者 =================
export function techDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  return modal({
    title: `${PROV_DEF[pid].city}の技術者`,
    width: '860px',
    body: (el) => {
      let filter = 'all';
      const row = (t, action) => `<tr><td><span class="ic-s">${TECH_TYPES[t.type].glyph}</span>${esc(t.name)}</td><td>${TECH_TYPES[t.type].name}</td><td>${'★'.repeat(t.level)}</td>
        <td>${CULTURES[t.culture]?.name ?? ''}</td><td class="muted" style="font-size:12px">${TECH_TYPES[t.type].desc}</td><td>${action}</td></tr>`;
      const render = () => {
        const here = techsIn(st, pid);
        const mine = Object.values(st.techs).filter((t) => t.nation === nid && t.city !== pid);
        const avail = availableTechs(st, nid).filter((t) => filter === 'all' || t.type === filter).sort((a, b) => b.level - a.level);
        el.innerHTML = `<p class="muted">各地の専門家を招聘して都市に配置します（1都市${TECH_SLOTS}人まで）。給金は毎季 ${TECH_SALARY}金×Lv。招聘できるのは、自領か友好国（友好度20以上または条約国）にいる技術者です。都市を奪われると技術者も奪われます。</p>
          <h3>この都市の技術者（${here.length}/${TECH_SLOTS}）</h3>
          <table class="list"><tr><th>名前</th><th>職</th><th>Lv</th><th>出身</th><th>効果</th><th></th></tr>
          ${here.map((t) => row(t, `<button class="btn small" data-dismiss="${t.id}">解任</button>`)).join('') || '<tr><td colspan="6" class="muted">いません</td></tr>'}</table>
          ${mine.length ? `<h3>他の都市にいる自国の技術者</h3><table class="list"><tr><th>名前</th><th>職</th><th>Lv</th><th>出身</th><th>効果</th><th></th></tr>
            ${mine.map((t) => row(t, `<span class="muted">${PROV_DEF[t.city]?.city ?? ''}</span> <button class="btn small" data-move="${t.id}" ${here.length >= TECH_SLOTS ? 'disabled' : ''}>ここへ移す</button>`)).join('')}</table>` : ''}
          <h3>招聘できる技術者</h3>
          <div class="row" style="margin-bottom:6px"><select data-filter><option value="all">すべての職</option>${Object.entries(TECH_TYPES).map(([k, v]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
            <span class="muted">金 ${fmt(st.nations[nid].gold)}</span></div>
          <table class="list"><tr><th>名前</th><th>職</th><th>Lv</th><th>出身</th><th>効果</th><th>所在・費用</th></tr>
          ${avail.map((t) => row(t, `<span class="muted">${PROV_DEF[t.home].city}</span> <button class="btn small" data-hire="${t.id}" ${here.length >= TECH_SLOTS || st.nations[nid].gold < hireCost(t) ? 'disabled' : ''}>招聘 ${hireCost(t)}金</button>`)).join('') || '<tr><td colspan="6" class="muted">招聘できる技術者がいません。友好国を増やすか、領土を広げましょう。</td></tr>'}</table>`;
      };
      el.onchange = (e) => { if (e.target.dataset.filter !== undefined) { filter = e.target.value; render(); } };
      el.onclick = (e) => {
        const d = e.target.dataset;
        if (d.hire) { const r = hireTech(st, nid, d.hire, pid); if (r.ok) { audio.sfx('coin'); toast(`${st.techs[d.hire].name}を招聘した`); } else toast(r.reason); }
        if (d.dismiss) { dismissTech(st, d.dismiss); }
        if (d.move) { const r = assignTech(st, d.move, pid); if (!r.ok) toast(r.reason); }
        if (d.hire || d.dismiss || d.move) { render(); app.refresh(); }
      };
      render();
    },
  });
}

// ================= 交易 =================
export function tradeDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  const def = PROV_DEF[pid];
  let tab = 'routes';
  return modal({
    title: `${def.city}の市場と隊商`,
    width: '900px',
    body: (el) => {
      const render = () => {
        const nat = st.nations[nid], c = st.provinces[pid].city;
        const y = cityYields(st, pid);
        const markets = (y.counts.market || 0) + (y.counts.caravan || 0);
        const rate = Math.min(1.5, 1 + markets * 0.05);
        let html = `<div class="tabs"><button class="btn small ${tab === 'routes' ? 'active' : ''}" data-tab="routes">隊商・交易路</button>
          <button class="btn small ${tab === 'market' ? 'active' : ''}" data-tab="market">市場・相場</button></div>`;
        const spec = def.specialty;
        const stock = c.goods?.[spec] ?? 0;
        html += `<div class="row muted" style="gap:14px;margin-bottom:6px"><span>特産品：<b style="color:var(--ink)">${spec}</b> 在庫 ${fmt(stock)}荷（+${goodsProduction(st, pid)}/季）</span>
          <span>地元相場 ${priceAt(st, pid, spec)}金/荷</span><span>金 ${fmt(nat.gold)}</span>
          ${(c.imports || []).length ? `<span>輸入品：${c.imports.join('・')}（民忠↑）</span>` : ''}</div>`;
        if (tab === 'routes') {
          const routes = routesFrom(st, pid);
          const mr = maxRoutes(st, pid);
          html += `<p class="muted">隊商宿の合計Lv ${mr}：交易路 ${routes.length}/${mr}本・1本あたり${routeCapacity(st, pid)}荷・最大${maxRouteLength(st, pid)}地方先まで。
            隊商は毎季、特産品を運んで売り、帰りに相手の特産品を仕入れて戻ります。遠いほど高く売れますが、敵地を通ると略奪の危険があります。他国の都市では売上の10%が関税になり、その国との友好度が少しずつ上がります。</p>`;
          html += `<h3>開設中の交易路</h3><table class="list"><tr><th>行き先</th><th>往路</th><th>復路</th><th>見込み利益</th><th>危険</th><th>前季</th><th></th></tr>
            ${routes.map((r) => {
              const q = routeQuote(st, nid, r.from, r.to);
              const last = r.last ? (r.last.raided ? '<span class="neg">略奪</span>' : `<span class="pos">+${fmt(r.last.profit)}</span>`) : '―';
              return `<tr><td>${PROV_DEF[r.to].city}（${esc(st.nations[st.provinces[r.to].owner]?.name ?? '')}）</td>
                <td>${q.ok ? `${q.outGood}→${q.outSell}金` : '<span class="neg">×</span>'}</td><td>${q.ok && q.retQty ? `${q.retGood} ${q.retBuy}→${q.retSell}` : '―'}</td>
                <td>${q.ok ? fmt(q.profit) : esc(q.reason)}</td><td>${q.ok ? riskWord(q.risk) : ''}</td><td>${last}</td>
                <td><button class="btn small" data-cancel="${r.id}">廃止</button></td></tr>`;
            }).join('') || '<tr><td colspan="7" class="muted">なし</td></tr>'}</table>`;
          if (mr <= 0) html += '<p class="neg">交易路を開くには、この都市の箱庭に「隊商宿」を建ててください。</p>';
          else {
            const cands = PROVINCES.map((p) => ({ p, q: routeQuote(st, nid, pid, p.id) })).filter((x) => x.q.ok && !routes.some((r) => r.to === x.p.id))
              .sort((a, b) => b.q.profit * (1 - b.q.risk) - a.q.profit * (1 - a.q.risk)).slice(0, 14);
            html += `<h3>新しい交易路の候補</h3><table class="list"><tr><th>行き先</th><th>距離</th><th>往路（${spec}）</th><th>復路</th><th>関税</th><th>見込み利益/季</th><th>危険</th><th></th></tr>
              ${cands.map(({ p, q }) => `<tr><td><span class="swatch" style="background:${st.nations[st.provinces[p.id].owner]?.color}"></span>${p.city}</td><td>${q.dist}</td>
                <td>${q.qty}荷×${q.outSell}金</td><td>${q.retQty ? `${q.retGood} ${q.retBuy}→${q.retSell}` : '―'}</td><td>${q.tariff || '―'}</td>
                <td><b class="${q.profit > 0 ? 'pos' : 'neg'}">${fmt(q.profit)}</b></td><td>${riskWord(q.risk)}</td>
                <td><button class="btn small" data-open="${p.id}" ${routes.length >= mr ? 'disabled' : ''}>開設</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">交易できる相手がいません（友好度0以上の国か自領が必要）</td></tr>'}</table>`;
          }
        } else {
          const buyFood = Math.round(130 * rate), sellFood = Math.round(55 * rate), buyHorse = Math.round(100 * rate);
          html += `<div class="row" style="margin:6px 0 10px">
              <button class="btn small" data-sell="10" ${stock >= 10 ? '' : 'disabled'}>${spec}を10荷売る（${Math.round(10 * priceAt(st, pid, spec) * 0.8)}金）</button>
              <button class="btn small" data-sell="all" ${stock >= 1 ? '' : 'disabled'}>在庫を全部売る（${Math.round(stock * priceAt(st, pid, spec) * 0.8)}金）</button>
              <button class="btn small" data-t="bf" ${nat.gold >= 100 ? '' : 'disabled'}>100金→食糧${buyFood}</button>
              <button class="btn small" data-t="sf" ${nat.food >= 200 ? '' : 'disabled'}>食糧200→${sellFood * 2}金</button>
              <button class="btn small" data-t="bh" ${nat.gold >= 150 ? '' : 'disabled'}>150金→馬${buyHorse}頭</button></div>
            <p class="muted">この都市での各地の特産品の相場（1荷あたり）。産地から遠いほど高く、季節ごとに変動します。</p>
            <table class="list"><tr><th>品物</th><th>産地</th><th>産地からの距離</th><th>相場</th><th>動向</th></tr>
            ${GOOD_NAMES.map((g) => ({ g, pr: priceAt(st, pid, g) })).sort((a, b) => b.pr - a.pr).map(({ g, pr }) => {
              const m = st.market[g];
              return `<tr><td>${g}</td><td>${GOODS[g].sources.map((s) => PROV_DEF[s].city).join('・')}</td><td>${DIST[g][pid]}</td><td>${pr}</td>
                <td class="${m > 1.08 ? 'pos' : m < 0.92 ? 'neg' : ''}">${m > 1.08 ? '高騰' : m < 0.92 ? '下落' : '平常'}</td></tr>`;
            }).join('')}</table>`;
        }
        el.innerHTML = html;
      };
      el.onclick = (e) => {
        const d = e.target.dataset;
        const nat = st.nations[nid], c = st.provinces[pid].city;
        if (d.tab) { tab = d.tab; render(); return; }
        if (d.open) { const r = createRoute(st, nid, pid, d.open); if (r.ok) { audio.sfx('coin'); toast(`${PROV_DEF[d.open].city}への交易路を開いた`); } else toast(r.reason); }
        if (d.cancel) cancelRoute(st, Number(d.cancel));
        if (d.sell) { const g = sellGoods(st, pid, def.specialty, d.sell === 'all' ? 99999 : 10); if (g) { audio.sfx('coin'); toast(`${fmt(g)}金で売れた`); } }
        const y = cityYields(st, pid);
        const rate = Math.min(1.5, 1 + ((y.counts.market || 0) + (y.counts.caravan || 0)) * 0.05);
        if (d.t === 'bf') { nat.gold -= 100; nat.food += Math.round(130 * rate); }
        if (d.t === 'sf') { nat.food -= 200; nat.gold += Math.round(55 * rate) * 2; }
        if (d.t === 'bh') { nat.gold -= 150; c.horses += Math.round(100 * rate); }
        if (d.t) audio.sfx('coin');
        if (d.open || d.cancel || d.sell || d.t) { render(); app.refresh(); }
      };
      render();
    },
  });
}

