# Load Calc — service sizing prototype (LC-SERVICE-SIZING-1, revision R2)

**Status:** bounded, NON-OPERATIVE engineering prototype. It is a standalone module plus its tests. It is not wired to `mobile.html`, the bundle (`tools/build-calc.js`), storage or any UI, and it is not a release.

R2 records that the NEC 2020 primary text for this bounded profile has been received (§5). Receiving that text is a separate matter from three other things, and none of them follows from it:
- the interpretation status (§6);
- site or device approval;
- global code compliance.

Every result — success, refusal, invalid input — and the error thrown on an unexpected fault carries:

```
operative: false, installationApproved: false, globalCodeCompliance: 'not_verified',
ruleReview: 'SCOPED_PRIMARY_TEXT_RECEIVED_INTERPRETATION_OPEN'
```

No production-enable flag, environment switch, caller attestation or "revalidated" claim can change these flags or close the review. The design object rejects unknown keys, for example:
- `enableProduction`, `sourceVerified`, `installationApproved`;
- a freshness claim or a display value;
- `qualificationRevalidated`, `interpretationAccepted`;
- a table row, ampacity, qualification ampacity or source record.

## 1. Files (R2 modifies exactly these three; the other 147 files are byte-identical to baseline 150)

| Path | Role |
|---|---|
| `src/calc/loadCalcServiceSizing.js` | `analyzePrototype(request, design)`, frozen tables, source register and stage evidence |
| `test/loadCalcServiceSizing.test.js` | focused tests (`node --test`) |
| `docs/load-calc-service-sizing-1.md` | this document |

Dependencies: `loadCalcFacade.evaluateV2` (unchanged) and `loadCalcInputV2.E4`. The module does not use `wireSizing.selectConductor`.

## 2. API

`analyzePrototype(request, design?)` returns a deep-frozen object:

```
{ prototypeId, operative:false, ruleReview, installationApproved:false, globalCodeCompliance:'not_verified', sourceReview,
  status: 'EVALUATED' | 'REQUEST_INVALID' | 'DESIGN_INVALID',
  calcBasis, qualificationEcho, minimumService, chosenMain, ungroundedConductors, designProblems, remainingChecks }
```

- **`request`** is the caller's actual V2 request. The unchanged `evaluateV2` is the only source of demand and current.
- **`design`** is optional and kept separate from the calculation. It never enters the request, the result or the lcv-3/lcv-2 storage formats. Its fields:
  - `selectedMainRatingA`;
  - `plan { intent, oneMainDisconnect, noAdditionalSources, wholeDwelling, singleConductorSet }`;
  - `conductor { sizingPath, material, terminationTempRatingC, terminationMaterialCompatible, insulationTempRatingC, ambientTempC, currentCarryingConductors, wiringMethod, noOtherAdjustmentOrCorrection }`.

  `null` or an absent field means unanswered, and an unanswered field is never assumed. A type violation or an unknown key gives `DESIGN_INVALID`.
- **Reasons** have the shape `{ stage, code, field, sourceIds[], sections[], message }`. The historical manufacturer/access records S2–S5 are never cited by a reason.
- **`qualificationEcho.conductorAmpacityA`** is the declared 220.82(A) qualification input. It is never a breaker, installed rating or sizing value, and it is never replaced.
- **`ungroundedConductors`** always has `recommendationAvailable` (boolean), `size` (null unless available), `tableCandidate` and `qualificationConsistency`.

## 3. Stages

**Minimum service (standard service-disconnect rating candidate).** This stage has the same scope premises as R1:
- B82 on `opt_220_82` with a `COMPLETE` result;
- `service` and `dwelling_unit_house`;
- `1ph_3w_120_240` at 240 V;
- `current.status: 'computed'`;
- the plan premises `oneMainDisconnect`, `noAdditionalSources`, `singleConductorSet` and `wholeDwelling` all `true`.

The rating is the least R in the product subset `100,110,125,150,175,200,225,250,300,350,400` for which R ≥ 100 and `totalExactE4 <= R × 240 × 10⁴`:
- the comparison uses exact integers, never the displayed amperes;
- no 125 % is applied, and no 0.83 is applied to the load or the breaker.

`meaning` states that the result is a minimum STANDARD service-disconnect rating candidate, not an approved main breaker or equipment selection. The subset is a product scope. 240.6 permits other and nonstandard ratings, so a rating outside the subset is a scope refusal, not a claim that the rating is prohibited.

**Chosen main.** The caller must give an explicit `selectedMainRatingA` from the subset, plus `plan.intent: 'new_design_candidate'`:
- absent: `waiting_input`, with no default and no reuse of the qualification value;
- below the minimum: `rejected_undersized`;
- otherwise: `meets_prototype_minimum`.

Existing-equipment intents are `unsupported`, and no downgrade is suggested.

