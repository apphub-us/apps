'use strict';
/**
 * Load Calc input helpers — L1 strict ingress and pure field parsers, L2
 * bounded structural validator (EC-CALC-2 / B1). These are helper/parser
 * checks available without a browser; the real DOM events, focus handling and
 * the form adapter remain B2 and are NOT claimed here.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseStrictJson, parseNumberField, parseEnumField, validateSnapshot, validateEnvelope, ENUMS } = require('../src/calc/loadCalcInput');
const { evaluate, LoadCalcEnvelopeError } = require('../src/calc/loadCalc');
const H = require('./helpers/loadCalcFixtures');

describe('L1 — strict JSON ingress (load_strict equivalent)', () => {
  test('T-S-37: JSON text containing NaN is rejected with PARSE_REJECTED; no snapshot is built and the engine is not called', () => {
    const c = H.caseById('T-S-37');
    const r = parseStrictJson(c.rawJson);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'PARSE_REJECTED'); assert.ok(!('value' in r));
    assert.deepStrictEqual({ layer: 'ingress', accepted: r.ok, code: r.code, engineCalled: false }, c.expected);
  });
  test('Infinity, -Infinity, duplicate keys, trailing garbage and non-object roots are rejected; JSON.parse would have accepted the duplicate', () => {
    for (const bad of ['{"a":Infinity}', '{"a":-Infinity}', '{"a":1,"a":2}', '{"a":{"b":1,"b":2}}', '{"a":1} x', '[1,2]', '"s"', '42', 'null', '', '{"a":1e999}', '{"a":01}', '{"a":"\u0001"}']) {
      const r = parseStrictJson(bad); assert.strictEqual(r.ok, false, bad); assert.strictEqual(r.code, 'PARSE_REJECTED', bad);
    }
    assert.deepStrictEqual(JSON.parse('{"a":1,"a":2}'), { a: 2 }, 'the plain parser silently keeps the last duplicate');
    assert.strictEqual(parseStrictJson(undefined).ok, false);
  });
  test('valid strict JSON parses to own data properties; a "__proto__" key is data and never pollutes prototypes', () => {
    const r = parseStrictJson('{"__proto__":{"polluted":true},"a":[1,2.5,-3e2,"x\\u00e9\\n"],"b":{"c":null,"d":false}}');
    assert.strictEqual(r.ok, true);
    assert.ok(Object.prototype.hasOwnProperty.call(r.value, '__proto__')); assert.strictEqual(Object.getPrototypeOf(r.value), Object.prototype);
    assert.strictEqual(({}).polluted, undefined);
    assert.deepStrictEqual(r.value.a, [1, 2.5, -300, 'x\u00e9\n']); assert.deepStrictEqual(r.value.b, { c: null, d: false });
  });
  test('every r22 envelope survives a strict re-parse of its own serialization (fixtures contain no non-JSON tokens or duplicate keys)', () => {
    for (const p of H.enginePairs()) { const r = parseStrictJson(JSON.stringify(p.envelope)); assert.strictEqual(r.ok, true, p.id); assert.deepStrictEqual(r.value, p.envelope, p.id); }
  });
});

describe('L1 — pure non-DOM field parsers (one transport for empty/malformed fields)', () => {
  test('T-S-10a/b/c raw entries for multifamily.unitCount: "" -> null + MISSING_FIELD, "abc" -> NOT_FINITE, "2.5" -> NOT_INTEGER; snapshot field stays null', () => {
    for (const sfx of ['a', 'b', 'c']) {
      const c = H.caseById(`T-S-10${sfx}`); const raw = c.formEntry.lcNumUnits; const expected = c.envelope.parseErrors[0];
      const r = parseNumberField(raw, { field: 'multifamily.unitCount', integer: true, min: 1 });
      assert.strictEqual(r.value, null, c.id); assert.deepStrictEqual(r.error, expected, c.id);
      assert.strictEqual(c.envelope.snapshot.multifamily.unitCount, null);
    }
    assert.deepStrictEqual(parseNumberField('3', { field: 'multifamily.unitCount', integer: true, min: 1 }), { value: 3, error: null });
  });
  test('T-S-41a/b and T-S-42a/b raw entries: blank -> MISSING_FIELD, "abc" / "12,3" -> NOT_FINITE; corrected "40000" / "5000" parse with no error', () => {
    for (const id of ['T-S-41a', 'T-S-41b', 'T-S-42a', 'T-S-42b']) {
      const c = H.caseById(id); const raw = Object.values(c.formEntry)[0]; const pe = c.envelope.parseErrors[0];
      const r = parseNumberField(raw, { field: pe.field }); assert.strictEqual(r.value, null, id); assert.deepStrictEqual(r.error, pe, id);
    }
    assert.deepStrictEqual(parseNumberField(H.caseById('T-S-41c').formEntry.lcMeterVA, { field: 'measurement.reading.value' }), { value: 40000, error: null });
    assert.deepStrictEqual(parseNumberField(H.caseById('T-S-42c').formEntry.lcNewLoadVA, { field: 'measurement.newLoad.precalculated.va' }), { value: 5000, error: null });
  });
  test('blank is never coerced to 0 and never a previous value; whitespace counts as blank; NaN/Infinity text is NOT_FINITE; ranges give OUT_OF_RANGE', () => {
    for (const raw of ['', '   ', null, undefined]) { const r = parseNumberField(raw, { field: 'f' }); assert.strictEqual(r.value, null); assert.strictEqual(r.error.code, 'MISSING_FIELD'); }
    for (const raw of ['NaN', 'Infinity', '-Infinity', '1e999', 'abc', '12,3', '0x10', '1 2']) assert.strictEqual(parseNumberField(raw, { field: 'f' }).error.code, 'NOT_FINITE', raw);
    assert.strictEqual(parseNumberField('-5', { field: 'f', min: 0 }).error.code, 'OUT_OF_RANGE');
    assert.strictEqual(parseNumberField('0', { field: 'f', min: 0, exclusiveMin: true }).error.code, 'OUT_OF_RANGE');
    assert.strictEqual(parseNumberField('1.5', { field: 'f', integer: true }).error.code, 'NOT_INTEGER');
    assert.deepStrictEqual(parseNumberField(' 40000 ', { field: 'f' }), { value: 40000, error: null });
    assert.deepStrictEqual(parseNumberField('2.0', { field: 'f', integer: true }), { value: 2, error: null });
  });
  test("T-S-36: unknown voltage option '999' -> UNKNOWN_ENUM supply.topology; blank -> MISSING_FIELD; known option parses", () => {
    const c = H.caseById('T-S-36');
    const r = parseEnumField(c.formEntry.lcVoltage, { field: 'supply.topology', allowed: ENUMS.topology.filter((x) => x !== null) });
    assert.strictEqual(r.value, null); assert.deepStrictEqual(r.error, c.envelope.parseErrors[0]);
    assert.strictEqual(parseEnumField('', { field: 'supply.topology', allowed: ENUMS.topology }).error.code, 'MISSING_FIELD');
    assert.deepStrictEqual(parseEnumField('1ph_3w_120_240', { field: 'supply.topology', allowed: ENUMS.topology }), { value: '1ph_3w_120_240', error: null });
    assert.strictEqual(parseEnumField('__proto__', { field: 'supply.topology', allowed: ENUMS.topology }).error.code, 'UNKNOWN_ENUM');
  });
});

describe('L2 — bounded structural validator (contract shapes; not a generic JSON Schema engine)', () => {
  test('every fixture envelope (120 primary + 14 post-action) is structurally valid', () => {
    let n = 0;
    for (const c of H.loadCases().cases) {
      if (c.envelope) { assert.deepStrictEqual(validateEnvelope(c.envelope), [], c.id); n++; }
      for (const [i, t] of (c.then || []).entries()) { assert.deepStrictEqual(validateEnvelope(t.envelope), [], `${c.id}/then[${i}]`); n++; }
    }
    assert.strictEqual(n, 134);
  });
  test('every migrated snapshot (15) and after-action snapshot (2) is structurally valid', () => {
    let m = 0; let a = 0;
    for (const c of H.loadCases().cases) {
      if (c.migratedSnapshot) { assert.deepStrictEqual(validateSnapshot(c.migratedSnapshot), [], c.id); m++; }
      if (c.snapshotAfterAction) { assert.deepStrictEqual(validateSnapshot(c.snapshotAfterAction), [], c.id); a++; }
    }
    assert.strictEqual(m, 15); assert.strictEqual(a, 2);
  });
  test('T-S-33: topology 1ph_3w_120_240 with 208 V / 3 phases is rejected as CONTRADICTORY_SUPPLY; engine not called', () => {
    const c = H.caseById('T-S-33'); const errs = validateSnapshot(c.invalidSnapshot);
    assert.ok(errs.length >= 2); assert.ok(errs.every((e) => e.includes('CONTRADICTORY_SUPPLY')));
    assert.deepStrictEqual({ layer: 'schema', schemaValid: errs.length === 0, engineCalled: false }, c.expected);
    assert.throws(() => evaluate({ snapshot: c.invalidSnapshot, parseErrors: [], profileId: 'A_measured_87_core' }), LoadCalcEnvelopeError);
  });
  test('the coupling table matches every topology: derived voltages/phases/wires cannot disagree with the topology', () => {
    const base = H.clone(H.caseById('T-N-01b').envelope.snapshot);
    const table = { '1ph_2w_120': [120, 120, 1, 2], '1ph_2w_240': [240, null, 1, 2], '1ph_3w_120_240': [240, 120, 1, 3], '1ph_3w_120_208_network': [208, 120, 1, 3], '3ph_4w_208Y_120': [208, 120, 3, 4], '3ph_4w_480Y_277': [480, 277, 3, 4], '3ph_3w_480_delta': [480, null, 3, 3], '3ph_3w_240_delta': [240, null, 3, 3], '3ph_4w_240_delta_highleg': [240, 120, 3, 4], other: [null, null, null, null] };
    for (const [t, [vll, vln, ph, w]] of Object.entries(table)) {
      base.supply = { topology: t, vLineToLine: vll, vLineToNeutral: vln, phases: ph, wires: w }; assert.deepStrictEqual(validateSnapshot(base), [], t);
      base.supply = { topology: t, vLineToLine: vll === null ? 999 : vll + 1, vLineToNeutral: vln, phases: ph, wires: w }; assert.ok(validateSnapshot(base).length, t + ' wrong vLL');
    }
    base.supply = { topology: null, vLineToLine: 240, vLineToNeutral: null, phases: null, wires: null }; assert.ok(validateSnapshot(base).length, 'null topology with a voltage');
  });
  test('required keys, enums, additionalProperties, integer fields and nested declared booleans are enforced', () => {
    const ok = H.clone(H.caseById('T-N-13').envelope);
    const mut = (fn) => { const e = H.clone(ok); fn(e); return validateEnvelope(e).length; };
    assert.ok(mut((e) => delete e.snapshot.dwelling));
    assert.ok(mut((e) => { e.snapshot.occupancy = 'castle'; }));
    assert.ok(mut((e) => { e.snapshot.measurement.reading.unit = 'W'; }));
    assert.ok(mut((e) => { e.snapshot.measurement.periodMonths = 12.5; }));
    assert.ok(mut((e) => { e.snapshot.measurement.newLoad.precalculated.va = -1; }));
    assert.ok(mut((e) => { e.snapshot.measurement.newLoad.precalculated.basis.establishedForThisComparison = 'yes'; }));
    assert.ok(mut((e) => { e.snapshot.loadModel.declarations.unityPF = { value: true, provenance: { source: 'hearsay' } }; }));
    assert.ok(mut((e) => { e.snapshot.loadModel.declarations.magic = { value: true }; }));
    assert.ok(mut((e) => { e.snapshot.measurement.readingsPerConductor = { L4: 1 }; }));
    assert.ok(mut((e) => { e.parseErrors = [{ field: 'x', raw: null, code: 'BOGUS' }]; }));
    assert.ok(mut((e) => { e.profileId = 'B'; }));
    assert.ok(mut((e) => { e.snapshot.schemaVersion = '3.2'; }));
    assert.ok(mut((e) => { e.snapshot.migration = { from: 2 }; }));
    assert.strictEqual(mut(() => {}), 0);
  });
});
