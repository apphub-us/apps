'use strict';
/**
 * PBV2-13B-2 — Layer 0 entry geometry / standards resolver.
 *
 * Covers: resolution + provenance, unsupported/invalid handling, explicit
 * override, data-quality guards, the conservative-datum direction proven
 * through the REAL Layer-2 solver, and the full Layer 1 -> 0 -> 2 flow.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const L0 = require('../src/standards/pullBoxEntryGeometry');
const L1 = require('../src/calc/pullBox');
const L2 = require('../src/layout/pullBoxLayout');

const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, '..', p))).digest('hex');
const ENGINE_MD5 = 'bdd49316a39ebadd3e43718a31e01739';
const SOLVER_MD5 = '06381d81b98809a39b85cadfc2af1acf';

const src0 = fs.readFileSync(path.join(__dirname, '..', 'src', 'standards', 'pullBoxEntryGeometry.js'), 'utf8');
const code0 = src0.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const KO = (s) => L0.resolveEntryGeometry({ tradeSize: s, racewayType: 'RMC', entryMethod: 'KNOCKOUT_THREADED' });

describe('PBV2-13B-2 — frozen layers', () => {
  test('Layer 1 and Layer 2 are byte-identical', () => {
    assert.strictEqual(md5('src/calc/pullBox.js'), ENGINE_MD5);
    assert.strictEqual(md5('src/layout/pullBoxLayout.js'), SOLVER_MD5);
  });

  test('Layer 0 imports nothing, has no NEC arithmetic, no DOM, no network', () => {
    assert.ok(!/require\(/.test(code0), 'no imports');
    assert.ok(!/[*]\s*8n?\b|\b8n?\s*[*]|[*]\s*6n?\b|\b6n?\s*[*]/.test(code0), 'no 8x / 6x');
    assert.ok(!/calculatePullBox|classifyConnection|WALL_DIMENSION|314\.28/.test(code0), 'no Layer-1 internals');
    assert.ok(!/fetch\(|XMLHttpRequest|http[s]?:\/\/|require\('http/.test(code0), 'no runtime network');
    // ("document" is a provenance field name; only DOM API usage is banned)
    assert.ok(!/document\.|window\.|innerHTML|getElementById|querySelector|svg|viewBox|visualPosition/i.test(code0), 'no DOM / UI');
    assert.ok(!/minimumWidthIn|spacingRequirements|rows\b|connections\b/.test(code0), 'never inspects rows/connections/results');
  });
});

describe('PBV2-13B-2 — resolution and provenance', () => {
  test('a supported system + size resolves with facts, sources and policy', () => {
    const r = L0.resolveEntryGeometry({ tradeSize: '2', racewayType: 'EMT', entryMethod: 'KNOCKOUT_CONNECTOR' });
    assert.strictEqual(r.status, 'CONSERVATIVE');
    assert.strictEqual(r.resolution, 'CONSERVATIVE');
    assert.strictEqual(r.units, 'in');
    assert.strictEqual(r.entryMeasurementDiameterIn, 2.5);
    assert.strictEqual(r.entryMeasurementDiameterDecimal, '2.500');
    assert.strictEqual(r.datumPolicy, L0.DATUM_POLICY);
    assert.strictEqual(r.datumFrom, 'ENCLOSURE_OPENING');
    assert.deepStrictEqual(r.facts.enclosureOpeningDiameterIn,
      { value: '2.500', basis: 'MAXIMUM', nominal: '2.469', sourceKey: 'NEMA-EB71-T71-1A' });
    assert.deepStrictEqual(r.facts.racewayOutsideDiameterIn,
      { value: '2.197', basis: 'NOMINAL', nominal: '2.197', sourceKey: 'WHEATLAND-EMT-ANSI-C80.3' });
    assert.ok(r.sourceKeys.length === 2 && r.sourceKeys.every((k) => L0._data.SOURCES[k]), 'every key is registered');
    assert.ok(r.assumptions.includes('DATUM_AMBIGUITY_RACEWAY_OD_VS_OPENING_UNRESOLVED_IN_NEC_TEXT'));
    assert.strictEqual(r.physicalFitData, false);
  });

  test('multiple sizes and every supported raceway type resolve', () => {
    for (const [type, method] of [['EMT', 'KNOCKOUT_CONNECTOR'], ['RMC', 'KNOCKOUT_THREADED'],
      ['RMC', 'KNOCKOUT_HUB'], ['IMC', 'KNOCKOUT_THREADED'], ['PVC', 'KNOCKOUT_CONNECTOR']]) {
      for (const size of ['1/2', '1', '2', '4']) {
        const r = L0.resolveEntryGeometry({ tradeSize: size, racewayType: type, entryMethod: method });
        assert.strictEqual(r.status, 'CONSERVATIVE', type + ' ' + size + ' ' + method);
        assert.ok(r.entryMeasurementDiameterIn > 0);
      }
    }
    // RMC exists through 6"; EMT and IMC do not
    assert.strictEqual(KO('6').status, 'CONSERVATIVE');
    assert.strictEqual(L0.resolveEntryGeometry({ tradeSize: '6', racewayType: 'EMT', entryMethod: 'KNOCKOUT_CONNECTOR' }).status, 'UNSUPPORTED_SIZE');
    assert.strictEqual(L0.resolveEntryGeometry({ tradeSize: '5', racewayType: 'IMC', entryMethod: 'KNOCKOUT_THREADED' }).status, 'UNSUPPORTED_SIZE');
  });

  test('deterministic: repeated resolution is identical', () => {
    const a = JSON.stringify(L0.resolveEntryGeometry({ tradeSize: '3', racewayType: 'RMC', entryMethod: 'KNOCKOUT_HUB' }));
    const b = JSON.stringify(L0.resolveEntryGeometry({ tradeSize: '3', racewayType: 'RMC', entryMethod: 'KNOCKOUT_HUB' }));
    assert.strictEqual(a, b);
  });

  test('the raceway datum is never the nominal trade size', () => {
    for (const size of L0.TRADE_SIZE_KEYS) {
      const r = KO(size);
      const nominal = size.includes('/') ? eval(size.replace('-', '+')) : Number(size); // eslint-disable-line no-eval
      assert.notStrictEqual(r.entryMeasurementDiameterIn, nominal, size + ' must not equal trade size');
      assert.ok(r.entryMeasurementDiameterIn > nominal, 'openings are always larger than the trade size');
    }
  });

  test('conservative results are labelled conservative; only explicit input is DIRECT', () => {
    const r = L0.resolveEntryGeometry({ tradeSize: '1', racewayType: 'IMC', entryMethod: 'KNOCKOUT_THREADED' });
    assert.strictEqual(r.resolution, 'CONSERVATIVE');
    assert.ok(!('provenance' in r) || r.provenance !== 'USER_SUPPLIED');
    const e = L0.explicitEntryGeometry({ entryMeasurementDiameterIn: 2.2 });
    assert.strictEqual(e.resolution, 'DIRECT');
    assert.strictEqual(e.provenance, 'USER_SUPPLIED');
    assert.strictEqual(e.status, 'RESOLVED');
    assert.strictEqual(e.facts, null, 'no standards facts are attached to a user value');
    assert.ok(!code0.includes("resolution: 'DIRECT'") || code0.indexOf("resolution: 'DIRECT'") > code0.indexOf('function explicitEntryGeometry'),
      'DIRECT is only produced by the explicit path');
  });

  test('no fitting-body dimension is used as the NEC datum', () => {
    assert.ok(!/locknut|bushing|hubBody|flange/i.test(code0.replace(/description:[^\n]*/g, '')),
      'no locknut / bushing / hub-body values in the module');
    const r = L0.resolveEntryGeometry({ tradeSize: '2', racewayType: 'RMC', entryMethod: 'KNOCKOUT_HUB' });
    assert.strictEqual(r.datumFrom, 'ENCLOSURE_OPENING');
    assert.strictEqual(r.physicalFitData, false);
  });
});

