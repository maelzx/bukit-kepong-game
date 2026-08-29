/* =============================================================================
   ENTITIES — bullets, the human figure renderer, Player, Police, Enemy.

   HISTORICAL NOTE: uniforms and weapons are period-appropriate in broad terms
   (Malayan Police khaki and songkok, Sten gun, .303 bolt rifles). Individual
   statistics are tuned for playability, not ballistic accuracy.
   ========================================================================== */
'use strict';

/* -------------------------------------------------------------- weapons --- */
const WEAPONS = {
  sten: {                       // Sten Mk II 9mm submachine gun — player
    name: 'STEN Mk II', mag: 32, reserve: 224, reload: 2.1,
    rps: 8.2, damage: 20, spread: 0.042, speed: 1150, recoil: 0.030, auto: true,
  },
  lee: {                        // Lee-Enfield .303 bolt rifle — police
    name: 'LEE-ENFIELD', mag: 10, reserve: 999, reload: 2.6,
    rps: 0.58, damage: 36, spread: 0.075, speed: 1400, recoil: 0, auto: false,
  },
  insurgentRifle: {
    name: 'RIFLE', mag: 5, reserve: 999, reload: 2.4,
    rps: 0.70, damage: 10, spread: 0.075, speed: 1050, recoil: 0, auto: false,
  },
  insurgentSmg: {
    name: 'SMG', mag: 20, reserve: 999, reload: 2.8,
    rps: 5.5, damage: 5, spread: 0.13, speed: 950, recoil: 0, auto: true,
  },
  marksmanRifle: {
    name: 'SCOPED RIFLE', mag: 5, reserve: 999, reload: 3.0,
    rps: 0.34, damage: 16, spread: 0.018, speed: 1500, recoil: 0, auto: false,
  },
};

/* ------------------------------------------------------------- bullets ---- */
const Bullets = {
  pool: [], head: 0,
  init() {
    this.pool = new Array(CFG.BULLET_MAX);
    for (let i = 0; i < CFG.BULLET_MAX; i++) this.pool[i] = { alive: false };
  },
  clear() { for (const b of this.pool) b.alive = false; },

  fire(x, y, ang, w, owner, dmgScale = 1) {
    let b = null;
    for (let i = 0; i < CFG.BULLET_MAX; i++) {
      const c = this.pool[this.head];
      this.head = (this.head + 1) % CFG.BULLET_MAX;
      if (!c.alive) { b = c; break; }
    }
    if (!b) return null;
    b.alive = true;
    b.x = b.px = x; b.y = b.py = y;
    b.vx = Math.cos(ang) * w.speed; b.vy = Math.sin(ang) * w.speed;
    b.dmg = w.damage * dmgScale;
    b.life = 1.1; b.owner = owner; b.friendly = owner.faction === 'police';
    b.len = w.speed > 1200 ? 26 : 18;
    return b;
  },

  /** Advance every live bullet and resolve hits against actors and scenery. */
  update(dt, game) {
    for (const b of this.pool) {
      if (!b.alive) continue;
      b.life -= dt;
      if (b.life <= 0) { b.alive = false; continue; }
      b.px = b.x; b.py = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt;

      if (b.x < 0 || b.y < 0 || b.x > CFG.WORLD_W || b.y > CFG.WORLD_H) { b.alive = false; continue; }

      // --- actors -------------------------------------------------------
      const targets = b.friendly ? game.enemies : game.defenders;
      let hitActor = null;
      for (const a of targets) {
        if (!a.alive) continue;
        if (segCircle(b.px, b.py, b.x, b.y, a.x, a.y, a.radius)) { hitActor = a; break; }
      }
      if (hitActor) {
        const ang = Math.atan2(b.vy, b.vx);
        if (b.owner.isPlayer) {
          game.stats.hits++;
          game.hitMarker = 0.22;
          game.hitMarkerKill = hitActor.hp - b.dmg <= 0;
        }
        hitActor.hurt(b.dmg, ang, b.owner, game);
        FX.blood(b.x, b.y, ang);
        Audio2.hitFlesh(b.x, b.y);
        b.alive = false;
        continue;
      }

      // --- scenery ------------------------------------------------------
      let blocked = null, kind = 'dirt';
      for (const s of World.sandbags) if (segRect(b.px, b.py, b.x, b.y, s)) { blocked = s; kind = 'dirt'; break; }
      if (!blocked) {
        for (const bl of World.buildings) {
          if (segRect(b.px, b.py, b.x, b.y, bl)) {
            blocked = bl; kind = 'wood';
            // Only hostile fire damages the station's structure.
            if (bl.kind === 'station' && !b.friendly) game.damageStation(b.dmg * 0.5, b.x, b.y);
            break;
          }
        }
      }
      if (!blocked) {
        for (const t of World.trees) {
          if (segCircle(b.px, b.py, b.x, b.y, t.x, t.y, t.r * 0.5)) { blocked = t; kind = 'wood'; break; }
        }
      }
      if (blocked) {
        FX.impact(b.x, b.y, Math.atan2(b.vy, b.vx), kind);
        FX.hole(b.x, b.y);
        if (kind === 'wood') Audio2.hitWood(b.x, b.y);
        b.alive = false;
      }
    }
  },

  draw(ctx) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const b of this.pool) {
      if (!b.alive) continue;
      const n = Math.hypot(b.vx, b.vy) || 1;
      const tx = b.x - (b.vx / n) * b.len, ty = b.y - (b.vy / n) * b.len;
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = b.friendly ? 'rgba(255,226,150,0.85)' : 'rgba(255,170,120,0.8)';
      ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = b.friendly ? '#fff6d8' : '#ffd8b8';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(tx + (b.vx / n) * b.len * 0.5, ty + (b.vy / n) * b.len * 0.5); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  },
};

