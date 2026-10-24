"""Regenerate the no-radar wash's holes (`radarCoverageInv` in src/layers/extents.ts).

The holes are every network's reach, unioned: each site's geodesic circle as
the backend's coverage document draws it (DWD's at its 150 km outline) and
simplified the same way, so the wash and the exclusive coverages in
`spec/coverage.json` are drawn from the same circles. Run it with the
backend's sources importable, passing the path of src/layers/extents.ts.

The union is several parts that touch nowhere (the continent, and Ireland,
whose radars reach no other network's), and a part may have islands inside
it that no radar reaches though radars ring them. Each part is one hole in
the world, wound clockwise; each island a ring inside it, wound
anticlockwise. OpenLayers winds every ring after the world's as a hole
before it fills, so under the nonzero rule an island inside a hole counts
back to filled, which is what an island is, and disjoint holes stay open.

It rewrites the rings in place and prints what it wrote.
"""

import re
import sys
from pathlib import Path

from pyproj import Geod, Transformer
from shapely.geometry import LinearRing, MultiPolygon, Point, Polygon
from shapely.ops import transform

from src import coverage, openradar

START = 'export const radarCoverageInv = fromExtent(\n  transformExtent([-180, -90, 180, 90], "EPSG:4326", "EPSG:3857"),\n);\n'
END = "\n/**\n"

_TO_LONLAT = Transformer.from_crs(3857, 4326, always_xy=True)
_GEOD = Geod(ellps="WGS84")


def parts() -> list[Polygon]:
    """Every network's reach as its parts, the continent first."""
    reached = coverage.everywhere_reached()
    found = list(reached.geoms) if isinstance(reached, MultiPolygon) else [reached]
    return sorted(found, key=lambda part: -part.area)


def oriented(ring: LinearRing, clockwise: bool) -> list[tuple[float, float]]:
    """A ring's points, wound as asked."""
    points = list(ring.coords)
    return points if LinearRing(points).is_ccw != clockwise else points[::-1]


def km2(ring: LinearRing) -> float:
    """The ground a ring encloses, in square kilometres on the ellipsoid."""
    area, _ = _GEOD.geometry_area_perimeter(transform(_TO_LONLAT.transform, Polygon(ring)))
    return abs(area) / 1e6


def where(ring: LinearRing) -> str:
    """A ring's middle, as lat, lon."""
    lon, lat = _TO_LONLAT.transform(*Polygon(ring).representative_point().coords[0])
    return f"{lat:.2f}, {lon:.2f}"


def name(part: Polygon) -> str:
    """What a part is, for the comment above its ring."""
    ireland = [coverage.to_mercator(Point(site.lon, site.lat)) for site in openradar.IRELAND.sites.values()]
    if any(part.contains(site) for site in ireland):
        return "Ireland, whose radars reach no other network's"
    return "the continent, every network but Ireland's"


def block(points: list[tuple[float, float]], comment: str) -> str:
    lines = "".join(f"    [{x:.6f}, {y:.6f}],\n" for x, y in ((round(x, 1), round(y, 1)) for x, y in points))
    return f"// {comment}\nradarCoverageInv.appendLinearRing(\n  new LinearRing([\n{lines}  ]),\n);\n"


def main() -> None:
    path = Path(sys.argv[1])
    text = path.read_text()
    start = text.index(START) + len(START)
    end = text.index(END, start)
    old = len(re.findall(r"\[(-?[\d.]+), (-?[\d.]+)\]", text[start:end]))
    blocks = []
    for part in parts():
        blocks.append(block(oriented(part.exterior, clockwise=True), f"A hole: {name(part)}."))
        print(f"{name(part)}: {len(part.exterior.coords)} points, {len(part.interiors)} islands")
        for island in sorted(part.interiors, key=lambda ring: -Polygon(ring).area):
            where_, size = where(island), km2(island)
            blocks.append(block(oriented(island, clockwise=False), f"An island no radar reaches, about {size:,.0f} km², at {where_}."))
            print(f"  island at {where_}: {size:,.0f} km², {len(island.coords)} points")
    path.write_text(text[:start] + "".join(blocks) + text[end:])
    new = len(re.findall(r"\[(-?[\d.]+), (-?[\d.]+)\]", "".join(blocks)))
    print(f"{new} points in {len(blocks)} rings, {old} before")


if __name__ == "__main__":
    main()
