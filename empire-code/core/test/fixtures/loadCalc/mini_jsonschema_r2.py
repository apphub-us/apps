#!/usr/bin/env python3
"""mini_jsonschema_r2 — dependency-free JSON Schema draft 2020-12 SUBSET validator (EC-CALC-2 / A3 r2).

Declared subset (anything else in a schema is ignored and reported by `unsupported_keywords`):
  type, enum, const, properties, required, additionalProperties (bool), items, minItems, maxItems, contains,
  minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern (re.search),
  anyOf, oneOf, allOf, not, if/then/else, $ref (local "#/..." pointers only), $defs.
Data-model rules (aligned with the JSON data model, fixed after the r1 review):
  * integer = number with zero fractional part (3.0 is an integer);
  * booleans are NOT numbers and never equal numeric enum/const members (True != 1 here);
  * strict JSON ingress: `load_strict` rejects NaN / Infinity / -Infinity tokens and duplicate keys.
This is NOT a full-conformance validator. The independent reviewer re-validates with python-jsonschema.
"""
import json, math, re, sys

SUPPORTED = {"type", "enum", "const", "properties", "required", "additionalProperties", "items", "minItems", "maxItems",
             "contains", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern",
             "anyOf", "oneOf", "allOf", "not", "if", "then", "else", "$ref", "$defs", "$schema", "$id", "$comment", "title",
             "description", "default", "examples"}

def _reject_constant(name):
    raise ValueError(f"non-JSON constant {name!r} rejected by strict ingress")
def _no_dupes(pairs):
    d = {}
    for k, v in pairs:
        if k in d: raise ValueError(f"duplicate key {k!r}")
        d[k] = v
    return d
def load_strict(text):
    """json.loads that rejects NaN/Infinity/-Infinity and duplicate object keys."""
    return json.loads(text, parse_constant=_reject_constant, object_pairs_hook=_no_dupes)

def _is_num(v): return isinstance(v, (int, float)) and not isinstance(v, bool)
def _jeq(a, b):
    """JSON equality: booleans never equal numbers; numbers compare by value; containers recurse."""
    if isinstance(a, bool) or isinstance(b, bool): return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_num(a) and _is_num(b): return a == b
    if isinstance(a, list) and isinstance(b, list): return len(a) == len(b) and all(_jeq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict): return a.keys() == b.keys() and all(_jeq(a[k], b[k]) for k in a)
    if _is_num(a) or _is_num(b) or isinstance(a, (list, dict)) or isinstance(b, (list, dict)): return False
    return a == b

