// 世界地図の地理計算：投影・ボロノイ分割による地方の領域・隣接関係・標高
import { PROVINCES, SEA_SITES, EXTRA_LINKS, CUT_LINKS, PROVINCE_TERRAIN } from './data.js';

export const MAP_W = 150;
export const MAP_H = 68;
export const RES = 0.5;
export const GRID_W = Math.round(MAP_W / RES);
export const GRID_H = Math.round(MAP_H / RES);
const MAX_PROV_DIST = 7.5;

export function project(lat, lon) {
  return { x: (lon - 72) * 0.95, z: (41 - lat) * 1.35 };
}

// ---- ノイズ ----
function hash(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }
export function valueNoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(x, z, seed = 0, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * f, z * f, seed + i * 17) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

// ---- 種点 ----
export const PROV_POS = {};
export const PROV_INDEX = {};
PROVINCES.forEach((p, i) => { PROV_POS[p.id] = project(p.lat, p.lon); PROV_INDEX[p.id] = i; });
const provSites = PROVINCES.map((p) => PROV_POS[p.id]);
const seaSites = SEA_SITES.map(([lat, lon]) => project(lat, lon));

function warp(x, z) {
  return [
    x + (fbm(x * 0.18, z * 0.18, 3) - 0.5) * 5,
    z + (fbm(x * 0.18 + 50, z * 0.18 + 50, 7) - 0.5) * 5,
  ];
}

// 点の分類：{ kind: 'sea'|'wild'|'prov', prov: index, dp, ds }
export function classify(x, z) {
  const [wx, wz] = warp(x, z);
  let dp = Infinity, pi = -1;
  for (let i = 0; i < provSites.length; i++) {
    const s = provSites[i];
    const d = Math.hypot(wx - s.x, wz - s.z);
    if (d < dp) { dp = d; pi = i; }
  }
  let ds = Infinity;
  for (const s of seaSites) {
    const d = Math.hypot(wx - s.x, wz - s.z);
    if (d < ds) ds = d;
  }
  // 地図の外周は海
  const edge = Math.min(x + MAP_W / 2, MAP_W / 2 - x, z + MAP_H / 2, MAP_H / 2 - z);
  ds = Math.min(ds, Math.max(0, edge) * 1.6 + 1);
  if (ds < dp * 0.95) return { kind: 'sea', prov: -1, dp, ds };
  if (dp > MAX_PROV_DIST) return { kind: 'wild', prov: -1, dp, ds };
  return { kind: 'prov', prov: pi, dp, ds };
}

// ---- セルグリッド ----
export const cells = new Int16Array((GRID_W + 1) * (GRID_H + 1)); // -1 海, -2 荒野, >=0 地方
export const cellCoast = new Float32Array((GRID_W + 1) * (GRID_H + 1));
export function cellXZ(i, j) { return [-MAP_W / 2 + i * RES, -MAP_H / 2 + j * RES]; }

for (let j = 0; j <= GRID_H; j++) {
  for (let i = 0; i <= GRID_W; i++) {
    const [x, z] = cellXZ(i, j);
    const c = classify(x, z);
    const k = j * (GRID_W + 1) + i;
    cells[k] = c.kind === 'sea' ? -1 : c.kind === 'wild' ? -2 : c.prov;
    cellCoast[k] = c.ds - c.dp * 0.95; // 正なら陸
  }
}

export function cellIndexAt(x, z) {
  const i = Math.round((x + MAP_W / 2) / RES);
  const j = Math.round((z + MAP_H / 2) / RES);
  if (i < 0 || j < 0 || i > GRID_W || j > GRID_H) return -1;
  return j * (GRID_W + 1) + i;
}

export function provinceAt(x, z) {
  const k = cellIndexAt(x, z);
  if (k < 0) return null;
  const v = cells[k];
  return v >= 0 ? PROVINCES[v].id : null;
}

