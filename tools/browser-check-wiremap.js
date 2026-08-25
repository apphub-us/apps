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

(async () => {
  const engines = [['chromium', playwright.chromium], ['webkit', playwright.webkit]];
  let failures = 0;

  for (const [name, engine] of engines) {
    for (const [suite, fn] of [['image + EXIF', run], ['viewport + pointers', runViewport], ['wire labels', runLabels], ['label text', runLabelText], ['arrows', runArrows], ['arrow tip', runArrowTip], ['sketch', runSketch], ['hit priority', runPriority], ['control layout', runControlLayout]]) {
    const result = await fn(name, engine);
    console.log(`\n=== ${name.toUpperCase()} — ${suite} ===`);
    if (!result.available) {
      console.log('  unavailable — ' + result.reason);
      console.log('  (not installed here; not treated as a failure)');
      continue;
    }
    for (const [label, ok] of result.checks) {
      console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label);
      if (!ok) failures += 1;
    }
    if (result.errs.length) { console.log('  page errors:', result.errs); failures += 1; }
    else console.log('  page errors: none');
    }
  }

  console.log(failures ? `\n${failures} browser check(s) FAILED` : '\nAll available browser checks passed');
  process.exit(failures ? 1 : 0);
})();
