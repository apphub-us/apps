'use strict';
/**
 * Pull Box V2 foundation tests (PBV2-1): data model, validation contract,
 * deterministic ordering, geometric classification. NO electrical formulas
 * are tested here — 8x / 6x / spacing / governing arrive in PBV2-2..5.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  TRADE_SIZE_IN, TRADE_SIZE_KEYS, WALL_ORDER, WALL_DIMENSION,
  validatePullBoxRequest, classifyConnection, sortRows, sortEntries,
} = require('../src/calc/pullBox');

const row = (id, wall, order) => ({ id, wall, order });
const entry = (id, rowId, tradeSize) => ({ id, rowId, tradeSize });
const conn = (id, a, b) => ({ id, entryIds: [a, b] });

/** A representative valid box: entries on all four walls, one of each
 *  connection type, one deliberately unconnected entry. */
function fixture() {
  return {
    rows: [
      row('rL1', 'left', 0), row('rL2', 'left', 2),
      row('rR1', 'right', 0), row('rT1', 'top', 0), row('rB1', 'bottom', 0),
    ],
    entries: [
      entry('eL1', 'rL1', '4'), entry('eL2', 'rL1', '2'),
      entry('eL3', 'rL2', '3'),
      entry('eR1', 'rR1', '4'),
      entry('eT1', 'rT1', '2'),
      entry('eB1', 'rB1', '3'),
    ],
    connections: [
      conn('cStraight', 'eL1', 'eR1'),   // left ↔ right
      conn('cAngle', 'eL2', 'eT1'),      // left ↔ top
      conn('cU', 'eL3', 'eL1'),          // left ↔ left (shares eL1: fine)
    ],
  };
}

describe('PBV2-1 — canonical model constants', () => {
  test('trade sizes: exactly the twelve string keys, correct inches', () => {
    // Set equality via sorted keys — JS reorders integer-like object keys,
    // so ORDER comes from TRADE_SIZE_KEYS, never Object.keys().
    assert.deepStrictEqual(Object.keys(TRADE_SIZE_IN).sort(),
      TRADE_SIZE_KEYS.slice().sort());
    assert.deepStrictEqual(TRADE_SIZE_KEYS,
      ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4', '5', '6'],
      'canonical ascending order');
    TRADE_SIZE_KEYS.reduce((prev, k) => {
      assert.ok(TRADE_SIZE_IN[k] > prev, k + ' ascending');
      return TRADE_SIZE_IN[k];
    }, 0);
    assert.strictEqual(TRADE_SIZE_IN['1/2'], 0.5);
    assert.strictEqual(TRADE_SIZE_IN['1-1/4'], 1.25);
    assert.strictEqual(TRADE_SIZE_IN['3-1/2'], 3.5);
    assert.strictEqual(TRADE_SIZE_IN['6'], 6);
  });

  test('wall order and orientation are the single canonical maps', () => {
    assert.deepStrictEqual(WALL_ORDER, ['left', 'right', 'top', 'bottom']);
    assert.deepStrictEqual(WALL_DIMENSION,
      { left: 'width', right: 'width', top: 'height', bottom: 'height' });
  });
});

describe('PBV2-1 — valid requests', () => {
  test('one row, one entry, no connections: valid with one grouped warning', () => {
    const r = validatePullBoxRequest({
      rows: [row('r1', 'left', 0)],
      entries: [entry('e1', 'r1', '3')],
      connections: [],
    });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.warnings, [{ code: 'UNCONNECTED_ENTRY', entryIds: ['e1'] }]);
  });

  test('four walls may all use order 0', () => {
    const r = validatePullBoxRequest({
      rows: WALL_ORDER.map((w, i) => row('r' + i, w, 0)),
      entries: [entry('e1', 'r0', '1/2')],
      connections: [],
    });
    assert.strictEqual(r.ok, true);
  });

  test('non-contiguous row orders on one wall are valid; engine never rewrites them', () => {
    const r = validatePullBoxRequest({
      rows: [row('a', 'left', 0), row('b', 'left', 2), row('c', 'left', 7)],
      entries: [entry('e1', 'b', '2')],
      connections: [],
    });
    assert.strictEqual(r.ok, true);
  });

  test('the full fixture (all connection types + unconnected entries) is valid', () => {
    const r = validatePullBoxRequest(fixture());
    assert.strictEqual(r.ok, true);
    // grouped, sorted warning — one object, not one per entry
    assert.deepStrictEqual(r.warnings,
      [{ code: 'UNCONNECTED_ENTRY', entryIds: ['eB1'] }]);
  });

  test('every supported trade size validates', () => {
    for (const size of Object.keys(TRADE_SIZE_IN)) {
      const r = validatePullBoxRequest({
        rows: [row('r1', 'top', 0)],
        entries: [entry('e1', 'r1', size)],
        connections: [],
      });
      assert.strictEqual(r.ok, true, size);
    }
  });
});

describe('PBV2-1 — malformed requests fail structurally, never throw', () => {
  test('non-object requests', () => {
    for (const bad of [null, undefined, [], 'box', 42]) {
      const r = validatePullBoxRequest(bad);
      assert.strictEqual(r.ok, false, String(bad));
      assert.strictEqual(r.reason, 'MALFORMED_REQUEST', String(bad));
    }
  });

  test('missing or non-array collections', () => {
    for (const req of [
      {}, { rows: [] }, { rows: [], entries: [] },
      { rows: 'x', entries: [], connections: [] },
      { rows: [], entries: {}, connections: [] },
      { rows: [], entries: [], connections: 'y' },
    ]) {
      const r = validatePullBoxRequest(req);
      assert.strictEqual(r.reason, 'MALFORMED_REQUEST', JSON.stringify(req));
    }
  });

  test('malformed member object shapes', () => {
    const base = fixture();
    for (const [mutate, label] of [
      [(q) => q.rows.push(null), 'null row'],
      [(q) => q.rows.push(['x']), 'array row'],
      [(q) => q.entries.push('e'), 'string entry'],
      [(q) => q.connections.push(7), 'number connection'],
      [(q) => q.connections.push({ id: 'cX' }), 'connection missing entryIds'],
      [(q) => q.connections.push({ id: 'cX', entryIds: 'eL1' }), 'non-array entryIds'],
    ]) {
      const q = fixture(); mutate(q);
      const r = validatePullBoxRequest(q);
      assert.strictEqual(r.ok, false, label);
      assert.strictEqual(r.reason, 'MALFORMED_REQUEST', label);
    }
    assert.strictEqual(validatePullBoxRequest(base).ok, true, 'fixture itself stays valid');
  });

  test('empty and whitespace-only ids are MALFORMED_REQUEST (no new codes, no trimming)', () => {
    for (const badId of ['', '   ', '\t']) {
      const q1 = fixture(); q1.rows[0] = row(badId, 'left', 9);
      assert.strictEqual(validatePullBoxRequest(q1).reason, 'MALFORMED_REQUEST', 'row id');
      const q2 = fixture(); q2.entries.push(entry(badId, 'rL1', '2'));
      assert.strictEqual(validatePullBoxRequest(q2).reason, 'MALFORMED_REQUEST', 'entry id');
      const q3 = fixture(); q3.connections.push({ id: badId, entryIds: ['eT1', 'eB1'] });
      assert.strictEqual(validatePullBoxRequest(q3).reason, 'MALFORMED_REQUEST', 'connection id');
    }
  });
});

