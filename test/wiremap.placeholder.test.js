'use strict';
/**
 * Placeholder state — WM-4 defect fix.
 *
 * Found on a physical iPhone: after a plan loaded, "No sheet loaded" stayed on
 * screen over the image. The controller was setting hidden = true correctly;
 * the author rule `.empty { display: flex }` simply outranked the browser's
 * own [hidden] rule, so the attribute had no visual effect.
 *
 * These tests cover both halves: the controller's state, and the stylesheet
 * rule that lets that state actually show.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/wiremap/app');

const ROOT = path.join(__dirname, '..');

/** Minimal DOM: enough for the controller, honest about `hidden`. */
function makeDom() {
  const mk = (id) => ({
    id, hidden: false, style: {}, width: 0, height: 0, src: '',
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { if (k === 'src') this.src = ''; delete this.attrs[k]; },
    addEventListener() {},
    getBoundingClientRect: () => ({ width: 390, height: 700, left: 0, top: 0 }),
  });
  const els = {
    'wm-viewport': mk('wm-viewport'),
    'wm-stage': mk('wm-stage'),
    'wm-background': mk('wm-background'),
    'wm-overlay': mk('wm-overlay'),
    'wm-empty': mk('wm-empty'),
  };
  els['wm-background'].hidden = true;   // as authored in wiremap.html
  return { els, document: { getElementById: (id) => els[id] || null } };
}

const FAKE_BLOB = { size: 1234, type: 'image/jpeg' };

function makeController(dom) {
  let urls = 0;
  const revoked = [];
  const win = {
    URL: {
      createObjectURL: () => 'blob:test-' + (++urls),
      revokeObjectURL: (u) => revoked.push(u),
    },
    addEventListener() {},
  };
  const c = app.createStageController({ document: dom.document, window: win });
  return { controller: c, revoked, win };
}

/** showImage resolves on the image element's load callback; fire it. */
async function load(controller, dom, w, h) {
  const p = controller.showImage(FAKE_BLOB, w, h);
  if (typeof dom.els['wm-background'].onload === 'function') dom.els['wm-background'].onload();
  return p;
}

describe('WM-4 placeholder — controller state', () => {
  let dom; let controller; let revoked;

  beforeEach(() => {
    dom = makeDom();
    ({ controller, revoked } = makeController(dom));
  });

  test('an empty stage shows the placeholder', () => {
    assert.strictEqual(controller.hasImage(), false);
    assert.strictEqual(dom.els['wm-empty'].hidden, false);
    assert.strictEqual(controller.isPlaceholderVisible(), true);
  });

  test('THE DEFECT: loading an image hides the placeholder', async () => {
    await load(controller, dom, 2000, 1500);
    assert.strictEqual(dom.els['wm-empty'].hidden, true,
      '"No sheet loaded" must not sit on top of the plan');
    assert.strictEqual(controller.isPlaceholderVisible(), false);
    assert.strictEqual(controller.hasImage(), true);
  });

  test('loading also reveals the background image element', async () => {
    assert.strictEqual(dom.els['wm-background'].hidden, true);
    await load(controller, dom, 2000, 1500);
    assert.strictEqual(dom.els['wm-background'].hidden, false);
  });

  test('clearing restores the placeholder', async () => {
    await load(controller, dom, 2000, 1500);
    controller.clear();
    assert.strictEqual(dom.els['wm-empty'].hidden, false);
    assert.strictEqual(dom.els['wm-background'].hidden, true);
    assert.strictEqual(controller.hasImage(), false);
  });

  test('clearing releases the object URL rather than leaking it', async () => {
    await load(controller, dom, 2000, 1500);
    const url = controller.getObjectUrl();
    controller.clear();
    assert.deepStrictEqual(revoked, [url]);
    assert.strictEqual(controller.getObjectUrl(), null);
  });

  test('replacing an image keeps the placeholder hidden throughout', async () => {
    await load(controller, dom, 2000, 1500);
    await load(controller, dom, 900, 1600);
    assert.strictEqual(dom.els['wm-empty'].hidden, true);
    assert.strictEqual(controller.getStageSize().width, 900);
  });

  test('reloading after a clear hides it again', async () => {
    await load(controller, dom, 2000, 1500);
    controller.clear();
    assert.strictEqual(controller.isPlaceholderVisible(), true);
    await load(controller, dom, 1200, 900);
    assert.strictEqual(controller.isPlaceholderVisible(), false);
  });

  test('a rejected showImage leaves the placeholder alone', async () => {
    // No blob, or nonsense dimensions: nothing is displayed, so the empty
    // state must survive rather than leaving a blank stage with no explanation.
    assert.strictEqual(await controller.showImage(null, 100, 100), false);
    assert.strictEqual(await controller.showImage(FAKE_BLOB, 0, 100), false);
    assert.strictEqual(controller.isPlaceholderVisible(), true);
    assert.strictEqual(controller.hasImage(), false);
  });

  test('clear() resets the transform so a stale view cannot linger', async () => {
    await load(controller, dom, 2000, 1500);
    controller.clear();
    assert.deepStrictEqual(controller.getViewport(), { scale: 1, translateX: 0, translateY: 0 });
    assert.strictEqual(controller.getStageSize(), null);
  });

  test('destroy() also returns the stage to its empty state', async () => {
    await load(controller, dom, 2000, 1500);
    controller.destroy();
    assert.strictEqual(controller.isPlaceholderVisible(), true);
    assert.strictEqual(controller.getObjectUrl(), null);
  });

  test('only the controller toggles the placeholder', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'wiremap', 'app.js'), 'utf8');
    // One writer: setPlaceholderVisible. Two places assigning el.empty.hidden
    // would be two sources of truth for the same state.
    const writes = src.match(/el\.empty\.hidden\s*=/g) || [];
    assert.strictEqual(writes.length, 1, 'the placeholder must have a single writer');
    assert.ok(/function setPlaceholderVisible/.test(src));
  });

  test('the page itself does not toggle the placeholder', () => {
    const html = fs.readFileSync(path.join(ROOT, 'wiremap.html'), 'utf8');
    const end = html.indexOf('<!-- WM-CORE:END -->');
    const handWritten = html.slice(0, html.indexOf('<!-- WM-CORE:START')) + html.slice(end);
    assert.ok(!/wm-empty['"]?\)\s*\.hidden|getElementById\(['"]wm-empty/.test(handWritten),
      'the probe must not manage placeholder state — the controller owns it');
  });
});

describe('WM-4 placeholder — the stylesheet must honour `hidden`', () => {
  const html = () => fs.readFileSync(path.join(ROOT, 'wiremap.html'), 'utf8');

  test('ROOT CAUSE: a [hidden] rule outranks the author display rules', () => {
    // Without this, `.empty { display: flex }` beats the browser's own
    // [hidden] rule and the placeholder stays on screen over the plan.
    assert.ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(html()),
      'setting hidden = true would have no visual effect');
  });

  test('the author rules that caused it are still present', () => {
    // If these ever go away the [hidden] rule is still correct, but this
    // documents why it is needed.
    assert.ok(/\.empty\s*\{[^}]*display:\s*flex/.test(html()));
    assert.ok(/\.stage-bg\s*\{[^}]*display:\s*block/.test(html()));
  });

  test('the placeholder markup is intact, not deleted', () => {
    assert.ok(html().includes('id="wm-empty"'));
    assert.ok(html().includes('No sheet loaded'));
  });

  test('the background image starts hidden in the markup', () => {
    assert.ok(/id="wm-background"[^>]*hidden/.test(html()));
  });
});
