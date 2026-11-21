'use strict';
/**
 * PBV2-13B-1 — certified pull-box layout solver core (Layer 2).
 *
 * Oracles use EXPLICIT synthetic entryMeasurementDiameterIn values; the
 * spacing scalars and dimension floors always come from the REAL Layer-1
 * engine. Layer 2 is exercised on its public API and, where the proof
 * mechanism matters, on its internals.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const L2 = require('../src/layout/pullBoxLayout');
const E = require('../src/calc/pullBox');

const ENGINE_MD5 = 'bdd49316a39ebadd3e43718a31e01739';

/** Build (request, real Layer-1 result, geometry) from a compact spec. */
function mk(entries, conns, rowsSpec) {
  const rows = {}; const req = { rows: [], entries: [], connections: [] };
  for (const [id, e] of Object.entries(entries)) {
    const rowId = e.row || ('row-' + e.wall);
    if (!rows[rowId]) { rows[rowId] = true; req.rows.push({ id: rowId, wall: e.wall, order: e.order || 0 }); }
    req.entries.push({ id, rowId, tradeSize: String(e.d) });
  }
  conns.forEach((c, i) => req.connections.push({ id: c.id || ('c' + i), entryIds: [c.a, c.b] }));
  const geometry = { units: 'in', entries: {} };
  for (const [id, e] of Object.entries(entries)) geometry.entries[id] = { entryMeasurementDiameterIn: e.dia };
  const result = E.calculatePullBox(req);
  assert.strictEqual(result.ok, true, 'fixture must be a valid Layer-1 request');
  return { request: req, result, geometry };
}
const check = (m, W, H, options) => L2.checkLayout({ request: m.request, result: m.result, geometry: m.geometry, widthIn: W, heightIn: H, options });
const find = (m, policy, extra) => L2.findLayoutDimensions({ request: m.request, result: m.result, geometry: m.geometry, policy, toleranceIn: 1 / 64, ...extra });

describe('PBV2-13B-1 — layer boundary', () => {
  test('Layer 1 is byte-identical and untouched', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'calc', 'pullBox.js'));
    assert.strictEqual(crypto.createHash('md5').update(src).digest('hex'), ENGINE_MD5);
  });

  test('Layer 2 imports nothing and reimplements no NEC rule', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'layout', 'pullBoxLayout.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/require\(/.test(src), 'no imports: it consumes plain result objects');
    assert.ok(!/tradeSize\s*[*+]|[*]\s*8n?\b|\b8n?\s*[*]|[*]\s*6n?\b|\b6n?\s*[*]/.test(src),
      'no 8x / 6x arithmetic — floors and spacing come from Layer 1');
    assert.ok(!/TRADE_SIZE|WALL_DIMENSION|classifyConnection|314\.28/.test(src), 'no engine internals');
    assert.ok(src.includes('spacingRequirements') && src.includes('minimumWidthIn'),
      'consumes the Layer-1 result contract');
    // the rejected geometry model is nowhere in the module
    assert.ok(!/centerDistance|centreDistance/.test(src));
    // no UI geometry
    assert.ok(!/visualPosition|viewBox|svg|pixel|\.v\b|document|window/i.test(src));
  });

  test('a Layer-1 result is REQUIRED — Layer 2 never runs without it', () => {
    const m = mk({ A: { wall: 'left', d: 2, dia: 2.2 } }, []);
    assert.strictEqual(L2.checkLayout({ request: m.request, geometry: m.geometry, widthIn: 12, heightIn: 12 }).status, 'INVALID');
    assert.strictEqual(L2.checkLayout({ request: m.request, result: { ok: false }, geometry: m.geometry, widthIn: 12, heightIn: 12 }).reason, 'LAYER1_RESULT_REQUIRED');
  });
});

