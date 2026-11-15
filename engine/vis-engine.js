// vis-engine.js — свой движок 360°-туров (VIS_ENGINE_PLAN.md). Бесплатно: three.js (MIT).
// Проект — папка с index.html (5 строк), tour.json (точки, подписи, где данные) и данными: points.json + tiles/*.pack + parts/*.pack (build_cube.py,
// build_parts.py, build_manifest.py) + кадры анимации (anim.json, атласы; anim_cut.py).
// Использование: <script type="importmap">{"imports":{"three":"<engine>/three.module.js"}}</script>
//                <script type="module">import { start } from '<engine>/vis-engine.js'; start('tour.json');</script>
import * as THREE from 'three';
const HTML = "<canvas id=\"c\" aria-label=\"Панорама кухни 360°: перетащите, чтобы осмотреться; нажмите на дверцу или ящик, чтобы открыть\"></canvas>\n<div class=\"top\">\n  <div class=\"card\"><h1 id=\"vTitle\"></h1><p id=\"vDesc\"></p>\n    <button class=\"fold\" id=\"fold\" aria-label=\"Свернуть описание\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M15 18l-6-6 6-6\"/></svg></button></div>\n  <button class=\"ibtn\" id=\"unfold\" aria-label=\"Показать описание\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 18l6-6-6-6\"/></svg></button>\n  <div class=\"tr\"><button class=\"ibtn\" id=\"bStats\" aria-label=\"Статистика\" aria-pressed=\"false\" title=\"Статистика: кадры/с, долгий кадр, память\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 20V10M10 20V4M16 20v-7M22 20H2\"/></svg></button><button class=\"ibtn\" id=\"hideui\" aria-label=\"Скрыть кнопки\" aria-pressed=\"false\"><svg class=\"off\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 3l18 18\"/><path d=\"M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6\"/><path d=\"M9.9 9.9a3 3 0 0 0 4.2 4.2\"/></svg><svg class=\"on\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg></button></div>\n</div>\n<div id=\"spots\"></div>\n<div id=\"hint\">Нажмите на дверцу или ящик</div>\n<div id=\"toast\" role=\"status\" aria-live=\"polite\"></div>\n<div class=\"bottom\">\n  <div class=\"seg\" role=\"group\" aria-label=\"Двери и ящики\">\n    <button id=\"stClosed\" aria-pressed=\"true\">Закрыть всё</button><button id=\"stOpen\" aria-pressed=\"false\">Открыть всё</button>\n  </div>\n  <div class=\"seg\" id=\"floors\" role=\"group\" aria-label=\"Пол\"></div>\n  <div class=\"row\" id=\"pts\" role=\"group\" aria-label=\"Точки обзора\"></div>\n</div>\n<div id=\"loading\">Загрузка…</div>\n<div id=\"bg\"></div>\n<div id=\"stats\"></div>\n<div id=\"boot\" role=\"progressbar\" aria-live=\"polite\"><div class=\"bx\"><div class=\"t\" id=\"bootT\"></div><div class=\"n\" id=\"bootN\">0%</div><div class=\"mb\" id=\"bootM\"></div><div class=\"bar\"><i id=\"bootI\"></i></div></div></div>";
export async function start(tourUrl) {
  const TOUR = await (await fetch(tourUrl || 'tour.json')).json();
  const D = TOUR.data || '', AD = D + (TOUR.anim || 'anim/');
  { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('vis-engine.css', import.meta.url).href; document.head.appendChild(l); }
  document.body.insertAdjacentHTML('afterbegin', HTML);
  document.title = TOUR.pageTitle || TOUR.title || '';
  document.getElementById('vTitle').textContent = TOUR.title || ''; document.getElementById('vDesc').textContent = TOUR.desc || '';
  document.getElementById('bootT').textContent = TOUR.bootText || 'Загружаем…';

// данные проекта — из tour.json (точки съёмки в координатах Blender, м; подписи групп; ручные конфликты)
const PTS = TOUR.points.map(p => Object.assign({}, p));
const CONFLICT = TOUR.conflicts || {};
const LABEL = TOUR.labels || {};

// Blender-направление → направление в сцене three (сфера с текстурой equirect, центр кадра = +Y Blender)
const b2t = (d) => new THREE.Vector3(-d[1], d[2], -d[0]);
const t2uv = (v) => { const dx = -v.z, dy = -v.x, dz = v.y, r = Math.hypot(dx, dy, dz) || 1;
  return [0.5 + Math.atan2(dx, dy) / (2 * Math.PI), 0.5 - Math.asin(Math.max(-1, Math.min(1, dz / r))) / Math.PI]; };

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
const MAXT = renderer.capabilities.maxTextureSize;
// HI — компьютер; на телефоне меньше видеопамяти: заплатки грузим по нажатию, а не все сразу
const HI = MAXT >= 8192 && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) && (navigator.deviceMemory || 8) >= 4;
const mkMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false });

// ---- новый движок (VIS_ENGINE_PLAN.md, шаги 1–3): панорама кубом из плиток 512 px на уровнях 512/1024/2048 px на грань ----
// В видеокарту попадают только видимые плитки нужного уровня — нет ни одной большой заливки, нечему фризить.
let MAN = null;                                   // points.json: грани, уровни, файлы и вес каждой точки
const manP = fetch(D + 'points.json').then(r => r.json()).then(j => {
  MAN = j; for (const pk in j.points) for (const f of j.points[pk].files) { f[0] = D + f[0]; if (f[2]) { f[2] = f[2].map(([n, o, l]) => [D + n, o, l]); PACKM[f[0]] = f[2]; for (const [n] of f[2]) PACKOF[n] = f[0]; } }
  return j; });
const TR = 500, TG = {};                         // общая геометрия плиток для всех точек
function tileGeo(f, k, tx, ty) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const [c, r, u] = MAN.faces[f].map(V), x0 = tx / k, x1 = (tx + 1) / k, y0 = ty / k, y1 = (ty + 1) / k;
  const P = (x, y) => c.clone().addScaledVector(r, 2 * x - 1).addScaledVector(u, 1 - 2 * y).multiplyScalar(TR);
  const a = P(x0, y0), b = P(x1, y0), cc = P(x1, y1), d = P(x0, y1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...cc.toArray(), ...d.toArray()], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]); g.computeBoundingSphere(); return g;
}
function tgeo(lv, f, tx, ty) { const k = lv < 0 ? 1 : MAN.levels[lv] / MAN.tile, key = lv + f + tx + '_' + ty; return TG[key] || (TG[key] = tileGeo(f, k, tx, ty)); }
const tileUrl = (pk, lv, f, tx, ty) => lv < 0 ? D + 'tiles/' + pk + '/prev_' + f + '.jpg' : D + 'tiles/' + pk + '/l' + lv + '/' + f + '_' + tx + '_' + ty + '.jpg';
const TUPQ = []; let tilesUp = 0, tilesFly = 0;
const STAT = { tileB: 0, patchB: 0 };              // примерная видеопамять (байты) — для статистики
const TMAX = HI ? 160 : 90;                       // сколько точных плиток держим в видеопамяти
function mkTileTex(bmp) {
  const t = new THREE.Texture(bmp); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; return t;
}
class TileLayer {
  constructor(base) { this.base = base; this.pk = null; this.op = 0; this.items = []; this.active = false; this.warmCam = null; }
  setPoint(pk) {
    if (this.pk === pk) return; this.clear(); this.pk = pk;
    const add = (lv, f, tx, ty) => {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: this.op, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(tgeo(lv, f, tx, ty), mat); mesh.visible = false; mesh.renderOrder = this.base + (lv + 1) * 0.01; scene.add(mesh);
      this.items.push({ lv, mesh, url: tileUrl(pk, lv, f, tx, ty), st: 0, tex: null, last: 0 });
    };
    for (const f of Object.keys(MAN.faces)) add(-1, f, 0, 0);
    MAN.levels.forEach((N, lv) => { const k = N / MAN.tile; for (const f of Object.keys(MAN.faces)) for (let ty = 0; ty < k; ty++) for (let tx = 0; tx < k; tx++) add(lv, f, tx, ty); });
  }
  set opacity(v) { this.op = v; for (const it of this.items) it.mesh.material.opacity = v; }
  get opacity() { return this.op; }
  setBase(b) { this.base = b; for (const it of this.items) it.mesh.renderOrder = b + (it.lv + 1) * 0.01; }
  setActive(on) { this.active = on; for (const it of this.items) it.mesh.visible = on && it.st === 3; }
  drop(it) {
    if (it.tex) { STAT.tileB -= it.bytes || 0; if (it.st === 3) tilesUp--; it.tex.dispose(); if (it.tex.image && it.tex.image.close) it.tex.image.close(); }
    it.tex = null; it.st = 0; it.mesh.visible = false; it.mesh.material.map = null;
  }
  clear() { for (const it of this.items) { this.drop(it); scene.remove(it.mesh); it.mesh.material.dispose(); } this.items = []; this.pk = null; this.active = false; this.warmCam = null; }
}
const layers = [new TileLayer(1), new TileLayer(2)];
// видимость и нужный уровень — по камере (или по камере, на которую повернёмся после перехода)
const frustum = new THREE.Frustum(), pvm = new THREE.Matrix4(), fwd = new THREE.Vector3(), camWide = new THREE.PerspectiveCamera();
function needLevel(cam) {
  const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect) * 180 / Math.PI;
  const pxPerDeg = renderer.domElement.width / hf;
  for (let i = 0; i < MAN.levels.length; i++) if (MAN.levels[i] / 90 >= pxPerDeg * 0.85) return i;
  return MAN.levels.length - 1;
}
function camFor(lo, la, fv) {
  const c = new THREE.PerspectiveCamera(fv, camera.aspect, 0.1, 2000);
  c.lookAt(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)); c.updateMatrixWorld(); return c;
}
// возвращает число видимых, но ещё не залитых плиток (для «точка готова»)
function scheduleTiles(L, cam, now) {
  if (!L.pk || !MAN) return 0;
  camWide.copy(cam); camWide.fov = Math.min(150, cam.fov * 1.35); camWide.updateProjectionMatrix(); camWide.updateMatrixWorld();
  pvm.multiplyMatrices(camWide.projectionMatrix, camWide.matrixWorldInverse); frustum.setFromProjectionMatrix(pvm);
  cam.getWorldDirection(fwd);
  const lv = needLevel(cam), want = []; let missing = 0;
  for (const it of L.items) {
    if (it.lv > lv) continue;
    if (it.lv >= 0 && !frustum.intersectsSphere(it.mesh.geometry.boundingSphere)) continue;
    it.last = now; if (it.st !== 3) missing++;
    if (it.st === 0) want.push(it);
  }
  want.sort((a, b) => (a.lv - b.lv) || (b.mesh.geometry.boundingSphere.center.dot(fwd) - a.mesh.geometry.boundingSphere.center.dot(fwd)));
  for (const it of want) {
    if (tilesFly >= 6) break;
    it.st = 1; tilesFly++; const pk = L.pk;
    getBlob(it.url).then(b => createImageBitmap(b, { imageOrientation: 'flipY' })).then(bmp => {
      if (L.pk !== pk || it.st !== 1) { bmp.close(); return; }
      it.tex = mkTileTex(bmp); it.bytes = bmp.width * bmp.height * 4 * 1.33; STAT.tileB += it.bytes; it.st = 2; TUPQ.push([L, it]);
    }).catch(() => { if (it.st === 1) it.st = 0; }).finally(() => { tilesFly--; });
  }
  return missing;
}
function evictTiles(now) {
  const live = []; layers.forEach(L => L.items.forEach(it => { if (it.st === 3 && it.lv > 0) live.push([L, it]); }));
  if (live.length <= TMAX) return;
  live.sort((a, b) => a[1].last - b[1].last);
  for (const [L, it] of live.slice(0, live.length - TMAX)) { if (now - it.last < 2000) break; L.drop(it); }
}
function pumpTiles(budget) {
  const t0 = performance.now();
  while (TUPQ.length && performance.now() - t0 < budget) {
    const [L, it] = TUPQ.shift(); if (!it.tex || it.st !== 2) continue;
    renderer.initTexture(it.tex); it.mesh.material.map = it.tex; it.mesh.material.needsUpdate = true; it.st = 3; tilesUp++;
    it.mesh.visible = L.active;
  }
}
// дождаться, пока превью граней и видимые плитки нужного уровня будут в видеокарте (точка показывается уже чёткой)
function warmLayer(L, lo, la, fv) {
  L.warmCam = camFor(lo, la, fv);
  return new Promise(res => {
    const t0 = performance.now(), done = () => { if (!L.warmRes) return; L.warmCam = null; L.warmRes = null; res(); };
    L.warmRes = () => { if (L.warmMissing === 0 || performance.now() - t0 > 4000) done(); };
    setTimeout(done, 5000);                            // вкладка в фоне (кадры не идут) — не зависаем
  });
}
function tickTiles(now) {
  if (!MAN) return;
  for (const L of layers) {
    if (L.warmCam) { L.warmMissing = scheduleTiles(L, L.warmCam, now); if (L.warmRes) L.warmRes(); }
    if (L.active) scheduleTiles(L, camera, now);
  }
  evictTiles(now);
  pumpTiles(Object.keys(ACT).length ? 2 : 4);
}

