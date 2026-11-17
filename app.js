// Magnipico UI
const MODELS = [
  { file: 'sharp-photo-x4.onnx', name: 'Sharp photo', size: 67, desc: 'Best for most photos. Keeps natural texture and fine detail. 67 MB, downloaded once.' },
  { file: 'web-photo-x4.onnx', name: 'Web photo', size: 30, desc: 'For blurry, compressed or low-quality photos from the web or chat apps. 30 MB.' },
  { file: 'fast-x4.onnx', name: 'Fast', size: 5, desc: 'About 10x faster. Cleaner and smoother, less fine detail. 5 MB.' },
  { file: 'art-x4.onnx', name: 'Art & anime', size: 18, desc: 'For illustrations, line art, logos and anime. 18 MB.' },
];
const SCALES = [2, 3, 4, 6, 8];
const PREVIEW_SRC = 224; // one tile, so previews are quick
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DEFAULTS = { model: MODELS[0].file, scale: 4, strength: 100, sharpen: 0, grain: 10, format: 'image/png', backend: 'auto' };

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('magnipico.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('magnipico.' + k, JSON.stringify(v)); } catch {} },
};

const isPhone = matchMedia('(pointer: coarse) and (max-width: 860px)').matches;
if (isPhone) DEFAULTS.model = 'fast-x4.onnx'; // phones start on the light model
const settings = { ...DEFAULTS, ...store.get('settings', {}) };
if (!MODELS.some((m) => m.file === settings.model)) settings.model = DEFAULTS.model;

const state = { items: [], current: null, running: false, preview: false, nextId: 1 };

// ------------------------------------------------------------------ compare view
const view = {
  canvas: $('view'), ctx: $('view').getContext('2d'),
  before: null, after: null, zoom: 1, ox: 0, oy: 0, split: 0.5, drag: null, last: null,
  get w() { return this.canvas.clientWidth; },
  get h() { return this.canvas.clientHeight; },
  size() { const i = this.after || this.before; return i ? [i.width, i.height] : [1, 1]; },
  set(before, after, ownsAfter = false) {
    if (this.before && this.before !== before) this.before.close?.();
    if (this.ownsAfter && this.after && this.after !== after) this.after.close?.();
    this.before = before; this.after = after; this.ownsAfter = ownsAfter;
    $('emptyState').hidden = !!before;
    this.fit();
  },
  fit() {
    const [iw, ih] = this.size();
    this.zoom = Math.min((this.w - 24) / iw, (this.h - 24) / ih);
    this.ox = (this.w - iw * this.zoom) / 2;
    this.oy = (this.h - ih * this.zoom) / 2;
    this.draw();
  },
  center() {
    const [iw, ih] = this.size();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    return [clamp((this.w / 2 - this.ox) / (iw * this.zoom)), clamp((this.h / 2 - this.oy) / (ih * this.zoom))];
  },
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(this.w * dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * dpr));
    if (this.before) this.fit(); else this.draw();
  },
  draw() {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.before) return;
    const [iw, ih] = this.size();
    const dw = iw * this.zoom, dh = ih * this.zoom;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!this.after) { ctx.drawImage(this.before, this.ox, this.oy, dw, dh); return; }
    const sx = this.w * this.split;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, sx, this.h); ctx.clip();
    ctx.drawImage(this.before, this.ox, this.oy, dw, dh);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(sx, 0, this.w - sx, this.h); ctx.clip();
    ctx.imageSmoothingEnabled = this.zoom < 1;
    ctx.drawImage(this.after, this.ox, this.oy, dw, dh);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(sx - 2, 0, 4, this.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 1, 0, 2, this.h);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, this.h / 2, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#15141a';
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('↔', sx, this.h / 2 + 1);
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    for (const [text, left] of [['Original', true], ['Upscaled', false]]) {
      const tw = ctx.measureText(text).width + 16;
      const x = left ? sx - tw - 10 : sx + 10;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.beginPath(); ctx.roundRect(x, 10, tw, 22, 3); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x + tw / 2, 21.5);
    }
  },
  nearSplit(x, touch) { return this.after && Math.abs(x - this.w * this.split) < (touch ? 26 : 14); },
  init() {
    const c = this.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pts = new Map();
    const pinchInfo = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; };
    let pinch = null;
    c.addEventListener('pointerdown', (e) => {
      if (!this.before || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const [x, y] = pos(e);
      pts.set(e.pointerId, [x, y]);
      c.setPointerCapture(e.pointerId);
      if (pts.size === 2) { this.drag = 'pinch'; pinch = { ...pinchInfo(), zoom: this.zoom, ox: this.ox, oy: this.oy }; return; }
      this.drag = this.nearSplit(x, e.pointerType !== 'mouse') ? 'split' : 'pan';
      this.last = [x, y];
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [x, y]);
      if (this.drag === 'pinch' && pts.size === 2) {
        const now = pinchInfo();
        const nz = Math.min(64, Math.max(0.01, pinch.zoom * now.d / pinch.d));
        const k = nz / pinch.zoom;
        this.ox = now.mx - (pinch.mx - pinch.ox) * k; this.oy = now.my - (pinch.my - pinch.oy) * k; this.zoom = nz;
        this.draw();
      } else if (this.drag === 'split') { this.split = Math.min(1, Math.max(0, x / this.w)); this.draw(); }
      else if (this.drag === 'pan') { this.ox += x - this.last[0]; this.oy += y - this.last[1]; this.last = [x, y]; this.draw(); }
      else c.style.cursor = this.nearSplit(x) ? 'ew-resize' : this.before ? 'grab' : 'default';
    });
    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 1 && this.drag === 'pinch') { this.drag = 'pan'; this.last = [...pts.values()][0]; }
      else if (pts.size === 0) this.drag = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => this.before && this.fit());
    c.addEventListener('wheel', (e) => {
      if (!this.before) return;
      e.preventDefault();
      const [x, y] = pos(e);
      const nz = Math.min(64, Math.max(0.01, this.zoom * Math.pow(1.2, -e.deltaY / 100)));
      const k = nz / this.zoom;
      this.ox = x - (x - this.ox) * k; this.oy = y - (y - this.oy) * k; this.zoom = nz;
      this.draw();
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe($('viewWrap'));
  },
};

