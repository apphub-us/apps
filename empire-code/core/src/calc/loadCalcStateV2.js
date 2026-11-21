'use strict';
/**
 * Empire Code — Load Calc V2 draft/state helpers (LC-22082-B0-STATE-STORE-1).
 *
 * Pure data helpers for the accepted V2 request boundary (loadCalcInputV2.js / loadCalcFacade.js).
 * No DOM, no localStorage, no clock/random allocation, no mutation of caller objects, no calculation.
 * IDs and basis IDs always come from explicit arguments.
 *
 * Draft = { snapshot (3.3.0), context, fieldErrors, loadErrors, sourceFavId }
 *   - fieldErrors: { <canonical scalar path>: {raw, code[, badInput:true]} }   (own keys, prototype-free)
 *   - loadErrors:  { <load id>: { <load subfield>: {raw, code[, badInput:true]} } }
 *   - sourceFavId: storage-only metadata (null | finite number | string); never part of a request.
 *
 * Contract: INTEGRATION-SCOPE-1-R1 + CLOSE-1 (S1–S3) + CLOSE-2 (I1–I3); premise/basis rules from
 * PREMISES-1-R1 and R1-CLOSE-1 (per-slot required facts, stale-before-either-polarity — decided by the
 * accepted engine, never re-implemented here).
 */
const A = require('./loadCalcInput.js');
const AS = require('./loadCalcState.js');
const V2 = require('./loadCalcInputV2.js');

const E = A.ENUMS;
/**
 * V3 — OWN closed lists for this layer. Captured once at module load from the accepted R3 exports and kept in
 * private frozen structures; a later addition to the shared exported Set can never widen storage/projection here.
 * R3's own exports are neither modified nor frozen by this module.
 */
const OWNED_SCALAR_PATHS = Object.freeze(Array.from(V2.SCALAR_PATHS).slice().sort());
const OWNED_LOAD_FIELDS = Object.freeze(Array.from(V2.LOAD_FIELDS).slice().sort());
const OWNED_SCALAR_SET = new Set(OWNED_SCALAR_PATHS);
const OWNED_LOAD_FIELD_SET = new Set(OWNED_LOAD_FIELDS);
const isOwnedScalarPath = (p) => OWNED_SCALAR_SET.has(p);
const isOwnedLoadField = (f) => OWNED_LOAD_FIELD_SET.has(f);
const OWNED_PARSE_CODES = Object.freeze(V2.ENUMS2.parseCode.slice());
const PREDICATE_BY_CATEGORY = Object.freeze({ dryer: 'b3c_dryer_not_on_counted_laundry_circuit', dishwasher: 'b3a_fixed_or_specific_circuit', appliance_fixed_other: 'b3a_fixed_or_specific_circuit' });
const DRYER_ANSWERS = Object.freeze(['not_on_counted_laundry_circuit', 'on_counted_laundry_circuit']);
const B3A_ANSWERS = Object.freeze(['fixed_or_permanently_connected', 'specific_circuit', 'on_counted_b2_circuit', 'none_of_these']);
const PROVENANCE_DEFAULT = 'designer_declaration';

// ── prototype-free dictionaries (own-key semantics; '__proto__'/'constructor' are ordinary data keys) ──
const dict = () => Object.create(null);
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const put = (d, k, v) => { Object.defineProperty(d, k, { value: v, writable: true, enumerable: true, configurable: true }); return v; };
const keys = (d) => (d !== null && typeof d === 'object' ? Object.keys(d) : []);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const codePointCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (problems) => ({ ok: false, problems: problems.slice() });
/** Deep copy of accepted JSON data (plain objects, own keys assigned safely so a data key named '__proto__' never reaches the setter). */
function copyJson(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(copyJson);
  const out = {}; for (const k of keys(v)) put(out, k, copyJson(v[k])); return out;
}
/** Copy a dictionary of error entries (one or two levels). */
function copyMap(m, depth) {
  const out = dict();
  for (const k of keys(m)) put(out, k, depth > 1 ? copyMap(m[k], depth - 1) : copyJson(m[k]));
  return out;
}
const unconfirmedDecl = (source) => ({ value: null, provenance: { source: source || PROVENANCE_DEFAULT, note: null } });
const unconfirmedInventory = () => ({ value: null, provenance: { source: PROVENANCE_DEFAULT, note: null }, basis: null });

