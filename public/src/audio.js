/* =============================================================================
   AUDIO — every sound effect is synthesised with the Web Audio API. The night
   ambience bed is the one recorded asset; see assets/README.md, whose licence
   note is not decoration.

   The signal path is

       voice ── distance lowpass ── panner ─┬─────────────────► master
                                            └─ send ─ convolver ─┘

   and the master bus then runs through a muffle filter (for pause) and a
   compressor before the speakers. Two things in there matter more than the
   voices themselves: the convolver gives every shot a tail that bounces off
   the treeline, and the distance lowpass strips the highs out of far-off
   fire. A rifle 800 metres away is a thump, not a quiet crack — without that
   filter, distance only ever reads as "turned down".
   ========================================================================== */
'use strict';

const Audio2 = {
  ctx: null, master: null, muffle: null, comp: null,
  wetIn: null, muted: false, noise: null,
  listener: { x: 0, y: 0 },

  VOLUME: 0.55,
  MAX_VOICES: 28,          // a wave-5 firefight can ask for far more than this
  _active: [],             // end times of the voices currently sounding
  _last: Object.create(null),

  /* Ambience is levelled to a target RMS rather than played at whatever
     volume it arrived at, so swapping the file for a louder or quieter
     recording does not require retuning anything here. */
  AMBIENCE: 'assets/ambience-night.mp3',
  AMB_RMS: 0.030,
  AMB_XFADE: 2.0,          // seconds of overlap hiding the loop seam
  AMB_DUCK: 0.55,          // how far the bed drops under a full-strength wave
  amb: null, ambGain: null, ambSrc: null,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    // --- master chain ---------------------------------------------------
    // Twenty rifles firing at once sum well past full scale. The compressor
    // catches that and, as a side effect, glues the whole firefight together
    // the way a single microphone in the yard would have.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.20;
    this.comp.connect(this.ctx.destination);

    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = this.OPEN;
    this.muffle.connect(this.comp);

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.VOLUME;
    this.master.connect(this.muffle);

    // --- reverb ---------------------------------------------------------
    const verb = this.ctx.createConvolver();
    verb.buffer = this._buildImpulse(1.7, 2.4);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.9;
    verb.connect(wet); wet.connect(this.master);
    this.wetIn = this.ctx.createGain();
    this.wetIn.gain.value = 1;
    this.wetIn.connect(verb);

    // One reusable white-noise buffer for gunfire and impacts.
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // init() runs on the first gesture of any kind, which is the earliest
    // moment a browser will let the jungle start. Menus get it too.
    this.loadAmbience(this.AMBIENCE);
  },

  /**
   * A room is just a burst of noise that decays, so the impulse response can
   * be generated rather than loaded — which keeps the no-assets rule intact.
   * The one-pole filter that darkens as the tail decays is what stops it
   * sounding like a metal tank: real foliage and timber eat the high end of a
   * reflection long before they eat the low end.
   */
  _buildImpulse(seconds, decay) {
    const sr = this.ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const pre = Math.floor(sr * 0.012);            // a little air before the tail
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, peak = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / (n - pre);
        // Coefficient climbs with t, so the tail loses its highs as it fades.
        const k = 0.12 + t * 0.72;
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        const v = lp * Math.pow(1 - t, decay);
        d[i] = v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      // The filter costs level as k rises, and by an amount that depends on
      // the decay curve. Normalising means the wet gain below is the only
      // thing that sets how loud the room is.
      if (peak > 0) for (let i = pre; i < n; i++) d[i] /= peak;
    }
    return buf;
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.VOLUME; },
  toggle() { this.setMuted(!this.muted); return this.muted; },

  /* -------------------------------------------------------------- buses -- */
  OPEN: 20000, SHUT: 380,

  /** Pause drops the whole world behind glass. */
  setMuffled(on) {
    if (!this.muffle) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, t);
    this.muffle.frequency.exponentialRampToValueAtTime(on ? this.SHUT : this.OPEN, t + 0.18);
  },

  /** Volume falls off with distance from the camera/player. */
  _gainFor(x, y, base) {
    if (x === undefined) return base;
    const d = dist(x, y, this.listener.x, this.listener.y);
    return base * clamp(1 - d / 1100, 0.06, 1);
  },

  /** Air absorbs treble with distance long before it absorbs level. */
  _cutoffFor(x, y) {
    if (x === undefined) return this.OPEN;
    const d = dist(x, y, this.listener.x, this.listener.y);
    return clamp(this.OPEN * Math.pow(0.03, d / 1200), 500, this.OPEN);
  },

  _pan(x) {
    if (x === undefined || !this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp((x - this.listener.x) / 620, -0.85, 0.85);
    return p;
  },

  _out(node, x, y, wet = 0) {
    let n = node;
    if (x !== undefined) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = this._cutoffFor(x, y);
      n.connect(lp); n = lp;
    }
    const p = this._pan(x);
    if (p) { n.connect(p); n = p; }
    n.connect(this.master);
    if (wet > 0 && this.wetIn) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      n.connect(s); s.connect(this.wetIn);
    }
  },

  /**
   * Two guards against a heavy wave turning into a wall of mush. The tag
   * cooldown collapses the shots that land on the same frame — twelve rifles
   * firing within 30ms read as one volley to the ear anyway — and the voice
   * cap is the hard backstop. The player's own weapon is never throttled:
   * a trigger pull must always answer.
   */
  _throttle(tag, gap) {
    if (!this.ctx || this.muted) return false;
    const t = this.ctx.currentTime;
    if (this._last[tag] !== undefined && t - this._last[tag] < gap) return false;
    this._last[tag] = t;
    return true;
  },
  /**
   * Slots expire on a clock rather than on an 'ended' callback. The callback
   * is the obvious way to do this and it is the wrong one: a node started
   * with a timestamp already in the past does not reliably fire it, so a
   * handful of slots leak on every stutter and the cap slowly starves until
   * the game goes quiet. A voice whose stop time has passed is finished by
   * definition, so there is nothing to miss.
   */
  _claim(life) {
    const now = this.ctx.currentTime;
    const a = this._active;
    let k = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > now) a[k++] = a[i];
    a.length = k;
    if (k >= this.MAX_VOICES) return false;
    a.push(now + life);
    return true;
  },

  _burst({ dur = 0.12, freq = 1400, q = 1.1, gain = 0.4, type = 'lowpass', x, y, curve = 4, wet = 0 }) {
    if (!this.ctx || this.muted || !this._claim(dur + 0.05)) return;
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
    src.connect(f); f.connect(g); this._out(g, x, y, wet);
    src.start(t); src.stop(t + dur + 0.02);
  },

  _tone({ f0 = 300, f1 = 80, dur = 0.15, gain = 0.25, type = 'sine', x, y, delay = 0, wet = 0, vary = true }) {
    if (!this.ctx || this.muted || !this._claim(delay + dur + 0.05)) return;
    const t = this.ctx.currentTime + delay;
    // No two rounds out of the same barrel ring identically. _burst already
    // varies its noise; without this the tone body underneath stays fixed and
    // the repetition is what gives a synthesised weapon away.
    const k = vary ? 0.94 + Math.random() * 0.12 : 1;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f0 * k, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * k), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(this._gainFor(x, y, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); this._out(g, x, y, wet);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /* ------------------------------------------------------------ ambience -- */
  /**
   * The bed runs on its own gain so a wave can duck it, but it is otherwise
   * wired like everything else: through the master, so mute silences it and
   * pause puts it behind the same glass as the gunfire.
   *
   * Failure here is deliberately silent. Ambience is a nicety, and opening
   * index.html straight off the disk blocks the fetch — the game must still
   * play in that case, just without the jungle.
   */
  loadAmbience(url) {
    if (!this.ctx || this.ambSrc || this._ambLoading) return;
    this._ambLoading = true;
    fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then(b => new Promise((ok, no) => this.ctx.decodeAudioData(b, ok, no)))
      .then(buf => { this.amb = this._seamless(buf, this.AMB_XFADE); this._playAmbience(); })
      .catch(() => { this._ambLoading = false; });
  },

  /**
   * Turns a clip into a loop with no seam. Two things are wrong with looping
   * a downloaded field recording raw: it usually opens and closes on near
   * silence, so the bed gasps once a minute, and even trimmed, the join is a
   * waveform discontinuity that clicks. Trimming fixes the first. The second
   * needs the end of the clip mixed back over its own beginning, which is
   * what the equal-power crossfade below does — after it, the last sample of
   * the loop runs into the first as if the recording had never stopped.
   */
  _seamless(src, xfSec) {
    const sr = src.sampleRate, ch = src.numberOfChannels, n = src.length;
    const data = [];
    for (let c = 0; c < ch; c++) data.push(src.getChannelData(c));

    const TH = 0.002;
    const loud = i => { for (let c = 0; c < ch; c++) if (Math.abs(data[c][i]) > TH) return true; return false; };
    let s0 = 0, s1 = n - 1;
    while (s0 < n - 1 && !loud(s0)) s0++;
    while (s1 > s0 && !loud(s1)) s1--;

    const usable = s1 - s0 + 1;
    const xf = Math.max(1, Math.min(Math.floor(xfSec * sr), Math.floor(usable / 3)));
    const len = usable - xf;
    const out = this.ctx.createBuffer(ch, len, sr);

    for (let c = 0; c < ch; c++) {
      const d = data[c], o = out.getChannelData(c);
      for (let i = 0; i < len; i++) o[i] = d[s0 + i];
      // Fold the xf samples that follow the loop point back over the head.
      // sin/cos keep the summed power constant through the blend, where a
      // straight linear fade would dip in the middle.
      for (let j = 0; j < xf; j++) {
        const t = j / xf;
        o[j] = d[s0 + len + j] * Math.cos(t * Math.PI / 2) + o[j] * Math.sin(t * Math.PI / 2);
      }
    }
    this._normalise(out, this.AMB_RMS);
    return out;
  },

  /** Level by RMS, not peak: one loud bird should not push a whole bed down. */
  _normalise(buf, target) {
    let sum = 0, n = 0, peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { sum += d[i] * d[i]; if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]); }
      n += d.length;
    }
    const rms = Math.sqrt(sum / n);
    if (rms <= 0) return;
    const g = Math.min(target / rms, peak > 0 ? 0.9 / peak : 1);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
  },

  _playAmbience() {
    if (!this.amb || this.ambSrc) return;
    this.ambGain = this.ctx.createGain();
    this.ambGain.gain.value = 1;
    this.ambGain.connect(this.master);
    const src = this.ctx.createBufferSource();
    src.buffer = this.amb;
    src.loop = true;
    src.connect(this.ambGain);
    src.start(this.ctx.currentTime + 0.05);
    this.ambSrc = src;
  },

  /**
   * Duck the bed under a wave. Not for headroom — the compressor handles
   * that — but because insects go quiet when a firefight starts, and the
   * bed coming back up afterwards is what sells the lull between waves.
   */
  setCombat(intensity) {
    if (!this.ambGain) return;
    const target = 1 - this.AMB_DUCK * clamp(intensity, 0, 1);
    this.ambGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.7);
  },

  /* ------------------------------------------------------------- effects -- */
  playerShot(x, y) {                       // Sten gun — flat, tinny 9mm crack
    this._burst({ dur: 0.10, freq: 2600, gain: 0.34, x, y, wet: 0.5 });
    this._tone({ f0: 240, f1: 60, dur: 0.10, gain: 0.20, type: 'square', x, y, wet: 0.4 });
  },
  rifleShot(x, y) {                        // .303 bolt rifle — deeper report
    if (!this._throttle('rifle', 0.03)) return;
    this._burst({ dur: 0.20, freq: 1700, gain: 0.30, x, y, wet: 0.6 });
    this._tone({ f0: 180, f1: 44, dur: 0.22, gain: 0.22, type: 'triangle', x, y, wet: 0.5 });
  },
  enemyShot(x, y) {
    if (!this._throttle('enemy', 0.03)) return;
    this._burst({ dur: 0.16, freq: 1500, gain: 0.24, x, y, wet: 0.6 });
    this._tone({ f0: 150, f1: 40, dur: 0.16, gain: 0.16, type: 'triangle', x, y, wet: 0.5 });
  },
  /** A round going past your ear — the sound that makes cover feel necessary. */
  crackBy(x, y) {
    if (!this._throttle('crack', 0.05)) return;
    this._burst({ dur: 0.05, freq: 3200, q: 2.4, gain: 0.20, type: 'bandpass', curve: 6 });
    this._tone({ f0: 1800, f1: 520, dur: 0.07, gain: 0.09, type: 'sine' });
  },
  dryFire() { this._burst({ dur: 0.04, freq: 4200, gain: 0.22, type: 'highpass' }); },
  reloadOut() { this._burst({ dur: 0.06, freq: 3000, gain: 0.20, type: 'highpass' }); this._tone({ f0: 420, f1: 200, dur: 0.06, gain: 0.10, type: 'square' }); },
  reloadIn() { this._burst({ dur: 0.07, freq: 2200, gain: 0.24, type: 'highpass' }); this._tone({ f0: 260, f1: 520, dur: 0.08, gain: 0.14, type: 'square' }); },
  hitFlesh(x, y) { if (this._throttle('flesh', 0.04)) this._burst({ dur: 0.09, freq: 700, gain: 0.30, x, y, wet: 0.2 }); },
  hitWood(x, y) { if (this._throttle('wood', 0.04)) this._burst({ dur: 0.07, freq: 1100, gain: 0.22, x, y, wet: 0.3 }); },
  death(x, y) { this._tone({ f0: 200, f1: 55, dur: 0.4, gain: 0.20, type: 'sawtooth', x, y, wet: 0.3 }); this._burst({ dur: 0.25, freq: 500, gain: 0.16, x, y, wet: 0.3 }); },
  hurt() { this._tone({ f0: 320, f1: 90, dur: 0.28, gain: 0.30, type: 'sawtooth', wet: 0.15 }); this._burst({ dur: 0.2, freq: 420, gain: 0.24 }); },
  stationHit(x, y) { if (!this._throttle('station', 0.05)) return; this._tone({ f0: 120, f1: 34, dur: 0.5, gain: 0.34, type: 'triangle', x, y, wet: 0.4 }); this._burst({ dur: 0.3, freq: 380, gain: 0.22, x, y, wet: 0.4 }); },
  explosion(x, y) { this._tone({ f0: 90, f1: 26, dur: 0.8, gain: 0.4, type: 'sine', x, y, wet: 0.8 }); this._burst({ dur: 0.6, freq: 900, gain: 0.34, x, y, curve: 8, wet: 0.8 }); },
  click() { this._tone({ f0: 620, f1: 380, dur: 0.05, gain: 0.16, type: 'square', vary: false }); },
  waveHorn() {
    this._tone({ f0: 210, f1: 190, dur: 0.9, gain: 0.20, type: 'sawtooth', vary: false, wet: 0.5 });
    this._tone({ f0: 158, f1: 148, dur: 1.1, gain: 0.16, type: 'triangle', delay: 0.12, vary: false, wet: 0.5 });
  },
  victory() {
    [392, 523, 659, 784].forEach((f, i) =>
      this._tone({ f0: f, f1: f, dur: 0.42, gain: 0.20, type: 'triangle', delay: i * 0.19, vary: false, wet: 0.35 }));
  },
  defeat() {
    [330, 262, 208, 156].forEach((f, i) =>
      this._tone({ f0: f, f1: f * 0.97, dur: 0.6, gain: 0.22, type: 'sawtooth', delay: i * 0.28, vary: false, wet: 0.45 }));
  },
};
