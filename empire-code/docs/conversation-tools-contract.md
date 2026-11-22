# Stage 5 — conversational calculator registry (core contract)

Module: `core/src/calc/conversationTools.js` (pure CommonJS). Tests: `core/test/stage5Tools.test.js` (authored, not executed
by the author). No UI, server, storage, build script or generated file is part of this delivery.
Registry correction 1 (re-hydration fidelity, context-only battery opt-in, unknown engine statuses) is included; see
`authors/stage5-registry-correction/NOTES.txt`. The public function and constant names are unchanged.

## 1. Purpose and boundary

The registry is a narrow typed allowlist between an interpreted conversation and the existing deterministic engines.

- The conversation side states **input changes** for a named tool. Nothing else: no results, formulas, JavaScript,
  endpoints, record or persistence identifiers. There is no free-form JSON argument anywhere in the model-facing schemas.
- The registry validates the change against a closed schema, merges it into an immutable draft and, when no required
  value is missing, calls the **one canonical engine export** for that tool. Every number, verdict, warning and
  reference in a result comes from that engine's return value. No formula or table is copied into the registry.
- A registry result is not an installation approval and is never a Service Sizing record. Every result carries
  `flags.installationApproved: false`, `flags.approval: 'none'`, `flags.serviceSizingRecord: false`,
  `flags.persistence: 'conversation_only'`. The registry writes nothing; the caller keeps drafts/results in the
  conversation.
- Pure: no DOM, storage, network, clock or randomness at import or at execution. Current-form values reach the registry
  only when the caller passes them explicitly (`importFormInput` / `origin: 'current_form'`); nothing is scraped.
- The stage-4 adoption helper (`adoptPlannedConductorDeclaration`) is never called and not exposed. A preliminary result
  only reports that adoption exists as a later, user-confirmed UI step (`nextAction.adoption.performedHere: false`,
  `modelCallable: false`).

## 2. Tools

| Tool id | Engine export | Input mode |
| --- | --- | --- |
| `battery_runtime` | `batteryRuntime.calculateBatteryRuntime` | typed patch |
| `wire_sizing` | `wireSizing.selectConductor` | typed patch |
| `ampacity` | `ampacity.calculateAmpacity` | typed patch |
| `voltage_drop` | `voltageDrop.calculateVoltageDrop` (one explicit conductor) | typed patch |
| `conduit_fill` / `conduit_fill_mixed` / `wireway_fill` | `conduitFill.calculateConduitFill` / `…Mixed` / `calculateWirewayFill` | typed patch |
| `box_fill` | `boxFill.calculateBoxFill` (always `contract: 2`, `ruleBasis` from the module) | typed patch |
| `motor_circuit` | `motor.calculateMotorCircuit` | typed patch |
| `grounding` | `grounding.calculateGrounding` (the validated orchestrator only) | typed patch |
| `pull_box` | `pullBox.calculatePullBox` | typed patch (one whole `geometry` object) |
| `load_calc` / `load_calc_preliminary` | `loadCalcFacade.evaluateV2` / `evaluatePreliminaryV2` | imported context only |
| `service_sizing` / `service_sizing_preliminary` | `loadCalcServiceSizing.analyzePrototype` / `analyzePreliminaryPrototype` | imported context only |
| `power`, `torque`, `bender` | none — no pure module exists | navigation only (`executable: false`, `reason: 'NO_PURE_MODULE'`) |

`listTools()` returns the full catalogue with, per field: type, bounds, enum values, unit, requirement
(`always` / `conditional` / `optional`), `requiredWhen`, `origin`, PL/EN label and PL/EN question. Enum values are read
from the engines' own tables and exports at load time.

Not used on purpose: `voltageDrop.minSizeForVoltageDrop` / `analyzeVoltageDrop` (a minimum-CM search is not a wire
sizing), the raw grounding helpers (`egcSize`, `gecSize`, …), the legacy Box Fill `hasEgc` path.

## 3. Input rules

