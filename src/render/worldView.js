// 世界地図ビュー：地形メッシュ、勢力色、都市・軍勢マーカー、選択
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PROVINCES, PROVINCE_TERRAIN, CULTURES } from '../game/data.js';
import { MAP_W, MAP_H, WORLD, FINE, heightAt, PROV_POS, provinceAt, fineProvinces, fbm, unproject, project, desertAt, isLandAt } from '../game/geo.js';
import { RIVERS } from '../game/geography.js';
import { NATION_DEF, generalsIn } from '../game/state.js';
import { path as tradePath } from '../game/trade.js';
import { calamityTags } from '../game/calamity.js';
import { bindPointer, pickAt, tweenFn } from './engine.js';
import * as M from './models.js';

// ゲームの範囲（地方がある領域）は細かいメッシュ、その外は粗いメッシュで描く
const IW = Math.round(MAP_W / FINE) + 1, IH = Math.round(MAP_H / FINE) + 1;
const OUT = 0.5;
const NB8 = [1, -1, IW, -IW, IW + 1, IW - 1, -IW + 1, -IW - 1];
const C = (hex) => new THREE.Color(hex);
const SAND = C(0xdcc38c), RED_SAND = C(0xcf9a5e), ROCK = C(0x8c8474), SNOW = C(0xf4f4f4), SEA_FLOOR = C(0x3a6a7a);
const sandTmp = new THREE.Color();

