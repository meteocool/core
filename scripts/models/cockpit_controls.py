"""
Make the flight deck's controls parts that move.

    python cockpit_controls.py <a320.bin> [<out.bin>]

Needs `numpy`. `convert-aircraft.py` runs it on what it has written, after
`control_surfaces.py`; run by hand, it works on the model as it is checked in
(public/models/a320).

Most of the controls the model has as shells of the cockpit's meshes, drawn
in one piece with the panels round them: the captain's sidestick, the speed
brake's lever, the landing gear's lever, the rudder pedals on both sides,
the parking brake's handle and the rudder trim's knob (`LIFTED`). Each is
found by a box round it, measured on the model: the shells (triangles that
hang together edge to edge) that lie wholly inside it, which are the control
and nothing of the panel it stands in, so no triangle has to be cut. How many
triangles that is is said with it, and a model on which the box finds any
other number is not taken apart. They are taken out of their chunks into
chunks of their own, as `control_surfaces.py` does with the ailerons.

The first officer's sidestick is left where it is: an Airbus's two sticks
are not linked, and the flight is flown from the left seat. The pedals are,
and both pairs move.

Two the model does not have at all: the thrust levers (the quadrant is
there, with its gates and its detents marked, and no lever in it) and the
flap lever (its slot and gate, and none in them). They are made here
(`BUILT`): plain blocks in two greys, a shaft through the slot and a handle
on top, standing in their slots where the marks have idle and flaps 0.

Each part turns about a pivot of its own as what drives it moves (see
`lib/studio/flight/model.ts`, which reads this), or slides: the pedals go
forward and back along themselves, staying as far off the plates behind
them. The stick's pitch and roll are two parts, one riding on the other:
the stick itself rolls, and is carried by a part with nothing drawn that
pitches. The speed brake's lever is lifted when the ground spoilers are
armed: a part that slides, carrying the one that turns.

What drives each, and its signs:
- `stickPitch`, `stickRoll`: -1 to 1, nose up (the stick pulled back), and
  right wing down (the stick to the right). An A320's stick goes 16 degrees
  either way in pitch, 20 in roll.
- `thrustLevers`: 0 at idle to 1 at take-off/go-around, through the climb
  detent (0.56) and the maximum continuous one (0.78), as the quadrant's own
  marks have them; below idle, to -1, into reverse.
- `flapLever`: 0 to 4, in the lever's detents: 0, 1, 2, 3 and FULL.
- `speedBrakeLever`: 0 retracted to 1 full; `spoilersArmed`: 0 to 1, the
  lever pulled up out of its retracted notch.
- `gearLever`: 0 up to 1 down.
- `pedals`: -1 to 1, the right pedal forward (nose right) positive.
- `parkingBrake`: 0 off to 1 on, the handle turned.
- `rudderTrim`: -1 to 1, the knob turned to the right positive.
Each is where the model has it with what drives it at 0.

A model whose controls are parts already is left as it is.
"""
import struct
import sys
from pathlib import Path

import numpy as np

from control_surfaces import VERTEX, joined, packed, read, write

PITCH_DEG = 16.0
ROLL_DEG = 20.0
PEDAL_M = 0.05
"""How far a pedal goes forward or back, metres."""
PEDAL_ALONG = (0.932, 0.0, -0.363)
"""Up along a pedal, which leans back: what it slides along, so that it stays as far off the plate behind it."""

# Pivots and boxes are metres forward, right and down, measured on the model.
STICK_PIVOT = (15.1511, -0.8686, -0.179)
"""The captain's stick's: in the middle of the collar on top of its boot."""
SPEED_BRAKE_PIVOT = (14.858, -0.081, 0.11)
"""On the line of the lever, a hand's breadth under the pedestal: it then reaches RET, 1/2 and FULL as the marks have them."""
SPEED_BRAKE_UP = (0.353, 0.0, -0.936)
"""Up along the lever as it stands retracted, leaning forward."""
GEAR_PIVOT = (15.505, 0.1434, -0.2205)
"""The inner end of the lever's stem, behind the panel."""

