# Stage 5 — conversation client (calculators, job notes and measurements)

Files: `candidate/browser/assistant-session.js` (new, pure rules, global `ASession`), `ui.js`, `workspace-host.js`,
`conversation-bank.js`, `index.html`, `style.css`, `workspace/host-core.js`. Tests: `tests/stage5-client-assistant.test.cjs`,
`tests/stage5-client-job.test.cjs`, `tests/stage5-client-boundaries.test.cjs` (two realms with the real form bridge, linked-form
freshness, job read under the lock, Load Calc analysis choice). Whether and when they were run is recorded by the release
evidence, not by this document.

Consumed contracts, used exactly as documented: `docs/assistant-api-contract.md` (`ec.assist` 1),
`docs/conversation-tools-contract.md` (registry), `docs/conversation-job-actions.md` (job adapter),
`docs/conversation-form-bridge.md` (`ECAssistantBridge`). The client's recovery rules for job proposals and unacknowledged
writes: `docs/conversation-action-recovery.md`.

## 1. One send path

Typed and spoken messages use the same `sendMessage()`; a recording is transcribed once (`/api/transcribe`) and interpreted
once (`POST /api/assist`). `/api/talk` is no longer called by this client. Everything that existed around the request is kept:
request id per attempt, `seq` / context / generation checks, abort, the pending marker, the budget and history guards, session
renewal without re-posting, no automatic retry, the text staying in the field and in storage on every failure.

Request body: `ASession.request()` — the closed body of the contract. `assistant.form` is always `null` (section 3),
`assistant.job` is `{ jobId, revisionId, revisionNumber, notesLength }` of the conversation's job read from the original store
immediately before the request (or `null`), `assistant.clock` is sent together with a job, `lang` is `"pl"`.

A message sent while the draft is linked to an open form (section 3) is tied to that link. If the form is no longer exactly
as captured when Send is pressed, nothing is sent: the link is dropped, the text stays, and the status names the two next
steps (import the form again, or press Send again to continue on the conversation's own data).

`contextToken` is `ctx-<document nonce>-<contextGeneration>-<assistEpoch>`. `assistEpoch` advances on every conversation
switch and on every local change of the calculator draft or of a proposal. An answer is applied only when

1. `ASession.response(answer, sentBody)` accepts it: protocol, version, request id, base revision, echoed token and fingerprint,
   `state.revision === baseRevision + 1`, the closed shape of `assistant`, no item change / no model text outside the material
   domain, a proposal only for the job that was sent and quoted from the utterance;
2. the material state is still the one sent;
3. the token computed **now** equals the token sent (so change-then-revert is refused although every fingerprint is equal);
4. for a request tied to a form link: the link is still the one of the dispatch and the form is exactly as captured — the
   same bridge object (frame document), the same bridge generation and the tool's form still open. A form edit (also one
   that was put back), another tool opened in the frame, a navigation or a reloaded tools document discards the answer
   as a whole: no history, no draft change, no proposal, no form write; the text stays and the link is dropped. A draft that
   was never imported from a form has no such guard;
5. the base fingerprint recomputed from the current draft and from the job **read from its original store after the
   conversation lock was obtained** equals the fingerprint sent — a job revision saved while the answer waited for the lock
   refuses it;
6. rules 2–5 are evaluated inside the lock after that job read; nothing awaits between them and the single `applyChange`.

The job lives in another database, so rule 5 is not one atomic step with the conversation write. It keeps a proposal for
an outdated revision out of the conversation; the job adapter checks the revision again before anything is written to the job.

## 2. Calculator draft and results

