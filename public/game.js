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
  { n: 4,  mix: { rifleman: 1.0 },                                dirs: ['n'],               tier: 0, gap: 9 },
  { n: 5,  mix: { rifleman: 0.85, rusher: 0.15 },                 dirs: ['n', 'e'],          tier: 0, gap: 8 },
  { n: 6,  mix: { rifleman: 0.70, rusher: 0.25, marksman: 0.05 }, dirs: ['n', 'e', 's'],     tier: 1, gap: 8 },
  { n: 7, mix: { rifleman: 0.60, rusher: 0.30, marksman: 0.10 }, dirs: ['e', 's', 'w'],     tier: 1, gap: 7 },
  { n: 8, mix: { rifleman: 0.55, rusher: 0.35, marksman: 0.10 }, dirs: ['n', 'e', 's', 'w'],tier: 2, gap: 7 },
  { n: 9, mix: { rifleman: 0.50, rusher: 0.40, marksman: 0.10 }, dirs: ['n', 's', 'w'],     tier: 2, gap: 6 },
  { n: 10, mix: { rifleman: 0.50, rusher: 0.40, marksman: 0.10 }, dirs: ['n', 'e', 's', 'w'],tier: 3, gap: 6 },
  { n: 12, mix: { rifleman: 0.45, rusher: 0.45, marksman: 0.10 }, dirs: ['n', 'e', 's', 'w'],tier: 3, gap: 8 },
];

const CONSTABLE_NAMES = ['JAMIL', 'HASSAN', 'OTHMAN', 'MOHD YUSOF', 'ABU BAKAR', 'IBRAHIM'];

