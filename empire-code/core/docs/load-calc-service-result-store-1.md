# LC-SERVICE-RESULT-STORE-1 — saved historical service results

## Scope and status

This milestone adds an explicit full-result save and a historical reader for the existing bounded NEC 220.82 Load Calc + Service Sizing flow. It starts from the accepted 156-file qualification-semantics candidate. It does not implement a job/address/photo/material record, cloud sync, import/export, deletion, editing, Restore or Use inputs.

The worker authored code and focused tests only: **NOT_RUN_BY_WORKER**. The coordinator must build the new module registration, run the focused tests and independent checks, and perform final verification before acceptance. No native Safari, iPhone or PWA acceptance is implied.

All preexisting calculation modules and the lcv3/preset contracts remain unchanged. The new pure module is `src/calc/loadCalcServiceRecord.js`; its record wrapper is separate from Favorites. Historical records cannot approve an installation or resolve an open model question.

## User flow

1. **Saved service results** is available at the beginning of Load Calc, before the input form. It is independent of the current calculation method, Calculate gate and Service Sizing gate. The reader can still open records when live calculator modules are missing, provided the record module is present; the existing missing-core refusal still applies to the live form.
2. After an explicit, current Service Sizing assessment, **Save full result** appears after its result boxes and before the existing final **Calculation details & sources** disclosure.
3. The name prompt creates a new record. Cancellation or a refused name does not write. The existing **Save** button continues saving an ordinary calculation preset; its label and behavior are unchanged.
4. **Saved service results** lists records with name, saved UTC time, original VA/A display values and recorded qualification status. **Refresh saved results** rereads the storage namespace.
5. Opening a record shows **Saved result — historical**, its saved version, original Load Calc summary, complete input/provenance fields, service design, full Service Sizing output and original source metadata. A collapsed full-record JSON view is available for inspection.
6. **Close saved result** closes only the historical reader. It does not restore, reset, recalculate, assess, focus or change the current form.

The UI says that records are saved **in this browser**. There is no backup or cross-device synchronization feature in this milestone.

## Record contents

The v1 record has the following structure:

```text
kind: empire-code.service-result
recordVersion: 1
id, name, createdAt
producer:
  applicationRevision, sourceBaselinePin, calculationSourcePin, recordContractRevision
calculation:
  draftPayload
  request
  response: { facade, result }
serviceSizing:
  designContractRevision
  design
  analysis
  sources
```

`draftPayload` is exactly the existing `toPayloadV3(lcDraft())` output. It preserves the snapshot, declaration provenance, context, complete parser/load error maps and source Favorite identity without adding UI state to lcv3. The record additionally stores the actual request, full original response, explicit service design, full original Service Sizing analysis and its original source register.

The producer identifies application revision `LC-SERVICE-RESULT-STORE-1`, source baseline pin `d168fa3b6be018ec2560a3cfbd3a5347b17d6d802926a1b5b4f85b2fbe3b6ab7`, and calculation source pin `40a7de48e3c0ede97210bacb6e40b3e7e3fb0a5fdf9fd26f7d1cfe21f0709ebe`. The calculation pin covers the nine existing modules listed by `CALCULATION_SOURCE_FILES`, using sorted relative-path/SHA-256 pairs in compact UTF-8 JSON. It identifies calculation bytes, not authenticity, approval or a signature.

The pure API is `createRecord(capture, metadata)`, `validateStoredRecord(record)`, `readStoredRecord(record)` and `parseStoredRecord(text)`. Create/read/parse return either `{ok:true,record}` or `{ok:false,problems}`. Validation returns problem strings or an empty list. Metadata limits and full shape/lossless-JSON validation belong to this module rather than duplicated UI rules.

Creation verifies a performed `EVALUATED` or `DESIGN_INVALID` assessment from the bounded current flow. Verification may call the existing unchanged projection, facade and sizing functions to compare the whole captured tuple; it never substitutes their recomputed return values into the saved record or live UI. Reading is structural and does not call either calculation engine. Supported historical records with a different valid source fingerprint remain readable with their original metadata.

## Freshness boundary

The Save handler checks the actual connected Save button and analysis identity, `lcCalcFresh()`, `LC_SVC.calcKey`, the current request/response, and absence of a Load Calc or service fault. It captures the current tuple before the name dialog, compares it again after the dialog and immediately before the write. A detached button from an old render cannot save an old result even when its values happen to match a later assessment.

