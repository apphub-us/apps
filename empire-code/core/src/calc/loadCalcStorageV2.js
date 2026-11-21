'use strict';
/**
 * Empire Code — Load Calc lcv-3 storage format and old-record import (LC-22082-B0-STATE-STORE-1).
 *
 * Pure helpers only: no localStorage, no Favorites writes, no DOM, no clock/random, no mutation of
 * any caller object. This module never commits anything; a later UI delivery wires real storage.
 *
 * lcv-3 payload (closed top-level keys):
 *   { lcv: 3, capabilityProfile: 'AB82_core1', context, snapshot (3.3.0), fieldErrors, loadErrors, sourceFavId }
 *   - no result, no cached facade, no alternate profile, no overflow container.
 *
 * Old formats: an object WITHOUT its own `lcv` key is a legacy Favorite record; `lcv: 2` is the accepted
 * A payload (B2, mobile.html 10216–10259); `lcv: 3` is this format; anything else is unknown.
 * I1: FROZEN_A_LCV2 is a trusted immutable copy of the OLD interface constants (34 field paths incl. the two
 * literal `loads[]` keys, 2 load subfields, profile A_measured_87_core); `opts.legacyContract` is a checked
 * assertion against it, never a permission source. I2: old-format validity is decided under that frozen
 * boundary first; lossless representability in the V2 draft / unfiltered V3 maps is decided separately; the
 * candidate is validated before success. I3: import never confirms the method (false), never premises,
 * source rules or capability; only a later explicit manual reselection (outside this module) may set true.
 */
const A = require('./loadCalcInput.js');
const AS = require('./loadCalcState.js');
const V2 = require('./loadCalcInputV2.js');
const ST = require('./loadCalcStateV2.js');

const { dict, own, put, keys, isPlain, isFiniteNumber, copyJson, copyMap, draftShapeProblems, mapProblems, projectErrors, liftToV2Shape, validateDraftOriginal } = ST._internal;
const LCV3 = 3;
const PAYLOAD_KEYS = Object.freeze(['lcv', 'capabilityProfile', 'context', 'snapshot', 'fieldErrors', 'loadErrors', 'sourceFavId']);
const LEGACY_PROVENANCE = Object.freeze({ lcv: 1, profileId: 'legacy_pre_lcv_favorite', schemaVersion: 'unversioned' });
const LCV2_PROVENANCE = Object.freeze({ lcv: 2, profileId: 'A_measured_87_core', schemaVersion: '3.2.1' });

/** I1 — trusted immutable local descriptor of the OLD lcv-2 interface (identical to reference/frozen-A-lcv2-descriptor.json). */
const FROZEN_A_LCV2 = Object.freeze({
  profileId: 'A_measured_87_core',
  fieldPaths: Object.freeze([
    'measurement.reading.value', 'measurement.readingsPerConductor.L1', 'measurement.readingsPerConductor.L2', 'measurement.readingsPerConductor.L3', 'measurement.powerFactor',
    'measurement.periodMonths', 'measurement.periodDays', 'measurement.intervalMinutes', 'measurement.existing.serviceRatingA', 'measurement.existing.feederAmpacityA', 'measurement.existing.ocpdA',
    'measurement.newLoad.precalculated.va', 'loads[].rating.value', 'loads[].quantity', 'occupancy', 'purpose', 'supply.topology', 'loadModel.kind', 'method.selected',
    'method.guideAnswers.houseFeeder', 'method.guideAnswers.aptFeeder', 'method.guideAnswers.houseState', 'method.guideAnswers.bldgCooking',
    'measurement.basis', 'measurement.reading.unit', 'measurement.readingScope', 'measurement.connectedTo', 'measurement.metric', 'measurement.instrument', 'measurement.newLoad.mode',
    'measurement.newLoad.precalculated.connection', 'measurement.newLoad.precalculated.leg', 'measurement.newLoad.precalculated.basis.method', 'measurement.newLoad.precalculated.basis.calculatedBy',
  ]),
  loadSubfields: Object.freeze(['rating.value', 'quantity']),
});
const LCV2_PAYLOAD_KEYS = Object.freeze(['lcv', 'profileId', 'snapshot', 'fieldErrors', 'loadErrors', 'sourceFavId']);
const fail = (problems) => ({ ok: false, problems: problems.slice() });
const sourceFavIdOk = (v) => v === null || isFiniteNumber(v) || typeof v === 'string';

