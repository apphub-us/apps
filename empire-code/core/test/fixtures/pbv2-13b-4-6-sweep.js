/**
 * PBV2-13B-4.6 — deterministic Layer-2 sweep generator.
 * Shared by the certified-dimension invariance test: cases() enumerates 776
 * requests (single ANGLE/STRAIGHT/U pulls across trade sizes and walls, mixed
 * pulls, multi-entry walls, extreme aspect ratios); run() certifies each under
 * both dimension policies. pbv2-13b-4-6-dims-before.json holds the results
 * produced by Layer 2 BEFORE 4.6 (md5 06381d81b98809a39b85cadfc2af1acf) —
 * the witness-preference change must reproduce every W, H and status exactly.
 */
'use strict';
const SIZES = ['1/2', '1', '2', '3', '4', '6'];
const ADJ = [['left', 'top'], ['top', 'right'], ['right', 'bottom'], ['bottom', 'left']];
const OPP = [['left', 'right'], ['top', 'bottom']];
const WALLS = ['left', 'top', 'right', 'bottom'];
function mk() {
  const rows = {}; const entries = []; const connections = []; let n = 0;
  const row = (wall) => { if (!rows[wall]) rows[wall] = { id: 'r-' + wall, wall, order: 0 }; return rows[wall].id; };
  const add = (wall, size) => { const id = 'e' + (++n); entries.push({ id, rowId: row(wall), tradeSize: size }); return id; };
  const conn = (a, b) => { connections.push({ id: 'c' + connections.length, entryIds: [a, b] }); };
  return { add, conn, req: () => ({ rows: Object.values(rows), entries, connections }) };
}
function cases() {
  const out = []; const push = (key, m) => out.push({ key, request: m.req() });
  for (const [a, b] of ADJ) for (const sa of SIZES) for (const sb of SIZES) { const m = mk(); m.conn(m.add(a, sa), m.add(b, sb)); push(`angle:${a}-${b}:${sa}:${sb}`, m); }
  for (const [a, b] of OPP) for (const sa of SIZES) for (const sb of SIZES) { const m = mk(); m.conn(m.add(a, sa), m.add(b, sb)); push(`straight:${a}-${b}:${sa}:${sb}`, m); }
  for (const w of WALLS) for (const sa of SIZES) for (const sb of SIZES) { const m = mk(); m.conn(m.add(w, sa), m.add(w, sb)); push(`u:${w}:${sa}:${sb}`, m); }
  for (const [a, b] of ADJ) for (const s of SIZES) for (const w of WALLS) for (const su of ['2', '4']) { const m = mk(); m.conn(m.add(a, s), m.add(b, s)); m.conn(m.add(w, su), m.add(w, su)); push(`angle+u:${a}-${b}:${s}:u@${w}:${su}`, m); }
  for (const [a, b] of OPP) for (const s of SIZES) for (const w of WALLS) for (const su of ['2', '4']) { const m = mk(); m.conn(m.add(a, s), m.add(b, s)); m.conn(m.add(w, su), m.add(w, su)); push(`straight+u:${a}-${b}:${s}:u@${w}:${su}`, m); }
  for (const [a, b] of ADJ) for (const [c, d] of OPP) for (const s of ['1', '2', '4']) { const m = mk(); m.conn(m.add(a, s), m.add(b, s)); m.conn(m.add(c, s), m.add(d, s)); push(`angle+straight:${a}-${b}+${c}-${d}:${s}`, m); }
  for (const [a, b] of ADJ) for (const [c, d] of ADJ) for (const s of ['1', '3']) { if (a === c && b === d) continue; const m = mk(); m.conn(m.add(a, s), m.add(b, s)); m.conn(m.add(c, s), m.add(d, s)); push(`2angles:${a}-${b}+${c}-${d}:${s}`, m); }
  for (const [a, b] of ADJ) for (const s of ['1', '2', '3']) for (const k of [1, 2, 3]) for (const ws of [a, b]) { const m = mk(); m.conn(m.add(a, s), m.add(b, s)); for (let i = 0; i < k; i++) m.add(ws, s); push(`angle+extras:${a}-${b}:${s}:${k}@${ws}`, m); }
  for (const [a, b] of OPP) for (const s of ['2', '4']) for (const k of [1, 2]) { const m = mk(); m.conn(m.add(a, s), m.add(b, s)); for (let i = 0; i < k; i++) { m.conn(m.add(a, '1'), m.add(b, '1')); } push(`multistraight:${a}-${b}:${s}+${k}x1`, m); }
  return out;
}
function run(L2, L1, L0, c) {
  const result = L1.calculatePullBox(c.request);
  if (!result || result.ok !== true) return { status: 'L1_REJECT' };
  const specs = {}; for (const e of c.request.entries) specs[e.id] = { tradeSize: e.tradeSize, racewayType: 'RMC', entryMethod: 'KNOCKOUT_THREADED' };
  const g = L0.buildLayoutGeometry(specs); if (!g.ok) return { status: 'L0_REJECT' };
  const out = {};
  for (const policy of ['WIDTH', 'BALANCED']) {
    const args = { request: c.request, result, geometry: g.geometry, policy };
    if (policy === 'WIDTH') args.heightIn = result.minimumHeightIn;
    const r = L2.findLayoutDimensions(args);
    out[policy] = { status: r.status, W: r.widthIn, H: r.heightIn, placements: r.placements };
  }
  return out;
}
module.exports = { cases, run };
