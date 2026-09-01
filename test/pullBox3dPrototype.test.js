'use strict';
/**
 * PBV2-10B — interactive 3D editor prototype (DEV-only, disposable).
 *
 * Pins the interaction model and the prototype's isolation from the working
 * PBV2 editor. Deliberately does NOT test calculations: the prototype is
 * calculation-free by design, and the real gate is the physical iPhone.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
const P3D = html.slice(html.indexOf('INTERACTIVE 3D PROTOTYPE (PBV2-10B)'),
  html.indexOf('END PULL BOX V2 3D PROTOTYPE'));

function fn3d(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i !== -1, 'missing: ' + name);
  let d = 0; let started = false;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') { d++; started = true; } else if (html[j] === '}') {
      d--; if (started && d === 0) return html.slice(i, j + 1);
    }
  }
  throw new Error('unterminated ' + name);
}

/** Run the shipped pure state + render functions. */
function api3d() {
  const consts = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS',
    'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL']
    .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
  const fns = ['pbv23dHub', 'pbv23dInward', 'pbv23dEmptyState', 'pbv23dFindEntry',
    'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dSetSize',
    'pbv23dSetPosition', 'pbv23dSetWall', 'pbv23dClassify', 'pbv23dAddConnection',
    'pbv23dDeleteConnection', 'pbv23dRoutePath', 'pbv23dBuildFixture',
    'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConns', 'pbv23dEntryColor', 'pbv23dHitRadius',
    'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dAddRowOnWall',
    'pbv23dEnsureRow', 'pbv23dSetEntryRow', 'pbv23dDeleteRowIfEmpty', 'pbv23dRowDepth',
    'pbv23dRowIdFor', 'pbv23dEngineRequest', 'pbv23dPresent',
    'pbv23dRenderSvg', 'pbv23dDevHost', 'pbv23dShouldOpen'].map(fn3d).join('\n');
  const out = {};
  // eslint-disable-next-line no-new-func
  new Function('exports',
    'var pbv23dSeq = 0;\n'
    + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
    + consts + fns + `
    exports.GEO = PBV23D_GEO; exports.SIZES = PBV23D_SIZES; exports.WALLS = PBV23D_WALLS;
    exports.empty = pbv23dEmptyState; exports.build = pbv23dBuildFixture;
    exports.add = pbv23dAddEntry; exports.del = pbv23dDeleteEntry;
    exports.setSize = pbv23dSetSize; exports.setPos = pbv23dSetPosition;
    exports.setWall = pbv23dSetWall; exports.classify = pbv23dClassify;
    exports.connect = pbv23dAddConnection; exports.disconnect = pbv23dDeleteConnection;
    exports.find = pbv23dFindEntry; exports.hub = pbv23dHub;
    exports.routePath = pbv23dRoutePath; exports.svg = pbv23dRenderSvg;
    exports.nextId = pbv23dNextId;
    exports.devHost = pbv23dDevHost; exports.shouldOpen = pbv23dShouldOpen;
    exports.PALETTE = PBV23D_CONN_COLORS; exports.NEUTRAL = PBV23D_NEUTRAL;
    exports.connColor = pbv23dConnColor; exports.entryColor = pbv23dEntryColor;
    exports.hitRadius = pbv23dHitRadius;
    exports.request = pbv23dEngineRequest; exports.present = pbv23dPresent;
    exports.rowIdFor = pbv23dRowIdFor;
    exports.rowsFor = pbv23dRowsFor; exports.rowById = pbv23dRowById;
    exports.rowIndex = pbv23dRowIndex; exports.addRow = pbv23dAddRowOnWall;
    exports.ensureRow = pbv23dEnsureRow; exports.setRow = pbv23dSetEntryRow;
    exports.dropRow = pbv23dDeleteRowIfEmpty; exports.rowDepth = pbv23dRowDepth;
    exports.connNumber = pbv23dConnNumber;`)(out);
  return out;
}

describe('PBV2-10B — isolation', () => {
  test('working PBV2 editor at ?pbv2=1 is untouched and complete', () => {
    assert.ok(html.includes('id="pbv2-overlay"'));
    for (const marker of ['function pbv2ShouldOpen', 'function pbv2Calculate',
      'function pbv2RenderResults', 'function pbv2AxisBlock', 'ecRenderCodeRef',
      'EC.pullBox.calculatePullBox', 'function pbv2DrawConnections']) {
      assert.ok(html.includes(marker), 'working PBV2 lost: ' + marker);
    }
    assert.ok(html.includes('id="sub-pullbox"') && /function pbUpdate/.test(html));
    assert.ok(!/openTool\('pullbox/.test(html), 'no production route');
  });

  test('dev gate: ?pbv2=3d on local hosts only; production blocked; ?pbv2=1 separate', () => {
    const api = api3d();
    for (const host of ['empirecode.app', 'www.empirecode.app', 'apphub-us.github.io',
      '172.32.0.1', '11.0.0.1']) {
      assert.strictEqual(api.devHost(host), false, host);
      assert.strictEqual(api.shouldOpen({ hostname: host, search: '?pbv2=3d', hash: '' }),
        false, host + ' must never open the prototype');
    }
    for (const host of ['localhost', '127.0.0.1', '192.168.1.23', '172.16.0.2']) {
      assert.strictEqual(api.shouldOpen({ hostname: host, search: '?pbv2=3d', hash: '' }), true);
      assert.strictEqual(api.shouldOpen({ hostname: host, search: '?pbv2=1', hash: '' }), false,
        'the editor flow never opens the prototype');
    }
  });

  test('engine access is confined to the adapter; everything else stays out', () => {
    // PBV2-11 supersedes the 10B "no engine access" ban: the prototype now
    // drives the real engine, but only through one adapter call site.
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1,
      'exactly one engine call site');
    assert.ok(!code.includes('validatePullBoxRequest'),
      'calculatePullBox owns validation — no double call');
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', '<canvas',
      'WebGL', 'THREE.', 'getContext(']) {
      assert.ok(!code.includes(banned), 'forbidden in prototype: ' + banned);
    }
    assert.ok(fn3d('pbv23dShouldOpen').includes('pbv23dDevHost'), 'self-contained gate');
    // every prototype symbol is namespaced
    const declared = (code.match(/function (\w+)\(/g) || []).map((m) => m.slice(9, -1));
    for (const name of declared) {
      assert.ok(/^pbv23d/.test(name), 'un-namespaced global: ' + name);
    }
  });
});

describe('PBV2-10B — editing raceways on the box', () => {
  const api = api3d();

  test('tapping a wall adds exactly one raceway on that wall', () => {
    const s = api.empty();
    const e = api.add(s, 'left', '2', api.nextId('e'));
    assert.strictEqual(s.entries.length, 1);
    assert.strictEqual(e.wall, 'left');
    assert.strictEqual(e.size, '2');
    assert.ok(e.v > 0 && e.v < 1, 'positioned along the wall');
    assert.deepStrictEqual(Object.keys(e).sort(), ['id', 'rowId', 'size', 'v', 'wall'],
      'PBV2-12: raceways now carry an explicit row reference');
    api.add(s, 'top', '3', api.nextId('e'));
    assert.strictEqual(s.entries.length, 2);
    assert.strictEqual(s.entries.filter((x) => x.wall === 'top').length, 1);
  });

  test('successive adds on one wall spread out instead of stacking', () => {
    const s = api.empty();
    const positions = [];
    for (let i = 0; i < 4; i++) {
      positions.push(api.add(s, 'left', '2', api.nextId('e')).v);
    }
    assert.strictEqual(new Set(positions).size, 4, 'no two raceways share a position');
  });

  test('delete removes the raceway and cascades its pulls', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '2', api.nextId('e'));
    const b = api.add(s, 'top', '2', api.nextId('e'));
    const c = api.add(s, 'right', '3', api.nextId('e'));
    api.connect(s, a.id, b.id, api.nextId('c'));
    api.connect(s, b.id, c.id, api.nextId('c'));
    api.del(s, b.id);
    assert.strictEqual(s.entries.length, 2);
    assert.deepStrictEqual(s.connections, [], 'no orphan pulls survive');
    assert.ok(!api.find(s, b.id));
  });

  test('size and position edits keep the same raceway identity', () => {
    const s = api.empty();
    const e = api.add(s, 'bottom', '2', api.nextId('e'));
    assert.strictEqual(api.setSize(s, e.id, '4'), true);
    assert.strictEqual(api.setPos(s, e.id, 0.8), true);
    assert.strictEqual(s.entries.length, 1);
    assert.strictEqual(s.entries[0].id, e.id, 'no delete/recreate');
    assert.strictEqual(s.entries[0].size, '4');
    assert.strictEqual(s.entries[0].v, 0.8);
    api.setPos(s, e.id, 5);
    assert.ok(s.entries[0].v <= 0.94, 'position clamped inside the wall');
    api.setPos(s, e.id, -3);
    assert.ok(s.entries[0].v >= 0.06);
  });

  test('changing wall moves the raceway and preserves its pulls', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '3', api.nextId('e'));
    const b = api.add(s, 'right', '3', api.nextId('e'));
    api.connect(s, a.id, b.id, api.nextId('c'));
    assert.strictEqual(api.classify(a.wall, b.wall), 'STRAIGHT');
    assert.strictEqual(api.setWall(s, a.id, 'top'), true);
    assert.strictEqual(s.entries.length, 2, 'moved, not duplicated');
    assert.strictEqual(api.find(s, a.id).wall, 'top');
    assert.strictEqual(s.connections.length, 1, 'pull survives the move');
    // and the relationship re-reads from current walls
    assert.strictEqual(api.classify(api.find(s, a.id).wall, b.wall), 'ANGLE');
    assert.strictEqual(api.setWall(s, a.id, 'back'), false, 'only the four walls');
  });

  test('the four trade-size/wall option sets come from the prototype, not the engine', () => {
    assert.strictEqual(api.SIZES.length, 12);
    assert.deepStrictEqual(api.WALLS.slice().sort(), ['bottom', 'left', 'right', 'top']);
    assert.ok(!fn3d('pbv23dBuildFixture').includes('EC.'), 'no engine reads');
  });
});

describe('PBV2-10B — connecting raceways', () => {
  const api = api3d();

  test('classification: opposite walls straight, adjacent angle, same wall U', () => {
    assert.strictEqual(api.classify('left', 'right'), 'STRAIGHT');
    assert.strictEqual(api.classify('right', 'left'), 'STRAIGHT');
    assert.strictEqual(api.classify('top', 'bottom'), 'STRAIGHT');
    assert.strictEqual(api.classify('bottom', 'top'), 'STRAIGHT');
    for (const [a, b] of [['left', 'top'], ['top', 'right'], ['right', 'bottom'],
      ['bottom', 'left']]) {
      assert.strictEqual(api.classify(a, b), 'ANGLE', a + '/' + b);
    }
    for (const w of api.WALLS) assert.strictEqual(api.classify(w, w), 'U', w);
  });

  test('connect guards: self and duplicate rejected, unknown rejected', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '2', api.nextId('e'));
    const b = api.add(s, 'top', '2', api.nextId('e'));
    assert.strictEqual(api.connect(s, a.id, a.id, api.nextId('c')).reason, 'SELF');
    assert.strictEqual(api.connect(s, a.id, 'ghost', api.nextId('c')).reason, 'UNKNOWN');
    assert.strictEqual(api.connect(s, a.id, b.id, api.nextId('c')).ok, true);
    assert.strictEqual(api.connect(s, b.id, a.id, api.nextId('c')).reason, 'DUPLICATE',
      'undirected');
    assert.strictEqual(s.connections.length, 1);
  });

  test('a raceway may take part in several pulls', () => {
    const s = api.empty();
    const hub = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const r = api.add(s, 'right', '2', api.nextId('e'));
    api.connect(s, hub.id, t.id, api.nextId('c'));
    api.connect(s, hub.id, r.id, api.nextId('c'));
    assert.strictEqual(s.connections.length, 2);
    const svg = api.svg(s, {});
    assert.strictEqual((svg.match(/class="p3d-route"/g) || []).length, 2);
  });
});

