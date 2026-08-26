# Empire Code — calculation core

Deterministic NEC/NYCEC calculators. Pure functions: no DOM, no network, no
globals, no AI. Every function takes an object and returns a structured result.

```bash
npm run verify        # RUN THIS BEFORE EVERY DEPLOY — tests + build freshness
npm test              # calculator + shipped-app + build-integrity tests
npm run build         # inject src/calc/* into mobile.html
npm run build:check    # fail (exit 1) if mobile.html is stale
```

## Before you deploy

```bash
npm run verify
```

If it passes, commit **both** `src/calc/*` and `mobile.html`, then push.
`npm run build:check` is also enforced inside `npm test`, so a stale engine
cannot pass CI even if the separate command is skipped.

## Layout

```
src/calc/
  tables.js       AUTO-EXTRACTED NEC data — do not hand-edit
  ampacity.js     310.16, 310.15(B)(1), 110.14(C), 240.4
  conduitFill.js  Chapter 9 Tables 1/4/5, 376.22
  boxFill.js      full 314.16(A)/(B) box fill: allowances, summation,
                  fits verdict, max-conductor headroom
  voltageDrop.js  VD formula + minimum size search
  wireSizing.js   full conductor selection: ampacity, 110.14(C) terminal
                  limits, 240.4(D), continuous load, NYC feeder minimum,
                  voltage drop, governing constraint
  motor.js        Article 430
  grounding.js    250.122, 250.66, 250.122(B)
test/             one suite per module, plus guards on the shipped app,
                  the production paths, the build, the service worker and the UI
tools/build-calc.js
```

## Status

**322 tests · 0 failures · 0 todo · build:check passing.** Every identified
correctness defect (P0-1 through P0-4 and P1-1) is closed and guarded by a hard
test. No defects are parked as `todo`.

| Calculator | Production uses the shared engine |
|---|---|
| Ampacity | **fully** |
| Conduit Fill | **fully** |
| Wire Sizer | **fully** |
| Box Fill | **fully** |
| Motor, Grounding, standalone Voltage Drop | not fully migrated |

Where a calculator is not fully migrated it still computes locally. Its shared
module exists and is tested, so completing the migration is transport work
rather than new logic. Until then the same rule can exist in two places — which
is exactly how a defect once slipped into the pre-migration Wire Sizer path
after the shared module was already correct. `test/wireSizerProduction.test.js`
still executes the shipped `wsCalc()` rather than checking source text, and now
also guards (via a poisoned-engine test) against any independent selection loop
ever returning.

**Wire Sizer architecture.** Production `wsCalc` is a thin adapter: it reads and
normalizes the UI inputs, builds one structured request, calls
`EC.wireSizing.selectConductor` once, and renders the structured result. The
shared engine owns every electrical decision — conductor selection,
continuous/noncontinuous load sizing, ampacity, the 110.14(C)
terminal-temperature limitation, 240.4(D), the NYC dwelling-feeder minimum,
voltage-drop-driven upsizing, and the final governing constraint. A permanent
parity harness (`test/wireSizerParity.test.js`) pins the migration against the
legacy decisions across ~1,050 input combinations.

Two engine correctness fixes landed with the migration:

- **P1-10 — voltage drop under the preferred load model.** The
  continuous/noncontinuous input model now feeds the resolved total load into
  voltage-drop evaluation. The shipped legacy path was unaffected (it used the
  legacy load field) and remained parity-identical through the switch.
- **Terminal-limit governing explanation.** The shared result now states
  explicitly when the terminal-temperature limitation is what raised the
  required conductor size (`governingConstraint: 'TERMINAL_LIMIT'`, plus
  per-size `rejectedOnlyByTerminalLimit`), so the UI can answer *why* a
  conductor was selected without reproducing any electrical logic.

**Box Fill architecture.** Production `bfUpdateCalc()` is a thin adapter: it
reads and normalizes the existing controls, builds one structured request,
calls `EC.boxFill.calculateBoxFill` exactly once, and renders the structured
result. The shared engine owns every electrical Box Fill decision under the
supported NEC 314.16(A)/(B) scope — conductor volume allowances and
conductor-count fill, the equipment-grounding-conductor allowance, the internal
clamp allowance, the device/yoke allowance, the support-fitting allowance
(engine-supported; the production UI does not expose a support-fitting
control), volume summation, the available-vs-required comparison, the final
FITS/OVER verdict and the max-conductor headroom figure. The adapter retains no
`BF_VOL`/`BF_BOXES` table copy (the app aliases the shared tables), no EGC,
clamp or device/yoke rule, no summation and no fits comparison. Scope notes:
there is no NYC-specific Box Fill override, and this calculator is not NEC
314.28 pull/junction-box sizing.

Migration guards: `test/boxFillParity.test.js` compares the old production
decisions against the shared engine across ~3,100 input combinations;
`test/boxFillProduction.test.js` executes the shipped `bfUpdateCalc()`, proves
via a poisoned-engine result that production renders what the engine returns,
and pins exactly one `EC.boxFill.calculateBoxFill` call per calculation.

During the migration the shared Box Fill engine also gained deterministic
validation for malformed inputs (invalid or fractional counts, negative
counts, invalid or negative extension volume). These states were not normally
reachable through the existing production UI, and no shipped Box Fill decision
changed.

The engine is injected into `mobile.html` between `EC-CALC:START/END` markers by
`tools/build-calc.js`. Never hand-edit that block.

`test/build.test.js` proves the injected engine is identical to the required
sources, and `test/shippedApp.test.js` guards each closed defect against
regression.

## App structure

Home is the landing panel: PINNED shortcuts, then four groups covering eleven
tools, every one a single tap away. One fixed bottom row — Home, AI Chat, Code.
The former two-row navigation and its arrow toggle are gone; all routing goes
through `openTool()`, shared by Home tiles and PINNED.

The standalone Voltage Drop panel and Pull Box remain in the codebase but are
not reachable from Home, pending separate verification.


## Service worker

`sw.js` caches `mobile.html`, `manifest.json` and the icons atomically; Google
Fonts is pre-cached separately and its failure cannot block installation.

Navigation is network-first with a 3 s deadline: a healthy connection always
delivers the newest calculator engine, a poor one falls back to cache instead
of freezing.

**Bump `CACHE_NAME` whenever a safety-critical calculator fix ships**, so every
installed PWA re-installs and picks it up.
