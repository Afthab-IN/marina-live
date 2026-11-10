# Marina, Live: architecture and phased plan

Status: approved on 10 Nov 2026 and built. See README.md for how to run it and regenerate the data.

## Context

You want an interactive 3D model of the Marina Beach corridor in Chennai, in the style of
indiranagar-live.vercel.app: a static Vite + three.js site, all data preprocessed offline and
committed, honest about what is mapped and what is illustrated. Answers so far: project venv OK,
try Google 2.5D heights (500 MB cap), all four extra landmark groups, deploy to GitHub Pages now
and move to Vercel after the block lifts on 5 Dec.

## What I found

**Reference site** (read its HTML, 683 KB viewer bundle and scene data, ran it in Chrome):
- One static page. JS 197 KB compressed; data `scene.json` + `scene.bin` about 1.6 MB compressed, for 1 km².
- Two camera modes: Isometric (orthographic, fixed tilt of 54.7 degrees, left-drag pans, right-drag turns, zoom to cursor) and Orbit (perspective).
- Place buttons, a time slider (5 am to 11 pm) with Morning / Afternoon / Golden hour / Night, a month slider ("sun path follows the month"), toggles for Labels, Traffic, Miniature lens. Keys: Q/E turn 90 degrees, N night, H hides the HUD. URL params `t`, `m`, `q`.
- Procedural façade shader (floors, windows, shopfronts, lit windows at night), one 4096 shadow map fitted to the visible area every frame, a final pass doing tone mapping and the tilt-shift lens.
- "lite" quality on phones, and the pixel ratio drops when fps falls below 26.
- Every building records its height source (`osm_levels_x_3.1m`, `open_buildings_temporal_2023`, `estimated_for_rendering`).

**Data checks** (live, today):
- `marina_osm_check.py` did not exist yet, so it is written from scratch.
- Overpass works only with a User-Agent header (plain curl gets 406) and answers 502 under load; two mirrors timed out. Scripts send a UA, retry with backoff and cache every response.
- Terrarium tiles and Overture (latest release 2026-10-21.0) are reachable.
- **The lighthouse is outside your box**: OSM way 211436935 sits at 13.03975 N, 28 m south of 13.040. Everything else is inside: Chepauk stadium (rel 60961), LIC (way 1110170916, 12 levels), Chepauk MRTS, Chennai Central, Nehru Stadium (way 1241304916), Fort St George (way 1178009706), Marina Beach (way 22902280).
- OSM inside the box: 10,393 buildings (947 with levels, 4 with height), 3,239 road ways, 161 rail ways, 334 trees, 19 street lamps, 65 parks, 5 coastline ways.

## Decisions I made (say if you disagree)

- **Bbox**: south 13.034, west 80.262, north 13.090, east 80.296. About 6.2 x 3.7 km (23 km²), roughly a quarter of it sea. Phase 1 confirms the east edge leaves sea along the whole coast.
- Labels in English with the Tamil name from OSM `name:ta` underneath, like the reference's Kannada.
- Look follows the reference (warm stylised diorama, same panel layout) with a Chennai palette: whitewashed and pastel façades, black rooftop water tanks.
- Default view from over the sea looking west, so the beach runs across the screen.
- Left-hand traffic: MTC buses, autos, cars, two-wheelers.
- Camera buttons: Whole corridor, Chepauk Stadium, Lighthouse, LIC Building, Chennai Central, Nehru Stadium, Marina Beach, Fort St George.
- A **Sources** toggle that colours buildings by where their height came from and trees by mapped vs illustrated.
- Title "Marina, Live", eyebrow "Namma Chennai · Marina corridor". No "Built with Claude" credit line.
- TypeScript, three.js from npm, no UI framework.

## Architecture

```
marina-live/
  .claude/agents/          landmark-modeler.md, polish.md (done)
  scripts/                 offline pipeline, Python 3 in .venv
    requirements.txt       numpy, shapely, duckdb, rasterio
    common.py              bbox, local projection, Overpass client, cache
    marina_osm_check.py    counts + landmark validation report
    fetch_osm.py  fetch_overture.py  fetch_terrain.py  fetch_heights_2p5d.py
    build_scene.py         merge, heights, LOD, quantise, write public/data
    report.py              reports/validation.md + reports/preview.png
  raw/                     download cache (gitignored)
  public/data/             committed: scene.json + packed binaries
  src/
    main.ts  data/  worker/build.ts
    world/   ground, terrain, roads, buildings, sea, beach, rail, trees, lamps
    landmarks/  one module per landmark (from landmark-modeler)
    sky/     sun.ts (solar position), lighting.ts, skydome.ts
    sim/     traffic.ts, train.ts
    ui/      hud.ts, labels.ts, places.ts, camera.ts
    post/    final pass: tone map, tilt-shift lens
  index.html  README.md  vercel.json  .github/workflows/pages.yml
```

**Coordinates**: metres on a local plane around the bbox centre (x east, z south, y up), using
WGS84 radii at 13.06 N. Error under 0.5 m across the box, so no pyproj.

