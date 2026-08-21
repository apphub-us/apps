'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { selectConductor } = require('../src/calc/wireSizing');

describe('Conductor selection — ampacity + OCPD + voltage drop', () => {
  test('P0-2: a 20 A load must not return #14 — NEC 240.4(D) caps it at 15 A', () => {
    // The shipped Wire Sizer omits 240.4(D) entirely. #14 THHN limited to the
    // 75C column is 20 A, so an ampacity-only check accepts it. Code does not.
    const r = selectConductor({ load: 20 });
    assert.notStrictEqual(r.recommendedSize, '14');
    assert.strictEqual(r.recommendedSize, '12');
  });

  test('#14 is still valid for a 15 A load', () => {
    assert.strictEqual(selectConductor({ load: 15 }).recommendedSize, '14');
  });

  test('P0-3: continuous load is sized at 125% — NEC 210.19(A)(1)', () => {
    // The shipped Wire Sizer has no continuous-load input at all.
    const cont = selectConductor({ load: 100, continuousLoad: 100 });
    const non = selectConductor({ load: 100 });
    assert.strictEqual(cont.requiredAmpacity, 125);
    assert.strictEqual(non.requiredAmpacity, 100);
    assert.notStrictEqual(cont.recommendedSize, non.recommendedSize);
  });

  test('mixed continuous and noncontinuous: 60 + 1.25 x 40 = 110 A', () => {
    const r = selectConductor({ load: 100, continuousLoad: 40 });
    assert.strictEqual(r.requiredAmpacity, 110);
  });

  test('a long run is driven by voltage drop, not ampacity', () => {
    const short = selectConductor({ load: 100, feet: 50, voltage: 208, maxVoltDropPercent: 5 });
    const long = selectConductor({ load: 100, feet: 400, voltage: 208, maxVoltDropPercent: 5 });
    assert.notStrictEqual(short.recommendedSize, long.recommendedSize);
    assert.ok(long.recommended.voltDropPercent <= 5);
  });

  test('omitting distance skips the voltage-drop check entirely', () => {
    const r = selectConductor({ load: 100 });
    assert.strictEqual(r.recommended.voltDropPercent, null);
    assert.strictEqual(r.recommended.vdOK, true);
  });

  test('CCC adjustment reduces ampacity and forces a larger conductor', () => {
    const plain = selectConductor({ load: 100 });
    const bundled = selectConductor({ load: 100, adjustmentFactor: 0.5 });
    assert.ok(bundled.recommended.finalAmpacity >= 100);
    assert.notStrictEqual(plain.recommendedSize, bundled.recommendedSize);
  });

  test('aluminium never returns #14 — not a listed size', () => {
    const r = selectConductor({ load: 20, material: 'al' });
    assert.notStrictEqual(r.recommendedSize, '14');
  });

  test('every returned conductor satisfies all three checks simultaneously', () => {
    const r = selectConductor({ load: 150, continuousLoad: 150, feet: 200, voltage: 208 });
    const w = r.recommended;
    assert.strictEqual(w.ampacityOK, true);
    assert.strictEqual(w.ocpdOK, true);
    assert.strictEqual(w.vdOK, true);
  });

  test('invalid inputs fail cleanly', () => {
    assert.strictEqual(selectConductor({ load: 0 }).reason, 'INVALID_LOAD');
    assert.strictEqual(selectConductor({ load: 50, continuousLoad: 80 }).reason, 'INVALID_CONTINUOUS_LOAD');
  });
});

