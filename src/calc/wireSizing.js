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
const { calculateAmpacity, smallConductorOcpdLimit, STANDARD_OCPD } = require('./ampacity');
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
    /**
     * Optional. The actual or intended device rating, when the caller knows it.
     * Left null the engine derives the smallest standard device that can serve
     * the load — it never assumes OCPD equals the load current.
     */
    proposedOcpd = null,
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

    // ── the six concepts, kept distinct ──────────────────────────────
    // 1. calculated ampacity      base x correction x adjustment
    // 2. terminal-limited ampacity after NEC 110.14(C)
    // 3. minimum conductor size    driven by requiredAmpacity
    // 4. max OCPD under 240.4(D)   material-specific, small conductors only
    // 5. selected OCPD             smallest standard device that can serve the load
    // 6. acceptance + reason
    const calculatedAmpacity = amp.afterAdjustment;
    const terminalLimitedAmpacity = amp.finalAmpacity;
    const ampacityOK = terminalLimitedAmpacity >= requiredAmpacity;

    // The Wire Sizer is not told the breaker, and it does not size one.
    //
    // When the caller supplies proposedOcpd, that is a real device rating and
    // is reported as selectedOcpd.
    //
    // Otherwise nothing has been selected. We derive the smallest standard
    // device that could carry the present load PURELY as a check basis: any
    // real installation needs at least this much, so if even that exceeds the
    // 240.4(D) ceiling, no permissible device exists for this conductor. It is
    // reported as derivedOcpdForSizing and must not be presented to the user
    // as a chosen breaker. It also ignores continuous-load factors, which are
    // out of scope here (P0-3).
    const callerSupplied = proposedOcpd !== null && proposedOcpd !== undefined;
    const selectedOcpd = callerSupplied ? proposedOcpd : null;
    const derivedOcpdForSizing = callerSupplied
      ? null
      : (STANDARD_OCPD.find((b) => b >= requiredAmpacity) ?? null);
    const ocpdCheckValue = callerSupplied ? selectedOcpd : derivedOcpdForSizing;
    const ocpdBasis = callerSupplied ? 'CALLER_SUPPLIED' : 'SMALLEST_STANDARD_FOR_CURRENT_LOAD';

    const maxOcpdUnder240_4_D = smallConductorOcpdLimit(size, material);
    const smallConductorRuleApplies = maxOcpdUnder240_4_D !== null;
    const ocpdOK = ocpdCheckValue === null
      ? false
      : (!smallConductorRuleApplies || ocpdCheckValue <= maxOcpdUnder240_4_D);

    let vd = null;
    let vdOK = true;
    if (feet > 0 && VD_CM[size]) {
      vd = calculateVoltageDrop({ amps: load, feet, voltage, phase, material, size });
      vdOK = vd.ok && vd.percentDrop <= maxVoltDropPercent;
    }

    const passes = ampacityOK && ocpdOK && vdOK;
    const reason = passes ? 'ACCEPTED'
      : !ampacityOK ? 'INSUFFICIENT_AMPACITY'
      : !ocpdOK ? 'OCPD_EXCEEDS_240_4_D_LIMIT'
      : 'VOLTAGE_DROP_EXCEEDS_LIMIT';

    evaluated.push({
      size,
      calculatedAmpacity,
      terminalLimitedAmpacity,
      finalAmpacity: terminalLimitedAmpacity, // retained for existing callers
      ampacityOK,
      smallConductorRuleApplies,
      maxOcpdUnder240_4_D,
      selectedOcpd,           // non-null ONLY when the caller supplied one
      derivedOcpdForSizing,   // non-null ONLY when inferred as a check basis
      ocpdCheckValue,         // whichever of the two was compared to the limit
      ocpdBasis,
      ocpdOK,
      voltDropPercent: vd && vd.ok ? vd.percentDrop : null,
      vdOK,
      conductorAccepted: passes,
      passes,
      reason,
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
    note: 'Overcurrent protection limited per NEC 240.4(D). This tool does not '
      + 'size the overcurrent device: where none was supplied, the smallest '
      + 'standard device able to carry the present load is derived solely to '
      + 'test the 240.4(D) ceiling. Continuous-load factors are not applied. '
      + 'Equipment-specific exceptions in 240.4(E) (taps) and 240.4(G) (motors, '
      + 'A/C and similar) are NOT evaluated here.',
    limitingFactor: win
      ? (win.voltDropPercent !== null && win.voltDropPercent > maxVoltDropPercent * 0.9
        ? 'VOLTAGE_DROP' : 'AMPACITY')
      : null,
    evaluated,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
module.exports = { selectConductor, SIZE_ORDER };
