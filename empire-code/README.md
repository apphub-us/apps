# Empire Code — PRIVATE-PILOT-5

Source of the Empire Code PRIVATE-PILOT-5 release: a browser app served by a
Cloudflare Worker, with the local build and tests that produce and check it.

**Working build in this tree: PRIVATE-PILOT-6** (local runtime
LOCAL-WORKSPACE-6). It is PRIVATE-PILOT-5 with one visual change
(EC-UI-UNIFY-1): the shell, Rozmowa, Roboty and Przepisy use the colours,
radii, control sizes and label style of the Narzędzia tab. Calculators, stored
data, the provider path and access rules are not changed by it. This README
claims no tag, release or deployment of PRIVATE-PILOT-6; `RELEASE.json` records
what was accepted. Everything below describes the PRIVATE-PILOT-5 release that
PRIVATE-PILOT-6 is built on.

- Stable address: <https://empirecode.app/current/> (a plain redirect page)
- Direct app address: <https://empire-code-private-pilot.szczepan-msg.workers.dev/>
- Previous app (unchanged): <https://empirecode.app/mobile.html>

This directory is the source of the PRIVATE-PILOT-5 release (tag
`private-pilot-5`, branch `release/private-pilot-5`). The prior release is
PRIVATE-PILOT-4 (tag `private-pilot-4`). The private deployment config is not
published and is replaced by the template
`candidate/server/wrangler.example.json`.

**This README is a description of source, not proof of production.** Which
build is actually served at the addresses above, and which checks were actually
run for this release, is recorded in `RELEASE.json` and nowhere else. This
README does not restate those records, gives no test count or pass result, and
makes no deployment claim of its own for PRIVATE-PILOT-5. Read `RELEASE.json`
before assuming that PRIVATE-PILOT-5 is what the addresses serve.

## What PRIVATE-PILOT-5 changes

PRIVATE-PILOT-5 is PRIVATE-PILOT-4 plus audit fixes to existing tools and data
handling, a qualification route for new designs, and the first conversation
tools that reach the calculators and Jobs. The Wh / Runtime tab added in
PRIVATE-PILOT-4 stays as it was
([`docs/converter-wh-runtime.md`](docs/converter-wh-runtime.md)).

### Audit fixes

- **Grounding — ground ring.** A grounding electrode conductor size for a
  ground ring is given only for one explicit, bounded condition that the user
  confirms: the conductor is the sole connection to the ring and the ring is
  2 AWG copper. In every other case the result is reported as unresolved, not
  as a size.
- **Source panel.** The source panel is shown safely and closes normally, like
  the other panels.
- **Favorites.** Stored Favorites that cannot be read are kept intact for
  recovery instead of being silently dropped or overwritten, and the raw stored
  data can be exported. Earlier entries remain readable when they are valid;
  unreadable data is not repaired automatically. A failed write is reported
  rather than assumed to have succeeded.
- **Photo restore.** Restoring photos respects the storage capacity limit and
  reports it.
- **Conversations.** Each conversation can be archived, restored, exported and
  imported on its own. Text that was typed but not yet sent is included. A
  failed save can be retried.
- **Budgets.** The daily, history and recording budgets are visible in the app.
- **Materials.** Labels are audited and tied to their fields, and units are
  canonical: `pcs`, `box`, `pack`, `roll` and `set` take whole numbers; `ft`,
  `in` and `m` accept fractions.
- **Voltage drop.** The threshold is compared against the exact, unrounded
  value. The legacy standalone panel is limited in scope.

### Qualification of a new design

Load Calc and Service Sizing distinguish an existing installation from a new
design. For a new design whose conductor has not been chosen yet, the app gives
a **preliminary** result instead of asking for an invented ampacity. A planned
conductor can then be adopted only by an explicit step: it is recorded as a
declared plan, never as an inspected fact. A preliminary result is not saved.
Records saved by earlier releases are retained. Contract:
[`docs/stage4-qualification-contract.md`](docs/stage4-qualification-contract.md).

### Conversation tools

One shared registry of 15 calculator tools sits between the conversation and
the existing deterministic engines.

- **Deterministic answers.** The conversation only states inputs for a named
  tool. Every number, verdict and warning in an answer comes from the
  registry's deterministic engine; where a calculator form exists for the tool,
  it is the same engine that form uses. The model does no arithmetic. A missing
  required value is asked for, never assumed.
- **Forms.** Where a tool has a form, the values of the open form can be
  captured into the conversation on request, and a correction made in the
  conversation can be put back into that form when the form can hold it. The
  complex analyses Load Calc and Service Sizing take their input only from
  their form: the conversation imports it and computes on it, and cannot state
  or change that input itself. For the Load Calc form the user chooses which of
  its analyses to import. A planned conductor is never adopted from the
  conversation.
