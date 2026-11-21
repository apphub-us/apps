'use strict';
/**
 * Empire Code — Pull Box LAYOUT solver (Layer 2).  PBV2-13B-1.
 *
 * Proves whether the NEC 314.28(A)(2) spacing requirements that Layer 1
 * (src/calc/pullBox.js) reports can be satisfied SIMULTANEOUSLY by a concrete
 * placement of raceway entries on the walls of a W x H box, and searches for
 * certified dimensions.
 *
 * WHAT THIS MODULE IS NOT
 *   - It never recalculates any NEC rule. The 8x / 6x / row-sum arithmetic
 *     and the spacing scalars come exclusively from the Layer-1 result.
 *   - It knows nothing about SVG, pixels, visualPosition, CSS or the UI.
 *   - It carries no standards data: every entry's code-measurement diameter
 *     is supplied explicitly (Layer 0 will resolve it later).
 *   - It does not model depth, fittings or commercial sizes.
 *
 * DOMAIN FRAME (inches)
 *   Face plane of the box: x -> WIDTH (0 at the LEFT wall), y -> HEIGHT
 *   (0 at the BOTTOM wall). Each entry has one along-wall coordinate s:
 *   x for TOP/BOTTOM entries, y for LEFT/RIGHT entries. Every entry is a
 *   circular code-measurement boundary of radius r in its wall plane.
 *
 * GEOMETRY (PBV2-13A.2, exact in the face plane)
 *   same wall, connected:   |sA - sB| >= S + rA + rB
 *   same wall, any pair:    |sA - sB| >= rA + rB        (no overlap)
 *   adjacent walls:         (u - rU)^2 + (v - rV)^2 >= S^2
 *       u, v = distances of the two centres from the SHARED corner, measured
 *       along their own walls (corner transform per wall pair).
 *   containment:            r <= s <= L - r
 *   Face-plane distance is a lower bound on true 3-D distance, so a proof
 *   here is SAFE; it is EXACT when every wall holds a single row.
 *
 * CERTIFICATION
 *   All arithmetic is exact rational (BigInt). Feasibility is proved by an
 *   explicit witness re-verified constraint by constraint. Infeasibility is
 *   proved by interval branch-and-bound that refutes the ENTIRE continuous
 *   domain: a branch is discarded only when some constraint is impossible
 *   throughout it. Anything else is UNKNOWN — never INFEASIBLE.
 */

