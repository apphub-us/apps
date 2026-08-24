'use strict';
/**
 * Wire Map browser build boundary.
 *
 * The point of these tests is narrow and important: prove that the code
 * executing in wiremap.html IS the code the Node suite tests, not a parallel
 * hand-written copy. The calculator picked up three separate defects from
 * exactly that kind of duplication, so the boundary is guarded from the start.
 *
 * The bundle is executed in an isolated `vm` context with a stub `window`, then
 * compared function-by-function against a direct require() of the sources.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'wiremap.html');
const skipAll = fs.existsSync(APP) ? false : 'wiremap.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const START = '<!-- WM-CORE:START — generated, do not edit by hand -->';
const END = '<!-- WM-CORE:END -->';

/** Run the generated block in an isolated context and return its window.WM. */
function bootBundle() {
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  let block = html.slice(s, e);
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox, { filename: 'wm-core-bundle.js' });
  return sandbox.window.WM;
}

/**
 * Values produced inside a `vm` context carry that context's Object.prototype,
 * so deepStrictEqual rejects them as "same structure, not reference-equal" even
 * when every value matches. Comparing the serialised form checks the data
 * exactly while stepping around the cross-realm prototype.
 */
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

let WM = null;
const src = {
  model: require('../src/wiremap/model'),
  geometry: require('../src/wiremap/geometry'),
  viewport: require('../src/wiremap/viewport'),
  store: require('../src/wiremap/store'),
  image: require('../src/wiremap/image'),
  labelInteraction: require('../src/wiremap/labelInteraction'),
};

describe('Wire Map build — generated block', { skip: skipAll }, () => {
  test('wiremap.html contains exactly one WM generated block', () => {
    assert.strictEqual((html.match(new RegExp(START.replace(/[.*+?^${}()|[\]\\—]/g, '\\$&'), 'g')) || []).length, 1);
    assert.strictEqual((html.match(/<!-- WM-CORE:END -->/g) || []).length, 1);
    assert.ok(html.indexOf(START) < html.indexOf(END), 'markers are out of order');
  });

  test('the generated bundle is current', () => {
    // Same gate as `npm run build:wiremap:check`, enforced inside the suite so
    // a stale bundle fails `npm test` too, not only the separate command.
    execFileSync(process.execPath,
      [path.join(ROOT, 'tools', 'build-wiremap.js'), '--check'], { cwd: ROOT, stdio: 'pipe' });
  });

  test('the build is deterministic — repeated runs agree', () => {
    const run = () => String(execFileSync(process.execPath,
      [path.join(ROOT, 'tools', 'build-wiremap.js'), '--check'], { cwd: ROOT, stdio: 'pipe' }));
    assert.strictEqual(run(), run());
  });

  test('the block names src/wiremap as the source of truth and forbids hand-editing', () => {
    const block = html.slice(html.indexOf(START), html.indexOf(END));
    assert.ok(/do not edit by hand/i.test(block));
    assert.ok(/src\/wiremap/.test(block), 'the block should point at the source directory');
  });

  test('the calculator build is untouched by the Wire Map build', () => {
    // Two builds, two targets. build-wiremap must never write mobile.html.
    const script = fs.readFileSync(path.join(ROOT, 'tools', 'build-wiremap.js'), 'utf8');
    assert.ok(!/mobile\.html/.test(script), 'the Wire Map build must not reference mobile.html');
    assert.ok(!/EC-CALC/.test(script), 'the Wire Map build must not touch the calculator markers');
  });
});