const loading = document.getElementById('loading'); let pending = 0;
const busy = (d) => { pending += d; loading.style.opacity = pending > 0 ? 1 : 0; };
// фоновая догрузка: файлы остальных точек скачиваются заранее в память (blob), чтобы переход был без ожидания
const PRE = new Map(), PREB = new Map(); let DLB = 0;   // url → Promise<objectURL|null>; url → Blob; скачано байт
const GOTU = {};                                   // url → сколько байт уже пришло (для «скачано N из M МБ»)
function fetchProgress(src) {
  return fetch(src).then(async r => {
    if (!r.ok) throw new Error(src);
    GOTU[src] = 0;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader(), parts = [];
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); GOTU[src] += value.length; DLB += value.length; }
      return new Blob(parts, { type: r.headers.get('content-type') || '' });
    }
    const b = await r.blob(); GOTU[src] = b.size; DLB += b.size; return b;
  });
}
// пачки (build_manifest.py): мелкие файлы точки склеены в один .pack — режем его на файлы в памяти
const PACKOF = {}, PACKS = new Map(), PACKM = {};
const MIME = (n) => n.endsWith('.png') ? 'image/png' : n.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
function loadPack(url) {
  if (!PACKS.has(url)) PACKS.set(url, fetchProgress(url).then(blob => {
    for (const [n, off, len] of (PACKM[url] || [])) { const b = blob.slice(off, off + len, MIME(n)); PREB.set(n, b); PRE.set(n, Promise.resolve(URL.createObjectURL(b))); }
  }).catch(() => { PACKS.delete(url); }));
  return PACKS.get(url);
}
function prefetch(src) {
  if (PRE.has(src)) return PRE.get(src);
  if (PACKOF[src]) return loadPack(PACKOF[src]).then(() => PRE.get(src) || null);
  const p = fetchProgress(src).then(b => { PREB.set(src, b); return URL.createObjectURL(b); }).catch(() => null);
  PRE.set(src, p); return p;
}
async function getBlob(src) { await prefetch(src); const b = PREB.get(src); if (!b) { PRE.delete(src); throw new Error(src); } return b; }
async function loadImg(src) {
  busy(1);
  const u = PRE.has(src) ? ((await PRE.get(src)) || src) : src;
  return new Promise((res, rej) => { const img = new Image(); img.decoding = 'async';
    img.onload = () => { busy(-1); res(img); }; img.onerror = () => { busy(-1); rej(new Error(src)); }; img.src = u; });
}
// ---- декодирование картинок вне основного потока (15.11: «на точку переходишь — минуты 2 фризит») ----
// Раньше на основном потоке: getImageData карт фасадов 8K (128 МБ на точку), масок и глубины 450 заплаток, декодирование
// панорам всех 8 точек сразу. Теперь это делают воркеры (OffscreenCanvas), основному потоку остаётся только залить текстуру.
const WK_SRC = `self.onmessage = async (e) => {
  const { id, url, tex, reads, anim } = e.data;
  if (anim) {                      // атлас кадров анимации: режем на кадры и считаем общую маску здесь, не в основном потоке
    try {
      const blob = await (await fetch(url)).blob();
      const base = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const { n, cols, cw, ch, mw, mh } = anim, bmps = [];
      for (let k = 0; k < n; k++) bmps.push(await createImageBitmap(base, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
      const oc = new OffscreenCanvas(mw, mh), c = oc.getContext('2d', { willReadFrequently: true }), U = new Uint8Array(mw * mh);
      for (let k = 0; k < n; k += 4) {
        c.clearRect(0, 0, mw, mh); c.drawImage(base, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch, 0, 0, mw, mh);
        const d = c.getImageData(0, 0, mw, mh).data; for (let i = 0; i < U.length; i++) if (d[i * 4 + 3] > 96) U[i] = 1;
      }
      base.close();
      self.postMessage({ id, bmps, U }, [...bmps, U.buffer]);
    } catch (err) { self.postMessage({ id, err: String(err) }); }
    return;
  }
  try {
    const blob = await (await fetch(url)).blob();
    const needBase = (reads && Object.keys(reads).length) || (tex && tex.maxW);
    const base = needBase ? await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : null;
    const out = { id, w: base ? base.width : 0, h: base ? base.height : 0, reads: {} }, tr = [];
    for (const name in (reads || {})) {
      const r = reads[name], w = Math.max(1, Math.round(base.width * r.s)), h = Math.max(1, Math.round(base.height * r.s));
      const oc = new OffscreenCanvas(w, h), c = oc.getContext('2d', { willReadFrequently: true });
      c.imageSmoothingEnabled = false; c.drawImage(base, 0, 0, w, h);
      const d = c.getImageData(0, 0, w, h).data, res = { w, h, c: 4, d };
      if (r.ch === 1) { const o = new Uint8Array(w * h); for (let i = 0; i < o.length; i++) o[i] = d[i * 4]; res.d = o; res.c = 1; }
      if (r.range) { let lo = 1, hi = 0; for (let i = 0; i < w * h; i++) { const v = (d[i * 4] + d[i * 4 + 1] / 255) / 255; if (v < 0.999) { if (v < lo) lo = v; if (v > hi) hi = v; } } res.lo = lo; res.hi = hi; }
      out.reads[name] = res; tr.push(res.d.buffer);
    }
    if (tex) {
      const opt = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: tex.cs === 'none' ? 'none' : 'default' };
      if (tex.maxW && base && base.width > tex.maxW) { opt.resizeWidth = tex.maxW; opt.resizeHeight = Math.round(base.height * tex.maxW / base.width); opt.resizeQuality = 'high'; }
      out.bmp = await createImageBitmap(blob, opt); tr.push(out.bmp);
    }
    if (base) base.close();
    self.postMessage(out, tr);
  } catch (err) { self.postMessage({ id, err: String(err) }); }
};`;
let WK = null; const WCB = {}; let wkId = 0;
// задания идут воркерам по одному на воркер, первым — самое срочное (открытая сейчас дверца), фон — в конце
const JOBQ = [], WBUSY = new Set();
function wkPump() {
  if (!WK) return;
  for (let i = 0; i < WK.length && JOBQ.length; i++) {
    if (WBUSY.has(i)) continue;
    let b = 0; for (let k = 1; k < JOBQ.length; k++) if (JOBQ[k].prio < JOBQ[b].prio || (JOBQ[k].prio === JOBQ[b].prio && JOBQ[k].seq < JOBQ[b].seq)) b = k;
    if (i === 0 && JOBQ[b].prio > 1) continue;      // фон не занимает срочный воркер
    const j = JOBQ.splice(b, 1)[0], id = j.seq; WBUSY.add(i);
    WCB[id] = (d) => { WBUSY.delete(i); d.err ? j.rej(new Error(d.err)) : j.res(d); wkPump(); };
    WK[i].postMessage(Object.assign({ id }, j.msg));
  }
}
const bumpJobs = (pred, prio) => JOBQ.forEach(j => { if (pred(j.src) && j.prio > prio) j.prio = prio; });
function wkInit() {
  if (WK !== null) return WK;
  try {
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) throw 0;
    const u = URL.createObjectURL(new Blob([WK_SRC], { type: 'text/javascript' }));
    const n = Math.max(2, Math.min(3, ((navigator.hardwareConcurrency || 4) / 2) | 0));   // воркер 0 — только для срочного
    WK = Array.from({ length: n }, () => { const w = new Worker(u); w.onmessage = (e) => { const cb = WCB[e.data.id]; delete WCB[e.data.id]; if (cb) cb(e.data); }; return w; });
  } catch (e) { WK = false; }
  return WK;
}
function wkJob(src, msg, prio) { return new Promise((res, rej) => { JOBQ.push({ src, prio: prio == null ? 1 : prio, seq: ++wkId, msg, res, rej }); wkPump(); }); }
// url → { bmp (ImageBitmap, уже перевёрнут) или img (Image), reads: {имя: {w, h, c, d, lo, hi}} }
async function decodeAsset(src, tex, reads, prio) {
  const u = PRE.has(src) ? ((await PRE.get(src)) || src) : src;
  const W = wkInit();
  if (W) {
    busy(1);
    try {
      return await wkJob(src, { url: new URL(u, location.href).href, tex, reads }, prio);
    } catch (e) { /* ниже — запасной путь */ } finally { busy(-1); }
  }
  const img = await loadImg(src), out = { img: tex ? img : null, reads: {} };
  for (const name in (reads || {})) {
    const r = reads[name], p = readPixels(img, r.s), res = { w: p.w, h: p.h, c: 4, d: p.d };
    if (r.ch === 1) { const o = new Uint8Array(p.w * p.h); for (let i = 0; i < o.length; i++) o[i] = p.d[i * 4]; res.d = o; res.c = 1; }
    if (r.range) { let lo = 1, hi = 0; for (let i = 0; i < p.w * p.h; i++) { const v = (p.d[i * 4] + p.d[i * 4 + 1] / 255) / 255; if (v < 0.999) { if (v < lo) lo = v; if (v > hi) hi = v; } } res.lo = lo; res.hi = hi; }
    out.reads[name] = res;
  }
  return out;
}
const isBmp = (x) => typeof ImageBitmap !== 'undefined' && x instanceof ImageBitmap;
function freeTex(t) { if (!t) return; t.dispose(); if (isBmp(t.image)) t.image.close(); }
function mkTex(src) {
  const t = new THREE.Texture(src); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; if (isBmp(src)) t.flipY = false;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; return t;
}
// ---- заплатки (каждая дверца отдельно) ----
let META = null; const GBY = {};               // id группы → {id, movs, label}
const opened = new Set();                       // id открытых групп (общие для всех точек)
const ids = {};                                 // карта фасадов точки: {w, h, data}
const patches = {};                             // pk_gid → {mesh, alpha, px, ready}
const metaP = fetch(D + 'parts/parts.json').then(r => r.json()).then(m => { META = m; m.groups.forEach(g => { GBY[g.id] = g; }); return m; }).catch(() => null);
function loadIds(pk, prio) {
  if (!ids[pk]) ids[pk] = decodeAsset(D + 'parts/' + pk + '_ids.png', null, { ids: { s: 1, ch: 1 } }, prio != null ? prio : (cur && cur.id === pk ? 0 : 2)).then(a => { const r = a.reads.ids; return { w: r.w, h: r.h, c: r.c, data: r.d }; }).catch(() => null);
  return ids[pk];
}
// заплатка рисуется шейдером: цвет + маска из WebP, глубина (расстояние до поверхности) из *_d.png → gl_FragDepth,
// чтобы открытая дверца одного шкафа правильно перекрывала внутренность соседнего
const PATCH_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// плавное открывание без лишних кадров: заплатка проявляется по глубине — сначала дальнее (нутро шкафа),
// потом ближнее (открытая дверца/ящик «выходит» на зрителя); при закрытии — в обратном порядке
const PATCH_FS = `uniform sampler2D map; uniform sampler2D dmap; uniform float op; uniform vec2 dr; uniform float zb; varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  vec2 dd = texture2D(dmap, vUv).rg; float d = (floor(dd.r * 255.0 + 0.5) + dd.g) / 255.0;
  float dn = d > 0.999 ? 1.0 : clamp((d - dr.x) / max(dr.y - dr.x, 1e-4), 0.0, 1.0);
  const float S = 1.0;   // ширина «фронта» проявления: шире — меньше ряби по глубине
  float w = clamp((op * (1.0 + S) - (1.0 - dn)) / S, 0.0, 1.0);
  float a = c.a * w * w * (3.0 - 2.0 * w); if (a < 0.02) discard;
  gl_FragDepth = (c.a > 0.9 ? min(d, 0.9999) : 0.99995) - zb; gl_FragColor = vec4(c.rgb, a);   // zb: при равной глубине (общая полка, кромка) выигрывает последняя открытая — без «пунктира» от z-fighting
}`;
function rawTex(src, nearest) {
  const t = new THREE.Texture(src); t.colorSpace = THREE.NoColorSpace; if (isBmp(src)) t.flipY = false;
  if (nearest) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  else { t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
  t.needsUpdate = true; return t;
}
function readPixels(img, s) {
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
  const c = cv.getContext('2d', { willReadFrequently: true }); c.imageSmoothingEnabled = false; c.drawImage(img, 0, 0, cv.width, cv.height);
  return { w: cv.width, h: cv.height, d: c.getImageData(0, 0, cv.width, cv.height).data };
}
// Заплатка теперь — набор плиток (куски 512 px с полями 2 px, пустые выброшены; build_parts.py), а не одна большая картинка:
// заливка в видеокарту по 1 МБ вместо десятков МБ. Снаружи ведёт себя как одна сетка (PGroup).
class PGroup {
  constructor(u, inv) {
    this.u = u; this.kids = []; this._vis = false; this._ro = 10; this._dt = !inv; this.userData = { inv };
    const self = this;
    this.material = { uniforms: u, get opacity() { return u.op.value; }, set opacity(v) { u.op.value = v; },
      get depthTest() { return self._dt; }, set depthTest(v) { self._dt = v; self.kids.forEach(k => { k.material.depthTest = v; }); } };
  }
  get visible() { return this._vis; } set visible(v) { this._vis = v; this.kids.forEach(k => { k.visible = v; }); }
  get renderOrder() { return this._ro; } set renderOrder(v) { this._ro = v; this.kids.forEach(k => { k.renderOrder = v; }); }
  addTile(t, tex, dtex) {
    const [W, H] = META.res, [x0, y0, x1, y1] = t, P = META.pad || 0, cw = x1 - x0, ch = y1 - y0;
    const g = new THREE.SphereGeometry(490, Math.max(2, Math.ceil(cw / W * 160)), Math.max(2, Math.ceil(ch / H * 80)),
      x0 / W * 2 * Math.PI, cw / W * 2 * Math.PI, y0 / H * Math.PI, ch / H * Math.PI);
    g.scale(-1, 1, 1);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, (P + uv.getX(i) * cw) / (cw + 2 * P), (P + uv.getY(i) * ch) / (ch + 2 * P));
    const u = { map: { value: tex }, dmap: { value: dtex }, op: this.u.op, dr: this.u.dr, zb: this.u.zb };
    const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: PATCH_VS, fragmentShader: PATCH_FS, transparent: true, depthTest: this._dt, depthWrite: true });
    const m = new THREE.Mesh(g, mat); m.visible = this._vis; m.renderOrder = this._ro; m.frustumCulled = true; scene.add(m); this.kids.push(m);
  }
  textures() { const o = []; this.kids.forEach(k => { o.push(k.material.uniforms.map.value, k.material.uniforms.dmap.value); }); return o; }
  free() { this.kids.forEach(k => { scene.remove(k); k.geometry.dispose(); k.material.dispose(); freeTex(k.material.uniforms.map.value); freeTex(k.material.uniforms.dmap.value); }); this.kids = []; }
}
const pfx = (pk, gid) => D + 'parts/' + pk + '_' + gid + '_';
function loadPatch(pk, gid, urgent, prio) {
  const key = pk + '_' + gid;
  if (patches[key]) { if (urgent || prio === 0) bumpJobs(u => u.startsWith(pfx(pk, gid)), 0); return patches[key].p; }
  const info = META && META.parts[pk] && META.parts[pk][gid];
  if (!info) return null;
  const rec = { px: info.px, mesh: null, alpha: null, depth: null, info, key, pk, gid, texP: null, used: 0 };
  const pr = prio != null ? prio : urgent ? 0 : (cur && cur.id === pk ? 1 : 2);
  rec.p = Promise.all([
    decodeAsset(D + 'parts/' + info.a, null, { alpha: { s: 1 } }, pr),                       // маска 1/4 — попадание пальцем
    decodeAsset(D + 'parts/' + info.dl, null, { depth: { s: 1, range: true } }, pr),         // глубина 1/2 — диапазон и выбор верхней
    info.pick ? decodeAsset(D + 'parts/' + info.pick, null, { pick: { s: 1 } }, pr).catch(() => null) : null,
  ]).then(([a, b, c]) => {
    const u = { op: { value: 0 }, dr: { value: new THREE.Vector2(0, 1) }, zb: { value: 0 } };
    rec.u = u; rec.mesh = new PGroup(u, !!(GBY[gid] && GBY[gid].inv));
    rec.alpha = a.reads.alpha;
    rec.depth = b.reads.depth; if (b.reads.depth.hi > b.reads.depth.lo) u.dr.value.set(b.reads.depth.lo, b.reads.depth.hi);
    if (c) rec.pick = c.reads.pick;
    return rec;
  });
  patches[key] = rec; return rec.p;
}
// текстуры плиток заплатки: декодирование в воркере, заливка в видеокарту — по очереди (UPQ)
function ensureTex(rec, prio) {
  const info = rec.info; rec.used = performance.now();
  if (rec.texP) { if (prio === 0) bumpJobs(u => u.startsWith(pfx(rec.pk, rec.gid)), 0); return rec.texP; }
  const my = rec.texP = Promise.all(info.tiles.map((t, i) => Promise.all([
    decodeAsset(pfx(rec.pk, rec.gid) + i + '.webp', { cs: 'srgb' }, null, prio),
    decodeAsset(pfx(rec.pk, rec.gid) + i + '_d.png', { cs: 'none' }, null, prio)]))).then(list => {
    if (rec.texP !== my) { list.forEach(([a, b]) => { if (a.bmp) a.bmp.close(); if (b.bmp) b.bmp.close(); }); return rec; }   // уже освободили
    list.forEach(([a, b], i) => {
      const t = rawTex(a.bmp || a.img), d = rawTex(b.bmp || b.img, true);
      rec.mesh.addTile(info.tiles[i], t, d); UPQ.push(t, d);
      rec.vb = (rec.vb || 0) + (t.image.width * t.image.height * 4) * 2.33;
    });
    STAT.patchB += rec.vb || 0;
    return rec;
  });
  return rec.texP;
}
function dropTex(rec) {
  if (!rec.texP || !rec.mesh) return;
  rec.texP = null; rec.mesh.visible = false; rec.mesh.material.opacity = 0;
  rec.mesh.textures().forEach(t => { const i = UPQ.indexOf(t); if (i >= 0) UPQ.splice(i, 1); });
  rec.mesh.free(); STAT.patchB -= rec.vb || 0; rec.vb = 0;
}
// телефон: видеопамяти мало — закрытые заплатки, к которым давно не обращались, выгружаем (остаются скачанными)
const PBUDGET = HI ? Infinity : 160 * 1048576;
function trimPatchTex() {
  if (STAT.patchB <= PBUDGET) return;
  const cand = Object.values(patches).filter(r => r.texP && r.mesh && !r.mesh.visible).sort((a, b) => a.used - b.used);
  for (const r of cand) { if (STAT.patchB <= PBUDGET * 0.8) break; dropTex(r); }
}
function upPatch(rec) { rec.mesh.textures().forEach(upTex); rec.used = performance.now(); }
// текущая точка: на компьютере текстуры всех заплаток готовим заранее, по одной (воркер) — открытие без задержки
let texQ = 0;
async function warmTex(pk) {
  const my = ++texQ;
  Object.entries(patches).forEach(([k, r]) => { if (!k.startsWith(pk + '_')) dropTex(r); });   // чужие точки — из видеопамяти
  await metaP; if (!META || !META.parts[pk] || !HI) return;
  for (const gid of Object.keys(META.parts[pk])) {
    if (my !== texQ || cur.id !== pk) return;
    const rec = await loadPatch(pk, gid); if (!rec) continue;
    await ensureTex(rec, 1);
    while (UPQ.length > 24 || Object.keys(ACT).length) await new Promise(r => setTimeout(r, 60));
  }
}
let order = 10; const LAST = {};
function setTop(mesh) { mesh.renderOrder = ++order; const u = mesh.material.uniforms; if (u && u.zb) u.zb.value = Math.min(order, 20000) * 2e-7; }
function fadeMesh(mesh, to, dur = (to > 0 ? 950 : 750), delay = 0) {
  mesh.visible = true; if (to > 0) setTop(mesh);
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].m === mesh.material) tweens.splice(i, 1);   // одна анимация на заплатку, иначе они спорят
  tweens.push({ m: mesh.material, from: mesh.material.opacity, to, t0: performance.now() + delay, dur, end: () => { if (to === 0) mesh.visible = false; } });
}
const tweens = [];

