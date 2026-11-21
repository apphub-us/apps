#!/usr/bin/env python3
"""
contract_invariants_82.py — independent L4 checker for engine B82_core1 (LC-22082-B0-CORE-1, revision R1).

Usage:
  python3 tools/contract_invariants_82.py <pairs.json> [--out <report.json>]
  python3 tools/contract_invariants_82.py <pairs.json> --mutants [--out <report.json>]

pairs.json = {"pairs": [{"id", "assumptions": {"engineRuleStatus": "default" | {"220.82"|"S-11a": "pending"}}, "request", "result"}]}

Principle: every expectation is derived from the REQUEST and the settled rules — never from the submitted
result's own percent/threshold/status/factor fields. A submitted factor is not an authority. Each line ROLE is
bound to a fixed template (op, constants, unit, allowed predecessor edges, permitted record categories); bindings
are compared as complete sets in both directions; coverage, problems and every inactive layer are compared as
whole expectations for each family; nothing returns early. Structural shape is validated against
test/fixtures/loadCalc/EC-CALC-2-B82-schema-r1.json with the inherited subset validator (mini_jsonschema_r2).
No engine import, no tolerance. Sources: R2 §2.7, R2-CLOSE-1 §2/§3, R2-CLOSE-2 §2, ERRATA-1 §2 + ERRATA-1a,
B0-PREMISES-1(-R1, -R1-CLOSE-1), DECISION-1, CORE-1-R1 M1–M4.
"""
import json, sys, copy, os
from decimal import Decimal

E4 = 10000
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..')); FIX = os.path.join(ROOT, 'test', 'fixtures', 'loadCalc')
sys.path.insert(0, FIX)
_SCHEMA_ERR = None
try:
    from mini_jsonschema_r2 import Validator as _Validator
    _S = json.load(open(os.path.join(FIX, 'EC-CALC-2-B82-schema-r1.json')))
    V_REQ = _Validator({**_S, 'oneOf': [{'$ref': '#/$defs/RequestV2'}]}); V_RES = _Validator({**_S, 'oneOf': [{'$ref': '#/$defs/LoadCalcResult'}]})
except Exception as _e:   # the checker still runs its own checks; the missing schema validation is reported as a violation of every pair
    V_REQ = V_RES = None; _SCHEMA_ERR = repr(_e)

RULE_DEFAULT = {'220.82': 'verified', 'S-11a': 'verified', 'I-82-1': 'pending', 'I-82-2': 'pending', 'I-82-3': 'pending', 'I-82-4': 'pending', 'I-82-5': 'pending'}
TEST_PENDING_KEYS = ('220.82', 'S-11a')
B_GROUP = ('range', 'oven', 'cooktop', 'dryer', 'water_heater', 'dishwasher', 'appliance_fixed_other')
PRED = {'dryer': 'b3c_dryer_not_on_counted_laundry_circuit', 'dishwasher': 'b3a_fixed_or_specific_circuit', 'appliance_fixed_other': 'b3a_fixed_or_specific_circuit'}
ENABLED_ARR = ('ac_only',); SUPPORTED_TOPO = ('1ph_3w_120_240', '1ph_3w_120_208_network')
SUPPLY = {'1ph_2w_120': (120, 120, 1, 2), '1ph_2w_240': (240, None, 1, 2), '1ph_3w_120_240': (240, 120, 1, 3), '1ph_3w_120_208_network': (208, 120, 1, 3), '3ph_4w_208Y_120': (208, 120, 3, 4), '3ph_4w_480Y_277': (480, 277, 3, 4), '3ph_3w_480_delta': (480, None, 3, 3), '3ph_3w_240_delta': (240, None, 3, 3), '3ph_4w_240_delta_highleg': (240, 120, 3, 4)}
INVALID = {'NOT_FINITE', 'OUT_OF_RANGE', 'NOT_INTEGER', 'UNKNOWN_ENUM', 'LEGACY_AMBIGUOUS', 'UNSUPPORTED_RATING_KIND', 'SUPPLY_INCONSISTENT', 'LEG_INVALID', 'CONNECTION_INVALID', 'COVERS_UNKNOWN_LOAD', 'PARSE_REJECTED', 'DUPLICATE_ID', 'RESOLUTION_EXCEEDED', 'HVAC_ARRANGEMENT_INCONSISTENT'}
INCOMPLETE = {'MISSING_FIELD', 'QUALIFICATION_UNKNOWN', 'PREMISE_STALE', 'INVENTORY_INCOMPLETE_DECLARED', 'IMPORTED_METHOD_UNCONFIRMED'}
RESULT_KEYS = ['schemaVersion', 'ruleBasis', 'profileId', 'status', 'problems', 'loadsCoverage', 'demand', 'current', 'existingCapacity', 'requiredCapacity', 'rating', 'diagnostics', 'display', 'presentation', 'references']
LINE_KEYS = ['id', 'label', 'op', 'operands', 'factor', 'unitFactor', 'percent', 'threshold', 'selected', 'controlUnitsRef', 'divisorV', 'powerFactor', 'conductor', 'bindings', 'result', 'ruleRef', 'amended', 'ruleStatus', 'loadIds']
CAP = 10000 * E4
# Fixed role templates: op, constants, ruleRef, allowed predecessor refs (edges), record categories that may be bound
ROLES = {
    'b1_area':        dict(op='multiply_unit', unitFactor={'value': 3, 'unit': 'VA_per_ft2'}, percent=None, threshold=None, cats=None, ruleRef='220.82(B)(1)'),
    'b2_circuits':    dict(op='multiply_unit', unitFactor={'value': 1500, 'unit': 'VA_per_count'}, percent=None, threshold=None, cats=None, ruleRef='220.82(B)(2)'),
    'b3_appliances':  dict(op='sum', unitFactor=None, percent=None, threshold=None, cats=B_GROUP, ruleRef='220.82(B)(3)'),
    'gen_connected':  dict(op='sum', unitFactor=None, percent=None, threshold=None, cats=None, ruleRef='220.82(B)'),
    'gen_tier1':      dict(op='min_cap', unitFactor=None, percent=None, threshold={'value': 10000, 'unit': 'VA', 'exactE4': CAP}, cats=None, ruleRef='220.82(B)'),
    'gen_excess':     dict(op='excess_over', unitFactor=None, percent=None, threshold={'value': 10000, 'unit': 'VA', 'exactE4': CAP}, cats=None, ruleRef='220.82(B)'),
    'gen_tier2':      dict(op='multiply_percent', unitFactor=None, percent=40, threshold=None, cats=None, ruleRef='220.82(B)'),
    'gen_demand':     dict(op='sum', unitFactor=None, percent=None, threshold=None, cats=None, ruleRef='220.82(B)'),
    'ac_connected':   dict(op='sum', unitFactor=None, percent=None, threshold=None, cats=('ac',), ruleRef='220.82(C)(1)'),
    'c1_ac':          dict(op='multiply_percent', unitFactor=None, percent=100, threshold=None, cats=None, ruleRef='220.82(C)(1)'),
    'hvac_governing': dict(op='max_of', unitFactor=None, percent=None, threshold=None, cats=None, ruleRef='220.82(C)'),
    'total':          dict(op='sum', unitFactor=None, percent=None, threshold=None, cats=None, ruleRef='220.82(A)'),
}

def encode_e4(x):
    if isinstance(x, bool) or not isinstance(x, (int, float)): return None, 'L2'
    d = Decimal(repr(float(x)))
    if d < 0: return None, 'OUT_OF_RANGE'
    s = format(d.normalize(), 'f'); frac = len(s.split('.')[1]) if '.' in s else 0
    if frac > 2: return None, 'RESOLUTION_EXCEEDED'
    if d > 1000000: return None, 'OUT_OF_RANGE'
    return int(d * E4), None
def canonical(n):
    q, r = divmod(n, E4); s = f'{r:04d}'.rstrip('0'); return float(f'{q}.{s}') if s else q
def display_va(n):
    q, r = divmod(n, E4); q += 1 if r >= 5000 else 0; return f'{q:,} VA'
