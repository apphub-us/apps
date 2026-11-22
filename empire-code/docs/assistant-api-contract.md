# Stage 5 — `/api/assist` (typed assistant endpoint, protocol `ec.assist` version 1)

Server modules: `candidate/server/assistant-contract.cjs` (deterministic boundary), `assistant-provider.mjs` (one Responses
request), `assistant-prompt.mjs` (static instructions), route in `worker.mjs`. Tests: `tests/stage5-assistant-*.test.mjs`
(synthetic transport only; authored, not executed by the author).

`/api/talk` and `/api/transcribe` are unchanged: same request, same response, same errors. Already-open old clients keep
working and never see this protocol.

## 1. What one call does

One user utterance → **one** provider request → **exactly one** strict function call → a deterministic application answer.

| `domain` in the response | Function the model called | What the server returns |
| --- | --- | --- |
| `calculator` | `ec_calc_<tool>` (15 registry tools) | new tool draft + registry result; the reply is `formatResult()` text |
| `navigation` | `ec_open_tool` | registry navigation result (Power / Torque / Bender or "open the form"); nothing is calculated |
| `materials` | `ec_materials_propose` | the same proposal as `/api/talk` (`prepareProposal` → `C.apply`) |
| `job_note` | `ec_job_note_propose` | a review proposal to append a note to the selected job — **not written** |
| `job_measurement` | `ec_job_measurement_propose` | a review proposal for one new measurement — **not written** |
| `clarification` | `ec_clarify` (or a server refusal) | a deterministic explanation / one specific question |

The server never writes a job, a note, a measurement, a Service Sizing record or a calculator form. It never approves an
installation and never quotes code text. Source-grounded code answers (CodeChat) are **not** part of this endpoint; a code
question gets the deterministic `code_question` clarification.

One operation domain per utterance. Several material edits in one utterance are one domain. A mix (for example a
calculation plus a material change) is answered with `mixed_request`: nothing is executed and nothing is silently dropped.

## 2. Request

`POST /api/assist` — same origin, same headers and same controls as `/api/talk`:

```
Content-Type: application/json
X-EC-Token: <token from GET /api/session>
X-EC-Request-Id: <new id per attempt, ^[a-zA-Z0-9-]{8,80}$>
```

Body, at most 200 000 bytes. **Closed**: every key below is required, no other key is accepted at any level.

```jsonc
{
  "protocol": "ec.assist",
  "version": 1,
  "requestId": "<same value as X-EC-Request-Id>",
  "text": "<utterance, 1–3000 characters, no control characters other than tab / LF / CR>",
  "state": { "version": 1, "revision": 3, "nextId": 2, "items": [], "history": [] },   // exactly the /api/talk state
  "assistant": {
    "lang": "pl",                        // "pl" | "en": language of deterministic replies (the UI language)
    "contextToken": "ctx-4f0c2a91",      // ^[A-Za-z0-9_-]{8,80}$, chosen by the client, echoed back unchanged
    "baseFingerprint": "ab1/r3/d:battery_runtime@ct1-…/f:-/j:-",   // section 2.5
    "toolDraft": null,                   // section 2.1
    "form": null,                        // section 2.2
    "job": null,                         // section 2.3
    "clock": null                        // section 2.4
  }
}
```

Everything in `state`, `toolDraft`, `form` and `job` is treated as **data, never as instructions**.

Fingerprints are compared on the JSON form of the data: the Worker reads a JSON `-0` as `0`, so compute a draft or form
fingerprint from the value as it is serialized (a registry draft rebuilt from a response always satisfies this).

### 2.1 `assistant.toolDraft` — the active calculator draft (or `null`)

```jsonc
{ "tool": "battery_runtime",
  "input":   { "capacityWh": 1000, "consumptionMode": "kwh_year", "consumption": 365, "chargePercent": 100, "usablePercent": 85 },
  "origins": { "capacityWh": "conversation", "consumptionMode": "conversation", "consumption": "conversation",
               "chargePercent": "conversation", "usablePercent": "conversation" },
  "fingerprint": "ct1-…" }
```