// ---- анимация открывания (14.11.2026): 29 кадров по каждой дверце/ящику, атлас 5 столбцов (pano/anim) ----
// Кадры отрендерены в «чистой» сцене (открыта только эта группа и то, без чего она не открывается), поэтому играем их,
// только если кадры не налезают на заплатки других открытых фасадов (проверка по маскам); иначе — обычное проявление.
// Повторное нажатие во время движения разворачивает анимацию с текущего кадра; соседние фасады анимируются независимо.
let ANIM = null; const AREC = {};
// «Открыть всё» (15.11, пользователь: «всё друг в друга входит»): мешающие пары не открываем до конца — AVENTOS до антресолей,
// ПММ до острова, дверь мойки до ПММ и т.д. Доля хода посчитана в Blender по пересечению (allopen_limits.py) и показывается
// кадром анимации k из 30, без перерендера.
let ALLMODE = false, ALIM = {}; const ALLSHOWN = new Set();
fetch(AD + 'allopen.json').then(r => r.ok ? r.json() : null).then(j => { if (j && j.limits) ALIM = j.limits; }).catch(() => {});
const animP = fetch(AD + 'anim.json').then(r => r.ok ? r.json() : null).then(j => { ANIM = j; return j; }).catch(() => null);
const HOLD = new Set();
const KEEPOPEN = new Set();
const _REQ = {};
function reqOf(x) { if (!x) return []; if (!_REQ[x.id]) _REQ[x.id] = (x.req || []).map(nm => (META.groups.find(y => !y.combo && y.movs[0] === nm) || {}).id).filter(Boolean); return _REQ[x.id]; }          // фасад закрывается, но ждёт, пока уедут внутренние — до этого показываем его открытым               // группы в движении: их заплатки (и общие с ними) не показываем, пока идут кадры
const ACT = {};                       // pk_gid → активная анимация
// Загрузка кадров без фризов (пользователь 15.11: «периодически фризы»): атлас режется createImageBitmap (вне основного потока),
// маска для проверки наложения — по уменьшенной копии, текстуры заливаются в видеокарту по очереди, по нескольку мс за кадр.
// 15.11 (пользователь: «рывки, как пластилиновый мультик»): между соседними кадрами — плавное смешивание (map → map2 по mt),
// чтобы 29 кадров на секунду не «щёлкали» на экране 120–165 Гц. Смешиваем с учётом прозрачности, чтобы не было тёмной каймы.
const ANIM_FS = `uniform sampler2D map; uniform sampler2D map2; uniform float mt; uniform float op; uniform float dz; varying vec2 vUv;
void main() { vec4 c0 = texture2D(map, vUv), c1 = texture2D(map2, vUv);
  float a0 = c0.a * (1.0 - mt), a1 = c1.a * mt, ca = a0 + a1;
  vec3 rgb = ca > 1e-4 ? (c0.rgb * a0 + c1.rgb * a1) / ca : c0.rgb;
  float a = ca * op; if (a < 0.01) discard; gl_FragDepth = dz; gl_FragColor = vec4(rgb, a); }`;
