'use strict';
/**
 * PBV2-13B-4.6 — Material-slack balanced placement (Layer-2 finder policy).
 *
 * Layer 2 was deliberately unfrozen for ONE scoped change: witnessSearch now
 * proposes a 'balanced' packing first, and packWall implements it as
 *
 *   occupied = minimal packed extent of the wall group
 *   free     = wallLength - occupied
 *   eligible = free >= occupied          (box-space-aware, NOT universal centring)
 *   shift_i  = free * (i + 1) / (n + 1)  for entries in canonical order
 *
 * A proposal only: verifyPoint is untouched and remains the sole authority; an
 * eligible wall whose balanced candidate fails simply falls through to the
 * pre-existing modes and search. This file pins the rule, its boundary, its
 * algebra, and — most importantly — that certified dimensions never change.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const L0 = require('../src/standards/pullBoxEntryGeometry');
const L1 = require('../src/calc/pullBox');
const L2 = require('../src/layout/pullBoxLayout');
const sweep = require('./fixtures/pbv2-13b-4-6-sweep');
const GOLDEN = require('./fixtures/pbv2-13b-4-6-dims-before.json');
const l2src = fs.readFileSync(path.join(__dirname, '..', 'src', 'layout', 'pullBoxLayout.js'), 'utf8');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, '..', p))).digest('hex');

/** Direct Layer-2 driver: request -> Layer 1 -> Layer 0 -> Layer 2 (same wiring as the UI). */
function drive(request, opts) {
  const result = L1.calculatePullBox(request);
  assert.strictEqual(result.ok, true, 'Layer 1 accepts the fixture');
  const specs = {};
  for (const e of request.entries) specs[e.id] = { tradeSize: e.tradeSize, racewayType: 'RMC', entryMethod: 'KNOCKOUT_THREADED' };
  const geometry = L0.buildLayoutGeometry(specs).geometry;
  return { result, geometry, run: (extra) => L2.findLayoutDimensions({ request, result, geometry, ...(opts || {}), ...(extra || {}) }),
    check: (W, H) => L2.checkLayout({ request, result, geometry, widthIn: W, heightIn: H }) };
}
function mk() {
  const rows = {}; const entries = []; const connections = []; let n = 0;
  const row = (wall) => { if (!rows[wall]) rows[wall] = { id: 'r-' + wall, wall, order: 0 }; return rows[wall].id; };
  return {
    add: (wall, size) => { const id = 'e' + (++n); entries.push({ id, rowId: row(wall), tradeSize: size }); return id; },
    conn: (a, b) => { connections.push({ id: 'c' + connections.length, entryIds: [a, b] }); },
    req: () => ({ rows: Object.values(rows), entries, connections }),
  };
}
const standard = () => { const m = mk(); m.conn(m.add('left', '2'), m.add('top', '2')); m.conn(m.add('bottom', '3'), m.add('bottom', '3')); return m.req(); };
const widthAtFloor = (d) => d.run({ policy: 'WIDTH', heightIn: d.result.minimumHeightIn });
const norm = (p, L) => p / L;
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

