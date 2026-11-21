'use strict';
/**
 * T-A math_model records (32) — EC-CALC-2 / B1.
 * Class MODEL: pure arithmetic of the contract's declared IEEE-754 order. Where
 * the engine owns the relationship (VA -> A divisor of a supported model,
 * x 1.25, raw comparison, display rounding, amperes-path terminals) the SAME
 * number is also taken from the real engine on a supported topology. Nothing
 * here enables 480 V single-phase, 240 V delta models, per-load model
 * arithmetic in profile A, or upper-bound screening: those T-A records are
 * checked as mathematics or as the engine's explicit unsupported state.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { evaluate, formatNumber, SQRT3, PROFILE, LoadCalcEnvelopeError } = require('../src/calc/loadCalc');
const { parseStrictJson, parseNumberField } = require('../src/calc/loadCalcInput');
const H = require('./helpers/loadCalcFixtures');
const X = require('./helpers/loadCalcExtraCases');

const S3 = Math.sqrt(3.0);
const exp = (id) => H.caseById(id).expected;
const inp = (id) => H.caseById(id).modelInput;
/** Engine VA-path result for a supported topology/model with the given existing reading (VA) and rating. */
function engineVA(topology, model, readingVA, rating, decls) {
  const meas = X.annual(readingVA, 'VA', { existing: { serviceRatingA: rating, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: X.decl(null), serviceOverloadPer230_90: X.decl(true) } });
  return evaluate(X.env(X.snap({ supply: X.supply(topology), loadModel: { kind: model, declarations: decls || {} }, measurement: meas })));
}

describe('MODEL — T-A-01..10: VA -> A divisors and the 125 % component', () => {
  test('T-A-01 single_2w at 480 V is arithmetic only (no 480 V 1-ph product topology exists): 100000 / 480', () => {
    assert.strictEqual(100000 / 480, exp('T-A-01').amps); assert.strictEqual(SQRT3, S3);
    assert.throws(() => evaluate(X.env(X.snap({ supply: { topology: '1ph_2w_240', vLineToLine: 480, vLineToNeutral: null, phases: 1, wires: 2 }, loadModel: { kind: 'single_2w', declarations: {} }, measurement: X.annual(80000, 'VA') }))), LoadCalcEnvelopeError, 'a 480 V single-phase supply is structurally impossible');
  });
  test('T-A-02 three_phase_balanced 480 V: 100000 / (sqrt3 x 480) — mathematics and the engine (480Y/277, 80,000 VA x 1.25)', () => {
    assert.strictEqual(100000 / (S3 * 480), exp('T-A-02').amps);
    const r = engineVA('3ph_4w_480Y_277', 'three_phase_balanced', 80000, 200, { balanced3ph: X.decl(true) });
    assert.strictEqual(r.demand.totalVA, 100000); assert.strictEqual(r.current.lineA, exp('T-A-02').amps);
  });
  test('T-A-03 / T-A-04 / T-A-07 / T-A-10 split-phase VA / 240 — mathematics and the engine', () => {
    for (const [id, key, readingVA] of [['T-A-03', 'ampsPerLeg', 160000], ['T-A-04', 'ampsPerLeg', 1600000], ['T-A-07', 'ampsPerLeg', 39396], ['T-A-10', 'ampsPerLeg', 200000]]) {
      const e = exp(id); const total = inp(id).va !== undefined ? inp(id).va : inp(id).existingVA * inp(id).factor;
      assert.strictEqual(total / 240, e[key], id);
      const r = engineVA('1ph_3w_120_240', 'split_240_all_LL', readingVA, 1000);
      assert.strictEqual(r.demand.totalVA, total, id); assert.strictEqual(r.current.lineA, e[key], id); assert.strictEqual(r.current.perConductorA.L1, e[key]); assert.strictEqual(r.current.perConductorA.L2, e[key]);
    }
    assert.strictEqual(exp('T-A-10').va, 250000);
  });
  test('T-A-05 240 V delta 3-ph: conversion documented as mathematics only; the engine reports MODEL_UNSUPPORTED (3-pole presentation)', () => {
    assert.strictEqual(60000 / (S3 * 240), exp('T-A-05').amps); assert.strictEqual(exp('T-A-05').polesLabel, '3-pole');
    const r = engineVA('3ph_3w_240_delta', 'three_phase_balanced', 48000, 200, { balanced3ph: X.decl(true) });
    assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.current.status, 'not_computed'); assert.strictEqual(r.existingCapacity.blockingCode, 'MODEL_UNSUPPORTED'); assert.strictEqual(r.presentation.polesLabel, '3-pole');
  });
  test('T-A-06 / T-A-08 208Y three-phase: VA / (sqrt3 x 208) — mathematics and the engine divisor', () => {
    assert.strictEqual(30750 / (S3 * 208), exp('T-A-06').amps); assert.strictEqual(46954 / (S3 * 208), exp('T-A-08').amps);
    const r6 = engineVA('3ph_4w_208Y_120', 'three_phase_balanced', 24600, 200, { balanced3ph: X.decl(true) });
    assert.strictEqual(r6.demand.totalVA, 30750); assert.strictEqual(r6.current.lineA, exp('T-A-06').amps);
    const r8 = engineVA('3ph_4w_208Y_120', 'three_phase_balanced', 46954 / 1.25, 200, { balanced3ph: X.decl(true) });
    assert.strictEqual(r8.current.lineA, r8.demand.totalVA / (S3 * 208), 'engine divisor is sqrt3 x V_LL computed first');
  });
  test('T-A-09 existing 40,000 VA x 1.25 = 50,000 (T-N-01 existing125 line)', () => {
    assert.strictEqual(40000 * 1.25, exp('T-A-09').va);
    const r = evaluate(H.caseById('T-N-01').envelope); assert.strictEqual(r.demand.lines[0].result.value, exp('T-A-09').va); assert.strictEqual(r.demand.lines[0].factor, 1.25);
  });
});

