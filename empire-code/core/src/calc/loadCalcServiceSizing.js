'use strict';
/**
 * Empire Code — Load Calc service sizing PROTOTYPE (LC-SERVICE-SIZING-1 R2, bounded engineering foundation).
 *
 * analyzePrototype(request, design?) → frozen, NON-OPERATIVE analysis:
 *   calculated load (unchanged facade) → minimum STANDARD service-disconnect rating candidate → explicit chosen-main
 *   assessment → UNGROUNDED conductor table lookup (general_table_75C or conditional dwelling_83pct_310_12) →
 *   220.82(A) qualification-consistency status.
 *
 * This is tested software logic, not an approved electrical instruction. Every result (including refusals and the
 * error thrown on an unexpected fault) carries operative:false, installationApproved:false and
 * globalCodeCompliance:'not_verified'. The NEC 2020 primary text for this bounded one-family 120/240 V profile was
 * received as owner-supplied excerpts (reviewer-transcribed; image ids/hashes in SOURCES). That source receipt is kept
 * separate from interpretation status and from any site/device approval (docs/load-calc-service-sizing-1.md).
 * Nothing in a request, a design object or the environment can promote a result: there is no production flag, bypass
 * or attestation shortcut.
 *
 * Boundaries:
 *   - the demand/current come ONLY from loadCalcFacade.evaluateV2(request) called here on the caller's V2 request; no
 *     displayed/forged value is accepted as a source, and the comparison uses the engine's exact E4 total, never lineA;
 *   - optional82.conductorAmpacityA is echoed as a 220.82(A) qualification input only — never a breaker or installed
 *     rating — and is never replaced by a table candidate; a mismatch is reported, not repaired;
 *   - the design object is separate data: it never enters the request, the calculation or any stored format;
 *   - inputs are never mutated; the returned object is deep-frozen.
 * Not wired to the UI or the bundle. Does not use wireSizing.selectConductor.
 */
const F = require('./loadCalcFacade.js');
const V2 = require('./loadCalcInputV2.js');

const PROTOTYPE_ID = 'LC-SERVICE-SIZING-1-prototype';
const RULE_REVIEW = 'SCOPED_PRIMARY_TEXT_RECEIVED_INTERPRETATION_OPEN';
const E4 = V2.E4;
const VOLTS_LL = 240;
const FLOOR_A = 100;
const B82_QUALIFICATION_GATE_A = 100;

const deepFreeze = (v) => { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); } return v; };

const SAFETY_FLAGS = deepFreeze({ operative: false, ruleReview: RULE_REVIEW, installationApproved: false, globalCodeCompliance: 'not_verified' });

const OWNER_EXCERPT = 'NEC 2020 excerpt from the owner-supplied screenshot set (2026-09-30), transcribed visually by the coordinating reviewer; sha256 over the original PNG bytes recorded by the coordinator; image bytes not present in this sandbox';
const primary = (image, fileId, sha256, clauses, role) => ({ kind: 'nec2020_primary_excerpt', image, fileId, sha256, clauses, provenance: OWNER_EXCERPT, role });