describe('PBV2-13B-2 — unsupported and invalid input', () => {
  test('unsupported trade size / system / method / combination fail explicitly', () => {
    assert.strictEqual(L0.resolveEntryGeometry({ tradeSize: '7', racewayType: 'RMC', entryMethod: 'KNOCKOUT_THREADED' }).status, 'INVALID_INPUT');
    assert.strictEqual(L0.resolveEntryGeometry({ tradeSize: '2', racewayType: 'FMC', entryMethod: 'KNOCKOUT_CONNECTOR' }).status, 'UNSUPPORTED_SYSTEM');
    assert.strictEqual(L0.resolveEntryGeometry({ tradeSize: '2', racewayType: 'RMC', entryMethod: 'WELDED' }).status, 'UNSUPPORTED_SYSTEM');
    assert.strictEqual(L0.resolveEntryGeometry({ tradeSize: '2', racewayType: 'EMT', entryMethod: 'KNOCKOUT_THREADED' }).reason, 'INCOMPATIBLE_COMBINATION');
    assert.strictEqual(L0.resolveEntryGeometry({ tradeSize: '2', racewayType: 'RMC', entryMethod: 'THREADED_BOSS' }).reason, 'PENETRATION_NOT_MODELLED');
  });

  test('malformed sizes are rejected, never coerced', () => {
    for (const bad of ['2.0', '2"', 2, '0.5', ' 2', '2 ', null, undefined, 'two']) {
      const r = L0.resolveEntryGeometry({ tradeSize: bad, racewayType: 'RMC', entryMethod: 'KNOCKOUT_THREADED' });
      assert.strictEqual(r.status, 'INVALID_INPUT', String(bad));
    }
    assert.strictEqual(L0.resolveEntryGeometry(null).status, 'INVALID_INPUT');
    assert.strictEqual(L0.resolveEntryGeometry('2').status, 'INVALID_INPUT');
  });

  test('explicit geometry rejects zero, negative, NaN, Infinity and non-inch units', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, '2.2', null]) {
      assert.strictEqual(L0.explicitEntryGeometry({ entryMeasurementDiameterIn: bad }).status, 'INVALID_INPUT', String(bad));
    }
    assert.strictEqual(L0.explicitEntryGeometry({ entryMeasurementDiameterIn: 2.2, units: 'mm' }).reason, 'UNITS_MUST_BE_INCHES');
    assert.strictEqual(L0.explicitEntryGeometry({ entryMeasurementDiameterIn: 2.2, units: 'in' }).status, 'RESOLVED');
  });

  test('a failure never returns a number, zero or null-as-success', () => {
    const r = L0.resolveEntryGeometry({ tradeSize: '6', racewayType: 'EMT', entryMethod: 'KNOCKOUT_CONNECTOR' });
    assert.ok(!('entryMeasurementDiameterIn' in r));
    const b = L0.buildLayoutGeometry({ A: { tradeSize: '6', racewayType: 'EMT', entryMethod: 'KNOCKOUT_CONNECTOR' } });
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.failures[0].entryId, 'A');
    assert.ok(!b.geometry);
  });
});

