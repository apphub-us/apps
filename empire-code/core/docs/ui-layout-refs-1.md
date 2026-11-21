# EC-UI-LAYOUT-REFS-1 — Load Calc horizontal movement (diagnosis) and source-aware code references

Base: B2-r1.1 (119 files, `mobile.html` `989b7079…a28d`), already on the owner's Mac.
Frozen: all 14 `src/` modules, the generated calculation block, builder,
schema/fixtures/checkers, core APIs/numbers/statuses, parser and draft
semantics, `coversSnapshot`, the Favorites wrapper/store/migration format,
package/lock, service worker, viewport meta, API endpoints, `TRENDING_REMOTE_ENABLED`.
This task changed presentation and reference/navigation helpers only.

## A. Horizontal movement — what is established, what is not

**Reported (iPhone screenshot, evidence/iphone-horizontal-movement.png):** the app
header and the bottom nav are at rest and full-width; everything inside the
Load Calc panel is shifted left by ≈182 CSS px (all boxes share one right edge
at ≈194 px of 390; the ADD row, the "restored" note and the result box move
together) with empty panel background on the right. Geometrically that is
consistent with *horizontally scrolled or offset panel content*; it is **not
established** what produced it — a screenshot alone does not rule out a
retained zoom, a frame-level (iframe/shell) offset or an app-level scroll, so
the diagnostic below records all three layers (UI-r1, R-UI-03).

**Measured here (desktop Chromium over `file://`, external requests blocked like
the launcher's CSP, mobile emulation, `tools/ui-layout-refs-check-mobile.js`
section A, `proof/browser/layout-measurements.json`):** at 320/375/390/414,
844×390 and 1280×800, in EMPTY, annual COMPLETE, complete + load + term + saved
preset row, INCOMPLETE, UNSUPPORTED and restore-fault states, before/after
typing in a load label and after focus/blur: `document.scrollWidth ==
innerWidth`, `#panel-more.scrollWidth == clientWidth`, `scrollLeft 0` on the
document, the panel and `.content`, no descendant extends past the panel's
client box, `visualViewport.scale 1`, and a programmatic pan attempt of the
panel / `.content` / document stays at 0. Nothing is horizontally scrollable in
Chromium; the earlier reviewer probe (isolated DOM) agrees.

**Latent mechanisms documented, not changed:** `#panel-more` is the Load Calc
scroll container with `overflow-y: auto`, which computes `overflow-x: auto` —
any WebKit-only overflowing descendant would make the whole panel pannable
sideways, with exactly the geometry of the screenshot; `.content` is
`overflow: hidden` (an ancestor that focus-reveal / `scrollIntoView` can scroll
programmatically). No app code scrolls horizontally or calls `scrollIntoView`
on the Load Calc path.

**Not established:** which WebKit-only element (if any) overflows, whether the
offset is a retained scroll, a focus-reveal scroll of `.content`, or an
overscroll/bounce caught mid-gesture. WebKit is not installed in the executor
environment and nothing was installed. **No layout CSS was changed; the
iPhone symptom is not claimed fixed.** Per the task, the deliverable is a
targeted read-only diagnostic instead of a guessed cause.

**Follow-up (one targeted iPhone session):** run
`node tools/EC-UI-LAYOUT-1-iphone-diagnostic.cjs /absolute/path/to/mobile.html`
(the previous preview launcher is unchanged). Two explicitly identified
sources are accepted, nothing else: the Mac's CURRENT `mobile.html`
(`989b7079…a28d`, the build on which the movement was reported) and the UI-r1
FINAL `mobile.html`. On the phone: "Load Calc" → reproduce the gesture (scroll
down, type in a load label, dismiss the keyboard, pan sideways, tap a select) →
"Kopiuj raport" → send the JSON. The strip and the log record, on every
scroll / touchend / focusin / focusout / visualViewport event (inner and outer)
and every 500 ms: the OUTER (shell) visualViewport and the iframe's bounding
rect, the INNER (app) visualViewport, document / `#panel-more` / `.content`
scroll widths and **signed** offsets, every element with `scrollLeft ≠ 0` (the
mover, negative too), the elements beyond the viewport on either side, the
focused element, and a `keyboard?` marker when only the inner viewport height
shrinks at scale 1 (not movement). One polling timer exists across reloads. The
launcher never fills inputs, touches storage, moves focus or changes zoom.
The movement stays **PENDING** until that evidence exists.

## B. One source-aware reference convention

