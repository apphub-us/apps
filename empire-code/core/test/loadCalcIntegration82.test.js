'use strict';
/**
 * LC-22082-B0-UI-INTEGRATION-1 — real adapter/form/bundle flows for the bounded 220.82 route.
 * Everything goes through the shipped adapter (test/helpers/loadCalcDom.js executes the actual mobile.html
 * functions against the actual generated EC block) and real control events. Expectations are stated
 * independently (accepted core values, the 23,680 VA B0-P baseline, the R3 checker on fresh pairs).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildHarness, html } = require('./helpers/loadCalcDom.js');

const ROOT = path.join(__dirname, '..');
const LC82 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'), 'utf8'));
const B0P = LC82.cases.find((c) => c.id === 'LC82-B0P').request;
const A = require('../src/calc/loadCalc.js');
const F = require('../src/calc/loadCalcFacade.js');
const V2 = require('../src/calc/loadCalcInputV2.js');
const codes = (r) => r.problems.map((p) => p.code + '@' + p.field).sort();
const cards = (h) => h.$('lcLoads').querySelectorAll('.lc-load');
const ctl = (card, role) => card.querySelectorAll('input, select, button').filter((e) => e.attrs['data-role'] === role)[0];
const setIn = (el, v) => { el.value = v; el.validity.badInput = false; el.dispatch(el.tagName === 'SELECT' ? 'change' : 'input'); };
const addLoad = (h, presetIndex, va) => { h.$('lcPresetName').value = String(presetIndex); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click'); return cards(h).slice(-1)[0]; };
const PRESET = { range: 0, dryer: 1, dishwasher: 2, water_heater: 3, ac: 4, evse: 7, other: 9 };
// LC-UI-CALCULATE-1: the 220.82 result is displayed only after an explicit Calculate/Recalculate (a real button press)
const calc = (h) => h.$('lcCalcBtn').dispatch('click');
const shown = (h) => { calc(h); return h.text(); };
const pythonAvailable = spawnSync('python3', ['--version']).status === 0;

/** Drive the B0-like case through the actual controls; every value is a parameter (nothing hard-coded). */
function driveB0(h, o) {
  const p = Object.assign({ area: 1500, sa: 2, laundry: 1, nyc: 0, ampacity: 200, range: 12000, wh: 4500, dryer: 5000, dw: 1200, ac: 5000, topology: '1ph_3w_120_240', model: 'split_240_balanced_LN' }, o || {});
  h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); h.set('lcTopology', p.topology); h.set('lcModel', p.model); if (p.model === 'split_240_balanced_LN') h.set('lcDeclBalancedLN', 'yes');
  h.set('lcFloorArea', String(p.area)); h.set('lcSmallApplianceCircuits', String(p.sa)); h.set('lcLaundryCircuits', String(p.laundry)); h.set('lcNycAcCircuits', String(p.nyc));
  h.set('lcArrangement', 'ac_only'); h.set('lcSingleSupplySet', 'yes'); h.set('lcConductorAmpacity', String(p.ampacity)); h.set('lcNycAcException', 'yes');
  addLoad(h, PRESET.range, p.range); addLoad(h, PRESET.water_heater, p.wh); addLoad(h, PRESET.dryer, p.dryer); addLoad(h, PRESET.dishwasher, p.dw); addLoad(h, PRESET.ac, p.ac);
  // live card accessors: a structural change (add / clone / remove) rebuilds the list (accepted B2-r1 behaviour), so cards are always re-read by position
  const c = { get range() { return cards(h)[0]; }, get wh() { return cards(h)[1]; }, get dryer() { return cards(h)[2]; }, get dw() { return cards(h)[3]; }, get ac() { return cards(h)[4]; } };
  setIn(ctl(c.dryer, 'inclusion'), 'not_on_counted_laundry_circuit'); setIn(ctl(c.dw, 'inclusion'), 'fixed_or_permanently_connected'); setIn(ctl(c.ac, 'coverage'), 'yes');
  for (const k of ['range', 'wh', 'dryer', 'dw', 'ac']) setIn(ctl(c[k], 'status'), 'existing');   // the B0-P fixture records are existing loads (an A-route field, irrelevant to 82)
  h.set('lcInventoryComplete', 'yes');
  return c;
}
/** expected B0-like total, computed independently of the engine from the 220.82 arithmetic: 3 VA/ft² + 1500 VA per circuit + appliances; 10 kVA @100 % + rest @40 %; + A/C @100 % */
function expectedTotal(p) { const gen = 3 * p.area + 1500 * (p.sa + p.laundry) + p.range + p.wh + p.dryer + p.dw; const dem = gen <= 10000 ? gen : 10000 + Math.round((gen - 10000) * 0.4 * 100) / 100; return dem + p.ac; }

