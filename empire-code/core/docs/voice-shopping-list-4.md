# EC-VOICE-MATERIALS-4 — shopping-list review and visible build identity

This is an update of the experimental 12347 preview only, not the stable 12346 application. The UI visibly identifies itself as PREVIEW M4. A version-specific query string may be used to load this build without changing the origin or deleting browser storage. It is not a claim that a prior screenshot proves the user's cache mechanism or browser state; the server/source hash and the absence of the new action in the screenshot established a version mismatch worth checking.

## Material interpretation

The reported screenshot text is retained verbatim in checkpoint SCREENSHOT-TRANSCRIPT.txt (text, not original audio). It is now interpreted as four draft groups: two breakers with literal rating and manufacturer text, two wires with unconfirmed size/colours/length wording, fifteen plastic bushings, and two metal bushings. Recognized counts, unconfirmed source details and material types stay visible. Only one clarification is shown at a time. None of the four groups is persisted until the unresolved facts are handled and the user confirms the final review.

Normal shopping-list introductions and additive clauses are supported without treating every fragment as a separate command. Breaker/breakery/wyłącznik and busing/bushing forms select the material path. Rating, quantity and model are separate facts. This is documentation of an explicitly requested item; it does not select a breaker, approve installation, check a panel listing or establish code compliance. Literal manufacturer text such as Zimens is not silently rewritten to Siemens. A model/type is requested or can explicitly remain not recorded. Final confirmation remains necessary even for a syntactically valid specification.

Plastic and metal are retained as material attributes. A fitting-size clarification may contain only an explicit dimension or the words "rozmiar niepodany". Such a short reply is applied only to an independently revalidated fitting question, preserving its existing count and material type. The exact reply and expanded replacement both remain in the existing audit transcript. Wrong families, extra actions, forged issue metadata, stale replies and incomplete dimensions refuse.

Wire size must be explicit. The interpreter does not convert separated/spoken "trzy zero" into 3/0 AWG, guess the meaning of "Jakieś 50 fit i jeden", assign unspecified colours to individual records or multiply count by length. Explicit size, colour text and explicitly per-piece length can be retained as a specification with a separate piece count. An example is 2 pcs with specification "3/0 AWG · czerwony i czarny · po 50 ft"; it is not a calculated 100 ft order. Unassigned or approximate lengths remain questions.

## Scope and evidence

Only jobVoiceMaterials.js, the workspace HTML, new tests and this document change from the M3 baseline. The existing intent dispatcher, storage schemas/APIs, archive/Restore modules, calculators, speech worker/runtime and model weights are unchanged. No migration, provider change, global installation, browser-storage deletion or user-profile/microphone access is performed.

The prior developer regression tests remain. New tests cover the actual screenshot, normal shopping introductions, breaker facts, plastic/metal, short clarifications, stale/forged targets, explicit versus ambiguous lengths, varying quantities and preservation of unknown actions. Native Chrome acceptance covers a dedicated synthetic job, four-group UI, original-record persistence, idempotence, navigation with the version query and responsive sizes. Historical source and tests are retained in BASE-236. Reports are stored outside the candidate and are not substituted for a speech-accuracy test.

This remains a bounded interpreter, not general language understanding. The ASR model is not changed and free Polish speech, physical iPhone and noisy-field quality are not accepted by this release. Structurally valid but incorrect recognition still requires human review. This change fixes material grouping and review for supported cases; it does not prove arbitrary future utterances will work.
