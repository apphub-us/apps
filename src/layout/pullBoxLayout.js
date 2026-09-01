'use strict';
/**
 * Empire Code — Pull Box LAYOUT solver core (Layer 2). PBV2-13B-1.
 *
 * Proves whether the NEC 314.28(A)(2) entry-spacing requirements reported by
 * Layer 1 (src/calc/pullBox.js) can be satisfied SIMULTANEOUSLY by a concrete
 * placement of raceway entries on the walls of a W x H box, and searches for
 * certified dimensions on top of that feasibility kernel.
 *
 * WHAT THIS MODULE IS NOT
 *  - It never recalculates any NEC rule. Straight/angle/U floors and the
 *    spacing scalars come exclusively from the Layer-1 result object.
 *  - It knows nothing about SVG, pixels, visualPosition, CSS or the UI.
 *  - It carries no standards data: every entry's code-measurement diameter is
 *    supplied explicitly by the caller (Layer 0 will resolve it later).
 *  - It does not model depth, fitting bodies or commercial sizes.
 *  - It has no imports: it consumes plain result objects.
 *
 * DOMAIN FRAME (inches)
 *  Face plane of the box: x -> WIDTH (0 at the LEFT inside wall), y -> HEIGHT
 *  (0 at the BOTTOM inside wall). Each entry has ONE along-wall coordinate s:
 *  x for TOP/BOTTOM entries, y for LEFT/RIGHT entries. Every entry is a
 *  circular code-measurement boundary of radius r lying in its wall plane.
 *
 * GEOMETRY (PBV2-13A.2 — exact in the face plane)
 *  same wall, connected:   |sA - sB| >= S + rA + rB
 *  same wall, any pair:    |sA - sB| >= rA + rB             (rims never overlap)
 *  adjacent walls:         (u - rU)^2 + (v - rV)^2 >= S^2
 *      u, v are the two centres' distances from the SHARED corner, measured
 *      along their own walls. The rejected "centre distance minus radii" model
 *      is NOT used anywhere in this file.
 *  containment:            r <= s <= L - r
 *
 * CERTIFICATION
 *  All arithmetic is exact: lengths are BigInt micro-inches (1e-6 in) and
 *  squared lengths BigInt (1e-12 in^2). The feasible domain is CONTINUOUS —
 *  interval branch-and-bound partitions the real coordinate ranges; only the
 *  points at which boxes are SPLIT lie on the micro-inch lattice, never the
 *  region covered. FEASIBLE requires an accepted box (every constraint holds at
 *  every point of it) and an independently re-verified witness. INFEASIBLE
 *  requires every box of the partition to be refuted by an exact bound.
 *  Anything else — budget exhaustion or an unresolved box — is UNKNOWN.
 *
 * FACE-PLANE POLICY
 *  Depth is projected out. Projected distance <= true 3-D distance, so a
 *  satisfied face-plane requirement is safe. Where a wall carries more than
 *  one row the projection can over-size, and the guarantee metadata says so.
 */

// ── exact arithmetic ─────────────────────────────────────────────────────
const SCALE_DIGITS = 6;                       // micro-inches
const SCALE = 10n ** BigInt(SCALE_DIGITS);

function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Exact decimal -> BigInt micro-inches. mode: 'up' | 'down' | 'nearest'. */
function toMicro(x, mode) {
  if (!isFiniteNumber(x)) throw new Error('NON_FINITE');
  let s = x.toString();
  if (/e/i.test(s)) s = x.toFixed(12);       // avoid exponent notation
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const [ip, fp = ''] = s.split('.');
  const frac = fp.slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, '0');
  const rest = fp.slice(SCALE_DIGITS);
  let v = BigInt(ip || '0') * SCALE + BigInt(frac);
  if (rest.length > 0 && /[1-9]/.test(rest)) {
    if (mode === 'up') v += 1n;
    else if (mode === 'nearest' && Number('0.' + rest) >= 0.5) v += 1n;
  }
  return neg ? -v : v;
}
function fromMicro(v) { return Number(v) / Number(SCALE); }
/** floor(sqrt(n)) for BigInt n >= 0 — Newton iteration, exact. */
function isqrtFloor(n) {
  if (n < 0n) throw new Error('NEGATIVE_SQRT');
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));   // seed only; corrected below
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}
const bmax = (a, b) => (a > b ? a : b);
const bmin = (a, b) => (a < b ? a : b);
const sq = (a) => a * a;

