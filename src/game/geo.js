// 世界地図の地理計算：実際の海岸線（Natural Earth）・地方の領域（ボロノイ分割）・隣接・標高・植生
import { PROVINCES, ADJACENCY, PROVINCE_TERRAIN } from './data.js';
import { MAP_W, MAP_H, WORLD, FINE, project, unproject } from './projection.js';
import { LAND_W, LAND_H, LAND_RLE } from './landmask.js';
import { RIDGES, PLATEAUS, DESERTS, LAKES } from './geography.js';

export { MAP_W, MAP_H, WORLD, FINE, project, unproject };
export const RES = 0.5; // ゲームの格子（地方・隣接の判定）
export const GRID_W = Math.round(MAP_W / RES);
export const GRID_H = Math.round(MAP_H / RES);
const MAX_PROV_DIST = 12;
const DEG = 1.15; // 1度をおおよそ何単位とみなすか（幅の換算用）

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
const smoothstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- 陸地マスク（細かい格子：WORLD 全体） ----
export const FW = LAND_W, FH = LAND_H;
const land = new Uint8Array(FW * FH);
{
  const bin = atob(LAND_RLE);
  let k = 0, cur = 0, i = 0;
  while (i < bin.length) {
    let n = 0, s = 0, b;
    do { b = bin.charCodeAt(i++); n |= (b & 127) << s; s += 7; } while (b & 128);
    land.fill(cur, k, k + n);
    k += n; cur ^= 1;
  }
}
export const fineXZ = (i, j) => [WORLD.x0 + i * FINE, WORLD.z0 + j * FINE];

// 折れ線（緯度経度）を投影座標の線分に
const segsOf = (pts) => {
  const p = pts.map(([lat, lon]) => project(lat, lon));
  const out = [];
  for (let i = 0; i + 1 < p.length; i++) out.push([p[i].x, p[i].z, p[i + 1].x, p[i + 1].z]);
  if (p.length === 1) out.push([p[0].x, p[0].z, p[0].x, p[0].z]);
  return out;
};
function segDist(px, pz, [ax, az, bx, bz]) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
// 線分の周り（半径 r）の細かい格子の点を訪れる
function forNear(seg, r, fn) {
  const i0 = Math.max(0, Math.floor((Math.min(seg[0], seg[2]) - r - WORLD.x0) / FINE));
  const i1 = Math.min(FW - 1, Math.ceil((Math.max(seg[0], seg[2]) + r - WORLD.x0) / FINE));
  const j0 = Math.max(0, Math.floor((Math.min(seg[1], seg[3]) - r - WORLD.z0) / FINE));
  const j1 = Math.min(FH - 1, Math.ceil((Math.max(seg[1], seg[3]) + r - WORLD.z0) / FINE));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const [x, z] = fineXZ(i, j);
    const d = segDist(x, z, seg);
    if (d <= r) fn(j * FW + i, d, x, z);
  }
}
// 湖をくり抜く
for (const L of LAKES) for (const s of segsOf(L.pts)) forNear(s, (L.w / 2) * DEG, (k) => { land[k] = 0; });

// 海岸からの距離（陸は正、海は負。単位は地図の座標）
const coast = new Float32Array(FW * FH);
{
  const INF = 1e9;
  const dl = new Float32Array(FW * FH), ds = new Float32Array(FW * FH);
  for (let k = 0; k < land.length; k++) { dl[k] = land[k] ? INF : 0; ds[k] = land[k] ? 0 : INF; }
  const pass = (d) => {
    const D = Math.SQRT2;
    for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
      const k = j * FW + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) { v = Math.min(v, d[k - FW] + 1); if (i > 0) v = Math.min(v, d[k - FW - 1] + D); if (i < FW - 1) v = Math.min(v, d[k - FW + 1] + D); }
      d[k] = v;
    }
    for (let j = FH - 1; j >= 0; j--) for (let i = FW - 1; i >= 0; i--) {
      const k = j * FW + i;
      let v = d[k];
      if (i < FW - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < FH - 1) { v = Math.min(v, d[k + FW] + 1); if (i < FW - 1) v = Math.min(v, d[k + FW + 1] + D); if (i > 0) v = Math.min(v, d[k + FW - 1] + D); }
      d[k] = v;
    }
  };
  pass(dl); pass(ds);
  for (let k = 0; k < land.length; k++) coast[k] = land[k] ? (dl[k] - 0.5) * FINE : -(ds[k] - 0.5) * FINE;
  // 格子の階段を消すため、軽くぼかしてなめらかな海岸線にする
  const tmp = new Float32Array(coast.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
      let sum = 0, n = 0;
      for (let d = -1; d <= 1; d++) { const ii = i + d; if (ii >= 0 && ii < FW) { sum += coast[j * FW + ii]; n++; } }
      tmp[j * FW + i] = sum / n;
    }
    for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
      let sum = 0, n = 0;
      for (let d = -1; d <= 1; d++) { const jj = j + d; if (jj >= 0 && jj < FH) { sum += tmp[jj * FW + i]; n++; } }
      coast[j * FW + i] = sum / n;
    }
  }
}