// ------------------------------------------------------------------ settings UI
function initSettings() {
  const model = $('model');
  for (const m of MODELS) model.add(new Option(m.name, m.file));
  model.value = settings.model;
  const showDesc = () => { $('modelDesc').textContent = MODELS.find((m) => m.file === model.value).desc; };
  model.onchange = () => { settings.model = model.value; showDesc(); save(); };
  showDesc();

  const seg = $('scale');
  for (const s of SCALES) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s + 'x'; b.dataset.v = s; b.setAttribute('role', 'radio');
    b.onclick = () => { settings.scale = s; syncScale(); save(); updateInfo(); };
    seg.append(b);
  }
  const syncScale = () => { for (const b of seg.children) b.setAttribute('aria-checked', String(+b.dataset.v === settings.scale)); };
  syncScale();

  for (const k of ['strength', 'sharpen', 'grain']) {
    const el = $(k), out = $(k + 'Out');
    el.value = settings[k];
    const show = () => { out.textContent = el.value + '%'; };
    el.oninput = () => { settings[k] = +el.value; show(); save(); };
    show();
  }
  for (const k of ['format', 'backend']) {
    $(k).value = settings[k];
    $(k).onchange = () => { settings[k] = $(k).value; save(); };
  }
}
const save = () => store.set('settings', settings);
const jobSettings = () => ({
  model: settings.model, scale: settings.scale, strength: settings.strength / 100,
  sharpen: settings.sharpen / 100, grain: settings.grain / 100, format: settings.format, backend: settings.backend,
});

// ------------------------------------------------------------------ queue
const ICON_SAVE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const fmtSize = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');

async function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(f.name));
  if (!list.length) return;
  let first = null, failed = 0;
  for (const file of list) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const item = { id: state.nextId++, file, name: file.name || 'pasted-image.png', w: bmp.width, h: bmp.height, thumb: URL.createObjectURL(file), result: null, error: null };
      bmp.close();
      state.items.push(item);
      first = first || item;
    } catch { failed++; }
  }
  renderQueue();
  if (first) select(first);
  if (failed) setStatus(`${failed} file(s) could not be opened as images.`);
}