describe('A. real form path — fresh/init/reset, a B0-like case through actual controls, canonical request == accepted baseline', () => {
  test('init and reset are the accepted blank V2 draft: no data, no attestation, no method, EMPTY; the 82 section is hidden until the method is chosen', () => {
    const h = buildHarness(); h.api.lcInit(); const s = h.state();
    assert.deepStrictEqual(s.snapshot, h.EC.loadCalcStateV2.createEmptyDraftV2().snapshot); assert.deepStrictEqual(s.context, { importedFrom: null, methodConfirmedAfterImport: false }); assert.strictEqual(s.snapshot.schemaVersion, '3.3.0');
    assert.deepStrictEqual(s.snapshot.optional82.inventoryComplete, { value: null, provenance: { source: 'designer_declaration', note: null }, basis: null }); assert.deepStrictEqual(s.snapshot.loads, []);
    assert.strictEqual(s.result.status, 'EMPTY'); assert.strictEqual(s.evaluations, 1); assert.strictEqual(h.$('lcOpt82').style.display, 'none');
    h.set('lcMethod', 'opt_220_82'); assert.strictEqual(h.$('lcOpt82').style.display, ''); assert.strictEqual(h.state().result.status, 'INCOMPLETE_INPUT');
    h.api.lcReset(); assert.deepStrictEqual(h.state().snapshot, h.EC.loadCalcStateV2.createEmptyDraftV2().snapshot); assert.strictEqual(h.state().result.status, 'EMPTY'); assert.strictEqual(h.$('lcOpt82').style.display, 'none');
  });
  test('the B0-like case entered through real controls: canonical request == the settled B0-P request; COMPLETE 23,680 VA, 98.7 A; coverage rendered for every record', () => {
    const h = buildHarness(); h.api.lcInit(); const c = driveB0(h);
    const s = h.state(); assert.strictEqual(s.fault, null); assert.strictEqual(s.result.status, 'COMPLETE');
    const req = JSON.parse(JSON.stringify(s.lastRequest)); const exp = JSON.parse(JSON.stringify(B0P));
    for (const l of req.snapshot.loads) l.label = ''; for (const l of exp.snapshot.loads) l.label = '';   // preset labels differ from the fixture labels only
    assert.deepStrictEqual(req, exp, 'the transported request equals the accepted B0-P candidate (labels aside)');
    assert.strictEqual(s.result.demand.totalVA, 23680); assert.strictEqual(s.result.demand.totalExactE4, 236800000); assert.strictEqual(s.result.current.lineA, 23680 / 240); assert.strictEqual(s.result.display.strings.lineA, '98.7 A');
    assert.strictEqual(JSON.stringify(s.result), JSON.stringify(F.evaluateV2(s.lastRequest).result), 'the rendered result is the accepted facade result of the transported request');
    const t = shown(h); assert.ok(/Total demand: 23,680 VA/.test(t) && /Line current: 98.7 A/.test(t) && /LOAD COVERAGE \(5\)/.test(t) && /RULE BASIS/.test(t), t.slice(0, 400));
    assert.ok(!/ADEQUATE|INADEQUATE/.test(t.replace(/NOT ASSESSED/g, '')) && /not assessed in the NEC 220.82/.test(t), 'no capacity verdict is implied for B82');
    assert.deepStrictEqual(cards(h).map((x) => x.attrs['data-load-id']), ['L1', 'L2', 'L3', 'L4', 'L5']); assert.deepStrictEqual(s.snapshot.loads.map((l) => l.basisId), ['bs-L1-1', 'bs-L2-1', 'bs-L3-1', 'bs-L4-1', 'bs-L5-1']);
    assert.ok(c.ac.attrs['data-load-id'] === 'L5');
  });
  test('varied real values are not hard-coded: three different dwellings computed by the accepted core equal the independent 220.82 arithmetic', () => {
    for (const p of [{ area: 2400, sa: 3, laundry: 1, nyc: 0, ampacity: 150, range: 8000, wh: 3800, dryer: 5500, dw: 1500, ac: 3500 }, { area: 900, sa: 2, laundry: 1, nyc: 0, ampacity: 100, range: 6000, wh: 2500, dryer: 4000, dw: 1000, ac: 2000 }, { area: 3100, sa: 4, laundry: 2, nyc: 0, ampacity: 225, range: 15000, wh: 5500, dryer: 6000, dw: 1800, ac: 7500 }]) {
      const h = buildHarness(); h.api.lcInit(); driveB0(h, p); const s = h.state();
      assert.strictEqual(s.result.status, 'COMPLETE', JSON.stringify(p) + ' ' + codes(s.result).join());
      assert.strictEqual(s.result.demand.totalVA, expectedTotal(p), JSON.stringify(p)); assert.strictEqual(s.result.current.lineA, expectedTotal(p) / 240);
    }
  });
  test('the pairs produced by the real form pass the unchanged R3 checker', { skip: pythonAvailable ? false : 'python3 not available' }, () => {
    const pairs = [];
    for (const [id, p] of [['UI-B0P', {}], ['UI-var-1', { area: 2400, sa: 3, laundry: 1, nyc: 0, ampacity: 150, range: 8000, wh: 3800, dryer: 5500, dw: 1500, ac: 3500 }]]) { const h = buildHarness(); h.api.lcInit(); driveB0(h, p); const s = h.state(); pairs.push({ id, assumptions: { engineRuleStatus: 'default' }, request: s.lastRequest, result: s.result }); }
    const h = buildHarness(); h.api.lcInit(); const c = driveB0(h); setIn(ctl(c.ac, 'coverage'), 'no'); pairs.push({ id: 'UI-negative-ac', assumptions: { engineRuleStatus: 'default' }, request: h.state().lastRequest, result: h.state().result });
    ctl(c.ac, 'basis-changed').dispatch('click'); pairs.push({ id: 'UI-stale', assumptions: { engineRuleStatus: 'default' }, request: h.state().lastRequest, result: h.state().result });
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lc82-ui-')), 'ui-pairs.json'); fs.writeFileSync(f, JSON.stringify({ pairs }));
    const r = spawnSync('python3', [path.join(ROOT, 'tools', 'contract_invariants_82.py'), f], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /4 checked, 0 with violations/);
  });
});

