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

/** 250.66(A)(B) — fixed permitted reductions by electrode type. */
const ELECTRODE_CAP = { rod: '6', ufer: '4' };
const ELECTRODES = ['water', 'rod', 'ufer', 'ring'];

/**
 * EC-01 — ground ring, 250.66(C).
 *
 * The reduction for a ground ring depends on the ring conductor that is actually
 * installed. Earlier revisions hardcoded "#2" as if it were a property of every
 * ring. That was an undisclosed assumption, so the condition is now an explicit
 * FACT the caller must state. Scope is deliberately narrow and conservative:
 *
 *   CONFIRMED_CU_2AWG_SOLE  the ring is confirmed as #2 AWG copper AND the sized
 *                           GEC portion is the sole connection to that ring ->
 *                           the existing reduction (not larger than #2 Cu) applies.
 *   UNKNOWN (the default)   nothing confirmed -> no reduction and NO final size.
 *   OTHER                   larger / different / unverified ring, or not the sole
 *                           connection -> unsupported, NO final size.
 *
 * This is not a generalized "min(table, any ring conductor)" rule: the final
 * NEC 2020 text of 250.66(C) has not been verified for this project, so every
 * ring other than the confirmed #2 Cu case stays unsupported until the source is
 * closed. For an unresolved ring the Table 250.66 row is still returned, but only
 * as a reference (`copper` / `aluminum`); `finalCopper` is null and `resolved`
 * is false so no caller can present it as a result.
 */
const GROUND_RING = Object.freeze({
  UNKNOWN: 'unknown',
  CONFIRMED_CU_2AWG_SOLE: 'cu_2awg_sole',
  OTHER: 'other',
});
const GROUND_RING_VALUES = Object.freeze(Object.values(GROUND_RING));
const GROUND_RING_CONFIRMED_SIZE = '2';
const ringValue = (groundRing) => (groundRing === undefined || groundRing === null ? GROUND_RING.UNKNOWN : groundRing);

function capped(base, cap) {
  const capBeneficial = GND_CM[cap] < GND_CM[base.copper];
  return {
    ...base,
    capSize: cap,
    capApplied: capBeneficial,
    finalCopper: capBeneficial ? cap : base.copper,
    resolved: true,
    condition: null,
  };
}
function gecWithElectrodeCap(serviceSize, serviceMaterial, electrode, groundRing) {
  const base = gecSize(serviceSize, serviceMaterial);
  if (!base.ok) return base;
  if (electrode === 'ring') {
    const ring = ringValue(groundRing);
    if (!GROUND_RING_VALUES.includes(ring)) {
      return { ok: false, reason: 'INVALID_GROUND_RING', field: 'groundRing', groundRing };
    }
    if (ring !== GROUND_RING.CONFIRMED_CU_2AWG_SOLE) {
      return {
        ...base,
        capSize: null,
        capApplied: false,
        finalCopper: null,
        resolved: false,
        condition: {
          field: 'groundRing',
          code: ring === GROUND_RING.UNKNOWN ? 'GROUND_RING_UNCONFIRMED' : 'GROUND_RING_UNSUPPORTED',
        },
      };
    }
    return capped(base, GROUND_RING_CONFIRMED_SIZE);
  }
  const cap = ELECTRODE_CAP[electrode];
  if (!cap) return { ...base, capSize: null, capApplied: false, finalCopper: base.copper, resolved: true, condition: null };
  return capped(base, cap);
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
 * @param {string} [input.groundRing]        only read when electrode is 'ring':
 *                                           'unknown' (default) | 'cu_2awg_sole' | 'other'
 *                                           — see GROUND_RING. Never assumed.
 */
function calculateGrounding(input) {
  const {
    ocpdRating, egcMaterial = 'cu', requiredPhaseSize, installedPhaseSize,
    serviceSize, serviceMaterial = 'cu', electrode = 'water', groundRing,
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
  if (!ELECTRODES.includes(electrode)) {
    return { ok: false, reason: 'INVALID_ELECTRODE', electrode };
  }
  if (electrode === 'ring' && !GROUND_RING_VALUES.includes(ringValue(groundRing))) {
    return { ok: false, reason: 'INVALID_GROUND_RING', field: 'groundRing', groundRing };
  }
  for (const [field, size] of [['requiredPhaseSize', requiredPhaseSize],
    ['installedPhaseSize', installedPhaseSize], ['serviceSize', serviceSize]]) {
    if (!GND_CM[size]) return { ok: false, reason: 'SIZE_NOT_IN_TABLE', field, size };
  }

  const egc = egcUpsized(ocpdRating, requiredPhaseSize, installedPhaseSize, egcMaterial);
  if (!egc.ok) return egc;               // OCPD_ABOVE_TABLE, field-tagged sizes
  const gec = gecWithElectrodeCap(serviceSize, serviceMaterial, electrode, groundRing);
  if (!gec.ok) return gec;

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
      // EC-01: the stated ring fact (null for every other electrode) and whether
      // a final size exists. `copper` / `aluminum` above are ALWAYS the plain
      // Table 250.66 row; when `resolved` is false they are a reference only and
      // `finalCopper` is null — never a result.
      groundRing: electrode === 'ring' ? ringValue(groundRing) : null,
      capSize: gec.capSize,
      capReference: CAP_REFERENCE[electrode] || null,
      capApplied: gec.capApplied,
      finalCopper: gec.finalCopper,
      resolved: gec.resolved,
      condition: gec.condition,
    },
  };
}

const round3 = (n) => Math.round(n * 1000) / 1000;
module.exports = {
  egcSize, egcUpsized, gecSize, gecWithElectrodeCap, ELECTRODE_CAP,
  GROUND_RING, GROUND_RING_CONFIRMED_SIZE,
  calculateGrounding,
};
