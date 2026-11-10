"""Build public/data/scene.json and world.pack from the raw downloads.

    .venv/bin/python scripts/build_scene.py

Inputs (from the fetch scripts): raw/overpass/osm-full-*.json, raw/overture/*.parquet,
raw/terrain/grid.npz, raw/2p5d/heights_2023_2m.npz, reports/osm_check.json.
"""
from __future__ import annotations

import json
import math
import time
from collections import Counter, defaultdict
from datetime import date

import numpy as np
import shapely
from shapely.geometry import LineString, Point, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

import lib_buildings as LB
import lib_ground as LG
import lib_network as LN
import lib_nature as LT
from common import BBOX, ORIGIN_LAT, ORIGIN_LON, OUT, RAW, REPORTS, bbox_m, log, project, unproject, write_json
from geo import OsmIndex, clean_polygon, name_all, polygon_parts, principal_angle, rect_dims
from lib_pack import QUANT, Pack, pack_lines, pack_polygons, q16

SEED = 20261110
CHUNK = 400.0  # metres; buildings are grouped per chunk for frustum culling

# Landmarks: which get a hand model, a camera button, and which generic footprints they replace.
# suppress: "inside" = buildings whose centre is inside the landmark polygon, "self" = the
# landmark's own footprint plus buildings it overlaps by half, None = keep the generic buildings.
LANDMARKS = {
    "chepauk_stadium": dict(title="Chepauk Stadium", model=True, camera=True, suppress="inside", span=430),
    "lighthouse": dict(title="Lighthouse", model=True, camera=True, suppress="self", span=210),
    "lic_building": dict(title="LIC Building", model=True, camera=True, suppress="self", span=230),
    "chennai_central": dict(title="Chennai Central", model=True, camera=True, suppress="self", span=420),
    "nehru_stadium": dict(title="Nehru Stadium", model=True, camera=True, suppress="inside", span=470),
    "marina_beach": dict(title="Marina Beach", model=False, camera=True, suppress=None, span=1500),
    "fort_st_george": dict(title="Fort St George", model=True, camera=True, suppress=None, span=900),
    # the bridge outline (man_made=bridge) spans both carriageways
    "napier_bridge": dict(title="Napier Bridge", model=True, camera=False, suppress=None, building="way/1080629434"),
    # campus polygons in OSM: the model replaces the main heritage block only
    "high_court": dict(title="Madras High Court", model=True, camera=False, suppress="self", building="way/369960494"),
    "ripon_building": dict(title="Ripon Building", model=True, camera=False, suppress="self"),
    "chepauk_palace": dict(title="Chepauk Palace", model=True, camera=False, suppress="self"),
    "presidency_college": dict(title="Presidency College", model=True, camera=False, suppress="self", building="way/31900265"),
    "senate_house": dict(title="Senate House", model=True, camera=False, suppress="self"),
    "pwd_building": dict(title="PWD Building", model=True, camera=False, suppress="self"),
    "st_marys_church": dict(title="St Mary's Church", model=True, camera=False, suppress="self"),
    "chepauk_station": dict(title="Chepauk station", model=False, camera=False, suppress=None),
}

# Train routes as lon/lat waypoints along the tracks (illustrated trains, mapped tracks)
TRAIN_ROUTES = {
    # one MRTS train on each track, keeping to opposite directions
    "mrts_south": dict(name="MRTS towards Velachery", waypoints=[(80.2926, 13.0931), (80.2806, 13.06193), (80.2674, 13.0353)]),
    "mrts_north": dict(name="MRTS towards Chennai Beach", waypoints=[(80.2674, 13.0353), (80.2806, 13.06193), (80.2926, 13.0931)],
                       other_track_of="mrts_south"),
    "central": dict(name="Train out of Chennai Central", waypoints=[(80.2756, 13.0828), (80.2746, 13.0893)]),
}


# station nodes that carry only a Tamil name in OSM
STATION_EN = {"சென்னை பூங்கா நகர்": "Park Town", "சென்னை கோட்டை": "Chennai Fort"}


def clip_path(pts, s, frame):
    """Keep the longest run of the 3D polyline whose points lie inside the frame."""
    inside = shapely.contains_xy(frame.buffer(30), pts[:, 0], pts[:, 2])
    best, cur = (0, 0), None
    for i, ok in enumerate(inside):
        if ok and cur is None:
            cur = i
        if (not ok or i == len(inside) - 1) and cur is not None:
            end = i if ok else i - 1
            if end - cur > best[1] - best[0]:
                best = (cur, end)
            cur = None
    a, b = best
    return pts[a:b + 1], s[a:b + 1] - s[a]


# world unit vectors (x east, z south) for landmarks whose front is known; others face the nearest main road
FLATTEN = {"chepauk_stadium", "nehru_stadium"}
FRONT_OVERRIDE = {"chennai_central": [0.0, 1.0], "napier_bridge": [0.0, 0.0]}


