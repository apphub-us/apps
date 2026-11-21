# Empire Code — Box Fill field catalog ledger (EC-CALC-1B)

Milestone: **EC-CALC-1B — Box Fill Field Catalog & Help** · Status: implemented, pending independent review and the physical-iPhone gate
Canonical data: `src/calc/tables.js` → `BF_BOXES` (10 added keys), `BF_ACCESSORIES` (36 verified records), `BF_ACCESSORY_UNRESOLVED` (RACO 821), `BF_CATALOG_SOURCES`.
Locked input: `EC-CALC-1B-catalog-seed.json` (schemaVersion 1, checked 2026-09-06, manufacturer scope RACO). The seed was independently checked before this milestone; this ledger records exactly what was transcribed and how it is used. **No value was inferred, rounded, broadened or replaced.**

## 1. What the catalog does — and does not — do

- The Box Fill engine `src/calc/boxFill.js` is **byte-identical** to EC-CALC-1. The UI only resolves ONE numeric `extensionVolume`: `0` for *None*, the literal `addedVolumeIn3` of a verified catalog record, or the user's own decimal for *Other / Custom*. No second formula, no dimension arithmetic, no height→volume guess.
- Only `status: 'verified'` records are offered or resolved. The RACO 821 record is stored as data (`BF_ACCESSORY_UNRESOLVED`, `addedVolumeIn3: null`, status `blocked_source_conflict`) so the UI can explain the conflict; it can never auto-add 10.0 or 10.3.
- Compatibility is exact: a record with a non-empty `compatibleBoxKeys` is offered ONLY for those keys (multigang covers — no next-smaller-box inference even where the manufacturer says a larger cover may fit); otherwise `compatibleFamily` must equal `BF_BOXES[key].family` (`metal_square_4`, `metal_square_4_11_16`, `metal_octagon_4`). Device, handy and plastic boxes carry no family and get None / Custom only.
- Runtime is offline: the source URLs below are provenance only and are never fetched by the app.

## 2. Base boxes added to `BF_BOXES` (kind `listed_product`, family `raco_multigang`)

All 27 accepted EC-CALC-1 keys are unchanged in `vol`, `label`, `kind`, `group` and `source` (proved by `test/boxFillCatalog.test.js`, `test/boxFillContract.test.js` and the PRE-TASK → FINAL export comparison in the implementation report). The eight square/octagon rows gained only a `family` field.

| key | seed id | RACO | gangs | depth | volume in³ | seed label (verbatim) | UI label | source |
|---|---|---|---:|---|---:|---|---|---|
| `raco_951` | raco_951 | 951 | 2 | 1-5/8" (1.625) | **47.0** | RACO 951 — 2-Gang · 1.625" deep · 47 in³ | 2-Gang · 1-5/8" deep · RACO 951 (47.0 in³) | RACO_MULTIGANG |
| `raco_952` | raco_952 | 952 | 3 | 1-5/8" (1.625) | **60.0** | RACO 952 — 3-Gang · 1.625" deep · 60 in³ | 3-Gang · 1-5/8" deep · RACO 952 (60.0 in³) | RACO_MULTIGANG |
| `raco_953` | raco_953 | 953 | 4 | 1-5/8" (1.625) | **72.8** | RACO 953 — 4-Gang · 1.625" deep · 72.8 in³ | 4-Gang · 1-5/8" deep · RACO 953 (72.8 in³) | RACO_MULTIGANG |
| `raco_954` | raco_954 | 954 | 5 | 1-5/8" (1.625) | **85.8** | RACO 954 — 5-Gang · 1.625" deep · 85.8 in³ | 5-Gang · 1-5/8" deep · RACO 954 (85.8 in³) | RACO_MULTIGANG |
| `raco_955` | raco_955 | 955 | 6 | 1-5/8" (1.625) | **98.5** | RACO 955 — 6-Gang · 1.625" deep · 98.5 in³ | 6-Gang · 1-5/8" deep · RACO 955 (98.5 in³) | RACO_MULTIGANG |
| `raco_941` | raco_941 | 941 | 2 | 2-1/2" (2.5) | **70.0** | RACO 941 — 2-Gang · 2.5" deep · 70 in³ | 2-Gang · 2-1/2" deep · RACO 941 (70.0 in³) | RACO_MULTIGANG |
| `raco_942` | raco_942 | 942 | 3 | 2-1/2" (2.5) | **90.0** | RACO 942 — 3-Gang · 2.5" deep · 90 in³ | 3-Gang · 2-1/2" deep · RACO 942 (90.0 in³) | RACO_MULTIGANG |
| `raco_943` | raco_943 | 943 | 4 | 2-1/2" (2.5) | **110.0** | RACO 943 — 4-Gang · 2.5" deep · 110 in³ | 4-Gang · 2-1/2" deep · RACO 943 (110.0 in³) | RACO_MULTIGANG |
| `raco_944` | raco_944 | 944 | 5 | 2-1/2" (2.5) | **130.0** | RACO 944 — 5-Gang · 2.5" deep · 130 in³ | 5-Gang · 2-1/2" deep · RACO 944 (130.0 in³) | RACO_MULTIGANG |
| `raco_945` | raco_945 | 945 | 6 | 2-1/2" (2.5) | **150.0** | RACO 945 — 6-Gang · 2.5" deep · 150 in³ | 6-Gang · 2-1/2" deep · RACO 945 (150.0 in³) | RACO_MULTIGANG |