describe('MODEL — T-A-11..13: non-finite/negative readings and the inactive rating layer', () => {
  test('T-A-11 amps [-6.3, "NaN", 0]: -6.3 and 0 -> OUT_OF_RANGE (engine), NaN token -> PARSE_REJECTED (L1) / NOT_FINITE (field parser) / structural rejection (L2); current not_computed', () => {
    const e = exp('T-A-11'); assert.deepStrictEqual(e.problemCodes, ['NOT_FINITE', 'OUT_OF_RANGE']);
    for (const v of [-6.3, 0]) { const r = evaluate(X.env(X.snap({ measurement: X.thirtyDayA(v) }))); assert.strictEqual(r.status, 'INVALID_INPUT'); assert.strictEqual(r.problems[0].code, 'OUT_OF_RANGE'); assert.strictEqual(r.current.status, e.currentStatus); }
    assert.strictEqual(parseStrictJson('{"measurement":{"reading":{"value":NaN,"unit":"A"}}}').code, 'PARSE_REJECTED');
    assert.strictEqual(parseNumberField('NaN', { field: 'measurement.reading.value' }).error.code, 'NOT_FINITE');
    assert.throws(() => evaluate(X.env(X.snap({ measurement: X.thirtyDayA(NaN) }))), LoadCalcEnvelopeError);
  });
  test('T-A-12 / T-A-13 rating stays not_assessed for 833/1041/8333 A and 31/144/205 A; no 600 A ceiling, no 100/150/200/300/400 chain in the result', () => {
    for (const total of [833.3 * 240, 1041.7 * 240, 8333.3 * 240, 31.3 * 240, 144.3 * 240, 205.2 * 240]) {
      const r = engineVA('1ph_3w_120_240', 'split_240_all_LL', total / 1.25, 100);
      assert.strictEqual(r.rating.status, exp('T-A-12').v32RatingStatus); assert.strictEqual(r.requiredCapacity.status, 'not_assessed'); assert.deepStrictEqual(Object.keys(r.rating).sort(), ['note', 'status'], 'no candidate, no chain value');
      assert.strictEqual(PROFILE.autoRating, false);
    }
    assert.strictEqual(exp('T-A-12').futureOnly, true); assert.strictEqual(exp('T-A-13').v32RatingStatus, 'not_assessed');
  });
});

