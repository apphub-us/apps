# EC-VOICE-WORKSPACE-1 — isolated preview, not a voice-production release

## Delivery boundary

Jobs, Tools and Code are separate navigation entries. Jobs is the initial screen and does not initialize the Load Calc form. The original calculators and job/measurement/material/photo/archive/restore source modules remain unchanged. The workspace reuses the existing records, editors and storage APIs; it does not create a parallel collection of electrical facts.

This candidate is a test-data preview on a different loopback origin from the established port 12346 application. No migration or user-browser inspection is performed. The old application and primary repository remain untouched. `Try a sample job` creates/reopens a clearly labelled synthetic job only after an explicit click. The command supplied by this action is an example, not captured speech or a real inspection.

## Reviewed capture

A supported Polish or English instruction is converted into up to eight proposed measurement/material cards. An optional exact, unique job title/address selects a saved job; fuzzy selection is refused. Full transcript, job, quantities, units and observation time are visible before confirmation. A missing fact, ambiguous number, unknown action, explicit negation or unrecognized fragment blocks the whole proposal. The parser is deliberately bounded grammar, NOT unrestricted natural-language understanding or a general agent.

Measurements require an explicit current-time expression, a measurement location, a number and a supported unit. AC/DC and instrument are not guessed. Supported spoken signs stay attached to values; negated statements are not positive observations. Decimal text is retained after explicit parsing. Materials require an explicit positive quantity, unit and name. Technical requirements, circuit design, automatic compliance approval, purchases and destructive actions are outside this capture path. Recognition can produce a plausible but incorrect transcript: the parser cannot prove it heard the user's original intention. Human confirmation is still required.

A single confirmation writes through the unchanged measurement/material stores. A new separate `empire_code_voice_batches` journal retains immutable plans with allocated secure record IDs and exact transcript. This is NOT an atomic transaction across separate databases. On an interruption, some entries may already exist. Explicit resume reconciles the exact prior revisions and adds only missing entries. Reconfirming the same plan does not duplicate its rows. Independent user-created plans can intentionally record duplicate real-world observations; global semantic deduplication is not claimed. The exclusive Web Lock coordinates this batch mechanism, not all unrelated legacy editors. A changed job revision blocks remaining writes. Maximum 200 batch markers is an implementation bound; this preview has no automatic deletion/rotation or archival of that new journal. Existing `.ecjob` exports retain resulting measurements/materials, not the separate speech transcript/batch journal.

## Speech runtime and acceptance

The preview contains pinned local Transformers.js 3.8.1, ONNX Runtime Web/WASM and quantized ONNX Whisper small assets. Model revision: `36050c46d777d46dc4b5f43f6d90574fc38f8732`. Speech-pack files are approximately 274.4 MB, checked against the packaged manifest and cached only when the user requests setup. Code, weights and their licenses are included; files used for rejected tiny/base experiments remain outside the candidate.

No remote speech-recognition endpoint or cloud fallback is configured. The worker limits inference fetches to the same-origin speech-pack path. The browser requires microphone permission on a user action. Audio is held in memory for transcription and not saved as a job attachment or uploaded by this speech path. It is not a claim that unrelated legacy AI/network features are offline. Recordings are bounded to 30 seconds; UI/source changes, discard and leaving the screen cancel capture. The same microphone flow has NOT been accepted on a physical iPhone or in noisy electrical work.

Actual Chrome runs established runtime loading and transcription after shutdown of the local HTTP server and a page reload from cached resources. That is runtime/offline evidence, NOT accuracy acceptance. Synthetic Polish speech in the retained quality test changed `80 stóp` into `80%`. Tiny and base experiments also lost trade words and locations. The strict end-to-end quality gate remains FAILED. These failed recordings/transcripts are preserved and must not be converted into an overall voice PASS because the runtime or parser succeeds.

The UI visibly labels this as an experimental preview for test data. No claim of reliable Polish/English field speech, universal offline browser support, offline first-install, or general AI assistant is made. A real-device speech evaluation, richer intent interpretation and trustworthy field acceptance remain open.

## Verification

Developer tests, explicit simulated IndexedDB tests, native UI/save/resume tests, native Restore regression, and speech-quality evaluation are separate results. Historical test counts are not combined into invented totals. Existing navigation/cache assertions change only to reflect the approved Jobs/Tools/Code organization and separate speech cache. Calculation assertions are not relaxed.

Scope of this continuation: final review of prepared candidate, signed-number and negation fixes with regressions, a one-click synthetic example, preserved failure evidence, and a separate preview server. No production/main-repository update, account change, provider switch, global npm installation, user-profile access, real job restore or clearing of browser storage.
