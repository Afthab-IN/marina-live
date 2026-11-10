"""Buildings: OSM footprints first, Overture ML footprints to fill gaps, heights with a recorded source."""
from __future__ import annotations

import hashlib
from collections import Counter

import duckdb
import numpy as np
import shapely
import shapely.affinity
from shapely.geometry import box
from shapely.strtree import STRtree

from common import RAW, log, project, unproject
from geo import clean_polygon, parse_float, polygon_parts

LEVEL_H = 3.1  # metres per storey, same convention as the reference

# height source codes (stored per building)
HS_ESTIMATE, HS_OSM_HEIGHT, HS_OSM_LEVELS, HS_GOOGLE, HS_OVERTURE = 0, 1, 2, 3, 4
HS_NAMES = {HS_ESTIMATE: "estimated", HS_OSM_HEIGHT: "osm_height", HS_OSM_LEVELS: "osm_levels_x_3.1m",
            HS_GOOGLE: "google_open_buildings_2p5d_2023", HS_OVERTURE: "overture"}

# footprint source codes
FS_OSM, FS_GOOGLE, FS_MICROSOFT, FS_OTHER = 0, 1, 2, 3

# building classes used by the facade shader
CLS = {"generic": 0, "house": 1, "apartments": 2, "commercial": 3, "industrial": 4, "civic": 5,
       "religious": 6, "roof": 7, "historic": 8, "transport": 9, "construction": 10, "hut": 11}
_CLASS_OF = {
    "house": "house", "residential": "house", "detached": "house", "semidetached_house": "house",
    "terrace": "house", "bungalow": "house", "apartments": "apartments", "dormitory": "apartments",
    "hotel": "commercial", "commercial": "commercial", "office": "commercial", "retail": "commercial",
    "supermarket": "commercial", "kiosk": "hut", "industrial": "industrial", "warehouse": "industrial",
    "garage": "industrial", "garages": "industrial", "shed": "hut", "service": "industrial",
    "storage_tank": "industrial", "public": "civic", "government": "civic", "civic": "civic",
    "hospital": "civic", "school": "civic", "college": "civic", "university": "civic",
    "fire_station": "civic", "police": "civic", "temple": "religious", "mosque": "religious",
    "church": "religious", "chapel": "religious", "cathedral": "religious", "shrine": "religious",
    "religious": "religious", "roof": "roof", "carport": "roof", "train_station": "transport",
    "transportation": "transport", "construction": "construction", "hut": "hut", "toilets": "hut",
}
# fallback heights when nothing is measured (metres)
_DEFAULT_H = {"generic": 7.5, "house": 7.0, "apartments": 13.0, "commercial": 10.0, "industrial": 7.0,
              "civic": 11.0, "religious": 9.0, "roof": 4.5, "historic": 12.0, "transport": 10.0,
              "construction": 9.0, "hut": 3.4}
_MAX_EST_H = {"house": 13.0, "hut": 4.5, "roof": 7.0, "industrial": 14.0}


def stable_hash(text: str) -> int:
    return int(hashlib.md5(text.encode()).hexdigest()[:8], 16)


def classify(tags: dict) -> str:
    b = tags.get("building", "yes")
    if tags.get("historic") in ("building", "castle", "fort", "monument", "palace") or tags.get("heritage"):
        if b not in ("roof", "hut", "shed"):
            return "historic"
    cls = _CLASS_OF.get(b)
    if cls:
        return cls
    amen = tags.get("amenity", "")
    if amen in ("place_of_worship",):
        return "religious"
    if amen in ("school", "college", "university", "hospital", "townhall", "courthouse", "police", "library"):
        return "civic"
    if tags.get("shop") or tags.get("office") or amen in ("restaurant", "bank", "cafe", "fast_food"):
        return "commercial"
    return "generic"


