# LC-JOB-CARD-1 — local job cards and immutable revisions

## Scope and acceptance boundary

This first job-card slice adds a title, free-form address/location, notes, explicit links to previously saved Service Result v1 records, and retained card revisions. A card may be created before any calculation exists. It has no electrical approval, completion or installation status. Measurements, materials, photographs, voice input, estimates, synchronization, export, deletion, result-link removal and restoring historical revisions are outside this milestone.

The model/store author did not execute tests or builds: **NOT_RUN_BY_AUTHOR**. Coordinator evidence determines the tested implementation status. No native browser runtime was available in the inspected developer environment. The native IndexedDB browser gate remains **PENDING / NOT_RUN** unless separate native evidence explicitly supersedes that status. Transaction simulations are not native IndexedDB, Safari, iPhone or PWA acceptance. No Mac changes, installation, publication or release are part of this work.

## User behavior

Job cards are accessible before the Load Calc form and its calculation gate. Create a card with a title and optional address/notes, then save it. An explicitly selected saved result can be linked during creation or a later edit; none is automatically selected. A newly added but still unsaved link can be removed from the draft without losing typed fields. Previously saved links cannot be removed in this slice. Ordinary metadata edits remain possible when an already-linked result is unavailable.

Opening a current card shows its saved fields and linked results. Editing and saving a change produces another immutable card revision. History shows those revisions in their recorded integer sequence. An older revision is read-only and never becomes current through a restore action. Existing result links remain part of each later revision. Adding an already-linked result again is a no-op and does not change its original link-time label or timestamps.

The saved service result opens through the existing historical result reader. Its original diagnostics, conditional references and unresolved qualification checks remain unchanged. Opening a card or a linked result does not alter, recalculate, restore or assess the active Load Calc or Service Sizing state.

A stale editor receives a conflict rather than overwriting newer work. Its draft stays available. Viewing the latest saved card is separate from explicitly discarding/reloading the editor. Listing or refreshing saved cards does not discard unsaved fields. A confirmed save followed by a list refresh failure is still reported as saved with a refresh problem.

Cards and their links are local to this browser/device. The feature does not provide backup or cross-device synchronization.

## Separate data model

The pure module is `src/jobs/jobCard.js`, exposed in the bundle as `EC.jobCard`. It has no dependency on calculators, DOM, storage, clock or randomness. The native adapter is `src/jobs/jobCardStore.js`, exposed as `EC.jobCardStore`.

A revision contains exactly:

```text
kind: empire-code.job-revision
recordVersion: 1
jobId, revisionId, parentRevisionId, revisionNumber
createdAt, savedAt
producer: { applicationRevision, recordContractRevision }
title, address, notes
serviceResultLinks: [{ serviceResultId, linkedAt, savedName, savedAt }]
```

The current head contains exactly:

```text
kind: empire-code.job-head
recordVersion: 1
jobId, currentRevisionId, revisionNumber
```

The application produces `LC-JOB-CARD-1` / contract revision 1. The historical reader also accepts a different bounded producer application revision under the supported record contract. It does not replace the stored producer with the current value.

IDs use `job1_`, `jrev1_` and the existing `sr1_` prefix followed by 32 lowercase hexadecimal digits. Production IDs contain 128 bits obtained from the injected browser `crypto.getRandomValues`; there is no timestamp, shared-counter or `Math.random` fallback. ID collisions at the transactional storage boundary get at most five attempts.

Title is nonblank and at most 200 UTF-16 code units. Address is optional, at most 2,000; notes optional, at most 20,000. Original strings, whitespace, Unicode and raw observations are preserved exactly. Up to 100 unique service-result links are supported. A complete revision is bounded to 128 Ki UTF-16 code units in its JSON representation, including escaping overhead. Accessors, custom prototypes, non-enumerable/symbol properties, array holes, cycles, nonfinite numbers, negative zero and other non-JSON data are refused before copying.

Timestamps use canonical UTC millisecond text. Revision 1 has no parent and identical creation/save timestamps. Later revisions keep the original creation time, point to the previous revision and increment its safe integer number. Revision numbers and parent identities establish history order; wall-clock order is not assumed. Existing links are retained in their original order and copied unchanged; new links receive the new revision's save time as `linkedAt`.

The frozen Service Result v1 and Favorites/lcv3 contracts are unchanged. A link's saved name/time identify the original selection if the source becomes unavailable; they are not a duplicate electrical result or an authenticity claim.

## Persistence and concurrency

Database `empire_code_jobs`, version 1, has two stores:

| Store | Key | Other schema |
|---|---|---|
| `jobs` | `jobId` | No auto-increment or indexes. |
| `jobRevisions` | `revisionId` | Nonunique, non-multi-entry `byJobId` index on `jobId`. |

All operations use a transaction over both stores. Creation atomically adds the head and first revision. Updates read and validate the current card, compare the editor's expected revision ID inside the transaction, add a new immutable revision, and update only the head. An immutable revision is inserted with `add`, never overwritten with `put`. An unchanged save writes nothing. The expected revision check precedes that optimization, so a stale no-op is still a conflict.

Write confirmation waits for the transaction's `complete` event. A successful insert request followed by another failure or commit abort is not a successful save. Existing data remains the coherent prior state when a write transaction aborts.

