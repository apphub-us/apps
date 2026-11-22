# Stage 5 — assistant form bridge (`window.ECAssistantBridge`)

File: `candidate/browser/workspace/assistant-bridge.js`. Tests: `tests/stage5-form-bridge.test.cjs`
(`node --test tests/stage5-form-bridge.test.cjs` from `repo/empire-code`). The build serves the script from `/workspace/` as
the fourth host script of the workspace page; it is never loaded by the main page.

## 1. Purpose and boundary

The parent conversation shell and the calculator page (`/workspace/mobile.html`, an iframe on the same origin) need three
things from each other: what the open form currently holds, a safe way to put a corrected value back into that form, and a
way to open a tool. The bridge is that surface and nothing else.

- Synchronous, iframe-local, called directly: `frame.contentWindow.ECAssistantBridge`. No `postMessage`, no network, no
  storage, no dynamic code. Page globals are looked up by a fixed allowlist of names (`PAGE_NAMES`).
- No formula, table, default or unit conversion. Schema and validation are the registry's
  (`window.EC.conversationTools`, `docs/conversation-tools-contract.md`); calculation and rendering stay in the page's own
  functions. The bridge never runs a registry engine, never runs a page calculation for a capture and never reads rendered
  result text or a held result.
- Fail closed: no registry, an unknown registry revision, a loading document, no event source or a missing page reader
  yields `not_ready` — never an assumed input.
- The stage-4 adoption helper, the page's preliminary action and the workflow-mode setter are not referenced. No job API is
  called except the host bridge's read-only `hasDraft()`.

## 2. API

Every reply is a plain object with `ok`, `status`, `bridgeRevision`, `generation` (opaque string, `null` when not ready) and
`active`. Nothing throws on bad input.

### `getState()`
`{ ok, status: 'ready' | 'not_ready', ready, reasons[], generation, lastInvalidation, active, job }`

- `active`: `{ panelId, appTool, mode, toolIds[], navigationOnlyIds[], primaryToolId, note }` — see section 4.
- `job`: read-only job context, section 2.1.

### 2.1 `job` — identity, current saved revision, draft indicators

Source: the page object `LC_JOB` (`mobile.html`). `LC_JOB.current` is the `{ head, revision }` pair the job store returned
when this page last opened or saved the job (`lcJobOpen`, `lcJobSave`); the head is defined by the job model
(`core/src/jobs/jobCard.js`: `kind`, `recordVersion`, `jobId`, `currentRevisionId`, `revisionNumber`) and derived by the
store from the saved revision (`jobCardStore.js`: `currentRevisionId = revision.revisionId`). `LC_JOB.editor` is set while
a job-card edit (or a new job) is open and unsaved.

`{ available, reason, jobId, currentRevisionId, revisionNumber, head, headValidation, jobCardDraftOpen, hasUnsavedDraft }`

| Member | Meaning |
| --- | --- |
| `jobId` | **Job identity** (`head.jobId`). The same for every revision of the job. |
| `currentRevisionId` | **Current saved revision** (`head.currentRevisionId`): the latest revision as this page last read or wrote it. Not live — another window may have saved a newer one; the store then answers `CONFLICT`. A draft has no revision id, so this still names the last *saved* revision while an editor is open. |
| `revisionNumber` | Ordinal of that saved revision (`head.revisionNumber`). |
| `head` | Copy of exactly the five head members above (strings / numbers). No title, address, note or link is ever copied. |
| `headValidation` | `canonical` when `EC.jobCard.validateHead` accepted the head; `member_types_only` when the job model is not loaded and only the member types could be checked; `null` when unavailable. |
| `jobCardDraftOpen` | **Unsaved job-card draft indicator**: `LC_JOB.editor` is set. `null` when the page has no `LC_JOB`. |
| `hasUnsavedDraft` | `ecHostBridge.hasDraft()`: *any* job-side draft or busy job operation (job card, measurement, material, photo, archive, restore). Wider than `jobCardDraftOpen`; says nothing about calculator forms. `null` without the host bridge. |
| `available` / `reason` | `true` / `null` only for a consistent saved head. Otherwise every id is `null` and `reason` is `JOB_STATE_UNAVAILABLE` (no `LC_JOB`), `NO_OPEN_JOB`, `NEW_JOB_NOT_SAVED` (editor open, nothing saved yet), `JOB_HEAD_UNREADABLE` (members missing or mistyped), `JOB_HEAD_INVALID` (refused by the job model) or `JOB_HEAD_REVISION_MISMATCH` (head and revision of the pair disagree). |

