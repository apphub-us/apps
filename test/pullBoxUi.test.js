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

  test('no result rendering, no adapter call (PBV2-8 scope stays out)', () => {
    // Connections and Quick Straight are in scope since PBV2-7; results are
    // not: no dimensions, no spacing cards, no governing, no engine
    // calculation call anywhere in the V2 editor.
    for (const banned of ['minimumWidthIn', 'minimumHeightIn',
      'spacingRequirements', 'calculatePullBox(', 'governing']) {
      assert.ok(!v2.includes(banned),
        'PBV2-8 functionality leaked early: ' + banned);
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
    new Function('document', 'PBV2', 'pbv2ConnectFrom', 'pbv2RenderConnList',
      'pbv2DrawConnections', 'pbv2ScheduleConnectionRedraw',
      src + ';pbv2Render();')(doc, state, null, () => {}, () => {}, () => {});
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
    // every entry stays a tappable button (tap routing: inspect or connect)
    assert.strictEqual((out.match(/pbv2UiEntryTap/g) || []).length, 8);
  });

  test('instruction text sits structurally after the schematic grid', () => {
    const gridPos = html2.indexOf('id="pbv2-grid"');
    const notePos = html2.indexOf('Tap a wall');
    assert.ok(gridPos !== -1 && notePos > gridPos,
      'the note must follow the editor content in document flow');
  });

  test('layout fix survives PBV2-7: gate intact, result scope still out', () => {
    assert.ok(v2.includes('pbv2ShouldOpen'), 'dev gate intact');
    for (const banned of ['minimumWidthIn', 'calculatePullBox(']) {
      assert.ok(!v2.includes(banned), 'scope creep: ' + banned);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-7 — connection workflow + Quick Straight template
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-7 — connection state helpers (shipped code)', () => {
  const html7 = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  function fn7(name) {
    const i = html7.indexOf('function ' + name);
    assert.ok(i !== -1, 'missing: ' + name);
    let d = 0; let started = false;
    for (let j = i; j < html7.length; j++) {
      if (html7[j] === '{') { d++; started = true; } else if (html7[j] === '}') {
        d--; if (started && d === 0) return html7.slice(i, j + 1);
      }
    }
    throw new Error('unterminated ' + name);
  }
  function api7() {
    const engine = require('../src/calc/pullBox');
    const src = ['pbv2InitialState', 'pbv2RowById', 'pbv2AddRow', 'pbv2AddEntry',
      'pbv2ChangeSize', 'pbv2ChangeRow', 'pbv2DeleteEntry', 'pbv2DeleteRow',
      'pbv2RowLabel', 'pbv2AddConnection', 'pbv2DeleteConnection',
      'pbv2EntryDesc', 'pbv2ConnType', 'pbv2QuickStraight']
      .map(fn7).join('\n');
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'exports', src + `
      exports.initial = pbv2InitialState; exports.addEntry = pbv2AddEntry;
      exports.addRow = pbv2AddRow; exports.changeSize = pbv2ChangeSize;
      exports.changeRow = pbv2ChangeRow; exports.deleteEntry = pbv2DeleteEntry;
      exports.deleteRow = pbv2DeleteRow; exports.addConn = pbv2AddConnection;
      exports.delConn = pbv2DeleteConnection; exports.desc = pbv2EntryDesc;
      exports.connType = pbv2ConnType; exports.quick = pbv2QuickStraight;`)(
      { pullBox: engine }, out);
    return out;
  }
  const seq7 = () => { let n = 0; return (p) => { n++; return 'pbv2-' + p + '-' + n; }; };

  function boxWith(api, next) {
    const s = api.initial(next);
    const rowOf = (wall) => s.rows.find((r) => r.wall === wall).id;
    const eL = api.addEntry(s, rowOf('left'), '4', next('entry'));
    const eR = api.addEntry(s, rowOf('right'), '4', next('entry'));
    const eT = api.addEntry(s, rowOf('top'), '2', next('entry'));
    const eL2 = api.addEntry(s, rowOf('left'), '2', next('entry'));
    return { s, eL, eR, eT, eL2 };
  }

  test('create connection: normal id, two endpoints, valid state', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eR } = boxWith(api, next);
    const r = api.addConn(s, eL.id, eR.id, next('connection'));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(Object.keys(r.connection).sort(), ['entryIds', 'id']);
    assert.ok(/^pbv2-connection-\d+$/.test(r.connection.id));
    const { validatePullBoxRequest } = require('../src/calc/pullBox');
    assert.strictEqual(validatePullBoxRequest(s).ok, true);
  });

  test('self tap and duplicate (both orders) create nothing', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eR } = boxWith(api, next);
    assert.strictEqual(api.addConn(s, eL.id, eL.id, next('connection')).reason, 'SELF');
    api.addConn(s, eL.id, eR.id, next('connection'));
    assert.strictEqual(api.addConn(s, eL.id, eR.id, next('connection')).reason, 'DUPLICATE');
    assert.strictEqual(api.addConn(s, eR.id, eL.id, next('connection')).reason, 'DUPLICATE',
      'undirected: reversed order is the same pair');
    assert.strictEqual(s.connections.length, 1);
  });

  test('shared endpoint with a different partner is allowed', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eR, eT } = boxWith(api, next);
    assert.strictEqual(api.addConn(s, eL.id, eR.id, next('connection')).ok, true);
    assert.strictEqual(api.addConn(s, eL.id, eT.id, next('connection')).ok, true);
    assert.strictEqual(s.connections.length, 2);
  });

  test('type comes from the ENGINE: all four classifications through the UI helper', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eR, eT, eL2 } = boxWith(api, next);
    const bRow = s.rows.find((r) => r.wall === 'bottom').id;
    const eB = api.addEntry(s, bRow, '3', next('entry'));
    const c1 = api.addConn(s, eL.id, eR.id, next('connection')).connection;
    const c2 = api.addConn(s, eT.id, eB.id, next('connection')).connection;
    const c3 = api.addConn(s, eL.id, eT.id, next('connection')).connection;
    const c4 = api.addConn(s, eL.id, eL2.id, next('connection')).connection;
    assert.strictEqual(api.connType(s, c1), 'STRAIGHT');
    assert.strictEqual(api.connType(s, c2), 'STRAIGHT');
    assert.strictEqual(api.connType(s, c3), 'ANGLE');
    assert.strictEqual(api.connType(s, c4), 'U');
  });

  test('SOURCE OF TRUTH: the UI classifier is one engine call, no local wall logic', () => {
    const body = fn7('pbv2ConnType');
    assert.ok(body.includes('EC.pullBox.classifyConnection'));
    assert.ok(!/opposite|adjacent|===\s*'left'|===\s*'right'/i.test(body),
      'no reimplemented wall-relationship logic');
    const v2 = html7.slice(html7.indexOf('PULL BOX V2'));
    assert.strictEqual((v2.match(/classifyConnection/g) || []).length, 1,
      'exactly one classification call site in the editor');
  });

  test('delete connection removes only the connection', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eR } = boxWith(api, next);
    const c = api.addConn(s, eL.id, eR.id, next('connection')).connection;
    api.delConn(s, c.id);
    assert.deepStrictEqual(s.connections, []);
    assert.strictEqual(s.entries.length, 4, 'raceways untouched');
  });

  test('CASCADES with real connections: entry delete, row delete, unrelated preserved', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eR, eT, eL2 } = boxWith(api, next);
    api.addConn(s, eL.id, eR.id, next('connection'));
    api.addConn(s, eL.id, eT.id, next('connection'));
    const keep = api.addConn(s, eL2.id, eT.id, next('connection')).connection;
    api.deleteEntry(s, eL.id);
    assert.strictEqual(s.connections.length, 1, 'both eL connections cascaded');
    assert.strictEqual(s.connections[0].id, keep.id, 'unrelated connection preserved');
    // row cascade
    const left2 = api.addRow(s, 'left', next('row'));
    const eNew = api.addEntry(s, left2.id, '3', next('entry'));
    api.addConn(s, eNew.id, eT.id, next('connection'));
    assert.strictEqual(api.deleteRow(s, left2.id), true);
    assert.strictEqual(s.connections.length, 1, 'row-entry connection cascaded');
    assert.strictEqual(s.connections[0].id, keep.id);
  });

  test('EDIT PRESERVATION: change size and same-wall change row keep the connection', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eR } = boxWith(api, next);
    const c = api.addConn(s, eL.id, eR.id, next('connection')).connection;
    api.changeSize(s, eL.id, '6');
    assert.strictEqual(s.connections[0].id, c.id);
    assert.strictEqual(api.connType(s, c), 'STRAIGHT');
    const left2 = api.addRow(s, 'left', next('row'));
    assert.strictEqual(api.changeRow(s, eL.id, left2.id), true);
    assert.strictEqual(s.connections[0].id, c.id, 'same connection object/id');
    assert.strictEqual(api.connType(s, c), 'STRAIGHT',
      'wall unchanged, so derived type unchanged');
  });

  test('QUICK STRAIGHT horizontal: normal LEFT/RIGHT pair, engine-classified width', () => {
    const api = api7(); const next = seq7();
    const s = api.initial(next);
    const r = api.quick(s, 'horizontal', '4', next);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(s.entries.length, 2);
    const engine = require('../src/calc/pullBox');
    assert.strictEqual(engine.validatePullBoxRequest(s).ok, true);
    const cls = engine.classifyConnection(r.connection, s.entries, s.rows);
    assert.strictEqual(cls.type, 'STRAIGHT');
    assert.strictEqual(cls.dimension, 'width');
    for (const e of s.entries) assert.strictEqual(e.tradeSize, '4');
    assert.ok(/^pbv2-entry-\d+$/.test(s.entries[0].id), 'normal ids, no special template ids');
  });

  test('QUICK STRAIGHT vertical: TOP/BOTTOM pair, height', () => {
    const api = api7(); const next = seq7();
    const s = api.initial(next);
    const r = api.quick(s, 'vertical', '3', next);
    const engine = require('../src/calc/pullBox');
    const cls = engine.classifyConnection(r.connection, s.entries, s.rows);
    assert.strictEqual(cls.type, 'STRAIGHT');
    assert.strictEqual(cls.dimension, 'height');
    const walls = s.entries.map((e) => s.rows.find((x) => x.id === e.rowId).wall).sort();
    assert.deepStrictEqual(walls, ['bottom', 'top']);
  });

  test('QUICK STRAIGHT adds to existing state without touching it', () => {
    const api = api7(); const next = seq7();
    const { s, eL, eT } = boxWith(api, next);
    const before = api.addConn(s, eL.id, eT.id, next('connection')).connection;
    const snapshotIds = s.entries.map((e) => e.id);
    api.quick(s, 'horizontal', '2', next);
    assert.strictEqual(s.entries.length, 6, 'four existing + two new');
    for (const id of snapshotIds) assert.ok(s.entries.some((e) => e.id === id));
    assert.strictEqual(s.connections.length, 2);
    assert.ok(s.connections.some((c) => c.id === before.id), 'existing connection intact');
  });

  test('QUICK STRAIGHT recreates a missing order-0 row rather than failing', () => {
    const api = api7(); const next = seq7();
    const s = api.initial(next);
    // user replaced the primary left row: add row order 1, delete order 0
    const left2 = api.addRow(s, 'left', next('row'));
    const left0 = s.rows.find((r) => r.wall === 'left' && r.order === 0);
    assert.strictEqual(api.deleteRow(s, left0.id), true);
    const r = api.quick(s, 'horizontal', '2', next);
    assert.strictEqual(r.ok, true);
    assert.ok(s.rows.some((x) => x.wall === 'left' && x.order === 0),
      'primary row recreated with order 0');
    assert.ok(s.rows.some((x) => x.id === left2.id), 'user row untouched');
  });
});

