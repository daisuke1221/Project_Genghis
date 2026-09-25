// 世界地図ビュー：地形メッシュ、勢力色、都市・軍勢マーカー、選択
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PROVINCES, PROVINCE_TERRAIN, CULTURES } from '../game/data.js';
import { MAP_W, MAP_H, GRID_W, GRID_H, RES, cells, heightAt, PROV_POS, provinceAt, cellXZ, fbm } from '../game/geo.js';
import { NATION_DEF, generalsIn } from '../game/state.js';
import { path as tradePath } from '../game/trade.js';
import { bindPointer, pickAt, tweenFn } from './engine.js';
import * as M from './models.js';

const W1 = GRID_W + 1;

export class WorldView {
  constructor(engine) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9cc3dc);
    this.scene.fog = new THREE.Fog(0x9cc3dc, 110, 230);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
    this.camera.position.set(30, 55, 55);
    this.labels = engine.makeLabelRenderer();
    this.controls = new MapControls(this.camera, engine.renderer.domElement);
    this.controls.target.set(30, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 120;
    this.controls.maxPolarAngle = 1.15;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.state = null;
    this.selected = null;
    this.targets = new Set();
    this.hover = null;
    this.onSelect = null;
    this.onHover = null;
    this.autoRotate = false;
    this.markers = {};
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildSelectionRing();
    bindPointer(engine.renderer.domElement, {
      onClick: (e) => { if (engine.view === this) this.handleClick(e); },
      onMove: (e) => { if (engine.view === this) this.handleMove(e); },
      onRight: () => { if (engine.view === this) this.onRightClick?.(); },
    });
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b5a3a, 1.3));
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
    sun.position.set(-40, 80, 30);
    this.scene.add(sun);
  }

  buildTerrain() {
    const pos = new Float32Array(W1 * (GRID_H + 1) * 3);
    this.heights = new Float32Array(W1 * (GRID_H + 1));
    for (let j = 0; j <= GRID_H; j++) for (let i = 0; i <= GRID_W; i++) {
      const k = j * W1 + i;
      const [x, z] = cellXZ(i, j);
      const h = heightAt(x, z);
      this.heights[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
    const idx = [];
    for (let j = 0; j < GRID_H; j++) for (let i = 0; i < GRID_W; i++) {
      const a = j * W1 + i, b = a + 1, c = a + W1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.terrainGeo = g;
    this.terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }));
    this.scene.add(this.terrain);
    // 地方ごとの頂点
    this.provVerts = PROVINCES.map(() => []);
    for (let k = 0; k < cells.length; k++) if (cells[k] >= 0) this.provVerts[cells[k]].push(k);
    this.baseColor = new Float32Array(pos.length);
    const col = new THREE.Color();
    for (let k = 0; k < cells.length; k++) {
      const v = cells[k];
      const [x, z] = cellXZ(k % W1, Math.floor(k / W1));
      const h = this.heights[k];
      const n = fbm(x * 0.4, z * 0.4, 21) - 0.5;
      if (v >= 0) col.setHex(PROVINCE_TERRAIN[PROVINCES[v].terrain].color);
      else if (v === -2) col.setHex(z < -8 ? 0x8f9a78 : z > 8 ? 0xd4bd86 : 0xa9a27a);
      else col.setHex(0xc2b280);
      col.offsetHSL(0, 0, n * 0.12);
      if (h > 3.2) col.lerp(new THREE.Color(0xf4f4f4), Math.min(1, (h - 3.2) / 1.2));
      if (h < 0) col.lerp(new THREE.Color(0x3a6a7a), Math.min(1, -h / 2));
      this.baseColor[k * 3] = col.r; this.baseColor[k * 3 + 1] = col.g; this.baseColor[k * 3 + 2] = col.b;
    }
  }

  buildWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2f6f9f, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.02;
    this.scene.add(water);
    this.water = water;
  }

  buildTrees() {
    const pts = [];
    let seed = 12345;
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 9000 && pts.length < 2200; n++) {
      const x = (r() - 0.5) * MAP_W, z = (r() - 0.5) * MAP_H;
      const p = provinceAt(x, z);
      const h = heightAt(x, z);
      if (h < 0.3 || h > 3) continue;
      const def = p ? PROVINCES.find((q) => q.id === p) : null;
      const forest = def ? def.terrain === 'forest' || (def.terrain === 'mountain' && r() < 0.35) || (def.terrain === 'farmland' && r() < 0.12) : z < -10 && r() < 0.5;
      if (!forest) continue;
      if (fbm(x * 0.3, z * 0.3, 33) < 0.45) continue;
      pts.push([x, h, z, 0.5 + r() * 0.5]);
    }
    const g = new THREE.ConeGeometry(0.28, 0.9, 5);
    g.translate(0, 0.45, 0);
    const inst = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x2e5a2a, flatShading: true, roughness: 0.9 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, y, z, s], i) => { m.makeScale(s, s * (0.8 + (i % 5) * 0.1), s); m.setPosition(x, y - 0.05, z); inst.setMatrixAt(i, m); });
    this.scene.add(inst);
  }

  buildSelectionRing() {
    const g = new THREE.TorusGeometry(1.6, 0.12, 6, 32);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
  }

  // ---- 状態の反映 ----
  setState(st) {
    this.state = st;
    this.refresh();
  }

  refresh() {
    this.recolor();
    this.refreshMarkers();
  }

  recolor() {
    const st = this.state;
    const colAttr = this.terrainGeo.getAttribute('color');
    const arr = colAttr.array;
    const season = st ? st.season : 1;
    const ownerOf = PROVINCES.map((p) => (st ? st.provinces[p.id].owner : null));
    const nationColor = {};
    if (st) for (const n of Object.values(st.nations)) nationColor[n.id] = new THREE.Color(n.color);
    const c = new THREE.Color(), tmp = new THREE.Color();
    const white = new THREE.Color(0xf2f4f6), gold = new THREE.Color(0xd8b04a), hl = new THREE.Color(0xfff1a8), red = new THREE.Color(0xff7050);
    const selIdx = this.selected ? PROVINCES.findIndex((p) => p.id === this.selected) : -1;
    const targetIdx = new Set([...this.targets].map((t) => PROVINCES.findIndex((p) => p.id === t)));
    for (let k = 0; k < cells.length; k++) {
      c.setRGB(this.baseColor[k * 3], this.baseColor[k * 3 + 1], this.baseColor[k * 3 + 2]);
      const v = cells[k];
      const z = -MAP_H / 2 + Math.floor(k / W1) * RES;
      if (this.heights[k] > 0) {
        if (season === 3) c.lerp(white, Math.max(0, Math.min(0.75, (-z + 6) / 30)));
        else if (season === 2) c.lerp(gold, 0.12);
      }
      if (v >= 0) {
        const own = ownerOf[v];
        if (own) c.lerp(nationColor[own], 0.42);
        else c.lerp(tmp.setHex(0x9a9a9a), 0.25);
        // 境界線
        let border = 0;
        for (const d of [1, -1, W1, -W1]) {
          const nb = cells[k + d];
          if (nb === undefined || nb === v) continue;
          if (nb < 0) continue;
          border = Math.max(border, ownerOf[nb] !== own ? 2 : 1);
        }
        if (border === 2) c.multiplyScalar(0.35);
        else if (border === 1) c.multiplyScalar(0.72);
        if (v === selIdx) c.lerp(hl, 0.35);
        if (targetIdx.has(v)) {
          const enemy = own !== (st?.playerNation);
          c.lerp(enemy ? red : hl, 0.45);
        }
        if (v === this.hoverIdx) c.multiplyScalar(1.12);
      }
      arr[k * 3] = c.r; arr[k * 3 + 1] = c.g; arr[k * 3 + 2] = c.b;
    }
    colAttr.needsUpdate = true;
  }

  refreshMarkers() {
    const st = this.state;
    if (!st) return;
    for (const p of PROVINCES) {
      const prov = st.provinces[p.id];
      const owner = prov.owner;
      const style = owner ? CULTURES[NATION_DEF[owner].culture].style : 'nomad';
      const color = owner ? st.nations[owner].color : '#999999';
      const isCap = owner && st.nations[owner].capital === p.id;
      const soldiers = owner ? generalsIn(st, p.id, owner).reduce((s, g) => s + (g.unit?.soldiers ?? 0), 0) : 0;
      const key = `${style}|${color}|${isCap}|${prov.city.walls}|${soldiers > 0 ? Math.min(3, Math.ceil(soldiers / 4000)) : 0}`;
      let mk = this.markers[p.id];
      if (!mk || mk.key !== key) {
        if (mk) M.disposeGroup(mk.group);
        mk = this.makeMarker(p, style, color, isCap, prov.city.walls, soldiers);
        mk.key = key;
        this.markers[p.id] = mk;
        this.scene.add(mk.group);
      }
      const gens = owner ? generalsIn(st, p.id, owner).length : 0;
      mk.label.innerHTML = `<div class="nm"><span class="dot" style="background:${color}"></span>${p.city}</div>` +
        (owner ? `<div class="troops">兵 ${soldiers.toLocaleString()}${gens ? `・将${gens}` : ''}</div>` : '<div class="troops">空白地</div>');
      mk.label.className = `city-label${isCap ? ' capital' : ''}`;
    }
  }

  makeMarker(p, style, color, isCap, walls, soldiers) {
    const { x, z } = PROV_POS[p.id];
    const y = Math.max(0.05, heightAt(x, z));
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const s = isCap ? 0.85 : 0.65;
    if (style === 'nomad') {
      const pal = M.palace('nomad', color);
      pal.scale.setScalar(s * 0.55);
      group.add(pal);
    } else {
      const pal = M.palace(style, color);
      pal.scale.setScalar(s * 0.6);
      group.add(pal);
      if (walls > 0) {
        const r = 1.05;
        const segs = 8;
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          const w = M.box(walls >= 3 ? 0xb0a898 : walls === 2 ? 0x9a7a55 : 0x7a5a35, 0.85, 0.22 + walls * 0.06, 0.1, 0, 0, 0);
          w.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          w.rotation.y = -a + Math.PI / 2;
          group.add(w);
        }
      }
    }
    if (soldiers > 0) {
      const n = Math.min(3, Math.ceil(soldiers / 4000));
      const tm = M.troopMarker(style === 'nomad' ? 'cav' : 'inf', new THREE.Color(color).getHex(), n);
      tm.scale.setScalar(1.3);
      tm.position.set(1.3, 0, 0.9);
      group.add(tm);
    }
    const el = document.createElement('div');
    el.className = 'city-label';
    const lbl = new CSS2DObject(el);
    lbl.position.set(0, 1.6, 0);
    group.add(lbl);
    return { group, label: el };
  }

  // 交易路：金色の点線と、行き来する隊商
  setRoutes(routes) {
    const key = routes.map((r) => `${r.from}-${r.to}`).join('|');
    if (key === this.routeKey) return;
    this.routeKey = key;
    if (this.routeGroup) M.disposeGroup(this.routeGroup);
    this.routeGroup = new THREE.Group();
    this.scene.add(this.routeGroup);
    this.caravans = [];
    for (const r of routes) {
      const pids = tradePath(r.from, r.to);
      if (!pids) continue;
      const pts = [];
      for (let i = 0; i < pids.length; i++) {
        const a = PROV_POS[pids[i]];
        pts.push(new THREE.Vector3(a.x, Math.max(0.1, heightAt(a.x, a.z)) + 0.5, a.z));
        if (i < pids.length - 1) {
          const b = PROV_POS[pids[i + 1]];
          const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
          pts.push(new THREE.Vector3(mx, Math.max(0.1, heightAt(mx, mz)) + 0.9, mz));
        }
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 12));
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffd35a, dashSize: 0.6, gapSize: 0.35 }));
      line.computeLineDistances();
      this.routeGroup.add(line);
      const cam = M.camel();
      cam.scale.setScalar(2.2);
      this.routeGroup.add(cam);
      this.caravans.push({ obj: cam, curve, t: Math.random(), speed: 0.06 / Math.max(1, pids.length - 1) });
    }
  }

  setSelected(pid) {
    this.selected = pid;
    if (pid) {
      const { x, z } = PROV_POS[pid];
      this.ring.position.set(x, Math.max(0.1, heightAt(x, z)) + 0.1, z);
      this.ring.visible = true;
    } else this.ring.visible = false;
    this.recolor();
  }

  setTargets(list) {
    this.targets = new Set(list);
    this.recolor();
  }

  focus(pid, dist) {
    const { x, z } = PROV_POS[pid];
    const t = this.controls.target;
    const off = this.camera.position.clone().sub(t);
    if (dist) off.setLength(dist);
    const to = new THREE.Vector3(x, 0, z);
    const from = t.clone();
    const camFrom = this.camera.position.clone();
    const camTo = to.clone().add(off);
    return tweenFn(0.6, (k) => {
      t.lerpVectors(from, to, k);
      this.camera.position.lerpVectors(camFrom, camTo, k);
    });
  }

  // ---- 入力 ----
  provinceFromEvent(e) {
    const hits = pickAt(e, this.camera, this.engine.renderer.domElement, [this.terrain], false);
    if (!hits.length) return null;
    const p = hits[0].point;
    return provinceAt(p.x, p.z);
  }
  handleClick(e) {
    const pid = this.provinceFromEvent(e);
    this.onSelect?.(pid, e);
  }
  handleMove(e) {
    const pid = this.provinceFromEvent(e);
    const idx = pid ? PROVINCES.findIndex((p) => p.id === pid) : -1;
    if (idx !== this.hoverIdx) {
      this.hoverIdx = idx;
      this.recolor();
    }
    this.onHover?.(pid, e);
  }

  enter() { this.controls.enabled = true; }
  exit() { this.controls.enabled = false; }

  update(dt, t) {
    if (this.autoRotate) {
      const tg = this.controls.target;
      const ang = t * 0.03;
      tg.set(Math.sin(ang) * 25 + 10, 0, Math.cos(ang * 0.7) * 5);
      this.camera.position.set(tg.x - 5, 45, tg.z + 42);
      this.camera.lookAt(tg);
    } else {
      this.controls.update();
      const tg = this.controls.target;
      tg.x = Math.max(-MAP_W / 2, Math.min(MAP_W / 2, tg.x));
      tg.z = Math.max(-MAP_H / 2, Math.min(MAP_H / 2, tg.z));
    }
    for (const c of this.caravans || []) {
      c.t = (c.t + dt * c.speed) % 2;
      const k = c.t < 1 ? c.t : 2 - c.t; // 往復
      const p = c.curve.getPointAt(k);
      const ahead = c.curve.getPointAt(Math.min(1, Math.max(0, k + (c.t < 1 ? 0.01 : -0.01))));
      c.obj.position.set(p.x, p.y - 0.45, p.z);
      c.obj.lookAt(ahead.x, p.y - 0.45, ahead.z);
    }
    this.ring.rotation.z += dt * 0.8;
    this.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
    this.water.position.y = -0.02 + Math.sin(t * 0.8) * 0.02;
    for (const mk of Object.values(this.markers)) {
      mk.group.traverse((o) => { if (o.userData.flag) o.rotation.y = Math.sin(t * 3 + mk.group.position.x) * 0.25; });
    }
  }
}