**Ungrounded conductors.** The stage runs only after an accepted chosen rating and sizes for **that rating**, never for the calculated current or the qualification value. Both paths require:
- explicit 75 °C terminals with compatible terminal material (not inferred from insulation or breaker amperage);
- 75 or 90 °C insulation, with ampacity always taken from the 75 °C column;
- 30 °C ambient;
- 2–3 current-carrying conductors;
- no other correction or adjustment;
- a single set, the whole dwelling and the scope above;
- single insulated conductors in raceway.

The following are `unsupported`: 60 °C or 90 °C terminal sizing, derating, Type MC (NYC 330.12), feeders, 120/208, parallel sets and PV/ESS. Unknown values give `waiting_input`.

- `general_table_75C`: the least Table 310.16 75 °C ampacity ≥ the selected rating. No 240.4(B) next-size exception applies. 100 A → 3 Cu / 1 Al; 200 A → 3/0 Cu / 250 kcmil Al.
- `dwelling_83pct_310_12`: the direct Table 310.12 row for the selected rating (§4), plus an exact check that `ampacity75C × 100 ≥ 83 × selectedRating`. The general "ampacity ≥ rating" rule is deliberately **not** applied, because 230.90 Exception 5 and 110.14(C)(1) reference 310.12. The 83 % is never applied to the load or the breaker.

**Qualification consistency** (`ungroundedConductors.qualificationConsistency`). The stage keeps `declaredQualificationAmpacityA` (the original value) and `candidateTableAmpacity75CA` separately. It never mutates the request or design, never replaces the 200 A premise and never recalculates:

| Condition | status | reason code | conductor output |
|---|---|---|---|
| candidate < 100 A (B82 software gate) | `review_required` | `B82_310_12_INTERPRETATION_PENDING` | `tableCandidate` only |
| candidate = declared | `premise_unchanged` | `QUALIFICATION_PREMISE_UNCHANGED` | `size` etc. (`recommendationAvailable: true`, still non-operative) |
| candidate ≠ declared, ≥ 100 A | `revalidation_required` | `QUALIFICATION_PREMISE_CHANGED` | `tableCandidate` only |

When the output is withheld, `status` is `table_candidate_conditional`, top-level `size` is null and `recommendationAvailable` is false. The conditional `tableCandidate` stays visible. The minimum 100 A candidate stays independently available.

A caller revalidates deliberately by editing its own request, for example declaring 175 A, and recalculating. No flag does it for them. No copied-request evaluation is added, because the explicit pending status is sufficient.

Examples with B0, where the declared qualification is 200 A:
- 310.12 at 100 A → Cu 4 (85 A) / Al 2 (90 A): `review_required`. This is not a code-violation finding.
- 310.12 at 200 A → Cu 2/0 (175 A) / Al 4/0 (180 A): `revalidation_required`.
- General path at 200 A → Cu 3/0 (200 A): `premise_unchanged`; Al 250 kcmil (205 A): `revalidation_required`.
- Declared 175 A, chosen 200 A, 310.12 Cu → 2/0: `premise_unchanged`.

The output covers ungrounded conductors only. `notSized` lists neutral, EGC, GEC, bonding, raceway, parallel sets, short-circuit withstand, voltage drop, terminal torque (110.14(D)), utility requirements, equipment listing and model selection. `remainingChecks` also carries two items:
- the NYC 230.43 wiring-method site review — the generic raceway input is **not** verified NYC method eligibility;
- the 220.82(A) qualification revalidation.

## 4. Table data (transcribed from the received primary excerpts)

- Standard-rating subset (Table 240.6(A)): 100,110,125,150,175,200,225,250,300,350,400 A.
- Table 310.16, 75 °C Cu: 4=85, 3=100, 2=115, 1=130, 1/0=150, 2/0=175, 3/0=200, 4/0=230, 250=255, 300=285, 350=310, 400=335, 500=380, 600=420.
- Table 310.16, 75 °C Al: 2=90, 1=100, 1/0=120, 2/0=135, 3/0=155, 4/0=180, 250=205, 300=230, 350=250, 400=270, 500=310, 600=340, 700=375, 750=385, 800=395, 900=425.
- Table 310.12, as [rating, Cu, Al]: [100,4,2], [110,3,1], [125,2,1/0], [150,1,2/0], [175,1/0,3/0], [200,2/0,4/0], [225,3/0,250], [250,4/0,300], [300,250,350], [350,350,500], [400,400,600].

Only `Al` is accepted as the second material. Cu-clad Al is not validated by the shared table heading.

## 5. Source provenance (`SOURCES`, `SOURCE_REVIEW.stages`)

The P_* records are NEC 2020 excerpts from the owner-supplied screenshot set of 2026-09-30:
- the coordinating reviewer read them visually;
- the coordinator recorded their SHA-256 over the original PNG bytes;
- the image bytes are not in this sandbox, and this prototype did not view them.

