/**
 * Byte ranges for the files a media element streams (the flight's
 * soundtrack, under /audio/). Safari plays a stream only from a server that
 * answers `Range` with 206, and the static assets answer every request with
 * the whole file. So the Worker cuts the asked-for range out of it: the
 * pieces are a few megabytes, well within what a Worker may hold.
 */

/** Whether a path is one streamed by a media element. */
export function isStreamedPath(pathname: string): boolean {
  return pathname.startsWith("/audio/");
}

/**
 * The first and last byte a `Range` header asks for, of a file this long;
 * null where it asks for none this answers (several ranges, or another
 * unit), "unsatisfiable" where it asks for bytes past the end.
 */
export function parseRange(header: string | null, size: number): [number, number] | null | "unsatisfiable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    // The last so many bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return "unsatisfiable";
    return [Math.max(0, size - suffix), size - 1];
  }
  const first = Number(match[1]);
  const last = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (first >= size || last < first) return "unsatisfiable";
  return [first, last];
}

/** The response, cut to the request's range where it asks for one; saying it takes ranges either way. */
export async function withByteRange(request: Request, response: Response): Promise<Response> {
  if (response.status !== 200 || (request.method !== "GET" && request.method !== "HEAD")) return response;
  const headers = new Headers(response.headers);
  headers.set("Accept-Ranges", "bytes");
  const header = request.headers.get("Range");
  if (!header || request.method === "HEAD") return new Response(response.body, { status: 200, headers });
  const body = await response.arrayBuffer();
  const size = body.byteLength;
  const range = parseRange(header, size);
  if (range === null) return new Response(body, { status: 200, headers });
  if (range === "unsatisfiable") {
    headers.delete("Content-Length");
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const [first, last] = range;
  headers.set("Content-Range", `bytes ${first}-${last}/${size}`);
  headers.set("Content-Length", String(last - first + 1));
  return new Response(body.slice(first, last + 1), { status: 206, headers });
}