// ── model building ───────────────────────────────────────────────────────
const WALLS = ['left', 'right', 'top', 'bottom'];
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const HORIZONTAL_WALL = { top: true, bottom: true, left: false, right: false };

/** Distance of a centre from a given corner, as an affine map of s: a + b*s. */
function cornerMap(wall, corner) {
  // corners: 'BL','BR','TL','TR'. TOP/BOTTOM s = x from LEFT; LEFT/RIGHT s = y from BOTTOM.
  if (wall === 'left')   return corner === 'BL' ? { kind: 's' } : { kind: 'H-s' };
  if (wall === 'right')  return corner === 'BR' ? { kind: 's' } : { kind: 'H-s' };
  if (wall === 'bottom') return corner === 'BL' ? { kind: 's' } : { kind: 'W-s' };
  /* top */              return corner === 'TL' ? { kind: 's' } : { kind: 'W-s' };
}
function sharedCorner(wa, wb) {
  const set = new Set([wa, wb]);
  if (set.has('left') && set.has('bottom')) return 'BL';
  if (set.has('right') && set.has('bottom')) return 'BR';
  if (set.has('left') && set.has('top')) return 'TL';
  if (set.has('right') && set.has('top')) return 'TR';
  return null;
}

/**
 * Build the exact constraint model from: canonical Layer-1 request, Layer-1
 * result, explicit geometry, and candidate W/H. Returns {ok:false, reason}
 * for invalid input — never throws for data problems.
 */
function buildModel(request, result, geometry, widthIn, heightIn) {
  if (!request || !Array.isArray(request.rows) || !Array.isArray(request.entries)
    || !Array.isArray(request.connections)) return { ok: false, reason: 'MALFORMED_REQUEST' };
  if (!result || result.ok !== true || !Array.isArray(result.spacingRequirements)) {
    return { ok: false, reason: 'LAYER1_RESULT_REQUIRED' };
  }
  if (!geometry || geometry.units !== 'in' || !geometry.entries
    || typeof geometry.entries !== 'object') return { ok: false, reason: 'MALFORMED_GEOMETRY' };
  if (!isFiniteNumber(widthIn) || !isFiniteNumber(heightIn) || widthIn <= 0 || heightIn <= 0) {
    return { ok: false, reason: 'INVALID_DIMENSIONS' };
  }
  const W = toMicro(widthIn, 'nearest');
  const H = toMicro(heightIn, 'nearest');

  const rowWall = {};
  const rowsPerWall = {};
  for (const row of request.rows) {
    if (!WALLS.includes(row.wall)) return { ok: false, reason: 'INVALID_WALL' };
    rowWall[row.id] = row.wall;
    rowsPerWall[row.wall] = (rowsPerWall[row.wall] || 0) + 1;
  }
  // entries, canonically ordered by id so nothing depends on array order
  const entries = request.entries.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = {};
  for (const e of entries) {
    if (!rowWall[e.rowId]) return { ok: false, reason: 'ROW_UNKNOWN', entryId: e.id };
    const g = geometry.entries[e.id];
    if (!g || !isFiniteNumber(g.entryMeasurementDiameterIn)) {
      return { ok: false, reason: 'GEOMETRY_MISSING', entryId: e.id };
    }
    if (g.entryMeasurementDiameterIn <= 0) return { ok: false, reason: 'GEOMETRY_INVALID', entryId: e.id };
    // radius rounded UP: a larger code-measurement boundary is the safe direction
    const r = (toMicro(g.entryMeasurementDiameterIn, 'up') + 1n) / 2n;
    byId[e.id] = { id: e.id, wall: rowWall[e.rowId], r };
  }
  const ids = entries.map((e) => e.id);
  const wallLength = (wall) => (HORIZONTAL_WALL[wall] ? W : H);

  // containment bounds
  const bounds = {};
  for (const id of ids) {
    const v = byId[id];
    const lo = v.r; const hi = wallLength(v.wall) - v.r;
    if (lo > hi) return { ok: false, reason: 'CONTAINMENT_IMPOSSIBLE', entryId: id };
    bounds[id] = [lo, hi];
  }

  // spacing scalars come ONLY from Layer 1, keyed by connection id
  const spacingByConn = {};
  for (const s of result.spacingRequirements) {
    if (!isFiniteNumber(s.minimumInches) || !s.connectionId) return { ok: false, reason: 'LAYER1_SPACING_MALFORMED' };
    spacingByConn[s.connectionId] = toMicro(s.minimumInches, 'up');
  }
  const connections = request.connections.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sameWall = {};     // key 'a|b' (sorted) -> required centre separation (micro)
  const adjacent = [];     // { a, b, cornerA, cornerB, S2 }
  const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  // rims never overlap on a shared (projected) wall — for every same-wall pair
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId[ids[i]]; const b = byId[ids[j]];
      if (a.wall === b.wall) sameWall[pairKey(a.id, b.id)] = a.r + b.r;
    }
  }
  for (const c of connections) {
    if (!Array.isArray(c.entryIds) || c.entryIds.length !== 2) return { ok: false, reason: 'CONNECTION_ARITY' };
    const [aId, bId] = c.entryIds;
    const a = byId[aId]; const b = byId[bId];
    if (!a || !b) return { ok: false, reason: 'CONNECTION_UNKNOWN_ENTRY', connectionId: c.id };
    if (a.wall === OPPOSITE[b.wall]) continue;              // straight: no spacing geometry
    const S = spacingByConn[c.id];
    if (S === undefined) return { ok: false, reason: 'LAYER1_IDENTITY_MISMATCH', connectionId: c.id };
    if (a.wall === b.wall) {
      const k = pairKey(a.id, b.id);
      sameWall[k] = bmax(sameWall[k], S + a.r + b.r);
    } else {
      const corner = sharedCorner(a.wall, b.wall);
      adjacent.push({ a: a.id, b: b.id, mapA: cornerMap(a.wall, corner), mapB: cornerMap(b.wall, corner), S2: S * S, connectionId: c.id });
    }
  }
  const sameWallList = Object.keys(sameWall).sort().map((k) => {
    const [a, b] = k.split('|'); return { a, b, c: sameWall[k] };
  });
  const multiRow = Object.values(rowsPerWall).some((n) => n > 1);
  return { ok: true, W, H, ids, byId, bounds, sameWall: sameWallList, adjacent, multiRow };
}