describe('MODEL — T-A-14..19: network and split-phase load-distribution models (reviewer counterexamples)', () => {
  test('T-A-14 network all-LL, one 7,200 VA L-L load: 7200 / 208 on each conductor — mathematics and the engine', () => {
    const e = exp('T-A-14'); assert.strictEqual(7200 / 208, e.lineA); assert.deepStrictEqual(e.perConductorA, { L1: 7200 / 208, L2: 7200 / 208 });
    const r = engineVA('1ph_3w_120_208_network', 'network_208_all_LL', 5760, 100); assert.strictEqual(r.demand.totalVA, 7200); assert.strictEqual(r.current.lineA, e.lineA);
  });
  test('T-A-15 network balanced-LN, two 3,600 VA L-N loads: (7200 / 2) / 120 = 30 A, NOT 7200 / 208 — mathematics and the engine', () => {
    const e = exp('T-A-15'); assert.strictEqual((7200 / 2) / 120, 30); assert.deepStrictEqual(e.perConductorA, { L1: 30, L2: 30 }); assert.notStrictEqual(7200 / 208, 30);
    const r = engineVA('1ph_3w_120_208_network', 'network_208_balanced_LN', 5760, 100, { balancedLN: X.decl(true) }); assert.strictEqual(r.current.lineA, 30); assert.deepStrictEqual(r.current.perConductorA, { L1: 30, L2: 30, L3: null });
  });
  test('T-A-16 network mixed LL + L-N: engine MODEL_UNSUPPORTED; the reference L1 current at unity PF (30 deg offset) exceeds VA/208 — mathematics only', () => {
    const e = exp('T-A-16');
    const r = engineVA('1ph_3w_120_208_network', 'network_208_mixed', 5760, 100);
    assert.strictEqual(r.current.status, e.currentStatus); assert.ok(r.problems.some((p) => p.code === e.problemCodes[0] && p.layer === 'current'));
    const a = 3600 / 208; const b = 3600 / 120; const l1 = Math.round(Math.hypot(a * Math.cos(Math.PI / 6) + b, a * Math.sin(Math.PI / 6)) * 100) / 100;
    assert.strictEqual(l1, e.referenceOnly.exactL1A_unityPF); assert.strictEqual(7200 / 208, e.referenceOnly.va_over_208); assert.ok(l1 > 7200 / 208);
  });
  test('T-A-17 / T-A-19 declared legs (per-load model, not a profile A computation): L1 = LL/240 + LN(L1)/120 — mathematics', () => {
    assert.deepStrictEqual({ L1: 3600 / 240 + 3600 / 120, L2: 3600 / 240 }, exp('T-A-17').perConductorA); assert.strictEqual(exp('T-A-17').lineA, 45);
    assert.deepStrictEqual({ L1: 7200 / 120, L2: 0 }, exp('T-A-19').perConductorA); assert.notStrictEqual(7200 / 240, exp('T-A-19').lineA, 'old per-leg VA/240 would under-estimate by half');
  });
  test('T-A-18 split-phase balanced-LN, two 3,600 VA L-N loads: 30 A — mathematics and the engine (VA / 240 under the declaration)', () => {
    assert.deepStrictEqual(exp('T-A-18').perConductorA, { L1: 30, L2: 30 }); assert.strictEqual(7200 / 240, 30);
    const r = engineVA('1ph_3w_120_240', 'split_240_balanced_LN', 5760, 100, { balancedLN: X.decl(true) }); assert.strictEqual(r.current.lineA, 30); assert.deepStrictEqual(r.current.assumptions, ['balancedLN declared']);
  });
});

