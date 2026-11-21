'use strict';
/**
 * Empire Code — Load Calc V2 request boundary (LC-22082-B0-CORE-1).
 *
 * Structural (L2) validation of the proposed V2 request:
 *   { apiVersion: 2, profileId: 'AB82_core1', context, parseErrors[], snapshot (schemaVersion '3.3.0') }
 * plus the E4 encoding policy and the down-conversion of a V2 request to an
 * unchanged A envelope (deep copy, 82-only keys/errors stripped).
 *
 * Sources: SPEC-R2 §2.1–2.3 (facade/context/L2), R2-CLOSE-1 §2 (E4 encoding,
 * domain), R2-CLOSE-2 §2.1/§4.1 (canonical projection, L2 vs parser vs L3),
 * B0-PREMISES-1 + R1 + R1-CLOSE-1 (premise slots, basisId, declared objects),
 * DECISION-1 (arrangement gate at L3 — enum shape only here).
 *
 * The accepted A validator (loadCalcInput.js) is neither modified nor widened:
 * this module owns its own bounded spec mini-language (same conventions).
 */
const A = require('./loadCalcInput.js');

const E = A.ENUMS;
const SCHEMA_VERSION_V2 = '3.3.0';
const SCHEMA_VERSION_A = '3.2.1';
const API_VERSION = 2;
const CAPABILITY_PROFILE_ID = 'AB82_core1';
const ENGINE_PROFILE_ID_82 = 'B82_core1';
const ENGINE_PROFILE_ID_A = 'A_measured_87_core';

const E2 = Object.freeze({
  inclusionPredicate: ['b3c_dryer_not_on_counted_laundry_circuit', 'b3a_fixed_or_specific_circuit'],
  inclusionAnswer: ['not_on_counted_laundry_circuit', 'on_counted_laundry_circuit', 'fixed_or_permanently_connected', 'specific_circuit', 'on_counted_b2_circuit', 'none_of_these', null],
  parseCode: ['NOT_FINITE', 'NOT_INTEGER', 'OUT_OF_RANGE', 'UNKNOWN_ENUM', 'MISSING_FIELD', 'PARSE_REJECTED'],
});

