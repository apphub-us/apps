'use strict';
/**
 * Wire Sizer migration parity harness.
 *
 * `legacyDecision()` below is the electrical decision logic of the
 * PRE-MIGRATION production `wsCalc()` (mobile.html), transcribed verbatim
 * minus DOM/rendering: candidate loop, two ampacity tests, 240.4(D) check
 * with derived standard device, NYC dwelling-feeder floor as a candidate
 * filter, and the local voltage-drop formula.
 *
 * PURPOSE: a migration guard only. It proves the shared engine reproduces
 * the shipped decisions across a representative input matrix, so swapping
 * production onto the engine cannot silently change results. It is NOT
 * evidence that the legacy behaviour is NEC-correct — the code rules are
 * hard-tested independently in wireSizing.test.js / ampacity.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { AMP_CU, AMP_AL, VD_CM, VD_K } = require('../src/calc/tables');
const { selectConductor } = require('../src/calc/wireSizing');
const EC = {
  ampacity: require('../src/calc/ampacity'),
};

/** The pre-migration wsCalc decision, DOM stripped. Do not "improve" it. */
function legacyDecision(input) {
  const load = input.load || 0;
  const contA = input.continuousLoad || 0;
  const noncontA = Math.max(0, load - contA);
  const circuitType = input.circuitType || 'BRANCH_CIRCUIT';
  const dwellingRaw = input.dwelling || '';
  const mat = input.material;
  const nycMinApplies = (circuitType === 'FEEDER') && (dwellingRaw === 'yes');
  const nycMinSize = nycMinApplies ? (mat === 'al' ? '6' : '8') : null;
  const hundredPct = input.hundredPct === 'yes';
  const contMult = (hundredPct && contA > 0) ? 1.0 : 1.25;
  const contReq = noncontA + contMult * contA;
  const feet = input.feet || 0;
  const voltage = input.voltage || 208;
  const phase = String(input.phase || '1');
  const bundle = input.bundle || 1.0;
  const temp = input.temp || 86;
  const maxVD = input.maxVD || 5;
  const insul = input.insulation;

  const ampTable = mat === 'cu' ? AMP_CU : AMP_AL;
  let sizes = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0',
    '3/0', '4/0', '250', '300', '350', '400', '500', '600', '700', '750'];
  if (mat === 'al') sizes = sizes.filter((s) => s !== '14');

  const rawFactor = EC.ampacity.tempCorrectionFactor(temp, insul);
  const tempFactor = rawFactor === null ? 0 : rawFactor;   // legacy null→0

  const t75 = {
    cu: { '14': 20, '12': 25, '10': 35, '8': 50, '6': 65, '4': 85, '3': 100, '2': 115, '1': 130, '1/0': 150, '2/0': 175, '3/0': 200, '4/0': 230, '250': 255, '300': 285, '350': 310, '400': 335, '500': 380, '600': 420, '700': 460, '750': 475 },
    al: { '12': 20, '10': 30, '8': 40, '6': 50, '4': 65, '3': 75, '2': 90, '1': 100, '1/0': 120, '2/0': 135, '3/0': 155, '4/0': 180, '250': 205, '300': 230, '350': 250, '400': 270, '500': 310, '600': 340, '700': 375, '750': 385 },
  };

  const K = VD_K[mat];
  const multiplier = phase === '3' ? 1.732 : 2;
  const baseCol = insul === 'tw' ? 't60' : insul === 'thw' ? 't75' : 't90';

  let winner = null;
  const perSize = [];
  for (const sz of sizes) {
    const baseData = ampTable[sz];
    if (!baseData) continue;
    const base = baseData[baseCol];
    const afterTemp = base * tempFactor;
    const afterBundle = afterTemp * bundle;
    const finalAmp = Math.min(afterBundle, t75[mat][sz] || afterBundle);
    const tableAtTerminal = Math.min(base, t75[mat][sz] || base);
    const continuousTestOK = tableAtTerminal >= contReq;
    const conditionsTestOK = finalAmp >= load;
    const ampOK = continuousTestOK && conditionsTestOK;

    const ocpdCap = EC.ampacity.smallConductorOcpdLimit(sz, mat);
    let derivedOcpdForSizing = null;
    for (const q of EC.ampacity.STANDARD_OCPD) {
      if (q >= contReq) { derivedOcpdForSizing = q; break; }
    }
    const ocpdOK = (ocpdCap === null)
      || (derivedOcpdForSizing !== null && derivedOcpdForSizing <= ocpdCap);

    const cm = VD_CM[sz];
    let vdPct = 0;
    if (feet && cm) {
      const vd = (multiplier * K * load * feet) / cm;
      vdPct = (vd / voltage) * 100;
    }
    const vdOK = !feet || vdPct <= maxVD;
    const nycMinOK = !nycMinApplies || !VD_CM[nycMinSize] || (VD_CM[sz] >= VD_CM[nycMinSize]);
    const bothOK = ampOK && ocpdOK && vdOK && nycMinOK;
    if (bothOK && !winner) winner = sz;
    perSize.push({ sz, ampOK, ocpdOK, vdOK });
  }
  return { winner, perSize };
}

/** Shared-engine decision for the same UI-shaped inputs. */
function engineDecision(input) {
  const r = selectConductor({
    load: input.load,
    continuousLoad: input.continuousLoad || 0,
    feet: input.feet || 0,
    voltage: input.voltage || 208,
    phase: Number(input.phase || 1),
    material: input.material,
    insulation: input.insulation,
    ambientF: input.temp || 86,
    adjustmentFactor: input.bundle || 1.0,
    maxVoltDropPercent: input.maxVD || 5,
    terminalRatingC: 75,
    circuitType: input.circuitType || 'BRANCH_CIRCUIT',
    assemblyRatedFor100PercentContinuousOperation: input.hundredPct === 'yes',
    jurisdiction: 'NYC',
    feedsDwellingUnit: input.dwelling === '' || input.dwelling === undefined
      ? null : input.dwelling === 'yes',
  });
  return r;
}

