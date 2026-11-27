"""
Make the light aircraft the flight draws other aircraft with: the outside
of the cockpit's own model and nothing else, at a few thousand triangles,
coloured by its vertices; and a silhouette of a few hundred.

    python light-aircraft.py <a320.bin> <out.bin>

Needs `numpy`, `scipy` and `pillow`. Run once, whenever the model
(public/models/a320/a320.bin, written by convert-aircraft.py, its textures
beside it) changes; what
it writes is checked in (public/models/a320/a320-light.bin).

What is outside is what can be seen from outside: the model is looked at
from 160 directions round it, each a picture of its depth at 7 cm a pixel,
and a triangle is kept if any of its points is on the surface of one of
those pictures. The windows count as solid, so the flight deck and the
cabin behind them are left out with the rest of the inside.

What is kept is made lighter by clustering its vertices (Lindstrom's
"out-of-core simplification", 2000): every vertex in a cell of a grid,
with its normal pointing the same way, becomes one, put where it best
keeps the planes of the triangles round it, and triangles left with two
corners in one cell go. The cell is grown until the mesh is about as small
as asked. Each vertex is coloured by the textures where the triangles round
it are drawn, the windows dark.

The landing gear (legs, wheels and doors, as the model has them down) is
kept and marked, so the flight can fold it away when an aircraft's gear is
up. Nothing else moves.

The file: `MCL1`, the length of a JSON header, the header (the model's
title, author, licence and source; and each mesh's name, counts and offset),
then for each mesh its vertices and its indices. A vertex is sixteen bytes:
its place as three signed 16-bit steps across the header's `extent` (metres
either way of the middle, forward, right, down) and a 16-bit flag (1 for the
gear), its normal as three signed bytes and one spare, its colour as four
bytes (sRGB, and 255). Indices are 16 bits. See
src/lib/studio/flight/airspace/lightModel.ts, which reads it.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

DIRECTIONS = 160
"""How many directions the model is looked at from to find its outside."""
PIXEL_M = 0.07
"""How large a pixel of each of those pictures is, metres."""
SPACING_M = 0.09
"""How close together the points of a triangle are that are looked for in them, metres."""
DEPTH_SLACK_M = 0.06
"""How far behind the nearest surface a point may be and still be on it, metres."""
MODEL_TRIANGLES = 8000
SILHOUETTE_TRIANGLES = 400
"""About how many triangles each mesh has."""
GLASS = (0.12, 0.16, 0.22)
"""What the windows are coloured, seen from outside."""


def read(path: str) -> tuple:
    data = Path(path).read_bytes()
    if data[:4] != b"MCM1":
        raise ValueError("not an aircraft model")
    length = struct.unpack("<I", data[4:8])[0]
    return json.loads(data[8:8 + length]), data[8 + length:]


def chunks_of(header: dict, body: bytes) -> list:
    """Each chunk's positions (metres), normals, texture coordinates, triangles, material and part."""
    out = []
    for chunk in header["chunks"]:
        at = chunk["offset"]
        raw = np.frombuffer(body, dtype=np.uint8, count=chunk["vertices"] * 16, offset=at).reshape(-1, 16)
        steps = raw[:, 0:6].copy().view("<u2").astype(np.float64) / 65535
        positions = np.array(chunk["min"]) + steps * np.array(chunk["size"])
        normals = raw[:, 8:11].copy().view(np.int8).astype(np.float64) / 127
        uv = raw[:, 12:16].copy().view("<u2").astype(np.float64) / 65535 * np.array(chunk["uvSize"]) + np.array(chunk["uvMin"])
        corners = np.frombuffer(body, dtype="<u2", count=chunk["indices"], offset=at + chunk["vertices"] * 16).reshape(-1, 3).astype(np.int64)
        out.append({"positions": positions, "normals": normals, "uv": uv, "triangles": corners, "material": chunk["material"], "part": chunk.get("part")})
    return out


def fibonacci(n: int) -> np.ndarray:
    i = np.arange(n) + 0.5
    z = 1 - 2 * i / n
    r = np.sqrt(1 - z * z)
    turn = np.pi * (3 - np.sqrt(5)) * i
    return np.stack([r * np.cos(turn), r * np.sin(turn), z], axis=1)