/** Blank V2 draft: the accepted empty A snapshot (P-5) lifted to 3.3.0; no seeded records, no B0. */
const SNAPSHOT_KEY_ORDER = Object.freeze(['schemaVersion', 'ruleBasis', 'purpose', 'occupancy', 'supply', 'loadModel', 'method', 'dwelling', 'optional82', 'loads', 'hvac', 'measurement', 'multifamily', 'migration']);
/** Lift an A snapshot object to the V2 shape in the accepted key order (optional82 between dwelling and loads, as in the settled B0-P candidate). */
function liftToV2Shape(aSnapshot) {
  const src = Object.assign({}, aSnapshot, { schemaVersion: V2.SCHEMA_VERSION_V2, optional82: { singleSupplySet: unconfirmedDecl(), conductorAmpacityA: unconfirmedDecl(), nycAcCentralExceptionAttested: unconfirmedDecl(), laundryExceptionAttested: unconfirmedDecl(), inventoryComplete: unconfirmedInventory() } });
  const out = {}; for (const k of SNAPSHOT_KEY_ORDER) put(out, k, src[k]); for (const k of keys(src)) if (SNAPSHOT_KEY_ORDER.indexOf(k) === -1) put(out, k, src[k]);
  return out;
}
function createEmptyDraftV2() {
  const snapshot = liftToV2Shape(AS.createEmptySnapshot());
  snapshot.loads = [];
  return { snapshot, context: { importedFrom: null, methodConfirmedAfterImport: false }, fieldErrors: dict(), loadErrors: dict(), sourceFavId: null };
}

/**
 * S1: build one structurally valid V2 load record from EXPLICIT arguments.
 * Required: id, basisId (non-empty strings), rating {kind:'va', value:<finite number ≥ 0>, volts:<number|null>}, quantity (safe integer ≥ 1).
 * Optional: label (string, default ''), category (enum or null → classification 'required'), status (enum or null).
 * No invented zero, no inferred category/premise; only actually nullable fields are null.
 */
function newLoadRecord(args) {
  const p = [];
  if (!isPlain(args)) return fail(['args: object required']);
  if (typeof args.id !== 'string' || !args.id.length) p.push('id: non-empty string required');
  if (typeof args.basisId !== 'string' || !args.basisId.length) p.push('basisId: non-empty string required');
  const r = args.rating;
  if (!isPlain(r)) p.push('rating: object {kind, value[, volts]} required (no invented zero)');
  else {
    if (r.kind !== 'va') p.push('rating.kind: only "va" is a computable rating kind in this delivery');
    if (!isFiniteNumber(r.value) || r.value < 0) p.push('rating.value: finite number >= 0 required (no invented zero)');
    if (own(r, 'volts') && r.volts !== null && !isFiniteNumber(r.volts)) p.push('rating.volts: number or null');
    for (const k of keys(r)) if (['kind', 'value', 'volts'].indexOf(k) === -1) p.push(`rating: unexpected key ${JSON.stringify(k)}`);
  }
  if (!Number.isSafeInteger(args.quantity) || args.quantity < 1) p.push('quantity: integer >= 1 required');
  if (own(args, 'label') && typeof args.label !== 'string') p.push('label: string');
  if (own(args, 'category') && args.category !== null && E.category.indexOf(args.category) === -1) p.push('category: unknown value');
  if (own(args, 'status') && args.status !== null && E.loadStatus.indexOf(args.status) === -1) p.push('status: unknown value');
  for (const k of keys(args)) if (['id', 'basisId', 'rating', 'quantity', 'label', 'category', 'status'].indexOf(k) === -1) p.push(`unexpected argument ${k}`);
  if (p.length) return fail(p);
  const category = own(args, 'category') ? args.category : null;
  return { ok: true, load: {
    id: args.id, label: own(args, 'label') ? args.label : '', legacy: null, category, classification: category === null ? 'required' : 'confirmed',
    rating: { kind: 'va', value: r.value, volts: own(r, 'volts') ? r.volts : null }, quantity: args.quantity, status: own(args, 'status') ? args.status : null,
    continuous: null, connection: null, leg: null, separatelyControlledUnits: null, alms: { present: false, maxLoadVA: null },
    basisId: args.basisId, inclusion82: null, ratingCoverage82: null,
  } };
}

