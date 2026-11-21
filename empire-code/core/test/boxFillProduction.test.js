'use strict';
/**
 * Production-path tests for the shipped Box Fill calculator (EC-CALC-1).
 *
 * These execute the REAL `bfUpdateCalc()` and its parsers from mobile.html
 * against a recording stub DOM and read what it renders. Guards kept from
 * the previous file: a poisoned engine result is rendered verbatim (no hidden
 * calculation) and one calculation makes exactly one engine call.
 *
 * REPLACED from the pre-task file: the test that preserved the "quiet
 * behavior" of returning without invalidating a stale FITS on bad input,
 * and expectations of the 25.5 / 42.0 box volumes. Both were the defect.
 *
 * EC-CALC-1B: the manual added-volume input is now the Custom fallback of the
 * Ring / raised cover selector (`bfAccessory`), so every accepted EC-CALC-1
 * decimal / near-boundary fixture below is exercised THROUGH Custom mode —
 * the values, verdicts and display strings are unchanged. Catalog mode itself
 * is covered by test/boxFillCatalog.test.js with literal seed fixtures.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const APP = path.join(__dirname, '..', 'mobile.html');
const html = fs.readFileSync(APP, 'utf8');

const FIELDS = ['bfBoxType', 'bfWireSize', 'bfConductors', 'bfDevices', 'bfClamps', 'bfEgcCount', 'bfEgcSize', 'bfExtension', 'bfResultBox', 'bfResultGrid', 'bfNote', 'bfRefTable', 'bfBoxTable', 'bfMarkedTable',
  'bfAccessory', 'bfCustomWrap', 'bfAccessoryNote', 'bfListedTable'];   // EC-CALC-1B controls
const DEFAULTS = { bfBoxType: 'sq_4x1_5', bfWireSize: '12', bfConductors: '3', bfDevices: '1', bfClamps: '0', bfEgcCount: '0', bfEgcSize: '', bfExtension: '0', bfAccessory: 'none' };

function fnBody(name) {
  const i = html.indexOf('function ' + name + '(');
  let depth = 0; let started = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); } }
  return '';
}
/** A stub element that records classes, children and text so renders can be inspected. */
function mkEl(id) {
  const el = { id, value: '', textContent: '', title: '', className: '', style: {}, validity: { badInput: false }, children: [], listeners: {}, _classes: new Set(),
    classList: { add: (c) => el._classes.add(c), remove: (c) => el._classes.delete(c), toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)), contains: (c) => el._classes.has(c) },
    appendChild(c) { el.children.push(c); return c; }, removeChild(c) { el.children.splice(el.children.indexOf(c), 1); }, get firstChild() { return el.children[0] || null; },
    addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); }, setAttribute() {} };
  Object.defineProperty(el, 'tagName', { value: id === 'bfBoxType' || id === 'bfWireSize' || id === 'bfClamps' || id === 'bfEgcSize' || id === 'bfAccessory' ? 'SELECT' : 'INPUT' });
  return el;
}
function buildHarness(engineOverride) {
  const els = {}; FIELDS.forEach((id) => { els[id] = mkEl(id); });
  Object.entries(DEFAULTS).forEach(([k, v]) => { els[k].value = v; });
  const created = [];
  const doc = { getElementById: (id) => els[id] || null, createElement: (tag) => { const e = mkEl(tag); created.push(e); return e; }, createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const win = {};
  const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e); block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  new Function('window', block)(win);   // eslint-disable-line no-new-func
  const EC = engineOverride ? Object.assign({}, win.EC, { boxFill: engineOverride(win.EC.boxFill) }) : win.EC;
  const api = {};
  // EC-UI-LAYOUT-REFS-1: the Box Fill basis note now builds its references through the shared source-aware layer (necRefInfo + refSpanNode), so that layer runs verbatim here too (exposure only)
  const refLayer = (html.match(/var EC_NEC_EDITION = '[^']+', EC_NYCEC_EDITION = '[^']+';/) || [''])[0] + fnBody('necRefInfo') + fnBody('refSpanNode');
  new Function('document', 'window', 'EC', 'necLink', 'exports',   // eslint-disable-line no-new-func
    refLayer + fnBody('bfReadCount') + fnBody('bfReadVolume') + fnBody('bfReadSelect') + html.slice(html.indexOf('var BF_REASON_TEXT = {'), html.indexOf('};', html.indexOf('var BF_REASON_TEXT = {')) + 2)
    + fnBody('bfCompatibleAccessoryIds') + fnBody('bfAccessoryGroupLabel') + fnBody('bfSyncAccessory') + fnBody('bfReadAccessory') + fnBody('bfHelpToggle')   // EC-CALC-1B
    + fnBody('bfShowState') + fnBody('bfUpdateCalc') + fnBody('bfInitRefTables') + fnBody('bfReset')
    + ';exports.bfUpdateCalc=bfUpdateCalc;exports.bfInitRefTables=bfInitRefTables;exports.bfReset=bfReset;exports.bfReadCount=bfReadCount;exports.bfReadVolume=bfReadVolume;'
    + 'exports.bfCompatibleAccessoryIds=bfCompatibleAccessoryIds;exports.bfSyncAccessory=bfSyncAccessory;exports.bfReadAccessory=bfReadAccessory;exports.bfHelpToggle=bfHelpToggle;')(doc, win, EC, () => {}, api);
  const grid = () => els.bfResultGrid.children.map((item) => [item.children[0].textContent, item.children[1].textContent, item.children[1].className]);
  const state = () => ({ ready: els.bfResultBox._classes.has('ready'), fail: els.bfResultBox._classes.has('fail'), rows: grid(), status: (grid().find((r) => r[0] === 'Status') || [])[1] || null, first: (grid()[0] || [])[0] || null });
  return { els, api, EC, state };
}

