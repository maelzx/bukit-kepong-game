/* =============================================================================
   AUDIO — all sound is synthesised with the Web Audio API.
   No external or copyrighted audio assets are used.
   ========================================================================== */
'use strict';

const Audio2 = {
  ctx: null, master: null, muted: false, noise: null,
  listener: { x: 0, y: 0 },

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    // One reusable white-noise buffer for gunfire and impacts.
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.55; },
  toggle() { this.setMuted(!this.muted); return this.muted; },

  /** Volume falls off with distance from the camera/player. */
  _gainFor(x, y, base) {
    if (x === undefined) return base;
    const d = dist(x, y, this.listener.x, this.listener.y);
    return base * clamp(1 - d / 1100, 0.06, 1);
  },
  _pan(x) {
    if (x === undefined || !this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp((x - this.listener.x) / 620, -0.85, 0.85);
    return p;
  },
  _out(node, x) {
    const p = this._pan(x);
    if (p) { node.connect(p); p.connect(this.master); } else node.connect(this.master);
  },

  _burst({ dur = 0.12, freq = 1400, q = 1.1, gain = 0.4, type = 'lowpass', x, y, curve = 4 }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    const vol = this._gainFor(x, y, gain);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, freq / curve), t + dur);
    src.connect(f); f.connect(g); this._out(g, x);
    src.start(t); src.stop(t + dur + 0.02);
  },

  _tone({ f0 = 300, f1 = 80, dur = 0.15, gain = 0.25, type = 'sine', x, y, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(this._gainFor(x, y, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); this._out(g, x);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /* ------------------------------------------------------------- effects -- */
  playerShot(x, y) {                       // Sten gun — flat, tinny 9mm crack
    this._burst({ dur: 0.10, freq: 2600, gain: 0.34, x, y });
    this._tone({ f0: 240, f1: 60, dur: 0.10, gain: 0.20, type: 'square', x, y });
  },
  rifleShot(x, y) {                        // .303 bolt rifle — deeper report
    this._burst({ dur: 0.20, freq: 1700, gain: 0.30, x, y });
    this._tone({ f0: 180, f1: 44, dur: 0.22, gain: 0.22, type: 'triangle', x, y });
  },
  enemyShot(x, y) {
    this._burst({ dur: 0.16, freq: 1500, gain: 0.24, x, y });
    this._tone({ f0: 150, f1: 40, dur: 0.16, gain: 0.16, type: 'triangle', x, y });
  },
  dryFire() { this._burst({ dur: 0.04, freq: 4200, gain: 0.22, type: 'highpass' }); },
  reloadOut() { this._burst({ dur: 0.06, freq: 3000, gain: 0.20, type: 'highpass' }); this._tone({ f0: 420, f1: 200, dur: 0.06, gain: 0.10, type: 'square' }); },
  reloadIn() { this._burst({ dur: 0.07, freq: 2200, gain: 0.24, type: 'highpass' }); this._tone({ f0: 260, f1: 520, dur: 0.08, gain: 0.14, type: 'square' }); },
  hitFlesh(x, y) { this._burst({ dur: 0.09, freq: 700, gain: 0.30, x, y }); },
  hitWood(x, y) { this._burst({ dur: 0.07, freq: 1100, gain: 0.22, x, y }); },
  death(x, y) { this._tone({ f0: 200, f1: 55, dur: 0.4, gain: 0.20, type: 'sawtooth', x, y }); this._burst({ dur: 0.25, freq: 500, gain: 0.16, x, y }); },
  hurt() { this._tone({ f0: 320, f1: 90, dur: 0.28, gain: 0.30, type: 'sawtooth' }); this._burst({ dur: 0.2, freq: 420, gain: 0.24 }); },
  stationHit(x, y) { this._tone({ f0: 120, f1: 34, dur: 0.5, gain: 0.34, type: 'triangle', x, y }); this._burst({ dur: 0.3, freq: 380, gain: 0.22, x, y }); },
  explosion(x, y) { this._tone({ f0: 90, f1: 26, dur: 0.8, gain: 0.4, type: 'sine', x, y }); this._burst({ dur: 0.6, freq: 900, gain: 0.34, x, y, curve: 8 }); },
  click() { this._tone({ f0: 620, f1: 380, dur: 0.05, gain: 0.16, type: 'square' }); },
  waveHorn() {
    this._tone({ f0: 210, f1: 190, dur: 0.9, gain: 0.20, type: 'sawtooth' });
    this._tone({ f0: 158, f1: 148, dur: 1.1, gain: 0.16, type: 'triangle', delay: 0.12 });
  },
  victory() {
    [392, 523, 659, 784].forEach((f, i) =>
      this._tone({ f0: f, f1: f, dur: 0.42, gain: 0.20, type: 'triangle', delay: i * 0.19 }));
  },
  defeat() {
    [330, 262, 208, 156].forEach((f, i) =>
      this._tone({ f0: f, f1: f * 0.97, dur: 0.6, gain: 0.22, type: 'sawtooth', delay: i * 0.28 }));
  },
};
