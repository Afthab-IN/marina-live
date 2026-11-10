"""Trees and street lamps: OSM-mapped ones plus seeded procedural (illustrated) ones.

Every item carries a mapped flag. Procedural items are never presented as surveyed.
"""
from __future__ import annotations

import math
import re

import numpy as np
import shapely

from geo import parse_float

TREE_BROAD, TREE_PALM, TREE_COLUMN = 0, 1, 2
LAMP_ROAD, LAMP_PROMENADE = 0, 1


def _kind_from_tags(t: dict) -> int:
    txt = " ".join(str(t.get(k, "")) for k in ("genus", "species", "taxon", "species:en", "name", "leaf_type"))
    if re.search(r"cocos|coconut|borassus|areca|phoenix|roystonea|palm|palmyra", txt, re.I):
        return TREE_PALM
    if re.search(r"polyalthia|monoon|ashoka", txt, re.I):
        return TREE_COLUMN
    return TREE_BROAD


def mapped_trees(osm, frame) -> list[tuple]:
    out = []
    for nid, t in osm.node_tags.items():
        if t.get("natural") != "tree":
            continue
        p = osm.node_xz(nid)
        if p is None or not frame.contains(shapely.Point(p)):
            continue
        h = parse_float(t.get("height"))
        c = parse_float(t.get("diameter_crown"))
        out.append((p[0], p[1], _kind_from_tags(t), h, c / 2 if c else None))
    return out


def _along(line, spacing, rng, jitter):
    """Points every `spacing` metres along a line (with jitter) and unit tangents there."""
    L = line.length
    if L < spacing * 0.5:
        return np.zeros((0, 2)), np.zeros((0, 2))
    base = np.arange(spacing * rng.random(), L, spacing)
    d = np.clip(base + rng.uniform(-jitter, jitter, len(base)), 0.5, max(0.5, L - 0.5))
    p = shapely.get_coordinates(shapely.line_interpolate_point(line, d))
    p2 = shapely.get_coordinates(shapely.line_interpolate_point(line, np.minimum(d + 1.0, L)))
    p1 = shapely.get_coordinates(shapely.line_interpolate_point(line, np.maximum(d - 1.0, 0)))
    t = p2 - p1
    n = np.linalg.norm(t, axis=1, keepdims=True)
    t = np.where(n > 1e-6, t / np.maximum(n, 1e-6), np.array([[1.0, 0.0]]))
    return p, t


def _grid_in(polys, spacing, rng, jitter=0.4):
    pts = []
    for poly in polys:
        x0, z0, x1, z1 = poly.bounds
        if (x1 - x0) * (z1 - z0) / (spacing * spacing) > 200000:
            continue
        xs = np.arange(x0 + spacing * rng.random(), x1, spacing)
        zs = np.arange(z0 + spacing * rng.random(), z1, spacing)
        if not len(xs) or not len(zs):
            continue
        gx, gz = np.meshgrid(xs, zs)
        gx = gx.ravel() + rng.uniform(-jitter, jitter, gx.size) * spacing
        gz = gz.ravel() + rng.uniform(-jitter, jitter, gz.size) * spacing
        m = shapely.contains_xy(poly, gx, gz)
        pts.append(np.column_stack([gx[m], gz[m]]))
    return np.concatenate(pts) if pts else np.zeros((0, 2))


def _thin(points, min_dist, existing=None):
    """Drop points closer than min_dist to an earlier point (grid hashing)."""
    cell = min_dist
    occupied = {}
    keep = np.zeros(len(points), bool)

    def key(x, z):
        return int(math.floor(x / cell)), int(math.floor(z / cell))

    def free(x, z):
        kx, kz = key(x, z)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for (ox, oz) in occupied.get((kx + dx, kz + dz), ()):
                    if (ox - x) ** 2 + (oz - z) ** 2 < min_dist * min_dist:
                        return False
        return True

    if existing is not None:
        for x, z in existing:
            occupied.setdefault(key(x, z), []).append((x, z))
    for i, (x, z) in enumerate(points):
        if free(x, z):
            keep[i] = True
            occupied.setdefault(key(x, z), []).append((x, z))
    return keep


