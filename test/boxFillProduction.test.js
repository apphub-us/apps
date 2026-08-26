'use strict';
/**
 * Production-path tests for the shipped Box Fill calculator.
 *
 * These execute the REAL `bfUpdateCalc()` from mobile.html against a stub DOM
 * and read what it renders. The decisive guards follow the Wire Sizer lesson:
 * a poisoned engine result must be rendered verbatim (proving no hidden local
 * calculation), and one calculation must make exactly one shared-engine call.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const FIELDS = ['bfBoxType', 'bfWireSize', 'bfConductors', 'bfDevices',
  'bfClamps', 'bfEgc', 'bfExtension', 'bfResultBox', 'bfResultGrid'];

const DEFAULTS = {
  bfBoxType: 'sq_4x1_5', bfWireSize: '12', bfConductors: '3', bfDevices: '1',
  bfClamps: '0', bfEgc: '0', bfExtension: '0',
};

let harness = null;

function buildHarness() {
  function fnBody(name) {
    const i = html.indexOf('function ' + name);
    let depth = 0; let started = false;
    for (let j = i; j < html.length; j++) {
      if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') {
        depth--;
        if (started && depth === 0) return html.slice(i, j + 1);
      }
    }
    return '';
  }
  const els = {};
  FIELDS.forEach((id) => {
    els[id] = { value: '', innerHTML: '', style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } };
  });
  const doc = { getElementById: (id) => els[id] || null };
  const win = {};
  const s = html.indexOf('<!-- EC-CALC:START');
  const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e);
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  // eslint-disable-next-line no-new-func
  new Function('window', block)(win);

  const deps = 'var BF_VOL=EC.tables.BF_VOL,BF_BOXES=EC.tables.BF_BOXES;';
  const api = {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'EC', 'exports',
    deps + fnBody('bfUpdateCalc') + ';exports.bfUpdateCalc=bfUpdateCalc;')(
    doc, win, win.EC, api);
  return { els, api, EC: win.EC };
}

/** Run the shipped calculator; return the rendered grid HTML. */
function run(inputs) {
  Object.entries({ ...DEFAULTS, ...inputs }).forEach(([k, v]) => { harness.els[k].value = v; });
  harness.els.bfResultGrid.innerHTML = '';
  harness.api.bfUpdateCalc();
  return harness.els.bfResultGrid.innerHTML;
}

