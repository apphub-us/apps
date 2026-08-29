'use strict';
/**
 * PBV2-5 — Pull Box V2 engine CONTRACT CLOSURE.
 *
 * These tests freeze the pure engine's public contract before any UI work:
 * request shape, success-result shape, requirement shapes (STRAIGHT /
 * ANGLE_U_ROW / ENTRY_SPACING), warnings, scope notes, orderings, id rules,
 * and the structural invariants a renderer may rely on. The golden mixed
 * fixture is the permanent end-to-end pin; every expected number in it is
 * HAND-STATED — no production constant or helper computes an expectation.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const api = require('../src/calc/pullBox');
const { calculatePullBox, TRADE_SIZE_KEYS } = api;

const row = (id, wall, order) => ({ id, wall, order });
const entry = (id, rowId, tradeSize) => ({ id, rowId, tradeSize });
const conn = (id, a, b) => ({ id, entryIds: [a, b] });

/**
 * GOLDEN FIXTURE — all four walls, two left rows, straight + two angles +
 * one U, a shared endpoint (eL2 serves the angle and the U), an unconnected
 * entry inside a triggered row, mixed trade sizes including the extremes.
 *
 * Hand arithmetic (stated once, verified below):
 *   WIDTH:  straight:cS            8 x 4               = 32
 *           angle-u-row:rL1        6 x 4 + 2 + 1 + 0.5 = 27.5
 *           angle-u-row:rL2        6 x 3               = 18
 *           -> minimum 32, governed by straight:cS
 *   HEIGHT: angle-u-row:rB1        6 x 5               = 30
 *           angle-u-row:rT1        6 x 2               = 12
 *           -> minimum 30, governed by angle-u-row:rB1
 *   SPACING: cA1 (2 vs 2)  -> 6 x 2 = 12   ANGLE
 *            cA2 (3 vs 5)  -> 6 x 5 = 30   ANGLE
 *            cU  (2 vs 1)  -> 6 x 2 = 12   U
 */
function goldenFixture() {
  return {
    rows: [row('rL1', 'left', 0), row('rL2', 'left', 1), row('rR1', 'right', 0),
      row('rT1', 'top', 0), row('rB1', 'bottom', 0)],
    entries: [
      entry('eL4', 'rL1', '4'), entry('eL2', 'rL1', '2'),
      entry('eLu', 'rL1', '1'), entry('eLx', 'rL1', '1/2'),
      entry('eL3', 'rL2', '3'),
      entry('eR4', 'rR1', '4'),
      entry('eT2', 'rT1', '2'),
      entry('eB5', 'rB1', '5'),
    ],
    connections: [
      conn('cS', 'eL4', 'eR4'),   // STRAIGHT width
      conn('cA1', 'eL2', 'eT2'),  // ANGLE (left/top)
      conn('cA2', 'eL3', 'eB5'),  // ANGLE (left row 2 / bottom)
      conn('cU', 'eL2', 'eLu'),   // U (left row 1, shares eL2 with cA1)
    ],
  };
}

