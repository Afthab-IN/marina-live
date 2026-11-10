"""Geometry helpers: Overpass JSON -> shapely geometries in local metres."""
from __future__ import annotations

import math
import re

import numpy as np
import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import polygonize, unary_union

from common import project


def name_all(tags: dict) -> str:
    """Every name-like tag joined, so patterns match English and Tamil names."""
    return " | ".join(v for k, v in tags.items() if k == "name" or k.startswith("name:")
                      or k in ("official_name", "alt_name", "old_name", "short_name"))


def xz_from_geom(points) -> np.ndarray:
    """Overpass `geometry` list [{'lat','lon'}...] -> (n, 2) array of x, z metres."""
    lon = np.fromiter((p["lon"] for p in points), float)
    lat = np.fromiter((p["lat"] for p in points), float)
    x, z = project(lon, lat)
    return np.column_stack([x, z])


def clean_polygon(geom):
    """Make a polygon valid and drop slivers. Returns Polygon/MultiPolygon or None."""
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        geom = unary_union(polys) if polys else None
    if geom is None or geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
        return None
    return geom


def ring_polygon(xz: np.ndarray):
    if len(xz) < 4:
        return None
    if not np.allclose(xz[0], xz[-1]):
        return None
    return clean_polygon(Polygon(xz))


def multipolygon_from_lines(outer: list[np.ndarray], inner: list[np.ndarray]):
    """Assemble a multipolygon relation from its member way lines."""
    def polys(lines):
        if not lines:
            return []
        merged = unary_union([LineString(l) for l in lines if len(l) >= 2])
        return list(polygonize(merged))
    outers = polys(outer)
    if not outers:
        return None
    geom = unary_union(outers)
    inners = polys(inner)
    if inners:
        geom = geom.difference(unary_union(inners))
    return clean_polygon(geom)


def element_geometry(el: dict):
    """Geometry for an Overpass element returned with `out geom`."""
    t = el["type"]
    if t == "node":
        x, z = project(el["lon"], el["lat"])
        return Point(x, z)
    if t == "way":
        g = el.get("geometry")
        if not g:
            return None
        xz = xz_from_geom(g)
        if len(xz) >= 4 and el.get("nodes") and el["nodes"][0] == el["nodes"][-1]:
            poly = ring_polygon(xz)
            if poly is not None:
                return poly
        return LineString(xz) if len(xz) >= 2 else None
    if t == "relation":
        outer, inner, lines = [], [], []
        for m in el.get("members", []):
            if m.get("type") != "way" or not m.get("geometry"):
                continue
            xz = xz_from_geom([p for p in m["geometry"] if p])
            role = m.get("role", "")
            (inner if role == "inner" else outer).append(xz)
            lines.append(xz)
        geom = multipolygon_from_lines(outer, inner)
        if geom is not None:
            return geom
        if lines:
            return shapely.MultiLineString([l for l in lines if len(l) >= 2])
    return None


class OsmIndex:
    """Index of an Overpass `out body; >; out skel qt;` response."""

    def __init__(self, data: dict):
        self.nodes: dict[int, tuple[float, float]] = {}
        self.node_tags: dict[int, dict] = {}
        self.ways: dict[int, dict] = {}
        self.relations: dict[int, dict] = {}
        for el in data["elements"]:
            t = el["type"]
            if t == "node":
                self.nodes[el["id"]] = (el["lon"], el["lat"])
                if el.get("tags"):
                    self.node_tags[el["id"]] = el["tags"]
            elif t == "way":
                self.ways[el["id"]] = el
            elif t == "relation":
                self.relations[el["id"]] = el
        ids = np.fromiter(self.nodes.keys(), np.int64)
        ll = np.array(list(self.nodes.values()), float) if self.nodes else np.zeros((0, 2))
        x, z = project(ll[:, 0], ll[:, 1]) if len(ll) else (np.zeros(0), np.zeros(0))
        self._xz = {int(i): (float(a), float(b)) for i, a, b in zip(ids, x, z)}

    def node_xz(self, nid: int):
        return self._xz.get(nid)

    def way_xz(self, way: dict) -> np.ndarray | None:
        pts = [self._xz.get(n) for n in way.get("nodes", [])]
        if any(p is None for p in pts) or len(pts) < 2:
            pts = [p for p in pts if p is not None]
            if len(pts) < 2:
                return None
        return np.array(pts, float)

    def way_geometry(self, way: dict):
        xz = self.way_xz(way)
        if xz is None:
            return None
        nodes = way.get("nodes", [])
        if len(nodes) >= 4 and nodes[0] == nodes[-1]:
            poly = ring_polygon(xz)
            if poly is not None:
                return poly
        return LineString(xz)

    def relation_polygon(self, rel: dict):
        outer, inner = [], []
        for m in rel.get("members", []):
            if m["type"] != "way":
                continue
            w = self.ways.get(m["ref"])
            if not w:
                continue
            xz = self.way_xz(w)
            if xz is None:
                continue
            (inner if m.get("role") == "inner" else outer).append(xz)
        return multipolygon_from_lines(outer, inner)


def polygon_parts(geom):
    if geom is None:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type == "MultiPolygon":
        return list(geom.geoms)
    if geom.geom_type == "GeometryCollection":
        out = []
        for g in geom.geoms:
            out.extend(polygon_parts(g))
        return out
    return []


def principal_angle(poly) -> float:
    """Angle (radians, about +y) of the long axis of the minimum rotated rectangle."""
    rect = poly.minimum_rotated_rectangle
    c = np.asarray(rect.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    e = e1 if np.hypot(*e1) >= np.hypot(*e2) else e2
    return math.atan2(e[1], e[0])


def rect_dims(poly) -> tuple[float, float]:
    rect = poly.minimum_rotated_rectangle
    c = np.asarray(rect.exterior.coords)[:4]
    a, b = np.hypot(*(c[1] - c[0])), np.hypot(*(c[2] - c[1]))
    return (max(a, b), min(a, b))


def parse_float(value, default=None):
    if value is None:
        return default
    m = re.match(r"\s*(-?\d+(?:[.,]\d+)?)", str(value))
    if not m:
        return default
    try:
        return float(m.group(1).replace(",", "."))
    except ValueError:
        return default
