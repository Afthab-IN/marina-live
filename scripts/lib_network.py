"""Roads, rail, traffic paths and train paths from OSM centrelines."""
from __future__ import annotations

import heapq
import math
from collections import defaultdict

import numpy as np
import shapely
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from common import log, project
from geo import clean_polygon, parse_float, polygon_parts

# highway class -> (group, default width of a two-way road in metres)
ROAD = {
    "motorway": ("major", 20), "trunk": ("major", 18), "primary": ("major", 14), "secondary": ("major", 11),
    "motorway_link": ("major", 7), "trunk_link": ("major", 7), "primary_link": ("major", 7),
    "secondary_link": ("major", 6), "busway": ("major", 7),
    "tertiary": ("minor", 8.5), "tertiary_link": ("minor", 6), "unclassified": ("minor", 6),
    "residential": ("minor", 6), "living_street": ("minor", 5), "road": ("minor", 6),
    "service": ("service", 4), "track": ("service", 3.5),
    "pedestrian": ("path", 5), "footway": ("path", 2.2), "path": ("path", 1.8), "cycleway": ("path", 2.2),
    "steps": ("path", 2.5), "bridleway": ("path", 2.0),
}
ROAD_GROUPS = ["major", "minor", "service", "path"]  # drawing priority, highest first
ROAD_CLASS_CODE = {k: i for i, k in enumerate(ROAD)}


def road_width(t: dict) -> float:
    hw = t["highway"]
    group, w = ROAD[hw]
    tw = parse_float(t.get("width"))
    if tw and 1.5 <= tw <= 40:
        return tw
    lanes = parse_float(t.get("lanes"))
    oneway = t.get("oneway") in ("yes", "1", "-1") or t.get("junction") == "roundabout"
    if lanes and group in ("major", "minor") and 1 <= lanes <= 10:
        return lanes * 3.2 + (0.8 if group == "major" else 0.4)
    if hw == "service" and t.get("service") in ("driveway", "parking_aisle", "alley", "drive-through"):
        return 3.2
    if t.get("footway") == "sidewalk":
        return 2.0
    if oneway and group == "major" and not hw.endswith("_link"):
        return w * 0.62
    return w


def road_ways(osm) -> list[dict]:
    out = []
    for w in osm.ways.values():
        t = w.get("tags") or {}
        hw = t.get("highway")
        if hw not in ROAD or t.get("area") == "yes" or t.get("tunnel") in ("yes", "building_passage") \
                or t.get("indoor") == "yes" or parse_float(t.get("layer"), 0) < 0:
            continue
        xz = osm.way_xz(w)
        if xz is None or len(xz) < 2:
            continue
        out.append(dict(id=w["id"], tags=t, line=LineString(xz), width=road_width(t), group=ROAD[hw][0],
                        nodes=w.get("nodes", [])))
    return out


def road_polygons(roads, frame) -> dict[str, list]:
    out, covered = {}, None
    for g in ROAD_GROUPS:
        polys = [r["line"].buffer(r["width"] / 2, cap_style="flat", join_style="round", quad_segs=3)
                 for r in roads if r["group"] == g]
        # round caps only at real ends would be nicer; a small disc at every vertex hides joint gaps
        if not polys:
            out[g] = []
            continue
        geom = unary_union(polys).intersection(frame)
        if covered is not None:
            geom = geom.difference(covered)
        geom = clean_polygon(geom)
        out[g] = [p for p in polygon_parts(geom) if p.area >= 2]
        covered = geom if covered is None else unary_union([covered, geom])
    return out


def sidewalks(roads, road_union, frame, blockers) -> list:
    """2.5 m raised footpaths along major roads (illustrated where OSM maps no sidewalk)."""
    polys = [r["line"].buffer(r["width"] / 2 + 2.5, cap_style="flat", join_style="round", quad_segs=3)
             for r in roads if r["group"] == "major" and r["width"] >= 9]
    if not polys:
        return []
    g = unary_union(polys).intersection(frame).difference(road_union)
    if blockers is not None:
        g = g.difference(blockers)
    return [p for p in polygon_parts(clean_polygon(g)) if p.area >= 3]


