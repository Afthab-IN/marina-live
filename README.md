# Marina, Live

An interactive 3D model of the Marina Beach corridor in Chennai, covering Chepauk, the lighthouse, Anna Salai, Chennai Central, Periamet and Fort St George. It is a static Vite + three.js site with all data preprocessed offline.

The site is a Vite + TypeScript + three.js app in src/. The data pipeline in scripts/ writes everything it reads to public/data/.

## Area

- Bounding box: south 13.034, west 80.262, north 13.090, east 80.296 (about 6.2 x 3.7 km).
- Local coordinates are metres around the bbox centre: x east, z south, y up.

## Running the site

1. Install. This installs three, earcut, Vite and TypeScript (about 100 MB in node_modules).

```bash
npm install
```

2. Develop. Then open the local URL that is printed.

```bash
npm run dev
```

3. Build. This typechecks, then writes a static site to dist/, including dist/data/.

```bash
npm run build
```

The build uses relative paths, so dist/ works at the root of a domain or under a sub-path such as GitHub Pages.

Add `?q=lite` to the URL to force the lighter phone settings, or `?q=high` to force full quality.

## What's in the model

- Isometric and Orbit views.
  - Isometric: drag to move, right-drag to turn, scroll to zoom.
  - Orbit: drag to orbit, right-drag to move, scroll to zoom.
  - Q and E turn 90 degrees. N switches between day and night. H hides the panels.
- Camera buttons: Whole corridor, Chepauk Stadium, Lighthouse, LIC Building, Chennai Central, Nehru Stadium, Marina Beach, Fort St George.
- Time slider: Morning, Afternoon, Golden hour (set from each month's real sunset) and Night.
- Month slider: moves the sun path for Chennai (13.06 N).
- Shadows follow the sun. At night, windows, street lamps, stadium floodlights and the lighthouse beam light up.
- Toggles:
  - Labels: English, with the Tamil name from OSM.
  - Traffic: illustrated vehicles and trains.
  - Miniature lens: tilt-shift.
  - Sources: colours buildings by where their height came from, and marks trees and street lamps as mapped or illustrated.
- URL parameters:
  - `t` hour, for example `?t=18.5`.
  - `m` month, from 0 to 11.99.
  - `q=lite` or `q=high` for quality.
  - `dpr` to force a pixel ratio.

## Landmark models

- Each hand-modelled landmark is one file in `src/landmarks/models/<key>.ts`, exporting `build(lm, kit)`. The shared kit is `src/landmarks/kit.ts`.
- Models load after the base map, each as its own small chunk.
- Dev gallery: with `npm run dev` running, open `/landmarks.html?key=lighthouse`. Other parameters: `az`, `view=iso|side|top`, `night=1`, `zoom`.
- Headless snapshot: `node scripts/snap.mjs lighthouse --az=35 --night` writes a PNG to `reports/_tmp/`.
- Landmark footprints come from OSM. Chennai Central's heritage building is not mapped there, so its 190 x 28 m footprint is illustrated.

## Deploying

- GitHub Pages: `.github/workflows/pages.yml` builds and publishes `dist/` on every push to `main`.
- Vercel: `vercel.json` is ready (Vite, `dist/`, cache headers). The Vercel team used for this project is blocked until 5 Dec 2026, so Pages is the live host until then.

## Regenerating the data

1. Set up the environment. This installs numpy, shapely, duckdb, rasterio and pillow (about 190 MB).

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
```

2. Check OSM counts and landmarks. Writes `reports/osm_check.md`. Exits with code 1 if a required landmark is missing. Run this first.

```bash
.venv/bin/python scripts/marina_osm_check.py
```

3. Fetch the full OSM extract, plus a wide-box coastline from Overpass. Cached in `raw/overpass/`.

```bash
.venv/bin/python scripts/fetch_osm.py
```

4. Fetch Overture Maps buildings for the bbox via DuckDB. Saved to `raw/overture/`.

```bash
.venv/bin/python scripts/fetch_overture.py
```

5. Fetch Mapzen Terrarium elevation tiles. Saved to `raw/terrain/`.

```bash
.venv/bin/python scripts/fetch_terrain.py
```

6. Fetch Google Open Buildings 2.5D Temporal heights (2023). The source tiles are 1.4 to 1.6 GB each, so the script range-reads only the bbox window from the 2 m overview (about 9 MB). Saved to `raw/2p5d/`.

```bash
.venv/bin/python scripts/fetch_heights_2p5d.py
```

7. Build the scene. Writes `public/data/scene.json` and `public/data/world.pack`, plus `reports/build.json` and `reports/preview.png`.

```bash
.venv/bin/python scripts/build_scene.py
```

8. Write the validation report to `reports/validation.md`.

```bash
.venv/bin/python scripts/report.py
```

## Caching and failures

`raw/` is not committed. To fetch a file again, delete it from `raw/` and run the script.

Overpass answers 406 without a User-Agent, and 502 or 504 when it is busy. The scripts send a User-Agent and retry. If Overpass still fails, the script prints the saved query file and the exact path where you should save a JSON export from overpass-turbo.eu. Any other failed download prints the URL and the path to save it to by hand.

## Data format

`scene.json` holds the metadata, landmarks, labels and an index of typed arrays.

`world.pack` is those arrays concatenated and gzipped. The browser decodes it with `DecompressionStream`, because static hosts do not compress binary files.

Coordinates are int16 at 0.125 m.

## Building heights

Each building records where its height came from. The sources are tried in this order:

1. OSM `height` tag.
2. OSM `building:levels` x 3.1 m.
3. Google 2.5D.
4. Overture.
5. An estimate from the median measured height within 70 m, clamped by building type.

Current split: Google 2.5D 77%, estimated 20%, OSM levels 4%, OSM height tag 3 buildings.

## Mapped and illustrated

Mapped means the data sits at OpenStreetMap or Overture positions. This covers footprints, roads, rail, coastline, water, parks, 334 trees and 13 street lamps.

Illustrated means the scene draws it for effect, not from survey data. This covers landmark models, facades, vehicles, trains and waves. It also covers the extra trees (about 15,800) and street lamps (about 6,900), placed procedurally along roads, the promenade and parks.

Chennai has no public tree census, so illustrated trees are never presented as surveyed.

## Sources and licences

- OpenStreetMap contributors (ODbL).
- Overture Maps Foundation buildings, including Google Open Buildings and Microsoft ML footprints (ODbL).
- Google Open Buildings 2.5D Temporal (CC BY 4.0).
- Mapzen Terrain Tiles via AWS Open Data (SRTM).
- three.js (MIT).
