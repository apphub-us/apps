'use strict';
/**
 * EC-UI-LAYOUT-REFS-1 / UI-r1 — diagnostic controller (R-UI-03).
 *
 * Executes the SHIPPED controllerSource() of tools/EC-UI-LAYOUT-1-iphone-diagnostic.cjs
 * in a VM with explicit synthetic parent (shell) and child (app) viewports and timer
 * accounting — adapted from the reviewer's diagnostic-controller-probe.cjs. This proves
 * what the measurement records and how its lifecycle behaves; it is NOT WebKit, not an
 * iOS emulator and not evidence about the phone. The native movement stays PENDING.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const launcher = fs.readFileSync(path.join(__dirname, '..', 'tools', 'EC-UI-LAYOUT-1-iphone-diagnostic.cjs'), 'utf8');
const trimmed = launcher.slice(0, launcher.lastIndexOf('try { main(); }')) + '\nthis.getControllerSource = controllerSource; this.KNOWN = KNOWN_SOURCES;';
const def = { require, console, Buffer, process }; vm.runInNewContext(trimmed, def);
const code = def.getControllerSource();

function run(options) {
  options = options || {};
  const ui = {}, listeners = {}, timers = new Map(); let nextTimer = 1, reloads = 0, clearCalls = 0; const childListeners = [];
  function uiEl(id) { return ui[id] || (ui[id] = { id, style: {}, className: '', textContent: '', value: '', addEventListener(ev, f) { listeners[id + ':' + ev] = f; } }); }
  function el(id, sl) { return { tagName: 'DIV', id, className: '', scrollLeft: sl || 0, scrollTop: 0, scrollWidth: options.panelScrollWidth || 390, clientWidth: 390, classList: { contains() { return true; } }, getBoundingClientRect() { return { left: 0, right: 390, top: 0, width: 390, height: 600 }; } }; }
  const makeChild = () => {
    const de = el('document'), body = el('body'), panel = el('panel-more', options.panelScroll || 0), content = el('content', options.contentScroll || 0), lc = el('lcContent');
    const d = { documentElement: de, body, getElementById(id) { return { 'panel-more': panel, lcContent: lc }[id] || null; }, querySelector() { return content; }, getElementsByTagName() { return [de, body, panel, content, lc]; }, activeElement: body, addEventListener(ev, f) { childListeners.push(ev); } };
    const childvv = { scale: options.childScale || 1, offsetLeft: options.childOffset || 0, offsetTop: 0, pageLeft: 0, width: 390, height: options.childVVHeight || 600, addEventListener() {} };
    return { document: d, innerWidth: 390, innerHeight: 600, visualViewport: childvv, getComputedStyle() { return { overflowX: 'auto' }; }, addEventListener() {}, location: { reload() { reloads++; frame.contentWindow = makeChild(); } } };
  };
  const frame = uiEl('app'); frame.getBoundingClientRect = () => ({ left: options.frameLeft || 0, top: 100, right: (options.frameLeft || 0) + (options.frameWidth || 390), width: options.frameWidth || 390, height: 600 });
  frame.contentWindow = makeChild();
  const parentvv = { scale: options.parentScale || 1, offsetLeft: options.parentOffset || 0, offsetTop: 0, pageLeft: 0, width: 390 / (options.parentScale || 1), height: 744 / (options.parentScale || 1), addEventListener() {} };
  const parentWindow = { devicePixelRatio: 3, innerWidth: 390, innerHeight: 844, visualViewport: parentvv };
  const document = { getElementById: uiEl, documentElement: { scrollLeft: 0 }, body: { scrollLeft: 0, getAttribute(k) { return k === 'data-pin' ? 'PIN' : k === 'data-source' ? 'SYNTHETIC' : '/test/mobile.html'; } } };
  const ctx = { document, window: parentWindow, navigator: { userAgent: 'TEST-SYNTHETIC' }, screen: { width: 390, height: 844 }, setTimeout(f) { f(); return 0; }, setInterval(f) { const id = nextTimer++; timers.set(id, f); return id; }, clearInterval(id) { clearCalls++; timers.delete(id); }, console, Date, JSON, Number, Math };
  vm.runInNewContext(code, ctx);
  listeners['app:load']();
  if (options.reload) { listeners['reload:click'](); listeners['app:load'](); }
  if (options.doubleLoad) listeners['app:load']();
  listeners['copy:click']();
  const report = JSON.parse(ui.report.value);
  return { report, current: report.current, line: ui.line.textContent, activeTimers: timers.size, clearCalls, reloads, childListeners, reportTimers: report.activeTimers, armCount: report.armCount };
}

describe('UI-r1 R-UI-03 — the diagnostic controller measures outer + inner viewports and signed movement', () => {
  test('control: normal geometry -> not moved; outer visualViewport, iframe rect and inner visualViewport are all recorded; exactly one timer', () => {
    const r = run({});
    assert.strictEqual(r.current.moved, false); assert.ok(/^ok — /.test(r.line), r.line);
    assert.deepStrictEqual(r.current.outerVV, { scale: 1, offsetLeft: 0, offsetTop: 0, pageLeft: 0, width: 390, height: 744 });
    assert.deepStrictEqual(r.current.frame, { left: 0, top: 100, width: 390, height: 600 }); assert.strictEqual(r.current.outer.innerWidth, 390);
    assert.strictEqual(r.current.vv.scale, 1); assert.strictEqual(r.activeTimers, 1); assert.strictEqual(r.reportTimers, 1);
    assert.ok(r.childListeners.includes('scroll') && r.childListeners.includes('focusin') && r.childListeners.includes('touchend'));
  });
  test('inner (app) zoom is flagged as zoom-app (reviewer control)', () => { const r = run({ childScale: 1.2 }); assert.strictEqual(r.current.moved, true); assert.strictEqual(r.current.classification.innerZoom, true); assert.ok(/zoom-app/.test(r.line)); });
  test('positive panel scroll is flagged with the mover (reviewer control)', () => { const r = run({ panelScroll: 182 }); assert.strictEqual(r.current.moved, true); assert.strictEqual(r.current.classification.scrolled, true); assert.strictEqual(r.current.movers[0].scrollLeft, 182); assert.ok(/mover div#panel-more sL182/.test(r.line)); });
  test('NEGATIVE panel scroll (-182) is movement too: flagged, mover recorded with the signed value (candidate before: "ok")', () => { const r = run({ panelScroll: -182 }); assert.strictEqual(r.current.moved, true); assert.strictEqual(r.current.classification.scrolled, true); assert.strictEqual(r.current.movers[0].scrollLeft, -182); assert.ok(/RUCH \(scroll\)/.test(r.line) && /sL-182/.test(r.line), r.line); });
  test('OUTER (shell) zoom/offset only: flagged as zoom-shell with the outer values recorded (candidate before: "ok", outer not recorded)', () => { const r = run({ parentScale: 2, parentOffset: 80 }); assert.strictEqual(r.current.moved, true); assert.strictEqual(r.current.classification.outerZoom, true); assert.strictEqual(r.current.classification.innerZoom, false); assert.strictEqual(r.current.outerVV.scale, 2); assert.strictEqual(r.current.outerVV.offsetLeft, 80); assert.ok(/zoom-shell/.test(r.line) && /vv-shell x2 off80/.test(r.line), r.line); });
  test('a shifted or narrowed iframe is flagged as a frame shift with the rect recorded', () => { const r = run({ frameLeft: -182 }); assert.strictEqual(r.current.moved, true); assert.strictEqual(r.current.classification.frameShift, true); assert.strictEqual(r.current.frame.left, -182); assert.ok(/ramka/.test(r.line)); const n = run({ frameWidth: 300 }); assert.strictEqual(n.current.classification.frameShift, true); });
  test('a height-only inner visualViewport change at scale 1 (software keyboard) is NOT movement: reported as keyboardLikely', () => { const r = run({ childVVHeight: 300 }); assert.strictEqual(r.current.moved, false); assert.strictEqual(r.current.keyboardLikely, true); assert.ok(/^ok — /.test(r.line) && /klawiatura\?/.test(r.line), r.line); const z = run({ childVVHeight: 300, childScale: 1.2 }); assert.strictEqual(z.current.keyboardLikely, false, 'a scale change is zoom, not the keyboard'); });
  test('horizontal overflow without any scroll offset is still flagged (overflow), and .content scroll is a mover', () => { const r = run({ panelScrollWidth: 572 }); assert.strictEqual(r.current.classification.overflow, true); assert.ok(/przepełnienie/.test(r.line)); const c = run({ contentScroll: 182 }); assert.strictEqual(c.current.classification.scrolled, true); assert.strictEqual(c.current.movers[0].el, 'div#content'); });
});

describe('UI-r1 R-UI-03 — one measurement lifecycle through reloads', () => {
  test('Odśwież + load: the previous timer is cleared, listeners are re-armed on the new document, exactly one timer is active (candidate before: 2 timers)', () => {
    const r = run({ reload: true });
    assert.strictEqual(r.reloads, 1); assert.strictEqual(r.activeTimers, 1); assert.strictEqual(r.reportTimers, 1); assert.ok(r.clearCalls >= 1); assert.strictEqual(r.armCount, 2);
    assert.strictEqual(r.childListeners.filter((e) => e === 'scroll').length, 2, 'listeners armed once per document');
  });
  test('a repeated load event of the same document does not add a timer or duplicate listeners', () => { const r = run({ doubleLoad: true }); assert.strictEqual(r.activeTimers, 1); assert.strictEqual(r.armCount, 1); assert.strictEqual(r.childListeners.filter((e) => e === 'scroll').length, 1); });
  test('the controller is read-only: it never writes storage, focuses, blurs, scrolls or changes zoom/CSS in the app document', () => {
    assert.ok(!/localStorage|sessionStorage|\.focus\(|\.blur\(|scrollIntoView|\.scrollLeft\s*=|\.scrollTop\s*=|style\.zoom|innerHTML/.test(code), 'no storage, focus, scroll, zoom or markup writes');
    const styleWrites = code.match(/[\w.]+\.style\.[a-zA-Z]+\s*=/g) || [];
    assert.deepStrictEqual([...new Set(styleWrites)].sort(), ['box.style.display =', "mod.style.display ="].sort(), 'the only style writes are the shell report box and hiding the api-key modal (as in the pinned preview): ' + styleWrites.join(', '));
    assert.ok(/getBoundingClientRect\(\)/.test(code) && /window\.visualViewport/.test(code) && /el\.scrollLeft !== 0/.test(code) && /clearInterval\(pollTimer\)/.test(code));
  });
  test('only explicitly identified sources are accepted: the current Mac build and the UI-r1 FINAL build', () => {
    const keys = Object.keys(def.KNOWN); assert.strictEqual(keys.length, 2);
    assert.ok(keys.includes('989b7079fd1f8cd3b98107d99647c19b34187bd6ed5c1071d70a86def1d8a28d'), 'the current Mac build (B2-r1.1) is an accepted source');
    assert.ok(keys.every((k) => /^[0-9a-f]{64}$/.test(k)), 'both pins are complete SHA-256 hashes: ' + keys.join(', '));
    assert.ok(/readKnownSource\(file/.test(launcher) && !/EC_DIAG_ALLOW_ANY|process\.env\.PIN/.test(launcher), 'no bypass');
  });
});
