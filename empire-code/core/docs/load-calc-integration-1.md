# Load Calc — integration layer 1: pure V2 state and lcv-3 storage helpers (LC-22082-B0-STATE-STORE-1)

**Status (revision R1):** implemented and self-tested in an isolated sandbox on the accepted R3/133 core; V1–V3 review findings corrected. Not wired to the form, not registered in the application bundle, no real Favorites/localStorage writes, `opt_220_82` still disabled in the running application. The user's Mac stays on base124 / `EC-CALC-2-accepted.YNN5ep`.

Effective contract: INTEGRATION-SCOPE-1-R1 (state/store before UI) + CLOSE-1 (S1–S3) + CLOSE-2 (I1–I3), reviewed as STATE_STORE_SCOPE_ACCEPTED; premise/basis rules from PREMISES-1-R1 and R1-CLOSE-1 (decided by the accepted engine, never re-implemented here).

## 1. Files (this delivery adds exactly five; all 133 R3 files are byte-identical)

| Path | Role |
|---|---|
| `src/calc/loadCalcStateV2.js` | blank V2 draft, explicit-argument record construction, clone / basis change / answers / labels, deterministic A-adapter activity filter, canonical request projection |
| `src/calc/loadCalcStorageV2.js` | lcv-3 payload serialization / whole-wrapper validation / verbatim restore; stored-record classification; frozen A/lcv-2 descriptor assertion (I1); old validity → representability → candidate (I2); import provenance without method confirmation (I3) |
| `test/loadCalcStateV2.test.js`, `test/loadCalcStorageV2.test.js` | dedicated tests (`node --test`) |
| `docs/load-calc-integration-1.md` | this document |

**Validation order (V1/V2 R1, C1 R2).** Both modules share one original-input boundary, `validateDraftOriginal(draft)`, applied **before** any copy, edit or serialization: draft shape → JSON representability (cycles, non-plain objects, `undefined`, `NaN`, functions) → `validateSnapshotV2` (so `snapshot.loads` is a real record array before anything traverses it) → both unfiltered maps → **the whole original V2 envelope through the accepted public `validateRequestV2`** (fixed `apiVersion`/`profileId`, the original `context` and `snapshot`, and the unfiltered canonical projection of both maps). The last step closes C1: `context` is validated with the same authority as the rest, so the five editing helpers (`setLabel`, `setInclusionAnswer`, `setRatingCoverageAnswer`, `setInventoryAnswer`, `markBasisChanged`) refuse an original whose context is `null`, an array, `{}`, missing `methodConfirmedAfterImport` or `importedFrom`, wrongly typed, out of range (`lcv < 1`) or carrying unknown keys — with no candidate and no mutation. The context schema is not duplicated here, nothing is normalised, defaulted or stripped, and no method confirmation is required to edit: a valid imported context with `methodConfirmedAfterImport: false` is ordinary structural data and stays editable and savable. A standalone source record is checked by `validateStandaloneLoad` in a temporary valid container — its own shape, unchanged and unrepaired. Consequences: a malformed error submap (`null`, `7`, `[]`, `false`, …) is refused by the serializer, every setter and the projection alike — it is never copied to `{}` and reported as success; a non-plain `context` is refused, not flattened; a source record with `quantity: 0`, a null rating or an answered declaration without its basis is refused before cloning or re-answering (a clone still resets **valid** facts, but that reset is not a bypass); `newLoadRecord` closes the nested `rating` keys too. `validatePayloadV3` establishes every shape precondition before projection, so `snapshot: null|{}`, `loads: null|{}|[null]` and a missing `optional82` give a nonempty `string[]` and `{ok:false, problems}` instead of a `TypeError`; cycles are rejected by the representability boundary instead of a `RangeError`. Structurally valid unanswered, negative, stale and dormant data stay editable and savable; no `COMPLETE` precondition and no automatic deletion of legitimate raw errors were introduced.