Compatibility: `available`, `jobId`, `head`, `hasUnsavedDraft` existed before. `head` used to copy every scalar member it
found; it now holds the five model members only. `reason`, `currentRevisionId`, `revisionNumber`, `headValidation` and
`jobCardDraftOpen` are additive. Nothing here is written, and the job store is never read by the bridge.

### `capture(toolId?)`
Without an id the active tool's primary id is used.
`{ ok, status, capture, toolId, reason, formInput, fingerprint, fields[], needsInput[], details, warnings[], form, job }`

| `status` | `capture` | Meaning |
| --- | --- | --- |
| `captured` | `full` | every required registry field is held by the form; `formInput` is complete |
| `needs_input` | `incomplete` | `formInput` holds only what the form really states; `needsInput[]` carries the registry's questions |
| `needs_input` | `unsupported` | no form exists for this tool (`formInput: null`); values can only be stated in the conversation |
| `needs_form` | `requires_form` | the form is not the active one, is in another workflow mode, has no usable state, is mid-edit or reports a fault (`formInput: null`); `reason` says which |
| `not_ready` | `none` | a page function (`PAGE_FUNCTION_MISSING`) or a page state / module reader (`PAGE_READER_MISSING`) is absent; `details.missing[]` names it |
| `navigation_only` / `unknown_tool` / `error` | `none` | nothing captured |

- `formInput` is the registry's own normalized, deep-frozen input (`importFormInput` result). Pass it as `formInput` of
  `handleToolCall` / `importFormInput`; it is application state, never model output.
- `fields[]`: `{ field, state, source, controlIds[], reason, note }` with `state` `captured | missing | invalid | not_stated`
  and `source` `control | form_reader | form_derived | form_constant`. `form_constant` / `form_derived` mark values the form
  has no control for but always sends itself (see section 5).
- An **empty control is "not stated"**. Where the page's reader would substitute a number (`|| 0`, `|| 208` …) the bridge
  reports `EMPTY_CONTROL` and leaves the field out. Hidden controls the form does not read are not captured.
- Every captured value passes the registry's field validation; a refused value is reported
  (`REGISTRY_REJECTED_FORM_VALUE`) and left out, never coerced.
- Capture reads the **active** form only (`FORM_NOT_ACTIVE` otherwise) and never calls a calculator.
- `form`: `{ appTool, mode, name, workflowMode }`; `workflowMode` is the page mode the tool additionally needs (`new_design`
  for the two preliminary tools, else `null`).

### `apply({ toolId, expectedGeneration, patch })`
`patch` is the registry patch `{ set, clear }`; it is validated with origin `conversation`.
`{ ok, status, applied, reason, toolId, changedFields[], written[], rendered[], previousGeneration, formInput, fields[] }`

Order of checks — all before the first write:

1. request shape: a **plain object of the iframe's own realm** with only the three keys (`invalid_request` /
   `REQUEST_SHAPE`, `detail` `NOT_A_PLAIN_OBJECT_OF_THIS_WINDOW | NOT_AN_OBJECT | UNKNOWN_MEMBER`; see section 6.4), known
   calculator id;
2. `expectedGeneration` is a non-empty string equal to the current generation (`stale` / `GENERATION_REQUIRED`,
   `GENERATION_CHANGED`); the tool's form is the active one (`TOOL_NOT_ACTIVE`); this form was captured in this generation
   (`CAPTURE_REQUIRED`); it still reads as captured (`FORM_CHANGED_SINCE_CAPTURE`);
3. `registry.validatePatch(…, { origin: 'conversation' })` — unknown, mistyped, out-of-range or context-only fields, or a
   patch that is not a plain object of the iframe realm, refuse the whole patch (`invalid_patch`, registry `errors[]`);
4. merge onto the captured form input (`registry.mergeDraft`); nothing changed → `no_change` (generation kept);
5. every changed field must map to a real control and value (`unrepresentable`, `fields[]` with `NO_FORM_CONTROL`,
   `VALUE_NOT_AN_OPTION`, `CANNOT_CLEAR_SELECT`, `UNREPRESENTABLE_NUMBER`, tool-specific reasons);
6. dry run: with the planned texts the form must read back **exactly** the merged input — `FORM_FIXES_THIS_VALUE`,
   `FORM_CANNOT_HOLD_VALUE`, `PATCH_WOULD_CHANGE_ANOTHER_FIELD` otherwise;
7. generation and active tool are checked once more.