// ── spec mini-language (bounded copy of the A conventions; A's implementation is not exported) ──
const nullable = (t) => ({ t: [t, 'null'] });
const declBool = { obj: { value: nullable('boolean'), provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] } }, req: ['value'] };   // exactly the A shape (provenance optional at L2; the 82 engine reads value only)
const declNumber = { obj: { value: nullable('number'), provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] } }, req: ['value'] };
// 82-only declared objects (optional82.*): provenance.source is REQUIRED at this boundary (SPEC-R2 §2.3 'provenance: required'; PREMISES-R1 §4A) — the A shapes above stay as A
const declBool82 = { obj: { value: nullable('boolean'), provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] } }, req: ['value', 'provenance'] };
const declNumber82 = { obj: { value: nullable('number'), provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] } }, req: ['value', 'provenance'] };
const RATING = { obj: { kind: { enum: E.ratingKind }, value: { t: 'number' }, volts: nullable('number') }, req: ['kind', 'value'] };
const ALMS = { obj: { present: { t: 'boolean' }, maxLoadVA: nullable('number') }, req: ['present'] };
const LEGACY_ITEM = { obj: { id: { t: 'string' }, name: { t: 'string' }, va: { t: 'number' }, category: { t: 'string' } }, req: ['id', 'name', 'va', 'category'] };
const INCLUSION_BASIS = { obj: { basisId: { t: 'string', minLength: 1 }, category: { enum: E.category }, quantity: { t: 'integer', min: 1 } }, req: ['basisId', 'category', 'quantity'] };
const INCLUSION82 = { obj: { predicate: { enum: E2.inclusionPredicate }, answer: { enum: E2.inclusionAnswer }, basis: { anyOf: [INCLUSION_BASIS, { t: 'null' }] } }, req: ['predicate', 'answer', 'basis'] };
const COVERAGE_BASIS = { obj: { basisId: { t: 'string', minLength: 1 }, category: { enum: E.category }, quantity: { t: 'integer', min: 1 }, rating: { obj: { kind: { enum: E.ratingKind }, value: { t: 'number' } }, req: ['kind', 'value'] } }, req: ['basisId', 'category', 'quantity', 'rating'] };
const RATING_COVERAGE82 = { obj: { value: nullable('boolean'), basis: { anyOf: [COVERAGE_BASIS, { t: 'null' }] } }, req: ['value', 'basis'] };
const LOAD = { obj: {
  id: { t: 'string', minLength: 1 }, label: { t: 'string' }, legacy: { anyOf: [LEGACY_ITEM, { t: 'null' }] }, category: { enum: E.category }, classification: { enum: E.classification },
  rating: RATING, quantity: { t: 'integer', min: 1 }, status: { enum: E.loadStatus }, continuous: nullable('boolean'), connection: { enum: E.connection }, leg: { enum: E.leg },
  separatelyControlledUnits: nullable('integer'), alms: ALMS,
  basisId: { t: 'string', minLength: 1 }, inclusion82: { anyOf: [INCLUSION82, { t: 'null' }] }, ratingCoverage82: { anyOf: [RATING_COVERAGE82, { t: 'null' }] },
}, req: ['id', 'category', 'classification', 'rating', 'quantity', 'status', 'continuous', 'connection', 'leg', 'basisId', 'inclusion82', 'ratingCoverage82'] };   // A's required set + the three 82 fields
const MEMBER = { obj: { id: { t: 'string', minLength: 1 }, basisId: { t: 'string', minLength: 1 }, category: { enum: E.category }, quantity: { t: 'integer', min: 1 } }, req: ['id', 'basisId', 'category', 'quantity'] };
const INVENTORY = { obj: { value: nullable('boolean'), provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] }, basis: { anyOf: [{ obj: { members: { arr: MEMBER } }, req: ['members'] }, { t: 'null' }] } }, req: ['value', 'provenance', 'basis'] };
const OPTIONAL82 = { obj: { singleSupplySet: declBool82, conductorAmpacityA: declNumber82, nycAcCentralExceptionAttested: declBool82, laundryExceptionAttested: declBool82, inventoryComplete: INVENTORY }, req: ['singleSupplySet', 'conductorAmpacityA', 'nycAcCentralExceptionAttested', 'laundryExceptionAttested', 'inventoryComplete'] };
const NEW_LOAD_BASIS = { obj: { method: { enum: E.basisMethod }, ruleRefs: { arr: { t: 'string' } }, demandFactorsApplied: nullable('boolean'), continuousFactorApplied: nullable('boolean'), establishedForThisComparison: nullable('boolean'), calculatedBy: { enum: E.calculatedBy }, provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] }, note: nullable('string') }, req: ['method', 'ruleRefs', 'demandFactorsApplied', 'continuousFactorApplied', 'establishedForThisComparison', 'calculatedBy'] };
const COVERS_ENTRY = { obj: { id: { t: 'string' }, category: { enum: E.category }, classification: { enum: E.classification }, rating: RATING, quantity: { t: 'integer', min: 1 }, status: { enum: E.loadStatus }, continuous: nullable('boolean'), connection: { enum: E.connection }, leg: { enum: E.leg }, separatelyControlledUnits: nullable('integer'), alms: ALMS }, req: ['id', 'category', 'classification', 'rating', 'quantity', 'status', 'continuous', 'connection', 'leg', 'separatelyControlledUnits', 'alms'] };
const PRECALCULATED = { obj: { va: { t: ['number', 'null'], min: 0 }, connection: { enum: E.connection }, leg: { enum: E.leg }, continuous: nullable('boolean'), basis: NEW_LOAD_BASIS, covers: { arr: { t: 'string' } }, coversSnapshot: { anyOf: [{ arr: COVERS_ENTRY }, { t: 'null' }] } }, req: ['va', 'connection', 'leg', 'continuous', 'basis', 'covers', 'coversSnapshot'] };
const NEW_LOAD = { obj: { mode: { enum: E.newLoadMode }, precalculated: { anyOf: [PRECALCULATED, { t: 'null' }] } }, req: ['mode', 'precalculated'] };
const MEASUREMENT = { obj: {
  basis: { enum: E.basis }, reading: { obj: { value: nullable('number'), unit: { enum: E.readingUnit } }, req: ['value', 'unit'] },
  readingsPerConductor: { anyOf: [{ obj: { L1: nullable('number'), L2: nullable('number'), L3: nullable('number') }, req: [] }, { t: 'null' }] },
  readingScope: { enum: E.readingScope }, powerFactor: nullable('number'), annualDataAvailable: declBool, periodMonths: nullable('integer'), periodDays: nullable('integer'), intervalMinutes: nullable('integer'),
  metric: { enum: E.metric }, continuousRecording: declBool, instrument: { enum: E.instrument }, connectedTo: { enum: E.connectedTo }, basedOnInitialLoading: declBool, recordedWhileOccupied: declBool,
  includesLargerOfHeatingOrCooling: declBool, includesPeriodicSeasonalLoads: declBool, hasRenewableEnergySystem: declBool, hasPeakLoadShaving: declBool,
  existing: { obj: { serviceRatingA: nullable('number'), feederAmpacityA: nullable('number'), ocpdA: nullable('number'), feederOcpPer240_4: declBool, serviceOverloadPer230_90: declBool }, req: [] },
  newLoad: NEW_LOAD,
}, req: ['basis', 'reading', 'readingScope', 'newLoad'] };
const TRANSFORM = { obj: { itemId: { t: 'string' }, legacy: LEGACY_ITEM, target: { enum: E.transformTarget }, targetId: nullable('string'), contribution: nullable('number'), status: { enum: E.transformStatus }, reason: { enum: E.problemCode.concat([null]) }, note: nullable('string') }, req: ['itemId', 'legacy', 'target', 'targetId', 'contribution', 'status', 'reason'] };
const MIGRATION = { obj: { from: { const: 1 }, savePolicy: { const: 'save_as_copy' }, sourceRecord: { obj: { method: nullable('string'), voltage: nullable('string'), scope: nullable('string'), sqFt: nullable('string'), appliances: nullable('string'), hvac: nullable('string'), ev: nullable('string'), lcMeterVA: nullable('string'), lcNumUnits: nullable('string'), lcHouseLoads: nullable('string') }, req: [] }, transforms: { arr: TRANSFORM }, unresolvedItems: { arr: TRANSFORM }, fieldMap: { map: nullable('string') }, notes: { arr: { t: 'string' } } }, req: ['from', 'savePolicy', 'sourceRecord', 'transforms', 'unresolvedItems', 'fieldMap'] };
const SNAPSHOT_V2 = { obj: {
  schemaVersion: { const: SCHEMA_VERSION_V2 },
  ruleBasis: { obj: { code: { const: 'NYCEC-2025' }, base: { const: 'NEC-2020' }, amendments: { const: 'NYC-2025' } }, req: ['code', 'base', 'amendments'] },
  purpose: { enum: E.purpose }, occupancy: { enum: E.occupancy },
  supply: { obj: { topology: { enum: E.topology }, vLineToLine: nullable('number'), vLineToNeutral: nullable('number'), phases: { enum: [1, 3, null] }, wires: { enum: [2, 3, 4, null] } }, req: ['topology', 'vLineToLine', 'vLineToNeutral', 'phases', 'wires'] },
  loadModel: { obj: { kind: { enum: E.modelKind }, declarations: { obj: { unityPF: declBool, balancedLN: declBool, balanced3ph: declBool }, req: [] } }, req: ['kind', 'declarations'] },
  method: { obj: { selected: { enum: E.method }, guideRecommendation: { enum: E.method }, selectionSource: { enum: E.selectionSource }, guideAnswers: { obj: { houseFeeder: { enum: E.houseFeeder }, aptFeeder: { enum: E.houseFeeder }, houseState: { enum: E.houseState }, bldgCooking: { enum: E.bldgCooking } }, req: [] } }, req: ['selected', 'guideRecommendation', 'selectionSource', 'guideAnswers'] },
  dwelling: { obj: { floorAreaFt2: nullable('number'), smallApplianceCircuits: nullable('integer'), laundryCircuits: nullable('integer'), nycAcCircuitCount: nullable('integer'), existingDwelling: nullable('boolean') }, req: ['floorAreaFt2', 'smallApplianceCircuits', 'laundryCircuits', 'nycAcCircuitCount', 'existingDwelling'] },
  optional82: OPTIONAL82,
  loads: { arr: LOAD },
  hvac: { obj: { arrangement: { enum: E.hvacArrangement }, supplementalInterlocked: declBool, installingAdditionalHvac: declBool }, req: ['arrangement', 'supplementalInterlocked', 'installingAdditionalHvac'] },
  measurement: { anyOf: [MEASUREMENT, { t: 'null' }] },
  multifamily: { obj: { unitCount: nullable('integer'), unitsIdentical: nullable('boolean'), unitGroups: { t: 'array' }, allUnitsElectricCooking: declBool, allUnitsElectricHeatOrAc: declBool, singleFeederPerUnit: declBool, houseLoads: { obj: { mode: { enum: E.houseLoadsMode }, va: nullable('number'), items: { t: 'array' } }, req: ['mode', 'va', 'items'] } }, req: ['unitCount', 'unitsIdentical', 'unitGroups', 'allUnitsElectricCooking', 'allUnitsElectricHeatOrAc', 'singleFeederPerUnit', 'houseLoads'] },
  migration: { anyOf: [MIGRATION, { t: 'null' }] },
}, req: ['schemaVersion', 'ruleBasis', 'purpose', 'occupancy', 'supply', 'loadModel', 'method', 'dwelling', 'optional82', 'loads', 'hvac', 'measurement', 'multifamily', 'migration'] };
const PARSE_ERROR = { obj: { field: { t: 'string', minLength: 1 }, raw: nullable('string'), code: { enum: E2.parseCode } }, req: ['field', 'raw', 'code'] };
const CONTEXT = { obj: { importedFrom: { anyOf: [{ obj: { lcv: { t: 'integer', min: 1 }, profileId: { t: 'string' }, schemaVersion: { t: 'string' } }, req: ['lcv', 'profileId', 'schemaVersion'] }, { t: 'null' }] }, methodConfirmedAfterImport: { t: 'boolean' } }, req: ['importedFrom', 'methodConfirmedAfterImport'] };
const REQUEST_V2 = { obj: { apiVersion: { const: API_VERSION }, profileId: { enum: [CAPABILITY_PROFILE_ID] }, context: CONTEXT, parseErrors: { arr: PARSE_ERROR }, snapshot: SNAPSHOT_V2 }, req: ['apiVersion', 'profileId', 'context', 'parseErrors', 'snapshot'] };
const ENVELOPE_82 = { obj: { snapshot: SNAPSHOT_V2, parseErrors: { arr: PARSE_ERROR }, profileId: { enum: [ENGINE_PROFILE_ID_82] }, context: CONTEXT }, req: ['snapshot', 'parseErrors', 'profileId', 'context'] };

