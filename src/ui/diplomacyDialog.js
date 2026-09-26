// 外交画面：勢力一覧＋選んだ勢力との外交（贈物・条約・宣戦・和平交渉・従属・併合・参戦要請）
import { modal, esc, fmt, toast, statBar, confirmBox, busy } from './ui.js';
import { chance } from '../game/rng.js';
import { audio } from '../audio/audio.js';
import { PROV_DEF, nationProvinces, nationSoldiers, ruler, treaty, relation } from '../game/state.js';
import {
  nationPower, gift, propose, breakTreaty, acceptChance, atWar, enemiesOf, friendsOf, lordOf, vassalsOf, treatyLabel,
  declareWar, joinWar, peaceChance, proposePeace, cedeCandidates, warScore, submitChance, demandChance, offerSubmission,
  demandVassal, declareIndependence, annexChance, annexVassal, hegemon, areNeighbors, TRIBUTE_RATE,
} from '../game/diplomacy.js';
import { handleCalls } from '../game/actions.js';

const pct = (p) => `${Math.round(p * 100)}%`;

export function diplomacyDialog(app, focus) {
  const st = app.st, me = st.playerNation;
  let sel = focus && st.nations[focus]?.alive && focus !== me ? focus : null;
  let terms = { kind: 'white', gold: 500, province: null };
  return modal({
    title: '外交',
    width: '980px',
    body: (el) => {
      const render = () => {
        const list = Object.values(st.nations).filter((n) => n.alive && n.id !== me)
          .sort((a, b) => (atWar(st, me, b.id) - atWar(st, me, a.id)) || (!!treaty(st, me, b.id) - !!treaty(st, me, a.id)) || (areNeighbors(st, me, b.id) - areNeighbors(st, me, a.id)) || relation(st, me, b.id) - relation(st, me, a.id));
        if (!sel) sel = list[0]?.id;
        const heg = hegemon(st);
        const myPow = nationPower(st, me);
        const lord = lordOf(st, me);
        let html = '';
        if (heg === me) html += '<div class="dip-warn">貴国は覇権国と見なされています。周辺国は包囲網を結び、友好度は下がり続けます。</div>';
        else if (heg) html += `<div class="dip-note">${esc(st.nations[heg].name)}が覇権を握りつつあります。周辺国は包囲網を結ぼうとしています。</div>`;
        if (lord) html += `<div class="dip-note">貴国は${esc(st.nations[lord].name)}の従属国です（収入の${pct(TRIBUTE_RATE)}を朝貢）。</div>`;
        html += '<div class="dip-wrap"><div class="dip-list"><table class="list">';
        for (const n of list) {
          const rel = relation(st, me, n.id);
          const lab = treatyLabel(st, me, n.id);
          const cls = atWar(st, me, n.id) ? 'neg' : treaty(st, me, n.id) ? 'pos' : 'muted';
          html += `<tr class="clickable ${n.id === sel ? 'sel' : ''}" data-n="${n.id}"><td><span class="swatch" style="background:${n.color}"></span>${n.name}${areNeighbors(st, me, n.id) ? '' : '<span class="muted">・遠</span>'}</td>
            <td class="${rel >= 0 ? 'pos' : 'neg'}" style="text-align:right">${rel}</td><td class="${cls}">${lab}</td></tr>`;
        }
        html += '</table></div><div class="dip-detail">';
        if (sel) html += detail(sel, myPow);
        html += '</div></div>';
        el.innerHTML = html;
      };

      const detail = (nid, myPow) => {
        const n = st.nations[nid];
        const r = ruler(st, nid);
        const rel = relation(st, me, nid);
        const pow = nationPower(st, nid);
        const tr = treaty(st, me, nid);
        const war = atWar(st, me, nid);
        const theirEnemies = enemiesOf(st, nid).map((e) => st.nations[e].name);
        const theirFriends = friendsOf(st, nid).map((e) => st.nations[e].name);
        const myEnemies = enemiesOf(st, me);
        let h = `<h3><span class="swatch" style="background:${n.color}"></span>${n.name}</h3>
          <div class="grid2">
            <span>君主</span><span>${esc(r?.name ?? '')}（${st.year - r.birth}歳・魅${r.cha}）</span>
            <span>領地／兵力</span><span>${nationProvinces(st, nid).length}地方・${fmt(nationSoldiers(st, nid))}（${pow > myPow * 1.3 ? '<span class="neg">強</span>' : pow < myPow * 0.7 ? '<span class="pos">弱</span>' : '互角'}）</span>
            <span>友好度</span><span><span class="${rel >= 0 ? 'pos' : 'neg'}">${rel}</span>${statBar(rel + 100, 200, rel >= 0 ? '#7fbf5a' : '#d35a4a')}</span>
            <span>関係</span><span>${treatyLabel(st, me, nid)}${tr === 'truce' ? `（残り${st.nations[me].treaties[nid].until - st.turn}季）` : ''}</span>
            <span>味方</span><span>${theirFriends.join('、') || '―'}</span>
            <span>交戦中</span><span>${theirEnemies.join('、') || '―'}</span>
            ${vassalsOf(st, nid).length ? `<span>従属国</span><span>${vassalsOf(st, nid).map((v) => st.nations[v].name).join('、')}</span>` : ''}
            ${lordOf(st, nid) ? `<span>宗主国</span><span>${st.nations[lordOf(st, nid)].name}</span>` : ''}
          </div>`;
        const btn = (a, label, p, extra = '', dis = false) => `<button class="btn small" data-a="${a}" ${extra} ${dis ? 'disabled' : ''}>${label}${p !== undefined ? `<span class="muted">（${pct(p)}）</span>` : ''}</button>`;
        const gold = st.nations[me].gold;
        h += `<div class="sect"><b>贈物</b><div class="row">${btn('gift300', '300金を贈る', undefined, '', gold < 300)}${btn('gift1000', '1000金を贈る', undefined, '', gold < 1000)}</div></div>`;
        if (war) {
          const w = st.nations[me].wars[nid];
          const s = warScore(st, me, nid);
          const cede = cedeCandidates(st, me, nid);
          if (terms.kind === 'cede' && !cede.includes(terms.province)) terms.province = cede[0] ?? null;
          const p = peaceChance(st, me, nid, terms);
          h += `<div class="sect"><b>和平交渉</b> <span class="muted">開戦から${st.turn - w.since}季・奪った地方 ${w.taken >= 0 ? '+' : ''}${w.taken}・戦況 ${s >= 1.3 ? '<span class="pos">優勢</span>' : s <= 0.77 ? '<span class="neg">劣勢</span>' : '拮抗'}</span>
            <div class="terms">
              <label><input type="radio" name="t" value="white" ${terms.kind === 'white' ? 'checked' : ''}> 白紙講和</label>
              <label><input type="radio" name="t" value="payGold" ${terms.kind === 'payGold' ? 'checked' : ''}> 賠償金を払う</label>
              <label><input type="radio" name="t" value="demandGold" ${terms.kind === 'demandGold' ? 'checked' : ''}> 賠償金を要求する</label>
              <label><input type="radio" name="t" value="cede" ${terms.kind === 'cede' ? 'checked' : ''} ${cede.length ? '' : 'disabled'}> 地方の割譲を要求する</label>
              <label><input type="radio" name="t" value="vassal" ${terms.kind === 'vassal' ? 'checked' : ''}> 従属を要求する</label>
            </div>
            <div class="row">${terms.kind === 'payGold' || terms.kind === 'demandGold' ? `<select data-gold>${[300, 500, 1000, 2000, 3000].map((g) => `<option ${terms.gold === g ? 'selected' : ''}>${g}</option>`).join('')}</select>金` : ''}
              ${terms.kind === 'cede' ? `<select data-prov>${cede.map((c) => `<option value="${c}" ${terms.province === c ? 'selected' : ''}>${PROV_DEF[c].city}</option>`).join('')}</select>` : ''}
              ${btn('peace', '和平を提案する', p, '', (terms.kind === 'payGold' && gold < terms.gold) || (terms.kind === 'cede' && !terms.province))}</div>
            <div class="muted">戦況が有利なほど厳しい条件でも受け入れられます。長引いた戦争は講和しやすくなります。</div></div>`;
        } else {
          h += '<div class="sect"><b>条約</b><div class="row">';
          if (!tr) {
            h += btn('alliance', '同盟を申し込む', acceptChance(st, nid, me, 'alliance'));
            h += btn('truce', '不可侵（停戦）を結ぶ', acceptChance(st, nid, me, 'truce'));
          } else if (tr === 'vassal' && lordOf(st, me) === nid) {
            h += btn('independence', '独立を宣言する（開戦）');
          } else if (tr === 'vassal') {
            const ap = annexChance(st, me, nid);
            h += btn('annex', '併合する', ap, '', ap <= 0);
            h += btn('release', '従属から解放する');
            if (ap <= 0) h += '<span class="muted">併合には従属3年以上・3地方以下・良好な関係が必要</span>';
          } else {
            h += btn('break', `${tr === 'alliance' ? '同盟' : '停戦'}を破棄する`);
          }
          h += '</div></div>';
          if (tr === 'alliance') {
            const asks = myEnemies.filter((e) => !atWar(st, nid, e) && e !== nid && treaty(st, nid, e) !== 'alliance');
            h += `<div class="sect"><b>参戦要請</b> ${asks.length ? `<div class="row">${asks.map((e) => btn('call', `${st.nations[e].name}との戦いに参戦を求める`, callChance(nid, e), `data-e="${e}"`)).join('')}</div>` : '<span class="muted">要請できる戦争はありません</span>'}
              <div class="muted">同盟国の武将は、隣接する地方での合戦に援軍として加わります。</div></div>`;
          }
          if (!tr) {
            const sp = submitChance(st, me, nid), dp = demandChance(st, me, nid);
            h += `<div class="sect"><b>従属</b><div class="row">${btn('submit', '臣従を申し出る', sp, '', sp <= 0)}${btn('demand', '従属を要求する', dp, '', dp <= 0)}</div>
              <div class="muted">従属国は毎季、収入の${pct(TRIBUTE_RATE)}を宗主国に朝貢し、宗主の戦争に参戦します。宗主は従属国を守り、やがて併合できます。</div></div>`;
          }
          if (!tr || tr === 'truce') h += `<div class="sect">${btn('war', '宣戦布告する')}${n.coalition === me ? ' <span class="neg">この国は貴国への包囲網に加わっています</span>' : ''}</div>`;
        }
        return h;
      };

      const callChance = (ally, enemy) => Math.max(0.05, Math.min(0.9, 0.3 + relation(st, ally, me) / 120 - (nationPower(st, enemy) > nationPower(st, ally) * 1.5 ? 0.2 : 0)));
      const once = (key) => {
        const n = st.nations[me];
        n.dipDone = n.dipDone || {};
        if (n.dipDone[key] === st.turn) { toast('この季節はすでに使者を送っています'); return false; }
        n.dipDone[key] = st.turn;
        return true;
      };

      el.onchange = (e) => {
        if (e.target.name === 't') terms.kind = e.target.value;
        if (e.target.dataset.gold !== undefined) terms.gold = Number(e.target.value);
        if (e.target.dataset.prov !== undefined) terms.province = e.target.value;
        render();
      };
      el.onclick = async (e) => {
        const row = e.target.closest('[data-n]');
        if (row) { sel = row.dataset.n; terms = { kind: 'white', gold: 500, province: null }; audio.sfx('click'); render(); return; }
        const b = e.target.closest('[data-a]');
        if (!b || b.disabled) return;
        const a = b.dataset.a, nid = sel, name = st.nations[nid].name;
        let r;
        switch (a) {
          case 'gift300': case 'gift1000':
            r = gift(st, me, nid, a === 'gift300' ? 300 : 1000);
            if (r.ok) { audio.sfx('coin'); toast(`${name}との友好度が${r.gain}上がった`); }
            break;
          case 'alliance': case 'truce':
            if (!once(`${a}:${nid}`)) break;
            r = propose(st, me, nid, a);
            toast(r.ok ? `${name}は${a === 'alliance' ? '同盟' : '不可侵'}を受け入れた！` : `${name}に断られた…`);
            break;
          case 'break':
            if (await confirmBox('条約破棄', `${name}との条約を破棄しますか？（他国からの信用も失います）`)) breakTreaty(st, me, nid);
            break;
          case 'war':
            if (await confirmBox('宣戦布告', `${name}に宣戦布告しますか？<br><span class="muted">${name}の味方（${friendsOf(st, nid).map((f) => st.nations[f].name).join('、') || 'なし'}）も参戦するかもしれません。</span>`, '宣戦布告', 'やめる')) {
              audio.sfx('horn');
              await handleCalls(st, declareWar(st, me, nid), app.hooks);
            }
            break;
          case 'peace':
            if (!once(`peace:${nid}`)) break;
            r = proposePeace(st, me, nid, { ...terms });
            toast(r.ok ? `和平が成立した（${r.desc}）` : `${name}は和平を拒んだ`);
            if (r.ok) audio.jingle('win');
            break;
          case 'submit':
            if (!(await confirmBox('臣従', `${name}に臣従しますか？<br>毎季、収入の${pct(TRIBUTE_RATE)}を朝貢し、${name}の戦争に参戦を求められます。`))) break;
            if (!once(`submit:${nid}`)) break;
            r = offerSubmission(st, me, nid);
            toast(r.ok ? `${name}の従属国となった` : `${name}は臣従を受け入れなかった`);
            break;
          case 'demand':
            if (!once(`demand:${nid}`)) break;
            r = demandVassal(st, me, nid);
            toast(r.ok ? `${name}は貴国に臣従した！` : `${name}は要求を拒んだ`);
            if (r.ok) audio.jingle('win');
            break;
          case 'independence':
            if (await confirmBox('独立', `${name}からの独立を宣言しますか？（${name}との戦争になります）`, '独立を宣言', 'やめる')) {
              audio.sfx('horn');
              await handleCalls(st, declareIndependence(st, me), app.hooks);
            }
            break;
          case 'annex':
            if (!once(`annex:${nid}`)) break;
            r = annexVassal(st, me, nid);
            toast(r.ok ? `${name}を併合した！` : `${name}の併合は反発を招いた`);
            if (r.ok) { audio.jingle('win'); sel = null; }
            break;
          case 'release':
            if (await confirmBox('解放', `${name}を従属から解放しますか？`)) breakTreaty(st, me, nid);
            break;
          case 'call': {
            const enemy = b.dataset.e;
            if (!once(`call:${nid}:${enemy}`)) break;
            if (chance(st, callChance(nid, enemy))) { joinWar(st, nid, me, enemy); toast(`${name}は参戦を約束した！`); }
            else { toast(`${name}は参戦を断った`); }
            break;
          }
        }
        render();
        app.renderTopbar();
      };
      render();
    },
  });
}

// 同盟国からの参戦要請
export async function callToArmsDialog(app, { caller, enemy }) {
  busy(null);
  const st = app.st;
  const c = st.nations[caller], e = st.nations[enemy];
  const ok = await modal({
    title: '参戦の要請',
    body: `<p><span class="swatch" style="background:${c.color}"></span><b>${c.name}</b>から使者が来た。</p>
      <p>「${esc(e.name)}との戦いが始まった。盟約に従い、ともに戦われたし」</p>
      <p class="muted">参戦すると${esc(e.name)}と戦争状態になります。断ると${esc(c.name)}との友好度が大きく下がり、同盟が解消されることもあります。</p>`,
    buttons: [{ label: '断る', value: false }, { label: '参戦する', value: true, primary: true }],
    closeValue: false,
  });
  if (app.turnBusy) busy('他勢力の行動中…');
  return ok;
}
