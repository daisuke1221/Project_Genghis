// UI 共通部品：モーダル・トースト・ツールチップ
import { audio } from '../audio/audio.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (n) => Math.round(n).toLocaleString();

// modal({ title, body (html or fn(el)), buttons: [{label, value, primary, disabled}] }) -> Promise<value>
export function modal({ title, body, buttons = [{ label: '閉じる', value: null }], width, onMount, closeValue = null }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const box = document.createElement('div');
    box.className = 'modal';
    if (width) box.style.width = width;
    box.innerHTML = `<h2>${title}</h2><div class="body"></div><div class="foot"></div>`;
    back.appendChild(box);
    const bodyEl = box.querySelector('.body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    const close = (v) => {
      document.removeEventListener('keydown', onKey);
      back.remove();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(closeValue); };
    document.addEventListener('keydown', onKey);
    const foot = box.querySelector('.foot');
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `btn${b.primary ? ' primary' : ''}`;
      btn.textContent = b.label;
      btn.disabled = !!b.disabled;
      btn.onclick = () => { audio.sfx('click'); close(typeof b.value === 'function' ? b.value() : b.value); };
      foot.appendChild(btn);
    }
    document.getElementById('modal-root').appendChild(back);
    const api = { el: bodyEl, close, box };
    if (typeof body === 'function') body(bodyEl, api);
    onMount?.(api);
  });
}

export function confirmBox(title, text, ok = 'はい', cancel = 'いいえ') {
  return modal({ title, body: `<p>${text}</p>`, buttons: [{ label: cancel, value: false }, { label: ok, value: true, primary: true }], closeValue: false });
}

export function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2900);
}

export function busy(text) {
  const el = document.getElementById('busy');
  if (text === null || text === false) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  document.getElementById('busy-text').textContent = text;
}

export function tooltip(html, e) {
  const el = document.getElementById('tooltip');
  if (!html) { el.classList.add('hidden'); return; }
  el.innerHTML = html;
  el.classList.remove('hidden');
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 12;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 12;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

export function statBar(v, max = 100, color) {
  return `<div class="bar"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%;${color ? `background:${color}` : ''}"></i></div>`;
}
