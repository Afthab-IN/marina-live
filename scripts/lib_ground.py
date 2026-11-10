"""Ground: land and sea from the coastline, cover classes, water, terrain, coast distance field."""
from __future__ import annotations

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from common import RAW, log
from geo import clean_polygon, parse_float, polygon_parts

# cover classes, lowest priority first (a later class wins where they overlap)
COVER = ["land", "residential", "commercial", "industrial", "institution", "railway", "construction",
         "cemetery", "green", "park", "parking", "plaza", "pitch", "track", "platform", "sand", "water"]
COVER_CODE = {name: i for i, name in enumerate(COVER)}


def cover_class(t: dict) -> str | None:
    if "building" in t or t.get("area") == "no":
        return None
    nat, lu, le, am = t.get("natural"), t.get("landuse"), t.get("leisure"), t.get("amenity")
    if nat == "water" or "water" in t or t.get("waterway") in ("riverbank", "dock") or lu in ("basin", "reservoir"):
        return "water"
    if nat in ("beach", "sand"):
        return "sand"
    if t.get("railway") == "platform" or t.get("public_transport") == "platform":
        return "platform"
    if le == "track":
        return "track"
    if le == "pitch":
        return "pitch"
    if (t.get("highway") == "pedestrian" and t.get("area") == "yes") or t.get("area:highway") \
            or t.get("place") == "square" or am == "marketplace" or t.get("man_made") == "pier":
        return "plaza"
    if am == "parking" or am == "bicycle_parking" or am == "motorcycle_parking":
        return "parking"
    if le in ("park", "garden", "playground", "dog_park", "nature_reserve", "common"):
        return "park"
    if lu in ("grass", "recreation_ground", "village_green", "meadow", "forest", "orchard", "plant_nursery",
              "flowerbed") or nat in ("grassland", "scrub", "wood", "heath", "wetland"):
        return "green"
    if lu == "cemetery" or am == "grave_yard":
        return "cemetery"
    if lu in ("construction", "brownfield", "greenfield"):
        return "construction"
    if lu == "railway":
        return "railway"
    if lu in ("education", "religious", "institutional", "military") or "military" in t or \
            am in ("school", "college", "university", "hospital", "place_of_worship", "kindergarten",
                   "courthouse", "townhall", "police", "library", "fire_station"):
        return "institution"
    if lu in ("industrial", "port", "depot", "garages", "harbour"):
        return "industrial"
    if lu in ("commercial", "retail"):
        return "commercial"
    if lu == "residential":
        return "residential"
    return None


def _coast_side(px, pz, seg_tree, segs) -> float:
    """> 0 when the point is on the left of the coastline (land, by OSM convention)."""
    i = seg_tree.nearest(shapely.Point(px, pz))
    (x1, z1), (x2, z2) = segs[i]
    # map frame has y north = -z
    dx, dy = x2 - x1, -(z2 - z1)
    vx, vy = px - x1, -(pz - z1)
    return dx * vy - dy * vx


def coastline_lines(osm=None) -> list[LineString]:
    """Coastline ways from the wide-box query (raw/overpass/coastline-*.json)."""
    import glob
    import json
    from geo import xz_from_geom
    files = sorted(glob.glob(str(RAW / "overpass" / "coastline-*.json")))
    if not files:
        raise SystemExit("raw/overpass/coastline-*.json missing: run scripts/fetch_osm.py first")
    lines = []
    for el in json.loads(open(files[-1]).read())["elements"]:
        g = el.get("geometry")
        if el["type"] == "way" and g and len(g) >= 2:
            lines.append(LineString(xz_from_geom(g)))
    return lines


def land_polygon(coast: list[LineString], frame: Polygon):
    if not coast:
        log("WARNING: no coastline inside the frame; treating everything as land")
        return frame
    segs = []
    for l in coast:
        c = np.asarray(l.coords)
        segs.extend(zip(map(tuple, c[:-1]), map(tuple, c[1:])))
    seg_tree = STRtree([LineString(s) for s in segs])
    faces = list(polygonize(unary_union([frame.exterior] + [l.intersection(frame.buffer(1)) for l in coast])))
    land = []
    for f in faces:
        if f.area < 1:
            continue
        rp = f.representative_point()
        if _coast_side(rp.x, rp.y, seg_tree, segs) > 0:
            land.append(f)
    geom = clean_polygon(unary_union(land)) if land else frame
    return geom


