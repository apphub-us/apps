'use strict';
/**
 * Load Calc — pure Profile A engine (EC-CALC-2 / B1). Contract v3.2.2, schema
 * "3.2.1". `evaluate(RequestEnvelope) -> LoadCalcResult`.
 *
 * Rule basis: NFPA 70-2020 as adopted by New York City with the NYC 2025
 * amendments (NYCEC 2025). The ONLY active computation is NEC 220.87 as
 * revised by NYC 2025 (S-02): existing maximum demand x 125 % plus a new-load
 * term that is either absent (`none`) or a user-established `precalculated`
 * value to which the tool applies NO factor. Every other method (220.82,
 * 220.83, 220.84, Standard Part III) keeps its data and returns a
 * deterministic UNSUPPORTED_SCOPE; nothing falls through to older arithmetic.
 *
 * Engine-owned constants (never inputs): the capability profile, the supply
 * topology table, the load-model table, the amperes-path combination table
 * (§7.4), rule statuses, comparison policy and display defaults.
 *
 * Numeric policy (§7.3): IEEE-754 doubles in the declared order, no
 * intermediate rounding, no code rounding, no epsilon. Display strings are
 * derived from the raw values and can never feed a comparison.
 *
 * This module is a pure function of its arguments: no DOM, storage, network,
 * clock or randomness; Node built-ins only. The input is never mutated and the
 * returned object shares no mutable data with it.
 */

const State = require('./loadCalcState');
const { validateEnvelope, LoadCalcEnvelopeError } = require('./loadCalcInput');

const { RULE_BASIS, SCHEMA_VERSION, TOPOLOGY_SUPPLY, codePointCompare, coversProjection, canonicalJson, clone } = State;

const SQRT3 = Math.sqrt(3);
const FACTOR_125 = 1.25;

/** §1.2 capability profile `A_measured_87_core` (engine-owned; echoed as profileId). */
const PROFILE = Object.freeze({
  id: 'A_measured_87_core',
  enabledMethods: Object.freeze(['measured_220_87']),
  enabledNewLoadModes: Object.freeze(['none', 'precalculated']),
  enabledModels: Object.freeze(['single_2w', 'split_240_all_LL', 'split_240_balanced_LN', 'split_240_declared_legs', 'network_208_all_LL', 'network_208_balanced_LN', 'three_phase_balanced']),
  comparisonPolicy: 'raw_conservative',
  codeRounding: null,
  upperBoundScreening: false,
  autoHandoff: false,
  autoRating: false,
  displayPrecision: Object.freeze({ amps: 1, va: 0 }),
});

const NOTE_NEUTRAL = 'Neutral not calculated (220.61 not implemented).';
const NOTE_REQUIRED_CAPACITY = 'No automatic Wire Sizer handoff in profile A (actual consumer takes amperes load/continuousLoad or continuousLoadA/noncontinuousLoadA); future adapter needs its own approved contract.';
const NOTE_RATING = 'Automatic rating not assessed in profile A; 600 A remains a proposed future product ceiling only, not a NEC limit.';
const RULE_87 = '220.87';
const RULE_87_1 = '220.87(1)';
const RULE_87_1_EXC = '220.87(1) Exception';
const RULE_87_2 = '220.87(2)';
const RULE_87_3 = '220.87(3)';
const RULE_84_A = '220.84(A)';

/** Disabled methods: RULE_PENDING label for the pending base-NEC text (§12). */
const PENDING_RULE_LABEL = Object.freeze({ opt_220_82: '220.82', existing_220_83: '220.83', standard_part_III: 'Part III', multifamily_220_84: '220.84' });

/** §8 presentation labels. */
const TOPOLOGY_LABEL = Object.freeze({
  '1ph_2w_120': '120 V, 1-ph, 2-wire', '1ph_2w_240': '240 V, 1-ph, 2-wire', '1ph_3w_120_240': '120/240 V, 1-ph, 3-wire', '1ph_3w_120_208_network': '120/208 V network, 1-ph, 3-wire',
  '3ph_4w_208Y_120': '208Y/120 V, 3-ph, 4-wire', '3ph_4w_480Y_277': '480Y/277 V, 3-ph, 4-wire', '3ph_3w_480_delta': '480 V delta, 3-ph, 3-wire',
  '3ph_3w_240_delta': '240 V delta, 3-ph, 3-wire', '3ph_4w_240_delta_highleg': '240 V delta (high leg), 3-ph, 4-wire',
});

/** §5 model applicability by topology (engine-owned). */
const MODEL_TOPOLOGIES = Object.freeze({
  single_2w: ['1ph_2w_120', '1ph_2w_240'],
  split_240_all_LL: ['1ph_3w_120_240'], split_240_balanced_LN: ['1ph_3w_120_240'], split_240_declared_legs: ['1ph_3w_120_240'],
  network_208_all_LL: ['1ph_3w_120_208_network'], network_208_balanced_LN: ['1ph_3w_120_208_network'],
  three_phase_balanced: ['3ph_4w_208Y_120', '3ph_4w_480Y_277', '3ph_3w_480_delta'],
});
const THREE_PHASE_SUPPORTED = Object.freeze(['3ph_4w_208Y_120', '3ph_4w_480Y_277', '3ph_3w_480_delta']);

const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/**
 * Read an optional own property as data: an absent key, an undefined value and
 * an explicit null all mean "not established" (B1-r1, R-B1-01). No default is
 * ever substituted (never 0, 12, 30, 15); the caller reports the missing field.
 */
const field = (o, k) => (own(o, k) && o[k] !== undefined ? o[k] : null);
const declaredValue = (decl) => (decl && typeof decl === 'object' && own(decl, 'value') && decl.value !== undefined ? decl.value : null);

/**
 * Ungrounded conductors of a supply topology (engine-owned, from the supply
 * table): the complete per-conductor reading set the amperes path needs.
 * 1-ph 2-wire 120 V has one (L1); 1-ph 2-wire 240 V and every 3-wire 1-ph
 * supply have two (L1, L2); every 3-ph supply has three. Unknown / `other`
 * topology -> null (no set can be required). A reading on a conductor the
 * topology does not have is LEG_INVALID; a missing required one is
 * MISSING_FIELD — never treated as zero, never dropped from the assessment.
 */
function requiredConductors(topology) {
  if (!own(TOPOLOGY_SUPPLY, topology)) return null;
  const [, vln, phases, wires] = TOPOLOGY_SUPPLY[topology];
  if (phases === 3) return ['L1', 'L2', 'L3'];
  if (wires === 3) return ['L1', 'L2'];
  return vln === null ? ['L1', 'L2'] : ['L1'];
}

// ── §8 display formatting (presentation only; never feeds a comparison) ────

/** Shortest round-trip decimal digits of a non-negative finite double as {digits, pointPos}. */
function plainDecimal(x) {
  let s = String(x);
  let sign = '';
  if (s[0] === '-') { sign = '-'; s = s.slice(1); }
  let mant = s; let exp = 0;
  const e = s.indexOf('e');
  if (e !== -1) { mant = s.slice(0, e); exp = parseInt(s.slice(e + 1), 10); }
  let intPart = mant; let frac = '';
  const dot = mant.indexOf('.');
  if (dot !== -1) { intPart = mant.slice(0, dot); frac = mant.slice(dot + 1); }
  let digits = intPart + frac; let pointPos = intPart.length + exp;
  if (pointPos < 0) { digits = '0'.repeat(-pointPos) + digits; pointPos = 0; }
  if (pointPos > digits.length) digits = digits + '0'.repeat(pointPos - digits.length);
  return { sign, digits, pointPos };
}