describe('B. editing — parser rejection/recovery, retained numbers, stale/dormant facts, label vs equipment change, clone, import confirmation', () => {
  test('live number/enum rejection and recovery on the 82 fields: raw text kept, one field cleared on correction, dormant errors preserved', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    h.set('lcFloorArea', '15oo'); let s = h.state(); assert.strictEqual(s.result.status, 'INVALID_INPUT'); assert.deepStrictEqual(s.fieldErrors['dwelling.floorAreaFt2'], { raw: '15oo', code: 'NOT_FINITE' }); assert.strictEqual(s.snapshot.dwelling.floorAreaFt2, null); assert.ok(s.lastRequest.parseErrors.some((e) => e.field === 'dwelling.floorAreaFt2'));
    assert.strictEqual(h.$('lcFloorArea').value, '15oo', 'raw text is not erased by the render'); assert.ok(h.$('lcFloorArea').classList.contains('lc-invalid'));
    h.set('lcSmallApplianceCircuits', '2.5'); s = h.state(); assert.strictEqual(s.fieldErrors['dwelling.smallApplianceCircuits'].code, 'NOT_INTEGER');
    h.set('lcFloorArea', '1500'); s = h.state(); assert.strictEqual(s.fieldErrors['dwelling.floorAreaFt2'], undefined, 'only the corrected field is cleared'); assert.strictEqual(s.fieldErrors['dwelling.smallApplianceCircuits'].code, 'NOT_INTEGER'); assert.strictEqual(s.result.status, 'INVALID_INPUT');
    h.set('lcSmallApplianceCircuits', '2'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.set('lcFloorArea', ''); s = h.state(); assert.strictEqual(s.snapshot.dwelling.floorAreaFt2, null); assert.strictEqual(s.fieldErrors['dwelling.floorAreaFt2'], undefined, 'a blank is plain null: the engine reports the missing field'); assert.ok(codes(s.result).includes('MISSING_FIELD@dwelling.floorAreaFt2'));
    h.set('lcFloorArea', '1500'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.set('lcArrangement', 'heat_pump_with_supplemental'); s = h.state(); assert.strictEqual(s.result.status, 'UNSUPPORTED_SCOPE'); assert.ok(codes(s.result).includes('CAPABILITY_DISABLED@hvac.arrangement')); assert.strictEqual(s.snapshot.hvac.arrangement, 'heat_pump_with_supplemental', 'a deferred choice is retained, not rewritten');
    h.set('lcArrangement', 'ac_only'); assert.strictEqual(h.state().result.status, 'COMPLETE');
  });
  test('per-record numeric blocking keeps the last accepted number alongside the raw error; the badInput transport; recovery', () => {
    const h = buildHarness(); h.api.lcInit(); const c = driveB0(h);
    const va = ctl(c.range, 'rating'); setIn(va, '12k'); let s = h.state(); assert.strictEqual(s.result.status, 'INVALID_INPUT'); assert.strictEqual(s.snapshot.loads[0].rating.value, 12000, 'structural number retained'); assert.deepStrictEqual(s.loadErrors.L1['rating.value'], { raw: '12k', code: 'NOT_FINITE' }); assert.ok(codes(s.result).includes('NOT_FINITE@loads[0].rating.value'));
    assert.strictEqual(ctl(c.range, 'rating'), va, 'the input element survives the render'); assert.strictEqual(va.value, '12k');
    va.value = ''; va.validity.badInput = true; va.dispatch('input'); s = h.state(); assert.deepStrictEqual(s.loadErrors.L1['rating.value'], { raw: '', code: 'NOT_FINITE', badInput: true });
    setIn(va, '12010'); s = h.state(); assert.strictEqual(s.loadErrors.L1, undefined); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.demand.totalVA, 23684);
    const q = ctl(c.range, 'quantity'); setIn(q, '0'); s = h.state(); assert.strictEqual(s.loadErrors.L1.quantity.code, 'OUT_OF_RANGE'); assert.strictEqual(s.snapshot.loads[0].quantity, 1); setIn(q, '1'); assert.strictEqual(h.state().result.status, 'COMPLETE');
  });
  test('stale true / stale false / restore-identical basis; label-only edit keeps bases and facts; equipment change retains the old fact under a new basis', () => {
    const h = buildHarness(); h.api.lcInit(); const c = driveB0(h);
    const lbl = ctl(c.ac, 'label'); setIn(lbl, 'Central A/C (attic)'); let s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.snapshot.loads[4].label, 'Central A/C (attic)'); assert.strictEqual(s.snapshot.loads[4].basisId, 'bs-L5-1'); assert.strictEqual(ctl(c.ac, 'label'), lbl);
    ctl(c.ac, 'basis-changed').dispatch('click'); s = h.state(); assert.strictEqual(s.snapshot.loads[4].basisId, 'bs-L5-2'); assert.strictEqual(s.snapshot.loads[4].ratingCoverage82.value, true); assert.strictEqual(s.snapshot.loads[4].ratingCoverage82.basis.basisId, 'bs-L5-1', 'old fact retained, not erased');
    assert.deepStrictEqual(codes(s.result), ['PREMISE_STALE@loads[4].ratingCoverage82', 'PREMISE_STALE@optional82.inventoryComplete']); assert.ok(/stale/.test(shown(h)));
    setIn(ctl(c.ac, 'coverage'), 'yes'); s = h.state(); assert.deepStrictEqual(codes(s.result), ['PREMISE_STALE@optional82.inventoryComplete'], 'the record answer is fresh again; the inventory declaration is not auto-refreshed');
    h.set('lcInventoryComplete', 'yes'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    setIn(ctl(c.ac, 'coverage'), 'no'); s = h.state(); assert.strictEqual(s.result.status, 'PARTIAL'); assert.strictEqual(s.result.demand.partialSubtotalVA, 18680); assert.ok(/GENERAL-LOAD SUBTOTAL/.test(shown(h)) && !/Total demand|Line current/.test(shown(h)));
    ctl(c.ac, 'basis-changed').dispatch('click'); s = h.state(); assert.ok(codes(s.result).includes('PREMISE_STALE@loads[4].ratingCoverage82'), 'stale before the negative branch: ' + codes(s.result).join());
  });
  test('dormant category fact vs a newly required predicate; clone gets fresh ids and unconfirmed facts; membership/quantity changes make the inventory stale', () => {
    const h = buildHarness(); h.api.lcInit(); const c = driveB0(h);
    setIn(ctl(c.dryer, 'category'), 'range'); let s = h.state(); assert.strictEqual(s.snapshot.loads[2].inclusion82.predicate, 'b3c_dryer_not_on_counted_laundry_circuit', 'the old fact is retained as dormant data'); assert.deepStrictEqual(codes(s.result), ['PREMISE_STALE@optional82.inventoryComplete']);
    h.set('lcInventoryComplete', 'yes'); assert.strictEqual(h.state().result.status, 'COMPLETE', 'dormant dryer fact does not block a range');
    setIn(ctl(c.dryer, 'category'), 'dishwasher'); s = h.state(); assert.ok(codes(s.result).includes('MISSING_FIELD@loads[2].inclusion82'), 'the old dryer answer is NOT the new (3)(a) answer: ' + codes(s.result).join());
    assert.strictEqual(ctl(c.dryer, 'inclusion').value, '', 'the select shows the new predicate as unanswered'); assert.ok(/different predicate/.test(c.dryer.textContent));
    setIn(ctl(c.dryer, 'inclusion'), 'specific_circuit'); h.set('lcInventoryComplete', 'yes'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    ctl(c.dw, 'clone').dispatch('click'); s = h.state(); assert.strictEqual(s.snapshot.loads.length, 6); const cl = s.snapshot.loads[5]; assert.strictEqual(cl.id, 'L6'); assert.strictEqual(cl.basisId, 'bs-L6-1'); assert.strictEqual(cl.inclusion82, null); assert.strictEqual(cl.rating.value, 1200); assert.strictEqual(cl.category, 'dishwasher');
    assert.ok(codes(s.result).includes('MISSING_FIELD@loads[5].inclusion82') && codes(s.result).includes('PREMISE_STALE@optional82.inventoryComplete'), codes(s.result).join());
    const cc = cards(h)[5]; setIn(ctl(cc, 'inclusion'), 'fixed_or_permanently_connected'); h.set('lcInventoryComplete', 'yes'); s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.demand.totalVA, 23680 + Math.round(1200 * 0.4 * 100) / 100);
    setIn(ctl(c.range, 'quantity'), '2'); s = h.state(); assert.deepStrictEqual(codes(s.result), ['PREMISE_STALE@optional82.inventoryComplete']);
    cc.querySelector('.lc-x').dispatch('click'); s = h.state(); assert.strictEqual(s.snapshot.loads.length, 5); assert.strictEqual(s.loadErrors.L6, undefined);
  });
  test('import confirmation: a restored lcv-2 draft selecting 82 stays unconfirmed through evaluation and repeated same-method selection; only the explicit action confirms', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h); const good = h.api.lcFavPayload();
    const old = { lcv: 2, profileId: 'A_measured_87_core', snapshot: V2.downConvertToA({ snapshot: good.snapshot, parseErrors: [] }).snapshot, fieldErrors: {}, loadErrors: {}, sourceFavId: 'old-3' };
    const h2 = buildHarness({ storage: JSON.stringify({ lc: [{ id: 5, name: 'Old 82 house', vals: old }] }) }); h2.api.lcInit(); h2.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    let s = h2.state(); assert.strictEqual(s.fault, null); assert.strictEqual(s.context.methodConfirmedAfterImport, false); assert.strictEqual(s.sourceFavId, 'old-3'); assert.ok(codes(s.result).includes('IMPORTED_METHOD_UNCONFIRMED@method.selected'), codes(s.result).join());
    assert.strictEqual(h2.$('lcImportConfirm').style.display, ''); assert.ok(/NOT confirmed/.test(h2.$('lcFavStatus').textContent));
    h2.set('lcMethod', 'opt_220_82'); s = h2.state(); assert.strictEqual(s.context.methodConfirmedAfterImport, false, 'selecting the same method again does not confirm'); assert.strictEqual(s.snapshot.method.selectionSource, 'manual');
    h2.$('lcConfirmMethod').dispatch('click'); s = h2.state(); assert.strictEqual(s.context.methodConfirmedAfterImport, true); assert.ok(!codes(s.result).includes('IMPORTED_METHOD_UNCONFIRMED@method.selected')); assert.strictEqual(h2.$('lcImportConfirm').style.display, 'none');
    assert.ok(codes(s.result).every((c) => /MISSING_FIELD|QUALIFICATION_UNKNOWN|PREMISE_STALE|RULE_PENDING/.test(c)) && codes(s.result).some((c) => /optional82\.inventoryComplete$/.test(c)), 'confirming the method answers no premise: ' + codes(s.result).join());
    assert.deepStrictEqual(s.snapshot.loads.map((l) => l.inclusion82), [null, null, null, null, null]);
  });
});

