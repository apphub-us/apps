# Load Calc — Contract addendum for the isolated 220.82 core (engine `B82_core1`, delivery LC-22082-B0-CORE-1, revision R3)

**Status:** implemented and self-tested in an isolated sandbox; **not** integrated, **not** registered in the application build, **not** activated (`opt_220_82` remains disabled in the accepted base124), **not** accepted, **not** released. This addendum documents the interfaces and constraints as implemented and traces them to the settled clauses. It does not rewrite the historical specifications (SPEC-R1/R2, CLOSE-1/2, ERRATA-1/1a, SOURCE-1, PREMISES-1/R1/R1-CLOSE-1, CORE-SCOPE-1/CLOSE-1, DECISION-1), which remain the authority; where they differ from this text the clause supersessions recorded in those documents apply.

The accepted A contract (`docs/load-calc-contract.md` v3.2.2, schema r21, cases r22, profile `A_measured_87_core`) is unchanged and untouched.

## 1. Files (allowlist of this delivery)

| Path | Role | Traceability |
|---|---|---|
| `src/calc/loadCalcInputV2.js` | V2 request/envelope structural validator (L2), E4 encoding, canonical projection/display, down-conversion to an A envelope | R2 §2.1–§2.3; R2-CLOSE-1 §2; R2-CLOSE-2 §2.1, §4.1; PREMISES-1 §3; PREMISES-1-R1 §3–§4A |
| `src/calc/loadCalcOpt82.js` | engine `evaluate82`, `PROFILE_82`, engine-owned `RULE_STATUS`, stages 1–3, families, typed graph, coverage, `TEST_ONLY` evaluator factory | R2 §2.7; R2-CLOSE-1 §3, §4.2; R2-CLOSE-2 §2.2, §3.1, §4.2; ERRATA-1 §2 + ERRATA-1a; PREMISES-1 §4; R1 §2–§4; R1-CLOSE-1 §2–§4; DECISION-1; CORE-1 §4E |
| `src/calc/loadCalcFacade.js` | `evaluateV2` dispatch: `opt_220_82` → B82; otherwise down-converted COPY → unchanged `evaluate` (A) | R2 §2.1–§2.2; CORE-SCOPE-1 CLOSE-1 §4 |
| `test/fixtures/loadCalc/LC82-cases-r1.json` | 148 cases (30 L2, 118 semantic) with hand-derived expectations; B0-P from CORE-SCOPE-1 §3 unchanged as input | CORE-1 §5; R1/R2 regressions |
| `test/fixtures/loadCalc/EC-CALC-2-B82-schema-r1.json` | draft-2020-12 shapes for the V2 request and the B82 result (derived from the r21 shapes, extended); structural only | R2 §2.1; R2-CLOSE-2 §2.2 (binding roles); ERRATA-1a |
| `tools/contract_invariants_82.py` | independent Python checker (request AND result): stage-1 re-derivation, family/status/layer coupling, bindings, exact E4 recomputation, edges/cardinalities/roots, coverage completeness; `--mutants` mode | R2-CLOSE-1 §3.3; R2-CLOSE-2 §2.2; ERRATA-1 §2.1–§2.2 + ERRATA-1a; CORE-1 §5 |
| `test/loadCalc82.test.js`, `test/loadCalcFacade.test.js` | dedicated tests (fixtures, E4 witnesses, checker/schema child processes, facade partitions) | CORE-1 §5 |

Nothing in `tools/build-calc.js` (explicit `MODULES` list), `mobile.html`, `sw.js`, persistence or the editor references the new modules.

## 2. Request and envelopes

```
V2 request  = { apiVersion: 2, profileId: 'AB82_core1', context: { importedFrom: null | {lcv, profileId, schemaVersion}, methodConfirmedAfterImport: boolean }, parseErrors: [{field, raw, code}], snapshot }
snapshot    = A snapshot shape (r21) with schemaVersion '3.3.0', plus optional82 and three per-load fields (basisId, inclusion82, ratingCoverage82)
envelope82  = { snapshot, parseErrors, profileId: 'B82_core1', context }        (built by the facade on a COPY)
A envelope  = { snapshot (3.2.1, 82-only keys removed), parseErrors (82-only paths removed), profileId: 'A_measured_87_core' }   (COPY; never the original)
```