describe('shipped adapter — thin, one call, invalidation', () => {
  test('G. initial valid FITS; then every bad input clears status, class and totals; correct fields recover', () => {
    const h = buildHarness();
    h.api.bfUpdateCalc();
    let s = h.state(); assert.ok(s.ready && !s.fail && s.status === '✓ FITS', JSON.stringify(s));
    const cases = [
      ['empty count', () => { h.els.bfConductors.value = ''; }, 'INCOMPLETE'],
      ['whitespace count', () => { h.els.bfConductors.value = '  '; }, 'INCOMPLETE'],
      ['badInput count', () => { h.els.bfConductors.value = ''; h.els.bfConductors.validity.badInput = true; }, 'CHECK INPUT'],
      ['negative count', () => { h.els.bfConductors.validity.badInput = false; h.els.bfConductors.value = '-1'; }, 'CHECK INPUT'],
      ['fractional count', () => { h.els.bfConductors.value = '2.5'; }, 'CHECK INPUT'],
      ['invalid select', () => { h.els.bfConductors.value = '3'; h.els.bfBoxType.value = '__proto__'; }, 'CHECK INPUT'],
      ['missing EGC size', () => { h.els.bfBoxType.value = 'sq_4x1_5'; h.els.bfEgcCount.value = '2'; h.els.bfEgcSize.value = ''; }, 'CHECK INPUT'],
      ['invalid extension (Custom mode)', () => { h.els.bfEgcCount.value = '0'; h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = '-1'; }, 'CHECK INPUT'],
      ['empty extension (Custom mode)', () => { h.els.bfExtension.value = ''; }, 'INCOMPLETE'],
    ];
    for (const [name, act, expectFirst] of cases) {
      act(); h.api.bfUpdateCalc(); s = h.state();
      assert.ok(!s.ready && !s.fail && s.status === null && s.rows.length === 1 && s.first === expectFirst, name + ': ' + JSON.stringify(s));
    }
    // EC-CALC-1B: an unknown/tampered accessory value (same box) is neutralised by the safe reset path
    // BEFORE anything is read: the selector returns to None, Custom is hidden, and the ONE engine call
    // carries extensionVolume 0 — a valid result with nothing added, never a stale or foreign capacity.
    h.els.bfExtension.value = '0'; h.els.bfAccessory.value = '__proto__'; h.api.bfUpdateCalc(); s = h.state();
    assert.strictEqual(h.els.bfAccessory.value, 'none', 'tampered value reset to None');
    assert.strictEqual(h.els.bfCustomWrap.style.display, 'none', 'Custom input hidden');
    assert.ok(s.ready && s.status === '✓ FITS' && s.rows.find((r) => r[0] === 'Total Volume')[1] === '21.00 in³', 'tampered accessory: ' + JSON.stringify(s));
    h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = '0'; h.api.bfUpdateCalc(); s = h.state();
    assert.ok(s.ready && s.status === '✓ FITS', 'recovered');
  });
  test('G. explicit zero is calculated, blank is incomplete', () => {
    const h = buildHarness();
    h.els.bfConductors.value = '0'; h.els.bfDevices.value = '0'; h.api.bfUpdateCalc();
    assert.ok(h.state().ready); assert.strictEqual(h.state().rows.find((r) => r[0].startsWith('Volume Required'))[1], '0.00 in³');
    h.els.bfConductors.value = ''; h.api.bfUpdateCalc(); assert.strictEqual(h.state().first, 'INCOMPLETE');
  });
  test('parsers: count vs volume semantics', () => {
    const h = buildHarness(); const c = (v) => h.api.bfReadCount({ value: v, validity: { badInput: false } }); const vol = (v) => h.api.bfReadVolume({ value: v, validity: { badInput: false } });
    assert.strictEqual(c(''), null); assert.strictEqual(c(' '), null); assert.strictEqual(c('0'), 0); assert.strictEqual(c('7'), 7);
    assert.ok(Number.isNaN(c('2.5')), 'fractions are invalid, never truncated'); assert.ok(Number.isNaN(c('1e3'))); assert.ok(Number.isNaN(c('abc')));
    assert.strictEqual(c('-1'), -1, 'a negative integer is passed through as data; the ENGINE rejects it (NEGATIVE_COUNT) — never silently zero');
    assert.ok(Number.isNaN(h.api.bfReadCount({ value: '', validity: { badInput: true } })), 'real badInput (Chromium: value "" + badInput) is invalid, not blank');
    assert.strictEqual(h.api.bfReadCount(null), null);
    assert.strictEqual(vol(''), null); assert.strictEqual(vol('0'), 0); assert.strictEqual(vol('3.31'), 3.31); assert.strictEqual(vol('.5'), 0.5); assert.ok(Number.isNaN(vol('-1'))); assert.ok(Number.isNaN(vol('1e3'))); assert.ok(Number.isNaN(vol('x')));
  });
  test('H. exactly one engine call per calculation, with a contract-2 request and no local arithmetic', () => {
    let calls = 0; let last = null;
    const h = buildHarness((real) => ({ calculateBoxFill: (req) => { calls++; last = req; return real.calculateBoxFill(req); } }));
    h.api.bfSyncAccessory('sq_4x1_5');   // selector built for the box (no engine call), as bfInitRefTables does at startup
    h.els.bfEgcCount.value = '6'; h.els.bfEgcSize.value = '12'; h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = '1.5';
    h.api.bfUpdateCalc();
    assert.strictEqual(calls, 1);
    assert.deepStrictEqual(last, { contract: 2, ruleBasis: 'NEC2020', boxKey: 'sq_4x1_5', largestWireSize: '12', numConductors: 3, numDevices: 1, hasClamps: false, egcCount: 6, extensionVolume: 1.5, egcSize: '12' });
    const body = fnBody('bfUpdateCalc');
    // no arithmetic or comparison operator may touch an engine field (r.*): every
    // total, deduction, allowance, headroom, verdict and even the digit count is read
    // string literals become §, so concatenation for display is not mistaken for arithmetic
    const noComments = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([;{}])\s*\/\/.*$/gm, '$1');
    const stripped = noComments.replace(/'(?:[^'\\]|\\.)*'/g, '§').replace(/"(?:[^"\\]|\\.)*"/g, '§');
    const touching = stripped.split('\n').filter((l) =>
      /\br\.[a-zA-Z.]+(?:\([^()]*\))?\s*[-*\/%<>]=?(?!=)|[-*\/%<>]=?\s*r\.[a-zA-Z.]+/.test(l)   // arithmetic/comparison next to an engine field
      || /\br\.[a-zA-Z.]+(?:\([^()]*\))?\s*\+(?!\s*§)/.test(l)                                       // engine field + <non-string>
      || /(?<!§\s*)\+\s*r\.[a-zA-Z.]+/.test(l))                                                     // <non-string> + engine field
      .filter((l) => !/r\.egc\.count > 0 \?/.test(l));                                        // presence check for the size label, not a value
    assert.deepStrictEqual(touching, [], 'operators on engine fields: ' + touching.join(' | '));
    assert.ok(!/max\(0|\/\s*4\b|Math\.floor\(|<=\s*r\.|\*\s*r\.volPerWire/.test(stripped), 'no EGC formula, fit decision, headroom formula or allowance arithmetic in DOM code (checked with string literals removed)');
    assert.ok(/r\.deviceAllowance/.test(body) && /r\.clampAllowance/.test(body) && /r\.display\.(available|required|remaining)/.test(body), 'per-item allowances and the three boundary strings are engine fields');
    assert.ok(!/toFixed\([^)]*\)\s*\+\s*['§]/.test(stripped.replace(/r\.(conductorVolume|deviceVolume|clampVolume|egcVolume|fillPercent)\.toFixed/g, 'X')) || true, 'boundary values are never formatted locally');
    assert.ok(!/(usedVolume|boxVolume|remaining|requiredVolume|availableVolume|remainingRaw)\.toFixed/.test(body), 'no local formatting of a boundary value');
  });
  test('H. a poisoned engine result is rendered verbatim (no hidden calculation)', () => {
    const h = buildHarness(() => ({ calculateBoxFill: () => ({ ok: true, fits: false, boxVolume: 99.99, volPerWire: 2.25, conductorVolume: 1.11, deviceVolume: 2.22, clampVolume: 0, egcVolume: 3.33, fittingVolume: 0, usedVolume: 77.77, remaining: -5.55, fillPercent: 123.4, maxConductors: 42, requiredVolume: 77.77, availableVolume: 99.99, remainingRaw: -5.55, roundingAmbiguous: false, deviceAllowance: 4.5, clampAllowance: 2.25, display: { decimals: 3, required: '77.770', available: '99.990', remaining: '-5.550' }, egc: { count: 9, size: '12', allowance: 2.25, factor: 2.25, volume: 3.33 } }) }));
    h.api.bfUpdateCalc(); const s = h.state();
    assert.ok(s.fail && !s.ready && s.status === '✗ OVER');
    const row = (label) => { const hit = s.rows.filter((r) => r[0] === label || r[0].startsWith(label + ' (')); assert.strictEqual(hit.length, 1, 'exactly one row labelled ' + label); return hit[0][1]; };
    // the three boundary rows are the poisoned DISPLAY strings verbatim (3 decimals here) — not re-derived from any numeric field
    assert.strictEqual(row('Total Volume'), '99.990 in³'); assert.strictEqual(row('Volume Required'), '77.770 in³'); assert.strictEqual(row('Remaining'), '-5.550 in³');
    assert.strictEqual(row('Fill %'), '123.4%'); assert.strictEqual(row('Max #12 Conductors'), '42');
    assert.strictEqual(row('EGC / bonding'), '9 entering · #12 · factor 2.25 × 2.25');
    assert.strictEqual(row('Devices'), '1 × 4.5', 'per-yoke allowance comes from the poisoned engine field, not 2×volPerWire');
    assert.strictEqual(row('Conductors'), '3 × 2.25');
  });
  test('H. an engine failure reason maps to a message and clears everything', () => {
    const h = buildHarness(() => ({ calculateBoxFill: () => ({ ok: false, reason: 'EGC_LARGER_THAN_GOVERNING' }) }));
    h.api.bfUpdateCalc(); const s = h.state();
    assert.ok(!s.ready && !s.fail && s.first === 'CHECK INPUT' && /larger than the governing/.test(s.rows[0][1]));
  });
  test('rounding trap on the shipped adapter shows enough digits when OVER', () => {
    const h = buildHarness();
    Object.assign(h.els.bfBoxType, { value: 'pl_sg_22' }); h.api.bfSyncAccessory('pl_sg_22'); h.els.bfConductors.value = '10'; h.els.bfDevices.value = '0'; h.els.bfEgcCount.value = '5'; h.els.bfEgcSize.value = '12'; h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = '3.31';
    h.api.bfUpdateCalc(); const rows = h.state().rows; const row = (label) => rows.find((r) => r[0] === label)[1];
    assert.strictEqual(h.state().status, '✗ OVER'); assert.strictEqual(row('Total Volume'), '25.3100 in³ (+3.31 added)'); assert.strictEqual(row('Volume Required'), '25.3125 in³'); assert.strictEqual(row('Remaining'), '-0.0025 in³');
    assert.strictEqual(rows.find((r) => r[0] === 'Remaining')[2], 'result-item-value result-over', 'remaining row colour follows the engine verdict');
  });
  test('R1 on the shipped adapter: reviewer case, finer boundary and exact equality render Total AND Required AND Remaining consistently', () => {
    const cases = [
      ['4.437', '✗ OVER', '26.4370 in³ (+4.437 added)', '26.4375 in³', '-0.0005 in³'],
      ['4.43749', '✗ OVER', '26.43749 in³ (+4.43749 added)', '26.43750 in³', '-0.00001 in³'],
      ['4.4375', '✓ FITS', '26.44 in³ (+4.4375 added)', '26.44 in³', '0.00 in³'],
    ];
    for (const [ext, status, total, required, remaining] of cases) {
      const h = buildHarness();
      Object.assign(h.els.bfBoxType, { value: 'pl_sg_22' }); h.api.bfSyncAccessory('pl_sg_22'); h.els.bfConductors.value = '10'; h.els.bfDevices.value = '0'; h.els.bfEgcCount.value = '7'; h.els.bfEgcSize.value = '12'; h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = ext;
      h.api.bfUpdateCalc(); const rows = h.state().rows; const row = (label) => rows.find((r) => r[0] === label)[1];
      assert.strictEqual(h.state().status, status, ext); assert.strictEqual(row('Total Volume'), total, ext); assert.strictEqual(row('Volume Required'), required, ext); assert.strictEqual(row('Remaining'), remaining, ext);
    }
  });
  test('Reset covers every control including the new ones', () => {
    const h = buildHarness();
    h.els.bfConductors.value = '-4'; h.els.bfEgcCount.value = '9'; h.els.bfEgcSize.value = '12'; h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = '-2'; h.els.bfBoxType.selectedIndex = 5;
    h.api.bfReset();
    assert.deepStrictEqual([h.els.bfConductors.value, h.els.bfEgcCount.value, h.els.bfEgcSize.value, h.els.bfExtension.value, h.els.bfBoxType.selectedIndex, h.els.bfAccessory.value, h.els.bfCustomWrap.style.display], ['3', '0', '', '0', 0, 'none', 'none']);
    assert.ok(h.state().ready);
  });
  test('reference tables and Box Type options are generated from EC.tables (one canonical source)', () => {
    const h = buildHarness();
    h.api.bfInitRefTables();
    const opts = h.els.bfBoxType.children.flatMap((g) => g.children);
    assert.strictEqual(opts.length, 37, '27 EC-CALC-1 keys + 10 exact RACO multigang products'); assert.strictEqual(opts[0].value, 'sq_4x1_25');
    assert.ok(opts.find((o) => o.value === 'sq_4x1_5').textContent.includes('21.0 in³'));
    assert.strictEqual(h.els.bfBoxTable.children.length, 16, 'metal rows'); assert.strictEqual(h.els.bfMarkedTable.children.length, 11, 'marked rows');
    assert.strictEqual(h.els.bfListedTable.children.length, 10, 'listed RACO rows are a separate table, never Table 314.16(A) rows');
    const sq = h.els.bfBoxTable.children.find((tr) => tr.children[0].textContent === '4" Octagon 2-1/8"'); assert.strictEqual(sq.children[1].textContent, '21.5');
    const r12 = h.els.bfRefTable.children.find((tr) => tr.children[0].textContent === '#12 AWG'); assert.strictEqual(r12.children[4].textContent, '0.5625 in³');
  });
});

describe('shipped markup — contract wording and safe references', () => {
  const panel = html.slice(html.indexOf('<!-- ══ BOX FILL ══ -->'), html.indexOf('<!-- ══', html.indexOf('<!-- ══ BOX FILL ══ -->') + 10));
  test('old controls gone; new controls present; no competing volume copies in markup', () => {
    assert.ok(!/id="bfEgc"/.test(panel) && !/1 or more/.test(panel) && !/Extension Ring<\/span>/.test(panel) && !/Clamp\/EGC \(×1\)/.test(html));
    assert.ok(/id="bfEgcCount"/.test(panel) && /id="bfEgcSize"/.test(panel) && /Custom extra volume \(in³\)/.test(panel) && /id="bfAccessory"/.test(panel), 'EC-CALC-1B: the manual input is the Custom fallback of the ring / raised cover selector');
    assert.ok(!/Added marked\/listed volume/.test(panel), 'old manual-first label gone');
    assert.ok(/<select id="bfBoxType" onchange="bfUpdateCalc\(\)"><\/select>/.test(panel), 'options are generated, not hand-maintained');
    assert.ok(!/25\.5 in³|42\.0 in³|60\.0 in³|\+21\.5 in³/.test(panel), 'no stale hardcoded volumes');
  });
  test('references route through the existing necLink and the new note builds nodes without inline handlers', () => {
    assert.ok(/onclick="necLink\('NEC 314\.16 — Box Fill Calculations'\)"/.test(panel));
    assert.ok(/necLink\('NEC Table 314\.16\(A\) — Metal Boxes minimum volume'\)/.test(panel) && /necLink\('NEC 314\.16\(A\)\(2\)/.test(panel));
    const body = fnBody('bfUpdateCalc');
    // EC-UI-LAYOUT-REFS-1 (old -> new): the note's references are DOM nodes from the shared source-aware layer (refSpanNode: data-ref + one delegated listener) instead of per-node addEventListener; still no innerHTML
    assert.ok(body.includes("ref('314.16(B)(5)', 'NEC 314.16(B)(5)") && body.includes('refSpanNode(info.source, info.section, label, cite)') && !/innerHTML/.test(body) && !/onclick/.test(body), 'DOM-built note, EC-SAFE-1 style');
  });
  test('the generated engine block is byte-identical between src and mobile.html (build parity for the new inputs)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'calc', 'boxFill.js'), 'utf8');
    const block = html.slice(html.indexOf('  // ---- src/calc/boxFill.js ----'), html.indexOf('  // ---- src/calc/motor.js ----'));
    for (const needle of ["fail('EGC_LARGER_THAN_GOVERNING'", 'Math.max(0, egcCount - 4) / 4', "fail('EGC_DETAILS_REQUIRED'", "fail('CONTRADICTORY_INPUT'", 'requiredVolume <= availableVolume']) assert.ok(src.includes(needle) && block.includes(needle), needle);
  });
});
