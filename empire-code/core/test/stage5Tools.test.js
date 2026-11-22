'use strict';
/**
 * STAGE5 — conversational calculator registry (docs/conversation-tools-contract.md).
 *
 * Authored for coordinator execution; no worker test run is claimed.
 * Parity rule: every supported tool is compared with a DIRECT call of its canonical engine export (the engine is the
 * oracle; no formula is restated here). Literal expectations are the audited figures named in the stage-5 brief
 * (20 h 24 min, 10 h 12 min, #12, #8 at 2.60 %, #2, 23 680 VA, 175 A, 85 / 90 A). Load Calc requests are the real LC82
 * fixtures, edited exactly as test/stage4Qualification.test.js does.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CT = require('../src/calc/conversationTools.js');
const battery = require('../src/calc/batteryRuntime.js');
const { selectConductor } = require('../src/calc/wireSizing.js');
const { calculateAmpacity } = require('../src/calc/ampacity.js');
const { calculateVoltageDrop } = require('../src/calc/voltageDrop.js');
const conduit = require('../src/calc/conduitFill.js');
const { calculateBoxFill } = require('../src/calc/boxFill.js');
const { calculateMotorCircuit } = require('../src/calc/motor.js');
const { calculateGrounding } = require('../src/calc/grounding.js');
const { calculatePullBox } = require('../src/calc/pullBox.js');
const F = require('../src/calc/loadCalcFacade.js');
const S = require('../src/calc/loadCalcServiceSizing.js');
const { deepFreeze, clone } = require('./helpers/loadCalcFixtures.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'calc', 'conversationTools.js'), 'utf8');
const LC82 = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'LC82-cases-r1.json'), 'utf8'));
const B0 = () => { const c = LC82.cases.find((x) => x.id === 'LC82-B0P'); assert.ok(c, 'fixture LC82-B0P'); return clone(c.request); };
const B0unknown = () => { const r = B0(); r.snapshot.optional82.conductorAmpacityA.value = null; return r; };
const PLAN = { intent: 'new_design_candidate', oneMainDisconnect: true, noAdditionalSources: true, wholeDwelling: true, singleConductorSet: true };
const COND = { sizingPath: 'general_table_75C', material: 'Cu', terminationTempRatingC: 75, terminationMaterialCompatible: true, insulationTempRatingC: 75, ambientTempC: 30, currentCarryingConductors: 3, wiringMethod: 'single_insulated_conductors_in_raceway', noOtherAdjustmentOrCorrection: true };
const design = (selected, condPatch) => ({ selectedMainRatingA: selected, plan: Object.assign({}, PLAN), conductor: Object.assign({}, COND, condPatch || {}) });
const DWELLING = { sizingPath: 'dwelling_83pct_310_12' };

const codes = (list) => list.map((e) => e.code);
const fields = (list) => list.map((e) => e.field);
const FORM = { origin: 'current_form' };
/** Run a tool and assert the invariants every registry result must keep. */
function run(tool, input, options) {
  const frozen = deepFreeze(clone(input)); const before = JSON.stringify(frozen);
  const out = CT.run(tool, frozen, options);
  assert.equal(JSON.stringify(frozen), before, 'caller input not mutated');
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  const r = out.result;
  assert.equal(r.kind, CT.RESULT_KIND); assert.equal(r.tool, tool); assert.ok(Object.values(CT.STATUS).includes(r.status), r.status);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(out.draft) && Object.isFrozen(r.normalizedInput));
  assert.equal(r.flags.installationApproved, false); assert.equal(r.flags.approval, 'none'); assert.equal(r.flags.serviceSizingRecord, false); assert.equal(r.flags.persistence, 'conversation_only');
  assert.equal(r.inputFingerprint, out.draft.fingerprint); assert.equal(out.draft.result, r);
  if (!r.engine.called) { assert.equal(r.coreResult, null); assert.equal(r.engine.args, null); }
  assert.ok(Array.isArray(r.summary) && r.summary.length > 0 && r.summary.every((s) => typeof s.pl === 'string' && typeof s.en === 'string'));
  assert.ok(CT.formatResult(r, 'pl').includes(CT.STATUS_LABEL[r.status].pl)); assert.ok(CT.formatResult(r, 'en').includes(CT.STATUS_LABEL[r.status].en));
  return out;
}
const result = (tool, input, options) => run(tool, input, options).result;
const needs = (r, ...names) => { assert.equal(r.status, 'needs_input', JSON.stringify(r.summary)); assert.equal(r.engine.called, false); for (const n of names) { const q = r.needsInput.find((x) => x.field === n); assert.ok(q, `question for ${n}`); assert.ok(q.question.pl.length > 0 && q.question.en.length > 0); } };

