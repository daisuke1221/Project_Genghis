// 各種ダイアログ：徴兵・出陣・人事・交易・外交・勢力一覧・記録・設定・遊び方・捕虜・提案
import { modal, esc, fmt, toast, statBar, busy } from './ui.js';
import { audio } from '../audio/audio.js';
import { UNIT_TYPES, UNIT_ORDER, PROVINCES, VICTORY_SHARE } from '../game/data.js';
import {
  PROV_DEF, generalsIn, roninIn, unitCap, nationProvinces, nationGenerals, nationSoldiers, ruler, treaty, relation, age,
} from '../game/state.js';
import { recruitQuote, recruit, dismiss, recruitLimit, hireChance, tryHire, reward, recruitChance, searchTalent, SEARCH_COST } from '../game/military.js';
import { nationPower, gift, propose, breakTreaty, acceptChance } from '../game/diplomacy.js';
import { cityYields } from '../game/city.js';
import { portrait } from './portrait.js';

const SAVE_PREFIX = 'steppe-khan.save.';

// ---------- 徴兵 ----------
export function recruitDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  return modal({
    title: `${PROV_DEF[pid].city}で徴兵`,
    width: '760px',
    body: (el) => {
      const render = () => {
        const p = st.provinces[pid], nat = st.nations[nid];
        const y = cityYields(st, pid);
        const gens = generalsIn(st, pid, nid);
        el.innerHTML = `<div class="row muted" style="gap:14px;margin-bottom:8px">
            <span>金 <b>${fmt(nat.gold)}</b></span><span>人口 ${fmt(p.city.pop)}</span><span>馬 ${fmt(p.city.horses)}</span>
            <span>今季の徴兵残り ${fmt(recruitLimit(st, pid))}</span><span>新兵の訓練度 ${Math.min(90, 25 + y.trainNew)}</span></div>
          <table class="list"><tr><th>武将</th><th>統率</th><th>兵種</th><th>兵数 / 上限</th><th>訓練</th><th>徴兵</th></tr>
          ${gens.map((g) => {
            const u = g.unit;
            const has = u && u.soldiers > 0;
            const type = has ? u.type : (g._rtype ?? u?.type ?? 'inf');
            const opts = UNIT_ORDER.map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${UNIT_TYPES[t].name}</option>`).join('');
            const q = recruitQuote(st, g.id, type, 999999);
            return `<tr><td>${esc(g.name)}</td><td>${g.lead}</td>
              <td><select data-type="${g.id}" ${has ? 'disabled' : ''}>${opts}</select></td>
              <td>${fmt(u?.soldiers ?? 0)} / ${fmt(unitCap(g))}</td><td>${u?.training ?? '-'}</td>
              <td class="row">
                <button class="btn small" data-r="${g.id}" data-n="100" ${q.ok ? '' : 'disabled'}>+100</button>
                <button class="btn small" data-r="${g.id}" data-n="500" ${q.ok ? '' : 'disabled'}>+500</button>
                <button class="btn small" data-r="${g.id}" data-n="max" ${q.ok ? '' : 'disabled'} title="${q.ok ? `${fmt(q.amount)}人・${fmt(q.cost)}金` : esc(q.reason)}">最大</button>
                ${has ? `<button class="btn small" data-d="${g.id}">解散</button>` : ''}
                ${q.ok ? '' : `<span class="muted" style="font-size:11px">${esc(q.reason)}</span>`}
              </td></tr>`;
          }).join('')}</table>
          <div class="muted" style="margin-top:8px">兵種の費用（1人あたり）：${UNIT_ORDER.map((t) => `${UNIT_TYPES[t].name} ${UNIT_TYPES[t].cost}金${UNIT_TYPES[t].horses ? `＋馬${UNIT_TYPES[t].horses}` : ''}`).join('／')}。攻城兵には工房が必要。兵は毎季、兵数×0.1の食糧と×0.04の金を消費します。</div>`;
      };
      el.onchange = (e) => {
        const id = e.target.dataset.type;
        if (id) { st.generals[id]._rtype = e.target.value; render(); }
      };
      el.onclick = (e) => {
        const r = e.target.closest('[data-r]');
        if (r) {
          const g = st.generals[r.dataset.r];
          const type = g.unit && g.unit.soldiers > 0 ? g.unit.type : (g._rtype ?? g.unit?.type ?? 'inf');
          const n = r.dataset.n === 'max' ? 999999 : Number(r.dataset.n);
          const res = recruit(st, g.id, type, n);
          if (res.ok) { audio.sfx('coin'); delete g._rtype; } else toast(res.reason);
          render();
          app.renderTopbar();
        }
        const d = e.target.closest('[data-d]');
        if (d) { dismiss(st, d.dataset.d, 999999); render(); }
      };
      render();
    },
  });
}

// ---------- 出陣（武将選択） ----------
export function sortieDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  const gens = generalsIn(st, pid, nid).filter((g) => !g.moved);
  if (!gens.length) { toast('この季節に動ける武将がいません'); return Promise.resolve(null); }
  const picked = new Set(gens.filter((g) => g.unit?.soldiers > 0).map((g) => g.id));
  return modal({
    title: `${PROV_DEF[pid].city}から出陣`,
    body: (el) => {
      const render = () => {
        const total = [...picked].reduce((s, id) => s + (st.generals[id].unit?.soldiers ?? 0), 0);
        el.innerHTML = `<p class="muted">出陣させる武将を選んでください。敵地へ攻め込むと合戦になります。自領へは移動だけです。<br>武将を全員出すと城の守りが空になるので注意。</p>
          <table class="list"><tr><th></th><th>武将</th><th>武</th><th>統</th><th>兵種</th><th>兵数</th><th>訓練</th></tr>
          ${gens.map((g) => `<tr class="clickable ${picked.has(g.id) ? 'sel' : ''}" data-g="${g.id}"><td><input type="checkbox" ${picked.has(g.id) ? 'checked' : ''}></td>
            <td>${esc(g.name)}${st.nations[nid].rulerId === g.id ? '（君主）' : ''}</td><td>${g.war}</td><td>${g.lead}</td>
            <td>${g.unit?.soldiers > 0 ? UNIT_TYPES[g.unit.type].name : '―'}</td><td>${fmt(g.unit?.soldiers ?? 0)}</td><td>${g.unit?.training ?? '-'}</td></tr>`).join('')}</table>
          <p>選択：${picked.size}人・兵 <b>${fmt(total)}</b></p>`;
      };
      el.onclick = (e) => {
        const row = e.target.closest('[data-g]');
        if (!row) return;
        const id = row.dataset.g;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        render();
      };
      render();
    },
    buttons: [{ label: 'やめる', value: null }, { label: '行き先を選ぶ', value: () => [...picked], primary: true }],
  });
}

// ---------- 人事 ----------
export function personnelDialog(app, pid) {
  const st = app.st, nid = st.playerNation;
  return modal({
    title: `${PROV_DEF[pid].city}の人事`,
    width: '720px',
    body: (el) => {
      const render = () => {
        const p = st.provinces[pid];
        const gens = generalsIn(st, pid, nid);
        const ronin = roninIn(st, pid);
        el.innerHTML = `<h3>配下の武将</h3>
          <table class="list"><tr><th>武将</th><th>年齢</th><th>武</th><th>統</th><th>政</th><th>魅</th><th>忠誠</th><th></th></tr>
          ${gens.map((g) => `<tr><td>${esc(g.name)}${p.governorId === g.id ? ' <span class="pos">［太守］</span>' : ''}</td><td>${age(st, g)}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.cha}</td>
            <td>${g.loyalty}</td><td class="row">${p.governorId === g.id ? '' : `<button class="btn small" data-gov="${g.id}">太守に任命</button>`}
            ${st.nations[nid].rulerId === g.id ? '' : `<button class="btn small" data-rw="${g.id}">褒美(100金)</button>`}</td></tr>`).join('')}</table>
          <p class="muted">太守の政治力が高いほど、金・食糧の産出と建設速度が上がります。魅力が高いと民忠が上がります。忠誠が低い武将は出奔することがあります。</p>
          <h3>在野の人材</h3>
          ${ronin.length ? `<table class="list"><tr><th>人物</th><th>武</th><th>統</th><th>政</th><th>魅</th><th>成功率</th><th></th></tr>
            ${ronin.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.cha}</td><td>${Math.round(hireChance(st, nid, g) * 100)}%</td>
            <td>${g.hireTried === st.turn ? '<span class="muted">今季は断られた</span>' : `<button class="btn small" data-hire="${g.id}">登用</button>`}</td></tr>`).join('')}</table>` : '<p class="muted">この地方に在野の人材はいません。</p>'}
          <div class="row" style="margin-top:8px"><button class="btn" data-search="1">人材を探す（${SEARCH_COST}金）</button><span class="muted">成功すると在野の人物が見つかります。</span></div>`;
      };
      el.onclick = (e) => {
        const t = e.target;
        if (t.dataset.gov) { st.provinces[pid].governorId = t.dataset.gov; audio.sfx('click'); render(); }
        if (t.dataset.rw) { if (reward(st, t.dataset.rw, 100)) { audio.sfx('coin'); toast('忠誠が上がった'); } else toast('金が足りません'); render(); app.renderTopbar(); }
        if (t.dataset.hire) {
          const g = st.generals[t.dataset.hire];
          if (tryHire(st, nid, g.id)) { g.province = pid; toast(`${g.name}が配下に加わった！`); audio.sfx('coin'); } else toast(`${g.name}に断られた…`);
          render();
        }
        if (t.dataset.search) {
          const r = searchTalent(st, nid, pid);
          if (!r.ok) toast(r.reason);
          else if (r.found) toast(`${st.generals[r.found].name}という人物が見つかった！`);
          else toast('めぼしい人材は見つからなかった');
          render(); app.renderTopbar();
        }
      };
      render();
    },
  });
}

