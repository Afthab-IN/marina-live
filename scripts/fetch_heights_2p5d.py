"""Google Open Buildings 2.5D Temporal building heights (2023) for the bbox.

    .venv/bin/python scripts/fetch_heights_2p5d.py

The source tiles are 1.4-1.6 GB Cloud-Optimized GeoTIFFs (12.5 km squares at
0.5 m in UTM 44N). Nothing is downloaded whole: GDAL range-reads only our window
from the 2 m overview, a few tens of MB. Output: raw/2p5d/heights_2023_2m.npz.

Source: gs://open-buildings-temporal-data/v1 (Google, CC BY 4.0 and ODbL).
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request

import numpy as np

from common import BBOX, RAW, USER_AGENT, download, log

BASE = "https://storage.googleapis.com/open-buildings-temporal-data"
YEAR = "2023_06_30"
EPSG = "32644"   # UTM 44N, the zone Chennai falls in
RES = 2.0        # metres; the 4x overview of the 0.5 m tiles
MARGIN = 150.0   # metres around the bbox

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("GDAL_HTTP_USERAGENT", USER_AGENT)
os.environ.setdefault("VSI_CACHE", "TRUE")

import rasterio  # noqa: E402  (after the GDAL env vars)
from rasterio.enums import Resampling  # noqa: E402
from rasterio.warp import transform  # noqa: E402
from rasterio.windows import from_bounds  # noqa: E402


def manifest_names() -> list[str]:
    q = urllib.parse.urlencode({"prefix": "v1/manifests/", "matchGlob": f"**{EPSG}_{YEAR}**"})
    url = f"https://storage.googleapis.com/storage/v1/b/open-buildings-temporal-data/o?{q}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    items = json.loads(urllib.request.urlopen(req, timeout=60).read()).get("items", [])
    names = [i["name"] for i in items]
    if not names:
        raise SystemExit(f"No 2.5D manifests found for EPSG:{EPSG} {YEAR} at {url}")
    return names


def utm_bounds():
    lons = [BBOX["west"], BBOX["east"], BBOX["west"], BBOX["east"]]
    lats = [BBOX["south"], BBOX["south"], BBOX["north"], BBOX["north"]]
    xs, ys = transform("EPSG:4326", f"EPSG:{EPSG}", lons, lats)
    x0 = np.floor((min(xs) - MARGIN) / RES) * RES
    x1 = np.ceil((max(xs) + MARGIN) / RES) * RES
    y0 = np.floor((min(ys) - MARGIN) / RES) * RES
    y1 = np.ceil((max(ys) + MARGIN) / RES) * RES
    return x0, y0, x1, y1


def main():
    out = RAW / "2p5d" / f"heights_{YEAR[:4]}_{int(RES)}m.npz"
    if out.exists():
        log(f"2p5d: cached {out.name}")
        return
    x0, y0, x1, y1 = utm_bounds()
    tiles = []
    for name in manifest_names():
        path = download(f"{BASE}/{name}", RAW / "2p5d" / os.path.basename(name))
        m = json.loads(path.read_text())
        prefix = m["uriPrefix"].replace("gs://open-buildings-temporal-data/", f"/vsicurl/{BASE}/")
        for ts in m["tilesets"]:
            for src in ts["sources"]:
                a, d = src["affineTransform"], src["dimensions"]
                tx0, ty1 = a["translateX"], a["translateY"]
                tx1, ty0 = tx0 + a["scaleX"] * d["width"], ty1 + a["scaleY"] * d["height"]
                if tx0 < x1 and tx1 > x0 and ty0 < y1 and ty1 > y0:
                    tiles.append(prefix + src["uris"][0])
    log(f"2p5d: {len(tiles)} tiles intersect the bbox")

    cols, rows = int(round((x1 - x0) / RES)), int(round((y1 - y0) / RES))
    height = np.full((rows, cols), np.nan, np.float32)
    presence = np.full((rows, cols), np.nan, np.float32)
    t0 = time.time()
    for url in tiles:
        with rasterio.open(url) as ds:
            ix0, iy0 = max(x0, ds.bounds.left), max(y0, ds.bounds.bottom)
            ix1, iy1 = min(x1, ds.bounds.right), min(y1, ds.bounds.top)
            win = from_bounds(ix0, iy0, ix1, iy1, ds.transform).round_offsets().round_lengths()
            oc, orr = int(round((ix1 - ix0) / RES)), int(round((iy1 - iy0) / RES))
            data = ds.read([2, 3], window=win, out_shape=(2, orr, oc), resampling=Resampling.nearest)
            data[data == ds.nodata] = np.nan
            c, r = int(round((ix0 - x0) / RES)), int(round((y1 - iy1) / RES))
            height[r:r + orr, c:c + oc] = data[0]
            presence[r:r + orr, c:c + oc] = data[1]
            log(f"2p5d: read {oc}x{orr} px from {url.rsplit('/', 1)[-1]} in {time.time()-t0:.0f}s")
    np.savez_compressed(out, height=height.astype(np.float16), presence=presence.astype(np.float16),
                        x0=x0, y1=y1, res=RES, epsg=int(EPSG), year=YEAR)
    valid = np.isfinite(height)
    built = valid & (presence > 0.5)
    log(f"2p5d: {valid.mean()*100:.0f}% of the window has data; {built.mean()*100:.0f}% is built-up; "
        f"median built height {np.nanmedian(height[built]):.1f} m, p95 {np.nanpercentile(height[built], 95):.1f} m -> {out.name}")


if __name__ == "__main__":
    main()