**Owned path lists (V3, R1).** The layer keeps private frozen copies of the accepted R3 `SCALAR_PATHS` / `LOAD_FIELDS` (and the parser-code enum), captured once at module load and exported read-only as `OWNED_SCALAR_PATHS` / `OWNED_LOAD_FIELDS`. Map validation, serialization and request projection consult those copies, so a later addition to the shared exported `Set` cannot widen this layer. R3's exports are neither modified nor frozen. `FROZEN_A_LCV2` (I1) keeps its separate ownership unchanged.

Neither module touches the DOM, `localStorage`, the network, `Date`/`Math.random`, or any caller object. Both reuse public R3/A boundaries only: `loadCalcState.createEmptySnapshot` / `migrateLegacyRecord`, `loadCalcInput.validateSnapshot` / `jsonRepresentabilityErrors` / `ENUMS`, `loadCalcInputV2.validateSnapshotV2` / `validateRequestV2` / `SCALAR_PATHS` / `LOAD_FIELDS` / identities.

## 2. Shapes

**Draft** `{ snapshot (3.3.0), context, fieldErrors, loadErrors, sourceFavId }` — `fieldErrors` keyed by canonical scalar paths (`SCALAR_PATHS`), `loadErrors` keyed by stable load ids with `LOAD_FIELDS` subkeys; entries `{raw:string, code:<parseCode>[, badInput:true]}`; maps are prototype-free own-key dictionaries (`'__proto__'`/`'constructor'` are data). `sourceFavId` (`null | finite number | string`) is storage metadata only and never enters a request.

**Blank draft** = accepted P-5 empty A snapshot lifted to 3.3.0 (purpose `service`, rule basis unchanged), five unconfirmed `optional82` declarations (`{value:null, provenance:{source:'designer_declaration', note:null}}`; inventory additionally `basis:null`), `loads: []`, empty maps, `context {importedFrom:null, methodConfirmedAfterImport:false}`, `sourceFavId:null`. No seeded records.

**Record (S1)** `newLoadRecord({id, basisId, rating:{kind:'va', value ≥ 0, volts}, quantity ≥ 1[, label, category, status]})` → the exact R3 record shape; category unanswered ⇒ `classification:'required'`; only actually nullable fields are `null`; an explicit `0` is data; a missing rating/quantity is `{ok:false}`.

**lcv-3 payload** `{lcv:3, capabilityProfile:'AB82_core1', context, snapshot, fieldErrors, loadErrors, sourceFavId}` — nothing else (no result, no facade, no overflow container). A draft with the A method selected is stored as-is (82 data not stripped).

## 3. Helper contracts

| Helper | Returns |
|---|---|
| `createEmptyDraftV2()` | draft |
| `newLoadRecord(args)`, `cloneLoadRecord(load, {id, basisId})` | `{ok:true, load}` \| `{ok:false, problems}` — clone copies data, never premise facts |
| `markBasisChanged(draft, loadId, {basisId})` | new draft; only the identified basis changes, stored facts stay (R3 reports `PREMISE_STALE` for either polarity); collisions/same basis refused |
| `setInclusionAnswer(draft, loadId, answer\|null)` | dryer predicate `b3c_…` (`not_on_counted_laundry_circuit` \| `on_counted_laundry_circuit`); dishwasher / appliance_fixed_other predicate `b3a_…` (`fixed_or_permanently_connected` \| `specific_circuit` \| `on_counted_b2_circuit` \| `none_of_these`); basis `{basisId, category, quantity}` captured at answer time; `null` → `{predicate, answer:null, basis:null}` |
| `setRatingCoverageAnswer(draft, loadId, bool\|null)` | `ac` only; basis `{basisId, category:'ac', quantity, rating:{kind, value}}` (one system; several units are separate records — I-82-5 stays with the engine) |
| `setInventoryAnswer(draft, bool\|null)` | captures `basis.members = [{id, basisId, category, quantity}]` sorted by id |
| `setLabel(draft, loadId, text)` | presentation only |
| `activeAPaths(snapshot)` | the accepted `lcFieldActive` policy (mobile.html 9727–9741) as a pure function: measurement paths active only on `measured_220_87` with a measurement, by mode/basis/unit/scope/purpose; all other paths active |
| `toRequestV2(draft)` | validates the FULL draft (shape, representability, snapshot, both maps incl. dormant entries, unfiltered request), then projects: on the 82 route every canonical error is carried (the engine decides activity); on other routes the A filter applies; indices derived from current record order; sorted by field; `sourceFavId` excluded |
| `toPayloadV3(draft)` / `validatePayloadV3(payload)` / `restorePayloadV3(payload)` | lossless; validation covers wrapper keys, identities, `sourceFavId`, maps, context and snapshot through the public V2 request validator with an unfiltered error projection |
| `classifyStoredRecord(vals)` | `'legacy'` (no own `lcv`), `'lcv2'`, `'lcv3'`, `'unknown'` (incl. `lcv:1`) |
| `upgradeToDraftV2(vals, {expectKind?, legacyContract, basisIdByLoadId, sourceFavId})` | see §4 |