/**
 * Round half away from zero to `d` decimals on the shortest decimal
 * representation, then group thousands with ','. Equivalent to the checker's
 * Decimal(repr(x)).quantize(ROUND_HALF_UP) followed by `{:,.df}`.
 */
function formatNumber(x, d) {
  if (!isNum(x)) throw new TypeError('formatNumber: finite number required');
  const { sign, digits, pointPos } = plainDecimal(x);
  const keep = pointPos + d;
  let arr = digits.split('').map((c) => c.charCodeAt(0) - 48);
  let intDigits = arr.slice(0, keep);
  const roundUp = keep < arr.length && arr[keep] >= 5;
  while (intDigits.length < keep) intDigits.push(0);
  if (roundUp) {
    let k = intDigits.length - 1;
    while (k >= 0) { if (intDigits[k] === 9) { intDigits[k] = 0; k--; } else { intDigits[k] += 1; break; } }
    if (k < 0) intDigits.unshift(1);
  }
  let intLen = intDigits.length - d;
  let intStr = intDigits.slice(0, intLen).join('').replace(/^0+(?=\d)/, '');
  if (intStr === '') intStr = '0';
  const fracStr = intDigits.slice(intLen).join('');
  const grouped = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = d > 0 ? `${grouped}.${fracStr}` : grouped;
  const isZero = /^[0,.]*$/.test(out);
  return (sign && !isZero ? '-' : '') + out;
}

/** Python-style `%g` (6 significant digits) used only inside descriptive line labels. */
function fmtG(x) {
  if (x === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(x)));
  if (exp < -4 || exp >= 6) {
    const [m, e] = x.toExponential(5).split('e');
    const mant = m.replace(/\.?0+$/, '');
    const ev = parseInt(e, 10);
    return `${mant}e${ev < 0 ? '-' : '+'}${String(Math.abs(ev)).padStart(2, '0')}`;
  }
  const p = x.toPrecision(6);
  return p.includes('.') ? p.replace(/\.?0+$/, '') : p;
}

// ── result builders ───────────────────────────────────────────────────────

const ruleBasis = () => ({ code: RULE_BASIS.code, base: RULE_BASIS.base, amendments: RULE_BASIS.amendments });
const quantity = (value, unit) => ({ value, unit });
const operand = (ref, value, unit) => ({ ref, quantity: quantity(value, unit) });
function line(id, label, op, operands, result, ruleRef, amended, ruleStatus, extra) {
  const x = extra || {};
  return { id, label, op, operands, factor: own(x, 'factor') ? x.factor : null, divisorV: own(x, 'divisorV') ? x.divisorV : null, powerFactor: own(x, 'powerFactor') ? x.powerFactor : null, conductor: own(x, 'conductor') ? x.conductor : null, result, ruleRef, amended, ruleStatus, loadIds: x.loadIds ? x.loadIds.slice() : [] };
}
const emptyDemand = () => ({ status: 'not_computed', unit: 'VA', totalVA: null, totalOnConductorA: null, partialSubtotalVA: null, lines: [] });
const emptyCurrent = () => ({ status: 'not_computed', model: null, formula: null, assumptions: [], perConductorA: null, lineA: null, neutralA: null, note: NOTE_NEUTRAL });
const capacityNotAssessed = (blockingCode) => ({ status: 'not_assessed', comparisonKind: null, policy: PROFILE.comparisonPolicy, ruleRef: RULE_87_2, blockingCode: blockingCode === undefined ? null : blockingCode, comparisons: [], boundOutcome: null });
const defaultPresentation = () => ({ topologyLabel: '', showPerConductor: false, polesLabel: null, finalResultHeading: false, verdictLabel: null });

function polesLabel(topology) {
  if (!own(TOPOLOGY_SUPPLY, topology)) return null;
  const [, , phases, wires] = TOPOLOGY_SUPPLY[topology];
  if (phases === 3) return '3-pole';
  if (phases === 1 && wires === 3) return '2-pole';
  return null;
}

// ── evaluation context ────────────────────────────────────────────────────

function createContext(envelope, options) {
  const problems = [];
  const fieldsWithProblem = new Set();
  return {
    s: envelope.snapshot,
    parseErrors: envelope.parseErrors,
    precision: options.displayPrecision,
    problems,
    fieldsWithProblem,
    coverage: [],
    /** add a problem (all problems are always listed; sorted at the end) */
    add(code, field, layer, opts) {
      const o = opts || {};
      problems.push({ code, field, layer, source: o.source || 'engine', ruleRef: own(o, 'ruleRef') ? o.ruleRef : null, message: `${code} at ${field}` });
      if (layer === 'input') fieldsWithProblem.add(field);
    },
    /** semantic MISSING_FIELD is never duplicated on a field that already carries an input problem (parser/migration/engine) */
    missing(field, ruleRef) {
      if (fieldsWithProblem.has(field)) return;
      this.add('MISSING_FIELD', field, 'input', { ruleRef: ruleRef === undefined ? null : ruleRef });
    },
    has(code) { return problems.some((p) => p.code === code); },
    hasLayer(layer) { return problems.some((p) => p.layer === layer); },
  };
}

// ── input layer ───────────────────────────────────────────────────────────

function isEmptySnapshot(s) {
  return s.occupancy === null && s.method.selected === null && s.loads.length === 0 && s.measurement === null && s.migration === null;
}

function checkParseErrors(ctx) {
  for (const pe of ctx.parseErrors) ctx.add(pe.code, pe.field, 'input', { source: 'parser' });
}

/** Problems re-derived from the structured migration record (§11): nothing is recovered from prose. */
function checkMigration(ctx) {
  const { s } = ctx; const mig = s.migration;
  if (!mig) return;
  const src = mig.sourceRecord || {};
  const voltage = typeof src.voltage === 'string' ? src.voltage : '';
  if (s.supply.topology === null && voltage !== '') {
    if (own(State.LEGACY_VOLTAGE_AMBIGUOUS, voltage)) ctx.add('LEGACY_AMBIGUOUS', 'supply.topology', 'input', { source: 'migration' });
    else if (!own(State.LEGACY_VOLTAGE, voltage)) ctx.add('UNKNOWN_ENUM', 'supply.topology', 'input', { source: 'migration' });
  }
  const sqFt = typeof src.sqFt === 'string' ? src.sqFt.trim() : '';
  if (s.dwelling.floorAreaFt2 === null && sqFt !== '') ctx.add('NOT_FINITE', 'dwelling.floorAreaFt2', 'input', { source: 'migration' });
  const meter = typeof src.lcMeterVA === 'string' ? src.lcMeterVA.trim() : '';
  if (meter !== '' && s.measurement && s.measurement.reading.value === null) ctx.add('NOT_FINITE', 'measurement.reading.value', 'input', { source: 'migration' });
  // one problem per (reason, target) while the target field is still null — several unresolved items for the same count are one open question (B1-r1, R-B1-04)
  const seen = new Set();
  for (const u of mig.unresolvedItems || []) {
    if (u.status !== 'unresolved' || !u.reason) continue;
    const target = u.target === 'dwelling.laundryCircuits' || u.target === 'dwelling.nycAcCircuitCount' ? u.target : null;
    if (target === null) continue;
    const fieldName = target === 'dwelling.laundryCircuits' ? 'laundryCircuits' : 'nycAcCircuitCount';
    if (s.dwelling[fieldName] !== null || seen.has(`${u.reason}\u0000${target}`)) continue;
    seen.add(`${u.reason}\u0000${target}`);
    ctx.add(u.reason, target, 'input', { source: 'migration' });
  }
}

