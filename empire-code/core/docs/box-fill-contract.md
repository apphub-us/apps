# Empire Code — Box Fill contract v2 (NEC 2020 / NYCEC 2025 base)

Contract version: **2**  · Rule basis: **NEC2020** (NFPA 70-2020 §314.16(A),(B); Tables 314.16(A),(B))
Milestone: EC-CALC-1 · Status: proposed for independent review (not accepted)

## 1. Scope and bounded model

`calculateBoxFill` is the single pure entry point. It performs a **volume check for a
modeled scope**, not an approval of an installation, a device's depth/compatibility, or a
box material's legality in any NYC occupancy.

Bounded non-EGC model (retained from v1): one **governing conductor size**
(`largestWireSize`, 14/12/10/8/6 AWG) prices every non-EGC allowance — each counted
conductor (B)(1), each device yoke ×2 (B)(4), one clamp allowance (B)(2), each support
fitting (B)(3). Mixed-size arrangements, 4 AWG and larger (which also fall under 314.28),
conduit bodies (C), partitioned boxes, and multi-gang yoke rules are **unsupported** and
must be checked by hand.

EGC/bonding-jumper model (new, §314.16(B)(5) NEC 2020):
```
n      = explicit number of EGCs + equipment bonding jumpers that ENTER the box
v      = Table 314.16(B) allowance for the largest of those entering wires (egcSize)
factor = 0 if n == 0, else 1 + max(0, n − 4) / 4
EGC volume = factor × v
```
A conductor no part of which leaves the box (a pigtail wholly inside) is **not** entered.
The domed-luminaire exception (B)(1) Ex. and any later-edition rule are **not** applied.

Comparisons (`fits`, `remaining`, `maxConductors`) use **unrounded** values; the rounded
fields exist for display only and can never turn OVER into FITS.

## 2. Input contract (version 2)

| field | type | rule |
|---|---|---|
| `contract` | `2` | required for v2 semantics; `1`/absent selects the legacy compatibility path; anything else → `UNSUPPORTED_CONTRACT` |
| `ruleBasis` | `'NEC2020'` | optional; any other value → `UNSUPPORTED_RULE_BASIS` |
| `boxKey` | key of `BF_BOXES` (own property) | else `BOX_NOT_IN_TABLE` |
| `largestWireSize` | `'14'…'6'` (own key of `BF_VOL`) | governing size; else `WIRE_NOT_IN_TABLE` |
| `numConductors`, `numDevices`, `numSupportFittings` | safe integer ≥ 0 (≤ 100 000) | fractions/NaN/strings → `INVALID_COUNT`; negative → `NEGATIVE_COUNT` |
| `hasClamps` | boolean (strict) | `'false'` string etc. → `INVALID_BOOLEAN` |
| `egcCount` | safe integer ≥ 0 (≤ 100 000), **required in v2** | missing → `EGC_COUNT_REQUIRED`; invalid → `INVALID_COUNT`; negative → `NEGATIVE_COUNT` |
| `egcSize` | `'14'…'6'` when `egcCount > 0` | missing/unknown → `EGC_SIZE_REQUIRED` / `WIRE_NOT_IN_TABLE`; **ignored when `egcCount == 0`** (documented and tested); larger allowance than `largestWireSize` → `EGC_LARGER_THAN_GOVERNING` (correct the governing size input; the bounded model never prices a clamp/device with a smaller conductor) |
| `extensionVolume` | finite number ≥ 0 (≤ 100 000) | added marked/listed volume of the actual assembly; else `INVALID_EXTENSION` |
| `hasEgc` (legacy boolean) | only meaningful without `contract:2` | see §3 |

Result (ok): existing totals plus `contract`, `ruleBasis`, unrounded `requiredVolume`,
`availableVolume`, `remainingRaw`, and `egc: { count, size, allowance, factor, volume }`.

## 3. Legacy input behaviour (compatibility path, no `contract` / `contract: 1`)

| legacy input | result |
|---|---|
| `hasEgc: false` (strict boolean) | known zero EGC; ok result carries `legacyCompatibility: 'HAS_EGC_FALSE_AS_ZERO'` |
| `hasEgc: true` | `{ ok:false, reason:'EGC_DETAILS_REQUIRED', requiresReview:true }` — never an affirmative fit |
| `hasEgc` absent | `{ ok:false, reason:'EGC_DETAILS_REQUIRED', requiresReview:true }` — missing information is not zero |
| legacy call that also carries `egcCount`/`egcSize` | `CONTRADICTORY_INPUT` |
| v2 call carrying `hasEgc` that disagrees with `egcCount` | `CONTRADICTORY_INPUT` (agreeing boolean is ignored) |