// ---------- 勢力一覧 ----------
export function nationsDialog(app) {
  const st = app.st, nid = st.playerNation;
  return modal({
    title: '勢力',
    width: '820px',
    body: (el, api) => {
      let tab = 'mine';
      const render = () => {
        let html = `<div class="tabs"><button class="btn small ${tab === 'mine' ? 'active' : ''}" data-tab="mine">自勢力の地方</button>
          <button class="btn small ${tab === 'gens' ? 'active' : ''}" data-tab="gens">配下の武将</button>
          <button class="btn small ${tab === 'all' ? 'active' : ''}" data-tab="all">全勢力</button>
          <button class="btn small ${tab === 'chron' ? 'active' : ''}" data-tab="chron">年表</button></div>`;
        if (tab === 'mine') {
          html += `<table class="list"><tr><th>都市</th><th>人口</th><th>民忠</th><th>金/季</th><th>食/季</th><th>城壁</th><th>兵</th><th>委任</th></tr>
            ${nationProvinces(st, nid).map((p) => {
              const y = cityYields(st, p.id);
              const sol = generalsIn(st, p.id, nid).reduce((s, g) => s + (g.unit?.soldiers ?? 0), 0);
              return `<tr class="clickable" data-p="${p.id}"><td>${PROV_DEF[p.id].city}</td><td>${fmt(p.city.pop)}</td><td>${p.city.loyalty}</td><td>${fmt(y.gold)}</td><td>${fmt(y.food - y.foodUse)}</td><td>${p.city.walls}</td><td>${fmt(sol)}</td><td>${p.delegated ? '○' : ''}</td></tr>`;
            }).join('')}</table><p class="muted">行をクリックでその地方へ。</p>`;
        } else if (tab === 'gens') {
          html += `<table class="list"><tr><th>武将</th><th>所在</th><th>年齢</th><th>武</th><th>統</th><th>政</th><th>魅</th><th>忠</th><th>兵</th></tr>
            ${nationGenerals(st, nid).map((g) => `<tr class="clickable" data-p="${g.province}"><td>${esc(g.name)}</td><td>${PROV_DEF[g.province]?.city ?? ''}</td><td>${age(st, g)}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.cha}</td><td>${g.loyalty}</td><td>${g.unit?.soldiers > 0 ? `${UNIT_TYPES[g.unit.type].short}${fmt(g.unit.soldiers)}` : '―'}</td></tr>`).join('')}</table>`;
        } else if (tab === 'chron') {
          const ch = st.chronicle || [];
          html += ch.length ? `<table class="list"><tr><th>年</th><th>出来事</th><th>内容</th></tr>${ch.map((c) => `<tr><td style="white-space:nowrap">${esc(c.date)}</td><td style="white-space:nowrap"><b>${esc(c.title)}</b></td><td>${esc(c.text)}</td></tr>`).join('')}</table>` : '<p class="muted">まだ史実イベントは起きていません。</p>';
        } else {
          const list = Object.values(st.nations).filter((n) => n.alive).sort((a, b) => nationProvinces(st, b.id).length - nationProvinces(st, a.id).length);
          html += `<p>勝利条件：全${PROVINCES.length}地方のうち${Math.ceil(PROVINCES.length * VICTORY_SHARE)}地方を支配する。</p>
            <table class="list"><tr><th>勢力</th><th>君主</th><th>領地</th><th>武将</th><th>兵力</th></tr>
            ${list.map((n) => `<tr class="clickable" data-p="${n.capital}"><td><span class="swatch" style="background:${n.color}"></span>${n.name}</td><td>${esc(ruler(st, n.id)?.name ?? '')}</td><td>${nationProvinces(st, n.id).length}</td><td>${nationGenerals(st, n.id).length}</td><td>${fmt(nationSoldiers(st, n.id))}</td></tr>`).join('')}</table>`;
        }
        el.innerHTML = html;
      };
      el.onclick = (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) { tab = t.dataset.tab; render(); return; }
        const r = e.target.closest('[data-p]');
        if (r) api.close(r.dataset.p);
      };
      render();
    },
  });
}

