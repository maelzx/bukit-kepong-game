/* DEV TOOL — headless smoke test: exercises every screen, state transition and
   the full render path (against stub canvases) looking for thrown errors. */
'use strict';
const { loadGame } = require('./harness.js');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ' -> ' + e.message + '\n' + e.stack.split('\n')[1]); }
};

const api = loadGame();
const { Game, World, FX, Bullets, Input, CFG, UI } = api;

check('title screen renders', () => { Game.state = 'title'; Game.render(); });

check('startRun initialises a mission', () => {
  Game.startRun();
  if (Game.state !== 'playing') throw new Error('state=' + Game.state);
  if (Game.police.length !== 6) throw new Error('police=' + Game.police.length);
  if (Math.round(Game.missionTime) !== CFG.MISSION_DURATION) throw new Error('timer');
});

check('simulates 90s of combat and renders every second', () => {
  for (let i = 0; i < 60 * 90; i++) {
    Game.update(1 / 60); Input.endFrame();
    if (i % 60 === 0) Game.render();
  }
  if (Game.stats.kills === 0) throw new Error('no kills in 90s — AI is not engaging');
});

check('bullets and the particle pool work', () => {
  if (Game.enemies.length === 0) throw new Error('no enemies spawned');

  const before = FX.particles.filter(x => x.alive).length;
  FX.muzzle(500, 500, 0);
  FX.blood(500, 500, 0);
  FX.impact(500, 500, 0, 'wood');
  if (FX.particles.filter(x => x.alive).length <= before) throw new Error('particle pool did not fill');

  const live = Bullets.pool.filter(b => b.alive).length;
  Bullets.fire(500, 500, 0, Game.player.weapon, Game.player);
  if (Bullets.pool.filter(b => b.alive).length !== live + 1) throw new Error('bullet pool did not fill');

  // the pool must never grow beyond its fixed size
  for (let i = 0; i < CFG.BULLET_MAX * 2; i++) Bullets.fire(500, 500, 0, Game.player.weapon, Game.player);
  if (Bullets.pool.length !== CFG.BULLET_MAX) throw new Error('bullet pool grew');
  Bullets.clear();
});

check('renders with fires burning', () => {
  Game.addFire(); Game.addFire();
  for (let i = 0; i < 120; i++) { Game.update(1 / 60); Input.endFrame(); }
  Game.render();
  if (!Game.fires.length) throw new Error('fires vanished');
});

check('SPACE puts fires out', () => {
  const f = Game.fires[0];
  const before = Game.fires.length;
  // stand just outside the wall the fire is seated against
  const W = World.station;
  const spot = { x: f.x, y: f.y };
  if (f.x <= W.x + 20) spot.x = W.x - 24;
  else if (f.x >= W.x + W.w - 20) spot.x = W.x + W.w + 24;
  else if (f.y <= W.y + 20) spot.y = W.y - 24;
  else spot.y = W.y + W.h + 24;
  const real = Input.down.bind(Input);
  Input.down = (...k) => (k.includes(' ') ? true : false);
  for (let i = 0; i < 60 * 3; i++) {
    Game.player.x = spot.x; Game.player.y = spot.y;
    Game.update(1 / 60); Input.endFrame();
  }
  Input.down = real;
  if (Game.fires.length >= before) throw new Error('fire not extinguished');
});

check('damaged station renders every damage state', () => {
  for (const pct of [0.7, 0.45, 0.2]) {
    Game.stationHp = CFG.STATION_HP * pct;
    Game.render();
  }
});

check('pause freezes the clock and renders', () => {
  Game.setPaused(true);
  if (Game.state !== 'paused') throw new Error('not paused');
  const t = Game.elapsed;
  Game.render();
  if (Game.elapsed !== t) throw new Error('clock advanced while paused');
  Game.setPaused(false);
  if (Game.state !== 'playing') throw new Error('did not resume');
});

check('station destruction ends the mission', () => {
  Game.damageStation(999999, Game.player.x, Game.player.y);
  if (Game.state !== 'over') throw new Error('state=' + Game.state);
  Game.render();
});

check('retry resets every mission variable', () => {
  Game.startRun();
  if (Game.stationHp !== CFG.STATION_HP) throw new Error('station hp');
  if (Game.enemies.length !== 0) throw new Error('stale enemies');
  if (Game.fires.length !== 0) throw new Error('stale fires');
  if (Game.stats.kills !== 0) throw new Error('stale stats');
  if (World.fences.some(f => !f.alive)) throw new Error('fences not repaired');
  if (Game.player.hp !== CFG.PLAYER_HP) throw new Error('player hp');
});

check('player death ends the mission', () => {
  Game.player.hurt(9999, 0, Game.player, Game);
  if (Game.state !== 'over') throw new Error('state=' + Game.state);
});

check('surviving the clock wins', () => {
  Game.startRun();
  Game.missionTime = 0.001;
  Game.update(1 / 60);
  if (Game.state !== 'win') throw new Error('state=' + Game.state);
  UI.fillStats(Game, UI.el.stats);
});

check('returning to the menu works', () => {
  Game.toMenu();
  if (Game.state !== 'title') throw new Error('state=' + Game.state);
  Game.render();
});

check('weapon: fire, empty, reload, resupply', () => {
  Game.startRun();
  const P = Game.player;
  const mag = P.weapon.mag, reserve0 = P.reserve;
  for (let i = 0; i < mag; i++) { P.cooldown = 0; P.tryShoot(0, Game); }
  if (P.ammo !== 0) throw new Error('ammo=' + P.ammo);
  P.startReload();
  for (let i = 0; i < 60 * 3; i++) { Game.update(1 / 60); Input.endFrame(); }
  if (P.ammo !== mag) throw new Error('did not reload: ' + P.ammo);
  if (P.reserve !== reserve0 - mag) throw new Error('reserve=' + P.reserve);
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll smoke tests passed.');
process.exit(failures ? 1 : 0);
