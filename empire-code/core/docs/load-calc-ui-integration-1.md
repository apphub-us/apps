# Load Calc — UI integration of the accepted 220.82 route (LC-22082-B0-UI-INTEGRATION-1)

Companion to `docs/load-calc-contract.md`, `docs/load-calc-contract-82-addendum.md`,
`docs/load-calc-integration-1.md` (core R3 / facade) and the STATE-STORE-1-R2 module
notes. This file records what the UI integration built, the decisions the accepted
modules leave to the adapter, the migrations applied to historical tests, and what is
**not** claimed. Sandbox only: nothing here is installed, published or activated.

## 1. Scope

- The Load Calc form (`mobile.html`, adapter block between `LOAD CALCULATION — EC-CALC-2 / B2
  thin adapter` and `FAVORITES SYSTEM`, plus the `lc` branches of `favGetValues`/`favSetValues`
  and the scoped `#lcContent` styles) now holds the accepted **V2 five-field draft**
  (`snapshot` 3.3.0, `context`, `fieldErrors`, `loadErrors`, `sourceFavId`) and evaluates
  every state through **one** call site: `core.loadCalcFacade.evaluateV2(toRequestV2(draft))`.
- `opt_220_82` is a computed route (profile `B82_core1`) inside the bundle. The four
  measured / A routes are unchanged and byte-equal to direct `loadCalc.evaluate` on the
  accepted A projection (`loadCalcInputV2.downConvertToA`). `existing_220_83`,
  `multifamily_220_84`, `standard_part_III` remain retained + `UNSUPPORTED_SCOPE`.
- Favorites save the accepted **lcv-3** wrapper (`toPayloadV3`); restore classifies each
  stored record (`classifyStoredRecord`) and either restores lcv-3 (`restorePayloadV3`)
  or upgrades legacy / lcv-2 records (`upgradeToDraftV2`) as a **new** draft with an
  unconfirmed import (`context.methodConfirmedAfterImport === false`). Nothing is ever
  upgraded in place; every Save appends.
- `tools/build-calc.js` registers the five accepted modules after the three A modules,
  in dependency order: `loadCalcInputV2`, `loadCalcOpt82`, `loadCalcFacade`,
  `loadCalcStateV2`, `loadCalcStorageV2`. Two consecutive builds are byte-identical;
  `build:check` passes. No source module, fixture, schema, checker, service worker or
  package file was modified (proof: `proof/pretask-protected-integrity.txt`).

The released app is untouched (`opt_220_82` stays inactive there); this bundle only
exists in the review package.

## 2. Adapter design (decisions the accepted modules leave open)

| Decision | Choice | Why |
|---|---|---|
| Draft mutation | `lcTxn`: validate original via `toRequestV2`, deep-clone, mutate, validate again, publish; refusal → controlled `input` fault, draft untouched | single-key transaction; no partial state |
| Accepted helpers as the only writers | `setOccupancy`, `captureCoversSnapshot`, `setInclusionAnswer`, `setCoverageAnswer`, `setInventoryAnswer`, `markBasisChanged`, `newLoadRecord`, `cloneLoadRecord`, … | no parallel arithmetic / no re-implemented invariants in the UI |
| Id allocation | deterministic `L<n>` / `bs-<id>-<n>`, scanning records, retained fact bases and inventory members | equal bases across records are not a structural refusal; the allocator must never *create* a collision |
| Blank numeric field | plain `null`, no error entry; engine reports `MISSING_FIELD` | keeps parse errors for real malformed text only |
| Malformed numeric text | raw kept in `fieldErrors` / `loadErrors`, previous structural number retained, parse error transported in `parseErrors` | badInput transport per contract |
| Category change | old fact retained (dormant) under its predicate; a new predicate shows unanswered | the old answer is never reused for a different question |
| Structural rebuild | only on structural change (add / clone / remove / restore / method-driven visibility); answers, declarations and the import confirmation update in place | focus, caret and raw text survive |
| Rendering | text nodes and attribute-only reference spans (`refSpanNode`); no `innerHTML`; references through the shared source-aware layer (`NEC 2020` / `NYCEC 2025` are distinct targets) | inert hostile text; one send per click |
| Status families | `COMPLETE` → total + current; `PARTIAL` → `GENERAL-LOAD SUBTOTAL` only (or nothing); `not_computed` current → `CURRENT — NOT COMPUTED` box, VA shown; every non-success clears the operative total | no stale success under any failure |
| Storage faults | controlled `storage` fault replaces the result area; draft kept; nothing written; original store bytes untouched | atomic |

