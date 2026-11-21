# Empire Code — PRIVATE-PILOT-3

Source of the current Empire Code app: a browser app served by a Cloudflare
Worker, with the local build and tests that produce and check it.

- Stable address: <https://empirecode.app/current/> (a plain redirect page)
- Direct app address: <https://empire-code-private-pilot.szczepan-msg.workers.dev/>
- Previous app (unchanged): <https://empirecode.app/mobile.html>

The runtime source published here is the exact source of the live
PRIVATE-PILOT-3 deployment, with one difference: the private deployment config
is not published and is replaced by the template
`candidate/server/wrangler.example.json`.

## Using the app

- **Login is access control, not data sync.** The app sits behind the existing
  Cloudflare Access login and accepts only the configured owner. Logging in does
  not copy or synchronise anything. Saved jobs live in the browser on the device
  where they were created; there is no cloud sync.
- **The two apps keep separate data.** The current app and the previous app run
  on different addresses, so each has its own browser storage.
- **Jobs work offline after preparation.** Open the app online once so the
  browser can store it; Jobs then work without a connection.
- **Materials conversations need a connection.** They run online, in Polish or
  English, and use online speech recognition.
- **Backups are manual.** A job can be exported to an `.ecjob` file and restored
  from it. Conversations are exported separately.

Not completed yet:

- notes and measurements through the online conversation,
- grounded CodeChat.

## Layout

```
candidate/
  browser/     the browser app (18 files; the build refuses anything else)
  server/      the Cloudflare Worker: worker.mjs, budget.mjs (PilotBudget
               Durable Object), cloud-provider.mjs, contract.cjs,
               generated modules, wrangler.example.json
  build.cjs    local build
  build-manifest.generated.json   hash record of sources and outputs
input/         pinned inputs: online-prompt.txt, BROWSER-BASELINE.json,
               RELEASE.json, openai-provider.cjs; plus contract.cjs, which
               the comparison fixture in tests/ requires
tests/         unit tests (*.test.cjs, *.test.mjs) and their fixtures
core/          original modular calculators and Jobs source, plus the legacy
               app, tests and docs, kept as reference
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
every file against the pinned hashes (only `index.html`, `sw.js` and `ui.js` may
differ from the browser baseline), and writes the two generated Worker modules
and the build manifest. The same inputs give the same outputs.

`tests/` holds 101 unit tests. They run against fixtures and mocks: no
Cloudflare account, no provider key and no network.

By default every test reads the browser sources from `candidate/browser/`.
Four of the conversation UI tests can optionally be pointed at another copy of
that directory, to compare against an earlier baseline: set
`EC_SESSION_BASELINE_DIR` (`independent-session-errors`) or
`EC_VOICE_BASELINE_DIR` (`independent-voice-boundaries`, `-lifecycle`,
`-watchdogs`) to its path. Unset or empty, they use `candidate/browser/`. No
baseline copy is part of this directory.

Earlier native evidence — 38 Chrome and WebKit scenarios driven by synthetic
audio fixtures — was collected before this publication. It is prior evidence;
it was not rerun for this publication and is not part of this directory.

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
  `.gitignore` excludes together with `.dev.vars` and `.env` files.
- The live deployment was made with Wrangler 4.163.0. Wrangler is not a
  dependency of this package and there is no deploy script.

## `core/`

`core/` is a source snapshot of the original app: the modular calculators, the
Jobs source, the legacy app, its tests and its docs. It is here as reference
for the calculators and Jobs code that the current app builds on.

Of the old local speech pack, only `core/voice-pack/licenses/` (four license
files) is kept. The obsolete Whisper model and runtime payloads (12 files) are
excluded from the snapshot. They are unused by the current app, which uses
online speech. Because of that:

- `core/mobile.html` and `core/sw.js` still reference `voice-pack/` files that
  are not in this snapshot, so standalone offline speech does not work from
  this source;
- the `core/` tests and their assertions are unchanged, and a full
  `npm run verify` inside `core/` is not claimed to pass in this source-only
  publication.

The `npm` scripts in this directory do not run the `core/` tests.

## Development

Development continues in isolated branches and checkpoints. A change reaches
the live app only after it has been verified; the owner is not expected to act
as routine QA.