// кадры — тем же способом, что заплатки (сырые sRGB-значения, глубина gl_FragDepth): при наложении на открытую соседку
// побеждает тот, кто ближе (глубина кадра = ближайшая точка своей открытой заплатки)
function mkAnimMat(tex) {
  const u = { map: { value: tex }, map2: { value: tex }, mt: { value: 0 }, op: { value: 1 }, dz: { value: 0 } };
  const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: PATCH_VS, fragmentShader: ANIM_FS, transparent: true, depthTest: false, depthWrite: false });
  Object.defineProperty(m, 'opacity', { get: () => u.op.value, set: (v) => { u.op.value = v; }, configurable: true });
  Object.defineProperty(m, 'map', { get: () => u.map.value, set: (v) => { u.map.value = v; u.map2.value = v; u.mt.value = 0; }, configurable: true });
  return m;
}
const UPQ = [];
function upTex(t) { if (!t.__up) { renderer.initTexture(t); t.__up = true; } }
function pumpUploads(budget) { const t0 = performance.now(); while (UPQ.length && performance.now() - t0 < budget) upTex(UPQ.shift()); }
const nextIdle = () => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 30)));
// 15.11 (движок): разрезка атласа и маска — в воркере; раньше это делал основной поток, и пока кадры готовились в фоне,
// были подвисания по 0,3–4 с (пользователь: «просадки до 6 кадров», пока всё не догрузилось)
function animMesh(rec) {
  const a = rec.a, W = a.res || 2048, H = W / 2, [X0, Y0, X1, Y1] = a.px;
  const g = new THREE.SphereGeometry(480, Math.max(4, Math.ceil((X1 - X0) / W * 160)), Math.max(4, Math.ceil((Y1 - Y0) / H * 80)),
    X0 / W * 2 * Math.PI, (X1 - X0) / W * 2 * Math.PI, Y0 / H * Math.PI, (Y1 - Y0) / H * Math.PI);
  g.scale(-1, 1, 1);
  rec.mesh = new THREE.Mesh(g, mkAnimMat(rec.tex[0]));
  rec.mesh.renderOrder = 1e7; rec.mesh.visible = false; scene.add(rec.mesh); rec.ready = true; return rec;
}
function loadAnim(pk, gid, prio) {
  const key = pk + '_' + gid; if (AREC[key]) { if (prio === 0) bumpJobs(u => u === AD + AREC[key].a.file, 0); return AREC[key].p; }
  const a = ANIM && ANIM[pk] && ANIM[pk][gid]; if (!a) return null;
  const rec = AREC[key] = { a, ready: false };
  if (wkInit()) {
    const src = AD + a.file, [cw, ch] = a.cell, ms = Math.min(1, 160 / Math.max(cw, ch)), mw = Math.max(1, Math.round(cw * ms)), mh = Math.max(1, Math.round(ch * ms));
    rec.p = prefetch(src).then(u => wkJob(src, { url: new URL(u || src, location.href).href, anim: { n: a.n, cols: a.cols, cw, ch, mw, mh } }, prio == null ? 2 : prio)).then(d => {
      if (AREC[key] !== rec) { d.bmps.forEach(b => b.close()); return null; }
      rec.tex = d.bmps.map(b => { const t = new THREE.Texture(b); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; UPQ.push(t); return t; });
      let n = 0; for (let i = 0; i < d.U.length; i++) n += d.U[i];
      rec.U = d.U; rec.Uw = mw; rec.Uh = mh; rec.Us = mw / cw; rec.Un = n / (rec.Us * rec.Us);
      return animMesh(rec);
    }).catch(() => null);
    return rec.p;
  }
  rec.p = loadImg(AD + a.file).then(async img => {
    try { await img.decode(); } catch (e) {}
    const [cw, ch] = a.cell, W = a.res || 2048, H = W / 2, [X0, Y0, X1, Y1] = a.px;
    const cell = k => [(k % a.cols) * cw, Math.floor(k / a.cols) * ch];
    let bmps = null;
    if (window.createImageBitmap) {
      try { bmps = await Promise.all(Array.from({ length: a.n }, (_, k) => { const [sx, sy] = cell(k); return createImageBitmap(img, sx, sy, cw, ch, { imageOrientation: 'flipY', premultiplyAlpha: 'none' }); })); }
      catch (e) { bmps = null; }
    }
    rec.tex = [];
    for (let k = 0; k < a.n; k++) {
      let t;
      if (bmps) { t = new THREE.Texture(bmps[k]); t.flipY = false; }
      else { const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const [sx, sy] = cell(k); cv.getContext('2d').drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch); t = new THREE.Texture(cv); }
      t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
      rec.tex.push(t); UPQ.push(t);
      if (!bmps && k % 6 === 5) await nextIdle();
    }
    // объединённая маска кадров (для проверки наложения) — по копии не больше 160 px
    const ms = Math.min(1, 160 / Math.max(cw, ch)), mw = Math.max(1, Math.round(cw * ms)), mh = Math.max(1, Math.round(ch * ms));
    const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh; const mx = mc.getContext('2d', { willReadFrequently: true });
    const U = new Uint8Array(mw * mh);
    for (let k = 0; k < a.n; k += 4) {
      mx.clearRect(0, 0, mw, mh); const [sx, sy] = cell(k); mx.drawImage(img, sx, sy, cw, ch, 0, 0, mw, mh);
      const d = mx.getImageData(0, 0, mw, mh).data; for (let i = 0; i < U.length; i++) if (d[i * 4 + 3] > 96) U[i] = 1;
    }
    let n = 0; for (let i = 0; i < U.length; i++) n += U[i];
    rec.U = U; rec.Uw = mw; rec.Uh = mh; rec.Us = mw / cw; rec.Un = n / (rec.Us * rec.Us);
    return animMesh(rec);
  }).catch(() => null);
  return rec.p;
}
function animFree(pk) {           // кадры других точек — из видеопамяти (на телефоне её мало)
  for (const [k, r] of Object.entries(AREC)) {
    if (k.startsWith(pk + '_') || !r.ready) continue;
    r.tex.forEach(t => { t.dispose(); if (t.image && t.image.close) t.image.close(); const i = UPQ.indexOf(t); if (i >= 0) UPQ.splice(i, 1); }); r.mesh.geometry.dispose(); r.mesh.material.dispose(); scene.remove(r.mesh); delete AREC[k];
  }
  for (const k of Object.keys(ACT)) if (!k.startsWith(pk + '_')) { HOLD.delete(ACT[k].gid); delete ACT[k]; }
}
let animQ = 0;
async function animPrefetch(pk) {
  const my = ++animQ; animFree(pk); await animP; if (!ANIM || !ANIM[pk]) return;
  if (!HI) return;                // телефон: кадры грузятся по первому нажатию (первое открытие — обычное проявление)
  for (const gid of Object.keys(ANIM[pk])) { if (my !== animQ || cur.id !== pk) return; await nextIdle(); while (UPQ.length > 60 || Object.keys(ACT).length) await new Promise(r => setTimeout(r, 120)); await loadAnim(pk, gid); }
}
// сколько пикселей кадров анимации ложится на видимую часть заплатки другой открытой группы
function overlapPatch(rec, prec) {
  if (!prec || !prec.alpha) return 0;
  const a = rec.a, AW = a.res || 2048, [X0, Y0] = a.px, k8 = 8192 / AW, sc = a.sc || 1, P = prec.alpha, [px0, py0] = prec.px, s = P.w / ((prec.px[2] - px0) || 1);
  const q = 1 / (rec.Us * sc);              // пиксель маски → пиксели кадра анимации
  let n = 0;
  for (let y = 0; y < rec.Uh; y++) for (let x = 0; x < rec.Uw; x++) {
    if (!rec.U[y * rec.Uw + x]) continue;
    const ax = Math.floor(((((X0 + (x + 0.5) * q) * k8) % 8192) - px0) * s), ay = Math.floor(((Y0 + (y + 0.5) * q) * k8 - py0) * s);
    if (ax < 0 || ay < 0 || ax >= P.w || ay >= P.h) continue;
    if (P.d[(ay * P.w + ax) * 4 + 3] > 128) n += q * q * sc * sc;
  }
  return n;
}
function animOk(pk, gid) {
  return !(floor || mode !== 'single' || !ANIM || !ANIM[pk] || !ANIM[pk][gid]);
}
// 15.11: раньше при наложении на открытую соседку анимация отключалась (холодильник открыт → антресоль без анимации).
// Теперь кадры играют всегда, но если налезают на видимую заплатку другой открытой группы — рисуются ПОД ней
// (там, где открытая соседка видна, она перед нашим фасадом).
function animUnder(pk, gid, rec) {
  const keep = new Set([gid, ...reqOf(GBY[gid])]);
  for (const o of opened) {
    if (keep.has(o) || HOLD.has(o)) continue;
    const ids = [o]; META.groups.forEach(c => { if (c.combo && c.combo.includes(o) && !c.combo.includes(gid)) ids.push(c.id); });
    for (const id of ids) { const pr = patches[pk + '_' + id]; if (pr && pr.mesh && pr.mesh.visible && overlapPatch(rec, pr) > Math.max(30, 0.006 * rec.Un)) return true; }
  }
  return false;
}
function hideOwn(pk, gid) {        // своя заплатка (одна или в составе общей) — убрать сразу, иначе видна «призраком» по краю кадра
  Object.entries(patches).forEach(([k, r]) => {
    if (!k.startsWith(pk + '_') || !r.mesh) return; const id = +k.slice(pk.length + 1);
    if ((GBY[id].combo || [id]).includes(gid)) {
      for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].m === r.mesh.material) tweens.splice(i, 1);
      r.mesh.visible = false; r.mesh.material.opacity = 0; }
  });
}
const ANIM_DUR = 1050;
function shownTargets(pk, gid) { const out = []; const was = HOLD.has(gid); HOLD.delete(gid); shownSet(pk).forEach(id => { if ((GBY[id].combo || [id]).includes(gid)) out.push(id); }); if (was) HOLD.add(gid); return out; }
function startAnim(pk, gid, rec, open) {
  const key = pk + '_' + gid, n = rec.tex.length;
  let A = ACT[key];
  if (!A) {
    A = ACT[key] = { pk, gid, rec, pos: open ? 0 : 1 };
    rec.mesh.material.map = rec.tex[open ? 0 : n - 1];
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].m === rec.mesh.material) tweens.splice(i, 1);
  }
  for (let i = rec.tex.length - 1; i >= 0; i--) { const t = rec.tex[i], j = UPQ.indexOf(t); if (j >= 0) { UPQ.splice(j, 1); UPQ.unshift(t); } }
  rec.mesh.renderOrder = 1e7;
  { const own = patches[key], parentVis = reqOf(GBY[gid]).some(r => { const pr = patches[pk + '_' + r]; return pr && pr.mesh && pr.mesh.visible; });
    const lo = own && own.u && own.depth ? own.u.dr.value.x : null;
    // глубина — только когда нет открытого родителя (внутренний ящик едет внутри его заплатки) и это не «закрыть внутренний»
    if (lo != null && lo > 0 && !parentVis && !GBY[gid].inv) { rec.mesh.material.depthTest = true; rec.mesh.material.uniforms.dz.value = Math.max(0, lo - 0.002); }
    else rec.mesh.material.depthTest = false; }
  if (open) shownTargets(pk, gid).forEach(id => { const p = loadPatch(pk, id, true); if (p) p.then(r => r && ensureTex(r, 0)); });   // заплатки конца — заранее
  A.dir = open ? 1 : -1; A.last = performance.now(); rec.mesh.material.opacity = 1; rec.mesh.visible = true;
  HOLD.add(gid);
  hideOwn(pk, gid);
  refresh(pk, false);
}
function stepAnims(now) {
  for (const [key, A] of Object.entries(ACT)) {
    const dt = Math.min(now - A.last, 100); A.last = now;
    A.pos = Math.max(0, Math.min(1, A.pos + A.dir * dt / ANIM_DUR));
    const s = A.pos * A.pos * (3 - 2 * A.pos), n = A.rec.tex.length, f = Math.round(s * (n - 1));
    { const fp = s * (n - 1), f0 = Math.min(n - 1, Math.floor(fp)), f1 = Math.min(n - 1, f0 + 1), U = A.rec.mesh.material.uniforms;
      U.map.value = A.rec.tex[f0]; U.map2.value = A.rec.tex[f1]; U.mt.value = f1 > f0 ? fp - f0 : 0; }
    if ((A.dir > 0 && A.pos >= 1) || (A.dir < 0 && A.pos <= 0)) {
      delete ACT[key]; HOLD.delete(A.gid);
      if (cur.id !== A.pk) { A.rec.mesh.visible = false; continue; }
      if (A.dir > 0) {                                  // кадр не убираем, пока заплатка конца не готова (иначе мелькает закрытое)
        const ids = shownTargets(A.pk, A.gid);
        Promise.all(ids.map(id => { const p = loadPatch(A.pk, id, true); return p ? p.then(r => r && ensureTex(r, 0)) : null; })).then(() => {
          if (ACT[key]) return;                           // успели развернуть
          refresh(A.pk, false, A.gid); setTimeout(() => { if (!ACT[key]) animOut(A.rec, 160); }, 60);
        });
      } else { refresh(A.pk, false, A.gid); animOut(A.rec, 140); }
    }
  }
}
function animStopAll() { for (const [k, A] of Object.entries(ACT)) { A.rec.mesh.visible = false; delete ACT[k]; } for (const k of Object.keys(PEND)) { clearTimeout(PEND[k]); delete PEND[k]; } HOLD.clear(); KEEPOPEN.clear(); }
function animOut(rec, ms) {      // кадр уходит, когда под ним уже нужная картинка
  const m = rec.mesh.material;
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].m === m) tweens.splice(i, 1);
  tweens.push({ m, from: 1, to: 0, t0: performance.now(), dur: ms, end: () => { rec.mesh.visible = false; } });
}
// мешающие друг другу элементы: из проверки геометрии в Blender (parts.json → conflicts) + известные вручную
function conflictsOf(g) {
  const s = new Set((META.conflicts && META.conflicts[g.id]) || []);
  (CONFLICT[g.movs[0]] || []).forEach(nm => { const o = META.groups.find(x => x.movs[0] === nm); if (o) s.add(o.id); });
  return [...s];
}
async function setGroup(gid, open, quiet) {
  const g = GBY[gid]; if (!g) return;
  if (ALLMODE) { ALLMODE = false; for (const L of Object.keys(ALIM)) if (+L !== gid) opened.delete(+L); }
  const before = new Set(opened);
  const reqIds = (x) => (x.req || []).map(nm => (META.groups.find(y => !y.combo && y.movs[0] === nm) || {}).id).filter(Boolean);
  if (open) {
    conflictsOf(g).forEach(oid => { if (opened.has(oid)) { opened.delete(oid); } });   // что мешает — закрываем
    reqIds(g).forEach(r => opened.add(r));                                                 // ящик — только при открытой двери
    opened.add(gid);
  } else {
    opened.delete(gid);
    META.groups.forEach(x => { if (reqIds(x).includes(gid)) opened.delete(x.id); });       // закрыли дверь — её ящики тоже
  }
  // внутренний ящик без открытого фасада не показываем: иначе после закрытия фасада (в т.ч. соседом-помехой) остаётся «призрак»
  let changed = true;
  while (changed) { changed = false;
    for (const id of [...opened]) { const x = GBY[id]; if (x && !x.combo && reqIds(x).some(r => !opened.has(r))) { opened.delete(id); changed = true; } } }
  if (!quiet) toast(g, open);
  if (open && !quiet && !(META.parts[cur.id] || {})[gid]) toast(g, open, true);
  const pk = cur.id, keep = new Set([gid, ...reqIds(g)]), key = pk + '_' + gid;
  if (PEND[key]) { clearTimeout(PEND[key]); delete PEND[key]; HOLD.delete(gid); KEEPOPEN.delete(gid); }
  if (ACT[key]) { startAnim(pk, gid, ACT[key].rec, opened.has(gid)); return; }      // нажали во время движения — разворот
  if (quiet || g.combo) { refresh(pk, false); return; }
  // что закрылось попутно (мешающие соседи при открытии, внутренние ящики при закрытии двери) — сначала они уезжают своей анимацией,
  // потом движется нажатый фасад (иначе сосед пропадал, а фасад появлялся мгновенно)
  const gone = [...before].filter(x => x !== gid && !opened.has(x));
  let goneAnim = false;
  // 15.11 (пользователь: «выезжает лоток, а общий фасад дёргается к закрытому»): нажатый фасад помечаем ДО запуска анимаций соседей —
  // их startAnim перерисовывает открытое, и без пометки фасад успевал начать гаснуть, а потом проявлялся обратно
  if (gone.length) { if (open) HOLD.add(gid); else KEEPOPEN.add(gid); }
  for (const x of gone) {
    const kx = pk + '_' + x, rx = AREC[kx];
    if (ACT[kx]) { startAnim(pk, x, ACT[kx].rec, false); goneAnim = true; }
    else if (rx && rx.ready && ANIM && ANIM[pk] && ANIM[pk][x] && !floor) { startAnim(pk, x, rx, false); goneAnim = true; }
  }
  const go = async () => {
    delete PEND[key]; HOLD.delete(gid); KEEPOPEN.delete(gid);
    if (cur.id !== pk || opened.has(gid) !== open) return;
    if (animOk(pk, gid)) {
      const p = loadAnim(pk, gid, 0), ar = AREC[key];
      const rec = ar && ar.ready ? ar : await Promise.race([p, new Promise(r => setTimeout(() => r(null), 350))]);
      if (rec && rec.ready && cur.id === pk && opened.has(gid) === open && !ACT[key] && animOk(pk, gid)) { startAnim(pk, gid, rec, open); return; }
    }
    refresh(pk, false);
  };
  if (gone.length) {
    refresh(pk, false);                 // соседи уезжают (или гаснут), нажатый фасад ждёт
    PEND[key] = setTimeout(go, goneAnim ? ANIM_DUR + 60 : 700);
  } else go();
}
const PEND = {};
// что показывать в точке: открытые группы; у двустворчатых (сушка) при обеих открытых створках — общая заплатка,
// иначе между створками осталась бы щель из закрытого кадра
function shownSet(pk) {
  // 14.11.2026: каждая пара соседних открытых фасадов должна быть внутри ОДНОЙ показанной заплатки (комбо) — иначе в одиночной заплатке
  // виден торец закрытой соседки (серая полоска на Gola). Комбо могут перекрываться (13+15 и 15+17): там, где заплатка показывает
  // чужой закрытый фасад, глубина «далеко» (cut_l6), и выигрывает та, где он открыт.
  const S = new Set([...opened, ...KEEPOPEN].filter(x => !HOLD.has(x) && !reqOf(GBY[x]).some(r => HOLD.has(r)) && !(ALLMODE && ALIM[x] != null))), P = META.parts[pk] || {}, out = new Set();
  const combos = META.groups.filter(g => g.combo && P[g.id] && g.combo.every(m => S.has(m))).sort((a, b) => b.combo.length - a.combo.length);
  const pairKey = (a, b) => a < b ? a + ':' + b : b + ':' + a;
  const need = new Set();   // соседство берём из всех комбо проекта: пара, для которой есть общая заплатка, считается соседней
  META.groups.forEach(g => { if (!g.combo) return; for (let i = 0; i < g.combo.length; i++) for (let j = i + 1; j < g.combo.length; j++) if (S.has(g.combo[i]) && S.has(g.combo[j])) need.add(pairKey(g.combo[i], g.combo[j])); });
  const covered = new Set(), members = new Set();
  combos.forEach(c => {
    const pc = []; for (let i = 0; i < c.combo.length; i++) for (let j = i + 1; j < c.combo.length; j++) { const k = pairKey(c.combo[i], c.combo[j]); if (need.has(k) && !covered.has(k)) pc.push(k); }
    if (!pc.length) return;
    out.add(c.id); pc.forEach(k => covered.add(k)); c.combo.forEach(m => members.add(m));
  });
  S.forEach(m => { if (!members.has(m)) out.add(m); });
  return out;
}
function refresh(pk, instant, doneGid) {
  applyAllLimits(pk);
  Object.entries(patches).forEach(([k, r]) => { if (r.mesh && !k.startsWith(pk + '_')) { r.mesh.visible = false; r.mesh.material.opacity = 0; } });
  if (mode !== 'single' || !META) return;
  const want = shownSet(pk);
  // что было видно открытым до этого нажатия (сама группа или в составе общей заплатки)
  const before = LAST[pk] || new Set(), wasOpen = new Set();
  before.forEach(id => { wasOpen.add(id); ((GBY[id] || {}).combo || []).forEach(m => wasOpen.add(m)); });
  const willOpen = new Set(); want.forEach(id => { willOpen.add(id); ((GBY[id] || {}).combo || []).forEach(m => willOpen.add(m)); });
  LAST[pk] = new Set(want);
  opened.forEach(gid => loadPatch(pk, gid));                 // маски створок нужны для попадания пальцем
  Object.keys(META.parts[pk] || {}).forEach(async gidS => {
    const gid = +gidS, rec0 = patches[pk + '_' + gid];
    if (!want.has(gid)) {
      if (rec0 && rec0.mesh && rec0.mesh.visible && rec0.mesh.material.opacity > 0) {
        // уходит, но остаётся открытым в составе новой общей заплатки — гасим только после того, как та проявится (иначе сосед «мигает»)
        const stays = (GBY[gid].combo || [gid]).every(m => willOpen.has(m));
        fadeMesh(rec0.mesh, 0, stays ? 200 : 750, stays ? 1000 : 0);
      }
      return;
    }
    let rec = await loadPatch(pk, gid, true);
    if (rec) rec = await ensureTex(rec, 0);
    if (!rec || cur.id !== pk || mode !== 'single' || !shownSet(pk).has(gid)) return;
    upPatch(rec);
    if (rec.mesh.visible && rec.mesh.material.opacity >= 0.99) return;
    // уже был открыт (был внутри общей заплатки) — показываем сразу, без проявления
    const already = (GBY[gid].combo || [gid]).every(m => wasOpen.has(m)) || (doneGid && (GBY[gid].combo || [gid]).includes(doneGid));
    if (instant || already) { for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].m === rec.mesh.material) tweens.splice(i, 1);
      rec.mesh.visible = true; rec.mesh.material.opacity = 1; setTop(rec.mesh); } else fadeMesh(rec.mesh, 1);
  });
}
function applyOpened(pk, instant) { refresh(pk, instant); }
async function applyAllLimits(pk) {
  for (const key of [...ALLSHOWN]) { const r = AREC[key]; if (!ALLMODE || !key.startsWith(pk + '_') || !opened.has(+key.split('_')[1])) { if (r && r.mesh && !ACT[key]) animOut(r, 200); ALLSHOWN.delete(key); } }
  if (!ALLMODE) return;
  for (const [gs, k] of Object.entries(ALIM)) {
    const gid = +gs, key = pk + '_' + gid; if (!opened.has(gid) || !k || !ANIM || !ANIM[pk] || !ANIM[pk][gid]) continue;
    const rec = await loadAnim(pk, gid); if (!rec || !rec.ready || !ALLMODE || cur.id !== pk) continue;
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].m === rec.mesh.material) tweens.splice(i, 1);
    rec.mesh.material.map = rec.tex[Math.min(rec.tex.length, k) - 1]; rec.tex.forEach(upTex);
    const own = patches[key]; const lo = own && own.u && own.depth ? own.u.dr.value.x : null;
    rec.mesh.renderOrder = 1e7; if (lo) { rec.mesh.material.depthTest = true; rec.mesh.material.uniforms.dz.value = Math.max(0, lo - 0.002); } else rec.mesh.material.depthTest = false;
    if (!rec.mesh.visible) { rec.mesh.material.opacity = 0; rec.mesh.visible = true; tweens.push({ m: rec.mesh.material, from: 0, to: 1, t0: performance.now(), dur: 900 }); }
    ALLSHOWN.add(key);
  }
}
function hideAllPatches() { Object.values(patches).forEach(r => { if (r.mesh && r.mesh.visible) fadeMesh(r.mesh, 0, 300); }); }

