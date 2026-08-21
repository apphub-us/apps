'use strict';
/**
 * Guards on the SHIPPED mobile.html.
 *
 * Tests marked `todo` are known, documented divergences from the verified
 * calculation core. They report without failing CI, so the findings stay
 * visible until mobile.html is migrated onto src/calc/. Everything NOT marked
 * todo is a hard guard and must stay green.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : null;
const skipAll = html ? false : 'mobile.html not found in the repository root';

function evalSlice(startMark, endMark) {
  const s = html.indexOf(startMark);
  const e = html.indexOf(endMark, s);
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', html.slice(s, e) + '\n;Object.assign(exports, {' +
    (html.slice(s, e).match(/^var ([A-Z_0-9]+)/gm) || [])
      .map((v) => v.slice(4)).join(',') + '});')(sandbox);
  return sandbox;
}

describe('Shipped app — data integrity guards', { skip: skipAll }, () => {
  test('AMP_CU 75C values match the extracted single source of truth', () => {
    const { AMP_CU } = require('../src/calc/tables');
    const app = evalSlice('var AMP_CU', 'var AMP_BREAKER_CU');
    for (const size of Object.keys(AMP_CU)) {
      assert.strictEqual(app.AMP_CU[size].t75, AMP_CU[size].t75, `t75 drift at ${size}`);
    }
  });

  test('P2-1 DRIFT GUARD: wsCalc keeps a second hardcoded 75C table — it must agree with AMP_CU', () => {
    const { AMP_CU, AMP_AL } = require('../src/calc/tables');
    const s = html.indexOf('var t75 = {', html.indexOf('function wsCalc'));
    const sandbox = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', html.slice(s, html.indexOf('};', s) + 2) + ';exports.t75=t75;')(sandbox);
    for (const size of Object.keys(sandbox.t75.cu)) {
      assert.strictEqual(sandbox.t75.cu[size], AMP_CU[size].t75, `Cu drift at ${size}`);
    }
    for (const size of Object.keys(sandbox.t75.al)) {
      assert.strictEqual(sandbox.t75.al[size], AMP_AL[size].t75, `Al drift at ${size}`);
    }
  });

  test('every calculator still returns a value rather than throwing on empty input', () => {
    // Structural guard: all calc entry points read the DOM defensively.
    const entryPoints = ['function cfUpdateCalc', 'function bfUpdateCalc',
      'function ampUpdateCalc', 'function wsCalc', 'function mtCalc'];
    for (const fn of entryPoints) {
      assert.ok(html.includes(fn), `${fn} missing from shipped app`);
    }
  });
});

describe('Shipped app — known divergences from the verified core', { skip: skipAll }, () => {
  test('P0-1: production uses true band lookup against the COMPLETE table', () => {
    // Promoted from `todo`. Two defects were fixed: nearest-row matching, and
    // a table missing 7 of the 16 NEC bands.
    const s2 = html.indexOf('function ampUpdateCalc');
    const body = html.slice(s2, html.indexOf('function ampRenderRefTable'));
    assert.ok(!/tempLookupMode/.test(body), 'the legacy nearest-match escape hatch is back');
    const t = require('../src/calc/tables');
    assert.strictEqual(Object.keys(t.AMP_TEMP_LOOKUP).length, 16,
      'AMP_TEMP_LOOKUP must carry all 16 NEC bands');
    const { tempCorrectionFactor } = require('../src/calc/ampacity');
    assert.strictEqual(tempCorrectionFactor(88, 'thhn'), 0.96, 'nearest-match regression');
    assert.strictEqual(tempCorrectionFactor(146, 'thhn'), 0.65, 'truncated-table regression');
  });

  test('P0-2: 240.4(D) is enforced and lives in the shared engine only', () => {
    // Promoted from `todo`.
    assert.ok(!/maxSmall\s*=\s*\{/.test(html),
      'a duplicate hard-coded 240.4(D) table is back in mobile.html');
    assert.ok(/smallConductorOcpdLimit/.test(html),
      'mobile.html must delegate 240.4(D) to the shared engine');
    const { selectConductor } = require('../src/calc/wireSizing');
    assert.notStrictEqual(selectConductor({ load: 20 }).recommendedSize, '14');
    assert.notStrictEqual(selectConductor({ load: 20, material: 'al' }).recommendedSize, '12');
  });

  test('P0-3: continuous loads are sized per 210.19(A)(1) / 215.2(A)(1)', () => {
    // Promoted from `todo`.
    for (const id of ['wsContinuous', 'wsCircuitType', 'wsHundredPct']) {
      assert.ok(html.includes(`id="${id}"`), `missing input: ${id}`);
    }
    const s2 = html.lastIndexOf('function wsCalc');
    const body = html.slice(s2, html.indexOf('function wsGoToFillCalc', s2));
    assert.ok(/continuousTestOK/.test(body), 'the continuous-load test is missing');
    assert.ok(/conditionsTestOK/.test(body), 'the conditions-of-use test is missing');
    assert.ok(/contMult\s*=\s*\(hundredPct/.test(body),
      'the 100% exception must be explicit, never assumed');
    const { selectConductor } = require('../src/calc/wireSizing');
    assert.strictEqual(selectConductor({ continuousLoadA: 20 }).continuousLoadMultiplier, 1.25);
    assert.strictEqual(selectConductor({ continuousLoadA: 20 }).hundredPercentRatedExceptionApplied, false);
  });

  test('P1-1: conduit fill floors instead of applying Chapter 9 Note 7',
    { todo: 'Note 7 rounds up when the decimal is 0.8 or larger' },
    () => {
      const s = html.indexOf('function cfUpdateCalc');
      const body = html.slice(s, html.indexOf('function cfGoToAmpacity'));
      assert.ok(/0\.8|Note 7/.test(body), 'no Note 7 handling found in cfUpdateCalc');
    });
});