Then the controls are written, the form's own calculator / renderer is called (`rendered[]`), and the form is read again.
If it does not hold the merged input the controls are restored, the generation advances and the reply is `unrepresentable`
(`rolledBack: true`, `formRestored`) or `error` / `ROLLBACK_NOT_VERIFIED`. On success the generation advances
(`previousGeneration` → `generation`) and `formInput` is the new capture, usable for the next call.

### `navigate(toolId)`
`{ ok, status, reason, toolId, form, effects[], navigationOnly, executable, calculated: false }`

`already_active` (nothing is called) · `navigated` (the app's `openTool`, plus `cvTool` for a converter tab, ran and the tool
is now active) · `unsupported` (no form, or the entry function / tab is missing) · `blocked` (`UNSAVED_JOB_DRAFT`) ·
`failed` (the entry function ran but the tool is not active) · `unknown_tool`. `effects[]` lists what the app's own entry
does to the form (`FORM_RECREATED_WITH_DEFAULTS`, `EDITOR_RESET_TO_FAST_DEFAULT`). A navigation always advances the generation.
Navigation opens a form; it never selects the Load Calc workflow mode (`form.workflowMode` only names the mode a later
capture needs).

### `invalidate(reason?)` · `describe()`
`invalidate` advances the generation explicitly (new turn, cancelled request). `describe()` returns the static table of
section 5 (`workflowMode` per tool included).

## 3. Generation

`generation` is an opaque token (`g<boot>.<n>`), unique per document load. It advances on every `input`, `change` and `click`
in the iframe document (capture phase), on an observed change of the active tool, on a form change found without an event,
on `navigate`, `invalidate`, an accepted `apply` and a rolled-back `apply`. Change-then-revert therefore invalidates even
though the registry input fingerprint is the same again; the fingerprint is returned for display and is not the guard.
For the Load Calc tools "the form as captured" is the projected request, the design object and the workflow mode, so a
draft or mode change made by a script without any event is also found (`FORM_CHANGED_SINCE_CAPTURE`).

## 4. Active tool

| Page state | `appTool` / `mode` | `toolIds` | `navigationOnlyIds` |
| --- | --- | --- | --- |
| `panel-wiresizer` | `wiresizer` | `wire_sizing` | |
| `panel-ampacity` | `ampacity` | `ampacity` | |
| `panel-boxfill` | `boxfill` | `box_fill` | |
| `panel-conduit`, `cfConduitType` present | `conduit` / `conduit` | `conduit_fill` | |
| `panel-conduit`, `wwWidth` present | `wireway` / `wireway` | `wireway_fill` | |
| `panel-pullbox`, `#pbv2-3d-prototype.show` | `pullbox` / editor mode | `pull_box` | |
| `panel-more`, `currentMoreTab = loadcalc`, `lcForm` | `loadcalc` | `load_calc`, `load_calc_preliminary`, `service_sizing`, `service_sizing_preliminary` | |
| `panel-more`, `motor` | `motor` | `motor_circuit` | |
| `panel-more`, `coderef`, grounding topic `calc`, `gnd-ocpd` present | `grounding` / `calc` | `grounding` | |
| `panel-more`, `converter`, `cvt-battery` shown | `converter` / `battery` | `battery_runtime` | |
| `panel-more`, `converter`, `cvt-power` / `cvt-torque` shown | `converter` / `power` · `torque` | | `power` · `torque` |
| `panel-more`, `bender` | `bender` | | `bender` |
| anything else (home, jobs, other converter tabs, `panel-vdrop`, unresolved state) | as observed | none | none |

An ambiguous state (two active panels, conduit mode and controls disagreeing) resolves to no tool. The four Load Calc ids
share one form; which of them can be *captured* additionally depends on the workflow mode (section 5.1).

## 5. Tools

