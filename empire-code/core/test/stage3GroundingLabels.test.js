'use strict';
/**
 * EC-AUDIT-FIX-1 — LAB-01: the visible captions of the Grounding calculator (EGC / GEC) are real labels of their controls.
 *
 * The calculator form is not static markup: the page builds it in gndRenderCalc(). This test takes the SHIPPED
 * gndRenderCalc() (and gndLabel()) of BOTH pages — core/mobile.html and the hosted copy — from the page source OUTSIDE the
 * generated calculator block, runs it against a one-element stub document and checks the markup it really writes:
 * each caption is one <label class="ctrl-lbl" for="id"> that sits directly before exactly one <select id="id">, and that id
 * exists once in the page. An aria-label somewhere else on the page would not satisfy these assertions.
 *
 * Fixture limits, said plainly: the size list passed in is a short fixture (the option lists are not what is checked),
 * gndCalc() is a counting stub (no engine runs here), and nothing is laid out or read by a screen reader — this is a
 * structural check of the association, not a WCAG certification. The six captions repaired by this fix are listed first;
 * the two that were already labels (gnd-electrode, gnd-ring) are checked the same way so the whole form stays covered.
 * The existing EC-09 checks (stage3Labels.test.js) are untouched.
 *
 * Authored, not executed by the author. Run from core/: node --test test/stage3GroundingLabels.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGES = [['core/mobile.html', path.join(__dirname, '..', 'mobile.html')], ['candidate/browser/workspace/mobile.html', path.join(__dirname, '..', '..', 'candidate', 'browser', 'workspace', 'mobile.html')]];
function outsideBlock(file) {
  const html = fs.readFileSync(file, 'utf8'); const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
  assert.ok(s > 0 && e > s, 'calculator block markers'); return html.slice(0, s) + html.slice(e);
}
function fnBody(page, name) {
  const i = page.indexOf('function ' + name + '('); assert.ok(i > 0, 'function ' + name + ' is outside the generated block');
  let depth = 0; let started = false;
  for (let j = i; j < page.length; j++) { if (page[j] === '{') { depth++; started = true; } else if (page[j] === '}') { depth--; if (started && depth === 0) return page.slice(i, j + 1); } }
  throw new Error('unbalanced: ' + name);
}
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (text, re) => (text.match(re) || []).length;

// The six associations added by this fix (LAB-01), caption text exactly as shipped before it.
const REPAIRED = { 'gnd-ocpd': 'Breaker / Fuse', 'gnd-egc-mat': 'EGC Material', 'gnd-req': 'Required size', 'gnd-inst': 'Actually installed', 'gnd-svc': 'Largest Service Conductor', 'gnd-svc-mat': 'Service Material' };
// Already correct before this fix; kept under the same check.
const EXISTING = { 'gnd-electrode': 'Connecting To', 'gnd-ring': 'Ground ring conductor (required)' };
const ALL = { ...REPAIRED, ...EXISTING };
const SIZES = ['14', '2', '3/0', '500'];   // fixture option list; the shipped page reads EC.tables.GND_SIZES

// What the shipped gndRenderCalc() writes into #groundingContent.
function rendered(page) {
  const target = { innerHTML: '' }; const asked = []; let calcs = 0;
  const document = { getElementById: (id) => { asked.push(id); return id === 'groundingContent' ? target : null; } };
  // eslint-disable-next-line no-new-func
  new Function('document', 'GND_SIZES', 'gndCalc', fnBody(page, 'gndLabel') + '\n' + fnBody(page, 'gndRenderCalc') + '\ngndRenderCalc();')(document, SIZES, () => { calcs++; });
  assert.deepEqual(asked, ['groundingContent'], 'the form is written into its one container');
  assert.equal(calcs, 1, 'the form still asks for one calculation after it is built');
  assert.ok(target.innerHTML.length > 0);
  return target.innerHTML;
}

for (const [name, file] of PAGES) {
  test('LAB-01 ' + name + ': each Grounding caption is a <label for> bound to exactly one control with that id', () => {
    const page = outsideBlock(file); const form = rendered(page);
    for (const [id, text] of Object.entries(ALL)) {
      const labels = [...form.matchAll(new RegExp('<label\\b([^>]*)\\bfor="' + esc(id) + '"[^>]*>([^<]*)</label>', 'g'))];
      assert.equal(labels.length, 1, id + ': exactly one label points at it');
      assert.equal(labels[0][2], text, id + ': the label is the visible caption, text unchanged');
      assert.match(labels[0][1], /class="ctrl-lbl"/, id + ': the caption keeps its visual class');
      assert.equal(count(form, new RegExp('\\bid="' + esc(id) + '"', 'g')), 1, id + ': the id is unique in the form');
      assert.equal(count(form, new RegExp('<select\\b[^>]*\\bid="' + esc(id) + '"', 'g')), 1, id + ': the target is the select of that field');
      // The caption and its control are one visual pair: the label is directly followed by the control it names.
      assert.ok(form.includes('<label class="ctrl-lbl" for="' + id + '">' + text + '</label><select id="' + id + '" onchange="gndCalc()"'), id + ': the label sits directly before its own control');
      // Page-wide: no second element with this id anywhere outside the generated block (markup or script template).
      assert.equal(count(page, new RegExp('\\bid=\\\\?["\']' + esc(id) + '\\\\?["\']', 'g')), 1, id + ': the id is written once in the page');
      assert.equal(count(page, new RegExp('\\bfor=\\\\?["\']' + esc(id) + '\\\\?["\']', 'g')), 1, id + ': one label in the page names it');
    }
  });

  test('LAB-01 ' + name + ': no Grounding control is left without its caption, and no caption without a control', () => {
    const form = rendered(outsideBlock(file));
    assert.ok(!form.includes('<span class="ctrl-lbl">'), 'a caption without a control is back');
    const targets = [...form.matchAll(/<label class="ctrl-lbl" for="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(targets, Object.keys(ALL), 'the eight captions, in their shipped order, each naming its own field');
    assert.equal(count(form, /<label\b/g), 8, 'no other label in the form');
    const controls = [...form.matchAll(/<(?:select|input|textarea)\b[^>]*>/g)].map((m) => (m[0].match(/\bid="([^"]+)"/) || [])[1]);
    assert.deepEqual(controls, Object.keys(ALL), 'the eight controls of the form are exactly the eight labelled ones');
  });

  test('LAB-01 ' + name + ': the repaired controls themselves are unchanged (same tag, id, handler and style; no aria-label added instead)', () => {
    const form = rendered(outsideBlock(file));
    for (const id of Object.keys(REPAIRED)) {
      assert.ok(form.includes('<select id="' + id + '" onchange="gndCalc()" style="width:100%">'), id + ': the control is exactly as before');
    }
    assert.ok(!/aria-label=/.test(form), 'the names come from the visible labels, not from hidden text');
    // The two material selects keep their two choices and values.
    for (const id of ['gnd-egc-mat', 'gnd-svc-mat']) assert.ok(form.includes('<select id="' + id + '" onchange="gndCalc()" style="width:100%"><option value="cu">Copper</option><option value="al">Aluminum</option></select>'), id);
    // The size selects are still filled from the size list they were given, with the page's own labels.
    for (const id of ['gnd-req', 'gnd-inst', 'gnd-svc']) {
      const m = form.match(new RegExp('<select id="' + id + '"[^>]*>(.*?)</select>')); assert.ok(m, id);
      assert.deepEqual([...m[1].matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]), SIZES, id + ': one option per size');
    }
  });
}