function renderQueue() {
  const ul = $('queue');
  ul.replaceChildren();
  for (const it of state.items) {
    const li = document.createElement('li');
    li.className = it === state.current ? 'active' : '';
    li.onclick = () => select(it);
    const img = document.createElement('img');
    img.src = it.thumb; img.alt = '';
    const mid = document.createElement('div');
    mid.style.minWidth = '0';
    const name = document.createElement('div');
    name.className = 'q-name'; name.textContent = it.name; name.title = it.name;
    const meta = document.createElement('div');
    meta.className = 'q-meta' + (it.result ? ' done' : it.error ? ' fail' : '');
    meta.textContent = it.result ? `${it.result.w} × ${it.result.h} · ${fmtSize(it.result.blob.size)}`
      : it.error ? 'Failed' : `${it.w} × ${it.h}`;
    if (it.error) meta.title = it.error;
    mid.append(name, meta);
    const btns = document.createElement('div');
    btns.className = 'q-btns';
    if (it.result) {
      const d = document.createElement('button');
      d.className = 'icon-btn'; d.innerHTML = ICON_SAVE; d.title = 'Save upscaled image'; d.setAttribute('aria-label', 'Save upscaled image');
      d.onclick = (e) => { e.stopPropagation(); download(it); };
      btns.append(d);
    }
    const x = document.createElement('button');
    x.className = 'icon-btn'; x.innerHTML = ICON_X; x.title = 'Remove'; x.setAttribute('aria-label', 'Remove');
    x.onclick = (e) => { e.stopPropagation(); removeItem(it); };
    btns.append(x);
    li.append(img, mid, btns);
    ul.append(li);
  }
  $('dropHint').hidden = state.items.length > 0;
  $('saveAllBtn').disabled = !state.items.some((i) => i.result);
  updateButtons();
}

async function select(item) {
  state.current = item;
  state.preview = false;
  renderQueue();
  if (!item) { view.set(null, null); updateInfo(); return; }
  try {
    const before = await createImageBitmap(item.file, { imageOrientation: 'from-image' });
    if (state.current !== item) { before.close(); return; }
    view.set(before, item.result ? item.result.bitmap : null);
  } catch (e) { setStatus('Could not open ' + item.name); }
  updateInfo();
}

function removeItem(it) {
  if (state.running) return;
  URL.revokeObjectURL(it.thumb);
  it.result?.bitmap.close?.();
  state.items = state.items.filter((i) => i !== it);
  if (state.current === it) select(state.items[0] || null); else renderQueue();
}

function updateInfo() {
  const it = state.current;
  if (!it) { $('info').textContent = ''; return; }
  const tw = Math.round(it.w * settings.scale), th = Math.round(it.h * settings.scale);
  let t = `${it.w} × ${it.h}  →  ${tw} × ${th}  (${(tw * th / 1e6).toFixed(1)} MP)`;
  if (state.preview) t += '  ·  area preview (pick the image in the list to go back)';
  $('info').textContent = t;
}

const outName = (it) => `${it.name.replace(/\.[^.]+$/, '')}_${it.result.scale}x.${EXT[it.result.blob.type] || 'png'}`;

function download(it) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(it.result.blob);
  a.download = outName(it);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

async function saveAll() {
  const done = state.items.filter((i) => i.result);
  if (!done.length) return;
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const it of done) {
        const fh = await dir.getFileHandle(outName(it), { create: true });
        const ws = await fh.createWritable();
        await ws.write(it.result.blob);
        await ws.close();
      }
      setStatus(`Saved ${done.length} image(s) to “${dir.name}”.`);
    } catch (e) { if (e.name !== 'AbortError') setStatus('Could not save: ' + e.message); }
    return;
  }
  for (const it of done) { download(it); await new Promise((r) => setTimeout(r, 400)); }
}