function checkUniversal(ctx) {
  const { s } = ctx;
  if (s.occupancy === null) ctx.missing('occupancy');
  if (s.supply.topology === null) ctx.missing('supply.topology');
  else if (s.supply.topology === 'other') ctx.add('SCOPE_UNSUPPORTED', 'supply.topology', 'input');
  if (s.loadModel.kind === null) ctx.missing('loadModel.kind');
  if (s.method.selected === null) ctx.missing('method.selected');
}

/** Profile gating (a) — outside the profile: CAPABILITY_DISABLED, data retained, no layer computed. */
function checkMethodGate(ctx) {
  const { s } = ctx; const m = s.method.selected;
  if (m === null) return;
  if (!PROFILE.enabledMethods.includes(m)) {
    ctx.add('CAPABILITY_DISABLED', 'method.selected', 'input');
    ctx.add('RULE_PENDING', 'method.selected', 'input', { ruleRef: own(PENDING_RULE_LABEL, m) ? PENDING_RULE_LABEL[m] : null });
  }
  // retained-data completeness of the disabled paths (validation problems are still listed, T-S-07, T-S-04b)
  const d = s.dwelling; const mf = s.multifamily;
  if (m === 'opt_220_82' || m === 'existing_220_83') {
    if (d.floorAreaFt2 === null) ctx.missing('dwelling.floorAreaFt2');
    else if (d.floorAreaFt2 <= 0) ctx.add('OUT_OF_RANGE', 'dwelling.floorAreaFt2', 'input');
  }
  if (m === 'standard_part_III' && s.occupancy === 'nondwelling') ctx.add('SCOPE_UNSUPPORTED', 'occupancy', 'input');
  if (m === 'multifamily_220_84') {
    if (mf.unitCount === null) ctx.missing('multifamily.unitCount');
    else if (mf.unitCount <= 0) ctx.add('OUT_OF_RANGE', 'multifamily.unitCount', 'input');
    if (mf.houseLoads.mode === null) ctx.missing('multifamily.houseLoads.mode');
    else if (mf.houseLoads.mode === 'entered_va' && mf.houseLoads.va === null) ctx.missing('multifamily.houseLoads.va');
    for (const k of ['allUnitsElectricCooking', 'allUnitsElectricHeatOrAc', 'singleFeederPerUnit']) {
      const v = declaredValue(mf[k]);
      if (v === null) ctx.add('QUALIFICATION_UNKNOWN', `multifamily.${k}`, 'input');
      else if (v === false) ctx.add('QUALIFICATION_FAILED', `multifamily.${k}`, 'input', { ruleRef: RULE_84_A });
    }
  }
}

/** Leg / connection validity against the supply topology (§4). Returns {legInvalid, connectionInvalid}. */
function connectionValidity(topology, connection, leg) {
  if (!own(TOPOLOGY_SUPPLY, topology)) return { legInvalid: false, connectionInvalid: false };
  const [, vln, phases, wires] = TOPOLOGY_SUPPLY[topology];
  const legInvalid = leg !== null && (wires === 2 || (phases === 1 && leg === 'L3'));
  const connectionInvalid = (connection === 'LN' && vln === null) || (connection === '3PH' && phases !== 3);
  return { legInvalid, connectionInvalid };
}

function checkLoads(ctx) {
  const { s } = ctx; const topology = s.supply.topology;
  const ids = new Set(); let dup = false;
  s.loads.forEach((l, i) => {
    const f = `loads[${i}]`;
    if (ids.has(l.id)) dup = true; ids.add(l.id);
    if (l.rating.kind !== 'va') ctx.add('UNSUPPORTED_RATING_KIND', `${f}.rating.kind`, 'input');
    else if (!isNum(l.rating.value)) ctx.add('NOT_FINITE', `${f}.rating.value`, 'input');
    else if (l.rating.value < 0) ctx.add('OUT_OF_RANGE', `${f}.rating.value`, 'input');
    if (!Number.isInteger(l.quantity) || l.quantity < 1) ctx.add('OUT_OF_RANGE', `${f}.quantity`, 'input');
    const v = connectionValidity(topology, l.connection, l.leg);
    if (v.legInvalid) ctx.add('LEG_INVALID', `${f}.leg`, 'input');
    if (v.connectionInvalid) ctx.add('CONNECTION_INVALID', `${f}.connection`, 'input');
    if (l.classification === 'required') ctx.add('CLASSIFICATION_REQUIRED', `${f}.category`, 'demand');
  });
  if (dup) ctx.add('DUPLICATE_ID', 'loads', 'input');
  ctx.loadIdsUnique = !dup;
}

/** Declared-boolean qualification row: null -> QUALIFICATION_UNKNOWN (INCOMPLETE); a wrong value -> QUALIFICATION_FAILED (UNQUALIFIED). */
function qualify(ctx, field, decl, required, ruleRef) {
  const v = declaredValue(decl);
  if (v === null) ctx.add('QUALIFICATION_UNKNOWN', field, 'input', { ruleRef });
  else if (v !== required) ctx.add('QUALIFICATION_FAILED', field, 'input', { ruleRef });
}

