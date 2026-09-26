// アプリ全体の制御：画面遷移・HUD・ターン進行
import { Engine } from './render/engine.js';
import { WorldView } from './render/worldView.js';
import { CityView } from './render/cityView.js';
import { BattleView } from './render/battleView.js';
import { BUILDING_COLORS, BUILDING_GLYPH } from './render/models.js';
import { audio } from './audio/audio.js';
import { $, esc, fmt, modal, toast, busy, tooltip, statBar, confirmBox } from './ui/ui.js';
import * as D from './ui/dialogs.js';
import * as X from './ui/extraDialogs.js';
import { diplomacyDialog, callToArmsDialog } from './ui/diplomacyDialog.js';
import { atWar, friendsOf, treatyLabel } from './game/diplomacy.js';
import { techsIn } from './game/tech.js';
import { routesFrom } from './game/trade.js';
import { TECH_TYPES } from './game/data.js';
import {
  newGame, PROV_DEF, NATION_DEF, dateStr, nationProvinces, nationGenerals, generalsIn, nationSoldiers, ruler,
  serialize, deserialize, treaty,
} from './game/state.js';
import { PROVINCE_TERRAIN, BUILDINGS, BUILD_ORDER, WALLS, CLEAR_FOREST_COST, UNIT_TYPES, SEASONS } from './game/data.js';
import { cityYields, canBuild, startBuild, buildCost, tileAt, clearForest, demolish, buildingOutput, canBuildWalls, startWalls } from './game/city.js';
import { moveTargets } from './game/military.js';
import { executeMove } from './game/actions.js';
import { endTurn } from './game/turn.js';
import { areNeighbors } from './game/diplomacy.js';
import { SCENARIOS, getScenario } from './game/scenarios.js';
import { autoResolve } from './game/battle.js';

const cultureName = (c) => ({ mongol: 'モンゴル系遊牧民', turkic: 'テュルク系遊牧民', chinese: '漢・女真・契丹', korean: '高麗', japanese: '日本（武家）', tibetan: 'チベット', islamic: 'イスラーム', indian: 'インド', european: '西欧', slavic: 'スラヴ', greek: 'ギリシア（ビザンツ）', georgian: 'グルジア' }[c] ?? c);
const TILE_NAMES = { grass: '草地', sand: '砂地', hill: '丘', forest: '森', river: '川' };
const SAVE_PREFIX = 'steppe-khan.save.';

class App {
  constructor() {
    this.engine = new Engine($('#viewport'));
    this.world = new WorldView(this.engine);
    this.city = new CityView(this.engine);
    this.battle = new BattleView(this.engine);
    this.st = null;
    this.mode = 'title';
    this.sel = null;
    this.moveMode = null;
    this.lastLogSeen = 0;
    this.world.onSelect = (pid) => this.onWorldClick(pid);
    this.world.onHover = (pid, e) => this.onWorldHover(pid, e);
    this.world.onRightClick = () => { if (this.moveMode) this.cancelMove(); else this.select(null); };
    this.city.onTileClick = (t) => this.onTileClick(t);
    this.city.onTileHover = (t, e) => this.onTileHover(t, e);
    this.city.onRightClick = () => { this.city.tool = null; this.renderCityPanels(); };
    this.hooks = {
      battle: (b) => this.runBattle(b),
      captives: (captor, gids) => D.captivesDialog(this, gids),
      proposal: (pr) => D.proposalDialog(this, pr),
      progress: (name) => busy(`${name}の行動中…`),
      event: (payload) => D.eventDialog(this, payload),
      callToArms: (call) => callToArmsDialog(this, call),
    };
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.showTitle();
  }

