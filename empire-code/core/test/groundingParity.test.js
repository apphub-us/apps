'use strict';
/**
 * Grounding migration parity harness.
 *
 * `legacyDecision()` is the electrical decision logic of the PRE-MIGRATION
 * production `gndCalc()` (mobile.html), transcribed verbatim minus DOM:
 * Table 250.122 EGC lookup (first row with ocpd <= threshold, Cu/Al column),
 * the 250.122(B) proportional upsize (CM ratio > 1.0001, need = baseCM x
 * ratio, first GND_SIZES entry with CM >= need), Table 250.66 GEC lookup
 * (first row with serviceCM <= threshold, both columns rendered), and the
 * 250.66(A)/(B)/(C) electrode caps with their benefit comparison.
 *
 * KNOWN LEGACY DEFECT (preserved here verbatim, special-cased in comparison):
 * when the proportional requirement exceeds every supported size, legacy left
 * `finalEgc` at the BASE size and rendered it as "EGC after upsize". The
 * engine returns finalSize null / exceedsAvailableSizes true instead. The
 * comparison below asserts exactly that divergence and nothing else.
 *
 * PURPOSE: migration guard only — NOT NEC proof. Code rules are hard-tested
 * independently in grounding.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  GND_EGC, GND_CM, GND_GEC_CU, GND_GEC_AL, GND_SIZES,
} = require('../src/calc/tables');
const { calculateGrounding } = require('../src/calc/grounding');

/** The pre-migration gndCalc decision, DOM stripped. Do not "improve" it. */
function legacyDecision(input) {
  const ocpd = parseFloat(input.ocpd);
  let base = null;
  for (let i = 0; i < GND_EGC.length; i++) {
    if (ocpd <= GND_EGC[i][0]) {
      base = input.eMat === 'cu' ? GND_EGC[i][1] : GND_EGC[i][2];
      break;
    }
  }
  const ratio = GND_CM[input.inst] / GND_CM[input.req];
  let finalEgc = base;
  let upsized = false;
  let noFit = false;
  if (ratio > 1.0001) {
    upsized = true;
    const need = GND_CM[base] * ratio;
    noFit = true;
    for (let j = 0; j < GND_SIZES.length; j++) {
      if (GND_CM[GND_SIZES[j]] >= need) { finalEgc = GND_SIZES[j]; noFit = false; break; }
    }
    // legacy defect: on no fit, finalEgc silently stays `base`
  }

  const tbl = input.sMat === 'cu' ? GND_GEC_CU : GND_GEC_AL;
  const cm = GND_CM[input.svc];
  let gecCu = null; let gecAl = null;
  for (let k = 0; k < tbl.length; k++) {
    if (cm <= tbl[k][0]) { gecCu = tbl[k][1]; gecAl = tbl[k][2]; break; }
  }
  let capped = null;
  if (input.elec === 'rod') capped = '6';
  if (input.elec === 'ufer') capped = '4';
  if (input.elec === 'ring') capped = '2';
  const capBeneficial = capped !== null && GND_CM[capped] < GND_CM[gecCu];

  return { base, ratio, upsized, finalEgc, noFit, gecCu, gecAl, capped, capBeneficial };
}

function engineDecision(input) {
  return calculateGrounding({
    ocpdRating: parseFloat(input.ocpd),
    egcMaterial: input.eMat,
    requiredPhaseSize: input.req,
    installedPhaseSize: input.inst,
    serviceSize: input.svc,
    serviceMaterial: input.sMat,
    electrode: input.elec,
  });
}

const GEC_DEFAULT = { svc: '3/0', sMat: 'cu', elec: 'water' };
const EGC_DEFAULT = { ocpd: '100', eMat: 'cu', req: '3/0', inst: '3/0' };

