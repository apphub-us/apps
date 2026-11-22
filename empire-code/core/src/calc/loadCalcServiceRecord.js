'use strict';
/**
 * LC-SERVICE-RESULT-STORE-1 — a historical result, separate from presets and live state.
 *
 * Creation verifies the captured tuple with the accepted public APIs, then preserves the
 * ORIGINAL captured outputs. Reading is structural only: it never evaluates a calculator,
 * substitutes current sources, restores a draft or grants an approval.
 *
 * No DOM, storage, clock, randomness, network or caller mutation. The producer pins identify
 * source bytes; they are not signatures or a claim that a stored record is authentic.
 */
const Input = require('./loadCalcInput.js');
const State = require('./loadCalcStateV2.js');
const Storage = require('./loadCalcStorageV2.js');
const Facade = require('./loadCalcFacade.js');
const Sizing = require('./loadCalcServiceSizing.js');

const KIND = 'empire-code.service-result';
const RECORD_VERSION = 1;
/**
 * What NEW records are stamped with. It describes the producer of a record at the moment it is created and is
 * never a condition for reading one: storedChecks() accepts any well-formed historical revision and pins, and
 * no saved record is rewritten to these values.
 *
 * EC-AUDIT-FIX-1: the nine CALCULATION_SOURCE_FILES changed for the preliminary-qualification work, so
 * applicationRevision and calculationSourcePin name the current sources. The pin is
 * SHA-256(JSON.stringify([[relative path, file SHA-256], ...])) over CALCULATION_SOURCE_FILES in their listed
 * (sorted) order, compact JSON. Records created before this revision keep the producer they were saved with
 * (applicationRevision 'LC-SERVICE-RESULT-STORE-1', calculationSourcePin 40a7de48…9ebe) and stay readable.
 * sourceBaselinePin is the historical baseline the record contract was accepted against and is unchanged, as
 * are recordContractRevision and the record shape.
 */
const PRODUCER = Object.freeze({
  applicationRevision: 'EC-AUDIT-FIX-1',
  sourceBaselinePin: 'd168fa3b6be018ec2560a3cfbd3a5347b17d6d802926a1b5b4f85b2fbe3b6ab7',
  calculationSourcePin: 'ca231858042fcca62f871495bf281f3262e61ad5d86be755a6ea0795c7171699',
  recordContractRevision: 1,
});
const CALCULATION_SOURCE_FILES = Object.freeze([
  'src/calc/loadCalc.js', 'src/calc/loadCalcFacade.js', 'src/calc/loadCalcInput.js',
  'src/calc/loadCalcInputV2.js', 'src/calc/loadCalcOpt82.js', 'src/calc/loadCalcServiceSizing.js',
  'src/calc/loadCalcState.js', 'src/calc/loadCalcStateV2.js', 'src/calc/loadCalcStorageV2.js',
]);
// Bounds are explicit refusals, never truncation. Text length is measured in JS UTF-16 code units.
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_NODES = 100000;
const MAX_DEPTH = 64;
const MAX_NAME = 200;
const MAX_PROBLEMS = 24;
const ID_RE = /^sr1_[0-9a-f]{32}$/;
const PIN_RE = /^[0-9a-f]{64}$/;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0);
const fail = (problems) => ({ ok: false, problems: problems.slice(0, MAX_PROBLEMS) });
const safeError = (e) => e && typeof e.message === 'string' ? e.message : 'operation refused';
const copy = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(copy);
  const out = {};
  for (const k of Object.keys(v)) Object.defineProperty(out, k, { value: copy(v[k]), enumerable: true, configurable: true, writable: true });
  return out;
};
function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  const ak = Object.keys(a).sort(); const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && same(a[k], b[k]));
}

