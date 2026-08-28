'use strict';
/**
 * Pull Box V2 — data model + validation foundation (PBV2-1).
 *
 * PBV2-0 frozen contract: rows are first-class entities (stable opaque id,
 * wall, display order); entries reference a rowId and never store a wall;
 * connections are strictly two distinct endpoints. This module owns the
 * canonical trade-size keys, the wall/dimension orientation, deterministic
 * ordering, request validation, and pure geometric classification of a
 * connection (STRAIGHT / ANGLE / U) derived from wall relationships.
 *
 * NO electrical formulas live here yet. The 8x straight rule, the 6x row
 * rule, entry spacing, and width/height governing are FUTURE milestones
 * (PBV2-2..5); this file deliberately contains no NEC arithmetic.
 *
 * Independence: this module has no relationship to the legacy hidden Pull
 * Box panel and must never import or mirror its formulas.
 */

/** Canonical trade-size identity: STRING key → inches. Keys are the only
 *  accepted persisted representation — numeric 0.5 or alias '0.5' are
 *  invalid, which keeps identity deterministic across storage and UI. */
const TRADE_SIZE_IN = {
  '1/2': 0.5,
  '3/4': 0.75,
  '1': 1,
  '1-1/4': 1.25,
  '1-1/2': 1.5,
  '2': 2,
  '2-1/2': 2.5,
  '3': 3,
  '3-1/2': 3.5,
  '4': 4,
  '5': 5,
  '6': 6,
};

/** Canonical ascending display/iteration order for trade sizes. Object key
 *  enumeration reorders integer-like keys, so ordered consumers must use
 *  this list, never Object.keys(TRADE_SIZE_IN). */
const TRADE_SIZE_KEYS = ['1/2', '3/4', '1', '1-1/4', '1-1/2', '2', '2-1/2',
  '3', '3-1/2', '4', '5', '6'];

/** Deterministic wall iteration order — one canonical sequence everywhere. */
const WALL_ORDER = ['left', 'right', 'top', 'bottom'];

/** Canonical orientation: which box dimension a wall's requirements govern.
 *  left/right walls → width, top/bottom walls → height. The engine, UI and
 *  schematic must all read this map rather than re-deriving it. */
const WALL_DIMENSION = {
  left: 'width',
  right: 'width',
  top: 'height',
  bottom: 'height',
};

/** Surfaces reserved for future depth work — rejected with their own reason
 *  so the diagnostic lane stays distinct from a typo like 'north'. */
const RESERVED_SURFACES = ['back', 'front'];

const OPPOSITE_WALL = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

