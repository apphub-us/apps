'use strict';
/**
 * EC-08 — the ONE definition of material units and of the quantity rule.
 *
 * Three layers used to carry their own copy and disagreed:
 *   Jobs / manual entry      core/src/jobs/jobMaterial.js            10 units, whole counts for 5 of them
 *   server proposals         candidate/server/contract.cjs            8 units, whole counts for pcs only
 *   browser / core handoff   jobConversationHandoff.js, handoff.js    8 units, whole counts for pcs only
 * so a draft item the server accepted (0.5 roll, 0.5 set) was refused only when it was
 * handed to a job, and box / pack existed in Jobs but not in a conversation.
 *
 * RULE
 *   count units   pcs, box, pack, roll, set   -> a whole-number quantity
 *   length units  ft, in, m, cm, mm           -> a fraction is allowed
 * Nothing here rounds, converts or infers anything. A roll is a count: its length is
 * never derived from the quantity, and "0.5 roll" is never turned into 1 roll or into
 * a length. The caller is told a correction is required and keeps the original text.
 *
 * READ versus WRITE
 *   readable     quantity and unit are each unknown (null) or well formed. Conversation
 *                drafts saved before this rule may hold a fractional count (the server
 *                used to accept 0.5 roll / 0.5 set); such an item stays readable and is
 *                kept exactly as stored.
 *   write-valid  readable AND not a fractional count. Required for every new proposal,
 *                for the merged result of an update, and for a durable handoff to Jobs.
 * inspectDraft() reports both, so a legacy item can be shown, flagged and corrected
 * instead of making its whole conversation unreadable.
 *
 * Pure: no dependencies, no clock, no storage, no DOM. Required by Node (server
 * contract, tests) and embedded verbatim in the calculator block by
 * core/tools/build-calc.js as EC.materialQuantity.
 */
const COUNT_UNITS = Object.freeze(['pcs', 'box', 'pack', 'roll', 'set']);
const LENGTH_UNITS = Object.freeze(['ft', 'in', 'm', 'cm', 'mm']);
/** Count units first, then lengths: the order Jobs has always offered them in. */
const UNITS = Object.freeze(COUNT_UNITS.concat(LENGTH_UNITS));

/** Conversation draft / model proposal quantity: an exact decimal string, at most 7 integer and 4 fractional digits. */
const DRAFT_QUANTITY = /^\d{1,7}(?:\.\d{1,4})?$/;
const DRAFT_QUANTITY_MAX = 1e7;
/** Jobs material quantity text (manual entry keeps the digits as typed, for example "002.00" or ".5"). */
const JOB_QUANTITY = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const JOB_QUANTITY_MAX_LENGTH = 64;

const WHOLE_COUNT_CODE = 'WHOLE_COUNT_REQUIRED';
const WHOLE_COUNT_MESSAGE = 'Pieces, boxes, packs, rolls and sets require a whole-number quantity. Length units allow fractions.';

const isUnit = (unit) => typeof unit === 'string' && UNITS.includes(unit);
const isCountUnit = (unit) => typeof unit === 'string' && COUNT_UNITS.includes(unit);
const isLengthUnit = (unit) => typeof unit === 'string' && LENGTH_UNITS.includes(unit);

/**
 * True when a decimal string has no non-zero fractional digit ("2", "2.00", "002.0").
 * Decided on the text, never on a parsed number, so no float rounding is involved.
 */
function isWholeDecimal(text) {
  if (typeof text !== 'string') return false;
  const dot = text.indexOf('.');
  return dot === -1 || !/[1-9]/.test(text.slice(dot + 1));
}

/** Well-formed conversation quantity: positive, exact decimal, within the supported range. */
function isDraftQuantity(text) {
  return typeof text === 'string' && DRAFT_QUANTITY.test(text) && Number(text) > 0 && Number(text) <= DRAFT_QUANTITY_MAX;
}

/** Well-formed Jobs quantity text (surrounding blanks ignored, as the form always did): positive decimal, no sign, separator or exponent. */
function isJobQuantityText(text) {
  if (typeof text !== 'string' || text.length > JOB_QUANTITY_MAX_LENGTH) return false;
  const trimmed = text.trim();
  return JOB_QUANTITY.test(trimmed) && /[1-9]/.test(trimmed);
}

/**
 * The shared rule itself, for a KNOWN quantity text and unit: true when the unit is a
 * count unit and the quantity has a fractional part. Unknown or malformed values are
 * not this function's concern (it returns false for them).
 */
function fractionalCount(quantityText, unit) {
  return isCountUnit(unit) && typeof quantityText === 'string' && !isWholeDecimal(quantityText.trim());
}

/**
 * One conversation draft item's quantity + unit.
 *   { readable:false, code:'QUANTITY' | 'UNIT' }                    malformed, not a legacy case
 *   { readable:true, complete, writeValid, correctionRequired, code } otherwise
 * complete            both values are known (an unknown one keeps the item in review, it is not an error)
 * correctionRequired  a fractional count: readable, never write-valid, never repaired here
 * writeValid          may be proposed, merged or (when complete) handed to Jobs
 */
function inspectDraft(quantity, unit) {
  if (quantity !== null && !isDraftQuantity(quantity)) return { readable: false, complete: false, writeValid: false, correctionRequired: false, code: 'QUANTITY' };
  if (unit !== null && !isUnit(unit)) return { readable: false, complete: false, writeValid: false, correctionRequired: false, code: 'UNIT' };
  const complete = quantity !== null && unit !== null;
  const correctionRequired = complete && fractionalCount(quantity, unit);
  return { readable: true, complete, writeValid: !correctionRequired, correctionRequired, code: correctionRequired ? WHOLE_COUNT_CODE : null };
}

/** The unit enumeration of a draft item / model schema: every unit, then null for "unknown". A fresh array each call. */
function draftUnitEnum() { return UNITS.concat([null]); }

module.exports = {
  UNITS, COUNT_UNITS, LENGTH_UNITS,
  DRAFT_QUANTITY, DRAFT_QUANTITY_MAX, JOB_QUANTITY, JOB_QUANTITY_MAX_LENGTH,
  WHOLE_COUNT_CODE, WHOLE_COUNT_MESSAGE,
  isUnit, isCountUnit, isLengthUnit, isWholeDecimal, isDraftQuantity, isJobQuantityText,
  fractionalCount, inspectDraft, draftUnitEnum,
};
