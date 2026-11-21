'use strict';
/**
 * Load Calc engine — EC-CALC-2 / B1 (contract v3.2.2, schema "3.2.1").
 *
 * Proof classes kept separate (see docs/load-calc-b1.md):
 *   ENGINE     actual `evaluate(envelope)` compared to the LITERAL expected object
 *              of the unchanged r22 fixture (128 pairs: 114 primary + 14 post-action)
 *   ENGINE-L3  negative input rules exercised against the engine (not a checker)
 *   ENGINE-GEN hand-written generalization cases not used to design the code
 *   ENGINE-DET determinism, frozen inputs, no aliasing, bounded seeded properties
 *   L2         structural boundary: a schema-invalid request never reaches arithmetic
 * Replaying a supplied post-action envelope tests the engine's output only; it
 * does not prove that a browser or reducer produced that envelope (B2).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { evaluate, PROFILE, LoadCalcEnvelopeError, formatNumber, fmtG, SQRT3 } = require('../src/calc/loadCalc');
const H = require('./helpers/loadCalcFixtures');
const X = require('./helpers/loadCalcExtraCases');
const { ISOLATED } = require('../tools/loadcalc-core-check');

const PAIRS = H.enginePairs();
const opts = (p) => (p.displayPrecision ? { displayPrecision: p.displayPrecision } : undefined);

describe('ENGINE — inventory of the unchanged r22 fixture', () => {
  test('169 records, 128 full envelope/result pairs (114 primary + 14 post-action), 20 expected:null never executed as PASS', () => {
    const tc = H.loadCases();
    assert.strictEqual(tc.cases.length, 169);
    assert.strictEqual(new Set(tc.cases.map((c) => c.id)).size, 169);
    assert.strictEqual(PAIRS.length, 128);
    assert.strictEqual(PAIRS.filter((p) => !p.id.includes('/then[')).length, 114);
    assert.strictEqual(tc.cases.filter((c) => c.expected === null).length, 20);
    assert.ok(tc.cases.every((c) => c.engineRun === false), 'fixture bytes are historical: engineRun stays false in the file');
  });
});

describe('ENGINE — actual evaluate(envelope) vs literal expected (r22)', () => {
  for (const p of PAIRS) {
    const diffs = H.deepDiff(evaluate(p.envelope, opts(p)), p.expected, '$');
    const onlyIsolated = diffs.length > 0 && diffs.every((d) => ISOLATED.includes(d.path));
    if (!onlyIsolated) {
      test(`${p.id} — exact literal match${p.step ? ' [' + p.step + ']' : ''}`, () => {
        assert.deepStrictEqual(evaluate(p.envelope, opts(p)), p.expected);
      });
    } else {
      test(`${p.id} — CONTRADICTION ISOLATED: identical except ${ISOLATED.join(',')} (engine false, fixture true)`, () => {
        const r = evaluate(p.envelope, opts(p));
        const d = H.deepDiff(r, p.expected, '$');
        assert.deepStrictEqual(d.map((x) => x.path), ISOLATED, 'no other field may differ');
        assert.strictEqual(r.diagnostics.continuityOfNewLoadKnown, false);
        assert.strictEqual(p.expected.diagnostics.continuityOfNewLoadKnown, true);
        assert.strictEqual(r.diagnostics.operative, false, 'the differing field is non-operative');
      });
    }
  }
  test('tally: 125 exact, 3 differing only on the isolated non-operative diagnostic, 0 other mismatches', () => {
    let exact = 0; let isolated = 0; let other = 0;
    for (const p of PAIRS) {
      const d = H.deepDiff(evaluate(p.envelope, opts(p)), p.expected, '$');
      if (!d.length) exact++; else if (d.every((x) => ISOLATED.includes(x.path))) isolated++; else other++;
    }
    assert.deepStrictEqual({ exact, isolated, other }, { exact: 125, isolated: 3, other: 0 });
  });
});

describe('ENGINE-L3 — qualification and rule negatives executed against the engine', () => {
  const codes = X.codes;
  test('T-N-08 annual data covering 11 months: engine (not a checker) yields QUALIFICATION_FAILED measurement.periodMonths', () => {
    const c = H.caseById('T-N-08'); const r = evaluate(c.envelope);
    assert.strictEqual(r.status, 'UNQUALIFIED_METHOD'); assert.deepStrictEqual(codes(r), ['QUALIFICATION_FAILED:measurement.periodMonths:input']);
    assert.strictEqual(r.problems[0].ruleRef, '220.87(1)'); assert.deepStrictEqual(r.demand.lines, []); assert.deepStrictEqual(r.existingCapacity.comparisons, []);
  });
  test('periodMonths 12 passes, 11 fails, null is unknown (INCOMPLETE): the annual threshold is executed', () => {
    const base = H.caseById('T-N-08').envelope;
    for (const [months, status] of [[12, 'COMPLETE'], [11, 'UNQUALIFIED_METHOD'], [null, 'INCOMPLETE_INPUT'], [36, 'COMPLETE']]) {
      const e = H.clone(base); e.snapshot.measurement.periodMonths = months;
      assert.strictEqual(evaluate(e).status, status, `periodMonths ${months}`);
    }
  });
  test('30-day route: periodDays 29/30, intervalMinutes 15/16/30, continuousRecording false/null', () => {
    const base = H.caseById('T-N-10a').envelope;
    const run = (patch) => { const e = H.clone(base); Object.assign(e.snapshot.measurement, patch); return evaluate(e); };
    assert.strictEqual(run({ periodDays: 30 }).status, 'COMPLETE');
    assert.strictEqual(run({ periodDays: 29 }).status, 'UNQUALIFIED_METHOD');
    assert.strictEqual(run({ periodDays: 30, intervalMinutes: 16 }).status, 'UNQUALIFIED_METHOD');
    assert.strictEqual(run({ periodDays: 30, intervalMinutes: 15 }).status, 'COMPLETE');
    assert.strictEqual(run({ periodDays: 30, intervalMinutes: null }).status, 'INCOMPLETE_INPUT');
    assert.strictEqual(run({ periodDays: 30, continuousRecording: X.decl(false, 'recording_report') }).status, 'UNQUALIFIED_METHOD');
    assert.strictEqual(run({ periodDays: 30, continuousRecording: X.decl(null, 'recording_report') }).status, 'INCOMPLETE_INPUT');
  });
  test('T-N-14 invalid association: single-conductor A reading + L-N term -> INCOMPLETE, ASSOCIATION_UNKNOWN (capacity) + MISSING_FIELD readingsPerConductor (input), no total', () => {
    const r = evaluate(H.caseById('T-N-14').envelope);
    assert.strictEqual(r.status, 'INCOMPLETE_INPUT');
    assert.deepStrictEqual(codes(r), ['ASSOCIATION_UNKNOWN:measurement.readingsPerConductor:capacity', 'MISSING_FIELD:measurement.readingsPerConductor:input']);
    assert.strictEqual(r.existingCapacity.blockingCode, 'ASSOCIATION_UNKNOWN'); assert.deepStrictEqual(r.demand.lines, []); assert.strictEqual(r.demand.totalOnConductorA, null);
  });
  test('T-N-17/17b/17c executed: unityPF true -> 155 A inadequate; {} -> INCOMPLETE; false -> UNSUPPORTED_SCOPE', () => {
    const a = evaluate(H.caseById('T-N-17').envelope); assert.strictEqual(a.status, 'COMPLETE'); assert.strictEqual(a.demand.totalOnConductorA, 155); assert.strictEqual(a.existingCapacity.status, 'inadequate');
    const b = evaluate(H.caseById('T-N-17b').envelope); assert.strictEqual(b.status, 'INCOMPLETE_INPUT'); assert.deepStrictEqual(codes(b), ['MODEL_DECLARATION_MISSING:loadModel.declarations.unityPF:current', 'QUALIFICATION_UNKNOWN:loadModel.declarations.unityPF:input']);
    const c = evaluate(H.caseById('T-N-17c').envelope); assert.strictEqual(c.status, 'UNSUPPORTED_SCOPE'); assert.deepStrictEqual(codes(c), ['CAPABILITY_DISABLED:loadModel.declarations.unityPF:input']); assert.deepStrictEqual(c.existingCapacity.comparisons, []);
  });
  test('LL / 3PH negatives on the amperes path (T-N-31, T-N-31b, T-N-32) are CAPABILITY_DISABLED at the connection, never a verdict', () => {
    for (const id of ['T-N-31', 'T-N-31b', 'T-N-32']) {
      const r = evaluate(H.caseById(id).envelope);
      assert.strictEqual(r.status, 'UNSUPPORTED_SCOPE', id); assert.deepStrictEqual(codes(r), ['CAPABILITY_DISABLED:measurement.newLoad.precalculated.connection:input'], id);
      assert.strictEqual(r.existingCapacity.status, 'not_assessed', id); assert.deepStrictEqual(r.demand.lines, [], id);
    }
  });
  test('purpose change moves the rating source and the attestation field: service -> feeder on T-N-01b', () => {
    const e = H.clone(H.caseById('T-N-01b').envelope); e.snapshot.purpose = 'feeder';
    const r = evaluate(e);
    assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); // feederOcpPer240_4 is null in that fixture
    assert.deepStrictEqual(codes(r), ['QUALIFICATION_UNKNOWN:measurement.existing.feederOcpPer240_4:input']);
    e.snapshot.measurement.existing.feederOcpPer240_4 = X.decl(true); e.snapshot.measurement.existing.feederAmpacityA = 225;
    const r2 = evaluate(e); assert.strictEqual(r2.status, 'COMPLETE'); assert.strictEqual(r2.existingCapacity.comparisons[0].ratingSource, 'feederAmpacityA');
  });
  test('rating change flips the verdict at the raw boundary and nothing else changes (T-N-01: 200 A -> 208.33.. A raw)', () => {
    const e = H.clone(H.caseById('T-N-01').envelope);
    const raw = evaluate(e).current.lineA;
    e.snapshot.measurement.existing.serviceRatingA = raw; assert.strictEqual(evaluate(e).existingCapacity.status, 'adequate', 'rating == raw is adequate (<=)');
    e.snapshot.measurement.existing.serviceRatingA = raw - 1e-12; assert.strictEqual(evaluate(e).existingCapacity.status, 'inadequate');
    e.snapshot.measurement.existing.serviceRatingA = 0; assert.strictEqual(evaluate(e).status, 'INVALID_INPUT');
  });
  test('unsupported profile / method / model / connection: retained data, explicit state, no old arithmetic', () => {
    const base = H.caseById('T-N-01b').envelope;
    for (const method of ['opt_220_82', 'existing_220_83', 'standard_part_III', 'multifamily_220_84']) {
      const e = H.clone(base); e.snapshot.method.selected = method; const r = evaluate(e);
      assert.strictEqual(r.status, 'UNSUPPORTED_SCOPE', method); assert.ok(codes(r).includes('CAPABILITY_DISABLED:method.selected:input'), method);
      assert.ok(codes(r).includes('RULE_PENDING:method.selected:input'), method); assert.deepStrictEqual(r.demand.lines, [], method); assert.strictEqual(r.demand.totalVA, null, method);
    }
    const m = H.clone(base); m.snapshot.measurement.newLoad = { mode: 'from_loads', precalculated: null }; m.snapshot.loads = [X.load('cook', 'range', 12000)];
    const rm = evaluate(m); assert.strictEqual(rm.status, 'UNSUPPORTED_SCOPE'); assert.deepStrictEqual(rm.loadsCoverage, [{ loadId: 'cook', coverage: 'unresolved', ruleRef: null, reason: 'CAPABILITY_DISABLED', viaAggregate: false }]);
    for (const kind of ['network_208_mixed', 'unsupported']) {
      const e = H.clone(base); e.snapshot.loadModel.kind = kind; const r = evaluate(e);
      assert.strictEqual(r.status, 'COMPLETE', kind); assert.strictEqual(r.current.status, 'not_computed', kind); assert.strictEqual(r.existingCapacity.blockingCode, 'MODEL_UNSUPPORTED', kind);
    }
    const c = H.clone(base); c.snapshot.measurement.newLoad = X.term(3600, '3PH', null); const rc = evaluate(c);
    assert.strictEqual(rc.status, 'INVALID_INPUT'); assert.deepStrictEqual(codes(rc), ['CONNECTION_INVALID:measurement.newLoad.precalculated.connection:input']);
  });
  test('parseErrors block demand computation and are re-emitted once with source parser; a semantic MISSING_FIELD is not duplicated', () => {
    const e = H.clone(H.caseById('T-S-41a').envelope);
    const r = evaluate(e);
    assert.strictEqual(r.problems.length, 1); assert.strictEqual(r.problems[0].source, 'parser'); assert.strictEqual(r.status, 'INCOMPLETE_INPUT');
    const e2 = H.clone(H.caseById('T-N-01b').envelope); e2.parseErrors = [{ field: 'dwelling.floorAreaFt2', raw: 'x', code: 'NOT_FINITE' }];
    const r2 = evaluate(e2); assert.strictEqual(r2.status, 'INVALID_INPUT'); assert.deepStrictEqual(r2.demand.lines, []); assert.strictEqual(r2.existingCapacity.status, 'not_assessed');
    const e3 = H.clone(H.caseById('T-N-01b').envelope); e3.parseErrors = [{ field: 'measurement.reading.value', raw: '', code: 'MISSING_FIELD' }];
    const r3 = evaluate(e3); assert.strictEqual(r3.problems.filter((p) => p.field === 'measurement.reading.value').length, 1, 'no duplicate for the same field');
  });
  test('stale aggregate after quantity / type / connection / rating / status edits, fresh after label / legacy edits (T-S-40 replay on the engine)', () => {
    const c = H.caseById('T-S-40');
    const expectStale = ['quantity', 'continuous', 'connection', 'category', 'rating', 'status'];
    c.then.forEach((t, i) => {
      const r = evaluate(t.envelope);
      if (i < 6) { assert.strictEqual(r.status, 'PARTIAL', t.step); assert.ok(codes(r).includes('AGGREGATE_STALE:measurement.newLoad.precalculated.coversSnapshot:demand'), t.step); assert.ok(expectStale.some((k) => t.step.includes(k))); }
      else { assert.strictEqual(r.status, 'COMPLETE', t.step); assert.ok(!codes(r).includes('AGGREGATE_STALE:measurement.newLoad.precalculated.coversSnapshot:demand'), t.step); }
    });
  });
  test('no qualifying basis: precalculated term with establishedForThisComparison null/false -> demand complete, NEWLOAD_BASIS_UNQUALIFIED, no verdict (T-S-29 + false variant)', () => {
    const r = evaluate(H.caseById('T-S-29').envelope); assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.existingCapacity.blockingCode, 'NEWLOAD_BASIS_UNQUALIFIED');
    const e = H.clone(H.caseById('T-N-13').envelope); e.snapshot.measurement.newLoad.precalculated.basis.establishedForThisComparison = false;
    const r2 = evaluate(e); assert.strictEqual(r2.status, 'COMPLETE'); assert.strictEqual(r2.existingCapacity.status, 'not_assessed'); assert.strictEqual(r2.existingCapacity.blockingCode, 'NEWLOAD_BASIS_UNQUALIFIED'); assert.strictEqual(r2.demand.totalVA, 55000);
  });
  test('incomplete per-conductor map with an L-N term on the blank leg: the missing required conductor is reported, no verdict (B1-r1 rule: completeness by topology, not by present keys)', () => {
    const e = H.clone(H.caseById('T-N-15').envelope); e.snapshot.measurement.readingsPerConductor = { L1: 100, L2: null, L3: null }; // term stays on L2
    const r = evaluate(e); assert.strictEqual(r.status, 'INCOMPLETE_INPUT');
    assert.deepStrictEqual(codes(r), ['MISSING_FIELD:measurement.readingsPerConductor.L2:input']);
    assert.deepStrictEqual(r.demand.lines, []); assert.strictEqual(r.existingCapacity.status, 'not_assessed');
  });
  test('non-finite / overflow protection: 8e307 VA x 1.25 + a 1e308 VA term overflows the sum -> OUT_OF_RANGE, no verdict, no non-finite output', () => {
    const e = H.clone(H.caseById('T-N-13').envelope); e.snapshot.measurement.reading.value = 8e307; e.snapshot.measurement.newLoad.precalculated.va = 1e308;
    const r = evaluate(e); assert.strictEqual(r.status, 'INVALID_INPUT'); assert.deepStrictEqual(r.existingCapacity.comparisons, []); assert.deepStrictEqual(r.demand.lines, []);
    const walk = (x) => { if (typeof x === 'number') assert.ok(Number.isFinite(x)); else if (x && typeof x === 'object') Object.values(x).forEach(walk); }; walk(r);
  });
});

describe('ENGINE-GEN — hand-written generalization cases (not used to design the implementation)', () => {
  for (const c of X.CASES) test(`${c.id} — ${c.title}`, () => c.check(evaluate(c.envelope()), evaluate));
});

describe('ENGINE-DET — determinism, frozen inputs, aliasing, options', () => {
  test('identical envelope evaluated repeatedly gives byte-identical JSON (T-S-30 and every r22 pair)', () => {
    for (const p of PAIRS) {
      const a = JSON.stringify(evaluate(p.envelope, opts(p))); const b = JSON.stringify(evaluate(p.envelope, opts(p)));
      assert.strictEqual(a, b, p.id);
    }
  });
  test('deep-frozen inputs are not mutated and the result aliases no input object', () => {
    for (const p of PAIRS) {
      const env = H.deepFreeze(H.clone(p.envelope)); const before = JSON.stringify(env);
      const r = evaluate(env, opts(p));
      assert.strictEqual(JSON.stringify(env), before, p.id);
      const seen = new Set(); const walk = (x) => { if (x && typeof x === 'object') { seen.add(x); Object.values(x).forEach(walk); } }; walk(env);
      const check = (x) => { if (x && typeof x === 'object') { assert.ok(!seen.has(x), `${p.id}: result shares an object with the input`); Object.values(x).forEach(check); } }; check(r);
    }
  });
  test('mutating a returned result does not change a later result for the same input', () => {
    const p = PAIRS.find((x) => x.id === 'T-N-13'); const r = evaluate(p.envelope);
    r.demand.lines[0].result.value = -1; r.problems.push({ code: 'X' }); r.existingCapacity.comparisons.length = 0;
    assert.deepStrictEqual(evaluate(p.envelope), p.expected);
  });
  test('options: display precision changes strings only; verdict, raw values and status are invariant (T-N-27..29 pattern on every COMPLETE pair)', () => {
    for (const p of PAIRS) {
      const base = evaluate(p.envelope, opts(p));
      for (const amps of [0, 1, 2, 3]) {
        const r = evaluate(p.envelope, { displayPrecision: { amps, va: 0 } });
        assert.strictEqual(r.status, base.status, p.id); assert.deepStrictEqual(r.existingCapacity, base.existingCapacity, p.id); assert.deepStrictEqual(r.demand, base.demand, p.id);
        assert.strictEqual(r.display.feedsComparison, false);
      }
    }
    assert.throws(() => evaluate(PAIRS[0].envelope, { displayPrecision: { amps: -1, va: 0 } }), TypeError);
    assert.throws(() => evaluate(PAIRS[0].envelope, { displayPrecision: { amps: 1.5, va: 0 } }), TypeError);
    assert.throws(() => evaluate(PAIRS[0].envelope, { displayPrecision: { amps: 9, va: 0 } }), TypeError);
  });
  test('profile constants are engine-owned and frozen; user fields cannot enable A+, B, screening, auto-rating', () => {
    assert.strictEqual(PROFILE.id, 'A_measured_87_core'); assert.ok(Object.isFrozen(PROFILE)); assert.strictEqual(PROFILE.upperBoundScreening, false); assert.strictEqual(PROFILE.autoRating, false); assert.strictEqual(PROFILE.autoHandoff, false);
    assert.throws(() => evaluate({ ...PAIRS[0].envelope, profileId: 'A_plus' }), LoadCalcEnvelopeError);
    for (const p of PAIRS) { const r = evaluate(p.envelope, opts(p)); assert.strictEqual(r.rating.status, 'not_assessed'); assert.strictEqual(r.requiredCapacity.status, 'not_assessed'); assert.strictEqual(r.current.neutralA, null); assert.strictEqual(r.diagnostics.operative, false); assert.ok(!('handoff' in r)); }
  });
});

describe('ENGINE-DET — bounded seeded property checks (mathematics of the declared order, not new NEC evidence)', () => {
  const rnd = H.prng(20260910);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const round2 = (x) => Math.round(x * 100) / 100;
  test('200 random VA-path envelopes: exact declared-order arithmetic, raw <= verdict, finiteness, sorted problems, determinism', () => {
    for (let n = 0; n < 200; n++) {
      const topo = pick(['1ph_3w_120_240', '1ph_3w_120_208_network', '3ph_4w_208Y_120', '3ph_4w_480Y_277', '3ph_3w_480_delta']);
      const model = topo === '1ph_3w_120_240' ? pick(['split_240_all_LL', 'split_240_balanced_LN']) : topo === '1ph_3w_120_208_network' ? pick(['network_208_all_LL', 'network_208_balanced_LN']) : 'three_phase_balanced';
      const decls = model === 'three_phase_balanced' ? { balanced3ph: X.decl(true) } : model.endsWith('balanced_LN') ? { balancedLN: X.decl(true) } : {};
      const unit = pick(['VA', 'kVA', 'kW']); const value = unit === 'VA' ? round2(1000 + rnd() * 200000) : round2(1 + rnd() * 200);
      const pf = unit === 'kW' ? round2(0.7 + rnd() * 0.3) : null;
      const rating = round2(50 + rnd() * 600);
      const withTerm = rnd() < 0.5; const va = withTerm ? round2(rnd() * 20000) : null;
      const conn = model === 'three_phase_balanced' ? '3PH' : model.endsWith('balanced_LN') ? 'LN' : 'LL';
      const meas = X.annual(value, unit, { powerFactor: pf, existing: { serviceRatingA: rating, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: X.decl(null), serviceOverloadPer230_90: X.decl(true) }, newLoad: withTerm ? X.term(va, conn, conn === 'LN' ? 'L1' : null) : { mode: 'none', precalculated: null } });
      const env = H.deepFreeze(X.env(X.snap({ supply: X.supply(topo), loadModel: { kind: model, declarations: decls }, measurement: meas })));
      const r = evaluate(env);
      assert.strictEqual(r.status, 'COMPLETE');
      const norm = unit === 'VA' ? value : unit === 'kVA' ? value * 1000.0 : (value * 1000.0) / pf;
      const comp = norm * 1.25; const total = withTerm ? comp + va : comp;
      assert.strictEqual(r.demand.totalVA, total);
      const vll = X.supply(topo).vLineToLine; const vln = X.supply(topo).vLineToNeutral;
      const exp = model === 'three_phase_balanced' ? total / (SQRT3 * vll) : model === 'network_208_balanced_LN' ? (total / 2) / vln : total / vll;
      assert.strictEqual(r.current.lineA, exp);
      assert.strictEqual(r.existingCapacity.status, exp <= rating ? 'adequate' : 'inadequate');
      assert.strictEqual(r.existingCapacity.comparisons[0].demandValueRaw, exp);
      assert.strictEqual(JSON.stringify(evaluate(env)), JSON.stringify(r));
      const keys = r.problems.map((p) => p.code + '\u0000' + p.field); assert.deepStrictEqual(keys, keys.slice().sort());
      const walk = (x) => { if (typeof x === 'number') assert.ok(Number.isFinite(x)); else if (x && typeof x === 'object') Object.values(x).forEach(walk); }; walk(r);
      assert.strictEqual(r.display.strings.lineA, `${formatNumber(exp, 1)} A`);
    }
  });
  test('120 random amperes-path envelopes (split-phase per-conductor + LN/LL term): terminals, governing maximum, complete comparison set', () => {
    for (let n = 0; n < 120; n++) {
      const l1 = round2(10 + rnd() * 190); const l2 = round2(10 + rnd() * 190); const rating = round2(100 + rnd() * 200);
      const conn = pick(['LN', 'LL', 'none']); const va = round2(rnd() * 12000); const leg = pick(['L1', 'L2']);
      const meas = X.thirtyDayA(Math.max(l1, l2), { readingsPerConductor: { L1: l1, L2: l2, L3: null }, readingScope: 'per_conductor', connectedTo: 'each_conductor', existing: { serviceRatingA: rating, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: X.decl(null), serviceOverloadPer230_90: X.decl(true) }, newLoad: conn === 'none' ? { mode: 'none', precalculated: null } : X.term(va, conn, conn === 'LN' ? leg : null) });
      const env = H.deepFreeze(X.env(X.snap({ loadModel: { kind: 'split_240_declared_legs', declarations: { unityPF: X.decl(true) } }, measurement: meas })));
      const r = evaluate(env);
      assert.strictEqual(r.status, 'COMPLETE');
      const t = { L1: l1 * 1.25, L2: l2 * 1.25 };
      if (conn === 'LN') t[leg] = t[leg] + va / 120; else if (conn === 'LL') { t.L1 = t.L1 + va / 240; t.L2 = t.L2 + va / 240; }
      assert.strictEqual(r.demand.totalOnConductorA, Math.max(t.L1, t.L2));
      assert.deepStrictEqual(r.existingCapacity.comparisons.map((c) => [c.conductor, c.demandValueRaw, c.satisfied]), [['L1', t.L1, t.L1 <= rating], ['L2', t.L2, t.L2 <= rating]]);
      assert.strictEqual(r.existingCapacity.status, t.L1 <= rating && t.L2 <= rating ? 'adequate' : 'inadequate');
      assert.strictEqual(r.demand.lines[r.demand.lines.length - 1].id, 'governing');
    }
  });
  test('display formatting: half away from zero on the shortest decimal representation, grouped thousands (T-A-30 literals + edge values)', () => {
    assert.strictEqual(formatNumber(200.04, 0), '200'); assert.strictEqual(formatNumber(200.04, 1), '200.0'); assert.strictEqual(formatNumber(200.04, 2), '200.04'); assert.strictEqual(formatNumber(200.04, 3), '200.040');
    assert.strictEqual(formatNumber(208.33333333333334, 1), '208.3'); assert.strictEqual(formatNumber(150.0125, 2), '150.01'); assert.strictEqual(formatNumber(150.0125, 3), '150.013');
    assert.strictEqual(formatNumber(50000, 0), '50,000'); assert.strictEqual(formatNumber(1234567.5, 0), '1,234,568'); assert.strictEqual(formatNumber(0.5, 0), '1'); assert.strictEqual(formatNumber(2.5, 0), '3'); assert.strictEqual(formatNumber(999.95, 1), '1,000.0');
    assert.strictEqual(formatNumber(1e21, 0), '1,000,000,000,000,000,000,000'); assert.strictEqual(formatNumber(1e-7, 3), '0.000');
    assert.strictEqual(fmtG(3600), '3600'); assert.strictEqual(fmtG(120), '120'); assert.strictEqual(fmtG(12345.678), '12345.7'); assert.strictEqual(fmtG(1e6), '1e+06'); assert.strictEqual(fmtG(0.00001234), '1.234e-05');
  });
});

describe('L2 — structural boundary stops the engine before any arithmetic', () => {
  test('T-S-33 CONTRADICTORY_SUPPLY snapshot: evaluate throws LoadCalcEnvelopeError (engineCalled false), no result object exists', () => {
    const c = H.caseById('T-S-33');
    const env = { snapshot: c.invalidSnapshot, parseErrors: [], profileId: 'A_measured_87_core' };
    let result = null; let error = null;
    try { result = evaluate(env); } catch (e) { error = e; }
    assert.strictEqual(result, null); assert.ok(error instanceof LoadCalcEnvelopeError); assert.strictEqual(error.code, 'SCHEMA_INVALID');
    assert.ok(error.errors.some((m) => m.includes('CONTRADICTORY_SUPPLY')));
  });
  test('unknown keys, wrong types and non-object envelopes are rejected at the boundary, never turned into a success-shaped result', () => {
    const base = H.caseById('T-N-01b').envelope;
    assert.throws(() => evaluate(Object.assign(H.clone(base), { extra: 1 })), LoadCalcEnvelopeError);
    const s = H.clone(base); s.snapshot.measurement.reading.value = '40000'; assert.throws(() => evaluate(s), LoadCalcEnvelopeError);
    const q = H.clone(base); q.snapshot.loads = [Object.assign(X.load('a', 'evse', 7200), { quantity: 1.5 })]; assert.throws(() => evaluate(q), LoadCalcEnvelopeError);
    for (const bad of [null, undefined, 42, 'x', [], {}]) assert.throws(() => evaluate(bad), LoadCalcEnvelopeError);
  });
});

describe('ENGINE — the four reviewer bad-graph pairs are not what the engine produces', () => {
  const targeted = require(path.join(H.FIXTURE_DIR, 'targeted-closure-pairs.json'));
  const byId = (id) => targeted.find((t) => t.id === id);
  test('AMP_ORPHAN_NEW_TERM (base T-N-16): engine attaches n_L1 to t_L1 exactly once', () => {
    const r = evaluate(byId('AMP_ORPHAN_NEW_TERM').envelope); const t = r.demand.lines.find((l) => l.id === 't_L1');
    assert.deepStrictEqual(t.operands.map((o) => o.ref), ['e_L1', 'n_L1']); assert.notDeepStrictEqual(r, byId('AMP_ORPHAN_NEW_TERM').result);
  });
  test('AMP_WRONG_GOVERNING_AND_MISSING_COMPARISON (base T-N-16): engine selects the maximum terminal and compares every conductor', () => {
    const r = evaluate(byId('AMP_WRONG_GOVERNING_AND_MISSING_COMPARISON').envelope);
    assert.strictEqual(r.demand.lines[r.demand.lines.length - 1].operands[0].ref, 't_L1'); assert.strictEqual(r.existingCapacity.comparisons.length, 2); assert.notDeepStrictEqual(r, byId('AMP_WRONG_GOVERNING_AND_MISSING_COMPARISON').result);
  });
  test('AMP_TERM_ASSOCIATION_NOT_CONNECTED_TO_TOTAL (base T-N-16 variant): the L-N term feeds its declared leg only', () => {
    const p = byId('AMP_TERM_ASSOCIATION_NOT_CONNECTED_TO_TOTAL'); const r = evaluate(p.envelope);
    const leg = p.envelope.snapshot.measurement.newLoad.precalculated.leg;
    assert.ok(r.demand.lines.some((l) => l.id === `n_${leg}`)); assert.ok(r.demand.lines.some((l) => l.id === `t_${leg}`)); assert.notDeepStrictEqual(r, p.result);
  });
  test('VA_NEW_TERM_COUNTED_TWICE (base T-N-13): total = sum[existing125, newTerm] with multiplicity one', () => {
    const r = evaluate(byId('VA_NEW_TERM_COUNTED_TWICE').envelope); const t = r.demand.lines.find((l) => l.id === 'total');
    assert.deepStrictEqual(t.operands.map((o) => o.ref), ['existing125', 'newTerm']); assert.strictEqual(t.result.value, 55000); assert.notDeepStrictEqual(r, byId('VA_NEW_TERM_COUNTED_TWICE').result);
  });
  test('positive controls (T-N-16, T-N-13, T-N-30) reproduce the reviewer control results exactly; CONTROL_T-N-17 (no declaration) is not produced', () => {
    for (const id of ['CONTROL_T-N-16', 'CONTROL_T-N-13', 'CONTROL_T-N-30']) assert.deepStrictEqual(evaluate(byId(id).envelope), byId(id).result, id);
    const c17 = byId('CONTROL_T-N-17'); const r = evaluate(c17.envelope); assert.strictEqual(r.status, 'INCOMPLETE_INPUT'); assert.notDeepStrictEqual(r, c17.result);
  });
});