LIFTED = {
    "sidestick.captain": {
        "boxes": [((15.125, -0.91, -0.33), (15.25, -0.82, -0.17))], "triangles": 2212,
        "pivot": STICK_PIVOT, "axis": (1, 0, 0), "drive": "stickRoll", "keys": ((-1, -ROLL_DEG), (0, 0), (1, ROLL_DEG)),
        "parent": "sidestick.captain.pitch",
    },
    "speedBrakeLever": {
        "boxes": [((14.88, -0.095, -0.045), (14.925, -0.067, 0.03))], "triangles": 202,
        "pivot": SPEED_BRAKE_PIVOT, "axis": (0, 1, 0), "drive": "speedBrakeLever", "keys": ((0, 0), (1, 35.3)),
        "parent": "speedBrakeLever.armed",
    },
    "gearLever": {
        "boxes": [((15.43, 0.135, -0.28), (15.51, 0.152, -0.215))], "triangles": 292,
        "pivot": GEAR_PIVOT, "axis": (0, 1, 0), "drive": "gearLever", "keys": ((0, 0), (1, 42)),
    },
    "parkingBrake": {
        "boxes": [((14.705, -0.02, -0.012), (14.75, 0.05, 0.0091)), ((14.73, 0.01, 0.0085), (14.74, 0.019, 0.028))], "triangles": 759,
        "pivot": (14.7349, 0.0147, 0.0), "axis": (0, 0, 1), "drive": "parkingBrake", "keys": ((0, 0), (1, 90)),
    },
    "knob.rudderTrim": {
        "boxes": [((14.805, 0.005, -0.02), (14.85, 0.03, 0.0085))], "triangles": 66,
        "pivot": (14.8264, 0.0175, 0.0), "axis": (0, 0, 1), "drive": "rudderTrim", "keys": ((-1, -30), (0, 0), (1, 30)),
    },
}
# The pedals, each a plate and its four bolts; a left pedal goes back as the right one goes forward.
for seat, side in (("captain", -1), ("firstOfficer", 1)):
    for pedal, (inner, outer), sign in (("Left", (0.53, 0.625), -1), ("Right", (0.42, 0.512), 1)):
        if seat == "firstOfficer":
            # The first officer's left pedal is the inner one.
            (inner, outer), sign = ((0.42, 0.512), -1) if pedal == "Left" else ((0.53, 0.625), 1)
        low, high = sorted((side * inner, side * outer))
        LIFTED[f"pedal.{seat}{pedal}"] = {
            "boxes": [((15.33, low, 0.12), (15.63, high, 0.24))], "triangles": 306,
            "pivot": (15.478, (low + high) / 2, 0.181), "axis": PEDAL_ALONG, "drive": "pedals", "slide": True,
            "keys": ((-1, -sign * PEDAL_M), (0, 0), (1, sign * PEDAL_M)),
        }

JOINTS = {
    "sidestick.captain.pitch": {
        "pivot": STICK_PIVOT, "axis": (0, 1, 0), "drive": "stickPitch", "keys": ((-1, -PITCH_DEG), (0, 0), (1, PITCH_DEG)),
    },
    "speedBrakeLever.armed": {
        "pivot": SPEED_BRAKE_PIVOT, "axis": SPEED_BRAKE_UP, "drive": "spoilersArmed", "keys": ((0, 0), (1, 0.008)), "slide": True,
    },
}

QUADRANT = (15.1149, 0.0047)
"""The middle of the thrust levers' quadrant's arc, forward and down: what they turn about."""
IDLE_DEG = 26.9
"""How far aft of upright the quadrant marks idle; TOGA is 48.2 degrees ahead of that, and the reverse's stop 13.1 behind."""
FLAP_GATE = (14.8675, 0.080, 0.0641)
"""The middle of the flap lever's gate's arc, and its slot's."""
FLAP_ZERO_DEG = -27.5
"""Where the gate has 0, forward of upright; each detent after it is 13.6 degrees further aft."""

HANDLE = [0.13, 0.13, 0.14]
SHAFT = [0.42, 0.43, 0.45]


def thrust_lever(side: int) -> list:
    """A thrust lever, upright, in its lever's own measures: blocks of (forward, up from the pivot) profile, from right to right, and colour."""
    middle = side * 0.0196
    inner, outer = sorted((side * 0.006, side * 0.05))
    return [
        ([(-0.006, 0.088), (0.006, 0.088), (0.006, 0.15), (-0.006, 0.15)], (middle - 0.006, middle + 0.006), SHAFT),
        ([(-0.009, 0.143), (0.013, 0.143), (0.017, 0.15), (0.017, 0.163), (0.012, 0.168), (-0.007, 0.168), (-0.012, 0.163), (-0.012, 0.15)],
         (inner, outer), HANDLE),
    ]


