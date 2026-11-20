"""
Make the aircraft's ailerons, elevators and rudder parts that move.

    python control_surfaces.py <a320.bin> [<out.bin>]

Needs `numpy`. `convert-aircraft.py` runs it on what it has written; run by
hand, it works on the model as it is checked in (public/models/a320), which
is all there is of the model where its author's scene is not at hand.

The model has these surfaces as its author built them, each a shell of its
own with a rounded nose, in a slot the wing, the tailplane or the fin has a
wall behind: but as meshes of the hull, which the converter draws in one
piece with it. Here each is found again by where it is (`SURFACES`: the line
its nose runs along, measured on the model) and by what it is joined to:
the triangles of the hull that hang together edge to edge and lie wholly
behind that line, between the surface's two ends. That is the surface
itself and what is fixed to it (the static wicks on its trailing edge), and
nothing of what is round it, so no triangle has to be cut. They are taken
out of the hull's chunk into chunks of their own, each a part with a hinge
(see `lib/studio/flight/model.ts`, which reads this): through the middle of
the surface's rounded nose at either end, so the nose turns in its slot.

Each part is driven by the stick or the pedals, -1 to 1, as the flight has
their signs: `ailerons` right wing down, `elevator` nose up, `rudder` nose
right. The angles are an A320's.

A model whose surfaces are parts already is left as it is.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

VERTEX = np.dtype([("p", "<u2", 4), ("n", "i1", 4), ("uv", "<u2", 2)])

AILERON_DEG = 25.0
ELEVATOR_DEG = (30.0, 17.0)
"""Nose up, and nose down."""
RUDDER_DEG = 25.0

# Each surface: the line its nose runs along, from its inner end to its
# outer one (the rudder's: from its foot to its top), metres forward, right
# and down; which way its hinge is to point, so that all turn the same way
# for a positive angle (about a hinge pointing right, trailing edge down;
# about one pointing up, trailing edge to the right); what drives it; and
# its angle, degrees, with that at -1, 0 and 1.
SURFACES = {
    "aileron.right": {
        "nose": ((-2.93, 13.27, -0.22), (-3.98, 16.29, -0.51)), "towards": (0, 1, 0),
        "drive": "ailerons", "keys": (AILERON_DEG, 0.0, -AILERON_DEG),
    },
    "aileron.left": {
        "nose": ((-2.93, -13.27, -0.22), (-3.98, -16.29, -0.51)), "towards": (0, 1, 0),
        "drive": "ailerons", "keys": (-AILERON_DEG, 0.0, AILERON_DEG),
    },
    "elevator.right": {
        "nose": ((-17.04, 0.92, -0.87), (-18.92, 6.23, -1.68)), "towards": (0, 1, 0),
        "drive": "elevator", "keys": (ELEVATOR_DEG[1], 0.0, -ELEVATOR_DEG[0]),
    },
    "elevator.left": {
        "nose": ((-17.04, -0.92, -0.87), (-18.92, -6.23, -1.68)), "towards": (0, 1, 0),
        "drive": "elevator", "keys": (ELEVATOR_DEG[1], 0.0, -ELEVATOR_DEG[0]),
    },
    "rudder": {
        "nose": ((-16.35, 0.0, -2.16), (-18.78, 0.0, -7.96)), "towards": (0, 0, -1),
        "drive": "rudder", "keys": (-RUDDER_DEG, 0.0, RUDDER_DEG),
    },
}

REACH = {"ahead": 0.1, "behind": 2.6, "before": 0.15, "beyond": 0.45, "off": 0.5}
"""
How far from its nose's line a surface may reach, metres: ahead of it (its
nose is the line, as near as that was measured), behind it (the longest
chord, and a wick's length), before the line's start and beyond its end
(the surfaces are swept back, so a trailing corner is further along the
nose's line than the nose's own end), and off the surface's own plane (its
thickness).
"""
END = 0.12
"""How much of a surface's length counts as one of its ends."""
NOSE = 0.2
"""How far back from its foremost point a surface has reached its full thickness, metres."""


def read(data: bytes) -> tuple:
    """A model's header, and its chunks' bytes."""
    if data[:4] != b"MCM1":
        raise ValueError("not an aircraft model")
    length = struct.unpack("<I", data[4:8])[0]
    return json.loads(data[8:8 + length]), data[8 + length:]


