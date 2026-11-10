"""Top-down preview PNG of the built layers, for the validation report."""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from geo import polygon_parts

COVER_RGB = {
    "residential": (236, 226, 212), "commercial": (238, 218, 206), "industrial": (222, 216, 222),
    "institution": (230, 222, 196), "railway": (214, 206, 198), "construction": (214, 204, 182),
    "cemetery": (200, 214, 190), "green": (196, 218, 170), "park": (172, 206, 150), "parking": (214, 214, 214),
    "plaza": (226, 222, 214), "pitch": (150, 196, 126), "track": (196, 120, 96), "platform": (200, 196, 190),
    "sand": (240, 222, 170), "water": (120, 170, 200),
}
ROAD_RGB = [(96, 96, 104), (128, 128, 134), (156, 156, 160), (196, 190, 182), (214, 208, 198), (150, 140, 130)]
HSRC_RGB = {0: (168, 160, 150), 1: (170, 40, 40), 2: (205, 90, 60), 3: (60, 110, 170), 4: (120, 80, 160)}


def draw_preview(path, bm, land, cover, road_polys, ballast, blds, lm_geoms, trees, lamps, trains, scale=3.0):
    x0, z0, x1, z1 = bm
    W, H = int((x1 - x0) / scale), int((z1 - z0) / scale)
    img = Image.new("RGB", (W, H), (70, 120, 160))
    d = ImageDraw.Draw(img)

    def tp(c):
        c = np.asarray(c)
        return [((x - x0) / scale, (z - z0) / scale) for x, z in c[:, :2]]

    def poly(p, fill, outline=None, hole=(232, 226, 214)):
        for part in polygon_parts(p):
            d.polygon(tp(part.exterior.coords), fill=fill, outline=outline)
            for r in part.interiors:
                d.polygon(tp(r.coords), fill=hole)

    poly(land, (232, 226, 214))
    for cls, polys in cover.items():
        for p in polys:
            poly(p, COVER_RGB.get(cls, (220, 220, 220)))
    for gi, g in enumerate(["major", "minor", "service", "path"]):
        for p in road_polys.get(g, []):
            poly(p, ROAD_RGB[gi])
    for p in ballast:
        poly(p, ROAD_RGB[5])
    for b in blds:
        poly(b["geom"], HSRC_RGB.get(b["hsrc"], (150, 150, 150)))
    if len(trees):
        for x, z, kind, mapped, *_ in trees:
            px, pz = (x - x0) / scale, (z - z0) / scale
            col = (20, 90, 30) if mapped else (110, 170, 90)
            d.point((px, pz), fill=col)
    for t in trains:
        d.line(tp(t["pts"][:, [0, 2]]), fill=(150, 60, 170), width=2)
    for key, g in lm_geoms.items():
        if g.geom_type in ("Polygon", "MultiPolygon"):
            for part in polygon_parts(g):
                d.line(tp(part.exterior.coords), fill=(230, 0, 140), width=3)
            c = g.centroid
        elif g.geom_type in ("LineString",):
            d.line(tp(g.coords), fill=(230, 0, 140), width=4)
            c = g.centroid
        else:
            c = g
        d.text(((c.x - x0) / scale + 6, (c.y - z0) / scale - 6), key, fill=(120, 0, 70))
    legend = [("height: OSM tag", HSRC_RGB[1]), ("height: OSM levels", HSRC_RGB[2]),
              ("height: Google 2.5D", HSRC_RGB[3]), ("height: estimated", HSRC_RGB[0]),
              ("tree: mapped", (20, 90, 30)), ("tree: illustrated", (110, 170, 90)), ("train path", (150, 60, 170)),
              ("landmark", (230, 0, 140))]
    y = 10
    d.rectangle([8, 6, 190, 14 + 16 * len(legend)], fill=(255, 255, 255))
    for text, col in legend:
        d.rectangle([14, y + 2, 26, y + 12], fill=col)
        d.text((32, y), text, fill=(20, 20, 20))
        y += 16
    img.save(path, optimize=True)