// что под пальцем: сначала открытые заплатки (верхняя первой), потом карта фасадов
function pick(u, v) {
  if (!META) return 0;
  const [W, H] = META.res, x = u * W, y = v * H;
  let best = 0, bestD = 9;
  for (const g of META.groups) {
    if (!g.req || !g.req.length) continue;
    const ok = g.req.every(nm => { const d = META.groups.find(y => !y.combo && y.movs[0] === nm); return d && opened.has(d.id); });
    if (!ok) continue;
    const r = patches[cur.id + '_' + g.id]; if (!r || !r.px) continue;
    const [X0, Y0, X1, Y1] = r.px; if (x < X0 || x >= X1 || y < Y0 || y >= Y1) continue;
    const fx = (x - X0) / (X1 - X0), fy = (y - Y0) / (Y1 - Y0);
    if (opened.has(g.id) && r.alpha) { if (r.alpha.d[(Math.floor(fy * r.alpha.h) * r.alpha.w + Math.floor(fx * r.alpha.w)) * 4 + 3] > 140) return g.id; continue; }
    if (r.pick && r.pick.d[(Math.floor(fy * r.pick.h) * r.pick.w + Math.floor(fx * r.pick.w)) * 4] > 127) return g.id;
  }
  for (const [k, r] of Object.entries(patches)) {
    if (!k.startsWith(cur.id + '_') || !r.alpha || !opened.has(+k.split('_')[1])) continue;
    const [X0, Y0, X1, Y1] = r.px; if (x < X0 || x >= X1 || y < Y0 || y >= Y1) continue;
    const fx = (x - X0) / (X1 - X0), fy = (y - Y0) / (Y1 - Y0);
    const ax = Math.floor(fx * r.alpha.w), ay = Math.floor(fy * r.alpha.h);
    if (r.alpha.d[(ay * r.alpha.w + ax) * 4 + 3] <= 140) continue;
    let d = 1 - r.mesh.renderOrder * 1e-4;                 // без глубины — по порядку открытия
    if (r.depth) { const i = (Math.floor(fy * r.depth.h) * r.depth.w + Math.floor(fx * r.depth.w)) * 4; d = (r.depth.d[i] + r.depth.d[i + 1] / 255) / 255; }
    if (d < bestD) { bestD = d; best = +k.split('_')[1]; }
  }
  if (best) return best;
  const m = idsNow; if (!m) return 0;
  const ix = Math.min(m.w - 1, Math.floor(u * m.w)), iy = Math.min(m.h - 1, Math.floor(v * m.h));
  return Math.round(m.data[(iy * m.w + ix) * (m.c || 4)] / ((META && META.idk) || 4));
}
let idsNow = null;
const nameOf = (g) => (g.combo ? g.label : (LABEL[g.movs[0]] || g.label));
const toastEl = document.getElementById('toast'); let toastT = 0;
function toast(g, open, noPatch) {
  toastEl.innerHTML = '<b>' + nameOf(g) + '</b> <span>' + (noPatch ? '— отсюда не видно, откройте в другой точке' : ((open ^ !!g.inv) ? 'открыт' : 'закрыт')) + '</span>';
  toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1600);
}

