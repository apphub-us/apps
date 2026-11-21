'use strict';
/**
 * Load Calc — pure input helpers (EC-CALC-2 / B1, contract v3.2.2, schema "3.2.1").
 *
 *   L1  parseStrictJson(text)          strict ingress: rejects NaN / Infinity / -Infinity
 *                                      tokens, duplicate object keys and non-object roots
 *                                      -> { ok:false, code:'PARSE_REJECTED', reason }
 *   L1  parseNumberField(raw, spec)    non-DOM parser for one form value -> { value, error }
 *       parseEnumField(raw, spec)      (blank -> null + MISSING_FIELD; unparsable -> null +
 *                                      NOT_FINITE | NOT_INTEGER | OUT_OF_RANGE | UNKNOWN_ENUM;
 *                                      never coerces blank to 0, never keeps a previous value)
 *   L2  validateSnapshot(x)            bounded structural validator for LoadCalcInput
 *       validateEnvelope(x)            and RequestEnvelope (types, enums, required keys, no
 *                                      extra keys, topology -> voltage/phase/wire coupling).
 *                                      Both first require a strictly JSON-representable value
 *                                      (jsonRepresentabilityErrors): no undefined / NaN /
 *                                      Infinity / function / symbol / bigint / non-plain object
 *                                      / array hole / cycle anywhere, including inside opaque
 *                                      collections the profile does not interpret (B1-r1).
 *                                      Integers are safe integers (B1-r1): a count that a
 *                                      double cannot represent exactly is rejected, never
 *                                      silently rounded. Real-valued VA/A are not integers.
 *
 * The L2 validator is a hand-written, bounded check of THIS contract's shapes
 * (mirroring schema r21). It is not a generic JSON Schema engine; the
 * independent reviewer re-validates with a full draft 2020-12 validator.
 * No DOM, storage, network, clock or randomness.
 */

const { defineData } = require('./loadCalcState');

// ── L1: strict JSON ingress ──────────────────────────────────────────────

/**
 * Strict JSON parser. Differences from JSON.parse: duplicate keys are rejected
 * (JSON.parse silently keeps the last), the root must be an object, and
 * objects are built with own data properties only (a key "__proto__" is data).
 * NaN / Infinity / -Infinity are not JSON tokens and are rejected as such.
 */