Box Type groups: `RACO Multigang · 1-5/8" deep` (951–955) then `RACO Multigang · 2-1/2" deep` (941–945), sorted by depth then gang count, after the accepted choices. They are listed in their own reference table (`#bfListedTable`), never inside the NEC Table 314.16(A) table.

## 3. Verified accessories — `BF_ACCESSORIES` (36 records, seed order)

Field mapping from the seed is one-to-one for `id, manufacturer, catalogNumbers, type, compatibleFamily, compatibleBoxKeys, openingGangs, raisedHeightIn, addedVolumeIn3, source, status`. The only difference is `label`: the seed labels carry decimal heights (`0.5"`); the product/UX spec requires field-recognisable fractions (`1/2"`) and one-decimal volumes, so the table stores the display label in that form. Both are shown below.

| id | RACO | type | compatibility | openings | raised / depth | **+in³** | seed label (verbatim) | UI label (table) | source |
|---|---|---|---|---:|---|---:|---|---|---|
| `raco_4sq_1g_025` | 771/8771 | mud_ring | family: metal_square_4 | 1 | 1/4" (0.25) | **1.5** | 1-device · 0.25" raised · +1.5 in³ · RACO 771/8771 | 1-device · 1/4" raised · +1.5 in³ · RACO 771/8771 | RACO_4IN_SINGLE |
| `raco_4sq_1g_050` | 772/8772 | mud_ring | family: metal_square_4 | 1 | 1/2" (0.5) | **3.5** | 1-device · 0.5" raised · +3.5 in³ · RACO 772/8772 | 1-device · 1/2" raised · +3.5 in³ · RACO 772/8772 | RACO_4IN_SINGLE |
| `raco_4sq_1g_0625` | 768/8768 | mud_ring | family: metal_square_4 | 1 | 5/8" (0.625) | **4.5** | 1-device · 0.625" raised · +4.5 in³ · RACO 768/8768 | 1-device · 5/8" raised · +4.5 in³ · RACO 768/8768 | RACO_4IN_SINGLE |
| `raco_4sq_1g_075` | 773/8773 | mud_ring | family: metal_square_4 | 1 | 3/4" (0.75) | **5.5** | 1-device · 0.75" raised · +5.5 in³ · RACO 773/8773 | 1-device · 3/4" raised · +5.5 in³ · RACO 773/8773 | RACO_4IN_SINGLE |
| `raco_4sq_1g_100` | 774 | mud_ring | family: metal_square_4 | 1 | 1" (1) | **7.5** | 1-device · 1" raised · +7.5 in³ · RACO 774 | 1-device · 1" raised · +7.5 in³ · RACO 774 | RACO_4IN_SINGLE |
| `raco_4sq_1g_125` | 775/8775 | mud_ring | family: metal_square_4 | 1 | 1-1/4" (1.25) | **9.5** | 1-device · 1.25" raised · +9.5 in³ · RACO 775/8775 | 1-device · 1-1/4" raised · +9.5 in³ · RACO 775/8775 | RACO_4IN_SINGLE |
| `raco_4sq_1g_150` | 785 | mud_ring | family: metal_square_4 | 1 | 1-1/2" (1.5) | **11.3** | 1-device · 1.5" raised · +11.3 in³ · RACO 785 | 1-device · 1-1/2" raised · +11.3 in³ · RACO 785 | RACO_4IN_SINGLE |
| `raco_4sq_1g_200` | 786 | mud_ring | family: metal_square_4 | 1 | 2" (2) | **14.5** | 1-device · 2" raised · +14.5 in³ · RACO 786 | 1-device · 2" raised · +14.5 in³ · RACO 786 | RACO_4IN_SINGLE |
| `raco_4sq_2g_025` | 777/8777-0 | mud_ring | family: metal_square_4 | 2 | 1/4" (0.25) | **3.0** | 2-device · 0.25" raised · +3 in³ · RACO 777/8777-0 | 2-device · 1/4" raised · +3.0 in³ · RACO 777/8777-0 | RACO_4IN_TWO |
| `raco_4sq_2g_050` | 778/8778 | mud_ring | family: metal_square_4 | 2 | 1/2" (0.5) | **5.5** | 2-device · 0.5" raised · +5.5 in³ · RACO 778/8778 | 2-device · 1/2" raised · +5.5 in³ · RACO 778/8778 | RACO_4IN_TWO |
| `raco_4sq_2g_0625` | 769/8769 | mud_ring | family: metal_square_4 | 2 | 5/8" (0.625) | **7.3** | 2-device · 0.625" raised · +7.3 in³ · RACO 769/8769 | 2-device · 5/8" raised · +7.3 in³ · RACO 769/8769 | RACO_4IN_TWO |
| `raco_4sq_2g_075` | 779/8779 | mud_ring | family: metal_square_4 | 2 | 3/4" (0.75) | **8.8** | 2-device · 0.75" raised · +8.8 in³ · RACO 779/8779 | 2-device · 3/4" raised · +8.8 in³ · RACO 779/8779 | RACO_4IN_TWO |
| `raco_4sq_2g_100` | 780 | mud_ring | family: metal_square_4 | 2 | 1" (1) | **12.0** | 2-device · 1" raised · +12 in³ · RACO 780 | 2-device · 1" raised · +12.0 in³ · RACO 780 | RACO_4IN_TWO |
| `raco_4sq_2g_125` | 781/8781 | mud_ring | family: metal_square_4 | 2 | 1-1/4" (1.25) | **15.0** | 2-device · 1.25" raised · +15 in³ · RACO 781/8781 | 2-device · 1-1/4" raised · +15.0 in³ · RACO 781/8781 | RACO_4IN_TWO |
| `raco_4sq_2g_150` | 795 | mud_ring | family: metal_square_4 | 2 | 1-1/2" (1.5) | **15.5** | 2-device · 1.5" raised · +15.5 in³ · RACO 795 | 2-device · 1-1/2" raised · +15.5 in³ · RACO 795 | RACO_4IN_TWO |
| `raco_4sq_2g_200` | 796 | mud_ring | family: metal_square_4 | 2 | 2" (2) | **20.5** | 2-device · 2" raised · +20.5 in³ · RACO 796 | 2-device · 2" raised · +20.5 in³ · RACO 796 | RACO_4IN_TWO |
| `raco_41116_1g_050` | 837/8837 | mud_ring | family: metal_square_4_11_16 | 1 | 1/2" (0.5) | **3.5** | 1-device · 0.5" raised · +3.5 in³ · RACO 837/8837 | 1-device · 1/2" raised · +3.5 in³ · RACO 837/8837 | RACO_41116 |
| `raco_41116_1g_0625` | 843 | mud_ring | family: metal_square_4_11_16 | 1 | 5/8" (0.625) | **4.5** | 1-device · 0.625" raised · +4.5 in³ · RACO 843 | 1-device · 5/8" raised · +4.5 in³ · RACO 843 | RACO_41116 |
| `raco_41116_1g_075` | 838 | mud_ring | family: metal_square_4_11_16 | 1 | 3/4" (0.75) | **5.5** | 1-device · 0.75" raised · +5.5 in³ · RACO 838 | 1-device · 3/4" raised · +5.5 in³ · RACO 838 | RACO_41116 |
| `raco_41116_1g_100` | 839 | mud_ring | family: metal_square_4_11_16 | 1 | 1" (1) | **7.5** | 1-device · 1" raised · +7.5 in³ · RACO 839 | 1-device · 1" raised · +7.5 in³ · RACO 839 | RACO_41116 |
| `raco_41116_1g_125` | 842 | mud_ring | family: metal_square_4_11_16 | 1 | 1-1/4" (1.25) | **9.5** | 1-device · 1.25" raised · +9.5 in³ · RACO 842 | 1-device · 1-1/4" raised · +9.5 in³ · RACO 842 | RACO_41116 |
| `raco_41116_1g_150` | 898 | mud_ring | family: metal_square_4_11_16 | 1 | 1-1/2" (1.5) | **11.0** | 1-device · 1.5" raised · +11 in³ · RACO 898 | 1-device · 1-1/2" raised · +11.0 in³ · RACO 898 | RACO_41116 |
| `raco_41116_1g_200` | 899 | mud_ring | family: metal_square_4_11_16 | 1 | 2" (2) | **16.0** | 1-device · 2" raised · +16 in³ · RACO 899 | 1-device · 2" raised · +16.0 in³ · RACO 899 | RACO_41116 |
| `raco_41116_2g_050` | 841 | mud_ring | family: metal_square_4_11_16 | 2 | 1/2" (0.5) | **5.5** | 2-device · 0.5" raised · +5.5 in³ · RACO 841 | 2-device · 1/2" raised · +5.5 in³ · RACO 841 | RACO_41116 |
| `raco_41116_2g_0625` | 818 | mud_ring | family: metal_square_4_11_16 | 2 | 5/8" (0.625) | **7.3** | 2-device · 0.625" raised · +7.3 in³ · RACO 818 | 2-device · 5/8" raised · +7.3 in³ · RACO 818 | RACO_41116 |
| `raco_41116_2g_075` | 840 | mud_ring | family: metal_square_4_11_16 | 2 | 3/4" (0.75) | **8.8** | 2-device · 0.75" raised · +8.8 in³ · RACO 840 | 2-device · 3/4" raised · +8.8 in³ · RACO 840 | RACO_41116 |
| `raco_41116_2g_100` | 819 | mud_ring | family: metal_square_4_11_16 | 2 | 1" (1) | **12.0** | 2-device · 1" raised · +12 in³ · RACO 819 | 2-device · 1" raised · +12.0 in³ · RACO 819 | RACO_41116 |
| `raco_41116_2g_125` | 820 | mud_ring | family: metal_square_4_11_16 | 2 | 1-1/4" (1.25) | **15.0** | 2-device · 1.25" raised · +15 in³ · RACO 820 | 2-device · 1-1/4" raised · +15.0 in³ · RACO 820 | RACO_41116 |
| `raco_41116_2g_150` | 885 | mud_ring | family: metal_square_4_11_16 | 2 | 1-1/2" (1.5) | **15.5** | 2-device · 1.5" raised · +15.5 in³ · RACO 885 | 2-device · 1-1/2" raised · +15.5 in³ · RACO 885 | RACO_41116 |
| `raco_mg_822_075` | 822 | raised_cover | keys: raco_952, raco_942 | 3 | 3/4" (0.75) | **15.3** | 3-Gang cover · 3/4" raised · +15.3 in³ · RACO 822 | 3-Gang cover · 3/4" raised · +15.3 in³ · RACO 822 | RACO_MULTIGANG |
| `raco_mg_823_075` | 823 | raised_cover | keys: raco_953, raco_943 | 4 | 3/4" (0.75) | **20.3** | 4-Gang cover · 3/4" raised · +20.3 in³ · RACO 823 | 4-Gang cover · 3/4" raised · +20.3 in³ · RACO 823 | RACO_MULTIGANG |
| `raco_mg_824_075` | 824 | raised_cover | keys: raco_954, raco_944 | 5 | 3/4" (0.75) | **25.5** | 5-Gang cover · 3/4" raised · +25.5 in³ · RACO 824 | 5-Gang cover · 3/4" raised · +25.5 in³ · RACO 824 | RACO_MULTIGANG |
| `raco_mg_825_075` | 825 | raised_cover | keys: raco_955, raco_945 | 6 | 3/4" (0.75) | **30.5** | 6-Gang cover · 3/4" raised · +30.5 in³ · RACO 825 | 6-Gang cover · 3/4" raised · +30.5 in³ · RACO 825 | RACO_MULTIGANG |
| `raco_4sq_ext_201_150` | 201 | extension_ring | family: metal_square_4 | — | 1-1/2" (1.5) | **22.5** | Extension ring · 1-1/2" deep · +22.5 in³ · RACO 201 | Extension ring · 1-1/2" deep · +22.5 in³ · RACO 201 | RACO_4IN_EXT_201 |
| `raco_41116_ext_250_150` | 250 | extension_ring | family: metal_square_4_11_16 | — | 1-1/2" (1.5) | **29.5** | Extension ring · 1-1/2" deep · +29.5 in³ · RACO 250 | Extension ring · 1-1/2" deep · +29.5 in³ · RACO 250 | RACO_41116_EXT_250 |
| `raco_oct4_ext_128_150` | 128 | extension_ring | family: metal_octagon_4 | — | 1-1/2" (1.5) | **15.5** | Extension ring · 1-1/2" deep · +15.5 in³ · RACO 128 | Extension ring · 1-1/2" deep · +15.5 in³ · RACO 128 | RACO_OCT_EXT_128 |