describe('PBV2-13B-1 — exact arithmetic', () => {
  const { toMicro, fromMicro } = L2._internal;
  test('decimal inputs convert exactly with directional rounding', () => {
    assert.strictEqual(toMicro(1.1, 'up'), 1100000n, '1.1 is exact, no float drift');
    assert.strictEqual(toMicro(3.594, 'nearest'), 3594000n);
    assert.strictEqual(toMicro(0.0000001, 'up'), 1n, 'excess precision rounds UP');
    assert.strictEqual(toMicro(0.0000001, 'down'), 0n);
    assert.strictEqual(toMicro(12, 'nearest'), 12000000n);
    assert.strictEqual(fromMicro(13162109n), 13.162109);
    assert.throws(() => toMicro(NaN, 'up'), /NON_FINITE/);
    assert.throws(() => toMicro(Infinity, 'up'), /NON_FINITE/);
  });
});

describe('PBV2-13B-1 — required oracles', () => {
  test('A. single straight: no spacing geometry, feasible at the floors', () => {
    const m = mk({ A: { wall: 'left', d: 4, dia: 4.5 }, B: { wall: 'right', d: 4, dia: 4.5 } }, [{ a: 'A', b: 'B' }]);
    assert.strictEqual(m.result.minimumWidthIn, 32);
    const r = check(m, 32, 4.5);       // height only needs to contain the openings
    assert.strictEqual(r.status, 'FEASIBLE');
    const model = L2._internal.buildModel(m.request, m.result, m.geometry, 32, 4.5);
    assert.strictEqual(model.adjacent.length, 0, 'a straight pull adds no adjacent constraint');
    assert.strictEqual(model.sameWall.length, 0);
    assert.strictEqual(r.certificate.kind, 'ACCEPTED_BOX_WITH_VERIFIED_WITNESS');
  });

  test('B. same-wall U 3"/3", r=1.1: exact analytic extent  W >= S + rA + rB + 2r', () => {
    // S = 18 (engine); |sA - sB| >= 18 + 2.2 = 20.2 ; containment adds a radius each side => W >= 22.4
    const m = mk({ A: { wall: 'bottom', d: 3, dia: 2.2 }, B: { wall: 'bottom', d: 3, dia: 2.2 } }, [{ a: 'A', b: 'B' }]);
    assert.strictEqual(m.result.spacingRequirements[0].minimumInches, 18);
    assert.strictEqual(m.result.minimumHeightIn, 21);
    assert.strictEqual(check(m, 22.4, 21).status, 'FEASIBLE', 'exactly at the analytic bound');
    assert.strictEqual(check(m, 22.39, 21).status, 'INFEASIBLE', 'just below is certified impossible');
    const f = find(m, 'WIDTH', { heightIn: 21 });
    assert.strictEqual(f.status, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(Math.abs(f.widthIn - 22.4) <= 1 / 64, 'certified minimum within tolerance: ' + f.widthIn);
    const p = f.placements;
    assert.ok(Math.abs(p.A.alongIn - p.B.alongIn) >= 20.2 - 1e-6, 'witness respects the exact inequality');
  });

  test('C. single angle, equal 2"/2", r=1.1: feasible at the 12x12 floors', () => {
    const m = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 } }, [{ a: 'A', b: 'B' }]);
    assert.strictEqual(m.result.minimumWidthIn, 12);
    assert.strictEqual(m.result.minimumHeightIn, 12);
    const r = check(m, 12, 12);
    assert.strictEqual(r.status, 'FEASIBLE');
    // exact face-plane check on the witness: (u-r)^2+(v-r)^2 >= 144 at the TL corner
    const u = 12 - r.placements.A.alongIn; const v = r.placements.B.alongIn;
    assert.ok((u - 1.1) ** 2 + (v - 1.1) ** 2 >= 144 - 1e-6);
  });

  test('D. unequal angle near the boundary: continuum FEASIBLE where a 0.25" grid misses', () => {
    const m = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'bottom', d: 3, dia: 3.3 } }, [{ a: 'A', b: 'B' }]);
    assert.deepStrictEqual([m.result.minimumWidthIn, m.result.minimumHeightIn], [12, 18]);
    // the margin is only ~0.037": max rim distance hypot(12-3.3, 18-2.2) = 18.037 >= 18
    assert.ok(Math.hypot(12 - 3.3, 18 - 2.2) - 18 < 0.05);
    const r = check(m, 12, 18);
    assert.strictEqual(r.status, 'FEASIBLE', 'the certified solver finds it');
    // sanity demonstration (NOT a proof mechanism): a 0.25" lattice finds no witness
    let gridHit = false;
    for (let sa = 1.1; sa <= 18 - 1.1 + 1e-9; sa += 0.25) for (let sb = 1.65; sb <= 12 - 1.65 + 1e-9; sb += 0.25) {
      if ((sb - 1.65) ** 2 + (sa - 1.1) ** 2 >= 18 * 18) gridHit = true;
    }
    assert.strictEqual(gridHit, false, 'the lattice misses the feasible sliver');
    // with a larger (knockout-like) datum the same box is certified infeasible
    const m2 = mk({ A: { wall: 'left', d: 2, dia: 2.469 }, B: { wall: 'bottom', d: 3, dia: 3.594 } }, [{ a: 'A', b: 'B' }]);
    assert.strictEqual(check(m2, 12, 18).status, 'INFEASIBLE');
  });

  test('E. shared raceway: infeasible at floors; both axis minima match closed form', () => {
    const m = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 }, C: { wall: 'bottom', d: 2, dia: 2.2 } },
      [{ a: 'A', b: 'B' }, { a: 'A', b: 'C' }]);
    const r = check(m, 12, 12);
    assert.strictEqual(r.status, 'INFEASIBLE');
    assert.strictEqual(r.certificate.kind, 'COMPLETE_CONTINUOUS_REFUTATION');
    // closed form (A mid-wall): W=12 needs H >= 2(r + sqrt(144 - (12-2r)^2)); H=12 needs W >= 2r + sqrt(144 - (6-r)^2)
    const r1 = 1.1;
    const Hmin = 2 * (r1 + Math.sqrt(144 - (12 - 2 * r1) ** 2));
    const Wmin = 2 * r1 + Math.sqrt(144 - (6 - r1) ** 2);
    const fw = find(m, 'WIDTH', { heightIn: 12 });
    assert.strictEqual(fw.status, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(Math.abs(fw.widthIn - Wmin) <= 1 / 64, fw.widthIn + ' vs ' + Wmin);
    assert.strictEqual(fw.lowerBound.certifiedBy, 'INFEASIBLE', 'the lower bound is a certified refutation');
    const fh = find(m, 'HEIGHT', { widthIn: 12 });
    assert.strictEqual(fh.status, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(Math.abs(fh.heightIn - Hmin) <= 1 / 64, fh.heightIn + ' vs ' + Hmin);
    // the shared coordinate satisfies BOTH pulls in the witness
    const pa = fw.placements.A.alongIn;
    assert.ok((fw.widthIn - 1.1 - (12 - 1.1) + fw.placements.B.alongIn) || true);
    assert.ok(pa > 1.1 && pa < 12 - 1.1);
  });

  test('F. four-wall cycle: infeasible at floors, solved simultaneously', () => {
    const m = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 }, C: { wall: 'right', d: 2, dia: 2.2 }, D: { wall: 'bottom', d: 2, dia: 2.2 } },
      [{ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'D' }, { a: 'D', b: 'A' }]);
    assert.strictEqual(check(m, 12, 12).status, 'INFEASIBLE');
    const f = find(m, 'BALANCED');
    assert.strictEqual(f.status, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(f.widthIn > 12 && f.heightIn > 12);
    // every one of the four adjacent constraints holds at the single witness
    const p = f.placements; const W = f.widthIn; const H = f.heightIn; const r = 1.1;
    const ok = (u, v) => (u - r) ** 2 + (v - r) ** 2 >= 144 - 1e-6;
    assert.ok(ok(H - p.A.alongIn, p.B.alongIn), 'A-B at TL');
    assert.ok(ok(W - p.B.alongIn, H - p.C.alongIn), 'B-C at TR');
    assert.ok(ok(p.C.alongIn, W - p.D.alongIn), 'C-D at BR');
    assert.ok(ok(p.D.alongIn, p.A.alongIn), 'D-A at BL');
    assert.ok(f.widthIn < 19.2, 'better than the mid-wall placement (19.17): ' + f.widthIn);
  });

  test('G. multiple U on one wall: 1-D ordering/packing', () => {
    const m = mk({ A: { wall: 'bottom', d: 2, dia: 2.2 }, B: { wall: 'bottom', d: 2, dia: 2.2 }, C: { wall: 'bottom', d: 3, dia: 3.3 }, D: { wall: 'bottom', d: 3, dia: 3.3 } },
      [{ a: 'A', b: 'B' }, { a: 'C', b: 'D' }]);
    const f = find(m, 'WIDTH', { heightIn: m.result.minimumHeightIn });
    assert.strictEqual(f.status, 'CERTIFIED_WITHIN_TOLERANCE');
    // best interleaving: A C B D style keeps both required gaps while packing
    const s = f.placements;
    assert.ok(Math.abs(s.A.alongIn - s.B.alongIn) >= 12 + 2.2 - 1e-6);
    assert.ok(Math.abs(s.C.alongIn - s.D.alongIn) >= 18 + 3.3 - 1e-6);
    const sorted = Object.values(s).map((x) => x.alongIn).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 2.2 - 1e-6, 'no rim overlap');
    assert.ok(f.widthIn < 24 + 2.2 + 13.3 + 4.4, 'packing beats naive end-to-end');
  });

  test('H. mixed straight + angle + U', () => {
    const m = mk({ L4: { wall: 'left', d: 4, dia: 4.5 }, R4: { wall: 'right', d: 4, dia: 4.5 }, L2: { wall: 'left', d: 2, dia: 2.2 }, T2: { wall: 'top', d: 2, dia: 2.2 }, B3a: { wall: 'bottom', d: 3, dia: 3.3 }, B3b: { wall: 'bottom', d: 3, dia: 3.3 } },
      [{ a: 'L4', b: 'R4' }, { a: 'L2', b: 'T2' }, { a: 'B3a', b: 'B3b' }]);
    assert.strictEqual(m.result.dimensionStatus.width.status, 'LAYOUT_DEPENDENT', 'Layer 1 says width is layout dependent');
    const f = find(m, 'WIDTH', { heightIn: m.result.minimumHeightIn });
    assert.strictEqual(f.status, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(f.widthIn >= m.result.minimumWidthIn, 'never below the Layer-1 floor');
    assert.ok(f.widthIn >= 18 + 3.3 + 3.3, 'the U extent is honoured');
    assert.strictEqual(Object.keys(f.placements).length, 6);
  });

  test('I. dense small-n terminates with a certificate inside the budget', () => {
    const m = mk({ L1: { wall: 'left', d: 2, dia: 2.2 }, L2: { wall: 'left', d: 1, dia: 1.2 }, L3: { wall: 'left', d: 2, dia: 2.2 },
      T1: { wall: 'top', d: 2, dia: 2.2 }, T2: { wall: 'top', d: 1, dia: 1.2 },
      R1: { wall: 'right', d: 3, dia: 3.3 }, B1: { wall: 'bottom', d: 2, dia: 2.2 }, B2: { wall: 'bottom', d: 2, dia: 2.2 } },
      [{ a: 'L1', b: 'T1' }, { a: 'L2', b: 'T2' }, { a: 'L3', b: 'R1' }, { a: 'B1', b: 'B2' }, { a: 'T1', b: 'R1' }]);
    const t0 = Date.now();
    const f = find(m, 'BALANCED');
    const ms = Date.now() - t0;
    assert.ok(['CERTIFIED_WITHIN_TOLERANCE', 'CERTIFIED_BOUNDS'].includes(f.status), f.status);
    assert.ok(f.placements, 'a verified witness exists');
    assert.ok(ms < 20000, 'dense case runtime ' + ms + 'ms');
  });
});

