# Load Calc — B1 core implementation notes (EC-CALC-2 / B1)

Companion to `docs/load-calc-contract.md` (verbatim copy of the reviewed
contract v3.2.2, SHA-256 `e3687b2f…bfe23`). The contract is the normative
text; this file records what B1 built, the few decisions the contract leaves
to the implementer, and exactly what is **not** claimed.

Scope authorised: Profile A only (`A_measured_87_core`), pure engine + pure
helpers. UI, Favorites persistence and generated-bundle integration are B2.

## 1. What B1 delivers

| File | Role | Registered in the app? |
|---|---|---|
| `src/calc/loadCalc.js` | pure engine `evaluate(envelope, options?) -> LoadCalcResult` | **No** (B2) |
| `src/calc/loadCalcState.js` | pure state helpers: empty snapshot, migration, covered-set projection/staleness, occupancy transition | No |
| `src/calc/loadCalcInput.js` | pure L1 strict JSON ingress + non-DOM field parsers; bounded L2 structural validator | No |
| `test/loadCalc*.test.js`, `test/helpers/loadCalc*.js`, `test/fixtures/loadCalc/*` | tests, helpers, unchanged copies of the reviewed oracles | — |
| `tools/loadcalc-core-check.js` | export harness (actual pairs, mutation mode on disposable copies) | test tool only |
| `tools/loadcalc-contract-check.py` | external-check adapter (schema / L4 / graph on actual outputs) | test tool only |

All 84 pre-existing app files are byte-identical to the PRE-TASK manifest.
`tools/build-calc.js` MODULES and `mobile.html` do not mention the new
modules; `test/loadCalcOracles.test.js` asserts this.

The modules are CommonJS with Node built-ins only; they read no DOM, storage,
network, clock or randomness, never mutate their input and return objects that
share nothing with it (asserted for every fixture pair).

## 2. Public API

```js
const { evaluate, PROFILE, formatNumber, LoadCalcEnvelopeError } = require('./src/calc/loadCalc');
const result = evaluate(envelope);                                // RequestEnvelope -> LoadCalcResult
const result2 = evaluate(envelope, { displayPrecision: { amps: 2, va: 0 } }); // presentation only
```

* `envelope` = `{ snapshot, parseErrors, profileId: 'A_measured_87_core' }`
  (schema r21 `RequestEnvelope`). A structurally invalid envelope throws
  `LoadCalcEnvelopeError` (`code: 'SCHEMA_INVALID'`, `errors: string[]`) before
  any arithmetic runs; there is never a success-shaped result for it.
* `options.displayPrecision` (integers 0..6) affects `display.strings` only;
  `demand`, `current`, `existingCapacity`, `status` are invariant (asserted).
* `PROFILE` is the frozen engine-owned capability profile of §1.2.
  `profileId` in the envelope is an echo check, not a switch.

State helpers (`loadCalcState.js`):

* `createEmptySnapshot()` — P-5 Init/Reset state (deep-equals T-S-08).
* `migrateLegacyRecord(record) -> { snapshot, problems }` — §11 structured
  migration (15 fixtures deep-equal). Saving the copy is B2.
* `coversProjection(loads, covers)`, `canonicalJson(x)`, `isAggregateStale(loads, term)` —
  §6.2.1; `captureCoversSnapshot(snapshot)` is the **only** writer of
  `coversSnapshot` (adapter-time, on user re-entry); `evaluate` never refreshes it.
* `setOccupancy(snapshot, occupancy)` — §9.6 transition (T-S-01/06/16).

Input helpers (`loadCalcInput.js`):

* `parseStrictJson(text)` — rejects NaN/Infinity/duplicate keys/non-object roots
  (`{ ok:false, code:'PARSE_REJECTED' }`), keeps `__proto__` as data.
* `parseNumberField(raw, {field, integer, min, max, exclusiveMin})`,
  `parseEnumField(raw, {field, allowed})` — one transport for blank/malformed
  entries: `{ value: null, error: { field, raw, code } }` with
  MISSING_FIELD / NOT_FINITE / NOT_INTEGER / OUT_OF_RANGE / UNKNOWN_ENUM.
  An `integer` field must be a **safe integer** (B1-r1): `"9007199254740993"`
  and `"1e100"` are OUT_OF_RANGE with `value: null`, never a rounded count.
  Real-valued fields (VA, A, kW, PF) are not restricted.
