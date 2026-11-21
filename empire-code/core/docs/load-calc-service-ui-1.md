# Load Calc — SERVICE SIZING — DESIGN PREVIEW (LC-SERVICE-UI-1)

**Current persistence addition — LC-SERVICE-RESULT-STORE-1:** separate full historical records preserve the calculation inputs/response, explicit service design and original analysis. Saved service results are available on entry without Calculate and open without restoring or recalculating live state. Existing calculation presets/lcv3 remain unchanged. See `docs/load-calc-service-result-store-1.md` for the record/storage contract and verification boundary.

**Current presentation status — LC-QUALIFICATION-SEMANTICS-1:** bounded sandbox correction on the already bundled and integrated source155 UI. The change separates the ampacity-threshold description, changed-declaration review, missing comparison data and open model interpretation (§2b). Worker test status: **NOT_RUN_BY_WORKER**; coordinator verification is required before acceptance. It is an engineering preview, not a release, and nothing in it is an installation approval.

**Historical integration record:** LC-SERVICE-UI-1 was a review candidate on baseline 150 (`309470aa…357e`). Source155 already contains the panel, module registration and subsequent marks/presentation fixes. The nonintegration statements in `docs/load-calc-service-sizing-1.md` and `docs/load-calc-contract-82-addendum.md` describe their earlier stages; those historical documents and their contractual clauses are preserved byte-for-byte. Service-design persistence was absent at that historical presentation stage. The separate LC-SERVICE-RESULT-STORE-1 record feature described above does not change the calculation contract.

The historical LC-SERVICE-UI-1 integration added one visible panel under the NEC 220.82 Load Calc result. The panel is a thin UI over the unchanged R2 prototype `src/calc/loadCalcServiceSizing.js` (see `docs/load-calc-service-sizing-1.md`). The R2 module, its test, its doc and every other `src` module are byte-identical to baseline.

## 1. Files

| Path | Change |
|---|---|
| `tools/build-calc.js` | one registration: `loadCalcServiceSizing` → `calc/loadCalcServiceSizing.js`, last, after its dependencies `loadCalcInputV2` and `loadCalcFacade` |
| `mobile.html` | generated `EC-CALC` block rebuilt by `node tools/build-calc.js` (20 modules; never hand-edited); handwritten adapter block `LC-SERVICE-UI-1`; four one-line hooks; scoped CSS |
| `test/helpers/loadCalcDom.js` | exposure only: `LC_SVC`, `lcSvcAssess`, `lcSvcDesignObject` added to the exported adapter API |
| `test/loadCalcOracles.test.js` | build-registration assertion: explicit list + count 19 → 20 |
| `test/loadCalcParity.test.js` | build-registration assertion: `window.EC` identities and order + `loadCalcServiceSizing` |
| `test/loadCalcServiceUi.test.js` | new focused tests (LC-SERVICE-UI-MARKS-1: one obsolete design-edit assertion updated) |
| `test/loadCalcServiceUiMarks.test.js` | LC-SERVICE-UI-MARKS-1 live-validation regression tests |
| `tools/loadcalc-service-ui-check-mobile.cjs` | new browser gate (Playwright, when available) |
| `docs/load-calc-service-ui-1.md` | this document |
| `test/loadCalcServiceUiCleanup.test.js` | LC-SERVICE-UI-CLEANUP-1 results-presentation tests (§2a) |

The two existing-test deltas change only the build-registration list, because module 20 is now registered on purpose. No parity, engine or safety assertion was removed or weakened.

The four hooks in the existing adapter:
- `lcInit` appends the panel right after `#lcResult` (inside `#lcForm`, before the footer);
- `lcRenderResult` calls `lcSvcSync()` after its existing three steps;
- `lcCalcReset` (used by Reset and by preset restore) also calls `lcSvcReset()`;
- `lcCalculate` calls `lcSvcOnMainCalculate()` before its evaluation.

No calculation, state helper, storage format, Save/Restore path or 220.87 behaviour changed.