function parseStrictJson(text) {
  if (typeof text !== 'string') return { ok: false, code: 'PARSE_REJECTED', reason: 'input is not a string' };
  let i = 0; const n = text.length;
  const fail = (reason) => { const e = new SyntaxError(reason); e.pos = i; throw e; };
  const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
  const parseValue = () => {
    ws();
    if (i >= n) fail('unexpected end of input');
    const c = text[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === 't') return literal('true', true);
    if (c === 'f') return literal('false', false);
    if (c === 'n') return literal('null', null);
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('NaN', i) || text.startsWith('Infinity', i)) fail('non-JSON constant rejected by strict ingress');
    fail(`unexpected character ${JSON.stringify(c)}`);
    return undefined;
  };
  const literal = (word, value) => {
    if (!text.startsWith(word, i)) fail(`unexpected token at ${i}`);
    i += word.length; return value;
  };
  const parseNumber = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (!m) { if (text.startsWith('-Infinity', i)) fail('non-JSON constant rejected by strict ingress'); fail('invalid number'); }
    i += m[0].length;
    const v = Number(m[0]);
    if (!Number.isFinite(v)) fail('number out of double range');
    return v;
  };
  const parseString = () => {
    i++; let out = '';
    for (;;) {
      if (i >= n) fail('unterminated string');
      const c = text[i];
      if (c === '"') { i++; return out; }
      if (c === '\\') {
        const e = text[i + 1];
        if (e === '"' || e === '\\' || e === '/') { out += e; i += 2; }
        else if (e === 'b') { out += '\b'; i += 2; } else if (e === 'f') { out += '\f'; i += 2; }
        else if (e === 'n') { out += '\n'; i += 2; } else if (e === 'r') { out += '\r'; i += 2; } else if (e === 't') { out += '\t'; i += 2; }
        else if (e === 'u') {
          const h = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('invalid unicode escape');
          out += String.fromCharCode(parseInt(h, 16)); i += 6;
        } else fail('invalid escape');
      } else {
        const code = c.charCodeAt(0);
        if (code < 0x20) fail('control character in string');
        out += c; i++;
      }
    }
  };
  const parseArray = () => {
    i++; const out = []; ws();
    if (text[i] === ']') { i++; return out; }
    for (;;) {
      out.push(parseValue()); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ']') { i++; return out; }
      fail('expected , or ]');
    }
  };
  const parseObject = () => {
    i++; const out = {}; const seen = new Set(); ws();
    if (text[i] === '}') { i++; return out; }
    for (;;) {
      ws();
      if (text[i] !== '"') fail('expected string key');
      const k = parseString(); ws();
      if (text[i] !== ':') fail('expected :');
      i++;
      const v = parseValue();
      if (seen.has(k)) fail(`duplicate key ${JSON.stringify(k)}`);
      seen.add(k); defineData(out, k, v); ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === '}') { i++; return out; }
      fail('expected , or }');
    }
  };
  try {
    const v = parseValue(); ws();
    if (i < n) fail('trailing characters');
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, code: 'PARSE_REJECTED', reason: 'root is not an object' };
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof SyntaxError) return { ok: false, code: 'PARSE_REJECTED', reason: e.message };
    throw e;
  }
}

// ── L1: non-DOM field parsers (the adapter's one transport for empty/malformed fields) ──

const NUMERIC_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Parse one raw form value as a number. Returns `{ value, error }` where
 * `error` is `null` or `{ field, raw, code }`. Blank -> null + MISSING_FIELD;
 * not a finite decimal (e.g. "abc", "12,3") -> NOT_FINITE; integer required
 * but fractional -> NOT_INTEGER; outside [min, max] -> OUT_OF_RANGE. A
 * corrected entry simply parses (no error). Blank is never 0. An integer field
 * additionally requires a safe integer (|v| <= 2^53 - 1): a larger count is
 * OUT_OF_RANGE and is never returned rounded.
 */
function parseNumberField(raw, spec) {
  const field = spec && spec.field ? String(spec.field) : '';
  const rawStr = raw === null || raw === undefined ? '' : String(raw);
  const s = rawStr.trim();
  const err = (code) => ({ value: null, error: { field, raw: rawStr, code } });
  if (s === '') return err('MISSING_FIELD');
  if (!NUMERIC_RE.test(s)) return err('NOT_FINITE');
  const v = Number(s);
  if (!Number.isFinite(v)) return err('NOT_FINITE');
  if (spec && spec.integer && !Number.isInteger(v)) return err('NOT_INTEGER');
  // a count must be a safe integer: "9007199254740993" would silently become 9007199254740992 (B1-r1, R-B1-03)
  if (spec && spec.integer && !Number.isSafeInteger(v)) return err('OUT_OF_RANGE');
  if (spec && typeof spec.min === 'number' && v < spec.min) return err('OUT_OF_RANGE');
  if (spec && typeof spec.max === 'number' && v > spec.max) return err('OUT_OF_RANGE');
  if (spec && spec.exclusiveMin === true && typeof spec.min === 'number' && v === spec.min) return err('OUT_OF_RANGE');
  return { value: v, error: null };
}