describe('C. A preservation — measured routes, guide/manual, A→82→A, capacity; facade == direct A', () => {
  const annual = (h) => { for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcReadingValue', '40000'], ['lcNewLoadMode', 'none'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes']]) h.set(id, v); };
  test('annual and 30-day routes, none/precalculated modes: every rendered result equals direct unchanged A on the accepted projection; capacity verdict works', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h); let s = h.state();
    assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.existingCapacity.status, 'adequate'); assert.strictEqual(s.lastRequest.profileId, 'AB82_core1'); assert.strictEqual(s.result.profileId, 'A_measured_87_core');
    const direct = A.evaluate(V2.downConvertToA(s.lastRequest)); assert.strictEqual(JSON.stringify(s.result), JSON.stringify(direct));
    assert.strictEqual(s.lastFacade.engine, 'A'); assert.ok(/ADEQUATE/.test(h.text()));
    h.set('lcNewLoadMode', 'precalculated'); h.set('lcTermVA', '5000'); h.set('lcTermConnection', 'LL'); h.set('lcTermEstablished', 'yes'); h.set('lcTermBasisMethod', 'other_stated'); h.set('lcTermCalculatedBy', 'engineer'); h.set('lcTermDemandFactors', 'yes'); h.$('lcConfirmCovers').dispatch('click');
    s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(s.result.demand.totalVA, 55000); assert.strictEqual(JSON.stringify(s.result), JSON.stringify(A.evaluate(V2.downConvertToA(s.lastRequest))));
    h.set('lcBasis', '30d_recording_exception'); h.set('lcAnnualData', 'no'); h.set('lcPeriodDays', '30'); h.set('lcIntervalMinutes', '15'); h.set('lcContinuousRecording', 'yes'); h.set('lcConnectedTo', 'highest_loaded_conductor'); for (const id of ['lcBasedOnInitialLoading', 'lcRecordedWhileOccupied', 'lcIncludesLargerOfHeatingOrCooling', 'lcIncludesPeriodicSeasonalLoads']) h.set(id, 'yes'); h.set('lcHasRenewableEnergySystem', 'no'); h.set('lcHasPeakLoadShaving', 'no');
    s = h.state(); assert.strictEqual(JSON.stringify(s.result), JSON.stringify(A.evaluate(V2.downConvertToA(s.lastRequest))), 'the 30-day route is byte-equal to direct A: ' + s.result.status);
  });
  test('A→82→A keeps the measurement untouched; guide vs manual rules; the 82 data survives on the A route (dormant, never stripped)', () => {
    const h = buildHarness(); h.api.lcInit(); annual(h); const meas = JSON.stringify(h.state().snapshot.measurement);
    h.set('lcMethod', 'opt_220_82'); h.set('lcFloorArea', '1500'); h.set('lcArrangement', 'ac_only'); let s = h.state(); assert.strictEqual(s.result.profileId, 'B82_core1'); assert.strictEqual(JSON.stringify(s.snapshot.measurement), meas);
    h.set('lcMethod', 'measured_220_87'); s = h.state(); assert.strictEqual(s.result.status, 'COMPLETE'); assert.strictEqual(JSON.stringify(s.snapshot.measurement), meas); assert.strictEqual(s.snapshot.dwelling.floorAreaFt2, 1500, '82 data retained'); assert.strictEqual(s.snapshot.hvac.arrangement, 'ac_only');
    assert.strictEqual(JSON.stringify(s.result), JSON.stringify(A.evaluate(V2.downConvertToA(s.lastRequest)))); assert.ok(/RETAINED DATA FOR OTHER METHODS/.test(h.$('lcRetained').textContent) && /Floor area: 1500/.test(h.$('lcRetained').textContent));
    h.set('lcHouseFeeder', 'yes100'); h.set('lcHouseState', 'new'); s = h.state(); assert.strictEqual(s.snapshot.method.guideRecommendation, 'opt_220_82'); assert.strictEqual(s.snapshot.method.selected, 'measured_220_87', 'a manual selection is not overwritten by the recommendation'); assert.ok(/Guide suggests/.test(h.$('lcGuideResult').textContent) && /not a declaration/.test(h.$('lcGuideResult').textContent));
    h.set('lcMethod', ''); h.set('lcHouseState', 'meter'); s = h.state(); assert.deepStrictEqual([s.snapshot.method.selected, s.snapshot.method.selectionSource], ['measured_220_87', 'guide']);
    h.set('lcOccupancy', ''); s = h.state(); assert.strictEqual(s.snapshot.method.selected, null, 'a guide-selected method is cleared with the occupancy'); assert.strictEqual(s.snapshot.dwelling.floorAreaFt2, 1500, 'answers survive the occupancy change'); assert.strictEqual(s.snapshot.schemaVersion, '3.3.0');
  });
  test('the frozen direct-A accounting is unchanged: loadcalc-core-check reports 125 exact + the same 3 diagnostic differences', () => {
    const r = spawnSync('node', [path.join(ROOT, 'tools', 'loadcalc-core-check.js'), '--out', fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'))], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /exact match: 125 \| differs only on \$\.diagnostics\.continuityOfNewLoadKnown: 3 \[T-S-16, T-S-40s, T-S-40s\/then\[0\]\] \| other mismatches: 0/);
  });
});