// ── exact rational arithmetic ───────────────────────────────────────────
function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { [a, b] = [b, a % b]; } return a; }
class Q {
  constructor(n, d) {
    if (d === 0n) throw new Error('Q: zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g; this.d = d / g;
  }
  static int(i) { return new Q(BigInt(i), 1n); }
  /** Exact decimal parse of a finite JS number (via its shortest string). */
  static from(x) {
    if (x instanceof Q) return x;
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('non-finite number');
    const s = String(x);
    const m = s.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
    if (!m) throw new Error('unparseable number: ' + s);
    const sign = m[1] === '-' ? -1n : 1n;
    const intPart = m[2]; const frac = m[3] || ''; const exp = parseInt(m[4] || '0', 10);
    let n = BigInt(intPart + frac); let d = 10n ** BigInt(frac.length);
    if (exp > 0) n *= 10n ** BigInt(exp); else if (exp < 0) d *= 10n ** BigInt(-exp);
    return new Q(sign * n, d);
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  half() { return new Q(this.n, this.d * 2n); }
  cmp(o) { const l = this.n * o.d; const r = o.n * this.d; return l < r ? -1 : (l > r ? 1 : 0); }
  lt(o) { return this.cmp(o) < 0; } le(o) { return this.cmp(o) <= 0; }
  gt(o) { return this.cmp(o) > 0; } ge(o) { return this.cmp(o) >= 0; }
  isNeg() { return this.n < 0n; }
  sq() { return this.mul(this); }
  toNumber() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? this.n.toString() : this.n + '/' + this.d; }
  static max(a, b) { return a.ge(b) ? a : b; }
  static min(a, b) { return a.le(b) ? a : b; }
}
const ZERO = Q.int(0);
/** Rational LOWER bound of sqrt(q) for q >= 0 (BigInt integer sqrt, floor). */
function sqrtLower(q) {
  if (!q.gt(ZERO)) return ZERO;
  const SCALE = 1n << 40n;                       // fixed scale for the root
  const v = (q.n * SCALE * SCALE) / q.d;         // floor((n/d)·SCALE²)
  let x = BigInt(Math.floor(Math.sqrt(Number(v)))); // seed, then correct exactly
  while (x * x > v) x -= 1n;
  while ((x + 1n) * (x + 1n) <= v) x += 1n;
  return new Q(x, SCALE);                        // floor(sqrt) ≤ true root
}

const WALLS = ['left', 'right', 'top', 'bottom'];
const HORIZONTAL = { top: true, bottom: true };   // s = x
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const DEFAULT_BUDGET = 20000;
const MIN_WIDTH = new Q(1n, 4096n);   // branch width below which an undecided box is UNKNOWN

// ── input normalisation ─────────────────────────────────────────────────
function fail(code, detail) { const e = new Error(code); e.code = code; e.detail = detail; return e; }

/**
 * Build the constraint model from the canonical Layer-1 request, the Layer-1
 * result, explicit geometry and the candidate W x H. Throws on invalid input.
 */
function buildModel(input) {
  const { request, result, geometry } = input;
  if (!request || !Array.isArray(request.entries) || !Array.isArray(request.rows)) throw fail('MALFORMED_REQUEST');
  if (!result || result.ok !== true) throw fail('LAYER1_RESULT_NOT_OK', result && result.reason);
  if (!geometry || geometry.units !== 'in' || !geometry.entries) throw fail('MALFORMED_GEOMETRY');
  const W = Q.from(input.widthIn); const H = Q.from(input.heightIn);
  if (!W.gt(ZERO) || !H.gt(ZERO)) throw fail('INVALID_DIMENSIONS');

  const rowWall = {}; for (const r of request.rows) rowWall[r.id] = r.wall;
  const vars = []; const index = {};
  const sorted = request.entries.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of sorted) {
    const wall = rowWall[e.rowId];
    if (!WALLS.includes(wall)) throw fail('ENTRY_WALL_UNKNOWN', e.id);
    const g = geometry.entries[e.id];
    if (!g || typeof g.entryMeasurementDiameterIn !== 'number') throw fail('GEOMETRY_MISSING', e.id);
    if (!Number.isFinite(g.entryMeasurementDiameterIn) || g.entryMeasurementDiameterIn <= 0) throw fail('GEOMETRY_INVALID', e.id);
    const r = Q.from(g.entryMeasurementDiameterIn).half();
    const L = HORIZONTAL[wall] ? W : H;
    if (L.sub(r).lt(r)) throw fail('CONTAINMENT_IMPOSSIBLE', e.id);
    index[e.id] = vars.length;
    vars.push({ id: e.id, wall, rowId: e.rowId, r, L });
  }
  // guarantee: exact only when no wall carries more than one row
  const rowsPerWall = {};
  for (const v of vars) { (rowsPerWall[v.wall] = rowsPerWall[v.wall] || new Set()).add(v.rowId); }
  const multiRow = Object.values(rowsPerWall).some((s) => s.size > 1);