/** Measured 220.87 route: required fields (§9.2) and the qualification matrix (§7.2). */
function checkMeasurement(ctx) {
  const { s } = ctx; const m = s.measurement;
  if (m === null) { ctx.missing('measurement'); return; }
  if (s.purpose === null) ctx.missing('purpose');
  if (m.basis === null) ctx.missing('measurement.basis');
  const unit = m.reading.unit; const isA = unit === 'A';
  const readingScope = field(m, 'readingScope');
  // reading scope must fit the reading unit
  if (readingScope === null) ctx.missing('measurement.readingScope');
  else if (!isA && readingScope !== 'total_apparent_power') ctx.add('UNKNOWN_ENUM', 'measurement.readingScope', 'input');
  else if (isA && readingScope === 'total_apparent_power') ctx.add('UNKNOWN_ENUM', 'measurement.readingScope', 'input');
  // the reading itself: blank is null (parser reports it); never 0, never a previous value
  const readingValue = field(m.reading, 'value');
  if (readingScope === 'per_conductor') {
    // B1-r1 (R-B1-02): the required set comes from the supply topology, never from the keys that happen to be present
    const per = field(m, 'readingsPerConductor');
    const required = requiredConductors(s.supply.topology);
    if (per === null) ctx.missing('measurement.readingsPerConductor');
    else {
      for (const k of ['L1', 'L2', 'L3']) {
        const v = field(per, k);
        const isRequired = required === null ? null : required.includes(k);
        if (v === null) { if (isRequired) ctx.missing(`measurement.readingsPerConductor.${k}`); }
        else if (!isNum(v)) ctx.add('NOT_FINITE', `measurement.readingsPerConductor.${k}`, 'input');
        else if (v <= 0) ctx.add('OUT_OF_RANGE', `measurement.readingsPerConductor.${k}`, 'input');
        else if (isRequired === false) ctx.add('LEG_INVALID', `measurement.readingsPerConductor.${k}`, 'input');
      }
    }
  } else if (readingValue === null) ctx.missing('measurement.reading.value');
  else if (!isNum(readingValue)) ctx.add('NOT_FINITE', 'measurement.reading.value', 'input');
  else if (readingValue <= 0) ctx.add('OUT_OF_RANGE', 'measurement.reading.value', 'input');
  if (unit === 'kW') {
    const pf = field(m, 'powerFactor');
    if (pf === null) ctx.missing('measurement.powerFactor');
    else if (!isNum(pf) || pf <= 0 || pf > 1) ctx.add('OUT_OF_RANGE', 'measurement.powerFactor', 'input');
  }
  // existing rating (verdict only) must at least be a positive number when present
  const ex = field(m, 'existing') || {};
  for (const k of ['serviceRatingA', 'feederAmpacityA']) {
    const v = field(ex, k);
    if (v !== null && (!isNum(v) || v <= 0)) ctx.add('OUT_OF_RANGE', `measurement.existing.${k}`, 'input');
  }
  // qualification matrix (§7.2) for the chosen route — an absent property is an unknown condition, never a satisfied one (B1-r1, R-B1-01)
  if (m.basis === 'annual_max_demand') {
    qualify(ctx, 'measurement.annualDataAvailable', field(m, 'annualDataAvailable'), true, RULE_87_1);
    const months = field(m, 'periodMonths');
    if (months === null) ctx.add('QUALIFICATION_UNKNOWN', 'measurement.periodMonths', 'input', { ruleRef: RULE_87_1 });
    else if (months < 12) ctx.add('QUALIFICATION_FAILED', 'measurement.periodMonths', 'input', { ruleRef: RULE_87_1 });
  } else if (m.basis === '30d_recording_exception') {
    qualify(ctx, 'measurement.annualDataAvailable', field(m, 'annualDataAvailable'), false, RULE_87_1_EXC);
    const days = field(m, 'periodDays'); const interval = field(m, 'intervalMinutes'); const connectedTo = field(m, 'connectedTo');
    if (days === null) ctx.add('QUALIFICATION_UNKNOWN', 'measurement.periodDays', 'input', { ruleRef: RULE_87_1_EXC });
    else if (days < 30) ctx.add('QUALIFICATION_FAILED', 'measurement.periodDays', 'input', { ruleRef: RULE_87_1_EXC });
    if (interval === null) ctx.add('QUALIFICATION_UNKNOWN', 'measurement.intervalMinutes', 'input', { ruleRef: RULE_87_1_EXC });
    else if (interval > 15 || interval <= 0) ctx.add('QUALIFICATION_FAILED', 'measurement.intervalMinutes', 'input', { ruleRef: RULE_87_1_EXC });
    qualify(ctx, 'measurement.continuousRecording', field(m, 'continuousRecording'), true, RULE_87_1_EXC);
    if (connectedTo === null || connectedTo === 'unknown') ctx.add('QUALIFICATION_UNKNOWN', 'measurement.connectedTo', 'input', { ruleRef: RULE_87_1_EXC });
    qualify(ctx, 'measurement.basedOnInitialLoading', field(m, 'basedOnInitialLoading'), true, RULE_87_1_EXC);
    qualify(ctx, 'measurement.recordedWhileOccupied', field(m, 'recordedWhileOccupied'), true, RULE_87_1_EXC);
    qualify(ctx, 'measurement.includesLargerOfHeatingOrCooling', field(m, 'includesLargerOfHeatingOrCooling'), true, RULE_87_1_EXC);
    qualify(ctx, 'measurement.includesPeriodicSeasonalLoads', field(m, 'includesPeriodicSeasonalLoads'), true, RULE_87_1_EXC);
    qualify(ctx, 'measurement.hasRenewableEnergySystem', field(m, 'hasRenewableEnergySystem'), false, RULE_87_1_EXC);
    qualify(ctx, 'measurement.hasPeakLoadShaving', field(m, 'hasPeakLoadShaving'), false, RULE_87_1_EXC);
  }
  // overload protection attestation for the assessed object (§7.2, 220.87(3)) — a qualification row, so only once a route is chosen
  if (m.basis !== null) {
    if (s.purpose === 'service') qualify(ctx, 'measurement.existing.serviceOverloadPer230_90', field(ex, 'serviceOverloadPer230_90'), true, RULE_87_3);
    else if (s.purpose === 'feeder') qualify(ctx, 'measurement.existing.feederOcpPer240_4', field(ex, 'feederOcpPer240_4'), true, RULE_87_3);
  }
  checkNewLoad(ctx);
}

/** New-load term: mode gating (§6.2), term fields, term validity, covers identity (§6.2.1). */
function checkNewLoad(ctx) {
  const { s } = ctx; const nl = s.measurement.newLoad;
  ctx.term = null; ctx.termValid = false; ctx.projection = undefined;
  if (nl.mode === null) { ctx.missing('measurement.newLoad.mode'); return; }
  if (!PROFILE.enabledNewLoadModes.includes(nl.mode)) { ctx.add('CAPABILITY_DISABLED', 'measurement.newLoad.mode', 'input'); return; }
  if (nl.mode !== 'precalculated') return;
  const pre = nl.precalculated; const f = 'measurement.newLoad.precalculated';
  if (pre === null) { ctx.missing(f); return; }
  ctx.term = pre;
  let valid = true;
  if (pre.va === null) { ctx.missing(`${f}.va`); valid = false; }
  else if (!isNum(pre.va)) { ctx.add('NOT_FINITE', `${f}.va`, 'input'); valid = false; }
  else if (pre.va < 0) { ctx.add('OUT_OF_RANGE', `${f}.va`, 'input'); valid = false; }
  if (pre.connection === null) { ctx.missing(`${f}.connection`); valid = false; }
  const v = connectionValidity(s.supply.topology, pre.connection, pre.leg);
  if (v.legInvalid) { ctx.add('LEG_INVALID', `${f}.leg`, 'input'); valid = false; }
  if (v.connectionInvalid) { ctx.add('CONNECTION_INVALID', `${f}.connection`, 'input'); valid = false; }
  // covers identity: duplicate ids (in covers[] or loads[]) or an unknown id make the projection undefined
  const coversUnique = new Set(pre.covers).size === pre.covers.length;
  if (!coversUnique) ctx.add('DUPLICATE_ID', `${f}.covers`, 'input');
  if (coversUnique && ctx.loadIdsUnique) {
    const known = new Set(s.loads.map((l) => l.id));
    if (pre.covers.some((id) => !known.has(id))) ctx.add('COVERS_UNKNOWN_LOAD', `${f}.covers`, 'input');
  }
  ctx.projection = coversProjection(s.loads, pre.covers);
  ctx.termValid = valid;
}

/**
 * Amperes-path prerequisites (§7.4, engine-owned combination table). These
 * qualify the demand itself (per-conductor totals), so a missing datum is an
 * input-layer problem echoed at the layer it blocks (T-N-14, T-N-17b, T-N-34).
 * Sets ctx.ampere = { keys, readings, affected, termKind } when the path can run.
 */