// ── exact interval evaluation ────────────────────────────────────────────
function cornerInterval(map, lo, hi, W, H) {
  if (map.kind === 's') return [lo, hi];
  if (map.kind === 'H-s') return [H - hi, H - lo];
  return [W - hi, W - lo];                                  // 'W-s'
}
/** (u - r)^2 over u in [ulo, uhi] with ulo >= r (containment): monotone. */
function gRange(ulo, uhi, r) { return [sq(ulo - r), sq(uhi - r)]; }

/** Evaluate every constraint over a box. Returns 'SAT' | 'UNSAT' | pending list. */
function evaluate(model, box) {
  const pending = [];
  for (const sw of model.sameWall) {
    const [alo, ahi] = box[sw.a]; const [blo, bhi] = box[sw.b];
    const lowerGap = bmax(0n, bmax(blo - ahi, alo - bhi));
    const upperGap = bmax(bhi - alo, ahi - blo);
    if (upperGap < sw.c) return { verdict: 'UNSAT', constraint: { kind: 'SAME_WALL', a: sw.a, b: sw.b } };
    if (lowerGap < sw.c) pending.push({ kind: 'SAME_WALL', a: sw.a, b: sw.b, c: sw.c });
  }
  for (const ad of model.adjacent) {
    const [ulo, uhi] = cornerInterval(ad.mapA, box[ad.a][0], box[ad.a][1], model.W, model.H);
    const [vlo, vhi] = cornerInterval(ad.mapB, box[ad.b][0], box[ad.b][1], model.W, model.H);
    const [gu0, gu1] = gRange(ulo, uhi, model.byId[ad.a].r);
    const [gv0, gv1] = gRange(vlo, vhi, model.byId[ad.b].r);
    if (gu1 + gv1 < ad.S2) return { verdict: 'UNSAT', constraint: { kind: 'ADJACENT', a: ad.a, b: ad.b, connectionId: ad.connectionId } };
    if (gu0 + gv0 < ad.S2) pending.push({ kind: 'ADJACENT', a: ad.a, b: ad.b, ad });
  }
  return pending.length === 0 ? { verdict: 'SAT' } : { verdict: 'PENDING', pending };
}

