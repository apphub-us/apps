'use strict';
/**
 * Conductor selection — the tool the app calls "Wire Sizer".
 *
 * A conductor must satisfy ALL of:
 *   1. Ampacity after correction + adjustment  >= required ampacity
 *   2. NEC 240.4(D) small-conductor OCPD limit >= load           (P0-2 in audit:
 *      the shipped app omits this and can return #14 for a 20 A load)
 *   3. Voltage drop <= limit, when a distance is supplied
 *
 * Required ampacity per NEC 210.19(A)(1) / 215.2(A)(1):
 *      noncontinuous + 1.25 x continuous
 * The shipped app has no continuous-load input at all (P0-3 in audit).
 */

const { AMP_CU, AMP_AL, VD_CM } = require('./tables');
const { calculateAmpacity, maxOvercurrentDevice } = require('./ampacity');
const { calculateVoltageDrop } = require('./voltageDrop');

const SIZE_ORDER = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0',
  '3/0', '4/0', '250', '300', '350', '400', '500', '600', '700', '750'];

/**
 * @param {object} input
 * @param {number} input.load               total load, A
 * @param {number} [input.continuousLoad]   portion that is continuous, A (default 0)
 * @param {number} [input.feet]             one-way distance; 0/omitted skips the VD check
 * @param {number} [input.voltage]          default 208 (NYC)
 * @param {number|string} [input.phase]     1 | 3
 * @param {string} [input.material]         'cu' | 'al'
 * @param {string} [input.insulation]       'tw' | 'thw' | 'thhn' | 'xhhw'
 * @param {number} [input.ambientF]
 * @param {number} [input.adjustmentFactor] Table 310.15(C)(1)
 * @param {number} [input.maxVoltDropPercent] default 5 (NYCEC mandatory total)
 * @param {number} [input.terminalRatingC]  60 | 75
 */
function selectConductor(input) {
  const {
    load, continuousLoad = 0, feet = 0, voltage = 208, phase = 1,
    material = 'cu', insulation = 'thhn', ambientF = 86,
    adjustmentFactor = 1.0, maxVoltDropPercent = 5, terminalRatingC = 75,
  } = input || {};

  if (!(load > 0)) return { ok: false, reason: 'INVALID_LOAD', load };
  if (continuousLoad < 0 || continuousLoad > load) {
    return { ok: false, reason: 'INVALID_CONTINUOUS_LOAD', continuousLoad, load };
  }

  const noncontinuous = load - continuousLoad;
  const requiredAmpacity = noncontinuous + 1.25 * continuousLoad;

  const sizes = material === 'al' ? SIZE_ORDER.filter((s) => s !== '14') : SIZE_ORDER;
  const table = material === 'al' ? AMP_AL : AMP_CU;
  const evaluated = [];
  let winner = null;

  for (const size of sizes) {
    if (!table[size]) continue;

    const amp = calculateAmpacity({
      size, material, insulation, ambientF, adjustmentFactor, terminalRatingC,
    });
    if (!amp.ok) continue;

    const ampacityOK = amp.finalAmpacity >= requiredAmpacity;

    // NEC 240.4(D): a #14/#12/#10 conductor cannot be protected above
    // 15/20/30 A, which caps the load it may serve regardless of ampacity.
    const ocpd = maxOvercurrentDevice(amp.finalAmpacity, size);
    const ocpdOK = ocpd.rating === null ? false : ocpd.rating >= requiredAmpacity;

    let vd = null;
    let vdOK = true;
    if (feet > 0 && VD_CM[size]) {
      vd = calculateVoltageDrop({ amps: load, feet, voltage, phase, material, size });
      vdOK = vd.ok && vd.percentDrop <= maxVoltDropPercent;
    }

    const passes = ampacityOK && ocpdOK && vdOK;
    evaluated.push({
      size,
      finalAmpacity: amp.finalAmpacity,
      ampacityOK,
      maxOcpd: ocpd.rating,
      ocpdOK,
      ocpdCappedBySmallConductorRule: ocpd.cappedBySmallConductorRule,
      voltDropPercent: vd && vd.ok ? vd.percentDrop : null,
      vdOK,
      passes,
    });
    if (passes && !winner) winner = size;
  }

  const win = evaluated.find((e) => e.size === winner) || null;

  return {
    ok: true,
    load,
    continuousLoad,
    noncontinuous,
    requiredAmpacity: round2(requiredAmpacity),
    continuousFactorApplied: continuousLoad > 0,
    recommendedSize: winner,
    recommended: win,
    limitingFactor: win
      ? (win.voltDropPercent !== null && win.voltDropPercent > maxVoltDropPercent * 0.9
        ? 'VOLTAGE_DROP' : 'AMPACITY')
      : null,
    evaluated,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
module.exports = { selectConductor, SIZE_ORDER };
