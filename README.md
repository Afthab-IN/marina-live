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