describe('PBV2-1 — row validation', () => {
  const withRows = (rows) => ({ rows, entries: [entry('e1', rows[0].id, '2')], connections: [] });

  test('duplicate row id', () => {
    const r = validatePullBoxRequest(withRows([row('r1', 'left', 0), row('r1', 'right', 0)]));
    assert.strictEqual(r.reason, 'DUPLICATE_ROW_ID');
    assert.strictEqual(r.rowId, 'r1');
  });

  test('reserved surfaces get their own diagnostic; unknown walls do not', () => {
    for (const wall of ['back', 'front']) {
      const r = validatePullBoxRequest(withRows([row('r1', wall, 0)]));
      assert.strictEqual(r.reason, 'UNSUPPORTED_SURFACE', wall);
      assert.strictEqual(r.wall, wall);
    }
    for (const wall of ['north', 'LEFT', '', 3, null, undefined]) {
      const r = validatePullBoxRequest(withRows([row('r1', wall, 0)]));
      assert.strictEqual(r.reason, 'INVALID_WALL', String(wall));
    }
  });

  test('invalid orders', () => {
    for (const order of [-1, 1.5, NaN, Infinity, '0', null, undefined]) {
      const r = validatePullBoxRequest(withRows([row('r1', 'left', order)]));
      assert.strictEqual(r.reason, 'INVALID_ROW_ORDER', String(order));
    }
  });

  test('duplicate order on ONE wall fails; same order on different walls is fine', () => {
    const dup = validatePullBoxRequest(withRows([row('r1', 'left', 3), row('r2', 'left', 3)]));
    assert.strictEqual(dup.reason, 'INVALID_ROW_ORDER');
    assert.strictEqual(dup.detail, 'duplicate order on one wall');
    const ok = validatePullBoxRequest(withRows([row('r1', 'left', 3), row('r2', 'right', 3)]));
    assert.strictEqual(ok.ok, true);
  });
});

describe('PBV2-1 — entry validation', () => {
  test('duplicate entry id', () => {
    const q = fixture(); q.entries.push(entry('eL1', 'rR1', '2'));
    const r = validatePullBoxRequest(q);
    assert.strictEqual(r.reason, 'DUPLICATE_ENTRY_ID');
    assert.strictEqual(r.entryId, 'eL1');
  });

  test('unknown or malformed rowId', () => {
    for (const rowId of ['nope', '', 7, null, undefined]) {
      const q = fixture(); q.entries.push(entry('eX', rowId, '2'));
      const r = validatePullBoxRequest(q);
      assert.strictEqual(r.reason, 'ROW_UNKNOWN', String(rowId));
      assert.strictEqual(r.entryId, 'eX');
    }
  });

  test('trade-size identity is the string key only — no aliases, no numbers', () => {
    for (const bad of [0.5, 1.25, '0.5', '1.25', '2.0', '7', 'four', '', null]) {
      const q = fixture(); q.entries.push(entry('eX', 'rT1', bad));
      const r = validatePullBoxRequest(q);
      assert.strictEqual(r.reason, 'INVALID_TRADE_SIZE', String(bad));
    }
  });

  test('NO_ENTRIES: rows alone are not a sizable box', () => {
    const r = validatePullBoxRequest({ rows: [row('r1', 'left', 0)], entries: [], connections: [] });
    assert.strictEqual(r.reason, 'NO_ENTRIES');
  });
});

describe('PBV2-1 — connection validation', () => {
  test('duplicate connection id', () => {
    const q = fixture(); q.connections.push(conn('cStraight', 'eT1', 'eB1'));
    assert.strictEqual(validatePullBoxRequest(q).reason, 'DUPLICATE_CONNECTION_ID');
  });

  test('arity: 0, 1 and 3 endpoints are rejected — MVP pulls are exactly two', () => {
    for (const ids of [[], ['eL1'], ['eL1', 'eR1', 'eT1']]) {
      const q = fixture(); q.connections.push({ id: 'cX', entryIds: ids });
      const r = validatePullBoxRequest(q);
      assert.strictEqual(r.reason, 'CONNECTION_ARITY', String(ids.length));
      assert.strictEqual(r.arity, ids.length);
    }
  });

  test('unknown endpoints, first and second position', () => {
    for (const ids of [['ghost', 'eR1'], ['eL1', 'ghost']]) {
      const q = fixture(); q.connections.push({ id: 'cX', entryIds: ids });
      const r = validatePullBoxRequest(q);
      assert.strictEqual(r.reason, 'CONNECTION_UNKNOWN_ENTRY');
      assert.strictEqual(r.entryId, 'ghost');
    }
  });

  test('self connection', () => {
    const q = fixture(); q.connections.push({ id: 'cX', entryIds: ['eT1', 'eT1'] });
    assert.strictEqual(validatePullBoxRequest(q).reason, 'CONNECTION_SELF');
  });

  test('duplicate unordered pair: same order and reversed order both fail', () => {
    for (const ids of [['eL1', 'eR1'], ['eR1', 'eL1']]) {
      const q = fixture(); q.connections.push({ id: 'cDup', entryIds: ids });
      const r = validatePullBoxRequest(q);
      assert.strictEqual(r.reason, 'DUPLICATE_CONNECTION', JSON.stringify(ids));
      assert.strictEqual(r.connectionId, 'cDup');
    }
  });
});

describe('PBV2-1 — classification', () => {
  const box = () => ({
    rows: [row('rL', 'left', 0), row('rR', 'right', 0),
      row('rT', 'top', 0), row('rB', 'bottom', 0)],
    entries: [entry('eL', 'rL', '4'), entry('eL2', 'rL', '2'),
      entry('eR', 'rR', '4'), entry('eT', 'rT', '2'),
      entry('eT2', 'rT', '3'), entry('eB', 'rB', '3')],
  });

  test('all wall pairings classify per the frozen derivation', () => {
    const b = box();
    const cases = [
      [['eL', 'eR'], 'STRAIGHT', 'width'],
      [['eT', 'eB'], 'STRAIGHT', 'height'],
      [['eL', 'eT'], 'ANGLE', undefined],
      [['eL', 'eB'], 'ANGLE', undefined],
      [['eR', 'eT'], 'ANGLE', undefined],
      [['eR', 'eB'], 'ANGLE', undefined],
      [['eL', 'eL2'], 'U', undefined],
      [['eT', 'eT2'], 'U', undefined],
    ];
    for (const [ids, type, dimension] of cases) {
      const r = classifyConnection({ id: 'c', entryIds: ids }, b.entries, b.rows);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.type, type, JSON.stringify(ids));
      assert.strictEqual(r.dimension, dimension, JSON.stringify(ids));
    }
  });

  test('endpoint order never changes classification', () => {
    const b = box();
    for (const ids of [['eL', 'eR'], ['eL', 'eT'], ['eL', 'eL2']]) {
      const fwd = classifyConnection({ id: 'c', entryIds: ids }, b.entries, b.rows);
      const rev = classifyConnection({ id: 'c', entryIds: [ids[1], ids[0]] }, b.entries, b.rows);
      assert.strictEqual(fwd.type, rev.type, JSON.stringify(ids));
      assert.strictEqual(fwd.dimension, rev.dimension, JSON.stringify(ids));
    }
  });

  test('unknown endpoint or dangling row fail structurally', () => {
    const b = box();
    const bad = classifyConnection({ id: 'c', entryIds: ['ghost', 'eR'] }, b.entries, b.rows);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.reason, 'CONNECTION_UNKNOWN_ENTRY');
    const dangling = classifyConnection({ id: 'c', entryIds: ['eL', 'eR'] }, b.entries, []);
    assert.strictEqual(dangling.reason, 'ROW_UNKNOWN');
  });
});