const COUPLING = {
  '1ph_2w_120': [120, 120, 1, 2], '1ph_2w_240': [240, null, 1, 2], '1ph_3w_120_240': [240, 120, 1, 3], '1ph_3w_120_208_network': [208, 120, 1, 3],
  '3ph_4w_208Y_120': [208, 120, 3, 4], '3ph_4w_480Y_277': [480, 277, 3, 4], '3ph_3w_480_delta': [480, null, 3, 3],
  '3ph_3w_240_delta': [240, null, 3, 3], '3ph_4w_240_delta_highleg': [240, 120, 3, 4], other: [null, null, null, null], null: [null, null, null, null],
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function typeOk(v, t) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return isNum(v);
    case 'integer': return isNum(v) && Number.isSafeInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    default: return false;
  }
}
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const jsonEq = (a, b) => typeof a === typeof b && a === b;
function check(v, spec, path, errs) {
  if (spec.anyOf) {
    let closest = null;
    for (const s of spec.anyOf) { const sub = []; check(v, s, path, sub); if (!sub.length) return; if (closest === null || sub.length < closest.length) closest = sub; }
    for (const e of closest.slice(0, 3)) errs.push(e);
    errs.push(`${path}: matches no allowed shape`); return;
  }
  if (own(spec, 'const')) { if (!jsonEq(v, spec.const)) errs.push(`${path}: must be ${JSON.stringify(spec.const)}`); return; }
  if (spec.enum) { if (!spec.enum.some((e) => jsonEq(v, e))) errs.push(`${path}: not one of ${JSON.stringify(spec.enum)}`); return; }
  if (spec.t) {
    const types = Array.isArray(spec.t) ? spec.t : [spec.t];
    if (!types.some((t) => typeOk(v, t))) { errs.push(`${path}: expected ${types.join('|')}`); return; }
    if (typeof v === 'number' && typeof spec.min === 'number' && v < spec.min) errs.push(`${path}: below minimum ${spec.min}`);
    if (typeof v === 'string' && typeof spec.minLength === 'number' && v.length < spec.minLength) errs.push(`${path}: shorter than ${spec.minLength}`);
    return;
  }
  if (spec.arr) { if (!Array.isArray(v)) { errs.push(`${path}: expected array`); return; } v.forEach((it, k) => check(it, spec.arr, `${path}[${k}]`, errs)); return; }
  if (spec.map) { if (!typeOk(v, 'object')) { errs.push(`${path}: expected object`); return; } for (const k of Object.keys(v)) check(v[k], spec.map, `${path}.${k}`, errs); return; }
  if (spec.obj) {
    if (!typeOk(v, 'object')) { errs.push(`${path}: expected object`); return; }
    for (const k of spec.req) if (!own(v, k)) errs.push(`${path}: missing required ${k}`);
    for (const k of Object.keys(v)) { if (!own(spec.obj, k)) { errs.push(`${path}: unexpected property ${k}`); continue; } check(v[k], spec.obj[k], `${path}.${k}`, errs); }
  }
}
function couplingErrors(supply, path, errs) {
  if (!typeOk(supply, 'object') || !own(supply, 'topology')) return;
  const key = supply.topology === null ? 'null' : supply.topology;
  if (!own(COUPLING, key)) return;
  const [vll, vln, ph, w] = COUPLING[key]; const want = { vLineToLine: vll, vLineToNeutral: vln, phases: ph, wires: w };
  for (const k of Object.keys(want)) if (own(supply, k) && !jsonEq(supply[k], want[k])) errs.push(`${path}.${k}: must be ${JSON.stringify(want[k])} for topology ${JSON.stringify(supply.topology)} (CONTRADICTORY_SUPPLY)`);
}

