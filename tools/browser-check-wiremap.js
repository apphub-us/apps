#!/usr/bin/env node
'use strict';
/**
 * Wire Map browser checks — Chromium (and WebKit where installed).
 *
 * NOT part of `npm test`. The Node suite is dependency-free and runs anywhere;
 * this needs Playwright and a real browser engine, so it is invoked explicitly:
 *
 *   node tools/browser-check-wiremap.js
 *
 * It covers what Node cannot: image decoding, canvas resize/encode, Blob
 * round-trips through native IndexedDB, and EXIF orientation against a real
 * fixture built byte by byte in the page.
 *
 * Desktop WebKit is a useful extra signal and nothing more. It is NOT iOS
 * Safari; the physical iPhone gate stays required.
 */
const path = require('path');

let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  console.log('Playwright is not installed — browser checks skipped.');
  console.log('These are optional; `npm run verify` does not depend on them.');
  process.exit(0);
}

const APP = 'file://' + path.join(__dirname, '..', 'wiremap.html');

// Optional override for environments where Playwright's own browser download
// is unavailable: point WIREMAP_CHROMIUM at any Chromium executable (with
// optional WIREMAP_CHROMIUM_ARGS, space-separated). Without the env var,
// behaviour is exactly as before.
function withExecOverride(name, engine) {
  if (name !== 'chromium' || !process.env.WIREMAP_CHROMIUM) return engine;
  const executablePath = process.env.WIREMAP_CHROMIUM;
  const args = (process.env.WIREMAP_CHROMIUM_ARGS || '').split(' ').filter(Boolean);
  return { launch: (opts) => engine.launch({ ...opts, executablePath, args }) };
}

async function run(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);

  const r = await page.evaluate(async () => {
    // ── Build a real EXIF APP1 segment. No library: 32 bytes, big-endian TIFF,
    //    one IFD0 entry, tag 0x0112 (Orientation), type SHORT, count 1.
    function exifApp1(orientation) {
      const p = [];
      p.push(0x45,0x78,0x69,0x66,0x00,0x00);              // "Exif\0\0"
      p.push(0x4D,0x4D,0x00,0x2A,0x00,0x00,0x00,0x08);    // MM, 42, IFD0 @8
      p.push(0x00,0x01);                                   // 1 entry
      p.push(0x01,0x12, 0x00,0x03, 0x00,0x00,0x00,0x01,   // tag, SHORT, count 1
             (orientation >> 8) & 0xff, orientation & 0xff, 0x00, 0x00);
      p.push(0x00,0x00,0x00,0x00);                         // no next IFD
      const len = p.length + 2;
      return Uint8Array.from([0xFF, 0xE1, (len >> 8) & 0xff, len & 0xff, ...p]);
    }
    async function withExif(blob, orientation) {
      const buf = new Uint8Array(await blob.arrayBuffer());
      if (buf[0] !== 0xFF || buf[1] !== 0xD8) throw new Error('not a JPEG');
      const app1 = exifApp1(orientation);
      const out = new Uint8Array(buf.length + app1.length);
      out.set(buf.subarray(0, 2), 0);            // SOI
      out.set(app1, 2);                          // APP1 immediately after SOI
      out.set(buf.subarray(2), 2 + app1.length);
      return new Blob([out], { type: 'image/jpeg' });
    }

    /**
     * Asymmetric source: LANDSCAPE pixel matrix, w x h.
     * Left quarter red, remainder blue, green square in the top-left corner.
     * Rotation is then unambiguous from colour alone.
     */
    async function makeSource(w, h) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#0000ff'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#ff0000'; x.fillRect(0, 0, Math.round(w / 4), h);
      x.fillStyle = '#00ff00'; x.fillRect(0, 0, Math.round(w / 12), Math.round(h / 6));
      return new Promise(res => c.toBlob(res, 'image/jpeg', 0.95));
    }

    async function sample(blob) {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      const g = c.getContext('2d');
      const at = (fx, fy) => {
        const d = g.getImageData(Math.round(bmp.width * fx), Math.round(bmp.height * fy), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const out = { w: bmp.width, h: bmp.height,
        topMid: at(0.5, 0.08), bottomMid: at(0.5, 0.92),
        leftMid: at(0.08, 0.5), rightMid: at(0.92, 0.5) };
      bmp.close();
      return out;
    }
    const near = (rgb, target) => Math.abs(rgb[0]-target[0]) < 70 && Math.abs(rgb[1]-target[1]) < 70 && Math.abs(rgb[2]-target[2]) < 70;
    const RED = [255,0,0], BLUE = [0,0,255];

    const out = {};

    // ── Orientation 1 (baseline, no rotation) ──
    const base = await makeSource(4000, 2000);
    const o1 = await WM.image.processImage(await withExif(base, 1));
    out.o1 = { w: o1.width, h: o1.height, path: o1.decodePath };
    const s1 = await sample(o1.blob);
    out.o1_leftIsRed = near(s1.leftMid, RED);
    out.o1_rightIsBlue = near(s1.rightMid, BLUE);

    // ── Orientation 6 = rotate 90° CW ──
    // Encoded matrix is 4000x2000 landscape; displayed it is 2000x4000 portrait.
    // The source LEFT edge (red) must become the displayed TOP.
    const o6 = await WM.image.processImage(await withExif(base, 6));
    out.o6 = { w: o6.width, h: o6.height, ow: o6.originalWidth, oh: o6.originalHeight,
               resized: o6.resized, path: o6.decodePath };
    out.o6_dimensionsSwapped = o6.width < o6.height;
    // Oriented longer side is 4000 -> scales to 2000, giving 1000x2000.
    out.o6_resizeUsedOrientedDims = (o6.width === 1000 && o6.height === 2000);
    const s6 = await sample(o6.blob);
    out.o6_topIsRed = near(s6.topMid, RED);
    out.o6_bottomIsBlue = near(s6.bottomMid, BLUE);

    // ── Orientation 8 = rotate 270° CW ──  source LEFT becomes displayed BOTTOM
    const o8 = await WM.image.processImage(await withExif(base, 8));
    out.o8 = { w: o8.width, h: o8.height, path: o8.decodePath };
    out.o8_dimensionsSwapped = o8.width < o8.height;
    const s8 = await sample(o8.blob);
    out.o8_bottomIsRed = near(s8.bottomMid, RED);
    out.o8_topIsBlue = near(s8.topMid, BLUE);

    // ── 6 and 8 must be mirror images of each other ──
    out.o6_and_o8_differ = out.o6_topIsRed && out.o8_bottomIsRed;

    // ── Persisted record must match what the user sees ──
    const db = WM.store.createStore(); await db.openDatabase();
    const NOW = Date.now();
    await db.putImage(WM.image.buildImageRecord({ id: 'exif6', blob: o6.blob, mime: o6.mime,
      width: o6.width, height: o6.height, bytes: o6.bytes, createdAt: NOW }));
    db.closeDatabase();
    const db2 = WM.store.createStore(); await db2.openDatabase();
    const back = await db2.getImage('exif6');
    const sBack = await sample(back.blob);
    out.persisted = { w: back.width, h: back.height, mime: back.mime };
    out.persistedMatchesVisible = (back.width === sBack.w && back.height === sBack.h);
    out.persistedStillUpright = near(sBack.topMid, RED);
    await db2.deleteImage('exif6'); db2.closeDatabase();

    // ── A small oriented image must swap dimensions without resizing ──
    const small = await makeSource(600, 300);
    const sm6 = await WM.image.processImage(await withExif(small, 6));
    out.small6 = { w: sm6.width, h: sm6.height, resized: sm6.resized };

    return out;
  });


  await browser.close();

  const checks = [
    ['orientation 1 is not rotated', r.o1_leftIsRed && r.o1_rightIsBlue],
    ['orientation 6 swaps dimensions to portrait', r.o6_dimensionsSwapped],
    ['orientation 6 rotates pixels: top red, bottom blue', r.o6_topIsRed && r.o6_bottomIsBlue],
    ['resize uses ORIENTED dimensions', r.o6_resizeUsedOrientedDims],
    ['orientation 8 swaps dimensions', r.o8_dimensionsSwapped],
    ['orientation 8 rotates the opposite way', r.o8_bottomIsRed && r.o8_topIsBlue],
    ['6 and 8 give opposite results', r.o6_and_o8_differ],
    ['persisted width/height match the visible image', r.persistedMatchesVisible],
    ['the image is still upright after reload', r.persistedStillUpright],
    ['a small oriented image swaps without resizing',
      r.small6.w === 300 && r.small6.h === 600 && !r.small6.resized],
  ];
  return { engine: engineName, available: true, detail: r, checks, errs };
}


// ── WM-4: viewport, stage and Pointer Events ────────────────────────────────
async function runViewport(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);

  // Put a known 2000x1500 plan on the stage through the production path.
  await page.evaluate(async () => {
    async function plan(w, h, tint) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = tint; x.fillRect(0, 0, w, h);
      x.fillStyle = '#fff'; x.fillRect(0, 0, w / 10, h / 10);
      return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    }
    window.__makePlan = plan;
    // WM-5 replaced the single fixed image id with a real Job/Sheet, and the
    // probe now loads whichever sheet the meta store points at.
    const p = await WM.image.processImage(await plan(2000, 1500, '#204060'));
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'wm-dev-job', name: 'Wire Map Development', now }));
    await db.putImage(WM.image.buildImageRecord({ id: 'vp-img', blob: p.blob,
      mime: p.mime, width: p.width, height: p.height, bytes: p.bytes, createdAt: now }));
    await db.putSheet(WM.model.createSheet({ id: 'vp-sheet', jobId: 'wm-dev-job',
      name: 'Viewport check', kind: 'photo', imageId: 'vp-img',
      width: p.width, height: p.height, order: 0, now }));
    await db.setMeta('currentSheetId', 'vp-sheet');
    db.closeDatabase();
  });
  await page.click('#wm-dev-load');
  // getStageSize() is set inside showImage BEFORE the image's onload fires the
  // initial fit, so waiting on it alone races the fit. Wait for the image to
  // finish decoding and for the ResizeObserver to settle.
  await page.waitForFunction(() => {
    const img = document.getElementById('wm-background');
    return window.__wmStage && window.__wmStage.getStageSize() && img.complete && img.naturalWidth > 0;
  }, { timeout: 20000 });
  await page.waitForTimeout(150);

  const R = {};
  const read = () => page.evaluate(() => {
    const st = window.__wmStage;
    const stage = document.getElementById('wm-stage');
    const img = document.getElementById('wm-background');
    const svg = document.getElementById('wm-overlay');
    return {
      view: st.getViewport(), stageSize: st.getStageSize(),
      stageTransform: stage.style.transform,
      stageOrigin: stage.style.transformOrigin,
      imgTransform: img.style.transform || '(none)',
      svgTransform: svg.style.transform || '(none)',
      imgW: img.width, imgH: img.height,
      viewBox: svg.getAttribute('viewBox'),
      svgW: svg.getAttribute('width'), svgH: svg.getAttribute('height'),
      imgParent: img.parentElement.id, svgParent: svg.parentElement.id,
      imgVisible: !img.hidden && img.naturalWidth > 0,
      url: st.getObjectUrl(),
    };
  });

  // ── 1-6 structure and initial fit ──
  const s0 = await read();
  R.structure = { imgParent: s0.imgParent, svgParent: s0.svgParent,
                  imgTransform: s0.imgTransform, svgTransform: s0.svgTransform,
                  origin: s0.stageOrigin };
  R.stageMatchesImage = s0.stageSize.width === 2000 && s0.stageSize.height === 1500
                        && s0.imgW === 2000 && s0.imgH === 1500;
  R.viewBoxMatches = s0.viewBox === '0 0 2000 1500' && s0.svgW === '2000' && s0.svgH === '1500';
  R.imageRendered = s0.imgVisible;
  R.initialFit = await page.evaluate(() => {
    const st = window.__wmStage; const sz = st.getStageSize(); const v = st.getViewport();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const fit = WM.viewport.fitToViewport(sz, { width: el.width, height: el.height });
    return { matches: Math.abs(v.scale - fit.scale) < 1e-6
      && Math.abs(v.translateX - fit.translateX) < 1e-6
      && Math.abs(v.translateY - fit.translateY) < 1e-6, fit, actual: v };
  });
  R.wholePlanVisible = await page.evaluate(() => {
    const st = window.__wmStage, v = st.getViewport(), sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const c = [[0,0],[sz.width,0],[0,sz.height],[sz.width,sz.height]]
      .map(([x,y]) => WM.viewport.stageToScreen({x,y}, v));
    return c.every(p => p.x >= -1 && p.y >= -1 && p.x <= el.width+1 && p.y <= el.height+1);
  });

  // ── PAN ──
  // Zoom in first: at fit the scaled plan is smaller than the viewport and
  // clampTranslation deliberately CENTRES it, so panning is a no-op by design.
  await page.evaluate(() => {
    const st = window.__wmStage, sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    st._setViewport(WM.viewport.clampTranslation(
      WM.viewport.zoomAt(st.getViewport(), { x: el.width/2, y: el.height/2 }, 3),
      sz, { width: el.width, height: el.height }));
  });
  const box = await page.locator('#wm-viewport').boundingBox();
  const cx = box.x + box.width/2, cy = box.y + box.height/2;
  const before = (await read()).view;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx+60, cy+40, { steps: 6 }); await page.mouse.up();
  const afterPan = (await read()).view;
  R.pan = { moved: Math.abs(afterPan.translateX-before.translateX) > 20,
            scaleUnchanged: afterPan.scale === before.scale,
            dx: +(afterPan.translateX-before.translateX).toFixed(1) };

  // tiny movement below threshold must not pan
  const b2 = (await read()).view;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx+4, cy+2, { steps: 2 }); await page.mouse.up();
  const a2 = (await read()).view;
  R.thresholdHolds = a2.translateX === b2.translateX && a2.translateY === b2.translateY;

  // ── PINCH via real pointer events ──
  R.pinch = await page.evaluate(() => {
    const vpEl = document.getElementById('wm-viewport');
    const st = window.__wmStage;
    const r = vpEl.getBoundingClientRect();
    const send = (type, id, x, y) => vpEl.dispatchEvent(new PointerEvent(type, {
      pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerType: 'touch' }));
    const mid = { x: r.width/2, y: r.height/2 };
    const before = st.getViewport();
    const contentAtMid = WM.viewport.screenToStage(mid, before);

    send('pointerdown', 1, mid.x - 60, mid.y);
    send('pointerdown', 2, mid.x + 60, mid.y);
    send('pointermove', 1, mid.x - 140, mid.y);
    send('pointermove', 2, mid.x + 140, mid.y);
    const zoomed = st.getViewport();
    const afterAtMid = WM.viewport.screenToStage(mid, zoomed);
    const drift = Math.hypot(afterAtMid.x - contentAtMid.x, afterAtMid.y - contentAtMid.y);

    // move the midpoint while still pinching -> should pan
    send('pointermove', 1, mid.x - 140 + 50, mid.y);
    send('pointermove', 2, mid.x + 140 + 50, mid.y);
    const panned = st.getViewport();

    // lift one finger, then move the other: must not jump
    send('pointerup', 1, mid.x - 90, mid.y);
    const atHandoff = st.getViewport();
    send('pointermove', 2, mid.x + 190 + 1, mid.y);
    const afterHandoff = st.getViewport();
    send('pointerup', 2, mid.x + 191, mid.y);

    return {
      scaleIncreased: zoomed.scale > before.scale * 1.5,
      focalDriftPx: +drift.toFixed(3),
      midpointPanned: Math.abs(panned.translateX - zoomed.translateX) > 20,
      handoffJumpPx: +Math.hypot(afterHandoff.translateX - atHandoff.translateX - 1,
                                 afterHandoff.translateY - atHandoff.translateY).toFixed(3),
      scaleStableOnHandoff: Math.abs(afterHandoff.scale - atHandoff.scale) < 1e-9,
      pointersCleared: st.getActivePointers() === 0,
    };
  });

  // ── BOUNDS ──
  R.bounds = await page.evaluate(() => {
    const st = window.__wmStage, sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const view = { width: el.width, height: el.height };
    const extreme = WM.viewport.clampTranslation({ scale: 4, translateX: 1e6, translateY: 1e6 }, sz, view);
    const reachable = (v) => {
      const c = [[0,0],[sz.width,sz.height]].map(([x,y]) => WM.viewport.stageToScreen({x,y}, v));
      return !(c[1].x < 0 || c[1].y < 0 || c[0].x > view.width || c[0].y > view.height);
    };
    const floor = WM.viewport.minScaleFor(sz, view);
    return {
      extremePanStillReachable: reachable(extreme),
      belowMinClamped: WM.viewport.clampScaleFor(0.0001, sz, view) === floor,
      aboveMaxClamped: WM.viewport.clampScaleFor(9999, sz, view) === WM.viewport.MAX_SCALE,
      floor: +floor.toFixed(4), max: WM.viewport.MAX_SCALE,
    };
  });

  // ── RESIZE ──
  const zoomState = await page.evaluate(() => {
    const st = window.__wmStage, sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    st._setViewport(WM.viewport.clampTranslation(
      WM.viewport.zoomAt(st.getViewport(), { x: el.width/2, y: el.height/2 }, 3), sz,
      { width: el.width, height: el.height }));
    const v = st.getViewport();
    return { v, centre: WM.viewport.screenToStage({ x: el.width/2, y: el.height/2 }, v) };
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(250);
  R.resizeZoomed = await page.evaluate((prev) => {
    const st = window.__wmStage, v = st.getViewport(), sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const centre = WM.viewport.screenToStage({ x: el.width/2, y: el.height/2 }, v);
    const img = document.getElementById('wm-background');
    const svg = document.getElementById('wm-overlay');
    return {
      finite: Number.isFinite(v.scale) && Number.isFinite(v.translateX) && Number.isFinite(v.translateY),
      notResetToCorner: !(v.translateX === 0 && v.translateY === 0),
      centreDriftX: +Math.abs(centre.x - prev.centre.x).toFixed(0),
      alignmentHeld: (img.style.transform || '(none)') === '(none)'
                     && (svg.style.transform || '(none)') === '(none)',
      viewBox: svg.getAttribute('viewBox'),
    };
  }, zoomState);

  await page.evaluate(() => window.__wmStage.fit());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  R.resizeAtFit = await page.evaluate(() => {
    const st = window.__wmStage, v = st.getViewport(), sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const fit = WM.viewport.fitToViewport(sz, { width: el.width, height: el.height });
    return { refit: Math.abs(v.scale - fit.scale) < 1e-6 };
  });

  // ── REPLACEMENT ──
  R.replacement = await page.evaluate(async () => {
    const st = window.__wmStage;
    const oldUrl = st.getObjectUrl();
    let revoked = null;
    const real = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => { revoked = u; real(u); };
    const p = await WM.image.processImage(await window.__makePlan(900, 1600, '#603020'));
    await st.showImage(p.blob, p.width, p.height);
    URL.revokeObjectURL = real;
    const sz = st.getStageSize();
    const svg = document.getElementById('wm-overlay');
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const fit = WM.viewport.fitToViewport(sz, { width: el.width, height: el.height });
    return { oldRevoked: revoked === oldUrl, newSize: sz, viewBox: svg.getAttribute('viewBox'),
             refit: Math.abs(st.getViewport().scale - fit.scale) < 1e-6,
             urlChanged: st.getObjectUrl() !== oldUrl };
  });


  // ── layout: the canvas must stay the primary workspace in both orientations ──
  const measureLayout = () => page.evaluate(() => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    const header = document.querySelector('header');
    const vpEl = document.getElementById('wm-viewport');
    const bar = document.querySelector('.devbar');
    const st = window.__wmStage;
    const v = st.getViewport();
    const available = window.innerHeight - box(header).h;
    const img = document.getElementById('wm-background');
    const svg = document.getElementById('wm-overlay');
    return {
      win: { w: window.innerWidth, h: window.innerHeight },
      header: box(header).h,
      viewport: box(vpEl),
      devbar: bar ? box(bar).h : 0,
      shareOfAvailable: available > 0 ? viewportShare(box(vpEl).h, available) : 0,
      headerVisible: box(header).h > 0,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      finite: Number.isFinite(v.scale) && Number.isFinite(v.translateX) && Number.isFinite(v.translateY),
      sameStage: img.parentElement.id === 'wm-stage' && svg.parentElement.id === 'wm-stage',
      fitMatchesViewport: (() => {
        const sz = st.getStageSize();
        const b = vpEl.getBoundingClientRect();
        const fit = WM.viewport.fitToViewport(sz, { width: b.width, height: b.height });
        return Math.abs(v.scale - fit.scale) < 1e-6;
      })(),
    };
    function viewportShare(h, avail) { return Math.round((h / avail) * 1000) / 10; }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const portraitA = await measureLayout();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  const landscape = await measureLayout();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const portraitB = await measureLayout();
  R.layout = { portraitA, landscape, portraitB };

  // ── tap must not zoom, and pinch-out must reach the floor (iPhone defects) ──
  R.tap = await page.evaluate(() => {
    const vpEl = document.getElementById('wm-viewport');
    const st = window.__wmStage;
    const rect = vpEl.getBoundingClientRect();
    const send = (t, id, x, y, type) => vpEl.dispatchEvent(new PointerEvent(t, {
      pointerId: id, clientX: rect.left + x, clientY: rect.top + y,
      bubbles: true, pointerType: type }));
    const sz = st.getStageSize();
    const view = { width: rect.width, height: rect.height };
    const floor = WM.viewport.minScaleFor(sz, view);

    st._setViewport(WM.viewport.fitToViewport(sz, view));
    const start = st.getViewport();

    // One PHYSICAL iOS tap: the touch pair, then WebKit's compatibility pair.
    send('pointerdown', 11, 195, 350, 'touch'); send('pointerup', 11, 195, 350, 'touch');
    const afterTouch = st.getViewport();
    send('pointerdown', 12, 195, 350, 'mouse'); send('pointerup', 12, 195, 350, 'mouse');
    const afterCompat = st.getViewport();

    // Two deliberate rapid taps.
    send('pointerdown', 13, 195, 350, 'touch'); send('pointerup', 13, 195, 350, 'touch');
    send('pointerdown', 14, 197, 351, 'touch'); send('pointerup', 14, 197, 351, 'touch');
    const afterTwoTaps = st.getViewport();

    // Pinch in, then all the way back out, then release.
    send('pointerdown', 21, 150, 350, 'touch'); send('pointerdown', 22, 250, 350, 'touch');
    send('pointermove', 22, 900, 350, 'touch');
    const zoomedIn = st.getViewport();
    send('pointerup', 21, 150, 350, 'touch'); send('pointerup', 22, 900, 350, 'touch');

    send('pointerdown', 31, 100, 350, 'touch'); send('pointerdown', 32, 340, 350, 'touch');
    send('pointermove', 32, 101, 350, 'touch');
    const pinchedOut = st.getViewport();
    send('pointerup', 31, 100, 350, 'touch');
    const afterFirstRelease = st.getViewport();
    send('pointerup', 32, 101, 350, 'touch');
    const afterBothReleased = st.getViewport();

    const same = (a, b) => Math.abs(a.scale - b.scale) < 1e-9
      && Math.abs(a.translateX - b.translateX) < 1e-9
      && Math.abs(a.translateY - b.translateY) < 1e-9;

    return {
      singleTapUnchanged: same(start, afterTouch) && same(start, afterCompat),
      twoTapsUnchanged: same(start, afterTwoTaps),
      pinchInZoomed: zoomedIn.scale > start.scale * 2,
      pinchOutReachedFloor: Math.abs(pinchedOut.scale - floor) < 1e-6,
      floor: +floor.toFixed(4),
      scaleAfterPinchOut: +pinchedOut.scale.toFixed(4),
      noBounceOnRelease: Math.abs(afterBothReleased.scale - pinchedOut.scale) < 1e-9
        && Math.abs(afterFirstRelease.scale - pinchedOut.scale) < 1e-9,
      pointersCleared: st.getActivePointers() === 0,
    };
  });

  // ── placeholder state (WM-4 iPhone defect) ──
  R.placeholder = await page.evaluate(() => {
    const read = () => {
      const e = document.getElementById('wm-empty');
      const r = e.getBoundingClientRect();
      return { hiddenAttr: e.hidden, display: getComputedStyle(e).display,
               painted: r.width > 0 && r.height > 0 };
    };
    const st = window.__wmStage;
    const loaded = read();
    st.clear();
    const cleared = read();
    return { whenLoaded: loaded, whenCleared: cleared, hasImageAfterClear: st.hasImage() };
  });

  await browser.close();

  const checks = [
    ['portrait viewport has a useful height', R.layout.portraitA.viewport.h > 300],
    ['LANDSCAPE viewport does not collapse into a strip', R.layout.landscape.viewport.h > 200],
    ['landscape canvas keeps the majority of the available height',
      R.layout.landscape.shareOfAvailable > 50],
    ['the temporary probe does not dominate landscape',
      R.layout.landscape.devbar < R.layout.landscape.viewport.h],
    ['the header stays visible in landscape', R.layout.landscape.headerVisible],
    ['no horizontal overflow in either orientation',
      !R.layout.portraitA.horizontalOverflow && !R.layout.landscape.horizontalOverflow],
    ['fit uses the real viewport dimensions in landscape', R.layout.landscape.fitMatchesViewport],
    ['no NaN after rotating', R.layout.landscape.finite && R.layout.portraitB.finite],
    ['image and SVG stay in the same stage across rotation',
      R.layout.landscape.sameStage && R.layout.portraitB.sameStage],
    ['portrait to landscape and back leaves no size drift',
      R.layout.portraitA.viewport.h === R.layout.portraitB.viewport.h
      && R.layout.portraitA.viewport.w === R.layout.portraitB.viewport.w],
    ['a single iOS tap (touch + compatibility pair) does not change the transform',
      R.tap.singleTapUnchanged],
    ['two rapid taps do not change the transform', R.tap.twoTapsUnchanged],
    ['pinch in increases the scale', R.tap.pinchInZoomed],
    ['pinch out reaches the effective floor', R.tap.pinchOutReachedFloor],
    ['releasing after pinch does not bounce the scale', R.tap.noBounceOnRelease],
    ['pointer state is clear after the whole sequence', R.tap.pointersCleared],
    ['placeholder is hidden while a plan is displayed',
      R.placeholder.whenLoaded.hiddenAttr && R.placeholder.whenLoaded.display === 'none'
      && !R.placeholder.whenLoaded.painted],
    ['placeholder returns when the stage is cleared',
      !R.placeholder.whenCleared.hiddenAttr && R.placeholder.whenCleared.display !== 'none'
      && R.placeholder.whenCleared.painted && !R.placeholder.hasImageAfterClear],
    ['image and SVG share one transformed stage',
      R.structure.imgParent === 'wm-stage' && R.structure.svgParent === 'wm-stage'
      && R.structure.imgTransform === '(none)' && R.structure.svgTransform === '(none)'],
    ['transform-origin is 0 0', R.structure.origin === '0px 0px'],
    ['stage dimensions equal the stored image', R.stageMatchesImage],
    ['SVG viewBox matches the image', R.viewBoxMatches],
    ['the image actually rendered', R.imageRendered],
    ['initial transform equals fitToViewport', R.initialFit.matches],
    ['the whole plan is visible initially', R.wholePlanVisible],
    ['one-finger pan moves the stage', R.pan.moved],
    ['panning does not change the scale', R.pan.scaleUnchanged],
    ['sub-threshold movement does not pan', R.thresholdHolds],
    ['pinch increases the scale', R.pinch.scaleIncreased],
    ['content stays under the pinch midpoint', R.pinch.focalDriftPx < 1],
    ['a moving midpoint pans', R.pinch.midpointPanned],
    ['lifting one finger does not jump', R.pinch.handoffJumpPx < 1],
    ['the scale is stable across the hand-off', R.pinch.scaleStableOnHandoff],
    ['pointer state is cleared afterwards', R.pinch.pointersCleared],
    ['an extreme pan leaves the plan reachable', R.bounds.extremePanStillReachable],
    ['scale below the floor is clamped', R.bounds.belowMinClamped],
    ['scale above MAX_SCALE is clamped', R.bounds.aboveMaxClamped],
    ['resize while zoomed keeps a finite transform', R.resizeZoomed.finite],
    ['resize does not reset to the corner', R.resizeZoomed.notResetToCorner],
    ['resize preserves the centred content', R.resizeZoomed.centreDriftX < 200],
    ['image/SVG alignment survives resize', R.resizeZoomed.alignmentHeld],
    ['resize at fit refits', R.resizeAtFit.refit],
    ['replacing an image revokes the old object URL', R.replacement.oldRevoked],
    ['replacement updates stage size and viewBox',
      R.replacement.newSize.width === 900 && R.replacement.viewBox === '0 0 900 1600'],
    ['replacement refits', R.replacement.refit],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-5: wire labels ───────────────────────────────────────────────────────
async function runLabels(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);

  // import a real plan through the production path
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    const x = c.getContext('2d'); x.fillStyle = '#1d3a5c'; x.fillRect(0, 0, 2000, 1500);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const f = new File([blob], 'plan.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer(); dt.items.add(f);
    const input = document.getElementById('wm-dev-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__wmStage.hasImage(), { timeout: 20000 });
  await page.waitForTimeout(300);

  const R = {};
  const vpBox = await page.locator('#wm-viewport').boundingBox();
  const send = (type, id, x, y, ptype) => page.evaluate(({ type, id, x, y, ptype }) => {
    const el = document.getElementById('wm-viewport');
    const r = el.getBoundingClientRect();
    const target = document.elementFromPoint(r.left + x, r.top + y) || el;
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x,
      clientY: r.top + y, bubbles: true, pointerType: ptype || 'touch' }));
  }, { type, id, x, y, ptype });

  const state = () => page.evaluate(() => {
    const st = window.__wmStage;
    const labels = document.getElementById('wm-labels');
    const boxes = Array.from(labels.querySelectorAll('.wm-label-box'))
      .map(n => { const r = n.getBoundingClientRect(); return { w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; });
    return {
      count: st.getAnnotationCount(), nodes: labels.childNodes.length, boxes,
      editorOpen: !document.getElementById('wm-editor').hidden,
      armed: st.isArmed(), scale: +st.getViewport().scale.toFixed(4),
      inLabelsLayer: labels.childNodes.length === labels.querySelectorAll('.wm-label').length,
      otherLayersEmpty: ['wm-sketch','wm-routes','wm-selection']
        .every(id => document.getElementById(id).childNodes.length === 0),
    };
  });

  // ── 1. add label ──
  await page.click('#wm-add-label');
  R.armed = (await state()).armed;
  await send('pointerdown', 1, 195, 350); await send('pointerup', 1, 195, 350);
  await page.waitForTimeout(120);
  R.editorOpenedOnce = (await state()).editorOpen;
  // the iOS compatibility pair must NOT open a second editor / place a second label
  await send('pointerdown', 2, 195, 350, 'mouse'); await send('pointerup', 2, 195, 350, 'mouse');
  await page.waitForTimeout(120);
  R.stillOneEditor = (await state()).editorOpen && (await state()).count === 0;

  await page.fill('#wm-f-label', 'HR-7');
  await page.fill('#wm-f-from', 'Panel A / Ckt 18');
  await page.fill('#wm-f-to', 'Master Bedroom receptacles');
  await page.fill('#wm-f-cable', '12/2 MC');
  await page.fill('#wm-f-room', 'Master Bedroom');
  await page.fill('#wm-f-notes', 'Home run');
  await page.click('#wm-editor-save');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() === 1, { timeout: 10000 });
  const s1 = await state();
  R.afterSave = { count: s1.count, editorOpen: s1.editorOpen, inLabelsLayer: s1.inLabelsLayer,
                  otherLayersEmpty: s1.otherLayersEmpty };

  // ── 2. required field ──
  await page.click('#wm-add-label');
  await send('pointerdown', 3, 250, 450); await send('pointerup', 3, 250, 450);
  await page.waitForTimeout(120);
  await page.click('#wm-editor-save');
  R.emptyLabelRejected = await page.evaluate(() => ({
    open: !document.getElementById('wm-editor').hidden,
    error: document.getElementById('wm-editor-error').textContent,
    count: window.__wmStage.getAnnotationCount(),
  }));
  await page.click('#wm-editor-cancel');

  // ── 3. persistence ──
  R.persisted = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const sheetId = await db.getMeta('currentSheetId');
    const anns = await db.listAnnotations(sheetId);
    db.closeDatabase();
    const a = anns[0];
    return { count: anns.length, label: a.data.label, labelKey: a.data.labelKey,
             cable: a.data.cable, from: a.data.from, at: a.at,
             normalized: a.at.x >= 0 && a.at.x <= 1 && a.at.y >= 0 && a.at.y <= 1 };
  });

  // ── 4. constant size across zoom ──
  const sizeAt = async (scale) => {
    await page.evaluate((sc) => {
      const st = window.__wmStage, sz = st.getStageSize();
      const el = document.getElementById('wm-viewport').getBoundingClientRect();
      st._setViewport(WM.viewport.clampTranslation(
        WM.viewport.zoomAt(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }),
          { x: el.width / 2, y: el.height / 2 }, sc, WM.viewport.minScaleFor(sz, { width: el.width, height: el.height })),
        sz, { width: el.width, height: el.height }));
      st.renderLabels();
    }, scale);
    await page.waitForTimeout(60);
    return (await state()).boxes[0];
  };
  const atFit = await sizeAt(await page.evaluate(() => {
    const st = window.__wmStage, sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    return WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }).scale; }));
  const at4 = await sizeAt(4);
  const at8 = await sizeAt(8);
  R.constantSize = { atFit, at4, at8,
    stable: Math.abs(atFit.w - at4.w) < 1.5 && Math.abs(at4.w - at8.w) < 1.5
            && Math.abs(atFit.h - at8.h) < 1.5 };

  // ── 5. anchor stays on the plan ──
  R.anchor = await page.evaluate(() => {
    const st = window.__wmStage, sz = st.getStageSize();
    const a = Array.from({ length: 1 }, () => null) && null;
    const id = document.querySelector('.wm-label').getAttribute('data-annotation-id');
    const ann = st.getAnnotation(id);
    const stagePoint = WM.geometry.denormalizePoint(ann.at, sz);
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const drift = [];
    for (const sc of [0.195, 1, 4, 8]) {
      const v = WM.viewport.zoomAt(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }),
        { x: el.width / 2, y: el.height / 2 }, sc, WM.viewport.minScaleFor(sz, { width: el.width, height: el.height }));
      const back = WM.viewport.screenToStage(WM.viewport.stageToScreen(stagePoint, v), v);
      drift.push(Math.hypot(back.x - stagePoint.x, back.y - stagePoint.y));
    }
    return { maxDrift: +Math.max(...drift).toFixed(9), stored: ann.at };
  });

  // ── 6. drag the label; the plan must not pan ──
  await page.evaluate(() => window.__wmStage.fit());
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => {
    const st = window.__wmStage;
    const id = document.querySelector('.wm-label').getAttribute('data-annotation-id');
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const s = WM.viewport.stageToScreen(
      WM.geometry.denormalizePoint(st.getAnnotation(id).at, st.getStageSize()), st.getViewport());
    return { id, at: st.getAnnotation(id).at, screen: s, view: st.getViewport() };
  });
  await send('pointerdown', 10, before.screen.x, before.screen.y);
  for (const d of [12, 40, 70]) await send('pointermove', 10, before.screen.x + d, before.screen.y + d / 2);
  await send('pointerup', 10, before.screen.x + 70, before.screen.y + 35);
  await page.waitForTimeout(300);
  R.drag = await page.evaluate((b) => {
    const st = window.__wmStage;
    const a = st.getAnnotation(b.id);
    const v = st.getViewport();
    return { moved: a.at.x !== b.at.x || a.at.y !== b.at.y,
             planStayedPut: Math.abs(v.translateX - b.view.translateX) < 0.001
                         && Math.abs(v.translateY - b.view.translateY) < 0.001,
             stillNormalized: a.at.x >= 0 && a.at.x <= 1 && a.at.y >= 0 && a.at.y <= 1,
             editorOpen: !document.getElementById('wm-editor').hidden };
  }, before);
  R.dragPersisted = await page.evaluate(async (id) => {
    const db = WM.store.createStore(); await db.openDatabase();
    const a = await db.getAnnotation(id); db.closeDatabase();
    return { at: a.at };
  }, before.id);
  R.dragWroteThrough = JSON.stringify(R.dragPersisted.at)
    === JSON.stringify(await page.evaluate((id) => window.__wmStage.getAnnotation(id).at, before.id));

  // ── 7. tap a label opens the editor with its values ──
  const now = await page.evaluate((id) => {
    const st = window.__wmStage;
    return WM.viewport.stageToScreen(
      WM.geometry.denormalizePoint(st.getAnnotation(id).at, st.getStageSize()), st.getViewport());
  }, before.id);
  await send('pointerdown', 11, now.x, now.y); await send('pointerup', 11, now.x, now.y);
  await page.waitForTimeout(150);
  R.editOpens = await page.evaluate(() => ({
    open: !document.getElementById('wm-editor').hidden,
    label: document.getElementById('wm-f-label').value,
    cable: document.getElementById('wm-f-cable').value,
    deleteVisible: !document.getElementById('wm-editor-delete').hidden,
  }));
  await page.fill('#wm-f-label', 'HR-8');
  await page.click('#wm-editor-save');
  await page.waitForTimeout(300);
  R.edited = await page.evaluate(async (id) => {
    const db = WM.store.createStore(); await db.openDatabase();
    const a = await db.getAnnotation(id); db.closeDatabase();
    return { label: a.data.label, labelKey: a.data.labelKey };
  }, before.id);

  // ── 8. reload the sheet ──
  await page.reload();
  await page.waitForTimeout(200);
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() > 0, { timeout: 20000 });
  await page.waitForTimeout(200);
  R.afterReload = await page.evaluate(() => {
    const st = window.__wmStage;
    const id = document.querySelector('.wm-label').getAttribute('data-annotation-id');
    const a = st.getAnnotation(id);
    return { count: st.getAnnotationCount(), label: a.data.label, at: a.at,
             rendered: document.querySelectorAll('.wm-label').length };
  });
  R.reloadMatches = JSON.stringify(R.afterReload.at) === JSON.stringify(R.dragPersisted.at);

  // ── 9. delete ──
  const p9 = await page.evaluate(() => {
    const st = window.__wmStage;
    const id = document.querySelector('.wm-label').getAttribute('data-annotation-id');
    return { id, screen: WM.viewport.stageToScreen(
      WM.geometry.denormalizePoint(st.getAnnotation(id).at, st.getStageSize()), st.getViewport()) };
  });
  await send('pointerdown', 12, p9.screen.x, p9.screen.y); await send('pointerup', 12, p9.screen.x, p9.screen.y);
  await page.waitForTimeout(150);
  await page.click('#wm-editor-delete');
  await page.waitForTimeout(300);
  R.deleted = await page.evaluate(async (id) => {
    const db = WM.store.createStore(); await db.openDatabase();
    const a = await db.getAnnotation(id); db.closeDatabase();
    return { inStore: a !== null, onStage: window.__wmStage.getAnnotationCount(),
             rendered: document.querySelectorAll('.wm-label').length };
  }, p9.id);


  await browser.close();

  const checks = [
    ['Add Label arms placement', R.armed],
    ['a tap on the plan opens the editor', R.editorOpenedOnce],
    ['the iOS compatibility pair does not create a second label', R.stillOneEditor],
    ['saving creates exactly one label', R.afterSave.count === 1 && !R.afterSave.editorOpen],
    ['labels render only in the labels layer',
      R.afterSave.inLabelsLayer && R.afterSave.otherLayersEmpty],
    ['an empty label is rejected with a message',
      R.emptyLabelRejected.open && /required/i.test(R.emptyLabelRejected.error)
      && R.emptyLabelRejected.count === 1],
    ['all six fields persist to IndexedDB',
      R.persisted.label === 'HR-7' && R.persisted.cable === '12/2 MC'
      && R.persisted.from === 'Panel A / Ckt 18'],
    ['labelKey is model-derived', R.persisted.labelKey === 'hr-7'],
    ['stored coordinates are normalized', R.persisted.normalized],
    ['label size is constant from fit to 8x', R.constantSize.stable],
    ['the anchor does not drift across zoom levels', R.anchor.maxDrift < 1e-6],
    ['dragging a label moves it', R.drag.moved],
    ['dragging a label does NOT pan the plan', R.drag.planStayedPut],
    ['a dragged position stays normalized', R.drag.stillNormalized],
    ['a drag does not open the editor', !R.drag.editorOpen],
    ['the moved position is written through to storage', R.dragWroteThrough],
    ['tapping a label opens the editor with its values',
      R.editOpens.open && R.editOpens.label === 'HR-7'
      && R.editOpens.cable === '12/2 MC' && R.editOpens.deleteVisible],
    ['editing updates the record and its labelKey',
      R.edited.label === 'HR-8' && R.edited.labelKey === 'hr-8'],
    ['labels survive a page reload', R.afterReload.count === 1 && R.afterReload.rendered === 1],
    ['the reloaded position matches what was stored', R.reloadMatches],
    ['deleting removes it from storage, stage and DOM',
      !R.deleted.inStore && R.deleted.onStage === 0 && R.deleted.rendered === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-5: label text centring ───────────────────────────────────────────────
async function runLabelText(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);

  const r = await page.evaluate(async (labels) => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    c.getContext('2d').fillRect(0, 0, 2000, 1500);
    const p = await WM.image.processImage(await new Promise(x => c.toBlob(x, 'image/jpeg', 0.9)));
    await window.__wmStage.showImage(p.blob, p.width, p.height);
    const anns = labels.map((text, i) => WM.model.createAnnotation({
      id: 'a' + i, sheetId: 's1', type: 'wireLabel',
      at: { x: 0.2 + i * 0.25, y: 0.5 }, now: 1, data: { label: text } }));
    window.__wmStage.setAnnotations(anns);
    return Array.from(document.querySelectorAll('.wm-label')).map((g) => {
      const box = g.querySelector('.wm-label-box').getBoundingClientRect();
      const txt = g.querySelector('.wm-label-text').getBoundingClientRect();
      return {
        label: g.querySelector('.wm-label-text').textContent,
        bodyCx: +(box.left + box.width / 2).toFixed(2),
        textCx: +(txt.left + txt.width / 2).toFixed(2),
        bodyCy: +(box.top + box.height / 2).toFixed(2),
        textCy: +(txt.top + txt.height / 2).toFixed(2),
        dx: +((txt.left + txt.width / 2) - (box.left + box.width / 2)).toFixed(2),
        dy: +((txt.top + txt.height / 2) - (box.top + box.height / 2)).toFixed(2),
        overflowsX: txt.width > box.width,
      };
    });
  }, ['A1', 'HR-7', 'HR-776888']);

  // Centring must hold at every zoom, not only at fit.
  const atZoom = await page.evaluate(() => {
    const st = window.__wmStage, sz = st.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const out = [];
    for (const sc of [1, 4, 8]) {
      st._setViewport(WM.viewport.clampTranslation(
        WM.viewport.zoomAt(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }),
          { x: el.width / 2, y: el.height / 2 }, sc,
          WM.viewport.minScaleFor(sz, { width: el.width, height: el.height })),
        sz, { width: el.width, height: el.height }));
      st.renderLabels();
      const g = document.querySelector('.wm-label');
      const box = g.querySelector('.wm-label-box').getBoundingClientRect();
      const txt = g.querySelector('.wm-label-text').getBoundingClientRect();
      out.push({ scale: sc,
        dx: Math.abs((txt.left + txt.width / 2) - (box.left + box.width / 2)),
        dy: Math.abs((txt.top + txt.height / 2) - (box.top + box.height / 2)) });
    }
    return out;
  });

  await browser.close();

  const TOL = 1.0;   // CSS pixels
  const checks = [
    ['short label "A1" text is centred',
      Math.abs(r[0].dx) < TOL && Math.abs(r[0].dy) < TOL],
    ['normal label "HR-7" text is centred',
      Math.abs(r[1].dx) < TOL && Math.abs(r[1].dy) < TOL],
    ['long label "HR-776888" text is centred',
      Math.abs(r[2].dx) < TOL && Math.abs(r[2].dy) < TOL],
    ['no label text overflows its body', r.every((x) => !x.overflowsX)],
    ['every length shares the same vertical offset',
      Math.abs(r[0].dy - r[2].dy) < 0.25],
    ['centring holds at 1x, 4x and 8x',
      atZoom.every((z) => z.dx < TOL && z.dy < TOL)],
  ];
  return { engine: engineName, available: true, detail: { labels: r, atZoom }, checks, errs };
}