def cover_polygons(osm, land) -> dict[str, list]:
    """Disjoint cover polygons per class, clipped to land."""
    raw: dict[str, list] = {c: [] for c in COVER[1:]}
    for w in osm.ways.values():
        t = w.get("tags") or {}
        cls = cover_class(t)
        if not cls:
            continue
        nodes = w.get("nodes", [])
        if len(nodes) < 4 or nodes[0] != nodes[-1]:
            continue
        g = osm.way_geometry(w)
        if g is not None and g.geom_type in ("Polygon", "MultiPolygon"):
            raw[cls].append(g)
    for r in osm.relations.values():
        t = r.get("tags") or {}
        cls = cover_class(t)
        if not cls or t.get("type") not in ("multipolygon", "boundary", None):
            continue
        g = osm.relation_polygon(r)
        if g is not None:
            raw[cls].append(g)
    out, covered = {}, None
    for cls in reversed(COVER[1:]):
        if not raw[cls]:
            out[cls] = []
            continue
        g = unary_union(raw[cls]).intersection(land)
        if covered is not None:
            g = g.difference(covered)
        g = clean_polygon(g)
        out[cls] = [p for p in polygon_parts(g) if p.area >= 4]
        covered = g if covered is None else unary_union([covered, g])
    return out


def waterway_polygons(osm, existing_water, frame) -> list:
    """Buffer river/canal/drain centrelines that have no water polygon around them."""
    widths = {"river": 30.0, "canal": 18.0, "stream": 5.0, "drain": 3.0, "ditch": 2.0}
    polys = []
    for w in osm.ways.values():
        t = w.get("tags") or {}
        kind = t.get("waterway")
        if kind not in widths or t.get("tunnel") in ("yes", "culvert") or t.get("layer", "0").startswith("-"):
            continue
        xz = osm.way_xz(w)
        if xz is None:
            continue
        width = parse_float(t.get("width"), widths[kind])
        line = LineString(xz)
        if existing_water is not None and line.length > 0:
            inside = line.intersection(existing_water).length / line.length
            if inside > 0.6:
                continue
        polys.append(line.buffer(width / 2, cap_style="flat"))
    if not polys:
        return []
    g = unary_union(polys).intersection(frame)
    if existing_water is not None:
        g = g.difference(existing_water)
    return [p for p in polygon_parts(clean_polygon(g)) if p.area >= 4]


# ------------------------------------------------------------------ distance field
def coast_distance(coast: list[LineString], land, xs: np.ndarray, zs: np.ndarray) -> np.ndarray:
    """Signed distance in metres to the coastline: + at sea, - on land."""
    segs = []
    for l in coast:
        c = np.asarray(l.coords)
        segs.extend(LineString([a, b]) for a, b in zip(c[:-1], c[1:]))
    gx, gz = np.meshgrid(xs, zs)
    pts = shapely.points(gx.ravel(), gz.ravel())
    if not segs:
        return np.full(gx.shape, -999.0, np.float32)
    tree = STRtree(segs)
    _, dist = tree.query_nearest(pts, return_distance=True, all_matches=False)
    on_land = shapely.contains_xy(land, gx.ravel(), gz.ravel())
    d = np.where(on_land, -dist, dist)
    return d.reshape(gx.shape).astype(np.float32)


def _gauss1d(sigma_cells: float) -> np.ndarray:
    r = int(np.ceil(3 * sigma_cells))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_cells) ** 2)
    return k / k.sum()


def _blur(a: np.ndarray, sigma: float) -> np.ndarray:
    k = _gauss1d(sigma)
    r = len(k) // 2
    p = np.pad(a, r, mode="edge")
    p = np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 1, p)
    p = np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 0, p)
    return p


def terrain(land, coast) -> dict:
    """Smoothed, clamped terrain on the 20 m grid, sloping down to the waterline."""
    d = np.load(RAW / "terrain" / "grid.npz")
    elev, x0, z0, step = d["elev"].astype(np.float64), float(d["x0"]), float(d["z0"]), float(d["step"])
    rows, cols = elev.shape
    xs, zs = x0 + step * np.arange(cols), z0 + step * np.arange(rows)
    gx, gz = np.meshgrid(xs, zs)
    on_land = shapely.contains_xy(land, gx.ravel(), gz.ravel()).reshape(gx.shape)
    w = on_land.astype(float)
    num = _blur(np.where(on_land, elev, 0.0), 5.0)
    den = _blur(w, 5.0)
    smooth = np.where(den > 1e-3, num / np.maximum(den, 1e-3), 2.0)
    smooth = np.clip(smooth, 1.0, 12.0)
    dist = coast_distance(coast, land, xs, zs)  # + sea, - land
    inland = -dist
    beach_profile = 0.3 + np.clip(inland, 0, None) * 0.012
    h = np.where(on_land, np.minimum(smooth, np.where(inland < 650, beach_profile, 99.0)), -1.5 - np.clip(dist, 0, None) * 0.01)
    log(f"terrain: land {h[on_land].min():.1f} to {h[on_land].max():.1f} m, median {np.median(h[on_land]):.1f} m")
    return dict(h=h.astype(np.float32), x0=x0, z0=z0, step=step, cols=cols, rows=rows)