// ---- панорамы, точки, режимы ----
let cur = PTS[0], mode = 'single', top = 0, fade = null; let floor = '';
let lon = 0, lat = 0, fov = 70;
function aimAt(pt) { [lon, lat] = aimOf(pt); }
// ---- загрузка точки (вариант 2, пользователь 15.11): скачиваем ВСЁ для точки — плитки панорамы, карту фасадов, плитки заплаток,
// кадры анимации; на экране — проценты и «скачано из», МБ. Точка показывается, когда всё скачано и видимые плитки уже в видеокарте.
const bootEl = document.getElementById('boot'), bootT = document.getElementById('bootT'), bootN = document.getElementById('bootN'), bootI = document.getElementById('bootI'), bootM = document.getElementById('bootM');
const READY = new Set(); let booted = false;
const mb = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',');
function setBoot(f, got, tot) {
  const p = Math.max(0, Math.min(100, Math.floor(f * 100))); bootN.textContent = p + '%'; bootI.style.width = p + '%';
  if (tot) bootM.textContent = 'скачано ' + mb(got) + ' из ' + mb(tot) + ' МБ' + (tot > got ? ' · осталось ' + mb(tot - got) + ' МБ' : '');
}
function ptFiles(pk) { const P = MAN && MAN.points[pk]; return P ? P.files : []; }
function ptBytes(pk) { const P = MAN && MAN.points[pk]; return P ? P.bytes : 0; }
function ptGot(pk) { let g = 0; for (const [u, b] of ptFiles(pk)) g += Math.min(b, GOTU[u] || 0); return g; }
async function fetchPoint(pk, conc) {             // скачать все файлы точки в память (пачки режутся на файлы)
  const files = ptFiles(pk); let i = 0;
  const one = async () => { while (i < files.length) { const [u, , mem] = files[i++]; await (mem ? loadPack(u) : prefetch(u)); } };
  await Promise.all(Array.from({ length: conc || 6 }, one));
}
async function preparePoint(pt, silent) {
  const key = pt.id + floor;
  if (READY.has(key)) return;
  await manP;
  const tot = ptBytes(pt.id);
  if (PREP[key]) {
    if (silent) { await PREP[key]; return; }
    bumpJobs(u => u.startsWith(D + 'parts/' + pt.id + '_'), 0);   // точку готовили в фоне — теперь она нужна срочно
    texQ++;                                                   // фоновая заливка заплаток прежней точки — на паузу
    showBootSoon(pt); const iv = setInterval(() => setBoot(PREPF[key] ? PREPF[key]() : 0, ptGot(pt.id), tot), 100);
    await PREP[key]; clearInterval(iv); setBoot(1, tot, tot); return;
  }
  let res; PREP[key] = new Promise(r => { res = r; });
  if (!silent) showBootSoon(pt);
  await metaP;
  const gids = META && META.parts[pt.id] ? Object.keys(META.parts[pt.id]) : [];
  let done = 0; const nd = gids.length + 1;
  const frac = () => 0.85 * Math.min(1, (ptGot(pt.id)) / (tot || 1)) + 0.15 * done / nd; PREPF[key] = frac;
  const iv = setInterval(() => { if (!silent) setBoot(frac(), ptGot(pt.id), tot); }, 100);
  await fetchPoint(pt.id, silent ? 3 : 6);
  const pr = [loadIds(pt.id, silent ? 2 : 0).then(() => { done++; })];
  gids.forEach(g => { const p = loadPatch(pt.id, g, false, silent ? 2 : 0); if (p) pr.push(p.then(() => { done++; }, () => { done++; })); else done++; });
  await Promise.allSettled(pr); clearInterval(iv);
  READY.add(key); res();
  if (!silent) setBoot(1, tot, tot);
}
function hideBoot() { clearTimeout(bootTimer); setTimeout(() => bootEl.classList.add('off'), 150); booted = true; }
const PREP = {}, PREPF = {}; let bootTimer = 0;
// экран загрузки — сразу при первом входе, при переходах — только если точка ещё не готова через 250 мс
function showBootSoon(pt) {
  const on = () => { bootT.textContent = booted ? ('Загружаем: ' + pt.name + '…') : (TOUR.bootText || 'Загружаем…');
    bootEl.classList.toggle('soft', booted); bootEl.classList.remove('off'); };
  clearTimeout(bootTimer);
  if (!booted) { setBoot(0); on(); } else bootTimer = setTimeout(on, 250);
}
// после первой точки: остальные — по удалённости, в фоне (индикатор в углу). На компьютере ещё и разбираем маски/глубину заранее
let warmStarted = false; const bgEl = document.getElementById('bg');
async function warmAll() {
  if (warmStarted) return; warmStarted = true;
  await metaP; await manP; if (!META) return;
  const full = HI || (navigator.deviceMemory || 4) >= 8;
  const rest = PTS.filter(q => q !== cur).sort((a, b) => Math.hypot(a.p[0] - cur.p[0], a.p[1] - cur.p[1]) - Math.hypot(b.p[0] - cur.p[0], b.p[1] - cur.p[1]));
  const all = rest.reduce((s, q) => s + ptBytes(q.id), 0);
  const iv = setInterval(() => {
    const got = rest.reduce((s, q) => s + ptGot(q.id), 0), n = rest.filter(q => ptGot(q.id) >= ptBytes(q.id)).length;
    bgEl.textContent = 'Остальные точки: ' + n + ' из ' + rest.length + ' · ' + mb(got) + ' из ' + mb(all) + ' МБ'; bgEl.style.opacity = n < rest.length ? 1 : 0;
    if (n >= rest.length) clearInterval(iv);
  }, 400);
  for (const q of rest) {
    await fetchPoint(q.id, 3);
    if (full) await preparePoint(q, true);
  }
}
let showSeq = 0;
function aimOf(pt) { const d = b2t([pt.look[0] - pt.p[0], pt.look[1] - pt.p[1], pt.look[2] - pt.p[2]]).normalize(); return [Math.atan2(d.z, d.x), Math.asin(d.y)]; }
async function show(pt, md, keepView) {
  const my = ++showSeq;                                // быстрые нажатия по точкам: показываем только последнюю
  await preparePoint(pt);
  if (my !== showSeq) return;
  if (fade) { fade.L.opacity = 1; fade = null; }       // предыдущий наплыв не закончился — доводим сразу
  const next = 1 - top, L = layers[next], [tlo, tla] = keepView ? [lon, lat] : aimOf(pt);
  if (keepView || L.pk !== pt.id) L.clear();
  L.setPoint(pt.id); L.opacity = 0;
  await warmLayer(L, tlo, tla, fov);                   // превью + видимые плитки — в видеокарте до показа
  if (my !== showSeq) { L.clear(); return; }
  hideBoot();
  if (!keepView) { lon = tlo; lat = tla; }
  L.setBase(2); layers[top].setBase(1); L.setActive(true);
  const samePt = pt === cur;
  if (fade) { fade.L.opacity = 1; fade = null; }
  fade = { L, from: layers[top], t0: performance.now(), dur: keepView ? 450 : 600 };
  top = next; cur = pt; mode = md; buildSpots(); ui();
  idsNow = null; loadIds(pt.id).then(x => { if (cur === pt) idsNow = x; });
  if (md === 'single') applyOpened(pt.id, !samePt); else hideAllPatches();
  setTimeout(() => {                                   // фоновая подгрузка
    metaP.then(() => { if (META && META.parts[pt.id]) Object.keys(META.parts[pt.id]).forEach(gid => loadPatch(pt.id, gid)); });
    warmTex(pt.id);
    warmAll();
  }, 400);
  setTimeout(() => { if (cur === pt) animPrefetch(pt.id); }, 2500);
}
const ptsEl = document.getElementById('pts');
PTS.forEach(pt => {
  const b = document.createElement('button'); b.className = 'chip'; b.innerHTML = '<span class="dot"></span>' + pt.name;
  b.onclick = () => { if (pt !== cur) show(pt, mode, false); }; pt.btn = b; ptsEl.appendChild(b);
});
const stC = document.getElementById('stClosed'), stO = document.getElementById('stOpen');
stC.onclick = () => { animStopAll(); ALLMODE = false; opened.clear(); hideAllPatches(); applyAllLimits(cur.id); ui(); };
stO.onclick = () => { if (!META) return; animStopAll(); opened.clear(); ALLMODE = true; META.groups.forEach(g => { if (!g.combo && !g.inv) opened.add(g.id); }); refresh(cur.id, false); ui(); };
function ui() {
  PTS.forEach(p => p.btn.setAttribute('aria-pressed', p === cur));
  const nAll = META ? META.groups.filter(g => !g.combo && !g.inv).length : -1; stO.setAttribute('aria-pressed', opened.size === nAll); stC.setAttribute('aria-pressed', opened.size === 0);
}