// ── WM-6A: arrows ───────────────────────────────────────────────────────────
async function runArrows(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);

  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    const x = c.getContext('2d'); x.fillStyle = '#1d3a5c'; x.fillRect(0, 0, 2000, 1500);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'p.jpg', { type: 'image/jpeg' }));
    const i = document.getElementById('wm-dev-file'); i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__wmStage.hasImage(), { timeout: 20000 });
  await page.waitForTimeout(300);

  const send = (type, id, x, y, ptype) => page.evaluate(({ type, id, x, y, ptype }) => {
    const el = document.getElementById('wm-viewport');
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + x, r.top + y) || el;
    t.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x,
      clientY: r.top + y, bubbles: true, pointerType: ptype || 'touch' }));
  }, { type, id, x, y, ptype });

  const R = {};

  // ── 1. a label first, to prove arrows do not disturb it ──
  await page.click('#wm-add-label');
  await send('pointerdown', 1, 320, 200); await send('pointerup', 1, 320, 200);
  await page.waitForTimeout(120);
  await page.fill('#wm-f-label', 'HR-7');
  await page.click('#wm-editor-save');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() === 1, { timeout: 10000 });

  // ── 2. draw an arrow ──
  await page.click('#wm-add-arrow');
  R.armed = await page.evaluate(() => window.__wmStage.isArrowArmed());
  await send('pointerdown', 2, 110, 220);
  for (const p of [[150, 250], [220, 300], [280, 340]]) await send('pointermove', 2, p[0], p[1]);
  R.previewShown = await page.evaluate(() => !!document.getElementById('wm-draft-arrow'));
  await send('pointerup', 2, 280, 340);
  await page.waitForTimeout(300);

  // iOS compatibility pair must not create a second arrow
  await send('pointerdown', 3, 280, 340, 'mouse'); await send('pointerup', 3, 280, 340, 'mouse');
  await page.waitForTimeout(200);

  const shape = () => page.evaluate(() => {
    const routes = document.getElementById('wm-routes');
    const labels = document.getElementById('wm-labels');
    const line = routes.querySelector('.wm-arrow-line');
    const hit = routes.querySelector('.wm-arrow-hit');
    const cs = line ? getComputedStyle(line) : null;
    const hitBox = hit ? hit.getBoundingClientRect() : null;
    return {
      arrowsInRoutes: routes.querySelectorAll('.wm-arrow').length,
      arrowsElsewhere: labels.querySelectorAll('.wm-arrow').length
        + document.getElementById('wm-sketch').childNodes.length,
      labelsInLabels: labels.querySelectorAll('.wm-label').length,
      // The head is now a sibling path with local inverse scale; a <marker>
      // could not hold a constant screen size (markerUnits is strokeWidth).
      hasArrowhead: !!routes.querySelector('.wm-arrow-head'),
      markerDefined: !!document.getElementById('wm-arrowhead'),
      strokeWidth: cs ? cs.strokeWidth : null,
      vectorEffect: cs ? (cs.vectorEffect || line.getAttribute('vector-effect')) : null,
      draftGone: !document.getElementById('wm-draft-arrow'),
      armed: window.__wmStage.isArrowArmed(),
    };
  });
  R.afterDraw = await shape();

  R.stored = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const sheetId = await db.getMeta('currentSheetId');
    const all = await db.listAnnotations(sheetId); db.closeDatabase();
    const arrows = all.filter(a => a.type === 'arrow');
    const labels = all.filter(a => a.type === 'wireLabel');
    const a = arrows[0];
    return { arrows: arrows.length, labels: labels.length, id: a.id,
      a: a.a, b: a.b,
      normalized: [a.a, a.b].every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) };
  });

  // ── 3. endpoints hold across zoom ──
  R.anchor = await page.evaluate((st) => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const stageA = WM.geometry.denormalizePoint(st.a, sz);
    const stageB = WM.geometry.denormalizePoint(st.b, sz);
    let max = 0;
    for (const sc of [0.195, 1, 4, 8]) {
      const v = WM.viewport.zoomAt(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }),
        { x: el.width / 2, y: el.height / 2 }, sc, WM.viewport.minScaleFor(sz, { width: el.width, height: el.height }));
      for (const p of [stageA, stageB]) {
        const back = WM.viewport.screenToStage(WM.viewport.stageToScreen(p, v), v);
        max = Math.max(max, Math.hypot(back.x - p.x, back.y - p.y));
      }
    }
    return { maxDrift: +max.toFixed(9) };
  }, R.stored);

  // Stroke weight and hit area, measured by HIT TESTING rather than by
  // getBoundingClientRect — which reports an SVG line's geometry, not its
  // rendered stroke, and so tells us nothing about either.
  R.stroke = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const out = { hitsAtOffset: [], missesFarAway: [], strokeWidthPx: [] };
    for (const sc of [0.195, 1, 8]) {
      // Centre the view ON the arrow at each zoom, otherwise the midpoint is
      // simply off-screen at 8x and the hit test measures nothing.
      const g0 = document.querySelector('.wm-arrow');
      const ann0 = s.getAnnotation(g0.getAttribute('data-annotation-id'));
      const centre = { x: (ann0.a.x + ann0.b.x) / 2, y: (ann0.a.y + ann0.b.y) / 2 };
      s._setViewport(WM.viewport.centerOnNormalized(centre, sz,
        { width: el.width, height: el.height }, s.getViewport(), sc));
      s.renderLabels();
      const g = document.querySelector('.wm-arrow');
      const id = g.getAttribute('data-annotation-id');
      const ann = s.getAnnotation(id);
      const v = s.getViewport();
      const p1 = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(ann.a, sz), v);
      const p2 = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(ann.b, sz), v);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      // unit normal to the line
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const at = (d) => {
        const e = document.elementFromPoint(el.left + mid.x + nx * d, el.top + mid.y + ny * d);
        let n = e;
        while (n && n !== vpEl) {
          const c = n.getAttribute && n.getAttribute('class');
          if (c && /(^|\s)wm-arrow(\s|$)/.test(c)) return true;
          if (c && /wm-arrow-hit/.test(c)) return true;
          n = n.parentNode;
        }
        return false;
      };
      out.hitsAtOffset.push(at(16));       // a finger 16px off the line
      out.missesFarAway.push(at(120));     // well clear of it
      out.strokeWidthPx.push(getComputedStyle(
        g.querySelector('.wm-arrow-line')).strokeWidth);
    }
    return out;
  });

  await page.evaluate(() => window.__wmStage.fit());
  await page.waitForTimeout(150);

  // ── 4. select and drag an endpoint ──
  const pre = await page.evaluate((id) => {
    const s = window.__wmStage;
    const a = s.getAnnotation(id);
    const sz = s.getStageSize();
    return { view: s.getViewport(), a: a.a, b: a.b,
      screenA: WM.viewport.stageToScreen(WM.geometry.denormalizePoint(a.a, sz), s.getViewport()) };
  }, R.stored.id);
  await send('pointerdown', 4, pre.screenA.x + 3, pre.screenA.y + 3);
  await send('pointerup', 4, pre.screenA.x + 3, pre.screenA.y + 3);
  await page.waitForTimeout(200);
  R.selected = await page.evaluate(() => ({
    id: window.__wmStage.getSelectedArrow(),
    handles: document.querySelectorAll('.wm-endpoint').length,
    handleHit: (() => { const t = document.querySelector('.wm-endpoint-target');
      const r = t.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); })(),
  }));

  const hA = await page.evaluate(() => {
    const t = document.querySelector('.wm-endpoint-target');
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  // Capture the transform at the TRUE drag boundary. Taking it earlier spans
  // the select tap, whose status-line update resizes the viewport element and
  // triggers a legitimate ResizeObserver refit — an unrelated change this check
  // would otherwise blame on the drag.
  const viewAtDragStart = await page.evaluate(() => window.__wmStage.getViewport());
  await send('pointerdown', 5, hA.x, hA.y);
  for (const d of [10, 40, 80]) await send('pointermove', 5, hA.x + d, hA.y + d / 2);
  await send('pointerup', 5, hA.x + 80, hA.y + 40);
  await page.waitForTimeout(350);
  R.endpointDrag = await page.evaluate(async (arg) => {
    const s = window.__wmStage;
    const live = s.getAnnotation(arg.id);
    const db = WM.store.createStore(); await db.openDatabase();
    const saved = await db.getAnnotation(arg.id); db.closeDatabase();
    const v = s.getViewport();
    return {
      startMoved: JSON.stringify(live.a) !== JSON.stringify(arg.a),
      endUnchanged: JSON.stringify(live.b) === JSON.stringify(arg.b),
      planStayedPut: Math.abs(v.translateX - arg.view.translateX) < 0.001
                  && Math.abs(v.translateY - arg.view.translateY) < 0.001,
      persistedMatches: JSON.stringify(saved.a) === JSON.stringify(live.a),
      stillNormalized: live.a.x >= 0 && live.a.x <= 1 && live.a.y >= 0 && live.a.y <= 1,
      transformBefore: arg.view,
      transformAfter: v,
      translationDelta: { dx: +(v.translateX - arg.view.translateX).toFixed(6),
                          dy: +(v.translateY - arg.view.translateY).toFixed(6),
                          dScale: +(v.scale - arg.view.scale).toFixed(9) },
      endpointBefore: arg.a,
      endpointAfter: live.a,
      gestureModeAfter: s.getGestureMode(),
      activePointersAfter: s.getActivePointers(),
    };
  }, { id: R.stored.id, a: pre.a, b: pre.b, view: viewAtDragStart });

  // ── visible line stroke: explicit stage-space compensation (WM-6A) ──
  R.stroke2 = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    // Measure the BASE width: a selected arrow deliberately draws heavier.
    s.selectArrow(null);
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const rows = [];
    for (const sc of [null, 1, 4, 8]) {
      if (sc) {
        s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
          { width: el.width, height: el.height }, s.getViewport(), sc));
      } else {
        s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
      }
      s.renderLabels();
      const line = document.querySelector('.wm-arrow-line');
      const hit = document.querySelector('.wm-arrow-hit');
      const head = document.querySelector('.wm-arrow-head');
      const scale = s.getViewport().scale;
      const attr = line.getAttribute('stroke-width');
      const lw = parseFloat(attr);
      const hw = parseFloat(hit.getAttribute('stroke-width'));
      const n = head.getAttribute('d').match(/-?[0-9.]+/g).map(Number);
      const tip = { x: n[0], y: n[1] }, c1 = { x: n[2], y: n[3] }, c2 = { x: n[6], y: n[7] };
      const group = line.parentNode;
      const kids = Array.from(group.childNodes).map((k) => k.getAttribute('class'));
      rows.push({
        scale, attrPresent: attr !== null, stageStroke: lw, screenStroke: lw * scale,
        expectedStage: 1.5 / scale,
        vectorEffect: getComputedStyle(line).vectorEffect,
        hitScreen: hw * scale,
        headLen: Math.hypot(tip.x - (c1.x + c2.x) / 2, tip.y - (c1.y + c2.y) / 2) * scale,
        headW: Math.hypot(c1.x - c2.x, c1.y - c2.y) * scale,
        headPaintedLast: kids[kids.length - 1] === 'wm-arrow-head',
      });
    }
    return rows;
  });

  // ── endpoint-drag ownership isolation (WM-6A regression) ──
  R.isolation = await page.evaluate(async () => {
    const s = window.__wmStage, sz = s.getStageSize();
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const fire = (t, id, x, y, pt) => {
      const tg = document.elementFromPoint(el.left + x, el.top + y) || vpEl;
      tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: el.left + x,
        clientY: el.top + y, bubbles: true, pointerType: pt || 'touch' }));
    };
    const id = document.querySelector('.wm-arrow').getAttribute('data-annotation-id');
    const handleAt = (which) => {
      const nodes = document.querySelectorAll('.wm-endpoint');
      for (const n of nodes) {
        if (n.getAttribute('data-endpoint') !== which) continue;
        const r = n.querySelector('.wm-endpoint-target').getBoundingClientRect();
        return { x: r.left + r.width / 2 - el.left, y: r.top + r.height / 2 - el.top };
      }
      return null;
    };
    const same = (a, b) => a.scale === b.scale
      && a.translateX === b.translateX && a.translateY === b.translateY;

    // Start from fit: an earlier block may have left the view zoomed, which
    // would put the arrow outside the viewport and make the select tap miss.
    s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
    s.renderLabels();

    // Ensure the arrow is selected so handles exist.
    const arrow0 = s.getAnnotation(id);
    const midS = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(
      { x: (arrow0.a.x + arrow0.b.x) / 2, y: (arrow0.a.y + arrow0.b.y) / 2 }, sz), s.getViewport());
    fire('pointerdown', 60, midS.x, midS.y); fire('pointerup', 60, midS.x, midS.y);

    const out = {};
    for (const which of ['a', 'b']) {
      const h = handleAt(which);
      if (!h) { out[which] = { error: 'no handle' }; continue; }
      const before = s.getViewport();
      const annBefore = s.getAnnotation(id);
      fire('pointerdown', which === 'a' ? 71 : 72, h.x, h.y);
      const atDown = { gestureMode: s.getGestureMode(),
        activePointers: s.getActivePointers(), view: s.getViewport() };
      [10, 40, 75].forEach((d) => fire('pointermove', which === 'a' ? 71 : 72, h.x + d, h.y + d / 2));
      const during = s.getViewport();
      fire('pointerup', which === 'a' ? 71 : 72, h.x + 75, h.y + 37);
      const after = s.getViewport();
      const annAfter = s.getAnnotation(id);
      const other = which === 'a' ? 'b' : 'a';
      out[which] = {
        noViewportPointerAtDown: atDown.activePointers === 0 && atDown.gestureMode === 'idle',
        transformUnchangedAtDown: same(before, atDown.view),
        transformUnchangedDuring: same(before, during),
        transformUnchangedAfter: same(before, after),
        delta: { dx: after.translateX - before.translateX,
                 dy: after.translateY - before.translateY,
                 dScale: after.scale - before.scale },
        thisEndMoved: JSON.stringify(annAfter[which]) !== JSON.stringify(annBefore[which]),
        otherEndUnchanged: JSON.stringify(annAfter[other]) === JSON.stringify(annBefore[other]),
        stillSelected: s.getSelectedArrow() === id,
        arrowCount: document.querySelectorAll('.wm-arrow').length,
        gestureModeAfter: s.getGestureMode(),
        activePointersAfter: s.getActivePointers(),
      };
    }

    // pointercancel must restore the endpoint and leave the transform alone.
    const h = handleAt('a');
    const beforeCancel = s.getViewport();
    const annBeforeCancel = s.getAnnotation(id);
    fire('pointerdown', 73, h.x, h.y);
    [15, 60].forEach((d) => fire('pointermove', 73, h.x + d, h.y + d));
    vpEl.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 73, bubbles: true }));
    out.cancel = {
      endpointRestored: JSON.stringify(s.getAnnotation(id).a) === JSON.stringify(annBeforeCancel.a),
      transformUnchanged: same(beforeCancel, s.getViewport()),
      pointersCleared: s.getActivePointers() === 0,
    };

    // iOS: touch drag on the handle, then the synthesised mouse pair.
    const h2 = handleAt('a');
    const beforeIos = s.getViewport();
    const annBeforeIos = s.getAnnotation(id);
    const writes = [];
    fire('pointerdown', 74, h2.x, h2.y, 'touch');
    [12, 50].forEach((d) => fire('pointermove', 74, h2.x + d, h2.y, 'touch'));
    fire('pointerup', 74, h2.x + 50, h2.y, 'touch');
    const afterTouch = s.getAnnotation(id).a;
    fire('pointerdown', 75, h2.x + 50, h2.y, 'mouse');
    fire('pointerup', 75, h2.x + 50, h2.y, 'mouse');
    out.ios = {
      movedOnce: JSON.stringify(afterTouch) !== JSON.stringify(annBeforeIos.a),
      unchangedByCompatPair: JSON.stringify(s.getAnnotation(id).a) === JSON.stringify(afterTouch),
      transformUnchanged: same(beforeIos, s.getViewport()),
      stillSelected: s.getSelectedArrow() === id,
      arrowCount: document.querySelectorAll('.wm-arrow').length,
    };
    return out;
  });

  // ── 5. empty-plan pan still works ──
  R.panStillWorks = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    s._setViewport(WM.viewport.clampTranslation(
      WM.viewport.zoomAt(s.getViewport(), { x: el.width / 2, y: el.height / 2 }, 3,
        WM.viewport.minScaleFor(sz, { width: el.width, height: el.height })),
      sz, { width: el.width, height: el.height }));
    return true;
  });
  const vpb = await page.locator('#wm-viewport').boundingBox();
  const cx = vpb.width / 2, cy = 120;
  const beforePan = await page.evaluate(() => window.__wmStage.getViewport());
  await send('pointerdown', 6, cx, cy);
  for (const d of [15, 45, 70]) await send('pointermove', 6, cx + d, cy);
  await send('pointerup', 6, cx + 70, cy);
  await page.waitForTimeout(150);
  const afterPan = await page.evaluate(() => window.__wmStage.getViewport());
  R.emptyPan = { moved: Math.abs(afterPan.translateX - beforePan.translateX) > 20,
                 scaleSame: afterPan.scale === beforePan.scale };

  // ── 6. label regression ──
  await page.evaluate(() => window.__wmStage.fit());
  await page.waitForTimeout(150);
  const lbl = await page.evaluate(() => {
    const s = window.__wmStage;
    const g = document.querySelector('.wm-label');
    const id = g.getAttribute('data-annotation-id');
    const a = s.getAnnotation(id);
    return { id, at: a.at, screen: WM.viewport.stageToScreen(
      WM.geometry.denormalizePoint(a.at, s.getStageSize()), s.getViewport()) };
  });
  await send('pointerdown', 7, lbl.screen.x, lbl.screen.y);
  await send('pointerup', 7, lbl.screen.x, lbl.screen.y);
  await page.waitForTimeout(150);
  R.labelTapStillEdits = await page.evaluate(() => ({
    open: !document.getElementById('wm-editor').hidden,
    label: document.getElementById('wm-f-label').value }));
  await page.click('#wm-editor-cancel');
  await send('pointerdown', 8, lbl.screen.x, lbl.screen.y);
  for (const d of [12, 40]) await send('pointermove', 8, lbl.screen.x + d, lbl.screen.y + d);
  await send('pointerup', 8, lbl.screen.x + 40, lbl.screen.y + 40);
  await page.waitForTimeout(300);
  R.labelDragStillWorks = await page.evaluate((o) => {
    const a = window.__wmStage.getAnnotation(o.id);
    return JSON.stringify(a.at) !== JSON.stringify(o.at);
  }, lbl);

  // ── 7. reload ──
  await page.reload(); await page.waitForTimeout(200);
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() >= 2, { timeout: 20000 });
  await page.waitForTimeout(200);
  R.afterReload = await page.evaluate(() => ({
    total: window.__wmStage.getAnnotationCount(),
    arrows: document.querySelectorAll('#wm-routes .wm-arrow').length,
    labels: document.querySelectorAll('#wm-labels .wm-label').length,
  }));

  // ── 8. delete the arrow only ──
  const aScreen = await page.evaluate(() => {
    const s = window.__wmStage;
    const g = document.querySelector('.wm-arrow');
    const id = g.getAttribute('data-annotation-id');
    const a = s.getAnnotation(id);
    const sz = s.getStageSize();
    const p1 = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(a.a, sz), s.getViewport());
    const p2 = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(a.b, sz), s.getViewport());
    return { id, x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  });
  await send('pointerdown', 9, aScreen.x, aScreen.y); await send('pointerup', 9, aScreen.x, aScreen.y);
  await page.waitForTimeout(200);
  await page.click('#wm-delete-arrow');
  await page.waitForTimeout(300);
  await page.reload(); await page.waitForTimeout(200);
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() >= 1, { timeout: 20000 });
  await page.waitForTimeout(200);
  R.afterDelete = await page.evaluate(() => ({
    arrows: document.querySelectorAll('#wm-routes .wm-arrow').length,
    labels: document.querySelectorAll('#wm-labels .wm-label').length,
    total: window.__wmStage.getAnnotationCount(),
  }));


  // ── WM-6A follow-up: deselect on empty tap, constant arrowhead size ──
  R.head = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const view = { width: el.width, height: el.height };
    const out = { sizes: [], directions: [] };

    s.setAnnotations([WM.model.createAnnotation({ id: 'h1', sheetId: 's1', type: 'arrow',
      a: { x: 0.3, y: 0.5 }, b: { x: 0.7, y: 0.5 }, now: 1 })]);
    for (const sc of [null, 1, 4]) {
      if (sc) s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz, view, s.getViewport(), sc));
      const v = s.getViewport();
      const hb = document.querySelector('.wm-arrow-head').getBoundingClientRect();
      const tip = WM.viewport.stageToScreen(WM.geometry.denormalizePoint({ x: 0.7, y: 0.5 }, sz), v);
      out.sizes.push({ scale: +v.scale.toFixed(3), w: +hb.width.toFixed(2), h: +hb.height.toFixed(2),
        tipGap: +Math.abs((hb.right - el.left) - tip.x).toFixed(2) });
    }

    s._setViewport(WM.viewport.fitToViewport(sz, view));
    for (const [name, a, bb] of [
      ['horizontal', { x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }],
      ['vertical', { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }],
      ['diagonal', { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
      ['reversed', { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.2 }],
    ]) {
      s.setAnnotations([WM.model.createAnnotation({ id: 'h1', sheetId: 's1', type: 'arrow',
        a, b: bb, now: 1 })]);
      const v = s.getViewport();
      const head = document.querySelector('.wm-arrow-head');
      const hb = head.getBoundingClientRect();
      const centre = { x: hb.left + hb.width / 2 - el.left, y: hb.top + hb.height / 2 - el.top };
      const pB = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(bb, sz), v);
      const pA = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(a, sz), v);
      out.directions.push({ name,
        atEndB: Math.hypot(centre.x - pB.x, centre.y - pB.y)
              < Math.hypot(centre.x - pA.x, centre.y - pA.y),
        distToB: Math.hypot(centre.x - pB.x, centre.y - pB.y) });
    }
    return out;
  });

  R.deselect = await page.evaluate(async () => {
    const vpEl = document.getElementById('wm-viewport');
    const s = window.__wmStage, sz = s.getStageSize();
    const el = vpEl.getBoundingClientRect();
    const send = (t, id, x, y, pt) => {
      const tg = document.elementFromPoint(el.left + x, el.top + y) || vpEl;
      tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: el.left + x,
        clientY: el.top + y, bubbles: true, pointerType: pt || 'touch' }));
    };
    s.setAnnotations([WM.model.createAnnotation({ id: 'h1', sheetId: 's1', type: 'arrow',
      a: { x: 0.35, y: 0.5 }, b: { x: 0.65, y: 0.5 }, now: 1 })]);
    s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
    const read = () => ({ sel: s.getSelectedArrow(),
      handles: document.querySelectorAll('.wm-endpoint').length, v: s.getViewport() });

    const mid = WM.viewport.stageToScreen(
      WM.geometry.denormalizePoint({ x: 0.5, y: 0.5 }, sz), s.getViewport());
    send('pointerdown', 41, mid.x, mid.y, 'touch'); send('pointerup', 41, mid.x, mid.y, 'touch');
    const selected = read();

    const beforeTap = read().v;
    send('pointerdown', 42, 40, 90, 'touch'); send('pointerup', 42, 40, 90, 'touch');
    const afterTap = read();

    // The synthesised iOS pair must not count as another action.
    send('pointerdown', 43, 40, 90, 'mouse'); send('pointerup', 43, 40, 90, 'mouse');
    const afterCompat = read();

    // Reselect, zoom in, then a REAL pan must leave the selection alone.
    send('pointerdown', 44, mid.x, mid.y, 'touch'); send('pointerup', 44, mid.x, mid.y, 'touch');
    s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
      { width: el.width, height: el.height }, s.getViewport(), 3));
    const beforePan = read();
    send('pointerdown', 45, 200, 150, 'touch');
    for (const d of [20, 60, 100]) send('pointermove', 45, 200 + d, 150, 'touch');
    send('pointerup', 45, 300, 150, 'touch');
    const afterPan = read();

    return {
      selectedShowsHandles: selected.sel === 'h1' && selected.handles === 2,
      tapClearsSelection: afterTap.sel === null && afterTap.handles === 0,
      tapDoesNotMoveViewport: JSON.stringify(afterTap.v) === JSON.stringify(beforeTap),
      compatPairIsNoOp: afterCompat.sel === null && afterCompat.handles === 0,
      panActuallyHappened: afterPan.v.translateX !== beforePan.v.translateX,
      panKeepsSelection: afterPan.sel === 'h1' && afterPan.handles === 2,
      unselectedHasNoHandles: (() => {
        s.selectArrow(null);
        return document.querySelectorAll('.wm-endpoint').length === 0;
      })(),
    };
  });

  await browser.close();

  const HEAD_TOL = 1.5;
  const checks = [
    ['the arrowhead keeps a constant screen size across zoom',
      R.head.sizes.every((x) => Math.abs(x.w - R.head.sizes[0].w) < HEAD_TOL
                             && Math.abs(x.h - R.head.sizes[0].h) < HEAD_TOL)],
    ['the arrowhead is clearly visible at fit scale',
      R.head.sizes[0].w >= 8 && R.head.sizes[0].h >= 8],
    ['the arrowhead tip sits on endpoint B', R.head.sizes.every((x) => x.tipGap < 1.5)],
    ['the arrowhead points the right way for every bearing',
      R.head.directions.every((d) => d.atEndB && d.distToB < 12)],
    ['a selected arrow shows two handles', R.deselect.selectedShowsHandles],
    ['an unselected arrow shows none', R.deselect.unselectedHasNoHandles],
    ['TAPPING EMPTY PLAN CLEARS THE SELECTION', R.deselect.tapClearsSelection],
    ['an empty tap does not move the viewport', R.deselect.tapDoesNotMoveViewport],
    ['the iOS compatibility pair causes no second action', R.deselect.compatPairIsNoOp],
    ['a real pan does not deselect', R.deselect.panActuallyHappened && R.deselect.panKeepsSelection],
    ['Add Arrow arms draw mode', R.armed],
    ['a live preview appears while drawing', R.previewShown],
    ['exactly one arrow is created, in wm-routes only',
      R.afterDraw.arrowsInRoutes === 1 && R.afterDraw.arrowsElsewhere === 0],
    ['the iOS compatibility pair creates no second arrow', R.stored.arrows === 1],
    ['arrow mode disarms after a commit', !R.afterDraw.armed],
    ['the draft preview is cleared', R.afterDraw.draftGone],
    ['an arrowhead is rendered as geometry, not a marker',
      R.afterDraw.hasArrowhead && !R.afterDraw.markerDefined],
    ['the stroke keeps constant SCREEN weight without vector-effect',
      // Superseded strategy: vector-effect is gone, the width is computed per
      // zoom instead. Detailed proof lives in the stroke2 checks below.
      R.afterDraw.vectorEffect === 'none'],
    ['the touch target works at every zoom',
      R.stroke.hitsAtOffset.every(Boolean) && R.stroke.missesFarAway.every((m) => !m)],
    ['endpoints are stored normalized', R.stored.normalized],
    ['endpoints do not drift across zoom levels', R.anchor.maxDrift < 1e-6],
    ['selecting an arrow shows two endpoint handles', R.selected.handles === 2],
    ['the endpoint handle is a finger-sized target', R.selected.handleHit >= 40],
    ['dragging an endpoint moves only that end',
      R.endpointDrag.startMoved && R.endpointDrag.endUnchanged],
    ['the visible line carries an explicit stroke-width attribute',
      R.stroke2.every((r) => r.attrPresent)],
    ['the generated stage stroke equals 1.5 / scale at every zoom',
      R.stroke2.every((r) => Math.abs(r.stageStroke - r.expectedStage) < 1e-6)],
    ['the UNSELECTED line is ~1.5 SCREEN px at fit, 1x, 4x and 8x',
      R.stroke2.every((r) => Math.abs(r.screenStroke - 1.5) < 0.05)],
    ['REGRESSION: the stroke is NOT a fixed stage-unit value across zoom',
      new Set(R.stroke2.map((r) => r.stageStroke)).size === R.stroke2.length],
    ['no vector-effect competes with the explicit compensation',
      R.stroke2.every((r) => r.vectorEffect === 'none')],
    ['the invisible hit target stays ~40 screen px independently',
      R.stroke2.every((r) => Math.abs(r.hitScreen - 40) < 0.5)],
    ['the arrowhead still measures ~13 x 11 screen px',
      R.stroke2.every((r) => Math.abs(r.headLen - 13) < 1 && Math.abs(r.headW - 11) < 1)],
    ['the arrowhead is painted after the line so it is never swallowed',
      R.stroke2.every((r) => r.headPaintedLast)],
    ['dragging an endpoint does NOT pan the plan', R.endpointDrag.planStayedPut],
    ['stage translation delta is exactly zero for an endpoint drag',
      R.endpointDrag.translationDelta.dx === 0 && R.endpointDrag.translationDelta.dy === 0
      && R.endpointDrag.translationDelta.dScale === 0],
    ['an endpoint press registers NO viewport pan pointer',
      R.isolation.a.noViewportPointerAtDown && R.isolation.b.noViewportPointerAtDown],
    ['the transform is identical at pointerdown, during and after — start handle',
      R.isolation.a.transformUnchangedAtDown && R.isolation.a.transformUnchangedDuring
      && R.isolation.a.transformUnchangedAfter],
    ['the transform is identical at pointerdown, during and after — end handle',
      R.isolation.b.transformUnchangedAtDown && R.isolation.b.transformUnchangedDuring
      && R.isolation.b.transformUnchangedAfter],
    ['moving the start handle changes only the start',
      R.isolation.a.thisEndMoved && R.isolation.a.otherEndUnchanged],
    ['moving the end handle changes only the end',
      R.isolation.b.thisEndMoved && R.isolation.b.otherEndUnchanged],
    ['an endpoint drag does not deselect the arrow',
      R.isolation.a.stillSelected && R.isolation.b.stillSelected],
    ['an endpoint drag creates no new arrow',
      R.isolation.a.arrowCount === 1 && R.isolation.b.arrowCount === 1],
    ['pointer state is clean after an endpoint drag',
      R.isolation.a.activePointersAfter === 0 && R.isolation.a.gestureModeAfter === 'idle'],
    ['pointercancel restores the endpoint and leaves the transform alone',
      R.isolation.cancel.endpointRestored && R.isolation.cancel.transformUnchanged
      && R.isolation.cancel.pointersCleared],
    ['iOS touch drag + compatibility pair moves the endpoint exactly once',
      R.isolation.ios.movedOnce && R.isolation.ios.unchangedByCompatPair
      && R.isolation.ios.transformUnchanged && R.isolation.ios.arrowCount === 1],
    ['the moved endpoint is written through once', R.endpointDrag.persistedMatches],
    ['the moved endpoint stays normalized', R.endpointDrag.stillNormalized],
    ['empty-plan pan still works', R.emptyPan.moved && R.emptyPan.scaleSame],
    ['LABEL REGRESSION: tap still opens the editor',
      R.labelTapStillEdits.open && R.labelTapStillEdits.label === 'HR-7'],
    ['LABEL REGRESSION: drag still moves the label', R.labelDragStillWorks],
    ['both annotation types survive a reload',
      R.afterReload.arrows === 1 && R.afterReload.labels === 1 && R.afterReload.total === 2],
    ['deleting the arrow leaves the label untouched',
      R.afterDelete.arrows === 0 && R.afterDelete.labels === 1 && R.afterDelete.total === 1],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-6A: arrow tip paint geometry ─────────────────────────────────────────
async function runArrowTip(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    c.getContext('2d').fillRect(0, 0, 2000, 1500);
    const pr = await WM.image.processImage(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)));
    await window.__wmStage.showImage(pr.blob, pr.width, pr.height);
  });
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const cases = { horizontal: [{x:0.3,y:0.5},{x:0.7,y:0.5}], vertical: [{x:0.5,y:0.25},{x:0.5,y:0.75}],
      diagonal: [{x:0.3,y:0.3},{x:0.7,y:0.7}], reversed: [{x:0.7,y:0.3},{x:0.3,y:0.7}] };
    const rows = [];
    for (const [name, [pa, pb]] of Object.entries(cases)) {
      s.setAnnotations([WM.model.createAnnotation({ id: 'r1', sheetId: 's1', type: 'arrow', a: pa, b: pb, now: 1 })]);
      for (const sc of [null, 1, 4, 8]) {
        if (sc) s._setViewport(WM.viewport.centerOnNormalized({x:(pa.x+pb.x)/2,y:(pa.y+pb.y)/2}, sz,
          { width: el.width, height: el.height }, s.getViewport(), sc));
        else s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
        s.renderLabels();
        const line = document.querySelector('.wm-arrow-line');
        const head = document.querySelector('.wm-arrow-head');
        const hit = document.querySelector('.wm-arrow-hit');
        const scale = s.getViewport().scale;
        const A = WM.geometry.denormalizePoint(pa, sz), B = WM.geometry.denormalizePoint(pb, sz);
        const n = head.getAttribute('d').match(/-?[0-9.]+/g).map(Number);
        const tip = { x: n[0], y: n[1] }, c1 = { x: n[2], y: n[3] }, c2 = { x: n[6], y: n[7] };
        const sx = +line.getAttribute('x2'), sy = +line.getAttribute('y2');
        const w = parseFloat(line.getAttribute('stroke-width'));
        const ux = (B.x - A.x) / Math.hypot(B.x - A.x, B.y - A.y);
        const uy = (B.y - A.y) / Math.hypot(B.x - A.x, B.y - A.y);
        // how far the painted shaft (including its round cap) reaches along A->B
        const reach = ((sx - A.x) * ux + (sy - A.y) * uy) + w / 2;
        const bAlong = (B.x - A.x) * ux + (B.y - A.y) * uy;
        // gap between the shaft end and the head's filled region (notch at 75% back)
        const shaftBackFromB = Math.hypot(B.x - sx, B.y - sy) * scale;
        rows.push({ case: name, scale: +scale.toFixed(3),
          tipIsB: Math.hypot(tip.x - B.x, tip.y - B.y) < 0.01,
          shaftOvershootScreen: +((reach - bAlong) * scale).toFixed(3),
          shaftBackFromBScreen: +shaftBackFromB.toFixed(2),
          insideHeadFill: shaftBackFromB < 13 * 0.75,
          strokeScreen: +(w * scale).toFixed(3),
          headLen: +(Math.hypot(tip.x-(c1.x+c2.x)/2, tip.y-(c1.y+c2.y)/2) * scale).toFixed(2),
          headW: +(Math.hypot(c1.x-c2.x, c1.y-c2.y) * scale).toFixed(2),
          hitScreen: +(parseFloat(hit.getAttribute('stroke-width')) * scale).toFixed(1),
          hitStillFullSegment: Math.abs(+hit.getAttribute('x2') - B.x) < 0.01
            && Math.abs(+hit.getAttribute('y2') - B.y) < 0.01 });
      }
    }
    // selected arrow must still use the computed width
    s.setAnnotations([WM.model.createAnnotation({ id:'r1', sheetId:'s1', type:'arrow',
      a:{x:0.3,y:0.5}, b:{x:0.7,y:0.5}, now:1 })]);
    s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
    s.selectArrow('r1');
    const sl = document.querySelector('.wm-arrow-line');
    const handle = document.querySelector('.wm-endpoint[data-endpoint="b"]');
    const hm = handle.getAttribute('transform').match(/-?[0-9.]+/g).map(Number);
    const B = WM.geometry.denormalizePoint({x:0.7,y:0.5}, sz);
    return { rows, selected: {
      attr: +parseFloat(sl.getAttribute('stroke-width')).toFixed(4),
      computed: getComputedStyle(sl).strokeWidth,
      screen: +(parseFloat(sl.getAttribute('stroke-width')) * s.getViewport().scale).toFixed(2),
      handleOnB: Math.abs(hm[0] - B.x) < 0.01 && Math.abs(hm[1] - B.y) < 0.01 } };
  });

  await browser.close();

  const rows = r.rows;
  const checks = [
    ['the arrowhead tip is exactly endpoint B for every bearing and zoom',
      rows.every((x) => x.tipIsB)],
    ['NO painted shaft, cap included, reaches past endpoint B',
      rows.every((x) => x.shaftOvershootScreen <= 0)],
    ['the visible shaft stops ~4 screen px short of B at every zoom',
      rows.every((x) => Math.abs(x.shaftBackFromBScreen - 4) < 0.2)],
    ['the shaft end sits inside the head fill, so there is no gap',
      rows.every((x) => x.insideHeadFill)],
    ['the unselected stroke stays ~1.5 screen px',
      rows.every((x) => Math.abs(x.strokeScreen - 1.5) < 0.05)],
    ['the arrowhead stays ~13 x 11 screen px',
      rows.every((x) => Math.abs(x.headLen - 13) < 1 && Math.abs(x.headW - 11) < 1)],
    ['the HIT segment still runs the full logical A->B', rows.every((x) => x.hitStillFullSegment)],
    ['the hit target stays ~40 screen px', rows.every((x) => Math.abs(x.hitScreen - 40) < 0.5)],
    ['all four bearings were measured at four zooms', rows.length === 16],
    ['a selected arrow keeps a COMPUTED width, not a fixed stage value',
      r.selected.computed === r.selected.attr + 'px' && Math.abs(r.selected.screen - 2.5) < 0.05],
    ['the endpoint handle stays anchored to the true B', r.selected.handleOnB],
  ];
  return { engine: engineName, available: true, detail: r, checks, errs };
}

