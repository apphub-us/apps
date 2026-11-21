'use strict';
/**
 * Load Calc — pure state helpers (EC-CALC-2 / B1, contract v3.2.2, schema "3.2.1").
 *
 * Everything here is a pure function of its arguments: no DOM, no storage, no
 * clock, no randomness. Allocation of saved-record ids, timestamps and the
 * actual Favorites write belong to the later adapter (B2), not to this file.
 *
 *   createEmptySnapshot()            P-5: Init == Reset == the same empty snapshot (T-S-08)
 *   coversProjection(loads, covers)  §6.2.1 canonical covered-set projection, or null
 *   canonicalJson(value)             §6.2.1 canonical JSON (sorted keys, no whitespace)
 *   captureCoversSnapshot(snapshot)  adapter-time capture of `coversSnapshot` (never on evaluate)
 *   isAggregateStale(loads, term)    §6.2.1 staleness test
 *   setOccupancy(snapshot, value)    §9.6 occupancy transition
 *   migrateLegacyRecord(record)      §11 structured, non-destructive v1 -> 3.2.1 migration
 *
 * Rule basis: NFPA 70-2020 as adopted by New York City with the NYC 2025
 * amendments (NYCEC 2025). No later edition is imported.
 */

const SCHEMA_VERSION = '3.2.1';
const RULE_BASIS = Object.freeze({ code: 'NYCEC-2025', base: 'NEC-2020', amendments: 'NYC-2025' });

const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Structural deep copy of JSON-compatible data (own enumerable properties only). */
function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlainObject(v)) {
    const out = {};
    for (const k of Object.keys(v)) defineData(out, k, clone(v[k]));
    return out;
  }
  return v;
}

/** Own-data-property assignment that never touches the prototype chain (a key named "__proto__" stays data). */
function defineData(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  return obj;
}

/** Declared boolean with provenance (contract $defs/declaredBool); `null` never means true. */
function declared(value, source, note) {
  return { value, provenance: { source: source === undefined ? 'designer_declaration' : source, note: note === undefined ? null : note } };
}

/** Empty supply block (no default topology). */
function emptySupply() {
  return { topology: null, vLineToLine: null, vLineToNeutral: null, phases: null, wires: null };
}

/**
 * P-5 empty snapshot. Identical for first open and Reset: no default topology,
 * no seeded loads, no inferred qualification. `purpose` defaults to "service"
 * exactly as the T-S-08 specification records the Init/Reset snapshot.
 */
function createEmptySnapshot() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ruleBasis: { code: RULE_BASIS.code, base: RULE_BASIS.base, amendments: RULE_BASIS.amendments },
    purpose: 'service',
    occupancy: null,
    supply: emptySupply(),
    loadModel: { kind: null, declarations: {} },
    method: { selected: null, guideRecommendation: null, selectionSource: null, guideAnswers: {} },
    dwelling: { floorAreaFt2: null, smallApplianceCircuits: null, laundryCircuits: null, nycAcCircuitCount: null, existingDwelling: null },
    loads: [],
    hvac: { arrangement: null, supplementalInterlocked: declared(null), installingAdditionalHvac: declared(null) },
    measurement: null,
    multifamily: {
      unitCount: null,
      unitsIdentical: null,
      unitGroups: [],
      allUnitsElectricCooking: declared(null),
      allUnitsElectricHeatOrAc: declared(null),
      singleFeederPerUnit: declared(null),
      houseLoads: { mode: null, va: null, items: [] },
    },
    migration: null,
  };
}

// ── §6.2.1 canonical covered-set snapshot ─────────────────────────────────

/** Basis-relevant fields of a covered load. `label` and `legacy` are descriptive and excluded. */
const COVERS_FIELDS = Object.freeze(['id', 'category', 'classification', 'rating', 'quantity', 'status', 'continuous', 'connection', 'leg', 'separatelyControlledUnits', 'alms']);

