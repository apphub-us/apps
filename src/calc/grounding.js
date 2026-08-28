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
const CAP_REFERENCE = {
  rod: 'NEC 250.66(A)', ufer: 'NEC 250.66(B)', ring: 'NEC 250.66(C)',
};

/**
 * One structured decision for the whole Grounding panel. Production's single
 * Calculate action refreshes EGC, 250.122(B) upsizing, GEC and the electrode
 * cap together, so ONE orchestrator call returns all of it — the UI never
 * selects which Article 250 rule applies. EGC (Table 250.122, from the
 * overcurrent device) and GEC (Table 250.66, from the service conductor) stay
 * explicitly separate sections of the result: different destination,
 * different table, never a generic "ground wire size".
 *
 * @param {object} input
 * @param {number} input.ocpdRating          EGC basis — breaker/fuse rating
 * @param {string} input.egcMaterial         'cu' | 'al'
 * @param {string} input.requiredPhaseSize   minimum ungrounded conductor
 * @param {string} input.installedPhaseSize  actually installed conductor
 * @param {string} input.serviceSize         largest service conductor (GEC basis)
 * @param {string} input.serviceMaterial     'cu' | 'al'
 * @param {string} input.electrode           'water' | 'rod' | 'ufer' | 'ring'
 */
function calculateGrounding(input) {
  const {
    ocpdRating, egcMaterial = 'cu', requiredPhaseSize, installedPhaseSize,
    serviceSize, serviceMaterial = 'cu', electrode = 'water',
  } = input || {};

  if (typeof ocpdRating !== 'number' || !Number.isFinite(ocpdRating) || ocpdRating <= 0) {
    return { ok: false, reason: 'INVALID_OCPD', ocpdRating };
  }
  if (egcMaterial !== 'cu' && egcMaterial !== 'al') {
    return { ok: false, reason: 'INVALID_MATERIAL', field: 'egcMaterial', material: egcMaterial };
  }
  if (serviceMaterial !== 'cu' && serviceMaterial !== 'al') {
    return { ok: false, reason: 'INVALID_MATERIAL', field: 'serviceMaterial', material: serviceMaterial };
  }
  if (electrode !== 'water' && !ELECTRODE_CAP[electrode]) {
    return { ok: false, reason: 'INVALID_ELECTRODE', electrode };
  }
  for (const [field, size] of [['requiredPhaseSize', requiredPhaseSize],
    ['installedPhaseSize', installedPhaseSize], ['serviceSize', serviceSize]]) {
    if (!GND_CM[size]) return { ok: false, reason: 'SIZE_NOT_IN_TABLE', field, size };
  }

  const egc = egcUpsized(ocpdRating, requiredPhaseSize, installedPhaseSize, egcMaterial);
  if (!egc.ok) return egc;               // OCPD_ABOVE_TABLE, field-tagged sizes
  const gec = gecWithElectrodeCap(serviceSize, serviceMaterial, electrode);
  if (!gec.ok) return gec;

  const capSize = ELECTRODE_CAP[electrode] || null;
  return {
    ok: true,
    egc: {
      mode: 'EGC',
      tableReference: 'NEC Table 250.122',
      ocpdRating,
      material: egcMaterial,
      baseSize: egc.baseSize,
      requiredPhaseSize,
      installedPhaseSize,
      ratio: egc.ratio,
      upsizeApplied: egc.upsizeApplied,
      requiredCM: egc.upsizeApplied ? egc.requiredCM : null,
      finalSize: egc.finalSize,
      // The honest no-fit answer: the proportional requirement exceeds every
      // supported conductor size. finalSize is null — never silently the base.
      exceedsAvailableSizes: egc.upsizeApplied && egc.finalSize === null,
      rule: egc.upsizeApplied ? 'NEC 250.122(B)' : null,
    },
    gec: {
      mode: 'GEC',
      tableReference: 'NEC Table 250.66',
      serviceSize,
      serviceMaterial,
      copper: gec.copper,
      aluminum: gec.aluminum,
      electrode,
      capSize,
      capReference: CAP_REFERENCE[electrode] || null,
      capApplied: gec.capApplied,
      finalCopper: gec.finalCopper,
    },
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;
module.exports = {
  egcSize, egcUpsized, gecSize, gecWithElectrodeCap, ELECTRODE_CAP,
  calculateGrounding,
};
