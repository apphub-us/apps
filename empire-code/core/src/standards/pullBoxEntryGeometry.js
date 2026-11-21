'use strict';
/**
 * Empire Code — Pull Box ENTRY GEOMETRY resolver (Layer 0). PBV2-13B-2.
 *
 * Answers one domain question for Layer 2:
 *   "For this raceway entry system and trade size, what circular
 *    code-measurement boundary can the NEC layout solver safely use?"
 *
 * It returns a diameter WITH ITS MEANING: the physical facts it rests on,
 * their sources, the datum policy applied, and whether the result is
 * DIRECT (exact relative to its input) or CONSERVATIVE.
 *
 * WHAT THIS MODULE DOES NOT DO
 *  - No NEC rules, no 6x / 8x, no pull classification, no box sizing,
 *    no layout solving. It never looks at rows, connections, or the UI.
 *  - No runtime lookups: every factual value ships in this file.
 *  - No guessing: a trade size is NEVER used as a physical diameter, and an
 *    unsupported combination fails with an explicit status.
 *
 * THE DATUM AMBIGUITY (kept explicit, not "resolved")
 *  Authoritative explanatory material agrees that 314.28(A)(2) spacing is
 *  measured at the raceway ENTRIES, never at locknuts or bushings. It does
 *  NOT settle whether the boundary is the raceway body's outside diameter or
 *  the enclosure opening the entry passes through. Layer 0 therefore stores
 *  both physical facts separately and applies a CONSERVATIVE datum policy:
 *      entryMeasurementDiameterIn = max(raceway OD, enclosure opening)
 *  A larger measurement boundary can only enlarge the required centre
 *  separation in Layer 2 (its feasible region shrinks monotonically with
 *  every radius), so the larger candidate is safe under EITHER reading.
 *  Consequently NO standards-resolved result is ever labelled DIRECT here;
 *  only an explicit caller-supplied diameter is.
 *
 * SUPPORTED ENTRY SYSTEMS (first honest subset)
 *  Every supported system penetrates the enclosure through a knockout of
 *  the raceway's trade size (connector, threaded conduit with locknuts, or
 *  a hub through a knockout). For all of them the opening that bounds the
 *  entry is the knockout itself, and anything passing through a hole is no
 *  larger than the hole — so the knockout MAXIMUM diameter (NEMA Bulletin
 *  71, Table 71-1A) is an upper bound for both candidate datums. Cast boxes
 *  with integral threaded bosses are a different system and are reported as
 *  UNSUPPORTED_SYSTEM rather than approximated.
 *
 * UNITS: inches. Source values are stored as decimal STRINGS exactly as
 * published (no binary-float artefacts in canonical data); metric columns
 * of the sources are not used, so no conversion is performed.
 */

// ── canonical trade-size keys (same format as the Layer-1 engine) ─────────
const TRADE_SIZE_KEYS = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4', '5', '6'];

// ── source registry: every data row points at one of these ───────────────
const SOURCES = {
  'NEMA-EB71-T71-1A': {
    authority: 'NEMA (National Electrical Manufacturers Association)',
    document: 'Engineering Department Bulletin No. 71 — Knockout Diameters and Fitting Dimensions',
    edition: 'June 1965, revised September 9, 2004, reaffirmed 12/2011',
    location: 'Table 71-1A (knockout diameters, minimum / nominal / maximum)',
    facts: 'enclosure knockout diameters by trade size; sizes 1/2–1-1/4 cite UL 514 Table 20.2',
  },
  'NEMA-EB71-T71-1C': {
    authority: 'NEMA (National Electrical Manufacturers Association)',
    document: 'Engineering Department Bulletin No. 71 — Knockout Diameters and Fitting Dimensions',
    edition: 'June 1965, revised September 9, 2004, reaffirmed 12/2011',
    location: 'Table 71-1C (metallic conduit dimensions for reference), column 10',
    facts: 'maximum outside diameter of rigid metal conduit, per ANSI C80.1',
  },
  'WHEATLAND-RMC-ANSI-C80.1': {
    authority: 'Wheatland Tube (manufacturer), citing ANSI C80.1 / UL 6',
    document: 'Rigid Metal Conduit submittal sheet',
    edition: '2018 (WEL series)',
    location: 'Rigid Metal Conduit Weights and Dimensions table',
    facts: 'nominal outside diameter; tolerance ±0.015 in (1/2–1-1/2), ±1 % (2–6)',
  },
  'WHEATLAND-IMC-ANSI-C80.6': {
    authority: 'Wheatland Tube (manufacturer), citing ANSI C80.6 / UL 1242',
    document: 'Intermediate Metal Conduit submittal sheet',
    edition: 'WEL-111918',
    location: 'IMC Weights and Dimensions table',
    facts: 'nominal outside diameter (average of UL 1242 maximum and minimum)',
  },
  'WHEATLAND-EMT-ANSI-C80.3': {
    authority: 'Wheatland Tube (manufacturer), citing ANSI C80.3 / UL 797',
    document: 'EMT and Conduit brochure',
    edition: '2018',
    location: 'EMT dimensions table',
    facts: 'nominal outside diameter',
  },
};

