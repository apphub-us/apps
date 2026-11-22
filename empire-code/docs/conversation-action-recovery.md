# Conversation → job actions: recovery rules of the client

Scope: what the browser client (`candidate/browser/workspace-host.js`, `candidate/browser/assistant-session.js`) does with a
note or measurement proposal and with a write that was started and not acknowledged. The adapter contract itself is
`docs/conversation-job-actions.md` (section 7 is the host protocol this file implements); the request/answer contract is
`docs/assistant-api-contract.md`. Nothing here changes a stored layout, a protocol shape or a public function name.

## 1. A pending plan is released only on proof read now

A confirmed write leaves a pending plan (`assistant.action`, phase `pending`) in the stored conversation until its
confirmed receipt replaces it. The plan may be dropped without a receipt ("Zwolnij i przejrzyj ponownie") only when the
history of the job holds nothing of it.

"Holds nothing" is an answer of `reconcileAction`: `status: "pending"`, `code: "NOT_STORED"`, `stored: false`. Any other
answer is not absence: `stored: null`, a refusal and an unreadable history are *unknown*.

That answer is true only for the moment it was read. The client therefore keeps two separate things apart:

| | What it is | What it may do |
|---|---|---|
| `hostActionChecked` | plan id for which the **last** check of this tab answered "not stored", with no write attempt and no other check since | decides only whether the release button is **offered** |
| the read inside `hostActionRelease` | `reconcileAction` called again inside the conversation lock, for the plan the button was shown for | the only **proof** on which a plan is dropped |

`hostActionChecked` is withdrawn

- before every commit attempt: the first confirmation and every "Wznów zapis";
- as every check begins ("Sprawdź w robocie", the automatic check after a reload, and the release itself);
- on every answer other than "not stored" (confirmed, conflict, unknown), and on any error;
- when the pending plan or the open conversation is no longer the one it was recorded for.

`hostActionRelease`, under the existing lock `empire-code-conversation-host-v1`:

1. verifies that the stored conversation is what this tab holds, and that the conversation and the whole pending action
   are the ones the button was pressed for;
2. calls `reconcileAction` for the pending receipt;
3. verifies step 1 again after the read;
4. acts on the fresh answer only:
   - **not stored** → the plan is released, the proposal stays for a new review;
   - **confirmed** → the confirmed receipt replaces the plan (the same transition as a successful write); nothing is released;
   - **conflict** → the plan is marked as a conflict;
   - **unknown** → nothing changes; the plan stays pending and the message says that the history could not be read.

If the browser refuses to store the confirmed receipt (after a write, a check or a release), the pending plan stays, the
message says that the record is in the job and its confirmation is not stored, and the job is not touched. "Sprawdź w
robocie" or "Wznów zapis" stores the receipt later without a second record.

Why this matters: with a remembered answer as proof, the order *check says "not stored" → resume writes the record but
its acknowledgement is lost (or its receipt is refused) → release* dropped the plan and said nothing was stored while the
record was in the job; a corrected second review then had a new record identity and could be written as a second note
or reading.

### Limits

- The job stores and the conversation live in different browser databases. The read in step 2 and the conversation
  write in step 4 are **not one atomic step**. They run under the conversation lock, and every job write of a
  conversation plan by this application (`hostActionCommit`) runs under that same lock, so such a write cannot fall
  between them in a browser that provides the lock. A writer that does not take the lock is not excluded by anything here.
- A release needs a readable job history. While the history cannot be read, the plan stays pending.
- Evidence is the VM harness with the real adapter on the IndexedDB test double
  (`tests/stage5-client-job-recovery.test.cjs`). Native storage and real cross-tab timing are not shown by it.

## 2. One unwritten proposal per conversation

A conversation holds at most one proposal that was not written (`assistant.proposal`). `ASession.withProposal` refuses
any new proposal of the server while one is held — also one with the same `proposalId` — with error code
`PROPOSAL_HELD` and a message that says how to continue. Nothing is replaced:

- the held proposal, its saved corrections and the fields being edited in the review form stay exactly as they are;
- the turn that carried the new proposal is not applied (draft, history and calculator draft unchanged), and the
  utterance stays in the message field as unsent text;
- nothing is written to the job for either proposal.

The slot is freed only by the user: the proposal is written ("Potwierdź i zapisz w robocie"), cancelled ("Odrzuć
propozycję"), or its conflict is closed. Corrections (`editProposal`) and every turn without a proposal — materials,
calculator, navigation, clarification — are not affected.

The request whose answer is refused this way was already answered by the server and counts against the daily limit.

## 3. A proposed measurement time is the clock that was sent

A measurement proposal labelled `timeOrigin: "client_clock"` is accepted (`ASession.response`) only when

- the request carried a clock exactly as `ASession.clock` writes it (`local` `YYYY-MM-DDTHH:MM`, `utcOffset` `±HH:MM`);
- `fields.measuredLocal` and `fields.utcOffset` are exactly those two strings;
- `measuredAt` is the UTC instant of that clock (read by the built-in `Date`; the server derives the same instant with
  `jobMeasurement.observedInstant`).

Otherwise the whole answer is refused like any other stale or malformed answer: no proposal is stored, the draft is
unchanged and the text stays in the field. This judges only the incoming proposal. The user may still correct the time
in the review form; the job model validates what is reviewed.

## 4. Device clock behind the last save of the job

A record written from a conversation carries the time of the reviewed proposal's last save, and the adapter refuses a
record dated before the current job revision (`SOURCE_OUTDATED`). When the device clock is earlier than the last save
of the job, saving the proposal again cannot help. "Przejrzyj zapis" then names the clock and both times instead of
asking for another review, and stores nothing; the proposal and the corrections in the form stay.