// 緯度・経度による植生の色（砂漠・岩・雪を重ねる）
function biomeColor(x, z, h, out = new THREE.Color()) {
  const { lat: lat0, lon } = unproject(x, z);
  const lat = lat0 + (fbm(x * 0.15, z * 0.15, 61) - 0.5) * 5;
  if (lat > 66) out.setHex(0x9ea58c);
  else if (lat > 55) out.setHex(lon > 25 ? 0x4e6e40 : 0x5d7d48);
  else if (lat > 47) out.setHex(lon < 38 || lon > 122 ? 0x628a47 : 0xa7ab68);
  else if (lat > 36) out.setHex(lon < 44 ? 0x8f9a5c : lon < 112 ? 0xb3ac74 : 0x6f9a4e);
  else if (lat > 22) out.setHex(lon < 60 ? 0xc2ae7a : lon < 100 ? 0x8aa052 : 0x5f9447);
  else out.setHex(lon < 45 ? 0xb0a060 : lon < 100 ? 0x7f9a4a : 0x4f8a3e);
  const { d, red } = desertAt(x, z);
  if (d > 0) out.lerp(sandTmp.copy(SAND).lerp(RED_SAND, red), d * 0.85);
  if (h > 1.4) out.lerp(ROCK, Math.min(0.75, (h - 1.4) / 1.1));
  const snowline = 2.5 - Math.max(0, lat0 - 35) * 0.03;
  if (h > snowline) out.lerp(SNOW, Math.min(1, (h - snowline) / 0.9));
  if (h < 0) out.lerp(SEA_FLOOR, Math.min(1, -h / 2));
  out.offsetHSL(0, 0, (fbm(x * 0.4, z * 0.4, 21) - 0.5) * 0.1);
  return out;
}

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
    // ゲームの範囲
    const pos = new Float32Array(IW * IH * 3);
    this.heights = new Float32Array(IW * IH);
    for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) {
      const k = j * IW + i;
      const x = -MAP_W / 2 + i * FINE, z = -MAP_H / 2 + j * FINE;
      const h = heightAt(x, z);
      this.heights[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
    const g = this.gridGeometry(pos, IW, IH);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    this.terrainGeo = g;
    this.terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.scene.add(this.terrain);
    this.fineProv = fineProvinces().arr;
    this.baseColor = new Float32Array(pos.length);
    const col = new THREE.Color(), tc = new THREE.Color();
    for (let k = 0; k < IW * IH; k++) {
      const x = pos[k * 3], z = pos[k * 3 + 2], h = this.heights[k];
      biomeColor(x, z, h, col);
      const v = this.fineProv[k];
      if (v >= 0 && h > 0) col.lerp(tc.setHex(PROVINCE_TERRAIN[PROVINCES[v].terrain].color), 0.3);
      this.baseColor[k * 3] = col.r; this.baseColor[k * 3 + 1] = col.g; this.baseColor[k * 3 + 2] = col.b;
    }
    this.buildOuter();
    this.buildRivers();
  }

  gridGeometry(pos, w, h, skip = null) {
    const idx = [];
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      if (skip?.(i, j)) continue;
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ゲームの範囲の外：実際の陸と海を描くが、操作はできない（少しくすませる）
  buildOuter() {
    const w = Math.round((WORLD.x1 - WORLD.x0) / OUT) + 1, h = Math.round((WORLD.z1 - WORLD.z0) / OUT) + 1;
    const pos = new Float32Array(w * h * 3), colors = new Float32Array(w * h * 3);
    const col = new THREE.Color(), gray = C(0x8a8a80);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = WORLD.x0 + i * OUT, z = WORLD.z0 + j * OUT;
      const hh = heightAt(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = hh - 0.03; pos[k * 3 + 2] = z;
      biomeColor(x, z, hh, col);
      // ゲームの範囲から離れるほど少しずつくすませる（境目を目立たせない）
      const away = Math.max(Math.abs(x) - MAP_W / 2, Math.abs(z) - MAP_H / 2, 0);
      const f = Math.min(1, away / 8);
      if (hh > 0) col.lerp(gray, 0.28 * f).multiplyScalar(1 - 0.12 * f);
      colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
    }
    // ゲームの範囲の内側（外周1マスは重ねて隙間を防ぐ）は細かいメッシュに任せる
    const inside = (i, j) => {
      const x = WORLD.x0 + i * OUT, z = WORLD.z0 + j * OUT;
      return x >= -MAP_W / 2 + OUT && x + OUT <= MAP_W / 2 - OUT && z >= -MAP_H / 2 + OUT && z + OUT <= MAP_H / 2 - OUT;
    };
    const g = this.gridGeometry(pos, w, h, inside);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.outer = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    this.scene.add(this.outer);
  }

  // 大河：地形に沿って流れる細い帯（河口へ向かって太くなる）
  buildRivers() {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3d7fb5, roughness: 0.35, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const R of RIVERS) {
      const pts = R.pts.map(([lat, lon]) => { const p = project(lat, lon); return new THREE.Vector3(p.x, 0, p.z); });
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const n = Math.max(8, Math.round(curve.getLength() / 0.25));
      const sp = curve.getSpacedPoints(n);
      const pos = [], idx = [];
      let prevLand = false;
      for (let i = 0; i < sp.length; i++) {
        const p = sp[i];
        const q = sp[Math.min(sp.length - 1, i + 1)], o = sp[Math.max(0, i - 1)];
        const dx = q.x - o.x, dz = q.z - o.z, L = Math.hypot(dx, dz) || 1;
        const half = (0.1 + 0.18 * (i / sp.length)) * R.w;
        const nx = (-dz / L) * half, nz = (dx / L) * half;
        const onLand = isLandAt(p.x, p.z);
        const y = Math.max(0.02, heightAt(p.x, p.z)) + 0.05;
        pos.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz);
        if (i > 0 && onLand && prevLand) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        prevLand = onLand;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, mat));
    }
    this.scene.add(group);
    this.rivers = group;
  }

  buildWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900, 1, 1),
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
    const W = WORLD.x1 - WORLD.x0, H = WORLD.z1 - WORLD.z0;
    for (let n = 0; n < 40000 && pts.length < 4200; n++) {
      const x = WORLD.x0 + r() * W, z = WORLD.z0 + r() * H;
      const h = heightAt(x, z);
      if (h < 0.3 || h > 2) continue;
      if (desertAt(x, z).d > 0.3) continue;
      const { lat, lon } = unproject(x, z);
      const p = provinceAt(x, z);
      const def = p ? PROVINCES.find((q) => q.id === p) : null;
      let forest;
      if (def) forest = def.terrain === 'forest' || (def.terrain === 'mountain' && r() < 0.35) || (def.terrain === 'farmland' && r() < 0.12);
      else forest = (lat > 52 && lat < 66 && r() < 0.7) || (lat > 45 && lat <= 52 && (lon < 38 || lon > 122) && r() < 0.4) || (lat < 25 && lon > 95 && r() < 0.5);
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
    const cells = this.fineProv;
    for (let k = 0; k < cells.length; k++) {
      c.setRGB(this.baseColor[k * 3], this.baseColor[k * 3 + 1], this.baseColor[k * 3 + 2]);
      const v = cells[k];
      const z = -MAP_H / 2 + Math.floor(k / IW) * FINE;
      if (this.heights[k] > 0) {
        if (season === 3) c.lerp(white, Math.max(0, Math.min(0.75, (-z + 6) / 30)));
        else if (season === 2) c.lerp(gold, 0.12);
      }
      if (v >= 0) {
        const own = ownerOf[v];
        if (own) c.lerp(nationColor[own], 0.42);
        else c.lerp(tmp.setHex(0x9a9a9a), 0.25);
        // 境界線
        // 周囲8方向のうち、他国・他の地方がどれだけあるかで濃さを変える（境界の階段を目立たせない）
        let nat = 0, prov = 0;
        for (const d of NB8) {
          const nb = cells[k + d];
          if (nb === undefined || nb === v || nb < 0) continue;
          if (ownerOf[nb] !== own) nat++; else prov++;
        }
        if (nat) c.multiplyScalar(1 - Math.min(0.7, 0.2 + nat * 0.12));
        else if (prov) c.multiplyScalar(1 - Math.min(0.32, 0.1 + prov * 0.06));
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
      const style = owner ? CULTURES[st.nations[owner].culture].style : 'nomad';
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
      const sg = st.sieges?.[p.id];
      mk.label.innerHTML = `<div class="nm"><span class="dot" style="background:${color}"></span>${p.city}</div>` +
        (owner ? `<div class="troops">兵 ${soldiers.toLocaleString()}${gens ? `・将${gens}` : ''}${prov.fleet?.ships ? ` <span class="fleet-tag">⚓${prov.fleet.ships}</span>` : ''}</div>` : '<div class="troops">空白地</div>') +
        (sg ? `<div class="siege-tag" style="border-color:${st.nations[sg.att]?.color}">⚔ ${st.nations[sg.att]?.name ?? ''}が包囲中</div>` : '') +
        (calamityTags(st, p.id).length ? `<div class="calamity-tag">${calamityTags(st, p.id).join('・')}</div>` : '');
      this.setSiegeRing(p.id, sg ? st.nations[sg.att]?.color : null);
      mk.label.className = `city-label${isCap ? ' capital' : ''}`;
    }
  }

  // 包囲している軍の天幕の輪
  setSiegeRing(pid, color) {
    this.siegeRings = this.siegeRings || {};
    const cur = this.siegeRings[pid];
    if (cur && cur.color === color) return;
    if (cur) { M.disposeGroup(cur.group); delete this.siegeRings[pid]; }
    if (!color) return;
    const { x, z } = PROV_POS[pid];
    const y = Math.max(0.05, heightAt(x, z));
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const c = new THREE.Color(color).getHex();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tent = M.cone(i % 2 ? c : 0xe8dcc0, 0.22, 0.4, Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9, 5);
      g.add(tent);
    }
    const fl = M.flag(c, 1.2);
    fl.position.set(1.9, 0, 0);
    g.add(fl);
    this.scene.add(g);
    this.siegeRings[pid] = { group: g, color };
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
