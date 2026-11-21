# EC-CALC-2 / Phase A3 (r2.2) — Load Calc Contract v3.2, r2.1 closure + r2.2 graph completeness (consolidated, self-contained)

**Label: ASTRA REQUIRED. Contract / specification only. No engine exists; nothing in this document or its companion files is an executed engine test. No implementation authorization.**
**Rule basis:** NFPA 70-2020 as adopted by New York City with the NYC 2025 amendments (NYCEC 2025, in effect 2025-12-21). No later NEC edition is imported (220.57 is a 2023 section and is excluded).
**Supersedes for implementation purposes:** `EC-CALC-2-A3-contract-v3.2.md` (r2), `EC-CALC-2-A3-contract-v3.1.md`, `EC-CALC-2-A3-contract-v3.md` (all kept unchanged as history). Companion files of the same revision: `EC-CALC-2-A3-schema-r21.json` (**unchanged** in r2.2), `EC-CALC-2-A3-test-cases-r22.json`, `contract_invariants_r22.py` (L4), `operative_graph_review.py` (reviewer's review-only cross-check, unchanged), `mini_jsonschema_r2.py` (unchanged), `closure_r22.py`, `EC-CALC-2-A3-r2.2-errata.md` (the explicit delta from v3.2.1), `EC-CALC-2-A3-r2.2-dispositions.md`, `r22-reconciliation.json`. Historical: `EC-CALC-2-A3-contract-v3.2.1.md`, `-v3.2.md`, `-v3.1.md`, `-v3.md`.
**Product decisions:** P-1 (scope A), P-3 (save-as-copy migration), P-5 (empty init/reset), P-10 (variant B) are the **proposed target** recommended by the reviewer and adopted by this document as the specification target. They are **not** recorded owner approval; implementation requires the owner's confirmation of the scope.

---

## 1. Scope and capability profile

### 1.1 What this contract covers
The Load Calc subpanel of `mobile.html` (pinned `06ea2b8d…4bf9`) evaluated as a pure engine `evaluate(RequestEnvelope) → LoadCalcResult` behind a form adapter, with Favorites migration and persistence rules. The only **active** computation is **NEC 220.87 as revised by NYC 2025** with a new-load term that is either absent or supplied by the user as an already-established value. Revision r2.1 closes R-R2-01 (request binding), R-R2-02 (aggregate validity), R-R2-03 (empty/malformed active fields) and R-R2-04 (amperes-path table); revision r2.2 closes the remaining R-R2-01 item (operative graph completeness, I-21) and reconciles the T-N-17 fixture with the §7.4 unityPF condition — without changing the profile, the schema, the rating layer or the Wire Sizer integration. Every other method exists in the data model (retained data, deterministic "unavailable" result) but computes nothing.

### 1.2 Capability profile `A_measured_87_core` (engine-owned constant; echoed as `profileId`)
| Key | Value |
|---|---|
| enabledMethods | `measured_220_87` |
| enabledNewLoadModes | `none`, `precalculated` |
| enabledModels | `single_2w`, `split_240_all_LL`, `split_240_balanced_LN`, `split_240_declared_legs`, `network_208_all_LL`, `network_208_balanced_LN`, `three_phase_balanced` |
| amperes-path term combinations (§7.4) | split-phase: `none`, `LL`, `LN` (with per-conductor readings); 3-phase: `none`, balanced `3PH`; 120/208 network: `none` only |
| comparisonPolicy | `raw_conservative` (§7) |
| codeRounding | `null` (no NEC 220.5(B)-style rounding adopted; §7.3) |
| upperBoundScreening | `false` (§7.5) |
| autoHandoff (Wire Sizer) | `false` (§10.2) |
| autoRating | `false` (§10.1) |
| displayPrecision (default) | amps 1, VA 0 (§8) |

**Two distinct gates.** (a) *Profile gating* (method, new-load mode, amperes-path term combination): anything outside the profile yields `UNSUPPORTED_SCOPE` with problem `CAPABILITY_DISABLED` — data retained, no layer computed. (b) *Current-model availability* (§5): a supply/model/term combination the current model cannot represent yields `MODEL_UNSUPPORTED` or `MODEL_DECLARATION_MISSING` in the **current layer** only — the demand may remain complete (`COMPLETE` with `current.not_computed`, `existingCapacity.not_assessed`) and is never deleted (T-S-19, T-S-43). Profile constants, rule statuses (`verified`/`pending`), the preset map, the topology table and the model table are **engine-owned**; the input schema has no field for any of them, so a user cannot bypass a gate by supplying a flag.

Future profiles named in this document (not enabled, not approved): **A+** = `from_loads` for multifamily electric cooking per the DOB ECRIC 2025 example (T-N-03); **A_opt_bound** = optional upper-bound screening (§7.5); **B** = 220.82 / 220.83 / 220.84 / Standard Part III (pending base-NEC text).

## 2. Validation layers and the parser boundary

| Layer | Component | Rejects with | Tested by |
|---|---|---|---|
| L1 Ingress | strict JSON parse (`load_strict`): rejects the non-JSON tokens `NaN`, `Infinity`, `-Infinity`, duplicate keys, non-object roots. Such tokens are never valid snapshot values. | `PARSE_REJECTED` (no snapshot built, engine not called) | T-S-37 |
| L2 Structure | JSON Schema r21 (draft 2020-12) — shape, enums, and **simple state couplings** (§9.4) incl. the topology→voltage/phase/wire coupling | schema errors (request or result invalid) | every literal envelope/snapshot/result in the cases; mutants-r2-on-r21 |
| L3 Semantics | engine input rules producing problem codes (§9.2): supply/leg/connection consistency, method-specific required fields, qualification attestations, coverage, association, basis, duplicate ids, parse errors re-emitted | `problems[]` with `layer` | T-S-34, T-S-35, T-S-41/42, T-S-44, T-N-* (**specified**; the engine does not exist, so no L3 rejection has been executed) |
| L4 Invariants | `contract_invariants_r22.py` on (envelope, result) pairs: exact typed-line arithmetic, status/layer couplings, raw comparisons, display derivation, **request binding** (I-14…I-20), **operative graph completeness** (I-21), coverage-snapshot staleness, association rules, profile gating | list of violations | all expected results (128 incl. post-action); `closure-r22.json` (four reviewer graph pairs); `negative-pairs-r22.json`; `mutants-r2-on-r22.json` |

**Parser boundary (adapter) — ONE transport for empty/malformed fields (R-R2-03).** The DOM is read only by the adapter. For every form field the adapter writes a typed value **or `null`** into the draft snapshot and, for each field it could not parse, appends `parseErrors[] = {field, raw, code}` with `code ∈ {NOT_FINITE, NOT_INTEGER, OUT_OF_RANGE, UNKNOWN_ENUM, MISSING_FIELD}`. This applies to every numeric field of the active profile — in particular `measurement.reading.value` and `measurement.newLoad.precalculated.va` are `number | null` in schema r21. Rules: a blank entry is `null` + `MISSING_FIELD`; an unparsable entry is `null` + `NOT_FINITE` (or `NOT_INTEGER` for integer fields); the adapter **never** coerces blank to `0` and **never** keeps the previous numeric value; a corrected entry replaces `null` and removes the parse error (T-S-41a/b/c, T-S-42a/b/c, T-S-10a/b/c, T-S-36). The engine receives the **RequestEnvelope** `{snapshot, parseErrors, profileId}` and is a pure function of it: identical snapshots with different `parseErrors` are different requests. Every parse error is re-emitted as an input-layer problem with `source: "parser"`; a semantic `MISSING_FIELD` for the same field is not duplicated. Parse errors always block demand computation (invariant I-20).

**Determinism.** Same envelope ⇒ same result, byte for byte; `problems[]` sorted by `(code, field)` (T-S-30).

## 3. Enumerations (closed)

* `status`: `EMPTY`, `UNSUPPORTED_SCOPE`, `BLOCKED_PENDING_RULE`, `INVALID_INPUT`, `INCOMPLETE_INPUT`, `UNQUALIFIED_METHOD`, `PARTIAL`, `COMPLETE`.
* Problem codes (each with allowed layers): `NOT_FINITE`·in, `OUT_OF_RANGE`·in, `NOT_INTEGER`·in, `UNKNOWN_ENUM`·in, `LEGACY_AMBIGUOUS`·in, `UNSUPPORTED_RATING_KIND`·in, `MISSING_FIELD`·in|cap, `QUALIFICATION_UNKNOWN`·in, `QUALIFICATION_FAILED`·in, `CLASSIFICATION_REQUIRED`·dem, `SCOPE_UNSUPPORTED`·in, `CAPABILITY_DISABLED`·in, `RULE_PENDING`·in, `LOAD_UNRESOLVED`·dem, `MODEL_UNSUPPORTED`·cur, `MODEL_DECLARATION_MISSING`·cur, `SUPPLY_INCONSISTENT`·in, `LEG_INVALID`·in, `CONNECTION_INVALID`·in, `ASSOCIATION_UNKNOWN`·cap, `NEWLOAD_BASIS_UNQUALIFIED`·cap, `NEWLOAD_MODE_NONE_WITH_NEW_LOADS`·dem, `NOT_COVERED_BY_AGGREGATE`·dem, `AGGREGATE_STALE`·dem, `COVERS_UNKNOWN_LOAD`·in, `DUPLICATE_ID`·in, `LEGACY_LAUNDRY_MERGED`·in (informational), `PARSE_REJECTED`·in. Layers: `input`, `demand`, `current`, `capacity`. Sources: `parser`, `engine`, `migration`.
* `coverage`: `counted`, `counted_via_aggregate`, `considered_not_governing`, `not_applicable_by_rule`, `unresolved`.
* Units: `VA`, `kVA`, `kW`, `A`, `V`, `dimensionless`. Line operations: `identity`, `multiply`, `divide_by_voltage`, `divide_by_sqrt3_voltage`, `sum`, `convert_unit`.
* Occupancy: `dwelling_unit_house`, `dwelling_unit_apartment`, `multifamily_building`, `nondwelling`. Methods: `opt_220_82`, `existing_220_83`, `measured_220_87`, `standard_part_III`, `multifamily_220_84`. Purpose: `service`, `feeder`.
* Load categories: `range`, `oven`, `cooktop`, `dryer`, `water_heater`, `dishwasher`, `appliance_fixed_other`, `motor`, `ac`, `heat_pump_compressor`, `heat_pump_supplemental`, `electric_space_heat`, `thermal_storage_heat`, `evse`, `other`. Rating kinds: `va` (computable), `w`, `amps_at_volts`, `hp` (accepted structurally, always `UNSUPPORTED_RATING_KIND`).

## 4. Supply topology (engine-owned table; schema-enforced coupling)

| `topology` | V L-L | V L-N | phases | wires | notes |
|---|---|---|---|---|---|
| `1ph_2w_120` | 120 | 120 | 1 | 2 | |
| `1ph_2w_240` | 240 | — | 1 | 2 | no neutral |
| `1ph_3w_120_240` | 240 | 120 | 1 | 3 | split-phase |
| `1ph_3w_120_208_network` | 208 | 120 | 1 | 3 | two legs of a 208Y/120 system, 120° apart |
| `3ph_4w_208Y_120` | 208 | 120 | 3 | 4 | |
| `3ph_4w_480Y_277` | 480 | 277 | 3 | 4 | |
| `3ph_3w_480_delta` | 480 | — | 3 | 3 | no neutral |
| `3ph_3w_240_delta` | 240 | — | 3 | 3 | models unsupported |
| `3ph_4w_240_delta_highleg` | 240 | 120 | 3 | 4 | models unsupported |
| `other` | — | — | — | — | `UNSUPPORTED_SCOPE` |

`vLineToLine/vLineToNeutral/phases/wires` are derived values; a snapshot whose values disagree with the table is **schema-invalid** (mutant CONTRADICTORY_SUPPLY, T-S-33). Legacy option `480` is labelled "480V — 3Ø" in the current app but computed as 1-φ; migration maps it to `LEGACY_AMBIGUOUS` between `3ph_4w_480Y_277` and `3ph_3w_480_delta` (T-S-11b); `240_3` likewise (T-S-11a). Semantic rules: `LEG_INVALID` when a leg `L3` appears on a 1-φ topology or a leg is named on a 2-wire supply (T-S-34); `CONNECTION_INVALID` when `LN` is used on a topology without neutral (T-S-35).

---

## 5. Load-distribution model (separate from topology)

Every load and the precalculated term declare `connection ∈ {LL, LN, 3PH}` and, for `LN` on a 3-/4-wire supply, `leg`. `loadModel.declarations` are attestations with provenance (`unityPF`, `balancedLN`, `balanced3ph`); `null` never means `true`.

| `loadModel.kind` | Topology | Applicability | Formula (raw) | Exactness |
|---|---|---|---|---|
| `single_2w` | `1ph_2w_*` | — | I = VA / V | exact |
| `split_240_all_LL` | `1ph_3w_120_240` | every load LL; on the **amperes path** an L-L new term additionally requires `unityPF = true` declared (in-phase addition to a measured current) | I_L1 = I_L2 = VA / 240 | exact |
| `split_240_balanced_LN` | `1ph_3w_120_240` | `balancedLN = true` declared | I = VA / 240 | exact under the declaration |
| `split_240_declared_legs` | `1ph_3w_120_240` | every LN load has a leg; `unityPF = true` | I_Lk = Σ VA_LL/240 + Σ VA_LN(Lk)/120 | exact (unity PF, in phase) |
| `network_208_all_LL` | `1ph_3w_120_208_network` | every load LL | I = VA / 208 | exact |
| `network_208_balanced_LN` | `1ph_3w_120_208_network` | every load LN, `balancedLN = true` | I = (VA/2) / 120 | exact under the declaration |
| `network_208_mixed` | `1ph_3w_120_208_network` | — | — | **unsupported** (`MODEL_UNSUPPORTED`; own counterexample 3,600 VA LL + 3,600 VA L1-N ⇒ 45.8 A on L1 while VA/208 = 34.6 A) |
| `three_phase_balanced` | `3ph_4w_208Y_120`, `3ph_4w_480Y_277`, `3ph_3w_480_delta` | `balanced3ph = true` (or every load 3PH) | I = VA / (√3 · V_LL) | exact under the declaration |
| any | 240 V delta topologies, `other` | — | — | unsupported |

A model that is not applicable (missing leg ⇒ `MODEL_DECLARATION_MISSING`; unsupported ⇒ `MODEL_UNSUPPORTED`) leaves `current.status = not_computed` and `existingCapacity = not_assessed` with that blocking code; the demand may still be complete (T-S-19). Neutral current is never computed (`neutralA: null`).

---

## 6. Loads, retained data and coverage (R-R1-04B)

### 6.1 Loads
`loads[]` items are never deleted by scope/method/mode changes (T-S-06, T-S-16). Each has `category` + `classification` (`confirmed` | `required`), `rating {kind: va, value}`, `status ∈ {existing, new}`, `continuous`, `connection`, `leg`, optional `legacy{id,name,va,category}` provenance. `classification = required` or `rating.kind ≠ va` ⇒ the load is `unresolved`.

### 6.2 New-load term modes under 220.87
| `newLoad.mode` | Meaning | Coverage rule |
|---|---|---|
| `none` | no new load is added to the existing maximum demand | every load with `status = new` becomes `unresolved(NEWLOAD_MODE_NONE_WITH_NEW_LOADS)` ⇒ `PARTIAL`. `none` is valid only when no retained new load exists. Existing loads are `not_applicable_by_rule` (represented by the measured demand, 220.87). |
| `precalculated` | the user supplies **one** already-established term `precalculated.va` and lists the new loads it covers (`covers[]`); the engine stores `coversSnapshot` (§6.2.1) at entry time | covered loads ⇒ `counted_via_aggregate`; a new load not listed ⇒ `unresolved(NOT_COVERED_BY_AGGREGATE)`; a listed id that does not exist ⇒ `COVERS_UNKNOWN_LOAD` (INVALID); a duplicate id in `covers[]` or in `loads[]` ⇒ `DUPLICATE_ID` (INVALID, T-S-44a/b); any basis-relevant change of a covered load ⇒ `AGGREGATE_STALE` ⇒ every covered load `unresolved(AGGREGATE_STALE)` ⇒ `PARTIAL` (T-S-14, T-S-40, T-S-40r) |
| `from_loads` | per-load demand rules | **disabled in profile A** ⇒ `UNSUPPORTED_SCOPE` (`CAPABILITY_DISABLED:measurement.newLoad.mode`); new loads `unresolved(CAPABILITY_DISABLED)` (T-N-03) |

#### 6.2.1 Aggregate validity — canonical covered-set snapshot (R-R2-02)
`coversSnapshot` is the deterministic projection of the covered loads at the moment the term was entered: the loads whose ids are in `covers[]`, **sorted by id in Unicode code-point order** (independent of `covers[]` order and of `loads[]` order), each reduced to the basis-relevant fields `{id, category, classification, rating{kind, value, volts}, quantity, status, continuous, connection, leg, separatelyControlledUnits, alms{present, maxLoadVA}}`. Descriptive fields `label` and `legacy` are **explicitly excluded** (editing them never invalidates the term, T-S-40 steps 7–8). Staleness test: canonical JSON (`sort_keys`, no whitespace) of the current projection ≠ canonical JSON of the stored `coversSnapshot`. No hash and no separator-concatenation is used; the snapshot itself is the stored comparison object. Duplicate ids make the projection undefined ⇒ `DUPLICATE_ID`. A stale term can never produce `COMPLETE` or an operative capacity verdict (invariant I-19); restoring a saved record with a stale term stays stale (T-S-40r). Original loads and migration provenance are never modified by the staleness logic. `coversSnapshot` is written only by the adapter when the user (re-)enters the term; the engine never rewrites or auto-refreshes it on load edits — otherwise the check would be void.

### 6.3 What `precalculatedVA` is (R-R1-04A)
A value the user asserts is the **new-load term for this specific 220.87(2) comparison**: `basis = {method, ruleRefs[], demandFactorsApplied, continuousFactorApplied, establishedForThisComparison, calculatedBy, provenance, note}`. The tool applies **no factor** to it (no 125 % — T-P-19 pending; no demand factor). The demand line is `identity`, `ruleStatus = user_supplied`, and the result records who established it. An exact capacity verdict requires `establishedForThisComparison = true`; otherwise the demand is complete but `existingCapacity = not_assessed(NEWLOAD_BASIS_UNQUALIFIED)` (T-S-29 vs T-N-13). A free-text note is never a rule.

---

## 7. Measurement qualification and the comparison policy (220.87 as revised by NYC 2025)

### 7.1 Verified rule text (S-02, NYC 2025 amendments PDF, Article 220, PDF pp. 10–11; reviewer viewed the page image)
(1) maximum demand data for one year, **or** — where one year of data is not available — a 30-day continuous recording at 15-minute intervals on the highest-loaded phase, based on initial loading, occupied, including the larger of heating/cooling and periodic loads; the exception is barred with renewable energy or peak-load-shaving systems; (2) the maximum demand at **125 percent plus the new load** shall not exceed the feeder ampacity / service rating; (3) feeder overload protection per 240.4 / service overload protection per 230.90. Full text is the NYC document; this contract stores only the structure.

### 7.2 Qualification matrix (every row is an explicit datum or attestation; `null` ⇒ `QUALIFICATION_UNKNOWN` ⇒ INCOMPLETE; `false` where a `true` is required ⇒ `QUALIFICATION_FAILED` ⇒ UNQUALIFIED)
| Field | annual route | 30-day route | Case |
|---|---|---|---|
| `annualDataAvailable` | must be `true` | must be `false` (exception only when annual data unavailable) | T-N-09 |
| `periodMonths` | must be ≥ 12 | — | T-N-08 |
| `periodDays` / `intervalMinutes` / `continuousRecording` | — | ≥ 30 / ≤ 15 / `true` | T-N-10a/b/d |
| `connectedTo` | any | must not be `unknown` | T-N-10c |
| `basedOnInitialLoading`, `recordedWhileOccupied`, `includesLargerOfHeatingOrCooling`, `includesPeriodicSeasonalLoads` | — | `true` required | T-N-10e, T-N-02b, T-N-11 |
| `hasRenewableEnergySystem`, `hasPeakLoadShaving` | — | must be `false` | T-N-02, T-S-18 |
| `existing.serviceOverloadPer230_90` / `feederOcpPer240_4` | `true` required for the assessed object | same | T-N-12a/b, T-S-27 |
| `existing.serviceRatingA` (service) / `feederAmpacityA` (feeder) | required **for the verdict only** (capacity layer) | same | T-N-04, T-S-38 |
| `readingScope` | `total_apparent_power` for VA/kVA/kW readings; `highest_loaded_conductor` or `per_conductor` for A readings | same | T-S-25 (null ⇒ MISSING) |
| `powerFactor` | required for kW readings | same | T-N-07 |

### 7.3 Numeric policy: raw values, display, code rounding (R-R1-01, R-R2-01b)
* All arithmetic is IEEE-754 double in the declared order: normalisation (kVA: `value × 1000`; kW: `(value × 1000) / PF`) → existing component = `normalized × 1.25` → total = `existing125 + newTerm` (or identity) → current = `total / D` where `D` is taken **from the envelope supply and model** (§5): `vLineToLine` for `single_2w`, `split_240_*`, `network_208_all_LL`; `(total / 2) / vLineToNeutral` for `network_208_balanced_LN`; `sqrt3 × vLineToLine` (computed first, then the division) for `three_phase_balanced`. Amperes path: `existing = reading × 1.25`; LN term `va / vLineToNeutral`; LL term `va / vLineToLine`; balanced 3PH term `va / (sqrt3 × vLineToLine)`; per-conductor total = `existing + term`. No intermediate rounding anywhere.
* `comparisonPolicy = raw_conservative`: `satisfied = demandValueRaw ≤ ratingValue` on the raw doubles. This is a **tool policy of caution**, not a claim about the exact code minimum.
* `codeRounding = null`: no NEC 220.5(B)-type rounding is applied. Adopting one later requires verified text and applicability, a named stage in the pipeline, its own field in the result, and independent boundary tests; arbitrary `round(x, 1)` is not that rule.
* **Exactness of copies and re-derivations (R-R2-01b).** Every operative number that the result copies (`comparisons[].demandValueRaw`, `totalVA`, `totalOnConductorA`, `lineA`, operand references between lines) must be **bit-identical** to its source; the invariant checker re-derives every typed line and the current from the envelope in the declared order and requires exact equality — no tolerance is applied to operative values, so no tolerance can move a value across a rating boundary. Display strings (§8) are derived from raw values and are structurally incapable of feeding a comparison (`display.feedsComparison = false`).
* Literal boundary expectations are hand-written in the test file (`LIT`) and must not be regenerated by a helper: 1-φ 38,392.32 / 38,400 / 38,407.68 VA vs 200 A ⇒ 199.96 / 200.0 / 200.04 A ⇒ adequate / adequate / **inadequate** (T-N-18..20); 3-φ 208Y 37,467 / 37,467.5 / 37,468 VA (T-N-21..23); amperes path 119.99 / 120 / 120.01 A vs 150 A (T-N-24..26); display precision 0/1/3 never changes the verdict (T-N-27..29).

### 7.4 Exact comparison vs upper bound (R-R1-03, R-R2-04; P-10 variant B adopted as target)
`existingCapacity.comparisonKind ∈ {exact, upper_bound, null}`. Verdicts `adequate`/`inadequate` are emitted **only** for `exact` comparisons; `not_assessed` otherwise, with `blockingCode`. An unsupported association never becomes an exact `inadequate`.

**VA-type readings** (`readingScope = total_apparent_power`, units VA/kVA/kW): the demand total is exact; the current follows the model table of §5 with the divisor taken from the envelope supply; the model must be applicable to the term's connection — on 3-phase topologies `three_phase_balanced` requires `balanced3ph = true` and a `3PH` (or absent) term; an `LL`/`LN` term ⇒ `MODEL_UNSUPPORTED` (current layer; demand stays complete, no verdict — T-S-43); on `1ph_3w_120_240`, `split_240_all_LL` requires an `LL` term, `split_240_declared_legs` requires the leg (T-S-19).

**Amperes readings** (`readingScope = highest_loaded_conductor` single value, or `per_conductor` with `readingsPerConductor`), split by topology × term connection:

| Topology | Reading | Term | Exact? | Result |
|---|---|---|---|---|
| `1ph_3w_120_240` | single | none | yes (measured conductor is the highest; nothing added) | `existing × 1.25` vs rating (T-N-06, T-N-24..26) |
| `1ph_3w_120_240` | single | `LL` | yes **only with `loadModel.declarations.unityPF = true`** (in-phase addition of the new current to the measured current): adds `va / vLineToLine` to **both** conductors, the measured one stays the highest. `unityPF` null ⇒ `INCOMPLETE_INPUT` (`QUALIFICATION_UNKNOWN` + `MODEL_DECLARATION_MISSING:loadModel.declarations.unityPF`), no total, no verdict; `unityPF = false` ⇒ `UNSUPPORTED_SCOPE` (`CAPABILITY_DISABLED:loadModel.declarations.unityPF`) — no phase-angle solver | T-N-17 (declared), T-N-17b (null), T-N-17c (false) |
| `1ph_3w_120_240` | single | `LN` | **no** — which physical conductor was measured/loaded is unknown | `INCOMPLETE_INPUT`: `ASSOCIATION_UNKNOWN` + `MISSING_FIELD:measurement.readingsPerConductor`; no verdict (T-N-14) |
| `1ph_3w_120_240` | per conductor | `LN` on a declared leg / `LL` | yes: per-conductor totals, unity PF in phase | one comparison per conductor (T-N-15 adequate 125/55 A, T-N-16 inadequate 155/25 A) |
| `1ph_3w_120_208_network` | single or per conductor | none | yes | T-N-33 |
| `1ph_3w_120_208_network` | any | any term | **no** — currents from L-N and L-L loads on the same conductor are 30° apart; an arithmetic sum is a bound, not an exact value | `UNSUPPORTED_SCOPE` (`CAPABILITY_DISABLED:measurement.newLoad.precalculated.connection`) — T-N-32 |
| 3-phase (`3ph_4w_208Y_120`, `3ph_4w_480Y_277`, `3ph_3w_480_delta`) | single | none | yes | `existing × 1.25` vs rating |
| 3-phase | single | balanced `3PH` with `balanced3ph = true` | yes: adds `va / (sqrt3 × vLineToLine)` to **every** conductor | T-N-30 (125 + 19.985 = 144.985 A, **not** 125 + 7200/208 = 159.6 A); `balanced3ph = null` ⇒ `MODEL_DECLARATION_MISSING`, no total, no verdict (T-N-34) |
| 3-phase | single or per conductor | `LL` or `LN` | **no** — a single L-L load loads two conductors at 30° phase offsets; not covered by the in-phase assumption | `UNSUPPORTED_SCOPE` (`CAPABILITY_DISABLED:…connection`) — T-N-31, T-N-31b |

The amperes path never converts a single-conductor reading into a total VA (no balanced surrogate; reviewer counterexample 135 A vs 155 A). `demand.unit = A`, `totalOnConductorA` = the governing (largest) conductor total. No mixed-load phase analyzer and no new EV rule are introduced by this table.

### 7.5 Optional upper-bound screening (profile `A_opt_bound`; **off** in profile A)
If ever enabled: `diagnostics.upperBoundScreening = {kind: upper_bound, envelopeA, ratingValue, boundOutcome, assumptions}` with `envelopeA` = 1.25·I_max + all new L-N current assigned to the measured conductor. Conclusions are **asymmetric**: `bound_satisfied` (envelope ≤ rating) means adequacy follows under the stated assumptions and is still reported as screening; `bound_exceeded` means "adequacy not proven — per-conductor data needed" and is **never** `inadequate`. Reviewer counterexample: L1 100 A, L2 20 A, new 3,600 VA on L2 ⇒ exact 125/55 A both ≤ 150 A while the envelope is 155 A (T-A-31, T-F-01/02, futureExpected only).

---

## 8. Display (presentation layer)
`display = {precision: {amps, va}, rounding: "half_away_from_zero", strings: {…}, feedsComparison: false}`. Strings = raw value rounded half-away-from-zero to the precision, thousands grouped with `,`, unit suffix (`"208.3 A"`, `"50,000 VA"`). Changing precision changes strings only (T-N-27..29). `presentation = {topologyLabel, showPerConductor, polesLabel ("2-pole" for 1-φ 3-wire, "3-pole" for 3-φ, null otherwise), finalResultHeading, verdictLabel}`: `finalResultHeading = true` **iff** `status = COMPLETE` (the demand result is complete — it is not a verdict); `verdictLabel` mirrors `existingCapacity.status` (`adequate` / `inadequate` / `not_assessed`) on `COMPLETE` and is `null` otherwise. A complete demand with a missing rating therefore shows the demand heading and the label `not_assessed` (T-N-04, T-S-38). The old app's "Per leg @ 120V" line (VA/240 for any voltage 240, incl. `240_3`) is retired.

## 9. Status truth table, problems, result shape, couplings and invariants

### 9.1 Status precedence (first matching row wins; every problem is always listed)
| Row | Status | Condition |
|---|---|---|
| 1 | `EMPTY` | occupancy null ∧ method null ∧ no loads ∧ no measurement ∧ no migration (Init = Reset, T-S-08) |
| 2 | `UNSUPPORTED_SCOPE` | any `SCOPE_UNSUPPORTED` (occupancy × method × topology outside the support matrix) or `CAPABILITY_DISABLED` (outside the profile) |
| 3 | `BLOCKED_PENDING_RULE` | any `RULE_PENDING` on an enabled path (must not occur in production; invariant on the profile) |
| 4 | `INVALID_INPUT` | any input-layer problem of: NOT_FINITE, OUT_OF_RANGE, NOT_INTEGER, UNKNOWN_ENUM, LEGACY_AMBIGUOUS, UNSUPPORTED_RATING_KIND, SUPPLY_INCONSISTENT, LEG_INVALID, CONNECTION_INVALID, COVERS_UNKNOWN_LOAD, PARSE_REJECTED |
| 5 | `INCOMPLETE_INPUT` | any input-layer MISSING_FIELD / QUALIFICATION_UNKNOWN on a field the selected method requires |
| 6 | `UNQUALIFIED_METHOD` | any QUALIFICATION_FAILED |
| 7 | `PARTIAL` | any `unresolved` coverage entry (demand layer) |
| 8 | `COMPLETE` | otherwise — demand complete; **never** a synonym for adequate |

Layer semantics: `input` problems drive rows 2–6; `demand` problems drive row 7; `current` problems only set `current.not_computed`; `capacity` problems (missing rating, association, unqualified basis) only set `existingCapacity.not_assessed` with `blockingCode`. Migration problems carry `source: migration`, parser problems `source: parser`.

### 9.2 Required fields by method (profile A rows active)
| Method | Required (input layer) | For the verdict (capacity layer) |
|---|---|---|
| all | occupancy, supply.topology, loadModel.kind, method.selected | — |
| `measured_220_87` | measurement.basis, reading{value,unit}, readingScope, the qualification rows of §7.2 for the chosen route, newLoad.mode, (precalculated) va/connection/basis, powerFactor for kW | existing.serviceRatingA or feederAmpacityA; readingsPerConductor when an LN term meets a single-conductor A reading; basis.establishedForThisComparison = true |
| others | as in v3 §2.7 (retained for data completeness; paths disabled) | — |

### 9.3 Result shape (`LoadCalcResult`, schemaVersion `"3.2.1"`)
`{schemaVersion, ruleBasis, profileId, status, problems[{code, field, layer, source, ruleRef, message}], loadsCoverage[{loadId, coverage, ruleRef, reason, viaAggregate}], demand{status, unit, totalVA, totalOnConductorA, partialSubtotalVA, lines[typed]}, current{status, model, formula (descriptive only), assumptions, perConductorA, lineA, neutralA: null, note}, existingCapacity{status, comparisonKind, policy, ruleRef, blockingCode, comparisons[{conductor, unit: A, demandValueRaw, ratingValue, ratingSource, satisfied}], boundOutcome}, requiredCapacity{status: not_assessed, note}, rating{status: not_assessed, note}, diagnostics{operative: false, existingComponentVA, existingComponentAOnConductor, newLoadTermVA, continuityOfNewLoadKnown, upperBoundScreening}, display, presentation{…, finalResultHeading, verdictLabel}, references[]}`.

**Typed lines (R-R1-02, R-R2-01).** `{id, label, op, operands[{ref, quantity{value, unit}}], factor, divisorV, powerFactor, conductor, result{value, unit}, ruleRef, amended, ruleStatus, loadIds[]}`. Equations checked **exactly** by the invariant checker: `identity` result = operand; `multiply` result = operand × factor (same unit); `divide_by_voltage` result(A) = operand(VA) / divisorV; `divide_by_sqrt3_voltage` result(A) = operand(VA) / (sqrt3 × divisorV); `sum` result = Σ operands (equal units, left-to-right); `convert_unit` kVA→VA `× 1000`, kW→VA `(× 1000) / powerFactor`. `divisorV` is always a supply voltage from the envelope (`vLineToNeutral` or `vLineToLine`), never a derived constant. `operands[].ref` points at an earlier line whose result it must equal exactly. Leaf operands (`ref: null`) are bound to the envelope: the reading (or `readingsPerConductor`), the power factor, `precalculated.va`. The final line's result equals `totalVA` (unit VA) or `totalOnConductorA` (unit A). Fixed line ids on the active path: `norm` (kVA/kW only), `existing125`, `newTerm` (precalculated, VA path), `total`; amperes path: `e_<conductor|measured>`, `n_<leg>` / `n_LL` / `n_3PH`, `t_<conductor>`, `governing`. `current.formula` is a human label; the checker never parses it.

### 9.4 Couplings enforced by the schema (mutants-r2-on-r21: all six reviewer output mutants rejected here)
COMPLETE ⇒ demand complete, no `unresolved` coverage, no pending line, no LOAD_UNRESOLVED/RULE_PENDING/CAPABILITY_DISABLED/SCOPE_UNSUPPORTED problem, `finalResultHeading = true`, `verdictLabel ∈ {adequate, inadequate, not_assessed}`; not COMPLETE ⇒ `finalResultHeading = false`, `verdictLabel = null`; `existingCapacity.status = adequate` ⇒ `verdictLabel = adequate` (likewise inadequate); PARTIAL ⇒ demand `partial_diagnostic`, current `not_computed`, capacity `not_assessed`, ≥1 unresolved; rows 1–6 ⇒ all layers cleared; verdict ⇒ status COMPLETE, `comparisonKind = exact`, ≥1 comparison, `blockingCode` null; `adequate` ⇒ every comparison `satisfied`; `inadequate` ⇒ some `satisfied = false`; `not_assessed` ⇒ `comparisons = []`; computed current ⇒ complete VA demand; complete VA demand ⇒ `totalVA ≥ 0`, `totalOnConductorA = null` (and vice versa for unit A); topology ⇒ derived voltages/phases/wires; `reading.value` and `precalculated.va` are `number | null`.

### 9.5 Invariants checked by `contract_invariants_r22.py` (I-01…I-21; L4, on (envelope, result) pairs)
I-01 status/layer couplings; I-02 problem layers, sort order and precedence; I-03 typed line equations and final-line = total (**exact**); I-04 verdict ⇔ comparisons ⇔ raw `≤`; I-05 comparison values are bit-identical copies of the raw current of their conductor (or the raw conductor total on the amperes path); I-06 display strings derived from raw with the declared precision; I-07 coverage ⇔ LOAD_UNRESOLVED; I-08 pending lines only in BLOCKED; I-09 diagnostics non-operative, rating/requiredCapacity not_assessed, `existingComponentVA = reading × 1.25`, presentation flags mirror status/verdict; I-10 finiteness/non-negativity; I-11 profile gating (method, mode, model); I-12 coverage rules per mode; I-13 association and qualified basis for exact verdicts (incl. the network / 3-phase term combinations of §7.4); **I-14** existing component bound to the normalized envelope reading (leaf operand, unit, PF, factor exactly 1.25, `norm` line for kVA/kW); **I-15** new-load term bound to the envelope (`newTerm`/`n_*` present iff `precalculated`, value = `precalculated.va`, divisor = the envelope voltage for the declared connection, `total = sum(existing125, newTerm)` / `identity(existing125)`); **I-16** `current.model = envelope loadModel.kind`, `lineA` re-derived exactly from `totalVA` and the envelope supply (never from the formula string); **I-17** `ratingSource` matches `purpose` (`service` → `serviceRatingA`, `feeder` → `feederAmpacityA`) and `ratingValue` equals that envelope field exactly; **I-18** the verdict side equals the side of the operative raw value; **I-19** aggregate staleness via the canonical covers snapshot (stale ⇒ never COMPLETE; `AGGREGATE_STALE` iff stale; undefined projection ⇒ `DUPLICATE_ID`/`COVERS_UNKNOWN_LOAD`); **I-20** every `parseErrors[]` entry is surfaced as a parser-sourced problem and blocks demand computation; **I-21 operative graph completeness** (R-R2-01 closure): for a complete measured demand the line set is exactly the declared one (`norm`?, `existing125`, `newTerm`?, `total` on the VA path; `e_<k>`, `n_<leg|LL|3PH>`?, `t_<k>`?, `governing` on the amperes path), operand references are compared as **ordered lists with multiplicity** (`total = sum[existing125, newTerm]` exactly once each; `t_k = sum[e_k, n_*]`), references point only backward, every new term is attached to the terminal of every conductor it belongs to (LN: its declared leg; LL/3PH: every operative conductor) and nowhere else, `governing = identity` of a maximum terminal and equals `totalOnConductorA`, and an exact verdict compares **every** operative conductor exactly once with its terminal value. I-13 additionally requires `unityPF = true` for an L-L term on the split-phase amperes path. The reviewer's review-only `operative_graph_review.py` is kept as an independent cross-check (same four rejections, all positives accepted). L4 does **not** re-implement NEC qualification rules (e.g. an 11-month period against an old result is an L3 engine test, T-N-08).

### 9.6 State transitions and invalidation
* Occupancy cleared ⇒ guide recommendation cleared; a guide-selected method is cleared with it, a manual one stays (T-S-01/01b). Guide answers (`houseFeeder`, `aptFeeder`, `houseState`, `bldgCooking`) are persisted and never re-resolved on restore (T-S-02).
* Any basis-relevant change to a covered load (§6.2.1) ⇒ `AGGREGATE_STALE` until the aggregate is re-entered (T-S-14, T-S-40); descriptive edits do not invalidate it; the stale state survives save/restore (T-S-40r).
* Any change that removes a verdict prerequisite clears the whole verdict object: `comparisons = []`, `blockingCode` set, `verdictLabel = not_assessed`; an independently complete demand **stays** COMPLETE with `finalResultHeading = true` (T-S-38, T-N-04). A change that removes a demand prerequisite (reading cleared, parse error, qualification failure) clears every layer (T-S-18, T-S-41a/b). No stale verdict or stale line is ever retained: every operative number is re-derived from the current envelope (I-14…I-17).
* Loads are never deleted by the engine or by scope/method/mode changes; EV items are not cleared for apartments (old behaviour retired).
* Init = Reset = the empty snapshot (P-5): no default topology, no seeded loads.

## 10. Out of scope in profile A (explicitly inactive, deterministic)
### 10.1 Rating recommendation
`rating.status = not_assessed` always (schema `const`). No list candidate, no old 100/150/200/300/400/600 chain (source behaviour only, `mobile.html` 7981–7988). A future rating layer needs S-25 (240.6(A)), S-26 (230.79), S-27 (sizing factors) and a specified rule; **600 A stays a proposed product ceiling for that future layer only** and is not represented in the result.
### 10.2 Wire Sizer handoff (R-R1-04C)
`requiredCapacity.status = not_assessed`; the r1 `handoff` object is removed. Read-only fact: the actual consumer `wsCalc → EC.wireSizing.selectConductor` (`mobile.html` 13795–13811; `src/calc/wireSizing.js` 61–137) takes **amperes** (`load` + `continuousLoad`, or `continuousLoadA` + `noncontinuousLoadA`), `circuitType ∈ {BRANCH_CIRCUIT, FEEDER}`, and applies its own 125 % continuous multiplier; it has no field for VA payloads or "factors already applied" flags. A future adapter (VA → A per conductor, continuity split, no double factoring) requires its own approved contract and consumer tests; nothing in v3.2 modifies Wire Sizer. `diagnostics` (existing component, new-load term, continuity known) are data, marked `operative: false`.
### 10.3 Also inactive
Neutral (220.61) — `neutralA: null`; Commercial Standard — `UNSUPPORTED_SCOPE`; motor loads — `unresolved`; profiles A+/B — §1.2.

---

## 11. Migration and persistence (R-R1-06; P-3 save-as-copy as target)

### 11.1 Source facts (pinned `mobile.html`)
Favorites key `sparky_favorites`; v1 record `{method, voltage, scope, sqFt, appliances, hvac, ev}` with the three lists as JSON strings (8066–8074); no `lcMeterVA/lcNumUnits/lcHouseLoads` in any real record; restore path re-runs the guide and overwrites the method (8115); EV list cleared for apartments (13578, 13712); `lcReset()` seeds "Range / Oven", "Water Heater", "Laundry Circuit" and an HVAC item named "A/C" (8483–8490) while the preset is "A/C Unit" (13465); `LC_PRESETS` (13459–13471).

### 11.2 Structured migration record (`migration`, schema `$defs/migration`)
`{from: 1, savePolicy: "save_as_copy", sourceRecord: <v1 record verbatim, string fields>, transforms[{itemId, legacy{id,name,va,category}, target ∈ {loads, dwelling.laundryCircuits, dwelling.nycAcCircuitCount, none}, targetId, contribution, status ∈ {applied, unresolved}, reason, note}], unresolvedItems[same shape], fieldMap{legacyField → v3.2 path | null}, notes[]}`.

| Legacy item (exact preset name) | Transform |
|---|---|
| `Laundry Circuit`, category `laundry`, va = 1,500 | `dwelling.laundryCircuits += 1` (contribution 1, no load) — T-S-22a |
| `Laundry Circuit`, va ≠ 1,500 | `unresolvedItems` (raw item retained), `laundryCircuits` stays null, `LEGACY_AMBIGUOUS` — T-S-22b |
| `A/C Window Outlet — NYCEC 220.14(N)`, va = 1,500 | `dwelling.nycAcCircuitCount += 1`, never an HVAC load — T-S-22c |
| `Range / Oven`→range, `Dryer`→dryer, `Dishwasher`→dishwasher, `Water Heater`→water_heater, `A/C Unit`→ac, `Electric Heat`→electric_space_heat, `EV Charger — Level 1/2`→evse | load with `legacy` provenance, `classification: confirmed`, status null (user must mark existing/new) |
| `Microwave`, `Garbage Disposal`, `Other`, `Heat Pump`, any other name (incl. Reset's `A/C`) | load with `classification: required` — T-S-21b..e, T-S-04c |
| voltage `240`/`208`/`208_3` | topology; `240_3`/`480` ⇒ `LEGACY_AMBIGUOUS`; unknown ⇒ `UNKNOWN_ENUM` — T-S-11, T-S-26 |
| method / scope / sqFt | direct map; `selectionSource: legacy` |
| `lcMeterVA` (synthetic only) | `measurement.reading {value, VA}`, all qualification fields unknown — T-S-25 |

Counts are derived only through `transforms[]` (one contribution per item, so nothing is double-counted); no numeric value is recoverable only from prose. No write-back happens on load.

### 11.3 Save policy (P-3, proposed) and future persistence tests
Saving a migrated record writes a **new** v3.2 record; the v1 record is untouched and remains loadable until the user deletes it explicitly; re-opening the v3.2 record does not re-run migration (`migration` retained as history). Sequences defined but **not executed** (future implementation tests, never to be reported as passed before they run): T-S-12 (save → reload → restore → compare) and T-S-39 (save-as-copy). No real Favorites/localStorage data is touched in this phase.

---

## 12. Source gates
| Rule used by profile A | Status | Evidence |
|---|---|---|
| 220.87 (1)(Exception)(2)(3) as revised by NYC 2025 | verified | S-02 (official PDF, Article 220 pp. 10–11); S-07/S-08 (DOB ECRIC 2025, two "220.87 (2011 or 2025)" items) |
| 220.14(A) basis of "new load" in VA (general) | verified (structure) | S-02 |
| Unit conversions, √3, per-conductor arithmetic | mathematics, not a code rule | — |
| Nothing else | — | profile A applies no other rule; the user-supplied term's own basis is the user's attestation (§6.3) |

Pending rows (profile B only; not chased again in r2): S-11 (220.82), S-12 (220.83), S-13 (220.84 + Table), S-14/15/16/17/18/19/22/33 (Standard dwelling), S-21b/S-29 + T-P-18/T-P-19 (EVSE, continuous factor inside the 220.87 new-load term), S-24 (motors), S-25/26/27 (future rating layer), S-31 (TIA register). Closed: S-21 = 220.57 is NEC 2023 (`NOT_APPLICABLE_TO_BASE_EDITION`); S-32 Leviton 2020 pocket guide has no Article 220. Inference kept separate: the 208Y/120 3-φ supply of the DOB example is inferred from its 130 A (T-N-03, future A+).

---

## 13. Product decisions (proposals; owner confirmation required)
| Decision | Adopted target in v3.2 | Owner status |
|---|---|---|
| P-1 first scope | profile A (§1.2): measured 220.87, new-load `none` or a qualified `precalculated` term; other methods visibly unavailable with data retained; the old 125 %-on-new-loads output is never kept as a fallback | open |
| P-3 migration | structured, non-destructive, save-as-copy (§11) | open |
| P-5 init/reset | empty snapshot, no seeded loads (§9.6) | open |
| P-10 measured amperes | variant B: exact verdicts only with known association; otherwise not_assessed; upper-bound screening off (§7.4–7.5) | open |
| Rating / Wire Sizer | inactive in profile A (§10) | open |
| Others (P-2 600 A future ceiling, P-4 retained loads block completeness, P-6 480 V/3-φ selectable under the balanced model, P-7 Recommended/Selected wording, P-8 NYC A/C circuit count on the Standard path only, P-9 no list candidate, P-11 motors unresolved) | as stated | open |

---

## 14. Engine-owned constants (not inputs)
Profile A (§1.2); topology table (§4); model table (§5); amperes-path combination table (§7.4); preset map (§11.2); `ruleStatus`/`amended` per rule (§12); comparison policy and display defaults (§7.3, §8); the canonical covered-set projection (§6.2.1: id-sorted, basis-relevant fields, canonical JSON comparison).

## 15. Verdict
**READY FOR CONTRACT REVIEW — implementation NOT approved.** This document (v3.2 + r2.1 closure + r2.2 errata E-01…E-09), schema r21 (unchanged) and test-cases r22 form one consistent revision (169 specifications: 32 math, 43 core component, 27 profile-A component, 42 profile-A normative, 1 A+, 20 B, 2 A_opt_bound, 2 future persistence; 128 full expected results (114 primary + 14 post-action steps) validated structurally and by L4 r22 (incl. I-21) bound to their envelopes and cross-checked by the reviewer's graph checker; all 167 r2.1 expected values unchanged, one envelope changed and disclosed (T-N-17: `unityPF = true`), two cases added (T-N-17b/c); 20 pending with `expected: null`; **0 engine tests executed**). Remaining before an implementation prompt: (1) independent confirmation of the r2.2 closure (`EC-CALC-2-A3-r2.2-dispositions.md`); (2) owner confirmation of P-1/P-3/P-5/P-10 and of the inactive rating / Wire Sizer integration; (3) A+/B only if the owner selects them.