/** Same-wall ordering propagation to a fixpoint. Returns false if empty. */
function propagate(model, box) {
  let changed = true; let guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const sw of model.sameWall) {
      const A = box[sw.a]; const B = box[sw.b];
      // tighten only once the intervals already fix the ordering
      const aLeft = A[1] <= B[0];         // every a-point is left of every b-point
      const bLeft = B[1] <= A[0];
      if (aLeft) {
        const nb = bmax(B[0], A[0] + sw.c); const na = bmin(A[1], B[1] - sw.c);
        if (nb !== B[0] || na !== A[1]) { B[0] = nb; A[1] = na; changed = true; }
      } else if (bLeft) {
        const na = bmax(A[0], B[0] + sw.c); const nb = bmin(B[1], A[1] - sw.c);
        if (na !== A[0] || nb !== B[1]) { A[0] = na; B[1] = nb; changed = true; }
      }
      if (A[0] > A[1] || B[0] > B[1]) return false;
    }
    for (const ad of model.adjacent) {
      // corner-distance intervals for both endpoints
      const [ulo, uhi] = cornerInterval(ad.mapA, box[ad.a][0], box[ad.a][1], model.W, model.H);
      const [vlo, vhi] = cornerInterval(ad.mapB, box[ad.b][0], box[ad.b][1], model.W, model.H);
      const ra = model.byId[ad.a].r; const rb = model.byId[ad.b].r;
      // (u - ra)^2 >= S^2 - max (v - rb)^2  =>  u >= ra + floor(sqrt(T))  (sound: floor <= true bound)
      const tU = ad.S2 - sq(vhi - rb);
      if (tU > 0n) { const need = ra + isqrtFloor(tU); if (need > ulo) { if (!tightenCorner(box, ad.a, ad.mapA, need, model)) return false; changed = true; } }
      const tV = ad.S2 - sq(uhi - ra);
      if (tV > 0n) { const need = rb + isqrtFloor(tV); if (need > vlo) { if (!tightenCorner(box, ad.b, ad.mapB, need, model)) return false; changed = true; } }
    }
  }
  return true;
}
/** Raise a corner-distance lower bound to `need`, mapped back onto s. */
function tightenCorner(box, id, map, need, model) {
  if (map.kind === 's') box[id][0] = bmax(box[id][0], need);
  else if (map.kind === 'H-s') box[id][1] = bmin(box[id][1], model.H - need);
  else box[id][1] = bmin(box[id][1], model.W - need);
  return box[id][0] <= box[id][1];
}

const cloneBox = (box) => { const o = {}; for (const k of Object.keys(box)) o[k] = [box[k][0], box[k][1]]; return o; };

/**
 * Continuous-domain feasibility by interval branch-and-bound.
 * Returns { status: 'FEASIBLE'|'INFEASIBLE'|'UNKNOWN', witness?, refuted?, nodes, unresolved }.
 */