* `jsonRepresentabilityErrors(value)` (B1-r1) — strict JSON-object boundary:
  reports every `undefined`, `NaN`, `±Infinity`, function, symbol, bigint,
  non-plain object (Date, Map, class instance, object-literal `__proto__`),
  array hole or reference cycle anywhere in a direct object input, including
  inside collections the profile does not interpret. Nothing is sanitized.
* `validateEnvelope(envelope)`, `validateSnapshot(snapshot)` — run the
  representability walk first, then the bounded L2 validator mirroring schema
  r21 for the contract shapes (topology coupling, enums, integers,
  additionalProperties, declared booleans). `integer` means safe integer here
  (B1-r1) — deliberately stricter than the JSON-Schema keyword so a count that
  a double cannot hold is rejected on the direct-object entry too. It is not a
  generic JSON-Schema engine; the reviewer's full Draft 2020-12 validation of
  the actual outputs remains a separate external check (see §6).

State helper errors (`loadCalcState.js`, B1-r1): `migrateLegacyRecord` throws
`LegacyRecordError` (a `TypeError` with `code` `LEGACY_UNPARSEABLE_LIST` or
`LEGACY_ITEM_UNREPRESENTABLE` and `details {list, index, itemId}`) for a record
the typed snapshot cannot represent; nothing is built and the record is untouched.

## 3. Result of the literal comparison

`evaluate` was run on every full envelope/result pair of the **unchanged** r22
fixture file (114 primary + 14 post-action = 128 pairs):

* **125 pairs**: byte-for-byte equal to the literal expected object.
* **3 pairs** (`T-S-16`, `T-S-40s`, `T-S-40s/then[0]`): equal except one
  non-operative field, `diagnostics.continuityOfNewLoadKnown` — see §4.
* **0** other mismatches. Fixture bytes untouched (SHA pinned in the tests).

## 4. Documented fixture contradiction (isolated, not resolved by editing fixtures)

For an identical precalculated term (`continuous: true`, established basis)
the r22 fixtures state `diagnostics.continuityOfNewLoadKnown`:

* `false` in every COMPLETE result built from a counted term —
  e.g. `T-S-14/then[1]`, `T-S-40`, `T-S-40/then[6..7]`, `T-N-13`, `T-N-16`, …
* `true` in the hand-written PARTIAL results `T-S-16`, `T-S-40s`, `T-S-40s/then[0]`.

Smallest demonstrating pair: `T-S-14/then[1]` (COMPLETE, `false`) vs
`T-S-16` (PARTIAL, `true`) — same term, same `continuous: true`.

Engine rule chosen: profile A never resolves the continuity treatment of the
user-established term (`T-P-19` is pending), so the field is `false` whenever a
term is counted and `null` when no term is counted. The field is diagnostic
(`diagnostics.operative: false`); no verdict, line, status or problem depends
on it. The three pairs are reported separately in the tests as
"CONTRADICTION ISOLATED" and are **not** counted among the exact matches. If
the reviewer prefers the PARTIAL-side value, the change is confined to the
`diagnostics()` function in `loadCalc.js` and to those three fixture results.

## 5. Implementation choices where the contract or fixtures are silent

These follow the contract's principles (no silent defaults, no verdict without
the required data, disabled ≠ approximated) but are **not** verified by any
fixture pair; the reviewer may want to confirm each.

1. `measurement.reading.value` must be `> 0` on both paths (0 and negatives are
   OUT_OF_RANGE, consistent with T-A-11); per-conductor readings likewise.
2. `readingScope` must fit the unit (`A` ⇒ `highest_loaded_conductor` |
   `per_conductor`; VA/kVA/kW ⇒ `total_apparent_power`); a mismatch is
   UNKNOWN_ENUM at `measurement.readingScope`.
3. The 220.87(3) attestation (`serviceOverloadPer230_90` / `feederOcpPer240_4`)
   is evaluated only once `basis` is chosen (qualification rows are per route,
   T-S-25).
4. Amperes path, engine-owned combination table (§7.4): split-phase LL term
   needs `unityPF` (null ⇒ QUALIFICATION_UNKNOWN + MODEL_DECLARATION_MISSING
   echo; false ⇒ CAPABILITY_DISABLED); LN term needs `unityPF` and, on the
   per-conductor route, the complete required reading set (B1-r1, §9);
   3-phase 3PH term needs `balanced3ph`; network topologies, LL/LN
   terms on three-phase supplies, 2-wire supplies and 240 V delta supplies with
   any term are CAPABILITY_DISABLED at `…precalculated.connection` (no
   phase-angle solver is approximated). A model not applicable to the topology
   on the amperes path blocks the verdict with MODEL_UNSUPPORTED.
