// Magnipico engine: tiled upscaling in a Web Worker (ONNX Runtime Web, WebGPU with WASM fallback).
import * as ort from './vendor/ort/ort.webgpu.min.mjs';

ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = 'error';

const MODEL_SCALE = 4;
const PAD = 16;
const MAX_SIDE = 16384;
const MAX_AREA = 268000000;

let session = null;      // { key, sess, backend }
let cancelled = false;
let busy = false;

class Cancelled extends Error {}

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function gpuAvailable() {
  try {
    if (!navigator.gpu) return false;
    return !!(await navigator.gpu.requestAdapter());
  } catch { return false; }
}

async function fetchModel(file, id) {
  const res = await fetch(new URL(`./models/${file}`, import.meta.url));
  if (!res.ok) throw new Error(`Could not download the model (${res.status}).`);
  // Content-Length is the compressed size when the host gzips, so only trust it for uncompressed responses.
  const total = res.headers.get('Content-Encoding') ? 0 : +res.headers.get('Content-Length') || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: 'model-progress', id, loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf;
}

async function getSession(model, backendPref, id) {
  let backend = backendPref;
  if (backend !== 'cpu') backend = (await gpuAvailable()) ? 'gpu' : 'cpu';
  const key = `${model}|${backend}`;
  if (session && session.key === key) return session;
  if (session) { try { await session.sess.release(); } catch {} session = null; }
  post({ type: 'status', id, text: 'Loading model…' });
  const bytes = await fetchModel(model, id);
  post({ type: 'status', id, text: 'Starting engine…' });
  let sess;
  if (backend === 'gpu') {
    try {
      sess = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
    } catch (e) {
      console.warn('WebGPU session failed, falling back to CPU', e);
      backend = 'cpu';
    }
  }
  if (!sess) sess = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  session = { key: `${model}|${backend}`, sess, backend };
  return session;
}

const tileCount = (h, w, tile) => Math.ceil(h / (tile - 2 * PAD)) * Math.ceil(w / (tile - 2 * PAD));

// Mirror coordinates at the image border so edge tiles have real context.
function reflectIndex(i, n) {
  if (i < 0) i = -i;
  if (i >= n) i = 2 * n - 2 - i;
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/** 4x tiled upscale. src: ImageData-like {data,width,height}. Returns an OffscreenCanvas. */
async function upscalePass(s, src, tile, onTile) {
  const { data, width: w, height: h } = src;
  const core = tile - 2 * PAD;
  const ny = Math.ceil(h / core), nx = Math.ceil(w / core);
  const out = new OffscreenCanvas(w * MODEL_SCALE, h * MODEL_SCALE);
  const octx = out.getContext('2d', { willReadFrequently: true });
  const plane = tile * tile;
  const input = new Float32Array(3 * plane);
  const xs = new Int32Array(tile), ys = new Int32Array(tile);
  const ot = tile * MODEL_SCALE, oplane = ot * ot, op = PAD * MODEL_SCALE;
  const inName = s.sess.inputNames[0], outName = s.sess.outputNames[0];

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (cancelled) throw new Cancelled();
      const y0 = iy * core, x0 = ix * core;
      for (let t = 0; t < tile; t++) {
        ys[t] = reflectIndex(y0 - PAD + t, h);
        xs[t] = reflectIndex(x0 - PAD + t, w);
      }
      for (let ty = 0; ty < tile; ty++) {
        const row = ys[ty] * w;
        let o = ty * tile;
        for (let tx = 0; tx < tile; tx++, o++) {
          const p = (row + xs[tx]) * 4;
          input[o] = data[p] / 255;
          input[o + plane] = data[p + 1] / 255;
          input[o + 2 * plane] = data[p + 2] / 255;
        }
      }
      const feeds = { [inName]: new ort.Tensor('float32', input, [1, 3, tile, tile]) };
      const result = await s.sess.run(feeds);
      const y = result[outName].data;
      const ch = Math.min(core, h - y0) * MODEL_SCALE, cw = Math.min(core, w - x0) * MODEL_SCALE;
      const img = new ImageData(cw, ch);
      const d = img.data;
      for (let r = 0; r < ch; r++) {
        let si = (r + op) * ot + op;
        let di = r * cw * 4;
        for (let c = 0; c < cw; c++, si++, di += 4) {
          d[di] = y[si] * 255 + 0.5;
          d[di + 1] = y[si + oplane] * 255 + 0.5;
          d[di + 2] = y[si + 2 * oplane] * 255 + 0.5;
          d[di + 3] = 255;
        }
      }
      octx.putImageData(img, x0 * MODEL_SCALE, y0 * MODEL_SCALE);
      result[outName].dispose?.();
      onTile();
    }
  }
  return out;
}

