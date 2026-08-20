'use strict';
/** Grounding — NEC Table 250.122 (EGC), Table 250.66 (GEC), 250.122(B). */
const { GND_EGC, GND_CM, GND_GEC_CU, GND_GEC_AL, GND_SIZES } = require('./tables');

/** Table 250.122 — EGC from overcurrent device rating. */
function egcSize(ocpdRating, material = 'cu') {
  for (const row of GND_EGC) {
    if (ocpdRating <= row[0]) return material === 'cu' ? row[1] : row[2];
  }
  return null; // above 6000 A
}

/**
 * 250.122(B) — where ungrounded conductors are increased in size, the EGC
 * increases proportionally by circular-mil area.
 */
function egcUpsized(ocpdRating, requiredSize, installedSize, material = 'cu') {
  const base = egcSize(ocpdRating, material);
  if (!base) return { ok: false, reason: 'OCPD_ABOVE_TABLE', ocpdRating };
  const reqCM = GND_CM[requiredSize];
  const instCM = GND_CM[installedSize];
  if (!reqCM || !instCM) return { ok: false, reason: 'SIZE_NOT_IN_TABLE' };

  const ratio = instCM / reqCM;
  if (ratio <= 1.0001) {
    return { ok: true, baseSize: base, ratio: 1, finalSize: base, upsizeApplied: false };
  }
  const need = GND_CM[base] * ratio;
  let finalSize = null;
  for (const s of GND_SIZES) if (GND_CM[s] >= need) { finalSize = s; break; }
  return { ok: true, baseSize: base, ratio: round3(ratio), requiredCM: Math.round(need), finalSize, upsizeApplied: true };
}

/** Table 250.66 — GEC from largest service conductor. */
function gecSize(serviceSize, serviceMaterial = 'cu') {
  const cm = GND_CM[serviceSize];
  if (!cm) return { ok: false, reason: 'SIZE_NOT_IN_TABLE', serviceSize };
  const table = serviceMaterial === 'cu' ? GND_GEC_CU : GND_GEC_AL;
  for (const row of table) {
    if (cm <= row[0]) return { ok: true, copper: row[1], aluminum: row[2] };
  }
  return { ok: false, reason: 'NO_ROW' };
}

/** 250.66(A)(B)(C) — permitted reductions by electrode type. */
const ELECTRODE_CAP = { rod: '6', ufer: '4', ring: '2' };
function gecWithElectrodeCap(serviceSize, serviceMaterial, electrode) {
  const base = gecSize(serviceSize, serviceMaterial);
  if (!base.ok) return base;
  const cap = ELECTRODE_CAP[electrode];
  if (!cap) return { ...base, capApplied: false, finalCopper: base.copper };
  const capBeneficial = GND_CM[cap] < GND_CM[base.copper];
  return {
    ...base,
    capApplied: capBeneficial,
    finalCopper: capBeneficial ? cap : base.copper,
  };
}
const round3 = (n) => Math.round(n * 1000) / 1000;
module.exports = { egcSize, egcUpsized, gecSize, gecWithElectrodeCap, ELECTRODE_CAP };