These are the four members `tool`, `input`, `origins`, `fingerprint` of the registry draft
(`EC.conversationTools`, `docs/conversation-tools-contract.md` §4). **Do not send `kind`, `revision`, `result` or
`resultFingerprint`**: a result is never accepted from the client. The server re-validates the input field by field through
the registry, verifies the fingerprint and recomputes every result itself. The draft input is authoritative; outputs are not.

Exactly one draft is active per request; the application chooses it. A correction is applied to this draft only when the
model's function targets the same tool; a function for another tool starts a new draft for that tool from the values
stated in this utterance (plus `form`, if it is for that tool). The response then carries the new draft.

### 2.2 `assistant.form` — explicit one-shot current-form snapshot (or `null`)

```jsonc
{ "tool": "wire_sizing", "input": { /* this tool's fields, as the form holds them now */ }, "fingerprint": "ct1-…" }
```

`fingerprint` is `EC.conversationTools.fingerprintInput(tool, input).fingerprint`. `input` must contain at least one stated
field and is validated exactly like `importFormInput` (origin `current_form`).

- Send it only on the turn in which the user asks to use the open form (or after the form changed). It is imported
  **before** the utterance's own values, so a later conversation correction is not overwritten as long as the client does
  not resend the snapshot.
- It is used only when the model's function targets `form.tool`. Otherwise it is ignored (not an error).
- Load Calc and Service Sizing (`load_calc`, `load_calc_preliminary`, `service_sizing`, `service_sizing_preliminary`) take
  their data **only** this way (`{ request }` / `{ request, design }`); the model can only ask to run what was imported.
  Their qualification stays conditional exactly as the registry reports it (`preliminary`, `partial`, flags).
- Send only the snapshot of the one relevant form. For the context-only tools the model is told only *that* a snapshot
  exists; the imported data itself is not sent to the provider.

### 2.3 `assistant.job` — selected job snapshot (or `null`)

```jsonc
{ "jobId": "job1_<32 hex>", "revisionId": "jrev1_<32 hex>", "revisionNumber": 4, "notesLength": 120 }
```

Identity and revision of the job the **application** has open, plus the current length of its notes (0–20000,
`jobCard.LIMITS.notes`). No title, address, note text, measurement list or other job inventory is sent. The model is told
only whether a job is selected; it never sees or produces an id, a revision, a receipt or a timestamp and cannot target
another job. `job !== null` requires `clock !== null`.

### 2.4 `assistant.clock` — device time for a measurement proposal (or `null`)

```jsonc
{ "local": "2026-11-21T14:05", "utcOffset": "+01:00" }
```

Validated with `jobMeasurement.observedInstant`. Used only as the **proposed** observation time of a measurement
(`timeOrigin: "client_clock"`).

- `client_clock` means "the device's current time, proposed because the utterance named no other time". It is not a
  time the user stated and not an approval: `fields.measuredLocal` / `utcOffset` / `measuredAt` wait for the user's
  review like every other field (`requiresUserReview: true`), and the review UI must show the time as editable. The
  deterministic `reply` says so in words and carries no timestamp.
- The server never turns another time into "now". If the utterance names a time other than now (yesterday, an hour ago,
  this morning, a weekday, a date, a clock time; `wczoraj`, `rano`, `godzinę temu`, `o 14:30`, `20 listopada`), no
  proposal is made: the answer is the clarification `missing_details` / topic `job_measurement` (section 3.4) and the
  user enters that reading with its time in the measurement form. The prompt gives the model the same rule; the server
  check does not depend on the model following it.
- The server check is a bounded Polish / English phrase list, compared without diacritics and case. Besides the
  phrases above it covers `przed godziną` / `przed tygodniem` / `przed 5 minutami`, any `… temu` (`5 min temu`,
  `2 godz. temu`, `kwadrans temu`), `wczorajszy`, `z rana`, `nad ranem`, `o czternastej`, `o godz. 14`,
  `at 3 o'clock`, and a digit clock time after `o` / `at` (`o 14`, `o 14.30`, `at 14.30`). Those digits count as a
  time only when they are not the value of a value+unit pair of the utterance, so `spadło o 2 V` is a difference, not
  two o'clock. The list is deliberately conservative (a false match only sends the user to the measurement form) and it
  is not complete: a phrasing outside it is not detected, which is one more reason the proposed time is always an
  editable proposal.