// ── lcv-3 ──
/** Serialize a draft into an lcv-3 payload (validated first; nothing derived, no result). */
function toPayloadV3(draft) {
  const sp = validateDraftOriginal(draft); if (sp.length) return fail(sp);   // V1: the ORIGINAL draft is validated before any copy; malformed content is refused, never cleaned
  const payload = { lcv: LCV3, capabilityProfile: V2.CAPABILITY_PROFILE_ID, context: copyJson(draft.context), snapshot: copyJson(draft.snapshot), fieldErrors: copyMap(draft.fieldErrors, 1), loadErrors: copyMap(draft.loadErrors, 2), sourceFavId: draft.sourceFavId };
  const problems = validatePayloadV3(payload); if (problems.length) return fail(problems);
  return { ok: true, payload };
}
/** Complete structural validation of an lcv-3 wrapper: keys, identities, sourceFavId, context + snapshot + UNFILTERED canonical errors via the public V2 request validator, storage map rules. */
function validatePayloadV3(payload) {
  if (!isPlain(payload)) return ['payload is not an object'];
  const rep = A.jsonRepresentabilityErrors(payload, 'payload'); if (rep.length) return rep.slice(0, 8);
  const p = [];
  if (payload.lcv !== LCV3) p.push(`payload version ${String(payload.lcv)} is not ${LCV3}`);
  if (payload.capabilityProfile !== V2.CAPABILITY_PROFILE_ID) p.push(`capabilityProfile ${String(payload.capabilityProfile)} is not ${V2.CAPABILITY_PROFILE_ID}`);
  for (const k of keys(payload)) if (PAYLOAD_KEYS.indexOf(k) === -1) p.push(`unexpected payload key ${JSON.stringify(k)}`);
  for (const k of PAYLOAD_KEYS) if (!own(payload, k)) p.push(`missing payload key ${k}`);
  if (own(payload, 'sourceFavId') && !sourceFavIdOk(payload.sourceFavId)) p.push('sourceFavId must be null, a finite number or a string');
  if (p.length) return p;
  // V2: the snapshot shape (and therefore `snapshot.loads` as a real record array) is established BEFORE any traversal or projection.
  const snap = V2.validateSnapshotV2(payload.snapshot); if (snap.length) return snap.map((m) => 'snapshot: ' + m);
  const mp = mapProblems(payload.snapshot, payload.fieldErrors, payload.loadErrors); if (mp.length) return mp;
  const request = { apiVersion: V2.API_VERSION, profileId: V2.CAPABILITY_PROFILE_ID, context: payload.context, parseErrors: projectErrors(payload.snapshot, payload.fieldErrors, payload.loadErrors, null), snapshot: payload.snapshot };
  return V2.validateRequestV2(request);   // full wrapper: context + snapshot + unfiltered canonical errors
}
/** Restore a draft from a valid lcv-3 payload: context, facts (stale ones stay stale), both maps and sourceFavId verbatim. */
function restorePayloadV3(payload) {
  const problems = validatePayloadV3(payload); if (problems.length) return fail(problems);
  return { ok: true, draft: { snapshot: copyJson(payload.snapshot), context: copyJson(payload.context), fieldErrors: copyMap(payload.fieldErrors, 1), loadErrors: copyMap(payload.loadErrors, 2), sourceFavId: payload.sourceFavId } };
}

// ── classification of stored records ──
function classifyStoredRecord(vals) {
  if (!isPlain(vals)) return 'unknown';
  if (!own(vals, 'lcv')) return 'legacy';
  if (vals.lcv === 2) return 'lcv2';
  if (vals.lcv === 3) return 'lcv3';
  return 'unknown';
}