/** Evidence register (engine-owned; not configurable). P_* are the received primary excerpts; S2–S5 are history only. */
const SOURCES = deepFreeze({
  P_230_42: primary('2026-09-30 3.40.25 PM', 'file_0000000065f8820ca45da9b669d0e9d6', '24a7b808dfa67b23e2bda0ea05b91df0c4d437171fc50f9f7e15026d03658dde', ['230.42(A)-(C)'], 'service-entrance ampacity not less than the applicable load; refers to 110.14(C); no single generic multiplier for every Article 220 method'),
  P_230_79: primary('2026-09-30 3.41.31 PM', 'file_00000000a2c881f6a9e51e584fae6815', '4d63d2ec6426e105a4914492f7465feb20af29691f791ed21e8f3d17bcdc0ff8', ['230.79(A)-(D)'], 'disconnect rating not less than the calculated load; one-family dwelling minimum 100 A, 3-wire (230.79(C)); does not select equipment'),
  P_230_90: primary('2026-09-30 3.41.54 PM', 'file_00000000b5e081f694b6630f049962c3', 'f90d7a46434654111477f5bf8adbb3d595bcabe61ae022f676f1e13667fc643f', ['230.90(A) and Exceptions 1-5', '230.90(B)'], 'general ungrounded-conductor overload rule; Exception 5 permits qualifying 120/240 V 3-wire dwelling service protection per 310.12'),
  P_240_6: primary('2026-09-30 3.43.06 PM', 'file_00000000c42c81f6a4dc30632f1dcbb5', 'f7f4932f9c6b2f5386e0ec462c384482351924d3e4d25252c71d1889122bb6af', ['240.6(A)', 'Table 240.6(A)'], 'standard ratings include 100,110,125,150,175,200,225,250,300,350,400 A; other and nonstandard ratings exist; adjustable trip not implemented'),
  P_110_14_INTRO: primary('2026-09-30 3.44.03 PM', 'file_00000000b29c81f698a9f4d6152db7af', '1ff4a26a11479a4097ed5ff42f8b14f06fc00ff7e781709861733111567f22da', ['110.14 introduction'], 'terminal/conductor material compatibility (dissimilar metals, identified terminals)'),
  P_110_14_AB: primary('2026-09-30 3.44.22 PM', 'file_00000000de0c81f6bc7c418da5d5014a', '32d10fc3891325853d1bc24a45c1a543a264b4e79580012bf53045bdf2538cd8', ['110.14(A)', '110.14(B)', '110.14(C) opening only'], 'partial excerpt; 110.14(C) is taken from the complete P_110_14_C page'),
  P_110_14_C: primary('2026-09-30 3.57.55 PM', 'file_000000004c4081f6af9521a0953902a6', 'a6a5fea44ff8d44e5ef032da02fa6960ca0f0aa01d91801f82733f7c567c2cbc', ['110.14(C)', '110.14(C)(1)(a)/(b)', '110.14(C)(2)', '110.14(D) (adjacent)'], 'lowest connected temperature rating governs; (C)(1) references Table 310.16 as appropriately modified by 310.12; 75 °C use depends on listed/identified terminals; torque (D) is an equipment check'),
  P_310_16_COND: primary('2026-09-30 3.45.37 PM', 'file_000000001f5c81f68d8f9c7be524a204', 'a03518871f7a0b7d7138bdb510baed2ec8d00e6a08ee34c3e1d48aa433fdb820', ['310.16 applicability conditions'], '30 °C ambient, not more than three current-carrying conductors; corrections/adjustments otherwise'),
  P_310_16_TABLE: primary('2026-09-30 3.57.00 PM', 'file_00000000797481f6ae1acd3b993caf51', '670f4f456f5a36d6c769113942b43f4e3a98c9ee319bb3cc369e812d6d2112fc', ['Table 310.16'], 'full Cu/Al 60/75/90 °C table with notes; only the 75 °C Cu/Al rows are used here'),
  P_310_12_A: primary('2026-09-30 3.46.11 PM', 'file_0000000029ac81f69ef8d95765730549', '2ae21110171e17ffdaccc873fe7a99a01e09d40e7e1c289c07cfb1c317992c62', ['310.12 opening'], 'qualifying 100-400 A dwelling services supplying the entire dwelling load: ampacity not less than 83 % of the SERVICE RATING; its 208Y/120 feeder paragraph does not activate a 120/208 service path here'),
  P_310_12_B: primary('2026-09-30 3.46.33 PM', 'file_0000000028d081f6b87b1b912b059d03', '0d0e831e18ce7da25a5c814e2a7349d3284fe82140cbd704acb4b5b67d1c81de', ['310.12(A)-(D)', 'Table 310.12'], 'direct Table 310.12 lookup where no adjustment or correction is required; not 83 % of calculated load or of a breaker'),
  S1: { kind: 'nyc_amendment_layer', title: 'NYC Electrical Code 2025: NEC 2020 with NYC amendments (source cover date 2025-12-21; not a claim about enactment history)', url: 'https://www.nyc.gov/assets/buildings/codes-pdf/2025electrical_code.pdf', role: 'amendment layer re-opened 2026-09-30: 230.42 adds (D)/(E) (not implemented); 230.43 replaced (condition-dependent methods; site review); 310.16 amendment deletes XHWN from 90 °C columns only; 330.12 prohibits Type MC service conductors; no amendment of 230.79, 230.90, 240.6(A), 110.14(C) or 310.12 found' },
  S2: { kind: 'historical_corroboration', title: 'Schneider Electric FAQ FA144510 (modified 2022)', url: 'https://www.se.com/us/en/faqs/FA144510/', role: 'historical manufacturer corroboration of 110.14(C) practice only; not a code text and never the sole source of a verified row' },
  S3: { kind: 'historical_corroboration', title: 'Schneider Electric conductor ampacity table based on the 2017 NEC', url: 'https://productinfo.se.com/na-std-ref/viewer/5c0fee4b347bdf0001de4d55/5c0fee5b347bdf0001de4d6b/r/ConductorAmpacityBasedOnThe2017Nati-F20AB318', role: 'historical manufacturer corroboration of the 75 °C column; NOT a NEC 2020 primary source; superseded by P_310_16_TABLE' },
  S4: { kind: 'historical_corroboration', title: 'Tesla Energy Library — Power Control System compliance guidance', url: 'https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/General/Compliance/PowerControlSystemFeatures/en-us/GUID-FBF13A19-2F79-496B-9E65-245EC489B286.html', role: 'historical manufacturer mention of the 100 A one-family minimum; superseded by P_230_79; its 80 % PCS setting is not a sizing formula' },
  S5: { kind: 'historical_access_attempt', title: 'NFPA 70 (2020) free access', url: 'https://link.nfpa.org/free-access/publications/70/2020', role: 'R1 access attempt returned no readable clause text; history only' },
  ENGINE_B82: { kind: 'accepted_engine', title: 'Accepted engine B82_core1 via loadCalcFacade.evaluateV2 (unchanged)', url: null, role: 'calculated load, 220.82(A) qualification gate (conductorAmpacityA >= 100 A, software gate) and current availability' },
  PROTOTYPE_SCOPE: { kind: 'product_scope', title: 'LC-SERVICE-SIZING-1 bounded scope decision', url: null, role: 'deliberate prototype limit, not a normative statement' },
});

/** Stage-level source evidence: primary-text receipt, interpretation and approval are separate fields. */
const STAGE_EVIDENCE = deepFreeze({
  minimumService: {
    primaryText: 'source_verified_bounded_profile', sourceIds: ['P_230_79', 'P_240_6', 'P_230_42', 'S1'],
    facts: ['230.79(C) one-family dwelling minimum 100 A, 3-wire', '230.79 rating not less than the calculated load', 'Table 240.6(A) includes the 100-400 A ratings of the product subset'],
    interpretation: 'applied: least subset rating R >= 100 A with exact totalExactE4 <= R x 240 V x 1e4',
    productScope: 'the 100-400 A subset is a product limit; 240.6 permits other and nonstandard ratings',
    installationApproval: 'not_approved',
  },
  chosenMain: {
    primaryText: 'source_verified_bounded_profile', sourceIds: ['P_240_6', 'P_230_79', 'P_230_90'],
    interpretation: 'explicit caller choice compared with the minimum; not an equipment, listing or breaker approval',
    installationApproval: 'not_approved',
  },
  general_table_75C: {
    primaryText: 'source_verified_bounded_profile', sourceIds: ['P_310_16_TABLE', 'P_310_16_COND', 'P_110_14_C', 'P_230_42', 'P_230_90', 'S1'],
    interpretation: 'general rule: least 75 °C Table 310.16 ampacity >= selected rating; no 240.4(B) next-size exception',
    installationApproval: 'not_approved',
  },
  dwelling_83pct_310_12: {
    primaryText: 'source_verified_bounded_profile', sourceIds: ['P_310_12_A', 'P_310_12_B', 'P_230_90', 'P_110_14_C', 'P_310_16_TABLE', 'S1'],
    interpretation: 'conditional direct Table 310.12 lookup for the selected rating (230.90 Exception 5, 110.14(C)(1)); the 83 % applies to the service rating only; consistency with the B82 qualification premise is reported separately',
    installationApproval: 'not_approved',
  },
  qualificationConsistency: {
    primaryText: 'engine_owned_220_82', sourceIds: ['ENGINE_B82'],
    interpretation: 'software model contract: the declared qualification ampacity is compared with the candidate 75 °C table ampacity; never replaced here',
    installationApproval: 'not_approved',
  },
});

