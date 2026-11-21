"""
Turn the aircraft's model, as it is downloaded, into what the flight draws:
one binary of its meshes and a WebP beside it for each texture.

    python convert-aircraft.py <scene.usdc> <its textures' directory> <out directory> <logo.svg>

Needs `usd-core`, `numpy` and `pillow`, and `rsvg-convert` and a Mac's fonts
for the livery. Run once, when the model changes; what it writes is checked
in (public/models/a320).

The model is true to shape but not to size or to our axes, so both are put
right here rather than on every frame: metres, in the aircraft's own frame
(forward, right, down), from a point about its middle. Vertices that are the
same after rounding are made one, meshes of one material are drawn together,
and each vertex is packed into sixteen bytes (see `lib/studio/flight/model.ts`,
which reads this).

The landing gear and its doors are kept apart from the rest (`GEAR`), each
part with the hinge it turns on and how far it turns as the gear goes up,
which the flight animates. So are the wings' flaps, slats and spoilers and
the fairings under the flaps (`SURFACES`), which the model has as meshes of
their own: each with a hinge worked out from its own shape. The ailerons,
the elevators and the rudder the model has only as meshes of the hull: they
are taken out of it as parts once the file is written (`control_surfaces.py`),
and so are the flight deck's levers, stick and pedals, with the thrust levers
and the flap lever the model lacks made for it (`cockpit_controls.py`).

The outside is repainted on the way (`livery`): the airline's colours, titles
and marks come off, the hull is left white, and ours go on: "meteowings"
along both sides, the logo on the fin and on the engines, and stripes in the
radar's colours (the app's own, src/colormaps.ts) sweeping up the tail, round
the engines' intakes and up the wingtips. Each is placed on the aircraft in
metres, not on the texture: every pixel of a texture is first traced to the
point of the hull it is drawn on (`texel_map`), so a title reads the right
way round on either side whatever way its texture was laid out. The inside
is as its author made it, but for the controls that move.
"""
import io
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pxr import Usd, UsdGeom, UsdShade

from cockpit_controls import lift_file
from control_surfaces import cut_file

LENGTH_M = 37.57
"""An A320 from nose to tail, which the model is scaled to."""
ORIGIN = 0.46
"""Where along its length the frame's origin is put: about where it balances."""
TEXTURE_SIDE = 2048
"""No texture is kept larger than this, which is as large as the model has them."""

TITLE = ("meteo", "wings")
TITLE_FONT = ("/System/Library/Fonts/Avenir Next.ttc", 2)
"""The titles' face: Avenir Next Demi Bold."""
TITLE_INK = ((22, 36, 47), (58, 151, 170))
"""Slate, and the logo's blue a shade deeper, which reads on white from a wing's length off."""
TITLE_PLACE = {"from": 10.0, "length": 7.0, "lowest": 0.9}
"""
The titles along each side, metres: from a few rows behind the first door
to ahead of the wing's root, and the g's tail a hand's width over the
windows, whose tops are 0.8 m above the widest of the fuselage. As large as
that leaves room for before the side turns into the roof.
"""

FIN_LOGO = {"centre": (-17.3, 0, -4.15), "height": 2.3}
"""The logo on each side of the fin: in the broad lower half of it, behind the stripes."""
ENGINE_LOGO = {"forward": 3.85, "height": 0.95}
"""The logo on each side of each engine, where its maker's name was."""

COLORMAPS = Path(__file__).resolve().parents[2] / "src" / "colormaps.ts"
"""The app's radar colours, which the livery's stripes are painted in."""
RAMP = "RVP6_CLASSIC"
STRIPES_DBZ = (17, 21, 25, 37, 42, 45, 54, 58)
"""
The reflectivity each stripe is coloured as, light rain to a storm's core:
one of each of the radar's bands, blue, cyan, green, yellow, orange, red,
magenta, violet.
"""

SWEEP = {
    # The middle of the band of stripes, seen from the side: forward and up,
    # metres. It starts behind the wing, runs back on the flat of the side,
    # well under the windows and just under the rear door (whose sill is a
    # quarter of a metre under the widest of the fuselage), rises right
    # behind the door, and runs up the fin just behind its leading edge, off
    # its tip. Lower, on the fuselage's curve towards the belly, the stripes
    # were squeezed from below and the lowest of them cut off where it turns.
    "guide": [
        (-4.6, -0.8), (-8.0, -0.78), (-10.0, -0.76), (-11.4, -0.74), (-12.45, -0.72), (-13.3, -0.3), (-13.75, 0.9), (-13.9, 2.3),
        (-14.45, 3.6), (-15.5, 5.0), (-16.4, 6.1), (-17.3, 7.2), (-18.3, 8.45),
    ],
    # Each stripe's width and the white between them: at the start, and at the fin's tip, the band fanning out as it climbs.
    "stripe": (0.068, 0.13), "gap": (0.018, 0.032),
    # Where the band starts, one clean cut across all of it, leaning back: each stripe
    # starts this much after the one under it. (Each further back, and each growing
    # to its width, read as a band broken off.)
    "stagger": 0.09,
}
WINGLET = {"from": 0.35, "to": 2.3}
"""The stripes up each wingtip's fence, metres above where it leaves the wing."""
INTAKE_RING = {"forward": (4.9, 5.18)}
"""The stripes round each engine, just behind the intake's lip."""

# What is wiped off each texture of the outside before ours goes on, in
# pixels of the texture as published (2048 across): the marks the general
# rule for the airline's blue misses.
WIPE = {
    "m0mat_010": {
        "boxes": [
            # The registration and its flag, the letters by the nose gear, a square by the door, an alliance's mark.
            (1300, 210, 1456, 250), (1300, 632, 1456, 676), (276, 410, 324, 476), (296, 182, 328, 214),
            (196, 170, 244, 212), (196, 672, 244, 714),
            # What is left of the small print and the emblems once their blue is gone: the grey of their edges.
            (296, 216, 500, 256), (296, 630, 500, 672), (146, 218, 200, 272), (146, 614, 200, 668),
            (222, 1426, 278, 1482), (1638, 1426, 1694, 1482),
        ],
    },
    # The engines' maker, on each side of each cowl.
    "m1mat": {"boxes": [(155, 86, 236, 113), (155, 273, 236, 300), (155, 725, 236, 753), (155, 912, 236, 940)], "across": 1024},
}

