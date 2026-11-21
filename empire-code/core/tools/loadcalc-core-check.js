#!/usr/bin/env node
'use strict';
/**
 * loadcalc-core-check.js — B1 test tool (NOT runtime code, NOT registered in the builder).
 *
 *   node tools/loadcalc-core-check.js [--out <dir>]
 *       Runs the REAL src/calc/loadCalc.js `evaluate` on every full
 *       envelope/result pair of the unchanged r22 fixture file (114 primary +
 *       14 post-action = 128), compares the actual result to the literal
 *       expected object, and writes machine-readable proof:
 *         <dir>/actual-pairs.json      [{id, envelope, displayPrecision, result, expected, exactMatch, diffs}]
 *         <dir>/pair-summary.json      counts and the mismatch list
 *       Exit code 0 when every pair matches exactly or differs only on the
 *       documented isolated field (see ISOLATED); 1 otherwise.
 *
 *   node tools/loadcalc-core-check.js --mutants [--out <dir>]
 *       Copies the three runtime modules into a DISPOSABLE temp directory,
 *       applies one source mutation at a time to the copy of the mutant's
 *       target file (never to the delivered tree), reruns the 128 pairs, the
 *       hand-written generalization cases and the B1-r1 regression cases, and
 *       records what each mutant fails. A mutant that survives everything makes
 *       the exit code 1. Writes <dir>/mutation-report.json. M1-M10 are the B1
 *       mutants; M11-M18 are the B1-r1 failure-specific mutants that re-open
 *       R-B1-01..04 one mechanism at a time.
 *
 * Fixture bytes are read, never written. No dependencies.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const EXTRA = require(path.join(ROOT, 'test', 'helpers', 'loadCalcExtraCases.js'));
const R1 = require(path.join(ROOT, 'test', 'helpers', 'loadCalcR1Cases.js'));
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'loadCalc', 'EC-CALC-2-A3-test-cases-r22.json');
const FIXTURE_SHA = 'ec9f95f63c680d315dd3e5b827c61e183ee299b8babe73dea604bc884230703e';
/**
 * The one field on which the unchanged r22 fixtures contradict each other for
 * an identical precalculated term (T-S-14/then[1] COMPLETE: false vs T-S-16
 * PARTIAL: true). The engine applies one rule (profile A never resolves the
 * term's continuity treatment, T-P-19 pending => false while a term is
 * counted). Pairs that differ ONLY here are reported separately, never as
 * exact matches. See docs/load-calc-b1.md.
 */
const ISOLATED = ['$.diagnostics.continuityOfNewLoadKnown'];

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function loadPairs() {
  const raw = fs.readFileSync(FIXTURE);
  if (sha256(raw) !== FIXTURE_SHA) throw new Error('fixture file changed: ' + sha256(raw));
  const tc = JSON.parse(raw.toString('utf8'));
  const pairs = [];
  for (const c of tc.cases) {
    if (c.expected && typeof c.expected === 'object' && 'status' in c.expected && c.kind !== 'math_model' && c.envelope) {
      pairs.push({ id: c.id, envelope: c.envelope, expected: c.expected, displayPrecision: c.displayPrecision || null });
    }
    (c.then || []).forEach((t, i) => pairs.push({ id: `${c.id}/then[${i}]`, envelope: t.envelope, expected: t.expected, displayPrecision: c.displayPrecision || null }));
  }
  return pairs;
}

function deepDiff(a, b, p, out) {
  if (typeof a !== typeof b || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) { out.push({ path: p, actual: a, expected: b }); return; }
  if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], Array.isArray(a) ? `${p}[${k}]` : `${p}.${k}`, out);
  } else if (!Object.is(a, b)) out.push({ path: p, actual: a, expected: b });
}