/**
 * Canonical V2 field paths a parser error may name (the adapter-owned error map, closed set).
 * Exact paths only — no prefix matching, no path execution. `loads[N]` requires a canonical
 * decimal index (0 or no leading zero) that resolves to an existing record of the snapshot.
 * Fields under a nullable parent (measurement.*, multifamily.*) stay legal while the parent is
 * null: a known unanswered field is not an unknown path.
 */
const SCALAR_PATHS = new Set([
  'occupancy', 'purpose', 'supply.topology', 'loadModel.kind', 'method.selected',
  'method.guideAnswers.houseFeeder', 'method.guideAnswers.aptFeeder', 'method.guideAnswers.houseState', 'method.guideAnswers.bldgCooking',   // N2a: accepted A LC_FIELDS guide keys (mobile.html 9485-9499) — legal in the projection to A
  'dwelling.floorAreaFt2', 'dwelling.smallApplianceCircuits', 'dwelling.laundryCircuits', 'dwelling.nycAcCircuitCount', 'dwelling.existingDwelling',
  'hvac.arrangement', 'hvac.supplementalInterlocked', 'hvac.installingAdditionalHvac',
  'optional82.singleSupplySet', 'optional82.conductorAmpacityA.value', 'optional82.nycAcCentralExceptionAttested', 'optional82.laundryExceptionAttested', 'optional82.inventoryComplete',
  'measurement.basis', 'measurement.reading.value', 'measurement.reading.unit', 'measurement.readingsPerConductor.L1', 'measurement.readingsPerConductor.L2', 'measurement.readingsPerConductor.L3',
  'measurement.readingScope', 'measurement.powerFactor', 'measurement.annualDataAvailable', 'measurement.periodMonths', 'measurement.periodDays', 'measurement.intervalMinutes', 'measurement.metric',
  'measurement.continuousRecording', 'measurement.instrument', 'measurement.connectedTo', 'measurement.basedOnInitialLoading', 'measurement.recordedWhileOccupied', 'measurement.includesLargerOfHeatingOrCooling',
  'measurement.includesPeriodicSeasonalLoads', 'measurement.hasRenewableEnergySystem', 'measurement.hasPeakLoadShaving',
  'measurement.existing.serviceRatingA', 'measurement.existing.feederAmpacityA', 'measurement.existing.ocpdA', 'measurement.existing.feederOcpPer240_4', 'measurement.existing.serviceOverloadPer230_90',
  'measurement.newLoad.mode', 'measurement.newLoad.precalculated.va', 'measurement.newLoad.precalculated.connection', 'measurement.newLoad.precalculated.leg', 'measurement.newLoad.precalculated.continuous',
  'measurement.newLoad.precalculated.covers', 'measurement.newLoad.precalculated.basis.method', 'measurement.newLoad.precalculated.basis.ruleRefs', 'measurement.newLoad.precalculated.basis.demandFactorsApplied',
  'measurement.newLoad.precalculated.basis.continuousFactorApplied', 'measurement.newLoad.precalculated.basis.establishedForThisComparison', 'measurement.newLoad.precalculated.basis.calculatedBy',
  'multifamily.unitCount', 'multifamily.unitsIdentical', 'multifamily.allUnitsElectricCooking', 'multifamily.allUnitsElectricHeatOrAc', 'multifamily.singleFeederPerUnit', 'multifamily.houseLoads.mode', 'multifamily.houseLoads.va',
]);
const LOAD_FIELDS = new Set(['rating.value', 'quantity', 'separatelyControlledUnits', 'category', 'status', 'continuous', 'connection', 'leg', 'inclusion82', 'ratingCoverage82']);
const LOAD_PATH_RE = /^loads\[(0|[1-9][0-9]*)\]\.([A-Za-z0-9_.]+)$/;
/** Returns null when `field` is a canonical path of this snapshot, else a reason string. */
function parsePathProblem(field, snapshot) {
  if (typeof field !== 'string') return 'not a string';
  if (SCALAR_PATHS.has(field)) return null;
  const m = LOAD_PATH_RE.exec(field);
  if (!m) return 'not a canonical V2 field path';
  if (!LOAD_FIELDS.has(m[2])) return 'not a canonical load field';
  const idx = Number(m[1]); const loads = typeOk(snapshot, 'object') && Array.isArray(snapshot.loads) ? snapshot.loads : null;
  if (loads === null || idx >= loads.length) return 'load index does not resolve to a record of this snapshot';
  return null;
}
const V2_PARSE_PATH_RE = null; // superseded by parsePathProblem (kept as a name for API stability; not a validator)
const PATH_82_ONLY_RE = /^(optional82\.|loads\[\d+\]\.(inclusion82|ratingCoverage82)$)/;