  const same = []; const adjacent = [];
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      if (vars[i].wall === vars[j].wall) same.push({ i, j, c: vars[i].r.add(vars[j].r), kind: 'NO_OVERLAP', id: 'overlap:' + vars[i].id + ':' + vars[j].id });
    }
  }
  const spacing = (result.spacingRequirements || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const sp of spacing) {
    const [a, b] = sp.entryIds;
    if (!(a in index) || !(b in index)) throw fail('LAYER1_IDENTITY_MISMATCH', sp.id);
    const i = index[a]; const j = index[b]; const S = Q.from(sp.minimumInches);
    const va = vars[i]; const vb = vars[j];
    if (va.wall === vb.wall) {
      same.push({ i, j, c: S.add(va.r).add(vb.r), kind: 'SAME_WALL_SPACING', id: sp.id });
    } else if (OPPOSITE[va.wall] === vb.wall) {
      throw fail('LAYER1_IDENTITY_MISMATCH', sp.id + ':opposite-walls');
    } else {
      // adjacent: h = horizontal-wall entry (u along x), v = vertical-wall entry (v along y)
      const h = HORIZONTAL[va.wall] ? i : j; const vv = HORIZONTAL[va.wall] ? j : i;
      adjacent.push({
        h, v: vv, S2: S.sq(), id: sp.id,
        uFromRight: vars[vv].wall === 'right',   // u = W - s_h when the vertical wall is RIGHT
        vFromTop: vars[h].wall === 'top',         // v = H - s_v when the horizontal wall is TOP
      });
    }
  }
  return { W, H, vars, index, same, adjacent, multiRow, floors: {
    width: result.minimumWidthIn === null ? null : Q.from(result.minimumWidthIn),
    height: result.minimumHeightIn === null ? null : Q.from(result.minimumHeightIn) } };
}

// ── interval evaluation (sound over the whole box) ─────────────────────
function cornerIntervals(m, adj, box) {
  const hI = box[adj.h]; const vI = box[adj.v];
  const U = adj.uFromRight ? [m.W.sub(hI[1]), m.W.sub(hI[0])] : [hI[0], hI[1]];
  const V = adj.vFromTop ? [m.H.sub(vI[1]), m.H.sub(vI[0])] : [vI[0], vI[1]];
  return { U, V };
}
const clamp0 = (q) => (q.isNeg() ? ZERO : q);
/** returns 1 = satisfied everywhere, -1 = refuted everywhere, 0 = undecided */
function evalSame(c, box) {
  const [alo, ahi] = box[c.i]; const [blo, bhi] = box[c.j];
  const maxAbs = Q.max(ahi.sub(blo), bhi.sub(alo));
  if (maxAbs.lt(c.c)) return -1;
  const minAbs = clamp0(Q.max(alo.sub(bhi), blo.sub(ahi)));
  return minAbs.ge(c.c) ? 1 : 0;
}
function evalAdj(m, adj, box) {
  const { U, V } = cornerIntervals(m, adj, box);
  const ru = m.vars[adj.h].r; const rv = m.vars[adj.v].r;
  const maxVal = clamp0(U[1].sub(ru)).sq().add(clamp0(V[1].sub(rv)).sq());
  if (maxVal.lt(adj.S2)) return -1;
  const minVal = clamp0(U[0].sub(ru)).sq().add(clamp0(V[0].sub(rv)).sq());
  return minVal.ge(adj.S2) ? 1 : 0;
}

// ── exact witness verification (independent of the search) ─────────────
function verifyPoint(m, point) {
  const violated = [];
  for (let i = 0; i < m.vars.length; i++) {
    const v = m.vars[i]; const s = point[i];
    if (s.lt(v.r) || s.gt(v.L.sub(v.r))) violated.push('containment:' + v.id);
  }
  for (const c of m.same) {
    const d = point[c.i].sub(point[c.j]); const abs = d.isNeg() ? d.mul(Q.int(-1)) : d;
    if (abs.lt(c.c)) violated.push(c.id);
  }
  for (const adj of m.adjacent) {
    const box = point.map((s) => [s, s]);
    const { U, V } = cornerIntervals(m, adj, box);
    const val = clamp0(U[0].sub(m.vars[adj.h].r)).sq().add(clamp0(V[0].sub(m.vars[adj.v].r)).sq());
    if (val.lt(adj.S2)) violated.push(adj.id);
  }
  return violated;
}