// ── physical facts (decimal strings, inches, exactly as published) ────────
/** Enclosure knockout diameter by trade size: NEMA 71-1A min / nominal / max. */
const KNOCKOUT = {
  '1/2':   { min: '0.859', nominal: '0.875', max: '0.906' },
  '3/4':   { min: '1.094', nominal: '1.109', max: '1.141' },
  '1':     { min: '1.359', nominal: '1.375', max: '1.406' },
  '1-1/4': { min: '1.719', nominal: '1.734', max: '1.766' },
  '1-1/2': { min: '1.958', nominal: '1.984', max: '2.016' },
  '2':     { min: '2.433', nominal: '2.469', max: '2.500' },
  '2-1/2': { min: '2.938', nominal: '2.969', max: '3.000' },
  '3':     { min: '3.563', nominal: '3.594', max: '3.625' },
  '3-1/2': { min: '4.063', nominal: '4.125', max: '4.156' },
  '4':     { min: '4.563', nominal: '4.641', max: '4.672' },
  '5':     { min: '5.625', nominal: '5.719', max: '5.750' },
  '6':     { min: '6.700', nominal: '6.813', max: '6.844' },
};
const KNOCKOUT_SOURCE = 'NEMA-EB71-T71-1A';

/** Raceway outside diameter by type and trade size. `max` (RMC only) is the
 *  ANSI C80.1 maximum reported in NEMA 71-1C; `nominal` is the published
 *  nominal value from the manufacturer sheet citing the ANSI standard. */
const RACEWAY_OD = {
  RMC: {
    sourceKey: 'WHEATLAND-RMC-ANSI-C80.1',
    maxSourceKey: 'NEMA-EB71-T71-1C',
    sizes: {
      '1/2':   { nominal: '0.840', max: '0.855' },
      '3/4':   { nominal: '1.050', max: '1.066' },
      '1':     { nominal: '1.315', max: '1.331' },
      '1-1/4': { nominal: '1.660', max: '1.676' },
      '1-1/2': { nominal: '1.900', max: '1.916' },
      '2':     { nominal: '2.375', max: '2.399' },
      '2-1/2': { nominal: '2.875', max: '2.904' },
      '3':     { nominal: '3.500', max: '3.535' },
      '3-1/2': { nominal: '4.000', max: '4.040' },
      '4':     { nominal: '4.500', max: '4.545' },
      '5':     { nominal: '5.563', max: '5.619' },
      '6':     { nominal: '6.625', max: '6.691' },
    },
  },
  IMC: {
    sourceKey: 'WHEATLAND-IMC-ANSI-C80.6',
    sizes: {
      '1/2':   { nominal: '0.815' },
      '3/4':   { nominal: '1.029' },
      '1':     { nominal: '1.290' },
      '1-1/4': { nominal: '1.638' },
      '1-1/2': { nominal: '1.883' },
      '2':     { nominal: '2.360' },
      '2-1/2': { nominal: '2.857' },
      '3':     { nominal: '3.476' },
      '3-1/2': { nominal: '3.971' },
      '4':     { nominal: '4.466' },
    },
  },
  EMT: {
    sourceKey: 'WHEATLAND-EMT-ANSI-C80.3',
    sizes: {
      '1/2':   { nominal: '0.706' },
      '3/4':   { nominal: '0.922' },
      '1':     { nominal: '1.163' },
      '1-1/4': { nominal: '1.510' },
      '1-1/2': { nominal: '1.740' },
      '2':     { nominal: '2.197' },
      '2-1/2': { nominal: '2.875' },
      '3':     { nominal: '3.500' },
      '3-1/2': { nominal: '4.000' },
      '4':     { nominal: '4.500' },
    },
  },
  // PVC: no outside-diameter facts are stored in this milestone. A PVC
  // terminal adapter still enters through a trade-size knockout, so the
  // conservative datum is fully determined by the knockout fact alone.
  PVC: { sourceKey: null, sizes: {} },
};