/** Reject every value/key that JSON would lose or transform, before copying or invoking a getter. */
function losslessProblems(value, where) {
  const p = []; const stack = new Set(); let nodes = 0; let chars = 0;
  const add = (s) => { if (p.length < MAX_PROBLEMS) p.push(s); };
  const visit = (v, at, depth) => {
    if (p.length >= MAX_PROBLEMS) return;
    if (++nodes > MAX_NODES) { add(at + ': record exceeds node limit'); return; }
    if (depth > MAX_DEPTH) { add(at + ': nesting exceeds ' + MAX_DEPTH); return; }
    const t = typeof v;
    if (v === null || t === 'boolean') return;
    if (t === 'string') { chars += v.length; if (chars > MAX_TEXT) add(at + ': text exceeds record limit'); return; }
    if (t === 'number') { if (!finite(v)) add(at + ': non-finite number or negative zero cannot be stored losslessly'); return; }
    if (t !== 'object') { add(at + ': ' + t + ' cannot be stored as JSON'); return; }
    if (stack.has(v)) { add(at + ': reference cycle cannot be stored'); return; }
    if (Array.isArray(v) ? Object.getPrototypeOf(v) !== Array.prototype : !plain(v)) {
      add(at + ': custom/non-plain object or array cannot be stored'); return;
    }
    stack.add(v);
    const ks = Reflect.ownKeys(v);
    if (ks.length > MAX_NODES) { add(at + ': too many properties'); stack.delete(v); return; }
    for (const k of ks) {
      if (typeof k !== 'string') { add(at + ': symbol key cannot be stored'); continue; }
      if (Array.isArray(v) && k === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (!d || !own(d, 'value')) { add(at + '.' + k + ': accessor cannot be stored'); continue; }
      if (!d.enumerable) { add(at + '.' + k + ': non-enumerable property would be lost'); continue; }
      if (Array.isArray(v) && (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= v.length)) {
        add(at + '.' + k + ': extra array property would be lost'); continue;
      }
      chars += k.length;
      visit(d.value, at + (Array.isArray(v) ? '[' + k + ']' : '.' + k), depth + 1);
    }
    if (Array.isArray(v)) {
      if (v.length > MAX_NODES) add(at + ': array exceeds record limit');
      else for (let i = 0; i < v.length; i++) if (!own(v, String(i))) add(at + '[' + i + ']: array hole would be lost');
    }
    stack.delete(v);
  };
  visit(value, where || 'record', 0);
  if (!p.length && JSON.stringify(value).length > MAX_TEXT) add((where || 'record') + ': serialized text exceeds ' + MAX_TEXT + ' characters');
  return p;
}

function canonicalUtc(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(m[4]) <= 23 && Number(m[5]) <= 59 && Number(m[6]) <= 59;
}

/** Small, version-owned STRUCTURAL checks; no electrical arithmetic or qualification rules. */
function checker() {
  const problems = [];
  const add = (s) => { if (problems.length < MAX_PROBLEMS) problems.push(s); };
  const object = (v, at, required, optional) => {
    if (!plain(v)) { add(at + ': plain object required'); return false; }
    for (const k of required || []) if (!own(v, k)) add(at + ': missing ' + k);
    if (required) {
      const allowed = required.concat(optional || []);
      for (const k of Object.keys(v)) if (!allowed.includes(k)) add(at + ': unexpected key ' + JSON.stringify(k));
    }
    return true;
  };
  const str = (v, at, nullable, nonempty) => {
    if (nullable && v === null) return;
    if (typeof v !== 'string' || (nonempty && !v.length)) add(at + ': ' + (nullable ? 'string or null' : 'string') + ' required');
  };
  const num = (v, at, nullable, integer) => {
    if (nullable && v === null) return;
    if (!finite(v) || (integer && !Number.isSafeInteger(v))) add(at + ': finite ' + (integer ? 'safe integer' : 'number') + (nullable ? ' or null' : '') + ' required');
  };
  const bool = (v, at, nullable) => { if (!(typeof v === 'boolean' || nullable && v === null)) add(at + ': boolean' + (nullable ? ' or null' : '') + ' required'); };
  const exact = (v, expected, at) => { if (v !== expected) add(at + ': expected ' + JSON.stringify(expected)); };
  const eq = (a, b, at) => { if (!same(a, b)) add(at + ': inconsistent with the saved basis'); };
  const one = (v, options, at) => { if (!options.includes(v)) add(at + ': unsupported value ' + JSON.stringify(v)); };
  const array = (v, at, fn) => {
    if (!Array.isArray(v)) { add(at + ': array required'); return false; }
    if (fn) v.forEach((x, i) => fn(x, at + '[' + i + ']'));
    return true;
  };
  const strings = (v, at) => array(v, at, (x, a) => str(x, a, false, true));
  return { problems, add, object, str, num, bool, exact, eq, one, array, strings };
}

function metadataChecks(v, c, at) {
  if (!c.object(v, at, ['id', 'name', 'createdAt'])) return;
  if (typeof v.id !== 'string' || !ID_RE.test(v.id)) c.add(at + '.id: sr1_ followed by 32 lowercase hexadecimal digits required');
  if (typeof v.name !== 'string' || !v.name.trim().length || v.name.length > MAX_NAME) c.add(at + '.name: nonblank string of 1-' + MAX_NAME + ' characters required');
  if (!canonicalUtc(v.createdAt)) c.add(at + '.createdAt: valid UTC YYYY-MM-DDTHH:mm:ss.sssZ required');
}
function quantity(v, c, at, exactRequired) {
  if (!c.object(v, at, exactRequired ? ['value', 'unit', 'exactE4'] : ['value', 'unit'], exactRequired ? [] : ['exactE4'])) return;
  c.num(v.value, at + '.value'); c.str(v.unit, at + '.unit', false, true);
  if (own(v, 'exactE4')) c.num(v.exactE4, at + '.exactE4', false, true);
}
function designChecks(d, c) {
  const at = 'record.serviceSizing.design';
  if (!c.object(d, at, ['selectedMainRatingA', 'plan', 'conductor'])) return;
  const rawNumber = (v, a) => { if (!(v === null || typeof v === 'string' || finite(v))) c.add(a + ': number, raw numeric text or null required'); };
  rawNumber(d.selectedMainRatingA, at + '.selectedMainRatingA');
  if (c.object(d.plan, at + '.plan', ['intent', 'oneMainDisconnect', 'noAdditionalSources', 'wholeDwelling', 'singleConductorSet'])) {
    c.str(d.plan.intent, at + '.plan.intent', true);
    ['oneMainDisconnect', 'noAdditionalSources', 'wholeDwelling', 'singleConductorSet'].forEach((k) => c.bool(d.plan[k], at + '.plan.' + k, true));
  }
  const keys = ['sizingPath', 'material', 'terminationTempRatingC', 'terminationMaterialCompatible', 'insulationTempRatingC', 'ambientTempC', 'currentCarryingConductors', 'wiringMethod', 'noOtherAdjustmentOrCorrection'];
  if (c.object(d.conductor, at + '.conductor', keys)) {
    ['sizingPath', 'material', 'wiringMethod'].forEach((k) => c.str(d.conductor[k], at + '.conductor.' + k, true));
    ['terminationTempRatingC', 'insulationTempRatingC', 'ambientTempC', 'currentCarryingConductors'].forEach((k) => rawNumber(d.conductor[k], at + '.conductor.' + k));
    ['terminationMaterialCompatible', 'noOtherAdjustmentOrCorrection'].forEach((k) => c.bool(d.conductor[k], at + '.conductor.' + k, true));
  }
}

function responseChecks(response, request, c) {
  const at = 'record.calculation.response';
  if (!c.object(response, at, ['facade', 'result'])) return;
  const f = response.facade; const r = response.result;
  if (c.object(f, at + '.facade', ['apiVersion', 'capabilityProfile', 'engine', 'engineProfileId', 'engineRuleStatus', 'importGuard'])) {
    c.exact(f.apiVersion, 2, at + '.facade.apiVersion'); c.exact(f.capabilityProfile, 'AB82_core1', at + '.facade.capabilityProfile');
    c.exact(f.engine, 'B82', at + '.facade.engine'); c.exact(f.engineProfileId, 'B82_core1', at + '.facade.engineProfileId');
    c.one(f.importGuard, ['not_applicable', 'confirmed', 'unconfirmed'], at + '.facade.importGuard');
    if (c.object(f.engineRuleStatus, at + '.facade.engineRuleStatus')) for (const k of Object.keys(f.engineRuleStatus)) c.str(f.engineRuleStatus[k], at + '.facade.engineRuleStatus.' + k, false, true);
  }
  if (!c.object(r, at + '.result', ['schemaVersion', 'ruleBasis', 'profileId', 'status', 'problems', 'loadsCoverage', 'demand', 'current', 'existingCapacity', 'requiredCapacity', 'rating', 'diagnostics', 'display', 'presentation', 'references'])) return;
  const a = at + '.result';
  c.exact(r.schemaVersion, '3.3.0', a + '.schemaVersion'); c.exact(r.profileId, 'B82_core1', a + '.profileId');
  // v1 captures only the existing service-panel flow, whose gate requires complete load and current.
  c.exact(r.status, 'COMPLETE', a + '.status');
  if (c.object(r.ruleBasis, a + '.ruleBasis', ['code', 'base', 'amendments'])) Object.keys(r.ruleBasis).forEach((k) => c.str(r.ruleBasis[k], a + '.ruleBasis.' + k, false, true));
  c.array(r.problems, a + '.problems', (p, pa) => {
    if (!c.object(p, pa, ['code', 'field', 'layer', 'source', 'ruleRef', 'message'])) return;
    ['code', 'field', 'layer', 'source', 'message'].forEach((k) => c.str(p[k], pa + '.' + k, false, true)); c.str(p.ruleRef, pa + '.ruleRef', true);
  });
  c.array(r.loadsCoverage, a + '.loadsCoverage', (p, pa) => {
    if (!c.object(p, pa, ['loadId', 'coverage', 'ruleRef', 'reason', 'viaAggregate', 'candidate', 'governing', 'connectedVA', 'demandVA', 'demandFactorScope'])) return;
    ['loadId', 'coverage'].forEach((k) => c.str(p[k], pa + '.' + k, false, true));
    ['ruleRef', 'reason', 'candidate', 'demandFactorScope'].forEach((k) => c.str(p[k], pa + '.' + k, true));
    c.bool(p.viaAggregate, pa + '.viaAggregate'); c.bool(p.governing, pa + '.governing', true);
    ['connectedVA', 'demandVA'].forEach((k) => c.num(p[k], pa + '.' + k, true));
  });
  if (c.object(r.demand, a + '.demand', ['status', 'unit', 'totalVA', 'totalExactE4', 'totalOnConductorA', 'partialSubtotalVA', 'lines'])) {
    const d = r.demand; c.exact(d.status, 'complete', a + '.demand.status'); c.exact(d.unit, 'VA', a + '.demand.unit');
    c.num(d.totalVA, a + '.demand.totalVA'); c.num(d.totalExactE4, a + '.demand.totalExactE4', false, true);
    c.exact(d.totalOnConductorA, null, a + '.demand.totalOnConductorA'); c.exact(d.partialSubtotalVA, null, a + '.demand.partialSubtotalVA');
    c.array(d.lines, a + '.demand.lines', (l, la) => {
      const ks = ['id', 'label', 'op', 'operands', 'factor', 'unitFactor', 'percent', 'threshold', 'selected', 'controlUnitsRef', 'divisorV', 'powerFactor', 'conductor', 'bindings', 'result', 'ruleRef', 'amended', 'ruleStatus', 'loadIds'];
      if (!c.object(l, la, ks)) return;
      ['id', 'label', 'op', 'ruleRef', 'ruleStatus'].forEach((k) => c.str(l[k], la + '.' + k, false, true));
      ['selected', 'controlUnitsRef', 'conductor'].forEach((k) => c.str(l[k], la + '.' + k, true));
      ['factor', 'percent', 'divisorV', 'powerFactor'].forEach((k) => c.num(l[k], la + '.' + k, true));
      c.bool(l.amended, la + '.amended'); c.strings(l.loadIds, la + '.loadIds');
      if (l.unitFactor !== null) quantity(l.unitFactor, c, la + '.unitFactor', false);
      if (l.threshold !== null) quantity(l.threshold, c, la + '.threshold', true);
      quantity(l.result, c, la + '.result', true);
      c.array(l.operands, la + '.operands', (o, oa) => { if (c.object(o, oa, ['ref', 'quantity', 'loadId'])) { c.str(o.ref, oa + '.ref', true); c.str(o.loadId, oa + '.loadId', true); quantity(o.quantity, c, oa + '.quantity', false); } });
      c.array(l.bindings, la + '.bindings', (b, ba) => {
        if (!c.object(b, ba, ['kind', 'path', 'loadId', 'ratingValue', 'quantity', 'value'])) return;
        ['kind', 'path'].forEach((k) => c.str(b[k], ba + '.' + k, false, true)); c.str(b.loadId, ba + '.loadId', true);
        ['ratingValue', 'quantity', 'value'].forEach((k) => c.num(b[k], ba + '.' + k, true));
      });
    });
  }
  if (c.object(r.current, a + '.current', ['status', 'model', 'formula', 'assumptions', 'perConductorA', 'lineA', 'neutralA', 'note'])) {
    const x = r.current; c.exact(x.status, 'computed', a + '.current.status');
    ['model', 'formula', 'note'].forEach((k) => c.str(x[k], a + '.current.' + k, false, true));
    c.strings(x.assumptions, a + '.current.assumptions'); c.num(x.lineA, a + '.current.lineA'); c.exact(x.neutralA, null, a + '.current.neutralA');
    if (c.object(x.perConductorA, a + '.current.perConductorA', ['L1', 'L2', 'L3'])) ['L1', 'L2', 'L3'].forEach((k) => c.num(x.perConductorA[k], a + '.current.perConductorA.' + k, true));
  }
  if (c.object(r.existingCapacity, a + '.existingCapacity', ['status', 'comparisonKind', 'policy', 'ruleRef', 'blockingCode', 'comparisons', 'boundOutcome'])) {
    const x = r.existingCapacity; c.exact(x.status, 'not_assessed', a + '.existingCapacity.status');
    ['comparisonKind', 'policy', 'ruleRef', 'boundOutcome'].forEach((k) => c.exact(x[k], null, a + '.existingCapacity.' + k));
    c.str(x.blockingCode, a + '.existingCapacity.blockingCode', true);
    if (c.array(x.comparisons, a + '.existingCapacity.comparisons') && x.comparisons.length) c.add(a + '.existingCapacity.comparisons: v1 contains no existing-service comparison');
  }
  ['requiredCapacity', 'rating'].forEach((k) => { if (c.object(r[k], a + '.' + k, ['status', 'note'])) { c.exact(r[k].status, 'not_assessed', a + '.' + k + '.status'); c.str(r[k].note, a + '.' + k + '.note', false, true); } });
  if (c.object(r.diagnostics, a + '.diagnostics', ['operative', 'generalConnectedVA', 'generalDemandVA', 'hvacGoverningLine', 'hvacCandidatesVA'])) {
    const x = r.diagnostics; c.exact(x.operative, false, a + '.diagnostics.operative');
    ['generalConnectedVA', 'generalDemandVA'].forEach((k) => c.num(x[k], a + '.diagnostics.' + k, true));
    c.str(x.hvacGoverningLine, a + '.diagnostics.hvacGoverningLine', true);
    if (c.object(x.hvacCandidatesVA, a + '.diagnostics.hvacCandidatesVA')) Object.keys(x.hvacCandidatesVA).forEach((k) => c.num(x.hvacCandidatesVA[k], a + '.diagnostics.hvacCandidatesVA.' + k));
  }
  if (c.object(r.display, a + '.display', ['precision', 'rounding', 'strings', 'feedsComparison'])) {
    const x = r.display; c.exact(x.feedsComparison, false, a + '.display.feedsComparison'); c.str(x.rounding, a + '.display.rounding', false, true);
    if (c.object(x.precision, a + '.display.precision', ['amps', 'va'])) ['amps', 'va'].forEach((k) => { c.num(x.precision[k], a + '.display.precision.' + k, false, true); if (x.precision[k] < 0 || x.precision[k] > 20) c.add(a + '.display.precision.' + k + ': unsupported precision'); });
    if (c.object(x.strings, a + '.display.strings')) { Object.keys(x.strings).forEach((k) => c.str(x.strings[k], a + '.display.strings.' + k)); ['totalVA', 'lineA'].forEach((k) => c.str(x.strings[k], a + '.display.strings.' + k, false, true)); }
  }
  if (c.object(r.presentation, a + '.presentation', ['topologyLabel', 'showPerConductor', 'polesLabel', 'finalResultHeading', 'verdictLabel'])) {
    const x = r.presentation; c.str(x.topologyLabel, a + '.presentation.topologyLabel'); c.bool(x.showPerConductor, a + '.presentation.showPerConductor'); c.str(x.polesLabel, a + '.presentation.polesLabel', true); c.bool(x.finalResultHeading, a + '.presentation.finalResultHeading'); c.str(x.verdictLabel, a + '.presentation.verdictLabel', true);
  }
  c.array(r.references, a + '.references', (x, xa) => { if (c.object(x, xa, ['ruleRef', 'amended', 'href'])) { c.str(x.ruleRef, xa + '.ruleRef', false, true); c.bool(x.amended, xa + '.amended'); c.str(x.href, xa + '.href', true); } });
  if (request && request.snapshot && plain(request.context)) {
    c.eq(r.ruleBasis, request.snapshot.ruleBasis, a + '.ruleBasis');
    if (plain(f)) c.exact(f.importGuard, request.context.importedFrom === null ? 'not_applicable' : request.context.methodConfirmedAfterImport === true ? 'confirmed' : 'unconfirmed', at + '.facade.importGuard');
  }
}

function reasonChecks(r, c, at) {
  if (!c.object(r, at, ['stage', 'code', 'field', 'sourceIds', 'sections', 'message'])) return;
  ['stage', 'code', 'message'].forEach((k) => c.str(r[k], at + '.' + k, false, true));
  c.str(r.field, at + '.field', true); c.strings(r.sourceIds, at + '.sourceIds'); c.strings(r.sections, at + '.sections');
}
function evidenceChecks(e, c, at) {
  if (!c.object(e, at, ['primaryText', 'sourceIds', 'interpretation', 'installationApproval'], ['facts', 'productScope'])) return;
  ['primaryText', 'interpretation'].forEach((k) => c.str(e[k], at + '.' + k, false, true));
  c.strings(e.sourceIds, at + '.sourceIds'); c.exact(e.installationApproval, 'not_approved', at + '.installationApproval');
  if (own(e, 'facts')) c.strings(e.facts, at + '.facts');
  if (own(e, 'productScope')) c.str(e.productScope, at + '.productScope', false, true);
}
function sourcesChecks(sources, c) {
  const at = 'record.serviceSizing.sources';
  if (!c.object(sources, at)) return;
  if (!Object.keys(sources).length || Object.keys(sources).length > 128) c.add(at + ': 1-128 source definitions required');
  for (const k of Object.keys(sources)) {
    const s = sources[k]; const sa = at + '.' + k;
    if (!k.length || k.length > 100) c.add(sa + ': source id length unsupported');
    if (!c.object(s, sa, ['kind', 'role'], ['image', 'fileId', 'sha256', 'clauses', 'provenance', 'title', 'url'])) continue;
    ['kind', 'role'].forEach((f) => c.str(s[f], sa + '.' + f, false, true));
    ['image', 'fileId', 'provenance', 'title'].forEach((f) => { if (own(s, f)) c.str(s[f], sa + '.' + f, false, true); });
    if (own(s, 'url')) c.str(s.url, sa + '.url', true);
    if (own(s, 'clauses')) c.strings(s.clauses, sa + '.clauses');
    if (own(s, 'sha256') && (typeof s.sha256 !== 'string' || !PIN_RE.test(s.sha256))) c.add(sa + '.sha256: SHA-256 text required');
    if (!own(s, 'title') && !own(s, 'image')) c.add(sa + ': source title or image identifier required');
    if (s.kind === 'nec2020_primary_excerpt') ['image', 'fileId', 'sha256', 'clauses', 'provenance'].forEach((f) => { if (!own(s, f)) c.add(sa + ': missing ' + f); });
  }
}
function sourceLinks(v, sources, c, at) {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.forEach((x, i) => sourceLinks(x, sources, c, at + '[' + i + ']')); return; }
  for (const k of Object.keys(v)) {
    if (k === 'sourceIds' && Array.isArray(v[k])) {
      for (const id of v[k]) if (typeof id === 'string' && !own(sources, id)) c.add(at + '.sourceIds: missing saved source ' + id);
    } else sourceLinks(v[k], sources, c, at + '.' + k);
  }
}
function analysisChecks(a, request, response, design, c) {
  const at = 'record.serviceSizing.analysis';
  if (!c.object(a, at, ['prototypeId', 'operative', 'ruleReview', 'installationApproved', 'globalCodeCompliance', 'sourceReview', 'status', 'calcBasis', 'qualificationEcho', 'minimumService', 'chosenMain', 'ungroundedConductors', 'designProblems', 'remainingChecks'])) return;
  c.str(a.prototypeId, at + '.prototypeId', false, true);
  c.exact(a.operative, false, at + '.operative'); c.exact(a.installationApproved, false, at + '.installationApproved'); c.exact(a.globalCodeCompliance, 'not_verified', at + '.globalCodeCompliance');
  c.str(a.ruleReview, at + '.ruleReview', false, true); c.one(a.status, ['EVALUATED', 'DESIGN_INVALID'], at + '.status');
  c.strings(a.remainingChecks, at + '.remainingChecks'); c.array(a.designProblems, at + '.designProblems', (r, ra) => reasonChecks(r, c, ra));
  if (c.object(a.sourceReview, at + '.sourceReview', ['status', 'primaryText', 'primaryTextComplete', 'interpretation', 'installationApproval', 'globalCodeCompliance', 'closed', 'stages', 'openInterpretation', 'warning'])) {
    const sr = a.sourceReview; const sa = at + '.sourceReview';
    ['status', 'primaryText', 'interpretation', 'warning'].forEach((k) => c.str(sr[k], sa + '.' + k, false, true));
    c.exact(sr.status, a.ruleReview, sa + '.status'); c.bool(sr.primaryTextComplete, sa + '.primaryTextComplete'); c.bool(sr.closed, sa + '.closed');
    c.exact(sr.installationApproval, 'not_approved', sa + '.installationApproval'); c.exact(sr.globalCodeCompliance, 'not_verified', sa + '.globalCodeCompliance'); c.strings(sr.openInterpretation, sa + '.openInterpretation');
    const stageKeys = ['minimumService', 'chosenMain', 'general_table_75C', 'dwelling_83pct_310_12', 'qualificationConsistency'];
    if (c.object(sr.stages, sa + '.stages', stageKeys)) stageKeys.forEach((k) => evidenceChecks(sr.stages[k], c, sa + '.stages.' + k));
  }
  if (c.object(a.calcBasis, at + '.calcBasis', ['engine', 'engineProfileId', 'importGuard', 'calcStatus', 'purpose', 'occupancy', 'topology', 'vLineToLine', 'method', 'totalVA', 'totalExactE4', 'totalVADisplay', 'currentStatus', 'lineA', 'lineADisplay', 'engineProblemCodes'])) {
    const b = a.calcBasis; const ba = at + '.calcBasis';
    ['engine', 'engineProfileId', 'importGuard', 'calcStatus', 'purpose', 'occupancy', 'topology', 'method', 'currentStatus'].forEach((k) => c.str(b[k], ba + '.' + k, false, true));
    ['vLineToLine', 'totalVA', 'lineA'].forEach((k) => c.num(b[k], ba + '.' + k)); c.num(b.totalExactE4, ba + '.totalExactE4', false, true);
    ['totalVADisplay', 'lineADisplay'].forEach((k) => c.str(b[k], ba + '.' + k, true)); c.strings(b.engineProblemCodes, ba + '.engineProblemCodes');
    if (plain(response) && plain(response.facade) && plain(response.result)) {
      const f = response.facade; const r = response.result;
      ['engine', 'engineProfileId', 'importGuard'].forEach((k) => c.eq(b[k], f[k], ba + '.' + k));
      c.eq(b.calcStatus, r.status, ba + '.calcStatus');
      if (plain(r.demand)) { c.eq(b.totalVA, r.demand.totalVA, ba + '.totalVA'); c.eq(b.totalExactE4, r.demand.totalExactE4, ba + '.totalExactE4'); }
      if (plain(r.current)) { c.eq(b.currentStatus, r.current.status, ba + '.currentStatus'); c.eq(b.lineA, r.current.lineA, ba + '.lineA'); }
      if (plain(r.display) && plain(r.display.strings)) { c.eq(b.totalVADisplay, r.display.strings.totalVA || null, ba + '.totalVADisplay'); c.eq(b.lineADisplay, r.display.strings.lineA || null, ba + '.lineADisplay'); }
      if (Array.isArray(r.problems)) c.eq(b.engineProblemCodes, r.problems.map((p) => p && p.code), ba + '.engineProblemCodes');
    }
    if (request && plain(request.snapshot)) {
      const s = request.snapshot;
      ['purpose', 'occupancy'].forEach((k) => c.eq(b[k], s[k], ba + '.' + k));
      if (plain(s.supply)) { c.eq(b.topology, s.supply.topology, ba + '.topology'); c.eq(b.vLineToLine, s.supply.vLineToLine, ba + '.vLineToLine'); }
      if (plain(s.method)) c.eq(b.method, s.method.selected, ba + '.method');
    }
  }
  const declared = request && request.snapshot && request.snapshot.optional82 && request.snapshot.optional82.conductorAmpacityA
    ? request.snapshot.optional82.conductorAmpacityA.value : undefined;
  if (c.object(a.qualificationEcho, at + '.qualificationEcho', ['conductorAmpacityA', 'role'])) {
    c.num(a.qualificationEcho.conductorAmpacityA, at + '.qualificationEcho.conductorAmpacityA', true); c.str(a.qualificationEcho.role, at + '.qualificationEcho.role', false, true);
    c.eq(a.qualificationEcho.conductorAmpacityA, declared, at + '.qualificationEcho.conductorAmpacityA');
  }
  const m = a.minimumService; const ma = at + '.minimumService';
  if (c.object(m, ma, ['status', 'ratingA', 'reasons'], ['meaning', 'floorA', 'ratingsSubset', 'sourceEvidence', 'comparison', 'governedBy', 'loadVA', 'loadExactE4', 'rawLoadA'])) {
    c.one(m.status, ['experimental_candidate', 'waiting_input', 'unsupported', 'not_computed'], ma + '.status'); c.num(m.ratingA, ma + '.ratingA', true); c.array(m.reasons, ma + '.reasons', (r, ra) => reasonChecks(r, c, ra));
    ['meaning', 'comparison'].forEach((k) => { if (a.status === 'EVALUATED' || own(m, k)) c.str(m[k], ma + '.' + k, false, true); });
    if (a.status === 'EVALUATED' || own(m, 'floorA')) c.num(m.floorA, ma + '.floorA');
    if (a.status === 'EVALUATED' || own(m, 'ratingsSubset')) c.array(m.ratingsSubset, ma + '.ratingsSubset', (v, va) => c.num(v, va));
    if (a.status === 'EVALUATED' || own(m, 'sourceEvidence')) evidenceChecks(m.sourceEvidence, c, ma + '.sourceEvidence');
    if (own(m, 'governedBy')) c.str(m.governedBy, ma + '.governedBy', false, true);
    if (m.status === 'experimental_candidate') {
      c.num(m.ratingA, ma + '.ratingA'); c.str(m.governedBy, ma + '.governedBy', false, true);
      ['loadVA', 'rawLoadA'].forEach((k) => c.num(m[k], ma + '.' + k)); c.num(m.loadExactE4, ma + '.loadExactE4', false, true);
      if (plain(a.calcBasis)) { c.eq(m.loadVA, a.calcBasis.totalVA, ma + '.loadVA'); c.eq(m.loadExactE4, a.calcBasis.totalExactE4, ma + '.loadExactE4'); c.eq(m.rawLoadA, a.calcBasis.lineA, ma + '.rawLoadA'); }
    } else {
      c.exact(m.ratingA, null, ma + '.ratingA');
      ['loadVA', 'loadExactE4', 'rawLoadA'].forEach((k) => { if (own(m, k)) c.exact(m[k], null, ma + '.' + k); });
    }
  }
  const ch = a.chosenMain; const ca = at + '.chosenMain';
  if (c.object(ch, ca, ['status', 'selectedRatingA', 'reasons'], ['minimumRatingA', 'sourceEvidence'])) {
    c.one(ch.status, ['not_evaluated', 'waiting_input', 'unsupported', 'rejected_undersized', 'meets_prototype_minimum'], ca + '.status');
    c.num(ch.selectedRatingA, ca + '.selectedRatingA', true); c.array(ch.reasons, ca + '.reasons', (r, ra) => reasonChecks(r, c, ra));
    if (own(ch, 'minimumRatingA')) c.num(ch.minimumRatingA, ca + '.minimumRatingA');
    if (a.status === 'EVALUATED' || own(ch, 'sourceEvidence')) evidenceChecks(ch.sourceEvidence, c, ca + '.sourceEvidence');
    if (a.status === 'EVALUATED' && plain(design)) c.eq(ch.selectedRatingA, design.selectedMainRatingA, ca + '.selectedRatingA');
    if (['rejected_undersized', 'meets_prototype_minimum'].includes(ch.status)) {
      c.num(ch.selectedRatingA, ca + '.selectedRatingA'); c.num(ch.minimumRatingA, ca + '.minimumRatingA'); if (plain(m)) c.eq(ch.minimumRatingA, m.ratingA, ca + '.minimumRatingA');
    }
  }
  const u = a.ungroundedConductors; const ua = at + '.ungroundedConductors';
  if (c.object(u, ua, ['status', 'appliesTo', 'method', 'notSized', 'recommendationAvailable', 'size', 'tableCandidate', 'qualificationConsistency', 'reasons'], ['sizedForRatingA', 'material', 'sizeUnit', 'ampacity75CA', 'sourceEvidence', 'conditions'])) {
    c.one(u.status, ['not_evaluated', 'waiting_input', 'unsupported', 'experimental_candidate', 'table_candidate_conditional'], ua + '.status'); c.str(u.appliesTo, ua + '.appliesTo', false, true); c.str(u.method, ua + '.method', true);
    c.strings(u.notSized, ua + '.notSized'); c.bool(u.recommendationAvailable, ua + '.recommendationAvailable'); c.str(u.size, ua + '.size', true); c.array(u.reasons, ua + '.reasons', (r, ra) => reasonChecks(r, c, ra));
    ['sizedForRatingA', 'ampacity75CA'].forEach((k) => { if (own(u, k)) c.num(u[k], ua + '.' + k, true); });
    ['material', 'sizeUnit'].forEach((k) => { if (own(u, k)) c.str(u[k], ua + '.' + k, true); });
    if (u.tableCandidate !== null) {
      const t = u.tableCandidate; const ta = ua + '.tableCandidate';
      if (c.object(t, ta, ['conditional', 'method', 'table', 'forRatingA', 'material', 'size', 'sizeUnit', 'ampacity75CA', 'eightyThreePercentCheck', 'sourceStatus', 'sourceIds'])) {
        c.exact(t.conditional, true, ta + '.conditional');
        ['method', 'table', 'material', 'size', 'sizeUnit', 'sourceStatus'].forEach((k) => c.str(t[k], ta + '.' + k, false, true));
        ['forRatingA', 'ampacity75CA'].forEach((k) => c.num(t[k], ta + '.' + k)); c.strings(t.sourceIds, ta + '.sourceIds');
        if (t.eightyThreePercentCheck !== null) {
          const e = t.eightyThreePercentCheck; const ea = ta + '.eightyThreePercentCheck';
          if (c.object(e, ea, ['selectedRatingA', 'thresholdE2', 'ampacity75CE2', 'satisfied'])) {
            ['selectedRatingA', 'thresholdE2', 'ampacity75CE2'].forEach((k) => c.num(e[k], ea + '.' + k)); c.bool(e.satisfied, ea + '.satisfied'); c.eq(e.selectedRatingA, t.forRatingA, ea + '.selectedRatingA');
          }
        }
        c.eq(u.sizedForRatingA, t.forRatingA, ua + '.sizedForRatingA'); c.eq(u.method, t.method, ua + '.method'); c.eq(u.material, t.material, ua + '.material');
        if (plain(ch)) c.eq(t.forRatingA, ch.selectedRatingA, ta + '.forRatingA');
      }
      evidenceChecks(u.sourceEvidence, c, ua + '.sourceEvidence');
      const co = u.conditions; const coa = ua + '.conditions';
      if (c.object(co, coa, ['terminations', 'insulation', 'ambientC', 'currentCarryingConductors', 'sets', 'wiringMethod', 'wiringMethodNote', 'rule'], ['interpretationNote'])) {
        ['terminations', 'insulation', 'wiringMethod', 'wiringMethodNote', 'rule'].forEach((k) => c.str(co[k], coa + '.' + k, false, true));
        ['ambientC', 'currentCarryingConductors', 'sets'].forEach((k) => c.num(co[k], coa + '.' + k));
        if (own(co, 'interpretationNote')) c.str(co.interpretationNote, coa + '.interpretationNote', false, true);
      }
    }
    const q = u.qualificationConsistency; const qa = ua + '.qualificationConsistency';
    if (q !== null && c.object(q, qa, ['status', 'declaredQualificationAmpacityA', 'candidateTableAmpacity75CA', 'b82SoftwareGateMinA', 'sourceEvidence', 'note', 'reasons'])) {
      c.one(q.status, ['premise_unchanged', 'revalidation_required', 'review_required'], qa + '.status');
      ['declaredQualificationAmpacityA', 'candidateTableAmpacity75CA', 'b82SoftwareGateMinA'].forEach((k) => c.num(q[k], qa + '.' + k, true));
      c.str(q.note, qa + '.note', false, true); c.array(q.reasons, qa + '.reasons', (r, ra) => reasonChecks(r, c, ra)); evidenceChecks(q.sourceEvidence, c, qa + '.sourceEvidence');
      c.eq(q.declaredQualificationAmpacityA, declared, qa + '.declaredQualificationAmpacityA');
      if (plain(u.tableCandidate)) c.eq(q.candidateTableAmpacity75CA, u.tableCandidate.ampacity75CA, qa + '.candidateTableAmpacity75CA');
    }
    if (u.tableCandidate === null) {
      // v1 table-output fields are absent when this stage has no table result; the renderer
      // must never receive unchecked truthy conditions/evidence on a not-evaluated stage.
      ['conditions', 'sourceEvidence', 'sizedForRatingA', 'material', 'sizeUnit', 'ampacity75CA'].forEach((k) => {
        if (own(u, k)) c.add(ua + '.' + k + ': v1 table-output field requires a saved table candidate');
      });
      c.exact(q, null, qa); c.exact(u.recommendationAvailable, false, ua + '.recommendationAvailable');
      if (['experimental_candidate', 'table_candidate_conditional'].includes(u.status)) c.add(ua + ': candidate status requires the saved table object');
    } else if (q === null) c.add(qa + ': a saved table candidate requires its original qualification diagnostic');
    if (u.recommendationAvailable === true) {
      c.exact(u.status, 'experimental_candidate', ua + '.status');
      if (!plain(q) || q.status !== 'premise_unchanged') c.add(ua + ': selection availability contradicts qualification status');
      if (plain(u.tableCandidate)) ['size', 'sizeUnit', 'ampacity75CA'].forEach((k) => c.eq(u[k], u.tableCandidate[k], ua + '.' + k));
    } else {
      c.exact(u.size, null, ua + '.size');
      ['sizeUnit', 'ampacity75CA'].forEach((k) => { if (own(u, k)) c.exact(u[k], null, ua + '.' + k); });
      if (u.status === 'experimental_candidate') c.add(ua + ': experimental candidate contradicts unavailable selection');
    }
  }
  if (a.status === 'DESIGN_INVALID') {
    if (!Array.isArray(a.designProblems) || !a.designProblems.length) c.add(at + '.designProblems: DESIGN_INVALID requires the saved diagnostics');
    if (plain(m)) c.exact(m.status, 'not_computed', ma + '.status');
    if (plain(ch)) { c.exact(ch.status, 'not_evaluated', ca + '.status'); c.exact(ch.selectedRatingA, null, ca + '.selectedRatingA'); }
    if (plain(u)) c.exact(u.status, 'not_evaluated', ua + '.status');
  } else if (Array.isArray(a.designProblems) && a.designProblems.length) c.add(at + '.designProblems: EVALUATED cannot carry structural design errors');
}

