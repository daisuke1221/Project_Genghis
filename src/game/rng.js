// 決定論的乱数（mulberry32）。状態はゲームのセーブデータ内に保持する。

export function rnd(st) {
  st.rng = (st.rng + 0x6d2b79f5) >>> 0;
  let t = st.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rint = (st, a, b) => a + Math.floor(rnd(st) * (b - a + 1));
export const rrange = (st, a, b) => a + rnd(st) * (b - a);
export const chance = (st, p) => rnd(st) < p;
export const pick = (st, arr) => arr[Math.floor(rnd(st) * arr.length)];

export function shuffle(st, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(st) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
