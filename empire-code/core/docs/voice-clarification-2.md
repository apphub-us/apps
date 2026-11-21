# EC-VOICE-QUALITY-2 — exact-fragment clarification, experimental speech

## Scope

This continuation keeps the same pinned local Whisper small q8 model, WASM runtime and offline pack. A development comparison of four frozen synthetic recordings found no semantic-accuracy improvement from fixed domain-vocabulary prompting; that experimental policy was rejected and is not shipped. No remote speech provider, hidden cloud fallback, weight replacement or numeric/unit autocorrection is added.

Jobs now preserves valid proposed entries while asking for clarification of an exact failed fragment. Example: a measurement and connector count are recognized but `80% przewodu` has no usable length unit. The UI offers `Clarify this part`, a small replacement field and `Repeat this part`. The user can repeat just the material with quantity and unit or type it. Other proposed entries are retained but **none of the group is saved** until all blocking problems are resolved and the user explicitly confirms the final review.

`Try a clarification example` opens the existing synthetic demo job and a clearly labelled example of a previous recognition error. It does not invoke the microphone and does not save measurements/materials. This is a test-data demonstration, not proof of a real field observation.

## Safety and provenance

Each repairable issue records a unique exact start/end span in the captured transcript. If normalization prevents a safe mapping, or identical failed fragments repeat, no repair target is guessed: a full text edit is required. Replacement validates the unchanged original span, selected job and review generation. Late transcription after changing the instruction/job or discarding cannot replace a new draft. The reply must itself describe exactly one permitted action of the failed kind; extra actions, missing units, unknown commands and targets to other jobs are refused.

After a valid reply, the entire instruction is parsed and checked again. Remaining unresolved fragments continue to block saving. Observation time remains the original capture-time context, not the time the user answered. The batch plan preserves the original transcript, the user's exact clarification, applied fragment and final reviewed transcript. A subsequent numeric correction remains in that audit text. Nothing is silently truncated beyond existing transcript limits. Existing batch schemas, record IDs, atomic per-store writes, explicit resume and duplicate protection remain unchanged.

The parser now preserves separately written mathematical signs (`- 7`, `+ 7`, `− 7`) rather than treating the sign as a location suffix. Unsupported punctuation dashes and negated readings refuse instead of becoming positive values. Explicit Polish plural `stopy` maps to the same foot unit as `stóp`; a percent symbol is NOT converted to feet. A material reply ending in a sentence full stop can replace its own fragment without turning the following item into a new unsupported sentence. The exact raw reply remains in provenance.

A mathematically plausible but incorrectly recognized value can still pass structural validation. No parser or checksum proves the speaker's intention. Every proposal remains experimental and requires human review; the full Polish speech-quality gate remains unaccepted.

## Test boundaries

A frozen set contains four development recordings and twelve separate holdout recordings, generated using existing macOS TTS voices without accessing the user's microphone. Model output, semantic parser outcome, refusal, and an incorrect accepted proposal are separately recorded. Original unsuccessful evaluations remain evidence. Later fixes replay their retained transcripts as regression checks, not as a newly independent speech-accuracy benchmark.

Native tests use dedicated Chrome profiles, exact shipped files, synthetic job records and synthetic audio. They distinguish actual ASR of an English short answer from a real physical microphone test. No physical iPhone/Safari, noisy jobsite, human-accent or broad speech-accuracy acceptance is implied. Developer and native results are stored outside source in the checkpoint, with integrity pins. The 12346 app, primary repository and user browser databases remain outside the update scope.