/** Clone a record under a fresh id/basisId: data copied, premise facts NOT copied (unconfirmed). */
function cloneLoadRecord(load, ids) {
  const p = validateStandaloneLoad(load, 'load');   // V1: the ORIGINAL record must be structurally valid before it is copied
  if (p.length) return fail(p);
  if (!isPlain(ids) || typeof ids.id !== 'string' || !ids.id.length) p.push('ids.id: non-empty string required');
  if (!isPlain(ids) || typeof ids.basisId !== 'string' || !ids.basisId.length) p.push('ids.basisId: non-empty string required');
  if (isPlain(ids) && ids.id === load.id) p.push('ids.id: a clone needs a fresh id');
  if (isPlain(ids) && ids.basisId === load.basisId) p.push('ids.basisId: a clone needs a fresh basisId');
  if (p.length) return fail(p);
  const c = copyJson(load); c.id = ids.id; c.basisId = ids.basisId; c.inclusion82 = null; c.ratingCoverage82 = null; c.legacy = null;
  return { ok: true, load: c };
}

// ── draft editing (every helper returns a NEW draft; the input draft is never mutated) ──
function copyDraft(d) { return { snapshot: copyJson(d.snapshot), context: copyJson(d.context), fieldErrors: copyMap(d.fieldErrors, 1), loadErrors: copyMap(d.loadErrors, 2), sourceFavId: d.sourceFavId }; }
function draftShapeProblems(draft) {
  const p = [];
  if (!isPlain(draft)) return ['draft: object required'];
  for (const k of ['snapshot', 'context', 'fieldErrors', 'loadErrors', 'sourceFavId']) if (!own(draft, k)) p.push(`draft.${k}: missing`);
  for (const k of keys(draft)) if (['snapshot', 'context', 'fieldErrors', 'loadErrors', 'sourceFavId'].indexOf(k) === -1) p.push(`draft.${k}: unexpected key`);
  if (p.length) return p;
  if (!isPlain(draft.snapshot) || !Array.isArray(draft.snapshot.loads)) p.push('draft.snapshot: object with loads[] required');
  if (!isPlain(draft.fieldErrors) || !isPlain(draft.loadErrors)) p.push('draft maps: object maps required');
  if (!(draft.sourceFavId === null || isFiniteNumber(draft.sourceFavId) || typeof draft.sourceFavId === 'string')) p.push('draft.sourceFavId: null, finite number or string');
  return p;
}
function findLoad(snapshot, loadId) { for (let i = 0; i < snapshot.loads.length; i++) if (snapshot.loads[i].id === loadId) return i; return -1; }
/**
 * V1/V2 — the single original-input boundary. Every problem of the ORIGINAL object is reported here, before any
 * copy, edit or serialization: JSON representability (cycles, non-plain objects, NaN, undefined…), the V2 snapshot
 * shape (so `snapshot.loads` is a real record array before anything traverses it), and the full unfiltered maps.
 * Nothing is stripped, defaulted or repaired: a malformed submap is a refusal, never an empty object in the output.
 */
