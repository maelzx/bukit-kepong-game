/* =============================================================================
   UI — DOM heads-up display, screens and the minimap.
   The HUD is plain DOM so text stays crisp; only the minimap is canvas.
   ========================================================================== */
'use strict';

const UI = {
  el: {},
  _cache: {},
  minimapCtx: null,

  init(handlers) {
    const $ = id => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      health: $('bar-health'), healthTxt: $('txt-health'),
      station: $('bar-station'), stationTxt: $('txt-station'),
      ammo: $('txt-ammo'), reserve: $('txt-reserve'), reload: $('reload-ind'), reloadFill: $('reload-fill'),
      wave: $('txt-wave'), enemies: $('txt-enemies'), time: $('txt-time'),
      objective: $('txt-objective'), banner: $('banner'), bannerSub: $('banner-sub'),
      screens: {
        title: $('screen-title'), howto: $('screen-howto'), pause: $('screen-pause'),
        over: $('screen-over'), win: $('screen-win'),
      },
      minimap: $('minimap'),
      pips: $('section-pips'), sectionTxt: $('txt-section'),
      mute: $('btn-mute'),
      stats: $('stats-list'), overStats: $('over-stats'),
      lowHealth: $('low-health'),
    };
    this.minimapCtx = this.el.minimap.getContext('2d');

    const bind = (id, fn) => { const e = $(id); if (e) e.addEventListener('click', () => { Audio2.init(); Audio2.resume(); Audio2.click(); fn(); }); };
    bind('btn-start', handlers.start);
    bind('btn-howto', () => this.show('howto'));
    bind('btn-howto-back', () => this.show('title'));
    bind('btn-resume', handlers.resume);
    bind('btn-pause-menu', handlers.menu);
    bind('btn-retry', handlers.retry);
    bind('btn-over-menu', handlers.menu);
    bind('btn-win-menu', handlers.menu);
    bind('btn-win-again', handlers.retry);
    this.el.mute.addEventListener('click', () => {
      Audio2.init();
      const m = Audio2.toggle();
      this.el.mute.textContent = m ? 'SOUND: OFF' : 'SOUND: ON';
      this.el.mute.classList.toggle('off', m);
    });
  },

  resetCaches() { this._cache = {}; this._pipCount = -1; this._pipUp = -1; },

  show(name) {
    for (const k in this.el.screens) this.el.screens[k].classList.toggle('active', k === name);
    document.body.classList.toggle('in-game', name === null || name === 'pause');
  },
  hideAll() { for (const k in this.el.screens) this.el.screens[k].classList.remove('active'); },

  setText(key, node, value) {
    if (this._cache[key] === value) return;
    this._cache[key] = value; node.textContent = value;
  },
  setWidth(key, node, pct) {
    const v = Math.round(pct * 100) / 100;
    if (this._cache[key] === v) return;
    this._cache[key] = v; node.style.width = v + '%';
  },

  /* -------------------------------------------------------------- update -- */
  update(g) {
    const p = g.player;
    const hp = clamp(p.hp / p.maxHp, 0, 1);
    this.setWidth('hp', this.el.health, hp * 100);
    this.setText('hpt', this.el.healthTxt, `${Math.max(0, Math.ceil(p.hp))}`);
    this.el.health.classList.toggle('crit', hp < 0.3);
    this.el.lowHealth.style.opacity = hp < 0.35 ? String((0.35 - hp) * 1.8) : '0';

    const st = clamp(g.stationHp / CFG.STATION_HP, 0, 1);
    this.setWidth('st', this.el.station, st * 100);
    this.setText('stt', this.el.stationTxt, `${Math.max(0, Math.ceil(st * 100))}%`);
    this.el.station.classList.toggle('crit', st < 0.3);

    // Section strength — how many constables are still on their feet
    const up = g.police.reduce((n, p2) => n + (p2.alive ? 1 : 0), 0);
    if (this._pipCount !== g.police.length) {
      this._pipCount = g.police.length;
      this.el.pips.innerHTML = g.police.map(() => '<i></i>').join('');
    }
    if (this._pipUp !== up) {
      this._pipUp = up;
      const nodes = this.el.pips.children;
      g.police.forEach((p2, i) => nodes[i] && nodes[i].classList.toggle('down', !p2.alive));
      this.setText('sec', this.el.sectionTxt, `${up}/${g.police.length}`);
    }

    this.setText('ammo', this.el.ammo, String(p.ammo).padStart(2, '0'));
    this.setText('res', this.el.reserve, String(p.reserve));
    const reloading = p.reloading > 0;
    if (this.el.reload.classList.contains('on') !== reloading) this.el.reload.classList.toggle('on', reloading);
    if (reloading) this.el.reloadFill.style.width = (100 * (1 - p.reloading / p.weapon.reload)) + '%';

    const alive = g.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    this.setText('wave', this.el.wave, g.waveIndex > 0 ? `WAVE ${g.waveIndex}` : 'STAND TO');
    this.setText('en', this.el.enemies, `${alive} HOSTILE${alive === 1 ? '' : 'S'}`);

    const left = Math.max(0, g.missionTime);
    const m = Math.floor(left / 60), s = Math.floor(left % 60);
    this.setText('time', this.el.time, `${m}:${String(s).padStart(2, '0')}`);

    this.setText('obj', this.el.objective, g.objectiveText);
    this.drawMinimap(g);
  },

  banner(text, sub = '', dur = 2.6) {
    this.el.banner.textContent = text;
    this.el.bannerSub.textContent = sub;
    this.el.banner.parentElement.classList.remove('show');
    void this.el.banner.parentElement.offsetWidth;   // restart the CSS animation
    this.el.banner.parentElement.classList.add('show');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.el.banner.parentElement.classList.remove('show'), dur * 1000);
  },

  /* ------------------------------------------------------------- minimap -- */
  drawMinimap(g) {
    const c = this.minimapCtx, W = this.el.minimap.width, H = this.el.minimap.height;
    const sx = W / CFG.WORLD_W, sy = H / CFG.WORLD_H;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#1b2018'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#24333a'; c.fillRect(0, 0, World.river.w * sx, H);

    const C = World.compound;
    c.fillStyle = 'rgba(120,100,66,0.34)';
    c.fillRect(C.x * sx, C.y * sy, C.w * sx, C.h * sy);
    c.strokeStyle = 'rgba(190,164,110,0.6)'; c.lineWidth = 1;
    c.strokeRect(C.x * sx, C.y * sy, C.w * sx, C.h * sy);

    const S = World.station;
    c.fillStyle = g.stationHp / CFG.STATION_HP < 0.35 ? '#c4552f' : '#c9a35a';
    c.fillRect(S.x * sx, S.y * sy, S.w * sx, S.h * sy);

    for (const f of g.fires) {
      c.fillStyle = 'rgba(255,150,50,0.9)';
      c.beginPath(); c.arc(f.x * sx, f.y * sy, 2.6, 0, TAU); c.fill();
    }
    for (const d of g.defenders) {
      if (!d.alive) continue;
      c.fillStyle = d.isPlayer ? '#eaf2ff' : '#7fd2a0';
      const r = d.isPlayer ? 2.6 : 1.9;
      c.beginPath(); c.arc(d.x * sx, d.y * sy, r, 0, TAU); c.fill();
    }
    for (const e of g.enemies) {
      if (!e.alive) continue;
      c.fillStyle = '#d9503f';
      c.beginPath(); c.arc(e.x * sx, e.y * sy, 1.8, 0, TAU); c.fill();
    }
  },

  fillStats(g, node) {
    const rows = [
      ['Insurgents accounted for', g.stats.kills],
      ['Shots fired', g.stats.shots],
      ['Accuracy', g.stats.shots ? Math.round(100 * g.stats.hits / g.stats.shots) + '%' : '—'],
      ['Constables lost', g.stats.policeLost + ' of ' + g.stats.policeTotal],
      ['Station integrity', Math.max(0, Math.round(100 * g.stationHp / CFG.STATION_HP)) + '%'],
      ['Time held', `${Math.floor(g.elapsed / 60)}:${String(Math.floor(g.elapsed % 60)).padStart(2, '0')}`],
    ];
    node.innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
  },
};