// ---------- 記録 ----------
export function saveLoadDialog(app, mode) {
  const slots = ['auto', '1', '2', '3'];
  return modal({
    title: '記録',
    body: (el, api) => {
      const render = () => {
        el.innerHTML = `<table class="list"><tr><th>記録</th><th>内容</th><th></th></tr>
          ${slots.map((s) => {
            let meta = null;
            try { meta = JSON.parse(localStorage.getItem(`${SAVE_PREFIX}${s}.meta`) || 'null'); } catch { meta = null; }
            const canSave = mode !== 'load' && s !== 'auto' && app.st;
            return `<tr><td>${s === 'auto' ? '自動' : `記録${s}`}</td><td>${meta ? `${meta.scenario ? `「${esc(meta.scenario)}」` : ''}${esc(meta.nation)}・${esc(meta.date)}・${meta.provs}地方` : '<span class="muted">なし</span>'}</td>
              <td class="row">${canSave ? `<button class="btn small" data-save="${s}">保存</button>` : ''}${meta ? `<button class="btn small" data-load="${s}">読込</button>` : ''}</td></tr>`;
          }).join('')}</table><p class="muted">記録はこのブラウザ内（localStorage）に保存されます。毎ターン自動保存されます。</p>`;
      };
      el.onclick = (e) => {
        const s = e.target.dataset.save, l = e.target.dataset.load;
        if (s) { if (app.saveSlot(s)) toast(`記録${s}に保存しました`); render(); }
        if (l) api.close(mode === 'load' ? l : { load: l });
      };
      render();
    },
  });
}