// кружки-переходы на полу
const spotsEl = document.getElementById('spots'); let spots = [];
function buildSpots() {
  spotsEl.innerHTML = ''; spots = [];
  PTS.forEach(q => {
    if (q === cur) return;
    const d = b2t([q.p[0] - cur.p[0], q.p[1] - cur.p[1], 0.02 - cur.p[2]]).normalize().multiplyScalar(400);
    const el = document.createElement('button'); el.className = 'spot'; el.setAttribute('aria-label', 'Перейти: ' + q.name);
    el.innerHTML = '<span>' + q.name + '</span>'; el.onclick = () => show(q, mode, false);
    spotsEl.appendChild(el); spots.push({ el, v: d });
  });
}

// ---- управление: перетаскивание, щипок, нажатие ----
const hint = document.getElementById('hint');
let drag = null; const ptrs = new Map(); let pinch0 = 0, fov0 = 70, tap = null;
const dirAt = (cx, cy) => new THREE.Vector3((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1, 0.5).unproject(camera).normalize();
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 1) { drag = { x: e.clientX, y: e.clientY, lon, lat }; tap = { x: e.clientX, y: e.clientY, t: performance.now() }; }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); fov0 = fov; drag = null; tap = null; }
  hint.style.opacity = 0;
});
canvas.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) {                       // наведение мышью: подсветить курсором кликабельное
    if (e.pointerType === 'mouse' && mode === 'single') { const [u, v] = t2uv(dirAt(e.clientX, e.clientY)); canvas.classList.toggle('hot', pick(u, v) > 0); }
    return;
  }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); fov = THREE.MathUtils.clamp(fov0 * pinch0 / d, 30, 95); return; }
  if (!drag) return;
  if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
  const k = (fov / 70) * 0.0045;
  lon = drag.lon - (e.clientX - drag.x) * k;
  lat = THREE.MathUtils.clamp(drag.lat + (e.clientY - drag.y) * k, -1.45, 1.45);
});
const up = e => {
  ptrs.delete(e.pointerId);
  if (ptrs.size === 0) {
    if (tap && e.type === 'pointerup' && performance.now() - tap.t < 600) onTap(e.clientX, e.clientY);
    drag = null; tap = null;
  }
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
function onTap(cx, cy) {
  const [u, v] = t2uv(dirAt(cx, cy)); const gid = pick(u, v);
  if (!gid) return;
  if (mode === 'all') { toastEl.innerHTML = '<span>Нажмите «Закрыть всё», чтобы открывать по одной</span>'; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1800); return; }
  setGroup(gid, !opened.has(gid)).then(ui); ui();
}
canvas.addEventListener('wheel', e => { e.preventDefault(); fov = THREE.MathUtils.clamp(fov * Math.exp(e.deltaY * 0.0012), 30, 95); hint.style.opacity = 0; }, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') lon -= 0.08; if (e.key === 'ArrowRight') lon += 0.08;
  if (e.key === 'ArrowUp') lat = Math.min(1.45, lat + 0.06); if (e.key === 'ArrowDown') lat = Math.max(-1.45, lat - 0.06);
});
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; if (w < h) fov = Math.max(fov, 80); }
addEventListener('resize', resize); resize();

