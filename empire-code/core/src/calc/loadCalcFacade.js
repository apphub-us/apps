'use strict';
/**
 * Empire Code — Load Calc facade API v2 (LC-22082-B0-CORE-1).
 *
 * evaluateV2(request) → { facade, result }
 *   request = { apiVersion: 2, profileId: 'AB82_core1', context, parseErrors[], snapshot (3.3.0) }
 *
 * Dispatch (SPEC-R2 §2.1, CORE-SCOPE-1 CLOSE-1 §4):
 *   - snapshot.method.selected === 'opt_220_82'  → evaluate82 (engine B82_core1)
 *   - anything else, including null (EMPTY)      → down-conversion on a COPY → the UNCHANGED A evaluator;
 *     `result` is byte-equivalent to a direct A call; the different metadata lives only in `facade`.
 * Structural failure of the V2 request throws LoadCalcEnvelopeError (no normal result).
 * The request object is never mutated; no global draft state is consulted.
 *
 * STAGE4 (docs/stage4-qualification-contract.md) — a SEPARATE explicit entry point, never reached from evaluateV2:
 * evaluatePreliminaryV2(request) → { facade, result }
 *   - same request boundary (assertRequestV2); `result.kind === 'B82_PRELIMINARY_NEW_DESIGN'`, never an ordinary result;
 *   - always the B82 preliminary route: a request that does not select opt_220_82 is refused BY that route
 *     (PRELIMINARY_BLOCKED / CAPABILITY_DISABLED at method.selected) — there is no preliminary A / 220.87 path;
 *   - `facade.resultKind` names the kind so a caller can never mistake the pair for an evaluateV2 pair.
 */
const V2 = require('./loadCalcInputV2.js');
const A = require('./loadCalc.js');
const B82 = require('./loadCalcOpt82.js');

const importGuardOf = (request) => (request.context.importedFrom === null ? 'not_applicable' : (request.context.methodConfirmedAfterImport === true ? 'confirmed' : 'unconfirmed'));

function evaluateV2(request) {
  V2.assertRequestV2(request);
  if (request.snapshot.method.selected === 'opt_220_82') {
    const env = V2.toEnvelope82(request);
    const result = B82.evaluate82(env);
    return { facade: { apiVersion: V2.API_VERSION, capabilityProfile: V2.CAPABILITY_PROFILE_ID, engine: 'B82', engineProfileId: B82.PROFILE_82.id, engineRuleStatus: Object.assign({}, B82.PROFILE_82.ruleStatus), importGuard: importGuardOf(request) }, result };
  }
  const envA = V2.downConvertToA(request);
  const result = A.evaluate(envA);
  return { facade: { apiVersion: V2.API_VERSION, capabilityProfile: V2.CAPABILITY_PROFILE_ID, engine: 'A', engineProfileId: A.PROFILE.id, engineRuleStatus: null, importGuard: 'not_applicable' }, result };
}

/** STAGE4 preliminary new-design evaluation (explicit, separate; see the header). The request is never mutated. */
function evaluatePreliminaryV2(request) {
  V2.assertRequestV2(request);
  const result = B82.evaluatePreliminary82(V2.toEnvelope82(request));
  return { facade: { apiVersion: V2.API_VERSION, capabilityProfile: V2.CAPABILITY_PROFILE_ID, engine: 'B82', engineProfileId: B82.PROFILE_82.id, engineRuleStatus: Object.assign({}, B82.PROFILE_82.ruleStatus), importGuard: importGuardOf(request), resultKind: B82.PRELIMINARY_KIND }, result };
}

module.exports = {
  evaluateV2, API_VERSION: V2.API_VERSION, CAPABILITY_PROFILE_ID: V2.CAPABILITY_PROFILE_ID, LoadCalcEnvelopeError: V2.LoadCalcEnvelopeError,
  evaluatePreliminaryV2, PRELIMINARY_RESULT_KIND: B82.PRELIMINARY_KIND, PRELIMINARY_STATUS: B82.PRELIMINARY_STATUS,
};