// ── branch-and-bound feasibility kernel ────────────────────────────────
function solveFeasibility(m, budget) {
  const root = m.vars.map((v) => [v.r, v.L.sub(v.r)]);
  const stack = [root];
  let nodes = 0; let refuted = 0; let unresolved = 0;
  const stats = { orderingBranches: 0, bisections: 0, propagationRefutations: 0 };
  const midpoint = (box) => box.map(([lo, hi]) => lo.add(hi).half());
  while (stack.length) {
    if (nodes >= budget) return { status: 'UNKNOWN', reason: 'BUDGET_EXHAUSTED', nodes, refuted, unresolved, stats };
    const box = stack.pop(); nodes++;
    // 1. refutation / decision
    let undecidedSame = null; let undecidedAdj = null; let dead = false;
    for (const c of m.same) { const s = evalSame(c, box); if (s < 0) { dead = true; break; } if (s === 0 && !undecidedSame) undecidedSame = c; }
    if (!dead) for (const a of m.adjacent) { const s = evalAdj(m, a, box); if (s < 0) { dead = true; break; } if (s === 0 && !undecidedAdj) undecidedAdj = a; }
    if (dead) { refuted++; continue; }
    // 1b. sound propagation for adjacent pairs: (u-ru)^2 >= S^2 - max(v-rv)^2 etc.
    //     A lower bound on sqrt keeps every feasible point inside the tightened box.
    for (const adj of m.adjacent) {
      const { U, V } = cornerIntervals(m, adj, box);
      const ru = m.vars[adj.h].r; const rv = m.vars[adj.v].r;
      const needU = adj.S2.sub(clamp0(V[1].sub(rv)).sq());
      const needV = adj.S2.sub(clamp0(U[1].sub(ru)).sq());
      if (needU.gt(ZERO)) {
        const ulb = ru.add(sqrtLower(needU));
        if (adj.uFromRight) box[adj.h][1] = Q.min(box[adj.h][1], m.W.sub(ulb));
        else box[adj.h][0] = Q.max(box[adj.h][0], ulb);
      }
      if (needV.gt(ZERO)) {
        const vlb = rv.add(sqrtLower(needV));
        if (adj.vFromTop) box[adj.v][1] = Q.min(box[adj.v][1], m.H.sub(vlb));
        else box[adj.v][0] = Q.max(box[adj.v][0], vlb);
      }
    }
    if (box.some(([lo, hi]) => lo.gt(hi))) { refuted++; stats.propagationRefutations++; continue; }
    // 2. witness attempts (exact re-verification): midpoint, then a candidate that
    //    pushes every variable away from the corners its adjacent constraints share
    const cand = midpoint(box);
    if (verifyPoint(m, cand).length === 0) return { status: 'FEASIBLE', witness: cand, nodes, refuted, unresolved, stats };
    if (m.adjacent.length) {
      const votes = new Array(m.vars.length).fill(0);
      for (const adj of m.adjacent) { votes[adj.h] += adj.uFromRight ? -1 : 1; votes[adj.v] += adj.vFromTop ? -1 : 1; }
      const spread = box.map(([lo, hi], k) => (votes[k] > 0 ? hi : (votes[k] < 0 ? lo : lo.add(hi).half())));
      if (verifyPoint(m, spread).length === 0) return { status: 'FEASIBLE', witness: spread, nodes, refuted, unresolved, stats };
    }
    if (!undecidedSame && !undecidedAdj) {
      // every constraint holds everywhere in the box, yet the midpoint failed:
      // impossible by construction, treat defensively as unknown
      unresolved++; continue;
    }
    // 3. branch
    if (undecidedSame) {
      const { i, j, c } = undecidedSame;
      // ordering A: s_i <= s_j - c ; ordering B: s_j <= s_i - c (covers every feasible point)
      for (const [lo, hi] of [[i, j], [j, i]]) {
        const child = box.map((iv) => iv.slice());
        child[lo][1] = Q.min(child[lo][1], child[hi][1].sub(c));
        child[hi][0] = Q.max(child[hi][0], child[lo][0].add(c));
        if (child[lo][0].le(child[lo][1]) && child[hi][0].le(child[hi][1])) stack.push(child);
      }
      stats.orderingBranches++;
      continue;
    }
    // adjacent undecided: bisect the wider of its two variables
    const { h, v } = undecidedAdj;
    const wh = box[h][1].sub(box[h][0]); const wv = box[v][1].sub(box[v][0]);
    const k = wh.ge(wv) ? h : v;
    const width = wh.ge(wv) ? wh : wv;
    if (width.lt(MIN_WIDTH)) { unresolved++; continue; }   // boundary-thin box: cannot decide
    stats.bisections++;
    const mid = box[k][0].add(box[k][1]).half();
    const lowHalf = box.map((iv) => iv.slice()); lowHalf[k][1] = mid;
    const highHalf = box.map((iv) => iv.slice()); highHalf[k][0] = mid;
    // the half that moves this variable AWAY from the shared corner is more
    // likely feasible: explore it first (stack is LIFO). Certification is
    // unaffected — both halves are always explored before any refutation.
    const awayIsHigh = (k === h) ? !undecidedAdj.uFromRight : !undecidedAdj.vFromTop;
    if (awayIsHigh) { stack.push(lowHalf); stack.push(highHalf); } else { stack.push(highHalf); stack.push(lowHalf); }
  }
  if (unresolved > 0) return { status: 'UNKNOWN', reason: 'UNRESOLVED_BRANCHES', nodes, refuted, unresolved, stats };
  return { status: 'INFEASIBLE', nodes, refuted, unresolved, stats };
}