| id | image | file id | sha256 | clauses |
|---|---|---|---|---|
| P_230_42 | 3.40.25 PM | file_0000000065f8820ca45da9b669d0e9d6 | 24a7b808dfa67b23e2bda0ea05b91df0c4d437171fc50f9f7e15026d03658dde | 230.42(A)-(C) |
| P_230_79 | 3.41.31 PM | file_00000000a2c881f6a9e51e584fae6815 | 4d63d2ec6426e105a4914492f7465feb20af29691f791ed21e8f3d17bcdc0ff8 | 230.79(A)-(D) |
| P_230_90 | 3.41.54 PM | file_00000000b5e081f694b6630f049962c3 | f90d7a46434654111477f5bf8adbb3d595bcabe61ae022f676f1e13667fc643f | 230.90(A) and Exceptions 1-5; 230.90(B) |
| P_240_6 | 3.43.06 PM | file_00000000c42c81f6a4dc30632f1dcbb5 | f7f4932f9c6b2f5386e0ec462c384482351924d3e4d25252c71d1889122bb6af | 240.6(A); Table 240.6(A) |
| P_110_14_INTRO | 3.44.03 PM | file_00000000b29c81f698a9f4d6152db7af | 1ff4a26a11479a4097ed5ff42f8b14f06fc00ff7e781709861733111567f22da | 110.14 introduction |
| P_110_14_AB | 3.44.22 PM | file_00000000de0c81f6bc7c418da5d5014a | 32d10fc3891325853d1bc24a45c1a543a264b4e79580012bf53045bdf2538cd8 | 110.14(A); 110.14(B); 110.14(C) opening only |
| P_110_14_C | 3.57.55 PM | file_000000004c4081f6af9521a0953902a6 | a6a5fea44ff8d44e5ef032da02fa6960ca0f0aa01d91801f82733f7c567c2cbc | 110.14(C); 110.14(C)(1)(a)/(b); 110.14(C)(2); 110.14(D) (adjacent) |
| P_310_16_COND | 3.45.37 PM | file_000000001f5c81f68d8f9c7be524a204 | a03518871f7a0b7d7138bdb510baed2ec8d00e6a08ee34c3e1d48aa433fdb820 | 310.16 applicability conditions |
| P_310_16_TABLE | 3.57.00 PM | file_00000000797481f6ae1acd3b993caf51 | 670f4f456f5a36d6c769113942b43f4e3a98c9ee319bb3cc369e812d6d2112fc | Table 310.16 |
| P_310_12_A | 3.46.11 PM | file_0000000029ac81f69ef8d95765730549 | 2ae21110171e17ffdaccc873fe7a99a01e09d40e7e1c289c07cfb1c317992c62 | 310.12 opening |
| P_310_12_B | 3.46.33 PM | file_0000000028d081f6b87b1b912b059d03 | 0d0e831e18ce7da25a5c814e2a7349d3284fe82140cbd704acb4b5b67d1c81de | 310.12(A)-(D); Table 310.12 |

The table is generated from `SOURCES` in the module, and each hash was checked against the coordinator ledger (`../LC-SERVICE-SIZING-1-R1/SOURCE-INTAKE-20260930.md`).

S1 is the NYC Electrical Code 2025, the NEC 2020 amendment layer, <https://www.nyc.gov/assets/buildings/codes-pdf/2025electrical_code.pdf>. Its cover date, 2025-12-21, is not a claim about enactment history. What it does:
- 230.42 adds (D)/(E), which are not implemented;
- 230.43 is replaced, so it stays a site review;
- the 310.16 amendment deletes XHWN from the 90 °C columns only;
- 330.12 prohibits Type MC service conductors;
- no amendment of 230.79, 230.90, 240.6(A), 110.14(C) or 310.12 was found.

S2–S5 (Schneider, Tesla, NFPA free access) are kept only as R1 history. None of them is the sole source of any row.

Each stage's evidence (`primaryText: 'source_verified_bounded_profile'`) is kept separate from its `interpretation` and from `installationApproval: 'not_approved'`.

## 6. Remaining interpretation boundary (`OPEN_INTERPRETATION_ITEMS`)

- The accepted B82 engine requires `optional82.conductorAmpacityA ≥ 100`. That is a software qualification gate. 310.12, 230.90 Exception 5 and 110.14(C)(1) expressly allow conditional reduced dwelling conductor sizing. A 75 °C table ampacity below 100 A is therefore **not** proof of a violation, and there is no universal prohibition on 310.12 with 220.82. How the two relate is a pending model/premise contract, and no caller flag resolves it.
- A candidate whose ampacity differs from the declared qualification requires deliberate revalidation.
- NYC 230.43 method applicability, terminal listing/identification (110.14(C)(1)(a)/(b), (C)(2)) and torque (110.14(D)) stay equipment/site checks.

## 7. Not implemented

- 60 °C and 90 °C sizing, correction/adjustment factors, parallel sets, feeders/apartments/multifamily, 120/208 and three-phase, multiple disconnects, additional sources, existing-equipment assessment, and adjustable trip.
- UI/bundle integration and persistence of design inputs.
