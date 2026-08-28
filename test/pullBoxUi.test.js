'use strict';
/**
 * PBV2-6 — Pull Box V2 schematic editor tests.
 *
 * Covers the shipped V2 UI path: build integration (pullBox now rides the
 * shared EC-CALC injection), the dev-only access gate, the pure editor-state
 * helpers extracted from the shipped mobile.html (fnBody pattern, like every
 * production adapter suite), and the milestone-scope guards (no connections,
 * no result rendering, no visible code references, legacy panel untouched).
 * The electrical engine itself remains closed: these tests never re-test its
 * math beyond proving the injected copy IS the source module.
 */
const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
const buildCalc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-calc.js'), 'utf8');

function fnBody(name) {
  const i = html.indexOf('function ' + name);
  assert.ok(i !== -1, 'shipped function missing: ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') {
      depth--;
      if (started && depth === 0) return html.slice(i, j + 1);
    }
  }
  throw new Error('unterminated: ' + name);
}

/** Extract the pure editor-state helpers from the SHIPPED page. */
function editorApi() {
  const src = ['pbv2InitialState', 'pbv2RowById', 'pbv2AddRow', 'pbv2AddEntry',
    'pbv2ChangeSize', 'pbv2ChangeRow', 'pbv2DeleteEntry', 'pbv2DeleteRow',
    'pbv2RowLabel', 'pbv2DevHost', 'pbv2ShouldOpen']
    .map(fnBody).join('\n');
  const api = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', src + `
    exports.initial = pbv2InitialState; exports.addRow = pbv2AddRow;
    exports.addEntry = pbv2AddEntry; exports.changeSize = pbv2ChangeSize;
    exports.changeRow = pbv2ChangeRow; exports.deleteEntry = pbv2DeleteEntry;
    exports.deleteRow = pbv2DeleteRow; exports.rowLabel = pbv2RowLabel;
    exports.devHost = pbv2DevHost; exports.shouldOpen = pbv2ShouldOpen;`)(api);
  return api;
}

function seq() {
  let n = 0;
  return (prefix) => { n++; return 'pbv2-' + prefix + '-' + n; };
}

describe('PBV2-6 — build integration', () => {
  test('pullBox is in the explicit MODULES list', () => {
    assert.ok(/'pullBox',/.test(buildCalc), 'pullBox missing from tools/build-calc.js MODULES');
  });

  test('the injected engine IS the source module (golden result identity)', () => {
    const s = html.indexOf('<!-- EC-CALC:START');
    const e = html.indexOf('<!-- EC-CALC:END -->');
    let block = html.slice(s, e);
    block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
    const win = {};
    // eslint-disable-next-line no-new-func
    new Function('window', block)(win);
    assert.ok(win.EC.pullBox, 'EC.pullBox missing from the injected block');
    const src = require('../src/calc/pullBox');
    assert.deepStrictEqual(win.EC.pullBox.TRADE_SIZE_KEYS, src.TRADE_SIZE_KEYS);
    const fixture = {
      rows: [{ id: 'rL', wall: 'left', order: 0 }, { id: 'rR', wall: 'right', order: 0 },
        { id: 'rT', wall: 'top', order: 0 }],
      entries: [{ id: 'a', rowId: 'rL', tradeSize: '4' },
        { id: 'b', rowId: 'rR', tradeSize: '4' },
        { id: 't', rowId: 'rT', tradeSize: '2' },
        { id: 'a2', rowId: 'rL', tradeSize: '2' }],
      connections: [{ id: 'cS', entryIds: ['a', 'b'] }, { id: 'cA', entryIds: ['a2', 't'] }],
    };
    assert.deepStrictEqual(win.EC.pullBox.calculatePullBox(fixture),
      src.calculatePullBox(fixture),
      'injected engine result differs from src/calc/pullBox.js');
  });
});

describe('PBV2-6 — dev-only access gate', () => {
  let api;
  before(() => { api = editorApi(); });

  test('production and public hostnames can NEVER open V2', () => {
    for (const hostname of ['empirecode.app', 'www.empirecode.app',
      'apphub-us.github.io', 'example.com', '172.32.0.1', '11.0.0.1',
      '193.168.1.5']) {
      assert.strictEqual(api.devHost(hostname), false, hostname);
      assert.strictEqual(
        api.shouldOpen({ hostname, search: '?pbv2=1', hash: '' }), false,
        hostname + ' with ?pbv2=1 must stay closed');
    }
  });

  test('local and private-LAN hosts open V2 only with the pbv2=1 parameter', () => {
    for (const hostname of ['localhost', '127.0.0.1', '10.0.0.7',
      '192.168.1.23', '172.16.0.2', '172.31.255.9']) {
      assert.strictEqual(api.devHost(hostname), true, hostname);
      assert.strictEqual(
        api.shouldOpen({ hostname, search: '?pbv2=1', hash: '' }), true, hostname);
      assert.strictEqual(
        api.shouldOpen({ hostname, search: '', hash: '' }), false,
        hostname + ' without the parameter stays closed');
      assert.strictEqual(
        api.shouldOpen({ hostname, search: '', hash: '#pbv2=1' }), true,
        hostname + ' hash form works too');
    }
  });

  test('no production navigation exposes V2', () => {
    assert.ok(!/openTool\('pullbox-v2'/.test(html), 'no openTool route');
    assert.ok(!/'pullbox-v2'/.test(html.slice(0, html.indexOf('pbv2-overlay'))),
      'no TOOLS/nav registration ahead of the dev panel');
    const nav = html.match(/<nav[\s\S]*?<\/nav>/);
    if (nav) assert.ok(!/pbv2|pullbox-v2/i.test(nav[0]), 'bottom nav clean');
  });
});

describe('PBV2-6 — editor state helpers (shipped code)', () => {
  let api;
  before(() => { api = editorApi(); });

  test('initial state: four walls, one row each at order 0, nothing else', () => {
    const s = api.initial(seq());
    assert.strictEqual(s.rows.length, 4);
    assert.deepStrictEqual(s.rows.map((r) => r.wall).sort(),
      ['bottom', 'left', 'right', 'top']);
    for (const r of s.rows) {
      assert.strictEqual(r.order, 0);
      assert.ok(typeof r.id === 'string' && r.id.length > 0);
    }
    assert.deepStrictEqual(s.entries, []);
    assert.deepStrictEqual(s.connections, []);
  });

  test('add raceway produces exactly {id, rowId, tradeSize} — no wall property', () => {
    const next = seq();
    const s = api.initial(next);
    const rowId = s.rows.find((r) => r.wall === 'left').id;
    const e = api.addEntry(s, rowId, '1-1/4', next('entry'));
    assert.deepStrictEqual(Object.keys(e).sort(), ['id', 'rowId', 'tradeSize']);
    assert.strictEqual(e.rowId, rowId);
    assert.strictEqual(e.tradeSize, '1-1/4');
    assert.strictEqual(s.entries.length, 1);
    assert.ok(!('wall' in e), 'entry must never store a wall');
  });

  test('change size preserves id and rowId', () => {
    const next = seq();
    const s = api.initial(next);
    const rowId = s.rows[0].id;
    const e = api.addEntry(s, rowId, '2', next('entry'));
    const id = e.id;
    assert.strictEqual(api.changeSize(s, id, '4'), true);
    assert.strictEqual(s.entries[0].id, id);
    assert.strictEqual(s.entries[0].rowId, rowId);
    assert.strictEqual(s.entries[0].tradeSize, '4');
  });

  test('add row: stable id, next order above the wall max, other walls untouched', () => {
    const next = seq();
    const s = api.initial(next);
    const r2 = api.addRow(s, 'left', next('row'));
    assert.strictEqual(r2.order, 1);
    const r3 = api.addRow(s, 'left', next('row'));
    assert.strictEqual(r3.order, 2);
    // non-contiguous survives: simulate an old row with order 7
    s.rows.push({ id: 'legacy-order', wall: 'left', order: 7 });
    const r4 = api.addRow(s, 'left', next('row'));
    assert.strictEqual(r4.order, 8, 'next available above current max');
    assert.strictEqual(s.rows.filter((r) => r.wall === 'top').length, 1);
  });

  test('row labels derive from sorted order, never the raw order number', () => {
    const next = seq();
    const s = api.initial(next);
    const left0 = s.rows.find((r) => r.wall === 'left');
    s.rows.push({ id: 'gap', wall: 'left', order: 7 });
    assert.strictEqual(api.rowLabel(s, left0.id), 'Row 1');
    assert.strictEqual(api.rowLabel(s, 'gap'), 'Row 2',
      'stored order 7 still displays as Row 2');
  });

  test('change row: same wall only, id stable, cross-wall rejected', () => {
    const next = seq();
    const s = api.initial(next);
    const leftRow = s.rows.find((r) => r.wall === 'left');
    const left2 = api.addRow(s, 'left', next('row'));
    const topRow = s.rows.find((r) => r.wall === 'top');
    const e = api.addEntry(s, leftRow.id, '3', next('entry'));
    assert.strictEqual(api.changeRow(s, e.id, left2.id), true);
    assert.strictEqual(s.entries[0].rowId, left2.id);
    assert.strictEqual(s.entries[0].id, e.id, 'no delete/recreate');
    assert.strictEqual(s.entries.length, 1, 'no duplication');
    assert.strictEqual(api.changeRow(s, e.id, topRow.id), false,
      'cross-wall move rejected in PBV2-6');
    assert.strictEqual(s.entries[0].rowId, left2.id, 'state unchanged on rejection');
  });

  test('delete entry removes it and any referencing connections (future-safe)', () => {
    const next = seq();
    const s = api.initial(next);
    const rowId = s.rows[0].id;
    const e1 = api.addEntry(s, rowId, '2', next('entry'));
    const e2 = api.addEntry(s, rowId, '3', next('entry'));
    s.connections.push({ id: 'cX', entryIds: [e1.id, e2.id] });
    api.deleteEntry(s, e1.id);
    assert.strictEqual(s.entries.length, 1);
    assert.deepStrictEqual(s.connections, [], 'no orphan connection survives');
  });

  test('delete row cascades entries + connections; last row per wall is protected', () => {
    const next = seq();
    const s = api.initial(next);
    const left1 = s.rows.find((r) => r.wall === 'left');
    const left2 = api.addRow(s, 'left', next('row'));
    const a = api.addEntry(s, left2.id, '2', next('entry'));
    const b = api.addEntry(s, left1.id, '3', next('entry'));
    s.connections.push({ id: 'cX', entryIds: [a.id, b.id] });
    assert.strictEqual(api.deleteRow(s, left2.id), true);
    assert.strictEqual(s.rows.filter((r) => r.wall === 'left').length, 1);
    assert.strictEqual(s.entries.length, 1, 'row entries cascaded');
    assert.deepStrictEqual(s.connections, [], 'connection referencing a doomed entry gone');
    assert.strictEqual(api.deleteRow(s, left1.id), false,
      'the only remaining row on a wall cannot be deleted');
    assert.strictEqual(s.rows.filter((r) => r.wall === 'left').length, 1);
  });

  test('editor state is always a valid engine request during editing', () => {
    const { validatePullBoxRequest } = require('../src/calc/pullBox');
    const next = seq();
    const s = api.initial(next);
    const leftRow = s.rows.find((r) => r.wall === 'left');
    api.addEntry(s, leftRow.id, '4', next('entry'));
    api.addRow(s, 'left', next('row'));
    const r = validatePullBoxRequest(s);
    assert.strictEqual(r.ok, true, 'valid by construction');
    assert.strictEqual(r.warnings[0].code, 'UNCONNECTED_ENTRY',
      'warning, not error — normal mid-editing state');
  });
});

describe('PBV2-6 — milestone scope guards', () => {
  const v2Start = html.indexOf('PULL BOX V2 (PBV2-6)');
  const v2 = html.slice(v2Start);

  test('V2 panel exists and is display:none by default', () => {
    assert.ok(v2Start !== -1);
    assert.ok(html.includes('id="pbv2-overlay"'));
    assert.ok(/#pbv2-overlay\{[^}]*display:none/.test(html));
  });

  test('no connection UI, no Quick Straight, no result rendering yet', () => {
    for (const banned of ['pbv2Connect', 'Quick Straight', 'connection line',
      'minimumWidthIn', 'minimumHeightIn', 'spacingRequirements',
      'calculatePullBox(', 'STRAIGHT', 'ANGLE', 'governing']) {
      assert.ok(!v2.includes(banned),
        'PBV2-7/8 functionality leaked into PBV2-6: ' + banned);
    }
  });

  test('no visible code references in the V2 panel (global clickable rule)', () => {
    const markup = v2.replace(/<script>[\s\S]*?<\/script>/g, '');
    assert.ok(!/314\.28|314\.16|NEC|NYCEC/.test(markup),
      'code references must wait for the clickable Code→AI milestone');
  });

  test('trade sizes come from the injected engine, not a duplicated list', () => {
    assert.ok(v2.includes('EC.pullBox.TRADE_SIZE_KEYS'));
    assert.ok(!/RACEWAY_SIZES/.test(v2), 'legacy constant not reused');
    assert.ok(!/\['1\/2',\s*'3\/4'/.test(v2), 'no second hardcoded size list in V2');
  });

  test('legacy Pull Box remains present, hidden, and disjoint from V2', () => {
    assert.ok(html.includes('id="sub-pullbox"'), 'legacy panel intact');
    assert.ok(/function pbUpdate/.test(html), 'legacy handler intact');
    assert.ok(!/openTool\('pullbox'\)/.test(html), 'legacy still unreachable');
    assert.ok(!/pbLeftList|pbRightList|pbUpdate/.test(v2),
      'V2 never touches legacy state/functions');
    // no duplicate element ids between legacy and V2
    const ids = [...html.matchAll(/id="(pbv2-[^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(ids.length, new Set(ids).size, 'duplicate pbv2 ids');
  });

  test('interactive V2 controls are real buttons with labels', () => {
    assert.ok(!/<div[^>]*onclick/.test(v2), 'clickable divs are not controls');
    assert.ok(v2.includes('aria-label'));
    assert.ok(v2.includes('type="button"'));
  });
});