/** Parse one raw enum value: blank -> null + MISSING_FIELD; not in `allowed` -> null + UNKNOWN_ENUM. */
function parseEnumField(raw, spec) {
  const field = spec && spec.field ? String(spec.field) : '';
  const rawStr = raw === null || raw === undefined ? '' : String(raw);
  const s = rawStr.trim();
  if (s === '') return { value: null, error: { field, raw: rawStr, code: 'MISSING_FIELD' } };
  const allowed = spec && Array.isArray(spec.allowed) ? spec.allowed : [];
  if (!allowed.includes(s)) return { value: null, error: { field, raw: rawStr, code: 'UNKNOWN_ENUM' } };
  return { value: s, error: null };
}

// ── L2: bounded structural validator ─────────────────────────────────────

const E = {
  topology: ['1ph_2w_120', '1ph_2w_240', '1ph_3w_120_240', '1ph_3w_120_208_network', '3ph_4w_208Y_120', '3ph_4w_480Y_277', '3ph_3w_480_delta', '3ph_3w_240_delta', '3ph_4w_240_delta_highleg', 'other', null],
  modelKind: ['single_2w', 'split_240_all_LL', 'split_240_balanced_LN', 'split_240_declared_legs', 'network_208_all_LL', 'network_208_balanced_LN', 'network_208_mixed', 'three_phase_balanced', 'unsupported', null],
  method: ['opt_220_82', 'existing_220_83', 'measured_220_87', 'standard_part_III', 'multifamily_220_84', null],
  occupancy: ['dwelling_unit_house', 'dwelling_unit_apartment', 'multifamily_building', 'nondwelling', null],
  purpose: ['service', 'feeder', null],
  provenance: ['utility_data', 'recording_report', 'designer_declaration', 'legacy_record', 'other'],
  category: ['range', 'oven', 'cooktop', 'dryer', 'water_heater', 'dishwasher', 'appliance_fixed_other', 'motor', 'ac', 'heat_pump_compressor', 'heat_pump_supplemental', 'electric_space_heat', 'thermal_storage_heat', 'evse', 'other', null],
  ratingKind: ['va', 'w', 'amps_at_volts', 'hp'],
  connection: ['LL', 'LN', '3PH', null],
  leg: ['L1', 'L2', 'L3', null],
  loadStatus: ['existing', 'new', null],
  classification: ['confirmed', 'required'],
  readingUnit: ['VA', 'kVA', 'kW', 'A'],
  readingScope: ['highest_loaded_conductor', 'per_conductor', 'total_apparent_power', null],
  basis: ['annual_max_demand', '30d_recording_exception', null],
  metric: ['highest_avg_kw_15min', 'max_demand_kw', 'max_demand_kva', 'other', null],
  instrument: ['recording_ammeter', 'power_meter', 'utility_demand_meter', 'other', null],
  connectedTo: ['highest_loaded_conductor', 'each_conductor', 'unknown', null],
  newLoadMode: ['none', 'precalculated', 'from_loads', null],
  basisMethod: ['opt_220_82', 'existing_220_83', 'measured_220_87', 'standard_part_III', 'multifamily_220_84', 'other_stated', null],
  calculatedBy: ['designer', 'engineer', 'contractor', 'other', null],
  selectionSource: ['guide', 'manual', 'legacy', null],
  houseFeeder: ['yes100', 'no100', null], houseState: ['new', 'existing', 'meter', null], bldgCooking: ['yesall', 'noall', null],
  hvacArrangement: ['none', 'ac_only', 'heat_pump_no_supplemental', 'heat_pump_with_supplemental', 'electric_space_heat', 'thermal_storage', 'mixed_unknown', null],
  houseLoadsMode: ['part_III', 'entered_va', null],
  transformTarget: ['loads', 'dwelling.laundryCircuits', 'dwelling.nycAcCircuitCount', 'none'],
  transformStatus: ['applied', 'unresolved'],
  problemCode: ['NOT_FINITE', 'OUT_OF_RANGE', 'NOT_INTEGER', 'UNKNOWN_ENUM', 'LEGACY_AMBIGUOUS', 'UNSUPPORTED_RATING_KIND', 'MISSING_FIELD', 'QUALIFICATION_UNKNOWN', 'QUALIFICATION_FAILED', 'CLASSIFICATION_REQUIRED', 'SCOPE_UNSUPPORTED', 'CAPABILITY_DISABLED', 'RULE_PENDING', 'LOAD_UNRESOLVED', 'MODEL_UNSUPPORTED', 'MODEL_DECLARATION_MISSING', 'SUPPLY_INCONSISTENT', 'LEG_INVALID', 'CONNECTION_INVALID', 'ASSOCIATION_UNKNOWN', 'NEWLOAD_BASIS_UNQUALIFIED', 'NEWLOAD_MODE_NONE_WITH_NEW_LOADS', 'NOT_COVERED_BY_AGGREGATE', 'AGGREGATE_STALE', 'COVERS_UNKNOWN_LOAD', 'DUPLICATE_ID', 'LEGACY_LAUNDRY_MERGED', 'PARSE_REJECTED'],
  parseCode: ['NOT_FINITE', 'NOT_INTEGER', 'OUT_OF_RANGE', 'UNKNOWN_ENUM', 'MISSING_FIELD', 'PARSE_REJECTED'],
};