// ---------- 設定 ----------
export function settingsDialog(app) {
  return modal({
    title: '設定',
    body: (el) => {
      const auto = app.st?.options?.autoBattle ?? false;
      el.innerHTML = `<div class="grid2" style="align-items:center;gap:10px 14px">
        <span>音楽</span><input type="range" min="0" max="1" step="0.05" value="${audio.musicVol}" data-k="m">
        <span>効果音</span><input type="range" min="0" max="1" step="0.05" value="${audio.sfxVol}" data-k="s">
        ${app.st ? `<span>合戦</span><label><input type="checkbox" data-k="auto" ${auto ? 'checked' : ''}> 常に自動で戦う（確認しない）</label>` : ''}
        ${app.st ? `<span>史実イベント</span><label><input type="checkbox" data-k="hist" ${app.st.options.historyEvents !== false ? 'checked' : ''}> 起こる（奥州合戦・十字軍・オトラル事件など）</label>` : ''}
      </div>`;
      el.oninput = (e) => {
        const k = e.target.dataset.k;
        if (k === 'm' || k === 's') {
          const m = Number(el.querySelector('[data-k="m"]').value), s = Number(el.querySelector('[data-k="s"]').value);
          audio.init();
          audio.setVolumes(m, s);
        }
        if (k === 'auto') app.st.options.autoBattle = e.target.checked;
        if (k === 'hist') app.st.options.historyEvents = e.target.checked;
      };
    },
  });
}