Same-height proof retained on purpose: RACO 772/8772 (1-device, 1/2") = **3.5** while RACO 778/8778 (2-device, 1/2") = **5.5**.

## 4. Unresolved — RACO 821 (2-gang 3/4" raised cover for 951 / 941)

| published value | source | note |
|---:|---|---|
| 10.0 | RACO_MULTIGANG | Current full catalog table |
| 10.3 | RACO_821_SPEC | Dedicated specification sheet REV 4/2025 |

Implementation rule (seed, verbatim): *Do NOT auto-add either value. UI must route to Custom/verified marked volume until the manufacturer conflict is resolved.*

Shipped behaviour: for `raco_951` and `raco_941` the selector offers **None** and **Other / Custom** only, and a note appears beside it: 'RACO 821 3/4" cover: automatic volume unavailable because current manufacturer sources conflict. Verify the actual product data and use Custom.'. Tests sweep every box × every option and prove no path resolves 10.0 or 10.3 (`test/boxFillCatalog.test.js` §6; browser: `tools/boxfill-check-mobile.js` 'acceptance 4').

## 5. Sources (`BF_CATALOG_SOURCES`, checked 2026-09-06)

| id | document | locator | URL |
|---|---|---|---|
| RACO_FULL | RACO / TayMac / Bell Full Product Catalog | Current manufacturer catalog; mud rings, multigang boxes/covers. | https://hubbellcdn.com/catalogfull/RACO_TayMac_Bell_FullCatalog.pdf |
| RACO_STEEL_CURRENT | STEEL BOXES, COVERS, AND ACCESSORIES | Current manufacturer catalog tables for square covers and multigang covers. | https://hubbellcdn.com/catalogfull/HES-MULTI-CAT-EN-03988_A.pdf |
| RACO_4IN_SINGLE | Steel Boxes, Covers and Accessories — 4 in. Square Single Device Covers | 4 in. Square Single Device Covers, printed A21 | https://hubbellcdn.com/catalogfull/RTB_Steel%20Boxes-Covers-Acc.pdf |
| RACO_4IN_TWO | STEEL BOXES, COVERS, AND ACCESSORIES — 4 in. Square Two Device and Tile Covers | printed A24 | https://hubbellcdn.com/catalogpage/RTB_A24_CatalogPage.pdf |
| RACO_41116 | RACO / TayMac / Bell Full Product Catalog — 4-11/16 in. Square Covers | 4-11/16 in. Square Single Device and Two Device cover tables | https://hubbellcdn.com/catalogfull/RACO_TayMac_Bell_FullCatalog.pdf |
| RACO_MULTIGANG | RACO / TayMac / Bell Full Product Catalog — Multigang Boxes and Covers | Multigang Boxes (951–955, 941–945) and raised covers (821–825) | https://hubbellcdn.com/catalogfull/RACO_TayMac_Bell_FullCatalog.pdf |
| RACO_821_SPEC | RACO 821 Specification Sheet | REV 4/2025; Cubic Capacity field | https://hubbellcdn.com/specsheet/RACO_CA-821-SPEC-EN.pdf |
| RACO_4IN_EXT_201 | RACO 201 — 4 in. Square Extension Ring, 1-1/2 in. Deep |  | https://www.hubbell.com/hubbell/en/products/4-in-square-extension-ring-drawn-1-12-in-deep-with-twelve-12-in-kos/p/19464454 |
| RACO_41116_EXT_250 | RACO 250 — 4-11/16 in. Square Extension Ring, 1-1/2 in. Deep |  | https://www.hubbell.com/raco/en/products/4-1116-in-square-extension-ring-drawn-1-12-in-deep-with-eight-12-and-four-34-in-kos/p/19464589 |
| RACO_OCT_EXT_128 | RACO 128 — 4 in. Octagon Extension Ring, 1-1/2 in. Deep |  | https://www.hubbell.com/raco/en/products/4-in-octagon-extension-ring-drawn-1-12-in-deep-four-12-in-kos/p/19464426 |