function storedChecks(record) {
  const pre = losslessProblems(record, 'record'); if (pre.length) return pre;
  const c = checker();
  if (!c.object(record, 'record', ['kind', 'recordVersion', 'id', 'name', 'createdAt', 'producer', 'calculation', 'serviceSizing'])) return c.problems;
  c.exact(record.kind, KIND, 'record.kind'); c.exact(record.recordVersion, RECORD_VERSION, 'record.recordVersion');
  metadataChecks({ id: record.id, name: record.name, createdAt: record.createdAt }, c, 'record metadata');
  const p = record.producer;
  if (c.object(p, 'record.producer', ['applicationRevision', 'sourceBaselinePin', 'calculationSourcePin', 'recordContractRevision'])) {
    c.str(p.applicationRevision, 'record.producer.applicationRevision', false, true);
    if (typeof p.applicationRevision === 'string' && p.applicationRevision.length > 160) c.add('record.producer.applicationRevision: maximum 160 characters');
    ['sourceBaselinePin', 'calculationSourcePin'].forEach((k) => { if (typeof p[k] !== 'string' || !PIN_RE.test(p[k])) c.add('record.producer.' + k + ': SHA-256 text required'); });
    c.exact(p.recordContractRevision, 1, 'record.producer.recordContractRevision');
    // Historical valid pins/revisions deliberately need not equal today's PRODUCER.
  }
  const calc = record.calculation; const svc = record.serviceSizing;
  let req = null;
  if (c.object(calc, 'record.calculation', ['draftPayload', 'request', 'response'])) {
    const restored = Storage.restorePayloadV3(calc.draftPayload);
    if (!restored.ok) restored.problems.forEach((s) => c.add('record.calculation.draftPayload: ' + s));
    else {
      const projected = State.toRequestV2(restored.draft);
      if (!projected.ok) projected.problems.forEach((s) => c.add('record.calculation.request: ' + s));
      else { c.eq(calc.request, projected.request, 'record.calculation.request'); req = projected.request; }
    }
    responseChecks(calc.response, req, c);
    if (req) {
      c.exact(req.snapshot.method.selected, 'opt_220_82', 'record.calculation.request.snapshot.method.selected');
      c.exact(req.snapshot.purpose, 'service', 'record.calculation.request.snapshot.purpose');
      c.exact(req.snapshot.occupancy, 'dwelling_unit_house', 'record.calculation.request.snapshot.occupancy');
      c.exact(req.snapshot.supply.topology, '1ph_3w_120_240', 'record.calculation.request.snapshot.supply.topology');
    }
  }
  if (c.object(svc, 'record.serviceSizing', ['designContractRevision', 'design', 'analysis', 'sources'])) {
    c.exact(svc.designContractRevision, 1, 'record.serviceSizing.designContractRevision'); designChecks(svc.design, c);
    sourcesChecks(svc.sources, c); analysisChecks(svc.analysis, req, plain(calc) ? calc.response : null, svc.design, c);
    if (plain(svc.sources)) sourceLinks(svc.analysis, svc.sources, c, 'record.serviceSizing.analysis');
  }
  return c.problems;
}
/** Supported historical shape, identities and safety flags only; no current engine comparison. */
function validateStoredRecord(record) {
  try { return storedChecks(record); }
  catch (e) { return ['record validation refused: ' + safeError(e)]; }
}
function readStoredRecord(record) {
  const p = validateStoredRecord(record);
  if (p.length) return fail(p);
  try { return { ok: true, record: copy(record) }; }
  catch (e) { return fail(['record copy refused: ' + safeError(e)]); }
}
/** A linear nesting bound protects the existing strict duplicate-key parser from excessive recursion. */
function textNestingProblem(text) {
  let depth = 0; let quoted = false; let escape = false;
  for (const ch of text) {
    if (quoted) { if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === '{' || ch === '[') { if (++depth > MAX_DEPTH) return 'record text nesting exceeds ' + MAX_DEPTH; }
    else if (ch === '}' || ch === ']') depth--;
  }
  return null;
}
function parseStoredRecord(text) {
  try {
    if (typeof text !== 'string') return fail(['record text: string required']);
    if (text.length > MAX_TEXT) return fail(['record text exceeds ' + MAX_TEXT + ' characters']);
    const depthProblem = textNestingProblem(text); if (depthProblem) return fail([depthProblem]);
    const parsed = Input.parseStrictJson(text);
    if (!parsed.ok) return fail(['record text: ' + parsed.reason]);
    return readStoredRecord(parsed.value);
  } catch (e) { return fail(['record parse refused: ' + safeError(e)]); }
}
/**
 * Creating is the sole operation that compares against today's accepted engines. It verifies
 * captured results; it does not replace them, publish them or perform a user Calculate/Assess.
 * Fresh UI Calculate/Assess and prompt-time checks remain the adapter's responsibility.
 */
