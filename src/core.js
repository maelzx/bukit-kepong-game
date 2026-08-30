/* =============================================================================
   CORE — configuration, maths helpers, input, camera, screen shake.
   Loaded as a classic script (no modules) so the game runs from file://
   ========================================================================== */
'use strict';

/* ------------------------------ Configuration ---------------------------- */
const CFG = {
  WORLD_W: 1920,
  WORLD_H: 1440,

  // Mission length in seconds. 6 minutes plays well as a prototype session;
  // raise to 600 for a full 10-minute assault.
  MISSION_DURATION: 300,
  PREP_TIME: 12,            // quiet countdown before the first attack

  PLAYER_SPEED: 148,        // px/s — deliberately not "twitch shooter" fast
  PLAYER_HP: 150,

  STATION_HP: 1800,
  POLICE_HP: 112,

  BULLET_MAX: 900,          // pooled
  PARTICLE_MAX: 1400,       // pooled

  // Ammunition crate on the station veranda — the section's reserve. Without
  // it a sustained defence simply runs dry, which reads as a dead end rather
  // than a decision. Restocking is deliberately a walk back to the building.
  CRATE_RADIUS: 46,         // how close you must stand to draw from it
  CRATE_START: 260,         // rounds in the crate at stand-to
  CRATE_PER_WAVE: 150,      // rounds brought up between assaults
  CRATE_CAP: 420,           // most the crate ever holds
  CRATE_RATE: 90,           // rounds per second transferred to your pouches
};

/* ------------------------------ Difficulty --------------------------------
   Two settings. RECRUIT exists so the game can be played for its actual
   decisions — where to stand, which threat to answer, when to leave the firing
   line for a fire — without demanding precise aim. It assists the shooting and
   eases the pressure; it does not play the game for you.
   -------------------------------------------------------------------------- */
const DIFFICULTIES = {
  easy: {
    key: 'easy', name: 'RECRUIT',
    blurb: 'Assisted aim and automatic fire. Fewer attackers, and you take less punishment.',
    autoAim: true, autoFire: true,
    playerHp: 190, damageTaken: 0.6, spread: 0.55,
    stationDamage: 0.7, maxAlive: 9, waveScale: 0.75,
  },
  normal: {
    key: 'normal', name: 'CONSTABLE',
    blurb: 'You aim and fire yourself. The section holds the compound on its own.',
    autoAim: false, autoFire: false,
    playerHp: 150, damageTaken: 1, spread: 1,
    stationDamage: 1, maxAlive: 12, waveScale: 1,
  },
};

/* --------------------------------- Maths --------------------------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[(Math.random() * arr.length) | 0];
const chance = p => Math.random() < p;

/** Shortest signed angular difference from a to b. */
function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function approachAngle(a, b, maxStep) {
  const d = angDiff(a, b);
  return a + clamp(d, -maxStep, maxStep);
}

/** Deterministic-ish seeded RNG so the map layout is identical every run. */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------- Geometry -------------------------------- */
/** Push a circle out of an axis-aligned rectangle. Mutates {x,y}. */
function resolveCircleRect(ent, r, rect) {
  const cx = clamp(ent.x, rect.x, rect.x + rect.w);
  const cy = clamp(ent.y, rect.y, rect.y + rect.h);
  let dx = ent.x - cx, dy = ent.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return false;

  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    ent.x = cx + (dx / d) * r;
    ent.y = cy + (dy / d) * r;
  } else {
    // Centre is inside the rect — eject along the shallowest axis.
    const left = ent.x - rect.x, right = rect.x + rect.w - ent.x;
    const top = ent.y - rect.y, bottom = rect.y + rect.h - ent.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) ent.x = rect.x - r;
    else if (m === right) ent.x = rect.x + rect.w + r;
    else if (m === top) ent.y = rect.y - r;
    else ent.y = rect.y + rect.h + r;
  }
  return true;
}

function resolveCircleCircle(ent, r, ox, oy, or_) {
  const dx = ent.x - ox, dy = ent.y - oy;
  const rr = r + or_;
  const d2 = dx * dx + dy * dy;
  if (d2 > rr * rr || d2 < 0.0001) return false;
  const d = Math.sqrt(d2);
  ent.x = ox + (dx / d) * rr;
  ent.y = oy + (dy / d) * rr;
  return true;
}

/** Segment (x1,y1)-(x2,y2) vs AABB. Slab method. */
function segRect(x1, y1, x2, y2, r) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/** Segment vs circle. */
function segCircle(x1, y1, x2, y2, cx, cy, cr) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = x1 + dx * t, py = y1 + dy * t;
  return dist2(px, py, cx, cy) <= cr * cr;
}

/* --------------------------------- Input --------------------------------- */
const Input = {
  keys: Object.create(null),
  pressed: Object.create(null),   // one-frame edge triggers
  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, clicked: false },

  init(canvas) {
    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (!this.keys[k]) this.pressed[k] = true;
      this.keys[k] = true;
      // Stop the page scrolling / quick-find behind the canvas.
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '/'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { this.keys = Object.create(null); this.mouse.down = false; });

    const setPos = e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width) / (window.devicePixelRatio || 1);
      this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height) / (window.devicePixelRatio || 1);
    };
    canvas.addEventListener('mousemove', setPos);
    canvas.addEventListener('mousedown', e => { setPos(e); if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; } });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  },

  down(...keys) { return keys.some(k => this.keys[k]); },
  hit(...keys) { return keys.some(k => this.pressed[k]); },
  endFrame() { this.pressed = Object.create(null); this.mouse.clicked = false; },
};

/* --------------------------------- Camera -------------------------------- */
class Camera {
  constructor() { this.x = 0; this.y = 0; this.shake = 0; this.ox = 0; this.oy = 0; }

  /** Follow a target with a gentle lead toward where the player is aiming. */
  follow(t, aimX, aimY, vw, vh, dt) {
    const leadX = clamp((aimX - t.x) * 0.16, -110, 110);
    const leadY = clamp((aimY - t.y) * 0.16, -110, 110);
    const gx = t.x + leadX, gy = t.y + leadY;
    const k = 1 - Math.pow(0.0022, dt);       // frame-rate independent smoothing
    this.x = lerp(this.x, gx - vw / 2, k);
    this.y = lerp(this.y, gy - vh / 2, k);
    this.x = clamp(this.x, 0, Math.max(0, CFG.WORLD_W - vw));
    this.y = clamp(this.y, 0, Math.max(0, CFG.WORLD_H - vh));

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 26);
      const s = this.shake;
      this.ox = rand(-s, s); this.oy = rand(-s, s);
    } else { this.ox = this.oy = 0; }
  }
  addShake(v) { this.shake = Math.min(26, this.shake + v); }
  get vx() { return this.x + this.ox; }
  get vy() { return this.y + this.oy; }
}