  // ================= タイトル =================
  showTitle() {
    this.mode = 'title';
    $('#hud').classList.add('hidden');
    this.engine.setView(this.world);
    this.world.setState(this.previewOf(SCENARIOS[0].id));
    this.world.setSelected(null);
    this.world.autoRotate = true;
    let hasAuto = false;
    try { hasAuto = !!localStorage.getItem(`${SAVE_PREFIX}auto`); } catch { hasAuto = false; }
    $('#screen').innerHTML = `
      <div class="title-screen">
        <div class="title-logo">草原の覇者</div>
        <div class="title-sub">〜ユーラシア戦記〜</div>
        <div class="title-menu">
          <button class="btn primary" data-a="new">新しく始める</button>
          <button class="btn" data-a="continue" ${hasAuto ? '' : 'disabled'}>続きから</button>
          <button class="btn" data-a="load">記録を読み込む</button>
          <button class="btn" data-a="help">遊び方</button>
          <button class="btn" data-a="settings">設定</button>
        </div>
        <div class="title-foot">1189年、草原に一人の若者が立つ——。 ／ 画像・音楽はすべてプログラムで生成しています</div>
      </div>`;
    $('#screen').onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      audio.init();
      audio.play('title');
      audio.sfx('click');
      if (a === 'new') this.showScenarios();
      if (a === 'continue') this.loadSlot('auto');
      if (a === 'load') { const slot = await D.saveLoadDialog(this, 'load'); if (slot) this.loadSlot(slot); }
      if (a === 'help') D.helpDialog();
      if (a === 'settings') D.settingsDialog(this);
    };
  }

  previewOf(id) {
    this.previews = this.previews || {};
    if (!this.previews[id]) this.previews[id] = newGame({ scenario: id, seed: 1 });
    return this.previews[id];
  }

  showScenarios(initial = this.scenarioId ?? SCENARIOS[0].id) {
    this.mode = 'scenario';
    this.world.autoRotate = true;
    let cur = initial;
    const render = () => {
      const sc = getScenario(cur);
      const st = this.previewOf(cur);
      this.world.setState(st);
      this.world.setSelected(null);
      const alive = Object.values(st.nations).filter((n) => n.alive)
        .sort((a, b) => nationProvinces(st, b.id).length - nationProvinces(st, a.id).length);
      $('#screen').innerHTML = `
        <div class="title-screen scenario-screen">
          <div class="panel scenario-box">
            <h2>シナリオを選択</h2>
            <div class="scenario-list">
              ${SCENARIOS.map((s) => `<div class="scenario-card ${s.id === cur ? 'sel' : ''}" data-s="${s.id}">
                <div class="yr">${s.year}</div><div><b>${s.title}</b><div class="muted">${s.subtitle}</div></div></div>`).join('')}
            </div>
            <div class="scenario-desc">
              <h3>${sc.title}</h3><p>${sc.desc}</p>
              <div class="muted">勢力数 ${alive.length}　主な勢力：${alive.slice(0, 6).map((n) => `<span class="swatch" style="background:${n.color}"></span>${n.name}（${nationProvinces(st, n.id).length}）`).join('　')}</div>
            </div>
            <div class="row" style="justify-content:space-between;margin-top:12px">
              <button class="btn" data-a="back">戻る</button>
              <button class="btn primary" data-a="next">このシナリオで勢力を選ぶ</button>
            </div>
          </div>
        </div>`;
    };
    render();
    $('#screen').onclick = (e) => {
      const card = e.target.closest('[data-s]');
      if (card) { cur = card.dataset.s; audio.sfx('click'); render(); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'back') this.showTitle();
      if (a === 'next') { this.scenarioId = cur; audio.sfx('click'); this.showSelect(cur); }
    };
  }

  showSelect(scenarioId = this.scenarioId ?? SCENARIOS[0].id) {
    this.mode = 'select';
    this.world.autoRotate = false;
    this.world.controls.target.set(40, 0, 0);
    this.world.camera.position.set(40, 60, 50);
    const sc = getScenario(scenarioId);
    const st = this.previewOf(scenarioId);
    this.world.setState(st);
    const nations = Object.values(st.nations).filter((n) => n.alive);
    let chosen = sc.recommended;
    const render = () => {
      const n = st.nations[chosen];
      const r = ruler(st, chosen);
      const provs = nationProvinces(st, chosen);
      const gens = nationGenerals(st, chosen);
      // 難易度：最も強い隣国との兵力比と領地の数から
      const mine = nationSoldiers(st, chosen);
      const rivals = Object.values(st.nations).filter((x) => x.alive && x.id !== chosen && areNeighbors(st, chosen, x.id));
      const strongest = Math.max(1, ...rivals.map((x) => nationSoldiers(st, x.id)));
      const score = (mine / strongest) * (1 + provs.length * 0.1);
      const diff = score >= 1.3 ? '易' : score >= 0.7 ? '中' : '難';
      $('#screen').innerHTML = `
        <div class="panel select-head">${sc.year}年「${sc.title}」— プレイする勢力を地図から選んでください</div>
        <div class="panel select-panel">
          <h2><span class="swatch" style="background:${n.color}"></span>${n.name}${chosen === sc.recommended ? ' <span class="muted" style="font-size:13px">おすすめ</span>' : ''}</h2>
          <div class="grid2">
            <span>君主</span><span>${r.name}（${st.year - r.birth}歳）</span>
            <span>文化</span><span>${cultureName(st.nations[chosen].culture)}</span>
            <span>領地</span><span>${provs.map((p) => PROV_DEF[p.id].city).join('、')}</span>
            <span>武将</span><span>${gens.length}人</span>
            <span>兵力</span><span>${fmt(nationSoldiers(st, chosen))}</span>
            <span>難易度</span><span>${diff}</span>
          </div>
          <div class="muted" style="margin-top:6px">君主 ${r.name}：武${r.war} 統${r.lead} 政${r.pol} 魅${r.cha}</div>
          <div class="nation-list"><table class="list">${nations.map((x) => `<tr class="clickable ${x.id === chosen ? 'sel' : ''}" data-n="${x.id}"><td><span class="swatch" style="background:${x.color}"></span>${x.name}</td><td>${nationProvinces(st, x.id).length}地方</td></tr>`).join('')}</table></div>
          <div class="row" style="margin-top:10px;justify-content:space-between">
            <button class="btn" data-a="back">戻る</button>
            <button class="btn primary" data-a="start">この勢力で始める</button>
          </div>
        </div>`;
      this.world.setSelected(n.capital);
    };
    render();
    this.world.onSelect = (pid) => {
      if (this.mode !== 'select') return this.onWorldClick(pid);
      const owner = pid && st.provinces[pid].owner;
      if (owner && st.nations[owner].alive) { chosen = owner; audio.sfx('click'); render(); }
    };
    $('#screen').onclick = (e) => {
      const row = e.target.closest('[data-n]');
      if (row) { chosen = row.dataset.n; audio.sfx('click'); render(); this.world.focus(st.nations[chosen].capital); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'back') this.showScenarios(scenarioId);
      if (a === 'start') this.startGame(chosen, scenarioId);
    };
  }

  startGame(nid, scenarioId) {
    this.st = newGame({ playerNation: nid, scenario: scenarioId, seed: (Date.now() ^ (Math.random() * 1e9)) & 0x7fffffff });
    this.enterGame();
    const r = ruler(this.st, nid);
    modal({
      title: `${this.st.year}年 春 —「${getScenario(this.st.scenario).title}」`,
      body: `<p>${this.st.nations[nid].name}の${r.name}として、あなたの戦いが始まる。</p>
        <p>まずは都市を選び、<b>「箱庭（内政）」</b>で農地や市場を建てて国を富ませよう。兵を集め、隣国を攻め取り、ユーラシアの${Math.round(0.75 * 100)}%を支配すれば天下統一だ。</p>
        <p class="muted">操作：左ドラッグ／右ドラッグで地図の移動・回転、ホイールで拡大縮小。</p>`,
      buttons: [{ label: '出陣！', value: true, primary: true }],
    });
  }

  enterGame() {
    this.mode = 'map';
    $('#screen').innerHTML = '';
    $('#screen').onclick = null;
    this.world.onSelect = (pid) => this.onWorldClick(pid);
    this.world.autoRotate = false;
    this.engine.setView(this.world);
    this.world.setState(this.st);
    $('#hud').classList.remove('hidden');
    audio.play('map');
    this.lastLogSeen = this.st.log.length;
    const cap = this.st.nations[this.st.playerNation].capital;
    this.select(cap);
    this.world.focus(cap, 45);
    this.refresh();
  }

  // ================= HUD =================
  refresh() {
    if (!this.st) return;
    this.renderTopbar();
    this.renderLog();
    if (this.mode === 'map') {
      $('#leftpanel').classList.add('hidden');
      this.renderSide();
      this.world.refresh();
      this.world.setRoutes(this.st.routes.filter((r) => r.nation === this.st.playerNation));
    } else if (this.mode === 'city') {
      this.renderCityPanels();
    }
  }

  renderTopbar() {
    const st = this.st, nid = st.playerNation, n = st.nations[nid];
    const inc = n.lastIncome;
    const provs = nationProvinces(st, nid).length;
    $('#topbar').innerHTML = `
      <span class="date">${dateStr(st)}</span>
      <span class="nation"><span class="swatch" style="background:${n.color}"></span>${n.name}</span>
      <span class="res">
        <span title="金（前季の収入）">金 <b>${fmt(n.gold)}</b>${inc ? ` <span class="${inc.gold >= 0 ? 'pos' : 'neg'}">(${inc.gold >= 0 ? '+' : ''}${fmt(inc.gold)})</span>` : ''}</span>
        <span title="食糧">食糧 <b>${fmt(n.food)}</b></span>
        <span title="総兵力">兵 <b>${fmt(nationSoldiers(st, nid))}</b></span>
        <span title="支配地方">領地 <b>${provs}</b>/53</span>
      </span>
      <span class="spacer"></span>
      <span class="btns">
        ${this.mode === 'city' ? '<button class="btn" data-a="back">地図へ戻る</button>' : ''}
        <button class="btn" data-a="harem">後宮</button>
        <button class="btn" data-a="diplo">外交</button>
        <button class="btn" data-a="nations">勢力</button>
        <button class="btn" data-a="save">記録</button>
        <button class="btn" data-a="settings">設定</button>
        <button class="btn" data-a="help">？</button>
        <button class="btn primary" data-a="end">ターン終了</button>
      </span>`;
    $('#topbar').onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      audio.sfx('click');
      if (a === 'end') this.endTurn();
      if (a === 'back') this.leaveCity();
      if (a === 'diplo') { await diplomacyDialog(this); this.refresh(); }
      if (a === 'harem') { await X.haremDialog(this); this.refresh(); }
      if (a === 'nations') { const pid = await D.nationsDialog(this); if (pid) { if (this.mode === 'city') this.leaveCity(); this.select(pid); this.world.focus(pid); } }
      if (a === 'save') { const r = await D.saveLoadDialog(this, 'both'); if (r?.load) this.loadSlot(r.load); }
      if (a === 'settings') D.settingsDialog(this);
      if (a === 'help') D.helpDialog();
    };
  }

  renderLog() {
    const logs = this.st.log.slice(-40);
    $('#log').innerHTML = logs.map((l) => `<div class="${l.important ? 'imp' : ''}"><span class="d">${l.date}</span>${esc(l.text)}</div>`).join('');
    $('#log').scrollTop = 1e6;
  }

  select(pid) {
    this.sel = pid;
    this.world.setSelected(pid);
    this.renderSide();
  }

  renderSide() {
    const side = $('#sidepanel');
    const pid = this.sel;
    if (!pid || !this.st) { side.classList.add('hidden'); return; }
    side.classList.remove('hidden');
    const st = this.st, p = st.provinces[pid], def = PROV_DEF[pid], c = p.city;
    const own = p.owner === st.playerNation;
    const nat = p.owner ? st.nations[p.owner] : null;
    const y = cityYields(st, pid);
    const gov = p.governorId ? st.generals[p.governorId] : null;
    const gens = p.owner ? generalsIn(st, pid, p.owner) : [];
    const tr = p.owner && !own ? treaty(st, st.playerNation, p.owner) : null;
    const rel = p.owner && !own ? st.nations[st.playerNation].relations[p.owner] : null;
    let html = `<h2>${def.city} <span class="muted">${def.region}</span></h2>
      <div class="owner">${nat ? `<span class="swatch" style="background:${nat.color}"></span>${nat.name}${nat.capital === pid ? '（首都）' : ''}` : '<span class="muted">空白地（どの勢力にも属さない）</span>'}
      ${p.owner && !own && (tr || atWar(st, st.playerNation, p.owner)) ? `<span class="${tr ? 'pos' : 'neg'}">［${treatyLabel(st, st.playerNation, p.owner)}］</span>` : ''}${rel !== null ? ` <span class="muted">友好 ${rel}</span>` : ''}</div>
      <div class="grid2">
        <span>地勢</span><span>${PROVINCE_TERRAIN[def.terrain].name}</span>
        <span>特産</span><span>${def.specialty}（価値${def.specValue}）</span>
        <span>人口</span><span>${fmt(c.pop)} / ${fmt(y.popCap)}</span>
        <span>民忠</span><span>${c.loyalty} ${statBar(c.loyalty)}</span>
        <span>城壁</span><span>${WALLS[c.walls].name}${c.wallProgress !== null ? `（建設中 ${Math.round(c.wallProgress * 100)}%）` : ''}</span>
        <span>馬</span><span>${fmt(c.horses)}</span>
        ${own ? `<span>季節収入</span><span>金 ${fmt(y.gold)}・食 ${fmt(y.food - y.foodUse)}</span>` : ''}
        <span>太守</span><span>${gov ? gov.name : '―'}</span>
      </div>`;
    if (own) {
      html += `<div class="cmds">
        <button class="btn primary" data-a="city">箱庭（内政）</button>
        <button class="btn" data-a="recruit">徴兵</button>
        <button class="btn" data-a="sortie">出陣・移動</button>
        <button class="btn" data-a="personnel">人事</button>
        <button class="btn" data-a="trade">交易・隊商</button>
        <button class="btn" data-a="tech">技術者</button>
        <button class="btn ${p.delegated ? 'active' : ''}" data-a="delegate" style="grid-column:span 2">委任：${p.delegated ? 'ON' : 'OFF'}</button>
      </div>`;
      const techs = techsIn(st, pid);
      const routes = routesFrom(st, pid);
      html += `<div class="sect" style="font-size:13px"><b>技術者</b>：${techs.length ? techs.map((t) => `${esc(t.name)}（${TECH_TYPES[t.type].name}${'★'.repeat(t.level)}）`).join('、') : '<span class="muted">なし</span>'}<br>
        <b>交易路</b>：${routes.length ? routes.map((r) => `→${PROV_DEF[r.to].city}${r.last ? (r.last.raided ? '<span class="neg">(略奪)</span>' : `<span class="pos">(+${fmt(r.last.profit)})</span>`) : ''}`).join('、') : '<span class="muted">なし</span>'}
        <span class="muted">／特産 ${def.specialty} 在庫${fmt(c.goods?.[def.specialty] ?? 0)}荷</span></div>`;
    } else {
      html += `<div class="cmds"><button class="btn" data-a="city">箱庭を見る</button>${p.owner ? '<button class="btn" data-a="diplo">外交</button>' : ''}</div>`;
    }
    html += `<div class="sect"><b>武将</b> <span class="muted">${gens.length}人</span>`;
    const showStats = own || gens.length <= 6;
    for (const g of gens) {
      const u = g.unit;
      html += `<div class="gen-row"><span>${g.id === nat?.rulerId ? '👑' : ''}${esc(g.name)}${g.moved ? ' <span class="muted">済</span>' : ''}</span>
        <span class="muted">${showStats ? `武${g.war} 統${g.lead} 政${g.pol}` : ''}</span></div>
        <div class="gen-row"><span class="muted">&nbsp;&nbsp;${u && u.soldiers > 0 ? `${UNIT_TYPES[u.type].name} ${fmt(u.soldiers)}（訓練${u.training}）` : '兵なし'}</span>${own ? `<span class="muted">忠${g.loyalty}</span>` : ''}</div>`;
    }
    html += '</div>';
    side.innerHTML = html;
    side.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      audio.sfx('click');
      if (a === 'city') this.enterCity(pid);
      if (a === 'recruit') { await D.recruitDialog(this, pid); this.refresh(); }
      if (a === 'sortie') this.startSortie(pid);
      if (a === 'personnel') { await D.personnelDialog(this, pid); this.refresh(); }
      if (a === 'trade') { await X.tradeDialog(this, pid); this.refresh(); }
      if (a === 'tech') { await X.techDialog(this, pid); this.refresh(); }
      if (a === 'delegate') { p.delegated = !p.delegated; toast(p.delegated ? `${def.city}の内政を委任しました（毎季、自動で建設します）` : `${def.city}の委任を解除しました`); this.refresh(); }
      if (a === 'diplo') { await diplomacyDialog(this, p.owner); this.refresh(); }
    };
  }

  onWorldClick(pid) {
    if (this.mode !== 'map') return;
    if (this.moveMode) { this.finishSortie(pid); return; }
    if (pid !== this.sel) audio.sfx('click');
    this.select(pid);
  }

  onWorldHover(pid, e) {
    if (!this.st || this.mode !== 'map' || !pid) { tooltip(null); return; }
    const p = this.st.provinces[pid], def = PROV_DEF[pid];
    const nat = p.owner ? this.st.nations[p.owner] : null;
    let extra = '';
    if (this.moveMode) {
      const ok = this.moveMode.targets.includes(pid);
      extra = ok ? (p.owner === this.st.playerNation ? '<br><span class="pos">クリックで移動</span>' : '<br><span class="neg">クリックで攻撃</span>') : '';
    }
    tooltip(`<b>${def.city}</b>（${def.region}）<br>${nat ? `<span class="swatch" style="background:${nat.color}"></span>${nat.name}` : '空白地'}${extra}`, e);
  }

  // ================= 出陣 =================
  async startSortie(pid) {
    const gids = await D.sortieDialog(this, pid);
    if (!gids?.length) return;
    const targets = moveTargets(this.st, this.st.playerNation, pid);
    if (!targets.length) { toast('移動できる地方がありません'); return; }
    this.moveMode = { from: pid, gids, targets };
    this.world.setTargets(targets);
    const hint = $('#hint');
    hint.textContent = '移動・攻撃先の地方をクリック（右クリック／Escで取消）';
    hint.classList.remove('hidden');
  }

  cancelMove() {
    this.moveMode = null;
    this.world.setTargets([]);
    $('#hint').classList.add('hidden');
  }

  async finishSortie(pid) {
    const mm = this.moveMode;
    if (!pid || !mm.targets.includes(pid)) { this.cancelMove(); return; }
    const st = this.st, nid = st.playerNation;
    const owner = st.provinces[pid].owner;
    this.cancelMove();
    if (owner !== nid) {
      const tr = owner ? treaty(st, nid, owner) : null;
      const name = owner ? st.nations[owner].name : '空白地';
      const allies = owner ? friendsOf(st, owner).filter((f) => f !== nid).map((f) => st.nations[f].name) : [];
      let msg = tr
        ? `${name}とは${tr === 'alliance' ? '同盟' : tr === 'vassal' ? '従属関係' : '停戦'}中です。条約を破棄して${PROV_DEF[pid].city}に攻め込みますか？<br><span class="neg">（他勢力からの信用も失います）</span>`
        : owner && !atWar(st, nid, owner) ? `${name}に宣戦布告し、${PROV_DEF[pid].city}に攻め込みますか？` : `${name}の${PROV_DEF[pid].city}に攻め込みますか？`;
      if (owner && !atWar(st, nid, owner) && allies.length) msg += `<br><span class="muted">${name}の味方（${allies.join('、')}）も参戦するかもしれません。</span>`;
      if (!(await confirmBox('出陣', msg, '攻め込む', 'やめる'))) return;
      audio.sfx('horn');
    }
    const res = await executeMove(st, nid, mm.gids, mm.from, pid, this.hooks);
    if (res.kind === 'invalid') toast(res.reason);
    if (res.kind === 'occupy') { toast(`${PROV_DEF[pid].city}を占領した！`); audio.jingle('win'); }
    if (res.kind === 'move') toast(`${PROV_DEF[pid].city}へ移動しました`);
    this.checkOver();
    this.select(st.provinces[pid].owner === nid ? pid : mm.from);
    this.refresh();
  }

  // ================= 合戦 =================
  async runBattle(b) {
    busy(null);
    const st = this.st, nid = st.playerNation;
    const side = b.attNation === nid ? 'att' : 'def';
    const att = st.nations[b.attNation].name, def = st.nations[b.defNation]?.name ?? '';
    const sum = (s) => b.units.filter((u) => u.side === s).reduce((a, u) => a + u.soldiers, 0);
    const list = (s) => b.units.filter((u) => u.side === s).map((u) => `${u.name}（${UNIT_TYPES[u.type].short}${fmt(u.soldiers)}）`).join('、');
    let choice = 'command';
    audio.sfx('horn');
    if (st.options.autoBattle) choice = 'auto';
    else {
      choice = await modal({
        title: side === 'att' ? `${PROV_DEF[b.provinceId].city}攻め` : `${att}軍が${PROV_DEF[b.provinceId].city}に侵攻！`,
        body: `<div class="grid2"><span>攻撃側</span><span><b>${att}</b> 兵${fmt(sum('att'))}<br><span class="muted">${list('att')}</span></span>
          <span>守備側</span><span><b>${def}</b> 兵${fmt(sum('def'))}<br><span class="muted">${list('def')}</span></span>
          <span>城壁</span><span>${WALLS[b.walls].name}</span></div>`,
        buttons: [{ label: '自動で戦う', value: 'auto' }, { label: '自ら指揮する', value: 'command', primary: true }],
        closeValue: 'auto',
      });
    }
    let result;
    if (choice === 'auto') {
      result = autoResolve(b);
      const won = result.winner === side;
      audio.jingle(won ? 'win' : 'lose');
      await modal({ title: won ? '勝利' : '敗北', body: D.battleSummaryHtml(st, b, side), buttons: [{ label: 'OK', value: true, primary: true }] });
    } else {
      const prevMode = this.mode;
      this.mode = 'battle';
      $('#hud').classList.add('hidden');
      tooltip(null);
      this.engine.setView(this.battle);
      audio.play('battle');
      result = await this.battle.run(st, b, side);
      this.engine.setView(this.world);
      $('#hud').classList.remove('hidden');
      this.mode = prevMode === 'city' ? 'map' : prevMode;
      audio.play('map');
    }
    this.refresh();
    return result;
  }

  // ================= 箱庭 =================
  enterCity(pid) {
    this.mode = 'city';
    this.cityPid = pid;
    this.city.tool = null;
    this.city.open(this.st, pid);
    this.engine.setView(this.city);
    tooltip(null);
    audio.play('city');
    $('#leftpanel').classList.remove('hidden');
    this.renderTopbar();
    this.renderCityPanels();
  }

  leaveCity() {
    this.mode = 'map';
    this.city.tool = null;
    this.engine.setView(this.world);
    $('#leftpanel').classList.add('hidden');
    tooltip(null);
    audio.play('map');
    this.refresh();
  }

  renderCityPanels() {
    const st = this.st, pid = this.cityPid, p = st.provinces[pid], def = PROV_DEF[pid];
    const own = p.owner === st.playerNation;
    const nat = st.nations[st.playerNation];
    const left = $('#leftpanel');
    // パレット
    let html = `<h3>${def.city}の箱庭</h3>`;
    if (!own) html += '<p class="muted">他勢力の都市です（見学のみ）。</p>';
    else {
      html += `<div class="muted" style="margin-bottom:6px">建物を選んでマスをクリック。同じ建物をクリックで強化。右クリックで選択解除。</div><div class="palette">`;
      for (const type of BUILD_ORDER) {
        const B = BUILDINGS[type];
        const cost = buildCost(type, 1);
        html += `<div class="pal-item ${this.city.tool === type ? 'sel' : ''}" data-tool="${type}" title="${esc(B.desc)}">
          <div class="ic" style="background:${BUILDING_COLORS[type]}">${BUILDING_GLYPH[type]}</div>
          <div class="nm">${B.name}<div class="muted">${B.turns}季・${B.allowed.map((t) => TILE_NAMES[t]).join('/')}</div></div>
          <div class="cost ${nat.gold < cost ? 'neg' : ''}">${cost}金</div></div>`;
      }
      html += `<div class="pal-item ${this.city.tool === 'clear' ? 'sel' : ''}" data-tool="clear" title="森を切り開いて草地にする">
          <div class="ic" style="background:#556b2f">開</div><div class="nm">開墾<div class="muted">森→草地</div></div><div class="cost">${CLEAR_FOREST_COST}金</div></div>`;
      html += '</div>';
      const wc = canBuildWalls(st, pid);
      const next = WALLS[p.city.walls + 1];
      html += `<div class="sect"><b>城壁</b>：${WALLS[p.city.walls].name}${p.city.wallProgress !== null ? `（${next.name}を建設中 ${Math.round(p.city.wallProgress * 100)}%）` : ''}<br>
        ${next && p.city.wallProgress === null ? `<button class="btn small" data-a="walls" ${wc.ok ? '' : 'disabled'}>${next.name}に改築（${next.cost}金・${next.turns}季）</button>` : ''}
        <div class="muted">城壁は合戦で守備側の防御力を高めます。</div></div>`;
    }
    left.innerHTML = html;
    left.onclick = (e) => {
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      if (tool) { this.city.tool = this.city.tool === tool ? null : tool; audio.sfx('click'); this.renderCityPanels(); return; }
      if (e.target.closest('[data-a="walls"]')) {
        const r = startWalls(st, pid);
        if (r.ok) { audio.sfx('build'); toast('城壁の改築を始めました'); this.city.rebuild(); this.refresh(); }
      }
    };
    this.renderCitySide();
  }

  renderCitySide() {
    const st = this.st, pid = this.cityPid, p = st.provinces[pid];
    const own = p.owner === st.playerNation;
    const y = cityYields(st, pid);
    const side = $('#sidepanel');
    side.classList.remove('hidden');
    const def = PROV_DEF[pid];
    const inProg = p.city.grid.filter((t) => t.b && t.b.progress < 1);
    let html = `<h2>${def.city}</h2>
      <div class="grid2">
        <span>人口</span><span>${fmt(p.city.pop)} / ${fmt(y.popCap)}</span>
        <span>民忠</span><span>${p.city.loyalty} → 目標${Math.min(100, y.loyaltyTarget)}</span>
        <span>金/季</span><span>${fmt(y.gold)}（うち税${fmt(y.tax)}）</span>
        <span>食糧/季</span><span>${fmt(y.food)}（消費${fmt(y.foodUse)}）<span class="muted">${SEASONS[st.season]}</span></span>
        <span>馬/季</span><span>${fmt(y.horses)}（在庫${fmt(p.city.horses)}）</span>
        <span>徴兵上限/季</span><span>${fmt(y.recruit)}</span>
        <span>訓練/季</span><span>+${y.train}</span>
        <span>建設速度</span><span>×${y.speed.toFixed(2)}</span>
      </div>
      ${inProg.length ? `<div class="sect"><b>建設中</b>${inProg.map((t) => `<div class="gen-row"><span>${BUILDINGS[t.b.type].name}${t.b.level > 1 ? ` Lv${t.b.level}` : ''}</span><span>${Math.round(t.b.progress * 100)}%</span></div>`).join('')}</div>` : ''}`;
    const sel = this.city.selected;
    if (sel) {
      const t = tileAt(p.city, ...sel);
      html += `<div class="sect"><b>マス (${sel[0] + 1}, ${sel[1] + 1})</b>：${TILE_NAMES[t.t]}`;
      if (t.b) {
        const B = BUILDINGS[t.b.type];
        const o = buildingOutput(p.city, def, sel[0], sel[1], st.season);
        const parts = [];
        if (o.food) parts.push(`食糧+${o.food}`);
        if (o.gold) parts.push(`金+${o.gold}`);
        if (o.horses) parts.push(`馬+${o.horses}`);
        if (o.popCap) parts.push(`人口上限+${o.popCap}`);
        if (o.loyalty) parts.push(`民忠+${o.loyalty}`);
        if (o.recruit) parts.push(`徴兵+${o.recruit}`);
        if (o.train) parts.push(`訓練+${o.train}`);
        if (o.trainNew) parts.push(`新兵訓練+${o.trainNew}`);
        if (o.speed) parts.push(`建設速度+${Math.round(o.speed * 100)}%`);
        html += `<div><b>${B.name}</b> Lv${t.b.level}${t.b.progress < 1 ? `（建設中 ${Math.round(t.b.progress * 100)}%）` : ''}</div>
          <div class="muted">${B.desc}</div><div>${parts.join('・') || '（効果なし）'}</div>${o.bonus.length ? `<div class="pos">${o.bonus.join('・')}</div>` : ''}`;
        if (own && t.b.type !== 'palace') {
          const up = canBuild(st, pid, sel[0], sel[1], t.b.type);
          html += `<div class="row" style="margin-top:6px">
            ${t.b.level < B.maxLevel ? `<button class="btn small" data-a="upgrade" ${up.ok ? '' : 'disabled'}>強化 Lv${t.b.level + 1}（${buildCost(t.b.type, t.b.level + 1)}金）</button>` : '<span class="muted">最大レベル</span>'}
            <button class="btn small" data-a="demolish">取り壊す</button></div>`;
        }
      } else if (own) {
        html += '<div class="muted">左のパレットから建物を選んで建設できます。</div>';
      }
      html += '</div>';
    }
    const techs = techsIn(st, pid);
    html += `<div class="sect"><b>技術者</b> ${techs.length ? techs.map((t) => `<div class="gen-row"><span>${esc(t.name)}</span><span class="muted">${TECH_TYPES[t.type].name}${'★'.repeat(t.level)}</span></div>`).join('') : '<span class="muted">なし</span>'}
      ${own ? '<button class="btn small" data-a="tech" style="margin-top:4px">技術者を招聘・配置</button> <button class="btn small" data-a="trade" style="margin-top:4px">交易・隊商</button>' : ''}</div>`;
    html += `<div class="sect muted">隣接ボーナス：農地は川沿いで+50%／市場は隣の住居1つにつき+15%／住居は寺院の隣で+25%／工房は鉱山の隣で+50%。</div>`;
    side.innerHTML = html;
    side.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'tech') { X.techDialog(this, pid).then(() => { this.city.rebuild(); this.renderCityPanels(); this.renderTopbar(); }); return; }
      if (a === 'trade') { X.tradeDialog(this, pid).then(() => { this.renderCityPanels(); this.renderTopbar(); }); return; }
      if (!a || !sel) return;
      const t = tileAt(p.city, ...sel);
      if (a === 'upgrade') this.tryBuild(sel, t.b.type);
      if (a === 'demolish') {
        confirmBox('取り壊し', `${BUILDINGS[t.b.type].name}を取り壊しますか？（費用は戻りません）`).then((ok) => {
          if (ok) { demolish(st, pid, ...sel); this.city.rebuild(); this.renderCityPanels(); }
        });
      }
    };
  }

  tryBuild(t, type) {
    const st = this.st, pid = this.cityPid;
    const r = startBuild(st, pid, t[0], t[1], type);
    if (!r.ok) { toast(r.reason); audio.sfx('error'); return false; }
    audio.sfx('build');
    tooltip(null);
    this.city.floatText(t, `-${r.cost}金`);
    this.city.rebuild();
    this.renderTopbar();
    this.renderCityPanels();
    return true;
  }

  onTileClick(t) {
    const st = this.st, pid = this.cityPid, p = st.provinces[pid];
    const own = p.owner === st.playerNation;
    const tool = this.city.tool;
    if (own && tool) {
      const tile = tileAt(p.city, ...t);
      if (tool === 'clear') {
        const r = clearForest(st, pid, ...t);
        if (!r.ok) { toast(r.reason); audio.sfx('error'); } else { audio.sfx('build'); this.city.floatText(t, `-${CLEAR_FOREST_COST}金`); this.city.rebuild(true); this.renderTopbar(); }
      } else if (tile.b && tile.b.type !== tool) {
        // 別の建物をクリックしたら選択扱い
      } else this.tryBuild(t, tool);
    } else audio.sfx('click');
    this.renderCityPanels();
  }

  onTileHover(t, e) {
    if (!t) { tooltip(null); return; }
    const st = this.st, pid = this.cityPid, p = st.provinces[pid];
    const tile = tileAt(p.city, ...t);
    let html = `<b>${TILE_NAMES[tile.t]}</b>`;
    if (tile.b) {
      const o = buildingOutput(p.city, PROV_DEF[pid], t[0], t[1], st.season);
      html += `：${BUILDINGS[tile.b.type].name} Lv${tile.b.level}${tile.b.progress < 1 ? `（建設中${Math.round(tile.b.progress * 100)}%）` : ''}`;
      if (o.bonus.length) html += `<br><span class="pos">${o.bonus.join('・')}</span>`;
    }
    const tool = this.city.tool;
    if (tool && tool !== 'clear' && p.owner === st.playerNation) {
      const r = canBuild(st, pid, t[0], t[1], tool);
      html += `<br>${r.ok ? `<span class="pos">${BUILDINGS[tool].name}を${r.upgrade ? '強化' : '建設'}（${r.cost}金）</span>` : `<span class="neg">${r.reason}</span>`}`;
    }
    tooltip(html, e);
  }

  // ================= ターン =================
  async endTurn() {
    if (this.turnBusy || !this.st || this.st.over) return;
    if (this.mode === 'city') this.leaveCity();
    this.cancelMove();
    this.turnBusy = true;
    audio.sfx('turn');
    busy('他勢力の行動中…');
    const before = this.st.log.length;
    try {
      await endTurn(this.st, this.hooks);
    } catch (err) {
      console.error(err);
      toast(`エラーが発生しました：${err.message}`);
    }
    busy(null);
    this.turnBusy = false;
    this.autosave();
    this.refresh();
    toast(`${dateStr(this.st)}`);
    if (this.checkOver()) return;
    const important = this.st.log.slice(before).filter((l) => l.important);
    if (important.length) {
      await modal({ title: `${dateStr(this.st)}の報告`, body: important.map((l) => `<div>・${esc(l.text)}</div>`).join(''), buttons: [{ label: 'OK', value: true, primary: true }] });
    }
  }

  checkOver() {
    const over = this.st?.over;
    if (!over) return false;
    audio.jingle(over.type === 'win' ? 'win' : 'lose');
    $('#screen').innerHTML = `<div class="over-screen"><div class="big">${over.type === 'win' ? '天下統一' : '滅亡'}</div><div>${esc(over.text)}</div>
      <div class="row"><button class="btn" data-a="cont">地図を眺める</button><button class="btn primary" data-a="title">タイトルへ</button></div></div>`;
    $('#screen').onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'title') { localStorage.removeItem(`${SAVE_PREFIX}auto`); this.st = null; this.showTitle(); }
      if (a === 'cont') { $('#screen').innerHTML = ''; }
    };
    return true;
  }

  // ================= セーブ・ロード =================
  autosave() { this.saveSlot('auto'); }
  saveSlot(slot) {
    try {
      localStorage.setItem(`${SAVE_PREFIX}${slot}`, serialize(this.st));
      localStorage.setItem(`${SAVE_PREFIX}${slot}.meta`, JSON.stringify({ scenario: getScenario(this.st.scenario).title, date: dateStr(this.st), nation: this.st.nations[this.st.playerNation].name, provs: nationProvinces(this.st, this.st.playerNation).length, saved: Date.now() }));
      return true;
    } catch (err) {
      toast(`保存に失敗しました：${err.message}`);
      return false;
    }
  }
  loadSlot(slot) {
    try {
      const s = localStorage.getItem(`${SAVE_PREFIX}${slot}`);
      if (!s) { toast('記録がありません'); return; }
      this.st = deserialize(s);
      this.enterGame();
      toast(`${dateStr(this.st)}の記録を読み込みました`);
    } catch (err) {
      toast(`読み込みに失敗しました：${err.message}`);
    }
  }

  onKey(e) {
    if (e.target.tagName === 'INPUT' || document.querySelector('.modal-back')) return;
    if (e.key === 'Escape') {
      if (this.moveMode) this.cancelMove();
      else if (this.mode === 'city') { if (this.city.tool) { this.city.tool = null; this.renderCityPanels(); } else this.leaveCity(); }
    }
    if (e.key === 'Enter' && e.ctrlKey && this.mode === 'map') this.endTurn();
  }
}

export const SAVE_KEY_PREFIX = SAVE_PREFIX;
window.app = new App();