const OPEN_INTERPRETATION_ITEMS = deepFreeze([
  '310.12 / 230.90 Exception 5 / 110.14(C)(1) conditional conductor sizing versus the accepted B82 software gate optional82.conductorAmpacityA >= 100 A (model/premise contract; no caller flag resolves it)',
  'a table candidate whose 75 °C ampacity differs from the declared 220.82(A) qualification ampacity requires deliberate caller revalidation of the calculation',
  'NYC-replaced 230.43 service wiring-method applicability: the generic raceway input is not verification of site method eligibility',
  'terminal listing/identification (60/75 °C marking, 110.14(C)(1)(a)/(b), separate connectors 110.14(C)(2)) and torque (110.14(D)) remain equipment checks',
]);
const SOURCE_REVIEW = deepFreeze({
  status: RULE_REVIEW,
  primaryText: 'received_for_bounded_profile',
  primaryTextComplete: true,
  interpretation: 'bounded_with_open_items',
  installationApproval: 'not_approved',
  globalCodeCompliance: 'not_verified',
  closed: false,
  stages: STAGE_EVIDENCE,
  openInterpretation: OPEN_INTERPRETATION_ITEMS,
  warning: 'Non-operative prototype: NEC 2020 primary text for the bounded one-family 120/240 V profile was received (owner-supplied excerpts, reviewer-transcribed); interpretation items remain open and no result is an installation instruction, device selection or code-compliance approval.',
});

/** Primary-table data for this bounded profile (P_240_6, P_310_16_TABLE, P_310_12_B). Sizes: AWG, or kcmil for 3 digits. */
const STANDARD_RATINGS_SUBSET = deepFreeze([100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400]);
const TABLE_310_16_75C = deepFreeze({
  Cu: [['4', 85], ['3', 100], ['2', 115], ['1', 130], ['1/0', 150], ['2/0', 175], ['3/0', 200], ['4/0', 230], ['250', 255], ['300', 285], ['350', 310], ['400', 335], ['500', 380], ['600', 420]],
  Al: [['2', 90], ['1', 100], ['1/0', 120], ['2/0', 135], ['3/0', 155], ['4/0', 180], ['250', 205], ['300', 230], ['350', 250], ['400', 270], ['500', 310], ['600', 340], ['700', 375], ['750', 385], ['800', 395], ['900', 425]],
});
/** Table 310.12 rows [ratingA, Cu, Al/Cu-clad Al]; only 'Al' is accepted as material (Cu-clad Al is not validated here). */
const TABLE_310_12 = deepFreeze([[100, '4', '2'], [110, '3', '1'], [125, '2', '1/0'], [150, '1', '2/0'], [175, '1/0', '3/0'], [200, '2/0', '4/0'], [225, '3/0', '250'], [250, '4/0', '300'], [300, '250', '350'], [350, '350', '500'], [400, '400', '600']]);
const NOT_SIZED = deepFreeze(['neutral (grounded) conductor', 'equipment grounding conductor', 'grounding electrode conductor', 'bonding jumpers', 'conduit/raceway', 'parallel conductor sets', 'short-circuit current withstand', 'voltage drop (incl. NYC 215.2(A)(1) combined limit)', 'terminal torque (110.14(D))', 'utility service requirements', 'equipment listing', 'final equipment/model selection']);
const REMAINING_CHECKS = deepFreeze([
  'equipment listing and labeling for the chosen rating',
  'lug/terminal size range, material and temperature marking of every termination (110.14(C)(1)(a)/(b), separate connectors 110.14(C)(2))',
  'terminal torque per 110.14(D) (not calculated)',
  'service equipment and main OCPD selection (the minimum is a standard-rating candidate, not an approved breaker)',
  'available fault current from the utility and equipment interrupting/short-circuit current ratings',
  'utility service requirements (metering, service lateral/drop, point of connection)',
  'NYC 230.43 (locally replaced) service wiring-method applicability: the generic raceway input is not verified NYC method eligibility',
  'NYC local code amendments not implemented here (e.g. 230.42(D) busway, (E) >= 1000 kVA) and DOB filing requirements',
  'site conditions: actual ambient, raceway fill, routing, conductor count, physical protection',
  '220.82(A) qualification revalidation whenever the installed conductor ampacity differs from the declared qualification ampacity',
  'neutral, grounding, bonding and voltage-drop design (not produced here)',
]);

// ── design contract (separate from the calculation request; never persisted into lcv3) ──
const DESIGN_KEYS = ['selectedMainRatingA', 'plan', 'conductor'];
const PLAN_KEYS = ['intent', 'oneMainDisconnect', 'noAdditionalSources', 'wholeDwelling', 'singleConductorSet'];
const CONDUCTOR_KEYS = ['sizingPath', 'material', 'terminationTempRatingC', 'terminationMaterialCompatible', 'insulationTempRatingC', 'ambientTempC', 'currentCarryingConductors', 'wiringMethod', 'noOtherAdjustmentOrCorrection'];
const BOOL_FIELDS = new Set(['plan.oneMainDisconnect', 'plan.noAdditionalSources', 'plan.wholeDwelling', 'plan.singleConductorSet', 'conductor.terminationMaterialCompatible', 'conductor.noOtherAdjustmentOrCorrection']);
const NUM_FIELDS = new Set(['selectedMainRatingA', 'conductor.terminationTempRatingC', 'conductor.insulationTempRatingC', 'conductor.ambientTempC', 'conductor.currentCarryingConductors']);
const STR_FIELDS = new Set(['plan.intent', 'conductor.sizingPath', 'conductor.material', 'conductor.wiringMethod']);
const SIZING_PATHS = ['general_table_75C', 'dwelling_83pct_310_12'];

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function reason(stage, code, field, sourceIds, sections, message) {
  return { stage, code, field, sourceIds, sections, message };
}