## 3. Migrated historical assertions

Every historical UI test still runs; no case was deleted. Each migrated assertion is
listed in `proof/test-obligation-ledger.md` (items L-2 … L-17) with the old obligation,
what changed, the replacement, and where the guarantee is now enforced. The recurring
pattern: an A-only expectation (contract empty snapshot, lcv-2 wrapper, `UNSUPPORTED_SCOPE`
for `opt_220_82`, `DUPLICATE_ID` from the engine, `LEGACY_AMBIGUOUS` on the 82 route)
becomes its accepted V2 equivalent while the A guarantee is kept on the A route.

## 4. Evidence

- `test/loadCalcIntegration82.test.js` (17) — real form path, editing, A preservation,
  output families, bundle/dependency; R3 checker on fresh UI pairs (0 violations).
- `test/loadCalcIntegration82Storage.test.js` (9) — lcv-3 round trips, old formats and their
  guards, transaction negatives (simulated quota/read failures are **simulated**).
- `tools/loadcalc82-check-mobile.js` — real Chromium (Playwright): 25 checks, 0 FAIL,
  screenshots and storage JSON in `proof/browser82/`. Chromium viewport emulation is
  **not** WebKit / iOS Safari.
- Historical suites: 150 UI-coupled tests, 43 state/storage, 287 core/facade. Full
  `npm run verify`: **1964 pass / 0 fail, exit 0** — the two module-count assertions
  (`test/loadCalcOracles.test.js`, `test/loadCalcParity.test.js`) were migrated under the
  explicit R1 exception (ledger L-16/L-17, now executed). `build:check` passes separately too.

## 4a. R1 corrections (LC-22082-B0-UI-INTEGRATION-1-R1)

| # | Correction | Where |
|---|---|---|
| U1 | The two module-list assertions migrated to 19 registered modules / the exact `window.EC` order (executed, no `>=`, no derived list, no removed assertion) | `test/loadCalcOracles.test.js`, `test/loadCalcParity.test.js` |
| U2 | A valid explicit answer clears **only** its own parser-error slot: `lcParseBoolControl` (accepted enum semantics) + `lcApplyAnswer(res, what, slot)`, which clears the one applicable map entry on the helper's candidate draft, revalidates the complete candidate and publishes atomically. Wired to the inventory, inclusion and coverage answers and to the shared `lcSetDecl` / `lcSetNullableBool` declaration controls. Accepted setters unchanged; restore, render, recommendation and method switches still clear nothing | `mobile.html` |
| U3 | `basisIdByLoadId` is built as an own-key dictionary (`lcDict` / `lcPut`), so a record id such as `__proto__` becomes a real own key. Classification, old-contract validation and the authoritative upgrade stay in the pure importer; fresh unique basis ids, unconfirmed premises and the existing distinct refusals are unchanged | `mobile.html` |
| U4 | The two NYC provisions in the 220.82 help now carry the amendment phrase the shared linker recognises, so each offers an `nycec/2025` target beside the `nec/2020` one; `lcRefTitle()` makes the AI context follow the current task (220.82 on the optional route, 220.87 on A), with the statically built 82 controls pinned to the 220.82 context; the per-record inclusion help renders controlled targets through `lcSetRich` with full section numbers; the method label states the bounded capability | `mobile.html` |

Limits of the 220.82 route are now stated in the menu itself: one dwelling unit,
air-conditioning-only arrangement, one A/C record. No new electrical calculation, no new
source, no expanded method/HVAC support.

## 5. Not claimed

- No WebKit / iOS Safari evidence; the horizontal-motion item remains
  `NOT_REPRODUCED_IN_LAST_CAPTURE_NOT_FIXED`.
- No real storage-pressure test (quota failures are simulated by the synthetic store).
- The pre-existing `.lc-x` remove buttons keep their accepted 13 px / 21 px size; only the
  controls added by this task were sized for touch (≥ 30 px).
- Not self-approved. Release, install and activation flags stay `false`.