**Rule.** The colour names the *source of the target*: base NEC 2020 section →
`.nec-link` (orange, `--nec`); NYCEC 2025 amendment / NYC rule → `.nycec-link`
(blue, `--nycec`). Both underline; hover/active only brighten the same hue;
keyboard focus shows a 2 px outline in the same colour. Where both sources are
presented, two separate targets are rendered (never nested). The applied NYC
rule is identifiable as such. Colour never derives from an arbitrary substring:
explicit source context (`data-src`), the engine's `amended` metadata, the
profile's amended section (220.87), or the prefix of an app-authored citation
string ("NEC …" / "NYCEC …" / "as amended by NYCEC") decide.

**Route.** Every link goes through `necLink(ref[, opts])`, which now prepares a
question naming the exact source, edition and section
(`necRefInfo` → `necQuestion`), switches to AI Chat and sends **exactly once**
(150 ms timer with a pending guard). Legacy one-argument callers keep working —
the source is derived from the text — so a NYCEC pill never degrades to a
generic NEC question. Header badges are edition-level questions; they explain
the sources and change no computation (Profile A stays NEC 2020 + NYCEC 2025).

**Markup.** JS-built references are `<span class="nec-link|nycec-link"
role="button" tabindex="0" data-ref data-src data-ed [data-sec] title>` handled
by one delegated capture-phase click/keydown listener (Enter/Space), installed
once — rerenders never accumulate listeners and a reference click is only a
reference click even inside clickable cards. Attribute values are escaped;
user-supplied strings are never turned into links.

### Inventory of reference paths in `mobile.html`

| Path | Before | Now | Covered by |
|---|---|---|---|
| Header badges `NYCEC 2025` / `NEC 2020` | inert spans | separate keyboard/touch entry points (`data-kind="edition"`), independent edition questions, existing colours | uiReferences (markup), harness (click / Enter / Space / focus-visible / no rule change) |
| `necLink(ref)` | one generic question | source-aware question; legacy strings compatible; one send | uiReferences, harness |
| `inlineFormat` (AI messages) | orange onclick string for `NEC n.n` | one pass `NYCEC n.n` blue / `NEC n.n` orange, data-ref spans, escaped | securityRendering (updated), uiReferences, harness |
| `necify` (GFCI/AFCI notes) | orange onclick strings | one pass NYCEC/NEC/Article, data-ref spans | uiReferences, harness (GFCI detail) |
| GFCI/AFCI heading refs (`data.gfciRef`) | onclick string | `refSpanFromText` (source by prefix) | harness |
| CODE panel grounding section headings (`sec.ref`) | orange onclick string | `refSpanFromText` | harness |
| NYC topic section badges | blue inline onclick | blue `data-ref` badge (delegated) | harness |
| Outlet/device cards (`o.nec`) | orange onclick + stopPropagation | `refSpanFromText` (capture-phase delegation isolates the card click) | harness |
| Box Fill basis note | DOM spans + per-node listeners | `refSpanNode` (shared layer) | boxFillProduction (updated), boxfill harness 100 |
| Pull Box `ec-coderef` buttons (structured `codeRef` + own prepared context) | accent yellow | `data-src` colour (NEC orange / NYCEC blue); handoff unchanged — a genuine existing citation-context path, retained | pullBoxUi, harness (real renderer) |
| Static pills `.pill-nec` / `.pill-nyc` (Wire Sizer, V-Drop, Conduit, Box Fill, Pull Box, Motor, CSR grounding/NYC) | source-coloured, `onclick="necLink('…')"` | unchanged markup; `necLink` derives the source from the NYCEC/NEC prefix | uiReferences (inventory), harness (pill click) |
| Static Box Fill help spans (`.nec-link onclick="necLink('NEC …')"`) | orange | unchanged app-authored constants (NEC only) | harness inventory snapshot (constant, source-consistent) |
| Load Calc `lcRich` / `lcRefLinkInline` / `lcRefLink` | one orange action even for "NEC 220.87(2) (NYC 2025 amended)" | orange section target + separate blue NYCEC 2025 target (the parenthetical / "as amended by NYCEC 2025" phrase, or a compact `NYC 2025` badge for 220.87 references without a phrase); 230.90 / 240.4 / 220.61 NEC-only; rule-basis rows as `.lc-ref-pair` | uiReferences, loadCalcProduction/B2r1 (updated), Load Calc harness 122 |
| Wire Sizer / V-Drop text citations (`ROOFTOP_RULE.code`, `NYC_DWELLING_FEEDER_MINIMUM.code`) | plain text in notes | unchanged (text, not links) — inventoried; not rendered as visible citations in the probed views | — |
| **UI-r1** Ampacity result: title `AMPACITY — NEC 310.15`, `TEMP CORRECTION — NEC 310.15(B)(1)`, Max Breaker note `(NEC 240.4(B))` | plain text | source-aware targets (static spans / `refSpanFromText`); rule values untouched | uiReferences, harness C (genuine click), reviewer regressions |
| **UI-r1** Wireway result title `WIREWAY FILL — NEC 376.22` | plain text | `refSpanFromText` | harness C inventory |
| **UI-r1** Motor result notes (`mtRow`), Grounding-calc notes (`gndRow`) | plain text (`NEC Table 430.250 …`, `NEC Table 250.122 …`) | `necify` on the app/engine-authored note | uiReferences, harness C inventory |
| **UI-r1** GFCI NYC text (`data.nyc`, incl. the pool description), CODE grounding headings/bodies, NYC topic bodies | plain text | `necify` on app data at render time | harness C (heading target, inventory) |