/** Structural/type validation of the design object. Returns { values: Map(path → value|null), problems[] }. */
function readDesign(design) {
  const values = new Map(); const problems = [];
  const bad = (field, code, message) => problems.push(reason('design', code, field, ['PROTOTYPE_SCOPE'], [], message));
  if (design === undefined || design === null) return { values, problems };
  if (!isPlain(design)) { bad('design', 'DESIGN_NOT_OBJECT', 'design must be a plain object or null'); return { values, problems }; }
  const walk = (obj, prefix, allowed) => {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) bad(prefix ? `${prefix}.${k}` : k, 'DESIGN_UNKNOWN_KEY', `unknown design key "${k}" (no field can enable a production path, verify a source or revalidate a qualification)`);
    for (const k of Object.getOwnPropertySymbols(obj)) bad(prefix || 'design', 'DESIGN_UNKNOWN_KEY', `symbol key ${String(k)} not allowed`);
  };
  walk(design, '', DESIGN_KEYS);
  const take = (path, v) => {
    if (v === undefined || v === null) { values.set(path, null); return; }
    if (BOOL_FIELDS.has(path)) { if (typeof v !== 'boolean') bad(path, 'INVALID_BOOLEAN', `${path} must be true, false or null`); else values.set(path, v); return; }
    if (NUM_FIELDS.has(path)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) bad(path, 'INVALID_NUMBER', `${path} must be a finite number or null`);
      else if (v < 0 || Object.is(v, -0)) bad(path, 'NEGATIVE_NUMBER', `${path} must not be negative`);
      else values.set(path, v);
      return;
    }
    if (STR_FIELDS.has(path)) { if (typeof v !== 'string' || v.length === 0) bad(path, 'INVALID_STRING', `${path} must be a non-empty string or null`); else values.set(path, v); }
  };
  take('selectedMainRatingA', design.selectedMainRatingA);
  for (const [group, keys] of [['plan', PLAN_KEYS], ['conductor', CONDUCTOR_KEYS]]) {
    const g = design[group];
    if (g === undefined || g === null) { for (const k of keys) values.set(`${group}.${k}`, null); continue; }
    if (!isPlain(g)) { bad(group, 'DESIGN_NOT_OBJECT', `${group} must be a plain object or null`); continue; }
    walk(g, group, keys);
    for (const k of keys) take(`${group}.${k}`, g[k]);
  }
  return { values, problems };
}

const calcBasisOf = (request, out) => {
  const r = out.result; const s = request.snapshot;
  const complete = r.status === 'COMPLETE' && r.demand && r.demand.status === 'complete';
  return {
    engine: out.facade.engine, engineProfileId: out.facade.engineProfileId, importGuard: out.facade.importGuard, calcStatus: r.status,
    purpose: s.purpose, occupancy: s.occupancy, topology: s.supply.topology, vLineToLine: s.supply.vLineToLine, method: s.method.selected,
    totalVA: complete && typeof r.demand.totalVA === 'number' ? r.demand.totalVA : null, totalExactE4: complete && Number.isSafeInteger(r.demand.totalExactE4) ? r.demand.totalExactE4 : null,
    totalVADisplay: complete && r.display && r.display.strings ? (r.display.strings.totalVA || null) : null,
    currentStatus: r.current ? r.current.status : null, lineA: r.current && r.current.status === 'computed' ? r.current.lineA : null,
    lineADisplay: r.display && r.display.strings ? (r.display.strings.lineA || null) : null,
    engineProblemCodes: Array.isArray(r.problems) ? r.problems.map((p) => p.code) : [],
  };
};

