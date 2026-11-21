#!/usr/bin/env python3
"""contract_invariants_r22 — executable invariant checker for EC-CALC-2 contract v3.2 (r2.1 closure, r2.2 graph completeness).
Adds I-21 (operative graph completeness: exact line set per path, ordered operand references with multiplicity, conductor
association of every new term, governing = max of terminal conductor values, complete comparison set) and the unityPF
declaration requirement for an L-L term on the split-phase amperes path (I-13). Nothing from r2.1 is weakened.
Layer L4. Checks a LoadCalcResult against the RequestEnvelope it claims to answer. It is NOT an engine: it re-derives only
the finite set of declared active relationships (profile A) and never applies any NEC rule of its own.
Usage: python3 contract_invariants_r22.py <schema> <cases.json>"""
import json, math, sys
from decimal import Decimal, ROUND_HALF_UP

S3 = math.sqrt(3.0)
PROFILE_A = {"id": "A_measured_87_core", "enabledMethods": {"measured_220_87"}, "enabledNewLoadModes": {"none", "precalculated"},
             "enabledModels": {"single_2w", "split_240_all_LL", "split_240_balanced_LN", "split_240_declared_legs", "network_208_all_LL", "network_208_balanced_LN", "three_phase_balanced"},
             "upperBoundScreening": False, "autoHandoff": False, "autoRating": False, "comparisonPolicy": "raw_conservative", "codeRounding": None}
CODE_LAYER = {"NOT_FINITE": {"input"}, "OUT_OF_RANGE": {"input"}, "NOT_INTEGER": {"input"}, "UNKNOWN_ENUM": {"input"}, "LEGACY_AMBIGUOUS": {"input"},
  "UNSUPPORTED_RATING_KIND": {"input"}, "MISSING_FIELD": {"input", "capacity"}, "QUALIFICATION_UNKNOWN": {"input"}, "QUALIFICATION_FAILED": {"input"},
  "CLASSIFICATION_REQUIRED": {"demand"}, "SCOPE_UNSUPPORTED": {"input"}, "CAPABILITY_DISABLED": {"input"}, "RULE_PENDING": {"input"},
  "LOAD_UNRESOLVED": {"demand"}, "MODEL_UNSUPPORTED": {"current"}, "MODEL_DECLARATION_MISSING": {"current"}, "SUPPLY_INCONSISTENT": {"input"},
  "LEG_INVALID": {"input"}, "CONNECTION_INVALID": {"input"}, "ASSOCIATION_UNKNOWN": {"capacity"}, "NEWLOAD_BASIS_UNQUALIFIED": {"capacity"},
  "NEWLOAD_MODE_NONE_WITH_NEW_LOADS": {"demand"}, "NOT_COVERED_BY_AGGREGATE": {"demand"}, "AGGREGATE_STALE": {"demand"}, "COVERS_UNKNOWN_LOAD": {"input"},
  "DUPLICATE_ID": {"input"}, "LEGACY_LAUNDRY_MERGED": {"input"}, "PARSE_REJECTED": {"input"}}
INPUT_ROWS = {"INVALID_INPUT": {"NOT_FINITE", "OUT_OF_RANGE", "NOT_INTEGER", "UNKNOWN_ENUM", "LEGACY_AMBIGUOUS", "UNSUPPORTED_RATING_KIND", "SUPPLY_INCONSISTENT", "LEG_INVALID", "CONNECTION_INVALID", "COVERS_UNKNOWN_LOAD", "DUPLICATE_ID", "PARSE_REJECTED"},
              "INCOMPLETE_INPUT": {"MISSING_FIELD", "QUALIFICATION_UNKNOWN"}, "UNQUALIFIED_METHOD": {"QUALIFICATION_FAILED"}}
NO_RESULT = ("EMPTY", "UNSUPPORTED_SCOPE", "BLOCKED_PENDING_RULE", "INVALID_INPUT", "INCOMPLETE_INPUT", "UNQUALIFIED_METHOD")
COVERS_FIELDS = ("id", "category", "classification", "rating", "quantity", "status", "continuous", "connection", "leg", "separatelyControlledUnits", "alms")

def fmt(x, d):
    """Display formatting only: round half away from zero to d decimals, group thousands. Never decides anything."""
    q = Decimal(1).scaleb(-d); v = Decimal(repr(float(x))).quantize(q, rounding=ROUND_HALF_UP); return f"{v:,.{d}f}"