// ---------- 遊び方 ----------
export function helpDialog() {
  return modal({
    title: '遊び方',
    width: '720px',
    body: `<div class="help">
      <p>12世紀末のユーラシア。35の勢力が割拠する中から一つを選び、内政と合戦で領土を広げ、全${PROVINCES.length}地方の${Math.round(VICTORY_SHARE * 100)}%（${Math.ceil(PROVINCES.length * VICTORY_SHARE)}地方）を支配すれば勝利です。1ターンは1季節（春夏秋冬）。</p>
      <h3>史実イベント</h3>
      <ul><li>条件がそろうと、奥州合戦・第3回十字軍・クリルタイ・オトラル事件などの史実の出来事が起こります。自勢力が当事者なら選択肢から対応を選べ、他勢力は史実どおりに動きます。起きた出来事は「勢力」→「年表」で振り返れます。設定でオフにもできます。</li></ul>
      <h3>外交</h3>
      <ul><li>他国を攻めると宣戦布告になり、相手の同盟国・従属国が参戦してきます。同盟国の武将は、隣接する地方の合戦に援軍として加わります（地図上では「援」の印）。</li>
      <li>戦争中は和平交渉ができます（白紙講和・賠償金・地方の割譲・従属）。戦況が有利なほど厳しい条件が通ります。</li>
      <li>強国には臣従を申し出て守ってもらい、弱い隣国には従属を要求できます。従属国は毎季収入の20%を朝貢し、長く従えば併合できます。</li>
      <li>一国が強くなりすぎると、周辺国が包囲網を結んで対抗します。友好度は時間とともに少しずつ変化します。</li></ul>
      <h3>シナリオ</h3>
      <ul><li>1189年「蒼き狼の目覚め」、1206年「大モンゴル国の成立」、1219年「西方大遠征」の3本。開始年によって勢力の版図・君主・登場人物が変わり、すでに世を去った人物は登場しません。</li></ul>
      <h3>地図</h3>
      <ul><li>地方をクリックして選択。右側のパネルから命令を出します。</li><li>ドラッグで移動、右ドラッグで回転、ホイールで拡大縮小。</li><li>「ターン終了」で季節が進み、他の勢力が行動します（Ctrl+Enter）。</li></ul>
      <h3>箱庭（内政）</h3>
      <ul><li>各都市は9×9マスの箱庭です。草地・砂地・丘・森・川があり、建てられる建物が違います。</li>
      <li>農地は川沿いで+50%、市場は隣の住居1つごとに+15%、住居は寺院の隣で+25%、工房は鉱山の隣で+50%。配置を工夫しましょう。</li>
      <li>完成した建物を再びクリックすると強化（最大Lv3）。森は開墾で草地にできます。</li>
      <li>食糧は秋に大きく収穫され、冬はほとんど取れません。兵は毎季食糧を消費します。</li>
      <li>「委任」をONにすると、その都市は毎季自動で開発されます。</li></ul>
      <h3>軍事</h3>
      <ul><li>徴兵：武将ごとに兵を集めます（兵数の上限は統率×30）。騎兵・弓騎兵には馬が必要です（牧場で生産）。</li>
      <li>出陣・移動：武将を選んで隣の地方へ。敵地なら合戦になります。守備兵のいない地方はそのまま占領できます。</li>
      <li>合戦はヘックスの戦場で行います。騎兵は2マス以上移動してから攻撃すると突撃ボーナス、敵を囲むと挟撃ボーナス。丘・森・城は防御に有利。攻撃側は20ターン以内に敵を全滅させるか本丸を占拠すれば勝利です。</li></ul>
      <h3>後宮・王族</h3>
      <ul><li>上部の「後宮」から妃を寵愛し（一季に一人）、子を授かりましょう。男子は15歳で一門の武将として出仕し、後継ぎになります。</li>
      <li>姫が15歳になったら、他国の君主に嫁がせて婚姻同盟を結ぶか、家臣に嫁がせて忠誠を100にできます。他国に縁談を申し込んで妃を迎えることもできます。</li></ul>
      <h3>技術者</h3>
      <ul><li>各地には文化ごとの専門家（農業技師・商人・工匠・建築家・攻城技師・学者・鍛冶師・牧夫）がいます。自領か友好国にいる者を招聘し、都市に配置すると効果を発揮します（1都市2人まで・毎季給金）。</li></ul>
      <h3>特産品交易</h3>
      <ul><li>都市は特産品を生産・備蓄します。相場は産地から遠いほど高く、季節で変動します。</li>
      <li>隊商宿のある都市から「交易・隊商」で交易路を開くと、毎季自動で特産品を運んで売り、帰りに相手の特産品を仕入れて戻ります。珍しい輸入品は民忠を高めます。敵地を通ると略奪の危険があります。</li></ul>
      <h3>人事・外交</h3>
      <ul><li>太守の政治力で産出と建設速度が、魅力で民忠が上がります。在野の人物は登用できます。</li>
      <li>贈物で友好度を上げ、同盟・停戦を結べます。武将は年を取り、やがて世を去ります。若い武将は15歳で出仕します。</li></ul>
      <p class="muted">本作は歴史シミュレーションの名作に敬意を表したファン制作のオリジナルゲームです。グラフィック・音楽はすべてプログラムで生成しています。</p>
    </div>`,
  });
}

