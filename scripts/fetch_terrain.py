"""Terrain from Mapzen Terrarium tiles (AWS Open Data), resampled to a local grid.

    .venv/bin/python scripts/fetch_terrain.py

Writes raw/terrain/grid.npz: raw elevation in metres on a 20 m grid in local
coordinates covering the bbox plus a margin. Smoothing and the land/sea mask
happen in build_scene.py.
"""
from __future__ import annotations

import io
import math

import numpy as np
from PIL import Image

from common import BBOX, RAW, bbox_m, download, log, unproject

ZOOM = 14
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
STEP = 20.0     # metres
MARGIN = 300.0  # metres around the bbox


def lonlat_to_px(lon, lat, z):
    """Global Web Mercator pixel coordinates at zoom z (256 px tiles)."""
    n = 256 * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = np.radians(lat)
    y = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def main():
    x0, z0, x1, z1 = bbox_m()
    x0, z0, x1, z1 = x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN
    xs = np.arange(x0, x1 + STEP, STEP)
    zs = np.arange(z0, z1 + STEP, STEP)
    gx, gz = np.meshgrid(xs, zs)
    lon, lat = unproject(gx, gz)
    px, py = lonlat_to_px(lon, lat, ZOOM)
    tx0, tx1 = int(px.min() // 256), int(px.max() // 256)
    ty0, ty1 = int(py.min() // 256), int(py.max() // 256)
    log(f"terrain: z{ZOOM} tiles x {tx0}-{tx1}, y {ty0}-{ty1}")

    mosaic = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256), np.float32)
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            path = download(URL.format(z=ZOOM, x=tx, y=ty), RAW / "terrain" / f"{ZOOM}-{tx}-{ty}.png")
            rgb = np.asarray(Image.open(io.BytesIO(path.read_bytes())).convert("RGB"), np.float32)
            elev = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
            r, c = (ty - ty0) * 256, (tx - tx0) * 256
            mosaic[r:r + 256, c:c + 256] = elev

    # bilinear sample at pixel centres
    fx = px - tx0 * 256 - 0.5
    fy = py - ty0 * 256 - 0.5
    ix = np.clip(np.floor(fx).astype(int), 0, mosaic.shape[1] - 2)
    iy = np.clip(np.floor(fy).astype(int), 0, mosaic.shape[0] - 2)
    ax, ay = np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)
    v = (mosaic[iy, ix] * (1 - ax) * (1 - ay) + mosaic[iy, ix + 1] * ax * (1 - ay)
         + mosaic[iy + 1, ix] * (1 - ax) * ay + mosaic[iy + 1, ix + 1] * ax * ay)
    out = RAW / "terrain" / "grid.npz"
    np.savez_compressed(out, elev=v.astype(np.float32), x0=xs[0], z0=zs[0], step=STEP)
    log(f"terrain: grid {v.shape[1]}x{v.shape[0]} at {STEP:.0f} m, elevation {v.min():.1f} to {v.max():.1f} m "
        f"(median {np.median(v):.1f}) -> {out}")


if __name__ == "__main__":
    main()