def osm_buildings(osm, frame) -> list[dict]:
    out = []

    def add(kind, oid, geom, tags):
        geom = clean_polygon(geom)
        if geom is None:
            return
        geom = clean_polygon(geom.intersection(frame))
        for part in polygon_parts(geom):
            if part.area >= 4.0:
                out.append(dict(id=f"{kind}{oid}", geom=part, tags=tags, fsrc=FS_OSM))

    for w in osm.ways.values():
        t = w.get("tags") or {}
        if "building" not in t or t["building"] == "no" or t.get("location") == "underground":
            continue
        if parse_float(t.get("layer"), 0) < 0:
            continue
        g = osm.way_geometry(w)
        if g is not None and g.geom_type in ("Polygon", "MultiPolygon"):
            add("w", w["id"], g, t)
    for r in osm.relations.values():
        t = r.get("tags") or {}
        if "building" not in t or t["building"] == "no":
            continue
        g = osm.relation_polygon(r)
        if g is not None:
            add("r", r["id"], g, t)
    return out


def overture_ml_buildings(release: str, frame, osm_list: list[dict]) -> tuple[list[dict], dict]:
    path = RAW / "overture" / f"buildings-{release}.parquet"
    rows = duckdb.connect().execute(
        f"SELECT id, datasets, wkb, class, height, num_floors FROM read_parquet('{path}')").fetchall()
    tree = STRtree([b["geom"] for b in osm_list])
    stats = Counter()
    out = []
    for oid, datasets, wkb, cls, height, floors in rows:
        ds = (datasets or ["?"])[0]
        if ds == "OpenStreetMap":
            stats["osm_duplicates_skipped"] += 1
            continue
        g = shapely.from_wkb(bytes(wkb))
        g = shapely.transform(g, lambda a: np.column_stack(project(a[:, 0], a[:, 1])))
        g = clean_polygon(g)
        if g is None:
            continue
        g = clean_polygon(g.intersection(frame))
        for part in polygon_parts(g):
            if part.area < 10.0:
                stats["too_small"] += 1
                continue
            hits = tree.query(part, predicate="intersects")
            overlap = sum(part.intersection(osm_list[i]["geom"]).area for i in hits)
            if overlap > 0.2 * part.area:
                stats["overlaps_osm"] += 1
                continue
            fs = FS_GOOGLE if ds.startswith("Google") else FS_MICROSOFT if ds.startswith("Microsoft") else FS_OTHER
            tags = {"building": cls or "yes"}
            if height:
                tags["overture:height"] = height
            if floors:
                tags["overture:num_floors"] = floors
            out.append(dict(id=f"o{oid[:12]}", geom=part, tags=tags, fsrc=fs))
            stats[f"kept_{ds}"] += 1
    return out, dict(stats)


class Google25D:
    """Per-footprint height statistics from the 2.5D 2 m raster window."""

    def __init__(self, path):
        from rasterio.warp import transform
        d = np.load(path)
        self.h = d["height"].astype(np.float32)
        self.p = d["presence"].astype(np.float32)
        self.x0, self.y1, self.res = float(d["x0"]), float(d["y1"]), float(d["res"])
        epsg = int(d["epsg"])
        # affine fit local (x, z) -> UTM (E, N); exact to centimetres over this box
        gx, gz = np.meshgrid(np.linspace(-2200, 2200, 6), np.linspace(-3400, 3400, 8))
        lon, lat = unproject(gx.ravel(), gz.ravel())
        e, n = transform("EPSG:4326", f"EPSG:{epsg}", lon.tolist(), lat.tolist())
        A = np.column_stack([gx.ravel(), gz.ravel(), np.ones(gx.size)])
        self.ce, res_e, *_ = np.linalg.lstsq(A, np.array(e), rcond=None)
        self.cn, res_n, *_ = np.linalg.lstsq(A, np.array(n), rcond=None)

    def to_utm(self, geom):
        a, b, c = self.ce
        d, e, f = self.cn
        return shapely.affinity.affine_transform(geom, [a, b, d, e, c, f])

    def stats(self, geoms) -> list[tuple[float, int]]:
        from rasterio.features import rasterize
        from rasterio.transform import Affine
        tr = Affine(self.res, 0, self.x0, 0, -self.res, self.y1)
        shapes = ((self.to_utm(g), i + 1) for i, g in enumerate(geoms))
        lab = rasterize(shapes, out_shape=self.h.shape, transform=tr, fill=0, dtype="int32")
        ok = (lab > 0) & np.isfinite(self.h) & (self.p > 0.5)
        L, H = lab[ok], self.h[ok]
        order = np.argsort(L, kind="stable")
        L, H = L[order], H[order]
        out = [(float("nan"), 0)] * len(geoms)
        if len(L) == 0:
            return out
        bounds = np.flatnonzero(np.diff(L)) + 1
        for chunk_l, chunk_h in zip(np.split(L, bounds), np.split(H, bounds)):
            i = int(chunk_l[0]) - 1
            out[i] = (float(np.percentile(chunk_h, 80)), int(len(chunk_h)))
        return out