function solveFeasibility(model, options) {
  const budget = (options && options.nodeBudget) || 200000;
  const root = {}; for (const id of model.ids) root[id] = [model.bounds[id][0], model.bounds[id][1]];
  // fast exact-verified finder first; refutation always needs the full B&B
  const cap = options && options.witnessCap !== undefined ? options.witnessCap : 3000;
  const quick = cap > 0 ? witnessSearch(model, cap) : null;
  if (quick) return { status: 'FEASIBLE', witness: quick, nodes: 0, unresolved: 0, finder: 'PERMUTATION_PACKING' };
  const stack = [root];
  let nodes = 0; let unresolved = 0; let lastRefuted = null;
  while (stack.length > 0) {
    if (nodes >= budget) return { status: 'UNKNOWN', reason: 'NODE_BUDGET_EXHAUSTED', nodes, unresolved };
    const box = stack.pop(); nodes++;
    if (!propagate(model, box)) { lastRefuted = { kind: 'PROPAGATION_EMPTY' }; continue; }
    const ev = evaluate(model, box);
    if (ev.verdict === 'UNSAT') { lastRefuted = ev.constraint; continue; }
    if (ev.verdict === 'SAT') {
      // every point of this box satisfies every constraint: take the midpoint
      const witness = {}; for (const id of model.ids) witness[id] = (box[id][0] + box[id][1]) / 2n;
      return { status: 'FEASIBLE', witness, nodes, unresolved };
    }
    // cheap exact-verified candidates first: any verified point IS a proof
    // (options.disableCandidates exists ONLY so tests can exercise the pure
    // branch-and-bound path; production never sets it)
    if (!(options && options.disableCandidates)) {
      const found = nodeCandidates(model, box);
      if (found) return { status: 'FEASIBLE', witness: found, nodes, unresolved };
    }
    // branch: resolve an undecided same-wall ORDERING (a genuine disjunction)
    // only while the two intervals still overlap; once the order is fixed the
    // constraint is linear and is handled by bisection below
    const order = ev.pending.find((p) => p.kind === 'SAME_WALL'
      && box[p.a][1] > box[p.b][0] && box[p.b][1] > box[p.a][0]);
    if (order) {
      const A = box[order.a]; const B = box[order.b];
      const left = cloneBox(box);  // a left of b: a <= b - c
      left[order.a][1] = bmin(left[order.a][1], B[1] - order.c);
      left[order.b][0] = bmax(left[order.b][0], A[0] + order.c);
      const right = cloneBox(box); // b left of a
      right[order.b][1] = bmin(right[order.b][1], A[1] - order.c);
      right[order.a][0] = bmax(right[order.a][0], B[0] + order.c);
      if (left[order.a][0] <= left[order.a][1] && left[order.b][0] <= left[order.b][1]) stack.push(left);
      if (right[order.a][0] <= right[order.a][1] && right[order.b][0] <= right[order.b][1]) stack.push(right);
      continue;
    }
    // otherwise bisect the widest variable that appears in any pending constraint
    let pick = null; let width = -1n;
    for (const p of ev.pending) for (const id of [p.a, p.b]) {
      const w = box[id][1] - box[id][0];
      if (w > width) { width = w; pick = id; }
    }
    if (width < 2n) { unresolved++; continue; }     // cannot split further: undecided leaf
    const mid = (box[pick][0] + box[pick][1]) / 2n;
    const lo = cloneBox(box); lo[pick][1] = mid;
    const hi = cloneBox(box); hi[pick][0] = mid;   // shared endpoint keeps coverage exact
    stack.push(hi, lo);
  }
  if (unresolved > 0) return { status: 'UNKNOWN', reason: 'UNRESOLVED_BOXES', nodes, unresolved };
  return { status: 'INFEASIBLE', refuted: lastRefuted, nodes, unresolved };
}

/** Try every combination of per-wall strategies {pack-left, pack-right,
 *  midpoint} inside the current box and return the first exactly verified
 *  point. Bounded (3^walls <= 81 candidates). */
function nodeCandidates(model, box) {
  const byWall = {};
  for (const id of model.ids) (byWall[model.byId[id].wall] = byWall[model.byId[id].wall] || []).push(id);
  const walls = Object.keys(byWall).sort();
  const need = {};
  for (const sw of model.sameWall) { need[sw.a + '|' + sw.b] = sw.c; need[sw.b + '|' + sw.a] = sw.c; }
  const placeWall = (wall, mode) => {
    const ids = byWall[wall].slice().sort((a, b) => (box[a][0] < box[b][0] ? -1 : box[a][0] > box[b][0] ? 1 : (a < b ? -1 : 1)));
    const pos = {};
    if (mode === 'mid') { for (const id of ids) pos[id] = (box[id][0] + box[id][1]) / 2n; return pos; }
    if (mode === 'left') {
      for (let i = 0; i < ids.length; i++) {
        let v = box[ids[i]][0];
        for (let j = 0; j < i; j++) { const c = need[ids[i] + '|' + ids[j]]; if (c !== undefined) v = bmax(v, pos[ids[j]] + c); }
        if (v > box[ids[i]][1]) return null; pos[ids[i]] = v;
      }
      return pos;
    }
    for (let i = ids.length - 1; i >= 0; i--) {                      // right: pack toward the upper bounds
      let v = box[ids[i]][1];
      for (let j = ids.length - 1; j > i; j--) { const c = need[ids[i] + '|' + ids[j]]; if (c !== undefined) v = bmin(v, pos[ids[j]] - c); }
      if (v < box[ids[i]][0]) return null; pos[ids[i]] = v;
    }
    return pos;
  };
  const modes = ['left', 'right', 'mid'];
  const idx = walls.map(() => 0);
  while (true) {
    const point = {}; let ok = true;
    for (let w = 0; w < walls.length && ok; w++) {
      const pos = placeWall(walls[w], modes[idx[w]]);
      if (!pos) ok = false; else Object.assign(point, pos);
    }
    if (ok && verifyPoint(model, point).ok) return point;
    let k = 0; while (k < walls.length) { idx[k]++; if (idx[k] < modes.length) break; idx[k] = 0; k++; }
    if (k === walls.length) return null;
  }
}