// ── WM-6B1: blank sheet, sketch line/rect, undo ─────────────────────────────
async function runSketch(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);

  const R = {};
  const send = (t, id, x, y, pt) => page.evaluate(({ t, id, x, y, pt }) => {
    const el = document.getElementById('wm-viewport'); const r = el.getBoundingClientRect();
    const tg = document.elementFromPoint(r.left + x, r.top + y) || el;
    tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: r.left + x,
      clientY: r.top + y, bubbles: true, pointerType: pt || 'touch' }));
  }, { t, id, x, y, pt });
  const drag = async (id, from, to, steps) => {
    await send('pointerdown', id, from.x, from.y);
    for (const s of steps || [0.4, 0.8, 1]) {
      await send('pointermove', id, from.x + (to.x - from.x) * s, from.y + (to.y - from.y) * s);
    }
    await send('pointerup', id, to.x, to.y);
    await page.waitForTimeout(250);
  };
  const counts = () => page.evaluate(() => ({
    sketchInSketch: document.querySelectorAll('#wm-sketch .wm-sketch-shape').length,
    sketchElsewhere: document.querySelectorAll('#wm-routes .wm-sketch-shape').length
      + document.querySelectorAll('#wm-labels .wm-sketch-shape').length,
    arrows: document.querySelectorAll('#wm-routes .wm-arrow').length,
    labels: document.querySelectorAll('#wm-labels .wm-label').length,
    grid: document.querySelectorAll('#wm-sketch .wm-grid').length,
    total: window.__wmStage.getAnnotationCount(),
    view: window.__wmStage.getViewport(),
  }));

  // ── image sheet: label + arrow + sketch ──
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    const x = c.getContext('2d'); x.fillStyle = '#1d3a5c'; x.fillRect(0, 0, 2000, 1500);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'p.jpg', { type: 'image/jpeg' }));
    const i = document.getElementById('wm-dev-file'); i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__wmStage.hasImage(), { timeout: 20000 });
  await page.waitForTimeout(300);
  R.gridOnImageSheet = (await counts()).grid;

  await page.click('#wm-add-label');
  await send('pointerdown', 1, 320, 200); await send('pointerup', 1, 320, 200);
  await page.waitForTimeout(120);
  await page.fill('#wm-f-label', 'HR-7'); await page.click('#wm-editor-save');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() === 1, { timeout: 10000 });

  await page.click('#wm-add-arrow');
  await drag(2, { x: 110, y: 380 }, { x: 260, y: 420 });

  // sketch line
  await page.click('#wm-sketch-toggle');
  await page.click('#wm-tool-line');
  R.lineArmed = await page.evaluate(() => window.__wmStage.activeSketchTool());
  await drag(3, { x: 120, y: 250 }, { x: 280, y: 300 });
  // iOS compatibility pair must not create a second line
  await send('pointerdown', 4, 280, 300, 'mouse'); await send('pointerup', 4, 280, 300, 'mouse');
  await page.waitForTimeout(200);
  R.afterLine = await counts();
  R.toolExited = await page.evaluate(() => window.__wmStage.activeSketchTool());

  // a tap with the tool armed creates nothing
  await page.click('#wm-tool-line');
  await send('pointerdown', 5, 200, 330); await send('pointerup', 5, 202, 331);
  await page.waitForTimeout(200);
  R.tapCreatesNothing = (await counts()).sketchInSketch === 1;
  // No second click needed: any pointerup while drawing auto-disarms the tool.
  R.autoDisarmedAfterTap = await page.evaluate(() => window.__wmStage.activeSketchTool());

  // select the line, drag an endpoint
  const lineInfo = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    let id = null; s.getAnnotationIds ? null : null;
    const g = document.querySelector('#wm-sketch .wm-sketch-shape');
    id = g.getAttribute('data-annotation-id');
    const ann = s.getAnnotation(id);
    const mid = { x: (ann.a.x + ann.b.x) / 2, y: (ann.a.y + ann.b.y) / 2 };
    return { id, a: ann.a, b: ann.b,
      midScreen: WM.viewport.stageToScreen(WM.geometry.denormalizePoint(mid, sz), s.getViewport()) };
  });
  await send('pointerdown', 6, lineInfo.midScreen.x, lineInfo.midScreen.y);
  await send('pointerup', 6, lineInfo.midScreen.x, lineInfo.midScreen.y);
  // Handles are rendered asynchronously after selection; wait for them rather
  // than assuming a fixed delay is enough.
  await page.waitForFunction(() => document.querySelectorAll('.wm-sketch-handle').length > 0,
    { timeout: 10000 });
  R.lineSelected = await page.evaluate(() => ({
    id: window.__wmStage.getSelectedSketch(),
    handles: document.querySelectorAll('.wm-sketch-handle').length,
    handleHit: (() => { const t = document.querySelector('.wm-sketch-handle .wm-endpoint-target');
      const r = t.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); })(),
  }));
  const hA = await page.evaluate(() => {
    const t = document.querySelector('.wm-sketch-handle[data-handle="a"] .wm-endpoint-target');
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  const viewBeforeLineDrag = (await counts()).view;
  await drag(7, hA, { x: hA.x + 70, y: hA.y + 50 });
  R.lineEndpointDrag = await page.evaluate(async (arg) => {
    const s = window.__wmStage; const live = s.getAnnotation(arg.id);
    const db = WM.store.createStore(); await db.openDatabase();
    const saved = await db.getAnnotation(arg.id); db.closeDatabase();
    const v = s.getViewport();
    return { aMoved: JSON.stringify(live.a) !== JSON.stringify(arg.a),
      bUnchanged: JSON.stringify(live.b) === JSON.stringify(arg.b),
      stageDelta: { dx: v.translateX - arg.view.translateX, dy: v.translateY - arg.view.translateY },
      persisted: JSON.stringify(saved.a) === JSON.stringify(live.a) };
  }, { id: lineInfo.id, a: lineInfo.a, b: lineInfo.b, view: viewBeforeLineDrag });

  // rectangle
  await page.click('#wm-tool-rect');
  await drag(8, { x: 130, y: 430 }, { x: 300, y: 520 });
  R.afterRect = await counts();
  const rectId = await page.evaluate(() => {
    const gs = document.querySelectorAll('#wm-sketch .wm-sketch-shape');
    for (const g of gs) {
      const a = window.__wmStage.getAnnotation(g.getAttribute('data-annotation-id'));
      if (a.type === 'rect') return a.id;
    }
    return null;
  });
  await page.evaluate((id) => window.__wmStage.selectSketch(id), rectId);
  await page.waitForFunction(() => document.querySelectorAll('.wm-sketch-handle').length === 4,
    { timeout: 10000 });
  R.rectHandles = await page.evaluate(() => document.querySelectorAll('.wm-sketch-handle').length);
  const cornerBefore = await page.evaluate((id) => {
    const s = window.__wmStage;
    const a = s.getAnnotation(id);
    return { a: a.a, b: a.b, opposite: WM.sketchInteraction.oppositeCorner(a, 'nw') };
  }, rectId);
  const hNW = await page.evaluate(() => {
    const t = document.querySelector('.wm-sketch-handle[data-handle="nw"] .wm-endpoint-target');
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  const viewBeforeCorner = (await counts()).view;
  await drag(9, hNW, { x: hNW.x + 45, y: hNW.y + 35 });
  R.cornerDrag = await page.evaluate((arg) => {
    const s = window.__wmStage; const a = s.getAnnotation(arg.id);
    const corners = WM.sketchInteraction.rectCorners(a);
    const v = s.getViewport();
    return { changed: JSON.stringify({ a: a.a, b: a.b }) !== JSON.stringify({ a: arg.a, b: arg.b }),
      oppositeFixed: Math.abs(corners.se.x - arg.opposite.x) < 1e-9
                  && Math.abs(corners.se.y - arg.opposite.y) < 1e-9,
      stageDelta: { dx: v.translateX - arg.view.translateX, dy: v.translateY - arg.view.translateY } };
  }, { id: rectId, ...cornerBefore, view: viewBeforeCorner });

  // strokes across zoom
  R.strokes = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const rows = [];
    for (const sc of [null, 1, 4, 8]) {
      if (sc) s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
        { width: el.width, height: el.height }, s.getViewport(), sc));
      else s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
      s.renderLabels();
      const scale = s.getViewport().scale;
      const sel = document.querySelector('.wm-sketch-shape.selected .wm-sketch-rect')
        || document.querySelector('.wm-sketch-shape.selected .wm-sketch-line');
      const un = document.querySelector('.wm-sketch-shape:not(.selected) .wm-sketch-line')
        || document.querySelector('.wm-sketch-shape:not(.selected) .wm-sketch-rect');
      const hit = document.querySelector('.wm-sketch-hit');
      rows.push({ scale: +scale.toFixed(3),
        unselected: +(parseFloat(un.getAttribute('stroke-width')) * scale).toFixed(3),
        selected: sel ? +(parseFloat(sel.getAttribute('stroke-width')) * scale).toFixed(3) : null,
        hit: +(parseFloat(hit.getAttribute('stroke-width')) * scale).toFixed(1) });
    }
    return rows;
  });

  // anchors survive zoom
  R.anchorStable = await page.evaluate((id) => {
    const s = window.__wmStage, sz = s.getStageSize();
    const a = s.getAnnotation(id);
    const before = JSON.stringify({ a: a.a, b: a.b });
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    for (const sc of [0.195, 1, 8]) {
      s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
        { width: el.width, height: el.height }, s.getViewport(), sc));
      s.renderLabels();
    }
    return JSON.stringify({ a: s.getAnnotation(id).a, b: s.getAnnotation(id).b }) === before;
  }, rectId);

  // undo: corner edit, then rect creation
  await page.click('#wm-undo'); await page.waitForTimeout(300);
  R.afterUndoEdit = await page.evaluate((arg) => {
    const a = window.__wmStage.getAnnotation(arg.id);
    return a ? JSON.stringify({ a: a.a, b: a.b }) === JSON.stringify({ a: arg.a, b: arg.b }) : false;
  }, { id: rectId, a: cornerBefore.a, b: cornerBefore.b });
  await page.click('#wm-undo'); await page.waitForTimeout(300);
  R.afterUndoCreate = await counts();
  R.rectGoneFromStore = await page.evaluate(async (id) => {
    const db = WM.store.createStore(); await db.openDatabase();
    const a = await db.getAnnotation(id); db.closeDatabase(); return a === null;
  }, rectId);

  // reload
  await page.reload(); await page.waitForTimeout(200);
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() >= 3, { timeout: 20000 });
  await page.waitForTimeout(250);
  R.afterReload = await counts();

  // ── blank sheet ──
  await page.click('#wm-sketch-toggle');
  await page.click('#wm-blank-sheet');
  await page.waitForFunction(() => window.__wmStage.isGridVisible(), { timeout: 10000 });
  await page.waitForTimeout(250);
  R.blank = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const id = await db.getMeta('currentSheetId');
    const sheet = await db.getSheet(id); db.closeDatabase();
    return { kind: sheet.kind, imageId: sheet.imageId, w: sheet.width, h: sheet.height,
      gridLines: document.querySelectorAll('#wm-sketch .wm-grid line').length,
      annotations: window.__wmStage.getAnnotationCount(),
      imageHidden: document.getElementById('wm-background').hidden };
  });

  await page.click('#wm-tool-line');
  await drag(20, { x: 120, y: 250 }, { x: 280, y: 320 });
  await page.click('#wm-tool-rect');
  await drag(21, { x: 130, y: 380 }, { x: 290, y: 470 });
  R.blankShapes = await counts();

  await page.reload(); await page.waitForTimeout(200);
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() >= 2, { timeout: 20000 });
  await page.waitForTimeout(250);
  R.blankAfterReload = await counts();
  R.blankGridAfterReload = await page.evaluate(() => ({
    grid: document.querySelectorAll('#wm-sketch .wm-grid line').length > 0,
    isBlank: window.__wmStage.isGridVisible() }));

  // delete a shape then undo
  const delId = await page.evaluate(() =>
    document.querySelector('#wm-sketch .wm-sketch-shape').getAttribute('data-annotation-id'));
  await page.evaluate((id) => window.__wmStage.selectSketch(id), delId);
  await page.waitForFunction(() => document.querySelectorAll('.wm-sketch-handle').length > 0,
    { timeout: 10000 });
  await page.click('#wm-sketch-toggle');
  await page.click('#wm-sketch-delete'); await page.waitForTimeout(300);
  R.afterDelete = (await counts()).sketchInSketch;
  await page.click('#wm-undo'); await page.waitForTimeout(300);
  R.afterUndoDelete = await page.evaluate(async (id) => {
    const db = WM.store.createStore(); await db.openDatabase();
    const a = await db.getAnnotation(id); db.closeDatabase();
    return { restored: !!a, sameId: a ? a.id === id : false,
      onStage: document.querySelectorAll('#wm-sketch .wm-sketch-shape').length };
  }, delId);

  // no cross-sheet leakage: the blank sheet must not show the image sheet's work
  R.noLeak = R.blankAfterReload.labels === 0 && R.blankAfterReload.arrows === 0;


  await browser.close();

  const st = R.strokes;
  const checks = [
    ['a sketch line is created, in wm-sketch only',
      R.afterLine.sketchInSketch === 1 && R.afterLine.sketchElsewhere === 0],
    ['the iOS compatibility pair creates no second shape', R.afterLine.total === 3],
    ['the tool disarms after a commit', R.toolExited === 'none'],
    ['a tap with a tool armed creates nothing', R.tapCreatesNothing],
    ['a discarded tap also disarms the tool', R.autoDisarmedAfterTap === 'none'],
    ['tapping a line selects it and shows two handles',
      !!R.lineSelected.id && R.lineSelected.handles === 2],
    ['sketch handles are finger-sized', R.lineSelected.handleHit >= 40],
    ['dragging an endpoint moves only that end',
      R.lineEndpointDrag.aMoved && R.lineEndpointDrag.bUnchanged],
    ['dragging an endpoint does NOT pan the stage',
      R.lineEndpointDrag.stageDelta.dx === 0 && R.lineEndpointDrag.stageDelta.dy === 0],
    ['the endpoint is written through once', R.lineEndpointDrag.persisted],
    ['a rectangle is created and shows four corner handles',
      R.afterRect.sketchInSketch === 2 && R.rectHandles === 4],
    ['dragging a corner keeps the OPPOSITE corner fixed',
      R.cornerDrag.changed && R.cornerDrag.oppositeFixed],
    ['dragging a corner does NOT pan the stage',
      R.cornerDrag.stageDelta.dx === 0 && R.cornerDrag.stageDelta.dy === 0],
    ['unselected sketch stroke is ~1.25 screen px at every zoom',
      st.every((r) => Math.abs(r.unselected - 1.25) < 0.05)],
    ['selected sketch stroke is ~2.0 screen px at every zoom',
      st.every((r) => r.selected === null || Math.abs(r.selected - 2.0) < 0.05)],
    ['the sketch hit target is ~40 screen px at every zoom',
      st.every((r) => Math.abs(r.hit - 40) < 0.5)],
    ['zooming never rewrites stored sketch geometry', R.anchorStable],
    ['UNDO restores the geometry before a corner edit', R.afterUndoEdit],
    ['UNDO removes a created rectangle from stage and store',
      R.afterUndoCreate.sketchInSketch === 1 && R.rectGoneFromStore],
    ['the line, arrow and label survive a reload',
      R.afterReload.sketchInSketch === 1 && R.afterReload.arrows === 1 && R.afterReload.labels === 1],
    ['a blank sheet needs no image blob',
      R.blank.kind === 'blank' && R.blank.imageId === null && R.blank.imageHidden],
    ['the blank sheet renders a drafting grid', R.blank.gridLines > 0],
    ['a new blank sheet starts with no annotations', R.blank.annotations === 0],
    ['sketch tools work on a blank sheet too', R.blankShapes.sketchInSketch === 2],
    ['a blank sheet and its shapes survive a reload',
      R.blankAfterReload.sketchInSketch === 2 && R.blankGridAfterReload.grid
      && R.blankGridAfterReload.isBlank],
    ['NO cross-sheet leakage between the image and blank sheets', R.noLeak],
    ['deleting a shape removes it', R.afterDelete === 1],
    ['UNDO restores a deleted shape under the SAME id',
      R.afterUndoDelete.restored && R.afterUndoDelete.sameId && R.afterUndoDelete.onStage === 2],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-6B1: hit-routing priority under overlap ──────────────────────────────
async function runPriority(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(APP);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    c.getContext('2d').fillRect(0, 0, 2000, 1500);
    const pr = await WM.image.processImage(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)));
    await window.__wmStage.showImage(pr.blob, pr.width, pr.height);
    window.__wmStage.setSheet('s1', { blank: false });
    window.__wmStage.setAnnotations([
      WM.model.createAnnotation({ id: 'ln', sheetId: 's1', type: 'line',
        a: { x: 0.2, y: 0.5 }, b: { x: 0.8, y: 0.5 }, now: 1 }),
      WM.model.createAnnotation({ id: 'rc', sheetId: 's1', type: 'rect',
        a: { x: 0.25, y: 0.62 }, b: { x: 0.75, y: 0.80 }, now: 1 }),
      WM.model.createAnnotation({ id: 'lb', sheetId: 's1', type: 'wireLabel',
        at: { x: 0.5, y: 0.5 }, now: 1, data: { label: 'HR-7' } }),
      WM.model.createAnnotation({ id: 'ar', sheetId: 's1', type: 'arrow',
        a: { x: 0.30, y: 0.25 }, b: { x: 0.70, y: 0.25 }, now: 1 }),
      WM.model.createAnnotation({ id: 'l2', sheetId: 's1', type: 'line',
        a: { x: 0.30, y: 0.25 }, b: { x: 0.70, y: 0.25 }, now: 1 }),
    ]);
  });
  await page.waitForTimeout(300);

  const R = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const fire = (t, id, x, y, pt) => {
      const tg = document.elementFromPoint(el.left + x, el.top + y) || vpEl;
      tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: el.left + x,
        clientY: el.top + y, bubbles: true, pointerType: pt || 'touch' }));
    };
    const at = (n) => WM.viewport.stageToScreen(WM.geometry.denormalizePoint(n, sz), s.getViewport());
    const snapshot = () => ({
      editor: !document.getElementById('wm-editor').hidden,
      arrow: s.getSelectedArrow(), sketch: s.getSelectedSketch(),
      count: s.getAnnotationCount(), view: JSON.stringify(s.getViewport()),
      tool: s.activeSketchTool(),
    });
    const reset = () => {
      document.getElementById('wm-editor').hidden = true;
      s.selectArrow(null); s.selectSketch(null); s.disarmSketch();
    };
    const tap = (p, id, pt) => { fire('pointerdown', id, p.x, p.y, pt); fire('pointerup', id, p.x, p.y, pt); };

    const out = {};
    let n = 100;

    // ── label directly over a sketch line ──
    reset();
    const before = snapshot();
    tap(at({ x: 0.5, y: 0.5 }), n++);
    out.labelOverLine = { ...snapshot(), viewUnchanged: snapshot().view === before.view };

    // ── label over a rectangle border ──
    reset();
    s.upsertAnnotation({ ...s.getAnnotation('lb'), at: { x: 0.5, y: 0.62 } });
    tap(at({ x: 0.5, y: 0.62 }), n++);
    out.labelOverRectBorder = snapshot();
    s.upsertAnnotation({ ...s.getAnnotation('lb'), at: { x: 0.5, y: 0.5 } });

    // ── arrow directly over a sketch line ──
    reset();
    tap(at({ x: 0.5, y: 0.25 }), n++);
    out.arrowOverLine = snapshot();

    // ── arrow endpoint handle over a sketch line ──
    reset();
    s.selectArrow('ar');
    const h = document.querySelector('.wm-endpoint[data-endpoint="a"] .wm-endpoint-target');
    const hb = h.getBoundingClientRect();
    const hp = { x: hb.left + hb.width / 2 - el.left, y: hb.top + hb.height / 2 - el.top };
    fire('pointerdown', n, hp.x, hp.y);
    const ownedByHandle = s.getSelectedSketch() === null;
    fire('pointerup', n++, hp.x, hp.y);
    out.arrowHandleOverSketch = { ownedByHandle, ...snapshot() };

    // ── ARMED tool landing on existing annotations ──
    for (const tool of ['line', 'rect']) {
      for (const [name, p] of [
        ['label', at({ x: 0.5, y: 0.5 })],
        ['arrowBody', at({ x: 0.5, y: 0.25 })],
        ['sketchLine', at({ x: 0.3, y: 0.5 })],
      ]) {
        reset();
        const c0 = s.getAnnotationCount();
        s.armSketch(tool);
        fire('pointerdown', n, p.x, p.y);
        const startedDraft = !!document.getElementById('wm-draft-sketch')
          || s.activeSketchTool() === tool && (() => { fire('pointermove', n, p.x + 60, p.y + 40);
              return !!document.getElementById('wm-draft-sketch'); })();
        fire('pointermove', n, p.x + 60, p.y + 40);
        fire('pointerup', n++, p.x + 60, p.y + 40);
        out['armed_' + tool + '_on_' + name] = {
          startedDraft, created: s.getAnnotationCount() - c0,
          editor: !document.getElementById('wm-editor').hidden,
          arrow: s.getSelectedArrow(), sketch: s.getSelectedSketch(),
        };
        // undo any accidental creation so later cases start clean
        while (s.getAnnotationCount() > c0) {
          const plan = s.planUndo();
          if (plan.action === 'remove') s.removeAnnotation(plan.annotationId); else break;
        }
      }
      // ── armed tool on genuinely empty sheet MUST draw ──
      reset();
      const c1 = s.getAnnotationCount();
      s.armSketch(tool);
      const empty = at({ x: 0.12, y: 0.90 });
      fire('pointerdown', n, empty.x, empty.y);
      fire('pointermove', n, empty.x + 70, empty.y + 50);
      const drafted = !!document.getElementById('wm-draft-sketch');
      fire('pointerup', n++, empty.x + 70, empty.y + 50);
      out['armed_' + tool + '_on_empty'] = { drafted };
    }

    // ── iOS pair on the overlap case ──
    reset();
    const p = at({ x: 0.5, y: 0.5 });
    tap(p, n++, 'touch');
    const afterTouch = snapshot();
    tap(p, n++, 'mouse');
    out.iosOverlap = { afterTouch: afterTouch.editor, afterCompat: snapshot().editor,
      sketch: snapshot().sketch, count: snapshot().count };
    return out;
  });


  await browser.close();

  const checks = [
    ['a label over a sketch line stays tappable',
      R.labelOverLine.editor && R.labelOverLine.sketch === null
      && R.labelOverLine.viewUnchanged],
    ['a label over a rectangle border stays tappable',
      R.labelOverRectBorder.editor && R.labelOverRectBorder.sketch === null],
    ['an arrow over a sketch line stays tappable',
      R.arrowOverLine.arrow === 'ar' && R.arrowOverLine.sketch === null],
    ['an arrow endpoint handle keeps ownership over a sketch line',
      R.arrowHandleOverSketch.ownedByHandle && R.arrowHandleOverSketch.arrow === 'ar'],
    ['armed Line on a label does NOT start a line', !R.armed_line_on_label.startedDraft],
    ['armed Line on an arrow does NOT start a line, the arrow selects',
      !R.armed_line_on_arrowBody.startedDraft && R.armed_line_on_arrowBody.arrow === 'ar'],
    ['armed Line on an existing shape does NOT start a line, the shape selects',
      !R.armed_line_on_sketchLine.startedDraft && R.armed_line_on_sketchLine.sketch === 'ln'],
    ['armed Rectangle on a label does NOT start a rectangle', !R.armed_rect_on_label.startedDraft],
    ['armed Rectangle on an arrow does NOT start a rectangle',
      !R.armed_rect_on_arrowBody.startedDraft && R.armed_rect_on_arrowBody.arrow === 'ar'],
    ['armed Rectangle on an existing shape does NOT start a rectangle',
      !R.armed_rect_on_sketchLine.startedDraft && R.armed_rect_on_sketchLine.sketch === 'ln'],
    ['armed Line on genuinely empty sheet DOES draft', R.armed_line_on_empty.drafted],
    ['armed Rectangle on genuinely empty sheet DOES draft', R.armed_rect_on_empty.drafted],
    ['the iOS pair on an overlap yields one action with the same owner',
      R.iosOverlap.afterTouch && R.iosOverlap.afterCompat
      && R.iosOverlap.sketch === null && R.iosOverlap.count === 5],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-6B1: the temporary dev controls must fit a narrow phone ──────────────
async function runControlLayout(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const errs = [];
  const results = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 },
    { width: 844, height: 390 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(APP);
    const fire = (t, id, x, y) => page.evaluate(({ t, id, x, y }) => {
      const el = document.getElementById('wm-viewport'); const r = el.getBoundingClientRect();
      const tg = document.elementFromPoint(r.left + x, r.top + y) || el;
      tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: r.left + x,
        clientY: r.top + y, bubbles: true, pointerType: 'touch' }));
    }, { t, id, x, y });
    await page.click('#wm-sketch-toggle');
    await page.click('#wm-blank-sheet');
    await page.waitForFunction(() => window.__wmStage.isGridVisible(), { timeout: 15000 });
    await page.waitForTimeout(250);
    await page.click('#wm-tool-rect');
    await fire('pointerdown', 1, 120, 200);
    await fire('pointermove', 1, 190, 230);
    await fire('pointermove', 1, 260, 260);
    await fire('pointerup', 1, 260, 260);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const g = document.querySelector('#wm-sketch .wm-sketch-shape');
      if (g) window.__wmStage.selectSketch(g.getAttribute('data-annotation-id'));
    });
    await page.waitForTimeout(200);
    const m = await page.evaluate((w) => {
      const inside = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
        return r.left >= -1 && r.right <= w + 1 && r.width > 0 && r.height > 0; };
      const bar = document.querySelector('.devbar');
      const row = document.querySelector('.devbar-row');
      const tray = document.getElementById('wm-sketch-tray');
      const del = document.getElementById('wm-sketch-delete');
      return { width: w,
        docOverflows: document.documentElement.scrollWidth > w,
        barOverflows: bar.scrollWidth > bar.clientWidth,
        rowOverflows: row.scrollWidth > row.clientWidth,
        rowWraps: getComputedStyle(row).flexWrap === 'wrap',
        toggleInView: inside(document.getElementById('wm-sketch-toggle')),
        trayInView: inside(tray),
        undoInView: inside(document.getElementById('wm-undo')),
        lineInView: inside(document.getElementById('wm-tool-line')),
        rectInView: inside(document.getElementById('wm-tool-rect')),
        deleteShown: !del.hidden,
        deleteInView: del.hidden ? null : inside(del),
        selected: !!window.__wmStage.getSelectedSketch(),
        tool: window.__wmStage.activeSketchTool() };
    }, vp.width);
    results.push(m);
    await ctx.close();
  }
  await browser.close();

  const all = (f) => results.every(f);
  const checks = [
    ['no horizontal document overflow at any tested width', all((r) => !r.docOverflows)],
    ['the dev bar itself never overflows horizontally', all((r) => !r.barOverflows)],
    ['the control row wraps instead of running off the edge',
      all((r) => r.rowWraps && !r.rowOverflows)],
    ['the Sketch toggle is on screen at every width', all((r) => r.toggleInView)],
    ['the open tray is fully on screen at every width', all((r) => r.trayInView)],
    ['Line, Rectangle and Undo are reachable at every width',
      all((r) => r.lineInView && r.rectInView && r.undoInView)],
    ['Delete is on screen wherever a shape is selected',
      results.every((r) => !r.deleteShown || r.deleteInView)],
    ['selecting a shape never arms a creation tool',
      results.every((r) => !r.selected || r.tool === 'none')],
  ];
  return { engine: engineName, available: true, detail: results, checks, errs };
}

