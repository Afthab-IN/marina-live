"""Binary packing for public/data.

A pack is a set of little-endian typed arrays concatenated (4-byte aligned) and
gzipped as one file. scene.json lists each array's type, offset and length, so
the browser can view them without copying. Gzip is done here, not by the host,
because GitHub Pages and Vercel do not compress application/octet-stream.
"""
from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np
import shapely

QUANT = 0.125  # metres per int16 step: +/-4096 m, enough for the 6.2 km box

TYPES = {
    np.dtype("int8"): "i8", np.dtype("uint8"): "u8",
    np.dtype("int16"): "i16", np.dtype("uint16"): "u16",
    np.dtype("int32"): "i32", np.dtype("uint32"): "u32",
    np.dtype("float32"): "f32",
}


def q16(values) -> np.ndarray:
    a = np.round(np.asarray(values, float) / QUANT)
    if a.size and (a.min() < -32768 or a.max() > 32767):
        raise ValueError("coordinate outside the int16 range")
    return a.astype(np.int16)


class Pack:
    def __init__(self, name: str):
        self.name = name
        self.arrays: dict[str, np.ndarray] = {}

    def add(self, key: str, arr) -> None:
        arr = np.ascontiguousarray(arr)
        if arr.dtype not in TYPES:
            raise TypeError(f"{key}: unsupported dtype {arr.dtype}")
        if key in self.arrays:
            raise KeyError(f"duplicate array {key}")
        self.arrays[key] = arr

    def write(self, out_dir: Path) -> dict:
        buf = bytearray()
        meta = {}
        for key, arr in self.arrays.items():
            while len(buf) % 4:
                buf.append(0)
            le = arr.astype(arr.dtype.newbyteorder("<"), copy=False)
            meta[key] = {"type": TYPES[arr.dtype], "offset": len(buf), "length": int(arr.size)}
            buf += le.tobytes()
        raw = bytes(buf)
        gz = gzip.compress(raw, compresslevel=9, mtime=0)
        path = out_dir / f"{self.name}.pack"
        path.write_bytes(gz)
        return {"file": path.name, "bytes": len(gz), "raw": len(raw), "arrays": meta}


def pack_polygons(polys, simplify: float = 0.0):
    """Polygons -> (first_ring u32[n+1], ring_start u32[r+1], xz i16[2v]).

    Exterior rings are oriented counter-clockwise in the (x, z) plane and holes
    clockwise. Closing vertices are dropped.
    """
    first_ring, ring_start, coords = [0], [0], []
    kept = []
    for p in polys:
        if simplify > 0:
            p = p.simplify(simplify, preserve_topology=True)
        if p.is_empty or p.geom_type != "Polygon" or p.area < 0.5:
            continue
        p = shapely.geometry.polygon.orient(p, sign=1.0)
        rings = [p.exterior] + list(p.interiors)
        n_rings = 0
        for r in rings:
            c = np.asarray(r.coords)[:-1]
            if len(c) < 3:
                continue
            coords.append(c)
            ring_start.append(ring_start[-1] + len(c))
            n_rings += 1
        if n_rings:
            first_ring.append(first_ring[-1] + n_rings)
            kept.append(p)
    xz = q16(np.concatenate(coords).ravel()) if coords else np.zeros(0, np.int16)
    return (np.array(first_ring, np.uint32), np.array(ring_start, np.uint32), xz, kept)


def pack_lines(lines):
    """LineStrings -> (start u32[n+1], xz i16[2v])."""
    start, coords = [0], []
    for l in lines:
        c = np.asarray(l.coords)
        if len(c) < 2:
            continue
        coords.append(c[:, :2])
        start.append(start[-1] + len(c))
    xz = q16(np.concatenate(coords).ravel()) if coords else np.zeros(0, np.int16)
    return np.array(start, np.uint32), xz
