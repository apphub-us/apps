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

  test('ANGLE/U connections are deferred, machine-readably, not silently', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4'),
        entry('t', 'rT', '2'), entry('a2', 'rL', '2'), entry('a3', 'rL', '3')],
      connections: [conn('cS', 'a', 'b'), conn('cAngle', 'a2', 't'),
        conn('cU', 'a3', 'a')],
    });
    assert.strictEqual(r.ok, true, 'angle/U presence must not reject the request');
    assert.strictEqual(r.minimumWidthIn, 32, 'straight math still computes');
    assert.strictEqual(r.completeForRequest, false);
    assert.deepStrictEqual(
      r.scopeNotes.find((n) => n.code === 'ANGLE_U_NOT_CALCULATED'),
      { code: 'ANGLE_U_NOT_CALCULATED', connectionIds: ['cAngle', 'cU'] },
      'sorted connection ids, deterministic');
    assert.strictEqual(r.spacingRequirements.length, 0);
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

  test('NO A(2) LEAKAGE: the module still contains no 6x row arithmetic', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(require.resolve('../src/calc/pullBox.js'), 'utf8');
    // strip comments before scanning so milestone documentation is exempt
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const banned of ['6 *', '* 6', 'ANGLE_U_ROW', '314.28(A)(2)',
      'spacing:', 'otherInRow']) {
      assert.ok(!code.includes(banned),
        'premature A(2) implementation detected: ' + banned);
    }
    assert.ok(code.includes('8 *'), 'the straight multiplier lives in code');
  });
});
