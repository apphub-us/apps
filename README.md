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
  voltageDrop.js  shared VD formula + standalone VD/ampacity conductor
                  analysis and recommendation
  wireSizing.js   full conductor selection: ampacity, 110.14(C) terminal
                  limits, 240.4(D), continuous load, NYC feeder minimum,
                  voltage drop, governing constraint
  motor.js        Article 430 single-motor sizing: table FLC, conductors,
                  overload, branch protection, disconnect
  grounding.js    250.122 EGC, 250.122(B) proportional upsizing,
                  250.66 GEC + electrode caps
test/             one suite per module, plus guards on the shipped app,
                  the production paths, the build, the service worker and the UI
tools/build-calc.js
```

## Status

**388 tests · 0 failures · 0 todo · build:check passing.** Every identified
correctness defect (P0-1 through P0-4 and P1-1) is closed and guarded by a hard
test. No defects are parked as `todo`.

| Calculator | Production uses the shared engine |
|---|---|
| Ampacity | **fully** |
| Conduit Fill | **fully** |
| Wire Sizer | **fully** |
| Box Fill | **fully** |
| Motor | **fully** |
| Grounding | **fully** |
| standalone Voltage Drop | **fully** |

All seven calculators tracked in the calculator-engine migration now use the
shared deterministic engine as the production source of electrical decisions.
(Pull Box is a separate hidden panel outside this migration's scope — see the
note near the end of this file.)

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

**Motor architecture.** Production `mtCalc()` is a thin adapter: it reads and
normalizes the existing Motor controls, builds one structured request, calls
`EC.motor.calculateMotorCircuit` exactly once, and renders the structured
result. The shared engine owns every supported Motor electrical decision.
Supported scope (single-motor calculator only; no NYC-specific Motor override
is currently implemented): 430.6(A)(1) table-vs-nameplate current basis,
430.22 conductor sizing at 125% of table FLC, 430.32 overload calculation,
430.52 branch short-circuit / ground-fault protection with the 430.52(C)(1)
Exception 1 next-standard-size-up behavior, 430.110 disconnect sizing, and
Tables 430.248 / 430.250. Multiple-motor feeders, VFD-specific rules, motor
control circuits, disconnect horsepower ratings and feeder sizing are not
implemented. The engine — not the UI — owns the current-basis distinction:
table FLC drives conductor sizing and branch protection, the nameplate current
drives the overload figure. Production Motor no longer contains independent
FLC tables, current-basis decisions, a conductor-sizing algorithm, overload or
branch-protection multipliers, standard-OCPD selection or disconnect sizing —
the app aliases the shared tables for select population and keeps UI
parsing/rendering only.

Migration guards: `test/motorParity.test.js` compares the old production
decisions against the shared engine across the complete supported table
domain plus seeded cases; `test/motorProduction.test.js` executes the shipped
`mtCalc()`, proves via a poisoned-engine result that production renders what
the engine returns, pins exactly one `EC.motor.calculateMotorCircuit` call per
calculation, and holds a table-vs-nameplate divergence regression.

The Motor migration also added deterministic validation for malformed inputs
(invalid phase, invalid material, invalid service-factor multiplier, invalid
nameplate-current states). These were UI-unreachable hardening cases, and no
shipped Motor decision changed.

**Grounding architecture.** Production `gndCalc()` is a thin adapter: it reads
and normalizes the existing Grounding controls, builds one structured request,
calls `EC.grounding.calculateGrounding` exactly once, and renders the
structured result. The shared engine owns every supported Grounding electrical
decision. Supported scope: Table 250.122 Equipment Grounding Conductor sizing,
250.122(B) proportional EGC upsizing, Table 250.66 Grounding Electrode
Conductor sizing, and the 250.66(A)/(B)/(C) electrode caps (rod/plate,
concrete-encased, ground ring). No NYC-specific Grounding override is
currently implemented, and the UI does not implement broader Article 250
features such as bonding jumpers, separately derived systems, service bonding,
parallel-raceway EGC calculations, or transformer/generator grounding. The
engine keeps the two rule paths explicitly separate — EGC sized from the
overcurrent device under Table 250.122, GEC sized from the service conductor
under Table 250.66 — and production no longer decides between them; nothing is
a generic "ground wire size". Proportional 250.122(B) upsizing is
engine-owned end to end: the required-vs-installed phase-conductor comparison,
the circular-mil ratio, the required EGC circular-mil area, the next supported
EGC size selection, and out-of-range detection. Production Grounding no longer
contains an independent Table 250.122 or Table 250.66 copy, CM map,
proportional ratio formula, conductor-size scan, material decision logic or
final sizing logic — the app aliases the shared size list for select
population and keeps parsing/rendering only.

One shipped correctness defect was found and fixed during this migration: in a
reachable 250.122(B) case where the proportional required EGC area exceeded
the largest conductor size supported by the calculator, the old production
path could silently fall back to the base Table 250.122 EGC size while still
presenting it as the upsized result. The corrected engine returns
`finalSize: null`, `exceedsAvailableSizes: true` and the preserved
`requiredCM`, and production now reports neutrally that the required EGC area
exceeds the largest conductor size supported by the calculator.

Migration guards: `test/groundingParity.test.js` compares the old production
decisions against the shared engine across the complete supported UI domain;
`test/groundingProduction.test.js` executes the shipped `gndCalc()`, proves
via a poisoned-engine result that both result panels render what the engine
returns, pins exactly one `EC.grounding.calculateGrounding` call per
Calculate, and holds a shipped regression for the former 250.122(B)
out-of-range fallback.

The Grounding migration also added deterministic engine validation for
malformed inputs (invalid OCPD, invalid material, invalid electrode,
unsupported conductor size). Apart from the out-of-range defect described
above, these were UI-unreachable hardening cases and no shipped Grounding
decision changed.

**Standalone Voltage Drop architecture.** Production `vdUpdateCalc()` is a
thin adapter: it reads and normalizes the six existing inputs, builds one
structured request, calls `EC.voltageDrop.analyzeVoltageDrop` exactly once,
and renders the structured result and comparison rows. This calculator is a
conductor recommender with a full comparison table, not a single-conductor
voltage-drop calculator: from amps, ONE-WAY distance in feet (the shared
formula applies the phase multiplier — never re-enter total circuit length),
voltage (120/208/240/277/480), phase (single/three), material (Copper /
Aluminum) and a 2%/3%/5% target, it selects the minimum conductor satisfying
BOTH the voltage-drop target and the 75°C ampacity requirement. The shared
engine owns the material resistance constant (Cu K = 12.9, Al K = 21.2), the
conductor circular-mil lookup, the phase multiplier (2 single-phase, 1.732
three-phase), voltage-drop volts and percent, voltage at load, the target
comparison, the 75°C ampacity check, the joint recommendation and the full
21-row comparison result. Production standalone Voltage Drop no longer
contains independent VD_K or VD_CM tables, 75°C ampacity tables, phase
multiplier logic, the voltage-drop / percentage / voltage-at-load formulas,
the target comparison or the conductor recommendation scan — it formats and
renders only.

Wire Sizer and standalone Voltage Drop both consume the shared Voltage Drop
calculation infrastructure; the standalone orchestration was added without
changing Wire Sizer's established contract, and Wire Sizer's cross-regressions
and parity harness remained green. One display-compatibility note from the
migration: the single-conductor shared helper returns rounded values, while
the legacy standalone panel rounded raw numbers once for display — the helper
now also exposes backwards-compatible exact numerical fields, so the
standalone adapter performs one final display rounding and reproduces legacy
output byte for byte. This was display/architecture behavior, not an
electrical correctness defect, and Wire Sizer's rounded-field contract did not
change. No shipped electrical-math correctness defect was found during this
migration; engine validation was hardened for unsupported or malformed inputs
(invalid phase, invalid material, invalid conductor and input states), which
were UI-unreachable and changed no shipped decision.

Migration guards: `test/voltageDropParity.test.js` compares the old
production decisions against the shared engine across the complete supported
option domain plus seeded cases — roughly 52,500 comparison-row checks;
`test/voltageDropProduction.test.js` executes the shipped `vdUpdateCalc()`,
proves via a poisoned-engine result that both the result grid and the
comparison table render what the engine returns, and pins exactly one
`EC.voltageDrop.analyzeVoltageDrop` call per calculation. Explicit Wire Sizer
cross-regressions accompany the shared change.

The standalone Voltage Drop panel remains in the codebase but is not reachable
from Home; its engine path is now fully migrated and tested, and whether to
expose the panel is a separate product decision.

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
not reachable from Home. Standalone Voltage Drop's engine path is now fully
migrated and tested (see Status); exposing it is a separate product decision.
Pull Box was not part of the seven-calculator engine migration and remains
pending separate verification.


## Service worker

`sw.js` caches `mobile.html`, `manifest.json` and the icons atomically; Google
Fonts is pre-cached separately and its failure cannot block installation.

Navigation is network-first with a 3 s deadline: a healthy connection always
delivers the newest calculator engine, a poor one falls back to cache instead
of freezing.

**Bump `CACHE_NAME` whenever a safety-critical calculator fix ships**, so every
installed PWA re-installs and picks it up.