**Data pipeline**
- OSM via Overpass: buildings, roads, rail (with bridge/layer for the elevated MRTS), coastline, water, parks, landuse, beach, trees, lamps, crossings, place names.
- Overture buildings via DuckDB with a bbox filter. Keep the ML footprints (Google, Microsoft) that do not overlap an OSM footprint.
- Heights, in order, each recorded per building: OSM `height` > OSM `building:levels` x 3.1 m > Google 2.5D (if the Chennai tile is reachable under the cap) > Overture `height` / `num_floors` > estimate from footprint area, building type and neighbours.
- Terrain from Terrarium z14, resampled to 25 m, smoothed, clamped so Chennai stays flat. Sea level 0, the beach slopes down to the waterline.
- Land and sea from the coastline. Road polygons from centrelines by class and lanes, merged with shapely.
- Trees: the 334 OSM trees plus procedural trees along roads, the promenade and parks, seeded so they never move between builds. Each carries a mapped or illustrated flag.
- Lamps: the 19 OSM lamps plus illustrated lamps along main roads and the promenade, flagged the same way.
- A coast distance field (small PNG) for wave foam and wet sand.
- Quantised to 16-bit integers, packed binaries pre-gzipped and decoded in the browser with `DecompressionStream`, so compression works the same on GitHub Pages and Vercel.

**Runtime**
- A worker builds geometry (extruded footprints, triangulated ground and roads) so the loading screen stays smooth.
- Buildings merged into one mesh per 400 m cell for frustum culling. Façade shader like the reference; window detail fades with distance.
- Landmark meshes replace their generic footprints (matched by OSM id).
- Instancing for trees, lamps, roof tanks, vehicles, train cars, stadium seats.
- One sun with a shadow map fitted to the view (4096, 2048 on phones). Solar position from NOAA formulas for 13.06 N, 80.28 E, IST.
- Sea: one plane with gentle swell from the south-east, foam lines rolling in along the beach, sun glint, moonlight at night.
- Labels as an HTML overlay with priority-based collision.

**Honesty model** (shown in the credits, loading line and Sources view):
- Mapped: footprints, roads, rail, coastline, parks, 334 trees, 19 lamps.
- Estimated: heights for X% of buildings.
- Illustrated: landmark models, façades, traffic, trains, waves, extra trees and lamps.

## Phases

Each phase ends with: run the site, check it in Chrome, fix console errors, short summary to
you, commit.

1. **Data scripts and validation report.** venv, all fetch scripts, `marina_osm_check.py`, `build_scene.py`. Report lists counts per layer, each landmark found with OSM id and inside/outside, building and height sources, output sizes, plus a top-down preview PNG. Any blocked URL gets reported with the exact file to download by hand.
2. **Base map.** Vite + TS + three scaffold, loading screen, HUD skeleton, iso camera (drag, right-drag, scroll), ground, terrain, roads, extruded buildings, sea, beach, fixed sun.
3. **Landmarks.** 3a: the five you named, built by landmark-modeler, placed and wired to the camera buttons with smooth fly-to. Stadium floodlights included. 3b: Napier Bridge, Fort St George (walls, flagstaff, St Mary's), High Court + Ripon Building, Marina heritage row (Chepauk Palace, Presidency College, Senate House, PWD building; phase 1 confirms whether OSM's PWD building is Humayun Mahal inside Chepauk Palace).
4. **Light, time and season.** Sun path, time slider and quick buttons, month slider with sunrise and sunset times, sky, shadows. Night: lit windows, street lamps, floodlights, an illustrated rotating lighthouse beam.
5. **Traffic, trees, polish.** Traffic on Kamarajar Salai and Anna Salai plus a few other main roads. MRTS train on the elevated line through Chepauk and a train into Central, both marked illustrated. Trees, Labels toggle, Miniature lens, Orbit mode, Sources toggle, credits, README.
6. **Performance pass.** Measure fps, draw calls and triangles on desktop, with 4x CPU throttle and on a phone-sized viewport. Tune LOD, lite mode, adaptive pixel ratio. Budget: JS under 250 KB compressed, data under 3 MB.
7. **Deploy.** Public repo `Afthab-IN/marina-live`, GitHub Actions build to GitHub Pages at `afthab-in.github.io/marina-live`, live check in Chrome. `vercel.json` ready for the move after 5 Dec.

## Delegation

- **landmark-modeler (Opus)**: all landmark meshes. At most two at a time. 3a split: both stadiums (shared stand and floodlight kit) and the three towers. Each gets real footprints, heights, orientation, a triangle budget, the naming rule for night-lit parts, and a gallery page with a headless screenshot script so it can see its own models.
- **polish (Haiku)**: README text, label copy, small CSS fixes.
- Everything else I do myself on the main model. `CLAUDE_CODE_SUBAGENT_MODEL` stays unset.
- The agent files live in `marina-live/.claude/agents/`. I symlinked them into `~/claude/.claude/agents/` because this session started in `~/claude`. If this session still can't see them, I run the same instructions through a general-purpose agent with the model set per call (Opus or Haiku) and tell you.

## Verification

- Dev server through the preview tools (new `marina-live` entry in `~/claude/.claude/launch.json`).
- Visual QA in the Playwright Chrome at `http://[::1]:PORT`, because the app's own browser pane runs hidden and never draws WebGL frames, and `localhost` carries a saved 80% zoom there.
- Every phase: zero console errors, screenshots of the key views, `window.__fps` and `renderer.info`.
- Phone layout in a separate 390x844 headless context. I can't measure a real phone GPU and will say so.

## Risks

- **Memory**: heavy steps run one at a time, DuckDB capped at 1 GB, at most two modelling agents at once, browsers closed after QA.
- **Disk**: the Google 2.5D tiles are 1.4 to 1.6 GB each, so only the bbox window is range-read (about 9 MB), never the whole files.
- **Heights**: Overture height coverage in Chennai is unknown until phase 1.
- **Scale**: about 20 times the reference's area, so chunking and LOD matter from phase 2.
