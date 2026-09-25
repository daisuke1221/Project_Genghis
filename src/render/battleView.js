// 合戦ビュー：ヘックス戦場の3D表示とプレイヤー操作
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { UNIT_TYPES } from '../game/data.js';
import {
  COLS, ROWS, BATTLE_TERRAIN, hkey, tileOf, unitAt, reachable, moveUnit, attack, targetsFrom, wait as waitUnit,
  endPhase, aiStep, retreat, battleResult, activeUnits, estimateDamage, attackRange,
} from '../game/battle.js';
import { PROV_DEF } from '../game/state.js';
import { bindPointer, pickAt, tween, tweenFn, wait, easeOut } from './engine.js';
import * as M from './models.js';
import { audio } from '../audio/audio.js';

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

  nationColor(side) {
    const nid = side === 'att' ? this.b.attNation : this.b.defNation;
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
      o.figures = M.troopMarker(u.type, this.nationColor(u.side), n);
      o.figures.scale.setScalar(1.05);
      o.figures.rotation.y = u.side === 'att' ? Math.PI / 2 : -Math.PI / 2;
      const fl = M.flag(this.nationColor(u.side), 1.1);
      fl.position.set(-0.45, 0, -0.45);
      o.figures.add(fl);
      o.g.add(o.figures);
      o.n = n;
    }
    const T = UNIT_TYPES[u.type];
    const pct = Math.max(0, u.soldiers / Math.max(1, u.start));
    const col = u.side === this.playerSide ? '#6fdc6f' : '#ff6a5a';
    o.el.className = `unit-label${u.acted && u.side === this.b.side ? ' done' : ''}`;
    o.el.innerHTML = `<div>${u.name}<span style="opacity:.8">［${T.short}］</span></div><div>${u.soldiers.toLocaleString()}</div>` +
      `<div class="hp"><i style="width:${pct * 100}%;background:${col}"></i></div><div class="mo"><i style="width:${Math.max(0, u.morale)}%"></i></div>`;
    o.g.visible = !u.routed;
  }

  refreshAll() { for (const u of this.b.units) this.refreshUnit(u); }

  // ---- UI ----
  showOverlay() {
    this.overlay.className = 'overlay-layer';
    this.overlay.innerHTML = `
      <div class="panel" style="position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:6px 16px;display:flex;gap:16px;align-items:center;font-size:14px">
        <b id="bt-title"></b><span id="bt-turn"></span><span id="bt-phase"></span>
      </div>
      <div class="panel" id="bt-info" style="position:absolute;left:10px;top:10px;width:240px;padding:10px;font-size:13px"></div>
      <div class="panel" style="position:absolute;bottom:10px;left:50%;transform:translateX(-50%);padding:8px 12px;display:flex;gap:8px">
        <button class="btn" id="bt-wait">待機</button>
        <button class="btn primary" id="bt-end">ターン終了</button>
        <button class="btn" id="bt-auto">自動</button>
        <button class="btn" id="bt-retreat">退却</button>
      </div>
      <div class="panel" style="position:absolute;right:10px;top:10px;width:220px;padding:8px 10px;font-size:12px;line-height:1.6">
        <b>操作</b><br>左クリック：部隊選択 → 青いマスへ移動 → 赤い敵を攻撃<br>右クリック：選択解除<br>ドラッグ：視点回転<br>
        <span class="muted">騎兵は2マス以上動いてから攻撃すると突撃ボーナス。敵を囲むと挟撃ボーナス。本丸を占拠すれば攻撃側の勝利。</span>
      </div>`;
    const $ = (id) => this.overlay.querySelector(id);
    $('#bt-wait').onclick = () => { if (this.canAct() && this.selected) { waitUnit(this.b, this.selected); this.deselect(); this.refreshAll(); this.checkAllDone(); } };
    $('#bt-end').onclick = () => { if (this.canAct()) this.endPlayerPhase(); };
    $('#bt-auto').onclick = () => { this.auto = !this.auto; $('#bt-auto').classList.toggle('active', this.auto); this.maybeAuto(); };
    $('#bt-retreat').onclick = async () => {
      if (this.busy) return;
      if (!confirm('退却しますか？（この合戦は敗北となります）')) return;
      retreat(this.b, this.playerSide);
      this.finish();
    };
    const att = this.st.nations[this.b.attNation].name, def = this.st.nations[this.b.defNation]?.name ?? '守備隊';
    $('#bt-title').textContent = `${PROV_DEF[this.b.provinceId].city}の戦い：${att} vs ${def}`;
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
    $('#bt-end').disabled = dis;
    $('#bt-retreat').disabled = this.busy;
    this.showInfo(this.hoverUnit || this.selected);
  }

  showInfo(u) {
    const box = this.overlay.querySelector('#bt-info');
    if (!box) return;
    const my = activeUnits(this.b, this.playerSide).reduce((s, x) => s + x.soldiers, 0);
    const en = activeUnits(this.b, this.playerSide === 'att' ? 'def' : 'att').reduce((s, x) => s + x.soldiers, 0);
    let html = `<div class="row" style="justify-content:space-between"><span class="pos">自軍 ${my.toLocaleString()}</span><span class="neg">敵軍 ${en.toLocaleString()}</span></div>`;
    if (u) {
      const T = UNIT_TYPES[u.type];
      const tt = tileOf(this.b, u.c, u.r).t;
      html += `<div class="sect"><b>${u.name}</b>（${u.side === this.playerSide ? '自軍' : '敵軍'}）<div class="grid2">
        <span>兵種</span><span>${T.name}（移動${T.move}・射程${attackRange(this.b, u)}）</span>
        <span>兵数</span><span>${u.soldiers.toLocaleString()} / ${u.start.toLocaleString()}</span>
        <span>士気</span><span>${Math.max(0, Math.round(u.morale))}</span>
        <span>訓練</span><span>${u.training}</span>
        <span>武力/統率</span><span>${u.war} / ${u.lead}</span>
        <span>地形</span><span>${BATTLE_TERRAIN[tt].name}</span></div></div>`;
      if (this.selected && u.side !== this.playerSide && this.selected.side === this.playerSide) {
        const est = Math.round(estimateDamage(this.b, this.selected, u));
        html += `<div class="muted">予想損害：約${est.toLocaleString()}</div>`;
      }
    } else if (this.hoverHex) {
      const t = tileOf(this.b, ...this.hoverHex).t;
      const T = BATTLE_TERRAIN[t];
      html += `<div class="sect">${T.name}：防御×${(t === 'castle' || t === 'keep') ? `${(1.1 + 0.3 * this.b.walls).toFixed(1)}（守備側）` : T.def}　移動${T.cost}</div>`;
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
    const lines = b.units.map((u) => `<tr><td>${u.side === this.playerSide ? '自' : '敵'}</td><td>${u.name}</td><td>${u.start.toLocaleString()} → ${u.soldiers.toLocaleString()}</td><td>${u.dead ? '<span class="neg">討死</span>' : u.routed ? '敗走' : ''}</td></tr>`).join('');
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

  select(u) {
    this.selected = u;
    this.selRing.visible = true;
    const [x, z] = hexPos(u.c, u.r);
    this.selRing.position.set(x, TH[tileOf(this.b, u.c, u.r).t] - 0.05, z);
    this.showHighlights(u);
    audio.sfx('click');
    this.updateUI();
  }

  deselect() {
    this.selected = null;
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
