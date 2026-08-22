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
    // Guards the specific root cause rather than the symptom.
    const body = html.slice(html.lastIndexOf('function wsCalc'));
    const matAt = body.indexOf("var mat");
    const useAt = body.indexOf("mat === 'al'");
    assert.ok(matAt > -1 && useAt > -1, 'expected both the assignment and the use');
    assert.ok(matAt < useAt,
      '`mat` is used before it is assigned; var hoisting will make it undefined');
    assert.strictEqual((body.match(/var mat\s*=/g) || []).length, 1,
      'a duplicate `var mat` assignment reintroduces the ordering hazard');
  });
});