/** Semantic-structural couplings that are still L2 (declared-object convention): an answer requires its basis. */
function declarationShapeErrors(snapshot, path, errs) {
  if (!typeOk(snapshot, 'object')) return;
  if (typeOk(snapshot.optional82, 'object') && typeOk(snapshot.optional82.inventoryComplete, 'object')) {
    const inv = snapshot.optional82.inventoryComplete;
    if (inv.value !== null && inv.value !== undefined && !typeOk(inv.basis, 'object')) errs.push(`${path}.optional82.inventoryComplete: an answered declaration requires a basis object`);
  }
  if (Array.isArray(snapshot.loads)) snapshot.loads.forEach((l, i) => {
    if (!typeOk(l, 'object')) return;
    if (typeOk(l.inclusion82, 'object') && l.inclusion82.answer !== null && l.inclusion82.answer !== undefined && !typeOk(l.inclusion82.basis, 'object')) errs.push(`${path}.loads[${i}].inclusion82: an answered predicate requires a basis object`);
    if (typeOk(l.ratingCoverage82, 'object') && l.ratingCoverage82.value !== null && l.ratingCoverage82.value !== undefined && !typeOk(l.ratingCoverage82.basis, 'object')) errs.push(`${path}.loads[${i}].ratingCoverage82: an answered declaration requires a basis object`);
  });
}

