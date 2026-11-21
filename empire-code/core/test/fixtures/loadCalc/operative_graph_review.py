"""Independent, review-only assertions for the active result graph.
Not a load-calculation engine, not a production patch, and not a NEC validator.
Use AFTER the supplied JSON schema and contract_invariants_r21.py.
Checks completeness/multiplicity of the existing declared calculation lines,
association of each new term with a conductor, the governing value, and coverage
of conductor comparisons. Does not compute any new rule or change input/output.
"""
from collections import Counter

def check_operative_graph(envelope, result):
    violations = []
    s = envelope['snapshot']
    d = result['demand']
    if s['method']['selected'] != 'measured_220_87' or d['status'] != 'complete':
        return violations
    m = s['measurement']; new = m['newLoad']; mode = new['mode']
    if mode not in ('none', 'precalculated'):
        return ['GRAPH: complete measured result uses an inactive new-load mode']
    lines = d['lines']; byid = {l['id']: l for l in lines}
    if len(byid) != len(lines):
        violations.append('GRAPH: duplicate result-line id')
    # This is a graph proof: each ref must point backward, not to itself/future.
    seen = set()
    for l in lines:
        for o in l['operands']:
            if o['ref'] is not None and o['ref'] not in seen:
                violations.append('GRAPH: non-earlier reference in '+l['id'])
        seen.add(l['id'])
    def node(lid, op, refs, conductor='ANY'):
        ln = byid.get(lid)
        if not ln:
            violations.append('GRAPH: missing '+lid); return None
        if ln['op'] != op or [o['ref'] for o in ln['operands']] != refs:
            violations.append('GRAPH: '+lid+' must be '+op+str(refs)+' exactly once and in order')
        if conductor != 'ANY' and ln['conductor'] != conductor:
            violations.append('GRAPH: incorrect conductor on '+lid)
        return ln
    if d['unit'] == 'VA':
        ids = {'existing125','total'}
        if m['reading']['unit'] in ('kVA','kW'): ids.add('norm')
        if mode == 'precalculated':
            ids.add('newTerm'); node('total','sum',['existing125','newTerm'])
        else: node('total','identity',['existing125'])
        if set(byid) != ids: violations.append('GRAPH: unexpected/disconnected VA line(s)')
        if not lines or lines[-1]['id'] != 'total':violations.append('GRAPH: last VA line must be total')
        return violations
    if d['unit'] != 'A':return ['GRAPH: unexpected complete-demand unit']
    if m['readingScope']=='per_conductor':
        keys=[k for k,v in (m['readingsPerConductor'] or {}).items() if v is not None]
    elif m['readingScope']=='highest_loaded_conductor': keys=['measured']
    else:return ['GRAPH: unsupported A reading scope']
    if not keys:return ['GRAPH: no operative conductor reading']
    ids={f'e_{k}' for k in keys}|{'governing'}
    terminals={k:'e_'+k for k in keys}
    for k in keys: node('e_'+k,'multiply',[None],None if k=='measured' else k)
    if mode=='precalculated':
        pre=new['precalculated'];conn=pre['connection']
        if conn=='LN':
            leg=pre['leg']; nid='n_'+str(leg)
            if leg not in keys:return violations+['GRAPH: LN leg is not an operative conductor']
            affected=[leg];node(nid,'divide_by_voltage',[None],leg)
        elif conn in ('LL','3PH'):
            nid='n_LL' if conn=='LL' else 'n_3PH';affected=keys
            node(nid,'divide_by_voltage' if conn=='LL' else 'divide_by_sqrt3_voltage',[None])
        else:return violations+['GRAPH: unsupported new-term connection']
        ids.add(nid)
        for k in affected:
            tid='t_'+k;ids.add(tid)
            node(tid,'sum',['e_'+k,nid],None if k=='measured' else k)
            terminals[k]=tid
    if set(byid)!=ids:violations.append('GRAPH: missing/unexpected/disconnected A line(s)')
    vals={k:byid[lid]['result']['value'] for k,lid in terminals.items() if lid in byid}
    g=byid.get('governing')
    if len(vals)!=len(keys) or not vals or not g:
        return violations+['GRAPH: cannot establish all conductor terminals/governing']
    largest=max(vals.values());valid_governing={terminals[k] for k,v in vals.items() if v==largest}
    if g['op']!='identity' or len(g['operands'])!=1 or g['operands'][0]['ref'] not in valid_governing:
        violations.append('GRAPH: governing must select a maximum terminal, not a smaller conductor')
    if g['result']['value']!=largest or d['totalOnConductorA']!=largest:
        violations.append('GRAPH: final A total differs from maximum conductor terminal')
    if lines[-1]['id']!='governing':violations.append('GRAPH: last A line must be governing')
    cap=result['existingCapacity']
    if cap['status'] in ('adequate','inadequate'):
        expected=[None if k=='measured' else k for k in keys]
        actual=[c['conductor'] for c in cap['comparisons']]
        if Counter(actual)!=Counter(expected):violations.append('GRAPH: exact verdict must compare every operative conductor exactly once')
        for c in cap['comparisons']:
            k='measured' if c['conductor'] is None else c['conductor']
            if k not in vals or c['demandValueRaw']!=vals[k]:violations.append('GRAPH: comparison does not use its terminal conductor total')
    return violations
