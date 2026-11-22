# Stage 4 — qualification workflow for a new design (core contract)

Audit item G-02. Core only: `core/src/calc/loadCalcOpt82.js`, `loadCalcFacade.js`, `loadCalcServiceSizing.js`.
No UI, storage format, build or generated file is part of this delivery.

## 1. Problem and boundary

The 220.82 engine requires `optional82.conductorAmpacityA` (software gate: at least 100 A) before it calculates, and the
service-sizing prototype requires a COMPLETE calculation before it looks up a conductor. A new design therefore could not
reach a conductor candidate without inventing the ampacity of a conductor that had not been chosen yet.

Stage 4 adds a separate, explicit route. It does not change any existing result:

| Entry point | Status |
| --- | --- |
| `loadCalcOpt82.evaluate82`, `loadCalcFacade.evaluateV2`, `loadCalcServiceSizing.analyzePrototype` | behaviour and output contract unchanged; an unknown ampacity is still `INCOMPLETE_INPUT` / `QUALIFICATION_UNKNOWN` |
| `loadCalcOpt82.evaluatePreliminary82(envelope82)` | new |
| `loadCalcFacade.evaluatePreliminaryV2(request)` | new |
| `loadCalcServiceSizing.analyzePreliminaryPrototype(request, design?)` | new |
| `loadCalcServiceSizing.adoptPlannedConductorDeclaration({ request, design, preliminary, confirmation })` | new |
| `loadCalcServiceSizing.isPlannedConductorDeclaration(declaration)` | new, read-only classification |

Nothing here is an installation approval. Every sizing and adoption result carries `operative: false`,
`installationApproved: false`, `globalCodeCompliance: 'not_verified'`, as before. The design intent remains
`new_design_candidate` only.

## 2. What may be deferred

Exactly one condition: `snapshot.optional82.conductorAmpacityA.value === null` with **no** parser error on
`optional82.conductorAmpacityA.value`.

Not deferred, on any route:

- a parser error on the ampacity field (malformed raw text stays `INVALID_INPUT` / `INCOMPLETE_INPUT`; it never becomes the
  allowed unknown);
- an ampacity value that is present, whatever it is (200, 99, 99.999 …): the preliminary route answers
  `PRELIMINARY_NOT_APPLICABLE` and evaluates nothing;
- every other stage-1 check: method/capability, occupancy scope, engine-owned source rules (`RULE_PENDING`), topology,
  single supply set, dwelling inputs, HVAC arrangement and records, premises, inventory, import confirmation, load data;
- unresolved load coverage (the ordinary `PARTIAL` family);
- service scope and plan fidelity in the sizing stages (purpose, one-family occupancy, 120/240 V, plan premises, chosen
  rating, conductor conditions).

No ampacity number is injected to pass the ordinary engine. The engine run is one shared function
(`runEngine(envelope, ruleStatus, deferConductorAmpacity)`); the flag is an internal boolean set only by the preliminary
evaluator and never read from a request. Stage 2 and stage 3 arithmetic is the same code for both routes.

## 3. Preliminary calculation result (`evaluatePreliminaryV2`)

`{ facade, result }`; `facade` has the ordinary six keys plus `resultKind: 'B82_PRELIMINARY_NEW_DESIGN'`.
A structurally invalid request throws `LoadCalcEnvelopeError`, as on the ordinary route. A request that does not select
`opt_220_82` is refused by the same route (`CAPABILITY_DISABLED` at `method.selected`); there is no preliminary 220.87 path.

`result` (deep-frozen):

```
kind: 'B82_PRELIMINARY_NEW_DESIGN', preliminaryContractRevision: 1,
schemaVersion, ruleBasis, profileId,
status: 'PRELIMINARY_QUALIFICATION_PENDING' | 'PRELIMINARY_BLOCKED' | 'PRELIMINARY_NOT_APPLICABLE',
blockingStatus: null | <ordinary refusal class, e.g. 'INCOMPLETE_INPUT', 'PARTIAL'>,
ordinaryResult: false, qualificationEstablished: false, operative: false,
deferred: [ { code: 'CONDUCTOR_AMPACITY_QUALIFICATION_DEFERRED', deferredEngineCode: 'QUALIFICATION_UNKNOWN',
              field: 'optional82.conductorAmpacityA', layer, source, ruleRef: '220.82(A)', gateMinA: 100, message } ],   // pending only
problems, loadsCoverage, demand, current, diagnostics, display, presentation, references,   // the shared stage outputs
nextAction: { code, field, message }
```