# The landing gear, by the nodes of the model's own rig that hold each part,
# whose first gives the hinge it turns on. Angles are degrees about `axis` in
# the aircraft's frame (forward, right, down), turning the right-handed way.
# As on an A320, the nose gear folds forward and the main gear inward, each
# leg's own door going with it; the doors behind the nose wheel close
# under it as it goes, and those in the belly and ahead of the nose wheel
# open for the legs to pass and close again. `keys` says when: the gear's
# position, 0 up to 1 down, and the part's angle there.
SWING = (0.18, 0.84)
"""Where in the gear's travel the legs swing: the doors open before, and close after."""


def leg(up: float) -> list:
    """A leg, or what is fixed to it: turned `up` degrees with the gear up, as the model has it down."""
    return [(0.0, up), (SWING[0], up), (SWING[1], 0.0), (1.0, 0.0)]


def door(open_: float) -> list:
    """A door that is shut up and down, and open `open_` degrees while the gear passes."""
    return [(0.0, 0.0), (SWING[0] - 0.02, open_), (SWING[1] + 0.02, open_), (1.0, 0.0)]


def lining(up: float, down: float) -> list:
    """A door's inner face the model has shut while its door is open: `up` degrees with the gear up, `down` with it down."""
    return [(0.0, up), (SWING[0], up), (SWING[1], down), (1.0, down)]


GEAR = {
    "gear.nose": {"nodes": ("node28_003_208", "node66_001_322"), "axis": (0, 1, 0), "keys": leg(97)},
    "gear.left": {"nodes": ("node2_008_199", "node37_003_210"), "axis": (1, 0, 0), "keys": leg(-88)},
    "gear.right": {"nodes": ("node15_003_186", "node39_003_214"), "axis": (1, 0, 0), "keys": leg(88)},
    # The doors along the main legs, hinged on the wing: they fold with the legs and shut the wing's slot over them.
    "gear.leftLegDoor": {"nodes": ("node54_001_312", "node4_005_239"), "axis": (1, 0, 0), "keys": leg(-90)},
    "gear.rightLegDoor": {"nodes": ("node58_001_316", "node8_005_243"), "axis": (1, 0, 0), "keys": leg(90)},
    "gear.noseDoorAftLeft": {"nodes": ("node62_001_318",), "axis": (1, 0, 0), "keys": leg(-90)},
    "gear.noseDoorAftRight": {"nodes": ("node64_001_320",), "axis": (1, 0, 0), "keys": leg(90)},
    # Folded up into the well with the gear up, out of sight behind their doors.
    "gear.noseDoorAftLeftInside": {"nodes": ("node24_004_231",), "axis": (1, 0, 0), "keys": lining(-45, 90)},
    "gear.noseDoorAftRightInside": {"nodes": ("node26_004_233",), "axis": (1, 0, 0), "keys": lining(45, -90)},
    "gear.noseDoorLeft": {"nodes": ("node68_001_326", "node20_004_229"), "axis": (1, 0, 0), "keys": door(80)},
    "gear.noseDoorRight": {"nodes": ("node72_330", "node16_004_225"), "axis": (1, 0, 0), "keys": door(-80)},
    "gear.bellyDoorLeft": {"nodes": ("node50_001_306", "node12_005_219"), "axis": (1, 0, 0), "keys": door(-75)},
    "gear.bellyDoorRight": {"nodes": ("node52_001_308", "node14_004_221"), "axis": (1, 0, 0), "keys": door(75)},
}


# What moves on the wings, by the rig's node that holds each mesh. A part's
# `drive` says what moves it: how far the flaps' lever is out (0 in to 1
# full, slats and flaps both) or how far the spoilers stand (0 flat to 1 all
# the way, as on the ground). Each hinge is worked out from the part's own
# shape (`hinge`), along its leading edge and pointing to the right, so a
# positive angle is always trailing edge down.
FLAPS = [(0.0, 0.0), (0.25, 10.0), (0.5, 15.0), (0.75, 20.0), (1.0, 35.0)]
"""The flaps' angle at each of the lever's five places, as an A320's: 0, 1+F, 2, 3 and FULL."""
SLATS = [(0.0, 0.0), (0.25, -18.0), (0.5, -22.0), (0.75, -22.0), (1.0, -27.0)]
"""The slats', which droop the other way: nose down."""
FAIRINGS = [(at, angle * 0.6) for at, angle in FLAPS]
"""The fairings under the flaps follow them down, by a little over half the angle: their noses stay on the wing."""
SPOILERS = [(0.0, 0.0), (1.0, -50.0)]
"""The spoilers: flat, and all the way up as on the ground. In flight they are asked for half of it or less."""

KINDS = {
    # Each: its keys, and where its hinge is from the middle of its leading edge, metres aft and down.
    # A flap turns about a line well under its nose, which slides it aft as it droops.
    "flap": {"drive": "flaps", "keys": FLAPS, "aft": 0.0, "down": 0.9},
    # A slat about one behind and far below, which carries it forward and down round the wing's nose.
    "slat": {"drive": "flaps", "keys": SLATS, "aft": 0.3, "down": 0.7},
    # A spoiler about its own leading edge.
    "spoiler": {"drive": "spoilers", "keys": SPOILERS, "aft": 0.0, "down": 0.0},
    # A fairing about its nose, straight across the aircraft.
    "fairing": {"drive": "flaps", "keys": FAIRINGS, "aft": 0.25, "down": 0.0},
}

