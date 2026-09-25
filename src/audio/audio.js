// WebAudio による手続き生成の音楽・効果音（音源ファイルは使わない）
// 楽曲はすべてこのゲームのためのオリジナル。

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function midiOf(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
}
const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// "A4:2 G4:1 r:1 | ..." → [{t, d, f}]
function seq(str, inst, vel = 1, offset = 0) {
  const out = [];
  let t = offset;
  for (const tok of str.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [n, d] = tok.split(':');
    const dur = Number(d);
    if (n !== 'r') out.push({ t, d: dur, f: freq(midiOf(n)), inst, vel });
    t += dur;
  }
  return { events: out, length: t - offset };
}
function repeat(str, inst, times, vel) {
  const evs = [];
  let t = 0;
  for (let i = 0; i < times; i++) { const s = seq(str, inst, vel, t); evs.push(...s.events); t += s.length; }
  return evs;
}
function drums(pattern, inst, bars, beatsPerBar, vel = 1) {
  const evs = [];
  for (let b = 0; b < bars; b++) for (const p of pattern) evs.push({ t: b * beatsPerBar + p, d: 0.5, f: 0, inst, vel });
  return evs;
}

const SONGS = {
  title: () => {
    const mel = seq('D4:4 F4:2 G4:2 | A4:6 G4:2 | C5:4 A4:2 G4:2 | A4:8 | D5:4 C5:2 A4:2 | G4:4 F4:2 G4:2 | A4:3 G4:1 F4:2 D4:2 | D4:8', 'fiddle', 0.9);
    return { bpm: 58, length: 64, drone: [freq(38), freq(45)], throat: true, events: [...mel.events, ...drums([0], 'big', 16, 4, 0.9)] };
  },
  map: () => {
    const a = 'A4:2 G4:1 A4:1 C5:2 A4:2 | G4:1 F4:1 D4:2 F4:2 G4:2 | A4:3 C5:1 D5:2 C5:1 A4:1 | G4:2 F4:1 G4:1 D4:4';
    const b = 'D5:2 F5:1 D5:1 C5:2 A4:2 | C5:1 D5:1 A4:2 G4:2 A4:2 | F4:2 G4:1 A4:1 C5:3 A4:1 | G4:1 F4:1 D4:1 F4:1 D4:4';
    const mel = seq(`${a} ${b}`, 'fiddle', 0.8);
    const arp = repeat('D3:0.5 A3:0.5 D4:0.5 A3:0.5', 'pluck', 32, 0.35);
    return { bpm: 72, length: 64, drone: [freq(38), freq(45)], events: [...mel.events, ...arp, ...drums([0, 1.5], 'frame', 32, 2, 0.6)] };
  },
  city: () => {
    const mel = seq('B4:1 D5:1 E5:2 D5:1 B4:1 A4:2 | G4:1 A4:1 B4:1 D5:1 B4:2 A4:2 | E5:1 D5:1 B4:1 D5:1 E5:2 G5:2 | D5:1 B4:1 A4:1 B4:1 G4:4', 'flute', 0.7);
    const mel2 = seq('G4:2 A4:1 B4:1 D5:2 B4:2 | A4:1 B4:1 A4:1 G4:1 E4:2 D4:2 | E4:1 G4:1 A4:1 B4:1 D5:2 E5:2 | D5:1 B4:1 A4:1 B4:1 G4:4', 'flute', 0.7, 32);
    const arp = repeat('G3:0.5 D4:0.5 B3:0.5 D4:0.5', 'pluck', 32, 0.4);
    return { bpm: 100, length: 64, drone: [freq(43)], droneVol: 0.5, events: [...mel.events, ...mel2.events, ...arp, ...drums([0, 0.75, 1.5], 'frame', 32, 2, 0.45)] };
  },
  battle: () => {
    const mel = seq('E4:1.5 E4:0.5 G4:1 A4:1 | B4:2 A4:1 G4:1 | E4:1.5 D4:0.5 E4:1 G4:1 | A4:3 r:1 | B4:1.5 B4:0.5 D5:1 B4:1 | A4:1 G4:1 A4:2 | G4:1 E4:1 D4:1 E4:1 | E4:4', 'brass', 0.8);
    const bass = repeat('E2:0.5 E2:0.5 E3:0.5 E2:0.5 G2:0.5 E2:0.5 D2:0.5 E2:0.5', 'bass', 8, 0.7);
    const dr = [...drums([0, 1.5, 2], 'big', 8, 4, 1), ...drums([1, 3, 3.5], 'tom', 8, 4, 0.7), ...drums([0.5, 1.5, 2.5, 3.5], 'hat', 8, 4, 0.25)];
    return { bpm: 138, length: 32, events: [...mel.events, ...bass, ...dr] };
  },
};