| Tool | Capture | Apply | Notes |
| --- | --- | --- | --- |
| `battery_runtime` | `btRead()` + the battery module's `parseDecimal` | yes | explicit 100 / 85 are stated values; `useDocumentedEstimates` is never captured and a patch naming it is refused by the registry; a unit change needs `consumption` in the same patch |
| `wire_sizing` | controls | yes | form holds total + continuous portion → `noncontinuousLoadA = total − continuous` (`form_derived`); `terminalRatingC 75`, `jurisdiction NYC` are `form_constant`; `proposedOcpd` has no control; `feedsDwellingUnit` only for a feeder |
| `ampacity` | controls | yes | `terminalRatingC` is `form_derived` (TW → 60, else 75); rooftop answers only when "On or Above Roof" is Yes; clearance is one of the three options |
| `voltage_drop` | none | no | no reachable form (legacy `panel-vdrop` is not an app tool, has no size control, runs a different analysis) |
| `conduit_fill` | controls | yes | |
| `conduit_fill_mixed` | none | no | no form for mixed groups |
| `wireway_fill` | controls | yes | integration prerequisite, section 7: the page's `wwCalc` routes to `EC.conduitFill.calculateWirewayFill`, the registry tool's engine |
| `box_fill` | controls + `bfReadAccessory()` | yes | `numSupportFittings` has no control → always asked; a box change with a ring volume needs `extensionVolume` in the same patch; a non-zero volume is written as Other / Custom |
| `motor_circuit` | controls | yes | `material cu` is `form_constant`; a phase change is checked against the engine tables first |
| `grounding` | controls | yes | `groundRing` only for electrode `ring` |
| `pull_box` | `pbv23dEngineRequest(PBV23D)` | no | needs ≥ 1 row, entry and connection; refused mid-gesture; never built from a result or a size |
| `load_calc` | current request (5.1) | no | context only; either workflow mode |
| `service_sizing` | current request + design (omitted while every answer is null → `DESIGN_BLANK`, `not_stated`) | no | context only; either workflow mode |
| `load_calc_preliminary` | current request (5.1) | no | context only; new-design workflow mode only |
| `service_sizing_preliminary` | current request + design **as held** (also when every answer is still null) | no | context only; new-design workflow mode only |
| `power`, `torque`, `bender` | — | — | navigation only |

### 5.1 Load Calc / Service Sizing — current input, ordinary and preliminary

**Request reader.** `lcDraft()` (the page's live five-field draft) → `EC.loadCalcStateV2.toRequestV2(draft)` (the canonical,
pure draft-to-request projection; it works on a copy). This is the projection the form itself uses in `lcUpdate` (Calculate)
and in `lcPreRun` (stage-4 preliminary check). The request is therefore the form **as it is now**: an edit that was never
calculated is captured, and so is a draft the form published without transporting it. `lcExportState().lastRequest` — the
last *transported* request — and `lcExportState().result` are **never** forwarded; `lcExportState()` is consulted only for
the form's fault flag and for `details`.

**Design reader.** `lcSvcDesignObject()` — the design object the form's own Assess and preliminary check send.
`service_sizing` keeps the earlier rule (omitted while every answer is null). `service_sizing_preliminary` forwards the
object as held, blank or not, because that is what `lcPreRun` sends and the preliminary binding fingerprint covers it.

**Workflow mode.** `LC_PRE.mode` (stage 4, UI state only): `existing` (default) or `new_design`. The two preliminary tools
are captured only while the user has selected `new_design`; the ordinary tools in either mode. The bridge reads the mode
and never sets it. No preliminary result has to be held (`LC_PRE.result`); when one is held only that fact is reported.

**Not checked by the bridge** (the registry engine decides and reports it): whether a calculation was pressed or is fresh,
whether the method is the 220.82 route, whether a conductor ampacity is already declared (the preliminary engine answers
`NOT_APPLICABLE`), whether the form's own Assess gate is open.

