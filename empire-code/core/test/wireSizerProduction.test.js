'use strict';
/**
 * Production-path tests for the shipped Wire Sizer.
 *
 * These execute the REAL `wsCalc()` from mobile.html against a stub DOM and
 * read the recommendation it renders. Structural checks — grepping the source
 * for a pattern — cannot catch this class of defect: the NYC dwelling-feeder
 * floor was present, spelled correctly, and still wrong, because `mat` was
 * read before it was assigned and `var` hoisting made that silent.
 *
 * Every case is also compared against EC.wireSizing.selectConductor() so the
 * production path and the shared engine cannot drift apart again.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const FIELDS = ['wsLoad', 'wsContinuous', 'wsCircuitType', 'wsDwelling', 'wsDwellingWrap',
  'wsHundredPct', 'wsFeet', 'wsVoltage', 'wsPhase', 'wsMaterial', 'wsBundle',
  'wsTemp', 'wsInsul', 'wsMaxVD', 'wsMaxVDNote', 'wsResult'];

const DEFAULTS = {
  wsVoltage: '208', wsPhase: '1', wsInsul: 'thhn', wsBundle: '1.00',
  wsTemp: '86', wsMaxVD: '5', wsFeet: '', wsContinuous: '', wsHundredPct: 'no',
  wsCircuitType: 'BRANCH_CIRCUIT', wsDwelling: '',
};

let harness = null;

/** Load the injected engine and the real wsCalc, wired to a stub DOM. */
function buildHarness() {
  function fnBody(name, from) {
    const i = html.indexOf('function ' + name, from || 0);
    let depth = 0; let started = false;
    for (let j = i; j < html.length; j++) {
      if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') {
        depth--;
        if (started && depth === 0) return html.slice(i, j + 1);
      }
    }
    return '';
  }
  function varBlock(name) {
    const i = html.indexOf('var ' + name);
    let depth = 0; const start = html.indexOf('{', i);
    for (let j = start; j < html.length; j++) {
      if (html[j] === '{') depth++;
      else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(i, html.indexOf(';', j) + 1); }
    }
    return '';
  }

  const els = {};
  FIELDS.forEach((id) => { els[id] = { value: '', innerHTML: '', style: {} }; });
  const doc = { getElementById: (id) => els[id] || null };
  const win = {};

  // Boot the injected engine exactly as the browser does.
  const s = html.indexOf('<!-- EC-CALC:START');
  const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e);
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  // eslint-disable-next-line no-new-func
  new Function('window', block)(win);

  // Only the dependencies wsCalc reads from module scope.
  const deps = 'var AMP_CU=EC.tables.AMP_CU,AMP_AL=EC.tables.AMP_AL,'
    + 'VD_CM=EC.tables.VD_CM,VD_K=EC.tables.VD_K;'
    + 'function ampGetBaseCol(i){return i==="tw"?"t60":i==="thw"?"t75":"t90";}'
    + 'function ampGetTempFactor(a,i){var f=EC.ampacity.tempCorrectionFactor(a,i);return f===null?0:f;}'
    + varBlock('AMP_TYPICAL_CU') + varBlock('AMP_TYPICAL_AL');

  const api = {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'EC', 'exports',
    deps + fnBody('wsCalc', html.lastIndexOf('function wsCalc')) + ';exports.wsCalc=wsCalc;')(
    doc, win, win.EC, api);

  return { els, api, EC: win.EC };
}

