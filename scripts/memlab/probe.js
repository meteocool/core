/*
 * Counts what the page holds outside the JavaScript heap: WebGL textures,
 * buffers and drawing buffers, 2D canvases and ImageBitmaps.
 *
 * The iOS simulator's process footprint leaves GPU memory out; on a phone it
 * counts against the web view like the rest. Loaded as a classic script ahead
 * of the bundle (see vite.config.ts here), so every context is seen from its
 * creation. Read with `window.__memlab.snapshot()`.
 */
(() => {
  const MB = 1024 * 1024;
  const contexts = new Set(); // WeakRef<GL state>
  const canvases = new Set(); // WeakRef<canvas>
  const bitmaps = new Set(); // WeakRef<ImageBitmap>
  const glOf = new WeakMap(); // context → state
  let made = { gl: 0, canvas: 0, bitmap: 0, lost: 0 };

  // Bytes per texel by (format, type), enough for what WebGL 1/2 apps upload.
  const GL = WebGL2RenderingContext;
  const unpackBytes = (format, type) => {
    const channels = {
      [GL.RGBA]: 4, [GL.RGB]: 3, [GL.LUMINANCE_ALPHA]: 2, [GL.LUMINANCE]: 1, [GL.ALPHA]: 1,
      [GL.RED]: 1, [GL.RED_INTEGER]: 1, [GL.RG]: 2, [GL.RG_INTEGER]: 2, [GL.RGBA_INTEGER]: 4,
      [GL.DEPTH_COMPONENT]: 1, [GL.DEPTH_STENCIL]: 1,
    }[format] ?? 4;
    const size = {
      [GL.UNSIGNED_BYTE]: 1, [GL.BYTE]: 1, [GL.UNSIGNED_SHORT]: 2, [GL.SHORT]: 2, [GL.HALF_FLOAT]: 2,
      [0x8D61]: 2, [GL.FLOAT]: 4, [GL.UNSIGNED_INT]: 4, [GL.INT]: 4,
      [GL.UNSIGNED_SHORT_4_4_4_4]: 2 / channels, [GL.UNSIGNED_SHORT_5_5_5_1]: 2 / channels, [GL.UNSIGNED_SHORT_5_6_5]: 2 / channels,
      [GL.UNSIGNED_INT_24_8]: 4, [GL.UNSIGNED_INT_2_10_10_10_REV]: 4 / channels,
    }[type] ?? 1;
    return channels * size;
  };
  const internalBytes = (internal) => ({
    [GL.R8]: 1, [GL.R8UI]: 1, [GL.RG8]: 2, [GL.R16F]: 2, [GL.RGB8]: 4, [GL.RGBA8]: 4, [GL.SRGB8_ALPHA8]: 4,
    [GL.RGBA16F]: 8, [GL.RGBA32F]: 16, [GL.R32F]: 4, [GL.RG16F]: 4, [GL.RG32F]: 8,
    [GL.DEPTH_COMPONENT16]: 2, [GL.DEPTH_COMPONENT24]: 4, [GL.DEPTH24_STENCIL8]: 4, [GL.DEPTH_COMPONENT32F]: 4,
    [GL.STENCIL_INDEX8]: 1, [GL.RGBA4]: 2, [GL.RGB565]: 2, [GL.RGB5_A1]: 2,
  }[internal] ?? 4);

  const sourceSize = (source) => {
    if (!source) return [0, 0];
    return [source.videoWidth || source.naturalWidth || source.displayWidth || source.width || 0,
      source.videoHeight || source.naturalHeight || source.displayHeight || source.height || 0];
  };

  function state(gl) {
    let s = glOf.get(gl);
    if (!s) {
      s = {
        canvas: new WeakRef(gl.canvas), attrs: gl.getContextAttributes?.() ?? {}, lost: false,
        textures: new Map(), buffers: new Map(), renderbuffers: new Map(),
        bound: new Map(), unit: 0, boundBuffer: new Map(), boundRb: null, label: "",
      };
      glOf.set(gl, s);
      contexts.add(new WeakRef(s));
    }
    return s;
  }

  const boundTexture = (s, target) => s.bound.get(`${s.unit}:${target === GL.TEXTURE_2D ? GL.TEXTURE_2D : target >= GL.TEXTURE_CUBE_MAP_POSITIVE_X && target <= GL.TEXTURE_CUBE_MAP_NEGATIVE_Z ? GL.TEXTURE_CUBE_MAP : target}`);
  const setLevel = (s, target, level, bytes, shape) => {
    const texture = boundTexture(s, target);
    if (!texture) return;
    if (level === 0 && shape) texture.__memlab = shape;
    const levels = s.textures.get(texture) ?? new Map();
    levels.set(`${target}:${level}`, bytes);
    s.textures.set(texture, levels);
  };

  function wrap(proto, name, after) {
    const original = proto[name];
    if (typeof original !== "function") return;
    proto[name] = function (...args) {
      const result = original.apply(this, args);
      try { after(state(this), args, result, this); } catch { /* counting must never break the page */ }
      return result;
    };
  }

  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    wrap(proto, "createTexture", (s, _a, texture) => texture && s.textures.set(texture, new Map()));
    wrap(proto, "deleteTexture", (s, [texture]) => s.textures.delete(texture));
    wrap(proto, "activeTexture", (s, [unit]) => { s.unit = unit - GL.TEXTURE0; });
    wrap(proto, "bindTexture", (s, [target, texture]) => s.bound.set(`${s.unit}:${target}`, texture));
    wrap(proto, "texImage2D", (s, args) => {
      const [target, level, internal] = args;
      let w; let h; let format; let type;
      if (args.length >= 8) [, , , w, h, , format, type] = args;
      else { [, , , format, type] = args; [w, h] = sourceSize(args[5]); }
      const bytes = args.length >= 8 && internal !== format && internalBytes(internal) !== 4 ? internalBytes(internal) : unpackBytes(format, type);
      setLevel(s, target, level, w * h * bytes, `${w}x${h}x${bytes}`);
    });
    wrap(proto, "texStorage2D", (s, [target, levels, internal, w, h]) => {
      for (let level = 0; level < levels; level += 1) {
        setLevel(s, target, level, Math.max(1, w >> level) * Math.max(1, h >> level) * internalBytes(internal) * (target === GL.TEXTURE_CUBE_MAP ? 6 : 1), `${w}x${h}x${internalBytes(internal)}`);
      }
    });
    wrap(proto, "texImage3D", (s, [target, level, internal, w, h, d]) => setLevel(s, target, level, w * h * d * internalBytes(internal)));
    wrap(proto, "texStorage3D", (s, [target, levels, internal, w, h, d]) => {
      for (let level = 0; level < levels; level += 1) setLevel(s, target, level, Math.max(1, w >> level) * Math.max(1, h >> level) * d * internalBytes(internal));
    });
    wrap(proto, "compressedTexImage2D", (s, [target, level, , , , , data]) => setLevel(s, target, level, data?.byteLength ?? 0));
    wrap(proto, "copyTexImage2D", (s, [target, level, , , , w, h]) => setLevel(s, target, level, w * h * 4));
    wrap(proto, "generateMipmap", (s, [target]) => {
      const texture = boundTexture(s, target);
      const levels = texture && s.textures.get(texture);
      const base = levels?.get(`${target}:0`);
      if (base) levels.set(`${target}:mips`, Math.round(base / 3));
    });
    wrap(proto, "createBuffer", (s, _a, buffer) => buffer && s.buffers.set(buffer, 0));
    wrap(proto, "deleteBuffer", (s, [buffer]) => s.buffers.delete(buffer));
    wrap(proto, "bindBuffer", (s, [target, buffer]) => s.boundBuffer.set(target, buffer));
    wrap(proto, "bufferData", (s, [target, data]) => {
      const buffer = s.boundBuffer.get(target);
      if (buffer) s.buffers.set(buffer, typeof data === "number" ? data : data?.byteLength ?? 0);
    });
    wrap(proto, "createRenderbuffer", (s, _a, rb) => rb && s.renderbuffers.set(rb, 0));
    wrap(proto, "deleteRenderbuffer", (s, [rb]) => s.renderbuffers.delete(rb));
    wrap(proto, "bindRenderbuffer", (s, [, rb]) => { s.boundRb = rb; });
    wrap(proto, "renderbufferStorage", (s, [, internal, w, h]) => s.boundRb && s.renderbuffers.set(s.boundRb, w * h * internalBytes(internal)));
    wrap(proto, "renderbufferStorageMultisample", (s, [, samples, internal, w, h]) => s.boundRb && s.renderbuffers.set(s.boundRb, w * h * internalBytes(internal) * samples));
    wrap(proto, "getExtension", (s, [name], ext) => {
      if (name !== "WEBGL_lose_context" || !ext || ext.__memlab) return;
      const lose = ext.loseContext.bind(ext);
      ext.loseContext = () => { s.lost = true; made.lost += 1; lose(); };
      ext.__memlab = true;
    });
  }

  const trackCanvas = (canvas) => { canvases.add(new WeakRef(canvas)); made.canvas += 1; };
  for (const Canvas of [HTMLCanvasElement, typeof OffscreenCanvas === "undefined" ? null : OffscreenCanvas]) {
    if (!Canvas) continue;
    const getContext = Canvas.prototype.getContext;
    Canvas.prototype.getContext = function (type, ...rest) {
      const ctx = getContext.call(this, type, ...rest);
      if (ctx && !this.__memlab) {
        this.__memlab = type;
        this.__memlabFrom = (new Error().stack ?? "").split("\n").slice(1, 8)
          .map((line) => { const m = line.match(/^(.*?)@.*\/([\w.-]+?)(?:\.[jt]s|\.svelte)?(?:\?[^:]*)?:(\d+):\d+$/); return m ? `${m[1] || "?"}@${m[2]}` : ""; })
          .filter((f) => f && !/memlab|getContext/.test(f)).slice(0, 3).join("<");
        trackCanvas(this);
        if (/webgl/.test(type)) { made.gl += 1; state(ctx); }
      }
      return ctx;
    };
  }

  if (typeof createImageBitmap === "function") {
    const original = createImageBitmap;
    window.createImageBitmap = function (...args) {
      return original.apply(this, args).then((bitmap) => { bitmaps.add(new WeakRef(bitmap)); made.bitmap += 1; return bitmap; });
    };
  }

  const sum = (map) => { let n = 0; for (const v of map.values()) n += typeof v === "number" ? v : sum(v); return n; };
  function snapshot() {
    let textures = 0; let buffers = 0; let renderbuffers = 0; let drawing = 0; let liveGl = 0; let textureCount = 0;
    const perContext = [];
    for (const ref of contexts) {
      const s = ref.deref();
      const canvas = s?.canvas.deref();
      if (!s || !canvas || s.lost) { contexts.delete(ref); continue; }
      liveGl += 1;
      const t = sum(s.textures); const b = sum(s.buffers); const r = sum(s.renderbuffers);
      // Front and back buffer, depth/stencil, and 4x samples when antialiased.
      const px = canvas.width * canvas.height;
      const d = px * 4 * 2 + (s.attrs.depth || s.attrs.stencil ? px * 4 : 0) + (s.attrs.antialias ? px * 4 * 4 : 0);
      textures += t; buffers += b; renderbuffers += r; drawing += d; textureCount += s.textures.size;
      const shapes = {};
      for (const [texture, levels] of s.textures) {
        const key = texture.__memlab ?? "?";
        shapes[key] = shapes[key] ?? { n: 0, mb: 0 };
        shapes[key].n += 1; shapes[key].mb += sum(levels) / MB;
      }
      for (const v of Object.values(shapes)) v.mb = +v.mb.toFixed(1);
      perContext.push({ rb: +(r / MB).toFixed(1), shapes,  id: canvas.className || canvas.parentElement?.className || "?", w: canvas.width, h: canvas.height, attached: canvas.isConnected ?? false, tex: +(t / MB).toFixed(1), n: s.textures.size, buf: +(b / MB).toFixed(1) });
    }
    let canvas2d = 0; let canvasCount = 0;
    const canvasCensus = {};
    for (const ref of canvases) {
      const c = ref.deref();
      if (!c) { canvases.delete(ref); continue; }
      if (c.__memlab === "2d" || c.__memlab === "bitmaprenderer") {
        const bytes = c.width * c.height * 4;
        canvas2d += bytes; canvasCount += bytes > 0 ? 1 : 0;
        if (bytes > 0) {
          const key = `${c.width}x${c.height} ${c.isConnected ? "on" : "off"} ${c.className || c.parentElement?.className || (c instanceof HTMLCanvasElement ? "-" : "offscreen")} ${c.__memlabFrom ?? ""}`;
          canvasCensus[key] = canvasCensus[key] ?? { n: 0, mb: 0 };
          canvasCensus[key].n += 1; canvasCensus[key].mb = +(canvasCensus[key].mb + bytes / MB).toFixed(1);
        }
      }
    }
    let bitmapBytes = 0; let bitmapCount = 0;
    for (const ref of bitmaps) {
      const b = ref.deref();
      if (!b || !b.width) { bitmaps.delete(ref); continue; }
      bitmapBytes += b.width * b.height * 4; bitmapCount += 1;
    }
    const gpu = textures + buffers + renderbuffers + drawing + canvas2d + bitmapBytes;
    return {
      gpuMB: +(gpu / MB).toFixed(1),
      texMB: +(textures / MB).toFixed(1), textures: textureCount,
      bufMB: +((buffers + renderbuffers) / MB).toFixed(1),
      drawMB: +(drawing / MB).toFixed(1), contexts: liveGl,
      canvas2dMB: +(canvas2d / MB).toFixed(1), canvases: canvasCount,
      bitmapMB: +(bitmapBytes / MB).toFixed(1), bitmaps: bitmapCount,
      dom: document.getElementsByTagName("*").length,
      made: { ...made },
      perContext,
      canvasCensus,
    };
  }

  window.__memlab = { snapshot };
})();
