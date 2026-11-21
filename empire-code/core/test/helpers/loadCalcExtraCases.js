'use strict';
/**
 * B1 generalization cases — hand-written literal expectations that were NOT
 * used to design src/calc/loadCalc.js. Each case builds its own envelope and
 * asserts named fields; where a number is derived it is derived here by
 * arithmetic (labelled mathematics) and compared exactly, never with a
 * tolerance. These are engine tests of the reviewed contract rules on inputs
 * the r22 fixtures do not cover (the r22 pairs left mutant M10 alive).
 */
const assert = require('node:assert');

const RB = { code: 'NYCEC-2025', base: 'NEC-2020', amendments: 'NYC-2025' };
const SUPPLY = {
  '1ph_2w_120': [120, 120, 1, 2], '1ph_2w_240': [240, null, 1, 2], '1ph_3w_120_240': [240, 120, 1, 3], '1ph_3w_120_208_network': [208, 120, 1, 3],
  '3ph_4w_208Y_120': [208, 120, 3, 4], '3ph_4w_480Y_277': [480, 277, 3, 4], '3ph_3w_480_delta': [480, null, 3, 3],
  '3ph_3w_240_delta': [240, null, 3, 3], '3ph_4w_240_delta_highleg': [240, 120, 3, 4],
};
const decl = (v, src) => ({ value: v, provenance: { source: src || 'designer_declaration', note: null } });
function supply(t) { const [vll, vln, ph, w] = SUPPLY[t] || [null, null, null, null]; return { topology: t, vLineToLine: vll, vLineToNeutral: vln, phases: ph, wires: w }; }
function snap(o) {
  const s = {
    schemaVersion: '3.2.1', ruleBasis: { ...RB }, purpose: 'service', occupancy: 'dwelling_unit_house', supply: supply('1ph_3w_120_240'),
    loadModel: { kind: 'split_240_all_LL', declarations: {} }, method: { selected: 'measured_220_87', guideRecommendation: null, selectionSource: 'manual', guideAnswers: {} },
    dwelling: { floorAreaFt2: null, smallApplianceCircuits: null, laundryCircuits: null, nycAcCircuitCount: null, existingDwelling: null },
    loads: [], hvac: { arrangement: null, supplementalInterlocked: decl(null), installingAdditionalHvac: decl(null) }, measurement: null,
    multifamily: { unitCount: null, unitsIdentical: null, unitGroups: [], allUnitsElectricCooking: decl(null), allUnitsElectricHeatOrAc: decl(null), singleFeederPerUnit: decl(null), houseLoads: { mode: null, va: null, items: [] } },
    migration: null,
  };
  return Object.assign(s, o || {});
}
function basis(established) { return { method: 'other_stated', ruleRefs: [], demandFactorsApplied: true, continuousFactorApplied: null, establishedForThisComparison: established, calculatedBy: 'engineer', provenance: { source: 'designer_declaration', note: null }, note: null }; }
function term(va, connection, leg, covers, coversSnapshot) { return { mode: 'precalculated', precalculated: { va, connection, leg, continuous: false, basis: basis(true), covers: covers || [], coversSnapshot: coversSnapshot === undefined ? [] : coversSnapshot } }; }
function annual(value, unit, o) {
  return Object.assign({
    basis: 'annual_max_demand', reading: { value, unit }, readingsPerConductor: null, readingScope: 'total_apparent_power', powerFactor: null,
    annualDataAvailable: decl(true, 'utility_data'), periodMonths: 12, periodDays: null, intervalMinutes: null, metric: 'other', continuousRecording: decl(null),
    instrument: 'utility_demand_meter', connectedTo: 'each_conductor', basedOnInitialLoading: decl(null), recordedWhileOccupied: decl(null), includesLargerOfHeatingOrCooling: decl(null),
    includesPeriodicSeasonalLoads: decl(null), hasRenewableEnergySystem: decl(false), hasPeakLoadShaving: decl(false),
    existing: { serviceRatingA: 200, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: decl(null), serviceOverloadPer230_90: decl(true) }, newLoad: { mode: 'none', precalculated: null },
  }, o || {});
}
function thirtyDayA(value, o) {
  return Object.assign({
    basis: '30d_recording_exception', reading: { value, unit: 'A' }, readingsPerConductor: null, readingScope: 'highest_loaded_conductor', powerFactor: null,
    annualDataAvailable: decl(false, 'recording_report'), periodMonths: null, periodDays: 30, intervalMinutes: 15, metric: 'highest_avg_kw_15min', continuousRecording: decl(true, 'recording_report'),
    instrument: 'power_meter', connectedTo: 'highest_loaded_conductor', basedOnInitialLoading: decl(true, 'recording_report'), recordedWhileOccupied: decl(true, 'recording_report'),
    includesLargerOfHeatingOrCooling: decl(true, 'recording_report'), includesPeriodicSeasonalLoads: decl(true, 'recording_report'), hasRenewableEnergySystem: decl(false), hasPeakLoadShaving: decl(false),
    existing: { serviceRatingA: 150, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: decl(null), serviceOverloadPer230_90: decl(true) }, newLoad: { mode: 'none', precalculated: null },
  }, o || {});
}
function load(id, category, va, o) {
  return Object.assign({ id, label: category || 'load', legacy: null, category, classification: 'confirmed', rating: { kind: 'va', value: va, volts: null }, quantity: 1, status: 'new', continuous: null, connection: 'LL', leg: null, separatelyControlledUnits: null, alms: { present: false, maxLoadVA: null } }, o || {});
}
const env = (snapshot, parseErrors) => ({ snapshot, parseErrors: parseErrors || [], profileId: 'A_measured_87_core' });
const codes = (r) => r.problems.map((p) => `${p.code}:${p.field}:${p.layer}`);
const SQRT3 = Math.sqrt(3);