// ── I1: descriptor assertion ──
function sameStringSet(supplied, trusted, what) {
  const p = [];
  if (!Array.isArray(supplied)) return [`${what}: array required`];
  const seen = new Set();
  for (const x of supplied) {
    if (typeof x !== 'string') { p.push(`${what}: non-string member`); continue; }
    if (seen.has(x)) p.push(`${what}: duplicate member ${JSON.stringify(x)}`); seen.add(x);
    if (trusted.indexOf(x) === -1) p.push(`${what}: extra member ${JSON.stringify(x)} not in the frozen A descriptor`);
  }
  for (const x of trusted) if (!seen.has(x)) p.push(`${what}: missing member ${JSON.stringify(x)}`);
  return p;
}
function assertLegacyContract(lc) {
  if (!isPlain(lc)) return ['legacyContract: object {fieldPaths, loadSubfields, profileId} required'];
  const p = [];
  for (const k of keys(lc)) if (['fieldPaths', 'loadSubfields', 'profileId'].indexOf(k) === -1) p.push(`legacyContract: unexpected key ${JSON.stringify(k)}`);
  p.push(...sameStringSet(lc.fieldPaths, FROZEN_A_LCV2.fieldPaths, 'legacyContract.fieldPaths'));
  p.push(...sameStringSet(lc.loadSubfields, FROZEN_A_LCV2.loadSubfields, 'legacyContract.loadSubfields'));
  if (lc.profileId !== FROZEN_A_LCV2.profileId) p.push(`legacyContract.profileId: ${String(lc.profileId)} is not ${FROZEN_A_LCV2.profileId}`);
  return p;
}

// ── old lcv-2 validity under the frozen boundary (reproduces only the old payload/map boundary; A validateSnapshot is the public core boundary) ──
function validateLcv2(vals) {
  const p = [];
  if (vals.lcv !== 2) p.push(`payload version ${String(vals.lcv)} is not 2`);
  if (vals.profileId !== FROZEN_A_LCV2.profileId) p.push(`profile ${String(vals.profileId)} is not ${FROZEN_A_LCV2.profileId}`);
  for (const k of keys(vals)) if (LCV2_PAYLOAD_KEYS.indexOf(k) === -1) p.push(`unexpected payload key ${JSON.stringify(k)}`);
  if (!own(vals, 'sourceFavId') || !sourceFavIdOk(vals.sourceFavId)) p.push('sourceFavId must be null, a number or a string');
  if (p.length) return p;
  const snapErrs = A.validateSnapshot(vals.snapshot); if (snapErrs.length) return p.concat(snapErrs.slice(0, 5));
  const ids = vals.snapshot.loads.map((l) => l.id); const seen = new Set();
  for (const id of ids) { if (seen.has(id)) p.push(`snapshot.loads: id ${JSON.stringify(id)} is repeated`); seen.add(id); }
  const okErr = (e, where) => {
    if (!isPlain(e)) { p.push(`${where}: error entry is not an object`); return; }
    for (const k of keys(e)) if (['raw', 'code', 'badInput'].indexOf(k) === -1) p.push(`${where}: unexpected key ${JSON.stringify(k)}`);
    if (typeof e.raw !== 'string') p.push(`${where}: raw must be a string`);
    if (A.ENUMS.parseCode.indexOf(e.code) === -1) p.push(`${where}: unknown code ${String(e.code)}`);
    if (own(e, 'badInput') && e.badInput !== true) p.push(`${where}: badInput must be true when present`);
  };
  if (!isPlain(vals.fieldErrors)) p.push('fieldErrors must be an object map');
  else for (const path of keys(vals.fieldErrors)) { if (FROZEN_A_LCV2.fieldPaths.indexOf(path) === -1) p.push(`fieldErrors: unknown field path ${JSON.stringify(path)}`); okErr(vals.fieldErrors[path], `fieldErrors[${path}]`); }
  if (!isPlain(vals.loadErrors)) p.push('loadErrors must be an object map');
  else for (const id of keys(vals.loadErrors)) {
    if (!seen.has(id)) p.push(`loadErrors: ${JSON.stringify(id)} is not a load in the saved snapshot`);
    const m = vals.loadErrors[id]; if (!isPlain(m)) { p.push(`loadErrors[${id}] must be an object map`); continue; }
    for (const sub of keys(m)) { if (FROZEN_A_LCV2.loadSubfields.indexOf(sub) === -1) p.push(`loadErrors[${id}]: unknown field ${JSON.stringify(sub)}`); okErr(m[sub], `loadErrors[${id}].${sub}`); }
  }
  return p;
}