- **Jobs.** A note can be appended to the selected job and a new measurement
  can be created, each only after the user reviews and confirms the exact
  proposal. Writes go to the original Jobs stores; there is no new persistence
  database for Jobs. An interrupted write can be retried, and a receipt records
  what was written.

Contracts:
[`docs/conversation-tools-contract.md`](docs/conversation-tools-contract.md),
[`docs/conversation-form-bridge.md`](docs/conversation-form-bridge.md),
[`docs/conversation-job-actions.md`](docs/conversation-job-actions.md),
[`docs/conversation-action-recovery.md`](docs/conversation-action-recovery.md),
[`docs/assistant-api-contract.md`](docs/assistant-api-contract.md),
[`docs/assistant-client.md`](docs/assistant-client.md).

### Limits of this release

- **No grounded CodeChat.** Full source-grounded code answers are not
  implemented. Source assistance refuses a question it cannot support and does
  not invent code quotations.
- **No approval.** A result is not an installation approval and not a statement
  of complete code compliance.
- **No live-run claim.** This README does not claim that live AI responses, a
  real microphone or an iPhone were exercised for this release. What was
  checked is in `RELEASE.json`.

## Using the app

- **Login is access control, not data sync.** The app sits behind the existing
  Cloudflare Access login and accepts only the configured owner. Logging in does
  not copy or synchronise anything. Data lives in the browser on the device
  where it was created; there is no automatic sync between devices or browsers.
- **The two apps keep separate data.** The current app and the previous app run
  on different addresses, so each has its own browser storage.
- **What works offline.** Open the app online once so the browser can store it.
  The prepared tools, Jobs and the local review of saved data then work without
  a connection.
- **What needs a connection.** AI conversations and speech transcription run
  online, in Polish or English.
- **Backups are manual and separate.** A job is exported to an `.ecjob` file
  and restored from it. Conversations are exported separately, per
  conversation. Favorites are separate from both. One backup does not include
  the others.
- **Updating from PRIVATE-PILOT-4.** Conversation data saved by the earlier
  format stays readable and is migrated conservatively. The reverse is not
  supported: an older PRIVATE-PILOT-4 client that meets the newer conversation
  data refuses it rather than guessing, and there is no guaranteed automatic
  downgrade of data. Export before switching back to an older build.

## Layout

```
candidate/
  browser/     the browser app (exactly 20 files; the build refuses anything
               else)
  server/      the Cloudflare Worker: worker.mjs, budget.mjs (PilotBudget
               Durable Object), cloud-provider.mjs, contract.cjs,
               assistant-contract.cjs, assistant-provider.mjs,
               assistant-prompt.mjs, generated modules, wrangler.example.json
  build.cjs    local build
  build-manifest.generated.json   hash record of sources and outputs
input/         pinned inputs: online-prompt.txt, BROWSER-BASELINE.json,
               RELEASE.json, openai-provider.cjs; plus contract.cjs, which
               the comparison fixture in tests/ requires
tests/         unit tests (*.test.cjs, *.test.mjs) and their fixtures
docs/          feature notes and contracts for this app
core/          original modular calculators and Jobs source, plus the legacy
               app, tests and docs; src/calc/ is the source of the calculator
               block injected into the hosted workspace page
RELEASE.json          release and check record for this source
SOURCE-MANIFEST.json  hash record of the source files
```

`candidate/server/assets.generated.mjs` and `prompt.generated.mjs` are build
outputs that the Worker imports. They are committed on purpose.

## Build and tests

Requires Node.js 22 or newer. There are no dependencies to install and nothing
here touches the network.

```bash
npm run build         # verify the pinned inputs, then write the generated files
npm run build:check   # verify only, write nothing
npm test              # node --test over tests/*.test.cjs and tests/*.test.mjs
npm run verify        # npm test, then build:check
```

The build is deterministic: it reads `candidate/browser/` and `input/`, checks
the files against the pinned hashes, and writes the two generated Worker
modules and the build manifest. The same inputs give the same outputs.

The build accepts exactly 20 browser files:

- **18 original files**, the paths of the historical baseline in
  `input/BROWSER-BASELINE.json`. Five of them are protected assets and must
  stay byte-identical to that baseline. The other 13 are named individually in
  the build as originals that may differ from it.
- **2 added files**, `assistant-session.js` and `workspace/assistant-bridge.js`.
  They are not in the baseline and are tracked separately from it.

Any other file under `candidate/browser/` stops the build. The baseline of 18
in `input/` is a historical pin: it is not extended to 20 and is not rewritten
for a new release, and the same holds for `input/RELEASE.json`. The exact file
lists are in `candidate/build.cjs`, which is the authority if this text and the
build ever disagree.