describe('NEC 240.4(D) small conductors — P0-2', () => {
  // 240.4(D) limits the OVERCURRENT DEVICE, not the conductor ampacity.
  // Verified list (2020 NEC), applied after ambient/CCC correction:
  //   18 AWG Cu 7A | 16 AWG Cu 10A | 14 AWG Cu 15A
  //   12 AWG Al/CCA 15A | 12 AWG Cu 20A | 10 AWG Al/CCA 25A | 10 AWG Cu 30A
  // NYC: NYCEC 2025 does not amend Article 240 (verified against § 28-1101.3).

  test('THE DEFECT: a 20 A application must not return #14 Cu', () => {
    const r = selectConductor({ load: 20 });
    assert.notStrictEqual(r.recommendedSize, '14',
      '#14 Cu is capped at 15 A by 240.4(D)(3)');
    assert.strictEqual(r.recommendedSize, '12');
  });

  test('15 A Cu may use #14', () => {
    assert.strictEqual(selectConductor({ load: 15 }).recommendedSize, '14');
  });

  test('20 A Cu may use #12', () => {
    assert.strictEqual(selectConductor({ load: 20 }).recommendedSize, '12');
  });

  test('30 A Cu may use #10', () => {
    assert.strictEqual(selectConductor({ load: 30 }).recommendedSize, '10');
  });

  test('31 A Cu steps past #10 — boundary immediately above the 240.4(D) limit', () => {
    assert.notStrictEqual(selectConductor({ load: 31 }).recommendedSize, '10');
  });

  test('aluminium limits differ from copper: #12 Al is 15 A, not 20 A', () => {
    const al = selectConductor({ load: 20, material: 'al' });
    assert.notStrictEqual(al.recommendedSize, '12', '#12 Al is capped at 15 A by 240.4(D)(4)');
    assert.strictEqual(al.recommendedSize, '10');
  });

  test('aluminium #10 is capped at 25 A, not 30 A', () => {
    assert.notStrictEqual(selectConductor({ load: 30, material: 'al' }).recommendedSize, '10');
    assert.strictEqual(selectConductor({ load: 25, material: 'al' }).recommendedSize, '10');
  });

  test('ampacity is sufficient yet 240.4(D) still controls', () => {
    // #12 Cu THHN is 30 A at 90C and 25 A at the 75C terminal — ampacity alone
    // would accept a 25 A load. 240.4(D)(5) caps the device at 20 A.
    const row = selectConductor({ load: 25 }).evaluated.find((e) => e.size === '12');
    assert.ok(row.terminalLimitedAmpacity >= 25, 'ampacity should be sufficient');
    assert.strictEqual(row.smallConductorRuleApplies, true);
    assert.strictEqual(row.maxOcpdUnder240_4_D, 20);
    assert.strictEqual(row.conductorAccepted, false);
    assert.strictEqual(row.reason, 'OCPD_EXCEEDS_240_4_D_LIMIT');
  });

  test('the cap survives ambient correction and CCC adjustment', () => {
    // Derating lowers ampacity; it can never raise the 240.4(D) ceiling.
    const r = selectConductor({ load: 20, ambientF: 104, adjustmentFactor: 0.8 });
    const row = r.evaluated.find((e) => e.size === '12');
    assert.strictEqual(row.maxOcpdUnder240_4_D, 20);
    assert.ok(row.terminalLimitedAmpacity < 25, 'derating should have reduced ampacity');
  });

  test('240.4(B) next-size-up must not be used to bypass 240.4(D)', () => {
    // 240.4(D) is qualified only by 240.4(E) and 240.4(G) — not by 240.4(B).
    const row = selectConductor({ load: 20 }).evaluated.find((e) => e.size === '14');
    assert.strictEqual(row.conductorAccepted, false);
    assert.strictEqual(row.maxOcpdUnder240_4_D, 15);
    assert.ok(row.ocpdCheckValue > 15, 'the smallest device for a 20 A load exceeds the cap');
  });

  test('conductors above #10 are not subject to the small-conductor rule', () => {
    const row = selectConductor({ load: 100 }).evaluated.find((e) => e.size === '3');
    assert.strictEqual(row.smallConductorRuleApplies, false);
    assert.strictEqual(row.maxOcpdUnder240_4_D, null);
  });

  test('the result keeps the six concepts distinct', () => {
    const row = selectConductor({ load: 20 }).evaluated.find((e) => e.size === '12');
    for (const f of ['calculatedAmpacity', 'terminalLimitedAmpacity', 'smallConductorRuleApplies',
      'maxOcpdUnder240_4_D', 'selectedOcpd', 'derivedOcpdForSizing', 'ocpdCheckValue',
      'ocpdBasis', 'conductorAccepted', 'reason']) {
      assert.ok(f in row, `missing field ${f}`);
    }
    assert.notStrictEqual(row.calculatedAmpacity, row.terminalLimitedAmpacity,
      'calculated and terminal-limited ampacity must not be the same field');
  });

  test('equipment-specific exceptions are flagged, never assumed', () => {
    const r = selectConductor({ load: 20 });
    assert.ok(/240\.4\(E\)|240\.4\(G\)/.test(r.note || ''),
      'the result must note that 240.4(E)/(G) exceptions exist and are not evaluated here');
  });
});

