"""Generate spec/coverage.json under "the nearest radar wins outside every border".

meteocool/ng generates the coverage document (its worker-analysis
`src/coverage.py`, ADR 0015) under a priority rule: outside every border the
first network by priority that reaches wins. This builds it under the rule
ng's handoff for Belgium and Slovakia recommends instead, from ng's own sites,
countries and helpers, until ng adopts it and the document can be copied from
there again. Run it with ng's worker-analysis on the path, from that
directory:

    cd ../ng/services/worker-analysis
    PYTHONPATH=. uv run python ../../../core/scripts/coverage-nearest.py --out ../../../core/spec/coverage.json

**The rule.**

1. Inside a network's own borders only that network draws, wherever it
   reaches -- unchanged.
2. Outside every network's borders, the nearest radar that reaches wins,
   whatever network it is. DWD's sites reach `DWD_OUTLINE_M` for this, as
   for the priority rule.

A site's ground outside the borders is its reach less every other site's
reach on the side of their bisector nearer that other site. Bisectors are
great circles, which are straight lines in a gnomonic projection, so the
cells are cut there and carried to EPSG:3857 densified to `DENSIFY_M`.

A network's `exclusive` is its own country within its reach, plus its sites'
cells outside every border. Its `dwd_hole` is all of that and its country
where DWD's sweeps reach: DWD's tiles now give way to a nearer radar outside
the borders too, not only inside them. DWD's own cells are DWD's, as all of
Germany is. `priority` is kept, and still orders the subtraction that keeps
two simplified coverages from overlapping; it no longer decides who wins.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import shapely
from pyproj import Geod, Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union

from src import coverage, openradar

logger = logging.getLogger(__name__)

# The gnomonic projection the bisectors are straight in: centred on the
# networks, on a sphere so that great circles are exactly lines.
GNOMONIC = "+proj=gnom +lat_0=50 +lon_0=12 +R=6371008.8 +units=m +no_defs"
# Points along each cell's edges when it is carried to EPSG:3857: a straight
# gnomonic line bends there, and two kilometres keeps it within a metre.
DENSIFY_M = 2_000.0
# Half the side of the square a bisector's half-plane is cut from, in gnomonic
# metres: far beyond any site's reach.
HALF_PLANE_M = 5_000_000.0

_GEOD = Geod(ellps="WGS84")
_TO_GNOMONIC = Transformer.from_crs(4326, GNOMONIC, always_xy=True)
_GNOMONIC_TO_MERCATOR = Transformer.from_crs(GNOMONIC, 3857, always_xy=True)


def _unit(lon: float, lat: float) -> np.ndarray:
    lam, phi = np.radians(lon), np.radians(lat)
    return np.array([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)])


def _lonlat(vector: np.ndarray) -> tuple[float, float]:
    x, y, z = vector / np.linalg.norm(vector)
    return float(np.degrees(np.arctan2(y, x))), float(np.degrees(np.arcsin(z)))


def gnomonic_circle(site: openradar.Site, radius_m: float) -> Polygon:
    """A site's reach as `coverage.circle` draws it, in the gnomonic projection."""
    bearings = np.linspace(0.0, 360.0, coverage.CIRCLE_POINTS, endpoint=False)
    count = len(bearings)
    lons, lats, _ = _GEOD.fwd([site.lon] * count, [site.lat] * count, bearings, [radius_m] * count)
    xs, ys = _TO_GNOMONIC.transform(lons, lats)
    return Polygon(zip(xs, ys, strict=True))


def nearer(to: openradar.Site, than: openradar.Site) -> Polygon:
    """Where `to` is nearer than `than`: the gnomonic half-plane on `to`'s side of their bisector."""
    a, b = _unit(to.lon, to.lat), _unit(than.lon, than.lat)
    normal = (a - b) / np.linalg.norm(a - b)
    middle = (a + b) / np.linalg.norm(a + b)
    along = np.cross(normal, middle)
    p = np.array(_TO_GNOMONIC.transform(*_lonlat(middle + 0.05 * along)))
    q = np.array(_TO_GNOMONIC.transform(*_lonlat(middle - 0.05 * along)))
    direction = (q - p) / np.linalg.norm(q - p)
    side = np.array([-direction[1], direction[0]])
    towards = np.array(_TO_GNOMONIC.transform(to.lon, to.lat))
    if np.dot(towards - p, side) < 0:
        side = -side
    far = HALF_PLANE_M
    return Polygon(
        [p - far * direction, p + far * direction, p + far * direction + far * side, p - far * direction + far * side]
    )


