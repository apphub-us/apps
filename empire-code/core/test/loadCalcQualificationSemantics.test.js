'use strict';
/**
 * LC-QUALIFICATION-SEMANTICS-1 — bounded presentation tests.
 * REAL flows use the existing DOM harness, control events and actual generated module; the source module is the parity oracle.
 * SYNTHETIC cases replace only returned qualification data to exercise renderer resilience, never to claim B82 reachability.
 * This file is authored for coordinator execution; no worker test run is claimed.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildHarness } = require('./helpers/loadCalcDom.js');
const S = require('../src/calc/loadCalcServiceSizing.js');

const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
const COND = (path, material) => [['lcSvcSizingPath', path], ['lcSvcMaterial', material], ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'], ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']];
const fill = (h, pairs) => pairs.forEach(([id, v]) => h.set(id, v));
const calc = (h) => h.$('lcCalcBtn').dispatch('click');
const assess = (h) => h.$('lcSvcAssessBtn').dispatch('click');
const shown = (el) => el.tagName === '#text' ? el._text : el.attrs.hidden !== undefined || el.style.display === 'none' ? '' : el.children.map(shown).join('');
const qbox = (h) => {
  const b = h.$('lcSvcResult').querySelectorAll('.lc-svc-box').find((x) => x.children[0].textContent === 'QUALIFICATION CHECK');
  assert.ok(b, 'qualification block exists'); return b;
};
const qtext = (h) => shown(qbox(h));
const details = (h) => {
  const b = h.$('lcSvcResult').querySelectorAll('button').find((x) => x.textContent === 'Calculation details & sources');
  assert.ok(b, 'existing disclosure attached'); return { button: b, body: h.$(b.attrs['aria-controls']) };
};
const clone = (v) => v && typeof v === 'object' ? Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
function driveB0(h, options) {
  const p = Object.assign({ declared: 200, area: 1500 }, options);
  fill(h, [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'opt_220_82'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_balanced_LN'], ['lcDeclBalancedLN', 'yes'],
    ['lcFloorArea', String(p.area)], ['lcSmallApplianceCircuits', '2'], ['lcLaundryCircuits', '1'], ['lcNycAcCircuits', '0'], ['lcArrangement', 'ac_only'], ['lcSingleSupplySet', 'yes'],
    ['lcConductorAmpacity', p.declared === null ? '' : String(p.declared)], ['lcNycAcException', 'yes']]);
  for (const [preset, va] of [[0, 12000], [3, 4500], [1, 5000], [2, 1200], [4, 5000]]) {
    h.$('lcPresetName').value = String(preset); h.$('lcPresetVA').value = String(va); h.$('lcAddLoad').dispatch('click');
  }
  const cards = h.$('lcLoads').querySelectorAll('.lc-load');
  for (const [i, role, value] of [[2, 'inclusion', 'not_on_counted_laundry_circuit'], [3, 'inclusion', 'fixed_or_permanently_connected'], [4, 'coverage', 'yes']]) {
    const el = cards[i].querySelectorAll('select').find((x) => x.attrs['data-role'] === role); assert.ok(el);
    el.value = value; el.dispatch('change');
  }
  h.set('lcInventoryComplete', 'yes');
}
function ready(options) {
  const p = Object.assign({ rating: 200, path: 'dwelling_83pct_310_12', material: 'Cu' }, options);
  const h = buildHarness(); h.api.lcInit(); driveB0(h, p); calc(h);
  fill(h, PLAN); h.set('lcSvcSelectedRating', String(p.rating)); fill(h, COND(p.path, p.material)); return h;
}
function parity(h) {
  const a = h.api.LC_SVC.analysis; assert.ok(a);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(S.analyzePrototype(h.state().lastRequest, h.api.lcSvcDesignObject())), 'raw module result unchanged');
  assert.strictEqual(a.operative, false); assert.strictEqual(a.installationApproved, false); assert.strictEqual(a.globalCodeCompliance, 'not_verified');
  return a;
}
function rawDiagnostic(h, q) {
  const { body } = details(h);
  assert.ok(body.textContent.includes('Qualification check — original module diagnostic'));
  assert.ok(body.textContent.includes('Module status' + q.status), 'raw status inspectable');
  for (const r of Array.isArray(q.reasons) ? q.reasons : []) if (r && typeof r === 'object') {
    if (r.code !== undefined) assert.ok(body.textContent.includes(String(r.code)), 'original reason code: ' + r.code);
    if (r.message !== undefined) assert.ok(body.textContent.includes(String(r.message)), 'original message: ' + r.code);
  }
  if (q.note !== undefined && q.note !== null) assert.ok(body.textContent.includes(String(q.note)), 'original note inspectable');
}
const THRESHOLD = /Ampacity thresholdmet in the current model/;
const LIMIT = /This ampacity check alone does not establish overall method qualification, adequate conductor capacity or code compliance/;

describe('LC-QUALIFICATION-SEMANTICS-1 — REAL reachable module flows', () => {
  const cases = [
    ['q200, general200 Cu, unchanged', 200, 200, 'general_table_75C', 'Cu', 200, 'premise_unchanged', true],
    ['q230, general200 Cu, difference downward', 230, 200, 'general_table_75C', 'Cu', 200, 'revalidation_required', false],
    ['q200, dwelling200 Cu, difference downward', 200, 200, 'dwelling_83pct_310_12', 'Cu', 175, 'revalidation_required', false],
    ['q100, dwelling200 Cu, difference upward', 100, 200, 'dwelling_83pct_310_12', 'Cu', 175, 'revalidation_required', false],
    ['q200, dwelling100 Cu, open interpretation', 200, 100, 'dwelling_83pct_310_12', 'Cu', 85, 'review_required', false],
    ['q200, dwelling100 Al, open interpretation', 200, 100, 'dwelling_83pct_310_12', 'Al', 90, 'review_required', false],
    ['q200, dwelling110 Cu, at threshold', 200, 110, 'dwelling_83pct_310_12', 'Cu', 100, 'revalidation_required', false],
    ['q200, dwelling110 Al, at threshold', 200, 110, 'dwelling_83pct_310_12', 'Al', 100, 'revalidation_required', false]
  ];
  for (const [label, declared, rating, path, material, ampacity, status, available] of cases) {
    test(label, () => {
      const h = ready({ declared, rating, path, material });
      const state = JSON.stringify(h.state()); const payload = JSON.stringify(h.api.lcFavPayload());
      assess(h); const a = parity(h); const u = a.ungroundedConductors; const q = u.qualificationConsistency; const t = qtext(h);
      assert.strictEqual(q.status, status); assert.strictEqual(q.declaredQualificationAmpacityA, declared); assert.strictEqual(q.candidateTableAmpacity75CA, ampacity);
      assert.strictEqual(q.b82SoftwareGateMinA, 100); assert.strictEqual(u.tableCandidate.ampacity75CA, ampacity);
      assert.strictEqual(u.recommendationAvailable, available); if (!available) assert.strictEqual(u.size, null);
      assert.strictEqual(a.calcBasis.totalVA, 23680); assert.strictEqual(a.calcBasis.lineADisplay, '98.7 A');
      assert.deepStrictEqual(qbox(h).querySelectorAll('.lc-svc-cell-val').map((x) => x.textContent), [declared + ' A', ampacity + ' A']);
      assert.strictEqual(JSON.stringify(h.state()), state, 'render preserves request, snapshot/provenance, result and evaluation count');
      assert.strictEqual(JSON.stringify(h.api.lcFavPayload()), payload, 'exported lcv3 payload unchanged');
      if (status === 'review_required') {
        assert.ok(!THRESHOLD.test(t)); assert.match(t, /relationship with the conditional sizing path remains unresolved/);
        assert.match(t, /documented interpretation\/model decision is needed/); assert.match(t, /substituting a convenient declaration does not resolve it/);
      } else {
        assert.match(t, THRESHOLD); assert.match(t, LIMIT); assert.ok(!/open model interpretation/.test(t));
        if (status === 'premise_unchanged') {
          assert.match(t, /Declared premiseunchanged/); assert.match(t, /Model premise unchanged — not installation approval/);
        } else {
          assert.match(t, /Declared premisedifferent — review needed/);
          assert.match(t, /difference alone does not alter the current model's calculated demand or current/);
          assert.match(t, /Review what the declared value describes and the documented basis and conditions of the intended conductor set/);
          assert.match(t, /Update the declaration only when those facts change or need correction, then use Recalculate and Reassess service sizing/);
          assert.match(t, /Matching the table or repeating Reassess does not validate changed facts/);
          assert.ok(!/Verify the installed conductor|enter 175|set to 175/i.test(t));
        }
      }
      if (!available) assert.ok(shown(h.$('lcSvcResult')).includes('Conditional table reference — not a selection'));
      assert.ok(!/violation/i.test(t.replace(/NOT an NEC violation finding/g, '')), 'no violation finding');
      rawDiagnostic(h, q);
    });
  }
  for (const [declared, status, code] of [[null, 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN'], [99.99, 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED']]) {
    test('q' + declared + ' stops in B82, before a service or qualification comparison exists', () => {
      const h = buildHarness(); h.api.lcInit(); driveB0(h, { declared }); calc(h);
      const r = h.state().result; assert.strictEqual(r.status, status); assert.ok(JSON.stringify(r).includes(code));
      assert.strictEqual(r.demand.totalVA, null); assert.strictEqual(r.current.lineA, null); assert.deepStrictEqual(r.demand.lines, []);
      assert.strictEqual(h.api.lcSvcAssess(), false); assert.strictEqual(h.api.LC_SVC.analysis, null);
      assert.match(h.$('lcSvcGate').textContent, /SERVICE SIZING UNAVAILABLE FOR THIS CALCULATION/);
      assert.ok(!/Minimum standard-rating candidate|Design-preview conductor candidate|Conditional table reference|Ampacity thresholdmet/.test(h.$('lcSvcResult').textContent));
      assert.strictEqual(h.state().snapshot.optional82.conductorAmpacityA.value, declared);
    });
  }
  test('higher demand with q100: a met predicate is not conductor adequacy', () => {
    const h = ready({ declared: 100, area: 15000 }); assess(h); const a = parity(h);
    assert.strictEqual(a.calcBasis.calcStatus, 'COMPLETE'); assert.strictEqual(a.calcBasis.totalVA, 39880);
    assert.strictEqual(a.calcBasis.lineA, 39880 / 240); assert.strictEqual(a.minimumService.ratingA, 175);
    assert.strictEqual(a.ungroundedConductors.qualificationConsistency.declaredQualificationAmpacityA, 100);
    assert.strictEqual(a.ungroundedConductors.recommendationAvailable, false); assert.strictEqual(a.ungroundedConductors.size, null);
    assert.match(qtext(h), THRESHOLD); assert.match(qtext(h), LIMIT);
    assert.strictEqual(h.state().result.existingCapacity.status, 'not_assessed');
  });
});

/** Synthetic renderer injection: the real module builds the entire analysis; only q is edited in the returned COPY. */
function syntheticHarness() {
  const h = ready(); const mod = h.EC.loadCalcServiceSizing;
  let change = () => {}; let returned, beforeRaw, beforeState, calls = 0, atReturn = 0;
  h.EC.loadCalcServiceSizing = Object.assign({}, mod, { analyzePrototype: (request, design) => {
    calls++; const a = mod.analyzePrototype(request, design); if (!design) return a;
    const out = clone(a); change(out.ungroundedConductors.qualificationConsistency, out);
    beforeRaw = clone(out); beforeState = JSON.stringify(h.state()); returned = freeze(out); atReturn = calls; return returned;
  } });
  return {
    h,
    render(fn) {
      change = fn; assess(h);
      assert.strictEqual(h.api.LC_SVC.analysis, returned, 'renderer retains the exact frozen synthetic module return');
      assert.deepStrictEqual(returned, beforeRaw, 'raw analysis and q are unmodified');
      assert.strictEqual(JSON.stringify(h.state()), beforeState, 'render preserves application state and provenance');
      assert.strictEqual(calls, atReturn, 'render does not evaluate the module again');
      return returned.ungroundedConductors.qualificationConsistency;
    },
    calls: () => calls
  };
}
const setReason = (q, status, code, message) => { q.status = status; q.reasons = [{ stage: 'qualificationConsistency', code, field: 'snapshot.optional82.conductorAmpacityA', sourceIds: ['ENGINE_B82'], sections: ['220.82(A)'], message }]; };
function unavailable(h) {
  const t = qtext(h); assert.match(t, /Comparisonunavailable/); assert.ok(!THRESHOLD.test(t)); assert.ok(!/Declared premiseunchanged|Declared premisedifferent|open model interpretation/.test(t));
}

