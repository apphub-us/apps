#!/usr/bin/env python3
"""loadcalc-contract-check.py — B1 external-check adapter (test tool only; no runtime Python).

Usage: python3 tools/loadcalc-contract-check.py <proof-dir>

Reads <proof-dir>/actual-pairs.json written by tools/loadcalc-core-check.js
(the REAL engine's (envelope, result) pairs) and checks every actual result with
the UNCHANGED reviewed oracles copied under test/fixtures/loadCalc/:
  * schema r21 (draft 2020-12): a full Draft202012Validator when python-jsonschema
    is importable; otherwise the included mini_jsonschema_r2 SUBSET validator with
    its declared limits (reported as such — full validation then stays pending
    the reviewer's execution). Nothing is installed.
  * L4  contract_invariants_r22.check_result(result, envelope)
  * reviewer cross-check operative_graph_review.check_operative_graph(envelope, result)
Oracle regressions (checker side, unchanged pairs): review/targeted-closure-pairs
(4 bad graph pairs must stay rejected; positive controls accepted; CONTROL_T-N-17
rejected by I-13 by design), negative-pairs-r22 and mutants-r2-on-r22 (recorded
rejection layer reproduced). Writes <proof-dir>/contract-check.json.
Exit 1 if any ACTUAL engine result violates schema / L4 / graph, or an oracle
regression changes."""
import json, os, sys, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FIX = os.path.join(ROOT, "test", "fixtures", "loadCalc")
sys.path.insert(0, FIX)
from mini_jsonschema_r2 import Validator, load_strict  # noqa: E402
from contract_invariants_r22 import check_result  # noqa: E402
from operative_graph_review import check_operative_graph  # noqa: E402

PINS = {"EC-CALC-2-A3-schema-r21.json": "a0d54e51ce14708544783648ec0edffa329cb261d85c6fafe66a7f0c58939c2f",
        "contract_invariants_r22.py": "9dde880890cd369cdda213281a7dd8d7f452628d2229653479b71344eacce114",
        "operative_graph_review.py": "4f314ef9cd3f416f748e84583f2c04069ff173deccfa7a0b669d692d542c90a2",
        "EC-CALC-2-A3-test-cases-r22.json": "ec9f95f63c680d315dd3e5b827c61e183ee299b8babe73dea604bc884230703e"}

def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()