function checkAmperesPath(ctx) {
  const { s } = ctx; const m = s.measurement; const topology = s.supply.topology;
  const readingScope = field(m, 'readingScope');
  if (!own(TOPOLOGY_SUPPLY, topology) || readingScope === null) return;
  const per = field(m, 'readingsPerConductor');
  // per_conductor: the complete required set of the topology (B1-r1); highest_loaded_conductor: the one declared reading
  const keys = readingScope === 'per_conductor'
    ? (requiredConductors(topology) || [])
    : (readingScope === 'highest_loaded_conductor' ? ['measured'] : []);
  const readings = keys.map((k) => (k === 'measured' ? field(m.reading, 'value') : (per === null ? null : field(per, k))));
  if (!keys.length || readings.some((r) => !isNum(r) || r <= 0)) return; // incomplete or invalid readings were reported by checkMeasurement; no path is built from a subset
  const [, , phases, wires] = TOPOLOGY_SUPPLY[topology];
  const term = ctx.term;
  const f = 'measurement.newLoad.precalculated';
  if (!term || !ctx.termValid) {
    if (!term) ctx.ampere = { keys, readings, affected: [], termKind: null };
    return;
  }
  const conn = term.connection;
  const decls = s.loadModel.declarations || {};
  let affected = null; let termKind = null; let blocked = false;
  const requireDeclaration = (name) => {
    const v = declaredValue(decls[name]);
    if (v === true) return true;
    const field = `loadModel.declarations.${name}`;
    if (v === null) { ctx.add('QUALIFICATION_UNKNOWN', field, 'input'); ctx.add('MODEL_DECLARATION_MISSING', field, 'current'); }
    else ctx.add('CAPABILITY_DISABLED', field, 'input'); // no phase-angle solver: the combination is disabled, not approximated
    return false;
  };
  if (topology === '1ph_3w_120_240') {
    if (conn === 'LL') {
      if (!requireDeclaration('unityPF')) blocked = true; // in-phase addition to the measured current
      affected = keys; termKind = 'LL';
    } else if (conn === 'LN') {
      if (m.readingScope === 'highest_loaded_conductor') {
        // which physical conductor was measured/loaded is unknown: no exact verdict
        ctx.add('ASSOCIATION_UNKNOWN', 'measurement.readingsPerConductor', 'capacity', { ruleRef: RULE_87_2 });
        ctx.missing('measurement.readingsPerConductor');
        blocked = true;
      } else if (term.leg === null) {
        ctx.missing(`${f}.leg`); ctx.add('MODEL_DECLARATION_MISSING', `${f}.leg`, 'current'); blocked = true;
      } else if (!keys.includes(term.leg)) {
        ctx.add('ASSOCIATION_UNKNOWN', 'measurement.readingsPerConductor', 'capacity', { ruleRef: RULE_87_2 });
        ctx.missing(`measurement.readingsPerConductor.${term.leg}`); blocked = true;
      }
      if (!requireDeclaration('unityPF')) blocked = true; // in-phase addition on the declared leg
      affected = term.leg === null ? [] : [term.leg]; termKind = 'LN';
    }
  } else if (topology === '1ph_3w_120_208_network') {
    // currents from L-N and L-L loads on the same conductor are 30 deg apart: an arithmetic sum is a bound, not exact
    ctx.add('CAPABILITY_DISABLED', `${f}.connection`, 'input'); blocked = true;
  } else if (phases === 3 && THREE_PHASE_SUPPORTED.includes(topology)) {
    if (conn === '3PH') {
      if (!requireDeclaration('balanced3ph')) blocked = true;
      affected = keys; termKind = '3PH';
    } else { ctx.add('CAPABILITY_DISABLED', `${f}.connection`, 'input'); blocked = true; } // LL/LN on a 3-phase system: phase offsets not covered
  } else {
    // 2-wire supplies and 240 V delta topologies have no declared amperes-path term combination
    ctx.add('CAPABILITY_DISABLED', `${f}.connection`, 'input'); blocked = true;
  }
  void wires;
  if (!blocked && affected) ctx.ampere = { keys, readings, affected, termKind };
}

// ── demand / coverage ─────────────────────────────────────────────────────

/** Per-load coverage entries (§6). Demand-layer problems are emitted only when the demand is actually evaluated. */
function buildCoverage(ctx, emitDemandProblems) {
  const { s } = ctx; const cov = [];
  const scopeUnsupported = ctx.has('SCOPE_UNSUPPORTED');
  const methodDisabled = s.method.selected !== null && !PROFILE.enabledMethods.includes(s.method.selected);
  const nl = s.measurement ? s.measurement.newLoad : null;
  const mode = nl ? nl.mode : null;
  const modeDisabled = mode !== null && !PROFILE.enabledNewLoadModes.includes(mode);
  if (ctx.has('DUPLICATE_ID') || ctx.has('COVERS_UNKNOWN_LOAD')) return cov; // identity undefined: coverage cannot be keyed by loadId
  const covers = ctx.term ? new Set(ctx.term.covers) : new Set();
  const stale = ctx.term && ctx.projection !== null && ctx.projection !== undefined ? canonicalJson(ctx.projection) !== canonicalJson(Array.isArray(ctx.term.coversSnapshot) ? ctx.term.coversSnapshot : []) : false;
  let modeNoneFlag = false; let staleFlag = false;
  const entry = (loadId, coverage, reason, ruleRef, viaAggregate) => ({ loadId, coverage, ruleRef: ruleRef === undefined ? null : ruleRef, reason: reason === undefined ? null : reason, viaAggregate: !!viaAggregate });
  s.loads.forEach((l, i) => {
    const f = `loads[${i}]`;
    let e;
    if (l.rating.kind !== 'va') e = entry(l.id, 'unresolved', 'UNSUPPORTED_RATING_KIND');
    else if (!isNum(l.rating.value)) e = entry(l.id, 'unresolved', 'NOT_FINITE');
    else if (l.rating.value < 0) e = entry(l.id, 'unresolved', 'OUT_OF_RANGE');
    else if (scopeUnsupported) e = entry(l.id, 'unresolved', 'SCOPE_UNSUPPORTED');
    else if (l.classification === 'required') e = entry(l.id, 'unresolved', 'CLASSIFICATION_REQUIRED');
    else if (methodDisabled || modeDisabled) e = entry(l.id, 'unresolved', 'CAPABILITY_DISABLED');
    else if (mode === 'precalculated' && covers.has(l.id)) {
      // a covered load stays covered whatever its status: the user listed it under the term (§6.2)
      if (stale) { e = entry(l.id, 'unresolved', 'AGGREGATE_STALE', null, true); staleFlag = true; }
      else e = entry(l.id, 'counted_via_aggregate', null, 'user-supplied', true);
    }
    else if (l.status === null) e = entry(l.id, 'unresolved', 'MISSING_FIELD');
    else if (l.status === 'existing') e = entry(l.id, 'not_applicable_by_rule', null, RULE_87_2); // represented by the measured demand
    else if (mode === null) e = entry(l.id, 'unresolved', 'MISSING_FIELD');
    else if (mode === 'none') { e = entry(l.id, 'unresolved', 'NEWLOAD_MODE_NONE_WITH_NEW_LOADS'); modeNoneFlag = true; }
    else e = entry(l.id, 'unresolved', 'NOT_COVERED_BY_AGGREGATE');
    cov.push(e);
    if (emitDemandProblems) {
      if (mode === 'precalculated' && l.status === 'new' && !covers.has(l.id) && l.rating.kind === 'va' && isNum(l.rating.value) && l.rating.value >= 0) ctx.add('NOT_COVERED_BY_AGGREGATE', f, 'demand');
      if (e.coverage === 'unresolved') ctx.add('LOAD_UNRESOLVED', f, 'demand');
    }
  });
  if (emitDemandProblems) {
    if (modeNoneFlag) ctx.add('NEWLOAD_MODE_NONE_WITH_NEW_LOADS', 'measurement.newLoad.mode', 'demand');
    if (staleFlag) ctx.add('AGGREGATE_STALE', 'measurement.newLoad.precalculated.coversSnapshot', 'demand');
  }
  ctx.termCounted = !!(ctx.term && ctx.termValid && ctx.projection !== null && !stale);
  return cov;
}

