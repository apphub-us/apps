'use strict';
/**
 * Empire Code — Load Calc engine B82_core1 (LC-22082-B0-CORE-1, first isolated delivery).
 *
 * evaluate82(envelope82) → LoadCalcResult (schemaVersion '3.3.0', profileId 'B82_core1').
 * envelope82 = { snapshot (3.3.0), parseErrors[], profileId: 'B82_core1', context }.
 *
 * Delivery boundary (CORE-SCOPE-1 + CLOSE-1 + DECISION-1): one dwelling unit, NEC 220.82 optional
 * method, arrangement `ac_only` with exactly one A/C record (quantity 1); general categories
 * range/oven/cooktop/dryer/water_heater/dishwasher/appliance_fixed_other under their inclusion
 * predicates; positive laundry count; VA-only ratings; attested NYC central-A/C exception path.
 * Every other configuration returns its documented refusal (capability, scope, pending source
 * interpretation, unresolved coverage) with all loads retained — never a silent zero.
 *
 * Numeric policy: exact integers in units of 1e-4 VA (E4) built from the shortest decimal of each
 * request number (R2-CLOSE-1 §2, R2-CLOSE-2 §2.1); derived `value` fields are projections only.
 *
 * Source/capability constants are engine-owned (§4E of the CORE-1 instruction). Nothing in a request
 * can change them. A TEST-ONLY factory exists for hypothetical pending-source fixtures.
 *
 * STAGE4 (docs/stage4-qualification-contract.md): evaluatePreliminary82(envelope82) is a SEPARATE explicit route for a new design
 * whose 220.82(A) conductor ampacity is a well-formed unknown. It runs the same stages with that single condition recorded as
 * deferred, and returns a different result kind ('B82_PRELIMINARY_NEW_DESIGN') that is never an ordinary COMPLETE result.
 * evaluate82 and its output contract are unchanged: an unknown ampacity is still INCOMPLETE_INPUT / QUALIFICATION_UNKNOWN there.
 */
const V2 = require('./loadCalcInputV2.js');
const A = require('./loadCalc.js');

const RULE_STATUS_DEFAULT = Object.freeze({
  '220.82': 'verified',   // S-11: NFPA 70-2020 §220.80/220.82(A)(B)(C) — observed primary text (SOURCE-1, E-01)
  'S-11a': 'verified',    // S-11a: §210.11(C)(1),(2), §210.52(F) + exceptions — observed (SOURCE-1, E-02/E-03)
  'I-82-1': 'pending',    // NYCEC 220.14(N) inside Part IV — interpretation unresolved
  'I-82-2': 'pending',    // laundry-circuit count 0 admissibility — interpretation unresolved
  'I-82-3': 'pending',    // interlocked heat-pump compressor as cooling equipment — unresolved
  'I-82-4': 'pending',    // (B)(4) motors at VA nameplate — mapping unresolved
  'I-82-5': 'pending',    // summed A/C ratings under (C)(1) — mapping unresolved
});
const PROFILE_82 = Object.freeze({
  id: V2.ENGINE_PROFILE_ID_82,
  enabledMethods: Object.freeze(['opt_220_82']),
  enabledArrangements: Object.freeze(['ac_only']),                 // DECISION-1: first-delivery limit, not a normative statement
  enabledModels: Object.freeze(['split_240_balanced_LN']),         // current only via the accepted split-phase balanced-L-N model + declaration
  supportedTopologies: Object.freeze(['1ph_3w_120_240', '1ph_3w_120_208_network']),   // 220.82(A): single 120/240 V or 208Y/120 V 3-wire set
  bGroup: Object.freeze(['range', 'oven', 'cooktop', 'dryer', 'water_heater', 'dishwasher', 'appliance_fixed_other']),
  ruleStatus: RULE_STATUS_DEFAULT,
});