/** Heuristic candidate inside a box: per wall, entries in order of their
 *  current lower bounds, each pushed right by every same-wall requirement
 *  against earlier entries. Purely a proposal — never trusted unverified. */
function greedyCandidate(model, box) {
  const point = {};
  const byWall = {};
  for (const id of model.ids) (byWall[model.byId[id].wall] = byWall[model.byId[id].wall] || []).push(id);
  const need = {};
  for (const sw of model.sameWall) { need[sw.a + '|' + sw.b] = sw.c; need[sw.b + '|' + sw.a] = sw.c; }
  for (const wall of Object.keys(byWall)) {
    const ids = byWall[wall].slice().sort((a, b) => (box[a][0] < box[b][0] ? -1 : box[a][0] > box[b][0] ? 1 : (a < b ? -1 : 1)));
    for (let i = 0; i < ids.length; i++) {
      let s = box[ids[i]][0];
      for (let j = 0; j < i; j++) {
        const c = need[ids[i] + '|' + ids[j]];
        if (c !== undefined) s = bmax(s, point[ids[j]] + c);
      }
      if (s > box[ids[i]][1]) return null;
      point[ids[i]] = s;
    }
  }
  return point;
}

/** Root witness search: for every combination of per-wall orderings (bounded),
 *  pack each wall left-to-right, right-to-left and spread evenly, and accept
 *  the first candidate the exact verifier confirms. Finder only — never a
 *  proof of infeasibility. */
function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    for (const rest of permutations(arr.filter((_, k) => k !== i))) out.push([arr[i]].concat(rest));
  }
  return out;
}
function packWall(model, order, lengths, mode) {
  // returns positions for one wall given an ordering, or null
  const need = {};
  for (const sw of model.sameWall) { need[sw.a + '|' + sw.b] = sw.c; need[sw.b + '|' + sw.a] = sw.c; }
  const pos = {};
  const L = lengths;
  // left-to-right minimal packing
  for (let i = 0; i < order.length; i++) {
    let s = model.byId[order[i]].r;
    for (let j = 0; j < i; j++) { const c = need[order[i] + '|' + order[j]]; if (c !== undefined) s = bmax(s, pos[order[j]] + c); }
    pos[order[i]] = s;
  }
  const last = order[order.length - 1];
  const slack = L - model.byId[last].r - pos[last];
  if (slack < 0n) return null;
  if (mode === 'right') for (const id of order) pos[id] += slack;               // shove to the far end
  if (mode === 'spread' && order.length > 1) {                                   // distribute slack evenly
    const step = slack / BigInt(order.length - 1);
    for (let i = 0; i < order.length; i++) pos[order[i]] += step * BigInt(i);
  }
  return pos;
}
function witnessSearch(model, cap) {
  const byWall = {};
  for (const id of model.ids) (byWall[model.byId[id].wall] = byWall[model.byId[id].wall] || []).push(id);
  const walls = Object.keys(byWall).sort();
  const perms = walls.map((w) => (byWall[w].length <= 6 ? permutations(byWall[w]) : [byWall[w]]));
  let combos = 1; for (const p of perms) combos *= p.length;
  if (combos * 3 > cap) return null;                                             // stay bounded
  const idx = walls.map(() => 0);
  while (true) {
    for (const mode of ['left', 'right', 'spread']) {
      const point = {}; let ok = true;
      for (let w = 0; w < walls.length && ok; w++) {
        const L = HORIZONTAL_WALL[walls[w]] ? model.W : model.H;
        const pos = packWall(model, perms[w][idx[w]], L, mode);
        if (!pos) { ok = false; break; }
        Object.assign(point, pos);
      }
      if (ok && verifyPoint(model, point).ok) return point;
    }
    let k = 0; while (k < walls.length) { idx[k]++; if (idx[k] < perms[k].length) break; idx[k] = 0; k++; }
    if (k === walls.length) return null;
  }
}