describe('PBV2-10B — drawing and interaction surfaces', () => {
  const api = api3d();

  test('the enclosure keeps the approved visual language and is the tap surface', () => {
    const s = api.build('standard');
    const svg = api.svg(s, {});
    assert.strictEqual((svg.match(/class="p3d-wall"/g) || []).length, 4);
    assert.strictEqual((svg.match(/onclick="pbv23dTapWall/g) || []).length, 4,
      'every wall surface adds a raceway directly');
    assert.strictEqual((svg.match(/class="p3d-back"/g) || []).length, 1, 'interior plane');
    assert.ok(svg.includes('rx="3" fill="#1e1e1e"'), 'rim = visible wall thickness');
    // PBV2-12.1: wall taps no longer create raceways, so the "+" affordances
    // appear only while ADD mode is active (see the add-mode test below)
    assert.strictEqual((svg.match(/class="p3d-add"/g) || []).length, 0);
    assert.strictEqual((api.svg(s, { addMode: true }).match(/class="p3d-add"/g) || []).length, 4);
    assert.ok(svg.includes('NOT TO SCALE'));
    for (const name of ['TOP', 'BOTTOM', 'LEFT', 'RIGHT']) {
      assert.ok(svg.includes('>' + name + '</text>'));
    }
  });

  test('the wall opening is the primary target, larger than the drawn hub', () => {
    const s = api.build('standard');
    const svg = api.svg(s, {});
    const hits = svg.match(/class="p3d-hit"[^>]*r="([\d.]+)"/g) || [];
    assert.strictEqual(hits.length, s.entries.length, 'one opening target per raceway');
    for (const h of hits) {
      const r = Number(h.match(/r="([\d.]+)"/)[1]);
      assert.ok(r >= 11, 'generous touch radius');
      assert.ok(r > 6.5, 'touch target is larger than the drawn opening');
    }
    assert.ok(/rx="4\.5" ry="6\.5"|rx="6\.5" ry="4\.5"/.test(svg),
      'the drawn opening stays small and foreshortened');
    assert.ok(svg.includes('onclick="pbv23dTapEntry('), 'targets are the tap surface');
  });

  test('selection and connect-source states are visible without permanent noise', () => {
    const s = api.build('standard');
    const id = s.entries[0].id;
    const plain = api.svg(s, {});
    assert.ok(!plain.includes('p3d-selring'), 'no ring when nothing is selected');
    const selected = api.svg(s, { selected: id });
    assert.strictEqual((selected.match(/class="p3d-selring"/g) || []).length, 1);
    const connecting = api.svg(s, { connectFrom: id });
    assert.ok(connecting.includes('#ffc700'), 'connect source uses the app accent');
  });

  test('routes are schematic; colour marks the relationship, never the type', () => {
    // superseded by PBV2-10B.1: routes now carry a per-relationship colour.
    // What must still hold is that the colour is NOT chosen by pull type.
    const s = api.build('dense');
    const svg = api.svg(s, {});
    const routes = svg.slice(svg.indexOf('class="p3d-routes"'),
      svg.indexOf('class="p3d-raceways"'));
    for (const t of ['STRAIGHT', 'ANGLE', 'U']) {
      assert.ok(routes.includes('data-type="' + t + '"'), t + ' present in dense fixture');
    }
    const byType = {};
    for (const m of routes.match(/data-type="(\w+)" stroke="(#[0-9a-f]{6})"/g) || []) {
      const [, type, colour] = m.match(/data-type="(\w+)" stroke="(#[0-9a-f]{6})"/);
      byType[type] = colour;
    }
    assert.strictEqual(new Set(Object.values(byType)).size, Object.keys(byType).length,
      'three different pull types happen to get three different colours here');
    for (const c of Object.values(byType)) {
      assert.ok(api.PALETTE.includes(c), 'colours come from the relationship palette');
    }
  });

  test('U still reads IN, turn around INSIDE, OUT', () => {
    const G = api.GEO;
    const a = api.hub('bottom', 0.3, G.hubDepth);
    const b = api.hub('bottom', 0.7, G.hubDepth);
    const d = api.routePath('U', 'bottom', a, 'bottom', b);
    assert.ok(d.includes(' A '), '180-degree return');
    const parts = d.split(/\s+/);
    const legEndY = Number(parts[5]);
    assert.ok(legEndY < Number(parts[2]) - 40, 'legs run deep into the box');
    const radius = Number(d.slice(d.indexOf(' A ') + 3).trim().split(/\s+/)[0]);
    const apexY = legEndY - radius;
    assert.ok(apexY > G.back.y1 && apexY < G.back.y2, 'turnaround inside the enclosure');
    assert.strictEqual(Number(parts[parts.length - 1]), Number(parts[2]), 'same wall');
  });

  test('STRAIGHT reads as a through-pull, not a bend', () => {
    // aligned entries: one straight segment, nothing else
    const straight = api.routePath('STRAIGHT', 'left', { x: 52, y: 100 },
      'right', { x: 244, y: 100 });
    assert.strictEqual(straight, 'M 52 100 L 244 100');
    // offset entries: two LONG collinear runs plus a SHORT step near the
    // middle — the old long curve read like an angle pull
    const offset = api.routePath('STRAIGHT', 'left', { x: 52, y: 80 },
      'right', { x: 244, y: 140 });
    assert.ok(!offset.includes(' C ') && !offset.includes(' Q '),
      'no sweeping curve any more');
    const seg = offset.match(/-?\d+(\.\d+)?/g).map(Number);
    assert.strictEqual(seg[1], seg[3], 'first run is level with its entry');
    assert.strictEqual(seg[5], seg[7], 'last run is level with its entry');
    const stepWidth = Math.abs(seg[4] - seg[2]);
    const totalRun = Math.abs(seg[6] - seg[0]);
    assert.ok(stepWidth < totalRun * 0.2,
      'the offset step is short relative to the through-run');
  });
});

describe('PBV2-10B — density, fixtures and honesty', () => {
  const api = api3d();

  test('dense fixture keeps all 16 raceways reachable', () => {
    const s = api.build('dense');
    assert.strictEqual(s.entries.length, 16);
    const byWall = (w) => s.entries.filter((e) => e.wall === w).length;
    assert.strictEqual(byWall('left'), 6);
    assert.strictEqual(byWall('right'), 3);
    assert.strictEqual(byWall('top'), 3);
    assert.strictEqual(byWall('bottom'), 4);
    const svg = api.svg(s, {});
    assert.strictEqual((svg.match(/class="p3d-hub"/g) || []).length, 16, 'none hidden');
    assert.strictEqual((svg.match(/class="p3d-hit"/g) || []).length, 16, 'all tappable');
  });

  test('labels go contextual when the box gets busy', () => {
    const dense = api.svg(api.build('dense'), {});
    assert.strictEqual((dense.match(/&#8243;<\/text>/g) || []).length, 0,
      'no permanent size labels in a dense box');
    const withSel = api.svg(api.build('dense'), { selected: api.build('dense').entries[0].id });
    const standardSvg = api.svg(api.build('standard'), {});
    const raceways = standardSvg.slice(standardSvg.indexOf('class="p3d-raceways"'),
      standardSvg.indexOf('class="p3d-dims"'));
    assert.strictEqual((raceways.match(/&#8243;<\/text>/g) || []).length, 4,
      'small boxes still label every raceway');
    assert.ok(withSel.length > 0);
  });

  test('three fixtures, all editable starting points', () => {
    assert.strictEqual(api.build('empty').entries.length, 0);
    const std = api.build('standard');
    assert.strictEqual(std.entries.length, 4);
    assert.strictEqual(std.connections.length, 2, 'angle + U ready to inspect');
    assert.strictEqual(api.build('dense').connections.length, 3);
    // the standard preset can be edited immediately
    const e = api.add(std, 'right', '4', api.nextId('e'));
    assert.strictEqual(std.entries.length, 5);
    assert.ok(api.find(std, e.id));
  });

  test('no dimensions are drawn until the engine has actually run', () => {
    // superseded by PBV2-11: static fixture values are gone entirely. The
    // dimension layer renders only from an engine-derived presentation.
    const s = api.build('standard');
    assert.ok(!('showDims' in s), 'the static fixture flag no longer exists');
    const before = api.svg(s, {});
    assert.ok(!before.includes('p3d-dim-width'), 'nothing drawn before CALCULATE');
    assert.ok(!before.includes('NOT FULLY DETERMINED'));
  });

  test('single viewBox, no horizontal overflow assumptions', () => {
    const svg = api.svg(api.build('dense'), {});
    assert.strictEqual((svg.match(/<svg/g) || []).length, 1);
    assert.ok(svg.includes('viewBox="0 0 340 300"'), 'fixed viewBox scales to the phone');
    const xs = (svg.match(/ (?:x|cx|x1|x2)="(-?\d+(?:\.\d+)?)"/g) || [])
      .map((m) => Number(m.match(/-?\d+(?:\.\d+)?/)[0]));
    assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 340,
      'all geometry stays inside the viewBox');
    assert.ok(P3D.includes('max-width:430px'), 'stage capped for phone widths');
    assert.ok(P3D.includes('user-select:none'), 'no accidental text selection');
    assert.ok(P3D.includes('touch-action:manipulation'), 'no double-tap zoom on the stage');
    assert.ok(P3D.includes('env(safe-area-inset-bottom)'), 'sheet clears the Safari bar');
  });
});

describe('PBV2-10B.1 — interaction polish', () => {
  const api = api3d();

  test('EDITOR: opening it hands the screen to the box, not the sheet', () => {
    // the sheet is capped and the competing chrome steps aside while editing
    assert.ok(/#pbv2-3d-sheet\{[^}]*max-height:40vh/.test(P3D), 'sheet capped at 40vh');
    assert.ok(/p3d-editing \.p3d-fixtures,[\s\S]{0,80}p3d-editing \.p3d-res\{display:none\}/.test(P3D),
      'fixture switch and results hide while editing');
    assert.ok(/p3d-editing\{padding-bottom:42vh\}/.test(P3D),
      'the box can scroll clear of the sheet');
    assert.ok(fn3d('pbv23dOpenSheet').includes("classList.add('p3d-editing')"));
    assert.ok(fn3d('pbv23dOpenSheet').includes('scrollIntoView'),
      'the enclosure is brought into view when the editor opens');
    assert.ok(fn3d('pbv23dCloseSheet').includes("classList.remove('p3d-editing')"));
    // live editing: size/wall/position all re-render the box behind the sheet
    for (const f of ['pbv23dPickSize', 'pbv23dPickWall', 'pbv23dPickPosition']) {
      assert.ok(fn3d(f).includes('pbv23dRender()'), f + ' updates the box live');
    }
    assert.ok(P3D.includes('p3d-strip'), 'options scroll horizontally to stay short');
  });

  test('HIT TESTING: opening and stub both resolve to the same raceway', () => {
    const s = api.build('standard');
    const svg = api.svg(s, {});
    for (const e of s.entries) {
      const hub = new RegExp('class="p3d-hit" data-entry="' + e.id + '"[^>]*onclick="pbv23dTapEntry\\(\'' + e.id + '\'\\)');
      const stub = new RegExp('class="p3d-stubhit" data-entry="' + e.id + '"[^>]*onclick="pbv23dTapEntry\\(\'' + e.id + '\'\\)');
      assert.ok(hub.test(svg), 'opening target for ' + e.id);
      assert.ok(stub.test(svg), 'stub target for ' + e.id);
    }
    // all targets live in one layer above the artwork; the artwork itself is
    // inert, so routes and labels can never intercept a tap
    assert.ok(svg.indexOf('class="p3d-hits"') > svg.indexOf('class="p3d-raceways"'),
      'touch layer painted last');
    assert.ok(/<g class="p3d-raceways" style="pointer-events:none">/.test(svg),
      'artwork does not steal taps');
    assert.ok(svg.includes('stroke-opacity="0"'), 'stub targets are invisible');
  });

  test('HIT TESTING: radii shrink before neighbours overlap (deterministic)', () => {
    const dense = api.build('dense');
    const svg = api.svg(dense, {});
    const G = api.GEO;
    const hubs = {};
    // depth now comes from the raceway's row, so the test must use it too
    for (const e of dense.entries) {
      hubs[e.id] = api.hub(e.wall, e.v, api.rowDepth(dense, e.rowId));
    }
    const radii = {};
    for (const m of svg.match(/class="p3d-hit" data-entry="([^"]+)"[^>]*r="([\d.]+)"/g)) {
      const [, id, r] = m.match(/data-entry="([^"]+)"[^>]*r="([\d.]+)"/);
      radii[id] = Number(r);
    }
    assert.strictEqual(Object.keys(radii).length, 16, 'every raceway is tappable');
    // no two touch circles may overlap: r(a) + r(b) <= distance
    const ids = Object.keys(radii);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = hubs[ids[i]]; const b = hubs[ids[j]];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(radii[ids[i]] + radii[ids[j]] <= d + 0.001,
          'overlapping touch targets: ' + ids[i] + '/' + ids[j]);
      }
    }
    // a lone raceway still gets the full radius
    const solo = api.empty();
    api.add(solo, 'left', '2', api.nextId('e'));
    const r = Number(api.svg(solo, {}).match(/class="p3d-hit"[^>]*r="([\d.]+)"/)[1]);
    assert.strictEqual(r, 22, 'isolated hub keeps a 44px-wide target');
  });

  test('SELECTION: hub, stub and label all confirm the active raceway', () => {
    const s = api.build('standard');
    const id = s.entries[0].id;
    const plain = api.svg(s, {});
    const sel = api.svg(s, { selected: id });
    assert.strictEqual((sel.match(/class="p3d-selring"/g) || []).length, 1);
    assert.ok(sel.includes('stroke="#ffffff" stroke-width="6"'), 'stub highlights too');
    assert.ok(/class="p3d-hub" data-entry="[^"]+"[^>]*stroke="#ffffff" stroke-width="2\.5"/.test(sel),
      'hub highlights');
    assert.ok(!plain.includes('#ffffff'), 'nothing shouts when nothing is selected');
    const connecting = api.svg(s, { connectFrom: id });
    assert.ok(connecting.includes('#ffc700'), 'connect source uses the app accent');
  });

  test('COLOUR: identity per relationship — both ends and the route agree', () => {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const r = api.add(s, 'right', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const b = api.add(s, 'bottom', '3', api.nextId('e'));
    const c1 = api.nextId('c'); const c2 = api.nextId('c');
    api.connect(s, l.id, r.id, c1);   // STRAIGHT
    api.connect(s, t.id, b.id, c2);   // also STRAIGHT — same type, must differ
    const col1 = api.connColor(s, c1);
    const col2 = api.connColor(s, c2);
    assert.notStrictEqual(col1, col2, 'two pulls of the SAME type get different colours');
    assert.strictEqual(api.entryColor(s, l.id), col1);
    assert.strictEqual(api.entryColor(s, r.id), col1, 'both ends share the pull colour');
    assert.strictEqual(api.entryColor(s, t.id), col2);
    const svg = api.svg(s, {});
    const routeColors = (svg.match(/class="p3d-route"[^>]*stroke="(#[0-9a-f]{6})"/g) || [])
      .map((m) => m.match(/stroke="(#[0-9a-f]{6})"/)[1]);
    assert.deepStrictEqual(routeColors, [col1, col2], 'routes carry their own identity');
  });

  test('COLOUR: assignment ignores STRAIGHT / ANGLE / U entirely', () => {
    // same palette slot regardless of the pull type occupying it
    const straightFirst = api.empty();
    let a = api.add(straightFirst, 'left', '2', api.nextId('e'));
    let b = api.add(straightFirst, 'right', '2', api.nextId('e'));
    const cs = api.nextId('c');
    api.connect(straightFirst, a.id, b.id, cs);

    const angleFirst = api.empty();
    a = api.add(angleFirst, 'left', '2', api.nextId('e'));
    b = api.add(angleFirst, 'top', '2', api.nextId('e'));
    const ca = api.nextId('c');
    api.connect(angleFirst, a.id, b.id, ca);

    assert.strictEqual(api.connColor(straightFirst, cs), api.connColor(angleFirst, ca),
      'a straight and an angle in the same slot share a colour — type is irrelevant');
    assert.strictEqual(api.connColor(straightFirst, cs), api.PALETTE[0]);
    // and the palette is muted, not a neon rainbow
    assert.ok(api.PALETTE.length >= 4 && api.PALETTE.length <= 8);
    for (const c of api.PALETTE) {
      assert.ok(/^#[0-9a-f]{6}$/.test(c));
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      assert.ok(Math.max(r, g, bl) - Math.min(r, g, bl) < 130, 'muted, not saturated: ' + c);
    }
  });

  test('COLOUR: unconnected raceways stay neutral; shared raceways stay honest', () => {
    const s = api.empty();
    const lone = api.add(s, 'left', '2', api.nextId('e'));
    assert.strictEqual(api.entryColor(s, lone.id), api.NEUTRAL);
    let svg = api.svg(s, {});
    assert.ok(new RegExp('class="p3d-hub"[^>]*stroke="' + api.NEUTRAL + '"').test(svg));

    // one raceway in two pulls: no misleading single colour, a ring cue instead
    const hub = api.add(s, 'top', '2', api.nextId('e'));
    const r2 = api.add(s, 'right', '2', api.nextId('e'));
    api.connect(s, hub.id, lone.id, api.nextId('c'));
    api.connect(s, hub.id, r2.id, api.nextId('c'));
    assert.strictEqual(api.entryColor(s, hub.id), api.NEUTRAL,
      'a shared raceway never claims one pull colour');
    svg = api.svg(s, {});
    assert.strictEqual((svg.match(/class="p3d-multiring"/g) || []).length, 1,
      'the shared raceway is flagged instead');
    assert.strictEqual((svg.match(/class="p3d-route"/g) || []).length, 2,
      'both pulls still render');
  });

  test('no geometry regression: straight, angle and U unchanged', () => {
    assert.strictEqual(api.routePath('STRAIGHT', 'left', { x: 52, y: 100 },
      'right', { x: 244, y: 100 }), 'M 52 100 L 244 100');
    const offset = api.routePath('STRAIGHT', 'left', { x: 52, y: 80 },
      'right', { x: 244, y: 140 });
    assert.ok(!offset.includes(' C ') && !offset.includes(' Q '), 'no sweeping curve');
    const G = api.GEO;
    const u = api.routePath('U', 'bottom', api.hub('bottom', 0.3, G.hubDepth),
      'bottom', api.hub('bottom', 0.7, G.hubDepth));
    assert.ok(u.includes(' A '), 'U hairpin intact');
    const angle = api.routePath('ANGLE', 'left', api.hub('left', 0.5, G.hubDepth),
      'top', api.hub('top', 0.5, G.hubDepth));
    assert.strictEqual((angle.match(/ Q /g) || []).length, 1, 'angle turn intact');
    // classification rules untouched
    assert.strictEqual(api.classify('left', 'right'), 'STRAIGHT');
    assert.strictEqual(api.classify('left', 'top'), 'ANGLE');
    assert.strictEqual(api.classify('bottom', 'bottom'), 'U');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-11 — controlled engine integration
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-11 — adapter contract', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  function sample() {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const b1 = api.add(s, 'bottom', '3', api.nextId('e'));
    const b2 = api.add(s, 'bottom', '3', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    api.connect(s, b1.id, b2.id, api.nextId('c'));
    return { s, l, t, b1, b2 };
  }

  test('produces canonical engine input the frozen contract accepts', () => {
    const { s } = sample();
    const req = api.request(s);
    assert.deepStrictEqual(Object.keys(req).sort(), ['connections', 'entries', 'rows']);
    for (const r of req.rows) {
      assert.deepStrictEqual(Object.keys(r).sort(), ['id', 'order', 'wall']);
      assert.strictEqual(r.order, 0);
    }
    for (const e of req.entries) {
      assert.deepStrictEqual(Object.keys(e).sort(), ['id', 'rowId', 'tradeSize']);
    }
    for (const c of req.connections) {
      assert.deepStrictEqual(Object.keys(c).sort(), ['entryIds', 'id']);
      assert.strictEqual(c.entryIds.length, 2);
    }
    assert.strictEqual(engine.validatePullBoxRequest(req).ok, true,
      'the real engine validates the adapter output');
  });

  test('adapter is DOM-free and does no arithmetic or classification', () => {
    for (const name of ['pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dRowIdFor']) {
      const body = fn3d(name);
      assert.ok(!/document|window|innerHTML|getElementById|querySelector/.test(body),
        name + ' must not touch the DOM');
      assert.ok(!/[*]\s*6|6\s*[*]|[*]\s*8|8\s*[*]|Math\.max\(|Math\.min\(/.test(body),
        name + ' must contain no NEC arithmetic');
      // PBV2-12.3.3: the adapter may READ the engine's own kind labels to
      // index requirements; what stays banned is deriving a pull type itself
      assert.ok(!/classifyConnection/.test(body),
        name + ' must not classify pulls');
      assert.ok(!/\.wall\s*===|opposite|adjacent/.test(body),
        name + ' must not infer type from geometry');
    }
  });

  test('wall mapping, raceway ids and trade sizes normalise correctly', () => {
    const s = api.empty();
    const made = {};
    for (const w of ['top', 'right', 'bottom', 'left']) {
      made[w] = api.add(s, w, '4', api.nextId('e'));
    }
    const req = api.request(s);
    assert.strictEqual(req.rows.length, 4, 'one canonical row per occupied wall');
    assert.deepStrictEqual(req.rows.map((r) => r.wall).sort(),
      ['bottom', 'left', 'right', 'top']);
    for (const w of ['top', 'right', 'bottom', 'left']) {
      const entry = req.entries.find((e) => e.id === made[w].id);
      assert.ok(entry, 'raceway id survives normalisation unchanged');
      const row = api.rowById(s, entry.rowId);
      assert.strictEqual(row.wall, w, w + ' maps to a row on its own wall');
      assert.strictEqual(entry.tradeSize, '4');
    }
    // sizes are the engine's own vocabulary, not a private list
    for (const size of api.SIZES) {
      assert.ok(engine.TRADE_SIZE_KEYS.includes(size), 'unknown trade size: ' + size);
    }
  });

  test('same state always produces identical engine input', () => {
    const { s } = sample();
    const a = JSON.stringify(api.request(s));
    const b = JSON.stringify(api.request(s));
    assert.strictEqual(a, b);
    // input order in the UI state must not change the canonical request
    const shuffled = { rows: s.rows.slice().reverse(),
      entries: s.entries.slice().reverse(),
      connections: s.connections.slice().reverse() };
    assert.strictEqual(JSON.stringify(api.request(shuffled)), a,
      'canonical ordering is deterministic');
  });

  test('ROW MODEL: default single row still groups a wall, and collapsing is conservative', () => {
    // superseded in part by PBV2-12: the editor CAN now express several rows.
    // Default behaviour is unchanged — a wall starts with one row.
    const { s } = sample();
    const req = api.request(s);
    const perRow = {};
    for (const e of req.entries) perRow[e.rowId] = (perRow[e.rowId] || 0) + 1;
    const bottomRow = api.rowsFor(s, 'bottom')[0];
    assert.strictEqual(perRow[bottomRow.id], 2,
      'both bottom raceways default into the wall first row');
    // and a single row can never under-size versus a split into two rows
    const single = engine.calculatePullBox({
      rows: [{ id: 'r', wall: 'left', order: 0 }, { id: 't', wall: 'top', order: 0 }],
      entries: [{ id: 'a', rowId: 'r', tradeSize: '4' }, { id: 'b', rowId: 'r', tradeSize: '2' },
        { id: 'c', rowId: 'r', tradeSize: '3' }, { id: 't1', rowId: 't', tradeSize: '2' }],
      connections: [{ id: 'c1', entryIds: ['a', 't1'] }],
    });
    const split = engine.calculatePullBox({
      rows: [{ id: 'r', wall: 'left', order: 0 }, { id: 'r2', wall: 'left', order: 1 },
        { id: 't', wall: 'top', order: 0 }],
      entries: [{ id: 'a', rowId: 'r', tradeSize: '4' }, { id: 'b', rowId: 'r', tradeSize: '2' },
        { id: 'c', rowId: 'r2', tradeSize: '3' }, { id: 't1', rowId: 't', tradeSize: '2' }],
      connections: [{ id: 'c1', entryIds: ['a', 't1'] }],
    });
    assert.ok(single.minimumWidthIn >= split.minimumWidthIn,
      'collapsing rows never returns a smaller requirement');
  });

  test('POSITION, COLOUR and SELECTION never reach the engine', () => {
    const { s, l } = sample();
    const baseline = JSON.stringify(api.request(s));
    api.setPos(s, l.id, 0.06);
    assert.strictEqual(JSON.stringify(api.request(s)), baseline,
      'the visual slider is presentation-only');
    api.setPos(s, l.id, 0.94);
    assert.strictEqual(JSON.stringify(api.request(s)), baseline);
    const req = api.request(s);
    const flat = JSON.stringify(req);
    assert.ok(!/#[0-9a-f]{6}/i.test(flat), 'no relationship colour in engine input');
    assert.ok(!/selected|connectFrom|"v"/.test(flat), 'no UI state in engine input');
  });

  test('CONNECTIONS map to engine relationships; engine classification is authoritative', () => {
    const { s, l, t } = sample();
    const req = api.request(s);
    const conn = req.connections.find((c) => c.entryIds.includes(l.id));
    assert.ok(conn.entryIds.includes(t.id), 'both endpoints carried across');
    // the prototype's own label plays no part in the engine's answer
    const cls = engine.classifyConnection(conn, req.entries, req.rows);
    assert.strictEqual(cls.type, 'ANGLE');
    assert.strictEqual(cls.type, api.classify('left', 'top'),
      'they agree here — but the engine value is the one used for results');
    const body = fn3d('pbv23dCalculate');
    assert.ok(!body.includes('pbv23dClassify'),
      'calculation never consults the prototype classifier');
  });

  test('a deleted raceway can never leave a dangling relationship in engine input', () => {
    const { s, l, t } = sample();
    api.del(s, l.id);
    const req = api.request(s);
    const ids = req.entries.map((e) => e.id);
    for (const c of req.connections) {
      for (const id of c.entryIds) {
        assert.ok(ids.includes(id), 'dangling endpoint reached the engine: ' + id);
      }
    }
    assert.strictEqual(engine.validatePullBoxRequest(req).ok, true);
    assert.ok(!req.entries.some((e) => e.id === l.id));
    assert.ok(!req.connections.some((c) => c.entryIds.includes(t.id) && c.entryIds.includes(l.id)));
  });
});

describe('PBV2-11 — live calculation and presentation', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  function auditFixture() {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const b1 = api.add(s, 'bottom', '3', api.nextId('e'));
    const b2 = api.add(s, 'bottom', '3', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    api.connect(s, b1.id, b2.id, api.nextId('c'));
    return s;
  }

  test('the engine is the source of every displayed number', () => {
    const s = auditFixture();
    const result = engine.calculatePullBox(api.request(s));
    const p = api.present(result);
    assert.strictEqual(p.state, 'OK');
    // the safety-audit case, now computed live rather than hard-coded
    assert.strictEqual(p.height.kind, 'RESOLVED');
    assert.strictEqual(p.height.valueIn, result.minimumHeightIn);
    assert.strictEqual(p.height.valueIn, 21);
    assert.strictEqual(p.width.kind, 'LAYOUT_DEPENDENT');
    assert.strictEqual(p.width.pullRuleIn, result.minimumWidthIn);
    assert.strictEqual(p.width.entrySpacingIn,
      result.dimensionStatus.width.minimumEntrySpacingIn);
    assert.strictEqual(p.spacing.length, result.spacingRequirements.length);
    for (let i = 0; i < p.spacing.length; i++) {
      assert.strictEqual(p.spacing[i].minimumInches,
        result.spacingRequirements[i].minimumInches);
    }
  });

  test('NOT FULLY DETERMINED survives into the drawing; 12 inches never becomes final', () => {
    const s = auditFixture();
    const p = api.present(engine.calculatePullBox(api.request(s)));
    const svg = api.svg(s, { result: p });
    assert.ok(svg.includes('NOT FULLY DETERMINED'));
    assert.ok(svg.includes('p3d-dim-ref'), 'reference dimension for the unresolved axis');
    assert.ok(!/>12&#8243;|>12&#x2033;|12\u2033 WIDTH/.test(svg),
      'the pull-rule 12 inch value never appears as the width answer');
    assert.ok(svg.includes('21\u2033'), 'the resolved height renders normally');
  });

  test('a resolved axis draws a solid dimension carrying the engine value', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '4', api.nextId('e'));
    const b = api.add(s, 'right', '4', api.nextId('e'));
    api.connect(s, a.id, b.id, api.nextId('c'));
    const result = engine.calculatePullBox(api.request(s));
    assert.strictEqual(result.minimumWidthIn, 32, 'engine says 32');
    const svg = api.svg(s, { result: api.present(result) });
    assert.ok(svg.includes('32\u2033 WIDTH'), 'the drawing shows the engine value');
    assert.ok(!/class="p3d-dim-width p3d-dim-ref"/.test(svg), 'solid, not a reference dim');
  });

  test('unsupported and invalid states fail explicitly instead of inventing numbers', () => {
    const empty = api.empty();
    const result = engine.calculatePullBox(api.request(empty));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'NO_ENTRIES');
    const p = api.present(result);
    assert.strictEqual(p.state, 'INVALID');
    assert.strictEqual(p.reason, 'NO_ENTRIES');
    assert.ok(!('width' in p) && !('height' in p), 'no fabricated dimensions');
    const svg = api.svg(empty, { result: p });
    assert.ok(!svg.includes('p3d-dim-width'), 'nothing drawn for an invalid result');
    assert.strictEqual(api.present(null).state, 'NONE', 'no result yet is its own state');
  });

  test('edit -> calculate -> edit -> recalculate stays truthful', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '4', api.nextId('e'));
    const b = api.add(s, 'right', '4', api.nextId('e'));
    api.connect(s, a.id, b.id, api.nextId('c'));
    let p = api.present(engine.calculatePullBox(api.request(s)));
    assert.strictEqual(p.width.valueIn, 32);
    api.setSize(s, a.id, '2');
    p = api.present(engine.calculatePullBox(api.request(s)));
    assert.strictEqual(p.width.valueIn, 32, 'largest of the pair still governs');
    api.setSize(s, b.id, '2');
    p = api.present(engine.calculatePullBox(api.request(s)));
    assert.strictEqual(p.width.valueIn, 16, 'recalculation reflects the edit');
  });

  test('CALCULATE calls the engine exactly once, through the adapter', () => {
    const body = fn3d('pbv23dCalculate');
    assert.strictEqual((body.match(/EC\.pullBox\.calculatePullBox\(/g) || []).length, 1);
    assert.ok(body.includes('pbv23dEngineRequest(PBV23D)'), 'input comes from the adapter');
    assert.ok(body.includes('pbv23dPresent('), 'output goes through the adapter');
    assert.ok(!/[*]|Math\./.test(body), 'no arithmetic in the calculate handler');
    // and it is the ONLY engine call site in the whole prototype
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
  });

  test('every geometry mutation invalidates a shown result', () => {
    for (const name of ['pbv23dTapWall', 'pbv23dDeleteSelected', 'pbv23dPickSize',
      'pbv23dPickWall', 'pbv23dPickPosition', 'pbv23dSetFixture']) {
      assert.ok(fn3d(name).includes('pbv23dInvalidateResult'),
        name + ' must clear the stale result');
    }
    assert.ok(fn3d('pbv23dTapEntry').includes('pbv23dInvalidateResult'),
      'creating a connection invalidates too');
    assert.ok(fn3d('pbv23dInvalidateResult').includes('pbv23dLastResult = null'));
  });

  test('no engine constants or NEC rules were copied into the prototype', () => {
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    // reading the engine's public kind labels is consumption, not duplication;
    // engine internals and code references must still stay out
    assert.ok(!/314\.28|TRADE_SIZE_IN|WALL_DIMENSION/.test(code),
      'no engine internals or code references duplicated');
    assert.ok(!/multiplier\s*\*|largestTradeSize\s*\*/.test(code),
      'no requirement arithmetic reconstructed in the UI');
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b/.test(code), 'no NEC multipliers');
    assert.ok(fn3d('pbv23dSupportedSizes').includes('EC.pullBox.TRADE_SIZE_KEYS'),
      'trade sizes are validated against the engine, not a private copy');
  });

  test('Code to AI is untouched and remains with the working editor', () => {
    // the prototype deliberately renders no code references yet, so the
    // global clickable rule holds trivially and the existing AI pipeline is
    // not forked (see report: return-path coupling deferred)
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.ok(!/ecRenderCodeRef|ecOpenCodeRef|EC_CODE_CONTEXTS/.test(code),
      'no second AI context pipeline');
    assert.ok(!/314\.28|\bNEC \d|NYCEC/.test(code),
      'no inert code section citations in the prototype');
    // and the real pathway is intact in the working editor
    assert.ok(html.includes('function ecRenderCodeRef') && html.includes('function ecOpenCodeRef'));
    assert.ok(html.includes('function pbv2ReturnFromAi'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12 — multi-row model / production parity
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12 — engine row semantics (audit pins)', () => {
  const engine = require('../src/calc/pullBox');

  test('row.order carries no arithmetic — identity and ordering only', () => {
    const build = (order) => engine.calculatePullBox({
      rows: [{ id: 'r', wall: 'left', order }],
      entries: [{ id: 'x', rowId: 'r', tradeSize: '2' }, { id: 'y', rowId: 'r', tradeSize: '2' }],
      connections: [{ id: 'c', entryIds: ['x', 'y'] }],
    });
    const a = build(0); const b = build(9);
    assert.strictEqual(a.minimumWidthIn, b.minimumWidthIn, 'order never changes a value');
    assert.strictEqual(a.widthRequirements[0].rowOrder, 0);
    assert.strictEqual(b.widthRequirements[0].rowOrder, 9, 'it survives only as metadata');
  });

  test('row grouping is what the A(2) rule consumes', () => {
    const split = engine.calculatePullBox({
      rows: [{ id: 'r1', wall: 'left', order: 0 }, { id: 'r2', wall: 'left', order: 1 },
        { id: 't', wall: 'top', order: 0 }],
      entries: [{ id: 'a', rowId: 'r1', tradeSize: '4' }, { id: 'b', rowId: 'r1', tradeSize: '2' },
        { id: 'c', rowId: 'r2', tradeSize: '3' }, { id: 't1', rowId: 't', tradeSize: '2' }],
      connections: [{ id: 'k', entryIds: ['a', 't1'] }],
    });
    const merged = engine.calculatePullBox({
      rows: [{ id: 'r1', wall: 'left', order: 0 }, { id: 't', wall: 'top', order: 0 }],
      entries: [{ id: 'a', rowId: 'r1', tradeSize: '4' }, { id: 'b', rowId: 'r1', tradeSize: '2' },
        { id: 'c', rowId: 'r1', tradeSize: '3' }, { id: 't1', rowId: 't', tradeSize: '2' }],
      connections: [{ id: 'k', entryIds: ['a', 't1'] }],
    });
    assert.strictEqual(split.minimumWidthIn, 26, '6x4 + 2 (untriggered row 2 contributes nothing)');
    assert.strictEqual(merged.minimumWidthIn, 29, '6x4 + 2 + 3');
    assert.notStrictEqual(split.minimumWidthIn, merged.minimumWidthIn,
      'row assignment is electrically material');
  });

  test('row constraints: empty rows fine, per-wall order must be unique', () => {
    assert.strictEqual(engine.calculatePullBox({
      rows: [{ id: 'r', wall: 'left', order: 0 }, { id: 'empty', wall: 'top', order: 0 }],
      entries: [{ id: 'x', rowId: 'r', tradeSize: '2' }], connections: [],
    }).ok, true, 'an empty row is valid');
    assert.strictEqual(engine.calculatePullBox({
      rows: [{ id: 'a', wall: 'left', order: 0 }, { id: 'b', wall: 'left', order: 0 }],
      entries: [{ id: 'x', rowId: 'a', tradeSize: '2' }], connections: [],
    }).reason, 'INVALID_ROW_ORDER', 'duplicate order on one wall is rejected');
    assert.strictEqual(engine.calculatePullBox({
      rows: [{ id: 'a', wall: 'left', order: 0 }, { id: 'b', wall: 'top', order: 0 }],
      entries: [{ id: 'x', rowId: 'a', tradeSize: '2' }], connections: [],
    }).ok, true, 'the same order on different walls is fine');
  });

  test('PROPERTY: collapsing rows never returns a SMALLER requirement (exhaustive)', () => {
    // Reasoning from the rule's shape: a triggered row requires
    //   5*L + S   (6*largest + sum of the others = 5L + S)
    // Merging rows gives L >= every L_i and S >= every S_i, so the merged
    // candidate dominates each split candidate — and merging can only ADD
    // triggered entries, never remove them. Verified exhaustively below.
    const SIZES = ['1/2', '1', '2', '3', '4', '6'];
    const partitions = (arr) => {
      if (arr.length === 0) return [[]];
      const first = arr[0]; const rest = partitions(arr.slice(1)); const out = [];
      for (const p of rest) {
        for (let i = 0; i < p.length; i++) {
          const q = p.map((g) => g.slice()); q[i].push(first); out.push(q);
        }
        out.push([[first]].concat(p.map((g) => g.slice())));
      }
      return out;
    };
    const calc = (sizes, part, trigger) => {
      const rows = part.map((g, i) => ({ id: 'r' + i, wall: 'left', order: i }));
      rows.push({ id: 't', wall: 'top', order: 0 });
      const entries = [];
      part.forEach((g, i) => g.forEach((j) => entries.push({
        id: 'e' + j, rowId: 'r' + i, tradeSize: sizes[j],
      })));
      entries.push({ id: 't1', rowId: 't', tradeSize: '1/2' });
      return engine.calculatePullBox({ rows, entries,
        connections: [{ id: 'k', entryIds: ['e' + trigger, 't1'] }] });
    };
    const combos = (n) => (n === 0 ? [[]]
      : SIZES.flatMap((s) => combos(n - 1).map((rest) => [s].concat(rest))));
    let checked = 0;
    const violations = [];
    for (let n = 2; n <= 3; n++) {
      for (const sizes of combos(n)) {
        const idx = [...Array(n).keys()];
        const merged = calc(sizes, [idx], 0);
        for (const part of partitions(idx)) {
          for (let trig = 0; trig < n; trig++) {
            const split = calc(sizes, part, trig);
            checked++;
            if (merged.minimumWidthIn < split.minimumWidthIn) {
              violations.push({ sizes, part, trig,
                merged: merged.minimumWidthIn, split: split.minimumWidthIn });
            }
          }
        }
      }
    }
    assert.ok(checked > 1500, 'meaningful coverage: ' + checked + ' cases');
    assert.deepStrictEqual(violations, [], 'no counterexample to the conservative claim');
  });
});

describe('PBV2-12 — 3D row model', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  test('state carries explicit stable rows; the first raceway creates one', () => {
    const s = api.empty();
    assert.deepStrictEqual(s.rows, []);
    const e = api.add(s, 'left', '2', api.nextId('e'));
    assert.strictEqual(s.rows.length, 1, 'a valid row is created on demand');
    assert.strictEqual(s.rows[0].wall, 'left');
    assert.strictEqual(s.rows[0].order, 0);
    assert.strictEqual(e.rowId, s.rows[0].id, 'the raceway references it explicitly');
    // second raceway on the same wall joins the same row by default
    const e2 = api.add(s, 'left', '3', api.nextId('e'));
    assert.strictEqual(e2.rowId, s.rows[0].id);
    assert.strictEqual(api.rowsFor(s, 'left').length, 1, 'no surprise extra rows');
  });

  test('several rows can exist on one wall and a raceway can move between them', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '4', api.nextId('e'));
    const b = api.add(s, 'left', '3', api.nextId('e'));
    const row2 = api.addRow(s, 'left', api.nextId('row'));
    assert.strictEqual(api.rowsFor(s, 'left').length, 2);
    assert.strictEqual(row2.order, 1, 'orders stay unique per wall');
    assert.strictEqual(api.setRow(s, b.id, row2.id), true);
    assert.strictEqual(api.find(s, b.id).rowId, row2.id);
    assert.strictEqual(api.find(s, a.id).rowId, api.rowsFor(s, 'left')[0].id,
      'the other raceway is unaffected');
    // display numbers derive from sorted order, not raw values
    assert.strictEqual(api.rowIndex(s, row2.id), 1);
  });

  test('a raceway can never reference a row on another wall', () => {
    const s = api.empty();
    const left = api.add(s, 'left', '2', api.nextId('e'));
    api.add(s, 'top', '2', api.nextId('e'));
    const topRow = api.rowsFor(s, 'top')[0];
    assert.strictEqual(api.setRow(s, left.id, topRow.id), false,
      'cross-wall row assignment is refused');
    assert.notStrictEqual(api.find(s, left.id).rowId, topRow.id);
    assert.strictEqual(api.setRow(s, left.id, 'ghost-row'), false);
  });

  test('changing wall lands on a valid row of the DESTINATION wall', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '4', api.nextId('e'));
    const keep = api.add(s, 'left', '2', api.nextId('e'));
    const row2 = api.addRow(s, 'left', api.nextId('row'));
    api.setRow(s, a.id, row2.id);
    assert.strictEqual(api.setWall(s, a.id, 'bottom'), true);
    const moved = api.find(s, a.id);
    const destRow = api.rowById(s, moved.rowId);
    assert.strictEqual(destRow.wall, 'bottom', 'row belongs to the new wall');
    assert.strictEqual(moved.wall, 'bottom');
    // the emptied left row is tidied, the occupied one survives
    assert.strictEqual(api.rowsFor(s, 'left').length, 1);
    assert.strictEqual(api.find(s, keep.id).rowId, api.rowsFor(s, 'left')[0].id);
  });

  test('row ids are stable and independent of array position', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '2', api.nextId('e'));
    const r2 = api.addRow(s, 'left', api.nextId('row'));
    const r3 = api.addRow(s, 'left', api.nextId('row'));
    api.setRow(s, a.id, r3.id);
    const idBefore = api.find(s, a.id).rowId;
    assert.strictEqual(api.dropRow(s, r2.id), true, 'delete an unrelated empty row');
    assert.strictEqual(api.find(s, a.id).rowId, idBefore,
      'the surviving raceway still points at the same row identity');
    assert.strictEqual(api.rowById(s, r3.id).id, r3.id);
  });

  test('only EMPTY rows can be deleted — raceways are never destroyed', () => {
    const s = api.empty();
    const a = api.add(s, 'left', '2', api.nextId('e'));
    const occupied = api.find(s, a.id).rowId;
    assert.strictEqual(api.dropRow(s, occupied), false, 'refused: the row holds a raceway');
    assert.strictEqual(s.entries.length, 1, 'nothing was destroyed');
    assert.ok(api.rowById(s, occupied), 'the row survives');
    const empty = api.addRow(s, 'left', api.nextId('row'));
    assert.strictEqual(api.dropRow(s, empty.id), true);
    assert.strictEqual(api.rowsFor(s, 'left').length, 1);
  });
});