function compareCase(input, label) {
  const legacy = legacyDecision(input);
  const eng = engineDecision(input);
  assert.strictEqual(eng.ok, true, label + ': engine rejected: ' + eng.reason);

  // ── EGC section ──
  assert.strictEqual(eng.egc.baseSize, legacy.base, label + ' baseSize');
  assert.strictEqual(eng.egc.upsizeApplied, legacy.upsized, label + ' upsizeApplied');
  if (legacy.upsized) {
    assert.ok(Math.abs(eng.egc.ratio - legacy.ratio) <= 0.0006,
      `${label} ratio: legacy ${legacy.ratio} vs engine ${eng.egc.ratio}`);
    if (legacy.noFit) {
      // The one intended divergence: engine is explicit where legacy silently
      // rendered the base size as the upsized answer.
      assert.strictEqual(eng.egc.finalSize, null, label + ' no-fit finalSize');
      assert.strictEqual(eng.egc.exceedsAvailableSizes, true, label + ' no-fit flag');
      assert.strictEqual(legacy.finalEgc, legacy.base, label + ' legacy defect shape');
    } else {
      assert.strictEqual(eng.egc.finalSize, legacy.finalEgc, label + ' finalSize');
      assert.strictEqual(eng.egc.exceedsAvailableSizes, false, label);
    }
  } else {
    assert.strictEqual(eng.egc.finalSize, legacy.finalEgc, label + ' same-size finalSize');
    assert.strictEqual(eng.egc.finalSize, eng.egc.baseSize, label + ' no-downsize pin');
  }

  // ── GEC section ──
  assert.strictEqual(eng.gec.copper, legacy.gecCu, label + ' gec copper');
  assert.strictEqual(eng.gec.aluminum, legacy.gecAl, label + ' gec aluminum');
  assert.strictEqual(eng.gec.capSize, legacy.capped, label + ' capSize');
  assert.strictEqual(eng.gec.capApplied, legacy.capBeneficial, label + ' capApplied');
  assert.strictEqual(eng.gec.finalCopper,
    legacy.capBeneficial ? legacy.capped : legacy.gecCu, label + ' finalCopper');
}

describe('Grounding migration parity — legacy production decision vs shared engine', () => {
  const OCPDS = ['15', '20', '25', '30', '40', '50', '60', '70', '80', '90',
    '100', '110', '125', '150', '175', '200', '225', '250', '300', '350', '400',
    '450', '500', '600', '700', '800', '1000', '1200', '1600', '2000'];

  test('EGC + 250.122(B): every OCPD option x material x ALL required/installed pairs', () => {
    let cases = 0;
    for (const ocpd of OCPDS) {
      for (const eMat of ['cu', 'al']) {
        for (const req of GND_SIZES) {
          for (const inst of GND_SIZES) {
            compareCase({ ...GEC_DEFAULT, ocpd, eMat, req, inst },
              `${ocpd}A/${eMat}/${req}->${inst}`);
            cases++;
          }
        }
      }
    }
    assert.strictEqual(cases, OCPDS.length * 2 * GND_SIZES.length * GND_SIZES.length);
  });

  test('GEC: every service size x material x electrode', () => {
    for (const svc of GND_SIZES) {
      for (const sMat of ['cu', 'al']) {
        for (const elec of ['water', 'rod', 'ufer', 'ring']) {
          compareCase({ ...EGC_DEFAULT, svc, sMat, elec },
            `${svc}/${sMat}/${elec}`);
        }
      }
    }
  });

  test('seeded random sweep across all seven axes', () => {
    let seed = 0x250122;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    for (let i = 0; i < 500; i++) {
      const input = {
        ocpd: pick(OCPDS),
        eMat: pick(['cu', 'al']),
        req: pick(GND_SIZES),
        inst: pick(GND_SIZES),
        svc: pick(GND_SIZES),
        sMat: pick(['cu', 'al']),
        elec: pick(['water', 'rod', 'ufer', 'ring']),
      };
      compareCase(input, 'random#' + i + ' ' + JSON.stringify(input));
    }
  });
});