describe('Production Box Fill — full migration to the shared engine', { skip: skipAll }, () => {
  before(() => { harness = buildHarness(); });

  test('BEHAVIORAL GUARD: the rendered result comes from the engine, not a local formula', () => {
    // Poison the engine with an obviously synthetic structured result. A
    // bfUpdateCalc that still summed allowances locally would render its own
    // numbers; the thin adapter must render the poison verbatim.
    const real = harness.EC.boxFill.calculateBoxFill;
    try {
      harness.EC.boxFill.calculateBoxFill = () => ({
        ok: true, fits: false, boxVolume: 123.4, usedVolume: 999.99,
        remaining: -876.59, fillPercent: 810.4, maxConductors: 77,
        volPerWire: 9.25, conductorVolume: 55.5, deviceVolume: 18.5,
      });
      const out = run({});
      for (const marker of ['✗ OVER', '123.4', '999.99', '-876.59', '810.4',
        '77', '9.25', '55.50', '18.50']) {
        assert.ok(out.includes(marker),
          'poisoned field missing from render: ' + marker
          + ' — a local calculation is deciding instead of the engine');
      }
    } finally {
      harness.EC.boxFill.calculateBoxFill = real;
    }
  });

  test('BEHAVIORAL GUARD: one calculation makes exactly ONE shared-engine call', () => {
    const real = harness.EC.boxFill.calculateBoxFill;
    let calls = 0;
    try {
      harness.EC.boxFill.calculateBoxFill = (req) => { calls++; return real(req); };
      run({});
      assert.strictEqual(calls, 1);
    } finally {
      harness.EC.boxFill.calculateBoxFill = real;
    }
  });

  test('the engine request carries every UI field faithfully', () => {
    const real = harness.EC.boxFill.calculateBoxFill;
    let seen = null;
    try {
      harness.EC.boxFill.calculateBoxFill = (req) => { seen = req; return real(req); };
      run({ bfBoxType: 'oct_4x1_5', bfWireSize: '10', bfConductors: '7',
        bfDevices: '2', bfClamps: '1', bfEgc: '1', bfExtension: '6.5' });
    } finally {
      harness.EC.boxFill.calculateBoxFill = real;
    }
    assert.deepStrictEqual(seen, {
      boxKey: 'oct_4x1_5', largestWireSize: '10', numConductors: 7,
      numDevices: 2, hasClamps: true, hasEgc: true, extensionVolume: 6.5,
    });
  });

  test('worked NEC example renders through the engine: 6x#12 + device + clamps + EGC', () => {
    const out = run({ bfBoxType: 'sq_4x1_5', bfWireSize: '12', bfConductors: '6',
      bfDevices: '1', bfClamps: '1', bfEgc: '1' });
    assert.ok(out.includes('✓ FITS'));
    assert.ok(out.includes('22.50 in³'), 'used volume 22.5 expected');
    assert.ok(out.includes('25.5 in³'), 'box volume 25.5 expected');
    assert.ok(out.includes('3.00 in³'), 'remaining 3.00 expected');
  });

  test('exact fill renders FITS: five #14 in a 10.0 in³ device box', () => {
    const out = run({ bfBoxType: 'dev_3x2x2', bfWireSize: '14', bfConductors: '5',
      bfDevices: '0', bfClamps: '0', bfEgc: '0' });
    assert.ok(out.includes('✓ FITS'), 'exactly-at-capacity must pass (<=)');
    assert.ok(out.includes('0.00 in³'), 'remaining exactly zero');
    assert.ok(out.includes('100.0%'));
  });

  test('one conductor over the exact fill renders OVER', () => {
    const out = run({ bfBoxType: 'dev_3x2x2', bfWireSize: '14', bfConductors: '6',
      bfDevices: '0', bfClamps: '0', bfEgc: '0' });
    assert.ok(out.includes('✗ OVER'));
    assert.ok(out.includes('-2.00 in³'));
  });

  test('grounding and clamp allowances render from engine fields', () => {
    const out = run({ bfBoxType: 'sq_4x1_25', bfWireSize: '10', bfConductors: '4',
      bfDevices: '0', bfClamps: '1', bfEgc: '1' });
    // 4x2.5 + 2.5 + 2.5 = 15.0 of 21.0
    assert.ok(out.includes('15.00 in³'));
    assert.ok(out.includes('✓ FITS'));
  });

  test('extension volume flows through and is labelled', () => {
    const out = run({ bfBoxType: 'sq_4x1_25', bfWireSize: '12', bfConductors: '10',
      bfDevices: '1', bfClamps: '0', bfEgc: '0', bfExtension: '21' });
    assert.ok(out.includes('42.0 in³'), 'box 21 + extension 21');
    assert.ok(out.includes('(+21.0 ext)'));
    assert.ok(out.includes('✓ FITS'));
  });

  test('invalid selection keeps the legacy quiet behavior (no render, no throw)', () => {
    harness.els.bfResultGrid.innerHTML = 'UNTOUCHED';
    Object.entries({ ...DEFAULTS, bfBoxType: 'no_such_box' })
      .forEach(([k, v]) => { harness.els[k].value = v; });
    harness.api.bfUpdateCalc();
    assert.strictEqual(harness.els.bfResultGrid.innerHTML, 'UNTOUCHED');
  });

  test('structural: bfUpdateCalc owns no tables, summation, or pass/fail logic', () => {
    const s = html.indexOf('function bfUpdateCalc');
    const body = html.slice(s, html.indexOf('function bfInitRefTables'));
    for (const banned of ['* volPerWire', '* 2 *', 'box.vol', 'totalUsed',
      '<= boxVol', 'Math.floor', "'14':2", '2.25', 'BF_VOL[', 'BF_BOXES[']) {
      assert.ok(!body.includes(banned),
        'electrical logic is back in bfUpdateCalc: ' + banned);
    }
    assert.ok(body.includes('EC.boxFill.calculateBoxFill'));
    // The hand-written app may only ALIAS the shared tables, never re-declare
    // the data. (The generated engine block legitimately contains the literal.)
    const hand = html.slice(html.indexOf('<!-- EC-CALC:END -->'));
    assert.ok(!/var BF_VOL = \{/.test(hand),
      'a hand copy of the 314.16(B) volume table is back in mobile.html');
    assert.ok(!/var BF_BOXES = \{/.test(hand),
      'a hand copy of the 314.16(A) box table is back in mobile.html');
    assert.ok(/var BF_VOL = EC\.tables\.BF_VOL/.test(hand),
      'BF_VOL must alias the shared table');
  });
});