describe('LC-QUALIFICATION-SEMANTICS-1 — SYNTHETIC renderer resilience, not reachable B82 approvals', () => {
  test('missing/invalid declaration has its own unavailable diagnostic; it never becomes a 310.12 interpretation', () => {
    const s = syntheticHarness();
    for (const value of [null, undefined, '200', NaN, Infinity]) {
      const q = s.render((x) => { x.declaredQualificationAmpacityA = value; x.candidateTableAmpacity75CA = 85; setReason(x, 'review_required', 'QUALIFICATION_PREMISE_UNAVAILABLE', 'synthetic: no declared qualification ampacity to compare'); });
      unavailable(s.h); assert.match(qtext(s.h), /declared qualification ampacity is missing or invalid/);
      assert.ok(qtext(s.h).includes(q.reasons[0].message), 'unavailable reason remains default-visible');
      assert.strictEqual(qbox(s.h).querySelectorAll('.lc-svc-cell-val')[0].textContent, '—', 'no coercion');
      rawDiagnostic(s.h, q);
    }
  });
  test('invalid numeric comparison data (each of three fields) has no positive fallback or coercion', () => {
    const s = syntheticHarness();
    for (const field of ['declaredQualificationAmpacityA', 'candidateTableAmpacity75CA', 'b82SoftwareGateMinA']) {
      for (const value of [null, undefined, '200', NaN, Infinity, -Infinity]) {
        const q = s.render((x) => { x[field] = value; });
        unavailable(s.h); assert.ok(Object.is(q[field], value), field + ' retained verbatim'); rawDiagnostic(s.h, q);
        if (field !== 'b82SoftwareGateMinA') assert.strictEqual(qbox(s.h).querySelectorAll('.lc-svc-cell-val')[field === 'declaredQualificationAmpacityA' ? 0 : 1].textContent, '—');
      }
    }
    for (const [field, value] of [['b82SoftwareGateMinA', 0], ['b82SoftwareGateMinA', -1], ['candidateTableAmpacity75CA', 0], ['candidateTableAmpacity75CA', -1], ['declaredQualificationAmpacityA', 99]]) {
      s.render((q) => { q[field] = value; }); unavailable(s.h);
    }
  });
  test('unknown, absent, contradictory and malformed reason/status combinations stay neutral; unknown messages stay visible', () => {
    const s = syntheticHarness();
    const cases = [
      (q) => { q.status = 'future_unknown_status'; },
      (q) => { q.status = 'premise_unchanged'; },
      (q) => { q.declaredQualificationAmpacityA = q.candidateTableAmpacity75CA; },
      (q) => { q.reasons = []; },
      (q) => { q.reasons = null; },
      (q) => { q.reasons = [null]; },
      (q) => { q.reasons = 'synthetic malformed reason'; },
      (q) => { q.reasons[0].sections = '220.82(A)'; },
      (q) => { q.reasons[0].sections = [123]; },
      (q) => { delete q.reasons[0].message; },
      (q) => { q.reasons[0].message = null; },
      (q) => { q.reasons[0].message = ''; },
      (q) => { q.candidateTableAmpacity75CA = 85; },
      (q) => { setReason(q, 'review_required', 'B82_310_12_INTERPRETATION_PENDING', 'synthetic interpretation reason with above-threshold data'); },
      (q) => { q.declaredQualificationAmpacityA = null; q.candidateTableAmpacity75CA = 85; setReason(q, 'review_required', 'B82_310_12_INTERPRETATION_PENDING', 'synthetic contradictory missing declaration'); },
      (q) => { setReason(q, 'review_required', 'QUALIFICATION_PREMISE_UNAVAILABLE', 'synthetic unavailable reason with finite declaration'); },
      (q) => { setReason(q, 'revalidation_required', 'FUTURE_QUALIFICATION_REASON', 'synthetic unknown qualification reason'); },
      (q) => { q.reasons.push({ code: 'FUTURE_EXTRA_REASON', message: 'synthetic extra unknown reason', sections: [] }); },
      (q) => { q.reasons.push(Object.assign({}, q.reasons[0], { code: 'QUALIFICATION_PREMISE_UNCHANGED', message: 'synthetic contradictory extra known reason' })); }
    ];
    for (const change of cases) {
      const q = s.render(change); unavailable(s.h); rawDiagnostic(s.h, q);
      for (const r of Array.isArray(q.reasons) ? q.reasons : []) if (r && /^FUTURE_/.test(r.code)) assert.ok(qtext(s.h).includes(r.message), 'unknown reason default-visible');
    }
  });
  test('present false, zero, empty-string or array q is invalid; only absent q is not evaluated', () => {
    const s = syntheticHarness();
    for (const value of [false, 0, '', []]) { s.render((q, a) => { a.ungroundedConductors.qualificationConsistency = value; }); unavailable(s.h); }
    for (const value of [null, undefined]) {
      s.render((q, a) => { a.ungroundedConductors.qualificationConsistency = value; });
      assert.match(qtext(s.h), /Not evaluated/); assert.ok(!THRESHOLD.test(qtext(s.h)));
    }
  });
  test('the returned threshold controls presentation; no independent fixed threshold is inserted', () => {
    const s = syntheticHarness();
    s.render((q) => { q.b82SoftwareGateMinA = 90; }); assert.match(qtext(s.h), THRESHOLD); assert.match(qtext(s.h), /threshold \(90 A\)/);
    s.render((q) => { q.b82SoftwareGateMinA = 180; }); unavailable(s.h);
    s.render((q) => { q.b82SoftwareGateMinA = 180; setReason(q, 'review_required', 'B82_310_12_INTERPRETATION_PENDING', 'synthetic below the returned threshold'); });
    assert.ok(!THRESHOLD.test(qtext(s.h))); assert.match(qtext(s.h), /threshold \(180 A\)/); assert.match(qtext(s.h), /documented interpretation\/model decision/);
  });
  test('original diagnostics and note remain text; disclosure changes no raw object, request, export, evaluation, focus or storage', () => {
    const s = syntheticHarness(); const q = s.render((x) => { x.note = '<b>synthetic raw note</b>'; });
    const h = s.h; const { button, body } = details(h);
    const before = { raw: h.api.LC_SVC.analysis, state: JSON.stringify(h.state()), export: JSON.stringify(h.api.lcFavPayload()), design: JSON.stringify(h.api.lcSvcDesignObject()), calls: s.calls(), data: h.store.data, sets: h.store.sets, focus: h.dom.document.focusLog.focuses.length, scroll: h.dom.document.focusLog.scrolls.length };
    rawDiagnostic(h, q); assert.strictEqual(button.attrs['aria-expanded'], 'false');
    for (const expanded of ['true', 'false']) {
      button.dispatch('click'); assert.strictEqual(button.attrs['aria-expanded'], expanded);
      assert.strictEqual(body.attrs.hidden, expanded === 'true' ? undefined : '');
      assert.strictEqual(h.api.LC_SVC.analysis, before.raw); assert.strictEqual(JSON.stringify(h.state()), before.state);
      assert.strictEqual(JSON.stringify(h.api.lcFavPayload()), before.export); assert.strictEqual(JSON.stringify(h.api.lcSvcDesignObject()), before.design);
      assert.strictEqual(s.calls(), before.calls); assert.strictEqual(h.store.data, before.data); assert.strictEqual(h.store.sets, before.sets);
      assert.strictEqual(h.dom.document.focusLog.focuses.length, before.focus); assert.strictEqual(h.dom.document.focusLog.scrolls.length, before.scroll);
    }
    assert.ok(h.nodes().every((n) => n.innerHTMLWrites === 0), 'raw text never becomes HTML');
    const refs = body.querySelectorAll('span').filter((x) => x.attrs['data-sec'] === '220.82(A)'); assert.ok(refs.length);
  });
});

