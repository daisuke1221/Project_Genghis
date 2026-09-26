// 地図の投影と範囲（geo.js と陸地マスク生成スクリプトで共有）
export const MAP_W = 150; // ゲームの範囲（地方がある領域）
export const MAP_H = 68;
// 描画する世界の範囲（ゲームの範囲の外側も陸と海を描く）
export const WORLD = { x0: -100, x1: 104, z0: -54, z1: 68 };
export const FINE = 0.25; // 陸地マスクと地形メッシュの細かさ

export function project(lat, lon) {
  return { x: (lon - 72) * 0.95, z: (41 - lat) * 1.35 };
}
export function unproject(x, z) {
  return { lon: x / 0.95 + 72, lat: 41 - z / 1.35 };
}