def markings(roads, frame) -> list[tuple[LineString, int]]:
    """Lane markings: (line, kind). kind 0 = dashed centre line, 1 = dashed lane divider."""
    out = []
    for r in roads:
        t = r["tags"]
        if r["group"] != "major" or t["highway"].endswith("_link"):
            continue
        line = r["line"].intersection(frame)
        if line.is_empty:
            continue
        lines = [line] if line.geom_type == "LineString" else [g for g in getattr(line, "geoms", []) if g.geom_type == "LineString"]
        oneway = t.get("oneway") in ("yes", "1", "-1")
        for l in lines:
            if l.length < 15:
                continue
            if not oneway:
                out.append((l, 0))
            elif r["width"] >= 7:
                out.append((l, 1))
    return out


def crossings(osm, roads) -> list[tuple[float, float, float, float]]:
    """Zebra crossings (x, z, angle of the road, road width) at mapped crossing nodes."""
    node_road = {}
    for r in roads:
        if r["group"] not in ("major", "minor"):
            continue
        for i, n in enumerate(r["nodes"]):
            node_road.setdefault(n, (r, i))
    out = []
    for nid, t in osm.node_tags.items():
        if t.get("highway") != "crossing" and t.get("crossing") not in ("zebra", "marked", "traffic_signals"):
            continue
        if nid not in node_road:
            continue
        r, i = node_road[nid]
        nodes = r["nodes"]
        a = osm.node_xz(nodes[max(0, i - 1)])
        b = osm.node_xz(nodes[min(len(nodes) - 1, i + 1)])
        p = osm.node_xz(nid)
        if a is None or b is None or p is None or a == b:
            continue
        out.append((p[0], p[1], math.atan2(b[1] - a[1], b[0] - a[0]), r["width"]))
    return out


# ------------------------------------------------------------------ rail
RAIL_KINDS = ("rail", "light_rail", "narrow_gauge")


def rail_ways(osm) -> list[dict]:
    out = []
    for w in osm.ways.values():
        t = w.get("tags") or {}
        if t.get("railway") not in RAIL_KINDS or t.get("tunnel") == "yes":
            continue
        xz = osm.way_xz(w)
        if xz is None:
            continue
        bridge = t.get("bridge") in ("yes", "viaduct") or parse_float(t.get("layer"), 0) >= 1
        out.append(dict(id=w["id"], tags=t, line=LineString(xz), nodes=w.get("nodes", []), bridge=bridge,
                        service=t.get("service", ""), name=t.get("name", "")))
    return out


def ballast(rails, frame) -> list:
    polys = [r["line"].buffer(2.2, cap_style="flat") for r in rails if not r["bridge"]]
    if not polys:
        return []
    return [p for p in polygon_parts(clean_polygon(unary_union(polys).intersection(frame))) if p.area >= 2]


