"""
Make the engines' fans parts that spin.

    python engine_fans.py <a320.bin> [<out.bin>]

Needs `numpy`. `convert-aircraft.py` runs it on what it has written; run by
hand, it works on the model as it is checked in (public/models/a320).

The model has each fan as meshes of the engine: eighteen blades, each a
shell of its own, and the spinner in front of them, all on the engines'
texture, which the converter draws in one piece with the cowl. Here they
are found again by where they are: the shells that lie wholly in the
intake, just behind its lip and inside the blades' tips (`FAN`). The one
that reaches the engine's axis is the spinner; the rest are the blades.
Each engine's blades become a part, and its spinner another, both turning
about the engine's axis, worked out from the blades' own reach (see
`lib/studio/flight/model.ts`, which reads this).

Both are driven by `fans`: how far the fans have turned, degrees, round and
round. The blades say how many there are (`blades`), so that a fan turned
by one blade's share of the round is seen as it was: what the renderer
smears a fast fan over. The spinner says none: it is round, and only its
markings show it turning.

A model whose fans are parts already is left as it is.
"""
import sys
from pathlib import Path

import numpy as np

from control_surfaces import VERTEX, joined, packed, read, write

FAN = {"forward": (4.5, 5.3), "starts": 4.6, "centre": (5.63, 2.11), "radius": 1.0, "hub": 0.05}
"""
Where a fan is, metres: between the intake's lip and the vanes behind the
blades, a shell of it starting behind `starts` (what is fixed to the
intake's wall ahead of the blades does not); round `centre` (each engine's
axis, right of the middle on the right and left of it on the left, and
down), within `radius` of it; and the spinner the shell that comes within
`hub` of the axis.
"""

SIDES = {"left": -1, "right": 1}


def cut(data: bytes, report=print) -> bytes:
    """A model's file with its fans' blades and spinners taken out of the engines as parts; as it was, where they are already."""
    header, body = read(data)
    parts = dict(header.get("parts") or {})
    if any(name.startswith("fan.") for name in parts):
        report("engine fans: parts already")
        return data

    chunks = []
    found = {side: {"blades": [], "spinner": []} for side in SIDES}
    reach = {side: [] for side in SIDES}
    for chunk in header["chunks"]:
        vertices = np.frombuffer(body, VERTEX, chunk["vertices"], chunk["offset"])
        corners = np.frombuffer(body, "<u2", chunk["indices"], chunk["offset"] + chunk["vertices"] * VERTEX.itemsize).reshape(-1, 3)
        kept = {key: value for key, value in chunk.items() if key not in ("vertices", "indices", "offset")}
        if chunk.get("part"):
            chunks.append((kept, vertices, corners))
            continue
        position = vertices["p"][:, :3] / 65535 * np.array(chunk["size"]) + np.array(chunk["min"])
        mine = np.zeros(len(corners), bool)
        shell = None
        for side, sign in SIDES.items():
            radial = np.hypot(position[:, 1] - sign * FAN["centre"][0], position[:, 2] - FAN["centre"][1])
            near = (position[:, 0] > FAN["forward"][0]) & (position[:, 0] < FAN["forward"][1]) & (radial < FAN["radius"])
            inside = near[corners].all(1)
            if not inside.any():
                continue
            if shell is None:
                _, welded = np.unique(vertices["p"][:, :3], axis=0, return_inverse=True)
                shell = joined(welded.ravel()[corners])
            partly = np.unique(shell[~inside])
            for one in np.unique(shell[inside & ~np.isin(shell, partly)]):
                these = shell == one
                used = np.unique(corners[these])
                if position[used, 0].min() > FAN["starts"]:
                    continue
                kind = "spinner" if radial[used].min() < FAN["hub"] else "blades"
                found[side][kind].append((kept, vertices, corners[these]))
                if kind == "blades":
                    reach[side].append(position[used])
                mine |= these
        if mine.any():
            used, renumbered = np.unique(corners[~mine], return_inverse=True)
            vertices, corners = vertices[used], renumbered.reshape(-1, 3)
        chunks.append((kept, vertices, corners))

    for side in SIDES:
        blades, spinner = found[side]["blades"], found[side]["spinner"]
        if not blades or len(spinner) != 1:
            raise ValueError(f"{side} engine: {len(blades)} blades and {len(spinner)} spinners where its fan should be")
        points = np.concatenate(reach[side])
        # The axis through the middle of the round the blades' tips sweep, fore and aft.
        middle = (points.min(0) + points.max(0)) / 2
        pivot = [round(float(points[:, 0].min()), 4), round(float(middle[1]), 4), round(float(middle[2]), 4)]
        # As a CFM56's: clockwise seen from behind, the right-handed way about the axis forward.
        turning = {"pivot": pivot, "axis": [1.0, 0.0, 0.0], "keys": [[0.0, 0.0], [360.0, 360.0]], "drive": "fans"}
        parts[f"fan.{side}"] = {**turning, "blades": len(blades)}
        parts[f"spinner.{side}"] = turning
        for part, pieces in ((f"fan.{side}", blades), (f"spinner.{side}", spinner)):
            # One chunk for each of the model's chunks they were in: all the blades of a fan together.
            by_chunk = {}
            for kept, vertices, corners in pieces:
                by_chunk.setdefault(id(vertices), (kept, vertices, []))[2].append(corners)
            for kept, vertices, corners in by_chunk.values():
                chunks.append(packed(kept, vertices, np.concatenate(corners), part))
        report(f"fan.{side}: {len(blades)} blades, spinner, turning about {pivot} fore and aft")

    return write({**header, "parts": parts}, chunks)


def cut_file(source: str, out: str | None = None) -> None:
    path = Path(source)
    before = path.read_bytes()
    after = cut(before)
    if after is not before or out:
        Path(out or source).write_bytes(after)


if __name__ == "__main__":
    cut_file(*sys.argv[1:3])