const CASES = [
  { id: 'B1-X-01', title: 'network 120/208, balanced-LN model, 40,000 VA annual, 200 A -> (50,000/2)/120 = 208.33.. A, inadequate (kills M10)',
    envelope: () => env(snap({ supply: supply('1ph_3w_120_208_network'), loadModel: { kind: 'network_208_balanced_LN', declarations: { balancedLN: decl(true) } }, measurement: annual(40000, 'VA') })),
    check: (r) => {
      const i = (50000 / 2) / 120; // mathematics: (total / 2) / vLineToNeutral in the declared order
      assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalVA, 50000);
      assert.strictEqual(r.current.status, 'computed'); assert.strictEqual(r.current.model, 'network_208_balanced_LN');
      assert.strictEqual(r.current.lineA, i); assert.strictEqual(r.current.lineA, 208.33333333333334);
      assert.deepStrictEqual(r.current.perConductorA, { L1: i, L2: i, L3: null });
      assert.strictEqual(r.current.formula, 'I = (VA / 2) / 120');
      assert.strictEqual(r.existingCapacity.status, 'inadequate'); assert.strictEqual(r.existingCapacity.comparisons[0].demandValueRaw, i);
      assert.strictEqual(r.display.strings.lineA, '208.3 A');
    } },
  { id: 'B1-X-02', title: '240 V 1-ph 2-wire, single_2w, 24,000 VA, 100 A -> 30,000/240 = 125 A inadequate; polesLabel null',
    envelope: () => env(snap({ supply: supply('1ph_2w_240'), loadModel: { kind: 'single_2w', declarations: {} }, measurement: annual(24000, 'VA', { existing: { serviceRatingA: 100, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: decl(null), serviceOverloadPer230_90: decl(true) } }) })),
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalVA, 30000); assert.strictEqual(r.current.lineA, 125);
      assert.strictEqual(r.existingCapacity.status, 'inadequate'); assert.strictEqual(r.presentation.polesLabel, null); assert.strictEqual(r.presentation.topologyLabel, '240 V, 1-ph, 2-wire');
      assert.deepStrictEqual(r.current.perConductorA, { L1: 125, L2: 125, L3: null });
    } },
  { id: 'B1-X-03', title: '480Y/277 3-ph balanced, 100 kVA annual, 200 A -> norm line, 125,000/(sqrt3 x 480) A adequate',
    envelope: () => env(snap({ supply: supply('3ph_4w_480Y_277'), loadModel: { kind: 'three_phase_balanced', declarations: { balanced3ph: decl(true) } }, measurement: annual(100, 'kVA', { metric: 'max_demand_kva' }) })),
    check: (r) => {
      const i = 125000 / (SQRT3 * 480); // mathematics: sqrt3 x V_LL computed first, then the division
      assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.lines[0].id, 'norm'); assert.strictEqual(r.demand.lines[0].result.value, 100000);
      assert.strictEqual(r.demand.lines[1].operands[0].ref, 'norm'); assert.strictEqual(r.demand.totalVA, 125000);
      assert.strictEqual(r.current.lineA, i); assert.strictEqual(r.current.formula, 'I = VA / (sqrt3 * 480)'); assert.deepStrictEqual(r.current.perConductorA, { L1: i, L2: i, L3: i });
      assert.strictEqual(r.existingCapacity.status, 'adequate'); assert.strictEqual(r.presentation.polesLabel, '3-pole'); assert.strictEqual(r.presentation.topologyLabel, '480Y/277 V, 3-ph, 4-wire');
    } },
  { id: 'B1-X-04', title: 'kW reading with PF 0.8: 32 kW -> (32 x 1000) / 0.8 = 40,000 VA; x1.25 = 50,000; /240 = 208.33.. A > 200 inadequate',
    envelope: () => env(snap({ measurement: annual(32, 'kW', { powerFactor: 0.8, metric: 'max_demand_kw' }) })),
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.lines[0].op, 'convert_unit'); assert.strictEqual(r.demand.lines[0].powerFactor, 0.8);
      assert.strictEqual(r.demand.lines[0].result.value, (32 * 1000.0) / 0.8); assert.strictEqual(r.demand.totalVA, 50000);
      assert.strictEqual(r.existingCapacity.status, 'inadequate'); assert.strictEqual(r.existingCapacity.comparisons[0].demandValueRaw, 50000 / 240);
    } },
  { id: 'B1-X-05', title: 'purpose feeder: rating from feederAmpacityA, attestation feederOcpPer240_4; service fields ignored',
    envelope: () => env(snap({ purpose: 'feeder', measurement: annual(40000, 'VA', { existing: { serviceRatingA: null, feederAmpacityA: 225, ocpdA: null, feederOcpPer240_4: decl(true), serviceOverloadPer230_90: decl(null) } }) })),
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.deepStrictEqual(codes(r), []);
      assert.strictEqual(r.existingCapacity.status, 'adequate'); assert.strictEqual(r.existingCapacity.comparisons[0].ratingSource, 'feederAmpacityA'); assert.strictEqual(r.existingCapacity.comparisons[0].ratingValue, 225);
    } },
  { id: 'B1-X-06', title: 'per-conductor L1 100 / L2 60 A + 4,800 VA L-L term (unityPF declared), 150 A -> t_L1 145, t_L2 95 adequate; both compared',
    envelope: () => env(snap({ loadModel: { kind: 'split_240_declared_legs', declarations: { unityPF: decl(true) } }, measurement: thirtyDayA(100, { readingsPerConductor: { L1: 100, L2: 60, L3: null }, readingScope: 'per_conductor', connectedTo: 'each_conductor', newLoad: term(4800, 'LL', null) }) })),
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.unit, 'A');
      assert.deepStrictEqual(r.demand.lines.map((l) => l.id), ['e_L1', 'e_L2', 'n_LL', 't_L1', 't_L2', 'governing']);
      const byId = Object.fromEntries(r.demand.lines.map((l) => [l.id, l]));
      assert.strictEqual(byId.n_LL.result.value, 20); assert.strictEqual(byId.t_L1.result.value, 145); assert.strictEqual(byId.t_L2.result.value, 95);
      assert.deepStrictEqual(byId.t_L1.operands.map((o) => o.ref), ['e_L1', 'n_LL']); assert.strictEqual(byId.governing.operands[0].ref, 't_L1'); assert.strictEqual(r.demand.totalOnConductorA, 145);
      assert.strictEqual(r.existingCapacity.status, 'adequate'); assert.deepStrictEqual(r.existingCapacity.comparisons.map((c) => [c.conductor, c.demandValueRaw, c.satisfied]), [['L1', 145, true], ['L2', 95, true]]);
      assert.strictEqual(r.diagnostics.existingComponentAOnConductor, 125); assert.deepStrictEqual(r.display.strings, { totalOnConductorA: '145.0 A', L1: '145.0 A', L2: '95.0 A' });
    } },
  { id: 'B1-X-07', title: 'VA path, 3-ph balanced model with balanced3ph = false -> demand complete, current MODEL_UNSUPPORTED, no verdict',
    envelope: () => env(snap({ supply: supply('3ph_4w_208Y_120'), loadModel: { kind: 'three_phase_balanced', declarations: { balanced3ph: decl(false) } }, measurement: annual(40000, 'VA') })),
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.deepStrictEqual(codes(r), ['MODEL_UNSUPPORTED:loadModel.declarations.balanced3ph:current']);
      assert.strictEqual(r.current.status, 'not_computed'); assert.strictEqual(r.existingCapacity.status, 'not_assessed'); assert.strictEqual(r.existingCapacity.blockingCode, 'MODEL_UNSUPPORTED');
      assert.deepStrictEqual(r.existingCapacity.comparisons, []); assert.strictEqual(r.presentation.verdictLabel, 'not_assessed'); assert.strictEqual(r.demand.totalVA, 50000);
    } },
  { id: 'B1-X-08', title: "topology 'other' -> UNSUPPORTED_SCOPE (SCOPE_UNSUPPORTED supply.topology), all layers cleared",
    envelope: () => env(snap({ supply: supply('other'), loadModel: { kind: null, declarations: {} }, measurement: annual(40000, 'VA') })),
    check: (r) => {
      assert.strictEqual(r.status, 'UNSUPPORTED_SCOPE'); assert.ok(codes(r).includes('SCOPE_UNSUPPORTED:supply.topology:input'));
      assert.strictEqual(r.demand.status, 'not_computed'); assert.deepStrictEqual(r.demand.lines, []); assert.strictEqual(r.existingCapacity.status, 'not_assessed');
    } },
  { id: 'B1-X-09', title: 'declared model not applicable to the topology (split_240_all_LL on 208Y/120) -> COMPLETE, MODEL_UNSUPPORTED loadModel.kind, no verdict',
    envelope: () => env(snap({ supply: supply('3ph_4w_208Y_120'), loadModel: { kind: 'split_240_all_LL', declarations: {} }, measurement: annual(40000, 'VA') })),
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.deepStrictEqual(codes(r), ['MODEL_UNSUPPORTED:loadModel.kind:current']);
      assert.strictEqual(r.current.status, 'not_computed'); assert.strictEqual(r.existingCapacity.blockingCode, 'MODEL_UNSUPPORTED');
    } },
  { id: 'B1-X-10', title: 'existing load under a complete measured demand -> not_applicable_by_rule; still COMPLETE with verdict',
    envelope: () => env(snap({ loads: [load('wh', 'water_heater', 4500, { status: 'existing' })], measurement: annual(40000, 'VA') })),
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.deepStrictEqual(r.loadsCoverage, [{ loadId: 'wh', coverage: 'not_applicable_by_rule', ruleRef: '220.87(2)', reason: null, viaAggregate: false }]);
      assert.strictEqual(r.existingCapacity.status, 'inadequate');
    } },
  { id: 'B1-X-11', title: 'load with status null under a complete measured demand -> unresolved(MISSING_FIELD) -> PARTIAL, no verdict',
    envelope: () => env(snap({ loads: [load('x1', 'dryer', 5000, { status: null })], measurement: annual(40000, 'VA') })),
    check: (r) => {
      assert.strictEqual(r.status, 'PARTIAL'); assert.deepStrictEqual(r.loadsCoverage, [{ loadId: 'x1', coverage: 'unresolved', ruleRef: null, reason: 'MISSING_FIELD', viaAggregate: false }]);
      assert.deepStrictEqual(codes(r), ['LOAD_UNRESOLVED:loads[0]:demand']); assert.strictEqual(r.demand.status, 'partial_diagnostic'); assert.strictEqual(r.demand.partialSubtotalVA, 50000);
      assert.strictEqual(r.existingCapacity.blockingCode, 'LOAD_UNRESOLVED');
    } },
  { id: 'B1-X-12', title: 'numeric overflow (reading 1.6e308 VA: x1.25 leaves the double range): OUT_OF_RANGE, INVALID_INPUT, no verdict, no non-finite value anywhere',
    envelope: () => env(snap({ measurement: annual(1.6e308, 'VA') })),
    check: (r) => {
      assert.strictEqual(r.status, 'INVALID_INPUT'); assert.ok(codes(r).includes('OUT_OF_RANGE:measurement.reading.value:input'));
      assert.strictEqual(r.existingCapacity.status, 'not_assessed'); assert.deepStrictEqual(r.demand.lines, []);
      const walk = (x) => { if (typeof x === 'number') assert.ok(Number.isFinite(x)); else if (x && typeof x === 'object') Object.values(x).forEach(walk); }; walk(r);
    } },
  { id: 'B1-X-13', title: 'kW with PF 1.2 -> OUT_OF_RANGE measurement.powerFactor (INVALID_INPUT)',
    envelope: () => env(snap({ measurement: annual(40, 'kW', { powerFactor: 1.2 }) })),
    check: (r) => { assert.strictEqual(r.status, 'INVALID_INPUT'); assert.deepStrictEqual(codes(r), ['OUT_OF_RANGE:measurement.powerFactor:input']); } },
  { id: 'B1-X-14', title: '30-day amperes route with peak-load shaving -> QUALIFICATION_FAILED, UNQUALIFIED_METHOD, no lines',
    envelope: () => env(snap({ measurement: thirtyDayA(100, { hasPeakLoadShaving: decl(true) }) })),
    check: (r) => { assert.strictEqual(r.status, 'UNQUALIFIED_METHOD'); assert.deepStrictEqual(codes(r), ['QUALIFICATION_FAILED:measurement.hasPeakLoadShaving:input']); assert.strictEqual(r.problems[0].ruleRef, '220.87(1) Exception'); assert.deepStrictEqual(r.demand.lines, []); } },
  { id: 'B1-X-15', title: 'annual route with annualDataAvailable = false -> QUALIFICATION_FAILED 220.87(1); null -> QUALIFICATION_UNKNOWN',
    envelope: () => env(snap({ measurement: annual(40000, 'VA', { annualDataAvailable: decl(false, 'utility_data') }) })),
    check: (r, evaluate) => {
      assert.strictEqual(r.status, 'UNQUALIFIED_METHOD'); assert.deepStrictEqual(codes(r), ['QUALIFICATION_FAILED:measurement.annualDataAvailable:input']); assert.strictEqual(r.problems[0].ruleRef, '220.87(1)');
      const r2 = evaluate(env(snap({ measurement: annual(40000, 'VA', { annualDataAvailable: decl(null, 'utility_data') }) })));
      assert.strictEqual(r2.status, 'INCOMPLETE_INPUT'); assert.deepStrictEqual(codes(r2), ['QUALIFICATION_UNKNOWN:measurement.annualDataAvailable:input']);
    } },
  { id: 'B1-X-16', title: '3-ph amperes path, 3PH term with balanced3ph = false -> UNSUPPORTED_SCOPE (CAPABILITY_DISABLED), never a verdict',
    envelope: () => env(snap({ supply: supply('3ph_4w_208Y_120'), loadModel: { kind: 'three_phase_balanced', declarations: { balanced3ph: decl(false) } }, measurement: thirtyDayA(100, { newLoad: term(7200, '3PH', null) }) })),
    check: (r) => { assert.strictEqual(r.status, 'UNSUPPORTED_SCOPE'); assert.deepStrictEqual(codes(r), ['CAPABILITY_DISABLED:loadModel.declarations.balanced3ph:input']); assert.deepStrictEqual(r.existingCapacity.comparisons, []); } },
  { id: 'B1-X-17', title: 'covers [ev1] with coversSnapshot null -> stale -> PARTIAL AGGREGATE_STALE (a missing snapshot is never treated as fresh)',
    envelope: () => env(snap({ loads: [load('ev1', 'evse', 7200)], measurement: annual(40000, 'VA', { newLoad: term(7200, 'LL', null, ['ev1'], null) }) })),
    check: (r) => {
      assert.strictEqual(r.status, 'PARTIAL'); assert.ok(codes(r).includes('AGGREGATE_STALE:measurement.newLoad.precalculated.coversSnapshot:demand'));
      assert.deepStrictEqual(r.loadsCoverage, [{ loadId: 'ev1', coverage: 'unresolved', ruleRef: null, reason: 'AGGREGATE_STALE', viaAggregate: true }]);
      assert.deepStrictEqual(r.demand.lines.map((l) => l.id), ['existing125']); assert.strictEqual(r.diagnostics.newLoadTermVA, null);
    } },
  { id: 'B1-X-18', title: 'reading 0 VA and -5 VA -> OUT_OF_RANGE (a maximum demand is a positive measurement)',
    envelope: () => env(snap({ measurement: annual(0, 'VA') })),
    check: (r, evaluate) => {
      assert.strictEqual(r.status, 'INVALID_INPUT'); assert.deepStrictEqual(codes(r), ['OUT_OF_RANGE:measurement.reading.value:input']);
      assert.deepStrictEqual(codes(evaluate(env(snap({ measurement: annual(-5, 'VA') })))), ['OUT_OF_RANGE:measurement.reading.value:input']);
    } },
  { id: 'B1-X-19', title: "hostile ids ('__proto__', 'constructor') in loads/covers are data: counted_via_aggregate, no pollution, no crash",
    envelope: () => {
      const loads = [load('__proto__', 'evse', 7200), load('constructor', 'dryer', 5000)];
      const cs = [
        { id: '__proto__', category: 'evse', classification: 'confirmed', rating: { kind: 'va', value: 7200, volts: null }, quantity: 1, status: 'new', continuous: null, connection: 'LL', leg: null, separatelyControlledUnits: null, alms: { present: false, maxLoadVA: null } },
        { id: 'constructor', category: 'dryer', classification: 'confirmed', rating: { kind: 'va', value: 5000, volts: null }, quantity: 1, status: 'new', continuous: null, connection: 'LL', leg: null, separatelyControlledUnits: null, alms: { present: false, maxLoadVA: null } },
      ];
      return env(snap({ loads, measurement: annual(40000, 'VA', { newLoad: term(12200, 'LL', null, ['constructor', '__proto__'], cs) }) }));
    },
    check: (r) => {
      assert.strictEqual(r.status, 'COMPLETE'); assert.deepStrictEqual(r.loadsCoverage.map((c) => [c.loadId, c.coverage]), [['__proto__', 'counted_via_aggregate'], ['constructor', 'counted_via_aggregate']]);
      assert.strictEqual(r.demand.totalVA, 62200); assert.deepStrictEqual(r.demand.lines[1].loadIds, ['constructor', '__proto__']); assert.strictEqual(Object.getPrototypeOf({}), Object.prototype);
    } },
  { id: 'B1-X-20', title: 'per-conductor reading with L3 on a split-phase supply -> LEG_INVALID measurement.readingsPerConductor.L3',
    envelope: () => env(snap({ measurement: thirtyDayA(100, { readingsPerConductor: { L1: 100, L2: 20, L3: 10 }, readingScope: 'per_conductor', connectedTo: 'each_conductor' }) })),
    check: (r) => { assert.strictEqual(r.status, 'INVALID_INPUT'); assert.deepStrictEqual(codes(r), ['LEG_INVALID:measurement.readingsPerConductor.L3:input']); } },
  { id: 'B1-X-21', title: '2-wire 240 V amperes path, single reading, no term -> exact e_measured x 1.25; polesLabel null',
    envelope: () => env(snap({ supply: supply('1ph_2w_240'), loadModel: { kind: 'single_2w', declarations: {} }, measurement: thirtyDayA(80) })),
    check: (r) => { assert.strictEqual(r.status, 'COMPLETE'); assert.strictEqual(r.demand.totalOnConductorA, 100); assert.strictEqual(r.existingCapacity.status, 'adequate'); assert.strictEqual(r.presentation.polesLabel, null); assert.deepStrictEqual(r.demand.lines.map((l) => l.id), ['e_measured', 'governing']); } },
  { id: 'B1-X-22', title: 'two retained new loads under mode none -> PARTIAL: two LOAD_UNRESOLVED, one NEWLOAD_MODE_NONE_WITH_NEW_LOADS; loads never deleted',
    envelope: () => env(snap({ loads: [load('a', 'evse', 7200), load('b', 'range', 12000)], measurement: annual(40000, 'VA') })),
    check: (r) => {
      assert.strictEqual(r.status, 'PARTIAL'); assert.deepStrictEqual(codes(r), ['LOAD_UNRESOLVED:loads[0]:demand', 'LOAD_UNRESOLVED:loads[1]:demand', 'NEWLOAD_MODE_NONE_WITH_NEW_LOADS:measurement.newLoad.mode:demand']);
      assert.strictEqual(r.loadsCoverage.length, 2); assert.strictEqual(r.existingCapacity.status, 'not_assessed');
    } },
  { id: 'B1-X-23', title: 'VA path, declared-legs model with unityPF null -> COMPLETE, MODEL_DECLARATION_MISSING loadModel.declarations.unityPF, no current',
    envelope: () => env(snap({ loadModel: { kind: 'split_240_declared_legs', declarations: {} }, measurement: annual(40000, 'VA') })),
    check: (r) => { assert.strictEqual(r.status, 'COMPLETE'); assert.deepStrictEqual(codes(r), ['MODEL_DECLARATION_MISSING:loadModel.declarations.unityPF:current']); assert.strictEqual(r.current.status, 'not_computed'); assert.strictEqual(r.existingCapacity.blockingCode, 'MODEL_DECLARATION_MISSING'); } },
  { id: 'B1-X-24', title: 'network 120/208 all-LL, 30,000 VA, 150 A -> 37,500/208 A adequate; per-conductor L1=L2',
    envelope: () => env(snap({ supply: supply('1ph_3w_120_208_network'), loadModel: { kind: 'network_208_all_LL', declarations: {} }, measurement: annual(30000, 'VA', { existing: { serviceRatingA: 150, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: decl(null), serviceOverloadPer230_90: decl(true) } }) })),
    check: (r) => { const i = 37500 / 208; assert.strictEqual(r.current.lineA, i); assert.deepStrictEqual(r.current.perConductorA, { L1: i, L2: i, L3: null }); assert.strictEqual(r.existingCapacity.status, i <= 150 ? 'adequate' : 'inadequate'); assert.strictEqual(r.existingCapacity.status, 'inadequate'); } },
  { id: 'B1-X-25', title: 'rating exactly equal to the raw current -> adequate (<=), one ulp above -> inadequate (no epsilon)',
    envelope: () => env(snap({ measurement: annual(38400, 'VA') })),
    check: (r, evaluate) => {
      assert.strictEqual(r.current.lineA, 200); assert.strictEqual(r.existingCapacity.status, 'adequate');
      const up = env(snap({ measurement: annual(38400 + 2 ** -30, 'VA') })); // smallest representable step above 38400 that survives x1.25/240
      const r2 = evaluate(up); assert.ok(r2.current.lineA > 200); assert.strictEqual(r2.existingCapacity.status, 'inadequate'); assert.strictEqual(r2.display.strings.lineA, '200.0 A');
    } },
];

module.exports = { CASES, snap, supply, decl, annual, thirtyDayA, term, load, env, codes, basis };