/** The complete hand-authored expected result for the golden fixture. */
const GOLDEN_EXPECTED = {
  ok: true,
  minimumWidthIn: 32,
  minimumHeightIn: 30,
  widthRequirements: [
    {
      id: 'angle-u-row:rL1', kind: 'ANGLE_U_ROW', dimension: 'width',
      wall: 'left', rowId: 'rL1', rowOrder: 0,
      entryIds: ['eL2', 'eL4', 'eLu', 'eLx'],
      largestTradeSize: '4', otherTradeSizes: ['2', '1', '1/2'],
      multiplier: 6, minimumInches: 27.5,
      triggerConnectionIds: ['cA1', 'cU'],
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    },
    {
      id: 'angle-u-row:rL2', kind: 'ANGLE_U_ROW', dimension: 'width',
      wall: 'left', rowId: 'rL2', rowOrder: 1,
      entryIds: ['eL3'],
      largestTradeSize: '3', otherTradeSizes: [],
      multiplier: 6, minimumInches: 18,
      triggerConnectionIds: ['cA2'],
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    },
    {
      id: 'straight:cS', kind: 'STRAIGHT', dimension: 'width',
      connectionId: 'cS', entryIds: ['eL4', 'eR4'],
      largestTradeSize: '4', otherTradeSizes: [],
      multiplier: 8, minimumInches: 32,
      codeRef: { code: 'NEC', section: '314.28(A)(1)' },
    },
  ],
  heightRequirements: [
    {
      id: 'angle-u-row:rB1', kind: 'ANGLE_U_ROW', dimension: 'height',
      wall: 'bottom', rowId: 'rB1', rowOrder: 0,
      entryIds: ['eB5'],
      largestTradeSize: '5', otherTradeSizes: [],
      multiplier: 6, minimumInches: 30,
      triggerConnectionIds: ['cA2'],
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    },
    {
      id: 'angle-u-row:rT1', kind: 'ANGLE_U_ROW', dimension: 'height',
      wall: 'top', rowId: 'rT1', rowOrder: 0,
      entryIds: ['eT2'],
      largestTradeSize: '2', otherTradeSizes: [],
      multiplier: 6, minimumInches: 12,
      triggerConnectionIds: ['cA1'],
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    },
  ],
  governingWidthRequirementId: 'straight:cS',
  governingHeightRequirementId: 'angle-u-row:rB1',
  spacingRequirements: [
    {
      id: 'spacing:cA1', kind: 'ENTRY_SPACING', connectionType: 'ANGLE',
      connectionId: 'cA1', entryIds: ['eL2', 'eT2'],
      largerTradeSize: '2', multiplier: 6, minimumInches: 12,
      sameWall: false, axis: null,
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    },
    {
      id: 'spacing:cA2', kind: 'ENTRY_SPACING', connectionType: 'ANGLE',
      connectionId: 'cA2', entryIds: ['eB5', 'eL3'],
      largerTradeSize: '5', multiplier: 6, minimumInches: 30,
      sameWall: false, axis: null,
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    },
    {
      id: 'spacing:cU', kind: 'ENTRY_SPACING', connectionType: 'U',
      connectionId: 'cU', entryIds: ['eL2', 'eLu'],
      largerTradeSize: '2', multiplier: 6, minimumInches: 12,
      sameWall: true, axis: 'height',   // left-wall U runs along the height axis
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    },
  ],
  dimensionStatus: {
    width: { status: 'RESOLVED', constrainedBySpacingIds: [], minimumEntrySpacingIn: null },
    height: {
      status: 'LAYOUT_DEPENDENT',
      constrainedBySpacingIds: ['spacing:cU'],
      minimumEntrySpacingIn: 12,
    },
  },
  completeForRequest: true,
  warnings: [{ code: 'UNCONNECTED_ENTRY', entryIds: ['eLx'] }],
  scopeNotes: [
    { code: 'SPACING_VERIFY_IN_LAYOUT' },
    { code: 'DEPTH_NOT_CALCULATED' },
    { code: 'A3_NOT_EVALUATED' },
  ],
};

describe('PBV2-5 — golden mixed fixture (the permanent end-to-end pin)', () => {
  test('the complete result matches the hand-authored expectation exactly', () => {
    assert.deepStrictEqual(calculatePullBox(goldenFixture()), GOLDEN_EXPECTED);
  });

  test('endpoint-order invariance: reversing every connection changes nothing', () => {
    const q = goldenFixture();
    q.connections = q.connections.map((c) => ({
      id: c.id, entryIds: [c.entryIds[1], c.entryIds[0]],
    }));
    assert.deepStrictEqual(calculatePullBox(q), GOLDEN_EXPECTED,
      'STRAIGHT, ANGLE and U must all be direction-blind, result bytes included');
  });

  test('shuffle invariance on the golden fixture (seeded, 25 rounds)', () => {
    let seed = 0x60D5;
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
    const base = goldenFixture();
    for (let i = 0; i < 25; i++) {
      const r = calculatePullBox({
        rows: shuffle(base.rows),
        entries: shuffle(base.entries),
        connections: shuffle(base.connections),
      });
      assert.deepStrictEqual(r, GOLDEN_EXPECTED, 'shuffle #' + i);
    }
  });

  test('immutability: the deep-frozen golden fixture calculates unchanged', () => {
    const q = goldenFixture();
    Object.freeze(q); Object.freeze(q.rows); Object.freeze(q.entries);
    Object.freeze(q.connections);
    q.rows.forEach(Object.freeze); q.entries.forEach(Object.freeze);
    q.connections.forEach((c) => { Object.freeze(c); Object.freeze(c.entryIds); });
    const snapshot = JSON.stringify(q);
    assert.deepStrictEqual(calculatePullBox(q), GOLDEN_EXPECTED);
    assert.strictEqual(JSON.stringify(q), snapshot);
  });

  test('numeric finiteness walk over the golden result', () => {
    const r = calculatePullBox(goldenFixture());
    const walk = (o) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'number') {
          assert.ok(Number.isFinite(v), 'non-finite number in result');
        } else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(r);
    for (const req of [...r.widthRequirements, ...r.heightRequirements,
      ...r.spacingRequirements]) {
      assert.ok(req.minimumInches > 0);
    }
  });

  test('no user-facing prose: string values are codes, ids, keys and citations only', () => {
    const r = calculatePullBox(goldenFixture());
    const strings = [];
    const walk = (o) => {
      for (const v of Object.values(o)) {
        if (typeof v === 'string') strings.push(v);
        else if (v && typeof v === 'object') walk(v);
      }
    };
    walk(r);
    for (const s of strings) {
      assert.ok(s.length < 40, 'suspiciously long string: ' + s);
      assert.ok(!s.includes(' the '), 'prose detected: ' + s);
      assert.ok(!/[<>]/.test(s), 'HTML detected: ' + s);
      assert.ok(!s.includes('http'), 'URL detected: ' + s);
    }
  });
});