function isNonEmptyId(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function fail(reason, extra) {
  return Object.assign({ ok: false, reason }, extra || {});
}

/**
 * Validate a PBV2 request. Deterministic: first violation wins, in the
 * documented order (request shape → rows → entries → NO_ENTRIES →
 * connections → warnings). Never throws on malformed user data, never
 * mutates the input, never invents rows, walls, or trade sizes.
 *
 * Success: { ok: true, warnings: [...] }
 * Failure: { ok: false, reason: <frozen code>, ...context }
 */
function validatePullBoxRequest(request) {
  // A. request shape
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return fail('MALFORMED_REQUEST', { detail: 'request must be a plain object' });
  }
  const { rows, entries, connections } = request;
  // B. the three collections must be arrays
  if (!Array.isArray(rows)) return fail('MALFORMED_REQUEST', { detail: 'rows must be an array' });
  if (!Array.isArray(entries)) return fail('MALFORMED_REQUEST', { detail: 'entries must be an array' });
  if (!Array.isArray(connections)) return fail('MALFORMED_REQUEST', { detail: 'connections must be an array' });

  // C-E. rows: shape/id → wall → order → uniqueness
  const rowById = new Map();
  const orderSeen = new Map(); // wall → Set(order)
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return fail('MALFORMED_REQUEST', { detail: 'row must be a plain object' });
    }
    if (!isNonEmptyId(row.id)) {
      return fail('MALFORMED_REQUEST', { detail: 'row.id must be a non-empty string' });
    }
    if (RESERVED_SURFACES.indexOf(row.wall) !== -1) {
      return fail('UNSUPPORTED_SURFACE', { rowId: row.id, wall: row.wall });
    }
    if (WALL_ORDER.indexOf(row.wall) === -1) {
      return fail('INVALID_WALL', { rowId: row.id, wall: row.wall });
    }
    if (typeof row.order !== 'number' || !Number.isFinite(row.order)
      || !Number.isInteger(row.order) || row.order < 0) {
      return fail('INVALID_ROW_ORDER', { rowId: row.id, order: row.order });
    }
    if (rowById.has(row.id)) return fail('DUPLICATE_ROW_ID', { rowId: row.id });
    const seen = orderSeen.get(row.wall) || new Set();
    if (seen.has(row.order)) {
      // duplicate order on the SAME wall; the same order on different walls
      // is valid and covered by tests
      return fail('INVALID_ROW_ORDER', {
        rowId: row.id, wall: row.wall, order: row.order, detail: 'duplicate order on one wall',
      });
    }
    seen.add(row.order);
    orderSeen.set(row.wall, seen);
    rowById.set(row.id, row);
  }

  // F-I. entries: shape/id → uniqueness → row reference → trade size
  const entryById = new Map();
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return fail('MALFORMED_REQUEST', { detail: 'entry must be a plain object' });
    }
    if (!isNonEmptyId(entry.id)) {
      return fail('MALFORMED_REQUEST', { detail: 'entry.id must be a non-empty string' });
    }
    if (entryById.has(entry.id)) return fail('DUPLICATE_ENTRY_ID', { entryId: entry.id });
    if (!isNonEmptyId(entry.rowId) || !rowById.has(entry.rowId)) {
      return fail('ROW_UNKNOWN', { entryId: entry.id, rowId: entry.rowId });
    }
    if (typeof entry.tradeSize !== 'string'
      || !Object.prototype.hasOwnProperty.call(TRADE_SIZE_IN, entry.tradeSize)) {
      return fail('INVALID_TRADE_SIZE', { entryId: entry.id, tradeSize: entry.tradeSize });
    }
    entryById.set(entry.id, entry);
  }

  // J. an empty box has nothing to size
  if (entries.length === 0) return fail('NO_ENTRIES');

  // K-P. connections: shape/id → id uniqueness → arity → endpoints exist →
  // self → duplicate unordered pair
  const connIds = new Set();
  const pairKeys = new Set();
  const connectedEntryIds = new Set();
  for (const conn of connections) {
    if (conn === null || typeof conn !== 'object' || Array.isArray(conn)) {
      return fail('MALFORMED_REQUEST', { detail: 'connection must be a plain object' });
    }
    if (!isNonEmptyId(conn.id)) {
      return fail('MALFORMED_REQUEST', { detail: 'connection.id must be a non-empty string' });
    }
    if (connIds.has(conn.id)) return fail('DUPLICATE_CONNECTION_ID', { connectionId: conn.id });
    connIds.add(conn.id);
    if (!Array.isArray(conn.entryIds)) {
      return fail('MALFORMED_REQUEST', { connectionId: conn.id, detail: 'entryIds must be an array' });
    }
    if (conn.entryIds.length !== 2) {
      // MVP: pull connections have exactly two distinct endpoints. Splice
      // modeling is deferred; a future splice entity may exist separately.
      return fail('CONNECTION_ARITY', { connectionId: conn.id, arity: conn.entryIds.length });
    }
    const [a, b] = conn.entryIds;
    for (const endpoint of [a, b]) {
      if (!isNonEmptyId(endpoint) || !entryById.has(endpoint)) {
        return fail('CONNECTION_UNKNOWN_ENTRY', { connectionId: conn.id, entryId: endpoint });
      }
    }
    if (a === b) return fail('CONNECTION_SELF', { connectionId: conn.id, entryId: a });
    // undirected pair identity: [e1,e2] and [e2,e1] are the same connection
    const key = a < b ? a + '\u0000' + b : b + '\u0000' + a;
    if (pairKeys.has(key)) {
      return fail('DUPLICATE_CONNECTION', { connectionId: conn.id, entryIds: [a, b] });
    }
    pairKeys.add(key);
    connectedEntryIds.add(a);
    connectedEntryIds.add(b);
  }

  // Q. warnings — unconnected entries are VALID (they still count toward
  // future same-row sums) but are surfaced once, grouped, in deterministic
  // sorted-id order rather than one warning object per entry.
  const warnings = [];
  const unconnected = entries
    .map((e) => e.id)
    .filter((id) => !connectedEntryIds.has(id))
    .slice()
    .sort();
  if (unconnected.length > 0) {
    warnings.push({ code: 'UNCONNECTED_ENTRY', entryIds: unconnected });
  }

  return { ok: true, warnings };
}