The conversation holds one draft: `{ tool, input, origins, fingerprint }`. Only a `calculator` answer replaces it; any other
answer keeps the client's own copy. No result is stored. A result on screen is always computed by
`window.EC.conversationTools` of the tools frame (`ASession.registry(frameWindow)`): after an answer (`verifyResult`
against the answer's result — a differing result is discarded and said so), after a reload, offline, without AI. Without the
registry no number is shown. The panel prints the registry's summary, questions, unresolved parts, assumptions and warnings;
field ids and warning codes are not shown; a fixed line says the result is not an approval.

## 3. Current form

`Użyj otwartego kalkulatora` calls `ECAssistantBridge.capture()` once, imports `formInput` through the registry
(`importFormInput`, origin `current_form`) into a **new** draft and stores it. Nothing is sent. Later corrections come from the
conversation and are not overwritten, because the form is captured again only on the next explicit press — never by itself,
also not after a link was dropped. Load Calc and Service Sizing enter only as imported context; a missing / navigation-only /
unready form imports nothing.

**Choice of analysis.** When the open form serves several registry tools (`getState().active.toolIds.length > 1`; today the
Load Calc form: `load_calc`, `load_calc_preliminary`, `service_sizing`, `service_sizing_preliminary`), the panel shows one
labelled select (`#assist-form-tool`, label “Analiza z otwartego formularza”) whose options are the registry's Polish titles;
identifiers are option values only. The form's primary tool stays the default. The choice selects what the next press reads:
`capture(selectedToolId)`. It captures nothing by itself, is not stored, and no model can make it. The bridge reads the
CURRENT draft and design of the form (`docs/conversation-form-bridge.md` 5.1); its refusals are shown as they are — a
new-design analysis outside the new-design workflow (`NEW_DESIGN_MODE_NOT_SELECTED`), a form that reports a fault, missing
page readers — and import nothing. The stored draft is input only; the result is computed by the registry like every other
(`preliminary`, `needs_input`, `unsupported` … are shown as the registry reports them). The planned-conductor adoption helper is
not referenced by the client.

**Link and write-back.** The import records a link `{ context, tool, generation, bridge }` in memory (never stored). After a
calculator answer the fields that turn changed are written back with
`ECAssistantBridge.apply({ toolId, expectedGeneration, patch: { set, clear } })`, using the generation of the capture (then of
the last accepted apply). The bridge and the registry accept only plain objects of their own realm, so the whole closed
request is re-created in the frame with the frame's own `JSON` (`frame.JSON.parse(JSON.stringify(request))`) before the call;
no check of the bridge or registry is relaxed, and `set` is built without a prototype so a field named like a prototype member
reaches the registry and is refused there. `stale` or any refusal drops the link and leaves the form untouched. The bridge
accepts no write for Load Calc, Service Sizing (context-only input) and Pull Box (no patchable form). `Otwórz to narzędzie` is `hostNavigate('tools')` +
`ECAssistantBridge.navigate(toolId)`; Power / Torque / Bender are navigation only.

**Freshness.** `assistLinkCurrent(link)` asks `getState()` and holds only for the same bridge object, the same generation and
the tool's form still active. It is checked when Send is pressed (section 1) and for the answer (rule 4). A bridge without
`getState`, or a frame that is not ready, cannot confirm a link: the link counts as changed.

Known limits of the form link:

- The generation advances on every input, change and click in the tools document, so looking around in the tools after an
  import usually drops the link at the next Send; one more press continues on the conversation's data.
- A form changed by script without any event is not seen by `getState()`. The bridge detects it in `apply`
  (`FORM_CHANGED_SINCE_CAPTURE`): the answer is then already in the conversation, the form is not written and the link is dropped.
- For a spoken message the link is checked when the transcript is sent, after the transcription request was made.
- The select is rebuilt with the panel; it reflects the open form at the last render of the conversation view and again at
  the press. Not verified in a real browser: 320 px layout of the select, focus behaviour, screen-reader output.

## 4. Stored layout

Optional member `assistant` of the conversation envelope (`{ state, undo, diffs, workspace[, assistant] }`), written only when
not empty:

```
{ version: 1,
  tool:     null | { tool, input, origins, fingerprint },
  proposal: null | { kind: 'note'|'measurement', proposalId, savedAt, sourceRevision, sourceText,
                     job: { jobId, revisionId, revisionNumber }, note: string|null, fields: {10 measurement fields}|null, edited },
  action:   null | { phase: 'pending'|'conflict', plan, input, receipt },     // docs/conversation-job-actions.md
  receipts: [ confirmed receipt, … ] }                                         // at most 24
```

- `ASession.validate(meta, { sourceId, sourceRevision, jobId })` is the single strict validator: on activation, on every write
  of the application, on import. Unknown members, a result inside the draft, a receipt of another conversation or job are refused.
- `conversation-bank.js`: an envelope without the member is unchanged (released layout 1 and layout 2 data read byte for
  byte). `isPending` includes a pending job action, so archive, delete, import of such a file and every edit are blocked like a
  started material write. A pending plan can only stay, become the same plan in conflict, be confirmed by exactly its own
  receipt, or be released with unchanged receipts. Receipts never disappear. A deletion record keeps them under the optional
  `actions` member (absent when there are none) and a file restores a deleted conversation only with exactly those receipts.
- Archive files carry the member verbatim; the raw recovery copy adds `screen.assistant` and `screen.assistantUnsaved`
  (corrections typed into the review form and not yet saved).

## 5. Note / measurement

Recovery rules of this section (release of a pending plan, the single proposal slot, the measurement clock, a device clock
behind the job) are specified in [`docs/conversation-action-recovery.md`](conversation-action-recovery.md); the steps below
summarise them and do not add to them.

1. A `job_note` / `job_measurement` answer stores a proposal (`savedAt` = time of that save, `sourceRevision` = revision of that
   save) **only when the conversation holds no unwritten proposal**. Nothing is written to the job.
   - A conversation holds at most one unwritten job proposal. While one is held, a new proposal from the server is refused
     (`ASession.withProposal`, code `PROPOSAL_HELD`) — also one with the same `proposalId`. There is no silent replacement:
     the held proposal, its saved corrections and the text being edited in the review form stay unchanged, the answer is not
     applied (no history, no draft change) and the utterance stays in the message field. The slot is freed by writing the
     proposal, by „Odrzuć propozycję”, or by closing a conflict. The refused request was already answered by the server and
     still counts against the daily limit.
   - A measurement proposal with `timeOrigin: "client_clock"` is accepted only when its `measuredLocal` and `utcOffset` are
     exactly the two strings of the clock sent with that request (`assistant.clock`) and `measuredAt` is the instant of that
     clock. Otherwise the whole answer is refused like any stale answer. The user may still correct the time in review.
2. `Przejrzyj zapis`: corrections are saved first; when the job has a newer revision or was saved after the proposal, the
   proposal is saved again with a new time. Then `ecHostBridge.prepareAction(input)` with `sourceSavedAt = proposal.savedAt`.
   The exact `review` of the adapter is shown. When the device clock is earlier than the last save of the job, saving the
   proposal again cannot help: `Przejrzyj zapis` says so (it names the clock and both times) and stores nothing; the proposal
   and the corrections in the form stay.
3. `Potwierdź i zapisz w robocie`: prepared again from the saved proposal and the current job; only the plan that was shown is
   accepted. `{ plan, input, pendingReceipt }` is stored (`ASession.enter`) **before** `commitAction`; the adapter also calls
   `persistPending`, which answers `true` only when the stored bank holds exactly this pending plan.
4. `confirmed` → `ASession.done` is stored, then “Zapisano”. If that store fails: “Zapis jest w robocie, ale jego potwierdzenie
   nie zostało utrwalone…”, the plan stays pending, `Wznów zapis` repeats the same plan and input (reconciled, no duplicate).
   `pending` → plan kept. `conflict` → kept and shown, never retried. `refused` → released only with `stored: false` in that
   answer, or through the release of step 6 (a fresh `NOT_STORED`; a remembered one is not enough).
5. After a reload a pending plan is reconciled once automatically (read-only); `Sprawdź w robocie` repeats that.
6. `Zwolnij i przejrzyj ponownie` is offered after a history check answered “not stored” (`reconcileAction`: `pending`,
   `NOT_STORED`, `stored: false`) and is withdrawn by any write attempt, any later check and any other answer. A remembered
   answer is never the proof. Pressing the button reads the job history again under the conversation lock, and only that
   fresh read decides:
   - fresh `NOT_STORED` / `stored: false` → the pending plan (marker) is dropped; the proposal stays for a new review;
   - the record is found → its confirmed receipt is stored instead; nothing is released;
   - a conflict → the plan is marked as a conflict;
   - the history cannot be read (`stored: null`, a refusal, an error) → nothing changes; the plan stays pending.

   The history read and the conversation write are in different browser databases: sequential under the conversation lock,
   not one atomic step (limits in `docs/conversation-action-recovery.md` §1).
7. Cancel (`Odrzuć propozycję`) removes the proposal and writes nothing. Without the job on the device every write button is
   disabled.

## 6. Bridge members added to `ecHostBridge` (host-core.js)

`prepareAction(input)`, `pendingAction(plan)`, `commitAction(plan, input, confirmation, persistPending)`,
`reconcileAction(receipt)`, `measurementUnits()`.