/** Topology -> [vLineToLine, vLineToNeutral, phases, wires]; `other`/null -> all null. */
const COUPLING = {
  '1ph_2w_120': [120, 120, 1, 2], '1ph_2w_240': [240, null, 1, 2], '1ph_3w_120_240': [240, 120, 1, 3], '1ph_3w_120_208_network': [208, 120, 1, 3],
  '3ph_4w_208Y_120': [208, 120, 3, 4], '3ph_4w_480Y_277': [480, 277, 3, 4], '3ph_3w_480_delta': [480, null, 3, 3],
  '3ph_3w_240_delta': [240, null, 3, 3], '3ph_4w_240_delta_highleg': [240, 120, 3, 4], other: [null, null, null, null], null: [null, null, null, null],
};

// spec mini-language (bounded, contract-specific):
//   { t: 'string'|'number'|'integer'|'boolean'|'null'|'object'|'array' | [...types] }
//   { enum: [...] } { const: v } { obj: { props }, req: [..], extra: false, opt: [..] } { arr: itemSpec } { anyOf: [...] }
const nullable = (t) => ({ t: [t, 'null'] });
const declBool = { obj: { value: nullable('boolean'), provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] } }, req: ['value'] };
const RATING = { obj: { kind: { enum: E.ratingKind }, value: { t: 'number' }, volts: nullable('number') }, req: ['kind', 'value'] };
const ALMS = { obj: { present: { t: 'boolean' }, maxLoadVA: nullable('number') }, req: ['present'] };
const LEGACY_ITEM = { obj: { id: { t: 'string' }, name: { t: 'string' }, va: { t: 'number' }, category: { t: 'string' } }, req: ['id', 'name', 'va', 'category'] };
const LOAD = { obj: { id: { t: 'string', minLength: 1 }, label: { t: 'string' }, legacy: { anyOf: [LEGACY_ITEM, { t: 'null' }] }, category: { enum: E.category }, classification: { enum: E.classification }, rating: RATING, quantity: { t: 'integer', min: 1 }, status: { enum: E.loadStatus }, continuous: nullable('boolean'), connection: { enum: E.connection }, leg: { enum: E.leg }, separatelyControlledUnits: nullable('integer'), alms: ALMS }, req: ['id', 'category', 'classification', 'rating', 'quantity', 'status', 'continuous', 'connection', 'leg'] };
const COVERS_ENTRY = { obj: { id: { t: 'string' }, category: { enum: E.category }, classification: { enum: E.classification }, rating: RATING, quantity: { t: 'integer', min: 1 }, status: { enum: E.loadStatus }, continuous: nullable('boolean'), connection: { enum: E.connection }, leg: { enum: E.leg }, separatelyControlledUnits: nullable('integer'), alms: ALMS }, req: ['id', 'category', 'classification', 'rating', 'quantity', 'status', 'continuous', 'connection', 'leg', 'separatelyControlledUnits', 'alms'] };
const NEW_LOAD_BASIS = { obj: { method: { enum: E.basisMethod }, ruleRefs: { arr: { t: 'string' } }, demandFactorsApplied: nullable('boolean'), continuousFactorApplied: nullable('boolean'), establishedForThisComparison: nullable('boolean'), calculatedBy: { enum: E.calculatedBy }, provenance: { obj: { source: { enum: E.provenance }, note: nullable('string') }, req: ['source'] }, note: nullable('string') }, req: ['method', 'ruleRefs', 'demandFactorsApplied', 'continuousFactorApplied', 'establishedForThisComparison', 'calculatedBy'] };
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
const SNAPSHOT = { obj: {
  schemaVersion: { const: '3.2.1' },
  ruleBasis: { obj: { code: { const: 'NYCEC-2025' }, base: { const: 'NEC-2020' }, amendments: { const: 'NYC-2025' } }, req: ['code', 'base', 'amendments'] },
  purpose: { enum: E.purpose }, occupancy: { enum: E.occupancy },
  supply: { obj: { topology: { enum: E.topology }, vLineToLine: nullable('number'), vLineToNeutral: nullable('number'), phases: { enum: [1, 3, null] }, wires: { enum: [2, 3, 4, null] } }, req: ['topology', 'vLineToLine', 'vLineToNeutral', 'phases', 'wires'] },
  loadModel: { obj: { kind: { enum: E.modelKind }, declarations: { obj: { unityPF: declBool, balancedLN: declBool, balanced3ph: declBool }, req: [] } }, req: ['kind', 'declarations'] },
  method: { obj: { selected: { enum: E.method }, guideRecommendation: { enum: E.method }, selectionSource: { enum: E.selectionSource }, guideAnswers: { obj: { houseFeeder: { enum: E.houseFeeder }, aptFeeder: { enum: E.houseFeeder }, houseState: { enum: E.houseState }, bldgCooking: { enum: E.bldgCooking } }, req: [] } }, req: ['selected', 'guideRecommendation', 'selectionSource', 'guideAnswers'] },
  dwelling: { obj: { floorAreaFt2: nullable('number'), smallApplianceCircuits: nullable('integer'), laundryCircuits: nullable('integer'), nycAcCircuitCount: nullable('integer'), existingDwelling: nullable('boolean') }, req: ['floorAreaFt2', 'smallApplianceCircuits', 'laundryCircuits', 'nycAcCircuitCount', 'existingDwelling'] },
  loads: { arr: LOAD },
  hvac: { obj: { arrangement: { enum: E.hvacArrangement }, supplementalInterlocked: declBool, installingAdditionalHvac: declBool }, req: ['arrangement', 'supplementalInterlocked', 'installingAdditionalHvac'] },
  measurement: { anyOf: [MEASUREMENT, { t: 'null' }] },
  multifamily: { obj: { unitCount: nullable('integer'), unitsIdentical: nullable('boolean'), unitGroups: { t: 'array' }, allUnitsElectricCooking: declBool, allUnitsElectricHeatOrAc: declBool, singleFeederPerUnit: declBool, houseLoads: { obj: { mode: { enum: E.houseLoadsMode }, va: nullable('number'), items: { t: 'array' } }, req: ['mode', 'va', 'items'] } }, req: ['unitCount', 'unitsIdentical', 'unitGroups', 'allUnitsElectricCooking', 'allUnitsElectricHeatOrAc', 'singleFeederPerUnit', 'houseLoads'] },
  migration: { anyOf: [MIGRATION, { t: 'null' }] },
}, req: ['schemaVersion', 'ruleBasis', 'purpose', 'occupancy', 'supply', 'loadModel', 'method', 'dwelling', 'loads', 'hvac', 'measurement', 'multifamily', 'migration'] };
const PARSE_ERROR = { obj: { field: { t: 'string' }, raw: nullable('string'), code: { enum: E.parseCode } }, req: ['field', 'raw', 'code'] };
const ENVELOPE = { obj: { snapshot: SNAPSHOT, parseErrors: { arr: PARSE_ERROR }, profileId: { enum: ['A_measured_87_core'] } }, req: ['snapshot', 'parseErrors', 'profileId'] };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function typeOk(v, t) {
  switch (t) {
    case 'string': return typeof v === 'string';
    case 'number': return isNum(v);
    case 'integer': return isNum(v) && Number.isSafeInteger(v); // counts must be exactly representable (B1-r1); stricter than the JSON-Schema 'integer' keyword by design
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    default: return false;
  }
}
function jsonEq(a, b) { return typeof a === typeof b && a === b; }