/** Stage 1: minimum STANDARD service-disconnect rating candidate (eligibility of the calculation + service scope premises). */
function stageMinimum(basis, dv) {
  const st = 'minimumService'; const unsupported = []; const waiting = [];
  const eng = (code, field, message) => unsupported.push(reason(st, code, field, ['ENGINE_B82', 'PROTOTYPE_SCOPE'], ['220.82'], message));
  if (basis.engine !== 'B82' || basis.method !== 'opt_220_82') eng('METHOD_UNSUPPORTED', 'snapshot.method.selected', 'only the opt_220_82 route (engine B82_core1) is in prototype scope; the A / 220.87 route and other methods are not');
  if (basis.purpose !== 'service') eng('PURPOSE_UNSUPPORTED', 'snapshot.purpose', basis.purpose === null ? 'purpose unspecified; only an explicit service is in scope (feeder minima are not inferred)' : `purpose ${basis.purpose} unsupported; only service is in scope (feeder minima are not inferred from 230.79(C))`);
  if (basis.occupancy !== 'dwelling_unit_house') eng('OCCUPANCY_UNSUPPORTED', 'snapshot.occupancy', `occupancy ${basis.occupancy} unsupported; only a one-family dwelling (dwelling_unit_house) is in scope`);
  if (basis.topology !== '1ph_3w_120_240' || basis.vLineToLine !== VOLTS_LL) eng('SUPPLY_UNSUPPORTED', 'snapshot.supply.topology', 'only a single-phase 120/240 V three-wire supply is in scope (no 120/208, three-phase or other)');
  if (basis.engine === 'B82' && basis.calcStatus !== 'COMPLETE') unsupported.push(reason(st, 'CALC_NOT_COMPLETE', 'result.status', ['ENGINE_B82'], ['220.82'], `calculation status ${basis.calcStatus} (${basis.engineProblemCodes.join(', ') || 'no codes'}); a complete 220.82 demand with a confirmed whole-dwelling inventory is required`));
  if (basis.engine === 'B82' && basis.calcStatus === 'COMPLETE' && basis.currentStatus !== 'computed') unsupported.push(reason(st, 'CURRENT_NOT_COMPUTED', 'result.current', ['ENGINE_B82'], [], 'the engine did not compute a current (requires 120/240 V + split_240_balanced_LN + explicit balancedLN); no ampere value is guessed'));
  if (basis.engine === 'B82' && basis.calcStatus === 'COMPLETE' && !Number.isSafeInteger(basis.totalExactE4)) unsupported.push(reason(st, 'CALC_TOTAL_UNAVAILABLE', 'result.demand.totalExactE4', ['ENGINE_B82'], [], 'exact total not available'));
  const prem = [
    ['plan.oneMainDisconnect', 'MULTIPLE_DISCONNECTS_UNSUPPORTED', 'one main service disconnect is required; multiple service disconnects are unsupported', ['230.71', '230.79(C)']],
    ['plan.noAdditionalSources', 'ADDITIONAL_SOURCES_UNSUPPORTED', 'no additional sources (PV/ESS/EMS/generator) is required; interconnected sources are unsupported', ['705', '230.79(C)']],
    ['plan.singleConductorSet', 'PARALLEL_SETS_UNSUPPORTED', 'a single conductor set is required; parallel service sets are unsupported', ['230.42(A)']],
    ['plan.wholeDwelling', 'PARTIAL_DWELLING_UNSUPPORTED', 'the service must supply the one whole dwelling', ['220.82(A)', '310.12(A)']],
  ];
  for (const [path, code, message, sections] of prem) {
    const v = dv.get(path);
    if (v === null || v === undefined) waiting.push(reason(st, 'PREMISE_UNANSWERED', path, ['PROTOTYPE_SCOPE'], sections, `${path} not answered (unknown is never assumed true)`));
    else if (v === false) unsupported.push(reason(st, code, path, ['PROTOTYPE_SCOPE'], sections, message));
  }
  const base = {
    meaning: 'minimum STANDARD service-disconnect rating candidate; not an approved main breaker or equipment selection',
    floorA: FLOOR_A, ratingsSubset: STANDARD_RATINGS_SUBSET, sourceEvidence: STAGE_EVIDENCE.minimumService,
    comparison: 'totalExactE4 <= R x 240 V x 1e4 (exact integers, raw total, no rounding down, no 125 %, no 0.83)',
  };
  if (unsupported.length) return Object.assign({ status: 'unsupported', ratingA: null }, base, { reasons: unsupported.concat(waiting) });
  if (waiting.length) return Object.assign({ status: 'waiting_input', ratingA: null }, base, { reasons: waiting });
  const total = basis.totalExactE4;
  const fits = (R) => total <= R * VOLTS_LL * E4;
  const candidate = STANDARD_RATINGS_SUBSET.find((R) => R >= FLOOR_A && fits(R));
  if (candidate === undefined) {
    return Object.assign({ status: 'unsupported', ratingA: null }, base, { reasons: [reason(st, 'LOAD_EXCEEDS_PROTOTYPE_RANGE', 'result.demand.totalExactE4', ['PROTOTYPE_SCOPE'], ['240.6(A)'], `calculated load ${basis.totalVA} VA exceeds 400 A x 240 V, the end of this product subset; no automatic parallel sets or larger service here (a product scope limit, not a code statement)`)] });
  }
  const governedBy = fits(FLOOR_A) ? 'floor_100A' : 'calculated_load';
  return Object.assign({ status: 'experimental_candidate', ratingA: candidate, governedBy, loadVA: basis.totalVA, loadExactE4: total, rawLoadA: basis.lineA }, base, {
    reasons: [reason(st, 'STANDARD_RATING_CANDIDATE', null, ['P_230_79', 'P_240_6', 'P_230_42', 'PROTOTYPE_SCOPE'], ['230.79(C)', '240.6(A)', '230.42(A)'], `least subset rating >= ${FLOOR_A} A with ${basis.totalVA} VA <= R x 240 V (primary text received for this bounded profile); a standard-rating candidate, not an approved breaker`)],
  });
}

/** Stage 2: explicit chosen main rating (never defaulted, never taken from the qualification ampacity). */
function stageChosen(minimum, dv) {
  const st = 'chosenMain'; const selected = dv.has('selectedMainRatingA') ? dv.get('selectedMainRatingA') : null;
  const ev = { sourceEvidence: STAGE_EVIDENCE.chosenMain };
  if (minimum.status !== 'experimental_candidate') return Object.assign({ status: 'not_evaluated', selectedRatingA: selected }, ev, { reasons: [reason(st, 'MINIMUM_NOT_AVAILABLE', null, ['PROTOTYPE_SCOPE'], [], 'no minimum candidate; the chosen rating cannot be assessed')] });
  const reasons = []; let unsupported = false; let waiting = false;
  const intent = dv.get('plan.intent');
  if (intent === null || intent === undefined) { waiting = true; reasons.push(reason(st, 'PREMISE_UNANSWERED', 'plan.intent', ['PROTOTYPE_SCOPE'], [], 'plan.intent not answered; only new_design_candidate is assessed')); }
  else if (intent !== 'new_design_candidate') { unsupported = true; reasons.push(reason(st, 'INTENT_UNSUPPORTED', 'plan.intent', ['PROTOTYPE_SCOPE'], [], `intent ${intent} unsupported; existing-equipment compatibility is never assessed here and no downgrade is suggested`)); }
  if (selected === null) { waiting = true; reasons.push(reason(st, 'SELECTED_RATING_MISSING', 'selectedMainRatingA', ['PROTOTYPE_SCOPE'], ['240.6(A)'], 'no chosen main rating; it is never defaulted to 100/200 A nor taken from the 220.82(A) qualification ampacity')); }
  else if (!STANDARD_RATINGS_SUBSET.includes(selected)) { unsupported = true; reasons.push(reason(st, 'SELECTED_RATING_UNSUPPORTED', 'selectedMainRatingA', ['PROTOTYPE_SCOPE', 'P_240_6'], ['240.6(A)'], `${selected} A is outside this product scope ${STANDARD_RATINGS_SUBSET.join('/')} A (above 400 A: no automatic parallel sets); 240.6 also has other and nonstandard ratings, so this is a scope refusal, not a statement that the rating is not permitted`)); }
  if (unsupported) return Object.assign({ status: 'unsupported', selectedRatingA: selected }, ev, { reasons });
  if (waiting) return Object.assign({ status: 'waiting_input', selectedRatingA: selected }, ev, { reasons });
  if (selected < minimum.ratingA || !(minimum.loadExactE4 <= selected * VOLTS_LL * E4)) {
    return Object.assign({ status: 'rejected_undersized', selectedRatingA: selected, minimumRatingA: minimum.ratingA }, ev, { reasons: [reason(st, 'SELECTED_RATING_UNDERSIZED', 'selectedMainRatingA', ['P_230_79', 'P_230_42', 'PROTOTYPE_SCOPE'], ['230.79(C)', '230.42(A)'], `${selected} A is below the minimum standard-rating candidate ${minimum.ratingA} A`)] });
  }
  return Object.assign({ status: 'meets_prototype_minimum', selectedRatingA: selected, minimumRatingA: minimum.ratingA }, ev, { reasons: [reason(st, 'SELECTED_AT_OR_ABOVE_MINIMUM', 'selectedMainRatingA', ['P_240_6', 'P_230_90', 'PROTOTYPE_SCOPE'], ['240.6(A)', '230.90'], `${selected} A >= minimum candidate ${minimum.ratingA} A; not an equipment, listing or compliance approval`)] });
}