// ------------------------------------------------------------------ engine
const worker = new Worker('worker.js', { type: 'module' });
let pending = null; // { resolve, reject, onProgress }

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'probe') {
    const b = $('engineBadge');
    b.textContent = m.gpu ? 'Running on GPU' : 'CPU mode (slow)';
    b.className = 'engine ' + (m.gpu ? 'ok' : 'warn');
    if (!m.gpu) b.title = 'No WebGPU found. Use a recent Chrome or Edge on a computer with a GPU for much faster results.';
    return;
  }
  if (!pending) return;
  if (m.type === 'status') setStatus(m.text, true);
  else if (m.type === 'model-progress') setStatus(`Downloading model… ${fmtSize(m.loaded)}${m.total ? ' of ' + fmtSize(m.total) : ''} (first time only)`, true);
  else if (m.type === 'progress') pending.onProgress(m.frac);
  else if (m.type === 'done' || m.type === 'preview') { const p = pending; pending = null; p.resolve(m); }
  else if (m.type === 'cancelled') { const p = pending; pending = null; p.reject(Object.assign(new Error('cancelled'), { cancelled: true })); }
  else if (m.type === 'error') { const p = pending; pending = null; p.reject(new Error(m.message)); }
};
worker.onerror = (e) => {
  if (pending) { const p = pending; pending = null; p.reject(new Error(e.message || 'The engine stopped unexpectedly.')); }
};

function runJob(item, crop, onProgress) {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject, onProgress };
    worker.postMessage({ type: 'run', id: item.id, file: item.file, settings: jobSettings(), crop });
  });
}

let statusPrefix = '';
function setStatus(text, withPrefix) { $('status').textContent = (withPrefix ? statusPrefix : '') + text; }
function setBar(f) { $('bar').style.width = Math.round(f * 100) + '%'; }
const fmtTime = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

function updateButtons() {
  const has = state.items.length > 0, cur = !!state.current, run = state.running;
  $('previewBtn').disabled = run || !cur;
  $('runBtn').disabled = run || !cur;
  $('runAllBtn').disabled = run || !has;
  $('cancelBtn').disabled = !run;
  for (const id of ['model', 'format', 'backend', 'clearBtn']) $(id).disabled = run;
  for (const b of $('scale').children) b.disabled = run;
}

async function runItems(items) {
  if (state.running || !items.length) return;
  state.running = true;
  updateButtons();
  const t0 = performance.now();
  let ok = 0, fail = 0, cancelled = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    statusPrefix = items.length > 1 ? `Image ${i + 1} of ${items.length}: ` : '';
    let tStart = 0;
    try {
      const scale = settings.scale;
      const m = await runJob(it, null, (f) => {
        if (!tStart) tStart = performance.now() - 1;
        setBar((i + f) / items.length);
        const left = (performance.now() - tStart) / 1000 * (1 - f) / Math.max(f, 1e-6);
        setStatus(`Upscaling… ${Math.round(f * 100)}%${f > 0.03 && f < 1 ? ` · about ${fmtTime(left)} left` : ''}`, true);
      });
      it.result?.bitmap.close?.();
      it.result = { blob: m.blob, bitmap: m.bitmap, w: m.width, h: m.height, scale };
      it.error = null;
      ok++;
      if (state.current === it) await select(it); else renderQueue();
    } catch (e) {
      if (e.cancelled) { cancelled = true; break; }
      it.error = e.message; fail++;
      renderQueue();
    }
  }
  state.running = false;
  statusPrefix = '';
  updateButtons();
  renderQueue();
  const secs = (performance.now() - t0) / 1000;
  if (cancelled) { setBar(0); setStatus('Cancelled.'); }
  else if (fail) { setStatus(`${ok} done, ${fail} failed: ${items.find((i) => i.error)?.error || ''}`); }
  else { setBar(1); setStatus(`Done in ${fmtTime(secs)}. Save from the list, or use Save all.`); }
}