- No model argument carries a time.

### 2.5 `assistant.baseFingerprint`

A plain composite the client builds from values it already holds (no hashing):

```
"ab1/r" + state.revision
+ "/d:" + (toolDraft ? toolDraft.tool + "@" + toolDraft.fingerprint : "-")
+ "/f:" + (form      ? form.tool      + "@" + form.fingerprint      : "-")
+ "/j:" + (job       ? job.jobId      + "@" + job.revisionId        : "-")
```

The server recomputes it from the validated request and refuses a mismatch (`409 ASSIST_MISMATCH`) before any budget is
reserved. It is echoed in the response so the client can compare it with its **current** context when the answer arrives.

## 3. Response (200)

```jsonc
{
  "protocol": "ec.assist", "version": 1,
  "requestId": "<echo>",
  "baseRevision": 3,                                   // state.revision the answer is based on (as /api/talk)
  "base": { "materialRevision": 3, "fingerprint": "ab1/…", "contextToken": "ctx-4f0c2a91" },
  "domain": "calculator",                              // section 1
  "state": { … },                                      // NEXT material state: revision + 1, history + 2 messages
  "reply": "…", "question": "",
  "diffs": [], "proposalId": "<sha-256 hex>", "scope": "out_of_scope", "corrections": [],
  "assistant": {
    "lang": "pl",
    "replyOrigin": "deterministic",                    // "deterministic" | "deterministic_with_model_question" | "model_text"
    "historyReplyTruncated": false,
    "toolDraft": { "tool": "…", "input": { }, "origins": { }, "fingerprint": "ct1-…" },   // or null
    "changedFields": ["chargePercent"],
    "result": { /* registry result, conversation-tools contract §5 */ },                   // or null
    "actionProposal": null,                            // section 3.3
    "navigation": null,                                // registry result.navigation for domain "navigation"
    "clarification": null                              // { reason, topic, modelQuestionUsed } for domain "clarification"
  },
  "model": "<model id>", "online": true, "durationMs": 0, "usage": null
}
```

`state`, `reply`, `question`, `diffs`, `proposalId`, `scope`, `corrections` have the `/api/talk` meaning and are produced by
the same `C.apply`. For every domain other than `materials` the material items are untouched: `diffs` is `[]`, `scope` is
`"out_of_scope"`, and the only change is `revision + 1` and two history messages (the utterance and the deterministic
reply). Use `domain`, not `scope`, to tell the turn kind.

### 3.1 Calculator and navigation turns

- `assistant.result` is the registry result recomputed on the server; `reply` is
  `formatResult(result, lang)`, preceded by a `Zmienione pola: …` / `Changed fields: …` line when an existing draft was
  corrected. No number in `reply` comes from the model. `replyOrigin` is `"deterministic"`.
- `assistant.toolDraft` is the draft to keep (`tool`, `input`, `origins`, `fingerprint`). Rebuild the local registry draft
  from it and send it back unchanged as the next `toolDraft`. A stored result is display data; re-run the registry to
  restore one.
- `assistant.changedFields` lists exactly the fields this turn changed (an utterance that states only "charge 50 %"
  changes only `chargePercent`).
- Missing required values give `result.status === "needs_input"` with the registry's field questions; nothing is
  defaulted and no engine runs.
- Result flags are the registry's: `installationApproved: false`, `approval: "none"`, `serviceSizingRecord: false`,
  `persistence: "conversation_only"`.
- For `navigation`, `assistant.toolDraft` is the unchanged incoming draft and `assistant.navigation` says which tool to open.
- The history message is limited to 1000 characters by the existing `C.apply`; a longer reply is cut at a line break for
  the history only (`historyReplyTruncated: true`). `reply` and `assistant.result` are complete. Render the result itself.

