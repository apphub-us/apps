# Empire Code — UI focus policy (EC-UI-FOCUS-1)

**Scope:** the main mobile app (`mobile.html`). **Status:** implemented; physical-iPhone retest PENDING. The separate Wire Map repositories/exports are out of scope.

## 1. Policy (field-only)

Every **live editable field** — a `<select>`, a numeric / text / password `<input>`, or the AI Chat `<textarea>` — computes to **at least 16 CSS px** at normal page scale, unfocused, focused and blurred, in portrait, phone landscape and on desktop. Reason: iOS Safari zooms into a focused control whose text is smaller than 16 px (WebKit `_zoomToFocusRect`, scale ≈ 16 / focused font-size), and that enlargement can persist after the keyboard closes. The 16 px direction removes that trigger; it is not a guarantee for every iOS version, embedding or accessibility setting, so the native behaviour is confirmed only on the phone.

The policy is **not** whole-app text scaling. Labels (9 px), pills / rule text / result titles (11 px), table text (10 px), More sub-tabs (11 px), buttons (send 20 px, reset 12 px), headings, message bubbles, diagram annotations and shared typography tokens are unchanged. Controls already at or above 16 px are never shrunk.

## 2. What changed (CSS only — every production `<script>` block is byte-identical)

| rule | before | after | covers |
|---|---:|---:|---|
| `select, input[type=number]` (shared) | 14 px | 16 px | 71 live selects / number inputs across Ampacity, Conduit Fill, V-Drop, Wire Sizer, Load Calc (incl. dynamic pickers), Wireway, Motor, Grounding, Outlets, Bender, Converter |
| `textarea` | 15 px | 16 px | AI Chat composer `#userInput` |
| `.modal input` | 13 px | 16 px | API-key entry `#apiKeyInput` (password) |
| `.p3d-sel` (override added after the 13 px shorthand) | 13 px | 16 px | Pull Box v2 3D prototype selectors (dev host + `pbv2=3d` only) |
| `#panel-boxfill .controls select, … input[type=number]` | 16 px | 16 px | Box Fill — accepted earlier, untouched |

Narrow container corrections directly caused by the larger field text (no layout redesign):
- `#panel-vdrop .controls .ctrl, #panel-wiresizer .controls .ctrl { max-width:100%; min-width:0 }` and `… select { max-width:100% }` — the long max-drop / 100 %-rated option labels otherwise push those selects past a 375–414 px viewport (the native picker still shows the full text). This is the accepted Box Fill pattern.
- `#panel-more input[id^="lcPick_"][id$="_va"] { padding-left:8px; padding-right:8px }` — the Load Calc preset VA inputs sit in a fixed 85 px flex cell; at 16 px a 4-digit value needs ~78 px of text room, so only their inner padding is trimmed. Cell, neighbours and semantics unchanged.

Nothing else: no viewport meta change, no `user-scalable` / `maximum-scale`, no `text-size-adjust`, no CSS `zoom` / `transform` trick, no forced blur, no `scrollTo`-on-blur, no VisualViewport reset, no `overflow:hidden`, no `!important`, no token or JavaScript edit.

## 3. Exception ledger (sub-16 px field rules that remain, and why)

| rule / source | size | classification | decision |
|---|---:|---|---|
| `.ec-select, .ec-control select, .ec-control input` (EC-UI-2 primitive, `var(--ec-font-lg)`) | 13 px | **no live element** — nothing in the static markup or in any generated markup string carries `ec-control` / `ec-select`; Pull Box v2 modals use buttons | left unchanged; the shared token is display typography and must not move; `test/uiFocus.test.js` fails if a future element adopts it below 16 px |
| `pbSizeSelect()` inline `font-size:12px` (legacy Pull Box v1) | 12 px | **legacy unreachable** — rendered only into `#pbLeftRaceways` / `#pbRightRaceways` inside `#sub-pullbox`, which is `display:none` and shown by no navigation function (`switchTabMore` list and `openTool` never reference it; verified in Chromium across every route) | left as-is (an inline size cannot be overridden without `!important`; not needed) |
| `.p3d-sel` 13 px shorthand | 13 px → 16 px | **reachable dynamic, gated** — the 3D prototype opens only when `pbv23dShouldOpen(location)` is true: dev host (localhost / 10.x / 172.16–31.x / 192.168.x — the LAN preview qualifies) **and** `pbv2=3d` in the URL | overridden to 16 px by a following `.p3d-sel { font-size:16px }` rule; measured with the sheet forced open (diagnostic) |