function runPairs(engine, pairs) {
  const rows = [];
  for (const pr of pairs) {
    let result = null; let error = null;
    try { result = engine.evaluate(pr.envelope, pr.displayPrecision ? { displayPrecision: pr.displayPrecision } : undefined); } catch (e) { error = String(e && e.message || e); }
    const diffs = [];
    if (result) deepDiff(result, pr.expected, '$', diffs); else diffs.push({ path: '$', actual: null, expected: 'result', error });
    const onlyIsolated = diffs.length > 0 && diffs.every((d) => ISOLATED.includes(d.path));
    rows.push({ id: pr.id, envelope: pr.envelope, displayPrecision: pr.displayPrecision, result, expected: pr.expected, exactMatch: diffs.length === 0, differsOnlyOnIsolatedField: onlyIsolated, diffs });
  }
  return rows;
}

function summarize(rows) {
  const exact = rows.filter((r) => r.exactMatch).map((r) => r.id);
  const isolated = rows.filter((r) => r.differsOnlyOnIsolatedField).map((r) => r.id);
  const mismatch = rows.filter((r) => !r.exactMatch && !r.differsOnlyOnIsolatedField).map((r) => ({ id: r.id, diffs: r.diffs.slice(0, 20) }));
  return { pairs: rows.length, exactMatch: exact.length, differsOnlyOnIsolatedField: isolated, isolatedField: ISOLATED, mismatch, exactMatchIds: exact };
}

