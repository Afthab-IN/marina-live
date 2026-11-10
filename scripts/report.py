"""Compose reports/validation.md from osm_check.json and build.json.

    .venv/bin/python scripts/report.py
"""
from __future__ import annotations

import json
from datetime import date

from common import BBOX, REPORTS


def pct(n, total):
    return f"{100 * n / total:.0f}%" if total else "0%"


def main():
    check = json.loads((REPORTS / "osm_check.json").read_text())
    build = json.loads((REPORTS / "build.json").read_text())
    c = build["counts"]
    total_b = c["buildings"]
    lines = [
        "# Marina, Live: data validation report", "",
        f"Generated {date.today().isoformat()} by `scripts/report.py`.", "",
        "## Area", "",
        f"Bbox: south {BBOX['south']}, west {BBOX['west']}, north {BBOX['north']}, east {BBOX['east']} "
        "(about 6.2 x 3.7 km). The brief's box was 13.040 to 13.090 N and 80.262 to 80.292 E. The south edge moved to "
        "13.034 because the Marina lighthouse (OSM way 211436935) sits at 13.03974 N, and the east edge moved to 80.296 "
        "so open sea runs along the whole coast.", "",
        "## Sources and reachability", "",
        "| Source | URL | Result |", "|---|---|---|",
        "| OpenStreetMap via Overpass | https://overpass-api.de/api/interpreter (plus lz4. and z. aliases) | OK. Needs a User-Agent header (plain requests get 406); busy periods answer 502/504, handled by retries |",
        "| Overture Maps buildings | s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings | OK, read with DuckDB bbox filter |",
        "| Google Open Buildings 2.5D Temporal (2023) | https://storage.googleapis.com/open-buildings-temporal-data/v1/ | OK. Two 1.4 to 1.6 GB tiles cover the box; only our window was range-read from the 2 m overview |",
        "| Mapzen Terrain Tiles (Terrarium) | https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/ | OK, 12 tiles |", "",
        "No source was blocked.", "",
        "## OSM feature counts inside the bbox", "", "| Layer | Count |", "|---|---:|",
    ]
    lines += [f"| {r['layer']} | {r['count']:,} |" for r in check["counts"]]
    lines += ["", "## Landmarks", "", "| Landmark | Found | OSM | Name in OSM | Inside | Edge (m) |", "|---|---|---|---|---|---:|"]
    for r in check["landmarks"]:
        if r["found"]:
            lines.append(f"| {r['label']} | yes | {r['osm']} | {r['name']} | {'yes' if r['inside'] else 'NO'} | {r['edge_m']:,.0f} |")
        else:
            lines.append(f"| {r['label']} | no | | | | |")
    lines += ["", "Edge is the distance to the nearest bbox edge.", "",
              "Notes:",
              "- Chennai Central: OSM maps the platform roofs but not the red heritage building. Its footprint (190 x 28 m along the frontage roof, way 214739119) is illustrated.",
              "- Madras High Court and Presidency College are campus polygons in OSM. Their models replace only the main blocks (ways 369960494 and 31900265).",
              "- The Fort St George flagstaff is not mapped. The fort walls are (13 `city_wall` ways).", ""]
    hs = c["heights"]
    lines += ["## Build", "",
              f"**Buildings: {total_b:,}**", "",
              "| Footprint source | Buildings |", "|---|---:|"]
    lines += [f"| {k} | {v:,} ({pct(v, total_b)}) |" for k, v in sorted(c["buildings_by_footprint"].items(), key=lambda kv: -kv[1])]
    lines += ["", "| Height source | Buildings |", "|---|---:|"]
    lines += [f"| {k} | {v:,} ({pct(v, total_b)}) |" for k, v in sorted(hs.items(), key=lambda kv: -kv[1])]
    cmp = build["heights"].get("osm_levels_vs_google")
    if cmp:
        lines += ["", f"Where a building has both an OSM level count and a Google 2.5D height ({cmp['n']:,} buildings), "
                      f"they differ by {cmp['mean_abs_diff_m']} m on average and Google reads {cmp['median_ratio']:.2f} times "
                      "the OSM value at the median. Estimates use the median measured height within 70 m, clamped by building type."]
    ov = build["overture"]
    lines += ["", f"Overture ML footprints kept: Google {ov.get('kept_Google Open Buildings', 0):,}, Microsoft "
                  f"{ov.get('kept_Microsoft ML Buildings', 0):,}. Dropped: {ov.get('overlaps_osm', 0)} overlapping OSM, "
                  f"{ov.get('on_water_sand_pitch_road', 0)} on water, sand, pitches or roads, {ov.get('too_small', 0)} under 10 m2.", "",
              "| Layer | Mapped | Illustrated |", "|---|---:|---:|",
              f"| Trees | {c['trees_mapped']:,} | {c['trees_illustrated']:,} |",
              f"| Street lamps | {c['lamps_mapped']:,} | {c['lamps_illustrated']:,} |", "",
              f"Roads: {c['road_km']} km. Rail: {c['rail_km']} km. Traffic paths: {c['traffic_paths']}. "
              f"Landmarks with hand models: {c['landmarks']}.", "",
              "Trains (illustrated, on mapped track):"]
    scene = json.loads((REPORTS.parent / "public" / "data" / "scene.json").read_text())
    for t in scene["trains"]:
        lines.append(f"- {t['name']}: {t['length']/1000:.1f} km, stops: {', '.join(s['name'] for s in t['stops']) or 'none'}")
    sz = build["sizes"]
    lines += ["", "## Output size", "", "| File | Size |", "|---|---:|",
              f"| public/data/world.pack (gzip) | {sz['world_pack_gz']/1e6:.2f} MB ({sz['world_pack_raw']/1e6:.2f} MB unpacked) |",
              f"| public/data/scene.json | {sz['scene_json']/1e3:.0f} kB ({sz['scene_json_gz']/1e3:.0f} kB gzip) |", "",
              "## Preview", "", "Building colours show the height source (dark red OSM tag, orange OSM levels, blue Google 2.5D, grey estimated).", "",
              "![preview](preview.png)", ""]
    (REPORTS / "validation.md").write_text("\n".join(lines))
    print("wrote reports/validation.md")


if __name__ == "__main__":
    main()