/** Pure lookup: entry → its row (or null). Does not mutate anything. */
function rowForEntry(entry, rows) {
  for (const row of rows) if (row.id === entry.rowId) return row;
  return null;
}

/**
 * Deterministic row ordering: wall in WALL_ORDER, then order ascending,
 * then id. Returns a NEW array; input untouched.
 */
function sortRows(rows) {
  return rows.slice().sort((x, y) => {
    const w = WALL_ORDER.indexOf(x.wall) - WALL_ORDER.indexOf(y.wall);
    if (w !== 0) return w;
    if (x.order !== y.order) return x.order - y.order;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

/**
 * Deterministic entry ordering: parent row per sortRows, then entry id.
 * Returns a NEW array; inputs untouched. Insertion order is never identity.
 */
function sortEntries(entries, rows) {
  const rank = new Map();
  sortRows(rows).forEach((row, i) => rank.set(row.id, i));
  return entries.slice().sort((x, y) => {
    const r = (rank.get(x.rowId) ?? Infinity) - (rank.get(y.rowId) ?? Infinity);
    if (r !== 0) return r;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

/**
 * Geometric classification of one connection, derived purely from the two
 * endpoint walls. Endpoint order never matters.
 *
 *   same wall                    → U
 *   opposite walls (L/R or T/B)  → STRAIGHT (+ the dimension its axis spans)
 *   adjacent walls               → ANGLE
 *
 * Returns { ok: true, type, wallA, wallB, dimension } where wallA/wallB are
 * the endpoints' walls in the connection's entryIds order and dimension is
 * present for STRAIGHT only (from WALL_DIMENSION). Unknown endpoints return
 * a structured failure; NO electrical arithmetic happens here.
 */
function classifyConnection(connection, entries, rows) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const walls = [];
  for (const id of connection.entryIds) {
    const entry = byId.get(id);
    if (!entry) return fail('CONNECTION_UNKNOWN_ENTRY', { connectionId: connection.id, entryId: id });
    const row = rowForEntry(entry, rows);
    if (!row) return fail('ROW_UNKNOWN', { entryId: id, rowId: entry.rowId });
    walls.push(row.wall);
  }
  const [wallA, wallB] = walls;
  if (wallA === wallB) {
    return { ok: true, type: 'U', wallA, wallB };
  }
  if (OPPOSITE_WALL[wallA] === wallB) {
    return { ok: true, type: 'STRAIGHT', wallA, wallB, dimension: WALL_DIMENSION[wallA] };
  }
  return { ok: true, type: 'ANGLE', wallA, wallB };
}

/**
 * Pull Box V2 top-level calculation (PBV2-2: STRAIGHT pulls only).
 *
 * Validates first (structured validation failures pass through unchanged —
 * no electrical work happens on invalid input), classifies every connection
 * through classifyConnection, and computes NEC 314.28(A)(1) straight-pull
 * requirements: 8 x the larger trade size of the connected pair, attributed
 * to the dimension the connection's axis spans (left/right -> width,
 * top/bottom -> height, via WALL_DIMENSION).
 *
 * PBV2-3 adds the NEC 314.28(A)(2) DIMENSIONAL row rule for ANGLE and U
 * pulls. A (wall, row) is TRIGGERED when at least one of its entries
 * participates in an ANGLE or U connection; once triggered, the arithmetic
 * includes EVERY entry in that row — straight-connected and unconnected
 * entries alike (trigger and sum are different questions):
 *
 *   minimumInches = 6 x largest-in-row + sum(ALL OTHER entries, same row,
 *                   same wall only)
 *
 * The largest is counted once in the 6x term and never again in the sum;
 * with equal largest sizes exactly one of them is excluded (chosen
 * deterministically by entry id) and the rest stay in the sum. One
 * requirement exists per triggered row — never per connection — with id
 * 'angle-u-row:<rowId>'.
 *
 * PBV2-4 adds the separate NEC 314.28(A)(2) raceway-entry SPACING
 * requirement: one requirement PER angle/U connection (never per row),
 * 6 x the larger trade size of the connected pair, id 'spacing:<connId>'.
 * Spacing is a distinct physical constraint — it is never merged into
 * minimumWidthIn/minimumHeightIn. Straight connections generate none.
 * Because entry XY positions are unmodeled, the engine states the required
 * minimum and flags SPACING_VERIFY_IN_LAYOUT: physical compliance must be
 * verified in the actual box layout. With spacing implemented, every valid
 * request within the modeled geometry is fully evaluated and
 * completeForRequest is true.
 *
 * Requirement ids are deterministic and semantic — 'straight:<connectionId>'
 * — never positional, never random, so the same request in any array order
 * yields identical ids. Requirement arrays are sorted by requirement id.
 *
 * Result (frozen PBV2-0 shape, populated as far as PBV2-2 goes):
 *   { ok: true,
 *     minimumWidthIn, minimumHeightIn,          // number | null (never 0-for-none)
 *     widthRequirements, heightRequirements,    // sorted by requirement id
 *     governingWidthRequirementId, governingHeightRequirementId,
 *     spacingRequirements: [],                  // PBV2-4
 *     completeForRequest,                       // false when ANGLE/U deferred
 *     warnings, scopeNotes }
 */
function calculatePullBox(request) {
  const validation = validatePullBoxRequest(request);
  if (!validation.ok) return validation;

  const { rows, entries, connections } = request;

  const widthRequirements = [];
  const heightRequirements = [];
  const angleUConnIds = [];              // angle/U connections (spacing + triggers)
  const spacingRequirements = [];
  const triggersByRowId = new Map();     // rowId -> Set(connectionId)
  const byId = new Map(entries.map((e) => [e.id, e]));

  for (const conn of connections) {
    const cls = classifyConnection(conn, entries, rows);
    // validation already guaranteed endpoints/rows resolve; classification
    // cannot fail here, so no second error path is invented
    if (cls.type !== 'STRAIGHT') {
      // ANGLE or U: both endpoint rows become triggered for the A(2)
      // dimensional row rule; the connection itself is recorded for the
      // spacing milestone and for triggerConnectionIds explainability.
      angleUConnIds.push(conn.id);
      for (const id of conn.entryIds) {
        const rid = byId.get(id).rowId;
        if (!triggersByRowId.has(rid)) triggersByRowId.set(rid, new Set());
        triggersByRowId.get(rid).add(conn.id);
      }
      // ── A(2) entry spacing (PBV2-4): per connection, 6 x larger of the
      // pair. entryIds are presented lexicographically sorted because the
      // connection is undirected — presentation metadata only.
      const [pA, pB] = conn.entryIds.map((id) => byId.get(id));
      const larger = TRADE_SIZE_IN[pA.tradeSize] >= TRADE_SIZE_IN[pB.tradeSize]
        ? pA.tradeSize : pB.tradeSize;
      spacingRequirements.push({
        id: 'spacing:' + conn.id,
        kind: 'ENTRY_SPACING',
        connectionType: cls.type,
        connectionId: conn.id,
        entryIds: conn.entryIds.slice().sort(),
        largerTradeSize: larger,
        multiplier: 6,
        minimumInches: 6 * TRADE_SIZE_IN[larger],
        codeRef: { code: 'NEC', section: '314.28(A)(2)' },
      });
      continue;
    }
    const [a, b] = conn.entryIds.map((id) => byId.get(id));
    const aIn = TRADE_SIZE_IN[a.tradeSize];
    const bIn = TRADE_SIZE_IN[b.tradeSize];
    const largest = aIn >= bIn ? a.tradeSize : b.tradeSize;
    const requirement = {
      id: 'straight:' + conn.id,
      kind: 'STRAIGHT',
      dimension: cls.dimension,
      connectionId: conn.id,
      // undirected connection: presentation order is lexicographic, like
      // ENTRY_SPACING, so endpoint order never changes any result byte
      entryIds: conn.entryIds.slice().sort(),
      largestTradeSize: largest,
      otherTradeSizes: [],
      multiplier: 8,
      minimumInches: 8 * Math.max(aIn, bIn),
      codeRef: { code: 'NEC', section: '314.28(A)(1)' },
    };
    (cls.dimension === 'width' ? widthRequirements : heightRequirements)
      .push(requirement);
  }

  // ── 314.28(A)(2) dimensional row requirements ─────────────────────────
  // One requirement per TRIGGERED (wall,row), grouped strictly by rowId —
  // row.order is display metadata and never electrical identity.
  for (const rowObj of sortRows(rows)) {
    const trigger = triggersByRowId.get(rowObj.id);
    if (!trigger) continue;   // untriggered rows generate nothing
    const rowEntries = entries
      .filter((e) => e.rowId === rowObj.id)
      .slice()
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    // largest by inches; equal-largest tie excludes exactly ONE, chosen
    // deterministically as the tied entry with the smallest entry id
    let largestEntry = null;
    for (const e of rowEntries) {
      if (largestEntry === null
        || TRADE_SIZE_IN[e.tradeSize] > TRADE_SIZE_IN[largestEntry.tradeSize]) {
        largestEntry = e;
      }
    }
    const others = rowEntries.filter((e) => e !== largestEntry);
    // deterministic display order: size descending, entry id for ties;
    // duplicates preserved
    const othersSorted = others.slice().sort((x, y) => {
      const d = TRADE_SIZE_IN[y.tradeSize] - TRADE_SIZE_IN[x.tradeSize];
      if (d !== 0) return d;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
    let sumOthers = 0;
    for (const e of others) sumOthers += TRADE_SIZE_IN[e.tradeSize];
    const requirement = {
      id: 'angle-u-row:' + rowObj.id,
      kind: 'ANGLE_U_ROW',
      dimension: WALL_DIMENSION[rowObj.wall],
      wall: rowObj.wall,
      rowId: rowObj.id,
      rowOrder: rowObj.order,
      entryIds: rowEntries.map((e) => e.id),
      largestTradeSize: largestEntry.tradeSize,
      otherTradeSizes: othersSorted.map((e) => e.tradeSize),
      multiplier: 6,
      minimumInches: 6 * TRADE_SIZE_IN[largestEntry.tradeSize] + sumOthers,
      triggerConnectionIds: Array.from(trigger).sort(),
      codeRef: { code: 'NEC', section: '314.28(A)(2)' },
    };
    (requirement.dimension === 'width' ? widthRequirements : heightRequirements)
      .push(requirement);
  }

  const byIdAsc = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  widthRequirements.sort(byIdAsc);
  heightRequirements.sort(byIdAsc);

  // Governing per dimension, independently: max minimumInches; ties break by
  // ascending requirement id (arrays are id-sorted, so first max wins).
  const governing = (reqs) => {
    let win = null;
    for (const r of reqs) if (win === null || r.minimumInches > win.minimumInches) win = r;
    return win;
  };
  const gw = governing(widthRequirements);
  const gh = governing(heightRequirements);

  spacingRequirements.sort(byIdAsc);

  const scopeNotes = [];
  if (spacingRequirements.length > 0) {
    // The required minimums are calculated; entry positions are unmodeled,
    // so physical compliance is verified in the actual box layout.
    scopeNotes.push({ code: 'SPACING_VERIFY_IN_LAYOUT' });
  }
  if (widthRequirements.length === 0) scopeNotes.push({ code: 'NO_WIDTH_CANDIDATES' });
  if (heightRequirements.length === 0) scopeNotes.push({ code: 'NO_HEIGHT_CANDIDATES' });
  scopeNotes.push({ code: 'DEPTH_NOT_CALCULATED' });
  scopeNotes.push({ code: 'A3_NOT_EVALUATED' });

  return {
    ok: true,
    minimumWidthIn: gw ? gw.minimumInches : null,
    minimumHeightIn: gh ? gh.minimumInches : null,
    widthRequirements,
    heightRequirements,
    governingWidthRequirementId: gw ? gw.id : null,
    governingHeightRequirementId: gh ? gh.id : null,
    spacingRequirements,
    // FROZEN SEMANTICS: completeForRequest means exactly "all electrical
    // calculations supported by the PBV2 MVP model have been evaluated for
    // the supplied valid request" — nothing more. It does NOT mean code
    // compliance verified, physical installation verified, both dimensions
    // available, actual spacing verified, depth verified, or the A(3)
    // listed-product exception checked. A valid request can be complete
    // and still carry null dimensions, UNCONNECTED_ENTRY,
    // NO_WIDTH/HEIGHT_CANDIDATES, SPACING_VERIFY_IN_LAYOUT,
    // DEPTH_NOT_CALCULATED and A3_NOT_EVALUATED: those describe supplied-
    // data limits, physical-verification boundaries, or deliberately
    // out-of-scope rules — not an unfinished engine. Validation already
    // rejects everything outside the modeled geometry (back/front
    // surfaces, splice arity), so every valid request is fully evaluable.
    completeForRequest: true,
    warnings: validation.warnings,
    scopeNotes,
  };
}

module.exports = {
  TRADE_SIZE_IN,
  TRADE_SIZE_KEYS,
  calculatePullBox,
  WALL_ORDER,
  WALL_DIMENSION,
  validatePullBoxRequest,
  classifyConnection,
  sortRows,
  sortEntries,
  rowForEntry,
};