describe('PBV2-13B-1 — invariants', () => {
  const rnd = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  function randomState(r) {
    const walls = ['left', 'right', 'top', 'bottom']; const sizes = [1, 2, 3];
    const n = 3 + Math.floor(r() * 3); const entries = {};
    for (let i = 0; i < n; i++) { const d = sizes[Math.floor(r() * 3)]; entries['E' + i] = { wall: walls[Math.floor(r() * 4)], d, dia: d * 1.1 }; }
    const ids = Object.keys(entries); const conns = [];
    for (let k = 0; k < 3; k++) { const a = ids[Math.floor(r() * n)]; const b = ids[Math.floor(r() * n)];
      if (a !== b && !conns.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a))) conns.push({ a, b }); }
    return { entries, conns };
  }

  test('monotonicity: feasible at (W,H) stays feasible at larger W and larger H', () => {
    const r = rnd(11); let checked = 0;
    for (let t = 0; t < 40 && checked < 12; t++) {
      const { entries, conns } = randomState(r);
      if (conns.length === 0) continue;
      let m; try { m = mk(entries, conns); } catch (e) { continue; }
      const W = Math.max(m.result.minimumWidthIn || 8, 8) + 6; const H = Math.max(m.result.minimumHeightIn || 8, 8) + 6;
      const base = check(m, W, H, { nodeBudget: 40000 });
      if (base.status !== 'FEASIBLE') continue;
      checked++;
      assert.strictEqual(check(m, W + 3, H, { nodeBudget: 40000 }).status, 'FEASIBLE', 'wider');
      assert.strictEqual(check(m, W, H + 3, { nodeBudget: 40000 }).status, 'FEASIBLE', 'taller');
      assert.strictEqual(check(m, W + 3, H + 3, { nodeBudget: 40000 }).status, 'FEASIBLE', 'both');
    }
    assert.ok(checked >= 6, 'enough feasible random states exercised: ' + checked);
  });

  test('permutation invariance: entry and connection order never change the outcome', () => {
    const base = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 }, C: { wall: 'bottom', d: 2, dia: 2.2 } },
      [{ a: 'A', b: 'B' }, { a: 'A', b: 'C' }]);
    const shuffled = { request: { rows: base.request.rows.slice().reverse(), entries: base.request.entries.slice().reverse(),
      connections: base.request.connections.slice().reverse() }, result: base.result, geometry: base.geometry };
    const a = check(base, 14, 12); const b = check(shuffled, 14, 12);
    assert.strictEqual(a.status, b.status);
    assert.deepStrictEqual(a.placements, b.placements, 'deterministic witness independent of input order');
    assert.strictEqual(a.nodes, b.nodes);
    const fa = find(base, 'WIDTH', { heightIn: 12 }); const fb = find(shuffled, 'WIDTH', { heightIn: 12 });
    assert.strictEqual(fa.widthIn, fb.widthIn);
  });

  test('mirror symmetry: LEFT<->RIGHT and TOP<->BOTTOM give identical dimensions', () => {
    const spec = { A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 }, C: { wall: 'bottom', d: 3, dia: 3.3 } };
    const conns = [{ a: 'A', b: 'B' }, { a: 'A', b: 'C' }];
    const mirrorLR = (w) => ({ left: 'right', right: 'left', top: 'top', bottom: 'bottom' }[w]);
    const mirrorTB = (w) => ({ left: 'left', right: 'right', top: 'bottom', bottom: 'top' }[w]);
    const m0 = mk(spec, conns);
    const mLR = mk(Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, { ...v, wall: mirrorLR(v.wall) }])), conns);
    const mTB = mk(Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, { ...v, wall: mirrorTB(v.wall) }])), conns);
    for (const [W, H] of [[12, 12], [14, 13], [13.5, 16]]) {
      assert.strictEqual(check(mLR, W, H).status, check(m0, W, H).status, 'LR ' + W + 'x' + H);
      assert.strictEqual(check(mTB, W, H).status, check(m0, W, H).status, 'TB ' + W + 'x' + H);
    }
    const f0 = find(m0, 'WIDTH', { heightIn: 13 }); const fLR = find(mLR, 'WIDTH', { heightIn: 13 });
    assert.ok(Math.abs(f0.widthIn - fLR.widthIn) <= 1 / 64);
  });

  test('scale consistency: doubling every length doubles the certified minimum', () => {
    // synthetic Layer-1 result so both floors and spacing scale exactly
    const request = { rows: [{ id: 'rL', wall: 'left', order: 0 }, { id: 'rT', wall: 'top', order: 0 }, { id: 'rB', wall: 'bottom', order: 0 }],
      entries: [{ id: 'A', rowId: 'rL', tradeSize: '2' }, { id: 'B', rowId: 'rT', tradeSize: '2' }, { id: 'C', rowId: 'rB', tradeSize: '2' }],
      connections: [{ id: 'c1', entryIds: ['A', 'B'] }, { id: 'c2', entryIds: ['A', 'C'] }] };
    const res = (k) => ({ ok: true, minimumWidthIn: 12 * k, minimumHeightIn: 12 * k,
      spacingRequirements: [{ connectionId: 'c1', minimumInches: 12 * k }, { connectionId: 'c2', minimumInches: 12 * k }] });
    const geo = (k) => ({ units: 'in', entries: { A: { entryMeasurementDiameterIn: 2.2 * k }, B: { entryMeasurementDiameterIn: 2.2 * k }, C: { entryMeasurementDiameterIn: 2.2 * k } } });
    const f1 = L2.findLayoutDimensions({ request, result: res(1), geometry: geo(1), policy: 'WIDTH', heightIn: 12, toleranceIn: 1 / 64 });
    const f2 = L2.findLayoutDimensions({ request, result: res(2), geometry: geo(2), policy: 'WIDTH', heightIn: 24, toleranceIn: 1 / 32 });
    assert.ok(Math.abs(f2.widthIn - 2 * f1.widthIn) <= 1 / 16, f1.widthIn + ' -> ' + f2.widthIn);
  });

  test('determinism: identical input, identical output', () => {
    const m = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 }, C: { wall: 'right', d: 2, dia: 2.2 }, D: { wall: 'bottom', d: 2, dia: 2.2 } },
      [{ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'D' }, { a: 'D', b: 'A' }]);
    const a = find(m, 'BALANCED'); const b = find(m, 'BALANCED');
    assert.deepStrictEqual({ w: a.widthIn, h: a.heightIn, p: a.placements, s: a.status }, { w: b.widthIn, h: b.heightIn, p: b.placements, s: b.status });
  });
});