describe('MODEL — T-A-20 and T-A-31..32: amperes-path association counterexamples', () => {
  test('T-A-20: 100 A x 1.25 + 3,600 VA / 120 V on the same conductor = 155 A (engine T-N-16 t_L1); the balanced surrogate is never produced', () => {
    const e = exp('T-A-20'); const r = evaluate(H.caseById('T-N-16').envelope);
    assert.strictEqual(r.demand.lines.find((l) => l.id === 't_L1').result.value, e.aOnThatConductor); assert.strictEqual(100 * 1.25 + 3600 / 120, 155);
    const surrogate = (1.25 * S3 * 208 * 100 + 3600) / (S3 * 208); assert.strictEqual(surrogate, e.balancedSurrogateA_rejected);
    assert.ok(!r.demand.lines.some((l) => l.result.value === surrogate)); assert.ok(!r.existingCapacity.comparisons.some((c) => c.demandValueRaw === surrogate));
  });
  test('T-A-31 (p10): exact L1 125 / L2 55 adequate from the engine (T-N-15); the 155 A envelope is mathematics the engine never emits (screening off)', () => {
    const e = exp('T-A-31'); const r = evaluate(H.caseById('T-N-15').envelope);
    assert.deepStrictEqual(r.existingCapacity.comparisons.map((c) => [c.conductor, c.demandValueRaw]), [['L1', e.exact.L1], ['L2', e.exact.L2]]); assert.strictEqual(r.existingCapacity.status, e.exactVerdict);
    assert.strictEqual(100 * 1.25 + 3600 / 120, e.envelopeIfAllNewOnHighest); assert.strictEqual(155 > 150 ? 'bound_exceeded' : 'bound_satisfied', e.boundOutcome);
    assert.strictEqual(r.diagnostics.upperBoundScreening, null); assert.strictEqual(PROFILE.upperBoundScreening, false);
  });
  test('T-A-32: 3PH term 7,200 VA on 208Y: section-5 addition 7200/(sqrt3 x 208) and total 144.985.. from the engine (T-N-30); the obsolete 159.6 A never appears', () => {
    const e = exp('T-A-32'); const r = evaluate(H.caseById('T-N-30').envelope);
    assert.strictEqual(r.demand.lines.find((l) => l.id === 'n_3PH').result.value, e.section5_additionA); assert.strictEqual(r.demand.totalOnConductorA, e.totalA); assert.strictEqual(r.existingCapacity.status, e.verdictPerModel);
    assert.strictEqual(125 + 7200 / 208, e.obsoleteSection74_totalA); assert.ok(!r.demand.lines.some((l) => l.result.value === e.obsoleteSection74_totalA));
  });
});

describe('MODEL — T-A-21..30: literal raw-comparison boundaries and display rounding (engine numbers vs hand-written literals)', () => {
  for (const [ta, tn] of [['T-A-21', 'T-N-18'], ['T-A-22', 'T-N-19'], ['T-A-23', 'T-N-20']]) {
    test(`${ta} 1-ph boundary literal == engine ${tn}`, () => {
      const e = exp(ta); const r = evaluate(H.caseById(tn).envelope);
      assert.strictEqual(r.demand.lines[0].result.value, e.component125VA); assert.strictEqual(r.current.lineA, e.rawA); assert.strictEqual(r.existingCapacity.status, e.verdict);
      if (e.displayA_1dp) assert.strictEqual(r.display.strings.lineA, e.displayA_1dp);
    });
  }
  for (const [ta, tn] of [['T-A-24', 'T-N-21'], ['T-A-25', 'T-N-22'], ['T-A-26', 'T-N-23']]) {
    test(`${ta} 3-ph boundary literal == engine ${tn} (evaluation order (VA x 1.25) / (sqrt3 x 208))`, () => {
      const e = exp(ta); const r = evaluate(H.caseById(tn).envelope);
      assert.strictEqual(r.demand.lines[0].result.value, e.component125VA); assert.strictEqual(r.current.lineA, e.rawA); assert.strictEqual(r.existingCapacity.status, e.verdict);
    });
  }
  for (const [ta, tn] of [['T-A-27', 'T-N-24'], ['T-A-28', 'T-N-25'], ['T-A-29', 'T-N-26']]) {
    test(`${ta} amperes-path boundary literal == engine ${tn}`, () => {
      const e = exp(ta); const r = evaluate(H.caseById(tn).envelope);
      assert.strictEqual(r.demand.totalOnConductorA, e.component125A); assert.strictEqual(r.existingCapacity.status, e.verdict);
      if (e.displayA_1dp) assert.strictEqual(r.display.strings.totalOnConductorA, e.displayA_1dp);
    });
  }
  test('T-A-30 display strings: half away from zero at precisions 0..3 (engine formatter == hand-written literals); display never feeds a comparison', () => {
    const e = exp('T-A-30');
    for (const [val, table] of Object.entries(e.strings)) for (const [p, s] of Object.entries(table)) assert.strictEqual(formatNumber(Number(val), Number(p)), s, `${val} @ ${p}`);
    const r = evaluate(H.caseById('T-N-20').envelope); assert.strictEqual(r.display.feedsComparison, false);
  });
});