describe('OCPD semantics — derived check basis is not a selected device', () => {
  const row = (opts) => selectConductor(opts).evaluated.find((e) => e.size === '12');

  test('1. a caller-supplied device and an inferred basis are distinguishable', () => {
    const inferred = row({ load: 20 });
    const supplied = row({ load: 20, proposedOcpd: 20 });
    assert.notStrictEqual(inferred.ocpdBasis, supplied.ocpdBasis);
    assert.strictEqual(inferred.ocpdBasis, 'SMALLEST_STANDARD_FOR_CURRENT_LOAD');
    assert.strictEqual(supplied.ocpdBasis, 'CALLER_SUPPLIED');
  });

  test('2. nothing is labelled "selected" unless the caller actually supplied it', () => {
    const inferred = row({ load: 20 });
    assert.strictEqual(inferred.selectedOcpd, null,
      'an inferred value must never appear as selectedOcpd');
    assert.strictEqual(inferred.derivedOcpdForSizing, 20);

    const supplied = row({ load: 20, proposedOcpd: 15 });
    assert.strictEqual(supplied.selectedOcpd, 15);
    assert.strictEqual(supplied.derivedOcpdForSizing, null,
      'no value should be derived when one was supplied');
  });

  test('the two fields are mutually exclusive, and ocpdCheckValue mirrors whichever applies', () => {
    for (const opts of [{ load: 20 }, { load: 20, proposedOcpd: 20 }, { load: 100 }]) {
      const r = row(opts) || selectConductor(opts).recommended;
      const both = r.selectedOcpd !== null && r.derivedOcpdForSizing !== null;
      assert.ok(!both, 'selectedOcpd and derivedOcpdForSizing must not both be set');
      assert.strictEqual(r.ocpdCheckValue,
        r.selectedOcpd !== null ? r.selectedOcpd : r.derivedOcpdForSizing);
    }
  });

  test('a supplied device that violates 240.4(D) rejects the conductor', () => {
    // #12 Cu is capped at 20 A; a caller proposing 30 A must be told no.
    const r = row({ load: 15, proposedOcpd: 30 });
    assert.strictEqual(r.selectedOcpd, 30);
    assert.strictEqual(r.conductorAccepted, false);
    assert.strictEqual(r.reason, 'OCPD_EXCEEDS_240_4_D_LIMIT');
  });

  test('3. conductor recommendations are unchanged by this rename', () => {
    assert.strictEqual(selectConductor({ load: 20 }).recommendedSize, '12');
    assert.strictEqual(selectConductor({ load: 15 }).recommendedSize, '14');
    assert.strictEqual(selectConductor({ load: 30 }).recommendedSize, '10');
    assert.strictEqual(selectConductor({ load: 31 }).recommendedSize, '8');
    assert.strictEqual(selectConductor({ load: 20, material: 'al' }).recommendedSize, '10');
    assert.strictEqual(selectConductor({ load: 25, material: 'al' }).recommendedSize, '10');
  });

  test('the note does not claim the breaker has been sized', () => {
    const n = selectConductor({ load: 20 }).note;
    assert.ok(/does not\s+size the overcurrent device/.test(n), n);
    assert.ok(/Continuous-load factors are not applied/.test(n));
  });
});

