/* =============================================================================
   DEV TOOL — not part of the game.
   Loads the game's source files in Node behind stub Canvas/DOM/Audio objects so
   the simulation can be run headlessly for balance testing. Rendering is never
   invoked; only the update step runs.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* --------------------------------- stubs -------------------------------- */
const noop = () => {};
function gradientStub() { return { addColorStop: noop }; }

function ctxStub() {
  const target = {
    canvas: null,
    createLinearGradient: gradientStub,
    createRadialGradient: gradientStub,
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * w * h) }),
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return noop;               // every other 2D context method is a no-op
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function canvasStub(w = 1400, h = 800) {
  const c = { width: w, height: h, style: {}, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
  c.getContext = () => ctxStub();
  return c;
}

function elStub(id) {
  const cls = new Set();
  const el = {
    id, style: {}, textContent: '', innerHTML: '', children: [],
    width: 176, height: 132,
    addEventListener: noop, click: noop, offsetWidth: 1,
    getContext: () => ctxStub(),
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : on; v ? cls.add(c) : cls.delete(c); return v; },
    },
  };
  el.parentElement = el;
  return el;
}

/* ------------------------------ environment ----------------------------- */
function makeEnv() {
  const els = Object.create(null);
  const document = {
    body: elStub('body'),
    hidden: false,
    createElement: tag => (tag === 'canvas' ? canvasStub() : elStub(tag)),
    getElementById: id => (els[id] ||= id === 'game' ? Object.assign(canvasStub(), { clientWidth: 1400, clientHeight: 800, classList: elStub(id).classList }) : elStub(id)),
    addEventListener: noop,
  };
  const sandbox = {
    document,
    console,
    performance: { now: () => Date.now() },
    requestAnimationFrame: noop,
    setTimeout, clearTimeout, setInterval, clearInterval,
    devicePixelRatio: 1,
    innerWidth: 1400, innerHeight: 800,
    addEventListener: noop, removeEventListener: noop,
    Math, JSON, Date, Object, Array, Number, String, Boolean, Error,
    Uint8ClampedArray, Float32Array,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

/** Load the game into a fresh sandbox and return it. */
function loadGame() {
  const sandbox = makeEnv();
  const ctx = vm.createContext(sandbox);
  const files = ['src/core.js', 'src/audio.js', 'src/world.js', 'src/fx.js', 'src/entities.js', 'src/ui.js', 'game.js'];
  for (const f of files) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  // const/class declarations live in the context's lexical scope, not on the
  // global object — re-export them so the harness can reach them.
  vm.runInContext(
    'globalThis.api = { CFG, Game, World, FX, Bullets, Input, UI, Audio2, ' +
    'Player, Police, Enemy, WEAPONS, dist, dist2, rand, chance, clamp };',
    ctx, { filename: 'export' });
  sandbox.api.Game.init();
  return sandbox.api;
}

module.exports = { loadGame };