// ── mutation mode ──────────────────────────────────────────────────────
const MUTANTS = [
  { id: 'M1_125_ON_NEW_TERM_NOT_EXISTING', desc: '125 % applied to the new term instead of the existing component', find: 'const comp = norm * FACTOR_125;', replace: 'const comp = norm;' , find2: 'total = comp + va;\n    lines.push(line(\'total\'', replace2: 'total = comp + va * FACTOR_125;\n    lines.push(line(\'total\'' },
  { id: 'M2_NEW_TERM_OMITTED', desc: 'new term never added to the total', find: '    total = comp + va;\n', replace: '    total = comp;\n' },
  { id: 'M3_NEW_TERM_DUPLICATED', desc: 'new term counted twice in the total', find: '    total = comp + va;\n', replace: '    total = comp + va + va;\n' },
  { id: 'M4_WRONG_GOVERNING_MIN', desc: 'governing conductor picks the smallest terminal', find: 'if (gv === null || v > gv)', replace: 'if (gv === null || v < gv)' },
  { id: 'M5_LN_TERM_ON_ALL_CONDUCTORS', desc: 'L-N term added to every conductor instead of its declared leg', find: "affected = term.leg === null ? [] : [term.leg]; termKind = 'LN';", replace: "affected = keys; termKind = 'LN';" },
  { id: 'M6_ROUND_BEFORE_COMPARISON', desc: 'comparison uses a value rounded to 1 decimal', find: 'satisfied: raw <= rating', replace: 'satisfied: Math.round(raw * 10) / 10 <= rating' },
  { id: 'M7_NO_AGGREGATE_INVALIDATION', desc: 'covered-set staleness never detected', find: "const stale = ctx.term && ctx.projection !== null && ctx.projection !== undefined ? canonicalJson(ctx.projection) !== canonicalJson(Array.isArray(ctx.term.coversSnapshot) ? ctx.term.coversSnapshot : []) : false;", replace: 'const stale = false;' },
  { id: 'M8_WRONG_3PH_DIVIDER', desc: 'three-phase current divides by V_LL instead of sqrt3 x V_LL', find: 'const den = SQRT3 * sup.vLineToLine; const i = total / den;', replace: 'const den = sup.vLineToLine; const i = total / den;', find2: 'nid = \'n_3PH\'; i = va / (SQRT3 * sup.vLineToLine);', replace2: 'nid = \'n_3PH\'; i = va / sup.vLineToLine;' },
  { id: 'M9_125_FACTOR_120', desc: 'existing component factor 1.20 instead of 1.25', find: 'const FACTOR_125 = 1.25;', replace: 'const FACTOR_125 = 1.20;' },
  { id: 'M10_NETWORK_LN_USES_VLL', desc: 'network balanced-LN current divides the full total by V_LL', find: 'const i = (total / 2) / sup.vLineToNeutral;', replace: 'const i = total / sup.vLineToLine;' },
  // ── B1-r1 failure-specific mutants ──
  { id: 'M11_ABSENT_PROPERTY_BYPASSES_L3', finding: 'R-B1-01', desc: 'field() returns undefined for an absent key again (absent qualification field no longer reported)', find: 'const field = (o, k) => (own(o, k) && o[k] !== undefined ? o[k] : null);', replace: 'const field = (o, k) => (own(o, k) ? o[k] : undefined);' },
  { id: 'M12_REQUIRED_SET_FROM_PRESENT_KEYS', finding: 'R-B1-02', desc: 'per-conductor required set derived from the keys that are present (B1 behaviour)', find: '    const required = requiredConductors(s.supply.topology);\n', replace: '    const required = null;\n', find2: "    ? (requiredConductors(topology) || [])\n", replace2: "    ? ['L1', 'L2', 'L3'].filter((k) => per && own(per, k) && per[k] !== null)\n" },
  { id: 'M13_PARSER_UNSAFE_INTEGER', file: 'loadCalcInput.js', finding: 'R-B1-03', desc: 'parseNumberField accepts unsafe integers again (rounded count returned as valid)', find: "  if (spec && spec.integer && !Number.isSafeInteger(v)) return err('OUT_OF_RANGE');\n", replace: '' },
  { id: 'M14_L2_INTEGER_NOT_SAFE', file: 'loadCalcInput.js', finding: 'R-B1-03', desc: "L2 'integer' accepts any integer-valued double (2^53 passes)", find: "    case 'integer': return isNum(v) && Number.isSafeInteger(v);", replace: "    case 'integer': return isNum(v) && Number.isInteger(v);" },
  { id: 'M15_REPRESENTABILITY_SKIPPED', file: 'loadCalcInput.js', finding: 'R-B1-03', desc: 'strict JSON-representability walk skipped in both validators', find: "  const rep = jsonRepresentabilityErrors(snapshot, 'snapshot');\n  if (rep.length) return rep;", replace: "  const rep = [];\n  if (rep.length) return rep;", find2: "  const rep = jsonRepresentabilityErrors(envelope, 'envelope');\n  if (rep.length) return rep;", replace2: "  const rep = [];\n  if (rep.length) return rep;" },
  { id: 'M16_COUNT_FINALIZED_DESPITE_UNRESOLVED', file: 'loadCalcState.js', finding: 'R-B1-04', desc: 'count target finalized even when an item for the same target is unresolved (B1 behaviour)', find: '    if (!c.unresolvedIds.length) return c.applied.length;\n', replace: '    return c.applied.length;\n' },
  { id: 'M17_UNREPRESENTABLE_ITEM_ACCEPTED', file: 'loadCalcState.js', finding: 'R-B1-04', desc: 'any item shape accepted (va null reaches the snapshot)', find: '    const okItem = isPlainObject(it) && typeof it.id === ', replace: '    const okItem = true || isPlainObject(it) && typeof it.id === ' },
  { id: 'M18_UNPARSEABLE_LIST_AS_EMPTY', file: 'loadCalcState.js', finding: 'R-B1-04', desc: 'unparseable list text becomes a trusted empty list again', find: "  try { v = JSON.parse(raw); } catch (e) { throw new LegacyRecordError('LEGACY_UNPARSEABLE_LIST', `legacy field '${key}' is not valid JSON`, { list: key, reason: e.message }); }", replace: "  try { v = JSON.parse(raw); } catch (e) { return []; }" },
];

function applyMutation(src, m) {
  const one = (s, find, replace) => {
    const idx = s.indexOf(find);
    if (idx === -1 || s.indexOf(find, idx + 1) !== -1) throw new Error(`mutation ${m.id}: pattern must match exactly once`);
    return s.slice(0, idx) + replace + s.slice(idx + find.length);
  };
  let out = one(src, m.find, m.replace);
  if (m.find2) out = one(out, m.find2, m.replace2);
  if (out === src) throw new Error(`mutation ${m.id}: no change`);
  return out;
}

