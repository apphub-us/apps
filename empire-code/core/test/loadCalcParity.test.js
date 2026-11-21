'use strict';
/**
 * EC-CALC-2 / B2 — generated-bundle parity for the Load Calc core.
 *
 * The builder embeds src/calc/loadCalcState.js, loadCalcInput.js and
 * loadCalc.js verbatim into mobile.html (window.EC). These tests execute the
 * SHIPPED block (extracted from mobile.html, no DOM) and prove:
 *   - the three module bodies in the bundle are the exact source bytes
 *     (modulo the builder's known indentation wrapper and trailing-newline trim);
 *   - EC.loadCalc.evaluate gives byte-identical JSON to the Node module on all
 *     128 historical pairs, the 25 generalization cases and the 25 r1 cases;
 *   - through the bundle the historical accounting is unchanged: 125 exact +
 *     exactly the 3 disposed diagnostic differences + 0 other;
 *   - state/input helpers agree (empty snapshot, 15 migrations, parsers);
 *   - the 11 pre-existing generated module bodies are unchanged vs their sources.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers/loadCalcFixtures');
const X = require('./helpers/loadCalcExtraCases');
const R1 = require('./helpers/loadCalcR1Cases');
const { ISOLATED } = require('../tools/loadcalc-core-check');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'mobile.html'), 'utf8');
const SRC = { engine: require('../src/calc/loadCalc'), input: require('../src/calc/loadCalcInput'), state: require('../src/calc/loadCalcState') };

function generatedBlock() {
  const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
  assert.ok(s !== -1 && e !== -1, 'generated block present');
  const block = html.slice(s, e);
  return block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
}
function shippedEC() { const win = {}; new Function('window', generatedBlock())(win); return win.EC; } // eslint-disable-line no-new-func
/** body of one embedded module, un-indented the way the builder indented it */
function embeddedModuleSource(id) {
  const re = new RegExp('  __reg\\[' + JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\] = function \\(module, exports, require\\) \\{\\n([\\s\\S]*?)\\n  \\};');
  const m = re.exec(generatedBlock()); assert.ok(m, 'module ' + id + ' embedded');
  return m[1].split('\n').map((l) => (l.startsWith('    ') ? l.slice(4) : l)).join('\n');
}
const norm = (src) => src.replace(/\r\n/g, '\n').replace(/\s+$/, '');
const opts = (p) => (p.displayPrecision ? { displayPrecision: p.displayPrecision } : undefined);