def format_number(x, d):
    """Independent re-implementation of the accepted A display policy (loadCalc.js formatNumber, read-only reference):
    round half away from zero on the shortest decimal representation of the raw double, then group thousands."""
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(repr(float(x))).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    return f'{q:,.{d}f}'
def display_amps(x): return format_number(x, 1) + ' A'
TOPOLOGY_LABEL = {'1ph_2w_120': '120 V, 1-ph, 2-wire', '1ph_2w_240': '240 V, 1-ph, 2-wire', '1ph_3w_120_240': '120/240 V, 1-ph, 3-wire', '1ph_3w_120_208_network': '120/208 V, 1-ph, 3-wire (network)', '3ph_4w_208Y_120': '208Y/120 V, 3-ph, 4-wire', '3ph_4w_480Y_277': '480Y/277 V, 3-ph, 4-wire', '3ph_3w_480_delta': '480 V delta, 3-ph, 3-wire', '3ph_3w_240_delta': '240 V delta, 3-ph, 3-wire', '3ph_4w_240_delta_highleg': '240 V delta (high leg), 3-ph, 4-wire'}
def ptuple(p): return (p['code'], p['field'], p['layer'], p['source'], p.get('ruleRef'))   # Q2: the full contractual problem identity

def rule_config(pair, R):
    """External test-configuration contract (M4): 'default' or a non-escalating pending map over the verified core rules only."""
    rule = dict(RULE_DEFAULT); a = pair.get('assumptions', {}).get('engineRuleStatus', 'default')
    if a == 'default': return rule
    if not isinstance(a, dict): R.fail('assumptions.engineRuleStatus must be "default" or an object'); return rule
    for k, v in a.items():
        if k not in TEST_PENDING_KEYS or v != 'pending': R.fail(f'test configuration may only set {TEST_PENDING_KEYS} to pending (got {k}={v!r})'); continue
        rule[k] = 'pending'
    return rule

def active_error(s, field):
    """M2/N2b: a parser error is active only for a slot the current method/category/arrangement requires."""
    if field.startswith('measurement.') or field.startswith('multifamily.') or field.startswith('method.guideAnswers.'): return False
    if field == 'hvac.supplementalInterlocked': return s['hvac']['arrangement'] == 'heat_pump_with_supplemental'   # SPEC-R2 §2.3 applicability
    if field == 'hvac.installingAdditionalHvac': return False                                                     # retained 220.83 datum, unused by 82
    if not field.startswith('loads['): return True
    idx = int(field[6:field.index(']')]); sub = field[field.index(']') + 2:]
    if idx >= len(s['loads']): return False
    l = s['loads'][idx]
    if sub == 'inclusion82':
        exp = PRED.get(l['category'])
        if not exp: return False
        return not (isinstance(l['inclusion82'], dict) and l['inclusion82']['predicate'] != exp)
    if sub == 'ratingCoverage82': return l['category'] == 'ac'
    if sub == 'separatelyControlledUnits': return l['category'] == 'electric_space_heat'
    return True

def expected_presentation(req, complete):
    """N3: presentation derived from the request/model/family, never read from the result."""
    topo = req['snapshot']['supply']['topology']
    label = TOPOLOGY_LABEL[topo] if topo in TOPOLOGY_LABEL else ''
    poles = '2-pole' if topo in ('1ph_3w_120_240', '1ph_3w_120_208_network') else ('3-pole' if isinstance(topo, str) and topo.startswith('3ph') else None)
    return {'topologyLabel': label, 'showPerConductor': topo in ('1ph_3w_120_240', '1ph_3w_120_208_network'), 'polesLabel': poles, 'finalResultHeading': complete, 'verdictLabel': 'not_assessed' if complete else None}

class Report:
    def __init__(self): self.v = []
    def fail(self, m): self.v.append(m)

# Canonical parse-error paths (closed set; mirrors the V2 L2 rule independently — exact paths, canonical indices resolving to a record)
SCALAR_PATHS = {
    'occupancy', 'purpose', 'supply.topology', 'loadModel.kind', 'method.selected',
    'method.guideAnswers.houseFeeder', 'method.guideAnswers.aptFeeder', 'method.guideAnswers.houseState', 'method.guideAnswers.bldgCooking',   # N2a: accepted A LC_FIELDS guide keys
    'dwelling.floorAreaFt2', 'dwelling.smallApplianceCircuits', 'dwelling.laundryCircuits', 'dwelling.nycAcCircuitCount', 'dwelling.existingDwelling',
    'hvac.arrangement', 'hvac.supplementalInterlocked', 'hvac.installingAdditionalHvac',
    'optional82.singleSupplySet', 'optional82.conductorAmpacityA.value', 'optional82.nycAcCentralExceptionAttested', 'optional82.laundryExceptionAttested', 'optional82.inventoryComplete',
    'measurement.basis', 'measurement.reading.value', 'measurement.reading.unit', 'measurement.readingsPerConductor.L1', 'measurement.readingsPerConductor.L2', 'measurement.readingsPerConductor.L3',
    'measurement.readingScope', 'measurement.powerFactor', 'measurement.annualDataAvailable', 'measurement.periodMonths', 'measurement.periodDays', 'measurement.intervalMinutes', 'measurement.metric',
    'measurement.continuousRecording', 'measurement.instrument', 'measurement.connectedTo', 'measurement.basedOnInitialLoading', 'measurement.recordedWhileOccupied', 'measurement.includesLargerOfHeatingOrCooling',
    'measurement.includesPeriodicSeasonalLoads', 'measurement.hasRenewableEnergySystem', 'measurement.hasPeakLoadShaving',
    'measurement.existing.serviceRatingA', 'measurement.existing.feederAmpacityA', 'measurement.existing.ocpdA', 'measurement.existing.feederOcpPer240_4', 'measurement.existing.serviceOverloadPer230_90',
    'measurement.newLoad.mode', 'measurement.newLoad.precalculated.va', 'measurement.newLoad.precalculated.connection', 'measurement.newLoad.precalculated.leg', 'measurement.newLoad.precalculated.continuous',
    'measurement.newLoad.precalculated.covers', 'measurement.newLoad.precalculated.basis.method', 'measurement.newLoad.precalculated.basis.ruleRefs', 'measurement.newLoad.precalculated.basis.demandFactorsApplied',
    'measurement.newLoad.precalculated.basis.continuousFactorApplied', 'measurement.newLoad.precalculated.basis.establishedForThisComparison', 'measurement.newLoad.precalculated.basis.calculatedBy',
    'multifamily.unitCount', 'multifamily.unitsIdentical', 'multifamily.allUnitsElectricCooking', 'multifamily.allUnitsElectricHeatOrAc', 'multifamily.singleFeederPerUnit', 'multifamily.houseLoads.mode', 'multifamily.houseLoads.va',
}
LOAD_FIELDS = {'rating.value', 'quantity', 'separatelyControlledUnits', 'category', 'status', 'continuous', 'connection', 'leg', 'inclusion82', 'ratingCoverage82'}
import re as _re
LOAD_PATH_RE = _re.compile(r'^loads\[(0|[1-9][0-9]*)\]\.([A-Za-z0-9_.]+)$')
def parse_path_problem(field, snapshot):
    if not isinstance(field, str): return 'not a string'
    if field in SCALAR_PATHS: return None
    m = LOAD_PATH_RE.match(field)
    if not m: return 'not a canonical V2 field path'
    if m.group(2) not in LOAD_FIELDS: return 'not a canonical load field'
    if int(m.group(1)) >= len(snapshot.get('loads', [])): return 'load index does not resolve to a record of this snapshot'
    return None

