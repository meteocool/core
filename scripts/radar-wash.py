"""Regenerate the no-radar wash's hole (`radarCoverageInv` in src/layers/extents.ts).

The hole is every network's reach, unioned: each site's geodesic circle as
meteocool/ng's `src/coverage.py` draws it (`coverage.reach`, at
`openradar.reach_m`, DWD's at its 150 km outline), so the wash and the
exclusive coverages in `spec/coverage.json` are drawn from the same circles.
Run it with ng's worker-analysis on the path, from that directory:

    cd ../ng/services/worker-analysis
    PYTHONPATH=. uv run python ../../../core/scripts/radar-wash.py ../../../core/src/layers/extents.ts

It rewrites the ring in place and prints what changed.
"""

import re
import sys
from pathlib import Path

from shapely.geometry import Polygon
from shapely.ops import unary_union

from src import coverage, openradar

START = "radarCoverageInv.appendLinearRing(\n  new LinearRing([\n"
END = "  ]),\n);"


def hole() -> Polygon:
    """Every network's circles as one polygon, simplified as the coverage document is."""
    reaches = [
        coverage.reach(network, coverage.DWD_OUTLINE_M if network is openradar.GERMANY else None)
        for network in openradar.NETWORKS.values()
    ]
    union = unary_union(reaches).simplify(coverage.SIMPLIFY_M, preserve_topology=True)
    # One ring: an island of no radar inside the union would need a ring of its own.
    if union.geom_type != "Polygon" or union.interiors:
        message = f"the networks' reach is a {union.geom_type} with holes, not one ring"
        raise ValueError(message)
    return union


def main() -> None:
    path = Path(sys.argv[1])
    text = path.read_text()
    start = text.index(START) + len(START)
    end = text.index(END, start)
    old = Polygon([(float(x), float(y)) for x, y in re.findall(r"\[(-?[\d.]+), (-?[\d.]+)\]", text[start:end])])
    new = hole()
    lines = "".join(
        f"    [{x:.6f}, {y:.6f}],\n" for x, y in ((round(x, 1), round(y, 1)) for x, y in new.exterior.coords)
    )
    path.write_text(text[:start] + lines + text[end:])
    print(f"{len(new.exterior.coords)} points; {old.symmetric_difference(new).area / 1e6:.0f} km2 (EPSG:3857) changed")


if __name__ == "__main__":
    main()
