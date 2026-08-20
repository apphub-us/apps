'use strict';
/**
 * Conduit & Wireway fill — NEC Chapter 9 Tables 1, 4, 5; NEC 376.22
 * Pure functions. No DOM.
 */
const { CF_AREA, CF_WIRE, WW_AREAS } = require('./tables');

/** NEC Chapter 9, Table 1 — permitted fill by conductor count. */
function fillPercent(numConductors) {
  if (numConductors === 1) return 53;
  if (numConductors === 2) return 31;
  return 40;
}

/**
 * Uniform-conductor conduit fill (all conductors same size and type).
 *
 * LIMITATION (P1-2): the shipped app only supports uniform fill. Real runs mix
 * sizes (e.g. 3x #12 + 1x #10 EGC). Use calculateConduitFillMixed for those.
 */
function calculateConduitFill(input) {
  const { conduitType, conduitSize, wireType, wireSize, numConductors } = input || {};

  const conduit = CF_AREA[conduitType] && CF_AREA[conduitType][conduitSize];
  const wireArea = CF_WIRE[wireType] && CF_WIRE[wireType][wireSize];
  if (!conduit) return { ok: false, reason: 'CONDUIT_NOT_IN_TABLE', conduitType, conduitSize };
  if (!wireArea) return { ok: false, reason: 'WIRE_NOT_IN_TABLE', wireType, wireSize };
  if (!Number.isInteger(numConductors) || numConductors < 1) {
    return { ok: false, reason: 'INVALID_CONDUCTOR_COUNT', numConductors };
  }

  const pct = fillPercent(numConductors);
  const allowedArea = conduit[pct === 53 ? 'f53' : pct === 31 ? 'f31' : 'f40'];
  const usedArea = wireArea * numConductors;
  const rawMax = allowedArea / wireArea;

  // NEC Chapter 9, Note 7: for conductors all of the same size, a calculation
  // resulting in a decimal of 0.8 or larger rounds UP to the next whole conductor.
  const frac = rawMax - Math.floor(rawMax);
  const maxConductors = frac >= 0.8 ? Math.ceil(rawMax) : Math.floor(rawMax);

  return {
    ok: true,
    fillRulePercent: pct,
    totalConduitArea: conduit.t,
    allowedArea,
    eachWireArea: wireArea,
    usedArea: round4(usedArea),
    fillPercentUsed: round1((usedArea / conduit.t) * 100),
    maxConductors,
    maxConductorsRaw: round2(rawMax),
    note7Applied: frac >= 0.8,
    fits: usedArea <= allowedArea,
  };
}

/**
 * Mixed-conductor conduit fill — NEC Chapter 9 Table 1 with Note 6.
 * @param {Array<{wireType:string,wireSize:string,qty:number}>} conductors
 */
function calculateConduitFillMixed(input) {
  const { conduitType, conduitSize, conductors } = input || {};
  const conduit = CF_AREA[conduitType] && CF_AREA[conduitType][conduitSize];
  if (!conduit) return { ok: false, reason: 'CONDUIT_NOT_IN_TABLE', conduitType, conduitSize };
  if (!Array.isArray(conductors) || conductors.length === 0) {
    return { ok: false, reason: 'NO_CONDUCTORS' };
  }

  let usedArea = 0;
  let total = 0;
  const breakdown = [];
  for (const c of conductors) {
    const a = CF_WIRE[c.wireType] && CF_WIRE[c.wireType][c.wireSize];
    if (!a) return { ok: false, reason: 'WIRE_NOT_IN_TABLE', wireType: c.wireType, wireSize: c.wireSize };
    if (!Number.isInteger(c.qty) || c.qty < 1) {
      return { ok: false, reason: 'INVALID_CONDUCTOR_COUNT', qty: c.qty };
    }
    usedArea += a * c.qty;
    total += c.qty;
    breakdown.push({ ...c, eachArea: a, subtotal: round4(a * c.qty) });
  }

  const pct = fillPercent(total);
  const allowedArea = conduit[pct === 53 ? 'f53' : pct === 31 ? 'f31' : 'f40'];

  return {
    ok: true,
    totalConductors: total,
    fillRulePercent: pct,
    allowedArea,
    usedArea: round4(usedArea),
    fillPercentUsed: round1((usedArea / conduit.t) * 100),
    fits: usedArea <= allowedArea,
    breakdown,
  };
}

/** NEC 376.22(A) — sheet-metal wireway, 20% of interior cross-section. */
function calculateWirewayFill(input) {
  const { width, height, wireType, wireSize, numConductors } = input || {};
  const areas = WW_AREAS[wireType];
  const wireArea = areas && areas[wireSize];
  if (!wireArea) return { ok: false, reason: 'WIRE_NOT_IN_TABLE', wireType, wireSize };
  if (!(width > 0) || !(height > 0)) return { ok: false, reason: 'INVALID_DIMENSIONS' };

  const interior = width * height;
  const allowedArea = interior * 0.20;
  const usedArea = wireArea * numConductors;

  return {
    ok: true,
    interiorArea: round2(interior),
    allowedArea: round4(allowedArea),
    usedArea: round4(usedArea),
    fillPercentUsed: round1((usedArea / interior) * 100),
    maxConductors: Math.floor(allowedArea / wireArea),
    fits: usedArea <= allowedArea,
  };
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

module.exports = { calculateConduitFill, calculateConduitFillMixed, calculateWirewayFill, fillPercent };