function validateSnapshotV2(snapshot) {
  const rep = A.jsonRepresentabilityErrors(snapshot, 'snapshot'); if (rep.length) return rep;
  const errs = []; check(snapshot, SNAPSHOT_V2, 'snapshot', errs);
  if (typeOk(snapshot, 'object')) { couplingErrors(snapshot.supply, 'snapshot.supply', errs); declarationShapeErrors(snapshot, 'snapshot', errs); }
  return errs;
}
function parseErrorPathErrors(parseErrors, path, errs, snapshot) {
  if (!Array.isArray(parseErrors)) return;
  parseErrors.forEach((pe, k) => { if (typeOk(pe, 'object') && typeof pe.field === 'string') { const why = parsePathProblem(pe.field, snapshot); if (why) errs.push(`${path}[${k}].field: ${why}`); } });
}
/** Structural check of a V2 request. Returns error strings (empty = structurally valid). */
function validateRequestV2(request) {
  const rep = A.jsonRepresentabilityErrors(request, 'request'); if (rep.length) return rep;
  const errs = []; check(request, REQUEST_V2, 'request', errs);
  if (typeOk(request, 'object')) {
    if (typeOk(request.snapshot, 'object')) { couplingErrors(request.snapshot.supply, 'request.snapshot.supply', errs); declarationShapeErrors(request.snapshot, 'request.snapshot', errs); }
    parseErrorPathErrors(request.parseErrors, 'request.parseErrors', errs, request.snapshot);
  }
  return errs;
}
/** Structural check of the engine-82 envelope `{snapshot, parseErrors, profileId: 'B82_core1', context}`. */
function validateEnvelope82(envelope) {
  const rep = A.jsonRepresentabilityErrors(envelope, 'envelope'); if (rep.length) return rep;
  const errs = []; check(envelope, ENVELOPE_82, 'envelope', errs);
  if (typeOk(envelope, 'object')) {
    if (typeOk(envelope.snapshot, 'object')) { couplingErrors(envelope.snapshot.supply, 'envelope.snapshot.supply', errs); declarationShapeErrors(envelope.snapshot, 'envelope.snapshot', errs); }
    parseErrorPathErrors(envelope.parseErrors, 'envelope.parseErrors', errs, envelope.snapshot);
  }
  return errs;
}
function assertRequestV2(request) { const errs = validateRequestV2(request); if (errs.length) throw new A.LoadCalcEnvelopeError(errs); }
function assertEnvelope82(envelope) { const errs = validateEnvelope82(envelope); if (errs.length) throw new A.LoadCalcEnvelopeError(errs); }