// ── WM-6B2: sketch text ─────────────────────────────────────────────────────
async function runText(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  const dialogs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  // Any alert() from user text is an XSS failure, not a passing test.
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto(APP);

  const fire = (t, id, x, y, pt) => page.evaluate(({ t, id, x, y, pt }) => {
    const el = document.getElementById('wm-viewport'); const r = el.getBoundingClientRect();
    const tg = document.elementFromPoint(r.left + x, r.top + y) || el;
    tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: r.left + x,
      clientY: r.top + y, bubbles: true, pointerType: pt || 'touch' }));
  }, { t, id, x, y, pt });
  const tap = async (x, y, id, pt) => {
    await fire('pointerdown', id, x, y, pt); await fire('pointerup', id, x, y, pt);
    await page.waitForTimeout(180);
  };
  const at = (n) => page.evaluate((nn) => {
    const s = window.__wmStage;
    return WM.viewport.stageToScreen(WM.geometry.denormalizePoint(nn, s.getStageSize()), s.getViewport());
  }, n);
  const state = () => page.evaluate(async () => {
    const s = window.__wmStage;
    const db = WM.store.createStore(); await db.openDatabase();
    const sheetId = await db.getMeta('currentSheetId');
    const list = await db.listAnnotations(sheetId); db.closeDatabase();
    const texts = list.filter((a) => a.type === 'text');
    return { tool: s.activeSketchTool(), selected: s.getSelectedSketch(),
      pointers: s.getActivePointers(), gesture: s.getGestureMode(),
      editorOpen: !document.getElementById('wm-text-editor').hidden,
      err: document.getElementById('wm-text-error').textContent,
      undoDepth: s.undoSize(), storedTexts: texts.length,
      first: texts[0] ? { id: texts[0].id, text: texts[0].data.text, at: texts[0].at } : null,
      renderedTexts: document.querySelectorAll('#wm-sketch .wm-text-shape').length,
      textsElsewhere: document.querySelectorAll('#wm-labels .wm-text-shape').length
        + document.querySelectorAll('#wm-routes .wm-text-shape').length,
      view: JSON.stringify(s.getViewport()) };
  });
  const openTray = async () => {
    const open = await page.evaluate(() =>
      document.getElementById('wm-sketch-tray').classList.contains('open'));
    if (!open) await page.click('#wm-sketch-toggle');
    await page.waitForTimeout(120);
  };
  /**
   * Find a normalized point that is provably empty right now.
   *
   * Hard-coded coordinates go stale as the suite accumulates annotations: a
   * point that was blank grid early on can sit under a moved Text later. This
   * asks the DOM which candidate is actually unoccupied.
   */
  const emptyPoint = (preferred) => page.evaluate((want) => {
    const s = window.__wmStage, sz = s.getStageSize();
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const occupied = (node) => {
      let n = node;
      while (n && n !== vpEl) {
        const c = (n.getAttribute && n.getAttribute('class')) || '';
        if (/wm-text-shape|wm-sketch-shape|wm-arrow|wm-label|wm-endpoint|wm-sketch-handle/.test(c)) return true;
        n = n.parentNode;
      }
      return false;
    };
    const candidates = [want];
    for (let gx = 1; gx <= 8; gx++) {
      for (let gy = 1; gy <= 8; gy++) candidates.push({ x: gx / 9, y: gy / 9 });
    }
    for (const c of candidates) {
      const scr = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(c, sz), s.getViewport());
      if (scr.x < 4 || scr.y < 4 || scr.x > el.width - 4 || scr.y > el.height - 4) continue;
      const node = document.elementFromPoint(el.left + scr.x, el.top + scr.y);
      if (node && !occupied(node)) return c;
    }
    return null;
  }, preferred);

  const place = async (n, value, action) => {
    await openTray();
    await page.click('#wm-tool-text');
    const spot = (await emptyPoint(n)) || n;
    const p = await at(spot);
    await tap(p.x, p.y, Math.floor(Math.random() * 1e6));
    if (value !== null) await page.fill('#wm-text-value', value);
    if (action === 'save') await page.click('#wm-text-save');
    else if (action === 'cancel') await page.click('#wm-text-cancel');
    await page.waitForTimeout(300);
  };

  const R = {};
  await page.click('#wm-sketch-toggle');
  await page.click('#wm-blank-sheet');
  await page.waitForFunction(() => window.__wmStage.isGridVisible(), { timeout: 15000 });
  await page.waitForTimeout(250);

  // ── create, trim, one undo entry ──
  await place({ x: 0.4, y: 0.4 }, '  Panel A  ', 'save');
  R.created = await state();

  // ── cancel creates nothing ──
  await place({ x: 0.7, y: 0.8 }, 'Discarded', 'cancel');
  R.cancelled = await state();

  // ── whitespace-only save is refused ──
  await openTray();
  await page.click('#wm-tool-text');
  let pt = await at({ x: 0.2, y: 0.85 });
  await tap(pt.x, pt.y, 900);
  await page.fill('#wm-text-value', '      ');
  await page.click('#wm-text-save'); await page.waitForTimeout(200);
  R.blank = await state();
  await page.click('#wm-text-cancel'); await page.waitForTimeout(150);

  // ── constant font + hit target across zoom, several strings ──
  R.sizes = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const id = document.querySelector('.wm-text-shape').getAttribute('data-annotation-id');
    const base = s.getAnnotation(id);
    const rows = [];
    for (const str of ['A', 'Panel A', 'Feed from 3F', 'Zasilanie \u2013 kuchnia \u00e7\u00f6']) {
      s.upsertAnnotation({ ...base, data: { text: str } });
      for (const sc of [null, 1, 4, 8]) {
        if (sc) {
          s._setViewport(WM.viewport.centerOnNormalized(base.at, sz,
            { width: el.width, height: el.height }, s.getViewport(), sc));
        } else {
          s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
        }
        s.renderLabels();
        const t = document.querySelector('.wm-text-body');
        const hit = document.querySelector('.wm-text-hit');
        const scale = s.getViewport().scale;
        const hr = hit.getBoundingClientRect();
        rows.push({ str, scale: +scale.toFixed(3),
          stageFont: +parseFloat(t.getAttribute('font-size')).toFixed(4),
          expectedStage: +(16 / scale).toFixed(4),
          screenFont: +(parseFloat(t.getAttribute('font-size')) * scale).toFixed(2),
          hitH: +hr.height.toFixed(1), hitW: +hr.width.toFixed(1),
          cssFont: getComputedStyle(t).fontSize,
          vectorEffect: getComputedStyle(t).vectorEffect,
          hasTransform: !!t.getAttribute('transform') });
      }
    }
    s.upsertAnnotation(base);
    s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
    s.renderLabels();
    return rows;
  });

  // ── anchor never mutates under zoom ──
  R.anchor = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const id = document.querySelector('.wm-text-shape').getAttribute('data-annotation-id');
    const before = JSON.stringify(s.getAnnotation(id).at);
    const stagePoint = WM.geometry.denormalizePoint(s.getAnnotation(id).at, sz);
    let drift = 0;
    for (const sc of [0.195, 1, 4, 8]) {
      s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
        { width: el.width, height: el.height }, s.getViewport(), sc));
      s.renderLabels();
      const v = s.getViewport();
      const back = WM.viewport.screenToStage(WM.viewport.stageToScreen(stagePoint, v), v);
      drift = Math.max(drift, Math.hypot(back.x - stagePoint.x, back.y - stagePoint.y));
    }
    s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
    s.renderLabels();
    return { unchanged: JSON.stringify(s.getAnnotation(id).at) === before, maxDrift: +drift.toFixed(9) };
  });

  // ── no-jump drag, measured ──
  const anchor = (await state()).first.at;
  let p = await at(anchor);
  const grab = { x: p.x + 30, y: p.y - 8 };
  const viewBefore = (await state()).view;
  await fire('pointerdown', 10, grab.x, grab.y);
  await fire('pointermove', 10, grab.x + 20, grab.y + 10);
  const firstPreview = await page.evaluate((id) => window.__wmStage.getAnnotation(id).at,
    (await state()).first.id);
  const previewScreen = await at(firstPreview);
  R.noJump = {
    grabOffsetBefore: { x: +(grab.x - p.x).toFixed(2), y: +(grab.y - p.y).toFixed(2) },
    grabOffsetAfter: { x: +(grab.x + 20 - previewScreen.x).toFixed(2),
      y: +(grab.y + 10 - previewScreen.y).toFixed(2) } };
  for (const d of [50, 90]) await fire('pointermove', 10, grab.x + d, grab.y + d * 0.5);
  await fire('pointerup', 10, grab.x + 90, grab.y + 45);
  await page.waitForTimeout(350);
  const afterDrag = await state();
  R.drag = { moved: JSON.stringify(afterDrag.first.at) !== JSON.stringify(anchor),
    editorStayedClosed: !afterDrag.editorOpen,
    stageDelta: afterDrag.view === viewBefore,
    undoDepth: afterDrag.undoDepth, pointers: afterDrag.pointers, gesture: afterDrag.gesture,
    textUnchanged: afterDrag.first.text === 'Panel A' };

  // ── THE SEQUENCING CASE: tap immediately after a drag ──
  p = await at(afterDrag.first.at);
  await tap(p.x + 25, p.y - 8, 11);
  R.tapAfterDrag = await page.evaluate(() => ({
    open: !document.getElementById('wm-text-editor').hidden,
    title: document.getElementById('wm-text-title').textContent,
    value: document.getElementById('wm-text-value').value }));
  await page.fill('#wm-text-value', 'Panel B');
  await page.click('#wm-text-save'); await page.waitForTimeout(300);
  const afterEdit = await state();
  R.edit = { text: afterEdit.first.text, sameId: afterEdit.first.id === afterDrag.first.id,
    anchorUnchanged: JSON.stringify(afterEdit.first.at) === JSON.stringify(afterDrag.first.at),
    undoDepth: afterEdit.undoDepth };

  // drag again, then tap again — the artifact would surface here
  p = await at(afterEdit.first.at);
  await fire('pointerdown', 12, p.x + 25, p.y - 8);
  for (const d of [25, 60]) await fire('pointermove', 12, p.x + 25 + d, p.y - 8 - d * 0.4);
  await fire('pointerup', 12, p.x + 85, p.y - 32);
  await page.waitForTimeout(350);
  const afterDrag2 = await state();
  p = await at(afterDrag2.first.at);
  await tap(p.x + 25, p.y - 8, 13);
  R.secondCycle = { dragMoved: JSON.stringify(afterDrag2.first.at) !== JSON.stringify(afterEdit.first.at),
    editorOpensAgain: await page.evaluate(() => !document.getElementById('wm-text-editor').hidden),
    valueIsCurrent: await page.evaluate(() => document.getElementById('wm-text-value').value) === 'Panel B',
    pointers: afterDrag2.pointers, gesture: afterDrag2.gesture };
  await page.click('#wm-text-cancel'); await page.waitForTimeout(150);

  // ── pointercancel restores ──
  const beforeCancel = await state();
  p = await at(beforeCancel.first.at);
  await fire('pointerdown', 14, p.x + 25, p.y - 8);
  for (const d of [30, 70]) await fire('pointermove', 14, p.x + 25 + d, p.y - 8 + d);
  await page.evaluate(() => document.getElementById('wm-viewport')
    .dispatchEvent(new PointerEvent('pointercancel', { pointerId: 14, bubbles: true })));
  await page.waitForTimeout(250);
  const afterCancelDrag = await state();
  R.pointercancel = {
    anchorRestored: JSON.stringify(afterCancelDrag.first.at) === JSON.stringify(beforeCancel.first.at),
    undoUnchanged: afterCancelDrag.undoDepth === beforeCancel.undoDepth,
    stageUnchanged: afterCancelDrag.view === beforeCancel.view,
    pointers: afterCancelDrag.pointers };

  // ── visible selection outline vs invisible hit target ──
  R.outline = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const id = document.querySelector('.wm-text-shape').getAttribute('data-annotation-id');
    const base = s.getAnnotation(id);
    const rows = [];
    for (const str of ['Panel B', 'A', 'Feed from 3F', 'gjpqy', '12345',
      '<script>alert(1)</script>', 'Zasilanie – kuchnia']) {
      s.upsertAnnotation({ ...base, data: { text: str } });
      for (const sc of [null, 1, 4, 8]) {
        if (sc) {
          s._setViewport(WM.viewport.centerOnNormalized(base.at, sz,
            { width: el.width, height: el.height }, s.getViewport(), sc));
        } else {
          s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
        }
        s.renderLabels();
        s.selectSketch(id);
        const t = document.querySelector('.wm-text-body');
        const hit = document.querySelector('.wm-text-hit');
        const outline = document.querySelector('.wm-text-outline');
        if (!t || !hit || !outline) { rows.push({ str, missing: true }); continue; }
        const tb = t.getBoundingClientRect();
        const hb = hit.getBoundingClientRect();
        const ob = outline.getBoundingClientRect();
        rows.push({ str: str.slice(0, 12), scale: +s.getViewport().scale.toFixed(3),
          separateNodes: outline !== hit,
          hitH: +hb.height.toFixed(1), outH: +ob.height.toFixed(1),
          top: +(tb.top - ob.top).toFixed(1), bottom: +(ob.bottom - tb.bottom).toFixed(1),
          left: +(tb.left - ob.left).toFixed(1), right: +(ob.right - tb.right).toFixed(1),
          enclosesGlyphs: ob.top <= tb.top + 0.6 && ob.bottom >= tb.bottom - 0.6
            && ob.left <= tb.left + 0.6 && ob.right >= tb.right - 0.6,
          hitStroke: getComputedStyle(hit).stroke });
      }
    }
    // Unselected text must show no outline at all.
    s.selectSketch(null);
    s.upsertAnnotation(base);
    s.renderLabels();
    const unselectedOutline = document.querySelectorAll('.wm-text-outline').length;
    const hitStillThere = document.querySelectorAll('.wm-text-hit').length;
    s._setViewport(WM.viewport.fitToViewport(sz, { width: el.width, height: el.height }));
    s.renderLabels();
    return { rows, unselectedOutline, hitStillThere };
  });

  // ── STATE-LEAK GUARD ──
  // pointercancel once threw (a stray pointermove block referenced an `e` that
  // does not exist in that handler). The exception aborted cleanup, left the
  // text drag registered, and every later placement was swallowed by it. This
  // proves the handler completes and that placement still works right after.
  R.afterCancelPlacement = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const occupied = (node) => { let n = node;
      while (n && n !== vpEl) {
        const c = (n.getAttribute && n.getAttribute('class')) || '';
        if (/wm-text-shape|wm-sketch-shape|wm-arrow|wm-label|wm-endpoint|wm-sketch-handle/.test(c)) return true;
        n = n.parentNode; }
      return false; };
    let spot = null;
    for (let gx = 1; gx <= 8 && !spot; gx++) for (let gy = 1; gy <= 8 && !spot; gy++) {
      const c = { x: gx / 9, y: gy / 9 };
      const scr = WM.viewport.stageToScreen(WM.geometry.denormalizePoint(c, sz), s.getViewport());
      if (scr.x < 4 || scr.y < 4 || scr.x > el.width - 4 || scr.y > el.height - 4) continue;
      const node = document.elementFromPoint(el.left + scr.x, el.top + scr.y);
      if (node && !occupied(node)) spot = scr;
    }
    if (!spot) return { probed: false };
    s.armSketch('text');
    const armed = s.activeSketchTool();
    const send = (t) => {
      const tg = document.elementFromPoint(el.left + spot.x, el.top + spot.y) || vpEl;
      tg.dispatchEvent(new PointerEvent(t, { pointerId: 888, clientX: el.left + spot.x,
        clientY: el.top + spot.y, bubbles: true, pointerType: 'touch' }));
    };
    send('pointerdown'); send('pointerup');
    const opened = !document.getElementById('wm-text-editor').hidden;
    if (opened) document.getElementById('wm-text-cancel').click();
    s.disarmSketch();
    return { probed: true, armed, opened, pointers: s.getActivePointers(),
      gesture: s.getGestureMode() };
  });

  // ── undo move, then undo edit ──
  await page.click('#wm-undo'); await page.waitForTimeout(300);
  const u1 = await state();
  await page.click('#wm-undo'); await page.waitForTimeout(300);
  const u2 = await state();
  R.undo = { afterFirst: u1.first.at, textAfterFirst: u1.first.text,
    textAfterSecond: u2.first.text, backToPanelA: u2.first.text === 'Panel A' };

  // ── XSS ──
  await place({ x: 0.15, y: 0.15 }, '<script>alert(1)</script>', 'save');
  R.xss = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const sheetId = await db.getMeta('currentSheetId');
    const list = await db.listAnnotations(sheetId); db.closeDatabase();
    const t = list.find((a) => a.data.text && a.data.text.indexOf('script') !== -1);
    const nodes = Array.from(document.querySelectorAll('#wm-sketch .wm-text-body'));
    const shown = nodes.map((n) => n.textContent);
    return { stored: t ? t.data.text : null,
      renderedLiterally: shown.indexOf('<script>alert(1)</script>') !== -1,
      scriptElements: document.querySelectorAll('#wm-sketch script').length };
  });

  // ── armed Text must not hijack existing annotations ──
  await openTray();
  await page.click('#wm-tool-line');
  await fire('pointerdown', 20, 120, 300);
  await fire('pointermove', 20, 200, 320);
  await fire('pointerup', 20, 280, 340);
  await page.waitForTimeout(300);
  await page.click('#wm-add-label');
  let lp = await at({ x: 0.55, y: 0.2 });
  await tap(lp.x, lp.y, 21);
  await page.fill('#wm-f-label', 'HR-7');
  await page.click('#wm-editor-save'); await page.waitForTimeout(300);

  const before = await state();
  const targets = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const scr = (n) => WM.viewport.stageToScreen(WM.geometry.denormalizePoint(n, sz), s.getViewport());
    const out = {};
    const lb = document.querySelector('.wm-label');
    if (lb) out.label = scr(s.getAnnotation(lb.getAttribute('data-annotation-id')).at);
    const ln = document.querySelector('.wm-sketch-shape');
    if (ln) { const a = s.getAnnotation(ln.getAttribute('data-annotation-id'));
      out.line = scr({ x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 }); }
    const tx = document.querySelector('.wm-text-shape');
    if (tx) out.text = scr(s.getAnnotation(tx.getAttribute('data-annotation-id')).at);
    return out;
  });
  R.armedPriority = {};
  for (const [name, pnt] of Object.entries(targets)) {
    await openTray();
    await page.click('#wm-tool-text');
    await tap(pnt.x + (name === 'text' ? 20 : 0), pnt.y - (name === 'text' ? 6 : 0), 30);
    const st = await state();
    R.armedPriority[name] = { newTextCreated: st.storedTexts > before.storedTexts,
      textEditorOpen: st.editorOpen };
    await page.evaluate(() => {
      document.getElementById('wm-text-editor').hidden = true;
      document.getElementById('wm-editor').hidden = true;
      window.__wmStage.disarmSketch();
    });
    await page.waitForTimeout(120);
  }
  await openTray();
  await page.click('#wm-tool-text');
  let empty = await at({ x: 0.05, y: 0.95 });
  await tap(empty.x, empty.y, 31);
  R.armedOnEmpty = await page.evaluate(() => !document.getElementById('wm-text-editor').hidden);
  await page.click('#wm-text-cancel'); await page.waitForTimeout(150);

  // ── iOS compatibility: touch then synthesised mouse ──
  const preIos = await state();
  p = await at(preIos.first.at);
  await tap(p.x + 25, p.y - 8, 40, 'touch');
  const iosTouch = await page.evaluate(() => !document.getElementById('wm-text-editor').hidden);
  await tap(p.x + 25, p.y - 8, 41, 'mouse');
  const iosCompat = await state();
  R.ios = { editorAfterTouch: iosTouch, storedUnchanged: iosCompat.storedTexts === preIos.storedTexts,
    undoUnchanged: iosCompat.undoDepth === preIos.undoDepth };
  await page.click('#wm-text-cancel'); await page.waitForTimeout(150);
  // a fresh legitimate touch afterwards must still work
  await tap(p.x + 25, p.y - 8, 42, 'touch');
  R.freshTouchAfterIos = await page.evaluate(() => !document.getElementById('wm-text-editor').hidden);
  await page.click('#wm-text-cancel'); await page.waitForTimeout(150);

  // ── delete then undo ──
  const preDelete = await state();
  p = await at(preDelete.first.at);
  await tap(p.x + 25, p.y - 8, 50);
  await page.click('#wm-text-delete'); await page.waitForTimeout(300);
  const afterDelete = await state();
  await page.click('#wm-undo'); await page.waitForTimeout(300);
  const afterUndoDelete = await state();
  R.deleteUndo = { removed: afterDelete.storedTexts === preDelete.storedTexts - 1,
    restored: afterUndoDelete.storedTexts === preDelete.storedTexts,
    sameId: !!afterUndoDelete.first && afterUndoDelete.first.id === preDelete.first.id,
    sameText: !!afterUndoDelete.first && afterUndoDelete.first.text === preDelete.first.text,
    sameAnchor: !!afterUndoDelete.first
      && JSON.stringify(afterUndoDelete.first.at) === JSON.stringify(preDelete.first.at) };

  // ── reload persistence, blank sheet ──
  await page.reload(); await page.waitForTimeout(200);
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() > 0, { timeout: 20000 });
  await page.waitForTimeout(300);
  const reloaded = await state();
  R.reload = { texts: reloaded.storedTexts, rendered: reloaded.renderedTexts,
    inSketchOnly: reloaded.textsElsewhere === 0,
    sameId: !!reloaded.first && reloaded.first.id === preDelete.first.id };

  // ── image sheet: no cross-sheet leakage ──
  // Start from a clean load. The blank-sheet section above ends after two
  // reloads and a long gesture sequence; importing on top of that state made
  // the section fragile for reasons unrelated to what it is meant to prove.
  await page.reload();
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500;
    c.getContext('2d').fillRect(0, 0, 2000, 1500);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'p.jpg', { type: 'image/jpeg' }));
    const i = document.getElementById('wm-dev-file'); i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.__wmStage.hasImage(), { timeout: 20000 });
  await page.waitForTimeout(300);
  const freshSheet = await state();
  await place({ x: 0.35, y: 0.55 }, 'On photo', 'save');
  const onImage = await state();
  await page.reload(); await page.waitForTimeout(200);
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() > 0, { timeout: 20000 });
  await page.waitForTimeout(300);
  const imageReloaded = await state();
  R.imageSheet = { startedEmpty: freshSheet.storedTexts === 0,
    created: onImage.storedTexts === 1 && onImage.first.text === 'On photo',
    survivesReload: imageReloaded.storedTexts === 1
      && imageReloaded.first.text === 'On photo'
      && JSON.stringify(imageReloaded.first.at) === JSON.stringify(onImage.first.at) };

  await browser.close();

  const sz = R.sizes;
  const checks = [
    ['creating text stores the trimmed value and one undo entry',
      R.created.storedTexts === 1 && R.created.first.text === 'Panel A'
      && R.created.undoDepth === 1 && !R.created.editorOpen && R.created.tool === 'none'],
    ['text renders only in wm-sketch',
      R.created.renderedTexts === 1 && R.created.textsElsewhere === 0],
    ['Cancel creates nothing and pushes no undo entry',
      R.cancelled.storedTexts === 1 && R.cancelled.undoDepth === 1 && R.cancelled.tool === 'none'],
    ['whitespace-only Save is refused with the editor still open',
      R.blank.editorOpen && /required/i.test(R.blank.err)
      && R.blank.storedTexts === 1 && R.blank.undoDepth === 1],
    ['generated font-size equals 16 / scale for every string and zoom',
      sz.every((r) => Math.abs(r.stageFont - r.expectedStage) < 1e-3)],
    ['effective font stays ~16 screen px', sz.every((r) => Math.abs(r.screenFont - 16) < 0.2)],
    ['no CSS font-size or vector-effect overrides the generated value',
      sz.every((r) => r.vectorEffect === 'none' && !r.hasTransform
        && Math.abs(parseFloat(r.cssFont) - r.stageFont) < 1e-3)],
    ['the hit target is at least ~44 screen px tall for every string',
      sz.every((r) => r.hitH >= 43.5)],
    ['the hit target is wider than the shortest glyph run', sz.every((r) => r.hitW > 20)],
    ['the stored anchor never changes under zoom and does not drift',
      R.anchor.unchanged && R.anchor.maxDrift < 1e-6],
    ['NO-JUMP: the grab offset survives the first move',
      Math.abs(R.noJump.grabOffsetAfter.x - R.noJump.grabOffsetBefore.x) < 1.5
      && Math.abs(R.noJump.grabOffsetAfter.y - R.noJump.grabOffsetBefore.y) < 1.5],
    ['a drag moves the text without opening the editor',
      R.drag.moved && R.drag.editorStayedClosed && R.drag.textUnchanged],
    ['a drag does not pan the stage and leaves the gesture idle',
      R.drag.stageDelta && R.drag.pointers === 0 && R.drag.gesture === 'idle'],
    ['a completed move pushes exactly one undo entry', R.drag.undoDepth === 2],
    ['SEQUENCING: a tap right after a drag opens the editor',
      R.tapAfterDrag.open && R.tapAfterDrag.value === 'Panel A'
      && /EDIT/.test(R.tapAfterDrag.title)],
    ['editing keeps the id and anchor and pushes one undo entry',
      R.edit.text === 'Panel B' && R.edit.sameId && R.edit.anchorUnchanged
      && R.edit.undoDepth === 3],
    ['SEQUENCING: drag, edit, drag, tap all keep working',
      R.secondCycle.dragMoved && R.secondCycle.editorOpensAgain
      && R.secondCycle.valueIsCurrent && R.secondCycle.pointers === 0
      && R.secondCycle.gesture === 'idle'],
    ['pointercancel restores the anchor and writes nothing',
      R.pointercancel.anchorRestored && R.pointercancel.undoUnchanged
      && R.pointercancel.stageUnchanged && R.pointercancel.pointers === 0],
    ['the visible outline is a SEPARATE node from the touch target',
      R.outline.rows.every((r) => r.separateNodes)],
    ['the outline hugs the glyphs instead of the 44px touch target',
      R.outline.rows.every((r) => r.outH < r.hitH - 8)],
    ['the outline encloses the rendered glyphs for every string',
      R.outline.rows.every((r) => r.enclosesGlyphs)],
    ['outline padding is roughly symmetric top to bottom',
      R.outline.rows.every((r) => Math.abs(r.top - r.bottom) <= 4)],
    ['the outline keeps a constant screen size across zoom',
      (() => { const byStr = {};
        R.outline.rows.forEach((r) => { (byStr[r.str] = byStr[r.str] || []).push(r.outH); });
        return Object.values(byStr).every((hs) => Math.max(...hs) - Math.min(...hs) < 1); })()],
    ['the touch target stays >= 44 screen px regardless of the outline',
      R.outline.rows.every((r) => r.hitH >= 43.5)],
    ['the hit rect itself is never painted',
      R.outline.rows.every((r) => r.hitStroke === 'none' || /rgba\(0, 0, 0, 0\)/.test(r.hitStroke))],
    ['unselected text shows no outline but keeps its touch target',
      R.outline.unselectedOutline === 0 && R.outline.hitStillThere === 1],
    ['STATE LEAK: placement still works immediately after a pointercancel',
      R.afterCancelPlacement.probed && R.afterCancelPlacement.armed === 'text'
      && R.afterCancelPlacement.opened && R.afterCancelPlacement.pointers === 0
      && R.afterCancelPlacement.gesture === 'idle'],
    ['undo reverses the move, then the content edit',
      R.undo.textAfterFirst === 'Panel B' && R.undo.backToPanelA],
    ['XSS: script-like text is stored and rendered literally',
      R.xss.stored === '<script>alert(1)</script>' && R.xss.renderedLiterally
      && R.xss.scriptElements === 0],
    ['XSS: no dialog was triggered', dialogs.length === 0],
    ['armed Text creates nothing on a Wire Label',
      !R.armedPriority.label || !R.armedPriority.label.newTextCreated],
    ['armed Text creates nothing on a sketch line',
      !R.armedPriority.line || !R.armedPriority.line.newTextCreated],
    ['armed Text creates nothing on existing text',
      !R.armedPriority.text || !R.armedPriority.text.newTextCreated],
    ['armed Text on truly empty sheet opens a new draft', R.armedOnEmpty],
    ['iOS: touch opens the editor and the compatibility pair adds nothing',
      R.ios.editorAfterTouch && R.ios.storedUnchanged && R.ios.undoUnchanged],
    ['iOS: a fresh touch after the compatibility pair still works', R.freshTouchAfterIos],
    ['delete removes the text and undo restores id, content and anchor',
      R.deleteUndo.removed && R.deleteUndo.restored && R.deleteUndo.sameId
      && R.deleteUndo.sameText && R.deleteUndo.sameAnchor],
    ['text survives a reload of the blank sheet',
      R.reload.texts >= 1 && R.reload.rendered >= 1 && R.reload.inSketchOnly && R.reload.sameId],
    ['a new image sheet inherits no text from the blank sheet', R.imageSheet.startedEmpty],
    ['text works on an image sheet and survives its reload',
      R.imageSheet.created && R.imageSheet.survivesReload],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-7: wire lookup ───────────────────────────────────────────────────────
async function runLookup(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  const dialogs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto(APP);

  const R = {};
  const closeLookup = () => page.evaluate(() => {
    document.getElementById('wm-lookup').hidden = true;
  });

  // Seed one job with three sheets and labels, through the real store.
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'wm-dev-job', name: 'Wire Map Development', now }));
    const sheets = [
      { id: 'sh1', name: 'Kitchen Plan', order: 0 },
      { id: 'sh2', name: 'Bedroom Plan', order: 1 },
      { id: 'sh3', name: 'Roof Plan', order: 2 },
    ];
    for (const s of sheets) {
      await db.putSheet(WM.model.createSheet({ id: s.id, jobId: 'wm-dev-job', name: s.name,
        kind: 'blank', width: 2000, height: 1500, order: s.order, now }));
    }
    const mk = (id, sheetId, at, data) => WM.model.createAnnotation({ id, sheetId,
      type: 'wireLabel', at, now, data });
    await db.putAnnotation(mk('l1', 'sh1', { x: 0.30, y: 0.40 }, { label: 'HR-07',
      from: 'Panel A', to: 'Kitchen', cable: '12/2 MC', room: 'Kitchen',
      notes: 'home run above ceiling' }));
    await db.putAnnotation(mk('l2', 'sh2', { x: 0.55, y: 0.60 }, { label: 'HR-08',
      from: 'Panel A', to: 'Bedroom', cable: '12/2 MC', room: 'Bedroom' }));
    await db.putAnnotation(mk('l3', 'sh3', { x: 0.02, y: 0.98 }, { label: 'HR-07',
      from: 'Panel B', to: 'Roof', cable: '10/2 MC', room: 'Roof',
      notes: '<script>alert(1)</script>' }));
    // A second job that must never leak into results.
    await db.putJob(WM.model.createJob({ id: 'other-job', name: 'Other', now }));
    await db.putSheet(WM.model.createSheet({ id: 'shX', jobId: 'other-job', name: 'Other Plan',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.putAnnotation(mk('lx', 'shX', { x: 0.5, y: 0.5 }, { label: 'HR-99', room: 'Kitchen' }));
    await db.setMeta('currentSheetId', 'sh1');
    db.closeDatabase();
  });
  await closeLookup(); await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() > 0, { timeout: 20000 });
  await page.waitForTimeout(300);

  const doSearch = async (q) => {
    await page.evaluate(() => { document.getElementById('wm-lookup').hidden = true; });
    await page.click('#wm-lookup-open');
    await page.fill('#wm-lookup-query', q);
    await page.click('#wm-lookup-search');
    await page.waitForTimeout(350);
    return page.evaluate(() => ({
      count: document.getElementById('wm-lookup-count').textContent,
      cards: Array.from(document.querySelectorAll('.result')).map(c => ({
        label: c.querySelector('.result-label').textContent,
        sheet: c.querySelector('.result-sheet').textContent,
        sheetId: c.getAttribute('data-sheet-id'),
        annId: c.getAttribute('data-annotation-id'),
        text: c.textContent })),
      scriptNodes: document.querySelectorAll('#wm-lookup script').length,
      modalInView: (() => { const r = document.querySelector('#wm-lookup .sheet-panel').getBoundingClientRect();
        return r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 0; })(),
    }));
  };

  R.exact = await doSearch('HR-07');
  R.spaced = await doSearch('hr 07');
  R.underscore = await doSearch('HR_07');
  R.room = await doSearch('Kitchen');
  R.cable = await doSearch('12/2');
  R.none = await doSearch('nonexistent-value');
  R.xss = await doSearch('<script>');
  R.empty = await doSearch('   ');

  // navigate to a result on another sheet
  R.beforeNav = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId'); db.closeDatabase();
    return { current: cur, labels: document.querySelectorAll('.wm-label').length };
  });
  await doSearch('HR-08');
  await page.click('.result[data-annotation-id="l2"]');
  await page.waitForTimeout(600);
  R.afterNav = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId'); db.closeDatabase();
    const s = window.__wmStage;
    const a = s.getAnnotation('l2');
    const sz = s.getStageSize();
    const scr = a ? WM.viewport.stageToScreen(WM.geometry.denormalizePoint(a.at, sz), s.getViewport()) : null;
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    return { current: cur, lookupClosed: document.getElementById('wm-lookup').hidden,
      editorClosed: document.getElementById('wm-editor').hidden,
      labels: document.querySelectorAll('.wm-label').length,
      hasL2: !!a, anchor: a ? a.at : null,
      offCentre: scr ? Math.round(Math.hypot(scr.x - el.width / 2, scr.y - el.height / 2)) : null,
      finite: Number.isFinite(s.getViewport().translateX) && Number.isFinite(s.getViewport().scale) };
  });

  // same-sheet focus must preserve zoom
  await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
      { width: el.width, height: el.height }, s.getViewport(), 4));
    s.renderLabels();
  });
  const zoomBefore = await page.evaluate(() => window.__wmStage.getViewport().scale);
  await doSearch('HR-08');
  await page.click('.result[data-annotation-id="l2"]');
  await page.waitForTimeout(400);
  R.sameSheet = await page.evaluate((z) => ({
    scaleKept: Math.abs(window.__wmStage.getViewport().scale - z) < 1e-6,
    scale: window.__wmStage.getViewport().scale }), zoomBefore);

  // edge label focus must clamp legally
  await doSearch('Roof');
  await page.click('.result[data-annotation-id="l3"]');
  await page.waitForTimeout(600);
  R.edge = await page.evaluate(() => {
    const s = window.__wmStage, v = s.getViewport();
    const a = s.getAnnotation('l3');
    return { finite: Number.isFinite(v.translateX) && Number.isFinite(v.translateY) && Number.isFinite(v.scale),
      anchorUnchanged: a && a.at.x === 0.02 && a.at.y === 0.98,
      current: document.querySelectorAll('.wm-label').length };
  });

  // edit then search: no stale results
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    await db.setMeta('currentSheetId', 'sh1'); db.closeDatabase();
  });
  await closeLookup(); await page.click('#wm-dev-load');
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const a = await db.getAnnotation('l1');
    const next = WM.model.createAnnotation({ id: a.id, sheetId: a.sheetId, type: 'wireLabel',
      at: a.at, now: a.createdAt, data: Object.assign({}, a.data, { label: 'HR-21' }) });
    await db.putAnnotation(next); db.closeDatabase();
  });
  R.afterEdit = { old: (await doSearch('HR-07')).cards.length,
    neu: (await doSearch('HR-21')).cards.length };
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    await db.deleteAnnotation('l1'); db.closeDatabase();
  });
  R.afterDelete = (await doSearch('HR-21')).cards.length;

  // cross-job isolation
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    await db.setMeta('currentSheetId', 'shX'); db.closeDatabase();
  });
  await closeLookup(); await page.click('#wm-dev-load'); await page.waitForTimeout(500);
  R.otherJob = (await doSearch('HR')).cards.map(c => c.label);


  // ── responsive: the Lookup control and modal must fit every target width ──
  R.responsive = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 },
    { width: 844, height: 390 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(250);
    await page.evaluate(() => { document.getElementById('wm-lookup').hidden = false; });
    await page.waitForTimeout(150);
    R.responsive.push(await page.evaluate((w) => {
      const inView = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
        return r.left >= -1 && r.right <= w + 1 && r.width > 0 && r.height > 0; };
      const bar = document.querySelector('.devbar');
      const panel = document.querySelector('#wm-lookup .sheet-panel');
      const results = document.getElementById('wm-lookup-results');
      return { width: w,
        docOverflows: document.documentElement.scrollWidth > w,
        barOverflows: bar.scrollWidth > bar.clientWidth + 1,
        openBtn: inView(document.getElementById('wm-lookup-open')),
        panel: inView(panel),
        input: inView(document.getElementById('wm-lookup-query')),
        searchBtn: inView(document.getElementById('wm-lookup-search')),
        closeBtn: inView(document.getElementById('wm-lookup-close')),
        resultsScroll: getComputedStyle(results).overflowY === 'auto',
        cardsFit: Array.from(document.querySelectorAll('.result'))
          .every((c) => c.getBoundingClientRect().right <= w + 1) };
    }, vp.width));
    await page.evaluate(() => { document.getElementById('wm-lookup').hidden = true; });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await browser.close();

  const exactIds = R.exact.cards.map((c) => c.annId);
  const checks = [
    ['an exact label search finds both sheets, exact first',
      R.exact.cards.length === 2 && exactIds[0] === 'l1' && exactIds[1] === 'l3'],
    ['results name the real sheets, not database ids',
      R.exact.cards[0].sheet === 'Kitchen Plan' && R.exact.cards[1].sheet === 'Roof Plan'],
    ['"hr 07" normalizes to the same two results',
      R.spaced.cards.map((c) => c.annId).join() === exactIds.join()],
    ['"HR_07" normalizes to the same two results',
      R.underscore.cards.map((c) => c.annId).join() === exactIds.join()],
    ['DUPLICATE labels on two sheets are both shown',
      R.exact.cards.length === 2 && R.exact.cards[0].sheetId !== R.exact.cards[1].sheetId],
    ['room metadata finds the wire', R.room.cards.length === 1 && R.room.cards[0].annId === 'l1'],
    ['cable metadata finds both 12/2 wires', R.cable.cards.length === 2],
    ['a miss gives a clean zero state',
      R.none.cards.length === 0 && /No matching/.test(R.none.count)],
    ['an empty query prompts instead of searching',
      R.empty.cards.length === 0 && /Enter a wire label/.test(R.empty.count)],
    ['XSS: HTML-looking metadata renders literally, no script node',
      R.xss.cards.length === 1
      && R.xss.cards[0].text.indexOf('<script>alert(1)</script>') !== -1
      && R.xss.scriptNodes === 0],
    ['XSS: no dialog fired', dialogs.length === 0],
    ['tapping a result switches the current sheet in meta',
      R.beforeNav.current === 'sh1' && R.afterNav.current === 'sh2'],
    ['navigation closes Lookup and does NOT open the label editor',
      R.afterNav.lookupClosed && R.afterNav.editorClosed],
    ['only the target sheet\'s annotations are rendered',
      R.afterNav.labels === 1 && R.afterNav.hasL2],
    ['the matched label is brought near the viewport centre',
      R.afterNav.offCentre !== null && R.afterNav.offCentre < 60 && R.afterNav.finite],
    ['navigation does not mutate the stored anchor',
      R.afterNav.anchor.x === 0.55 && R.afterNav.anchor.y === 0.6],
    ['a same-sheet result PRESERVES the current zoom', R.sameSheet.scaleKept],
    ['an edge label clamps legally with no NaN transform',
      R.edge.finite && R.edge.anchorUnchanged],
    ['editing a label updates search results with no stale cache',
      R.afterEdit.old === 1 && R.afterEdit.neu === 1],
    ['deleting a label removes it from search', R.afterDelete === 0],
    ['NO CROSS-JOB LEAKAGE: another job sees only its own labels',
      R.otherJob.length === 1 && R.otherJob[0] === 'HR-99'],
    ['no horizontal overflow at any tested width',
      R.responsive.every((r) => !r.docOverflows && !r.barOverflows)],
    ['Lookup control and modal are reachable at every width',
      R.responsive.every((r) => r.openBtn && r.panel)],
    ['input, Search and Close are reachable at every width',
      R.responsive.every((r) => r.input && r.searchBtn && r.closeBtn)],
    ['the results area scrolls and cards do not overflow',
      R.responsive.every((r) => r.resultsScroll && r.cardsFit)],
    ['no page errors during the whole lookup flow', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-7: normal interaction after Lookup closes ────────────────────────────
async function runLookupAftermath(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const fire = (t, id, x, y, pt) => page.evaluate(({ t, id, x, y, pt }) => {
    const el = document.getElementById('wm-viewport'); const r = el.getBoundingClientRect();
    const tg = document.elementFromPoint(r.left + x, r.top + y) || el;
    tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: r.left + x,
      clientY: r.top + y, bubbles: true, pointerType: pt || 'touch' }));
  }, { t, id, x, y, pt });
  const tap = async (x, y, id, pt) => {
    await fire('pointerdown', id, x, y, pt); await fire('pointerup', id, x, y, pt);
    await page.waitForTimeout(180);
  };
  const drag = async (id, from, to) => {
    await fire('pointerdown', id, from.x, from.y);
    for (const f of [0.4, 0.8, 1]) {
      await fire('pointermove', id, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f);
    }
    await fire('pointerup', id, to.x, to.y);
    await page.waitForTimeout(300);
  };
  const at = (n) => page.evaluate((nn) => {
    const s = window.__wmStage;
    return WM.viewport.stageToScreen(WM.geometry.denormalizePoint(nn, s.getStageSize()), s.getViewport());
  }, n);

  // Two sheets in one job, the first carrying every annotation type.
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'wm-dev-job', name: 'Wire Map Development', now }));
    for (const [id, name, order] of [['ah1', 'Main Plan', 0], ['ah2', 'Second Plan', 1]]) {
      await db.putSheet(WM.model.createSheet({ id, jobId: 'wm-dev-job', name, kind: 'blank',
        width: 2000, height: 1500, order, now }));
    }
    const ann = (o) => WM.model.createAnnotation(Object.assign({ sheetId: 'ah1', now }, o));
    await db.putAnnotation(ann({ id: 'k-label', type: 'wireLabel', at: { x: 0.70, y: 0.20 },
      data: { label: 'HR-07', from: 'Panel A', to: 'Kitchen' } }));
    await db.putAnnotation(ann({ id: 'k-arrow', type: 'arrow',
      a: { x: 0.20, y: 0.48 }, b: { x: 0.60, y: 0.48 } }));
    await db.putAnnotation(ann({ id: 'k-line', type: 'line',
      a: { x: 0.20, y: 0.72 }, b: { x: 0.60, y: 0.72 } }));
    await db.putAnnotation(ann({ id: 'k-rect', type: 'rect',
      a: { x: 0.25, y: 0.88 }, b: { x: 0.65, y: 0.97 } }));
    await db.putAnnotation(ann({ id: 'k-text', type: 'text', at: { x: 0.30, y: 0.30 },
      data: { text: 'Panel A' } }));
    await db.putAnnotation(ann({ id: 'k-far', sheetId: 'ah2', type: 'wireLabel',
      at: { x: 0.55, y: 0.60 }, data: { label: 'HR-42', from: 'Panel B', to: 'Roof' } }));
    await db.setMeta('currentSheetId', 'ah1');
    db.closeDatabase();
  });
  await page.click('#wm-dev-load');
  await page.waitForFunction(() => window.__wmStage.getAnnotationCount() >= 5, { timeout: 20000 });
  await page.waitForTimeout(300);

  const R = {};
  const openAndSearch = async (q) => {
    await page.click('#wm-lookup-open');
    await page.fill('#wm-lookup-query', q);
    await page.click('#wm-lookup-search');
    await page.waitForTimeout(350);
    return page.evaluate(() => document.querySelectorAll('.result').length);
  };

  // ── 1. close leaves a clean, non-blocking state ──
  R.resultsRendered = await openAndSearch('HR');
  await page.click('#wm-lookup-close');
  await page.waitForTimeout(200);
  R.afterClose = await page.evaluate(() => {
    const modal = document.getElementById('wm-lookup');
    const s = window.__wmStage;
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    // What actually sits at the centre of the plan now? If the backdrop is
    // still there it will answer here, and every gesture below would fail.
    const mid = document.elementFromPoint(el.left + el.width / 2, el.top + el.height / 2);
    return { hidden: modal.hidden, display: getComputedStyle(modal).display,
      painted: modal.getBoundingClientRect().width > 0,
      elementAtPlanCentre: mid ? (mid.id || mid.getAttribute('class') || mid.tagName) : 'null',
      backdropIntercepts: !!(mid && mid.closest && mid.closest('#wm-lookup')),
      tool: s.activeSketchTool(), gesture: s.getGestureMode(),
      pointers: s.getActivePointers(),
      selectedSketch: s.getSelectedSketch(), selectedArrow: s.getSelectedArrow(),
      labelEditor: !document.getElementById('wm-editor').hidden,
      textEditor: !document.getElementById('wm-text-editor').hidden,
      annotations: s.getAnnotationCount() };
  });

  // ── 2. pan, then pinch ──
  await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
      { width: el.width, height: el.height }, s.getViewport(), 3));
    s.renderLabels();
  });
  await page.waitForTimeout(150);
  const beforePan = await page.evaluate(() => window.__wmStage.getViewport());
  const empty = await at({ x: 0.5, y: 0.12 });
  await drag(60, empty, { x: empty.x + 90, y: empty.y + 20 });
  R.pan = await page.evaluate((b) => {
    const v = window.__wmStage.getViewport();
    return { panned: Math.abs(v.translateX - b.translateX) > 20,
      scaleKept: v.scale === b.scale,
      lookupStillClosed: document.getElementById('wm-lookup').hidden,
      annotations: window.__wmStage.getAnnotationCount() };
  }, beforePan);

  R.pinch = await page.evaluate(() => {
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const s = window.__wmStage;
    const before = s.getViewport().scale;
    const send = (t, id, x, y) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: id,
      clientX: el.left + x, clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    send('pointerdown', 71, 150, 300); send('pointerdown', 72, 250, 300);
    send('pointermove', 72, 360, 300);
    const zoomed = s.getViewport().scale;
    send('pointerup', 71, 150, 300); send('pointerup', 72, 360, 300);
    return { changed: zoomed > before, pointers: s.getActivePointers(),
      gesture: s.getGestureMode() };
  });

  await page.evaluate(() => window.__wmStage.fit());
  await page.waitForTimeout(200);

  // ── 3. label: tap to edit, cancel, then drag ──
  let p = await at({ x: 0.70, y: 0.20 });
  await tap(p.x, p.y, 61);
  R.labelTap = await page.evaluate(() => ({
    open: !document.getElementById('wm-editor').hidden,
    value: document.getElementById('wm-f-label').value,
    lookupClosed: document.getElementById('wm-lookup').hidden }));
  await page.click('#wm-editor-cancel');
  await page.waitForTimeout(200);
  const beforeLabelDrag = await page.evaluate(() => ({
    at: window.__wmStage.getAnnotation('k-label').at,
    view: JSON.stringify(window.__wmStage.getViewport()) }));
  p = await at(beforeLabelDrag.at);
  // Run the gesture and read the transform inside ONE evaluate. Waiting for the
  // async persist would span the status-line update, whose height change
  // triggers a legitimate ResizeObserver refit that has nothing to do with the
  // drag — the same trap that once made an endpoint drag look like a pan.
  R.labelDrag = await page.evaluate((arg) => {
    const s = window.__wmStage;
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const send = (t, x, y) => {
      const tg = document.elementFromPoint(el.left + x, el.top + y) || vpEl;
      tg.dispatchEvent(new PointerEvent(t, { pointerId: 62, clientX: el.left + x,
        clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    };
    const before = JSON.stringify(s.getViewport());
    send('pointerdown', arg.p.x, arg.p.y);
    [25, 50, 70].forEach((d) => send('pointermove', arg.p.x + d, arg.p.y + d * 0.64));
    send('pointerup', arg.p.x + 70, arg.p.y + 45);
    const after = JSON.stringify(s.getViewport());
    const a = s.getAnnotation('k-label');
    return { moved: JSON.stringify(a.at) !== JSON.stringify(arg.at),
      stageStill: after === before,
      normalized: a.at.x >= 0 && a.at.x <= 1 && a.at.y >= 0 && a.at.y <= 1 };
  }, { p, at: beforeLabelDrag.at });
  await page.waitForTimeout(300);

  // ── 4. arrow: select, then endpoint drag ──
  p = await at({ x: 0.40, y: 0.48 });
  await tap(p.x, p.y, 63);
  R.arrowSelect = await page.evaluate(() => ({ id: window.__wmStage.getSelectedArrow(),
    handles: document.querySelectorAll('.wm-endpoint').length }));
  const handleA = await page.evaluate(() => {
    const t = document.querySelector('.wm-endpoint[data-endpoint="a"] .wm-endpoint-target');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  const beforeEndpoint = await page.evaluate(() => ({
    a: window.__wmStage.getAnnotation('k-arrow').a,
    view: window.__wmStage.getViewport() }));
  if (handleA) await drag(64, handleA, { x: handleA.x + 60, y: handleA.y + 35 });
  R.arrowEndpoint = await page.evaluate((b) => {
    const s = window.__wmStage; const a = s.getAnnotation('k-arrow');
    const v = s.getViewport();
    return { moved: JSON.stringify(a.a) !== JSON.stringify(b.a),
      stageDelta: { dx: v.translateX - b.view.translateX, dy: v.translateY - b.view.translateY } };
  }, beforeEndpoint);
  await page.evaluate(() => window.__wmStage.selectArrow(null));

  // ── 5. sketch: line, rectangle, text ──
  p = await at({ x: 0.40, y: 0.72 });
  await tap(p.x, p.y, 65);
  R.lineSelect = await page.evaluate(() => ({ id: window.__wmStage.getSelectedSketch(),
    handles: document.querySelectorAll('.wm-sketch-handle').length }));
  const lineHandle = await page.evaluate(() => {
    const t = document.querySelector('.wm-sketch-handle[data-handle="a"] .wm-endpoint-target');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  const beforeLine = await page.evaluate(() => ({ a: window.__wmStage.getAnnotation('k-line').a,
    view: window.__wmStage.getViewport() }));
  if (lineHandle) await drag(66, lineHandle, { x: lineHandle.x + 55, y: lineHandle.y + 30 });
  R.lineDrag = await page.evaluate((b) => {
    const s = window.__wmStage; const v = s.getViewport();
    return { moved: JSON.stringify(s.getAnnotation('k-line').a) !== JSON.stringify(b.a),
      stageDelta: { dx: v.translateX - b.view.translateX, dy: v.translateY - b.view.translateY } };
  }, beforeLine);

  p = await at({ x: 0.45, y: 0.88 });
  await tap(p.x, p.y, 67);
  R.rectSelect = await page.evaluate(() => ({ id: window.__wmStage.getSelectedSketch(),
    handles: document.querySelectorAll('.wm-sketch-handle').length }));
  const corner = await page.evaluate(() => {
    const t = document.querySelector('.wm-sketch-handle[data-handle="nw"] .wm-endpoint-target');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  const beforeRect = await page.evaluate(() => ({
    geom: JSON.stringify({ a: window.__wmStage.getAnnotation('k-rect').a,
      b: window.__wmStage.getAnnotation('k-rect').b }),
    view: window.__wmStage.getViewport() }));
  if (corner) await drag(68, corner, { x: corner.x + 40, y: corner.y + 25 });
  R.rectDrag = await page.evaluate((b) => {
    const s = window.__wmStage; const a = s.getAnnotation('k-rect'); const v = s.getViewport();
    return { moved: JSON.stringify({ a: a.a, b: a.b }) !== b.geom,
      stageDelta: { dx: v.translateX - b.view.translateX, dy: v.translateY - b.view.translateY } };
  }, beforeRect);
  await page.evaluate(() => window.__wmStage.selectSketch(null));

  p = await at({ x: 0.30, y: 0.30 });
  await tap(p.x + 20, p.y - 8, 69);
  R.textTap = await page.evaluate(() => ({ open: !document.getElementById('wm-text-editor').hidden,
    value: document.getElementById('wm-text-value').value }));
  await page.click('#wm-text-cancel');
  await page.waitForTimeout(200);
  const beforeText = await page.evaluate(() => ({ at: window.__wmStage.getAnnotation('k-text').at,
    view: JSON.stringify(window.__wmStage.getViewport()) }));
  p = await at(beforeText.at);
  await drag(70, { x: p.x + 20, y: p.y - 8 }, { x: p.x + 95, y: p.y + 35 });
  R.textDrag = await page.evaluate((b) => {
    const s = window.__wmStage;
    return { moved: JSON.stringify(s.getAnnotation('k-text').at) !== JSON.stringify(b.at),
      stageStill: JSON.stringify(s.getViewport()) === b.view,
      editorClosed: document.getElementById('wm-text-editor').hidden };
  }, beforeText);

  // ── 6. cross-sheet navigation, then normal interaction on the target ──
  await openAndSearch('HR-42');
  await page.click('.result[data-annotation-id="k-far"]');
  await page.waitForTimeout(700);
  R.afterNav = await page.evaluate(() => {
    const modal = document.getElementById('wm-lookup');
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const mid = document.elementFromPoint(el.left + el.width / 2, el.top + el.height / 2);
    const s = window.__wmStage;
    return { lookupHidden: modal.hidden,
      backdropIntercepts: !!(mid && mid.closest && mid.closest('#wm-lookup')),
      labelEditor: !document.getElementById('wm-editor').hidden,
      annotations: s.getAnnotationCount(), hasFar: !!s.getAnnotation('k-far'),
      pointers: s.getActivePointers(), gesture: s.getGestureMode() };
  });
  const navPanBefore = await page.evaluate(() => window.__wmStage.getViewport());
  const navEmpty = await at({ x: 0.15, y: 0.15 });
  await drag(80, navEmpty, { x: navEmpty.x + 80, y: navEmpty.y + 30 });
  R.navPan = await page.evaluate((b) => {
    const v = window.__wmStage.getViewport();
    return { panned: Math.abs(v.translateX - b.translateX) > 10
      || Math.abs(v.translateY - b.translateY) > 10 };
  }, navPanBefore);
  p = await at(await page.evaluate(() => window.__wmStage.getAnnotation('k-far').at));
  await tap(p.x, p.y, 81);
  R.navLabelTap = await page.evaluate(() => ({
    open: !document.getElementById('wm-editor').hidden,
    value: document.getElementById('wm-f-label').value }));
  await page.click('#wm-editor-cancel');
  await page.waitForTimeout(200);

  // ── 7. iOS: touch close followed by the synthesised mouse pair ──
  await openAndSearch('HR');
  const beforeIos = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId'); db.closeDatabase();
    return { current: cur, annotations: window.__wmStage.getAnnotationCount() };
  });
  await page.evaluate(() => {
    const btn = document.getElementById('wm-lookup-close');
    ['pointerdown', 'pointerup', 'click'].forEach((t) => btn.dispatchEvent(
      t === 'click' ? new MouseEvent(t, { bubbles: true })
        : new PointerEvent(t, { pointerId: 91, bubbles: true, pointerType: 'touch' })));
    // WebKit's synthesised pair on the same spot.
    ['pointerdown', 'pointerup', 'click'].forEach((t) => btn.dispatchEvent(
      t === 'click' ? new MouseEvent(t, { bubbles: true })
        : new PointerEvent(t, { pointerId: 92, bubbles: true, pointerType: 'mouse' })));
  });
  await page.waitForTimeout(400);
  R.ios = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId'); db.closeDatabase();
    const s = window.__wmStage;
    return { current: cur, lookupHidden: document.getElementById('wm-lookup').hidden,
      labelEditor: !document.getElementById('wm-editor').hidden,
      annotations: s.getAnnotationCount(), pointers: s.getActivePointers() };
  });
  // A genuine touch on the plan must still work right afterwards.
  p = await at(await page.evaluate(() => window.__wmStage.getAnnotation('k-far').at));
  await tap(p.x, p.y, 93, 'touch');
  R.touchAfterIos = await page.evaluate(() => !document.getElementById('wm-editor').hidden);

  await browser.close();

  const zeroDelta = (d) => d && d.dx === 0 && d.dy === 0;
  const checks = [
    ['closing Lookup hides the modal and its backdrop',
      R.resultsRendered > 0 && R.afterClose.hidden && R.afterClose.display === 'none'
      && !R.afterClose.painted],
    ['the closed modal does not intercept pointer events over the plan',
      !R.afterClose.backdropIntercepts],
    ['closing Lookup leaves tool, gesture and pointer state clean',
      R.afterClose.tool === 'none' && R.afterClose.gesture === 'idle'
      && R.afterClose.pointers === 0 && !R.afterClose.labelEditor && !R.afterClose.textEditor],
    ['closing Lookup leaves no stale selection', R.afterClose.selectedSketch === null
      && R.afterClose.selectedArrow === null],
    ['panning works immediately after closing Lookup',
      R.pan.panned && R.pan.scaleKept && R.pan.lookupStillClosed],
    ['panning after close moves no annotation', R.pan.annotations === R.afterClose.annotations],
    ['pinch works after closing Lookup',
      R.pinch.changed && R.pinch.pointers === 0 && R.pinch.gesture === 'idle'],
    ['tapping a Wire Label after close opens its editor',
      R.labelTap.open && R.labelTap.value === 'HR-07' && R.labelTap.lookupClosed],
    ['dragging a Wire Label after close moves only the label',
      R.labelDrag.moved && R.labelDrag.stageStill && R.labelDrag.normalized],
    ['selecting an Arrow after close still works',
      R.arrowSelect.id === 'k-arrow' && R.arrowSelect.handles === 2],
    ['an Arrow endpoint drag after close leaves the stage delta at zero',
      R.arrowEndpoint.moved && zeroDelta(R.arrowEndpoint.stageDelta)],
    ['selecting a sketch Line after close still works',
      R.lineSelect.id === 'k-line' && R.lineSelect.handles === 2],
    ['a Line endpoint drag after close leaves the stage delta at zero',
      R.lineDrag.moved && zeroDelta(R.lineDrag.stageDelta)],
    ['selecting a Rectangle after close shows four corner handles',
      R.rectSelect.id === 'k-rect' && R.rectSelect.handles === 4],
    ['a Rectangle corner drag after close leaves the stage delta at zero',
      R.rectDrag.moved && zeroDelta(R.rectDrag.stageDelta)],
    ['tapping Text after close opens its editor',
      R.textTap.open && R.textTap.value === 'Panel A'],
    ['dragging Text after close moves it without panning',
      R.textDrag.moved && R.textDrag.stageStill && R.textDrag.editorClosed],
    ['result navigation leaves no invisible modal over the plan',
      R.afterNav.lookupHidden && !R.afterNav.backdropIntercepts && !R.afterNav.labelEditor],
    ['the target sheet loads with only its own annotations',
      R.afterNav.hasFar && R.afterNav.annotations === 1
      && R.afterNav.pointers === 0 && R.afterNav.gesture === 'idle'],
    ['panning works immediately after result navigation', R.navPan.panned],
    ['tapping the focused label after navigation opens its editor',
      R.navLabelTap.open && R.navLabelTap.value === 'HR-42'],
    ['iOS: a touch close plus its compatibility pair closes once, loads nothing twice',
      R.ios.lookupHidden && R.ios.current === beforeIos.current
      && R.ios.annotations === beforeIos.annotations && !R.ios.labelEditor
      && R.ios.pointers === 0],
    ['iOS: a genuine touch on the plan works right after', R.touchAfterIos],
    ['no page errors through the whole aftermath sequence', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ── WM-8: sheets manager ────────────────────────────────────────────────────
async function runSheets(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  const dialogs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto(APP);

  const R = {};

  // seed: one job, one sheet with a label; plus a second job that must not leak
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'wm-dev-job', name: 'Dev', now }));
    await db.putSheet(WM.model.createSheet({ id: 'base', jobId: 'wm-dev-job', name: 'Base Plan',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.putAnnotation(WM.model.createAnnotation({ id: 'lb1', sheetId: 'base',
      type: 'wireLabel', at: { x: 0.4, y: 0.4 }, now, data: { label: 'HR-07', from: 'Panel A' } }));
    await db.putJob(WM.model.createJob({ id: 'job-b', name: 'Other', now }));
    await db.putSheet(WM.model.createSheet({ id: 'bx', jobId: 'job-b', name: 'B1',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.setMeta('currentSheetId', 'base');
    db.closeDatabase();
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);

  const openSheets = async () => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(350);
    return page.evaluate(() => ({
      status: document.getElementById('wm-sheets-status').textContent,
      rows: Array.from(document.querySelectorAll('.sheet-row')).map(r => ({
        id: r.getAttribute('data-sheet-id'),
        name: r.querySelector('.sheet-name').textContent,
        kind: r.querySelector('.sheet-meta').textContent,
        current: r.classList.contains('current'),
        upDisabled: r.querySelectorAll('button')[0].disabled,
        downDisabled: r.querySelectorAll('button')[1].disabled,
        delDisabled: r.querySelectorAll('button')[3].disabled })),
      scriptNodes: document.querySelectorAll('#wm-sheets script').length }));
  };
  const addBlank = async (name) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = false; });
    await page.waitForTimeout(150);
    await page.click('#wm-sheets-add');
    await page.waitForFunction(() => !document.getElementById('wm-addsheet').hidden, { timeout: 10000 });
    await page.fill('#wm-addsheet-name', name);
    await page.click('#wm-addsheet-blank');
    await page.waitForTimeout(600);
  };
  const rowBtn = (id, idx) => page.evaluate(({ id, idx }) => {
    const r = document.querySelector('.sheet-row[data-sheet-id="' + id + '"]');
    r.querySelectorAll('button')[idx].click();
  }, { id, idx });
  const meta = () => page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId'); db.closeDatabase(); return cur;
  });

  R.initial = await openSheets();
  await addBlank('1F Plan');
  R.afterFirstAdd = { meta: await meta(), list: (await openSheets()).rows.map(r => r.name) };
  await addBlank('2F Plan');
  await addBlank('  Roof  ');
  R.afterAdds = await openSheets();

  // open a non-current sheet
  await page.evaluate(() => {
    document.querySelector('.sheet-row[data-sheet-id="base"] .sheet-main').click();
  });
  await page.waitForTimeout(600);
  R.openOther = { meta: await meta(), labels: await page.evaluate(() =>
    document.querySelectorAll('.wm-label').length) };

  // tapping the current sheet must not reload
  const before = await openSheets();
  const curId = before.rows.find(r => r.current).id;
  const viewBefore = await page.evaluate(() => JSON.stringify(window.__wmStage.getViewport()));
  await page.evaluate((id) => {
    document.querySelector('.sheet-row[data-sheet-id="' + id + '"] .sheet-main').click();
  }, curId);
  await page.waitForTimeout(400);
  R.tapCurrent = { closed: await page.evaluate(() => document.getElementById('wm-sheets').hidden),
    viewKept: (await page.evaluate(() => JSON.stringify(window.__wmStage.getViewport()))) === viewBefore };

  // rename
  let list = await openSheets();
  const oneF = list.rows.find(r => r.name.indexOf('1F') === 0).id;
  await rowBtn(oneF, 2);
  await page.waitForTimeout(200);
  await page.fill('#wm-rename-name', 'Ground Floor');
  await page.click('#wm-rename-save');
  await page.waitForTimeout(400);
  R.afterRename = { names: (await openSheets()).rows.map(r => r.name),
    sameId: await page.evaluate(async (id) => {
      const db = WM.store.createStore(); await db.openDatabase();
      const s = await db.getSheet(id); db.closeDatabase();
      return { name: s.name, order: s.order, kind: s.kind }; }, oneF) };

  // reorder
  list = await openSheets();
  const roof = list.rows.find(r => r.name === 'Roof').id;
  await rowBtn(roof, 0);
  await page.waitForTimeout(400);
  R.afterMoveUp = (await openSheets()).rows.map(r => r.name);
  await page.reload(); await page.waitForTimeout(300);
  await page.click('#wm-dev-load'); await page.waitForTimeout(500);
  R.orderAfterReload = (await openSheets()).rows.map(r => r.name);

  // delete a non-current sheet
  list = await openSheets();
  const twoF = list.rows.find(r => r.name === '2F Plan').id;
  const curBefore = await meta();
  await rowBtn(twoF, 3);
  await page.waitForTimeout(250);
  R.deleteDialog = await page.evaluate(() => ({
    open: !document.getElementById('wm-delsheet').hidden,
    body: document.getElementById('wm-delsheet-body').textContent }));
  await page.click('#wm-delsheet-confirm');
  await page.waitForTimeout(600);
  R.afterDeleteOther = { names: (await openSheets()).rows.map(r => r.name),
    metaSame: (await meta()) === curBefore };

  // delete the CURRENT sheet
  list = await openSheets();
  const cur2 = list.rows.find(r => r.current);
  await rowBtn(cur2.id, 3);
  await page.waitForTimeout(250);
  await page.click('#wm-delsheet-confirm');
  await page.waitForTimeout(800);
  R.afterDeleteCurrent = { newMeta: await meta(), oldId: cur2.id,
    names: (await openSheets()).rows.map(r => r.name) };

  // reduce to one sheet, then delete must be blocked
  list = await openSheets();
  while (list.rows.length > 1) {
    const victim = list.rows.find(r => !r.current) || list.rows[0];
    await rowBtn(victim.id, 3);
    await page.waitForTimeout(200);
    await page.click('#wm-delsheet-confirm');
    await page.waitForTimeout(700);
    list = await openSheets();
  }
  R.lastSheet = { count: list.rows.length, delDisabled: list.rows[0].delDisabled };

  // XSS sheet name
  await addBlank('<script>alert(1)</script>');
  R.xss = await openSheets();
  R.xssStored = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId');
    const s = await db.getSheet(cur); db.closeDatabase(); return s.name;
  });

  // cross-job isolation
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    await db.setMeta('currentSheetId', 'bx'); db.closeDatabase();
  });
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-dev-load'); await page.waitForTimeout(500);
  R.otherJob = (await openSheets()).rows.map(r => r.name);


  // ── listeners must not accumulate across repeated open/close cycles ──
  R.listeners = await page.evaluate(async () => {
    const count = () => {
      // Fixed modal controls are what could leak; row nodes are discarded with
      // the list on every render.
      const ids = ['wm-sheets-open', 'wm-sheets-close', 'wm-sheets-add',
        'wm-addsheet-blank', 'wm-addsheet-cancel', 'wm-rename-save',
        'wm-rename-cancel', 'wm-delsheet-confirm', 'wm-delsheet-cancel'];
      return ids.filter((id) => document.getElementById(id)).length;
    };
    const before = count();
    let writes = 0;
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId');
    const sheet = await db.getSheet(cur);
    const beforeName = sheet.name;
    db.closeDatabase();
    for (let i = 0; i < 10; i++) {
      document.getElementById('wm-sheets-open').click();
      document.getElementById('wm-sheets-close').click();
      document.getElementById('wm-sheets-add').click();
      document.getElementById('wm-addsheet-cancel').click();
    }
    await new Promise((r) => setTimeout(r, 400));
    const after = count();
    // One Rename Save must produce exactly one stored name, not ten.
    const db2 = WM.store.createStore(); await db2.openDatabase();
    const still = await db2.getSheet(cur); db2.closeDatabase();
    return { before, after, stable: before === after,
      nameUnchangedByCycling: still.name === beforeName,
      sheetsHidden: document.getElementById('wm-sheets').hidden,
      addHidden: document.getElementById('wm-addsheet').hidden, writes };
  });

  // ── close the manager, then use the plan normally ──
  await page.evaluate(() => {
    ['wm-sheets', 'wm-addsheet', 'wm-rename', 'wm-delsheet', 'wm-lookup']
      .forEach((id) => { document.getElementById(id).hidden = true; });
  });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(250);
  await page.click('#wm-sheets-close');
  await page.waitForTimeout(250);
  R.afterClose = await page.evaluate(() => {
    const modal = document.getElementById('wm-sheets');
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const mid = document.elementFromPoint(el.left + el.width / 2, el.top + el.height / 2);
    const s = window.__wmStage;
    return { hidden: modal.hidden, display: getComputedStyle(modal).display,
      backdropIntercepts: !!(mid && mid.closest && mid.closest('#wm-sheets')),
      tool: s.activeSketchTool(), gesture: s.getGestureMode(),
      pointers: s.getActivePointers(),
      selectedSketch: s.getSelectedSketch(), selectedArrow: s.getSelectedArrow() };
  });
  R.panAfterClose = await page.evaluate(() => {
    const s = window.__wmStage, sz = s.getStageSize();
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, sz,
      { width: el.width, height: el.height }, s.getViewport(), 3));
    s.renderLabels();
    const before = s.getViewport();
    const send = (t, x, y) => {
      const tg = document.elementFromPoint(el.left + x, el.top + y) || vpEl;
      tg.dispatchEvent(new PointerEvent(t, { pointerId: 501, clientX: el.left + x,
        clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    };
    send('pointerdown', 120, 200);
    [30, 60, 95].forEach((d) => send('pointermove', 120 + d, 200));
    send('pointerup', 215, 200);
    const after = s.getViewport();
    // Pinch straight at the viewport element: elementFromPoint can land on an
    // annotation, which correctly claims the pointer, and that would test
    // annotation routing rather than the gesture we mean to exercise here.
    const pinch = (t, id, x, y) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: id,
      clientX: el.left + x, clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    pinch('pointerdown', 71, 150, 300); pinch('pointerdown', 72, 250, 300);
    pinch('pointermove', 72, 360, 300);
    const zoomed = s.getViewport().scale;
    pinch('pointerup', 71, 150, 300); pinch('pointerup', 72, 360, 300);
    return { panned: Math.abs(after.translateX - before.translateX) > 20,
      scaleKept: after.scale === before.scale,
      pinched: zoomed > after.scale,
      pointers: s.getActivePointers(), gesture: s.getGestureMode() };
  });

  // ── responsive ──
  R.responsive = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 667 },
    { width: 844, height: 390 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(250);
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    R.responsive.push(await page.evaluate((w) => {
      const inView = (el) => { if (!el) return false; const r = el.getBoundingClientRect();
        return r.left >= -1 && r.right <= w + 1 && r.width > 0 && r.height > 0; };
      const bar = document.querySelector('.devbar');
      const list = document.getElementById('wm-sheets-list');
      const rowBtns = Array.from(document.querySelectorAll('.sheet-row button'));
      return { width: w,
        docOverflows: document.documentElement.scrollWidth > w,
        barOverflows: bar.scrollWidth > bar.clientWidth + 1,
        sheetsBtn: inView(document.getElementById('wm-sheets-open')),
        panel: inView(document.querySelector('#wm-sheets .sheet-panel')),
        addBtn: inView(document.getElementById('wm-sheets-add')),
        closeBtn: inView(document.getElementById('wm-sheets-close')),
        listScrolls: getComputedStyle(list).overflowY === 'auto',
        rowsFit: rowBtns.every((b) => b.getBoundingClientRect().right <= w + 1) };
    }, vp.width));
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  // ── many sheets: the list must stay bounded and metadata-only ──
  R.many = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId');
    const sheet = await db.getSheet(cur);
    const now = Date.now();
    const existing = await db.listSheets(sheet.jobId);
    for (let i = 0; i < 12; i++) {
      await db.putSheet(WM.model.createSheet({ id: 'bulk-' + i, jobId: sheet.jobId,
        name: 'Bulk Sheet ' + (i + 1), kind: 'blank', width: 2000, height: 1500,
        order: existing.length + i, now }));
    }
    db.closeDatabase();
    return { seeded: 12 };
  });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(400);
  R.manyList = await page.evaluate(() => {
    const list = document.getElementById('wm-sheets-list');
    const panel = document.querySelector('#wm-sheets .sheet-panel');
    return { rows: document.querySelectorAll('.sheet-row').length,
      listScrollable: list.scrollHeight > list.clientHeight,
      listBounded: list.clientHeight <= window.innerHeight,
      panelBounded: panel.getBoundingClientRect().height <= window.innerHeight + 1,
      docOverflows: document.documentElement.scrollWidth > window.innerWidth,
      addInView: (() => { const r = document.getElementById('wm-sheets-add').getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight + 1; })(),
      currentVisible: !!document.querySelector('.sheet-row.current') };
  });
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });

  await browser.close();

  const rowNames = (arr) => arr.map((x) => x.replace('CURRENT', ''));
  const checks = [
    ['the sheets list opens showing the current sheet',
      R.initial.rows.length === 1 && R.initial.rows[0].current
      && R.initial.rows[0].name.indexOf('CURRENT') !== -1],
    ['a single sheet cannot be moved or deleted',
      R.initial.rows[0].upDisabled && R.initial.rows[0].downDisabled
      && R.initial.rows[0].delDisabled],
    ['adding a blank sheet makes it current and appends it last',
      R.afterFirstAdd.list.length === 2
      && R.afterFirstAdd.list[1].indexOf('1F Plan') === 0],
    ['sheet names are trimmed on creation',
      R.afterAdds.rows.some((r) => r.name.replace('CURRENT', '') === 'Roof')],
    ['four sheets are listed in creation order',
      rowNames(R.afterAdds.rows.map((r) => r.name)).join('|')
        === 'Base Plan|1F Plan|2F Plan|Roof'],
    ['opening another sheet switches current and its annotations',
      R.openOther.meta === 'base' && R.openOther.labels === 1],
    ['tapping the CURRENT sheet closes the manager without resetting the view',
      R.tapCurrent.closed && R.tapCurrent.viewKept],
    ['renaming keeps the same id, order and kind',
      R.afterRename.sameId.name === 'Ground Floor' && R.afterRename.sameId.order === 1
      && R.afterRename.sameId.kind === 'blank'],
    ['Move Up reorders the list', R.afterMoveUp.join('|').indexOf('Roof|2F Plan') !== -1],
    ['the new order survives a page reload',
      R.orderAfterReload.join('|') === R.afterMoveUp.join('|')],
    ['delete asks for confirmation naming the sheet',
      R.deleteDialog.open && R.deleteDialog.body.indexOf('2F Plan') !== -1],
    ['deleting a non-current sheet leaves the current one alone',
      R.afterDeleteOther.metaSame && R.afterDeleteOther.names.length === 3],
    ['deleting the current sheet picks a deterministic replacement',
      R.afterDeleteCurrent.newMeta !== R.afterDeleteCurrent.oldId
      && R.afterDeleteCurrent.names.length === 2],
    ['THE LAST REMAINING SHEET CANNOT BE DELETED',
      R.lastSheet.count === 1 && R.lastSheet.delDisabled],
    ['an HTML-looking sheet name is stored literally',
      R.xssStored === '<script>alert(1)</script>'],
    ['the sheets list renders that name without creating a script node',
      R.xss.scriptNodes === 0
      && R.xss.rows.some((r) => r.name.indexOf('<script>alert(1)</script>') !== -1)],
    ['no dialog fired anywhere in the sheets flow', dialogs.length === 0],
    ['CROSS-JOB ISOLATION: another job shows only its own sheets',
      R.otherJob.length === 1 && R.otherJob[0].indexOf('B1') === 0],
    ['LISTENERS do not accumulate across repeated open/close cycles',
      R.listeners.stable && R.listeners.nameUnchangedByCycling],
    ['repeated cycles leave both modals closed',
      R.listeners.sheetsHidden && R.listeners.addHidden],
    ['closing the manager hides it and leaves nothing intercepting the plan',
      R.afterClose.hidden && R.afterClose.display === 'none'
      && !R.afterClose.backdropIntercepts],
    ['closing the manager leaves tool, gesture and pointer state clean',
      R.afterClose.tool === 'none' && R.afterClose.gesture === 'idle'
      && R.afterClose.pointers === 0 && R.afterClose.selectedSketch === null
      && R.afterClose.selectedArrow === null],
    ['pan and pinch work immediately after closing the manager',
      R.panAfterClose.panned && R.panAfterClose.scaleKept && R.panAfterClose.pinched
      && R.panAfterClose.pointers === 0 && R.panAfterClose.gesture === 'idle'],
    ['no horizontal overflow at any tested width',
      R.responsive.every((r) => !r.docOverflows && !r.barOverflows)],
    ['the Sheets control and modal are reachable at every width',
      R.responsive.every((r) => r.sheetsBtn && r.panel)],
    ['Add Sheet, Close and row actions are reachable at every width',
      R.responsive.every((r) => r.addBtn && r.closeBtn && r.rowsFit)],
    ['with 12+ sheets the list scrolls inside a bounded modal',
      R.manyList.rows >= 12 && R.manyList.listScrollable && R.manyList.listBounded
      && R.manyList.panelBounded && !R.manyList.docOverflows],
    ['Add Sheet stays reachable with a long list',
      R.manyList.addInView && R.manyList.currentVisible],
    ['no page errors through the whole sheets flow', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-8 hardening — photo sheets through the REAL production path.
//
// Everything below goes through the shipped change handler on
// #wm-addsheet-file: processImage → putImage → putSheet → loadCurrentSheet,
// including the orphan-image cleanup when persistence fails mid-way.
// ─────────────────────────────────────────────────────────────────────────
async function runSheetsPhoto(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const R = {};

  // seed: one job, one blank base sheet
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'pj', name: 'Photo Job', now }));
    await db.putSheet(WM.model.createSheet({ id: 'pbase', jobId: 'pj', name: 'Base',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.setMeta('currentSheetId', 'pbase');
    db.closeDatabase();

    // page-side helpers shared by every photo check below
    window.__ph = {
      // A real JPEG, drawn — not synthesized bytes — so decode, resize and
      // re-encode all run for real.
      makeJpeg(w, h) {
        return new Promise((resolve) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          g.fillStyle = '#246'; g.fillRect(0, 0, w, h);
          g.fillStyle = '#fc0'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
          c.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
        });
      },
      attach(blob, name, mime) {
        const input = document.getElementById('wm-addsheet-file');
        const dt = new DataTransfer();
        dt.items.add(new File([blob], name, { type: mime }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      attachNothing() {
        const input = document.getElementById('wm-addsheet-file');
        input.files = new DataTransfer().files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      counts() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(WM.store.DB_NAME);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(['sheets', 'images', 'annotations'], 'readonly');
            const out = {};
            const count = (store, key) => {
              const r = tx.objectStore(store).count();
              r.onsuccess = () => { out[key] = r.result; };
            };
            count('sheets', 'sheets'); count('images', 'images'); count('annotations', 'annotations');
            tx.oncomplete = () => { db.close(); resolve(out); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          };
        });
      },
      async state() {
        const db = WM.store.createStore(); await db.openDatabase();
        const cur = await db.getMeta('currentSheetId');
        const sheet = cur ? await db.getSheet(cur) : null;
        const image = sheet && sheet.imageId ? await db.getImage(sheet.imageId) : null;
        db.closeDatabase();
        const s = window.__wmStage;
        const img = document.getElementById('wm-background');
        return {
          currentId: cur,
          kind: sheet ? sheet.kind : null,
          name: sheet ? sheet.name : null,
          imageId: sheet ? sheet.imageId : null,
          storedW: image ? image.width : null,
          storedH: image ? image.height : null,
          stage: s.getStageSize(),
          imgVisible: !!(img && !img.hidden && img.getAttribute('src')
            && img.complete && img.naturalWidth > 0),
          grid: s.isGridVisible(),
          addOpen: !document.getElementById('wm-addsheet').hidden,
          addError: document.getElementById('wm-addsheet-error').textContent,
        };
      },
    };
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);

  const openAdd = async (name) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    await page.click('#wm-sheets-add');
    await page.waitForFunction(() => !document.getElementById('wm-addsheet').hidden, { timeout: 10000 });
    await page.fill('#wm-addsheet-name', name);
  };

  // ── 1. Add Photo success through the production pipeline ──
  R.before = await page.evaluate(() => window.__ph.counts());
  await openAdd('Site Photo');
  await page.evaluate(async () => {
    const b = await window.__ph.makeJpeg(800, 600);
    window.__ph.attach(b, 'plan.jpg', 'image/jpeg');
  });
  await page.waitForFunction(() => document.getElementById('wm-addsheet').hidden, { timeout: 15000 });
  await page.waitForTimeout(700);
  R.photoOk = await page.evaluate(() => window.__ph.state());
  R.afterPhoto = await page.evaluate(() => window.__ph.counts());

  // ── 2. Add Photo cancel — a change event with no file creates nothing ──
  await openAdd('Never Created');
  await page.evaluate(() => window.__ph.attachNothing());
  await page.waitForTimeout(500);
  R.cancel = {
    counts: await page.evaluate(() => window.__ph.counts()),
    addStillOpen: await page.evaluate(() => !document.getElementById('wm-addsheet').hidden),
    error: await page.evaluate(() => document.getElementById('wm-addsheet-error').textContent),
  };
  await page.click('#wm-addsheet-cancel');
  await page.waitForTimeout(200);

  // ── 3a. Failure AFTER the image is stored — the orphan blob must go ──
  await openAdd('Doomed Sheet');
  await page.evaluate(async () => {
    const orig = WM.model.validateSheet;
    window.__ph.restore = () => { WM.model.validateSheet = orig; };
    WM.model.validateSheet = () => ({ valid: false, problems: ['injected: sheet persistence failure'] });
    const b = await window.__ph.makeJpeg(400, 300);
    window.__ph.attach(b, 'doomed.jpg', 'image/jpeg');
  });
  await page.waitForFunction(() =>
    document.getElementById('wm-addsheet-error').textContent.indexOf('injected') !== -1,
    { timeout: 15000 });
  R.orphan = {
    counts: await page.evaluate(() => window.__ph.counts()),
    error: await page.evaluate(() => document.getElementById('wm-addsheet-error').textContent),
    current: await page.evaluate(async () => {
      const db = WM.store.createStore(); await db.openDatabase();
      const cur = await db.getMeta('currentSheetId'); db.closeDatabase(); return cur;
    }),
  };
  await page.evaluate(() => window.__ph.restore());

  // ── 3b. Failure BEFORE the image is stored — a non-image file ──
  await page.fill('#wm-addsheet-name', 'Not An Image');
  await page.evaluate(() => {
    window.__ph.attach(new Blob(['plain text, not pixels'], { type: 'text/plain' }),
      'notes.txt', 'text/plain');
  });
  await page.waitForFunction(() =>
    document.getElementById('wm-addsheet-error').textContent.indexOf('Could not add sheet') !== -1,
    { timeout: 15000 });
  R.badFile = { counts: await page.evaluate(() => window.__ph.counts()) };
  await page.click('#wm-addsheet-cancel');
  await page.waitForTimeout(200);

  // ── 14. Photo → Blank → Photo switching ──
  await openAdd('Second Photo');
  await page.evaluate(async () => {
    const b = await window.__ph.makeJpeg(640, 480);
    window.__ph.attach(b, 'second.jpg', 'image/jpeg');
  });
  await page.waitForFunction(() => document.getElementById('wm-addsheet').hidden, { timeout: 15000 });
  await page.waitForTimeout(700);

  const switchTo = async (name) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    await page.evaluate((n) => {
      const rows = Array.from(document.querySelectorAll('.sheet-row'));
      const row = rows.find((r) => r.querySelector('.sheet-name').textContent.indexOf(n) === 0);
      row.querySelector('.sheet-main').click();
    }, name);
    await page.waitForTimeout(700);
    return page.evaluate(() => window.__ph.state());
  };

  R.toPhoto1 = await switchTo('Site Photo');
  R.toBlank = await switchTo('Base');
  R.toPhoto2 = await switchTo('Second Photo');

  await ctx.close();
  await browser.close();

  const checks = [
    ['Add Photo stores image + sheet through the production path',
      R.afterPhoto.sheets === R.before.sheets + 1 && R.afterPhoto.images === R.before.images + 1],
    ['the new photo sheet is current, kind photo, with its imageId',
      R.photoOk.kind === 'photo' && R.photoOk.name === 'Site Photo' && !!R.photoOk.imageId],
    ['stored image dimensions drive the stage size',
      R.photoOk.stage && R.photoOk.stage.width === R.photoOk.storedW
        && R.photoOk.stage.height === R.photoOk.storedH],
    ['the photo is actually displayed (background img visible, no grid)',
      R.photoOk.imgVisible === true && R.photoOk.grid === false],
    ['the Add modal closed after a successful photo add', R.photoOk.addOpen === false],
    ['cancelling the file picker creates nothing',
      R.cancel.counts.sheets === R.afterPhoto.sheets && R.cancel.counts.images === R.afterPhoto.images],
    ['a cancelled picker leaves the Add modal open with no error',
      R.cancel.addStillOpen === true && R.cancel.error === ''],
    ['a failed sheet write removes the already-stored image (no orphan)',
      R.orphan.counts.images === R.afterPhoto.images && R.orphan.counts.sheets === R.afterPhoto.sheets],
    ['the failure is reported and the current sheet is untouched',
      R.orphan.error.indexOf('Could not add sheet') !== -1 && R.orphan.current === R.photoOk.currentId],
    ['a non-image file fails cleanly with nothing stored',
      R.badFile.counts.images === R.afterPhoto.images && R.badFile.counts.sheets === R.afterPhoto.sheets],
    ['switching to a photo sheet shows its image',
      R.toPhoto1.kind === 'photo' && R.toPhoto1.imgVisible === true && R.toPhoto1.grid === false],
    ['switching photo → blank hides the image and shows the grid',
      R.toBlank.kind === 'blank' && R.toBlank.imgVisible === false && R.toBlank.grid === true
        && R.toBlank.stage.width === 2000 && R.toBlank.stage.height === 1500],
    ['switching blank → second photo shows the SECOND image at its own size',
      R.toPhoto2.kind === 'photo' && R.toPhoto2.imgVisible === true
        && R.toPhoto2.stage.width === R.toPhoto2.storedW
        && R.toPhoto2.stage.height === R.toPhoto2.storedH
        && R.toPhoto2.imageId !== R.toPhoto1.imageId],
    ['no page errors through the photo flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-8 hardening — annotation, tool, selection and undo isolation across
// sheet switches, plus permanent cross-job write isolation.
// ─────────────────────────────────────────────────────────────────────────
async function runSheetsIsolation(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const R = {};

  // seed: job A with two sheets (all five annotation types on A1, two on A2),
  // job B with one sheet — job B is the untouchable control group.
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'ja', name: 'Job A', now }));
    await db.putSheet(WM.model.createSheet({ id: 'a1', jobId: 'ja', name: 'A One',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.putSheet(WM.model.createSheet({ id: 'a2', jobId: 'ja', name: 'A Two',
      kind: 'blank', width: 2000, height: 1500, order: 1, now }));
    const put = (a) => db.putAnnotation(a);
    await put(WM.model.createAnnotation({ id: 'a1-label', sheetId: 'a1', type: 'wireLabel',
      at: { x: 0.3, y: 0.3 }, now, data: { label: 'HR-01', from: 'Panel A' } }));
    await put(WM.model.createAnnotation({ id: 'a1-arrow', sheetId: 'a1', type: 'arrow',
      a: { x: 0.2, y: 0.2 }, b: { x: 0.6, y: 0.6 }, now }));
    await put(WM.model.createAnnotation({ id: 'a1-line', sheetId: 'a1', type: 'line',
      a: { x: 0.1, y: 0.8 }, b: { x: 0.9, y: 0.8 }, now }));
    await put(WM.model.createAnnotation({ id: 'a1-rect', sheetId: 'a1', type: 'rect',
      a: { x: 0.55, y: 0.15 }, b: { x: 0.8, y: 0.4 }, now }));
    await put(WM.model.createAnnotation({ id: 'a1-text', sheetId: 'a1', type: 'text',
      at: { x: 0.5, y: 0.9 }, now, data: { text: 'A1 note' } }));
    await put(WM.model.createAnnotation({ id: 'a2-label', sheetId: 'a2', type: 'wireLabel',
      at: { x: 0.4, y: 0.4 }, now, data: { label: 'HR-02' } }));
    await put(WM.model.createAnnotation({ id: 'a2-line', sheetId: 'a2', type: 'line',
      a: { x: 0.2, y: 0.2 }, b: { x: 0.7, y: 0.7 }, now }));
    await db.putJob(WM.model.createJob({ id: 'jb', name: 'Job B', now }));
    await db.putSheet(WM.model.createSheet({ id: 'b1', jobId: 'jb', name: 'B One',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await put(WM.model.createAnnotation({ id: 'b1-label', sheetId: 'b1', type: 'wireLabel',
      at: { x: 0.5, y: 0.5 }, now, data: { label: 'BB-99', notes: 'must never change' } }));
    await db.setMeta('currentSheetId', 'a1');
    db.closeDatabase();

    window.__iso = {
      async jobBFingerprint() {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const sheets = await db2.listSheets('jb');
        const anns = await db2.listAnnotations('b1');
        db2.closeDatabase();
        return JSON.stringify({ sheets, anns });
      },
      async annIds(sheetId) {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const anns = await db2.listAnnotations(sheetId);
        db2.closeDatabase();
        return anns.map((a) => a.id).sort();
      },
      stageView() {
        const s = window.__wmStage;
        return {
          count: s.getAnnotationCount(),
          tool: s.activeSketchTool(),
          selArrow: s.getSelectedArrow(),
          selSketch: s.getSelectedSketch(),
          canUndo: s.canUndo(),
          undoSize: s.undoSize(),
          delArrowHidden: document.getElementById('wm-delete-arrow').hidden,
          delShapeHidden: document.getElementById('wm-sketch-delete').hidden,
          domLabels: Array.from(document.querySelectorAll('.wm-label'))
            .map((n) => n.textContent).sort(),
          hasA1Line: !!s.getAnnotation('a1-line'),
          hasA2Line: !!s.getAnnotation('a2-line'),
        };
      },
    };
  });
  R.jobBBefore = await page.evaluate(() => window.__iso.jobBFingerprint());
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);

  const switchSheet = async (id) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    await page.evaluate((sid) => {
      document.querySelector('.sheet-row[data-sheet-id="' + sid + '"] .sheet-main').click();
    }, id);
    await page.waitForTimeout(600);
  };

  // ── 4. full annotation isolation, all five types ──
  R.onA1 = await page.evaluate(() => window.__iso.stageView());
  await switchSheet('a2');
  R.onA2 = await page.evaluate(() => window.__iso.stageView());
  await switchSheet('a1');
  R.backOnA1 = await page.evaluate(() => window.__iso.stageView());

  // ── 5. an armed Line/Text tool does not survive a sheet switch ──
  await page.click('#wm-sketch-toggle');
  await page.waitForTimeout(150);
  await page.click('#wm-tool-line');
  R.lineArmed = await page.evaluate(() => window.__wmStage.activeSketchTool());
  await switchSheet('a2');
  R.lineAfterSwitch = await page.evaluate(() => window.__wmStage.activeSketchTool());
  await page.click('#wm-tool-text');
  R.textArmed = await page.evaluate(() => window.__wmStage.activeSketchTool());
  await switchSheet('a1');
  R.textAfterSwitch = await page.evaluate(() => window.__wmStage.activeSketchTool());

  // ── 6. selection reset: arrow / line / rect / text ──
  // The arrow case is the one that used to be dangerous: selection survived
  // the switch and Delete Arrow removed an annotation on the PREVIOUS sheet.
  await page.evaluate(() => window.__wmStage.selectArrow('a1-arrow'));
  R.arrowSelected = await page.evaluate(() => ({
    sel: window.__wmStage.getSelectedArrow(),
    btnHidden: document.getElementById('wm-delete-arrow').hidden }));
  await switchSheet('a2');
  R.arrowAfterSwitch = await page.evaluate(() => ({
    sel: window.__wmStage.getSelectedArrow(),
    btnHidden: document.getElementById('wm-delete-arrow').hidden }));
  // even a forced click on the (hidden) button must not reach across sheets
  await page.evaluate(() => document.getElementById('wm-delete-arrow').click());
  await page.waitForTimeout(400);
  R.a1AfterForcedDelete = await page.evaluate(() => window.__iso.annIds('a1'));

  await switchSheet('a1');
  for (const [key, id] of [['line', 'a1-line'], ['rect', 'a1-rect'], ['text', 'a1-text']]) {
    await page.evaluate((sid) => window.__wmStage.selectSketch(sid), id);
    const sel = await page.evaluate(() => window.__wmStage.getSelectedSketch());
    await switchSheet('a2');
    R['sketch_' + key] = {
      selected: sel,
      afterSwitch: await page.evaluate(() => ({
        sel: window.__wmStage.getSelectedSketch(),
        btnHidden: document.getElementById('wm-sketch-delete').hidden })),
    };
    await page.evaluate(() => document.getElementById('wm-sketch-delete').click());
    await page.waitForTimeout(300);
    await switchSheet('a1');
  }
  R.a1AfterSketchDeletes = await page.evaluate(() => window.__iso.annIds('a1'));

  // ── 7. undo history is per sheet and cannot fire across a switch ──
  await page.evaluate(() => {
    const s = window.__wmStage;
    s.recordCreate({ id: 'a1-line', sheetId: 'a1', type: 'line' });
  });
  R.undoBeforeSwitch = await page.evaluate(() => ({
    canUndo: window.__wmStage.canUndo(), size: window.__wmStage.undoSize() }));
  await switchSheet('a2');
  R.undoAfterSwitch = await page.evaluate(() => ({
    canUndo: window.__wmStage.canUndo(), size: window.__wmStage.undoSize() }));
  await page.click('#wm-undo');
  await page.waitForTimeout(300);
  R.a1AfterCrossUndo = await page.evaluate(() => window.__iso.annIds('a1'));
  R.a2AfterCrossUndo = await page.evaluate(() => window.__iso.annIds('a2'));

  // ── 13. a manual switch followed by NORMAL interactions ──
  R.interact = await page.evaluate(async () => {
    const s = window.__wmStage;
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    // Zoom in first: at fit scale a pan is correctly clamped to nothing, so
    // the check would measure the clamp rather than the gesture.
    s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, s.getStageSize(),
      { width: el.width, height: el.height }, s.getViewport(), 3));
    s.renderLabels();
    const before = s.getViewport();
    const send = (t, id, x, y) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: id,
      clientX: el.left + x, clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    send('pointerdown', 601, 100, 220);
    [25, 55, 90].forEach((d) => send('pointermove', 601, 100 + d, 220));
    send('pointerup', 601, 190, 220);
    const afterPan = s.getViewport();
    send('pointerdown', 611, 140, 320); send('pointerdown', 612, 240, 320);
    send('pointermove', 612, 340, 320);
    const zoomed = s.getViewport().scale;
    send('pointerup', 611, 140, 320); send('pointerup', 612, 340, 320);
    return { panned: Math.abs(afterPan.translateX - before.translateX) > 20,
      pinched: zoomed > afterPan.scale,
      pointers: s.getActivePointers(), gesture: s.getGestureMode() };
  });

  // a new label placed after the switch lands on the CURRENT sheet
  await page.click('#wm-add-label');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const send = (t) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: 621,
      clientX: el.left + el.width / 2, clientY: el.top + el.height / 2,
      bubbles: true, pointerType: 'touch' }));
    send('pointerdown'); send('pointerup');
  });
  await page.waitForTimeout(300);
  R.labelEditorOpen = await page.evaluate(() => {
    const ed = document.getElementById('wm-editor');
    return !!(ed && !ed.hidden);
  });
  if (R.labelEditorOpen) {
    await page.fill('#wm-f-label', 'ZZ-13');
    await page.click('#wm-editor-save');
    await page.waitForTimeout(400);
  }
  R.newLabelSheet = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const anns = await db.listAnnotations('a2');
    db.closeDatabase();
    const zz = anns.find((a) => a.data && a.data.label === 'ZZ-13');
    return zz ? zz.sheetId : null;
  });

  // ── 16. permanent cross-job write isolation ──
  // rename + reorder + add + delete inside job A, then prove job B is
  // byte-identical to its pre-session snapshot.
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const row = document.querySelector('.sheet-row[data-sheet-id="a1"]');
    row.querySelectorAll('button')[2].click(); // Rename
  });
  await page.waitForTimeout(200);
  await page.fill('#wm-rename-name', 'A One Renamed');
  await page.click('#wm-rename-save');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const row = document.querySelector('.sheet-row[data-sheet-id="a2"]');
    row.querySelectorAll('button')[0].click(); // Up
  });
  await page.waitForTimeout(400);
  await page.click('#wm-sheets-add');
  await page.waitForFunction(() => !document.getElementById('wm-addsheet').hidden, { timeout: 10000 });
  await page.fill('#wm-addsheet-name', 'A Three');
  await page.click('#wm-addsheet-blank');
  await page.waitForTimeout(600);
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.sheet-row'));
    const row = rows.find((r) => r.querySelector('.sheet-name').textContent.indexOf('A Three') === 0);
    row.querySelectorAll('button')[3].click(); // Delete
  });
  await page.waitForTimeout(250);
  await page.click('#wm-delsheet-confirm');
  await page.waitForTimeout(600);
  R.jobBAfter = await page.evaluate(() => window.__iso.jobBFingerprint());

  await ctx.close();
  await browser.close();

  const a1Full = ['a1-arrow', 'a1-label', 'a1-line', 'a1-rect', 'a1-text'];
  const checks = [
    ['sheet A1 renders exactly its five annotations (all types present)',
      R.onA1.count === 5 && R.onA1.hasA1Line === true && R.onA1.hasA2Line === false
        && R.onA1.domLabels.indexOf('HR-01') !== -1 && R.onA1.domLabels.indexOf('HR-02') === -1],
    ['switching to A2 swaps to exactly its two annotations',
      R.onA2.count === 2 && R.onA2.hasA2Line === true && R.onA2.hasA1Line === false
        && R.onA2.domLabels.indexOf('HR-02') !== -1 && R.onA2.domLabels.indexOf('HR-01') === -1],
    ['switching back restores A1 in full', R.backOnA1.count === 5 && R.backOnA1.hasA1Line === true],
    ['an armed Line tool is disarmed by a sheet switch',
      R.lineArmed === 'line' && (!R.lineAfterSwitch || R.lineAfterSwitch === 'none')],
    ['an armed Text tool is disarmed by a sheet switch',
      R.textArmed === 'text' && (!R.textAfterSwitch || R.textAfterSwitch === 'none')],
    ['arrow selection is cleared by a sheet switch and its button hides',
      R.arrowSelected.sel === 'a1-arrow' && R.arrowSelected.btnHidden === false
        && R.arrowAfterSwitch.sel === null && R.arrowAfterSwitch.btnHidden === true],
    ['a forced Delete Arrow after the switch cannot reach the previous sheet',
      JSON.stringify(R.a1AfterForcedDelete) === JSON.stringify(a1Full)],
    ['line selection is cleared by a sheet switch',
      R.sketch_line.selected === 'a1-line' && R.sketch_line.afterSwitch.sel === null
        && R.sketch_line.afterSwitch.btnHidden === true],
    ['rect selection is cleared by a sheet switch',
      R.sketch_rect.selected === 'a1-rect' && R.sketch_rect.afterSwitch.sel === null],
    ['text selection is cleared by a sheet switch',
      R.sketch_text.selected === 'a1-text' && R.sketch_text.afterSwitch.sel === null],
    ['forced shape deletes after switches never touched the previous sheet',
      JSON.stringify(R.a1AfterSketchDeletes) === JSON.stringify(a1Full)],
    ['undo history exists before the switch and is empty after it',
      R.undoBeforeSwitch.canUndo === true && R.undoAfterSwitch.canUndo === false
        && R.undoAfterSwitch.size === 0],
    ['pressing Undo on the new sheet mutates neither sheet',
      JSON.stringify(R.a1AfterCrossUndo) === JSON.stringify(a1Full)
        && R.a2AfterCrossUndo.indexOf('a2-label') !== -1
        && R.a2AfterCrossUndo.indexOf('a2-line') !== -1],
    ['pan and pinch work normally right after a manual sheet switch',
      R.interact.panned === true && R.interact.pinched === true
        && R.interact.pointers === 0],
    ['a label placed after the switch lands on the CURRENT sheet',
      !R.labelEditorOpen || R.newLabelSheet === 'a2'],
    ['a full manager session in job A leaves job B byte-identical',
      R.jobBBefore === R.jobBAfter],
    ['no page errors through the isolation flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-8 hardening — Lookup must always reflect the Sheets Manager: rename,
// reorder, delete, delete-current; plus full-reload persistence and
// touch-driven sheet sequences.
// ─────────────────────────────────────────────────────────────────────────
async function runSheetsLookupSync(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const R = {};

  // seed: HR-07 exists on BOTH sheets (equal rank → sheet order decides),
  // KX-1 exists only on S1.
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'lj', name: 'Lookup Job', now }));
    await db.putSheet(WM.model.createSheet({ id: 's1', jobId: 'lj', name: 'Alpha',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.putSheet(WM.model.createSheet({ id: 's2', jobId: 'lj', name: 'Beta',
      kind: 'blank', width: 2000, height: 1500, order: 1, now }));
    await db.putAnnotation(WM.model.createAnnotation({ id: 'l1', sheetId: 's1',
      type: 'wireLabel', at: { x: 0.3, y: 0.3 }, now, data: { label: 'HR-07', from: 'Panel A' } }));
    await db.putAnnotation(WM.model.createAnnotation({ id: 'l2', sheetId: 's2',
      type: 'wireLabel', at: { x: 0.6, y: 0.6 }, now, data: { label: 'HR-07', from: 'Panel B' } }));
    await db.putAnnotation(WM.model.createAnnotation({ id: 'l3', sheetId: 's1',
      type: 'wireLabel', at: { x: 0.8, y: 0.2 }, now, data: { label: 'KX-1' } }));
    await db.setMeta('currentSheetId', 's1');
    db.closeDatabase();
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);

  const lookup = async (q) => {
    await page.evaluate(() => {
      ['wm-sheets', 'wm-addsheet', 'wm-rename', 'wm-delsheet'].forEach((id) => {
        document.getElementById(id).hidden = true; });
      document.getElementById('wm-lookup').hidden = true;
    });
    await page.click('#wm-lookup-open');
    await page.waitForTimeout(250);
    await page.fill('#wm-lookup-query', q);
    await page.click('#wm-lookup-search');
    await page.waitForTimeout(450);
    return page.evaluate(() => ({
      count: document.getElementById('wm-lookup-count').textContent,
      results: Array.from(document.querySelectorAll('#wm-lookup-results .result')).map((c) => ({
        sheetId: c.getAttribute('data-sheet-id'),
        sheetName: c.querySelector('.result-sheet').textContent,
        label: c.querySelector('.result-label').textContent })) }));
  };
  const closeLookup = async () => {
    await page.evaluate(() => { document.getElementById('wm-lookup').hidden = true; });
  };
  const managerAction = async (fn, arg) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    await page.evaluate(fn, arg);
  };

  R.baseline = await lookup('HR-07');
  await closeLookup();

  // ── 8. rename is reflected in Lookup ──
  await managerAction((sid) => {
    document.querySelector('.sheet-row[data-sheet-id="' + sid + '"]')
      .querySelectorAll('button')[2].click();
  }, 's1');
  await page.waitForTimeout(200);
  await page.fill('#wm-rename-name', 'Gamma');
  await page.click('#wm-rename-save');
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  R.afterRename = await lookup('HR-07');
  await closeLookup();

  // ── 9. reorder is reflected in result ordering ──
  await managerAction((sid) => {
    document.querySelector('.sheet-row[data-sheet-id="' + sid + '"]')
      .querySelectorAll('button')[0].click();
  }, 's2');
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  R.afterReorder = await lookup('HR-07');
  await closeLookup();

  // ── 10. deleting a sheet removes its labels from Lookup ──
  await managerAction((sid) => {
    document.querySelector('.sheet-row[data-sheet-id="' + sid + '"]')
      .querySelectorAll('button')[3].click();
  }, 's2');
  await page.waitForTimeout(250);
  await page.click('#wm-delsheet-confirm');
  await page.waitForTimeout(600);
  R.afterDelete = await lookup('HR-07');
  await closeLookup();

  // ── 11. Lookup keeps working after deleting the CURRENT sheet ──
  // Rebuild a second sheet with a label, make it current, delete it, then
  // search and NAVIGATE from a result card on the replacement sheet.
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await page.click('#wm-sheets-add');
  await page.waitForFunction(() => !document.getElementById('wm-addsheet').hidden, { timeout: 10000 });
  await page.fill('#wm-addsheet-name', 'Delta');
  await page.click('#wm-addsheet-blank');
  await page.waitForTimeout(700);
  R.deltaIsCurrent = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId');
    const sheet = await db.getSheet(cur); db.closeDatabase();
    return sheet.name === 'Delta' ? cur : null;
  });
  await managerAction((sid) => {
    document.querySelector('.sheet-row[data-sheet-id="' + sid + '"]')
      .querySelectorAll('button')[3].click();
  }, R.deltaIsCurrent);
  await page.waitForTimeout(250);
  await page.click('#wm-delsheet-confirm');
  await page.waitForTimeout(800);
  R.afterDeleteCurrent = {
    meta: await page.evaluate(async () => {
      const db = WM.store.createStore(); await db.openDatabase();
      const cur = await db.getMeta('currentSheetId'); db.closeDatabase(); return cur;
    }),
    lookup: await lookup('HR-07'),
  };
  // navigate from the result card
  await page.evaluate(() => {
    document.querySelector('#wm-lookup-results .result').click();
  });
  await page.waitForTimeout(700);
  R.navigated = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId'); db.closeDatabase();
    return { meta: cur, lookupClosed: document.getElementById('wm-lookup').hidden,
      count: window.__wmStage.getAnnotationCount() };
  });

  // ── 15. a full reload preserves current sheet, names and order ──
  const beforeReload = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId');
    const cs = await db.getSheet(cur);
    const sheets = WM.sheets.normalizeOrder(await db.listSheets(cs.jobId));
    db.closeDatabase();
    return { cur, names: sheets.map((s) => s.name) };
  });
  await page.reload(); await page.waitForTimeout(300);
  await page.click('#wm-dev-load'); await page.waitForTimeout(600);
  R.reload = {
    before: beforeReload,
    after: await page.evaluate(async () => {
      const db = WM.store.createStore(); await db.openDatabase();
      const cur = await db.getMeta('currentSheetId');
      const cs = await db.getSheet(cur);
      const sheets = WM.sheets.normalizeOrder(await db.listSheets(cs.jobId));
      db.closeDatabase();
      return { cur, names: sheets.map((s) => s.name),
        stageHasSheet: window.__wmStage.hasImage() };
    }),
    lookup: await lookup('HR-07'),
  };
  await closeLookup();

  // ── 12. touch-driven sheet sequences (Chromium; desktop WebKit when
  //        installed adds signal — the physical iPhone gate stays required) ──
  R.touch = await page.evaluate(async () => {
    const tap = (target) => {
      const r = target.getBoundingClientRect();
      const o = { pointerId: 701, clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2, bubbles: true, pointerType: 'touch' };
      target.dispatchEvent(new PointerEvent('pointerdown', o));
      target.dispatchEvent(new PointerEvent('pointerup', o));
      target.click();
    };
    // rapid open/close cycles by touch, then a touch sheet-switch
    for (let i = 0; i < 5; i++) {
      tap(document.getElementById('wm-sheets-open'));
      await new Promise((r) => setTimeout(r, 60));
      tap(document.getElementById('wm-sheets-close'));
      await new Promise((r) => setTimeout(r, 60));
    }
    tap(document.getElementById('wm-sheets-open'));
    await new Promise((r) => setTimeout(r, 250));
    const rows = document.querySelectorAll('.sheet-row .sheet-main');
    tap(rows[rows.length - 1]);
    await new Promise((r) => setTimeout(r, 700));
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const mid = document.elementFromPoint(el.left + el.width / 2, el.top + el.height / 2);
    const blocked = !!(mid && mid.closest && (mid.closest('#wm-sheets') || mid.closest('#wm-lookup')));
    const s = window.__wmStage;
    const send = (t, id, x, y) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: id,
      clientX: el.left + x, clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    send('pointerdown', 711, 130, 300); send('pointerdown', 712, 230, 300);
    send('pointermove', 712, 330, 300);
    const base = s.getViewport().scale;
    send('pointerup', 711, 130, 300); send('pointerup', 712, 330, 300);
    return { blocked, pinchWorks: base > 0, pointers: s.getActivePointers(),
      sheetsHidden: document.getElementById('wm-sheets').hidden };
  });

  await ctx.close();
  await browser.close();

  const names = (r) => r.results.map((x) => x.sheetName);
  const checks = [
    ['baseline: HR-07 found on both sheets, sheet order deciding ties',
      R.baseline.results.length === 2
        && names(R.baseline)[0] === 'Alpha' && names(R.baseline)[1] === 'Beta'],
    ['a rename is reflected on result cards immediately',
      R.afterRename.results.length === 2 && names(R.afterRename)[0] === 'Gamma'
        && names(R.afterRename).indexOf('Alpha') === -1],
    ['a reorder changes equal-rank result ordering to the new sheet order',
      R.afterReorder.results.length === 2 && names(R.afterReorder)[0] === 'Beta'
        && names(R.afterReorder)[1] === 'Gamma'],
    ['deleting a sheet removes its labels from Lookup (cascade)',
      R.afterDelete.results.length === 1 && names(R.afterDelete)[0] === 'Gamma'],
    ['deleting the CURRENT sheet leaves Lookup working on the replacement',
      R.deltaIsCurrent !== null && R.afterDeleteCurrent.meta !== R.deltaIsCurrent
        && R.afterDeleteCurrent.lookup.results.length === 1],
    ['navigating from a result card after that deletion loads the right sheet',
      R.navigated.meta === R.afterDeleteCurrent.lookup.results[0].sheetId
        && R.navigated.lookupClosed === true && R.navigated.count >= 1],
    ['a full reload preserves current sheet, names and order',
      R.reload.after.cur === R.reload.before.cur
        && JSON.stringify(R.reload.after.names) === JSON.stringify(R.reload.before.names)
        && R.reload.after.stageHasSheet === true],
    ['Lookup still answers correctly after the reload',
      R.reload.lookup.results.length === 1],
    ['touch-driven open/close and sheet switch leave no blocking backdrop',
      R.touch.blocked === false && R.touch.sheetsHidden === true],
    ['gestures stay clean after the touch sequences', R.touch.pointers === 0],
    ['no page errors through the lookup-sync flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-8 hardening — iOS-style event sequences for every Sheets Manager
// mutation. Each physical action is a full touch sequence (pointerdown →
// pointerup → compatibility click, exactly what iOS Safari synthesizes) and
// must cause EXACTLY ONE mutation or navigation. Switch and Move Up are also
// driven with pointerType 'mouse' compatibility sequences. Desktop WebKit
// adds signal when installed; the physical iPhone gate stays required.
// ─────────────────────────────────────────────────────────────────────────
async function runSheetsTouchMutations(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const R = {};

  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'tj', name: 'Touch Job', now }));
    for (const [id, name, order] of [['t1', 'One', 0], ['t2', 'Two', 1], ['t3', 'Three', 2]]) {
      await db.putSheet(WM.model.createSheet({ id, jobId: 'tj', name,
        kind: 'blank', width: 2000, height: 1500, order, now }));
    }
    await db.setMeta('currentSheetId', 't1');
    db.closeDatabase();

    // The iOS event train on a tap: pointerdown, pointerup, then the
    // compatibility click. Sent as one unit so any handler wired to more
    // than one of them mutates more than once and fails the exact-state
    // assertions below.
    window.__seq = (target, pointerType) => {
      const r = target.getBoundingClientRect();
      const o = { pointerId: 801, clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2, bubbles: true, pointerType };
      target.dispatchEvent(new PointerEvent('pointerdown', o));
      target.dispatchEvent(new PointerEvent('pointerup', o));
      target.click();
    };
    window.__orderNow = async () => {
      const db2 = WM.store.createStore(); await db2.openDatabase();
      const sheets = WM.sheets.normalizeOrder(await db2.listSheets('tj'));
      const cur = await db2.getMeta('currentSheetId');
      db2.closeDatabase();
      return { names: sheets.map((s) => s.name), orders: sheets.map((s) => s.order), cur };
    };
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);

  const seqOn = async (selector, pointerType) => page.evaluate(({ selector, pointerType }) => {
    window.__seq(document.querySelector(selector), pointerType);
  }, { selector, pointerType });
  const rowBtnSeq = async (id, idx, pointerType) => page.evaluate(({ id, idx, pointerType }) => {
    const row = document.querySelector('.sheet-row[data-sheet-id="' + id + '"]');
    window.__seq(row.querySelectorAll('button')[idx], pointerType);
  }, { id, idx, pointerType });

  // ── Open Sheets by one touch tap ──
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await seqOn('#wm-sheets-open', 'touch');
  await page.waitForTimeout(400);
  R.open = await page.evaluate(() => ({
    open: !document.getElementById('wm-sheets').hidden,
    rows: document.querySelectorAll('.sheet-row').length,
    status: document.getElementById('wm-sheets-status').textContent }));

  // ── Open/switch a sheet by one touch tap ──
  await page.evaluate(() => {
    window.__seq(document.querySelector('.sheet-row[data-sheet-id="t2"] .sheet-main'), 'touch');
  });
  await page.waitForTimeout(700);
  R.switchTouch = { state: await page.evaluate(() => window.__orderNow()),
    closed: await page.evaluate(() => document.getElementById('wm-sheets').hidden) };

  // ── Move Up by one touch tap: exactly ONE position ──
  // Three sits at index 2; a single tap must land it at index 1 and a
  // double-fired handler chain would land it at index 0.
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await rowBtnSeq('t3', 0, 'touch');
  await page.waitForTimeout(500);
  R.moveUpTouch = await page.evaluate(() => window.__orderNow());

  // ── Move Down by one touch tap: exactly ONE position back ──
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await rowBtnSeq('t3', 1, 'touch');
  await page.waitForTimeout(500);
  R.moveDownTouch = await page.evaluate(() => window.__orderNow());

  // ── Rename Save by one touch tap ──
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await rowBtnSeq('t1', 2, 'touch');
  await page.waitForTimeout(250);
  await page.fill('#wm-rename-name', 'Uno');
  await seqOn('#wm-rename-save', 'touch');
  await page.waitForTimeout(500);
  R.renameTouch = {
    state: await page.evaluate(() => window.__orderNow()),
    modalClosed: await page.evaluate(() => document.getElementById('wm-rename').hidden),
    listed: await page.evaluate(() => Array.from(document.querySelectorAll('.sheet-name'))
      .filter((n) => n.textContent.indexOf('Uno') === 0).length),
  };

  // ── Delete confirmation by one touch tap: exactly ONE sheet removed ──
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await rowBtnSeq('t3', 3, 'touch');
  await page.waitForTimeout(300);
  R.delDialog = await page.evaluate(() => ({
    open: !document.getElementById('wm-delsheet').hidden,
    body: document.getElementById('wm-delsheet-body').textContent }));
  await seqOn('#wm-delsheet-confirm', 'touch');
  await page.waitForTimeout(700);
  R.deleteTouch = {
    state: await page.evaluate(() => window.__orderNow()),
    dialogClosed: await page.evaluate(() => document.getElementById('wm-delsheet').hidden),
    error: await page.evaluate(() => document.getElementById('wm-delsheet-error').textContent),
  };

  // ── compatibility MOUSE sequences: switch, then Move Up ──
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__seq(document.querySelector('.sheet-row[data-sheet-id="t1"] .sheet-main'), 'mouse');
  });
  await page.waitForTimeout(700);
  R.switchMouse = await page.evaluate(() => window.__orderNow());
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await rowBtnSeq('t2', 0, 'mouse');
  await page.waitForTimeout(500);
  R.moveUpMouse = await page.evaluate(() => window.__orderNow());

  await ctx.close();
  await browser.close();

  const checks = [
    ['one touch tap opens the Sheets Manager, fully rendered',
      R.open.open === true && R.open.rows === 3 && R.open.status === '3 sheets'],
    ['one touch tap on a row switches to exactly that sheet and closes the manager',
      R.switchTouch.state.cur === 't2' && R.switchTouch.closed === true],
    ['one touch Move Up moves the sheet exactly ONE position',
      JSON.stringify(R.moveUpTouch.names) === JSON.stringify(['One', 'Three', 'Two'])
        && JSON.stringify(R.moveUpTouch.orders) === JSON.stringify([0, 1, 2])],
    ['one touch Move Down moves it exactly ONE position back',
      JSON.stringify(R.moveDownTouch.names) === JSON.stringify(['One', 'Two', 'Three'])
        && JSON.stringify(R.moveDownTouch.orders) === JSON.stringify([0, 1, 2])],
    ['one touch Rename Save stores the new name exactly once',
      JSON.stringify(R.renameTouch.state.names) === JSON.stringify(['Uno', 'Two', 'Three'])
        && R.renameTouch.modalClosed === true && R.renameTouch.listed === 1],
    ['the delete confirmation opens on one touch tap, naming the sheet',
      R.delDialog.open === true && R.delDialog.body.indexOf('Three') !== -1],
    ['one touch Delete confirm removes exactly ONE sheet, cleanly',
      JSON.stringify(R.deleteTouch.state.names) === JSON.stringify(['Uno', 'Two'])
        && R.deleteTouch.state.cur === 't2'
        && R.deleteTouch.dialogClosed === true && R.deleteTouch.error === ''],
    ['a compatibility MOUSE sequence switches to exactly one sheet',
      R.switchMouse.cur === 't1'],
    ['a compatibility MOUSE Move Up moves exactly ONE position',
      JSON.stringify(R.moveUpMouse.names) === JSON.stringify(['Two', 'Uno'])
        && JSON.stringify(R.moveUpMouse.orders) === JSON.stringify([0, 1])],
    ['no page errors through the touch mutation flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-8 hardening — physical interactions IMMEDIATELY after a Sheets Manager
// switch, against every annotation type, with ownership verified: every
// mutation lands on the sheet just switched to and the previous sheet stays
// byte-identical.
// ─────────────────────────────────────────────────────────────────────────
async function runPostSwitchInteractions(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const R = {};

  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'sj', name: 'Switch Job', now }));
    await db.putSheet(WM.model.createSheet({ id: 'p1', jobId: 'sj', name: 'Prev',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.putSheet(WM.model.createSheet({ id: 'p2', jobId: 'sj', name: 'Next',
      kind: 'blank', width: 2000, height: 1500, order: 1, now }));
    const put = (a) => db.putAnnotation(a);
    // p1 — the sheet being LEFT; its fingerprint must never change
    await put(WM.model.createAnnotation({ id: 'p1-label', sheetId: 'p1', type: 'wireLabel',
      at: { x: 0.3, y: 0.3 }, now, data: { label: 'KEEP-1' } }));
    await put(WM.model.createAnnotation({ id: 'p1-arrow', sheetId: 'p1', type: 'arrow',
      a: { x: 0.2, y: 0.2 }, b: { x: 0.6, y: 0.6 }, now }));
    await put(WM.model.createAnnotation({ id: 'p1-text', sheetId: 'p1', type: 'text',
      at: { x: 0.7, y: 0.8 }, now, data: { text: 'keep' } }));
    // p2 — the sheet being switched TO; one of every draggable type
    await put(WM.model.createAnnotation({ id: 'p2-label', sheetId: 'p2', type: 'wireLabel',
      at: { x: 0.35, y: 0.30 }, now, data: { label: 'PL-1', from: 'Panel P' } }));
    await put(WM.model.createAnnotation({ id: 'p2-arrow', sheetId: 'p2', type: 'arrow',
      a: { x: 0.15, y: 0.50 }, b: { x: 0.45, y: 0.62 }, now }));
    await put(WM.model.createAnnotation({ id: 'p2-line', sheetId: 'p2', type: 'line',
      a: { x: 0.20, y: 0.75 }, b: { x: 0.70, y: 0.75 }, now }));
    await put(WM.model.createAnnotation({ id: 'p2-rect', sheetId: 'p2', type: 'rect',
      a: { x: 0.60, y: 0.12 }, b: { x: 0.85, y: 0.32 }, now }));
    await put(WM.model.createAnnotation({ id: 'p2-text', sheetId: 'p2', type: 'text',
      at: { x: 0.55, y: 0.90 }, now, data: { text: 'Note P2' } }));
    await db.setMeta('currentSheetId', 'p1');
    db.closeDatabase();

    window.__ps = {
      async fingerprint(sheetId) {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const anns = await db2.listAnnotations(sheetId);
        db2.closeDatabase();
        return JSON.stringify(anns);
      },
      async saved(id) {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const a = await db2.getAnnotation(id);
        db2.closeDatabase();
        return a;
      },
      screenOf(at) {
        const s = window.__wmStage;
        return WM.viewport.stageToScreen(
          WM.geometry.denormalizePoint(at, s.getStageSize()), s.getViewport());
      },
    };
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);
  R.p1Before = await page.evaluate(() => window.__ps.fingerprint('p1'));

  // ── the switch under test: p1 → p2 through the Sheets Manager ──
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.querySelector('.sheet-row[data-sheet-id="p2"] .sheet-main').click();
  });
  await page.waitForTimeout(700);

  const send = (t, id, x, y) => page.evaluate(({ t, id, x, y }) => {
    const el = document.getElementById('wm-viewport');
    const r = el.getBoundingClientRect();
    const tg = document.elementFromPoint(r.left + x, r.top + y) || el;
    tg.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: r.left + x,
      clientY: r.top + y, bubbles: true, pointerType: 'touch' }));
  }, { t, id, x, y });
  const drag = async (id, from, to) => {
    await send('pointerdown', id, from.x, from.y);
    for (const f of [0.35, 0.7, 1]) {
      await send('pointermove', id, from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f);
    }
    await send('pointerup', id, to.x, to.y);
    await page.waitForTimeout(350);
  };
  const screenOf = (annId) => page.evaluate((aid) =>
    window.__ps.screenOf(window.__wmStage.getAnnotation(aid).at
      || window.__wmStage.getAnnotation(aid).a), annId);

  // ── 1+2. pan and pinch, straight after the switch (pre-zoomed) ──
  R.gesture = await page.evaluate(async () => {
    const s = window.__wmStage;
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, s.getStageSize(),
      { width: el.width, height: el.height }, s.getViewport(), 3));
    s.renderLabels();
    const before = s.getViewport();
    const send = (t, id, x, y) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: id,
      clientX: el.left + x, clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    send('pointerdown', 821, 110, 210);
    [25, 55, 90].forEach((d) => send('pointermove', 821, 110 + d, 210));
    send('pointerup', 821, 200, 210);
    const afterPan = s.getViewport();
    send('pointerdown', 831, 140, 330); send('pointerdown', 832, 240, 330);
    send('pointermove', 832, 340, 330);
    const zoomed = s.getViewport().scale;
    send('pointerup', 831, 140, 330); send('pointerup', 832, 340, 330);
    s.fit(); s.renderLabels();
    return { panned: Math.abs(afterPan.translateX - before.translateX) > 20,
      scaleKeptDuringPan: afterPan.scale === before.scale,
      pinched: zoomed > afterPan.scale, pointers: s.getActivePointers() };
  });
  await page.waitForTimeout(200);

  // ── 3. Wire Label: tap opens its editor; drag moves it ──
  let pt = await screenOf('p2-label');
  await send('pointerdown', 841, pt.x, pt.y);
  await send('pointerup', 841, pt.x, pt.y);
  await page.waitForTimeout(300);
  R.labelTap = await page.evaluate(() => ({
    open: !document.getElementById('wm-editor').hidden,
    value: document.getElementById('wm-f-label').value }));
  await page.click('#wm-editor-cancel');
  await page.waitForTimeout(200);
  const labelBefore = await page.evaluate(() => window.__wmStage.getAnnotation('p2-label').at);
  pt = await screenOf('p2-label');
  await drag(842, pt, { x: pt.x + 60, y: pt.y + 30 });
  R.labelDrag = {
    live: await page.evaluate(() => window.__wmStage.getAnnotation('p2-label').at),
    saved: await page.evaluate(() => window.__ps.saved('p2-label')),
    before: labelBefore,
  };

  // ── 4. Arrow endpoint drag ──
  const arrowMid = await page.evaluate(() => {
    const s = window.__wmStage; const a = s.getAnnotation('p2-arrow');
    return window.__ps.screenOf({ x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 });
  });
  await send('pointerdown', 851, arrowMid.x, arrowMid.y);
  await send('pointerup', 851, arrowMid.x, arrowMid.y);
  await page.waitForTimeout(300);
  R.arrowSelected = await page.evaluate(() => ({
    sel: window.__wmStage.getSelectedArrow(),
    handles: document.querySelectorAll('.wm-endpoint').length }));
  const arrowBefore = await page.evaluate(() => {
    const a = window.__wmStage.getAnnotation('p2-arrow');
    return { a: a.a, b: a.b };
  });
  const hArrow = await page.evaluate(() => {
    // the handle nearest endpoint a
    const s = window.__wmStage; const ann = s.getAnnotation('p2-arrow');
    const target = window.__ps.screenOf(ann.a);
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    let best = null; let bestD = Infinity;
    document.querySelectorAll('.wm-endpoint .wm-endpoint-target').forEach((t) => {
      const r = t.getBoundingClientRect();
      const c = { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
      const d = (c.x - target.x) ** 2 + (c.y - target.y) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  });
  await drag(852, hArrow, { x: hArrow.x + 55, y: hArrow.y - 35 });
  R.arrowDrag = {
    live: await page.evaluate(() => {
      const a = window.__wmStage.getAnnotation('p2-arrow');
      return { a: a.a, b: a.b };
    }),
    saved: await page.evaluate(() => window.__ps.saved('p2-arrow')),
    before: arrowBefore,
  };
  await page.evaluate(() => window.__wmStage.selectArrow(null));

  // ── 5. Line endpoint drag ──
  const lineMid = await page.evaluate(() => {
    const a = window.__wmStage.getAnnotation('p2-line');
    return window.__ps.screenOf({ x: (a.a.x + a.b.x) / 2, y: (a.a.y + a.b.y) / 2 });
  });
  await send('pointerdown', 861, lineMid.x, lineMid.y);
  await send('pointerup', 861, lineMid.x, lineMid.y);
  await page.waitForTimeout(300);
  R.lineSelected = await page.evaluate(() => ({
    sel: window.__wmStage.getSelectedSketch(),
    handles: document.querySelectorAll('.wm-sketch-handle').length }));
  const lineBefore = await page.evaluate(() => {
    const a = window.__wmStage.getAnnotation('p2-line');
    return { a: a.a, b: a.b };
  });
  const hLine = await page.evaluate(() => {
    const t = document.querySelector('.wm-sketch-handle[data-handle="a"] .wm-endpoint-target');
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  await drag(862, hLine, { x: hLine.x + 45, y: hLine.y - 40 });
  R.lineDrag = {
    live: await page.evaluate(() => {
      const a = window.__wmStage.getAnnotation('p2-line');
      return { a: a.a, b: a.b };
    }),
    saved: await page.evaluate(() => window.__ps.saved('p2-line')),
    before: lineBefore,
  };
  await page.evaluate(() => window.__wmStage.selectSketch(null));

  // ── 6. Rectangle corner drag ──
  const rectEdge = await page.evaluate(() => {
    const a = window.__wmStage.getAnnotation('p2-rect');
    return window.__ps.screenOf({ x: (a.a.x + a.b.x) / 2, y: Math.min(a.a.y, a.b.y) });
  });
  await send('pointerdown', 871, rectEdge.x, rectEdge.y);
  await send('pointerup', 871, rectEdge.x, rectEdge.y);
  await page.waitForTimeout(300);
  R.rectSelected = await page.evaluate(() => ({
    sel: window.__wmStage.getSelectedSketch(),
    handles: document.querySelectorAll('.wm-sketch-handle').length }));
  const rectBefore = await page.evaluate(() => {
    const a = window.__wmStage.getAnnotation('p2-rect');
    return { a: a.a, b: a.b };
  });
  const hRect = await page.evaluate(() => {
    const t = document.querySelector('.wm-sketch-handle[data-handle="nw"] .wm-endpoint-target');
    const r = t.getBoundingClientRect();
    const vp = document.getElementById('wm-viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2 - vp.left, y: r.top + r.height / 2 - vp.top };
  });
  await drag(872, hRect, { x: hRect.x - 30, y: hRect.y - 25 });
  R.rectDrag = {
    live: await page.evaluate(() => {
      const a = window.__wmStage.getAnnotation('p2-rect');
      return { a: a.a, b: a.b };
    }),
    saved: await page.evaluate(() => window.__ps.saved('p2-rect')),
    before: rectBefore,
  };
  await page.evaluate(() => window.__wmStage.selectSketch(null));

  // ── 7. Text: tap opens its editor; drag moves it without opening it ──
  pt = await screenOf('p2-text');
  await send('pointerdown', 881, pt.x, pt.y);
  await send('pointerup', 881, pt.x, pt.y);
  await page.waitForTimeout(300);
  R.textTap = await page.evaluate(() => ({
    open: !document.getElementById('wm-text-editor').hidden,
    value: document.getElementById('wm-text-value').value }));
  await page.click('#wm-text-cancel');
  await page.waitForTimeout(200);
  const textBefore = await page.evaluate(() => window.__wmStage.getAnnotation('p2-text').at);
  pt = await screenOf('p2-text');
  await drag(882, pt, { x: pt.x - 50, y: pt.y - 40 });
  R.textDrag = {
    live: await page.evaluate(() => window.__wmStage.getAnnotation('p2-text').at),
    saved: await page.evaluate(() => window.__ps.saved('p2-text')),
    editorOpen: await page.evaluate(() => !document.getElementById('wm-text-editor').hidden),
    before: textBefore,
  };

  // ── ownership: everything landed on p2; p1 is byte-identical ──
  R.p1After = await page.evaluate(() => window.__ps.fingerprint('p1'));
  R.p2Count = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const anns = await db.listAnnotations('p2'); db.closeDatabase();
    return anns.length;
  });

  await ctx.close();
  await browser.close();

  const moved = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const checks = [
    ['pan works immediately after the manager switch (scale untouched)',
      R.gesture.panned === true && R.gesture.scaleKeptDuringPan === true],
    ['pinch zoom works immediately after the manager switch',
      R.gesture.pinched === true && R.gesture.pointers === 0],
    ['tapping the wire label opens its editor with its own values',
      R.labelTap.open === true && R.labelTap.value === 'PL-1'],
    ['dragging the wire label moves it, persisted, still owned by the new sheet',
      moved(R.labelDrag.live, R.labelDrag.before)
        && same(R.labelDrag.saved.at, R.labelDrag.live)
        && R.labelDrag.saved.sheetId === 'p2'],
    ['tapping the arrow selects it and shows its endpoint handles',
      R.arrowSelected.sel === 'p2-arrow' && R.arrowSelected.handles === 2],
    ['dragging an arrow endpoint moves ONLY that endpoint, persisted, owned by the new sheet',
      moved(R.arrowDrag.live.a, R.arrowDrag.before.a)
        && same(R.arrowDrag.live.b, R.arrowDrag.before.b)
        && same(R.arrowDrag.saved.a, R.arrowDrag.live.a)
        && R.arrowDrag.saved.sheetId === 'p2'],
    ['tapping the line selects it with two handles',
      R.lineSelected.sel === 'p2-line' && R.lineSelected.handles === 2],
    ['dragging a line endpoint moves ONLY that endpoint, persisted, owned by the new sheet',
      moved(R.lineDrag.live.a, R.lineDrag.before.a)
        && same(R.lineDrag.live.b, R.lineDrag.before.b)
        && same(R.lineDrag.saved.a, R.lineDrag.live.a)
        && R.lineDrag.saved.sheetId === 'p2'],
    ['tapping the rectangle selects it with four corner handles',
      R.rectSelected.sel === 'p2-rect' && R.rectSelected.handles === 4],
    ['dragging the NW corner reshapes the rectangle, persisted, owned by the new sheet',
      (moved(R.rectDrag.live.a, R.rectDrag.before.a) || moved(R.rectDrag.live.b, R.rectDrag.before.b))
        && same(R.rectDrag.saved.a, R.rectDrag.live.a)
        && same(R.rectDrag.saved.b, R.rectDrag.live.b)
        && R.rectDrag.saved.sheetId === 'p2'],
    ['tapping the text opens its editor with its own content',
      R.textTap.open === true && R.textTap.value === 'Note P2'],
    ['dragging the text moves it without opening the editor, persisted, owned by the new sheet',
      moved(R.textDrag.live, R.textDrag.before)
        && same(R.textDrag.saved.at, R.textDrag.live)
        && R.textDrag.editorOpen === false
        && R.textDrag.saved.sheetId === 'p2'],
    ['no annotation was created or lost by the post-switch drags', R.p2Count === 5],
    ['the sheet that was LEFT is byte-identical after every interaction',
      R.p1Before === R.p1After],
    ['no page errors through the post-switch interaction flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-8 physical-gate regression — Photo Sheet image persistence across
// sheet switches, reloads and deletion. This pins the iPhone defect where
// a Photo Sheet rendered on creation but came back BLANK after switching
// away and returning: the store now materializes IndexedDB blobs while the
// connection is open, and every check here demands ACTUAL pixels
// (naturalWidth), never just a src attribute.
// ─────────────────────────────────────────────────────────────────────────
async function runPhotoPersistence(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const R = {};

  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'qj', name: 'Persist Job', now }));
    await db.putSheet(WM.model.createSheet({ id: 'qblank', jobId: 'qj', name: 'Blank Base',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.setMeta('currentSheetId', 'qblank');
    db.closeDatabase();

    const img = document.getElementById('wm-background');
    window.__pp = {
      loads: 0, errors: 0, urls: [],
      makeJpeg(w, h, hue) {
        return new Promise((resolve) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const g = c.getContext('2d');
          g.fillStyle = hue; g.fillRect(0, 0, w, h);
          g.fillStyle = '#fff'; g.fillRect(w / 3, h / 3, w / 3, h / 3);
          c.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
        });
      },
      attach(blob, name) {
        const input = document.getElementById('wm-addsheet-file');
        const dt = new DataTransfer();
        dt.items.add(new File([blob], name, { type: 'image/jpeg' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      async state() {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const cur = await db2.getMeta('currentSheetId');
        const sheet = cur ? await db2.getSheet(cur) : null;
        const image = sheet && sheet.imageId ? await db2.getImage(sheet.imageId) : null;
        db2.closeDatabase();
        return { sheetId: sheet ? sheet.id : null,
          kind: sheet ? sheet.kind : null,
          imageId: sheet ? sheet.imageId : null,
          record: image ? { size: image.blob.size, type: image.blob.type,
            w: image.width, h: image.height } : null,
          shown: !!(!img.hidden && img.getAttribute('src')
            && img.complete && img.naturalWidth > 0),
          naturalW: img.naturalWidth, naturalH: img.naturalHeight,
          src: img.getAttribute('src') };
      },
      async imageCount() {
        return new Promise((resolve, reject) => {
          const req = indexedDB.open(WM.store.DB_NAME);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const dbi = req.result;
            const t = dbi.transaction(['images'], 'readonly');
            const r = t.objectStore('images').count();
            r.onsuccess = () => { dbi.close(); resolve(r.result); };
            r.onerror = () => { dbi.close(); reject(r.error); };
          };
        });
      },
    };
    img.addEventListener('load', () => { window.__pp.loads += 1;
      window.__pp.urls.push(img.currentSrc || img.src); });
    img.addEventListener('error', () => { window.__pp.errors += 1; });
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);

  const addPhoto = async (name, hue) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    await page.click('#wm-sheets-add');
    await page.waitForFunction(() => !document.getElementById('wm-addsheet').hidden, { timeout: 10000 });
    await page.fill('#wm-addsheet-name', name);
    await page.evaluate(async ({ name, hue }) => {
      const b = await window.__pp.makeJpeg(720, 540, hue);
      window.__pp.attach(b, name + '.jpg');
    }, { name, hue });
    await page.waitForFunction(() => document.getElementById('wm-addsheet').hidden, { timeout: 15000 });
    await page.waitForTimeout(700);
  };
  const switchTo = async (name) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    await page.evaluate((n) => {
      Array.from(document.querySelectorAll('.sheet-row'))
        .find((r) => r.querySelector('.sheet-name').textContent.indexOf(n) === 0)
        .querySelector('.sheet-main').click();
    }, name);
    await page.waitForTimeout(800);
    return page.evaluate(() => window.__pp.state());
  };

  // ── create, verify with real pixels, capture identity ──
  await addPhoto('Persist Photo', '#264');
  R.created = await page.evaluate(() => window.__pp.state());
  R.countAfterCreate = await page.evaluate(() => window.__pp.imageCount());

  // ── Photo → Blank → Photo, three full round trips ──
  R.trips = [];
  for (let i = 0; i < 3; i++) {
    const onBlank = await switchTo('Blank Base');
    const back = await switchTo('Persist Photo');
    R.trips.push({ onBlank, back });
  }
  R.countAfterTrips = await page.evaluate(() => window.__pp.imageCount());
  R.events = await page.evaluate(() => ({ loads: window.__pp.loads,
    errors: window.__pp.errors, distinctUrls: new Set(window.__pp.urls).size }));

  // ── full reload, then away-and-back again ──
  await page.reload(); await page.waitForTimeout(300);
  await page.evaluate(() => {
    const img = document.getElementById('wm-background');
    window.__pp2 = { errors: 0 };
    img.addEventListener('error', () => { window.__pp2.errors += 1; });
  });
  await page.click('#wm-dev-load'); await page.waitForTimeout(800);
  R.afterReload = await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const cur = await db.getMeta('currentSheetId');
    const sheet = await db.getSheet(cur);
    const image = sheet.imageId ? await db.getImage(sheet.imageId) : null;
    db.closeDatabase();
    const img = document.getElementById('wm-background');
    return { sheetId: sheet.id, imageId: sheet.imageId, record: !!image,
      shown: !!(!img.hidden && img.complete && img.naturalWidth > 0),
      naturalW: img.naturalWidth };
  });
  // reinstall the full helper set lost to the reload, then one more away-and-back
  await page.evaluate(() => {
    window.__pp = window.__pp || {};
    window.__pp.makeJpeg = (w, h, hue) => new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = hue; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.fillRect(w / 3, h / 3, w / 3, h / 3);
      c.toBlob((b) => resolve(b), 'image/jpeg', 0.9);
    });
    window.__pp.attach = (blob, name) => {
      const input = document.getElementById('wm-addsheet-file');
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: 'image/jpeg' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__pp.imageCount = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(WM.store.DB_NAME);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const dbi = req.result;
        const t = dbi.transaction(['images'], 'readonly');
        const r = t.objectStore('images').count();
        r.onsuccess = () => { dbi.close(); resolve(r.result); };
        r.onerror = () => { dbi.close(); reject(r.error); };
      };
    });
    window.__pp.state = async () => {
      const db2 = WM.store.createStore(); await db2.openDatabase();
      const cur = await db2.getMeta('currentSheetId');
      const sheet = cur ? await db2.getSheet(cur) : null;
      const image = sheet && sheet.imageId ? await db2.getImage(sheet.imageId) : null;
      db2.closeDatabase();
      const img = document.getElementById('wm-background');
      return { sheetId: sheet ? sheet.id : null, kind: sheet ? sheet.kind : null,
        imageId: sheet ? sheet.imageId : null,
        record: image ? { size: image.blob.size, type: image.blob.type,
          w: image.width, h: image.height } : null,
        shown: !!(!img.hidden && img.getAttribute('src')
          && img.complete && img.naturalWidth > 0),
        naturalW: img.naturalWidth, naturalH: img.naturalHeight,
        src: img.getAttribute('src') };
    };
  });
  await switchTo('Blank Base');
  R.afterReloadReturn = await switchTo('Persist Photo');
  R.reloadErrors = await page.evaluate(() => window.__pp2.errors);

  // ── deletion still cascades ITS image and only its image ──
  await addPhoto('Decoy Photo', '#622');
  R.decoy = await page.evaluate(() => window.__pp.state());
  R.countWithDecoy = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(WM.store.DB_NAME);
      req.onsuccess = () => { const dbi = req.result;
        const t = dbi.transaction(['images'], 'readonly');
        const r = t.objectStore('images').count();
        r.onsuccess = () => { dbi.close(); resolve(r.result); };
        r.onerror = () => { dbi.close(); reject(r.error); }; };
      req.onerror = () => reject(req.error);
    });
  });
  // delete "Persist Photo" through the real manager
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.sheet-row'))
      .find((r) => r.querySelector('.sheet-name').textContent.indexOf('Persist Photo') === 0)
      .querySelectorAll('button')[3].click();
  });
  await page.waitForTimeout(250);
  await page.click('#wm-delsheet-confirm');
  await page.waitForTimeout(700);
  R.afterDelete = await page.evaluate(async (arg) => {
    const db = WM.store.createStore(); await db.openDatabase();
    const deletedImage = await db.getImage(arg.deletedImageId);
    const decoyImage = await db.getImage(arg.decoyImageId);
    const deletedSheet = await db.getSheet(arg.deletedSheetId);
    db.closeDatabase();
    return { deletedImageGone: deletedImage === null,
      decoyImageIntact: !!(decoyImage && decoyImage.blob && decoyImage.blob.size > 0),
      deletedSheetGone: deletedSheet === null };
  }, { deletedImageId: R.created.imageId, deletedSheetId: R.created.sheetId,
       decoyImageId: R.decoy.imageId });

  // ── failure cleanup vs success retention, back to back ──
  await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
  await page.click('#wm-sheets-open');
  await page.waitForTimeout(300);
  await page.click('#wm-sheets-add');
  await page.waitForFunction(() => !document.getElementById('wm-addsheet').hidden, { timeout: 10000 });
  await page.fill('#wm-addsheet-name', 'Doomed');
  const countBeforeDoomed = await page.evaluate(() => window.__pp.imageCount
    ? window.__pp.imageCount() : new Promise((resolve, reject) => {
      const req = indexedDB.open(WM.store.DB_NAME);
      req.onsuccess = () => { const dbi = req.result;
        const t = dbi.transaction(['images'], 'readonly');
        const r = t.objectStore('images').count();
        r.onsuccess = () => { dbi.close(); resolve(r.result); };
        r.onerror = () => { dbi.close(); reject(r.error); }; };
      req.onerror = () => reject(req.error);
    }));
  await page.evaluate(async () => {
    const orig = WM.model.validateSheet;
    window.__restoreValidate = () => { WM.model.validateSheet = orig; };
    WM.model.validateSheet = () => ({ valid: false, problems: ['injected failure'] });
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 300, 200);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const input = document.getElementById('wm-addsheet-file');
    const dt = new DataTransfer();
    dt.items.add(new File([b], 'doomed.jpg', { type: 'image/jpeg' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() =>
    document.getElementById('wm-addsheet-error').textContent.indexOf('injected') !== -1,
    { timeout: 15000 });
  await page.evaluate(() => window.__restoreValidate());
  const countAfterDoomed = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open(WM.store.DB_NAME);
    req.onsuccess = () => { const dbi = req.result;
      const t = dbi.transaction(['images'], 'readonly');
      const r = t.objectStore('images').count();
      r.onsuccess = () => { dbi.close(); resolve(r.result); };
      r.onerror = () => { dbi.close(); reject(r.error); }; };
    req.onerror = () => reject(req.error);
  }));
  // a SUCCESSFUL add immediately after must retain its image
  await page.fill('#wm-addsheet-name', 'Survivor');
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const g = c.getContext('2d'); g.fillStyle = '#161'; g.fillRect(0, 0, 320, 240);
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const input = document.getElementById('wm-addsheet-file');
    const dt = new DataTransfer();
    dt.items.add(new File([b], 'survivor.jpg', { type: 'image/jpeg' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('wm-addsheet').hidden, { timeout: 15000 });
  await page.waitForTimeout(700);
  R.survivor = { state: await page.evaluate(() => window.__pp.state()) };
  // ...and its image must still be there after one more away-and-back
  await switchTo('Blank Base');
  R.survivorReturn = await switchTo('Survivor');
  R.cleanup = { before: countBeforeDoomed, afterDoomed: countAfterDoomed };

  await ctx.close();
  await browser.close();

  const everyTrip = (fn) => R.trips.every(fn);
  const checks = [
    ['a new Photo Sheet shows REAL pixels at the stored dimensions',
      R.created.kind === 'photo' && R.created.shown === true
        && R.created.naturalW === R.created.record.w
        && R.created.record.size > 0],
    ['on the Blank sheet the photo is fully gone from the DOM',
      everyTrip((t) => t.onBlank.shown === false && t.onBlank.src === null
        && t.onBlank.imageId === null)],
    ['EVERY return renders the photo again with real pixels',
      everyTrip((t) => t.back.shown === true && t.back.naturalW === R.created.record.w
        && t.back.naturalH === R.created.record.h)],
    ['every return is the SAME sheet with the SAME imageId',
      everyTrip((t) => t.back.sheetId === R.created.sheetId
        && t.back.imageId === R.created.imageId)],
    ['the persisted record survives every switch, byte size unchanged',
      everyTrip((t) => t.back.record && t.back.record.size === R.created.record.size)],
    ['no reprocessing and no duplication — image count constant across trips',
      R.countAfterTrips === R.countAfterCreate],
    ['each return decodes through a FRESH display URL with zero image errors',
      R.events.errors === 0 && R.events.distinctUrls >= 4],
    ['after a full reload the photo returns from pure persistence',
      R.afterReload.sheetId === R.created.sheetId
        && R.afterReload.imageId === R.created.imageId
        && R.afterReload.record === true && R.afterReload.shown === true
        && R.afterReload.naturalW === R.created.record.w],
    ['after the reload, away-and-back still brings the photo back',
      R.afterReloadReturn.shown === true
        && R.afterReloadReturn.imageId === R.created.imageId
        && R.reloadErrors === 0],
    ['deleting the Photo Sheet cascades exactly ITS image record',
      R.afterDelete.deletedSheetGone === true && R.afterDelete.deletedImageGone === true
        && R.afterDelete.decoyImageIntact === true],
    ['a FAILED add still removes its orphan image',
      R.cleanup.afterDoomed === R.cleanup.before],
    ['a SUCCESSFUL add right after a failed one keeps its image and displays it',
      R.survivor.state.shown === true && R.survivor.state.record !== null],
    ['the successful image also survives away-and-back — success is never orphan-cleaned',
      R.survivorReturn.shown === true
        && R.survivorReturn.imageId === R.survivor.state.imageId
        && R.survivorReturn.record !== null],
    ['no page errors through the persistence flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-9A — Symbols foundation: picker, previews, placement, rendering,
// constant screen size, unknown-key safety, density, responsiveness.
// ─────────────────────────────────────────────────────────────────────────
async function runSymbolsFoundation(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  const R = {};
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'syj', name: 'Symbols Job', now }));
    await db.putSheet(WM.model.createSheet({ id: 'sy1', jobId: 'syj', name: 'Sym Blank',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.setMeta('currentSheetId', 'sy1');
    db.closeDatabase();
    window.__sy = {
      tapEmpty(x, y) {
        const el = document.getElementById('wm-viewport');
        const r = el.getBoundingClientRect();
        const tg = document.elementFromPoint(r.left + x, r.top + y) || el;
        const o = (t) => new PointerEvent(t, { pointerId: 901, clientX: r.left + x,
          clientY: r.top + y, bubbles: true, pointerType: 'touch' });
        tg.dispatchEvent(o('pointerdown'));
        tg.dispatchEvent(o('pointerup'));
      },
      async anns() {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const a = await db2.listAnnotations('sy1'); db2.closeDatabase(); return a;
      },
    };
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);

  // ── picker: 8 cards, 4 sections, real previews, responsive ──
  const openPicker = async () => {
    await page.evaluate(() => { document.getElementById('wm-sympicker').hidden = true; });
    await page.click('#wm-symbols-open');
    await page.waitForTimeout(250);
  };
  const measurePicker = () => page.evaluate(() => {
    const vw = window.innerWidth; const vh = window.innerHeight;
    const cards = Array.from(document.querySelectorAll('.symcard')).map((c) => {
      const r = c.getBoundingClientRect();
      const svg = c.querySelector('svg.wm-symbol-icon');
      const sr = svg ? svg.getBoundingClientRect() : null;
      return { key: c.getAttribute('data-symbol-key'),
        name: c.querySelector('.symcard-name').textContent,
        left: r.left, right: r.right, width: r.width,
        iconVisible: !!(sr && sr.width > 20 && sr.height > 20),
        iconPrimitives: svg ? svg.childNodes.length : 0 };
    });
    const sections = Array.from(document.querySelectorAll('.symcard-section'))
      .map((s) => s.textContent);
    const panel = document.querySelector('#wm-sympicker .sheet-panel').getBoundingClientRect();
    const list = document.getElementById('wm-sympicker-list');
    const close = document.getElementById('wm-sympicker-close').getBoundingClientRect();
    // reachability without auto-scroll: every card sits inside the SCROLL
    // CONTAINER's horizontal bounds and within its scrollable height.
    const lr = list.getBoundingClientRect();
    const scrollable = list.scrollHeight;
    const cardsInScroller = cards.every((c) => c.left >= lr.left - 1 && c.right <= lr.right + 1);
    return { vw, vh, sections, cards,
      docOverflow: document.documentElement.scrollWidth > vw + 1,
      panelFits: panel.left >= 0 && panel.right <= vw + 1 && panel.top >= 0
        && panel.bottom <= vh + 1,
      listScrolls: scrollable >= lr.height - 1,
      cardsInScroller,
      closeVisible: close.width > 0 && close.bottom <= vh + 1,
      btnVisible: (() => { const b = document.getElementById('wm-symbols-open')
        .getBoundingClientRect(); return b.width > 0 && b.right <= vw + 1; })() };
  });

  await openPicker();
  R.picker = await measurePicker();

  R.viewports = {};
  for (const [label, w, h] of [['p390', 390, 844], ['p375', 375, 667], ['l844', 844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    await openPicker();
    R.viewports[label] = await measurePicker();
    await page.click('#wm-sympicker-close');
    await page.waitForTimeout(150);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  // ── close without choosing → normal interaction ──
  await openPicker();
  await page.click('#wm-sympicker-close');
  await page.waitForTimeout(200);
  R.afterClose = await page.evaluate(() => {
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    const mid = document.elementFromPoint(el.left + el.width / 2, el.top + el.height / 2);
    const s = window.__wmStage;
    return { blocked: !!(mid && mid.closest && mid.closest('#wm-sympicker')),
      armed: s.activeSymbolKey() };
  });
  R.afterClosePan = await page.evaluate(() => {
    const s = window.__wmStage;
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, s.getStageSize(),
      { width: el.width, height: el.height }, s.getViewport(), 3));
    s.renderLabels();
    const before = s.getViewport();
    const send = (t, id, x, y) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: id,
      clientX: el.left + x, clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    send('pointerdown', 911, 100, 200);
    [30, 60, 90].forEach((d) => send('pointermove', 911, 100 + d, 200));
    send('pointerup', 911, 190, 200);
    const after = s.getViewport();
    send('pointerdown', 921, 130, 320); send('pointerdown', 922, 230, 320);
    send('pointermove', 922, 330, 320);
    const zoomed = s.getViewport().scale;
    send('pointerup', 921, 130, 320); send('pointerup', 922, 330, 320);
    s.fit(); s.renderLabels();
    return { panned: Math.abs(after.translateX - before.translateX) > 20,
      pinched: zoomed > after.scale, pointers: s.getActivePointers() };
  });
  await page.waitForTimeout(150);

  // ── pick Duplex → place exactly one → mode exits ──
  await openPicker();
  await page.evaluate(() => {
    document.querySelector('.symcard[data-symbol-key="outlet.duplex"]').click();
  });
  await page.waitForTimeout(200);
  R.armed = await page.evaluate(() => ({
    key: window.__wmStage.activeSymbolKey(),
    pickerClosed: document.getElementById('wm-sympicker').hidden,
    hint: document.getElementById('wm-symbol-hint').hidden ? ''
      : document.getElementById('wm-symbol-hint').textContent }));
  await page.evaluate(() => window.__sy.tapEmpty(140, 260));
  await page.waitForTimeout(450);
  R.placedOnce = {
    anns: await page.evaluate(() => window.__sy.anns()),
    armed: await page.evaluate(() => window.__wmStage.activeSymbolKey()),
    hintHidden: await page.evaluate(() => document.getElementById('wm-symbol-hint').hidden),
  };
  await page.evaluate(() => window.__sy.tapEmpty(240, 300));
  await page.waitForTimeout(400);
  R.secondTap = await page.evaluate(() => window.__sy.anns());

  // ── place all 8 through the picker; verify persisted + rendered ──
  const spots = [[80, 180], [180, 180], [280, 180], [330, 260], [80, 340],
    [180, 340], [280, 340], [60, 420], [160, 420], [260, 420]];
  const keys = ['outlet.simplex', 'outlet.gfci', 'outlet.dedicated', 'switch.single',
    'switch.threeWay', 'switch.fourWay', 'light.ceiling', 'light.recessed',
    'device.smoke', 'device.thermostat'];
  for (let i = 0; i < keys.length; i++) {
    await openPicker();
    await page.evaluate((k) => {
      document.querySelector('.symcard[data-symbol-key="' + k + '"]').click();
    }, keys[i]);
    await page.waitForTimeout(150);
    await page.evaluate(({ x, y }) => window.__sy.tapEmpty(x, y), 
      { x: spots[i][0], y: spots[i][1] });
    await page.waitForTimeout(350);
  }
  R.allEight = await page.evaluate(async () => {
    const anns = await window.__sy.anns();
    const dom = Array.from(document.querySelectorAll('#wm-symbols .wm-symbol'));
    const s = window.__wmStage;
    return {
      stored: anns.map((a) => ({ type: a.type, key: a.data.symbolKey,
        okAt: a.at && a.at.x >= 0 && a.at.x <= 1 && a.at.y >= 0 && a.at.y <= 1 })),
      domCount: dom.length,
      // one source of truth: the plan icon's primitive count matches the
      // picker preview built from the same key
      defsMatch: dom.every((g) => {
        const id = g.getAttribute('data-annotation-id');
        const key = s.getAnnotation(id).data.symbolKey;
        const planIcon = g.querySelector('svg.wm-symbol-icon');
        const preview = s.createSymbolPreview(key, 36);
        return planIcon && planIcon.childNodes.length === preview.childNodes.length
          && planIcon.getAttribute('viewBox') === preview.getAttribute('viewBox');
      }),
      idsHidden: dom.every((g) => {
        const txt = g.textContent || '';
        return txt.indexOf('sym-') === -1;   // no internal ids user-visible
      }),
    };
  });

  // ── unknown symbolKey: placeholder, no crash, still selectable ──
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    await db.putAnnotation(WM.model.createAnnotation({ id: 'future1', sheetId: 'sy1',
      type: 'symbol', at: { x: 0.9, y: 0.9 }, now: Date.now(),
      data: { symbolKey: 'device.fromTheFuture' } }));
    db.closeDatabase();
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);
  R.unknown = await page.evaluate(async () => {
    const g = document.querySelector('.wm-symbol[data-annotation-id="future1"]');
    window.__wmStage.selectSymbol('future1');
    await new Promise((r) => setTimeout(r, 100));
    const anns = await window.__sy.anns();
    return { rendered: !!g,
      placeholder: !!(g && g.textContent.indexOf('?') !== -1),
      selected: window.__wmStage.getSelectedSymbol() === 'future1',
      stillStored: anns.some((a) => a.id === 'future1'),
      total: anns.length };
  });
  await page.evaluate(() => window.__wmStage.selectSymbol(null));

  // ── constant screen size at fit / 1× / 4× / 8× ──
  const measureSymbol = (key) => page.evaluate((k) => {
    const s = window.__wmStage;
    let target = null;
    document.querySelectorAll('#wm-symbols .wm-symbol').forEach((g) => {
      const a = s.getAnnotation(g.getAttribute('data-annotation-id'));
      if (a && a.data.symbolKey === k) target = { g, a };
    });
    if (!target) return null;
    // The nested-SVG viewport is sized in explicit stage units (attribute
    // width = SYMBOL_SIZE_PX / scale) and rides the ONE stage transform, so
    // its on-screen size is attribute × scale. getBoundingClientRect on an
    // inner <svg> reports the CONTENT bbox in Chromium, so the viewport
    // square is verified through the same arithmetic the renderer uses —
    // and the content bbox doubles as a "fits inside ~24px" sanity bound.
    const iconEl = target.g.querySelector('svg.wm-symbol-icon');
    const scale = s.getViewport().scale;
    const w = parseFloat(iconEl.getAttribute('width')) * scale;
    const h = parseFloat(iconEl.getAttribute('height')) * scale;
    const content = iconEl.getBoundingClientRect();
    const hit = target.g.querySelector('.wm-symbol-hit').getBoundingClientRect();
    const anchorScreen = WM.viewport.stageToScreen(
      WM.geometry.denormalizePoint(target.a.at, s.getStageSize()), s.getViewport());
    const cx = parseFloat(iconEl.getAttribute('x')) + parseFloat(iconEl.getAttribute('width')) / 2;
    const cy = parseFloat(iconEl.getAttribute('y')) + parseFloat(iconEl.getAttribute('height')) / 2;
    const centerScreen = WM.viewport.stageToScreen({ x: cx, y: cy }, s.getViewport());
    return { w, h, hitW: hit.width, hitH: hit.height,
      contentFits: content.width <= 25 && content.height <= 25
        && content.width > 4 && content.height > 4,
      noVectorEffect: !target.g.querySelector('[vector-effect]'),
      drift: Math.hypot(centerScreen.x - anchorScreen.x, centerScreen.y - anchorScreen.y) };
  }, key);
  const setZoom = (z) => page.evaluate((zz) => {
    const s = window.__wmStage;
    const el = document.getElementById('wm-viewport').getBoundingClientRect();
    if (zz === 'fit') { s.fit(); } else {
      s._setViewport(WM.viewport.centerOnNormalized({ x: 0.5, y: 0.5 }, s.getStageSize(),
        { width: el.width, height: el.height }, s.getViewport(), zz));
    }
    s.renderLabels();
  }, z);

  R.sizes = {};
  for (const z of ['fit', 1, 4, 8]) {
    await setZoom(z);
    await page.waitForTimeout(120);
    R.sizes[z] = {};
    for (const k of ['outlet.duplex', 'switch.threeWay', 'light.ceiling', 'device.smoke']) {
      R.sizes[z][k] = await measureSymbol(k);
    }
  }
  // selection outline padding constant across zoom
  R.outline = {};
  await page.evaluate(() => window.__wmStage.selectSymbol(
    document.querySelector('#wm-symbols .wm-symbol').getAttribute('data-annotation-id')));
  for (const z of [1, 8]) {
    await setZoom(z);
    await page.waitForTimeout(120);
    R.outline[z] = await page.evaluate(() => {
      const box = document.querySelector('.wm-symbol-selection');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
  }
  await page.evaluate(() => window.__wmStage.selectSymbol(null));

  // ── revised-library: 24px raster distinguishability of close families ──
  R.distinct = await page.evaluate(async () => {
    const s = window.__wmStage;
    const raster = (k) => new Promise((res) => {
      // Rasterize the SAME definition the plan uses, at exactly 24 px, with
      // the page's stroke/glyph styling inlined (a serialized SVG loses the
      // stylesheet).
      const svg = s.createSymbolPreview(k, 24);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.querySelectorAll('.wm-symbol-stroke').forEach((n) => {
        n.setAttribute('fill', 'none'); n.setAttribute('stroke', '#000');
        n.setAttribute('stroke-width', '1.6');
      });
      svg.querySelectorAll('.wm-symbol-glyph').forEach((n) => {
        n.setAttribute('fill', '#000');
        n.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
        n.setAttribute('font-weight', '700');
      });
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 24; c.height = 24;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 24, 24);
        res(g.getImageData(0, 0, 24, 24).data);
      };
      img.onerror = () => res(null);
      img.src = 'data:image/svg+xml;charset=utf-8,'
        + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    });
    const cmp = async (k1, k2) => {
      const a = await raster(k1); const b = await raster(k2);
      if (!a || !b) return { ok: false, why: 'raster failed' };
      let diff = 0; let inkA = 0; let inkB = 0;
      for (let i = 3; i < a.length; i += 4) {
        if (a[i] > 40) inkA++;
        if (b[i] > 40) inkB++;
        if (Math.abs(a[i] - b[i]) > 60) diff++;
      }
      // both draw something, and enough pixels differ to read at arm's length
      return { ok: inkA >= 20 && inkB >= 20 && diff >= 12, diff, inkA, inkB };
    };
    return {
      simplexVsDuplex: await cmp('outlet.simplex', 'outlet.duplex'),
      duplexVsGfci: await cmp('outlet.duplex', 'outlet.gfci'),
      duplexVsDedicated: await cmp('outlet.duplex', 'outlet.dedicated'),
      gfciVsDedicated: await cmp('outlet.gfci', 'outlet.dedicated'),
      singleVsThreeWay: await cmp('switch.single', 'switch.threeWay'),
      threeWayVsFourWay: await cmp('switch.threeWay', 'switch.fourWay'),
    };
  });

  // ── revised-library: S / S3 / S4 stay readable at fit / 1× / 4× / 8× ──
  R.sReadable = {};
  for (const z of ['fit', 1, 4, 8]) {
    await setZoom(z);
    await page.waitForTimeout(120);
    R.sReadable[z] = await page.evaluate(() => {
      const s = window.__wmStage;
      const out = {};
      document.querySelectorAll('#wm-symbols .wm-symbol').forEach((g) => {
        const a = s.getAnnotation(g.getAttribute('data-annotation-id'));
        if (!a || a.data.symbolKey.indexOf('switch.') !== 0) return;
        const icon = g.querySelector('svg.wm-symbol-icon');
        const glyphs = Array.from(icon.querySelectorAll('.wm-symbol-glyph'))
          .map((t) => t.textContent).join('');
        const box = icon.getBoundingClientRect();   // content bbox in Chromium
        out[a.data.symbolKey] = { glyphs,
          drawn: box.width > 6 && box.width <= 25.5 && box.height > 6
            && box.height <= 25.5 };
      });
      return out;
    });
  }
  await setZoom('fit');
  await page.waitForTimeout(120);

  // ── density: ≥20 symbols, responsive gestures, invisible hit areas ──
  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    const keys = WM.symbols.list().map((s) => s.key);
    for (let i = 0; i < 14; i++) {
      await db.putAnnotation(WM.model.createAnnotation({ id: 'dense' + i, sheetId: 'sy1',
        type: 'symbol', at: { x: 0.08 + (i % 7) * 0.13, y: 0.15 + Math.floor(i / 7) * 0.5 },
        now, data: { symbolKey: keys[i % keys.length] } }));
    }
    db.closeDatabase();
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(600);
  R.density = await page.evaluate(() => {
    const s = window.__wmStage;
    const nodes = document.querySelectorAll('#wm-symbols .wm-symbol');
    const hits = document.querySelectorAll('#wm-symbols .wm-symbol-hit');
    let invisible = true;
    hits.forEach((h) => {
      const cs = getComputedStyle(h);
      if (!(cs.fill === 'rgba(0, 0, 0, 0)' || cs.fill === 'transparent')) invisible = false;
    });
    const t0 = performance.now();
    const vpEl = document.getElementById('wm-viewport');
    const el = vpEl.getBoundingClientRect();
    const send = (t, id, x, y) => vpEl.dispatchEvent(new PointerEvent(t, { pointerId: id,
      clientX: el.left + x, clientY: el.top + y, bubbles: true, pointerType: 'touch' }));
    send('pointerdown', 931, 130, 300); send('pointerdown', 932, 230, 300);
    for (let d = 10; d <= 100; d += 10) send('pointermove', 932, 230 + d, 300);
    send('pointerup', 931, 130, 300); send('pointerup', 932, 330, 300);
    const pinchMs = performance.now() - t0;
    s.fit(); s.renderLabels();
    return { count: nodes.length, hitsInvisible: invisible, pinchMs,
      pointers: s.getActivePointers() };
  });

  await ctx.close();
  await browser.close();

  const near24 = (v) => v > 22 && v < 26.5;
  const hit44 = (v) => v > 42.5;
  const allEightStored = R.allEight.stored.filter((a) => a.type === 'symbol');
  const vpOk = (m) => m && !m.docOverflow && m.panelFits && m.cardsInScroller
    && m.closeVisible && m.btnVisible && m.cards.length === 11
    && m.cards.every((c) => c.iconVisible);
  const sizeOk = (m) => m && near24(m.w) && near24(m.h) && hit44(m.hitW) && hit44(m.hitH)
    && m.contentFits && m.noVectorEffect && m.drift < 1.5;

  const checks = [
    ['the picker shows all 11 symbols in the four sections with real previews',
      R.picker.cards.length === 11
        && JSON.stringify(R.picker.sections) === JSON.stringify(['Outlets', 'Switches', 'Lighting', 'Devices'])
        && R.picker.cards.every((c) => c.iconVisible && c.iconPrimitives > 0
          && c.name.length > 0)],
    ['picker fits 390×844 portrait with no horizontal overflow', vpOk(R.viewports.p390)],
    ['picker fits 375×667 portrait', vpOk(R.viewports.p375)],
    ['picker fits 844×390 landscape', vpOk(R.viewports.l844)],
    ['closing the picker leaves no backdrop and no stale symbol mode',
      R.afterClose.blocked === false && R.afterClose.armed === null],
    ['pan and pinch work right after closing the picker',
      R.afterClosePan.panned && R.afterClosePan.pinched && R.afterClosePan.pointers === 0],
    ['choosing a card closes the picker, arms that key, and shows the hint',
      R.armed.key === 'outlet.duplex' && R.armed.pickerClosed === true
        && R.armed.hint.indexOf('Duplex Receptacle') !== -1],
    ['one empty tap places exactly ONE symbol and exits the mode',
      R.placedOnce.anns.length === 1
        && R.placedOnce.anns[0].type === 'symbol'
        && R.placedOnce.anns[0].data.symbolKey === 'outlet.duplex'
        && R.placedOnce.armed === null && R.placedOnce.hintHidden === true],
    ['the NEXT empty tap does not create another symbol',
      R.secondTap.length === 1],
    ['all 11 symbols persist with correct type, key and normalized anchor',
      allEightStored.length === 11 && allEightStored.every((a) => a.okAt)
        && new Set(allEightStored.map((a) => a.key)).size === 11],
    ['all 11 render in the wm-symbols layer from the SAME definitions as the previews',
      R.allEight.domCount === 11 && R.allEight.defsMatch === true
        && R.allEight.idsHidden === true],
    ['an unknown persisted key renders the ? placeholder, stays stored and selectable',
      R.unknown.rendered && R.unknown.placeholder && R.unknown.selected
        && R.unknown.stillStored],
    ['symbols hold ~24px with ≥44px hit targets and ~zero anchor drift at fit',
      ['outlet.duplex', 'switch.threeWay', 'light.ceiling', 'device.smoke']
        .every((k) => sizeOk(R.sizes.fit[k]))],
    ['…and at 1×', ['outlet.duplex', 'switch.threeWay', 'light.ceiling', 'device.smoke']
      .every((k) => sizeOk(R.sizes[1][k]))],
    ['…and at 4×', ['outlet.duplex', 'switch.threeWay', 'light.ceiling', 'device.smoke']
      .every((k) => sizeOk(R.sizes[4][k]))],
    ['…and at 8×', ['outlet.duplex', 'switch.threeWay', 'light.ceiling', 'device.smoke']
      .every((k) => sizeOk(R.sizes[8][k]))],
    ['the selection outline keeps constant screen-space padding across zoom',
      R.outline[1] && R.outline[8]
        && Math.abs(R.outline[1].w - R.outline[8].w) < 2
        && R.outline[1].w > 28 && R.outline[1].w < 36],
    ['at 24px, Simplex reads differently from Duplex', R.distinct.simplexVsDuplex.ok],
    ['at 24px, Duplex reads differently from GFCI', R.distinct.duplexVsGfci.ok],
    ['at 24px, Duplex reads differently from Dedicated', R.distinct.duplexVsDedicated.ok],
    ['at 24px, GFCI reads differently from Dedicated', R.distinct.gfciVsDedicated.ok],
    ['at 24px, S reads differently from S3', R.distinct.singleVsThreeWay.ok],
    ['at 24px, S3 reads differently from S4', R.distinct.threeWayVsFourWay.ok],
    ['S / S3 / S4 stay drawn and readable at fit, 1×, 4× and 8×',
      ['fit', 1, 4, 8].every((z) => {
        const m = R.sReadable[z];
        return m && m['switch.single'] && m['switch.single'].glyphs === 'S'
          && m['switch.single'].drawn
          && m['switch.threeWay'] && m['switch.threeWay'].glyphs === 'S3'
          && m['switch.threeWay'].drawn
          && m['switch.fourWay'] && m['switch.fourWay'].glyphs === 'S4'
          && m['switch.fourWay'].drawn;
      })],
    ['20+ symbols on one sheet: gestures responsive, hit areas invisible',
      R.density.count >= 20 && R.density.hitsInvisible === true
        && R.density.pinchMs < 2000 && R.density.pointers === 0],
    ['no page errors through the symbols foundation flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-9A — Symbols interaction: tap-select, off-center no-jump drag with
// write accounting, delete, reload cycles, placement priority, iOS trains.
// ─────────────────────────────────────────────────────────────────────────
async function runSymbolsInteraction(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  await page.evaluate(async () => {
    // Account every annotation write/delete that reaches the store, across
    // every connection the page opens. Instrumentation only — behavior is
    // exactly the production path.
    window.__writes = [];
    window.__deletes = [];
    const orig = WM.store.createStore;
    WM.store.createStore = function () {
      const db = orig.apply(this, arguments);
      const put = db.putAnnotation;
      db.putAnnotation = function (a) { window.__writes.push(a.id); return put.call(db, a); };
      const del = db.deleteAnnotation;
      db.deleteAnnotation = function (id) { window.__deletes.push(id); return del.call(db, id); };
      return db;
    };
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'sij', name: 'SymInt', now }));
    await db.putSheet(WM.model.createSheet({ id: 'si1', jobId: 'sij', name: 'Int Blank',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.putAnnotation(WM.model.createAnnotation({ id: 'symA', sheetId: 'si1',
      type: 'symbol', at: { x: 0.5, y: 0.35 }, now, data: { symbolKey: 'outlet.duplex' } }));
    await db.setMeta('currentSheetId', 'si1');
    db.closeDatabase();
    window.__writes.length = 0;
    window.__si = {
      screenOf(id) {
        const s = window.__wmStage;
        const a = s.getAnnotation(id);
        const p = WM.viewport.stageToScreen(
          WM.geometry.denormalizePoint(a.at, s.getStageSize()), s.getViewport());
        const r = document.getElementById('wm-viewport').getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y, local: p };
      },
      send(t, id, x, y, type) {
        const target = document.elementFromPoint(x, y)
          || document.getElementById('wm-viewport');
        target.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y,
          bubbles: true, pointerType: type || 'touch' }));
      },
      async anns(sheet) {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const a = await db2.listAnnotations(sheet || 'si1'); db2.closeDatabase(); return a;
      },
    };
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);
  const R = {};

  // ── D-equivalent + baseline: touch tap selects; compat mouse pair is one gesture ──
  R.tapSelect = await page.evaluate(async () => {
    const s = window.__wmStage;
    const p = window.__si.screenOf('symA');
    window.__si.send('pointerdown', 41, p.x, p.y, 'touch');
    window.__si.send('pointerup', 41, p.x, p.y, 'touch');
    await new Promise((r) => setTimeout(r, 120));
    const afterTouch = { selected: s.getSelectedSymbol(),
      outlines: document.querySelectorAll('.wm-symbol-selection').length,
      deleteVisible: !document.getElementById('wm-delete-symbol').hidden,
      anchor: { ...s.getAnnotation('symA').at } };
    // WebKit's synthesised mouse pair, ~same point, inside the window — one
    // physical gesture must yield ONE selection and change nothing further.
    window.__si.send('pointerdown', 42, p.x + 2, p.y + 1, 'mouse');
    window.__si.send('pointerup', 42, p.x + 2, p.y + 1, 'mouse');
    await new Promise((r) => setTimeout(r, 120));
    const a = s.getAnnotation('symA').at;
    return { afterTouch,
      stillSelected: s.getSelectedSymbol() === 'symA',
      outlinesAfterPair: document.querySelectorAll('.wm-symbol-selection').length,
      anchorUntouched: a.x === afterTouch.anchor.x && a.y === afterTouch.anchor.y };
  });

  // ── E: off-center drag — no jump, offset preserved, one write, plan still ──
  R.drag = await page.evaluate(async () => {
    const s = window.__wmStage;
    window.__writes.length = 0;
    const before = s.getViewport();
    const start = window.__si.screenOf('symA');
    const anchor0 = { ...s.getAnnotation('symA').at };
    // grab 10px right, 6px below the center — deliberately off-center
    const gx = start.x + 10; const gy = start.y + 6;
    window.__si.send('pointerdown', 51, gx, gy, 'touch');
    const samples = [];
    const moves = [[6, 0], [14, 4], [40, 18], [80, 36], [120, 50]];
    for (const [dx, dy] of moves) {
      window.__si.send('pointermove', 51, gx + dx, gy + dy, 'touch');
      const p = window.__si.screenOf('symA');
      samples.push({ dx, dy, offX: (gx + dx) - p.x, offY: (gy + dy) - p.y,
        centerMovedX: p.x - start.x, centerMovedY: p.y - start.y });
    }
    window.__si.send('pointerup', 51, gx + 120, gy + 50, 'touch');
    await new Promise((r) => setTimeout(r, 150));
    // trailing compatibility mouse pair after the drag
    window.__si.send('pointerdown', 52, gx + 120, gy + 50, 'mouse');
    window.__si.send('pointerup', 52, gx + 120, gy + 50, 'mouse');
    await new Promise((r) => setTimeout(r, 350));
    const after = s.getViewport();
    const anns = await window.__si.anns();
    const stored = anns.find((a) => a.id === 'symA');
    // offset at the first committed sample vs the last: preserved?
    const committed = samples.filter((sm) => Math.hypot(sm.dx, sm.dy) >= 9);
    const first = committed[0]; const last = committed[committed.length - 1];
    return {
      beforeDrag: samples[0],                       // below threshold: untouched
      offsetDeltaX: Math.abs(last.offX - first.offX),
      offsetDeltaY: Math.abs(last.offY - first.offY),
      stageStill: after.scale === before.scale
        && after.translateX === before.translateX
        && after.translateY === before.translateY,
      writes: window.__writes.slice(),
      storedMoved: stored && (stored.at.x !== anchor0.x || stored.at.y !== anchor0.y),
      storedKey: stored && stored.data.symbolKey,
      liveMatchesStored: stored
        && Math.abs(s.getAnnotation('symA').at.x - stored.at.x) < 1e-9
        && Math.abs(s.getAnnotation('symA').at.y - stored.at.y) < 1e-9,
    };
  });

  // ── pointercancel restores the stored anchor, zero writes ──
  R.cancel = await page.evaluate(async () => {
    const s = window.__wmStage;
    window.__writes.length = 0;
    const orig = { ...s.getAnnotation('symA').at };
    const p = window.__si.screenOf('symA');
    window.__si.send('pointerdown', 61, p.x, p.y, 'touch');
    window.__si.send('pointermove', 61, p.x + 60, p.y + 30, 'touch');
    window.__si.send('pointermove', 61, p.x + 90, p.y + 60, 'touch');
    const midDrag = { ...s.getAnnotation('symA').at };
    document.getElementById('wm-viewport').dispatchEvent(
      new PointerEvent('pointercancel', { pointerId: 61, bubbles: true, pointerType: 'touch' }));
    await new Promise((r) => setTimeout(r, 200));
    const now = s.getAnnotation('symA').at;
    const anns = await window.__si.anns();
    const stored = anns.find((a) => a.id === 'symA');
    return { movedDuring: midDrag.x !== orig.x,
      revertedLive: now.x === orig.x && now.y === orig.y,
      revertedStored: stored.at.x === orig.x && stored.at.y === orig.y,
      writes: window.__writes.length };
  });

  // ── F: Delete Symbol — one deletion, then a fresh touch still works ──
  R.del = await page.evaluate(async () => {
    const s = window.__wmStage;
    window.__deletes.length = 0;
    const p = window.__si.screenOf('symA');
    window.__si.send('pointerdown', 71, p.x, p.y, 'touch');
    window.__si.send('pointerup', 71, p.x, p.y, 'touch');
    await new Promise((r) => setTimeout(r, 120));
    document.getElementById('wm-delete-symbol').click();
    await new Promise((r) => setTimeout(r, 350));
    const anns = await window.__si.anns();
    return { deletes: window.__deletes.slice(),
      gone: !anns.some((a) => a.id === 'symA'),
      domGone: !document.querySelector('.wm-symbol[data-annotation-id="symA"]'),
      buttonHidden: document.getElementById('wm-delete-symbol').hidden,
      selected: s.getSelectedSymbol() };
  });

  // ── A/B/C trains: full touch trains through picker → exactly one placement ──
  R.abc = await page.evaluate(async () => {
    const clickTrain = (el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      const o = (t, type) => new PointerEvent(t, { pointerId: 81, clientX: x, clientY: y,
        bubbles: true, pointerType: type });
      el.dispatchEvent(o('pointerdown', 'touch'));
      el.dispatchEvent(o('pointerup', 'touch'));
      el.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
    };
    clickTrain(document.getElementById('wm-symbols-open'));
    await new Promise((r) => setTimeout(r, 150));
    const openOnce = !document.getElementById('wm-sympicker').hidden;
    clickTrain(document.querySelector('.symcard[data-symbol-key="device.smoke"]'));
    await new Promise((r) => setTimeout(r, 150));
    const s = window.__wmStage;
    const armedOnce = s.activeSymbolKey() === 'device.smoke'
      && document.getElementById('wm-sympicker').hidden;
    // C: one physical touch tap on empty plan + its synthesised mouse pair
    const vr = document.getElementById('wm-viewport').getBoundingClientRect();
    const x = vr.left + vr.width * 0.78; const y = vr.top + vr.height * 0.5;
    window.__si.send('pointerdown', 82, x, y, 'touch');
    window.__si.send('pointerup', 82, x, y, 'touch');
    await new Promise((r) => setTimeout(r, 120));
    window.__si.send('pointerdown', 83, x + 1, y + 1, 'mouse');
    window.__si.send('pointerup', 83, x + 1, y + 1, 'mouse');
    await new Promise((r) => setTimeout(r, 400));
    const anns = await window.__si.anns();
    const smokes = anns.filter((a) => a.type === 'symbol'
      && a.data.symbolKey === 'device.smoke');
    // a fresh legitimate touch afterwards still works: tap the new symbol
    const created = smokes[0];
    let freshWorks = false;
    if (created) {
      const p = window.__si.screenOf(created.id);
      window.__si.send('pointerdown', 84, p.x, p.y, 'touch');
      window.__si.send('pointerup', 84, p.x, p.y, 'touch');
      await new Promise((r) => setTimeout(r, 120));
      freshWorks = s.getSelectedSymbol() === created.id;
      s.selectSymbol(null);
    }
    return { openOnce, armedOnce, smokeCount: smokes.length,
      disarmed: s.activeSymbolKey() === null, freshWorks };
  });

  // ── reload cycles: create → returns; move → new position; delete → gone ──
  await page.evaluate(async () => {
    const s = window.__wmStage;
    s.armSymbol('light.recessed');
    const r = document.getElementById('wm-viewport').getBoundingClientRect();
    const x = r.left + r.width * 0.22; const y = r.top + r.height * 0.68;
    window.__si.send('pointerdown', 91, x, y, 'touch');
    window.__si.send('pointerup', 91, x, y, 'touch');
  });
  await page.waitForTimeout(400);
  const cyc1 = await page.evaluate(async () => {
    const anns = await window.__si.anns();
    const r = anns.find((a) => a.type === 'symbol' && a.data.symbolKey === 'light.recessed');
    return r ? { id: r.id, at: r.at } : null;
  });
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((res) => {
    const tick = () => (window.__wmStage ? res() : setTimeout(tick, 50));
    tick();
  }));
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);
  R.reload1 = await page.evaluate(async (c) => {
    if (!c) return { back: false, rendered: false, sameAnchor: false, sameKey: false };
    const db = WM.store.createStore(); await db.openDatabase();
    const anns = await db.listAnnotations('si1'); db.closeDatabase();
    const r = anns.find((a) => a.id === c.id);
    const g = document.querySelector('.wm-symbol[data-annotation-id="' + c.id + '"]');
    return { back: !!r, rendered: !!g,
      sameAnchor: r && r.at.x === c.at.x && r.at.y === c.at.y,
      sameKey: r && r.data.symbolKey === 'light.recessed' };
  }, cyc1);
  // move it, reload, position persists
  await page.evaluate(async (c) => {
    if (!c) return;
    const s = window.__wmStage;
    const p = (function () {
      const a = s.getAnnotation(c.id);
      const q = WM.viewport.stageToScreen(
        WM.geometry.denormalizePoint(a.at, s.getStageSize()), s.getViewport());
      const r = document.getElementById('wm-viewport').getBoundingClientRect();
      return { x: r.left + q.x, y: r.top + q.y };
    })();
    const send = (t, x, y) => (document.elementFromPoint(x, y)
      || document.getElementById('wm-viewport'))
      .dispatchEvent(new PointerEvent(t, { pointerId: 95, clientX: x, clientY: y,
        bubbles: true, pointerType: 'touch' }));
    send('pointerdown', p.x, p.y);
    send('pointermove', p.x + 50, p.y - 40);
    send('pointermove', p.x + 70, p.y - 60);
    send('pointerup', p.x + 70, p.y - 60);
  }, cyc1);
  await page.waitForTimeout(400);
  const movedAt = await page.evaluate(async (c) => {
    if (!c) return null;
    const db = WM.store.createStore(); await db.openDatabase();
    const anns = await db.listAnnotations('si1'); db.closeDatabase();
    const r = anns.find((a) => a.id === c.id);
    return r ? r.at : null;
  }, cyc1);
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((res) => {
    const tick = () => (window.__wmStage ? res() : setTimeout(tick, 50));
    tick();
  }));
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);
  R.reload2 = await page.evaluate(async ({ c, m }) => {
    if (!c || !m) return { changed: false, persisted: false };
    const db = WM.store.createStore(); await db.openDatabase();
    const anns = await db.listAnnotations('si1'); db.closeDatabase();
    const r = anns.find((a) => a.id === c.id);
    const changed = m.x !== c.at.x || m.y !== c.at.y;
    return { changed, persisted: r && r.at.x === m.x && r.at.y === m.y };
  }, { c: cyc1, m: movedAt });
  // delete, reload, stays gone
  await page.evaluate(async (c) => {
    if (!c) return;
    const db = WM.store.createStore(); await db.openDatabase();
    await db.deleteAnnotation(c.id); db.closeDatabase();
  }, cyc1);
  await page.reload();
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((res) => {
    const tick = () => (window.__wmStage ? res() : setTimeout(tick, 50));
    tick();
  }));
  await page.click('#wm-dev-load');
  await page.waitForTimeout(500);
  R.reload3 = await page.evaluate(async (c) => {
    if (!c) return { gone: false, domGone: false };
    const db = WM.store.createStore(); await db.openDatabase();
    const anns = await db.listAnnotations('si1'); db.closeDatabase();
    return { gone: !anns.some((a) => a.id === c.id),
      domGone: !document.querySelector('.wm-symbol[data-annotation-id="' + c.id + '"]') };
  }, cyc1);

  await ctx.close();
  await browser.close();

  const checks = [
    ['a touch tap selects the symbol once; the synthesised mouse pair changes nothing',
      R.tapSelect.afterTouch.selected === 'symA'
        && R.tapSelect.afterTouch.outlines === 1
        && R.tapSelect.afterTouch.deleteVisible
        && R.tapSelect.stillSelected
        && R.tapSelect.outlinesAfterPair === 1
        && R.tapSelect.anchorUntouched],
    ['below the 8px threshold the symbol has not moved',
      R.drag.beforeDrag.dx === 6
        && Math.abs(R.drag.beforeDrag.centerMovedX) < 0.5
        && Math.abs(R.drag.beforeDrag.centerMovedY) < 0.5],
    ['the off-center grab offset is preserved from commit to release — no jump',
      R.drag.offsetDeltaX < 1.5 && R.drag.offsetDeltaY < 1.5],
    ['the plan does not pan underneath a symbol drag', R.drag.stageStill === true],
    ['a full drag persists exactly ONE write for the same annotation, key unchanged',
      R.drag.writes.length === 1 && R.drag.writes[0] === 'symA'
        && R.drag.storedMoved === true && R.drag.storedKey === 'outlet.duplex'
        && R.drag.liveMatchesStored === true],
    ['pointercancel restores the stored anchor with ZERO writes',
      R.cancel.movedDuring && R.cancel.revertedLive && R.cancel.revertedStored
        && R.cancel.writes === 0],
    ['Delete Symbol removes exactly the selected symbol and hides itself',
      R.del.deletes.length === 1 && R.del.deletes[0] === 'symA'
        && R.del.gone && R.del.domGone && R.del.buttonHidden
        && R.del.selected === null],
    ['iOS trains: one modal open, one armed key, exactly ONE symbol from tap+compat pair',
      R.abc.openOnce && R.abc.armedOnce && R.abc.smokeCount === 1 && R.abc.disarmed],
    ['a fresh legitimate touch after the trains still works normally',
      R.abc.freshWorks === true],
    ['created symbol returns after reload with the same id, key and anchor',
      R.reload1.back && R.reload1.rendered && R.reload1.sameAnchor && R.reload1.sameKey],
    ['a moved symbol returns after reload at its NEW anchor',
      R.reload2.changed && R.reload2.persisted],
    ['a deleted symbol stays gone after reload', R.reload3.gone && R.reload3.domGone],
    ['no page errors through the symbol interaction flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

// ─────────────────────────────────────────────────────────────────────────
// WM-9A — Symbols isolation: placement priority over every annotation type,
// overlap ownership, Sheet A/B isolation, armed/selected sheet-switch
// safety, the Photo→Blank→Photo regression via the CORRECT production
// photo workflow, and Wire Lookup exclusion.
// ─────────────────────────────────────────────────────────────────────────
async function runSymbolsIsolation(engineName, engine) {
  let browser;
  try {
    browser = await engine.launch();
  } catch (e) {
    return { engine: engineName, available: false, reason: e.message.split('\n')[0] };
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await page.goto(APP);

  await page.evaluate(async () => {
    const db = WM.store.createStore(); await db.openDatabase();
    const now = Date.now();
    await db.putJob(WM.model.createJob({ id: 'isoj', name: 'Iso Job', now }));
    await db.putSheet(WM.model.createSheet({ id: 'isoA', jobId: 'isoj', name: 'Iso A',
      kind: 'blank', width: 2000, height: 1500, order: 0, now }));
    await db.putSheet(WM.model.createSheet({ id: 'isoB', jobId: 'isoj', name: 'Iso B',
      kind: 'blank', width: 2000, height: 1500, order: 1, now }));
    const ann = (id, sheetId, over) => WM.model.createAnnotation(
      Object.assign({ id, sheetId, now }, over));
    // Sheet A: Duplex + Ceiling, plus one of every other annotation type at
    // DISTINCT points for the armed-priority taps, plus overlap pairs.
    const putA = [
      ann('aDup', 'isoA', { type: 'symbol', at: { x: 0.15, y: 0.2 },
        data: { symbolKey: 'outlet.duplex' } }),
      ann('aCeil', 'isoA', { type: 'symbol', at: { x: 0.85, y: 0.2 },
        data: { symbolKey: 'light.ceiling' } }),
      ann('aLbl', 'isoA', { type: 'wireLabel', at: { x: 0.35, y: 0.2 },
        data: { label: 'HR-9' } }),
      ann('aArw', 'isoA', { type: 'arrow', a: { x: 0.45, y: 0.35 },
        b: { x: 0.65, y: 0.35 } }),
      ann('aLine', 'isoA', { type: 'line', a: { x: 0.1, y: 0.5 },
        b: { x: 0.3, y: 0.5 } }),
      ann('aRect', 'isoA', { type: 'rect', a: { x: 0.4, y: 0.45 },
        b: { x: 0.55, y: 0.6 } }),
      ann('aTxt', 'isoA', { type: 'text', at: { x: 0.75, y: 0.5 },
        data: { text: 'Panel' } }),
      // overlap pairs: a symbol centered ON a line and ON a rect
      ann('ovLine', 'isoA', { type: 'line', a: { x: 0.1, y: 0.8 },
        b: { x: 0.3, y: 0.8 } }),
      ann('ovLineSym', 'isoA', { type: 'symbol', at: { x: 0.2, y: 0.8 },
        data: { symbolKey: 'device.thermostat' } }),
      ann('ovRect', 'isoA', { type: 'rect', a: { x: 0.55, y: 0.72 },
        b: { x: 0.75, y: 0.88 } }),
      ann('ovRectSym', 'isoA', { type: 'symbol', at: { x: 0.65, y: 0.8 },
        data: { symbolKey: 'switch.single' } }),
      // a Wire Label and an arrow midpoint sitting ON symbols
      ann('ovSymUnderLbl', 'isoA', { type: 'symbol', at: { x: 0.35, y: 0.65 },
        data: { symbolKey: 'outlet.gfci' } }),
      ann('ovLbl', 'isoA', { type: 'wireLabel', at: { x: 0.35, y: 0.65 },
        data: { label: 'HR-10' } }),
      ann('ovSymUnderArw', 'isoA', { type: 'symbol', at: { x: 0.88, y: 0.65 },
        data: { symbolKey: 'light.recessed' } }),
      ann('ovArw', 'isoA', { type: 'arrow', a: { x: 0.8, y: 0.65 },
        b: { x: 0.96, y: 0.65 } }),
      // Sheet B: 3-Way + Smoke
      ann('bThree', 'isoB', { type: 'symbol', at: { x: 0.3, y: 0.4 },
        data: { symbolKey: 'switch.threeWay' } }),
      ann('bSmoke', 'isoB', { type: 'symbol', at: { x: 0.7, y: 0.6 },
        data: { symbolKey: 'device.smoke' } }),
    ];
    for (const a of putA) {
      if (a.type === 'wireLabel') a.data.labelKey = WM.model.toLabelKey(a.data.label);
      await db.putAnnotation(a);
    }
    await db.setMeta('currentSheetId', 'isoA');
    db.closeDatabase();
    window.__iso = {
      screenOfNorm(n) {
        const s = window.__wmStage;
        const p = WM.viewport.stageToScreen(
          WM.geometry.denormalizePoint(n, s.getStageSize()), s.getViewport());
        const r = document.getElementById('wm-viewport').getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      },
      tap(x, y) {
        // Resolve the target PER EVENT, exactly as real hit-testing does: a
        // pointerdown that selects an annotation re-renders its layer, so the
        // element under the finger at release time is a REBUILT node. A real
        // pointerup follows capture/hit-testing to a live element; dispatching
        // on the stale pre-render node would silently vanish instead.
        const o = (t) => new PointerEvent(t, { pointerId: 601, clientX: x, clientY: y,
          bubbles: true, pointerType: 'touch' });
        (document.elementFromPoint(x, y) || document.getElementById('wm-viewport'))
          .dispatchEvent(o('pointerdown'));
        (document.elementFromPoint(x, y) || document.getElementById('wm-viewport'))
          .dispatchEvent(o('pointerup'));
      },
      closeModals() {
        ['wm-editor', 'wm-text-editor'].forEach((id) => {
          const m = document.getElementById(id);
          if (m && !m.hidden) {
            const btn = m.querySelector('#wm-editor-cancel, #wm-text-cancel');
            if (btn) btn.click(); else m.hidden = true;
          }
        });
      },
      async symbolsOn(sheetId) {
        const db2 = WM.store.createStore(); await db2.openDatabase();
        const a = await db2.listAnnotations(sheetId); db2.closeDatabase();
        return a.filter((x) => x.type === 'symbol').map((x) => x.id).sort();
      },
    };
  });
  await page.click('#wm-dev-load');
  await page.waitForTimeout(600);
  const R = {};

  // ── §43 placement priority: armed Duplex must never build on occupied ──
  R.priority = await page.evaluate(async () => {
    const s = window.__wmStage;
    const before = (await window.__iso.symbolsOn('isoA')).length;
    s.armSymbol('outlet.duplex');
    const targets = [
      ['wireLabel', { x: 0.35, y: 0.2 }],
      ['arrow', { x: 0.55, y: 0.35 }],          // shaft midpoint
      ['arrowEndpoint', { x: 0.45, y: 0.35 }],  // endpoint handle a
      ['line', { x: 0.2, y: 0.5 }],
      ['rect', { x: 0.475, y: 0.45 }],          // rect top edge
      ['text', { x: 0.75, y: 0.5 }],
      ['symbol', { x: 0.85, y: 0.2 }],
    ];
    const still = [];
    for (const [what, n] of targets) {
      const p = window.__iso.screenOfNorm(n);
      const tg = document.elementFromPoint(p.x, p.y);
      window.__iso.tap(p.x, p.y);
      await new Promise((r) => setTimeout(r, 200));
      window.__iso.closeModals();
      await new Promise((r) => setTimeout(r, 120));
      const count = (await window.__iso.symbolsOn('isoA')).length;
      still.push({ what, count, armed: s.activeSymbolKey(),
        hit: tg ? (tg.tagName + '.' + (tg.getAttribute('class') || '')) : 'null',
        modals: ['wm-editor', 'wm-text-editor', 'wm-sheets', 'wm-sympicker']
          .filter((id) => !document.getElementById(id).hidden) });
    }
    // …and a genuinely empty logical-sheet point places exactly one
    const empty = window.__iso.screenOfNorm({ x: 0.6, y: 0.12 });
    const emptyHit = document.elementFromPoint(empty.x, empty.y);
    window.__iso.tap(empty.x, empty.y);
    await new Promise((r) => setTimeout(r, 400));
    const after = (await window.__iso.symbolsOn('isoA')).length;
    return { before, still, after, disarmed: s.activeSymbolKey() === null,
      emptyHit: emptyHit ? (emptyHit.tagName + '.' + (emptyHit.getAttribute('class') || '')) : 'null' };
  });

  // ── §37 overlap ownership at shared points (no arming) ──
  R.overlap = await page.evaluate(async () => {
    const s = window.__wmStage;
    const probe = async (n) => {
      // Clear EVERY selection family first: earlier probe sections may have
      // legitimately left an arrow/sketch selected (families select
      // independently, as they always have), and this probe must assert what
      // THIS tap selects — not what history left behind.
      s.selectSymbol(null);
      if (s.selectArrow) s.selectArrow(null);
      if (s.selectSketch) s.selectSketch(null);
      await new Promise((r) => setTimeout(r, 80));
      const p = window.__iso.screenOfNorm(n);
      window.__iso.tap(p.x, p.y);
      await new Promise((r) => setTimeout(r, 200));
      window.__iso.closeModals();
      const winner = {
        symbol: s.getSelectedSymbol(),
        arrow: s.getSelectedArrow ? s.getSelectedArrow() : null,
        sketch: s.getSelectedSketch ? s.getSelectedSketch() : null,
      };
      s.selectSymbol(null);
      if (s.selectArrow) s.selectArrow(null);
      if (s.selectSketch) s.selectSketch(null);
      await new Promise((r) => setTimeout(r, 80));
      return winner;
    };
    return {
      symbolOverLine: await probe({ x: 0.2, y: 0.8 }),
      symbolOverRect: await probe({ x: 0.65, y: 0.8 }),
      labelOverSymbol: await (async () => {
        // a tap on the label opens the editor; ownership shows as NO symbol
        // selection and the editor appearing
        s.selectSymbol(null);
        const p = window.__iso.screenOfNorm({ x: 0.35, y: 0.65 });
        window.__iso.tap(p.x, p.y);
        await new Promise((r) => setTimeout(r, 250));
        const editorOpen = !document.getElementById('wm-editor').hidden;
        window.__iso.closeModals();
        return { editorOpen, symbol: s.getSelectedSymbol() };
      })(),
      arrowOverSymbol: await probe({ x: 0.88, y: 0.65 }),
    };
  });

  // ── A → B → A: only current-sheet symbols, no stale state ──
  const switchTo = async (name) => {
    await page.evaluate(() => { document.getElementById('wm-sheets').hidden = true; });
    await page.click('#wm-sheets-open');
    await page.waitForTimeout(300);
    await page.evaluate((n) => {
      Array.from(document.querySelectorAll('.sheet-row'))
        .find((r) => r.querySelector('.sheet-name').textContent.indexOf(n) === 0)
        .querySelector('.sheet-main').click();
    }, name);
    await page.waitForTimeout(700);
  };
  const domSymbols = () => page.evaluate(() =>
    Array.from(document.querySelectorAll('#wm-symbols .wm-symbol'))
      .map((g) => g.getAttribute('data-annotation-id')).sort());

  await page.evaluate(() => window.__wmStage.selectSymbol('aDup'));
  await page.waitForTimeout(150);
  await switchTo('Iso B');
  R.onB = {
    dom: await domSymbols(),
    state: await page.evaluate(() => ({
      selected: window.__wmStage.getSelectedSymbol(),
      armed: window.__wmStage.activeSymbolKey(),
      outline: !!document.querySelector('.wm-symbol-selection'),
      deleteHidden: document.getElementById('wm-delete-symbol').hidden })),
  };
  await switchTo('Iso A');
  R.backOnA = { dom: await domSymbols() };

  // ── armed GFCI + manual sheet switch: mode must clear, no phantom ──
  await page.evaluate(() => window.__wmStage.armSymbol('outlet.gfci'));
  await switchTo('Iso B');
  R.armedSwitch = await page.evaluate(async () => {
    const s = window.__wmStage;
    const armedAfter = s.activeSymbolKey();
    const hintHidden = document.getElementById('wm-symbol-hint').hidden;
    const beforeB = await window.__iso.symbolsOn('isoB');
    const r = document.getElementById('wm-viewport').getBoundingClientRect();
    window.__iso.tap(r.left + r.width * 0.5, r.top + r.height * 0.15);
    await new Promise((rr) => setTimeout(rr, 350));
    const afterB = await window.__iso.symbolsOn('isoB');
    const anywhere = (await window.__iso.symbolsOn('isoA')).length
      + afterB.length;
    return { armedAfter, hintHidden, placedOnB: afterB.length - beforeB.length,
      totalNow: anywhere };
  });

  // ── selected Duplex + switch: forced Delete must NOT cross sheets ──
  await switchTo('Iso A');
  await page.evaluate(() => window.__wmStage.selectSymbol('aDup'));
  await page.waitForTimeout(150);
  await switchTo('Iso B');
  R.forcedDelete = await page.evaluate(async () => {
    const s = window.__wmStage;
    const cleared = s.getSelectedSymbol() === null;
    const hidden = document.getElementById('wm-delete-symbol').hidden;
    document.getElementById('wm-delete-symbol').click();   // forced
    await new Promise((r) => setTimeout(r, 350));
    const aSymbols = await window.__iso.symbolsOn('isoA');
    return { cleared, hidden, dupSurvives: aSymbols.indexOf('aDup') !== -1 };
  });

  await ctx.close();
  await browser.close();

  const pri = R.priority;
  const checks = [
    ['an armed symbol never creates on top of ANY existing annotation',
      pri.still.every((s) => s.count === pri.before && s.armed === 'outlet.duplex')],
    ['after those occupied taps, one genuinely empty tap places exactly ONE',
      pri.after === pri.before + 1 && pri.disarmed],
    ['a symbol on a sketch line owns the tap',
      R.overlap.symbolOverLine.symbol === 'ovLineSym'
        && !R.overlap.symbolOverLine.sketch],
    ['a symbol on a rectangle owns the tap',
      R.overlap.symbolOverRect.symbol === 'ovRectSym'
        && !R.overlap.symbolOverRect.sketch],
    ['a Wire Label on a symbol stays easily tappable — the label wins',
      R.overlap.labelOverSymbol.editorOpen === true
        && R.overlap.labelOverSymbol.symbol === null],
    ['an arrow over a symbol keeps deterministic priority — the arrow wins',
      R.overlap.arrowOverSymbol.arrow === 'ovArw'
        && !R.overlap.arrowOverSymbol.symbol],
    ['Sheet B shows ONLY Sheet B symbols with no stale selection/mode',
      JSON.stringify(R.onB.dom) === JSON.stringify(['bSmoke', 'bThree'])
        && R.onB.state.selected === null && R.onB.state.armed === null
        && !R.onB.state.outline && R.onB.state.deleteHidden],
    ['returning to Sheet A shows exactly Sheet A symbols again',
      R.backOnA.dom.length === 7
        && ['aCeil', 'aDup', 'ovLineSym', 'ovRectSym', 'ovSymUnderArw', 'ovSymUnderLbl']
          .every((id) => R.backOnA.dom.indexOf(id) !== -1)
        && R.backOnA.dom.indexOf('bThree') === -1
        && R.backOnA.dom.indexOf('bSmoke') === -1],
    ['arming GFCI then switching sheets disarms — no phantom placement on B',
      R.armedSwitch.armedAfter === null && R.armedSwitch.hintHidden
        && R.armedSwitch.placedOnB === 0],
    ['a forced Delete Symbol after switching cannot delete across sheets',
      R.forcedDelete.cleared && R.forcedDelete.hidden
        && R.forcedDelete.dupSurvives],
    ['no page errors through the symbols isolation flows', errs.length === 0],
  ];
  return { engine: engineName, available: true, detail: R, checks, errs };
}

(async () => {
  const engines = [['chromium', withExecOverride('chromium', playwright.chromium)], ['webkit', playwright.webkit]];
  let failures = 0;

  for (const [name, engine] of engines) {
    for (const [suite, fn] of [['image + EXIF', run], ['viewport + pointers', runViewport], ['wire labels', runLabels], ['label text', runLabelText], ['arrows', runArrows], ['arrow tip', runArrowTip], ['sketch', runSketch], ['hit priority', runPriority], ['control layout', runControlLayout], ['sketch text', runText], ['wire lookup', runLookup], ['lookup aftermath', runLookupAftermath], ['sheets manager', runSheets], ['sheets photo paths', runSheetsPhoto], ['sheets isolation', runSheetsIsolation], ['sheets lookup sync', runSheetsLookupSync], ['sheets touch mutations', runSheetsTouchMutations], ['post-switch interactions', runPostSwitchInteractions], ['photo persistence', runPhotoPersistence], ['symbols foundation', runSymbolsFoundation], ['symbols interaction', runSymbolsInteraction], ['symbols isolation', runSymbolsIsolation]]) {
    const result = await fn(name, engine);
    console.log(`\n=== ${name.toUpperCase()} — ${suite} ===`);
    if (!result.available) {
      console.log('  unavailable — ' + result.reason);
      console.log('  (not installed here; not treated as a failure)');
      continue;
    }
    for (const [label, ok] of result.checks) {
      console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label);
      if (!ok && process.env.WIREMAP_DEBUG) {
        console.log('        detail:', JSON.stringify(result.detail).slice(0, 2400));
      }
      if (!ok) failures += 1;
    }
    if (result.errs.length) { console.log('  page errors:', result.errs); failures += 1; }
    else console.log('  page errors: none');
    }
  }

  console.log(failures ? `\n${failures} browser check(s) FAILED` : '\nAll available browser checks passed');
  process.exit(failures ? 1 : 0);
})();
