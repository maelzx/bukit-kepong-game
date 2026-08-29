/* =============================================================================
   FX — pooled particles, persistent decals, floating damage text, lighting.
   ========================================================================== */
'use strict';

const FX = {
  particles: [],
  texts: [],
  decals: null,      // persistent world-sized canvas (blood, scorch, craters)
  decalCtx: null,
  flashes: [],       // short-lived light sources (muzzle flash, explosions)

  init() {
    this.particles = new Array(CFG.PARTICLE_MAX);
    for (let i = 0; i < CFG.PARTICLE_MAX; i++) this.particles[i] = { alive: false };
    this.decals = document.createElement('canvas');
    this.decals.width = CFG.WORLD_W; this.decals.height = CFG.WORLD_H;
    this.decalCtx = this.decals.getContext('2d');
    this._head = 0;
  },

  clear() {
    for (const p of this.particles) p.alive = false;
    this.texts.length = 0;
    this.flashes.length = 0;
    this.decalCtx.clearRect(0, 0, CFG.WORLD_W, CFG.WORLD_H);
  },

  /** Grab the next free particle slot (ring buffer — oldest is recycled). */
  _next() {
    for (let i = 0; i < CFG.PARTICLE_MAX; i++) {
      const p = this.particles[this._head];
      this._head = (this._head + 1) % CFG.PARTICLE_MAX;
      if (!p.alive) return p;
    }
    return this.particles[this._head];
  },

  spawn(x, y, vx, vy, opts) {
    const p = this._next();
    p.alive = true; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = p.maxLife = opts.life;
    p.size = opts.size; p.color = opts.color; p.drag = opts.drag ?? 2.4;
    p.grow = opts.grow ?? 0; p.fade = opts.fade ?? 1; p.glow = opts.glow ?? false;
    p.shape = opts.shape ?? 'dot'; p.spin = opts.spin ?? 0; p.rot = opts.rot ?? 0;
    return p;
  },

  /* ------------------------------------------------------------- presets -- */
  muzzle(x, y, ang, scale = 1) {
    this.flashes.push({ x, y, r: 130 * scale, life: 0.07, max: 0.07, color: [255, 210, 120] });
    for (let i = 0; i < 7; i++) {
      const a = ang + rand(-0.30, 0.30);
      const sp = rand(150, 420) * scale;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, {
        life: rand(0.05, 0.14), size: rand(2, 4.6) * scale,
        color: i < 3 ? '255,240,190' : '255,170,60', glow: true, drag: 6,
      });
    }
    for (let i = 0; i < 3; i++) {
      const a = ang + rand(-0.6, 0.6);
      this.spawn(x, y, Math.cos(a) * rand(20, 70), Math.sin(a) * rand(20, 70), {
        life: rand(0.3, 0.6), size: rand(4, 8), color: '120,115,105', drag: 1.2, grow: 22, fade: 0.35,
      });
    }
  },

  casing(x, y, ang) {
    const a = ang + Math.PI / 2 + rand(-0.3, 0.3);
    this.spawn(x, y, Math.cos(a) * rand(60, 130), Math.sin(a) * rand(60, 130), {
      life: rand(0.5, 0.9), size: 2.4, color: '198,158,72', drag: 3.2, shape: 'rect',
      spin: rand(-16, 16), rot: rand(0, TAU),
    });
  },

  impact(x, y, ang, kind = 'dirt') {
    const cols = kind === 'wood' ? ['170,130,80', '120,88,50'] :
                 kind === 'metal' ? ['255,230,170', '190,170,140'] : ['140,116,82', '96,80,56'];
    for (let i = 0; i < (kind === 'metal' ? 8 : 6); i++) {
      const a = ang + Math.PI + rand(-1.0, 1.0);
      const sp = rand(60, 260);
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, {
        life: rand(0.15, 0.4), size: rand(1.5, 3.4), color: pick(cols),
        glow: kind === 'metal', drag: 4,
      });
    }
    this.spawn(x, y, 0, 0, { life: 0.35, size: 5, color: '90,80,64', grow: 26, fade: 0.4, drag: 1 });
  },

  blood(x, y, ang, amount = 1) {
    for (let i = 0; i < 8 * amount; i++) {
      const a = ang + rand(-0.9, 0.9);
      const sp = rand(50, 240) * amount;
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, {
        life: rand(0.25, 0.6), size: rand(1.8, 4.2), color: pick(['150,26,22', '116,18,16', '178,40,30']), drag: 3.4,
      });
    }
    this.splat(x, y, 6 + 10 * amount, 'rgba(72,14,12,0.42)');
  },

  smoke(x, y, amount = 1, tint = '70,66,60') {
    for (let i = 0; i < 3 * amount; i++) {
      this.spawn(x + rand(-8, 8), y + rand(-8, 8), rand(-16, 16), rand(-34, -12), {
        life: rand(1.2, 2.4), size: rand(8, 16), color: tint, drag: 0.5, grow: 30, fade: 0.28,
      });
    }
  },

  embers(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      this.spawn(x + rand(-14, 14), y + rand(-14, 14), rand(-24, 24), rand(-70, -24), {
        life: rand(0.6, 1.5), size: rand(1.4, 2.8), color: pick(['255,170,60', '255,120,40', '255,220,140']),
        drag: 0.8, glow: true, fade: 0.6,
      });
    }
  },

  explosion(x, y, r = 60) {
    this.flashes.push({ x, y, r: r * 3.4, life: 0.22, max: 0.22, color: [255, 170, 80] });
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU), sp = rand(60, 340);
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, {
        life: rand(0.2, 0.7), size: rand(2, 6), color: pick(['255,200,110', '255,140,50', '120,110,100']),
        glow: true, drag: 2.6,
      });
    }
    this.smoke(x, y, 5);
    this.splat(x, y, r * 0.5, 'rgba(16,12,8,0.5)');
  },

  splat(x, y, r, color) {
    const c = this.decalCtx;
    c.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU), d = rand(0, r * 0.7);
      c.beginPath();
      c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rand(0.3, 0.7), r * rand(0.3, 0.7), rand(0, TAU), 0, TAU);
      c.fill();
    }
  },

  hole(x, y) {
    const c = this.decalCtx;
    c.fillStyle = 'rgba(18,14,10,0.55)';
    c.beginPath(); c.arc(x, y, rand(1.6, 3), 0, TAU); c.fill();
  },

  text(x, y, str, color = '#ffe6b0', size = 13) {
    this.texts.push({ x, y, str, color, size, life: 0.9, max: 0.9, vy: -38 });
  },

  /* -------------------------------------------------------------- update -- */
  update(dt) {
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.size += p.grow * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt; t.y += t.vy * dt; t.vy *= Math.exp(-3 * dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) this.flashes.splice(i, 1);
    }
  },

  /* -------------------------------------------------------------- render -- */
  drawDecals(ctx, view) {
    ctx.drawImage(this.decals, view.x, view.y, view.w, view.h, view.x, view.y, view.w, view.h);
  },

  draw(ctx, view) {
    const x0 = view.x - 40, y0 = view.y - 40, x1 = view.x + view.w + 40, y1 = view.y + view.h + 40;
    ctx.save();
    for (const p of this.particles) {
      if (!p.alive) continue;
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      const a = clamp((p.life / p.maxLife) * p.fade + (p.fade < 1 ? 0 : 0), 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${p.color})`;
      if (p.glow) { ctx.shadowBlur = 12; ctx.shadowColor = `rgb(${p.color})`; }
      if (p.shape === 'rect') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.4, p.size), 0, TAU); ctx.fill();
      }
      if (p.glow) ctx.shadowBlur = 0;
    }
    ctx.restore();
  },

  drawTexts(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const a = clamp(t.life / t.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `700 ${t.size}px "Courier New", monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(t.str, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.restore();
  },
};