const RANK = { UNSUPPORTED: 2, BLOCKED: 3, INVALID: 4, INCOMPLETE: 5, UNQUALIFIED: 6 };
const INVALID_CODES = new Set(['NOT_FINITE', 'OUT_OF_RANGE', 'NOT_INTEGER', 'UNKNOWN_ENUM', 'LEGACY_AMBIGUOUS', 'UNSUPPORTED_RATING_KIND', 'SUPPLY_INCONSISTENT', 'LEG_INVALID', 'CONNECTION_INVALID', 'COVERS_UNKNOWN_LOAD', 'PARSE_REJECTED', 'DUPLICATE_ID', 'RESOLUTION_EXCEEDED', 'HVAC_ARRANGEMENT_INCONSISTENT']);
const INCOMPLETE_CODES = new Set(['MISSING_FIELD', 'QUALIFICATION_UNKNOWN', 'PREMISE_STALE', 'INVENTORY_INCOMPLETE_DECLARED', 'IMPORTED_METHOD_UNCONFIRMED']);
const PREDICATE_BY_CATEGORY = { dryer: 'b3c_dryer_not_on_counted_laundry_circuit', dishwasher: 'b3a_fixed_or_specific_circuit', appliance_fixed_other: 'b3a_fixed_or_specific_circuit' };
const NOTE_NEUTRAL = A.NOTE_NEUTRAL;
const NOTE_REQUIRED_CAPACITY = 'No automatic Wire Sizer handoff in profile B82_core1; a future adapter needs its own approved contract.';
const NOTE_RATING = 'Automatic rating not assessed in profile B82_core1.';
const TOPOLOGY_LABEL = Object.assign({}, A.TOPOLOGY_LABEL, { '1ph_3w_120_208_network': '120/208 V, 1-ph, 3-wire (network)' });
/** 220.82(A) software gate of this engine (conductor ampacity >= 100 A). One constant for the ordinary gate and the preliminary deferral text. */
const CONDUCTOR_AMPACITY_GATE_A = 100;
// ── STAGE4 preliminary new-design route (docs/stage4-qualification-contract.md) ──
// A DIFFERENT result kind produced by evaluatePreliminary82: never status COMPLETE, never the ordinary LoadCalcResult shape.
const PRELIMINARY_KIND = 'B82_PRELIMINARY_NEW_DESIGN';
const PRELIMINARY_CONTRACT_REVISION = 1;
const PRELIMINARY_STATUS = Object.freeze({ PENDING: 'PRELIMINARY_QUALIFICATION_PENDING', BLOCKED: 'PRELIMINARY_BLOCKED', NOT_APPLICABLE: 'PRELIMINARY_NOT_APPLICABLE' });
const DEFERRED_CONDUCTOR_AMPACITY_CODE = 'CONDUCTOR_AMPACITY_QUALIFICATION_DEFERRED';
const deferredConductorAmpacity = () => ({
  code: DEFERRED_CONDUCTOR_AMPACITY_CODE, deferredEngineCode: 'QUALIFICATION_UNKNOWN', field: 'optional82.conductorAmpacityA', layer: 'input', source: 'engine', ruleRef: '220.82(A)', gateMinA: CONDUCTOR_AMPACITY_GATE_A,
  message: `${DEFERRED_CONDUCTOR_AMPACITY_CODE} at optional82.conductorAmpacityA (220.82(A) conductor ampacity is unknown and deferred on the preliminary new-design route; the method qualification is NOT established until a declared ampacity >= ${CONDUCTOR_AMPACITY_GATE_A} A passes the ordinary calculation)`,
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const codePointCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function safe(n) { if (!Number.isSafeInteger(n)) throw new RangeError('E4 arithmetic left the safe-integer domain'); return n; }
function add(ctx, code, field, layer, extra) {
  const p = Object.assign({ code, field, layer, source: 'engine', ruleRef: null, message: `${code} at ${field}` }, extra || {});
  ctx.problems.push(p);
}
function rankOf(problems) {
  let r = Infinity;
  for (const p of problems) {
    if (p.layer !== 'input') continue;
    const c = p.code;
    const k = (c === 'SCOPE_UNSUPPORTED' || c === 'CAPABILITY_DISABLED') ? RANK.UNSUPPORTED : c === 'RULE_PENDING' ? RANK.BLOCKED : INVALID_CODES.has(c) ? RANK.INVALID : INCOMPLETE_CODES.has(c) ? RANK.INCOMPLETE : c === 'QUALIFICATION_FAILED' ? RANK.UNQUALIFIED : Infinity;
    if (k < r) r = k;
  }
  return r;
}
function statusFromRank(r, unresolved) {
  if (r === RANK.UNSUPPORTED) return 'UNSUPPORTED_SCOPE';
  if (r === RANK.BLOCKED) return 'BLOCKED_PENDING_RULE';
  if (r === RANK.INVALID) return 'INVALID_INPUT';
  if (r === RANK.INCOMPLETE) return 'INCOMPLETE_INPUT';
  if (r === RANK.UNQUALIFIED) return 'UNQUALIFIED_METHOD';
  return unresolved ? 'PARTIAL' : 'COMPLETE';
}
function determiningCode(problems, status) {
  const groups = { UNSUPPORTED_SCOPE: (c) => c === 'SCOPE_UNSUPPORTED' || c === 'CAPABILITY_DISABLED', BLOCKED_PENDING_RULE: (c) => c === 'RULE_PENDING', INVALID_INPUT: (c) => INVALID_CODES.has(c), INCOMPLETE_INPUT: (c) => INCOMPLETE_CODES.has(c), UNQUALIFIED_METHOD: (c) => c === 'QUALIFICATION_FAILED' };
  const g = groups[status]; if (!g) return null;
  const hit = problems.filter((p) => p.layer === 'input' && g(p.code)).sort((a, b) => codePointCompare(a.code, b.code) || codePointCompare(a.field, b.field))[0];
  return hit ? hit.code : null;
}
function line(id, label, op, operands, ruleRef, extra) {
  return Object.assign({ id, label, op, operands, factor: null, unitFactor: null, percent: null, threshold: null, selected: null, controlUnitsRef: null, divisorV: null, powerFactor: null, conductor: null, bindings: [], result: null, ruleRef, amended: false, ruleStatus: 'verified', loadIds: [] }, extra || {});
}
const opRef = (ref, e4) => ({ ref, quantity: { value: V2.projectE4(e4), unit: 'VA' }, loadId: null });
const opLoad = (loadId, e4) => ({ ref: null, quantity: { value: V2.projectE4(e4), unit: 'VA' }, loadId });
const resVA = (e4) => ({ value: V2.projectE4(e4), unit: 'VA', exactE4: safe(e4) });
const vaBinding = (i, l, e4) => ({ kind: 'va', path: `loads[${i}]`, loadId: l.id, ratingValue: l.rating.value, quantity: l.quantity, value: V2.projectE4(e4) });

/** Which parser-error paths are active on the 82 route for this snapshot (category-aware; measurement/multifamily are inactive under 82). */
function isActiveErrorPath(s, field) {
  if (field.startsWith('measurement.') || field.startsWith('multifamily.') || field.startsWith('method.guideAnswers.')) return false;
  // N2b: two named HVAC data fields are inactive unless their arrangement selects them (SPEC-R2 §2.3; retained SPEC-R1 active-field table)
  if (field === 'hvac.supplementalInterlocked') return s.hvac.arrangement === 'heat_pump_with_supplemental';
  if (field === 'hvac.installingAdditionalHvac') return false;   // retained 220.83 datum, unused by this 82 slice
  const m = /^loads\[(\d+)\]\.(.+)$/.exec(field);
  if (!m) return true;
  const l = s.loads[Number(m[1])]; if (!l) return false;
  const sub = m[2];
  if (sub === 'inclusion82') {
    const expected = PREDICATE_BY_CATEGORY[l.category]; if (!expected) return false;               // slot not required → dormant
    return !(isObj(l.inclusion82) && l.inclusion82.predicate !== expected);                          // error retained with an old predicate stays dormant with that fact
  }
  if (sub === 'ratingCoverage82') return l.category === 'ac';
  if (sub === 'separatelyControlledUnits') return l.category === 'electric_space_heat';
  return true;
}
/** Leg / connection validity against the supply topology (retained rule: contract §4, A connectionValidity). */
const SUPPLY_TABLE = { '1ph_2w_120': [120, 120, 1, 2], '1ph_2w_240': [240, null, 1, 2], '1ph_3w_120_240': [240, 120, 1, 3], '1ph_3w_120_208_network': [208, 120, 1, 3], '3ph_4w_208Y_120': [208, 120, 3, 4], '3ph_4w_480Y_277': [480, 277, 3, 4], '3ph_3w_480_delta': [480, null, 3, 3], '3ph_3w_240_delta': [240, null, 3, 3], '3ph_4w_240_delta_highleg': [240, 120, 3, 4] };
function connectionValidity(topology, connection, leg) {
  if (!Object.prototype.hasOwnProperty.call(SUPPLY_TABLE, topology)) return { legInvalid: false, connectionInvalid: false };
  const [, vln, phases, wires] = SUPPLY_TABLE[topology];
  return { legInvalid: leg !== null && (wires === 2 || (phases === 1 && leg === 'L3')), connectionInvalid: (connection === 'LN' && vln === null) || (connection === '3PH' && phases !== 3) };
}

/** Stage 1: every input-layer check, evaluated independently; collects, never returns early. */
function stage1(ctx) {
  const { s, parseErrors, ruleStatus, context } = ctx;
  // M2 (PREMISES-R1-CLOSE-1 §3–4, R2 §2.3 active set): a transported parser error is ACTIVE only when its path belongs to a
  // slot that the CURRENT method/category requires; otherwise it is dormant (retained in the request, never emitted, never a suppressor).
  const parsed = new Set(); const dormant = [];
  for (const pe of parseErrors) {
    if (isActiveErrorPath(s, pe.field)) { parsed.add(pe.field); add(ctx, pe.code, pe.field, 'input', { source: 'parser' }); }
    else dormant.push(pe.field);
  }
  ctx.parsed = parsed; ctx.dormantErrorPaths = dormant;
  // capability (method) — this engine is only reached on the explicit 82 route; anything else is a capability failure, not a silent fallback
  if (s.method.selected !== 'opt_220_82') add(ctx, 'CAPABILITY_DISABLED', 'method.selected', 'input');
  // scope
  if (!parsed.has('occupancy')) { if (s.occupancy === null) add(ctx, 'MISSING_FIELD', 'occupancy', 'input'); else if (s.occupancy !== 'dwelling_unit_house' && s.occupancy !== 'dwelling_unit_apartment') add(ctx, 'SCOPE_UNSUPPORTED', 'occupancy', 'input'); }
  // engine-owned source gates (core rule + cross-reference gate)
  if (ruleStatus['220.82'] !== 'verified') add(ctx, 'RULE_PENDING', 'method.selected', 'input', { ruleRef: '220.82', message: 'RULE_PENDING at method.selected (S-11: NEC 2020 220.82 not verified in this engine configuration)' });
  if (ruleStatus['S-11a'] !== 'verified') add(ctx, 'RULE_PENDING', 'dwelling.smallApplianceCircuits', 'input', { ruleRef: '210.11(C)(1),(2)', message: 'RULE_PENDING at dwelling.smallApplianceCircuits (S-11a not verified in this engine configuration)' });
  // DECISION-1 arrangement gate: known, non-null value, not blocked by an active parser error on the field
  if (!parsed.has('hvac.arrangement')) {
    const arr = s.hvac.arrangement;
    if (arr === null) add(ctx, 'MISSING_FIELD', 'hvac.arrangement', 'input');
    else if (!PROFILE_82.enabledArrangements.includes(arr)) add(ctx, 'CAPABILITY_DISABLED', 'hvac.arrangement', 'input', { message: `CAPABILITY_DISABLED at hvac.arrangement (first-delivery arrangements: ${PROFILE_82.enabledArrangements.join(', ')})` });
  }
  // qualification 220.82(A): topology, single set, conductor ampacity
  if (!parsed.has('supply.topology')) {
    const t = s.supply.topology;
    if (t === null) add(ctx, 'QUALIFICATION_UNKNOWN', 'supply.topology', 'input', { ruleRef: '220.82(A)' });
    else if (t === 'other') add(ctx, 'SCOPE_UNSUPPORTED', 'supply.topology', 'input');
    else if (!PROFILE_82.supportedTopologies.includes(t)) add(ctx, 'QUALIFICATION_FAILED', 'supply.topology', 'input', { ruleRef: '220.82(A)' });
  }
  if (!parsed.has('optional82.singleSupplySet')) { const v = s.optional82.singleSupplySet.value; if (v === null) add(ctx, 'QUALIFICATION_UNKNOWN', 'optional82.singleSupplySet', 'input', { ruleRef: '220.82(A)' }); else if (v === false) add(ctx, 'QUALIFICATION_FAILED', 'optional82.singleSupplySet', 'input', { ruleRef: '220.82(A)' }); }
  if (!parsed.has('optional82.conductorAmpacityA.value')) {
    const v = s.optional82.conductorAmpacityA.value;
    // STAGE4: the ONLY deferrable condition. It is deferred solely on the explicit preliminary route (ctx.deferConductorAmpacity === true)
    // and solely for a well-formed unknown (null with no parser error on the field); it is recorded, never answered or replaced by a number.
    if (v === null) { if (ctx.deferConductorAmpacity === true) ctx.deferred.push(deferredConductorAmpacity()); else add(ctx, 'QUALIFICATION_UNKNOWN', 'optional82.conductorAmpacityA', 'input', { ruleRef: '220.82(A)' }); }
    else { const enc = V2.encodeE4(v); if (!enc.ok) add(ctx, enc.code, 'optional82.conductorAmpacityA.value', 'input'); else if (enc.e4 < CONDUCTOR_AMPACITY_GATE_A * V2.E4) add(ctx, 'QUALIFICATION_FAILED', 'optional82.conductorAmpacityA', 'input', { ruleRef: '220.82(A)' }); }
  }
  // dwelling inputs
  const d = s.dwelling;
  if (!parsed.has('dwelling.floorAreaFt2')) { const v = d.floorAreaFt2; if (v === null) add(ctx, 'MISSING_FIELD', 'dwelling.floorAreaFt2', 'input'); else if (!Number.isSafeInteger(v)) add(ctx, 'NOT_INTEGER', 'dwelling.floorAreaFt2', 'input'); else if (v < 1 || v > V2.DOMAIN.MAX_AREA) add(ctx, 'OUT_OF_RANGE', 'dwelling.floorAreaFt2', 'input'); else ctx.areaFt2 = v; }
  if (!parsed.has('dwelling.smallApplianceCircuits')) { const v = d.smallApplianceCircuits; if (v === null) add(ctx, 'MISSING_FIELD', 'dwelling.smallApplianceCircuits', 'input'); else if (v < 2) add(ctx, 'OUT_OF_RANGE', 'dwelling.smallApplianceCircuits', 'input', { ruleRef: '210.11(C)(1)', message: 'OUT_OF_RANGE at dwelling.smallApplianceCircuits (fewer than the two required small-appliance circuits)' }); else if (v > V2.DOMAIN.MAX_COUNT) add(ctx, 'OUT_OF_RANGE', 'dwelling.smallApplianceCircuits', 'input'); else ctx.saCount = v; }
  if (!parsed.has('dwelling.laundryCircuits')) { const v = d.laundryCircuits; if (v === null) add(ctx, 'MISSING_FIELD', 'dwelling.laundryCircuits', 'input'); else if (v < 0 || v > V2.DOMAIN.MAX_COUNT) add(ctx, 'OUT_OF_RANGE', 'dwelling.laundryCircuits', 'input'); else { ctx.laundryCount = v; if (v === 0 && ruleStatus['I-82-2'] !== 'verified') add(ctx, 'RULE_PENDING', 'dwelling.laundryCircuits', 'input', { ruleRef: '210.11(C)(2)/210.52(F)', message: 'RULE_PENDING at dwelling.laundryCircuits (I-82-2: laundry-circuit count 0 admissibility not resolved)' }); } }
  if (!parsed.has('dwelling.nycAcCircuitCount')) {
    const v = d.nycAcCircuitCount;
    if (v === null) add(ctx, 'MISSING_FIELD', 'dwelling.nycAcCircuitCount', 'input');
    else if (v < 0 || v > V2.DOMAIN.MAX_COUNT) add(ctx, 'OUT_OF_RANGE', 'dwelling.nycAcCircuitCount', 'input');
    else if (ruleStatus['I-82-1'] !== 'verified' && (v > 0 || s.optional82.nycAcCentralExceptionAttested.value !== true)) add(ctx, 'RULE_PENDING', 'dwelling.nycAcCircuitCount', 'input', { ruleRef: 'NYCEC 220.14(N)', message: 'RULE_PENDING at dwelling.nycAcCircuitCount (I-82-1: NYC A/C-circuit load inside 220.82 not resolved)' });
  }
  // loads: domain, identity, categories, source triggers, premises
  const loads = s.loads; ctx.loadE4 = new Map(); ctx.unresolvedReason = new Map(); ctx.acIndex = [];
  if (loads.length > V2.DOMAIN.MAX_RECORDS) add(ctx, 'OUT_OF_RANGE', 'loads', 'input', { message: `OUT_OF_RANGE at loads (more than ${V2.DOMAIN.MAX_RECORDS} records)` });
  const seen = new Set(); let acUnits = 0; let categoryUncertain = false;
  loads.forEach((l, i) => {
    const f = `loads[${i}]`;
    if (seen.has(l.id)) add(ctx, 'DUPLICATE_ID', `${f}.id`, 'input'); seen.add(l.id);
    if (parsed.has(`${f}.category`)) categoryUncertain = true;
    // M1b: retained leg/connection consistency (contract §4; SPEC-R2-CLOSE-1 §4.2 stage-1 set) — a data contradiction, not a phase solver
    const cv = connectionValidity(s.supply.topology, parsed.has(`${f}.connection`) ? null : l.connection, parsed.has(`${f}.leg`) ? null : l.leg);
    if (cv.legInvalid) add(ctx, 'LEG_INVALID', `${f}.leg`, 'input');
    if (cv.connectionInvalid) add(ctx, 'CONNECTION_INVALID', `${f}.connection`, 'input');
    if (!parsed.has(`${f}.rating.value`)) {
      if (l.rating.kind !== 'va') add(ctx, 'UNSUPPORTED_RATING_KIND', `${f}.rating.kind`, 'input');
      else { const enc = V2.encodeE4(l.rating.value); if (!enc.ok) add(ctx, enc.code, `${f}.rating.value`, 'input'); else ctx.loadE4.set(l.id, enc.e4); }
    }
    if (!parsed.has(`${f}.quantity`) && l.quantity > V2.DOMAIN.MAX_QUANTITY) add(ctx, 'OUT_OF_RANGE', `${f}.quantity`, 'input');
    if (!parsed.has(`${f}.category`)) {
      const c = l.category;
      if (c === null) add(ctx, 'MISSING_FIELD', `${f}.category`, 'input');
      else if (c === 'motor' && ruleStatus['I-82-4'] !== 'verified') add(ctx, 'RULE_PENDING', `${f}.category`, 'input', { ruleRef: '220.82(B)(4)', message: `RULE_PENDING at ${f}.category (I-82-4: motor nameplate mapping not resolved)` });
      else if (c === 'ac') { acUnits += l.quantity; ctx.acIndex.push(i); }
      else if (['heat_pump_compressor', 'heat_pump_supplemental', 'electric_space_heat', 'thermal_storage_heat'].includes(c) && s.hvac.arrangement === 'ac_only') add(ctx, 'HVAC_ARRANGEMENT_INCONSISTENT', `${f}.category`, 'input');
    }
    // premise slots — required from the CURRENT category only (PREMISES-1-R1-CLOSE-1)
    const cat = l.category; const expected = PREDICATE_BY_CATEGORY[cat];
    if (expected && !parsed.has(`${f}.inclusion82`)) {
      const fact = l.inclusion82;
      if (!isObj(fact) || fact.answer === null || fact.predicate !== expected) add(ctx, 'MISSING_FIELD', `${f}.inclusion82`, 'input');
      else if (!isObj(fact.basis) || fact.basis.basisId !== l.basisId || fact.basis.category !== cat || fact.basis.quantity !== l.quantity) add(ctx, 'PREMISE_STALE', `${f}.inclusion82`, 'input');
      else if (fact.answer === 'on_counted_laundry_circuit' || fact.answer === 'on_counted_b2_circuit') ctx.unresolvedReason.set(l.id, 'CIRCUIT_BASIS_UNSUPPORTED');
      else if (fact.answer === 'none_of_these') ctx.unresolvedReason.set(l.id, 'INCLUSION_BASIS_UNSUPPORTED');
      else if (cat === 'dryer' ? fact.answer !== 'not_on_counted_laundry_circuit' : !(fact.answer === 'fixed_or_permanently_connected' || fact.answer === 'specific_circuit')) add(ctx, 'MISSING_FIELD', `${f}.inclusion82`, 'input');
    }
    if (cat === 'ac' && !parsed.has(`${f}.ratingCoverage82`)) {
      const fact = l.ratingCoverage82;
      if (!isObj(fact) || fact.value === null) add(ctx, 'MISSING_FIELD', `${f}.ratingCoverage82`, 'input');
      else if (!isObj(fact.basis) || fact.basis.basisId !== l.basisId || fact.basis.category !== cat || fact.basis.quantity !== l.quantity || fact.basis.rating.kind !== l.rating.kind || fact.basis.rating.value !== l.rating.value) add(ctx, 'PREMISE_STALE', `${f}.ratingCoverage82`, 'input');
      else if (fact.value === false) ctx.unresolvedReason.set(l.id, 'AC_RATING_INCOMPLETE');
    }
  });
  if (acUnits > 1 && ruleStatus['I-82-5'] !== 'verified') add(ctx, 'RULE_PENDING', 'hvac.arrangement', 'input', { ruleRef: '220.82(C)(1)', message: 'RULE_PENDING at hvac.arrangement (I-82-5: more than one physical A/C unit; summed ratings not resolved)' });
  // M1a: a known ac_only arrangement REQUIRES its A/C record (exactly one, quantity 1); its absence is the arrangement/record inconsistency — never an implicit `none` and never a zero A/C
  if (!parsed.has('hvac.arrangement') && s.hvac.arrangement === 'ac_only' && acUnits === 0 && !categoryUncertain) add(ctx, 'HVAC_ARRANGEMENT_INCONSISTENT', 'hvac.arrangement', 'input', { message: 'HVAC_ARRANGEMENT_INCONSISTENT at hvac.arrangement (ac_only declared but no ac record is present)' });
  // N2b: the interlock declaration is active only on heat_pump_with_supplemental; a dormant well-formed value never blocks ac_only
  if (s.hvac.arrangement === 'heat_pump_with_supplemental' && !parsed.has('hvac.supplementalInterlocked') && s.hvac.supplementalInterlocked.value !== null && !(isObj(s.hvac.supplementalInterlocked.provenance) && typeof s.hvac.supplementalInterlocked.provenance.source === 'string')) add(ctx, 'MISSING_FIELD', 'hvac.supplementalInterlocked.provenance', 'input', { message: 'MISSING_FIELD at hvac.supplementalInterlocked.provenance (an answered 82 declaration requires provenance.source; R2 §2.3)' });
  if (s.hvac.arrangement === 'heat_pump_with_supplemental' && s.hvac.supplementalInterlocked.value === true && ruleStatus['I-82-3'] !== 'verified') add(ctx, 'RULE_PENDING', 'hvac.supplementalInterlocked', 'input', { ruleRef: '220.82(C)(3)', message: 'RULE_PENDING at hvac.supplementalInterlocked (I-82-3: interlocked heat-pump compressor treatment not resolved)' });
  // inventory declaration (always an object; required on the 82 route)
  if (!parsed.has('optional82.inventoryComplete')) {
    const inv = s.optional82.inventoryComplete;
    if (inv.value === null) add(ctx, 'MISSING_FIELD', 'optional82.inventoryComplete', 'input');
    else {
      const current = loads.map((l) => ({ id: l.id, basisId: l.basisId, category: l.category, quantity: l.quantity })).sort((a, b) => codePointCompare(a.id, b.id));
      const declared = (inv.basis && Array.isArray(inv.basis.members)) ? inv.basis.members.slice().sort((a, b) => codePointCompare(a.id, b.id)) : null;
      const same = declared !== null && declared.length === current.length && declared.every((m, k) => m.id === current[k].id && m.basisId === current[k].basisId && m.category === current[k].category && m.quantity === current[k].quantity);
      if (!same) add(ctx, 'PREMISE_STALE', 'optional82.inventoryComplete', 'input');
      else if (inv.value === false) add(ctx, 'INVENTORY_INCOMPLETE_DECLARED', 'optional82.inventoryComplete', 'input');
    }
  }
  // import guard (explicit request context; consent never enables capability or verifies a rule)
  if (context.importedFrom !== null && s.method.selected === 'opt_220_82' && context.methodConfirmedAfterImport !== true) add(ctx, 'IMPORTED_METHOD_UNCONFIRMED', 'method.selected', 'input');
}

/** Stage 2: coverage, family and the typed graph (only when stage 1 leaves no blocking rank). */
function stage2(ctx) {
  const { s } = ctx; const loads = s.loads; const coverage = []; const reasons = new Map(ctx.unresolvedReason);
  loads.forEach((l) => {
    if (l.classification === 'required') reasons.set(l.id, 'CLASSIFICATION_REQUIRED');
    else if (l.category === 'evse' || l.category === 'other') reasons.set(l.id, 'CATEGORY_UNSUPPORTED_IN_METHOD');
  });
  const isB = (l) => PROFILE_82.bGroup.includes(l.category);
  const anyUnresolved = reasons.size > 0 || loads.some((l) => !isB(l) && l.category !== 'ac');
  const bUnresolved = loads.some((l) => isB(l) && reasons.has(l.id));
  const connected = (l) => safe(ctx.loadE4.get(l.id) * l.quantity);
  if (!anyUnresolved) {
    // COMPLETE family: general chain + ac candidate + total
    const b1 = safe(ctx.areaFt2 * 3 * V2.E4); const b2 = safe((ctx.saCount + ctx.laundryCount) * 1500 * V2.E4);
    const bRecords = loads.map((l, i) => [l, i]).filter(([l]) => isB(l));
    const acRecords = loads.map((l, i) => [l, i]).filter(([l]) => l.category === 'ac');
    const lines = [];
    lines.push(line('b1_area', 'General lighting and receptacles: floor area x 3 VA/ft2', 'multiply_unit', [{ ref: null, quantity: { value: ctx.areaFt2, unit: 'ft2' }, loadId: null }], '220.82(B)(1)', { unitFactor: { value: 3, unit: 'VA_per_ft2' }, bindings: [{ kind: 'area', path: 'dwelling.floorAreaFt2', loadId: null, ratingValue: null, quantity: null, value: ctx.areaFt2 }], result: resVA(b1) }));
    lines.push(line('b2_circuits', 'Small-appliance and laundry branch circuits x 1500 VA', 'multiply_unit', [{ ref: null, quantity: { value: ctx.saCount + ctx.laundryCount, unit: 'count' }, loadId: null }], '220.82(B)(2)', { unitFactor: { value: 1500, unit: 'VA_per_count' }, bindings: [{ kind: 'count', path: 'dwelling.smallApplianceCircuits', loadId: null, ratingValue: null, quantity: null, value: ctx.saCount }, { kind: 'count', path: 'dwelling.laundryCircuits', loadId: null, ratingValue: null, quantity: null, value: ctx.laundryCount }], result: resVA(b2) }));
    let b3 = 0; const genOps = [opRef('b1_area', b1), opRef('b2_circuits', b2)];
    if (bRecords.length) {
      const ops = []; const binds = []; const ids = [];
      for (const [l, i] of bRecords) { const c = connected(l); b3 = safe(b3 + c); ops.push(opLoad(l.id, c)); binds.push(vaBinding(i, l, c)); ids.push(l.id); coverage.push({ loadId: l.id, coverage: 'counted', ruleRef: '220.82(B)(3)', reason: null, viaAggregate: false, candidate: null, governing: null, connectedVA: V2.projectE4(c), demandVA: null, demandFactorScope: 'aggregate_220_82_B' }); }
      lines.push(line('b3_appliances', 'Appliances fastened in place, permanently connected or on a specific circuit (nameplate x quantity)', 'sum', ops, '220.82(B)(3)', { bindings: binds, loadIds: ids, result: resVA(b3) }));
      genOps.push(opRef('b3_appliances', b3));
    }
    const gen = safe(b1 + b2 + b3);
    lines.push(line('gen_connected', 'General loads, total connected', 'sum', genOps, '220.82(B)', { result: resVA(gen) }));
    const cap = 10000 * V2.E4; const t1 = Math.min(gen, cap); const ex = Math.max(gen - cap, 0);
    if (ex % 100 !== 0) throw new RangeError('percent operand is not a multiple of 100 E4 units');
    const t2 = safe((ex / 100) * 40); const genDemand = safe(t1 + t2);
    lines.push(line('gen_tier1', 'First 10 kVA at 100 %', 'min_cap', [opRef('gen_connected', gen)], '220.82(B)', { threshold: { value: 10000, unit: 'VA', exactE4: cap }, result: resVA(t1) }));
    lines.push(line('gen_excess', 'Remainder above 10 kVA', 'excess_over', [opRef('gen_connected', gen)], '220.82(B)', { threshold: { value: 10000, unit: 'VA', exactE4: cap }, result: resVA(ex) }));
    lines.push(line('gen_tier2', 'Remainder at 40 %', 'multiply_percent', [opRef('gen_excess', ex)], '220.82(B)', { percent: 40, result: resVA(t2) }));
    lines.push(line('gen_demand', 'General load demand', 'sum', [opRef('gen_tier1', t1), opRef('gen_tier2', t2)], '220.82(B)', { result: resVA(genDemand) }));
    let total; const cands = {};
    if (acRecords.length) {
      const ops = []; const binds = []; const ids = []; let acConn = 0;
      for (const [l, i] of acRecords) { const c = connected(l); acConn = safe(acConn + c); ops.push(opLoad(l.id, c)); binds.push(vaBinding(i, l, c)); ids.push(l.id); }
      if (acConn % 100 !== 0) throw new RangeError('percent operand is not a multiple of 100 E4 units');
      const c1 = safe((acConn / 100) * 100);
      lines.push(line('ac_connected', 'Air-conditioning equipment, total connected (nameplate x quantity, summed over ac records)', 'sum', ops, '220.82(C)(1)', { bindings: binds, loadIds: ids, result: resVA(acConn) }));
      lines.push(line('c1_ac', 'Air-conditioning equipment at 100 %', 'multiply_percent', [opRef('ac_connected', acConn)], '220.82(C)(1)', { percent: 100, result: resVA(c1) }));
      lines.push(line('hvac_governing', 'Largest heating or air-conditioning load', 'max_of', [opRef('c1_ac', c1)], '220.82(C)', { selected: 'c1_ac', result: resVA(c1) }));
      total = safe(genDemand + c1); cands.c1_ac = V2.projectE4(c1);
      for (const [l] of acRecords) coverage.push({ loadId: l.id, coverage: 'counted', ruleRef: '220.82(C)(1)', reason: null, viaAggregate: false, candidate: 'c1_ac', governing: true, connectedVA: V2.projectE4(connected(l)), demandVA: V2.projectE4(connected(l)), demandFactorScope: 'candidate_percent' });
      lines.push(line('total', 'Calculated load: 220.82(B) + 220.82(C)', 'sum', [opRef('gen_demand', genDemand), opRef('hvac_governing', c1)], '220.82(A)', { result: resVA(total) }));
    } else {
      throw new RangeError('unreachable: a COMPLETE result requires the ac record (stage 1 enforces ac_only ⇒ exactly one ac record)');   // no implicit `none`, no zero A/C
    }
    ctx.coverage = coverage.sort((a, b) => codePointCompare(a.loadId, b.loadId));
    ctx.demand = { status: 'complete', unit: 'VA', totalVA: V2.projectE4(total), totalExactE4: total, totalOnConductorA: null, partialSubtotalVA: null, lines };
    ctx.diag = { operative: false, generalConnectedVA: V2.projectE4(gen), generalDemandVA: V2.projectE4(genDemand), hvacGoverningLine: acRecords.length ? 'c1_ac' : null, hvacCandidatesVA: cands };
    ctx.strings = { totalVA: V2.displayVA(total), generalDemandVA: V2.displayVA(genDemand) };
    ctx.family = 'COMPLETE'; return;
  }
  // PARTIAL families (with or without a general subtotal); HVAC is withheld in both
  const subtotalAvailable = !bUnresolved;
  const lines = []; let genDemand = null; let gen = null;
  if (subtotalAvailable) {
    const b1 = safe(ctx.areaFt2 * 3 * V2.E4); const b2 = safe((ctx.saCount + ctx.laundryCount) * 1500 * V2.E4);
    lines.push(line('b1_area', 'General lighting and receptacles: floor area x 3 VA/ft2', 'multiply_unit', [{ ref: null, quantity: { value: ctx.areaFt2, unit: 'ft2' }, loadId: null }], '220.82(B)(1)', { unitFactor: { value: 3, unit: 'VA_per_ft2' }, bindings: [{ kind: 'area', path: 'dwelling.floorAreaFt2', loadId: null, ratingValue: null, quantity: null, value: ctx.areaFt2 }], result: resVA(b1) }));
    lines.push(line('b2_circuits', 'Small-appliance and laundry branch circuits x 1500 VA', 'multiply_unit', [{ ref: null, quantity: { value: ctx.saCount + ctx.laundryCount, unit: 'count' }, loadId: null }], '220.82(B)(2)', { unitFactor: { value: 1500, unit: 'VA_per_count' }, bindings: [{ kind: 'count', path: 'dwelling.smallApplianceCircuits', loadId: null, ratingValue: null, quantity: null, value: ctx.saCount }, { kind: 'count', path: 'dwelling.laundryCircuits', loadId: null, ratingValue: null, quantity: null, value: ctx.laundryCount }], result: resVA(b2) }));
    let b3 = 0; const genOps = [opRef('b1_area', b1), opRef('b2_circuits', b2)];
    const bRecords = loads.map((l, i) => [l, i]).filter(([l]) => isB(l));
    if (bRecords.length) {
      const ops = []; const binds = []; const ids = [];
      for (const [l, i] of bRecords) { const c = connected(l); b3 = safe(b3 + c); ops.push(opLoad(l.id, c)); binds.push(vaBinding(i, l, c)); ids.push(l.id); coverage.push({ loadId: l.id, coverage: 'counted', ruleRef: '220.82(B)(3)', reason: null, viaAggregate: false, candidate: null, governing: null, connectedVA: V2.projectE4(c), demandVA: null, demandFactorScope: 'aggregate_220_82_B' }); }
      lines.push(line('b3_appliances', 'Appliances fastened in place, permanently connected or on a specific circuit (nameplate x quantity)', 'sum', ops, '220.82(B)(3)', { bindings: binds, loadIds: ids, result: resVA(b3) }));
      genOps.push(opRef('b3_appliances', b3));
    }
    gen = safe(b1 + b2 + b3);
    lines.push(line('gen_connected', 'General loads, total connected', 'sum', genOps, '220.82(B)', { result: resVA(gen) }));
    const cap = 10000 * V2.E4; const t1 = Math.min(gen, cap); const ex = Math.max(gen - cap, 0); const t2 = safe((ex / 100) * 40); genDemand = safe(t1 + t2);
    lines.push(line('gen_tier1', 'First 10 kVA at 100 %', 'min_cap', [opRef('gen_connected', gen)], '220.82(B)', { threshold: { value: 10000, unit: 'VA', exactE4: cap }, result: resVA(t1) }));
    lines.push(line('gen_excess', 'Remainder above 10 kVA', 'excess_over', [opRef('gen_connected', gen)], '220.82(B)', { threshold: { value: 10000, unit: 'VA', exactE4: cap }, result: resVA(ex) }));
    lines.push(line('gen_tier2', 'Remainder at 40 %', 'multiply_percent', [opRef('gen_excess', ex)], '220.82(B)', { percent: 40, result: resVA(t2) }));
    lines.push(line('gen_demand', 'General load demand (resolved general loads only)', 'sum', [opRef('gen_tier1', t1), opRef('gen_tier2', t2)], '220.82(B)', { result: resVA(genDemand) }));
  }
  loads.forEach((l) => {
    if (coverage.some((c) => c.loadId === l.id)) return;
    const known = ctx.loadE4.has(l.id) ? V2.projectE4(connected(l)) : null;
    let reason = reasons.get(l.id) || null;
    if (!reason) reason = l.category === 'ac' ? 'HVAC_WITHHELD_PARTIAL' : isB(l) ? 'GENERAL_WITHHELD_PARTIAL' : 'CATEGORY_UNSUPPORTED_IN_METHOD';
    coverage.push({ loadId: l.id, coverage: 'unresolved', ruleRef: null, reason, viaAggregate: false, candidate: null, governing: null, connectedVA: reason === 'GENERAL_WITHHELD_PARTIAL' ? null : known, demandVA: null, demandFactorScope: null });
  });
  ctx.coverage = coverage.sort((a, b) => codePointCompare(a.loadId, b.loadId));
  for (const c of ctx.coverage) if (c.coverage === 'unresolved') { const i = loads.findIndex((l) => l.id === c.loadId); add(ctx, 'LOAD_UNRESOLVED', `loads[${i}]`, 'demand', { message: `LOAD_UNRESOLVED at loads[${i}] (${c.reason})` }); if (c.reason === 'CLASSIFICATION_REQUIRED') add(ctx, 'CLASSIFICATION_REQUIRED', `loads[${i}].classification`, 'demand'); }
  ctx.demand = { status: 'partial_diagnostic', unit: 'VA', totalVA: null, totalExactE4: null, totalOnConductorA: null, partialSubtotalVA: subtotalAvailable ? V2.projectE4(genDemand) : null, lines };
  ctx.diag = { operative: false, generalConnectedVA: subtotalAvailable ? V2.projectE4(gen) : null, generalDemandVA: subtotalAvailable ? V2.projectE4(genDemand) : null, hvacGoverningLine: null, hvacCandidatesVA: {} };
  ctx.strings = subtotalAvailable ? { generalDemandVA: V2.displayVA(genDemand) } : {};
  ctx.family = subtotalAvailable ? 'PARTIAL_SUBTOTAL' : 'PARTIAL_NO_SUBTOTAL';
}

/** Stage 3: current availability — only after a complete demand; never a blanket VA/V. */
function stage3(ctx) {
  const { s } = ctx; const kind = s.loadModel.kind;
  const notComputed = { status: 'not_computed', model: null, formula: null, assumptions: [], perConductorA: null, lineA: null, neutralA: null, note: NOTE_NEUTRAL };
  if (kind === null) { add(ctx, 'MODEL_NOT_SELECTED', 'loadModel.kind', 'current'); return notComputed; }
  if (!PROFILE_82.enabledModels.includes(kind) || s.supply.topology !== '1ph_3w_120_240') { add(ctx, 'MODEL_UNSUPPORTED', 'loadModel.kind', 'current'); return notComputed; }
  const decl = s.loadModel.declarations.balancedLN;
  if (!decl || decl.value !== true) { add(ctx, 'MODEL_DECLARATION_MISSING', 'loadModel.declarations.balancedLN', 'current'); return notComputed; }
  const I = ctx.demand.totalVA / s.supply.vLineToLine;   // binary64, display-only layer in this method
  ctx.strings.lineA = A.formatNumber(I, 1) + ' A';
  return { status: 'computed', model: kind, formula: 'I = VA / 240', assumptions: ['balancedLN declared'], perConductorA: { L1: I, L2: I, L3: null }, lineA: I, neutralA: null, note: NOTE_NEUTRAL };
}

/**
 * The one engine run shared by the ordinary evaluator and the STAGE4 preliminary route: same stage 1 checks, same stage 2/3
 * arithmetic, same result construction. `deferConductorAmpacity` is an internal boolean set only by preliminaryWith (never read
 * from a request); with `false` this is exactly the accepted evaluator. Returns { result, deferred } — `deferred` is always
 * empty on the ordinary route.
 */
function runEngine(envelope, ruleStatus, deferConductorAmpacity) {
  V2.assertEnvelope82(envelope);
  const s = envelope.snapshot;
  const ctx = { s, parseErrors: envelope.parseErrors, context: envelope.context, ruleStatus, problems: [], coverage: null, demand: null, diag: null, strings: {}, family: null, deferConductorAmpacity: deferConductorAmpacity === true, deferred: [] };
  stage1(ctx);
  const r = rankOf(ctx.problems);
  let current;
  if (r === Infinity) { stage2(ctx); current = ctx.family === 'COMPLETE' ? stage3(ctx) : { status: 'not_computed', model: null, formula: null, assumptions: [], perConductorA: null, lineA: null, neutralA: null, note: NOTE_NEUTRAL }; }
  const unresolved = ctx.coverage ? ctx.coverage.some((c) => c.coverage === 'unresolved') : false;
  const status = statusFromRank(r, unresolved);
  ctx.problems.sort((a, b) => codePointCompare(a.code, b.code) || codePointCompare(a.field, b.field));
  if (r !== Infinity) {
    const code = determiningCode(ctx.problems, status);
    ctx.coverage = s.loads.map((l) => ({ loadId: l.id, coverage: 'unresolved', ruleRef: null, reason: code, viaAggregate: false, candidate: null, governing: null, connectedVA: null, demandVA: null, demandFactorScope: null })).sort((a, b) => codePointCompare(a.loadId, b.loadId));
    ctx.demand = { status: 'not_computed', unit: 'VA', totalVA: null, totalExactE4: null, totalOnConductorA: null, partialSubtotalVA: null, lines: [] };
    ctx.diag = { operative: false, generalConnectedVA: null, generalDemandVA: null, hvacGoverningLine: null, hvacCandidatesVA: {} };
    ctx.strings = {}; ctx.family = 'CLEARED';
    current = { status: 'not_computed', model: null, formula: null, assumptions: [], perConductorA: null, lineA: null, neutralA: null, note: NOTE_NEUTRAL };
  }
  const complete = status === 'COMPLETE';
  const capBlock = complete || status === 'PARTIAL' ? 'COMPARISON_NOT_SUPPORTED' : determiningCode(ctx.problems, status);
  const topo = s.supply.topology; const poles = topo === '1ph_3w_120_240' || topo === '1ph_3w_120_208_network' ? '2-pole' : (topo && topo.startsWith('3ph')) ? '3-pole' : null;
  const references = [{ ruleRef: '220.82', amended: false, href: null }];
  if (s.dwelling.nycAcCircuitCount !== null && s.dwelling.nycAcCircuitCount > 0) references.push({ ruleRef: '220.14(N)', amended: true, href: null });
  const result = {
    schemaVersion: V2.SCHEMA_VERSION_V2, ruleBasis: { code: 'NYCEC-2025', base: 'NEC-2020', amendments: 'NYC-2025' }, profileId: PROFILE_82.id, status,
    problems: ctx.problems, loadsCoverage: ctx.coverage, demand: ctx.demand, current,
    existingCapacity: { status: 'not_assessed', comparisonKind: null, policy: null, ruleRef: null, blockingCode: capBlock, comparisons: [], boundOutcome: null },
    requiredCapacity: { status: 'not_assessed', note: NOTE_REQUIRED_CAPACITY }, rating: { status: 'not_assessed', note: NOTE_RATING },
    diagnostics: ctx.diag,
    display: { precision: { amps: 1, va: 0 }, rounding: 'half_away_from_zero', strings: ctx.strings, feedsComparison: false },
    presentation: { topologyLabel: topo !== null && Object.prototype.hasOwnProperty.call(TOPOLOGY_LABEL, topo) ? TOPOLOGY_LABEL[topo] : '', showPerConductor: topo === '1ph_3w_120_240' || topo === '1ph_3w_120_208_network', polesLabel: poles, finalResultHeading: complete, verdictLabel: complete ? 'not_assessed' : null },   // '' for null/other as in the accepted A presentation contract
    references,
  };
  return { result, deferred: ctx.deferred };
}
function evaluateWith(envelope, ruleStatus) { return runEngine(envelope, ruleStatus, false).result; }

/** Production evaluator: frozen engine-owned constants. */
function evaluate82(envelope) { return evaluateWith(envelope, PROFILE_82.ruleStatus); }

const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); } return v; };
const PRELIMINARY_NEXT = Object.freeze({
  PENDING: { code: 'ESTABLISH_CONDUCTOR_AMPACITY', field: 'optional82.conductorAmpacityA', message: `Preliminary only. Establish and declare the 220.82(A) conductor ampacity (>= ${CONDUCTOR_AMPACITY_GATE_A} A, with documented conditions), then run the ordinary calculation; the ordinary result — not this one — is the calculated load.` },
  BLOCKED: { code: 'RESOLVE_BLOCKERS', field: null, message: 'Resolve every listed problem first. Only a well-formed unknown conductor ampacity can be deferred; no other input, scope, source, inventory or HVAC condition is deferred.' },
  NOT_APPLICABLE: { code: 'USE_ORDINARY_CALCULATION', field: 'optional82.conductorAmpacityA', message: 'A conductor ampacity value is already present in this request. The preliminary route never defers, replaces or re-interprets an existing value; use the ordinary calculation.' },
});
/**
 * STAGE4 preliminary evaluation (docs/stage4-qualification-contract.md). Result kind PRELIMINARY_KIND:
 *   PRELIMINARY_QUALIFICATION_PENDING — every ordinary stage-1 check passed EXCEPT the well-formed unknown conductor ampacity,
 *     and stage 2 resolved every load; `demand`/`current` are the same stage 2/3 outputs the ordinary evaluator builds.
 *   PRELIMINARY_BLOCKED — any other problem (parser error incl. a malformed raw ampacity, scope, capability, pending source rule,
 *     single set, inventory, HVAC, unresolved load coverage …). `blockingStatus` names the ordinary refusal class.
 *   PRELIMINARY_NOT_APPLICABLE — the request already carries an ampacity value (valid or not); nothing is deferred or evaluated.
 * No ampacity number is injected to reach these outputs, and the result is never an ordinary COMPLETE LoadCalcResult:
 * it has no `existingCapacity`/`requiredCapacity`/`rating` blocks, `ordinaryResult` is false and the heading/verdict are withheld.
 */
