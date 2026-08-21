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