`profileId` values are identity checks (`AB82_core1` for the capability/API profile, `B82_core1` for the engine, `A_measured_87_core` for A); a request cannot select a profile or enable a method/arrangement. `context` is the only source of the import guard; no draft or global state is read.

**L2 (structural, `LoadCalcEnvelopeError`, no result):** JSON-representability (as A), the bounded spec mini-language mirrored from A for every shared field (differential check: identical verdicts on all 129 r22 snapshots), supply coupling, plus: `apiVersion` const 2; `profileId` enum; `context` shape; `schemaVersion` const `3.3.0`; `optional82` object with `singleSupplySet`/`nycAcCentralExceptionAttested`/`laundryExceptionAttested` (declBool), `conductorAmpacityA` (declared number), `inventoryComplete` = always an object `{value, provenance, basis}`; `basisId` non-empty string; `inclusion82` = `null | {predicate, answer, basis}`; `ratingCoverage82` = `null | {value, basis}`; an answered declaration (`answer`/`value` non-null — `false` is an answer) requires a basis object; `parseErrors[].field` must be a canonical V2 path: an exact member of the closed path set (`SCALAR_PATHS`, which includes every scalar key of the accepted `LC_FIELDS` map — `method.guideAnswers.houseFeeder/aptFeeder/houseState/bldgCooking` included, R2/N2a) or `loads[N].<field>` with a canonical decimal index that resolves to a record of this snapshot and a known load field (`LOAD_FIELDS`) — no prefix matching, no path execution; known fields under a still-null parent (`measurement.*`, `multifamily.*`) stay legal. `optional82.*` declarations (`singleSupplySet`, `conductorAmpacityA`, `nycAcCentralExceptionAttested`, `laundryExceptionAttested`, `inventoryComplete`) require `provenance.source` at this boundary (R2 §2.3 'provenance: required'; PREMISES-R1 §4A) — **enforced identically in the JS validator, the JSON schema (`declaredBool82`/`declaredNumber`/`inventoryComplete`) and the checker's own derivation (R2/N1)**, so an L2-invalid request can never form an accepted pair; the shared A shapes (`loadModel.declarations.*`, `hvac.*`) keep provenance optional at L2 exactly as A. This alignment is claimed for these five named positions, not as a general JS↔schema equivalence. Dormant data is validated structurally like everything else.

## 3. Engine-owned constants (`PROFILE_82`, frozen)

| Key | Value | Clause |
|---|---|---|
| `enabledMethods` | `['opt_220_82']` | R2 §2.1 |
| `enabledArrangements` | `['ac_only']` — first-delivery limit, not a normative statement | DECISION-1 |
| `enabledModels` | `['split_240_balanced_LN']` (current only on `1ph_3w_120_240` with `balancedLN = true`) | R2 §2.3; CORE-1 §4E |
| `supportedTopologies` | `1ph_3w_120_240`, `1ph_3w_120_208_network` (220.82(A): one 3-wire set) | SOURCE-1 §2 |
| `bGroup` | range, oven, cooktop, dryer, water_heater, dishwasher, appliance_fixed_other | SOURCE-1 §1 (B)(3) |
| `ruleStatus` | `220.82: verified`, `S-11a: verified` (observed NEC-2020 text E-01/E-02/E-03, SOURCE-1 — a descriptive evidence status reflected here as the engine constant of this isolated core), `I-82-1…5: pending` | SOURCE-1; R2-CLOSE-2 §3.1 |

`TEST_ONLY.createPendingSourceEvaluator(config)` (**R1/M4**) builds an evaluator for the hypothetical pending-source fixtures (LC82-14/14b/16a); `config` may only map `'220.82'`/`'S-11a'` to `'pending'` — it can never promote I-82-1…5 (or anything) to `verified`, rejects any other key/value, is not reachable from request data and is not used by the facade. The checker validates the same contract on fixture `assumptions.engineRuleStatus`.