def assign_heights(blds: list[dict], g25: Google25D | None) -> dict:
    """Sets b['h'] (metres), b['min_h'], b['hsrc'], b['cls'] on every building."""
    if g25 is not None:
        st = g25.stats([b["geom"] for b in blds])
    else:
        st = [(float("nan"), 0)] * len(blds)
    compare = []
    for b, (gh, npx) in zip(blds, st):
        t = b["tags"]
        b["cls"] = classify(t)
        b["min_h"] = 0.0
        h_tag = parse_float(t.get("height"))
        lv = parse_float(t.get("building:levels"))
        roof_lv = parse_float(t.get("roof:levels"), 0.0) or 0.0
        g_ok = npx >= 3 and np.isfinite(gh) and gh >= 2.0
        if h_tag and 2.0 <= h_tag <= 250:
            b["h"], b["hsrc"] = h_tag, HS_OSM_HEIGHT
        elif lv and 1 <= lv <= 60:
            b["h"], b["hsrc"] = (lv + 0.5 * roof_lv) * LEVEL_H + 0.6, HS_OSM_LEVELS
        elif g_ok:
            b["h"], b["hsrc"] = gh, HS_GOOGLE
        elif t.get("overture:height"):
            b["h"], b["hsrc"] = float(t["overture:height"]), HS_OVERTURE
        elif t.get("overture:num_floors"):
            b["h"], b["hsrc"] = float(t["overture:num_floors"]) * LEVEL_H + 0.6, HS_OVERTURE
        else:
            b["h"], b["hsrc"] = None, HS_ESTIMATE
        if b["hsrc"] == HS_OSM_LEVELS and g_ok:
            compare.append((b["h"], gh))
        mh = parse_float(t.get("min_height"))
        if mh and b["h"] and 0 < mh < b["h"]:
            b["min_h"] = mh

    # estimates: median of measured neighbours within 70 m, clamped by class
    known = [b for b in blds if b["h"] is not None]
    tree = STRtree([b["geom"].centroid for b in known]) if known else None
    known_h = np.array([b["h"] for b in known]) if known else np.zeros(0)
    for b in blds:
        if b["h"] is not None:
            continue
        c = b["geom"].centroid
        jitter = 0.9 + 0.2 * ((stable_hash(b["id"]) % 1000) / 1000)
        est = None
        if tree is not None:
            idx = tree.query(c.buffer(70.0))
            if len(idx) >= 3:
                est = float(np.median(known_h[idx]))
        if est is None:
            est = _DEFAULT_H[b["cls"]]
        area = b["geom"].area
        if area < 25:
            est = min(est, 4.2)
        elif area < 60:
            est = min(est, 7.5)
        est = min(est, _MAX_EST_H.get(b["cls"], 30.0))
        b["h"] = max(3.0, est * jitter)
    for b in blds:
        if b["cls"] == "roof" and not b["min_h"]:
            b["min_h"] = max(0.0, b["h"] - 0.5)
    hs = Counter(HS_NAMES[b["hsrc"]] for b in blds)
    cmp = None
    if compare:
        a = np.array(compare)
        cmp = dict(n=len(a), mean_abs_diff_m=round(float(np.mean(np.abs(a[:, 0] - a[:, 1]))), 2),
                   median_ratio=round(float(np.median(a[:, 1] / a[:, 0])), 3))
    return dict(height_sources=dict(hs), osm_levels_vs_google=cmp)


def frame_polygon(bm):
    x0, z0, x1, z1 = bm
    return box(x0, z0, x1, z1)
