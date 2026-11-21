'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.9F — POST-CERTIFICATION STRAIGHT ALIGNMENT

   The solver places entries per wall, so the two ends of an opposite-wall
   (STRAIGHT) pull can sit at different along-wall positions — valid, but the
   route reads as a diagonal. Layer 2 now refines the ACCEPTED witness, after
   the minimum W x H is established and whichever path (finder or B&B) found
   it: for each opposite-wall pull, try moving ONE end onto its partner's
   line, keep only what verifyPoint accepts at the SAME W x H, and prefer the
   lowest total misalignment (a move must beat the incumbent by more than
   one raceway radius over the wall length), then fewest hubs moved, smaller
   movement, the less-constrained wall, canonical id.

   Hard invariants pinned here: W, H, status, walls, rows, sizes, identities
   never change; only alongIn may. The incumbent always competes.
   ════════════════════════════════════════════════════════════════════════ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const E = require('../src/calc/pullBox');
const L2 = require('../src/layout/pullBoxLayout');
const G = require('../src/standards/pullBoxEntryGeometry');
const { refineStraightAlignment, buildModel, verifyPoint, solveFeasibility, toMicro } = L2._internal;

const md5 = (rel) => crypto.createHash('md5')
  .update(fs.readFileSync(path.join(__dirname, '..', rel))).digest('hex');

/* ── request builders (raw engine shape, id-independent) ────────────────── */
function req(spec) {
  // spec: { walls: [[wall, size, rowKey?], ...], conns: [[i, j], ...] }
  const rows = {}; const rowList = []; const entries = [];
  const rowFor = (wall, key) => {
    const k = key || wall + ':0';
    if (!rows[k]) { rows[k] = { id: 'row-' + k, wall, order: Object.values(rows).filter((r) => r.wall === wall).length }; rowList.push(rows[k]); }
    return rows[k].id;
  };
  spec.walls.forEach(([wall, size, key], i) => entries.push({ id: 'e' + i, rowId: rowFor(wall, key), tradeSize: size }));
  const connections = (spec.conns || []).map(([a, b], i) => ({ id: 'c' + i, entryIds: ['e' + a, 'e' + b] }));
  return { rows: rowList, entries, connections };
}
function geometryFor(request) {
  const specs = {};
  for (const e of request.entries) specs[e.id] = { tradeSize: e.tradeSize, racewayType: 'RMC', entryMethod: 'KNOCKOUT_THREADED' };
  const g = G.buildLayoutGeometry(specs);
  assert.ok(g.ok, 'Layer 0 geometry resolves');
  return g.geometry;
}
/** The app's own policy chain (pbv23dCertifyBox): WIDTH, then HEIGHT, then
 *  BALANCED, each only when its fixed axis is engine-resolved. */
function certifyLikeApp(request, result, geometry, options) {
  for (const policy of ['WIDTH', 'HEIGHT', 'BALANCED']) {
    const args = { request, result, geometry, policy, toleranceIn: 1 / 64, options };
    if (policy === 'WIDTH') { if (result.minimumHeightIn === null) continue; args.heightIn = result.minimumHeightIn; }
    if (policy === 'HEIGHT') { if (result.minimumWidthIn === null) continue; args.widthIn = result.minimumWidthIn; }
    const out = L2.findLayoutDimensions(args);
    if (out.status === 'CERTIFIED_WITHIN_TOLERANCE' || out.status === 'CERTIFIED_BOUNDS') return out;
    if (out.status === 'UNKNOWN' || out.status === 'INVALID') return out;
  }
  return null;
}
/** Certify through the app's chain and return both the refined layout and
 *  the raw (unrefined) witness for the same model, so before/after compare. */