describe('Wire Map build — window.WM in an isolated context', { skip: skipAll }, () => {
  before(() => { WM = bootBundle(); });

  test('executing the bundle creates window.WM', () => {
    assert.ok(WM, 'window.WM was not created');
    assert.strictEqual(typeof WM, 'object');
  });

  test('WM exposes every Wire Map module', () => {
    for (const key of ['model', 'geometry', 'viewport', 'store', 'image', 'labelInteraction']) {
      assert.ok(WM[key], `WM.${key} is missing`);
      assert.strictEqual(typeof WM[key], 'object');
    }
  });

  test('the bundle leaks nothing else into the context', () => {
    const s = html.indexOf(START);
    const e = html.indexOf(END);
    let block = html.slice(s, e);
    block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(block, sandbox, { filename: 'leak-check.js' });
    const added = Object.keys(sandbox).filter((k) => k !== 'window');
    assert.deepStrictEqual(added, [], `bundle created globals: ${added.join(', ')}`);
    assert.deepStrictEqual(Object.keys(sandbox.window), ['WM']);
  });

  test('relative require() works between Wire Map modules', () => {
    // store.js in WM-2 will require('./model'); prove the shim supports it now.
    const s = html.indexOf(START);
    let block = html.slice(s, html.indexOf(END));
    block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
    const probe = block.replace(
      '  var api = {};',
      '  __reg["__probe"] = function (module, exports, require) {\n'
      + '    module.exports = { viaRelative: require("./model").toLabelKey("HR 07"),\n'
      + '                       viaBare: require("geometry").clampUnit(2) };\n'
      + '  };\n  var api = {};',
    ).replace('  return api;', '  api.__probe = __require("__probe");\n  return api;');
    const sb = { window: {} };
    vm.createContext(sb);
    vm.runInContext(probe, sb, { filename: 'require-probe.js' });
    assert.strictEqual(sb.window.WM.__probe.viaRelative, 'hr-07');
    assert.strictEqual(sb.window.WM.__probe.viaBare, 1);
  });

  test('an unknown module raises a clear error rather than returning undefined', () => {
    const s = html.indexOf(START);
    let block = html.slice(s, html.indexOf(END));
    block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
    const probe = block.replace('  return api;',
      '  try { __require("nope"); api.__err = null; } catch (e) { api.__err = e.message; }\n  return api;');
    const sb = { window: {} };
    vm.createContext(sb);
    vm.runInContext(probe, sb, { filename: 'unknown-probe.js' });
    assert.ok(/unknown module/.test(sb.window.WM.__err), sb.window.WM.__err);
  });
});