const RUNTIME_FILES = ['loadCalc.js', 'loadCalcState.js', 'loadCalcInput.js'];
function mutationRun(pairs) {
  const originals = Object.fromEntries(RUNTIME_FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, 'src', 'calc', f), 'utf8')]));
  const report = { mutants: [], survivors: [], note: 'mutations applied to disposable temp copies only; the delivered src tree is untouched' };
  for (const m of MUTANTS) {
    const target = m.file || 'loadCalc.js';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadcalc-mutant-'));
    try {
      for (const f of RUNTIME_FILES) fs.writeFileSync(path.join(dir, f), f === target ? applyMutation(originals[f], m) : originals[f]);
      const engine = require(path.join(dir, 'loadCalc.js'));
      const mods = { engine, input: require(path.join(dir, 'loadCalcInput.js')), state: require(path.join(dir, 'loadCalcState.js')) };
      const rows = runPairs(engine, pairs);
      const killedBy = rows.filter((r) => !r.exactMatch && !r.differsOnlyOnIsolatedField).map((r) => r.id);
      // the hand-written generalization cases (test/helpers/loadCalcExtraCases.js) and the B1-r1 cases run against the mutant too
      const extraKilledBy = [];
      for (const c of EXTRA.CASES) { try { c.check(engine.evaluate(c.envelope()), engine.evaluate); } catch (e) { extraKilledBy.push(c.id); } }
      const r1KilledBy = [];
      for (const c of R1.CASES) { try { c.check(mods); } catch (e) { r1KilledBy.push(c.id); } }
      const entry = { id: m.id, file: target, finding: m.finding || null, description: m.desc, pairsFailed: killedBy.length, killedBy: killedBy.slice(0, 12), extraCasesFailed: extraKilledBy.length, extraKilledBy, r1CasesFailed: r1KilledBy.length, r1KilledBy, killed: killedBy.length + extraKilledBy.length + r1KilledBy.length > 0 };
      report.mutants.push(entry);
      if (!entry.killed) report.survivors.push(m.id);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  report.deliveredSourceUnchanged = RUNTIME_FILES.every((f) => fs.readFileSync(path.join(ROOT, 'src', 'calc', f), 'utf8') === originals[f]);
  return report;
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : null;
  const pairs = loadPairs();
  if (args.includes('--mutants')) {
    const report = mutationRun(pairs);
    if (outDir) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'mutation-report.json'), JSON.stringify(report, null, 1) + '\n'); }
    for (const m of report.mutants) console.log(`${m.killed ? 'KILLED  ' : 'SURVIVED'} ${m.id} [${m.file}] — ${m.description} (r22 pairs failed: ${m.pairsFailed}, generalization cases failed: ${m.extraCasesFailed}, r1 cases failed: ${m.r1CasesFailed})`);
    console.log(`delivered runtime modules unchanged: ${report.deliveredSourceUnchanged}`);
    process.exitCode = report.survivors.length || !report.deliveredSourceUnchanged ? 1 : 0;
    return;
  }
  const engine = require(path.join(ROOT, 'src', 'calc', 'loadCalc.js'));
  const rows = runPairs(engine, pairs);
  const summary = summarize(rows);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'actual-pairs.json'), JSON.stringify(rows, null, 1) + '\n');
    fs.writeFileSync(path.join(outDir, 'pair-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  }
  console.log(`engine pairs: ${summary.pairs} | exact match: ${summary.exactMatch} | differs only on ${ISOLATED.join(',')}: ${summary.differsOnlyOnIsolatedField.length} [${summary.differsOnlyOnIsolatedField.join(', ')}] | other mismatches: ${summary.mismatch.length}`);
  for (const mm of summary.mismatch) { console.log('MISMATCH', mm.id); for (const d of mm.diffs.slice(0, 6)) console.log('  ', d.path, 'actual', JSON.stringify(d.actual), 'expected', JSON.stringify(d.expected)); }
  process.exitCode = summary.mismatch.length ? 1 : 0;
}

if (require.main === module) main();
module.exports = { loadPairs, runPairs, summarize, deepDiff, ISOLATED, MUTANTS, applyMutation, mutationRun };
