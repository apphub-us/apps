'use strict';
/** Box fill — NEC 314.16(A) and (B). Pure functions. */
const { BF_VOL, BF_BOXES } = require('./tables');

/**
 * @param {object} input
 * @param {string} input.boxKey
 * @param {string} input.largestWireSize  governs device/clamp/EGC allowances
 * @param {number} input.numConductors    314.16(B)(1)
 * @param {number} [input.numDevices]     314.16(B)(4) — 2x each
 * @param {boolean}[input.hasClamps]      314.16(B)(2) — 1x total
 * @param {boolean}[input.hasEgc]         314.16(B)(5) — 1x total
 * @param {number} [input.numSupportFittings] 314.16(B)(3) — 1x each
 * @param {number} [input.extensionVolume]
 */
function calculateBoxFill(input) {
  const {
    boxKey, largestWireSize, numConductors = 0, numDevices = 0,
    hasClamps = false, hasEgc = false, numSupportFittings = 0, extensionVolume = 0,
  } = input || {};

  const box = BF_BOXES[boxKey];
  const volPerWire = BF_VOL[largestWireSize];
  if (!box) return { ok: false, reason: 'BOX_NOT_IN_TABLE', boxKey };
  if (!volPerWire) return { ok: false, reason: 'WIRE_NOT_IN_TABLE', largestWireSize };
  // Counts are allowances under 314.16(B): whole, non-negative, finite.
  // Structured failure — never NaN totals, never a negative fill volume.
  for (const [name, value] of [['numConductors', numConductors],
    ['numDevices', numDevices], ['numSupportFittings', numSupportFittings]]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, reason: 'INVALID_COUNT', field: name, value };
    }
    if (value < 0) return { ok: false, reason: 'NEGATIVE_COUNT', field: name, value };
  }
  if (typeof extensionVolume !== 'number' || !Number.isFinite(extensionVolume)
    || extensionVolume < 0) {
    return { ok: false, reason: 'INVALID_EXTENSION', extensionVolume };
  }

  const conductorVolume = numConductors * volPerWire;
  const deviceVolume = numDevices * 2 * volPerWire;
  const clampVolume = (hasClamps ? 1 : 0) * volPerWire;
  const egcVolume = (hasEgc ? 1 : 0) * volPerWire;
  const fittingVolume = numSupportFittings * volPerWire;

  const usedVolume = conductorVolume + deviceVolume + clampVolume + egcVolume + fittingVolume;
  const boxVolume = box.vol + extensionVolume;
  const nonConductor = deviceVolume + clampVolume + egcVolume + fittingVolume;

  return {
    ok: true,
    boxVolume: round2(boxVolume),
    volPerWire,
    conductorVolume: round2(conductorVolume),
    deviceVolume: round2(deviceVolume),
    clampVolume: round2(clampVolume),
    egcVolume: round2(egcVolume),
    fittingVolume: round2(fittingVolume),
    usedVolume: round2(usedVolume),
    remaining: round2(boxVolume - usedVolume),
    fillPercent: round1((usedVolume / boxVolume) * 100),
    maxConductors: Math.max(0, Math.floor((boxVolume - nonConductor) / volPerWire)),
    fits: usedVolume <= boxVolume,
  };
}
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
module.exports = { calculateBoxFill };
