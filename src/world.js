/* =============================================================================
   WORLD — map layout, static terrain pre-render, collision geometry, cover.

   HISTORICAL NOTE / GAMEPLAY ABSTRACTION:
   The real Bukit Kepong police station stood on the bank of the Muar River in
   Johor. The layout below (compound size, gate positions, outbuildings, tree
   placement) is a GAMEPLAY ABSTRACTION invented for readable top-down combat.
   It is not a survey of the historical site.
   ========================================================================== */
'use strict';

/** Hit points of one panel of wire before it is cut open. */
const FENCE_HP = 170;

const World = {
  /* --- Landmarks (all coordinates in world space) --- */
  compound: { x: 470, y: 320, w: 980, h: 800 },
  station:  { x: 790, y: 612, w: 340, h: 216 },
  river:    { x: 0,   y: 0,   w: 150, h: CFG.WORLD_H },

  buildings: [],    // {x,y,w,h,kind,label}
  fences: [],       // {x,y,w,h,hp,alive,side}
  sandbags: [],     // {x,y,w,h}
  trees: [],        // {x,y,r,kind,sway}
  props: [],        // {x,y,kind} — lamps, barrels, wells, drums
  bushes: [],       // {x,y,r} — low undergrowth, decorative only
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

    // Aim points sit just INSIDE the wire, so reaching a gate actually puts an
    // attacker in the compound rather than leaving him stuck on the threshold.
    this.gates = [
      { x: C.x + C.w / 2,  y: C.y + 44 },
      { x: C.x + C.w / 2,  y: C.y + C.h - 44 },
      { x: C.x + 44,       y: C.y + C.h / 2 },
      { x: C.x + C.w - 44, y: C.y + C.h / 2 },
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

    /* --- Low undergrowth (decorative, does not block) --------------------- */
    this.bushes = [];
    for (let i = 0; i < 240; i++) {
      const x = rng() * (CFG.WORLD_W - 220) + 180;
      const y = rng() * CFG.WORLD_H;
      if (!outside(x, y, 30)) continue;
      if (x < this.river.w + 30) continue;
      this.bushes.push({ x, y, r: 9 + rng() * 12, tint: rng(), sway: rng() * TAU });
    }

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
      { x: 960, y: 566,  kind: 'flagpole' },
      { x: 960, y: 300,  kind: 'sign' },      // BALAI POLIS board at the gate
      { x: 700, y: 880,  kind: 'jars' },      // tempayan water jars
      { x: 1150, y: 1060, kind: 'jars' },
      { x: 840, y: 560,  kind: 'bicycle' },
      { x: 88,  y: 620,  kind: 'sampan' },
      { x: 96,  y: 960,  kind: 'sampan' },
      { x: 1400, y: 980, kind: 'woodpile' },
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

  _fence(x, y, w, h, side) { return { x, y, w, h, hp: FENCE_HP, alive: true, side, hit: 0 }; },

  reset() { this.fences.forEach(f => { f.alive = true; f.hp = FENCE_HP; f.hit = 0; }); this.coverPoints.forEach(c => c.taken = null); },

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

  /** Nearest intact fence panel, used when attackers cut their own way in. */
  nearestFence(x, y) {
    let best = null, bd = Infinity;
    for (const f of this.fences) {
      if (!f.alive) continue;
      const d = dist2(x, y, f.x + f.w / 2, f.y + f.h / 2);
      if (d < bd) { bd = d; best = f; }
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
    const C = this.compound, S = this.station, R = this.river;

    /* --- base: dark tropical undergrowth ------------------------------- */
    c.fillStyle = '#3b4530';
    c.fillRect(0, 0, g.width, g.height);

    // Broad tonal blotches keep the field from reading as flat colour.
    for (let i = 0; i < 90; i++) {
      const x = rng() * g.width, y = rng() * g.height, r = 120 + rng() * 300;
      const grd = c.createRadialGradient(x, y, 0, x, y, r);
      const l = rng();
      grd.addColorStop(0, `rgba(${56 + l * 34 | 0},${74 + l * 42 | 0},${42 + l * 22 | 0},0.55)`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }

    // Lalang tufts — little wedges of grass, denser away from the compound.
    for (let i = 0; i < 14000; i++) {
      const x = rng() * g.width, y = rng() * g.height;
      const inYard = x > C.x - 30 && x < C.x + C.w + 30 && y > C.y - 30 && y < C.y + C.h + 30;
      if (inYard && rng() > 0.12) continue;
      if (x < R.w + 10) continue;
      const l = 3 + rng() * 7, lean = (rng() - 0.5) * 3;
      const sh = rng();
      c.strokeStyle = `rgba(${68 + sh * 46 | 0},${98 + sh * 58 | 0},${52 + sh * 30 | 0},${0.35 + rng() * 0.4})`;
      c.lineWidth = 1 + rng();
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + lean, y - l); c.stroke();
    }

    /* --- cleared compound earth ---------------------------------------- */
    const yard = c.createRadialGradient(C.x + C.w / 2, C.y + C.h / 2, 60, C.x + C.w / 2, C.y + C.h / 2, C.w * 0.62);
    // The cleared ground follows the wire only roughly — an irregular edge
    // where the jungle has been cut back reads far better than a rectangle.
    const edge = [];
    const side = (ax, ay, bx, by, nx, ny, n) => {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const j = 6 + rng() * 30;
        edge.push([ax + (bx - ax) * t + nx * j, ay + (by - ay) * t + ny * j]);
      }
    };
    side(C.x, C.y, C.x + C.w, C.y, 0, -1, 26);
    side(C.x + C.w, C.y, C.x + C.w, C.y + C.h, 1, 0, 22);
    side(C.x + C.w, C.y + C.h, C.x, C.y + C.h, 0, 1, 26);
    side(C.x, C.y + C.h, C.x, C.y, -1, 0, 22);

    c.save();
    c.beginPath();
    c.moveTo(edge[0][0], edge[0][1]);
    for (let i = 1; i < edge.length; i++) {
      const [px, py] = edge[i], [nx2, ny2] = edge[(i + 1) % edge.length];
      c.quadraticCurveTo(px, py, (px + nx2) / 2, (py + ny2) / 2);
    }
    c.closePath();
    c.clip();
    c.fillStyle = '#544733'; c.fillRect(C.x - 60, C.y - 60, C.w + 120, C.h + 120);
    yard.addColorStop(0, 'rgba(112,94,66,0.55)');
    yard.addColorStop(1, 'rgba(58,48,34,0.5)');
    c.fillStyle = yard; c.fillRect(C.x - 60, C.y - 60, C.w + 120, C.h + 120);
    // Trodden earth: overlapping soft patches, gravel flecks, scuffs
    for (let i = 0; i < 1500; i++) {
      const x = C.x + rng() * C.w, y = C.y + rng() * C.h;
      const l = rng();
      c.fillStyle = `rgba(${74 + l * 44 | 0},${60 + l * 34 | 0},${40 + l * 24 | 0},${0.10 + rng() * 0.22})`;
      c.beginPath(); c.ellipse(x, y, 6 + rng() * 26, 4 + rng() * 14, rng() * TAU, 0, TAU); c.fill();
    }
    for (let i = 0; i < 900; i++) {
      const x = C.x + rng() * C.w, y = C.y + rng() * C.h;
      c.fillStyle = rng() > 0.5 ? 'rgba(26,20,14,0.35)' : 'rgba(150,132,98,0.20)';
      c.fillRect(x, y, 1 + rng() * 2.5, 1 + rng() * 2);
    }
    // Weeds creeping in from the fence line
    for (let i = 0; i < 1400; i++) {
      const edge = rng();
      let x, y;
      if (edge < 0.5) { x = C.x + rng() * C.w; y = C.y + (rng() < 0.5 ? rng() * 40 : C.h - rng() * 40); }
      else { y = C.y + rng() * C.h; x = C.x + (rng() < 0.5 ? rng() * 40 : C.w - rng() * 40); }
      c.strokeStyle = `rgba(${56 + rng() * 30 | 0},${80 + rng() * 40 | 0},${40 + rng() * 20 | 0},0.5)`;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rng() - 0.5) * 3, y - 3 - rng() * 5); c.stroke();
    }
    c.restore();

    /* --- dirt tracks ---------------------------------------------------- */
    const hub = { x: S.x + S.w / 2, y: S.y + S.h + 78 };
    c.lineCap = 'round'; c.lineJoin = 'round';
    const track = (ax, ay, bx, by, width, alpha) => {
      c.strokeStyle = `rgba(112,92,62,${alpha})`;
      c.lineWidth = width;
      c.beginPath();
      c.moveTo(ax, ay);
      c.quadraticCurveTo((ax + bx) / 2 + (rng() - 0.5) * 60, (ay + by) / 2 + (rng() - 0.5) * 60, bx, by);
      c.stroke();
    };
    const mouths = [
      { x: C.x + C.w / 2, y: C.y - 6 }, { x: C.x + C.w / 2, y: C.y + C.h + 6 },
      { x: C.x - 6, y: C.y + C.h / 2 }, { x: C.x + C.w + 6, y: C.y + C.h / 2 },
    ];
    for (const gt of mouths) {
      track(gt.x, gt.y, hub.x, hub.y, 52, 0.65);
      track(gt.x, gt.y, hub.x, hub.y, 30, 0.35);          // worn centre
    }
    track(mouths[0].x, mouths[0].y, mouths[0].x + 90, -30, 46, 0.6);
    track(mouths[3].x, mouths[3].y, CFG.WORLD_W + 30, mouths[3].y - 120, 46, 0.6);
    track(mouths[2].x, mouths[2].y, R.w + 40, 800, 40, 0.55);

    // Cart ruts along the main track
    c.strokeStyle = 'rgba(60,48,32,0.35)'; c.lineWidth = 3;
    for (const off of [-9, 9]) {
      c.beginPath();
      c.moveTo(mouths[0].x + off, mouths[0].y);
      c.quadraticCurveTo(mouths[0].x + off + 20, (mouths[0].y + hub.y) / 2, hub.x + off, hub.y);
      c.stroke();
    }

    /* --- the river (Sungai Muar, abstracted) ---------------------------- */
    const grad = c.createLinearGradient(0, 0, R.w + 30, 0);
    grad.addColorStop(0, '#17242b'); grad.addColorStop(0.65, '#223b45'); grad.addColorStop(1, '#33505a');
    c.fillStyle = grad; c.fillRect(R.x, R.y, R.w, R.h);
    for (let i = 0; i < 500; i++) {                       // current streaks
      const y = rng() * R.h;
      c.fillStyle = `rgba(150,180,180,${0.03 + rng() * 0.09})`;
      c.fillRect(rng() * R.w, y, 24 + rng() * 90, 1 + rng());
    }
    // Muddy bank with reeds
    c.fillStyle = '#42351f'; c.fillRect(R.w, 0, 22, R.h);
    for (let i = 0; i < 900; i++) {
      const x = R.w - 6 + rng() * 40, y = rng() * R.h;
      c.strokeStyle = `rgba(${70 + rng() * 40 | 0},${86 + rng() * 40 | 0},${44 + rng() * 20 | 0},0.6)`;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rng() - 0.5) * 4, y - 6 - rng() * 12); c.stroke();
    }

    this.ground = g;
  },

  /* -------------------------------------------------------- rendering ----- */
  drawGround(ctx, view) {
    ctx.drawImage(this.ground, view.x, view.y, view.w, view.h, view.x, view.y, view.w, view.h);
  },

  /** Ground-level structures drawn before entities. */
  drawStructures(ctx, t, stationHp) {
    this._lampFlicker = t;
    for (const b of this.bushes) this._drawBush(ctx, b, t);
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

  /** Wooden posts strung with barbed wire — the compound perimeter. */
  _drawFence(ctx, f) {
    const horiz = f.w > f.h;
    const x1 = f.x + (horiz ? 0 : f.w / 2), y1 = f.y + (horiz ? f.h / 2 : 0);
    const x2 = horiz ? f.x + f.w : x1, y2 = horiz ? y1 : f.y + f.h;
    const len = horiz ? f.w : f.h;
    const dmg = 1 - f.hp / FENCE_HP;

    ctx.save();
    // Three strands of wire with a little slack
    ctx.strokeStyle = `rgba(${150 - dmg * 70 | 0},${142 - dmg * 70 | 0},${120 - dmg * 60 | 0},${0.72 - dmg * 0.3})`;
    ctx.lineWidth = 1.3;
    for (const off of [-5, 0, 5]) {
      ctx.beginPath();
      if (horiz) { ctx.moveTo(x1, y1 + off); ctx.quadraticCurveTo((x1 + x2) / 2, y1 + off + 2, x2, y1 + off); }
      else { ctx.moveTo(x1 + off, y1); ctx.quadraticCurveTo(x1 + off + 2, (y1 + y2) / 2, x1 + off, y2); }
      ctx.stroke();
    }
    // Barbs
    ctx.lineWidth = 1;
    for (let i = 6; i < len; i += 15) {
      const bx = horiz ? f.x + i : x1, by = horiz ? y1 : f.y + i;
      ctx.beginPath();
      ctx.moveTo(bx - 2.5, by - 2.5); ctx.lineTo(bx + 2.5, by + 2.5);
      ctx.moveTo(bx + 2.5, by - 2.5); ctx.lineTo(bx - 2.5, by + 2.5);
      ctx.stroke();
    }
    // Posts
    const n = Math.max(2, Math.round(len / 34));
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      const px = horiz ? f.x + p * (f.w - 7) + 3 : x1;
      const py = horiz ? y1 : f.y + p * (f.h - 7) + 3;
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath(); ctx.ellipse(px + 3, py + 4, 6, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4b3b26';
      ctx.beginPath(); ctx.arc(px, py, 4.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6a5436';
      ctx.beginPath(); ctx.arc(px - 1, py - 1, 2.8, 0, TAU); ctx.fill();
    }
    ctx.restore();
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

  /**
   * A kampung structure seen from above: hipped roof with a central ridge,
   * four shaded slopes, thatch or plank texture, and an overhanging eave.
   */
  _drawBuilding(ctx, b, stationHp) {
    const isStation = b.kind === 'station';
    const O = 9;                                  // eave overhang beyond walls
    const x = b.x - O, y = b.y - O, w = b.w + O * 2, h = b.h + O * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x + 10, y + 16, w, h);

    // Dark band under the eaves — reads as the wall in shadow
    ctx.fillStyle = '#1b1610';
    ctx.fillRect(x, y, w, h);

    const horiz = w >= h;
    const inset = Math.min(w, h) / 2;
    const rA = horiz ? { x: x + inset, y: y + h / 2 } : { x: x + w / 2, y: y + inset };
    const rB = horiz ? { x: x + w - inset, y: y + h / 2 } : { x: x + w / 2, y: y + h - inset };

    const thatch = !isStation;
    const tone = thatch
      ? { n: '#6a5836', s: '#41351f', e: '#544427', ridge: '#7d6a42' }
      : { n: '#7a6742', s: '#4b3d26', e: '#5e4d30', ridge: '#8d7748' };

    const slope = (pts, fill, dir) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.clip();
      // Thatch courses / plank lines running parallel to the eave
      ctx.strokeStyle = thatch ? 'rgba(28,22,12,0.30)' : 'rgba(24,18,10,0.34)';
      ctx.lineWidth = thatch ? 2 : 1.6;
      const step = thatch ? 7 : 11;
      if (dir === 'h') { for (let yy = y - 2; yy < y + h + 2; yy += step) { ctx.beginPath(); ctx.moveTo(x - 2, yy); ctx.lineTo(x + w + 2, yy); ctx.stroke(); } }
      else { for (let xx = x - 2; xx < x + w + 2; xx += step) { ctx.beginPath(); ctx.moveTo(xx, y - 2); ctx.lineTo(xx, y + h + 2); ctx.stroke(); } }
      ctx.restore();
    };

    if (horiz) {
      slope([[x, y], [x + w, y], [rB.x, rB.y], [rA.x, rA.y]], tone.n, 'h');
      slope([[x, y + h], [x + w, y + h], [rB.x, rB.y], [rA.x, rA.y]], tone.s, 'h');
      slope([[x, y], [x, y + h], [rA.x, rA.y]], tone.e, 'v');
      slope([[x + w, y], [x + w, y + h], [rB.x, rB.y]], tone.e, 'v');
    } else {
      slope([[x, y], [x, y + h], [rB.x, rB.y], [rA.x, rA.y]], tone.e, 'v');
      slope([[x + w, y], [x + w, y + h], [rB.x, rB.y], [rA.x, rA.y]], tone.s, 'v');
      slope([[x, y], [x + w, y], [rA.x, rA.y]], tone.n, 'h');
      slope([[x, y + h], [x + w, y + h], [rB.x, rB.y]], tone.s, 'h');
    }

    // Hip lines and ridge cap
    ctx.strokeStyle = 'rgba(20,14,8,0.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(rA.x, rA.y);
    ctx.moveTo(x + w, y); ctx.lineTo(rB.x, rB.y);
    ctx.moveTo(x, y + h); ctx.lineTo(rA.x, rA.y);
    ctx.moveTo(x + w, y + h); ctx.lineTo(rB.x, rB.y);
    ctx.stroke();
    ctx.strokeStyle = tone.ridge; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(rA.x, rA.y); ctx.lineTo(rB.x, rB.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rA.x, rA.y + 2.5); ctx.lineTo(rB.x, rB.y + 2.5); ctx.stroke();

    // Eave edge
    ctx.strokeStyle = 'rgba(12,8,4,0.7)'; ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4);

    if (isStation) this._stationDetail(ctx, b, stationHp);
  },

  /** Veranda, steps and battle damage on the main building. */
  _stationDetail(ctx, b, hp) {
    const vy = b.y + b.h + 6, vw = b.w - 40;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(b.x + 24, vy + 6, vw, 30);
    ctx.fillStyle = '#4a3b25';
    ctx.fillRect(b.x + 20, vy, vw, 28);
    ctx.strokeStyle = 'rgba(22,16,10,0.5)'; ctx.lineWidth = 1;
    for (let i = 0; i < vw; i += 12) { ctx.beginPath(); ctx.moveTo(b.x + 20 + i, vy); ctx.lineTo(b.x + 20 + i, vy + 28); ctx.stroke(); }
    ctx.fillStyle = '#33281a';
    for (let i = 0; i <= vw; i += 26) { ctx.beginPath(); ctx.arc(b.x + 20 + i, vy + 26, 3.6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#3d3120';
    for (let i = 0; i < 3; i++) ctx.fillRect(b.x + b.w / 2 - 26 + i * 3, vy + 28 + i * 6, 52 - i * 6, 6);
    // Doorway with lamplight spilling out
    ctx.fillStyle = '#100c07';
    ctx.fillRect(b.x + b.w / 2 - 22, vy - 12, 44, 14);
    ctx.fillStyle = 'rgba(240,180,90,0.22)';
    ctx.fillRect(b.x + b.w / 2 - 18, vy - 10, 36, 10);

    if (hp < 0.78) this._roofDamage(ctx, b, 1, hp);
    if (hp < 0.52) this._roofDamage(ctx, b, 2, hp);
    if (hp < 0.28) this._roofDamage(ctx, b, 3, hp);
  },

  /** Blown-through roof panels with charring and exposed rafters. */
  _roofDamage(ctx, b, n, hp) {
    const rng = makeRng(1000 + n * 37);
    for (let i = 0; i < 2 + n * 2; i++) {
      const cx = b.x + 22 + rng() * (b.w - 50);
      const cy = b.y + 18 + rng() * (b.h - 44);
      const r = 10 + rng() * 20;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.72, rng() * TAU, 0, TAU);
      ctx.fillStyle = '#0e0a06'; ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(96,72,44,0.85)'; ctx.lineWidth = 2.5;
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(cx - r, cy + k * 9); ctx.lineTo(cx + r, cy + k * 9); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = 'rgba(48,30,14,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 0.72, 0, 0, TAU); ctx.stroke();
    }
    if (hp < 0.35) { ctx.fillStyle = 'rgba(18,10,4,0.30)'; ctx.fillRect(b.x - 9, b.y - 9, b.w + 18, b.h + 18); }
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
      case 'sign': {
        this._shadow(ctx, p.x, p.y + 8, 34, 7);
        ctx.fillStyle = '#3a2e1e';
        ctx.fillRect(p.x - 30, p.y - 3, 4, 12); ctx.fillRect(p.x + 26, p.y - 3, 4, 12);
        ctx.fillStyle = '#6b5836';
        ctx.fillRect(p.x - 34, p.y - 12, 68, 16);
        ctx.strokeStyle = 'rgba(20,14,8,0.6)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 34, p.y - 12, 68, 16);
        ctx.fillStyle = '#d8cba4';
        ctx.font = '700 7px "Courier New", monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BALAI POLIS', p.x, p.y - 5);
        ctx.fillText('BUKIT KEPONG', p.x, p.y + 2);
        ctx.textAlign = 'left';
        break;
      }
      case 'jars':
        for (let i = 0; i < 2; i++) {
          const x = p.x + i * 20, y = p.y + (i % 2) * 12;
          this._shadow(ctx, x + 2, y + 6, 11, 5);
          ctx.fillStyle = '#4a3a2c'; ctx.beginPath(); ctx.arc(x, y, 10, 0, TAU); ctx.fill();
          ctx.fillStyle = '#5d4a37'; ctx.beginPath(); ctx.arc(x - 2, y - 2, 7.5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#20272a'; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, TAU); ctx.fill();
        }
        break;
      case 'bicycle':
        this._shadow(ctx, p.x, p.y + 5, 18, 5);
        ctx.strokeStyle = '#2a2620'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x - 12, p.y, 7, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x + 12, p.y, 7, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 12, p.y); ctx.lineTo(p.x + 12, p.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 2, p.y - 7); ctx.lineTo(p.x + 4, p.y + 3); ctx.stroke();
        break;
      case 'sampan': {
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 5, 13, 34, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4b3a24';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 12, 32, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2a2116';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 8, 26, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5e4a2e';
        ctx.fillRect(p.x - 9, p.y - 5, 18, 4);
        break;
      }
      case 'woodpile':
        this._shadow(ctx, p.x, p.y + 7, 24, 8);
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = i % 2 ? '#4e3e28' : '#5f4c30';
          ctx.fillRect(p.x - 22 + (i % 2) * 4, p.y - 12 + i * 6, 44, 6);
        }
        break;
      case 'flagpole':
        this._shadow(ctx, p.x, p.y + 3, 7, 3);
        ctx.fillStyle = '#8a8578'; ctx.fillRect(p.x - 2, p.y - 34, 4, 36);
        ctx.fillStyle = '#b9ad8a';   // plain weathered pennant, no insignia
        ctx.beginPath();
        ctx.moveTo(p.x + 2, p.y - 34);
        ctx.lineTo(p.x + 30 + Math.sin(t * 2) * 4, p.y - 30);
        ctx.lineTo(p.x + 2, p.y - 20);
        ctx.fill();
        break;
    }
  },

  _drawBush(ctx, b, time) {
    const s = Math.sin(time * 0.8 + b.sway) * 1.2;
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath(); ctx.ellipse(b.x + 3, b.y + 4, b.r, b.r * 0.5, 0, 0, TAU); ctx.fill();
    const g = 60 + b.tint * 30;
    ctx.fillStyle = `rgb(${40 + b.tint * 18 | 0},${g | 0},${34 + b.tint * 14 | 0})`;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = b.sway + i * (TAU / 4);
      ctx.arc(b.x + Math.cos(a) * b.r * 0.42 + s, b.y + Math.sin(a) * b.r * 0.32, b.r * 0.62, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(150,180,110,0.09)';
    ctx.beginPath(); ctx.ellipse(b.x - b.r * 0.2 + s, b.y - b.r * 0.3, b.r * 0.5, b.r * 0.3, 0, 0, TAU); ctx.fill();
  },

  _drawTrunk(ctx, t) {
    this._shadow(ctx, t.x + 5, t.y + 7, t.r * 1.0, t.r * 0.5);
    const r = t.r * (t.kind === 'palm' ? 0.32 : 0.4);
    ctx.fillStyle = t.kind === 'palm' ? '#4b3b26' : '#3a2f21';
    ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(160,132,90,0.22)';
    ctx.beginPath(); ctx.arc(t.x - r * 0.3, t.y - r * 0.3, r * 0.55, 0, TAU); ctx.fill();
    // Buttress roots on the larger jungle trees
    if (t.kind === 'jungle' && t.r > 21) {
      ctx.fillStyle = 'rgba(48,38,26,0.85)';
      for (let i = 0; i < 4; i++) {
        const a = t.sway + i * (TAU / 4);
        ctx.beginPath();
        ctx.ellipse(t.x + Math.cos(a) * r * 1.2, t.y + Math.sin(a) * r * 1.2, r * 0.55, r * 0.3, a, 0, TAU);
        ctx.fill();
      }
    }
  },

  _drawCanopy(ctx, t, time) {
    const s = Math.sin(time * 0.9 + t.sway) * 2.4;
    ctx.save();
    ctx.translate(t.x + s, t.y - 4);

    if (t.kind === 'palm') {
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath(); ctx.ellipse(7, 10, t.r * 1.5, t.r * 1.2, 0, 0, TAU); ctx.fill();
      // coconut cluster
      ctx.fillStyle = '#4d4327';
      for (let i = 0; i < 3; i++) {
        const a = t.sway + i * 2.1;
        ctx.beginPath(); ctx.arc(Math.cos(a) * 5, Math.sin(a) * 5, 3.4, 0, TAU); ctx.fill();
      }
      for (let i = 0; i < 8; i++) {
        const a = t.sway + i * (TAU / 8) + Math.sin(time * 0.7 + i) * 0.06;
        const L = t.r * (1.75 + (i % 2) * 0.32);
        ctx.fillStyle = i % 2 ? '#385a2f' : '#47703b';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(a - 0.16) * L * 0.6, Math.sin(a - 0.16) * L * 0.6, Math.cos(a) * L, Math.sin(a) * L);
        ctx.quadraticCurveTo(Math.cos(a + 0.30) * L * 0.6, Math.sin(a + 0.30) * L * 0.6, 0, 0);
        ctx.fill();
        // frond spine
        ctx.strokeStyle = 'rgba(20,30,16,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L); ctx.stroke();
      }
    } else if (t.kind === 'banana') {
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.ellipse(6, 8, t.r * 1.3, t.r * 0.9, 0, 0, TAU); ctx.fill();
      for (let i = 0; i < 6; i++) {
        const a = t.sway + i * (TAU / 6) + Math.sin(time * 0.6 + i) * 0.05;
        ctx.fillStyle = i % 2 ? '#426632' : '#527a3a';
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(t.r * 1.15, 0, t.r * 1.2, t.r * 0.44, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(18,26,14,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(t.r * 2.3, 0); ctx.stroke();
        ctx.restore();
      }
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath(); ctx.arc(8, 11, t.r * 1.24, 0, TAU); ctx.fill();
      // three layers: shadow mass, mid tone, moonlit crown
      const shades = [
        [t.r * 1.16, `rgb(${30 + t.tint * 12 | 0},${50 + t.tint * 20 | 0},${30 + t.tint * 10 | 0})`, 0, 0],
        [t.r * 0.98, `rgb(${42 + t.tint * 18 | 0},${70 + t.tint * 28 | 0},${40 + t.tint * 14 | 0})`, -1, -2],
        [t.r * 0.70, `rgb(${56 + t.tint * 22 | 0},${92 + t.tint * 32 | 0},${52 + t.tint * 18 | 0})`, -3, -5],
      ];
      for (const [rr, col, ox, oy] of shades) {
        ctx.fillStyle = col;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = t.sway + i * (TAU / 5);
          ctx.arc(ox + Math.cos(a) * rr * 0.46, oy + Math.sin(a) * rr * 0.46, rr * 0.72, 0, TAU);
        }
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(180,205,150,0.10)';
      ctx.beginPath(); ctx.arc(-t.r * 0.42, -t.r * 0.5, t.r * 0.48, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
};