describe('PBV2-5 — frozen result-shape and invariants', () => {
  test('success result: exact field set, always-present arrays', () => {
    const r = calculatePullBox(goldenFixture());
    assert.deepStrictEqual(Object.keys(r).sort(), [
      'completeForRequest', 'dimensionStatus', 'governingHeightRequirementId',
      'governingWidthRequirementId', 'heightRequirements', 'minimumHeightIn',
      'minimumWidthIn', 'ok', 'scopeNotes', 'spacingRequirements', 'warnings',
      'widthRequirements',
    ]);
    // arrays never disappear when empty
    const straightOnly = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a', 'rL', '2'), entry('b', 'rR', '2')],
      connections: [conn('c1', 'a', 'b')],
    });
    assert.ok(Array.isArray(straightOnly.spacingRequirements));
    assert.ok(Array.isArray(straightOnly.heightRequirements));
    assert.ok(Array.isArray(straightOnly.warnings));
  });

  test('NO-CONNECTION request: complete, null dimensions, honest notes', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '3'), entry('t', 'rT', '2')],
      connections: [],
    });
    assert.deepStrictEqual(r, {
      ok: true,
      minimumWidthIn: null,
      minimumHeightIn: null,
      widthRequirements: [],
      heightRequirements: [],
      governingWidthRequirementId: null,
      governingHeightRequirementId: null,
      spacingRequirements: [],
      dimensionStatus: {
        width: { status: 'RESOLVED', constrainedBySpacingIds: [], minimumEntrySpacingIn: null },
        height: { status: 'RESOLVED', constrainedBySpacingIds: [], minimumEntrySpacingIn: null },
      },
      completeForRequest: true,
      warnings: [{ code: 'UNCONNECTED_ENTRY', entryIds: ['a', 't'] }],
      scopeNotes: [
        { code: 'NO_WIDTH_CANDIDATES' },
        { code: 'NO_HEIGHT_CANDIDATES' },
        { code: 'DEPTH_NOT_CALCULATED' },
        { code: 'A3_NOT_EVALUATED' },
      ],
    }, 'completeForRequest=true with null dimensions: coverage, not box size');
  });

  test('ONE-DIMENSION request: complete is not "both dimensions known"', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4')],
      connections: [conn('c1', 'a', 'b')],
    });
    assert.strictEqual(r.minimumWidthIn, 32);
    assert.strictEqual(r.minimumHeightIn, null);
    assert.strictEqual(r.completeForRequest, true);
    assert.ok(r.scopeNotes.some((n) => n.code === 'NO_HEIGHT_CANDIDATES'));
  });

  test('INVARIANT: governing ids resolve to exactly one requirement, or are null with null minimums', () => {
    for (const q of [goldenFixture(), {
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '3'), entry('t', 'rT', '2')],
      connections: [],
    }]) {
      const r = calculatePullBox(q);
      for (const [minKey, govKey, reqKey] of [
        ['minimumWidthIn', 'governingWidthRequirementId', 'widthRequirements'],
        ['minimumHeightIn', 'governingHeightRequirementId', 'heightRequirements'],
      ]) {
        if (r[minKey] === null) {
          assert.strictEqual(r[govKey], null, govKey);
          assert.strictEqual(r[reqKey].length, 0, reqKey);
        } else {
          const matches = r[reqKey].filter((x) => x.id === r[govKey]);
          assert.strictEqual(matches.length, 1, govKey + ' resolves exactly once');
          assert.strictEqual(matches[0].minimumInches, r[minKey],
            minKey + ' equals its governor');
          const max = Math.max(...r[reqKey].map((x) => x.minimumInches));
          assert.strictEqual(r[minKey], max, minKey + ' is the candidate maximum');
        }
      }
    }
  });

  test('INVARIANT: spacing never governs a box dimension', () => {
    // Spacing 6x6 = 36" dwarfs the width candidate 6x(1/2) = 3".
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '1/2'), entry('t', 'rT', '6')],
      connections: [conn('c1', 'a', 't')],
    });
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 36);
    assert.strictEqual(r.minimumWidthIn, 3,
      'the 36" spacing must never bleed into the width');
    assert.strictEqual(r.governingWidthRequirementId, 'angle-u-row:rL');
    assert.strictEqual(r.minimumHeightIn, 36, 'height comes from the 6" ROW, not spacing');
    assert.strictEqual(r.governingHeightRequirementId, 'angle-u-row:rT');
  });

  test('INVARIANT: same-row accounting — largest once + others once = all entries', () => {
    const r = calculatePullBox(goldenFixture());
    for (const req of [...r.widthRequirements, ...r.heightRequirements]) {
      if (req.kind !== 'ANGLE_U_ROW') continue;
      assert.strictEqual(1 + req.otherTradeSizes.length, req.entryIds.length,
        req.id + ': one largest + each other exactly once');
    }
    // duplicates preserved: [4,4,2] shows 1 + 2 = 3
    const dup = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rL', '4'), entry('c', 'rL', '2')],
      connections: [conn('cU', 'a', 'b')],
    });
    const req = dup.widthRequirements[0];
    assert.deepStrictEqual(req.otherTradeSizes, ['4', '2']);
    assert.strictEqual(1 + req.otherTradeSizes.length, req.entryIds.length);
  });

  test('INVARIANT: trigger vs sum — permanent architectural regression', () => {
    // One row holding a straight-connected, an angle-connected, a
    // U-connected and an unconnected entry: all four in the arithmetic,
    // only the angle/U connections in triggerConnectionIds.
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('s4', 'rL', '4'), entry('a2', 'rL', '2'),
        entry('u1', 'rL', '1'), entry('x3', 'rL', '3'),
        entry('r4', 'rR', '4'), entry('t2', 'rT', '2')],
      connections: [conn('cS', 's4', 'r4'), conn('cA', 'a2', 't2'),
        conn('cU', 'u1', 'a2')],
    });
    const req = r.widthRequirements.find((q) => q.kind === 'ANGLE_U_ROW');
    assert.deepStrictEqual(req.entryIds, ['a2', 's4', 'u1', 'x3'],
      'all four row entries in the arithmetic');
    assert.strictEqual(req.minimumInches, 30, '6x4 + 2 + 1 + 3');
    assert.deepStrictEqual(req.triggerConnectionIds, ['cA', 'cU'],
      'the straight connection never appears as a trigger');
  });

  test('INVARIANT: requirement ids are globally unique, even with adversarial user ids', () => {
    // A connection and a row deliberately share the user id 'x'.
    const r = calculatePullBox({
      rows: [row('x', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('e1', 'x', '2'), entry('e2', 'rT', '2')],
      connections: [{ id: 'x', entryIds: ['e1', 'e2'] }],
    });
    const ids = [...r.widthRequirements, ...r.heightRequirements,
      ...r.spacingRequirements].map((q) => q.id);
    assert.deepStrictEqual(ids.slice().sort(), [...new Set(ids)].sort(),
      'no collisions');
    assert.ok(ids.includes('angle-u-row:x'));
    assert.ok(ids.includes('spacing:x'), 'kind prefixes keep ids distinguishable');
    const golden = calculatePullBox(goldenFixture());
    const gIds = [...golden.widthRequirements, ...golden.heightRequirements,
      ...golden.spacingRequirements].map((q) => q.id);
    assert.strictEqual(gIds.length, new Set(gIds).size);
  });

  test('extremes 1/2" and 6" coexist in one mixed request with exact values', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '6'), entry('b', 'rR', '6'),
        entry('s', 'rL', '1/2'), entry('t', 'rT', '1/2')],
      connections: [conn('cS', 'a', 'b'), conn('cA', 's', 't')],
    });
    assert.strictEqual(r.minimumWidthIn, 48, '8x6 straight');
    // left row triggered by the 1/2": 6x6 + 0.5 = 36.5
    assert.strictEqual(
      r.widthRequirements.find((q) => q.kind === 'ANGLE_U_ROW').minimumInches,
      36.5);
    assert.strictEqual(r.minimumHeightIn, 3, '6 x 1/2 top row');
    assert.strictEqual(r.spacingRequirements[0].minimumInches, 3);
  });

  test('empty rows in the golden fixture change nothing', () => {
    const q = goldenFixture();
    q.rows = q.rows.concat([row('empty1', 'right', 9), row('empty2', 'top', 9)]);
    assert.deepStrictEqual(calculatePullBox(q), GOLDEN_EXPECTED,
      'configuration structure, not electrical entries');
  });
});