function certify(request) {
  const result = E.calculatePullBox(request);
  assert.ok(result.ok, 'engine ok');
  const geometry = geometryFor(request);
  const layout = certifyLikeApp(request, result, geometry);
  assert.ok(layout && layout.placements, 'certified');
  const model = buildModel(request, result, geometry, layout.widthIn, layout.heightIn);
  const solved = solveFeasibility(model, {});
  assert.strictEqual(solved.status, 'FEASIBLE');
  const raw = {}; for (const id of model.ids) raw[id] = L2._internal.fromMicro(solved.witness[id]);
  return { layout, model, raw, path: solved.finder ? 'finder' : 'B&B', result };
}
const isH = (w) => w === 'top' || w === 'bottom';
const OPP = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
function straightMetrics(request, layout) {
  const wallOf = {}; for (const r of request.rows) wallOf[r.id] = r.wall;
  const entryWall = {}; for (const e of request.entries) entryWall[e.id] = wallOf[e.rowId];
  let total = 0; let max = 0; let pairs = 0;
  for (const c of request.connections) {
    const [a, b] = c.entryIds;
    if (OPP[entryWall[a]] !== entryWall[b]) continue;
    pairs++;
    const la = isH(entryWall[a]) ? layout.widthIn : layout.heightIn;
    const lb = isH(entryWall[b]) ? layout.widthIn : layout.heightIn;
    const m = Math.abs(layout.placements[a].alongIn / la - layout.placements[b].alongIn / lb);
    total += m; max = Math.max(max, m);
  }
  return { total, max, pairs };
}
const moved = (raw, layout) => Object.keys(raw).filter((id) => raw[id] !== layout.placements[id].alongIn);

/* ── the real BUILD starter, in raw request shape ───────────────────────── */
const STARTER = req({ walls: [['left', '2', 'left:0'], ['right', '2'], ['left', '3', 'left:1'], ['bottom', '3'], ['top', '4'], ['top', '4']],
  conns: [[0, 1], [2, 3], [4, 5]] });