// ---------- 捕虜 ----------
export function captivesDialog(app, gids) {
  const st = app.st, nid = st.playerNation;
  const decisions = Object.fromEntries(gids.map((id) => [id, recruitChance(st, nid, st.generals[id]) > 0 ? 'recruit' : 'release']));
  return modal({
    title: '捕虜の処遇',
    width: '640px',
    body: (el) => {
      const render = () => {
        el.innerHTML = `<p>合戦で次の武将を捕らえた。処遇を決めよ。</p><table class="list"><tr><th>武将</th><th>武</th><th>統</th><th>政</th><th>魅</th><th>登用率</th><th>処遇</th></tr>
          ${gids.map((id) => {
            const g = st.generals[id];
            const ch = recruitChance(st, nid, g);
            return `<tr><td>${esc(g.name)}${g.nation && st.nations[g.nation]?.rulerId === id ? '（君主）' : ''}</td><td>${g.war}</td><td>${g.lead}</td><td>${g.pol}</td><td>${g.cha}</td><td>${Math.round(ch * 100)}%</td>
              <td><select data-c="${id}">
                ${ch > 0 ? `<option value="recruit" ${decisions[id] === 'recruit' ? 'selected' : ''}>登用</option>` : ''}
                <option value="release" ${decisions[id] === 'release' ? 'selected' : ''}>解放</option>
                <option value="execute" ${decisions[id] === 'execute' ? 'selected' : ''}>処断</option></select></td></tr>`;
          }).join('')}</table><p class="muted">登用に失敗した者は去っていきます。処断すると相手勢力との関係が悪化します。</p>`;
      };
      el.onchange = (e) => { if (e.target.dataset.c) decisions[e.target.dataset.c] = e.target.value; };
      render();
    },
    buttons: [{ label: '決定', value: () => decisions, primary: true }],
    closeValue: decisions,
  });
}

