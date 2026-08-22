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

(async () => {
  const engines = [['chromium', playwright.chromium], ['webkit', playwright.webkit]];
  let failures = 0;

  for (const [name, engine] of engines) {
    const result = await run(name, engine);
    console.log(`\n=== ${name.toUpperCase()} ===`);
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

  console.log(failures ? `\n${failures} browser check(s) FAILED` : '\nAll available browser checks passed');
  process.exit(failures ? 1 : 0);
})();