describe('LC-QUALIFICATION-SEMANTICS-1 — help and existing lifecycle', () => {
  test('help identifies a documented planned set, leaves unknown unknown and keeps the original control and placeholder', () => {
    const h = buildHarness(); h.api.lcInit(); h.set('lcMethod', 'opt_220_82');
    const el = h.$('lcConductorAmpacity'); const text = el.parentNode.textContent;
    assert.match(text, /identified conductor set under documented conditions/); assert.match(text, /documented planned set for a new design/);
    assert.match(text, /not the breaker or service rating/); assert.match(text, /Leave unknown if not established/);
    assert.match(text, /cannot start a preliminary load calculation before this premise is established/);
    assert.strictEqual(el.type, 'number'); assert.strictEqual(el.attrs.placeholder, 'e.g. 200'); assert.strictEqual(el.value, '');
    assert.strictEqual(h.state().snapshot.optional82.conductorAmpacityA.value, null);
  });
  test('load edit/revert and Recalculate keep service results discarded until an explicit fresh Reassess', () => {
    const h = ready(); assess(h); parity(h); details(h).button.dispatch('click');
    h.set('lcConductorAmpacity', '230'); assert.strictEqual(h.api.LC_SVC.analysis, null);
    h.set('lcConductorAmpacity', '200'); assert.strictEqual(h.api.LC_SVC.analysis, null);
    assert.strictEqual(h.$('lcSvcResult').querySelectorAll('.lc-svc-pair').length, 0);
    calc(h); assert.strictEqual(h.api.LC_SVC.analysis, null); assess(h); const a = parity(h);
    assert.strictEqual(a.ungroundedConductors.qualificationConsistency.status, 'revalidation_required');
    assert.strictEqual(details(h).button.attrs['aria-expanded'], 'false');
  });
});