def load_osm() -> OsmIndex:
    files = sorted((RAW / "overpass").glob("osm-full-*.json"))
    if not files:
        raise SystemExit("raw/overpass/osm-full-*.json missing: run scripts/fetch_osm.py first")
    t0 = time.time()
    osm = OsmIndex(json.loads(files[-1].read_text()))
    log(f"osm: {len(osm.nodes)} nodes, {len(osm.ways)} ways, {len(osm.relations)} relations ({time.time()-t0:.0f}s)")
    return osm


def element_polygon(osm: OsmIndex, ref: str):
    kind, oid = ref.split("/")
    oid = int(oid)
    if kind == "way" and oid in osm.ways:
        return osm.way_geometry(osm.ways[oid])
    if kind == "relation" and oid in osm.relations:
        return osm.relation_polygon(osm.relations[oid])
    if kind == "node":
        p = osm.node_xz(oid)
        return Point(p) if p else None
    return None


class Terrain:
    def __init__(self, t):
        self.h, self.x0, self.z0, self.step = t["h"], t["x0"], t["z0"], t["step"]

    def at(self, x, z):
        fx = (np.asarray(x) - self.x0) / self.step
        fz = (np.asarray(z) - self.z0) / self.step
        ix = np.clip(np.floor(fx).astype(int), 0, self.h.shape[1] - 2)
        iz = np.clip(np.floor(fz).astype(int), 0, self.h.shape[0] - 2)
        ax, az = np.clip(fx - ix, 0, 1), np.clip(fz - iz, 0, 1)
        h = self.h
        return (h[iz, ix] * (1 - ax) * (1 - az) + h[iz, ix + 1] * ax * (1 - az)
                + h[iz + 1, ix] * (1 - ax) * az + h[iz + 1, ix + 1] * ax * az)


class Field:
    """Bilinear sampler over a regular grid (used for the coast distance)."""

    def __init__(self, a, x0, z0, step):
        self.a, self.x0, self.z0, self.step = a, x0, z0, step

    def __call__(self, x, z):
        fx = (np.asarray(x) - self.x0) / self.step
        fz = (np.asarray(z) - self.z0) / self.step
        ix = np.clip(np.floor(fx).astype(int), 0, self.a.shape[1] - 2)
        iz = np.clip(np.floor(fz).astype(int), 0, self.a.shape[0] - 2)
        ax, az = np.clip(fx - ix, 0, 1), np.clip(fz - iz, 0, 1)
        a = self.a
        return (a[iz, ix] * (1 - ax) * (1 - az) + a[iz, ix + 1] * ax * (1 - az)
                + a[iz + 1, ix] * (1 - ax) * az + a[iz + 1, ix + 1] * ax * az)


def ring_list(poly, tol=0.4) -> list[float]:
    p = poly.simplify(tol, preserve_topology=True)
    if p.geom_type == "MultiPolygon":
        p = max(p.geoms, key=lambda g: g.area)
    c = np.asarray(p.exterior.coords)[:-1]
    return [round(float(v), 1) for v in c.ravel()]