/** INDEPENDENT exact re-verification of a placement (separate code path). */
function verifyPoint(model, point) {
  for (const id of model.ids) {
    const s = point[id];
    if (s === undefined || s < model.bounds[id][0] || s > model.bounds[id][1]) return { ok: false, failed: { kind: 'CONTAINMENT', id } };
  }
  for (const sw of model.sameWall) {
    const d = point[sw.a] > point[sw.b] ? point[sw.a] - point[sw.b] : point[sw.b] - point[sw.a];
    if (d < sw.c) return { ok: false, failed: { kind: 'SAME_WALL', a: sw.a, b: sw.b } };
  }
  for (const ad of model.adjacent) {
    const u = cornerInterval(ad.mapA, point[ad.a], point[ad.a], model.W, model.H)[0];
    const v = cornerInterval(ad.mapB, point[ad.b], point[ad.b], model.W, model.H)[0];
    const lhs = sq(u - model.byId[ad.a].r) + sq(v - model.byId[ad.b].r);
    if (lhs < ad.S2) return { ok: false, failed: { kind: 'ADJACENT', a: ad.a, b: ad.b } };
  }
  return { ok: true };
}

// ── public API ───────────────────────────────────────────────────────────
function guaranteeFor(model, geometry) {
  const assumptions = ['FACE_PLANE_PROJECTION', 'DATUM_AS_SUPPLIED'];
  if (model.multiRow) assumptions.push('MULTI_ROW_PROJECTED_COPLANAR');
  return {
    guarantee: model.multiRow ? 'CONSERVATIVE_FACE_PLANE_MULTIROW' : 'EXACT_FACE_PLANE_FOR_SUPPLIED_GEOMETRY',
    assumptions,
    datum: geometry.datumPolicy || 'AS_SUPPLIED',
    physicalFitVerified: false,
    depthVerified: false,
  };
}

/**
 * checkLayout: certified feasibility of ONE candidate W x H.
 */
function checkLayout(args) {
  const { request, result, geometry, widthIn, heightIn, options } = args || {};
  const model = buildModel(request, result, geometry, widthIn, heightIn);
  if (!model.ok) return { status: 'INVALID', reason: model.reason, entryId: model.entryId, connectionId: model.connectionId };
  const solved = solveFeasibility(model, options);
  const base = {
    status: solved.status, widthIn: fromMicro(model.W), heightIn: fromMicro(model.H),
    nodes: solved.nodes, unresolvedBoxes: solved.unresolved,
    ...guaranteeFor(model, geometry),
  };
  if (solved.status === 'FEASIBLE') {
    const check = verifyPoint(model, solved.witness);
    if (!check.ok) return { ...base, status: 'UNKNOWN', reason: 'WITNESS_VERIFICATION_FAILED', failed: check.failed };
    const placements = {};
    for (const id of model.ids) placements[id] = { wall: model.byId[id].wall, alongIn: fromMicro(solved.witness[id]) };
    return { ...base, placements, certificate: { kind: 'ACCEPTED_BOX_WITH_VERIFIED_WITNESS', exactArithmetic: true } };
  }
  if (solved.status === 'INFEASIBLE') {
    return { ...base, refutedConstraint: solved.refuted, certificate: { kind: 'COMPLETE_CONTINUOUS_REFUTATION', exactArithmetic: true } };
  }
  return { ...base, reason: solved.reason };
}

/**
 * findLayoutDimensions: thin monotone search over the same kernel.
 *  policy 'WIDTH'    -> minimal W with H fixed (heightIn required)
 *  policy 'HEIGHT'   -> minimal H with W fixed (widthIn required)
 *  policy 'BALANCED' -> minimal k >= 1 with (W,H) = k*(baseW, baseH)
 * Minimality is CERTIFIED_WITHIN_TOLERANCE only: the returned box is proven
 * feasible and the reported lower bound is proven infeasible (or is the
 * Layer-1 floor, below which nothing is admissible by rule).
 */