### 3.2 Material turns

Identical to `/api/talk`: `state`, `diffs`, `proposalId`, `scope: "materials"`, `corrections`, and the model's short
`reply` / `question` (`replyOrigin: "model_text"`). Material operations are validated only by the existing
`cloud-provider.mjs` `SCHEMA` / `prepareProposal` and `contract.cjs`; this endpoint has no material validator of its own,
so unit and whole-count rules are whatever those modules define. If the model marks the turn out of the material scope, the
server discards its text and answers with the deterministic `unsupported_request` clarification.

### 3.3 `assistant.actionProposal` — review proposals (never written by the server)

Note (`domain: "job_note"`):

```jsonc
{ "kind": "ec.assist.jobNoteAppend", "version": 1, "proposalId": "<sha-256 hex>",
  "committed": false, "requiresUserReview": true,
  "target": { "jobId": "job1_…", "baseRevisionId": "jrev1_…", "baseRevisionNumber": 4 },   // copied from assistant.job
  "append": { "text": "…", "separator": "\n\n", "baseNotesLength": 120, "resultingNotesLength": 152 },
  "evidence": { "sourceQuote": "<exact fragment of the utterance>" },
  "modelAuthored": ["append.text"] }
```

Measurement (`domain: "job_measurement"`):

```jsonc
{ "kind": "ec.assist.jobMeasurementCreate", "version": 1, "proposalId": "<sha-256 hex>",
  "committed": false, "requiresUserReview": true,
  "target": { "jobId": "job1_…", "jobRevisionId": "jrev1_…", "jobRevisionNumber": 4 },
  "fields": { "label": "…", "quantity": "voltage", "valueText": "121.4", "unit": "V", "location": "…",
              "measuredLocal": "2026-11-21T14:05", "utcOffset": "+01:00", "mode": "AC", "instrument": "", "notes": "" },
  "measuredAt": "2026-11-21T13:05:00.000Z", "timeOrigin": "client_clock",
  "evidence": { "sourceQuote": "…", "unitQuote": "…" },
  "modelAuthored": ["label", "quantity", "mode"] }
```

Rules enforced by the server:

- `fields` is the exact `jobMeasurement.FIELDS` set and passed `jobMeasurement.validateFields`.
- Note: `append.separator` is `""` for a job without notes and `"\n\n"` otherwise — the separator of the client commit
  path (`jobConversationActions` `NOTE_SEPARATOR`) — so `resultingNotesLength = baseNotesLength + separator.length +
  text.length` is the stored length. It is checked against `jobCard.LIMITS.notes`; a note that does not fit is refused
  whole (`note_limit`). The text is never shortened (model `text` is at most 2000 characters, else `ASSIST_ARGUMENTS`).
- `sourceQuote` is an exact fragment of the **current** utterance. `location`, `instrument` and `notes` of a measurement
  must also be exact fragments.