def main():
    t_start = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    bm = bbox_m()
    frame = box(*bm)
    osm = load_osm()
    check = json.loads((REPORTS / "osm_check.json").read_text())
    found = {r["key"]: r for r in check["landmarks"] if r.get("found")}

    # ---------------------------------------------------------- ground
    coast = LG.coastline_lines(osm)
    land = LG.land_polygon(coast, frame)
    log(f"land: {land.area/1e6:.2f} km2 of {frame.area/1e6:.2f} km2 frame")
    cover = LG.cover_polygons(osm, land)
    extra_water = LG.waterway_polygons(osm, unary_union(cover["water"]) if cover["water"] else None, land)
    if extra_water:
        ew = unary_union(extra_water)
        for k in cover:
            cover[k] = [q for p in cover[k] for q in polygon_parts(clean_polygon(p.difference(ew)))]
        cover["water"] += extra_water
    log("cover: " + ", ".join(f"{k} {len(v)}" for k, v in cover.items() if v))

    # ---------------------------------------------------------- roads + rail
    roads = LN.road_ways(osm)
    road_polys = LN.road_polygons(roads, land)
    road_union = unary_union([p for g in road_polys.values() for p in g])
    rails = LN.rail_ways(osm)
    ballast = LN.ballast(rails, land)
    ballast_union = unary_union(ballast) if ballast else None
    if ballast_union is not None:
        ballast = [q for p in ballast for q in polygon_parts(clean_polygon(p.difference(road_union)))]
        ballast_union = unary_union(ballast)
    cut = unary_union([road_union] + ([ballast_union] if ballast_union is not None else []))
    for k in cover:
        cover[k] = [q for p in cover[k] for q in polygon_parts(clean_polygon(p.difference(cut))) if q.area >= 2]
    water_union = unary_union(cover["water"]) if cover["water"] else None
    log(f"roads: {len(roads)} ways -> " + ", ".join(f"{g} {len(v)}" for g, v in road_polys.items())
        + f"; rail {len(rails)} ways, ballast {len(ballast)}")

    # ---------------------------------------------------------- terrain + coast field
    ter = LG.terrain(land, coast)
    terrain = Terrain(ter)
    pad = 400.0
    sx0, sz0, sx1, sz1 = bm[0] - pad, bm[1] - pad, bm[2] + pad, bm[3] + pad
    sdf_step = 8.0
    sxs = np.arange(sx0, sx1 + sdf_step, sdf_step)
    szs = np.arange(sz0, sz1 + sdf_step, sdf_step)
    sdf = LG.coast_distance(coast, land, sxs, szs)
    coast_dist = Field(sdf, sxs[0], szs[0], sdf_step)

    # ---------------------------------------------------------- landmarks
    major_lines = [r["line"] for r in roads if r["tags"]["highway"] in ("trunk", "primary", "secondary")]
    major_tree = STRtree(major_lines)
    lm_out, suppress_polys, lm_geoms = [], [], {}
    for key, spec in LANDMARKS.items():
        r = found.get(key)
        if not r:
            log(f"landmark {key}: not in osm_check, skipped")
            continue
        g = element_polygon(osm, r["osm"])
        if g is None:
            log(f"landmark {key}: geometry for {r['osm']} missing from the extract")
            continue
        if key in FLATTEN and g.geom_type in ("Polygon", "MultiPolygon"):
            # stadium bowls sit on level ground: flatten the terrain inside the outline, easing out over 40 m
            filled = unary_union([shapely.Polygon(q.exterior) for q in polygon_parts(g)])
            level = float(terrain.at(filled.centroid.x, filled.centroid.y))
            gx, gz = np.meshgrid(ter["x0"] + ter["step"] * np.arange(ter["cols"]), ter["z0"] + ter["step"] * np.arange(ter["rows"]))
            d = shapely.distance(filled, shapely.points(gx.ravel(), gz.ravel())).reshape(gx.shape)
            w = np.clip(1 - d / 40.0, 0, 1)
            ter["h"][:] = ter["h"] * (1 - w) + level * w
        if key == "chennai_central":
            g = central_building(osm, g)
        if spec.get("building"):
            site = g
            g = element_polygon(osm, spec["building"]) or g
        lm_geoms[key] = g
        c = g.centroid if g.geom_type != "Point" else g
        rec = dict(key=key, title=spec["title"], name=r.get("name", ""), name_ta=r.get("name_ta", ""), osm=r["osm"],
                   model=spec["model"], camera=spec["camera"], x=round(c.x, 1), z=round(c.y, 1),
                   ground=round(float(terrain.at(c.x, c.y)), 2))
        if g.geom_type in ("Polygon", "MultiPolygon"):
            L, W = rect_dims(g)
            rec.update(angle=round(principal_angle(g), 4), length=round(L, 1), width=round(W, 1),
                       area=round(g.area), ring=ring_list(g))
            main = g if g.geom_type == "Polygon" else max(g.geoms, key=lambda q: q.area)
            if len(main.interiors):
                # courtyards (e.g. Ripon Building)
                rec["holes"] = [[round(float(v), 1) for v in np.asarray(r.coords)[:-1].ravel()] for r in main.interiors]
            if g.geom_type == "MultiPolygon":
                # every separate part (e.g. Chepauk Palace: Kalas Mahal and Humayun Mahal)
                rec["parts"] = [ring_list(q) for q in sorted(g.geoms, key=lambda q: -q.area)]
        elif g.geom_type in ("LineString", "MultiLineString"):
            line = g if g.geom_type == "LineString" else max(g.geoms, key=lambda q: q.length)
            cc = np.asarray(line.coords)
            rec.update(angle=round(math.atan2(cc[-1][1] - cc[0][1], cc[-1][0] - cc[0][0]), 4),
                       length=round(line.length, 1), line=[round(float(v), 1) for v in cc.ravel()])
        tags = r.get("tags", {})
        for k in ("height", "building:levels", "ele"):
            if k in tags:
                rec[k.replace(":", "_")] = tags[k]
        if spec.get("span"):
            rec["span"] = spec["span"]
        if g.geom_type in ("Polygon", "MultiPolygon", "LineString"):
            if key in FRONT_OVERRIDE:
                rec["front"] = FRONT_OVERRIDE[key]
            else:
                near = major_lines[major_tree.nearest(g.centroid)]
                q = near.interpolate(near.project(g.centroid))
                dx, dz = q.x - g.centroid.x, q.y - g.centroid.y
                n = math.hypot(dx, dz) or 1.0
                rec["front"] = [round(dx / n, 3), round(dz / n, 3)]
        if key == "fort_st_george" and g.geom_type in ("Polygon", "MultiPolygon"):
            # mapped ramparts, bastions and ravelins (barrier=city_wall) for the fort model
            zone = g.buffer(80)
            walls = []
            for w in osm.ways.values():
                t = w.get("tags") or {}
                if t.get("barrier") != "city_wall" and t.get("historic") != "citywalls":
                    continue
                xz = osm.way_xz(w)
                if xz is None or len(xz) < 2 or not zone.intersects(LineString(xz)):
                    continue
                line = LineString(xz).simplify(0.5)
                walls.append(dict(name=t.get("name", ""), pts=[round(float(v), 1) for v in np.asarray(line.coords).ravel()]))
            rec["walls"] = walls
        if spec["suppress"]:
            suppress_polys.append((key, spec["suppress"], g))
        lm_out.append(rec)

    # ---------------------------------------------------------- buildings
    t0 = time.time()
    osm_b = LB.osm_buildings(osm, land)
    releases = sorted((RAW / "overture").glob("buildings-*.parquet"))
    ml_b, ml_stats = LB.overture_ml_buildings(releases[-1].stem.split("-", 1)[1], land, osm_b) if releases else ([], {})
    bad = unary_union([p for k in ("water", "sand", "pitch", "track") for p in cover[k]] + [road_union])
    kept_ml = []
    for b in ml_b:
        if b["geom"].intersection(bad).area > 0.5 * b["geom"].area:
            ml_stats["on_water_sand_pitch_road"] = ml_stats.get("on_water_sand_pitch_road", 0) + 1
            continue
        kept_ml.append(b)
    blds = osm_b + kept_ml
    suppressed = defaultdict(list)
    keep = []
    # "inside" tests use the filled outline (stadium relations are rings around the pitch)
    suppress_polys = [(k, m, unary_union([shapely.Polygon(q.exterior) for q in polygon_parts(g)]).buffer(4) if m == "inside" else g)
                      for k, m, g in suppress_polys]
    for b in blds:
        c = b["geom"].centroid
        hit = None
        for key, mode, g in suppress_polys:
            if g.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            if mode == "inside" and g.contains(c):
                hit = key
            elif mode == "self" and b["geom"].intersection(g).area > 0.5 * min(b["geom"].area, g.area):
                hit = key
            if hit:
                break
        if hit:
            suppressed[hit].append(b["id"])
        else:
            keep.append(b)
    blds = keep
    for rec in lm_out:
        rec["replaces"] = len(suppressed.get(rec["key"], []))
    g25_path = RAW / "2p5d" / "heights_2023_2m.npz"
    g25 = LB.Google25D(g25_path) if g25_path.exists() else None
    hstats = LB.assign_heights(blds, g25)
    # base height: lowest terrain under the footprint so nothing floats
    for b in blds:
        c = np.asarray(b["geom"].exterior.coords)
        b["base"] = float(np.min(terrain.at(c[:, 0], c[:, 1])))
    log(f"buildings: {len(osm_b)} OSM + {len(kept_ml)} Overture ML -> {len(blds)} kept "
        f"({sum(len(v) for v in suppressed.values())} replaced by landmarks) in {time.time()-t0:.0f}s; {hstats}")

    # ---------------------------------------------------------- trees + lamps
    bld_union = unary_union([b["geom"] for b in blds])
    sea = frame.difference(land)
    blockers = unary_union([bld_union.buffer(1.2), road_union, sea] + ([ballast_union] if ballast_union is not None else [])
                           + [p for k in ("water", "sand", "pitch", "track", "platform", "parking") for p in cover[k]])
    shapely.prepare(blockers)
    mapped = LT.mapped_trees(osm, land)
    illus = LT.illustrated_trees(rng, roads, cover, blockers, mapped, coast_dist)
    illus = illus[shapely.contains_xy(land, illus[:, 0], illus[:, 1])]
    lamp_nodes = []
    road_tree = STRtree([r["line"] for r in roads if r["group"] in ("major", "minor")])
    road_lines = [r["line"] for r in roads if r["group"] in ("major", "minor")]
    for nid, t in osm.node_tags.items():
        if t.get("highway") == "street_lamp":
            p = osm.node_xz(nid)
            if p is None or not frame.contains(Point(p)):
                continue
            near = road_lines[road_tree.nearest(Point(p))]
            q = near.interpolate(near.project(Point(p)))
            lamp_nodes.append((p[0], p[1], math.atan2(q.y - p[1], q.x - p[0])))
    blockers_lamps = unary_union([bld_union, sea] + ([water_union] if water_union is not None else []))
    shapely.prepare(blockers_lamps)
    lamps = LT.lamps(rng, roads, blockers_lamps, lamp_nodes)
    lamps = lamps[shapely.contains_xy(land, lamps[:, 0], lamps[:, 1])]
    log(f"trees: {len(mapped)} mapped + {len(illus)} illustrated; lamps: {int(lamps[:, 3].sum())} mapped + "
        f"{int((lamps[:, 3] == 0).sum())} illustrated")

    # ---------------------------------------------------------- traffic + trains
    traffic = LN.traffic_paths(roads, land)
    graph = LN.RailGraph(osm, rails)
    station_nodes = [(STATION_EN.get(t.get("name", ""), t.get("name:en", t.get("name", ""))), t.get("name:ta", t.get("name", "") if STATION_EN.get(t.get("name", "")) else ""), np.array(osm.node_xz(nid)))
                     for nid, t in osm.node_tags.items()
                     if t.get("railway") == "station" and t.get("station") != "subway" and osm.node_xz(nid)]
    trains, used_comp = [], {}
    for key, spec in TRAIN_ROUTES.items():
        nodes, comp = graph.route(spec["waypoints"], exclude_comp=used_comp.get(spec.get("other_track_of")))
        if len(nodes) < 2:
            log(f"train {key}: no route found")
            continue
        used_comp[key] = comp
        pts, s = graph.polyline(nodes)
        pts, s = clip_path(pts, s, frame)
        stops = []
        for name, ta, p in station_nodes:
            d = np.hypot(pts[:, 0] - p[0], pts[:, 2] - p[1])
            i = int(np.argmin(d))
            if d[i] < 90 and 20 < s[i] < s[-1] - 20:
                stops.append(dict(name=name, name_ta=ta, s=round(float(s[i]), 1)))
        trains.append(dict(key=key, name=spec["name"], pts=pts, length=float(s[-1]), stops=sorted(stops, key=lambda q: q["s"])))
        log(f"train {key}: {s[-1]:.0f} m on track network {comp}, stops {[q['name'] for q in sorted(stops, key=lambda q: q['s'])]}, "
            f"{int((pts[:, 1] > 0.5).sum())}/{len(pts)} vertices elevated")

    # ---------------------------------------------------------- labels
    labels = make_labels(osm, roads, cover, land, frame, lm_out)

    # ---------------------------------------------------------- pack
    pack = Pack("world")
    meta_arrays = {}

    def add_polys(prefix, polys, simplify=0.0):
        fr, rs, xz, kept = pack_polygons(polys, simplify)
        pack.add(prefix + "_first_ring", fr)
        pack.add(prefix + "_ring_start", rs)
        pack.add(prefix + "_xz", xz)
        return kept

    # land base and cover classes (one polygon list, class per polygon)
    cover_list, cover_cls = [], []
    for cls in LG.COVER[1:]:
        for p in cover[cls]:
            cover_list.append(p)
            cover_cls.append(LG.COVER_CODE[cls])
    add_polys("land", polygon_parts(land), 0.3)
    kept = []
    fr, rs, xz, kept_polys = pack_polygons(cover_list, 0.3)
    # pack_polygons may drop tiny parts; recompute class per kept polygon
    kept_cls = []
    idx = 0
    for p, c in zip(cover_list, cover_cls):
        s = p.simplify(0.3, preserve_topology=True)
        if s.is_empty or s.geom_type != "Polygon" or s.area < 0.5:
            continue
        kept_cls.append(c)
    pack.add("cover_first_ring", fr)
    pack.add("cover_ring_start", rs)
    pack.add("cover_xz", xz)
    pack.add("cover_cls", np.array(kept_cls, np.uint8))

    road_list, road_cls = [], []
    for gi, g in enumerate(LN.ROAD_GROUPS):
        for p in road_polys[g]:
            road_list.append(p)
            road_cls.append(gi)
    walks = LN.sidewalks(roads, road_union, land, unary_union([bld_union] + ([water_union] if water_union is not None else [])))
    for p in walks:
        road_list.append(p)
        road_cls.append(len(LN.ROAD_GROUPS))  # 4 = raised footpath
    for p in ballast:
        road_list.append(p)
        road_cls.append(len(LN.ROAD_GROUPS) + 1)  # 5 = rail ballast
    fr, rs, xz, _ = pack_polygons(road_list, 0.2)
    kept_rc = [c for p, c in zip(road_list, road_cls)
               if not (lambda s: s.is_empty or s.geom_type != "Polygon" or s.area < 0.5)(p.simplify(0.2, preserve_topology=True))]
    pack.add("road_first_ring", fr)
    pack.add("road_ring_start", rs)
    pack.add("road_xz", xz)
    pack.add("road_cls", np.array(kept_rc, np.uint8))

    marks = LN.markings(roads, land)
    ms, mxz = pack_lines([m[0] for m in marks])
    pack.add("mark_start", ms)
    pack.add("mark_xz", mxz)
    pack.add("mark_kind", np.array([m[1] for m in marks], np.uint8))
    xing = LN.crossings(osm, roads)
    pack.add("xing", np.array([[q16(x), q16(z), int(round(a / math.pi * 32767)), int(round(w * 8))] for x, z, a, w in xing],
                              np.int16).ravel() if xing else np.zeros(0, np.int16))

    # buildings sorted by chunk
    ncx = int(math.ceil((bm[2] - bm[0]) / CHUNK))
    ncz = int(math.ceil((bm[3] - bm[1]) / CHUNK))
    for b in blds:
        c = b["geom"].centroid
        b["chunk"] = min(ncx - 1, int((c.x - bm[0]) // CHUNK)) + ncx * min(ncz - 1, int((c.y - bm[1]) // CHUNK))
    blds.sort(key=lambda b: (b["chunk"], b["id"]))
    fr, rs, xz, kept_b = pack_polygons([b["geom"] for b in blds], 0.15)
    kept_ids = set()
    bl2 = []
    for b in blds:
        s = b["geom"].simplify(0.15, preserve_topology=True)
        if s.is_empty or s.geom_type != "Polygon" or s.area < 0.5:
            continue
        bl2.append(b)
    assert len(bl2) == len(fr) - 1, (len(bl2), len(fr))
    chunk_start = np.searchsorted(np.array([b["chunk"] for b in bl2]), np.arange(ncx * ncz + 1)).astype(np.uint32)
    pack.add("bld_first_ring", fr)
    pack.add("bld_ring_start", rs)
    pack.add("bld_xz", xz)
    pack.add("bld_h", np.array([min(65535, round(b["h"] * 10)) for b in bl2], np.uint16))
    pack.add("bld_minh", np.array([min(65535, round(b["min_h"] * 10)) for b in bl2], np.uint16))
    pack.add("bld_base", np.array([round(b["base"] * 100) for b in bl2], np.int16))
    pack.add("bld_cls", np.array([LB.CLS[b["cls"]] for b in bl2], np.uint8))
    pack.add("bld_hsrc", np.array([b["hsrc"] for b in bl2], np.uint8))
    pack.add("bld_fsrc", np.array([b["fsrc"] for b in bl2], np.uint8))
    pack.add("bld_seed", np.array([LB.stable_hash(b["id"]) % 256 for b in bl2], np.uint8))
    pack.add("bld_chunk_start", chunk_start)

    # trees: x, z (i16) + kind, mapped, height dm, crown dm (u8)
    tree_rows = [(x, z, k, 1, h or (12.0 if k == LT.TREE_PALM else 9.0), c or (3.0 if k == LT.TREE_PALM else 4.0))
                 for x, z, k, h, c in mapped]
    tree_rows += [(x, z, int(k), 0, h, c) for x, z, k, h, c in illus]
    ta = np.array(tree_rows, float) if tree_rows else np.zeros((0, 6))
    pack.add("tree_xz", q16(ta[:, :2].ravel()))
    pack.add("tree_attr", np.column_stack([ta[:, 2], ta[:, 3], np.clip(np.round(ta[:, 4] * 10), 0, 255),
                                           np.clip(np.round(ta[:, 5] * 20), 0, 255)]).astype(np.uint8).ravel())
    pack.add("tree_y", np.round(terrain.at(ta[:, 0], ta[:, 1]) * 100).astype(np.int16))
    pack.add("lamp_xz", q16(lamps[:, :2].ravel()))
    pack.add("lamp_attr", np.column_stack([np.round((lamps[:, 2] % (2 * math.pi)) / (2 * math.pi) * 255), lamps[:, 3]]).astype(np.uint8).ravel())
    pack.add("lamp_y", np.round(terrain.at(lamps[:, 0], lamps[:, 1]) * 100).astype(np.int16))

    ts, txz = pack_lines([t["line"] for t in traffic])
    pack.add("trf_start", ts)
    pack.add("trf_xz", txz)
    cls_code = {"trunk": 0, "primary": 1, "secondary": 2, "trunk_link": 3, "primary_link": 3}
    names = sorted({t["name"] for t in traffic})
    pack.add("trf_attr", np.array([[cls_code.get(t["cls"], 2), t["lanes"], int(t["oneway"]), names.index(t["name"]) % 256]
                                   for t in traffic], np.uint8).ravel() if traffic else np.zeros(0, np.uint8))
    for t in trains:
        pack.add(f"train_{t['key']}_xyz", q16(t["pts"].ravel()))
    rl, rattr = [], []
    for r in rails:
        g = r["line"].intersection(frame)
        for part in ([g] if g.geom_type == "LineString" else [q for q in getattr(g, "geoms", []) if q.geom_type == "LineString"]):
            if part.length >= 2:
                rl.append(part)
                rattr.append([int(r["bridge"]), 1 if r["service"] else 0])
    rls, rlxz = pack_lines(rl)
    pack.add("rail_start", rls)
    pack.add("rail_xz", rlxz)
    pack.add("rail_attr", np.array(rattr, np.uint8).ravel())

    # terrain (cm) and coast distance (u8: 128 + d/1.5 m, + at sea)
    pack.add("terrain_h", np.round(ter["h"] * 100).astype(np.int16).ravel())
    pack.add("coast_sdf", np.clip(np.round(128 + sdf / 1.5), 0, 255).astype(np.uint8).ravel())
    pinfo = pack.write(OUT)

    # ---------------------------------------------------------- scene.json
    hs_counts = Counter(LB.HS_NAMES[b["hsrc"]] for b in bl2)
    fs_names = {LB.FS_OSM: "openstreetmap", LB.FS_GOOGLE: "google_open_buildings", LB.FS_MICROSOFT: "microsoft_ml", LB.FS_OTHER: "other"}
    fs_counts = Counter(fs_names[b["fsrc"]] for b in bl2)
    n_mapped_trees = len(mapped)
    n_illus_trees = len(illus)
    counts = dict(buildings=len(bl2), buildings_by_footprint=dict(fs_counts), heights=dict(hs_counts),
                  trees_mapped=n_mapped_trees, trees_illustrated=n_illus_trees,
                  lamps_mapped=int(lamps[:, 3].sum()), lamps_illustrated=int((lamps[:, 3] == 0).sum()),
                  road_km=round(sum(r["line"].intersection(land).length for r in roads if r["group"] != "path") / 1000, 1),
                  rail_km=round(sum(r["line"].intersection(land).length for r in rails) / 1000, 1),
                  traffic_paths=len(traffic), landmarks=len([l for l in lm_out if l["model"]]))
    scene = dict(
        version=1, built=date.today().isoformat(),
        meta=dict(title="Marina, Live", bbox=BBOX, origin=[ORIGIN_LON, ORIGIN_LAT], frame_m=[round(v, 2) for v in bm],
                  quant=QUANT, chunk=CHUNK, chunks=[ncx, ncz], counts=counts,
                  cover_classes=LG.COVER, road_classes=LN.ROAD_GROUPS + ["footpath", "ballast"],
                  building_classes=list(LB.CLS), height_sources=[LB.HS_NAMES[i] for i in range(5)],
                  footprint_sources=[fs_names[i] for i in range(4)], tree_kinds=["broadleaf", "palm", "columnar"],
                  traffic_names=names,
                  sources=["OpenStreetMap contributors (ODbL)", "Overture Maps Foundation buildings (incl. Google Open Buildings and Microsoft ML footprints)",
                           "Google Open Buildings 2.5D Temporal heights, 2023 (CC BY 4.0)", "Mapzen Terrain Tiles via AWS Open Data (SRTM)"],
                  mapped="Footprints, roads, rail, coastline, water, parks, mapped trees and mapped street lamps are at OpenStreetMap or Overture positions.",
                  illustrated="Landmark models, facades, vehicles, trains, waves, the extra trees and street lamps are illustrated.",
                  terrain=dict(x0=ter["x0"], z0=ter["z0"], step=ter["step"], cols=ter["cols"], rows=ter["rows"]),
                  coast=dict(x0=float(sxs[0]), z0=float(szs[0]), step=sdf_step, cols=len(sxs), rows=len(szs), scale=1.5)),
        landmarks=lm_out,
        trains=[dict(key=t["key"], name=t["name"], length=round(t["length"], 1), stops=t["stops"]) for t in trains],
        labels=labels,
        packs={"world": pinfo},
    )
    write_json(OUT / "scene.json", scene, compact=True)
    scene_bytes = (OUT / "scene.json").stat().st_size
    import gzip
    scene_gz = len(gzip.compress((OUT / "scene.json").read_bytes(), 9))

    build = dict(counts=counts, overture=ml_stats, heights=hstats, suppressed={k: len(v) for k, v in suppressed.items()},
                 sizes=dict(scene_json=scene_bytes, scene_json_gz=scene_gz, world_pack_gz=pinfo["bytes"], world_pack_raw=pinfo["raw"]),
                 arrays={k: v["length"] for k, v in pinfo["arrays"].items()}, seconds=round(time.time() - t_start))
    write_json(REPORTS / "build.json", build)
    log(f"wrote scene.json {scene_bytes/1e3:.0f} kB ({scene_gz/1e3:.0f} kB gz), world.pack {pinfo['bytes']/1e6:.2f} MB gz "
        f"({pinfo['raw']/1e6:.2f} MB raw) in {time.time()-t_start:.0f}s")

    from lib_preview import draw_preview
    draw_preview(REPORTS / "preview.png", bm, land, cover, road_polys, ballast, bl2, lm_geoms, ta, lamps, trains)


CENTRAL_FRONT_WAY = 214739119  # long east-west roof along the station frontage


def central_building(osm, station):
    """OSM maps only the platform roofs at Central, not the red heritage building.
    Its footprint is illustrated: 190 x 28 m along the frontage roof (way 214739119),
    reaching north into the station, where the clock tower building stands."""
    import shapely.affinity as aff
    w = osm.ways.get(CENTRAL_FRONT_WAY)
    if not w:
        return station
    g = osm.way_geometry(w)
    if g is None or g.geom_type != "Polygon":
        return station
    ang = principal_angle(g)
    c = g.centroid
    rect = box(-95, -14, 95, 14)
    rect = aff.rotate(rect, ang, origin=(0, 0), use_radians=True)
    # shift north (-z) so the front of the block sits on the frontage roof line
    nx, nz = -math.sin(ang), math.cos(ang)
    if nz > 0:
        nx, nz = -nx, -nz
    return aff.translate(rect, c.x + nx * 12, c.y + nz * 12)


def make_labels(osm, roads, cover, land, frame, landmarks) -> dict:
    places = []
    for nid, t in osm.node_tags.items():
        if t.get("place") in ("suburb", "neighbourhood", "quarter", "locality") and t.get("name"):
            p = osm.node_xz(nid)
            if p and land.contains(Point(p)):
                places.append(dict(n=t.get("name:en", t["name"]), ta=t.get("name:ta", ""), x=round(p[0], 1), z=round(p[1], 1),
                                   k=t["place"]))
    stations = []
    for nid, t in osm.node_tags.items():
        if t.get("railway") == "station" and t.get("station") != "subway" and t.get("name"):
            p = osm.node_xz(nid)
            name = STATION_EN.get(t["name"], t.get("name:en", t["name"]))
            # Central already has a landmark label; "Chennai Park" is the suburban Park station
            if not p or not frame.contains(Point(p)) or "Central" in name:
                continue
            ta = t.get("name:ta", t["name"] if t["name"] in STATION_EN else "")
            stations.append(dict(n=name, ta=ta, x=round(p[0], 1), z=round(p[1], 1)))
    by_name = defaultdict(list)
    for r in roads:
        t = r["tags"]
        if t["highway"] in ("trunk", "primary", "secondary", "tertiary") and t.get("name"):
            by_name[(t.get("name:en", t["name"]), t.get("name:ta", ""))].append(r["line"])
    road_labels = []
    for (name, ta), lines in by_name.items():
        merged = shapely.line_merge(shapely.MultiLineString(lines))
        parts = [merged] if merged.geom_type == "LineString" else list(merged.geoms)
        total = sum(p.length for p in parts)
        if total < 250:
            continue
        for p in sorted(parts, key=lambda q: -q.length)[:3]:
            p = p.intersection(frame)
            if p.is_empty or p.geom_type != "LineString" or p.length < 200:
                continue
            n = max(1, int(p.length // 900))
            for i in range(n):
                d = p.length * (i + 0.5) / n
                a, b = p.interpolate(max(0, d - 15)), p.interpolate(min(p.length, d + 15))
                c = p.interpolate(d)
                road_labels.append(dict(n=name, ta=ta, x=round(c.x, 1), z=round(c.y, 1),
                                        a=round(math.atan2(b.y - a.y, b.x - a.x), 3), len=round(total)))
    parks = []
    for w in osm.ways.values():
        t = w.get("tags") or {}
        if t.get("name") and (t.get("leisure") in ("park", "garden") or t.get("landuse") == "recreation_ground"):
            g = osm.way_geometry(w)
            if g is not None and g.geom_type == "Polygon" and g.area > 3000 and land.contains(g.centroid):
                c = g.representative_point()
                parks.append(dict(n=t.get("name:en", t["name"]), ta=t.get("name:ta", ""), x=round(c.x, 1), z=round(c.y, 1), a=round(g.area)))
    water = []
    seen = set()
    for w in osm.ways.values():
        t = w.get("tags") or {}
        nm = t.get("name:en", t.get("name"))
        if nm and (t.get("waterway") in ("river", "canal") or t.get("natural") == "water") and nm not in seen:
            g = osm.way_geometry(w)
            if g is None:
                continue
            g = g.intersection(frame)
            if g.is_empty:
                continue
            c = g.representative_point() if g.geom_type in ("Polygon", "MultiPolygon") else g.interpolate(0.5, normalized=True)
            seen.add(nm)
            water.append(dict(n=nm, ta=t.get("name:ta", ""), x=round(c.x, 1), z=round(c.y, 1)))
    x0, z0, x1, z1 = frame.bounds
    water.append(dict(n="Bay of Bengal", ta="வங்காள விரிகுடா", x=round(x1 - 380, 1), z=round((z0 + z1) / 2, 1), sea=True))
    return dict(places=places, stations=stations, roads=road_labels, parks=parks, water=water)


if __name__ == "__main__":
    main()
