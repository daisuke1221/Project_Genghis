// 合戦ビュー：ヘックス戦場の3D表示とプレイヤー操作
import * as THREE from 'three';
import { TRAITS, ROLES } from '../game/personnel.js';
import { chanceText } from '../game/strategist.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { UNIT_TYPES } from '../game/data.js';
import {
  COLS, ROWS, BATTLE_TERRAIN, hkey, tileOf, unitAt, reachable, moveUnit, attack, targetsFrom, wait as waitUnit,
  endPhase, aiStep, retreat, battleResult, activeUnits, estimateDamage, attackRange,
  WEATHER, TACTICS, tacticOptions, tacticChance, useTactic, duelTargets, duel, duelAcceptChance, duelWinChance,
  damageFactors, defenseFactors,
} from '../game/battle.js';
import { PROV_DEF } from '../game/state.js';
import { bindPointer, pickAt, tween, tweenFn, wait, easeOut } from './engine.js';
import * as M from './models.js';
import { audio } from '../audio/audio.js';
import { confirmBox } from '../ui/ui.js';

const R = 1;
const SQ3 = Math.sqrt(3);
const OX = (SQ3 * R * (COLS - 0.5)) / 2;
const OZ = (1.5 * R * (ROWS - 1)) / 2;
export const hexPos = (c, r) => [SQ3 * R * (c + 0.5 * (r & 1)) - OX, 1.5 * R * r - OZ];
const TH = { plain: 0.3, forest: 0.34, hill: 0.75, river: 0.1, castle: 0.55, keep: 0.8 };
const TC = { plain: 0x8dbb5a, forest: 0x5a8a40, hill: 0xa39a6a, river: 0x3f86c0, castle: 0xa8a090, keep: 0x9a8f7c };