async function runPreview() {
  const it = state.current;
  if (state.running || !it) return;
  if (!state.preview) state.previewCenter = view.center(); // while a preview is showing, redo the same area
  const [cx, cy] = state.previewCenter;
  const size = PREVIEW_SRC;
  const cw = Math.min(size, it.w), ch = Math.min(size, it.h);
  const crop = {
    x: Math.round(Math.min(Math.max(0, cx * it.w - cw / 2), it.w - cw)),
    y: Math.round(Math.min(Math.max(0, cy * it.h - ch / 2), it.h - ch)), w: cw, h: ch,
  };
  state.running = true;
  updateButtons();
  setBar(0);
  const t0 = performance.now();
  try {
    const m = await runJob(it, crop, (f) => { setBar(f); setStatus(`Previewing… ${Math.round(f * 100)}%`); });
    if (state.current === it) {
      state.preview = true;
      view.set(m.before, m.after, true);
      updateInfo();
    }
    setBar(1);
    setStatus(`Preview ready in ${fmtTime((performance.now() - t0) / 1000)}. Drag the line to compare.`);
  } catch (e) {
    setBar(0);
    setStatus(e.cancelled ? 'Cancelled.' : 'Preview failed: ' + e.message);
  }
  state.running = false;
  updateButtons();
}

// ------------------------------------------------------------------ onboarding tour
const TOUR = [
  { title: 'Welcome to Magnipico', text: 'Make small images bigger and sharper. Everything happens on your own device, so your images are never uploaded. This takes about 30 seconds.' },
  { el: 'queuePanel', title: 'Add your images', text: 'Choose images, drop them anywhere in the window, or paste one from the clipboard. Add as many as you like.' },
  { el: 'modelGroup', title: 'Pick a model', text: 'Sharp photo suits most photos. Try Web photo for blurry or compressed pictures, Art & anime for drawings, and Fast when you are in a hurry.' },
  { el: 'scaleGroup', title: 'Choose how big', text: 'From 2x up to 8x. The new size is shown above the image.' },
  { el: 'lookGroup', title: 'Tune the look', text: 'If a result looks too smooth, lower the strength and add a little grain. Sharpen adds extra bite.' },
  { el: 'previewBtn', title: 'Preview before you commit', text: 'Zoom into the part you care about and press this. Only that area is upscaled, so you can check your settings in seconds.' },
  { el: 'viewWrap', title: 'Compare before and after', text: 'Drag the line left and right. Zoom with the scroll wheel or a pinch, drag to move around, double-click to fit.' },
  { el: 'runAllBtn', title: 'Upscale and save', text: 'Press this to process every image, then save them from the list. The first run downloads the model once; after that Magnipico works offline.' },
];
const tour = {
  i: 0, open: false,
  start() {
    this.i = 0; this.open = true;
    $('tourAgain').checked = store.get('tour', null) === 'on';
    $('tour').hidden = false;
    this.show();
    $('tourNext').focus({ preventScroll: true });
  },
  close() {
    this.open = false;
    $('tour').hidden = true;
    const on = $('tourAgain').checked;
    store.set('tour', on ? 'on' : 'off');
    $('tourOnStart').checked = on;
    window.scrollTo({ top: 0 });
  },
  show() {
    const step = TOUR[this.i];
    $('tourStep').textContent = `${this.i + 1} / ${TOUR.length}`;
    $('tourTitle').textContent = step.title;
    $('tourText').textContent = step.text;
    $('tourBack').hidden = this.i === 0;
    $('tourNext').textContent = this.i === TOUR.length - 1 ? 'Done' : 'Next';
    if (step.el) $(step.el).scrollIntoView({ block: window.innerWidth <= 860 ? 'center' : 'nearest' });
    this.place();
  },
  place() {
    if (!this.open) return;
    const step = TOUR[this.i];
    const spot = $('tourSpot'), card = $('tourCard');
    const vw = window.innerWidth, vh = window.innerHeight;
    const narrow = vw <= 860;
    card.style.width = narrow ? vw - 16 + 'px' : '';
    const cw = card.offsetWidth, chh = card.offsetHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (!step.el) {
      Object.assign(spot.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
      Object.assign(card.style, { left: (vw - cw) / 2 + 'px', top: (vh - chh) / 2 + 'px' });
      return;
    }
    const r = $(step.el).getBoundingClientRect();
    const p = narrow ? 3 : 6;
    const sl = Math.max(2, r.left - p), st = Math.max(2, r.top - p);
    Object.assign(spot.style, { left: sl + 'px', top: st + 'px', width: Math.min(vw - 2, r.right + p) - sl + 'px', height: Math.min(vh - 2, r.bottom + p) - st + 'px' });
    if (narrow) { // dock the card to whichever edge is further from the highlighted element
      const below = vh - r.bottom, above = r.top;
      Object.assign(card.style, { left: '8px', top: (below >= above ? vh - chh - 8 : 8) + 'px' });
      return;
    }
    const gap = 16;
    let x, y;
    if (r.right + gap + cw <= vw - 8) { x = r.right + gap; y = r.top; }
    else if (r.left - gap - cw >= 8) { x = r.left - gap - cw; y = r.top; }
    else if (r.bottom + gap + chh <= vh - 8) { x = r.left; y = r.bottom + gap; }
    else if (r.top - gap - chh >= 8) { x = r.left; y = r.top - gap - chh; }
    else { x = r.left + (r.width - cw) / 2; y = r.top + (r.height - chh) / 2; }
    Object.assign(card.style, { left: clamp(x, 8, vw - cw - 8) + 'px', top: clamp(y, 8, vh - chh - 8) + 'px' });
  },
  next() { if (this.i < TOUR.length - 1) { this.i++; this.show(); } else this.close(); },
  back() { if (this.i > 0) { this.i--; this.show(); } },
  init() {
    $('tourNext').onclick = () => this.next();
    $('tourBack').onclick = () => this.back();
    $('tourSkip').onclick = () => this.close();
    $('tourBtn').onclick = () => this.start();
    const box = $('tourOnStart');
    box.checked = store.get('tour', null) === 'on';
    box.onchange = () => store.set('tour', box.checked ? 'on' : 'off');
    window.addEventListener('resize', () => this.place());
    document.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowRight') this.next();
      else if (e.key === 'ArrowLeft') this.back();
    });
    const pref = store.get('tour', null);
    if (pref === null || pref === 'on') this.start();
  },
};

