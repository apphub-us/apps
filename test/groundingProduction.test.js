'use strict';
/**
 * Production-path tests for the shipped Grounding calculator.
 *
 * These execute the REAL `gndCalc()` from mobile.html against a stub DOM and
 * read what it renders into the EGC panel, the GEC panel and the note. The
 * decisive guards follow the migration pattern: a poisoned engine result must
 * be rendered verbatim across BOTH result sections, and one Calculate action
 * must make exactly one shared-engine decision call.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const FIELDS = ['gnd-ocpd', 'gnd-egc-mat', 'gnd-req', 'gnd-inst', 'gnd-svc',
  'gnd-svc-mat', 'gnd-electrode', 'gnd-egc-out', 'gnd-gec-out', 'gnd-note'];

const DEFAULTS = {
  'gnd-ocpd': '100', 'gnd-egc-mat': 'cu', 'gnd-req': '3/0', 'gnd-inst': '3/0',
  'gnd-svc': '3/0', 'gnd-svc-mat': 'cu', 'gnd-electrode': 'water',
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
  FIELDS.forEach((id) => { els[id] = { value: '', innerHTML: '', style: {} }; });
  const doc = { getElementById: (id) => els[id] || null };
  const win = {};
  const s = html.indexOf('<!-- EC-CALC:START');
  const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e);
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  // eslint-disable-next-line no-new-func
  new Function('window', block)(win);

  const deps = fnBody('gndLabel') + fnBody('gndRow');
  const api = {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'EC', 'exports',
    deps + fnBody('gndCalc') + ';exports.gndCalc=gndCalc;')(doc, win, win.EC, api);
  return { els, api, EC: win.EC };
}

function run(inputs) {
  Object.entries({ ...DEFAULTS, ...inputs }).forEach(([k, v]) => { harness.els[k].value = v; });
  harness.els['gnd-egc-out'].innerHTML = '';
  harness.els['gnd-gec-out'].innerHTML = '';
  harness.els['gnd-note'].innerHTML = '';
  harness.api.gndCalc();
  return {
    egc: harness.els['gnd-egc-out'].innerHTML,
    gec: harness.els['gnd-gec-out'].innerHTML,
    note: harness.els['gnd-note'].innerHTML,
  };
}

describe('Production Grounding — full migration to the shared engine', { skip: skipAll }, () => {
  before(() => { harness = buildHarness(); });

  test('BEHAVIORAL GUARD: both panels render the engine result, not local lookups', () => {
    const real = harness.EC.grounding.calculateGrounding;
    try {
      harness.EC.grounding.calculateGrounding = () => ({
        ok: true,
        egc: {
          mode: 'EGC', tableReference: 'SYNTHETIC TABLE A', ocpdRating: 100,
          material: 'cu', baseSize: '700', requiredPhaseSize: '3/0',
          installedPhaseSize: '3/0', ratio: 9.87, upsizeApplied: true,
          requiredCM: 123456789, finalSize: '750', exceedsAvailableSizes: false,
          rule: 'SYNTHETIC RULE B',
        },
        gec: {
          mode: 'GEC', tableReference: 'SYNTHETIC TABLE C', serviceSize: '3/0',
          serviceMaterial: 'cu', copper: '600', aluminum: '700',
          electrode: 'rod', capSize: '6', capReference: 'SYNTHETIC REF D',
          capApplied: true, finalCopper: '6',
        },
      });
      const out = run({ 'gnd-electrode': 'rod' });
      for (const marker of ['700 kcmil', 'SYNTHETIC TABLE A', '\u00D7 9.87',
        '750 kcmil', 'SYNTHETIC RULE B']) {
        assert.ok(out.egc.includes(marker),
          'poisoned EGC field missing: ' + marker
          + ' — a local Table 250.122 path is deciding instead of the engine');
      }
      for (const marker of ['600 kcmil', 'SYNTHETIC TABLE C', '700 kcmil Al',
        'SYNTHETIC REF D', '#6 AWG Cu']) {
        assert.ok(out.gec.includes(marker),
          'poisoned GEC field missing: ' + marker
          + ' — a local Table 250.66 path is deciding instead of the engine');
      }
    } finally {
      harness.EC.grounding.calculateGrounding = real;
    }
  });

  test('BEHAVIORAL GUARD: one Calculate makes exactly ONE shared decision call', () => {
    const real = harness.EC.grounding.calculateGrounding;
    let calls = 0;
    try {
      harness.EC.grounding.calculateGrounding = (req) => { calls++; return real(req); };
      run({});
      assert.strictEqual(calls, 1,
        'the whole panel — EGC, upsize, GEC and cap — must be one engine call');
    } finally {
      harness.EC.grounding.calculateGrounding = real;
    }
  });

  test('the engine request carries every UI field faithfully', () => {
    const real = harness.EC.grounding.calculateGrounding;
    let seen = null;
    try {
      harness.EC.grounding.calculateGrounding = (req) => { seen = req; return real(req); };
      run({ 'gnd-ocpd': '400', 'gnd-egc-mat': 'al', 'gnd-req': '1/0',
        'gnd-inst': '4/0', 'gnd-svc': '500', 'gnd-svc-mat': 'al',
        'gnd-electrode': 'ufer' });
    } finally {
      harness.EC.grounding.calculateGrounding = real;
    }
    assert.deepStrictEqual(seen, {
      ocpdRating: 400, egcMaterial: 'al', requiredPhaseSize: '1/0',
      installedPhaseSize: '4/0', serviceSize: '500', serviceMaterial: 'al',
      electrode: 'ufer',
    });
  });

  test('representative EGC: 100 A copper, no upsize', () => {
    const out = run({});
    assert.ok(out.egc.includes('#8 AWG'), 'Table 250.122: 100 A -> #8 Cu');
    assert.ok(out.egc.includes('not applied'));
    assert.ok(!out.note.includes('250.122(B) requires'),
      'the upsize tip sentence must follow the engine flag');
  });

  test('representative aluminum EGC renders the Al column', () => {
    const out = run({ 'gnd-egc-mat': 'al' });
    assert.ok(out.egc.includes('#6 AWG'), 'Table 250.122: 100 A -> #6 Al');
  });

  test('250.122(B) proportional upsize renders ratio and final size from the engine', () => {
    // 100 A Cu base #8 (16510 CM); 1/0 -> 4/0 ratio 2.0038; need 33083 -> #4.
    const out = run({ 'gnd-req': '1/0', 'gnd-inst': '4/0' });
    assert.ok(out.egc.includes('\u00D7 2.00'));
    assert.ok(out.egc.includes('#4 AWG'));
    assert.ok(out.egc.includes('250.122(B)'));
    assert.ok(out.note.includes('250.122(B) requires the EGC to grow'));
  });

  test('reversed sizes (installed smaller than required) never downsize the EGC', () => {
    const out = run({ 'gnd-req': '4/0', 'gnd-inst': '1/0' });
    assert.ok(out.egc.includes('#8 AWG'), 'base EGC stands');
    assert.ok(out.egc.includes('not applied'));
  });

  test('CONFIRMED DEFECT FIX: an unmeetable proportional requirement is explicit', () => {
    // OCPD 2000 A -> base 250 kcmil Cu; #4 -> 750 kcmil is x17.97, requiring
    // ~4.49M CM — above every listed size. Legacy silently rendered the BASE
    // size as "EGC after upsize"; the shipped app must now say so instead.
    // The message must stay NEUTRAL: this calculator does not implement
    // parallel-EGC sizing or engineered alternatives, so it must state the
    // limit without prescribing a solution it never calculated.
    const real = harness.EC.grounding.calculateGrounding;
    let engineResult = null;
    let out;
    try {
      harness.EC.grounding.calculateGrounding = (req) => {
        engineResult = real(req);
        return engineResult;
      };
      out = run({ 'gnd-ocpd': '2000', 'gnd-req': '4', 'gnd-inst': '750' });
    } finally {
      harness.EC.grounding.calculateGrounding = real;
    }
    // engine diagnostic state preserved exactly
    assert.strictEqual(engineResult.egc.finalSize, null);
    assert.strictEqual(engineResult.egc.exceedsAvailableSizes, true);
    assert.strictEqual(engineResult.egc.requiredCM, 4492094,
      '250000 x (750000/41740) — the proportional requirement is kept');
    // rendered result: explicit, neutral, never the dangerous fallback
    assert.ok(out.egc.includes('exceeds table'));
    assert.ok(out.egc.includes(
      'exceeds the largest conductor size supported by this calculator'));
    assert.ok(out.egc.includes('review the applicable grounding design requirements'));
    const afterUpsize = out.egc.slice(out.egc.indexOf('EGC after upsize'));
    assert.ok(!afterUpsize.includes('250 kcmil'),
      'the old dangerous fallback: base size rendered as the upsized answer');
    for (const banned of ['parallel EGC', 'engineered design']) {
      assert.ok(!out.egc.includes(banned) && !out.gec.includes(banned)
        && !out.note.includes(banned),
        'unsupported prescription in the shipped output: ' + banned);
    }
  });

  test('representative GEC renders both columns and the table basis', () => {
    // 3/0 Cu service (167800 CM) -> row 3: 4 Cu / 2 Al.
    const out = run({});
    assert.ok(out.gec.includes('#4 AWG Cu'));
    assert.ok(out.gec.includes('#2 AWG Al'));
    assert.ok(out.gec.includes('Table 250.66'));
  });

  test('aluminum service uses the aluminum table', () => {
    // 3/0 Al service (167800 CM) -> Al table row 2: 6 Cu / 4 Al.
    const out = run({ 'gnd-svc-mat': 'al' });
    assert.ok(out.gec.includes('#6 AWG Cu'));
    assert.ok(out.gec.includes('#4 AWG Al'));
  });

  test('rod cap applies when beneficial and shows the 250.66(A) basis', () => {
    // 500 kcmil Cu service -> 1/0 Cu from table; rod caps at #6.
    const out = run({ 'gnd-svc': '500', 'gnd-electrode': 'rod' });
    assert.ok(out.gec.includes('Permitted reduction'));
    assert.ok(out.gec.includes('#6 AWG Cu'));
    assert.ok(out.gec.includes('250.66(A)'));
  });

  test('ring cap on a small service is correctly "no benefit"', () => {
    // #14 Cu service -> #8 Cu from table; ring cap #2 is bigger: no benefit.
    const out = run({ 'gnd-svc': '14', 'gnd-electrode': 'ring' });
    assert.ok(out.gec.includes('no benefit'));
    assert.ok(out.gec.includes('#8 AWG'));
  });

  test('structural: gndCalc owns no tables, CM math, or size scans', () => {
    const s = html.indexOf('function gndCalc');
    const body = html.slice(s, html.indexOf('var selectedGroundingTopic'));
    for (const banned of ['GND_EGC', 'GND_CM[', 'GND_GEC', 'GND_SIZES[',
      '/ GND_CM', '* ratio', '>= need', "'rod'  { capped", "= '6'", "= '4'",
      "= '2'", '<= tbl', '1.0001', 'for (var']) {
      assert.ok(!body.includes(banned),
        'electrical logic is back in gndCalc: ' + banned);
    }
    assert.ok(body.includes('EC.grounding.calculateGrounding'));
    const hand = html.slice(html.indexOf('<!-- EC-CALC:END -->'));
    assert.ok(!/var GND_EGC = \[/.test(hand),
      'a hand copy of Table 250.122 is back in mobile.html');
    assert.ok(!/var GND_CM = \{/.test(hand),
      'a hand copy of the circular-mil map is back in mobile.html');
    assert.ok(!/var GND_GEC_CU = \[/.test(hand),
      'a hand copy of Table 250.66 is back in mobile.html');
    assert.ok(/var GND_SIZES = EC\.tables\.GND_SIZES/.test(hand),
      'the size-select population must alias the shared table');
  });
});
