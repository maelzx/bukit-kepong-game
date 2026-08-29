/* DEV TOOL — headless balance soak. Usage: node tools/balance.js [runs] */
'use strict';
const { loadGame } = require('./harness.js');

/** Run one mission. mode: 'idle' | 'bot' */
function run(mode, diff = 'normal') {
  const pro = mode === 'pro';
  const api = loadGame();
  const { Game, World, Input, CFG, dist, DIFFICULTIES } = api;
  Game.difficulty = DIFFICULTIES[diff];
  Game.startRun();

  const P = Game.player;
  let wantSpace = false;
  if (mode === 'idle') P.hurt = () => {};          // isolate station pressure
  if (mode !== 'idle') {
    const realDown = Input.down.bind(Input);
    Input.down = (...k) => (k.includes(' ') ? wantSpace : false);
    api.__restore = () => { Input.down = realDown; };
  }

  const post = { x: World.station.x + 170, y: World.station.y + 286 };
  const cover = { x: World.station.x + 170, y: World.station.y - 46 };
  for (let i = 0; i < 60 * 380; i++) {
    if (Game.state !== 'playing') break;

    if (mode !== 'idle') {
      wantSpace = false;
      // Minimal competent play: fight fires first, break contact behind the
      // station when badly hurt, otherwise hold the veranda post.
      let goal = post;
      const hurt = P.hp < P.maxHp * 0.45;
      if (Game.fires.length && !hurt) {
        const f = Game.fires[0];
        goal = { x: f.x, y: f.y + 34 };
        if (dist(P.x, P.y, f.x, f.y) < 50) wantSpace = true;
      } else if (hurt) {
        goal = cover;                       // duck behind the building to heal
      } else if (pro) {
        // The intended strategy: hunt down whoever has got inside the wire,
        // rather than sitting on one post and letting them burn the place.
        let best = null, bd = Infinity;
        for (const e of Game.enemies) {
          if (!e.alive || !World.inCompound(e.x, e.y)) continue;
          const d = dist(P.x, P.y, e.x, e.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best && bd > 210) goal = { x: best.x, y: best.y + 130 };
      }
      const gd = dist(P.x, P.y, goal.x, goal.y);
      if (gd > 16) { P.x += (goal.x - P.x) / gd * CFG.PLAYER_SPEED / 60; P.y += (goal.y - P.y) / gd * CFG.PLAYER_SPEED / 60; }
    }

    let t = null, bd = 1e9;
    if (mode !== 'idle') {
      for (const e of Game.enemies) {
        if (!e.alive) continue;
        const d = dist(P.x, P.y, e.x, e.y);
        if (d < 520 && d < bd && World.lineOfSight(P.x, P.y, e.x, e.y)) { bd = d; t = e; }
      }
    }

    Game.update(1 / 60);
    Input.endFrame();

    if (mode !== 'idle' && t && P.alive && !wantSpace) {
      const a = Math.atan2(t.y - P.y, t.x - P.x);
      P.look = a;
      if (P.ammo > 0) { if (P.tryShoot(a, Game, 1.1)) Game.stats.shots++; }
      else P.startReload();
    }
  }
  return {
    end: Game.state,
    t: Math.round(Game.elapsed),
    stationPct: Math.round(100 * Game.stationHp / CFG.STATION_HP),
    wave: Game.waveIndex,
    kills: Game.stats.kills,
    policeLost: Game.stats.policeLost,
    playerHp: Math.round(Game.player.hp),
    breaches: World.fences.filter(f => !f.alive).length,
  };
}

function summarise(label, rows) {
  const wins = rows.filter(r => r.end === 'win').length;
  const avg = k => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length);
  console.log(`\n${label}  —  ${wins}/${rows.length} held the station`);
  console.log(`  avg station ${avg('stationPct')}%  wave ${avg('wave')}  kills ${avg('kills')}  constables lost ${avg('policeLost')}  breaches ${avg('breaches')}`);
  for (const r of rows) console.log('   ', JSON.stringify(r));
}

const N = Number(process.argv[2] || 4);
const DIFF = process.argv[3] || 'normal';
console.log(`difficulty: ${DIFF}`);
summarise('IDLE PLAYER (invulnerable, does nothing)', Array.from({ length: N }, () => run('idle', DIFF)));
summarise('BOT — holds one post, fights fires', Array.from({ length: N }, () => run('bot', DIFF)));
summarise('BOT — plays the intended strategy (hunts breachers)', Array.from({ length: N }, () => run('pro', DIFF)));