A new Calculate, load edit, design edit, reset or existing preset restore retains the existing lifecycle rules. Reverting an edit does not restore an earlier service analysis. The new feature never copies saved data into `LC`, `LC_CALC` or `LC_SVC`.

A fresh result is allowed to retain unresolved facts. In particular:

| Saved case | Preserved meaning |
|---|---|
| Declared 200 A, general-path candidate 200 A | Existing non-operative candidate and unchanged-premise status. |
| Declared 200 A, conditional dwelling candidate 175 A | Changed premise, review required, candidate withheld; table reference retained. |
| Dwelling 100 A with Cu 85 A / Al 90 A reference | Open interpretation and withheld selection remain open. |
| Minimum available with unanswered selected rating | Minimum and waiting status stored together; unanswered inputs remain null. |
| Performed DESIGN_INVALID assessment | Exact malformed design string and module refusal are stored; no corrected value is invented. |

There is no requirement for `recommendationAvailable` to be true. Probes, live validation returns, marks, focus state and other transient UI values are never saved as an assessment.

## Storage and errors

Each record has one storage key:

```text
empire_code_service_result_v1:sr1_<32 lowercase hexadecimal digits>
```

The UI obtains 128 random bits through `window.crypto.getRandomValues`. There is no clock/counter fallback. It checks that the exact key is absent, prepares a fully serialized record, rechecks the capture and key, and issues one `setItem`. An observed collision is retried at most five times; existing keys are never intentionally overwritten.

There is no shared mutable collection array or index. Distinct saves write distinct keys, avoiding loss of one save through a shared-array read/modify/write. This is not a locking or transaction claim across browser agents. Browser storage enumeration can change while another tab writes; refresh reads it again.

After `setItem` returns, the handler compares the read-back bytes before confirming success. A post-write read failure or mismatch reports uncertainty rather than claiming nothing was written. Quota, access, parser and listing errors use their own record status. They do not call `lcStorageFault`, `lcOpFault` or `lcRenderResult`, so a record-storage failure does not clear the active assessment.

Only the record namespace is enumerated. Record IDs must agree with their key suffix. Unknown versions, malformed keys, corrupt JSON and mismatched IDs remain stored and appear as unreadable/unsupported items. Reads do not clear, repair, migrate or rewrite storage. Existing Favorites bytes remain separate.

Storage design reference: [WHATWG HTML — Web storage](https://html.spec.whatwg.org/multipage/webstorage.html), consulted by the coordinator on 2026-10-06 UTC.

## Historical rendering and test boundary

The service renderer accepts optional historical presentation options and a disclosure ID prefix. Its default live output and existing IDs remain unchanged. Historical mode uses plain-text notes, box headings and source references, so it does not read the current task through `lcRich/lcRefTitle` or activate current reference/field-navigation handlers. Its labels identify the saved model; DESIGN_INVALID/waiting/undersized copy does not instruct an action against live controls. Original module diagnostics and full record data are preserved.

The original Load Calc response is rendered from the record, without `lcRenderResultBody` or `lcFmt` and without temporary replacement of global `LC`. One historical record is open at a time. History has a separate `lcRecordArchive-` disclosure prefix, so live and historical disclosures can coexist.

The harness extends its original Favorites-only storage with `storageByKey`, `length/key`, and a separate `store.byKey` map. `store.data` remains the old Favorites alias, and `sets/failNextSet` keep their meaning. Tests can supply crypto and a name-dialog callback and directly instrument the exposed storage stub for controlled faults.

`test/loadCalcServiceRecordUi.test.js` covers real controls, exact save/read/restart, empty/different/missing-core access, conditional and invalid assessments, stale/detached/prompt-time refusals, cancellation, secure-ID failure/collision, per-record interleavings, quota/access/readback failures, unreadable records, refresh/open freshness, version provenance, inert history, separate disclosure IDs and literal-text wrapping. Synthetic fault/interleaving tests are explicitly distinguished from native browser evidence. The pure module has its separate contract tests.

CSS additions are scoped under `#lcContent` to record containers, buttons, field rows and wrapping. No global control, zoom, routing or service-worker changes are part of this milestone.