function compareCase(input, label) {
  const legacy = legacyDecision(input);
  const eng = engineDecision(input);
  assert.strictEqual(eng.ok, true, label + ': engine rejected valid input: ' + eng.reason);
  assert.strictEqual(eng.finalSelectedConductor, legacy.winner,
    label + ': winner diverged (legacy ' + legacy.winner + ', engine '
    + eng.finalSelectedConductor + ')');
  // Per-size acceptance flags must agree too — same rows lighting up green.
  for (const row of legacy.perSize) {
    const e = eng.evaluated.find((x) => x.size === row.sz);
    assert.ok(e, label + ': engine missing size ' + row.sz);
    assert.strictEqual(e.ampacityOK, row.ampOK, label + ' ' + row.sz + ' ampacityOK');
    assert.strictEqual(e.ocpdOK, row.ocpdOK, label + ' ' + row.sz + ' ocpdOK');
    assert.strictEqual(e.vdOK, row.vdOK, label + ' ' + row.sz + ' vdOK');
  }
}

describe('Wire Sizer migration parity — legacy production decision vs shared engine', () => {
  const materials = ['cu', 'al'];
  const insulations = ['tw', 'thw', 'thhn'];

  test('structured axis matrix agrees on winner and per-size flags', () => {
    let cases = 0;
    for (const material of materials) {
      for (const insulation of insulations) {
        // loads spanning small-conductor, threshold and large territory
        for (const load of [12, 16, 20, 28, 35, 55, 65, 100, 180, 380]) {
          for (const feet of [0, 40, 150, 400]) {
            compareCase({ load, feet, material, insulation, voltage: 208, phase: '1' },
              `${material}/${insulation}/${load}A/${feet}ft`);
            cases++;
          }
        }
      }
    }
    assert.ok(cases >= 240, 'matrix should be representative: ' + cases);
  });

  test('continuous-load and 100%-rated-assembly combinations agree', () => {
    for (const material of materials) {
      for (const load of [20, 40, 44, 55, 96, 100, 150]) {
        for (const continuousLoad of [0, 10, load / 2, load]) {
          for (const hundredPct of ['no', 'yes']) {
            compareCase({ load, continuousLoad, hundredPct, material,
              insulation: 'thhn', feet: 60, voltage: 240, phase: '1' },
            `${material}/${load}A cont${continuousLoad} 100%${hundredPct}`);
          }
        }
      }
    }
  });

  test('NYC dwelling feeder off/on/unanswered agrees for both materials', () => {
    for (const material of materials) {
      for (const dwelling of ['', 'yes', 'no']) {
        for (const load of [15, 25, 30, 41, 60, 120]) {
          compareCase({ load, material, insulation: 'thhn',
            circuitType: 'FEEDER', dwelling, feet: 30, voltage: 208, phase: '1' },
          `${material}/FEEDER/dwelling=${dwelling || 'unanswered'}/${load}A`);
        }
      }
    }
  });

  test('voltage, phase, VD-limit and derating axes agree', () => {
    for (const voltage of [120, 208, 240, 277, 480]) {
      for (const phase of ['1', '3']) {
        for (const maxVD of [2, 3, 5]) {
          compareCase({ load: 60, feet: 220, voltage, phase, maxVD,
            material: 'cu', insulation: 'thhn' },
          `${voltage}V/${phase}ph/VD${maxVD}`);
        }
      }
    }
    for (const bundle of [1.0, 0.8, 0.7, 0.5]) {
      for (const temp of [86, 96, 104, 122, 131, 140]) {
        compareCase({ load: 48, bundle, temp, material: 'cu', insulation: 'thhn',
          feet: 90, voltage: 208, phase: '1' },
        `bundle${bundle}/temp${temp}`);
      }
    }
    // The one UI-reachable null-correction combo: 140°F ambient with TW
    // (60°C). No factor is published; nothing qualifies, and the per-size
    // rows must still agree with the legacy all-fail table.
    for (const material of materials) {
      compareCase({ load: 30, temp: 140, material, insulation: 'tw',
        feet: 50, voltage: 208, phase: '1' }, material + '/tw/140F');
    }
  });

  test('seeded random sweep across all axes agrees', () => {
    // Deterministic LCG so a failure is reproducible by case index.
    let seed = 0xC0FFEE;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    for (let i = 0; i < 400; i++) {
      const load = 8 + Math.floor(rnd() * 400);
      const input = {
        load,
        continuousLoad: pick([0, 0, Math.floor(load / 3), load]),
        hundredPct: pick(['no', 'no', 'yes']),
        feet: pick([0, 25, 75, 160, 320, 600]),
        voltage: pick([120, 208, 240, 277, 480]),
        phase: pick(['1', '3']),
        material: pick(materials),
        insulation: pick(insulations),
        bundle: pick([1.0, 0.8, 0.7]),
        temp: pick([86, 95, 104, 113]),
        maxVD: pick([2, 3, 5]),
        circuitType: pick(['BRANCH_CIRCUIT', 'FEEDER']),
        dwelling: pick(['', 'yes', 'no']),
      };
      compareCase(input, 'random#' + i + ' ' + JSON.stringify(input));
    }
  });
});