function preliminaryWith(envelope, ruleStatus) {
  V2.assertEnvelope82(envelope);
  const s = envelope.snapshot; const declared = s.optional82.conductorAmpacityA.value;
  const head = { kind: PRELIMINARY_KIND, preliminaryContractRevision: PRELIMINARY_CONTRACT_REVISION, schemaVersion: V2.SCHEMA_VERSION_V2, ruleBasis: { code: 'NYCEC-2025', base: 'NEC-2020', amendments: 'NYC-2025' }, profileId: PROFILE_82.id };
  const flags = { ordinaryResult: false, qualificationEstablished: false, operative: false };
  const noCurrent = () => ({ status: 'not_computed', model: null, formula: null, assumptions: [], perConductorA: null, lineA: null, neutralA: null, note: NOTE_NEUTRAL });
  const topo = s.supply.topology;
  if (declared !== null) {
    const problem = { code: 'PRELIMINARY_NOT_APPLICABLE', field: 'optional82.conductorAmpacityA', layer: 'input', source: 'engine', ruleRef: '220.82(A)', message: 'PRELIMINARY_NOT_APPLICABLE at optional82.conductorAmpacityA (a conductor ampacity value is present; the preliminary route exists only for a well-formed unknown and never replaces an existing value)' };
    return deepFreeze(Object.assign({}, head, { status: PRELIMINARY_STATUS.NOT_APPLICABLE, blockingStatus: null }, flags, {
      deferred: [], problems: [problem], loadsCoverage: [],
      demand: { status: 'not_computed', unit: 'VA', totalVA: null, totalExactE4: null, totalOnConductorA: null, partialSubtotalVA: null, lines: [] }, current: noCurrent(),
      diagnostics: { operative: false, generalConnectedVA: null, generalDemandVA: null, hvacGoverningLine: null, hvacCandidatesVA: {} },
      display: { precision: { amps: 1, va: 0 }, rounding: 'half_away_from_zero', strings: {}, feedsComparison: false },
      presentation: { topologyLabel: topo !== null && Object.prototype.hasOwnProperty.call(TOPOLOGY_LABEL, topo) ? TOPOLOGY_LABEL[topo] : '', showPerConductor: false, polesLabel: null, finalResultHeading: false, verdictLabel: null },
      references: [{ ruleRef: '220.82', amended: false, href: null }], nextAction: PRELIMINARY_NEXT.NOT_APPLICABLE,
    }));
  }
  const { result: r, deferred } = runEngine(envelope, ruleStatus, true);
  // Pending = the shared run found nothing else (its internal family is the complete one). With a null value that family is
  // reachable ONLY through the one recorded deferral: a parser error on the ampacity field skips the deferral branch and is an
  // ordinary blocking problem. Anything else is an engine fault and is thrown, never surfaced as a result.
  const pending = r.status === 'COMPLETE';
  if (pending && !(r.demand.status === 'complete' && deferred.length === 1 && deferred[0].code === DEFERRED_CONDUCTOR_AMPACITY_CODE)) throw new RangeError('unreachable: a preliminary pending result requires exactly the one deferred conductor-ampacity condition');
  const blockingStatus = pending ? null : r.status;
  return deepFreeze(Object.assign({}, head, { status: pending ? PRELIMINARY_STATUS.PENDING : PRELIMINARY_STATUS.BLOCKED, blockingStatus }, flags, {
    deferred: pending ? deferred : [], problems: r.problems, loadsCoverage: r.loadsCoverage,
    demand: r.demand, current: pending ? r.current : noCurrent(), diagnostics: r.diagnostics,
    display: { precision: r.display.precision, rounding: r.display.rounding, strings: pending || r.status === 'PARTIAL' ? r.display.strings : {}, feedsComparison: false },
    presentation: Object.assign({}, r.presentation, { finalResultHeading: false, verdictLabel: null }),
    references: r.references, nextAction: pending ? PRELIMINARY_NEXT.PENDING : PRELIMINARY_NEXT.BLOCKED,
  }));
}
/** Production preliminary evaluator: the same frozen engine-owned rule constants as evaluate82. */
function evaluatePreliminary82(envelope) { return preliminaryWith(envelope, PROFILE_82.ruleStatus); }