/** Entry systems this resolver understands. Each maps to how the entry
 *  penetrates the enclosure wall — that, not the raceway type alone, is what
 *  determines the opening geometry. */
const ENTRY_METHODS = {
  KNOCKOUT_CONNECTOR: { penetration: 'KNOCKOUT', description: 'connector (set-screw / compression / adapter) through a trade-size knockout' },
  KNOCKOUT_THREADED:  { penetration: 'KNOCKOUT', description: 'threaded conduit through a trade-size knockout with locknuts' },
  KNOCKOUT_HUB:       { penetration: 'KNOCKOUT', description: 'listed hub mounted through a trade-size knockout' },
  THREADED_BOSS:      { penetration: 'BOSS',     description: 'integral threaded boss of a cast enclosure — not supported yet' },
};
const RACEWAY_TYPES = ['EMT', 'RMC', 'IMC', 'PVC'];
const COMPATIBLE = {
  EMT: ['KNOCKOUT_CONNECTOR'],
  RMC: ['KNOCKOUT_THREADED', 'KNOCKOUT_HUB', 'THREADED_BOSS'],
  IMC: ['KNOCKOUT_THREADED', 'KNOCKOUT_HUB', 'THREADED_BOSS'],
  PVC: ['KNOCKOUT_CONNECTOR'],
};

const DATUM_POLICY = 'MAX_OF_RACEWAY_OD_AND_ENCLOSURE_OPENING';