const sizeUnitOf = (size) => (/^\d{3}$/.test(size) ? 'kcmil' : 'AWG');
const amp75Of = (material, size) => { const row = TABLE_310_16_75C[material].find(([s]) => s === size); return row ? row[1] : null; };

/**
 * Qualification-consistency contract: the declared 220.82(A) qualification ampacity and the candidate 75 °C table ampacity
 * are both retained; nothing is replaced or recalculated here. Equal → premise_unchanged; different but >= the B82 gate →
 * revalidation_required (changed premise, not proved invalid); below the gate → review_required (model interpretation).
 */
function qualificationOf(declared, candidateAmp, path) {
  const st = 'qualificationConsistency';
  const base = {
    declaredQualificationAmpacityA: declared, candidateTableAmpacity75CA: candidateAmp, b82SoftwareGateMinA: B82_QUALIFICATION_GATE_A,
    sourceEvidence: STAGE_EVIDENCE.qualificationConsistency,
    note: 'diagnostic only: the declared premise is never replaced and the calculation is never re-run with changed facts here; a caller revalidates by editing its own request and recalculating',
  };
  if (typeof declared !== 'number' || !Number.isFinite(declared)) {
    return Object.assign({ status: 'review_required' }, base, { reasons: [reason(st, 'QUALIFICATION_PREMISE_UNAVAILABLE', 'snapshot.optional82.conductorAmpacityA', ['ENGINE_B82'], ['220.82(A)'], 'no declared qualification ampacity to compare')] });
  }
  if (candidateAmp < B82_QUALIFICATION_GATE_A) {
    return Object.assign({ status: 'review_required' }, base, { reasons: [reason(st, 'B82_310_12_INTERPRETATION_PENDING', 'snapshot.optional82.conductorAmpacityA', ['ENGINE_B82', 'P_310_12_B', 'P_230_90', 'P_110_14_C'], ['220.82(A)', '310.12', '230.90 Exception 5', '110.14(C)(1)'],
      `the ${path} table candidate has a 75 °C ampacity of ${candidateAmp} A, below the accepted B82 software qualification gate (conductorAmpacityA >= ${B82_QUALIFICATION_GATE_A} A) while the calculation was qualified on ${declared} A; 310.12 conditional sizing and that gate are an open model/premise interpretation item, not a finding against 310.12 use; no caller flag resolves it`)] });
  }
  if (candidateAmp === declared) {
    return Object.assign({ status: 'premise_unchanged' }, base, { reasons: [reason(st, 'QUALIFICATION_PREMISE_UNCHANGED', 'snapshot.optional82.conductorAmpacityA', ['ENGINE_B82'], ['220.82(A)'], `candidate 75 °C table ampacity ${candidateAmp} A equals the declared qualification ampacity ${declared} A`)] });
  }
  return Object.assign({ status: 'revalidation_required' }, base, { reasons: [reason(st, 'QUALIFICATION_PREMISE_CHANGED', 'snapshot.optional82.conductorAmpacityA', ['ENGINE_B82'], ['220.82(A)'],
    `candidate 75 °C table ampacity ${candidateAmp} A differs from the declared qualification ampacity ${declared} A that qualified this calculation; the premise changed (not proved invalid) — revalidate the calculation deliberately before any linked use`)] });
}

const conductorBase = (method) => ({ appliesTo: 'ungrounded conductors only', method, notSized: NOT_SIZED, recommendationAvailable: false, size: null, tableCandidate: null, qualificationConsistency: null });
const notEvaluatedConductors = (reasons) => Object.assign({ status: 'not_evaluated' }, conductorBase(null), { reasons });

