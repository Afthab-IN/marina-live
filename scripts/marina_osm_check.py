"""Validation report for the Marina corridor, run before anything else.

Counts the OSM features inside the bbox and finds each landmark by name pattern
and tags. Writes reports/osm_check.json and reports/osm_check.md, and exits with
code 1 if a required landmark is missing.

    .venv/bin/python scripts/marina_osm_check.py
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from typing import Callable

from common import BBOX, REPORTS, bbox_m, bbox_overpass, inside_bbox, log, overpass, unproject, write_json
from geo import element_geometry, name_all

MARGIN = 0.012  # degrees searched outside the box, so "just outside" gets reported


def has(t, k, *vals):
    return k in t and (not vals or t[k] in vals)


def named(t, pattern):
    return re.search(pattern, name_all(t), re.I) is not None


def is_building(t):
    return "building" in t and t["building"] != "no"


def not_metro(t):
    return t.get("station") != "subway" and not named(t, r"metro|high speed")


@dataclass
class Landmark:
    key: str
    label: str
    required: bool
    match: Callable[[dict], bool]
    prefer: str = "largest"  # largest | node | tallest | south | longest
    within: str | None = None  # key of a landmark whose polygon must contain the match


LANDMARKS = [
    Landmark("chepauk_stadium", "MA Chidambaram Stadium (Chepauk)", True,
             lambda t: (has(t, "leisure", "stadium") or has(t, "building", "stadium") or is_building(t))
             and named(t, r"chidambaram|chepauk stadium")),
    Landmark("lighthouse", "Chennai Lighthouse (Marina)", True,
             lambda t: has(t, "man_made", "lighthouse") and not named(t, r"\bold\b"), "south"),
    Landmark("lic_building", "LIC Building, Anna Salai", True,
             lambda t: is_building(t) and named(t, r"life insurance|\blic\b"), "tallest"),
    Landmark("chepauk_station", "Chepauk railway station", True,
             lambda t: has(t, "railway", "station") and not_metro(t) and named(t, r"chepauk|சேப்பாக்கம்"), "node"),
    Landmark("chennai_central", "Chennai Central", True,
             lambda t: has(t, "railway", "station") and not_metro(t)
             and named(t, r"ramachandran central|chennai central|சென்னை சென்ட்ரல்")
             and not named(t, r"suburban|moore market"), "node"),
    Landmark("nehru_stadium", "Jawaharlal Nehru Stadium (Periamet)", True,
             lambda t: (has(t, "leisure", "stadium") or has(t, "building", "stadium"))
             and named(t, r"jawaharlal nehru stadium") and not named(t, r"indoor")),
    Landmark("marina_beach", "Marina Beach", True,
             lambda t: has(t, "natural", "beach") and named(t, r"marina")),
    Landmark("fort_st_george", "Fort St George", False,
             lambda t: named(t, r"fort st\.? ?george|fort saint george")
             and (has(t, "historic") or has(t, "tourism") or has(t, "military"))),
    # Extras chosen on 10 Nov 2026 (simpler hand models)
    Landmark("napier_bridge", "Napier Bridge", False,
             lambda t: named(t, r"napier") and (has(t, "bridge") or has(t, "man_made", "bridge")), "longest"),
    Landmark("high_court", "Madras High Court", False,
             lambda t: named(t, r"high court") and not has(t, "railway") and not has(t, "highway")
             and (has(t, "amenity", "courthouse") or is_building(t) or has(t, "office"))),
    Landmark("ripon_building", "Ripon Building", False,
             lambda t: named(t, r"ripon") and not has(t, "highway")),
    Landmark("chepauk_palace", "Chepauk Palace", False,
             lambda t: named(t, r"chepauk palace|kalas mahal|khalsa mahal|humayun mahal")),
    Landmark("presidency_college", "Presidency College", False,
             lambda t: named(t, r"presidency college") and not has(t, "highway")),
    Landmark("senate_house", "Senate House", False,
             lambda t: named(t, r"senate house")),
    Landmark("pwd_building", "PWD building", False,
             lambda t: named(t, r"public works department|\bpwd\b") and (is_building(t) or has(t, "historic"))),
    Landmark("st_marys_church", "St Mary's Church, Fort", False,
             lambda t: named(t, r"st\.? ?mary") and has(t, "amenity", "place_of_worship"), within="fort_st_george"),
    Landmark("fort_flagstaff", "Fort St George flagstaff", False,
             lambda t: has(t, "man_made", "flagpole") or named(t, r"flag ?staff"), within="fort_st_george"),
    Landmark("kamarajar_salai", "Kamarajar Salai (road)", True,
             lambda t: has(t, "highway") and named(t, r"kamarajar|காமராசர்"), "longest"),
    Landmark("anna_salai", "Anna Salai (road)", True,
             lambda t: has(t, "highway") and named(t, r"anna salai|mount road|அண்ணா சாலை"), "longest"),
]

NAME_RX = ("Chidambaram|Chepauk|சேப்பாக்கம்|Nehru|Life Insurance|LIC|Central|சென்ட்ரல்|Marina|Fort St|"
           "Fort Saint|Napier|High Court|Ripon|Palace|Mahal|Presidency College|Senate House|"
           "Public Works|PWD|Mary|Flag|Kamarajar|காமராசர்|Anna Salai|அண்ணா சாலை|Mount Road")

COUNT_LAYERS = [
    ("buildings (ways)", 'way["building"]'),
    ("buildings (relations)", 'relation["building"]'),
    ("buildings with building:levels", 'way["building"]["building:levels"]'),
    ("buildings with height", 'way["building"]["height"]'),
    ("building parts", 'way["building:part"]'),
    ("roads: trunk/primary/secondary", 'way["highway"~"^(trunk|primary|secondary)(_link)?$"]'),
    ("roads: tertiary/residential/other", 'way["highway"~"^(tertiary|tertiary_link|residential|unclassified|living_street|service)$"]'),
    ("paths: footway/path/pedestrian/steps", 'way["highway"~"^(footway|path|pedestrian|steps|cycleway)$"]'),
    ("rail ways (rail/light_rail/subway)", 'way["railway"~"^(rail|light_rail|subway)$"]'),
    ("rail ways on bridges", 'way["railway"~"^(rail|light_rail)$"]["bridge"]'),
    ("platforms", 'way["railway"="platform"]'),
    ("coastline ways", 'way["natural"="coastline"]'),
    ("beach/sand areas", 'nwr["natural"~"^(beach|sand)$"]'),
    ("water areas", 'nwr["natural"="water"]'),
    ("waterways", 'way["waterway"]'),
    ("parks/gardens", 'nwr["leisure"~"^(park|garden)$"]'),
    ("pitches/sports areas", 'nwr["leisure"~"^(pitch|sports_centre|track)$"]'),
    ("landuse areas", 'nwr["landuse"]'),
    ("trees (nodes)", 'node["natural"="tree"]'),
    ("tree rows", 'way["natural"="tree_row"]'),
    ("street lamps", 'node["highway"="street_lamp"]'),
    ("traffic signals", 'node["highway"="traffic_signals"]'),
    ("crossings", 'node["highway"="crossing"]'),
    ("bus stops", 'node["highway"="bus_stop"]'),
    ("place names", 'node["place"]'),
]


def run_counts() -> list[dict]:
    q = f'[out:json][timeout:240][bbox:{bbox_overpass()}];\n' + "\n".join(f"{sel}; out count;" for _, sel in COUNT_LAYERS)
    data = overpass(q, "check-counts", max_age_days=7)
    counts = []
    for (label, sel), el in zip(COUNT_LAYERS, data["elements"]):
        counts.append({"layer": label, "selector": sel, "count": int(el["tags"].get("total", 0))})
    return counts


def candidate_query() -> str:
    b = bbox_overpass(MARGIN)
    return (f'[out:json][timeout:240];\n(\n'
            f'  nwr["name"~"{NAME_RX}",i]({b});\n'
            f'  nwr["man_made"~"^(lighthouse|flagpole)$"]({b});\n'
            f'  nwr["leisure"="stadium"]({b});\n'
            f'  nwr["building"="stadium"]({b});\n'
            f');\nout geom;\n')


def edge_distance_m(lon, lat) -> float:
    """Distance to the nearest bbox edge in metres: positive inside, negative outside."""
    from common import project
    x, z = project(lon, lat)
    x0, z0, x1, z1 = bbox_m()
    dx = min(x - x0, x1 - x)
    dz = min(z - z0, z1 - z)
    return float(min(dx, dz))


def pick(lm: Landmark, cands: list[dict]):
    if not cands:
        return None
    if lm.prefer == "node":
        nodes = [c for c in cands if c["type"] == "node"]
        if nodes:
            return nodes[0]
    if lm.prefer == "south":
        return min(cands, key=lambda c: c["lat"])
    if lm.prefer == "tallest":
        def lv(c):
            try:
                return float(c["tags"].get("building:levels", 0))
            except ValueError:
                return 0
        return max(cands, key=lambda c: (lv(c), c["area"]))
    if lm.prefer == "longest":
        return max(cands, key=lambda c: c["length"])
    return max(cands, key=lambda c: (c["area"], c["type"] == "relation"))


def main() -> int:
    log(f"bbox S{BBOX['south']} W{BBOX['west']} N{BBOX['north']} E{BBOX['east']}")
    counts = run_counts()
    data = overpass(candidate_query(), "check-landmarks", max_age_days=7)

    elements = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        geom = element_geometry(el)
        if geom is None:
            continue
        c = geom.centroid if geom.geom_type != "Point" else geom
        lon, lat = unproject(c.x, c.y)
        area = geom.area if geom.geom_type in ("Polygon", "MultiPolygon") else 0.0
        length = geom.length if geom.geom_type in ("LineString", "MultiLineString") else 0.0
        elements.append(dict(type=el["type"], id=el["id"], tags=tags, lon=lon, lat=lat,
                             area=area, length=length, geom_type=geom.geom_type, geom=geom))

    results, missing, chosen = [], [], {}
    for lm in LANDMARKS:
        cands = [e for e in elements if lm.match(e["tags"])]
        if lm.within:
            host = chosen.get(lm.within)
            cands = [e for e in cands if host is not None and host["geom"].contains(e["geom"].centroid)]
        best = pick(lm, cands)
        if best:
            chosen[lm.key] = best
        row = dict(key=lm.key, label=lm.label, required=lm.required, candidates=len(cands), found=False)
        if best:
            inside = inside_bbox(best["lon"], best["lat"])
            row.update(found=True, osm=f'{best["type"]}/{best["id"]}', name=best["tags"].get("name", ""),
                       name_ta=best["tags"].get("name:ta", ""), lat=round(best["lat"], 6), lon=round(best["lon"], 6),
                       inside=inside, edge_m=round(edge_distance_m(best["lon"], best["lat"]), 1),
                       area_m2=round(best["area"]), length_m=round(best["length"]),
                       tags={k: v for k, v in best["tags"].items() if not k.startswith("name")})
            if lm.prefer == "longest":  # roads: report total length of every matching segment inside
                row["segments"] = len(cands)
                row["total_length_m"] = round(sum(c["length"] for c in cands if inside_bbox(c["lon"], c["lat"])))
            if lm.required and not inside:
                missing.append(f"{lm.label} found at {best['lat']:.5f}, {best['lon']:.5f} but OUTSIDE the bbox")
        elif lm.required:
            missing.append(f"{lm.label} not found")
        results.append(row)

    report = dict(bbox=BBOX, counts=counts, landmarks=results, problems=missing)
    write_json(REPORTS / "osm_check.json", report)

    md = ["# OSM validation report", "",
          f"Bbox: south {BBOX['south']}, west {BBOX['west']}, north {BBOX['north']}, east {BBOX['east']}", "",
          "## Feature counts inside the bbox", "", "| Layer | Count |", "|---|---:|"]
    md += [f"| {c['layer']} | {c['count']:,} |" for c in counts]
    md += ["", "## Landmarks", "",
           "| Landmark | Required | Found | OSM | Name | Lat, lon | Inside | Edge (m) |", "|---|---|---|---|---|---|---|---:|"]
    for r in results:
        if r["found"]:
            md.append(f"| {r['label']} | {'yes' if r['required'] else 'no'} | yes | {r['osm']} | {r['name']} "
                      f"| {r['lat']:.5f}, {r['lon']:.5f} | {'yes' if r['inside'] else 'NO'} | {r['edge_m']:,.0f} |")
        else:
            md.append(f"| {r['label']} | {'yes' if r['required'] else 'no'} | NO | | | | | |")
    md += ["", "Edge (m) is the distance to the nearest bbox edge; negative means outside.", ""]
    md += ["## Problems", ""] + ([f"- {p}" for p in missing] or ["- none"])
    (REPORTS / "osm_check.md").write_text("\n".join(md) + "\n")

    for r in results:
        flag = "ok " if r["found"] and r.get("inside") else ("-- " if not r["required"] else "XX ")
        where = f"{r.get('osm','')} {r.get('name','')} edge {r.get('edge_m','?')} m" if r["found"] else "not found"
        log(f"{flag}{r['key']:18s} {where}")
    if missing:
        log("PROBLEMS:\n  " + "\n  ".join(missing))
        return 1
    log("all required landmarks found inside the bbox")
    return 0


if __name__ == "__main__":
    sys.exit(main())
