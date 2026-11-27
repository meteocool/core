"""
Make the main gear's side stays parts of their own, which fold as the leg
comes up instead of turning with it.

    python gear_stays.py <a320.bin> [<out.bin>]

Needs `numpy`. `convert-aircraft.py` runs it on what it has written; run by
hand, it works on the model as it is checked in (public/models/a320).

The model's rig holds all of each main leg's side stay under the leg: the
upper link from the wing to the knee, the lower one from the knee to the
leg, and the lock link beside them. So all of it turned with the leg as the
gear went up, and stood up through the top of the wing. Here it is taken
out of the leg's part, a shell at a time (triangles that share edges), as
parts of their own:

- the upper link (`gear.leftStay`): the leg's shells wholly in its box
  (`UPPER`). It turns on its end on the wing, up into the wing.
- the links on the leg (`gear.leftLink1`, ...): what else of the leg reaches
  inboard of it, above its wheels (`LINKS`). Each rides on the leg and
  turns on its end at the leg until it lies along it, so it folds up with
  the leg into its well.

Each folds in step with the leg's keys. A real stay folds at its knee and
stays joined; these fold whole, and part at the knee while the leg swings.

A model whose stays are parts already is left as it is.
"""
import sys
from pathlib import Path

import numpy as np

from control_surfaces import VERTEX, joined, packed, read, write

UPPER = {"ahead_of": 0.15, "inboard_of": 3.6, "above": 1.75}
"""
The left upper link's box, metres in the aircraft's frame (forward, right,
down), measured on the model; the right one's is its mirror. A shell of the
leg is the upper link's where all its points are ahead of `ahead_of` and
above `above`, and its points are on average inboard of `inboard_of`. The
leg's own torque link reaches behind, and its strut below.
"""
UPPER_FOLD_DEG = 55.0
"""How far the left upper link turns up about its end on the wing with the gear up (the right one the other way): clear of the wing's top, over the leg's door."""
LINKS = {"inboard_of": 3.55, "above": 2.6}
"""A shell of the leg is a link on it where some of it is inboard of `inboard_of` and all of it above `above`: the wheels are below."""
END_M = 0.06
"""A link's end, where its hinge is: its points this close to its outermost (the upper link's to its innermost, on the wing)."""

LEGS = {"gear.left": -1, "gear.right": 1}


def points_of(chunk: dict, vertices: np.ndarray, corners: np.ndarray) -> np.ndarray:
    """The places of the vertices some triangles use, metres."""
    return (vertices["p"][:, :3] / 65535 * np.array(chunk["size"]) + np.array(chunk["min"]))[np.unique(corners)]


def fold(data: bytes, report=print) -> bytes:
    """A model's file with the main gear's side stays taken out of the legs as parts; as it was, where they are already."""
    header, body = read(data)
    parts = dict(header.get("parts") or {})
    wanted = {leg: side for leg, side in LEGS.items() if leg in parts and f"{leg}Stay" not in parts}
    if not wanted:
        report("gear stays: parts already")
        return data

    chunks = []
    # For each leg, its shells taken out: what of the stay each is ("upper" or "link"), and its triangles.
    taken = {leg: [] for leg in wanted}
    for chunk in header["chunks"]:
        vertices = np.frombuffer(body, VERTEX, chunk["vertices"], chunk["offset"])
        corners = np.frombuffer(body, "<u2", chunk["indices"], chunk["offset"] + chunk["vertices"] * VERTEX.itemsize).reshape(-1, 3)
        kept = {key: value for key, value in chunk.items() if key not in ("vertices", "indices", "offset")}
        leg = chunk.get("part")
        if leg not in wanted:
            chunks.append((kept, vertices, corners))
            continue
        side = wanted[leg]
        position = vertices["p"][:, :3] / 65535 * np.array(chunk["size"]) + np.array(chunk["min"])
        _, welded = np.unique(vertices["p"][:, :3], axis=0, return_inverse=True)
        shell = joined(welded.ravel()[corners])
        mine = np.zeros(len(corners), bool)
        for one in np.unique(shell):
            triangles = shell == one
            points = position[np.unique(corners[triangles])]
            out = side * points[:, 1]  # metres out from the middle, either side
            if points[:, 0].min() > UPPER["ahead_of"] and points[:, 2].max() < UPPER["above"] and out.mean() < UPPER["inboard_of"]:
                taken[leg].append(("upper", kept, vertices, corners[triangles]))
            elif out.min() < LINKS["inboard_of"] and points[:, 2].max() < LINKS["above"]:
                taken[leg].append(("link", kept, vertices, corners[triangles]))
            else:
                continue
            mine |= triangles
        if mine.any():
            used, renumbered = np.unique(corners[~mine], return_inverse=True)
            vertices, corners = vertices[used], renumbered.reshape(-1, 3)
        chunks.append((kept, vertices, corners))

    for leg, side in wanted.items():
        upper = [shell for shell in taken[leg] if shell[0] == "upper"]
        links = sorted((shell for shell in taken[leg] if shell[0] == "link"), key=lambda shell: -len(shell[3]))
        if not upper:
            raise ValueError(f"{leg}: no side stay where it should be")
        leg_keys = parts[leg]["keys"]
        up = leg_keys[0][1]

        def hinged(name: str, pivot: np.ndarray, folded: float, parent: str | None, pieces: list) -> None:
            # In step with the leg: folded as far as it is up, and straight where it is down.
            parts[name] = {
                "pivot": [round(float(v), 4) for v in pivot], "axis": [1, 0, 0],
                "keys": [[at, round(folded * angle / up, 3) + 0.0] for at, angle in leg_keys],
                **({"parent": parent} if parent else {}),
            }
            for _, chunk, vertices, corners in pieces:
                chunks.append(packed(chunk, vertices, corners, name))
            report(f"{name}: {sum(len(corners) for *_, corners in pieces)} triangles, hinge through {parts[name]['pivot']}, "
                   f"{folded:+.0f}° with the gear up")

        points = np.concatenate([points_of(*shell[1:]) for shell in upper])
        out = side * points[:, 1]
        hinged(f"{leg}Stay", points[out < out.min() + END_M].mean(0), -side * UPPER_FOLD_DEG, None, upper)

        for number, link in enumerate(links, 1):
            points = points_of(*link[1:])
            out = side * points[:, 1]
            pivot = points[out > out.max() - END_M].mean(0)
            far = points[out < out.min() + END_M].mean(0)
            # Turned about the hinge the shorter way until it lies along the leg as the model has it down: its far end straight above or below.
            along = np.degrees(np.arctan2(far[2] - pivot[2], far[1] - pivot[1]))
            folded = min(((target - along + 180.0) % 360.0 - 180.0 for target in (-90.0, 90.0)), key=abs)
            hinged(f"{leg}Link{number}", pivot, folded, leg, [link])

    return write({**header, "parts": parts}, chunks)


def fold_file(source: str, out: str | None = None) -> None:
    path = Path(source)
    before = path.read_bytes()
    after = fold(before)
    if after is not before or out:
        Path(out or source).write_bytes(after)


if __name__ == "__main__":
    fold_file(*sys.argv[1:3])