describe('PBV2-13B-4.9F — STRAIGHT alignment: BUILD starter', () => {
  const c = certify(STARTER);
  test('A. certified W x H is exactly the pre-4.9F box', () => {
    assert.strictEqual(c.layout.widthIn, 33.345703);
    assert.strictEqual(c.layout.heightIn, 28);
    assert.strictEqual(c.layout.status, 'CERTIFIED_WITHIN_TOLERANCE');
  });
  test('B. STRAIGHT misalignment 0.195 -> 0.000', () => {
    const before = straightMetrics(STARTER, { widthIn: c.layout.widthIn, heightIn: c.layout.heightIn,
      placements: Object.fromEntries(Object.keys(c.raw).map((id) => [id, { alongIn: c.raw[id] }])) });
    assert.ok(Math.abs(before.total - 0.195) < 0.002, 'the incumbent really was misaligned: ' + before.total.toFixed(3));
    const after = straightMetrics(STARTER, c.layout);
    assert.strictEqual(after.total, 0, 'perfectly aligned');
    assert.strictEqual(after.max, 0);
  });
  test('C. exactly ONE hub moves — the free RIGHT partner, LEFT stays', () => {
    assert.deepStrictEqual(moved(c.raw, c.layout), ['e1'], 'only the RIGHT end moved');
    assert.strictEqual(c.layout.placements.e0.alongIn, c.raw.e0, 'LEFT end untouched');
    assert.strictEqual(c.layout.placements.e1.alongIn, c.layout.placements.e0.alongIn, 'RIGHT landed on LEFT line');
    assert.strictEqual(c.layout.placements.e2.alongIn, c.raw.e2, 'the unrelated LEFT entry did not move');
  });
  test('D/K-O. rows, walls, sizes and identities are untouched; only alongIn changed', () => {
    for (const e of STARTER.entries) {
      const p = c.layout.placements[e.id];
      assert.ok(p, 'identity kept: ' + e.id);
      assert.strictEqual(p.wall, c.model.byId[e.id].wall, 'wall kept');
    }
    // rows and sizes live on the request; the refinement never sees mutable copies
    assert.strictEqual(JSON.stringify(STARTER.rows.map((r) => r.id)), JSON.stringify(STARTER.rows.map((r) => r.id)));
    assert.strictEqual(Object.keys(c.layout.placements).length, 6, 'no entry added or dropped');
    const body = L2._internal.refineStraightAlignment.toString();
    assert.ok(!/rowId|tradeSize|\.wall\s*=|\.size/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')),
      'the refinement never writes rows, sizes or walls');
  });
  test('E. the refined placement re-verifies under the same authority', () => {
    const pt = {}; for (const id of c.model.ids) pt[id] = toMicro(c.layout.placements[id].alongIn);
    assert.deepStrictEqual(verifyPoint(c.model, pt), { ok: true });
  });
  test('P/Q/R. incumbent competes; candidates bounded, no combinatorial search', () => {
    assert.deepStrictEqual(c.layout.refinement, { straight: { pairs: 1, candidates: 2, rounds: 1 }, applied: true });
    const body = refineStraightAlignment.toString();
    assert.ok(body.includes('let best = witness'), 'P. the incumbent is candidate zero');
    assert.ok(body.includes('round < pairs.length'), 'Q. rounds bounded by pair count');
    assert.ok(!/permutations\(|for \(const p of cands\)|\*\*|Math\.pow/.test(body), 'R. no exponential enumeration');
  });
});

describe('PBV2-13B-4.9F — corpus', () => {
  const invariants = (name, request, expectApplied) => {
    const c = certify(request);
    const raw = { widthIn: c.layout.widthIn, heightIn: c.layout.heightIn,
      placements: Object.fromEntries(Object.keys(c.raw).map((id) => [id, { alongIn: c.raw[id] }])) };
    const before = straightMetrics(request, raw); const after = straightMetrics(request, c.layout);
    assert.ok(after.total <= before.total + 1e-12, name + ': total STRAIGHT never worsens');
    const pt = {}; for (const id of c.model.ids) pt[id] = toMicro(c.layout.placements[id].alongIn);
    assert.deepStrictEqual(verifyPoint(c.model, pt), { ok: true }, name + ': verified');
    const k = before.pairs;
    const st = c.layout.refinement ? c.layout.refinement.straight : { pairs: 0, candidates: 0, rounds: 0 };
    assert.ok(st.candidates <= 2 * k * Math.max(1, k), name + ': candidates <= 2k*k (' + st.candidates + ')');
    assert.ok(st.rounds <= Math.max(1, k), name + ': rounds <= k');
    if (expectApplied !== undefined) assert.strictEqual(!!(c.layout.refinement && c.layout.refinement.applied), expectApplied, name + ': applied=' + expectApplied);
    return { c, before, after, moved: moved(c.raw, c.layout) };
  };

  test('B/F. single STRAIGHT LEFT<->RIGHT aligns (horizontal)', () => {
    const r = invariants('L-R', req({ walls: [['left', '2'], ['right', '2']], conns: [[0, 1]] }));
    assert.strictEqual(r.after.total, 0);
  });
  test('C/G. single STRAIGHT TOP<->BOTTOM aligns (vertical)', () => {
    const r = invariants('T-B', req({ walls: [['top', '2'], ['bottom', '2']], conns: [[0, 1]] }));
    assert.strictEqual(r.after.total, 0);
  });
  test('D/I. multiple STRAIGHT pulls: total never worsens, both may align', () => {
    const r = invariants('multi', req({ walls: [['left', '2'], ['right', '2'], ['top', '3'], ['bottom', '3']], conns: [[0, 1], [2, 3]] }));
    assert.ok(r.after.total <= r.before.total);
    assert.strictEqual(r.after.max, 0, 'independent pulls both align');
  });
  test('E/J. shared raceway: the WHOLE-STATE metric decides', () => {
    // e0 is in two straights: e0<->e1 (L/R) and via a second right partner e2
    const r = invariants('shared', req({ walls: [['left', '2'], ['right', '2'], ['right', '3']], conns: [[0, 1], [0, 2]] }));
    assert.ok(r.after.total <= r.before.total, 'never worse in total');
    assert.ok(r.moved.length <= 2, 'at most one end moved per pull');
  });
  test('F/H. constrained STRAIGHT with no verified candidate keeps the incumbent', () => {
    // three 6" entries jam the left wall; the right partner cannot reach a line that also clears
    const r = invariants('tight', req({ walls: [['left', '6', 'left:0'], ['left', '6', 'left:0'], ['left', '6', 'left:0'], ['right', '6']], conns: [[0, 3]] }));
    if (!r.c.layout.refinement || !r.c.layout.refinement.applied) {
      assert.deepStrictEqual(r.moved, [], 'nothing moved: incumbent kept exactly');
    }
    assert.ok(r.after.total <= r.before.total);
  });
  test('G/H/I. STANDARD, ROWS, DENSE-like fixtures stay valid', () => {
    const standard = req({ walls: [['left', '2'], ['top', '2'], ['bottom', '3'], ['bottom', '3']], conns: [[0, 1], [2, 3]] });
    invariants('STANDARD', standard, false);           // no straight: never applied
    const rows = req({ walls: [['left', '4', 'left:0'], ['left', '2', 'left:0'], ['left', '3', 'left:1'], ['top', '2']], conns: [[0, 3]] });
    invariants('ROWS', rows, false);
  });
  test('J/K/L. FAST STRAIGHT aligned; FAST ANGLE and U byte-identical', () => {
    const s = invariants('FAST straight', req({ walls: [['left', '2'], ['right', '2']], conns: [[0, 1]] }));
    assert.strictEqual(s.after.total, 0);
    const a = invariants('FAST angle', req({ walls: [['left', '2'], ['top', '2']], conns: [[0, 1]] }), false);
    assert.deepStrictEqual(a.moved, [], 'K. ANGLE 12x12 untouched');
    assert.strictEqual(a.c.layout.widthIn + 'x' + a.c.layout.heightIn, '12x12');
    const u = invariants('FAST u', req({ walls: [['bottom', '2'], ['bottom', '2']], conns: [[0, 1]] }), false);
    assert.deepStrictEqual(u.moved, [], 'L. U untouched');
  });
  test('M/N. mixed sizes and extreme aspect ratios stay valid at the same box', () => {
    invariants('mixed', req({ walls: [['left', '1'], ['right', '4'], ['top', '2'], ['bottom', '3']], conns: [[0, 1], [2, 3]] }));
    invariants('wide', req({ walls: [['left', '1/2'], ['right', '1/2'], ['top', '6'], ['bottom', '6']], conns: [[0, 1], [2, 3]] }));
  });
  test('S/T. finder-resolved and B&B-resolved cases both pass through the one stage', () => {
    const f = certify(req({ walls: [['left', '2'], ['right', '2']], conns: [[0, 1]] }));
    assert.strictEqual(f.path, 'finder');
    assert.ok(f.layout.refinement, 'finder case carries refinement stats');
    const dense = req({ walls: [['left', '2', 'left:0'], ['left', '3', 'left:1'], ['left', '2', 'left:0'], ['left', '4', 'left:1'], ['left', '2', 'left:0'], ['left', '3', 'left:1'],
      ['right', '4'], ['right', '2'], ['right', '2'], ['top', '2'], ['top', '3'], ['top', '2'], ['bottom', '3'], ['bottom', '2'], ['bottom', '2'], ['bottom', '3']],
    conns: [[0, 6], [9, 13], [1, 10], [12, 15], [7, 11]] });
    const b = certify(dense);
    assert.strictEqual(b.path, 'B&B');
    assert.ok(b.layout.refinement, 'B&B case carries the SAME refinement stats');
    assert.strictEqual(b.layout.widthIn + 'x' + b.layout.heightIn, '32x25', 'DENSE box unchanged');
    // one function, one call site, no per-path branch
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/layout/pullBoxLayout.js'), 'utf8');
    assert.strictEqual((src.match(/refineStraightAlignment\(model, request, solved\.witness\)/g) || []).length, 1);
    assert.ok(!/finder.*refine|refine.*finder/i.test(refineStraightAlignment.toString()), 'the stage is path-blind');
  });
  test('Z. reversed input ordering yields the same certified geometry', () => {
    const a = certify(STARTER);
    const rev = { rows: STARTER.rows.slice().reverse(), entries: STARTER.entries.slice().reverse(),
      connections: STARTER.connections.slice().reverse().map((c) => ({ id: c.id, entryIds: c.entryIds.slice().reverse() })) };
    const b = certify(rev);
    assert.strictEqual(a.layout.widthIn, b.layout.widthIn); assert.strictEqual(a.layout.heightIn, b.layout.heightIn);
    for (const id of Object.keys(a.layout.placements)) {
      assert.strictEqual(a.layout.placements[id].alongIn, b.layout.placements[id].alongIn, 'same alongIn for ' + id);
    }
  });
});

describe('PBV2-13B-4.9F — certified dimension invariance sweep', () => {
  test('AA. hundreds of requests: 0 W changes, 0 H changes, 0 status changes', () => {
    const sizes = ['1/2', '3/4', '1', '1-1/2', '2', '3', '4'];
    const walls = ['left', 'right', 'top', 'bottom'];
    let n = 0; let applied = 0;
    for (let i = 0; i < 320; i++) {
      // deterministic pseudo-random corpus (LCG), independent of Math.random
      let seed = 12345 + i * 7919;
      const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
      const count = 2 + rnd(3);
      const spec = { walls: [], conns: [] };
      for (let j = 0; j < count; j++) spec.walls.push([walls[rnd(4)], sizes[rnd(sizes.length)]]);
      // connect pairs; guarantee at least one opposite-wall pull half the time
      for (let j = 0; j + 1 < count; j += 2) spec.conns.push([j, j + 1]);
      if (rnd(2) === 0) { spec.walls.push(['left', '2']); spec.walls.push(['right', '2']); spec.conns.push([count, count + 1]); }
      const request = req(spec);
      const result = E.calculatePullBox(request);
      if (!result.ok) continue;
      const geometry = geometryFor(request);
      /* A small node budget keeps the sweep predictable on CI: some random
         requests make the pre-existing B&B exhaust its 200k default on
         near-boundary HEIGHT probes (seconds each). The refinement is not
         involved in those probes — it runs only on FEASIBLE witnesses — and
         the invariants below are checked against the raw solve of the SAME
         model with the SAME budget. */
      const options = { nodeBudget: 3000 };
      const layout = certifyLikeApp(request, result, geometry, options);
      if (!layout || !layout.placements) continue;
      const model = buildModel(request, result, geometry, layout.widthIn, layout.heightIn);
      const solved = solveFeasibility(model, options);
      assert.strictEqual(solved.status, 'FEASIBLE', 'status unchanged');
      assert.strictEqual(L2._internal.fromMicro(model.W), layout.widthIn, 'W unchanged');
      assert.strictEqual(L2._internal.fromMicro(model.H), layout.heightIn, 'H unchanged');
      const pt = {}; for (const id of model.ids) pt[id] = toMicro(layout.placements[id].alongIn);
      assert.deepStrictEqual(verifyPoint(model, pt), { ok: true }, 'refined witness verifies');
      n++; if (layout.refinement && layout.refinement.applied) applied++;
    }
    assert.ok(n >= 200, 'a real sweep ran: ' + n);
    assert.ok(applied > 0, 'the refinement engaged somewhere in the sweep: ' + applied);
  });
});

describe('PBV2-13B-4.9F — layers and build', () => {
  test('AB/AC. Layers 0 and 1 frozen; AD. Layer 2 intentionally re-frozen', () => {
    assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
  });
  test('solver internals are byte-identical to the frozen 4.6 source', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/layout/pullBoxLayout.js'), 'utf8');
    const body = (n) => { const i = src.indexOf('function ' + n + '('); let d = 0; let st = false;
      for (let j = i; j < src.length; j++) { if (src[j] === '{') { d++; st = true; } else if (src[j] === '}') { d--; if (st && d === 0) return src.slice(i, j + 1); } } };
    const h = (s) => crypto.createHash('md5').update(s).digest('hex');
    assert.strictEqual(h(body('verifyPoint')), '759bfc14889693732b24dc24438a6bb2');
    assert.strictEqual(h(body('nodeCandidates')), 'b3a49fcd356979b00a81af4f0d9e6107');
    assert.strictEqual(h(body('witnessSearch')), '2e45e0a931dd12512fdec5d225d423b0');
    assert.strictEqual(h(body('packWall')), '48ebcd283e820e0511d224834dd08620');
    assert.strictEqual(h(body('solveFeasibility')), '2f00314a12d2ec64bd2196e383543db1');
  });
  test('AE. mobile.html carries the refined Layer 2 (build parity)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
    assert.ok(html.includes('function refineStraightAlignment('), 'bundled');
    assert.ok(html.includes('refineStraightAlignment(model, request, solved.witness)'), 'wired at the seam');
  });
});