// ── I2: separate representability, then candidate ──
/** Lift an A snapshot (3.2.1) to a V2 snapshot (3.3.0) on a copy: unconfirmed optional82, per-record basisId from the allocation map, unconfirmed premise facts. */
function liftSnapshot(aSnapshot, basisIdByLoadId) {
  const s = liftToV2Shape(copyJson(aSnapshot));
  s.loads = s.loads.map((l) => { const r = copyJson(l); r.basisId = basisIdByLoadId[l.id]; r.inclusion82 = null; r.ratingCoverage82 = null; return r; });
  return s;
}
function allocationProblems(loads, basisIdByLoadId) {
  const p = [];
  if (!isPlain(basisIdByLoadId)) return ['basisIdByLoadId: object map {loadId: basisId} required'];
  const ids = loads.map((l) => l.id); const given = keys(basisIdByLoadId); const used = new Set();
  for (const id of ids) {
    if (!own(basisIdByLoadId, id)) { p.push(`basisIdByLoadId: missing basis id for record ${JSON.stringify(id)}`); continue; }
    const b = basisIdByLoadId[id];
    if (typeof b !== 'string' || !b.length) p.push(`basisIdByLoadId[${id}]: non-empty string required`);
    else if (used.has(b)) p.push(`basisIdByLoadId[${id}]: duplicate basis id ${JSON.stringify(b)}`); else used.add(b);
  }
  for (const id of given) if (ids.indexOf(id) === -1) p.push(`basisIdByLoadId: extra entry ${JSON.stringify(id)} names no source record`);
  return p;
}
/** Old-valid fieldErrors whose OLD path cannot be attributed to a record in the V3 maps. */
function representabilityProblems(fieldErrors) {
  const p = [];
  for (const path of keys(fieldErrors)) {
    if (V2.SCALAR_PATHS.has(path)) continue;
    if (path === 'loads[].rating.value' || path === 'loads[].quantity') p.push(`fieldErrors[${JSON.stringify(path)}]: old per-field key carries no load id/index; it cannot be attributed in the V3 loadErrors map without inventing a record — conversion refused, nothing modified`);
    else p.push(`fieldErrors[${JSON.stringify(path)}]: not representable as a canonical V2 path — conversion refused`);
  }
  return p;
}
function draftFromLift(snapshot, fieldErrors, loadErrors, importedFrom, sourceFavId) {
  return { snapshot, context: { importedFrom: Object.assign({}, importedFrom), methodConfirmedAfterImport: false }, fieldErrors: copyMap(fieldErrors, 1), loadErrors: copyMap(loadErrors, 2), sourceFavId };
}
/**
 * Upgrade a legacy or lcv-2 record to a NEW V2 draft candidate (the source object is never modified).
 * opts = { expectKind?: 'legacy'|'lcv2', legacyContract: {fieldPaths, loadSubfields, profileId}, basisIdByLoadId: {[id]: basisId}, sourceFavId: null|number|string }
 * Order: assertion of the frozen descriptor → classification of the OWN lcv key → old-format validity → allocation
 * → lossless representability → candidate construction → candidate validation → { ok:true, draft, notes }.
 */