/** VA-path typed lines in the declared order (§7.3). Returns {lines, norm, comp, total, overflow}. */
function buildVaLines(ctx, withTotal) {
  const { s } = ctx; const m = s.measurement; const rd = m.reading; const lines = [];
  let norm = rd.value; let ref = null;
  if (rd.unit === 'kVA') {
    norm = rd.value * 1000.0;
    lines.push(line('norm', 'Reading kVA -> VA', 'convert_unit', [operand(null, rd.value, 'kVA')], quantity(norm, 'VA'), 'unit conversion', false, 'verified'));
    ref = 'norm';
  } else if (rd.unit === 'kW') {
    const pf = field(m, 'powerFactor');
    norm = (rd.value * 1000.0) / pf;
    lines.push(line('norm', 'Reading kW -> VA at declared PF', 'convert_unit', [operand(null, rd.value, 'kW')], quantity(norm, 'VA'), 'unit conversion (declared PF)', false, 'verified', { powerFactor: pf }));
    ref = 'norm';
  }
  const comp = norm * FACTOR_125;
  lines.push(line('existing125', 'Existing maximum demand x 125 %', 'multiply', [operand(ref, norm, 'VA')], quantity(comp, 'VA'), RULE_87_2, true, 'verified', { factor: FACTOR_125 }));
  let total = comp;
  if (ctx.termCounted) {
    const va = ctx.term.va;
    lines.push(line('newTerm', 'New load term (user-supplied, precalculated; no factor applied by the tool)', 'identity', [operand(null, va, 'VA')], quantity(va, 'VA'), 'user-supplied', false, 'user_supplied', { loadIds: ctx.term.covers }));
    total = comp + va;
    lines.push(line('total', 'Total for the 220.87(2) comparison', 'sum', [operand('existing125', comp, 'VA'), operand('newTerm', va, 'VA')], quantity(total, 'VA'), RULE_87_2, true, 'verified'));
  } else if (withTotal) {
    lines.push(line('total', 'Total for the 220.87(2) comparison', 'identity', [operand('existing125', comp, 'VA')], quantity(total, 'VA'), RULE_87_2, true, 'verified'));
  }
  const overflow = !isNum(norm) || !isNum(comp) || !isNum(total);
  return { lines, norm, comp, total, overflow };
}

/** Amperes-path typed lines (§7.4, I-21): e_<k>, n_<leg|LL|3PH>, t_<k>, governing. */
function buildAmpereLines(ctx, withGoverning) {
  const { s } = ctx; const a = ctx.ampere; const sup = s.supply; const lines = []; const totals = new Map();
  a.keys.forEach((k, idx) => {
    const r = a.readings[idx]; const comp = r * FACTOR_125;
    lines.push(line(`e_${k}`, `Existing maximum demand x 125 % on ${k}`, 'multiply', [operand(null, r, 'A')], quantity(comp, 'A'), RULE_87_2, true, 'verified', { factor: FACTOR_125, conductor: k === 'measured' ? null : k }));
    totals.set(k, comp);
  });
  if (ctx.termCounted && a.termKind) {
    const va = ctx.term.va; let nid; let i;
    if (a.termKind === 'LN') {
      const leg = ctx.term.leg; nid = `n_${leg}`; i = va / sup.vLineToNeutral;
      lines.push(line(nid, `New L-N load ${fmtG(va)} VA / ${fmtG(sup.vLineToNeutral)} V on ${leg}`, 'divide_by_voltage', [operand(null, va, 'VA')], quantity(i, 'A'), 'user-supplied', false, 'user_supplied', { divisorV: sup.vLineToNeutral, conductor: leg }));
    } else if (a.termKind === 'LL') {
      nid = 'n_LL'; i = va / sup.vLineToLine;
      lines.push(line(nid, `New L-L load ${fmtG(va)} VA / ${fmtG(sup.vLineToLine)} V (split-phase: adds equally to both conductors)`, 'divide_by_voltage', [operand(null, va, 'VA')], quantity(i, 'A'), 'user-supplied', false, 'user_supplied', { divisorV: sup.vLineToLine }));
    } else {
      nid = 'n_3PH'; i = va / (SQRT3 * sup.vLineToLine);
      lines.push(line(nid, `New balanced 3-phase load ${fmtG(va)} VA / (sqrt3 x ${fmtG(sup.vLineToLine)} V) (adds equally to every conductor)`, 'divide_by_sqrt3_voltage', [operand(null, va, 'VA')], quantity(i, 'A'), 'user-supplied', false, 'user_supplied', { divisorV: sup.vLineToLine }));
    }
    for (const k of a.affected) {
      const tot = totals.get(k) + i;
      lines.push(line(`t_${k}`, `Total on ${k}`, 'sum', [operand(`e_${k}`, totals.get(k), 'A'), operand(nid, i, 'A')], quantity(tot, 'A'), RULE_87_2, true, 'verified', { conductor: k === 'measured' ? null : k }));
      totals.set(k, tot);
    }
  }
  let gov = null; let gv = null;
  if (withGoverning) {
    for (const [k, v] of totals) if (gv === null || v > gv) { gov = k; gv = v; }
    const ref = lines.some((l) => l.id === `t_${gov}`) ? `t_${gov}` : `e_${gov}`;
    lines.push(line('governing', `Governing conductor total (${gov})`, 'identity', [operand(ref, gv, 'A')], quantity(gv, 'A'), RULE_87_2, true, 'verified', { conductor: gov === 'measured' ? null : gov }));
  }
  const overflow = lines.some((l) => !isNum(l.result.value) || l.operands.some((o) => !isNum(o.quantity.value)));
  return { lines, totals, gov, gv, overflow };
}

