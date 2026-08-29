/* =============================================================================
   BUKIT KEPONG — 23 FEBRUARY 1950
   Main game: state machine, wave director, simulation step and render pipeline.

   This is a dramatised interactive interpretation of a historical event.
   Map layout, wave structure and all statistics are gameplay abstractions.
   ========================================================================== */
'use strict';

/* --- Wave director table -------------------------------------------------
   Pressure is increased through numbers, attack directions and enemy mix —
   not by inflating hit points. --------------------------------------------- */
const WAVES = [
  { n: 5,  mix: { rifleman: 1.0 },                                dirs: ['n'],               tier: 0, gap: 13 },
  { n: 7,  mix: { rifleman: 0.85, rusher: 0.15 },                 dirs: ['n', 'e'],          tier: 0, gap: 12 },
  { n: 9,  mix: { rifleman: 0.70, rusher: 0.25, marksman: 0.05 }, dirs: ['n', 'e', 's'],     tier: 1, gap: 12 },
  { n: 11, mix: { rifleman: 0.60, rusher: 0.30, marksman: 0.10 }, dirs: ['e', 's', 'w'],     tier: 1, gap: 11 },
  { n: 13, mix: { rifleman: 0.55, rusher: 0.35, marksman: 0.10 }, dirs: ['n', 'e', 's', 'w'],tier: 2, gap: 11 },
  { n: 15, mix: { rifleman: 0.50, rusher: 0.40, marksman: 0.10 }, dirs: ['n', 's', 'w'],     tier: 2, gap: 10 },
  { n: 17, mix: { rifleman: 0.50, rusher: 0.40, marksman: 0.10 }, dirs: ['n', 'e', 's', 'w'],tier: 3, gap: 10 },
  { n: 22, mix: { rifleman: 0.45, rusher: 0.45, marksman: 0.10 }, dirs: ['n', 'e', 's', 'w'],tier: 3, gap: 9 },
];
const MAX_ALIVE = 26;          // concurrent hostiles — keeps 60 FPS comfortable

const CONSTABLE_NAMES = ['JAMIL', 'HASSAN', 'OTHMAN', 'MOHD YUSOF', 'ABU BAKAR', 'IBRAHIM'];