## 4. Import boundary (I1–I3)

1. **I1** `FROZEN_A_LCV2` (34 field paths incl. the literal `loads[].rating.value` / `loads[].quantity`, 2 load subfields, profile `A_measured_87_core`) is a trusted immutable copy of the OLD interface constants. `opts.legacyContract` must contain exactly the same unique string members (order irrelevant) and the same profile; extra/missing/duplicate/non-string/profile mismatch refuses before any import. Old validity is always judged against the trusted descriptor.
2. **I2** classify the OWN `lcv` key (an `expectKind` mismatch refuses; it never selects a weaker validator; `lcv:3` is refused with "use restore"). Validate the old format under its real boundary (`validateLcv2`: keys, profile, `sourceFavId`, A `validateSnapshot`, unique ids, old map allowlists; legacy: `migrateLegacyRecord` + `validateSnapshot`, `LegacyRecordError` named). Then check the basis allocation (`basisIdByLoadId` must cover exactly the source records with unique non-empty ids). Then representability: an old-valid `fieldErrors['loads[].quantity']` or `['loads[].rating.value']` cannot be attributed to a record → `{ok:false}` naming the exact old path (not "invalid lcv-2", not dropped, not attached to any load). Then the candidate is built (snapshot lifted to 3.3.0, unconfirmed `optional82`, fresh `basisId`, unconfirmed facts, old maps copied) and validated via `toPayloadV3` before `{ok:true, draft, notes}`.
3. **I3** `context.importedFrom` = `{lcv:2, profileId:'A_measured_87_core', schemaVersion:'3.2.1'}` for lcv-2 (sourceFavId copied from the old payload) or `{lcv:1, profileId:'legacy_pre_lcv_favorite', schemaVersion:'unversioned'}` for legacy (sourceFavId from `opts.sourceFavId`); `methodConfirmedAfterImport:false` always, including when the source already selects `opt_220_82`. Only a later explicit manual reselection (a UI action outside this layer, represented in tests as data) may set `true`; lcv-3 restore preserves the stored flag verbatim. No operation confirms premises, source rules or capability.

The existing adapter (`lcFavRestore`, `lcFavValidatePayload`, `LC_FIELDS`, `LC_LOAD_SUBFIELDS`) is unchanged; its lcv-2 behaviour (including `LC.sourceFavId = null` on lcv-2 restore) is not altered by this layer.

## 5. Deferred to the UI + bundle delivery

Form controls (incl. real controls for `dwelling.floorAreaFt2` / `smallApplianceCircuits` / `laundryCircuits` / `nycAcCircuitCount`, premise questions, the "equipment/circuit changed" action, method reselection), `lcUpdate` routing through `evaluateV2`, Save/Restore wiring to lcv-3 with lcv-2/A preserved, registration of the V2 modules in `tools/build-calc.js` and bundle regeneration, result rendering of the five families with coverage, and the split of `LC_PROFILE_ID`. Release, installation and activation remain separately unauthorized.