describe('PBV2-12 — rows through the adapter and the engine', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  test('rows map 1:1 into canonical engine rows — no collapsing', () => {
    const s = api.build('rows');
    const req = api.request(s);
    assert.strictEqual(api.rowsFor(s, 'left').length, 2, 'two real rows in the editor');
    assert.strictEqual(req.rows.filter((r) => r.wall === 'left').length, 2,
      'both rows reach the engine');
    for (const r of req.rows) {
      assert.ok(api.rowById(s, r.id), 'engine row id is the editor row id');
      assert.deepStrictEqual(Object.keys(r).sort(), ['id', 'order', 'wall']);
    }
    for (const e of req.entries) {
      const owner = req.rows.find((r) => r.id === e.rowId);
      assert.ok(owner, 'every entry references a forwarded row');
      assert.strictEqual(owner.wall, api.find(s, e.id).wall, 'wall/row stay consistent');
    }
    assert.strictEqual(engine.validatePullBoxRequest(req).ok, true);
  });

  test('CONCRETE: moving one raceway between rows changes the engine answer', () => {
    const s = api.build('rows');
    const split = engine.calculatePullBox(api.request(s));
    assert.strictEqual(split.minimumWidthIn, 26, '6x4 + 2 with the 3 inch in row 2');
    const three = s.entries.find((e) => e.size === '3');
    const row1 = api.rowsFor(s, 'left')[0];
    assert.strictEqual(api.setRow(s, three.id, row1.id), true);
    const merged = engine.calculatePullBox(api.request(s));
    assert.strictEqual(merged.minimumWidthIn, 29, '6x4 + 2 + 3 once they share a row');
    assert.ok(merged.minimumWidthIn > split.minimumWidthIn,
      'the row UX is electrically meaningful, not decorative');
  });

  test('visual position stays out of the engine; row assignment does not', () => {
    const s = api.build('rows');
    const baseline = JSON.stringify(api.request(s));
    const three = s.entries.find((e) => e.size === '3');
    api.setPos(s, three.id, 0.06);
    api.setPos(s, three.id, 0.94);
    assert.strictEqual(JSON.stringify(api.request(s)), baseline,
      'moving within the same row changes nothing the engine sees');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    assert.notStrictEqual(JSON.stringify(api.request(s)), baseline,
      'moving to another row does change the engine input');
    const flat = JSON.stringify(api.request(s));
    assert.ok(!/"v":/.test(flat), 'visualPosition is never forwarded');
  });

  test('row depth is a grouping cue only, never engine data', () => {
    const s = api.build('rows');
    const rows = api.rowsFor(s, 'left');
    assert.notStrictEqual(api.rowDepth(s, rows[0].id), api.rowDepth(s, rows[1].id),
      'rows sit on distinct visual tracks');
    assert.ok(api.rowDepth(s, rows[1].id) <= 0.85, 'depth stays inside the enclosure');
    const flat = JSON.stringify(api.request(s));
    assert.ok(!/0\.3|0\.55|depth/.test(flat), 'no depth value reaches the engine');
    const body = fn3d('pbv23dEngineRequest');
    assert.ok(!body.includes('RowDepth') && !body.includes('.v'),
      'the adapter cannot see visual geometry');
  });

  test('row cues are visible without clutter and never reuse pull colours', () => {
    const s = api.build('rows');
    const svg = api.svg(s, {});
    const tracks = svg.match(/class="p3d-track"/g) || [];
    assert.strictEqual(tracks.length, 2, 'one track per row on the multi-row wall');
    // single-row walls get no track at all
    const single = api.empty();
    api.add(single, 'left', '2', api.nextId('e'));
    assert.strictEqual((api.svg(single, {}).match(/class="p3d-track"/g) || []).length, 0);
    // track cue is neutral grey — relationship colours keep their meaning
    const trackLine = svg.match(/class="p3d-track"[^>]*stroke="([^"]+)"/)[1];
    assert.ok(!api.PALETTE.includes(trackLine), 'row cue never borrows a pull colour');
    assert.strictEqual(trackLine, '#3a3a3a');
    // PBV2-12.2 supersedes the hub row tag: trade size is the raceway's only
    // hub identifier, and row identity moved to the context summary instead
    const three = s.entries.find((e) => e.size === '3');
    const selected = api.svg(s, { selected: three.id });
    assert.ok(selected.includes('3&#8243;'), 'the hub identifies by trade size');
    assert.ok(!/R\d<\/text>/.test(selected), 'row text never appears on the drawing');
    assert.ok(!/R1<\/text>|R2<\/text>/.test(svg), 'no permanent row labels');
  });

  test('pull relationships survive row movement intact', () => {
    const s = api.build('rows');
    const four = s.entries.find((e) => e.size === '4');
    const before = JSON.parse(JSON.stringify(s.connections));
    const colourBefore = api.entryColor(s, four.id);
    const row2 = api.rowsFor(s, 'left')[1];
    api.setRow(s, four.id, row2.id);
    assert.deepStrictEqual(s.connections, before, 'connection ids and endpoints unchanged');
    assert.strictEqual(api.entryColor(s, four.id), colourBefore,
      'relationship colour is unaffected by row assignment');
    const req = api.request(s);
    const ids = req.entries.map((e) => e.id);
    for (const c of req.connections) {
      for (const id of c.entryIds) assert.ok(ids.includes(id), 'endpoints stay valid');
    }
    assert.strictEqual(engine.validatePullBoxRequest(req).ok, true);
  });

  test('every row mutation invalidates a stale result', () => {
    for (const name of ['pbv23dPickRow', 'pbv23dAddRowHere']) {
      assert.ok(fn3d(name).includes('pbv23dInvalidateResult'),
        name + ' must clear the stale result');
    }
    // manual row deletion was removed in PBV2-12.1: rows clean themselves up
    assert.ok(!P3D.includes('pbv23dDropRow'), 'no manual row-delete path remains');
    assert.ok(fn3d('pbv23dSetWall').includes('pbv23dEnsureRow'),
      'wall change always resolves a destination row');
  });

  test('dense mode keeps every raceway reachable across two real rows', () => {
    const s = api.build('dense');
    assert.strictEqual(s.entries.length, 16);
    assert.strictEqual(api.rowsFor(s, 'left').length, 2, 'the busy wall is split');
    const svg = api.svg(s, {});
    assert.strictEqual((svg.match(/class="p3d-hub"/g) || []).length, 16, 'none hidden');
    assert.strictEqual((svg.match(/class="p3d-hit"/g) || []).length, 16, 'all tappable');
    assert.strictEqual((svg.match(/class="p3d-track"/g) || []).length, 2);
    for (const e of s.entries) {
      const row = api.rowById(s, e.rowId);
      assert.ok(row && row.wall === e.wall, 'every raceway has a consistent row');
    }
  });

  test('the four-wall form UI was not recreated, and no NEC arithmetic appeared', () => {
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/.test(code), 'no NEC arithmetic');
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    // rows are edited from the selected raceway, not from wall panels
    assert.ok(fn3d('pbv23dSheetBody').includes('ROW ON THIS WALL'),
      'row editing lives in the raceway editor');
    assert.ok(!/\+ ROW<\/button>|id="pbv2-3d-wallpanel/.test(code),
      'no permanent per-wall row management panels');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12.1 — row / add-raceway UX polish
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12.1 — UX polish', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  /** Executes the SHIPPED UI handlers against stub DOM + the real engine, so
   *  the accidental-creation guarantee is proven behaviourally. */
  function ui() {
    const consts = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS',
      'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const pure = ['pbv23dHub', 'pbv23dInward', 'pbv23dEmptyState', 'pbv23dRowsFor',
      'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow',
      'pbv23dSetEntryRow', 'pbv23dDeleteRowIfEmpty', 'pbv23dRowDepth', 'pbv23dFindEntry',
      'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dSetSize',
      'pbv23dSetPosition', 'pbv23dSetWall', 'pbv23dClassify', 'pbv23dAddConnection',
      'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConns', 'pbv23dEntryColor', 'pbv23dHitRadius',
      'pbv23dRoutePath', 'pbv23dBuildFixture', 'pbv23dEngineRequest', 'pbv23dPresent',
      'pbv23dTapWall', 'pbv23dStartAdd', 'pbv23dCancelAdd', 'pbv23dTapEntry',
      'pbv23dPickRow', 'pbv23dAddRowHere', 'pbv23dLayoutGeometry', 'pbv23dCertifyBox',
      'pbv23dCertifiedBox', 'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dCalculate',
      'pbv23dInvalidateResult',
      'pbv23dIn', 'pbv23dSheetResultLine'].map(fn3d).join('\n');
    let calls = 0;
    const counted = Object.create(engine);
    counted.calculatePullBox = function (r) { calls++; return engine.calculatePullBox(r); };
    const els = {};
    const doc = { getElementById: (id) => (els[id] || (els[id] = { innerHTML: '' })) };
    const out = {};
    let sheetOpens = 0;
    // eslint-disable-next-line no-new-func
    new Function('EC', 'document', 'pbv23dRender', 'pbv23dOpenSheet', 'pbv23dCloseSheet',
      'pbv23dRefreshSheet', 'exports',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null; var pbv23dSelected = null; var pbv23dConnectFrom = null;\n'
      + 'var pbv23dAddMode = false; var pbv23dLastResult = null; var pbv23dLayout = null;\n'
      + 'var pbv23dPresentation = null;\n'
      + 'var PBV23D_ERROR_TEXT = { NO_ENTRIES: "Add at least one raceway before calculating." };\n'
      + consts + pure + `
      exports.load = (s) => { PBV23D = s; };
      exports.state = () => PBV23D;
      exports.tapWall = pbv23dTapWall; exports.startAdd = pbv23dStartAdd;
      exports.cancelAdd = pbv23dCancelAdd; exports.tapEntry = pbv23dTapEntry;
      exports.pickRow = pbv23dPickRow; exports.addRowHere = pbv23dAddRowHere;
      exports.calculate = pbv23dCalculate; exports.build = pbv23dBuildFixture;
      exports.addMode = () => pbv23dAddMode; exports.selected = () => pbv23dSelected;
      exports.select = (id) => { pbv23dSelected = id; };
      exports.presentation = () => pbv23dPresentation;
      exports.sheetLine = pbv23dSheetResultLine;
      exports.rowsFor = pbv23dRowsFor; exports.find = pbv23dFindEntry;`)(
      { pullBox: counted, pullBoxLayout: require('../src/layout/pullBoxLayout'),
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') },
      doc, () => {}, () => { sheetOpens++; }, () => {}, () => {}, out);
    out.calls = () => calls;
    out.sheetOpens = () => sheetOpens;
    return out;
  }

  test('ADD MODE: normal wall taps create nothing at all', () => {
    const u = ui();
    u.load(u.build('dense'));
    const before = u.state().entries.length;
    assert.strictEqual(before, 16);
    // hammer every wall repeatedly in normal mode
    for (let i = 0; i < 5; i++) {
      for (const w of ['top', 'left', 'right', 'bottom']) {
        assert.strictEqual(u.tapWall(w), false, 'wall taps are inert in normal mode');
      }
    }
    assert.strictEqual(u.state().entries.length, before,
      'missing a hub in a dense box can never mutate the model');
    assert.strictEqual(u.state().rows.length, u.build('dense').rows.length);
  });

  test('ADD MODE: explicit entry, one placement, automatic exit', () => {
    const u = ui();
    u.load(u.build('standard'));
    const before = u.state().entries.length;
    assert.strictEqual(u.addMode(), false);
    u.startAdd();
    assert.strictEqual(u.addMode(), true, 'explicit mode entered');
    assert.strictEqual(u.tapWall('right'), true, 'the wall tap now places');
    assert.strictEqual(u.state().entries.length, before + 1, 'exactly one raceway');
    assert.strictEqual(u.addMode(), false, 'mode exits after placement');
    const made = u.state().entries[u.state().entries.length - 1];
    assert.strictEqual(made.wall, 'right');
    assert.strictEqual(u.selected(), made.id, 'the new raceway is selected');
    assert.strictEqual(u.sheetOpens(), 1, 'its editor opens');
    // a second wall tap after placement does nothing
    assert.strictEqual(u.tapWall('left'), false);
    assert.strictEqual(u.state().entries.length, before + 1, 'no repeat adds');
  });

  test('ADD MODE: cancelling creates nothing; existing raceways stay inert while placing', () => {
    const u = ui();
    u.load(u.build('standard'));
    const before = u.state().entries.length;
    u.startAdd();
    // tapping an existing raceway during placement must not select it
    u.tapEntry(u.state().entries[0].id);
    assert.strictEqual(u.selected(), null, 'selection is not hijacked while placing');
    u.cancelAdd();
    assert.strictEqual(u.addMode(), false);
    assert.strictEqual(u.state().entries.length, before, 'cancel creates nothing');
    // and normal selection works again afterwards
    u.tapEntry(u.state().entries[0].id);
    assert.strictEqual(u.selected(), u.state().entries[0].id);
  });

  test('ADD MODE: walls are visibly eligible only while placing', () => {
    const s = api.build('standard');
    const normal = api.svg(s, {});
    const adding = api.svg(s, { addMode: true });
    assert.ok(!normal.includes('p3d-wall-target'), 'no target styling in normal mode');
    assert.strictEqual((adding.match(/p3d-wall-target/g) || []).length, 4);
    assert.ok(adding.includes('stroke="#ffc700"'), 'walls highlight in the app accent');
    assert.strictEqual((normal.match(/class="p3d-add"/g) || []).length, 0,
      'the plus affordances only appear while placing');
    assert.strictEqual((adding.match(/class="p3d-add"/g) || []).length, 4);
  });

  test('HIT TESTING did not regress: hub and stub still select', () => {
    const u = ui();
    u.load(u.build('dense'));
    for (const e of u.state().entries.slice(0, 5)) {
      u.select(null);
      u.tapEntry(e.id);
      assert.strictEqual(u.selected(), e.id, 'hub/stub tap still selects ' + e.id);
    }
    const svg = api.svg(api.build('dense'), {});
    assert.strictEqual((svg.match(/class="p3d-hit"/g) || []).length, 16);
    assert.strictEqual((svg.match(/class="p3d-stubhit"/g) || []).length, 16);
  });

  test('CALCULATE is available inside the editor and uses the one engine path', () => {
    const sheet = fn3d('pbv23dSheetBody');
    assert.ok(sheet.includes('id="pbv2-3d-sheet-calc"'), 'a CALCULATE button in the sheet');
    assert.ok(sheet.includes('onclick="pbv23dCalculate()"'), 'it uses the existing path');
    assert.ok(sheet.includes('pbv23dSheetResultLine()'), 'the result shows in the sheet');
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1,
      'still exactly one engine call site');
    assert.ok(!/[*]|Math\./.test(fn3d('pbv23dSheetResultLine')),
      'the sheet result line does no arithmetic');
  });

  test('PRIMARY ACCEPTANCE: 26 -> 29 without ever closing the editor', () => {
    const u = ui();
    u.load(u.build('rows'));
    u.calculate();
    assert.strictEqual(u.presentation().width.valueIn, 26, 'engine says 26 inches');
    // PBV2-13B-3: the sheet shows the certified box and flags conservative geometry
    assert.strictEqual(u.sheetLine(), 'W 26\u2033  \u00B7  H 12\u2033  \u00B7  conservative');
    // select the 3 inch raceway and move it into Row 1 from inside the editor
    const three = u.state().entries.find((e) => e.size === '3');
    u.select(three.id);
    const row1 = u.rowsFor(u.state(), 'left')[0];
    u.pickRow(row1.id);
    assert.strictEqual(u.presentation(), null, 'the row change invalidated the old result');
    u.calculate();
    assert.strictEqual(u.presentation().width.valueIn, 29, 'engine now says 29 inches');
    assert.ok(u.sheetLine().includes('29\u2033'), 'the editor shows it immediately');
    assert.strictEqual(u.calls(), 2, 'one engine call per CALCULATE press');
  });

  test('ROW LIFECYCLE: emptied rows disappear by themselves', () => {
    const u = ui();
    u.load(u.build('rows'));
    assert.strictEqual(u.rowsFor(u.state(), 'left').length, 2);
    const three = u.state().entries.find((e) => e.size === '3');
    const emptied = three.rowId;
    u.select(three.id);
    u.pickRow(u.rowsFor(u.state(), 'left')[0].id);
    assert.strictEqual(u.rowsFor(u.state(), 'left').length, 1,
      'the vacated row removed itself');
    assert.ok(!u.state().rows.some((r) => r.id === emptied));
    // and its track disappears with it
    assert.strictEqual((api.svg(u.state(), {}).match(/class="p3d-track"/g) || []).length, 0);
  });

  test('ROW LIFECYCLE: no manual row-delete controls remain', () => {
    const sheet = fn3d('pbv23dSheetBody');
    assert.ok(sheet.includes('ROW ON THIS WALL'));
    assert.ok(!/pbv23dDropRow/.test(P3D), 'the manual delete handler is gone entirely');
    assert.ok(!/Delete empty row/.test(sheet), 'no delete affordance in the row strip');
    // the strip is now only: row numbers plus one add control
    assert.ok(sheet.includes('pbv23dPickRow') && sheet.includes('pbv23dAddRowHere'));
  });

  test('ROW LIFECYCLE: delete and wall-change also clean up, without losing raceways', () => {
    const s = api.build('rows');
    const three = s.entries.find((e) => e.size === '3');
    const row2 = three.rowId;
    api.del(s, three.id);
    assert.ok(!s.rows.some((r) => r.id === row2), 'emptied row cleaned after delete');
    assert.strictEqual(s.entries.length, 3, 'no other raceway was harmed');
    // wall change empties the source row
    const s2 = api.build('rows');
    const t3 = s2.entries.find((e) => e.size === '3');
    const src = t3.rowId;
    api.setWall(s2, t3.id, 'right');
    assert.ok(!s2.rows.some((r) => r.id === src), 'source row cleaned after wall change');
    const moved = api.find(s2, t3.id);
    assert.strictEqual(api.rowById(s2, moved.rowId).wall, 'right');
    // last raceway on a wall: its row goes too
    const s3 = api.empty();
    const only = api.add(s3, 'top', '2', api.nextId('e'));
    api.del(s3, only.id);
    assert.deepStrictEqual(s3.rows, [], 'no orphan row survives');
  });

  test('ROW LIFECYCLE: [+] creates a row and moves the raceway into it', () => {
    const u = ui();
    u.load(u.build('rows'));
    const four = u.state().entries.find((e) => e.size === '4');
    u.select(four.id);
    const before = u.rowsFor(u.state(), 'left').length;
    u.addRowHere();
    assert.strictEqual(u.rowsFor(u.state(), 'left').length, before + 1);
    const moved = u.find(u.state(), four.id);
    const newRow = u.rowsFor(u.state(), 'left').slice(-1)[0];
    assert.strictEqual(moved.rowId, newRow.id, 'the raceway moved into the new row');
    // no standalone empty-row creation exists
    assert.ok(!u.state().rows.some((r) => !u.state().entries.some((e) => e.rowId === r.id)),
      'every row holds at least one raceway');
  });

  test('INVARIANTS after cleanup: ids stable, rows valid, connections intact', () => {
    const s = api.build('rows');
    const idsBefore = s.rows.map((r) => r.id);
    const connsBefore = JSON.stringify(s.connections);
    const three = s.entries.find((e) => e.size === '3');
    const colours = s.entries.map((e) => api.entryColor(s, e.id));
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    // surviving row ids unchanged
    for (const r of s.rows) assert.ok(idsBefore.includes(r.id), 'row id churned: ' + r.id);
    assert.strictEqual(JSON.stringify(s.connections), connsBefore, 'connections intact');
    assert.deepStrictEqual(s.entries.map((e) => api.entryColor(s, e.id)), colours,
      'relationship colours unaffected by row cleanup');
    for (const e of s.entries) {
      const row = api.rowById(s, e.rowId);
      assert.ok(row && row.wall === e.wall, 'every raceway has a valid same-wall row');
    }
    // the adapter forwards only rows that still exist
    const req = api.request(s);
    assert.strictEqual(req.rows.length, s.rows.length, 'no fabricated empty engine row');
    assert.strictEqual(engine.validatePullBoxRequest(req).ok, true);
    assert.ok(!/"v":/.test(JSON.stringify(req)), 'visualPosition still absent');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12.2 — persistent ADD action + consistent selected-raceway label
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12.2 — add action and label consistency', () => {
  const api = api3d();

  /** Bar markup for a given state/selection, from the shipped builder. */
  function barFor(state, opts) {
    opts = opts || {};
    const src = [fn3d('pbv23dFindEntry'), fn3d('pbv23dRowsFor'), fn3d('pbv23dRowById'),
      fn3d('pbv23dRowIndex'), fn3d('pbv23dClassify'), fn3d('pbv23dConnTypeOf'),
      fn3d('pbv23dGlobalsHtml'), fn3d('pbv23dSelectionHtml'),
      fn3d('pbv23dBarHtml')].join('\n');
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('pbv23dSelected', 'pbv23dConnectFrom', 'pbv23dAddMode',
      'pbv23dPresentation', 'exports',
      src + ';exports.bar = pbv23dBarHtml;')(
      opts.selected || null, opts.connectFrom || null, !!opts.addMode,
      opts.presentation || null, out);
    return out.bar(state);
  }

  test('ADD RACEWAY is present with no selection AND with a selection', () => {
    const s = api.build('standard');
    const idle = barFor(s, {});
    assert.ok(idle.includes('pbv23dStartAdd()'), 'available when nothing is selected');
    assert.ok(idle.includes('ADD'));
    const selected = barFor(s, { selected: s.entries[0].id });
    assert.ok(selected.includes('pbv23dStartAdd()'),
      'selecting a raceway must never remove the ability to add another');
    // PBV2-12.3.1: ADD moved into a single global-actions tier that renders
    // in every normal state, so there is now one add control, not two
    assert.ok(/id="pbv2-3d-add"/.test(selected), 'the global add control is present');
    assert.ok(selected.includes('p3d-globals'), 'it lives in the global action tier');
    // the selection actions are still there alongside it
    for (const action of ['pbv23dOpenSheet()', 'pbv23dStartConnect()',
      'pbv23dDeleteSelected()']) {
      assert.ok(selected.includes(action), 'lost selection action: ' + action);
    }
  });

  test('context states stay unambiguous: idle / selected / adding', () => {
    const s = api.build('standard');
    const adding = barFor(s, { addMode: true });
    assert.ok(adding.includes('Tap a wall to place raceway'));
    assert.ok(adding.includes('pbv23dCancelAdd()'));
    assert.ok(!adding.includes('pbv23dStartAdd()'), 'no double-add affordance while placing');
    assert.ok(!adding.includes('pbv23dDeleteSelected()'), 'no selection actions while placing');
    const connecting = barFor(s, { connectFrom: s.entries[0].id });
    assert.ok(connecting.includes('pbv23dCancelConnect()'));
    assert.ok(!connecting.includes('pbv23dStartAdd()'), 'connect state stays its own mode');
  });

  test('entering ADD mode from a selection is deterministic', () => {
    const body = fn3d('pbv23dStartAdd');
    assert.ok(body.includes('pbv23dConnectFrom = null'),
      'an active CONNECT is cancelled, never left ambiguous');
    assert.ok(body.includes('pbv23dSelected = null'),
      'selection is cleared deterministically while placing');
    assert.ok(body.includes('pbv23dAddMode = true'));
    assert.ok(body.includes('pbv23dCloseSheet()'), 'the editor sheet closes');
  });

  test('SELECTED LABEL: the hub always shows trade size, never row-only text', () => {
    const s = api.build('rows');   // multi-row wall: the failing case on iPhone
    const three = s.entries.find((e) => e.size === '3');
    const svg = api.svg(s, { selected: three.id });
    const labels = (svg.match(/font-family="monospace"[^>]*>([^<]*)</g) || [])
      .map((m) => m.match(/>([^<]*)<$/)[1]);
    assert.ok(labels.includes('3&#8243;'), 'the selected raceway shows its trade size');
    for (const l of labels) {
      assert.ok(!/^R\d+$/.test(l), 'no hub label is row-only text: ' + l);
      assert.ok(!/R\d/.test(l), 'row identity never rides on the hub label: ' + l);
    }
    // and the same holds on a single-row wall
    const top = s.entries.find((e) => e.wall === 'top');
    assert.ok(api.svg(s, { selected: top.id }).includes('2&#8243;'));
  });

  test('CONTEXT SUMMARY: trade size, wall and row identity together', () => {
    const s = api.build('rows');
    const three = s.entries.find((e) => e.size === '3');
    const bar = barFor(s, { selected: three.id });
    assert.ok(bar.includes('3\u2033'), 'trade size');
    assert.ok(bar.includes('LEFT'), 'wall');
    assert.ok(/R2/.test(bar), 'row identity, as context');
    // row identity is shown even on a single-row wall, for consistency
    const top = s.entries.find((e) => e.wall === 'top');
    assert.ok(/R1/.test(barFor(s, { selected: top.id })));
  });

  test('changing row updates context but never the hub identifier', () => {
    const s = api.build('rows');
    const three = s.entries.find((e) => e.size === '3');
    assert.ok(/R2/.test(barFor(s, { selected: three.id })));
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    const moved = barFor(s, { selected: three.id });
    assert.ok(/R1/.test(moved), 'context row indicator follows the move');
    assert.ok(moved.includes('3\u2033'), 'trade size still leads the summary');
    assert.ok(api.svg(s, { selected: three.id }).includes('3&#8243;'),
      'hub label unchanged by the row move');
  });

  test('changing trade size updates the hub label', () => {
    const s = api.build('rows');
    const three = s.entries.find((e) => e.size === '3');
    api.setSize(s, three.id, '6');
    assert.ok(api.svg(s, { selected: three.id }).includes('6&#8243;'));
    assert.ok(barFor(s, { selected: three.id }).includes('6\u2033'));
  });

  test('DENSE: every raceway reports its own size and row, ADD stays available', () => {
    const s = api.build('dense');
    assert.strictEqual(s.entries.length, 16);
    for (const e of s.entries.slice(0, 8)) {
      const svg = api.svg(s, { selected: e.id });
      assert.ok(svg.includes(e.size + '&#8243;'),
        'selected raceway shows its own trade size: ' + e.id);
      const bar = barFor(s, { selected: e.id });
      assert.ok(bar.includes(e.size + '\u2033'));
      assert.ok(bar.includes(e.wall.toUpperCase()));
      assert.ok(new RegExp('R' + (api.rowIndex(s, e.rowId) + 1)).test(bar),
        'correct row identity for ' + e.id);
      assert.ok(bar.includes('pbv23dStartAdd()'), 'ADD remains available in dense');
    }
    // no permanent row labels leaked onto the drawing
    const plain = api.svg(s, {});
    assert.ok(!/R\d<\/text>/.test(plain), 'no permanent R labels beside raceways');
    assert.strictEqual((plain.match(/class="p3d-track"/g) || []).length, 2,
      'tracks remain the wall-level row cue');
  });

  test('REGRESSION: add mode, calculate and row lifecycle all still hold', () => {
    // add mode still gates creation
    assert.ok(fn3d('pbv23dTapWall').includes('if (!pbv23dAddMode'), 'creation still gated');
    assert.ok(fn3d('pbv23dTapWall').includes('pbv23dAddMode = false'), 'still exits after one');
    // calculate still reachable from the sheet, one call site
    assert.ok(fn3d('pbv23dSheetBody').includes('id="pbv2-3d-sheet-calc"'));
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    // row lifecycle intact
    assert.ok(!code.includes('pbv23dDropRow'), 'no manual row delete returned');
    assert.ok(fn3d('pbv23dSetEntryRow').includes('pbv23dDeleteRowIfEmpty'),
      'empty rows still auto-clean');
    // engine boundary untouched
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/.test(code), 'no NEC arithmetic');
    assert.ok(!/"v":/.test(JSON.stringify(api.request(api.build('rows')))));
  });

  test('REGRESSION: the 26 to 29 real-engine row demo still passes', () => {
    const engine = require('../src/calc/pullBox');
    const s = api.build('rows');
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 26);
    const three = s.entries.find((e) => e.size === '3');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 29);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12.3 — results clarity + numbered pull relationships
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12.3 — results clarity', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  /** Renders the SHIPPED result HTML for a state, using the real engine. */
  function resultsFor(state) {
    const consts = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dFindEntry',
      'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEngineRequest', 'pbv23dPresent',
      'pbv23dIn', 'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dResultHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'exports',
      'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var PBV23D_ERROR_TEXT = { NO_ENTRIES: "Add at least one raceway before calculating." };\n'
      + consts + names.map(fn3d).join('\n') + `
      exports.render = function (state) {
        PBV23D = state;
        pbv23dPresentation = pbv23dPresent(
          EC.pullBox.calculatePullBox(pbv23dEngineRequest(state)));
        return { html: pbv23dResultHtml(), presentation: pbv23dPresentation };
      };`)({ pullBox: engine, pullBoxLayout: require('../src/layout/pullBoxLayout'),
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') }, out);
    return out.render(state);
  }
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  function bothResolved() {
    const s = api.empty();
    const a = api.add(s, 'left', '4', api.nextId('e'));
    const b = api.add(s, 'right', '4', api.nextId('e'));
    const t = api.add(s, 'top', '3', api.nextId('e'));
    const bt = api.add(s, 'bottom', '3', api.nextId('e'));
    api.connect(s, a.id, b.id, api.nextId('c'));
    api.connect(s, t.id, bt.id, api.nextId('c'));
    return s;
  }

  test('PRIMARY: both axes resolved lead with a required box size', () => {
    const { html: h, presentation: p } = resultsFor(bothResolved());
    assert.strictEqual(p.width.kind, 'RESOLVED');
    assert.strictEqual(p.height.kind, 'RESOLVED');
    const t = text(h);
    assert.ok(t.startsWith('REQUIRED BOX SIZE'), 'the section answers the real question first');
    // PBV2-13B-3: a W x H headline is now emitted ONLY when Layer 2 certifies a
    // box. This renderer harness supplies no layout, so the honest per-axis
    // rows are shown instead; the certified headline is covered in the 13B-3 suite.
    assert.ok(!h.includes('p3d-boxsize'), 'no headline without a certified layout');
    assert.ok(t.includes('WIDTH 32\u2033') && t.includes('HEIGHT 24\u2033'), 'engine values: ' + t);
    assert.ok(!/dimensionStatus|governing|LAYOUT_DEPENDENT|minimumWidthIn/.test(t),
      'no implementation terminology reaches the user');
  });

  test('RESOLVED values are labelled, never naked numbers', () => {
    const t = text(resultsFor(bothResolved()).html);
    assert.ok(/WIDTH 32\u2033 required minimum/.test(t), 'every number has a noun: ' + t);
    assert.ok(/HEIGHT 24\u2033 required minimum/.test(t));
    assert.ok(!/\bMIN\b/.test(t), 'no naked MIN rows remain anywhere');
  });

  test('LAYOUT_DEPENDENT is never presented as a final box width', () => {
    const { html: h, presentation: p } = resultsFor(api.build('standard'));
    assert.strictEqual(p.width.kind, 'LAYOUT_DEPENDENT');
    const t = text(h);
    assert.ok(t.includes('NOT FULLY DETERMINED'));
    assert.ok(!h.includes('p3d-boxsize'), 'no W x H headline while an axis is unresolved');
    assert.ok(t.includes('Known requirements:'), 'reasons grouped and secondary');
    assert.ok(t.includes('Pull-rule minimum width: 12\u2033'), 'rule minimum named as such');
    assert.ok(t.includes('Largest entry-spacing requirement: 18\u2033'));
    assert.ok(t.includes('physical entry and fitting layout'));
    assert.ok(!/WIDTH 12\u2033/.test(t), 'the rule minimum can never read as the answer');
    assert.ok(t.includes('HEIGHT 21\u2033 required minimum'), 'the resolved axis still reads plainly');
  });

  test('SPACING results are numbered, typed and fully described', () => {
    const { html: h, presentation: p } = resultsFor(api.build('standard'));
    const t = text(h);
    assert.strictEqual(p.spacing.length, 2);
    assert.ok(t.includes('U PULL') && t.includes('ANGLE PULL'), 'pull type in words');
    // since PBV2-12.3.3 same-wall endpoints also carry row identity
    assert.ok(/3\u2033 BOTTOM R\d \u2194 3\u2033 BOTTOM R\d/.test(t),
      'both endpoints described, disambiguated by row');
    assert.ok(t.includes('2\u2033 LEFT \u2194 2\u2033 TOP'));
    // wording tightened in PBV2-12.3.3: entry spacing is named explicitly so a
    // straight pull's box-dimension requirement can never share the phrase
    assert.strictEqual((t.match(/Minimum required entry spacing:/g) || []).length, 2,
      'each value carries an explicit noun');
    for (const sp of p.spacing) {
      assert.ok(t.includes(sp.minimumInches + '\u2033'), 'engine value rendered verbatim');
      assert.ok(sp.connectionId, 'the presentation keeps engine connection identity');
    }
    assert.ok(!/[*]|Math\./.test(fn3d('pbv23dResultHtml')), 'no arithmetic in the renderer');
  });

  test('IDENTITY: the same number and colour link drawing to results', () => {
    const s = api.build('standard');
    const { html: h, presentation: p } = resultsFor(s);
    const svg = api.svg(s, {});
    for (const conn of s.connections) {
      const num = api.connNumber(s, conn.id);
      const col = api.connColor(s, conn.id);
      assert.ok(new RegExp('class="p3d-connnum" data-conn="' + conn.id
        + '"[^>]*stroke="' + col + '"').test(svg), 'badge on the route for ' + conn.id);
      assert.ok(new RegExp('data-conn="' + conn.id + '"[^>]*stroke="' + col + '"')
        .test(svg), 'route wears the same colour');
      const sp = p.spacing.find((x) => x.connectionId === conn.id);
      if (!sp) continue;
      const card = h.slice(h.indexOf('border-left:3px solid ' + col));
      assert.ok(card.indexOf('>' + num + '</span>') !== -1,
        'result card carries the same number ' + num);
    }
    // the badge text is present for every connection
    assert.strictEqual((svg.match(/class="p3d-connnum"/g) || []).length, s.connections.length);
  });

  test('IDENTITY: numbering is deterministic and independent of pull type', () => {
    const s = api.build('standard');
    const before = s.connections.map((c) => api.connNumber(s, c.id));
    const three = s.entries.find((e) => e.size === '3');
    api.setPos(s, three.id, 0.9);
    api.setRow(s, three.id, api.rowsFor(s, 'bottom')[0].id);
    resultsFor(s);
    assert.deepStrictEqual(s.connections.map((c) => api.connNumber(s, c.id)), before,
      'selection, position, row and calculation never reshuffle numbers');
    // two pulls of the SAME type get different numbers and colours
    const q = api.empty();
    const a = api.add(q, 'left', '2', api.nextId('e'));
    const b = api.add(q, 'right', '2', api.nextId('e'));
    const c = api.add(q, 'top', '2', api.nextId('e'));
    const d = api.add(q, 'bottom', '2', api.nextId('e'));
    const c1 = api.nextId('c'); const c2 = api.nextId('c');
    api.connect(q, a.id, b.id, c1);
    api.connect(q, c.id, d.id, c2);
    assert.strictEqual(api.connNumber(q, c1), 1);
    assert.strictEqual(api.connNumber(q, c2), 2);
    assert.notStrictEqual(api.connColor(q, c1), api.connColor(q, c2));
    assert.strictEqual(api.connColor(q, c1), api.PALETTE[0],
      'palette position follows order, never pull type');
  });

  test('a raceway in several pulls is identified separately in each result', () => {
    const s = api.empty();
    const hub = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const bt = api.add(s, 'bottom', '3', api.nextId('e'));
    api.connect(s, hub.id, t.id, api.nextId('c'));
    api.connect(s, hub.id, bt.id, api.nextId('c'));
    const { presentation: p } = resultsFor(s);
    assert.strictEqual(p.spacing.length, 2, 'each pull states its own requirement');
    assert.notStrictEqual(p.spacing[0].connectionId, p.spacing[1].connectionId);
    assert.strictEqual(api.entryColor(s, hub.id), api.NEUTRAL,
      'the shared hub never claims one relationship colour');
    assert.ok(api.svg(s, {}).includes('p3d-multiring'), 'and stays flagged as shared');
  });

  test('obsolete prototype messaging and drawing row labels are gone', () => {
    const t = text(resultsFor(api.build('rows')).html);
    assert.ok(!/rows are not modelled/i.test(t), 'the false row disclaimer is removed');
    assert.ok(!/rows are not modelled/i.test(P3D), 'and nowhere in the block');
    assert.ok(!/pbv2=1|Code references are not shown/i.test(t),
      'no dev messaging inside calculation results');
    const s = api.build('rows');
    const three = s.entries.find((e) => e.size === '3');
    for (const svg of [api.svg(s, {}), api.svg(s, { selected: three.id }),
      api.svg(s, { addMode: true })]) {
      assert.ok(!/>R\d<\/text>/.test(svg), 'no standalone R1/R2 text in the drawing');
    }
    assert.ok(api.svg(s, { selected: three.id }).includes('3&#8243;'),
      'the selected hub still identifies by trade size');
  });

  test('LAYOUT: results are clearly separated from the action controls', () => {
    // PBV2-12.3.2: the tiers are separate normal-flow blocks, each with its
    // own margin, and the results rule keeps its own separation + divider
    assert.ok(/\.p3d-res\{margin:18px 14px 140px;[^}]*padding-top:18px/.test(P3D),
      'explicit separation from the controls above');
    assert.ok(/\.p3d-tier\{[^}]*margin:0 14px 10px/.test(P3D), 'each tier owns its spacing');
    assert.ok(!/<table/.test(P3D), 'stacked cards, not a wide table');
    assert.ok(P3D.includes('max-width:430px'), 'phone width cap intact');
  });

  test('REGRESSION: engine boundary, add mode, rows, calculate, dense all intact', () => {
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/.test(code), 'no NEC arithmetic');
    assert.ok(!/"v":/.test(JSON.stringify(api.request(api.build('rows')))));
    assert.ok(fn3d('pbv23dTapWall').includes('if (!pbv23dAddMode'), 'add gating intact');
    assert.ok(fn3d('pbv23dGlobalsHtml').includes('pbv23dStartAdd()'), 'persistent ADD intact');
    assert.ok(fn3d('pbv23dSheetBody').includes('id="pbv2-3d-sheet-calc"'), 'sheet CALCULATE');
    assert.ok(fn3d('pbv23dSetEntryRow').includes('pbv23dDeleteRowIfEmpty'), 'row auto-clean');
    // the 26 -> 29 multi-row demo
    const s = api.build('rows');
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 26);
    const three = s.entries.find((e) => e.size === '3');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 29);
    // dense: all raceways plus one badge per relationship
    const d = api.build('dense');
    const dsvg = api.svg(d, {});
    assert.strictEqual((dsvg.match(/class="p3d-hub"/g) || []).length, 16);
    assert.strictEqual((dsvg.match(/class="p3d-hit"/g) || []).length, 16);
    assert.strictEqual((dsvg.match(/class="p3d-connnum"/g) || []).length, d.connections.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12.3.1 — persistent global CALCULATE
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12.3.1 — global CALCULATE', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  function bar(state, opts) {
    opts = opts || {};
    const src = [fn3d('pbv23dFindEntry'), fn3d('pbv23dRowsFor'), fn3d('pbv23dRowById'),
      fn3d('pbv23dRowIndex'), fn3d('pbv23dClassify'), fn3d('pbv23dConnTypeOf'),
      fn3d('pbv23dGlobalsHtml'), fn3d('pbv23dSelectionHtml'),
      fn3d('pbv23dBarHtml')].join('\n');
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('pbv23dSelected', 'pbv23dConnectFrom', 'pbv23dAddMode',
      'pbv23dPresentation', 'exports', src + ';exports.bar = pbv23dBarHtml;')(
      opts.selected || null, opts.connectFrom || null, !!opts.addMode,
      opts.presentation || null, out);
    return out.bar(state);
  }
  const hasCalc = (h) => /id="pbv2-3d-calc"[^>]*onclick="pbv23dCalculate\(\)"/.test(h);
  const hasAdd = (h) => /id="pbv2-3d-add"[^>]*onclick="pbv23dStartAdd\(\)"/.test(h);

  test('CALCULATE and ADD are present in every normal state, in every fixture', () => {
    for (const key of ['standard', 'rows', 'dense']) {
      const s = api.build(key);
      const idle = bar(s, {});
      assert.ok(hasCalc(idle), key + ': CALCULATE with no selection');
      assert.ok(hasAdd(idle), key + ': ADD with no selection');
      // selecting a raceway must not remove either global action
      for (const e of s.entries.slice(0, 4)) {
        const sel = bar(s, { selected: e.id });
        assert.ok(hasCalc(sel), key + ': CALCULATE survives selection of ' + e.id);
        assert.ok(hasAdd(sel), key + ': ADD survives selection of ' + e.id);
      }
    }
  });

  test('global actions and selection actions form a clear two-tier hierarchy', () => {
    const s = api.build('rows');
    const sel = bar(s, { selected: s.entries[0].id });
    // tier 1: box-level actions, in their own container
    const globalsTier = fn3d('pbv23dGlobalsHtml');
    assert.ok(globalsTier.includes('pbv23dStartAdd()') && globalsTier.includes('pbv23dCalculate()'));
    assert.ok(!globalsTier.includes('pbv23dDeleteSelected()'),
      'selection actions are not mixed into the global tier');
    assert.ok(!fn3d('pbv23dSelectionHtml').includes('pbv23dCalculate()'),
      'and global actions are not duplicated into the selection tier');
    // tier 2: the summary and the per-raceway actions come after
    assert.ok(sel.indexOf('p3d-globals') < sel.indexOf('pbv23dOpenSheet()'),
      'global actions render above selection actions');
    for (const action of ['pbv23dOpenSheet()', 'pbv23dStartConnect()',
      'pbv23dDeleteSelected()']) {
      assert.ok(sel.includes(action), 'selection action still present: ' + action);
    }
    // the summary is its own flex line inside the selection tier
    assert.ok(fn3d('pbv23dSelectionHtml').includes('class="p3d-barlabel"'));
    assert.ok(/\.p3d-barlabel\{[^}]*flex:1 1 100%/.test(P3D),
      'the summary takes its own line on a phone');
  });

  test('the instruction can never appear without a usable CALCULATE', () => {
    // results say "Tap CALCULATE to size this box" exactly when no result is
    // present — and in that same state the bar must offer CALCULATE
    const s = api.build('standard');
    const idle = bar(s, { presentation: null });
    assert.ok(hasCalc(idle), 'a calculate action exists whenever the prompt shows');
    assert.ok(idle.includes('>CALCULATE<'), 'and it is labelled CALCULATE');
    const sel = bar(s, { selected: s.entries[0].id, presentation: null });
    assert.ok(hasCalc(sel), 'including while a raceway is selected — the Dense defect');
    assert.ok(fn3d('pbv23dResultHtml').includes('Tap CALCULATE to size this box'),
      'the prompt wording is unchanged');
  });

  test('label reflects whether a result is already on screen', () => {
    const s = api.build('standard');
    assert.ok(bar(s, {}).includes('>CALCULATE<'), 'no result yet');
    assert.ok(bar(s, { presentation: { state: 'OK' } }).includes('>RECALCULATE<'),
      'a result is showing');
    // after an edit invalidates, the label returns to CALCULATE
    assert.ok(bar(s, { presentation: null }).includes('>CALCULATE<'));
  });

  test('incomplete gestures own the bar, and hand it straight back', () => {
    const s = api.build('standard');
    const adding = bar(s, { addMode: true });
    assert.ok(!hasCalc(adding) && !hasAdd(adding), 'placement is exclusive');
    assert.ok(adding.includes('pbv23dCancelAdd()'));
    const connecting = bar(s, { connectFrom: s.entries[0].id });
    assert.ok(!hasCalc(connecting), 'connecting is exclusive');
    assert.ok(connecting.includes('pbv23dCancelConnect()'));
    // exiting either mode restores the globals immediately (same render path)
    assert.ok(hasCalc(bar(s, {})) && hasAdd(bar(s, {})));
    assert.ok(fn3d('pbv23dCancelAdd').includes('pbv23dRender()'));
    assert.ok(fn3d('pbv23dCancelConnect').includes('pbv23dRender()'));
    assert.ok(fn3d('pbv23dTapEntry').includes('pbv23dRender()'),
      'a completed connection re-renders, restoring the globals');
  });

  test('an empty box keeps the control, disabled and deterministic', () => {
    const empty = api.build('empty');
    const h = bar(empty, {});
    assert.ok(hasAdd(h), 'ADD is the useful action on an empty box');
    assert.ok(/id="pbv2-3d-calc"[^>]*disabled/.test(h),
      'CALCULATE stays structurally present but disabled');
    // and becomes enabled as soon as there is something to size
    const s = api.empty();
    api.add(s, 'left', '2', api.nextId('e'));
    assert.ok(!/id="pbv2-3d-calc"[^>]*disabled/.test(bar(s, {})));
  });

  test('both CALCULATE controls share one engine path and one call site', () => {
    assert.ok(fn3d('pbv23dGlobalsHtml').includes('onclick="pbv23dCalculate()"'), 'global tier');
    assert.ok(fn3d('pbv23dSheetBody').includes('onclick="pbv23dCalculate()"'), 'editor sheet');
    const calc = fn3d('pbv23dCalculate');
    assert.ok(calc.includes('pbv23dEngineRequest(PBV23D)') && calc.includes('pbv23dPresent('));
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1,
      'still exactly one engine call site');
    assert.ok(!/[*]|Math\./.test(calc), 'no arithmetic in the calculate handler');
  });

  test('REGRESSION: results, numbering and engine behaviour unchanged', () => {
    // stale-then-recalculate flow
    const s = api.build('rows');
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 26);
    const three = s.entries.find((e) => e.size === '3');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 29);
    // numbering and colours untouched
    for (const c of s.connections) {
      assert.ok(api.connNumber(s, c.id) > 0);
      assert.ok(api.PALETTE.includes(api.connColor(s, c.id)));
    }
    // drawing invariants
    const d = api.build('dense');
    const svg = api.svg(d, { selected: d.entries[0].id });
    assert.strictEqual((svg.match(/class="p3d-hub"/g) || []).length, 16);
    assert.strictEqual((svg.match(/class="p3d-hit"/g) || []).length, 16);
    assert.ok(!/>R\d<\/text>/.test(svg), 'no row labels on the drawing');
    assert.ok(svg.includes(d.entries[0].size + '&#8243;'), 'hub label is trade size');
    // context summary keeps row identity
    assert.ok(/R\d/.test(bar(d, { selected: d.entries[0].id })));
    // engine boundary
    assert.ok(!/"v":/.test(JSON.stringify(api.request(s))));
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/
      .test(P3D.slice(P3D.indexOf('<style>'))
        .replace(/function pbv23dDim\([\s\S]*?\n\}/, '')), 'no NEC arithmetic');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12.3.2 — mobile action / results layout (structural guards)
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12.3.2 — stacked layout cannot overlap', () => {
  const api = api3d();
  const styles = P3D.slice(P3D.indexOf('<style>'), P3D.indexOf('</style>'));
  const markup = P3D.slice(P3D.indexOf('</style>'), P3D.indexOf('<script>'));
  const rule = (sel) => {
    const m = styles.match(new RegExp(sel.replace('.', '\\.') + '\\{([^}]*)\\}', 'g'));
    return m ? m.join(' ') : '';
  };

  test('the four sections are separate containers in document order', () => {
    const order = ['id="pbv2-3d-stage"', 'id="pbv2-3d-globals"',
      'id="pbv2-3d-selection"', 'id="pbv2-3d-result"'];
    let last = -1;
    for (const id of order) {
      const at = markup.indexOf(id);
      assert.ok(at !== -1, 'missing container: ' + id);
      assert.ok(at > last, 'out of document order: ' + id);
      last = at;
    }
    // and they are siblings, not nested inside one another
    assert.ok(/<div class="p3d-tier" id="pbv2-3d-globals"><\/div>/.test(markup),
      'globals tier is its own empty container');
    assert.ok(/<div class="p3d-tier p3d-sel" id="pbv2-3d-selection"><\/div>/.test(markup),
      'selection tier is its own empty container');
  });

  test('no positional hacks on any stacked section', () => {
    for (const sel of ['.p3d-tier', '.p3d-sel', '.p3d-res', '.p3d-globals',
      '.p3d-barlabel', '.p3d-card']) {
      const css = rule(sel);
      assert.ok(!/position:\s*(absolute|fixed)/.test(css), sel + ' must stay in flow');
      assert.ok(!/margin[^;]*:-|:\s*-\d/.test(css), sel + ' must not use negative margins');
      assert.ok(!/transform|translate/.test(css), sel + ' must not be translated');
      assert.ok(!/(^|;|\{)\s*height:\s*\d/.test(css), sel + ' must keep intrinsic height');
      assert.ok(!/overflow:\s*hidden/.test(css), sel + ' must not clip its content');
    }
    // whatever absolute/fixed positioning exists in the block must not be on
    // any of the stacked sections (checked above); the overlay itself is a
    // fixed full-screen panel by design, which is what contains the flow
    const positioned = styles.match(/[^{}]+\{[^}]*position:\s*(?:absolute|fixed)[^}]*\}/g) || [];
    for (const decl of positioned) {
      const selector = decl.slice(0, decl.indexOf('{'));
      assert.ok(!/p3d-tier|p3d-sel|p3d-res|p3d-globals|p3d-barlabel|p3d-card/.test(selector),
        'a stacked section must never be positioned: ' + selector.trim());
    }
  });

  test('each tier has intrinsic height, its own spacing, and wraps safely', () => {
    const tier = rule('.p3d-tier');
    assert.ok(/display:flex/.test(tier) && /flex-wrap:wrap/.test(tier), 'wraps rather than overflows');
    assert.ok(/row-gap:8px/.test(tier), 'wrapped lines get real vertical gap');
    assert.ok(/margin:0 14px 10px/.test(tier), 'explicit bottom spacing to the next section');
    assert.ok(!/min-height/.test(tier), 'height follows content');
    // an empty selection tier collapses entirely rather than leaving a gap
    assert.ok(/\.p3d-tier:empty\{[^}]*display:none/.test(styles));
  });

  test('results start after the controls, with their own divider', () => {
    const res = rule('.p3d-res');
    assert.ok(/margin:18px 14px 140px/.test(res), 'clear separation above, room below');
    assert.ok(/border-top:1px solid/.test(res), 'the divider belongs to the results section');
    assert.ok(/padding-top:18px/.test(res), 'the heading does not sit on the divider');
    assert.ok(/140px/.test(res), 'bottom padding clears Safari chrome');
    assert.ok(!/position|height:\s*\d/.test(res), 'results grow with content');
  });

  test('controls wrap instead of overflowing at narrow widths', () => {
    // global tier: two buttons that can flex down and wrap
    const globals = rule('.p3d-globals');
    assert.ok(/flex-wrap:wrap/.test(globals), 'ADD and CALCULATE may wrap to two lines');
    assert.ok(/flex:1 1 130px/.test(styles), 'each global button has a sane basis');
    // summary always takes its own line and wraps long values
    const label = rule('.p3d-barlabel');
    assert.ok(/flex:1 1 100%/.test(label), 'summary is a full line');
    assert.ok(/overflow-wrap:anywhere/.test(label), 'long summaries wrap, never overflow');
    assert.ok(!/white-space:\s*nowrap/.test(label), 'summary is never forced onto one line');
    assert.ok(!/text-overflow/.test(label), 'summary is not truncated into ambiguity');
    // touch targets are not shrunk to force a single row
    assert.ok(/\.p3d-btn\{[^}]*min-height:44px/.test(styles), 'buttons stay tappable');
  });

  test('long summaries stay contained at every target width', () => {
    // the longest realistic summary: 1-1/4 inch, longest wall, row, pull type
    const s = api.empty();
    const e = api.add(s, 'right', '1-1/4', api.nextId('e'));
    const l = api.add(s, 'left', '4', api.nextId('e'));
    api.connect(s, e.id, l.id, api.nextId('c'));
    const sel = fn3d('pbv23dSelectionHtml');
    assert.ok(sel.includes('class="p3d-barlabel"'), 'summary uses the wrapping label');
    // no fixed pixel width is assumed anywhere for the summary
    assert.ok(!/width:\s*\d+px/.test(rule('.p3d-barlabel')));
    // 320 / 375 / 390 / 430: the layout is width-agnostic by construction —
    // percentage/flex-basis only, no media queries with fixed breakpoints
    for (const px of [320, 375, 390, 430]) {
      assert.ok(!new RegExp('@media[^{]*' + px).test(styles),
        'no width-specific layout branch for ' + px + 'px');
    }
    // a max-width cap is fine; a fixed width on a container is not
    assert.ok(!/(^|[;{\s])width:\s*\d{3}px/.test(styles),
      'no fixed pixel container widths');
    assert.ok(/max-width:430px/.test(styles), 'the stage keeps its phone-width cap');
  });

  test('the same structure serves before and after calculation', () => {
    const render = fn3d('pbv23dRender');
    for (const id of ['pbv2-3d-globals', 'pbv2-3d-selection', 'pbv2-3d-result']) {
      assert.ok(render.includes(id), 'render fills ' + id + ' every time');
    }
    assert.ok(!/style\.|classList\.add\('p3d-res/.test(render),
      'render never repositions sections');
    // the results container is the same element in both states
    assert.ok(fn3d('pbv23dResultHtml').includes('Tap CALCULATE to size this box'));
    assert.ok(fn3d('pbv23dResultHtml').includes('REQUIRED BOX SIZE'));
  });

  test('DENSE + selection + result: every section renders its own content', () => {
    const s = api.build('dense');
    const engine = require('../src/calc/pullBox');
    const consts = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dFindEntry',
      'pbv23dClassify', 'pbv23dConnTypeOf', 'pbv23dConnColor', 'pbv23dConnNumber',
      'pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dIn', 'pbv23dAxisRow',
      'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dResultHtml', 'pbv23dGlobalsHtml', 'pbv23dSelectionHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'pbv23dSelected', 'pbv23dConnectFrom', 'pbv23dAddMode', 'exports',
      'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var PBV23D_ERROR_TEXT = {};\n' + consts + names.map(fn3d).join('\n') + `
      exports.run = function (state) {
        PBV23D = state;
        pbv23dPresentation = pbv23dPresent(
          EC.pullBox.calculatePullBox(pbv23dEngineRequest(state)));
        return { globals: pbv23dGlobalsHtml(state), selection: pbv23dSelectionHtml(state),
          results: pbv23dResultHtml() };
      };`)({ pullBox: engine }, s.entries[0].id, null, false, out);
    const r = out.run(s);
    // tier 1: both global actions, no selection actions
    assert.ok(r.globals.includes('pbv23dStartAdd()') && r.globals.includes('pbv23dCalculate()'));
    assert.ok(!r.globals.includes('pbv23dDeleteSelected()'));
    // tier 2: summary plus the three selection actions, no global actions
    assert.ok(/\d\u2033 \u00B7 [A-Z]+ \u00B7 R\d/.test(r.selection.replace(/<[^>]+>/g, '')),
      'summary reads size, wall, row: ' + r.selection.replace(/<[^>]+>/g, ' ').trim());
    for (const a of ['pbv23dOpenSheet()', 'pbv23dStartConnect()', 'pbv23dDeleteSelected()']) {
      assert.ok(r.selection.includes(a));
    }
    assert.ok(!r.selection.includes('pbv23dCalculate()'), 'no duplicated global action');
    // tier 3: real results, independent of the tiers above
    assert.ok(r.results.includes('REQUIRED BOX SIZE'));
    assert.ok(r.results.includes('PULL REQUIREMENTS'),
      'dense fixture lists a card for every numbered pull');
    assert.ok(!r.results.includes('pbv23dOpenSheet()'), 'controls never leak into results');
  });

  test('REGRESSION: semantics, numbering and engine integration untouched', () => {
    const engine = require('../src/calc/pullBox');
    const s = api.build('rows');
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 26);
    const three = s.entries.find((e) => e.size === '3');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 29);
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/.test(code));
    assert.ok(!/"v":/.test(JSON.stringify(api.request(s))));
    const d = api.build('dense');
    const svg = api.svg(d, { selected: d.entries[0].id });
    assert.strictEqual((svg.match(/class="p3d-hub"/g) || []).length, 16);
    assert.strictEqual((svg.match(/class="p3d-connnum"/g) || []).length, d.connections.length);
    assert.ok(fn3d('pbv23dTapWall').includes('if (!pbv23dAddMode'));
    assert.ok(fn3d('pbv23dSheetBody').includes('id="pbv2-3d-sheet-calc"'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12.3.3 — complete pull requirements presentation
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12.3.3 — every numbered pull has a result card', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  /** Runs the SHIPPED adapter + result renderer against the real engine. */
  function ui() {
    const consts = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex',
      'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dFindEntry', 'pbv23dNextPosition',
      'pbv23dAddEntry', 'pbv23dAddConnection', 'pbv23dClassify', 'pbv23dConnColor',
      'pbv23dConnNumber', 'pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dIn',
      'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dResultHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'exports',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var PBV23D_ERROR_TEXT = {};\n' + consts + names.map(fn3d).join('\n') + `
      exports.empty = pbv23dEmptyState; exports.add = pbv23dAddEntry;
      exports.conn = pbv23dAddConnection; exports.nextId = pbv23dNextId;
      exports.run = function (s) {
        PBV23D = s;
        pbv23dPresentation = pbv23dPresent(
          EC.pullBox.calculatePullBox(pbv23dEngineRequest(s)));
        return { html: pbv23dResultHtml(), p: pbv23dPresentation };
      };`)({ pullBox: engine, pullBoxLayout: require('../src/layout/pullBoxLayout'),
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') }, out);
    return out;
  }
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  /** Numbers appearing in pull cards, in render order. */
  const cardNumbers = (h) => (h.match(/class="p3d-num"[^>]*>(\d+)</g) || [])
    .map((m) => Number(m.match(/>(\d+)<$/)[1]));

  function mixedThree(u) {
    const s = u.empty();
    const L2 = u.add(s, 'left', '2', u.nextId('e'));
    const La = u.add(s, 'left', '2', u.nextId('e'));
    const R2 = u.add(s, 'right', '2', u.nextId('e'));
    const T2 = u.add(s, 'top', '2', u.nextId('e'));
    const B1 = u.add(s, 'bottom', '3', u.nextId('e'));
    const B2 = u.add(s, 'bottom', '3', u.nextId('e'));
    u.conn(s, La.id, T2.id, u.nextId('c'));   // 1 ANGLE
    u.conn(s, B1.id, B2.id, u.nextId('c'));   // 2 U
    u.conn(s, L2.id, R2.id, u.nextId('c'));   // 3 STRAIGHT
    return s;
  }

  test('ENGINE AUDIT: each pull type maps back to a requirement by identity', () => {
    const u = ui();
    const s = mixedThree(u);
    const result = engine.calculatePullBox(
      (() => { const o = ui(); o.run(s); return o; }) && api.request(s));
    // STRAIGHT: its own requirement carrying connectionId
    const straight = result.widthRequirements.concat(result.heightRequirements)
      .find((r) => r.kind === 'STRAIGHT');
    assert.ok(straight.connectionId, 'straight requirement names its connection');
    assert.ok(s.connections.some((c) => c.id === straight.connectionId));
    // ANGLE/U: entry spacing carrying connectionId
    for (const sp of result.spacingRequirements) {
      assert.ok(sp.connectionId, 'spacing names its connection');
      assert.ok(['ANGLE', 'U'].includes(sp.connectionType));
    }
    // ANGLE_U_ROW: shared, identified by triggerConnectionIds — never by one id
    const row = result.widthRequirements.concat(result.heightRequirements)
      .find((r) => r.kind === 'ANGLE_U_ROW');
    assert.ok(Array.isArray(row.triggerConnectionIds) && row.triggerConnectionIds.length > 0);
    assert.strictEqual(row.connectionId, undefined,
      'a row rule belongs to a row, not to a single pull');
  });

  test('THREE-PULL FIXTURE: 3 numbered routes produce 3 numbered cards', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h } = u.run(s);
    assert.deepStrictEqual(cardNumbers(h), [1, 2, 3],
      'every numbered pull appears exactly once, in order');
    const t = text(h);
    assert.ok(t.includes('PULL REQUIREMENTS'), 'the section is no longer spacing-only');
    assert.ok(!t.includes('ENTRY SPACING'), 'the old spacing-only heading is gone');
    assert.ok(t.includes('ANGLE PULL') && t.includes('U PULL') && t.includes('STRAIGHT PULL'));
    // and the drawing carries the same three badges
    const svg = api.svg(s, {});
    assert.strictEqual((svg.match(/class="p3d-connnum"/g) || []).length, 3);
  });

  test('STRAIGHT card uses the box-dimension noun, never entry spacing', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h, p } = u.run(s);
    const straightConn = s.connections[2];
    const slot = p.byConnection[straightConn.id];
    assert.ok(slot.dimension, 'engine dimension requirement present for the straight pull');
    assert.strictEqual(slot.spacing, null, 'a straight pull produces no entry spacing');
    const card = h.slice(h.lastIndexOf('class="p3d-card"'));
    const t = text(card);
    assert.ok(t.includes('STRAIGHT PULL'));
    assert.ok(t.includes('Required minimum box dimension in pull direction: '
      + slot.dimension.minimumInches + '\u2033'), 'engine value with the correct noun: ' + t);
    assert.ok(!/entry spacing/i.test(t),
      'a straight pull is never labelled entry spacing');
  });

  test('ANGLE and U cards use entry spacing, plus shared row rules', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h, p } = u.run(s);
    for (const conn of [s.connections[0], s.connections[1]]) {
      const slot = p.byConnection[conn.id];
      assert.ok(slot.spacing, 'engine spacing requirement present');
      assert.strictEqual(slot.dimension, null, 'angle/U produce no straight requirement');
      assert.ok(slot.rows.length > 0, 'and they trigger row rules');
    }
    const t = text(h);
    assert.ok(t.includes('Minimum required entry spacing: 12\u2033'), 'angle spacing');
    assert.ok(t.includes('Minimum required entry spacing: 18\u2033'), 'U spacing');
    // PBV2-12.3.4: row-derived requirements speak as box-dimension contributions
    assert.ok(/Minimum box-dimension contribution: \d+\u2033 (width|height)/.test(t),
      'row-derived requirement in electrician language: ' + t);
  });

  test('one connection groups its distinct requirements into ONE card', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h } = u.run(s);
    const nums = cardNumbers(h);
    assert.strictEqual(new Set(nums).size, nums.length, 'no duplicated connection number');
    assert.strictEqual((h.match(/class="p3d-card"/g) || []).length, s.connections.length,
      'exactly one card per connection');
    // the angle card carries its spacing AND its two row lines together
    const firstCard = h.indexOf('class="p3d-card"');
    const angleCard = h.slice(firstCard, h.indexOf('class="p3d-card"', firstCard + 1));
    assert.ok((angleCard.match(/class="p3d-reqline"/g) || []).length >= 2,
      'grouped requirement lines rather than separate cards');
  });

  test('MULTIPLE STRAIGHT pulls each get their own card, even at equal values', () => {
    const u = ui();
    const s = u.empty();
    const a = u.add(s, 'left', '2', u.nextId('e'));
    const b = u.add(s, 'right', '2', u.nextId('e'));
    const c = u.add(s, 'top', '2', u.nextId('e'));
    const d = u.add(s, 'bottom', '2', u.nextId('e'));
    u.conn(s, a.id, b.id, u.nextId('c'));
    u.conn(s, c.id, d.id, u.nextId('c'));
    const { html: h, p } = u.run(s);
    assert.deepStrictEqual(cardNumbers(h), [1, 2]);
    const v1 = p.byConnection[s.connections[0].id].dimension.minimumInches;
    const v2 = p.byConnection[s.connections[1].id].dimension.minimumInches;
    assert.strictEqual(v1, v2, 'both require the same inches');
    assert.strictEqual((h.match(/class="p3d-card"/g) || []).length, 2,
      'equal values are still two separate pulls');
    const t = text(h);
    assert.ok(t.includes('2\u2033 LEFT \u2194 2\u2033 RIGHT'));
    assert.ok(t.includes('2\u2033 TOP \u2194 2\u2033 BOTTOM'));
  });

  test('single-type fixtures each report their own engine source', () => {
    // straight only
    let u = ui();
    let s = u.empty();
    let a = u.add(s, 'left', '4', u.nextId('e'));
    let b = u.add(s, 'right', '4', u.nextId('e'));
    u.conn(s, a.id, b.id, u.nextId('c'));
    let r = u.run(s);
    assert.ok(r.p.byConnection[s.connections[0].id].dimension);
    assert.ok(text(r.html).includes('STRAIGHT PULL'));
    // angle only
    u = ui(); s = u.empty();
    a = u.add(s, 'left', '2', u.nextId('e'));
    b = u.add(s, 'top', '2', u.nextId('e'));
    u.conn(s, a.id, b.id, u.nextId('c'));
    r = u.run(s);
    assert.ok(r.p.byConnection[s.connections[0].id].spacing);
    assert.ok(text(r.html).includes('ANGLE PULL'));
    // U only
    u = ui(); s = u.empty();
    a = u.add(s, 'bottom', '3', u.nextId('e'));
    b = u.add(s, 'bottom', '3', u.nextId('e'));
    u.conn(s, a.id, b.id, u.nextId('c'));
    r = u.run(s);
    assert.ok(r.p.byConnection[s.connections[0].id].spacing);
    assert.ok(text(r.html).includes('U PULL'));
    assert.deepStrictEqual(cardNumbers(r.html), [1]);
  });

  test('GOVERNING badges come from engine ids, not from comparing numbers', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h, p } = u.run(s);
    const result = engine.calculatePullBox(api.request(s));
    const straightSlot = p.byConnection[s.connections[2].id];
    assert.strictEqual(straightSlot.dimension.governs,
      straightSlot.dimension.id === result.governingWidthRequirementId,
      'governs flag is an id comparison against the engine');
    assert.ok(text(h).includes('GOVERNS WIDTH'));
    // no arithmetic anywhere in the presentation layer
    for (const f of ['pbv23dPresent', 'pbv23dPullCardHtml', 'pbv23dResultHtml']) {
      assert.ok(!/[*]\s*\d|\d\s*[*]|Math\.max|Math\.min/.test(fn3d(f)),
        f + ' must contain no arithmetic');
    }
  });

  test('endpoint text adds row identity only when it disambiguates', () => {
    const u = ui();
    const s = mixedThree(u);
    const t = text(u.run(s).html);
    // U pull: both endpoints on the bottom wall, so the row is shown
    assert.ok(/3\u2033 BOTTOM R\d \u2194 3\u2033 BOTTOM R\d/.test(t), 'same-wall shows rows: ' + t);
    // angle/straight: different walls already disambiguate, so no R clutter
    assert.ok(t.includes('2\u2033 LEFT \u2194 2\u2033 TOP'), 'cross-wall stays clean');
    assert.ok(t.includes('2\u2033 LEFT \u2194 2\u2033 RIGHT'));
  });

  test('SAFETY: a pull minimum is never promoted to the final box size', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h, p } = u.run(s);
    assert.strictEqual(p.width.kind, 'LAYOUT_DEPENDENT');
    const t = text(h);
    assert.ok(t.includes('NOT FULLY DETERMINED'), 'width stays honest');
    assert.ok(!h.includes('p3d-boxsize'), 'no W x H headline while unresolved');
    // the straight pull contributes 16" but that is not presented as the width
    assert.ok(t.includes('Required minimum box dimension in pull direction: 16\u2033'));
    assert.ok(!/WIDTH 16\u2033/.test(t), 'the pull minimum never becomes the width answer');
    assert.ok(t.indexOf('REQUIRED BOX SIZE') < t.indexOf('PULL REQUIREMENTS'),
      'box size stays primary, pull cards remain explanatory detail');
  });

  test('identity: number and colour still link drawing to each pull card', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h } = u.run(s);
    const svg = api.svg(s, {});
    for (let i = 0; i < s.connections.length; i++) {
      const conn = s.connections[i];
      const col = api.connColor(s, conn.id);
      const num = api.connNumber(s, conn.id);
      assert.strictEqual(num, i + 1);
      assert.ok(new RegExp('class="p3d-connnum" data-conn="' + conn.id
        + '"[^>]*stroke="' + col + '"').test(svg), 'route badge for ' + num);
      const card = h.slice(h.indexOf('border-left:3px solid ' + col));
      assert.ok(card.indexOf('>' + num + '</span>') !== -1, 'card ' + num + ' shares the colour');
    }
    // colour is not chosen by pull type: three different types here, three
    // palette positions in order
    assert.strictEqual(api.connColor(s, s.connections[0].id), api.PALETTE[0]);
    assert.strictEqual(api.connColor(s, s.connections[1].id), api.PALETTE[1]);
    assert.strictEqual(api.connColor(s, s.connections[2].id), api.PALETTE[2]);
  });

  test('REGRESSION: results hierarchy, layout and engine boundary intact', () => {
    const u = ui();
    const s = mixedThree(u);
    const t = text(u.run(s).html);
    assert.ok(t.startsWith('REQUIRED BOX SIZE'));
    assert.ok(!/\bMIN\b/.test(t), 'no naked MIN values returned');
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/.test(code), 'no NEC arithmetic');
    assert.ok(!/"v":/.test(JSON.stringify(api.request(api.build('rows')))));
    // layout tiers untouched
    assert.ok(/\.p3d-tier\{[^}]*row-gap:8px/.test(P3D));
    assert.ok(/\.p3d-res\{margin:18px 14px 140px/.test(P3D));
    // dense still renders one card per connection
    const d = api.build('dense');
    const du = ui();
    const dh = du.run(d).html;
    assert.strictEqual((dh.match(/class="p3d-card"/g) || []).length, d.connections.length);
    assert.deepStrictEqual(cardNumbers(dh), d.connections.map((c, i) => i + 1));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PBV2-12.3.4 — electrician-facing result language
// ═══════════════════════════════════════════════════════════════════════

describe('PBV2-12.3.4 — no engine vocabulary in the results', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  function ui() {
    const consts = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex',
      'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dFindEntry', 'pbv23dNextPosition',
      'pbv23dAddEntry', 'pbv23dAddConnection', 'pbv23dClassify', 'pbv23dConnColor',
      'pbv23dConnNumber', 'pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dIn',
      'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dResultHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'exports',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var PBV23D_ERROR_TEXT = {};\n' + consts + names.map(fn3d).join('\n') + `
      exports.empty = pbv23dEmptyState; exports.add = pbv23dAddEntry;
      exports.conn = pbv23dAddConnection; exports.nextId = pbv23dNextId;
      exports.run = function (s) {
        PBV23D = s;
        pbv23dPresentation = pbv23dPresent(
          EC.pullBox.calculatePullBox(pbv23dEngineRequest(s)));
        return { html: pbv23dResultHtml(), p: pbv23dPresentation };
      };`)({ pullBox: engine, pullBoxLayout: require('../src/layout/pullBoxLayout'),
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') }, out);
    return out;
  }
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const cardNumbers = (h) => (h.match(/class="p3d-num"[^>]*>(\d+)</g) || [])
    .map((m) => Number(m.match(/>(\d+)<$/)[1]));

  function mixedThree(u) {
    const s = u.empty();
    const L2 = u.add(s, 'left', '2', u.nextId('e'));
    const La = u.add(s, 'left', '2', u.nextId('e'));
    const R2 = u.add(s, 'right', '2', u.nextId('e'));
    const T2 = u.add(s, 'top', '2', u.nextId('e'));
    const B1 = u.add(s, 'bottom', '3', u.nextId('e'));
    const B2 = u.add(s, 'bottom', '3', u.nextId('e'));
    u.conn(s, La.id, T2.id, u.nextId('c'));
    u.conn(s, B1.id, B2.id, u.nextId('c'));
    u.conn(s, L2.id, R2.id, u.nextId('c'));
    return s;
  }
  /** Every fixture family this suite cares about, rendered. */
  function allRendered() {
    const out = [];
    const u1 = ui(); out.push(text(u1.run(mixedThree(u1)).html));
    for (const key of ['standard', 'rows', 'dense']) {
      const u = ui(); out.push(text(u.run(api.build(key)).html));
    }
    const u2 = ui(); const s2 = u2.empty();
    const a = u2.add(s2, 'left', '2', u2.nextId('e'));
    const b = u2.add(s2, 'right', '2', u2.nextId('e'));
    const c = u2.add(s2, 'top', '2', u2.nextId('e'));
    const d = u2.add(s2, 'bottom', '2', u2.nextId('e'));
    u2.conn(s2, a.id, b.id, u2.nextId('c')); u2.conn(s2, c.id, d.id, u2.nextId('c'));
    out.push(text(u2.run(s2).html));
    return out;
  }

  test('LANGUAGE: no engine or row-rule vocabulary reaches the user', () => {
    for (const t of allRendered()) {
      for (const banned of ['Triggers row requirement', 'row requirement', 'triggered',
        'ANGLE_U_ROW', 'ENTRY_SPACING', 'triggerConnectionIds', 'rowId', 'row rule',
        'dimensionStatus', 'governingWidthRequirementId', 'LAYOUT_DEPENDENT']) {
        assert.ok(!t.includes(banned), 'engine vocabulary leaked: "' + banned + '" in: ' + t);
      }
    }
    // and the old phrase is gone from the shipped renderer itself
    assert.ok(!/Triggers row requirement/.test(fn3d('pbv23dPullCardHtml')));
  });

  test('TRANSLATION: row-derived requirements read as box-dimension contributions', () => {
    const u = ui();
    const { html: h, p } = u.run(mixedThree(u));
    const t = text(h);
    // the angle pull triggers two rows on the engine side -> two plain lines
    const angle = p.byConnection[Object.keys(p.byConnection)[0]];
    for (const conn of Object.keys(p.byConnection)) {
      for (const row of p.byConnection[conn].rows) {
        assert.ok(t.includes('Minimum box-dimension contribution: '
          + row.minimumInches + '\u2033 ' + row.dimension),
          'each engine row requirement appears as a contribution: ' + row.minimumInches);
      }
    }
    assert.ok(angle.rows.length >= 1);
    assert.ok(t.includes('Minimum box-dimension contribution: 14\u2033 width'));
    assert.ok(t.includes('Minimum box-dimension contribution: 21\u2033 height'));
  });

  test('NOUNS: straight = box dimension in pull direction; angle/U = entry spacing', () => {
    const u = ui();
    const t = text(u.run(mixedThree(u)).html);
    assert.ok(t.includes('Required minimum box dimension in pull direction: 16\u2033'));
    assert.ok(t.includes('Minimum required entry spacing: 12\u2033'));
    assert.ok(t.includes('Minimum required entry spacing: 18\u2033'));
    // the straight card never carries the entry-spacing noun
    const straightCard = text((() => {
      const h = u.run(mixedThree(ui())).html;
      return h.slice(h.lastIndexOf('class="p3d-card"'));
    })());
    assert.ok(straightCard.includes('STRAIGHT PULL'));
    assert.ok(!/entry spacing/i.test(straightCard));
    assert.ok(!/\bMIN\b/.test(t), 'no naked MIN values');
  });

  test('SHARED contributions are stated plainly, only when the engine says shared', () => {
    // two angle pulls into the same left row share that row's requirement
    const u = ui();
    const s = u.empty();
    const a = u.add(s, 'left', '2', u.nextId('e'));
    const b = u.add(s, 'left', '3', u.nextId('e'));
    const t1 = u.add(s, 'top', '2', u.nextId('e'));
    const t2 = u.add(s, 'top', '2', u.nextId('e'));
    u.conn(s, a.id, t1.id, u.nextId('c'));
    u.conn(s, b.id, t2.id, u.nextId('c'));
    const { html: h, p } = u.run(s);
    const shared = Object.values(p.byConnection).some((slot) =>
      slot.rows.some((r) => r.sharedWith.length > 1));
    assert.ok(shared, 'the engine reports a requirement triggered by both pulls');
    const t = text(h);
    assert.ok(t.includes('(shared with another pull)'), 'honest, plain shared wording: ' + t);
    assert.ok(!/row/i.test(t.replace(/BOTTOM R\d|LEFT R\d|TOP R\d|RIGHT R\d/g, '')),
      'no row vocabulary beyond endpoint disambiguation');
    // a single-pull requirement never claims to be shared
    const u2 = ui();
    const t2s = text(u2.run(mixedThree(u2)).html);
    assert.ok(!t2s.includes('shared with'), 'no shared wording where nothing is shared');
    assert.ok(fn3d('pbv23dPullCardHtml').includes('row.sharedWith.length - 1'),
      'shared wording comes from the engine trigger list, not inference');
  });

  test('GOVERNING badges remain, still sourced from engine ids only', () => {
    const u = ui();
    const s = mixedThree(u);
    const { html: h, p } = u.run(s);
    const result = engine.calculatePullBox(api.request(s));
    const t = text(h);
    assert.ok(t.includes('GOVERNS WIDTH') && t.includes('GOVERNS HEIGHT'));
    for (const slot of Object.values(p.byConnection)) {
      if (slot.dimension) {
        assert.strictEqual(slot.dimension.governs,
          slot.dimension.id === result.governingWidthRequirementId
          || slot.dimension.id === result.governingHeightRequirementId);
      }
      for (const row of slot.rows) {
        assert.strictEqual(row.governs, row.id === result.governingWidthRequirementId
          || row.id === result.governingHeightRequirementId);
      }
    }
    for (const f of ['pbv23dPresent', 'pbv23dPullCardHtml', 'pbv23dResultHtml']) {
      assert.ok(!/[*]\s*\d|\d\s*[*]|Math\.max|Math\.min/.test(fn3d(f)), f + ' has no arithmetic');
    }
  });

  test('COMPLETENESS and PRIMARY RESULT unchanged', () => {
    const u = ui();
    const { html: h, p } = u.run(mixedThree(u));
    assert.deepStrictEqual(cardNumbers(h), [1, 2, 3], 'every numbered pull has its card');
    const t = text(h);
    assert.ok(t.startsWith('REQUIRED BOX SIZE'), 'box size stays first and primary');
    assert.strictEqual(p.width.kind, 'LAYOUT_DEPENDENT');
    assert.ok(t.includes('NOT FULLY DETERMINED'));
    assert.ok(t.includes('Known requirements:'));
    assert.ok(!h.includes('p3d-boxsize'), 'no W x H headline while unresolved');
    assert.ok(!/WIDTH 16\u2033|WIDTH 14\u2033/.test(t),
      'no per-pull contribution is promoted to the width answer');
    // multi-straight still two cards
    const u2 = ui(); const s2 = u2.empty();
    const a = u2.add(s2, 'left', '2', u2.nextId('e'));
    const b = u2.add(s2, 'right', '2', u2.nextId('e'));
    const c = u2.add(s2, 'top', '2', u2.nextId('e'));
    const d = u2.add(s2, 'bottom', '2', u2.nextId('e'));
    u2.conn(s2, a.id, b.id, u2.nextId('c')); u2.conn(s2, c.id, d.id, u2.nextId('c'));
    assert.deepStrictEqual(cardNumbers(u2.run(s2).html), [1, 2]);
  });

  test('COMPACT: cards stay short enough for a phone', () => {
    const u = ui();
    const h = u.run(mixedThree(u)).html;
    const cards = h.split('class="p3d-card"').slice(1);
    for (const c of cards) {
      const lines = (c.match(/class="p3d-reqline"/g) || []).length;
      assert.ok(lines <= 3, 'a card carries at most three requirement lines, got ' + lines);
      assert.ok(!/Derived from|because|therefore/i.test(text(c)), 'no explanatory paragraphs');
    }
    assert.ok(/\.p3d-muted\{[^}]*font-size:11px/.test(P3D), 'shared note is visually secondary');
  });

  test('REGRESSION: layout, identity, engine boundary all intact', () => {
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/.test(code), 'no NEC arithmetic');
    assert.ok(!/"v":/.test(JSON.stringify(api.request(api.build('rows')))));
    assert.ok(/\.p3d-tier\{[^}]*row-gap:8px/.test(P3D), 'stacking architecture intact');
    assert.ok(fn3d('pbv23dGlobalsHtml').includes('pbv23dStartAdd()')
      && fn3d('pbv23dGlobalsHtml').includes('pbv23dCalculate()'), 'persistent globals');
    assert.ok(fn3d('pbv23dSheetBody').includes('id="pbv2-3d-sheet-calc"'));
    const s = api.build('rows');
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 26);
    const three = s.entries.find((e) => e.size === '3');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 29);
    const d = api.build('dense');
    const svg = api.svg(d, {});
    assert.strictEqual((svg.match(/class="p3d-connnum"/g) || []).length, d.connections.length);
    for (const c of d.connections) assert.ok(api.PALETTE.includes(api.connColor(d, c.id)));
  });
});