5. VA path, `split_240_declared_legs`: a measured total carries no per-leg
   distribution, so the model yields MODEL_UNSUPPORTED (`loadModel.kind`) once
   `unityPF` is declared; a counted LN term without `leg` is
   MODEL_DECLARATION_MISSING (T-S-19). `balancedLN` / `balanced3ph` / `unityPF`
   declared `false` ⇒ MODEL_UNSUPPORTED (current layer); `null` ⇒
   MODEL_DECLARATION_MISSING.
6. Coverage: a load listed in `covers[]` stays covered whatever its `status`
   (a stale covered set marks every covered load `unresolved(AGGREGATE_STALE)`,
   T-S-40/then[5]); `coversSnapshot: null` with a non-empty `covers[]` is
   stale, never fresh.
7. `1ph_2w_120` single_2w per-conductor is `{L1, null, null}`; `1ph_2w_240`
   is `{L1, L2, null}`; `polesLabel` is `null` for 2-wire supplies.
8. `createEmptySnapshot()` has `purpose: 'service'` (T-S-08 literal).
9. Migration re-derives its input problems from the structured record
   (`LEGACY_AMBIGUOUS` / `UNKNOWN_ENUM` for the voltage while `supply.topology`
   is null, `NOT_FINITE` for unparsable `sqFt` / `lcMeterVA`, laundry/AC
   unresolved items while the field is null) — never from prose notes.
10. `multifamily_220_84` qualification booleans declared `false` ⇒
    QUALIFICATION_FAILED `220.84(A)`; `existing_220_83` retained-data check
    mirrors 220.82 (floor area required).
11. Arithmetic that leaves the double range (overflow) is OUT_OF_RANGE at
    `measurement.reading.value`, INVALID_INPUT, layers cleared — never a
    non-finite number in the result.

## 6. Proof classes (kept separate in the test names and in the review report)

| Class | What is executed | Where |
|---|---|---|
| ENGINE (literal) | real `evaluate` vs literal expected, 128 pairs | `test/loadCalc.test.js` |
| ENGINE-L3 | qualification/rule negatives against the engine | `test/loadCalc.test.js` |
| ENGINE-GEN | 25 hand-written cases not used for design (`test/helpers/loadCalcExtraCases.js`) | `test/loadCalc.test.js` |
| ENGINE-DET | determinism, frozen input, no aliasing, precision invariance, 320 seeded property envelopes | `test/loadCalc.test.js` |
| L2 | structural boundary stops arithmetic (T-S-33 + malformed envelopes) | `test/loadCalc.test.js`, `test/loadCalcInput.test.js` |
| INPUT | strict ingress (T-S-37), field parsers (T-S-10/36/41/42 raw entries), validator on all 134 envelopes + 17 snapshots | `test/loadCalcInput.test.js` |
| STATE | T-S-08 empty state, 15 migration deep-equals, T-S-39 record, projection/staleness (T-S-40/40s/44), capture vs never-refresh, occupancy (T-S-01/06/16) | `test/loadCalcState.test.js` |
| MODEL | 32 T-A records as mathematics; engine number where the engine owns it | `test/loadCalcModel.test.js` |
| ORACLE | schema r21 + L4 + graph checker on the ACTUAL outputs (python3; skipped with reason when absent) | `test/loadCalcOracles.test.js`, `tools/loadcalc-contract-check.py` |
| R1 (B1-r1) | 25 explicit cases for R-B1-01..04 (`test/helpers/loadCalcR1Cases.js`), 15 of which fail on the delivered B1 | `test/loadCalcR1.test.js` |
| REVIEWER (B1-r1) | the independent reviewer's 36 regressions integrated unchanged (ROOT line only) | `test/loadCalcReviewRegressions.test.js` |
| MUTATION | 18 mutants on disposable copies, all killed; M10 killed only by ENGINE-GEN; M11–M18 (B1-r1) killed only by R1 | `test/loadCalcOracles.test.js`, harness `--mutants` |
| PURITY / BOUNDARY | no DOM/storage/network/time/random; not registered in builder or mobile.html | `test/loadCalcOracles.test.js` |

Schema validation in this environment used the included
`mini_jsonschema_r2` subset validator (python-jsonschema was not installed and
nothing was installed). Full Draft 2020-12 validation of
`review/proof/actual-pairs.json` is the reviewer's step; the adapter switches
to `Draft202012Validator` automatically when the package is importable.