def flap_lever() -> list:
    y = FLAP_GATE[1]
    return [
        ([(-0.0035, 0.04), (0.0035, 0.04), (0.0035, 0.09), (-0.0035, 0.09)], (y - 0.004, y + 0.004), SHAFT),
        ([(-0.006, 0.086), (0.007, 0.086), (0.009, 0.091), (0.007, 0.1), (-0.006, 0.1), (-0.008, 0.094)], (y - 0.022, y + 0.022), HANDLE),
    ]


BUILT = {
    "thrustLever.left": {
        "blocks": thrust_lever(-1), "pivot": (QUADRANT[0], -0.0196, QUADRANT[1]), "rest": IDLE_DEG,
        "drive": "thrustLevers", "keys": ((-1, 13.1), (0, 0), (1, -48.2)),
    },
    "thrustLever.right": {
        "blocks": thrust_lever(1), "pivot": (QUADRANT[0], 0.0196, QUADRANT[1]), "rest": IDLE_DEG,
        "drive": "thrustLevers", "keys": ((-1, 13.1), (0, 0), (1, -48.2)),
    },
    "flapLever": {
        "blocks": flap_lever(), "pivot": FLAP_GATE, "rest": FLAP_ZERO_DEG,
        "drive": "flapLever", "keys": tuple((detent, 13.6 * detent) for detent in range(5)),
    },
}


def turned(points: np.ndarray, pivot, degrees: float) -> np.ndarray:
    """Points turned about a line to the right through `pivot`: a positive angle takes what is above it aft."""
    c, s = np.cos(np.radians(degrees)), np.sin(np.radians(degrees))
    turn = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return (points - pivot) @ turn.T + pivot


def block(profile: list, across: tuple, pivot, rest: float) -> tuple:
    """A block: a profile (forward, up) drawn across from one side to the other, flat faced, about `pivot` and turned by `rest`; its points, normals and triangles."""
    ring = np.array(profile, float)
    n = len(ring)
    at = lambda forward, up, right: [pivot[0] + forward, right, pivot[2] - up]
    points, normals, corners = [], [], []

    def face(polygon: list, normal) -> None:
        start = len(points)
        points.extend(polygon)
        normals.extend([normal] * len(polygon))
        corners.extend([start, start + k, start + k + 1] for k in range(1, len(polygon) - 1))

    # Its two ends, facing out to either side: wound so that their fronts face away.
    face([at(*ring[k], across[1]) for k in range(n)], (0, 1, 0))
    face([at(*ring[k], across[0]) for k in reversed(range(n))], (0, -1, 0))
    # Its sides, all the way round the profile.
    signed = np.sum(ring[:, 0] * np.roll(ring[:, 1], -1) - np.roll(ring[:, 0], -1) * ring[:, 1])
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        edge = b - a
        outward = np.array([edge[1], -edge[0]]) * (1 if signed > 0 else -1)
        outward /= np.linalg.norm(outward)
        quad = [at(*a, across[0]), at(*b, across[0]), at(*b, across[1]), at(*a, across[1])]
        face(quad if signed > 0 else quad[::-1], (outward[0], 0, -outward[1]))
    points = turned(np.array(points), np.asarray(pivot, float), rest)
    normals = turned(np.array(normals, float), np.zeros(3), rest)
    return points, normals, np.array(corners)


def facing(points: np.ndarray, normals: np.ndarray, corners: np.ndarray) -> np.ndarray:
    """Triangles wound so that their fronts face the way their normals do."""
    p = points[corners]
    front = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    backwards = np.einsum("ij,ij->i", front, normals[corners[:, 0]]) < 0
    corners = corners.copy()
    corners[backwards] = corners[backwards][:, [0, 2, 1]]
    return corners


def built(spec: dict, material: int, colour: list, name: str) -> tuple:
    """A made part's blocks of one colour as a chunk: its header, vertices and triangles."""
    points, normals, corners = [], [], []
    for profile, across, shade in spec["blocks"]:
        if shade != colour:
            continue
        p, n, c = block(profile, across, spec["pivot"], spec["rest"])
        corners.append(c + sum(len(one) for one in points))
        points.append(p)
        normals.append(n)
    points, normals, corners = np.concatenate(points), np.concatenate(normals), np.concatenate(corners)
    corners = facing(points, normals, corners)
    p_min, p_size = points.min(0), np.maximum(points.max(0) - points.min(0), 1e-9)
    vertices = np.zeros(len(points), dtype=VERTEX)
    vertices["p"][:, :3] = np.round((points - p_min) / p_size * 65535)
    vertices["n"][:, :3] = np.round(normals * 127)
    return ({
        "material": material,
        "min": [round(float(v), 5) for v in p_min], "size": [round(float(v), 5) for v in p_size],
        "uvMin": [0, 0], "uvSize": [1, 1], "part": name,
    }, vertices, corners)