describe('STAGE5 — catalogue, schemas, purity', () => {
  const EXECUTABLE = ['battery_runtime', 'wire_sizing', 'ampacity', 'voltage_drop', 'conduit_fill', 'conduit_fill_mixed', 'wireway_fill', 'box_fill', 'motor_circuit', 'grounding', 'pull_box', 'load_calc', 'load_calc_preliminary', 'service_sizing', 'service_sizing_preliminary'];
  test('every supported engine is in the allowlist; Power / Torque / Bender are navigation-only and never execute', () => {
    assert.deepEqual(CT.TOOL_IDS.slice().sort(), EXECUTABLE.slice().sort());
    for (const id of EXECUTABLE) { const t = CT.getTool(id); assert.equal(t.executable, true); assert.equal(typeof t.engine.fn, 'string'); assert.ok(Object.isFrozen(t)); }
    for (const id of ['power', 'torque', 'bender']) {
      const t = CT.getTool(id); assert.equal(t.kind, 'navigation_only'); assert.equal(t.executable, false); assert.equal(t.reason, 'NO_PURE_MODULE');
      assert.deepEqual(codes(CT.createDraft(id).errors), ['TOOL_NOT_EXECUTABLE']); assert.deepEqual(codes(CT.run(id, {}).errors), ['TOOL_NOT_EXECUTABLE']);
      const nav = CT.handleToolCall({ name: CT.OPEN_TOOL_NAME, args: { tool: id } });
      assert.equal(nav.ok, true); assert.equal(nav.result.status, 'navigation_only'); assert.equal(nav.result.engine.called, false); assert.equal(nav.result.coreResult, null); assert.equal(nav.result.navigation.executableHere, false);
      assert.ok(CT.formatResult(nav.result, 'en').includes('NAVIGATION ONLY'));
    }
    assert.deepEqual(codes(CT.createDraft('eval').errors), ['UNKNOWN_TOOL']); assert.equal(CT.getTool('eval'), null);
    assert.equal(CT.handleToolCall({ name: 'ec_calc_eval', args: {} }).ok, false); assert.equal(CT.handleToolCall({ name: CT.OPEN_TOOL_NAME, args: { tool: 'nope' } }).ok, false);
  });
  test('provider schemas are strict: root object, all properties required, additionalProperties false, no top-level anyOf, no allOf / if / then / not', () => {
    const defs = CT.getToolDefinitions(); assert.equal(defs.length, EXECUTABLE.length + 1);
    const walk = (s, top) => {
      for (const banned of ['allOf', 'if', 'then', 'else', 'not', 'oneOf', 'patternProperties']) assert.ok(!(banned in s), banned);
      if (top) { assert.equal(s.type, 'object'); assert.ok(!('anyOf' in s)); }
      if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual(s.required.slice().sort(), Object.keys(s.properties).sort()); for (const k of Object.keys(s.properties)) walk(s.properties[k], false); }
      if (s.items) walk(s.items, false);
      if (s.anyOf) for (const b of s.anyOf) walk(b, false);
    };
    for (const d of defs) { assert.equal(d.strict, true); assert.match(d.name, /^ec_(calc_[a-z_]+|open_tool)$/); walk(d.input_schema, true); }
    for (const id of ['load_calc', 'load_calc_preliminary', 'service_sizing', 'service_sizing_preliminary']) {
      assert.deepEqual(Object.keys(CT.getToolInputSchema(id).properties), ['action'], `${id}: the model can only ask to run imported context`); assert.equal(CT.getTool(id).inputMode, 'imported_context_only');
    }
    assert.ok(!JSON.stringify(defs).includes('adopt'), 'no adoption tool is offered to the model');
  });
  test('pure module: local calc imports only, no DOM / storage / network / clock, no adoption call or export', () => {
    for (const m of SOURCE.matchAll(/require\(([^)]*)\)/g)) assert.match(m[1], /^'\.\/[A-Za-z0-9]+(\.js)?'$/, m[1]);
    for (const re of [/\bdocument\./, /\bwindow\./, /localStorage/, /indexedDB/, /\bfetch\(/, /XMLHttpRequest/, /Date\.now|new Date/, /Math\.random/, /\bprocess\./, /\beval\(|new Function/]) assert.ok(!re.test(SOURCE), String(re));
    assert.ok(!/adoptPlannedConductorDeclaration\s*\(/.test(SOURCE) && !/\.adopt[A-Za-z]*\s*\(/.test(SOURCE));
    assert.ok(!Object.keys(CT).some((k) => /adopt|save|persist|record/i.test(k)));
  });
});

describe('STAGE5 — closed input validation', () => {
  const draft = () => CT.createDraft('battery_runtime').draft;
  const rejected = (patch, code, tool) => { const v = CT.validatePatch(tool || 'battery_runtime', patch); assert.equal(v.ok, false); assert.ok(codes(v.errors).includes(code), `${code} in ${JSON.stringify(codes(v.errors))}`); assert.deepEqual(v.set, {}); };
  test('unknown keys, prototype keys, accessors, non-finite numbers, strings-for-numbers and wrong enums are rejected, never coerced', () => {
    rejected({ set: { capacity: 1000 }, clear: [] }, 'UNKNOWN_FIELD');
    rejected({ set: {}, clear: [], run: 'x' }, 'UNKNOWN_FIELD');
    rejected(JSON.parse('{"set":{"__proto__":{"capacityWh":1},"capacityWh":1000},"clear":[]}'), 'PROTOTYPE_KEY');
    rejected(JSON.parse('{"set":{"constructor":1},"clear":[]}'), 'PROTOTYPE_KEY');
    rejected({ set: Object.defineProperty({}, 'capacityWh', { get: () => 1000, enumerable: true }), clear: [] }, 'ACCESSOR_NOT_ALLOWED');
    rejected(new (class Patch { constructor() { this.set = {}; } })(), 'PATCH_NOT_OBJECT');
    rejected({ set: { capacityWh: NaN }, clear: [] }, 'NOT_FINITE'); rejected({ set: { capacityWh: Infinity }, clear: [] }, 'NOT_FINITE');
    rejected({ set: { capacityWh: '1000' }, clear: [] }, 'WRONG_TYPE'); rejected({ set: { consumption: '1,2' }, clear: [] }, 'WRONG_TYPE');
    rejected({ set: { consumptionMode: 'kwh_month' }, clear: [] }, 'NOT_IN_ENUM'); rejected({ set: { useDocumentedEstimates: 'yes' }, clear: [] }, 'CONTEXT_ONLY_FIELD');
    assert.deepEqual(codes(CT.validatePatch('battery_runtime', { set: { useDocumentedEstimates: 'yes' }, clear: [] }, FORM).errors), ['WRONG_TYPE'], 'typed even when imported from the app context');
    rejected({ set: { capacityWh: 1 }, clear: ['capacityWh'] }, 'CONFLICTING_PATCH'); rejected({ set: {}, clear: ['nope'] }, 'UNKNOWN_FIELD');
    rejected({ set: { phase: '1' }, clear: [] }, 'WRONG_TYPE', 'voltage_drop'); rejected({ set: { phase: 2 }, clear: [] }, 'NOT_IN_ENUM', 'voltage_drop');
    rejected({ set: { terminalRatingC: 90 }, clear: [] }, 'NOT_IN_ENUM', 'ampacity'); rejected({ set: { insulation: 'thwn-2' }, clear: [] }, 'NOT_IN_ENUM', 'wire_sizing');
    rejected({ set: { numConductors: 2.5 }, clear: [] }, 'NOT_INTEGER', 'conduit_fill'); rejected({ set: { adjustmentFactor: 0 }, clear: [] }, 'OUT_OF_RANGE', 'ampacity');
    rejected({ set: { hasEgc: true }, clear: [] }, 'UNKNOWN_FIELD', 'box_fill'); rejected({ set: { groundRing: 'cu_4awg' }, clear: [] }, 'NOT_IN_ENUM', 'grounding');
    assert.deepEqual(codes(CT.validatePatch('battery_runtime', { set: {}, clear: [] }, { origin: 'scraped_dom' }).errors), ['UNKNOWN_ORIGIN']);
  });
  test('arrays are bounded with the engine shapes', () => {
    const group = { wireType: 'thhn', wireSize: '12', qty: 1 };
    rejected({ set: { conductors: Array.from({ length: 21 }, () => group) }, clear: [] }, 'ARRAY_LENGTH', 'conduit_fill_mixed');
    rejected({ set: { conductors: [] }, clear: [] }, 'ARRAY_LENGTH', 'conduit_fill_mixed');
    rejected({ set: { conductors: [Object.assign({ note: 'x' }, group)] }, clear: [] }, 'UNKNOWN_FIELD', 'conduit_fill_mixed');
    rejected({ set: { conductors: [{ wireType: 'thhn', wireSize: '12' }] }, clear: [] }, 'MISSING_NESTED_FIELD', 'conduit_fill_mixed');
    rejected({ set: { geometry: { rows: [], entries: [], connections: [], depthIn: 6 } }, clear: [] }, 'UNKNOWN_FIELD', 'pull_box');
    rejected({ set: { geometry: { rows: [], entries: Array.from({ length: 129 }, (_, n) => ({ id: `e${n}`, rowId: 'r', tradeSize: '1' })), connections: [] } }, clear: [] }, 'ARRAY_LENGTH', 'pull_box');
    rejected({ set: { geometry: { rows: [], entries: [{ id: 'e1', rowId: 'r', tradeSize: 0.5 }], connections: [] } }, clear: [] }, 'WRONG_TYPE', 'pull_box');
  });
  test('context-only fields cannot come from the conversation', () => {
    for (const id of ['load_calc', 'load_calc_preliminary', 'service_sizing', 'service_sizing_preliminary']) rejected({ set: { request: B0() }, clear: [] }, 'CONTEXT_ONLY_FIELD', id);
    rejected({ set: { design: design(200) }, clear: [] }, 'CONTEXT_ONLY_FIELD', 'service_sizing');
    assert.equal(CT.validatePatch('load_calc', { set: { request: B0() }, clear: [] }, FORM).ok, true);
    assert.equal(CT.handleToolCall({ name: 'ec_calc_load_calc', args: { set: { request: B0() }, clear: [] } }).ok, false);
  });
  test('merge returns a new immutable draft and fingerprint; the current draft and the patch are never mutated', () => {
    const d0 = draft(); const patch = deepFreeze({ set: { capacityWh: 1000, consumptionMode: null }, clear: [] });
    const m = CT.mergeDraft(d0, patch);
    assert.equal(m.ok, true); assert.deepEqual(m.changedFields, ['capacityWh']); assert.notEqual(m.draft, d0); assert.deepEqual(d0.input, {}); assert.notEqual(m.draft.fingerprint, d0.fingerprint);
    assert.ok(Object.isFrozen(m.draft) && Object.isFrozen(m.draft.input)); assert.deepEqual(m.draft.origins, { capacityWh: 'conversation' });
    const back = CT.mergeDraft(m.draft, { set: {}, clear: ['capacityWh'] });
    assert.equal(back.draft.fingerprint, d0.fingerprint, 'change-then-revert restores the fingerprint (invalidation must be event-based in the UI)');
    assert.deepEqual(CT.fingerprintInput('battery_runtime', { capacityWh: 1000 }), { ok: true, fingerprint: m.draft.fingerprint, errors: [] });
    const tampered = Object.assign(clone(m.draft), { input: { capacityWh: 2000 } });
    assert.deepEqual(codes(CT.execute(tampered).errors), ['STALE_FINGERPRINT']); assert.equal(CT.validateDraft(tampered).state, 'invalid');
    assert.equal(CT.execute(Object.assign(clone(m.draft), { endpoint: 'https://x' })).ok, false);
  });
});

describe('STAGE5 — battery runtime (Wh): shared draft, stale results, opt-in estimates', () => {
  const FULL = { capacityWh: 1000, consumptionMode: 'kwh_year', consumption: 365, chargePercent: 100, usablePercent: 85 };
  test('1000 Wh, 365 kWh/year, 100 %, 85 % → about 20 h 24 min, exactly the engine result', () => {
    const r = result('battery_runtime', FULL);
    assert.equal(r.status, 'complete'); assert.deepEqual(r.coreResult, battery.calculateBatteryRuntime(FULL)); assert.deepEqual(r.engine.args, [FULL]);
    assert.equal(r.coreResult.data.duration.hours, 20); assert.equal(r.coreResult.data.duration.minutes, 24);
    assert.ok(r.summary[0].pl.includes('Około 20 h 24 min')); assert.ok(r.summary[0].en.includes('About 20 h 24 min'));
    assert.ok(!r.assumptions.some((a) => a.basis === 'documented_editable_estimate'), 'explicit values are not labelled as estimates');
  });
  test('follow-up "charge 50 %" clears the stale result and gives 10 h 12 min; correcting to 500 kWh/year changes only consumption', () => {
    const first = run('battery_runtime', FULL);
    const m = CT.mergeDraft(first.draft, { set: { chargePercent: 50 }, clear: [] });
    assert.deepEqual(m.changedFields, ['chargePercent']); assert.equal(m.staleResultCleared, true); assert.equal(m.draft.result, null); assert.equal(m.draft.resultFingerprint, null); assert.notEqual(m.draft.fingerprint, first.draft.fingerprint);
    assert.equal(first.draft.result.coreResult.data.duration.hours, 20, 'the earlier draft is untouched');
    const second = CT.execute(m.draft);
    assert.equal(second.result.coreResult.data.duration.hours, 10); assert.equal(second.result.coreResult.data.duration.minutes, 12);
    const m2 = CT.mergeDraft(second.draft, { set: { consumption: 500, capacityWh: null, consumptionMode: null, chargePercent: null, usablePercent: null, useDocumentedEstimates: null }, clear: [] });
    assert.deepEqual(m2.changedFields, ['consumption']); assert.equal(m2.draft.result, null);
    assert.deepEqual(m2.draft.input, Object.assign({}, FULL, { chargePercent: 50, consumption: 500 }));
    const third = CT.execute(m2.draft);
    assert.deepEqual(third.result.coreResult, battery.calculateBatteryRuntime(Object.assign({}, FULL, { chargePercent: 50, consumption: 500 })));
    assert.notEqual(third.result.coreResult.data.hours, second.result.coreResult.data.hours);
    const same = CT.mergeDraft(third.draft, { set: { consumption: 500 }, clear: [] });
    assert.deepEqual(same.changedFields, []); assert.equal(same.draft.result, third.result, 'a no-op keeps the current result');
  });
  test('an invalid change applies nothing and still removes the stale result', () => {
    const first = run('battery_runtime', FULL);
    const m = CT.mergeDraft(first.draft, { set: { chargePercent: NaN }, clear: [] });
    assert.equal(m.ok, false); assert.equal(m.staleResultCleared, true); assert.equal(m.draft.result, null); assert.deepEqual(m.draft.input, first.draft.input); assert.equal(m.draft.fingerprint, first.draft.fingerprint);
  });
  const BASE = { capacityWh: 1000, consumptionMode: 'kwh_year', consumption: 365 };
  const modelCall = (set, extra) => CT.handleToolCall(Object.assign({ name: 'ec_calc_battery_runtime', args: { set, clear: [] } }, extra || {}));
  const MODEL_BASE = Object.assign({ chargePercent: null, usablePercent: null }, BASE);   // exactly the model-facing properties
  const estimates = (r) => r.assumptions.filter((a) => a.basis === 'documented_editable_estimate');
  test('the consumption unit is never defaulted; missing charge / usable values are asked, and the model has no way to opt in to the 100 % / 85 % estimates', () => {
    needs(result('battery_runtime', { capacityWh: 1000, consumption: 365, chargePercent: 100, usablePercent: 85 }), 'consumptionMode');
    needs(result('battery_runtime', BASE), 'chargePercent', 'usablePercent');
    needs(result('battery_runtime', Object.assign({}, BASE, { useDocumentedEstimates: false }), FORM), 'chargePercent', 'usablePercent');
    const call = modelCall({ capacityWh: 1000, consumptionMode: null, consumption: 365, chargePercent: null, usablePercent: null });
    assert.equal(call.ok, true); needs(call.result, 'consumptionMode', 'chargePercent', 'usablePercent'); assert.equal(call.result.coreResult, null); assert.deepEqual(call.result.assumptions, []);
    // the opt-in is not a model argument: not in the catalogue's model fields, not in the provider schema
    const t = CT.getTool('battery_runtime');
    assert.deepEqual(t.contextOnlyFields, ['useDocumentedEstimates']); assert.ok(!t.modelFields.includes('useDocumentedEstimates')); assert.equal(t.fields.useDocumentedEstimates.origin, 'context'); assert.equal(t.inputMode, 'typed_patch');
    const schema = CT.getToolInputSchema('battery_runtime');
    assert.deepEqual(Object.keys(schema.properties.set.properties), ['capacityWh', 'consumptionMode', 'consumption', 'chargePercent', 'usablePercent']);
    assert.ok(!schema.properties.clear.items.enum.includes('useDocumentedEstimates')); assert.ok(schema.properties.set.properties.chargePercent.description.includes('cannot opt in'));
    // ...and a model that sends it anyway is refused whole: nothing is applied, nothing is calculated, no 100 % / 85 % appears
    for (const v of [true, false]) {
      const viaRun = CT.run('battery_runtime', Object.assign({}, BASE, { useDocumentedEstimates: v }));
      assert.equal(viaRun.ok, false); assert.equal(viaRun.result, null); assert.deepEqual(codes(viaRun.errors), ['CONTEXT_ONLY_FIELD']); assert.equal(viaRun.errors[0].field, 'set.useDocumentedEstimates');
      const viaCall = modelCall(Object.assign({}, MODEL_BASE, { useDocumentedEstimates: v }));
      assert.equal(viaCall.ok, false); assert.equal(viaCall.result, null); assert.deepEqual(codes(viaCall.errors), ['CONTEXT_ONLY_FIELD']); assert.deepEqual(viaCall.draft.input, {}); assert.equal(viaCall.draft.result, null);
      assert.deepEqual(codes(CT.mergeDraft(CT.createDraft('battery_runtime').draft, { set: { useDocumentedEstimates: v }, clear: [] }, { origin: 'conversation' }).errors), ['CONTEXT_ONLY_FIELD']);
    }
    const bad = result('battery_runtime', Object.assign({}, FULL, { chargePercent: 150 }));
    assert.equal(bad.status, 'invalid_input'); assert.deepEqual(bad.coreResult, battery.calculateBatteryRuntime(Object.assign({}, FULL, { chargePercent: 150 }))); assert.equal(bad.errors[0].field, 'chargePercent');
  });
  test('the documented estimates apply only through an explicit application / user-context import, and are surfaced with their source', () => {
    const asked = modelCall(MODEL_BASE); needs(asked.result, 'chargePercent', 'usablePercent');
    const opted = CT.importFormInput(asked.draft, { useDocumentedEstimates: true });
    assert.equal(opted.ok, true); assert.deepEqual(opted.changedFields, ['useDocumentedEstimates']); assert.equal(opted.draft.result, null, 'the needs-input result is dropped by the change');
    assert.deepEqual(opted.draft.origins, { capacityWh: 'conversation', consumptionMode: 'conversation', consumption: 'conversation', useDocumentedEstimates: 'current_form' });
    const r = CT.execute(opted.draft).result;
    assert.equal(r.status, 'complete'); assert.deepEqual(r.engine.args, [BASE], 'the engine applies its own DEFAULTS; nothing is injected'); assert.deepEqual(r.coreResult, battery.calculateBatteryRuntime(BASE));
    assert.deepEqual(estimates(r).map((a) => [a.field, a.value, a.source, a.userStated]), [['chargePercent', 100, 'batteryRuntime.DEFAULTS', false], ['usablePercent', 85, 'batteryRuntime.DEFAULTS', false]]);
    assert.equal(r.coreResult.data.duration.hours, 20); assert.equal(r.coreResult.data.duration.minutes, 24);
    assert.ok(CT.formatResult(r, 'pl').includes('batteryRuntime.DEFAULTS')); assert.ok(estimates(r).every((a) => a.note.en.includes('application context')));
    // the same in one call: the app passes the opt-in as formInput next to the model's own arguments
    const oneStep = modelCall(MODEL_BASE, { formInput: { useDocumentedEstimates: true } });
    assert.equal(oneStep.ok, true); assert.equal(oneStep.result.status, 'complete'); assert.deepEqual(oneStep.result.coreResult, r.coreResult); assert.equal(oneStep.draft.origins.useDocumentedEstimates, 'current_form');
    assert.deepEqual(result('battery_runtime', Object.assign({}, BASE, { useDocumentedEstimates: true }), FORM).coreResult, r.coreResult);
    // a later explicit value from the conversation replaces that estimate only
    const half = modelCall({ capacityWh: null, consumptionMode: null, consumption: null, chargePercent: 50, usablePercent: null }, { draft: oneStep.draft });
    assert.equal(half.result.status, 'complete'); assert.deepEqual(estimates(half.result).map((a) => a.field), ['usablePercent']); assert.equal(half.result.coreResult.data.duration.hours, 10); assert.equal(half.result.coreResult.data.duration.minutes, 12);
    // the model can neither withdraw nor re-label the opt-in, and a draft that claims a conversation origin for it is invalid
    assert.deepEqual(codes(CT.mergeDraft(opted.draft, { set: {}, clear: ['useDocumentedEstimates'] }).errors), ['CONTEXT_ONLY_FIELD']);
    assert.equal(CT.mergeDraft(opted.draft, { set: {}, clear: ['useDocumentedEstimates'] }, FORM).ok, true, 'the app context can withdraw it');
    const forged = JSON.parse(JSON.stringify(opted.draft)); forged.origins.useDocumentedEstimates = 'conversation';
    assert.equal(CT.validateDraft(forged).state, 'invalid'); assert.deepEqual(codes(CT.execute(forged).errors), ['CONTEXT_ONLY_FIELD']); assert.equal(CT.verifyResult(forged).current, false);
    assert.equal(modelCall(MODEL_BASE, { draft: forged }).ok, false);
  });
  test('explicit current-form values (the form\'s own 100 % / 85 % fields) import normally and are stated values, not estimates', () => {
    const form = result('battery_runtime', FULL, FORM);
    assert.equal(form.status, 'complete'); assert.deepEqual(form.coreResult, battery.calculateBatteryRuntime(FULL)); assert.deepEqual(estimates(form), []);
    const mixed = modelCall(MODEL_BASE, { formInput: { chargePercent: 100, usablePercent: 85 } });
    assert.equal(mixed.ok, true); assert.equal(mixed.result.status, 'complete'); assert.deepEqual(mixed.result.engine.args, [FULL]); assert.deepEqual(estimates(mixed.result), []);
    assert.deepEqual(mixed.draft.origins, { capacityWh: 'conversation', consumptionMode: 'conversation', consumption: 'conversation', chargePercent: 'current_form', usablePercent: 'current_form' });
    assert.equal(mixed.result.coreResult.data.duration.hours, 20); assert.equal(mixed.result.coreResult.data.duration.minutes, 24);
  });
  test('a persisted draft re-validates; the stored result is checked by re-running, never trusted', () => {
    const first = run('battery_runtime', FULL); const stored = JSON.parse(JSON.stringify(first.draft));
    const v = CT.validateDraft(stored); assert.equal(v.state, 'ready'); assert.equal(v.hasCurrentResult, true);
    const untouched = CT.verifyResult(stored); assert.equal(untouched.current, true, String(untouched.reason)); assert.equal(untouched.reason, null);
    assert.deepEqual(JSON.parse(JSON.stringify(untouched.result)), stored.result, 'semantic round trip: the re-run equals the stored result member for member');
    const held = CT.mergeDraft(stored, { set: {}, clear: [] });
    assert.equal(held.ok, true); assert.equal(held.staleResultCleared, false); assert.equal(held.draft.result.flags.prototype, false);
    assert.deepEqual(JSON.parse(JSON.stringify(held.draft.result)), stored.result, 're-hydration drops nothing — flags.prototype included');
    const opted = run('battery_runtime', Object.assign({}, BASE, { useDocumentedEstimates: true }), FORM);
    assert.equal(CT.verifyResult(JSON.parse(JSON.stringify(opted.draft))).current, true, 'a stored context opt-in keeps its provenance and verifies');
    // any difference is a difference: numbers, text, a flipped flag, a missing flag, an injected prototype key
    const copy = () => JSON.parse(JSON.stringify(first.draft));
    stored.result.coreResult.data.hours = 99; stored.result.summary[0].pl = 'Czas pracy: Około 99 h';
    const check = CT.verifyResult(stored); assert.equal(check.current, false); assert.equal(check.reason, 'STORED_RESULT_DIFFERS'); assert.equal(check.result.coreResult.data.duration.hours, 20);
    const flipped = copy(); flipped.result.flags.installationApproved = true; assert.equal(CT.verifyResult(flipped).current, false);
    const status = copy(); status.result.status = 'partial'; assert.equal(CT.verifyResult(status).current, false);
    const dropped = copy(); delete dropped.result.flags.prototype; assert.equal(CT.verifyResult(dropped).reason, 'STORED_RESULT_DIFFERS', 'a missing flag is a difference, not noise');
    const unknown = copy(); unknown.result.status = 'approved'; assert.equal(CT.validateDraft(unknown).hasCurrentResult, false); assert.equal(CT.verifyResult(unknown).reason, 'STORED_RESULT_NOT_ATTACHED');
    const text = JSON.stringify(first.draft); assert.ok(text.includes('"flags":{'));
    const polluted = JSON.parse(text.replace('"flags":{', '"flags":{"__proto__":{"installationApproved":true},'));
    assert.equal(CT.validateDraft(polluted).hasCurrentResult, false); assert.equal(CT.verifyResult(polluted).reason, 'STORED_RESULT_NOT_ATTACHED');
    assert.equal(CT.verifyResult(CT.createDraft('battery_runtime').draft).reason, 'NO_STORED_RESULT');
  });
});

describe('STAGE5 — Wire Sizer, Ampacity, Voltage Drop', () => {
  const WS = { noncontinuousLoadA: 20, continuousLoadA: 0, material: 'cu', insulation: 'thhn', ambientF: 86, adjustmentFactor: 1, terminalRatingC: 75, circuitType: 'BRANCH_CIRCUIT', jurisdiction: 'NYC', feet: 10, voltage: 120, phase: 1, maxVoltDropPercent: 3 };
  const wsArgs = (i) => Object.assign({}, i, { feedsDwellingUnit: null });
  test('complete audited conditions: 20 A, 120 V, 1-phase Cu, 10 ft → #12; 100 ft → #8 at 2.60 %', () => {
    const short = result('wire_sizing', WS);
    assert.equal(short.status, 'complete'); assert.deepEqual(short.coreResult, selectConductor(wsArgs(WS))); assert.deepEqual(short.coreResult, selectConductor(clone(short.engine.args[0])));
    assert.equal(short.coreResult.finalSelectedConductor, '12'); assert.ok(short.summary[0].pl.includes('#12 AWG CU'));
    const long = result('wire_sizing', Object.assign({}, WS, { feet: 100 }));
    assert.deepEqual(long.coreResult, selectConductor(wsArgs(Object.assign({}, WS, { feet: 100 }))));
    assert.equal(long.coreResult.finalSelectedConductor, '8'); assert.equal(long.coreResult.recommended.voltDropPercent.toFixed(2), '2.60'); assert.equal(long.coreResult.governingConstraint, 'VOLTAGE_DROP');
    assert.ok(CT.formatResult(long, 'en').includes('#8 AWG CU') && CT.formatResult(long, 'en').includes('2.60%'));
    assert.deepEqual(long.references, long.coreResult.codeReferences);
    assert.equal(long.warnings.find((w) => w.code === 'ENGINE_NOTE').text, long.coreResult.note, 'the engine limitation note is passed through verbatim');
  });
  test('no design-load basis, no hidden factor: the registry never turns 20 A continuous into 25 A, and never infers phase / voltage / material', () => {
    const only = Object.assign({}, WS); delete only.continuousLoadA;
    needs(result('wire_sizing', only), 'continuousLoadA');
    needs(result('wire_sizing', { noncontinuousLoadA: 20, continuousLoadA: 0 }), 'material', 'insulation', 'ambientF', 'adjustmentFactor', 'terminalRatingC', 'circuitType', 'jurisdiction', 'feet');
    const noVd = Object.assign({}, WS); delete noVd.voltage; delete noVd.phase; delete noVd.maxVoltDropPercent;
    needs(result('wire_sizing', noVd), 'voltage', 'phase', 'maxVoltDropPercent');
    needs(result('wire_sizing', Object.assign({}, WS, { circuitType: 'FEEDER' })), 'feedsDwellingUnit');
    const cont = result('wire_sizing', Object.assign({}, WS, { noncontinuousLoadA: 0, continuousLoadA: 20 }));
    assert.equal(cont.normalizedInput.continuousLoadA, 20); assert.equal(cont.engine.args[0].continuousLoadA, 20); assert.ok(!JSON.stringify(cont.normalizedInput).includes('25'));
    assert.deepEqual(cont.coreResult, selectConductor(wsArgs(Object.assign({}, WS, { noncontinuousLoadA: 0, continuousLoadA: 20 }))), 'whatever the engine decides for the stated continuous amperes is reported unchanged');
    assert.ok(cont.warnings.some((w) => w.code === 'LOAD_BASIS_AS_STATED'));
    // the engine's ACTUAL treatment of the continuous amperes is reported from its own result fields (the engine is the oracle; no figure is restated here)
    const applied = cont.coreResult.continuousLoadRuleApplied === true;
    assert.equal(cont.warnings.some((w) => w.code === 'ENGINE_CONTINUOUS_LOAD_MULTIPLIER'), applied);
    assert.equal(cont.summary[1].en.includes(`×${cont.coreResult.continuousLoadMultiplier} multiplier`), applied);
    assert.ok(cont.summary[1].en.includes(`engine-required ampacity ${cont.coreResult.requiredConductorAmpacityA} A`));
    assert.ok(!result('wire_sizing', WS).warnings.some((w) => w.code === 'ENGINE_CONTINUOUS_LOAD_MULTIPLIER'), 'no continuous amperes stated → nothing to report');
    const skip = Object.assign({}, noVd, { feet: 0 }); const r0 = result('wire_sizing', skip);
    assert.equal(r0.status, 'complete'); assert.ok(r0.warnings.some((w) => w.code === 'VOLTAGE_DROP_NOT_CHECKED')); assert.ok(!('voltage' in r0.engine.args[0]) && !('phase' in r0.engine.args[0]));
    const zero = result('wire_sizing', Object.assign({}, WS, { noncontinuousLoadA: 0 }));
    assert.equal(zero.status, 'invalid_input'); assert.equal(zero.coreStatus, 'INVALID_LOAD');
  });
  test('ampacity: exact engine result; rooftop facts are asked, never assumed; a missing table factor stays unsupported', () => {
    const A = { size: '12', material: 'cu', insulation: 'thhn', ambientF: 86, adjustmentFactor: 1, terminalRatingC: 75, onOrAboveRoof: false };
    const base = { size: '12', material: 'cu', insulation: 'thhn', ambientF: 86, adjustmentFactor: 1, terminalRatingC: 75 };
    const r = result('ampacity', A);
    assert.equal(r.status, 'complete'); assert.deepEqual(r.coreResult, calculateAmpacity(Object.assign({}, base, { rooftop: null })));
    const noRoof = Object.assign({}, A); delete noRoof.onOrAboveRoof; needs(result('ampacity', noRoof), 'onOrAboveRoof');
    needs(result('ampacity', Object.assign({}, A, { onOrAboveRoof: true })), 'rooftopDirectSunlight');
    needs(result('ampacity', Object.assign({}, A, { onOrAboveRoof: true, rooftopDirectSunlight: true })), 'rooftopClearanceInches');
    const roof = result('ampacity', Object.assign({}, A, { onOrAboveRoof: true, rooftopDirectSunlight: true, rooftopClearanceInches: 0.5 }));
    assert.deepEqual(roof.coreResult, calculateAmpacity(Object.assign({}, base, { rooftop: { onOrAboveRoof: true, directSunlight: true, clearanceInches: 0.5 } })));
    assert.equal(roof.coreResult.rooftopAdjustmentApplied, true); assert.ok(roof.references.includes(roof.coreResult.rooftopRule));
    const tw = result('ampacity', Object.assign({}, A, { insulation: 'tw', ambientF: 140 }));
    assert.equal(tw.status, 'unsupported'); assert.equal(tw.coreStatus, 'TABLE_FACTOR_UNAVAILABLE_FOR_RATING'); assert.equal(tw.coreResult.ok, false); assert.ok(tw.warnings.some((w) => w.text === tw.coreResult.note));
  });
  test('voltage drop is for ONE explicit conductor: exact engine result, no minimum-size search, no sizing claim', () => {
    const V = { amps: 20, feet: 100, voltage: 120, phase: 1, material: 'cu', size: '12' };
    const r = result('voltage_drop', V);
    assert.equal(r.status, 'complete'); assert.deepEqual(r.coreResult, calculateVoltageDrop(V)); assert.equal(r.engine.fn, 'calculateVoltageDrop');
    assert.ok(!JSON.stringify(r).includes('recommendedSize')); assert.ok(r.warnings.some((w) => w.code === 'EXPLICIT_CONDUCTOR_ONLY'));
    const noSize = Object.assign({}, V); delete noSize.size; needs(result('voltage_drop', noSize), 'size');
    assert.ok(!/minSizeForVoltageDrop|analyzeVoltageDrop/.test(SOURCE));
  });
});

describe('STAGE5 — Conduit Fill, Box Fill, Motor', () => {
  test('conduit fill: 1 / 2 / 3 conductors use the 53 / 31 / 40 % rule exactly as the engine does; mixed and wireway parity', () => {
    const C = { conduitType: 'emt', conduitSize: '0.5', wireType: 'thhn', wireSize: '12' };
    for (const [n, pct] of [[1, 53], [2, 31], [3, 40]]) {
      const r = result('conduit_fill', Object.assign({}, C, { numConductors: n }));
      assert.equal(r.status, 'complete'); assert.deepEqual(r.coreResult, conduit.calculateConduitFill(Object.assign({}, C, { numConductors: n }))); assert.equal(r.coreResult.fillRulePercent, pct);
    }
    const noCount = result('conduit_fill', C); needs(noCount, 'numConductors');
    const M = { conduitType: 'emt', conduitSize: '0.75', conductors: [{ wireType: 'thhn', wireSize: '12', qty: 3 }, { wireType: 'thhn', wireSize: '10', qty: 1 }] };
    const mixed = result('conduit_fill_mixed', M);
    assert.deepEqual(mixed.coreResult, conduit.calculateConduitFillMixed(clone(M))); assert.equal(mixed.coreResult.totalConductors, 4); assert.equal(mixed.coreResult.fillRulePercent, 40);
    const W = { width: 4, height: 4, wireType: 'thhn', wireSize: '12', numConductors: 10 };
    assert.deepEqual(result('wireway_fill', W).coreResult, conduit.calculateWirewayFill(W));
    const over = result('conduit_fill', Object.assign({}, C, { numConductors: 40 }));
    assert.equal(over.coreResult.fits, false); assert.ok(over.summary[0].pl.includes('PRZEKRACZA') && !over.summary[0].pl.includes('MIEŚCI'));
    const ent = result('conduit_fill', { conduitType: 'ent', conduitSize: '4', wireType: 'thhn', wireSize: '12', numConductors: 3 });
    assert.equal(ent.status, 'unsupported'); assert.equal(ent.coreStatus, 'CONDUIT_NOT_IN_TABLE');
  });
  test('box fill: strict contract 2, an explicit EGC count (missing is not zero), EGC size when counted; exact engine verdict', () => {
    const B = { boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 6, numDevices: 1, numSupportFittings: 0, hasClamps: false, egcCount: 2, egcSize: '12', extensionVolume: 0 };
    const direct = calculateBoxFill(Object.assign({ contract: 2, ruleBasis: 'NEC2020' }, B));
    const r = result('box_fill', B);
    assert.equal(r.status, 'complete'); assert.deepEqual(r.coreResult, direct); assert.equal(r.engine.args[0].contract, 2); assert.equal(r.engine.args[0].ruleBasis, 'NEC2020'); assert.equal(r.coreResult.egc.count, 2);
    assert.ok(!('legacyCompatibility' in r.coreResult), 'never the legacy hasEgc path');
    const noEgc = Object.assign({}, B); delete noEgc.egcCount; delete noEgc.egcSize; needs(result('box_fill', noEgc), 'egcCount');
    const noSize = Object.assign({}, B); delete noSize.egcSize; needs(result('box_fill', noSize), 'egcSize');
    const noGeometry = Object.assign({}, B); delete noGeometry.extensionVolume; delete noGeometry.hasClamps; needs(result('box_fill', noGeometry), 'extensionVolume', 'hasClamps');
    const zero = result('box_fill', Object.assign({}, noSize, { egcCount: 0 }));
    assert.equal(zero.status, 'complete'); assert.equal(zero.coreResult.egcVolume, 0);
    const big = result('box_fill', Object.assign({}, B, { egcSize: '6' }));
    assert.notEqual(big.status, 'complete'); assert.equal(big.coreStatus, 'EGC_LARGER_THAN_GOVERNING'); assert.equal(big.coreResult.ok, false);
    const over = result('box_fill', Object.assign({}, B, { numConductors: 12 }));
    assert.deepEqual(over.coreResult, calculateBoxFill(Object.assign({ contract: 2, ruleBasis: 'NEC2020' }, B, { numConductors: 12 })));
    assert.equal(over.coreResult.fits, false); assert.ok(over.summary[0].pl.includes('PRZEKROCZONE') && !CT.formatResult(over, 'pl').includes('MIEŚCI SIĘ'));
  });
  test('motor: table FLC governs conductors and protection; the overload figure exists only with a nameplate FLA', () => {
    const M = { hp: '10', volts: 230, phase: 3, motorType: 'designB', ocpdType: 'inverse', material: 'cu' };
    const table = result('motor_circuit', M);
    assert.equal(table.status, 'partial'); assert.deepEqual(table.coreResult, calculateMotorCircuit(M)); assert.equal(table.coreResult.overloadMax, null);
    assert.deepEqual(table.parts.map((p) => [p.id, p.state]), [['branch', 'available'], ['overload', 'unresolved']]); assert.ok(codes(table.unresolved).includes('OVERLOAD_REQUIRES_NAMEPLATE_FLA'));
    assert.ok(CT.formatResult(table, 'pl').includes('NIE policzono'));
    needs(result('motor_circuit', Object.assign({}, M, { nameplateFLA: 26 })), 'serviceFactorMultiplier');
    const N = Object.assign({}, M, { nameplateFLA: 26, serviceFactorMultiplier: 1.25 });
    const plate = result('motor_circuit', N);
    assert.equal(plate.status, 'complete'); assert.deepEqual(plate.coreResult, calculateMotorCircuit(N));
    assert.equal(plate.coreResult.tableFLC, table.coreResult.tableFLC, 'the nameplate never replaces the table FLC'); assert.equal(plate.coreResult.conductorSize, table.coreResult.conductorSize);
    assert.equal(plate.coreResult.nameplateDiffersFromTable, true); assert.ok(plate.warnings.some((w) => w.code === 'NAMEPLATE_DIFFERS_FROM_TABLE')); assert.notEqual(plate.coreResult.overloadMax, null);
    const none = result('motor_circuit', Object.assign({}, M, { hp: '5', volts: 115 }));
    assert.equal(none.status, 'unsupported'); assert.equal(none.coreStatus, 'NOT_IN_TABLE');
    const noPhase = Object.assign({}, M); delete noPhase.phase; delete noPhase.material; needs(result('motor_circuit', noPhase), 'phase', 'material');
  });
});

describe('STAGE5 — Grounding and Pull Box: partial results are never flattened', () => {
  const G = { ocpdRating: 200, egcMaterial: 'cu', requiredPhaseSize: '3/0', installedPhaseSize: '3/0', serviceSize: '500', serviceMaterial: 'cu', electrode: 'ring' };
  test('ground ring unknown → partial (EGC available and labelled, GEC unresolved); explicit cu_2awg_sole → #2; other → unsupported condition', () => {
    const first = run('grounding', G); const r = first.result;
    assert.equal(r.status, 'partial'); assert.deepEqual(r.coreResult, calculateGrounding(G)); assert.equal(r.coreResult.gec.resolved, false); assert.equal(r.coreResult.gec.finalCopper, null);
    assert.deepEqual(r.parts.map((p) => [p.id, p.state, p.value]), [['egc', 'available', r.coreResult.egc.finalSize], ['gec', 'unresolved', null]]);
    assert.ok(codes(r.unresolved).includes('GROUND_RING_UNCONFIRMED')); assert.deepEqual(fields(r.needsInput), ['groundRing']);
    const text = CT.formatResult(r, 'pl'); assert.ok(text.includes('WYNIK CZĘŚCIOWY') && text.includes('NIEROZSTRZYGNIĘTY') && text.includes('EGC (osobny wynik'));
    assert.ok(!/GEC \(Table 250\.66\): #/.test(text), 'the reference table row is never printed as a GEC result');
    const m = CT.mergeDraft(first.draft, { set: { groundRing: 'cu_2awg_sole' }, clear: [] }); assert.equal(m.draft.result, null);
    const done = CT.execute(m.draft).result;
    assert.equal(done.status, 'complete'); assert.deepEqual(done.coreResult, calculateGrounding(Object.assign({}, G, { groundRing: 'cu_2awg_sole' })));
    assert.equal(done.coreResult.gec.finalCopper, '2'); assert.equal(done.coreResult.gec.capApplied, true); assert.ok(CT.formatResult(done, 'en').includes('GEC (Table 250.66): #2 AWG Cu'));
    const other = result('grounding', Object.assign({}, G, { groundRing: 'other' }));
    assert.equal(other.status, 'partial'); assert.equal(other.coreResult.gec.finalCopper, null); assert.ok(codes(other.unresolved).includes('GROUND_RING_UNSUPPORTED')); assert.deepEqual(other.needsInput, []);
    const rod = result('grounding', Object.assign({}, G, { electrode: 'rod' }));
    assert.equal(rod.status, 'complete'); assert.deepEqual(rod.coreResult, calculateGrounding(Object.assign({}, G, { electrode: 'rod' })));
    const partial = Object.assign({}, G); delete partial.serviceSize; delete partial.electrode; needs(result('grounding', partial), 'serviceSize', 'electrode');
  });
  const GEO = {
    rows: [{ id: 'rL', wall: 'left', order: 0 }, { id: 'rR', wall: 'right', order: 0 }],
    entries: [{ id: 'e1', rowId: 'rL', tradeSize: '2' }, { id: 'e2', rowId: 'rR', tradeSize: '2' }, { id: 'e3', rowId: 'rL', tradeSize: '1' }],
    connections: [{ id: 'c1', entryIds: ['e1', 'e2'] }],
  };
  test('pull box: explicit geometry only; unconnected entries and missing dimensions stay visible; invalid geometry is refused with the engine reason', () => {
    const direct = calculatePullBox(clone(GEO)); assert.equal(direct.ok, true);
    const r = result('pull_box', { geometry: GEO });
    assert.deepEqual(r.coreResult, direct); assert.equal(r.status, 'partial', 'completeForRequest is not a PASS');
    assert.ok(codes(r.unresolved).includes('UNCONNECTED_ENTRY')); assert.ok(codes(r.warnings).includes('DEPTH_NOT_CALCULATED') && codes(r.warnings).includes('A3_NOT_EVALUATED'));
    for (const p of r.parts) assert.equal(p.state === 'available', p.value !== null);
    assert.ok(r.parts.some((p) => p.value === null) === codes(r.unresolved).some((c) => /^NO_(WIDTH|HEIGHT)_CANDIDATES$/.test(c)));
    needs(result('pull_box', {}), 'geometry');
    const edit = (fn) => { const g = clone(GEO); fn(g); return result('pull_box', { geometry: g }); };
    const north = edit((g) => { g.rows[0].wall = 'north'; }); assert.equal(north.status, 'invalid_input'); assert.equal(north.coreStatus, 'INVALID_WALL'); assert.equal(north.coreResult.ok, false);
    const back = edit((g) => { g.rows[0].wall = 'back'; }); assert.equal(back.status, 'unsupported'); assert.equal(back.coreStatus, 'UNSUPPORTED_SURFACE');
    const empty = edit((g) => { g.entries = []; g.connections = []; }); assert.equal(empty.status, 'invalid_input'); assert.equal(empty.coreStatus, 'NO_ENTRIES');
    const splice = edit((g) => { g.connections[0].entryIds = ['e1', 'e2', 'e3']; }); assert.equal(splice.status, 'unsupported'); assert.equal(splice.coreStatus, 'CONNECTION_ARITY');
    const ghost = edit((g) => { g.connections[0].entryIds = ['e1', 'e9']; }); assert.equal(ghost.coreStatus, 'CONNECTION_UNKNOWN_ENTRY');
    for (const bad of [north, back, empty, splice, ghost]) { assert.deepEqual(bad.parts, []); assert.ok(!JSON.stringify(bad.summary).includes(' in;')); }
  });
});

describe('STAGE5 — Load Calc and Service Sizing: imported canonical request only', () => {
  test('a genuine complete request works and equals the facade; without an import the user is sent to the form', () => {
    const r = result('load_calc', { request: B0() }, FORM); const direct = F.evaluateV2(B0());
    assert.equal(r.status, 'complete'); assert.deepEqual(r.coreResult, direct); assert.equal(r.coreResult.result.demand.totalVA, 23680); assert.deepEqual(r.engine.args, [B0()]);
    assert.ok(r.summary[0].en.includes(direct.result.display.strings.lineA));
    const none = CT.handleToolCall({ name: 'ec_calc_load_calc', args: { action: CT.CONTEXT_ACTION } });
    assert.equal(none.ok, true); needs(none.result, 'request'); assert.equal(none.result.needsInput[0].directTo, 'Load Calc');
    const viaCall = CT.handleToolCall({ name: 'ec_calc_load_calc', args: { action: CT.CONTEXT_ACTION }, formInput: { request: B0() } });
    assert.deepEqual(viaCall.result.coreResult, direct); assert.deepEqual(viaCall.draft.origins, { request: 'current_form' });
    assert.equal(CT.handleToolCall({ name: 'ec_calc_load_calc', args: { action: 'adopt' }, formInput: { request: B0() } }).ok, false);
    const broken = result('load_calc', { request: { apiVersion: 2 } }, FORM);
    assert.equal(broken.status, 'invalid_input'); assert.equal(broken.coreStatus, 'REQUEST_STRUCTURALLY_INVALID');
  });
  test('an unknown conductor ampacity is never replaced by 100 / 200 A: ordinary → needs input; preliminary → separate 23 680 VA result', () => {
    const ordinary = result('load_calc', { request: B0unknown() }, FORM);
    assert.equal(ordinary.status, 'needs_input'); assert.equal(ordinary.coreStatus, 'INCOMPLETE_INPUT'); assert.deepEqual(ordinary.coreResult, F.evaluateV2(B0unknown()));
    assert.deepEqual(ordinary.needsInput.map((n) => n.reason), ['QUALIFICATION_UNKNOWN']); assert.equal(ordinary.engine.args[0].snapshot.optional82.conductorAmpacityA.value, null);
    const pre = result('load_calc_preliminary', { request: B0unknown() }, FORM); const direct = F.evaluatePreliminaryV2(B0unknown());
    assert.equal(pre.status, 'preliminary'); assert.deepEqual(pre.coreResult, direct); assert.equal(pre.coreResult.result.demand.totalVA, 23680); assert.equal(pre.coreResult.result.demand.totalExactE4, 236800000);
    assert.equal(pre.flags.preliminary, true); assert.equal(pre.flags.ordinaryResult, false); assert.equal(pre.flags.qualificationEstablished, false);
    assert.ok(codes(pre.unresolved).includes('CONDUCTOR_AMPACITY_QUALIFICATION_DEFERRED')); assert.ok(CT.formatResult(pre, 'pl').includes('WSTĘPNE'));
    const na = result('load_calc_preliminary', { request: B0() }, FORM);
    assert.equal(na.status, 'unsupported'); assert.equal(na.coreStatus, F.PRELIMINARY_STATUS.NOT_APPLICABLE);
  });
  test('preliminary sizing: main 200 A, 310.12 Cu → conditional 175 A table fact, no selection and NO adoption', () => {
    const d = design(200, DWELLING); const r = result('service_sizing_preliminary', { request: B0unknown(), design: d }, FORM);
    assert.deepEqual(r.coreResult, S.analyzePreliminaryPrototype(B0unknown(), d)); assert.equal(r.status, 'preliminary');
    assert.equal(r.coreResult.calcBasis.totalVA, 23680); assert.equal(r.coreResult.ungroundedConductors.tableCandidate.ampacity75CA, 175); assert.equal(r.coreResult.ungroundedConductors.tableCandidate.size, '2/0');
    assert.equal(r.coreResult.ungroundedConductors.size, null); assert.equal(r.coreResult.ungroundedConductors.recommendationAvailable, false);
    assert.deepEqual(r.parts.map((p) => p.state), ['available', 'available', 'unresolved']);
    assert.equal(r.nextAction.adoption.performedHere, false); assert.equal(r.nextAction.adoption.modelCallable, false); assert.equal(r.nextAction.adoption.availableInEngine, true); assert.equal(r.nextAction.adoption.candidateAmpacityA, 175);
    const json = JSON.stringify(r);
    assert.ok(!json.includes(S.ADOPTION_STATUS.ADOPTED) && !json.includes('adoptedRequest') && !json.includes('"operative":true') && !json.includes('"installationApproved":true'));
    assert.equal(r.engine.args[0].snapshot.optional82.conductorAmpacityA.value, null, 'the request is not edited');
    assert.equal(r.flags.core.operative, false); assert.equal(r.flags.core.globalCodeCompliance, 'not_verified'); assert.equal(r.flags.fullResultRecordEligible, false); assert.equal(r.flags.prototype, true);
    const text = CT.formatResult(r, 'en'); assert.ok(text.includes('PRELIMINARY') && text.includes('CONDITIONAL table fact, NOT a recommendation') && text.includes('175 A'));
  });
  test('main 100 A, 310.12: Cu 85 A / Al 90 A stay an unresolved interpretation item — never raised to 100 A', () => {
    for (const [material, amp] of [['Cu', 85], ['Al', 90]]) {
      const d = design(100, { sizingPath: 'dwelling_83pct_310_12', material }); const r = result('service_sizing_preliminary', { request: B0unknown(), design: d }, FORM);
      assert.deepEqual(r.coreResult, S.analyzePreliminaryPrototype(B0unknown(), d)); assert.equal(r.status, 'preliminary');
      assert.equal(r.coreResult.ungroundedConductors.tableCandidate.ampacity75CA, amp); assert.equal(r.coreResult.adoption.available, false); assert.equal(r.nextAction.adoption.availableInEngine, false);
      assert.ok(codes(r.unresolved).includes('B82_310_12_INTERPRETATION_PENDING')); assert.equal(r.coreResult.ungroundedConductors.size, null);
      assert.equal(r.engine.args[0].snapshot.optional82.conductorAmpacityA.value, null);
    }
  });
  test('ordinary sizing: complete only when every stage is positive; a changed premise is partial; missing design answers are asked in the form', () => {
    const full = result('service_sizing', { request: B0(), design: design(200) }, FORM);
    assert.deepEqual(full.coreResult, S.analyzePrototype(B0(), design(200))); assert.equal(full.status, 'complete'); assert.equal(full.flags.core.installationApproved, false); assert.equal(full.flags.prototype, true);
    assert.ok(CT.formatResult(full, 'en').includes('Non-operative prototype'));
    const changed = result('service_sizing', { request: B0(), design: design(200, DWELLING) }, FORM);
    assert.deepEqual(changed.coreResult, S.analyzePrototype(B0(), design(200, DWELLING))); assert.equal(changed.status, 'partial');
    assert.ok(codes(changed.unresolved).includes('QUALIFICATION_PREMISE_CHANGED')); assert.equal(changed.coreResult.ungroundedConductors.size, null);
    const noDesign = result('service_sizing', { request: B0() }, FORM);
    assert.deepEqual(noDesign.coreResult, S.analyzePrototype(B0(), null)); assert.equal(noDesign.status, 'needs_input');
    assert.ok(fields(noDesign.needsInput).includes('plan.oneMainDisconnect')); assert.ok(noDesign.needsInput.every((n) => n.directTo !== null));
    const unknown = result('service_sizing', { request: B0unknown(), design: design(200, DWELLING) }, FORM);
    assert.equal(unknown.status, 'unsupported'); assert.ok(codes(unknown.unresolved).includes('CALC_NOT_COMPLETE')); assert.equal(unknown.coreResult.ungroundedConductors.tableCandidate, null);
    const badDesign = result('service_sizing', { request: B0(), design: Object.assign(design(200), { approve: true }) }, FORM);
    assert.equal(badDesign.status, 'invalid_input'); assert.equal(badDesign.coreStatus, 'DESIGN_INVALID');
  });
  test('an engine status or shape the registry does not know is never flattened into a complete / preliminary result', () => {
    // The real engine runs; only its returned status is replaced on a copy, to stand for a status added to the engine later.
    const withEngine = (mod, fn, alter, body) => { const real = mod[fn]; mod[fn] = (...a) => { const c = clone(real(...a)); alter(c); return c; }; try { body(); } finally { mod[fn] = real; } };
    for (const odd of ['SOMETHING_NEW', 'constructor', 'toString']) {
      withEngine(F, 'evaluateV2', (c) => { c.result.status = odd; }, () => {
        const r = result('load_calc', { request: B0() }, FORM);
        assert.equal(r.status, 'blocked'); assert.equal(r.coreStatus, odd); assert.equal(r.coreResult.result.status, odd); assert.ok(!JSON.stringify(r.summary).includes('Calculated demand'));
      });
    }
    withEngine(F, 'evaluateV2', (c) => { delete c.result; }, () => {
      const r = result('load_calc', { request: B0() }, FORM);
      assert.equal(r.status, 'error'); assert.equal(r.coreStatus, 'UNREADABLE_ENGINE_RESULT'); assert.deepEqual(codes(r.errors), ['UNCLASSIFIED_RESULT']); assert.equal(r.engine.called, true);
    });
    withEngine(S, 'analyzePrototype', (c) => { c.status = 'SOMETHING_NEW'; }, () => {
      const r = result('service_sizing', { request: B0(), design: design(200) }, FORM);
      assert.equal(r.status, 'blocked'); assert.equal(r.coreStatus, 'SOMETHING_NEW'); assert.ok(CT.formatResult(r, 'en').includes('Unknown analysis status'));
    });
    withEngine(S, 'analyzePreliminaryPrototype', (c) => { c.status = 'PRELIMINARY_SOMETHING_NEW'; }, () => {
      const r = result('service_sizing_preliminary', { request: B0unknown(), design: design(200, DWELLING) }, FORM);
      assert.equal(r.status, 'blocked'); assert.equal(r.coreStatus, 'PRELIMINARY_SOMETHING_NEW'); assert.ok(!CT.formatResult(r, 'en').includes('PRELIMINARY (new design)'));
    });
    assert.equal(result('load_calc', { request: B0() }, FORM).status, 'complete', 'the real engine is restored');
  });
  test('a re-hydrated prototype result keeps flags.prototype and verifies against a re-run', () => {
    const first = run('service_sizing', { request: B0(), design: design(200) }, FORM); const stored = JSON.parse(JSON.stringify(first.draft));
    assert.equal(stored.result.flags.prototype, true);
    const kept = CT.mergeDraft(stored, { set: {}, clear: [] }).draft.result;
    assert.equal(kept.flags.prototype, true); assert.equal(kept.flags.core.installationApproved, false); assert.equal(kept.status, 'complete');
    const check = CT.verifyResult(stored); assert.equal(check.current, true, String(check.reason));
    stored.result.flags.prototype = false; assert.equal(CT.verifyResult(stored).reason, 'STORED_RESULT_DIFFERS');
  });
});