1. **Closed and bounded.** Plain objects only. Unknown tool, unknown key, `__proto__` / `constructor` / `prototype`
   keys, symbol keys, accessor properties, class instances, non-finite numbers, wrong types, out-of-range values, values
   outside a closed enum and over-long arrays are rejected with a coded error. Nothing is coerced: `"20"` is not `20`.
2. **Missing is asked, never invented.** When a required value is absent the result is `needs_input`, the engine is not
   called (`engine.called: false`, `coreResult: null`) and `needsInput[]` carries a field-specific PL/EN question.
3. **No electrically material default.** Material, phase, voltage, circuit type, jurisdiction, insulation, ambient,
   adjustment factor, terminal rating, counts and volumes must be stated by the user or imported from the form.
   Conditional requirements follow the stated input (for example `voltage` / `phase` / `maxVoltDropPercent` when
   `feet > 0`; `feedsDwellingUnit` for an NYC feeder; rooftop sunlight and clearance when on a roof; `egcSize` when
   `egcCount > 0`; the overload multiplier when a nameplate FLA is stated).
4. **Documented exceptions, always surfaced in `assumptions[]`:**
   - Battery: `chargePercent` / `usablePercent` may be left to `batteryRuntime.DEFAULTS` (100 % / 85 %) only when the
     draft carries `useDocumentedEstimates: true`. That switch is **context-only**: it is not a model argument (absent
     from the provider schema and from `modelFields`), and a conversation patch that sets or clears it — `true` or
     `false` — is rejected whole with `CONTEXT_ONLY_FIELD`. Only an explicit application / user-context import
     (`importFormInput`, `handleToolCall({ formInput })`, or `origin: 'current_form'`) can set, change or withdraw it,
     i.e. after the user confirmed the estimates in the app. Without it the result is `needs_input` with a
     `chargePercent` / `usablePercent` question. With it the keys are omitted and the engine applies its own defaults;
     each is returned with `source: 'batteryRuntime.DEFAULTS'`, `basis: 'documented_editable_estimate'`,
     `userStated: false`. A value stated later replaces that one estimate only. The consumption unit
     (`consumptionMode`) is never defaulted.
     Explicit current-form values are different: when the form itself holds `chargePercent: 100` / `usablePercent: 85`
     and the app imports them, they are ordinary stated values (origin `current_form`), not estimates.
   - Wire Sizer: an unstated 100 %-rated-assembly exception is not applied (engine default, never inferred); an unstated
     overcurrent device makes the engine derive a check basis for 240.4(D) only. Both are listed as assumptions.
5. **Wire Sizer load basis.** `noncontinuousLoadA` and `continuousLoadA` are both required (0 is a valid statement).
   The registry adds no factor and never converts "20 A" into "25 A"; whatever the engine does with the stated
   continuous amperes is reported unchanged, and the engine's limitation note is passed through verbatim
   (`warnings[].code === 'ENGINE_NOTE'`). The canonical engine's actual behaviour is authoritative: when its result
   says `continuousLoadRuleApplied: true`, the registry reports the engine's own `continuousLoadMultiplier` and
   `continuousLoadSizingRequirementA` (`warnings[].code === 'ENGINE_CONTINUOUS_LOAD_MULTIPLIER'` and the load line of
   the summary), read from `coreResult`, never recomputed. The sentence "Continuous-load factors are not applied" in
   the engine's generic note does not override those fields. `feet: 0` is an explicit "no voltage-drop check" and is
   flagged.
6. **Grounding.** `groundRing` accepts the engine's three values. Only `cu_2awg_sole` yields a final GEC size. Absent or
   `unknown` → `partial` with a `groundRing` question; `other` → `partial` with `GROUND_RING_UNSUPPORTED`. In both cases
   the EGC is reported as a separate, labelled part and the Table 250.66 row is shown as reference only.
7. **Pull Box.** One `geometry` field (`rows`, `entries`, `connections`), replaced as a whole. Only geometry the user
   stated explicitly or the form supplied may be passed; walls and trade sizes are validated by the engine so its exact
   refusal reason is kept. `completeForRequest` is not a pass: unconnected entries, a null dimension or a
   layout-dependent axis make the result `partial`.