class AudioSystem {
  constructor() {
    this.ctx = null;
    this.current = null;
    this.musicVol = Number(localStorage.getItem('vol.music') ?? 0.5);
    this.sfxVol = Number(localStorage.getItem('vol.sfx') ?? 0.7);
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVol * 0.5;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol * 0.6;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    // 残響
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain);
    this.revGain.connect(this.musicBus);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this.tick(), 30);
    if (this.pending) { const p = this.pending; this.pending = null; this.play(p); }
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    localStorage.setItem('vol.music', music);
    localStorage.setItem('vol.sfx', sfx);
    if (this.ctx) {
      this.musicBus.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.05);
      this.sfxBus.gain.setTargetAtTime(sfx * 0.6, this.ctx.currentTime, 0.05);
    }
  }

  play(name) {
    if (!this.ctx) { this.pending = name; return; }
    if (this.current?.name === name) return;
    this.stop();
    if (!name || !SONGS[name]) return;
    const song = SONGS[name]();
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    out.connect(this.musicBus);
    out.connect(this.reverb);
    song.events.sort((a, b) => a.t - b.t);
    const cur = { name, song, out, start: ctx.currentTime + 0.1, idx: 0, loop: 0, spb: 60 / song.bpm, nodes: [] };
    if (song.drone) {
      for (const f of song.drone) cur.nodes.push(...this.drone(f, out, song.droneVol ?? 1));
    }
    if (song.throat) cur.nodes.push(...this.throat(out));
    this.current = cur;
  }

  stop() {
    const cur = this.current;
    if (!cur) return;
    const ctx = this.ctx;
    cur.out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => { for (const n of cur.nodes) try { n.stop(); } catch { /* 停止済み */ } cur.out.disconnect(); }, 1500);
    this.current = null;
  }

  tick() {
    const cur = this.current;
    if (!cur) return;
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.15;
    const { song, spb } = cur;
    let guard = 0;
    while (guard++ < 200) {
      if (cur.idx >= song.events.length) { cur.idx = 0; cur.loop += 1; }
      const ev = song.events[cur.idx];
      const t = cur.start + (cur.loop * song.length + ev.t) * spb;
      if (t > ahead) break;
      if (t >= ctx.currentTime - 0.05) this.note(ev, t, spb, cur.out);
      cur.idx += 1;
    }
  }

  // ---- 楽器 ----
  note(ev, t, spb, out) {
    const d = ev.d * spb;
    switch (ev.inst) {
      case 'fiddle': return this.fiddle(ev.f, t, d, ev.vel, out);
      case 'pluck': return this.pluck(ev.f, t, ev.vel, out);
      case 'flute': return this.flute(ev.f, t, d, ev.vel, out);
      case 'brass': return this.brass(ev.f, t, d, ev.vel, out);
      case 'bass': return this.bass(ev.f, t, d, ev.vel, out);
      default: return this.drum(ev.inst, t, ev.vel, out);
    }
  }

  env(g, t, a, peak, dur, rel) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur - rel));
    g.gain.linearRampToValueAtTime(0, t + dur + rel);
  }

  // 馬頭琴風の擦弦
  fiddle(f, t, d, vel, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.6, d));
    vib.connect(vg); vg.connect(o.frequency);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = ctx.createGain();
    this.env(g, t, 0.12, 0.22 * vel, d, 0.25);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); vib.start(t); o.stop(t + d + 0.4); vib.stop(t + d + 0.4);
  }

  pluck(f, t, vel, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = f * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.15;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o2.start(t); o.stop(t + 0.8); o2.stop(t + 0.8);
  }

  flute(f, t, d, vel, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const vib = ctx.createOscillator(); vib.frequency.value = 4.5;
    const vg = ctx.createGain(); vg.gain.value = f * 0.004;
    vib.connect(vg); vg.connect(o.frequency);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = f * 2; nb.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    const g = ctx.createGain();
    this.env(g, t, 0.06, 0.2 * vel, d, 0.15);
    o.connect(g); n.connect(nb); nb.connect(ng); ng.connect(g); g.connect(out);
    o.start(t); vib.start(t); n.start(t); o.stop(t + d + 0.3); vib.stop(t + d + 0.3); n.stop(t + d + 0.3);
  }

  brass(f, t, d, vel, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.005;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.08); lp.frequency.linearRampToValueAtTime(1200, t + d);
    const g = ctx.createGain();
    this.env(g, t, 0.04, 0.16 * vel, d, 0.1);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o2.start(t); o.stop(t + d + 0.2); o2.stop(t + d + 0.2);
  }

  bass(f, t, d, vel, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + d * 0.95);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o.stop(t + d);
  }

  drum(kind, t, vel, out) {
    const ctx = this.ctx;
    if (kind === 'big' || kind === 'frame' || kind === 'tom') {
      const o = ctx.createOscillator(); o.type = 'sine';
      const f0 = kind === 'big' ? 90 : kind === 'tom' ? 150 : 120;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime((kind === 'big' ? 0.7 : 0.4) * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'big' ? 0.6 : 0.3));
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.7);
    }
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 6000 : kind === 'frame' ? 900 : 400;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.05 : 0.12;
    g.gain.setValueAtTime((kind === 'hat' ? 0.25 : 0.2) * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.02);
  }

  drone(f, out, vol = 1) {
    const ctx = this.ctx;
    const nodes = [];
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lg = ctx.createGain(); lg.gain.value = 140;
    lfo.connect(lg); lg.connect(lp.frequency);
    const g = ctx.createGain(); g.gain.value = 0.06 * vol;
    lp.connect(g); g.connect(out);
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(); nodes.push(o);
    }
    lfo.start(); nodes.push(lfo);
    return nodes;
  }

  // ホーミー風の倍音唱法
  throat(out) {
    const ctx = this.ctx;
    const base = freq(38);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = base;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 18;
    const harm = [8, 9, 10, 12, 10, 9];
    const now = ctx.currentTime;
    for (let i = 0; i < 400; i++) bp.frequency.setTargetAtTime(base * harm[i % harm.length], now + i * 2.1, 0.3);
    const g = ctx.createGain(); g.gain.value = 0.12;
    o.connect(bp); bp.connect(g); g.connect(out);
    o.start();
    return [o];
  }

  // ---- 効果音 ----
  sfx(name) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, out = this.sfxBus;
    const tone = (f, dur, type = 'sine', v = 0.3, f2) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    };
    const noise = (dur, type, fq, v = 0.3, delay = 0) => {
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = fq;
      const g = ctx.createGain(); g.gain.setValueAtTime(v, t + delay); g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
      n.connect(f); f.connect(g); g.connect(out); n.start(t + delay); n.stop(t + delay + dur + 0.05);
    };
    switch (name) {
      case 'click': tone(900, 0.06, 'triangle', 0.15); break;
      case 'build': noise(0.08, 'bandpass', 700, 0.5); noise(0.08, 'bandpass', 600, 0.5, 0.14); tone(180, 0.12, 'sine', 0.3); break;
      case 'coin': tone(1300, 0.1, 'square', 0.08); setTimeout(() => this.ctx && tone(1750, 0.18, 'square', 0.08), 70); break;
      case 'clash': noise(0.18, 'highpass', 2500, 0.5); tone(1900, 0.25, 'triangle', 0.08, 1700); break;
      case 'arrow': noise(0.35, 'bandpass', 2500, 0.25); break;
      case 'rout': tone(220, 0.6, 'sawtooth', 0.12, 140); break;
      case 'turn': tone(110, 0.4, 'sine', 0.5, 60); noise(0.1, 'bandpass', 800, 0.2); break;
      case 'error': tone(140, 0.2, 'square', 0.1); break;
      case 'horn': tone(146, 0.9, 'sawtooth', 0.12, 150); break;
    }
  }

  jingle(kind) {
    if (!this.ctx) return;
    const s = kind === 'win' ? seq('D4:0.5 F4:0.5 A4:0.5 D5:2', 'brass', 1) : seq('A3:1 G3:1 F3:1 D3:3', 'fiddle', 1);
    const t = this.ctx.currentTime + 0.05;
    const spb = 60 / (kind === 'win' ? 150 : 90);
    for (const ev of s.events) this.note(ev, t + ev.t * spb, spb, this.sfxBus);
  }
}

export const audio = new AudioSystem();