## 4. Stage 1 (input layer) — every check evaluated independently, all problems collected

| Check | Problem (field) | Notes |
|---|---|---|
| parser transport (**R1/M2**) | an entry is ACTIVE only when its path belongs to a slot the current method/category requires: `measurement.*`/`multifamily.*` never (outside the 82 active set); `loads[i].inclusion82` only for dryer/dishwasher/appliance_fixed_other and only when no retained fact carries a different (old) predicate; `loads[i].ratingCoverage82` only for `ac`; `loads[i].separatelyControlledUnits` only for `electric_space_heat`; **`hvac.supplementalInterlocked` only when `hvac.arrangement = heat_pump_with_supplemental`, `hvac.installingAdditionalHvac` never (retained 220.83 datum, unused by this slice), `method.guideAnswers.*` never (A guide data) — R2/N2b**; all other paths always. Active entries are re-emitted with `source: 'parser'` and suppress the same-path engine check; dormant entries stay in the request, are never emitted and never suppress | PREMISES-R1-CLOSE-1 §3–4; R2 §2.3 active set; R2-CLOSE-2 §4.2 |
| method | ≠ `opt_220_82` → `CAPABILITY_DISABLED(method.selected)` (defensive; the facade never routes such requests here) | R2 §2.1 |
| occupancy | null → `MISSING_FIELD`; not house/apartment → `SCOPE_UNSUPPORTED` | R2 §2.3 |
| source gates | `RULE_PENDING(method.selected)` unless `220.82` verified; `RULE_PENDING(dwelling.smallApplianceCircuits)` unless `S-11a` verified | R2-CLOSE-2 §3.1 |
| arrangement (DECISION-1) | null → `MISSING_FIELD`; not `ac_only` → `CAPABILITY_DISABLED(hvac.arrangement)`; skipped under an active parser error on the field | DECISION-1 |
| **R1/M1a** required A/C record | a known `ac_only` with **no** `ac` record (and no parser-blocked category) → `HVAC_ARRANGEMENT_INCONSISTENT(hvac.arrangement)` (INVALID, cleared layers); never an implicit `none`, never a zero A/C; a `null` or parser-blocked arrangement does not trigger it; the multi-unit rule (I-82-5) is unchanged | CORE-SCOPE-1 §1 (exactly one ac record ×1); DECISION-1 |
| **R1/M1b** leg/connection | retained table (contract §4, A `connectionValidity`): leg named on a 2-wire supply or `L3` on a 1-φ topology → `LEG_INVALID(loads[i].leg)`; `LN` without neutral or `3PH` on a non-3-φ topology → `CONNECTION_INVALID(loads[i].connection)`; null connection/leg valid; parser-blocked values skipped | contract §4; SPEC-R2-CLOSE-1 §4.2 |
| **R1/M1c + R2/N2b** provenance on shared declarations | an answered `hvac.supplementalInterlocked` without `provenance.source` → `MISSING_FIELD(hvac.supplementalInterlocked.provenance)` (L3, because the A shape stays unchanged at L2) **only when the arrangement is `heat_pump_with_supplemental`**; under any other arrangement the declaration is dormant: stored, inactive, never blocking. `loadModel.declarations.balancedLN` is A's current-layer declaration and keeps the A rule (provenance optional) | R2 §2.3 (applicability); retained SPEC-R1 active-field table; contract §5 |
| 220.82(A) qualification | topology null → `QUALIFICATION_UNKNOWN`, `other` → `SCOPE_UNSUPPORTED`, unsupported → `QUALIFICATION_FAILED`; `singleSupplySet` null/false; `conductorAmpacityA` null → unknown, `< 100 A` → failed (conductor-ampacity qualification only) | SOURCE-1 §2 |
| dwelling | area: null/`NOT_INTEGER`/`OUT_OF_RANGE` (1…1e6); SA: null, `< 2` → `OUT_OF_RANGE` (cited 210.11(C)(1)), `> 100`; laundry: null, 0…100, `0` → `RULE_PENDING` (I-82-2); nycAc: null, 0…100, `> 0` or `0` without attestation → `RULE_PENDING` (I-82-1) | R2-CLOSE-1 §2; R2-CLOSE-2 §3.1 |
| loads | `> 200` → `OUT_OF_RANGE(loads)`; `DUPLICATE_ID`; `rating.kind ≠ va` → `UNSUPPORTED_RATING_KIND`; `encodeE4(rating.value)` → `RESOLUTION_EXCEEDED` / `OUT_OF_RANGE`; `quantity > 100`; category null → `MISSING_FIELD`; `motor` → `RULE_PENDING` (I-82-4); heat-pump/heating categories under `ac_only` → `HVAC_ARRANGEMENT_INCONSISTENT`; Σ quantity of `ac` records `> 1` → `RULE_PENDING(hvac.arrangement)` (I-82-5) | R2-CLOSE-1 §2.6; R2-CLOSE-2 §3.1 |
| premises (per slot, in order) | required from the CURRENT category only: `inclusion82` for dryer/dishwasher/appliance_fixed_other (expected predicate by category), `ratingCoverage82` for `ac`, `inventoryComplete` always. Order: parser error → `MISSING_FIELD` (null, unconfirmed object, wrong predicate) → `PREMISE_STALE` (basis ≠ current `{basisId, category, quantity[, rating]}` / members) → meaning (negative answers become demand-stage reasons) | PREMISES-1-R1 §2–§3; R1-CLOSE-1 §2–§4 |
| inventory | `INVENTORY_INCOMPLETE_DECLARED` on a fresh `false` | PREMISES-1 §4 |
| import guard | `importedFrom` set and not confirmed → `IMPORTED_METHOD_UNCONFIRMED(method.selected)`; confirmation certifies no premise | R2 §2.2; PREMISES-1 §7 |
| interlocked heat pump | `heat_pump_with_supplemental` + `supplementalInterlocked = true` → `RULE_PENDING` (I-82-3) — collected alongside the capability problem | DECISION-1 |

