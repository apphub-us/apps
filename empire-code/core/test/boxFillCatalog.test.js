'use strict';
/**
 * EC-CALC-1B — Box Fill field catalog & help: literal, seed-derived fixtures.
 *
 * Every expected number, catalog number, gang count, height and compatibility
 * list below is a LITERAL transcribed from EC-CALC-1B-catalog-seed.json
 * (schemaVersion 1, checked 2026-09-06). Nothing imports the seed at run time
 * and nothing uses src/calc/tables.js as the expected-values oracle: the tables
 * and the shipped adapter in mobile.html are the SUBJECTS under test.
 *
 * Covered here (task §H): 1 ten multigang box volumes · 2 every verified
 * accessory value · 3 same-height proof (772 = 3.5 vs 778 = 5.5) · 4 exact
 * filtering by family/key · 5 box change resets accessory/volume (product
 * decision: ALL cases, Custom included) · 6 RACO 821 never auto-adds 10.0 or
 * 10.3 · 7 custom decimal through Custom mode · 8 exactly one engine call in
 * catalog mode · 9 no electrical formula in the adapter helpers · 10 help
 * controls / accessible markup / toggle behaviour · 13 Reset. Items 11–12 (real
 * necLink routing, 375/390 wrap) run in Chromium: tools/boxfill-check-mobile.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');

/* ── literal fixtures (transcribed from the locked seed) ─────────────────── */
const BOXES_LITERAL = {
  raco_951: { cat: "951", gangs: 2, depthIn: 1.625, vol: 47.0 },
  raco_952: { cat: "952", gangs: 3, depthIn: 1.625, vol: 60.0 },
  raco_953: { cat: "953", gangs: 4, depthIn: 1.625, vol: 72.8 },
  raco_954: { cat: "954", gangs: 5, depthIn: 1.625, vol: 85.8 },
  raco_955: { cat: "955", gangs: 6, depthIn: 1.625, vol: 98.5 },
  raco_941: { cat: "941", gangs: 2, depthIn: 2.5, vol: 70.0 },
  raco_942: { cat: "942", gangs: 3, depthIn: 2.5, vol: 90.0 },
  raco_943: { cat: "943", gangs: 4, depthIn: 2.5, vol: 110.0 },
  raco_944: { cat: "944", gangs: 5, depthIn: 2.5, vol: 130.0 },
  raco_945: { cat: "945", gangs: 6, depthIn: 2.5, vol: 150.0 }
};
const ACC_LITERAL = {
  raco_4sq_1g_025: { cats: ["771","8771"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 0.25, vol: 1.5, source: "RACO_4IN_SINGLE" },
  raco_4sq_1g_050: { cats: ["772","8772"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 0.5, vol: 3.5, source: "RACO_4IN_SINGLE" },
  raco_4sq_1g_0625: { cats: ["768","8768"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 0.625, vol: 4.5, source: "RACO_4IN_SINGLE" },
  raco_4sq_1g_075: { cats: ["773","8773"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 0.75, vol: 5.5, source: "RACO_4IN_SINGLE" },
  raco_4sq_1g_100: { cats: ["774"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 1, vol: 7.5, source: "RACO_4IN_SINGLE" },
  raco_4sq_1g_125: { cats: ["775","8775"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 1.25, vol: 9.5, source: "RACO_4IN_SINGLE" },
  raco_4sq_1g_150: { cats: ["785"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 1.5, vol: 11.3, source: "RACO_4IN_SINGLE" },
  raco_4sq_1g_200: { cats: ["786"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 1, heightIn: 2, vol: 14.5, source: "RACO_4IN_SINGLE" },
  raco_4sq_2g_025: { cats: ["777","8777-0"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 0.25, vol: 3.0, source: "RACO_4IN_TWO" },
  raco_4sq_2g_050: { cats: ["778","8778"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 0.5, vol: 5.5, source: "RACO_4IN_TWO" },
  raco_4sq_2g_0625: { cats: ["769","8769"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 0.625, vol: 7.3, source: "RACO_4IN_TWO" },
  raco_4sq_2g_075: { cats: ["779","8779"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 0.75, vol: 8.8, source: "RACO_4IN_TWO" },
  raco_4sq_2g_100: { cats: ["780"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 1, vol: 12.0, source: "RACO_4IN_TWO" },
  raco_4sq_2g_125: { cats: ["781","8781"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 1.25, vol: 15.0, source: "RACO_4IN_TWO" },
  raco_4sq_2g_150: { cats: ["795"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 1.5, vol: 15.5, source: "RACO_4IN_TWO" },
  raco_4sq_2g_200: { cats: ["796"], type: "mud_ring", family: "metal_square_4", keys: [], gangs: 2, heightIn: 2, vol: 20.5, source: "RACO_4IN_TWO" },
  raco_41116_1g_050: { cats: ["837","8837"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 1, heightIn: 0.5, vol: 3.5, source: "RACO_41116" },
  raco_41116_1g_0625: { cats: ["843"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 1, heightIn: 0.625, vol: 4.5, source: "RACO_41116" },
  raco_41116_1g_075: { cats: ["838"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 1, heightIn: 0.75, vol: 5.5, source: "RACO_41116" },
  raco_41116_1g_100: { cats: ["839"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 1, heightIn: 1, vol: 7.5, source: "RACO_41116" },
  raco_41116_1g_125: { cats: ["842"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 1, heightIn: 1.25, vol: 9.5, source: "RACO_41116" },
  raco_41116_1g_150: { cats: ["898"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 1, heightIn: 1.5, vol: 11.0, source: "RACO_41116" },
  raco_41116_1g_200: { cats: ["899"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 1, heightIn: 2, vol: 16.0, source: "RACO_41116" },
  raco_41116_2g_050: { cats: ["841"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 2, heightIn: 0.5, vol: 5.5, source: "RACO_41116" },
  raco_41116_2g_0625: { cats: ["818"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 2, heightIn: 0.625, vol: 7.3, source: "RACO_41116" },
  raco_41116_2g_075: { cats: ["840"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 2, heightIn: 0.75, vol: 8.8, source: "RACO_41116" },
  raco_41116_2g_100: { cats: ["819"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 2, heightIn: 1, vol: 12.0, source: "RACO_41116" },
  raco_41116_2g_125: { cats: ["820"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 2, heightIn: 1.25, vol: 15.0, source: "RACO_41116" },
  raco_41116_2g_150: { cats: ["885"], type: "mud_ring", family: "metal_square_4_11_16", keys: [], gangs: 2, heightIn: 1.5, vol: 15.5, source: "RACO_41116" },
  raco_mg_822_075: { cats: ["822"], type: "raised_cover", family: "raco_multigang", keys: ["raco_952","raco_942"], gangs: 3, heightIn: 0.75, vol: 15.3, source: "RACO_MULTIGANG" },
  raco_mg_823_075: { cats: ["823"], type: "raised_cover", family: "raco_multigang", keys: ["raco_953","raco_943"], gangs: 4, heightIn: 0.75, vol: 20.3, source: "RACO_MULTIGANG" },
  raco_mg_824_075: { cats: ["824"], type: "raised_cover", family: "raco_multigang", keys: ["raco_954","raco_944"], gangs: 5, heightIn: 0.75, vol: 25.5, source: "RACO_MULTIGANG" },
  raco_mg_825_075: { cats: ["825"], type: "raised_cover", family: "raco_multigang", keys: ["raco_955","raco_945"], gangs: 6, heightIn: 0.75, vol: 30.5, source: "RACO_MULTIGANG" },
  raco_4sq_ext_201_150: { cats: ["201"], type: "extension_ring", family: "metal_square_4", keys: [], gangs: null, heightIn: 1.5, vol: 22.5, source: "RACO_4IN_EXT_201" },
  raco_41116_ext_250_150: { cats: ["250"], type: "extension_ring", family: "metal_square_4_11_16", keys: [], gangs: null, heightIn: 1.5, vol: 29.5, source: "RACO_41116_EXT_250" },
  raco_oct4_ext_128_150: { cats: ["128"], type: "extension_ring", family: "metal_octagon_4", keys: [], gangs: null, heightIn: 1.5, vol: 15.5, source: "RACO_OCT_EXT_128" }
};
const UNRESOLVED_821 = { id: 'raco_mg_821_075', cat: '821', keys: ['raco_951', 'raco_941'], gangs: 2, heightIn: 0.75, published: [10.0, 10.3] };
/** Expected compatible ids per base box (exact keys for multigang covers; family otherwise). */
const EXPECT_COMPAT = {
  sq_4x1_25: ['raco_4sq_1g_025', 'raco_4sq_1g_050', 'raco_4sq_1g_0625', 'raco_4sq_1g_075', 'raco_4sq_1g_100', 'raco_4sq_1g_125', 'raco_4sq_1g_150', 'raco_4sq_1g_200', 'raco_4sq_2g_025', 'raco_4sq_2g_050', 'raco_4sq_2g_0625', 'raco_4sq_2g_075', 'raco_4sq_2g_100', 'raco_4sq_2g_125', 'raco_4sq_2g_150', 'raco_4sq_2g_200', 'raco_4sq_ext_201_150'],
  sq_4_11_16x1_5: ['raco_41116_1g_050', 'raco_41116_1g_0625', 'raco_41116_1g_075', 'raco_41116_1g_100', 'raco_41116_1g_125', 'raco_41116_1g_150', 'raco_41116_1g_200', 'raco_41116_2g_050', 'raco_41116_2g_0625', 'raco_41116_2g_075', 'raco_41116_2g_100', 'raco_41116_2g_125', 'raco_41116_2g_150', 'raco_41116_ext_250_150'],
  oct_4x1_5: ['raco_oct4_ext_128_150'],
  raco_951: [], raco_941: [],                                  // 821 is unresolved — nothing auto-values a 2-gang cover
  raco_952: ['raco_mg_822_075'], raco_942: ['raco_mg_822_075'],
  raco_953: ['raco_mg_823_075'], raco_943: ['raco_mg_823_075'],
  raco_954: ['raco_mg_824_075'], raco_944: ['raco_mg_824_075'],
  raco_955: ['raco_mg_825_075'], raco_945: ['raco_mg_825_075'],
  dev_3x2x2: [], handy_1_5: [], pl_sg_22: [], pl_dg_30: [],  // no starter accessory for device / handy / plastic
};
const HELP_KEYS = ['gang', 'yoke', 'clamps', 'egc', 'ring', 'custom'];

/* ── shipped code under test: functions extracted verbatim from mobile.html ── */
function fnBody(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); } }
  throw new Error('unbalanced ' + name);
}
const SELECTS = new Set(['bfBoxType', 'bfWireSize', 'bfClamps', 'bfEgcSize', 'bfAccessory']);
function mkEl(id) {
  const el = { id, value: '', textContent: '', title: '', label: '', className: '', style: {}, hidden: undefined, attrs: {}, validity: { badInput: false }, children: [], listeners: {}, _classes: new Set(),
    classList: { add: (c) => el._classes.add(c), remove: (c) => el._classes.delete(c), toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)), contains: (c) => el._classes.has(c) },
    appendChild(c) { el.children.push(c); return c; }, removeChild(c) { el.children.splice(el.children.indexOf(c), 1); }, get firstChild() { return el.children[0] || null; },
    addEventListener(t, f) { (el.listeners[t] = el.listeners[t] || []).push(f); }, setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; } };
  Object.defineProperty(el, 'tagName', { value: SELECTS.has(id) ? 'SELECT' : (/^bfHelpBtn-/.test(id) ? 'BUTTON' : (/^bf/.test(id) ? 'INPUT' : String(id).toUpperCase())) });   // created nodes report their tag
  return el;
}
const FIELDS = ['bfBoxType', 'bfWireSize', 'bfConductors', 'bfDevices', 'bfClamps', 'bfEgcCount', 'bfEgcSize', 'bfExtension', 'bfResultBox', 'bfResultGrid', 'bfNote', 'bfRefTable', 'bfBoxTable', 'bfMarkedTable', 'bfListedTable', 'bfAccessory', 'bfCustomWrap', 'bfAccessoryNote']
  .concat(HELP_KEYS.map((k) => 'bfHelpBtn-' + k)).concat(HELP_KEYS.map((k) => 'bfHelp-' + k));
const DEFAULTS = { bfBoxType: 'sq_4x1_5', bfWireSize: '12', bfConductors: '3', bfDevices: '1', bfClamps: '0', bfEgcCount: '0', bfEgcSize: '', bfExtension: '0', bfAccessory: 'none' };
function harness(engineWrap) {
  const els = {}; FIELDS.forEach((id) => { els[id] = mkEl(id); });
  Object.entries(DEFAULTS).forEach(([k, v]) => { els[k].value = v; });
  HELP_KEYS.forEach((k) => { els['bfHelp-' + k].hidden = true; els['bfHelpBtn-' + k].attrs['aria-expanded'] = 'false'; });
  const doc = { getElementById: (id) => els[id] || null, createElement: (tag) => mkEl(tag), createTextNode: (t) => ({ textContent: String(t), children: [] }) };
  const win = {};
  const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e); block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  new Function('window', block)(win);   // eslint-disable-line no-new-func
  const calls = [];
  const EC = Object.assign({}, win.EC, { boxFill: { calculateBoxFill: (req) => { calls.push(JSON.parse(JSON.stringify(req))); return engineWrap ? engineWrap(req, win.EC.boxFill) : win.EC.boxFill.calculateBoxFill(req); } } });
  const api = {};
  // EC-UI-LAYOUT-REFS-1: the Box Fill basis note now builds its references through the shared source-aware layer (necRefInfo + refSpanNode), so that layer runs verbatim here too (exposure only)
  const refLayer = (html.match(/var EC_NEC_EDITION = '[^']+', EC_NYCEC_EDITION = '[^']+';/) || [''])[0] + fnBody('necRefInfo') + fnBody('refSpanNode');
  new Function('document', 'window', 'EC', 'necLink', 'exports',   // eslint-disable-line no-new-func
    refLayer + fnBody('bfReadCount') + fnBody('bfReadVolume') + fnBody('bfReadSelect') + html.slice(html.indexOf('var BF_REASON_TEXT = {'), html.indexOf('};', html.indexOf('var BF_REASON_TEXT = {')) + 2)
    + fnBody('bfCompatibleAccessoryIds') + fnBody('bfAccessoryGroupLabel') + fnBody('bfSyncAccessory') + fnBody('bfReadAccessory') + fnBody('bfHelpToggle')
    + fnBody('bfShowState') + fnBody('bfUpdateCalc') + fnBody('bfInitRefTables') + fnBody('bfReset')
    + ';exports.bfUpdateCalc=bfUpdateCalc;exports.bfInitRefTables=bfInitRefTables;exports.bfReset=bfReset;exports.bfCompatibleAccessoryIds=bfCompatibleAccessoryIds;exports.bfSyncAccessory=bfSyncAccessory;exports.bfReadAccessory=bfReadAccessory;exports.bfHelpToggle=bfHelpToggle;')(doc, win, EC, () => {}, api);
  const grid = () => els.bfResultGrid.children.map((item) => [item.children[0].textContent, item.children[1].textContent]);
  const row = (label) => (grid().find((r) => r[0] === label) || [])[1] || null;
  const state = () => ({ ready: els.bfResultBox._classes.has('ready'), fail: els.bfResultBox._classes.has('fail'), status: row('Status'), total: row('Total Volume'), required: row('Volume Required'), first: (grid()[0] || [])[0] || null, msg: (grid()[0] || [])[1] || null });
  const options = () => els.bfAccessory.children.flatMap((c) => (c.tagName === 'OPTGROUP' ? c.children : [c])).map((o) => o.value);
  const groups = () => els.bfAccessory.children.filter((c) => c.tagName === 'OPTGROUP').map((g) => [g.label, g.children.map((o) => o.textContent)]);
  const setBox = (key) => { els.bfBoxType.value = key; api.bfUpdateCalc(); };
  return { els, api, EC: win.EC, calls, state, row, options, groups, setBox };
}

/* ── 1. the ten exact multigang boxes ────────────────────────────────────── */
describe('1. RACO multigang base boxes resolve to the literal seed volumes', () => {
  const { BF_BOXES } = require('../src/calc/tables');
  test('every 951–955 / 941–945 key carries the seed volume, gang count, depth and catalog number', () => {
    for (const [key, f] of Object.entries(BOXES_LITERAL)) {
      const b = BF_BOXES[key]; assert.ok(b, key);
      assert.strictEqual(b.vol, f.vol, key + ' volume'); assert.strictEqual(b.gangs, f.gangs, key + ' gangs'); assert.strictEqual(b.depthIn, f.depthIn, key + ' depth');
      assert.strictEqual(b.catalogNumber, f.cat); assert.strictEqual(b.manufacturer, 'RACO'); assert.strictEqual(b.kind, 'listed_product'); assert.strictEqual(b.family, 'raco_multigang'); assert.strictEqual(b.status, 'verified');
      assert.ok(b.label.includes(f.gangs + '-Gang') && b.label.includes('RACO ' + f.cat) && /deep/.test(b.label), key + ' label shows gang count, depth and catalog number: ' + b.label);
    }
    assert.strictEqual(Object.keys(BOXES_LITERAL).length, 10);
  });
  test('the engine (untouched) prices them by the same literal capacity — 3 × #12 in a 951 leaves 47.0 − 6.75 − 4.5', () => {
    const { calculateBoxFill } = require('../src/calc/boxFill');
    const r = calculateBoxFill({ contract: 2, boxKey: 'raco_951', largestWireSize: '12', numConductors: 3, numDevices: 1, egcCount: 0 });
    assert.strictEqual(r.availableVolume, 47.0); assert.strictEqual(r.requiredVolume, 11.25); assert.strictEqual(r.remaining, 35.75);
    const r945 = calculateBoxFill({ contract: 2, boxKey: 'raco_945', largestWireSize: '12', numConductors: 0, egcCount: 0 });
    assert.strictEqual(r945.availableVolume, 150.0); assert.strictEqual(r945.maxConductors, 66, '⌊150 / 2.25⌋');
  });
  test('the Box Type list groups them by depth (1-5/8" then 2-1/2") and then gang count, after the EC-CALC-1 choices', () => {
    const h = harness(); h.api.bfInitRefTables();
    const opts = h.els.bfBoxType.children.flatMap((g) => g.children.map((o) => [g.label, o.value, o.textContent]));
    assert.strictEqual(opts.length, 37);
    const raco = opts.filter((o) => o[1].startsWith('raco_'));
    assert.deepStrictEqual(raco.map((o) => o[1]), ['raco_951', 'raco_952', 'raco_953', 'raco_954', 'raco_955', 'raco_941', 'raco_942', 'raco_943', 'raco_944', 'raco_945']);
    assert.deepStrictEqual([...new Set(raco.map((o) => o[0]))], ['RACO Multigang · 1-5/8" deep', 'RACO Multigang · 2-1/2" deep']);
    assert.ok(raco.every((o) => /\(\d+\.\d in³\)$/.test(o[2])), 'capacity shown on every product option');
    assert.strictEqual(opts.indexOf(raco[0]), 27, 'the 27 accepted keys keep their order and come first');
    assert.strictEqual(h.els.bfListedTable.children.length, 10); assert.strictEqual(h.els.bfBoxTable.children.length, 16, 'never mixed into the Table 314.16(A) rows');
    assert.strictEqual(h.els.bfListedTable.children.find((tr) => /RACO 953/.test(tr.children[0].textContent)).children[1].textContent, '72.8');
  });
});

/* ── 2/3. every verified accessory value; the same-height proof ──────────── */
describe('2. every verified starter accessory carries the literal seed capacity', () => {
  const { BF_ACCESSORIES, BF_ACCESSORY_UNRESOLVED, BF_CATALOG_SOURCES } = require('../src/calc/tables');
  test('36 records, seed order, field-for-field', () => {
    assert.deepStrictEqual(Object.keys(BF_ACCESSORIES), Object.keys(ACC_LITERAL), 'id set and order');
    for (const [id, f] of Object.entries(ACC_LITERAL)) {
      const a = BF_ACCESSORIES[id];
      assert.strictEqual(a.addedVolumeIn3, f.vol, id + ' addedVolumeIn3'); assert.strictEqual(a.raisedHeightIn, f.heightIn, id + ' height'); assert.strictEqual(a.openingGangs, f.gangs, id + ' gangs');
      assert.deepStrictEqual(a.catalogNumbers, f.cats, id + ' catalog numbers'); assert.strictEqual(a.type, f.type); assert.strictEqual(a.compatibleFamily, f.family); assert.deepStrictEqual(a.compatibleBoxKeys, f.keys);
      assert.strictEqual(a.status, 'verified'); assert.strictEqual(a.manufacturer, 'RACO'); assert.strictEqual(a.source, f.source); assert.ok(BF_CATALOG_SOURCES[f.source] && /^https:\/\//.test(BF_CATALOG_SOURCES[f.source].url), 'source is a checked manufacturer document');
      // label: opening count first (where relevant), height, auto-added in³, catalog number — the field-first contract
      assert.ok(a.label.includes('+' + f.vol.toFixed(1) + ' in³') && a.label.endsWith('RACO ' + f.cats.join('/')), id + ' label: ' + a.label);
      if (f.gangs) assert.ok(a.label.startsWith(f.gangs + '-'), id + ' label leads with the opening count'); else assert.ok(/^Extension ring/.test(a.label));
    }
    assert.strictEqual(Object.keys(ACC_LITERAL).length, 36);
  });
  test('3. same height, different volume: RACO 772 (1-device 1/2") = +3.5 while RACO 778 (2-device 1/2") = +5.5', () => {
    const a = BF_ACCESSORIES.raco_4sq_1g_050, b = BF_ACCESSORIES.raco_4sq_2g_050;
    assert.strictEqual(a.raisedHeightIn, 0.5); assert.strictEqual(b.raisedHeightIn, 0.5); assert.strictEqual(a.addedVolumeIn3, 3.5); assert.strictEqual(b.addedVolumeIn3, 5.5);
    assert.strictEqual(a.label, '1-device · 1/2" raised · +3.5 in³ · RACO 772/8772'); assert.strictEqual(b.label, '2-device · 1/2" raised · +5.5 in³ · RACO 778/8778');
    // and on the shipped adapter: same base box, two selections, two literal totals
    const h = harness(); h.setBox('sq_4x1_5');
    h.els.bfAccessory.value = 'raco_4sq_1g_050'; h.api.bfUpdateCalc(); assert.strictEqual(h.row('Total Volume'), '24.50 in³ (+3.5 added · RACO 772/8772)');
    h.els.bfAccessory.value = 'raco_4sq_2g_050'; h.api.bfUpdateCalc(); assert.strictEqual(h.row('Total Volume'), '26.50 in³ (+5.5 added · RACO 778/8778)');
    assert.deepStrictEqual(h.calls.slice(-2).map((c) => c.extensionVolume), [3.5, 5.5], 'the engine received the two literal capacities');
  });
  test('multigang raised covers and extension rings resolve on the adapter to the seed capacity', () => {
    const cases = [['raco_952', 'raco_mg_822_075', 15.3, '75.30 in³ (+15.3 added · RACO 822)'], ['raco_942', 'raco_mg_822_075', 15.3, '105.30 in³ (+15.3 added · RACO 822)'],
      ['raco_953', 'raco_mg_823_075', 20.3, '93.10 in³ (+20.3 added · RACO 823)'], ['raco_943', 'raco_mg_823_075', 20.3, '130.30 in³ (+20.3 added · RACO 823)'],
      ['raco_954', 'raco_mg_824_075', 25.5, '111.30 in³ (+25.5 added · RACO 824)'], ['raco_944', 'raco_mg_824_075', 25.5, '155.50 in³ (+25.5 added · RACO 824)'],
      ['raco_955', 'raco_mg_825_075', 30.5, '129.00 in³ (+30.5 added · RACO 825)'], ['raco_945', 'raco_mg_825_075', 30.5, '180.50 in³ (+30.5 added · RACO 825)'],
      ['sq_4x1_5', 'raco_4sq_ext_201_150', 22.5, '43.50 in³ (+22.5 added · RACO 201)'], ['sq_4_11_16x2_125', 'raco_41116_ext_250_150', 29.5, '71.50 in³ (+29.5 added · RACO 250)'], ['oct_4x2_125', 'raco_oct4_ext_128_150', 15.5, '37.00 in³ (+15.5 added · RACO 128)']];
    for (const [box, id, vol, total] of cases) {
      const h = harness(); h.setBox(box); h.els.bfAccessory.value = id; h.api.bfUpdateCalc();
      assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, vol, box + '+' + id); assert.strictEqual(h.row('Total Volume'), total, box + '+' + id);
    }
  });
  test('the 821 record is preserved as an unresolved conflict, never a verified capacity', () => {
    const u = BF_ACCESSORY_UNRESOLVED[UNRESOLVED_821.id];
    assert.ok(u); assert.strictEqual(u.addedVolumeIn3, null); assert.notStrictEqual(u.status, 'verified'); assert.deepStrictEqual(u.compatibleBoxKeys, UNRESOLVED_821.keys);
    assert.deepStrictEqual(u.conflictingValues.map((v) => v.addedVolumeIn3), UNRESOLVED_821.published);
    assert.ok(!(UNRESOLVED_821.id in BF_ACCESSORIES), 'not in the selectable table');
  });
});

/* ── 4. exact filtering; 5. box change resets; 6. 821 never auto-adds ───── */
describe('4. the selector offers exactly the compatible verified records', () => {
  test('per base box: family match for square/octagon rings; EXACT keys for multigang covers; nothing for device/handy/plastic', () => {
    const h = harness();
    for (const [box, ids] of Object.entries(EXPECT_COMPAT)) assert.deepStrictEqual(h.api.bfCompatibleAccessoryIds(box), ids, box);
    assert.deepStrictEqual(h.api.bfCompatibleAccessoryIds(null), []); assert.deepStrictEqual(h.api.bfCompatibleAccessoryIds('__proto__'), []); assert.deepStrictEqual(h.api.bfCompatibleAccessoryIds('constructor'), []);
    // the same 4" family shares the same list; the 4-11/16" family never sees a 4" ring and vice-versa
    assert.deepStrictEqual(h.api.bfCompatibleAccessoryIds('sq_4x2_125'), EXPECT_COMPAT.sq_4x1_25); assert.deepStrictEqual(h.api.bfCompatibleAccessoryIds('sq_4_11_16x2_125'), EXPECT_COMPAT.sq_4_11_16x1_5);
    assert.deepStrictEqual(h.api.bfCompatibleAccessoryIds('oct_4x1_25'), EXPECT_COMPAT.oct_4x1_5);
  });
  test('no cross-size multigang-cover inference: 822 is offered for 952/942 only, never for the next-smaller 951/941 (nor 953/943)', () => {
    const h = harness();
    for (const box of ['raco_951', 'raco_941', 'raco_953', 'raco_943', 'raco_954', 'raco_944', 'raco_955', 'raco_945']) assert.ok(!h.api.bfCompatibleAccessoryIds(box).includes('raco_mg_822_075'), box);
  });
  test('the rendered options are None · grouped compatible records (labels from the table) · Other / Custom', () => {
    const h = harness(); h.setBox('sq_4x1_5');
    assert.deepStrictEqual(h.options(), ['none'].concat(EXPECT_COMPAT.sq_4x1_25).concat(['custom']));
    assert.deepStrictEqual(h.groups().map((g) => g[0]), ['1-device mud rings', '2-device mud rings', 'Extension rings']);
    assert.strictEqual(h.groups()[0][1][1], '1-device · 1/2" raised · +3.5 in³ · RACO 772/8772');
    h.setBox('raco_953'); assert.deepStrictEqual(h.options(), ['none', 'raco_mg_823_075', 'custom']); assert.deepStrictEqual(h.groups().map((g) => g[0]), ['4-Gang raised covers']);
    h.setBox('dev_3x2x2'); assert.deepStrictEqual(h.options(), ['none', 'custom'], 'device box: only None / Custom');
    assert.ok(h.els.bfAccessory.children.every((c) => !('innerHTML' in c) && Object.keys(c.listeners).length === 0), 'options are built with createElement/textContent, no inline handlers');
  });
});

describe('5. changing Box Type resets the ring/cover to None and the extra volume to 0 — in ALL cases', () => {
  test('acceptance 6: 4" square mud ring, then 4-11/16" — the ring and its volume disappear, recalculation uses zero, only compatible items are offered', () => {
    const h = harness(); h.setBox('sq_4x1_5');
    h.els.bfAccessory.value = 'raco_4sq_1g_050'; h.api.bfUpdateCalc(); assert.strictEqual(h.row('Total Volume'), '24.50 in³ (+3.5 added · RACO 772/8772)');
    const before = h.calls.length; h.setBox('sq_4_11_16x1_5');
    assert.strictEqual(h.calls.length, before + 1, 'recalculated immediately, once'); assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 0);
    assert.strictEqual(h.els.bfAccessory.value, 'none'); assert.strictEqual(h.row('Total Volume'), '29.50 in³'); assert.ok(!h.options().includes('raco_4sq_1g_050'), 'the 4" ring is not offered for a 4-11/16" box');
  });
  test('regression (product decision): Other / Custom with a non-zero volume, then a box change -> None, 0, hidden, recalculated with extensionVolume 0', () => {
    const h = harness(); h.setBox('sq_4x1_5');
    h.els.bfAccessory.value = 'custom'; h.api.bfUpdateCalc(); assert.strictEqual(h.els.bfCustomWrap.style.display, '', 'Custom reveals the decimal input');
    h.els.bfExtension.value = '4.5'; h.api.bfUpdateCalc(); assert.strictEqual(h.row('Total Volume'), '25.50 in³ (+4.5 added)'); assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 4.5);
    const before = h.calls.length; h.setBox('sq_4x2_125');                        // 3. change Box Type
    assert.strictEqual(h.els.bfAccessory.value, 'none', '4. accessory becomes None');
    assert.strictEqual(h.els.bfExtension.value, '0', '5. custom extra volume becomes 0'); assert.strictEqual(h.els.bfCustomWrap.style.display, 'none', '5. and is hidden');
    assert.strictEqual(h.calls.length, before + 1); assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 0, '6. the immediate recalculation carries extensionVolume 0');
    assert.strictEqual(h.row('Total Volume'), '30.30 in³'); assert.ok(h.state().ready);
  });
  test('even a still-compatible catalog ring is dropped on a box change within the same family (no silent carry-over)', () => {
    const h = harness(); h.setBox('sq_4x1_25'); h.els.bfAccessory.value = 'raco_4sq_2g_100'; h.api.bfUpdateCalc(); assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 12.0);
    h.setBox('sq_4x2_125'); assert.strictEqual(h.els.bfAccessory.value, 'none'); assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 0); assert.ok(h.options().includes('raco_4sq_2g_100'), 'still offered, just not pre-selected');
  });
  test('with the box unchanged the selection is kept; an unknown/tampered value is neutralised to None before the one engine call', () => {
    const h = harness(); h.setBox('sq_4x1_5'); h.els.bfAccessory.value = 'raco_4sq_1g_025'; h.api.bfUpdateCalc(); h.els.bfConductors.value = '4'; h.api.bfUpdateCalc();
    assert.strictEqual(h.els.bfAccessory.value, 'raco_4sq_1g_025'); assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 1.5);
    for (const bad of ['__proto__', 'raco_mg_821_075', 'raco_41116_1g_050', 'constructor', '']) {
      h.els.bfAccessory.value = bad; const n = h.calls.length; h.api.bfUpdateCalc();
      assert.strictEqual(h.els.bfAccessory.value, 'none', bad); assert.strictEqual(h.calls.length, n + 1); assert.strictEqual(h.calls[n].extensionVolume, 0, bad); assert.ok(h.state().ready, bad);
    }
    // the resolver's own guard (bypassing the sync) refuses the same values rather than pricing them
    for (const bad of ['raco_mg_821_075', 'raco_41116_1g_050', '__proto__']) { h.els.bfAccessory.value = bad; const a = h.api.bfReadAccessory('sq_4x1_5'); assert.strictEqual(a.mode, 'invalid', bad); assert.ok(Number.isNaN(a.volume)); }
    h.els.bfAccessory.value = 'raco_4sq_1g_025'; assert.deepStrictEqual(h.api.bfReadAccessory('sq_4x1_5'), { mode: 'catalog', id: 'raco_4sq_1g_025', name: 'RACO 771/8771', volume: 1.5 });
  });
  test('13. Reset returns the selector to None, hides Custom, closes help and recalculates; the built list follows the default box', () => {
    const h = harness(); h.setBox('raco_952'); h.els.bfAccessory.value = 'raco_mg_822_075'; h.api.bfUpdateCalc(); h.api.bfHelpToggle('ring');
    h.els.bfBoxType.selectedIndex = 0; h.els.bfBoxType.value = 'sq_4x1_25';   // the stub select does not link selectedIndex to value
    h.api.bfReset();
    assert.strictEqual(h.els.bfAccessory.value, 'none'); assert.strictEqual(h.els.bfExtension.value, '0'); assert.strictEqual(h.els.bfCustomWrap.style.display, 'none');
    assert.ok(HELP_KEYS.every((k) => h.els['bfHelp-' + k].hidden === true && h.els['bfHelpBtn-' + k].attrs['aria-expanded'] === 'false'), 'help closed');
    assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 0); assert.strictEqual(h.row('Total Volume'), '18.00 in³'); assert.ok(h.options().includes('raco_4sq_1g_050'));
  });
});

describe('6. RACO 821: no path auto-adds 10.0 or 10.3', () => {
  test('for RACO 951 and 941 the selector offers only None / Custom, shows the conflict note, and the sweep of every box × every option never resolves 10.0 or 10.3', () => {
    const h = harness();
    for (const box of UNRESOLVED_821.keys) {
      h.setBox(box);
      assert.deepStrictEqual(h.options(), ['none', 'custom'], box);
      assert.strictEqual(h.els.bfAccessoryNote.hidden, false, box + ' note visible');
      assert.strictEqual(h.els.bfAccessoryNote.textContent, 'RACO 821 3/4" cover: automatic volume unavailable because current manufacturer sources conflict. Verify the actual product data and use Custom.');
    }
    h.setBox('raco_952'); assert.strictEqual(h.els.bfAccessoryNote.hidden, true, 'note only for the 821 base boxes'); assert.strictEqual(h.els.bfAccessoryNote.textContent, '');
    const { BF_BOXES } = require('../src/calc/tables');   // iteration domain only
    let swept = 0;
    for (const box of Object.keys(BF_BOXES)) {
      h.setBox(box);
      for (const id of h.options().filter((o) => o !== 'custom')) {
        h.els.bfAccessory.value = id; h.api.bfUpdateCalc(); const v = h.calls[h.calls.length - 1].extensionVolume;
        assert.ok(v !== 10.0 && v !== 10.3, box + '/' + id + ' -> ' + v); swept++;
      }
    }
    assert.ok(swept >= 37 + 17 * 3 + 14 * 2 + 3 + 4 * 2, 'swept ' + swept + ' selections');
    assert.ok(!html.includes("'raco_mg_821_075'") || html.indexOf("'raco_mg_821_075'") > html.indexOf('<!-- EC-CALC:START'), 'no hand-written 821 handling outside the generated data');
  });
  test('Custom remains the route: a manually entered marked volume is priced only as typed', () => {
    const h = harness(); h.setBox('raco_951'); h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = '10.3'; h.api.bfUpdateCalc();
    assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, 10.3); assert.strictEqual(h.row('Total Volume'), '57.30 in³ (+10.3 added)', 'no catalog name is attached to a Custom value');
  });
});

/* ── 7/8/9. custom decimals; one engine call; no formula in the adapter ──── */
describe('7/8/9. Custom precision, one engine call, lookup-only helpers', () => {
  test('7. the accepted EC-CALC-1 decimal / near-boundary cases through Custom mode (literal display strings)', () => {
    const cases = [['3.31', '5', '✗ OVER', '25.3100 in³ (+3.31 added)', '25.3125 in³', '-0.0025 in³'], ['4.437', '7', '✗ OVER', '26.4370 in³ (+4.437 added)', '26.4375 in³', '-0.0005 in³'], ['4.4375', '7', '✓ FITS', '26.44 in³ (+4.4375 added)', '26.44 in³', '0.00 in³']];
    for (const [ext, egc, status, total, required, remaining] of cases) {
      const h = harness(); h.setBox('pl_sg_22'); h.els.bfConductors.value = '10'; h.els.bfDevices.value = '0'; h.els.bfEgcCount.value = egc; h.els.bfEgcSize.value = '12'; h.els.bfAccessory.value = 'custom'; h.els.bfExtension.value = ext; h.api.bfUpdateCalc();
      assert.strictEqual(h.row('Status'), status, ext); assert.strictEqual(h.row('Total Volume'), total, ext); assert.strictEqual(h.row('Volume Required'), required, ext); assert.strictEqual(h.row('Remaining'), remaining, ext);
      assert.strictEqual(h.calls[h.calls.length - 1].extensionVolume, Number(ext));
    }
  });
  test('8. catalog mode: exactly one contract-2 engine call with the literal record capacity as extensionVolume', () => {
    const h = harness(); h.setBox('raco_953'); const n = h.calls.length;
    h.els.bfAccessory.value = 'raco_mg_823_075'; h.els.bfConductors.value = '12'; h.els.bfDevices.value = '4'; h.els.bfEgcCount.value = '5'; h.els.bfEgcSize.value = '12'; h.api.bfUpdateCalc();
    assert.strictEqual(h.calls.length, n + 1);
    assert.deepStrictEqual(h.calls[n], { contract: 2, ruleBasis: 'NEC2020', boxKey: 'raco_953', largestWireSize: '12', numConductors: 12, numDevices: 4, hasClamps: false, egcCount: 5, extensionVolume: 20.3, egcSize: '12' });
    // 12×2.25 + 4×4.5 + 1.25×2.25 = 47.8125 vs 72.8+20.3 = 93.1: the accepted R1 display contract prints BOTH at the smallest exact shared precision (4)
    assert.strictEqual(h.row('Total Volume'), '93.1000 in³ (+20.3 added · RACO 823)'); assert.strictEqual(h.row('Volume Required'), '47.8125 in³'); assert.strictEqual(h.row('Remaining'), '45.2875 in³');
  });
  test('9. the catalog helpers are lookups: no arithmetic, comparison or Math on any volume field; no innerHTML', () => {
    const helpers = ['bfCompatibleAccessoryIds', 'bfAccessoryGroupLabel', 'bfSyncAccessory', 'bfReadAccessory', 'bfHelpToggle'].map(fnBody).join('\n');
    const code = helpers.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([;{}(])\s*\/\/.*$/gm, '$1').replace(/'(?:[^'\\]|\\.)*'/g, '§');
    assert.ok(!/addedVolumeIn3\s*[-+*\/%]/.test(code) && !/[-+*\/%]\s*(a|rec|u)\.(addedVolumeIn3|vol)\b/.test(code), 'no arithmetic on a capacity');
    assert.ok(!/\bvol\b/.test(code), 'box volumes are never read by the helpers');
    assert.ok(!/Math\.|toFixed|parseFloat|Number\(/.test(code), 'no numeric formatting or maths in the helpers');
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(helpers), 'DOM built with createElement/textContent only');
    // every comparison in the helpers is an index/length/identity check — the ONLY one that touches a capacity is the
    // resolver's data-sanity guard that a record's number is not negative (never a fit, headroom or size decision)
    const comparisons = code.match(/[\w.]+(?:\([\w.]*\))?\s*(?:<=|>=|<|>)\s*[\w.]+/g) || [];
    const allowed = [/^[\w.]*indexOf\(\w+\)\s*>=\s*0$/, /^[\w.]*indexOf\(\w+\)\s*<\s*0$/, /^keys\.length\s*>\s*0$/, /^a\.addedVolumeIn3\s*<\s*0$/];
    for (const c of comparisons) assert.ok(allowed.some((re) => re.test(c.trim())), 'unexpected comparison in a catalog helper: ' + c);
    assert.strictEqual(comparisons.filter((c) => /addedVolumeIn3/.test(c)).length, 1); assert.ok(!/availableVolume|requiredVolume|remaining|fits/.test(code), 'nothing decides fit or headroom here');
  });
});

/* ── 10. field help ─────────────────────────────────────────────────────── */
describe('10. offline field help: accessible real buttons, one open at a time, static local text, NEC links through necLink', () => {
  const panel = html.slice(html.indexOf('<!-- ══ BOX FILL ══ -->'), html.indexOf('<!-- ══', html.indexOf('<!-- ══ BOX FILL ══ -->') + 10));
  test('six ⓘ controls: type=button, aria-expanded, aria-controls pointing at an existing hidden block, aria-label, click routed to bfHelpToggle', () => {
    const btns = [...panel.matchAll(/<button type="button" class="bf-help-btn" id="bfHelpBtn-([a-z]+)" aria-label="([^"]+)" aria-expanded="false" aria-controls="bfHelp-([a-z]+)" onclick="bfHelpToggle\('([a-z]+)'\)">ⓘ<\/button>/g)].map((m) => ({ key: m[1], label: m[2], controls: m[3], onclick: m[4] }));
    assert.deepStrictEqual(btns.map((b) => b.key), ['gang', 'ring', 'custom', 'yoke', 'clamps', 'egc'], 'markup order after R1: Box Type (Gang) -> Ring / raised cover -> Custom -> Devices (yoke) -> Clamps -> EGC');
    for (const b of btns) { assert.strictEqual(b.controls, b.key); assert.strictEqual(b.onclick, b.key); assert.ok(b.label.length > 8); assert.ok(new RegExp('<div class="bf-help ctrl-help" id="bfHelp-' + b.key + '" hidden>').test(panel), 'hidden block for ' + b.key); }
    assert.strictEqual((panel.match(/<button/g) || []).length, 7, '6 help buttons + Reset');
    assert.ok(/#panel-boxfill \.bf-help-btn::after \{[^}]*top: -10px/.test(html), 'tap area enlarged to ~40px without changing layout');
    assert.ok(!/onmouseover|onmouseenter|title="Learn/.test(panel.slice(panel.indexOf('<div class="controls"'), panel.indexOf('<div class="scroll-body"'))), 'no hover requirement');
  });
  test('help text is the product-spec wording, static and offline', () => {
    const block = (k) => panel.slice(panel.indexOf('id="bfHelp-' + k + '"'), panel.indexOf('</div>', panel.indexOf('id="bfHelp-' + k + '"')));
    assert.ok(/Count equipment grounding conductors and equipment bonding jumpers entering the box\. Do not count a grounding pigtail located entirely inside the box\./.test(block('egc')) && /EGC — Equipment Grounding Conductor/.test(block('egc')));
    assert.ok(/a yoke\/strap is the metal mounting strap that supports a switch, receptacle, or similar device\. Enter the number of yokes in the box\./.test(block('yoke')));
    assert.ok(/count internal cable clamps that occupy box-fill volume\. Do not count external connectors as internal clamps\./.test(block('clamps')));
    assert.ok(/select the actual compatible ring\/cover by opening count and raised height\. Empire Code uses the verified catalog capacity of that exact product; height alone does not determine added volume/.test(block('ring')));
    assert.ok(/enter the permitted cubic capacity of the actual ring, cover, or extension when it is not in the catalog\. Do not enter its height\./.test(block('custom')));
    assert.ok(/the number of device positions\/openings\. It is not the number of conductors\./.test(block('gang')));
    assert.ok(!/fetch\(|https?:\/\//.test(HELP_KEYS.map(block).join('')), 'no network reference in help');
    assert.ok(!/\d+\.\d+\s*in³/.test(HELP_KEYS.map(block).join('')), 'no numeric catalog copy inside static help text');
  });
  test('every NEC citation inside help is a .nec-link routed through necLink(); no bare 314.16 text', () => {
    const helpHtml = HELP_KEYS.map((k) => panel.slice(panel.indexOf('id="bfHelp-' + k + '"'), panel.indexOf('</div>', panel.indexOf('id="bfHelp-' + k + '"')))).join('\n');
    const links = [...helpHtml.matchAll(/<span class="nec-link" onclick="necLink\('([^']+)'\)">([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
    assert.deepStrictEqual(links.map((l) => l[0]), ['NEC 314.16(B)(4)', 'NEC 314.16(B)(2)', 'NEC 314.16(B)(5)', 'NEC 314.16(A)', 'NEC 314.16(A)']);
    assert.ok(links.every((l) => l[1].startsWith(l[0] + ' — ')), 'citation context follows the existing "ref — description" form');
    const bare = helpHtml.replace(/<span class="nec-link"[^>]*>[^<]*<\/span>/g, '');
    assert.ok(!/314\.16/.test(bare), 'a 314.16 reference outside a .nec-link: ' + bare);
  });
  test('bfHelpToggle: opens one block, closes the others, toggles closed on a second activation, keeps aria-expanded honest', () => {
    const h = harness();
    const open = () => HELP_KEYS.filter((k) => h.els['bfHelp-' + k].hidden === false);
    const aria = () => HELP_KEYS.filter((k) => h.els['bfHelpBtn-' + k].attrs['aria-expanded'] === 'true');
    assert.strictEqual(h.api.bfHelpToggle('egc'), true); assert.deepStrictEqual(open(), ['egc']); assert.deepStrictEqual(aria(), ['egc']);
    assert.strictEqual(h.api.bfHelpToggle('yoke'), true); assert.deepStrictEqual(open(), ['yoke']); assert.deepStrictEqual(aria(), ['yoke']);
    assert.strictEqual(h.api.bfHelpToggle('yoke'), false); assert.deepStrictEqual(open(), []); assert.deepStrictEqual(aria(), []);
    h.api.bfHelpToggle('custom'); h.api.bfHelpToggle('nope'); assert.deepStrictEqual(open(), [], 'an unknown key closes everything and opens nothing');
    h.api.bfHelpToggle('ring'); h.api.bfHelpToggle(null); assert.deepStrictEqual(open(), []);
  });
  test('the validation state row is marked for the Box-Fill-scoped wrap rule (375/390 px); the rule exists and touches nothing global', () => {
    const h = harness(); h.els.bfConductors.value = ''; h.api.bfUpdateCalc();
    assert.strictEqual(h.els.bfResultGrid.children[0].className, 'result-item bf-state-row'); assert.strictEqual(h.state().first, 'INCOMPLETE');
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.ok(/#bfResultGrid \.bf-state-row \{[^}]*flex: 1 1 100%;[^}]*min-width: 0;/.test(css) && /#bfResultGrid \.bf-state-row \.result-item-value \{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/.test(css));
    assert.ok(/\.result-item \{\n    background: var\(--surface2\); border: 1px solid var\(--border\);\n    border-radius: 4px; padding: 8px 12px; flex: 0 0 auto;\n  \}/.test(css), 'the global .result-item rule is byte-identical');
    assert.ok(/\.result-grid \{ display: flex; flex-wrap: wrap; gap: 8px; \}/.test(css), 'the global .result-grid rule is byte-identical');
  });
});

/* ── Review revision (R1 / R2) ──────────────────────────────────────────── */
describe('R1. source/DOM order — Box Type -> Ring / raised cover (+ Custom) -> Wire Size -> Conductors -> Devices -> Clamps -> EGC', () => {
  test('the complete accessory workflow sits immediately after Box Type and its Gang help, before Wire Size', () => {
    const panel = html.slice(html.indexOf('<!-- ══ BOX FILL ══ -->'), html.indexOf('<!-- ══', html.indexOf('<!-- ══ BOX FILL ══ -->') + 10));
    const controls = panel.slice(panel.indexOf('<div class="controls"'), panel.indexOf('<div class="scroll-body"'));
    const order = ['id="bfBoxType"', 'id="bfHelp-gang"', '>Ring / raised cover<', 'id="bfAccessory"', 'id="bfAccessoryNote"', 'id="bfHelp-ring"', 'id="bfCustomWrap"', 'id="bfExtension"', 'id="bfHelp-custom"',
      'id="bfWireSize"', 'id="bfConductors"', 'id="bfDevices"', 'id="bfHelp-yoke"', 'id="bfClamps"', 'id="bfHelp-clamps"', 'id="bfEgcCount"', 'id="bfHelp-egc"', 'id="bfEgcSize"', 'class="reset-btn"'];
    const pos = order.map((needle) => controls.indexOf(needle));
    pos.forEach((p, i) => assert.ok(p >= 0, 'missing: ' + order[i]));
    for (let i = 1; i < pos.length; i++) assert.ok(pos[i] > pos[i - 1], order[i - 1] + ' must precede ' + order[i] + ' (product spec: after Box Type, show Ring / raised cover)');
    // nothing else may be interleaved between Box Type and the accessory block
    const between = controls.slice(controls.indexOf('id="bfHelp-gang"'), controls.indexOf('>Ring / raised cover<'));
    assert.ok(!/<(select|input|button)\b/.test(between.slice(between.indexOf('</div>'))), 'no control between the Gang help and the Ring / raised cover label');
  });
});

describe('R2. Custom help closes whenever Custom mode disappears; unrelated help stays open', () => {
  const customHelp = (h) => ({ open: h.els['bfHelp-custom'].hidden === false, aria: h.els['bfHelpBtn-custom'].attrs['aria-expanded'], wrap: h.els.bfCustomWrap.style.display });
  const openCustomHelp = (h) => { h.els.bfAccessory.value = 'custom'; h.api.bfUpdateCalc(); h.api.bfHelpToggle('custom'); const c = customHelp(h); assert.ok(c.open && c.aria === 'true' && c.wrap === '', 'precondition: Custom visible with its help open'); };
  test('A. Custom help open -> accessory None: help hidden, aria-expanded=false, Custom input hidden', () => {
    const h = harness(); h.setBox('sq_4x1_5'); openCustomHelp(h);
    h.els.bfAccessory.value = 'none'; h.api.bfUpdateCalc();
    assert.deepStrictEqual(customHelp(h), { open: false, aria: 'false', wrap: 'none' });
  });
  test('B. Custom help open -> verified catalog accessory: help hidden, aria-expanded=false, the catalog volume is used', () => {
    const h = harness(); h.setBox('sq_4x1_5'); openCustomHelp(h);
    h.els.bfAccessory.value = 'raco_4sq_1g_050'; h.api.bfUpdateCalc();
    assert.deepStrictEqual(customHelp(h), { open: false, aria: 'false', wrap: 'none' }); assert.strictEqual(h.row('Total Volume'), '24.50 in³ (+3.5 added · RACO 772/8772)');
  });
  test('C. Custom help open -> Box Type change (resets to None, 0): help hidden, aria-expanded=false', () => {
    const h = harness(); h.setBox('sq_4x1_5'); openCustomHelp(h); h.els.bfExtension.value = '2.5'; h.api.bfUpdateCalc();
    h.setBox('sq_4x2_125');
    assert.deepStrictEqual(customHelp(h), { open: false, aria: 'false', wrap: 'none' }); assert.strictEqual(h.els.bfAccessory.value, 'none'); assert.strictEqual(h.els.bfExtension.value, '0'); assert.strictEqual(h.row('Total Volume'), '30.30 in³');
  });
  test('D. Reset from Custom help open: help hidden, aria-expanded=false, selector None', () => {
    const h = harness(); h.setBox('sq_4x1_5'); openCustomHelp(h);
    h.api.bfReset();
    assert.deepStrictEqual(customHelp(h), { open: false, aria: 'false', wrap: 'none' }); assert.strictEqual(h.els.bfAccessory.value, 'none');
  });
  test('an accessory change does not close unrelated help (Gang / EGC stay open); re-entering Custom does not reopen its help by itself', () => {
    const h = harness(); h.setBox('sq_4x1_5');
    h.api.bfHelpToggle('egc'); h.els.bfAccessory.value = 'custom'; h.api.bfUpdateCalc();
    assert.strictEqual(h.els['bfHelp-egc'].hidden, false, 'EGC help still open after choosing Custom');
    h.els.bfAccessory.value = 'raco_4sq_2g_050'; h.api.bfUpdateCalc();
    assert.strictEqual(h.els['bfHelp-egc'].hidden, false, 'EGC help still open after choosing a catalog ring'); assert.deepStrictEqual(customHelp(h), { open: false, aria: 'false', wrap: 'none' });
    h.api.bfHelpToggle('gang'); h.els.bfAccessory.value = 'custom'; h.api.bfUpdateCalc();
    assert.strictEqual(h.els['bfHelp-gang'].hidden, false, 'Gang help still open when Custom returns'); assert.strictEqual(customHelp(h).open, false, 'Custom help does not reopen by itself');
  });
});

/* ── Phone gate: iPhone focus zoom ─────────────────────────────────────── */
describe('focus-zoom: Box Fill controls are 16 CSS px by a Box-Fill-scoped rule only; no zoom lock or JS workaround', () => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  test('a #panel-boxfill .controls rule sets select / input[type=number] to 16px inside the EC-CALC-1B block; the shared 14px rule is untouched', () => {
    assert.ok(/#panel-boxfill \.controls select, #panel-boxfill \.controls input\[type=number\] \{ font-size: 16px; \}/.test(css), 'scoped 16px rule present');
    const block = css.slice(css.indexOf('EC-CALC-1B — BOX FILL ONLY'), css.indexOf('/* ── WORKFLOW BUTTONS ── */'));
    assert.ok(block.includes('font-size: 16px;'), 'the rule lives in the Box Fill block');
    // EC-UI-FOCUS-1 supersedes the earlier "global rule stays 14px" expectation: the shared select / number rule is now
    // part of the >= 16px field policy (docs/ui-focus-policy.md). Its other declarations must remain exactly as accepted.
    assert.ok(/\n  select, input\[type=number\] \{\n    background: var\(--surface\); border: 1px solid var\(--border\);\n    color: var\(--text\); font-family: 'IBM Plex Mono', monospace; font-size: 16px;\n    padding: 10px 12px; border-radius: 4px; outline: none; height: 44px;\n    box-sizing: border-box;\n  \}\n  select:focus, input\[type=number\]:focus \{ border-color: var\(--accent\); \}\n  input\[type=number\] \{ width: 90px; \}\n/.test(css), 'the global control rules keep every accepted declaration (16px under the field policy)');
    const outside = css.replace(block, '');
    assert.ok(!/(select|input)[^{}]*\{[^}]*font-size: (1[0-5]|[0-9])px/.test(outside.replace(/\/\*[\s\S]*?\*\//g, '')), 'no select/input rule outside the Box Fill block sizes field text below 16px');
  });
  test('no focus-state rule shrinks Box Fill control text; no zoom lock, transform/zoom trick, text-size-adjust or JS zoom reset was added', () => {
    const block = css.slice(css.indexOf('EC-CALC-1B — BOX FILL ONLY'), css.indexOf('/* ── WORKFLOW BUTTONS ── */'));
    assert.ok(!/:focus[^{]*\{[^}]*font-size/.test(block) && !/transform|zoom:|text-size-adjust|overflow: hidden|touch-action/.test(block), block.match(/transform|zoom:|text-size-adjust|overflow: hidden|touch-action/));
    const adapter = html.slice(html.indexOf('// ── BOX FILL DATA ──'), html.indexOf('// ── AMPACITY DATA ──'));
    assert.ok(!/visualViewport|scrollTo|\.blur\(\)|preventDefault|maximum-scale|user-scalable|initial-scale/.test(adapter), 'no JavaScript viewport/zoom workaround in the Box Fill adapter');
    assert.strictEqual((html.match(/name="viewport"/g) || []).length, 1, 'exactly one viewport meta (left as-is; its global user-scalable=no is reported separately as accessibility debt)');
  });
});