## 4. Capacity ledger — `BF_BOXES` (old → new), source per row

### 4.1 What each source is (and is not)

| id | document | what it establishes | what it does NOT establish |
|---|---|---|---|
| S1 | Leviton *Captain Code 2020* portal, node 246 — licensed reprint of NFPA 70-2020 §314.16 head text, (B) intro and (B)(5), with the 2020 strike/insert markup and the NFPA permission notice. URL: https://captaincode2020.leviton.com/node/246 | The 2020 EGC rule; the 12 AWG = 2.25 in³ (36.9 cm³) allowance quoted in its analysis | The full Table 314.16(A) |
| NEC-2020-TXT | UpCodes republication titled **"National Electrical Code 2020 of Illinois"** (breadcrumb: *National Electrical Code 2020 of Illinois › 3 Wiring Methods and Materials › 314 › 314.16*). Stable URL: https://up.codes/s/number-of-conductors-in-outlet-device-and-junction-boxes-and-conduit-bodies. Retrieved 2026-09-06; page carries the complete §314.16 text with **Table 314.16(A) Metal Boxes** (mm/in./cm³/in³ and max-conductor columns) and **Table 314.16(B)**. Edition check: the (B)(5) text on this page is the 2020 wording ("Where up to four … A ¼ volume allowance …") matching S1 character-for-character, and the "2017 of Illinois" variant is listed separately in its related-sections block — so the underlying edition is NFPA 70-2020, not inferred from the state label. No Illinois-specific amendment text appears within §314.16 on the page (the page is the model text; the same table also appears on the Texas "IHB Electrical Code 2020" pages as TABLE E3905.12.1 [Table 314.16(A)], an IRC-derived copy of the same NFPA table). | The NFPA 70-2020 Table 314.16(A) values and Table 314.16(B) values | Any NYC rule (see S3); any local amendment |
| S5 | RACO *Steel Boxes, Covers and Accessories* catalog, 2020 NEC heading ("STANDARDS, 2020 NATIONAL ELECTRICAL CODE®"), hosted by City Electric Supply. Copy actually read: https://media.cityelectricsupply.com/media/raco/196/documents/raco_brochure_176593.pdf (the task's stepid-1187097 copy was not retrievable here; the reviewer confirms A6 = PDF page 5, zero-based 4, in that copy). Page **A6 "STEEL BOX SELECTION CHART"** illustration: CUBIC INCHES 42.0 (4-11/16" Sq. 2-1/8" deep), 30.3 (4" Sq. 2-1/8"), 29.5 (4-11/16" Sq. 1-1/2"), 21.5 (4" Oct. 2-1/8"), 21.0 (4" Sq. 1-1/2"), **18.0 = Switch box 3-1/2" deep** (NOT a 4" square 1-1/4"). Page **A11** product rows: 4" square bracketed boxes 1-1/2" deep, welded — cat. 196, 8196, 8197, 199, 208, 8208, 193, 8193, 189F/H/HS/HWP/M, 227 — each **21.0 (344.1 cm³)**. Its box-fill prose states the pre-2020 EGC rule and was not used. | Marked product volumes for those specific RACO boxes, which equal the table minimums for the corresponding standard sizes | Standard-box table values for sizes it does not illustrate (4" sq 1¼", 4" oct 1¼"/1½", device/handy rows) |
| S3 | NYC DOB, *2025 New York City Electrical Code* PDF (dated 2025.12.21): https://www.nyc.gov/assets/buildings/codes-pdf/2025electrical_code.pdf — §28-1101.1 adopts NFPA 70-2020; Chapter 3 amendments run Article 300 → 310 (Tables 310.16/17/20 XHWN) → 326 → 330 → 334 → …; **no Article 314 / §314.16 amendment** (PDF page 19, zero-based 18, per the reviewer; confirmed by reading the full Chapter 3 amendment list). | NYC's base edition (NEC 2020) and the absence of a 314.16 amendment | Rules for existing installations / the 2011 code for earlier filings |
| S4 | ICC ISEP 2021 §314.16: https://codes.iccsafe.org/s/ISEP2021P1/national-electrical-code-nec-solar-provisions/ISEP2021P1-NEC-Sec314.16 — **inaccessible** (client-side viewer / 403); not bypassed | — | — |

