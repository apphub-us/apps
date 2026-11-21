# Empire Code — PRIVATE-PILOT-4

Source of the current Empire Code app: a browser app served by a Cloudflare
Worker, with the local build and tests that produce and check it.

- Stable address: <https://empirecode.app/current/> (a plain redirect page)
- Direct app address: <https://empire-code-private-pilot.szczepan-msg.workers.dev/>
- Previous app (unchanged): <https://empirecode.app/mobile.html>

This directory is the source of the PRIVATE-PILOT-4 release (tag
`private-pilot-4`, branch `release/private-pilot-4`). The private deployment
config is not published and is replaced by the template
`candidate/server/wrangler.example.json`.

The deployed version and the checks actually run for this release are recorded
in `RELEASE.json`. This README does not restate them and makes no test or
deployment claim of its own for PRIVATE-PILOT-4.

## What PRIVATE-PILOT-4 changes

PRIVATE-PILOT-4 is PRIVATE-PILOT-3 plus one feature: a **Wh / Runtime** tab in
the Converter ("Na ile wystarczy bateria?"), which estimates how long a battery
of a given capacity in Wh runs a load. It works offline and stores nothing. The
formula, assumptions and limits are in
[`docs/converter-wh-runtime.md`](docs/converter-wh-runtime.md).

- The calculation lives in one module, `core/src/calc/batteryRuntime.js`.
  `core/tools/build-calc.js` injects it, with the other calculators, into
  `core/mobile.html` and into the hosted copy
  `candidate/browser/workspace/mobile.html`.
- `candidate/build.cjs` now lets `workspace/mobile.html` differ from its
  baseline pin, and in exchange refuses the build if that file loses its host
  wiring (the host stylesheet link, the `/sw.js` registration, the three
  trailing host scripts).
- The build label is `PRIVATE-PILOT-4` in the build constant, the page title,
  the header and the "Online, offline i dane" text. Both generated Worker
  modules carry the label, so both are regenerated.
- The Worker, the budget object, the provider, the online prompt and the pinned
  files in `input/` are the PRIVATE-PILOT-3 sources. `input/RELEASE.json` and
  `input/BROWSER-BASELINE.json` are historical pins and are not rewritten for a
  new release.

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
docs/          feature notes for this app (converter-wh-runtime.md)
core/          original modular calculators and Jobs source, plus the legacy
               app, tests and docs; src/calc/ is the source of the calculator
               block injected into the hosted workspace page
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
every file against the pinned hashes (only `index.html`, `sw.js`, `ui.js` and
`workspace/mobile.html` may differ from the browser baseline; the other 14
files stay byte-pinned), and writes the two generated Worker modules and the
build manifest. The same inputs give the same outputs.

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

To verify without writing anything:

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

The tests in `tests/` run against fixtures and mocks: no Cloudflare account, no
provider key and no network.

At the PRIVATE-PILOT-3 publication `tests/` held 101 unit tests. That is a
prior figure for that release. PRIVATE-PILOT-4 adds
`tests/converter-wh-runtime.test.cjs` and changes the build-label expectations
in `browser-build`, `browser-ui` and `session-errors`, so the figure no longer
describes this directory. No new count or pass result is stated here; see
`RELEASE.json`.

By default every test reads the browser sources from `candidate/browser/`.
Four of the conversation UI tests can optionally be pointed at another copy of
that directory, to compare against an earlier baseline: set
`EC_SESSION_BASELINE_DIR` (`independent-session-errors`) or
`EC_VOICE_BASELINE_DIR` (`independent-voice-boundaries`, `-lifecycle`,
`-watchdogs`) to its path. Unset or empty, they use `candidate/browser/`. No
baseline copy is part of this directory.

Earlier native evidence — 38 Chrome and WebKit scenarios driven by synthetic
audio fixtures — was collected before the PRIVATE-PILOT-3 publication. It is
prior evidence: it was not rerun for that publication, this README does not
claim it was rerun for PRIVATE-PILOT-4, and it is not part of this directory.

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
- The PRIVATE-PILOT-3 deployment was made with Wrangler 4.163.0. That is a
  prior record and is not restated here for PRIVATE-PILOT-4. Wrangler is not a
  dependency of this package and there is no deploy script.

## `core/`

`core/` is a source snapshot of the original app: the modular calculators, the
Jobs source, the legacy app, its tests and its docs. It is here as reference
for the calculators and Jobs code that the current app builds on.

Since PRIVATE-PILOT-4 it is also a build input: `core/src/calc/*` is injected
into `candidate/browser/workspace/mobile.html` by `core/tools/build-calc.js`
(see "Regenerating everything for a release"). PRIVATE-PILOT-4 changes these
`core/` files: `src/calc/batteryRuntime.js` (new), `tools/build-calc.js`,
`mobile.html`, `test/batteryRuntime.test.js` and
`test/helpers/batteryRuntimeDom.js` (new), and four existing test files
(`designSystem`, `loadCalcOracles`, `loadCalcParity`, `loadCalcServiceUi`).

Of the old local speech pack, only `core/voice-pack/licenses/` (four license
files) is kept. The obsolete Whisper model and runtime payloads (12 files) are
excluded from the snapshot. They are unused by the current app, which uses
online speech. Because of that:

- `core/mobile.html` and `core/sw.js` still reference `voice-pack/` files that
  are not in this snapshot, so standalone offline speech does not work from
  this source;
- at the PRIVATE-PILOT-3 publication the `core/` tests and their assertions
  were unchanged from the original app; PRIVATE-PILOT-4 changes only the test
  files listed above. A full `npm run verify` inside `core/` is not claimed to
  pass by this README.

The `npm` scripts in this directory do not run the `core/` tests.

## Development

Development continues in isolated branches and checkpoints. A change reaches
the live app only after it has been verified; the owner is not expected to act
as routine QA.
