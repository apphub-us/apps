'use strict';
/**
 * LC-22082-B0-CORE-1 — engine B82_core1 / V2 input tests (isolated delivery).
 * Expectations come from test/fixtures/loadCalc/LC82-cases-r1.json (hand-derived from the settled
 * contract), never from recorded engine output. The independent Python checker is executed as a
 * child process; if python3 is unavailable that check is reported as blocked, not passed.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const V2 = require('../src/calc/loadCalcInputV2.js');
const B82 = require('../src/calc/loadCalcOpt82.js');
const F = require('../src/calc/loadCalcFacade.js');
const A = require('../src/calc/loadCalc.js');   // read-only: direct-A comparison for the guide-path delegation witnesses

const ROOT = path.join(__dirname, '..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'), 'utf8'));
const CASES = FIXTURE.cases;
const clone = (v) => JSON.parse(JSON.stringify(v));
const byId = (id) => { const c = CASES.find((x) => x.id === id); if (!c) throw new Error('fixture missing ' + id); return c; };
const evaluatorFor = (c) => (c.assumptions.engineRuleStatus === 'default' ? B82.evaluate82 : B82.TEST_ONLY.createPendingSourceEvaluator(c.assumptions.engineRuleStatus));
const keyP = (p) => [p.code, p.field, p.layer, p.source].join('|');
const keyC = (c) => [c.loadId, c.coverage, c.reason].join('|');
const PY_ENV = Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' });   // never leave __pycache__ in the fixture tree
const pythonAvailable = spawnSync('python3', ['-c', 'import json'], { encoding: 'utf8', env: PY_ENV }).status === 0;

describe('LC82 fixtures — every case evaluates exactly as hand-derived', () => {
  for (const c of CASES) {
    test(`${c.id} (${c.kind})`, () => {
      const before = JSON.stringify(c.request);
      if (c.kind === 'L2') {
        assert.throws(() => F.evaluateV2(c.request), (e) => e.name === 'LoadCalcEnvelopeError' && e.code === 'SCHEMA_INVALID' && Array.isArray(e.errors) && e.errors.length > 0);
        const envErrs = V2.validateEnvelope82(V2.toEnvelope82(c.request));
        if (envErrs.length) assert.throws(() => B82.evaluate82(V2.toEnvelope82(c.request)), (e) => e.name === 'LoadCalcEnvelopeError');   // snapshot/context/parse-error defects also stop the engine directly
        else assert.ok(V2.validateRequestV2(c.request).some((m) => /apiVersion|profileId/.test(m)), 'request-level identity defect');
        assert.strictEqual(JSON.stringify(c.request), before, 'request not mutated by a rejected call');
        return;
      }
      const r = evaluatorFor(c)(V2.toEnvelope82(c.request));
      assert.strictEqual(JSON.stringify(c.request), before, 'request not mutated');
      const e = c.expected;
      assert.strictEqual(r.status, e.status, 'status');
      assert.deepStrictEqual(r.problems.map(keyP).sort(), e.problems.map(keyP).sort(), 'problems');
      assert.deepStrictEqual(r.loadsCoverage.map(keyC), e.coverage.map(keyC).sort(), 'coverage');
      assert.strictEqual(r.demand.status, e.demand.status); assert.strictEqual(r.demand.totalVA, e.demand.totalVA); assert.strictEqual(r.demand.totalExactE4, e.demand.totalExactE4); assert.strictEqual(r.demand.partialSubtotalVA, e.demand.partialSubtotalVA);
      assert.deepStrictEqual(r.demand.lines.map((l) => l.id), e.demand.lineIds, 'line ids');
      assert.strictEqual(r.current.status, e.current.status); assert.strictEqual(r.current.lineA, e.current.lineA);
      assert.strictEqual(r.existingCapacity.blockingCode, e.capacityBlockingCode);
      // always inactive layers
      assert.strictEqual(r.existingCapacity.status, 'not_assessed'); assert.deepStrictEqual(r.existingCapacity.comparisons, []); assert.strictEqual(r.rating.status, 'not_assessed'); assert.strictEqual(r.requiredCapacity.status, 'not_assessed'); assert.strictEqual(r.current.neutralA, null); assert.strictEqual(r.diagnostics.operative, false);
      assert.strictEqual(r.schemaVersion, '3.3.0'); assert.strictEqual(r.profileId, 'B82_core1');
      // problems sorted (code, field); every input load represented exactly once
      const order = r.problems.map((p) => p.code + '|' + p.field); assert.deepStrictEqual(order, order.slice().sort());
      assert.deepStrictEqual(r.loadsCoverage.map((x) => x.loadId).sort(), c.request.snapshot.loads.map((l) => l.id).sort());
      if (r.status !== 'COMPLETE' && r.status !== 'PARTIAL') { assert.deepStrictEqual(r.demand.lines, []); assert.strictEqual(r.demand.totalVA, null); assert.strictEqual(r.current.status, 'not_computed'); assert.ok(r.loadsCoverage.every((x) => x.coverage === 'unresolved')); }
      if (r.status === 'PARTIAL') { assert.strictEqual(r.demand.totalVA, null); assert.ok(!r.demand.lines.some((l) => ['ac_connected', 'c1_ac', 'hvac_governing', 'total'].includes(l.id)), 'no HVAC lines / total in PARTIAL'); }
      if (r.status === 'COMPLETE') { assert.strictEqual(r.demand.lines[r.demand.lines.length - 1].id, 'total'); assert.strictEqual(r.demand.totalExactE4, r.demand.lines[r.demand.lines.length - 1].result.exactE4); assert.ok(r.loadsCoverage.every((x) => x.coverage === 'counted')); }
    });
  }
});

describe('B0-P and the facade route', () => {
  test('B0-P through evaluateV2: COMPLETE 23,680 VA (exactE4 236800000), model-gated current 98.66666666666667 A, twelve lines, facade metadata only', () => {
    const c = byId('LC82-B0P'); const before = JSON.stringify(c.request); const { facade, result } = F.evaluateV2(c.request);
    assert.strictEqual(JSON.stringify(c.request), before);
    assert.deepStrictEqual([result.status, result.demand.totalVA, result.demand.totalExactE4, result.current.lineA], ['COMPLETE', 23680, 236800000, 23680 / 240]);
    assert.deepStrictEqual(result.demand.lines.map((l) => l.id), ['b1_area', 'b2_circuits', 'b3_appliances', 'gen_connected', 'gen_tier1', 'gen_excess', 'gen_tier2', 'gen_demand', 'ac_connected', 'c1_ac', 'hvac_governing', 'total']);
    assert.deepStrictEqual(result.demand.lines.map((l) => l.result.exactE4), [45000000, 45000000, 227000000, 317000000, 100000000, 217000000, 86800000, 186800000, 50000000, 50000000, 50000000, 236800000]);
    assert.deepStrictEqual(result.display.strings, { totalVA: '23,680 VA', generalDemandVA: '18,680 VA', lineA: '98.7 A' });
    assert.deepStrictEqual(facade, { apiVersion: 2, capabilityProfile: 'AB82_core1', engine: 'B82', engineProfileId: 'B82_core1', engineRuleStatus: Object.assign({}, B82.PROFILE_82.ruleStatus), importGuard: 'not_applicable' });
    assert.ok(Object.isFrozen(B82.PROFILE_82) && Object.isFrozen(B82.PROFILE_82.ruleStatus) && Object.isFrozen(B82.PROFILE_82.enabledArrangements));
    assert.deepStrictEqual(B82.PROFILE_82.enabledArrangements, ['ac_only']);
  });
  test('c1_ac consumes the aggregation node; the gen_connected subtotal has exactly two consumers; every load bound exactly once with kind va; b1/b2 bound with kind area/count', () => {
    const r = B82.evaluate82(V2.toEnvelope82(byId('LC82-B0P').request)); const lines = r.demand.lines; const consumers = {};
    for (const l of lines) { consumers[l.id] = consumers[l.id] || 0; for (const o of l.operands) if (o.ref) consumers[o.ref] = (consumers[o.ref] || 0) + 1; }
    assert.strictEqual(consumers.gen_connected, 2); assert.strictEqual(consumers.total, 0); assert.ok(Object.entries(consumers).every(([k, n]) => k === 'gen_connected' ? n === 2 : k === 'total' ? n === 0 : n === 1));
    const c1 = lines.find((l) => l.id === 'c1_ac'); assert.deepStrictEqual(c1.operands.map((o) => o.ref), ['ac_connected']); assert.deepStrictEqual(c1.bindings, []);
    const bound = {}; for (const l of lines) for (const b of l.bindings) { assert.ok(['va', 'area', 'count'].includes(b.kind)); if (b.loadId) bound[b.loadId] = (bound[b.loadId] || 0) + 1; }
    assert.deepStrictEqual(bound, { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1 });
    assert.deepStrictEqual(lines[0].bindings.map((b) => b.kind), ['area']); assert.deepStrictEqual(lines[1].bindings.map((b) => [b.kind, b.path]), [['count', 'dwelling.smallApplianceCircuits'], ['count', 'dwelling.laundryCircuits']]);
  });
  test('the EVSE + AC clarification: two LOAD_UNRESOLVED problems, withheld AC visible with its connected value, subtotal of resolved general loads only', () => {
    const r = B82.evaluate82(V2.toEnvelope82(byId('LC82-09a-evse-plus-ac').request));
    assert.deepStrictEqual(r.problems.map((p) => p.code + '@' + p.field), ['LOAD_UNRESOLVED@loads[4]', 'LOAD_UNRESOLVED@loads[5]']);
    const l5 = r.loadsCoverage.find((c) => c.loadId === 'L5'); const l9 = r.loadsCoverage.find((c) => c.loadId === 'L9');
    assert.deepStrictEqual([l5.coverage, l5.reason, l5.connectedVA, l5.demandVA, l5.candidate], ['unresolved', 'HVAC_WITHHELD_PARTIAL', 5000, null, null]);
    assert.deepStrictEqual([l9.coverage, l9.reason, l9.connectedVA], ['unresolved', 'CATEGORY_UNSUPPORTED_IN_METHOD', 7200]);
    assert.strictEqual(r.demand.partialSubtotalVA, 18680); assert.strictEqual(r.demand.totalVA, null); assert.strictEqual(r.current.status, 'not_computed');
    assert.ok(!r.demand.lines.some((l) => l.bindings.some((b) => b.loadId === 'L5' || b.loadId === 'L9')), 'no HVAC/unsupported bindings');
  });
  test('M4: the TEST-ONLY facility is non-escalating — it can only make 220.82/S-11a pending, never promote I-82-1…5, and is unreachable from a request', () => {
    assert.throws(() => B82.TEST_ONLY.createPendingSourceEvaluator({ 'I-82-1': 'verified' }), /may only make 220.82\/S-11a pending/);
    assert.throws(() => B82.TEST_ONLY.createPendingSourceEvaluator({ 'I-82-5': 'pending' }), /may only make/);
    assert.throws(() => B82.TEST_ONLY.createPendingSourceEvaluator({ '220.82': 'verified' }), /never an escalation/);
    assert.throws(() => B82.TEST_ONLY.createPendingSourceEvaluator({ bogus: 'pending' }), /may only make/);
    assert.strictEqual(B82.TEST_ONLY.createEvaluatorWithRuleStatus, undefined, 'the R0 escalating helper no longer exists');
    const req = clone(byId('LC82-B0P').request); req.ruleStatus = { 'I-82-1': 'verified' }; assert.throws(() => F.evaluateV2(req), (e) => e.name === 'LoadCalcEnvelopeError');
    const nyc = clone(byId('LC82-B0P').request); nyc.snapshot.dwelling.nycAcCircuitCount = 3;
    for (const ev of [B82.evaluate82, B82.TEST_ONLY.createPendingSourceEvaluator({}), B82.TEST_ONLY.createPendingSourceEvaluator({ 'S-11a': 'pending' })]) { const r = ev(V2.toEnvelope82(nyc)); assert.strictEqual(r.status, 'BLOCKED_PENDING_RULE'); assert.ok(r.problems.some((p) => p.code === 'RULE_PENDING' && p.field === 'dwelling.nycAcCircuitCount')); }
    const r = B82.TEST_ONLY.createPendingSourceEvaluator({ '220.82': 'pending' })(V2.toEnvelope82(byId('LC82-B0P').request)); assert.strictEqual(r.status, 'BLOCKED_PENDING_RULE');
    assert.deepStrictEqual(B82.PROFILE_82.ruleStatus, { '220.82': 'verified', 'S-11a': 'verified', 'I-82-1': 'pending', 'I-82-2': 'pending', 'I-82-3': 'pending', 'I-82-4': 'pending', 'I-82-5': 'pending' });
  });
});

describe('E4 encoding policy (R2-CLOSE-1 §2, R2-CLOSE-2 §2.1)', () => {
  test('shortest-decimal encoding: witnesses; never naive scaling; canonical projection', () => {
    const w = (x) => { const e = V2.encodeE4(x); return e.ok ? e.e4 : e.code; };
    assert.deepStrictEqual([w(0.07), w(0.29), w(1.15), w(0.001), w(0.30000000000000004), w(0.1 + 0.2), w(0), w(-0), w(-0.5), w(1000000), w(999999.99), w(1000000.01), w(1e21), w(2500.35), w(12000)],
      [700, 2900, 11500, 'RESOLUTION_EXCEEDED', 'RESOLUTION_EXCEEDED', 'RESOLUTION_EXCEEDED', 0, 0, 'OUT_OF_RANGE', 10000000000, 9999999900, 'OUT_OF_RANGE', 'OUT_OF_RANGE', 25003500, 120000000]);
    assert.notStrictEqual(0.07 * 10000, 700); assert.strictEqual(V2.projectE4(700 * 3), 0.21); assert.notStrictEqual(0.07 * 3, 0.21);
    assert.deepStrictEqual([V2.canonicalDecimal(2100), V2.canonicalDecimal(100004000), V2.canonicalDecimal(65001300), V2.canonicalDecimal(0), V2.canonicalDecimal(200033000000100)], ['0.21', '10000.4', '6500.13', '0', '20003300000.01']);
    assert.deepStrictEqual([V2.displayVA(100004000), V2.displayVA(100005000), V2.displayVA(236800000)], ['10,000 VA', '10,001 VA', '23,680 VA']);
  });
  test('fractional input through the 40 % path is exact (LC82-02d): 10000.35 general → 10000.14 demand', () => {
    const r = B82.evaluate82(V2.toEnvelope82(byId('LC82-02d-fractional-40pct').request)); const by = Object.fromEntries(r.demand.lines.map((l) => [l.id, l.result]));
    assert.deepStrictEqual([by.gen_connected.exactE4, by.gen_excess.exactE4, by.gen_tier2.exactE4, by.gen_demand.exactE4, by.total.exactE4], [100003500, 3500, 1400, 100001400, 150001400]);
    assert.deepStrictEqual([by.gen_demand.value, by.total.value, r.display.strings.totalVA], [10000.14, 15000.14, '15,000 VA']);
  });
});

describe('R1 regressions — behaviour classes behind the reviewer witnesses (M1/M2), not only their literal numbers', () => {
  const b0 = () => clone(byId('LC82-B0P').request);
  const refresh = (r) => { r.snapshot.optional82.inventoryComplete.basis = { members: r.snapshot.loads.map((l) => ({ id: l.id, basisId: l.basisId, category: l.category, quantity: l.quantity })).sort((a, b) => (a.id < b.id ? -1 : 1)) }; };
  const run = (r) => B82.evaluate82(V2.toEnvelope82(r));
  test('M1a: under a known ac_only arrangement, removing the ac record (any inventory size, any rating) is HVAC_ARRANGEMENT_INCONSISTENT with cleared layers — never an implicit none, never a zero A/C', () => {
    for (const keep of [[], ['L1'], ['L1', 'L2', 'L3', 'L4'], ['L2', 'L4']]) {
      const r = b0(); r.snapshot.loads = r.snapshot.loads.filter((l) => keep.includes(l.id)); refresh(r); const out = run(r);
      assert.strictEqual(out.status, 'INVALID_INPUT', keep.join(','));
      assert.deepStrictEqual(out.problems.map((p) => p.code + '@' + p.field), ['HVAC_ARRANGEMENT_INCONSISTENT@hvac.arrangement']);
      assert.deepStrictEqual(out.demand.lines, []); assert.strictEqual(out.demand.totalVA, null); assert.strictEqual(out.current.status, 'not_computed');
      assert.ok(out.loadsCoverage.every((c) => c.coverage === 'unresolved' && c.reason === 'HVAC_ARRANGEMENT_INCONSISTENT'));
    }
    const w = b0(); w.snapshot.loads[4].rating.value = 1; w.snapshot.loads[4].ratingCoverage82.basis.rating.value = 1; assert.strictEqual(run(w).status, 'COMPLETE', 'an ac record with any admissible rating keeps the positive path');
    const n = b0(); n.snapshot.hvac.arrangement = null; n.snapshot.loads.pop(); refresh(n); const on = run(n);
    assert.strictEqual(on.status, 'INCOMPLETE_INPUT'); assert.ok(!on.problems.some((p) => p.code === 'HVAC_ARRANGEMENT_INCONSISTENT'), 'null arrangement is MISSING_FIELD, not an inconsistency');
    const pe = b0(); pe.snapshot.hvac.arrangement = null; pe.parseErrors = [{ field: 'hvac.arrangement', raw: 'x', code: 'UNKNOWN_ENUM' }]; pe.snapshot.loads.pop(); refresh(pe); const ope = run(pe);
    assert.deepStrictEqual(ope.problems.map((p) => p.code), ['UNKNOWN_ENUM'], 'a parser-blocked arrangement neither gates capability nor triggers the inconsistency');
    const multi = b0(); multi.snapshot.loads[4].quantity = 2; multi.snapshot.loads[4].ratingCoverage82.basis.quantity = 2; refresh(multi); assert.ok(run(multi).problems.some((p) => p.code === 'RULE_PENDING' && p.field === 'hvac.arrangement'), 'multi-AC pending rule preserved');
  });
  test('M1b: the retained leg/connection table is applied on the 82 route for every topology in scope; valid combinations stay COMPLETE', () => {
    const cases = [
      ['1ph_3w_120_240', '3PH', 'L3', ['CONNECTION_INVALID@loads[0].connection', 'LEG_INVALID@loads[0].leg']],
      ['1ph_3w_120_240', '3PH', null, ['CONNECTION_INVALID@loads[0].connection']],
      ['1ph_3w_120_240', 'LN', 'L3', ['LEG_INVALID@loads[0].leg']],
      ['1ph_3w_120_240', 'LN', 'L2', []], ['1ph_3w_120_240', 'LL', null, []], ['1ph_3w_120_240', null, null, []],
      ['1ph_3w_120_208_network', 'LN', 'L1', []], ['1ph_3w_120_208_network', '3PH', null, ['CONNECTION_INVALID@loads[0].connection']],
    ];
    for (const [topo, conn, leg, expected] of cases) {
      const r = b0(); if (topo !== '1ph_3w_120_240') { r.snapshot.supply = { topology: topo, vLineToLine: 208, vLineToNeutral: 120, phases: 1, wires: 3 }; r.snapshot.loadModel = { kind: null, declarations: {} }; }
      r.snapshot.loads[0].connection = conn; r.snapshot.loads[0].leg = leg; const out = run(r);
      assert.deepStrictEqual(out.problems.filter((p) => p.layer === 'input').map((p) => p.code + '@' + p.field), expected, `${topo} ${conn} ${leg}`);
      assert.strictEqual(out.status, expected.length ? 'INVALID_INPUT' : 'COMPLETE');
    }
  });
  test('M1c: provenance — 82-only declarations are structural (L2); an answered shared declaration needs provenance.source at L3; balancedLN keeps the A shape', () => {
    for (const k of ['singleSupplySet', 'conductorAmpacityA', 'nycAcCentralExceptionAttested', 'laundryExceptionAttested', 'inventoryComplete']) { const r = b0(); delete r.snapshot.optional82[k].provenance; assert.throws(() => F.evaluateV2(r), (e) => e.name === 'LoadCalcEnvelopeError', k); }
    const nosrc = b0(); nosrc.snapshot.optional82.inventoryComplete.provenance = { note: null }; assert.throws(() => F.evaluateV2(nosrc), (e) => e.name === 'LoadCalcEnvelopeError');
    const si = b0(); si.snapshot.hvac.arrangement = 'heat_pump_with_supplemental'; si.snapshot.hvac.supplementalInterlocked = { value: false }; const o = run(si);
    assert.ok(o.problems.some((p) => p.code === 'MISSING_FIELD' && p.field === 'hvac.supplementalInterlocked.provenance'), 'on its actual arrangement the answered interlock needs provenance.source');
    const siNull = b0(); siNull.snapshot.hvac.supplementalInterlocked = { value: null }; assert.strictEqual(run(siNull).status, 'COMPLETE', 'an unanswered declaration needs no provenance');
    const bl = b0(); delete bl.snapshot.loadModel.declarations.balancedLN.provenance; assert.strictEqual(run(bl).status, 'COMPLETE');
    const pn = b0(); pn.snapshot.purpose = null; assert.strictEqual(run(pn).status, 'COMPLETE', 'purpose null: no effective clause requires purpose (disposition recorded in the addendum)');
  });
  test('M2: parser errors are activated by the CURRENT required slot — dormant with an inactive slot or an old predicate; active errors keep same-path suppression; C10/C11 transitions', () => {
    const err = (i) => ({ field: `loads[${i}].inclusion82`, raw: 'old', code: 'UNKNOWN_ENUM' });
    for (const cat of ['range', 'oven', 'cooktop', 'water_heater']) { const r = b0(); r.snapshot.loads[2].category = cat; refresh(r); r.parseErrors = [err(2)]; const o = run(r); assert.strictEqual(o.status, 'COMPLETE', cat); assert.deepStrictEqual(o.problems, []); assert.deepStrictEqual(r.parseErrors, [err(2)], 'dormant error retained in the request'); }
    for (const cat of ['dishwasher', 'appliance_fixed_other']) { const r = b0(); r.snapshot.loads[2].category = cat; refresh(r); r.parseErrors = [err(2)]; const o = run(r); assert.strictEqual(o.status, 'INCOMPLETE_INPUT', cat); assert.deepStrictEqual(o.problems.map((p) => p.code + '@' + p.field), ['MISSING_FIELD@loads[2].inclusion82']); }
    const c11 = b0(); c11.snapshot.loads[3].inclusion82 = null; c11.parseErrors = [err(3)]; const o11 = run(c11); assert.deepStrictEqual(o11.problems.map((p) => p.code + '|' + p.source), ['UNKNOWN_ENUM|parser']); assert.strictEqual(o11.status, 'INVALID_INPUT');
    const c11b = b0(); c11b.snapshot.loads[3].inclusion82 = { predicate: 'b3a_fixed_or_specific_circuit', answer: null, basis: null }; c11b.parseErrors = [err(3)]; assert.deepStrictEqual(run(c11b).problems.map((p) => p.code), ['UNKNOWN_ENUM'], 'unconfirmed object tagged with the current predicate + error = active, MISSING suppressed');
    const c10 = b0(); c10.snapshot.loads[3].category = 'range'; refresh(c10); c10.parseErrors = [err(3)]; assert.strictEqual(run(c10).status, 'COMPLETE', 'C10: switch to a category where the slot is not required — retained error does not block');
    const ac = b0(); ac.snapshot.loads[4].ratingCoverage82 = null; ac.parseErrors = [{ field: 'loads[4].ratingCoverage82', raw: '?', code: 'UNKNOWN_ENUM' }]; assert.deepStrictEqual(run(ac).problems.map((p) => p.code), ['UNKNOWN_ENUM'], 'null current field does not hide an active error');
    const scu = b0(); scu.parseErrors = [{ field: 'loads[0].separatelyControlledUnits', raw: '1.5', code: 'NOT_INTEGER' }]; assert.strictEqual(run(scu).status, 'COMPLETE', 'separatelyControlledUnits error dormant on a non-heating record');
    const meas = b0(); meas.parseErrors = [{ field: 'measurement.reading.value', raw: 'x', code: 'NOT_FINITE' }, { field: 'multifamily.unitCount', raw: 'y', code: 'NOT_INTEGER' }]; assert.strictEqual(run(meas).status, 'COMPLETE', 'other-method fields are outside the 82 active set');
    const area = b0(); area.snapshot.dwelling.floorAreaFt2 = null; area.parseErrors = [{ field: 'dwelling.floorAreaFt2', raw: '15o0', code: 'NOT_FINITE' }]; assert.deepStrictEqual(run(area).problems.map((p) => p.code), ['NOT_FINITE'], 'active dwelling error keeps same-path MISSING suppression');
  });
  test('M2: canonical parse-error paths at L2 — unknown/unsafe/non-canonical/out-of-range are structural rejections; known paths under a null parent stay legal', () => {
    for (const f of ['loads[999].inclusion82', 'loads[04].rating.value', 'loads[5].rating.value', 'measurement.__proto__.polluted', 'loads[0].label', 'dwelling.bogus', 'optional82', 'loads[0]', '']) { const r = b0(); r.parseErrors = [{ field: f, raw: 'x', code: 'UNKNOWN_ENUM' }]; assert.throws(() => F.evaluateV2(r), (e) => e.name === 'LoadCalcEnvelopeError', f); }
    for (const f of ['loads[4].ratingCoverage82', 'loads[0].rating.value', 'measurement.reading.value', 'measurement.newLoad.precalculated.va', 'multifamily.unitCount', 'supply.topology', 'optional82.conductorAmpacityA.value']) { const r = b0(); r.parseErrors = [{ field: f, raw: 'x', code: 'NOT_FINITE' }]; assert.doesNotThrow(() => F.evaluateV2(r), f); }
    assert.strictEqual(V2.parsePathProblem('measurement.reading.value', { loads: [] }), null, 'a known field under a still-null parent is not an unknown path');
  });
});

describe('R2 regressions — N1 schema/JS/checker alignment, N2 known paths and HVAC activity, N3 derived display/metadata', () => {
  const b0 = () => clone(byId('LC82-B0P').request);
  const run = (r) => B82.evaluate82(V2.toEnvelope82(r));
  const OPT82 = ['singleSupplySet', 'conductorAmpacityA', 'nycAcCentralExceptionAttested', 'laundryExceptionAttested', 'inventoryComplete'];
  test('N1: every 82-only declaration separately requires provenance.source — runtime L2, JSON schema and checker agree; valid confirmed/unconfirmed forms accepted', () => {
    for (const k of OPT82) {
      const miss = b0(); delete miss.snapshot.optional82[k].provenance; assert.throws(() => F.evaluateV2(miss), (e) => e.name === 'LoadCalcEnvelopeError' && e.errors.some((m) => m.includes(k)), 'missing provenance ' + k);
      const nosrc = b0(); nosrc.snapshot.optional82[k].provenance = { note: null }; assert.throws(() => F.evaluateV2(nosrc), (e) => e.name === 'LoadCalcEnvelopeError', 'missing source ' + k);
      const bad = b0(); bad.snapshot.optional82[k].provenance = { source: 'nope', note: null }; assert.throws(() => F.evaluateV2(bad), (e) => e.name === 'LoadCalcEnvelopeError', 'unknown source enum ' + k);
    }
    const unconf = b0(); unconf.snapshot.optional82.laundryExceptionAttested = { value: null, provenance: { source: 'designer_declaration', note: null } }; assert.strictEqual(run(unconf).status, 'COMPLETE');
    const other = b0(); other.snapshot.optional82.nycAcCentralExceptionAttested = { value: true, provenance: { source: 'utility_data', note: 'records' } }; assert.strictEqual(run(other).status, 'COMPLETE');
    assert.strictEqual(run(b0()).status, 'COMPLETE', 'ordinary matched request still accepted');
    const shared = b0(); delete shared.snapshot.loadModel.declarations.balancedLN.provenance; assert.strictEqual(run(shared).status, 'COMPLETE', 'A-shared declarations keep the optional-provenance shape');
  });
  test('N1: the JSON schema itself rejects each one-field provenance omission, so an L2-invalid request can never form an accepted pair', { skip: pythonAvailable ? false : 'python3 not available — BLOCKED' }, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc82-n1-'));
    const good = { id: 'LC82-B0P', assumptions: { engineRuleStatus: 'default' }, request: byId('LC82-B0P').request, result: B82.evaluate82(V2.toEnvelope82(byId('LC82-B0P').request)) }; const bad = [];
    for (const k of OPT82) { const p = clone(good); delete p.request.snapshot.optional82[k].provenance; p.id = 'no-prov-' + k; bad.push(p); const q = clone(good); q.request.snapshot.optional82[k].provenance = { note: null }; q.id = 'no-src-' + k; bad.push(q); }
    const f = path.join(tmp, 'n1-pairs.json'); fs.writeFileSync(f, JSON.stringify({ pairs: bad }));
    const r = spawnSync('python3', [path.join(ROOT, 'tools', 'contract_invariants_82.py'), f], { encoding: 'utf8', env: PY_ENV });
    assert.strictEqual(r.status, 1); assert.match(r.stdout, new RegExp(`${bad.length} with violations`));
    const script = `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'test', 'fixtures', 'loadCalc'))})\nfrom mini_jsonschema_r2 import Validator\nS = json.load(open(${JSON.stringify(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'EC-CALC-2-B82-schema-r1.json'))}))\nv = Validator({**S, 'oneOf': [{'$ref': '#/$defs/RequestV2'}]})\nP = json.load(open(${JSON.stringify(f)}))['pairs']\nprint(json.dumps({'accepted': [p['id'] for p in P if not v.errors(p['request'])]}))`;
    const sch = spawnSync('python3', ['-c', script], { encoding: 'utf8', env: PY_ENV }); assert.strictEqual(sch.status, 0, sch.stderr);
    assert.deepStrictEqual(JSON.parse(sch.stdout.trim().split('\n').pop()).accepted, [], 'the schema rejects every one-field omission (N1 alignment)');
  });
  test('N2a: the four accepted A guide-answer keys are canonical V2 paths, dormant under 82, and preserved in the A projection', () => {
    for (const k of ['houseFeeder', 'aptFeeder', 'houseState', 'bldgCooking']) {
      const f = `method.guideAnswers.${k}`; assert.strictEqual(V2.parsePathProblem(f, { loads: [] }), null, f);
      const r = b0(); r.parseErrors = [{ field: f, raw: 'x', code: 'UNKNOWN_ENUM' }];
      assert.doesNotThrow(() => F.evaluateV2(r), f); assert.strictEqual(run(r).status, 'COMPLETE', f + ' is not part of the 82 active set');
      const a = clone(r); a.snapshot.method.selected = 'measured_220_87'; const envA = V2.downConvertToA(a);
      assert.deepStrictEqual(envA.parseErrors.map((p) => p.field), [f], 'the guide error survives the projection to A');
      assert.strictEqual(JSON.stringify(F.evaluateV2(a).result), JSON.stringify(A.evaluate(envA)), 'facade result == direct A, parser problems included');
      assert.ok(A.evaluate(envA).problems.some((p) => p.source === 'parser' && p.field === f), 'A emits its normal parser problem');
    }
  });
  test('N2a: the closed V2 path set covers every scalar key of the accepted LC_FIELDS map (read-only cross-check of mobile.html)', () => {
    const html = fs.readFileSync(path.join(ROOT, 'mobile.html'), 'utf8');
    const block = html.slice(html.indexOf('var LC_FIELDS = {'), html.indexOf('var LC_LOAD_SUBFIELDS'));
    const keys = [...block.matchAll(/'([A-Za-z0-9_.\[\]]+)':\s*\{|(?:^|[{,]\s*)([A-Za-z][A-Za-z0-9_]*):\s*\{\s*kind/gm)].map((m) => m[1] || m[2]).filter(Boolean);
    const scalars = keys.filter((k) => !k.startsWith('loads[]'));
    assert.ok(scalars.length >= 30, 'LC_FIELDS scalar keys found: ' + scalars.length);
    const missing = scalars.filter((k) => !V2.SCALAR_PATHS.has(k));
    assert.deepStrictEqual(missing, [], 'every accepted LC_FIELDS scalar key is a canonical V2 path');
  });
  test('N2b: the two named HVAC fields are inactive on ac_only (dormant values and errors kept, never blocking) and fully active on heat_pump_with_supplemental', () => {
    const dormantErr = (f) => { const r = b0(); r.parseErrors = [{ field: f, raw: 'maybe', code: 'UNKNOWN_ENUM' }]; const o = run(r); assert.strictEqual(o.status, 'COMPLETE', f); assert.deepStrictEqual(o.problems, []); assert.deepStrictEqual(r.parseErrors.map((p) => p.field), [f], 'retained in the request'); };
    dormantErr('hvac.supplementalInterlocked'); dormantErr('hvac.installingAdditionalHvac');
    for (const v of [{ value: false }, { value: true }, { value: false, provenance: { source: 'designer_declaration', note: null } }]) { const r = b0(); r.snapshot.hvac.supplementalInterlocked = v; assert.strictEqual(run(r).status, 'COMPLETE', JSON.stringify(v)); }
    const iah = b0(); iah.snapshot.hvac.installingAdditionalHvac = { value: true }; assert.strictEqual(run(iah).status, 'COMPLETE');
    const malformed = b0(); malformed.snapshot.hvac.supplementalInterlocked = { value: 'yes' }; assert.throws(() => F.evaluateV2(malformed), (e) => e.name === 'LoadCalcEnvelopeError', 'L2 still validates dormant objects');
    const unknownKey = b0(); unknownKey.snapshot.hvac.installingAdditionalHvac = { value: null, provenance: { source: 'designer_declaration', note: null }, extra: 1 }; assert.throws(() => F.evaluateV2(unknownKey), (e) => e.name === 'LoadCalcEnvelopeError');
    const hp = (mut) => { const r = b0(); r.snapshot.hvac.arrangement = 'heat_pump_with_supplemental'; mut(r); return run(r); };
    const noProv = hp((r) => { r.snapshot.hvac.supplementalInterlocked = { value: false }; });
    assert.deepStrictEqual(noProv.problems.map((p) => p.code + '@' + p.field).sort(), ['CAPABILITY_DISABLED@hvac.arrangement', 'MISSING_FIELD@hvac.supplementalInterlocked.provenance']);
    const pending = hp((r) => { r.snapshot.hvac.supplementalInterlocked = { value: true, provenance: { source: 'designer_declaration', note: null } }; });
    assert.deepStrictEqual(pending.problems.map((p) => p.code + '@' + p.field).sort(), ['CAPABILITY_DISABLED@hvac.arrangement', 'RULE_PENDING@hvac.supplementalInterlocked']);
    const parseActive = hp((r) => { r.parseErrors = [{ field: 'hvac.supplementalInterlocked', raw: 'maybe', code: 'UNKNOWN_ENUM' }]; r.snapshot.hvac.supplementalInterlocked = { value: null }; });
    assert.deepStrictEqual(parseActive.problems.map((p) => p.code + '@' + p.field).sort(), ['CAPABILITY_DISABLED@hvac.arrangement', 'UNKNOWN_ENUM@hvac.supplementalInterlocked']);
    assert.strictEqual(pending.status, 'UNSUPPORTED_SCOPE', 'capability precedence unchanged, without short-circuiting the applicable interlock problems');
  });
  test('N3: the display strings are the derived formatting of the raw values — ordinary, rounding boundary and grouped-thousands witnesses', () => {
    const w = [['LC82-B0P', 23680, '23,680 VA', '98.7 A'], ['LC82-R2-N3-rounding-boundary-current', 23684, '23,684 VA', '98.7 A'], ['LC82-R2-N3-rounding-half-up-current', 23682.5, '23,683 VA', '98.7 A'], ['LC82-R2-N3-large-grouped-current', 378880, '378,880 VA', '1,578.7 A']];
    for (const [id, total, totalStr, lineStr] of w) {
      const r = run(byId(id).request);
      assert.strictEqual(r.demand.totalVA, total, id); assert.strictEqual(r.current.lineA, total / 240, id);
      assert.strictEqual(r.display.strings.totalVA, totalStr, id); assert.strictEqual(r.display.strings.lineA, lineStr, id);
    }
  });
});

describe('R3 regressions — Q1 cause-derived ruleRef and Q2 full problem identities', () => {
  const b0 = () => clone(byId('LC82-B0P').request);
  const run = (r) => B82.evaluate82(V2.toEnvelope82(r));
  const ident = (r) => r.problems.map((p) => [p.code, p.field, p.layer, p.source, p.ruleRef].join('|')).sort();
  const runChecker = (pairsIn, name) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc82-r3-')), name); fs.writeFileSync(f, JSON.stringify({ pairs: pairsIn })); return spawnSync('python3', [path.join(ROOT, 'tools', 'contract_invariants_82.py'), f], { encoding: 'utf8', env: PY_ENV }); };
  const pairOf = (id) => { const c = byId(id); const ev = c.assumptions.engineRuleStatus === 'default' ? B82.evaluate82 : B82.TEST_ONLY.createPendingSourceEvaluator(c.assumptions.engineRuleStatus); return { id, assumptions: c.assumptions, request: c.request, result: ev(V2.toEnvelope82(c.request)) }; };

  test('Q1: the engine distinguishes the source-cited minimum, the product maximum and a transported parser failure — the runtime annotations are unchanged', () => {
    const min = b0(); min.snapshot.dwelling.smallApplianceCircuits = 1;
    assert.deepStrictEqual(ident(run(min)), ['OUT_OF_RANGE|dwelling.smallApplianceCircuits|input|engine|210.11(C)(1)']);
    const max = b0(); max.snapshot.dwelling.smallApplianceCircuits = 101;
    assert.deepStrictEqual(ident(run(max)), ['OUT_OF_RANGE|dwelling.smallApplianceCircuits|input|engine|']);
    const par = b0(); par.snapshot.dwelling.smallApplianceCircuits = null; par.parseErrors = [{ field: 'dwelling.smallApplianceCircuits', raw: '101', code: 'OUT_OF_RANGE' }];
    assert.deepStrictEqual(ident(run(par)), ['OUT_OF_RANGE|dwelling.smallApplianceCircuits|input|parser|']);
    const kept = b0(); kept.snapshot.dwelling.smallApplianceCircuits = 1; kept.parseErrors = [{ field: 'dwelling.smallApplianceCircuits', raw: '1', code: 'OUT_OF_RANGE' }];
    assert.deepStrictEqual(ident(run(kept)), ['OUT_OF_RANGE|dwelling.smallApplianceCircuits|input|parser|'], 'the retained value is not recast as the engine minimum');
    const both = b0(); both.snapshot.dwelling.smallApplianceCircuits = null; both.parseErrors = [{ field: 'dwelling.smallApplianceCircuits', raw: '101', code: 'OUT_OF_RANGE' }];
    const r = B82.TEST_ONLY.createPendingSourceEvaluator({ 'S-11a': 'pending' })(V2.toEnvelope82(both));
    assert.deepStrictEqual(ident(r), ['OUT_OF_RANGE|dwelling.smallApplianceCircuits|input|parser|', 'RULE_PENDING|dwelling.smallApplianceCircuits|input|engine|210.11(C)(1),(2)'], 'distinct causes on one field keep their own source and citation');
    const laundry = b0(); laundry.snapshot.dwelling.laundryCircuits = 101;
    assert.deepStrictEqual(ident(run(laundry)), ['OUT_OF_RANGE|dwelling.laundryCircuits|input|engine|'], 'another product bound stays uncited');
  });

  test('Q1: the checker accepts each of those actual outputs and rejects a false or missing citation on either branch', { skip: pythonAvailable ? false : 'python3 not available — BLOCKED' }, () => {
    const ok = ['LC82-R3-Q1-sa-min-engine', 'LC82-R3-Q1-sa-max-engine', 'LC82-R3-Q1-sa-parser-null', 'LC82-R3-Q1-sa-parser-retained-value', 'LC82-R3-Q1-sa-parser-plus-source-pending', 'LC82-R3-Q1-source-pending-only', 'LC82-R3-Q1-laundry-max-engine'].map(pairOf);
    let r = runChecker(ok, 'ok.json'); assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, new RegExp(`${ok.length} checked, 0 with violations`));
    const bad = [];
    const falseRef = (id) => { const p = clone(pairOf(id)); p.id += '__FALSE_REF'; p.result.problems.find((x) => x.code === 'OUT_OF_RANGE').ruleRef = '210.11(C)(1)'; bad.push(p); };
    falseRef('LC82-R3-Q1-sa-max-engine'); falseRef('LC82-R3-Q1-sa-parser-null'); falseRef('LC82-R3-Q1-laundry-max-engine');
    const dropRef = clone(pairOf('LC82-R3-Q1-sa-min-engine')); dropRef.id += '__MISSING_REF'; dropRef.result.problems[0].ruleRef = null; bad.push(dropRef);
    const wrongRef = clone(pairOf('LC82-R3-Q1-source-pending-only')); wrongRef.id += '__WRONG_REF'; wrongRef.result.problems[0].ruleRef = '210.11(C)(1)'; bad.push(wrongRef);
    const parserAsEngine = clone(pairOf('LC82-R3-Q1-sa-parser-null')); parserAsEngine.id += '__PARSER_AS_ENGINE'; parserAsEngine.result.problems[0].source = 'engine'; parserAsEngine.result.problems[0].ruleRef = '210.11(C)(1)'; bad.push(parserAsEngine);
    r = runChecker(bad, 'bad.json'); assert.strictEqual(r.status, 1); assert.match(r.stdout, new RegExp(`${bad.length} checked, ${bad.length} with violations`));
  });

  test('Q2: the checker compares the whole identity multiset per layer — wrong field, wrong source, duplicates, extras and fabricated capacity problems are rejected; legitimate distinct causes are kept', { skip: pythonAvailable ? false : 'python3 not available — BLOCKED' }, () => {
    const controls = [];
    const mk = (id, mut) => { const r = b0(); mut(r); const p = { id, assumptions: { engineRuleStatus: 'default' }, request: r, result: run(r) }; controls.push(p); return p; };
    const notSel = mk('CUR_MODEL_NOT_SELECTED', (r) => { r.snapshot.loadModel.kind = null; });
    const declMiss = mk('CUR_DECLARATION_MISSING', (r) => { r.snapshot.loadModel.declarations.balancedLN.value = null; });
    const unsup = mk('CUR_MODEL_UNSUPPORTED', (r) => { r.snapshot.loadModel.kind = 'network_208_all_LL'; });
    const base = mk('CUR_BASELINE', () => {});
    const both = pairOf('LC82-R3-Q1-sa-parser-plus-source-pending'); controls.push(both);
    let r = runChecker(controls, 'ctl.json'); assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, new RegExp(`${controls.length} checked, 0 with violations`));
    const bad = [];
    for (const p of [notSel, declMiss, unsup]) {
      const wf = clone(p); wf.id += '__WRONG_FIELD'; wf.result.problems[0].field = 'hvac.arrangement'; bad.push(wf);
      const ws = clone(p); ws.id += '__WRONG_SOURCE'; ws.result.problems[0].source = 'parser'; bad.push(ws);
      const dup = clone(p); dup.id += '__DUPLICATE'; dup.result.problems.push(clone(dup.result.problems[0])); bad.push(dup);
      const drop = clone(p); drop.id += '__DROPPED'; drop.result.problems = []; bad.push(drop);
    }
    const cap = clone(base); cap.id += '__FABRICATED_CAPACITY'; cap.result.problems.push({ code: 'MISSING_FIELD', field: 'optional82.inventoryComplete', layer: 'capacity', source: 'engine', ruleRef: null, message: 'false' }); bad.push(cap);
    const early = clone(base); early.id += '__CURRENT_BEFORE_DEMAND'; early.result.problems.push({ code: 'MODEL_NOT_SELECTED', field: 'loadModel.kind', layer: 'current', source: 'engine', ruleRef: null, message: 'false' }); bad.push(early);
    const dropOne = clone(both); dropOne.id += '__ONE_CAUSE_DROPPED'; dropOne.result.problems = dropOne.result.problems.filter((x) => x.code !== 'RULE_PENDING'); bad.push(dropOne);
    const partial = pairOf('LC82-09a-evse-plus-ac'); const dropDem = clone(partial); dropDem.id += '__DEMAND_PROBLEM_DROPPED'; dropDem.result.problems = dropDem.result.problems.slice(0, 1); bad.push(dropDem);
    const dupDem = clone(partial); dupDem.id += '__DEMAND_PROBLEM_DUPLICATED'; dupDem.result.problems.push(clone(dupDem.result.problems[0])); bad.push(dupDem);
    r = runChecker(bad, 'bad2.json'); assert.strictEqual(r.status, 1);
    assert.match(r.stdout, new RegExp(`${bad.length} checked, ${bad.length} with violations`), r.stdout);
  });

  test('Q1/Q2: the eleven unchanged R2 engine outputs supplied by the reviewer are accepted and all ten adversarial copies rejected', { skip: pythonAvailable ? false : 'python3 not available — BLOCKED' }, () => {
    const dir = path.join(ROOT, '..', 'proof');
    const files = [['r2-n3-actual-pairs.json', 0, 7], ['r2-n3-problem-identity-actual.json', 0, 4], ['r2-n3-false-ref-pairs.json', 1, 3], ['r2-n3-problem-identity-mutants.json', 1, 7]];
    let ran = 0;
    for (const [name, wantStatus, count] of files) {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) continue;   // reviewer evidence lives outside source/; skipped when the package is opened standalone
      const r = spawnSync('python3', [path.join(ROOT, 'tools', 'contract_invariants_82.py'), f], { encoding: 'utf8', env: PY_ENV });
      assert.strictEqual(r.status, wantStatus, name + ': ' + r.stdout);
      assert.match(r.stdout, new RegExp(`${count} checked, ${wantStatus === 0 ? 0 : count} with violations`), name);
      ran++;
    }
    assert.ok(ran === 0 || ran === 4, 'either all four reviewer files are present or none');
  });
});

describe('Independent checker and schema (child processes; blocked, not passed, when python3 is absent)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc82-'));
  const pairs = CASES.filter((c) => c.kind !== 'L2').map((c) => ({ id: c.id, assumptions: c.assumptions, request: c.request, result: evaluatorFor(c)(V2.toEnvelope82(c.request)) }));
  const pairsFile = path.join(tmp, 'pairs.json'); fs.writeFileSync(pairsFile, JSON.stringify({ pairs }));
  test('contract_invariants_82.py accepts every actual (request, result) pair', { skip: pythonAvailable ? false : 'python3 not available in this environment — checker run BLOCKED' }, () => {
    const p = spawnSync('python3', [path.join(ROOT, 'tools', 'contract_invariants_82.py'), pairsFile], { encoding: 'utf8', env: PY_ENV });
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout, new RegExp(`pairs: ${pairs.length} checked, 0 with violations`));
  });
  test('contract_invariants_82.py rejects every deliberately corrupted copy (mutants live only in the temp copy)', { skip: pythonAvailable ? false : 'python3 not available — mutation run BLOCKED' }, () => {
    const base = path.join(tmp, 'mutation-base.json'); fs.writeFileSync(base, JSON.stringify({ pairs: pairs.filter((x) => ['LC82-B0P', 'LC82-09a-evse-plus-ac', 'LC82-C7-ac-coverage-false', 'LC82-S1-dryer-on-laundry-circuit', 'LC82-11-network-apartment', 'LC82-C1-coverage-null', 'LC82-DEC-none'].includes(x.id)) }));
    const p = spawnSync('python3', [path.join(ROOT, 'tools', 'contract_invariants_82.py'), base, '--mutants', '--out', path.join(tmp, 'mutants.json')], { encoding: 'utf8', env: PY_ENV });
    assert.strictEqual(p.status, 0, p.stdout + p.stderr); assert.match(p.stdout, /0 SURVIVED, base failures 0/);
    const rep = JSON.parse(fs.readFileSync(path.join(tmp, 'mutants.json'), 'utf8')); const names = new Set(rep.results.filter((x) => x.mutant).map((x) => x.mutant));
    for (const must of ['coherent_percent_41', 'coherent_threshold_20000', 'coherent_category_swap', 'orphan_binding_no_operand', 'wrong_operand_unit', 'request_extra_key', 'cleared_residual_capacity_and_current', 'coherent_missing_ac_as_none', 'coherent_dormant_error_treated_active', 'escalating_test_configuration', 'coherent_c1_percent_80', 'coherent_unit_factor_4', 'binding_kind_swapped', 'display_lineA_zero', 'display_lineA_wrong_rounding', 'display_totalVA_wrong', 'presentation_wrong_supply', 'reference_wrong_amendment', 'reference_extra_entry', 'problem_duplicated', 'problem_rule_ref_forged']) assert.ok(names.has(must), 'mutation class present: ' + must);
    assert.ok(rep.results.every((x) => x.mutant ? x.rejected === true : false), 'every corrupted copy rejected');
  });
  test('a coherent wrong-rule result built here in JS (41 %, every descendant recomputed, current recomputed) is rejected by the checker on rule grounds', { skip: pythonAvailable ? false : 'python3 not available — BLOCKED' }, () => {
    const p = clone(pairs.find((x) => x.id === 'LC82-B0P')); const by = {};
    for (const l of p.result.demand.lines) {
      if (l.id === 'gen_tier2') l.percent = 41;
      const vals = l.operands.map((o) => (o.ref ? by[o.ref] : Math.round(o.quantity.value * 10000)));
      for (const o of l.operands) if (o.ref) o.quantity.value = by[o.ref] / 10000;
      let v; if (l.op === 'multiply_unit') v = l.operands[0].quantity.value * l.unitFactor.value * 10000; else if (l.op === 'sum') v = vals.reduce((a, b) => a + b, 0); else if (l.op === 'min_cap') v = Math.min(vals[0], l.threshold.exactE4); else if (l.op === 'excess_over') v = Math.max(vals[0] - l.threshold.exactE4, 0); else if (l.op === 'multiply_percent') v = (vals[0] / 100) * l.percent; else if (l.op === 'max_of') v = Math.max(...vals); else v = vals[0];
      l.result = { value: v / 10000, unit: 'VA', exactE4: v }; by[l.id] = v;
    }
    p.result.demand.totalExactE4 = by.total; p.result.demand.totalVA = by.total / 10000; p.result.current.lineA = p.result.demand.totalVA / 240; p.result.current.perConductorA = { L1: p.result.current.lineA, L2: p.result.current.lineA, L3: null };
    p.result.diagnostics.generalDemandVA = by.gen_demand / 10000; p.result.display.strings = { totalVA: '23,897 VA', generalDemandVA: '18,897 VA', lineA: '99.6 A' };
    assert.strictEqual(p.result.demand.totalVA, 23897);
    const f = path.join(tmp, 'js-coherent.json'); fs.writeFileSync(f, JSON.stringify({ pairs: [p] }));
    const r = spawnSync('python3', [path.join(ROOT, 'tools', 'contract_invariants_82.py'), f], { encoding: 'utf8', env: PY_ENV });
    assert.strictEqual(r.status, 1); assert.match(r.stdout, /1 with violations/); assert.match(r.stdout, /role template/);
  });
  test('EC-CALC-2-B82-schema-r1.json validates every actual pair and rejects the structural L2 fixtures (inherited subset validator)', { skip: pythonAvailable ? false : 'python3 not available — schema run BLOCKED' }, () => {
    const script = `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'test', 'fixtures', 'loadCalc'))})\nfrom mini_jsonschema_r2 import Validator\nS = json.load(open(${JSON.stringify(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'EC-CALC-2-B82-schema-r1.json'))}))\nvreq = Validator({**S, 'oneOf': [{'$ref': '#/$defs/RequestV2'}]}); vres = Validator({**S, 'oneOf': [{'$ref': '#/$defs/LoadCalcResult'}]})\nP = json.load(open(${JSON.stringify(pairsFile)}))['pairs']\nbad = [p['id'] for p in P if vreq.errors(p['request']) or vres.errors(p['result'])]\nL2 = json.load(open(${JSON.stringify(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'))}))['cases']\nacc = [c['id'] for c in L2 if c['kind'] == 'L2' and not vreq.errors(c['request'])]\nprint(json.dumps({'unsupported': sorted(vreq.unsupported_keywords), 'bad': bad, 'acceptedL2': acc}))`;
    const p = spawnSync('python3', ['-c', script], { encoding: 'utf8', env: PY_ENV }); assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    const out = JSON.parse(p.stdout.trim().split('\n').pop());
    assert.deepStrictEqual(out.unsupported, []); assert.deepStrictEqual(out.bad, []);
    assert.deepStrictEqual(out.acceptedL2.sort(), ['LC82-L2-parse-error-unknown-path', 'LC82-R1-M2-L2-error-index-outside-loads', 'LC82-R1-M2-L2-error-noncanonical-index', 'LC82-R1-M2-L2-error-unknown-load-field', 'LC82-R1-M2-L2-error-unsafe-nested-path'], 'canonical parse-error paths are an L2 rule of the V2 validator and the checker (they need the snapshot), beyond the shape schema; every other L2 fixture is rejected by shape');
  });
});