/**
 * TEST-ONLY (non-escalating): build an evaluator in which one or both of the rules that are `verified` in the production
 * constants ('220.82', 'S-11a') are treated as `pending`, for the hypothetical pending-source fixtures (LC82-14/14b/16a).
 * It can never promote a pending interpretation (I-82-1…5) to `verified`, never accepts other keys or values, is not
 * reachable from any request field and is not used by the facade. The same contract is validated by tools/contract_invariants_82.py.
 */
const TEST_ONLY_PENDING_KEYS = Object.freeze(['220.82', 'S-11a']);
function testOnlyPendingRuleStatus(pendingConfig) {
  const merged = Object.assign({}, RULE_STATUS_DEFAULT);
  for (const k of Object.keys(pendingConfig || {})) {
    if (!TEST_ONLY_PENDING_KEYS.includes(k)) throw new Error(`test configuration may only make ${TEST_ONLY_PENDING_KEYS.join('/')} pending; got ${k}`);
    if (pendingConfig[k] !== 'pending') throw new Error(`test configuration value must be 'pending' (never an escalation to verified); got ${pendingConfig[k]}`);
    merged[k] = 'pending';
  }
  return Object.freeze(merged);
}
const TEST_ONLY = Object.freeze({
  PENDING_KEYS: TEST_ONLY_PENDING_KEYS,
  createPendingSourceEvaluator(pendingConfig) {
    const frozen = testOnlyPendingRuleStatus(pendingConfig);
    return (envelope) => evaluateWith(envelope, frozen);
  },
  /** STAGE4: the same non-escalating pending-source configuration applied to the preliminary route (a pending source rule stays a blocker there). */
  createPendingSourcePreliminaryEvaluator(pendingConfig) {
    const frozen = testOnlyPendingRuleStatus(pendingConfig);
    return (envelope) => preliminaryWith(envelope, frozen);
  },
});

module.exports = {
  evaluate82, PROFILE_82, RULE_STATUS_DEFAULT, TEST_ONLY, NOTE_REQUIRED_CAPACITY, NOTE_RATING, TOPOLOGY_LABEL_82: TOPOLOGY_LABEL, INVALID_CODES, INCOMPLETE_CODES, PREDICATE_BY_CATEGORY,
  // STAGE4 preliminary new-design route (a separate result kind; the ordinary evaluator and its outputs are unchanged)
  evaluatePreliminary82, PRELIMINARY_KIND, PRELIMINARY_STATUS, PRELIMINARY_CONTRACT_REVISION, DEFERRED_CONDUCTOR_AMPACITY_CODE, CONDUCTOR_AMPACITY_GATE_A,
};