8. **Load Calc / Service Sizing.** `request` (and `design`) are **context-only**: they can only be merged with
   `origin: 'current_form'`. A conversation patch that tries to set them is rejected (`CONTEXT_ONLY_FIELD`). The
   registry checks only that the data is bounded plain JSON; the engine boundary decides the rest and its refusal is
   returned as is. The model-facing schema for these tools is `{ action: 'run_with_imported_context' }`.
   Typed variant, not free-form execution: topology, inventory and scope attestations are edited in the existing forms.

## 4. Draft

```
{ kind: 'ec.conversationTool.draft', revision: 1, tool,
  input:   { <field>: <normalized value> },        // only stated fields, tool field order
  origins: { <field>: 'conversation' | 'current_form' },
  fingerprint,                                      // ct1-… over the tool id and canonical input
  result: <result> | null, resultFingerprint }
```

Deep-frozen. `mergeDraft(draft, patch, { origin })` never mutates its arguments and returns a new draft:

- patch = `{ set: { field: value | null }, clear: [field] }`; `null` in `set` means "not stated / unchanged";
- any applied change sets `result: null` (`staleResultCleared`);
- an invalid change applies nothing and also drops the held result;
- a valid no-op keeps the result.

Change-then-revert restores the same fingerprint, so UI invalidation must be event-based; the fingerprint is a second
line of defence. A re-hydrated draft is re-validated field by field; a mismatching fingerprint is `STALE_FINGERPRINT`.

**Provenance vs. result equality.** These are two separate checks.

- *Provenance* lives in `draft.origins` and is enforced whenever a draft is validated (every public function that
  takes a draft): a context-only field whose origin is not `current_form` makes the draft invalid
  (`CONTEXT_ONLY_FIELD` at `origins.<field>`). The fingerprint covers the tool id and the input values only, and is a
  non-cryptographic change detector, so `origins` are **not authenticated**: the draft, `formInput` and
  `options.origin` must always be supplied by the application, never taken from model output. Only `args` of
  `handleToolCall` may come from the model.
- *Result equality* is about the result alone. A stored result is display data only. It is attached to a re-hydrated
  draft only when its `kind`, `revision`, `tool`, `inputFingerprint` and a known `status` match, and it is copied
  member for member (nothing is dropped — `flags.prototype` included); a stored result that cannot be copied whole
  (for example an own `__proto__` key) is not attached. `verifyResult(draft)` re-runs the engine and compares the
  **whole** result in persisted-JSON form: every number, status, flag, text and list. Key order, `-0` vs `0` and
  `undefined` members (which JSON cannot hold) are the only things that do not count; a missing, added or altered
  member makes `current: false`. `reason` is `null` when current, otherwise `NO_STORED_RESULT`,
  `STORED_RESULT_NOT_ATTACHED`, `STORED_RESULT_DIFFERS` or `INVALID_DRAFT`.

## 5. Result

```
{ kind: 'ec.conversationTool.result', revision: 1, tool, title: { pl, en },
  status, coreStatus, inputFingerprint,
  normalizedInput,                                  // exact registry input
  engine: { module, fn, called, args },             // exact arguments passed to the engine
  coreResult,                                       // structural copy of the engine return value
  parts[]:      { id, label, state: 'available' | 'unresolved' | 'not_evaluated', coreStatus, value },
  needsInput[]: { field, reason, directTo, question: { pl, en } },
  errors[]:     { code, field, source: 'registry' | 'engine', message: { pl, en }, detail },
  unresolved[]: { code, field, source, message: { pl, en } },
  assumptions[]:{ field, value, unit, source, basis, userStated, note: { pl, en } },
  warnings[]:   { code, source, text },
  references[], nextAction, navigation,
  flags: { deterministicCore, numbersFromCoreOnly, installationApproved: false, approval: 'none',
           codeComplianceVerified: false, serviceSizingRecord: false, persistence: 'conversation_only',
           prototype, preliminary, … core: { operative, installationApproved, globalCodeCompliance, ruleReview } },
  summary[]: { pl, en } }
```