The implementation environment for this milestone had no egress to hubbellcdn.com / hubbell.com (package registries only), so the manufacturer pages were **not re-fetched** here; the seed is treated as the locked, independently checked dataset. No contradiction beyond the already-flagged 821 conflict was introduced or resolved.

## 6. Selector behaviour (product decisions)

- Placement (review R1): the Ring / raised cover control, its note, its help and the Custom input follow **Box Type directly** (product spec §2), before Wire Size / Conductors / Devices / Clamps / EGC — box and ring are chosen as one physical set before the box contents; asserted by a source-order test and a real-DOM order check.
- Options: `None` · compatible verified records grouped as *1-device mud rings*, *2-device mud rings*, *N-Gang raised covers*, *Extension rings* · `Other / Custom`.
- **Any Box Type change resets the selection to None and the Custom entry to 0 (hidden), in ALL cases — catalog ring or Custom, same family or not.** A ring/cover or a manually entered volume belongs to the assembly used with the previous box and must never silently carry into a new box. Recalculation runs immediately with `extensionVolume: 0`. (Stricter than the conditional wording in the product spec §2, by explicit product decision during implementation.)
- With the box unchanged, a still-valid selection is kept; an unknown/tampered value is neutralised to None before the single engine call.
- The Custom decimal input keeps the accepted EC-CALC-1 semantics (blank = INCOMPLETE, invalid/negative = CHECK INPUT, arbitrary decimals kept exactly). In None / catalog mode it is hidden and never read; a catalog capacity is never written into it.
- Result row: `Total Volume` shows `(+3.5 added · RACO 772/8772)` for a catalog record and `(+4.437 added)` for Custom.