A replayed post-action envelope proves the engine's output for that envelope,
not that a browser, reducer or storage produced it.

## 7. Per-ID coverage

`review/proof/coverage-map.json` lists all 169 r22 ids with their B1 proof
classes and the B2/later dependency. Summary: 114 engine literal pairs (+14
post-action replays), 15 migration transforms, 32 model records, 20 inactive
records (`T-P-01..15, 18..20`, `T-F-01/02`: `expected: null`, never executed
as PASS; `T-N-03`'s `futureExpected` retained, not asserted), 42 records that
additionally need B2 or later for their UI/persistence part.

## 8. B2 boundary and handoff

Not done in B1, by design:

* **Builder registration** — add `loadCalc.js`, `loadCalcState.js`,
  `loadCalcInput.js` to `tools/build-calc.js` MODULES in dependency order
  (state, input, engine) and add a generated-bundle parity test
  (`window.EC.loadCalc.evaluate` === source `evaluate` on the 128 pairs).
* **Form adapter / DOM parser events** — T-S-10a-c, T-S-36, T-S-41a-c,
  T-S-42a-c with real input events, focus policy (`docs/ui-focus-policy.md`),
  and the seven action cases (T-S-01/01b/02/03/06/16/17, T-S-40r) as real
  reducer/form actions; the pure helpers to call are `parseNumberField`,
  `parseEnumField`, `setOccupancy`, `captureCoversSnapshot` (only on the
  user's explicit re-entry of the term, never on evaluate).
* **Favorites persistence** — T-S-12 (save/reload without loss), T-S-39
  (legacy restore ⇒ `migrateLegacyRecord` ⇒ save-as-copy, original untouched),
  T-S-02/03/17/40r after-action storage; strict ingress via `parseStrictJson`.
* **Legacy route disabling in the UI** — methods other than `measured_220_87`
  render the UNSUPPORTED_SCOPE state; no fallback to old arithmetic.
* **Browser / physical iPhone gate** — unchanged milestone workflow.
* **Disposed (B1-r1)** — the §4 diagnostic field: the reviewer accepted the
  non-operative overlay for exactly T-S-16, T-S-40s, T-S-40s/then[0] and
  exactly `$.diagnostics.continuityOfNewLoadKnown` (`false` = the profile did
  not independently establish the continuity treatment; `null` = no counted
  term; never a statement that the user's `continuous: true` was removed).
  Accounting stays explicit: 125 exact matches + 3 accepted exceptions, no
  generic ignore list, no claim of 128 exact matches. B2 must not label it as
  a fact about the equipment.
* **Still for the reviewer** — the profile A boundary choices in §5 and the
  B1-r1 decisions in §9.

## 9. B1-r1 — bounded corrections for the independent review (R-B1-01..04)

Scope: runtime fixes in the three B1 modules, their tests/tools and this
overlay. Locked fixtures, schema r21, L4 and graph checkers, the contract copy
and all 84 application files are unchanged. The 128 historical pairs still
give 125 exact + 3 accepted diagnostic exceptions + 0 other.

### R-B1-01 — absent qualification properties (`loadCalc.js`)
* Before: `m.periodMonths === null` etc. — an **absent** key read as
  `undefined`, no problem was raised, and the annual / 30-day routes computed
  `COMPLETE/adequate` with an empty `problems` list. Explicit `null` and
  explicit failures were already correct.
* Fix: one accessor `field(o, k)` — absent key, `undefined` value and `null`
  are the same "not established"; no default is ever substituted (never 0, 12,
  30, 15). Applied to periodMonths, periodDays, intervalMinutes, connectedTo,
  every declared boolean, `existing.*`, powerFactor, readingScope,
  readingsPerConductor and reading.value. Absent ⇒ QUALIFICATION_UNKNOWN (or
  MISSING_FIELD for data fields) ⇒ INCOMPLETE_INPUT, no lines, no verdict;
  explicit unmet conditions stay QUALIFICATION_FAILED; valid controls unchanged.
* Note: an `undefined` **value** is not JSON and now stops at L2 (§R-B1-03);
  an absent **key** is schema-valid and is handled by L3 as above.

### R-B1-02 — per-conductor completeness (`loadCalc.js`)
* Before: the amperes path used whichever L1/L2/L3 keys were present and
  non-null; blanking L1 (140 A) on a split-phase map turned `175 A inadequate`
  into `55 A adequate` from L2 alone.
* Fix: `requiredConductors(topology)` — the ungrounded conductors of the
  declared supply: `1ph_2w_120` → L1; `1ph_2w_240`, `1ph_3w_120_240`,
  `1ph_3w_120_208_network` → L1, L2; every 3-ph topology → L1, L2, L3. Under
  `per_conductor` scope every required reading must be present and valid
  (absent/null ⇒ MISSING_FIELD `measurement.readingsPerConductor.<k>`,
  INCOMPLETE_INPUT, no lines, no verdict); a reading on a conductor the
  topology does not have ⇒ LEG_INVALID; no fictitious L3 is required on
  split-phase; missing is never zero and never replaced by `reading.value`.
  `highest_loaded_conductor` remains the distinct single-reading route
  (T-N-17, T-N-24..26 exact). The whole map null/absent ⇒ MISSING_FIELD
  `measurement.readingsPerConductor`. With an unknown topology no conductor
  requirement is invented (MISSING_FIELD supply.topology already blocks).
* Consequence for a B1 §5 choice: an L-N term aimed at a leg without a reading
  is now reported as the missing required reading (MISSING_FIELD), not as
  ASSOCIATION_UNKNOWN — the association is declared; the data is missing.
  T-N-14 (highest-loaded reading + L-N term) is unchanged: ASSOCIATION_UNKNOWN.

### R-B1-03 — safe integers and strict JSON object ingress (`loadCalcInput.js`)
* Before: `parseNumberField("9007199254740993", {integer:true})` returned
  `9007199254740992` as valid; `periodMonths = 2^53` passed L2 and computed;
  `[undefined]`, `[NaN]`, `[Infinity]`, `[function]` inside
  `multifamily.unitGroups` passed L2 (array items uninspected).
* Fix: integer fields require `Number.isSafeInteger` in the parser
  (OUT_OF_RANGE, `value: null`) and in the L2 `integer` type (SCHEMA_INVALID
  on the direct-object entry). Real-valued VA/A/kW/PF are untouched.
  `jsonRepresentabilityErrors` walks the entire input before any shape rule
  (see §2); a violation is a LoadCalcEnvelopeError, never a sanitized value.
  Hostile keys (`__proto__`, `constructor`) from JSON are data and pass;
  an object-literal `__proto__` sets a prototype and is a non-plain object,
  which is rejected on purpose. The `anyOf` reporter now names the closest
  branch's own errors (e.g. `measurement.periodMonths: expected integer|null`).

### R-B1-04 — migration finalization and controlled rejection (`loadCalcState.js`, `loadCalc.js`)
* Before: a valid 1,500 VA laundry item next to an edited 2,000 VA item
  yielded `laundryCircuits: 1` (partial count presented as final) while the
  unresolved item was kept; `evaluate` re-derived LEGACY_AMBIGUOUS only while
  the field was null, so the problem vanished. An unparseable list string
  became a trusted empty list with a prose note; an item with `va: null`
  produced a "successful" snapshot with `rating.value: null` (schema-invalid).
* Fix: count targets are finalized only when nothing aimed at them is
  unresolved. Otherwise the field stays `null`, the valid items remain in
  `transforms[]` as `applied` partial contributions (contribution 1, note
  naming the unresolved item ids), the unresolved items stay in
  `unresolvedItems[]`, `problems` carries LEGACY_AMBIGUOUS once per target, and
  the engine re-derives it once per (reason, target) while the field is null —
  in both list orders and after a JSON round trip. Setting the count manually
  closes the problem; the record keeps its unresolved items.
  Unparseable list text (not JSON / not an array / non-string value) and
  unrepresentable items (non-object, empty/non-string id, non-string
  name/category, non-finite or non-numeric va) are a **controlled rejection**:
  `LegacyRecordError` before any snapshot is built, all-or-nothing, record
  untouched. The alternative "explicit unresolved state" was not chosen because
  the locked `legacyItem` shape requires a numeric `va` and a string
  `category`, so such an item cannot be represented without inventing values,
  and an unparseable list has no items to attach an unresolved entry to.
  Blank/null/absent lists remain legitimately empty. The 15 fixture
  migrations and T-S-39 are byte-identical.

### Evidence classes added
R1 cases (25; 15 fail on delivered B1), the reviewer's 36 regressions
(15/21 → 36/0), reviewer probes before/after (`review/proof/probe-*`), eight
failure-specific mutants M11–M18 (each killed only by the R1 cases — the
historical pairs do not exercise these paths), unchanged external checks on
the actual outputs, and `npm run verify` on baseline and final trees.