describe('PBV2-1 — deterministic ordering helpers', () => {
  test('sortRows: wall order, then order, then id — new array, input untouched', () => {
    const rows = [row('z', 'bottom', 0), row('b', 'left', 2), row('a', 'left', 0),
      row('t', 'top', 1), row('t0', 'top', 0), row('r', 'right', 5)];
    const snapshot = JSON.stringify(rows);
    const sorted = sortRows(rows);
    assert.deepStrictEqual(sorted.map((r) => r.id), ['a', 'b', 'r', 't0', 't', 'z']);
    assert.notStrictEqual(sorted, rows);
    assert.strictEqual(JSON.stringify(rows), snapshot, 'sortRows mutated its input');
  });

  test('sortEntries: parent-row rank then id — new array, inputs untouched', () => {
    const rows = [row('rB', 'bottom', 0), row('rL', 'left', 0)];
    const entries = [entry('e9', 'rB', '2'), entry('e1', 'rB', '3'),
      entry('e5', 'rL', '4'), entry('e2', 'rL', '2')];
    const snapE = JSON.stringify(entries);
    const sorted = sortEntries(entries, rows);
    assert.deepStrictEqual(sorted.map((e) => e.id), ['e2', 'e5', 'e1', 'e9']);
    assert.strictEqual(JSON.stringify(entries), snapE);
  });
});

describe('PBV2-1 — input immutability and determinism', () => {
  test('validation never mutates a deep-frozen request', () => {
    const q = fixture();
    Object.freeze(q); Object.freeze(q.rows); Object.freeze(q.entries);
    Object.freeze(q.connections);
    q.rows.forEach(Object.freeze); q.entries.forEach(Object.freeze);
    q.connections.forEach((c) => { Object.freeze(c); Object.freeze(c.entryIds); });
    const snapshot = JSON.stringify(q);
    const r = validatePullBoxRequest(q);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(JSON.stringify(q), snapshot);
    // classification and sorting on frozen data likewise
    classifyConnection(q.connections[0], q.entries, q.rows);
    sortRows(q.rows); sortEntries(q.entries, q.rows);
    assert.strictEqual(JSON.stringify(q), snapshot);
  });

  test('shuffled input order never changes any outcome (seeded shuffles)', () => {
    let seed = 0x9B0C;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const base = fixture();
    const ref = validatePullBoxRequest(base);
    const refRows = JSON.stringify(sortRows(base.rows));
    const refEntries = JSON.stringify(sortEntries(base.entries, base.rows));
    for (let i = 0; i < 25; i++) {
      const q = {
        rows: shuffle(base.rows),
        entries: shuffle(base.entries),
        connections: shuffle(base.connections),
      };
      const r = validatePullBoxRequest(q);
      assert.deepStrictEqual(r, ref, 'shuffle #' + i);
      assert.strictEqual(JSON.stringify(sortRows(q.rows)), refRows, 'rows #' + i);
      assert.strictEqual(JSON.stringify(sortEntries(q.entries, q.rows)), refEntries,
        'entries #' + i);
      for (const c of base.connections) {
        const cls = classifyConnection(c, q.entries, q.rows);
        assert.strictEqual(cls.type,
          classifyConnection(c, base.entries, base.rows).type, c.id);
      }
    }
  });
});