### Regenerating everything for a release

`npm run build` does not regenerate the calculator block. It hashes
`candidate/browser/workspace/mobile.html` as it finds it, so the two `core`
steps come first, in this order:

```bash
cd core
node tools/build-calc.js               # inject core/src/calc/* into core/mobile.html
node tools/build-calc.js --workspace   # same block into ../candidate/browser/workspace/mobile.html
cd ..
npm run build                          # node candidate/build.cjs: generated Worker modules + build manifest
```

To verify without writing anything, check both calculator bundles and then the
root build:

```bash
cd core
node tools/build-calc.js --check && node tools/build-calc.js --workspace --check
cd ..
npm run build:check
```

`build-calc.js` replaces only the text between the two `EC-CALC` markers in
each page. Never edit that block, `candidate/server/*.generated.mjs` or
`candidate/build-manifest.generated.json` by hand.

### Tests

There are two separate test suites, and neither runs the other:

```bash
npm test               # in this directory: tests/ for the hosted app and the Worker
cd core && npm test    # in core/: the calculators, Jobs and the legacy app
```

The tests in `tests/` run against fixtures and mocks: no Cloudflare account, no
provider key and no network.

No test count or pass result is stated here for PRIVATE-PILOT-5. Figures quoted
for earlier releases do not describe this directory. The record of what was
run, and with what result, is `RELEASE.json`.

By default every test reads the browser sources from `candidate/browser/`.
Four of the conversation UI tests can optionally be pointed at another copy of
that directory, to compare against an earlier baseline: set
`EC_SESSION_BASELINE_DIR` (`independent-session-errors`) or
`EC_VOICE_BASELINE_DIR` (`independent-voice-boundaries`, `-lifecycle`,
`-watchdogs`) to its path. Unset or empty, they use `candidate/browser/`. No
baseline copy is part of this directory.

Earlier native evidence — 38 Chrome and WebKit scenarios driven by synthetic
audio fixtures — was collected before the PRIVATE-PILOT-3 publication. It is
prior evidence: this README does not claim it was rerun for PRIVATE-PILOT-5,
and it is not part of this directory.

## Backend

The backend needs Cloudflare Workers with a Durable Object, placed behind the
existing Cloudflare Access application. The app is not designed to run without
Access: the Worker takes the user's identity only from the platform, never from
a request header or cookie.

`candidate/server/wrangler.example.json` is a template of the deployment
config. The account, the owner e-mail and the origin are left out.

- `EC_ALLOWED_EMAIL` and `EC_ORIGIN` are empty in the template. While either is
  empty the Worker answers every request with 403, so an unconfigured copy
  fails closed. `EC_ORIGIN` must be the Worker's own origin, exactly.
- The provider API key exists only as a Worker secret. It is not a config
  variable, it is not in this repository, and it never reaches the browser.
- A real config belongs in a local file such as `wrangler.local.json`, which
  `.gitignore` excludes together with `.dev.vars` and `.env` files. Never
  publish a private Wrangler config or an environment file.
- The PRIVATE-PILOT-3 deployment was made with Wrangler 4.163.0. That is a
  prior record and is not restated here for PRIVATE-PILOT-5. Wrangler is not a
  dependency of this package and there is no deploy script.

## `core/`

`core/` is a source snapshot of the original app: the modular calculators, the
Jobs source, the legacy app, its tests and its docs. It is here as reference
for the calculators and Jobs code that the current app builds on.

It is also a build input: `core/src/calc/*` is injected into
`candidate/browser/workspace/mobile.html` by `core/tools/build-calc.js` (see
"Regenerating everything for a release"). PRIVATE-PILOT-5 adds to it the
conversation tool registry (`src/calc/conversationTools.js`), the conversation
to Jobs actions (`src/jobs/jobConversationActions.js`) and the preliminary
qualification route in the Load Calc and Service Sizing modules, with their
tests. The full list of changed files is the difference between the
`private-pilot-4` and `private-pilot-5` tags.

Of the old local speech pack, only `core/voice-pack/licenses/` (four license
files) is kept. The obsolete Whisper model and runtime payloads (12 files) are
excluded from the snapshot. They are unused by the current app, which uses
online speech. Because of that:

- `core/mobile.html` and `core/sw.js` still reference `voice-pack/` files that
  are not in this snapshot, so standalone offline speech does not work from
  this source;
- a full `npm run verify` inside `core/` is not claimed to pass by this README.

The `npm` scripts in this directory do not run the `core/` tests.

## Development

Development continues in isolated branches and checkpoints. A change reaches
the live app only after it has been verified; the owner is not expected to act
as routine QA.