describe('Wire Map build — browser and Node agree', { skip: skipAll }, () => {
  before(() => { WM = bootBundle(); });

  test('toLabelKey behaves identically through both paths', () => {
    for (const input of ['HR 07', 'HR-07', '  hr_07 ', 'Panel A', '', 'A--B']) {
      assert.strictEqual(WM.model.toLabelKey(input), src.model.toLabelKey(input),
        `divergence for ${JSON.stringify(input)}`);
    }
    // Anchor the documented example so a silent behaviour change is visible.
    assert.strictEqual(WM.model.toLabelKey('HR 07'), 'hr-07');
  });

  test('normalized coordinate conversion agrees through both paths', () => {
    const sheet = { width: 2000, height: 1500 };
    for (const px of [{ x: 0, y: 0 }, { x: 840, y: 945 }, { x: 2000, y: 1500 }, { x: 5000, y: -10 }]) {
      assert.deepStrictEqual(plain(WM.geometry.normalizePoint(px, sheet)),
        src.geometry.normalizePoint(px, sheet));
    }
    assert.deepStrictEqual(plain(WM.geometry.normalizePoint({ x: 840, y: 945 }, sheet)),
      { x: 0.42, y: 0.63 });
  });

  test('a viewport round trip agrees through both paths', () => {
    const vp = { scale: 2.5, translateX: -300, translateY: 120 };
    const point = { x: 137, y: 42 };
    const browser = WM.viewport.screenToStage(WM.viewport.stageToScreen(point, vp), vp);
    const node = src.viewport.screenToStage(src.viewport.stageToScreen(point, vp), vp);
    assert.deepStrictEqual(plain(browser), node);
    assert.ok(Math.abs(browser.x - point.x) < 1e-9 && Math.abs(browser.y - point.y) < 1e-9);
  });

  test('focal-point zoom agrees, including the anti-jump property', () => {
    const focal = { x: 195, y: 350 };
    const b = WM.viewport.zoomBy(WM.viewport.identity(), focal, 2.4);
    const n = src.viewport.zoomBy(src.viewport.identity(), focal, 2.4);
    assert.deepStrictEqual(plain(b), n);
    const after = WM.viewport.screenToStage(focal, b);
    const before = src.viewport.screenToStage(focal, src.viewport.identity());
    assert.ok(Math.abs(after.x - before.x) < 1e-9 && Math.abs(after.y - before.y) < 1e-9);
  });

  test('shared constants are identical, not re-declared', () => {
    assert.strictEqual(WM.viewport.MIN_SCALE, src.viewport.MIN_SCALE);
    assert.strictEqual(WM.viewport.MAX_SCALE, src.viewport.MAX_SCALE);
    assert.deepStrictEqual(plain(WM.model.SHEET_KINDS), src.model.SHEET_KINDS);
    assert.deepStrictEqual(plain(WM.model.ANNOTATION_TYPES), src.model.ANNOTATION_TYPES);
  });

  test('every exported name in the sources is present in the bundle', () => {
    for (const mod of ['model', 'geometry', 'viewport', 'store', 'image', 'labelInteraction']) {
      const expected = Object.keys(src[mod]).sort();
      const actual = Object.keys(WM[mod]).sort();
      assert.deepStrictEqual(actual, expected, `export drift in ${mod}`);
    }
  });

  test('WM.image comes from the same source module as the Node tests', () => {
    assert.strictEqual(WM.image.MAX_IMAGE_DIMENSION, src.image.MAX_IMAGE_DIMENSION);
    assert.strictEqual(WM.image.JPEG_QUALITY, src.image.JPEG_QUALITY);
    assert.deepStrictEqual(plain(WM.image.SUPPORTED_INPUT_MIME), src.image.SUPPORTED_INPUT_MIME);
    // Pure policy must agree exactly through both paths.
    for (const [w, h] of [[4032, 3024], [1200, 900], [2001, 1000]]) {
      assert.deepStrictEqual(plain(WM.image.computeTargetDimensions(w, h)),
        src.image.computeTargetDimensions(w, h));
    }
  });

  test('WM.store comes from the same source module as the Node tests', () => {
    // Same constants, same schema shape, same error codes — one source of truth.
    assert.strictEqual(WM.store.DB_NAME, src.store.DB_NAME);
    assert.strictEqual(WM.store.DB_VERSION, src.store.DB_VERSION);
    assert.deepStrictEqual(plain(WM.store.STORE_NAMES), src.store.STORE_NAMES);
    assert.deepStrictEqual(plain(WM.store.ERR), src.store.ERR);
    assert.deepStrictEqual(plain(WM.store.STORES), src.store.STORES);
  });

  test('the bundled store requires the bundled model, not a copy', () => {
    // store.js does require('./model'); if the shim resolved it to a second
    // copy, validation and labelKey normalisation could drift apart.
    const s2 = WM.store.createStore({ driver: null, factory: null });
    assert.strictEqual(typeof s2.putJob, 'function');
    // A model-invalid job must be refused by the bundled store too.
    return s2.openDatabase().then(
      () => assert.fail('opening without IndexedDB should reject'),
      (e) => assert.strictEqual(e.code, WM.store.ERR.UNAVAILABLE),
    );
  });

  test('the bundled store enforces model validation end to end', async () => {
    const { createMemoryDriver } = require('./wiremapMemoryDriver');
    const s2 = WM.store.createStore({ driver: createMemoryDriver() });
    await s2.openDatabase();
    const good = src.model.createJob({ id: 'j1', name: 'Baylander', now: 1 });
    await s2.putJob(good);
    assert.strictEqual(plain(await s2.getJob('j1')).name, 'Baylander');
    await assert.rejects(() => s2.putJob({ ...good, name: '' }),
      (e) => e.code === WM.store.ERR.INVALID);
    s2.closeDatabase();
  });

  test('validation agrees on a realistic annotation through both paths', () => {
    const a = src.model.createAnnotation({
      id: 'a1', sheetId: 's1', type: 'wireLabel', at: { x: 0.42, y: 0.63 }, now: 1,
      data: { label: 'HR-7', from: 'Panel A / Circuit 18', to: 'Master Bedroom receptacles',
        cable: '12/2 MC', room: 'Master Bedroom', notes: 'Home run' },
    });
    assert.deepStrictEqual(plain(WM.model.validateAnnotation(a)), src.model.validateAnnotation(a));
    assert.strictEqual(WM.model.validateAnnotation(a).valid, true);

    const bad = { ...a, at: { x: 1.4, y: 0.5 } };
    assert.deepStrictEqual(plain(WM.model.validateAnnotation(bad)), src.model.validateAnnotation(bad));
    assert.strictEqual(WM.model.validateAnnotation(bad).valid, false);
  });
});