/** Unicode code-point order (never localeCompare). */
function codePointCompare(a, b) {
  const ia = a[Symbol.iterator](); const ib = b[Symbol.iterator]();
  for (;;) {
    const x = ia.next(); const y = ib.next();
    if (x.done && y.done) return 0;
    if (x.done) return -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0); const cy = y.value.codePointAt(0);
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** True when every id in the list is a string and unique. */
function uniqueIds(ids) {
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * Deterministic projection of the covered loads: the loads whose ids are in
 * `covers`, sorted by id in code-point order (independent of covers[] and of
 * loads[] order), each reduced to the basis-relevant fields. Returns `null`
 * when the projection is undefined: duplicate ids in covers[] or loads[], or a
 * covered id that names no load.
 */
function coversProjection(loads, covers) {
  if (!Array.isArray(loads) || !Array.isArray(covers)) return null;
  if (!uniqueIds(covers) || !uniqueIds(loads.map((l) => (isPlainObject(l) ? l.id : undefined)))) return null;
  const byId = new Map();
  for (const l of loads) byId.set(l.id, l);
  for (const id of covers) if (!byId.has(id)) return null;
  return covers.slice().sort(codePointCompare).map((id) => {
    const l = byId.get(id); const out = {};
    for (const k of COVERS_FIELDS) defineData(out, k, clone(own(l, k) ? l[k] : null));
    return out;
  });
}

/** Canonical JSON: keys sorted by code point, no whitespace, non-ASCII kept as is (no NaN/Infinity ever produced). */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort(codePointCompare).map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

/**
 * Staleness test (§6.2.1): canonical JSON of the current projection differs
 * from canonical JSON of the stored `coversSnapshot` (a missing snapshot
 * compares as []). Returns `null` when the projection is undefined.
 */
function isAggregateStale(loads, term) {
  const proj = coversProjection(loads, term && Array.isArray(term.covers) ? term.covers : []);
  if (proj === null) return null;
  const stored = term && Array.isArray(term.coversSnapshot) ? term.coversSnapshot : [];
  return canonicalJson(proj) !== canonicalJson(stored);
}

/**
 * Adapter-time capture: returns a NEW snapshot whose precalculated term carries
 * the canonical projection of its covers[] at this moment. This is the only
 * legitimate writer of `coversSnapshot`; `evaluate` never refreshes it.
 * Returns the (cloned) snapshot unchanged when there is no precalculated term
 * or the projection is undefined (the engine then reports DUPLICATE_ID /
 * COVERS_UNKNOWN_LOAD from the unchanged data).
 */
function captureCoversSnapshot(snapshot) {
  const s = clone(snapshot);
  const m = s && s.measurement; const nl = m && m.newLoad; const pre = nl && nl.mode === 'precalculated' ? nl.precalculated : null;
  if (!pre) return s;
  const proj = coversProjection(s.loads, pre.covers);
  if (proj !== null) pre.coversSnapshot = proj;
  return s;
}

// ── §9.6 occupancy transition ─────────────────────────────────────────────

/**
 * Occupancy change as a pure transformation. Clearing the occupancy clears the
 * guide recommendation and, when the method came from the guide, the method
 * selection; a manual selection stays (T-S-01 / T-S-01b). Loads and every
 * other field are retained (T-S-06, T-S-16). Guide answers are never
 * re-resolved here (T-S-02); a future guide re-run is a UI concern.
 */
function setOccupancy(snapshot, occupancy) {
  const s = clone(snapshot);
  s.occupancy = occupancy;
  if (occupancy === null) {
    s.method.guideRecommendation = null;
    if (s.method.selectionSource === 'guide') { s.method.selected = null; s.method.selectionSource = null; }
  }
  return s;
}

// ── §11 legacy Favorites migration (v1 -> 3.2.1) ───────────────────────────

const LEGACY_METHOD = Object.freeze({ optional: 'opt_220_82', existing: 'existing_220_83', nec87: 'measured_220_87', standard: 'standard_part_III', multifamily: 'multifamily_220_84' });
const LEGACY_SCOPE = Object.freeze({ house: 'dwelling_unit_house', apartment: 'dwelling_unit_apartment', building: 'multifamily_building', commercial: 'nondwelling' });
const LEGACY_VOLTAGE = Object.freeze({ 240: '1ph_3w_120_240', 208: '1ph_3w_120_208_network', '208_3': '3ph_4w_208Y_120' });
/** Legacy options whose label promises 3-phase but whose old arithmetic was 1-phase: two candidate topologies each (§4). */
const LEGACY_VOLTAGE_AMBIGUOUS = Object.freeze({ '240_3': ['3ph_3w_240_delta', '3ph_4w_240_delta_highleg'], 480: ['3ph_4w_480Y_277', '3ph_3w_480_delta'] });
/** Exact preset names -> category (§11.2). Any other name needs classification. */
const LEGACY_PRESET_CATEGORY = Object.freeze({
  'Range / Oven': 'range', Dryer: 'dryer', Dishwasher: 'dishwasher', 'Water Heater': 'water_heater', 'A/C Unit': 'ac',
  'Electric Heat': 'electric_space_heat', 'EV Charger — Level 2': 'evse', 'EV Charger — Level 1': 'evse',
});
const LEGACY_HVAC_CATEGORY = Object.freeze({ 'A/C Unit': 'ac', 'Electric Heat': 'electric_space_heat' });
const LEGACY_NYC_AC_OUTLET = 'A/C Window Outlet — NYCEC 220.14(N)';
const LEGACY_FIELDS = Object.freeze(['method', 'voltage', 'scope', 'sqFt', 'appliances', 'hvac', 'ev', 'lcMeterVA', 'lcNumUnits', 'lcHouseLoads']);
const TOPOLOGY_SUPPLY = Object.freeze({
  '1ph_2w_120': [120, 120, 1, 2], '1ph_2w_240': [240, null, 1, 2], '1ph_3w_120_240': [240, 120, 1, 3], '1ph_3w_120_208_network': [208, 120, 1, 3],
  '3ph_4w_208Y_120': [208, 120, 3, 4], '3ph_4w_480Y_277': [480, 277, 3, 4], '3ph_3w_480_delta': [480, null, 3, 3],
  '3ph_3w_240_delta': [240, null, 3, 3], '3ph_4w_240_delta_highleg': [240, 120, 3, 4],
});

function supplyFor(topology) {
  if (!own(TOPOLOGY_SUPPLY, topology)) return emptySupply();
  const [vll, vln, ph, w] = TOPOLOGY_SUPPLY[topology];
  return { topology, vLineToLine: vll, vLineToNeutral: vln, phases: ph, wires: w };
}

/** Parse a legacy numeric string as a finite number, else null. */
function legacyNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Controlled rejection of a legacy record the typed snapshot cannot represent
 * (B1-r1, R-B1-04). Thrown by migrateLegacyRecord BEFORE any snapshot is
 * built; the original record is never modified and nothing is saved. Codes:
 *   LEGACY_UNPARSEABLE_LIST   a list field is not a JSON array text
 *   LEGACY_ITEM_UNREPRESENTABLE an item lacks a string id/name/category or a
 *                             finite numeric va (schema legacyItem / rating)
 * A malformed list is never migrated as a trusted empty list, and a malformed
 * item is never dropped or coerced (no `va: null` rating in a "successful" snapshot).
 */
class LegacyRecordError extends TypeError {
  constructor(code, message, details) {
    super(`migrateLegacyRecord: ${message} (${code}); legacy record left unchanged`);
    this.name = 'LegacyRecordError'; this.code = code; this.details = details || {};
  }
}

/** Parse a legacy item-list string into representable items, or reject the record (LegacyRecordError). */
function legacyList(raw, key) {
  if (raw === null || raw === undefined || raw === '') return [];
  if (typeof raw !== 'string') throw new LegacyRecordError('LEGACY_UNPARSEABLE_LIST', `legacy field '${key}' is not a JSON text`, { list: key, type: typeof raw });
  let v;
  try { v = JSON.parse(raw); } catch (e) { throw new LegacyRecordError('LEGACY_UNPARSEABLE_LIST', `legacy field '${key}' is not valid JSON`, { list: key, reason: e.message }); }
  if (!Array.isArray(v)) throw new LegacyRecordError('LEGACY_UNPARSEABLE_LIST', `legacy field '${key}' is not a JSON array`, { list: key, type: typeof v });
  v.forEach((it, index) => {
    const okItem = isPlainObject(it) && typeof it.id === 'string' && it.id !== '' && typeof it.name === 'string' && typeof it.category === 'string' && typeof it.va === 'number' && Number.isFinite(it.va);
    if (!okItem) throw new LegacyRecordError('LEGACY_ITEM_UNREPRESENTABLE', `legacy field '${key}' item ${index} is not representable in the typed snapshot (string id/name/category and a finite numeric va are required)`, { list: key, index, itemId: isPlainObject(it) && typeof it.id === 'string' ? it.id : null });
  });
  return v;
}

function legacyLoad(it, category, classification) {
  return {
    id: it.id, label: it.name, legacy: legacyItem(it), category, classification,
    rating: { kind: 'va', value: it.va, volts: null }, quantity: 1, status: null, continuous: null, connection: null, leg: null,
    separatelyControlledUnits: null, alms: { present: false, maxLoadVA: null },
  };
}

function legacyItem(it) {
  return { id: it.id, name: it.name, va: it.va, category: it.category };
}

/**
 * Structured migration of a v1 Favorites record (`{method, voltage, scope,
 * sqFt, appliances, hvac, ev}` with the three lists as JSON strings; synthetic
 * `lcMeterVA` supported). Returns `{ snapshot, problems }`:
 *  - `snapshot` is a new 3.2.1 LoadCalcInput whose `migration` block keeps the
 *    source record verbatim, one transform per item, unresolved items as
 *    structured data, the field map and notes. Counts are derived only through
 *    transforms[] (one contribution per item). Nothing is written back.
 *  - `problems` are the migration-sourced input problems the engine re-derives
 *    from the record (LEGACY_AMBIGUOUS / UNKNOWN_ENUM / NOT_FINITE); they are
 *    returned here for the adapter's information only (one per code+field).
 * A count target (laundryCircuits, nycAcCircuitCount) is finalized ONLY when
 * every legacy item aimed at it resolved (B1-r1, R-B1-04): if any item for the
 * same target is unresolved, the valid items keep their partial contributions
 * in transforms[] (status 'applied', contribution 1, note) but the field stays
 * null and LEGACY_AMBIGUOUS stays open — in every list order and after any
 * JSON round trip, because the engine re-derives it from unresolvedItems[]
 * while the field is null.
 * Records the typed snapshot cannot represent are rejected with
 * LegacyRecordError (see above); the input record is never mutated.
 */
function migrateLegacyRecord(record) {
  if (!isPlainObject(record)) throw new TypeError('migrateLegacyRecord: record must be an object');
  const get = (k) => (own(record, k) ? record[k] : undefined);
  const notes = []; const transforms = []; const unresolved = []; const loads = []; const problems = [];
  const counts = { laundry: { field: 'dwelling.laundryCircuits', applied: [], unresolvedIds: [] }, nyc: { field: 'dwelling.nycAcCircuitCount', applied: [], unresolvedIds: [] } };
  const fieldMap = {
    method: 'method.selected', voltage: 'supply.topology', scope: 'occupancy', sqFt: 'dwelling.floorAreaFt2',
    appliances: 'loads[]/dwelling.laundryCircuits', hvac: 'loads[]/dwelling.nycAcCircuitCount', ev: 'loads[]',
  };
  const problem = (code, field) => { if (!problems.some((p) => p.code === code && p.field === field)) problems.push({ code, field, layer: 'input', source: 'migration', ruleRef: null, message: `${code} at ${field}` }); };
  // representability of every list is settled before anything is built (all-or-nothing, no partial snapshot)
  const lists = { appliances: legacyList(get('appliances'), 'appliances'), hvac: legacyList(get('hvac'), 'hvac'), ev: legacyList(get('ev'), 'ev') };

  // supply
  const voltage = get('voltage') === undefined || get('voltage') === null ? '' : String(get('voltage'));
  const topology = own(LEGACY_VOLTAGE, voltage) ? LEGACY_VOLTAGE[voltage] : null;
  if (own(LEGACY_VOLTAGE_AMBIGUOUS, voltage)) {
    problem('LEGACY_AMBIGUOUS', 'supply.topology');
    notes.push(`legacy voltage '${voltage}' is ambiguous between two 3-ph topologies; old lcUpdate parsed '480' as 1-ph`);
  } else if (topology === null && voltage !== '') {
    problem('UNKNOWN_ENUM', 'supply.topology');
  }

  // items
  for (const [kind, key] of [['appliance', 'appliances'], ['hvac', 'hvac'], ['ev', 'ev']]) {
    for (const it of lists[key]) {
      const legacy = legacyItem(it);
      if (it.category === 'laundry') {
        if (it.va === 1500) { const t = { itemId: it.id, legacy, target: 'dwelling.laundryCircuits', targetId: null, contribution: 1, status: 'applied', reason: null, note: null }; transforms.push(t); counts.laundry.applied.push(t); }
        else { unresolved.push({ itemId: it.id, legacy, target: 'dwelling.laundryCircuits', targetId: null, contribution: null, status: 'unresolved', reason: 'LEGACY_AMBIGUOUS', note: 'laundry item VA != 1500; count not derived; raw item retained' }); counts.laundry.unresolvedIds.push(it.id); problem('LEGACY_AMBIGUOUS', 'dwelling.laundryCircuits'); }
        continue;
      }
      if (it.name === LEGACY_NYC_AC_OUTLET) {
        if (it.va === 1500) { const t = { itemId: it.id, legacy, target: 'dwelling.nycAcCircuitCount', targetId: null, contribution: 1, status: 'applied', reason: null, note: 'NYC A/C receptacle circuit, not HVAC equipment' }; transforms.push(t); counts.nyc.applied.push(t); }
        else { unresolved.push({ itemId: it.id, legacy, target: 'dwelling.nycAcCircuitCount', targetId: null, contribution: null, status: 'unresolved', reason: 'LEGACY_AMBIGUOUS', note: 'outlet preset VA != 1500' }); counts.nyc.unresolvedIds.push(it.id); problem('LEGACY_AMBIGUOUS', 'dwelling.nycAcCircuitCount'); }
        continue;
      }
      const table = kind === 'hvac' ? LEGACY_HVAC_CATEGORY : LEGACY_PRESET_CATEGORY;
      const category = own(table, it.name) ? table[it.name] : null;
      const classification = category ? 'confirmed' : 'required';
      loads.push(legacyLoad(it, category, classification));
      transforms.push({ itemId: it.id, legacy, target: 'loads', targetId: it.id, contribution: it.va, status: 'applied', reason: category ? null : 'CLASSIFICATION_REQUIRED', note: category ? null : 'not an unambiguous preset name' });
    }
  }
  // count targets: finalized only when nothing aimed at them is unresolved (B1-r1, R-B1-04)
  const finalCount = (c) => {
    if (!c.applied.length) return null;
    if (!c.unresolvedIds.length) return c.applied.length;
    const ids = c.unresolvedIds.slice().sort(codePointCompare);
    for (const t of c.applied) t.note = `partial contribution (1 circuit) retained; ${c.field} not finalized while item(s) ${ids.map((x) => JSON.stringify(x)).join(', ')} for the same target are unresolved`;
    notes.push(`${c.field}: ${c.applied.length} valid circuit(s) counted but not finalized (unresolved item(s) ${ids.map((x) => JSON.stringify(x)).join(', ')} for the same target); field left empty`);
    return null;
  };
  const laundry = finalCount(counts.laundry); const nyc = finalCount(counts.nyc);

  // dwelling
  const sqFtRaw = get('sqFt');
  const floorArea = legacyNumber(sqFtRaw);
  if (floorArea === null && sqFtRaw !== undefined && sqFtRaw !== null && String(sqFtRaw).trim() !== '') { problem('NOT_FINITE', 'dwelling.floorAreaFt2'); notes.push(`legacy sqFt '${String(sqFtRaw)}' is not a number; floor area left empty`); }
  const dwelling = { floorAreaFt2: floorArea, smallApplianceCircuits: null, laundryCircuits: laundry, nycAcCircuitCount: nyc, existingDwelling: null };

  // synthetic measurement (only when the legacy record carries lcMeterVA)
  let measurement = null;
  const meterRaw = get('lcMeterVA');
  if (meterRaw !== undefined && meterRaw !== null && String(meterRaw) !== '') {
    fieldMap.lcMeterVA = 'measurement.reading (VA)';
    const meter = legacyNumber(meterRaw);
    if (meter === null) { problem('NOT_FINITE', 'measurement.reading.value'); notes.push(`legacy lcMeterVA '${String(meterRaw)}' is not a number; reading left empty`); }
    const d = () => declared(null, 'legacy_record');
    measurement = {
      basis: null, reading: { value: meter, unit: 'VA' }, readingsPerConductor: null, readingScope: null, powerFactor: null,
      annualDataAvailable: d(), periodMonths: null, periodDays: null, intervalMinutes: null, metric: null, continuousRecording: d(),
      instrument: null, connectedTo: null, basedOnInitialLoading: d(), recordedWhileOccupied: d(), includesLargerOfHeatingOrCooling: d(),
      includesPeriodicSeasonalLoads: d(), hasRenewableEnergySystem: d(), hasPeakLoadShaving: d(),
      existing: { serviceRatingA: null, feederAmpacityA: null, ocpdA: null, feederOcpPer240_4: d(), serviceOverloadPer230_90: d() },
      newLoad: { mode: null, precalculated: null },
    };
  }

  const sourceRecord = {};
  for (const k of LEGACY_FIELDS) sourceRecord[k] = get(k) === undefined || get(k) === null ? null : String(get(k));
  const scope = get('scope') === undefined || get('scope') === null ? '' : String(get('scope'));
  const method = get('method') === undefined || get('method') === null ? '' : String(get('method'));

  const snapshot = createEmptySnapshot();
  snapshot.occupancy = own(LEGACY_SCOPE, scope) ? LEGACY_SCOPE[scope] : null;
  snapshot.supply = supplyFor(topology);
  snapshot.loadModel = { kind: null, declarations: {} };
  snapshot.method = { selected: own(LEGACY_METHOD, method) ? LEGACY_METHOD[method] : null, guideRecommendation: null, selectionSource: 'legacy', guideAnswers: {} };
  snapshot.dwelling = dwelling;
  snapshot.loads = loads;
  snapshot.measurement = measurement;
  snapshot.migration = { from: 1, savePolicy: 'save_as_copy', sourceRecord, transforms, unresolvedItems: unresolved, fieldMap, notes };
  return { snapshot, problems };
}

module.exports = {
  SCHEMA_VERSION, RULE_BASIS, COVERS_FIELDS, TOPOLOGY_SUPPLY, LEGACY_PRESET_CATEGORY, LEGACY_HVAC_CATEGORY, LEGACY_VOLTAGE, LEGACY_VOLTAGE_AMBIGUOUS,
  clone, defineData, declared, supplyFor, codePointCompare,
  createEmptySnapshot, coversProjection, canonicalJson, isAggregateStale, captureCoversSnapshot, setOccupancy, migrateLegacyRecord, LegacyRecordError,
};