def derive(req, rule):
    """Independent stage-1 derivation → (problems, extras)."""
    s = req['snapshot']; ctx = req['context']; probs = []; parsed = set()
    for pe in req['parseErrors']:
        if active_error(s, pe['field']): parsed.add(pe['field']); probs.append((pe['code'], pe['field'], 'input', 'parser', None))   # Q1: a transported failure carries no engine citation
    def add(c, f, rule_ref='__default__'): probs.append((c, f, 'input', 'engine', engine_rule_ref(c, f) if rule_ref == '__default__' else rule_ref))
    if s['method']['selected'] != 'opt_220_82': add('CAPABILITY_DISABLED', 'method.selected')
    if 'occupancy' not in parsed:
        if s['occupancy'] is None: add('MISSING_FIELD', 'occupancy')
        elif s['occupancy'] not in ('dwelling_unit_house', 'dwelling_unit_apartment'): add('SCOPE_UNSUPPORTED', 'occupancy')
    if rule['220.82'] != 'verified': add('RULE_PENDING', 'method.selected')
    if rule['S-11a'] != 'verified': add('RULE_PENDING', 'dwelling.smallApplianceCircuits')
    arr_known = 'hvac.arrangement' not in parsed
    if arr_known:
        a = s['hvac']['arrangement']
        if a is None: add('MISSING_FIELD', 'hvac.arrangement')
        elif a not in ENABLED_ARR: add('CAPABILITY_DISABLED', 'hvac.arrangement')
    topo = s['supply']['topology']
    if 'supply.topology' not in parsed:
        if topo is None: add('QUALIFICATION_UNKNOWN', 'supply.topology')
        elif topo == 'other': add('SCOPE_UNSUPPORTED', 'supply.topology')
        elif topo not in SUPPORTED_TOPO: add('QUALIFICATION_FAILED', 'supply.topology')
    o = s['optional82']
    for k in ('singleSupplySet', 'conductorAmpacityA', 'nycAcCentralExceptionAttested', 'laundryExceptionAttested', 'inventoryComplete'):   # N1: 82-only declarations require provenance.source (L2; a request lacking it can never have an accepted pair)
        d = o.get(k)
        if not isinstance(d, dict) or not isinstance(d.get('provenance'), dict) or not isinstance(d['provenance'].get('source'), str): add('STRUCTURAL_L2_VIOLATION', f'optional82.{k}.provenance')
    if 'optional82.singleSupplySet' not in parsed:
        v = o['singleSupplySet']['value']
        if v is None: add('QUALIFICATION_UNKNOWN', 'optional82.singleSupplySet')
        elif v is False: add('QUALIFICATION_FAILED', 'optional82.singleSupplySet')
    if 'optional82.conductorAmpacityA.value' not in parsed:
        v = o['conductorAmpacityA']['value']
        if v is None: add('QUALIFICATION_UNKNOWN', 'optional82.conductorAmpacityA')
        else:
            e, err = encode_e4(v)
            if err: add(err, 'optional82.conductorAmpacityA.value')
            elif e < 100 * E4: add('QUALIFICATION_FAILED', 'optional82.conductorAmpacityA')
    d = s['dwelling']; area = sa = la = None
    if 'dwelling.floorAreaFt2' not in parsed:
        v = d['floorAreaFt2']
        if v is None: add('MISSING_FIELD', 'dwelling.floorAreaFt2')
        elif isinstance(v, bool) or not float(v).is_integer(): add('NOT_INTEGER', 'dwelling.floorAreaFt2')
        elif v < 1 or v > 1000000: add('OUT_OF_RANGE', 'dwelling.floorAreaFt2')
        else: area = int(v)
    if 'dwelling.smallApplianceCircuits' not in parsed:
        v = d['smallApplianceCircuits']
        if v is None: add('MISSING_FIELD', 'dwelling.smallApplianceCircuits')
        elif v < 2: add('OUT_OF_RANGE', 'dwelling.smallApplianceCircuits', '210.11(C)(1)')   # Q1: source-cited minimum (S-11a)
        elif v > 100: add('OUT_OF_RANGE', 'dwelling.smallApplianceCircuits', None)            # Q1: product numeric-domain maximum, not a NEC rule
        else: sa = v
    if 'dwelling.laundryCircuits' not in parsed:
        v = d['laundryCircuits']
        if v is None: add('MISSING_FIELD', 'dwelling.laundryCircuits')
        elif v < 0 or v > 100: add('OUT_OF_RANGE', 'dwelling.laundryCircuits')
        else:
            la = v
            if v == 0 and rule['I-82-2'] != 'verified': add('RULE_PENDING', 'dwelling.laundryCircuits')
    if 'dwelling.nycAcCircuitCount' not in parsed:
        v = d['nycAcCircuitCount']
        if v is None: add('MISSING_FIELD', 'dwelling.nycAcCircuitCount')
        elif v < 0 or v > 100: add('OUT_OF_RANGE', 'dwelling.nycAcCircuitCount')
        elif rule['I-82-1'] != 'verified' and (v > 0 or o['nycAcCentralExceptionAttested']['value'] is not True): add('RULE_PENDING', 'dwelling.nycAcCircuitCount')
    loads = s['loads']; e4 = {}; unresolved = {}; seen = set(); ac_units = 0; cat_uncertain = False
    if len(loads) > 200: add('OUT_OF_RANGE', 'loads')
    for i, l in enumerate(loads):
        f = f'loads[{i}]'
        if l['id'] in seen: add('DUPLICATE_ID', f + '.id')
        seen.add(l['id'])
        if f + '.category' in parsed: cat_uncertain = True
        # M1b: retained leg/connection consistency
        conn = None if f + '.connection' in parsed else l['connection']; leg = None if f + '.leg' in parsed else l['leg']
        if topo in SUPPLY:
            _, vln, ph, w = SUPPLY[topo]
            if leg is not None and (w == 2 or (ph == 1 and leg == 'L3')): add('LEG_INVALID', f + '.leg')
            if (conn == 'LN' and vln is None) or (conn == '3PH' and ph != 3): add('CONNECTION_INVALID', f + '.connection')
        if f + '.rating.value' not in parsed:
            if l['rating']['kind'] != 'va': add('UNSUPPORTED_RATING_KIND', f + '.rating.kind')
            else:
                e, err = encode_e4(l['rating']['value'])
                if err: add(err, f + '.rating.value')
                else: e4[l['id']] = e
        if f + '.quantity' not in parsed and l['quantity'] > 100: add('OUT_OF_RANGE', f + '.quantity')
        cat = l['category']
        if f + '.category' not in parsed:
            if cat is None: add('MISSING_FIELD', f + '.category')
            elif cat == 'motor' and rule['I-82-4'] != 'verified': add('RULE_PENDING', f + '.category')
            elif cat == 'ac': ac_units += l['quantity']
            elif cat in ('heat_pump_compressor', 'heat_pump_supplemental', 'electric_space_heat', 'thermal_storage_heat') and s['hvac']['arrangement'] == 'ac_only': add('HVAC_ARRANGEMENT_INCONSISTENT', f + '.category')
        exp = PRED.get(cat)
        if exp and f + '.inclusion82' not in parsed:
            fact = l['inclusion82']
            if not isinstance(fact, dict) or fact['answer'] is None or fact['predicate'] != exp: add('MISSING_FIELD', f + '.inclusion82')
            elif not isinstance(fact['basis'], dict) or fact['basis']['basisId'] != l['basisId'] or fact['basis']['category'] != cat or fact['basis']['quantity'] != l['quantity']: add('PREMISE_STALE', f + '.inclusion82')
            elif fact['answer'] in ('on_counted_laundry_circuit', 'on_counted_b2_circuit'): unresolved[l['id']] = 'CIRCUIT_BASIS_UNSUPPORTED'
            elif fact['answer'] == 'none_of_these': unresolved[l['id']] = 'INCLUSION_BASIS_UNSUPPORTED'
            elif (cat == 'dryer' and fact['answer'] != 'not_on_counted_laundry_circuit') or (cat != 'dryer' and fact['answer'] not in ('fixed_or_permanently_connected', 'specific_circuit')): add('MISSING_FIELD', f + '.inclusion82')
        if cat == 'ac' and f + '.ratingCoverage82' not in parsed:
            fact = l['ratingCoverage82']
            if not isinstance(fact, dict) or fact['value'] is None: add('MISSING_FIELD', f + '.ratingCoverage82')
            else:
                b = fact['basis']
                if not isinstance(b, dict) or b['basisId'] != l['basisId'] or b['category'] != cat or b['quantity'] != l['quantity'] or b['rating']['kind'] != l['rating']['kind'] or b['rating']['value'] != l['rating']['value']: add('PREMISE_STALE', f + '.ratingCoverage82')
                elif fact['value'] is False: unresolved[l['id']] = 'AC_RATING_INCOMPLETE'
    if ac_units > 1 and rule['I-82-5'] != 'verified': add('RULE_PENDING', 'hvac.arrangement')
    if arr_known and s['hvac']['arrangement'] == 'ac_only' and ac_units == 0 and not cat_uncertain: add('HVAC_ARRANGEMENT_INCONSISTENT', 'hvac.arrangement')   # M1a
    si = s['hvac']['supplementalInterlocked']
    if s['hvac']['arrangement'] == 'heat_pump_with_supplemental' and 'hvac.supplementalInterlocked' not in parsed and si['value'] is not None and not (isinstance(si.get('provenance'), dict) and isinstance(si['provenance'].get('source'), str)): add('MISSING_FIELD', 'hvac.supplementalInterlocked.provenance')
    if s['hvac']['arrangement'] == 'heat_pump_with_supplemental' and si['value'] is True and rule['I-82-3'] != 'verified': add('RULE_PENDING', 'hvac.supplementalInterlocked')
    if 'optional82.inventoryComplete' not in parsed:
        inv = o['inventoryComplete']
        if inv['value'] is None: add('MISSING_FIELD', 'optional82.inventoryComplete')
        else:
            key = lambda t: tuple((x is None, x if x is not None else '') for x in t)
            cur = sorted([(l['id'], l['basisId'], l['category'], l['quantity']) for l in loads], key=key)
            dec = sorted([(m['id'], m['basisId'], m['category'], m['quantity']) for m in inv['basis']['members']], key=key) if isinstance(inv['basis'], dict) else None
            if dec != cur: add('PREMISE_STALE', 'optional82.inventoryComplete')
            elif inv['value'] is False: add('INVENTORY_INCOMPLETE_DECLARED', 'optional82.inventoryComplete')
    if ctx['importedFrom'] is not None and s['method']['selected'] == 'opt_220_82' and ctx['methodConfirmedAfterImport'] is not True: add('IMPORTED_METHOD_UNCONFIRMED', 'method.selected')
    for l in loads:
        if l['classification'] == 'required': unresolved[l['id']] = 'CLASSIFICATION_REQUIRED'
        elif l['category'] in ('evse', 'other'): unresolved[l['id']] = 'CATEGORY_UNSUPPORTED_IN_METHOD'
    return probs, dict(e4=e4, unresolved=unresolved, area=area, sa=sa, la=la)