### 4.2 Row-by-row ledger (locator: T.314.16(A) row = "mm × mm (in. × in.) type — cm³ — in³", from NEC-2020-TXT)

| key | geometry | old | new | NFPA 70-2020 Table 314.16(A) row | S5 cross-check |
|---|---|---|---|---|---|
| sq_4x1_25 | 4 × 1¼ in. square | 21.0 | **18.0** | 100 × 32 (4 × 1¼) square — 295 — 18.0 | none (A6's 18.0 is the 3½" switch box, not this row) |
| sq_4x1_5 | 4 × 1½ in. square | 25.5 | **21.0** | 100 × 38 (4 × 1½) square — 344 — 21.0 | A6 21.0; A11 rows 21.0 (344.1 cm³) |
| sq_4x2_125 | 4 × 2⅛ in. square | 30.3 | 30.3 (unchanged) | 100 × 54 (4 × 2⅛) square — 497 — 30.3 | A6 30.3 |
| sq_4_11_16x1_5 | 4-11/16 × 1½ in. square | 42.0 | **29.5** | 120 × 38 (4¹¹⁄₁₆ × 1½) square — 484 — 29.5 | A6 29.5 |
| sq_4_11_16x2_125 | 4-11/16 × 2⅛ in. square | 60.0 | **42.0** | 120 × 54 (4¹¹⁄₁₆ × 2⅛) square — 689 — 42.0 (60.0 appears in no row) | A6 42.0 |
| oct_4x1_25 | 4 × 1¼ in. round/octagonal | 15.5 | **12.5** | 100 × 32 (4 × 1¼) round/octagonal — 205 — 12.5 | none |
| oct_4x1_5 | 4 × 1½ in. round/octagonal | 21.5 | **15.5** | 100 × 38 (4 × 1½) round/octagonal — 254 — 15.5 | RACO 926/926-1 1½" deep octagon 15.5 (usesi 12219 brochure) |
| oct_4x2_125 | 4 × 2⅛ in. round/octagonal | 30.3 | **21.5** | 100 × 54 (4 × 2⅛) round/octagonal — 353 — 21.5 | A6 21.5; RACO 927/928 21.5 |
| dev_3x2x1_5 … dev_3x2x3_5 | 3 × 2 × 1½ … 3½ in. device | 7.5 / 10.0 / 10.5 / 12.5 / 14.0 / 18.0 | unchanged (verified) | 75 × 50 × 38/50/57/65/70/90 device — 123/164/172/205/230/295 | A6 18.0 = 3½" switch box row |
| handy_1_5, handy_1_875 | 4 × 2⅛ × 1½ / 1⅞ in. device | 10.3 / 13.0 | unchanged (verified) | 100 × 54 × 38 — 169 — 10.3; 100 × 54 × 48 — 213 — 13.0 | none |
| pl_* (11 rows) | plastic presets | 14–50 | unchanged | **not table rows**: marked volumes under 314.16(A)(2); valid only if the actual marking matches | n/a |

Seven values change. Pattern: each square/octagon row carried the volume of the next-deeper
box; the deepest 4-11/16" row carried a value absent from the table.

`BF_VOL` (Table 314.16(B) "Volume Allowance Required per Conductor", NFPA 70-2020, from
NEC-2020-TXT; 12 AWG also in S1): 14 AWG 2.00, 12 AWG 2.25, 10 AWG 2.50, 8 AWG 3.00, 6 AWG
5.00 in³ — verified, unchanged.

### 4.3 Source-gate status (honest)

- EGC rule 314.16(B)(5): **verified** against licensed NFPA text (S1) and NEC-2020-TXT; independently confirmed by the reviewer.
- Table 314.16(B): **verified** (NEC-2020-TXT; 12 AWG value also in S1).
- Table 314.16(A) rows for the seven corrections and the unchanged metal rows: **verified from NEC-2020-TXT**, a republication of the NFPA 70-2020 model text (edition confirmed by its 2020 (B)(5) wording), with manufacturer cross-checks for the four rows RACO illustrates. The independent reviewer could not reproduce the full table from the earlier generic citation; the URL above is the exact page read. **No primary NFPA/ICC copy of Table 314.16(A) was accessible in this environment (S4 403)** — if the reviewer requires a first-party NFPA/ICC table view rather than an adopted-code republication, that specific verification remains open; no value was guessed or taken from a competitor calculator, forum post, memory, or a later edition.
- NYC: **verified** — NEC 2020 base, no 314.16 amendment (S3).

## 5. Added volume

The generic ring/cover selector (height → volume guesses, e.g. "+21.5 in³ (1-1/2")" for a
4" square ring) is removed. Replacement: one non-negative decimal input, *Added
marked/listed volume (in³)*, default 0, the user entering the volume marked on the actual
ring/cover/extension per 314.16(A). No dimension arithmetic; no implicit positive volume.

## 6. Sources

See §4.1 for the exact documents, URLs, editions and locators actually used.

## 7. Independent test fixtures (not generated by the production formula)

- Audit example: 14 × #14 counted + 7 entering #14 EGCs, no other allowances, sq_4x2_125
  (30.3): conductors 28.0; EGC factor 1 + (7−4)/4 = 1.75 × 2.00 = 3.5; required 31.5 → OVER,
  remaining −1.2, max conductors ⌊(30.3 − 3.5)/2⌋ = 13. Same with n=4 → 30.0 FITS; n=5 → 30.5
  OVER.
- Rounding trap: 10 × #12 counted + 5 entering #12 EGCs; 22.0 marked + 3.31 added:
  22.5 + 1.25 × 2.25 = 25.3125 > 25.31 → OVER, although both display as 25.31.
- Capacity-only false-FITS (the same counts were FITS under the old value):
  10 × #12 = 22.5 in sq_4x1_5 → OVER at 21.0 (was ≤ 25.5);
  20 × #12 = 45.0 in sq_4_11_16x2_125 → OVER at 42.0 (was ≤ 60.0);
  12 × #12 = 27.0 in oct_4x2_125 → OVER at 21.5 (was ≤ 30.3).
- Display-precision contract (R1, presentation only — the verdict is never touched): the
  engine returns `display: { decimals, required, available, remaining }` rendered from the raw
  values at ONE shared precision — the smallest d (2..6) at which both boundary values print
  exactly, else the smallest d (2..12) at which they print differently with a non-zero
  remaining; exact equality prints at 2. Fixtures: 10 × #12 + 7 entering #12 EGCs in pl_sg_22:
  +4.437 → 26.4375 vs 26.4370, −0.0005, OVER; +4.43749 → 26.43750 vs 26.43749, −0.00001, OVER;
  +4.4375 → 26.44 vs 26.44, 0.00, FITS; +4.4374999 → 7 decimals, OVER; the 5-EGC +3.31 trap →
  25.3125 vs 25.3100, −0.0025, OVER.
- Implemented in `test/boxFillContract.test.js` (literal expected values), the shipped-adapter
  cases in `test/boxFillProduction.test.js`, and on real controls in
  `tools/boxfill-check-mobile.js`.

## 8. EC-CALC-1B appendix — field catalog & help (adapter-only; engine byte-identical)

EC-CALC-1B changes nothing in §1–§7. `calculateBoxFill` still receives one contract-2
request with a single numeric `extensionVolume`; it now arrives from the Ring / raised
cover selector instead of a manual-first input:

| selector state | `extensionVolume` sent | shown in Total Volume |
|---|---|---|
| None | `0` | — |
| verified catalog record (`BF_ACCESSORIES`, status `verified`, compatible with the base box) | that record's literal `addedVolumeIn3` | `(+3.5 added · RACO 772/8772)` |
| Other / Custom | the user's decimal, §2 semantics unchanged (blank → INCOMPLETE, invalid → CHECK INPUT) | `(+4.437 added)` |

`BF_BOXES` gained ten exact RACO multigang products (kind `listed_product`, family
`raco_multigang`, volumes 47.0 / 60.0 / 72.8 / 85.8 / 98.5 and 70.0 / 90.0 / 110.0 / 130.0 /
150.0) and a `family` field on the eight square/octagon rows; **no accepted capacity
changed** (§4 ledger stands). Any Box Type change resets the selector to None and the
Custom entry to 0 before the single engine call (all cases, Custom included). The RACO 821
cover is never auto-valued (manufacturer sources conflict, 10.0 vs 10.3); the UI shows a
conflict note for RACO 951/941 and routes to Custom. Record-level ledger, compatibility
rule, sources and product decisions: `docs/box-fill-catalog.md`. Tests:
`test/boxFillCatalog.test.js` (literal seed fixtures) and the extended
`tools/boxfill-check-mobile.js` (Chromium: catalog resolution, 821, resets, ⓘ help tap /
keyboard / aria, real `necLink` routing, 375 / 390 px validation-message wrap).