describe('PBV2-5 — frozen validation, trade-size and API contracts', () => {
  test('the fourteen validation reasons behave exactly as frozen', () => {
    const cases = [
      [null, 'MALFORMED_REQUEST'],
      [{ rows: [], entries: [], connections: [] }, 'NO_ENTRIES'],
      [{ rows: [row('r', 'north', 0)], entries: [entry('e', 'r', '2')], connections: [] },
        'INVALID_WALL'],
      [{ rows: [row('r', 'back', 0)], entries: [entry('e', 'r', '2')], connections: [] },
        'UNSUPPORTED_SURFACE'],
      [{ rows: [row('r', 'left', 0), row('r', 'top', 0)],
        entries: [entry('e', 'r', '2')], connections: [] }, 'DUPLICATE_ROW_ID'],
      [{ rows: [row('r', 'left', -1)], entries: [entry('e', 'r', '2')], connections: [] },
        'INVALID_ROW_ORDER'],
      [{ rows: [row('r', 'left', 0)], entries: [entry('e', 'ghost', '2')],
        connections: [] }, 'ROW_UNKNOWN'],
      [{ rows: [row('r', 'left', 0)],
        entries: [entry('e', 'r', '2'), entry('e', 'r', '3')], connections: [] },
        'DUPLICATE_ENTRY_ID'],
      [{ rows: [row('r', 'left', 0)], entries: [entry('e', 'r', '9')], connections: [] },
        'INVALID_TRADE_SIZE'],
      [{ rows: [row('r', 'left', 0), row('r2', 'top', 0)],
        entries: [entry('e1', 'r', '2'), entry('e2', 'r2', '2')],
        connections: [conn('c', 'e1', 'e2'), conn('c', 'e2', 'e1')] },
        'DUPLICATE_CONNECTION_ID'],
      [{ rows: [row('r', 'left', 0)], entries: [entry('e1', 'r', '2')],
        connections: [conn('c', 'e1', 'ghost')] }, 'CONNECTION_UNKNOWN_ENTRY'],
      [{ rows: [row('r', 'left', 0)], entries: [entry('e1', 'r', '2')],
        connections: [conn('c', 'e1', 'e1')] }, 'CONNECTION_SELF'],
      [{ rows: [row('r', 'left', 0), row('r2', 'top', 0)],
        entries: [entry('e1', 'r', '2'), entry('e2', 'r2', '2')],
        connections: [conn('c1', 'e1', 'e2'), conn('c2', 'e2', 'e1')] },
        'DUPLICATE_CONNECTION'],
      [{ rows: [row('r', 'left', 0)], entries: [entry('e1', 'r', '2')],
        connections: [{ id: 'c', entryIds: ['e1'] }] }, 'CONNECTION_ARITY'],
    ];
    for (const [req, reason] of cases) {
      assert.strictEqual(calculatePullBox(req).reason, reason, reason);
    }
    assert.strictEqual(cases.length, 14, 'every frozen reason is exercised');
  });

  test('trade-size contract: twelve keys, TRADE_SIZE_KEYS is the only order', () => {
    assert.deepStrictEqual(TRADE_SIZE_KEYS,
      ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2', '3', '3-1/2', '4', '5', '6']);
    assert.strictEqual(Object.keys(api.TRADE_SIZE_IN).length, 12);
  });

  test('public API surface is exactly the intentional PBV2 pure API', () => {
    assert.deepStrictEqual(Object.keys(api).sort(), [
      'TRADE_SIZE_IN', 'TRADE_SIZE_KEYS', 'WALL_DIMENSION', 'WALL_ORDER',
      'calculatePullBox', 'classifyConnection', 'rowForEntry', 'sortEntries',
      'sortRows', 'validatePullBoxRequest',
    ]);
  });

  test('LEGACY CLOSURE PB-1/PB-2/PB-3 in one place, permanently', () => {
    // PB-1: U [3,3] is 21", never the double-counted 24"
    const pb1 = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '3'), entry('b', 'rL', '3')],
      connections: [conn('cU', 'a', 'b')],
    });
    assert.strictEqual(pb1.minimumWidthIn, 21);
    // PB-2: left [4,2] row is 26"; the opposite-side 3" never makes it 29"
    const pb2 = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0), row('rT', 'top', 0)],
      entries: [entry('L4', 'rL', '4'), entry('L2', 'rL', '2'),
        entry('R3', 'rR', '3'), entry('T2', 'rT', '2')],
      connections: [conn('cA', 'L2', 'T2')],
    });
    assert.strictEqual(
      pb2.widthRequirements.find((q) => q.rowId === 'rL').minimumInches, 26);
    // PB-3: an angle yields per-wall, per-dimension requirements — never one
    // anonymous number
    const pb3 = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '4'), entry('t', 'rT', '2')],
      connections: [conn('cA', 'a', 't')],
    });
    assert.strictEqual(pb3.widthRequirements[0].dimension, 'width');
    assert.strictEqual(pb3.heightRequirements[0].dimension, 'height');
    assert.strictEqual(pb3.minimumWidthIn, 24);
    assert.strictEqual(pb3.minimumHeightIn, 12);
    assert.notStrictEqual(pb3.minimumWidthIn, pb3.minimumHeightIn,
      'two dimensions, two answers — the anonymous "Use largest" is dead');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-9A — same-wall U spacing feasibility metadata (ADDITIVE ONLY)
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-9A — dimension feasibility metadata', () => {
  /** Strip every PBV2-9A addition, leaving the pre-9A contract shape. */
  function stripAdditions(result) {
    const out = JSON.parse(JSON.stringify(result));
    delete out.dimensionStatus;
    for (const s of out.spacingRequirements || []) {
      delete s.sameWall;
      delete s.axis;
    }
    return out;
  }
  function uOn(wall, size) {
    const other = wall === 'left' ? 'right' : wall === 'right' ? 'left'
      : wall === 'top' ? 'bottom' : 'top';
    return {
      rows: [row('rU', wall, 0), row('rX', other, 0)],
      entries: [entry('u1', 'rU', size), entry('u2', 'rU', size)],
      connections: [conn('cU', 'u1', 'u2')],
    };
  }

  test('AUDIT FIXTURE: 12/21/18 unchanged, width flagged LAYOUT_DEPENDENT', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0), row('rB', 'bottom', 0)],
      entries: [entry('L2', 'rL', '2'), entry('T2', 'rT', '2'),
        entry('B3a', 'rB', '3'), entry('B3b', 'rB', '3')],
      connections: [conn('cA', 'L2', 'T2'), conn('cU', 'B3a', 'B3b')],
    });
    // every pre-existing value is exactly as before
    assert.strictEqual(r.minimumWidthIn, 12);
    assert.strictEqual(r.minimumHeightIn, 21);
    assert.strictEqual(r.governingWidthRequirementId, 'angle-u-row:rL');
    assert.strictEqual(r.governingHeightRequirementId, 'angle-u-row:rB');
    assert.deepStrictEqual(r.spacingRequirements.map((s) => s.minimumInches), [12, 18]);
    assert.strictEqual(r.completeForRequest, true);
    // new metadata
    const angle = r.spacingRequirements.find((s) => s.id === 'spacing:cA');
    assert.strictEqual(angle.sameWall, false);
    assert.strictEqual(angle.axis, null);
    const u = r.spacingRequirements.find((s) => s.id === 'spacing:cU');
    assert.strictEqual(u.sameWall, true);
    assert.strictEqual(u.axis, 'width', 'bottom-wall U spacing runs along the width');
    assert.deepStrictEqual(r.dimensionStatus, {
      width: {
        status: 'LAYOUT_DEPENDENT',
        constrainedBySpacingIds: ['spacing:cU'],
        minimumEntrySpacingIn: 18,
      },
      height: { status: 'RESOLVED', constrainedBySpacingIds: [], minimumEntrySpacingIn: null },
    });
  });

  test('ALL FOUR U ORIENTATIONS map to the perpendicular axis', () => {
    for (const [wall, axis, other] of [['bottom', 'width', 'height'],
      ['top', 'width', 'height'], ['left', 'height', 'width'],
      ['right', 'height', 'width']]) {
      const r = calculatePullBox(uOn(wall, '3'));
      assert.strictEqual(r.spacingRequirements[0].axis, axis, wall);
      assert.strictEqual(r.spacingRequirements[0].sameWall, true, wall);
      assert.strictEqual(r.dimensionStatus[axis].status, 'LAYOUT_DEPENDENT', wall);
      assert.strictEqual(r.dimensionStatus[axis].minimumEntrySpacingIn, 18, wall);
      assert.strictEqual(r.dimensionStatus[other].status, 'RESOLVED', wall);
      // endpoint order must not affect the metadata
      const q = uOn(wall, '3');
      q.connections = [conn('cU', 'u2', 'u1')];
      assert.deepStrictEqual(calculatePullBox(q).dimensionStatus, r.dimensionStatus, wall);
    }
  });

  test('BOTH AXES dependent: each axis cites only its own spacing ids', () => {
    const r = calculatePullBox({
      rows: [row('rB', 'bottom', 0), row('rL', 'left', 0)],
      entries: [entry('b1', 'rB', '2'), entry('b2', 'rB', '2'),
        entry('l1', 'rL', '3'), entry('l2', 'rL', '3')],
      connections: [conn('cUb', 'b1', 'b2'), conn('cUl', 'l1', 'l2')],
    });
    assert.strictEqual(r.dimensionStatus.width.status, 'LAYOUT_DEPENDENT');
    assert.deepStrictEqual(r.dimensionStatus.width.constrainedBySpacingIds, ['spacing:cUb']);
    assert.strictEqual(r.dimensionStatus.width.minimumEntrySpacingIn, 12);
    assert.strictEqual(r.dimensionStatus.height.status, 'LAYOUT_DEPENDENT');
    assert.deepStrictEqual(r.dimensionStatus.height.constrainedBySpacingIds, ['spacing:cUl']);
    assert.strictEqual(r.dimensionStatus.height.minimumEntrySpacingIn, 18);
  });

  test('MULTIPLE U on one axis: all ids listed, MAX taken, never summed', () => {
    const r = calculatePullBox({
      rows: [row('rB', 'bottom', 0), row('rT', 'top', 0)],
      entries: [entry('b1', 'rB', '2'), entry('b2', 'rB', '2'),
        entry('t1', 'rT', '4'), entry('t2', 'rT', '4')],
      connections: [conn('zUb', 'b1', 'b2'), conn('aUt', 't1', 't2')],
    });
    const w = r.dimensionStatus.width;
    assert.strictEqual(w.status, 'LAYOUT_DEPENDENT');
    assert.deepStrictEqual(w.constrainedBySpacingIds, ['spacing:aUt', 'spacing:zUb'],
      'deterministically sorted, input order irrelevant');
    assert.strictEqual(w.minimumEntrySpacingIn, 24, 'max(12, 24) — never the sum 36');
  });

  test('ANGLE-ONLY: both axes RESOLVED even with the layout-verify note', () => {
    const r = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('a', 'rL', '4'), entry('t', 'rT', '2')],
      connections: [conn('cA', 'a', 't')],
    });
    assert.strictEqual(r.dimensionStatus.width.status, 'RESOLVED');
    assert.strictEqual(r.dimensionStatus.height.status, 'RESOLVED');
    assert.ok(r.scopeNotes.some((n) => n.code === 'SPACING_VERIFY_IN_LAYOUT'),
      'angle spacing still needs layout verification — a different question');
    assert.strictEqual(r.spacingRequirements[0].axis, null,
      'no diagonal feasibility algorithm in PBV2-9A');
  });

  test('STRAIGHT-ONLY and NO-CONNECTION: RESOLVED, independent of null dimensions', () => {
    const straight = calculatePullBox({
      rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
      entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4')],
      connections: [conn('cS', 'a', 'b')],
    });
    assert.deepStrictEqual(straight.spacingRequirements, []);
    assert.strictEqual(straight.dimensionStatus.width.status, 'RESOLVED');
    assert.strictEqual(straight.dimensionStatus.height.status, 'RESOLVED');
    assert.strictEqual(straight.minimumHeightIn, null,
      'RESOLVED answers a different question than "a candidate exists"');
    assert.ok(straight.scopeNotes.some((n) => n.code === 'NO_HEIGHT_CANDIDATES'),
      'the candidate note still carries that meaning, unchanged');
    const none = calculatePullBox({
      rows: [row('rL', 'left', 0)],
      entries: [entry('a', 'rL', '3')],
      connections: [],
    });
    assert.strictEqual(none.minimumWidthIn, null);
    assert.strictEqual(none.dimensionStatus.width.status, 'RESOLVED');
  });

  test('completeForRequest stays TRUE alongside LAYOUT_DEPENDENT (intentional)', () => {
    const r = calculatePullBox(uOn('bottom', '3'));
    assert.strictEqual(r.completeForRequest, true);
    assert.strictEqual(r.dimensionStatus.width.status, 'LAYOUT_DEPENDENT');
    // data-sufficiency boundary, not an unfinished calculation
    assert.ok(!r.scopeNotes.some((n) => /NOT_CALCULATED$/.test(n.code)
      && n.code !== 'DEPTH_NOT_CALCULATED'));
  });

  test('SPACING STILL NEVER GOVERNS: 36" U spacing leaves a 12" width untouched', () => {
    // bottom row [6,6]: row rule 6x6 + 6 = 42 (height); spacing 6x6 = 36
    // (width axis). Width comes only from the left-wall angle row: 6x2 = 12.
    const r = calculatePullBox({
      rows: [row('rB', 'bottom', 0), row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('b1', 'rB', '6'), entry('b2', 'rB', '6'),
        entry('l2', 'rL', '2'), entry('t2', 'rT', '2')],
      connections: [conn('cU', 'b1', 'b2'), conn('cA', 'l2', 't2')],
    });
    assert.strictEqual(r.spacingRequirements.find((s) => s.id === 'spacing:cU')
      .minimumInches, 36);
    assert.strictEqual(r.minimumWidthIn, 12, 'no max(width, spacing) anywhere');
    assert.strictEqual(r.governingWidthRequirementId, 'angle-u-row:rL');
    assert.strictEqual(r.minimumHeightIn, 42);
    assert.strictEqual(r.dimensionStatus.width.minimumEntrySpacingIn, 36,
      'the constraint is reported as metadata, never folded into the dimension');
  });

  test('ADDITIVE PROOF: stripping the new fields restores the pre-9A contract', () => {
    // Representative fixtures across every family. Stripped results must be
    // structurally identical to the frozen pre-9A shape: same keys, same
    // values, nothing renamed, nothing reordered, nothing removed.
    const fixtures = [
      goldenFixture(),
      uOn('bottom', '3'),
      {
        rows: [row('rL', 'left', 0), row('rR', 'right', 0)],
        entries: [entry('a', 'rL', '4'), entry('b', 'rR', '4')],
        connections: [conn('cS', 'a', 'b')],
      },
      {
        rows: [row('rL', 'left', 0), row('rT', 'top', 0)],
        entries: [entry('a', 'rL', '4'), entry('t', 'rT', '2')],
        connections: [conn('cA', 'a', 't')],
      },
    ];
    const PRE_9A_KEYS = ['ok', 'minimumWidthIn', 'minimumHeightIn',
      'widthRequirements', 'heightRequirements', 'governingWidthRequirementId',
      'governingHeightRequirementId', 'spacingRequirements',
      'completeForRequest', 'warnings', 'scopeNotes'];
    const PRE_9A_SPACING_KEYS = ['id', 'kind', 'connectionType', 'connectionId',
      'entryIds', 'largerTradeSize', 'multiplier', 'minimumInches', 'codeRef'];
    for (const q of fixtures) {
      const stripped = stripAdditions(calculatePullBox(q));
      assert.deepStrictEqual(Object.keys(stripped).sort(), PRE_9A_KEYS.slice().sort(),
        'no field added or lost outside the sanctioned additions');
      for (const s of stripped.spacingRequirements) {
        assert.deepStrictEqual(Object.keys(s).sort(), PRE_9A_SPACING_KEYS.slice().sort());
      }
    }
    // and the golden fixture's stripped result equals the frozen expectation
    const strippedGolden = stripAdditions(calculatePullBox(goldenFixture()));
    const frozenGolden = stripAdditions(GOLDEN_EXPECTED);
    assert.deepStrictEqual(strippedGolden, frozenGolden,
      'every pre-9A value byte-identical');
  });

  test('metadata is deterministic, immutable and finite like the rest', () => {
    const q = {
      rows: [row('rB', 'bottom', 0), row('rL', 'left', 0), row('rT', 'top', 0)],
      entries: [entry('b1', 'rB', '3'), entry('b2', 'rB', '3'),
        entry('l1', 'rL', '2'), entry('l2', 'rL', '2'), entry('t1', 'rT', '4')],
      connections: [conn('cUb', 'b1', 'b2'), conn('cUl', 'l1', 'l2'),
        conn('cA', 'l1', 't1')],
    };
    const ref = calculatePullBox(q);
    let seed = 0x9A11;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    for (let i = 0; i < 15; i++) {
      assert.deepStrictEqual(calculatePullBox({
        rows: shuffle(q.rows), entries: shuffle(q.entries),
        connections: shuffle(q.connections),
      }), ref, 'shuffle #' + i);
    }
    Object.freeze(q); Object.freeze(q.rows); Object.freeze(q.entries);
    Object.freeze(q.connections);
    q.rows.forEach(Object.freeze); q.entries.forEach(Object.freeze);
    q.connections.forEach((c) => { Object.freeze(c); Object.freeze(c.entryIds); });
    const snapshot = JSON.stringify(q);
    assert.deepStrictEqual(calculatePullBox(q), ref);
    assert.strictEqual(JSON.stringify(q), snapshot);
    for (const axis of ['width', 'height']) {
      const v = ref.dimensionStatus[axis].minimumEntrySpacingIn;
      if (v !== null) assert.ok(Number.isFinite(v) && v > 0);
    }
  });

  test('PUBLIC API unchanged: no new exports for this milestone', () => {
    assert.deepStrictEqual(Object.keys(api).sort(), [
      'TRADE_SIZE_IN', 'TRADE_SIZE_KEYS', 'WALL_DIMENSION', 'WALL_ORDER',
      'calculatePullBox', 'classifyConnection', 'rowForEntry', 'sortEntries',
      'sortRows', 'validatePullBoxRequest',
    ]);
  });
});