describe('PBV2-13B-2 — data quality guards', () => {
  const { SOURCES, KNOCKOUT, RACEWAY_OD, KNOCKOUT_SOURCE, COMPATIBLE } = L0._data;
  const dec = /^\d+\.\d{3}$/;

  test('every knockout row: valid decimals, min < nominal < max, registered source', () => {
    assert.ok(SOURCES[KNOCKOUT_SOURCE]);
    // JS enumerates integer-like keys first, so compare as sets and iterate canonically
    assert.deepStrictEqual(Object.keys(KNOCKOUT).sort(), L0.TRADE_SIZE_KEYS.slice().sort(), 'one row per canonical size, no duplicates');
    let prev = 0;
    for (const size of L0.TRADE_SIZE_KEYS) {
      const k = KNOCKOUT[size];
      for (const v of [k.min, k.nominal, k.max]) assert.ok(dec.test(v), size + ': ' + v);
      assert.ok(Number(k.min) < Number(k.nominal) && Number(k.nominal) < Number(k.max), size + ' ordering');
      assert.ok(Number(k.max) > prev, size + ' sizes strictly increase'); prev = Number(k.max);
    }
  });

  test('every raceway row: valid decimals, positive, registered sources, no alias collisions', () => {
    for (const [type, table] of Object.entries(RACEWAY_OD)) {
      if (table.sourceKey !== null) assert.ok(SOURCES[table.sourceKey], type + ' source registered');
      if (table.maxSourceKey) assert.ok(SOURCES[table.maxSourceKey], type + ' max source registered');
      const present = Object.keys(table.sizes);
      assert.strictEqual(new Set(present).size, present.length, type + ' duplicate rows');
      const sizes = L0.TRADE_SIZE_KEYS.filter((k) => present.includes(k));   // canonical order
      assert.strictEqual(sizes.length, present.length, type + ' has a non-canonical size key');
      let prev = 0;
      for (const size of sizes) {
        assert.ok(L0.TRADE_SIZE_KEYS.includes(size), type + ' unknown size key ' + size);
        const row = table.sizes[size];
        assert.ok(dec.test(row.nominal) && Number(row.nominal) > 0);
        if (row.max) assert.ok(dec.test(row.max) && Number(row.max) > Number(row.nominal), type + ' ' + size + ' max > nominal');
        assert.ok(Number(row.nominal) > prev, type + ' ODs strictly increase'); prev = Number(row.nominal);
      }
    }
    // types with knockout methods must have a compatibility entry
    for (const type of L0.RACEWAY_TYPES) assert.ok(Array.isArray(COMPATIBLE[type]) && COMPATIBLE[type].length > 0);
  });

  test('sources carry auditable metadata and nothing copyrighted', () => {
    for (const [key, s] of Object.entries(SOURCES)) {
      for (const f of ['authority', 'document', 'edition', 'location', 'facts']) assert.ok(s[f], key + '.' + f);
    }
    assert.ok(src0.length < 20000, 'concise: factual values and provenance only');
  });

  test('the conservative comparison holds in the data: opening max >= raceway max/nominal', () => {
    for (const [type, table] of Object.entries(RACEWAY_OD)) {
      for (const [size, row] of Object.entries(table.sizes)) {
        const od = Number(row.max || row.nominal);
        assert.ok(Number(KNOCKOUT[size].max) >= od, type + ' ' + size + ': knockout must bound the raceway');
      }
    }
  });

  test('canonical trade-size keys are the Layer-1 keys, verbatim', () => {
    assert.deepStrictEqual(L0.TRADE_SIZE_KEYS, L1.TRADE_SIZE_KEYS);
  });

  test('decimal values resolve identically across runs, without float artefacts', () => {
    const r = KO('3');
    assert.strictEqual(r.entryMeasurementDiameterDecimal, '3.625');
    assert.strictEqual(String(r.entryMeasurementDiameterIn), '3.625');
    assert.strictEqual(L2._internal.toMicro(r.entryMeasurementDiameterIn, 'up'), 3625000n, 'exact in Layer 2 too');
  });
});