def write(header: dict, chunks: list) -> bytes:
    """A model's file: `chunks` are each its header, its vertices (`VERTEX`) and its triangles' corners."""
    body = bytearray()
    listed = []
    for chunk, vertices, corners in chunks:
        listed.append({**chunk, "vertices": len(vertices), "indices": int(corners.size), "offset": len(body)})
        body.extend(vertices.tobytes())
        body.extend(corners.astype("<u2").tobytes())
        body.extend(b"\0" * (-len(body) % 4))
    packed = json.dumps({**header, "chunks": listed}, separators=(",", ":")).encode()
    packed += b" " * (-len(packed) % 4)
    return b"MCM1" + struct.pack("<I", len(packed)) + packed + bytes(body)


def frame(spec: dict) -> tuple:
    """A surface's own axes, unit vectors: along its nose, back from it towards its trailing edge, and off its plane."""
    start, end = (np.asarray(point, float) for point in spec["nose"])
    along = (end - start) / np.linalg.norm(end - start)
    # A wing's surface lies across the aircraft and a fin's stands up: off its plane is down, or to the side.
    off = np.array([0.0, 1.0, 0.0]) if spec["towards"][2] else np.array([0.0, 0.0, 1.0])
    back = np.cross(along, off)
    back = back / np.linalg.norm(back) * -np.sign(back[0])
    return along, back, np.cross(along, back)


def joined(corners: np.ndarray) -> np.ndarray:
    """For each triangle (three welded vertices), which of the shells it belongs to: triangles that share an edge are of one shell."""
    shell = np.arange(len(corners))

    def root(of: int) -> int:
        while shell[of] != of:
            shell[of] = shell[shell[of]]
            of = shell[of]
        return of

    first = {}
    for number, triangle in enumerate(corners.tolist()):
        for a, b in ((triangle[0], triangle[1]), (triangle[1], triangle[2]), (triangle[2], triangle[0])):
            edge = (a, b) if a < b else (b, a)
            other = first.setdefault(edge, number)
            if other != number:
                shell[root(number)] = root(other)
    return np.array([root(number) for number in range(len(corners))])


def hinge(points: np.ndarray, spec: dict) -> tuple:
    """
    The line a surface turns about, from its own points: a point on it and
    its direction. Through the middle of its rounded nose at each end:
    halfway between its two faces, and half its thickness behind its
    foremost point there.
    """
    start = np.asarray(spec["nose"][0], float)
    axes = np.array(frame(spec))
    place = (points - start) @ axes.T
    length = np.ptp(place[:, 0])
    ends = []
    for at in (place[:, 0].min(), place[:, 0].max()):
        end = place[np.abs(place[:, 0] - at) < END * length]
        nose = end[end[:, 1] < end[:, 1].min() + NOSE]
        thick = np.ptp(nose[:, 2])
        middle = np.array([nose[:, 0].mean(), end[:, 1].min() + thick / 2, nose[:, 2].min() + thick / 2])
        ends.append(start + middle @ axes)
    axis = ends[1] - ends[0]
    axis = axis / np.linalg.norm(axis)
    if axis @ np.asarray(spec["towards"], float) < 0:
        axis = -axis
    return (ends[0] + ends[1]) / 2, axis


def packed(chunk: dict, vertices: np.ndarray, corners: np.ndarray, part: str) -> tuple:
    """Some triangles of a chunk as a chunk of their own, a part: on their own vertices, in their own box."""
    used, renumbered = np.unique(corners, return_inverse=True)
    mine = vertices[used]
    position = mine["p"][:, :3] / 65535 * np.array(chunk["size"]) + np.array(chunk["min"])
    uv = mine["uv"] / 65535 * np.array(chunk["uvSize"]) + np.array(chunk["uvMin"])
    p_min, p_size = position.min(0), np.maximum(position.max(0) - position.min(0), 1e-9)
    uv_min, uv_size = uv.min(0), np.maximum(uv.max(0) - uv.min(0), 1e-9)
    out = np.zeros(len(mine), dtype=VERTEX)
    out["p"][:, :3] = np.round((position - p_min) / p_size * 65535)
    out["n"] = mine["n"]
    out["uv"] = np.round((uv - uv_min) / uv_size * 65535)
    return ({
        "material": chunk["material"],
        "min": [round(float(v), 5) for v in p_min], "size": [round(float(v), 5) for v in p_size],
        "uvMin": [round(float(v), 6) for v in uv_min], "uvSize": [round(float(v), 6) for v in uv_size],
        "part": part,
    }, out, renumbered.reshape(-1, 3))