/** §5 model applicability on the VA path (current layer). Returns {model, formula, assumptions, per, lineA} or null after adding problems. */
function computeCurrent(ctx, total) {
  const { s } = ctx; const sup = s.supply; const model = s.loadModel.kind; const topology = sup.topology; const decls = s.loadModel.declarations || {};
  const term = ctx.termCounted ? ctx.term : null; const conn = term ? term.connection : null;
  const f = 'measurement.newLoad.precalculated';
  if (!PROFILE.enabledModels.includes(model) || !own(MODEL_TOPOLOGIES, model) || !MODEL_TOPOLOGIES[model].includes(topology)) { ctx.add('MODEL_UNSUPPORTED', 'loadModel.kind', 'current'); return null; }
  const declaration = (name) => {
    const v = declaredValue(decls[name]);
    if (v === true) return true;
    ctx.add(v === null ? 'MODEL_DECLARATION_MISSING' : 'MODEL_UNSUPPORTED', `loadModel.declarations.${name}`, 'current');
    return false;
  };
  const per3 = (i, three) => ({ L1: i, L2: three || topology !== '1ph_2w_120' ? i : null, L3: three ? i : null });
  switch (model) {
    case 'single_2w': {
      const i = total / sup.vLineToLine;
      return { model, formula: `I = VA / ${fmtG(sup.vLineToLine)}`, assumptions: ['single 2-wire circuit'], per: per3(i, false), lineA: i };
    }
    case 'split_240_all_LL': {
      if (conn !== null && conn !== 'LL') { ctx.add('MODEL_UNSUPPORTED', `${f}.connection`, 'current'); return null; }
      const i = total / sup.vLineToLine;
      return { model, formula: 'I = VA / 240', assumptions: ['all loads line-to-line'], per: per3(i, false), lineA: i };
    }
    case 'split_240_balanced_LN': {
      if (!declaration('balancedLN')) return null;
      const i = total / sup.vLineToLine;
      return { model, formula: 'I = VA / 240', assumptions: ['balancedLN declared'], per: per3(i, false), lineA: i };
    }
    case 'split_240_declared_legs': {
      if (!declaration('unityPF')) return null;
      if (conn === 'LN' && term.leg === null) { ctx.add('MODEL_DECLARATION_MISSING', `${f}.leg`, 'current'); return null; }
      // a measured VA total carries no per-leg distribution, so the declared-legs formula (sum of LL/240 and LN/120 per leg) cannot be applied to it
      ctx.add('MODEL_UNSUPPORTED', 'loadModel.kind', 'current'); return null;
    }
    case 'network_208_all_LL': {
      if (conn !== null && conn !== 'LL') { ctx.add('MODEL_UNSUPPORTED', `${f}.connection`, 'current'); return null; }
      const i = total / sup.vLineToLine;
      return { model, formula: 'I = VA / 208', assumptions: ['all loads line-to-line'], per: per3(i, false), lineA: i };
    }
    case 'network_208_balanced_LN': {
      if (!declaration('balancedLN')) return null;
      if (conn !== null && conn !== 'LN') { ctx.add('MODEL_UNSUPPORTED', `${f}.connection`, 'current'); return null; }
      const i = (total / 2) / sup.vLineToNeutral;
      return { model, formula: 'I = (VA / 2) / 120', assumptions: ['balancedLN declared'], per: per3(i, false), lineA: i };
    }
    case 'three_phase_balanced': {
      if (!declaration('balanced3ph')) return null;
      if (conn !== null && conn !== '3PH') { ctx.add('MODEL_UNSUPPORTED', `${f}.connection`, 'current'); return null; }
      const den = SQRT3 * sup.vLineToLine; const i = total / den;
      return { model, formula: `I = VA / (sqrt3 * ${fmtG(sup.vLineToLine)})`, assumptions: ['balanced3ph declared'], per: per3(i, true), lineA: i };
    }
    default:
      ctx.add('MODEL_UNSUPPORTED', 'loadModel.kind', 'current'); return null;
  }
}

/** Capacity layer (§7.4): rating for the purpose, qualified basis; exact raw comparisons. */
function assessCapacity(ctx, values) {
  const { s } = ctx; const m = s.measurement; const ex = field(m, 'existing') || {};
  const ratingSource = s.purpose === 'feeder' ? 'feederAmpacityA' : 'serviceRatingA';
  const rating = field(ex, ratingSource);
  if (rating === null) ctx.add('MISSING_FIELD', `measurement.existing.${ratingSource}`, 'capacity', { ruleRef: RULE_87_2 });
  if (ctx.termCounted && ctx.term.basis.establishedForThisComparison !== true) ctx.add('NEWLOAD_BASIS_UNQUALIFIED', 'measurement.newLoad.precalculated.basis.establishedForThisComparison', 'capacity');
  const blocking = blockingCode(ctx);
  if (blocking !== null || values === null) return capacityNotAssessed(blocking);
  const comparisons = values.map(([conductor, raw]) => ({ conductor, unit: 'A', demandValueRaw: raw, ratingValue: rating, ratingSource, satisfied: raw <= rating }));
  return { status: comparisons.every((c) => c.satisfied) ? 'adequate' : 'inadequate', comparisonKind: 'exact', policy: PROFILE.comparisonPolicy, ruleRef: RULE_87_2, blockingCode: null, comparisons, boundOutcome: null };
}

/** First blocking code by precedence: current-layer model problems, then capacity-layer problems. */
function blockingCode(ctx) {
  const order = ['MODEL_UNSUPPORTED', 'MODEL_DECLARATION_MISSING', 'ASSOCIATION_UNKNOWN', 'MISSING_FIELD', 'NEWLOAD_BASIS_UNQUALIFIED'];
  for (const code of order) if (ctx.problems.some((p) => p.code === code && (p.layer === 'current' || p.layer === 'capacity'))) return code;
  return null;
}

/** §9.1 status precedence from the listed problems (first matching row wins). */
function statusOf(ctx, unresolved) {
  const inp = new Set(ctx.problems.filter((p) => p.layer === 'input').map((p) => p.code));
  if (inp.has('SCOPE_UNSUPPORTED') || inp.has('CAPABILITY_DISABLED')) return 'UNSUPPORTED_SCOPE';
  if (inp.has('RULE_PENDING')) return 'BLOCKED_PENDING_RULE';
  for (const c of ['NOT_FINITE', 'OUT_OF_RANGE', 'NOT_INTEGER', 'UNKNOWN_ENUM', 'LEGACY_AMBIGUOUS', 'UNSUPPORTED_RATING_KIND', 'SUPPLY_INCONSISTENT', 'LEG_INVALID', 'CONNECTION_INVALID', 'COVERS_UNKNOWN_LOAD', 'DUPLICATE_ID', 'PARSE_REJECTED']) if (inp.has(c)) return 'INVALID_INPUT';
  if (inp.has('MISSING_FIELD') || inp.has('QUALIFICATION_UNKNOWN')) return 'INCOMPLETE_INPUT';
  if (inp.has('QUALIFICATION_FAILED')) return 'UNQUALIFIED_METHOD';
  if (unresolved) return 'PARTIAL';
  return 'COMPLETE';
}

function sortProblems(problems) {
  return problems.slice().sort((a, b) => codePointCompare(a.code, b.code) || codePointCompare(a.field, b.field));
}

/** Diagnostics are data (`operative: false`); continuity of the user-established term is never resolved by profile A (T-P-19 pending). */
function diagnostics(ctx, va) {
  return { operative: false, existingComponentVA: va.existingComponentVA, existingComponentAOnConductor: va.existingComponentAOnConductor, newLoadTermVA: ctx.termCounted ? ctx.term.va : null, continuityOfNewLoadKnown: ctx.termCounted ? false : null, upperBoundScreening: null };
}

// ── public API ────────────────────────────────────────────────────────────

function normalizeOptions(options) {
  const o = options === undefined || options === null ? {} : options;
  if (typeof o !== 'object') throw new TypeError('evaluate: options must be an object');
  const p = own(o, 'displayPrecision') && o.displayPrecision !== null ? o.displayPrecision : {};
  const amps = own(p, 'amps') ? p.amps : PROFILE.displayPrecision.amps;
  const va = own(p, 'va') ? p.va : PROFILE.displayPrecision.va;
  for (const [k, v] of [['amps', amps], ['va', va]]) if (!Number.isInteger(v) || v < 0 || v > 6) throw new TypeError(`evaluate: displayPrecision.${k} must be an integer 0..6`);
  return { displayPrecision: { amps, va } };
}

/**
 * Evaluate a RequestEnvelope `{snapshot, parseErrors, profileId}`.
 * @param {object} envelope  structurally valid request (L2); otherwise LoadCalcEnvelopeError is thrown and no arithmetic runs
 * @param {object} [options] `{ displayPrecision: { amps, va } }` — presentation only (§8); default amps 1, VA 0
 * @returns {object} LoadCalcResult (schemaVersion "3.2.1")
 */