| Condition | `status` / `reason` |
| --- | --- |
| draft projects; mode fits the tool | `captured` (or `needs_input` when the registry rejects a value) |
| preliminary tool, mode `existing` | `needs_form` / `NEW_DESIGN_MODE_NOT_SELECTED` |
| preliminary tool, page has no readable `LC_PRE.mode` (a page before stage 4) | `not_ready` / `PAGE_READER_MISSING`, `details.missing: ['LC_PRE.mode']` |
| `EC.loadCalcStateV2.toRequestV2` not loaded | `not_ready` / `PAGE_READER_MISSING`, `details.missing: ['EC.loadCalcStateV2.toRequestV2']` |
| `lcDraft`, `lcExportState` (all four) or `lcSvcDesignObject` (the two service tools) missing | `not_ready` / `PAGE_FUNCTION_MISSING` |
| the form shows a controlled fault (`LC.fault`: refused edit, storage or restore error) | `needs_form` / `FORM_REPORTS_FAULT`, `details.fault { kind, message }` — what the controls show may not be what the draft holds |
| no draft snapshot (calculator core missing) | `needs_form` / `NO_CURRENT_DRAFT` |
| the projection refuses the draft | `needs_form` / `DRAFT_NOT_PROJECTABLE`, `details.problems[]` (the projection's own text) |
| `lcSvcDesignObject()` returns no object | `needs_input`, field `design` `invalid` / `DESIGN_UNREADABLE` |
| Load Calc not on screen / form not built | `needs_form` / `FORM_NOT_ACTIVE` (`active.note: LOAD_CALC_FORM_NOT_BUILT`) |

`details`: `{ tool, requestSource: 'current_draft', workflowMode, optional82Route, evaluations, matchesLastEvaluatedRequest,
calculateFresh }` plus `preliminaryResultHeld` for the preliminary tools. `matchesLastEvaluatedRequest: false` means the
form's displayed result (if any) belongs to an earlier input; `calculateFresh` is the page's own `lcCalcFresh()`. They are
information for the parent, not conditions of the capture.

Request and design stay application context: imported with origin `current_form`, never model-settable. A conversation
patch naming `request`, `design`, an ampacity, an adoption or anything else is refused by the registry (`invalid_patch`,
`CONTEXT_ONLY_FIELD` / `UNKNOWN_FIELD`). The bridge has no path to the planned-conductor adoption; that stays the user's
explicit confirmation in the form.

## 6. Integration

1. `assistant-bridge.js` is a classic script after the page's own scripts (after `host-core.js`); it belongs to the
   workspace frame only.
2. `EC.conversationTools` must be in the generated bundle of that page. Until then every call is `not_ready` /
   `REGISTRY_MISSING`. `EC.loadCalcStateV2` (Load Calc captures) and `EC.jobCard` (canonical head validation) come from the
   same bundle.
3. Parent flow per turn: `capture(toolId)` → send `formInput` as application context with the model call → on a model patch
   run the registry (`handleToolCall({ name, args, draft, formInput })`) → `apply(...)` with the generation of that capture
   → show the registry result; on `stale` discard the answer and capture again.
4. **Same-origin, cross-realm caller.** The parent window and the iframe are different JavaScript realms: an object literal
   written in the parent has the parent's `Object.prototype`, and both the bridge and the registry accept only plain objects
   of the iframe's realm. This strictness is deliberate and is not relaxed. The caller clones the **whole apply request**
   into the owning realm with that realm's own `JSON` — cloning only the nested `patch` is refused just the same:

   ```js
   const iframeWindow = frame.contentWindow;
   const cap = iframeWindow.ECAssistantBridge.capture('wire_sizing');
   // … model turn; `args` is the registry patch { set, clear } built in the parent …
   const request = iframeWindow.JSON.parse(JSON.stringify({ toolId: 'wire_sizing', expectedGeneration: cap.generation, patch: args }));
   const res = iframeWindow.ECAssistantBridge.apply(request);
   ```

   A parent-realm object answers `invalid_request` / `REQUEST_SHAPE` (`detail: NOT_A_PLAIN_OBJECT_OF_THIS_WINDOW`) and an
   iframe request that still holds a parent `patch` answers `invalid_patch` (`PATCH_NOT_OBJECT`); neither reads a value nor
   writes a control. The same applies to anything handed to the iframe's registry (`formInput`, `draft`, `args`). Replies
   are iframe-realm objects; read them directly or copy them with the parent's `JSON`.

## 7. Prerequisites and remaining coverage

**Wireway prerequisite (final workspace page).** The shipped `wwCalc` MUST obtain its result from
`EC.conduitFill.calculateWirewayFill` and hold no wireway formula or area table of its own, so that the form and the
`wireway_fill` registry tool are one implementation. The bridge carries no warning for a page-local formula any more; the
contract is enforced by two tests instead — `prerequisite: the shipped workspace wwCalc routes to …` (source check) and
`wireway: form and registry share one engine …` (the real `wwCalc` on the real markup, engine observed, results compared).
Both fail with `PREREQUISITE NOT MET` while the page still has the old formula. They are required failures until then, not
skips.

**Generated bundle.** Load Calc, Service Sizing, job-head and wireway tests run on the calculator source modules, not on
the bundle embedded in the page. The test `shipped bundle: …` compares the page's generated block with the current sources
and fails with `REBUILD REQUIRED` when it is stale.

**Behavioural coverage in Node** (real page code on a stub DOM): Wire Sizer, Wh / Runtime, Pull Box request builder,
the whole Load Calc script block (ordinary + stage-4 preliminary, real controls and events), Wireway once the prerequisite
holds. **Covered only by id / function / source checks, not by behaviour:** Ampacity, Conduit Fill, Box Fill, Motor,
Grounding adapters; real navigation (`openTool` / `cvTool` are stand-ins); the job context (fixtures made by the real job
model in the page's shape, not a real IndexedDB job). **Not covered here at all:** a real browser, a real iframe / parent
pair (the cross-realm test uses a second `node:vm` realm), focus, layout, and real `input` / `change` / `click` dispatch.