describe('PBV2-7 — connection render architecture + scope', () => {
  const html7 = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  const v2 = html7.slice(html7.indexOf('PULL BOX V2'));

  test('connection layer, stage and accessible list exist; entries expose identity', () => {
    assert.ok(v2.includes('id="pbv2-connlayer"'), 'SVG layer');
    assert.ok(v2.includes('id="pbv2-stage"'), 'relative stage');
    assert.ok(v2.includes('id="pbv2-connlist"'), 'accessible connection list');
    assert.ok(v2.includes('data-entry-id='), 'entry buttons expose stable identity');
    assert.ok(v2.includes('pbv2-connitem'), 'list items are buttons');
  });

  test('coordinates come from live DOM geometry, never per-wall constants', () => {
    const draw = v2.slice(v2.indexOf('function pbv2DrawConnections'),
      v2.indexOf('var pbv2ResizeHooked'));
    assert.ok(draw.includes('getBoundingClientRect'), 'measures rendered buttons');
    assert.ok(draw.includes('data-entry-id'), 'endpoint resolution by entry id');
    assert.ok(!/case 'left'|wall === 'left'.*[0-9]+/.test(draw),
      'no hardcoded wall coordinates');
    assert.ok(draw.includes('stroke-width="22"'), 'wide invisible hit target');
    assert.ok(draw.includes('stroke-width="2"'), 'restrained visible line');
  });

  test('redraw strategy: render-driven + exactly one resize/orientation hook, no polling', () => {
    assert.ok(/pbv2RenderConnList\(\);\s*pbv2DrawConnections\(\);/.test(v2),
      'draw runs after every render');
    assert.ok(v2.includes('pbv2ResizeHooked'), 'idempotent listener guard');
    assert.strictEqual((v2.match(/addEventListener\('resize'/g) || []).length, 1);
    // bounded double-rAF scheduler only: exactly two rAF calls, both inside
    // the coalesced one-shot scheduler — never a loop, never an interval
    assert.strictEqual((v2.match(/window\.requestAnimationFrame\(/g) || []).length, 2,
      'exactly the two bounded scheduler frames');
    assert.ok(!v2.includes('setInterval'), 'no polling');
    assert.ok(!v2.includes("addEventListener('scroll'"),
      'shared scroll coordinate space: SVG lives inside the scrolled stage');
  });

  test('Connect workflow wiring is present and tap-first', () => {
    assert.ok(v2.includes('pbv2UiStartConnect'), 'inspector CONNECT action');
    assert.ok(v2.includes('pbv2ConnectFrom'), 'source entry recorded');
    assert.ok(v2.includes('Connecting from:'), 'mode feedback');
    assert.ok(v2.includes('pbv2CancelConnect'), 'cancel action');
    assert.ok(v2.includes('Choose another raceway'), 'self-tap message');
    assert.ok(v2.includes('Already connected'), 'duplicate message');
    assert.ok(!/ondrag|dragstart/.test(v2), 'no drag requirement');
  });

  test('inspector and lines show type words but never code references or results', () => {
    assert.ok(v2.includes('PBV2_TYPE_LABEL'), 'display labels for derived types');
    const markup = v2.replace(/<script>[\s\S]*?<\/script>/g, '');
    assert.ok(!/314\.28|NEC|NYCEC/.test(markup), 'no visible code references');
    assert.ok(!v2.includes('minimumWidthIn') && !v2.includes('calculatePullBox('),
      'no result adapter yet');
    assert.ok(!v2.includes('r.connection.id + \'</'), 'connection id not rendered to user');
  });

  test('many-rows layout fix intact with the connection layer added', () => {
    const gridCss = v2.match(/\.pbv2-grid\{[^}]*\}/)[0];
    assert.ok(gridCss.includes('grid-template-rows:auto auto auto'));
    assert.ok(!gridCss.includes('min-height') && !gridCss.includes('flex:1'));
    const stage = v2.match(/id="pbv2-stage" style="([^"]*)"/)[1];
    assert.ok(!/height\s*:\s*\d/.test(stage), 'stage has no fixed height');
  });

  test('dev gate and legacy panel remain exactly as before', () => {
    assert.ok(!/openTool\('pullbox/.test(html7));
    assert.ok(html7.includes('id="sub-pullbox"') && /function pbUpdate/.test(html7));
    assert.ok(v2.includes('pbv2ShouldOpen'));
  });
});

describe('PBV2-7b — connection redraw timing fix', () => {
  const html7b = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  function fn7b(name) {
    const i = html7b.indexOf('function ' + name);
    assert.ok(i !== -1, 'missing: ' + name);
    let d = 0; let started = false;
    for (let j = i; j < html7b.length; j++) {
      if (html7b[j] === '{') { d++; started = true; } else if (html7b[j] === '}') {
        d--; if (started && d === 0) return html7b.slice(i, j + 1);
      }
    }
    throw new Error('unterminated ' + name);
  }

  /** Harness: shipped scheduler + modal functions with a fake rAF queue. */
  function harness() {
    const frames = [];
    const win = { requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; } };
    let draws = 0;
    const els = {
      'pbv2-modal-title': { textContent: '' },
      'pbv2-modal-body': { innerHTML: '' },
      'pbv2-modal': { style: {} },
    };
    const doc = { getElementById: (id) => els[id] || null };
    const src = [fn7b('pbv2ScheduleConnectionRedraw'), fn7b('pbv2OpenModal'),
      fn7b('pbv2CloseModal'), fn7b('pbv2HookResize')].join('\n')
      + '\nvar pbv2RedrawPending = false; var pbv2ResizeHooked = false;';
    const api = {};
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'pbv2DrawConnections', 'exports',
      // module-scope vars must be shared with the functions: re-declare them
      // ahead so the shipped closures see the same bindings
      'var pbv2RedrawPending = false; var pbv2ResizeHooked = false;\n'
      + [fn7b('pbv2ScheduleConnectionRedraw'), fn7b('pbv2OpenModal'),
        fn7b('pbv2CloseModal'), fn7b('pbv2HookResize')].join('\n')
      + `;exports.schedule = pbv2ScheduleConnectionRedraw;
         exports.open = pbv2OpenModal; exports.close = pbv2CloseModal;
         exports.hook = pbv2HookResize;`)(
      win, doc, () => { draws++; }, api);
    const runFrames = () => {
      // drain the rAF queue to a fixed point (bounded chain, so this ends)
      let guard = 0;
      while (frames.length > 0 && guard++ < 10) frames.shift()();
      assert.ok(guard < 10, 'unbounded rAF chain detected');
    };
    return { api, win, frames, runFrames, draws: () => draws };
  }

  test('scheduler: one-shot bounded double-rAF, coalesced', () => {
    const h = harness();
    h.api.schedule();
    h.api.schedule();
    h.api.schedule();
    assert.strictEqual(h.frames.length, 1, 'repeated requests coalesce to one chain');
    h.runFrames();
    assert.strictEqual(h.draws(), 1, 'exactly one redraw after the frames settle');
    // and it re-arms: a later transition schedules again
    h.api.schedule();
    h.runFrames();
    assert.strictEqual(h.draws(), 2);
  });

  test('SHIPPED PATH: inspector/modal open and close both schedule a settle redraw', () => {
    const h = harness();
    h.api.open('Connection', '<div></div>');
    h.runFrames();
    assert.strictEqual(h.draws(), 1, 'open schedules');
    h.api.close();
    h.runFrames();
    assert.strictEqual(h.draws(), 2, 'close schedules — the failing physical case');
  });

  test('resize/orientation route through the scheduler, never measure mid-transition', () => {
    const hook = fn7b('pbv2HookResize');
    assert.ok(hook.includes("addEventListener('resize', pbv2ScheduleConnectionRedraw)"));
    assert.ok(hook.includes("addEventListener('orientationchange', pbv2ScheduleConnectionRedraw)"));
    assert.ok(!hook.includes('pbv2DrawConnections'),
      'no direct draw from transition events');
  });

  test('render performs the immediate draw AND one settle pass', () => {
    const render = fn7b('pbv2Render');
    assert.ok(render.includes('pbv2DrawConnections();'));
    assert.ok(render.includes('pbv2ScheduleConnectionRedraw();'));
  });

  test('every geometry-changing UI action funnels into render or the scheduler', () => {
    // Change Size / Change Row / connect / delete / Quick Straight all end in
    // pbv2Render (immediate + settle); modal transitions schedule directly.
    for (const fname of ['pbv2UiChangeSizePick', 'pbv2UiChangeRowPick',
      'pbv2UiDeleteConnection', 'pbv2UiQuickPick', 'pbv2UiAddEntryPick',
      'pbv2UiDeleteEntry']) {
      assert.ok(fn7b(fname).includes('pbv2Render()'), fname + ' rerenders');
    }
    // bound the slice to the V2 block itself — unrelated legacy tail code
    // follows it in the file
    const v2 = html7b.slice(html7b.indexOf('PULL BOX V2'),
      html7b.indexOf('END PULL BOX V2'));
    assert.ok(!v2.includes("addEventListener('scroll'"),
      'still no scroll listener: shared scrolling coordinate space');
    assert.ok(!v2.includes('setInterval') && !v2.includes('setTimeout('),
      'no timers, no polling');
  });
});
