# LC-JOB-MEASUREMENTS-1 — manual measurements linked to jobs

## User flow
Open a saved current Job card, then Measurements → New measurement. Enter a label, quantity, decimal reading, unit, measurement point/location, observed local date/time and explicit UTC offset. AC/DC may be recorded for voltage/current; instrument and notes are optional. Use current time fills the date/time and current device offset only when explicitly pressed. No date, unit or measurement value is otherwise assumed.

Save measurement creates an independent observation. Correct entry fixes previously recorded facts and requires an explanation if fields actually changed. For a new reading at a different visit or time, create a New measurement instead. A correction adds a new immutable version without replacing the original; View reading history is read-only. Unchanged Save writes nothing. A stale correction conflicts even when its proposed fields match the current version. A conflict retains all typed fields, provides a read-only latest view and an explicitly labelled discard/reload operation. Unsaved drafts are not durable across page reload; the editor states this.

Manual field readings are not a qualified maximum-demand survey, automatic calculator input, code-compliance verdict or installation approval. No unit conversion or electrical inference occurs. Voltage/current may be signed; the app records observations rather than silently correcting their sign. Decimal text, trailing zeros, whitespace, units, location, instrument and notes are retained. Decimal point only; thousands separators and exponent notation are rejected rather than guessed.

Quantities/units: voltage V/mV; current A/mA; resistance Ω/kΩ/MΩ; temperature °C/°F; active power W/kW; apparent power VA/kVA; frequency Hz; length mm/cm/m/in/ft. Values are stored as bounded decimal strings, not rounded binary numbers. Date/time uses a minute-precision wall-clock string plus a numeric UTC offset, with derived UTC checked for consistency. No current-zone conversion is performed when reopening an earlier observation. Numeric offsets disambiguate repeated wall-clock times but do not claim to validate an IANA time zone or daylight-saving rules at a location.

## Data boundary
The new pure model is src/jobs/jobMeasurement.js; native persistence is src/jobs/jobMeasurementStore.js. Both are bundled verbatim after the existing 23 modules. The accepted jobCard, jobCardStore, saved-service-result and all electrical calculator modules are unchanged.

An observation revision contains kind, recordVersion, measurementId, revisionId, parentRevisionId, revisionNumber, jobId, jobRevisionId, createdAt, savedAt, producer, reading, measuredAt and correctionReason. The reading fields are label, quantity, valueText, unit, location, measuredLocal, utcOffset, mode, instrument and notes. Closed shapes reject missing/unknown fields, accessors, custom objects, cyclic and oversized data. IDs use meas1_ or mrev1_ followed by 32 lowercase hexadecimal digits generated from 128 secure random bits. There is no weak/random-counter fallback.

Measurement history belongs to the stable job ID, independently of job metadata versions. Only the current job-card view exposes the journal. Historical job-card snapshots are not backfilled with later measurements. jobRevisionId records the valid job revision returned by the existing job reader just before a write; it is not an atomic snapshot across two databases. The existing application has no job-delete operation. If parent job validation fails, a new observation/correction is refused; no placeholder job is created.

## Persistence
Database empire_code_measurements version 1 has one store revisions, keyPath revisionId, with byJobId and byMeasurementId nonunique indexes. Each observation/correction is inserted using add. There is no mutable head record, put, delete, repair or migration. The current version is derived only from a complete validated immutable chain.

A readwrite transaction reads the job ledger, checks its shape/chains, checks the expected current revision on correction, enforces growth limits and adds the row. Results resolve only on the transaction complete event. Concurrent corrections of the same version therefore produce one commit and a conflict instead of silently overwriting a measurement. Native abort after a request success cannot be reported as a committed reading. Read-only transactions likewise resolve on complete, not on partial request success.

Limits are 500 measurements per job, 50 revisions per measurement, 2000 total revision rows per job and 50000 rows globally. These are implementation bounds, not electrical limits. Exceeding a bound returns an explicit refusal; no successful truncated history is shown. A non-indexable corrupted record causes an explicit integrity error rather than silently disappearing from an apparently empty list. Complete chains validate stable measurement/job/creation identity, contiguous revision numbers and exact parents. Wall-clock order is not used to infer revision order.

Input fields are validated and copied before awaiting job lookup/open. Secure-ID collisions have at most five transactional attempts. Missing storage, quota, blocked open, malformed schema, unsupported versions and other failures retain existing records and the UI draft. Abandoned blocked opens cannot later write in the background. Versionchange closes the connection; a newer unsupported database is not reset.

The separate database leaves empire_code_jobs v1, Service Result localStorage keys and Favorites exactly as they are. A measurement save does not create a job metadata revision or alter Load Calc/Service Sizing. Local browser storage is not a backup or synchronization service. No account permissions, browser policies or network endpoints are changed.

## UI lifecycle
All new styles are scoped to #lcContent. All user content uses text nodes. Inputs are labelled, controls are at least 16 px, buttons at least 44 px, focus remains visible. The editor and list are separate, so refreshing measurements cannot discard typed fields. Generation/sequence guards ignore late list/read responses. Starting an observation draft cancels a pending older job navigation; opening another job or job editor is blocked until explicit Save/Discard. Already-started saves may finish, but stale/unmounted UI completions cannot overwrite a replacement view.

## Test and review boundary
Pure model, simulated native-store and actual-adapter tests live in test/jobMeasurement.test.js, test/jobMeasurementStore.test.js and test/loadCalcMeasurementUi.test.js. The optional database-name argument in the existing IDB simulator preserves its default behavior for old job tests. Simulator tests are not native browser evidence. Separate native Chrome profiles test actual IndexedDB, the whole generated application and unchanged old behavior; evidence belongs to the coordinator checkpoint. Existing Safari/user profiles are not used by these automated tests.

No photos, import/export, bulk migration, cloud backup, charts, speech, materials or automatic application of readings to calculations are included in this milestone.

## Primary technical references
Indexed Database API: transaction scheduling, completion and abort — https://www.w3.org/TR/IndexedDB/
HTML Standard: datetime-local has no time-zone information — https://html.spec.whatwg.org/dev/input.html
Reviewed during this task. Behavioral claims about Empire Code must be confirmed by the checkpoint's executed test logs, not inferred from these references.