describe('PBV2-1 — no electrical logic yet', () => {
  test('the module exports no formula arithmetic and no NEC results', () => {
    const api = require('../src/calc/pullBox');
    assert.deepStrictEqual(Object.keys(api).sort(), [
      'TRADE_SIZE_IN', 'TRADE_SIZE_KEYS', 'WALL_DIMENSION', 'WALL_ORDER',
      'calculatePullBox', 'classifyConnection', 'rowForEntry', 'sortEntries',
      'sortRows', 'validatePullBoxRequest',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-2 — Straight Pull engine (NEC 314.28(A)(1))
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-2 — straight-pull calculation', () => {
  const { calculatePullBox } = require('../src/calc/pullBox');

  /** Two rows per axis; helper to build a two-entry straight box. */
  function straightBox(wallA, sizeA, wallB, sizeB) {
    return {
      rows: [row('rA', wallA, 0), row('rB', wallB, 0)],
      entries: [entry('a', 'rA', sizeA), entry('b', 'rB', sizeB)],
      connections: [conn('c1', 'a', 'b')],
    };
  }

  test('INDEPENDENT PINS: all twelve trade sizes, hand-stated expected values', () => {
    // Explicit constants — NOT derived from TRADE_SIZE_IN — so the test
    // checks the rule, not the function against itself. 8 x trade size:
    const expected = {
      '1/2': 4, '3/4': 6, '1': 8, '1-1/4': 10, '1-1/2': 12, '2': 16,
      '2-1/2': 20, '3': 24, '3-1/2': 28, '4': 32, '5': 40, '6': 48,
    };
    for (const [size, inches] of Object.entries(expected)) {
      const r = calculatePullBox(straightBox('left', size, 'right', size));
      assert.strictEqual(r.ok, true, size);
      assert.strictEqual(r.minimumWidthIn, inches, size);
      assert.strictEqual(r.widthRequirements[0].minimumInches, inches, size);
      assert.strictEqual(r.widthRequirements[0].multiplier, 8, size);
    }
  });

  test('unequal endpoints use the LARGER trade size, both endpoint orders', () => {
    const fwd = calculatePullBox(straightBox('left', '4', 'right', '2'));
    assert.strictEqual(fwd.minimumWidthIn, 32, '8 x 4, not 8 x 2');
    assert.strictEqual(fwd.widthRequirements[0].largestTradeSize, '4');
    const rev = calculatePullBox(straightBox('left', '2', 'right', '4'));
    assert.strictEqual(rev.minimumWidthIn, 32);
    assert.strictEqual(rev.widthRequirements[0].largestTradeSize, '4');
  });

  test('ORIENTATION PINS: axis decides the dimension, endpoint order never does', () => {
    for (const [wallA, wallB, dim] of [
      ['left', 'right', 'width'], ['right', 'left', 'width'],
      ['top', 'bottom', 'height'], ['bottom', 'top', 'height'],
    ]) {
      const r = calculatePullBox(straightBox(wallA, '3', wallB, '3'));
      const reqs = dim === 'width' ? r.widthRequirements : r.heightRequirements;
      assert.strictEqual(reqs.length, 1, wallA + '/' + wallB);
      assert.strictEqual(reqs[0].dimension, dim, wallA + '/' + wallB);
      const other = dim === 'width' ? r.heightRequirements : r.widthRequirements;
      assert.strictEqual(other.length, 0);
    }
  });

  test('requirement shape carries the full frozen explainability contract', () => {
    const r = calculatePullBox(straightBox('top', '5', 'bottom', '3'));
    assert.deepStrictEqual(r.heightRequirements[0], {
      id: 'straight:c1',
      kind: 'STRAIGHT',
      dimension: 'height',
      connectionId: 'c1',
      entryIds: ['a', 'b'],
      largestTradeSize: '5',
      otherTradeSizes: [],
      multiplier: 8,
      minimumInches: 40,
      codeRef: { code: 'NEC', section: '314.28(A)(1)' },
    });
  });

  test('multiple straight pulls on ONE dimension: the larger governs', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a4', 'rL', '4'), entry('b4', 'rR', '4'),
        entry('a2', 'rL', '2'), entry('b2', 'rR', '2')],
      connections: [conn('cBig', 'a4', 'b4'), conn('cSmall', 'a2', 'b2')],
    });
    assert.strictEqual(r.minimumWidthIn, 32);
    assert.strictEqual(r.governingWidthRequirementId, 'straight:cBig');
    assert.deepStrictEqual(r.widthRequirements.map((q) => q.minimumInches).sort((x, y) => x - y),
      [16, 32]);
  });

  test('width and height are governed INDEPENDENTLY', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0),
        row('rT', 'top', 0), row('rB', 'bottom', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4'),
        entry('c', 'rT', '3'), entry('d', 'rB', '3')],
      connections: [conn('cW', 'a', 'b'), conn('cH', 'c', 'd')],
    });
    assert.strictEqual(r.minimumWidthIn, 32);
    assert.strictEqual(r.minimumHeightIn, 24);
    assert.strictEqual(r.governingWidthRequirementId, 'straight:cW');
    assert.strictEqual(r.governingHeightRequirementId, 'straight:cH');
    assert.strictEqual(r.completeForRequest, true);
  });

  test('tie between equal requirements breaks by ascending requirement id', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a1', 'rL', '3'), entry('b1', 'rR', '3'),
        entry('a2', 'rL', '3'), entry('b2', 'rR', '3')],
      connections: [conn('cZeta', 'a1', 'b1'), conn('cAlpha', 'a2', 'b2')],
    });
    assert.strictEqual(r.minimumWidthIn, 24);
    assert.strictEqual(r.governingWidthRequirementId, 'straight:cAlpha',
      'deterministic tie-break: first in id order, never input order');
  });

  test('an entry may serve multiple straight pulls (no invented topology rule)', () => {
    // LEFT 4" connected to RIGHT 4" and separately to RIGHT 2".
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4'), entry('b2', 'rR', '2')],
      connections: [conn('c1', 'a', 'b'), conn('c2', 'a', 'b2')],
    });
    assert.strictEqual(r.widthRequirements.length, 2);
    assert.deepStrictEqual(r.widthRequirements.map((q) => q.minimumInches), [32, 32],
      'both pairs contain the 4-inch entry, so both are 8 x 4');
    assert.strictEqual(r.minimumWidthIn, 32);
  });

  test('NO-CANDIDATE semantics: null + scope note, never zero', () => {
    const r = calculatePullBox(straightBox('left', '2', 'right', '2'));
    assert.strictEqual(r.minimumHeightIn, null);
    assert.strictEqual(r.governingHeightRequirementId, null);
    assert.ok(r.scopeNotes.some((n) => n.code === 'NO_HEIGHT_CANDIDATES'));
    assert.ok(!r.scopeNotes.some((n) => n.code === 'NO_WIDTH_CANDIDATES'));
  });

  test('an unconnected entry NEVER creates a dimension requirement', () => {
    // A 6" raceway sitting on the left wall with no pull relationship.
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('big', 'rL', '6'), entry('a', 'rL', '2'), entry('b', 'rR', '2')],
      connections: [conn('c1', 'a', 'b')],
    });
    assert.strictEqual(r.minimumWidthIn, 16, 'the 6-inch entry contributes nothing');
    assert.deepStrictEqual(r.warnings, [{ code: 'UNCONNECTED_ENTRY', entryIds: ['big'] }]);
    assert.strictEqual(r.widthRequirements.length, 1);
  });

  test('ANGLE/U requests are now FULLY evaluated: dimensions + spacing, no deferral notes', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4'),
        entry('t', 'rT', '2'), entry('a2', 'rL', '2'), entry('a3', 'rL', '3')],
      connections: [conn('cS', 'a', 'b'), conn('cAngle', 'a2', 't'),
        conn('cU', 'a3', 'a')],
    });
    assert.strictEqual(r.ok, true);
    // width candidates: straight 8x4=32 and left row (4,2,3) 6x4+2+3=29
    assert.strictEqual(r.minimumWidthIn, 32);
    assert.strictEqual(r.minimumHeightIn, 12);
    assert.strictEqual(r.completeForRequest, true, 'spacing is now implemented');
    // REGRESSION: both temporary milestone notes are gone forever
    assert.ok(!r.scopeNotes.some((n) => n.code === 'A2_SPACING_NOT_CALCULATED'));
    assert.ok(!r.scopeNotes.some((n) => n.code === 'ANGLE_U_NOT_CALCULATED'));
    assert.strictEqual(r.spacingRequirements.length, 2, 'one per angle/U connection');
    assert.deepStrictEqual(r.spacingRequirements.map((s) => s.id),
      ['spacing:cAngle', 'spacing:cU'], 'id-sorted');
  });

  test('completeForRequest is true only for all-straight requests', () => {
    const allStraight = calculatePullBox(straightBox('left', '3', 'right', '3'));
    assert.strictEqual(allStraight.completeForRequest, true);
    assert.ok(!allStraight.scopeNotes.some((n) => n.code === 'ANGLE_U_NOT_CALCULATED'));
  });

  test('validation failures pass through unchanged — no electrical work on bad input', () => {
    const cases = [
      [null, 'MALFORMED_REQUEST'],
      [{ rows: [], entries: [], connections: [] }, 'NO_ENTRIES'],
      [{ rows: [row('r1', 'north', 0)], entries: [entry('e', 'r1', '2')],
        connections: [] }, 'INVALID_WALL'],
      [{ rows: [row('r1', 'left', 0)], entries: [entry('e', 'r1', '7')],
        connections: [] }, 'INVALID_TRADE_SIZE'],
    ];
    for (const [req, reason] of cases) {
      const r = calculatePullBox(req);
      assert.strictEqual(r.ok, false, reason);
      assert.strictEqual(r.reason, reason);
      assert.strictEqual(r.minimumWidthIn, undefined, 'no partial result fields');
    }
    // duplicate pair + unknown entry passthrough
    const dup = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a', 'rL', '2'), entry('b', 'rR', '2')],
      connections: [conn('c1', 'a', 'b'), conn('c2', 'b', 'a')],
    });
    assert.strictEqual(dup.reason, 'DUPLICATE_CONNECTION');
    const ghost = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '2')],
      connections: [conn('c1', 'a', 'ghost')],
    });
    assert.strictEqual(ghost.reason, 'CONNECTION_UNKNOWN_ENTRY');
  });

  test('IMMUTABILITY: a deep-frozen request calculates without mutation', () => {
    const q = {
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '2'), entry('t', 'rT', '1')],
      connections: [conn('c1', 'a', 'b'), conn('c2', 'a', 't')],
    };
    Object.freeze(q); Object.freeze(q.rows); Object.freeze(q.entries);
    Object.freeze(q.connections);
    q.rows.forEach(Object.freeze); q.entries.forEach(Object.freeze);
    q.connections.forEach((c) => { Object.freeze(c); Object.freeze(c.entryIds); });
    const snapshot = JSON.stringify(q);
    const r = calculatePullBox(q);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(JSON.stringify(q), snapshot);
  });

  test('DETERMINISM: shuffled inputs yield deep-equal results, ids included', () => {
    let seed = 0xAB22;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const base = {
      rows: [row('rL', 'left', 0), row('rR', 'right', 0),
        row('rT', 'top', 0), row('rB', 'bottom', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4'),
        entry('c', 'rT', '3'), entry('d', 'rB', '3'),
        entry('u1', 'rL', '2'), entry('u2', 'rL', '1'),
        entry('x', 'rL', '5')],
      connections: [conn('cW', 'a', 'b'), conn('cH', 'c', 'd'),
        conn('cU', 'u1', 'u2'), conn('cA', 'x', 'c')],
    };
    const ref = calculatePullBox(base);
    for (let i = 0; i < 20; i++) {
      const r = calculatePullBox({
        rows: shuffle(base.rows),
        entries: shuffle(base.entries),
        connections: shuffle(base.connections),
      });
      assert.deepStrictEqual(r, ref, 'shuffle #' + i);
    }
  });

  test('FINITENESS: no NaN, no Infinity, no numeric strings anywhere in the result', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '6'), entry('b', 'rR', '1/2'), entry('t', 'rT', '2')],
      connections: [conn('c1', 'a', 'b'), conn('c2', 'a', 't')],
    });
    const walk = (o) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), 'non-finite number');
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(r);
    assert.strictEqual(typeof r.minimumWidthIn, 'number');
    for (const q of r.widthRequirements) {
      assert.strictEqual(typeof q.minimumInches, 'number');
      assert.ok(q.minimumInches > 0);
    }
  });

  test('MILESTONE BOUNDARY: straight, A(2) row AND A(2) spacing are all implemented', () => {
    // Behavioral: one angle connection must yield the dimensional row
    // requirements AND exactly one spacing requirement with the structured
    // A(2) codeRef and 6x-larger behavior.
    const api = require('../src/calc/pullBox');
    const r = api.calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '4'), entry('t', 'rT', '2')],
      connections: [conn('c1', 'a', 't')],
    });
    assert.strictEqual(r.widthRequirements[0].minimumInches, 24, '6x4 row');
    assert.strictEqual(r.heightRequirements[0].minimumInches, 12, '6x2 row');
    assert.strictEqual(r.spacingRequirements.length, 1);
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 24, '6x larger of pair');
    assert.deepStrictEqual(r.spacingRequirements[0].codeRef,
      { code: 'NEC', section: '314.28(A)(2)' });
    // spacing never merges into dimensions
    assert.strictEqual(r.minimumWidthIn, 24);
    assert.strictEqual(r.minimumHeightIn, 12);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-3 — Angle/U row engine (NEC 314.28(A)(2) dimensional rule)
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-3 — A(2) row requirements', () => {
  const { calculatePullBox } = require('../src/calc/pullBox');

  /** Angle box: one entry on wallA, one on an adjacent wall, connected. */
  function angleBox(wallA, sizeA, wallB, sizeB) {
    return {
      rows: [row('rA', wallA, 0), row('rB', wallB, 0)],
      entries: [entry('a', 'rA', sizeA), entry('b', 'rB', sizeB)],
      connections: [conn('c1', 'a', 'b')],
    };
  }

  test('INDEPENDENT PINS: all twelve single-entry 6x values, hand-stated', () => {
    // Explicit constants, never derived from the production map: 6 x size.
    const expected = {
      '1/2': 3, '3/4': 4.5, '1': 6, '1-1/4': 7.5, '1-1/2': 9, '2': 12,
      '2-1/2': 15, '3': 18, '3-1/2': 21, '4': 24, '5': 30, '6': 36,
    };
    for (const [size, inches] of Object.entries(expected)) {
      const r = calculatePullBox(angleBox('left', size, 'top', size));
      const req = r.widthRequirements.find((q) => q.kind === 'ANGLE_U_ROW');
      assert.strictEqual(req.minimumInches, inches, size);
      assert.deepStrictEqual(req.otherTradeSizes, [], size);
      assert.strictEqual(req.multiplier, 6, size);
    }
  });

  test('U REGRESSION [3,3]: 6x3 + 3 = 21", never the legacy 24"', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '3'), entry('b', 'rL', '3')],
      connections: [conn('cU', 'a', 'b')],
    });
    const req = r.widthRequirements[0];
    assert.strictEqual(r.widthRequirements.length, 1, 'ONE row requirement, not two');
    assert.strictEqual(req.minimumInches, 21, 'legacy double-count produced 24');
    assert.strictEqual(req.largestTradeSize, '3');
    assert.deepStrictEqual(req.otherTradeSizes, ['3'], 'the tied size stays in the sum ONCE');
    assert.deepStrictEqual(req.entryIds, ['a', 'b']);
    assert.strictEqual(req.dimension, 'width');
    assert.deepStrictEqual(req.codeRef, { code: 'NEC', section: '314.28(A)(2)' });
  });

  test('U REGRESSION [4,2]: 6x4 + 2 = 26"', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rL', '2')],
      connections: [conn('cU', 'a', 'b')],
    });
    assert.strictEqual(r.widthRequirements[0].minimumInches, 26);
    assert.strictEqual(r.widthRequirements[0].largestTradeSize, '4');
    assert.deepStrictEqual(r.widthRequirements[0].otherTradeSizes, ['2']);
  });

  test('U REGRESSION [4,3,2]: two form the U, the third still sums — 29"', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rL', '3'), entry('c', 'rL', '2')],
      connections: [conn('cU', 'b', 'c')],   // U between 3" and 2"
    });
    const req = r.widthRequirements[0];
    assert.strictEqual(req.minimumInches, 29, '6x4 + 3 + 2');
    assert.strictEqual(req.largestTradeSize, '4',
      'the largest governs the 6x term even though it is not in the U itself');
    assert.deepStrictEqual(req.otherTradeSizes, ['3', '2']);
    assert.deepStrictEqual(req.entryIds, ['a', 'b', 'c']);
    assert.deepStrictEqual(req.triggerConnectionIds, ['cU']);
  });

  test('LEGACY ANGLE REGRESSION (PB-2): opposite-wall sizes NEVER join a row formula', () => {
    // LEFT Row 1: 4" + 2"; RIGHT Row 1: 3". Angle from the LEFT 2" to TOP.
    // Legacy produced 29" by adding the right-side 3" into the left formula.
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('R3', 'rR', '3'), entry('T2', 'rT', '2')],
      connections: [conn('cA', 'L2', 'T2')],
    });
    const left = r.widthRequirements.find((q) => q.rowId === 'rL');
    assert.strictEqual(left.minimumInches, 26, '6x4 + 2 — the legacy 29 is dead');
    assert.deepStrictEqual(left.entryIds, ['L2', 'L4'],
      'only left-wall entries participate');
    assert.strictEqual(r.widthRequirements.find((q) => q.rowId === 'rR'), undefined,
      'the untriggered right row generates nothing');
  });

  test('TRIGGER vs SUM: a straight-connected entry joins a triggered row sum', () => {
    // LEFT Row 1: 4" (straight to RIGHT) + 2" (angle to TOP).
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('R4', 'rR', '4'), entry('T2', 'rT', '2')],
      connections: [conn('cS', 'L4', 'R4'), conn('cA', 'L2', 'T2')],
    });
    const left = r.widthRequirements.find((q) => q.kind === 'ANGLE_U_ROW');
    assert.strictEqual(left.minimumInches, 26, '6x4 + 2: the straight 4" sums');
    assert.deepStrictEqual(left.triggerConnectionIds, ['cA'],
      'the straight connection triggers nothing and is not a trigger id');
  });

  test('TRIGGER vs SUM: an unconnected entry joins a triggered row sum', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'), entry('T2', 'rT', '2')],
      connections: [conn('cA', 'L2', 'T2')],   // only the 2" is connected
    });
    const left = r.widthRequirements[0];
    assert.strictEqual(left.minimumInches, 26, '6x4 + 2: unconnected 4" governs the 6x');
    assert.deepStrictEqual(r.warnings, [{ code: 'UNCONNECTED_ENTRY', entryIds: ['L4'] }],
      'still warned as unconnected, still in the arithmetic');
  });

  test('CONTRAST: an unconnected entry in a DIFFERENT row triggers nothing', () => {
    const r = calculatePullBox({
      rows: [row('rL1', 'left', 0), row('rL2', 'left', 1), row('rT', 'top', 0)],
      entries: [entry('L2', 'rL1', '2'), entry('big', 'rL2', '6'), entry('T2', 'rT', '2')],
      connections: [conn('cA', 'L2', 'T2')],
    });
    assert.strictEqual(r.widthRequirements.length, 1, 'only Row 1 computes');
    assert.strictEqual(r.widthRequirements[0].rowId, 'rL1');
    assert.strictEqual(r.widthRequirements[0].minimumInches, 12, '6x2');
    assert.strictEqual(r.minimumWidthIn, 12,
      'the 6" in the untriggered row must NOT create a 36" requirement');
  });

  test('EQUAL LARGEST [4,4,2]: exclude exactly one — 6x4 + 4 + 2 = 30"', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rL', '4'), entry('c', 'rL', '2')],
      connections: [conn('cU', 'a', 'b')],
    });
    const req = r.widthRequirements[0];
    assert.strictEqual(req.minimumInches, 30, 'not 26 (dropping both 4s) and not 34');
    assert.strictEqual(req.largestTradeSize, '4');
    assert.deepStrictEqual(req.otherTradeSizes, ['4', '2'],
      'duplicates preserved, size-descending order');
  });

  test('MULTIPLE ROWS, ONE WALL: separate requirements, never merged', () => {
    const r = calculatePullBox({
      rows: [row('rowA', 'left', 0), row('rowB', 'left', 1), row('rT', 'top', 0)],
      entries: [entry('A4', 'rowA', '4'), entry('A2', 'rowA', '2'),
        entry('B3', 'rowB', '3'), entry('T1', 'rT', '2'), entry('T2b', 'rT', '1')],
      connections: [conn('cA', 'A2', 'T1'), conn('cB', 'B3', 'T2b')],
    });
    const a = r.widthRequirements.find((q) => q.rowId === 'rowA');
    const b = r.widthRequirements.find((q) => q.rowId === 'rowB');
    assert.strictEqual(a.minimumInches, 26);
    assert.strictEqual(b.minimumInches, 18);
    assert.strictEqual(r.minimumWidthIn, 26);
    assert.strictEqual(r.governingWidthRequirementId, 'angle-u-row:rowA');
  });

  test('ALL FOUR WALLS: calculated requirement dimension follows the wall', () => {
    for (const [wall, adjacent, dim] of [
      ['left', 'top', 'width'], ['right', 'bottom', 'width'],
      ['top', 'right', 'height'], ['bottom', 'left', 'height'],
    ]) {
      const r = calculatePullBox(angleBox(wall, '3', adjacent, '1/2'));
      const reqs = dim === 'width' ? r.widthRequirements : r.heightRequirements;
      const req = reqs.find((q) => q.wall === wall);
      assert.ok(req, wall);
      assert.strictEqual(req.dimension, dim, wall);
      assert.strictEqual(req.minimumInches, 18, wall);
    }
  });

  test('ONE ANGLE TRIGGERS BOTH WALL ROWS: per-wall requirements, no anonymous result', () => {
    const r = calculatePullBox(angleBox('left', '2', 'top', '2'));
    assert.strictEqual(r.widthRequirements.length, 1);
    assert.strictEqual(r.heightRequirements.length, 1);
    assert.strictEqual(r.widthRequirements[0].minimumInches, 12);
    assert.strictEqual(r.widthRequirements[0].wall, 'left');
    assert.strictEqual(r.heightRequirements[0].minimumInches, 12);
    assert.strictEqual(r.heightRequirements[0].wall, 'top');
    assert.strictEqual(r.minimumWidthIn, 12);
    assert.strictEqual(r.minimumHeightIn, 12);
  });

  test('MULTIPLE ANGLE/U ON ONE ROW: exactly one requirement, all triggers listed', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('L3', 'rL', '3'), entry('L2', 'rL', '2'), entry('L1', 'rL', '1'),
        entry('T2', 'rT', '2')],
      connections: [conn('cU', 'L3', 'L2'), conn('cA', 'L1', 'T2')],
    });
    const left = r.widthRequirements.filter((q) => q.rowId === 'rL');
    assert.strictEqual(left.length, 1, 'one row = one requirement');
    assert.strictEqual(left[0].minimumInches, 21, '6x3 + 2 + 1');
    assert.deepStrictEqual(left[0].triggerConnectionIds, ['cA', 'cU'], 'sorted');
  });

  test('MANDATORY DESIGN EXAMPLE: mixed straight + angle, independent governors', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('R4', 'rR', '4'), entry('T2', 'rT', '2')],
      connections: [conn('cS', 'L4', 'R4'), conn('cA', 'L2', 'T2')],
    });
    assert.strictEqual(r.minimumWidthIn, 32, 'straight 8x4 outgoverns row 26');
    assert.strictEqual(r.minimumHeightIn, 12, 'top row 6x2');
    assert.strictEqual(r.governingWidthRequirementId, 'straight:cS');
    assert.strictEqual(r.governingHeightRequirementId, 'angle-u-row:rT');
    assert.deepStrictEqual(
      r.widthRequirements.map((q) => [q.id, q.minimumInches]),
      [['angle-u-row:rL', 26], ['straight:cS', 32]],
      'both candidates present, id-sorted');
    assert.strictEqual(r.completeForRequest, true,
      'fully evaluated since PBV2-4 (spacing implemented)');
  });

  test('CROSS-KIND TIE-BREAK: equal 24" straight and row pick the first id', () => {
    // straight 8x3 = 24 (id straight:cS) vs left row 6x4 = 24
    // (id angle-u-row:rL). 'angle-u-row:rL' < 'straight:cS' lexicographically.
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rL2', 'left', 1), row('rR', 'right', 0),
        row('rT', 'top', 0)],
      entries: [entry('S3', 'rL2', '3'), entry('R3', 'rR', '3'),
        entry('L4', 'rL', '4'), entry('T1', 'rT', '1/2')],
      connections: [conn('cS', 'S3', 'R3'), conn('cA', 'L4', 'T1')],
    });
    const mins = r.widthRequirements.map((q) => q.minimumInches);
    assert.deepStrictEqual(mins, [24, 24], 'genuine cross-kind tie');
    assert.strictEqual(r.minimumWidthIn, 24);
    assert.strictEqual(r.governingWidthRequirementId, 'angle-u-row:rL',
      'lexicographically first requirement id, never insertion order');
  });

  test('EMPTY ROWS: valid, trigger nothing, produce nothing', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rEmpty', 'left', 1),
        row('rEmptyTop', 'top', 3), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '2'), entry('t', 'rT', '2')],
      connections: [conn('cA', 'a', 't')],
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.widthRequirements.length, 1);
    assert.strictEqual(r.heightRequirements.length, 1);
    assert.ok(!JSON.stringify(r).includes('rEmpty'));
  });

  test('rowOrder is echoed for labeling but never part of identity', () => {
    const r = calculatePullBox({
      rows: [row('myRow', 'bottom', 7), row('rL', 'left', 0)],
      entries: [entry('b3', 'myRow', '3'), entry('L2', 'rL', '2')],
      connections: [conn('cA', 'b3', 'L2')],
    });
    const req = r.heightRequirements[0];
    assert.strictEqual(req.id, 'angle-u-row:myRow', 'id from rowId, not order');
    assert.strictEqual(req.rowOrder, 7);
    assert.strictEqual(req.wall, 'bottom');
  });

  test('IMMUTABILITY: deep-frozen mixed request calculates without mutation', () => {
    const q = {
      rows: [row('rL', 'left', 0), row('rL2', 'left', 1), row('rR', 'right', 0),
        row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('X3', 'rL2', '3'), entry('R4', 'rR', '4'), entry('T2', 'rT', '2'),
        entry('U1', 'rL', '1')],
      connections: [conn('cS', 'L4', 'R4'), conn('cA', 'L2', 'T2'),
        conn('cU', 'L2', 'U1')],
    };
    Object.freeze(q); Object.freeze(q.rows); Object.freeze(q.entries);
    Object.freeze(q.connections);
    q.rows.forEach(Object.freeze); q.entries.forEach(Object.freeze);
    q.connections.forEach((c) => { Object.freeze(c); Object.freeze(c.entryIds); });
    const snapshot = JSON.stringify(q);
    const r = calculatePullBox(q);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(JSON.stringify(q), snapshot);
  });

  test('DETERMINISM: seeded shuffles keep the whole mixed result deep-equal', () => {
    let seed = 0xA23;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const base = {
      rows: [row('rL', 'left', 0), row('rL2', 'left', 1), row('rR', 'right', 0),
        row('rT', 'top', 0), row('rB', 'bottom', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('L1', 'rL', '1'), entry('X3', 'rL2', '3'),
        entry('R4', 'rR', '4'), entry('T2', 'rT', '2'), entry('B5', 'rB', '5'),
        entry('loose', 'rB', '6')],
      connections: [conn('cS', 'L4', 'R4'), conn('cA', 'L2', 'T2'),
        conn('cU', 'L1', 'L2'), conn('cA2', 'B5', 'L1')],
    };
    const ref = calculatePullBox(base);
    for (let i = 0; i < 20; i++) {
      const r = calculatePullBox({
        rows: shuffle(base.rows),
        entries: shuffle(base.entries),
        connections: shuffle(base.connections),
      });
      assert.deepStrictEqual(r, ref, 'shuffle #' + i);
    }
  });

  test('FINITENESS: fractional 6x values are exact numbers, nothing NaN/Infinity', () => {
    const r = calculatePullBox(angleBox('left', '3/4', 'top', '1-1/4'));
    assert.strictEqual(r.widthRequirements[0].minimumInches, 4.5);
    assert.strictEqual(r.heightRequirements[0].minimumInches, 7.5);
    const walk = (o) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v));
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(r);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-4 — A(2) raceway-entry spacing engine
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-4 — entry-spacing requirements', () => {
  const { calculatePullBox } = require('../src/calc/pullBox');

  function angleBox(wallA, sizeA, wallB, sizeB) {
    return {
      rows: [row('rA', wallA, 0), row('rB', wallB, 0)],
      entries: [entry('a', 'rA', sizeA), entry('b', 'rB', sizeB)],
      connections: [conn('c1', 'a', 'b')],
    };
  }

  test('INDEPENDENT PINS: all twelve 6x spacing values, hand-stated constants', () => {
    const expected = {
      '1/2': 3, '3/4': 4.5, '1': 6, '1-1/4': 7.5, '1-1/2': 9, '2': 12,
      '2-1/2': 15, '3': 18, '3-1/2': 21, '4': 24, '5': 30, '6': 36,
    };
    for (const [size, inches] of Object.entries(expected)) {
      const r = calculatePullBox(angleBox('left', size, 'top', size));
      assert.strictEqual(r.spacingRequirements.length, 1, size);
      assert.strictEqual(r.spacingRequirements[0].minimumInches, inches, size);
      assert.strictEqual(r.spacingRequirements[0].largerTradeSize, size, size);
    }
  });

  test('ANGLE spacing: three distinct constraints, none merged', () => {
    // LEFT 2" ↔ TOP 2": width row 12", height row 12", spacing 12" — three
    // separate results with separate meanings.
    const r = calculatePullBox(angleBox('left', '2', 'top', '2'));
    assert.strictEqual(r.widthRequirements[0].minimumInches, 12);
    assert.strictEqual(r.heightRequirements[0].minimumInches, 12);
    assert.deepStrictEqual(r.spacingRequirements[0], {
      id: 'spacing:c1',
      kind: 'ENTRY_SPACING',
      connectionType: 'ANGLE',
      connectionId: 'c1',
      entryIds: ['a', 'b'],
      largerTradeSize: '2',
      multiplier: 6,
      minimumInches: 12,
      sameWall: false,   // PBV2-9A: adjacent walls, no single axis carries it
      axis: null,
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    });
  });

  test('UNEQUAL ANGLE spacing uses the larger: 4"↔2" → 24", both endpoint orders', () => {
    const fwd = calculatePullBox(angleBox('left', '4', 'top', '2'));
    assert.strictEqual(fwd.spacingRequirements[0].minimumInches, 24, 'never 12');
    assert.strictEqual(fwd.spacingRequirements[0].largerTradeSize, '4');
    const rev = calculatePullBox(angleBox('left', '2', 'top', '4'));
    assert.strictEqual(rev.spacingRequirements[0].minimumInches, 24);
    assert.strictEqual(rev.spacingRequirements[0].largerTradeSize, '4');
    assert.deepStrictEqual(rev.spacingRequirements[0].entryIds, ['a', 'b'],
      'undirected: presentation ids sorted lexicographically');
  });

  test('U spacing [3,3]: dimension 21" and spacing 18" stay separate', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '3'), entry('b', 'rL', '3')],
      connections: [conn('cU', 'a', 'b')],
    });
    assert.strictEqual(r.widthRequirements[0].minimumInches, 21, '6x3 + 3');
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 18, '6x3');
    assert.strictEqual(r.spacingRequirements[0].connectionType, 'U');
    assert.strictEqual(r.minimumWidthIn, 21, 'spacing never inflates the dimension');
  });

  test('UNEQUAL U [4,2]: dimension 26", spacing 24", pinned independently', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rL', '2')],
      connections: [conn('cU', 'a', 'b')],
    });
    assert.strictEqual(r.widthRequirements[0].minimumInches, 26);
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 24);
    assert.strictEqual(r.spacingRequirements[0].largerTradeSize, '4');
  });

  test('MULTIPLE ANGLE/U SAME ROW: one row requirement, one spacing PER connection', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('L3', 'rL', '3'), entry('L2', 'rL', '2'), entry('L1', 'rL', '1'),
        entry('T2', 'rT', '2')],
      connections: [conn('cU', 'L3', 'L2'), conn('cA', 'L1', 'T2')],
    });
    assert.strictEqual(r.widthRequirements.filter((q) => q.rowId === 'rL').length, 1,
      'row aggregation level unchanged');
    assert.strictEqual(r.spacingRequirements.length, 2, 'connection aggregation level');
    assert.deepStrictEqual(r.spacingRequirements.map((s) => [s.id, s.minimumInches]),
      [['spacing:cA', 12], ['spacing:cU', 18]], 'id-sorted: 6x2 and 6x3');
  });

  test('STRAIGHT produces NO spacing; all-straight requests stay complete and note-free', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4')],
      connections: [conn('cS', 'a', 'b')],
    });
    assert.strictEqual(r.minimumWidthIn, 32);
    assert.deepStrictEqual(r.spacingRequirements, [], 'no redundant 24" spacing');
    assert.strictEqual(r.completeForRequest, true);
    assert.ok(!r.scopeNotes.some((n) => n.code === 'SPACING_VERIFY_IN_LAYOUT'),
      'the layout-verification note appears only when spacing requirements exist');
  });

  test('MIXED STRAIGHT + ANGLE (frozen design fixture): one spacing item, complete', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('R4', 'rR', '4'), entry('T2', 'rT', '2')],
      connections: [conn('cS', 'L4', 'R4'), conn('cA', 'L2', 'T2')],
    });
    assert.strictEqual(r.minimumWidthIn, 32);
    assert.strictEqual(r.minimumHeightIn, 12);
    assert.strictEqual(r.spacingRequirements.length, 1);
    assert.strictEqual(r.spacingRequirements[0].connectionId, 'cA');
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 12);
    assert.strictEqual(r.completeForRequest, true);
  });

  test('MIXED STRAIGHT + U: both dimensional engines run, only U gets spacing', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a', 'rL', '3'), entry('b', 'rR', '3'),
        entry('u1', 'rL', '2'), entry('u2', 'rL', '1')],
      connections: [conn('cS', 'a', 'b'), conn('cU', 'u1', 'u2')],
    });
    // straight 8x3=24; left row triggered by U: entries 3,2,1 → 6x3+2+1=21
    assert.strictEqual(r.minimumWidthIn, 24);
    assert.strictEqual(r.governingWidthRequirementId, 'straight:cS');
    assert.strictEqual(r.spacingRequirements.length, 1);
    assert.strictEqual(r.spacingRequirements[0].id, 'spacing:cU');
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 12, '6x2 larger of U pair');
    assert.strictEqual(r.completeForRequest, true);
  });

  test('ANGLE + U: two spacing requirements, id-ordered, both A(2)-cited, complete', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rB', 'bottom', 0)],
      entries: [entry('L5', 'rL', '5'), entry('L1', 'rL', '1'),
        entry('B2', 'rB', '2')],
      connections: [conn('zU', 'L5', 'L1'), conn('aA', 'L1', 'B2')],
    });
    assert.deepStrictEqual(r.spacingRequirements.map((s) => s.id),
      ['spacing:aA', 'spacing:zU']);
    assert.deepStrictEqual(r.spacingRequirements.map((s) => s.minimumInches),
      [12, 30], '6x2 angle, 6x5 U');
    for (const s of r.spacingRequirements) {
      assert.deepStrictEqual(s.codeRef, { code: 'NEC', section: '314.28(A)(2)' });
    }
    assert.strictEqual(r.completeForRequest, true);
  });

  test('SHARED ENTRY: each connection keeps its own spacing obligation', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0), row('rB', 'bottom', 0)],
      entries: [entry('hub', 'rL', '2'), entry('T4', 'rT', '4'), entry('B3', 'rB', '3')],
      connections: [conn('c1', 'hub', 'T4'), conn('c2', 'hub', 'B3')],
    });
    assert.strictEqual(r.spacingRequirements.length, 2, 'no dedup on shared endpoint');
    assert.deepStrictEqual(r.spacingRequirements.map((s) => s.minimumInches),
      [24, 18], '6x4 and 6x3, each from its own pair');
  });

  test('SPACING_VERIFY_IN_LAYOUT appears exactly when spacing requirements exist', () => {
    const withSpacing = calculatePullBox(angleBox('left', '2', 'top', '2'));
    assert.ok(withSpacing.scopeNotes.some((n) => n.code === 'SPACING_VERIFY_IN_LAYOUT'));
    assert.ok(!withSpacing.scopeNotes.some((n) => n.code === 'A2_SPACING_NOT_CALCULATED'),
      'the temporary PBV2-3 note no longer exists anywhere');
    const straightOnly = calculatePullBox({
      rows: [row('rT', 'top', 0), row('rB', 'bottom', 0)],
      entries: [entry('a', 'rT', '1'), entry('b', 'rB', '1')],
      connections: [conn('c1', 'a', 'b')],
    });
    assert.ok(!straightOnly.scopeNotes.some((n) => n.code === 'SPACING_VERIFY_IN_LAYOUT'));
  });

  test('PBV2-3 DIMENSIONAL REGRESSIONS stand untouched beside spacing', () => {
    // U [4,3,2]: dimension 29" (U between 3 and 2 → spacing 6x3=18")
    const u432 = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rL', '3'), entry('c', 'rL', '2')],
      connections: [conn('cU', 'b', 'c')],
    });
    assert.strictEqual(u432.widthRequirements[0].minimumInches, 29);
    assert.strictEqual(u432.spacingRequirements[0].minimumInches, 18);
    // legacy angle regression: left [4,2] row stays 26, never 29
    const pb2 = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('R3', 'rR', '3'), entry('T2', 'rT', '2')],
      connections: [conn('cA', 'L2', 'T2')],
    });
    assert.strictEqual(
      pb2.widthRequirements.find((q) => q.rowId === 'rL').minimumInches, 26);
    assert.strictEqual(pb2.spacingRequirements[0].minimumInches, 12, '6x2 pair');
  });

  test('IMMUTABILITY: deep-frozen mixed request with spacing calculates cleanly', () => {
    const q = {
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('R4', 'rR', '4'), entry('T2', 'rT', '2'), entry('U1', 'rL', '1')],
      connections: [conn('cS', 'L4', 'R4'), conn('cA', 'L2', 'T2'),
        conn('cU', 'L2', 'U1')],
    };
    Object.freeze(q); Object.freeze(q.rows); Object.freeze(q.entries);
    Object.freeze(q.connections);
    q.rows.forEach(Object.freeze); q.entries.forEach(Object.freeze);
    q.connections.forEach((c) => { Object.freeze(c); Object.freeze(c.entryIds); });
    const snapshot = JSON.stringify(q);
    const r = calculatePullBox(q);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.spacingRequirements.length, 2);
    assert.strictEqual(JSON.stringify(q), snapshot);
  });

  test('DETERMINISM: shuffles never move spacing ids, order, or values', () => {
    let seed = 0x5AC4;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const base = {
      rows: [row('rL', 'left', 0), row('rL2', 'left', 1), row('rR', 'right', 0),
        row('rT', 'top', 0), row('rB', 'bottom', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('L1', 'rL', '1'), entry('X3', 'rL2', '3'),
        entry('R4', 'rR', '4'), entry('T2', 'rT', '2'), entry('B5', 'rB', '5')],
      connections: [conn('cS', 'L4', 'R4'), conn('cA', 'L2', 'T2'),
        conn('cU', 'L1', 'L2'), conn('cA2', 'B5', 'X3')],
    };
    const ref = calculatePullBox(base);
    assert.strictEqual(ref.spacingRequirements.length, 3);
    for (let i = 0; i < 20; i++) {
      const r = calculatePullBox({
        rows: shuffle(base.rows),
        entries: shuffle(base.entries),
        connections: shuffle(base.connections),
      });
      assert.deepStrictEqual(r, ref, 'shuffle #' + i);
    }
  });

  test('FINITENESS: fractional spacing values are exact, nothing NaN/Infinity', () => {
    const r = calculatePullBox(angleBox('left', '3/4', 'top', '1-1/4'));
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 7.5, '6 x 1.25');
    const walk = (o) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v));
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(r);
  });

  test('VALIDATION PASSTHROUGH: spacing never runs on invalid connections', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '2')],
      connections: [conn('c1', 'a', 'ghost')],
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'CONNECTION_UNKNOWN_ENTRY');
    assert.strictEqual(r.spacingRequirements, undefined);
  });
});
