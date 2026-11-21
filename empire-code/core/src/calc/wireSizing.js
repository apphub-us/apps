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

/**
 * NYCEC 2025 § 215.2(A)(1), NYC amendment:
 *   "The minimum feeder size feeding a dwelling unit shall be 3 conductors
 *    with minimum 8 AWG copper or 6 AWG aluminum or copper-clad aluminum
 *    conductors."
 *
 * A minimum SIZE floor, not an ampacity, terminal or overcurrent rule. It is
 * applied only after the NEC calculation has produced a size, and only raises
 * that size — it never lowers it.
 *
 * A 2019 NYC DOB code interpretation confirms the scope: the minimum applies
 * to a feeder supplying a DWELLING UNIT, not to every feeder. A feeder to,
 * say, a lighting-control panel may still be #10 or #12.
 *
 * The "3 conductors" element is part of the rule but concerns circuit
 * arrangement, which this tool does not model; it is surfaced in the note.
 */
const NYC_DWELLING_FEEDER_MINIMUM = {
  code: 'NYCEC 2025 215.2(A)(1) (NYC amendment)',
  cu: '8',
  al: '6',
  conductorCount: 3,
};

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
    // Preferred, explicit model. A circuit can carry both kinds at once.
    continuousLoadA = null,
    noncontinuousLoadA = null,
    // Legacy convenience: a single total plus the continuous portion.
    load = null, continuousLoad = null,
    feet = 0, voltage = 208, phase = 1,
    material = 'cu', insulation = 'thhn', ambientF = 86,
    adjustmentFactor = 1.0, maxVoltDropPercent = 5, terminalRatingC = 75,
    /** 'BRANCH_CIRCUIT' (210.19/210.20) or 'FEEDER' (215.2/215.3). */
    circuitType = 'BRANCH_CIRCUIT',
    /**
     * NEC 210.19(A)(1) Exception No.1 / 215.2(A)(1) Exception No.1.
     * True ONLY when the user states that the complete assembly, INCLUDING the
     * overcurrent devices, is listed for operation at 100% of its rating.
     * Never inferred from breaker brand, conductor type or load.
     */
    assemblyRatedFor100PercentContinuousOperation = false,
    proposedOcpd = null,
    /** 'NYC' applies the NYCEC amendments; 'NEC' uses the base code only. */
    jurisdiction = 'NYC',
    /**
     * NYCEC 215.2(A)(1) minimum. null means the question was not answered, in
     * which case the minimum is NOT applied and the note says so — the answer
     * is never assumed in either direction.
     */
    feedsDwellingUnit = null,
  } = input || {};

  // Resolve the two load models into continuous + noncontinuous amperes.
  let contA;
  let noncontA;
  if (continuousLoadA !== null || noncontinuousLoadA !== null) {
    contA = continuousLoadA || 0;
    noncontA = noncontinuousLoadA || 0;
  } else if (load !== null) {
    if (load < 0) {
      return { ok: false, reason: 'NEGATIVE_LOAD', load };
    }
    contA = continuousLoad || 0;
    if (contA > load) {
      return { ok: false, reason: 'INVALID_CONTINUOUS_LOAD', continuousLoad: contA, load };
    }
    noncontA = load - contA;
  } else {
    return { ok: false, reason: 'NO_LOAD_SUPPLIED' };
  }
  if (contA < 0 || noncontA < 0) {
    return { ok: false, reason: 'NEGATIVE_LOAD', contA, noncontA };
  }
  const totalActualLoadA = round2(contA + noncontA);
  if (!(totalActualLoadA > 0)) return { ok: false, reason: 'INVALID_LOAD', load: totalActualLoadA };
  if (circuitType !== 'BRANCH_CIRCUIT' && circuitType !== 'FEEDER') {
    return { ok: false, reason: 'INVALID_CIRCUIT_TYPE', circuitType };
  }
  if (material !== 'cu' && material !== 'al') {
    return { ok: false, reason: 'INVALID_MATERIAL', material };
  }
  if (!(feet >= 0) || !Number.isFinite(feet)) {
    return { ok: false, reason: 'INVALID_DISTANCE', feet };
  }
  if (feet > 0) {
    if (!(voltage > 0) || !Number.isFinite(voltage)) {
      return { ok: false, reason: 'INVALID_VOLTAGE', voltage };
    }
    if (Number(phase) !== 1 && Number(phase) !== 3) {
      return { ok: false, reason: 'INVALID_PHASE', phase };
    }
  }
  if (!(adjustmentFactor > 0) || !Number.isFinite(adjustmentFactor)) {
    return { ok: false, reason: 'INVALID_ADJUSTMENT_FACTOR', adjustmentFactor };
  }

  const hundredPercentRatedExceptionApplied =
    assemblyRatedFor100PercentContinuousOperation === true && contA > 0;
  const continuousLoadMultiplier = hundredPercentRatedExceptionApplied ? 1.0 : 1.25;

  // Test (a): noncontinuous + multiplier x continuous, judged against the table
  // ampacity limited by 110.14(C) and NOT reduced by adjustment/correction.
  const continuousLoadSizingRequirementA = round2(noncontA + continuousLoadMultiplier * contA);
  // Test (b): the actual load, judged against the ampacity AFTER those factors.
  const conditionsOfUseRequirementA = totalActualLoadA;

  const requiredConductorAmpacityA =
    Math.max(continuousLoadSizingRequirementA, conditionsOfUseRequirementA);

  // NYC minimum feeder size. Evaluated separately from every ampacity concept.
  const feedsDwellingUnitStated = feedsDwellingUnit === true || feedsDwellingUnit === false;
  const nycDwellingFeederMinimumApplies =
    jurisdiction === 'NYC' && circuitType === 'FEEDER' && feedsDwellingUnit === true;
  const nycDwellingFeederMinimumSize = nycDwellingFeederMinimumApplies
    ? (material === 'al' ? NYC_DWELLING_FEEDER_MINIMUM.al : NYC_DWELLING_FEEDER_MINIMUM.cu)
    : null;

  const codeReferences = circuitType === 'FEEDER'
    ? ['NEC 215.2(A)(1)(a)', 'NEC 215.2(A)(1)(b)', 'NEC 215.3', 'NEC 110.14(C)', 'NEC 240.4(D)']
    : ['NEC 210.19(A)(1)(a)', 'NEC 210.19(A)(1)(b)', 'NEC 210.20(A)', 'NEC 110.14(C)', 'NEC 240.4(D)'];
  if (nycDwellingFeederMinimumApplies) codeReferences.push(NYC_DWELLING_FEEDER_MINIMUM.code);

  const sizes = material === 'al' ? SIZE_ORDER.filter((s) => s !== '14') : SIZE_ORDER;
  const table = material === 'al' ? AMP_AL : AMP_CU;
  const evaluated = [];
  let winner = null;

  for (const size of sizes) {
    if (!table[size]) continue;

    const amp = calculateAmpacity({
      size, material, insulation, ambientF, adjustmentFactor, terminalRatingC,
    });
    if (!amp.ok) {
      // No published correction factor for this conductor rating at this
      // ambient (e.g. 140°F with TW). The conductor cannot qualify, but the
      // row is still reported — with zero usable ampacity, exactly as the
      // pre-migration app showed it — so the renderer never reaches into the
      // tables itself. OCPD and voltage drop are still evaluated for the row
      // display; they cannot make it pass.
      const cap = smallConductorOcpdLimit(size, material);
      const derived = STANDARD_OCPD.find((b) => b >= continuousLoadSizingRequirementA) ?? null;
      const degradedOcpdOK = (cap === null) || (derived !== null && derived <= cap);
      let dvd = null;
      let dvdOK = true;
      if (feet > 0 && VD_CM[size]) {
        dvd = calculateVoltageDrop({
          amps: totalActualLoadA, feet, voltage, phase, material, size,
        });
        dvdOK = dvd.ok && dvd.percentDrop <= maxVoltDropPercent;
      }
      evaluated.push({
        size,
        ampacityDeterminable: false,
        ampacityUnavailableReason: amp.reason,
        baseAmpacity: amp.baseAmpacity !== undefined ? amp.baseAmpacity : null,
        temperatureCorrectionFactor: 0,
        adjustmentFactor,
        terminalLimit: amp.terminalLimit !== undefined ? amp.terminalLimit : null,
        terminalLimitGoverns: false,
        calculatedAmpacity: 0,
        terminalLimitedAmpacity: 0,
        tableAmpacityAtTerminal: 0,
        continuousTestOK: false,
        conditionsOfUseTestOK: false,
        finalAmpacity: 0,
        ampacityOK: false,
        ampacityWouldPassWithoutTerminalLimit: false,
        rejectedOnlyByTerminalLimit: false,
        smallConductorRuleApplies: cap !== null,
        maxOcpdUnder240_4_D: cap,
        selectedOcpd: null,
        derivedOcpdForSizing: derived,
        ocpdCheckValue: derived,
        ocpdBasis: contA > 0 ? 'CONTINUOUS_LOAD_RULE_MINIMUM' : 'SMALLEST_STANDARD_FOR_CURRENT_LOAD',
        ocpdOK: degradedOcpdOK,
        voltDropPercent: dvd && dvd.ok ? dvd.percentDrop : null,
        voltDropVolts: dvd && dvd.ok ? dvd.voltageDrop : null,
        voltageAtLoad: dvd && dvd.ok ? dvd.voltageAtLoad : null,
        vdOK: dvdOK,
        conductorAccepted: false,
        passes: false,
        reason: 'AMPACITY_NOT_DETERMINABLE',
      });
      continue;
    }

    // ── the six concepts, kept distinct ──────────────────────────────
    // 1. calculated ampacity      base x correction x adjustment
    // 2. terminal-limited ampacity after NEC 110.14(C)
    // 3. minimum conductor size    driven by requiredAmpacity
    // 4. max OCPD under 240.4(D)   material-specific, small conductors only
    // 5. selected OCPD             smallest standard device that can serve the load
    // 6. acceptance + reason
    const calculatedAmpacity = amp.afterAdjustment;
    const terminalLimitedAmpacity = amp.finalAmpacity;

    // Test (a) is judged against the TABLE ampacity capped by 110.14(C), with
    // no adjustment or correction applied. Test (b) is judged against the
    // ampacity after those factors. Collapsing the two would either oversize
    // (derating a figure already multiplied by 125%) or undersize.
    const tableAmpacityAtTerminal = Math.min(amp.baseAmpacity, amp.terminalLimit);
    const continuousTestOK = tableAmpacityAtTerminal >= continuousLoadSizingRequirementA;
    const conditionsOfUseTestOK = terminalLimitedAmpacity >= conditionsOfUseRequirementA;
    const ampacityOK = continuousTestOK && conditionsOfUseTestOK;
    // The same two tests with NO 110.14(C) cap: base table value for test (a),
    // corrected/adjusted value for test (b). Diagnostic only — never used for
    // acceptance — so a renderer can state, without re-deciding, that a
    // conductor was rejected ONLY because of the terminal limitation.
    const ampacityWouldPassWithoutTerminalLimit =
      amp.baseAmpacity >= continuousLoadSizingRequirementA
      && calculatedAmpacity >= conditionsOfUseRequirementA;
    const rejectedOnlyByTerminalLimit = !ampacityOK && ampacityWouldPassWithoutTerminalLimit;

    // Overcurrent device. 210.20(A) / 215.3: the rating shall not be less than
    // noncontinuous + 125% continuous. Where the caller supplied a device we
    // report it; otherwise we derive the smallest standard device satisfying
    // that rule PURELY as a check basis. This tool does not size breakers.
    const callerSupplied = proposedOcpd !== null && proposedOcpd !== undefined;
    const selectedOcpd = callerSupplied ? proposedOcpd : null;
    const derivedOcpdForSizing = callerSupplied
      ? null
      : (STANDARD_OCPD.find((b) => b >= continuousLoadSizingRequirementA) ?? null);
    const ocpdCheckValue = callerSupplied ? selectedOcpd : derivedOcpdForSizing;
    const ocpdBasis = callerSupplied
      ? 'CALLER_SUPPLIED'
      : (contA > 0 ? 'CONTINUOUS_LOAD_RULE_MINIMUM' : 'SMALLEST_STANDARD_FOR_CURRENT_LOAD');

    const maxOcpdUnder240_4_D = smallConductorOcpdLimit(size, material);
    const smallConductorRuleApplies = maxOcpdUnder240_4_D !== null;
    const ocpdOK = ocpdCheckValue === null
      ? false
      : (!smallConductorRuleApplies || ocpdCheckValue <= maxOcpdUnder240_4_D);

    let vd = null;
    let vdOK = true;
    if (feet > 0 && VD_CM[size]) {
      // totalActualLoadA, never the legacy `load` field: with the preferred
      // continuous/noncontinuous input model `load` is null, and a null here
      // silently failed every voltage-drop check (P1-10).
      vd = calculateVoltageDrop({
        amps: totalActualLoadA, feet, voltage, phase, material, size,
      });
      vdOK = vd.ok && vd.percentDrop <= maxVoltDropPercent;
    }

    const passes = ampacityOK && ocpdOK && vdOK;
    const reason = passes ? 'ACCEPTED'
      : !continuousTestOK ? 'FAILS_CONTINUOUS_LOAD_SIZING'
      : !conditionsOfUseTestOK ? 'FAILS_CONDITIONS_OF_USE'
      : !ocpdOK ? 'OCPD_EXCEEDS_240_4_D_LIMIT'
      : 'VOLTAGE_DROP_EXCEEDS_LIMIT';

    evaluated.push({
      size,
      baseAmpacity: amp.baseAmpacity,
      temperatureCorrectionFactor: amp.correctionFactor,
      adjustmentFactor: amp.adjustmentFactor,
      terminalLimit: amp.terminalLimit,
      terminalLimitGoverns: amp.terminalLimitGoverns,
      calculatedAmpacity,
      terminalLimitedAmpacity,
      tableAmpacityAtTerminal,
      continuousTestOK,
      conditionsOfUseTestOK,
      finalAmpacity: terminalLimitedAmpacity, // retained for existing callers
      ampacityOK,
      ampacityWouldPassWithoutTerminalLimit,
      rejectedOnlyByTerminalLimit,
      smallConductorRuleApplies,
      maxOcpdUnder240_4_D,
      selectedOcpd,           // non-null ONLY when the caller supplied one
      derivedOcpdForSizing,   // non-null ONLY when inferred as a check basis
      ocpdCheckValue,         // whichever of the two was compared to the limit
      ocpdBasis,
      ocpdOK,
      voltDropPercent: vd && vd.ok ? vd.percentDrop : null,
      voltDropVolts: vd && vd.ok ? vd.voltageDrop : null,
      voltageAtLoad: vd && vd.ok ? vd.voltageAtLoad : null,
      vdOK,
      conductorAccepted: passes,
      passes,
      reason,
    });
    if (passes && !winner) winner = size;
  }

  // The NEC calculation is complete at this point. The NYC floor is a separate
  // step applied on top of it: it can only raise the selected size.
  const requiredConductorSizeBeforeNYCMinimum = winner;
  if (nycDwellingFeederMinimumApplies && winner) {
    const minIdx = SIZE_ORDER.indexOf(nycDwellingFeederMinimumSize);
    if (minIdx > SIZE_ORDER.indexOf(winner)) winner = nycDwellingFeederMinimumSize;
  }
  const finalSelectedConductor = winner;

  const win = evaluated.find((e) => e.size === winner) || null;

  // ── governing constraint (deterministic, explainable) ────────────────
  // Stage sizes: the smallest conductor that satisfies each cumulative set of
  // constraints in fixed order AMPACITY → 240.4(D) OCPD → VOLTAGE DROP, then
  // the NYC floor. Each stage can only hold or raise the size; the final
  // selection is the last stage. The governing constraint is the LAST stage
  // that actually raised it — every earlier constraint was already satisfied
  // at the smaller size, so it cannot be the binding one.
  const stageIndex = (pred) => {
    const hit = evaluated.find(pred);
    return hit ? SIZE_ORDER.indexOf(hit.size) : Infinity;
  };
  const idxAmpacityStage = stageIndex((e) => e.ampacityOK);
  const idxAmpacityUncapped = stageIndex((e) => e.ampacityWouldPassWithoutTerminalLimit);
  const terminalLimitRaisedAmpacityStage =
    idxAmpacityStage !== Infinity && idxAmpacityStage > idxAmpacityUncapped;
  const idxOcpdStage = stageIndex((e) => e.ampacityOK && e.ocpdOK);
  const idxVdStage = stageIndex((e) => e.ampacityOK && e.ocpdOK && e.vdOK);
  const sizeRequiredByAmpacity =
    idxAmpacityStage === Infinity ? null : SIZE_ORDER[idxAmpacityStage];
  const sizeRequiredWithOcpdRule =
    idxOcpdStage === Infinity ? null : SIZE_ORDER[idxOcpdStage];
  const sizeRequiredWithVoltageDrop =
    idxVdStage === Infinity ? null : SIZE_ORDER[idxVdStage];

  let governingConstraint = null;
  const governingConstraints = [];
  if (finalSelectedConductor) {
    const finalIdx = SIZE_ORDER.indexOf(finalSelectedConductor);
    if (idxAmpacityStage === finalIdx) {
      governingConstraints.push('AMPACITY');
      // Refine, don't replace: AMPACITY stays in the list (the ampacity
      // family is what binds), and TERMINAL_LIMIT is appended when the
      // 110.14(C) cap is specifically what pushed the stage up — so the
      // singular governingConstraint names the true cause.
      if (terminalLimitRaisedAmpacityStage) governingConstraints.push('TERMINAL_LIMIT');
    }
    if (idxOcpdStage === finalIdx && idxOcpdStage > idxAmpacityStage) {
      governingConstraints.push('OCPD_240_4_D');
    }
    if (idxVdStage === finalIdx && idxVdStage > idxOcpdStage) {
      governingConstraints.push('VOLTAGE_DROP');
    }
    if (nycDwellingFeederMinimumApplies
      && requiredConductorSizeBeforeNYCMinimum !== finalSelectedConductor) {
      governingConstraints.push('NYC_DWELLING_FEEDER_MINIMUM');
    }
    governingConstraint = governingConstraints[governingConstraints.length - 1] || 'AMPACITY';
  }

  // Which test actually drives the conductor size? The two requirement figures
  // are judged against different ampacities — the continuous test against the
  // un-derated table value, conditions-of-use against the derated one — so
  // comparing the two amperages directly would be meaningless. Instead find the
  // smallest conductor that satisfies each test on its own; whichever is larger
  // is the binding constraint.
  const firstPassing = (pred) => {
    const hit = evaluated.find(pred);
    return hit ? SIZE_ORDER.indexOf(hit.size) : Infinity;
  };
  const idxContinuous = firstPassing((e) => e.continuousTestOK);
  const idxConditions = firstPassing((e) => e.conditionsOfUseTestOK);
  const governingTest = idxConditions > idxContinuous
    ? 'CONDITIONS_OF_USE'
    : idxContinuous > idxConditions
      ? 'CONTINUOUS_LOAD_SIZING'
      : (contA > 0 ? 'CONTINUOUS_LOAD_SIZING' : 'CONDITIONS_OF_USE');

  return {
    ok: true,
    continuousLoadA: contA,
    noncontinuousLoadA: noncontA,
    totalActualLoadA,
    continuousLoadSizingRequirementA,
    conditionsOfUseRequirementA,
    requiredConductorAmpacityA,
    governingTest,
    circuitType,
    continuousLoadRuleApplied: contA > 0,
    continuousLoadMultiplier,
    hundredPercentRatedExceptionApplied,
    jurisdiction,
    feedsDwellingUnit,
    feedsDwellingUnitStated,
    nycDwellingFeederMinimumApplies,
    nycDwellingFeederMinimumSize,
    requiredConductorSizeBeforeNYCMinimum,
    finalSelectedConductor,
    codeReferences,
    // Input echoes the renderer needs verbatim (never re-derived in the UI).
    material,
    insulation,
    ambientF,
    adjustmentFactor,
    terminalRatingC,
    voltage,
    feet,
    phase: Number(phase),
    maxVoltDropPercent,
    temperatureCorrectionFactor: win ? win.temperatureCorrectionFactor
      : (evaluated[0] ? evaluated[0].temperatureCorrectionFactor : null),
    // Governing-constraint decomposition.
    sizeRequiredByAmpacity,
    sizeRequiredByAmpacityIgnoringTerminalLimit:
      idxAmpacityUncapped === Infinity ? null : SIZE_ORDER[idxAmpacityUncapped],
    terminalLimitRaisedAmpacityStage,
    sizeRequiredWithOcpdRule,
    sizeRequiredWithVoltageDrop,
    governingConstraint,
    governingConstraints,
    terminalLimitGovernsOnSelected: win ? win.terminalLimitGoverns : null,
    // retained for existing callers
    load: totalActualLoadA,
    requiredAmpacity: requiredConductorAmpacityA,
    recommendedSize: winner,
    recommended: win,
    note: 'Overcurrent protection limited per NEC 240.4(D). This tool does not '
      + 'size the overcurrent device: where none was supplied, the smallest '
      + 'standard device able to carry the present load is derived solely to '
      + 'test the 240.4(D) ceiling. Continuous-load factors are not applied. '
      + 'Equipment-specific exceptions in 240.4(E) (taps) and 240.4(G) (motors, '
      + 'A/C and similar) are NOT evaluated here. Equipment-specific rules — '
      + 'EVSE, HVAC, fixed electric space heating and similar — may impose '
      + 'further requirements this generic tool cannot determine from its inputs.'
      + (nycDwellingFeederMinimumApplies
        ? ' NYCEC 215.2(A)(1) sets a minimum of 3 conductors at ' 
          + nycDwellingFeederMinimumSize + ' AWG for a feeder supplying a dwelling unit; '
          + 'this tool applies the size floor but does not verify the 3-conductor arrangement.'
        : (jurisdiction === 'NYC' && circuitType === 'FEEDER' && !feedsDwellingUnitStated
          ? ' NYCEC 215.2(A)(1) sets a minimum feeder size (3 conductors, 8 AWG Cu / 6 AWG Al) '
            + 'where the feeder supplies a dwelling unit. That was not stated, so the minimum '
            + 'was NOT applied — set feedsDwellingUnit explicitly.'
          : '')),    limitingFactor: win
      ? (win.voltDropPercent !== null && win.voltDropPercent > maxVoltDropPercent * 0.9
        ? 'VOLTAGE_DROP' : 'AMPACITY')
      : null,
    evaluated,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
module.exports = { selectConductor, SIZE_ORDER };
