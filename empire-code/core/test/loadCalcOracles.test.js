'use strict';
/**
 * Independent oracles, mutations and B1 boundary checks — EC-CALC-2 / B1.
 *   ORACLE    unchanged schema r21 + contract_invariants_r22 (L4) + operative_graph_review
 *             on the ACTUAL engine outputs (via tools/loadcalc-contract-check.py when
 *             python3 is available; otherwise the test is skipped with that reason —
 *             it is never reported as passed)
 *   MUTATION  disposable-copy mutants of the real implementation must be killed
 *   PURITY    runtime modules use Node built-ins only; no DOM/storage/network/time/random
 *   INTEGRATION (B2) the three modules ARE registered in tools/build-calc.js and
 *             injected into mobile.html; the shipped EC.loadCalc is the accepted
 *             core (byte parity is proven in test/loadCalcParity.test.js).
 *             B2 superseded exactly the two B1 BOUNDARY tests that asserted the
 *             opposite ("not registered / not injected"); nothing else changed here.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const harness = require('../tools/loadcalc-core-check');

const ROOT = path.join(__dirname, '..');
const RUNTIME = ['src/calc/loadCalc.js', 'src/calc/loadCalcState.js', 'src/calc/loadCalcInput.js'];
const python = (() => { const r = spawnSync('python3', ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' }); return r.status === 0 && r.stdout.trim() === '3'; })();

describe('ORACLE — harness tally over the 128 r22 pairs', () => {
  test('125 exact literal matches, 3 pairs differ only on the isolated non-operative diagnostic, 0 other mismatches', () => {
    const rows = harness.runPairs(require('../src/calc/loadCalc'), harness.loadPairs());
    const s = harness.summarize(rows);
    assert.strictEqual(s.pairs, 128); assert.strictEqual(s.exactMatch, 125); assert.deepStrictEqual(s.differsOnlyOnIsolatedField, ['T-S-16', 'T-S-40s', 'T-S-40s/then[0]']); assert.deepStrictEqual(s.mismatch, []);
  });
});

describe('ORACLE — schema r21 + L4 (I-01..I-21) + reviewer graph checker on the ACTUAL engine outputs', { skip: python ? false : 'python3 not available in this environment: external checker not executed (pending reviewer execution)' }, () => {
  test('every actual (envelope, result) pair passes the unchanged checkers; targeted bad pairs stay rejected; negative/mutant sets replay as recorded', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadcalc-proof-'));
    try {
      const rows = harness.runPairs(require('../src/calc/loadCalc'), harness.loadPairs());
      fs.writeFileSync(path.join(dir, 'actual-pairs.json'), JSON.stringify(rows));
      const r = spawnSync('python3', [path.join(ROOT, 'tools', 'loadcalc-contract-check.py'), dir], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      const report = JSON.parse(fs.readFileSync(path.join(dir, 'contract-check.json'), 'utf8'));
      assert.strictEqual(report.actualPairs, 128); assert.strictEqual(report.actualPairsOk, 128); assert.deepStrictEqual(report.actualPairsViolating, []);
      const rejected = report.targetedClosurePairs.filter((t) => t.layer !== 'ACCEPTED').map((t) => t.id).sort();
      assert.deepStrictEqual(rejected, ['AMP_ORPHAN_NEW_TERM', 'AMP_TERM_ASSOCIATION_NOT_CONNECTED_TO_TOTAL', 'AMP_WRONG_GOVERNING_AND_MISSING_COMPARISON', 'CONTROL_T-N-17', 'CONTROL_WRONG_FACTOR_REJECTED', 'VA_NEW_TERM_COUNTED_TWICE']);
      assert.ok(report.negativePairsR22.every((x) => x.asExpected)); assert.ok(report.mutantsR2onR22.every((x) => x.asExpected));
      assert.ok(typeof report.validator === 'string');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('MUTATION — disposable-copy mutants of the real implementation', () => {
  test('every mutant (B1: wrong 125 % operand, omitted/duplicated term, wrong maximum, wrong association, rounding before comparison, no invalidation, wrong sqrt3 divider, wrong factor, wrong network divider; B1-r1: absent-property bypass, present-keys conductor set, unsafe parser/L2 integers, skipped representability, finalized-despite-unresolved, unrepresentable item, unparseable list) is killed; delivered modules unchanged', () => {
    const report = harness.mutationRun(harness.loadPairs());
    assert.strictEqual(report.mutants.length, 18); assert.deepStrictEqual(report.survivors, []); assert.strictEqual(report.deliveredSourceUnchanged, true);
    const m10 = report.mutants.find((m) => m.id === 'M10_NETWORK_LN_USES_VLL'); assert.strictEqual(m10.pairsFailed, 0, 'the r22 pairs alone do not cover this model'); assert.ok(m10.extraCasesFailed >= 1, 'killed only by the generalization case B1-X-01');
    for (const m of report.mutants.filter((x) => x.finding)) { assert.strictEqual(m.pairsFailed, 0, `${m.id}: the historical pairs do not exercise this finding`); assert.ok(m.r1CasesFailed >= 1, `${m.id} must be killed by the R1 cases`); }
    assert.deepStrictEqual(report.mutants.filter((x) => x.finding).map((x) => x.finding), ['R-B1-01', 'R-B1-02', 'R-B1-03', 'R-B1-03', 'R-B1-03', 'R-B1-04', 'R-B1-04', 'R-B1-04']);
    assert.ok(!fs.readdirSync(os.tmpdir()).some((n) => n.startsWith('loadcalc-mutant-')), 'no mutant directory left behind');
  });
});

describe('PURITY — runtime modules are pure Node built-in CommonJS', () => {
  test('no DOM / storage / network / time / random access and no non-local, non-builtin require in the three runtime modules', () => {
    const forbidden = [/\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bfetch\s*\(/, /XMLHttpRequest/, /\bnew Date\b/, /Date\.now/, /Math\.random/, /setTimeout|setInterval/, /\bprocess\./, /require\(['"](?!\.\/)(?!node:)/];
    for (const f of RUNTIME) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const re of forbidden) assert.ok(!re.test(src), `${f} matches ${re}`);
      assert.ok(src.startsWith("'use strict';"), f);
    }
  });
  test('the modules load with no side effects and export only functions/frozen constants', () => {
    const before = new Set(Object.keys(require.cache));
    const lc = require('../src/calc/loadCalc'); const st = require('../src/calc/loadCalcState'); const inp = require('../src/calc/loadCalcInput');
    assert.strictEqual(typeof lc.evaluate, 'function'); assert.strictEqual(typeof st.migrateLegacyRecord, 'function'); assert.strictEqual(typeof inp.parseStrictJson, 'function');
    assert.ok(Object.isFrozen(lc.PROFILE)); assert.ok(Object.isFrozen(st.RULE_BASIS));
    const added = Object.keys(require.cache).filter((k) => !before.has(k)); assert.ok(added.every((k) => k.includes(path.join('src', 'calc'))), added.join(','));
  });
});

describe('INTEGRATION — B2 registers and injects the accepted core (supersedes the two B1 BOUNDARY assertions)', () => {
  test('tools/build-calc.js MODULES lists loadCalcState, loadCalcInput, loadCalc (in dependency order, after the 11 existing modules) and then the five accepted 220.82 / V2 modules, and mobile.html carries their generated blocks', () => {
    const builder = fs.readFileSync(path.join(ROOT, 'tools', 'build-calc.js'), 'utf8');
    const ids = [...builder.matchAll(/\{ id: '([A-Za-z0-9]+)', file: '([^']+)' \}/g)].map((m) => [m[1], m[2]]);
    // ledger L-16 (executed in LC-22082-B0-UI-INTEGRATION-1-R1 / U1): the three A modules keep positions 11-13; the five accepted 220.82 / V2 modules follow them in dependency order; exactly 19 in total
    assert.deepStrictEqual(ids.slice(11, 14), [['loadCalcState', 'calc/loadCalcState.js'], ['loadCalcInput', 'calc/loadCalcInput.js'], ['loadCalc', 'calc/loadCalc.js']]);
    // LC-SERVICE-UI-1: module 20 (the unchanged R2 service sizing prototype) is registered after its dependencies; the explicit list replaces the former count of 19
    // EC-AUDIT-FIX-1: the exact public list after the authorized audit stages — still an explicit, ordered, complete list
    // (never a minimum count or a loose "includes"). Entries without a comment are the OLD BASELINE, in their unchanged
    // relative order; each NEW PUBLIC MODULE of the audit is marked with the stage that registered it and the dependency
    // reason for its position (tools/build-calc.js is the single source of that order).
    assert.deepStrictEqual(ids.slice(14), [
      // old baseline: the five accepted 220.82 / V2 modules, service sizing, service record
      ['loadCalcInputV2', 'calc/loadCalcInputV2.js'], ['loadCalcOpt82', 'calc/loadCalcOpt82.js'], ['loadCalcFacade', 'calc/loadCalcFacade.js'], ['loadCalcStateV2', 'calc/loadCalcStateV2.js'], ['loadCalcStorageV2', 'calc/loadCalcStorageV2.js'], ['loadCalcServiceSizing', 'calc/loadCalcServiceSizing.js'], ['loadCalcServiceRecord', 'calc/loadCalcServiceRecord.js'],
      // old baseline: job card + measurement models and stores
      ['jobCard', 'jobs/jobCard.js'], ['jobCardStore', 'jobs/jobCardStore.js'], ['jobMeasurement', 'jobs/jobMeasurement.js'], ['jobMeasurementStore', 'jobs/jobMeasurementStore.js'],
      // NEW (EC-AUDIT-FIX-1 stage 3, EC-08): the one shared unit / quantity definition, BEFORE its first user jobMaterial
      ['materialQuantity', 'jobs/materialQuantity.js'],
      // old baseline: materials, photos, archive, restore, voice
      ['jobMaterial', 'jobs/jobMaterial.js'], ['jobMaterialStore', 'jobs/jobMaterialStore.js'], ['jobPhoto', 'jobs/jobPhoto.js'], ['jobPhotoFile', 'jobs/jobPhotoFile.js'], ['jobPhotoStore', 'jobs/jobPhotoStore.js'], ['jobArchive', 'jobs/jobArchive.js'], ['jobArchiveFile', 'jobs/jobArchiveFile.js'], ['jobArchiveSource', 'jobs/jobArchiveSource.js'], ['jobRestore', 'jobs/jobRestore.js'], ['jobRestoreStore', 'jobs/jobRestoreStore.js'], ['jobVoiceMaterials', 'jobs/jobVoiceMaterials.js'], ['jobVoiceIntent', 'jobs/jobVoiceIntent.js'], ['jobVoiceBatch', 'jobs/jobVoiceBatch.js'],
      // NEW (EC-AUDIT-FIX-1 stage 5): conversation -> job actions, AFTER jobVoiceBatch and after the job-card / measurement models and stores it requires
      ['jobConversationActions', 'jobs/jobConversationActions.js'],
      // NEW (EC-AUDIT-FIX-1, EC-03 / EC-05, EC-02): Favorites storage boundary + code-source registry, no dependencies
      ['favoritesStore', 'storage/favoritesStore.js'], ['codeSources', 'refs/codeSources.js'],
      // old baseline (CONVERTER-WH-1): Wh battery runtime, no dependencies
      ['batteryRuntime', 'calc/batteryRuntime.js'],
      // NEW (EC-AUDIT-FIX-1 stage 5): the conversational calculator registry, LAST because it requires batteryRuntime and the engines above
      ['conversationTools', 'calc/conversationTools.js'],
    ]);
    // 44 = 11 existing + 3 A modules + the 30 listed above (the former count of 39 predates the audit modules)
    assert.strictEqual(ids.length, 44); assert.strictEqual(ids[0][0], 'tables'); assert.strictEqual(ids[10][0], 'pullBoxLayout');
    assert.strictEqual(new Set(ids.map((m) => m[0])).size, 44, 'every public module id is registered exactly once');
    const app = fs.readFileSync(path.join(ROOT, 'mobile.html'), 'utf8');
    for (const f of RUNTIME) assert.ok(app.includes('  // ---- ' + f + ' ----'), 'generated block for ' + f);
  });
  test('the injected engine in mobile.html exposes EC.loadCalc / EC.loadCalcInput / EC.loadCalcState and evaluates T-N-01 exactly like the source module', () => {
    const html = fs.readFileSync(path.join(ROOT, 'mobile.html'), 'utf8');
    const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
    let block = html.slice(s, e); block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
    const win = {}; new Function('window', block)(win); // eslint-disable-line no-new-func
    assert.strictEqual(typeof win.EC.loadCalc.evaluate, 'function'); assert.strictEqual(typeof win.EC.loadCalcInput.parseNumberField, 'function'); assert.strictEqual(typeof win.EC.loadCalcState.createEmptySnapshot, 'function'); assert.ok(win.EC.boxFill, 'existing modules still present');
    const c = require('./helpers/loadCalcFixtures').caseById('T-N-01');
    assert.deepStrictEqual(win.EC.loadCalc.evaluate(c.envelope), require('../src/calc/loadCalc').evaluate(c.envelope)); assert.deepStrictEqual(win.EC.loadCalc.evaluate(c.envelope), c.expected);
  });
});