function fineSample(arr, x, z, out = 0) {
  const fi = (x - WORLD.x0) / FINE, fj = (z - WORLD.z0) / FINE;
  if (fi < 0 || fj < 0 || fi > FW - 1 || fj > FH - 1) return out;
  const i = Math.min(FW - 2, Math.floor(fi)), j = Math.min(FH - 2, Math.floor(fj));
  const u = fi - i, v = fj - j, k = j * FW + i;
  return arr[k] * (1 - u) * (1 - v) + arr[k + 1] * u * (1 - v) + arr[k + FW] * (1 - u) * v + arr[k + FW + 1] * u * v;
}
export const coastAt = (x, z) => fineSample(coast, x, z, -5);
export const isLandAt = (x, z) => coastAt(x, z) > 0;

// ---- 地方（ボロノイ） ----
export const PROV_POS = {};
export const PROV_INDEX = {};
PROVINCES.forEach((p, i) => { PROV_POS[p.id] = project(p.lat, p.lon); PROV_INDEX[p.id] = i; });

const inGame = (x, z) => Math.abs(x) <= MAP_W / 2 && Math.abs(z) <= MAP_H / 2;

// 地方の領域：各地方の都市から陸を伝って広がる（海は狭い海峡だけ越えられる）。
// 通りやすさにノイズを混ぜて、境界を自然な形にする。
function growProvinces(step) {
  const w = Math.round(MAP_W / step) + 1, h = Math.round(MAP_H / step) + 1;
  const n = w * h;
  const owner = new Int16Array(n).fill(-1), dist = new Float32Array(n).fill(Infinity), cost = new Float32Array(n);
  const landCell = new Uint8Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = -MAP_W / 2 + i * step, z = -MAP_H / 2 + j * step, k = j * w + i;
    landCell[k] = coastAt(x, z) > 0 ? 1 : 0;
    cost[k] = (landCell[k] ? 1 : 9) * (0.65 + 0.7 * fbm(x * 0.18, z * 0.18, 3));
  }
  // 二分ヒープによるダイクストラ
  const heap = [];
  const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  PROVINCES.forEach((p, idx) => {
    const s = PROV_POS[p.id];
    const k = Math.round((s.z + MAP_H / 2) / step) * w + Math.round((s.x + MAP_W / 2) / step);
    dist[k] = 0; owner[k] = idx; push(0, k);
  });
  const D = Math.SQRT2;
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    const i = k % w, j = (k - i) / w;
    for (const [di, dj, m] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, D], [1, -1, D], [-1, 1, D], [-1, -1, D]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
      const kk = jj * w + ii;
      const nd = d + step * m * (cost[k] + cost[kk]) / 2;
      if (nd < dist[kk] && nd <= MAX_PROV_DIST) { dist[kk] = nd; owner[kk] = owner[k]; push(nd, kk); }
    }
  }
  const out = new Int16Array(n);
  for (let k = 0; k < n; k++) out[k] = !landCell[k] ? -1 : owner[k] >= 0 ? owner[k] : -2;
  return { w, h, arr: out, dist };
}

// ---- ゲームの格子 ----
export const cells = new Int16Array((GRID_W + 1) * (GRID_H + 1)); // -1 海, -2 荒野, >=0 地方
export const cellCoast = new Float32Array((GRID_W + 1) * (GRID_H + 1));
export function cellXZ(i, j) { return [-MAP_W / 2 + i * RES, -MAP_H / 2 + j * RES]; }
{
  const g = growProvinces(RES);
  cells.set(g.arr);
  for (let j = 0; j <= GRID_H; j++) for (let i = 0; i <= GRID_W; i++) cellCoast[j * (GRID_W + 1) + i] = coastAt(...cellXZ(i, j));
}

// 点の分類：{ kind: 'sea'|'wild'|'prov', prov: index, coast }
export function classify(x, z) {
  const c = coastAt(x, z);
  if (c <= 0) return { kind: 'sea', prov: -1, coast: c };
  const p = provinceAt(x, z);
  return p ? { kind: 'prov', prov: PROV_INDEX[p], coast: c } : { kind: 'wild', prov: -1, coast: c };
}

export function cellIndexAt(x, z) {
  const i = Math.round((x + MAP_W / 2) / RES);
  const j = Math.round((z + MAP_H / 2) / RES);
  if (i < 0 || j < 0 || i > GRID_W || j > GRID_H) return -1;
  return j * (GRID_W + 1) + i;
}

// 細かい格子での地方（描画とクリック用。最初に使うときに計算する）
let fineProvCache = null;
export function fineProvinces() {
  fineProvCache ??= growProvinces(FINE);
  return fineProvCache;
}

