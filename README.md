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
  boxFill.js      314.16
  voltageDrop.js  VD formula + minimum size search
  wireSizing.js   ampacity + 240.4(D) + continuous load + VD
  motor.js        Article 430
  grounding.js    250.122, 250.66, 250.122(B)
test/             one suite per module, plus guards on the shipped app,
                  the production paths, the build, the service worker and the UI
tools/build-calc.js
```

## Status

**265 tests · 0 failures · 0 todo · build:check passing.** Every identified
correctness defect (P0-1 through P0-4 and P1-1) is closed and guarded by a hard
test. No defects are parked as `todo`.

| Calculator | Production uses the shared engine |
|---|---|
| Ampacity | **fully** |
| Conduit Fill | **fully** |
| Wire Sizer | **partly** — `wsCalc` still owns the selection loop, terminal-limit handling and the voltage-drop path; it reuses shared helpers and rules such as 240.4(D) and the temperature correction |
| Box Fill, Motor, Grounding, standalone Voltage Drop | not fully migrated |

Where a calculator is not fully migrated it still computes locally. Its shared
module exists and is tested, so completing the migration is transport work
rather than new logic. Until then the same rule can exist in two places, which
is how a defect slipped into the Wire Sizer path after the shared module was
already correct — see `test/wireSizerProduction.test.js`, which executes the
shipped `wsCalc()` rather than checking the source text.

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