Before each actual write, the same readwrite transaction checks the prospective limits: at most 500 heads, at most 500 distinct indexed job identities (including orphan histories), and at most 500,000 total revision records (including unindexed records). Creation adds one head and one previously absent identity; an append to a validated current card adds neither. Both add one revision. The separate 1,000-revision limit applies to the edited card. Counts are checked without retaining all historical values. Invalid counts or failed reads abort before writes; unchanged saves remain no-write. These are product inspection bounds, not browser quota guarantees or a repair of unrelated corrupt chains. A generated job ID is refused if it already has a head or orphan revision records. It never adopts orphan history into a new card.

Read methods also resolve only on completion of their coherent read-only transaction. They validate the full per-job chain: matching store/index IDs, exact current head, contiguous sequence, parent links, shared creation time, original link retention and newly added link timestamps. Missing, branched, corrupted or unsupported history is not replaced by a plausible alternate revision.

Listing validates one full job history at a time, then retains only the current snapshot. It also compares total/indexed revision counts to expose records without an indexable job ID and inspects a bounded `nextunique` index cursor for orphan/invalid job identities. Orphan-only storage therefore does not look like an empty database. More than 500 heads/distinct indexed job identities, more than 1,000 revisions for one job, or more than 500,000 revision records yields an explicit `LIMIT`, never a silently truncated successful list. Unreadable stored data is preserved; there is no repair/delete path.

An unsupported database version or schema is refused. An upgrade is created only from a new empty version-0 database. Blocked or closed open requests are abandoned; a late upgrade is aborted and a late successful connection closed, without starting the abandoned operation. `versionchange` closes and invalidates the adapter. `close()` is terminal for that adapter instance; reconnect through a fresh instance/reload. Already-started native transactions follow their normal completion/abort lifecycle.

### Cross-storage result links

Saved Service Result v1 records remain in their accepted localStorage namespace. Job cards are in IndexedDB. There is no atomic transaction across these two stores. The UI freshly validates explicitly selected new descriptors again before a save. A result may nevertheless become unavailable later; its link is retained and visibly reported as unavailable/unsupported. Ordinary card edits do not require already-linked results to remain readable. No link is repaired, moved, silently replaced or reinterpreted.

## Public API

Pure functions:

- `createInitialRevision(fields, links, {jobId, revisionId, savedAt})`
- `createNextRevision(currentRevision, fields, addedLinks, {revisionId, savedAt})`
- `validateRevision(value)` and `validateHead(value)` return problem strings.
- `readRevision(value)` / `readHead(value)` return independent validated copies in structured envelopes.

`fields` is exactly `{title,address,notes}`. New descriptors are `{serviceResultId,savedName,savedAt}`. Duplicate IDs within one descriptor batch are rejected. Initial/next creation returns `{ok:true,revision}` or a controlled failure; unchanged next returns `unchanged:true` and a copy of the old revision.

`createJobStore(indexedDB, {crypto, now?})` returns async `create`, `save`, `list`, `read`, `history` and `readHistorical`, plus `close`. `now`, when injected, returns canonical ISO text; production defaults to the current Date ISO value. Reads use neither time nor randomness. Caller fields and link descriptors are validated and independently copied before any asynchronous open, so mutating the caller's objects cannot change an in-flight save.

Create/save/read success is `{ok:true,job:{head,revision}}`; save may include `unchanged:true`. List returns `{ok:true,jobs,problems}` with visible per-card unreadable rows. History returns descending `revisions`; historical read returns `revision`. Failures contain `ok:false`, stable `code` and `problems`, with `currentRevisionId` on conflicts. Codes include `VALIDATION`, `CONFLICT`, `NOT_FOUND`, `UNAVAILABLE`, `BLOCKED`, `UNSUPPORTED`, `CORRUPT`, `QUOTA`, `ABORTED`, `COLLISION` and `LIMIT`.

## Validation evidence to collect

Pure tests cover exact snapshots and input preservation, zero-link cards, edits and retained links, idempotence, supported historical producers, timestamp/size/shape bounds, unsafe values and controlled exceptions. The independent transaction simulator and UI tests cover event ordering, late aborts, concurrent editors, identity collisions, limits, malformed storage, blocked/closed opens, unchanged active calculations, stale UI handlers and draft preservation. Native browser testing remains a separate gate and must not be counted as passed from that simulator.

Storage references consulted during architecture review:

- [WHATWG HTML — Web storage](https://html.spec.whatwg.org/multipage/webstorage.html): shared storage has no specified locking; the existing independent service-result keys remain separate.
- [Indexed Database API 3.0](https://w3c.github.io/IndexedDB/): transactions, scheduling, commit/abort lifecycle, object stores and Blob-capable stored values. Future attachments still require their own implemented contract.

### Resume regression evidence boundary

The prospective aggregate guard has eight targeted regression cases, covering orphan identities, global heads, simultaneous clients, count failures, and unchanged saves. The 500,000-total boundary uses explicitly injected count responses on a small simulated database; it is not a half-million-record browser capacity or performance test. Coordinator logs GLOBAL-BEFORE-1 and GLOBAL-AFTER-1 preserve the original failure and corrected result. The IndexedDB reference above was re-opened on 2026-10-06 during the resumed review.
