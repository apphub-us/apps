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

describe('PBV2-6b — many-rows portrait layout fix', () => {
  const html2 = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  const v2 = html2.slice(html2.indexOf('PULL BOX V2 (PBV2-6)'));

  test('ROOT-CAUSE GUARD: the schematic grid is content-driven, not height-capped', () => {
    const gridCss = v2.match(/\.pbv2-grid\{[^}]*\}/)[0];
    assert.ok(gridCss.includes('grid-template-rows:auto auto auto'),
      'middle row must size to content, not 1fr of a capped container');
    assert.ok(!gridCss.includes('min-height'), 'no fixed grid height');
    assert.ok(!gridCss.includes('flex:1'), 'grid must not be viewport-capped');
    const centerCss = v2.match(/\.pbv2-center\{[^}]*\}/)[0];
    assert.ok(centerCss.includes('min-height:140px'),
      'center keeps a compact overview height and stretches with tall walls');
  });

  test('no data-hiding escape hatch: no overflow clipping, no row/entry caps', () => {
    const styles = v2.match(/<style>[\s\S]*?<\/style>/)[0];
    assert.ok(!/overflow\s*:\s*hidden/.test(styles),
      'clipping is not a containment strategy');
    const render = (() => {
      const i = v2.indexOf('function pbv2Render');
      let d = 0; let started = false;
      for (let j = i; j < v2.length; j++) {
        if (v2[j] === '{') { d++; started = true; } else if (v2[j] === '}') {
          d--; if (started && d === 0) return v2.slice(i, j + 1);
        }
      }
    })();
    assert.ok(/i < rows\.length/.test(render), 'renders every row');
    assert.ok(/j < entries\.length/.test(render), 'renders every entry');
    assert.ok(!/slice\(0\s*,|Math\.min\(/.test(render), 'no arbitrary render cap');
  });

  test('SHIPPED RENDER with the physical failure fixture: 6 LEFT rows all represented', () => {
    // Execute the real pbv2Render against a stub DOM using the exact state
    // that failed the physical gate, extended to six rows.
    const names = ['pbv2RowById', 'pbv2RowLabel', 'pbv2Esc', 'pbv2Render'];
    const src = names.map(fnBody).join('\n');
    const grid = { innerHTML: '' };
    const doc = { getElementById: (id) => (id === 'pbv2-grid' ? grid : null) };
    const state = {
      rows: [
        { id: 'L1', wall: 'left', order: 0 }, { id: 'L2', wall: 'left', order: 1 },
        { id: 'L3', wall: 'left', order: 2 }, { id: 'L4', wall: 'left', order: 3 },
        { id: 'L5', wall: 'left', order: 4 }, { id: 'L6', wall: 'left', order: 5 },
        { id: 'R1', wall: 'right', order: 0 }, { id: 'T1', wall: 'top', order: 0 },
        { id: 'T2', wall: 'top', order: 1 }, { id: 'B1', wall: 'bottom', order: 0 },
        { id: 'B2', wall: 'bottom', order: 1 },
      ],
      entries: [
        { id: 'e1', rowId: 'L1', tradeSize: '4' },
        { id: 'e2', rowId: 'L1', tradeSize: '2-1/2' },
        { id: 'e3', rowId: 'L1', tradeSize: '3' },
        { id: 'e4', rowId: 'L3', tradeSize: '6' },
        { id: 'e5', rowId: 'T1', tradeSize: '2' }, { id: 'e6', rowId: 'T2', tradeSize: '1' },
        { id: 'e7', rowId: 'B1', tradeSize: '5' }, { id: 'e8', rowId: 'B2', tradeSize: '1/2' },
      ],
      connections: [],
    };
    // eslint-disable-next-line no-new-func
    new Function('document', 'PBV2', src + ';pbv2Render();')(doc, state);
    const out = grid.innerHTML;
    for (const label of ['Row 1', 'Row 2', 'Row 3', 'Row 4', 'Row 5', 'Row 6']) {
      const lane = out.slice(out.indexOf('pbv2-lane-left'), out.indexOf('pbv2-lane-right'));
      assert.ok(lane.includes(label), 'LEFT ' + label + ' missing from its wall lane');
    }
    for (const size of ['4&Prime;', '2-1/2&Prime;', '3&Prime;', '6&Prime;']) {
      assert.ok(out.includes(size), size + ' entry missing');
    }
    // TOP/BOTTOM multi-row containment: labels render inside their lanes
    const topLane = out.slice(out.indexOf('pbv2-lane-top'), out.indexOf('pbv2-lane-left'));
    assert.ok(topLane.includes('Row 1') && topLane.includes('Row 2'));
    const bottomLane = out.slice(out.indexOf('pbv2-lane-bottom'));
    assert.ok(bottomLane.includes('Row 1') && bottomLane.includes('Row 2'));
    // every entry stays a tappable inspector button
    assert.strictEqual((out.match(/pbv2UiInspect/g) || []).length, 8);
  });

  test('instruction text sits structurally after the schematic grid', () => {
    const gridPos = html2.indexOf('id="pbv2-grid"');
    const notePos = html2.indexOf('Tap a wall');
    assert.ok(gridPos !== -1 && notePos > gridPos,
      'the note must follow the editor content in document flow');
  });

  test('layout fix changed nothing else: gate, scope and engine boundaries hold', () => {
    assert.ok(v2.includes('pbv2ShouldOpen'), 'dev gate intact');
    for (const banned of ['pbv2Connect', 'Quick Straight', 'minimumWidthIn',
      'calculatePullBox(']) {
      assert.ok(!v2.includes(banned), 'scope creep: ' + banned);
    }
  });
});
