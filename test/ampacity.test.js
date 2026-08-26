'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  calculateAmpacity, tempCorrectionFactor, lookupTempCorrection, maxOvercurrentDevice,
} = require('../src/calc/ampacity');

describe('Ampacity — NEC 310.16 base values', () => {
  test('#12 Cu THHN base is 30 A at 90C', () => {
    const r = calculateAmpacity({ size: '12', insulation: 'thhn' });
    assert.strictEqual(r.baseAmpacity, 30);
  });

  test('#12 Cu terminates at 25 A — 75C column governs (110.14(C))', () => {
    const r = calculateAmpacity({ size: '12', insulation: 'thhn' });
    assert.strictEqual(r.finalAmpacity, 25);
    assert.strictEqual(r.terminalLimitGoverns, true);
  });

  test('3/0 Cu THHN: 225 A at 90C, limited to 200 A at the terminal', () => {
    const r = calculateAmpacity({ size: '3/0', insulation: 'thhn' });
    assert.strictEqual(r.baseAmpacity, 225);
    assert.strictEqual(r.finalAmpacity, 200);
  });

  test('4/0 Al THHN is 205 A at 90C, 180 A at 75C', () => {
    // 260 A is 4/0 COPPER; aluminium of the same size is 205 A at 90C.
    const r = calculateAmpacity({ size: '4/0', material: 'al', insulation: 'thhn' });
    assert.strictEqual(r.baseAmpacity, 205);
    assert.strictEqual(r.finalAmpacity, 180);
  });

  test('unknown size returns a structured failure, never throws', () => {
    const r = calculateAmpacity({ size: '999' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'SIZE_NOT_IN_TABLE');
  });
});

describe('Temperature correction — complete NEC 2020 Table 310.15(B)(1)', () => {
  // Values independently verified against NEC Equation 310.15(B):
  //   factor = sqrt((Tc - Ta) / (Tc - 30))
  // The app's original table stopped at 140°F and was missing 7 of 16 bands.

  const F = (ambientF, insul) => tempCorrectionFactor(ambientF, insul);

  test('band boundaries are inclusive upper bounds, not nearest keys', () => {
    assert.strictEqual(F(86, 'thhn'), 1.00);   // top of 78-86 band
    assert.strictEqual(F(87, 'thhn'), 0.96);   // bottom of 87-95 band
    assert.strictEqual(F(95, 'thhn'), 0.96);   // top of 87-95 band
    assert.strictEqual(F(96, 'thhn'), 0.91);   // bottom of 96-104
  });

  test('88°F uses the 87-95°F band — the original nearest-match bug', () => {
    assert.strictEqual(F(88, 'thhn'), 0.96);
    assert.strictEqual(F(88, 'thw'), 0.94);
    assert.strictEqual(F(88, 'tw'), 0.91);
  });

  test('95°F across all three conductor ratings', () => {
    assert.strictEqual(F(95, 'tw'), 0.91);
    assert.strictEqual(F(95, 'thw'), 0.94);
    assert.strictEqual(F(95, 'thhn'), 0.96);
  });

  test('141°F — first band beyond the old truncated table', () => {
    assert.strictEqual(F(141, 'thhn'), 0.65);
    assert.strictEqual(F(141, 'thw'), 0.47);
    assert.strictEqual(F(141, 'tw'), null); // 60°C column ends at 131°F
  });

  test('146°F — the rooftop case, 90°C factor is 0.65 NOT off-table', () => {
    assert.strictEqual(F(146, 'thhn'), 0.65);
  });

  test('149°F — top of the 61-65°C band', () => {
    assert.strictEqual(F(149, 'thhn'), 0.65);
    assert.strictEqual(F(149, 'thw'), 0.47);
  });

  test('150°F — steps into the 66-70°C band', () => {
    assert.strictEqual(F(150, 'thhn'), 0.58);
    assert.strictEqual(F(150, 'thw'), 0.33);
  });

  test('158°F — top of the 66-70°C band', () => {
    assert.strictEqual(F(158, 'thhn'), 0.58);
    assert.strictEqual(F(158, 'thw'), 0.33);
  });

  test('159°F — 75°C column ends here, 90°C continues at 0.50', () => {
    assert.strictEqual(F(159, 'thhn'), 0.50);
    assert.strictEqual(F(159, 'thw'), null);
    assert.strictEqual(F(159, 'tw'), null);
  });

  test('176°F — 90°C at 0.41', () => {
    assert.strictEqual(F(176, 'thhn'), 0.41);
  });

  test('185°F — last published band, 90°C at 0.29', () => {
    assert.strictEqual(F(185, 'thhn'), 0.29);
  });

  test('above 185°F is off the table for every conductor rating', () => {
    assert.strictEqual(F(186, 'thhn'), null);
    const r = lookupTempCorrection(200, 'thhn');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'AMBIENT_ABOVE_TABLE');
  });

  test('a dash in the table is not the same condition as an off-table ambient', () => {
    // 60°C conductor at 140°F: the band exists, the table prints no factor.
    // NEC 310.15(B) also permits the equation method, so this is a statement
    // about the TABLE, not a finding that the install is prohibited.
    const col = lookupTempCorrection(140, 'tw');
    assert.strictEqual(col.ok, false);
    assert.strictEqual(col.reason, 'TABLE_FACTOR_UNAVAILABLE_FOR_RATING');
    assert.strictEqual(col.conductorRatingC, 60);
    assert.strictEqual(col.band, '56-60°C / 132-140°F');

    // A 90°C conductor in the SAME ambient is fine — proving the distinction
    // matters rather than being cosmetic.
    assert.strictEqual(tempCorrectionFactor(140, 'thhn'), 0.71);

    const off = lookupTempCorrection(200, 'thhn');
    assert.notStrictEqual(off.reason, col.reason);
  });

  test('calculateAmpacity surfaces the two conditions distinctly', () => {
    const col = calculateAmpacity({ size: '12', insulation: 'tw', ambientF: 140 });
    assert.strictEqual(col.ok, false);
    assert.strictEqual(col.reason, 'TABLE_FACTOR_UNAVAILABLE_FOR_RATING');
    assert.ok(/No correction factor is provided/.test(col.note));
    assert.ok(/permits correction by equation/.test(col.note),
      'the note must not overstate what a table dash means');

    const off = calculateAmpacity({ size: '12', insulation: 'thhn', ambientF: 200 });
    assert.strictEqual(off.ok, false);
    assert.strictEqual(off.reason, 'AMBIENT_ABOVE_TABLE');
  });

  test('the cold end of the table is complete too', () => {
    assert.strictEqual(F(50, 'thhn'), 1.15);
    assert.strictEqual(F(55, 'thhn'), 1.12);  // 51-59 band, previously missing
    assert.strictEqual(F(59, 'thhn'), 1.12);
    assert.strictEqual(F(60, 'thhn'), 1.08);  // 60-68 band, previously missing
    assert.strictEqual(F(68, 'thhn'), 1.08);
    assert.strictEqual(F(69, 'thhn'), 1.04);
  });

  test('every published band matches NEC Equation 310.15(B)', () => {
    const bands = [[50,10],[59,15],[68,20],[77,25],[86,30],[95,35],[104,40],[113,45],
                   [122,50],[131,55],[140,60],[149,65],[158,70],[167,75],[176,80],[185,85]];
    const eq = (Tc, Ta) => Math.round(Math.sqrt((Tc - Ta) / (Tc - 30)) * 100) / 100;
    for (const [f, c] of bands) {
      for (const [insul, Tc] of [['tw', 60], ['thw', 75], ['thhn', 90]]) {
        const got = tempCorrectionFactor(f, insul);
        if (Tc <= c) {
          assert.strictEqual(got, null, `${f}°F ${insul}: expected no factor`);
        } else {
          assert.strictEqual(got, eq(Tc, c), `${f}°F ${insul}`);
        }
      }
    }
  });

  test('derating stacks: correction x adjustment, then terminal limit', () => {
    const r = calculateAmpacity({
      size: '3/0', insulation: 'thhn', ambientF: 104, adjustmentFactor: 0.80,
    });
    assert.strictEqual(r.correctionFactor, 0.91);
    assert.strictEqual(r.afterAdjustment, Math.round(225 * 0.91 * 0.80 * 100) / 100);
    assert.strictEqual(r.finalAmpacity, r.afterAdjustment);
  });
});