- Measurement value and unit are ONE reading of the current utterance, not a number and a unit that both occur in it.
  The model function carries three provider-internal quotes (`value_quote`, `unit_quote`, `reading_quote`; only
  `unitQuote` is returned, as before). The server accepts the call only when all of these hold:
  - `reading_quote` is `value_quote` directly followed by `unit_quote` (at most one blank between them);
  - `unit_quote` names exactly `fields.unit`. Symbols are matched in their exact letter case (`mV` is millivolt, `MV`
    is refused; lower-case `w`, `a`, `ma` are words, not units; `VAC` / `VDC` are the volt and must agree with `mode`);
    Polish and English unit words (`woltów`, `amps`, `stopni Celsjusza`, …) are matched as whole words. A unit letter
    inside another word is never a unit. A bare "degrees" names no scale. A missing unit is never defaulted;
  - `value_quote` reads as exactly `fields.valueText` through the existing bounded number parser
    (`jobVoiceIntent.decimal`): digits with an explicit decimal comma or dot and an attached sign, or Polish / English
    number words (`sto dwadzieścia`, `one hundred twenty`, `minus pięć przecinek dwa`). Nothing is rounded, converted
    or reformatted beyond comma → dot. `1,000` (thousand or decimal?) and a detached sign (`- 120`) are refused;
  - the utterance contains exactly one value+unit pair of that quantity, and its value span, unit span and whole span
    are character for character the three quotes. So part of a larger number (`twenty` of `one hundred twenty`, `5`
    of `-5`), an instrument model number (`Fluke 117`) or a number that no unit follows can never be the value;
  - the pair is unambiguous: not the end of a range or alternative (`118-121 V`, `od 118 do 121 V`, `120 or 121 V`),
    not directly preceded by another number without punctuation (`Fluke 117 120 V`), and not one of several readings
    of the same quantity (`L1 120 V, L2 121 V`). A pair of another quantity (a `100 A` panel in the location) does not
    compete. A clause boundary separates: `miernik Fluke 117, sto dwadzieścia woltów` is the reading 120 V.
    The check looks at both sides of the pair, never across closing punctuation:
    - before the value: another number, a detached sign, a number-continuation word (`hundred`, `thousand`, `tysiąc`,
      `przecinek`, `point`, …) or a hedge / bound / negation / range opener (`około`, `about`, `chyba`, `może`,
      `maybe`, `perhaps`, `ponad`, `over`, `under`, `not`, `between`, `od`, …); or a connector (`do`, `to`, `a`, `i`,
      `and`, `or`, `albo`, `lub`, …) with another number within the three tokens before it (`między 118 a 121 V`,
      `118 up to 121 V`);
    - after the unit (one `AC` / `DC` word may stand between): a hedge (`mniej więcej`, `or so`, `chyba`, `±`) or a
      connector / dash followed by another number (`120 V albo 121`, `120 V do 125`, `120 V up to 125`).
    A number that is the value of a reading of another quantity (`20 A i 121,4 V`) is not the other end of a range.
    An approximate or bounded value is never turned into an exact one;
  - the value is the whole number. When the bounded parser cannot read a longer spoken number (`a hundred twenty`,
    `tysiąc dwieście`, `pięć przecinek dwadzieścia pięć`, `five point twenty five`), its readable tail (`twenty`,
    `dwieście`, `dwadzieścia pięć`, `twenty five`) is refused as well; nothing falls back to the tail. Whole numbers
    the parser reads (`one hundred twenty`, `sto dwadzieścia`, `pięć przecinek dwa pięć`) pass as before;
  - when the model names an `instrument` (an exact fragment of the utterance), a pair that overlaps that fragment is
    not a reading: with instrument `Fluke 87V`, `87V` is refused and a real `120 V` next to it is accepted. This uses
    only the model's own instrument quote. Nothing recognises brands or model numbers, so when the model names no
    instrument, `miernikiem Fluke 87V` alone can still be claimed as 87 V and must be caught in the user's review;
  - the reading lies inside `sourceQuote`.
  These are bounded word-level checks on a fixed Polish / English word list, not language understanding. Phrasings
  outside the lists (a hedge after a comma, `120 V, albo 121`; an unlisted hedge word) are not recognised; some
  ordinary phrasings are refused on purpose (`test point 120 V`, because `point` may be a decimal mark).
- The measurement `label` is model-written (`modelAuthored`) and appears in the deterministic `reply`. It is refused
  with `ASSIST_ARGUMENTS` when it carries a code reference or approval wording (the same two filters as the
  clarification question, applied after the claimed value digits are taken out, so `L1-N 121.4 V` is a valid label).
  Note text (`append.text`) is the user's proposed content and is not filtered.
  Anything else is `ASSIST_EVIDENCE`: the user restates the one reading in one utterance. A claimed unit the quoted
  words do not name is an evidence failure; `ASSIST_FIELDS` remains for a quantity / unit / mode combination the
  measurement contract refuses.
- The proposed time is the client clock and waits for review; an utterance that names another time gets no proposal
  (section 2.4).