function evaluate(envelope, options) {
  const opt = normalizeOptions(options);
  const structural = validateEnvelope(envelope);
  if (structural.length) throw new LoadCalcEnvelopeError(structural);
  const ctx = createContext(envelope, opt);
  const { s } = ctx;
  const pa = opt.displayPrecision.amps; const pv = opt.displayPrecision.va;

  const result = {
    schemaVersion: SCHEMA_VERSION, ruleBasis: ruleBasis(), profileId: PROFILE.id, status: 'EMPTY', problems: [], loadsCoverage: [],
    demand: emptyDemand(), current: emptyCurrent(), existingCapacity: capacityNotAssessed(null),
    requiredCapacity: { status: 'not_assessed', note: NOTE_REQUIRED_CAPACITY }, rating: { status: 'not_assessed', note: NOTE_RATING },
    diagnostics: { operative: false }, display: { precision: { amps: pa, va: pv }, rounding: 'half_away_from_zero', strings: {}, feedsComparison: false },
    presentation: defaultPresentation(), references: [],
  };
  if (isEmptySnapshot(s) && ctx.parseErrors.length === 0) return result; // Init == Reset == EMPTY (P-5)

  // ── input layer ──
  checkParseErrors(ctx);
  checkMigration(ctx);
  checkUniversal(ctx);
  checkMethodGate(ctx);
  checkLoads(ctx);
  ctx.term = null; ctx.termValid = false; ctx.projection = undefined; ctx.ampere = null; ctx.termCounted = false;
  const measured = s.method.selected === 'measured_220_87';
  if (measured) {
    checkMeasurement(ctx);
    if (s.measurement && s.measurement.reading.unit === 'A' && !ctx.has('CAPABILITY_DISABLED')) checkAmperesPath(ctx);
  }

  const inputClean = !ctx.hasLayer('input');
  const canCompute = measured && inputClean && s.measurement !== null && (s.measurement.reading.unit !== 'A' || ctx.ampere !== null);
  result.loadsCoverage = buildCoverage(ctx, canCompute);
  const unresolved = result.loadsCoverage.some((c) => c.coverage === 'unresolved');

  if (canCompute) {
    const isA = s.measurement.reading.unit === 'A';
    const complete = !unresolved;
    const calc = isA ? buildAmpereLines(ctx, complete) : buildVaLines(ctx, complete);
    if (calc.overflow) {
      // the declared arithmetic left the double range: report at the source field, never a verdict
      ctx.add('OUT_OF_RANGE', isA ? 'measurement.reading.value' : 'measurement.reading.value', 'input');
      ctx.problems = ctx.problems.filter((p) => p.layer !== 'demand');
      result.loadsCoverage = buildCoverage(ctx, false);
    } else {
      const topology = s.supply.topology;
      result.presentation = { topologyLabel: own(TOPOLOGY_LABEL, topology) ? TOPOLOGY_LABEL[topology] : '', showPerConductor: true, polesLabel: polesLabel(topology), finalResultHeading: complete, verdictLabel: null };
      if (!complete) {
        result.demand = { status: 'partial_diagnostic', unit: isA ? 'A' : 'VA', totalVA: null, totalOnConductorA: null, partialSubtotalVA: isA ? null : calc.lines[calc.lines.length - 1].result.value, lines: calc.lines };
        result.existingCapacity = capacityNotAssessed('LOAD_UNRESOLVED');
        if (isA) { for (const [k, v] of calc.totals) result.display.strings[k] = `${formatNumber(v, pa)} A`; }
        else result.display.strings.partialSubtotalVA = `${formatNumber(result.demand.partialSubtotalVA, pv)} VA`;
        result.diagnostics = diagnostics(ctx, { existingComponentVA: isA ? null : calc.comp, existingComponentAOnConductor: isA ? Math.max(...ctx.ampere.readings) * FACTOR_125 : null });
      } else if (isA) {
        result.demand = { status: 'complete', unit: 'A', totalVA: null, totalOnConductorA: calc.gv, partialSubtotalVA: null, lines: calc.lines };
        const modelTopo = own(MODEL_TOPOLOGIES, s.loadModel.kind) ? MODEL_TOPOLOGIES[s.loadModel.kind] : [];
        if (!modelTopo.includes(topology)) ctx.add('MODEL_UNSUPPORTED', 'loadModel.kind', 'current');
        result.existingCapacity = assessCapacity(ctx, [...calc.totals].map(([k, v]) => [k === 'measured' ? null : k, v]));
        result.display.strings.totalOnConductorA = `${formatNumber(calc.gv, pa)} A`;
        for (const [k, v] of calc.totals) result.display.strings[k] = `${formatNumber(v, pa)} A`;
        result.diagnostics = diagnostics(ctx, { existingComponentVA: null, existingComponentAOnConductor: Math.max(...ctx.ampere.readings) * FACTOR_125 });
        result.references = [{ ruleRef: RULE_87, amended: true, href: null }];
      } else {
        result.demand = { status: 'complete', unit: 'VA', totalVA: calc.total, totalOnConductorA: null, partialSubtotalVA: null, lines: calc.lines };
        const cur = computeCurrent(ctx, calc.total);
        if (cur && !isNum(cur.lineA)) { ctx.add('OUT_OF_RANGE', 'measurement.reading.value', 'input'); }
        if (cur && isNum(cur.lineA)) {
          result.current = { status: 'computed', model: cur.model, formula: cur.formula, assumptions: cur.assumptions.slice(), perConductorA: cur.per, lineA: cur.lineA, neutralA: null, note: NOTE_NEUTRAL };
          result.existingCapacity = assessCapacity(ctx, [[null, cur.lineA]]);
        } else result.existingCapacity = assessCapacity(ctx, null);
        result.display.strings.totalVA = `${formatNumber(calc.total, pv)} VA`;
        if (result.current.status === 'computed') result.display.strings.lineA = `${formatNumber(cur.lineA, pa)} A`;
        result.display.strings.existingComponentVA = `${formatNumber(calc.comp, pv)} VA`;
        result.diagnostics = diagnostics(ctx, { existingComponentVA: calc.comp, existingComponentAOnConductor: null });
        result.references = [{ ruleRef: RULE_87, amended: true, href: null }];
      }
    }
  }

  const status = statusOf(ctx, result.loadsCoverage.some((c) => c.coverage === 'unresolved'));
  if (status !== 'COMPLETE' && status !== 'PARTIAL') {
    // rows 1-6 clear every operative layer; a current/capacity-layer echo may still name the blocked layer
    result.demand = emptyDemand(); result.current = emptyCurrent(); result.existingCapacity = capacityNotAssessed(blockingCode(ctx));
    result.diagnostics = { operative: false }; result.display.strings = {}; result.presentation = defaultPresentation(); result.references = [];
  }
  result.status = status;
  result.presentation.finalResultHeading = status === 'COMPLETE';
  result.presentation.verdictLabel = status === 'COMPLETE' ? result.existingCapacity.status : null;
  result.problems = sortProblems(ctx.problems);
  return clone(result);
}

module.exports = {
  evaluate, PROFILE, formatNumber, fmtG, SQRT3, FACTOR_125, TOPOLOGY_LABEL, MODEL_TOPOLOGIES, PENDING_RULE_LABEL,
  NOTE_NEUTRAL, NOTE_REQUIRED_CAPACITY, NOTE_RATING, LoadCalcEnvelopeError,
};