function isDecimalString(s) { return typeof s === 'string' && /^\d+\.\d{1,6}$/.test(s); }
function isFiniteNumber(x) { return typeof x === 'number' && Number.isFinite(x); }
/** Exact decimal-string comparison via scaled integers (no float compare). */
function cmpDecimal(a, b) {
  const scale = (s) => { const [i, f = ''] = s.split('.'); return BigInt(i + f.padEnd(6, '0')); };
  const x = scale(a); const y = scale(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Resolve the Layer-2 measurement geometry for a real entry system.
 * Returns a status object; never throws for data problems, never guesses.
 */
function resolveEntryGeometry(input) {
  if (!input || typeof input !== 'object') return { status: 'INVALID_INPUT', reason: 'OBJECT_REQUIRED' };
  const { tradeSize, racewayType, entryMethod } = input;
  if (typeof tradeSize !== 'string' || !TRADE_SIZE_KEYS.includes(tradeSize)) {
    return { status: 'INVALID_INPUT', reason: 'TRADE_SIZE_KEY', tradeSize };
  }
  if (!RACEWAY_TYPES.includes(racewayType)) return { status: 'UNSUPPORTED_SYSTEM', reason: 'RACEWAY_TYPE', racewayType };
  if (!ENTRY_METHODS[entryMethod]) return { status: 'UNSUPPORTED_SYSTEM', reason: 'ENTRY_METHOD', entryMethod };
  if (!COMPATIBLE[racewayType].includes(entryMethod)) {
    return { status: 'UNSUPPORTED_SYSTEM', reason: 'INCOMPATIBLE_COMBINATION', racewayType, entryMethod };
  }
  if (ENTRY_METHODS[entryMethod].penetration !== 'KNOCKOUT') {
    // a threaded boss has no knockout: its opening is the thread itself and
    // the datum question is different — explicitly unsupported for now
    return { status: 'UNSUPPORTED_SYSTEM', reason: 'PENETRATION_NOT_MODELLED', entryMethod };
  }
  // raceway must exist in this trade size for the system to be real
  const odTable = RACEWAY_OD[racewayType];
  const odRow = odTable.sizes[tradeSize];
  if (racewayType !== 'PVC' && !odRow) {
    return { status: 'UNSUPPORTED_SIZE', reason: 'RACEWAY_NOT_MADE_IN_SIZE', racewayType, tradeSize };
  }
  const ko = KNOCKOUT[tradeSize];
  if (!ko) return { status: 'UNSUPPORTED_SIZE', reason: 'NO_KNOCKOUT_FACT', tradeSize };

  // physical facts, kept separate
  const opening = { value: ko.max, basis: 'MAXIMUM', nominal: ko.nominal, sourceKey: KNOCKOUT_SOURCE };
  let racewayOD = null;
  if (odRow) {
    racewayOD = odRow.max
      ? { value: odRow.max, basis: 'MAXIMUM', nominal: odRow.nominal, sourceKey: odTable.maxSourceKey }
      : { value: odRow.nominal, basis: 'NOMINAL', nominal: odRow.nominal, sourceKey: odTable.sourceKey };
  }
  // datum policy: the larger boundary. With a knockout penetration the
  // opening bounds anything passing through it, and the stored facts agree
  // (this is also pinned in tests) — but the comparison is performed, not
  // assumed, so a future fact that contradicts it would surface.
  let datum = opening.value; let datumFrom = 'ENCLOSURE_OPENING';
  if (racewayOD && cmpDecimal(racewayOD.value, opening.value) > 0) { datum = racewayOD.value; datumFrom = 'RACEWAY_OD'; }
  const assumptions = [
    'DATUM_AMBIGUITY_RACEWAY_OD_VS_OPENING_UNRESOLVED_IN_NEC_TEXT',
    'LARGER_CANDIDATE_BOUNDARY_USED',
    'OPENING_TAKEN_AT_STANDARD_MAXIMUM',
  ];
  if (racewayOD && racewayOD.basis === 'NOMINAL') assumptions.push('RACEWAY_OD_NOMINAL_ONLY_TOLERANCE_NOT_STORED');
  if (!racewayOD) assumptions.push('RACEWAY_OD_NOT_STORED_OPENING_BOUNDS_IT');
  return {
    status: 'CONSERVATIVE',
    resolution: 'CONSERVATIVE',
    entryMeasurementDiameterIn: Number(datum),
    entryMeasurementDiameterDecimal: datum,
    units: 'in',
    datumPolicy: DATUM_POLICY,
    datumFrom,
    facts: { enclosureOpeningDiameterIn: opening, racewayOutsideDiameterIn: racewayOD },
    sourceKeys: [opening.sourceKey].concat(racewayOD ? [racewayOD.sourceKey] : []),
    assumptions,
    supported: { tradeSize, racewayType, entryMethod, penetration: 'KNOCKOUT' },
    physicalFitData: false,   // no locknut / bushing / hub body dimensions are returned here
  };
}

/**
 * Explicit expert / test geometry. Validated, deterministic, and marked
 * USER_SUPPLIED so it can never be mistaken for standards-resolved data.
 */
function explicitEntryGeometry(input) {
  if (!input || typeof input !== 'object') return { status: 'INVALID_INPUT', reason: 'OBJECT_REQUIRED' };
  const d = input.entryMeasurementDiameterIn;
  if (!isFiniteNumber(d)) return { status: 'INVALID_INPUT', reason: 'NON_FINITE_DIAMETER' };
  if (d <= 0) return { status: 'INVALID_INPUT', reason: 'NON_POSITIVE_DIAMETER' };
  if (input.units !== undefined && input.units !== 'in') return { status: 'INVALID_INPUT', reason: 'UNITS_MUST_BE_INCHES' };
  return {
    status: 'RESOLVED',
    resolution: 'DIRECT',
    provenance: 'USER_SUPPLIED',
    entryMeasurementDiameterIn: d,
    units: 'in',
    datumPolicy: 'AS_SUPPLIED',
    facts: null,
    sourceKeys: [],
    assumptions: ['CALLER_ASSERTS_DATUM'],
    physicalFitData: false,
  };
}

/** Build the Layer-2 geometry object for a whole request from per-entry
 *  system specs ({ [entryId]: { tradeSize, racewayType, entryMethod } } or
 *  { entryMeasurementDiameterIn }). Fails as a whole if any entry fails. */
function buildLayoutGeometry(specs) {
  const entries = {}; const provenance = {}; const failures = [];
  for (const [entryId, spec] of Object.entries(specs || {})) {
    const r = spec && spec.entryMeasurementDiameterIn !== undefined
      ? explicitEntryGeometry(spec) : resolveEntryGeometry(spec);
    if (r.status !== 'CONSERVATIVE' && r.status !== 'RESOLVED') { failures.push({ entryId, ...r }); continue; }
    entries[entryId] = { entryMeasurementDiameterIn: r.entryMeasurementDiameterIn };
    provenance[entryId] = r;
  }
  if (failures.length > 0) return { ok: false, failures };
  const anyConservative = Object.values(provenance).some((p) => p.resolution === 'CONSERVATIVE');
  return {
    ok: true,
    geometry: { units: 'in', entries, datumPolicy: anyConservative ? 'CONSERVATIVE' : 'USER_SUPPLIED' },
    provenance,
  };
}

module.exports = {
  resolveEntryGeometry,
  explicitEntryGeometry,
  buildLayoutGeometry,
  TRADE_SIZE_KEYS,
  RACEWAY_TYPES,
  ENTRY_METHODS,
  DATUM_POLICY,
  _data: { SOURCES, KNOCKOUT, KNOCKOUT_SOURCE, RACEWAY_OD, COMPATIBLE },
};