def cut(data: bytes, report=print) -> bytes:
    """A model's file with its ailerons, elevators and rudder taken out of the hull as parts; as it was, where they are already."""
    header, body = read(data)
    parts = dict(header.get("parts") or {})
    wanted = {name: spec for name, spec in SURFACES.items() if name not in parts}
    if not wanted:
        report("control surfaces: parts already")
        return data

    chunks = []
    taken = {name: [] for name in wanted}
    for chunk in header["chunks"]:
        vertices = np.frombuffer(body, VERTEX, chunk["vertices"], chunk["offset"])
        corners = np.frombuffer(body, "<u2", chunk["indices"], chunk["offset"] + chunk["vertices"] * VERTEX.itemsize).reshape(-1, 3)
        kept = {key: value for key, value in chunk.items() if key not in ("vertices", "indices", "offset")}
        if chunk.get("part"):
            chunks.append((kept, vertices, corners))
            continue
        position = vertices["p"][:, :3] / 65535 * np.array(chunk["size"]) + np.array(chunk["min"])
        # A shell's faces meet at corners that are one point, but several vertices: one for each normal and place on the texture.
        _, welded = np.unique(vertices["p"][:, :3], axis=0, return_inverse=True)
        shell = None
        mine = np.zeros(len(corners), bool)
        for name, spec in wanted.items():
            start, end = (np.asarray(point, float) for point in spec["nose"])
            along, back, off = frame(spec)
            place = (position - start) @ np.array([along, back, off]).T
            near = ((place[:, 0] > -REACH["before"]) & (place[:, 0] < np.linalg.norm(end - start) + REACH["beyond"])
                    & (place[:, 1] > -REACH["ahead"]) & (place[:, 1] < REACH["behind"]) & (np.abs(place[:, 2]) < REACH["off"]))
            inside = near[corners].all(1)
            if not inside.any():
                continue
            if shell is None:
                shell = joined(welded.ravel()[corners])
            # Only shells that are wholly there: the wing round an aileron reaches into its place, and is not it.
            partly = np.unique(shell[~inside])
            whole = inside & ~np.isin(shell, partly)
            if whole.any():
                taken[name].append((kept, vertices, corners[whole], shell[whole]))
                mine |= whole
        if mine.any():
            used, renumbered = np.unique(corners[~mine], return_inverse=True)
            vertices, corners = vertices[used], renumbered.reshape(-1, 3)
        chunks.append((kept, vertices, corners))

    for name, spec in wanted.items():
        if not taken[name]:
            raise ValueError(f"{name}: nothing of the model is where it should be")
        # The surface itself is the longest of its shells; the rest are fixed to it.
        longest = None
        for chunk, vertices, corners, shell in taken[name]:
            position = vertices["p"][:, :3] / 65535 * np.array(chunk["size"]) + np.array(chunk["min"])
            for one in np.unique(shell):
                points = position[np.unique(corners[shell == one])]
                reach = np.ptp(points @ frame(spec)[0])
                if longest is None or reach > longest[0]:
                    longest = (reach, points)
        pivot, axis = hinge(longest[1], spec)
        parts[name] = {
            "pivot": [round(float(v), 4) for v in pivot], "axis": [round(float(v), 5) for v in axis],
            "keys": [[at, angle] for at, angle in zip((-1.0, 0.0, 1.0), spec["keys"])], "drive": spec["drive"],
        }
        for chunk, vertices, corners, _ in taken[name]:
            chunks.append(packed(chunk, vertices, corners, name))
        report(f"{name}: {sum(len(corners) for _, _, corners, _ in taken[name])} triangles, "
               f"hinge through {parts[name]['pivot']} along {parts[name]['axis']}")

    return write({**header, "parts": parts}, chunks)


def cut_file(source: str, out: str | None = None) -> None:
    path = Path(source)
    before = path.read_bytes()
    after = cut(before)
    if after is not before or out:
        Path(out or source).write_bytes(after)


if __name__ == "__main__":
    cut_file(*sys.argv[1:3])