- The target is always the client's `assistant.job`. With `job: null` the answer is the deterministic clarification
  `job_not_selected` and no proposal.
- Only "create a new measurement" and "append to notes" exist. Corrections of saved records are not proposed.

The client shows the proposal for review and commits it separately through the existing stores
(`jobCardStore` / `jobMeasurementStore`), generating every id, revision id and timestamp itself and re-checking that the
job revision is still `target.*`. Persisted-job orchestration is outside this endpoint.

### 3.4 Clarification

`assistant.clarification.reason` is one of `missing_details`, `ambiguous_request`, `mixed_request`,
`unsupported_request`, `code_question`, `approval_request` (model-selected) or `job_not_selected`, `note_limit`
(server-selected). `reply` is a fixed text per reason. The model may add one question (≤ 400 characters); it is appended
only if it carries no code citation and no approval wording (`modelQuestionUsed: true`,
`replyOrigin: "deterministic_with_model_question"`), otherwise it is dropped.

The server itself also answers `missing_details` with topic `job_measurement` when the model proposed a measurement for
an utterance that names a time other than now (section 2.4). The fixed text is then followed by one fixed application
sentence that points to the measurement form; `modelQuestionUsed` is `false`, `replyOrigin` is `"deterministic"` and
`actionProposal` is `null`. No new reason, key or shape is involved.

## 4. Client acceptance rule

Apply a response only if all hold; otherwise discard it and change nothing:

1. `requestId` equals the id sent; `protocol === "ec.assist"`, `version === 1`;
2. `baseRevision` equals the `state.revision` sent **and** the local material state is still the one sent (existing rule);
3. `base.contextToken` equals the token of the current context;
4. `base.fingerprint` equals the fingerprint recomputed **now** from the current local draft / form / job (section 2.5);
5. `state` passes the existing state check and `state.revision === baseRevision + 1`.

No automatic retry: a request id is accepted once (`409 DUPLICATE_REQUEST` afterwards), also after an abort or an error.

## 5. Errors

Same envelope as `/api/talk`: `{ "error": "<safe text, < 300 characters>", "code": "<CODE>" }`. Nothing else of an
upstream error is ever returned. All existing codes keep their meaning (`SESSION_TOKEN`, `DUPLICATE_REQUEST`, `BUSY`,
`DAILY_LIMIT`, `BUDGET_UNAVAILABLE`, `AI_NOT_CONFIGURED`, `API_*`, `MODEL_UNAVAILABLE`, `CANCELLED`, `PROPOSAL_*`,
`HISTORY_LIMIT`, `CONTEXT_LIMIT`, `REQUEST_FAILED`, `INTERNAL`). New codes:

| Code | Status | When | Budget used |
| --- | --- | --- | --- |
| `ASSIST_REQUEST` | 400 | envelope, protocol, version, request id or text invalid | no |
| `ASSIST_STATE` | 400 | `state` is not a valid material state | no |
| `ASSIST_CONTEXT` | 400 | `assistant` block, draft, form, job or clock invalid | no |
| `ASSIST_MISMATCH` | 409 | draft, form or base fingerprint does not match the data sent | no |
| `ASSIST_INCOMPLETE` | 422 | provider response not completed | yes |
| `ASSIST_REFUSAL` | 422 | provider refusal | yes |
| `ASSIST_CALL` | 422 | no function call, more than one, unknown function or malformed call | yes |
| `ASSIST_ARGUMENTS` | 422 | function arguments rejected by the registry / the typed checks | yes |
| `ASSIST_EVIDENCE` | 422 | note or measurement not grounded in the utterance | yes |
| `ASSIST_FIELDS` | 422 | measurement fields rejected by `jobMeasurement.validateFields` | yes |

`HISTORY_LIMIT` (history ≥ 36 messages, no room for one more turn, or `state.revision` ≥ 100: every answer is
revision + 1 and the state accepts at most 100) and `CONTEXT_LIMIT` are checked before the budget. `state.revision` 99
is still answered; the returned state (revision 100) can only be exported.
The client's `API_CODES` allow-list needs `ASSIST_[A-Z]{1,12}` added to show these texts.