class Validator:
    def __init__(self, schema):
        self.root = schema; self.unsupported_keywords = set(); self._scan(schema)
    def _scan(self, node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k not in SUPPORTED and k not in ("properties",): self.unsupported_keywords.add(k)
                if k in ("properties", "$defs") and isinstance(v, dict):
                    for sub in v.values(): self._scan(sub)
                elif k in ("items", "contains", "not", "if", "then", "else", "additionalProperties"): self._scan(v)
                elif k in ("anyOf", "oneOf", "allOf") and isinstance(v, list):
                    for sub in v: self._scan(sub)
    def _resolve(self, ref):
        if not ref.startswith("#/"): raise ValueError(f"only local refs supported: {ref}")
        node = self.root
        for part in ref[2:].split("/"):
            node = node[part.replace("~1", "/").replace("~0", "~")]
        return node
    @staticmethod
    def _is_type(v, t):
        if t == "null": return v is None
        if t == "boolean": return isinstance(v, bool)
        if t == "integer": return _is_num(v) and math.isfinite(v) and float(v).is_integer()
        if t == "number": return _is_num(v) and math.isfinite(v)
        if t == "string": return isinstance(v, str)
        if t == "array": return isinstance(v, list)
        if t == "object": return isinstance(v, dict)
        raise ValueError(t)
    def errors(self, inst, schema=None, path="$"):
        if schema is None: schema = self.root
        if schema is True: return []
        if schema is False: return [f"{path}: schema false"]
        e = []
        if "$ref" in schema: e += self.errors(inst, self._resolve(schema["$ref"]), path)
        if "type" in schema:
            ts = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(self._is_type(inst, t) for t in ts): e.append(f"{path}: type {ts} expected, got {type(inst).__name__} {inst!r}"[:160])
        if "enum" in schema and not any(_jeq(inst, m) for m in schema["enum"]): e.append(f"{path}: {inst!r} not in enum"[:160])
        if "const" in schema and not _jeq(inst, schema["const"]): e.append(f"{path}: const {schema['const']!r} expected, got {inst!r}"[:160])
        if isinstance(inst, dict):
            props = schema.get("properties", {})
            for k, sub in props.items():
                if k in inst: e += self.errors(inst[k], sub, f"{path}.{k}")
            for k in schema.get("required", []):
                if k not in inst: e.append(f"{path}: missing required {k}")
            ap = schema.get("additionalProperties", True)
            if ap is False:
                for k in inst:
                    if k not in props: e.append(f"{path}: additional property {k}")
            elif isinstance(ap, dict):
                for k in inst:
                    if k not in props: e += self.errors(inst[k], ap, f"{path}.{k}")
        if isinstance(inst, list):
            if "items" in schema:
                for i, x in enumerate(inst): e += self.errors(x, schema["items"], f"{path}[{i}]")
            if "minItems" in schema and len(inst) < schema["minItems"]: e.append(f"{path}: minItems {schema['minItems']}")
            if "maxItems" in schema and len(inst) > schema["maxItems"]: e.append(f"{path}: maxItems {schema['maxItems']}")
            if "contains" in schema and not any(not self.errors(x, schema["contains"], path) for x in inst): e.append(f"{path}: contains failed")
        if _is_num(inst):
            if "minimum" in schema and inst < schema["minimum"]: e.append(f"{path}: minimum {schema['minimum']}")
            if "maximum" in schema and inst > schema["maximum"]: e.append(f"{path}: maximum {schema['maximum']}")
            if "exclusiveMinimum" in schema and inst <= schema["exclusiveMinimum"]: e.append(f"{path}: exclusiveMinimum")
            if "exclusiveMaximum" in schema and inst >= schema["exclusiveMaximum"]: e.append(f"{path}: exclusiveMaximum")
        if isinstance(inst, str):
            if "minLength" in schema and len(inst) < schema["minLength"]: e.append(f"{path}: minLength")
            if "maxLength" in schema and len(inst) > schema["maxLength"]: e.append(f"{path}: maxLength")
            if "pattern" in schema and not re.search(schema["pattern"], inst): e.append(f"{path}: pattern")
        if "allOf" in schema:
            for s in schema["allOf"]: e += self.errors(inst, s, path)
        if "anyOf" in schema and not any(not self.errors(inst, s, path) for s in schema["anyOf"]): e.append(f"{path}: anyOf failed")
        if "oneOf" in schema:
            n = sum(1 for s in schema["oneOf"] if not self.errors(inst, s, path))
            if n != 1: e.append(f"{path}: oneOf matched {n}")
        if "not" in schema and not self.errors(inst, schema["not"], path): e.append(f"{path}: not-schema matched")
        if "if" in schema:
            if not self.errors(inst, schema["if"], path):
                if "then" in schema: e += self.errors(inst, schema["then"], path)
            elif "else" in schema: e += self.errors(inst, schema["else"], path)
        return e

def self_test():
    """Self-test of the declared subset incl. the three reviewer divergences. Returns list of (name, passed)."""
    v = Validator({})
    cases = [
        ("INTEGER_3_POINT_0 accepted as integer", not v.errors(3.0, {"type": "integer"})),
        ("INTEGER_2_5 rejected as integer", bool(v.errors(2.5, {"type": "integer"}))),
        ("BOOLEAN not in numeric enum [1,3,null]", bool(v.errors(True, {"enum": [1, 3, None]}))),
        ("BOOLEAN is not a number", bool(v.errors(True, {"type": "number"}))),
        ("1 is in enum [1,3,null]", not v.errors(1, {"enum": [1, 3, None]})),
        ("null is in enum [1,3,null]", not v.errors(None, {"enum": [1, 3, None]})),
        ("Infinity rejected as number by type check", bool(v.errors(float("inf"), {"type": "number"}))),
        ("NaN rejected as number by type check", bool(v.errors(float("nan"), {"type": "number"}))),
        ("strict ingress rejects NaN token", (lambda: (lambda: load_strict('{"a": NaN}'))() and False)() if False else _raises(lambda: load_strict('{"a": NaN}'))),
        ("strict ingress rejects Infinity token", _raises(lambda: load_strict('[Infinity]'))),
        ("strict ingress rejects duplicate keys", _raises(lambda: load_strict('{"a":1,"a":2}'))),
        ("const true != 1", bool(v.errors(1, {"const": True}))),
        ("not: value matching not-schema rejected", bool(v.errors("x", {"not": {"const": "x"}}))),
        ("contains: array without match rejected", bool(v.errors([1, 2], {"contains": {"const": 3}}))),
        ("contains: array with match accepted", not v.errors([1, 3], {"contains": {"const": 3}})),
        ("minimum 0 rejects -1", bool(v.errors(-1, {"minimum": 0}))),
        ("if/then applies", bool(v.errors({"a": 1, "b": 2}, {"if": {"properties": {"a": {"const": 1}}}, "then": {"properties": {"b": {"const": 3}}}}))),
        ("local $ref resolves", not Validator({"$defs": {"x": {"type": "string"}}}).errors("s", {"$ref": "#/$defs/x"})),
    ]
    return cases
def _raises(fn):
    try: fn()
    except ValueError: return True
    return False

if __name__ == "__main__":
    if len(sys.argv) == 1:
        res = self_test()
        for n, ok in res: print(("PASS" if ok else "FAIL"), n)
        sys.exit(0 if all(ok for _, ok in res) else 1)
    schema = load_strict(open(sys.argv[1]).read()); inst = load_strict(open(sys.argv[2]).read())
    v = Validator(schema); errs = v.errors(inst, schema if len(sys.argv) < 4 else v._resolve(sys.argv[3]))
    if v.unsupported_keywords: print("UNSUPPORTED KEYWORDS IGNORED:", sorted(v.unsupported_keywords))
    print("\n".join(errs) if errs else "VALID"); sys.exit(1 if errs else 0)