## 2. What the panel shows

It appears only on the `opt_220_82` route. It always shows:
- the title **SERVICE SIZING — DESIGN PREVIEW**;
- a permanent banner: *ENGINEERING PREVIEW — NOT INSTALLATION APPROVAL*;
- the scope: one-family dwelling service, single-phase 120/240 V three-wire, NEC 220.82. Other scopes are not supported **by this module**; that is a limit of the preview, not an NEC prohibition;
- *Service design settings are not saved with calculation presets.*;
- a note that the Load Calc result keeps Existing capacity, Required capacity and Rating as NOT ASSESSED. The preview is separate and never changes those result objects.

The rest depends on the state of the main calculation:

| State | Panel |
|---|---|
| before the first main Calculate | "Press Calculate first" — no controls, no minimum, no chosen assessment, no conductor |
| main result stale (any load-request change) | `Load inputs changed — press Recalculate, then reassess service sizing.`; every service number and all design controls hidden |
| fresh, but the module refuses the request (INCOMPLETE, PARTIAL, apartment, feeder, 120/208 with CURRENT — NOT COMPUTED, …) | *SERVICE SIZING UNAVAILABLE FOR THIS CALCULATION* with the module's own reasons; no current, minimum or conductor is guessed; the Load Calc result is untouched |
| module missing from the build | *SERVICE SIZING NOT AVAILABLE IN THIS BUILD*; Load Calc keeps working |
| fresh COMPLETE with computed current, in scope | the explicit design controls and a separate **Assess service sizing** button (**Reassess service sizing** after an attempt) |

**Eligibility is decided by the module, not by the adapter.** The adapter calls `analyzePrototype(request, null)` once per fresh request and module (cached) as a probe. Any minimum-stage reason other than `PREMISE_UNANSWERED` means "unavailable". With a `null` design the probe can never produce a minimum.