function createRecord(capture, metadata) {
  try {
    const pre = losslessProblems({ capture, metadata }, 'capture'); if (pre.length) return fail(pre);
    const c = checker();
    if (!c.object(capture, 'capture', ['draft', 'request', 'response', 'design', 'analysis'])) return fail(c.problems);
    metadataChecks(metadata, c, 'metadata');
    if (c.problems.length) return fail(c.problems);
    const serialized = Storage.toPayloadV3(capture.draft);
    if (!serialized.ok) return fail(serialized.problems.map((p) => 'capture.draft: ' + p));
    const projected = State.toRequestV2(capture.draft);
    if (!projected.ok) return fail(projected.problems.map((p) => 'capture.request: ' + p));
    if (!same(capture.request, projected.request)) return fail(['capture.request does not match the saved draft projection']);
    const req = projected.request;
    if (req.snapshot.method.selected !== 'opt_220_82' || req.snapshot.purpose !== 'service'
      || req.snapshot.occupancy !== 'dwelling_unit_house' || req.snapshot.supply.topology !== '1ph_3w_120_240') {
      return fail(['capture is outside the v1 bounded 220.82 service-result flow']);
    }
    if (!plain(capture.response) || !plain(capture.response.result)
      || capture.response.result.status !== 'COMPLETE' || !plain(capture.response.result.current)
      || capture.response.result.current.status !== 'computed') return fail(['capture requires a complete calculated load and computed current']);
    if (!plain(capture.analysis) || !['EVALUATED', 'DESIGN_INVALID'].includes(capture.analysis.status)) return fail(['capture requires a performed EVALUATED or DESIGN_INVALID service assessment']);
    const response = Facade.evaluateV2(copy(req));
    if (!same(capture.response, response)) return fail(['captured calculation response does not match its request in the current calculation engine']);
    const analysis = Sizing.analyzePrototype(copy(req), copy(capture.design));
    if (!same(capture.analysis, analysis)) return fail(['captured service analysis does not match its request and design in the current calculation engine']);
    const record = {
      kind: KIND, recordVersion: RECORD_VERSION, id: metadata.id, name: metadata.name, createdAt: metadata.createdAt,
      producer: copy(PRODUCER),
      calculation: { draftPayload: serialized.payload, request: copy(capture.request), response: copy(capture.response) },
      serviceSizing: { designContractRevision: 1, design: copy(capture.design), analysis: copy(capture.analysis), sources: copy(Sizing.SOURCES) },
    };
    const problems = validateStoredRecord(record);
    return problems.length ? fail(problems) : { ok: true, record };
  } catch (e) { return fail(['record creation refused: ' + safeError(e)]); }
}

module.exports = {
  KIND, RECORD_VERSION, PRODUCER, CALCULATION_SOURCE_FILES,
  createRecord, validateStoredRecord, readStoredRecord, parseStoredRecord,
};