## 7. Field help (offline)

Six `ⓘ` controls — real `<button type="button">` with `aria-label`, `aria-expanded`, `aria-controls` → an inline `.bf-help` block; one open at a time; tap or keyboard; no hover. Text is the product-spec wording (Gang, Device yoke, Internal clamps, EGC / bonding jumpers, Ring / raised cover, Custom extra volume). NEC citations (`314.16(B)(4)`, `(B)(2)`, `(B)(5)`, `(A)`) are `.nec-link` spans routed through the existing `necLink`; no protected NEC prose is reproduced. Review R2: whenever Custom mode is no longer active (None, a catalog item, a Box Type change, Reset) the Custom help is hidden and its button returns to `aria-expanded="false"`; unrelated help (Gang, EGC, …) is left as it was.

## 8. Phone gate note — iPhone focus zoom (EC-CALC-1B focus-zoom patch)

On a physical iPhone, tapping a Box Fill control (e.g. the EGC count) enlarged the page and left it panned after the keyboard closed. Cause: the shared `select, input[type=number]` rule renders control text at 14 CSS px, and iOS Safari zooms into a focused control whose text is smaller than 16 px (WebKit `_zoomToFocusRect`, scale ≈ 16 / focused font-size). Fix, scoped to `#panel-boxfill .controls select, #panel-boxfill .controls input[type=number] { font-size: 16px; }` inside the EC-CALC-1B CSS block: all nine Box Fill controls (Box Type, Ring / raised cover, Custom extra volume, Wire Size, Conductors, Devices, Clamps, EGC count, EGC size) compute to 16 px unfocused, focused and blurred at 375 / 390 / 414 px and phone landscape (measured in Chromium; see the harness). Labels, headings, results and every other calculator keep the shared 14 px rule. No zoom lock, viewport change, CSS `zoom`/`transform`, text-size-adjust or JavaScript zoom reset was added. Desktop measurements show the CSS the phone receives; the native focus/keyboard/dismiss behaviour is confirmed only on the physical iPhone (pending). Separate global accessibility debt, untouched here: the product viewport meta still carries `maximum-scale=1.0, user-scalable=no`.