After an assessment the result has six headings, in this order:
1. **CALCULATED LOAD** — `calcBasis` display strings (total VA, line current as a reference, method, supply) and the declared 220.82(A) qualification ampacity.
2. **MINIMUM STANDARD DISCONNECT RATING** — `minimumService`: status, rating candidate, what governs it (the module's `floorA` or the calculated load), `meaning`, `comparison` and reasons.
3. **SELECTED MAIN RATING** — `chosenMain`. The chosen rating is shown separately from the minimum. A missing choice does not hide an available minimum: the panel says it is waiting for the choice. A rating below the minimum is reported without any automatic change.
4. **UNGROUNDED CONDUCTORS** — `ungroundedConductors`:
   - A top-level candidate is shown only when `recommendationAvailable === true` and `size !== null`. It is labelled *Design-preview conductor candidate (non-operative)*.
   - Otherwise `tableCandidate` is shown under *Conditional table reference — not a selection*, with the table (310.16 / 310.12), material, size and unit, table ampacity, rating, named path and the module's 83 % flag.
   - Conditions, reasons and `notSized` follow.
5. **QUALIFICATION CHECK** — declared qualification ampacity next to the candidate 75 °C ampacity:
   - a consistent `premise_unchanged` + `QUALIFICATION_PREMISE_UNCHANGED` return = the ampacity threshold is met in the current model and the declared premise is unchanged; not installation approval;
   - a consistent `revalidation_required` + `QUALIFICATION_PREMISE_CHANGED` return = the threshold is met, but the declared premise differs and needs review; changing the facts is a separate decision from comparing two numbers;
   - `review_required` + `B82_310_12_INTERPRETATION_PENDING` with valid below-threshold data = open B82 / conditional-sizing model interpretation, not an NEC violation finding;
   - `review_required` + `QUALIFICATION_PREMISE_UNAVAILABLE` with a missing/invalid declaration = comparison unavailable, not a 310.12 interpretation; all other invalid or inconsistent combinations use a neutral fallback. Full presentation conditions are in §2b.
6. **REMAINING CHECKS** — `remainingChecks`, then three separate parts:
   - *Received NEC text*;
   - *Model interpretation* (with the open items);
   - *Site and device approval* (not approved / not verified, plus the actual `operative` and `installationApproved` flags).

Reference numbers in module reasons are rendered with the existing source-aware helper (`lcRefFor` → `refSpanNode`). They use the same delegated click/Enter handler, with no new API call or network path.

## 2a. Results presentation (LC-SERVICE-UI-CLEANUP-1)

Presentation only. `lcSvcAnalyze`, `lcSvcAssess`, live validation, marks, gates, the calculation state machine, every `src/*` module, the generated `EC-CALC` block, storage formats and every number are unchanged. The rendered analysis is still exactly the module return.

**Default view (no click needed).** The same six headings, in the same order, reduced to what a reader acts on:
- CALCULATED LOAD: total VA, line current (reference only), method · supply.
- MINIMUM STANDARD DISCONNECT RATING: status, the minimum candidate, *A standard-rating candidate only — not an approved main breaker or equipment selection.*, and what governs it (with its 230.79(C) reference).
- SELECTED MAIN RATING: the explicit choice, its status, and the waiting / below-minimum / at-or-above note.
- UNGROUNDED CONDUCTORS: status, *Applies to: ungrounded conductors only*, and **one** result block:
  - `recommendationAvailable: true` — the non-operative candidate line (material, size, 75 °C ampacity, selected rating), then Table, Named path and the 83 % check when present, plus the "not an installation instruction" warning;
  - otherwise — *Conditional table reference — not a selection* heading the block with Table, Material, Size, Table ampacity, For the selected rating, Named path and the 83 % check.
  - A compact line of the lookup conditions as entered (terminations, insulation, ambient, CCC, sets, wiring method; never inferred).
- QUALIFICATION CHECK: both ampacities side by side; §2b separates the current-model ampacity threshold from the declared premise. A consistent changed-value return retains review and withholding. Only the specific below-threshold interpretation return is presented as unresolved interpretation; missing or inconsistent data are presented as comparison unavailable.
- REMAINING CHECKS — NOT COMPLETED HERE: a concise limits summary (ungrounded conductors only; neutral, grounding and bonding, voltage drop, short-circuit / fault current, equipment / device / listing, utility, NYC 230.43 wiring method and site verification are not completed), the installation-approval and global-compliance status, the count of open interpretation items, and a note that the full lists are in the details and that listing them does not mean they were checked.

Every reason row whose code is not one of seven known informational / duplicate codes stays in the default view. That covers each refusal, missing answer, input error, undersized rating and any unrecognized code. The seven codes are: `STANDARD_RATING_CANDIDATE`, `SELECTED_AT_OR_ABOVE_MINIMUM`, `TABLE_310_16_CANDIDATE`, `TABLE_310_12_CANDIDATE`, and the qualification duplicates `QUALIFICATION_PREMISE_UNCHANGED`, `QUALIFICATION_PREMISE_CHANGED`, `B82_310_12_INTERPRETATION_PENDING`. The gate states (before / stale / unavailable / missing / failed) and the design-stale notice are unchanged.

**Calculation details & sources.** One native disclosure, the last row of the result: a full-width `type=button` (`#lcSvcDetailsBtn`, text exactly *Calculation details & sources*, `aria-expanded`, `aria-controls="lcSvcDetails"`) and a `hidden` region (`role=region`, `aria-labelledby`). It holds, per stage:
- the declared 220.82(A) conductor ampacity line;
- the module `meaning` and `comparison` (`totalExactE4 …`);
- the original rows of the seven codes above, each with its source links;
- the table source status, the full conditions list and the full `notSized`;
- the qualification `note`;
- the full `remainingChecks`, the received-text status, the interpretation with the full `openInterpretation`, and the site/device approval line with the actual `operative` / `installationApproved` flags and the module `warning`.

Nothing that was inspectable before was deleted. The earlier second copy of material / size / ampacity / rating under *Table reference behind the candidate* was merged into the single candidate block.

The toggle only flips `aria-expanded` and `hidden`: no evaluation, state, storage, focus or scroll, and there is no custom key handler (Enter / Space are the native button). The disclosure is rebuilt closed on every render, so a new assessment shows it closed. Any load / design edit, Calculate, Reset, restore, route or scope change, fault or runtime error removes it together with the results. The CSS is scoped to `#lcContent .lc-svc-details*`, appended after the earlier rules: a ≥ 44 px wrapping button, `:focus-visible` outline, and `[hidden]` kept hidden.

The Load Calc footer wording now says that the Load Calc result selects no conductor or service rating and that the separate panel is a non-operative preview. Its reference targets (220.87 NEC + NYCEC, 220.82, 220.61) are unchanged.

## 2b. Qualification presentation (LC-QUALIFICATION-SEMANTICS-1)

This correction changes only the qualification presentation helpers and QUALIFICATION CHECK block in `mobile.html`, the existing Conductor ampacity help, this document, directly affected copy assertions in the two service UI tests, and the new `test/loadCalcQualificationSemantics.test.js`. All `src/**` files, the complete generated bundle, contract/state/schema/storage, selection availability and the Calculate/Recalculate/Assess lifecycle remain untouched.

The UI classifies only a consistent combination of the returned `q.status`, its single expected reason, and the returned declared/candidate/threshold data. It accepts numbers only when their type is number and they are finite; strings, null, undefined and nonfinite values are never coerced. The threshold comes from `q.b82SoftwareGateMinA`; no new fixed eligibility threshold is introduced. A nonpositive threshold/candidate, or a declaration below the returned threshold, cannot produce the positive summary. A known reason must have the minimal display shape (string code, nonempty string message, and an array of string sections). Unknown, extra, contradictory or malformed reason/status combinations get the neutral comparison-unavailable summary.

For consistent equal or different values meeting the returned threshold, the visible labels are:

- **Ampacity threshold: met in the current model**
- **Declared premise: unchanged** or **different — review needed**

The text explicitly limits that statement: *This ampacity check alone does not establish overall method qualification, adequate conductor capacity or code compliance.* The unchanged branch retains *Model premise unchanged — not installation approval*, including compatibility with the unchanged browser gate.

The different-value branch says that the difference alone does not alter the current model's calculated demand or current. The next step is to review what the declaration describes and the documented basis and conditions of the intended conductor set. The declaration should be updated only if those facts actually change or need correction, followed by the existing Recalculate and Reassess steps. Merely matching the table or repeating Reassess does not validate changed facts. The original `revalidation_required`, conditional table reference and withheld selection remain intact.

Only a consistent `review_required` / `B82_310_12_INTERPRETATION_PENDING` return with a valid below-threshold candidate receives the open-interpretation explanation. It states that the current threshold and conditional sizing relationship remains unresolved, that this is not an NEC violation finding, and that a documented interpretation/model decision is needed. Reassess or a convenient replacement declaration cannot settle it. No alternative hardware is prescribed.

A missing/invalid declaration accompanied by `QUALIFICATION_PREMISE_UNAVAILABLE` receives a comparison-unavailable explanation; it takes precedence over candidate threshold considerations. Other inconsistent data get a neutral summary without inferring a cause. `q === null` or `undefined` retains the earlier not-evaluated message; present but invalid `q` values such as false, zero, empty string or an array get the neutral fallback.

Both displayed values, their original object and provenance are retained. All raw qualification reason codes, messages, source references, status, threshold and `q.note` remain inspectable in **Qualification check — original module diagnostic** within the existing disclosure. Unknown reasons and missing-data diagnostics also stay visible by the established code-list policy; malformed reason data are visibly marked as unrecognized. `LC_SVC_DETAIL_CODES` is unchanged. No classification mutates the original analysis or sets a new flag.

The Conductor ampacity help now describes an identified conductor set under documented conditions, including a documented planned set for a new design. It distinguishes the value from the breaker or service rating and keeps unknown unknown. The current workflow still cannot begin a preliminary load calculation before that conductor premise is established; no new field, default, confirmation button or workaround is added.

### Reference cases encoded in the focused test (expected results, not execution evidence)

| Declared / path / selected rating | Expected qualification presentation |
|---|---|
| 200 A / general Cu / 200 A | Candidate table 200 A; threshold met; unchanged; existing non-operative candidate remains available |
| 230 A / general Cu / 200 A | Candidate table 200 A; threshold met; different premise; selection withheld |
| 200 A / dwelling Cu / 200 A | Candidate table 175 A; threshold met; different premise; selection withheld |
| 100 A / dwelling Cu / 200 A | Candidate table 175 A; same different-premise semantics in the opposite direction |
| 200 A / dwelling Cu or Al / 100 A | Candidate table 85 A or 90 A; open interpretation; selection withheld |
| 200 A / dwelling Cu or Al / 110 A | Candidate table 100 A; threshold met; different premise, not the below-threshold interpretation |
| Unknown or 99.99 A | Real B82 refusal occurs earlier; no service comparison or guessed result |
| 100 A with the higher-demand area witness | 39,880 VA, 166.166… A, 175 A minimum; a met ampacity predicate still does not assert conductor adequacy |

The ordinary B0 reference cases retain 23,680 VA / 98.7 A. The focused file distinguishes those real control/module flows from synthetic renderer-resilience injections. Synthetic cases cover every numeric field, unavailable declarations, conflicting/unknown/malformed reasons, invalid present `q`, hypothetical returned thresholds, raw diagnostics, state/export/provenance invariance, inert disclosure, unchanged field identity/placeholder and stale-result clearing.

**Evidence status:** `NOT_RUN_BY_WORKER`. The delegated implementer authored the cases and made no test, build, browser or native-device run. Coordinator focused tests, independent checks and full verification are separate evidence and must be recorded after execution. Earlier test counts below describe the earlier stages, not validation of this change.

**Still open:** the 100 A 220.82/310.12 interpretation, a preliminary-demand workflow without an identified conductor premise, and full service-result persistence. This presentation correction closes none of them, and makes no release or installation decision.

## 3. Design inputs (UI-only, ephemeral)

`LC_SVC.design` holds exactly the R2 keys. Every key starts as `null`, meaning unanswered; nothing is defaulted, including `selectedMainRatingA`.

| Key | Control | Values |
|---|---|---|
| `plan.intent` | `lcSvcIntent` | unanswered / *New design — not an existing-service assessment* |
| `plan.oneMainDisconnect`, `noAdditionalSources`, `wholeDwelling`, `singleConductorSet` | `lcSvcOneMainDisconnect` … | Yes / No / unknown |
| `selectedMainRatingA` | `lcSvcSelectedRating` "Selected main rating — design input" | options = module `STANDARD_RATINGS_SUBSET` |
| `conductor.sizingPath` | `lcSvcSizingPath` | `general_table_75C` / `dwelling_83pct_310_12` |
| `conductor.material` | `lcSvcMaterial` | Cu / Al |
| `conductor.terminationTempRatingC`, `insulationTempRatingC` | `lcSvcTermTemp`, `lcSvcInsulTemp` | 60 / 75 / 90 °C |
| `conductor.terminationMaterialCompatible`, `noOtherAdjustmentOrCorrection` | `lcSvcTermCompatible`, `lcSvcNoOtherAdj` | Yes / No / unknown |
| `conductor.ambientTempC`, `currentCarryingConductors` | `lcSvcAmbient`, `lcSvcCcc` | number inputs, placeholders `e.g. 30` / `e.g. 3` (examples only) |
| `conductor.wiringMethod` | `lcSvcWiringMethod` | raceway / Type MC / other |

Unsupported entries are sent as entered, and the module refuses them. Examples:
- 60 °C terminals → `TERMINATION_60C_UNSUPPORTED`; 90 °C terminals → `TERMINATION_TEMP_UNSUPPORTED`;
- Type MC → `WIRING_METHOD_MC_SERVICE_UNSUPPORTED`;
- 35 °C ambient, 4 or 2.5 CCC → the module's refusal codes;
- malformed numbers → `DESIGN_INVALID` / `INVALID_NUMBER`.

Nothing is silently normalized. The declared `optional82.conductorAmpacityA` appears separately, labelled as qualification only; it is never a breaker, installed rating or selected rating.

The live design state is not part of `lcDraft()`, `LC.snapshot`, the V2 request, `lcExportState()` or any calculation-preset payload. Preset Save and Restore bytes are identical with and without design state. LC-SERVICE-RESULT-STORE-1 separately snapshots it into explicit historical records; opening a record does not restore this live state.

## 4. Stale and clearing rules

- **Any load-request change** (field, card, method data, fault, INCOMPLETE/PARTIAL), and **any main Calculate/Recalculate**, removes the analysis, its errors and its marks immediately.
  - Reverting an edit brings back the unchanged main result (existing LC-UI-CALCULATE-1 behaviour) but **never** the service analysis. The panel then says the previous analysis was removed; a fresh assessment is required.
  - Design inputs are kept across load edits.
- **Any design edit** removes the analysis immediately and shows `Design inputs changed — reassess service sizing.`
  - It never calls `lcUpdate`, never touches the Load Calc result, and never moves focus or scrolls.
  - **Live validation (LC-SERVICE-UI-MARKS-1).** After the first Assess/Reassess, each design edit on a fresh, unfaulted, in-scope calculation re-marks the *current* actionable design problems. The marks come from a transient, validation-only call of the unchanged bundled `analyzePrototype` with the current request and the current design. The UI holds no required-field or code rules of its own.
    - Fields the edit resolved lose their mark. Missing, invalid or unsupported fields that still apply stay marked. Fields that now apply are marked.
    - Stages returned as `not_evaluated` and qualification reviews are never marked, so a gate change (missing rating, a negative plan answer, intent, sizing path) drops obsolete downstream marks.
    - The transient return is never stored as `LC_SVC.analysis`, never rendered and never persisted. No minimum, current, rating, size or table value appears until the next explicit Assess/Reassess. Reverting an edit does not bring an old result back.
    - A refusal of the selected rating (for example *below the minimum*) and a table-mapping refusal can quote a computed minimum or table value. During live validation these fields are marked with a reassess hint instead of the module message.
    - No marks appear before the first Assess, on a stale/missing/ineligible/faulted calculation, after a main Calculate, or after Reset, restore, leaving the route or a scope change. A design edit made while the load is stale does not arm live validation.
    - If the live call throws, or returns a malformed or not non-operative result, all marks and old output are cleared and a scoped *SERVICE SIZING FAILED* message is shown. The Load Calc result and focus are untouched. The next valid edit or Reassess recovers.
- **Reset, preset restore, leaving `opt_220_82`, and a scope change** (method, occupancy, purpose, supply topology) clear everything: design inputs, analysis, errors, marks and the attempted state.
- **Runtime or module faults** clear every service number and show a scoped *SERVICE SIZING FAILED* message. This covers a thrown `ServiceSizingPrototypeError` or `TypeError`, a probe that throws, and a returned result not marked non-operative (that result is refused, not rendered). Load Calc stays usable, and Reassess clears the old error.

## 5. Accessibility and layout

- Every design control is a native `select` or `input`. Each has a `<label for>`, an id under `lcSvc*`, and help text linked by `aria-describedby`.
- The Assess button is a native `type=button` with visible English text. Status messages use `role=status` / `aria-live=polite`.
- After an assessment, and after each later design edit (live validation, §4), the design controls the module named as missing or refused get:
  - a text message beside the control;
  - `aria-invalid`;
  - `aria-describedby` (help id + message id).
- Each re-render removes the previous message nodes and restores the help-only `aria-describedby`, so repeated edits never accumulate messages or ids.
- Stages the module returns as `not_evaluated` and qualification reviews are never marked as fields.
- Focus moves to the first marked control only when the assessment could not reach a minimum. It never moves on edits or on a successful assessment.
- The CSS is scoped to `#lcContent` and appended after the existing rules, so the MOBILE-HOV-1 order is unchanged. Fields keep the shared 16 px rule. There are no inline sizes, no zoom lock and no input opacity. Every box uses `min-width: 0` and wraps.

## 6. Tests and gates

- `node --test test/loadCalcServiceUi.test.js` — 30 tests. They run the real bundled API and the real adapter, comparing each rendered analysis with a direct `require('../src/calc/loadCalcServiceSizing.js').analyzePrototype(lastRequest, design)`. Coverage includes:
  - exact generated/source parity and baseline pins;
  - blank controls and the fresh-Calculate gate;
  - minimum shown while the rating is missing; explicit 100 / 200 A;
  - 310.12 at 100 A (Cu 4 / 85 A, Al 2 / 90 A: `review_required`); general 100 A Cu 3 / 100 A and 310.12 200 A Cu 2/0 / 175 A (`revalidation_required`); general 200 A Cu 3/0 / 200 A (`premise_unchanged`);
  - 120/208 current-only, apartment, feeder, PARTIAL, INCOMPLETE and the 220.87 route;
  - missing module, thrown errors, and fake-module rendering (proves the UI shows only module output);
  - stale handling for load and design edits, including edit/revert and Recalculate;
  - Reset, restore, route and scope clearing;
  - storage byte identity and no mutation;
  - labels, focus and error mapping;
  - no override and no escalation of a review to a violation;
  - no duplicated tables or formulas in the adapter.
- `node --test test/loadCalcServiceUiMarks.test.js` — 13 focused LC-SERVICE-UI-MARKS-1 tests. Coverage includes:
  - no marks before the first Assess;
  - the reported 9 → 8 → 7 sequence (exact ids, `aria-invalid`, messages; analysis stays null with the design-stale notice);
  - marks reaching 0 before Reassess with no service output, then Reassess equal to a direct module call;
  - 60 °C / 40 °C refusals kept through other edits on both paths, cleared when corrected, marked again when emptied or invalid;
  - gate-change applicability, and an undersized rating marked without its computed minimum;
  - load edit/revert, Calculate, Reset, restore, method/scope switch and storage bytes;
  - hidden numbers after a displayed candidate, with the main result unchanged;
  - throw / malformed / bad-shape / false-approval faults with recovery;
  - repeated edits without message or id build-up, focus or scroll.
- One existing assertion in `test/loadCalcServiceUi.test.js` was updated: after answering one of four marked plan premises, the remaining three stay marked (previously all marks were cleared — the reported regression).
- `tools/loadcalc-service-ui-check-mobile.cjs` — Chromium at 320/375/390/430 px and desktop. It checks fields, placeholders, the gate, the result states and layout. In this sandbox it reports **BLOCKED** because Playwright is not installed, and nothing was installed. Chromium emulation would not be native Safari or iPhone evidence in any case.

- `node --test test/loadCalcServiceUiCleanup.test.js` — 31 LC-SERVICE-UI-CLEANUP-1 tests (§2a). Default-visible text is computed with hidden subtrees excluded. Coverage includes the four acceptance scenarios against a direct module call, problems outside the closed disclosure (including an unrecognized code), the toggle being inert, reference activation inside the details, closed-on-reassess, clearing on stale / reset / restore / scope / fault, scoped CSS, the 9 → 8 → 7 marks, storage bytes and the footer references. The existing service tests needed no change. The browser gate reads `innerText`, so it sees only the default view, which still holds every string it checks.

Pending outside this sandbox:
- a real-browser run of the gate;
- native iPhone / Safari device checks;
- human engineering review of the preview wording.

Receipts for the focused runs and the single full verification are in the coordination directory of this task.
