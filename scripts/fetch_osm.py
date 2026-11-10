"""Full OSM extract for the corridor, cached at raw/overpass/osm-full-*.json.

    .venv/bin/python scripts/fetch_osm.py

Relations are limited to area types on purpose: train route relations and the
Bay of Bengal multipolygon would drag in members from all over India.
"""
from __future__ import annotations

from common import bbox_overpass, log, overpass

MARGIN = 0.003  # about 300 m, so features crossing the edges come in whole

QUERY = f"""[out:json][timeout:900][maxsize:1073741824][bbox:{bbox_overpass(MARGIN)}];
(
  way["building"]; relation["building"]; way["building:part"];
  way["highway"]; node["highway"]; way["area:highway"];
  way["railway"]; node["railway"]; way["public_transport"]; node["public_transport"];
  way["natural"]; node["natural"="tree"];
  relation["natural"~"^(water|beach|sand|wood|scrub|grassland|wetland|bare_rock)$"];
  way["leisure"]; relation["leisure"];
  way["landuse"]; relation["landuse"];
  way["amenity"]; relation["amenity"];
  way["waterway"]; relation["waterway"="riverbank"]; way["water"]; relation["water"];
  way["man_made"]; node["man_made"];
  way["barrier"];
  way["bridge"]; way["historic"]; relation["historic"]; node["historic"];
  way["tourism"]; relation["tourism"]; node["tourism"];
  way["military"]; relation["military"];
  node["place"];
  node["power"="tower"]; way["power"="line"];
);
out body;
>;
out skel qt;
"""


# The coastline from a wider box, so it closes around Chennai Port instead of
# stopping at the frame margin.
COAST_QUERY = """[out:json][timeout:180];
way["natural"="coastline"](12.99,80.22,13.16,80.36);
out geom;
"""


def main():
    coast = overpass(COAST_QUERY, "coastline", max_age_days=120)
    log(f"coastline: {len(coast['elements'])} ways")
    data = overpass(QUERY, "osm-full", max_age_days=60, timeout=960)
    kinds = {}
    for el in data["elements"]:
        kinds[el["type"]] = kinds.get(el["type"], 0) + 1
    log(f"osm-full: {kinds}")


if __name__ == "__main__":
    main()