def samples(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> tuple:
    """Points over each triangle no further apart than `SPACING_M`, and the triangle each is of."""
    longest = np.max(np.stack([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1), np.linalg.norm(a - c, axis=1)]), axis=0)
    steps = np.clip(np.ceil(longest / SPACING_M).astype(int), 1, 400)
    points, owners = [], []
    for k in np.unique(steps):
        which = np.nonzero(steps == k)[0]
        grid = [(i / k, j / k) for i in range(k + 1) for j in range(k + 1 - i)]
        # The middle too, which a triangle of one step would otherwise only have its corners of.
        grid.append((1 / 3, 1 / 3))
        u = np.array([g[0] for g in grid])
        v = np.array([g[1] for g in grid])
        p = a[which, None, :] + (b - a)[which, None, :] * u[None, :, None] + (c - a)[which, None, :] * v[None, :, None]
        points.append(p.reshape(-1, 3))
        owners.append(np.repeat(which, len(grid)))
    return np.concatenate(points), np.concatenate(owners)


def outside(positions: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    """Which triangles can be seen from outside the model."""
    a, b, c = (positions[triangles[:, k]] for k in range(3))
    points, owners = samples(a, b, c)
    print(f"  {len(points)} points over {len(triangles)} triangles", file=sys.stderr)
    seen = np.zeros(len(triangles), dtype=bool)
    middle = positions.mean(axis=0)
    points = points - middle
    for n, toward in enumerate(fibonacci(DIRECTIONS)):
        # The picture's two axes, across the direction looked along.
        helper = np.array([0, 0, 1.0]) if abs(toward[2]) < 0.9 else np.array([1.0, 0, 0])
        x = np.cross(toward, helper)
        x /= np.linalg.norm(x)
        y = np.cross(toward, x)
        depth = points @ toward
        px = np.floor(points @ x / PIXEL_M).astype(np.int64)
        py = np.floor(points @ y / PIXEL_M).astype(np.int64)
        px -= px.min()
        py -= py.min()
        width, height = px.max() + 3, py.max() + 3
        nearest = np.full(width * height, np.inf)
        cell = (py + 1) * width + (px + 1)
        np.minimum.at(nearest, cell, depth)
        # Between the points of a surface seen edge on there are gaps: what is behind it must not show through them.
        filled = ndimage.minimum_filter(nearest.reshape(height, width), size=3).ravel()
        seen[owners[depth <= filled[cell] + DEPTH_SLACK_M]] = True
        if n % 40 == 39:
            print(f"  {n + 1} directions: {seen.sum()} triangles seen", file=sys.stderr)
    return seen


def texture_colour(directory: Path, materials: list, cache: dict, material: int, uv: np.ndarray) -> np.ndarray:
    """The colour of a material's texture at each of `uv` (0 to 1), or its plain colour."""
    spec = materials[material]
    if spec.get("opacity", 1) < 1:
        return np.tile(GLASS, (len(uv), 1))
    texture = spec.get("texture")
    if not texture:
        return np.tile(np.array(spec["colour"], dtype=np.float64), (len(uv), 1))
    if texture not in cache:
        image = Image.open(directory / texture).convert("RGB")
        # Smaller first: a vertex stands for a few square metres of the hull.
        image = image.resize((max(1, image.width // 8), max(1, image.height // 8)), Image.Resampling.BOX)
        cache[texture] = np.asarray(image, dtype=np.float64) / 255
    picture = cache[texture]
    h, w = picture.shape[:2]
    col = np.clip((np.mod(uv[:, 0], 1) * w).astype(int), 0, w - 1)
    row = np.clip((np.mod(uv[:, 1], 1) * h).astype(int), 0, h - 1)
    return picture[row, col] * np.array(spec["colour"], dtype=np.float64)


def cluster(positions: np.ndarray, triangles: np.ndarray, colours: np.ndarray, gear: np.ndarray, cell_m: float) -> tuple:
    """The mesh with its vertices clustered in cells `cell_m` across, each cluster where the planes round it best keep it."""
    a, b, c = (positions[triangles[:, k]] for k in range(3))
    cross = np.cross(b - a, c - a)
    area2 = np.linalg.norm(cross, axis=1)
    face_normal = cross / np.maximum(area2, 1e-12)[:, None]
    # Each vertex's normal, from the faces round it, and which of the six ways it points: the two skins of a wing stay two.
    vertex_normal = np.zeros_like(positions)
    for k in range(3):
        np.add.at(vertex_normal, triangles[:, k], cross)
    vertex_normal /= np.maximum(np.linalg.norm(vertex_normal, axis=1), 1e-12)[:, None]
    axis = np.argmax(np.abs(vertex_normal), axis=1)
    way = axis * 2 + (vertex_normal[np.arange(len(axis)), axis] > 0)
    cells = np.floor(positions / cell_m).astype(np.int64)
    cells -= cells.min(axis=0)
    span = cells.max(axis=0) + 1
    key = ((cells[:, 0] * span[1] + cells[:, 1]) * span[2] + cells[:, 2]) * 12 + way * 2 + gear.astype(np.int64)
    unique, cluster_of = np.unique(key, return_inverse=True)
    clusters = len(unique)
    # Each cluster's quadric: the planes of the faces round its vertices, each by its area.
    d = -np.einsum("ij,ij->i", face_normal, a)
    plane = np.concatenate([face_normal, d[:, None]], axis=1)
    quadric_face = plane[:, :, None] * plane[:, None, :] * area2[:, None, None]
    quadrics = np.zeros((clusters, 4, 4))
    for k in range(3):
        np.add.at(quadrics, cluster_of[triangles[:, k]], quadric_face)
    mean = np.zeros((clusters, 3))
    count = np.zeros(clusters)
    np.add.at(mean, cluster_of, positions)
    np.add.at(count, cluster_of, 1)
    mean /= count[:, None]
    placed = mean.copy()
    A = quadrics[:, :3, :3] + np.eye(3)[None] * 1e-4 * np.maximum(np.trace(quadrics[:, :3, :3], axis1=1, axis2=2), 1e-9)[:, None, None]
    rhs = -quadrics[:, :3, 3] + 1e-4 * np.maximum(np.trace(quadrics[:, :3, :3], axis1=1, axis2=2), 1e-9)[:, None] * mean
    try:
        solved = np.linalg.solve(A, rhs[:, :, None])[:, :, 0]
        # Kept near its own vertices: a cluster's best point may be far off where its planes are nearly parallel.
        ok = np.linalg.norm(solved - mean, axis=1) < cell_m
        placed[ok] = solved[ok]
    except np.linalg.LinAlgError:
        pass
    # The colour, and whether it is of the gear, from the faces round it.
    colour = np.zeros((clusters, 3))
    weight = np.zeros(clusters)
    for k in range(3):
        np.add.at(colour, cluster_of[triangles[:, k]], colours * area2[:, None])
        np.add.at(weight, cluster_of[triangles[:, k]], area2)
    colour /= np.maximum(weight, 1e-12)[:, None]
    gear_of = np.zeros(clusters, dtype=bool)
    gear_of[cluster_of] = gear
    new = cluster_of[triangles]
    keep = (new[:, 0] != new[:, 1]) & (new[:, 1] != new[:, 2]) & (new[:, 0] != new[:, 2])
    new = new[keep]
    # The same triangle twice, either way round, once.
    _, first = np.unique(np.sort(new, axis=1), axis=0, return_index=True)
    new = new[np.sort(first)]
    # Only the clusters still in a triangle.
    used, remap = np.unique(new, return_inverse=True)
    return placed[used], remap.reshape(-1, 3), colour[used], gear_of[used]


def normals_of(positions: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    a, b, c = (positions[triangles[:, k]] for k in range(3))
    cross = np.cross(b - a, c - a)
    normals = np.zeros_like(positions)
    for k in range(3):
        np.add.at(normals, triangles[:, k], cross)
    return normals / np.maximum(np.linalg.norm(normals, axis=1), 1e-12)[:, None]


def lighter(positions, triangles, colours, gear, wanted: int) -> tuple:
    """Clustered with the cell that comes nearest `wanted` triangles, from above."""
    low, high = 0.02, 8.0
    best = None
    for _ in range(22):
        cell = (low * high) ** 0.5
        mesh = cluster(positions, triangles, colours, gear, cell)
        if len(mesh[1]) > wanted:
            low = cell
        else:
            high = cell
            best = (cell, mesh)
    if best is None:
        best = (high, cluster(positions, triangles, colours, gear, high))
    print(f"  cell {best[0]:.3f} m: {len(best[1][1])} triangles, {len(best[1][0])} vertices", file=sys.stderr)
    return best[1]


def pack(positions, triangles, colours, gear, extent: np.ndarray) -> bytes:
    if len(positions) > 65535:
        raise ValueError("too many vertices for 16-bit indices")
    normals = normals_of(positions, triangles)
    out = np.zeros((len(positions), 16), dtype=np.uint8)
    steps = np.clip(np.round(positions / extent * 32767), -32767, 32767).astype("<i2")
    out[:, 0:6] = steps.view(np.uint8).reshape(-1, 6)
    out[:, 6:8] = gear.astype("<u2").view(np.uint8).reshape(-1, 2)
    out[:, 8:11] = np.clip(np.round(normals * 127), -127, 127).astype(np.int8).view(np.uint8).reshape(-1, 3)
    # The textures are sRGB already: a texel's colour is kept as it is drawn.
    out[:, 12:15] = np.clip(np.round(colours * 255), 0, 255).astype(np.uint8)
    out[:, 15] = 255
    return out.tobytes() + triangles.astype("<u2").tobytes()


def main(source: str, out: str) -> None:
    # Some builds of numpy's matrix product warn of overflows on finite input that it handles correctly.
    np.seterr(over="ignore", divide="ignore", invalid="ignore")
    header, body = read(source)
    directory = Path(source).parent
    chunks = chunks_of(header, body)
    positions, triangles, colours, gear = [], [], [], []
    cache: dict = {}
    first = 0
    for chunk in chunks:
        tri = chunk["triangles"]
        a = chunk["uv"][tri].mean(axis=1)
        positions.append(chunk["positions"])
        triangles.append(tri + first)
        colours.append(texture_colour(directory, header["materials"], cache, chunk["material"], a))
        gear.append(np.full(len(chunk["positions"]), bool(chunk["part"] and chunk["part"].startswith("gear."))))
        first += len(chunk["positions"])
    positions = np.concatenate(positions)
    triangles = np.concatenate(triangles)
    colours = np.concatenate(colours)
    gear = np.concatenate(gear)
    print(f"{len(triangles)} triangles in all", file=sys.stderr)
    seen = outside(positions, triangles)
    triangles, colours = triangles[seen], colours[seen]
    print(f"{len(triangles)} triangles outside", file=sys.stderr)
    # A triangle's vertices are of the gear where the triangle is.
    gear_triangle = gear[triangles[:, 0]]
    model = lighter(positions, triangles, colours, gear, MODEL_TRIANGLES)
    # The silhouette has no gear: it is too far for it to matter.
    hull = ~gear_triangle
    silhouette = lighter(positions, triangles[hull], colours[hull], np.zeros(len(positions), dtype=bool), SILHOUETTE_TRIANGLES)
    extent = np.max(np.abs(np.concatenate([model[0], silhouette[0]])), axis=0) * 1.001
    meshes, blobs, at = [], [], 0
    for name, (p, t, c, g) in (("model", model), ("silhouette", silhouette)):
        blob = pack(p, t, c, g, extent)
        meshes.append({"name": name, "vertices": len(p), "indices": int(t.size), "offset": at})
        blob += b"\0" * (-len(blob) % 4)
        blobs.append(blob)
        at += len(blob)
    meta = {key: header[key] for key in ("title", "author", "licence", "source")}
    packed = json.dumps({**meta, "extent": [round(float(e), 4) for e in extent], "meshes": meshes}, separators=(",", ":")).encode()
    packed += b" " * (-len(packed) % 4)
    data = b"MCL1" + struct.pack("<I", len(packed)) + packed + b"".join(blobs)
    Path(out).write_bytes(data)
    print(f"{out}: {len(data)} bytes", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