// ── E4 exact-integer encoding (R2-CLOSE-1 §2.2, R2-CLOSE-2 §2.1) ──
const E4 = 10000;
const MAX_VA = 1000000; const MAX_AREA = 1000000; const MAX_COUNT = 100; const MAX_QUANTITY = 100; const MAX_RECORDS = 200;
/** Decimal digits of the shortest round-trip representation of a finite non-negative number, exponent normalised. Returns {intDigits, fracDigits}. */
function decimalDigits(x) {
  let s = String(x); let sign = '';
  if (s[0] === '-') { sign = '-'; s = s.slice(1); }
  let mant = s; let exp = 0; const eIdx = s.search(/[eE]/);
  if (eIdx !== -1) { mant = s.slice(0, eIdx); exp = parseInt(s.slice(eIdx + 1), 10); }
  let [ip, fp] = mant.split('.'); fp = fp || '';
  let digits = ip + fp; let pointPos = ip.length + exp;
  if (pointPos <= 0) { digits = '0'.repeat(1 - pointPos) + digits; pointPos = 1; }
  if (pointPos > digits.length) digits = digits + '0'.repeat(pointPos - digits.length);
  let intDigits = digits.slice(0, pointPos).replace(/^0+(?=\d)/, ''); let fracDigits = digits.slice(pointPos).replace(/0+$/, '');
  return { sign, intDigits, fracDigits };
}
/**
 * encodeE4(x, maxVA) → { ok: true, e4 } | { ok: false, code } where code ∈ {OUT_OF_RANGE, RESOLUTION_EXCEEDED}.
 * The caller guarantees x is a finite JSON number (L2). Never `x * 10000`.
 */