function validateDraftOriginal(draft) {
  const p = draftShapeProblems(draft); if (p.length) return p;
  const rep = A.jsonRepresentabilityErrors(draft, 'draft'); if (rep.length) return rep;
  const snap = V2.validateSnapshotV2(draft.snapshot); if (snap.length) return snap.map((m) => 'snapshot: ' + m);
  const mp = mapProblems(draft.snapshot, draft.fieldErrors, draft.loadErrors); if (mp.length) return mp;
  // C1 (R2): once the shape prerequisites for a safe projection hold, the WHOLE ORIGINAL V2 envelope — including
  // `context` — is validated with the accepted public boundary, before anything is copied or changed. The context
  // schema is not duplicated here and no value is normalised, defaulted or stripped: the original's problems are
  // returned through the ordinary failure convention. Fixed accepted identities; unfiltered canonical projection.
  return V2.validateRequestV2({ apiVersion: V2.API_VERSION, profileId: V2.CAPABILITY_PROFILE_ID, context: draft.context, parseErrors: projectErrors(draft.snapshot, draft.fieldErrors, draft.loadErrors, null), snapshot: draft.snapshot });
}
/** V1 — a standalone source record is validated in a temporary valid container: its own shape, unchanged and unrepaired. */
function validateStandaloneLoad(load, where) {
  if (!isPlain(load)) return [`${where}: object required`];
  const rep = A.jsonRepresentabilityErrors(load, where); if (rep.length) return rep;
  const probe = createEmptyDraftV2(); probe.snapshot.loads = [load];
  return V2.validateSnapshotV2(probe.snapshot).filter((m) => m.indexOf('snapshot.loads[0]') === 0).map((m) => m.replace('snapshot.loads[0]', where));
}
function edit(draft, loadId, mut) {
  const sp = validateDraftOriginal(draft); if (sp.length) return fail(sp);   // V1: the ORIGINAL draft is validated before it is copied or edited
  if (loadId !== undefined && (typeof loadId !== 'string' || !loadId.length)) return fail(['loadId: non-empty string required']);
  const next = copyDraft(draft);
  const i = loadId === undefined ? -1 : findLoad(next.snapshot, loadId);
  if (loadId !== undefined && i === -1) return fail([`loadId ${JSON.stringify(loadId)}: no such record`]);
  const problems = mut(next, i === -1 ? null : next.snapshot.loads[i]);
  if (problems && problems.length) return fail(problems);
  return { ok: true, draft: next };
}
/** Equipment/circuit changed: only the identified basis changes; stored facts stay and become stale under R3's rules. */
function markBasisChanged(draft, loadId, ids) {
  return edit(draft, loadId, (next, l) => {
    if (!isPlain(ids) || typeof ids.basisId !== 'string' || !ids.basisId.length) return ['basisId: non-empty string required'];
    if (ids.basisId === l.basisId) return ['basisId: must differ from the current basis'];
    if (next.snapshot.loads.some((x) => x.basisId === ids.basisId)) return ['basisId: already used by another record'];
    l.basisId = ids.basisId; return [];
  });
}
/** Answer the category-specific inclusion predicate with the CURRENT basis; `null` resets to the unanswered object. */
function setInclusionAnswer(draft, loadId, answer) {
  return edit(draft, loadId, (next, l) => {
    const predicate = PREDICATE_BY_CATEGORY[l.category];
    if (!predicate) return [`inclusion82: category ${JSON.stringify(l.category)} has no inclusion predicate`];
    if (answer === null) { l.inclusion82 = { predicate, answer: null, basis: null }; return []; }
    const allowed = predicate === 'b3c_dryer_not_on_counted_laundry_circuit' ? DRYER_ANSWERS : B3A_ANSWERS;
    if (allowed.indexOf(answer) === -1) return [`inclusion82: answer ${JSON.stringify(answer)} is not valid for predicate ${predicate}`];
    l.inclusion82 = { predicate, answer, basis: { basisId: l.basisId, category: l.category, quantity: l.quantity } }; return [];
  });
}
/** Answer the A/C rating-coverage declaration (one system) with the CURRENT basis; `null` resets. */
function setRatingCoverageAnswer(draft, loadId, value) {
  return edit(draft, loadId, (next, l) => {
    if (l.category !== 'ac') return [`ratingCoverage82: category ${JSON.stringify(l.category)} is not ac`];
    if (value === null) { l.ratingCoverage82 = { value: null, basis: null }; return []; }
    if (typeof value !== 'boolean') return ['ratingCoverage82: boolean or null required'];
    l.ratingCoverage82 = { value, basis: { basisId: l.basisId, category: 'ac', quantity: l.quantity, rating: { kind: l.rating.kind, value: l.rating.value } } }; return [];
  });
}
/** Answer the whole-dwelling inventory declaration, capturing the CURRENT members {id, basisId, category, quantity}. */
function setInventoryAnswer(draft, value) {
  return edit(draft, undefined, (next) => {
    if (!isPlain(next.snapshot.optional82)) return ['snapshot.optional82: object required before an inventory answer'];
    const inv = next.snapshot.optional82.inventoryComplete; const source = (isPlain(inv) && isPlain(inv.provenance) && typeof inv.provenance.source === 'string') ? inv.provenance.source : PROVENANCE_DEFAULT;
    if (value === null) { next.snapshot.optional82.inventoryComplete = { value: null, provenance: { source, note: null }, basis: null }; return []; }
    if (typeof value !== 'boolean') return ['inventoryComplete: boolean or null required'];
    const members = next.snapshot.loads.map((l) => ({ id: l.id, basisId: l.basisId, category: l.category, quantity: l.quantity })).sort((a, b) => codePointCompare(a.id, b.id));
    next.snapshot.optional82.inventoryComplete = { value, provenance: { source, note: null }, basis: { members } }; return [];
  });
}
/** Label edit: presentation only — no basis, declaration or other record changes. */
function setLabel(draft, loadId, text) {
  return edit(draft, loadId, (next, l) => { if (typeof text !== 'string') return ['label: string required']; l.label = text; return []; });
}