describe('B2 PARITY — the shipped bundle carries the accepted core bytes', () => {
  test('loadCalcState / loadCalcInput / loadCalc are embedded verbatim (builder wrapper only) and are the pinned accepted sources', () => {
    const pins = { 'calc/loadCalc.js': 'dbc80b6d549ee25f46220f345589fc5be37a10980b2f27c164d3fbcec2cb97f4', 'calc/loadCalcInput.js': '0a6fac86b4a211bc755a55b058e5d473dff4b2fcef51920d93af0a49e57d207a', 'calc/loadCalcState.js': '7767694b7325ea23def1ec95c117e44500c1e3dae657b1b3538cedadbfd97bab' };
    const crypto = require('node:crypto');
    for (const [id, file] of [['loadCalcState', 'calc/loadCalcState.js'], ['loadCalcInput', 'calc/loadCalcInput.js'], ['loadCalc', 'calc/loadCalc.js']]) {
      const raw = fs.readFileSync(path.join(ROOT, 'src', file));
      assert.strictEqual(crypto.createHash('sha256').update(raw).digest('hex'), pins[file], file + ' is the accepted B1-r1 byte set');
      assert.strictEqual(embeddedModuleSource(id), norm(raw.toString('utf8')), id + ' embedded verbatim');
    }
  });
  test('the 11 pre-existing generated module bodies equal their sources (nothing else in the bundle changed)', () => {
    const existing = [['tables', 'calc/tables.js'], ['ampacity', 'calc/ampacity.js'], ['voltageDrop', 'calc/voltageDrop.js'], ['conduitFill', 'calc/conduitFill.js'], ['boxFill', 'calc/boxFill.js'], ['motor', 'calc/motor.js'], ['grounding', 'calc/grounding.js'], ['wireSizing', 'calc/wireSizing.js'], ['pullBox', 'calc/pullBox.js'], ['pullBoxEntryGeometry', 'standards/pullBoxEntryGeometry.js'], ['pullBoxLayout', 'layout/pullBoxLayout.js']];
    for (const [id, file] of existing) assert.strictEqual(embeddedModuleSource(id), norm(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8')), id);
    const EC = shippedEC();
    // ledger L-17 (executed in LC-22082-B0-UI-INTEGRATION-1-R1 / U1): exact window.EC identities and order, the five accepted 220.82 / V2 modules after the A modules; the 11 embedded-source identity checks above are unchanged
    // LC-SERVICE-UI-1: + module 20, the unchanged R2 service sizing prototype, registered last (after its dependencies)
    assert.deepStrictEqual(Object.keys(EC), [...existing.map((x) => x[0]), 'loadCalcState', 'loadCalcInput', 'loadCalc', 'loadCalcInputV2', 'loadCalcOpt82', 'loadCalcFacade', 'loadCalcStateV2', 'loadCalcStorageV2', 'loadCalcServiceSizing', 'loadCalcServiceRecord', 'jobCard', 'jobCardStore', 'jobMeasurement', 'jobMeasurementStore', 'jobMaterial', 'jobMaterialStore', 'jobPhoto', 'jobPhotoFile', 'jobPhotoStore', 'jobArchive', 'jobArchiveFile', 'jobArchiveSource', 'jobRestore', 'jobRestoreStore', 'jobVoiceMaterials', 'jobVoiceIntent', 'jobVoiceBatch', /* CONVERTER-WH-1: appended last */ 'batteryRuntime'], 'module identities and order');
  });
  test('the shipped modules are the same code path: require identity inside the bundle (engine uses the bundled helpers)', () => {
    const EC = shippedEC();
    assert.strictEqual(typeof EC.loadCalc.evaluate, 'function'); assert.strictEqual(EC.loadCalc.PROFILE.id, 'A_measured_87_core');
    assert.strictEqual(EC.loadCalc.LoadCalcEnvelopeError, EC.loadCalcInput.LoadCalcEnvelopeError, 'one LoadCalcEnvelopeError class shared by engine and input helpers');
    assert.strictEqual(typeof EC.loadCalcState.migrateLegacyRecord, 'function'); assert.strictEqual(typeof EC.loadCalcInput.parseNumberField, 'function');
  });
});

describe('B2 PARITY — generated vs source on real inputs', () => {
  const EC = shippedEC();
  test('128 historical pairs: generated evaluate == source evaluate (byte-identical JSON) and the accounting is 125 exact + 3 disposed + 0 other through the bundle', () => {
    let exact = 0; let isolated = 0; let other = 0; const isolatedIds = [];
    for (const p of H.enginePairs()) {
      const g = EC.loadCalc.evaluate(p.envelope, opts(p)); const s = SRC.engine.evaluate(p.envelope, opts(p));
      assert.strictEqual(JSON.stringify(g), JSON.stringify(s), p.id + ' generated vs source');
      const d = H.deepDiff(g, p.expected, '$');
      if (!d.length) exact++; else if (d.every((x) => ISOLATED.includes(x.path))) { isolated++; isolatedIds.push(p.id); } else other++;
    }
    assert.deepStrictEqual({ exact, isolated, other }, { exact: 125, isolated: 3, other: 0 });
    assert.deepStrictEqual(isolatedIds, ['T-S-16', 'T-S-40s', 'T-S-40s/then[0]']);
    assert.deepStrictEqual(ISOLATED, ['$.diagnostics.continuityOfNewLoadKnown']);
  });
  test('25 generalization cases pass through the generated module and match the source output exactly', () => {
    for (const c of X.CASES) {
      const env = c.envelope(); c.check(EC.loadCalc.evaluate(env), EC.loadCalc.evaluate);
      assert.strictEqual(JSON.stringify(EC.loadCalc.evaluate(env)), JSON.stringify(SRC.engine.evaluate(env)), c.id);
    }
  });
  test('25 B1-r1 cases pass against the generated engine/input/state modules', () => {
    const mods = { engine: EC.loadCalc, input: EC.loadCalcInput, state: EC.loadCalcState };
    for (const c of R1.CASES) c.check(mods);
  });
  test('L2 rejections are identical: T-S-33 and malformed envelopes throw SCHEMA_INVALID from the bundle', () => {
    const c = H.caseById('T-S-33');
    assert.throws(() => EC.loadCalc.evaluate({ snapshot: c.invalidSnapshot, parseErrors: [], profileId: 'A_measured_87_core' }), (e) => e.code === 'SCHEMA_INVALID' && e instanceof EC.loadCalc.LoadCalcEnvelopeError);
    const e = H.clone(H.caseById('T-N-01').envelope); e.snapshot.multifamily.unitGroups = [NaN];
    assert.throws(() => EC.loadCalc.evaluate(e), (x) => x.code === 'SCHEMA_INVALID');
  });
  test('state/input helpers agree: empty snapshot, 15 migrations, LegacyRecordError, parsers, formatNumber', () => {
    assert.deepStrictEqual(EC.loadCalcState.createEmptySnapshot(), SRC.state.createEmptySnapshot());
    assert.deepStrictEqual(EC.loadCalcState.createEmptySnapshot(), H.caseById('T-S-08').envelope.snapshot);
    for (const c of H.loadCases().cases) if (c.legacyRecord && c.migratedSnapshot) assert.deepStrictEqual(EC.loadCalcState.migrateLegacyRecord(c.legacyRecord).snapshot, c.migratedSnapshot, c.id);
    assert.throws(() => EC.loadCalcState.migrateLegacyRecord({ method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: 'not-json', hvac: '[]', ev: '[]' }), (e) => e instanceof EC.loadCalcState.LegacyRecordError && e.code === 'LEGACY_UNPARSEABLE_LIST');
    for (const raw of ['', ' 40000 ', 'abc', '12,3', '9007199254740993', '2.5']) assert.deepStrictEqual(EC.loadCalcInput.parseNumberField(raw, { field: 'f', integer: raw === '2.5' || raw.length > 12 }), SRC.input.parseNumberField(raw, { field: 'f', integer: raw === '2.5' || raw.length > 12 }), raw);
    assert.strictEqual(EC.loadCalc.formatNumber(208.33333333333334, 1), '208.3'); assert.strictEqual(EC.loadCalc.formatNumber(50000, 0), '50,000');
  });
});