SURFACES = {
    "flap.leftInner": {"node": "node45_001_298", "kind": "flap"},
    "flap.rightInner": {"node": "node34_004_283", "kind": "flap"},
    "flap.leftOuter": {"node": "node38_004_286", "kind": "flap"},
    "flap.rightOuter": {"node": "node42_002_290", "kind": "flap"},
    "slat.leftInner": {"node": "node85_343", "kind": "slat"},
    "slat.rightInner": {"node": "node89_347", "kind": "slat"},
    "slat.leftOuter": {"node": "node87_345", "kind": "slat"},
    "slat.rightOuter": {"node": "node91_349", "kind": "slat"},
    "spoiler.leftInner": {"node": "node101_358", "kind": "spoiler"},
    "spoiler.rightInner": {"node": "node94_351", "kind": "spoiler"},
    "spoiler.leftOuter": {"node": "node98_354", "kind": "spoiler"},
    "spoiler.rightOuter": {"node": "node105_251", "kind": "spoiler"},
    "fairing.left1": {"node": "node21_005_271", "kind": "fairing"},
    "fairing.left2": {"node": "node23_005_273", "kind": "fairing"},
    "fairing.left3": {"node": "node25_005_275", "kind": "fairing"},
    "fairing.right1": {"node": "node27_005_277", "kind": "fairing"},
    "fairing.right2": {"node": "node29_005_279", "kind": "fairing"},
    "fairing.right3": {"node": "node31_004_281", "kind": "fairing"},
}


def hinge(points: np.ndarray, kind: str) -> tuple:
    """
    The line a surface turns about, from its points (forward, right, down):
    a point on it and its direction. Along the surface's leading edge, from
    the foremost point at its inner end to the one at its outer end, turned
    to point to the right on either wing, and moved aft and down from there
    as its kind has it. A fairing's is straight across, through its nose.
    """
    plan = KINDS[kind]
    lateral = np.abs(points[:, 1])
    inner, outer = lateral.min(), lateral.max()
    if kind == "fairing":
        nose = points[points[:, 0] > points[:, 0].max() - 0.3]
        pivot = np.array([points[:, 0].max() - plan["aft"], np.median(points[:, 1]), nose[:, 2].min() + plan["down"]])
        return pivot, np.array([0.0, 1.0, 0.0])
    ends = []
    for at in (inner, outer):
        end = points[np.abs(lateral - at) < 0.05 * (outer - inner) + 0.02]
        ends.append(end[end[:, 0].argmax()])
    axis = ends[1] - ends[0]
    axis = axis / np.linalg.norm(axis) * np.sign(axis[1])
    return (ends[0] + ends[1]) / 2 + [-plan["aft"], 0.0, plan["down"]], axis


def radar_ramp() -> list:
    """The stripes' colours, RGB: each of `STRIPES_DBZ` as the app's radar colours it."""
    source = COLORMAPS.read_text()
    ramp = json.loads(re.search(rf"export const {RAMP}: Rgba\[\] = (\[.*?\]);", source).group(1))
    pad = int(re.search(rf"export const {RAMP}_LEFTPAD = (\d+);", source).group(1))
    return [(ramp[round((dbz + 32.5) * 2) - pad][:3]) for dbz in STRIPES_DBZ]