// ── public API ──────────────────────────────────────────────────────────
/**
 * checkLayout: certified feasibility of ALL spacing constraints at W x H.
 */
function checkLayout(input) {
  const m = buildModel(input);
  const budget = input.budget || DEFAULT_BUDGET;
  const guarantee = m.multiRow ? 'CONSERVATIVE_FACE_PLANE' : 'EXACT_DATUM_FACE_PLANE';
  const warnings = m.multiRow ? ['MULTI_ROW_PROJECTED'] : [];
  const base = { widthIn: m.W.toNumber(), heightIn: m.H.toNumber(), guarantee, warnings, placements: null };
  // Layer-1 rule floors are hard lower bounds: below them nothing can be feasible
  const violated = [];
  if (m.floors.width && m.W.lt(m.floors.width)) violated.push('RULE_FLOOR_WIDTH');
  if (m.floors.height && m.H.lt(m.floors.height)) violated.push('RULE_FLOOR_HEIGHT');
  if (violated.length) return { ...base, status: 'INFEASIBLE', certificate: { kind: 'RULE_FLOOR', violated, nodes: 0 } };
  const r = solveFeasibility(m, budget);
  if (r.status === 'FEASIBLE') {
    const check = verifyPoint(m, r.witness);
    if (check.length) return { ...base, status: 'UNKNOWN', certificate: { kind: 'NONE', reason: 'WITNESS_REVERIFY_FAILED', nodes: r.nodes } };
    const placements = {};
    m.vars.forEach((v, i) => { placements[v.id] = { wall: v.wall, alongIn: r.witness[i].toNumber(), alongInExact: r.witness[i].toString() }; });
    return { ...base, status: 'FEASIBLE', placements, certificate: { kind: 'WITNESS', verified: true, nodes: r.nodes, refutedBranches: r.refuted } };
  }
  if (r.status === 'INFEASIBLE') return { ...base, status: 'INFEASIBLE', certificate: { kind: 'REFUTATION', nodes: r.nodes, refutedBranches: r.refuted, continuousDomain: true } };
  return { ...base, status: 'UNKNOWN', certificate: { kind: 'NONE', reason: r.reason, nodes: r.nodes, unresolvedBranches: r.unresolved } };
}

/**
 * findLayoutDimensions: thin certified dimension search on top of checkLayout.
 *   policy 'MIN_WIDTH'  — heightIn fixed (supplied), minimise width
 *   policy 'MIN_HEIGHT' — widthIn fixed (supplied), minimise height
 *   policy 'BALANCED'   — scale both Layer-1 floors by a common factor t >= 1
 * Result semantics: CERTIFIED_WITHIN_TOLERANCE means the returned box has a
 * verified witness AND the box `toleranceIn` smaller along the policy axis is
 * certified infeasible (or is the Layer-1 floor, a rule-certified bound).
 */
