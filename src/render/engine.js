// レンダラーとビュー切り替え、簡易トゥイーン
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

const tweens = new Set();

export function tween(obj, to, duration = 0.3, ease = easeInOut) {
  return new Promise((resolve) => {
    const from = {};
    for (const k in to) from[k] = obj[k];
    tweens.add({ obj, from, to, t: 0, duration: Math.max(0.001, duration), ease, resolve });
  });
}
export function tweenFn(duration, fn, ease = easeInOut) {
  return new Promise((resolve) => {
    tweens.add({ fn, t: 0, duration: Math.max(0.001, duration), ease, resolve });
  });
}
export const wait = (sec) => tweenFn(sec, () => {});
export function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
export function easeOut(t) { return 1 - (1 - t) * (1 - t); }
export const linear = (t) => t;

function updateTweens(dt) {
  for (const tw of [...tweens]) {
    tw.t += dt / tw.duration;
    const k = tw.ease(Math.min(1, tw.t));
    if (tw.fn) tw.fn(k);
    else for (const key in tw.to) tw.obj[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * k;
    if (tw.t >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}

export class Engine {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.view = null;
    this.timer = new THREE.Timer();
    this.timer.connect?.(document);
    this.speed = 1;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  makeLabelRenderer() {
    const lr = new CSS2DRenderer();
    lr.domElement.className = 'label-layer';
    lr.domElement.style.display = 'none';
    this.container.appendChild(lr.domElement);
    lr.setSize(this.container.clientWidth, this.container.clientHeight);
    return lr;
  }

  setView(v) {
    if (this.view === v) return;
    if (this.view) {
      this.view.exit?.();
      if (this.view.labels) this.view.labels.domElement.style.display = 'none';
    }
    this.view = v;
    if (v) {
      v.enter?.();
      if (v.labels) v.labels.domElement.style.display = '';
      this.resize();
    }
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    if (this.view) {
      this.view.camera.aspect = w / h;
      this.view.camera.updateProjectionMatrix();
      this.view.labels?.setSize(w, h);
    }
  }

  frame() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    updateTweens(dt);
    const v = this.view;
    if (!v) return;
    v.update?.(dt, this.timer.getElapsed());
    this.renderer.render(v.scene, v.camera);
    v.labels?.render(v.scene, v.camera);
  }
}

// 画面座標 → レイキャスト
export function pickAt(ev, camera, dom, objects, recursive = true) {
  const rect = dom.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(objects, recursive);
}

// ドラッグとクリックを区別するポインタ処理
export function bindPointer(dom, { onClick, onMove, onRight }) {
  let down = null;
  const h = {
    pointerdown: (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; },
    pointerup: (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6) {
        if (down.b === 2) onRight?.(e); else if (down.b === 0) onClick?.(e);
      }
      down = null;
    },
    pointermove: (e) => onMove?.(e),
    contextmenu: (e) => e.preventDefault(),
  };
  for (const k in h) dom.addEventListener(k, h[k]);
  return () => { for (const k in h) dom.removeEventListener(k, h[k]); };
}
