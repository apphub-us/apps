'use strict';
/**
 * EC-AUDIT-FIX-1 stage 3 — EC-09: visible captions are real labels of their controls.
 * Checked on the page source OUTSIDE the generated calculator block, for core/mobile.html and the hosted copy.
 * Each caption must be a <label for="id"> whose target is exactly one form control with that id — an arbitrary
 * aria-label somewhere on the page would not satisfy these assertions. Not a screen-reader or WCAG certification.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const wireSizing = require('../src/calc/wireSizing');

const PAGES = [['core/mobile.html', path.join(__dirname, '..', 'mobile.html')], ['candidate/browser/workspace/mobile.html', path.join(__dirname, '..', '..', 'candidate', 'browser', 'workspace', 'mobile.html')]];
function outsideBlock(file) {
  const html = fs.readFileSync(file, 'utf8'); const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
  assert.ok(s > 0 && e > s, 'calculator block markers'); return html.slice(0, s) + html.slice(e);
}
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const count = (text, re) => (text.match(re) || []).length;

const LABELS = {
  // Ampacity
  ampWireSize: 'Wire Size', ampInsul: 'Insulation', ampMaterial: 'Material', ampTemp: 'Ambient Temp', ampBundle: 'CCC (Bundling)', ampRoof: 'On or Above Roof', ampRoofSun: 'Direct Sunlight', ampRoofClearance: 'Clearance Above Roof',
  // Conduit Fill and its Wireway mode (the wireway form is a template inside a script)
  cfConduitType: 'Conduit Type', cfConduitSize: 'Conduit Size', cfWireType: 'Wire Type', cfWireSize: 'Wire Size', cfNumWires: '# Wires',
  wwWidth: 'Wireway Width (in)', wwHeight: 'Wireway Height (in)', wwWireSize: 'Wire Size', wwWireType: 'Wire Type', wwNumWires: '# of Wires',
  // Box Fill, including the ring / raised cover + custom volume controls
  bfBoxType: 'Box Type', bfAccessory: 'Ring / raised cover', bfExtension: 'Custom extra volume (in³)', bfWireSize: 'Wire Size (largest, governs allowances)', bfConductors: '# Conductors (counted)', bfDevices: '# Devices (yokes)', bfClamps: 'Internal Clamps', bfEgcCount: 'Entering EGCs + bonding jumpers', bfEgcSize: 'Largest entering EGC',
  // Wire Sizer
  wsLoad: 'Load (Amps)', wsContinuous: 'Continuous Portion (A)', wsCircuitType: 'Circuit Type', wsDwelling: 'Feeds a Dwelling Unit?', wsHundredPct: '100%-Rated Assembly', wsFeet: 'One-Way Distance (ft)', wsVoltage: 'System Voltage', wsPhase: 'Phase', wsMaterial: 'Material', wsInsul: 'Insulation', wsBundle: 'CCC Bundling', wsTemp: 'Ambient Temp', wsMaxVD: 'Max VD %',
  // legacy Voltage Drop panel (not in navigation; kept consistent)
  vdAmps: 'Load (Amps)', vdFeet: 'One-Way Distance (ft)', vdVoltage: 'System Voltage', vdPhase: 'Phase', vdMaterial: 'Conductor', vdMaxPct: 'Max VD %',
};
const DESCRIBED = [['ampRoofClearance', 'ampRoofClearanceHint'], ['wsContinuous', 'wsContinuousHint'], ['wsDwelling', 'wsDwellingHint'], ['wsHundredPct', 'wsHundredPctHint'], ['wsMaxVD', 'wsMaxVDNote']];
const BUTTONS = [['ampReset()', 'Reset Ampacity inputs', 'Reset'], ["favSave('amp')", 'Save Ampacity preset', 'Save'], ['cfReset()', 'Reset Conduit Fill inputs', 'Reset'], ["favSave('cf')", 'Save Conduit Fill preset', 'Save'],
  ['bfReset()', 'Reset Box Fill inputs', 'Reset'], ['wsReset()', 'Reset Wire Sizer inputs', 'Reset'], ['vdReset()', 'Reset Voltage Drop inputs', 'Reset'], ["favSave('vd')", 'Save Voltage Drop preset', 'Save'], ['wwReset()', 'Reset Wireway Fill inputs', 'Reset']];
const panelsOf = (page) => {
  const from = page.indexOf('<div class="panel" id="panel-ampacity">'); const to = page.indexOf('<div class="panel" id="panel-more">');
  assert.ok(from > 0 && to > from, 'Ampacity .. Wire Sizer panels found'); return page.slice(from, to);
};

for (const [name, file] of PAGES) {
  test('EC-09 ' + name + ': every caption is a <label for> bound to exactly one control with that id', () => {
    const page = outsideBlock(file);
    for (const [id, text] of Object.entries(LABELS)) {
      const labels = [...page.matchAll(new RegExp('<label\\b([^>]*)\\bfor="' + esc(id) + '"[^>]*>([^<]*)</label>', 'g'))];
      assert.equal(labels.length, 1, id + ': exactly one label points at it');
      assert.equal(labels[0][2], text, id + ': the label is the visible caption, with its unit / context');
      assert.match(labels[0][1], /class="ctrl-lbl"/, id + ': the caption keeps its visual class');
      assert.equal(count(page, new RegExp('\\bid="' + esc(id) + '"', 'g')), 1, id + ': the id is unique in the page');
      assert.equal(count(page, new RegExp('<(?:select|input|textarea)\\b[^>]*\\bid="' + esc(id) + '"', 'g')), 1, id + ': the target is a form control');
    }
  });

  test('EC-09 ' + name + ': no unassociated caption is left in the Ampacity, Conduit Fill, Voltage Drop, Box Fill and Wire Sizer panels', () => {
    const panels = panelsOf(outsideBlock(file));
    assert.ok(!panels.includes('<span class="ctrl-lbl">'), 'a caption without a control is back');
    const targets = [...panels.matchAll(/<label class="ctrl-lbl" for="([^"]+)">/g)].map((m) => m[1]);
    assert.equal(targets.length, 41); assert.equal(new Set(targets).size, 41, 'no two captions share a control');
    for (const id of targets) assert.equal(count(panels, new RegExp('<(?:select|input)\\b[^>]*\\bid="' + esc(id) + '"', 'g')), 1, id + ' is a control of the same panels');
  });

  test('EC-09 ' + name + ': existing help text is bound with aria-describedby to a unique element; Reset / Save buttons name their calculator', () => {
    const page = outsideBlock(file);
    for (const [id, hint] of DESCRIBED) {
      assert.match(page, new RegExp('<(?:select|input)\\b[^>]*\\bid="' + id + '"[^>]*\\baria-describedby="' + hint + '"'), id);
      assert.equal(count(page, new RegExp('\\bid="' + hint + '"', 'g')), 1, hint + ' exists once');
    }
    for (const [call, label, visible] of BUTTONS) {
      assert.ok(page.includes('aria-label="' + label + '" onclick="' + call + '">' + visible + '</button>'), label);
      assert.ok(label.includes(visible), 'the accessible name contains the visible text');
    }
    assert.ok(page.includes('aria-label="Save Wireway Fill preset"'));
    // the Box Fill help buttons keep their own names and expanded state
    for (const key of ['gang', 'ring', 'custom', 'yoke', 'clamps', 'egc']) assert.match(page, new RegExp('<button type="button" class="bf-help-btn" id="bfHelpBtn-' + key + '" aria-label="[^"]+" aria-expanded="false" aria-controls="bfHelp-' + key + '"'));
  });

  test('EC-09 ' + name + ': a Wire Sizer refusal marks the field it is about (aria-invalid + aria-errormessage -> role=alert) and clears it again', () => {
    const page = outsideBlock(file);
    const at = page.indexOf('function wsCalc('); assert.ok(at > 0);
    let depth = 0, end = -1;
    for (let j = page.indexOf('{', at); j < page.length; j++) { if (page[j] === '{') depth++; else if (page[j] === '}' && --depth === 0) { end = j + 1; break; } }
    const els = {};
    const el = (id) => els[id] || (els[id] = { value: '', style: {}, innerHTML: '', textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; } });
    const values = { wsLoad: '20', wsContinuous: '30', wsCircuitType: 'BRANCH_CIRCUIT', wsDwelling: '', wsMaterial: 'cu', wsHundredPct: 'no', wsFeet: '', wsVoltage: '120', wsPhase: '1', wsBundle: '1.00', wsTemp: '86', wsMaxVD: '3', wsInsul: 'thhn' };
    for (const [id, v] of Object.entries(values)) el(id).value = v;
    const wsCalc = new Function('document', 'window', 'EC', page.slice(at, end) + '\nreturn wsCalc;')({ getElementById: el }, {}, { wireSizing });   // eslint-disable-line no-new-func
    wsCalc();   // continuous portion larger than the load: INVALID_CONTINUOUS_LOAD
    assert.deepEqual(el('wsContinuous').attrs, { 'aria-invalid': 'true', 'aria-errormessage': 'wsError' });
    assert.deepEqual(el('wsLoad').attrs, {}); assert.deepEqual(el('wsFeet').attrs, {});
    assert.match(el('wsResult').innerHTML, /^<div id="wsError" role="alert"[^>]*>Cannot size: INVALID_CONTINUOUS_LOAD<\/div>$/);
    el('wsLoad').value = '';   // nothing to size: the mark is removed together with the message
    wsCalc();
    assert.deepEqual(el('wsContinuous').attrs, {}); assert.ok(!el('wsResult').innerHTML.includes('wsError'));
  });
}

test('EC-09: the two pages carry identical markup for these panels (behaviour outside the calculator block matches)', () => {
  const [core, hosted] = PAGES.map(([, file]) => outsideBlock(file));
  assert.equal(panelsOf(hosted), panelsOf(core));
  const wireway = (page) => page.slice(page.indexOf('<label class="ctrl-lbl" for="wwWidth">'), page.indexOf('id="ww-fav-list"'));
  assert.ok(wireway(core).length > 0); assert.equal(wireway(hosted), wireway(core));
});
