// 箱庭ビュー：都市グリッドを3Dで表示し、建設・強化を行う
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { PROVINCE_TERRAIN, CULTURES } from '../game/data.js';
import { GRID, CENTER, tileAt, canBuild } from '../game/city.js';
import { PROV_DEF, NATION_DEF } from '../game/state.js';
import { bindPointer, pickAt } from './engine.js';
import * as M from './models.js';

const S = 2; // タイルの大きさ
const TILE_COLORS = { grass: 0x86b556, sand: 0xdcc58c, hill: 0x9a9468, forest: 0x5f8f45, river: 0x3f86c0 };
const SEASON_GRASS = [0x9ccc62, 0x7fb14c, 0xb8a94e, 0xdfe4e6];

export const tilePos = (x, y) => [(x - CENTER) * S, (y - CENTER) * S];

export class CityView {
  constructor(engine) {
    this.engine = engine;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xa9cfe6);
    this.scene.fog = new THREE.Fog(0xa9cfe6, 45, 110);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 300);
    this.camera.position.set(0, 22, 24);
    this.labels = engine.makeLabelRenderer();
    this.controls = new OrbitControls(this.camera, engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = 1.3;
    this.controls.target.set(0, 0, 0);
    this.controls.enabled = false;
    this.state = null;
    this.pid = null;
    this.tool = null; // 選択中の建物タイプ / 'clear' / null
    this.onTileClick = null;
    this.onTileHover = null;
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.animated = [];
    this.people = [];
    this.smokes = [];
    this.setupLights();
    this.hoverBox = new THREE.Mesh(new THREE.BoxGeometry(S * 0.98, 0.1, S * 0.98), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.45, depthWrite: false }));
    this.hoverBox.visible = false;
    this.scene.add(this.hoverBox);
    this.selBox = new THREE.Mesh(new THREE.BoxGeometry(S * 1.02, 0.14, S * 1.02), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
    this.selBox.visible = false;
    this.scene.add(this.selBox);
    bindPointer(engine.renderer.domElement, {
      onClick: (e) => { if (engine.view === this) this.handleClick(e); },
      onMove: (e) => { if (engine.view === this) this.handleMove(e); },
      onRight: () => { if (engine.view === this) this.onRightClick?.(); },
    });
  }

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x6a5a3a, 1.2));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
    sun.position.set(-14, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  open(st, pid) {
    this.state = st;
    this.pid = pid;
    this.selected = null;
    this.selBox.visible = false;
    this.rebuild(true);
  }

  // 状態からシーンを作り直す
  rebuild(full = false) {
    const st = this.state, p = st.provinces[this.pid], def = PROV_DEF[this.pid];
    const owner = p.owner;
    this.style = owner ? CULTURES[st.nations[owner].culture].style : 'nomad';
    this.color = owner ? new THREE.Color(st.nations[owner].color).getHex() : 0x999999;
    const season = st.season;
    if (full || this.builtFor !== `${this.pid}|${season}|${owner}`) {
      M.disposeGroup(this.world);
      this.world = new THREE.Group();
      this.scene.add(this.world);
      this.buildGround(def, season);
      this.tiles = new THREE.Group();
      this.world.add(this.tiles);
      this.buildTiles(p.city, season);
      this.builtFor = `${this.pid}|${season}|${owner}`;
      this.bGroup = null;
      this.wallGroup = null;
    }
    this.buildBuildings(p.city, season);
    this.buildWalls(p.city);
    this.buildPeople(p.city);
  }

  buildGround(def, season) {
    const T = PROVINCE_TERRAIN[def.terrain];
    const base = new THREE.Color(T.color);
    if (season === 3) base.lerp(new THREE.Color(0xeef0f2), 0.7);
    if (season === 2) base.lerp(new THREE.Color(0xc9a64a), 0.25);
    const g = new THREE.PlaneGeometry(140, 140, 70, 70);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const d = Math.max(Math.abs(x), Math.abs(z));
      let h = 0;
      if (d > 13) {
        const n = Math.sin(x * 0.21) * Math.cos(z * 0.17) + Math.sin(x * 0.07 + z * 0.05) * 1.5;
        h = (d - 13) * 0.08 * T.height * (1.2 + n);
        h = Math.max(0, h);
      }
      pos.setY(i, h - 0.12);
      c.copy(base).offsetHSL(0, 0, (Math.sin(x * 1.3) * Math.cos(z * 1.1)) * 0.03 - h * 0.01);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    ground.receiveShadow = true;
    this.world.add(ground);
    // 周囲の景観
    let seed = def.id.charCodeAt(0) * 31 + def.id.length;
    const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const nTrees = def.terrain === 'forest' ? 160 : def.terrain === 'desert' ? 8 : def.terrain === 'steppe' ? 20 : 70;
    for (let i = 0; i < nTrees; i++) {
      const a = r() * Math.PI * 2, d = 15 + r() * 30;
      const t = M.tree(1.5 + r() * 1.5, r() < 0.6 ? 'pine' : 'round');
      t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      this.world.add(t);
    }
    if (def.terrain === 'steppe' || def.terrain === 'desert') {
      for (let i = 0; i < 6; i++) {
        const a = r() * Math.PI * 2, d = 16 + r() * 14;
        const gg = M.ger(1.2, M.PALETTE.cloth[i % 5]);
        gg.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
        this.world.add(gg);
      }
    }
  }

  buildTiles(city, season) {
    this.tileMeshes = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const t = tileAt(city, x, y);
      const [px, pz] = tilePos(x, y);
      let color = TILE_COLORS[t.t];
      if (t.t === 'grass') color = SEASON_GRASS[season];
      const h = t.t === 'river' ? 0.05 : 0.2;
      const m = M.box(color, S * 0.98, h, S * 0.98, px, 0, pz);
      m.userData.tile = [x, y];
      this.tiles.add(m);
      this.tileMeshes.push(m);
      if (t.t === 'river') {
        const w = M.box(0x4f9ad6, S, 0.12, S, px, 0, pz, { transparent: true, opacity: 0.85 });
        w.userData.tile = [x, y];
        w.userData.water = true;
        this.tiles.add(w);
        this.tileMeshes.push(w);
      }
      if (t.t === 'hill' && !t.b) {
        const hill = M.hemi(0x8f8a5e, S * 0.45, 0.5, px, 0.2, pz);
        hill.userData.tile = [x, y];
        this.tiles.add(hill);
        this.tileMeshes.push(hill);
      }
    }
  }

  buildBuildings(city, season) {
    if (this.bGroup) M.disposeGroup(this.bGroup);
    this.bGroup = new THREE.Group();
    this.world.add(this.bGroup);
    this.animated = [];
    this.smokes = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const t = tileAt(city, x, y);
      const [px, pz] = tilePos(x, y);
      if (t.t === 'forest' && !t.b) {
        for (const [dx, dz, s] of [[-0.4, -0.4, 1.1], [0.45, -0.2, 0.9], [-0.1, 0.45, 1.0], [0.5, 0.55, 0.8]]) {
          const tr = M.tree(s * 1.4, 'pine');
          tr.position.set(px + dx, 0.2, pz + dz);
          this.bGroup.add(tr);
        }
      }
      if (t.t === 'hill' && t.b) {
        const hill = M.hemi(0x8f8a5e, S * 0.45, 0.25, px, 0.2, pz);
        this.bGroup.add(hill);
      }
      if (!t.b) continue;
      const b = t.b;
      let model;
      if (b.progress < 1 && b.level === 1) {
        model = M.scaffold(b.progress);
      } else {
        model = M.buildingModel(b.type, this.style, this.color, season, x * 7 + y * 3);
        if (b.type !== 'palace' && b.type !== 'farm' && b.type !== 'pasture') model.scale.setScalar(1.25 + (b.level - 1) * 0.15);
        else if (b.type === 'palace') model.scale.setScalar(1.35);
        else model.scale.set(1.05, 1, 1.05);
        if (b.level >= 2 && b.type !== 'palace') this.addLevelMarks(model, b.level);
        if (b.progress < 1) model.add(M.scaffold(b.progress));
      }
      model.position.set(px, t.t === 'hill' ? 0.35 : 0.2, pz);
      model.userData.tile = [x, y];
      model.traverse((o) => { o.userData.tile = [x, y]; });
      this.bGroup.add(model);
      if (model.userData.animals) this.animated.push(...model.userData.animals.map((a) => ({ obj: a, home: a.position.clone(), phase: Math.random() * 10 })));
      if (model.userData.smoke) this.addSmoke(model, model.userData.smoke);
      model.traverse((o) => { if (o.userData.flag) this.animated.push({ flag: o, phase: Math.random() * 10 }); });
    }
    this.buildAdminProps(city);
  }

  // 内政の成果を箱庭に表す：治水の堤、商業の露店
  buildAdminProps(city) {
    const irr = city.irrigation ?? 0, com = city.commerce ?? 0;
    if (irr >= 30) {
      const stone = irr >= 70 ? 0xa8a49a : 0x8a7a5a;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        if (tileAt(city, x, y).t !== 'river') continue;
        const [px, pz] = tilePos(x, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = tileAt(city, x + dx, y + dy);
          if (!n || n.t === 'river') continue;
          const bank = dx ? M.box(stone, 0.18, 0.28, S * 0.96, px + dx * S * 0.46, 0, pz) : M.box(stone, S * 0.96, 0.28, 0.18, px, 0, pz + dy * S * 0.46);
          this.bGroup.add(bank);
        }
      }
    }
    const stalls = Math.floor(com / 20);
    if (stalls) {
      const cols = [0xc0392b, 0xd4a94a, 0x2e7d9a, 0x8e44ad, 0x3f8f4b];
      const free = [];
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        const t = tileAt(city, x, y);
        if (!t.b && (t.t === 'grass' || t.t === 'sand')) free.push([x, y, Math.abs(x - 4) + Math.abs(y - 4)]);
      }
      free.sort((a, b) => a[2] - b[2] || a[0] * 9 + a[1] - (b[0] * 9 + b[1]));
      for (let i = 0; i < Math.min(stalls, free.length); i++) {
        const [x, y] = free[i];
        const [px, pz] = tilePos(x, y);
        for (let k = 0; k < 2; k++) {
          const ox = px + (k ? 0.5 : -0.5), oz = pz + (k ? 0.35 : -0.35);
          this.bGroup.add(M.box(0x7a5a3a, 0.7, 0.35, 0.45, ox, 0.2, oz));
          this.bGroup.add(M.cone(cols[(x + y + k) % cols.length], 0.55, 0.35, ox, 0.75, oz, 4));
        }
      }
    }
  }

  addLevelMarks(model, level) {
    for (let i = 0; i < level; i++) {
      const s = M.sphere(0xf1c40f, 0.06, -0.75 + i * 0.16, 0.05, 0.8, 6, { emissive: 0x6b4a00 });
      model.add(s);
    }
  }

  addSmoke(model, [sx, sy, sz]) {
    for (let i = 0; i < 4; i++) {
      const puff = M.sphere(0xdddddd, 0.12, sx, sy, sz, 6, { transparent: true, opacity: 0.5 });
      puff.castShadow = false;
      model.add(puff);
      this.smokes.push({ obj: puff, base: [sx, sy, sz], phase: i / 4 });
    }
  }

  buildWalls(city) {
    if (this.wallGroup) M.disposeGroup(this.wallGroup);
    this.wallGroup = new THREE.Group();
    this.world.add(this.wallGroup);
    const lv = city.walls;
    const R = (GRID / 2) * S + 0.6;
    if (lv <= 0) return;
    const colors = [0, 0x7a5a35, 0x9a7a55, 0xb8b0a0];
    const height = [0, 0.7, 0.9, 1.4][lv];
    const segLen = 1.0;
    for (const side of [0, 1, 2, 3]) {
      for (let t = -R; t < R; t += segLen) {
        const mid = t + segLen / 2;
        // 門（各辺中央）
        if (Math.abs(mid) < 1.0) continue;
        let x, z, rot;
        if (side === 0) { x = mid; z = -R; rot = 0; }
        if (side === 1) { x = mid; z = R; rot = 0; }
        if (side === 2) { x = -R; z = mid; rot = Math.PI / 2; }
        if (side === 3) { x = R; z = mid; rot = Math.PI / 2; }
        let seg;
        if (lv === 1) {
          seg = new THREE.Group();
          for (let k = 0; k < 4; k++) seg.add(M.cyl(colors[1], 0.08, height + (k % 2) * 0.1, -0.375 + k * 0.25, 0, 0, 5));
        } else {
          seg = M.box(colors[lv], segLen, height, lv === 3 ? 0.4 : 0.6, 0, 0, 0);
          if (lv === 3) {
            const cren = M.box(colors[3], 0.35, 0.25, 0.42, 0, 0, 0);
            cren.position.set(x, 0.1 + height + 0.125, z);
            cren.rotation.y = rot;
            this.wallGroup.add(cren);
          }
        }
        seg.position.set(x, 0.1, z);
        seg.rotation.y = rot;
        this.wallGroup.add(seg);
      }
    }
    if (lv >= 2) {
      for (const [x, z] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
        this.wallGroup.add(M.cyl(colors[lv], 0.55, height + 0.6, x, 0.1, z, 8));
        if (lv === 3) this.wallGroup.add(M.cone(M.PALETTE.roofRed, 0.65, 0.6, x, height + 0.7, z, 8));
      }
      for (const [x, z] of [[0, -R], [0, R], [-R, 0], [R, 0]]) {
        this.wallGroup.add(M.box(colors[lv], 0.5, height + 0.4, 0.5, x + (x ? 0 : -1.2), 0.1, z + (z ? 0 : -1.2)));
        this.wallGroup.add(M.box(colors[lv], 0.5, height + 0.4, 0.5, x + (x ? 0 : 1.2), 0.1, z + (z ? 0 : 1.2)));
      }
    }
  }

  buildPeople(city) {
    for (const p of this.people) M.disposeGroup(p.obj);
    this.people = [];
    const n = Math.min(40, Math.round(city.pop / 900));
    const cells = [];
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const t = tileAt(city, x, y);
      if (t.t !== 'river') cells.push([x, y]);
    }
    const clothes = [0x8b5a2b, 0x6b3a7a, 0x2e5e8a, 0x9a3a2a, 0x5a7a3a, 0xc9a44f];
    for (let i = 0; i < n; i++) {
      const obj = M.person(clothes[i % clothes.length]);
      obj.scale.setScalar(1.4);
      const [x, y] = cells[Math.floor(Math.random() * cells.length)];
      const [px, pz] = tilePos(x, y);
      obj.position.set(px + (Math.random() - 0.5) * 1.6, 0.2, pz + (Math.random() - 0.5) * 1.6);
      this.world.add(obj);
      this.people.push({ obj, target: obj.position.clone(), speed: 0.6 + Math.random() * 0.5, cells, wait: Math.random() * 3 });
    }
  }

  // ---- 入力 ----
  tileFromEvent(e) {
    const hits = pickAt(e, this.camera, this.engine.renderer.domElement, [this.tiles, this.bGroup], true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.tile) o = o.parent;
      if (o?.userData.tile) return o.userData.tile;
    }
    return null;
  }

  handleMove(e) {
    const t = this.tileFromEvent(e);
    if (!t) { this.hoverBox.visible = false; this.onTileHover?.(null, e); return; }
    const [px, pz] = tilePos(...t);
    this.hoverBox.position.set(px, 0.3, pz);
    this.hoverBox.visible = true;
    let ok = true;
    if (this.tool && this.tool !== 'clear') ok = canBuild(this.state, this.pid, t[0], t[1], this.tool).ok;
    else if (this.tool === 'clear') ok = tileAt(this.state.provinces[this.pid].city, ...t).t === 'forest';
    this.hoverBox.material.color.setHex(this.tool ? (ok ? 0x7cff7c : 0xff6060) : 0xffe08a);
    this.onTileHover?.(t, e);
  }

  handleClick(e) {
    const t = this.tileFromEvent(e);
    if (!t) return;
    this.select(t);
    this.onTileClick?.(t, e);
  }

  select(t) {
    this.selected = t;
    if (t) {
      const [px, pz] = tilePos(...t);
      this.selBox.position.set(px, 0.3, pz);
      this.selBox.visible = true;
    } else this.selBox.visible = false;
  }

  floatText(t, text, cls = 'gold') {
    const el = document.createElement('div');
    el.className = `float-num ${cls}`;
    el.textContent = text;
    const o = new CSS2DObject(el);
    const [px, pz] = tilePos(...t);
    o.position.set(px, 1.5, pz);
    this.scene.add(o);
    const start = performance.now();
    const step = () => {
      const k = (performance.now() - start) / 1400;
      o.position.y = 1.5 + k * 2;
      el.style.opacity = String(1 - k);
      if (k < 1) requestAnimationFrame(step);
      else { el.remove(); this.scene.remove(o); }
    };
    step();
  }

  enter() { this.controls.enabled = true; }
  exit() { this.controls.enabled = false; this.hoverBox.visible = false; }

  update(dt, time) {
    this.controls.update();
    for (const a of this.animated) {
      if (a.flag) { a.flag.rotation.y = Math.sin(time * 3 + a.phase) * 0.3; continue; }
      const ph = time * 0.4 + a.phase;
      a.obj.position.x = a.home.x + Math.sin(ph) * 0.2;
      a.obj.position.z = a.home.z + Math.cos(ph * 0.7) * 0.2;
      a.obj.rotation.y = ph;
    }
    for (const s of this.smokes) {
      const k = (time * 0.35 + s.phase) % 1;
      s.obj.position.set(s.base[0] + k * 0.3, s.base[1] + k * 1.2, s.base[2]);
      s.obj.scale.setScalar(0.24 + k * 0.5);
      s.obj.material.opacity = 0.5 * (1 - k);
    }
    for (const p of this.people) {
      if (p.wait > 0) { p.wait -= dt; continue; }
      const d = p.target.clone().sub(p.obj.position);
      d.y = 0;
      const len = d.length();
      if (len < 0.05) {
        const [x, y] = p.cells[Math.floor(Math.random() * p.cells.length)];
        const [px, pz] = tilePos(x, y);
        // 近場を歩き回る
        const cur = p.obj.position;
        p.target.set(cur.x + Math.max(-3, Math.min(3, px - cur.x)) + (Math.random() - 0.5), 0.2, cur.z + Math.max(-3, Math.min(3, pz - cur.z)) + (Math.random() - 0.5));
        p.target.x = Math.max(-8.5, Math.min(8.5, p.target.x));
        p.target.z = Math.max(-8.5, Math.min(8.5, p.target.z));
        p.wait = Math.random() * 2;
        continue;
      }
      d.normalize();
      p.obj.position.addScaledVector(d, Math.min(len, p.speed * dt));
      p.obj.rotation.y = Math.atan2(d.x, d.z);
      p.obj.position.y = 0.2 + Math.abs(Math.sin(time * 10 + p.speed * 10)) * 0.04;
    }
  }
}