describe('Continuous loads — NEC 210.19(A)(1) / 215.2(A)(1) — P0-3', () => {
  // Article 100: a continuous load is one where the maximum current is
  // expected to continue for 3 hours or more.
  //
  // Both 210.19(A)(1) (branch) and 215.2(A)(1) (feeder) require the LARGER of:
  //   (a) noncontinuous + 125% continuous, against the table ampacity limited
  //       by 110.14(C), BEFORE adjustment/correction
  //   (b) the actual load, against the ampacity AFTER adjustment/correction
  // Exception No.1 to (a): assembly INCLUDING the OCPD listed for operation at
  // 100% of its rating -> the 125% multiplier becomes 100%.
  // NYC amends 210.19(A)/215.2(A)(1) to add BOTH the mandatory 5% voltage
  // drop AND, for 215.2(A)(1), a minimum feeder size where the feeder
  // supplies a dwelling unit. See NYC_DWELLING_FEEDER_MINIMUM.

  const row = (opts, size) => selectConductor(opts).evaluated.find((e) => e.size === size);

  test('1. 20 A entirely noncontinuous', () => {
    const r = selectConductor({ noncontinuousLoadA: 20 });
    assert.strictEqual(r.continuousLoadSizingRequirementA, 20);
    assert.strictEqual(r.conditionsOfUseRequirementA, 20);
    assert.strictEqual(r.continuousLoadRuleApplied, false);
    assert.strictEqual(r.recommendedSize, '12');
  });

  test('2. 20 A entirely continuous requires 25 A of conductor', () => {
    const r = selectConductor({ continuousLoadA: 20 });
    assert.strictEqual(r.continuousLoadSizingRequirementA, 25);
    assert.strictEqual(r.conditionsOfUseRequirementA, 20);
    assert.strictEqual(r.continuousLoadMultiplier, 1.25);
    assert.strictEqual(r.recommendedSize, '10',
      '#12 Cu is 25 A at the 75C terminal but 240.4(D) caps its device at 20 A');
  });

  test('3. mixed 10 A continuous + 10 A noncontinuous', () => {
    const r = selectConductor({ continuousLoadA: 10, noncontinuousLoadA: 10 });
    assert.strictEqual(r.totalActualLoadA, 20);
    assert.strictEqual(r.continuousLoadSizingRequirementA, 22.5); // 10 + 12.5
    assert.strictEqual(r.conditionsOfUseRequirementA, 20);
  });

  test('4. the continuous-load test controls when there is no derating', () => {
    const r = selectConductor({ continuousLoadA: 40, noncontinuousLoadA: 0 });
    assert.strictEqual(r.continuousLoadSizingRequirementA, 50);
    assert.strictEqual(r.requiredConductorAmpacityA, 50);
    assert.strictEqual(r.governingTest, 'CONTINUOUS_LOAD_SIZING');
  });

  test('5. conditions of use control once adjustment factors bite', () => {
    // 45 A load, all noncontinuous, 0.5 adjustment: test (a) needs only 45 A of
    // table ampacity, but test (b) needs 45 A AFTER halving.
    const r = selectConductor({ noncontinuousLoadA: 45, adjustmentFactor: 0.5 });
    assert.strictEqual(r.continuousLoadSizingRequirementA, 45);
    assert.strictEqual(r.conditionsOfUseRequirementA, 45);
    const w = r.recommended;
    assert.ok(w.calculatedAmpacity >= 45, 'derated ampacity must still cover the load');
    assert.strictEqual(r.governingTest, 'CONDITIONS_OF_USE');
  });

  test('6. ambient correction is applied to test (b) only', () => {
    const r = selectConductor({ continuousLoadA: 30, ambientF: 113 });
    assert.strictEqual(r.continuousLoadSizingRequirementA, 37.5);
    const w = r.recommended;
    assert.ok(w.tableAmpacityAtTerminal >= 37.5, 'test (a) uses the undated table ampacity');
    assert.ok(w.calculatedAmpacity >= 30, 'test (b) uses the corrected ampacity');
  });

  test('7. CCC adjustment is applied to test (b) only', () => {
    const r = selectConductor({ continuousLoadA: 30, adjustmentFactor: 0.7 });
    assert.strictEqual(r.continuousLoadSizingRequirementA, 37.5);
    assert.ok(r.recommended.calculatedAmpacity >= 30);
  });

  test('8. branch circuit cites 210.19(A)(1) and 210.20(A)', () => {
    const r = selectConductor({ continuousLoadA: 20, circuitType: 'BRANCH_CIRCUIT' });
    assert.strictEqual(r.circuitType, 'BRANCH_CIRCUIT');
    assert.ok(r.codeReferences.join(' ').includes('210.19(A)(1)'));
    assert.ok(r.codeReferences.join(' ').includes('210.20(A)'));
  });

  test('9. feeder cites 215.2(A)(1) and 215.3', () => {
    const r = selectConductor({ continuousLoadA: 20, circuitType: 'FEEDER' });
    assert.strictEqual(r.circuitType, 'FEEDER');
    assert.ok(r.codeReferences.join(' ').includes('215.2(A)(1)'));
    assert.ok(r.codeReferences.join(' ').includes('215.3'));
  });

  test('10. a caller-supplied OCPD is reported as selected, not derived', () => {
    const w = row({ continuousLoadA: 20, proposedOcpd: 30 }, '10');
    assert.strictEqual(w.selectedOcpd, 30);
    assert.strictEqual(w.derivedOcpdForSizing, null);
  });

  test('11. the derived OCPD basis uses the continuous rule, not the raw load', () => {
    const w = row({ continuousLoadA: 20 }, '10');
    // 210.20(A): device not less than 0 + 1.25 x 20 = 25 A -> next standard 25 A
    assert.strictEqual(w.derivedOcpdForSizing, 25);
    assert.strictEqual(w.selectedOcpd, null);
    assert.strictEqual(w.ocpdBasis, 'CONTINUOUS_LOAD_RULE_MINIMUM');
  });

  test('12. the 100%-rated assembly exception drops the multiplier to 1.00', () => {
    const r = selectConductor({
      continuousLoadA: 20, assemblyRatedFor100PercentContinuousOperation: true,
    });
    assert.strictEqual(r.hundredPercentRatedExceptionApplied, true);
    assert.strictEqual(r.continuousLoadMultiplier, 1.0);
    assert.strictEqual(r.continuousLoadSizingRequirementA, 20);
  });

  test('13. the 100% exception is NEVER assumed by default', () => {
    const r = selectConductor({ continuousLoadA: 20 });
    assert.strictEqual(r.hundredPercentRatedExceptionApplied, false);
    assert.strictEqual(r.continuousLoadMultiplier, 1.25);
  });

  test('14. 240.4(D) still controls small conductors under a continuous load', () => {
    // 16 A continuous -> 20 A required. #12 Cu has the ampacity, but the OCPD
    // must be at least 20 A and 240.4(D)(5) caps #12 Cu at exactly 20 A.
    const w = row({ continuousLoadA: 16 }, '12');
    assert.strictEqual(w.maxOcpdUnder240_4_D, 20);
    assert.strictEqual(w.derivedOcpdForSizing, 20);
    assert.strictEqual(w.conductorAccepted, true);

    // 17 A continuous -> 21.25 A -> device 25 A, above the #12 cap.
    const w2 = row({ continuousLoadA: 17 }, '12');
    assert.strictEqual(w2.derivedOcpdForSizing, 25);
    assert.strictEqual(w2.conductorAccepted, false);
    assert.strictEqual(w2.reason, 'OCPD_EXCEEDS_240_4_D_LIMIT');
  });

  test('the result explains which test governed and cites the code', () => {
    const r = selectConductor({ continuousLoadA: 20 });
    for (const f of ['continuousLoadA', 'noncontinuousLoadA', 'totalActualLoadA',
      'continuousLoadSizingRequirementA', 'conditionsOfUseRequirementA',
      'requiredConductorAmpacityA', 'circuitType', 'continuousLoadRuleApplied',
      'continuousLoadMultiplier', 'hundredPercentRatedExceptionApplied',
      'governingTest', 'codeReferences']) {
      assert.ok(f in r, `missing ${f}`);
    }
  });

  test('equipment-specific rules are flagged as out of scope', () => {
    const n = selectConductor({ continuousLoadA: 20 }).note;
    assert.ok(/EVSE|equipment-specific/i.test(n),
      'the note must say equipment-specific rules are not applied here');
  });
});

