# LC-JOB-ARCHIVE-1 — local job archive files

## Scope and user flow

A current saved Job card has **Prepare job archive (.ecjob)**. It reads the selected saved job, all its metadata versions, all measurement/material/photo detail versions, every retained original photo (including excluded originals), and all results referenced by the job history. Unrelated jobs, unlinked results, Favorites, the live calculator draft and unsaved journal editors are not exported. Open drafts must be saved or explicitly discarded first; export does neither on the user's behalf.

Preparation produces a **Download .ecjob** link in the independent **Job archive files** panel. Preparation is not a claim that a browser saved a file to disk. The user downloads the file, then selects that downloaded file with **Open archive file** to check their actual copy. A file can be opened even with no current job or no live calculation. Errors and cancel controls do not clear live calculations or drafts.

Opening is **read-only, in memory, and separate from live records**. It does not merge, restore, create or update a job, import a preset, invoke an electrical calculation, or replace IDs. Category/item/version selectors navigate the archived data only. A later live job with the same ID remains independent. Close releases the file-view/object URLs, not live data or the downloaded file. Reopening the app requires selecting the file again. Restoring into the editable job databases is explicitly outside this milestone.

Archived original photo bytes are not compressed, re-encoded or stripped of metadata. Photo preview uses a verified Blob from the file, not the live photo database. Linked service results retain their **exact original localStorage text**, including formatting; readable supported results use their original analysis/qualifications. Read operations use structural validators only, never calculation engines. Missing linked results have a null raw field. Corrupt/unsupported result text is preserved as raw inert text with an explicit warning; it is not substituted by another result. Such a file is marked **not a complete recovery of those results**. Missing/corrupt photo originals or broken job/journal chains refuse the whole export/open instead of silently omitting entries.

## Privacy and semantics

An `.ecjob` file is **not encrypted**, signed or uploaded. It can contain addresses, free-form notes, electrical observations and original photos with embedded EXIF/GPS. SHA-256 checks detect byte differences from descriptors, not authentic capture, authorship, regulatory compliance or installation approval. A deliberate author can create a new internally consistent archive; no authenticity claim is made.

Capture stores `startedAt`, `completedAt` and `two_read_stability_check`. Each IndexedDB read is a native **readonly** transaction, resolved on complete. Databases and localStorage cannot be one joint transaction. The collector reads all selected data and hashes every photo, then repeats the reads/hashes and compares canonical metadata and raw result texts. An observed change refuses preparation with SOURCE_CHANGED. This is a conservative stability check, **not an atomic cross-database snapshot** or detection of adversarial change-and-revert. Later writes are not included. Keep other editing windows quiet when preparing an archive.

## Source and file boundaries

New modules:

* `src/jobs/jobArchive.js`: bounded closed metadata contract, job-chain cross-reference checks, journal validation through existing public read APIs, explicit result warnings and canonical JSON. No DOM/storage/engine calls.
* `src/jobs/jobArchiveFile.js`: binary Blob encoder and decoder, UTF-8 and SHA-256 validation, exact length/layout checking and per-photo verification. No storage access.
* `src/jobs/jobArchiveSource.js`: fixed known existing database schemas, existing-only opens, readonly scoped collection and two-read comparison. No put/add/delete/clear, database migration or committed creation of a missing optional database.

All pre-existing src modules and embedded module bodies remain unchanged. The bundle appends three modules. One explicit CommonJS alias resolves the new model's `../calc/loadCalcServiceRecord.js` dependency to the already registered result reader; all previous resolver inputs keep their original behavior. Existing tests change only module registry assertions and optional harness exposure. The shared UI gains a global archive panel and a per-job export section. Archive status/render state is separate from LC/LC_CALC/LC_SVC and job/journal state.

A required missing job refuses export. Absent optional journal databases are read as empty by aborting any upgradeneeded open; the export does not persist a fallback schema. Unknown versions/schema, non-indexable rows, missing links, source read failures, quota/access denial, oversized data and changed sources are explicit refusals. A localStorage access exception is **not** treated as a missing result.

## ECJOB v1 file format

No ZIP, compression, executable script, path entries, external URLs or embedded HTML interpreter is used. The maximum file is **44 + 32 MiB + 200 MiB**. Metadata has its own 32 MiB UTF-8 limit and bounded node/depth limits; individual result raw text has the existing 2 Mi UTF-16-unit limit. Original photo limits remain 100 per job, 12 MiB each, 200 MiB combined. Archives outside supported bounds are refused, not truncated.