It is never an ordinary result: the status is never `COMPLETE`, there are no `existingCapacity` / `requiredCapacity` /
`rating` blocks, `presentation.finalResultHeading` is `false` and `verdictLabel` is `null`.
For B0 with an unknown ampacity: 23 680 VA (`totalExactE4` 236800000), 98.666… A at 240 V, one deferred condition.

## 4. Preliminary sizing analysis (`analyzePreliminaryPrototype`)

Same design object, same three stages and tables as `analyzePrototype`. Deep-frozen result:

```
prototypeId, operative: false, ruleReview, installationApproved: false, globalCodeCompliance: 'not_verified', sourceReview,
kind: 'SERVICE_SIZING_PRELIMINARY_NEW_DESIGN', preliminaryContractRevision: 1,
status: 'PRELIMINARY_EVALUATED' | 'PRELIMINARY_BLOCKED' | 'PRELIMINARY_NOT_APPLICABLE'
      | 'PRELIMINARY_REQUEST_INVALID' | 'PRELIMINARY_DESIGN_INVALID',
qualificationPending, fullResultRecordEligible: false,
calcBasis (calcStatus is the preliminary status), qualificationEcho (conductorAmpacityA: null when pending),
preliminaryCalculation: { kind, status, blockingStatus, deferred, problems, nextAction } | null,
minimumService, chosenMain, ungroundedConductors   // ordinary stage objects + { preliminary: true, conditionalOn: [...] }
designProblems, deferredConditions[], adoption, nextAction: { code, message, fields[] },
binding: { algorithm, requestFingerprint, designFingerprint, fingerprint } | null,
remainingChecks
```

Conductor stage when a table row is found: `status: 'table_candidate_conditional'`, `recommendationAvailable: false`,
`size: null`, the table fact in `tableCandidate`, and `qualificationConsistency.status`:

- `deferred_pending_declaration` — the candidate's 75 °C ampacity is at or above the gate; `adoption.available: true`;
- `review_required` with `B82_310_12_INTERPRETATION_PENDING` — the candidate is below the gate (main 100 A, 310.12:
  Cu #4 / 85 A, Al #2 / 90 A). This remains an open model/premise interpretation item. It is not replaced by 100 A, it
  is not reported as a finding against 310.12 use, and `adoption.available` is `false`.

`nextAction.code`: `FIX_REQUEST`, `FIX_DESIGN_INPUT`, `USE_ORDINARY_ANALYSIS`, `RESOLVE_CALCULATION_BLOCKERS`,
`COMPLETE_SERVICE_DESIGN_INPUT`, `CONFIRM_PLANNED_CONDUCTOR_DECLARATION`, `INTERPRETATION_REVIEW_REQUIRED`.

## 5. Explicit adoption and recheck (`adoptPlannedConductorDeclaration`)

Arguments: the caller's **current** `request` and `design`, the `preliminary` result the user reviewed, and
`confirmation: { action: 'ADOPT_PLANNED_CONDUCTOR_DECLARATION', expectedFingerprint, expectedAmpacityA }`.

Order of checks (first failure is returned as `status: 'ADOPTION_REFUSED'`, with `reasons[0].code`):

1. `ADOPTION_ARGUMENTS_INVALID` — not a plain object, or an unknown argument key.
2. `EXPLICIT_CONFIRMATION_REQUIRED` — missing, wrong action, or an unknown confirmation key.
3. `PRELIMINARY_RESULT_REQUIRED` — not a preliminary sizing analysis.
4. The preliminary analysis is recomputed from the current request and design.
   `REQUEST_INVALID`; `EXISTING_CONDUCTOR_DECLARATION_NOT_REPLACED` (the request carries any ampacity value);
   `DESIGN_INVALID`.
5. `STALE_BINDING_FINGERPRINT` — confirmed or supplied fingerprint differs from the recomputed one.
6. `STALE_PRELIMINARY_RESULT` — the supplied result is not exactly the recomputed one (canonical text comparison; this,
   not the fingerprint, is the authority).
7. `PRELIMINARY_NOT_ADOPTABLE`, `NO_CONDITIONAL_CANDIDATE`, `CANDIDATE_BELOW_B82_GATE_REVIEW_REQUIRED`.
8. `CONFIRMED_AMPACITY_MISMATCH` — the confirmation must restate the candidate ampacity; it is not a number source.
9. `ADOPTION_RECHECK_INCONSISTENT` — the ordinary rerun did not reproduce the reviewed result.

On success (`status: 'ADOPTED_AND_RECHECKED'`, deep-frozen):

```
before: { conductorAmpacityA (original), requestFingerprint, designFingerprint, preliminaryFingerprint, preliminaryStatus, totalVA, totalExactE4, lineA }
after:  { conductorAmpacityA: { value, provenance: { source: 'designer_declaration', note } }, requestFingerprint, designFingerprint,
          calcStatus, totalVA, totalExactE4, lineA, qualificationStatus, recommendationAvailable }
plannedDeclaration: { declarationKind: 'planned_new_design_conductor', ampacityA, inspectedOrInstalledFact: false, provenanceSource, notePrefix, candidate, conditions, confirmedBy }
provenanceNote, adoptedRequest, response, analysis, recheck, reasons, nextAction
```

`adoptedRequest` is a new object: the original request with only the one declaration replaced. The caller's objects are
never modified. `response` is `evaluateV2(adoptedRequest)` and `analysis` is `analyzePrototype(adoptedRequest, design)` —
the ordinary, unchanged outputs, which decide everything.

B0, main 200 A, 310.12, Cu: planned 175 A (2/0) → ordinary `COMPLETE`, 23 680 VA, `premise_unchanged`, flags still false.

### Planned declaration: provenance

The existing declaration contract is used as is; no schema or enum extension is needed.
`provenance.source` is the existing `designer_declaration`; `provenance.note` (existing nullable string) is the documented
text, prefixed `PLANNED_NEW_DESIGN_CONDUCTOR/1:`, stating that the set is planned (not inspected, not installed), the
table basis, the entered design conditions and the preliminary binding fingerprint. It grants and verifies nothing.

The declared value equals the candidate's 75 °C table ampacity, so the ordinary consistency check reports
`premise_unchanged`. That is a statement about the software premise only; `remainingChecks` still lists the 220.82(A)
revalidation whenever the installed conductor differs.

## 6. Persistence (`loadCalcServiceRecord` v1 — not modified)

- A preliminary pair or analysis cannot be saved: `createRecord` requires an ordinary `COMPLETE` response and an
  `EVALUATED` / `DESIGN_INVALID` analysis, and compares both with the ordinary engines; the structural v1 reader rejects
  the preliminary statuses and the extra keys.
- After a valid adoption, the ordinary v1 save works. The planned note is stored inside the lcv-3 draft snapshot as
  ordinary data and round-trips verbatim.
- Historic records (for example declared 200 A with a 175 A candidate, `revalidation_required`) keep their original
  values and status. Reading is structural only; nothing is recomputed or reinterpreted, and nothing in this stage runs
  on read.

## 7. Binding and UI requirements (UI is a later delivery)

- `binding.fingerprint` covers the exact request and design (`fp1`: two FNV-1a 32-bit passes plus length over canonical
  JSON). It is a non-cryptographic change detector, not a signature.
- Change-then-revert restores the same fingerprint. The required rule "invalidate the preview and its actions on any
  load, design or mode change, even change-then-revert" must therefore be event-based in the UI (discard the held
  preliminary result on every such event); the fingerprint is a second line of defence, not the trigger.
- At confirmation time the UI passes its current request and design, the held preliminary result, and a confirmation
  built from what the user actually saw (`binding.fingerprint`, `adoption.candidateAmpacityA`).
- After success the UI writes `after.conductorAmpacityA` (value and provenance, unchanged) into its own draft, checks that
  the projected request equals `adoptedRequest`, and shows `response` / `analysis` as the ordinary result.
- Any later manual edit of the ampacity field is a new caller declaration: the planned note must be dropped
  (`isPlannedConductorDeclaration` identifies it).
- The preliminary result must be labelled as preliminary and must not offer Save.

## 8. Tests

`core/test/stage4Qualification.test.js` (authored, not executed by the author). Fixtures: `LC82-cases-r1.json`; drafts and
records through the accepted State / Record APIs. The ordinary evaluator is used as the oracle for every non-L2 fixture.

## 9. UI integration (STAGE4-UI)

Delivered in `core/mobile.html` and `candidate/browser/workspace/mobile.html`, outside the generated calculator block, with
identical code in both pages. Tests: `core/test/stage4QualificationUi.test.js` (authored, not executed by the author).
The UI is a thin layer over §3–§5: it holds no demand, current, rating, table, threshold or gate of its own.

### 9.1 Mode (UI state, not data)