/** Run the shipped calculator and return the size it recommends, e.g. '6'. */
function recommend(inputs) {
  Object.entries({ ...DEFAULTS, ...inputs }).forEach(([k, v]) => { harness.els[k].value = v; });
  harness.api.wsCalc();
  const m = harness.els.wsResult.innerHTML.match(/USE:\s*#?([\w/]+)\s+AWG/i);
  return m ? m[1] : null;
}

/** Circular mils, for "not smaller than" comparisons that respect AWG order. */
function cm(size) {
  return harness.EC.tables.VD_CM[size];
}

describe('Production Wire Sizer — NYC dwelling-feeder minimum', { skip: skipAll }, () => {
  before(() => { harness = buildHarness(); });

  test('copper: a small NYC dwelling feeder is never smaller than #8', () => {
    const got = recommend({
      wsLoad: '20', wsMaterial: 'cu', wsCircuitType: 'FEEDER', wsDwelling: 'yes',
    });
    assert.strictEqual(got, '8');
    assert.ok(cm(got) >= cm('8'), `${got} is smaller than the #8 Cu floor`);
  });

  test('aluminium: a small NYC dwelling feeder is never smaller than #6', () => {
    // The regression: `mat` was read before assignment, so aluminium silently
    // received the copper floor and this returned #8.
    const got = recommend({
      wsLoad: '20', wsMaterial: 'al', wsCircuitType: 'FEEDER', wsDwelling: 'yes',
    });
    assert.strictEqual(got, '6');
    assert.ok(cm(got) >= cm('6'), `${got} is smaller than the #6 Al floor`);
    assert.notStrictEqual(got, '8', 'aluminium received the copper floor');
  });

  test('the two materials get different floors', () => {
    const cu = recommend({ wsLoad: '20', wsMaterial: 'cu', wsCircuitType: 'FEEDER', wsDwelling: 'yes' });
    const al = recommend({ wsLoad: '20', wsMaterial: 'al', wsCircuitType: 'FEEDER', wsDwelling: 'yes' });
    assert.notStrictEqual(cu, al,
      'copper and aluminium must not share a floor — that was the defect');
  });

  test('production agrees with the shared engine on both materials', () => {
    for (const [uiMat, engineMat] of [['cu', 'cu'], ['al', 'al']]) {
      const production = recommend({
        wsLoad: '20', wsMaterial: uiMat, wsCircuitType: 'FEEDER', wsDwelling: 'yes',
      });
      const engine = harness.EC.wireSizing.selectConductor({
        noncontinuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: true, material: engineMat,
      });
      assert.strictEqual(production, engine.finalSelectedConductor,
        `production and engine disagree for ${uiMat}`);
      assert.strictEqual(production, engine.nycDwellingFeederMinimumSize,
        `the floor should govern at this load for ${uiMat}`);
    }
  });

  test('the floor does not apply to a branch circuit', () => {
    const got = recommend({
      wsLoad: '20', wsMaterial: 'al', wsCircuitType: 'BRANCH_CIRCUIT', wsDwelling: 'yes',
    });
    assert.strictEqual(got, '10', 'a branch circuit must follow the ordinary rules');
  });

  test('the floor does not apply to a feeder that does not serve a dwelling', () => {
    assert.strictEqual(recommend({
      wsLoad: '20', wsMaterial: 'al', wsCircuitType: 'FEEDER', wsDwelling: 'no',
    }), '10');
  });

  test('the floor is not applied when the dwelling question is unanswered', () => {
    assert.strictEqual(recommend({
      wsLoad: '20', wsMaterial: 'al', wsCircuitType: 'FEEDER', wsDwelling: '',
    }), '10');
  });

  test('a larger calculated conductor still governs over the floor', () => {
    const got = recommend({
      wsLoad: '150', wsMaterial: 'al', wsCircuitType: 'FEEDER', wsDwelling: 'yes',
    });
    assert.ok(cm(got) > cm('6'), `expected larger than the #6 floor, got ${got}`);
  });

  test('material is read before it is used — no hoisting hazard remains', () => {
    // Guards the specific root cause rather than the symptom. Post-migration
    // the NYC floor is decided in the shared engine, so the material's first
    // production use is the engine request itself.
    const body = html.slice(html.lastIndexOf('function wsCalc'));
    const matAt = body.indexOf('var mat');
    const useAt = body.indexOf('material: mat');
    assert.ok(matAt > -1 && useAt > -1, 'expected both the assignment and the use');
    assert.ok(matAt < useAt,
      '`mat` is used before it is assigned; var hoisting will make it undefined');
    assert.strictEqual((body.match(/var mat\s*=/g) || []).length, 1,
      'a duplicate `var mat` assignment reintroduces the ordering hazard');
    assert.ok(!/nycMinSize/.test(body.slice(0, body.indexOf('function wsGoToFillCalc'))),
      'a local NYC minimum decision is back inside wsCalc');
  });
});

describe('Production Wire Sizer — full migration to the shared engine', { skip: skipAll }, () => {
  before(() => { if (!harness) harness = buildHarness(); });

  test('BEHAVIORAL GUARD: the rendered winner comes from the engine result, not a local loop', () => {
    // Poison the engine: make selectConductor return a fixed, absurd winner.
    // A wsCalc that still ran its own candidate search would ignore this and
    // render its own choice; the thin adapter must render the poison. This
    // fails the moment production reintroduces an independent sizing
    // algorithm, regardless of how it is spelled.
    const real = harness.EC.wireSizing.selectConductor;
    try {
      harness.EC.wireSizing.selectConductor = () => ({
        ok: true,
        finalSelectedConductor: '3/0',
        temperatureCorrectionFactor: 1,
        evaluated: [{
          size: '3/0', baseAmpacity: 200, terminalLimitedAmpacity: 200,
          calculatedAmpacity: 200, ampacityOK: true, ocpdOK: true, vdOK: true,
          voltDropPercent: 1.11, voltDropVolts: 2.31, voltageAtLoad: 205.69,
        }],
      });
      const got = recommend({ wsLoad: '20', wsFeet: '10', wsMaterial: 'cu' });
      assert.strictEqual(got, '3/0',
        'wsCalc rendered its own winner — an independent selection loop is back');
      assert.ok(harness.els.wsResult.innerHTML.includes('★'),
        'the winner row must come from the engine evaluated list');
    } finally {
      harness.EC.wireSizing.selectConductor = real;
    }
  });

  test('BEHAVIORAL GUARD: every wsCalc run calls the shared engine exactly once', () => {
    const real = harness.EC.wireSizing.selectConductor;
    let calls = 0;
    try {
      harness.EC.wireSizing.selectConductor = (req) => { calls++; return real(req); };
      recommend({ wsLoad: '60', wsFeet: '120', wsMaterial: 'cu' });
      assert.strictEqual(calls, 1, 'expected exactly one engine call per calculation');
    } finally {
      harness.EC.wireSizing.selectConductor = real;
    }
  });

  test('the engine request carries every UI field faithfully', () => {
    const real = harness.EC.wireSizing.selectConductor;
    let seen = null;
    try {
      harness.EC.wireSizing.selectConductor = (req) => { seen = req; return real(req); };
      recommend({
        wsLoad: '90', wsContinuous: '40', wsFeet: '150', wsVoltage: '480',
        wsPhase: '3', wsMaterial: 'al', wsBundle: '0.8', wsTemp: '104',
        wsMaxVD: '3', wsInsul: 'thw', wsCircuitType: 'FEEDER',
        wsDwelling: 'yes', wsHundredPct: 'yes',
      });
    } finally {
      harness.EC.wireSizing.selectConductor = real;
    }
    assert.deepStrictEqual(seen, {
      load: 90, continuousLoad: 40, feet: 150, voltage: 480, phase: 3,
      material: 'al', insulation: 'thw', ambientF: 104, adjustmentFactor: 0.8,
      maxVoltDropPercent: 3, terminalRatingC: 75, circuitType: 'FEEDER',
      assemblyRatedFor100PercentContinuousOperation: true,
      jurisdiction: 'NYC', feedsDwellingUnit: true,
    });
  });

  test('ampacity-governed case: short run, production matches the engine', () => {
    const got = recommend({ wsLoad: '100', wsFeet: '20', wsMaterial: 'cu' });
    const eng = harness.EC.wireSizing.selectConductor({
      load: 100, feet: 20, voltage: 208, phase: 1, material: 'cu',
      insulation: 'thhn', terminalRatingC: 75, jurisdiction: 'NYC',
    });
    assert.strictEqual(got, eng.finalSelectedConductor);
    assert.strictEqual(eng.governingConstraint, 'AMPACITY');
  });

  test('voltage-drop-governed case: long run upsizes past the ampacity size', () => {
    const got = recommend({ wsLoad: '60', wsFeet: '400', wsVoltage: '208', wsMaterial: 'cu' });
    const eng = harness.EC.wireSizing.selectConductor({
      load: 60, feet: 400, voltage: 208, phase: 1, material: 'cu',
      insulation: 'thhn', terminalRatingC: 75, jurisdiction: 'NYC',
    });
    assert.strictEqual(got, eng.finalSelectedConductor);
    assert.strictEqual(eng.governingConstraint, 'VOLTAGE_DROP');
    assert.ok(cm(eng.finalSelectedConductor) > cm(eng.sizeRequiredByAmpacity),
      'voltage drop should have pushed past the ampacity-only size');
  });

  test('terminal-limit case: 90C insulation is still capped at the 75C column', () => {
    // 55 A on THHN copper: #8 THHN base is 55 A, but 110.14(C) caps it at the
    // 75C column (50 A), so #8 must be rejected and #6 selected. A production
    // path that used the 90C column uncapped would return #8.
    const got = recommend({ wsLoad: '55', wsInsul: 'thhn', wsMaterial: 'cu' });
    assert.strictEqual(got, '6', 'terminal limiting was lost in migration');
    const eng = harness.EC.wireSizing.selectConductor({
      load: 55, material: 'cu', insulation: 'thhn', terminalRatingC: 75,
    });
    assert.strictEqual(got, eng.finalSelectedConductor);
    const rejected = eng.evaluated.find((e) => e.size === '8');
    assert.strictEqual(rejected.terminalLimit, 50);
    assert.strictEqual(rejected.ampacityOK, false);
  });

  test('continuous-load case: production applies 125% through the engine', () => {
    // 40 A continuous alone: 1.25 x 40 = 50 A -> #8 Cu (t75 = 50) exactly.
    const got = recommend({ wsLoad: '40', wsContinuous: '40', wsMaterial: 'cu' });
    const eng = harness.EC.wireSizing.selectConductor({
      load: 40, continuousLoad: 40, material: 'cu', insulation: 'thhn',
    });
    assert.strictEqual(got, eng.finalSelectedConductor);
    assert.strictEqual(eng.continuousLoadSizingRequirementA, 50);
  });

  test('no-qualifier case renders the failure card, never loops forever', () => {
    recommend({ wsLoad: '9000', wsMaterial: 'cu' });
    assert.ok(harness.els.wsResult.innerHTML.includes('No single conductor qualifies'));
  });

  test('the null-correction combo (140F + TW) still renders the all-fail table', () => {
    recommend({ wsLoad: '30', wsTemp: '140', wsInsul: 'tw', wsMaterial: 'cu' });
    const out = harness.els.wsResult.innerHTML;
    assert.ok(out.includes('No single conductor qualifies'));
    assert.ok(out.includes('×0.00×'), 'the zero-factor rows disappeared from the table');
  });

  test('structural: wsCalc owns no sizing loop, tables, or VD formula', () => {
    const s2 = html.lastIndexOf('function wsCalc');
    const body = html.slice(s2, html.indexOf('function wsGoToFillCalc', s2));
    for (const banned of ['var sizes =', 'VD_K[', 'VD_CM[', '1.732',
      'smallConductorOcpdLimit', 'STANDARD_OCPD', 'nycMinSize', 'var t75',
      'contReq', 'tableAtTerminal']) {
      assert.ok(!body.includes(banned), 'electrical logic is back in wsCalc: ' + banned);
    }
    assert.ok(body.includes('EC.wireSizing.selectConductor'));
  });
});