def hinged(spec: dict) -> dict:
    """A part's entry in the header."""
    part = {
        "pivot": [round(float(v), 4) for v in spec["pivot"]], "axis": [round(float(v), 5) for v in np.asarray(spec["axis"], float) / np.linalg.norm(spec["axis"])],
        "keys": [[float(at), float(angle)] for at, angle in spec["keys"]], "drive": spec["drive"],
    }
    if spec.get("parent"):
        part["parent"] = spec["parent"]
    if spec.get("slide"):
        part["slide"] = True
    return part


def lift(data: bytes, report=print) -> bytes:
    """A model's file with the flight deck's controls as parts; as it was, where they are already."""
    header, body = read(data)
    parts = dict(header.get("parts") or {})
    if all(name in parts for name in (*LIFTED, *JOINTS, *BUILT)):
        report("cockpit controls: parts already")
        return data
    if any(name in parts for name in (*LIFTED, *JOINTS, *BUILT)):
        raise ValueError("cockpit controls: some are parts and some are not")

    chunks = []
    taken = {name: [] for name in LIFTED}
    for chunk in header["chunks"]:
        vertices = np.frombuffer(body, VERTEX, chunk["vertices"], chunk["offset"])
        corners = np.frombuffer(body, "<u2", chunk["indices"], chunk["offset"] + chunk["vertices"] * VERTEX.itemsize).reshape(-1, 3)
        kept = {key: value for key, value in chunk.items() if key not in ("vertices", "indices", "offset")}
        if chunk.get("part"):
            chunks.append((kept, vertices, corners))
            continue
        position = vertices["p"][:, :3] / 65535 * np.array(chunk["size"]) + np.array(chunk["min"])
        _, welded = np.unique(vertices["p"][:, :3], axis=0, return_inverse=True)
        shell = None
        mine = np.zeros(len(corners), bool)
        for name, spec in LIFTED.items():
            inside = np.zeros(len(corners), bool)
            for low, high in spec["boxes"]:
                within = ((position >= low) & (position <= high)).all(1)
                inside |= within[corners].all(1)
            if not inside.any():
                continue
            if shell is None:
                shell = joined(welded.ravel()[corners])
            # Only shells wholly in a box: a panel reaches into the box round the lever standing in it, and is not it.
            whole = inside & ~np.isin(shell, np.unique(shell[~inside])) & ~mine
            if whole.any():
                taken[name].append((kept, vertices, corners[whole]))
                mine |= whole
        if mine.any():
            used, renumbered = np.unique(corners[~mine], return_inverse=True)
            vertices, corners = vertices[used], renumbered.reshape(-1, 3)
        chunks.append((kept, vertices, corners))

    for name, spec in LIFTED.items():
        count = sum(len(corners) for _, _, corners in taken[name])
        expected = spec["triangles"]
        if count != expected:
            raise ValueError(f"{name}: {count} triangles where the model had {expected}; not the model this was measured on")
        parts[name] = hinged(spec)
        for chunk, vertices, corners in taken[name]:
            chunks.append(packed(chunk, vertices, corners, name))
        report(f"{name}: {count} triangles, about {parts[name]['pivot']} along {parts[name]['axis']}")
    for name, spec in JOINTS.items():
        parts[name] = hinged(spec)

    materials = list(header["materials"])
    for colour in (SHAFT, HANDLE):
        wanted = {"texture": None, "colour": colour, "opacity": 1}
        if wanted not in materials:
            materials.append(wanted)
    for name, spec in BUILT.items():
        for colour in (SHAFT, HANDLE):
            chunks.append(built(spec, materials.index({"texture": None, "colour": colour, "opacity": 1}), colour, name))
        parts[name] = hinged({**spec, "axis": (0, 1, 0)})
        report(f"{name}: made, about {parts[name]['pivot']}")

    return write({**header, "materials": materials, "parts": parts}, chunks)


def lift_file(source: str, out: str | None = None) -> None:
    path = Path(source)
    before = path.read_bytes()
    after = lift(before)
    if after is not before or out:
        Path(out or source).write_bytes(after)


if __name__ == "__main__":
    lift_file(*sys.argv[1:3])