const Game = {
  state: 'title',            // title | playing | paused | over | win
  difficulty: DIFFICULTIES.normal,
  canvas: null, ctx: null, dpr: 1, zoom: 1,
  vw: 0, vh: 0,
  camera: null,
  player: null,
  police: [], enemies: [], defenders: [],
  fires: [],
  ammoCrate: { x: 0, y: 0, stock: 0, draw: 0, acc: 0 },   // the section's ammunition reserve
  stationHp: CFG.STATION_HP,
  missionTime: CFG.MISSION_DURATION,
  elapsed: 0,
  waveIndex: 0, waveTimer: 0, spawnQueue: 0, spawnTimer: 0, waveGap: 0, waveActive: false,
  objectiveText: 'Hold the station until first light.',
  damageVignette: 0,
  time: 0,
  hitMarker: 0, hitMarkerKill: false,
  damageArcs: [],            // {ang, life} — where incoming fire came from
  mist: [], fireflies: [],
  stats: { kills: 0, shots: 0, hits: 0, policeLost: 0, policeTotal: 0, firesOut: 0, roundsDrawn: 0 },
  score: null,              // after-action assessment, filled when the mission ends

  /* =============================================================== boot === */
  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lightCtx = this.light.getContext('2d');
    this.camera = new Camera();

    World.init();
    FX.init();
    this.initAmbient();
    Bullets.init();
    Input.init(this.canvas);

    UI.init({
      start: () => this.startRun(),
      setDifficulty: key => { this.difficulty = DIFFICULTIES[key] || DIFFICULTIES.normal; },
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
    this.zoom = clamp(h / 900, 0.78, 1.55);
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
    this.player = new Player(S.x + S.w / 2, S.y + S.h + 70, this.difficulty.playerHp);
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

    // Ammunition crate on the veranda, between the station and the south
    // sandbags — close enough to reach under fire, far enough that topping up
    // costs you your firing position.
    this.ammoCrate = { x: S.x + 46, y: S.y + S.h + 26, stock: CFG.CRATE_START, draw: 0, acc: 0 };

    this.stationHp = CFG.STATION_HP;
    this.missionTime = CFG.MISSION_DURATION;
    this.elapsed = 0;
    this.waveIndex = 0;
    this.waveActive = false;
    this.waveGap = CFG.PREP_TIME;
    this.spawnQueue = 0;
    this.damageVignette = 0;
    this.damageArcs.length = 0;
    this.hitMarker = 0;
    this.stats = {
      kills: 0, shots: 0, hits: 0, policeLost: 0, policeTotal: this.police.length,
      firesOut: 0, roundsDrawn: 0,
    };
    this.score = null;
    this.objectiveText = 'Stand to. Hostiles inbound.';

    this.camera.x = this.player.x - this.vw / 2;
    this.camera.y = this.player.y - this.vh / 2;

    this.state = 'playing';
    UI.resetCaches();
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

  /* ----------------------------------------------------------- ambience -- */
  /** Low drifting river mist and fireflies — cheap, fixed-size, no pooling. */
  initAmbient() {
    const rng = makeRng(77);
    this.mist = [];
    for (let i = 0; i < 22; i++) {
      this.mist.push({
        x: rng() * CFG.WORLD_W, y: rng() * CFG.WORLD_H,
        r: 120 + rng() * 220, a: 0.03 + rng() * 0.05,
        vx: 6 + rng() * 12, vy: (rng() - 0.5) * 5,
      });
    }
    this.fireflies = [];
    for (let i = 0; i < 40; i++) {
      this.fireflies.push({
        x: rng() * CFG.WORLD_W, y: rng() * CFG.WORLD_H,
        p: rng() * TAU, sp: 0.6 + rng() * 1.2, r: 26 + rng() * 60,
        ox: rng() * CFG.WORLD_W, oy: rng() * CFG.WORLD_H,
      });
    }
  },

  updateAmbient(dt) {
    for (const m of this.mist) {
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x - m.r > CFG.WORLD_W) m.x = -m.r;
      if (m.y - m.r > CFG.WORLD_H) m.y = -m.r;
      if (m.y + m.r < 0) m.y = CFG.WORLD_H + m.r;
    }
    for (const f of this.fireflies) f.p += f.sp * dt;
  },

  drawMist(ctx, view) {
    ctx.save();
    for (const m of this.mist) {
      if (m.x + m.r < view.x || m.x - m.r > view.x + view.w) continue;
      if (m.y + m.r < view.y || m.y - m.r > view.y + view.h) continue;
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
      g.addColorStop(0, `rgba(186,196,204,${m.a})`);
      g.addColorStop(1, 'rgba(186,196,204,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },

  drawFireflies(ctx, view) {
    ctx.save();
    ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(200,255,140,0.9)';
    for (const f of this.fireflies) {
      const x = f.ox + Math.cos(f.p) * f.r, y = f.oy + Math.sin(f.p * 0.7) * f.r * 0.6;
      if (x < view.x || x > view.x + view.w || y < view.y || y > view.y + view.h) continue;
      if (World.inCompound(x, y)) continue;
      ctx.globalAlpha = 0.35 + Math.sin(f.p * 3) * 0.3;
      ctx.fillStyle = '#cdf07a';
      ctx.beginPath(); ctx.arc(x, y, 1.7, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },

  /** Record the bearing of an incoming hit for the on-screen arc indicator. */
  addDamageArc(ang) {
    this.damageArcs.push({ ang, life: 1.3 });
    if (this.damageArcs.length > 8) this.damageArcs.shift();
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
    this.updateAmbient(dt);
    for (let i = this.damageArcs.length - 1; i >= 0; i--) {
      this.damageArcs[i].life -= dt;
      if (this.damageArcs[i].life <= 0) this.damageArcs.splice(i, 1);
    }
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.updateFires(dt);
    this.updateAmmoCrate(dt);
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
      const secs = Math.max(0, Math.ceil(this.waveGap));
      this.objectiveText = this.waveIndex === 0
        ? `Take position. Contact in ${secs}s.`
        : this.lowOnAmmo()
          ? `Draw ammunition at the station. Next assault in ${secs}s.`
          : `Reload and hold. Next assault in ${secs}s.`;
      if (this.waveGap <= 0) this.beginWave();
      return;
    }

    this.waveTimer += dt;
    this.objectiveText = this.fires.length
      ? 'THE STATION IS ALIGHT — hold SPACE at the flames.'
      : this.lowOnAmmo()
        ? 'AMMUNITION LOW — draw from the crate at the station.'
        : 'DEFEND THE POLICE STATION.';

    if (this.spawnQueue > 0 && aliveCount < this.difficulty.maxAlive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.wave.interval;
        this.spawnEnemy();
        this.spawnQueue--;
      }
    }

    // Move on once the wave is broken, or after a hard cap so the assault keeps
    // escalating even when attackers hang back — or when the hostile cap has
    // blocked the rest of the wave from spawning at all.
    const spent = this.spawnQueue === 0;
    if ((spent && (aliveCount <= 3 || this.waveTimer > 30)) || this.waveTimer > 44) {
      this.endWave();
    }
  },

  beginWave() {
    this.waveIndex++;
    const base = WAVES[Math.min(this.waveIndex - 1, WAVES.length - 1)];
    const over = Math.max(0, this.waveIndex - WAVES.length);      // endless overtime waves
    this.wave = {
      ...base,
      n: Math.max(2, Math.round((base.n + over * 3) * this.difficulty.waveScale)),
      tier: Math.min(4, base.tier + over),
      interval: clamp(1.15 - this.waveIndex * 0.09, 0.35, 1.15),
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
    // The lull is when a fresh box is broken open and carried to the veranda.
    const c = this.ammoCrate;
    const before = c.stock;
    c.stock = Math.min(CFG.CRATE_CAP, c.stock + CFG.CRATE_PER_WAVE);
    UI.banner('ASSAULT REPULSED', c.stock > before
      ? 'Ammunition up at the station. Draw what you need.'
      : 'Reload. They will come again.', 2.4);
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
    this.stationHp = Math.max(0, this.stationHp - dmg * this.difficulty.stationDamage);
    if (x !== undefined) {
      FX.impact(x, y, rand(0, TAU), 'wood');
      if (chance(0.3)) FX.smoke(x, y, 1, '80,72,60');
    }
    this.camera.addShake(clamp(dmg * 0.14, 0.4, 4));

    // Structural fires start as the building is broken up.
    const ratio = this.stationHp / CFG.STATION_HP;
    if (ratio < 0.55 && this.fires.length < 4 && chance(0.035)) this.addFire();
    if (before > CFG.STATION_HP * 0.5 && this.stationHp <= CFG.STATION_HP * 0.5)
      UI.banner('THE STATION IS BURNING', 'Structural integrity 50%', 2.6);
    if (before > CFG.STATION_HP * 0.25 && this.stationHp <= CFG.STATION_HP * 0.25)
      UI.banner('THE ROOF IS GIVING WAY', 'Structural integrity 25%', 2.6);

    if (this.stationHp <= 0) this.lose('THE STATION HAS FALLEN');
  },

  /**
   * Start a structural fire. Fires are always seated against the building's
   * outer wall — that is where an attacker would set the attap alight, and it
   * is also the only place the player can physically reach to beat them out,
   * since the station itself is solid.
   */
  addFire(x, y) {
    if (this.fires.length >= 3) return;
    const S = World.station;
    const INSET = 14;
    let fx = clamp(x ?? S.x + rand(20, S.w - 20), S.x + INSET, S.x + S.w - INSET);
    let fy = clamp(y ?? S.y + rand(20, S.h - 20), S.y + INSET, S.y + S.h - INSET);

    // Snap to the nearest wall.
    const dl = fx - S.x, dr = S.x + S.w - fx, dt = fy - S.y, db = S.y + S.h - fy;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) fx = S.x + INSET;
    else if (m === dr) fx = S.x + S.w - INSET;
    else if (m === dt) fy = S.y + INSET;
    else fy = S.y + S.h - INSET;

    this.fires.push({ x: fx, y: fy, t: rand(0, 6), power: 1, fought: false });
    Audio2.explosion(fx, fy);
    FX.explosion(fx, fy, 40);
    this.camera.addShake(7);
    UI.banner('FIRE IN THE STATION', 'The attap is alight', 2.2);
  },

  /**
   * Fires burn the station down on a timer. The player can beat them out by
   * standing at the flames and holding SPACE — the one job that pulls you off
   * the firing line, which is where most of this game's tension comes from.
   */
  updateFires(dt) {
    const p = this.player;
    const fighting = p.alive && Input.down(' ', 'spacebar');
    this.fightingFire = false;

    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      this.stationHp = Math.max(0, this.stationHp - 1.2 * f.power * dt);

      if (fighting && dist2(p.x, p.y, f.x, f.y) < 72 * 72) {
        f.power -= dt * 0.62;
        f.fought = true;
        this.fightingFire = true;
        for (let k = 0; k < 2; k++)                     // steam and thrown water
          FX.spawn(f.x + rand(-14, 14), f.y + rand(-14, 14), rand(-30, 30), rand(-70, -20),
            { life: rand(0.4, 0.9), size: rand(4, 9), color: '196,206,210', drag: 1.4, grow: 26, fade: 0.4 });
      } else {
        f.power -= dt * 0.006;                          // burns itself down slowly
      }

      if (f.power <= 0) {
        if (f.fought) this.stats.firesOut++;
        this.fires.splice(i, 1);
        FX.smoke(f.x, f.y, 4, '150,156,158');
        UI.banner('FIRE OUT', 'Back to your post', 1.8);
        continue;
      }
      if (chance(dt * 22 * f.power)) FX.embers(f.x, f.y, 1);
      if (chance(dt * 7)) FX.smoke(f.x, f.y, 1, '58,54,50');
    }
    if (this.fires.length && this.stationHp <= 0) this.lose('THE STATION HAS FALLEN');
  },

  /** True once the player is down to roughly two magazines in reserve. */
  lowOnAmmo() {
    const p = this.player;
    return !!p && p.alive && p.reserve < p.weapon.mag * 2 && this.ammoCrate.stock > 0;
  },

  /**
   * Drawing from the ammunition crate. Standing at it refills your pouches
   * from the section's stock; the stock itself is finite and is only made up
   * between assaults, so ammunition stays a thing you spend rather than a
   * resource that quietly refills itself.
   */
  updateAmmoCrate(dt) {
    const c = this.ammoCrate, p = this.player;
    c.draw = Math.max(0, c.draw - dt * 3);
    if (!p.alive || c.stock <= 0) return;

    const need = p.weapon.reserve - p.reserve;
    if (need <= 0) return;
    if (dist2(p.x, p.y, c.x, c.y) > CFG.CRATE_RADIUS * CFG.CRATE_RADIUS) return;

    c.draw = 1;
    // Rounds move whole, never in fractions of a bullet.
    c.acc += CFG.CRATE_RATE * dt;
    const take = Math.min(need, c.stock, Math.floor(c.acc));
    if (take <= 0) return;
    c.acc -= take;
    p.reserve += take;
    c.stock -= take;
    this.stats.roundsDrawn += take;
    if (p.ammo === 0 && p.reloading <= 0) p.startReload();
    if (chance(dt * 26)) FX.spawn(c.x + rand(-10, 10), c.y - 6, rand(-18, 18), rand(-40, -14),
      { life: 0.4, size: 2.6, color: '214,186,120', drag: 2, fade: 0.5 });
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
    this.finishScore();
    UI.fillStats(this, UI.el.stats, UI.el.winScore);
    UI.show('win');
  },

  /** Grade the run and remember it if it is the player's best on this setting. */
  finishScore() {
    this.score = Score.compute(this);
    this.score.best = Score.best(this.difficulty);
    this.score.isBest = Score.record(this.difficulty, this.score.total);
  },

  lose(title) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    Audio2.defeat();
    document.getElementById('over-title').textContent = title;
    this.finishScore();
    UI.fillStats(this, UI.el.overStats, UI.el.overScore);
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
    this.drawAmmoCrate(ctx);
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
    this.drawMist(ctx, view);
    this.drawLighting(ctx, view);
    this.drawFireflies(ctx, view);
    FX.drawTexts(ctx);

    /* --- screen-space overlays --- */
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOffscreenMarkers(ctx);
    this.drawVignette(ctx);
    this.drawDamageArcs(ctx);
    this.drawCrosshair(ctx);
  },

  /** Reticle whose gap tracks the weapon's current cone of fire. */
  drawCrosshair(ctx) {
    if (this.state !== 'playing') return;
    const p = this.player;
    const lock = p.lockTarget && p.lockTarget.alive ? p.lockTarget : null;

    // With aim assist on, the reticle sits on the target the player's weapon is
    // actually tracking, and a faint dot stays under the mouse so the player can
    // still see that they are steering which target gets picked.
    let mx = Input.mouse.x, my = Input.mouse.y;
    if (lock) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = 'rgba(232,220,192,0.9)';
      ctx.beginPath(); ctx.arc(mx, my, 2, 0, TAU); ctx.fill();
      ctx.restore();
      mx = (lock.x - this.camera.vx) * this.zoom;
      my = (lock.y - this.camera.vy) * this.zoom;
    }
    const spread = p.weapon.spread * (p.moving ? 1.7 : 1) * (1 + p.heat * 0.9) * this.difficulty.spread;
    const gap = 7 + spread * 260 + (p.reloading > 0 ? 10 : 0);
    const len = 7;

    // Red when the reticle is over a hostile
    let hot = !!lock;
    if (!hot) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (dist2(e.x, e.y, Input.mouse.wx, Input.mouse.wy) < (e.radius + 8) ** 2) { hot = true; break; }
      }
    }
    ctx.save();
    ctx.translate(mx, my);
    ctx.lineCap = 'round';
    ctx.strokeStyle = hot ? 'rgba(224,110,80,0.95)' : 'rgba(232,220,192,0.75)';
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 4; ctx.shadowColor = 'rgba(0,0,0,0.9)';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * gap, Math.sin(a) * gap);
      ctx.lineTo(Math.cos(a) * (gap + len), Math.sin(a) * (gap + len));
      ctx.stroke();
    }
    ctx.fillStyle = hot ? 'rgba(224,110,80,0.9)' : 'rgba(232,220,192,0.55)';
    ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, TAU); ctx.fill();

    // Lock-on brackets, so assisted aim never looks like the game firing itself
    if (lock) {
      const r = 15 + Math.sin(this.time * 9) * 1.4;
      ctx.strokeStyle = 'rgba(224,110,80,0.9)';
      ctx.lineWidth = 1.8;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        const bx = Math.cos(a) * r, by = Math.sin(a) * r;
        ctx.beginPath();
        ctx.moveTo(bx - Math.cos(a) * 5, by - Math.sin(a) * 5);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    // Hit marker
    if (this.hitMarker > 0) {
      const a = clamp(this.hitMarker / 0.22, 0, 1);
      ctx.globalAlpha = a;
      ctx.strokeStyle = this.hitMarkerKill ? '#e8a45c' : '#f2eada';
      ctx.lineWidth = 2;
      const g2 = gap * 0.55, l2 = 6 * (2 - a);
      for (let i = 0; i < 4; i++) {
        const ang = Math.PI / 4 + i * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * g2, Math.sin(ang) * g2);
        ctx.lineTo(Math.cos(ang) * (g2 + l2), Math.sin(ang) * (g2 + l2));
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  /** Arcs at the screen edge showing where the player is being shot from. */
  drawDamageArcs(ctx) {
    if (!this.damageArcs.length) return;
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.36;
    ctx.save();
    ctx.translate(cx, cy);
    for (const d of this.damageArcs) {
      const a = clamp(d.life / 1.3, 0, 1);
      ctx.globalAlpha = a * 0.7;
      const g = ctx.createRadialGradient(0, 0, r, 0, 0, r + 90);
      g.addColorStop(0, 'rgba(190,40,28,0)');
      g.addColorStop(1, 'rgba(190,40,28,0.85)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r + 90, d.ang - 0.42, d.ang + 0.42);
      ctx.arc(0, 0, r, d.ang + 0.42, d.ang - 0.42, true);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },

  /**
   * A wooden ammunition box on the veranda. It pulses while you have room in
   * your pouches and there is stock left, so it reads as somewhere to go
   * without needing an icon bolted over the world.
   */
  drawAmmoCrate(ctx) {
    const c = this.ammoCrate, p = this.player;
    const W = 34, H = 20;
    const empty = c.stock <= 0;
    const wanted = !empty && p && p.alive && p.reserve < p.weapon.reserve;

    if (wanted) {
      const pulse = 0.5 + Math.sin(this.time * 4) * 0.5;
      const r = CFG.CRATE_RADIUS * (0.9 + pulse * 0.12);
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.55, c.x, c.y, r);
      g.addColorStop(0, 'rgba(214,186,120,0)');
      g.addColorStop(1, `rgba(214,186,120,${0.10 + pulse * 0.10 + c.draw * 0.16})`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.fill();
    }

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(2, H * 0.42, W * 0.58, H * 0.34, 0, 0, TAU); ctx.fill();

    ctx.fillStyle = empty ? '#4a412e' : '#6b5732';           // crate body
    ctx.fillRect(-W / 2, -H / 2, W, H);
    ctx.fillStyle = empty ? '#5a4f39' : '#846b3e';           // lid
    ctx.fillRect(-W / 2, -H / 2 - 4, W, 6);
    ctx.strokeStyle = 'rgba(30,24,16,0.75)'; ctx.lineWidth = 1.4;
    ctx.strokeRect(-W / 2, -H / 2 - 4, W, H + 4);
    ctx.strokeStyle = 'rgba(40,32,20,0.6)';                  // banding
    ctx.beginPath();
    ctx.moveTo(-W / 2 + 7, -H / 2); ctx.lineTo(-W / 2 + 7, H / 2);
    ctx.moveTo(W / 2 - 7, -H / 2); ctx.lineTo(W / 2 - 7, H / 2);
    ctx.stroke();

    // Stencilled fraction of the stock left, in the manner of a service box.
    const frac = clamp(c.stock / CFG.CRATE_CAP, 0, 1);
    ctx.fillStyle = empty ? 'rgba(120,108,86,0.5)' : 'rgba(226,206,158,0.85)';
    ctx.fillRect(-W / 2 + 4, H / 2 - 6, (W - 8) * frac, 3);
    ctx.restore();
  },

  drawFires(ctx) {
    for (const f of this.fires) {
      const s = (0.45 + f.power * 0.55) * (1 + Math.sin(this.time * 9 + f.t) * 0.18);
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
    l.clearRect(0, 0, L.width, L.height);       // must clear: alpha accumulates
    l.fillStyle = 'rgba(14,20,44,0.56)';
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
    punch(S.x + S.w / 2, S.y + S.h / 2, 320, 0.7);
    for (const p of World.props) if (p.kind === 'lamp') punch(p.x, p.y - 18, 200 + Math.sin(this.time * 7 + p.x) * 10, 0.95);
    for (const f of this.fires) punch(f.x, f.y, 150 + Math.sin(this.time * 8 + f.t) * 16, 0.95);
    if (this.player && this.player.alive) punch(this.player.x, this.player.y, 240, 0.45);
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
    const mark = (wx, wy, color, size, alpha) => {
      const sx = (wx - this.camera.vx) * this.zoom, sy = (wy - this.camera.vy) * this.zoom;
      if (sx > -20 && sx < w + 20 && sy > -20 && sy < h + 20) return;
      const a = Math.atan2(sy - cy, sx - cx);
      ctx.save();
      ctx.translate(cx + Math.cos(a) * (Math.min(cx, cy) - m), cy + Math.sin(a) * (Math.min(cx, cy) - m));
      ctx.rotate(a);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, size * 0.55); ctx.lineTo(-size * 0.7, -size * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    for (const e of this.enemies) if (e.alive) mark(e.x, e.y, '#c9553f', 9, 0.55);
    // Fires are the most urgent thing on the map — flag them harder.
    for (const f of this.fires) mark(f.x, f.y, '#f0a63c', 14, 0.6 + Math.sin(this.time * 8) * 0.3);
    // Point the way back to the crate, but only when you actually need it.
    if (this.lowOnAmmo()) mark(this.ammoCrate.x, this.ammoCrate.y, '#d6ba78', 11, 0.75);
    ctx.restore();
  },

  drawVignette(ctx) {
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    if (!this._vig || this._vigW !== w || this._vigH !== h) {
      this._vigW = w; this._vigH = h;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.52)');
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