def texel_map(meshes: list, side: int) -> tuple:
    """
    Where each pixel of a texture is on the hull: the point (forward, right,
    down) and the surface's normal there, NaN for a pixel nothing uses. Of
    triangles that stretch a large part of the texture over a small part of
    the aircraft (a few of this model's do), nothing is kept: they show it
    too small to matter.
    """
    points = np.full((side, side, 3), np.nan, np.float32)
    normals = np.zeros((side, side, 3), np.float32)
    batches = []
    for position, normal, uv, index in meshes:
        texel = np.c_[uv[:, 0] * side, uv[:, 1] * side][index]
        a, b = texel[:, 1] - texel[:, 0], texel[:, 2] - texel[:, 0]
        texels = np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) / 2
        corner = position[index]
        metres = np.linalg.norm(np.cross(corner[:, 1] - corner[:, 0], corner[:, 2] - corner[:, 0]), axis=1) / 2
        density = texels / np.maximum(metres, 1e-9)
        keep = density > 0
        batches.append([texel[keep], position[index][keep], normal[index][keep], density[keep]])
    usual = np.median(np.concatenate([batch[-1] for batch in batches]))
    for batch in batches:
        keep = batch[3] < usual * 8
        batch[:] = [part[keep] for part in batch]
    taken = np.zeros((side, side), bool)
    # The largest mesh first, and none paints over a texel another has: small
    # parts (the gear's doors) reuse stretches of the hull's texture, and it
    # is the hull that a texel is painted for.
    for texel, corner, normal, _ in sorted(batches, key=lambda batch: -len(batch[0])):
        claimed = np.zeros((side, side), bool)
        low = np.floor(texel.min(1)).astype(int)
        high = np.ceil(texel.max(1)).astype(int)
        span = (high - low).max(1)
        # Small triangles many at a time on a common grid, the few large ones each on its own.
        for size in (4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048):
            pick = (span <= size) & (span > size // 2) if size > 4 else span <= size
            for start in range(0, int(pick.sum()), max(1, 400_000 // (size + 1) ** 2)):
                chosen = np.nonzero(pick)[0][start:start + max(1, 400_000 // (size + 1) ** 2)]
                grid = np.arange(size + 1)
                x = low[chosen, 0, None, None] + grid[None, None, :] + 0.5
                y = low[chosen, 1, None, None] + grid[None, :, None] + 0.5
                t = texel[chosen]
                (ax, ay), (bx, by), (cx, cy) = [(t[:, k, 0, None, None], t[:, k, 1, None, None]) for k in range(3)]
                area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                area = np.where(np.abs(area) < 1e-12, 1e-12, area)
                l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / area
                l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / area
                l3 = 1 - l1 - l2
                # Half a pixel's grace at the edges, so seams do not show the paint's edge.
                grace = -0.7 / np.sqrt(np.abs(area))
                inside = (l1 >= grace) & (l2 >= grace) & (l3 >= grace) & (x < side) & (y < side) & (x >= 0) & (y >= 0)
                which, row, column = np.nonzero(inside)
                weights = np.stack([l1[inside], l2[inside], l3[inside]], 1)
                py, px = y[which, row, 0].astype(int), x[which, 0, column].astype(int)
                free = ~taken[py, px]
                py, px, which, weights = py[free], px[free], which[free], weights[free]
                points[py, px] = np.einsum("nk,nkj->nj", weights, corner[chosen][which])
                normals[py, px] = np.einsum("nk,nkj->nj", weights, normal[chosen][which])
                claimed[py, px] = True
        taken |= claimed
    normals /= np.maximum(np.linalg.norm(normals, axis=2, keepdims=True), 1e-9)
    return points, normals


def premultiplied(image: Image.Image) -> np.ndarray:
    """An RGBA picture as floats 0 to 1, its colour multiplied by its opacity."""
    rgba = np.asarray(image.convert("RGBA")).astype(np.float32) / 255
    rgba[..., :3] *= rgba[..., 3:]
    return rgba


def sample(art: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """A premultiplied picture at fractional pixels, linearly between them; clear outside it."""
    height, width = art.shape[:2]
    x0, y0 = np.floor(x - 0.5).astype(int), np.floor(y - 0.5).astype(int)
    fx, fy = (x - 0.5 - x0)[:, None], (y - 0.5 - y0)[:, None]
    padded = np.pad(art, ((1, 1), (1, 1), (0, 0)))
    pick = lambda dx, dy: padded[np.clip(y0 + dy + 1, 0, height + 1), np.clip(x0 + dx + 1, 0, width + 1)]
    return (pick(0, 0) * (1 - fx) * (1 - fy) + pick(1, 0) * fx * (1 - fy) + pick(0, 1) * (1 - fx) * fy + pick(1, 1) * fx * fy)


def over(canvas: np.ndarray, where: np.ndarray, paint: np.ndarray) -> None:
    """Lay premultiplied paint over the canvas (RGB, 0 to 1) at the given pixels."""
    canvas[where] = paint[:, :3] + canvas[where] * (1 - paint[:, 3:])


def decal(canvas: np.ndarray, texels: tuple, art: np.ndarray, anchor: tuple, centre, facing, metres_per_pixel: float) -> None:
    """
    Lay a picture on the hull as a transfer is: `anchor` (a pixel of it) on
    `centre`, upright, seen the right way round from `facing` (a direction
    in the aircraft's frame, out of the surface), so many metres to its
    pixel. Only on the faces turned that way and near the point.
    """
    points, normals = texels
    centre, facing = np.asarray(centre, float), np.asarray(facing, float)
    up = np.array([0.0, 0.0, -1.0])
    along = np.cross(up, facing)
    offset = points - centre
    reach = max(art.shape[:2]) * metres_per_pixel
    near = ((normals @ facing) > 0.25) & (np.abs(offset @ facing) < reach * 0.6)
    near &= (np.abs(offset @ along) < reach) & (np.abs(offset @ up) < reach)
    x = anchor[0] + (offset[near] @ along) / metres_per_pixel
    y = anchor[1] - (offset[near] @ up) / metres_per_pixel
    over(canvas, near, sample(art, x, y))


def softened(art: np.ndarray, pixels_per_texel: float) -> np.ndarray:
    """A picture blurred to about the size of a texel of what it goes on, so it is not drawn with jagged edges."""
    if pixels_per_texel <= 1.2:
        return art
    image = Image.fromarray(np.uint8(np.clip(art * 255, 0, 255)), "RGBA")
    return np.asarray(image.filter(ImageFilter.GaussianBlur(pixels_per_texel * 0.45))).astype(np.float32) / 255


def title_art() -> tuple:
    """"meteowings" in its two inks, large: the picture, the pixel on its baseline where it starts, its length and how far its g reaches under the baseline, in pixels."""
    font = ImageFont.truetype(TITLE_FONT[0], 600, index=TITLE_FONT[1])
    width = round(sum(font.getlength(word) for word in TITLE)) + 40
    image = Image.new("RGBA", (width, 900), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)
    at, baseline = 20.0, 640
    for word, ink in zip(TITLE, TITLE_INK):
        pen.text((at, baseline), word, font=font, fill=ink + (255,), anchor="ls")
        at += font.getlength(word)
    descent = font.getbbox("".join(TITLE), anchor="ls")[3]
    return premultiplied(image), (20, baseline), at - 20, descent


def logo_art(logo_svg: str, pixels: int) -> np.ndarray:
    png = subprocess.run(["rsvg-convert", "-h", str(pixels), logo_svg], check=True, capture_output=True).stdout
    return premultiplied(Image.open(io.BytesIO(png)))


def stripes(ramp: list, place: np.ndarray, texel_m: float, white: float) -> np.ndarray:
    """
    Premultiplied paint for points `place` metres across a band of the
    stripes, 0 to its full width: each stripe its colour of the ramp, a line
    of white `white` metres wide after it, and each edge a texel soft.
    """
    pitch = 1 / len(ramp)
    index = np.clip((place / pitch).astype(int), 0, len(ramp) - 1)
    within = place - index * pitch
    edge = np.clip(np.minimum(within, pitch - white - within) / texel_m + 0.5, 0, 1)[:, None]
    return np.c_[np.asarray(ramp, np.float32)[index] / 255 * edge, edge]


def paint_hull(canvas: np.ndarray, texels: tuple, logo_svg: str, ramp: list, texel_m: float) -> None:
    """The livery on the fuselage, the fin and the wingtips."""
    points, normals = texels
    forward, right, down = points[..., 0], points[..., 1], points[..., 2]
    height = -down

    # The fin white all over first: what is left of the airline's emblem on it is a faint grey ring.
    fin = np.isfinite(forward) & (forward < -10.5) & (height > 2.45) & (np.abs(right) < 0.7)
    canvas[fin] = 1.0

    # The stripes up the tail. Each texel's place across them is its distance
    # from the guide, seen from the side, so both sides and the top and the
    # belly between them are one continuous sweep.
    guide = np.asarray(SWEEP["guide"], float)
    t = np.linspace(0, 1, 40)[:, None]
    curve = [guide[0]]
    for i in range(len(guide) - 1):
        p0, p1, p2, p3 = guide[max(i - 1, 0)], guide[i], guide[i + 1], guide[min(i + 2, len(guide) - 1)]
        curve += list(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)[1:])
    curve = np.asarray(curve)
    run = np.r_[0, np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))]
    count = len(ramp)
    hull = np.isfinite(forward) & (forward < -2.0) & (np.abs(right) < 2.15)
    # Not the tailplane, which meets the tail cone across the stripes; nor the belly, whose flat seen from the side is all one height.
    hull &= ~((forward < -14.5) & (np.abs(right) > 0.45) & (np.abs(normals[..., 2]) > 0.55) & (height > 0.3))
    hull &= normals[..., 2] < 0.8
    where = np.nonzero(hull)
    side = np.c_[forward[where], height[where]]
    best = np.full(len(side), np.inf)
    along = np.zeros(len(side))
    across = np.zeros(len(side))
    for a, b, start in zip(curve[:-1], curve[1:], run[:-1]):
        ab = b - a
        length = np.linalg.norm(ab)
        s = np.clip(((side - a) @ ab) / length ** 2, 0, 1)
        nearest = a + s[:, None] * ab
        distance = np.linalg.norm(side - nearest, axis=1)
        closer = distance < best
        best[closer] = distance[closer]
        along[closer] = start + s[closer] * length
        # Positive above the guide and ahead of it: to its right, going along it.
        across[closer] = -np.sign(ab[0] * (side[closer, 1] - a[1]) - ab[1] * (side[closer, 0] - a[0])) * distance[closer]
    climb = np.clip((side[:, 1] - 2.2) / 6.0, 0, 1)
    stripe_m = SWEEP["stripe"][0] + (SWEEP["stripe"][1] - SWEEP["stripe"][0]) * climb
    pitch = stripe_m + SWEEP["gap"][0] + (SWEEP["gap"][1] - SWEEP["gap"][0]) * climb
    from_edge = across + (count * pitch - (pitch - stripe_m)) / 2
    stripe = np.floor(from_edge / pitch).astype(int)
    within = from_edge - stripe * pitch
    width = stripe_m
    on = (stripe >= 0) & (stripe < count) & (within < width) & (along < run[-1] - 0.05)
    # Each edge a texel soft, the cut at the start too.
    start = (along - (stripe + 0.5) * SWEEP["stagger"]) / texel_m + 0.5
    edge = np.clip(np.minimum(np.minimum(within, width - within) / texel_m + 0.5, start), 0, 1)
    paint = np.zeros((len(side), 4), np.float32)
    colour = np.asarray(ramp, np.float32)[np.clip(stripe, 0, count - 1)] / 255
    alpha = (on * edge)[:, None]
    paint[:, :3] = colour * alpha
    paint[:, 3:] = alpha
    mask = np.zeros(hull.shape, bool)
    mask[where] = True
    over(canvas, mask, paint)

    # The wingtips' fences: the stripes across them, the lightest lowest.
    fence = np.isfinite(forward) & (np.abs(right) > 16.4) & (np.abs(normals[..., 1]) > 0.5)
    base = np.nanmin(np.where(fence, height, np.inf))
    rise = (height - base - WINGLET["from"]) / (WINGLET["to"] - WINGLET["from"])
    fence &= (rise >= 0) & (rise < 1)
    span = WINGLET["to"] - WINGLET["from"]
    over(canvas, fence, stripes(ramp, rise[fence], texel_m / span, SWEEP["gap"][1] / span))

    # The titles, on both sides, read nose to tail on the left and tail to nose on the right, as a reader walking round does.
    art, (start, baseline), length, descent = title_art()
    scale = TITLE_PLACE["length"] / length
    art = softened(art, texel_m / scale)
    line = TITLE_PLACE["lowest"] + descent * scale
    for facing in (-1, 1):
        nose_end = start if facing < 0 else start + length
        decal(canvas, texels, art, (nose_end, baseline), (TITLE_PLACE["from"], facing * 1.9, -line), (0, facing, 0), scale)

    # The logo on each side of the fin.
    pixels = 900
    logo = logo_art(logo_svg, pixels)
    scale = FIN_LOGO["height"] / pixels
    logo = softened(logo, texel_m / scale)
    for facing in (-1, 1):
        x, _, z = FIN_LOGO["centre"]
        decal(canvas, texels, logo, (logo.shape[1] / 2, logo.shape[0] / 2), (x, 0, z), (0, facing, 0), scale)


def paint_engines(canvas: np.ndarray, texels: tuple, logo_svg: str, ramp: list, texel_m: float) -> None:
    """The livery on the engines: a ring of the stripes round each intake, and the logo on each side of each."""
    points, normals = texels
    forward, right, down = points[..., 0], points[..., 1], points[..., 2]
    for sign in (-1, 1):
        engine = np.isfinite(forward) & (np.sign(right) == sign) & (forward > 1.5)
        # The engine's axis and the cowl's radius, from its widest across where the logos go:
        # the pylon above it is narrower than the cowl, so the two sides are the cowl's.
        across = right[engine & (np.abs(forward - ENGINE_LOGO["forward"]) < 0.05)]
        radius = (across.max() - across.min()) / 2
        middle = (across.max() + across.min()) / 2
        sides = engine & (np.abs(forward - ENGINE_LOGO["forward"]) < 0.05) & (np.abs(right - middle) > radius - 0.03)
        axis = np.array([0, middle, np.median(down[sides])])
        radial = np.hypot(right - axis[1], down - axis[2])
        outward = ((right - axis[1]) * normals[..., 1] + (down - axis[2]) * normals[..., 2]) / np.maximum(radial, 1e-6)
        skin = engine & (np.abs(normals[..., 0]) < 0.6) & (outward > 0.5) & (radial > radius * 0.8) & (radial < radius * 1.1)
        low, high = INTAKE_RING["forward"]
        ring = skin & (forward >= low) & (forward < high)
        span = high - low
        over(canvas, ring, stripes(ramp, (high - forward[ring]) / span, texel_m / span, SWEEP["gap"][0] * 0.5 / span))
        pixels = 600
        logo = logo_art(logo_svg, pixels)
        scale = ENGINE_LOGO["height"] / pixels
        logo = softened(logo, texel_m / scale)
        for facing in (-1, 1):
            centre = (ENGINE_LOGO["forward"], axis[1] + facing * radius, axis[2])
            decal(canvas, (np.where(skin[..., None], points, np.nan), normals), logo,
                  (logo.shape[1] / 2, logo.shape[0] / 2), centre, (0, facing, 0), scale)


def nearest_texels(points: np.ndarray, wanted: np.ndarray, cell: float = 0.3) -> np.ndarray:
    """For each point wanted, the texel (x, y) whose point on the hull is nearest it, looked for in the cells of a grid round it."""
    rows, columns = np.nonzero(np.isfinite(points[..., 0]))
    where = points[rows, columns]
    key = lambda p: np.floor(p / cell).astype(np.int64) @ np.array([1 << 40, 1 << 20, 1], np.int64)
    keys = key(where)
    order = np.argsort(keys)
    keys = keys[order]
    found = np.zeros((len(wanted), 2), int)
    for i, point in enumerate(wanted):
        near = []
        for step in np.array(np.meshgrid([-1, 0, 1], [-1, 0, 1], [-1, 0, 1])).reshape(3, -1).T:
            k = key(point + step * cell)
            near.append(order[np.searchsorted(keys, k):np.searchsorted(keys, k, side="right")])
        near = np.concatenate(near)
        if len(near) == 0:
            near = np.arange(len(where))
        best = near[np.argmin(np.linalg.norm(where[near] - point, axis=1))]
        found[i] = columns[best], rows[best]
    return found


def livery(name: str, image: Image.Image, meshes: list, logo_svg: str) -> tuple:
    """
    The texture of one of the outside's materials with our livery in place
    of the airline's; and the triangles to be drawn in one colour instead,
    by mesh (its place in `meshes`), with the point of the texture each is
    to show. Those are triangles whose texture is a stretch of the hull's
    elsewhere (a gear door's, a panel in the wing's root that shares the
    wingtip's): where that stretch has our paint, they would wear a scrap of
    it out of place.
    """
    plan = WIPE.get(name)
    if not plan:
        return image, {}
    image = image.convert("RGB")
    scale = image.width / plan.get("across", 2048)
    pixels = np.asarray(image).astype(np.int16)
    # The airline's blue, and everything blended towards it at its edges: bluer than it is red or green.
    blue = (pixels[:, :, 2] - pixels[:, :, 0] > 9) & (pixels[:, :, 2] - pixels[:, :, 1] > 5)
    pixels[blue] = 255
    image = Image.fromarray(pixels.astype(np.uint8))
    draw = ImageDraw.Draw(image)
    for box in plan["boxes"]:
        draw.rectangle([round(v * scale) for v in box], fill=(255, 255, 255))
    points, normals = texel_map(meshes, image.width)
    # How long a texel is on the hull, about: what the paint's edges are softened to.
    step = np.linalg.norm(points[:, 1:] - points[:, :-1], axis=2)
    texel_m = float(np.nanmedian(step[step < 0.2]))
    clean = np.asarray(image).astype(np.float32) / 255
    canvas = clean.copy()
    ramp = radar_ramp()
    (paint_hull if name == "m0mat_010" else paint_engines)(canvas, (points, normals), logo_svg, ramp, texel_m)
    side = image.width
    painted = Image.fromarray(np.uint8(np.abs(canvas - clean).max(2) > 3 / 255) * 255)
    # Its neighbours too: a texture is sampled a few texels round a point, more from afar.
    painted = np.asarray(painted.filter(ImageFilter.MaxFilter(5))) > 0
    plain = {}
    hull = max(range(len(meshes)), key=lambda number: len(meshes[number][3]))
    for number, (position, _, uv, index) in enumerate(meshes):
        # Each triangle's middle, and its corners too off the hull: where they
        # are, and where their texels are. The hull's own corners sit on the
        # seams between its stretches of texture, which say nothing, and its
        # two halves meet at seams along the middle: elsewhere on it is far.
        on = uv[index].mean(1, keepdims=True)
        at = position[index].mean(1, keepdims=True)
        if number != hull:
            on = np.concatenate([uv[index], on], 1)
            at = np.concatenate([position[index], at], 1)
        x = np.clip((on[..., 0] * side).astype(int), 0, side - 1)
        y = np.clip((on[..., 1] * side).astype(int), 0, side - 1)
        elsewhere = ~(np.linalg.norm(points[y, x] - at, axis=2) < (2.0 if number == hull else 0.5))
        flagged = np.nonzero((painted[y, x] & elsewhere).any(1))[0]
        if len(flagged):
            plain[number] = flagged
    if plain:
        # Each the colour of the hull nearest it: a door the belly's white, a panel in a stripe's path that stripe.
        found = nearest_texels(points, np.concatenate([meshes[number][0][meshes[number][3][flagged]].mean(1) for number, flagged in plain.items()]))
        at = 0
        for number, flagged in plain.items():
            plain[number] = (flagged, (found[at:at + len(flagged)] + 0.5) / side)
            at += len(flagged)
    return Image.fromarray(np.uint8(np.clip(canvas * 255 + 0.5, 0, 255))), plain


VERTEX = np.dtype([("p", "<u2", 4), ("n", "i1", 4), ("uv", "<u2", 2)])
CHUNK = 65535


WELL = {"colour": [0.33, 0.34, 0.36], "ceiling": 0.05, "out": 1.6}
"""
The main gear's well in the belly, which the model does not have: behind
the belly doors it is open into the cabin. A box of plain grey closes it,
from the doors' own outline up to a ceiling this far below the middle of
the fuselage, and out this far from the middle, metres: room for the wheels
folded into it, and inside the round of the fuselage.
"""


def well(door: np.ndarray) -> tuple:
    """
    The box behind one belly door, from the door's points (forward, right,
    down, as the model has it shut): open where the door is, its walls a
    little inside the door's edges, going up from it to a ceiling, and out
    only as far as the wheels need, where the fuselage is still round it;
    beyond that a ledge over the door's outer strip. Its faces look in.
    Points, normals, and triangles' corners.
    """
    side = np.sign(np.median(door[:, 1]))
    lateral = np.abs(door[:, 1])
    inner, outer = lateral.min(), lateral.max()
    aft, ahead = door[:, 0].min() - 0.03, door[:, 0].max() - 0.01
    top, wall = WELL["ceiling"], min(WELL["out"], outer)
    # The door's lower surface across: the opening, a little inside it, so no edge shows past it.
    across = np.linspace(inner, outer, 13)
    opening = np.array([door[np.abs(lateral - y) < (outer - inner) / 20, 2].max() for y in across]) - 0.06
    columns = np.linspace(inner, wall, 16)
    floor = np.interp(columns, across, opening)
    points, normals, corners = [], [], []

    def quad(a, b, c, d, normal):
        start = len(points)
        points.extend([a, b, c, d])
        normals.extend([normal] * 4)
        corners.extend([start, start + 1, start + 2, start, start + 2, start + 3])

    for i in range(len(columns) - 1):
        y0, y1 = side * columns[i], side * columns[i + 1]
        for x, facing in ((ahead, -1.0), (aft, 1.0)):
            quad((x, y0, top), (x, y1, top), (x, y1, floor[i + 1]), (x, y0, floor[i]), (facing, 0, 0))
    for y, z, facing in ((inner, floor[0], side), (wall, floor[-1], -side)):
        quad((aft, side * y, top), (ahead, side * y, top), (ahead, side * y, z), (aft, side * y, z), (0, facing, 0))
    quad((aft, side * inner, top), (ahead, side * inner, top), (ahead, side * wall, top), (aft, side * wall, top), (0, 0, 1))
    if outer - 0.08 > wall:
        # Kept a hand's width above the door's strip, which meets the fairing round it at an angle.
        edge = outer - 0.08
        z0, z1 = floor[-1] - 0.12, np.interp(edge, across, opening) - 0.12
        length = np.hypot(edge - wall, z1 - z0)
        quad((aft, side * wall, z0), (ahead, side * wall, z0), (ahead, side * edge, z1), (aft, side * edge, z1),
             (0, side * (z1 - z0) / length, -(edge - wall) / length))
    return np.array(points, float), np.array(normals, float), np.array(corners)


def part_of(path, nodes: dict):
    """The moving part a mesh belongs to, by the rig's nodes above it; None for the rest of the aircraft."""
    for name in str(path).split("/"):
        if name in nodes:
            return nodes[name]
    return None


def main(scene: str, textures: str, out: str, logo_svg: str) -> None:
    stage = Usd.Stage.Open(scene)
    cache = UsdGeom.XformCache()
    nodes = {node: part for part, plan in GEAR.items() for node in plan["nodes"]}
    nodes.update({plan["node"]: part for part, plan in SURFACES.items()})
    meshes = []
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        matrix = np.array(cache.GetLocalToWorldTransform(prim))
        points = np.array(mesh.GetPointsAttr().Get(), dtype=np.float64)
        world = (np.c_[points, np.ones(len(points))] @ matrix)[:, :3]
        normals = np.array(mesh.GetNormalsAttr().Get(), dtype=np.float64) @ np.linalg.inv(matrix[:3, :3]).T
        primvars = UsdGeom.PrimvarsAPI(prim)
        st = primvars.GetPrimvar("st0").Get() if primvars.HasPrimvar("st0") else None
        uv = np.array(st, dtype=np.float64) if st is not None else np.zeros((len(points), 2))
        counts = np.array(mesh.GetFaceVertexCountsAttr().Get())
        indices = np.array(mesh.GetFaceVertexIndicesAttr().Get())
        assert (counts == 3).all(), "triangles only"
        material = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0].GetPrim().GetName()
        meshes.append([material, world, normals, uv, indices, part_of(prim.GetPath(), nodes)])

    low = np.min([m[1].min(0) for m in meshes], axis=0)
    high = np.max([m[1].max(0) for m in meshes], axis=0)
    # The model: x across, y up, z from the nose back.
    scale = LENGTH_M / (high[2] - low[2])
    origin_z = low[2] + ORIGIN * (high[2] - low[2])
    to_body = np.array([[0, 0, -1], [1, 0, 0], [0, -1, 0]], dtype=np.float64)
    to_aircraft = lambda world: (world - [0, 0, origin_z]) * scale @ to_body.T
    for mesh in meshes:
        mesh[1] = to_aircraft(mesh[1])
        normal = mesh[2] @ to_body.T
        mesh[2] = normal / np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-12)
        # A texture's first row is its top here, its bottom in the model.
        mesh[3] = np.c_[mesh[3][:, 0], 1 - mesh[3][:, 1]]

    parts = {}
    for part, plan in GEAR.items():
        node = next(p for p in stage.Traverse() if p.GetName() == plan["nodes"][0])
        pivot = to_aircraft(np.array(cache.GetLocalToWorldTransform(node))[3, :3])
        parts[part] = {
            "pivot": [round(float(v), 4) for v in pivot], "axis": list(plan["axis"]),
            "keys": [[at, angle] for at, angle in plan["keys"]],
        }

    for part, plan in SURFACES.items():
        pivot, axis = hinge(np.concatenate([m[1] for m in meshes if m[5] == part]), plan["kind"])
        kind = KINDS[plan["kind"]]
        parts[part] = {
            "pivot": [round(float(v), 4) for v in pivot], "axis": [round(float(v), 5) for v in axis],
            "keys": [[at, angle] for at, angle in kind["keys"]], "drive": kind["drive"],
        }

    for door in ("gear.bellyDoorLeft", "gear.bellyDoorRight"):
        shut = np.concatenate([m[1] for m in meshes if m[5] == door and m[0] == "m0mat_010"])
        position, normal, corners = well(shut)
        meshes.append(["well", position, normal, np.zeros((len(position), 2)), corners, None])

    materials, names = [], {}
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for prim in stage.Traverse():
        if not prim.IsA(UsdShade.Material):
            continue
        shader = UsdShade.Shader(prim.GetChild("pbr_shader"))
        colour = shader.GetInput("diffuseColor").Get()
        opacity = shader.GetInput("opacity").Get() if shader.GetInput("opacity") else None
        texture = None
        base = prim.GetChild("tex_base")
        if base:
            source = Path(textures) / Path(UsdShade.Shader(base).GetInput("file").Get().path).name
            if not source.exists():
                source = source.with_suffix(".jpeg")
            mine = [m for m in meshes if m[0] == prim.GetName()]
            image, plain = livery(prim.GetName(), Image.open(source), [(m[1], m[2], m[3], m[4].reshape(-1, 3)) for m in mine], logo_svg)
            for number, (flagged, uv) in plain.items():
                # Those triangles on corners of their own, each showing its one texel.
                mesh = mine[number]
                index = mesh[4].reshape(-1, 3)
                corners = index[flagged].ravel()
                start = len(mesh[1])
                mesh[1] = np.concatenate([mesh[1], mesh[1][corners]])
                mesh[2] = np.concatenate([mesh[2], mesh[2][corners]])
                mesh[3] = np.concatenate([mesh[3], np.repeat(uv, 3, axis=0)])
                index[flagged] = start + np.arange(len(corners)).reshape(-1, 3)
                mesh[4] = index.ravel()
            if plain:
                print(f"{prim.GetName()}: {sum(len(flagged) for flagged, _ in plain.values())} triangles drawn in one colour")
            image.thumbnail((TEXTURE_SIDE, TEXTURE_SIDE), Image.LANCZOS)
            texture = f"{prim.GetName()}.webp"
            image.save(out_dir / texture, "WEBP", quality=82, method=6)
        names[prim.GetName()] = len(materials)
        materials.append({
            "texture": texture,
            "colour": [round(c, 4) for c in colour] if colour is not None else [1, 1, 1],
            "opacity": round(opacity, 3) if opacity is not None else 1,
        })
    names["well"] = len(materials)
    materials.append({"texture": None, "colour": WELL["colour"], "opacity": 1})

    body = bytearray()
    chunks = []

    def flush(material: str, part, group: list) -> None:
        position = np.concatenate([g[0] for g in group])
        normal = np.concatenate([g[1] for g in group])
        uv = np.concatenate([g[2] for g in group])
        offsets = np.cumsum([0] + [len(g[0]) for g in group[:-1]])
        index = np.concatenate([g[3] + offset for g, offset in zip(group, offsets)])
        p_min, p_size = position.min(0), np.maximum(position.max(0) - position.min(0), 1e-9)
        uv_min, uv_size = uv.min(0), np.maximum(uv.max(0) - uv.min(0), 1e-9)
        packed = np.zeros(len(position), dtype=VERTEX)
        packed["p"][:, :3] = np.round((position - p_min) / p_size * 65535)
        packed["n"][:, :3] = np.round(normal * 127)
        packed["uv"] = np.round((uv - uv_min) / uv_size * 65535)
        unique, inverse = np.unique(packed, return_inverse=True)
        triangles = inverse[index].reshape(-1, 3)
        triangles = triangles[(triangles[:, 0] != triangles[:, 1]) & (triangles[:, 1] != triangles[:, 2])
                              & (triangles[:, 0] != triangles[:, 2])]
        assert len(unique) <= CHUNK
        chunk = {
            "material": names[material], "vertices": len(unique), "indices": int(triangles.size), "offset": len(body),
            "min": [round(v, 5) for v in p_min], "size": [round(v, 5) for v in p_size],
            "uvMin": [round(v, 6) for v in uv_min], "uvSize": [round(v, 6) for v in uv_size],
        }
        if part:
            chunk["part"] = part
        chunks.append(chunk)
        body.extend(unique.tobytes())
        body.extend(triangles.astype("<u2").tobytes())
        body.extend(b"\0" * (-len(body) % 4))

    for material in names:
        for part in [None, *GEAR, *SURFACES]:
            group, held = [], 0
            for name, position, normals, uv, indices, owner in meshes:
                if name != material or owner != part:
                    continue
                if held + len(position) > CHUNK and group:
                    flush(material, part, group)
                    group, held = [], 0
                group.append((position, normals, uv, indices))
                held += len(position)
            if group:
                flush(material, part, group)

    layer = stage.GetRootLayer().customLayerData
    header = json.dumps({
        "title": layer.get("title"), "author": layer.get("author"), "licence": layer.get("copyright"), "source": layer.get("url"),
        "materials": materials, "chunks": chunks, "parts": parts,
    }, separators=(",", ":")).encode()
    header += b" " * (-len(header) % 4)
    (out_dir / "a320.bin").write_bytes(b"MCM1" + struct.pack("<I", len(header)) + header + bytes(body))
    print(f"{len(chunks)} chunks, {sum(c['vertices'] for c in chunks)} vertices, "
          f"{sum(c['indices'] for c in chunks) // 3} triangles, {(len(body) + len(header)) / 1e6:.1f} MB, scale {scale:.4f}")
    cut_file(str(out_dir / "a320.bin"))
    lift_file(str(out_dir / "a320.bin"))


if __name__ == "__main__":
    main(*sys.argv[1:5])
