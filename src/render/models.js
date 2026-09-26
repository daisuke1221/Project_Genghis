// プリミティブで組み立てるローポリモデル（外部素材は使わない）
import * as THREE from 'three';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.transparent ? opts.opacity : ''}|${opts.side ?? ''}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.0, flatShading: true,
      emissive: opts.emissive ?? 0x000000, transparent: !!opts.transparent, opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    }));
  }
  return matCache.get(key);
}

const geoCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const G = {
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (seg = 8) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg)),
  cone: (seg = 8) => geo(`cone${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg)),
  sphere: (seg = 8) => geo(`sph${seg}`, () => new THREE.SphereGeometry(0.5, seg, Math.max(4, seg * 0.75))),
  hemi: () => geo('hemi', () => new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
  capsule: () => geo('capsule', () => new THREE.CapsuleGeometry(0.5, 1, 3, 6)),
};

function mesh(g, color, sx, sy, sz, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(g, mat(color, opts));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
export const box = (c, sx, sy, sz, x, y, z, o) => mesh(G.box(), c, sx, sy, sz, x, y + sy / 2, z, o);
export const cyl = (c, r, h, x, y, z, seg = 8, o) => mesh(G.cyl(seg), c, r * 2, h, r * 2, x, y + h / 2, z, o);
export const cone = (c, r, h, x, y, z, seg = 8, o) => mesh(G.cone(seg), c, r * 2, h, r * 2, x, y + h / 2, z, o);
export const sphere = (c, r, x, y, z, seg = 8, o) => mesh(G.sphere(seg), c, r * 2, r * 2, r * 2, x, y, z, o);
export const hemi = (c, r, h, x, y, z, o) => mesh(G.hemi(), c, r * 2, h * 2, r * 2, x, y, z, o);

// 切妻屋根
function gable(color, w, h, d, x, y, z) {
  const g = geo('gable', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.lineTo(-0.5, 0);
    const e = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    e.translate(0, 0, -0.5);
    return e;
  });
  return mesh(g, color, w, h, d, x, y, z);
}
// 反り屋根（東アジア風）：四角錐を平たく
function hipRoof(color, w, h, d, x, y, z) {
  const m = mesh(G.cone(4), color, w * 1.42, h, d * 1.42, x, y + h / 2, z);
  m.rotation.y = Math.PI / 4;
  return m;
}

export const PALETTE = {
  felt: 0xf1ead8, feltRoof: 0xe4dac0, wood: 0x8a5a33, woodDark: 0x5e3b20, stone: 0xb9b1a0, stoneDark: 0x8d8576,
  plaster: 0xe9dcc0, roofRed: 0xa2402e, roofGrey: 0x5b6470, roofGreen: 0x3f6b5a, gold: 0xe0b440, dome: 0x3f86b8,
  mud: 0xc9a879, thatch: 0xc9a44f, cloth: [0xc0392b, 0x2e86c1, 0xd4ac0d, 0x7d3c98, 0x16a085],
};

// ---- 遊牧（ゲル） ----
export function ger(scale = 1, trim = 0xb03a2e) {
  const g = new THREE.Group();
  g.add(cyl(PALETTE.felt, 0.45, 0.32, 0, 0, 0, 12));
  g.add(cone(PALETTE.feltRoof, 0.5, 0.28, 0, 0.32, 0, 12));
  g.add(cyl(trim, 0.46, 0.05, 0, 0.22, 0, 12));
  g.add(box(0xd35400, 0.14, 0.2, 0.04, 0, 0, 0.45));
  g.scale.setScalar(scale);
  return g;
}

// ---- 建物（様式別） ----
export function palace(style, color) {
  const g = new THREE.Group();
  if (style === 'nomad') {
    const big = ger(2.1, 0xc9a227);
    g.add(big);
    g.add(cone(PALETTE.gold, 0.1, 0.35, 0, 1.25, 0));
    for (const [x, z] of [[-0.75, 0.55], [0.75, 0.55]]) g.add(ger(0.9, 0x2e86c1).translateX(x).translateZ(z));
    g.add(flag(color, 1.8).translateX(-0.6).translateZ(-0.6));
  } else if (style === 'east') {
    g.add(box(PALETTE.stone, 1.7, 0.2, 1.4, 0, 0, 0));
    g.add(box(0xa33b2a, 1.3, 0.55, 1.0, 0, 0.2, 0));
    g.add(hipRoof(PALETTE.roofGrey, 1.7, 0.35, 1.35, 0, 0.75, 0));
    g.add(box(0xa33b2a, 0.8, 0.35, 0.6, 0, 1.0, 0));
    g.add(hipRoof(PALETTE.roofGrey, 1.1, 0.35, 0.85, 0, 1.33, 0));
    g.add(cone(PALETTE.gold, 0.05, 0.15, 0, 1.68, 0));
    g.add(flag(color, 1.6).translateX(0.8).translateZ(0.6));
  } else if (style === 'islamic') {
    g.add(box(PALETTE.mud, 1.6, 0.7, 1.4, 0, 0, 0));
    g.add(hemi(PALETTE.dome, 0.5, 0.45, 0, 0.7, 0));
    g.add(cone(PALETTE.gold, 0.05, 0.25, 0, 1.13, 0));
    for (const [x, z] of [[-0.7, -0.6], [0.7, -0.6], [-0.7, 0.6], [0.7, 0.6]]) {
      g.add(cyl(PALETTE.plaster, 0.09, 1.25, x, 0, z));
      g.add(cone(PALETTE.dome, 0.11, 0.25, x, 1.25, z));
    }
    g.add(flag(color, 1.7).translateX(0).translateZ(0.8));
  } else {
    g.add(box(PALETTE.stone, 1.2, 0.95, 1.2, 0, 0, 0));
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      g.add(cyl(PALETTE.stoneDark, 0.22, 1.35, x, 0, z));
      g.add(cone(PALETTE.roofRed, 0.27, 0.4, x, 1.35, z));
    }
    g.add(box(PALETTE.stoneDark, 0.5, 0.6, 0.5, 0, 0.95, 0));
    g.add(flag(color, 2.1));
  }
  return g;
}

export function house(style, variant = 0) {
  const g = new THREE.Group();
  if (style === 'nomad') {
    g.add(ger(0.75, PALETTE.cloth[variant % 5]).translateX(-0.3).translateZ(-0.2));
    g.add(ger(0.6, PALETTE.cloth[(variant + 2) % 5]).translateX(0.35).translateZ(0.3));
  } else if (style === 'east') {
    g.add(box(PALETTE.plaster, 0.9, 0.4, 0.7, 0, 0, 0));
    g.add(hipRoof(variant % 2 ? PALETTE.roofGrey : PALETTE.thatch, 1.15, 0.35, 0.9, 0, 0.4, 0));
  } else if (style === 'islamic') {
    g.add(box(PALETTE.mud, 0.8, 0.45, 0.8, -0.15, 0, 0));
    g.add(box(0xd8bb8a, 0.55, 0.65, 0.5, 0.3, 0, 0.25));
    g.add(box(0x5a3b20, 0.12, 0.2, 0.02, -0.15, 0, 0.41));
  } else {
    g.add(box(PALETTE.plaster, 0.8, 0.45, 0.65, 0, 0, 0));
    g.add(gable(variant % 2 ? PALETTE.roofRed : 0x6d4c33, 0.95, 0.45, 0.75, 0, 0.45, 0));
    g.add(box(PALETTE.woodDark, 0.1, 0.3, 0.1, 0.25, 0.6, -0.1));
  }
  return g;
}

export function temple(style) {
  const g = new THREE.Group();
  if (style === 'islamic') {
    g.add(box(PALETTE.plaster, 1.0, 0.6, 1.0, 0, 0, 0));
    g.add(hemi(0x2f9e8a, 0.4, 0.4, 0, 0.6, 0));
    g.add(cyl(PALETTE.plaster, 0.08, 1.3, 0.55, 0, 0.55));
    g.add(cone(0x2f9e8a, 0.1, 0.25, 0.55, 1.3, 0.55));
  } else if (style === 'europe') {
    g.add(box(PALETTE.stone, 0.7, 0.6, 1.1, 0, 0, 0.1));
    g.add(gable(PALETTE.roofGrey, 0.85, 0.4, 1.2, 0, 0.6, 0.1));
    g.add(box(PALETTE.stone, 0.4, 1.1, 0.4, 0, 0, -0.55));
    g.add(cone(PALETTE.roofGrey, 0.3, 0.6, 0, 1.1, -0.55, 4));
  } else {
    // 仏塔・ストゥーパ
    g.add(cyl(PALETTE.plaster, 0.55, 0.2, 0, 0, 0, 10));
    g.add(sphere(PALETTE.plaster, 0.42, 0, 0.45, 0, 10));
    g.add(box(PALETTE.gold, 0.22, 0.18, 0.22, 0, 0.8, 0));
    g.add(cone(PALETTE.gold, 0.12, 0.6, 0, 0.98, 0, 8));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.add(box(PALETTE.cloth[i], 0.05, 0.4, 0.05, Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75));
    }
  }
  return g;
}

export function farm(season = 1) {
  const g = new THREE.Group();
  const soil = 0x6e4a2c;
  const crop = [0x9ad16a, 0x5aa83a, 0xe0c050, 0xc9b8a0][season];
  g.add(box(soil, 1.8, 0.06, 1.8, 0, 0, 0));
  for (let i = 0; i < 5; i++) {
    g.add(box(crop, 1.6, season === 3 ? 0.03 : 0.16, 0.2, 0, 0.06, -0.72 + i * 0.36));
  }
  g.add(box(PALETTE.woodDark, 0.05, 0.5, 0.05, 0.75, 0, 0.8));
  g.add(box(PALETTE.thatch, 0.3, 0.05, 0.05, 0.75, 0.38, 0.8));
  return g;
}

export function pasture() {
  const g = new THREE.Group();
  const posts = [];
  for (let i = 0; i < 5; i++) {
    const t = -0.85 + i * 0.425;
    posts.push([t, -0.85], [t, 0.85], [-0.85, t], [0.85, t]);
  }
  for (const [x, z] of posts) g.add(box(PALETTE.wood, 0.06, 0.3, 0.06, x, 0, z));
  for (const z of [-0.85, 0.85]) g.add(box(PALETTE.wood, 1.75, 0.04, 0.04, 0, 0.22, z));
  for (const x of [-0.85, 0.85]) g.add(box(PALETTE.wood, 0.04, 0.04, 1.75, x, 0.22, 0));
  g.userData.animals = [];
  for (let i = 0; i < 4; i++) {
    const horse = i % 2 === 0;
    const a = animal(horse ? 0x7a4a2a : 0xf4f1e8, horse);
    a.position.set((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
    a.rotation.y = Math.random() * Math.PI * 2;
    g.add(a);
    g.userData.animals.push(a);
  }
  return g;
}

export function animal(color, horse = false) {
  const g = new THREE.Group();
  if (horse) {
    g.add(box(color, 0.14, 0.12, 0.34, 0, 0.14, 0));
    g.add(box(color, 0.08, 0.16, 0.08, 0, 0.24, 0.18));
    for (const [x, z] of [[-0.05, -0.12], [0.05, -0.12], [-0.05, 0.12], [0.05, 0.12]]) g.add(box(0x3a2a1a, 0.03, 0.14, 0.03, x, 0, z));
  } else {
    g.add(box(color, 0.16, 0.12, 0.24, 0, 0.08, 0));
    g.add(box(0x333333, 0.07, 0.07, 0.07, 0, 0.14, 0.14));
  }
  return g;
}

export function market() {
  const g = new THREE.Group();
  const spots = [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]];
  spots.forEach(([x, z], i) => {
    for (const [dx, dz] of [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]]) g.add(box(PALETTE.woodDark, 0.04, 0.45, 0.04, x + dx, 0, z + dz));
    g.add(box(PALETTE.wood, 0.5, 0.15, 0.35, x, 0, z));
    const aw = box(PALETTE.cloth[i], 0.6, 0.04, 0.5, x, 0.45, z);
    aw.rotation.x = 0.15;
    g.add(aw);
    g.add(box(PALETTE.cloth[(i + 2) % 5], 0.15, 0.1, 0.12, x - 0.1, 0.15, z));
    g.add(sphere(0xe67e22, 0.05, x + 0.12, 0.2, z, 6));
  });
  return g;
}

export function workshop(style) {
  const g = new THREE.Group();
  g.add(box(style === 'islamic' ? PALETTE.mud : 0x9a7b5a, 1.2, 0.55, 0.9, 0, 0, 0));
  if (style === 'europe') g.add(gable(PALETTE.roofRed, 1.35, 0.35, 1.0, 0, 0.55, 0));
  else if (style === 'east') g.add(hipRoof(PALETTE.roofGrey, 1.35, 0.3, 1.05, 0, 0.55, 0));
  else g.add(box(0x7b5e3c, 1.3, 0.08, 1.0, 0, 0.55, 0));
  g.add(cyl(0x4a4a4a, 0.1, 0.8, 0.4, 0.5, -0.2));
  g.add(box(0x444444, 0.3, 0.2, 0.2, -0.75, 0, 0.3));
  g.add(cyl(0x777777, 0.12, 0.08, -0.75, 0.2, 0.3));
  g.userData.smoke = [0.4, 1.35, -0.2];
  return g;
}

export function barracks(style, color) {
  const g = new THREE.Group();
  if (style === 'nomad') {
    g.add(ger(1.2, 0x7b241c).translateX(-0.35));
    g.add(ger(1.0, 0x7b241c).translateX(0.45).translateZ(0.3));
  } else {
    g.add(box(style === 'islamic' ? PALETTE.mud : PALETTE.wood, 1.5, 0.45, 0.7, 0, 0, -0.35));
    if (style === 'east') g.add(hipRoof(PALETTE.roofGrey, 1.6, 0.3, 0.8, 0, 0.45, -0.35));
    else g.add(gable(style === 'islamic' ? 0x9b7b4a : PALETTE.roofRed, 1.6, 0.35, 0.8, 0, 0.45, -0.35));
  }
  // 訓練用のかかし
  for (let i = 0; i < 3; i++) {
    g.add(box(PALETTE.wood, 0.05, 0.35, 0.05, -0.5 + i * 0.5, 0, 0.55));
    g.add(box(PALETTE.thatch, 0.25, 0.05, 0.05, -0.5 + i * 0.5, 0.25, 0.55));
  }
  g.add(flag(color, 1.3).translateX(0.8).translateZ(0.7));
  return g;
}

export function mine() {
  const g = new THREE.Group();
  g.add(box(0x6d6256, 1.1, 0.5, 0.8, 0, 0, -0.3));
  g.add(box(0x1a1510, 0.4, 0.35, 0.05, 0, 0, 0.11));
  g.add(box(PALETTE.woodDark, 0.5, 0.06, 0.08, 0, 0.35, 0.13));
  for (const x of [-0.22, 0.22]) g.add(box(PALETTE.woodDark, 0.06, 0.38, 0.08, x, 0, 0.13));
  g.add(box(0x5a4a3a, 0.3, 0.15, 0.2, 0.5, 0.05, 0.5));
  for (let i = 0; i < 4; i++) g.add(sphere(0x9a8d7a, 0.1, -0.5 + i * 0.12, 0.08, 0.55, 5));
  g.add(sphere(PALETTE.gold, 0.06, 0.5, 0.22, 0.5, 5));
  return g;
}

export function lumber() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const log = cyl(0x8b5a2b, 0.08, 0.9, 0, 0, 0, 6);
    log.rotation.z = Math.PI / 2;
    log.position.set(-0.3, 0.08 + i * 0.14, -0.3 + (i % 2) * 0.08);
    g.add(log);
  }
  g.add(cyl(0x6e4a2c, 0.15, 0.15, 0.4, 0, 0.3));
  g.add(tree(0.8).translateX(0.5).translateZ(-0.5));
  g.add(tree(0.7).translateX(-0.6).translateZ(0.5));
  return g;
}

export function caravan(style) {
  const g = new THREE.Group();
  const wc = style === 'europe' ? PALETTE.stone : PALETTE.mud;
  g.add(box(wc, 1.7, 0.4, 0.15, 0, 0, -0.78));
  g.add(box(wc, 0.15, 0.4, 1.6, -0.78, 0, 0));
  g.add(box(wc, 0.15, 0.4, 1.6, 0.78, 0, 0));
  g.add(box(wc, 0.55, 0.4, 0.15, -0.55, 0, 0.78));
  g.add(box(wc, 0.55, 0.4, 0.15, 0.55, 0, 0.78));
  g.add(box(wc, 0.4, 0.7, 0.2, 0, 0, -0.78));
  g.add(camel().translateX(0.1).translateZ(0.1));
  g.add(camel().translateX(-0.3).translateZ(-0.25).rotateY(1.2));
  g.add(box(PALETTE.cloth[2], 0.2, 0.15, 0.2, 0.4, 0, -0.4));
  return g;
}

export function camel() {
  const g = new THREE.Group();
  const c = 0xc49a5c;
  g.add(box(c, 0.14, 0.14, 0.36, 0, 0.2, 0));
  g.add(sphere(c, 0.09, 0, 0.36, 0, 6));
  g.add(box(c, 0.06, 0.22, 0.06, 0, 0.3, 0.2));
  g.add(box(c, 0.07, 0.07, 0.12, 0, 0.5, 0.24));
  for (const [x, z] of [[-0.05, -0.12], [0.05, -0.12], [-0.05, 0.12], [0.05, 0.12]]) g.add(box(0x8d6a3a, 0.03, 0.2, 0.03, x, 0, z));
  return g;
}

export function tree(scale = 1, kind = 'pine') {
  const g = new THREE.Group();
  g.add(cyl(0x5a3b22, 0.06, 0.25, 0, 0, 0, 5));
  if (kind === 'pine') {
    g.add(cone(0x2f5f2a, 0.3, 0.45, 0, 0.2, 0, 6));
    g.add(cone(0x3a7034, 0.22, 0.35, 0, 0.45, 0, 6));
  } else {
    g.add(sphere(0x4d8a3a, 0.28, 0, 0.45, 0, 6));
  }
  g.scale.setScalar(scale);
  return g;
}

export function flag(color, h = 1.2) {
  const g = new THREE.Group();
  g.add(cyl(0x3a2a1a, 0.025, h, 0, 0, 0, 5));
  const f = box(color, 0.02, 0.28, 0.42, 0, h - 0.3, 0.21);
  f.userData.flag = true;
  g.add(f);
  return g;
}

export function scaffold(progress) {
  const g = new THREE.Group();
  const h = 0.3 + progress * 0.6;
  for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) g.add(box(0xb08850, 0.05, h, 0.05, x, 0, z));
  for (const y of [h * 0.5, h]) {
    g.add(box(0xb08850, 1.25, 0.04, 0.04, 0, y, -0.6));
    g.add(box(0xb08850, 1.25, 0.04, 0.04, 0, y, 0.6));
  }
  g.add(box(0xa08a6a, 0.8, 0.15 + progress * 0.3, 0.8, 0, 0, 0));
  return g;
}

// ---- 人物・兵士 ----
export function person(color = 0x8b5a2b) {
  const g = new THREE.Group();
  g.add(mesh(G.capsule(), color, 0.09, 0.1, 0.09, 0, 0.14, 0));
  g.add(sphere(0xe0b890, 0.05, 0, 0.29, 0, 6));
  return g;
}

// 固有兵種は基本の兵種の姿に装飾を加える
const SPECIAL_BASE = { keshig: 'cav', knight: 'cav', mamluk: 'harch', samurai: 'harch', crossbow: 'arch' };
export function soldier(type, color) {
  if (type === 'elephant') return elephant(color);
  if (SPECIAL_BASE[type]) {
    const g = soldier(SPECIAL_BASE[type], color);
    const top = 0.28 + 0.36;
    if (type === 'knight') {
      g.add(box(0xb0b4bc, 0.2, 0.12, 0.46, 0, 0.14, 0));       // 馬鎧
      g.add(box(0xc8ccd4, 0.13, 0.12, 0.13, 0, top - 0.02, 0)); // 兜
      g.add(box(color, 0.04, 0.12, 0.02, 0, top + 0.1, 0));    // 羽飾り
    } else if (type === 'keshig') {
      g.add(box(0x8a1c1c, 0.18, 0.1, 0.14, 0, 0.3, 0));         // 札甲
      const pole = box(0x5a3a1a, 0.015, 0.7, 0.015, -0.1, 0.3, -0.05);
      g.add(pole);
      g.add(box(0xf0f0f0, 0.02, 0.18, 0.12, -0.1, 0.82, 0.02)); // 白い纛（トゥグ）
    } else if (type === 'mamluk') {
      g.add(sphere(0xf2efe6, 0.075, 0, top - 0.01, 0, 6));      // ターバン
      g.add(box(0x9aa0a8, 0.18, 0.08, 0.14, 0, 0.36, 0));
    } else if (type === 'samurai') {
      g.add(box(0xa0281e, 0.19, 0.14, 0.15, 0, 0.3, 0));        // 赤備えの大鎧
      g.add(box(0xd4a94a, 0.14, 0.03, 0.02, 0, top + 0.05, 0.05)); // 鍬形
    } else if (type === 'crossbow') {
      g.add(box(0x5a3a1a, 0.26, 0.03, 0.03, 0.1, 0.22, 0.12));   // 弩
      g.add(box(0x5a3a1a, 0.03, 0.03, 0.2, 0.1, 0.22, 0.05));
    }
    return g;
  }
  const g = new THREE.Group();
  const mounted = type === 'cav' || type === 'harch';
  let y = 0;
  if (mounted) {
    g.add(box(0x6b4226, 0.16, 0.16, 0.42, 0, 0.14, 0));
    g.add(box(0x6b4226, 0.09, 0.2, 0.1, 0, 0.26, 0.2));
    for (const [x, z] of [[-0.05, -0.15], [0.05, -0.15], [-0.05, 0.15], [0.05, 0.15]]) g.add(box(0x3a2415, 0.04, 0.16, 0.04, x, 0, z));
    y = 0.28;
  }
  g.add(box(color, 0.16, 0.22, 0.12, 0, y, 0));
  g.add(sphere(0xe0b890, 0.06, 0, y + 0.28, 0, 6));
  g.add(cone(0x555555, 0.07, 0.08, 0, y + 0.32, 0, 6));
  if (type === 'inf' || type === 'cav') {
    const spear = box(0x8a6a3a, 0.02, 0.6, 0.02, 0.1, y, 0.02);
    spear.rotation.x = type === 'cav' ? 0.9 : 0;
    g.add(spear);
    if (type === 'inf') g.add(box(color, 0.03, 0.18, 0.14, -0.1, y + 0.02, 0.04));
  } else if (type === 'arch' || type === 'harch') {
    const bow = new THREE.Mesh(geo('bow', () => new THREE.TorusGeometry(0.1, 0.012, 4, 8, Math.PI)), mat(0x5a3a1a));
    bow.position.set(0.1, y + 0.15, 0.05);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    g.add(bow);
  } else if (type === 'siege') {
    g.add(box(PALETTE.wood, 0.36, 0.1, 0.5, 0.25, 0.08, 0));
    const arm = box(PALETTE.woodDark, 0.05, 0.05, 0.55, 0.25, 0.25, 0);
    arm.rotation.x = -0.6;
    g.add(arm);
    for (const [x, z] of [[0.08, -0.2], [0.42, -0.2], [0.08, 0.2], [0.42, 0.2]]) {
      const w = cyl(0x3a2415, 0.07, 0.04, x, 0.02, z, 8);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  return g;
}

function elephant(color) {
  const g = new THREE.Group();
  g.add(box(0x8a8a8a, 0.3, 0.3, 0.55, 0, 0.26, 0));                 // 胴
  for (const [x, z] of [[-0.1, -0.18], [0.1, -0.18], [-0.1, 0.18], [0.1, 0.18]]) g.add(box(0x7a7a7a, 0.09, 0.26, 0.09, x, 0, z));
  g.add(box(0x8a8a8a, 0.22, 0.22, 0.18, 0, 0.36, 0.34));            // 頭
  const trunk = box(0x7a7a7a, 0.06, 0.26, 0.06, 0, 0.12, 0.44);
  g.add(trunk);
  g.add(box(0xf2efe6, 0.03, 0.03, 0.14, -0.07, 0.3, 0.46));          // 牙
  g.add(box(0xf2efe6, 0.03, 0.03, 0.14, 0.07, 0.3, 0.46));
  g.add(box(color, 0.26, 0.12, 0.26, 0, 0.56, -0.04));              // 輿（ハウダー）
  g.add(sphere(0xe0b890, 0.05, 0, 0.74, -0.04, 6));
  g.scale.setScalar(1.25);
  return g;
}

export function troopMarker(type, color, n = 3) {
  const g = new THREE.Group();
  const offs = [[0, 0], [-0.3, 0.2], [0.3, 0.2], [-0.15, -0.25], [0.15, -0.25], [0.45, -0.1], [-0.45, -0.1], [0, 0.45], [0, -0.5]];
  for (let i = 0; i < Math.min(n, offs.length); i++) {
    const s = soldier(type, color);
    s.position.set(offs[i][0], 0, offs[i][1]);
    g.add(s);
  }
  return g;
}

export function disposeGroup(obj) {
  obj.traverse((o) => {
    if (o.isCSS2DObject && o.element?.parentNode) o.element.parentNode.removeChild(o.element);
  });
  obj.parent?.remove(obj);
}

export function buildingModel(type, style, color, season, variant = 0) {
  switch (type) {
    case 'palace': return palace(style, color);
    case 'farm': return farm(season);
    case 'pasture': return pasture();
    case 'house': return house(style, variant);
    case 'market': return market();
    case 'workshop': return workshop(style);
    case 'barracks': return barracks(style, color);
    case 'temple': return temple(style);
    case 'mine': return mine();
    case 'lumber': return lumber();
    case 'caravan': return caravan(style);
    default: return new THREE.Group();
  }
}

export const BUILDING_COLORS = {
  palace: '#b8860b', farm: '#7a9a3a', pasture: '#8ab060', house: '#b07a4a', market: '#c0392b', workshop: '#6d6d6d',
  barracks: '#8e2c2c', temple: '#3a8a8a', mine: '#5d5245', lumber: '#3d6b2e', caravan: '#c49a5c',
};
export const BUILDING_GLYPH = {
  palace: '宮', farm: '農', pasture: '牧', house: '住', market: '市', workshop: '工', barracks: '兵', temple: '寺', mine: '鉱', lumber: '林', caravan: '商',
};