// ------------------------------------------------------------------ theme
function initTheme() {
  const root = document.documentElement;
  const apply = (t) => {
    root.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#15141a' : '#f5f4f9';
  };
  apply(root.dataset.theme || 'light');
  $('themeBtn').onclick = () => {
    const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(t);
    store.set('theme', t);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (store.get('theme', null) === null) apply(e.matches ? 'dark' : 'light');
  });
}

// ------------------------------------------------------------------ wiring
function initInputs() {
  const input = $('fileInput');
  $('addBtn').onclick = $('addBtn2').onclick = () => input.click();
  input.onchange = () => { addFiles(input.files); input.value = ''; };
  $('clearBtn').onclick = () => {
    if (state.running) return;
    for (const it of state.items) { URL.revokeObjectURL(it.thumb); it.result?.bitmap.close?.(); }
    state.items = [];
    select(null);
    setBar(0); setStatus('Ready');
  };
  $('saveAllBtn').onclick = saveAll;
  $('previewBtn').onclick = runPreview;
  $('runBtn').onclick = () => state.current && runItems([state.current]);
  $('runAllBtn').onclick = () => runItems([...state.items]);
  $('cancelBtn').onclick = () => { if (state.running) { setStatus('Cancelling…'); worker.postMessage({ type: 'cancel' }); } };

  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; $('dropOverlay').hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('dropOverlay').hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; $('dropOverlay').hidden = true;
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });
}

function initPwa() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker failed', e));
  }
  let prompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); prompt = e; $('installBtn').hidden = false; });
  $('installBtn').onclick = async () => { if (prompt) { prompt.prompt(); await prompt.userChoice; prompt = null; $('installBtn').hidden = true; } };
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });
}

initTheme();
view.init();
initSettings();
initInputs();
initPwa();
updateButtons();
tour.init();
worker.postMessage({ type: 'probe' });

// small hook for automated checks
window.__magnipico = { state, view, addFiles, runItems, runPreview, tour, settings };