const Game = {
  state: 'title',            // title | playing | paused | over | win
  canvas: null, ctx: null, dpr: 1, zoom: 1,
  vw: 0, vh: 0,
  camera: null,
  player: null,
  police: [], enemies: [], defenders: [],
  fires: [],
  stationHp: CFG.STATION_HP,
  missionTime: CFG.MISSION_DURATION,
  elapsed: 0,
  waveIndex: 0, waveTimer: 0, spawnQueue: 0, spawnTimer: 0, waveGap: 0, waveActive: false,
  objectiveText: 'Hold the station until first light.',
  damageVignette: 0,
  time: 0,
  stats: { kills: 0, shots: 0, hits: 0, policeLost: 0, policeTotal: 0 },

  /* =============================================================== boot === */
  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lightCtx = this.light.getContext('2d');
    this.camera = new Camera();

    World.init();
    FX.init();
    Bullets.init();
    Input.init(this.canvas);

    UI.init({
      start: () => this.startRun(),
      resume: () => this.setPaused(false),
      menu: () => this.toMenu(),
      retry: () => this.startRun(),
    });

    addEventListener('resize', () => this.resize());
    this.resize();
    UI.show('title');

    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
  },

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.zoom = clamp(h / 720, 0.85, 1.8);
    this.vw = w / this.zoom;
    this.vh = h / this.zoom;
    this.light.width = Math.ceil(w / 2);
    this.light.height = Math.ceil(h / 2);
    this.ctx.imageSmoothingEnabled = true;
  },

  /* ============================================================== setup === */
  startRun() {
    Audio2.init(); Audio2.resume();
    World.reset();
    FX.clear();
    Bullets.clear();

    const S = World.station;
    this.player = new Player(S.x + S.w / 2, S.y + S.h + 70);
    this.police = [];
    // One constable behind each sandbag emplacement.
    World.sandbags.forEach((s, i) => {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const sx = S.x + S.w / 2, sy = S.y + S.h / 2;
      const a = Math.atan2(sy - cy, sx - cx);
      this.police.push(new Police(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26, CONSTABLE_NAMES[i % CONSTABLE_NAMES.length]));
    });
    this.defenders = [this.player, ...this.police];
    this.enemies = [];
    this.fires = [];

    this.stationHp = CFG.STATION_HP;
    this.missionTime = CFG.MISSION_DURATION;
    this.elapsed = 0;
    this.waveIndex = 0;
    this.waveActive = false;
    this.waveGap = CFG.PREP_TIME;
    this.spawnQueue = 0;
    this.damageVignette = 0;
    this.stats = { kills: 0, shots: 0, hits: 0, policeLost: 0, policeTotal: this.police.length };
    this.objectiveText = 'Stand to. Hostiles inbound.';

    this.camera.x = this.player.x - this.vw / 2;
    this.camera.y = this.player.y - this.vh / 2;

    this.state = 'playing';
    UI.hideAll();
    document.body.classList.add('in-game');
    UI.banner('BUKIT KEPONG', '23 FEBRUARY 1950 — 04:15', 3.4);
  },

  toMenu() {
    this.state = 'title';
    document.body.classList.remove('in-game');
    UI.show('title');
  },

  setPaused(p) {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.state = p ? 'paused' : 'playing';
    if (p) UI.show('pause'); else UI.hideAll();
    document.body.classList.add('in-game');
  },

  /* =============================================================== loop === */
  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    dt = Math.min(dt, 0.05);              // never simulate huge catch-up steps
    this.time += dt;

    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'paused' && Input.hit('escape', 'p')) this.setPaused(false);

    this.render();
    Input.endFrame();
    requestAnimationFrame(t => this.frame(t));
  },

  update(dt) {
    if (Input.hit('escape', 'p')) { this.setPaused(true); return; }

    if (Input.hit('m')) UI.el.mute.click();

    /* --- mouse into world space --- */
    Input.mouse.wx = this.camera.vx + Input.mouse.x / this.zoom;
    Input.mouse.wy = this.camera.vy + Input.mouse.y / this.zoom;
    Audio2.listener.x = this.player.x; Audio2.listener.y = this.player.y;

    this.elapsed += dt;
    this.missionTime -= dt;

    this.updateWaves(dt);

    this.player.update(dt, this);
    for (const p of this.police) p.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);

    this.separate();
    Bullets.update(dt, this);
    FX.update(dt);
    this.updateFires(dt);
    this.bakeCorpses();

    this.camera.follow(this.player, Input.mouse.wx, Input.mouse.wy, this.vw, this.vh, dt);
    this.damageVignette = Math.max(0, this.damageVignette - dt * 1.6);

    UI.update(this);

    if (this.missionTime <= 0) this.win();
  },

  /** Keeps bodies from stacking on the same pixel. */
  separate() {
    const all = this.enemies.concat(this.defenders);
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.alive) continue;
        const rr = a.radius + b.radius;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr * rr || d2 < 0.0001) continue;
        const d = Math.sqrt(d2), push = (rr - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        if (!a.isPlayer) { a.x -= nx * push; a.y -= ny * push; }
        if (!b.isPlayer) { b.x += nx * push; b.y += ny * push; }
        if (a.isPlayer) { b.x += nx * push * 2; b.y += ny * push * 2; }
        if (b.isPlayer) { a.x -= nx * push * 2; a.y -= ny * push * 2; }
      }
    }
  },

  /* ============================================================== waves === */
  updateWaves(dt) {
    const aliveCount = this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);

    if (!this.waveActive) {
      this.waveGap -= dt;
      this.objectiveText = this.waveIndex === 0
        ? `Take position. Contact in ${Math.max(0, Math.ceil(this.waveGap))}s.`
        : `Reload and hold. Next assault in ${Math.max(0, Math.ceil(this.waveGap))}s.`;
      if (this.waveGap <= 0) this.beginWave();
      return;
    }

    this.waveTimer += dt;
    this.objectiveText = 'DEFEND THE POLICE STATION.';

    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && aliveCount < MAX_ALIVE) {
        this.spawnTimer = this.wave.interval;
        this.spawnEnemy();
        this.spawnQueue--;
      }
    } else if (aliveCount <= 2 || this.waveTimer > 70) {
      this.endWave();
    }
  },

  beginWave() {
    this.waveIndex++;
    const base = WAVES[Math.min(this.waveIndex - 1, WAVES.length - 1)];
    const over = Math.max(0, this.waveIndex - WAVES.length);      // endless overtime waves
    this.wave = {
      ...base,
      n: base.n + over * 3,
      tier: Math.min(4, base.tier + over),
      interval: clamp(1.25 - this.waveIndex * 0.08, 0.45, 1.25),
    };
    this.spawnQueue = this.wave.n;
    this.spawnTimer = 0;
    this.waveTimer = 0;
    this.waveActive = true;

    // Constables patch themselves up between assaults.
    for (const p of this.police) if (p.alive) p.hp = Math.min(p.maxHp, p.hp + 28);

    Audio2.waveHorn();
    const from = this.wave.dirs.map(d => ({ n: 'NORTH', s: 'SOUTH', e: 'EAST', w: 'RIVERSIDE' }[d])).join(' & ');
    UI.banner(`WAVE ${this.waveIndex}`, `ATTACK FROM THE ${from}`, 2.8);
  },

  endWave() {
    this.waveActive = false;
    this.waveGap = this.wave.gap || 9;
    UI.banner('ASSAULT REPULSED', 'Reload. They will come again.', 2.4);
  },

  spawnEnemy() {
    const dir = pick(this.wave.dirs);
    let x, y;
    switch (dir) {
      case 'n': x = rand(280, 1720); y = rand(24, 96); break;
      case 's': x = rand(280, 1720); y = rand(CFG.WORLD_H - 96, CFG.WORLD_H - 24); break;
      case 'e': x = rand(CFG.WORLD_W - 110, CFG.WORLD_W - 26); y = rand(120, CFG.WORLD_H - 120); break;
      default:  x = rand(World.river.w + 34, World.river.w + 130); y = rand(120, CFG.WORLD_H - 120); break;
    }
    // Weighted pick from the wave's enemy mix.
    let r = Math.random(), type = 'rifleman';
    for (const k in this.wave.mix) { r -= this.wave.mix[k]; if (r <= 0) { type = k; break; } }

    const e = new Enemy(x, y, type, this.wave.tier);
    e.look = Math.atan2(World.station.y + 125 - y, World.station.x + 190 - x);
    this.enemies.push(e);
  },

  /* =========================================================== callbacks == */
  damageStation(dmg, x, y) {
    if (this.state !== 'playing') return;
    const before = this.stationHp;
    this.stationHp = Math.max(0, this.stationHp - dmg);
    if (x !== undefined) {
      FX.impact(x, y, rand(0, TAU), 'wood');
      if (chance(0.3)) FX.smoke(x, y, 1, '80,72,60');
    }
    this.camera.addShake(clamp(dmg * 0.14, 0.4, 4));

    // Structural fires start as the building is broken up.
    const ratio = this.stationHp / CFG.STATION_HP;
    if (ratio < 0.62 && this.fires.length < 6 && chance(0.05)) this.addFire();
    if (before > CFG.STATION_HP * 0.5 && this.stationHp <= CFG.STATION_HP * 0.5)
      UI.banner('THE STATION IS BURNING', 'Structural integrity 50%', 2.6);
    if (before > CFG.STATION_HP * 0.25 && this.stationHp <= CFG.STATION_HP * 0.25)
      UI.banner('THE ROOF IS GIVING WAY', 'Structural integrity 25%', 2.6);

    if (this.stationHp <= 0) this.lose('THE STATION HAS FALLEN');
  },

  addFire() {
    const S = World.station;
    this.fires.push({ x: S.x + rand(24, S.w - 24), y: S.y + rand(24, S.h - 24), t: rand(0, 6) });
    Audio2.explosion(S.x + S.w / 2, S.y + S.h / 2);
    FX.explosion(this.fires[this.fires.length - 1].x, this.fires[this.fires.length - 1].y, 40);
    this.camera.addShake(7);
  },

  updateFires(dt) {
    for (const f of this.fires) {
      f.t += dt;
      if (chance(dt * 22)) FX.embers(f.x, f.y, 1);
      if (chance(dt * 7)) FX.smoke(f.x, f.y, 1, '58,54,50');
    }
  },

  onEnemyDown(e) {
    this.stats.kills++;
    FX.text(e.x, e.y - 18, '✕', '#e8a45c', 15);
    this.camera.addShake(1.2);
  },

  onPoliceDown(p) {
    this.stats.policeLost++;
    UI.banner('CONSTABLE DOWN', `${p.name} has fallen`, 2.0);
    this.camera.addShake(3);
  },

  onPlayerDown() {
    this.lose('YOU HAVE FALLEN');
  },

  /** Turn finished death animations into permanent ground decals. */
  bakeCorpses() {
    const bake = list => {
      for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i];
        if (a.alive || a.dying > 0 || a.baked) continue;
        a.baked = true;
        const c = FX.decalCtx;
        c.save(); c.translate(a.x, a.y); c.rotate(a.look);
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath(); c.ellipse(3, 4, a.radius * 1.25, a.radius * 0.85, 0, 0, TAU); c.fill();
        c.fillStyle = a.palette.shirt;
        c.beginPath(); c.ellipse(0, 0, a.radius * 1.1, a.radius * 0.75, 0, 0, TAU); c.fill();
        c.fillStyle = a.palette.hat;
        c.beginPath(); c.arc(a.radius * 0.9, 0, a.radius * 0.46, 0, TAU); c.fill();
        c.restore();
        FX.splat(a.x, a.y, 16, 'rgba(64,12,10,0.35)');
        if (list === this.enemies) list.splice(i, 1);      // free the object
      }
    };
    bake(this.enemies);
    bake(this.police);
    if (!this.player.alive && this.player.dying <= 0) this.player.baked = true;
  },

  win() {
    if (this.state !== 'playing') return;
    this.state = 'win';
    Audio2.victory();
    UI.fillStats(this, UI.el.stats);
    UI.show('win');
  },

  lose(title) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    Audio2.defeat();
    document.getElementById('over-title').textContent = title;
    UI.fillStats(this, UI.el.overStats);
    setTimeout(() => { if (this.state === 'over') UI.show('over'); }, 900);
  },

  /* ============================================================= render === */
  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1109';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.state === 'title') { this.renderTitleBackdrop(); return; }

    const z = this.dpr * this.zoom;
    const cx = this.camera.vx, cy = this.camera.vy;
    ctx.setTransform(z, 0, 0, z, -cx * z, -cy * z);

    const view = { x: cx, y: cy, w: this.vw, h: this.vh };

    World.drawGround(ctx, view);
    FX.drawDecals(ctx, view);
    World.drawStructures(ctx, this.time, this.stationHp / CFG.STATION_HP);
    this.drawFires(ctx);

    /* --- actors, sorted back-to-front so overlap reads correctly --- */
    const actors = [];
    for (const e of this.enemies) if (e.alive || e.dying > 0) actors.push(e);
    for (const p of this.police) if (p.alive || p.dying > 0) actors.push(p);
    if (this.player.alive || this.player.dying > 0) actors.push(this.player);
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) drawFigure(ctx, a);
    this.drawHealthPips(ctx, actors);

    Bullets.draw(ctx);
    FX.draw(ctx, view);
    World.drawCanopies(ctx, this.time);
    this.drawLighting(ctx, view);
    FX.drawTexts(ctx);

    /* --- screen-space overlays --- */
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOffscreenMarkers(ctx);
    this.drawVignette(ctx);
  },

  drawFires(ctx) {
    for (const f of this.fires) {
      const s = 1 + Math.sin(this.time * 9 + f.t) * 0.18;
      const g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, 34 * s);
      g.addColorStop(0, 'rgba(255,210,120,0.85)');
      g.addColorStop(0.4, 'rgba(240,120,40,0.5)');
      g.addColorStop(1, 'rgba(120,40,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y, 34 * s, 0, TAU); ctx.fill();
    }
  },

  /** Small health pips above wounded actors — readable without clutter. */
  drawHealthPips(ctx, actors) {
    for (const a of actors) {
      if (!a.alive || a.hp >= a.maxHp) continue;
      const w = 22, h = 3, x = a.x - w / 2, y = a.y - a.radius - 12;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = a.faction === 'police' ? '#78c98d' : '#c9553f';
      ctx.fillRect(x, y, w * clamp(a.hp / a.maxHp, 0, 1), h);
    }
  },

  /** Night lighting: a darkness layer with lamps and flashes punched out. */
  drawLighting(ctx, view) {
    const l = this.lightCtx, L = this.light;
    const k = L.width / (this.vw);            // world → light-canvas scale
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.fillStyle = 'rgba(14,20,42,0.48)';
    l.fillRect(0, 0, L.width, L.height);
    l.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    l.globalCompositeOperation = 'destination-out';

    const punch = (x, y, r, a = 1) => {
      if (x < view.x - r || x > view.x + view.w + r || y < view.y - r || y > view.y + view.h + r) return;
      const g = l.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.55})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      l.fillStyle = g;
      l.beginPath(); l.arc(x, y, r, 0, TAU); l.fill();
    };

    const S = World.station;
    const C = World.compound;
    punch(C.x + C.w / 2, C.y + C.h / 2, 620, 0.34);      // moonlight over the compound
    punch(S.x + S.w / 2, S.y + S.h / 2, 360, 0.9);
    for (const p of World.props) if (p.kind === 'lamp') punch(p.x, p.y - 18, 200 + Math.sin(this.time * 7 + p.x) * 10, 0.95);
    for (const f of this.fires) punch(f.x, f.y, 150 + Math.sin(this.time * 8 + f.t) * 16, 0.95);
    if (this.player && this.player.alive) punch(this.player.x, this.player.y, 300, 0.7);
    for (const f of FX.flashes) punch(f.x, f.y, f.r * (f.life / f.max), 1);

    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(L, view.x, view.y, this.vw, this.vh);
  },

  /** Edge arrows pointing at hostiles outside the view. */
  drawOffscreenMarkers(ctx) {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const cx = w / 2, cy = h / 2;
    const m = 34;
    ctx.save();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const sx = (e.x - this.camera.vx) * this.zoom, sy = (e.y - this.camera.vy) * this.zoom;
      if (sx > -20 && sx < w + 20 && sy > -20 && sy < h + 20) continue;
      const a = Math.atan2(sy - cy, sx - cx);
      const px = cx + Math.cos(a) * (Math.min(cx, cy) - m);
      const py = cy + Math.sin(a) * (Math.min(cx, cy) - m);
      ctx.save();
      ctx.translate(px, py); ctx.rotate(a);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#c9553f';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 5); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  drawVignette(ctx) {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    if (!this._vig || this._vigW !== w || this._vigH !== h) {
      this._vigW = w; this._vigH = h;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.46)');
      this._vig = g;
    }
    ctx.fillStyle = this._vig;
    ctx.fillRect(0, 0, w, h);
    if (this.damageVignette > 0) {
      ctx.fillStyle = `rgba(150,20,16,${this.damageVignette * 0.28})`;
      ctx.fillRect(0, 0, w, h);
    }
  },

  /** Slowly drifting view of the compound behind the title screen. */
  renderTitleBackdrop() {
    const ctx = this.ctx;
    const z = this.dpr * this.zoom * 0.9;
    const t = this.time * 0.06;
    const cx = World.station.x - 240 + Math.sin(t) * 130;
    const cy = World.station.y - 160 + Math.cos(t * 0.8) * 90;
    ctx.setTransform(z, 0, 0, z, -cx * z, -cy * z);
    const view = { x: cx, y: cy, w: this.vw / 0.9, h: this.vh / 0.9 };
    World.drawGround(ctx, view);
    World.drawStructures(ctx, this.time, 1);
    World.drawCanopies(ctx, this.time);
    this.drawLighting(ctx, view);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawVignette(ctx);
  },
};

addEventListener('DOMContentLoaded', () => Game.init());
