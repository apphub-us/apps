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
    const p = await WM.image.processImage(await plan(2000, 1500, '#204060'));
    const db = WM.store.createStore(); await db.openDatabase();
    await db.putImage(WM.image.buildImageRecord({ id: 'wm3-probe-image', blob: p.blob,
      mime: p.mime, width: p.width, height: p.height, bytes: p.bytes, createdAt: Date.now() }));
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

(async () => {
  const engines = [['chromium', playwright.chromium], ['webkit', playwright.webkit]];
  let failures = 0;

  for (const [name, engine] of engines) {
    for (const [suite, fn] of [['image + EXIF', run], ['viewport + pointers', runViewport]]) {
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