// ---- 隣接 ----
export const ADJ = {};
PROVINCES.forEach((p) => { ADJ[p.id] = new Set(); });
const linkCount = {};
for (let j = 0; j < GRID_H; j++) {
  for (let i = 0; i < GRID_W; i++) {
    const a = cells[j * (GRID_W + 1) + i];
    if (a < 0) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = cells[(j + dj) * (GRID_W + 1) + i + di];
      if (b >= 0 && b !== a) {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        linkCount[key] = (linkCount[key] || 0) + 1;
      }
    }
  }
}
for (const [key, n] of Object.entries(linkCount)) {
  if (n < 3) continue; // 角でわずかに接するだけの境界は無視
  const [a, b] = key.split(',').map(Number);
  ADJ[PROVINCES[a].id].add(PROVINCES[b].id);
  ADJ[PROVINCES[b].id].add(PROVINCES[a].id);
}
for (const [a, b] of EXTRA_LINKS) { ADJ[a].add(b); ADJ[b].add(a); }
for (const [a, b] of CUT_LINKS) { ADJ[a].delete(b); ADJ[b].delete(a); }
export const NEIGHBORS = {};
for (const id in ADJ) NEIGHBORS[id] = [...ADJ[id]].sort();

export function isAdjacent(a, b) { return ADJ[a]?.has(b) ?? false; }

// ---- 標高 ----
function rawHeight(x, z, k) {
  const coast = cellCoast[k];
  const v = cells[k];
  if (v === -1 || coast < 0) return -0.6 + Math.max(-2.4, coast * 0.5);
  let base;
  if (v === -2) base = 0.9 + fbm(x * 0.12, z * 0.12, 11) * 2.0;
  else {
    const t = PROVINCE_TERRAIN[PROVINCES[v].terrain];
    base = 0.25 + t.height * (0.45 + fbm(x * 0.2, z * 0.2, 5) * 0.9);
  }
  const mountain = v >= 0 && PROVINCES[v].terrain === 'mountain';
  const ridge = Math.pow(fbm(x * 0.35, z * 0.35, 9), 3) * 3 * (mountain ? 1.4 : 0.4);
  const shore = Math.min(1, coast / 3);
  return (base + ridge) * shore + 0.05;
}

// 生の標高を計算し、陸地だけをぼかして地方境界の段差をなくす
const W1 = GRID_W + 1;
export const heightGrid = new Float32Array(W1 * (GRID_H + 1));
for (let j = 0; j <= GRID_H; j++) for (let i = 0; i <= GRID_W; i++) {
  const [x, z] = cellXZ(i, j);
  const k = j * W1 + i;
  heightGrid[k] = rawHeight(x, z, k);
}
{
  const tmp = new Float32Array(heightGrid.length);
  for (let pass = 0; pass < 4; pass++) {
    for (let j = 0; j <= GRID_H; j++) for (let i = 0; i <= GRID_W; i++) {
      const k = j * W1 + i;
      if (cellCoast[k] < 0 || cells[k] === -1) { tmp[k] = heightGrid[k]; continue; }
      let s = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii > GRID_W || jj > GRID_H) continue;
        const kk = jj * W1 + ii;
        s += heightGrid[kk]; n++;
      }
      tmp[k] = Math.max(0.05, s / n);
    }
    heightGrid.set(tmp);
  }
}

export function heightAt(x, z) {
  const fi = (x + MAP_W / 2) / RES, fj = (z + MAP_H / 2) / RES;
  if (fi < 0 || fj < 0 || fi > GRID_W || fj > GRID_H) return -2;
  const i = Math.min(GRID_W - 1, Math.floor(fi)), j = Math.min(GRID_H - 1, Math.floor(fj));
  const u = fi - i, v = fj - j;
  const k = j * W1 + i;
  const a = heightGrid[k], b = heightGrid[k + 1], c = heightGrid[k + W1], d = heightGrid[k + W1 + 1];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