/**
 * Deterministic A-adapter activity policy (the accepted lcFieldActive rule, mobile.html 9727–9741),
 * as a pure function of the snapshot: returns the set of canonical scalar paths whose retained
 * parser errors are transported on the A route. Non-measurement paths are always active for A;
 * measurement paths depend on the measured method and its modes. The 82 activity rules are NOT here:
 * on the explicit 82 route every canonical error is carried and the accepted engine decides.
 */
function activeAPaths(snapshot) {
  const s = snapshot; const m = s.measurement; const measured = s.method.selected === 'measured_220_87'; const out = new Set();
  for (const path of OWNED_SCALAR_PATHS) {
    if (path.indexOf('measurement.') !== 0) { out.add(path); continue; }
    if (!measured || !m) continue;
    let active = true;
    if (path.indexOf('measurement.newLoad.precalculated.') === 0) active = m.newLoad.mode === 'precalculated';
    else if (path === 'measurement.periodMonths') active = m.basis === 'annual_max_demand';
    else if (path === 'measurement.periodDays' || path === 'measurement.intervalMinutes' || path === 'measurement.connectedTo') active = m.basis === '30d_recording_exception';
    else if (path === 'measurement.powerFactor') active = m.reading.unit === 'kW';
    else if (path.indexOf('measurement.readingsPerConductor.') === 0) active = m.reading.unit === 'A' && m.readingScope === 'per_conductor';
    else if (path === 'measurement.reading.value') active = !(m.reading.unit === 'A' && m.readingScope === 'per_conductor');
    else if (path === 'measurement.readingScope') active = m.reading.unit === 'A';
    else if (path === 'measurement.existing.serviceRatingA') active = s.purpose !== 'feeder';
    else if (path === 'measurement.existing.feederAmpacityA') active = s.purpose === 'feeder';
    if (active) out.add(path);
  }
  return out;
}

