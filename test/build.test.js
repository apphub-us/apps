'use strict';
/**
 * Build integrity — proves that the engine executing in mobile.html is the
 * same code these tests require(), and that it cannot silently drift.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';

const START = '<!-- EC-CALC:START — generated, do not edit by hand -->';
const END = '<!-- EC-CALC:END -->';

/** Boot the injected block the way a browser would. */
function bootInjectedEngine() {
  const html = fs.readFileSync(APP, 'utf8');
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  let block = html.slice(s, e);
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  const win = {};
  // eslint-disable-next-line no-new-func
  new Function('window', block)(win);
  return win.EC;
}

describe('Build integrity', { skip: skipAll }, () => {
  test('the generated block exists and is delimited by both markers', () => {
    const html = fs.readFileSync(APP, 'utf8');
    assert.ok(html.includes(START), 'START marker missing');
    assert.ok(html.includes(END), 'END marker missing');
    assert.ok(html.indexOf(START) < html.indexOf(END), 'markers out of order');
  });

  test('build:check passes — mobile.html is not stale', () => {
    // This is the same gate as `npm run build:check`, enforced inside the suite
    // so a stale engine fails `npm test` too, not only the separate command.
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-calc.js'), '--check'],
      { cwd: ROOT, stdio: 'pipe' });
  });

  test('the build is deterministic — two runs produce identical bytes', () => {
    const run = () => {
      const out = execFileSync(process.execPath,
        [path.join(ROOT, 'tools', 'build-calc.js'), '--check'], { cwd: ROOT, stdio: 'pipe' });
      return String(out);
    };
    assert.strictEqual(run(), run());
  });

  test('the injected engine exposes every module', () => {
    const EC = bootInjectedEngine();
    for (const m of ['tables', 'ampacity', 'voltageDrop', 'conduitFill',
      'boxFill', 'motor', 'grounding', 'wireSizing']) {
      assert.ok(EC[m], `EC.${m} missing from the injected engine`);
    }
  });

  test('PRODUCTION PARITY: the injected ampacity engine matches the required source', () => {
    // The core guarantee of this sprint. If someone edits src/calc/ampacity.js
    // and forgets to rebuild, or hand-edits the generated block, this fails.
    const EC = bootInjectedEngine();
    const src = require('../src/calc/ampacity');

    const cases = [];
    for (const size of ['14', '12', '10', '8', '6', '3', '2', '1/0', '3/0', '250', '500']) {
      for (const insulation of ['tw', 'thw', 'thhn', 'xhhw']) {
        for (const ambientF of [50, 77, 86, 95, 113, 140]) {
          for (const adjustmentFactor of [1.0, 0.8, 0.5, 0.35]) {
            for (const material of ['cu', 'al']) {
              for (const tempLookupMode of ['band', 'nearest']) {
                cases.push({ size, insulation, ambientF, adjustmentFactor, material, tempLookupMode });
              }
            }
          }
        }
      }
    }

    let compared = 0;
    for (const c of cases) {
      const a = src.calculateAmpacity(c);
      const b = EC.ampacity.calculateAmpacity(c);
      assert.deepStrictEqual(b, a, `divergence for ${JSON.stringify(c)}`);
      compared++;
    }
    assert.ok(compared > 1000, `expected a broad sweep, compared only ${compared}`);
  });

  test('PRODUCTION PARITY: tables in the injected engine match the source tables', () => {
    const EC = bootInjectedEngine();
    const src = require('../src/calc/tables');
    for (const name of Object.keys(src)) {
      assert.deepStrictEqual(EC.tables[name], src[name], `table drift: ${name}`);
    }
  });
});

describe('Ampacity migration — production adapter', { skip: skipAll }, () => {
  const html = () => fs.readFileSync(APP, 'utf8');

  test('ampUpdateCalc delegates to the shared engine', () => {
    const s = html().indexOf('function ampUpdateCalc');
    const body = html().slice(s, html().indexOf('function ampRenderRefTable'));
    assert.ok(/EC\.ampacity\.calculateAmpacity/.test(body),
      'ampUpdateCalc no longer calls the shared engine');
  });

  test('the duplicated temperature-correction lookup was removed from the app', () => {
    // The 11-row AMP_TEMP_LOOKUP literal must be gone from the hand-written
    // part of mobile.html; only the generated block may contain it.
    const h = html();
    const handWritten = h.slice(h.indexOf(END));
    assert.ok(!/var AMP_TEMP_LOOKUP = \{/.test(handWritten),
      'AMP_TEMP_LOOKUP data literal still duplicated outside the generated block');
    assert.ok(/var AMP_TEMP_LOOKUP = EC\.tables\.AMP_TEMP_LOOKUP/.test(handWritten),
      'AMP_TEMP_LOOKUP is not aliased to the shared table');
  });

  test('the nearest-band lookup body is no longer duplicated in the app', () => {
    const h = html();
    const handWritten = h.slice(h.indexOf(END));
    assert.ok(!/Math\.abs\(keys\[i\] - ambF\)/.test(handWritten),
      'the legacy nearest-match loop is still hand-coded in mobile.html');
  });

  test('no legacy nearest-match escape hatch remains in the adapter', () => {
    // P0-1 is fixed: the engine has one lookup, the true NEC band lookup.
    const s = html().indexOf('function ampUpdateCalc');
    const body = html().slice(s, html().indexOf('function ampRenderRefTable'));
    assert.ok(!/tempLookupMode/.test(body), 'a temperature-lookup mode switch is back');
    assert.ok(!/nearest/.test(body), 'nearest-match wording is back in the adapter');
  });
});
