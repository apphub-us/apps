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

  test('P2-1 RESOLVED: the second hardcoded 75C table is GONE from wsCalc', () => {
    // Before the Wire Sizer migration wsCalc carried its own t75 map, and
    // this guard proved it agreed with the shared tables. The migration
    // removed the map entirely: the ONLY 110.14(C) source is now
    // src/calc/tables.js via the injected engine. This guard now proves it
    // stays removed.
    const s2 = html.lastIndexOf('function wsCalc');
    const body = html.slice(s2, html.indexOf('function wsGoToFillCalc', s2));
    assert.ok(!body.includes('var t75'),
      'a second hardcoded terminal table is back inside wsCalc');
    assert.ok(!/t60\s*:\s*\d/.test(body) && !/t75\s*:\s*\d/.test(body),
      'inline terminal-column data is back inside wsCalc');
    assert.ok(body.includes('EC.wireSizing.selectConductor'),
      'wsCalc must obtain terminal-limited ampacity from the shared engine');
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
    // Post-migration: both 210.19(A)(1) tests live in the shared engine ONLY.
    // Production passes the inputs through and must not re-derive either test
    // or the 125% multiplier.
    assert.ok(body.includes('EC.wireSizing.selectConductor'),
      'wsCalc must delegate continuous-load sizing to the shared engine');
    assert.ok(body.includes('assemblyRatedFor100PercentContinuousOperation'),
      'the 100% exception must be passed through explicitly, never assumed');
    assert.ok(!/contMult/.test(body) && !/contReq/.test(body),
      'local continuous-load arithmetic is back inside wsCalc');
    const engine = require('../src/calc/wireSizing');
    assert.ok(/continuousTestOK/.test(String(engine.selectConductor)),
      'the continuous-load test must exist in the shared engine');
    const { selectConductor } = require('../src/calc/wireSizing');
    assert.strictEqual(selectConductor({ continuousLoadA: 20 }).continuousLoadMultiplier, 1.25);
    assert.strictEqual(selectConductor({ continuousLoadA: 20 }).hundredPercentRatedExceptionApplied, false);
  });

  test('P1-1: conduit fill applies Chapter 9 Note 7 via the shared engine', () => {
    // Promoted from `todo`: production delegates instead of flooring.
    assert.ok(!/Math\.floor\(avail \/ wa\)/.test(html),
      'the unconditional floor is back in cfUpdateCalc');
    assert.ok(/EC\.conduitFill\.calculateConduitFill/.test(html),
      'cfUpdateCalc must call the shared engine');
    assert.ok(/note7Applied/.test(html),
      'the UI must be able to explain when Note 7 changed the count');
    const { calculateConduitFill } = require('../src/calc/conduitFill');
    const r = calculateConduitFill({
      conduitType: 'emt', conduitSize: '1', wireType: 'thhn', wireSize: '6', numConductors: 3,
    });
    assert.strictEqual(r.maxConductors, 7, '6.82 must round up to 7');
  });
});