def rank(probs):
    r = 99
    for c, f, layer, src, _ref in probs:
        if layer != 'input': continue
        k = 2 if c in ('SCOPE_UNSUPPORTED', 'CAPABILITY_DISABLED') else 3 if c == 'RULE_PENDING' else 4 if c in INVALID else 5 if c in INCOMPLETE else 6 if c == 'QUALIFICATION_FAILED' else 99
        r = min(r, k)
    return r
STATUS = {2: 'UNSUPPORTED_SCOPE', 3: 'BLOCKED_PENDING_RULE', 4: 'INVALID_INPUT', 5: 'INCOMPLETE_INPUT', 6: 'UNQUALIFIED_METHOD'}
# Q1 (R3): the expected ruleRef belongs to the derived CAUSE, not to (code, field) alone.
# Every derived problem is a 5-tuple (code, field, layer, source, ruleRef); the citation is attached where the cause
# is produced. A parser-transported failure never inherits an engine rule citation, and a product numeric bound is
# never annotated with a NEC rule. Causes not listed below carry ruleRef None by contract.
#   engine SA < 2                     -> OUT_OF_RANGE, ruleRef 210.11(C)(1)   (source-cited minimum, S-11a)
#   engine SA > 100                   -> OUT_OF_RANGE, ruleRef None           (product numeric-domain maximum)
#   active parser OUT_OF_RANGE on SA  -> source parser,  ruleRef None         (transported failure; a retained value is not reinterpreted)
RULE_REF_ENGINE = {
    ('RULE_PENDING', 'method.selected'): '220.82', ('RULE_PENDING', 'dwelling.smallApplianceCircuits'): '210.11(C)(1),(2)',
    ('RULE_PENDING', 'dwelling.laundryCircuits'): '210.11(C)(2)/210.52(F)', ('RULE_PENDING', 'dwelling.nycAcCircuitCount'): 'NYCEC 220.14(N)',
    ('RULE_PENDING', 'hvac.arrangement'): '220.82(C)(1)', ('RULE_PENDING', 'hvac.supplementalInterlocked'): '220.82(C)(3)',
    ('QUALIFICATION_UNKNOWN', 'supply.topology'): '220.82(A)', ('QUALIFICATION_FAILED', 'supply.topology'): '220.82(A)',
    ('QUALIFICATION_UNKNOWN', 'optional82.singleSupplySet'): '220.82(A)', ('QUALIFICATION_FAILED', 'optional82.singleSupplySet'): '220.82(A)',
    ('QUALIFICATION_UNKNOWN', 'optional82.conductorAmpacityA'): '220.82(A)', ('QUALIFICATION_FAILED', 'optional82.conductorAmpacityA'): '220.82(A)',
}
def engine_rule_ref(code, field):
    """Default engine annotation for causes whose citation depends only on (code, field)."""
    if (code, field) in RULE_REF_ENGINE: return RULE_REF_ENGINE[(code, field)]
    if code == 'RULE_PENDING' and field.startswith('loads[') and field.endswith('.category'): return '220.82(B)(4)'
    return None

GROUP = {'UNSUPPORTED_SCOPE': lambda c: c in ('SCOPE_UNSUPPORTED', 'CAPABILITY_DISABLED'), 'BLOCKED_PENDING_RULE': lambda c: c == 'RULE_PENDING', 'INVALID_INPUT': lambda c: c in INVALID, 'INCOMPLETE_INPUT': lambda c: c in INCOMPLETE, 'UNQUALIFIED_METHOD': lambda c: c == 'QUALIFICATION_FAILED'}