describe('PBV2-13B-2 — Layer 1 -> Layer 0 -> Layer 2 integration', () => {
  function request(entries, conns) {
    const rows = {}; const req = { rows: [], entries: [], connections: [] };
    for (const [id, e] of Object.entries(entries)) {
      const rowId = 'row-' + e.wall;
      if (!rows[rowId]) { rows[rowId] = true; req.rows.push({ id: rowId, wall: e.wall, order: 0 }); }
      req.entries.push({ id, rowId, tradeSize: e.tradeSize });
    }
    conns.forEach((c, i) => req.connections.push({ id: 'c' + i, entryIds: [c.a, c.b] }));
    return req;
  }
  const spec = (entries, type, method) => Object.fromEntries(Object.entries(entries)
    .map(([id, e]) => [id, { tradeSize: e.tradeSize, racewayType: type, entryMethod: method }]));

  test('A–C. resolve a real system, feed Layer 2, get a certified result', () => {
    const entries = { A: { wall: 'bottom', tradeSize: '3' }, B: { wall: 'bottom', tradeSize: '3' } };
    const req = request(entries, [{ a: 'A', b: 'B' }]);
    const l1 = L1.calculatePullBox(req);
    const l0 = L0.buildLayoutGeometry(spec(entries, 'RMC', 'KNOCKOUT_THREADED'));
    assert.strictEqual(l0.ok, true);
    assert.strictEqual(l0.geometry.datumPolicy, 'CONSERVATIVE');
    assert.strictEqual(l0.geometry.entries.A.entryMeasurementDiameterIn, 3.625);
    const f = L2.findLayoutDimensions({ request: req, result: l1, geometry: l0.geometry, policy: 'WIDTH', heightIn: l1.minimumHeightIn, toleranceIn: 1 / 64 });
    assert.strictEqual(f.status, 'CERTIFIED_WITHIN_TOLERANCE');
    // exact analytic bound: S + rA + rB + 2r  = 18 + 3.625*2  = 25.25
    assert.ok(Math.abs(f.widthIn - 25.25) <= 1 / 64, 'certified width ' + f.widthIn);
    assert.ok(f.placements.A && f.placements.B);
  });

  test('E. geometry provenance does not alter the Layer-1 rule result', () => {
    const entries = { A: { wall: 'left', tradeSize: '2' }, B: { wall: 'top', tradeSize: '2' } };
    const req = request(entries, [{ a: 'A', b: 'B' }]);
    const before = JSON.stringify(L1.calculatePullBox(req));
    L0.buildLayoutGeometry(spec(entries, 'EMT', 'KNOCKOUT_CONNECTOR'));
    L0.buildLayoutGeometry({ A: { entryMeasurementDiameterIn: 9 }, B: { entryMeasurementDiameterIn: 9 } });
    assert.strictEqual(JSON.stringify(L1.calculatePullBox(req)), before);
  });

  /** Minimal certified dimension for a given per-entry diameter. */
  function minWith(entries, conns, dia, policy, fixed) {
    const req = request(entries, conns);
    const l1 = L1.calculatePullBox(req);
    const geometry = { units: 'in', entries: Object.fromEntries(Object.keys(entries).map((id) => [id, { entryMeasurementDiameterIn: dia }])) };
    return L2.findLayoutDimensions({ request: req, result: l1, geometry, policy, toleranceIn: 1 / 64, ...fixed });
  }

  test('D/27. SAME-WALL U: a larger datum never yields a smaller certified width', () => {
    const entries = { A: { wall: 'bottom', tradeSize: '3' }, B: { wall: 'bottom', tradeSize: '3' } };
    const conns = [{ a: 'A', b: 'B' }];
    let prev = 0;
    for (const dia of [2.2, 3.5, 3.594, 3.625, 4.0]) {
      const f = minWith(entries, conns, dia, 'WIDTH', { heightIn: 21 });
      assert.strictEqual(f.status, 'CERTIFIED_WITHIN_TOLERANCE');
      assert.ok(f.widthIn >= prev - 1e-9, 'dia ' + dia + ': ' + f.widthIn + ' < ' + prev);
      prev = f.widthIn;
    }
    // and analytically: W = 18 + 2*dia  -> strictly increasing in dia
    assert.ok(Math.abs(minWith(entries, conns, 3.625, 'WIDTH', { heightIn: 21 }).widthIn - 25.25) <= 1 / 64);
  });

  test('28. ANGLE: a larger datum never yields a smaller certified dimension', () => {
    const entries = { A: { wall: 'left', tradeSize: '2' }, B: { wall: 'top', tradeSize: '2' }, C: { wall: 'bottom', tradeSize: '2' } };
    const conns = [{ a: 'A', b: 'B' }, { a: 'A', b: 'C' }];   // shared-raceway angle case
    let prev = 0;
    for (const dia of [2.0, 2.2, 2.469, 2.5, 3.0]) {
      const f = minWith(entries, conns, dia, 'WIDTH', { heightIn: 12 });
      assert.ok(['CERTIFIED_WITHIN_TOLERANCE', 'CERTIFIED_BOUNDS'].includes(f.status));
      assert.ok(f.widthIn >= prev - 1e-9, 'dia ' + dia + ': ' + f.widthIn + ' < ' + prev);
      prev = f.widthIn;
    }
  });

  test('29. MIXED straight + angle + U: monotone in the datum on both axes', () => {
    const entries = { L4: { wall: 'left', tradeSize: '4' }, R4: { wall: 'right', tradeSize: '4' }, L2: { wall: 'left', tradeSize: '2' },
      T2: { wall: 'top', tradeSize: '2' }, B3a: { wall: 'bottom', tradeSize: '3' }, B3b: { wall: 'bottom', tradeSize: '3' } };
    const conns = [{ a: 'L4', b: 'R4' }, { a: 'L2', b: 'T2' }, { a: 'B3a', b: 'B3b' }];
    let prevW = 0; let prevH = 0;
    for (const dia of [2.2, 3.0, 3.625]) {
      const fw = minWith(entries, conns, dia, 'WIDTH', { heightIn: 30 });
      const fh = minWith(entries, conns, dia, 'HEIGHT', { widthIn: 40 });
      assert.ok(fw.widthIn >= prevW - 1e-9 && fh.heightIn >= prevH - 1e-9, 'dia ' + dia);
      prevW = fw.widthIn; prevH = fh.heightIn;
    }
  });

  test('feasibility itself is antitone in the datum: feasible at a larger datum implies feasible at a smaller one', () => {
    const entries = { A: { wall: 'left', tradeSize: '2' }, B: { wall: 'bottom', tradeSize: '3' } };
    const req = request(entries, [{ a: 'A', b: 'B' }]);
    const l1 = L1.calculatePullBox(req);
    const check = (dA, dB) => L2.checkLayout({ request: req, result: l1,
      geometry: { units: 'in', entries: { A: { entryMeasurementDiameterIn: dA }, B: { entryMeasurementDiameterIn: dB } } },
      widthIn: 12, heightIn: 18 }).status;
    // toy datum feasible, knockout maxima infeasible: the direction of the policy is the safe one
    assert.strictEqual(check(2.2, 3.3), 'FEASIBLE');
    assert.strictEqual(check(2.5, 3.625), 'INFEASIBLE');
    assert.strictEqual(check(2.2, 3.625), 'INFEASIBLE');
  });

  test('a resolver failure is a whole-request failure — no partial geometry reaches Layer 2', () => {
    const entries = { A: { wall: 'left', tradeSize: '5' }, B: { wall: 'right', tradeSize: '5' } };
    const l0 = L0.buildLayoutGeometry(spec(entries, 'EMT', 'KNOCKOUT_CONNECTOR'));
    assert.strictEqual(l0.ok, false);
    assert.strictEqual(l0.failures.length, 2);
    assert.strictEqual(l0.failures[0].status, 'UNSUPPORTED_SIZE');
  });
});