- Control `#lcQualMode` ("Conductor workflow") in the NEC 220.82 section, directly above "Conductor ampacity (A)":
  `existing` (default — "Check an existing or declared conductor") or `new_design` ("Plan a new supply — conductor not
  chosen yet").
- The mode lives in `LC_PRE.mode`. It is not part of the draft, the request, `lcExportState()`, a preset payload or a
  saved record, and no schema changed. Reset and a preset restore/import return to `existing`.
- Choosing a mode evaluates nothing and writes nothing: an existing declaration is never erased, filled in or replaced.
- In the default mode every existing behaviour is unchanged, including the ordinary refusal of an unknown ampacity
  (`INCOMPLETE_INPUT` / `QUALIFICATION_UNKNOWN`).

### 9.2 Preliminary check

- Shown in `#lcPre` inside the SERVICE SIZING panel, only in the `new_design` mode. While the draft's ampacity value is
  `null`, the shared design inputs (`#lcSvcControls`) stay available and the ordinary "Assess" button is hidden.
- "Unknown" is decided by the engine, not by the UI: the action is offered whenever the stored value is `null`; a malformed
  entry (parser error) is announced and then refused by the canonical route. With a value present there is no action,
  only the explanation that the ordinary analysis applies and that nothing is replaced.
- The explicit action `#lcPreRunBtn` makes ONE call:
  `analyzePreliminaryPrototype(toRequestV2(currentDraft).request, currentDesign)` (which runs `evaluatePreliminaryV2`).
  Nothing preliminary is computed before the button is pressed.
- The result is held in `LC_PRE.result` only. It is never placed in `LC.result` / `LC_SVC.analysis`, so it cannot reach
  "Save full result" (`fullResultRecordEligible: false` is also checked before anything is shown) and it is not part of a
  preset. A result that is not a preliminary analysis, not non-operative, or that carries a selection is not rendered.
- Rendered: status banner (never COMPLETE), preliminary demand and current (the module's display strings), the engine's
  own problems, the deferred 220.82(A) condition, the three shared stages, the conditional table reference, the pending
  qualification, `nextAction` with the inputs it names, and the remaining-checks note.
- On another method the 220.82 panel is hidden; `#lcPreRoute` states that the preliminary route exists only for
  `opt_220_82`, offers the same action (which returns the engine's refusal) and a button back to the default mode.

### 9.3 Explicit adoption

- `#lcPreAdoptBtn` exists only when `adoption.available === true` for the result on screen. Its text names the displayed
  candidate and ampacity ("Record planned declaration: Copper (Cu) 2/0 AWG — 175 A"); the adjacent text says it is a
  PLANNED declaration, not an inspected or installed conductor and not an acceptance of code compliance.
- Pressing it calls `adoptPlannedConductorDeclaration` with the request projected from the CURRENT draft, the CURRENT
  design, the held result, and `{ action: ADOPTION_CONFIRMATION_ACTION, expectedFingerprint: result.binding.fingerprint,
  expectedAmpacityA: result.adoption.candidateAmpacityA }`. Nothing adopts automatically.
- Refusal: `reasons[0].message` and `nextAction.message` are shown; the draft is not touched; the held result is dropped.
- Success: `after.conductorAmpacityA` (value and provenance note, unchanged) is written into a copy of the draft; the copy
  must project to exactly `adoptedRequest` (otherwise nothing is published); then `response` and `analysis` are shown as
  the ordinary result exactly as returned (no second evaluation). The ordinary Save paths then apply their normal guards.
- 85 A / 90 A candidates (`CANDIDATE_BELOW_B82_GATE_REVIEW_REQUIRED`): "Interpretation review required", the module's
  message, no button, no substituted value.

### 9.4 Invalidation

`lcPreInvalidate()` drops the held result, any refusal/adoption notice and (through the dropped object and an epoch
counter captured by the button) every confirmation. It is event-based and runs on: every published draft (`lcPublish` —
all field, load-record, premise, method, restore, import and Reset paths), every evaluation trigger (`lcUpdate`, including
a main Calculate), every design edit (`lcSvcSetDesign`) and design reset (`lcSvcReset`), every mode change, a controlled
fault and a failed panel render. An edit that is reverted to the same values therefore still requires a new check; the
fingerprint is only the helper's second line of defence.

### 9.5 Planned provenance

- A manual entry in "Conductor ampacity (A)" is a new caller declaration: in the same transaction the planned note is set
  to `null` when `isPlannedConductorDeclaration` identifies it — also when the same number is typed again.
- Display (classification by `isPlannedConductorDeclaration`, prefix never shown): a note under the ampacity field, a
  note in the QUALIFICATION CHECK box ("Unchanged" compares the candidate with the planned declaration only; it does
  not verify a physical installation) and the recorded note text in the details. Saved records show the same from their
  own stored request; nothing is recomputed or reinterpreted on read, and records without the note render as before.