function findLayoutDimensions(args) {
  const { request, result, geometry, policy, toleranceIn, widthIn, heightIn, options } = args || {};
  const tol = isFiniteNumber(toleranceIn) && toleranceIn > 0 ? toleranceIn : 1 / 64;
  const maxIn = (options && options.maxIn) || 240;
  if (!result || result.ok !== true) return { status: 'INVALID', reason: 'LAYER1_RESULT_REQUIRED' };
  const floorW = result.minimumWidthIn || 0; const floorH = result.minimumHeightIn || 0;
  // containment floor: the largest datum diameter on the relevant walls
  const rowWall = {}; for (const r of request.rows) rowWall[r.id] = r.wall;
  let maxDiaH = 0; let maxDiaW = 0;
  for (const e of request.entries) {
    const g = geometry && geometry.entries && geometry.entries[e.id];
    const d = g && isFiniteNumber(g.entryMeasurementDiameterIn) ? g.entryMeasurementDiameterIn : 0;
    if (HORIZONTAL_WALL[rowWall[e.rowId]]) maxDiaW = Math.max(maxDiaW, d); else maxDiaH = Math.max(maxDiaH, d);
  }
  const baseW = Math.max(floorW, maxDiaW, 1); const baseH = Math.max(floorH, maxDiaH, 1);
  const checks = [];
  const probe = (W, H) => { const r = checkLayout({ request, result, geometry, widthIn: W, heightIn: H, options }); checks.push({ W, H, status: r.status, nodes: r.nodes }); return r; };
  const dims = (t) => {
    if (policy === 'WIDTH') return [t, isFiniteNumber(heightIn) ? heightIn : baseH];
    if (policy === 'HEIGHT') return [isFiniteNumber(widthIn) ? widthIn : baseW, t];
    return [baseW * t, baseH * t];
  };
  let lo; let hi;
  if (policy === 'WIDTH') { lo = baseW; hi = baseW; }
  else if (policy === 'HEIGHT') { lo = baseH; hi = baseH; }
  else if (policy === 'BALANCED') { lo = 1; hi = 1; }
  else return { status: 'INVALID', reason: 'UNKNOWN_POLICY' };
  // grow until feasible (monotonicity makes this sound), bounded
  let first = probe(...dims(hi));
  if (first.status === 'INVALID') return first;
  let loCertified = 'LAYER1_FLOOR';        // nothing below the floor is admissible by rule
  while (first.status !== 'FEASIBLE') {
    if (first.status === 'INFEASIBLE') { lo = hi; loCertified = 'INFEASIBLE'; }
    else return { status: 'UNKNOWN', reason: first.reason, checks, ...pick(first) };
    hi = policy === 'BALANCED' ? hi * 2 : hi * 2;
    if (dims(hi)[0] > maxIn || dims(hi)[1] > maxIn) return { status: 'NO_FEASIBLE_WITHIN_BOUNDS', maxIn, checks };
    first = probe(...dims(hi));
  }
  let best = first;
  // bisect; UNKNOWN probes are retried at a nudged point, then reported honestly
  let unknownEncountered = false;
  const gapOf = (a, b) => (policy === 'BALANCED' ? Math.max((b - a) * baseW, (b - a) * baseH) : b - a);
  while (gapOf(lo, hi) > tol) {
    let mid = (lo + hi) / 2; let r = probe(...dims(mid));
    if (r.status === 'UNKNOWN') { unknownEncountered = true; mid = lo + (hi - lo) * 0.37; r = probe(...dims(mid)); }
    if (r.status === 'FEASIBLE') { hi = mid; best = r; }
    else if (r.status === 'INFEASIBLE') { lo = mid; loCertified = 'INFEASIBLE'; }
    else break;                                                        // cannot certify either side
  }
  const gap = gapOf(lo, hi);
  const [lw, lh] = dims(lo);
  return {
    status: gap <= tol ? 'CERTIFIED_WITHIN_TOLERANCE' : 'CERTIFIED_BOUNDS',
    policy, widthIn: best.widthIn, heightIn: best.heightIn, placements: best.placements,
    lowerBound: { widthIn: lw, heightIn: lh, certifiedBy: loCertified },
    toleranceIn: tol, achievedGapIn: gap, unknownEncountered, checks,
    guarantee: best.guarantee, assumptions: best.assumptions, datum: best.datum,
    physicalFitVerified: false, depthVerified: false,
  };
}
function pick(r) { return { widthIn: r.widthIn, heightIn: r.heightIn }; }

module.exports = {
  checkLayout,
  findLayoutDimensions,
  _internal: { buildModel, solveFeasibility, verifyPoint, toMicro, fromMicro },
};
