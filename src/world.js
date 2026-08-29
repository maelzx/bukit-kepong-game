/* =============================================================================
   WORLD — map layout, static terrain pre-render, collision geometry, cover.

   HISTORICAL NOTE / GAMEPLAY ABSTRACTION:
   The real Bukit Kepong police station stood on the bank of the Muar River in
   Johor. The layout below (compound size, gate positions, outbuildings, tree
   placement) is a GAMEPLAY ABSTRACTION invented for readable top-down combat.
   It is not a survey of the historical site.
   ========================================================================== */
'use strict';

const World = {
  /* --- Landmarks (all coordinates in world space) --- */
  compound: { x: 470, y: 320, w: 980, h: 800 },
  station:  { x: 770, y: 600, w: 380, h: 250 },
  river:    { x: 0,   y: 0,   w: 150, h: CFG.WORLD_H },

  buildings: [],    // {x,y,w,h,kind,label}
  fences: [],       // {x,y,w,h,hp,alive,side}
  sandbags: [],     // {x,y,w,h}
  trees: [],        // {x,y,r,kind,sway}
  props: [],        // {x,y,kind} — lamps, barrels, wells, drums
  gates: [],        // {x,y} entry points
  coverPoints: [],  // {x,y,ox,oy} enemy firing positions outside the wire

  ground: null,     // offscreen pre-rendered terrain
  _lampFlicker: 0,

  /* ------------------------------------------------------------------ init */
  init() {
    const rng = makeRng(19500223);      // fixed seed: identical map every run
    const C = this.compound, S = this.station;

    this.buildings = [
      { ...S, kind: 'station', label: 'POLICE STATION' },
      { x: 545,  y: 905, w: 190, h: 130, kind: 'quarters' },  // police quarters
      { x: 1215, y: 880, w: 165, h: 120, kind: 'kitchen'  },  // cookhouse
      { x: 1225, y: 390, w: 150, h: 105, kind: 'store'    },  // store shed
    ];

    /* --- Perimeter fence with four gates ---------------------------------- */
    this.fences = [];
    const GATE = 110, SEG = 68, T = 13;
    const gapH = [C.x + C.w / 2 - GATE / 2, C.x + C.w / 2 + GATE / 2];
    const gapV = [C.y + C.h / 2 - GATE / 2, C.y + C.h / 2 + GATE / 2];

    for (let x = C.x; x < C.x + C.w; x += SEG) {
      const w = Math.min(SEG, C.x + C.w - x);
      if (!(x + w > gapH[0] && x < gapH[1])) {
        this.fences.push(this._fence(x, C.y - T, w, T, 'n'));
        this.fences.push(this._fence(x, C.y + C.h, w, T, 's'));
      }
    }
    for (let y = C.y; y < C.y + C.h; y += SEG) {
      const h = Math.min(SEG, C.y + C.h - y);
      if (!(y + h > gapV[0] && y < gapV[1])) {
        this.fences.push(this._fence(C.x - T, y, T, h, 'w'));
        this.fences.push(this._fence(C.x + C.w, y, T, h, 'e'));
      }
    }

    this.gates = [
      { x: C.x + C.w / 2, y: C.y - 6 },
      { x: C.x + C.w / 2, y: C.y + C.h + 6 },
      { x: C.x - 6,       y: C.y + C.h / 2 },
      { x: C.x + C.w + 6, y: C.y + C.h / 2 },
    ];

    /* --- Sandbag emplacements (improvised defensive positions) ------------ */
    this.sandbags = [
      { x: 905,  y: 392,  w: 120, h: 26 },   // covering north gate
      { x: 905,  y: 1058, w: 120, h: 26 },   // covering south gate
      { x: 542,  y: 660,  w: 26,  h: 120 },  // covering west gate
      { x: 1352, y: 660,  w: 26,  h: 120 },  // covering east gate
      { x: 800,  y: 905,  w: 96,  h: 24 },   // flanking station veranda
      { x: 1024, y: 905,  w: 96,  h: 24 },
    ];

    /* --- Vegetation ------------------------------------------------------- */
    this.trees = [];
    const outside = (x, y, pad) =>
      x < C.x - pad || x > C.x + C.w + pad || y < C.y - pad || y > C.y + C.h + pad;

    for (let i = 0; i < 190; i++) {
      const x = rng() * (CFG.WORLD_W - 260) + 190;
      const y = rng() * (CFG.WORLD_H - 120) + 60;
      if (!outside(x, y, 55)) continue;
      if (x < this.river.w + 40) continue;
      const kind = rng() < 0.28 ? 'palm' : rng() < 0.5 ? 'banana' : 'jungle';
      const r = kind === 'banana' ? 13 + rng() * 4 : 17 + rng() * 9;
      if (this.trees.some(t => dist2(t.x, t.y, x, y) < (t.r + r + 26) ** 2)) continue;
      this.trees.push({ x, y, r, kind, sway: rng() * TAU, tint: rng() });
    }
    // A few coconut palms inside the compound for shade and silhouette.
    [[620, 420], [1320, 1040], [700, 1050], [1300, 620]].forEach(([x, y]) =>
      this.trees.push({ x, y, r: 19, kind: 'palm', sway: rng() * TAU, tint: rng(), inside: true }));

    /* --- Props ------------------------------------------------------------ */
    this.props = [
      { x: C.x + C.w / 2, y: C.y + 40,      kind: 'lamp' },
      { x: C.x + C.w / 2, y: C.y + C.h - 40, kind: 'lamp' },
      { x: 960, y: 890,  kind: 'lamp' },
      { x: 600, y: 700,  kind: 'well' },
      { x: 1180, y: 1030, kind: 'drums' },
      { x: 860, y: 1010, kind: 'cart' },
      { x: 1330, y: 500, kind: 'drums' },
      { x: 120, y: 780,  kind: 'jetty' },
      { x: 960, y: 560,  kind: 'flagpole' },
    ];

    /* --- Enemy cover points: behind trees, facing the compound ------------ */
    this.coverPoints = [];
    const sx = S.x + S.w / 2, sy = S.y + S.h / 2;
    for (const t of this.trees) {
      if (t.inside) continue;
      const d = dist(t.x, t.y, sx, sy);
      if (d < 240 || d > 660) continue;
      const nx = (t.x - sx) / d, ny = (t.y - sy) / d;
      const cx = t.x + nx * (t.r + 14), cy = t.y + ny * (t.r + 14);
      this.coverPoints.push({ x: cx, y: cy, dist: dist(cx, cy, sx, sy), taken: null });
    }

    this._buildGround(rng);
  },

  _fence(x, y, w, h, side) { return { x, y, w, h, hp: 60, alive: true, side, hit: 0 }; },

  reset() { this.fences.forEach(f => { f.alive = true; f.hp = 60; f.hit = 0; }); this.coverPoints.forEach(c => c.taken = null); },

  inCompound(x, y) {
    const C = this.compound;
    return x > C.x && x < C.x + C.w && y > C.y && y < C.y + C.h;
  },

  /* -------------------------------------------------- collision queries --- */
  /** Rectangles that block movement. */
  *solids() {
    for (const b of this.buildings) yield b;
    for (const s of this.sandbags) yield s;
    for (const f of this.fences) if (f.alive) yield f;
    yield this.river;
  },
  /** Rectangles that stop bullets and break line of sight. */
  *blockers() {
    for (const b of this.buildings) yield b;
    for (const s of this.sandbags) yield s;
  },

  /** Resolve an entity circle against the static world. */
  collide(ent, r, opts = {}) {
    for (const b of this.buildings) resolveCircleRect(ent, r, b);
    for (const s of this.sandbags) resolveCircleRect(ent, r, s);
    if (!opts.ignoreFence) for (const f of this.fences) if (f.alive) resolveCircleRect(ent, r, f);
    resolveCircleRect(ent, r, this.river);
    for (const t of this.trees) resolveCircleCircle(ent, r, t.x, t.y, t.r * 0.55);
    ent.x = clamp(ent.x, r, CFG.WORLD_W - r);
    ent.y = clamp(ent.y, r, CFG.WORLD_H - r);
  },

  /** True when nothing solid interrupts the segment. */
  lineOfSight(x1, y1, x2, y2, ignore) {
    for (const b of this.buildings) if (b !== ignore && segRect(x1, y1, x2, y2, b)) return false;
    for (const s of this.sandbags) if (segRect(x1, y1, x2, y2, s)) return false;
    for (const t of this.trees) if (segCircle(x1, y1, x2, y2, t.x, t.y, t.r * 0.6)) return false;
    return true;
  },

  /** Nearest way through the wire: an open gate or a breach in the fence. */
  nearestEntry(x, y) {
    let best = null, bd = Infinity;
    for (const g of this.gates) {
      const d = dist2(x, y, g.x, g.y);
      if (d < bd) { bd = d; best = g; }
    }
    for (const f of this.fences) {
      if (f.alive) continue;
      const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
      const d = dist2(x, y, cx, cy) * 0.75;   // a breach is slightly preferred
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    }
    return best;
  },

  /** Fence segment overlapping a small probe circle (for melee breaching). */
  fenceAt(x, y, r) {
    for (const f of this.fences) {
      if (!f.alive) continue;
      const cx = clamp(x, f.x, f.x + f.w), cy = clamp(y, f.y, f.y + f.h);
      if (dist2(x, y, cx, cy) < r * r) return f;
    }
    return null;
  },

  /**
   * Claim a firing position. `maxRing` keeps attackers pressing inward (they
   * only ever take cover closer to the station than they already are);
   * `minRing` keeps marksmen out at their standoff distance.
   */
  claimCover(ent, fromX, fromY, maxRing = Infinity, minRing = 0) {
    let best = null, bs = Infinity;
    for (const c of this.coverPoints) {
      if (c.taken && c.taken !== ent && c.taken.alive) continue;
      if (c.dist > maxRing - 45 || c.dist < minRing) continue;
      const s = dist2(c.x, c.y, fromX, fromY) + c.dist * c.dist * 1.4;
      if (s < bs) { bs = s; best = c; }
    }
    if (best) {
      if (ent.cover && ent.cover !== best) ent.cover.taken = null;
      best.taken = ent;
    }
    return best;
  },

  /** Closest point on the station's footprint — an aiming point that has LOS. */
  stationAim(x, y) {
    const S = this.station;
    return { x: clamp(x, S.x + 6, S.x + S.w - 6), y: clamp(y, S.y + 6, S.y + S.h - 6) };
  },

  /* ------------------------------------------------ terrain pre-render ---- */
  _buildGround(rng) {
    const g = document.createElement('canvas');
    g.width = CFG.WORLD_W; g.height = CFG.WORLD_H;
    const c = g.getContext('2d');

    // Base earth / lalang grass
    c.fillStyle = '#2c3423';
    c.fillRect(0, 0, g.width, g.height);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * g.width, y = rng() * g.height;
      const s = 8 + rng() * 34;
      c.fillStyle = `rgba(${44 + rng() * 26 | 0},${54 + rng() * 30 | 0},${30 + rng() * 18 | 0},0.5)`;
      c.fillRect(x, y, s, s * 0.6);
    }

    // Cleared compound earth
    const C = this.compound;
    c.fillStyle = '#4a3d2c';
    c.fillRect(C.x - 10, C.y - 10, C.w + 20, C.h + 20);
    for (let i = 0; i < 900; i++) {
      const x = C.x + rng() * C.w, y = C.y + rng() * C.h;
      c.fillStyle = `rgba(${86 + rng() * 30 | 0},${70 + rng() * 24 | 0},${48 + rng() * 20 | 0},0.55)`;
      c.fillRect(x, y, 6 + rng() * 22, 4 + rng() * 12);
    }

    // Dirt tracks from every gate to the station veranda
    const S = this.station;
    c.strokeStyle = '#6b573c'; c.lineCap = 'round'; c.lineJoin = 'round';
    const hub = { x: S.x + S.w / 2, y: S.y + S.h + 70 };
    for (const gt of this.gates) {
      c.lineWidth = 46; c.globalAlpha = 0.85;
      c.beginPath(); c.moveTo(gt.x, gt.y); c.quadraticCurveTo((gt.x + hub.x) / 2 + rng() * 40 - 20, (gt.y + hub.y) / 2, hub.x, hub.y); c.stroke();
    }
    // Track continuing off-map through the north and east gates
    c.lineWidth = 40;
    c.beginPath(); c.moveTo(this.gates[0].x, this.gates[0].y); c.lineTo(this.gates[0].x + 60, 0); c.stroke();
    c.beginPath(); c.moveTo(this.gates[3].x, this.gates[3].y); c.lineTo(CFG.WORLD_W, this.gates[3].y - 80); c.stroke();
    c.globalAlpha = 1;

    // The river (Sungai Muar, abstracted) along the western edge
    const R = this.river;
    const grad = c.createLinearGradient(0, 0, R.w, 0);
    grad.addColorStop(0, '#1b2b33'); grad.addColorStop(0.7, '#24404a'); grad.addColorStop(1, '#33505a');
    c.fillStyle = grad; c.fillRect(R.x, R.y, R.w, R.h);
    c.fillStyle = 'rgba(120,150,150,0.10)';
    for (let i = 0; i < 220; i++) c.fillRect(rng() * R.w, rng() * R.h, 20 + rng() * 50, 2);
    c.fillStyle = '#3d3323'; c.fillRect(R.w, 0, 16, R.h);   // muddy bank

    this.ground = g;
  },

  /* -------------------------------------------------------- rendering ----- */
  drawGround(ctx, view) {
    ctx.drawImage(this.ground, view.x, view.y, view.w, view.h, view.x, view.y, view.w, view.h);
  },

  /** Ground-level structures drawn before entities. */
  drawStructures(ctx, t, stationHp) {
    this._lampFlicker = t;
    for (const f of this.fences) if (f.alive) this._drawFence(ctx, f);
    for (const p of this.props) this._drawProp(ctx, p, t);
    for (const b of this.buildings) this._drawBuilding(ctx, b, stationHp);
    for (const s of this.sandbags) this._drawSandbag(ctx, s);
    for (const t2 of this.trees) this._drawTrunk(ctx, t2);
  },

  /** Canopies drawn after entities so figures pass beneath the leaves. */
  drawCanopies(ctx, t) {
    for (const tr of this.trees) this._drawCanopy(ctx, tr, t);
  },

  _shadow(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, TAU); ctx.fill();
  },

  _drawFence(ctx, f) {
    const horizontal = f.w > f.h;
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(f.x + 3, f.y + 4, f.w, f.h);
    ctx.fillStyle = '#5b4630';
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillStyle = '#71583a';
    ctx.fillRect(f.x, f.y, horizontal ? f.w : f.w * 0.5, horizontal ? f.h * 0.5 : f.h);
    // posts + barbed wire ticks
    ctx.fillStyle = '#3f301f';
    const n = horizontal ? Math.max(2, (f.w / 22) | 0) : Math.max(2, (f.h / 22) | 0);
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      if (horizontal) ctx.fillRect(f.x + p * (f.w - 4), f.y - 2, 4, f.h + 4);
      else ctx.fillRect(f.x - 2, f.y + p * (f.h - 4), f.w + 4, 4);
    }
    if (f.hp < 60) {
      ctx.fillStyle = `rgba(20,14,8,${0.5 * (1 - f.hp / 60)})`;
      ctx.fillRect(f.x, f.y, f.w, f.h);
    }
  },

  _drawSandbag(ctx, s) {
    const horizontal = s.w > s.h;
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath(); ctx.ellipse(s.x + s.w / 2 + 4, s.y + s.h / 2 + 6, s.w * 0.6, s.h * 0.75, 0, 0, TAU); ctx.fill();
    const count = horizontal ? Math.round(s.w / 24) : Math.round(s.h / 24);
    for (let i = 0; i < count; i++) {
      const bx = horizontal ? s.x + i * (s.w / count) : s.x;
      const by = horizontal ? s.y : s.y + i * (s.h / count);
      const bw = horizontal ? s.w / count : s.w;
      const bh = horizontal ? s.h : s.h / count;
      ctx.fillStyle = i % 2 ? '#8a7a55' : '#7a6a49';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx + 1, by + 1, bw - 2, bh - 2, 5) : ctx.rect(bx + 1, by + 1, bw - 2, bh - 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.13)';
      ctx.fillRect(bx + 3, by + 2, bw - 6, 3);
    }
  },

  _drawBuilding(ctx, b, stationHp) {
    const isStation = b.kind === 'station';
    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(b.x + 8, b.y + 12, b.w, b.h);

    // Stilts / plinth (kampung house on posts)
    ctx.fillStyle = '#241c13';
    ctx.fillRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);

    // Plank roof
    const base = isStation ? ['#6d5637', '#5c4830'] : ['#5d4a2e', '#4d3d26'];
    ctx.fillStyle = base[0];
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = base[1];
    for (let y = b.y + 8; y < b.y + b.h; y += 16) ctx.fillRect(b.x, y, b.w, 7);

    // Ridge line
    ctx.fillStyle = 'rgba(255,225,170,0.10)';
    ctx.fillRect(b.x, b.y + b.h / 2 - 5, b.w, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(b.x, b.y + b.h / 2 + 5, b.w, 4);

    // Eaves highlight
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);

    if (isStation) {
      // Veranda along the south face + doorway
      ctx.fillStyle = '#3a2e1e';
      ctx.fillRect(b.x + 10, b.y + b.h - 26, b.w - 20, 22);
      ctx.fillStyle = '#241a10';
      ctx.fillRect(b.x + b.w / 2 - 26, b.y + b.h - 26, 52, 22);
      // Damage states
      const hp = stationHp;
      if (hp < 0.75) this._roofDamage(ctx, b, 1, hp);
      if (hp < 0.5) this._roofDamage(ctx, b, 2, hp);
      if (hp < 0.28) this._roofDamage(ctx, b, 3, hp);
    } else {
      // Attap thatch texture for outbuildings
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = b.x + 6; x < b.x + b.w; x += 13) ctx.fillRect(x, b.y + 4, 4, b.h - 8);
    }
  },

  _roofDamage(ctx, b, n, hp) {
    const rng = makeRng(1000 + n);
    for (let i = 0; i < 3 + n * 2; i++) {
      const x = b.x + 18 + rng() * (b.w - 46);
      const y = b.y + 16 + rng() * (b.h - 44);
      const r = 8 + rng() * 16;
      ctx.fillStyle = '#150f09';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, rng() * TAU, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(70,50,30,0.9)'; ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (hp < 0.35) { ctx.fillStyle = 'rgba(20,10,4,0.35)'; ctx.fillRect(b.x, b.y, b.w, b.h); }
  },

  _drawProp(ctx, p, t) {
    switch (p.kind) {
      case 'lamp': {
        this._shadow(ctx, p.x, p.y + 4, 8, 4);
        ctx.fillStyle = '#3a2f20'; ctx.fillRect(p.x - 2, p.y - 16, 4, 18);
        const f = 0.8 + Math.sin(t * 7 + p.x) * 0.12 + Math.sin(t * 13.3) * 0.06;
        ctx.fillStyle = `rgba(255,190,90,${0.85 * f})`;
        ctx.beginPath(); ctx.arc(p.x, p.y - 20, 5, 0, TAU); ctx.fill();
        break;
      }
      case 'well':
        this._shadow(ctx, p.x, p.y + 6, 20, 9);
        ctx.fillStyle = '#4a4038'; ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, TAU); ctx.fill();
        ctx.fillStyle = '#151a1c'; ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, TAU); ctx.fill();
        break;
      case 'drums':
        for (let i = 0; i < 3; i++) {
          const x = p.x + (i % 2) * 22, y = p.y + i * 13;
          this._shadow(ctx, x, y + 5, 12, 6);
          ctx.fillStyle = '#5a4a2c'; ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.fill();
          ctx.fillStyle = '#6f5c38'; ctx.beginPath(); ctx.arc(x - 2, y - 2, 8, 0, TAU); ctx.fill();
        }
        break;
      case 'cart':
        this._shadow(ctx, p.x, p.y + 8, 34, 12);
        ctx.fillStyle = '#4b3a24'; ctx.fillRect(p.x - 32, p.y - 16, 64, 32);
        ctx.fillStyle = '#5e4a2e'; ctx.fillRect(p.x - 28, p.y - 12, 56, 10);
        ctx.fillStyle = '#241a10';
        ctx.beginPath(); ctx.arc(p.x - 22, p.y + 16, 9, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x + 22, p.y + 16, 9, 0, TAU); ctx.fill();
        break;
      case 'jetty':
        ctx.fillStyle = '#4a3a24';
        for (let i = 0; i < 6; i++) ctx.fillRect(p.x - 40 + i * 16, p.y - 34, 12, 68);
        break;
      case 'flagpole':
        this._shadow(ctx, p.x, p.y + 3, 7, 3);
        ctx.fillStyle = '#8a8578'; ctx.fillRect(p.x - 2, p.y - 34, 4, 36);
        ctx.fillStyle = '#9c2b2b';
        ctx.beginPath();
        ctx.moveTo(p.x + 2, p.y - 34);
        ctx.lineTo(p.x + 30 + Math.sin(t * 2) * 4, p.y - 30);
        ctx.lineTo(p.x + 2, p.y - 20);
        ctx.fill();
        break;
    }
  },

  _drawTrunk(ctx, t) {
    this._shadow(ctx, t.x + 4, t.y + 6, t.r * 0.9, t.r * 0.45);
    ctx.fillStyle = t.kind === 'palm' ? '#4b3b26' : '#3d3122';
    ctx.beginPath(); ctx.arc(t.x, t.y, t.r * 0.38, 0, TAU); ctx.fill();
  },

  _drawCanopy(ctx, t, time) {
    const s = Math.sin(time * 0.9 + t.sway) * 2.2;
    ctx.save();
    ctx.translate(t.x + s, t.y - 4);
    if (t.kind === 'palm') {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.arc(6, 8, t.r * 1.25, 0, TAU); ctx.fill();
      for (let i = 0; i < 7; i++) {
        const a = t.sway + i * (TAU / 7) + Math.sin(time * 0.7 + i) * 0.05;
        ctx.fillStyle = i % 2 ? '#2f4a2a' : '#3a5a31';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(a) * t.r * 1.1, Math.sin(a) * t.r * 1.1,
                             Math.cos(a) * t.r * 2.0, Math.sin(a) * t.r * 2.0);
        ctx.quadraticCurveTo(Math.cos(a + 0.35) * t.r * 1.1, Math.sin(a + 0.35) * t.r * 1.1, 0, 0);
        ctx.fill();
      }
    } else if (t.kind === 'banana') {
      for (let i = 0; i < 5; i++) {
        const a = t.sway + i * (TAU / 5);
        ctx.fillStyle = i % 2 ? '#37552c' : '#436431';
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(t.r * 1.1, 0, t.r * 1.15, t.r * 0.42, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    } else {
      const g = 26 + t.tint * 22;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.arc(7, 9, t.r * 1.18, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgb(${34 + t.tint * 16 | 0},${54 + g | 0},${32 + t.tint * 14 | 0})`;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = t.sway + i * (TAU / 5);
        ctx.arc(Math.cos(a) * t.r * 0.5, Math.sin(a) * t.r * 0.5, t.r * 0.82, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = 'rgba(150,190,110,0.10)';
      ctx.beginPath(); ctx.arc(-t.r * 0.3, -t.r * 0.35, t.r * 0.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
};
