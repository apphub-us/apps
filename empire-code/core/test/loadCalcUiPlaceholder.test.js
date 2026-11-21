'use strict';
/**
 * LC-UI-PLACEHOLDER-1 — empty 220.82 count fields read as examples, not entered values.
 *
 * Presentation only: the three ambiguous numeric placeholders carry "e.g.", and one #lcContent-scoped
 * ::placeholder rule subdues example text. The draft stays null and Calculate still marks the fields missing.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildHarness } = require('./helpers/loadCalcDom.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const rules = styles.flatMap((css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })));
const COUNTS = { lcSmallApplianceCircuits: ['e.g. 2', 'smallApplianceCircuits'], lcLaundryCircuits: ['e.g. 1', 'laundryCircuits'], lcNycAcCircuits: ['e.g. 0', 'nycAcCircuitCount'] };
function fresh82() { const h = buildHarness(); h.api.lcInit(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82'); return h; }

describe('LC-UI-PLACEHOLDER-1 — example placeholders', () => {
  test('the three ambiguous 220.82 count placeholders are marked "e.g."; the existing examples are unchanged', () => {
    const h = fresh82();
    for (const [id, [ph]] of Object.entries(COUNTS)) assert.strictEqual(h.$(id).attrs.placeholder, ph, id);
    assert.strictEqual(h.$('lcFloorArea').attrs.placeholder, 'e.g. 1500');
    assert.strictEqual(h.$('lcConductorAmpacity').attrs.placeholder, 'e.g. 200');
  });
  test('before user input the controls and the draft stay empty (placeholder is never a value)', () => {
    const h = fresh82(); const d = h.state().snapshot.dwelling;
    for (const [id, [, key]] of Object.entries(COUNTS)) {
      assert.strictEqual(h.$(id).value, '', id + ' control is empty');
      assert.strictEqual(h.$(id).attrs.value, undefined, id + ' has no value attribute');
      assert.strictEqual(d[key], null, 'dwelling.' + key + ' is null');
    }
    assert.strictEqual(d.floorAreaFt2, null); assert.strictEqual(h.state().snapshot.optional82.conductorAmpacityA.value, null);
  });
  test('Calculate still marks the empty count fields as missing', () => {
    const h = fresh82(); h.$('lcCalcBtn').dispatch('click');
    const fields = h.state().result.problems.map((p) => p.field);
    for (const [id, [, key]] of Object.entries(COUNTS)) {
      assert.ok(fields.includes('dwelling.' + key), key + ' reported');
      assert.ok(h.$(id)._classes.has('lc-calc-invalid'), id + ' marked');
      assert.strictEqual(h.$(id).attrs['aria-invalid'], 'true', id);
    }
  });
});

describe('LC-UI-PLACEHOLDER-1 — placeholder styling', () => {
  const ph = rules.filter((r) => /placeholder/.test(r.selector));
  test('exactly one new placeholder rule, scoped to #lcContent, subdued and on the pseudo-element only', () => {
    const lc = ph.filter((r) => /#lcContent/.test(r.selector));
    assert.strictEqual(lc.length, 1);
    assert.strictEqual(lc[0].selector, '#lcContent input::placeholder');
    assert.match(lc[0].body, /color: #858585;/); assert.match(lc[0].body, /font-style: italic;/);
    assert.ok(!/font-size/.test(lc[0].body), 'the 16px field policy is not touched');
    assert.deepStrictEqual(ph.filter((r) => !/#lcContent/.test(r.selector)).map((r) => r.selector), ['textarea::placeholder'], 'no global placeholder rule added');
  });
  test('entered input text colour and whole-input opacity are unchanged', () => {
    const shared = rules.find((r) => r.selector === 'select, input[type=number]'); assert.match(shared.body, /color: var\(--text\);/);
    const text = rules.find((r) => r.selector === '#lcContent input[type=text]'); assert.match(text.body, /color: var\(--text\);/);
    const lcInput = rules.filter((r) => /#lcContent[^,]*\binput\b/.test(r.selector) && !/::placeholder/.test(r.selector));
    for (const r of lcInput) assert.ok(!/(^|[;\s])opacity:/.test(r.body), 'no opacity on ' + r.selector);
    assert.ok(!lcInput.some((r) => /(^|[;\s])color:/.test(r.body) && r.selector !== '#lcContent input[type=text]'), 'no other Load Calc input colour rule');
  });
});