After any error the client keeps its material state, tool draft and job untouched.

## 6. Provider request (server side)

One `POST /v1/responses` through the existing `createTransport` (fixed endpoint, 90 s timeout plus the request's abort
signal, no retry, no redirect), existing `MODEL`:

```
model, store: false, background: false, service_tier: "default", reasoning: { effort: "low" }, max_output_tokens: 2300,
instructions: <static prompt> + application context, input: <history> + utterance,
tools: [ { type: "function", name, description, strict: true, parameters } … ], tool_choice: "required",
parallel_tool_calls: false
```

- Registry definitions `{ name, input_schema }` map one-to-one to `{ type: "function", name, description, strict: true,
  parameters: input_schema }`. The material function's `parameters` is `cloud-provider.mjs` `SCHEMA` itself.
- Every schema: root object, all properties required, `additionalProperties: false`, nullable for "not stated", no root
  `anyOf`, no free-form JSON, code or endpoint argument.
- A completed response must contain exactly one `function_call` item with JSON arguments. Zero or several calls, a
  refusal, another item type, a non-completed call or unparsable arguments are rejected; message text is never used.
- Arguments are always re-validated by the application (registry / `prepareProposal` / typed checks), whatever the provider
  enforced.
- Context sent to the provider: the material items, the active typed draft input and its missing fields, the typed form
  snapshot, and whether a job is selected. History + context + utterance are limited to 30 000 characters.

The production provider is built only from `env.OPENAI_API_KEY` and the platform `fetch`. A test provider can be injected
only through `createWorker({ assistantProviderFactory })`; no request, header or environment value selects it.

## 7. Shared-contract notes for sequential integration

- Stage 5 correction (request and response wire shapes unchanged):
  - model function `ec_job_measurement_propose` has two more required string arguments, `value_quote` and
    `reading_quote` (12 arguments: `label`, `quantity`, `value_text`, `value_quote`, `unit`, `unit_quote`,
    `reading_quote`, `location`, `mode`, `instrument`, `notes`, `source_quote`). They are provider-internal evidence;
    `actionProposal.evidence` is still `{ sourceQuote, unitQuote }`;
  - `append.separator` of a note proposal is `"\n\n"` (was `"\n"`) for a job that already has notes;
  - the measurement `reply` has a third line stating that the time is the proposed device time awaiting review;
  - `assistant-contract.cjs` additionally requires `core/src/jobs/jobVoiceIntent.js` for its `decimal()` only;
  - the `/api/transcribe` speech prompt text names calculations, notes, measurements and materials (was "a material
    note"); model, languages, keywords, limits and the request shape are unchanged.
- Review fixes (request and response wire shapes, function schemas and status codes unchanged; only more refusals):
  - measurement evidence: number-continuation words, two-sided range / alternative / hedge checks and the instrument
    overlap rule (section 3.3); more phrasings of another time (section 2.4); the `label` filter (`ASSIST_ARGUMENTS`);
  - `state.revision` ≥ 100 is `HISTORY_LIMIT` during validation instead of after the provider call (section 5);
  - the prompt says the battery documented-estimates opt-in exists only in the application context: the model has no
    field for it and never writes 100 / 85 unless the user stated those numbers (explicit values stay ordinary inputs);
  - the client commit path (`jobConversationActions.commit`) now requires `persistPending` for every new write
    (`docs/conversation-job-actions.md` §3, §6, §7).
- No change to `contract.cjs` or the stored state shape was needed; in `cloud-provider.mjs` only that prompt text changed.
- Non-material turns are recorded with the existing `C.apply` as `scope: "out_of_scope"` with no operations; its 1000
  character reply limit is why the history copy may be shortened. If a longer history copy is wanted later, the small
  change is a dedicated `C.apply` limit for deterministic replies — not done here.
- The material unit enum offered to the model is whatever `SCHEMA` exports at run time; it follows stage 3 automatically.