/** Stage 3: ungrounded conductor table lookup for the EXPLICIT chosen rating (general_table_75C or dwelling_83pct_310_12). */
function stageConductor(chosen, dv, declaredQualificationA) {
  const st = 'ungroundedConductors';
  if (chosen.status !== 'meets_prototype_minimum') return notEvaluatedConductors([reason(st, 'CHOSEN_MAIN_NOT_ACCEPTED', 'selectedMainRatingA', ['PROTOTYPE_SCOPE'], [], 'conductor analysis requires an explicit chosen rating that meets the minimum candidate')]);
  const pathV = dv.get('conductor.sizingPath');
  const base = conductorBase(SIZING_PATHS.includes(pathV) ? pathV : null);
  const unsupported = []; const waiting = [];
  const need = (path, sections, check) => {
    const v = dv.get(path);
    if (v === null || v === undefined) { waiting.push(reason(st, 'PREMISE_UNANSWERED', path, ['PROTOTYPE_SCOPE'], sections, `${path} not answered (unknown never assumes 75 °C terminals, 30 °C ambient, no correction or a sizing path)`)); return; }
    const bad = check(v); if (bad) unsupported.push(reason(st, bad[0], path, bad[2] || ['PROTOTYPE_SCOPE'], sections, bad[1]));
  };
  need('plan.intent', [], (v) => (v === 'new_design_candidate' ? null : ['INTENT_UNSUPPORTED', `intent ${v} unsupported`]));
  need('conductor.sizingPath', ['310.16', '310.12'], (v) => (SIZING_PATHS.includes(v) ? null : ['SIZING_PATH_UNSUPPORTED', `sizing path ${v} unsupported; only general_table_75C or dwelling_83pct_310_12 (explicit choice, never a default)`]));
  need('conductor.material', ['310.16', '310.12'], (v) => (v === 'Cu' || v === 'Al' ? null : ['MATERIAL_UNSUPPORTED', `material ${v} unsupported; only Cu or Al (Cu-clad Al is not validated by the shared Table 310.12 heading)`]));
  need('conductor.terminationTempRatingC', ['110.14(C)'], (v) => (v === 75 ? null : v === 60
    ? ['TERMINATION_60C_UNSUPPORTED', '60 °C terminations unsupported in this 75 °C-only prototype (60 °C sizing is not implemented)', ['P_110_14_C', 'PROTOTYPE_SCOPE']]
    : ['TERMINATION_TEMP_UNSUPPORTED', `termination rating ${v} °C unsupported; every termination must be explicitly confirmed marked/identified 75 °C (a 90 °C rating does not authorize 90 °C sizing here)`, ['P_110_14_C', 'PROTOTYPE_SCOPE']]));
  need('conductor.terminationMaterialCompatible', ['110.14'], (v) => (v === true ? null : ['TERMINATION_MATERIAL_INCOMPATIBLE', 'terminations not confirmed compatible with the conductor material', ['P_110_14_INTRO', 'PROTOTYPE_SCOPE']]));
  need('conductor.insulationTempRatingC', ['310.16', '110.14(C)'], (v) => (v === 75 || v === 90 ? null : ['INSULATION_TEMP_INSUFFICIENT', `insulation rating ${v} °C unsupported; 75 °C or 90 °C insulation is required (sizing always uses the 75 °C column)`, ['P_110_14_C', 'PROTOTYPE_SCOPE']]));
  need('conductor.ambientTempC', ['310.15(B)', '310.12'], (v) => (v === 30 ? null : ['AMBIENT_UNSUPPORTED', `ambient ${v} °C unsupported; only 30 °C (no correction) is in scope`, ['P_310_16_COND', 'PROTOTYPE_SCOPE']]));
  need('conductor.currentCarryingConductors', ['310.15(C)(1)', '310.12'], (v) => (!Number.isInteger(v) ? ['CCC_INVALID', 'current-carrying conductor count must be an integer'] : v > 3 ? ['CCC_ADJUSTMENT_UNSUPPORTED', `${v} current-carrying conductors require adjustment; unsupported (at most 3)`, ['P_310_16_COND', 'PROTOTYPE_SCOPE']] : v < 2 ? ['CCC_INCONSISTENT', 'a single 120/240 V three-wire set in one raceway carries at least the two ungrounded conductors'] : null));
  need('conductor.wiringMethod', ['230.43', '330.12'], (v) => (v === 'single_insulated_conductors_in_raceway' ? null : v === 'type_MC_cable'
    ? ['WIRING_METHOD_MC_SERVICE_UNSUPPORTED', 'Type MC as service conductors is unsupported (NYC 330.12 amendment)', ['S1', 'PROTOTYPE_SCOPE']]
    : ['WIRING_METHOD_UNSUPPORTED', `wiring method ${v} unsupported; only single insulated conductors in raceway`]));
  need('conductor.noOtherAdjustmentOrCorrection', ['310.15', '310.12'], (v) => (v === true ? null : ['ADJUSTMENT_REQUIRED_UNSUPPORTED', 'another adjustment/correction requirement applies; unsupported (both table paths need none)']));
  if (unsupported.length) return Object.assign({ status: 'unsupported' }, base, { reasons: unsupported.concat(waiting) });
  if (waiting.length) return Object.assign({ status: 'waiting_input' }, base, { reasons: waiting });

  const material = dv.get('conductor.material'); const R = chosen.selectedRatingA; const is31012 = pathV === 'dwelling_83pct_310_12';
  const ev = STAGE_EVIDENCE[pathV];
  let size; let rule; let eightyThreePercentCheck = null; let rowReason;
  if (is31012) {
    const row = TABLE_310_12.find(([rating]) => rating === R);
    if (!row) return Object.assign({ status: 'unsupported' }, base, { reasons: [reason(st, 'NO_TABLE_310_12_ROW', 'selectedMainRatingA', ['P_310_12_B', 'PROTOTYPE_SCOPE'], ['310.12'], `no Table 310.12 row for ${R} A in this product scope`)] });
    size = material === 'Cu' ? row[1] : row[2];
    rule = 'direct Table 310.12 row for the SELECTED service rating; ampacity >= 83 % of that rating (never of the load or a breaker); general ampacity >= rating rule not applied; no 240.4(B)';
    rowReason = `Table 310.12 row ${R} A → ${material} ${size} (conditional table fact, primary text received)`;
  } else {
    const row = TABLE_310_16_75C[material].find(([, amp]) => amp >= R);
    if (!row) return Object.assign({ status: 'unsupported' }, base, { reasons: [reason(st, 'NO_TABLE_CONDUCTOR', 'selectedMainRatingA', ['P_310_16_TABLE', 'PROTOTYPE_SCOPE'], ['310.16'], `no ${material} 75 °C entry >= ${R} A in this scope; no parallel sets`)] });
    size = row[0];
    rule = 'least 75 °C Table 310.16 ampacity >= SELECTED rating; no 240.4(B) next-higher exception; no 310.12 83 %';
    rowReason = `least ${material} 75 °C Table 310.16 ampacity >= chosen ${R} A → ${size}`;
  }
  const ampacity75CA = amp75Of(material, size);
  if (ampacity75CA === null) return Object.assign({ status: 'unsupported' }, base, { reasons: [reason(st, 'TABLE_MAPPING_MISSING', 'conductor.material', ['P_310_16_TABLE'], ['310.16'], `${material} ${size} has no 75 °C Table 310.16 entry in this scope`)] });
  if (is31012) {
    eightyThreePercentCheck = { selectedRatingA: R, thresholdE2: 83 * R, ampacity75CE2: ampacity75CA * 100, satisfied: ampacity75CA * 100 >= 83 * R };
    if (!eightyThreePercentCheck.satisfied) return Object.assign({ status: 'unsupported' }, base, { reasons: [reason(st, 'TABLE_310_12_ARITHMETIC_MISMATCH', 'selectedMainRatingA', ['P_310_12_A', 'P_310_16_TABLE'], ['310.12(A)'], `${material} ${size} at ${ampacity75CA} A is below 83 % of ${R} A`)] });
  }
  const tableCandidate = {
    conditional: true, method: pathV, table: is31012 ? 'Table 310.12' : 'Table 310.16 (75 °C column)', forRatingA: R, material, size, sizeUnit: sizeUnitOf(size), ampacity75CA,
    eightyThreePercentCheck, sourceStatus: 'source_verified_conditional_table_fact', sourceIds: ev.sourceIds,
  };
  const qualificationConsistency = qualificationOf(declaredQualificationA, ampacity75CA, pathV);
  const available = qualificationConsistency.status === 'premise_unchanged';
  const conditions = {
    terminations: '75 °C (all, explicitly confirmed; not inferred from insulation or breaker amperage)',
    insulation: `${dv.get('conductor.insulationTempRatingC')} °C (ampacity from the 75 °C column; no 90 °C ampacity)`,
    ambientC: 30, currentCarryingConductors: dv.get('conductor.currentCarryingConductors'), sets: 1,
    wiringMethod: 'single insulated conductors in raceway (generic input)',
    wiringMethodNote: 'generic raceway input only; NYC-replaced 230.43 permitted-method applicability is a remaining site review, not verified here',
    rule,
  };
  if (is31012) conditions.interpretationNote = 'conditional path: 230.90 Exception 5 and 110.14(C)(1) reference 310.12; consistency with the B82 qualification premise is reported in qualificationConsistency';
  return Object.assign({ status: available ? 'experimental_candidate' : 'table_candidate_conditional' }, base, {
    sizedForRatingA: R, material, recommendationAvailable: available,
    size: available ? size : null, sizeUnit: available ? sizeUnitOf(size) : null, ampacity75CA: available ? ampacity75CA : null,
    tableCandidate, qualificationConsistency, sourceEvidence: ev, conditions,
    reasons: [reason(st, is31012 ? 'TABLE_310_12_CANDIDATE' : 'TABLE_310_16_CANDIDATE', null, ev.sourceIds.concat(['PROTOTYPE_SCOPE']), is31012 ? ['310.12', '230.90 Exception 5', '110.14(C)(1)'] : ['310.16', '110.14(C)', '230.42(A)', '230.90(A)'],
      `${rowReason}; ${available ? 'declared qualification premise unchanged; non-operative candidate' : `candidate withheld as a selection (qualification ${qualificationConsistency.status})`}`)],
  });
}