function upgradeToDraftV2(vals, opts) {
  if (!isPlain(opts)) return fail(['opts: object required']);
  for (const k of keys(opts)) if (['expectKind', 'legacyContract', 'basisIdByLoadId', 'sourceFavId'].indexOf(k) === -1) return fail([`opts: unexpected key ${JSON.stringify(k)}`]);
  const lcProblems = assertLegacyContract(opts.legacyContract); if (lcProblems.length) return fail(lcProblems);
  if (!own(opts, 'sourceFavId') || !sourceFavIdOk(opts.sourceFavId)) return fail(['opts.sourceFavId: null, finite number or string required']);
  if (!isPlain(vals)) return fail(['source record is not an object']);
  const rep = A.jsonRepresentabilityErrors(vals, 'source'); if (rep.length) return fail(rep.slice(0, 8));
  const kind = classifyStoredRecord(vals);
  if (own(opts, 'expectKind') && opts.expectKind !== undefined) {
    if (opts.expectKind !== 'legacy' && opts.expectKind !== 'lcv2') return fail([`opts.expectKind: ${String(opts.expectKind)} is not legacy|lcv2`]);
    if (opts.expectKind !== kind) return fail([`expectKind ${opts.expectKind} but the record is ${kind} (its own lcv key decides; no weaker validator is selected)`]);
  }
  if (kind === 'lcv3') return fail(['record is already lcv-3: use restorePayloadV3, not an upgrade']);
  if (kind === 'unknown') return fail([`unsupported stored version ${own(vals, 'lcv') ? String(vals.lcv) : '(non-object)'}: refused`]);
  const notes = [];
  let aSnapshot; let fieldErrors; let loadErrors; let importedFrom; let sourceFavId;
  if (kind === 'lcv2') {
    const old = validateLcv2(vals); if (old.length) return fail(old.map((m) => 'lcv-2: ' + m));
    aSnapshot = vals.snapshot; fieldErrors = vals.fieldErrors; loadErrors = vals.loadErrors; importedFrom = LCV2_PROVENANCE; sourceFavId = vals.sourceFavId;
    notes.push('lcv-2 record validated under the frozen A descriptor; sourceFavId copied from the old payload');
  } else {
    let migrated;
    try { migrated = AS.migrateLegacyRecord(vals); }
    catch (e) { return fail([e && e.name === 'LegacyRecordError' ? `legacy: migration refused (${e.code})` : `legacy: ${e && e.message ? e.message : 'migration failed'}`]); }
    const snapErrs = A.validateSnapshot(migrated.snapshot); if (snapErrs.length) return fail(snapErrs.map((m) => 'legacy: migrated snapshot: ' + m));
    aSnapshot = migrated.snapshot; fieldErrors = dict(); loadErrors = dict(); importedFrom = LEGACY_PROVENANCE; sourceFavId = opts.sourceFavId;
    notes.push(`legacy record migrated (${migrated.snapshot.migration.unresolvedItems.length} unresolved item(s) retained; ${migrated.problems.length} migration problem(s) reported by the accepted migrator)`);
  }
  if (!isPlain(aSnapshot) || !Array.isArray(aSnapshot.loads)) return fail(['source snapshot: object with loads[] required']);
  const alloc = allocationProblems(aSnapshot.loads, opts.basisIdByLoadId); if (alloc.length) return fail(alloc);
  const repr = representabilityProblems(fieldErrors); if (repr.length) return fail(repr);
  const draft = draftFromLift(liftSnapshot(aSnapshot, opts.basisIdByLoadId), fieldErrors, loadErrors, importedFrom, sourceFavId);
  const check = toPayloadV3(draft); if (!check.ok) return fail(check.problems.map((m) => 'candidate: ' + m));
  if (aSnapshot.method.selected === 'opt_220_82') notes.push('source already selects opt_220_82: import does not confirm the method; methodConfirmedAfterImport stays false until an explicit manual reselection');
  return { ok: true, draft, notes };
}

module.exports = { toPayloadV3, validatePayloadV3, restorePayloadV3, classifyStoredRecord, upgradeToDraftV2, FROZEN_A_LCV2, LEGACY_PROVENANCE, LCV2_PROVENANCE, LCV3, PAYLOAD_KEYS, assertLegacyContract, validateLcv2 };