/* --------------------------------------------------------- figure render -- */
/**
 * Draws a top-down human: shadow, legs (walk cycle), torso, arms + weapon,
 * head with headgear. `look` is the aiming angle, `move` the walk phase.
 */
function drawFigure(ctx, a) {
  const p = a.palette;
  ctx.save();
  ctx.translate(a.x, a.y);

  // Ground shadow (kept axis-aligned so it reads as a light from above)
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath(); ctx.ellipse(2, 4, a.radius * 1.0, a.radius * 0.62, 0, 0, TAU); ctx.fill();

  if (a.dying) {
    // Falling animation: flatten and rotate to the ground
    const t = 1 - a.dying / 0.55;
    ctx.rotate(a.look + t * 1.1);
    ctx.globalAlpha = clamp(a.dying / 0.55 + 0.25, 0, 1);
    ctx.scale(1 + t * 0.25, 1 - t * 0.35);
    ctx.fillStyle = p.shirt;
    ctx.beginPath(); ctx.ellipse(0, 0, a.radius * 1.1, a.radius * 0.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.hat;
    ctx.beginPath(); ctx.arc(a.radius * 0.8, 0, a.radius * 0.5, 0, TAU); ctx.fill();
    ctx.restore();
    return;
  }

  ctx.rotate(a.look);

  const bob = Math.sin(a.walk * 2) * (a.moving ? 1 : 0);
  const R = a.radius;

  // Legs / shorts
  ctx.fillStyle = p.shorts;
  ctx.fillRect(-R * 0.5, -R * 0.72 + bob * 1.5, R * 0.95, R * 0.55);
  ctx.fillRect(-R * 0.5, R * 0.18 - bob * 1.5, R * 0.95, R * 0.55);

  // Torso
  ctx.fillStyle = p.shirt;
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.95, R * 0.78, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.ellipse(R * 0.15, -R * 0.2, R * 0.6, R * 0.4, 0, 0, TAU); ctx.fill();
  // Cool rim light keeps silhouettes readable against the dark treeline
  ctx.strokeStyle = a.faction === 'police' ? 'rgba(198,214,236,0.34)' : 'rgba(228,168,120,0.30)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.95, R * 0.78, 0, 0, TAU); ctx.stroke();
  if (p.webbing) {                                   // cross-strap / bandolier
    ctx.strokeStyle = p.webbing; ctx.lineWidth = R * 0.22;
    ctx.beginPath(); ctx.moveTo(-R * 0.5, -R * 0.55); ctx.lineTo(R * 0.35, R * 0.5); ctx.stroke();
  }

  // Weapon + arms. During a reload the muzzle drops and the magazine is swapped.
  const kick = a.recoil || 0;
  const rl = a.reloading > 0 && a.weapon ? 1 - a.reloading / a.weapon.reload : -1;
  ctx.save();
  ctx.translate(-kick * 5, 0);
  if (rl >= 0) {
    const swing = Math.sin(rl * Math.PI);
    ctx.rotate(swing * 0.55);
    ctx.translate(-swing * R * 0.3, 0);
  }
  ctx.fillStyle = '#2b2118';
  ctx.fillRect(R * 0.25, -R * 0.12, R * (a.weaponLen || 1.9), R * 0.24);      // barrel
  ctx.fillStyle = '#4a3a26';
  ctx.fillRect(-R * 0.15, -R * 0.16, R * 0.6, R * 0.32);                       // stock
  if (a.weaponKind === 'sten') {                                              // side magazine
    const off = rl >= 0 ? Math.sin(rl * Math.PI) * R * 1.4 : 0;                // pulled clear
    ctx.fillStyle = '#3a3028';
    ctx.fillRect(R * 0.5, -R * 0.95 - off, R * 0.2, R * 0.8);
  }
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(R * 0.55, -R * 0.42, R * 0.24, 0, TAU); ctx.fill();  // hands
  ctx.beginPath(); ctx.arc(R * 0.15, R * 0.45, R * 0.24, 0, TAU); ctx.fill();
  ctx.restore();

  // Head + headgear
  ctx.fillStyle = p.skin;
  ctx.beginPath(); ctx.arc(R * 0.22, 0, R * 0.46, 0, TAU); ctx.fill();
  ctx.fillStyle = p.hat;
  if (p.hatStyle === 'songkok') {
    ctx.beginPath(); ctx.ellipse(R * 0.16, 0, R * 0.46, R * 0.42, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath(); ctx.ellipse(R * 0.1, -R * 0.12, R * 0.28, R * 0.18, 0, 0, TAU); ctx.fill();
  } else if (p.hatStyle === 'cap') {
    ctx.beginPath(); ctx.arc(R * 0.16, 0, R * 0.44, 0, TAU); ctx.fill();
    ctx.fillStyle = p.hat;
    ctx.fillRect(R * 0.4, -R * 0.34, R * 0.3, R * 0.68);                        // peak
    if (p.star) {                                                              // red star badge
      ctx.fillStyle = '#b6302a';
      ctx.beginPath(); ctx.arc(R * 0.36, 0, R * 0.12, 0, TAU); ctx.fill();
    }
  } else if (p.hatStyle === 'straw') {
    ctx.beginPath(); ctx.arc(R * 0.14, 0, R * 0.62, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(R * 0.14, 0, R * 0.36, 0, TAU); ctx.stroke();
  } else {                                                                     // bare head / headband
    ctx.fillStyle = '#1d1710';
    ctx.beginPath(); ctx.arc(R * 0.16, 0, R * 0.44, 0, TAU); ctx.fill();
    ctx.fillStyle = '#9d2b26';
    ctx.fillRect(R * 0.0, -R * 0.44, R * 0.16, R * 0.88);
  }

  // Damage flash
  if (a.flash > 0) {
    ctx.globalAlpha = clamp(a.flash * 3.2, 0, 0.8);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(0, 0, R * 1.05, R * 0.9, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/* ----------------------------------------------------------------- Actor -- */
class Actor {
  constructor(x, y, hp, faction) {
    this.x = x; this.y = y; this.hp = hp; this.maxHp = hp;
    this.faction = faction; this.alive = true; this.dying = 0;
    this.look = 0; this.walk = 0; this.moving = false;
    this.flash = 0; this.recoil = 0; this.radius = 13;
    this.vx = 0; this.vy = 0;
    this.cooldown = 0; this.reloading = 0; this.ammo = 0;
    this.weaponLen = 1.9; this.weaponKind = 'rifle';
  }

  hurt(dmg, ang, source, game) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.flash = 0.22;
    this.vx += Math.cos(ang) * 26; this.vy += Math.sin(ang) * 26;
    this.onHurt?.(dmg, source, game);
    if (this.hp <= 0) this.die(ang, game);
  }

  die(ang, game) {
    this.alive = false; this.dying = 0.55;
    this.hp = 0;
    FX.blood(this.x, this.y, ang || 0, 1.6);
    Audio2.death(this.x, this.y);
    this.onDeath?.(game);
  }

  /** Fires if the weapon is ready. Returns true when a shot left the barrel. */
  tryShoot(ang, game, spreadMul = 1) {
    if (this.cooldown > 0 || this.reloading > 0 || !this.alive) return false;
    const w = this.weapon;
    if (this.ammo <= 0) { this.startReload(); return false; }
    const a = ang + rand(-1, 1) * w.spread * spreadMul;
    const mx = this.x + Math.cos(ang) * this.radius * 1.9;
    const my = this.y + Math.sin(ang) * this.radius * 1.9;
    Bullets.fire(mx, my, a, w, this);
    FX.muzzle(mx, my, ang, this.faction === 'player' ? 1 : 0.8);
    FX.casing(this.x, this.y, ang);
    this.ammo--;
    this.cooldown = 1 / w.rps;
    this.recoil = 1;
    this.onShoot?.(ang, game);
    return true;
  }

  startReload() {
    if (this.reloading > 0 || this.ammo === this.weapon.mag) return;
    if (this.reserve !== undefined && this.reserve <= 0) return;
    this.reloading = this.weapon.reload;
    this.onReload?.();
  }

  finishReload() {
    const w = this.weapon;
    if (this.reserve !== undefined) {
      const need = w.mag - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take; this.reserve -= take;
    } else this.ammo = w.mag;
  }

  baseUpdate(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this.finishReload(); this.onReloadDone?.(); }
    }
    // knockback decay
    this.x += this.vx * dt; this.y += this.vy * dt;
    const d = Math.exp(-9 * dt);
    this.vx *= d; this.vy *= d;
  }
}

/* ---------------------------------------------------------------- Player -- */
class Player extends Actor {
  constructor(x, y) {
    super(x, y, CFG.PLAYER_HP, 'police');
    this.faction = 'police';
    this.isPlayer = true;
    this.weapon = WEAPONS.sten;
    this.weaponKind = 'sten';
    this.weaponLen = 1.6;
    this.ammo = this.weapon.mag;
    this.reserve = this.weapon.reserve;
    this.radius = 13;
    this.speedMod = 1;
    this.heat = 0;
    this.hurtCooldown = 0;
    this.palette = {
      shirt: '#867a52', shorts: '#4c4630', skin: '#a3754c',
      hat: '#14141a', hatStyle: 'songkok', webbing: '#3f3a28',
    };
  }

  update(dt, game) {
    this.baseUpdate(dt);
    if (!this.alive) { this.dying = Math.max(0, this.dying - dt); return; }
    // Wounds are dressed once you are out of contact for a few seconds. This
    // keeps a bad exchange from ending the run outright.
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (this.hurtCooldown <= 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 7 * dt);
    }

    /* --- movement --- */
    let mx = 0, my = 0;
    if (Input.down('a', 'arrowleft')) mx -= 1;
    if (Input.down('d', 'arrowright')) mx += 1;
    if (Input.down('w', 'arrowup')) my -= 1;
    if (Input.down('s', 'arrowdown')) my += 1;
    const len = Math.hypot(mx, my);
    this.moving = len > 0;
    if (this.moving) {
      mx /= len; my /= len;
      const sp = CFG.PLAYER_SPEED * this.speedMod * (this.reloading > 0 ? 0.82 : 1);
      this.x += mx * sp * dt; this.y += my * sp * dt;
      this.walk += dt * 9;
      if (Math.sin(this.walk * 2) > 0.96) FX.spawn(this.x, this.y + 6, rand(-10, 10), rand(-6, 6),
        { life: 0.32, size: 2.4, color: '120,102,74', grow: 8, fade: 0.5, drag: 3 });
    } else this.walk += dt * 2;

    World.collide(this, this.radius);

    /* --- aiming --- */
    this.look = Math.atan2(Input.mouse.wy - this.y, Input.mouse.wx - this.x);

    /* --- firing --- */
    const w = this.weapon;
    if (Input.mouse.down && this.reloading <= 0) {
      if (this.ammo > 0) {
        const spreadMul = (this.moving ? 1.7 : 1) * (1 + this.heat * 0.9);
        if (this.tryShoot(this.look, game, spreadMul)) {
          this.heat = Math.min(1, (this.heat || 0) + 0.16);
          game.camera.addShake(1.6);
          Audio2.playerShot(this.x, this.y);
          game.stats.shots++;
        }
      } else if (Input.mouse.clicked) {
        Audio2.dryFire();
        this.startReload();
      }
    }
    this.heat = Math.max(0, (this.heat || 0) - dt * 1.1);
    if (Input.hit('r')) this.startReload();
    if (this.ammo === 0 && this.reloading <= 0) this.startReload();
  }

  onReload() { Audio2.reloadOut(); }
  onReloadDone() { Audio2.reloadIn(); }

  onHurt(dmg, source, game) {
    this.hurtCooldown = 4;
    game.camera.addShake(5);
    game.damageVignette = 1;
    if (source && source !== this) game.addDamageArc(Math.atan2(source.y - this.y, source.x - this.x));
    Audio2.hurt();
  }
  onDeath(game) { game.onPlayerDown(); }
}

/* ---------------------------------------------------------------- Police -- */
class Police extends Actor {
  constructor(x, y, name) {
    super(x, y, CFG.POLICE_HP, 'police');
    this.weapon = WEAPONS.lee;
    this.ammo = this.weapon.mag;
    this.post = { x, y };
    this.name = name;
    this.radius = 12;
    this.target = null;
    this.aimTime = 0;
    this.scan = rand(0, TAU);
    this.noContact = 0;
    this.palette = {
      shirt: '#6f6749', shorts: '#413c29', skin: '#96693f',
      hat: '#15151b', hatStyle: 'songkok', webbing: '#3a3526',
    };
  }

  update(dt, game) {
    this.baseUpdate(dt);
    if (!this.alive) { this.dying = Math.max(0, this.dying - dt); return; }

    /* --- pick the most dangerous visible enemy --- */
    let best = null, bs = Infinity;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const d = dist(this.x, this.y, e.x, e.y);
      if (d > 410) continue;
      // Prioritise close targets and anyone already inside the wire.
      const score = d * (World.inCompound(e.x, e.y) ? 0.45 : 1);
      if (score < bs && World.lineOfSight(this.x, this.y, e.x, e.y)) { bs = score; best = e; }
    }
    this.target = best;

    /* --- hold the post, but do not ignore men inside the wire --- */
    // With nothing to shoot, a constable will leave his sandbags to deal with
    // anyone who has got into the compound — otherwise attackers can work on
    // the station's blind side completely unopposed.
    let anchor = this.post;
    if (!best) {
      this.noContact += dt;
      if (this.noContact > 2.2) {
        let intruder = null, bd2 = Infinity;
        for (const e of game.enemies) {
          if (!e.alive || !World.inCompound(e.x, e.y)) continue;
          const d = dist(this.post.x, this.post.y, e.x, e.y);
          if (d < bd2) { bd2 = d; intruder = e; }
        }
        if (intruder && bd2 < 330) anchor = intruder;      // leashed to the post
      }
    } else this.noContact = 0;

    const dp = dist(this.x, this.y, anchor.x, anchor.y);
    this.moving = false;
    const stopAt = anchor === this.post ? 26 : 200;         // engage, don't charge
    if (dp > stopAt) {
      const a = Math.atan2(anchor.y - this.y, anchor.x - this.x);
      const sp = anchor === this.post ? 70 : 96;
      this.x += Math.cos(a) * sp * dt; this.y += Math.sin(a) * sp * dt;
      this.moving = true; this.walk += dt * 8;
      this.look = approachAngle(this.look, a, dt * 5);
    }
    World.collide(this, this.radius);

    /* --- engage --- */
    if (best) {
      const want = Math.atan2(best.y - this.y, best.x - this.x);
      this.look = approachAngle(this.look, want, dt * 5.5);
      this.aimTime += dt;
      // Fire once settled on target — gives them a human reaction time.
      if (this.aimTime > 0.35 && Math.abs(angDiff(this.look, want)) < 0.12) {
        if (this.tryShoot(this.look, game, 1)) {
          Audio2.rifleShot(this.x, this.y);
          game.camera.addShake(dist(this.x, this.y, game.player.x, game.player.y) < 260 ? 0.7 : 0);
        }
      }
    } else {
      this.aimTime = 0;
      this.scan += dt * 0.55;
      const outward = Math.atan2(this.post.y - (World.station.y + 125), this.post.x - (World.station.x + 190));
      this.look = approachAngle(this.look, outward + Math.sin(this.scan) * 0.5, dt * 1.6);
    }
  }

  /** Incoming fire spoils a constable's aim — a simple suppression model. */
  onHurt() { this.aimTime = -0.3; }

  onDeath(game) {
    game.onPoliceDown(this);
  }
}

/* ---------------------------------------------------------------- Enemy --- */
const ENEMY_TYPES = {
  rifleman: {
    hp: 58, speed: 74, weapon: 'insurgentRifle', radius: 12, range: 400,
    palette: { shirt: '#4a5236', shorts: '#39402b', skin: '#8a6039', hat: '#333a26', hatStyle: 'cap', star: true, webbing: '#2f3423' },
  },
  rusher: {
    hp: 80, speed: 136, weapon: 'insurgentSmg', radius: 12, range: 170, melee: true,
    palette: { shirt: '#57492f', shorts: '#3d3320', skin: '#8f6339', hat: '#1d1710', hatStyle: 'band', webbing: '#2c2418' },
  },
  marksman: {
    hp: 46, speed: 62, weapon: 'marksmanRifle', radius: 12, range: 680, standoff: 520,
    palette: { shirt: '#3d4630', shorts: '#2f3626', skin: '#7d5735', hat: '#6f6448', hatStyle: 'straw', webbing: '#2a3020' },
  },
};

class Enemy extends Actor {
  constructor(x, y, type, tier = 0) {
    const T = ENEMY_TYPES[type];
    super(x, y, T.hp + tier * 6, 'insurgent');
    this.type = type; this.T = T;
    this.weapon = WEAPONS[T.weapon];
    this.weaponKind = T.weapon === 'insurgentSmg' ? 'sten' : 'rifle';
    this.ammo = this.weapon.mag;
    this.radius = T.radius;
    this.palette = T.palette;
    this.speed = T.speed * (1 + tier * 0.03);
    this.state = 'advance';
    this.cover = null;
    this.target = null;
    this.think = rand(0, 0.3);
    this.holdTimer = rand(4, 9);
    this.aimTime = 0;
    this.meleeCd = 0;
    this.accuracy = 0.55 + tier * 0.05;     // scales the spread applied to shots
    // Most attackers who get inside go after the defenders first; a minority
    // are set on burning the building whatever else is happening.
    // Later waves are increasingly there to burn the station down rather
    // than merely to trade fire with its defenders.
    this.arsonist = chance((T.melee ? 0.40 : 0.18) + tier * 0.09);
    this.look = 0;
    this.entry = null;
    this.stuckT = 0; this.stuck = 0; this.lastX = x; this.lastY = y;
  }

  /* ------------------------------------------------------------- AI ------ */
  update(dt, game) {
    this.baseUpdate(dt);
    if (!this.alive) { this.dying = Math.max(0, this.dying - dt); return; }
    this.think -= dt; this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.moving = false;

    if (this.think <= 0) { this.think = 0.28 + rand(0, 0.18); this._retarget(game); }

    switch (this.state) {
      case 'advance': this._advance(dt, game); break;
      case 'fight':   this._fight(dt, game);   break;
      case 'breach':  this._breach(dt, game);  break;
      case 'assault': this._assault(dt, game); break;
    }

    World.collide(this, this.radius, { ignoreFence: false });
    this._unstick(dt);
  }

  /**
   * Steering has no pathfinder, so an attacker can wedge itself against a wall
   * or a fence corner. If one stops making progress while it thinks it is
   * walking, flip its avoidance side, then abandon the plan outright — and cut
   * whatever wire is pinning it.
   */
  _unstick(dt) {
    this.stuckT += dt;
    if (this.stuckT < 0.6) return;
    const moved = dist(this.x, this.y, this.lastX, this.lastY);
    this.stuckT = 0; this.lastX = this.x; this.lastY = this.y;

    if (!this.moving || moved > 10) { this.stuck = 0; return; }

    this.stuck++;
    this._side = (this._side ?? 1) * -1;
    if (this.stuck < 3) return;

    this.stuck = 0;
    if (this.cover) { this.cover.taken = null; this.cover = null; }
    this.entry = null;
    // Only an attacker who is actually trying to get through the wire cuts it.
    // Otherwise this becomes free perimeter damage and the fence evaporates.
    if (this.state !== 'breach') return;
    const f = World.fenceAt(this.x + Math.cos(this.look) * (this.radius + 9),
                            this.y + Math.sin(this.look) * (this.radius + 9), 16)
           || World.fenceAt(this.x, this.y, this.radius + 16);
    if (f) {
      f.hp -= 20; f.hit = 0.2;
      FX.impact(f.x + f.w / 2, f.y + f.h / 2, this.look, 'wood');
      if (f.hp <= 0) { f.alive = false; FX.smoke(f.x + f.w / 2, f.y + f.h / 2, 2, '90,78,58'); }
    }
  }

  /**
   * Move toward a goal, routing around the station when it sits in the way.
   * Single-step avoidance cannot get around a building that large on its own.
   */
  _navTo(tx, ty, dt, mul = 1) {
    const S = World.station;
    if (segRect(this.x, this.y, tx, ty, S)) {
      const P = 34;
      const corners = [
        { x: S.x - P, y: S.y - P }, { x: S.x + S.w + P, y: S.y - P },
        { x: S.x - P, y: S.y + S.h + P }, { x: S.x + S.w + P, y: S.y + S.h + P },
      ];
      let best = null, bs = Infinity;
      for (const c of corners) {
        const score = dist(this.x, this.y, c.x, c.y) + dist(c.x, c.y, tx, ty);
        if (score < bs) { bs = score; best = c; }
      }
      if (best && dist(this.x, this.y, best.x, best.y) > 26) {
        this._moveToward(best.x, best.y, dt, mul);
        return;
      }
    }
    this._moveToward(tx, ty, dt, mul);
  }

  /** Choose the best visible defender to engage. */
  _retarget(game) {
    let best = null, bs = Infinity;
    for (const d of game.defenders) {
      if (!d.alive) continue;
      const dd = dist(this.x, this.y, d.x, d.y);
      if (dd > this.T.range) continue;
      if (!World.lineOfSight(this.x, this.y, d.x, d.y)) continue;
      const score = dd * (d.isPlayer ? 0.8 : 1);
      if (score < bs) { bs = score; best = d; }
    }
    this.target = best;

    if (this.T.melee) {
      this.state = World.inCompound(this.x, this.y) ? 'assault' : 'breach';
      return;
    }
    if (best && this.state !== 'breach' && this.state !== 'assault') this.state = 'fight';
  }

  _moveToward(tx, ty, dt, speedMul = 1, direct = false) {
    const a = Math.atan2(ty - this.y, tx - this.x);
    const sp = this.speed * speedMul;
    // Cheap obstacle avoidance: if the direct path is blocked, try sidesteps.
    let ang = a;
    const probe = 34;
    if (!direct && !this._clear(this.x + Math.cos(a) * probe, this.y + Math.sin(a) * probe)) {
      const l = a - 0.85, r = a + 0.85;
      const okL = this._clear(this.x + Math.cos(l) * probe, this.y + Math.sin(l) * probe);
      const okR = this._clear(this.x + Math.cos(r) * probe, this.y + Math.sin(r) * probe);
      ang = okL && !okR ? l : okR && !okL ? r : (this._side ??= chance(0.5) ? -1 : 1) < 0 ? l : r;
    }
    this.x += Math.cos(ang) * sp * dt;
    this.y += Math.sin(ang) * sp * dt;
    this.moving = true;
    this.walk += dt * 8.5;
    this.look = approachAngle(this.look, ang, dt * 6);
  }

  _clear(x, y) {
    for (const b of World.buildings) if (x > b.x - 14 && x < b.x + b.w + 14 && y > b.y - 14 && y < b.y + b.h + 14) return false;
    for (const s of World.sandbags) if (x > s.x - 12 && x < s.x + s.w + 12 && y > s.y - 12 && y < s.y + s.h + 12) return false;
    for (const t of World.trees) if (dist2(x, y, t.x, t.y) < (t.r * 0.6 + 12) ** 2) return false;
    // Live wire counts as an obstacle, so gate-seekers slide along it to the gap
    for (const f of World.fences) {
      if (!f.alive) continue;
      if (x > f.x - 11 && x < f.x + f.w + 11 && y > f.y - 11 && y < f.y + f.h + 11) return false;
    }
    if (x < World.river.w + 14) return false;
    return true;
  }

  /** Distance from this attacker to the middle of the station. */
  _range() {
    const S = World.station;
    return dist(this.x, this.y, S.x + S.w / 2, S.y + S.h / 2);
  }

  /** Move up to a firing position outside the wire, always pressing inward. */
  _advance(dt, game) {
    if (!this.cover || (this.cover.taken && this.cover.taken !== this && this.cover.taken.alive)) {
      this.cover = World.claimCover(this, this.x, this.y, this._range(), this.T.standoff || 0);
    }
    if (!this.cover) {                        // nothing closer is free — go in
      this.state = this.T.standoff ? 'fight' : 'breach';
      this.holdTimer = rand(5, 10);
      return;
    }
    const d = dist(this.x, this.y, this.cover.x, this.cover.y);
    if (d < 24) {
      this.state = 'fight';
      this.holdTimer = rand(5, 11);
    } else {
      this._moveToward(this.cover.x, this.cover.y, dt, d > 200 ? 1 : 0.78);
    }
  }

  /** Shoot from cover; reposition periodically so the fight keeps moving. */
  _fight(dt, game) {
    this.holdTimer -= dt;
    const S = World.station;
    let tx, ty, shooting = false;

    if (this.target && this.target.alive && World.lineOfSight(this.x, this.y, this.target.x, this.target.y)) {
      tx = this.target.x; ty = this.target.y; shooting = true;
    } else {
      // No defender in view — put rounds into the station itself. The station
      // must be excluded from the sight test or it blocks the shot at itself.
      const aim = World.stationAim(this.x, this.y);
      if (this._range() < 640 && World.lineOfSight(this.x, this.y, aim.x, aim.y, S)) {
        tx = aim.x + rand(-30, 30); ty = aim.y + rand(-24, 24); shooting = true;
      }
    }

    if (shooting) {
      const want = Math.atan2(ty - this.y, tx - this.x);
      this.look = approachAngle(this.look, want, dt * 4.2);
      this.aimTime += dt;
      if (this.aimTime > 0.4 && Math.abs(angDiff(this.look, want)) < 0.16) {
        const spreadMul = 1.6 - this.accuracy * 0.5;
        if (this.tryShoot(this.look, game, spreadMul)) Audio2.enemyShot(this.x, this.y);
      }
    } else {
      this.aimTime = 0;
      this.holdTimer -= dt * 2.5;      // nothing to shoot — push forward sooner
    }

    if (this.holdTimer <= 0) {
      if (this.T.standoff && this._range() < this.T.standoff + 90) {
        this.holdTimer = rand(6, 11);          // marksmen keep their standoff
      } else {
        // Creep to a closer position, or push through the wire when brave.
        if (this.cover) this.cover.taken = null;
        this.cover = null;
        this.state = (!this.T.standoff && chance(0.35)) ? 'breach' : 'advance';
        this.holdTimer = rand(5, 10);
      }
    }
  }

  /** Choose a way in: an open gate, or a panel of wire to cut through. */
  _pickEntry() {
    const gate = World.nearestEntry(this.x, this.y);
    // Rushers habitually cut their own gap; riflemen usually use the gates.
    if (chance(this.T.melee ? 0.5 : 0.15)) {
      const f = World.nearestFence(this.x, this.y);
      if (f) return { x: f.x + f.w / 2, y: f.y + f.h / 2, cut: true };
    }
    return gate || World.gates[0];
  }

  /** Head for a gate or cut through the fence. */
  _breach(dt, game) {
    if (World.inCompound(this.x, this.y)) { this.state = 'assault'; this.entry = null; return; }
    if (!this.entry) this.entry = this._pickEntry();
    const e = this.entry;

    // Cut the wire if a panel is right in front of us.
    const fx = this.x + Math.cos(this.look) * (this.radius + 9);
    const fy = this.y + Math.sin(this.look) * (this.radius + 9);
    const f = World.fenceAt(fx, fy, 11);
    if (f && this.meleeCd <= 0) {
      f.hp -= this.T.melee ? 20 : 11;
      f.hit = 0.2;
      this.meleeCd = 0.55;
      FX.impact(fx, fy, this.look, 'wood');
      Audio2.hitWood(fx, fy);
      if (f.hp <= 0) {
        f.alive = false;
        FX.smoke(f.x + f.w / 2, f.y + f.h / 2, 2, '90,78,58');
        FX.impact(f.x + f.w / 2, f.y + f.h / 2, this.look, 'wood');
      }
      return;
    }

    if (e.cut) this._moveToward(e.x, e.y, dt, 1, true);
    else this._navTo(e.x, e.y, dt, 1);

    // A cut target that has already been flattened is no longer interesting.
    if (e.cut && !World.fenceAt(e.x, e.y, 14)) this.entry = null;

    // Return fire on the move if a defender is close and exposed.
    if (this.target && this.target.alive && dist(this.x, this.y, this.target.x, this.target.y) < 260 &&
        World.lineOfSight(this.x, this.y, this.target.x, this.target.y) && chance(0.4)) {
      const want = Math.atan2(this.target.y - this.y, this.target.x - this.x);
      this.look = approachAngle(this.look, want, dt * 6);
      if (this.tryShoot(this.look, game, 2.0 - this.accuracy * 0.5)) Audio2.enemyShot(this.x, this.y);
    }
  }

  /** Inside the wire: attack defenders, or set about the station itself. */
  _assault(dt, game) {
    if (this.target && this.target.alive) {
      const d = dist(this.x, this.y, this.target.x, this.target.y);
      const want = Math.atan2(this.target.y - this.y, this.target.x - this.x);
      this.look = approachAngle(this.look, want, dt * 6);
      if (d > 90) this._navTo(this.target.x, this.target.y, dt, 1);
      else if (this.T.melee && d < 34) {
        if (this.meleeCd <= 0) {
          this.meleeCd = 0.9;
          this.target.hurt(13, want, this, game);
          FX.blood(this.target.x, this.target.y, want, 0.7);
          game.camera.addShake(this.target.isPlayer ? 6 : 1);
        }
      } else if (World.lineOfSight(this.x, this.y, this.target.x, this.target.y)) {
        if (this.tryShoot(this.look, game, 1.6 - this.accuracy * 0.5)) Audio2.enemyShot(this.x, this.y);
      }
      return;
    }

    // Nothing in sight. Non-arsonists look for a defender close by; if there is
    // none they take up a firing position and shoot the building from a
    // distance rather than walking across the compound after the player. A
    // long chase radius here turns the player into a magnet that drags the
    // whole attacking force inside the wire.
    if (!this.arsonist) {
      let best = null, bd = Infinity;
      for (const d of game.defenders) {
        if (!d.alive) continue;
        const dd = dist(this.x, this.y, d.x, d.y);
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best && bd < 240) { this._navTo(best.x, best.y, dt, 1); return; }

      const spot = World.stationAim(this.x, this.y);
      if (this._range() > 220) { this._navTo(spot.x, spot.y, dt, 0.85); return; }
      this.look = approachAngle(this.look, Math.atan2(spot.y - this.y, spot.x - this.x), dt * 5);
      if (this.tryShoot(this.look, game, 1.6 - this.accuracy * 0.5)) Audio2.enemyShot(this.x, this.y);
      return;
    }

    // Arsonists close with the building and set about it.
    const aim = World.stationAim(this.x, this.y);
    if (dist(this.x, this.y, aim.x, aim.y) > this.radius + 16) {
      this._moveToward(aim.x, aim.y, dt, 1);
      return;
    }

    this.look = approachAngle(this.look, Math.atan2(aim.y - this.y, aim.x - this.x), dt * 6);
    if (this.meleeCd <= 0) {
      this.meleeCd = 1.0;
      const hx = this.x + Math.cos(this.look) * 16, hy = this.y + Math.sin(this.look) * 16;
      game.damageStation(this.T.melee ? 6 : 3, hx, hy);
      FX.impact(hx, hy, this.look, 'wood');
      Audio2.stationHit(hx, hy);
      // Attackers who reach the walls try to set the building alight.
      if (this.T.melee && chance(0.05 + game.waveIndex * 0.02)) game.addFire(hx, hy);
    }
  }

  onDeath(game) {
    if (this.cover) this.cover.taken = null;
    game.onEnemyDown(this);
  }
}