function check(v, spec, path, errs) {
  if (spec.anyOf) {
    let closest = null;
    for (const s of spec.anyOf) { const sub = []; check(v, s, path, sub); if (!sub.length) return; if (closest === null || sub.length < closest.length) closest = sub; }
    // report the closest branch's own errors so a rejected value names its field (e.g. an unsafe count inside measurement), then the summary
    for (const e of closest.slice(0, 3)) errs.push(e);
    errs.push(`${path}: matches no allowed shape`); return;
  }
  if (own(spec, 'const')) { if (!jsonEq(v, spec.const)) errs.push(`${path}: must be ${JSON.stringify(spec.const)}`); return; }
  if (spec.enum) { if (!spec.enum.some((e) => jsonEq(v, e))) errs.push(`${path}: not one of ${JSON.stringify(spec.enum)}`); return; }
  if (spec.t) {
    const types = Array.isArray(spec.t) ? spec.t : [spec.t];
    if (!types.some((t) => typeOk(v, t))) { errs.push(`${path}: expected ${types.join('|')}`); return; }
    if (typeof v === 'number') {
      if (typeof spec.min === 'number' && v < spec.min) errs.push(`${path}: below minimum ${spec.min}`);
    }
    if (typeof v === 'string' && typeof spec.minLength === 'number' && v.length < spec.minLength) errs.push(`${path}: shorter than ${spec.minLength}`);
    return;
  }
  if (spec.arr) {
    if (!Array.isArray(v)) { errs.push(`${path}: expected array`); return; }
    v.forEach((it, k) => check(it, spec.arr, `${path}[${k}]`, errs)); return;
  }
  if (spec.map) {
    if (!typeOk(v, 'object')) { errs.push(`${path}: expected object`); return; }
    for (const k of Object.keys(v)) check(v[k], spec.map, `${path}.${k}`, errs); return;
  }
  if (spec.obj) {
    if (!typeOk(v, 'object')) { errs.push(`${path}: expected object`); return; }
    for (const k of spec.req) if (!own(v, k)) errs.push(`${path}: missing required ${k}`);
    for (const k of Object.keys(v)) {
      if (!own(spec.obj, k)) { errs.push(`${path}: unexpected property ${k}`); continue; }
      check(v[k], spec.obj[k], `${path}.${k}`, errs);
    }
  }
}
function own(o, k) { return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }

function couplingErrors(supply, path, errs) {
  if (!typeOk(supply, 'object') || !own(supply, 'topology')) return;
  const key = supply.topology === null ? 'null' : supply.topology;
  if (!own(COUPLING, key)) return;
  const [vll, vln, ph, w] = COUPLING[key];
  const want = { vLineToLine: vll, vLineToNeutral: vln, phases: ph, wires: w };
  for (const k of Object.keys(want)) {
    if (own(supply, k) && !jsonEq(supply[k], want[k])) errs.push(`${path}.${k}: must be ${JSON.stringify(want[k])} for topology ${JSON.stringify(supply.topology)} (CONTRADICTORY_SUPPLY)`);
  }
}

/**
 * Strict JSON-representability of a direct object input (B1-r1, R-B1-03).
 * Walks EVERY value, including collections the profile does not interpret
 * (e.g. multifamily.unitGroups, houseLoads.items, migration.fieldMap), and
 * reports each value that has no faithful JSON text form: undefined, NaN,
 * +/-Infinity, function, symbol, bigint, objects with a prototype other than
 * Object.prototype/null (Date, Map, class instances...), array holes, and
 * reference cycles. Nothing is sanitized or coerced; the caller rejects.
 * Own enumerable string keys are walked (the keys JSON.stringify would emit);
 * hostile names like "__proto__" or "constructor" are ordinary data keys.
 */