const tmp = new THREE.Vector3(); let trimT = 0;
// статистика (кнопка с графиком): кадры/с, самый долгий кадр за 3 с, плитки и примерная видеопамять, скачано
const statsEl = document.getElementById('stats'), ft = []; let lastT = performance.now(), statT = 0;
document.getElementById('bStats').onclick = (e) => { const on = document.body.classList.toggle('stats'); e.currentTarget.setAttribute('aria-pressed', on); };
function stats(now) {
  const dt = now - lastT; lastT = now; ft.push([now, dt]); while (ft.length && now - ft[0][0] > 3000) ft.shift();
  if (!document.body.classList.contains('stats') || now - statT < 250 || !MAN) return; statT = now;
  const worst = Math.max(...ft.map(x => x[1])), fps = ft.length / Math.max(0.001, (now - ft[0][0]) / 1000);
  const pt = Object.values(patches).filter(r => r.texP && r.mesh && r.mesh.kids.length).length;
  statsEl.textContent = `кадров/с      ${fps.toFixed(0)}\nдолгий кадр   ${worst.toFixed(0)} мс (за 3 с)\nуровень       ${MAN.levels[needLevel(camera)]} px/грань\nплиток пан.   ${tilesUp}\nзаплаток в ВП ${pt}\nвидеопамять  ~${((STAT.tileB + STAT.patchB) / 1048576).toFixed(0)} МБ\nв очереди     ${TUPQ.length + tilesFly + UPQ.length + JOBQ.length}\nскачано       ${mb(DLB)} МБ`;
}
function frame(now) {
  stats(now);
  if (fade) {
    const k = Math.min(1, (now - fade.t0) / fade.dur); fade.L.opacity = k * k * (3 - 2 * k);
    if (k >= 1) { fade.L.opacity = 1; if (fade.from !== fade.L) fade.from.clear(); fade = null; }   // старая точка — из видеопамяти
  }
  stepAnims(now);
  tickTiles(now);
  pumpUploads(Object.keys(ACT).length ? 2 : 5);
  if (now - trimT > 1000) { trimT = now; trimPatchTex(); }
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i], k = Math.max(0, Math.min(1, (now - t.t0) / t.dur)), s = k * k * (3 - 2 * k);
    t.m.opacity = t.from + (t.to - t.from) * s; if (k >= 1) { tweens.splice(i, 1); t.end && t.end(); }
  }
  camera.fov = fov; camera.updateProjectionMatrix();
  camera.lookAt(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)); camera.updateMatrixWorld();
  renderer.render(scene, camera);
  const w = innerWidth, h = innerHeight;
  for (const s of spots) {
    tmp.copy(s.v).project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    s.el.style.display = vis ? 'block' : 'none';
    if (vis) { s.el.style.left = ((tmp.x + 1) / 2 * w) + 'px'; s.el.style.top = ((1 - tmp.y) / 2 * h) + 'px'; }
  }
  requestAnimationFrame(frame);
}
// свернуть описание / скрыть все кнопки (запоминается в этом браузере)
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
if (store.get(TOUR.id + '_fold') === '1') document.body.classList.add('folded');
document.getElementById('fold').onclick = () => { document.body.classList.add('folded'); store.set(TOUR.id + '_fold', '1'); };
document.getElementById('unfold').onclick = () => { document.body.classList.remove('folded'); store.set(TOUR.id + '_fold', '0'); };
const hideBtn = document.getElementById('hideui');
hideBtn.onclick = () => { const c = document.body.classList.toggle('clean'); hideBtn.setAttribute('aria-pressed', c); hideBtn.setAttribute('aria-label', c ? 'Показать кнопки' : 'Скрыть кнопки'); };
window.__pano = { layers, STAT, MAN: () => MAN, view(lo, la, f) { lon = lo; lat = la; if (f) fov = f; }, get lon() { return lon; }, get lat() { return lat; }, pick, setGroup, opened, patches, shownSet, AREC, ACT, HOLD, KEEPOPEN, loadAnim, JOBQ, WBUSY, get WKN() { return WK ? WK.length : 0; }, get ANIM() { return ANIM; }, get META() { return META; }, get cur() { return cur; }, t2uv, dirAt, aim(x, y, z, f) { aimAt({ p: cur.p, look: [x, y, z] }); if (f) fov = f; } };
const floorsEl = document.getElementById('floors');
function buildFloors() {
  const F = (META && META.floors) || []; floorsEl.innerHTML = ''; floorsEl.style.display = F.length > 1 ? '' : 'none';
  const lab = document.createElement('span'); lab.textContent = 'Пол'; lab.style.cssText = 'font-size:12.5px;color:var(--muted);padding:7px 6px 7px 10px'; floorsEl.appendChild(lab);
  F.forEach(([suf, name]) => {
    const b = document.createElement('button'); b.textContent = name; b.setAttribute('aria-pressed', suf === floor);
    b.onclick = () => { if (suf === floor) return; floor = suf; store.set(TOUR.id + '_floor', suf); buildFloors(); show(cur, mode, true); };
    floorsEl.appendChild(b);
  });
}
metaP.then(() => { const sv = store.get(TOUR.id + '_floor'); if (sv !== null && META && (META.floors || []).some(f => f[0] === sv)) floor = sv; buildFloors(); })
  .then(() => show(PTS[0], 'single', false)).then(() => setTimeout(() => hint.style.opacity = 0, 3500));
requestAnimationFrame(frame);

}