describe('Wire Map build — the WM-1 shell is still inert', { skip: skipAll }, () => {
  test('BEHAVIOUR: loading the page touches neither IndexedDB nor storage', () => {
    // Executed, not grepped. The probe registers a listener and stops; the
    // database must not be opened until the electrician picks a file.
    const core = html.slice(html.indexOf(START), html.indexOf(END));
    const coreJs = core.slice(core.indexOf('<script>') + 8, core.lastIndexOf('</script>'));
    const tail = html.slice(html.indexOf(END));
    const probeJs = tail.slice(tail.indexOf('<script>') + 8, tail.lastIndexOf('</script>'));

    let idbTouched = false;
    let storageTouched = false;
    let listeners = 0;
    const el = {
      files: null, style: {}, hidden: false,
      addEventListener() { listeners += 1; },
      getBoundingClientRect: () => ({ width: 390, height: 700, left: 0, top: 0 }),
      setAttribute() {}, removeAttribute() {},
      set textContent(_) { /* status line */ },
      set innerHTML(_) {},
    };
    const sandbox = {
      window: { addEventListener() { listeners += 1; }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } },
      document: { getElementById: () => el },
      indexedDB: new Proxy({}, { get() { idbTouched = true; return () => {}; } }),
      navigator: { storage: new Proxy({}, { get() { storageTouched = true; return () => {}; } }) },
    };
    vm.createContext(sandbox);
    vm.runInContext(coreJs, sandbox, { filename: 'core.js' });
    // In a browser `window` IS the global, so `WM` resolves bare. Mirror that.
    sandbox.WM = sandbox.window.WM;
    vm.runInContext(probeJs, sandbox, { filename: 'probe.js' });

    assert.strictEqual(idbTouched, false, 'the page opened IndexedDB on load');
    assert.strictEqual(storageTouched, false, 'the page queried storage on load');
    // Listeners are registered — two probe controls plus the stage controller's
    // pointer and resize handlers. What matters is that NONE of them fire on
    // load: no database, no storage query until the electrician acts.
    assert.ok(listeners >= 3, 'the probe controls should be wired');
    assert.ok(sandbox.window.WM, 'window.WM should still be created');
  });

  test('WM-5: labels render only inside wm-labels', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src', 'wiremap', 'app.js'), 'utf8');
    assert.ok(/el\.labels\.appendChild/.test(app), 'labels must be appended to wm-labels');
    for (const other of ['wm-sketch', 'wm-routes', 'wm-selection']) {
      assert.ok(!new RegExp(other).test(app), `WM-5 must not draw into ${other}`);
    }
  });

  test('WM-5: the label counter-scale is local, not a second viewport transform', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src', 'wiremap', 'app.js'), 'utf8');
    // Still exactly one element carries a style transform: the stage.
    assert.strictEqual((app.match(/\.style\.transform\s*=/g) || []).length, 1);
    // Labels use an SVG transform ATTRIBUTE inside that stage.
    assert.ok(/setAttribute\('transform',\s*\n?\s*'translate\(/.test(app),
      'label groups should carry their own local transform attribute');
  });

  test('the stage shows the STORED blob, never the source file', () => {
    const tail = html.slice(html.indexOf(END));
    // Both paths read the record back out of IndexedDB before displaying it.
    assert.ok(/stage\.showImage\(rec\.blob, rec\.width, rec\.height\)/.test(tail),
      'after import the stage must render the record read back out of storage');
    assert.ok(/stage\.showImage\(r\.image\.blob, r\.image\.width, r\.image\.height\)/.test(tail),
      'after load the stage must render the stored record');
    assert.ok(!/showImage\(f[,)]|showImage\(file/.test(tail),
      'the stage must not render the source File');
    assert.ok(!/wm-dev-preview/.test(html), 'the separate thumbnail should be gone');
  });

  test('WM-5: each import gets a UNIQUE image and sheet id', () => {
    // WM-3 reused one fixed image id. That would now let a new sheet inherit
    // the previous sheet's annotations, so identity is generated per import.
    const tail = html.slice(html.indexOf(END));
    assert.ok(!/wm3-probe-image/.test(tail), 'the fixed shared image id is back');
    assert.ok(/imageId = uid\('img'\)/.test(tail), 'each import needs a unique image id');
    assert.ok(/sheetId = uid\('sheet'\)/.test(tail), 'each import needs a unique sheet id');
    assert.ok(/randomUUID/.test(tail), 'use crypto.randomUUID where available');
  });

  test('WM-5: the current sheet is tracked in the meta store, not localStorage', () => {
    const tail = html.slice(html.indexOf(END));
    assert.ok(/setMeta\(META_CURRENT_SHEET/.test(tail));
    assert.ok(/getMeta\(META_CURRENT_SHEET\)/.test(tail));
    assert.ok(!/localStorage/.test(html), 'localStorage must not be used');
  });

  test('WM-5: a new sheet never inherits the previous sheet\'s labels', () => {
    const tail = html.slice(html.indexOf(END));
    assert.ok(/stage\.setAnnotations\(\[\]\)/.test(tail),
      'an imported sheet must start with no labels');
  });

  test('the controller revokes the previous object URL before creating another', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src', 'wiremap', 'app.js'), 'utf8');
    assert.ok(/function releaseImage\(\)[\s\S]{0,240}revokeObjectURL/.test(app),
      'object URLs would accumulate');
    assert.ok(/releaseImage\(\);\s*\n\s*objectUrl = win\.URL\.createObjectURL/.test(app),
      'the previous URL must be released before the next is created');
  });

  test('ARCHITECTURAL INVARIANT: image and SVG share one stage transform', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src', 'wiremap', 'app.js'), 'utf8');
    // Only .stage is transformed. Transforming the img or svg separately would
    // let the plan and its annotations drift apart under zoom.
    const transforms = app.match(/\.style\.transform\s*=/g) || [];
    assert.strictEqual(transforms.length, 1, 'exactly one element may be transformed');
    assert.ok(/el\.stage\.style\.transform\s*=/.test(app), 'the transform must be on .stage');
    assert.ok(!/el\.image\.style\.transform|el\.svg\.style\.transform/.test(app),
      'the image and SVG must never carry their own transform');
  });

  test('the visible shell is unchanged', () => {
    for (const marker of ['id="wm-viewport"', 'id="wm-stage"', 'id="wm-background"',
      'id="wm-overlay"', 'id="wm-sketch"', 'id="wm-routes"', 'id="wm-labels"',
      'id="wm-selection"', 'No sheet loaded']) {
      assert.ok(html.includes(marker), `missing shell element: ${marker}`);
    }
  });

  test('SVG layer order is unchanged', () => {
    const order = ['wm-sketch', 'wm-routes', 'wm-labels', 'wm-selection'].map((id) => html.indexOf(id));
    assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
  });

  test('the only script on the page is the generated core', () => {
    // Two now: the generated core, plus the WM-3 development import probe.
    const scripts = html.match(/<script[^>]*>/g) || [];
    assert.strictEqual(scripts.length, 2, `expected two script tags, found ${scripts.length}`);
    const first = html.indexOf('<script');
    assert.ok(first > html.indexOf(START) && first < html.indexOf(END),
      'the core script should sit inside the generated block');
    assert.ok(html.lastIndexOf('<script') > html.indexOf(END),
      'the dev probe must come after the core so window.WM exists');
  });

  test('no editor behaviour was added — no listeners, no storage, no fetch', () => {
    const handWritten = html.slice(0, html.indexOf(START)) + html.slice(html.indexOf(END));
    // indexedDB now appears inside the GENERATED block via store.js; the
    // hand-written page must still not touch it.
    // The WM-3 probe legitimately adds one change listener. Everything else
    // the editor will need is still absent.
    for (const forbidden of ['localStorage', 'fetch(', 'PointerEvent', 'onclick']) {
      assert.ok(!handWritten.includes(forbidden),
        `WM-3 must not introduce ${forbidden}`);
    }
    // Probe controls plus the WM-5 editor buttons. None fire on load.
    const count = (handWritten.match(/addEventListener/g) || []).length;
    assert.ok(count >= 3 && count <= 12, `unexpected listener count: ${count}`);
  });

  test('no external dependency was pulled in', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    assert.deepStrictEqual(Object.keys(deps), []);
    assert.ok(!fs.existsSync(path.join(ROOT, 'package-lock.json')), 'a lockfile was created');
  });
});

describe('Wire Map build — package scripts', { skip: skipAll }, () => {
  const pkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  test('the calculator build scripts keep their existing meaning', () => {
    const s = pkg().scripts;
    assert.strictEqual(s.build, 'node tools/build-calc.js');
    assert.strictEqual(s['build:check'], 'node tools/build-calc.js --check');
  });

  test('the Wire Map build has its own separate scripts', () => {
    const s = pkg().scripts;
    assert.strictEqual(s['build:wiremap'], 'node tools/build-wiremap.js');
    assert.strictEqual(s['build:wiremap:check'], 'node tools/build-wiremap.js --check');
  });

  test('verify covers both builds', () => {
    const v = pkg().scripts.verify;
    assert.ok(/npm test/.test(v), 'verify must run the tests');
    assert.ok(/build:check/.test(v), 'verify must check the calculator build');
    assert.ok(/build:wiremap:check/.test(v), 'verify must check the Wire Map build');
  });
});