function jsonRepresentabilityErrors(value, path, errs, stack) {
  const acc = errs || []; const p = path || '$'; const st = stack || [];
  const t = typeof value;
  if (value === null || t === 'string' || t === 'boolean') return acc;
  if (t === 'number') { if (!Number.isFinite(value)) acc.push(`${p}: non-finite number is not JSON`); return acc; }
  if (t === 'undefined') { acc.push(`${p}: undefined is not JSON`); return acc; }
  if (t === 'function' || t === 'symbol' || t === 'bigint') { acc.push(`${p}: ${t} is not JSON`); return acc; }
  if (t !== 'object') { acc.push(`${p}: unsupported value type ${t}`); return acc; }
  if (st.includes(value)) { acc.push(`${p}: reference cycle is not JSON`); return acc; }
  if (st.length > 64) { acc.push(`${p}: nesting deeper than 64 levels`); return acc; }
  st.push(value);
  if (Array.isArray(value)) {
    for (let k = 0; k < value.length; k++) {
      if (!(k in value)) acc.push(`${p}[${k}]: array hole is not JSON`);
      else jsonRepresentabilityErrors(value[k], `${p}[${k}]`, acc, st);
    }
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) acc.push(`${p}: non-plain object is not JSON`);
    else for (const k of Object.keys(value)) jsonRepresentabilityErrors(value[k], `${p}.${k}`, acc, st);
  }
  st.pop();
  return acc;
}

/** Structural check of a LoadCalcInput snapshot. Returns a list of error strings (empty = structurally valid). */
function validateSnapshot(snapshot) {
  const rep = jsonRepresentabilityErrors(snapshot, 'snapshot');
  if (rep.length) return rep; // a non-JSON value is rejected before any shape rule is consulted
  const errs = [];
  check(snapshot, SNAPSHOT, 'snapshot', errs);
  if (typeOk(snapshot, 'object')) couplingErrors(snapshot.supply, 'snapshot.supply', errs);
  return errs;
}

/** Structural check of a RequestEnvelope. Returns a list of error strings (empty = structurally valid). */
function validateEnvelope(envelope) {
  const rep = jsonRepresentabilityErrors(envelope, 'envelope');
  if (rep.length) return rep;
  const errs = [];
  check(envelope, ENVELOPE, 'envelope', errs);
  if (typeOk(envelope, 'object') && typeOk(envelope.snapshot, 'object')) couplingErrors(envelope.snapshot.supply, 'envelope.snapshot.supply', errs);
  return errs;
}

/** Error thrown by `evaluate` at the L2 boundary: the request is structurally invalid and the engine is not run. */
class LoadCalcEnvelopeError extends Error {
  constructor(errors) {
    super('RequestEnvelope rejected at the structural boundary (L2): ' + errors.slice(0, 3).join('; ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : ''));
    this.name = 'LoadCalcEnvelopeError'; this.code = 'SCHEMA_INVALID'; this.errors = errors.slice();
  }
}

module.exports = { parseStrictJson, parseNumberField, parseEnumField, jsonRepresentabilityErrors, validateSnapshot, validateEnvelope, LoadCalcEnvelopeError, ENUMS: E };