def main():
    if len(sys.argv) != 2:
        print(__doc__); sys.exit(2)
    proof = os.path.abspath(sys.argv[1])
    for name, pin in PINS.items():
        actual = sha(os.path.join(FIX, name))
        if actual != pin:
            print(f"STOP: oracle {name} changed ({actual})"); sys.exit(2)
    schema = load_strict(open(os.path.join(FIX, "EC-CALC-2-A3-schema-r21.json")).read())
    RES, ENV, INP = schema["$defs"]["LoadCalcResult"], schema["$defs"]["RequestEnvelope"], schema["$defs"]["LoadCalcInput"]
    full = None
    try:
        import jsonschema  # noqa: F401
        from jsonschema import Draft202012Validator
        Draft202012Validator.check_schema(schema)
        def mk(sub):
            s = dict(sub); s["$defs"] = schema["$defs"]; return Draft202012Validator(s)
        vres, venv, vinp = mk(RES), mk(ENV), mk(INP)
        full = f"python-jsonschema {jsonschema.__version__} Draft202012Validator"
        def errs(inst, which):
            v = {"result": vres, "envelope": venv, "input": vinp}[which]
            return [e.message for e in v.iter_errors(inst)]
    except ImportError:
        mini = Validator(schema)
        def errs(inst, which):
            return mini.errors(inst, {"result": RES, "envelope": ENV, "input": INP}[which])
    validator_note = full or "mini_jsonschema_r2 (declared draft-2020-12 SUBSET; full validation pending reviewer execution with python-jsonschema)"

    pairs = load_strict(open(os.path.join(proof, "actual-pairs.json")).read())
    rows = []; bad = 0
    for p in pairs:
        r = p["result"]; e = p["envelope"]
        if r is None:
            rows.append({"id": p["id"], "schema": ["no result (engine threw)"], "invariants": [], "graph": [], "ok": False}); bad += 1; continue
        se = errs(r, "result"); ee = errs(e, "envelope")
        iv = check_result(r, e) if not se else ["schema invalid: L4 not run"]
        gr = check_operative_graph(e, r)
        ok = not se and not ee and not iv and not gr
        rows.append({"id": p["id"], "schema": se[:5], "envelopeSchema": ee[:5], "invariants": iv[:8], "graph": gr[:5], "ok": ok, "exactMatchToLiteral": p.get("exactMatch"), "differsOnlyOnIsolatedField": p.get("differsOnlyOnIsolatedField")})
        if not ok: bad += 1

    # oracle regressions (unchanged pairs, checker side)
    tp = load_strict(open(os.path.join(FIX, "targeted-closure-pairs.json")).read())
    targeted = []
    for t in tp:
        se = errs(t["result"], "result"); iv = [] if se else check_result(t["result"], t["envelope"]); gr = check_operative_graph(t["envelope"], t["result"])
        layer = "schema" if se else ("invariant" if iv else "ACCEPTED")
        expected_rejected = t["classification"] == "negative" or t["id"] == "CONTROL_T-N-17"
        targeted.append({"id": t["id"], "classification": t["classification"], "layer": layer, "firstViolation": (iv[:1] or se[:1] or None), "graph": gr[:1], "asExpected": (layer != "ACCEPTED") == expected_rejected})
    neg = load_strict(open(os.path.join(FIX, "negative-pairs-r22.json")).read())
    mut = load_strict(open(os.path.join(FIX, "mutants-r2-on-r22.json")).read())
    def replay(items):
        out = []
        for it in items:
            env = it.get("envelope"); res = it.get("result")
            if res is None or env is None:
                out.append({"id": it["id"], "recorded": it.get("rejectedBy"), "replayed": "no pair embedded", "asExpected": True}); continue
            se = errs(res, "result"); iv = [] if se else check_result(res, env)
            layer = "schema" if se else ("invariant" if iv else "accepted")
            rec = it.get("rejectedBy", "")
            expect = "schema" if rec.startswith("schema") else ("invariant" if rec.startswith("invariant") else ("accepted" if rec.startswith("accepted") else "L3-specified"))
            out.append({"id": it["id"], "recorded": rec, "replayed": layer, "asExpected": expect == "L3-specified" or expect == layer})
        return out
    negrep = replay(neg); mutrep = replay(mut)

    report = {"validator": validator_note, "actualPairs": len(pairs), "actualPairsOk": len(pairs) - bad, "actualPairsViolating": [r for r in rows if not r["ok"]],
              "rows": rows, "targetedClosurePairs": targeted, "negativePairsR22": negrep, "mutantsR2onR22": mutrep,
              "note": "checks of ACTUAL engine outputs; L4/schema validity is not an arithmetic proof and never replaces the literal comparison"}
    json.dump(report, open(os.path.join(proof, "contract-check.json"), "w"), indent=1)
    print(f"validator: {validator_note}")
    print(f"actual engine pairs: {len(pairs)} | schema+L4+graph clean: {len(pairs) - bad} | violating: {bad}")
    for r in rows:
        if not r["ok"]: print("VIOLATION", r["id"], r["schema"][:1], r["invariants"][:2], r["graph"][:1])
    print("targeted closure pairs:", ", ".join(f"{t['id']}->{t['layer']}{'' if t['asExpected'] else ' (UNEXPECTED)'}" for t in targeted))
    print(f"negative-pairs-r22 replay as recorded: {sum(1 for x in negrep if x['asExpected'])}/{len(negrep)} | mutants-r2-on-r22 replay as recorded: {sum(1 for x in mutrep if x['asExpected'])}/{len(mutrep)}")
    regress = any(not t["asExpected"] for t in targeted) or any(not x["asExpected"] for x in negrep + mutrep)
    sys.exit(1 if bad or regress else 0)

if __name__ == "__main__":
    main()
