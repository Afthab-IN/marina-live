"""Shared settings and helpers for the Marina, Live data pipeline.

Everything here is offline preprocessing. The site itself never calls these
services: it only reads the files written to public/data.
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
REPORTS = ROOT / "reports"
OUT = ROOT / "public" / "data"

# Bounding box in degrees. The brief's box was 13.040-13.090 N, 80.262-80.292 E.
# South moved to 13.034 because the Marina lighthouse (OSM way 211436935) sits at
# 13.03975 N, just outside 13.040. East moved to 80.296 so there is open sea along
# the whole coast, including the harbour end in the north.
BBOX = dict(south=13.034, west=80.262, north=13.090, east=80.296)
ORIGIN_LAT = (BBOX["south"] + BBOX["north"]) / 2
ORIGIN_LON = (BBOX["west"] + BBOX["east"]) / 2

USER_AGENT = "marina-live-data-scripts/0.1 (offline preprocessing for a static 3D map)"
# overpass-api.de answers 406 to requests without a User-Agent and 502/504 when busy.
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
]

# ---------------------------------------------------------------- projection
# Local plane in metres around the bbox centre: x east, z south (three.js
# convention, so north is -z). Uses the WGS84 radii of curvature at the origin
# latitude. Over this 6 km box the error is well under half a metre.
_A = 6378137.0
_F = 1 / 298.257223563
_E2 = _F * (2 - _F)
_lat0 = math.radians(ORIGIN_LAT)
_s0 = math.sin(_lat0)
_M = _A * (1 - _E2) / (1 - _E2 * _s0 * _s0) ** 1.5
_N = _A / math.sqrt(1 - _E2 * _s0 * _s0)
KX = math.radians(1) * _N * math.cos(_lat0)  # metres per degree of longitude
KZ = math.radians(1) * _M                    # metres per degree of latitude


def project(lon, lat):
    """lon/lat in degrees (floats or numpy arrays) -> (x, z) metres."""
    return (lon - ORIGIN_LON) * KX, -(lat - ORIGIN_LAT) * KZ


def unproject(x, z):
    return ORIGIN_LON + x / KX, ORIGIN_LAT - z / KZ


def bbox_m():
    """The bbox in local metres as (xmin, zmin, xmax, zmax)."""
    x0, z1 = project(BBOX["west"], BBOX["south"])
    x1, z0 = project(BBOX["east"], BBOX["north"])
    return x0, z0, x1, z1


def bbox_overpass(margin_deg: float = 0.0) -> str:
    m = margin_deg
    return f'{BBOX["south"]-m},{BBOX["west"]-m},{BBOX["north"]+m},{BBOX["east"]+m}'


def inside_bbox(lon: float, lat: float) -> bool:
    return BBOX["west"] <= lon <= BBOX["east"] and BBOX["south"] <= lat <= BBOX["north"]


# ---------------------------------------------------------------- logging
def log(*parts):
    print(*parts, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- downloads
def _sha(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:10]


def overpass(query: str, name: str, max_age_days: float = 30, timeout: int = 400) -> dict:
    """Run an Overpass query, caching the JSON in raw/overpass/.

    Retries with backoff on 429/502/503/504 and network errors. If every attempt
    fails it stops with the exact URL and a manual-download recipe.
    """
    cache_dir = RAW / "overpass"
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = f"{name}-{_sha(query)}"
    cache = cache_dir / f"{key}.json"
    (cache_dir / f"{key}.overpassql").write_text(query)
    if cache.exists() and (time.time() - cache.stat().st_mtime) < max_age_days * 86400:
        log(f"overpass {name}: cached {cache.name}")
        return json.loads(cache.read_text())

    body = urllib.parse.urlencode({"data": query}).encode()
    tmp = cache.with_suffix(".part")
    last_error = ""
    for attempt in range(7):
        url = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp, open(tmp, "wb") as fh:
                shutil.copyfileobj(resp, fh, 1 << 20)
            data = json.loads(tmp.read_text())
            remark = data.get("remark", "")
            if "runtime error" in remark or "Query timed out" in remark:
                raise RuntimeError(remark)
            tmp.replace(cache)
            log(f"overpass {name}: {cache.stat().st_size/1e6:.1f} MB in {time.time()-t0:.0f}s from {url}")
            return data
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code} from {url}"
            if e.code not in (429, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, RuntimeError, json.JSONDecodeError, OSError) as e:
            last_error = f"{type(e).__name__}: {e} from {url}"
        wait = min(240, 20 * 2 ** attempt)
        log(f"overpass {name}: attempt {attempt+1} failed ({last_error}); retrying in {wait}s")
        time.sleep(wait)
    raise SystemExit(
        f"\nOverpass failed for '{name}': {last_error}\n"
        f"Manual fallback: open https://overpass-turbo.eu, paste the query from\n"
        f"  {cache_dir / (key + '.overpassql')}\n"
        f"run it, choose Export > raw OSM data (JSON), and save the file as\n"
        f"  {cache}\n"
        f"then re-run this script.\n"
    )


def download(url: str, dest: Path, max_bytes: int | None = None, retries: int = 4) -> Path:
    """Stream a URL to dest (cached). Stops if the body exceeds max_bytes."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last_error = ""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as fh:
                total = 0
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    total += len(chunk)
                    if max_bytes and total > max_bytes:
                        raise SystemExit(f"{url} is larger than the {max_bytes/1e6:.0f} MB cap; stopped.")
                    fh.write(chunk)
            tmp.replace(dest)
            return dest
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            if e.code in (403, 404):
                break
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_error = f"{type(e).__name__}: {e}"
        time.sleep(5 * (attempt + 1))
    raise SystemExit(
        f"\nDownload failed: {url}\n  ({last_error})\n"
        f"Manual fallback: download that URL in a browser and save it as\n  {dest}\nthen re-run.\n"
    )


def write_json(path: Path, obj, compact: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))
    else:
        path.write_text(json.dumps(obj, indent=2, ensure_ascii=False))