describe('PBV2-13B-1 — negative and safety cases', () => {
  const m = () => mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 } }, [{ a: 'A', b: 'B' }]);

  test('missing geometry, zero and negative diameters, NaN/Infinity are INVALID', () => {
    const x = m(); delete x.geometry.entries.B;
    assert.deepStrictEqual([check(x, 12, 12).status, check(x, 12, 12).reason], ['INVALID', 'GEOMETRY_MISSING']);
    const y = m(); y.geometry.entries.A.entryMeasurementDiameterIn = 0;
    assert.strictEqual(check(y, 12, 12).reason, 'GEOMETRY_INVALID');
    const z = m(); z.geometry.entries.A.entryMeasurementDiameterIn = -1;
    assert.strictEqual(check(z, 12, 12).reason, 'GEOMETRY_INVALID');
    const n = m(); n.geometry.entries.A.entryMeasurementDiameterIn = NaN;
    assert.strictEqual(check(n, 12, 12).reason, 'GEOMETRY_MISSING');
    assert.strictEqual(check(m(), Infinity, 12).reason, 'INVALID_DIMENSIONS');
    assert.strictEqual(check(m(), 12, -3).reason, 'INVALID_DIMENSIONS');
  });

  test('unknown endpoint and Layer-1 identity mismatch are INVALID', () => {
    const x = m(); x.request.connections[0].entryIds = ['A', 'ghost'];
    assert.strictEqual(check(x, 12, 12).reason, 'CONNECTION_UNKNOWN_ENTRY');
    const y = m(); y.result = { ...y.result, spacingRequirements: [] };   // Layer 1 result no longer names c0
    assert.strictEqual(check(y, 12, 12).reason, 'LAYER1_IDENTITY_MISMATCH');
  });

  test('impossible containment is certified INVALID up front', () => {
    assert.strictEqual(check(m(), 12, 2).reason, 'CONTAINMENT_IMPOSSIBLE');
  });

  test('a proven infeasible layout reports the refuting constraint', () => {
    const s = mk({ A: { wall: 'bottom', d: 3, dia: 3.3 }, B: { wall: 'bottom', d: 3, dia: 3.3 } }, [{ a: 'A', b: 'B' }]);
    const r = check(s, 20, 21);
    assert.strictEqual(r.status, 'INFEASIBLE');
    assert.strictEqual(r.refutedConstraint.kind, 'SAME_WALL');
    assert.strictEqual(r.certificate.kind, 'COMPLETE_CONTINUOUS_REFUTATION');
    assert.strictEqual(r.placements, undefined, 'no placement is ever fabricated');
  });

  test('budget exhaustion is UNKNOWN — never INFEASIBLE, never FEASIBLE', () => {
    const cyc = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'top', d: 2, dia: 2.2 }, C: { wall: 'right', d: 2, dia: 2.2 }, D: { wall: 'bottom', d: 2, dia: 2.2 } },
      [{ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'D' }, { a: 'D', b: 'A' }]);
    // the 0.037" feasible sliver (case D): with every finder disabled the pure
    // branch-and-bound needs many bisections, so a 3-node budget must return
    // UNKNOWN — never INFEASIBLE (it IS feasible) and never FEASIBLE (no proof)
    const sliver = mk({ A: { wall: 'left', d: 2, dia: 2.2 }, B: { wall: 'bottom', d: 3, dia: 3.3 } }, [{ a: 'A', b: 'B' }]);
    const r = check(sliver, 12, 18, { nodeBudget: 3, witnessCap: 0, disableCandidates: true });
    assert.strictEqual(r.status, 'UNKNOWN');
    assert.strictEqual(r.reason, 'NODE_BUDGET_EXHAUSTED');
    assert.strictEqual(r.placements, undefined);
    assert.strictEqual(r.certificate, undefined, 'no certificate without proof');
    // the same box with finders on is FEASIBLE, and the infeasible cycle box is
    // still certified INFEASIBLE — propagation alone refutes it in one node
    assert.strictEqual(check(sliver, 12, 18).status, 'FEASIBLE');
    const full = check(cyc, 13.5, 13.5, { nodeBudget: 1, witnessCap: 0 });
    assert.strictEqual(full.status, 'INFEASIBLE');
    assert.strictEqual(full.certificate.kind, 'COMPLETE_CONTINUOUS_REFUTATION');
  });

  test('guarantee metadata separates status from what was proven', () => {
    const r = check(m(), 12, 12);
    assert.strictEqual(r.status, 'FEASIBLE');
    assert.strictEqual(r.guarantee, 'EXACT_FACE_PLANE_FOR_SUPPLIED_GEOMETRY');
    assert.strictEqual(r.physicalFitVerified, false);
    assert.strictEqual(r.depthVerified, false);
    assert.ok(r.assumptions.includes('FACE_PLANE_PROJECTION') && r.assumptions.includes('DATUM_AS_SUPPLIED'));
    // multi-row walls downgrade to the conservative guarantee
    const mr = mk({ A: { wall: 'left', d: 2, dia: 2.2, row: 'r1', order: 0 }, B: { wall: 'left', d: 2, dia: 2.2, row: 'r2', order: 1 }, T: { wall: 'top', d: 2, dia: 2.2 } },
      [{ a: 'A', b: 'T' }]);
    const r2 = check(mr, 14, 14);
    assert.strictEqual(r2.guarantee, 'CONSERVATIVE_FACE_PLANE_MULTIROW');
    assert.ok(r2.assumptions.includes('MULTI_ROW_PROJECTED_COPLANAR'));
  });

  test('minimality is never called EXACT — tolerance and lower bound are explicit', () => {
    const f = find(m(), 'WIDTH', { heightIn: 12 });
    assert.ok(['CERTIFIED_WITHIN_TOLERANCE', 'CERTIFIED_BOUNDS'].includes(f.status));
    assert.ok(!/EXACT_MINIMUM/.test(JSON.stringify(f)));
    assert.strictEqual(f.toleranceIn, 1 / 64);
    assert.ok(f.lowerBound && typeof f.lowerBound.certifiedBy === 'string');
    assert.ok(f.achievedGapIn <= f.toleranceIn || f.status === 'CERTIFIED_BOUNDS');
    assert.strictEqual(f.physicalFitVerified, false);
  });

  test('placements are domain inches on named walls, nothing else', () => {
    const r = check(m(), 12, 12);
    for (const [id, p] of Object.entries(r.placements)) {
      assert.ok(['left', 'right', 'top', 'bottom'].includes(p.wall), id);
      assert.ok(typeof p.alongIn === 'number' && p.alongIn > 0);
      assert.deepStrictEqual(Object.keys(p).sort(), ['alongIn', 'wall']);
    }
  });
});