describe('F. output families — both PARTIAL families, EVSE + withheld A/C, demand without current, cleared/fault after COMPLETE, inert text, no duplicated sends', () => {
  test('B0 + EVSE: two distinct demand problems (CATEGORY_UNSUPPORTED_IN_METHOD for the EVSE, HVAC_WITHHELD_PARTIAL for the A/C); the A/C is withheld, never zero; subtotal labelled as general-load only', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h); addLoad(h, PRESET.evse, 7200); h.set('lcInventoryComplete', 'yes');
    const s = h.state(); assert.strictEqual(s.result.status, 'PARTIAL'); assert.strictEqual(s.result.demand.partialSubtotalVA, 18680);
    const dem = s.result.problems.filter((p) => p.layer === 'demand').map((p) => p.code + '@' + p.field).sort(); assert.deepStrictEqual(dem, ['LOAD_UNRESOLVED@loads[4]', 'LOAD_UNRESOLVED@loads[5]']);
    const cov = Object.fromEntries(s.result.loadsCoverage.map((c) => [c.loadId, c])); assert.strictEqual(cov.L6.reason, 'CATEGORY_UNSUPPORTED_IN_METHOD'); assert.strictEqual(cov.L5.reason, 'HVAC_WITHHELD_PARTIAL'); assert.strictEqual(cov.L5.demandVA, null, 'withheld, not zero'); assert.strictEqual(cov.L5.connectedVA, 5000);
    const t = shown(h); assert.ok(/GENERAL-LOAD SUBTOTAL/.test(t) && /NOT the whole-dwelling demand/.test(t) && !/Total demand|Line current/.test(t)); assert.ok(/A\/C withheld/.test(t) && /category not computed by 220\.82/.test(t)); assert.ok(/LOAD COVERAGE \(6\)/.test(t));
    assert.ok(/A\/C withheld/.test(t) && !/A\/C Unit — .*demand 0 VA/.test(t), 'the withheld A/C never shows a zero demand');
  });
  test('PARTIAL without subtotal (negative dryer inclusion) shows no lines; demand without current on the 120/208 network case; cleared status and adapter fault after a previous COMPLETE leave no stale total', () => {
    const h = buildHarness(); h.api.lcInit(); const c = driveB0(h); assert.ok(/Total demand: 23,680 VA/.test(shown(h)));
    setIn(ctl(c.dryer, 'inclusion'), 'on_counted_laundry_circuit'); let s = h.state(); assert.strictEqual(s.result.status, 'PARTIAL'); assert.strictEqual(s.result.demand.partialSubtotalVA, null); assert.deepStrictEqual(s.result.demand.lines, []); assert.ok(!/Total demand|SUBTOTAL of the resolved|Line current/.test(shown(h)));
    setIn(ctl(c.dryer, 'inclusion'), 'not_on_counted_laundry_circuit'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.set('lcTopology', '1ph_3w_120_208_network'); h.set('lcModel', 'split_240_balanced_LN'); s = h.state();
    assert.strictEqual(s.result.status, 'COMPLETE', codes(s.result).join()); assert.strictEqual(s.result.demand.totalVA, 23680); assert.strictEqual(s.result.current.status, 'not_computed'); assert.ok(codes(s.result).includes('MODEL_UNSUPPORTED@loadModel.kind'));
    const t = shown(h); assert.ok(/Total demand: 23,680 VA/.test(t) && /CURRENT — NOT COMPUTED/.test(t) && !/Line current/.test(t) && /current layer/.test(t), 'VA shown, no zero/old current, no invented model');
    h.set('lcTopology', '1ph_3w_120_240'); h.set('lcModel', 'split_240_balanced_LN'); h.set('lcDeclBalancedLN', 'yes'); assert.strictEqual(h.state().result.status, 'COMPLETE'); assert.ok(/Line current/.test(shown(h)));
    h.set('lcArrangement', ''); s = h.state(); assert.strictEqual(s.result.status, 'INCOMPLETE_INPUT'); assert.ok(!/Total demand|Line current|23,680/.test(shown(h)), 'cleared status: no stale operative total');
    h.set('lcArrangement', 'ac_only'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.api.LC.snapshot.loads[1].id = 'L1'; h.api.lcUpdate(); s = h.state(); assert.strictEqual(s.result, null); assert.strictEqual(s.fault.kind, 'input'); assert.ok(/INPUT REJECTED/.test(shown(h)) && !/23,680/.test(shown(h)), 'a rejected duplicate-id draft shows no old total');
    assert.strictEqual(h.$('lcLoads').querySelectorAll('input').length, 0, 'read-only view'); h.api.lcUpdate(); h.api.lcUpdate(); assert.strictEqual(h.api.LC.cardsInvalid, true);
  });
  test('coverage, problem and rule references use the source-aware pathway: NEC 2020 and NYCEC 2025 are distinct targets; one send per click; hostile labels/notes stay inert text', () => {
    const h = buildHarness(); h.api.lcInit(); const c = driveB0(h); const evil = '<img src=x onerror=alert(1)> 220.82 <script>x</script>';
    setIn(ctl(c.range, 'label'), evil); calc(h); assert.strictEqual(h.state().result.status, 'COMPLETE');
    assert.ok(!h.nodes().some((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT')); assert.strictEqual(h.nodes().reduce((a, n) => a + n.innerHTMLWrites, 0), 0);
    assert.ok(h.nodes().some((n) => n._classes.has('lc-problem-field') && n.textContent === evil), 'the label appears as literal text in the coverage list'); assert.ok(!h.nodes().some((n) => (n._classes.has('nec-link') || n._classes.has('nycec-link')) && n.textContent.includes('<img')));
    const links = h.nodes().filter((n) => n._classes.has('nec-link') || n._classes.has('nycec-link'));
    assert.ok(links.every((n) => n.attrs.onclick === undefined && (n.listeners.click || []).length === 0 && typeof n.attrs['data-ref'] === 'string'), 'delegated handler only');
    const nec = links.find((n) => n._classes.has('nec-link') && n.attrs['data-sec'] === '220.82'); nec.dispatch('click'); assert.strictEqual(h.necCalls.length, 1); assert.ok(/^NEC 2020 220\.82/.test(h.necCalls[0]));
    h.set('lcNycAcCircuits', '1'); calc(h); assert.strictEqual(h.state().result.status, 'BLOCKED_PENDING_RULE');   // the NYC A/C circuit interpretation is pending: its problem carries the NYCEC target
    const nyc = h.nodes().filter((n) => n._classes.has('nycec-link') && n.attrs['data-sec'] === '220.14(N)')[0]; assert.ok(nyc, 'the NYC A/C circuit rule carries its NYCEC target'); nyc.dispatch('click'); assert.strictEqual(h.necCalls.length, 2); assert.ok(/^NYCEC 2025 amendment to NEC 220\.14\(N\)/.test(h.necCalls[1]));
    h.set('lcNycAcCircuits', '0'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    assert.ok(!links.some((n) => n._classes.has('nycec-link') && n.attrs['data-sec'] === '220.82(B)(3)'), 'no fabricated NYC amendment for an unamended rule');
    const before = h.state().evaluations; nec.dispatch('click'); assert.strictEqual(h.state().evaluations, before, 'a reference click never recomputes');
  });
});

describe('H. dependency — the generated bundle exposes every accepted module; a missing module is a clear failure, never a fallback to the old engine', () => {
  test('window.EC exposes the eight modules and the same accepted logic as require()', () => {
    const h = buildHarness();
    for (const id of ['loadCalc', 'loadCalcInput', 'loadCalcState', 'loadCalcInputV2', 'loadCalcOpt82', 'loadCalcFacade', 'loadCalcStateV2', 'loadCalcStorageV2']) assert.ok(h.EC[id], id);
    assert.strictEqual(JSON.stringify(h.EC.loadCalcFacade.evaluateV2(B0P).result), JSON.stringify(F.evaluateV2(B0P).result));
    assert.deepStrictEqual(h.EC.loadCalcStateV2.OWNED_SCALAR_PATHS, require('../src/calc/loadCalcStateV2.js').OWNED_SCALAR_PATHS);
    assert.strictEqual((html.match(/window\.EC = \(function \(\)/g) || []).length, 1, 'one generated block');
  });
  test('a missing accepted module fails clearly (no form, explicit message naming the module); the old A engine is never called silently', () => {
    for (const missing of ['loadCalcFacade', 'loadCalcStateV2', 'loadCalcStorageV2', 'loadCalcOpt82']) {
      const h = buildHarness({ missing: [missing] }); h.api.lcInit();
      assert.ok(!h.$('lcForm'), missing + ': the form is not built'); assert.ok(new RegExp('not available in this build .*' + missing).test(h.dom.container.textContent), h.dom.container.textContent);
      assert.strictEqual(h.state().result, null); assert.strictEqual(h.state().evaluations, 0);
    }
  });
});

// ── LC-22082-B0-UI-INTEGRATION-1-R1 ───────────────────────────────────────────────────────────────────────
// U2 (a valid explicit answer clears only its own parser error), U3 (safe own-key basis allocation on import)
// and U4 (correct source targets, AI context titles, controlled help linking, honest capability label).

describe('R1 / U2 — a valid explicit answer clears ONLY its applicable parser error; every other entry survives', () => {
  const SLOTS = [
    ['loads[2].inclusion82', (h) => ({ map: 'loadErrors', id: 'L3', sub: 'inclusion82' }), (h) => setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit')],
    ['loads[4].ratingCoverage82', () => ({ map: 'loadErrors', id: 'L5', sub: 'ratingCoverage82' }), (h) => setIn(ctl(cards(h)[4], 'coverage'), 'yes')],
    ['optional82.inventoryComplete', () => ({ map: 'fieldErrors', path: 'optional82.inventoryComplete' }), (h) => h.set('lcInventoryComplete', 'yes')],
    ['optional82.singleSupplySet', () => ({ map: 'fieldErrors', path: 'optional82.singleSupplySet' }), (h) => h.set('lcSingleSupplySet', 'yes')],
    ['optional82.nycAcCentralExceptionAttested', () => ({ map: 'fieldErrors', path: 'optional82.nycAcCentralExceptionAttested' }), (h) => h.set('lcNycAcException', 'yes')]
  ];
  /** a complete B0 saved as an lcv-3 record carrying exactly one parser error in the given slot, plus one unrelated error */
  function seedWithError(slot, second) {
    const h = buildHarness({ promptAnswer: 'err' }); h.api.lcInit(); driveB0(h);
    const p = h.api.lcFavPayload();
    const s = slot(h);
    if (s.map === 'loadErrors') p.loadErrors[s.id] = { [s.sub]: { raw: '?', code: 'UNKNOWN_ENUM' } };
    else p.fieldErrors[s.path] = { raw: '?', code: 'UNKNOWN_ENUM' };
    if (second) p.fieldErrors['dwelling.floorAreaFt2'] = { raw: '15oo', code: 'NOT_FINITE' };
    const g = buildHarness({ storage: JSON.stringify({ lc: [{ id: 4, name: 'error draft', vals: p }] }), promptAnswer: 'fixed' }); g.api.lcInit();
    g.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    assert.strictEqual(g.state().fault, null, 'the error-bearing record restores');
    return g;
  }
  for (const [field, slot, answer] of SLOTS) {
    test(`${field}: the restored parser error is removed by the explicit answer through its real control; the unrelated error stays and still blocks`, () => {
      const h = seedWithError(slot, true); const s = slot(h);
      const before = h.state();
      assert.strictEqual(before.result.status, 'INVALID_INPUT'); assert.ok(codes(before.result).includes('UNKNOWN_ENUM@' + field), codes(before.result).join());
      answer(h); const after = h.state();
      const entry = s.map === 'loadErrors' ? (after.loadErrors[s.id] || {})[s.sub] : after.fieldErrors[s.path];
      assert.strictEqual(entry, undefined, 'the corrected slot no longer carries an error: ' + JSON.stringify(after.loadErrors) + JSON.stringify(after.fieldErrors));
      assert.ok(!codes(after.result).includes('UNKNOWN_ENUM@' + field), codes(after.result).join());
      assert.deepStrictEqual(after.fieldErrors['dwelling.floorAreaFt2'], { raw: '15oo', code: 'NOT_FINITE' }, 'the unrelated error is preserved');
      assert.strictEqual(after.result.status, 'INVALID_INPUT', 'the draft is still invalid because of the OTHER error');
      assert.strictEqual(after.sourceFavId, before.sourceFavId); assert.deepStrictEqual(after.context, before.context);
      assert.deepStrictEqual(after.snapshot.loads.map((l) => l.id), before.snapshot.loads.map((l) => l.id));
      assert.deepStrictEqual(after.snapshot.loads.map((l) => l.basisId), before.snapshot.loads.map((l) => l.basisId));
    });
    test(`${field}: with no other error the positive answer recovers COMPLETE 23,680 VA; the negative/unanswered states keep their own engine outcome (never auto-true)`, () => {
      const h = seedWithError(slot, false); const s = slot(h);
      answer(h); let st = h.state();
      assert.strictEqual(st.result.status, 'COMPLETE', codes(st.result).join()); assert.strictEqual(st.result.demand.totalVA, 23680);
      // unanswered: a valid state with its own outcome, no error resurrected
      if (s.map === 'loadErrors') setIn(ctl(cards(h)[s.id === 'L3' ? 2 : 4], s.sub === 'inclusion82' ? 'inclusion' : 'coverage'), '');
      else h.set(field === 'optional82.inventoryComplete' ? 'lcInventoryComplete' : field === 'optional82.singleSupplySet' ? 'lcSingleSupplySet' : 'lcNycAcException', '');
      st = h.state();
      const entry = s.map === 'loadErrors' ? (st.loadErrors[s.id] || {})[s.sub] : st.fieldErrors[s.path];
      assert.strictEqual(entry, undefined, 'unanswered is a state, not a parse error');
      assert.notStrictEqual(st.result.status, 'COMPLETE', 'an unanswered premise is never treated as attested: ' + codes(st.result).join());
      assert.ok(codes(st.result).some((c) => /MISSING_FIELD|QUALIFICATION_UNKNOWN|RULE_PENDING/.test(c)), codes(st.result).join());
    });
  }
  test('the corrected maps survive Save and a fresh-document restore; the source Favorite is never modified; no double listener and no caret loss', () => {
    const h = seedWithError(SLOTS[0][1], true); const sourceBytes = h.store.data;
    setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit');
    const lbl = ctl(cards(h)[2], 'label'); lbl.value = 'Dryer A'; lbl.selectionStart = 7; lbl.dispatch('input');
    assert.strictEqual(ctl(cards(h)[2], 'label'), lbl, 'the input element survives (no rebuild on an answer)'); assert.strictEqual(lbl.selectionStart, 7);
    assert.strictEqual((lbl.listeners.input || []).length, 1, 'exactly one input listener'); assert.strictEqual((ctl(cards(h)[2], 'inclusion').listeners.change || []).length, 1);
    h.set('lcFloorArea', '1500'); assert.strictEqual(h.state().result.status, 'COMPLETE');
    h.prompts.answer = 'corrected'; assert.strictEqual(h.api.lcFavSave(), true);
    const all = JSON.parse(h.store.data); assert.strictEqual(all.lc.length, 2);
    assert.strictEqual(JSON.stringify(all.lc[0]), JSON.stringify(JSON.parse(sourceBytes).lc[0]), 'the source record is untouched');
    assert.deepStrictEqual(all.lc[1].vals.loadErrors, {}); assert.deepStrictEqual(all.lc[1].vals.fieldErrors, {});
    const g = buildHarness({ storage: h.store.data }); g.api.lcInit(); g.$('lc-fav-list').querySelectorAll('.fav-item')[1].dispatch('click');
    assert.strictEqual(g.state().fault, null); assert.strictEqual(g.state().result.status, 'COMPLETE'); assert.deepStrictEqual(g.state().loadErrors, {});
  });
  test('restore, render, the guide recommendation and a method switch never clear an error on their own; a malformed map still refuses', () => {
    const h = seedWithError(SLOTS[2][1], false); const before = JSON.stringify(h.state().fieldErrors);
    h.api.lcUpdate(); h.set('lcHouseFeeder', 'yes100'); h.set('lcHouseState', 'new'); h.set('lcMethod', 'measured_220_87'); h.set('lcMethod', 'opt_220_82');
    assert.strictEqual(JSON.stringify(h.state().fieldErrors), before, 'nothing but an explicit answer clears the entry');
    const p = h.api.lcFavPayload(); p.fieldErrors = [];
    const draft = JSON.stringify(h.state().snapshot);
    h.store.data = JSON.stringify({ lc: [{ id: 8, name: 'malformed', vals: p }] }); h.api.favRender('lc'); h.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    assert.strictEqual(h.state().fault.kind, 'restore'); assert.ok(/lcv-3 contract/.test(h.state().fault.message)); assert.strictEqual(JSON.stringify(h.state().snapshot), draft);
  });
  test('shared A declaration controls follow the same lifecycle: the answer clears its own entry only', () => {
    const h = buildHarness(); h.api.lcInit();
    for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcReadingValue', '40000'], ['lcNewLoadMode', 'none'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes']]) h.set(id, v);
    assert.strictEqual(h.state().result.status, 'COMPLETE');
    const p = h.api.lcFavPayload();
    p.fieldErrors['measurement.existing.serviceOverloadPer230_90'] = { raw: '?', code: 'UNKNOWN_ENUM' };
    p.fieldErrors['measurement.annualDataAvailable'] = { raw: '?', code: 'UNKNOWN_ENUM' };
    const g = buildHarness({ storage: JSON.stringify({ lc: [{ id: 2, name: 'A errors', vals: p }] }) }); g.api.lcInit(); g.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    assert.strictEqual(g.state().fault, null); assert.strictEqual(g.state().result.status, 'INVALID_INPUT');
    g.set('lcServiceOverload', 'yes');
    assert.strictEqual(g.state().fieldErrors['measurement.existing.serviceOverloadPer230_90'], undefined);
    assert.deepStrictEqual(g.state().fieldErrors['measurement.annualDataAvailable'], { raw: '?', code: 'UNKNOWN_ENUM' }, 'the other A declaration keeps its error');
    g.set('lcAnnualData', 'yes'); assert.strictEqual(g.state().result.status, 'COMPLETE');
  });
  test('a hostile value that is not a valid option still produces the parser error (the clear is not unconditional)', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    const el = h.$('lcSingleSupplySet'); el.value = 'YES'; el.dispatch('change');
    assert.deepStrictEqual(h.state().fieldErrors['optional82.singleSupplySet'], { raw: 'YES', code: 'UNKNOWN_ENUM' });
    assert.strictEqual(h.state().snapshot.optional82.singleSupplySet.value, null, 'no invented certification');
    assert.strictEqual(h.state().result.status, 'INVALID_INPUT');
    h.set('lcSingleSupplySet', 'yes'); assert.strictEqual(h.state().fieldErrors['optional82.singleSupplySet'], undefined); assert.strictEqual(h.state().result.status, 'COMPLETE');
  });
});

describe('R1 / U3 — basisIdByLoadId is an own-key map: special record ids import through the real UI path', () => {
  function lcv2With(id, extraErrors) {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    const good = h.api.lcFavPayload(); const aSnap = V2.downConvertToA({ snapshot: good.snapshot, parseErrors: [] }).snapshot;
    aSnap.loads[0].id = id;
    return { lcv: 2, profileId: 'A_measured_87_core', snapshot: aSnap, fieldErrors: Object.assign({}, extraErrors || {}), loadErrors: {}, sourceFavId: null };
  }
  for (const id of ['__proto__', 'constructor', 'hasOwnProperty', 'L9']) {
    test(`old lcv-2 record whose first record id is "${id}" imports through the real row click: fresh own-key basis ids, unique, unconfirmed premises`, () => {
      const vals = lcv2With(id);
      const seed = JSON.stringify({ lc: [{ id: 700, name: 'old ' + id, vals }] });
      const h = buildHarness({ storage: seed }); h.api.lcInit(); h.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
      const s = h.state();
      assert.strictEqual(s.fault, null, s.fault && JSON.stringify(s.fault.details));
      assert.deepStrictEqual(s.snapshot.loads.map((l) => l.id), [id, 'L2', 'L3', 'L4', 'L5']);
      assert.deepStrictEqual(s.snapshot.loads.map((l) => l.basisId), ['bs-' + id + '-1', 'bs-L2-1', 'bs-L3-1', 'bs-L4-1', 'bs-L5-1']);
      assert.strictEqual(new Set(s.snapshot.loads.map((l) => l.basisId)).size, 5, 'basis ids are unique');
      assert.strictEqual(Object.prototype['bs-' + id + '-1'], undefined); assert.strictEqual(({})['bs-' + id + '-1'], undefined, 'nothing was written onto Object.prototype');
      assert.strictEqual(s.context.methodConfirmedAfterImport, false); assert.deepStrictEqual(s.context.importedFrom, { lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' });
      assert.strictEqual(s.sourceFavId, vals.sourceFavId, 'an lcv-2 payload carries its own sourceFavId through the upgrade (null here)'); assert.notStrictEqual(s.result.status, 'COMPLETE', 'a successful import is not a complete electrical result: ' + codes(s.result).join());
      assert.ok(s.snapshot.loads.every((l) => l.inclusion82 === null && l.ratingCoverage82 === null), 'premises come back unanswered');
      assert.strictEqual(h.store.data, seed, 'the stored record is untouched');
      // the restored draft is editable and the record can be answered normally
      setIn(ctl(cards(h)[2], 'inclusion'), 'not_on_counted_laundry_circuit'); assert.strictEqual(h.state().fault, null);
    });
  }
  test('a special-id record that also carries an attributable error map keeps the entry under its own key', () => {
    const vals = lcv2With('__proto__', { 'measurement.periodMonths': { raw: '12x', code: 'NOT_FINITE' } });
    const h = buildHarness({ storage: JSON.stringify({ lc: [{ id: 701, name: 'old proto + error', vals }] }) }); h.api.lcInit();
    h.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
    const s = h.state(); assert.strictEqual(s.fault, null);
    assert.deepStrictEqual(s.fieldErrors['measurement.periodMonths'], { raw: '12x', code: 'NOT_FINITE' });
    assert.ok(Object.hasOwn(s.snapshot.loads[0], 'basisId')); assert.strictEqual(s.snapshot.loads[0].basisId, 'bs-__proto__-1');
  });
  test('the existing distinct refusals are unchanged: duplicate ids, unknown version, old-valid unrepresentable literal loads[] errors', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h); const before = JSON.stringify(h.state().snapshot);
    const dup = lcv2With('__proto__'); dup.snapshot.loads[1] = Object.assign({}, dup.snapshot.loads[1], { id: '__proto__' });
    const unrep = lcv2With('__proto__'); unrep.fieldErrors = { 'loads[].quantity': { raw: '', code: 'MISSING_FIELD' } };
    const cases = [['duplicate ids', dup, /not a valid lcv-2 record/], ['unknown version', { lcv: 42, snapshot: {} }, /unsupported Load Calc version/], ['unrepresentable literal', unrep, /cannot be converted losslessly/]];
    for (const [label, vals, re] of cases) {
      const seed = JSON.stringify({ lc: [{ id: 9, name: label, vals }] }); h.store.data = seed; h.api.favRender('lc');
      h.$('lc-fav-list').querySelector('.fav-item').dispatch('click');
      const s = h.state(); assert.strictEqual(s.fault && s.fault.kind, 'restore', label); assert.ok(re.test(s.fault.message), label + ': ' + s.fault.message);
      assert.strictEqual(JSON.stringify(s.snapshot), before, label); assert.strictEqual(h.store.data, seed, label);
    }
  });
});

describe('R1 / U4 — source targets, AI context titles, controlled help linking and the honest capability label', () => {
  const links = (h) => h.nodes().filter((n) => n._classes.has('nec-link') || n._classes.has('nycec-link'));
  const find = (h, src, sec) => links(h).filter((n) => n._classes.has(src === 'nycec' ? 'nycec-link' : 'nec-link') && n.attrs['data-sec'] === sec);
  test('the two NYC provisions in the 220.82 help offer BOTH the NEC 2020 target and the NYCEC 2025 target; each sends once with its own source/edition/section', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82');
    for (const sec of ['210.11(C)(5)', '210.52(J)']) {
      const nec = find(h, 'nec', sec); const nyc = find(h, 'nycec', sec);
      assert.strictEqual(nec.length, 1, sec + ': one NEC target'); assert.strictEqual(nyc.length, 1, sec + ': one NYCEC target');
      assert.deepStrictEqual([nyc[0].attrs['data-src'], nyc[0].attrs['data-ed'], nyc[0].attrs['data-sec']], ['nycec', '2025', sec]);
      assert.deepStrictEqual([nec[0].attrs['data-src'], nec[0].attrs['data-ed'], nec[0].attrs['data-sec']], ['nec', '2020', sec]);
      const n0 = h.necCallsFull.length;
      nyc[0].dispatch('click');
      assert.strictEqual(h.necCallsFull.length, n0 + 1, sec + ': exactly one send per click');
      const call = h.necCallsFull[n0];
      assert.deepStrictEqual([call.opts.source, call.opts.edition, call.opts.section], ['nycec', '2025', sec]);
      assert.ok(/^NYCEC 2025 amendment to NEC /.test(call.ref) && call.ref.includes(sec), call.ref);
      assert.ok(/220\.82/.test(call.opts.title) && !/220\.87/.test(call.opts.title), sec + ': the AI context describes the current 220.82 task, not 220.87 — ' + call.opts.title);
      assert.ok(/NYCEC 2025/.test(call.question), call.question.slice(0, 120));
      // keyboard operation sends the same target once
      const n1 = h.necCallsFull.length; nyc[0].dispatch('keydown', { key: 'Enter' });
      assert.strictEqual(h.necCallsFull.length, n1 + 1, sec + ': Enter opens the reference');
      assert.deepStrictEqual(h.necCallsFull[n1].opts.section, sec); assert.strictEqual(nyc[0].attrs.role, 'button'); assert.strictEqual(nyc[0].attrs.tabindex, '0');
    }
    assert.strictEqual(find(h, 'nycec', '220.82').length, 0, 'no NYC amendment is manufactured for an unamended rule');
    assert.strictEqual(find(h, 'nycec', '220.82(A)').length, 0);
  });
  test('a NEC-only controlled reference keeps source=nec/2020 and the 220.82 context; the A route keeps the 220.87 context', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82');
    const nec = find(h, 'nec', '220.82(A)')[0]; assert.ok(nec); nec.dispatch('click');
    const c = h.necCallsFull[h.necCallsFull.length - 1];
    assert.deepStrictEqual([c.opts.source, c.opts.edition, c.opts.section], ['nec', '2020', '220.82(A)']); assert.ok(/220\.82/.test(c.opts.title));
    const g = buildHarness(); g.api.lcInit(); g.set('lcOccupancy', 'dwelling_unit_house'); g.set('lcMethod', 'measured_220_87');
    const a = find(g, 'nec', '220.87')[0]; assert.ok(a); a.dispatch('click');
    const ca = g.necCallsFull[g.necCallsFull.length - 1];
    assert.ok(/220\.87/.test(ca.opts.title), 'the A route context is unchanged: ' + ca.opts.title);
    const an = find(g, 'nycec', '220.87')[0]; assert.ok(an, 'the 220.87 NYC amendment target is still offered'); an.dispatch('click');
    assert.strictEqual(g.necCallsFull[g.necCallsFull.length - 1].opts.source, 'nycec');
  });
  test('the per-record inclusion help renders real, keyboard-operable 220.82 targets (not plain text) with full section context', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    const hint = cards(h)[2].querySelectorAll('div').filter((d) => d._classes.has('lc-hint') && /laundry circuit/.test(d.textContent))[0];
    assert.ok(hint, 'the dryer inclusion help is present');
    const refs = hint.querySelectorAll('span').filter((n) => n._classes.has('nec-link') || n._classes.has('nycec-link'));
    assert.deepStrictEqual(refs.map((n) => n.attrs['data-sec']).sort(), ['220.82(B)(2)', '220.82(B)(3)(c)'], 'both references are linked, with the full section written out');
    assert.ok(refs.every((n) => n.attrs.role === 'button' && n.attrs.tabindex === '0' && typeof n.attrs['data-ref'] === 'string' && n.attrs.onclick === undefined));
    const n0 = h.necCallsFull.length; refs[0].dispatch('click');
    assert.strictEqual(h.necCallsFull.length, n0 + 1); assert.ok(/220\.82/.test(h.necCallsFull[n0].opts.title));
    assert.ok(!/\(B\)\(3\)\(c\)<|<span/.test(hint.textContent));
    const before = h.state().evaluations; refs[0].dispatch('click');
    assert.strictEqual(h.state().evaluations, before, 'opening a reference never recomputes or changes the rule basis');
    assert.strictEqual(h.state().snapshot.loads[2].basisId, 'bs-L3-1');
  });
  test('user text stays inert data: a hostile label/note is never linked or executed even when it contains code-like numbers', () => {
    const h = buildHarness(); h.api.lcInit(); driveB0(h);
    const evil = '<img src=x onerror=alert(1)> see 210.52(J) (NYC 2025 amended) <script>x</script>';
    setIn(ctl(cards(h)[0], 'label'), evil); calc(h);
    assert.strictEqual(h.state().snapshot.loads[0].label, evil);
    assert.ok(!h.nodes().some((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT'));
    assert.strictEqual(h.nodes().reduce((a, n) => a + n.innerHTMLWrites, 0), 0);
    const labelled = h.nodes().filter((n) => (n._classes.has('nec-link') || n._classes.has('nycec-link')) && n.textContent.includes('<img'));
    assert.strictEqual(labelled.length, 0, 'the hostile label is not auto-linked');
    assert.ok(h.nodes().some((n) => n._classes.has('lc-problem-field') && n.textContent === evil) || cards(h)[0].textContent.includes(evil), 'it appears as literal text');
  });
  test('the method menu states the actual bounded capability instead of "not available in this profile"', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcOccupancy', 'dwelling_unit_house');
    const opts = Object.fromEntries(h.$('lcMethod').children.map((c) => [c.value, c.textContent]));
    assert.ok(/LIMITED/.test(opts.opt_220_82) && !/not available in this profile/.test(opts.opt_220_82), opts.opt_220_82);
    assert.ok(/one dwelling unit/.test(opts.opt_220_82) && /A\/C-only/.test(opts.opt_220_82), 'the label does not imply full 220.82 / HVAC support');
    for (const m of ['existing_220_83', 'multifamily_220_84', 'standard_part_III']) assert.ok(/not available in this profile/.test(opts[m]), m + ' stays unavailable');
    assert.ok(/ACTIVE/.test(opts.measured_220_87));
  });
});