// ---------- 他国からの提案 ----------
export async function proposalDialog(app, pr) {
  busy(null);
  const st = app.st;
  const n = st.nations[pr.from];
  const kind = pr.kind === 'alliance' ? '同盟' : `停戦（12季）`;
  const princess = pr.kind === 'marriage' ? st.princesses[pr.princess] : null;
  let text, title = '使者の来訪', buttons = [{ label: '断る', value: false }, { label: '受け入れる', value: true, primary: true }];
  const t = pr.terms;
  if (princess) {
    title = '縁談の使者';
    text = `<div class="row" style="align-items:flex-start;gap:12px">${portrait(princess, n.culture, n.color)}<div><p>「我が主君の姫、${esc(princess.name)}（${st.year - princess.birth}歳）を、貴殿の妃として迎えられたし」</p><p class="muted">受け入れると婚姻同盟が結ばれます。</p></div></div>`;
  } else if (pr.kind === 'peace') {
    title = '和平の使者';
    const cond = t.kind === 'payGold' ? `我が国は賠償金として${t.gold}金を差し出す` : t.kind === 'demandGold' ? `貴国は賠償金として${t.gold}金を支払うこと` : '互いに何も求めない';
    text = `<p>「長き戦いに民は疲れ果てた。和睦を結ばれたし。条件は、${cond}」</p><p class="muted">受け入れると戦争が終わり、${12}季の停戦となります。</p>`;
    if (t.kind === 'demandGold' && st.nations[st.playerNation].gold < t.gold) text += '<p class="neg">（金が足りない分は支払えるだけ支払います）</p>';
  } else if (pr.kind === 'submit') {
    title = '降伏の使者';
    text = '<p>「我が国は貴国に臣従し、毎年の朝貢を約束いたす。どうか矛を収められよ」</p><p class="muted">受け入れると相手は従属国となり、毎季収入の20%を朝貢します。</p>';
  } else if (pr.kind === 'demand') {
    title = '臣従の要求';
    text = '<p>「我が主君に臣従し、朝貢せよ。さもなくば、我が軍勢が貴国を踏みつぶすであろう」</p><p class="muted">受け入れると従属国となり、毎季収入の20%を朝貢します。拒めば戦争になります。</p>';
    buttons = [{ label: '拒絶する（開戦）', value: false }, { label: '臣従する', value: true, primary: true }];
  } else if (pr.coalition) {
    title = '包囲網への誘い';
    text = `<p>「強大化する${esc(st.nations[pr.coalition]?.name ?? '')}に対抗するため、我らと同盟を結ばれたし」</p>`;
  } else text = `<p>「我が国と${kind}を結ばれたし」</p>`;
  const ok = await modal({
    title,
    body: `<p><span class="swatch" style="background:${n.color}"></span><b>${n.name}</b>の${esc(ruler(st, pr.from)?.name ?? '')}から使者が来た。</p>${text}`,
    buttons,
    closeValue: false,
  });
  busy('他勢力の行動中…');
  return ok;
}

export function battleSummaryHtml(st, b, side) {
  const reason = { annihilated: '一方の軍が壊滅した', keep: '本丸が占拠された', timeout: '攻撃側が攻めきれず撤退した', retreat: '退却した' }[b.reason] ?? '';
  return `<p>${reason}。</p><table class="list"><tr><th></th><th>武将</th><th>兵数</th><th></th></tr>
    ${b.units.map((u) => `<tr><td>${u.side === side ? '自' : '敵'}</td><td>${esc(u.name)}</td><td>${fmt(u.start)} → ${fmt(u.soldiers)}</td><td>${u.dead ? '<span class="neg">討死</span>' : u.routed ? '敗走' : ''}</td></tr>`).join('')}</table>`;
}

// ---------- 歴史イベント ----------
export async function eventDialog(app, { ev, title, text, choices, date, involved, result }) {
  busy(null);
  app.renderTopbar?.();
  audio.sfx('horn');
  const body = `<div class="event-scroll"><div class="event-glyph">${esc(ev?.glyph ?? '史')}</div>
    <div class="event-main"><div class="event-date">${esc(date)}</div><div class="event-text">${esc(text)}</div>
    ${!involved && result ? `<div class="event-result">${esc(result)}</div>` : ''}
    ${involved && choices?.length > 1 ? `<div class="muted" style="margin-top:8px">どうする？</div>` : ''}</div></div>`;
  let buttons;
  if (involved && choices?.length) {
    buttons = choices.map((c, i) => ({ label: c.label, value: i, primary: i === 0 }));
  } else buttons = [{ label: '閉じる', value: 0, primary: true }];
  const idx = await modal({
    title: `史実イベント：${esc(title)}`,
    width: '640px',
    body: (el) => {
      el.innerHTML = body + (involved && choices?.length > 1 ? `<table class="list" style="margin-top:8px">${choices.map((c) => `<tr><td><b>${esc(c.label)}</b></td><td class="muted">${esc(c.hint ?? '')}</td></tr>`).join('')}</table>` : '');
    },
    buttons,
    closeValue: 0,
  });
  if (app.turnBusy) busy('他勢力の行動中…');
  return idx;
}