**Visible-reference inventory (harness section C, 11 reachable renderers, TreeWalker over
visible text nodes):** candidate 123 had 15 unlinked app-authored citations
(Ampacity 3, Wireway 1, Motor 6, Grounding-calc 2, GFCI pool 1, CODE grounding
heading 1, NYC wiring bullet 1); UI-r1 FINAL has **0** unlinked and 40+ linked.

### Superseded assertions (old → new, behavioural regression retained)
* `securityRendering`: the NEC auto-link contract `onclick="necLink('NEC …')"` → data-ref span, no on* attribute at all; poisoning test now checks attribute values instead of handler strings.
* `loadCalcProduction` / `loadCalcB2r1`: links carry `data-ref`/`data-src` and no per-element listener; the orange link prepares the NEC 2020 section question, the blue one the NYCEC 2025 amendment question; context regexes updated.
* `navigation`: header badge regex now expects `role="button" tabindex="0" data-*` (same classes/text, no inline handler).
* `boxFillProduction`: the basis note uses `refSpanNode` instead of `addEventListener` (still no innerHTML / onclick).
* `tools/loadcalc-check-mobile.js` (1 check) and `tools/boxfill-check-mobile.js` (2 checks): prepared-question wording (`Explain NEC 2020 … Section …`, NYCEC amendment sentence).
* Test-harness exposure only: `test/helpers/loadCalcDom.js` (shared layer + delegated dispatch), `boxFillProduction`/`boxFillCatalog` harnesses (shared layer).

## C. Physical follow-up plan (short)
1. Layout: one diagnostic session with the read-only launcher (above); send the report.
2. References: on the phone, check the orange/blue colours in Load Calc, tap the header badges and one orange + one blue Load Calc target (AI Chat opens with the source-specific question; no calculation changes).
3. Smoke: annual example → COMPLETE 50,000 VA / ADEQUATE; blank months → INCOMPLETE; restore → result back; Save → reload → restore.

## D. UI-r1 — bounded closure of the independent review (R-UI-01 … R-UI-03)

* **R-UI-01 — compound citations.** `refSpanFromText` wrote `data-sec` from the
  first section only, and the delegate passed it as an explicit `section`, so
  "NEC 210.8(A)(5) / 210.8(A)(7)", "NEC 680.22(A) / 680.74" and "NEC 250.4(A)
  and 250.4(B)" prepared a question about the first section alone. Now a
  compound head carries no single `data-sec` (its title shows the whole head);
  the delegate re-derives the full head from `data-ref`, so the prepared
  question keeps every displayed section (same visible element, one click, one
  send). Single-section references keep their `data-sec`. `refSpanNode` applies
  the same rule. Plain legacy `necLink` callers were never affected.
* **R-UI-02 — explicit forms and visible citations.** One shared one-pass
  linkifier (`refLinkifyHtml`, used by `necify` and `inlineFormat`) recognises
  `NEC 2020 n.n`, `NYCEC 2025 n.n`, `NEC n.n as amended by NYCEC 2025` and
  `NEC n.n (NYC 2025 amended)` — the amendment phrase becomes a separate blue
  target on the same section; `NEC Table n.n` and `Article n` are orange; other
  edition years stay plain text; a bare NEC number never gets a NYC target; a
  sentence-ending period stays outside the section. The visible app-authored
  citations listed in the inventory table (Ampacity note included) are targets
  now; numeric rules are untouched; user-supplied Load Calc text still never
  reaches the linkifier.
* **R-UI-03 — diagnostic readiness.** The controller records the outer (shell)
  visualViewport and the iframe rect beside the inner viewport, treats any
  `scrollLeft ≠ 0` (negative included) as movement, classifies movement as
  zoom-app / zoom-shell / frame / scroll / overflow, reports a height-only inner
  viewport change at scale 1 as `keyboard?` (not movement), keeps exactly one
  polling timer across reloads and re-arms listeners per document; it accepts
  the two identified sources only. Proven in `test/uiDiagnosticController.test.js`
  (synthetic VM viewports — not iOS). The native movement remains PENDING.