Precedence (R2 §2.7, contract §9.1 order): UNSUPPORTED_SCOPE (`SCOPE_UNSUPPORTED`, `CAPABILITY_DISABLED`) > BLOCKED_PENDING_RULE (`RULE_PENDING`) > INVALID_INPUT (A's invalid set + `DUPLICATE_ID`, `RESOLUTION_EXCEEDED`, `HVAC_ARRANGEMENT_INCONSISTENT`) > INCOMPLETE_INPUT (`MISSING_FIELD`, `QUALIFICATION_UNKNOWN`, `PREMISE_STALE`, `INVENTORY_INCOMPLETE_DECLARED`, `IMPORTED_METHOD_UNCONFIRMED`) > UNQUALIFIED_METHOD (`QUALIFICATION_FAILED`) > PARTIAL > COMPLETE. Any blocking rank clears every layer (`lines: []`, no totals, no current) and every load is `unresolved(<determining code>)`. Problems are sorted by `(code, field)`.

## 5. Numeric policy (implemented)

`encodeE4(x)`: shortest round-trip decimal of the request number (`String(x)`, exponent normalised) → `OUT_OF_RANGE` (negative, `> 1e6`), `RESOLUTION_EXCEEDED` (> 2 fractional digits) → exact integer `int × 10⁴ + frac`. Never `x × 10000`. All operative quantities are safe integers (`safe()` guards; domain bound 4.00033·10¹⁴ < 2⁵³). Percent operands are multiples of 100 E4 units (asserted). `value` fields, `connectedVA`, `totalVA`, `partialSubtotalVA` are `Number(canonicalDecimal(n))` projections; display strings are formatted from the integer (`displayVA`), current from the projected total with A's `formatNumber` (display layer only). (R2-CLOSE-1 §2, R2-CLOSE-2 §2.1)

## 6. Stage 2 — families, graph, coverage (ERRATA-1 §2.1 + ERRATA-1a)

| Family | Lines | Bindings | Coverage |
|---|---|---|---|
| COMPLETE (always has the A/C candidate: `ac_only` requires exactly one `ac` record — R1/M1a) | `b1_area`, `b2_circuits`, [`b3_appliances`], `gen_connected`, `gen_tier1`, `gen_excess`, `gen_tier2`, `gen_demand`, `ac_connected`, `c1_ac`, `hvac_governing`, `total` (`sum`; no identity fallback) | `area` ×1, `count` ×2, `va` exactly 1 per load | all `counted`; AC: `candidate 'c1_ac'`, `governing true`, `demandVA = connectedVA` |
| PARTIAL with subtotal (all B-group records resolved) | chain to `gen_demand` only; `partialSubtotalVA = gen_demand` | `area`, `count`, `va` for counted B records; no HVAC bindings | B records `counted`; AC `unresolved(HVAC_WITHHELD_PARTIAL)` with `connectedVA`; evse/other `unresolved(CATEGORY_UNSUPPORTED_IN_METHOD)`; negative premise reasons `AC_RATING_INCOMPLETE` / `CIRCUIT_BASIS_UNSUPPORTED` / `INCLUSION_BASIS_UNSUPPORTED` |
| PARTIAL without subtotal (a B-group record unresolved) | none | none | every load `unresolved` (B records `GENERAL_WITHHELD_PARTIAL`, AC `HVAC_WITHHELD_PARTIAL`, `CLASSIFICATION_REQUIRED`, …) |
| cleared | none | none | every load `unresolved(<determining code>)` |

Each unresolved coverage entry has a demand-layer `LOAD_UNRESOLVED(loads[i])`; `classification: required` additionally emits `CLASSIFICATION_REQUIRED`. Reviewer clarification implemented: B0-P + EVSE gives **two** `LOAD_UNRESOLVED` problems (EVSE and the withheld AC). Ops: `multiply_unit` (b1, b2 with `unitFactor`), `sum`, `min_cap`/`excess_over` (threshold 10 kVA), `multiply_percent` (single `ref` operand), `max_of` (`selected`). `identity` is no longer produced by any family (the former no-A/C total path is unreachable — R1/M1a). `c1_ac` consumes `ac_connected`; `gen_connected` has exactly two consumers; `total` none.

## 7. Stage 3 — current (only after COMPLETE)

`loadModel.kind` null → `MODEL_NOT_SELECTED`; kind not `split_240_balanced_LN` or topology not `1ph_3w_120_240` → `MODEL_UNSUPPORTED`; `balancedLN ≠ true` → `MODEL_DECLARATION_MISSING`; otherwise `I = totalVA / 240` (binary64), `perConductorA {L1, L2, L3: null}`, `neutralA: null`. `existingCapacity`, `requiredCapacity`, `rating` are always `not_assessed` (blocking code `COMPARISON_NOT_SUPPORTED` when demand exists, else the determining code). No neutral, no adequacy, no rating, no Wire Sizer handoff.

## 8. Facade partitions

1. Direct A vs frozen r22: untouched (`tools/loadcalc-core-check.js`: 125 exact + the three permitted `diagnostics.continuityOfNewLoadKnown` differences).
2. Facade-delegated A: `response.result` byte-equivalent to the direct A result of the down-converted envelope for every r22 envelope with `method ≠ opt_220_82` (110 compared), including the EMPTY case; the metadata (`facade.engine`, `engineProfileId`, `engineRuleStatus`, `importGuard`) is outside `result`.
3. Explicit 82: `LC82-cases-r1` expectations; the ten historical disabled-82 r22 envelopes are routed to `B82_core1` and never compared with their old outputs.

## 8a. Purpose (`snapshot.purpose`) — disposition (R1)

No effective clause makes `purpose` a required input on the 82 route: SPEC-R1 (retained scope clause) says "purpose `service` or `feeder` (both allowed; affects nothing in the slice)", and contract §9.2 lists the fields required for all methods (occupancy, supply.topology, loadModel.kind, method.selected) without `purpose`. The engine therefore does not emit a problem for `purpose: null` (fixture `LC82-R1-purpose-null-disposition`). Whether a final result heading should wait for a purpose selection is an open **product** question for the owner; it is recorded here, not decided, and no global A requirement was added.

## 8b. Checker (R1/M3)

`tools/contract_invariants_82.py` derives every expectation from the request: full request/result shape via the B82 schema (inherited subset validator), canonical parse-error paths, stage-1 problems (incl. M1/M2 rules), family and status, whole coverage objects and demand-layer problems, and the graph from fixed **role templates** (`ROLES`: op, percent, threshold, unit factor, ruleRef, predecessor edges, permitted record categories). Bindings are compared as complete sets in both directions (missing/extra/duplicate/orphan/wrong record/wrong kind), operands as exact lists, totals/current/diagnostics/display/presentation/capacity/rating/references per family without early return. The submitted percent/threshold/factor/status fields are never used as authority, so coherently recomputed wrong-rule results (41 %, 20 kVA threshold, category swaps, unit-factor changes, missing-AC-as-none, dormant-error-treated-active, escalating test configurations) are rejected. `--mutants` exercises both locally inconsistent and coherent corruptions.

**R2/N3 — derived display and contractual metadata.** `display.strings.lineA` is recomputed from the EXPECTED raw current with an independent re-implementation of the accepted A display policy (shortest decimal, round half away from zero to one decimal, thousands grouped; `loadCalc.js formatNumber` ~123–150 is a read-only semantic reference, never imported or invoked); `totalVA`/`generalDemandVA` likewise from the exact integers. `presentation` (`topologyLabel`, `showPerConductor`, `polesLabel`, `finalResultHeading`, `verdictLabel`) is derived from the request supply/model/family. `references` are compared as complete objects (`ruleRef`, `amended`, `href`), including the conditional `220.14(N)` entry and the absence of extra entries. Problems are compared as **complete identity multisets per layer** (R3/Q2): each derived cause yields `(code, field, layer, source, ruleRef)` and the checker compares missing **and** extra entries across `input`, `demand`, `current` and `capacity` — not code sets or enum membership. Consequences: a current-layer problem carrying the wrong field or a `parser` source is rejected; a duplicated copy of one cause is rejected; a dropped demand-layer `LOAD_UNRESOLVED` is rejected; no `capacity`-layer problem is admissible in this delivery (`existingCapacity.blockingCode` is a separate field); no current-layer problem may appear before a complete demand; two genuinely distinct causes on one field (e.g. an active parser `OUT_OF_RANGE` plus an engine `RULE_PENDING`) must both be present with their own source and citation.

**R3/Q1 — the expected `ruleRef` follows the derived cause, not `(code, field)`.** On `dwelling.smallApplianceCircuits`: an engine value `< 2` is the source-cited minimum → `210.11(C)(1)`; an engine value `> 100` is the product numeric-domain maximum → `ruleRef null`; an active parser `OUT_OF_RANGE` is a transported failure → `source: 'parser'`, `ruleRef null`, and the retained request value is never reinterpreted as the suppressed engine minimum. Citations for the remaining causes are unchanged (`RULE_PENDING`/`QUALIFICATION_*` map, `220.82(B)(4)` for motor categories); everything else is `null` by contract. The engine annotations were not modified in R3 — only the checker's derivation.

**Not claimed as checked:** the free prose of `problem.message`, line `label` text and `current.note`/`formula` wording — only their presence/type is asserted. `field`, `layer`, `source` and `ruleRef` are structural contract fields and are compared exactly.

## 9. Deferred (not implemented, by design)

Arrangements `none`, heat pumps, `electric_space_heat`, `thermal_storage`, `mixed_unknown` (capability-disabled with their pending problems still collected); motors, multi-unit A/C, laundry 0, positive NYC A/C-circuit counts (pending source interpretations I-82-1…5); EVSE/other (unresolved coverage); heating/heat-pump candidate arithmetic (`count_sum`, c2–c5) — the schema reserves the `control` binding kind and `count_sum` op without engine support; editor/persistence (lcv-3), clone/import UI, `basisId` generation, app build registration, activation.
