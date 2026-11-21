# Load Calc — LC-UI-POLISH-1 (P1, P2, P3)

Three bounded presentation changes on top of `UI-INTEGRATION-1-R1/142 + MOBILE-HOV-1 + CSS-ORDER`.
No formula, engine, validation, state, storage format, method recommendation or code interpretation is
touched. The generated `EC-CALC` block stays byte-identical (`1da9723f…70c40`) and the bundle is not rebuilt.

## P1 — the saved Load Calculation row is a control

The row is built by the unchanged `favRender` as `.fav-item` inside `#lc-fav-list`, with `.fav-item-name`
and a separate `.fav-delete`. Nothing in the markup or in the handlers changed; only CSS scoped to this one
list was added:

- `#lcContent #lc-fav-list .fav-item, … .fav-item *` → `cursor: pointer`, so a mouse shows a pointer over the
  whole loading area, including the star and the name (neither is an editable field);
- `.fav-delete` keeps `cursor: pointer` plus its own colour and hover background, so it still reads as a
  separate action;
- `user-select: none` is applied **only** to that row. Text selection everywhere else, including every real
  input, is untouched. There is no global cursor rule and no accessibility rework.

Click behaviour is unchanged: one click loads once, and Delete still stops propagation so it never also loads.

## P2 — COMPLETE demand while the current layer is unavailable

Only this case is affected: `profileId === 'B82_core1'`, `status === 'COMPLETE'`,
`demand.status === 'complete'`, `current.status !== 'computed'` and at least one problem with
`layer === 'current'`. Profile A and every other status family are untouched.

- The `COMPLETE` banner, the demand box, all lines, numbers and the coverage list are unchanged.
- The current-layer problems are rendered in the existing **CURRENT — NOT COMPUTED** section instead of
  under `FIELDS TO SETTLE`. They keep their field label, message/code, `parser`/`legacy record` marking,
  the `(current layer)` marking and the rule reference — the same row renderer (`lcProblemRow`) builds them
  in both places, so nothing is reworded, reordered or duplicated. Each problem appears exactly once.
- `FIELDS TO SETTLE (n)` then counts only the remaining problems, and is not emitted at all when there are
  none — no empty heading and no `(0)`.
- The explanation states that the VA demand is complete and final and that amperes are a separate layer that
  is not computed from the stated conductor arrangement and load model. It does not promise 120/208 ampere
  support and does not call every cause "unsupported": the distinct causes already carried by
  `result.problems` (`MODEL_UNSUPPORTED`, `MODEL_NOT_SELECTED`, `MODEL_DECLARATION_MISSING`) keep their own
  wording.
- Back at 120/240 with a computed current, the NOT COMPUTED section disappears as before. INCOMPLETE,
  INVALID, PARTIAL, UNSUPPORTED, BLOCKED and controlled faults keep their existing messages, blocks and
  removal of stale numbers.

The split exists **only in the DOM**: `result.problems` is read, never spliced, sorted or mutated; status,
current, display, demand, snapshot and the stored payload are unchanged. No new formula, no `VA/208`, no new
model option, problem code or engine flag was added.

## P3 — NEC 220.82 rule badge instead of a "step 82" circle

`lcBuildOpt82SectionInner` now calls a new local helper `lcRuleBadgeTitle('NEC', '220.82', 'OPTIONAL METHOD
— DWELLING DATA')`, which renders a small rectangular badge (`.lc-rule-badge`) plus the existing title style.
The round `.lc-step-num` marker is no longer used for this section; `lcSectionTitle` and the numbered steps
1–5 are untouched and nothing is renumbered.

The rule number inside the badge goes through the ordinary reference pathway (`lcRich` inside the existing
`lcWith82RefTitle` scope), so it remains a real NEC 2020 `220.82` target with the 220.82 context, operable by
click and by Enter, one send per activation. `lcOpt82`, its visibility condition, all fields, help texts and
the NEC 2020 / NYCEC 2025 targets are unchanged. The badge wraps on a narrow screen and forces no width.

## Results on this candidate

| Check | Result |
|---|---|
| `node --test test/loadCalcUiPolish.test.js` | 13 pass / 0 fail / 0 skip, exit 0 |
| `node tools/loadcalc-ui-polish-check-mobile.cjs` (320/375/390/430 + desktop, B0 records and after restore) | 41 checks, 0 FAIL, exit 0 |
| `npm run verify` (full suite + Box Fill CSS order + old engine + build:check) | 1977 pass / 0 fail / 0 skip, exit 0 |
| Generated `EC-CALC` block | byte-identical to the input base |
| Files changed vs the input 142 | `mobile.html` only, plus the three new allowlisted files |

Limits: the browser evidence is Chromium viewport emulation, which is **not** native Safari or a real
iPhone; no device acceptance is claimed here. PWA/offline, production cache and publication remain out of
scope, and the MOBILE-HOV-1 fix and its CSS order are preserved unchanged.