def expected_graph(req, ex, family):
    """Expected lines (id → operands, bindings, exactE4, loadIds) computed from the request only; order = required line order."""
    s = req['snapshot']; loads = s['loads']; e4 = ex['e4']; lines = {}; order = []
    def put(lid, **kw): lines[lid] = kw; order.append(lid)
    b1 = ex['area'] * 3 * E4; b2 = (ex['sa'] + ex['la']) * 1500 * E4
    put('b1_area', operands=[('lit', ex['area'], 'ft2')], bindings=[('area', 'dwelling.floorAreaFt2', None, None, None, ex['area'])], exact=b1, loadIds=[])
    put('b2_circuits', operands=[('lit', ex['sa'] + ex['la'], 'count')], bindings=[('count', 'dwelling.smallApplianceCircuits', None, None, None, ex['sa']), ('count', 'dwelling.laundryCircuits', None, None, None, ex['la'])], exact=b2, loadIds=[])
    bset = [(i, l) for i, l in enumerate(loads) if l['category'] in B_GROUP]; b3 = 0; ops = []; binds = []
    for i, l in bset:
        c = e4[l['id']] * l['quantity']; b3 += c; ops.append(('load', l['id'], canonical(c))); binds.append(('va', f'loads[{i}]', l['id'], l['rating']['value'], l['quantity'], canonical(c)))
    gen_ops = [('ref', 'b1_area'), ('ref', 'b2_circuits')]
    if bset: put('b3_appliances', operands=ops, bindings=binds, exact=b3, loadIds=[l['id'] for _, l in bset]); gen_ops.append(('ref', 'b3_appliances'))
    gen = b1 + b2 + b3; put('gen_connected', operands=gen_ops, bindings=[], exact=gen, loadIds=[])
    t1 = min(gen, CAP); exs = max(gen - CAP, 0); t2 = (exs // 100) * 40; gd = t1 + t2
    put('gen_tier1', operands=[('ref', 'gen_connected')], bindings=[], exact=t1, loadIds=[]); put('gen_excess', operands=[('ref', 'gen_connected')], bindings=[], exact=exs, loadIds=[])
    put('gen_tier2', operands=[('ref', 'gen_excess')], bindings=[], exact=t2, loadIds=[]); put('gen_demand', operands=[('ref', 'gen_tier1'), ('ref', 'gen_tier2')], bindings=[], exact=gd, loadIds=[])
    if family == 'COMPLETE':
        acs = [(i, l) for i, l in enumerate(loads) if l['category'] == 'ac']; acc = 0; ops = []; binds = []
        for i, l in acs:
            c = e4[l['id']] * l['quantity']; acc += c; ops.append(('load', l['id'], canonical(c))); binds.append(('va', f'loads[{i}]', l['id'], l['rating']['value'], l['quantity'], canonical(c)))
        c1 = (acc // 100) * 100
        put('ac_connected', operands=ops, bindings=binds, exact=acc, loadIds=[l['id'] for _, l in acs]); put('c1_ac', operands=[('ref', 'ac_connected')], bindings=[], exact=c1, loadIds=[])
        put('hvac_governing', operands=[('ref', 'c1_ac')], bindings=[], exact=c1, loadIds=[], selected='c1_ac'); put('total', operands=[('ref', 'gen_demand'), ('ref', 'hvac_governing')], bindings=[], exact=gd + c1, loadIds=[])
    return order, lines

def check_pair(pair):
    try: return _check_pair(pair)
    except Exception as e: return [f'checker exception: {type(e).__name__}: {e}']

def _check_pair(pair):
    R = Report(); req = pair['request']; res = pair['result']
    rule = rule_config(pair, R)
    # ── structural shape (full schema) and identity ──
    if V_REQ is None: R.fail('schema validation unavailable: ' + str(_SCHEMA_ERR))
    else:
        for e in V_REQ.errors(req)[:3]: R.fail('request schema: ' + e)
        for e in V_RES.errors(res)[:3]: R.fail('result schema: ' + e)
    if not isinstance(res, dict) or list(res.keys()) != RESULT_KEYS: R.fail('result keys differ from the B82 result shape'); return R.v
    if res['schemaVersion'] != '3.3.0' or res['profileId'] != 'B82_core1' or res['ruleBasis'] != {'code': 'NYCEC-2025', 'base': 'NEC-2020', 'amendments': 'NYC-2025'}: R.fail('result identity')
    if req.get('apiVersion') != 2 or req.get('profileId') != 'AB82_core1' or req['snapshot'].get('schemaVersion') != '3.3.0': R.fail('request identity')
    for k, pe in enumerate(req.get('parseErrors', [])):
        why = parse_path_problem(pe.get('field'), req['snapshot']) if isinstance(pe, dict) else 'not an object'
        if why: R.fail(f'request parseErrors[{k}].field: {why}')
    lines = res['demand']['lines']
    for ln in lines:
        if not isinstance(ln, dict) or list(ln.keys()) != LINE_KEYS: R.fail(f'line {ln.get("id") if isinstance(ln, dict) else "?"} keys')
    # ── stage 1, status, family (derived, never read from the result) ──
    from collections import Counter
    probs, ex = derive(req, rule)
    exp_input = Counter(probs)                                   # Q2: derived input-layer identities WITH cause-appropriate multiplicity
    got_all = Counter(ptuple(p) for p in res['problems'])
    got_input = Counter({k: v for k, v in got_all.items() if k[2] == 'input'})
    if got_input != exp_input:
        R.fail(f'input-layer problem identities differ: missing {sorted((exp_input - got_input).elements())} extra {sorted((got_input - exp_input).elements())}')
    for p in res['problems']:
        if p['layer'] not in ('input', 'demand', 'current', 'capacity') or p['source'] not in ('engine', 'parser', 'migration'): R.fail(f'problem {p["code"]}@{p["field"]}: layer/source outside the closed sets')
        if not isinstance(p.get('message'), str) or not p['message']: R.fail(f'problem {p["code"]}@{p["field"]}: message must be a non-empty string (free prose is not otherwise checked)')
    r = rank(probs); loads = req['snapshot']['loads']; isB = lambda l: l['category'] in B_GROUP
    if r < 99: exp_status = STATUS[r]; family = 'CLEARED'
    else:
        anyun = bool(ex['unresolved']) or any((not isB(l)) and l['category'] != 'ac' for l in loads)
        exp_status = 'PARTIAL' if anyun else 'COMPLETE'
        family = 'COMPLETE' if not anyun else ('PARTIAL_NO_SUBTOTAL' if any(isB(l) and l['id'] in ex['unresolved'] for l in loads) else 'PARTIAL_SUBTOTAL')
    if res['status'] != exp_status: R.fail(f'status {res["status"]} but derived {exp_status}')
    order = [p['code'] + '|' + p['field'] for p in res['problems']]
    if order != sorted(order): R.fail('problems not sorted by (code, field)')
    # ── expected coverage / demand-layer problems (whole objects) ──
    e4 = ex['e4']; exp_cov = []; exp_dem = set()
    det = sorted([p for p in probs if p[2] == 'input' and GROUP.get(exp_status, lambda c: False)(p[0])], key=lambda p: (p[0], p[1]))
    if family == 'CLEARED':
        code = det[0][0]
        for l in loads: exp_cov.append(dict(loadId=l['id'], coverage='unresolved', ruleRef=None, reason=code, viaAggregate=False, candidate=None, governing=None, connectedVA=None, demandVA=None, demandFactorScope=None))
    else:
        for i, l in enumerate(loads):
            conn = canonical(e4[l['id']] * l['quantity']) if l['id'] in e4 else None
            if family == 'COMPLETE':
                if isB(l): exp_cov.append(dict(loadId=l['id'], coverage='counted', ruleRef='220.82(B)(3)', reason=None, viaAggregate=False, candidate=None, governing=None, connectedVA=conn, demandVA=None, demandFactorScope='aggregate_220_82_B'))
                else: exp_cov.append(dict(loadId=l['id'], coverage='counted', ruleRef='220.82(C)(1)', reason=None, viaAggregate=False, candidate='c1_ac', governing=True, connectedVA=conn, demandVA=conn, demandFactorScope='candidate_percent'))
            elif family == 'PARTIAL_SUBTOTAL' and isB(l):
                exp_cov.append(dict(loadId=l['id'], coverage='counted', ruleRef='220.82(B)(3)', reason=None, viaAggregate=False, candidate=None, governing=None, connectedVA=conn, demandVA=None, demandFactorScope='aggregate_220_82_B'))
            else:
                reason = ex['unresolved'].get(l['id']) or ('HVAC_WITHHELD_PARTIAL' if l['category'] == 'ac' else 'GENERAL_WITHHELD_PARTIAL' if isB(l) else 'CATEGORY_UNSUPPORTED_IN_METHOD')
                exp_cov.append(dict(loadId=l['id'], coverage='unresolved', ruleRef=None, reason=reason, viaAggregate=False, candidate=None, governing=None, connectedVA=None if reason == 'GENERAL_WITHHELD_PARTIAL' else conn, demandVA=None, demandFactorScope=None))
                exp_dem.add(('LOAD_UNRESOLVED', f'loads[{i}]', 'demand', 'engine', None))
                if reason == 'CLASSIFICATION_REQUIRED': exp_dem.add(('CLASSIFICATION_REQUIRED', f'loads[{i}].classification', 'demand', 'engine', None))
    exp_cov.sort(key=lambda c: c['loadId'])
    if res['loadsCoverage'] != exp_cov: R.fail(f'coverage differs from derived expectation: got {json.dumps(res["loadsCoverage"])[:300]} expected {json.dumps(exp_cov)[:300]}')
    exp_dem_c = Counter(exp_dem); got_dem = Counter({k: v for k, v in got_all.items() if k[2] == 'demand'})
    if got_dem != exp_dem_c: R.fail(f'demand-layer problem identities differ: missing {sorted((exp_dem_c - got_dem).elements())} extra {sorted((got_dem - exp_dem_c).elements())}')
    if any(k[2] == 'capacity' for k in got_all): R.fail(f'capacity-layer problems are not emitted by this delivery: {sorted(k for k in got_all if k[2] == "capacity")}')
    # ── graph by ROLE template, computed from the request; bindings both directions ──
    exp_lines = []; exp = {}
    if family in ('COMPLETE', 'PARTIAL_SUBTOTAL'): exp_lines, exp = expected_graph(req, ex, family)
    got_ids = [ln['id'] for ln in lines]
    if got_ids != exp_lines: R.fail(f'{family} line ids {got_ids} != required {exp_lines}')
    byid = {ln['id']: ln for ln in lines}; consumers = {k: 0 for k in got_ids}
    for lid in exp_lines:
        ln = byid.get(lid)
        if ln is None: continue
        tpl = ROLES[lid]; e = exp[lid]
        if ln['op'] != tpl['op'] or ln['percent'] != tpl['percent'] or ln['threshold'] != tpl['threshold'] or ln['unitFactor'] != tpl['unitFactor'] or ln['ruleRef'] != tpl['ruleRef']: R.fail(f'{lid}: role template (op/percent/threshold/unitFactor/ruleRef) violated')
        if ln['factor'] is not None or ln['controlUnitsRef'] is not None or ln['divisorV'] is not None or ln['powerFactor'] is not None or ln['conductor'] is not None: R.fail(f'{lid}: unused role fields must be null')
        if ln['ruleStatus'] != 'verified' or ln['amended'] is not False: R.fail(f'{lid}: ruleStatus/amended')
        if ln['selected'] != e.get('selected'): R.fail(f'{lid}: selected {ln["selected"]!r} != {e.get("selected")!r}')
        if ln['result'] != {'value': canonical(e['exact']), 'unit': 'VA', 'exactE4': e['exact']}: R.fail(f'{lid}: result {ln["result"]} != recomputed {e["exact"]}')
        if ln['loadIds'] != e['loadIds']: R.fail(f'{lid}: loadIds {ln["loadIds"]} != {e["loadIds"]}')
        got_ops = []
        for o in ln['operands']:
            if o['ref'] is not None:
                if o['ref'] not in byid or o['ref'] not in exp_lines or exp_lines.index(o['ref']) >= exp_lines.index(lid): R.fail(f'{lid}: bad/forward ref {o["ref"]}'); got_ops.append(('ref', o['ref'])); continue
                consumers[o['ref']] += 1
                if o['loadId'] is not None or o['quantity'] != {'value': canonical(exp[o['ref']]['exact']), 'unit': 'VA'}: R.fail(f'{lid}: ref operand {o["ref"]} value/unit/shape')
                got_ops.append(('ref', o['ref']))
            elif o['loadId'] is not None:
                if o['quantity']['unit'] != 'VA': R.fail(f'{lid}: load operand unit {o["quantity"]["unit"]}')
                got_ops.append(('load', o['loadId'], o['quantity']['value']))
            else: got_ops.append(('lit', o['quantity']['value'], o['quantity']['unit']))
        if got_ops != e['operands']: R.fail(f'{lid}: operands {got_ops} != expected {e["operands"]}')
        got_b = [(b.get('kind'), b.get('path'), b.get('loadId'), b.get('ratingValue'), b.get('quantity'), b.get('value')) for b in ln['bindings']]
        if sorted(map(repr, got_b)) != sorted(map(repr, e['bindings'])): R.fail(f'{lid}: bindings {got_b} != expected {e["bindings"]} (missing/extra/duplicate/orphan or wrong record)')
        for b in ln['bindings']:
            if b.get('kind') == 'va' and tpl['cats'] is not None:
                rec = [l for l in loads if l['id'] == b.get('loadId')]
                if not rec or rec[0]['category'] not in tpl['cats']: R.fail(f'{lid}: bound record {b.get("loadId")} not permitted in this aggregation')
    for lid in exp_lines:
        want = 0 if lid == 'total' or (family == 'PARTIAL_SUBTOTAL' and lid == 'gen_demand') else 2 if lid == 'gen_connected' else 1
        if consumers.get(lid, 0) != want: R.fail(f'edge multiplicity {lid}: {consumers.get(lid, 0)} != {want}')
    # ── demand totals / layers per family (no early return) ──
    dem = res['demand']; cur = res['current']
    cleared_current = {'status': 'not_computed', 'model': None, 'formula': None, 'assumptions': [], 'perConductorA': None, 'lineA': None, 'neutralA': None, 'note': cur.get('note')}
    if family == 'COMPLETE':
        t = exp['total']['exact']
        if dem != {'status': 'complete', 'unit': 'VA', 'totalVA': canonical(t), 'totalExactE4': t, 'totalOnConductorA': None, 'partialSubtotalVA': None, 'lines': lines}: R.fail('COMPLETE demand object')
        s = req['snapshot']; kind = s['loadModel']['kind']; got_cur = Counter({k: v for k, v in got_all.items() if k[2] == 'current'})
        if kind is None: expc = Counter({('MODEL_NOT_SELECTED', 'loadModel.kind', 'current', 'engine', None): 1})
        elif kind != 'split_240_balanced_LN' or s['supply']['topology'] != '1ph_3w_120_240': expc = Counter({('MODEL_UNSUPPORTED', 'loadModel.kind', 'current', 'engine', None): 1})
        elif (s['loadModel']['declarations'].get('balancedLN') or {}).get('value') is not True: expc = Counter({('MODEL_DECLARATION_MISSING', 'loadModel.declarations.balancedLN', 'current', 'engine', None): 1})
        else: expc = Counter()
        if got_cur != expc: R.fail(f'current-layer problem identities differ: missing {sorted((expc - got_cur).elements())} extra {sorted((got_cur - expc).elements())}')
        if not expc: pass
        if expc:
            if cur != cleared_current: R.fail('current must be not_computed (all fields cleared)')
        else:
            I = canonical(t) / 240
            if cur != {'status': 'computed', 'model': 'split_240_balanced_LN', 'formula': 'I = VA / 240', 'assumptions': ['balancedLN declared'], 'perConductorA': {'L1': I, 'L2': I, 'L3': None}, 'lineA': I, 'neutralA': None, 'note': cur.get('note')}: R.fail('current object')
        gd = exp['gen_demand']['exact']; gc = exp['gen_connected']['exact']
        if res['diagnostics'] != {'operative': False, 'generalConnectedVA': canonical(gc), 'generalDemandVA': canonical(gd), 'hvacGoverningLine': 'c1_ac', 'hvacCandidatesVA': {'c1_ac': canonical(exp['c1_ac']['exact'])}}: R.fail('COMPLETE diagnostics')
        strings = {'totalVA': display_va(t), 'generalDemandVA': display_va(gd)}
        if not expc: strings['lineA'] = display_amps(canonical(t) / 240)   # N3: derived from the EXPECTED raw current, never from the submitted string
        if res['display']['strings'] != strings or res['display']['precision'] != {'amps': 1, 'va': 0} or res['display']['feedsComparison'] is not False: R.fail(f'display strings/precision: got {res["display"]["strings"]} expected {strings}')
        if res['presentation'] != expected_presentation(req, True): R.fail(f'COMPLETE presentation {res["presentation"]} != derived {expected_presentation(req, True)}')
        if res['existingCapacity']['blockingCode'] != 'COMPARISON_NOT_SUPPORTED': R.fail('capacity blocking code')
    else:
        if cur != cleared_current or any(k[2] == 'current' for k in got_all): R.fail(f'{family}: current must be cleared, with no current-layer problem before a complete demand')
        if res['presentation'] != expected_presentation(req, False): R.fail(f'{family}: presentation {res["presentation"]} != derived {expected_presentation(req, False)}')
        if family == 'PARTIAL_SUBTOTAL':
            gd = exp['gen_demand']['exact']; gc = exp['gen_connected']['exact']
            if dem != {'status': 'partial_diagnostic', 'unit': 'VA', 'totalVA': None, 'totalExactE4': None, 'totalOnConductorA': None, 'partialSubtotalVA': canonical(gd), 'lines': lines}: R.fail('PARTIAL_SUBTOTAL demand object')
            if res['diagnostics'] != {'operative': False, 'generalConnectedVA': canonical(gc), 'generalDemandVA': canonical(gd), 'hvacGoverningLine': None, 'hvacCandidatesVA': {}} or res['display']['strings'] != {'generalDemandVA': display_va(gd)}: R.fail('PARTIAL_SUBTOTAL diagnostics/strings')
            if res['existingCapacity']['blockingCode'] != 'COMPARISON_NOT_SUPPORTED': R.fail('capacity blocking code')
        else:
            if dem != {'status': 'partial_diagnostic' if family == 'PARTIAL_NO_SUBTOTAL' else 'not_computed', 'unit': 'VA', 'totalVA': None, 'totalExactE4': None, 'totalOnConductorA': None, 'partialSubtotalVA': None, 'lines': []}: R.fail(f'{family}: demand must be cleared')
            if res['diagnostics'] != {'operative': False, 'generalConnectedVA': None, 'generalDemandVA': None, 'hvacGoverningLine': None, 'hvacCandidatesVA': {}} or res['display']['strings'] != {}: R.fail(f'{family}: diagnostics/strings must be cleared')
            want_block = 'COMPARISON_NOT_SUPPORTED' if family == 'PARTIAL_NO_SUBTOTAL' else det[0][0]
            if res['existingCapacity']['blockingCode'] != want_block: R.fail(f'capacity blocking code {res["existingCapacity"]["blockingCode"]} != {want_block}')
    # ── layers that are inactive in every family ──
    if res['existingCapacity']['status'] != 'not_assessed' or res['existingCapacity']['comparisonKind'] is not None or res['existingCapacity']['policy'] is not None or res['existingCapacity']['ruleRef'] is not None or res['existingCapacity']['comparisons'] != [] or res['existingCapacity']['boundOutcome'] is not None: R.fail('existingCapacity must be inactive')
    if res['rating']['status'] != 'not_assessed' or res['requiredCapacity']['status'] != 'not_assessed': R.fail('rating/requiredCapacity must be not_assessed')
    if res['current']['neutralA'] is not None: R.fail('neutral must never be computed')
    if res['diagnostics'].get('operative') is not False: R.fail('diagnostics must be non-operative')
    if res['display']['rounding'] != 'half_away_from_zero': R.fail('display rounding')
    want_refs = [{'ruleRef': '220.82', 'amended': False, 'href': None}]
    if (req['snapshot']['dwelling']['nycAcCircuitCount'] or 0) > 0: want_refs.append({'ruleRef': '220.14(N)', 'amended': True, 'href': None})
    if res['references'] != want_refs: R.fail(f'references {res["references"]} != derived {want_refs} (complete objects: ruleRef, amended source metadata, href convention, no extra entries)')
    return R.v

# ── mutation modes ──
def _members(s): return {'members': sorted([{'id': l['id'], 'basisId': l['basisId'], 'category': l['category'], 'quantity': l['quantity']} for l in s['loads']], key=lambda x: x['id'])}
def recompute(p):
    """Recompute a submitted graph coherently after tampering (adversarial candidate results, never oracles)."""
    by = {}
    for l in p['result']['demand']['lines']:
        vals = [by[o['ref']] if o['ref'] else int(round(o['quantity']['value'] * E4)) for o in l['operands']]
        for o in l['operands']:
            if o['ref']: o['quantity']['value'] = canonical(by[o['ref']])
        op = l['op']
        if op == 'multiply_unit': v = int(l['operands'][0]['quantity']['value'] * l['unitFactor']['value'] * E4)
        elif op == 'sum': v = sum(vals)
        elif op == 'min_cap': v = min(vals[0], l['threshold']['exactE4'])
        elif op == 'excess_over': v = max(vals[0] - l['threshold']['exactE4'], 0)
        elif op == 'multiply_percent': v = (vals[0] // 100) * l['percent']
        elif op == 'max_of': v = max(vals)
        elif op == 'identity': v = vals[0]
        else: raise ValueError(op)
        l['result'] = {'value': canonical(v), 'unit': 'VA', 'exactE4': v}; by[l['id']] = v
    r = p['result']
    if 'total' in by:
        r['demand']['totalExactE4'] = by['total']; r['demand']['totalVA'] = canonical(by['total'])
        if r['current']['status'] == 'computed': I = r['demand']['totalVA'] / 240; r['current']['lineA'] = I; r['current']['perConductorA'] = {'L1': I, 'L2': I, 'L3': None}; r['display']['strings']['lineA'] = f'{I:.1f} A'
        r['display']['strings']['totalVA'] = display_va(by['total'])
    if 'gen_demand' in by:
        r['diagnostics']['generalConnectedVA'] = canonical(by['gen_connected']); r['diagnostics']['generalDemandVA'] = canonical(by['gen_demand']); r['display']['strings']['generalDemandVA'] = display_va(by['gen_demand'])
        if r['demand']['partialSubtotalVA'] is not None: r['demand']['partialSubtotalVA'] = canonical(by['gen_demand'])
    if 'c1_ac' in by: r['diagnostics']['hvacCandidatesVA'] = {'c1_ac': canonical(by['c1_ac'])}
    for c in r['loadsCoverage']:
        if c['coverage'] == 'counted':
            for l in r['demand']['lines']:
                for b in l['bindings']:
                    if b.get('loadId') == c['loadId']: c['connectedVA'] = b['value']; c['demandVA'] = b['value'] if c['candidate'] else None

def mutate(pair):
    out = []
    def m(name, fn):
        p = copy.deepcopy(pair); fn(p); out.append((name, p))
    res = pair['result']; lines = res['demand']['lines']; ids = [l['id'] for l in lines]; L = lambda p, i: p['result']['demand']['lines'][ids.index(i)]
    # plain (locally inconsistent) corruptions
    if 'gen_tier1' in ids:
        m('threshold_changed', lambda p: L(p, 'gen_tier1')['threshold'].__setitem__('exactE4', 100010000))
        m('percent_changed', lambda p: L(p, 'gen_tier2').__setitem__('percent', 41))
    if 'b3_appliances' in ids:
        m('forged_binding_rating', lambda p: L(p, 'b3_appliances')['bindings'][0].__setitem__('ratingValue', 12001))
        def forge2(p): ln = L(p, 'b3_appliances'); ln['bindings'][0]['quantity'] = 2; ln['bindings'][0]['value'] *= 2; ln['operands'][0]['quantity']['value'] *= 2
        m('forged_binding_quantity', forge2)
        def dup(p): ln = L(p, 'b3_appliances'); ln['operands'].append(copy.deepcopy(ln['operands'][0])); ln['bindings'].append(copy.deepcopy(ln['bindings'][0]))
        m('duplicate_load_contribution', dup)
    if 'total' in ids:
        m('missing_line', lambda p: p['result']['demand']['lines'].pop(ids.index('gen_excess')))
        m('orphan_line', lambda p: p['result']['demand']['lines'].insert(ids.index('total'), {**copy.deepcopy(lines[ids.index('gen_demand')]), 'id': 'orphan_x'}))
        m('wrong_root', lambda p: L(p, 'total').__setitem__('id', 'not_total'))
        m('false_total', lambda p: p['result']['demand'].__setitem__('totalVA', p['result']['demand']['totalVA'] + 1))
        m('false_current', lambda p: p['result']['current'].__setitem__('lineA', 100.0))
    def removed_problem(p):
        if p['result']['problems']: p['result']['problems'].pop(0)
        else: p['result']['problems'].append({'code': 'MISSING_FIELD', 'field': 'dwelling.floorAreaFt2', 'layer': 'input', 'source': 'engine', 'ruleRef': None, 'message': 'x'})
    m('removed_or_added_problem', removed_problem)
    m('withheld_ac_coverage_relabelled', lambda p: [c.__setitem__('coverage', 'counted') for c in p['result']['loadsCoverage'] if c['reason'] == 'HVAC_WITHHELD_PARTIAL'] or p['result']['loadsCoverage'].pop())
    def fabricated_complete(p):
        p['result']['status'] = 'COMPLETE'; p['result']['problems'] = []; p['result']['demand']['status'] = 'complete'; p['result']['demand']['totalVA'] = 23680; p['result']['demand']['totalExactE4'] = 236800000
    if res['status'] != 'COMPLETE': m('fabricated_complete', fabricated_complete)
    def cleared_with_total(p):
        p['result']['status'] = 'INCOMPLETE_INPUT'; p['result']['problems'] = [{'code': 'MISSING_FIELD', 'field': 'dwelling.floorAreaFt2', 'layer': 'input', 'source': 'engine', 'ruleRef': None, 'message': 'x'}]
    m('cleared_status_keeps_total', cleared_with_total)
    # COHERENT corruptions (M3): a wrong rule or wrong assignment with every descendant recomputed consistently
    if 'total' in ids:
        m('coherent_percent_41', lambda p: (L(p, 'gen_tier2').__setitem__('percent', 41), recompute(p)))
        m('coherent_percent_35', lambda p: (L(p, 'gen_tier2').__setitem__('percent', 35), recompute(p)))
        def thr(p):
            for i in ('gen_tier1', 'gen_excess'): L(p, i)['threshold'] = {'value': 20000, 'unit': 'VA', 'exactE4': 200000000}
            recompute(p)
        m('coherent_threshold_20000', thr)
        m('coherent_c1_percent_80', lambda p: (L(p, 'c1_ac').__setitem__('percent', 80), recompute(p)))
        m('coherent_unit_factor_4', lambda p: (L(p, 'b1_area').__setitem__('unitFactor', {'value': 4, 'unit': 'VA_per_ft2'}), recompute(p)))
        if 'b3_appliances' in ids and 'ac_connected' in ids:
            def swap(p):
                g = L(p, 'b3_appliances'); a = L(p, 'ac_connected'); k = len(g['operands']) - 1
                g['operands'][k], a['operands'][0] = a['operands'][0], g['operands'][k]; g['bindings'][k], a['bindings'][0] = a['bindings'][0], g['bindings'][k]
                g['loadIds'] = [o['loadId'] for o in g['operands']]; a['loadIds'] = [o['loadId'] for o in a['operands']]; recompute(p)
                for c in p['result']['loadsCoverage']:
                    if c['loadId'] in a['loadIds']: c.update(ruleRef='220.82(C)(1)', candidate='c1_ac', governing=True, demandVA=c['connectedVA'], demandFactorScope='candidate_percent')
                    elif c['loadId'] in g['loadIds']: c.update(ruleRef='220.82(B)(3)', candidate=None, governing=None, demandVA=None, demandFactorScope='aggregate_220_82_B')
            m('coherent_category_swap', swap)
            def drop_ac(p):
                a = L(p, 'ac_connected'); g = L(p, 'b3_appliances'); g['operands'].append(a['operands'].pop()); g['bindings'].append(a['bindings'].pop()); g['loadIds'] = [o['loadId'] for o in g['operands']]; a['loadIds'] = []; recompute(p)
            m('coherent_ac_moved_into_b_group', drop_ac)
        m('orphan_binding_no_operand', lambda p: L(p, 'b3_appliances' if 'b3_appliances' in ids else 'ac_connected')['bindings'].append({'kind': 'va', 'path': 'loads[99]', 'loadId': 'GHOST', 'ratingValue': 50, 'quantity': 1, 'value': 50}))
        m('wrong_operand_unit', lambda p: L(p, 'gen_tier2')['operands'][0]['quantity'].__setitem__('unit', 'A'))
        m('binding_kind_swapped', lambda p: L(p, 'b1_area')['bindings'][0].__setitem__('kind', 'count'))
        m('request_extra_key', lambda p: p['request']['snapshot']['optional82'].__setitem__('extraKey', 'unexpected'))
        def no_ac_coherent(p):
            # request without the ac record (M1a) but a coherently recomputed COMPLETE result: rejected by derivation, not by arithmetic
            s = p['request']['snapshot']; s['loads'] = [l for l in s['loads'] if l['category'] != 'ac']; s['optional82']['inventoryComplete']['basis'] = _members(s)
            keep = [l for l in p['result']['demand']['lines'] if l['id'] not in ('ac_connected', 'c1_ac', 'hvac_governing')]
            tot = [l for l in keep if l['id'] == 'total'][0]; tot['op'] = 'identity'; tot['operands'] = [o for o in tot['operands'] if o['ref'] == 'gen_demand']
            p['result']['demand']['lines'] = keep; recompute(p); p['result']['loadsCoverage'] = [c for c in p['result']['loadsCoverage'] if c['candidate'] is None]; p['result']['diagnostics']['hvacGoverningLine'] = None; p['result']['diagnostics']['hvacCandidatesVA'] = {}
        m('coherent_missing_ac_as_none', no_ac_coherent)
        def dormant_error_as_active(p):
            s = p['request']['snapshot']; ds = [x for x in s['loads'] if x['category'] == 'dryer']
            if not ds: p['result']['status'] = 'INVALID_INPUT'; return
            l = ds[0]; l['category'] = 'range'; s['optional82']['inventoryComplete']['basis'] = _members(s); i = s['loads'].index(l)
            p['request']['parseErrors'] = [{'field': f'loads[{i}].inclusion82', 'raw': 'old', 'code': 'UNKNOWN_ENUM'}]
            r = p['result']; r['status'] = 'INVALID_INPUT'; r['problems'] = [{'code': 'UNKNOWN_ENUM', 'field': f'loads[{i}].inclusion82', 'layer': 'input', 'source': 'parser', 'ruleRef': None, 'message': 'x'}]
            r['loadsCoverage'] = [dict(loadId=x['id'], coverage='unresolved', ruleRef=None, reason='UNKNOWN_ENUM', viaAggregate=False, candidate=None, governing=None, connectedVA=None, demandVA=None, demandFactorScope=None) for x in sorted(s['loads'], key=lambda x: x['id'])]
            r['demand'] = {'status': 'not_computed', 'unit': 'VA', 'totalVA': None, 'totalExactE4': None, 'totalOnConductorA': None, 'partialSubtotalVA': None, 'lines': []}
            r['current'].update(status='not_computed', model=None, formula=None, assumptions=[], perConductorA=None, lineA=None); r['existingCapacity']['blockingCode'] = 'UNKNOWN_ENUM'
            r['diagnostics'] = {'operative': False, 'generalConnectedVA': None, 'generalDemandVA': None, 'hvacGoverningLine': None, 'hvacCandidatesVA': {}}; r['display']['strings'] = {}; r['presentation'].update(finalResultHeading=False, verdictLabel=None)
        m('coherent_dormant_error_treated_active', dormant_error_as_active)
        m('escalating_test_configuration', lambda p: p.__setitem__('assumptions', {'engineRuleStatus': {'I-82-1': 'verified'}}))
        m('display_lineA_zero', lambda p: p['result']['display']['strings'].__setitem__('lineA', '0.0 A'))
        m('display_lineA_wrong_rounding', lambda p: p['result']['display']['strings'].__setitem__('lineA', '98.6 A'))
        m('display_totalVA_wrong', lambda p: p['result']['display']['strings'].__setitem__('totalVA', '23,681 VA'))
        m('presentation_wrong_supply', lambda p: p['result']['presentation'].update(topologyLabel='480Y/277 V, 3-ph, 4-wire', polesLabel='3-pole', showPerConductor=False))
        m('reference_wrong_amendment', lambda p: p['result']['references'][0].__setitem__('amended', True))
        m('reference_extra_entry', lambda p: p['result']['references'].append({'ruleRef': '220.14(N)', 'amended': True, 'href': None}))
        m('problem_wrong_rule_ref', lambda p: (p['result']['demand']['lines'] and p['result']['problems'].append({'code': 'RULE_PENDING', 'field': 'method.selected', 'layer': 'input', 'source': 'engine', 'ruleRef': '220.99', 'message': 'x'})))
    if res['problems']:
        m('problem_duplicated', lambda p: p['result']['problems'].insert(0, copy.deepcopy(p['result']['problems'][0])))
        m('problem_rule_ref_forged', lambda p: p['result']['problems'][0].__setitem__('ruleRef', '220.99'))
    if res['status'] not in ('COMPLETE', 'PARTIAL'):
        m('cleared_residual_capacity_and_current', lambda p: (p['result']['existingCapacity'].__setitem__('status', 'adequate'), p['result']['current'].__setitem__('perConductorA', {'L1': 100, 'L2': 100, 'L3': None})))
    return out

def main(argv):
    if len(argv) < 2: print(__doc__); return 2
    data = json.load(open(argv[1])); out = argv[argv.index('--out') + 1] if '--out' in argv else None
    report = {'mode': 'mutants' if '--mutants' in argv else 'pairs', 'schemaValidation': V_REQ is not None, 'results': []}; bad = 0
    if '--mutants' in argv:
        for pair in data['pairs']:
            base = check_pair(pair)
            if base: report['results'].append({'id': pair['id'], 'base': base}); bad += 1; continue
            for name, mp in mutate(pair):
                v = check_pair(mp); rejected = bool(v)
                report['results'].append({'id': pair['id'], 'mutant': name, 'rejected': rejected, 'violations': v[:3]})
                if not rejected: bad += 1
        print(f"mutants: {sum(1 for r in report['results'] if r.get('rejected'))} rejected, {sum(1 for r in report['results'] if r.get('rejected') is False)} SURVIVED, base failures {sum(1 for r in report['results'] if 'base' in r)}")
        for r in report['results']:
            if r.get('rejected') is False: print('  SURVIVED', r['id'], r['mutant'])
    else:
        for pair in data['pairs']:
            v = check_pair(pair); report['results'].append({'id': pair['id'], 'violations': v})
            if v: bad += 1
        print(f"pairs: {len(data['pairs'])} checked, {bad} with violations")
        for r in report['results']:
            if r['violations']: print(' ', r['id'], r['violations'][:3])
    if out: json.dump(report, open(out, 'w'), indent=1)
    return 1 if bad else 0

if __name__ == '__main__': sys.exit(main(sys.argv))