/** Unsharp mask + film grain, applied in horizontal strips to keep memory flat. */
function postProcess(ctx, w, h, sharpen, grain) {
  if (sharpen <= 0 && grain <= 0) return;
  const amount = sharpen * 1.6;
  const gAmp = grain * 26;
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const STRIP = 256;
  for (let y = 0; y < h; y += STRIP) {
    if (cancelled) throw new Cancelled();
    const n = Math.min(STRIP, h - y);
    const top = y > 0 ? 1 : 0, bottom = y + n < h ? 1 : 0;
    const srcImg = ctx.getImageData(0, y - top, w, n + top + bottom);
    const s = srcImg.data;
    const dstImg = new ImageData(w, n);
    const d = dstImg.data;
    const rows = n + top + bottom;
    for (let r = 0; r < n; r++) {
      const rc = r + top;
      const ru = Math.max(0, rc - 1), rd = Math.min(rows - 1, rc + 1);
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : 0, xr = x < w - 1 ? x + 1 : x;
        const c = (rc * w + x) * 4, o = (r * w + x) * 4;
        const g = gAmp ? (rnd() + rnd() + rnd() - 1.5) * gAmp : 0;
        for (let k = 0; k < 3; k++) {
          let v = s[c + k];
          if (amount) {
            const blur = (4 * v
              + 2 * (s[(rc * w + xl) * 4 + k] + s[(rc * w + xr) * 4 + k] + s[(ru * w + x) * 4 + k] + s[(rd * w + x) * 4 + k])
              + s[(ru * w + xl) * 4 + k] + s[(ru * w + xr) * 4 + k] + s[(rd * w + xl) * 4 + k] + s[(rd * w + xr) * 4 + k]) / 16;
            v += amount * (v - blur);
          }
          d[o + k] = v + g;
        }
        d[o + 3] = s[c + 3];
      }
    }
    ctx.putImageData(dstImg, 0, y);
  }
}

function hasAlpha(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

async function run(job) {
  const { id, file, settings: st, crop } = job;
  let source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  if (crop) {
    const c = new OffscreenCanvas(crop.w, crop.h);
    c.getContext('2d').drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    source.close();
    source = c.transferToImageBitmap();
  }
  const w = source.width, h = source.height;
  const tw = Math.max(1, Math.round(w * st.scale)), th = Math.max(1, Math.round(h * st.scale));
  if (tw > MAX_SIDE || th > MAX_SIDE || tw * th > MAX_AREA) {
    throw new Error(`Result would be ${tw} × ${th}, which is larger than a browser can hold. Pick a smaller scale.`);
  }

  const s = await getSession(st.model, st.backend, id);
  const tile = s.backend === 'gpu' ? 256 : 96;
  post({ type: 'status', id, text: s.backend === 'gpu' ? 'Upscaling on GPU…' : 'Upscaling on CPU (slow; Chrome or Edge with a GPU is much faster)…', backend: s.backend });

  const srcCanvas = new OffscreenCanvas(w, h);
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(source, 0, 0);
  const srcData = sctx.getImageData(0, 0, w, h);
  const alpha = hasAlpha(srcData.data);

  const twoPass = st.scale > MODEL_SCALE;
  const mw = Math.ceil(tw / MODEL_SCALE), mh = Math.ceil(th / MODEL_SCALE);
  const total = tileCount(h, w, tile) + (twoPass ? tileCount(mh, mw, tile) : 0);
  let done = 0;
  const onTile = () => post({ type: 'progress', id, frac: ++done / total });

  let out = await upscalePass(s, srcData, tile, onTile);
  if (twoPass) {
    const mid = new OffscreenCanvas(mw, mh);
    const mctx = mid.getContext('2d', { willReadFrequently: true });
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(out, 0, 0, mw, mh);
    out = await upscalePass(s, mctx.getImageData(0, 0, mw, mh), tile, onTile);
  }

  post({ type: 'status', id, text: 'Finishing…' });
  let final = out;
  if (out.width !== tw || out.height !== th) {
    final = new OffscreenCanvas(tw, th);
    const f = final.getContext('2d');
    f.imageSmoothingQuality = 'high';
    f.drawImage(out, 0, 0, tw, th);
  }
  const fctx = final.getContext('2d', { willReadFrequently: true });
  fctx.imageSmoothingQuality = 'high';
  if (st.strength < 0.999) {
    fctx.globalAlpha = 1 - st.strength;
    fctx.drawImage(source, 0, 0, tw, th);
    fctx.globalAlpha = 1;
  }
  postProcess(fctx, tw, th, st.sharpen, st.grain);
  if (alpha) {
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(source, 0, 0, tw, th);
    fctx.globalCompositeOperation = 'source-over';
  }

  if (crop) {
    const after = final.transferToImageBitmap();
    post({ type: 'preview', id, before: source, after }, [source, after]);
    return;
  }
  source.close();
  let enc = final;
  if (alpha && st.format === 'image/jpeg') {
    enc = new OffscreenCanvas(tw, th);
    const e = enc.getContext('2d');
    e.fillStyle = '#fff';
    e.fillRect(0, 0, tw, th);
    e.drawImage(final, 0, 0);
  }
  post({ type: 'status', id, text: 'Encoding image…' });
  const blob = await enc.convertToBlob({ type: st.format, quality: 0.95 });
  const bitmap = final.transferToImageBitmap();
  post({ type: 'done', id, blob, bitmap, width: tw, height: th }, [bitmap]);
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type === 'probe') { post({ type: 'probe', gpu: await gpuAvailable() }); return; }
  if (msg.type !== 'run' || busy) return;
  busy = true;
  cancelled = false;
  try {
    await run(msg);
  } catch (err) {
    if (err instanceof Cancelled) post({ type: 'cancelled', id: msg.id });
    else {
      console.error(err);
      post({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) });
    }
  } finally {
    busy = false;
  }
};