| `status` | Meaning |
| --- | --- |
| `complete` | the engine answered the bounded question for the stated input (still not an approval) |
| `partial` | part of the answer exists, part is unresolved; see `parts[]` / `unresolved[]` |
| `preliminary` | stage-4 preliminary new-design result; never complete, never saveable |
| `needs_input` | a required value is missing; nothing was calculated (or the engine reported incomplete input) |
| `invalid_input` | the engine refused the input; original reason in `coreStatus` |
| `unsupported` | outside the tool or table scope; original reason kept |
| `blocked` | the engine returned a non-complete status, or a status the registry does not know; original value in `coreStatus` |
| `navigation_only` | no calculation exists; the user is pointed to the app tool |
| `error` | unexpected engine fault, an engine answer the registry could not read (`UNREADABLE_ENGINE_RESULT`) or a result status outside this list (`UNKNOWN_RESULT_STATUS`) |

Positive statuses are matched explicitly, never by default. `complete` / `preliminary` are produced only for the exact
engine statuses the registry knows (own keys only — a status such as `constructor` is unknown). Any other Load Calc
status, any Service Sizing analysis status other than `EVALUATED` / `PRELIMINARY_EVALUATED` and the known refusals,
and any unreadable engine answer becomes `blocked` or `error` with `errors[].code === 'UNCLASSIFIED_RESULT'` where
applicable. A Wire Sizer answer without a selected conductor string is `unsupported`; a Pull Box answer the engine did
not mark `completeForRequest` is `partial`.

`summary[]` and `formatResult(result, 'pl' | 'en')` are derived text built only from `coreResult` values. A model reply
may add wording but must not replace or alter these numbers; the UI should render the registry text itself.

## 6. Provider schemas

`getToolDefinitions()` returns one closed function per calculator (`ec_calc_<id>`) and `ec_open_tool`.
Each `input_schema` is strict: root `type: 'object'`, every property required, absent values `null`,
`additionalProperties: false` at every level, nested `anyOf` only for nullable enums/objects/arrays, no top-level
`anyOf`, no `if` / `then` / `allOf` / `not`. Numeric bounds and array limits are described in text and enforced by the
registry, which always re-validates the arguments whatever the provider enforced.

`handleToolCall({ name, args, draft, formInput })` performs import (optional) → merge → execute and returns
`{ ok, draft, result, changedFields, errors }`. Trust boundary: `args` is the only model-authored member and is always
merged with origin `conversation`; `draft` and `formInput` are application state. Context-only fields
(`request`, `design`, battery `useDocumentedEstimates`) therefore reach a tool only through `formInput` /
`importFormInput`. An invalid model patch applies nothing and returns `ok: false` with the unchanged draft.

`verifyResult(draft)` returns `{ ok, current, reason, result, errors }` (`reason` was added in the registry
correction; the other members are unchanged).

## 7. Public API

`listTools`, `getTool`, `getToolInputSchema`, `getToolDefinitions`, `createDraft`, `validatePatch`, `mergeDraft`,
`importFormInput`, `validateDraft`, `fingerprintInput`, `execute`, `run`, `verifyResult`, `handleToolCall`,
`formatResult`; constants `CONTRACT_REVISION`, `DRAFT_KIND`, `RESULT_KIND`, `STATUS`, `STATUS_LABEL`, `ORIGINS`,
`LIMITS`, `FINGERPRINT_ALGORITHM`, `PROVIDER_TOOL_PREFIX`, `OPEN_TOOL_NAME`, `CONTEXT_ACTION`, `TOOL_IDS`,
`NAVIGATION_ONLY`. Public functions return structured `{ ok, …, errors }` objects and do not throw on bad input.

## 8. Build integration

Add `{ id: 'conversationTools', file: 'calc/conversationTools.js' }` to `MODULES` in `core/tools/build-calc.js`, after
`batteryRuntime` (all of its dependencies are earlier in the list). Its `require()` calls are local `./name` /
`./name.js` forms that the existing shim already resolves; no alias is needed.