def illustrated_trees(rng, roads, cover, blockers, mapped, coast_dist) -> np.ndarray:
    """Returns (n, 5): x, z, kind, height, crown radius."""
    cand, where = [], []
    for r in roads:
        g, w = r["group"], r["width"]
        if g not in ("major", "minor"):
            continue
        spacing, p_keep = (13.0, 0.6) if g == "major" else (17.0, 0.35)
        p, t = _along(r["line"], spacing, rng, 3.0)
        if not len(p):
            continue
        nrm = np.column_stack([-t[:, 1], t[:, 0]])
        for side in (-1, 1):
            off = (w / 2 + 1.9 + rng.uniform(-0.5, 0.6, len(p)))[:, None]
            q = p + side * nrm * off
            m = rng.random(len(q)) < p_keep
            cand.append(q[m])
            where.append(np.full(m.sum(), 1 if g == "major" else 2))
    for cls, spacing, p_keep, code in (("park", 9.0, 0.75, 3), ("green", 12.0, 0.4, 4), ("institution", 15.0, 0.33, 5),
                                       ("cemetery", 14.0, 0.4, 6), ("residential", 24.0, 0.12, 7),
                                       ("commercial", 30.0, 0.06, 7), ("plaza", 18.0, 0.25, 8)):
        q = _grid_in(cover.get(cls, []), spacing, rng)
        m = rng.random(len(q)) < p_keep
        cand.append(q[m])
        where.append(np.full(m.sum(), code))
    pts = np.concatenate(cand)
    src = np.concatenate(where)
    ok = ~shapely.contains_xy(blockers, pts[:, 0], pts[:, 1])
    pts, src = pts[ok], src[ok]
    order = rng.permutation(len(pts))
    pts, src = pts[order], src[order]
    keep = _thin(pts, 4.2, existing=[(m[0], m[1]) for m in mapped])
    pts, src = pts[keep], src[keep]

    inland = -coast_dist(pts[:, 0], pts[:, 1])
    u = rng.random(len(pts))
    near_sea = inland < 450
    kind = np.where(near_sea, np.where(u < 0.42, TREE_PALM, np.where(u < 0.9, TREE_BROAD, TREE_COLUMN)),
                    np.where(u < 0.08, TREE_PALM, np.where(u < 0.86, TREE_BROAD, TREE_COLUMN)))
    kind = np.where((src == 1) & (rng.random(len(pts)) < 0.18), TREE_COLUMN, kind)
    h = np.select([kind == TREE_PALM, kind == TREE_COLUMN], [rng.uniform(8, 14, len(pts)), rng.uniform(8, 13, len(pts))],
                  rng.uniform(6.5, 12.5, len(pts)))
    crown = np.select([kind == TREE_PALM, kind == TREE_COLUMN], [rng.uniform(2.4, 3.4, len(pts)), rng.uniform(1.4, 2.0, len(pts))],
                      rng.uniform(2.6, 5.2, len(pts)))
    return np.column_stack([pts, kind, h, crown])


def lamps(rng, roads, blockers, mapped_nodes) -> np.ndarray:
    """Returns (n, 4): x, z, angle the arm points (radians, in the x-z plane), mapped flag."""
    out = []
    for x, z, ang in mapped_nodes:
        out.append((x, z, ang, 1))
    for r in roads:
        g, w, hw = r["group"], r["width"], r["tags"]["highway"]
        if g == "major":
            spacing, sides = 32.0, (-1, 1)
        elif hw == "tertiary":
            spacing, sides = 40.0, (1,)
        elif hw in ("residential", "unclassified", "living_street"):
            spacing, sides = 48.0, (1,)
        else:
            continue
        p, t = _along(r["line"], spacing, rng, 1.0)
        if not len(p):
            continue
        nrm = np.column_stack([-t[:, 1], t[:, 0]])
        for k, side in enumerate(sides):
            q = p + side * nrm * (w / 2 + 0.7)
            if k == 1:
                q = q + t * (spacing / 2)  # stagger the far side
            # the arm points back across the road: direction -side * normal, angle in the x-z plane
            ang = np.arctan2(-side * nrm[:, 1], -side * nrm[:, 0])
            for (x, z), a in zip(q, ang):
                out.append((x, z, a, 0))
    arr = np.array(out, float)
    ok = ~shapely.contains_xy(blockers, arr[:, 0], arr[:, 1])
    arr = arr[ok]
    keep = _thin(arr[:, :2], 9.0)
    return arr[keep]