export class BattleView {
  constructor(engine) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb0c8d8);
    this.scene.fog = new THREE.Fog(0xb0c8d8, 40, 90);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 200);
    this.labels = engine.makeLabelRenderer();
    this.controls = new OrbitControls(this.camera, engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 36;
    this.controls.maxPolarAngle = 1.25;
    this.controls.enabled = false;
    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5a4a30, 1.2));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.3);
    sun.position.set(-10, 24, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14, near: 1, far: 70 });
    this.scene.add(sun);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.overlay = document.createElement('div');
    this.overlay.className = 'hidden';
    document.getElementById('app').appendChild(this.overlay);
    bindPointer(engine.renderer.domElement, {
      onClick: (e) => { if (engine.view === this) this.handleClick(e); },
      onMove: (e) => { if (engine.view === this) this.handleMove(e); },
      onRight: () => { if (engine.view === this) this.deselect(); },
    });
  }

  // 合戦を実行し、結果を返す
  run(st, b, playerSide) {
    this.st = st;
    this.b = b;
    this.playerSide = playerSide;
    this.auto = false;
    this.busy = false;
    this.selected = null;
    this.build();
    this.camera.position.set(playerSide === 'att' ? -14 : 14, 17, 15);
    this.controls.target.set(0, 0, 0);
    this.showOverlay();
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.startPhase();
    });
  }

  build() {
    M.disposeGroup(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    const b = this.b;
    const ground = M.box(0x7a9a50, 60, 0.1, 50, 0, -0.2, 0);
    this.root.add(ground);
    this.hexMeshes = [];
    const hexGeo = new THREE.CylinderGeometry(R * 0.97, R * 0.97, 1, 6);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = tileOf(b, c, r).t;
      const [x, z] = hexPos(c, r);
      const h = TH[t];
      const m = new THREE.Mesh(hexGeo, M.mat(TC[t]));
      m.scale.y = h;
      m.position.set(x, h / 2 - 0.1, z);
      m.receiveShadow = true;
      m.userData.hex = [c, r];
      this.root.add(m);
      this.hexMeshes.push(m);
      if (t === 'forest') {
        for (const [dx, dz] of [[-0.35, -0.2], [0.3, -0.3], [0, 0.35]]) {
          const tr = M.tree(1.1, 'pine');
          tr.position.set(x + dx, h - 0.1, z + dz);
          this.root.add(tr);
        }
      }
      if (t === 'castle' || t === 'keep') {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.5;
          const wall = M.box(0xc2b8a4, 0.5, 0.25 + b.walls * 0.12, 0.12, x + Math.cos(a) * 0.7, h - 0.1, z + Math.sin(a) * 0.7);
          wall.rotation.y = -a;
          this.root.add(wall);
        }
      }
      if (t === 'keep') {
        const def = PROV_DEF[b.provinceId];
        const tower = M.palace('europe', 0x888888);
        tower.scale.setScalar(0.35);
        tower.position.set(x + 0.45, h - 0.1, z - 0.4);
        this.root.add(tower);
        void def;
      }
    }
    // 移動・攻撃範囲の表示用
    this.hlGroup = new THREE.Group();
    this.root.add(this.hlGroup);
    this.hlGeo = new THREE.CylinderGeometry(R * 0.9, R * 0.9, 0.05, 6);
    // 部隊
    this.unitObjs = new Map();
    for (const u of b.units) this.makeUnit(u);
    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.selRing.rotation.x = Math.PI / 2;
    this.selRing.visible = false;
    this.root.add(this.selRing);
  }

  nationColor(side, nation) {
    const nid = nation ?? (side === 'att' ? this.b.attNation : this.b.defNation);
    return new THREE.Color(this.st.nations[nid]?.color ?? '#888').getHex();
  }

  makeUnit(u) {
    const g = new THREE.Group();
    const el = document.createElement('div');
    el.className = 'unit-label';
    const lbl = new CSS2DObject(el);
    lbl.position.set(0, 1.2, 0);
    g.add(lbl);
    const obj = { g, el, figures: null, n: -1 };
    this.unitObjs.set(u.id, obj);
    this.root.add(g);
    this.placeUnit(u);
    this.refreshUnit(u);
  }

  placeUnit(u) {
    const o = this.unitObjs.get(u.id);
    const [x, z] = hexPos(u.c, u.r);
    o.g.position.set(x, TH[tileOf(this.b, u.c, u.r).t] - 0.1, z);
  }

  refreshUnit(u) {
    const o = this.unitObjs.get(u.id);
    if (!o) return;
    const n = Math.max(1, Math.min(7, Math.ceil(u.soldiers / 350)));
    if (n !== o.n) {
      if (o.figures) o.g.remove(o.figures);
      o.figures = M.troopMarker(u.type, this.nationColor(u.side, u.nation), n);
      o.figures.scale.setScalar(1.05);
      o.figures.rotation.y = u.side === 'att' ? Math.PI / 2 : -Math.PI / 2;
      const fl = M.flag(this.nationColor(u.side, u.nation), 1.1);
      fl.position.set(-0.45, 0, -0.45);
      o.figures.add(fl);
      o.g.add(o.figures);
      o.n = n;
    }
    const T = UNIT_TYPES[u.type];
    const pct = Math.max(0, u.soldiers / Math.max(1, u.start));
    const col = u.side === this.playerSide ? '#6fdc6f' : '#ff6a5a';
    o.el.className = `unit-label${u.acted && u.side === this.b.side ? ' done' : ''}`;
    const tags = `${u.commander ? '<span class="cmd">★</span>' : ''}${u.ally ? '<span style="color:#9fd0ff">援</span>' : ''}${u.hidden ? '<span class="hid">伏</span>' : ''}${u.confused ? '<span class="neg">乱</span>' : ''}${u.wounded ? '<span class="neg">傷</span>' : ''}${u.turncoat ? '<span style="color:#ffb347">寝</span>' : ''}${u.role === 'strategist' ? '<span style="color:#c9a0ff">師</span>' : u.role === 'marshal' ? '<span style="color:#ffd27a">将</span>' : ''}`;
    o.el.innerHTML = `<div>${tags}${u.name}<span style="opacity:.8">［${T.short}］</span></div><div>${u.soldiers.toLocaleString()}</div>` +
      `<div class="hp"><i style="width:${pct * 100}%;background:${col}"></i></div><div class="mo"><i style="width:${Math.max(0, u.morale)}%"></i></div>`;
    o.g.visible = !u.routed && !(u.hidden && u.side !== this.playerSide);
  }

  refreshAll() { for (const u of this.b.units) this.refreshUnit(u); }

  // ---- UI ----
  showOverlay() {
    this.overlay.className = 'overlay-layer';
    this.overlay.innerHTML = `
      <div class="panel" style="position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:6px 16px;display:flex;gap:16px;align-items:center;font-size:14px">
        <b id="bt-title"></b><span id="bt-turn"></span><span id="bt-phase"></span><span id="bt-weather" class="weather-tag"></span>
      </div>
      <div class="panel" id="bt-info" style="position:absolute;left:10px;top:10px;width:240px;padding:10px;font-size:13px"></div>
      <div class="panel" style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);padding:8px 12px;display:flex;gap:8px">
        <span id="bt-tac" class="tactic-bar"></span>
        <button class="btn" id="bt-wait">待機</button>
        <button class="btn primary" id="bt-end">ターン終了</button>
        <button class="btn" id="bt-auto">自動</button>
        <button class="btn" id="bt-retreat">退却</button>
      </div>
      <div class="panel" style="position:absolute;right:10px;top:10px;width:220px;padding:8px 10px;font-size:12px;line-height:1.6">
        <b>操作</b><br>左クリック：部隊選択 → 青いマスへ移動 → 赤い敵を攻撃<br>右クリック：選択解除<br>ドラッグ：視点回転<br>
        <span class="muted">騎兵は2マス以上動いてから攻撃すると突撃ボーナス。敵を囲むと挟撃ボーナス。本丸を占拠すれば攻撃側の勝利。<br>★総大将が敗走すると全軍が動揺する。計略は政治力で成否が決まる（軍師がいれば見立てを聞ける）。森の部隊は伏兵（敵から見えない）。</span>
      </div>`;
    const $ = (id) => this.overlay.querySelector(id);
    $('#bt-wait').onclick = () => { if (this.canAct() && this.selected) { waitUnit(this.b, this.selected); this.deselect(); this.refreshAll(); this.checkAllDone(); } };
    $('#bt-end').onclick = () => { if (this.canAct()) this.endPlayerPhase(); };
    $('#bt-auto').onclick = () => { this.auto = !this.auto; $('#bt-auto').classList.toggle('active', this.auto); this.maybeAuto(); };
    $('#bt-retreat').onclick = async () => {
      if (this.busy) return;
      if (!(await confirmBox('退却', '退却しますか？（この合戦は敗北となります）'))) return;
      retreat(this.b, this.playerSide);
      this.finish();
    };
    const att = this.st.nations[this.b.attNation].name, def = this.st.nations[this.b.defNation]?.name ?? '守備隊';
    $('#bt-title').textContent = `${PROV_DEF[this.b.provinceId].city}の${this.b.hasCastle ? '城攻め' : '野戦'}：${att} vs ${def}`;
    const W = WEATHER[this.b.weather];
    $('#bt-weather').textContent = `${W.glyph} ${W.name}`;
    $('#bt-weather').title = W.desc ?? '';
    $('#bt-tac').onclick = (e) => {
      const id = e.target.closest('[data-tac]')?.dataset.tac;
      if (!id || !this.canAct() || !this.selected) return;
      if (id === 'rally') { this.doTactic(this.selected, 'rally', null); return; }
      if (id === 'duel') { this.tacticMode = this.tacticMode === 'duel' ? null : 'duel'; this.showHighlights(this.selected); this.updateUI(); return; }
      this.tacticMode = this.tacticMode === id ? null : id;
      this.showHighlights(this.selected);
      this.updateUI();
    };
    this.updateUI();
  }

  updateUI() {
    const $ = (id) => this.overlay.querySelector(id);
    if (!$('#bt-turn')) return;
    $('#bt-turn').textContent = `${Math.min(this.b.turn, this.b.maxTurns)} / ${this.b.maxTurns}ターン`;
    const mine = this.b.side === this.playerSide;
    $('#bt-phase').innerHTML = mine ? '<span class="pos">自軍の手番</span>' : '<span class="neg">敵軍の手番</span>';
    const dis = !this.canAct();
    $('#bt-wait').disabled = dis || !this.selected;
    const sel = this.selected;
    const opts = sel && !dis ? tacticOptions(this.b, sel) : [];
    $('#bt-tac').innerHTML = sel ? `<span class="muted">計略${sel.tp}回</span>` + ['fire', 'confuse', 'rally'].map((id) => {
      const ok = opts.some((o) => o.id === id);
      return `<button class="btn small ${this.tacticMode === id ? 'active' : ''}" data-tac="${id}" ${ok ? '' : 'disabled'} title="${TACTICS[id].desc}">${TACTICS[id].name}</button>`;
    }).join('') + (sel ? `<button class="btn small ${this.tacticMode === 'duel' ? 'active' : ''}" data-tac="duel" ${!dis && duelTargets(this.b, sel).length ? '' : 'disabled'} title="武力70以上。隣接する敵将に一騎討ちを挑む（3本先取）">一騎討ち</button>` : '') : '';
    $('#bt-end').disabled = dis;
    $('#bt-retreat').disabled = this.busy;
    this.showInfo(this.hoverUnit || this.selected);
  }

  // 軍師の見立て：同じ戦場に軍師がいればより正確
  foresee(p, key) {
    return chanceText(this.st, this.st.playerNation, p, `${key}:${this.b.turn}`, this.b.strategist?.[this.playerSide] ? 20 : 0);
  }

  showInfo(u) {
    const box = this.overlay.querySelector('#bt-info');
    if (!box) return;
    const my = activeUnits(this.b, this.playerSide).reduce((s, x) => s + x.soldiers, 0);
    const en = activeUnits(this.b, this.playerSide === 'att' ? 'def' : 'att').reduce((s, x) => s + x.soldiers, 0);
    let html = `<div class="row" style="justify-content:space-between"><span class="pos">自軍 ${my.toLocaleString()}</span><span class="neg">敵軍 ${en.toLocaleString()}</span></div>`;
    const W = WEATHER[this.b.weather];
    if (W.desc) html += `<div class="muted">${W.glyph} ${W.name}：${W.desc}</div>`;
    const land = { steppe: '草原：騎馬の攻撃+15%', mountain: '山岳：騎馬の白兵-10%・歩兵の白兵+10%', forest: '森林地帯：歩兵の白兵+10%' }[this.b.terrain];
    if (land) html += `<div class="muted">${land}</div>`;
    if (this.b.notes?.length) html += `<div class="muted">${this.b.notes.slice(-3).join('<br>')}</div>`;
    if (this.tacticMode === 'duel' && this.selected && u && u.side !== this.playerSide) html += this.foresee(duelWinChance(this.selected, u), `dw:${this.selected.id}:${u.id}`) ? `<div>一騎討ち：応じるか ${this.foresee(duelAcceptChance(this.b, this.selected, u), `da:${this.selected.id}:${u.id}`)}<br>勝てるか ${this.foresee(duelWinChance(this.selected, u), `dw:${this.selected.id}:${u.id}`)}</div>` : '<div class="muted">一騎討ちの相手を選ぶ（軍師がいれば見立てを聞ける）</div>';
    else if (this.tacticMode && this.selected && u && u.side !== this.playerSide) html += this.foresee(tacticChance(this.b, this.selected, this.tacticMode, u), `tc:${this.selected.id}:${u.id}:${this.tacticMode}`) ? `<div>${TACTICS[this.tacticMode].name}：${this.foresee(tacticChance(this.b, this.selected, this.tacticMode, u), `tc:${this.selected.id}:${u.id}:${this.tacticMode}`)}</div>` : '';
    if (u) {
      const T = UNIT_TYPES[u.type];
      const tt = tileOf(this.b, u.c, u.r).t;
      html += `<div class="sect"><b>${u.name}</b>（${u.side === this.playerSide ? '自軍' : '敵軍'}）<div class="grid2">
        <span>兵種</span><span>${T.name}（移動${T.move}・射程${attackRange(this.b, u)}）</span>
        <span>兵数</span><span>${u.soldiers.toLocaleString()} / ${u.start.toLocaleString()}</span>
        <span>士気</span><span>${Math.max(0, Math.round(u.morale))}</span>
        <span>訓練</span><span>${u.training}</span>
        <span>武力/統率</span><span>${u.war} / ${u.lead}</span>
        <span>地形</span><span>${BATTLE_TERRAIN[tt].name}</span>
        ${u.role ? `<span>役職</span><span>${ROLES[u.role].name}</span>` : ''}
        ${u.traits?.length ? `<span>特技</span><span>${u.traits.map((t) => TRAITS[t].name).join('・')}</span>` : ''}</div></div>`;
      if (this.selected && u.side !== this.playerSide && this.selected.side === this.playerSide) {
        const est = Math.round(estimateDamage(this.b, this.selected, u));
        const fmtF = ([label, m]) => `<div class="${m >= 1 ? 'pos' : 'neg'}">${label} ×${m.toFixed(2)}</div>`;
        const af = damageFactors(this.b, this.selected, u).factors;
        const df = defenseFactors(this.b, u).factors;
        html += `<div class="sect"><b>予想損害：約${est.toLocaleString()}</b><div class="muted" style="font-size:12px">${[...af, ...df].map(fmtF).join('') || '補正なし'}</div></div>`;
      }
    } else if (this.hoverHex) {
      const t = tileOf(this.b, ...this.hoverHex).t;
      const T = BATTLE_TERRAIN[t];
      const notes = {
        plain: '見通しが良く、騎馬が突撃しやすい',
        forest: '騎馬は動きにくく攻撃力が落ちる。歩兵は守りやすい。伏兵を置ける。火計に弱い',
        hill: '高所から攻めると+20%（弓+15%・射程+1）。坂の下からの攻撃は-15%、突撃も弱まる。歩兵は守りやすい',
        river: '川の中から攻めると-30%。渡った直後の攻撃は-15%。守りにも不利',
        castle: '守備側は城壁の分だけ守りが堅い。攻撃側は入りにくい',
        keep: '攻撃側が占拠すれば勝利',
      }[t];
      html += `<div class="sect">${T.name}：防御×${(t === 'castle' || t === 'keep') ? `${(1.1 + 0.3 * this.b.walls).toFixed(1)}（守備側）` : T.def}　移動${T.cost}${t === 'forest' ? '（騎馬3）' : ''}<div class="muted" style="font-size:12px">${notes}</div></div>`;
    }
    box.innerHTML = html;
  }

  sp() { return this.auto ? 0.3 : 1; }

  // 自動モードなら、操作が落ち着いた時点で自軍の手番をAIに渡す
  maybeAuto() {
    if (this.auto && this.phase === 'player' && !this.busy && !this.b.over) this.endPlayerPhase(true);
  }

  canAct() { return this.phase === 'player' && !this.busy && !this.b.over; }

  // ---- フェイズ進行 ----
  async startPhase() {
    this.updateUI();
    if (this.b.over) return this.finish();
    if (this.b.side === this.playerSide && !this.auto) {
      this.phase = 'player';
      this.refreshAll();
      this.updateUI();
      return;
    }
    this.phase = 'ai';
    this.busy = true;
    this.updateUI();
    await wait(0.3 * this.sp());
    let guard = 0;
    while (!this.b.over && guard++ < 40) {
      const evs = aiStep(this.b);
      if (evs === null) break;
      await this.animate(evs);
    }
    this.busy = false;
    if (this.b.over) return this.finish();
    endPhase(this.b);
    this.refreshAll();
    this.startPhase();
  }

  endPlayerPhase(force = false) {
    if (!force && !this.canAct()) return;
    this.deselect();
    endPhase(this.b);
    this.refreshAll();
    this.startPhase();
  }

  checkAllDone() {
    const left = activeUnits(this.b, this.playerSide).filter((u) => !u.acted);
    if (!left.length && !this.b.over) this.endPlayerPhase(true);
    this.updateUI();
  }

  async finish() {
    this.phase = 'over';
    this.busy = true;
    this.clearHighlights();
    this.refreshAll();
    const b = this.b;
    const won = b.winner === this.playerSide;
    audio.jingle(won ? 'win' : 'lose');
    const reason = { annihilated: '敵軍を壊滅させた', keep: '本丸を占拠した', timeout: '日没により攻撃側が撤退した', retreat: '退却した' }[b.reason] ?? '';
    const lines = b.units.map((u) => `<tr><td>${u.side === this.playerSide ? '自' : '敵'}</td><td>${u.name}</td><td>${u.start.toLocaleString()} → ${u.soldiers.toLocaleString()}</td><td>${u.dead ? '<span class="neg">討死</span>' : u.wounded ? '<span class="neg">負傷</span>' : u.routed ? '敗走' : ''}</td></tr>`).join('');
    const div = document.createElement('div');
    div.className = 'modal-back';
    div.innerHTML = `<div class="modal"><h2>${won ? '勝利' : '敗北'}</h2><div class="body"><p>${reason}。</p>
      <table class="list"><tr><th></th><th>武将</th><th>兵数</th><th></th></tr>${lines}</table></div>
      <div class="foot"><button class="btn primary">地図へ戻る</button></div></div>`;
    this.overlay.appendChild(div);
    await new Promise((res) => { div.querySelector('button').onclick = res; });
    this.overlay.className = 'hidden';
    this.overlay.innerHTML = '';
    this.resolve(battleResult(b));
  }

  // ---- アニメーション ----
  async animate(events) {
    for (const ev of events) {
      if (ev.type === 'move') await this.animMove(ev);
      else if (ev.type === 'attack') await this.animAttack(ev);
      else if (ev.type === 'rout') await this.animRout(ev);
      else if (ev.type === 'tactic') await this.animTactic(ev);
      else if (ev.type === 'duel') await this.animDuel(ev);
      else if (ev.type === 'ambush') { const o = this.unitObjs.get(ev.id); this.refreshAll(); this.floatNum(o.g.position, '伏兵！', 'gold'); audio.sfx('horn'); await wait(0.4 * this.sp()); }
      else if (ev.type === 'collapse') {
        const u = this.b.units.find((x) => x.id === ev.id);
        this.floatNum(this.unitObjs.get(ev.id).g.position, `総大将${u.name}敗走！ 全軍動揺`, 'gold');
        await wait(0.6 * this.sp());
      }
    }
    this.refreshAll();
    this.updateUI();
  }

  async animMove(ev) {
    const o = this.unitObjs.get(ev.id);
    for (let i = 1; i < ev.path.length; i++) {
      const [c, r] = ev.path[i];
      const [x, z] = hexPos(c, r);
      const y = TH[tileOf(this.b, c, r).t] - 0.1;
      const [px] = hexPos(...ev.path[i - 1]);
      if (o.figures) o.figures.rotation.y = x >= px ? Math.PI / 2 : -Math.PI / 2;
      await tween(o.g.position, { x, y, z }, 0.14 * this.sp());
    }
  }

  async animAttack(ev) {
    const a = this.b.units.find((u) => u.id === ev.id), t = this.b.units.find((u) => u.id === ev.target);
    const ao = this.unitObjs.get(a.id), to = this.unitObjs.get(t.id);
    const from = ao.g.position.clone(), dst = to.g.position.clone();
    if (ao.figures) ao.figures.rotation.y = dst.x >= from.x ? Math.PI / 2 : -Math.PI / 2;
    if (ev.ranged) {
      audio.sfx('arrow');
      const arrows = [];
      for (let i = 0; i < 5; i++) {
        const ar = M.box(0x3a2a1a, 0.03, 0.03, 0.35, 0, 0, 0);
        this.root.add(ar);
        arrows.push({ ar, off: new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6) });
      }
      const dist = from.distanceTo(dst);
      await tweenFn(0.5 * this.sp(), (k) => {
        for (const { ar, off } of arrows) {
          const p = from.clone().lerp(dst, k).add(off);
          p.y += 0.6 + Math.sin(k * Math.PI) * dist * 0.35;
          ar.position.copy(p);
          ar.lookAt(dst.x + off.x, dst.y, dst.z + off.z);
        }
      }, (k) => k);
      for (const { ar } of arrows) this.root.remove(ar);
    } else {
      audio.sfx('clash');
      const mid = from.clone().lerp(dst, 0.45);
      await tween(ao.g.position, { x: mid.x, z: mid.z }, 0.15 * this.sp(), easeOut);
      this.shake(to.g);
      await tween(ao.g.position, { x: from.x, z: from.z }, 0.2 * this.sp());
    }
    this.floatNum(to.g.position, `-${ev.dmg}`);
    if (ev.counter) this.floatNum(ao.g.position, `-${ev.counter}`, 'blue');
    this.refreshUnit(a); this.refreshUnit(t);
    await wait(0.25 * this.sp());
  }

  // 一騎討ち：両将が中央に進み出て打ち合う
  async animDuel(ev) {
    const a = this.b.units.find((x) => x.id === ev.id), t = this.b.units.find((x) => x.id === ev.target);
    const box = document.createElement('div');
    box.className = 'duel-box';
    this.overlay.appendChild(box);
    const head = `<div class="duel-title">一騎討ち</div><div class="duel-names"><span>${a.name}<small>武${a.war}</small></span><b>VS</b><span>${t.name}<small>武${t.war}</small></span></div>`;
    audio.sfx('horn');
    if (ev.refused) {
      box.innerHTML = `${head}<div class="duel-log">${t.name}は一騎討ちに応じなかった！<br>臆病ぶりに兵の士気が下がった。</div>`;
      await wait(1.4 * this.sp());
      box.remove();
      return;
    }
    const ao = this.unitObjs.get(a.id).g, to = this.unitObjs.get(t.id).g;
    const mid = ao.position.clone().lerp(to.position, 0.5);
    let hitsA = 0, hitsT = 0;
    const lines = [];
    for (const r of ev.rounds) {
      if (r === 'a') hitsA++; else hitsT++;
      lines.push(r === 'a' ? `${a.name}の一撃！` : `${t.name}の一撃！`);
      box.innerHTML = `${head}<div class="duel-score">${'●'.repeat(hitsA)}${'○'.repeat(3 - hitsA)}　${'●'.repeat(hitsT)}${'○'.repeat(3 - hitsT)}</div><div class="duel-log">${lines.slice(-3).join('<br>')}</div>`;
      audio.sfx('clash');
      this.shake(r === 'a' ? to : ao);
      this.floatNum(mid, '⚔', 'gold');
      await wait(0.45 * this.sp());
    }
    const w = this.b.units.find((x) => x.id === ev.winner), l = this.b.units.find((x) => x.id === ev.loser);
    const res = { killed: `${l.name}、討ち取られる！`, wounded: `${l.name}は深手を負った！`, fled: `${l.name}は逃げ去った！` }[ev.outcome];
    box.innerHTML = `${head}<div class="duel-log"><b>${w.name}の勝利！</b><br>${res}</div>`;
    await wait(1.4 * this.sp());
    box.remove();
    this.refreshAll();
  }

  async animTactic(ev) {
    const o = this.unitObjs.get(ev.id);
    const name = TACTICS[ev.tactic].name;
    this.floatNum(o.g.position, name, 'gold');
    if (ev.tactic === 'rally') { audio.sfx('horn'); await wait(0.4 * this.sp()); return; }
    const to = this.unitObjs.get(ev.target);
    await wait(0.3 * this.sp());
    if (!ev.ok) { this.floatNum(to.g.position, '失敗', 'blue'); audio.sfx('error'); await wait(0.3 * this.sp()); return; }
    if (ev.tactic === 'fire') {
      audio.sfx('clash');
      const flames = [];
      for (let i = 0; i < 10; i++) {
        const f = M.sphere(i % 2 ? 0xff7a1a : 0xffc93a, 0.12, 0, 0, 0, 6, { emissive: 0xaa3300 });
        f.position.copy(to.g.position).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.2, (Math.random() - 0.5) * 1.2));
        this.root.add(f); flames.push(f);
      }
      await tweenFn(0.7 * this.sp(), (k) => { for (const f of flames) { f.position.y += 0.02; f.scale.setScalar(1 + k * 2); } });
      for (const f of flames) this.root.remove(f);
      this.floatNum(to.g.position, `-${ev.dmg}`);
    } else {
      this.floatNum(to.g.position, '混乱！', 'blue');
    }
    this.refreshAll();
    await wait(0.3 * this.sp());
  }

  async animRout(ev) {
    const o = this.unitObjs.get(ev.id);
    const u = this.b.units.find((x) => x.id === ev.id);
    this.floatNum(o.g.position, ev.dead ? `${u.name} 討死！` : '敗走', 'gold');
    audio.sfx('rout');
    await tween(o.g.position, { y: o.g.position.y - 0.8 }, 0.5 * this.sp());
    o.g.visible = false;
  }

  shake(g) {
    const x = g.position.x;
    tweenFn(0.25, (k) => { g.position.x = x + Math.sin(k * 30) * 0.08 * (1 - k); });
  }

  floatNum(pos, text, cls = '') {
    const el = document.createElement('div');
    el.className = `float-num ${cls}`;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(pos).add(new THREE.Vector3(0, 1.4, 0));
    this.root.add(o);
    const y0 = o.position.y;
    tweenFn(1.1, (k) => { o.position.y = y0 + k * 1.2; el.style.opacity = String(1 - k * k); }).then(() => { el.remove(); this.root.remove(o); });
  }

  // ---- 入力 ----
  hexFromEvent(e) {
    const objs = [...this.hexMeshes, ...[...this.unitObjs.values()].map((o) => o.g)];
    const hits = pickAt(e, this.camera, this.engine.renderer.domElement, objs, true);
    for (const h of hits) {
      if (h.object.userData.hex) return h.object.userData.hex;
      let o = h.object;
      while (o && o.parent !== this.root) o = o.parent;
      for (const [id, uo] of this.unitObjs) if (uo.g === o) {
        const u = this.b.units.find((x) => x.id === id);
        if (u && !u.routed) return [u.c, u.r];
      }
    }
    return null;
  }

  handleMove(e) {
    const hx = this.hexFromEvent(e);
    this.hoverHex = hx;
    this.hoverUnit = hx ? unitAt(this.b, ...hx) : null;
    this.showInfo(this.hoverUnit || this.selected);
  }

  async handleClick(e) {
    if (!this.canAct()) return;
    const hx = this.hexFromEvent(e);
    if (!hx) return;
    const [c, r] = hx;
    const u = unitAt(this.b, c, r);
    const sel = this.selected;
    if (sel && this.tacticMode === 'duel') {
      if (u && duelTargets(this.b, sel).includes(u)) {
        this.busy = true; this.tacticMode = null; this.clearHighlights();
        await this.animate(duel(this.b, sel, u));
        this.busy = false; this.deselect();
        if (this.b.over) return this.finish();
        this.checkAllDone(); this.maybeAuto();
        return;
      }
      this.tacticMode = null; this.showHighlights(sel); this.updateUI();
      return;
    }
    if (sel && this.tacticMode) {
      const opt = tacticOptions(this.b, sel).find((o) => o.id === this.tacticMode);
      if (u && opt?.targets.includes(u)) { await this.doTactic(sel, this.tacticMode, u); return; }
      this.tacticMode = null;
      this.showHighlights(sel);
      this.updateUI();
      return;
    }
    if (sel && u && u.side !== this.playerSide) {
      if (targetsFrom(this.b, sel).includes(u) && !sel.acted) {
        this.busy = true;
        this.clearHighlights();
        const evs = attack(this.b, sel, u);
        await this.animate(evs);
        this.busy = false;
        this.deselect();
        if (this.b.over) return this.finish();
        this.checkAllDone();
        this.maybeAuto();
      }
      return;
    }
    if (u && u.side === this.playerSide) {
      if (u === sel) return this.deselect();
      if (!u.acted) this.select(u);
      return;
    }
    if (sel && !sel.moved && !u) {
      const reach = reachable(this.b, sel);
      if (reach.has(hkey(c, r))) {
        this.busy = true;
        this.clearHighlights();
        const ev = moveUnit(this.b, sel, c, r);
        await this.animate([ev]);
        this.busy = false;
        if (this.b.over) return this.finish();
        if (!targetsFrom(this.b, sel).length) { waitUnit(this.b, sel); this.deselect(); this.checkAllDone(); }
        else this.select(sel);
        this.maybeAuto();
      }
    }
  }

  async doTactic(u, id, target) {
    this.busy = true;
    this.tacticMode = null;
    this.clearHighlights();
    const evs = useTactic(this.b, u, id, target);
    await this.animate(evs);
    this.busy = false;
    this.deselect();
    if (this.b.over) return this.finish();
    this.checkAllDone();
    this.maybeAuto();
  }

  select(u) {
    this.selected = u;
    this.tacticMode = null;
    this.selRing.visible = true;
    const [x, z] = hexPos(u.c, u.r);
    this.selRing.position.set(x, TH[tileOf(this.b, u.c, u.r).t] - 0.05, z);
    this.showHighlights(u);
    audio.sfx('click');
    this.updateUI();
  }

  deselect() {
    this.selected = null;
    this.tacticMode = null;
    this.selRing.visible = false;
    this.clearHighlights();
    this.updateUI();
  }

  clearHighlights() {
    for (const m of [...this.hlGroup.children]) this.hlGroup.remove(m);
  }

  showHighlights(u) {
    this.clearHighlights();
    const add = (c, r, color, op = 0.45) => {
      const m = new THREE.Mesh(this.hlGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      const [x, z] = hexPos(c, r);
      m.position.set(x, TH[tileOf(this.b, c, r).t] - 0.05, z);
      this.hlGroup.add(m);
    };
    if (this.tacticMode === 'duel') {
      for (const t of duelTargets(this.b, u)) add(t.c, t.r, 0xffd35a, 0.65);
      return;
    }
    if (this.tacticMode) {
      const opt = tacticOptions(this.b, u).find((o) => o.id === this.tacticMode);
      for (const t of opt?.targets ?? []) add(t.c, t.r, 0xff9a2a, 0.6);
      return;
    }
    if (!u.moved) for (const [, cell] of reachable(this.b, u)) if (cell.c !== u.c || cell.r !== u.r) add(cell.c, cell.r, 0x4aa3ff, 0.35);
    for (const t of targetsFrom(this.b, u)) add(t.c, t.r, 0xff4a3a, 0.55);
  }

  enter() { this.controls.enabled = true; }
  exit() { this.controls.enabled = false; }

  update(dt, time) {
    this.controls.update();
    if (this.selRing?.visible) this.selRing.rotation.z += dt;
    for (const [, o] of this.unitObjs) {
      o.g.traverse((x) => { if (x.userData.flag) x.rotation.y = Math.sin(time * 4 + o.g.position.x) * 0.3; });
    }
  }
}