function findLayoutDimensions(input) {
  const { policy } = input;
  const tol = Q.from(input.toleranceIn === undefined ? 1 / 64 : input.toleranceIn);
  const floorW = input.result.minimumWidthIn; const floorH = input.result.minimumHeightIn;
  let checks = 0;
  const run = (w, h) => { checks++; return checkLayout({ ...input, widthIn: w.toNumber(), heightIn: h.toNumber() }); };
  // parameterise the search axis
  let at; let lo;
  if (policy === 'MIN_WIDTH') {
    if (typeof input.heightIn !== 'number') throw fail('POLICY_NEEDS_HEIGHT');
    const H = Q.from(input.heightIn); lo = Q.from(floorW === null ? input.startWidthIn || 1 : floorW);
    at = (t) => [t, H];
  } else if (policy === 'MIN_HEIGHT') {
    if (typeof input.widthIn !== 'number') throw fail('POLICY_NEEDS_WIDTH');
    const W = Q.from(input.widthIn); lo = Q.from(floorH === null ? input.startHeightIn || 1 : floorH);
    at = (t) => [W, t];
  } else if (policy === 'BALANCED') {
    if (floorW === null || floorH === null) throw fail('POLICY_NEEDS_BOTH_FLOORS');
    const W0 = Q.from(floorW); const H0 = Q.from(floorH); lo = Q.int(1);
    at = (t) => [W0.mul(t), H0.mul(t)];
  } else throw fail('UNKNOWN_POLICY', policy);

  // 1. the lower end: rule floor (or scale 1). Feasible there => minimal by Layer-1 certification.
  let r = run(...at(lo));
  if (r.status === 'FEASIBLE') return { status: 'CERTIFIED_WITHIN_TOLERANCE', policy, ...pick(r), lowerBound: { kind: 'RULE_FLOOR' }, toleranceIn: tol.toNumber(), checks };
  if (r.status === 'UNKNOWN') return { status: 'UNKNOWN', policy, widthIn: null, heightIn: null, placements: null, toleranceIn: tol.toNumber(), checks, reason: 'UNKNOWN_AT_FLOOR' };
  // 2. find a feasible upper end by doubling steps
  let step = policy === 'BALANCED' ? new Q(1n, 8n) : Q.int(1); let hi = lo; let hiRes = null;
  for (let k = 0; k < 24; k++) {
    hi = hi.add(step); step = step.add(step);
    const rr = run(...at(hi));
    if (rr.status === 'FEASIBLE') { hiRes = rr; break; }
    if (rr.status === 'UNKNOWN') return { status: 'UNKNOWN', policy, widthIn: null, heightIn: null, placements: null, toleranceIn: tol.toNumber(), checks, reason: 'UNKNOWN_DURING_EXPANSION' };
    lo = hi;
  }
  if (!hiRes) return { status: 'INFEASIBLE_WITHIN_SEARCH', policy, widthIn: null, heightIn: null, placements: null, toleranceIn: tol.toNumber(), checks };
  // 3. bisect; lo is always certified INFEASIBLE, hi always FEASIBLE with witness
  const scale = policy === 'BALANCED' ? Q.from(Math.min(floorW, floorH)) : Q.int(1);
  while (hi.sub(lo).mul(scale).gt(tol)) {
    const mid = lo.add(hi).half();
    const rr = run(...at(mid));
    if (rr.status === 'FEASIBLE') { hi = mid; hiRes = rr; } else if (rr.status === 'INFEASIBLE') { lo = mid; } else {
      return { status: 'FEASIBLE_UNCERTIFIED_BOUND', policy, ...pick(hiRes), lowerBound: null, toleranceIn: tol.toNumber(), checks, reason: 'UNKNOWN_DURING_BISECTION' };
    }
  }
  const [lw, lh] = at(lo);
  return { status: 'CERTIFIED_WITHIN_TOLERANCE', policy, ...pick(hiRes),
    lowerBound: { kind: 'REFUTATION', widthIn: lw.toNumber(), heightIn: lh.toNumber() }, toleranceIn: tol.toNumber(), checks };
}
function pick(r) { return { widthIn: r.widthIn, heightIn: r.heightIn, placements: r.placements, guarantee: r.guarantee, warnings: r.warnings, certificate: r.certificate }; }

module.exports = { checkLayout, findLayoutDimensions, Q, _internal: { buildModel, verifyPoint, solveFeasibility } };