export function provinceAt(x, z) {
  if (!inGame(x, z)) return null;
  const f = fineProvinces();
  const i = Math.round((x + MAP_W / 2) / FINE), j = Math.round((z + MAP_H / 2) / FINE);
  const v = f.arr[j * f.w + i];
  return v >= 0 ? PROVINCES[v].id : null;
}

// ---- 隣接（ゲームのルールは data.js の表で決まる） ----
export const ADJ = {};
PROVINCES.forEach((p) => { ADJ[p.id] = new Set(); });
for (const [a, b] of ADJACENCY) { ADJ[a].add(b); ADJ[b].add(a); }
export const NEIGHBORS = {};
for (const id in ADJ) NEIGHBORS[id] = [...ADJ[id]].sort();

export function isAdjacent(a, b) { return ADJ[a]?.has(b) ?? false; }

// ---- 植生 ----
// 砂漠らしさ（0〜1）と赤み
export function desertAt(x, z) {
  const { lat, lon } = unproject(x, z);
  let d = 0, red = 0;
  for (const D of DESERTS) {
    const q = Math.hypot((lat - D.c[0]) / D.r[0], (lon - D.c[1]) / D.r[1]);
    const v = 1 - smoothstep(0.55, 1.15, q + (fbm(x * 0.25, z * 0.25, 41) - 0.5) * 0.5);
    if (v > d) { d = v; red = D.red; }
  }
  return { d, red };
}

// ---- 標高（細かい格子） ----
const heights = new Float32Array(FW * FH);
{
  // 地方の地形（平野・草原・山岳など）の高さを、ゲームの格子でならしてから使う
  const W1 = GRID_W + 1;
  const pt = new Float32Array(W1 * (GRID_H + 1));
  for (let k = 0; k < pt.length; k++) pt[k] = cells[k] >= 0 ? PROVINCE_TERRAIN[PROVINCES[cells[k]].terrain].height : 0.7;
  const tmp = new Float32Array(pt.length);
  for (let pass = 0; pass < 4; pass++) {
    for (let j = 0; j <= GRID_H; j++) for (let i = 0; i <= GRID_W; i++) {
      let s = 0, n = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii > GRID_W || jj > GRID_H) continue;
        s += pt[jj * W1 + ii]; n++;
      }
      tmp[j * W1 + i] = s / n;
    }
    pt.set(tmp);
  }
  const provTerrain = (x, z) => {
    const fi = Math.max(0, Math.min(GRID_W - 0.001, (x + MAP_W / 2) / RES)), fj = Math.max(0, Math.min(GRID_H - 0.001, (z + MAP_H / 2) / RES));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * W1 + i;
    const inner = pt[k] * (1 - u) * (1 - v) + pt[k + 1] * u * (1 - v) + pt[k + W1] * (1 - u) * v + pt[k + W1 + 1] * u * v;
    const out = Math.max(Math.abs(x) - MAP_W / 2, Math.abs(z) - MAP_H / 2, 0);
    return inner + (0.7 - inner) * Math.min(1, out / 5);
  };
  // 山脈
  const ridge = new Float32Array(FW * FH);
  for (const R of RIDGES) {
    const w = R.w * DEG * 0.8;
    for (const s of segsOf(R.pts)) forNear(s, w * 3.2, (k, d, x, z) => {
      // 主稜（鋭い）と裾野（なだらか）を重ね、稜線に沿って高さをばらつかせる
      const rough = 0.5 + 0.9 * Math.pow(fbm(x * 0.4, z * 0.4, 9), 1.3);
      const v = R.h * 0.62 * (Math.exp(-((d / w) ** 2)) * 0.75 + Math.exp(-((d / (w * 2.4)) ** 2)) * 0.3) * rough;
      if (v > ridge[k]) ridge[k] = v;
    });
  }
  for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
    const k = j * FW + i;
    const [x, z] = fineXZ(i, j);
    const c = coast[k];
    if (c <= 0) { heights[k] = 0.02 + Math.max(-2.6, c * 0.8); continue; } // 海岸で陸と連続させる（段差を作らない）
    const { lat, lon } = unproject(x, z);
    let plateau = 0;
    for (const P of PLATEAUS) {
      const q = Math.hypot((lat - P.c[0]) / P.r[0], (lon - P.c[1]) / P.r[1]);
      if (q < 1.3) plateau = Math.max(plateau, P.h * 0.7 * (1 - smoothstep(0.65, 1.25, q + (fbm(x * 0.3, z * 0.3, 13) - 0.5) * 0.4)));
    }
    const th = provTerrain(x, z);
    const base = 0.2 + th * 0.35 * (0.5 + fbm(x * 0.2, z * 0.2, 5));
    const hills = Math.pow(fbm(x * 0.5, z * 0.5, 17), 2.5) * 0.9 * th;
    const top = Math.max(ridge[k] + plateau * 0.4, plateau);
    const shore = Math.min(1, c / 1.2);
    heights[k] = 0.02 + (base + hills + top) * shore;
  }
}

export function heightAt(x, z) {
  return fineSample(heights, x, z, -2);
}
export const fineHeights = heights;