function envelopeCommon(extra) {
  return Object.assign({ prototypeId: PROTOTYPE_ID }, SAFETY_FLAGS, { sourceReview: SOURCE_REVIEW }, extra, { remainingChecks: REMAINING_CHECKS });
}

/** Thrown only on an unexpected internal fault; carries the safety flags and the source-review warning too. */
class ServiceSizingPrototypeError extends Error {
  constructor(message, cause) {
    super(`${message} [${SOURCE_REVIEW.warning}]`);
    this.name = 'ServiceSizingPrototypeError';
    this.cause = cause;
    Object.assign(this, SAFETY_FLAGS); this.sourceReview = SOURCE_REVIEW;
  }
}

/**
 * analyzePrototype(request, design?) — NON-OPERATIVE prototype analysis. request: the caller's current V2 request
 * (evaluated here through the unchanged facade). design: { selectedMainRatingA, plan{...}, conductor{...} } | null.
 */
function analyzePrototype(request, design) {
  try {
    const { values: dv, problems: designProblems } = readDesign(design);
    let out;
    try { out = F.evaluateV2(request); } catch (e) {
      if (!e || e.name !== 'LoadCalcEnvelopeError') throw e;
      const errs = Array.isArray(e.errors) ? e.errors.slice(0, 20).map(String) : [String(e.message)];
      return deepFreeze(envelopeCommon({
        status: 'REQUEST_INVALID', calcBasis: null, qualificationEcho: null,
        minimumService: { status: 'not_computed', ratingA: null, reasons: [reason('request', 'REQUEST_STRUCTURALLY_INVALID', 'request', ['ENGINE_B82'], [], `the V2 request failed the accepted boundary: ${errs.join('; ')}`)] },
        chosenMain: { status: 'not_evaluated', selectedRatingA: null, reasons: [] },
        ungroundedConductors: notEvaluatedConductors([]),
        designProblems,
      }));
    }
    const basis = calcBasisOf(request, out);
    const q = request.snapshot.optional82 && request.snapshot.optional82.conductorAmpacityA ? request.snapshot.optional82.conductorAmpacityA.value : null;
    const qualificationEcho = { conductorAmpacityA: q, role: '220.82(A) qualification input only; not a main breaker, installed service or conductor sizing value; never replaced by a table candidate' };
    if (designProblems.length) {
      return deepFreeze(envelopeCommon({
        status: 'DESIGN_INVALID', calcBasis: basis, qualificationEcho,
        minimumService: { status: 'not_computed', ratingA: null, reasons: [reason('design', 'DESIGN_INVALID', 'design', ['PROTOTYPE_SCOPE'], [], 'design input invalid; no rating or conductor output')] },
        chosenMain: { status: 'not_evaluated', selectedRatingA: null, reasons: [] },
        ungroundedConductors: notEvaluatedConductors([]),
        designProblems,
      }));
    }
    const minimumService = stageMinimum(basis, dv);
    const chosenMain = stageChosen(minimumService, dv);
    const ungroundedConductors = stageConductor(chosenMain, dv, q);
    return deepFreeze(envelopeCommon({ status: 'EVALUATED', calcBasis: basis, qualificationEcho, minimumService, chosenMain, ungroundedConductors, designProblems }));
  } catch (e) {
    if (e instanceof ServiceSizingPrototypeError) throw e;
    throw new ServiceSizingPrototypeError(`service sizing prototype fault: ${e && e.message}`, e);
  }
}

module.exports = {
  analyzePrototype, ServiceSizingPrototypeError, PROTOTYPE_ID, SAFETY_FLAGS, SOURCES, SOURCE_REVIEW, STAGE_EVIDENCE, OPEN_INTERPRETATION_ITEMS,
  STANDARD_RATINGS_SUBSET, TABLE_310_16_75C, TABLE_310_12, B82_QUALIFICATION_GATE_A, NOT_SIZED, REMAINING_CHECKS,
};