describe('Overcurrent device — NEC 240.4', () => {
  test('240.4(B): non-standard ampacity may round up to the next standard size', () => {
    assert.strictEqual(maxOvercurrentDevice(83, '3').rating, 90);
  });

  test('exact standard ampacity is used as-is', () => {
    assert.strictEqual(maxOvercurrentDevice(100, '3').rating, 100);
  });

  test('240.4(D): #14 Cu is capped at 15 A regardless of ampacity', () => {
    const r = maxOvercurrentDevice(25, '14');
    assert.strictEqual(r.rating, 15);
    assert.strictEqual(r.cappedBySmallConductorRule, true);
  });

  test('240.4(D): #12 capped at 20 A, #10 capped at 30 A', () => {
    assert.strictEqual(maxOvercurrentDevice(30, '12').rating, 20);
    assert.strictEqual(maxOvercurrentDevice(40, '10').rating, 30);
  });

  test('large conductors are not subject to the small-conductor cap', () => {
    const r = maxOvercurrentDevice(200, '3/0');
    assert.strictEqual(r.rating, 200);
    assert.strictEqual(r.cappedBySmallConductorRule, false);
  });
});

describe('Rooftop — NEC 2020 310.15(B)(2)', () => {
  // Rule: raceway/cable exposed to DIRECT SUNLIGHT, ON OR ABOVE a roof, with
  // clearance from roof to bottom of raceway LESS THAN 7/8 in. (23 mm)
  //   -> add 33°C (60°F) to the outdoor ambient before the correction lookup.
  // Exception: Type XHHW-2 conductors are not subject to this adjustment.
  // NYC: NYCEC 2025 adopts NEC 2020 310.15(B)(2) unamended (verified against
  // the official § 28-1101.3 amendment list).

  const base = { size: '3/0', material: 'cu', insulation: 'thhn', ambientF: 86 };
  const qualifying = { onOrAboveRoof: true, directSunlight: true, clearanceInches: 0.5 };

  test('A. qualifying rooftop install adds 60°F, not 33°F', () => {
    const r = calculateAmpacity({ ...base, rooftop: qualifying });
    assert.strictEqual(r.rooftopAdjustmentApplied, true);
    assert.strictEqual(r.rooftopAdderF, 60);
    assert.strictEqual(r.effectiveAmbientF, 146);
  });

  test('B. clearance of exactly 7/8 in. does NOT trigger the adder', () => {
    // The code says "less than 7/8 in." — 7/8 exactly is compliant clearance.
    const r = calculateAmpacity({ ...base, rooftop: { ...qualifying, clearanceInches: 0.875 } });
    assert.strictEqual(r.rooftopAdjustmentApplied, false);
    assert.strictEqual(r.rooftopAdderF, 0);
    assert.strictEqual(r.effectiveAmbientF, 86);
    assert.strictEqual(r.rooftopAdjustmentReason, 'CLEARANCE_AT_OR_ABOVE_MINIMUM');
  });

  test('C. clearance above 7/8 in. does NOT trigger the adder', () => {
    const r = calculateAmpacity({ ...base, rooftop: { ...qualifying, clearanceInches: 4 } });
    assert.strictEqual(r.rooftopAdjustmentApplied, false);
    assert.strictEqual(r.effectiveAmbientF, 86);
  });

  test('D. no direct sunlight means no adder, however low the clearance', () => {
    const r = calculateAmpacity({
      ...base, rooftop: { ...qualifying, directSunlight: false, clearanceInches: 0 },
    });
    assert.strictEqual(r.rooftopAdjustmentApplied, false);
    assert.strictEqual(r.rooftopAdjustmentReason, 'NO_DIRECT_SUNLIGHT');
  });

  test('E. XHHW-2 is excepted even under otherwise qualifying conditions', () => {
    const r = calculateAmpacity({ ...base, insulation: 'xhhw', rooftop: qualifying });
    assert.strictEqual(r.rooftopAdjustmentApplied, false);
    assert.strictEqual(r.rooftopAdjustmentReason, 'XHHW2_EXCEPTION');
    assert.strictEqual(r.effectiveAmbientF, 86);
  });

  test('E2. the XHHW-2 exception does not leak to other 90°C insulations', () => {
    const r = calculateAmpacity({ ...base, insulation: 'thhn', rooftop: qualifying });
    assert.strictEqual(r.rooftopAdjustmentApplied, true);
  });

  test('F. the adder feeds the normal correction-factor lookup', () => {
    // 86°F + 60°F = 146°F, which lands in the 61-65°C / 141-149°F band.
    // The 90°C factor there is 0.65 — the conductor IS permitted.
    const r = calculateAmpacity({ ...base, rooftop: qualifying });
    assert.strictEqual(r.effectiveAmbientF, 146);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.temperatureBand, '61-65°C / 141-149°F');
    assert.strictEqual(r.correctionFactor, 0.65);
    assert.strictEqual(r.afterCorrection, 146.25); // 225 x 0.65

    // A cooler outdoor ambient stays on the table and derates normally.
    const r2 = calculateAmpacity({ ...base, ambientF: 70, rooftop: qualifying });
    assert.strictEqual(r2.effectiveAmbientF, 130);
    assert.strictEqual(r2.correctionFactor, 0.76); // 123–131°F band, 90°C column
    assert.strictEqual(r2.ok, true);
  });

  test('G. boundary immediately below 7/8 in. DOES trigger the adder', () => {
    const r = calculateAmpacity({ ...base, ambientF: 70, rooftop: { ...qualifying, clearanceInches: 0.874 } });
    assert.strictEqual(r.rooftopAdjustmentApplied, true);
    assert.strictEqual(r.rooftopAdderF, 60);
    assert.strictEqual(r.effectiveAmbientF, 130);
  });

  test('not on a roof at all means no adder', () => {
    const r = calculateAmpacity({ ...base, rooftop: { onOrAboveRoof: false, directSunlight: true, clearanceInches: 0 } });
    assert.strictEqual(r.rooftopAdjustmentApplied, false);
    assert.strictEqual(r.rooftopAdjustmentReason, 'NOT_ON_ROOF');
  });

  test('omitting the rooftop object entirely behaves as a non-rooftop install', () => {
    const r = calculateAmpacity(base);
    assert.strictEqual(r.rooftopAdjustmentApplied, false);
    assert.strictEqual(r.effectiveAmbientF, 86);
  });

  test('the structured result explains the outcome either way', () => {
    for (const rooftop of [qualifying, { ...qualifying, clearanceInches: 2 }]) {
      const r = calculateAmpacity({ ...base, ambientF: 70, rooftop });
      for (const field of ['ambientF', 'rooftopAdjustmentApplied', 'rooftopAdderF',
        'effectiveAmbientF', 'rooftopAdjustmentReason']) {
        assert.ok(field in r, `missing ${field} in result`);
      }
    }
  });
});