def reach_m(site: openradar.Site) -> float:
    """How far a site reaches for this rule: DWD's to its outline, the rest to their own reach."""
    return coverage.DWD_OUTLINE_M if openradar.network_of(site) is openradar.GERMANY else openradar.reach_m(site)


def cells() -> dict[str, Any]:
    """Each network's ground where one of its radars is the nearest that reaches, in EPSG:3857."""
    sites = [site for network in openradar.NETWORKS.values() for site in network.sites.values()]
    disks = {site.name: gnomonic_circle(site, reach_m(site)) for site in sites}
    found: dict[str, list[Any]] = {code: [] for code in openradar.NETWORKS}
    for site in sites:
        taken = [
            disks[other.name].intersection(nearer(other, site))
            for other in sites
            if other.name != site.name and disks[other.name].intersects(disks[site.name])
        ]
        cell = disks[site.name].difference(unary_union(taken)) if taken else disks[site.name]
        found[openradar.network_of(site).code].append(cell)
    merged: dict[str, Any] = {}
    for code, parts in found.items():
        gnomonic = shapely.segmentize(unary_union(parts).buffer(0), DENSIFY_M)
        mercator = shapely.transform(
            gnomonic, lambda points: np.column_stack(_GNOMONIC_TO_MERCATOR.transform(points[:, 0], points[:, 1]))
        )
        # Cutting a hundred circles leaves a few self-touching rings; buffering by nothing mends them.
        merged[code] = mercator.buffer(0)
    return merged


def tidy(geometry: Any) -> Any:
    """A coverage without what cutting it left: slivers, specks of hole, and vertices off the 0.1 m grid it is written on.

    Every part and hole under `coverage.SLIVER_M2` goes, as `coverage.rings`
    drops such parts anyway; a hole that small is a gap at a seam, not another
    network's ground, which is never that small once tidied itself. Snapping
    to the grid here rather than rounding the rings keeps them simple.
    """
    parts = [
        Polygon(part.exterior, [ring for ring in part.interiors if Polygon(ring).area >= coverage.SLIVER_M2])
        for part in coverage._polygons(shapely.make_valid(geometry))
        if part.area >= coverage.SLIVER_M2
    ]
    return shapely.set_precision(unary_union(parts), 0.1) if parts else Polygon()


def build(outlines: dict[str, Any], priority: tuple[str, ...] = coverage.PRIORITY) -> dict[str, Any]:
    """The coverage document under the nearest-radar rule."""
    networks = [openradar.NETWORKS[code] for code in priority]
    dwd = openradar.GERMANY
    own = {network.code: outlines[coverage.country_of(network)] for network in networks}
    borders = unary_union(list(own.values()))
    dwd_sweeps = coverage.reach(dwd, dwd.site_range_m)
    nearest = cells()
    emitted = Polygon()
    domains: dict[str, Any] = {}
    for network in networks:
        if network is dwd:
            continue
        reached = coverage.reach(network)
        exclusive = own[network.code].intersection(reached).union(nearest[network.code].difference(borders))
        exclusive = tidy(tidy(exclusive.simplify(coverage.SIMPLIFY_M, preserve_topology=True)).difference(emitted))
        emitted = emitted.union(exclusive)
        hole = tidy(own[network.code].union(exclusive).intersection(dwd_sweeps).simplify(coverage.SIMPLIFY_M))
        domains[network.code] = {"exclusive": coverage.rings(exclusive), "dwd_hole": coverage.rings(hole)}
    return {"crs": coverage.CRS, "priority": list(priority), "domains": domains}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, default=Path.home() / ".cache" / "meteocool-natural-earth")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    document = build(coverage.countries(args.cache_dir))
    for code, shapes in document["domains"].items():
        logger.info("%s: %d exclusive rings, %d hole rings", code, len(shapes["exclusive"]), len(shapes["dwd_hole"]))
    args.out.write_text(json.dumps(document, separators=(",", ":")))
    logger.info("exclusive coverages overlap by %.1f m2", coverage.overlap_m2(document))


if __name__ == "__main__":
    main()