class RailGraph:
    def __init__(self, osm, rails):
        self.osm = osm
        self.adj = defaultdict(list)
        self.bridge_edge = set()
        for r in rails:
            n = r["nodes"]
            for a, b in zip(n[:-1], n[1:]):
                pa, pb = osm.node_xz(a), osm.node_xz(b)
                if pa is None or pb is None:
                    continue
                d = math.dist(pa, pb)
                self.adj[a].append((b, d))
                self.adj[b].append((a, d))
                if r["bridge"]:
                    self.bridge_edge.add((a, b))
                    self.bridge_edge.add((b, a))
        self.ids = np.array(list(self.adj.keys()))
        self.xz = np.array([osm.node_xz(i) for i in self.ids])
        # connected components (parallel tracks are often separate networks in OSM)
        self.comp = {}
        cid = 0
        for start in self.adj:
            if start in self.comp:
                continue
            stack = [start]
            self.comp[start] = cid
            while stack:
                u = stack.pop()
                for v, _ in self.adj[u]:
                    if v not in self.comp:
                        self.comp[v] = cid
                        stack.append(v)
            cid += 1
        self.comp_arr = np.array([self.comp[int(i)] for i in self.ids])

    def nearest(self, lon, lat, comp=None):
        x, z = project(lon, lat)
        d = (self.xz[:, 0] - x) ** 2 + (self.xz[:, 1] - z) ** 2
        if comp is not None:
            d = np.where(self.comp_arr == comp, d, np.inf)
        i = int(np.argmin(d))
        return int(self.ids[i]), float(np.sqrt(d[i]))

    def path(self, a: int, b: int) -> list[int]:
        dist, prev = {a: 0.0}, {}
        pq = [(0.0, a)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == b:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w in self.adj[u]:
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))
        if b not in dist:
            return []
        out = [b]
        while out[-1] != a:
            out.append(prev[out[-1]])
        return out[::-1]

    def route(self, waypoints, exclude_comp=None, max_snap=80.0):
        """Shortest path through the waypoints, all on one connected track network.
        Returns (nodes, component)."""
        sizes = {}
        for c in self.comp.values():
            sizes[c] = sizes.get(c, 0) + 1
        for comp in sorted(sizes, key=lambda c: -sizes[c]):
            if comp == exclude_comp:
                continue
            snaps = [self.nearest(lon, lat, comp) for lon, lat in waypoints]
            if any(d > max_snap for _, d in snaps):
                continue
            nodes = []
            for (a, _), (b, _) in zip(snaps[:-1], snaps[1:]):
                leg = self.path(a, b)
                if not leg:
                    nodes = []
                    break
                nodes.extend(leg if not nodes else leg[1:])
            if nodes:
                return nodes, comp
        return [], None

    def polyline(self, nodes: list[int], deck: float = 8.5, ramp: float = 140.0):
        """(n, 3) array x, y, z where y is the illustrated deck height on bridge sections."""
        xz = np.array([self.osm.node_xz(n) for n in nodes])
        seg = np.hypot(*np.diff(xz, axis=0).T)
        s = np.concatenate([[0], np.cumsum(seg)])
        on = np.zeros(len(nodes))
        for i in range(len(nodes) - 1):
            if (nodes[i], nodes[i + 1]) in self.bridge_edge:
                on[i] = on[i + 1] = 1
        # smooth ramps: deck height follows distance to the nearest at-grade point
        y = np.zeros(len(nodes))
        grade = s[on == 0]
        for i in range(len(nodes)):
            if on[i] and len(grade):
                d = np.min(np.abs(grade - s[i]))
                y[i] = deck * min(1.0, d / ramp)
            elif on[i]:
                y[i] = deck
        return np.column_stack([xz[:, 0], y, xz[:, 1]]), s


# ------------------------------------------------------------------ traffic
def traffic_paths(roads, frame, min_len=150.0) -> list[dict]:
    """Directed vehicle paths along trunk/primary/secondary roads, merged per name."""
    groups = defaultdict(list)
    for r in roads:
        t = r["tags"]
        if t["highway"] not in ("trunk", "primary", "secondary", "trunk_link", "primary_link"):
            continue
        oneway = t.get("oneway") in ("yes", "1") or t.get("junction") == "roundabout"
        line = r["line"]
        if t.get("oneway") == "-1":
            line, oneway = LineString(list(line.coords)[::-1]), True
        groups[(t.get("name", "") or f"_{t['highway']}", oneway)].append((line, r))
    out = []
    for (name, oneway), items in groups.items():
        lines = [l for l, _ in items]
        merged = shapely.line_merge(shapely.MultiLineString(lines), directed=oneway)
        parts = [merged] if merged.geom_type == "LineString" else list(merged.geoms)
        hw = items[0][1]["tags"]["highway"]
        lanes = parse_float(items[0][1]["tags"].get("lanes"))
        for p in parts:
            p = p.intersection(frame)
            segs = [p] if p.geom_type == "LineString" else [g for g in getattr(p, "geoms", []) if g.geom_type == "LineString"]
            for sgm in segs:
                if sgm.length < min_len:
                    continue
                sgm = sgm.simplify(0.4)
                if oneway:
                    lpd = int(lanes) if lanes else 2
                    out.append(dict(name=name, line=sgm, cls=hw, lanes=max(1, min(4, lpd)), oneway=True))
                else:
                    lpd = int(lanes // 2) if lanes and lanes >= 2 else 1
                    for l in (sgm, LineString(list(sgm.coords)[::-1])):
                        out.append(dict(name=name, line=l, cls=hw, lanes=max(1, min(3, lpd)), oneway=False))
    return out