def covers_projection(loads, covers):
    """Canonical covered-set snapshot: covered loads sorted by id (codepoint order), each projected to the basis-relevant fields
    (descriptive fields `label` and `legacy` excluded). Duplicate ids in covers[] or loads[] make the projection undefined (DUPLICATE_ID)."""
    if len(set(covers)) != len(covers) or len({l["id"] for l in loads}) != len(loads): return None
    byid = {l["id"]: l for l in loads}
    if any(c not in byid for c in covers): return None
    import copy as _copy
    return [{k: _copy.deepcopy(byid[c][k]) for k in COVERS_FIELDS} for c in sorted(covers)]
def canon(x): return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
def norm_va(reading, pf):
    v, u = reading["value"], reading["unit"]
    if v is None: return None
    if u == "VA": return v
    if u == "kVA": return v * 1000.0
    if u == "kW": return (v * 1000.0) / pf if pf else None
    return None

def check_result(r, env=None):
    """Return the list of invariant violations (empty = passes). Binding checks (I-14..I-19) need the envelope."""
    V = []; st = r["status"]; dem = r["demand"]; cur = r["current"]; cap = r["existingCapacity"]
    # I-01 status <-> layer statuses
    if st == "COMPLETE" and dem["status"] != "complete": V.append("I-01 COMPLETE requires demand.complete")
    if st == "PARTIAL" and (dem["status"] != "partial_diagnostic" or cur["status"] != "not_computed" or cap["status"] != "not_assessed"): V.append("I-01 PARTIAL couplings")
    if st in NO_RESULT and (dem["status"] != "not_computed" or cur["status"] != "not_computed" or cap["status"] != "not_assessed" or dem["lines"]): V.append("I-01 no-result status must clear all layers")
    if cap["status"] in ("adequate", "inadequate") and st != "COMPLETE": V.append("I-01 verdict only on COMPLETE")
    # I-02 problem layers, sort order, precedence
    codes = [p["code"] for p in r["problems"]]
    for p in r["problems"]:
        if p["layer"] not in CODE_LAYER.get(p["code"], set()): V.append(f"I-02 problem {p['code']} has disallowed layer {p['layer']}")
    keys = [(p["code"], p["field"]) for p in r["problems"]]
    if keys != sorted(keys): V.append("I-02 problems not sorted by (code, field)")
    inp = {p["code"] for p in r["problems"] if p["layer"] == "input"}
    if st != "EMPTY":
        if inp & {"SCOPE_UNSUPPORTED", "CAPABILITY_DISABLED"}: expect = "UNSUPPORTED_SCOPE"
        elif "RULE_PENDING" in inp: expect = "BLOCKED_PENDING_RULE"
        elif inp & INPUT_ROWS["INVALID_INPUT"]: expect = "INVALID_INPUT"
        elif inp & INPUT_ROWS["INCOMPLETE_INPUT"]: expect = "INCOMPLETE_INPUT"
        elif inp & INPUT_ROWS["UNQUALIFIED_METHOD"]: expect = "UNQUALIFIED_METHOD"
        elif any(c["coverage"] == "unresolved" for c in r["loadsCoverage"]): expect = "PARTIAL"
        else: expect = "COMPLETE"
        if expect != st: V.append(f"I-02 status precedence: problems imply {expect}, got {st}")
    # I-07 coverage <-> LOAD_UNRESOLVED
    unresolved = [c for c in r["loadsCoverage"] if c["coverage"] == "unresolved"]
    if st == "COMPLETE" and unresolved: V.append("I-07 COMPLETE with unresolved coverage")
    if st == "PARTIAL" and not unresolved: V.append("I-07 PARTIAL without unresolved coverage")
    lu = [p for p in r["problems"] if p["code"] == "LOAD_UNRESOLVED"]
    if st in ("PARTIAL", "COMPLETE") and len(lu) != len(unresolved): V.append("I-07 LOAD_UNRESOLVED problems must match unresolved coverage entries")
    if any(c["reason"] is None for c in unresolved): V.append("I-07 unresolved coverage needs a reason")
    # I-08 pending lines
    if any(l["ruleStatus"] == "pending" for l in dem["lines"]) and st != "BLOCKED_PENDING_RULE": V.append("I-08 pending line outside BLOCKED_PENDING_RULE")
    # I-03 typed line equations — EXACT (IEEE double, declared evaluation order); referenced operands must equal the referenced result exactly
    byid = {}
    for l in dem["lines"]:
        if l["id"] in byid: V.append(f"I-03 duplicate line id {l['id']}")
        byid[l["id"]] = l
    for l in dem["lines"]:
        ops = l["operands"]; res = l["result"]
        for o in ops:
            if o["ref"] is not None:
                if o["ref"] not in byid: V.append(f"I-03 line {l['id']} references unknown line {o['ref']}")
                elif not (byid[o["ref"]]["result"]["unit"] == o["quantity"]["unit"] and byid[o["ref"]]["result"]["value"] == o["quantity"]["value"]): V.append(f"I-03 line {l['id']} operand != referenced line result (exact)")
        if l["op"] == "identity":
            if len(ops) != 1 or ops[0]["quantity"]["unit"] != res["unit"] or ops[0]["quantity"]["value"] != res["value"]: V.append(f"I-03 identity mismatch in {l['id']}")
        elif l["op"] == "multiply":
            if len(ops) != 1 or l["factor"] is None or ops[0]["quantity"]["unit"] != res["unit"] or ops[0]["quantity"]["value"] * l["factor"] != res["value"]: V.append(f"I-03 multiply mismatch in {l['id']}")
        elif l["op"] == "divide_by_voltage":
            if len(ops) != 1 or ops[0]["quantity"]["unit"] != "VA" or res["unit"] != "A" or not l["divisorV"] or ops[0]["quantity"]["value"] / l["divisorV"] != res["value"]: V.append(f"I-03 divide_by_voltage mismatch in {l['id']}")
        elif l["op"] == "divide_by_sqrt3_voltage":
            if len(ops) != 1 or ops[0]["quantity"]["unit"] != "VA" or res["unit"] != "A" or not l["divisorV"] or ops[0]["quantity"]["value"] / (S3 * l["divisorV"]) != res["value"]: V.append(f"I-03 divide_by_sqrt3_voltage mismatch in {l['id']}")
        elif l["op"] == "sum":
            units = {o["quantity"]["unit"] for o in ops}; acc = 0.0
            for o in ops: acc = acc + o["quantity"]["value"]
            if len(units) != 1 or res["unit"] not in units or acc != res["value"]: V.append(f"I-03 sum mismatch in {l['id']}")
        elif l["op"] == "convert_unit":
            q = ops[0]["quantity"] if len(ops) == 1 else None
            exp = None if q is None else (q["value"] * 1000.0 if q["unit"] == "kVA" else ((q["value"] * 1000.0) / l["powerFactor"] if q["unit"] == "kW" and l["powerFactor"] else None))
            if exp is None or res["unit"] != "VA" or exp != res["value"]: V.append(f"I-03 convert_unit mismatch in {l['id']}")
        if res["value"] < 0: V.append(f"I-10 negative line result {l['id']}")
    if dem["status"] == "complete":
        final = dem["lines"][-1] if dem["lines"] else None
        if final is None: V.append("I-03b complete demand without lines")
        elif dem["unit"] == "VA" and not (final["result"]["unit"] == "VA" and final["result"]["value"] == dem["totalVA"]): V.append("I-03b totalVA != final line result (exact)")
        elif dem["unit"] == "A" and not (final["result"]["unit"] == "A" and final["result"]["value"] == dem["totalOnConductorA"]): V.append("I-03b totalOnConductorA != final line result (exact)")
    # I-05 current from typed supply/model data (never from the formula string); comparisons copy raw values EXACTLY
    if cur["status"] == "computed":
        if dem["status"] != "complete" or dem["unit"] != "VA": V.append("I-05 current computed requires complete VA demand")
        elif env is None: V.append("I-05 current cannot be bound without the envelope")
        else:
            sup = env["snapshot"]["supply"]; m = cur["model"]; tot = dem["totalVA"]
            if m != env["snapshot"]["loadModel"]["kind"]: V.append("I-16 current.model != envelope loadModel.kind")
            if m in ("split_240_all_LL", "split_240_balanced_LN", "network_208_all_LL", "single_2w"): exp = tot / sup["vLineToLine"]
            elif m == "network_208_balanced_LN": exp = (tot / 2.0) / sup["vLineToNeutral"]
            elif m == "three_phase_balanced": den = S3 * sup["vLineToLine"]; exp = tot / den
            else: exp = None
            if exp is None: V.append(f"I-16 model {m} has no closed-form current in profile A")
            elif cur["lineA"] != exp: V.append(f"I-16 lineA {cur['lineA']!r} != exact {exp!r} from envelope supply/model")
            pc = cur["perConductorA"] or {}; vals = [v for v in pc.values() if v is not None]
            if vals and max(vals) != cur["lineA"]: V.append("I-05 lineA must equal max(perConductorA)")
    for c in cap["comparisons"]:
        if c["satisfied"] != (c["demandValueRaw"] <= c["ratingValue"]): V.append("I-04 satisfied flag inconsistent with raw <= comparison")
    if cap["status"] == "adequate" and not (cap["comparisons"] and all(c["satisfied"] for c in cap["comparisons"])): V.append("I-04 adequate requires all comparisons satisfied")
    if cap["status"] == "inadequate" and not any(not c["satisfied"] for c in cap["comparisons"]): V.append("I-04 inadequate requires a failed comparison")
    if cap["status"] == "not_assessed" and (cap["comparisons"] or cap["blockingCode"] is None) and st == "COMPLETE": V.append("I-04 not_assessed on COMPLETE needs blockingCode and no comparisons")
    if cap["status"] in ("adequate", "inadequate"):
        if cap["comparisonKind"] != "exact": V.append("I-04 verdict requires exact comparison")
        for c in cap["comparisons"]:
            if dem["unit"] == "A":
                if c["conductor"] is None: ref = dem["totalOnConductorA"]
                else:
                    ln = byid.get(f"t_{c['conductor']}") or byid.get(f"e_{c['conductor']}"); ref = ln["result"]["value"] if ln else None
            else:
                pc = cur["perConductorA"] or {}; ref = pc.get(c["conductor"]) if c["conductor"] else cur["lineA"]
            if ref is None or c["demandValueRaw"] != ref: V.append(f"I-05 comparison on {c['conductor']} must copy the raw operative value exactly (got {c['demandValueRaw']!r}, operative {ref!r})")
            # I-18 boundary side: the operative raw value decides; a copy that drifts across the rating is rejected above (exact), this guards the flag
            if ref is not None and (ref <= c["ratingValue"]) != c["satisfied"]: V.append("I-18 verdict side disagrees with the operative raw value")
    # I-06 display strings derived from raw with declared precision; never feed comparisons
    disp = r["display"]
    if disp["feedsComparison"] is not False: V.append("I-06 display must not feed comparison")
    pa, pv = disp["precision"]["amps"], disp["precision"]["va"]; exp_strings = {}
    if dem["status"] == "complete" and dem["unit"] == "VA": exp_strings["totalVA"] = f"{fmt(dem['totalVA'], pv)} VA"
    if dem["status"] == "complete" and dem["unit"] == "A": exp_strings["totalOnConductorA"] = f"{fmt(dem['totalOnConductorA'], pa)} A"
    if cur["status"] == "computed": exp_strings["lineA"] = f"{fmt(cur['lineA'], pa)} A"
    for k, s_exp in exp_strings.items():
        if disp["strings"].get(k) != s_exp: V.append(f"I-06 display.{k} = {disp['strings'].get(k)!r}, expected {s_exp!r}")
    # I-09 diagnostics non-operative; rating/requiredCapacity inactive; presentation coupling
    if r["diagnostics"].get("operative") is not False: V.append("I-09 diagnostics must be non-operative")
    if r["requiredCapacity"]["status"] != "not_assessed" or r["rating"]["status"] != "not_assessed": V.append("I-09 requiredCapacity/rating must be not_assessed in profile A")
    pr = r["presentation"]
    if st == "COMPLETE":
        if pr["finalResultHeading"] is not True: V.append("I-09c COMPLETE demand shows finalResultHeading")
        if pr.get("verdictLabel") != cap["status"]: V.append("I-09c verdictLabel must mirror existingCapacity.status on COMPLETE")
    else:
        if pr["finalResultHeading"] is not False or pr.get("verdictLabel") is not None: V.append("I-09c non-COMPLETE must not show a final heading or a verdict label")
    # I-10 finiteness
    def walk(x, path="$"):
        if isinstance(x, float) and not math.isfinite(x): V.append(f"I-10 non-finite number at {path}")
        elif isinstance(x, dict):
            for k, v in x.items(): walk(v, f"{path}.{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x): walk(v, f"{path}[{i}]")
    walk(r)
    if env is None: return V
    # ---------- binding to the RequestEnvelope (R-R2-01) ----------
    s = env["snapshot"]; meth = s["method"]["selected"]; meas = s["measurement"]; mode = meas["newLoad"]["mode"] if meas else None
    pre = meas["newLoad"]["precalculated"] if meas and mode == "precalculated" else None
    if meth and meth not in PROFILE_A["enabledMethods"] and "CAPABILITY_DISABLED" not in codes: V.append("I-11 method outside profile without CAPABILITY_DISABLED")
    if mode and mode not in PROFILE_A["enabledNewLoadModes"] and "CAPABILITY_DISABLED" not in codes: V.append("I-11 newLoad.mode outside profile without CAPABILITY_DISABLED")
    if cur["status"] == "computed" and cur["model"] not in PROFILE_A["enabledModels"]: V.append("I-11 computed current with a model outside the profile")
    # parse errors must surface as parser-sourced problems and block completeness
    for pe in env["parseErrors"]:
        if not any(p["code"] == pe["code"] and p["field"] == pe["field"] and p["source"] == "parser" for p in r["problems"]): V.append(f"I-20 parseError {pe['code']}:{pe['field']} not surfaced as a parser problem")
    if env["parseErrors"] and st in ("COMPLETE", "PARTIAL"): V.append("I-20 parse errors present but demand computed")
    if st in ("COMPLETE", "PARTIAL") and meth == "measured_220_87" and meas:
        # I-14 existing component bound to the normalized reading; factor exactly 1.25
        rd = meas["reading"]; unit = rd["unit"]
        if unit == "A":
            per = meas.get("readingsPerConductor"); src = {k: v for k, v in (per or {}).items() if v is not None} or ({"measured": rd["value"]} if rd["value"] is not None else {})
            for k, v in src.items():
                ln = byid.get(f"e_{k}")
                if not ln or ln["op"] != "multiply" or ln["factor"] != 1.25 or ln["operands"][0]["quantity"] != {"value": v, "unit": "A"}: V.append(f"I-14 existing line e_{k} not bound to the envelope reading {v!r} A x 1.25")
            if dem["unit"] != "A": V.append("I-14 amperes reading requires demand.unit A")
        else:
            nv = norm_va(rd, meas.get("powerFactor")); ex = byid.get("existing125")
            if nv is None:
                if st == "COMPLETE": V.append("I-14 COMPLETE with an unnormalizable/missing reading")
            elif not ex or ex["op"] != "multiply" or ex["factor"] != 1.25 or ex["operands"][0]["quantity"] != {"value": nv, "unit": "VA"}: V.append(f"I-14 existing125 not bound to normalized reading {nv!r} VA x 1.25")
            if unit in ("kVA", "kW"):
                nl = byid.get("norm")
                if not nl or nl["op"] != "convert_unit" or nl["operands"][0]["quantity"] != {"value": rd["value"], "unit": unit} or (unit == "kW" and nl["powerFactor"] != meas.get("powerFactor")): V.append("I-14 norm line not bound to the envelope reading/unit/PF")
                if ex and ex["operands"][0]["ref"] != "norm": V.append("I-14 existing125 must reference the norm line")
            elif ex and ex["operands"][0]["ref"] is not None: V.append("I-14 VA reading must be a leaf operand (ref null)")
            if dem["unit"] != "VA": V.append("I-14 VA-type reading requires demand.unit VA")
        # I-15 new-load term bound to the envelope (present iff precalculated; value equals precalculated.va; connection/leg respected)
        if dem["status"] == "complete":
            if mode == "precalculated":
                if pre is None or pre["va"] is None: V.append("I-15 complete demand with precalculated mode but no va")
                elif dem["unit"] == "VA":
                    nt = byid.get("newTerm"); tl = byid.get("total")
                    if not nt or nt["op"] != "identity" or nt["ruleStatus"] != "user_supplied" or nt["operands"][0] != {"ref": None, "quantity": {"value": pre["va"], "unit": "VA"}}: V.append(f"I-15 newTerm line missing or not equal to precalculated.va {pre['va']!r}")
                    if not tl or tl["op"] != "sum" or {o["ref"] for o in tl["operands"]} != {"existing125", "newTerm"}: V.append("I-15 total must be sum(existing125, newTerm) in precalculated mode")
                else:
                    nls = [l for l in dem["lines"] if l["id"].startswith("n_")]
                    if not nls: V.append("I-15 amperes path with a precalculated term needs n_* line(s)")
                    for nl in nls:
                        if nl["operands"][0] != {"ref": None, "quantity": {"value": pre["va"], "unit": "VA"}}: V.append("I-15 n_* operand != precalculated.va")
                        sup = s["supply"]
                        if pre["connection"] == "LN" and not (nl["op"] == "divide_by_voltage" and nl["divisorV"] == sup["vLineToNeutral"] and nl["conductor"] == pre["leg"]): V.append("I-15 LN term must divide by vLineToNeutral on the declared leg")
                        if pre["connection"] == "LL" and not (nl["op"] == "divide_by_voltage" and nl["divisorV"] == sup["vLineToLine"]): V.append("I-15 LL term must divide by vLineToLine")
                        if pre["connection"] == "3PH" and not (nl["op"] == "divide_by_sqrt3_voltage" and nl["divisorV"] == sup["vLineToLine"]): V.append("I-15 3PH term must use sqrt3 x vLineToLine")
            elif mode == "none":
                if any(l["id"] == "newTerm" or l["id"].startswith("n_") for l in dem["lines"]): V.append("I-15 new-term line present although mode is none")
                tl = byid.get("total")
                if dem["unit"] == "VA" and (not tl or tl["op"] != "identity" or tl["operands"][0]["ref"] != "existing125"): V.append("I-15 total must be identity(existing125) in mode none")
        # I-17 rating bound to the purpose-appropriate field of the CURRENT envelope
        src_field = "serviceRatingA" if s["purpose"] == "service" else "feederAmpacityA"
        for c in cap["comparisons"]:
            if c["ratingSource"] != src_field: V.append(f"I-17 ratingSource {c['ratingSource']} does not match purpose {s['purpose']}")
            if c["ratingValue"] != meas["existing"].get(src_field): V.append(f"I-17 ratingValue {c['ratingValue']!r} != envelope {src_field} {meas['existing'].get(src_field)!r}")
        if cap["status"] in ("adequate", "inadequate") and meas["existing"].get(src_field) is None: V.append("I-17 verdict without the purpose-appropriate rating in the envelope")
        # I-12 coverage rules per mode; I-19 aggregate staleness via the canonical covers snapshot
        new_loads = [l for l in s["loads"] if l["status"] == "new"]
        if mode == "none":
            for l in new_loads:
                cv = next((c for c in r["loadsCoverage"] if c["loadId"] == l["id"]), None)
                if not cv or cv["coverage"] != "unresolved" or cv["reason"] != "NEWLOAD_MODE_NONE_WITH_NEW_LOADS": V.append(f"I-12 new load {l['id']} not flagged under mode none")
        if mode == "precalculated" and pre is not None:
            covers = pre["covers"]; proj = covers_projection(s["loads"], covers)
            if proj is None:
                if "DUPLICATE_ID" not in codes and "COVERS_UNKNOWN_LOAD" not in codes: V.append("I-19 undefined covers projection (duplicate/unknown ids) without DUPLICATE_ID/COVERS_UNKNOWN_LOAD")
            else:
                stale = canon(proj) != canon(pre["coversSnapshot"] or [])
                if stale and st == "COMPLETE": V.append("I-19 stale aggregate (coversSnapshot != current covered loads) but COMPLETE")
                if stale and "AGGREGATE_STALE" not in codes: V.append("I-19 stale aggregate without AGGREGATE_STALE")
                if not stale and "AGGREGATE_STALE" in codes: V.append("I-19 AGGREGATE_STALE reported although the covered set is unchanged")
                for l in new_loads:
                    cv = next((c for c in r["loadsCoverage"] if c["loadId"] == l["id"]), None)
                    if l["id"] in covers:
                        if stale and not (cv and cv["coverage"] == "unresolved" and cv["reason"] == "AGGREGATE_STALE"): V.append(f"I-19 covered load {l['id']} must be unresolved(AGGREGATE_STALE) when stale")
                        if not stale and not (cv and cv["coverage"] == "counted_via_aggregate"): V.append(f"I-12 covered load {l['id']} must be counted_via_aggregate")
                    else:
                        ok_reason = cv and cv["coverage"] == "unresolved" and cv["reason"] in ("NOT_COVERED_BY_AGGREGATE", "CLASSIFICATION_REQUIRED", "UNSUPPORTED_RATING_KIND")
                        listed = any(p["code"] == "NOT_COVERED_BY_AGGREGATE" and p["field"].startswith("loads[") for p in r["problems"])
                        if not (ok_reason and listed): V.append(f"I-12 uncovered new load {l['id']} not flagged")
        # I-13 association / basis for exact verdicts (variant B)
        if cap["status"] in ("adequate", "inadequate"):
            scope = meas.get("readingScope"); conn = pre["connection"] if pre else None; topo = s["supply"]["topology"]
            if meas["reading"]["unit"] == "A":
                if scope == "highest_loaded_conductor" and conn == "LN" and not meas.get("readingsPerConductor"): V.append("I-13 exact verdict with LN new load on a single-conductor reading")
                if topo == "1ph_3w_120_240" and conn == "LL" and (s["loadModel"]["declarations"].get("unityPF") or {}).get("value") is not True: V.append("I-13 L-L term on the split-phase amperes path requires unityPF = true declared (in-phase addition)")
                if topo == "1ph_3w_120_208_network" and conn is not None: V.append("I-13 exact verdict with a new term on the network amperes path (unsupported combination)")
                if topo.startswith("3ph") and conn in ("LL", "LN"): V.append("I-13 exact verdict with an LL/LN term on a 3-phase amperes path (unsupported combination)")
            if mode == "precalculated" and pre["basis"]["establishedForThisComparison"] is not True: V.append("I-13 exact verdict with unqualified new-load basis")
        if dem["status"] == "complete" and meas["reading"]["unit"] in ("VA", "kVA", "kW"):
            base = norm_va(meas["reading"], meas.get("powerFactor")); comp = r["diagnostics"].get("existingComponentVA")
            if base is not None and (comp is None or comp != base * 1.25): V.append("I-09b diagnostics.existingComponentVA != reading x 1.25")
        if dem["status"] == "complete" and mode in ("none", "precalculated"): V += check_graph(env, r)
        if dem["status"] == "complete" and meas["reading"]["unit"] == "A" and pre and pre["connection"] == "LL" and s["supply"]["topology"] == "1ph_3w_120_240" and (s["loadModel"]["declarations"].get("unityPF") or {}).get("value") is not True:
            V.append("I-13 complete split-phase amperes demand with an L-L term requires unityPF = true declared")
    return V

def check_graph(env, r):
    """I-21 — operative graph completeness of a complete measured demand (finite assertions on the declared active path).
    Ordered operand-reference LISTS (multiplicity counts), backward references only, exact line set, one terminal per operative
    conductor, governing = identity of a maximum terminal, every operative conductor compared exactly once with its terminal value."""
    V = []; s = env["snapshot"]; dem = r["demand"]; meas = s["measurement"]; mode = meas["newLoad"]["mode"]; lines = dem["lines"]
    byid = {}
    for l in lines: byid.setdefault(l["id"], l)
    if len(byid) != len(lines): V.append("I-21 duplicate line id")
    seen = set()
    for l in lines:
        for o in l["operands"]:
            if o["ref"] is not None and o["ref"] not in seen: V.append(f"I-21 non-backward reference in {l['id']}")
        seen.add(l["id"])
    def node(lid, op, refs, conductor="ANY"):
        ln = byid.get(lid)
        if not ln: V.append(f"I-21 missing line {lid}"); return None
        if ln["op"] != op or [o["ref"] for o in ln["operands"]] != refs: V.append(f"I-21 {lid} must be {op}{refs} exactly once and in order")
        if conductor != "ANY" and ln["conductor"] != conductor: V.append(f"I-21 wrong conductor on {lid}")
        return ln
    if dem["unit"] == "VA":
        ids = {"existing125", "total"}
        if meas["reading"]["unit"] in ("kVA", "kW"): ids.add("norm"); node("norm", "convert_unit", [None])
        node("existing125", "multiply", ["norm"] if meas["reading"]["unit"] in ("kVA", "kW") else [None])
        if mode == "precalculated": ids.add("newTerm"); node("newTerm", "identity", [None]); node("total", "sum", ["existing125", "newTerm"])
        else: node("total", "identity", ["existing125"])
        if set(byid) != ids: V.append(f"I-21 unexpected/disconnected VA line(s): {sorted(set(byid) ^ ids)}")
        if not lines or lines[-1]["id"] != "total": V.append("I-21 last VA line must be total")
        return V
    if dem["unit"] != "A": return V + ["I-21 unexpected complete-demand unit"]
    scope = meas.get("readingScope")
    if scope == "per_conductor": keys = [k for k, v in (meas.get("readingsPerConductor") or {}).items() if v is not None]
    elif scope == "highest_loaded_conductor": keys = ["measured"]
    else: return V + ["I-21 unsupported amperes reading scope"]
    if not keys: return V + ["I-21 no operative conductor reading"]
    ids = {f"e_{k}" for k in keys} | {"governing"}; terminals = {k: f"e_{k}" for k in keys}
    for k in keys: node(f"e_{k}", "multiply", [None], None if k == "measured" else k)
    if mode == "precalculated":
        pre = meas["newLoad"]["precalculated"]; conn = pre["connection"]
        if conn == "LN":
            leg = pre["leg"]; nid = f"n_{leg}"
            if leg not in keys: return V + ["I-21 LN leg is not an operative conductor"]
            affected = [leg]; node(nid, "divide_by_voltage", [None], leg)
        elif conn in ("LL", "3PH"):
            nid = "n_LL" if conn == "LL" else "n_3PH"; affected = keys; node(nid, "divide_by_voltage" if conn == "LL" else "divide_by_sqrt3_voltage", [None])
        else: return V + ["I-21 unsupported new-term connection"]
        ids.add(nid)
        for k in affected:
            tid = f"t_{k}"; ids.add(tid); node(tid, "sum", [f"e_{k}", nid], None if k == "measured" else k); terminals[k] = tid
    if set(byid) != ids: V.append(f"I-21 missing/unexpected/disconnected A line(s): {sorted(set(byid) ^ ids)}")
    vals = {k: byid[lid]["result"]["value"] for k, lid in terminals.items() if lid in byid}
    g = byid.get("governing")
    if len(vals) != len(keys) or not vals or not g: return V + ["I-21 cannot establish all conductor terminals / governing"]
    largest = max(vals.values()); valid = {terminals[k] for k, v in vals.items() if v == largest}
    if g["op"] != "identity" or len(g["operands"]) != 1 or g["operands"][0]["ref"] not in valid: V.append("I-21 governing must select a maximum terminal")
    if g["result"]["value"] != largest or dem["totalOnConductorA"] != largest: V.append("I-21 final A total differs from the maximum conductor terminal")
    if lines[-1]["id"] != "governing": V.append("I-21 last A line must be governing")
    cap = r["existingCapacity"]
    if cap["status"] in ("adequate", "inadequate"):
        expected = sorted([None if k == "measured" else k for k in keys], key=str); actual = sorted([c["conductor"] for c in cap["comparisons"]], key=str)
        if actual != expected: V.append("I-21 exact verdict must compare every operative conductor exactly once")
        for c in cap["comparisons"]:
            k = "measured" if c["conductor"] is None else c["conductor"]
            if k not in vals or c["demandValueRaw"] != vals[k]: V.append("I-21 comparison does not use its terminal conductor total")
    return V

if __name__ == "__main__":
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    from mini_jsonschema_r2 import Validator, load_strict
    schema = load_strict(open(sys.argv[1]).read()); cases = load_strict(open(sys.argv[2]).read())["cases"]
    v = Validator(schema); RES = schema["$defs"]["LoadCalcResult"]; tot = ok = skipped = 0; bad = []
    for c in cases:
        e = c.get("expected")
        if isinstance(e, dict) and "status" in e and c["kind"] != "math_model":
            tot += 1; se = v.errors(e, RES); iv = check_result(e, c.get("envelope"))
            if se or iv: bad.append((c["id"], se[:3], iv[:5]))
            else: ok += 1
        else: skipped += 1
        for i, t in enumerate(c.get("then") or []):
            tot += 1; se = v.errors(t["expected"], RES); iv = check_result(t["expected"], t.get("envelope"))
            if se or iv: bad.append((f"{c['id']}/then[{i}]", se[:3], iv[:5]))
            else: ok += 1
    print(f"(skipped {skipped} cases without a LoadCalcResult expectation: math models, pending null, layer tests, future sequences)")
    print(f"invariant+schema check of expected results (bound to their envelopes): {ok}/{tot} pass")
    for b in bad: print("VIOLATION", b)
    sys.exit(1 if bad else 0)