| Offset | Length | Meaning |
|---|---:|---|
| 0 | 8 | ASCII `ECJOB01\n` |
| 8 | 4 | Big-endian unsigned UTF-8 manifest byte count |
| 12 | 32 | SHA-256 of exactly those manifest UTF-8 bytes |
| 44 | manifest length | Canonical UTF-8 JSON |
| after manifest | sum of original lengths | Concatenated exact original photo bytes |

Canonical JSON uses recursively lexicographically sorted object keys, original array order and ECMAScript JSON primitive encoding. On read, parsed metadata must serialize identically. Duplicate JSON keys, alternate whitespace/numeric encodings, unknown fields, unsafe values, cycles, lossy numbers, bad UTF-8, wrong magic/version, oversized declarations and extra/truncated bytes are refused. The metadata and every photo digest/header are verified **before** returning an opened archive. There is no compressed-data expansion or full-file base64 representation; photos are sliced/hashed one at a time and assembled as native Blob parts.

Manifest fields:

```text
kind: empire-code.job-archive
archiveVersion: 1
archiveId: archive1_<32 lowercase hex digits from 128 secure random bits>
producer: {applicationRevision, baseSourcePin}
capture: {startedAt, completedAt, consistency}
job: {head, revisions}
measurements: [all original measurement revisions]
materials: [all original material revisions]
photoRevisions: [all original photo detail revisions]
originals: [{photoId, jobId, file: original descriptor, offset}]
results: [{serviceResultId, raw: exact original text | null}]
```

Original offsets begin at zero relative to the photo payload and are contiguous, nonoverlapping and exact. Every photo chain has one matching original and one owner. Every journal jobRevisionId must refer to a version in the full archived job history. Job chains must be complete, contiguous and retain original result links. Results have exact one-to-one coverage of those links; warnings are derived from data during validation, not trusted from a saved flag.

## API

`jobArchive.validate(manifest)` returns parsed read-only views, derived counts/warnings or an explicit error. `canonical(value)` is used only after safe bounded validation; it is not a general arbitrary-object serializer.

`jobArchiveFile.encode(manifest, assets, {crypto, check?, progress?})` returns a Blob, filename, copied manifest and counts/warnings. `decode(nativeFileOrBlob, {crypto, check?, progress?})` verifies all content and returns manifest/assets/counts/warnings. Optional cancellation guards are checked across asynchronous boundaries. No native decoder or source DB is needed to open archive metadata; a displayed raster still depends on the browser image decoder.

`jobArchiveSource.capture({indexedDB, localStorage, crypto, now?, check?, progress?}, jobId)` produces the verified saved-data snapshot for encoding. Read-only transaction failure/cancellation cannot be exposed as success. Every source connection is closed after its read. Raw persisted result texts and exact retained original Blobs are carried forward, not regenerated from current calculations.

## Acceptance boundary

New automated tests exercise the real exported model/codec and actual shipped UI in the existing **explicit DOM/IndexedDB test double**. They test round trips, archived originals/decimals/time offsets/statuses, missing and unsupported linked text, hostile metadata, duplicate keys, corrupt/truncated/oversized files, cross-job/chain checks, source changes, transaction aborts, no mutation of live data, URL cleanup and late/cancelled actions. This is not native Safari/iPhone acceptance.

`tools/job-archive-native.cjs` is a dependency-free Mac Chrome runner using Node 22 and a fresh profile. It must be run on an authorized Mac with installed Chrome. It seeds synthetic records only, checks a real download and reopening from disk in a second isolated browser context, and refuses success on test/source failures. Reports and screenshots go **outside** source. The current delivery does not claim those native scenarios passed unless a corresponding completed report is present. The package installer gates applying to the Mac test copy on this actual local test.

No Git, publication, editable-data restoration, cloud synchronization, photo transformation, Safari-profile access or source-update of the production repository belongs to this stage.

Primary design references: Indexed Database API transaction completion and scheduling (<https://www.w3.org/TR/IndexedDB/>); File API Blob slices and object-URL lifetimes (<https://w3c.github.io/FileAPI/>); Web Crypto SHA-256 (<https://www.w3.org/TR/WebCryptoAPI/>). Application outcomes are evidenced by test logs, not inferred from these specifications.
