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
test/             one suite per module + guards on the shipped app
docs/CALCULATOR_AUDIT.md
```

## Status

| Calculator | Migrated to shared engine |
|---|---|
| Ampacity | **yes** |
| Wire Sizer, Conduit Fill, Box Fill, Motor, Grounding, Voltage Drop | not yet |

The engine is injected into `mobile.html` between `EC-CALC:START/END` markers by
`tools/build-calc.js`. Never hand-edit that block.

`test/build.test.js` proves the injected engine is identical to the required
sources. `test/shippedApp.test.js` records known electrical divergences as
`todo` — visible on every run, non-blocking until each is fixed.


## Service worker

`sw.js` caches `mobile.html`, `manifest.json` and the icons atomically; Google
Fonts is pre-cached separately and its failure cannot block installation.

Navigation is network-first with a 3 s deadline: a healthy connection always
delivers the newest calculator engine, a poor one falls back to cache instead
of freezing.

**Bump `CACHE_NAME` whenever a safety-critical calculator fix ships**, so every
installed PWA re-installs and picks it up.