describe('PBV2-13B-4.6 — material-slack balanced placement', () => {
  test('A. STANDARD 26x21: the passenger ANGLE entries move to mid-wall', () => {
    const d = drive(standard()); const r = widthAtFloor(d);
    assert.strictEqual(r.status, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(near(r.widthIn, 25.253906) && r.heightIn === 21, 'certified box is the pre-4.6 box');
    assert.strictEqual(r.placements.e1.alongIn, 10.5, 'LEFT entry centred on the 21" wall');
    assert.ok(near(norm(r.placements.e2.alongIn, r.widthIn), 0.5, 1e-6), 'TOP entry centred on the certified width');
  });

  test('B. STANDARD: the binding U entries are EXACTLY unchanged', () => {
    const d = drive(standard()); const r = widthAtFloor(d);
    // strict equality — tolerance-noise movement (as global balanced-first produced) is a failure
    assert.strictEqual(r.placements.e3.alongIn, 1.8125);
    assert.strictEqual(r.placements.e4.alongIn, 23.4375);
  });

  test('C. 12x12 ANGLE-only keeps its compact diagonal (balanced fails verifyPoint, falls through)', () => {
    const m = mk(); m.conn(m.add('left', '2'), m.add('top', '2'));
    const d = drive(m.req()); const r = widthAtFloor(d);
    assert.strictEqual(r.widthIn, 12); assert.strictEqual(r.heightIn, 12);
    assert.strictEqual(r.placements.e1.alongIn, 1.25); assert.strictEqual(r.placements.e2.alongIn, 10.75);
    // the centred proposal is genuinely infeasible here, not merely skipped
    const u = 12 - 6; const v = 6; assert.ok((u - 1.25) ** 2 + (v - 1.25) ** 2 < 144, 'centre violates the corner equation');
  });

  test('D. well-separated 4"/4" ANGLE unchanged', () => {
    const m = mk(); m.conn(m.add('left', '4'), m.add('top', '4'));
    const r = widthAtFloor(drive(m.req()));
    assert.strictEqual(r.widthIn, 24); assert.strictEqual(r.heightIn, 24);
    assert.strictEqual(r.placements.e1.alongIn, 2.336); assert.strictEqual(r.placements.e2.alongIn, 21.664);
  });

  test('E. STRAIGHT passenger in a U-controlled box moves to mid-wall — intentional, not accidental', () => {
    const m = mk(); m.conn(m.add('left', '2'), m.add('right', '2')); m.conn(m.add('bottom', '3'), m.add('bottom', '3'));
    const r = widthAtFloor(drive(m.req()));
    assert.strictEqual(r.widthIn, 25.25); assert.strictEqual(r.heightIn, 21);
    assert.strictEqual(r.placements.e1.alongIn, 10.5); assert.strictEqual(r.placements.e2.alongIn, 10.5);
    assert.strictEqual(r.placements.e3.alongIn, 1.8125); assert.strictEqual(r.placements.e4.alongIn, 23.4375);
  });

  test('F. tight STRAIGHT unchanged (zero free length)', () => {
    const m = mk(); m.conn(m.add('left', '2'), m.add('right', '2'));
    const r = widthAtFloor(drive(m.req()));
    assert.strictEqual(r.widthIn, 16); assert.strictEqual(r.heightIn, 2.5);
    assert.strictEqual(r.placements.e1.alongIn, 1.25); assert.strictEqual(r.placements.e2.alongIn, 1.25);
  });

  test('G. U-only binding entries EXACTLY unchanged', () => {
    const m = mk(); m.conn(m.add('bottom', '3'), m.add('bottom', '3'));
    const r = widthAtFloor(drive(m.req()));
    assert.ok(near(r.widthIn, 25.261719)); assert.strictEqual(r.heightIn, 21);
    assert.strictEqual(r.placements.e1.alongIn, 1.8125); assert.strictEqual(r.placements.e2.alongIn, 23.4375);
  });

  test('H. ROWS unchanged: an eligible wall whose balanced proposal fails simply falls through', () => {
    const m = mk();
    const rows = [{ id: 'r1', wall: 'left', order: 0 }, { id: 'r2', wall: 'left', order: 1 }, { id: 'rt', wall: 'top', order: 0 }];
    const entries = [{ id: 'a4', rowId: 'r1', tradeSize: '4' }, { id: 'a2', rowId: 'r1', tradeSize: '2' },
      { id: 'b3', rowId: 'r2', tradeSize: '3' }, { id: 'tp', rowId: 'rt', tradeSize: '2' }];
    const request = { rows, entries, connections: [{ id: 'c0', entryIds: ['a4', 'tp'] }] };
    const r = widthAtFloor(drive(request));
    assert.strictEqual(r.widthIn, 26); assert.strictEqual(r.heightIn, 12);
    assert.strictEqual(r.placements.tp.alongIn, 24.75, 'TOP stays at the far end (centre fails the 4" corner equation)');
    // the exact pre-4.6 witness for THIS request (recorded from Layer 2 @06381d81)
    assert.deepStrictEqual({ a2: r.placements.a2.alongIn, a4: r.placements.a4.alongIn, b3: r.placements.b3.alongIn },
      { a2: 7.125, a4: 3.539, b3: 10.1875 });
    void m;
  });

  test('I. DENSE unchanged: the finder is bypassed and B&B candidate generation is untouched', () => {
    const plan = [['left', '2'], ['left', '3'], ['left', '2'], ['left', '4'], ['left', '2'], ['left', '3'], ['right', '4'], ['right', '2'],
      ['right', '2'], ['top', '2'], ['top', '3'], ['top', '2'], ['bottom', '3'], ['bottom', '2'], ['bottom', '2'], ['bottom', '3']];
    const rows = [{ id: 'l1', wall: 'left', order: 0 }, { id: 'l2', wall: 'left', order: 1 }, { id: 'rr', wall: 'right', order: 0 },
      { id: 'rt', wall: 'top', order: 0 }, { id: 'rb', wall: 'bottom', order: 0 }];
    const entries = plan.map(([w, s], i) => ({ id: 'e' + i, rowId: w === 'left' ? (i % 2 === 0 ? 'l1' : 'l2') : { right: 'rr', top: 'rt', bottom: 'rb' }[w], tradeSize: s }));
    const connections = [['e0', 'e6'], ['e9', 'e13'], ['e1', 'e10'], ['e12', 'e15'], ['e7', 'e11']].map((p, i) => ({ id: 'c' + i, entryIds: p }));
    const r = widthAtFloor(drive({ rows, entries, connections }));
    assert.strictEqual(r.widthIn, 32); assert.strictEqual(r.heightIn, 25);
    // the exact pre-4.6 witness for THIS request (recorded from Layer 2 @06381d81)
    const want = { e0: 1.25, e1: 9.3125, e10: 30.1875, e11: 24.625, e12: 6.8125, e13: 1.25, e14: 3.75, e15: 28.4375,
      e2: 3.75, e3: 17.086, e4: 6.25, e5: 12.9375, e6: 7.336, e7: 1.25, e8: 3.75, e9: 27.125 };
    const got = {}; for (const [id, p] of Object.entries(r.placements)) got[id] = p.alongIn;
    /* SUPERSEDED BY PBV2-13B-4.9F: the B&B candidate generation is still
       untouched (pinned below), but the post-certification STRAIGHT alignment
       is deliberately path-agnostic, so it now applies to this B&B-resolved
       box too. Exactly ONE hub moves: e9 (TOP) onto its partner e13's line —
       the TOP/BOTTOM straight — at the same 32 x 25. The LEFT/RIGHT straight
       e0/e6 has no verified one-end candidate and keeps its pre-4.6 witness. */
    const moved = Object.keys(want).filter((id) => got[id] !== want[id]);
    assert.deepStrictEqual(moved, ['e9'], 'only the free TOP end of the TOP/BOTTOM straight moves');
    assert.strictEqual(got.e9, got.e13, 'and it lands exactly on its partner line');
    for (const id of Object.keys(want)) if (id !== 'e9') assert.strictEqual(got[id], want[id], id + ' unchanged');
    assert.ok(r.refinement && r.refinement.applied === true && r.refinement.straight.pairs === 2);
    // structural: nodeCandidates still has exactly its three modes and no fourth
    const nc = l2src.slice(l2src.indexOf('function nodeCandidates'), l2src.indexOf('function greedyCandidate'));
    assert.ok(nc.includes("const modes = ['left', 'right', 'mid'];"), 'B&B candidate modes untouched');
    assert.ok(!nc.includes('balanced'), 'no balanced mode in B&B');
  });

  /* ── balanced algebra at explicit boxes (checkLayout) ───────────────────── */
  function wallGroup(sizes, H) {
    // n raceways on the LEFT wall, each in its own LEFT-RIGHT straight (no spacing
    // geometry), so the LEFT wall's group is governed by rim contact only
    const m = mk(); const ids = [];
    for (const s of sizes) { const l = m.add('left', s); m.conn(l, m.add('right', s)); ids.push(l); }
    const d = drive(m.req()); const r = d.check(40, H);
    return { r, ids: ids.sort(), positions: ids.sort().map((id) => r.placements && r.placements[id].alongIn), d };
  }
  const dia = { '1': 1.406, '2': 2.5, '3': 3.625 };

  test('J. one entry: eligible wall centres exactly', () => {
    const { r, positions } = wallGroup(['2'], 21);
    assert.strictEqual(r.status, 'FEASIBLE'); assert.strictEqual(positions[0], 10.5);
  });

  test('K. two entries: n+1 equal gaps, order and rim contact preserved', () => {
    const { positions } = wallGroup(['2', '2'], 21);
    const gap = (21 - 5) / 3;   // free 16" over three gaps
    assert.ok(near(positions[0], 1.25 + gap, 1e-5) && near(positions[1], 3.75 + 2 * gap, 1e-5), positions.join(','));
    assert.ok(positions[1] - positions[0] >= 2.5 - 1e-9, 'minimum separation kept');
  });

  test('L. three entries: canonical order, no swapping, equal gaps', () => {
    const { positions } = wallGroup(['2', '2', '2'], 21);
    const gap = (21 - 7.5) / 4;
    assert.ok(near(positions[0], 1.25 + gap, 1e-5) && near(positions[1], 3.75 + 2 * gap, 1e-5) && near(positions[2], 6.25 + 3 * gap, 1e-5));
    for (let i = 1; i < 3; i++) assert.ok(positions[i] - positions[i - 1] >= 2.5 - 1e-9, 'no negative gap, no overlap');
  });

  test('M. mixed diameters: the packed group keeps its geometry and spreads coherently', () => {
    const { positions, ids } = wallGroup(['1', '3', '2'], 28);
    // canonical id order e1 (1"), e3 (3"), e5 (2"): packed 0.703, 3.2185, 6.281 -> occupied 7.531
    const occupied = 6.281 + 1.25; const free = 28 - occupied; const step = free / 4;
    assert.deepStrictEqual(ids, ['e1', 'e3', 'e5']);
    assert.ok(near(positions[0], 0.703 + step, 1e-5) && near(positions[1], 3.2185 + 2 * step, 1e-5) && near(positions[2], 6.281 + 3 * step, 1e-5), positions.join(','));
    assert.ok(positions[1] - positions[0] >= (dia['1'] + dia['3']) / 2 - 1e-9 && positions[2] - positions[1] >= (dia['3'] + dia['2']) / 2 - 1e-9);
  });

  test('N/O/P. the hard boundary: free < occupied packs, free == occupied balances, free > occupied balances', () => {
    for (const [n, occ] of [[1, 2.5], [2, 5], [3, 7.5]]) {
      const sizes = Array(n).fill('2'); const thr = 2 * occ; const eps = 1 / 64;
      const below = wallGroup(sizes, thr - eps).positions;
      const at = wallGroup(sizes, thr).positions;
      const above = wallGroup(sizes, thr + eps).positions;
      const packed = Array.from({ length: n }, (_, i) => 1.25 + 2.5 * i);
      assert.deepStrictEqual(below, packed, 'n=' + n + ' below threshold is byte-equivalent to left packing');
      const stepAt = occ / (n + 1);
      at.forEach((p, i) => assert.ok(near(p, packed[i] + stepAt * (i + 1), 1e-5), 'n=' + n + ' at threshold balanced'));
      above.forEach((p, i) => assert.ok(p > at[i] - 1e-9, 'n=' + n + ' above threshold still balanced'));
      // the documented step at the boundary: last entry moves occupied*n/(n+1)
      assert.ok(near(at[n - 1] - below[n - 1], occ * n / (n + 1), 1e-5), 'n=' + n + ' boundary step as documented');
    }
  });

  test('Q. every witness carries the verified certificate and passes containment/separation', () => {
    for (const c of sweep.cases().slice(0, 200)) {
      const d = drive(c.request); const r = widthAtFloor(d);
      if (!r.placements) continue;
      assert.strictEqual(r.status.startsWith('CERTIFIED'), true);
      const chk = d.check(r.widthIn, r.heightIn);
      assert.ok(chk.certificate && chk.certificate.kind === 'ACCEPTED_BOX_WITH_VERIFIED_WITNESS', c.key);
      for (const [id, p] of Object.entries(r.placements)) {
        const rr = d.geometry.entries[id].entryMeasurementDiameterIn / 2;
        const L = (p.wall === 'top' || p.wall === 'bottom') ? r.widthIn : r.heightIn;
        assert.ok(p.alongIn >= rr - 1e-6 && p.alongIn <= L - rr + 1e-6, c.key + ' containment ' + id);
      }
    }
  });

  test('R. deterministic: repeated runs are identical', () => {
    for (const req of [standard(), (() => { const m = mk(); m.conn(m.add('left', '2'), m.add('right', '2')); m.conn(m.add('bottom', '3'), m.add('bottom', '3')); return m.req(); })()]) {
      const d = drive(req); const a = widthAtFloor(d); const b = widthAtFloor(d);
      assert.deepStrictEqual(a.placements, b.placements); assert.strictEqual(a.widthIn, b.widthIn);
    }
  });

  test('S. input/ID-order independence: reversed arrays give the same certified witness', () => {
    for (const c of sweep.cases().filter((_, i) => i % 7 === 0)) {
      const d = drive(c.request); const a = widthAtFloor(d);
      const rev = { rows: c.request.rows.slice().reverse(), entries: c.request.entries.slice().reverse(), connections: c.request.connections.slice().reverse() };
      const d2 = drive(rev); const b = widthAtFloor(d2);
      assert.strictEqual(a.status, b.status, c.key);
      assert.strictEqual(a.widthIn, b.widthIn, c.key); assert.strictEqual(a.heightIn, b.heightIn, c.key);
      assert.deepStrictEqual(a.placements, b.placements, c.key);
    }
  });

  test('T. certified W x H invariance: 776 requests x 2 policies reproduce the pre-4.6 golden table exactly', () => {
    let compared = 0; const diffs = [];
    for (const c of sweep.cases()) {
      const got = sweep.run(L2, L1, L0, c); const want = GOLDEN[c.key];
      assert.ok(want !== undefined, 'golden entry exists for ' + c.key);
      if (typeof want === 'string') { compared++; if (got.status !== want) diffs.push(c.key + ' status'); continue; }
      for (const p of ['WIDTH', 'BALANCED']) {
        compared++;
        const g = [got[p].status, got[p].W, got[p].H];
        if (JSON.stringify(g) !== JSON.stringify(want[p])) diffs.push(c.key + '/' + p + ' ' + JSON.stringify(want[p]) + ' -> ' + JSON.stringify(g));
      }
    }
    assert.ok(compared >= 1500, 'compared ' + compared);
    assert.deepStrictEqual(diffs, [], 'certified dimension or status changes: ' + diffs.length);
  });

  test('U. Layers 0 and 1 remain frozen', () => {
    assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
  });

  test('V. Layer 2 is re-frozen at the 4.6 hash; verifyPoint untouched', () => {
    assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    /* PBV2-13B-4.9F: the region between verifyPoint and the public API now
       also holds the post-certification STRAIGHT refinement, so the pin is
       narrowed to verifyPoint's own body — proven byte-identical to the
       frozen 4.6 source. */
    const vpStart = l2src.indexOf('function verifyPoint(');
    let depth = 0; let started = false; let vpEnd = vpStart;
    for (let j = vpStart; j < l2src.length; j++) {
      if (l2src[j] === '{') { depth++; started = true; } else if (l2src[j] === '}') { depth--; if (started && depth === 0) { vpEnd = j + 1; break; } }
    }
    const vp = l2src.slice(vpStart, vpEnd);
    assert.strictEqual(crypto.createHash('md5').update(vp).digest('hex'), '759bfc14889693732b24dc24438a6bb2', 'verifyPoint body unchanged (identical since 4.6)');
    assert.ok(l2src.includes("for (const mode of ['balanced', 'left', 'right', 'spread'])"), 'balanced is the FIRST finder proposal');
    assert.ok(l2src.includes('if (slack >= occupied) {'), 'the material-slack gate is the approved rule');
  });

  test('W. mobile.html carries the same Layer 2 the tests ran (build parity)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
    assert.ok(html.includes("for (const mode of ['balanced', 'left', 'right', 'spread'])"), 'injected bundle has the 4.6 finder order');
    assert.ok(html.includes('if (slack >= occupied) {'), 'injected bundle has the material-slack gate');
  });
});
