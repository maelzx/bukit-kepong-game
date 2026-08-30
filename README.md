# BUKIT KEPONG — 23 FEBRUARY 1950

A top-down 2D browser game: defend the Bukit Kepong police station through a
pre-dawn assault. Vanilla HTML5 / CSS3 / JavaScript on a Canvas — no build step,
no dependencies, no external assets.

> **This is a dramatised interactive interpretation of a historical event, not a
> documentary reconstruction.** The map, the characters, the wave structure and
> every statistic in it are gameplay inventions. See [HISTORY.md](HISTORY.md)
> for the historical note and a full list of the abstractions.

## Running it

Open `public/index.html` in any modern browser. That's the whole install.
Everything the game needs is inside `public/`; nothing outside it is served.

Sound is synthesised at runtime with the Web Audio API, so browsers will hold it
until your first click — press START and audio begins.

## Difficulty

Chosen on the title screen.

| | |
| --- | --- |
| **RECRUIT** | Assisted aim and automatic fire, fewer attackers, and you take less punishment. The assist picks whoever is closest to where your mouse already points, so you still choose the target — you just don't have to track it by hand. A lock-on bracket shows what your weapon is following. |
| **CONSTABLE** | You aim and fire yourself. |

RECRUIT exists so the game can be played for its actual decisions — where to
stand, which threat to answer, when to leave the firing line to fight a fire —
without demanding precise aim. Both modes are tuned separately in
`DIFFICULTIES` at the top of `public/src/core.js`.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| Mouse | Aim |
| Left click | Fire the Sten gun |
| `R` | Reload |
| `SPACE` | Beat out a fire (stand at the flames) |
| `ESC` / `P` | Pause |
| `M` | Mute |

## The mission

Hold the station for five minutes against eight waves of communist insurgents.

- The **station has its own structural integrity**. If it reaches zero, the
  position is lost — the timer does not save you.
- **Six constables** hold the sandbag posts at the gates. They shoot, they take
  casualties, and they cannot be replaced.
- Attackers who reach the walls will **set the building alight**. A fire burns
  the station down until somebody puts it out. That somebody is you, and doing
  it means leaving the firing line.
- Riflemen fire from cover, rushers cut the wire and close to hand, marksmen
  shoot from the treeline. Pressure rises through numbers, attack directions and
  behaviour — not through inflated hit points.

## Layout

`public/` is the deployable site — it is exactly what a static host should
serve, and nothing in it is a build artifact. Everything else in the repository
is documentation or development tooling and stays out of the deployment.

```
public/
  index.html      markup + HUD, link-preview metadata, inline SVG favicon
  style.css       presentation
  og.jpg          link-preview card (1200x630)
  apple-touch-icon.png
  game.js         game loop, state machine, wave director, render pipeline
  src/core.js     config, maths, input, camera
  src/world.js    map layout, terrain pre-render, collision, cover
  src/entities.js bullets, figure renderer, Player / Police / Enemy
  src/fx.js       pooled particles, decals, lighting flashes
  src/audio.js    Web Audio synthesis
  src/score.js    end-of-mission scoring and personal bests
  src/ui.js       DOM HUD, screens, minimap
tools/            headless dev tools (not part of the game)
```

## Deploying

Any static host will do — there is no build step and no server-side code. Point
the host at `public/` as the output directory and leave the build command empty.

On Cloudflare Pages: framework preset **None**, build command **empty**, build
output directory **`public`**.

The link-preview tags in `index.html` carry absolute URLs, since scrapers do not
resolve relative ones reliably. They point at `https://bukit-kepong-game.isha.workers.dev`
— change `og:url`, `og:image`, `twitter:image` and the canonical link together if
the site moves.

## Dev tools

`tools/` loads the game in Node behind stub Canvas/DOM objects so it can be run
without a browser. It is not shipped with the game.

```sh
node tools/smoke.js        # exercises every system, screen and the render path
node tools/balance.js 8           # mission soaks on CONSTABLE
node tools/balance.js 8 easy      # ...or on RECRUIT
```

Key balance constants live in `public/src/core.js` (`CFG`) and the `WAVES` table
at the top of `public/game.js`. To play a longer mission, raise
`CFG.MISSION_DURATION`. Scoring weights are in `public/src/score.js` (`SCORE`).

`tools/harness.js` loads the game from `public/`, so any new source file must be
added to its file list or the headless tests will not see it.
