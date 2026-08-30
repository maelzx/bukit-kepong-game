/* =============================================================================
   TOUCH — on-screen controls for phones and tablets.

   Twin-stick: the left thumb moves, the right thumb aims. Tapping to fire was
   rejected — this game asks you to move and shoot at the same time, and a tap
   carries no direction. Holding the aim stick fires, which is the convention
   every player already has in their hands.

   Both difficulties are playable here. RECRUIT still aims and fires for you,
   so its right thumb only steers which target the assist picks; CONSTABLE
   fires while the aim stick is held.

   Nothing in the rest of the game knows this file exists. It writes into the
   same Input.mouse / Input.moveVec that a mouse and keyboard write into.
   ========================================================================== */
'use strict';

const Touch = {
  active: false,           // true once we decide this is a touch device
  el: {},

  TRAVEL: 46,              // px of thumb travel for full deflection
  DEAD: 0.18,              // fraction of travel ignored around the centre
  AIM_REACH: 300,          // how far ahead of the player the aim point sits

  move: { id: null, ox: 0, oy: 0, dx: 0, dy: 0, mag: 0 },
  aim:  { id: null, ox: 0, oy: 0, dx: 0, dy: 0, mag: 0, held: false },
  lastAim: -Math.PI / 2,   // face the north gate before the first contact
  press: { space: false },
  reloadPending: false,

  /* --------------------------------------------------------------- setup -- */
  init(handlers) {
    // Guarded: the headless harness has no window to ask, and a device
    // without a coarse pointer never needs any of this.
    this.active = typeof matchMedia === 'function' &&
      (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    if (!this.active) return;

    const $ = id => document.getElementById(id);
    this.el = {
      layer: $('touch'),
      moveZone: $('tz-move'), aimZone: $('tz-aim'),
      moveStick: $('stick-move'), aimStick: $('stick-aim'),
      douse: $('tb-douse'), reload: $('tb-reload'), pause: $('tb-pause'),
    };
    document.body.classList.add('touch');

    // Held button: the fire-fighting action, which is a hold rather than a tap.
    const hold = (node, set) => {
      node.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); set(true); node.setPointerCapture(e.pointerId); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
        node.addEventListener(ev, e => { e.stopPropagation(); set(false); });
    };
    hold(this.el.douse, v => { this.press.space = v; });

    const tap = (node, fn) => node.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); fn();
    });
    tap(this.el.reload, () => { this.reloadPending = true; });
    tap(this.el.pause, () => handlers.pause());

    addEventListener('pointerdown', e => this.onDown(e));
    addEventListener('pointermove', e => this.onMove(e), { passive: false });
    for (const ev of ['pointerup', 'pointercancel'])
      addEventListener(ev, e => this.onUp(e));
  },

  isTouch(e) { return e.pointerType === 'touch' || e.pointerType === 'pen'; },

  onDown(e) {
    if (!this.active || !this.isTouch(e)) return;
    // Only claim the screen while a mission is actually being played; menus
    // and end-of-mission panels need ordinary taps.
    if (!document.body.classList.contains('playing')) return;

    const s = e.clientX < innerWidth * 0.45 ? this.move : this.aim;
    if (s.id !== null) return;                 // that thumb is already down
    s.id = e.pointerId;
    s.ox = e.clientX; s.oy = e.clientY;
    s.dx = 0; s.dy = 0; s.mag = 0;
    if (s === this.aim) this.aim.held = true;
    this.placeStick(s);
  },

  onMove(e) {
    if (!this.active || !this.isTouch(e)) return;
    const s = this.move.id === e.pointerId ? this.move
            : this.aim.id === e.pointerId ? this.aim : null;
    if (!s) return;
    e.preventDefault();

    let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.TRAVEL) {
      // Drag the base along with the thumb, so a long swipe never runs out of
      // stick — the same thing a physical thumbstick does when you lean on it.
      s.ox += dx * (1 - this.TRAVEL / d);
      s.oy += dy * (1 - this.TRAVEL / d);
      dx *= this.TRAVEL / d; dy *= this.TRAVEL / d;
    }
    s.dx = dx; s.dy = dy;
    s.mag = Math.min(1, Math.hypot(dx, dy) / this.TRAVEL);
    this.placeStick(s);
  },

  onUp(e) {
    if (!this.active) return;
    for (const s of [this.move, this.aim]) {
      if (s.id !== e.pointerId) continue;
      s.id = null; s.dx = 0; s.dy = 0; s.mag = 0;
      if (s === this.aim) this.aim.held = false;
      this.placeStick(s);
    }
  },

  placeStick(s) {
    const isMove = s === this.move;
    const base = isMove ? this.el.moveStick : this.el.aimStick;
    if (!base) return;
    if (s.id === null) { base.classList.remove('on'); return; }
    base.classList.add('on');
    base.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    base.firstElementChild.style.transform = `translate(${s.dx}px, ${s.dy}px)`;
  },

  /** Drops every thumb — used when the mission ends or the game is paused. */
  release() {
    for (const s of [this.move, this.aim]) { s.id = null; s.dx = s.dy = 0; s.mag = 0; this.placeStick(s); }
    this.aim.held = false;
    this.press.space = false;
    Input.moveVec = null;
    // update() is what normally mirrors this into Input, and it does not run
    // while the game is paused — so clear the key here or it stays stuck down.
    Input.keys[' '] = false;
  },

  /**
   * Feeds the sticks into the same inputs a mouse and keyboard drive. Called
   * once per simulation step, before anything reads them.
   */
  update(game) {
    if (!this.active) return;
    const p = game.player;

    /* --- movement: analogue, so a small lean is a careful step ------------ */
    Input.moveVec = this.move.mag > this.DEAD
      ? { x: this.move.dx, y: this.move.dy, mag: this.move.mag }
      : null;

    /* --- aim: the stick sets a heading, which is held when the thumb lifts */
    if (this.aim.mag > this.DEAD) this.lastAim = Math.atan2(this.aim.dy, this.aim.dx);
    Input.aimActive = this.aim.held;

    // Express the heading as a screen-space cursor: the game already turns
    // that into a world point, a camera lead and a reticle.
    const px = (p.x - game.camera.vx) * game.zoom;
    const py = (p.y - game.camera.vy) * game.zoom;
    const reach = this.AIM_REACH * game.zoom;
    Input.mouse.x = px + Math.cos(this.lastAim) * reach;
    Input.mouse.y = py + Math.sin(this.lastAim) * reach;

    // On RECRUIT the assist pulls the trigger, and holding the stick down as
    // well would defeat its burst discipline and empty the pouches.
    Input.mouse.down = this.aim.held && !game.difficulty.autoFire;

    /* --- buttons --------------------------------------------------------- */
    Input.keys[' '] = this.press.space;
    if (this.reloadPending) { Input.pressed['r'] = true; this.reloadPending = false; }

    // The fire-fighting button only lights up when there is a fire to reach.
    const near = game.fires.some(f => dist2(p.x, p.y, f.x, f.y) < 72 * 72);
    this.el.douse.classList.toggle('live', near);
  },
};