const round2 = (n) => Math.round(n * 100) / 100;

describe('Wire Sizer hardening — shipped Ampacity Calculator cross-regression', () => {
  // The Wire Sizer migration added context fields to calculateAmpacity's
  // FAILURE return in src/calc/ampacity.js. This suite executes the REAL
  // shipped ampUpdateCalc from mobile.html and pins representative results,
  // proving the shipped Ampacity Calculator did not change.
  const fs = require('node:fs');
  const path = require('node:path');
  const APP = path.join(__dirname, '..', 'mobile.html');
  const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

  function buildAmpHarness() {
    const ids = ['ampWireSize', 'ampMaterial', 'ampInsul', 'ampTemp', 'ampBundle',
      'ampRoof', 'ampRoofSun', 'ampRoofClearance', 'ampResultBox', 'ampResultGrid'];
    const els = {};
    ids.forEach((id) => {
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
    const fs2 = html.indexOf('function ampUpdateCalc');
    const fe = html.indexOf('function ampRenderRefTable');
    // AMP_TYPICAL_* are hand-maintained display tables (typical breaker
    // chip); lift them from the app source exactly as shipped.
    function varBlock(name) {
      const i = html.indexOf('var ' + name);
      let depth = 0; const st = html.indexOf('{', i);
      for (let j = st; j < html.length; j++) {
        if (html[j] === '{') depth++;
        else if (html[j] === '}') {
          depth--;
          if (depth === 0) return html.slice(i, html.indexOf(';', j) + 1);
        }
      }
      return '';
    }
    const api = {};
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', 'EC', 'exports',
      'var AMP_CU=EC.tables.AMP_CU,AMP_AL=EC.tables.AMP_AL,'
      + 'AMP_TEMP_LOOKUP=EC.tables.AMP_TEMP_LOOKUP;'
      + 'function ampGetBaseCol(i){return i==="tw"?"t60":i==="thw"?"t75":"t90";}'
      + varBlock('AMP_TYPICAL_CU') + varBlock('AMP_TYPICAL_AL')
      + 'var currentAmpMat = "cu";'   // module-scope material toggle state
      + html.slice(fs2, fe)
      + ';exports.ampUpdateCalc=ampUpdateCalc;'
      + 'exports.setMat=function(m){currentAmpMat=m;};')(doc, win, win.EC, api);
    return { els, api };
  }

  function run(h, inputs) {
    const defaults = { ampWireSize: '8', ampMaterial: 'cu', ampInsul: 'thhn',
      ampTemp: '86', ampBundle: '1.0', ampRoof: 'no', ampRoofSun: 'no',
      ampRoofClearance: '' };
    Object.entries({ ...defaults, ...inputs }).forEach(([k, v]) => { h.els[k].value = v; });
    h.api.setMat(inputs.ampMaterial || defaults.ampMaterial);
    h.api.ampUpdateCalc();
    return h.els.ampResultGrid.innerHTML;
  }

  const skip = html ? false : 'mobile.html not found';
  test('copper baseline, temperature correction, terminal limit and P0-1 band all unchanged', { skip }, () => {
    const h = buildAmpHarness();
    // Copper #8 THHN at base ambient: 55 A table value visible.
    assert.ok(/55/.test(run(h, { ampWireSize: '8', ampMaterial: 'cu' })),
      'Cu #8 THHN baseline drifted');
    // Aluminum #6 THHN at base ambient: 60 A table value visible.
    assert.ok(/60/.test(run(h, { ampWireSize: '6', ampMaterial: 'al' })),
      'Al #6 THHN baseline drifted');
    // Temperature correction at 104F on 90C insulation: 0.91 factor shown.
    assert.ok(/0\.91/.test(run(h, { ampWireSize: '8', ampTemp: '104' })),
      'temperature-correction factor drifted');
    // P0-1 band regression: 88F must land in the 87–95F band (0.96), never a
    // nearest-match on 86F. The adapter renders through the shared lookup.
    const p01 = run(h, { ampWireSize: '8', ampTemp: '88' });
    assert.ok(/0\.96/.test(p01), 'P0-1 band lookup drifted at 88F');
    // Terminal limitation where applicable: 3/0 THHN Cu corrected value stays
    // above the 75C column, so the 200 A terminal figure must appear.
    assert.ok(/200/.test(run(h, { ampWireSize: '3/0', ampTemp: '86' })),
      'the 110.14(C) terminal figure disappeared from the shipped output');
  });

  test('the failure-return context fields did not alter any success result', { skip }, () => {
    const { calculateAmpacity } = require('../src/calc/ampacity');
    // Success path: exact pre-hardening values, spot-pinned.
    const cu = calculateAmpacity({ size: '8', material: 'cu', insulation: 'thhn',
      ambientF: 104, adjustmentFactor: 1, terminalRatingC: 75 });
    assert.strictEqual(cu.ok, true);
    assert.strictEqual(cu.baseAmpacity, 55);
    assert.strictEqual(cu.correctionFactor, 0.91);
    assert.strictEqual(cu.terminalLimit, 50);
    assert.strictEqual(cu.finalAmpacity, 50);
    const al = calculateAmpacity({ size: '6', material: 'al', insulation: 'thw',
      ambientF: 86, adjustmentFactor: 0.8, terminalRatingC: 75 });
    assert.strictEqual(al.ok, true);
    assert.strictEqual(al.baseAmpacity, 50);
    assert.strictEqual(al.finalAmpacity, 40);
    // Failure path: same ok/reason as before, now with render context.
    const fail = calculateAmpacity({ size: '8', material: 'cu', insulation: 'tw',
      ambientF: 140, adjustmentFactor: 1, terminalRatingC: 75 });
    assert.strictEqual(fail.ok, false);
    assert.strictEqual(fail.baseAmpacity, 40, 'context field: TW base');
    assert.strictEqual(fail.terminalLimit, 50, 'context field: 75C column');
  });
});
