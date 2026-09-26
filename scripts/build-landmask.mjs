// 陸地マスクの生成：Natural Earth（world-atlas の land-50m）の海岸線を地図の投影でラスタ化し、
// src/game/landmask.js に連長圧縮して書き出す。  使い方: node scripts/build-landmask.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import { WORLD, FINE, unproject } from '../src/game/projection.js';

const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-50m.json', import.meta.url)));
const land = feature(topo, topo.objects.land);
const W = Math.round((WORLD.x1 - WORLD.x0) / FINE) + 1;
const H = Math.round((WORLD.z1 - WORLD.z0) / FINE) + 1;

// 行（緯度）ごとに、その緯度を横切る辺の経度を集める（偶奇規則なので穴も正しく扱える）
const rows = Array.from({ length: H }, () => []);
const latOf = (j) => unproject(0, WORLD.z0 + j * FINE).lat;
const rings = [];
for (const f of land.features) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) rings.push(ring);
}
const latTop = latOf(0), step = latOf(0) - latOf(1);
const addRows = (lo, hi, fn) => {
  const jFrom = Math.max(0, Math.ceil((latTop - hi) / step)), jTo = Math.min(H - 1, Math.floor((latTop - lo) / step));
  for (let j = jFrom; j <= jTo; j++) { const lat = latOf(j); if (lat >= lo && lat < hi) fn(j, lat); }
};
for (const ring of rings) {
  const jumps = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i], [lon2, lat2] = ring[i + 1];
    // 日付変更線を飛び越える辺：飛んだ緯度を覚えておき、あとで東西の端に縦の辺を補って輪を閉じる
    if (Math.abs(lon2 - lon1) > 180) { jumps.push((lat1 + lat2) / 2); continue; }
    if (lat1 === lat2) continue;
    addRows(Math.min(lat1, lat2), Math.max(lat1, lat2), (j, lat) => rows[j].push(lon1 + ((lat - lat1) / (lat2 - lat1)) * (lon2 - lon1)));
  }
  jumps.sort((a, b) => a - b);
  for (let k = 0; k + 1 < jumps.length; k += 2) addRows(jumps[k], jumps[k + 1], (j) => rows[j].push(-180, 180));
}
const mask = new Uint8Array(W * H);
for (let j = 0; j < H; j++) {
  const xs = rows[j].sort((a, b) => a - b);
  for (let k = 0; k + 1 < xs.length; k += 2) {
    for (let i = 0; i < W; i++) {
      const lon = unproject(WORLD.x0 + i * FINE, 0).lon;
      if (lon >= xs[k] && lon < xs[k + 1]) mask[j * W + i] = 1;
    }
  }
}
// 連長圧縮（海から始まる交互の長さ）→ 可変長整数 → base64
const bytes = [];
let cur = 0, run = 0;
const push = (n) => { while (n >= 128) { bytes.push((n & 127) | 128); n >>>= 7; } bytes.push(n); };
for (let k = 0; k < mask.length; k++) {
  if (mask[k] === cur) run++;
  else { push(run); cur = mask[k]; run = 1; }
}
push(run);
const b64 = Buffer.from(bytes).toString('base64');
const land1 = mask.reduce((s, v) => s + v, 0);
writeFileSync(new URL('../src/game/landmask.js', import.meta.url),
  `// 自動生成（scripts/build-landmask.mjs）。Natural Earth 1:50m の陸地（パブリックドメイン）を world-atlas 経由でラスタ化したもの\n` +
  `export const LAND_W = ${W};\nexport const LAND_H = ${H};\nexport const LAND_RLE = '${b64}';\n`);
console.log(`${W}x${H}, land ${(land1 / mask.length * 100).toFixed(1)}%, ${b64.length} chars`);
