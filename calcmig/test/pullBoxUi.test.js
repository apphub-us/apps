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

  test('result adapter is in scope (8A); production exposure is not', () => {
    // Results/adapter opened in PBV2-8A. What must STILL not exist: any
    // production navigation route or applicability gate (PBV2-8B+).
    assert.ok(v2.includes('calculatePullBox('), '8A adapter present');
    assert.ok(!html.includes("openTool('pullbox-v2'"), 'no production route');
    assert.ok(!/NOT SURE|applicability/i.test(v2), '8B gate not started');
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

  test('interactive V2 controls are real buttons or accessible role=button cards', () => {
    // Plain clickable divs are banned. The one sanctioned exception: result
    // cards, which must be divs because they CONTAIN a codeRef <button>
    // (nested <button> is invalid HTML) — those must carry role="button"
    // and tabindex to stay accessible.
    const clickableDivs = v2.match(/<div[^>]*onclick/g) || [];
    for (const m of clickableDivs) {
      assert.ok(m.includes('role="button"') && m.includes('tabindex'),
        'clickable div must be an accessible role=button card: ' + m.slice(0, 80));
    }
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
      'pbv2DrawConnections', 'pbv2ScheduleConnectionRedraw', 'pbv2Highlight',
      'EC', 'PBV2_COLOR',
      src + ';pbv2Render();')(doc, state, null, () => {}, () => {}, () => {}, null,
      { pullBox: require('../src/calc/pullBox') },
      { width: '#4a90d9', height: '#52c07a', spacing: '#b06ae8' });
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

  test('layout fix survives PBV2-7/8A: gate intact, no production exposure', () => {
    assert.ok(v2.includes('pbv2ShouldOpen'), 'dev gate intact');
    assert.ok(!html2.includes("openTool('pullbox-v2'"), 'still dev-only');
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
    assert.ok(draw.includes("hl ? '3' : '2'"),
      'restrained 2px visible line, 3px only when highlighted');
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

  test('GLOBAL CLICKABLE RULE: every visible NEC reference is an ec-coderef button', () => {
    assert.ok(v2.includes('PBV2_TYPE_LABEL'), 'display labels for derived types');
    // Static markup carries no code references; the renderer emits them
    // ONLY through ecRenderCodeRef, which always produces a button.
    const markup = v2.replace(/<script>[\s\S]*?<\/script>/g, '');
    assert.ok(!/314\.28|NEC|NYCEC/.test(markup), 'no inert static code refs');
    const renderer = v2.slice(v2.indexOf('function ecRenderCodeRef'));
    assert.ok(renderer.indexOf('<button class="ec-coderef"') !== -1);
    // behavioral proof that rendered NEC text only exists inside coderef
    // buttons lives in the PBV2-8A battery (strip-buttons check)
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
    assert.ok(!v2.includes('setInterval'), 'no polling');
    // exactly ONE setTimeout: the app's established AI-chat handoff
    assert.strictEqual((v2.match(/setTimeout\(/g) || []).length, 1);
    assert.ok(/setTimeout\(function \(\) \{ sendMessage\(\); \}, 100\)/.test(v2),
      'the single timer is the existing chat handoff pattern, not a redraw hack');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-8A — result adapter + structured result UI + Code→AI
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-8A — shipped calculate/render path', () => {
  const html8 = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  function fn8(name) {
    const i = html8.indexOf('function ' + name + '(');
    assert.ok(i !== -1, 'missing: ' + name);
    let d = 0; let started = false;
    for (let j = i; j < html8.length; j++) {
      if (html8[j] === '{') { d++; started = true; } else if (html8[j] === '}') {
        d--; if (started && d === 0) return html8.slice(i, j + 1);
      }
    }
    throw new Error('unterminated ' + name);
  }

  /** Full harness: shipped state helpers + adapter + renderer against a stub
   *  DOM, with a real or poisoned engine injected as EC.pullBox. */
  function harness(engineOverride) {
    const engine = engineOverride || require('../src/calc/pullBox');
    let calcCalls = 0;
    const counted = Object.create(engine);
    counted.calculatePullBox = function (req) {
      calcCalls++;
      return engine.calculatePullBox(req);
    };
    const els = {};
    const el = (id) => {
      if (!els[id]) {
        els[id] = { innerHTML: '', value: '', style: {}, textContent: '',
          classList: { contains: () => false, add: () => {}, remove: () => {} } };
      }
      return els[id];
    };
    const names = ['pbv2InitialState', 'pbv2RowById', 'pbv2AddRow', 'pbv2AddEntry',
      'pbv2ChangeSize', 'pbv2ChangeRow', 'pbv2DeleteEntry', 'pbv2DeleteRow',
      'pbv2RowLabel', 'pbv2Esc', 'pbv2AddConnection', 'pbv2DeleteConnection',
      'pbv2EntryDesc', 'pbv2QuickStraight', 'ecRenderCodeRef', 'ecOpenCodeRef',
      'pbv2InvalidateResult', 'pbv2In', 'pbv2Equation', 'pbv2ReqTitle',
      'pbv2ReqAiPrompt', 'pbv2SpacingAiPrompt', 'pbv2ReqCard', 'pbv2Calculate',
      'pbv2FindReq', 'pbv2RenderResults'];
    const src = names.map(fn8).join('\n');
    const api = {};
    const handoff = { prompts: [], switched: 0 };
    // eslint-disable-next-line no-new-func
    new Function('EC', 'document', 'window', 'switchTab', 'sendMessage',
      'setTimeout', 'exports',
      `var EC_CODE_CONTEXTS = [];
       var PBV2_COLOR = { width: '#4a90d9', height: '#52c07a', spacing: '#b06ae8' };
       var pbv2Highlight = null;
       var PBV2_ERROR_TEXT = { NO_ENTRIES: 'Add at least one raceway before calculating.' };
       var PBV2_NOTE_TEXT = {
         SPACING_VERIFY_IN_LAYOUT: 'Actual raceway-entry spacing must still be verified in the physical box layout.',
         NO_WIDTH_CANDIDATES: 'No current pull produces a width requirement.',
         NO_HEIGHT_CANDIDATES: 'No current pull produces a height requirement.',
         DEPTH_NOT_CALCULATED: 'Depth is not calculated by this tool.',
         A3_NOT_EVALUATED: 'listed smaller-dimension products or exceptions are not evaluated by this tool.',
       };
       var PBV2 = null; var pbv2LastResult = null;
       var pbv2Seq = 0;
       function pbv2NextId(p) { pbv2Seq++; return 'pbv2-' + p + '-' + pbv2Seq; }
       ${src}
       exports.setState = (s) => { PBV2 = s; };
       exports.getState = () => PBV2;
       exports.initial = () => pbv2InitialState(pbv2NextId);
       exports.nextId = pbv2NextId;
       exports.helpers = { addEntry: pbv2AddEntry, addConn: pbv2AddConnection,
         addRow: pbv2AddRow, quick: pbv2QuickStraight };
       exports.calculate = pbv2Calculate;
       exports.invalidate = pbv2InvalidateResult;
       exports.lastResult = () => pbv2LastResult;
       exports.openCodeRef = ecOpenCodeRef;
       exports.contexts = () => EC_CODE_CONTEXTS;`)(
      { pullBox: counted },
      { getElementById: el },
      {}, // window
      () => { handoff.switched++; },
      () => {},
      (cb) => cb(),   // immediate setTimeout for the handoff
      api);
    return { api, els, el, handoff, calcCalls: () => calcCalls };
  }

  /** Build a state through the shipped helpers. */
  function build(h, plan) {
    const s = h.api.initial();
    h.api.setState(s);
    const rowOf = (wall) => s.rows.find((r) => r.wall === wall).id;
    const made = {};
    for (const [key, wall, size] of plan.entries || []) {
      made[key] = h.api.helpers.addEntry(s, rowOf(wall), size, h.api.nextId('entry'));
    }
    for (const [a, b] of plan.connections || []) {
      h.api.helpers.addConn(s, made[a].id, made[b].id, h.api.nextId('connection'));
    }
    return { s, made };
  }

  test('A/B: straight-only — width 32, honest null height; both axes — 32/24', () => {
    const h = harness();
    build(h, { entries: [['a', 'left', '4'], ['b', 'right', '4']], connections: [['a', 'b']] });
    h.api.calculate();
    let out = h.el('pbv2-results').innerHTML;
    assert.ok(out.includes('MINIMUM INSIDE DIMENSIONS'));
    assert.ok(out.includes('32\u2033'), 'width 32');
    assert.ok(out.includes('Not determined from current pulls'), 'null height wording');
    assert.ok(!out.includes('0\u2033'), 'never a fake zero');
    const h2 = harness();
    build(h2, { entries: [['a', 'left', '4'], ['b', 'right', '4'],
      ['t', 'top', '3'], ['bt', 'bottom', '3']],
      connections: [['a', 'b'], ['t', 'bt']] });
    h2.api.calculate();
    out = h2.el('pbv2-results').innerHTML;
    assert.ok(out.includes('32\u2033') && out.includes('24\u2033'), 'both axes');
  });

  test('C/D: angle renders separate axes; U renders dimension + separate spacing', () => {
    const h = harness();
    build(h, { entries: [['a', 'left', '2'], ['t', 'top', '2']], connections: [['a', 't']] });
    h.api.calculate();
    let out = h.el('pbv2-results').innerHTML;
    assert.ok(out.includes('WIDTH GOVERNED BY') && out.includes('HEIGHT GOVERNED BY'));
    assert.ok(out.includes('ENTRY SPACING'));
    const hU = harness();
    build(hU, { entries: [['a', 'left', '3'], ['b', 'left', '3']], connections: [['a', 'b']] });
    hU.api.calculate();
    out = hU.el('pbv2-results').innerHTML;
    assert.ok(out.includes('21\u2033'), 'U dimension 6x3+3');
    assert.ok(out.includes('18\u2033'), 'U spacing 6x3 rendered separately');
    assert.ok(out.indexOf('ENTRY SPACING') > out.indexOf('MINIMUM INSIDE DIMENSIONS'),
      'spacing never presented as a box dimension');
  });

  test('E: frozen mixed design fixture — 32 width, 12 height, one 12 spacing', () => {
    const h = harness();
    build(h, { entries: [['L4', 'left', '4'], ['L2', 'left', '2'],
      ['R4', 'right', '4'], ['T2', 'top', '2']],
      connections: [['L4', 'R4'], ['L2', 'T2']] });
    h.api.calculate();
    const out = h.el('pbv2-results').innerHTML;
    assert.ok(out.includes('32\u2033') && out.includes('12\u2033'));
    assert.ok(out.includes('8 \u00D7 4\u2033 = 32\u2033'), 'straight equation from fields');
    assert.strictEqual((out.match(/ENTRY SPACING/g) || []).length, 1);
  });

  test('F: no connections — nulls, warning, candidate notes, no fake result', () => {
    const h = harness();
    build(h, { entries: [['a', 'left', '3'], ['t', 'top', '2']] });
    h.api.calculate();
    const out = h.el('pbv2-results').innerHTML;
    assert.strictEqual((out.match(/Not determined from current pulls/g) || []).length, 2);
    assert.ok(out.includes('Unconnected raceways'));
    assert.ok(out.includes('still counted in same-row sizing'));
    assert.ok(out.includes('No current pull produces a width requirement.'));
    assert.ok(out.includes('Depth is not calculated'));
    assert.ok(!/Compliant|Pass|Approved/i.test(out), 'never claims compliance');
  });

  test('EXACTLY ONE ENGINE CALL per calculate action', () => {
    const h = harness();
    build(h, { entries: [['a', 'left', '4'], ['b', 'right', '4']], connections: [['a', 'b']] });
    h.api.calculate();
    assert.strictEqual(h.calcCalls(), 1, 'one call, no validate-then-calculate');
    h.api.calculate();
    assert.strictEqual(h.calcCalls(), 2, 'each action is exactly one more call');
  });

  test('POISONED ENGINE: synthetic values render verbatim — UI never recalculates', () => {
    const poisoned = {
      calculatePullBox: () => ({
        ok: true,
        minimumWidthIn: 123.25,
        minimumHeightIn: 77.5,
        widthRequirements: [{
          id: 'straight:cX', kind: 'STRAIGHT', dimension: 'width',
          connectionId: 'cX', entryIds: ['zz-a', 'zz-b'],
          largestTradeSize: '4', otherTradeSizes: [], multiplier: 8,
          minimumInches: 123.25, codeRef: { code: 'NEC', section: '314.28(A)(1)' },
        }],
        heightRequirements: [{
          id: 'angle-u-row:rQ', kind: 'ANGLE_U_ROW', dimension: 'height',
          wall: 'top', rowId: 'rQ', rowOrder: 0, entryIds: ['zz-c'],
          largestTradeSize: '2', otherTradeSizes: ['1'], multiplier: 6,
          minimumInches: 77.5, triggerConnectionIds: ['cQ'],
          codeRef: { code: 'NEC', section: '314.28(A)(2)' },
        }],
        governingWidthRequirementId: 'straight:cX',
        governingHeightRequirementId: 'angle-u-row:rQ',
        spacingRequirements: [{
          id: 'spacing:cX', kind: 'ENTRY_SPACING', connectionType: 'ANGLE',
          connectionId: 'cX', entryIds: ['zz-a', 'zz-c'],
          largerTradeSize: '3', multiplier: 6, minimumInches: 19.75,
          codeRef: { code: 'NEC', section: '314.28(A)(2)' },
        }],
        completeForRequest: true,
        warnings: [],
        scopeNotes: [{ code: 'DEPTH_NOT_CALCULATED' }],
      }),
      TRADE_SIZE_KEYS: require('../src/calc/pullBox').TRADE_SIZE_KEYS,
    };
    const h = harness(poisoned);
    h.api.setState(h.api.initial());
    h.api.calculate();
    const out = h.el('pbv2-results').innerHTML;
    assert.ok(out.includes('123.25\u2033'), 'poisoned width rendered exactly');
    assert.ok(out.includes('77.5\u2033'), 'poisoned height rendered exactly');
    assert.ok(out.includes('19.75\u2033'), 'poisoned spacing rendered exactly');
    assert.ok(out.includes('8 \u00D7 4\u2033 = 123.25\u2033'),
      'equation formatted from fields, result NOT recomputed to 32');
    assert.ok(out.includes('6 \u00D7 2\u2033 + 1\u2033 = 77.5\u2033'),
      'row equation from fields, not 13');
    // GOVERNING TRUST: cards exist because the UI resolved the poisoned
    // governing ids, not because it re-derived a maximum
    assert.ok(out.includes('WIDTH GOVERNED BY') && out.includes('HEIGHT GOVERNED BY'));
  });

  test('CLICKABLE RULE: stripping ec-coderef buttons leaves zero NEC text', () => {
    const h = harness();
    build(h, { entries: [['L4', 'left', '4'], ['L2', 'left', '2'],
      ['R4', 'right', '4'], ['T2', 'top', '2']],
      connections: [['L4', 'R4'], ['L2', 'T2']] });
    h.api.calculate();
    const out = h.el('pbv2-results').innerHTML;
    assert.ok(out.includes('NEC 314.28(A)(1)') && out.includes('NEC 314.28(A)(2)'));
    const stripped = out.replace(/<button class="ec-coderef"[\s\S]*?<\/button>/g, '');
    assert.ok(!/NEC|314\.28/.test(stripped),
      'every visible code reference is an interactive coderef button');
    assert.ok(out.includes('aria-label="Explain NEC'), 'accessible labels');
  });

  test('CODE→AI CONTEXT: straight, row and spacing prompts carry the exact calculation', () => {
    const h = harness();
    build(h, { entries: [['L4', 'left', '4'], ['L2', 'left', '2'],
      ['R4', 'right', '4'], ['T2', 'top', '2']],
      connections: [['L4', 'R4'], ['L2', 'T2']] });
    h.api.calculate();
    const ctx = h.api.contexts();
    const prompts = ctx.map((c) => c.prompt);
    const straight = prompts.find((p) => p.includes('Straight pull'));
    assert.ok(straight.includes('314.28(A)(1)'));
    assert.ok(straight.includes('LEFT \u00B7 Row 1 \u00B7 4\u2033')
      && straight.includes('RIGHT \u00B7 Row 1 \u00B7 4\u2033'), 'endpoints resolved');
    assert.ok(straight.includes('8 \u00D7 4 inch = 32 inches'), 'engine numbers, engine result');
    const rowPrompt = prompts.find((p) => p.includes('Angle/U pull row requirement')
      && p.includes('left wall'));
    assert.ok(rowPrompt, 'left-wall row prompt exists');
    assert.ok(rowPrompt.includes('Row 1') && rowPrompt.includes('314.28(A)(2)'));
    assert.ok(rowPrompt.includes('raceways: 4 inch, 2 inch'), 'row raceways in context');
    const spacing = prompts.find((p) => p.includes('ENTRY SPACING'));
    assert.ok(spacing.includes('not the box dimension'),
      'AI is told this is spacing, not the dimensional rule');
    assert.ok(spacing.includes('ANGLE') && spacing.includes('= 12 inches'));
    // tapping a ref uses the existing chat handoff and preserves state
    const before = JSON.stringify(h.api.getState());
    h.api.openCodeRef(0);
    assert.strictEqual(h.el('userInput').value, ctx[0].prompt, 'prefilled');
    assert.strictEqual(h.handoff.switched, 1, 'existing switchTab handoff');
    assert.strictEqual(JSON.stringify(h.api.getState()), before,
      'PBV2 session state untouched by AI navigation');
  });

  test('INVALIDATION: every mutation hides the stale result until recalculated', () => {
    const h = harness();
    const { s, made } = build(h, {
      entries: [['a', 'left', '4'], ['b', 'right', '4'], ['t', 'top', '2']],
      connections: [['a', 'b']] });
    h.api.calculate();
    assert.ok(h.el('pbv2-results').innerHTML.includes('32\u2033'));
    h.api.invalidate();
    assert.ok(h.el('pbv2-results').innerHTML.includes('Box changed'),
      'stale message replaces the old result');
    assert.ok(!h.el('pbv2-results').innerHTML.includes('32\u2033'),
      'no old electrical value remains visible');
    assert.strictEqual(h.api.lastResult(), null);
    // recalculate restores
    h.api.calculate();
    assert.ok(h.el('pbv2-results').innerHTML.includes('32\u2033'));
  });

  test('INVALIDATION WIRING: every shipped mutation handler invalidates', () => {
    for (const fname of ['pbv2UiAddRow', 'pbv2UiAddEntryPick', 'pbv2UiChangeSizePick',
      'pbv2UiChangeRowPick', 'pbv2UiDeleteConnection', 'pbv2UiQuickPick',
      'pbv2UiDeleteEntry', 'pbv2UiDeleteRow', 'pbv2ResetConfirm']) {
      assert.ok(fn8(fname).includes('pbv2InvalidateResult'),
        fname + ' must invalidate the displayed result');
    }
    // connection creation invalidates on success
    assert.ok(fn8('pbv2UiEntryTap').includes('pbv2InvalidateResult'));
    // Quick Straight never auto-calculates
    assert.ok(!fn8('pbv2UiQuickPick').includes('pbv2Calculate'),
      'template only — user must tap CALCULATE');
  });

  test('VALIDATION FAILURE: structured reason maps to concise UI text', () => {
    const h = harness();
    h.api.setState({ rows: [{ id: 'r', wall: 'left', order: 0 }], entries: [], connections: [] });
    h.api.calculate();
    assert.ok(h.el('pbv2-results').innerHTML.includes('Add at least one raceway'));
    assert.ok(!h.el('pbv2-results').innerHTML.includes('stack'), 'no dev traces');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-8V — visual refinement: typed paths, measurement overlays, colors
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-8V — typed connection paths + measurement overlays', () => {
  const htmlV = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  function fnV(name) {
    const i = htmlV.indexOf('function ' + name + '(');
    assert.ok(i !== -1, 'missing: ' + name);
    let d = 0; let started = false;
    for (let j = i; j < htmlV.length; j++) {
      if (htmlV[j] === '{') { d++; started = true; } else if (htmlV[j] === '}') {
        d--; if (started && d === 0) return htmlV.slice(i, j + 1);
      }
    }
    throw new Error('unterminated ' + name);
  }

  /** Draw harness: shipped pbv2DrawConnections against a stub stage whose
   *  entry buttons sit at fixed coordinates. */
  function drawHarness(state, opts) {
    const engine = require('../src/calc/pullBox');
    const svg = { innerHTML: '' };
    const coords = opts.coords;
    const stage = {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      querySelector: (sel) => {
        const id = sel.match(/data-entry-id="([^"]+)"/)[1];
        if (!coords[id]) return null;
        return { getBoundingClientRect: () => ({
          left: coords[id][0], top: coords[id][1], width: 44, height: 44 }) };
      },
    };
    const doc = { getElementById: (id) =>
      (id === 'pbv2-connlayer' ? svg : id === 'pbv2-stage' ? stage : null) };
    const src = [fnV('pbv2RowById'), fnV('pbv2RowLabel'), fnV('pbv2ConnType'),
      fnV('pbv2WallOfEntry'), fnV('pbv2ConnPathD'), fnV('pbv2In'),
      fnV('pbv2DrawConnections')].join('\n');
    // eslint-disable-next-line no-new-func
    new Function('EC', 'document', 'PBV2', 'pbv2LastResult', 'pbv2Highlight',
      'PBV2_TYPE_LABEL', 'PBV2_COLOR', 'PBV2_VIZ',
      src + ';pbv2DrawConnections();')(
      { pullBox: engine }, doc, state, opts.result || null, opts.highlight || null,
      { STRAIGHT: 'Straight', ANGLE: 'Angle', U: 'U' },
      { width: '#4a90d9', height: '#52c07a', spacing: '#b06ae8' },
      { elbowRadius: 22, uDepth: 52, measureOffset: 18, measureTick: 5 });
    return svg.innerHTML;
  }

  function vizState() {
    return {
      rows: [{ id: 'rL', wall: 'left', order: 0 }, { id: 'rR', wall: 'right', order: 0 },
        { id: 'rT', wall: 'top', order: 0 }],
      entries: [{ id: 'eL', rowId: 'rL', tradeSize: '4' },
        { id: 'eR', rowId: 'rR', tradeSize: '4' },
        { id: 'eT', rowId: 'rT', tradeSize: '2' },
        { id: 'eL2', rowId: 'rL', tradeSize: '2' },
        { id: 'eL3', rowId: 'rL', tradeSize: '1' }],
      connections: [{ id: 'cS', entryIds: ['eL', 'eR'] },
        { id: 'cA', entryIds: ['eL2', 'eT'] },
        { id: 'cU', entryIds: ['eL2', 'eL3'] }],
    };
  }
  const coords = { eL: [0, 100], eR: [300, 100], eT: [150, 0], eL2: [0, 160], eL3: [0, 220] };

  test('DISTINCT PATH FAMILIES: straight=line, angle=one elbow, U=return loop', () => {
    const out = drawHarness(vizState(), { coords });
    // straight: rendered as <line> pair (hit + visible)
    assert.ok(/<line[^>]*x1="22"[^>]*stroke="rgba\(0,0,0,0\)"/.test(out),
      'straight hit line');
    // angle: <path> with ONE rounded quadratic turn (Q), legs as L commands
    const paths = out.match(/<path d="[^"]+"/g);
    assert.ok(paths && paths.length >= 4, 'angle+U each draw hit+visible paths');
    const angleD = paths.find((p) => p.includes(' Q '));
    assert.ok(angleD, 'rounded elbow (quadratic corner) exists');
    assert.strictEqual((angleD.match(/ Q /g) || []).length, 1, 'exactly one turn');
    // U: one smooth cubic return loop, no straight polyline segments at all
    const uD = paths.find((p) => p.includes(' C '));
    assert.ok(uD, 'U cubic return-loop exists');
    assert.ok(!uD.includes(' L '), 'the loop is a curve, not a bracket polyline');
    // type words still label each connection
    for (const word of ['Straight', 'Angle', '>U<']) {
      assert.ok(out.includes(word), word + ' label');
    }
  });

  test('MEASUREMENT OVERLAYS: only from the engine result, separate from paths', () => {
    const state = vizState();
    const engine = require('../src/calc/pullBox');
    const result = engine.calculatePullBox(state);
    assert.strictEqual(result.spacingRequirements.length, 2, 'angle + U spacing');
    // without a result: zero overlays
    let out = drawHarness(state, { coords, result: null });
    assert.ok(!out.includes('pbv2-measure'), 'no overlays before CALCULATE');
    // with the engine result: one dashed measurement per spacing requirement
    out = drawHarness(state, { coords, result });
    const measures = out.match(/class="pbv2-measure"/g) || [];
    assert.strictEqual(measures.length, 2, 'one overlay per engine spacing requirement');
    assert.ok(out.includes('stroke-dasharray="5 4"'), 'dashed = measurement, not route');
    assert.ok(/<g class="pbv2-measure"/.test(out), 'overlay is a grouped dimension marker');
    assert.ok(out.includes('data-spacing-id="spacing:cA"'));
    assert.ok(out.includes('data-spacing-id="spacing:cU"'));
    // labels carry the ENGINE minimums (6x2=12 for both here)
    assert.ok(out.includes('12\u2033 min'), 'engine value labeled, never derived in UI');
    // EDGE ANCHORING: A(2) spacing measures nearest-edge to nearest-edge.
    // U pair eL2 (center 22,182, r 22) / eL3 (center 22,242, r 22): vertical
    // chord, so the dimension must anchor at y 204 and y 220 — offset -18 in
    // x — never at the centers (182/242).
    const uGroup = out.slice(out.indexOf('data-spacing-id="spacing:cU"'));
    assert.ok(uGroup.includes('x1="4" y1="204" x2="4" y2="220"'),
      'dimension line terminates at the raceway-entry edges');
    assert.ok(!/y1="182"/.test(uGroup.slice(0, uGroup.indexOf('</g>'))),
      'no center-anchored measurement remains');
    // overlays use the spacing color and never repaint the connection path
    assert.ok(out.includes('stroke="#b06ae8"'));
  });

  test('COLOR SYSTEM: one map drives SVG and result cards consistently', () => {
    const v2 = htmlV.slice(htmlV.indexOf('PULL BOX V2'), htmlV.indexOf('END PULL BOX V2'));
    const map = v2.match(/var PBV2_COLOR = \{[^}]+\}/)[0];
    assert.ok(map.includes("width: '#4a90d9'") && map.includes("height: '#52c07a'")
      && map.includes("spacing: '#b06ae8'"), 'three dedicated colors');
    assert.strictEqual(new Set(['#4a90d9', '#52c07a', '#b06ae8']).size, 3, 'distinct');
    // every schematic/card usage goes through the map — no duplicated hex
    const dupes = (v2.match(/#4a90d9|#52c07a|#b06ae8/g) || []).length;
    assert.strictEqual(dupes, 3, 'each hex appears once: in PBV2_COLOR only');
    assert.ok(v2.includes('PBV2_COLOR[dimension]'), 'cards use the map by dimension');
    assert.ok(v2.includes('PBV2_COLOR.spacing'), 'overlays use the map');
  });

  test('RESULT→SCHEMATIC LINKING: cards highlight conn / row / spacing targets', () => {
    // requirement cards carry tap-to-highlight wiring by kind
    const card = fnV('pbv2ReqCard');
    assert.ok(card.includes("pbv2UiHighlight('conn','\" + req.connectionId"),
      'straight card targets its connection');
    assert.ok(card.includes("pbv2UiHighlight('row','\" + req.rowId"),
      'row card targets its row');
    const results = fnV('pbv2RenderResults');
    assert.ok(results.includes("pbv2UiHighlight(\\'spacing\\'"),
      'spacing card targets its measurement');
    // highlight toggles and rerenders through the one render path
    const hl = fnV('pbv2UiHighlight');
    assert.ok(hl.includes('pbv2Render()'));
    assert.ok(hl.includes('pbv2Highlight = null'), 'second tap toggles off');
    // draw honors a conn highlight with the dimension color + heavier stroke
    const out = drawHarness(vizState(), { coords,
      highlight: { type: 'conn', id: 'cS', color: '#4a90d9' } });
    assert.ok(/<line[^>]*stroke="#4a90d9" stroke-width="3"/.test(out),
      'highlighted straight path uses the width color at 3px');
    // rows expose identity for row highlighting
    assert.ok(fnV('pbv2Render').includes('data-row-id'), 'row containers identifiable');
  });

  test('REGRESSIONS: many-rows grid, engine-call contract, dev gate all hold', () => {
    const v2 = htmlV.slice(htmlV.indexOf('PULL BOX V2'), htmlV.indexOf('END PULL BOX V2'));
    const gridCss = v2.match(/\.pbv2-grid\{[^}]*\}/)[0];
    assert.ok(gridCss.includes('grid-template-rows:auto auto auto'));
    assert.strictEqual((v2.match(/calculatePullBox\(/g) || []).length, 1,
      'still exactly one engine call site');
    assert.ok(v2.includes('pbv2ShouldOpen'), 'dev gate intact');
    assert.ok(!v2.includes('<canvas'), 'SVG only, no canvas');
    assert.ok(!/animation|@keyframes|glow/.test(v2), 'restrained: no animation');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-8W — second visual-clarity pass: rounded families, dimension
// markers, schematic width/height cues, centralized viz constants
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-8W — visual clarity pass', () => {
  const htmlW = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
  const v2 = htmlW.slice(htmlW.indexOf('PULL BOX V2'), htmlW.indexOf('END PULL BOX V2'));
  function fnW(name) {
    const i = htmlW.indexOf('function ' + name + '(');
    assert.ok(i !== -1, 'missing: ' + name);
    let d = 0; let started = false;
    for (let j = i; j < htmlW.length; j++) {
      if (htmlW[j] === '{') { d++; started = true; } else if (htmlW[j] === '}') {
        d--; if (started && d === 0) return htmlW.slice(i, j + 1);
      }
    }
    throw new Error('unterminated ' + name);
  }

  test('CENTRALIZED VIZ CONSTANTS: radii/depth/offsets live in one map', () => {
    const viz = v2.match(/var PBV2_VIZ = \{[\s\S]*?\};/)[0];
    for (const key of ['elbowRadius', 'uDepth', 'measureOffset', 'measureTick']) {
      assert.ok(viz.includes(key), key + ' centralized');
    }
    const pathFn = fnW('pbv2ConnPathD');
    assert.ok(pathFn.includes('PBV2_VIZ.elbowRadius') && pathFn.includes('PBV2_VIZ.uDepth'),
      'paths read the constants, no scattered magic numbers');
  });

  test('ROUNDED GRAMMAR: angle = L-Q-L with bounded radius; U = pure cubic', () => {
    const pathFn = fnW('pbv2ConnPathD');
    assert.ok(pathFn.includes("' Q '"), 'angle uses a quadratic rounded corner');
    assert.ok(pathFn.includes('Math.min(PBV2_VIZ.elbowRadius, len1 / 2, len2 / 2)'),
      'corner radius bounded by leg lengths (dense layouts stay clean)');
    assert.ok(pathFn.includes("' C '"), 'U uses one smooth cubic loop');
    // the old hard-polyline U (three L segments) is gone
    assert.ok(!/L ' \+ \(x2 \+ dx\)/.test(pathFn), 'bracket polyline removed');
  });

  test('DIMENSION MARKERS: grouped overlay with end ticks, engine-sourced only', () => {
    const draw = fnW('pbv2DrawConnections');
    assert.ok(draw.includes('<g class="pbv2-measure"'), 'grouped marker element');
    assert.ok(draw.includes('PBV2_VIZ.measureTick'), 'end ticks from the constant');
    assert.ok(draw.includes('pbv2LastResult.spacingRequirements'),
      'overlays sourced from the engine result object only');
    assert.ok(!/6 \*|\* 6(?!\d)/.test(draw.replace(/\/\/[^\n]*/g, '')),
      'no spacing arithmetic anywhere in the drawer');
    // route stroke is solid; measurement stroke is dashed + thinner default
    assert.ok(draw.includes("shl ? '3' : '1.5'"),
      'measurement visibly secondary to routes (1.5px vs 2px)');
  });

  test('SCHEMATIC WIDTH/HEIGHT CUES: wall names + legend use engine mapping', () => {
    const render = fnW('pbv2Render');
    assert.ok(render.includes('EC.pullBox.WALL_DIMENSION[wall]'),
      'the ENGINE says which wall drives which dimension');
    assert.ok(render.includes('PBV2_COLOR[laneDim]'), 'wall names wear their dimension color');
    assert.ok(render.includes('WIDTH</span>') && render.includes('HEIGHT</span>')
      && render.includes('SPACING</span>'), 'center legend teaches the mapping');
    // color discipline: the three hexes still appear exactly once (in the map)
    const dupes = (v2.match(/#4a90d9|#52c07a|#b06ae8/g) || []).length;
    assert.strictEqual(dupes, 3, 'no duplicated hex literals crept in');
  });

  test('DEPTH CUES stay CSS-light: recessed interior, no 3D machinery', () => {
    const centerCss = v2.match(/\.pbv2-center\{[^}]*\}/)[0];
    assert.ok(centerCss.includes('inset'), 'recessed interior volume');
    assert.ok(!/transform|perspective|rotate/.test(centerCss), 'not 3D');
    const laneCss = v2.match(/\.pbv2-lane\{[^}]*\}/)[0];
    assert.ok(laneCss.includes('inset 0 1px 0'), 'subtle rim light on walls');
    assert.ok(!v2.includes('<canvas'), 'still SVG/DOM only');
  });

  test('BEHAVIOR HOLDS: highlight, codeRef isolation, invalidation, one call, gate', () => {
    // highlight wiring unchanged
    assert.ok(fnW('pbv2ReqCard').includes('pbv2UiHighlight'));
    assert.ok(fnW('pbv2UiHighlight').includes('pbv2Highlight = null'));
    // codeRef still stops propagation so it never collides with card highlight
    assert.ok(fnW('ecRenderCodeRef').includes('event.stopPropagation();ecOpenCodeRef'));
    // overlays die with invalidation because they read pbv2LastResult
    assert.ok(fnW('pbv2InvalidateResult').includes('pbv2LastResult = null'));
    // one engine call site, dev gate, grid regressions
    assert.strictEqual((v2.match(/calculatePullBox\(/g) || []).length, 1);
    assert.ok(v2.includes('pbv2ShouldOpen'));
    assert.ok(v2.match(/\.pbv2-grid\{[^}]*\}/)[0].includes('grid-template-rows:auto auto auto'));
  });
});