function encodeE4(x, maxVA) {
  const { sign, intDigits, fracDigits } = decimalDigits(x);
  if (sign === '-' && (intDigits !== '0' || fracDigits !== '')) return { ok: false, code: 'OUT_OF_RANGE' };
  if (fracDigits.length > 2) return { ok: false, code: 'RESOLUTION_EXCEEDED' };
  if (intDigits.length > 12) return { ok: false, code: 'OUT_OF_RANGE' };
  const intPart = Number(intDigits); const frac = Number((fracDigits + '0000').slice(0, 4));
  if (intPart > (maxVA === undefined ? MAX_VA : maxVA) || (intPart === (maxVA === undefined ? MAX_VA : maxVA) && frac > 0)) return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, e4: intPart * E4 + frac };
}
/** canonicalDecimal(n): decimal string of an exact E4 integer (trailing zeros trimmed). */
function canonicalDecimal(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError('canonicalDecimal: non-negative safe integer required');
  const s = String(n).padStart(5, '0'); const q = s.slice(0, -4).replace(/^0+(?=\d)/, ''); const r = s.slice(-4).replace(/0+$/, '');
  return r ? `${q}.${r}` : q;
}
const projectE4 = (n) => Number(canonicalDecimal(n));
/** Display string from the exact integer: precision 0 for VA (half away from zero on the E4 remainder), thousands grouped. */
function displayVA(n) {
  const s = String(n).padStart(5, '0'); let q = Number(s.slice(0, -4)); const r = Number(s.slice(-4)); if (r >= 5000) q += 1;
  return String(q).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' VA';
}

// ── down-conversion to an unchanged A envelope (R2 §2.1, CLOSE-1 §4) ──
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));   // undefined stays undefined so a later structural check names the missing member
/** Build the A envelope from a V2 request on a COPY: 82-only keys and parse errors stripped; nothing else changed. */
function downConvertToA(request) {
  const snap = clone(request.snapshot);
  snap.schemaVersion = SCHEMA_VERSION_A;
  delete snap.optional82;
  snap.loads = snap.loads.map((l) => { const c = Object.assign({}, l); delete c.basisId; delete c.inclusion82; delete c.ratingCoverage82; return c; });
  const parseErrors = clone(request.parseErrors).filter((pe) => !PATH_82_ONLY_RE.test(pe.field));
  return { snapshot: snap, parseErrors, profileId: ENGINE_PROFILE_ID_A };
}
/** Build the engine-82 envelope from a V2 request on a COPY (context carried explicitly). */
function toEnvelope82(request) {
  return { snapshot: clone(request.snapshot), parseErrors: clone(request.parseErrors), profileId: ENGINE_PROFILE_ID_82, context: clone(request.context) };
}

module.exports = {
  SCHEMA_VERSION_V2, SCHEMA_VERSION_A, API_VERSION, CAPABILITY_PROFILE_ID, ENGINE_PROFILE_ID_82, ENGINE_PROFILE_ID_A, ENUMS2: E2,
  validateRequestV2, validateEnvelope82, validateSnapshotV2, assertRequestV2, assertEnvelope82, downConvertToA, toEnvelope82,
  encodeE4, decimalDigits, canonicalDecimal, projectE4, displayVA, E4, DOMAIN: Object.freeze({ MAX_VA, MAX_AREA, MAX_COUNT, MAX_QUANTITY, MAX_RECORDS }),
  parsePathProblem, SCALAR_PATHS, LOAD_FIELDS, PATH_82_ONLY_RE, LoadCalcEnvelopeError: A.LoadCalcEnvelopeError,
};