describe('NYC minimum dwelling-unit feeder — NYCEC 2025 215.2(A)(1)', () => {
  // Verified against the official NYC 2025 Electrical Code:
  //   "The minimum feeder size feeding a dwelling unit shall be 3 conductors
  //    with minimum 8 AWG copper or 6 AWG aluminum or copper-clad aluminum
  //    conductors."
  // A 2019 NYC DOB code interpretation confirms the rule is a minimum for
  // feeders to a DWELLING UNIT, not to every feeder.
  //
  // This is a minimum SIZE rule. It is not an ampacity, terminal or OCPD rule
  // and must not be folded into any of them.

  test('A. NYC dwelling feeder, small Cu load, must not go below #8', () => {
    const r = selectConductor({
      noncontinuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: true,
    });
    assert.strictEqual(r.nycDwellingFeederMinimumApplies, true);
    assert.strictEqual(r.nycDwellingFeederMinimumSize, '8');
    assert.strictEqual(r.requiredConductorSizeBeforeNYCMinimum, '12');
    assert.strictEqual(r.finalSelectedConductor, '8');
    assert.strictEqual(r.recommendedSize, '8');
  });

  test('B. NYC dwelling feeder, small Al load, must not go below #6', () => {
    const r = selectConductor({
      noncontinuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: true, material: 'al',
    });
    assert.strictEqual(r.nycDwellingFeederMinimumSize, '6');
    assert.strictEqual(r.finalSelectedConductor, '6');
  });

  test('C. NYC feeder NOT supplying a dwelling unit is unaffected', () => {
    const r = selectConductor({
      noncontinuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: false,
    });
    assert.strictEqual(r.nycDwellingFeederMinimumApplies, false);
    assert.strictEqual(r.recommendedSize, '12');
  });

  test('D. a branch circuit is unaffected, even in a dwelling', () => {
    const r = selectConductor({
      noncontinuousLoadA: 20, circuitType: 'BRANCH_CIRCUIT', feedsDwellingUnit: true,
    });
    assert.strictEqual(r.nycDwellingFeederMinimumApplies, false);
    assert.strictEqual(r.recommendedSize, '12');
  });

  test('E. a larger calculated conductor still governs over the minimum', () => {
    const r = selectConductor({
      noncontinuousLoadA: 150, circuitType: 'FEEDER', feedsDwellingUnit: true,
    });
    assert.strictEqual(r.requiredConductorSizeBeforeNYCMinimum, '1/0');
    assert.strictEqual(r.finalSelectedConductor, '1/0');
    assert.strictEqual(r.nycDwellingFeederMinimumApplies, true,
      'the rule is in force; it simply is not the binding constraint here');
  });

  test('the minimum is never assumed when the question was not answered', () => {
    const r = selectConductor({ noncontinuousLoadA: 20, circuitType: 'FEEDER' });
    assert.strictEqual(r.feedsDwellingUnitStated, false);
    assert.strictEqual(r.nycDwellingFeederMinimumApplies, false);
    assert.ok(/dwelling unit/i.test(r.note), 'the note must say the question was not answered');
  });

  test('the rule is skipped outside NYC', () => {
    const r = selectConductor({
      noncontinuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: true, jurisdiction: 'NEC',
    });
    assert.strictEqual(r.nycDwellingFeederMinimumApplies, false);
    assert.strictEqual(r.recommendedSize, '12');
  });

  test('the minimum stacks with, and does not replace, the continuous-load rule', () => {
    const r = selectConductor({
      continuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: true,
    });
    assert.strictEqual(r.continuousLoadSizingRequirementA, 25); // unchanged
    assert.strictEqual(r.requiredConductorSizeBeforeNYCMinimum, '10');
    assert.strictEqual(r.finalSelectedConductor, '8');
  });

  test('the result cites the NYC amendment', () => {
    const r = selectConductor({
      noncontinuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: true,
    });
    assert.ok(r.codeReferences.some((c) => /NYCEC.*215\.2\(A\)\(1\)/.test(c)),
      `codeReferences should cite the NYC amendment: ${r.codeReferences.join(', ')}`);
  });

  test('the 3-conductor part of the rule is surfaced, not silently ignored', () => {
    const r = selectConductor({
      noncontinuousLoadA: 20, circuitType: 'FEEDER', feedsDwellingUnit: true,
    });
    assert.ok(/3 conductors/i.test(r.note),
      'the note must mention the 3-conductor requirement this tool does not verify');
  });
});