## 4. Field inventory (Chromium 390×844, every route; before = UI-FOCUS-PRE-TASK, after = this patch)

Classification: *reachable static* = present in the markup and shown by a route; *reachable dynamic* = rendered by script when its route opens; the API-key field is opened through the real send-without-key route. Legacy-unreachable controls (§3) are not listed because they are never displayed. Before this patch 74 of the 82 reachable fields were below 16 px; after it none are.

| control | kind | reached via | sizing rule | before px | after px | class |
|---|---|---|---|---:|---:|---|
| `ampBundle` | select[select-one] | ampacity | select, input[type=number] | 14 | 16 | reachable static |
| `ampInsul` | select[select-one] | ampacity | select, input[type=number] | 14 | 16 | reachable static |
| `ampMaterial` | select[select-one] | ampacity | select, input[type=number] | 14 | 16 | reachable static |
| `ampRoof` | select[select-one] | ampacity | select, input[type=number] | 14 | 16 | reachable static |
| `ampTemp` | select[select-one] | ampacity | select, input[type=number] | 14 | 16 | reachable static |
| `ampWireSize` | select[select-one] | ampacity | select, input[type=number] | 14 | 16 | reachable static |
| `apiKeyInput` | input[password] | apiModal shown (display:flex) | .modal input | 13 | 16 | reachable static — modal opened by the real send-without-key route |
| `bd-size` | select[select-one] | bender, more/bender | select, input[type=number] | 14 | 16 | reachable static |
| `bd-stub` | input[number] | bender, more/bender | select, input[type=number] | 14 | 16 | reachable static |
| `bfAccessory` | select[select-one] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `bfBoxType` | select[select-one] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `bfClamps` | select[select-one] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `bfConductors` | input[number] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `bfDevices` | input[number] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `bfEgcCount` | input[number] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `bfEgcSize` | select[select-one] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `bfWireSize` | select[select-one] | boxfill | #panel-boxfill .controls (16px, EC-CALC-1B) | 16 | 16 | reachable static |
| `cfConduitSize` | select[select-one] | conduit | select, input[type=number] | 14 | 16 | reachable static |
| `cfConduitType` | select[select-one] | conduit | select, input[type=number] | 14 | 16 | reachable static |
| `cfNumWires` | select[select-one] | conduit | select, input[type=number] | 14 | 16 | reachable static |
| `cfWireSize` | select[select-one] | conduit | select, input[type=number] | 14 | 16 | reachable static |
| `cfWireType` | select[select-one] | conduit | select, input[type=number] | 14 | 16 | reachable static |
| `cv-amps` | input[number] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-hp` | input[number] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-kva` | input[number] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-kw` | input[number] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-pf` | select[select-one] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-phase` | select[select-one] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-va` | input[number] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-voltage` | select[select-one] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `cv-watts` | input[number] | converter, more/converter | select, input[type=number] | 14 | 16 | reachable static |
| `gfciBuildingType` | select[select-one] | more/coderef/gfci | select, input[type=number] | 14 | 16 | reachable static |
| `gnd-egc-mat` | select[select-one] | grounding, more/coderef | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `gnd-electrode` | select[select-one] | grounding, more/coderef | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `gnd-inst` | select[select-one] | grounding, more/coderef | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `gnd-ocpd` | select[select-one] | grounding, more/coderef | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `gnd-req` | select[select-one] | grounding, more/coderef | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `gnd-svc` | select[select-one] | grounding, more/coderef | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `gnd-svc-mat` | select[select-one] | grounding, more/coderef | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcMethod` | select[select-one] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcPick_appliance_name` | select[select-one] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcPick_appliance_va` | input[number] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcPick_ev_name` | select[select-one] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcPick_ev_va` | input[number] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcPick_hvac_name` | select[select-one] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcPick_hvac_va` | input[number] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcScope` | select[select-one] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcSqFt` | input[number] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `lcVoltage` | select[select-one] | loadcalc, more/loadcalc | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `mt-hp` | select[select-one] | motor, more/motor | select, input[type=number] | 14 | 16 | reachable static |
| `mt-nameplate` | input[number] | motor, more/motor | select, input[type=number] | 14 | 16 | reachable static |
| `mt-ocpd` | select[select-one] | motor, more/motor | select, input[type=number] | 14 | 16 | reachable static |
| `mt-phase` | select[select-one] | motor, more/motor | select, input[type=number] | 14 | 16 | reachable static |
| `mt-sf` | select[select-one] | motor, more/motor | select, input[type=number] | 14 | 16 | reachable static |
| `mt-type` | select[select-one] | motor, more/motor | select, input[type=number] | 14 | 16 | reachable static |
| `mt-volts` | select[select-one] | motor, more/motor | select, input[type=number] | 14 | 16 | reachable static |
| `outletFilter` | select[select-one] | outlets, more/outlets | select, input[type=number] | 14 | 16 | reachable static |
| `pbv2-3d-fast-size` | select[select-one] | pullbox, pullbox (v2 panel) (+1) | .p3d-sel (13px shorthand -> 16px override) | 13 | 16 | reachable dynamic — dev-host + pbv2=3d prototype only (forced for measurement) |
| `userInput` | textarea | chat | textarea | 15 | 16 | reachable static |
| `vdAmps` | input[number] | vdrop | select, input[type=number] | 14 | 16 | reachable static |
| `vdFeet` | input[number] | vdrop | select, input[type=number] | 14 | 16 | reachable static |
| `vdMaterial` | select[select-one] | vdrop | select, input[type=number] | 14 | 16 | reachable static |
| `vdMaxPct` | select[select-one] | vdrop | select, input[type=number] | 14 | 16 | reachable static |
| `vdPhase` | select[select-one] | vdrop | select, input[type=number] | 14 | 16 | reachable static |
| `vdVoltage` | select[select-one] | vdrop | select, input[type=number] | 14 | 16 | reachable static |
| `wsBundle` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsCircuitType` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsContinuous` | input[number] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsFeet` | input[number] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsHundredPct` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsInsul` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsLoad` | input[number] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsMaterial` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsMaxVD` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsPhase` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsTemp` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wsVoltage` | select[select-one] | wiresizer | select, input[type=number] | 14 | 16 | reachable static |
| `wwHeight` | select[select-one] | wireway | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `wwNumWires` | select[select-one] | wireway | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `wwWidth` | select[select-one] | wireway | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `wwWireSize` | select[select-one] | wireway | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |
| `wwWireType` | select[select-one] | wireway | select, input[type=number] | 14 | 16 | reachable dynamic (rendered by script on route) |

## 5. Pre-existing layout findings (unrelated to fields; reported, not changed)

- **Load Calc (More) sub-tab strip**: the More panel's `scrollWidth` is 413 px at 375 / 390 px (a DIV/BUTTON row, not a field) before and after this patch; the document itself never scrolls horizontally. Not touched.
- **Load Calc preset picker rows** (`lcAddPicker`): at phone widths the row is ~206 px wide, so the preset `<select>` collapses to ~26 px (before and after). Only the policy-caused 5 px value clip in the VA input was corrected (§2). A usable layout for these rows is a separate task.
- V-Drop `#vdMaxPct` (457 px) and Wire Sizer `#wsMaxVD` (457 px) / `#wsHundredPct` (389 px at 375) already overflowed the phone viewport before this patch; the font policy would have widened them to 513 / 436 px, so the container cap in §2 was required and, as a side effect, also cures the pre-existing overflow.

## 6. Physical-iPhone retest plan (PENDING — nothing here is a native result)

1. **AI Chat → keyboard → dismiss → HOME** (the reported reproduction): from normal scale open AI Chat, tap the composer, type a line, dismiss the keyboard, tap HOME — the page must not stay enlarged and HOME must not pan horizontally.
2. AI Chat composer: type three lines with return (composer grows), a long draft (internal scroll), send button reachable; Shift/Enter behaviour unchanged.
3. API-key modal: trigger by sending without a key; tap the password field — no zoom; cancel without saving.
4. Representative fields: V-Drop amps / feet / max-drop picker; Wire Sizer load / 100 %-rated / max-VD pickers; Ampacity wire size; Load Calc preset VA input; Motor nameplate; Converter volts; Grounding OCPD picker — no zoom on focus, values readable, pickers show full text.
5. Box Fill regression: EGC count, Custom extra volume, Box Type / ring pickers — still no zoom (accepted earlier).
6. Landscape: rotate on AI Chat and V-Drop; confirm no residual enlargement after keyboard dismiss.
7. Pinch zoom in the preview shell still works (nothing new locks it); the product viewport meta's `user-scalable=no` remains separate accessibility debt.