/** Structural validation of the draft maps (entries, closed paths/subfields, known unique ids, representability). Shared with the storage module. */
function mapProblems(snapshot, fieldErrors, loadErrors) {
  const p = [];
  const entryOk = (e, where) => {
    if (!isPlain(e)) { p.push(`${where}: error entry is not an object`); return; }
    for (const k of keys(e)) if (['raw', 'code', 'badInput'].indexOf(k) === -1) p.push(`${where}: unexpected key ${JSON.stringify(k)}`);
    if (typeof e.raw !== 'string') p.push(`${where}: raw must be a string`);
    if (OWNED_PARSE_CODES.indexOf(e.code) === -1) p.push(`${where}: unknown code ${String(e.code)}`);
    if (own(e, 'badInput') && e.badInput !== true) p.push(`${where}: badInput must be true when present`);
  };
  if (!isPlain(fieldErrors)) p.push('fieldErrors: object map required');
  else for (const path of keys(fieldErrors)) { if (!isOwnedScalarPath(path)) p.push(`fieldErrors: ${JSON.stringify(path)} is not a canonical V2 scalar path`); entryOk(fieldErrors[path], `fieldErrors[${path}]`); }
  if (!isPlain(loadErrors)) p.push('loadErrors: object map required');
  else {
    const ids = Array.isArray(snapshot && snapshot.loads) ? snapshot.loads.map((l) => l && l.id) : []; const seen = new Set(); const dup = new Set();
    for (const id of ids) { if (seen.has(id)) dup.add(id); seen.add(id); }
    for (const id of dup) p.push(`snapshot.loads: id ${JSON.stringify(id)} is repeated`);
    for (const id of keys(loadErrors)) {
      if (!seen.has(id)) p.push(`loadErrors: ${JSON.stringify(id)} is not a load of this snapshot`);
      const m = loadErrors[id];
      if (!isPlain(m)) { p.push(`loadErrors[${id}]: object map required`); continue; }
      for (const sub of keys(m)) { if (!isOwnedLoadField(sub)) p.push(`loadErrors[${id}]: ${JSON.stringify(sub)} is not a canonical load field`); entryOk(m[sub], `loadErrors[${id}].${sub}`); }
    }
  }
  return p;
}
/** Unfiltered canonical projection of both maps (indices from the CURRENT record order), sorted by field. */
function projectErrors(snapshot, fieldErrors, loadErrors, activeSet) {
  const list = [];
  for (const path of keys(fieldErrors)) { if (activeSet && !activeSet.has(path)) continue; const e = fieldErrors[path]; list.push({ field: path, raw: e.raw, code: e.code }); }
  snapshot.loads.forEach((l, i) => { if (!own(loadErrors, l.id)) return; const m = loadErrors[l.id]; for (const sub of keys(m)) list.push({ field: `loads[${i}].${sub}`, raw: m[sub].raw, code: m[sub].code }); });
  list.sort((a, b) => codePointCompare(a.field, b.field));
  return list;
}

/**
 * Canonical V2 request from a draft, on a copy. The FULL draft (structure, both maps, dormant data) is
 * validated first; only then are inactive A-route errors filtered (activeAPaths). On the explicit 82
 * route all canonical errors are carried for the accepted engine. sourceFavId never enters the request.
 */
function toRequestV2(draft) {
  const orig = validateDraftOriginal(draft); if (orig.length) return fail(orig);   // includes the whole-envelope check (context incl.)
  const unfiltered = { apiVersion: V2.API_VERSION, profileId: V2.CAPABILITY_PROFILE_ID, context: copyJson(draft.context), parseErrors: projectErrors(draft.snapshot, draft.fieldErrors, draft.loadErrors, null), snapshot: copyJson(draft.snapshot) };
  const route82 = draft.snapshot.method.selected === 'opt_220_82';
  const request = Object.assign({}, unfiltered, { parseErrors: route82 ? unfiltered.parseErrors : projectErrors(draft.snapshot, draft.fieldErrors, draft.loadErrors, activeAPaths(draft.snapshot)) });
  return { ok: true, request };
}

module.exports = {
  createEmptyDraftV2, newLoadRecord, cloneLoadRecord, markBasisChanged, setInclusionAnswer, setRatingCoverageAnswer, setInventoryAnswer, setLabel, activeAPaths, toRequestV2,
  PREDICATE_BY_CATEGORY, DRYER_ANSWERS, B3A_ANSWERS, OWNED_SCALAR_PATHS, OWNED_LOAD_FIELDS,
  // internal helpers shared with the storage module (not a second public architecture)
  _internal: Object.freeze({ dict, own, put, keys, isPlain, isFiniteNumber, copyJson, copyMap, draftShapeProblems, mapProblems, projectErrors, unconfirmedInventory, unconfirmedDecl, liftToV2Shape, SNAPSHOT_KEY_ORDER, validateDraftOriginal, validateStandaloneLoad, isOwnedScalarPath, isOwnedLoadField }),
};
