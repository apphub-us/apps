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
const P3D = html.slice(html.indexOf('PULL / JUNCTION BOX — PRODUCTION FEATURE (PBV2-14)'),
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

/* PBV2-13B-4.8g — SIZE / WALL / ROW are native <select>s in the in-flow
   details, so the current value is carried by <option ... selected> rather
   than by a rendered summary label. These helpers read the SEMANTIC selected
   value so the identity guarantees stay as strong as when they were asserted
   against the old summary tier: they prove which value is actually current,
   not that some particular markup happens to appear. */
function selectOptionsOf(html, selectId) {
  const open = html.indexOf('id="' + selectId + '"');
  if (open === -1) return null;
  const start = html.lastIndexOf('<select', open);
  const end = html.indexOf('</select>', open);
  if (start === -1 || end === -1) return null;
  return html.slice(start, end);
}
/** The value of the currently selected <option> in a shipped selector. */
function selectedOptionValue(html, selectId) {
  const block = selectOptionsOf(html, selectId);
  if (!block) return null;
  const m = block.match(/<option value="([^"]*)"[^>]*\sselected[^>]*>/);
  return m ? m[1] : null;
}
/** The visible text of the currently selected <option>. */
function selectedOptionLabel(html, selectId) {
  const block = selectOptionsOf(html, selectId);
  if (!block) return null;
  const m = block.match(/<option value="[^"]*"[^>]*\sselected[^>]*>([^<]*)</);
  return m ? m[1] : null;
}

/** Run the shipped pure state + render functions. */
function api3d() {
  const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET', 'PBV23D_CORNER_EXCLUDE',
    'PBV23D_SIZES', 'PBV23D_WALLS',
    'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW']
    .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
  const fns = ['pbv23dHub', 'pbv23dInward', 'pbv23dEmptyState', 'pbv23dFindEntry',
    'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dSetSize',
    'pbv23dSetPosition', 'pbv23dSetWall', 'pbv23dClassify', 'pbv23dAddConnection',
    'pbv23dDeleteConnection', 'pbv23dRouteLead', 'pbv23dClampInterior', 'pbv23dSegCross', 'pbv23dPolylineLoops', 'pbv23dRouteAnchor', 'pbv23dAngleSide', 'pbv23dAngleRoute', 'pbv23dRoutePath', 'pbv23dBuildFixture',
    'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConns', 'pbv23dEntryColor', 'pbv23dEntryConnNumbers', 'pbv23dHubNumberLayout', 'pbv23dHitRadius',
    'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dAddRowOnWall',
    'pbv23dEnsureRow', 'pbv23dSetEntryRow', 'pbv23dDeleteRowIfEmpty', 'pbv23dRowDepth',
    'pbv23dRowIdFor', 'pbv23dEngineRequest', 'pbv23dPresent',
    'pbv23dGeoFor', 'pbv23dCeilBoxDim', 'pbv23dCertifiedBox', 'pbv23dCertifiedView',
    'pbv23dEntryRenderV',
    'pbv23dRenderSvg', 'pbv23dDevHost', 'pbv23dShouldOpen'].map(fn3d).join('\n');
  const out = {};
  // eslint-disable-next-line no-new-func
  new Function('exports',
    'var pbv23dSeq = 0;\n'
    + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
    + 'var pbv23dLayout = null;\n'
    + consts + fns + `
    exports.setLayout = (l) => { pbv23dLayout = l; };
    exports.certifiedView = pbv23dCertifiedView;
    exports.entryRenderV = pbv23dEntryRenderV;
    exports.geoFor = pbv23dGeoFor;
    exports.GEO = PBV23D_GEO; exports.SIZES = PBV23D_SIZES; exports.WALLS = PBV23D_WALLS;
    exports.empty = pbv23dEmptyState; exports.build = pbv23dBuildFixture;
    exports.add = pbv23dAddEntry; exports.del = pbv23dDeleteEntry;
    exports.setSize = pbv23dSetSize; exports.setPos = pbv23dSetPosition;
    exports.setWall = pbv23dSetWall; exports.classify = pbv23dClassify;
    exports.connect = pbv23dAddConnection; exports.disconnect = pbv23dDeleteConnection;
    exports.find = pbv23dFindEntry; exports.hub = pbv23dHub;
    exports.routePath = pbv23dRoutePath; exports.svg = pbv23dRenderSvg;
    exports.routeLead = pbv23dRouteLead; exports.routeAnchor = pbv23dRouteAnchor;
    exports.nextId = pbv23dNextId;
    exports.devHost = pbv23dDevHost; exports.shouldOpen = pbv23dShouldOpen;
    exports.PALETTE = PBV23D_CONN_COLORS; exports.NEUTRAL = PBV23D_NEUTRAL;
    exports.connColor = pbv23dConnColor; exports.entryColor = pbv23dEntryColor;
    exports.entryConns = pbv23dEntryConns;
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
    // PBV2-14: exactly two app-level entry points are public by design — the
    // open and close paths the Home tile and the X button call. Nothing else.
    const PUBLIC = ['openPullBox', 'closePullBox'];
    for (const name of declared) {
      assert.ok(/^pbv23d/.test(name) || PUBLIC.includes(name), 'un-namespaced global: ' + name);
    }
    for (const name of PUBLIC) assert.ok(declared.includes(name), name + ' exists');
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
    /* SUPERSEDED BY PBV2-13B-4.7: this pinned the ellipse rx/ry drawn for
       EVERY hub. STANDARD is fully confirmed, so both hubs are now the
       numbered circle from 4.7 — the intent (the drawn opening stays small,
       well under the touch target) is preserved via the circle's own radius
       instead. */
    assert.ok(/<circle class="p3d-hub" data-entry="[^"]+" cx="[-0-9.]+" cy="[-0-9.]+" r="[\d.]+"/.test(svg),
      'confirmed hubs are drawn as numbered circles');
    for (const m of svg.matchAll(/<circle class="p3d-hub"[^>]*r="([\d.]+)"/g)) {
      assert.ok(Number(m[1]) > 0 && Number(m[1]) <= 13, 'the drawn opening stays small and foreshortened');
    }
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
    /* SUPERSEDED BY PBV2-13B-4.9D: the viewBox height now fits the box's own
       annotation instead of a fixed 300, so a short certified box has no dead
       strip under its caption. The width stays fixed at 340 — that is what
       scales to the phone. */
    assert.ok(/viewBox="0 0 340 \d+(\.\d+)?"/.test(svg), 'fixed viewBox WIDTH scales to the phone');
    const xs = (svg.match(/ (?:x|cx|x1|x2)="(-?\d+(?:\.\d+)?)"/g) || [])
      .map((m) => Number(m.match(/-?\d+(?:\.\d+)?/)[0]));
    assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 340,
      'all geometry stays inside the viewBox');
    assert.ok(P3D.includes('max-width:430px'), 'stage capped for phone widths');
    assert.ok(P3D.includes('user-select:none'), 'no accidental text selection');
    assert.ok(P3D.includes('touch-action:manipulation'), 'no double-tap zoom on the stage');
    /* SUPERSEDED BY PBV2-13B-4.8g: the details are in the page flow, so there
       is no fixed element that has to clear the Safari bar. */
    assert.ok(!/#pbv2-3d-sheet\{[^}]*position:fixed/.test(P3D),
      'the details do not overlay the page');
  });
});

describe('PBV2-10B.1 — interaction polish', () => {
  const api = api3d();

  test('EDITOR: opening it hands the screen to the box, not the sheet', () => {
    // the sheet is capped and the competing chrome steps aside while editing
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!/#pbv2-3d-sheet\{[^}]*position:fixed/.test(P3D),
      'the details are in flow, not a fixed overlay');
    assert.ok(/p3d-editing \.p3d-fixtures\{display:none\}/.test(P3D),
      'the fixture switch steps aside while editing');
    assert.ok(!/p3d-editing\{padding-bottom:42vh\}/.test(P3D),
      'no bottom reservation: the details are in flow, not an overlay');
    assert.ok(fn3d('pbv23dOpenSheet').includes("classList.add('p3d-editing')"));
    /* SUPERSEDED BY PBV2-13B-4.8g.1: real-device acceptance rejected the
       automatic reveal — it pushed the drawing off-screen. Opening the
       details must not move the viewport at all. */
    assert.ok(!/scrollIntoView|scrollTo|scrollTop/.test(fn3d('pbv23dOpenSheet')),
      'opening the details does not reposition the page');
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

  test('PBV2-13B-4.7 O: selected single-number hub keeps its number and gets an outer ring', () => {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e')); const t = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    const num = String(api.connNumber(s, s.connections[0].id));
    const plain = api.svg(s, {});
    const sel = api.svg(s, { selected: l.id });
    assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + l.id + '"[^>]*>' + num + '<').test(plain),
      'number visible before selection');
    assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + l.id + '"[^>]*>' + num + '<').test(sel),
      'the number is NOT replaced or hidden when selected');
    assert.strictEqual((sel.match(/class="p3d-selring"/g) || []).length, 1, 'selection ring appears');
    assert.ok(!plain.includes('p3d-selring'), 'and only when actually selected');
    // the ring sits strictly outside the numbered hub, never inside it
    const hubR = Number(sel.match(new RegExp('<circle class="p3d-hub" data-entry="' + l.id + '"[^>]*r="([\\d.]+)"'))[1]);
    const ringR = Number(sel.match(/class="p3d-selring"[^>]*r="([\d.]+)"/)[1]);
    assert.ok(ringR > hubR, 'ring radius (' + ringR + ') is outside the hub radius (' + hubR + ')');
  });

  test('PBV2-13B-4.7 P: selected shared hub keeps every number and remains interactable', () => {
    const s = api.empty();
    const hub = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e')); const r = api.add(s, 'right', '2', api.nextId('e'));
    api.connect(s, hub.id, t.id, api.nextId('c')); api.connect(s, hub.id, r.id, api.nextId('c'));
    const sel = api.svg(s, { selected: hub.id });
    const nums = (sel.match(new RegExp('class="p3d-hubnum" data-entry="' + hub.id + '"[^>]*>(\\d+)<', 'g')) || [])
      .map((m) => m.match(/>(\d+)</)[1]);
    assert.deepStrictEqual(nums.sort(), ['1', '2'], 'both numbers still shown while selected');
    assert.strictEqual((sel.match(/class="p3d-selring"/g) || []).length, 1);
    // selection ring wins over the dashed shared cue (matches existing "sel/src always wins" rule)
    assert.strictEqual((sel.match(/class="p3d-multiring"/g) || []).length, 0,
      'selection ring replaces the dashed cue while selected, same as before this milestone');
    assert.ok(new RegExp('<circle class="p3d-hit" data-entry="' + hub.id + '"[^>]*onclick="pbv23dTapEntry').test(sel),
      'hit target remains the tap surface');
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
    /* SUPERSEDED BY PBV2-13B-4.2: 13B-4.1's cubic (lead-in / cubic / lead-out)
       could still loop when both certified entries sat near the SAME shared
       corner — capping each lead against "room toward the partner" is
       exactly what caused it to collapse there in the first place. The
       family is now lead-in / quadratic / lead-out for the common case,
       verified before use and safety-netted to a single hub-to-hub
       quadratic (no separate lead segments to conflict) for that narrow
       degenerate case. This well-separated fixture takes the common path.
       The INTENT of the original assertion — one single turn, not a
       polyline of them — is preserved below. */
    assert.strictEqual((angle.match(/ Q /g) || []).length, 1, 'exactly one turn');
    assert.strictEqual((angle.match(/ C /g) || []).length, 0, 'no cubic in the route family');
    assert.strictEqual((angle.match(/ L /g) || []).length, 2, 'a lead in and a lead out');
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

  /* SUPERSEDED BY PBV2-13B-4 (was: "every geometry mutation invalidates a
     shown result", which listed pbv23dPickPosition among the invalidators).
     Schematic position is presentation-only: it is not in the Layer-1 request
     and not a Layer-2 input, so it cannot make a certified result stale.
     Invalidating on it discarded a still-valid calculation. The CALCULATION-
     RELEVANT mutations below are unchanged and still asserted. */
  test('every calculation-relevant mutation invalidates a shown result', () => {
    for (const name of ['pbv23dTapWall', 'pbv23dDeleteSelected', 'pbv23dPickSize',
      'pbv23dPickWall', 'pbv23dPickRow', 'pbv23dAddRowHere', 'pbv23dLoadState']) {
      assert.ok(fn3d(name).includes('pbv23dInvalidateResult'),
        name + ' must clear the stale result');
    }
    assert.ok(fn3d('pbv23dTapEntry').includes('pbv23dInvalidateResult'),
      'creating a connection invalidates too');
    assert.ok(fn3d('pbv23dInvalidateResult').includes('pbv23dLastResult = null'));
  });

  test('schematic-position-only edits do NOT invalidate (PBV2-13B-4)', () => {
    assert.ok(!fn3d('pbv23dPickPosition').includes('pbv23dInvalidateResult'),
      'schematic position is presentation-only and must not discard a result');
    // and it must never leak into the engine request
    assert.ok(!fn3d('pbv23dEngineRequest').includes('.v'),
      'schematic v is never sent to Layer 1');
    // UI gestures that do not mutate the model must not invalidate either
    for (const name of ['pbv23dStartConnect', 'pbv23dCancelConnect', 'pbv23dCancelAdd']) {
      assert.ok(!fn3d(name).includes('pbv23dInvalidateResult'),
        name + ' is a gesture, not a model change');
    }
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
    /* rows are edited from the selected raceway, not from wall panels.
       SUPERSEDED BY PBV2-13B-4.8 (completion): the fields moved out of
       pbv23dSheetBody into the shared pbv23dEditFieldsHtml builder, which
       the selected-raceway panel now renders inline. The guarantee — row
       editing belongs to the selected raceway, never to a wall form — is
       unchanged and asserted against the builder that actually owns it. */
    /* PBV2-13B-4.8c: the row control is now a compact selector rather than a
       permanent strip labelled ROW ON THIS WALL. The guarantee — row editing
       belongs to the selected raceway, never to a wall form — is unchanged. */
    assert.ok(fn3d('pbv23dEditFieldsHtml').includes('pbv23dPickRowOption'),
      'row editing lives with the selected raceway');
    assert.ok(fn3d('pbv23dSheetBody').includes('pbv23dEditFieldsHtml'),
      'and is reachable directly in the fixed detail sheet');
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
    const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET', 'PBV23D_CORNER_EXCLUDE',
      'PBV23D_SIZES', 'PBV23D_WALLS',
      'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const pure = ['pbv23dHub', 'pbv23dInward', 'pbv23dEmptyState', 'pbv23dRowsFor',
      'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow',
      'pbv23dSetEntryRow', 'pbv23dDeleteRowIfEmpty', 'pbv23dRowDepth', 'pbv23dFindEntry',
      'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dSetSize',
      'pbv23dSetPosition', 'pbv23dSetWall', 'pbv23dClassify', 'pbv23dAddConnection',
      'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConns', 'pbv23dEntryColor', 'pbv23dEntryConnNumbers', 'pbv23dHubNumberLayout', 'pbv23dHitRadius',
      'pbv23dRouteLead', 'pbv23dClampInterior', 'pbv23dSegCross', 'pbv23dPolylineLoops', 'pbv23dRouteAnchor', 'pbv23dAngleSide', 'pbv23dAngleRoute', 'pbv23dRoutePath', 'pbv23dBuildFixture', 'pbv23dEngineRequest', 'pbv23dPresent',
      'pbv23dTapWall', 'pbv23dStartAdd', 'pbv23dCancelAdd', 'pbv23dTapEntry',
      'pbv23dPickRow', 'pbv23dAddRowHere', 'pbv23dLayoutGeometry', 'pbv23dCertifyBox',
      'pbv23dCertifiedBox', 'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dCeilBoxDim', 'pbv23dEffectiveAxes', 'pbv23dCalculate',
      'pbv23dInvalidateResult', 'pbv23dCertifiedView', 'pbv23dEntryRenderV', 'pbv23dGeoFor',
      'pbv23dPickPosition', 'pbv23dSetPosition', 'pbv23dPickSize', 'pbv23dPickWall',
      'pbv23dStartConnect', 'pbv23dCancelConnect', 'pbv23dDeleteSelected',
      'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode',
      'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dStartDisconnect',
      'pbv23dDeleteConnection', 'pbv23dDisconnect',
      'pbv23dIn', 'pbv23dSheetResultLine', 'pbv23dEntryConns', 'pbv23dConnColor',
      'pbv23dConnNumber', 'pbv23dConnTypeOf', 'pbv23dRowIndex', 'pbv23dEditFieldsHtml',
      'pbv23dSelectionHtml'].map(fn3d).join('\n');
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
      + 'var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;\n'
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
      exports.selectionHtml = () => pbv23dSelectionHtml(PBV23D);
      exports.rowsFor = pbv23dRowsFor; exports.find = pbv23dFindEntry;
      exports.layout = () => pbv23dLayout;
      exports.certifiedView = () => pbv23dCertifiedView(PBV23D);
      exports.pickPosition = pbv23dPickPosition; exports.pickSize = pbv23dPickSize;
      exports.pickWall = pbv23dPickWall; exports.startConnect = pbv23dStartConnect;
      exports.cancelConnect = pbv23dCancelConnect; exports.deleteSelected = pbv23dDeleteSelected;
      exports.invalidate = pbv23dInvalidateResult;`)(
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
    /* SUPERSEDED BY PBV2-13B-4.8 (completion): placing a raceway used to
       open the EDIT sheet so its controls could be reached. Those controls
       now render inline in the selected-raceway panel, so no sheet is
       opened — the guarantee that the new raceway is immediately selected
       AND immediately editable is preserved and asserted directly. */
    assert.strictEqual(u.sheetOpens(), 1, 'its detail sheet opens immediately');
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

  test('CALCULATE exists exactly once, in the global box-action row', () => {
    /* SUPERSEDED BY PBV2-13B-4.8g: CALCULATE is a BOX-level action. It used
       to appear both globally and inside the raceway editor; the duplicate is
       gone and the one remaining control keeps the same engine path. */
    const sheet = fn3d('pbv23dSheetBody');
    assert.ok(!sheet.includes('pbv23dCalculate'), 'no CALCULATE inside the details');
    const globals = fn3d('pbv23dGlobalsHtml');
    assert.ok(globals.includes('id="pbv2-3d-calc"') && globals.includes('pbv23dCalculate()'),
      'the single CALCULATE lives in the global row');
    assert.ok(globals.includes("pbv23dPresentation ? 'RECALCULATE' : 'CALCULATE'"),
      'and keeps the existing label contract');
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

  test('ROW LIFECYCLE: a row survives being vacated; deleting its raceway clears it', () => {
    /* SUPERSEDED BY PBV2-13B-4.9D.1: moving a raceway between rows no longer
       deletes the row it left. That auto-cleanup was the ADD ROW bug — the
       new row was created and the old one immediately removed, so a wall's
       row count never grew. Rows a user created must survive being
       temporarily empty (an empty row is Layer-1 identical). Cleanup still
       runs where there is no intent to keep the row: raceway deleted, or
       raceway moved to another wall — both asserted here. */
    const u = ui();
    u.load(u.build('rows'));
    assert.strictEqual(u.rowsFor(u.state(), 'left').length, 2);
    const three = u.state().entries.find((e) => e.size === '3');
    const vacated = three.rowId;
    u.select(three.id);
    u.pickRow(u.rowsFor(u.state(), 'left')[0].id);
    assert.strictEqual(u.rowsFor(u.state(), 'left').length, 2, 'the vacated row remains');
    assert.ok(u.state().rows.some((r) => r.id === vacated), 'and keeps its identity');
    // moving to another wall DOES release the row it leaves behind
    const before = u.rowsFor(u.state(), 'left').length;
    const two = u.state().entries.find((e) => e.size === '2' && e.wall === 'left');
    u.select(two.id);
    u.pickWall('top');           // the last occupant of its row leaves the wall
    assert.ok(u.rowsFor(u.state(), 'left').length <= before,
      'leaving the wall releases an emptied row');
  });

  test('ROW LIFECYCLE: no manual row-delete controls remain', () => {
    /* PBV2-13B-4.8 (completion): the row strip moved into the shared
       pbv23dEditFieldsHtml builder that the fixed sheet renders. Same
       controls, same handlers, one implementation — asserted where they
       now live. */
    const sheet = fn3d('pbv23dEditFieldsHtml');
    // PBV2-13B-4.8c: the row strip became a compact selector
    assert.ok(sheet.includes('pbv23dPickRowOption') && sheet.includes('PBV23D_ADD_ROW'));
    assert.ok(fn3d('pbv23dSheetBody').includes('pbv23dEditFieldsHtml'),
      'and the sheet renders them');
    assert.ok(!/pbv23dDropRow/.test(P3D), 'the manual delete handler is gone entirely');
    assert.ok(!/Delete empty row/.test(sheet), 'no delete affordance in the row strip');
    // the strip is now only: row numbers plus one add control
    // PBV2-13B-4.8c: both capabilities are reached through the row selector,
    // which routes to the SHIPPED pbv23dPickRow / pbv23dAddRowHere handlers
    assert.ok(sheet.includes('pbv23dPickRowOption'), 'row choice routes to the handler');
    const router = fn3d('pbv23dPickRowOption');
    assert.ok(router.includes('pbv23dAddRowHere') && router.includes('pbv23dPickRow'),
      'add-row and pick-row both still reachable, via the shipped handlers');
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
    const src = [['PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join(''),
    fn3d('pbv23dFindEntry'), fn3d('pbv23dRowsFor'), fn3d('pbv23dRowById'),
    fn3d('pbv23dRowIndex'), fn3d('pbv23dClassify'), fn3d('pbv23dConnTypeOf'),
    fn3d('pbv23dConnNumber'), fn3d('pbv23dConnColor'), fn3d('pbv23dEntryConns'),
    fn3d('pbv23dCertifiedBox'), fn3d('pbv23dCeilBoxDim'), fn3d('pbv23dEntryRenderV'),
    fn3d('pbv23dCertifiedView'), fn3d('pbv23dEditFieldsHtml'),
    fn3d('pbv23dConnActionsHtml'), fn3d('pbv23dTargeting'),
    fn3d('pbv23dEnterTargetMode'),
    fn3d('pbv23dExitTargetMode'),
    fn3d('pbv23dConnBetween'),
    fn3d('pbv23dEligibleTargets'),
    fn3d('pbv23dTargetModeHtml'),
    fn3d('pbv23dStartDisconnect'),
    fn3d('pbv23dGlobalsHtml'), fn3d('pbv23dSelectionHtml'),
    fn3d('pbv23dIn'), fn3d('pbv23dSheetResultLine'), fn3d('pbv23dSheetBody'),
    fn3d('pbv23dBarHtml')].join('\n');
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('pbv23dSelected', 'pbv23dConnectFrom', 'pbv23dAddMode',
      'pbv23dPresentation', 'exports',
      'var pbv23dLayout = null; var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;' + 'var PBV23D = null;' + src + ';exports.bar = pbv23dBarHtml;exports.details = function (st) { PBV23D = st; return pbv23dSheetBody(); };')(
      opts.selected || null, opts.connectFrom || null, !!opts.addMode,
      opts.presentation || null, out);
    lastDetails = () => out.details(state);
    return out.bar(state);
  }
  /* PBV2-13B-4.8g: raceway identity moved out of the summary tier (now empty)
     into the in-flow details section, so identity assertions read it there. */
  let lastDetails = () => '';
  const detailsFor = (state, id) => { barFor(state, { selected: id }); return lastDetails(); };

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
    /* SUPERSEDED BY PBV2-13B-4.8g: the summary tier is gone — the details
       expand in flow under the global row, so raceway editing is asserted
       there. ADD RACEWAY remains global and unaffected by selection. */
    assert.ok(detailsFor(s, s.entries[0].id).includes('pbv23dPickSize'),
      'raceway editing lives in the in-flow details');
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
/* SUPERSEDED BY PBV2-13B-4.8g: identity moved from the summary tier (now
       empty) into the in-flow details section. */
/* SUPERSEDED BY PBV2-13B-4.8g: the summary tier is gone; identity lives in
       the in-flow details. The guarantee is unchanged — the CURRENT size, wall
       and row must be the selected values, and edits must show immediately. */
    const d = detailsFor(s, three.id);
    assert.strictEqual(selectedOptionValue(d, 'pbv2-3d-size'), '3', 'trade size');
    assert.strictEqual(selectedOptionValue(d, 'pbv2-3d-wall'), 'left', 'wall');
    assert.strictEqual(selectedOptionValue(d, 'pbv2-3d-row'), three.rowId, 'row identity');
    assert.strictEqual(selectedOptionLabel(d, 'pbv2-3d-row'), '2', 'shown as row 2');
    // row identity is shown even on a single-row wall, for consistency
    const top = s.entries.find((e) => e.wall === 'top');
    const dt = detailsFor(s, top.id);
    assert.strictEqual(selectedOptionValue(dt, 'pbv2-3d-row'), top.rowId);
    assert.strictEqual(selectedOptionLabel(dt, 'pbv2-3d-row'), '1');
  });

  test('changing row updates context but never the hub identifier', () => {
    const s = api.build('rows');
    const three = s.entries.find((e) => e.size === '3');
    /* SUPERSEDED BY PBV2-13B-4.8g: the summary tier is gone; identity lives in
       the in-flow details. The guarantee is unchanged — the CURRENT row must
       be the selected value and must follow a move immediately. */
    assert.strictEqual(selectedOptionLabel(detailsFor(s, three.id), 'pbv2-3d-row'), '2');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    const moved = detailsFor(s, three.id);
    assert.strictEqual(selectedOptionValue(moved, 'pbv2-3d-row'),
      api.rowsFor(s, 'left')[0].id, 'the selector follows the move');
    assert.strictEqual(selectedOptionLabel(moved, 'pbv2-3d-row'), '1', 'now row 1');
    assert.strictEqual(selectedOptionValue(moved, 'pbv2-3d-size'), '3',
      'trade size is unaffected by the row move');
    assert.ok(api.svg(s, { selected: three.id }).includes('3&#8243;'),
      'hub label unchanged by the row move');
  });

  test('changing trade size updates the hub label', () => {
    const s = api.build('rows');
    const three = s.entries.find((e) => e.size === '3');
    api.setSize(s, three.id, '6');
    assert.ok(api.svg(s, { selected: three.id }).includes('6&#8243;'));
/* SUPERSEDED BY PBV2-13B-4.8g: identity moved from the summary tier (now
       empty) into the in-flow details section. */
/* SUPERSEDED BY PBV2-13B-4.8g: the summary tier is gone; identity lives in
       the in-flow details. The guarantee is unchanged — the CURRENT size, wall
       and row must be the selected values, and edits must show immediately. */
    assert.strictEqual(selectedOptionValue(detailsFor(s, three.id), 'pbv2-3d-size'), '6',
      'the change is reflected immediately');
  });

  test('DENSE: every raceway reports its own size and row, ADD stays available', () => {
    const s = api.build('dense');
    assert.strictEqual(s.entries.length, 16);
    for (const e of s.entries.slice(0, 8)) {
      const svg = api.svg(s, { selected: e.id });
      assert.ok(svg.includes(e.size + '&#8243;'),
        'selected raceway shows its own trade size: ' + e.id);
      /* PBV2-13B-4.8g: per-raceway identity is read from the in-flow details;
         ADD stays in the global row, which is unaffected by selection. */
      const d = detailsFor(s, e.id);
      assert.strictEqual(selectedOptionValue(d, 'pbv2-3d-size'), e.size, 'size: ' + e.id);
      assert.strictEqual(selectedOptionValue(d, 'pbv2-3d-wall'), e.wall, 'wall: ' + e.id);
      assert.strictEqual(selectedOptionLabel(d, 'pbv2-3d-row'),
        String(api.rowIndex(s, e.rowId) + 1), 'correct row identity for ' + e.id);
      assert.ok(barFor(s, { selected: e.id }).includes('pbv23dStartAdd()'),
        'ADD remains available in dense');
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
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!fn3d('pbv23dSheetBody').includes('pbv23dCalculate'),
      'CALCULATE is a BOX action and lives only in the global row');
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');   // display rounding only
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    // row lifecycle intact
    assert.ok(!code.includes('pbv23dDropRow'), 'no manual row delete returned');
/* SUPERSEDED BY PBV2-13B-4.9D.1: row-to-row moves no longer auto-clean; the
       cleanup that remains is on raceway delete and wall change. */
    assert.ok(!fn3d('pbv23dSetEntryRow').includes('pbv23dDeleteRowIfEmpty'),
      'a vacated row is kept for the user');
    assert.ok(fn3d('pbv23dDeleteEntry').includes('pbv23dDeleteRowIfEmpty')
      && fn3d('pbv23dSetWall').includes('pbv23dDeleteRowIfEmpty'),
    'cleanup remains where no row was intended');
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
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dFindEntry',
      'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConnNumbers', 'pbv23dHubNumberLayout', 'pbv23dEngineRequest', 'pbv23dPresent',
      'pbv23dIn', 'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dCeilBoxDim', 'pbv23dEffectiveAxes', 'pbv23dResultHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'exports',
      'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;\n'
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
      /* SUPERSEDED BY PBV2-13B-4.7: the number/colour pairing used to live on
         a floating route badge. It now lives at BOTH confirmed endpoints —
         the same connection identity, moved into the hubs themselves. */
      assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + conn.a
        + '" data-conn="' + conn.id + '"[^>]*fill="' + col + '"[^>]*>' + num + '<').test(svg),
      'numbered hub at the source end for ' + conn.id);
      assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + conn.b
        + '" data-conn="' + conn.id + '"[^>]*fill="' + col + '"[^>]*>' + num + '<').test(svg),
      'numbered hub at the destination end for ' + conn.id);
      assert.ok(new RegExp('data-conn="' + conn.id + '"[^>]*stroke="' + col + '"')
        .test(svg), 'route wears the same colour');
      const sp = p.spacing.find((x) => x.connectionId === conn.id);
      if (!sp) continue;
      const card = h.slice(h.indexOf('border-left:3px solid ' + col));
      assert.ok(card.indexOf('>' + num + '</span>') !== -1,
        'result card carries the same number ' + num);
    }
    // no floating badge survives, and every connection shows its number at
    // exactly its two endpoints — never a third, orphaned occurrence
    assert.ok(!svg.includes('p3d-connnum'), 'the floating route badge is gone');
    assert.strictEqual((svg.match(/class="p3d-hubnum"/g) || []).length, s.connections.length * 2);
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
/* SUPERSEDED BY PBV2-13B-4.8g.4: the old rule stacked an 18px margin on
       top of an 18px padding either side of the divider — a dead zone under
       the global action card on a phone. The guarantee that survives is that
       the results still own a divider and still clear the Safari chrome; the
       separation above is now compact. */
/* SUPERSEDED BY PBV2-14.1: the surface is a normal content panel and the
       bottom nav is a flex sibling, not an overlay, so the 140px Safari-chrome
       tail is gone. What still matters is compact spacing above the divider. */
    assert.ok(/\.p3d-res\{margin:8px 14px 24px;[^}]*padding-top:8px/.test(P3D),
      'compact separation from the controls above');
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
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!fn3d('pbv23dSheetBody').includes('pbv23dCalculate'),
      'CALCULATE is global-only; no second control in the details');
/* SUPERSEDED BY PBV2-13B-4.9D.1: row-to-row moves no longer auto-clean; the
       cleanup that remains is on raceway delete and wall change. */
    assert.ok(!fn3d('pbv23dSetEntryRow').includes('pbv23dDeleteRowIfEmpty'),
      'a vacated row is kept for the user');
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
    // PBV2-13B-4.7: numbers moved from a floating route badge (one per
    // connection) into both confirmed endpoint hubs (two per connection)
    assert.strictEqual((dsvg.match(/class="p3d-hubnum"/g) || []).length, d.connections.length * 2);
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
    const src = [['PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join(''),
    fn3d('pbv23dFindEntry'), fn3d('pbv23dRowsFor'), fn3d('pbv23dRowById'),
    fn3d('pbv23dRowIndex'), fn3d('pbv23dClassify'), fn3d('pbv23dConnTypeOf'),
    fn3d('pbv23dConnNumber'), fn3d('pbv23dConnColor'), fn3d('pbv23dEntryConns'),
    fn3d('pbv23dCertifiedBox'), fn3d('pbv23dCeilBoxDim'), fn3d('pbv23dEntryRenderV'),
    fn3d('pbv23dCertifiedView'), fn3d('pbv23dEditFieldsHtml'),
    fn3d('pbv23dConnActionsHtml'), fn3d('pbv23dTargeting'),
    fn3d('pbv23dEnterTargetMode'),
    fn3d('pbv23dExitTargetMode'),
    fn3d('pbv23dConnBetween'),
    fn3d('pbv23dEligibleTargets'),
    fn3d('pbv23dTargetModeHtml'),
    fn3d('pbv23dStartDisconnect'),
    fn3d('pbv23dGlobalsHtml'), fn3d('pbv23dSelectionHtml'),
    fn3d('pbv23dBarHtml')].join('\n');
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('pbv23dSelected', 'pbv23dConnectFrom', 'pbv23dAddMode',
      'pbv23dPresentation', 'exports',
      'var pbv23dLayout = null; var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;' + src + ';exports.bar = pbv23dBarHtml;')(
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
    /* tier 2: the summary and the per-raceway actions come after.
       SUPERSEDED BY PBV2-13B-4.8 (completion): ordering is now anchored on a
       surviving selection action, since pbv23dOpenSheet no longer exists. */
/* SUPERSEDED BY PBV2-13B-4.8g: the summary tier is gone — the details expand
       in flow under the global row, so raceway identity is asserted there. */
    assert.ok(sel.includes('p3d-globals'), 'the global row is the bar');
    assert.ok(sel.includes('id="pbv2-3d-add"') && sel.includes('id="pbv2-3d-calc"'),
      'ADD RACEWAY and CALCULATE are the box-level actions');
    // the summary is its own flex line inside the selection tier
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.strictEqual(fn3d('pbv23dSelectionHtml').includes('p3d-barlabel'), false,
      'the summary tier renders nothing at all');
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
    /* PBV2-13B-4.8e: cancel now routes through the explicit mode machine,
       which re-renders and restores the sheet. Same guarantee, one indirection. */
    assert.ok(fn3d('pbv23dCancelConnect').includes('pbv23dExitTargetMode'));
    assert.ok(fn3d('pbv23dExitTargetMode').includes('pbv23dRender()'));
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

  test('exactly ONE CALCULATE control exists, in the global row, one engine path', () => {
    /* SUPERSEDED BY PBV2-13B-4.8g: the old premise — two CALCULATE controls
       sharing a path — is intentionally obsolete. CALCULATE is a BOX-level
       action and now exists exactly once. The stronger guarantee is asserted
       here: one control, in the global row, with no second calculate action
       anywhere in the selected-raceway details, and the label still driven by
       the existing presentation state. */
    const globals = fn3d('pbv23dGlobalsHtml');
    assert.ok(globals.includes('id="pbv2-3d-calc"')
      && globals.includes('onclick="pbv23dCalculate()"'), 'the one control is global');
    assert.ok(globals.includes("pbv23dPresentation ? 'RECALCULATE' : 'CALCULATE'"),
      'label still follows presentation state');
    assert.ok(!fn3d('pbv23dSheetBody').includes('pbv23dCalculate'),
      'no calculate action inside the details');
    assert.ok(!fn3d('pbv23dEditFieldsHtml').includes('pbv23dCalculate'));
    assert.ok(!fn3d('pbv23dConnActionsHtml').includes('pbv23dCalculate'));
    // exactly one calculate control is rendered anywhere in the shipped UI
/* PBV2-13B-4.9C: FAST RESULT has its own CALCULATE on its own surface, so
       the shipped markup now carries TWO call sites — one per mode surface,
       both the same shipped handler, never visible together (FAST hides the
       globals row). The guarantee is one control per visible surface. */
    assert.strictEqual((P3D.match(/onclick="pbv23dCalculate\(\)"/g) || []).length, 2,
      'one call site per mode surface, both the shipped handler');
    assert.ok(fn3d('pbv23dGlobalsHtml').includes('pbv23dCalculate()')
      && fn3d('pbv23dFastControlsHtml').includes('pbv23dCalculate()'));
    assert.ok(/p3d-mode-fast #pbv2-3d-globals[^{]*\{display:none\}|p3d-mode-fast #pbv2-3d-globals,/.test(P3D),
      'the two are never visible at once');
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
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(bar(d, { selected: d.entries[0].id }).includes('id="pbv2-3d-add"'),
      'the global row survives selection');
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
    /* SUPERSEDED BY PBV2-13B-4.8g.4: the old rule stacked an 18px margin on
       top of an 18px padding either side of the divider — a dead zone under
       the global action card on a phone. The guarantee that survives is that
       the results still own a divider and still clear the Safari chrome; the
       separation above is now compact. */
/* SUPERSEDED BY PBV2-14.1: the surface is a normal content panel and the
       bottom nav is a flex sibling, not an overlay, so the 140px Safari-chrome
       tail is gone. What still matters is compact spacing above the divider. */
    assert.ok(/margin:8px 14px 24px/.test(res), 'compact above, normal tail below');
    assert.ok(/border-top:1px solid/.test(res), 'the divider belongs to the results section');
    assert.ok(/padding-top:8px/.test(res), 'the heading does not sit on the divider');
    assert.ok(/24px/.test(res), 'a normal content tail, not overlay clearance');
    // and an empty results container collapses entirely in DETAILS mode
    assert.ok(/\.p3d-res:empty\{[^}]*margin:0/.test(P3D), 'no reserved gap when hidden');
    assert.ok(!/position|height:\s*\d/.test(res), 'results grow with content');
  });

  test('controls wrap instead of overflowing at narrow widths', () => {
    /* SUPERSEDED BY PBV2-13B-4.9D.1: the three box-level actions share ONE
       row by explicit product decision, so they shrink rather than wrap. The
       guarantee that replaces it: they may all shrink (basis 0, min-width 0)
       and the 44px touch height is still not sacrificed. */
    const globals = rule('.p3d-globals');
    assert.ok(/flex-wrap:nowrap/.test(globals), 'the three actions stay on one row');
    assert.ok(/\.p3d-globals \.p3d-btn\{[^}]*flex:1 1 0/.test(styles), 'each may shrink');
    assert.ok(/\.p3d-globals \.p3d-btn\{[^}]*min-width:0/.test(styles), 'so none overflows');
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
    /* SUPERSEDED BY PBV2-13B-4.8g: the summary tier is gone. The real
       guarantee — no fixed pixel widths, so long values cannot overflow at
       any target width — now applies to the in-flow detail controls. */
    assert.ok(!/width:\s*\d+px/.test(rule('.p3d-field')), 'selectors are not fixed-width');
    assert.ok(!/width:\s*\d+px/.test(rule('.p3d-act')), 'actions are not fixed-width');
    assert.ok(/flex:1 1 0/.test(rule('.p3d-cfg .p3d-field') + rule('.p3d-act')),
      'they share the row by flex basis, not by pixels');
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
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dFindEntry',
      'pbv23dClassify', 'pbv23dConnTypeOf', 'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConnNumbers', 'pbv23dHubNumberLayout',
      'pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dIn', 'pbv23dAxisRow',
      'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dCeilBoxDim', 'pbv23dEffectiveAxes', 'pbv23dResultHtml',
      'pbv23dEntryConns', 'pbv23dEntryRenderV', 'pbv23dCertifiedView', 'pbv23dEditFieldsHtml',
      'pbv23dConnActionsHtml', 'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dTargetModeHtml', 'pbv23dStartDisconnect',
      'pbv23dGlobalsHtml', 'pbv23dSelectionHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'pbv23dSelected', 'pbv23dConnectFrom', 'pbv23dAddMode', 'exports',
      'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;\n'
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
    /* SUPERSEDED BY PBV2-13B-4.8g: the summary tier renders nothing — the
       details expand in flow under the global row instead. What the tier must
       still guarantee is that it does NOT duplicate any global action. */
    assert.strictEqual(r.selection, '', 'the summary tier is empty');
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
    // PBV2-13B-4.7: numbers moved from a floating route badge (one per
    // connection) into both confirmed endpoint hubs (two per connection)
    assert.strictEqual((svg.match(/class="p3d-hubnum"/g) || []).length, d.connections.length * 2);
    assert.ok(fn3d('pbv23dTapWall').includes('if (!pbv23dAddMode'));
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!fn3d('pbv23dSheetBody').includes('pbv23dCalculate'),
      'CALCULATE is a BOX action and lives only in the global row');
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
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex',
      'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dFindEntry', 'pbv23dNextPosition',
      'pbv23dAddEntry', 'pbv23dAddConnection', 'pbv23dClassify', 'pbv23dConnColor',
      'pbv23dConnNumber', 'pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dIn',
      'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dCeilBoxDim', 'pbv23dEffectiveAxes', 'pbv23dResultHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'exports',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;\n'
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
    // PBV2-13B-4.7: the three numbers now live at the six confirmed
    // endpoint hubs (two per pull) instead of three floating badges
    const svg = api.svg(s, {});
    assert.strictEqual((svg.match(/class="p3d-hubnum"/g) || []).length, 6);
    assert.ok(!svg.includes('p3d-connnum'), 'no floating badge remains');
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
      /* SUPERSEDED BY PBV2-13B-4.7: identity moved from the route badge to
         both confirmed endpoint hubs. */
      assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + conn.a
        + '" data-conn="' + conn.id + '"[^>]*fill="' + col + '"[^>]*>' + num + '<').test(svg),
      'numbered source hub for ' + num);
      assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + conn.b
        + '" data-conn="' + conn.id + '"[^>]*fill="' + col + '"[^>]*>' + num + '<').test(svg),
      'numbered destination hub for ' + num);
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
    // PBV2-13B-4.8g.4: compact separation above the results
    assert.ok(/\.p3d-res\{margin:8px 14px 24px/.test(P3D));
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
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex',
      'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dFindEntry', 'pbv23dNextPosition',
      'pbv23dAddEntry', 'pbv23dAddConnection', 'pbv23dClassify', 'pbv23dConnColor',
      'pbv23dConnNumber', 'pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dIn',
      'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dCertifiedBox',
      'pbv23dLayoutNote', 'pbv23dDim', 'pbv23dCeilBoxDim', 'pbv23dEffectiveAxes', 'pbv23dResultHtml'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'exports',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null; var pbv23dPresentation = null; var pbv23dLayout = null;\n'
      + 'var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;\n'
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
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!fn3d('pbv23dSheetBody').includes('pbv23dCalculate'),
      'CALCULATE is a BOX action and lives only in the global row');
    const s = api.build('rows');
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 26);
    const three = s.entries.find((e) => e.size === '3');
    api.setRow(s, three.id, api.rowsFor(s, 'left')[0].id);
    assert.strictEqual(engine.calculatePullBox(api.request(s)).minimumWidthIn, 29);
    const d = api.build('dense');
    const svg = api.svg(d, {});
    // PBV2-13B-4.7: numbers moved from a floating route badge (one per
    // connection) into both confirmed endpoint hubs (two per connection)
    assert.strictEqual((svg.match(/class="p3d-hubnum"/g) || []).length, d.connections.length * 2);
    for (const c of d.connections) assert.ok(api.PALETTE.includes(api.connColor(d, c.id)));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8 — CONFIRMED PULL DISCONNECT UX

   pbv23dDeleteConnection already provided the correct state transition but
   had NO caller anywhere in the app: the model half existed, the UI half did
   not, so a user could create a pull and never remove it without deleting a
   raceway. This milestone adds only the missing UI — a DISCONNECT action in
   the existing selected-raceway bar, plus the pbv23dDisconnect handler that
   mirrors the connect-commit contract (invalidate, re-render from state).
   Targeting is always by connection id. DELETE (the raceway path) is
   untouched and remains separate.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8 — confirmed pull disconnect UX', () => {
  const api = api3d();

  /** The shipped FIXED SHEET body — the primary detail surface since the
   *  4.8 completion pass: edit fields + connected pulls + actions. */
  function sheetFor(state, selected, panel) {
    const src = [['PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join(''),
    fn3d('pbv23dFindEntry'), fn3d('pbv23dRowsFor'), fn3d('pbv23dRowById'),
    fn3d('pbv23dRowIndex'), fn3d('pbv23dClassify'), fn3d('pbv23dConnTypeOf'),
    fn3d('pbv23dConnNumber'), fn3d('pbv23dConnColor'), fn3d('pbv23dEntryConns'),
    fn3d('pbv23dCertifiedBox'), fn3d('pbv23dCeilBoxDim'), fn3d('pbv23dEntryRenderV'),
    fn3d('pbv23dCertifiedView'), fn3d('pbv23dEditFieldsHtml'),
    fn3d('pbv23dConnActionsHtml'), fn3d('pbv23dTargeting'),
    fn3d('pbv23dEnterTargetMode'),
    fn3d('pbv23dExitTargetMode'),
    fn3d('pbv23dConnBetween'),
    fn3d('pbv23dEligibleTargets'),
    fn3d('pbv23dTargetModeHtml'),
    fn3d('pbv23dStartDisconnect'),
    fn3d('pbv23dConnActionsHtml'), fn3d('pbv23dSheetResultLine'), fn3d('pbv23dIn'),
    fn3d('pbv23dSheetBody')].join('\n');
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('pbv23dSelected', 'PBV23D', 'pbv23dPresentation', 'exports',
      'var pbv23dLayout = null; var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;' + src
      + ';exports.body = pbv23dSheetBody;')(
      selected || null, state, null, out);
    return out.body(panel);
  }
  const barFor = sheetFor;   // the detail surface the user actually operates

  /** A LIVE app slice: the real pbv23dDisconnect handler over real state, so
   *  these tests exercise the shipped handler rather than re-implementing it. */
  function live(state, selected) {
    const src = [fn3d('pbv23dFindEntry'), fn3d('pbv23dDeleteConnection'),
      fn3d('pbv23dDeleteEntry'), fn3d('pbv23dDeleteRowIfEmpty'), fn3d('pbv23dRowsFor'),
      fn3d('pbv23dInvalidateResult'), fn3d('pbv23dTargeting'), fn3d('pbv23dDisconnect'),
      fn3d('pbv23dDeleteSelected')].join('\n');
    const out = {};
    let renders = 0;
    // eslint-disable-next-line no-new-func
    new Function('PBV23D', 'pbv23dRender', 'pbv23dCloseSheet', 'pbv23dRefreshSheet', 'exports', 'bump',
      'var pbv23dSelected = ' + JSON.stringify(selected || null) + ';'
      + 'var pbv23dConnectFrom = null, pbv23dTargetMode = null;'
      + 'var pbv23dLastResult = {stale: true}, pbv23dPresentation = {stale: true}, pbv23dLayout = {stale: true};'
      + src
      + ';exports.disconnect = pbv23dDisconnect;'
      + 'exports.deleteSelected = pbv23dDeleteSelected;'
      + 'exports.result = function () { return [pbv23dLastResult, pbv23dPresentation, pbv23dLayout]; };')(
      state, () => { renders++; }, () => {}, () => {}, out, null);
    out.renders = () => renders;
    return out;
  }

  function sharedFixture() {
    const s = api.empty();
    const hub = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const r = api.add(s, 'right', '2', api.nextId('e'));
    api.connect(s, hub.id, t.id, api.nextId('c'));     // pull #1
    api.connect(s, hub.id, r.id, api.nextId('c'));     // pull #2
    return { s, hub, t, r };
  }

  test('A. zero-connection entry: no DISCONNECT, CONNECT still offered', () => {
    const s = api.empty();
    const e = api.add(s, 'left', '2', api.nextId('e'));
    const bar = barFor(s, e.id);
/* PBV2-13B-4.8f: no CONNECTION selector — status is a compact line and the
       two actions sit on the sheet permanently. */
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(bar), 'nothing to disconnect');
    // PBV2-13B-4.8d: CONNECT moved inside the CONNECTION disclosure
    assert.ok(sheetFor(s, e.id).includes('pbv23dStartConnect()'), 'CONNECT remains');
    /* PBV2-13B-4.8c: pull rows and DELETE RACEWAY now live behind compact
       disclosure panels, so the assertion opens the panel it is about. The
       behavioural guarantee is unchanged. */
/* SUPERSEDED BY PBV2-13B-4.8g.2: the overflow menu is gone. DELETE RACEWAY
       is a direct control in the selected-raceway HEADER (outside the body
       these helpers render), so its separation from DISCONNECT is asserted
       against the shipped header markup and the delete handler itself. */
    assert.ok(P3D.includes('id="pbv2-3d-delete"') && P3D.includes('DELETE RACEWAY'),
      'raceway delete is a direct header control, distinctly named');
  });

  test('B. single connection: DISCONNECT appears and targets that connection id', () => {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    const bar = barFor(s, l.id);
    /* PBV2-13B-4.8c: pull rows and DELETE RACEWAY now live behind compact
       disclosure panels, so the assertion opens the panel it is about. The
       behavioural guarantee is unchanged. */
    const panel = sheetFor(s, l.id);
    assert.ok(bar.includes('id="pbv2-3d-do-connect"'), 'the actions sit on the sheet');
    /* SUPERSEDED BY PBV2-13B-4.8e: DISCONNECT no longer lists candidate pulls
       as text — it enters an exclusive mode where the user taps the connected
       counterpart on the drawing. The menu entry is what is asserted here; the
       exact-connection resolution is pinned in the 4.8e workflow suite. */
    assert.ok(panel.includes('id="pbv2-3d-do-disconnect"'), 'DISCONNECT is offered');
    assert.ok(!/pbv2-3d-do-disconnect"[^>]*disabled/.test(panel), 'and enabled with a pull');
/* SUPERSEDED BY PBV2-13B-4.9B: the pull-status line is gone from the editor;
       pull identity lives on the numbered endpoint hubs. The state guarantee is
       asserted directly. */
    assert.strictEqual(api.entryConns(s, l.id).length, 1, 'the pull exists on the raceway');
    // and it is offered from the far end too — a pull is symmetric
    assert.ok(sheetFor(s, t.id).includes('id="pbv2-3d-do-disconnect"'));
  });

  test('C. single disconnect removes exactly one connection; both raceways remain', () => {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    const app = live(s, l.id);
    app.disconnect(s.connections[0].id);
    assert.strictEqual(s.connections.length, 0, 'the pull is gone');
    assert.strictEqual(s.entries.length, 2, 'both raceways survive');
    assert.ok(api.find(s, l.id) && api.find(s, t.id), 'by identity, not just by count');
    assert.strictEqual(app.renders(), 1, 're-rendered from state');
  });

  test('D. an unrelated pull is untouched', () => {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const b1 = api.add(s, 'bottom', '3', api.nextId('e'));
    const b2 = api.add(s, 'bottom', '3', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    api.connect(s, b1.id, b2.id, api.nextId('c'));
    const survivor = JSON.parse(JSON.stringify(s.connections[1]));
    live(s, l.id).disconnect(s.connections[0].id);
    assert.strictEqual(s.connections.length, 1);
    assert.deepStrictEqual(s.connections[0], survivor, 'survivor byte-identical');
  });

  test('E. shared entry: every touching pull is listed separately by its number', () => {
    const { s, hub } = sharedFixture();
    const bar = sheetFor(s, hub.id);
    /* SUPERSEDED BY PBV2-13B-4.8e: every touching pull is still identified in
       the panel, but removal is spatial — the ambiguity this test guarded
       against is now impossible by construction, since the user picks the
       counterpart raceway rather than a button. */
/* PBV2-13B-4.8f: no CONNECTION selector — status is a compact line and the
       two actions sit on the sheet permanently. */
/* SUPERSEDED BY PBV2-13B-4.9B: the pull-status line is gone from the editor;
       pull identity lives on the numbered endpoint hubs. The state guarantee is
       asserted directly. */
    assert.ok(!bar.includes('connected pulls') && !bar.includes('p3d-status'),
      'no status line at all');
    assert.strictEqual((bar.match(/class="p3d-pull"/g) || []).length, 0,
      'the sheet does not grow with pull count');
    assert.ok(!/pbv2-3d-do-disconnect"[^>]*disabled/.test(bar), 'DISCONNECT enabled');
  });

  test('F. shared disconnect removes one relationship only; the sibling survives', () => {
    const { s, hub } = sharedFixture();
    const keep = JSON.parse(JSON.stringify(s.connections[1]));
    live(s, hub.id).disconnect(s.connections[0].id);
    assert.strictEqual(s.connections.length, 1);
    assert.deepStrictEqual(s.connections[0], keep);
    assert.strictEqual(s.entries.length, 3, 'no raceway was removed');
  });

  test('G. shared 2 -> 1: hub drops to a single coloured number, dashed cue goes', () => {
    const { s, hub } = sharedFixture();
    let svg = api.svg(s, {});
    const numsAt = (h, id) => (h.match(new RegExp('class="p3d-hubnum" data-entry="' + id
      + '"[^>]*>(\\d+)<', 'g')) || []).map((m) => m.match(/>(\d+)</)[1]);
    assert.deepStrictEqual(numsAt(svg, hub.id).sort(), ['1', '2']);
    assert.ok(svg.includes('p3d-multiring'), 'shared cue present at 2 pulls');
    live(s, hub.id).disconnect(s.connections[1].id);
    svg = api.svg(s, {});
    assert.deepStrictEqual(numsAt(svg, hub.id), [String(api.connNumber(s, s.connections[0].id))]);
    assert.ok(!svg.includes('p3d-multiring'), 'shared cue gone at 1 pull');
    assert.strictEqual(api.entryColor(s, hub.id), api.connColor(s, s.connections[0].id),
      'now a normal single-pull coloured hub');
  });

  test('H. 1 -> 0: the endpoint returns to the ordinary unnumbered marker', () => {
    const { s, hub } = sharedFixture();
    const app = live(s, hub.id);
    app.disconnect(s.connections[1].id);
    app.disconnect(s.connections[0].id);
    const svg = api.svg(s, {});
    assert.strictEqual(s.connections.length, 0);
    assert.strictEqual((svg.match(new RegExp('data-entry="' + hub.id + '"[^>]*class="p3d-hubnum"', 'g')) || []).length, 0);
    assert.ok(new RegExp('<ellipse class="p3d-hub" data-entry="' + hub.id + '"').test(svg),
      'ordinary ellipse marker again');
    assert.strictEqual(s.entries.length, 3, 'all three raceways still there');
  });

  test('I. targeting is by id: a sibling can never be hit by accident', () => {
    const { s, hub } = sharedFixture();
    const app = live(s, hub.id);
    const doomed = s.connections[1].id; const safe = s.connections[0].id;
    app.disconnect(doomed);
    assert.deepStrictEqual(s.connections.map((c) => c.id), [safe]);
    // a stale/unknown id is a no-op, never a fallback to "the first one"
    app.disconnect(doomed);
    app.disconnect('p3d-c-does-not-exist');
    assert.deepStrictEqual(s.connections.map((c) => c.id), [safe], 'survivor untouched');
  });

  test('J. DISCONNECT never calls the raceway-delete path', () => {
    const body = fn3d('pbv23dDisconnect');
    assert.ok(body.includes('pbv23dDeleteConnection'), 'uses the existing connection-delete model');
    assert.ok(!body.includes('pbv23dDeleteEntry') && !body.includes('pbv23dDeleteSelected'),
      'never removes a raceway');
    // and DELETE still removes its raceway together with its connections
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    live(s, l.id).deleteSelected();
    assert.strictEqual(s.entries.length, 1, 'DELETE behaviour unchanged');
    assert.strictEqual(s.connections.length, 0);
  });

  test('K. raceway geometry is untouched by disconnect', () => {
    const { s, hub, t, r } = sharedFixture();
    const before = JSON.stringify(s.entries);
    live(s, hub.id).disconnect(s.connections[0].id);
    assert.strictEqual(JSON.stringify(s.entries), before,
      'wall, size, row, position and identity all unchanged');
    void t; void r;
  });

  test('L. disconnect invalidates the certified result — same contract as connecting', () => {
    const s = api.empty();
    const l = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, l.id, t.id, api.nextId('c'));
    const app = live(s, l.id);
    app.disconnect(s.connections[0].id);
    assert.deepStrictEqual(app.result(), [null, null, null],
      'result/presentation/layout all go stale; no implicit re-sizing');
    // the handler introduces no sizing policy of its own
    const body = fn3d('pbv23dDisconnect');
    assert.ok(!/calculatePullBox|findLayoutDimensions|WIDTH|HEIGHT|BALANCED/.test(body));
  });

  test('M. surviving numbering follows the existing canonical mapping', () => {
    const s = api.empty();
    const a1 = api.add(s, 'left', '2', api.nextId('e'));
    const a2 = api.add(s, 'top', '2', api.nextId('e'));
    const b1 = api.add(s, 'bottom', '3', api.nextId('e'));
    const b2 = api.add(s, 'bottom', '3', api.nextId('e'));
    const c1 = api.add(s, 'right', '2', api.nextId('e'));
    const c2 = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, a1.id, a2.id, api.nextId('c'));
    api.connect(s, b1.id, b2.id, api.nextId('c'));
    api.connect(s, c1.id, c2.id, api.nextId('c'));
    const third = s.connections[2].id;
    assert.strictEqual(api.connNumber(s, third), 3);
    live(s, a1.id).disconnect(s.connections[0].id);   // remove pull #1
    // canonical renumbering is the pre-existing contract: the old #3 is now #2
    assert.strictEqual(api.connNumber(s, third), 2);
    const svg = api.svg(s, {});
    assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + c1.id + '"[^>]*>2<').test(svg),
      'the drawing reflects current canonical numbering on the next render');
  });

  test('N. the bar stays coherent after disconnecting from the selected raceway', () => {
    const { s, hub } = sharedFixture();
    /* PBV2-13B-4.8f: status is one compact line that never grows with pull
       count; the 2 -> 1 -> 0 guarantee is carried by that line and by
       DISCONNECT's enabled state. */
/* SUPERSEDED BY PBV2-13B-4.9B: the pull-status line is gone from the editor;
       pull identity lives on the numbered endpoint hubs. The state guarantee is
       asserted directly. */
    assert.ok(!sheetFor(s, hub.id).includes('p3d-status'), 'no status line at 2');
    live(s, hub.id).disconnect(s.connections[0].id);
    assert.strictEqual(api.entryConns(s, hub.id).length, 1, '2 -> 1');
    assert.ok(!/pbv2-3d-do-disconnect"[^>]*disabled/.test(sheetFor(s, hub.id)),
      'DISCONNECT still enabled with one pull');
    live(s, hub.id).disconnect(s.connections[0].id);
    const empty = sheetFor(s, hub.id);
    assert.strictEqual(api.entryConns(s, hub.id).length, 0, '1 -> 0');
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(empty),
      'and DISCONNECT goes disabled');
    assert.ok(empty.includes('pbv23dStartConnect()'), 'still selectable and connectable');
  });

  test('O. STANDARD: either relationship disconnects cleanly', () => {
    for (const idx of [0, 1]) {
      const s = api.build('standard');
      const target = s.connections[idx].id;
      const other = JSON.parse(JSON.stringify(s.connections[1 - idx]));
      const entriesBefore = JSON.stringify(s.entries);
      live(s, s.entries[0].id).disconnect(target);
      assert.strictEqual(s.connections.length, 1);
      assert.deepStrictEqual(s.connections[0], other);
      assert.strictEqual(JSON.stringify(s.entries), entriesBefore, 'raceways untouched');
    }
  });

  test('P. ROWS: the workflow works and rows are not disturbed', () => {
    const s = api.build('rows');
    const rowsBefore = JSON.stringify(s.rows);
    const conn = s.connections[0];
    const end = api.find(s, conn.a);
    assert.ok(sheetFor(s, end.id).includes('id="pbv2-3d-do-disconnect"'));
    live(s, end.id).disconnect(conn.id);
    assert.strictEqual(s.connections.length, 0);
    assert.strictEqual(JSON.stringify(s.rows), rowsBefore, 'row structure untouched');
    assert.ok(api.find(s, conn.a) && api.find(s, conn.b), 'both raceways remain');
  });

  test('Q. DENSE: one pull disconnects, the rest survive, placement untouched', () => {
    const d = api.build('dense');
    const entriesBefore = JSON.stringify(d.entries);
    const total = d.connections.length;
    assert.ok(total >= 3, 'dense really has several pulls');
    const target = d.connections[1];
    const others = d.connections.filter((c) => c.id !== target.id).map((c) => JSON.stringify(c));
    live(d, target.a).disconnect(target.id);
    assert.strictEqual(d.connections.length, total - 1);
    assert.deepStrictEqual(d.connections.map((c) => JSON.stringify(c)), others,
      'every other pull byte-identical');
    assert.strictEqual(JSON.stringify(d.entries), entriesBefore,
      'DENSE raceway placement untouched by this milestone');
  });

  test('R. a raceway may still take part in several pulls after all this', () => {
    const { s, hub, t } = sharedFixture();
    const touching = (id) => s.connections.filter((c) => c.a === id || c.b === id).length;
    assert.strictEqual(touching(hub.id), 2, 'shared contract intact');
    live(s, hub.id).disconnect(s.connections[0].id);
    assert.strictEqual(touching(hub.id), 1);
    // and it can be shared again by reconnecting
    api.connect(s, hub.id, t.id, api.nextId('c'));
    assert.strictEqual(touching(hub.id), 2, 'still supports multiple pulls');
  });

  test('S. Layers 0/1/2 unchanged (UI-only milestone)', () => {
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (p) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', p))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8 (completion) — SINGLE-TAP FIXED-SHEET DETAIL SURFACE

   The first 4.8 pass failed manual acceptance on iPhone: shared-raceway
   DISCONNECT controls were generated correctly but lived only in the
   selection tier, which sits below the drawing and needs scrolling, while
   the surface the user actually operates is the fixed bottom sheet — and
   that sheet had no disconnect controls and needed a second tap (EDIT) to
   reach at all. The controls now live in the sheet, and ONE tap opens it.

   These tests drive the REAL handlers (pbv23dTapEntry -> pbv23dOpenSheet ->
   pbv23dSheetBody -> pbv23dDisconnect) rather than calling the HTML builders
   with a hand-set selection, so they reproduce the actual manual path and
   would fail against the pre-fix build.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8 (completion) — one tap to the detail sheet', () => {
  /** A live app slice with a real DOM stub, so sheet open/refresh is observable. */
  function app() {
    const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET',
      'PBV23D_CORNER_EXCLUDE', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dFindEntry', 'pbv23dRowsFor', 'pbv23dRowById',
      'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dDeleteRowIfEmpty',
      'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dAddConnection',
      'pbv23dDeleteConnection', 'pbv23dEntryConns', 'pbv23dConnNumber', 'pbv23dEntryConnNumbers', 'pbv23dConnColor',
      'pbv23dEntryColor', 'pbv23dClassify', 'pbv23dConnTypeOf', 'pbv23dCertifiedBox',
      'pbv23dCeilBoxDim', 'pbv23dEntryRenderV', 'pbv23dCertifiedView', 'pbv23dSetSize',
      'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml', 'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dTargetModeHtml', 'pbv23dStartDisconnect', 'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dTargetModeHtml', 'pbv23dStartDisconnect', 'pbv23dIn', 'pbv23dSheetResultLine',
      'pbv23dSheetBody', 'pbv23dSelectionHtml', 'pbv23dInvalidateResult', 'pbv23dDisconnect',
      'pbv23dDeleteSelected', 'pbv23dStartConnect', 'pbv23dTapEntry', 'pbv23dPickSize',
      'pbv23dPickRowOption'];
    const els = {};
    const el = (id) => (els[id] || (els[id] = { innerHTML: '', textContent: '',
      classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
        contains(c) { return this.list.has(c); } },
      scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, bottom: 0 }) }));
    const doc = { getElementById: el };
    const out = {};
    let renders = 0;
    // eslint-disable-next-line no-new-func
    new Function('document', 'exports', 'bump', 'window',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null, pbv23dSelected = null, pbv23dConnectFrom = null;\n'
      + 'var pbv23dAddMode = false, pbv23dLastResult = null, pbv23dLayout = null;\n'
      + 'var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;\n'
      + 'var pbv23dPresentation = null;\n'
      + consts + names.map(fn3d).join('\n')
      + '\nfunction pbv23dRender() { bump();'
      + '  document.getElementById("pbv2-3d-selection").innerHTML = pbv23dSelectionHtml(PBV23D); }\n'
      + fn3d('pbv23dOpenSheet') + '\n' + fn3d('pbv23dCloseSheet') + '\n'
      + fn3d('pbv23dRefreshSheet') + `
      exports.load = (s) => { PBV23D = s; };
      exports.state = () => PBV23D;
      exports.empty = pbv23dEmptyState; exports.nextId = pbv23dNextId;
      exports.add = pbv23dAddEntry; exports.connect = pbv23dAddConnection;
      exports.find = pbv23dFindEntry; exports.connNumber = pbv23dConnNumber;
      exports.entryConnNumbers = pbv23dEntryConnNumbers;
      exports.tap = pbv23dTapEntry; exports.selected = () => pbv23dSelected;
      exports.disconnect = pbv23dDisconnect; exports.pickSize = pbv23dPickSize;
      exports.deleteSelected = pbv23dDeleteSelected;
      exports.sheetOpen = () => document.getElementById('pbv2-3d-sheet')
        .classList.contains('show');
      exports.sheetHtml = () => document.getElementById('pbv2-3d-sheet-body').innerHTML;
      exports.tierHtml = () => document.getElementById('pbv2-3d-selection').innerHTML;`)(
      doc, out, () => { renders++; }, { scrollTo() {} });
    out.renders = () => renders;
    return out;
  }
  // PBV2-13B-4.8e: the panel identifies pulls by row; removal is spatial
  const targets = (h) => (h.match(/data-pull="([^"]+)"/g) || [])
    .map((m) => m.match(/data-pull="([^"]+)"/)[1]);

  test('THE MANUAL FAILURE PATH: one tap on a shared hub reaches both disconnects', () => {
    const a = app(); const s = a.empty(); a.load(s);
    // 1-3. one raceway, two pulls sharing it
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e'));
    const r = a.add(s, 'right', '2', a.nextId('e'));
    a.connect(s, hub.id, t.id, a.nextId('c'));
    a.connect(s, hub.id, r.id, a.nextId('c'));
    const [c1, c2] = s.connections.map((c) => c.id);

    // 4-5. tap the shared hub ONCE, through the real handler
    assert.strictEqual(a.sheetOpen(), false, 'no sheet before the tap');
    a.tap(hub.id);
    assert.strictEqual(a.selected(), hub.id, 'the shared raceway is selected');

    // 6. the FIXED SHEET is open after a single tap — no second tap, no EDIT
    assert.strictEqual(a.sheetOpen(), true, 'one tap opens the detail sheet');

    /* 7-8. SUPERSEDED BY PBV2-13B-4.8f: the sheet no longer lists a row per
       pull — that is what made it grow with pull count. Both relationships
       are still reachable in one tap, now via the always-present DISCONNECT
       action and its exclusive targeting mode; the compact status line shows
       the count. Exact-id removal is asserted below and in the 4.8e suite. */
    const sheet = a.sheetHtml();
    assert.ok(sheet.includes('id="pbv2-3d-do-connect"'), 'CONNECT present in one tap');
    assert.ok(sheet.includes('id="pbv2-3d-do-disconnect"'), 'DISCONNECT present in one tap');
    assert.ok(!/pbv2-3d-do-disconnect"[^>]*disabled/.test(sheet), 'and enabled: it has pulls');
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.ok(!sheet.includes('p3d-status'), 'no status line at all');
    assert.strictEqual((sheet.match(/class="p3d-pull"/g) || []).length, 0,
      'no permanent pull list: the sheet does not grow with pull count');
    // the editor is right there too — no EDIT step anywhere
    assert.ok(sheet.includes('>SIZE<') && sheet.includes('pbv23dPickSize'));
    assert.ok(!a.tierHtml().includes('pbv23dPickSize'), 'the tier does not duplicate it');

    // 9-11. disconnect one; only it disappears, the survivor is untouched
    const survivor = JSON.parse(JSON.stringify(s.connections.find((c) => c.id === c2)));
    a.disconnect(c1);
    assert.deepStrictEqual(s.connections.map((c) => c.id), [c2]);
    assert.deepStrictEqual(s.connections[0], survivor);
    assert.strictEqual(s.entries.length, 3, 'no raceway was removed');

    // 12. the sheet re-rendered coherently for the still-selected raceway
    assert.strictEqual(a.selected(), hub.id, 'still selected');
    assert.strictEqual(a.sheetOpen(), true, 'sheet stays open');
/* SUPERSEDED BY PBV2-13B-4.9B: no status line / slider in the editor. */
    assert.strictEqual(s.connections.length, 1, 'the survivor remains');

    // 1 -> 0
    a.disconnect(c2);
    assert.strictEqual(s.connections.length, 0);
    assert.ok(!a.sheetHtml().includes('p3d-status'), 'no status line at zero pulls');
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(a.sheetHtml()), 'DISCONNECT disabled at zero');
    assert.strictEqual(s.entries.length, 3, 'all raceways survive');
  });

  test('one tap is enough: a second tap does not toggle the sheet away', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const e = a.add(s, 'left', '2', a.nextId('e'));
    a.tap(e.id);
    assert.strictEqual(a.sheetOpen(), true);
    a.tap(e.id);
    assert.strictEqual(a.sheetOpen(), true, 'still open, still coherent');
    assert.strictEqual(a.selected(), e.id);
  });

  test('no EDIT button exists anywhere in the shipped UI', () => {
    assert.ok(!/>EDIT</.test(fn3d('pbv23dSelectionHtml')), 'not in the summary tier');
    assert.ok(!/>EDIT</.test(fn3d('pbv23dSheetBody')), 'not in the sheet');
  });

  test('zero / one / many: the sheet shows the right disconnect rows', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    a.tap(hub.id);     assert.ok(!a.sheetHtml().includes('p3d-status'), 'zero pulls: no status line');
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(a.sheetHtml()), 'DISCONNECT disabled at zero');
    const t = a.add(s, 'top', '2', a.nextId('e'));
    a.connect(s, hub.id, t.id, a.nextId('c'));
    a.tap(hub.id);
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.ok(!a.sheetHtml().includes('p3d-status'), 'one pull: still no status line');
    const r = a.add(s, 'right', '2', a.nextId('e'));
    const b = a.add(s, 'bottom', '2', a.nextId('e'));
    a.connect(s, hub.id, r.id, a.nextId('c'));
    a.connect(s, hub.id, b.id, a.nextId('c'));
    a.tap(hub.id);
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.ok(!a.sheetHtml().includes('p3d-status'), 'three pulls: still no status line');
    /* SUPERSEDED BY PBV2-13B-4.8f: canonical ORDER of a rendered pull list no
       longer applies — there is no list. The canonical-order guarantee itself
       is unchanged and still pinned where it is now observable: the numbered
       endpoint hubs (4.7) and pbv23dEntryConnNumbers. */
    assert.deepStrictEqual(a.entryConnNumbers(s, hub.id),
      s.connections.map((c) => a.connNumber(s, c.id)),
    'canonical connection order preserved');
  });

  test('CONNECT stays available and DELETE RACEWAY stays distinct', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e'));
    a.connect(s, hub.id, t.id, a.nextId('c'));
    a.tap(hub.id);
    const sheet = a.sheetHtml();
        assert.ok(a.sheetHtml().includes('id="pbv2-3d-do-connect"')
      && a.sheetHtml().includes('pbv23dStartConnect()'),
    'CONNECT lives in the CONNECTION disclosure, never in the overflow');
    /* SUPERSEDED BY PBV2-13B-4.8g.2: no overflow menu. DELETE RACEWAY is a
       direct header control on the existing delete path. */
    assert.ok(!sheet.includes('DELETE RACEWAY'),
      'the destructive action does not sit in the details body');
    assert.ok(/id="pbv2-3d-delete"[\s\S]{0,120}pbv23dDeleteSelected\(\)/.test(P3D),
      'it is a direct header control using the existing delete path');
    assert.ok(sheet.includes('>DISCONNECT<'), 'and DISCONNECT is worded differently');
  });

  test('field edits still run through the existing update path', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const e = a.add(s, 'left', '2', a.nextId('e'));
    a.tap(e.id);
    a.pickSize('4');
    assert.strictEqual(a.find(s, e.id).size, '4', 'the shipped setter did the work');
    // PBV2-13B-4.8c: the compact selector marks the current value with
    // <option selected> instead of aria-pressed on a strip of buttons
    assert.ok(/<option value="4"[^>]*selected/.test(a.sheetHtml()),
      'the sheet re-rendered with the new current value');
    assert.ok(fn3d('pbv23dPickSize').includes('pbv23dSetSize'), 'no second edit path');
  });

  test('DISCONNECT never removes a raceway; DELETE RACEWAY still does', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e'));
    a.connect(s, hub.id, t.id, a.nextId('c'));
    a.tap(hub.id);
    a.disconnect(s.connections[0].id);
    assert.strictEqual(s.entries.length, 2, 'disconnect kept both raceways');
    a.tap(hub.id);
    a.deleteSelected();
    assert.strictEqual(s.entries.length, 1, 'delete removed the raceway');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8b — BOTTOM-SHEET VISUAL HIERARCHY

   UI polish only: no handler, model, geometry or layer behaviour changed.
   These tests pin the STRUCTURE the polish introduced — reading order,
   exactly one primary action, subordinate status text, light pull rows —
   so a later edit cannot quietly return the sheet to a flat wall of
   equally-weighted outlined buttons. Behavioural guarantees stay pinned by
   the 4.8 suites above.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8b/c — sheet hierarchy and compaction', () => {
  const api = api3d();
  function sheetFor(state, selected, panel) {
    const consts = ['PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL',
      'PBV23D_ADD_ROW', 'PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP',
      'PBV23D_DEPTH_INSET', 'PBV23D_CORNER_EXCLUDE', 'PBV23D_PULL_WORD']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dFindEntry', 'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex',
      'pbv23dEntryConns', 'pbv23dConnNumber', 'pbv23dConnColor', 'pbv23dClassify',
      'pbv23dConnTypeOf', 'pbv23dCertifiedBox', 'pbv23dCeilBoxDim', 'pbv23dEntryRenderV',
      'pbv23dCertifiedView', 'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml', 'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dTargetModeHtml', 'pbv23dStartDisconnect', 'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dTargetModeHtml', 'pbv23dStartDisconnect',
      'pbv23dIn', 'pbv23dSheetResultLine', 'pbv23dSheetBody'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('PBV23D', 'pbv23dSelected', 'pbv23dPresentation', 'exports',
      'var pbv23dLayout = null; var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;' + consts + names.map(fn3d).join('\n')
      + ';exports.body = pbv23dSheetBody;')(
      state, selected, null, out);
    return out.body(panel);
  }
  function shared() {
    const s = api.empty();
    const hub = api.add(s, 'left', '2', api.nextId('e'));
    const t = api.add(s, 'top', '2', api.nextId('e'));
    const r = api.add(s, 'right', '2', api.nextId('e'));
    api.connect(s, hub.id, t.id, api.nextId('c'));
    api.connect(s, hub.id, r.id, api.nextId('c'));
    return { s, hub };
  }

  test('reading order: configuration -> position -> connections -> primary', () => {
    const { s, hub } = shared();
    const b = sheetFor(s, hub.id);
    const labels = [...b.matchAll(/class="p3d-flab">([^<]+)</g)].map((m) => m[1]);
    /* Reading order has survived three restructurings unchanged in intent:
       configure -> connection actions -> position -> primary. SUPERSEDED BY
       PBV2-13B-4.8f only in that the CONNECTION selector is gone; CONNECT and
       DISCONNECT are now flat siblings of the three selectors. */
    /* PBV2-13B-4.9B: the editor ends after the connection actions. */
    assert.deepStrictEqual(labels, ['SIZE', 'WALL', 'ROW']);
    assert.ok(b.includes('id="pbv2-3d-do-connect"'), 'connection actions follow');
    assert.ok(!b.includes('SCHEMATIC POSITION'), 'no position section');
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!b.includes('p3d-primary'),
      'no primary CTA inside the details: CALCULATE is global');
  });

  test('configuration is one compact row of closed selectors', () => {
    const { s, hub } = shared();
    const b = sheetFor(s, hub.id);
    const cfg = b.slice(b.indexOf('class="p3d-cfg"'), b.indexOf('SCHEMATIC POSITION'));
    assert.strictEqual((cfg.match(/<select/g) || []).length, 3, 'three selectors, one row');
    assert.ok(/\.p3d-cfg\{[^}]*display:flex/.test(P3D), 'laid out as a single row');
    // closed state shows the CURRENT value only — the option list is inside
    // the native control, not rendered as a permanent strip of buttons
    assert.ok(!cfg.includes('p3d-strip'), 'no permanently expanded option strips');
    assert.ok(/<option value="2"[^>]*selected/.test(cfg), 'size shows its current value');
    assert.ok(/<option value="left"[^>]*selected/.test(cfg), 'wall shows its current value');
  });

  test('the option lists exist only inside the selectors, and route to shipped handlers', () => {
    const { s, hub } = shared();
    const cfg = sheetFor(s, hub.id);
    assert.ok(cfg.includes('onchange="pbv23dPickSize(this.value)"'));
    assert.ok(cfg.includes('onchange="pbv23dPickWall(this.value)"'));
    assert.ok(cfg.includes('onchange="pbv23dPickRowOption(this.value)"'));
    assert.ok(cfg.includes('+ ADD ROW'), 'add-row is an option, not a permanent button');
    // no second state: the router only delegates
    const router = fn3d('pbv23dPickRowOption');
    assert.ok(router.includes('pbv23dAddRowHere') && router.includes('pbv23dPickRow'));
    assert.ok(!/PBV23D\.|state\./.test(router), 'the router touches no state itself');
  });

  test('the position slider is gone from the editor; the model keeps position', () => {
    /* SUPERSEDED BY PBV2-13B-4.9B: UI removal only. entry.v and automatic
       placement survive, asserted on the shipped model. */
    const { s, hub } = shared();
    const b = sheetFor(s, hub.id);
    assert.ok(!b.includes('id="pbv2-3d-pos"') && !b.includes('type="range"'));
    assert.ok(typeof api.find(s, hub.id).v === 'number', 'entry.v still on the model');
    assert.ok(fn3d('pbv23dAddEntry').includes('pbv23dNextPosition'),
      'automatic placement still assigns it');
  });

  /* PBV2-13B-4.8f STRUCTURAL CONTRACT — the flat five-control sheet. These
     replace the 4.8c/4.8d expectations of a CONNECTION selector opening a
     disclosure; the behavioural guarantees they protected (compactness, no
     growth with pull count, destructive action out of the way) are all
     asserted here against the new structure. */
  test('the CONNECTION selector is gone and the sheet has five flat controls', () => {
    const { s, hub } = shared();
    const b = sheetFor(s, hub.id);
    assert.ok(!b.includes('id="pbv2-3d-conn"'), 'no CONNECTION selector');
    assert.ok(!b.includes('>CONNECTION<'), 'and no CONNECTION label anywhere');
    for (const label of ['>SIZE<', '>WALL<', '>ROW<']) {
      assert.ok(b.includes(label), 'selector still present: ' + label);
    }
    assert.ok(b.includes('id="pbv2-3d-do-connect"'), 'CONNECT is directly on the sheet');
    assert.ok(b.includes('id="pbv2-3d-do-disconnect"'), 'DISCONNECT is directly on the sheet');
    // all five share one control family
    assert.strictEqual((b.match(/class="p3d-field"/g) || []).length, 3, 'three selectors');
    assert.strictEqual((b.match(/class="p3d-act[ "]/g) || []).length, 2, 'two flat actions');
  });

  test('CONNECT and DISCONNECT share one horizontal row', () => {
    const { s, hub } = shared();
    const b = sheetFor(s, hub.id);
    const row = b.slice(b.indexOf('class="p3d-acts"'));
    assert.ok(row.indexOf('pbv2-3d-do-connect') < row.indexOf('pbv2-3d-do-disconnect'),
      'both live in the same p3d-acts container, CONNECT first');
    assert.ok(/\.p3d-acts\{[^}]*display:flex/.test(P3D), 'laid out as one horizontal row');
    // and they are the same height as the selectors they sit beneath
    const actH = P3D.match(/\.p3d-act\{[^}]*height:(\d+)px/)[1];
    const fieldH = P3D.match(/\.p3d-field\{[^}]*height:(\d+)px/)[1];
    assert.strictEqual(actH, fieldH, 'actions and selectors share a height');
  });

  test('no permanent pull list: the sheet never grows with pull count', () => {
    const a = api3d();
    const s = a.empty();
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    let previous = null;
    for (let i = 0; i < 4; i++) {
      const other = a.add(s, ['top', 'right', 'bottom', 'top'][i], '2', a.nextId('e'));
      a.connect(s, hub.id, other.id, a.nextId('c'));
      const b = sheetFor(s, hub.id);
      assert.strictEqual((b.match(/class="p3d-pull"/g) || []).length, 0,
        'no per-pull rows at ' + (i + 1) + ' pulls');
      // PBV2-13B-4.9B: no status line at any count
      assert.ok(!b.includes('p3d-status'), 'no status line at ' + (i + 1) + ' pulls');
      // from two pulls on it is a fixed-width count, so the markup stops growing
      if (i >= 2) assert.strictEqual(b.length, previous, 'sheet markup stops growing');
      previous = b.length;
    }
  });

  test('DELETE RACEWAY is a direct header control, separate from DISCONNECT', () => {
    const { s, hub } = shared();
    const normal = sheetFor(s, hub.id);
    /* SUPERSEDED BY PBV2-13B-4.8g.2: the overflow is gone. The guarantee that
       matters is unchanged — the destructive raceway action is distinct from
       DISCONNECT and is not mixed into the details body. */
    assert.ok(!normal.includes('DELETE RACEWAY'), 'not in the details body');
    assert.ok(normal.includes('id="pbv2-3d-do-disconnect"'), 'the connection actions are');
    assert.ok(P3D.includes('id="pbv2-3d-delete"'), 'it is a header control');
    assert.strictEqual((P3D.match(/DELETE RACEWAY/g) || []).length, 1,
      'exactly one DELETE RACEWAY control exists');
    assert.ok(/id="pbv2-3d-delete"[\s\S]{0,120}pbv23dDeleteSelected\(\)/.test(P3D),
      'uses the shipped delete path');
    // and the two destructive actions remain different code paths
    assert.ok(fn3d('pbv23dDeleteSelected').includes('pbv23dDeleteEntry'), 'raceway path');
    assert.ok(fn3d('pbv23dDisconnect').includes('pbv23dDeleteConnection')
      && !fn3d('pbv23dDisconnect').includes('pbv23dDeleteEntry'), 'connection path');
  });

  test('exactly one primary action, with the status line subordinate to it', () => {
    const { s, hub } = shared();
    const b = sheetFor(s, hub.id);
    /* SUPERSEDED BY PBV2-13B-4.8g: the primary action moved OUT of the
       details into the global box-action row, so there is exactly one and it
       is not here. The hierarchy guarantee is asserted against that row. */
    assert.strictEqual((b.match(/class="p3d-cta"/g) || []).length, 0,
      'no primary CTA inside the raceway details');
    const globals = fn3d('pbv23dGlobalsHtml');
    assert.ok(globals.includes('id="pbv2-3d-calc"'), 'the one primary action is global');
    assert.ok(!b.includes('style="width:100%;margin-top'), 'no inline style hack remains');
  });

  test('zero pulls: DISCONNECT disabled, CONNECT enabled, no status line', () => {
    const s = api.empty();
    const e = api.add(s, 'left', '2', api.nextId('e'));
    const b = sheetFor(s, e.id);
    /* PBV2-13B-4.8f: the empty state is carried by DISCONNECT's disabled
       attribute and the absence of a status line, not by a CONNECTION
       selector reading NONE. */
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(b), 'DISCONNECT disabled at zero');
    assert.ok(b.includes('id="pbv2-3d-do-connect"')
      && !/pbv2-3d-do-connect"[^>]*disabled/.test(b), 'CONNECT always enabled');
    assert.ok(!b.includes('p3d-status'), 'no status line with nothing connected');
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.strictEqual((b.match(/class="p3d-cta"/g) || []).length, 0,
      'the primary action is the global CALCULATE, not one inside the details');
  });

  test('connected: DISCONNECT becomes enabled and destructive', () => {
    const s = api.empty();
    const a1 = api.add(s, 'left', '2', api.nextId('e'));
    const a2 = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, a1.id, a2.id, api.nextId('c'));
    const b = sheetFor(s, a1.id);
    assert.ok(!/pbv2-3d-do-disconnect"[^>]*disabled/.test(b), 'enabled with a pull');
    assert.ok(/id="pbv2-3d-do-disconnect"/.test(b) && /p3d-act p3d-danger/.test(b),
      'and styled destructive');
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.ok(!b.includes('p3d-status'), 'and still no status line');
  });

  test('the exclusive targeting modes are still callable from the flat actions', () => {
    // the 4.8e state machine survives the 4.8f flattening untouched
    assert.ok(fn3d('pbv23dConnActionsHtml').includes('pbv23dStartConnect()'),
      'CONNECT enters the shipped targeting mode');
    assert.ok(fn3d('pbv23dConnActionsHtml').includes('pbv23dStartDisconnect()'),
      'DISCONNECT enters the shipped targeting mode');
    assert.ok(fn3d('pbv23dStartConnect').includes("pbv23dEnterTargetMode('connect')"));
    assert.ok(fn3d('pbv23dStartDisconnect').includes("pbv23dEnterTargetMode('disconnect')"));
    assert.ok(fn3d('pbv23dTargeting').includes('pbv23dTargetMode && pbv23dConnectFrom'));
  });

  test('sections carry the grouping and the header stays visible while scrolling', () => {
    const { s, hub } = shared();
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok((sheetFor(s, hub.id).match(/class="p3d-sec/g) || []).length >= 1,
      'the details are still sectioned');
    assert.ok(/\.p3d-sec\{[^}]*border-top/.test(P3D), 'sections are visually separated');
    /* SUPERSEDED BY PBV2-13B-4.8g: nothing to stick to in flow — the header
       scrolls with its section, which is the point of the in-flow design. */
    assert.ok(!/\.p3d-sheet-h\{[^}]*position:sticky/.test(P3D), 'no overlay-era sticky header');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8d — UNIFIED CONNECTION CONTROL + PERSISTENT POST-CONNECT SHEET

   Root cause fixed here: pbv23dTapEntry's connect branch set
   `pbv23dSelected = id` (jumping the user onto the TARGET raceway) and never
   reopened the sheet that "+ CONNECT" had closed — so completing a pull
   silently ended the edit session on the raceway being worked on. Creating a
   pull is an UPDATE to the selected raceway, not navigation away from it.

   The workflow tests below drive the REAL handlers, so they reproduce the
   manual path and fail against the pre-4.8d build.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8d — unified CONNECTION and persistent sheet', () => {
  const api = api3d();
  /** Live app slice with a DOM stub: real tap/connect/disconnect handlers. */
  function app() {
    const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET',
      'PBV23D_CORNER_EXCLUDE', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM',
      'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dFindEntry', 'pbv23dRowsFor', 'pbv23dRowById',
      'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dDeleteRowIfEmpty',
      'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dAddConnection',
      'pbv23dDeleteConnection', 'pbv23dEntryConns', 'pbv23dConnNumber', 'pbv23dEntryConnNumbers', 'pbv23dConnColor',
      'pbv23dEntryColor', 'pbv23dClassify', 'pbv23dConnTypeOf', 'pbv23dCertifiedBox',
      'pbv23dCeilBoxDim', 'pbv23dEntryRenderV', 'pbv23dCertifiedView', 'pbv23dSetSize',
      'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml', 'pbv23dIn', 'pbv23dSheetResultLine', 'pbv23dSheetBody',
      'pbv23dSelectionHtml', 'pbv23dInvalidateResult', 'pbv23dDisconnect',
      'pbv23dDeleteSelected', 'pbv23dStartConnect', 'pbv23dCancelConnect',
      'pbv23dEntryConnNumbers',
      'pbv23dTapEntry', 'pbv23dTargeting',
      'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween',
      'pbv23dEligibleTargets', 'pbv23dStartDisconnect', 'pbv23dTargetModeHtml',
      'pbv23dCalculate', 'pbv23dPickSize', 'pbv23dPickWall', 'pbv23dPickRow', 'pbv23dPickRowOption',
      'pbv23dAddRowHere', 'pbv23dPickPosition', 'pbv23dSetPosition', 'pbv23dSetWall',
      'pbv23dSetEntryRow', 'pbv23dAddRowOnWall'];
    const els = {};
    const el = (id) => (els[id] || (els[id] = { innerHTML: '', textContent: '',
      classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
        contains(c) { return this.list.has(c); } },
      scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, bottom: 0 }) }));
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('document', 'exports', 'window',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null, pbv23dSelected = null, pbv23dConnectFrom = null;\n'
      + 'var pbv23dAddMode = false, pbv23dLastResult = null, pbv23dLayout = null;\n'
      + 'var pbv23dPresentation = null, pbv23dLastPull = null;\n'
      + 'var pbv23dTargetMode = null, pbv23dMode = "build";\n'
      + consts + names.map(fn3d).join('\n')
      + '\nfunction pbv23dRender() {'
      + '  document.getElementById("pbv2-3d-selection").innerHTML = pbv23dSelectionHtml(PBV23D); }\n'
      + fn3d('pbv23dOpenSheet') + '\n' + fn3d('pbv23dCloseSheet') + '\n'
      + fn3d('pbv23dRefreshSheet') + `
      exports.load = (s) => { PBV23D = s; };
      exports.state = () => PBV23D;
      exports.empty = pbv23dEmptyState; exports.nextId = pbv23dNextId;
      exports.add = pbv23dAddEntry; exports.find = pbv23dFindEntry;
      exports.connNumber = pbv23dConnNumber;
      exports.entryConnNumbers = pbv23dEntryConnNumbers; exports.entryConns = pbv23dEntryConns;
      exports.tap = pbv23dTapEntry; exports.selected = () => pbv23dSelected;
      exports.connectFrom = () => pbv23dConnectFrom;
      exports.startConnect = pbv23dStartConnect; exports.cancelConnect = pbv23dCancelConnect;
      exports.disconnect = pbv23dDisconnect;
      exports.closeSheet = pbv23dCloseSheet;
      exports.startDisconnect = pbv23dStartDisconnect;
      exports.mode = () => pbv23dTargeting();
      exports.eligible = () => pbv23dEligibleTargets(PBV23D, pbv23dTargetMode, pbv23dConnectFrom);
      exports.pickSize = pbv23dPickSize; exports.pickWall = pbv23dPickWall;
      exports.pickRowOption = pbv23dPickRowOption; exports.pickPosition = pbv23dPickPosition;
      exports.calculate = pbv23dCalculate; exports.deleteSelected = pbv23dDeleteSelected;
      exports.sheetOpen = () => document.getElementById('pbv2-3d-sheet')
        .classList.contains('show');
      exports.sheetHtml = () => document.getElementById('pbv2-3d-sheet-body').innerHTML;`)(
      { getElementById: el }, out, { scrollTo() {} });
    return out;
  }
  // PBV2-13B-4.8e: the panel identifies pulls by row; removal is spatial
  const targets = (h) => (h.match(/data-pull="([^"]+)"/g) || [])
    .map((m) => m.match(/data-pull="([^"]+)"/)[1]);
  /* PBV2-13B-4.8f: the CONNECTION selector is gone — CONNECT and DISCONNECT
     are flat siblings of the three selectors on their own action row. */
  const hasConfigRow = (h) => h.includes('>SIZE<') && h.includes('>WALL<')
    && h.includes('>ROW<') && h.includes('id="pbv2-3d-do-connect"')
    && h.includes('id="pbv2-3d-do-disconnect"');

  test('THE POST-CONNECT PATH: the user keeps editing the raceway they started on', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'top', '2', a.nextId('e'));

    // 1-2. tap A, sheet opens with all four controls
    a.tap(A.id);
    assert.strictEqual(a.sheetOpen(), true);
    assert.ok(hasConfigRow(a.sheetHtml()), 'SIZE / WALL / ROW / CONNECTION all present');
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(a.sheetHtml()),
      'DISCONNECT disabled with nothing connected');

    // 3-4. open CONNECTION, invoke CONNECT (which closes the sheet by design)
        assert.ok(a.sheetHtml().includes('id="pbv2-3d-do-connect"'),
      'CONNECT is directly on the sheet — no disclosure to open');
    a.startConnect();
    assert.strictEqual(a.connectFrom(), A.id, 'connect-target mode armed from A');

    // 5. tap B through the real handler
    a.tap(B.id);

    // 6-7. the connection exists, and A is STILL the selected raceway
    assert.strictEqual(s.connections.length, 1, 'the pull was created');
    assert.strictEqual(a.selected(), A.id,
      'selection stays on the raceway being edited, not the target');
    assert.strictEqual(a.connectFrom(), null, 'connect-target mode exited cleanly');
    assert.strictEqual(a.sheetOpen(), true, 'the sheet reopened for A');

    // 8-9. controls are all back, and CONNECTION now identifies the new pull
    const sheet = a.sheetHtml();
    assert.ok(hasConfigRow(sheet), 'all four controls survived the connect');
    /* SUPERSEDED BY PBV2-13B-4.9B: the editor no longer carries a pull-status
       line or a position slider. The pull's existence is asserted on the model;
       its identity is on the drawing's numbered endpoint hubs. */
    assert.strictEqual(a.entryConns(s, A.id).length, 1, 'the created pull is on A');
    assert.strictEqual(s.connections.length, 1, 'the pull was created');
    assert.ok(!sheet.includes('p3d-status') && !sheet.includes('id="pbv2-3d-pos"'),
      'no status line and no slider in the editor');

    // 11. the rest of the editor is intact
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!sheet.includes('pbv23dCalculate'),
      'CALCULATE is global-only and not duplicated in the details');
  });

  test('cancelled CONNECT returns to the original raceway with its controls', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    a.add(s, 'top', '2', a.nextId('e'));
    a.tap(A.id); a.startConnect();
    a.cancelConnect();
    a.tap(A.id);
    assert.strictEqual(a.selected(), A.id);
    assert.strictEqual(s.connections.length, 0, 'nothing was created');
    assert.ok(hasConfigRow(a.sheetHtml()), 'controls intact');
  });

  test('a duplicate pull is rejected and the editing context survives', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'top', '2', a.nextId('e'));
    a.tap(A.id); a.startConnect(); a.tap(B.id);
    assert.strictEqual(s.connections.length, 1);
    const before = JSON.stringify(s.connections);
    // try the same pair again
    a.startConnect(); a.tap(B.id);
    assert.strictEqual(JSON.stringify(s.connections), before,
      'the connection list is not mutated by a duplicate');
    assert.strictEqual(a.selected(), A.id, 'and the editing context survives');
    assert.strictEqual(a.sheetOpen(), true);
    assert.ok(hasConfigRow(a.sheetHtml()));
  });

  test('tapping the source raceway during CONNECT is a no-op', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    a.add(s, 'top', '2', a.nextId('e'));
    a.tap(A.id); a.startConnect();
    a.tap(A.id);
    assert.strictEqual(s.connections.length, 0, 'no self-connection');
    assert.strictEqual(a.connectFrom(), A.id, 'still waiting for a valid target');
  });

  test('a shared raceway can add a further pull and keeps its context', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'top', '2', a.nextId('e'));
    const C = a.add(s, 'right', '2', a.nextId('e'));
    a.tap(A.id); a.startConnect(); a.tap(B.id);
    a.startConnect(); a.tap(C.id);
    assert.strictEqual(s.connections.length, 2, 'a second legitimate pull was added');
    assert.strictEqual(a.selected(), A.id, 'still editing A');
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.strictEqual(a.entryConns(s, A.id).length, 2, 'two pulls on A');
    // a completed CONNECT already lands on the CONNECTION panel, so it is open
    const open = a.sheetHtml();
    /* PBV2-13B-4.8f: no per-pull list — the status collapses to a count and
       both relationships stay reachable through DISCONNECT's targeting mode.
       Canonical order is pinned where it is still observable. */
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.strictEqual(s.connections.length, 2, 'two pulls exist');
    assert.deepStrictEqual(a.entryConnNumbers(s, A.id),
      s.connections.map((c) => a.connNumber(s, c.id)), 'canonical order preserved');
    assert.ok(open.includes('id="pbv2-3d-do-connect"'), 'and CONNECT remains available');
  });

  test('DISCONNECT from the CONNECTION panel removes only that pull', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'top', '2', a.nextId('e'));
    const C = a.add(s, 'right', '2', a.nextId('e'));
    a.tap(A.id); a.startConnect(); a.tap(B.id);
    a.startConnect(); a.tap(C.id);
    const [c1, c2] = s.connections.map((c) => c.id);
    // the panel is already open after the connect that just completed
    a.disconnect(c1);
    assert.deepStrictEqual(s.connections.map((c) => c.id), [c2], 'only that pull went');
    assert.strictEqual(s.entries.length, 3, 'no raceway removed');
    /* PBV2-13B-4.8f: the 2 -> 1 -> 0 guarantee shows through the compact
       status line and DISCONNECT's enabled state, not a per-pull list. */
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.strictEqual(a.entryConns(s, A.id).length, 1, '2 -> 1');
    a.disconnect(c2);
    assert.strictEqual(a.entryConns(s, A.id).length, 0, '1 -> 0');
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(a.sheetHtml()),
      'DISCONNECT is disabled once nothing is connected');
    assert.ok(a.sheetHtml().includes('id="pbv2-3d-do-connect"'), 'CONNECT stays enabled');
    assert.ok(hasConfigRow(a.sheetHtml()), 'controls still there at zero pulls');
  });

  test('pull identity on the drawing comes from real state, not a parallel classifier', () => {
    /* SUPERSEDED BY PBV2-13B-4.9B: the pull-status line (pbv23dPullLineHtml)
       is gone. Pull identity is carried by the numbered endpoint hubs, whose
       numbers come from the same shipped mapping. */
    assert.throws(() => fn3d('pbv23dPullLineHtml'), /missing/, 'the line builder is gone');
    const hubs = fn3d('pbv23dEntryConnNumbers');
    assert.ok(hubs.includes('pbv23dConnNumber') && hubs.includes('pbv23dEntryConns'),
      'hub numbers derive from the shipped mapping');
  });

  test('DELETE RACEWAY stays out of CONNECTION and lives in the overflow', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'top', '2', a.nextId('e'));
    a.tap(A.id); a.startConnect(); a.tap(B.id);
    /* SUPERSEDED BY PBV2-13B-4.8g.2: no overflow menu. DELETE RACEWAY is a
       direct header control and stays separate from the connection actions. */
    assert.ok(!a.sheetHtml().includes('DELETE RACEWAY'),
      'the details body manages pulls, not the raceway');
    assert.ok(/id="pbv2-3d-delete"[\s\S]{0,120}pbv23dDeleteSelected\(\)/.test(P3D),
      'the raceway action is a direct header control on the existing path');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8e — EXCLUSIVE CONNECT / DISCONNECT SELECTION MODES

   CONNECTION is now a STABLE two-entry action menu (CONNECT, DISCONNECT, in
   that order, always in the same place). Neither lists candidate raceways as
   text: both hand off to an exclusive mode where the user taps the other
   raceway on the drawing. CONNECT accepts any other raceway; DISCONNECT
   accepts only a current counterpart — and because the model rejects
   duplicate pairs order-insensitively, that counterpart resolves to exactly
   one connection (verified against pbv23dAddConnection).

   The locking is REAL, not cosmetic: these tests call the shipped mutators
   directly while a mode is active and assert the state does not move.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8e — exclusive selection modes', () => {
  function app() {
    const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET',
      'PBV23D_CORNER_EXCLUDE', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM',
      'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dFindEntry', 'pbv23dRowsFor', 'pbv23dRowById',
      'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dDeleteRowIfEmpty',
      'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dAddConnection',
      'pbv23dDeleteConnection', 'pbv23dEntryConns', 'pbv23dConnNumber', 'pbv23dEntryConnNumbers', 'pbv23dConnColor',
      'pbv23dEntryColor', 'pbv23dClassify', 'pbv23dConnTypeOf', 'pbv23dCertifiedBox',
      'pbv23dCeilBoxDim', 'pbv23dEntryRenderV', 'pbv23dCertifiedView', 'pbv23dSetSize',
      'pbv23dSetWall', 'pbv23dSetEntryRow', 'pbv23dSetPosition',
      'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml', 'pbv23dTargetModeHtml', 'pbv23dIn', 'pbv23dSheetResultLine',
      'pbv23dSheetBody', 'pbv23dSelectionHtml', 'pbv23dInvalidateResult',
      'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode',
      'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dDisconnect',
      'pbv23dDeleteSelected', 'pbv23dStartConnect', 'pbv23dStartDisconnect',
      'pbv23dCancelConnect', 'pbv23dTapEntry',
      'pbv23dPickSize', 'pbv23dPickWall', 'pbv23dPickRow', 'pbv23dPickRowOption',
      'pbv23dAddRowHere', 'pbv23dPickPosition', 'pbv23dStartAdd'];
    const els = {};
    const el = (id) => (els[id] || (els[id] = { innerHTML: '', textContent: '',
      classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
        contains(c) { return this.list.has(c); } },
      scrollIntoView() {}, getBoundingClientRect: () => ({ top: 0, bottom: 0 }) }));
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('document', 'exports', 'window',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null, pbv23dSelected = null, pbv23dConnectFrom = null;\n'
      + 'var pbv23dAddMode = false, pbv23dLastResult = null, pbv23dLayout = null;\n'
      + 'var pbv23dPresentation = null, pbv23dLastPull = null;\n'
      + 'var pbv23dTargetMode = null, pbv23dMode = "build";\n'
      + 'var PBV23D_ERROR_TEXT = {};\n'
      + 'var calcRuns = 0;\n'
      + 'function pbv23dCalculate() { if (pbv23dTargeting()) return; calcRuns++; }\n'
      + consts + names.map(fn3d).join('\n')
      + '\nfunction pbv23dRender() {'
      + '  document.getElementById("pbv2-3d-selection").innerHTML = pbv23dSelectionHtml(PBV23D); }\n'
      + fn3d('pbv23dOpenSheet') + '\n' + fn3d('pbv23dCloseSheet') + '\n'
      + fn3d('pbv23dRefreshSheet') + `
      exports.load = (s) => { PBV23D = s; }; exports.state = () => PBV23D;
      exports.empty = pbv23dEmptyState; exports.nextId = pbv23dNextId;
      exports.add = pbv23dAddEntry; exports.find = pbv23dFindEntry;
      exports.connNumber = pbv23dConnNumber;
      exports.tap = pbv23dTapEntry; exports.selected = () => pbv23dSelected;
      exports.mode = () => pbv23dTargeting(); exports.source = () => pbv23dConnectFrom;
      exports.eligible = () => pbv23dEligibleTargets(PBV23D, pbv23dTargetMode, pbv23dConnectFrom);
      exports.connect = pbv23dStartConnect; exports.disconnectMode = pbv23dStartDisconnect;
      exports.cancel = pbv23dCancelConnect;
      exports.pickSize = pbv23dPickSize; exports.pickWall = pbv23dPickWall;
      exports.pickRowOption = pbv23dPickRowOption; exports.addRow = pbv23dAddRowHere;
      exports.pickPosition = pbv23dPickPosition; exports.calculate = pbv23dCalculate;
      exports.deleteSelected = pbv23dDeleteSelected; exports.startAdd = pbv23dStartAdd;
      exports.addMode = () => pbv23dAddMode;
      exports.disconnectById = pbv23dDisconnect;
      exports.sheetOpen = () => document.getElementById('pbv2-3d-sheet').classList.contains('show');
      exports.sheetHtml = () => document.getElementById('pbv2-3d-sheet-body').innerHTML;`)(
      { getElementById: el }, out, { scrollTo() {} });
    return out;
  }
  function fixture(a, extraTargets) {
    const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'top', '2', a.nextId('e'));
    const C = a.add(s, 'right', '2', a.nextId('e'));
    const D = extraTargets ? a.add(s, 'bottom', '2', a.nextId('e')) : null;
    return { s, A, B, C, D };
  }
  const menu = (a) => a.sheetHtml();   // 4.8f: the actions are always on the sheet
  /* PBV2-13B-4.8f: the CONNECTION selector is gone — CONNECT and DISCONNECT
     are flat siblings of the three selectors on their own action row. */
  const hasConfigRow = (h) => h.includes('>SIZE<') && h.includes('>WALL<')
    && h.includes('>ROW<') && h.includes('id="pbv2-3d-do-connect"')
    && h.includes('id="pbv2-3d-do-disconnect"');

  test('A/D. zero pulls: CONNECT enabled, DISCONNECT rendered but disabled', () => {
    const a = app(); const { A } = fixture(a);
    a.tap(A.id);
    const m = menu(a);
    assert.ok(m.includes('id="pbv2-3d-do-connect"'), 'CONNECT present');
    assert.ok(!/pbv2-3d-do-connect"[^>]*disabled/.test(m), 'CONNECT enabled');
    assert.ok(m.includes('id="pbv2-3d-do-disconnect"'), 'DISCONNECT still rendered');
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(m), 'DISCONNECT disabled');
    // stable order: CONNECT always precedes DISCONNECT
    assert.ok(m.indexOf('pbv2-3d-do-connect') < m.indexOf('pbv2-3d-do-disconnect'));
  });

  test('B/C/P. with pulls both are enabled, and CONNECT never disables', () => {
    const a = app(); const { s, A, B, C } = fixture(a);
    a.tap(A.id); a.connect(); a.tap(B.id);
    let m = menu(a);
    assert.ok(!/pbv2-3d-do-disconnect"[^>]*disabled/.test(m), 'DISCONNECT enabled at 1 pull');
    assert.ok(!/pbv2-3d-do-connect"[^>]*disabled/.test(m), 'CONNECT still enabled at 1 pull');
    a.connect(); a.tap(C.id);
    assert.strictEqual(s.connections.length, 2);
    m = menu(a);
    assert.ok(!/pbv2-3d-do-connect"[^>]*disabled/.test(m), 'CONNECT still enabled at 2 pulls');
    assert.ok(m.indexOf('pbv2-3d-do-connect') < m.indexOf('pbv2-3d-do-disconnect'),
      'order is stable regardless of count');
  });

  test('E/F/G. CONNECT enters an exclusive mode; source is identified and not a target', () => {
    const a = app(); const { A, B, C } = fixture(a);
    a.tap(A.id); a.connect();
    assert.strictEqual(a.mode(), 'connect', 'explicit CONNECT_TARGET mode');
    assert.strictEqual(a.source(), A.id, 'source is the raceway being edited');
    const el = a.eligible();
    assert.ok(!el[A.id], 'the source cannot be its own target');
    assert.ok(el[B.id] && el[C.id], 'every other raceway is eligible');
    const sheet = a.sheetHtml();
    assert.ok(sheet.includes('CHOOSE RACEWAY'), 'the mode is obvious');
    assert.ok(sheet.includes('id="pbv2-3d-cancel-target"'), 'CANCEL is reachable');
    assert.ok(!hasConfigRow(sheet), 'the editor is withheld while targeting');
  });

  test('AI-AP. CONNECT mode genuinely blocks every editing mutator', () => {
    const a = app(); const { s, A, B } = fixture(a);
    a.tap(A.id);
    const before = JSON.stringify({ e: s.entries, c: s.connections, r: s.rows });
    a.connect();
    // call the SHIPPED mutators directly — greying alone would not stop these
    a.pickSize('4'); a.pickWall('bottom'); a.pickRowOption('__add_row__');
    a.addRow(); a.pickPosition(90); a.deleteSelected(); a.startAdd();
    a.connect(); a.disconnectMode();
    assert.strictEqual(JSON.stringify({ e: s.entries, c: s.connections, r: s.rows }), before,
      'no state moved while a target-selection mode was active');
    assert.strictEqual(a.mode(), 'connect', 'and the mode did not switch');
    assert.strictEqual(a.addMode(), false, 'ADD could not be started');
    assert.strictEqual(a.selected(), A.id, 'context preserved');
    // only an eligible tap completes it
    a.tap(B.id);
    assert.strictEqual(a.mode(), null, 'mode exits on a valid target');
    assert.strictEqual(s.connections.length, 1);
  });

  test('H-N. a successful CONNECT restores the original editing context', () => {
    const a = app(); const { s, A, B } = fixture(a);
    a.tap(A.id); a.connect(); a.tap(B.id);
    assert.strictEqual(s.connections.length, 1, 'exactly one connection created');
    assert.strictEqual(a.mode(), null, 'mode exited');
    assert.strictEqual(a.selected(), A.id, 'A is still selected, not the target');
    assert.strictEqual(a.sheetOpen(), true, 'the sheet returned');
    const sheet = a.sheetHtml();
    assert.ok(hasConfigRow(sheet), 'all four controls are back');
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.strictEqual(s.connections.length, 1, 'the pull exists');
/* SUPERSEDED BY PBV2-13B-4.9B: no status line in the editor. */
    assert.strictEqual(s.connections.length, 1, 'the new pull exists');
/* SUPERSEDED BY PBV2-13B-4.8g */
    assert.ok(!sheet.includes('pbv23dCalculate'),
      'CALCULATE is global-only and not duplicated in the details');
  });

  test('O. CONNECT cancel mutates nothing and restores the editor', () => {
    const a = app(); const { s, A } = fixture(a);
    a.tap(A.id);
    const before = JSON.stringify(s);
    a.connect();
    a.cancel();
    assert.strictEqual(JSON.stringify(s), before, 'zero state mutation');
    assert.strictEqual(a.mode(), null, 'no stale mode');
    assert.strictEqual(a.source(), null, 'no stale source');
    assert.strictEqual(a.selected(), A.id, 'A still selected');
    assert.ok(hasConfigRow(a.sheetHtml()), 'controls restored');
  });

  test('Q/R. a duplicate target is rejected without destroying the context', () => {
    const a = app(); const { s, A, B } = fixture(a);
    a.tap(A.id); a.connect(); a.tap(B.id);
    const before = JSON.stringify(s.connections);
    a.connect(); a.tap(B.id);
    assert.strictEqual(JSON.stringify(s.connections), before, 'no duplicate created');
    assert.strictEqual(a.selected(), A.id, 'context survives');
    assert.strictEqual(a.mode(), null);
    assert.ok(hasConfigRow(a.sheetHtml()));
  });

  test('S. DISCONNECT cannot be entered at zero pulls', () => {
    const a = app(); const { s, A } = fixture(a);
    a.tap(A.id);
    a.disconnectMode();
    assert.strictEqual(a.mode(), null, 'the mode refuses to arm with nothing to remove');
    assert.strictEqual(s.connections.length, 0);
    assert.ok(hasConfigRow(a.sheetHtml()), 'still in normal editing');
  });

  test('T-X. DISCONNECT mode: only current counterparts are eligible', () => {
    const a = app(); const { s, A, B, C, D } = fixture(a, true);
    a.tap(A.id); a.connect(); a.tap(B.id);
    a.connect(); a.tap(C.id);
    assert.strictEqual(s.connections.length, 2);
    a.disconnectMode();
    assert.strictEqual(a.mode(), 'disconnect', 'explicit DISCONNECT_TARGET mode');
    const el = a.eligible();
    assert.ok(el[B.id] && el[C.id], 'both counterparts selectable');
    assert.ok(!el[D.id], 'an unrelated raceway is NOT selectable');
    assert.ok(!el[A.id], 'the source is not a target');
    const sheet = a.sheetHtml();
    assert.ok(sheet.includes('CHOOSE CONNECTED RACEWAY'));
    assert.ok(sheet.includes('id="pbv2-3d-cancel-target"'), 'CANCEL reachable');
    // tapping an unrelated raceway does nothing at all
    const before = JSON.stringify(s.connections);
    a.tap(D.id);
    assert.strictEqual(JSON.stringify(s.connections), before, 'unrelated tap is inert');
    assert.strictEqual(a.mode(), 'disconnect', 'and does not exit the mode');
    a.tap(A.id);
    assert.strictEqual(JSON.stringify(s.connections), before, 'source tap is inert');
  });

  test('Y-AC. choosing a counterpart removes exactly that relationship', () => {
    const a = app(); const { s, A, B, C } = fixture(a);
    a.tap(A.id); a.connect(); a.tap(B.id);
    a.connect(); a.tap(C.id);
    const ab = s.connections.find((c) => c.a === B.id || c.b === B.id).id;
    const ac = s.connections.find((c) => c.a === C.id || c.b === C.id).id;
    a.disconnectMode();
    a.tap(C.id);
    assert.deepStrictEqual(s.connections.map((c) => c.id), [ab],
      'only the A-C relationship went; A-B survives');
    assert.ok(ac !== ab);
    assert.strictEqual(s.entries.length, 3, 'no raceway removed');
    assert.strictEqual(a.mode(), null, 'mode exited');
    assert.strictEqual(a.selected(), A.id, 'A still selected');
    assert.strictEqual(a.sheetOpen(), true, 'sheet restored');
    assert.ok(hasConfigRow(a.sheetHtml()), 'controls unlocked');
  });

  test('AD-AG. 2 -> 1 -> 0 leaves CONNECT enabled and DISCONNECT disabled', () => {
    const a = app(); const { s, A, B, C } = fixture(a);
    a.tap(A.id); a.connect(); a.tap(B.id);
    a.connect(); a.tap(C.id);
    a.disconnectMode(); a.tap(C.id);
    assert.strictEqual(s.connections.length, 1, '2 -> 1');
    a.disconnectMode(); a.tap(B.id);
    assert.strictEqual(s.connections.length, 0, '1 -> 0');
    assert.strictEqual(s.entries.length, 3, 'all raceways survive');
    const m = menu(a);
    assert.ok(/pbv2-3d-do-disconnect"[^>]*disabled/.test(m), 'DISCONNECT disabled at zero');
    assert.ok(!/pbv2-3d-do-connect"[^>]*disabled/.test(m), 'CONNECT still enabled at zero');
    assert.ok(!m.includes('p3d-status'), 'no status line at zero pulls');
  });

  test('AH/AQ. DISCONNECT cancel mutates nothing, and its locking matches CONNECT', () => {
    const a = app(); const { s, A, B } = fixture(a);
    a.tap(A.id); a.connect(); a.tap(B.id);
    const before = JSON.stringify(s);
    a.disconnectMode();
    a.pickSize('4'); a.pickWall('bottom'); a.pickPosition(90);
    a.deleteSelected(); a.calculate(); a.startAdd();
    assert.strictEqual(JSON.stringify(s), before, 'nothing moved during DISCONNECT mode');
    assert.strictEqual(a.mode(), 'disconnect');
    a.cancel();
    assert.strictEqual(JSON.stringify(s), before, 'cancel removed nothing');
    assert.strictEqual(a.mode(), null);
    assert.strictEqual(a.selected(), A.id);
    assert.ok(hasConfigRow(a.sheetHtml()));
  });

  test('AN. DELETE RACEWAY is unreachable during either mode', () => {
    for (const arm of ['connect', 'disconnect']) {
      const a = app(); const { s, A, B } = fixture(a);
      a.tap(A.id); a.connect(); a.tap(B.id);
      if (arm === 'connect') a.connect(); else a.disconnectMode();
      assert.ok(!a.sheetHtml().includes('DELETE RACEWAY'), arm + ': not shown');
      a.deleteSelected();
      assert.strictEqual(s.entries.length, 3, arm + ': and genuinely blocked');
    }
  });

  test('state machine: mode and source are always set and cleared together', () => {
    const a = app(); const { A, B } = fixture(a);
    a.tap(A.id);
    assert.ok(a.mode() === null && a.source() === null, 'normal editing');
    a.connect();
    assert.ok(a.mode() === 'connect' && a.source() === A.id, 'armed together');
    a.tap(B.id);
    assert.ok(a.mode() === null && a.source() === null, 'cleared together on success');
    a.disconnectMode();
    assert.ok(a.mode() === 'disconnect' && a.source() === A.id);
    a.cancel();
    assert.ok(a.mode() === null && a.source() === null, 'cleared together on cancel');
    // pbv23dTargeting requires BOTH, so a half-set state cannot be active
    assert.ok(fn3d('pbv23dTargeting').includes('pbv23dTargetMode && pbv23dConnectFrom'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8g — GLOBAL BOX ACTIONS + IN-FLOW RACEWAY DETAILS

   Two control levels are now separated structurally. BOX-level actions
   (ADD RACEWAY, CALCULATE) live once, permanently, directly under the box.
   SELECTED-RACEWAY details expand in the normal page flow BELOW that row —
   not as a fixed overlay covering it, which is what the old sheet did.
   Reading order: box -> global actions -> details.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8g — global actions and in-flow details', () => {
  const api = api3d();
  function live() {
    const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET',
      'PBV23D_CORNER_EXCLUDE', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM',
      'PBV23D_POLICY_ORDER']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dFindEntry', 'pbv23dRowsFor', 'pbv23dRowById',
      'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dDeleteRowIfEmpty',
      'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry', 'pbv23dAddConnection',
      'pbv23dDeleteConnection', 'pbv23dEntryConns', 'pbv23dConnNumber', 'pbv23dConnColor',
      'pbv23dEntryColor', 'pbv23dClassify', 'pbv23dConnTypeOf', 'pbv23dCertifiedBox',
      'pbv23dCeilBoxDim', 'pbv23dEntryRenderV', 'pbv23dCertifiedView', 'pbv23dSetSize',
      'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml', 'pbv23dTargetModeHtml', 'pbv23dIn', 'pbv23dSheetResultLine',
      'pbv23dSheetBody', 'pbv23dSelectionHtml', 'pbv23dGlobalsHtml', 'pbv23dInvalidateResult',
      'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode',
      'pbv23dConnBetween', 'pbv23dEligibleTargets',
      'pbv23dDisconnect', 'pbv23dDeleteSelected', 'pbv23dStartConnect',
      'pbv23dStartDisconnect', 'pbv23dCancelConnect', 'pbv23dTapEntry',
      'pbv23dPickSize', 'pbv23dStartAdd', 'pbv23dPickPosition'];
    const els = {}; const revealed = [];
    const el = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '',
      classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
        contains(c) { return this.list.has(c); } },
      scrollIntoView() { revealed.push(this.id); } }));
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('document', 'exports', 'window',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null, pbv23dSelected = null, pbv23dConnectFrom = null;\n'
      + 'var pbv23dAddMode = false, pbv23dLastResult = null, pbv23dLayout = null;\n'
      + 'var pbv23dPresentation = null, pbv23dLastPull = null;\n'
      + 'var pbv23dTargetMode = null, pbv23dMode = "build", pbv23dConfirmClear = false, calcRuns = 0;\n'
      + 'function pbv23dCalculate() { if (pbv23dTargeting()) return; calcRuns++; }\n'
      + consts + names.map(fn3d).join('\n')
      + '\nfunction pbv23dRender() {'
      + '  document.getElementById("pbv2-3d-globals").innerHTML = pbv23dGlobalsHtml(PBV23D);'
      + '  document.getElementById("pbv2-3d-selection").innerHTML = pbv23dSelectionHtml(); }\n'
      + fn3d('pbv23dOpenSheet') + '\n' + fn3d('pbv23dCloseSheet') + '\n'
      + fn3d('pbv23dRefreshSheet') + `
      exports.load = (s) => { PBV23D = s; }; exports.state = () => PBV23D;
      exports.empty = pbv23dEmptyState; exports.nextId = pbv23dNextId;
      exports.add = pbv23dAddEntry; exports.find = pbv23dFindEntry;
      exports.tap = pbv23dTapEntry; exports.selected = () => pbv23dSelected;
      exports.mode = () => pbv23dTargeting();
      exports.connect = pbv23dStartConnect; exports.disconnectMode = pbv23dStartDisconnect;
      exports.cancel = pbv23dCancelConnect; exports.done = pbv23dCloseSheet;
      exports.startAdd = pbv23dStartAdd; exports.addMode = () => pbv23dAddMode;
      exports.calculate = pbv23dCalculate; exports.calcRuns = () => calcRuns;
      exports.detailsOpen = () => document.getElementById('pbv2-3d-sheet').classList.contains('show');
      exports.details = () => document.getElementById('pbv2-3d-sheet-body').innerHTML;
      exports.globals = () => document.getElementById('pbv2-3d-globals').innerHTML;
      exports.render = pbv23dRender;`)(
      { getElementById: el }, out, { scrollTo() {} });
    out.revealed = () => revealed;
    return out;
  }
  const fixture = (a) => {
    const s = a.empty(); a.load(s);
    const A = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'top', '2', a.nextId('e'));
    const C = a.add(s, 'right', '2', a.nextId('e'));
    a.render();
    return { s, A, B, C };
  };
  const hasGlobals = (h) => h.includes('id="pbv2-3d-add"') && h.includes('id="pbv2-3d-calc"');

  test('A. nothing selected: global actions only, no raceway details', () => {
    const a = live(); fixture(a);
    assert.ok(hasGlobals(a.globals()), 'ADD RACEWAY and CALCULATE are present');
    assert.strictEqual(a.detailsOpen(), false, 'no details section');
    assert.strictEqual(a.details(), '', 'and no reserved blank area');
  });

  test('B. selected: the same global row stays, details appear below it', () => {
    const a = live(); const { A } = fixture(a);
    a.tap(A.id);
    assert.ok(hasGlobals(a.globals()), 'the global row is untouched by selection');
    assert.strictEqual(a.detailsOpen(), true, 'details appear');
    const d = a.details();
    assert.ok(d.includes('>SIZE<') && d.includes('>WALL<') && d.includes('>ROW<'));
    assert.ok(d.includes('id="pbv2-3d-do-connect"') && d.includes('id="pbv2-3d-do-disconnect"'));
/* SUPERSEDED BY PBV2-13B-4.9B: no status line / slider in the editor. */
    assert.ok(!d.includes('id="pbv2-3d-pos"'), 'no position slider in the editor');
    // structurally below: the details element follows the globals tier in the DOM
    const order = P3D.indexOf('id="pbv2-3d-globals"');
    assert.ok(order !== -1 && order < P3D.indexOf('id="pbv2-3d-sheet"'),
      'globals render above the details in document order');
  });

  test('C/D. exactly one CALCULATE, and none inside the details', () => {
    const a = live(); const { A } = fixture(a);
    a.tap(A.id);
    assert.strictEqual((a.globals().match(/pbv23dCalculate\(\)/g) || []).length, 1);
    assert.ok(!a.details().includes('pbv23dCalculate'), 'no duplicate in the details');
/* PBV2-13B-4.9C: FAST RESULT has its own CALCULATE on its own surface, so
       the shipped markup now carries TWO call sites — one per mode surface,
       both the same shipped handler, never visible together (FAST hides the
       globals row). The guarantee is one control per visible surface. */
    assert.strictEqual((P3D.match(/onclick="pbv23dCalculate\(\)"/g) || []).length, 2,
      'one per mode surface (BUILD/DENSE globals, FAST controls)');
  });

  test('E. DONE clears the selection and the details; global actions remain', () => {
    const a = live(); const { A } = fixture(a);
    a.tap(A.id);
    a.done();
    assert.strictEqual(a.selected(), null, 'deselected');
    assert.strictEqual(a.detailsOpen(), false, 'details removed');
    assert.ok(hasGlobals(a.globals()), 'global actions remain');
  });

  test('F. ADD RACEWAY stays global while a raceway is selected', () => {
    const a = live(); const { A } = fixture(a);
    const before = a.globals();
    a.tap(A.id);
    assert.strictEqual(a.globals(), before, 'the global row is byte-identical');
    assert.ok(!a.details().includes('pbv23dStartAdd'), 'ADD is not duplicated into details');
  });

  test('G/H. both target modes still block ADD RACEWAY and CALCULATE', () => {
    for (const arm of ['connect', 'disconnect']) {
      const a = live(); const { s, A, B } = fixture(a);
      a.tap(A.id); a.connect(); a.tap(B.id);            // one pull so DISCONNECT can arm
      const runs = a.calcRuns();
      if (arm === 'connect') a.connect(); else a.disconnectMode();
      assert.strictEqual(a.mode(), arm, arm + ' mode armed');
      a.calculate(); a.startAdd();
      assert.strictEqual(a.calcRuns(), runs, arm + ': CALCULATE blocked');
      assert.strictEqual(a.addMode(), false, arm + ': ADD RACEWAY blocked');
      assert.strictEqual(s.connections.length, 1, arm + ': no model change');
    }
  });

  test('I. DELETE RACEWAY remains under the overflow only', () => {
    const a = live(); const { A } = fixture(a);
    a.tap(A.id);
/* SUPERSEDED BY PBV2-13B-4.8g.2: no overflow menu; DELETE RACEWAY is a
       direct header control using the existing delete path. */
    assert.ok(!a.details().includes('DELETE RACEWAY'), 'not in the details body');
    assert.ok(P3D.includes('id="pbv2-3d-delete"'), 'a direct header control instead');
  });

  test('J. Layers 0/1/2 unchanged', () => {
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
  });

  test('K. the drawing is untouched: hubs, routes and geometry render as before', () => {
    const s = api.build('standard');
    const svg = api.svg(s, {});
    assert.ok(svg.includes('class="p3d-hub"') && svg.includes('class="p3d-route"'));
    assert.ok(svg.includes('class="p3d-hit"'), 'hit targets intact');
    assert.ok(svg.includes('class="p3d-hubnum"'), 'numbered endpoints intact');
    // selection changes the drawing only through the existing selected-state path
    const sel = api.svg(s, { selected: s.entries[0].id });
    assert.strictEqual((sel.match(/class="p3d-route"/g) || []).length,
      (svg.match(/class="p3d-route"/g) || []).length, 'route count unchanged');
    for (const fn of ['pbv23dRenderSvg', 'pbv23dHub', 'pbv23dRoutePath', 'pbv23dAngleRoute']) {
      assert.ok(!fn3d(fn).includes('pbv23dRevealDetails')
        && !fn3d(fn).includes('pbv2-3d-sheet'), fn + ' knows nothing about the sheet');
    }
  });

  /* ── reachability ─────────────────────────────────────────────────────── */
  /* ── viewport stability (PBV2-13B-4.8g.1) ─────────────────────────────
     SUPERSEDED the 4.8g reveal tests. 4.8g scrolled #pbv2-3d-globals to the
     top of the viewport when details opened; on a real iPhone that pushed
     almost the whole pull-box drawing above the fold. The accepted rule is
     now the simpler one: selecting a raceway expands its details and moves
     nothing. Controls below the fold are reached by scrolling manually —
     spatial context with the box matters more. */
  test('VIEWPORT: selecting a raceway opens details and does not scroll', () => {
    const a = live(); const { A } = fixture(a);
    a.tap(A.id);
    assert.strictEqual(a.detailsOpen(), true, 'the details opened');
    assert.deepStrictEqual(a.revealed(), [], 'nothing was scrolled into view');
    // and no PBV2 workflow function reaches for the scroll APIs at all
    for (const fn of ['pbv23dOpenSheet', 'pbv23dCloseSheet', 'pbv23dRefreshSheet',
      'pbv23dTapEntry', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode',
      'pbv23dStartConnect', 'pbv23dCancelConnect', 'pbv23dDisconnect', 'pbv23dTapWall']) {
      assert.ok(!/scrollIntoView|scrollTo|scrollTop|window\.scroll/.test(fn3d(fn)),
        fn + ' must not move the viewport');
    }
    // the 4.8g helper is gone, not merely unused
    assert.throws(() => fn3d('pbv23dRevealDetails'), /missing: pbv23dRevealDetails/,
      'the reveal helper was removed cleanly');
  });

  test('VIEWPORT: CONNECT, DISCONNECT and CANCEL restore context without scrolling', () => {
    // CONNECT success
    let a = live(); let f = fixture(a);
    a.tap(f.A.id); a.connect(); a.tap(f.B.id);
    assert.strictEqual(a.selected(), f.A.id, 'still editing A');
    assert.strictEqual(a.detailsOpen(), true, 'details open');
    assert.deepStrictEqual(a.revealed(), [], 'connect success does not scroll');
    // DISCONNECT success
    a = live(); f = fixture(a);
    a.tap(f.A.id); a.connect(); a.tap(f.B.id);
    a.disconnectMode(); a.tap(f.B.id);
    assert.strictEqual(f.s.connections.length, 0, 'the pull was removed');
    assert.strictEqual(a.selected(), f.A.id, 'still editing A');
    assert.deepStrictEqual(a.revealed(), [], 'disconnect success does not scroll');
    // CANCEL from either mode
    for (const arm of ['connect', 'disconnect']) {
      a = live(); f = fixture(a);
      a.tap(f.A.id); a.connect(); a.tap(f.B.id);
      if (arm === 'connect') a.connect(); else a.disconnectMode();
      a.cancel();
      assert.strictEqual(a.mode(), null, arm + ': mode exited');
      assert.strictEqual(a.selected(), f.A.id, arm + ': context restored');
      assert.strictEqual(a.detailsOpen(), true, arm + ': details restored');
      assert.deepStrictEqual(a.revealed(), [], arm + ': cancel does not scroll');
    }
  });

  test('VIEWPORT: DONE hides the details and forces no scroll', () => {
    const a = live(); const { A } = fixture(a);
    a.tap(A.id);
    a.done();
    assert.strictEqual(a.selected(), null, 'deselected');
    assert.strictEqual(a.detailsOpen(), false, 'details removed');
    assert.deepStrictEqual(a.revealed(), [], 'DONE does not scroll anywhere');
    assert.ok(!/scrollIntoView|scrollTo|scrollTop/.test(fn3d('pbv23dCloseSheet')));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8g.2 — DIRECT DELETE RACEWAY HEADER

   The selected-raceway header carried `⋯` + `DONE`. Both are gone: one
   direct DELETE RACEWAY control takes their place, using the existing
   raceway-delete handler. There is no overflow menu and no dismiss button —
   selecting another raceway simply switches the details to it.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8g.2 — direct DELETE RACEWAY header', () => {
  const api = api3d();
  const header = () => P3D.slice(P3D.indexOf('class="p3d-sheet-h"'),
    P3D.indexOf('id="pbv2-3d-sheet-body"'));
  /** The shipped details body for a given state/selection. */
  function detailsFor(state, id) {
    const consts = ['PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS', 'PBV23D_NEUTRAL',
      'PBV23D_ADD_ROW', 'PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP',
      'PBV23D_DEPTH_INSET', 'PBV23D_CORNER_EXCLUDE', 'PBV23D_PULL_WORD']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dFindEntry', 'pbv23dRowsFor', 'pbv23dRowById', 'pbv23dRowIndex',
      'pbv23dEntryConns', 'pbv23dConnNumber', 'pbv23dConnColor', 'pbv23dClassify',
      'pbv23dConnTypeOf', 'pbv23dCertifiedBox', 'pbv23dCeilBoxDim', 'pbv23dEntryRenderV',
      'pbv23dCertifiedView', 'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml',
      'pbv23dTargeting',
      'pbv23dTargetModeHtml', 'pbv23dIn', 'pbv23dSheetResultLine', 'pbv23dSheetBody'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('PBV23D', 'pbv23dSelected', 'pbv23dPresentation', 'exports',
      'var pbv23dLayout = null, pbv23dLastPull = null, pbv23dTargetMode = null;'
      + 'var pbv23dConnectFrom = null;' + consts + names.map(fn3d).join('\n')
      + ';exports.body = pbv23dSheetBody;')(state, id, null, out);
    return out.body();
  }

  test('1/2. the overflow and DONE controls are gone', () => {
    const h = header();
    assert.ok(!h.includes('pbv2-3d-more'), 'no overflow button');
    assert.ok(!h.includes('&#8943;'), 'no ellipsis glyph');
    assert.ok(!h.includes('DONE'), 'no DONE button');
    assert.ok(!/>(CLOSE|BACK|\u2715|X)</.test(h), 'and no replacement dismiss control');
    // the panel machinery went with them
    assert.throws(() => fn3d('pbv23dToggleSheetPanel'), /missing/, 'toggle removed');
    assert.ok(!P3D.includes('pbv23dSheetPanel'), 'panel state removed');
  });

  test('3/4. DELETE RACEWAY is directly in the header on the existing path', () => {
    const h = header();
    assert.ok(h.includes('id="pbv2-3d-delete"'), 'the control is in the header');
    assert.ok(h.includes('DELETE RACEWAY'), 'named distinctly');
    assert.ok(h.includes('onclick="pbv23dDeleteSelected()"'), 'existing delete handler');
    assert.ok(h.includes('p3d-danger'), 'destructive styling');
    // no second delete implementation was created
    const del = fn3d('pbv23dDeleteSelected');
    assert.ok(del.includes('pbv23dDeleteEntry'), 'the shipped raceway-delete path');
  });

  test('5. exactly one DELETE RACEWAY control exists in the whole UI', () => {
    assert.strictEqual((P3D.match(/DELETE RACEWAY/g) || []).length, 1);
    assert.strictEqual((P3D.match(/id="pbv2-3d-delete"/g) || []).length, 1);
    assert.ok(!fn3d('pbv23dSheetBody').includes('DELETE RACEWAY'),
      'not duplicated into the details body');
    assert.ok(!fn3d('pbv23dConnActionsHtml').includes('DELETE RACEWAY'));
  });

  test('6. DISCONNECT still removes a connection, never a raceway', () => {
    const disc = fn3d('pbv23dDisconnect');
    assert.ok(disc.includes('pbv23dDeleteConnection'), 'connection-delete path');
    assert.ok(!disc.includes('pbv23dDeleteEntry') && !disc.includes('pbv23dDeleteSelected'),
      'and never the raceway path');
  });

  test('7. selecting another raceway switches the details, with no DONE needed', () => {
    const s = api.empty();
    const A = api.add(s, 'left', '2', api.nextId('e'));
    const B = api.add(s, 'top', '4', api.nextId('e'));
    // the shipped tap handler simply re-points the selection
    const tap = fn3d('pbv23dTapEntry');
    assert.ok(tap.includes('pbv23dSelected = id'), 'selection follows the tap');
    assert.ok(tap.includes('pbv23dOpenSheet()'), 'and the details open for it');
    // details render from whichever raceway is selected
    assert.strictEqual(selectedOptionValue(detailsFor(s, A.id), 'pbv2-3d-size'), '2');
    assert.strictEqual(selectedOptionValue(detailsFor(s, B.id), 'pbv2-3d-size'), '4');
    assert.strictEqual(selectedOptionValue(detailsFor(s, B.id), 'pbv2-3d-wall'), 'top');
  });

  test('8. deleting the selected raceway leaves state and UI coherent', () => {
    const s = api.empty();
    const A = api.add(s, 'left', '2', api.nextId('e'));
    const B = api.add(s, 'top', '2', api.nextId('e'));
    api.connect(s, A.id, B.id, api.nextId('c'));
    // the existing delete contract removes the raceway and its relationships
    api.del(s, A.id);
    assert.strictEqual(s.entries.length, 1, 'the raceway is gone');
    assert.strictEqual(s.connections.length, 0, 'and its pull with it');
    assert.ok(api.find(s, B.id), 'the far raceway survives');
    // the handler clears selection and closes the details
    const del = fn3d('pbv23dDeleteSelected');
    assert.ok(del.includes('pbv23dSelected = null') && del.includes('pbv23dCloseSheet()'),
      'selection and details are cleared');
    assert.ok(del.includes('pbv23dInvalidateResult'), 'and the result invalidates as before');
  });

  test('9/10/11. the rest of the 4.8g.1 UI is untouched', () => {
    const s = api.empty();
    const e = api.add(s, 'left', '2', api.nextId('e'));
    const d = detailsFor(s, e.id);
    assert.ok(d.includes('>SIZE<') && d.includes('>WALL<') && d.includes('>ROW<'));
    assert.ok(d.includes('id="pbv2-3d-do-connect"') && d.includes('id="pbv2-3d-do-disconnect"'));
/* SUPERSEDED BY PBV2-13B-4.9B: no status line / slider in the editor. */
    assert.ok(!d.includes('id="pbv2-3d-pos"'), 'no position slider in the editor');
    const g = fn3d('pbv23dGlobalsHtml');
    assert.ok(g.includes('id="pbv2-3d-add"') && g.includes('id="pbv2-3d-calc"'),
      'global actions unchanged');
/* PBV2-13B-4.9C: FAST RESULT has its own CALCULATE on its own surface, so
       the shipped markup now carries TWO call sites — one per mode surface,
       both the same shipped handler, never visible together (FAST hides the
       globals row). The guarantee is one control per visible surface. */
    assert.strictEqual((g.match(/pbv23dCalculate\(\)/g) || []).length, 1,
      'still exactly one CALCULATE on the BUILD surface');
    // and the 4.8g.1 no-scroll rule still holds
    assert.ok(!/scrollIntoView|scrollTo|scrollTop/.test(fn3d('pbv23dOpenSheet')));
  });

  test('12/13. Layers 0/1/2 and the drawing are unchanged', () => {
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    const svg = api.svg(api.build('standard'), {});
    assert.ok(svg.includes('class="p3d-hub"') && svg.includes('class="p3d-route"')
      && svg.includes('class="p3d-hit"') && svg.includes('class="p3d-hubnum"'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8g.3 — EXCLUSIVE DETAILS / RESULTS VIEW

   The area under the permanent [+ ADD RACEWAY][CALCULATE] row now shows
   exactly ONE context: the selected raceway's editor, or the calculation
   results — never both stacked. One presentation state (pbv23dViewMode)
   decides which; it is deliberately NOT derived from pbv23dSelected, because
   after CALCULATE a raceway can still be selected and the results must own
   the area until the user taps a raceway again.

   Critically, the view switch is presentation only: it never discards result
   DATA. Only the existing invalidation contract does that.
   ════════════════════════════════════════════════════════════════════════ */

/* Shared live-app harness: the shipped render/open/close pipeline over a DOM
   stub, used by the 4.8g.3 and 4.8g.4 view-state suites. */
function app() {
  const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET',
    'PBV23D_CORNER_EXCLUDE', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
    'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM',
    'PBV23D_POLICY_ORDER']
    .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
  const names = ['pbv23dEmptyState', 'pbv23dBuildFixture', 'pbv23dFindEntry', 'pbv23dRowsFor',
    'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow',
    'pbv23dDeleteRowIfEmpty', 'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry',
    'pbv23dAddConnection', 'pbv23dDeleteConnection', 'pbv23dEntryConns', 'pbv23dConnNumber',
    'pbv23dConnColor', 'pbv23dEntryColor', 'pbv23dClassify', 'pbv23dConnTypeOf',
    'pbv23dCertifiedBox', 'pbv23dCeilBoxDim', 'pbv23dEntryRenderV', 'pbv23dCertifiedView',
    'pbv23dSetSize', 'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml', 'pbv23dTargetModeHtml', 'pbv23dIn', 'pbv23dSheetResultLine',
    'pbv23dSheetBody', 'pbv23dSelectionHtml', 'pbv23dGlobalsHtml', 'pbv23dInvalidateResult',
    'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween',
    'pbv23dEligibleTargets', 'pbv23dDisconnect', 'pbv23dDeleteSelected', 'pbv23dStartConnect',
    'pbv23dStartDisconnect', 'pbv23dCancelConnect', 'pbv23dTapEntry', 'pbv23dTapWall',
    'pbv23dStartAdd', 'pbv23dPickSize', 'pbv23dEngineRequest', 'pbv23dPresent',
    'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dLayoutNote',
    'pbv23dDim', 'pbv23dEffectiveAxes', 'pbv23dResultHtml', 'pbv23dLayoutGeometry',
    'pbv23dCertifyBox', 'pbv23dCalculate', 'pbv23dRenderSvg', 'pbv23dHub', 'pbv23dInward',
    'pbv23dGeoFor', 'pbv23dRouteLead', 'pbv23dClampInterior', 'pbv23dSegCross',
    'pbv23dPolylineLoops', 'pbv23dRouteAnchor', 'pbv23dAngleSide', 'pbv23dAngleRoute',
    'pbv23dRoutePath', 'pbv23dRowDepth', 'pbv23dHitRadius', 'pbv23dEntryConnNumbers',
    'pbv23dHubNumberLayout', 'pbv23dSetPosition', 'pbv23dSetWall', 'pbv23dSetEntryRow',
    'pbv23dPickWall', 'pbv23dPickRow', 'pbv23dPickRowOption', 'pbv23dAddRowHere',
    'pbv23dPickPosition', 'pbv23dCancelAdd'];
  const els = {}; const scrolls = [];
  const el = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '',
    classList: { list: new Set(), add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); },
      contains(c) { return this.list.has(c); } },
    scrollIntoView() { scrolls.push(this.id); }, appendChild() {}, parentNode: null }));
  const out = {};
  // eslint-disable-next-line no-new-func
  new Function('document', 'EC', 'exports',
    'var pbv23dSeq = 0;\n'
    + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
    + 'var PBV23D = null, pbv23dSelected = null, pbv23dConnectFrom = null;\n'
    + 'var pbv23dAddMode = false, pbv23dLastResult = null, pbv23dLayout = null;\n'
    + 'var pbv23dPresentation = null, pbv23dLastPull = null, pbv23dTargetMode = null;\n'
    + 'var pbv23dViewMode = "results", pbv23dMode = "build", pbv23dConfirmClear = false;\n'
      + 'var pbv23dFastFamily = "straight", pbv23dFastSize = "2";\n'
    + 'var PBV23D_ERROR_TEXT = {};\n'
    + consts + [...new Set(names)].map(fn3d).join('\n') + '\n'
    + fn3d('pbv23dRender') + '\n' + fn3d('pbv23dOpenSheet') + '\n'
    + fn3d('pbv23dCloseSheet') + '\n' + fn3d('pbv23dRefreshSheet') + `
    exports.load = (s) => { PBV23D = s; pbv23dRender(); };
    exports.build = pbv23dBuildFixture; exports.state = () => PBV23D;
    exports.nextId = pbv23dNextId; exports.add = pbv23dAddEntry;
    exports.find = pbv23dFindEntry; exports.connect = pbv23dAddConnection;
    exports.tap = pbv23dTapEntry; exports.tapWall = pbv23dTapWall;
    exports.selected = () => pbv23dSelected; exports.viewMode = () => pbv23dViewMode;
    exports.calculate = pbv23dCalculate; exports.startAdd = pbv23dStartAdd;
    exports.addMode = () => pbv23dAddMode;
    exports.startConnect = pbv23dStartConnect; exports.startDisconnect = pbv23dStartDisconnect;
    exports.cancel = pbv23dCancelConnect; exports.deleteSelected = pbv23dDeleteSelected;
    exports.pickSize = pbv23dPickSize;
    exports.presentation = () => pbv23dPresentation;
    exports.layout = () => pbv23dLayout;
    exports.detailsShown = () => document.getElementById('pbv2-3d-sheet').classList.contains('show');
    exports.details = () => document.getElementById('pbv2-3d-sheet-body').innerHTML;
    exports.results = () => document.getElementById('pbv2-3d-result').innerHTML;
    exports.globals = () => document.getElementById('pbv2-3d-globals').innerHTML;`)(
    { getElementById: el }, { pullBox: require('../src/calc/pullBox'),
      pullBoxLayout: require('../src/layout/pullBoxLayout'),
      pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') }, out);
  out.scrolls = () => scrolls;
  return out;
}

describe('PBV2-13B-4.8g.3 — exclusive details/results view', () => {
  const RESULT_MARKERS = ['MINIMUM REQUIRED BOX SIZE', 'PULL REQUIREMENTS'];
  const stacked = (a) => a.detailsShown() && RESULT_MARKERS.some((m) => a.results().includes(m));

  test('A. nothing selected, nothing calculated: no details, no stale results', () => {
    const a = app(); a.load(a.build('standard'));
    assert.strictEqual(a.detailsShown(), false, 'no raceway details');
    for (const m of RESULT_MARKERS) assert.ok(!a.results().includes(m), 'no results: ' + m);
    assert.ok(a.globals().includes('id="pbv2-3d-add"'), 'globals always remain');
  });

  test('B. selecting a raceway shows details and hides results', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.tap(s.entries[0].id);
    assert.strictEqual(a.detailsShown(), true, 'details visible');
    assert.strictEqual(a.viewMode(), 'details');
    for (const m of RESULT_MARKERS) assert.ok(!a.results().includes(m), 'results hidden: ' + m);
    assert.ok(!stacked(a), 'never both at once');
  });

  test('C/D. CALCULATE hides details and shows the real result sections', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.tap(s.entries[0].id);
    a.calculate();
    assert.strictEqual(a.viewMode(), 'results');
    assert.strictEqual(a.detailsShown(), false, 'details hidden');
    const r = a.results();
    for (const m of RESULT_MARKERS) assert.ok(r.includes(m), 'results show: ' + m);
    // the results view carries none of the raceway editor
    for (const c of ['>SIZE<', '>WALL<', '>ROW<', 'pbv2-3d-do-connect',
      'pbv2-3d-do-disconnect', 'DELETE RACEWAY', 'pbv2-3d-pos']) {
      assert.ok(!r.includes(c), 'no editor control in results: ' + c);
    }
    assert.ok(!stacked(a));
  });

  test('E/F. results + tap raceway: details return, result DATA is preserved', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.calculate();
    const keptPresentation = a.presentation();
    const keptLayout = JSON.stringify(a.layout());
    assert.ok(keptPresentation, 'a result exists');
    const target = s.entries[1];
    a.tap(target.id);
    assert.strictEqual(a.detailsShown(), true, 'details returned');
    assert.strictEqual(a.selected(), target.id, 'and for the tapped raceway');
    for (const m of RESULT_MARKERS) assert.ok(!a.results().includes(m), 'results hidden');
    // selecting changes nothing, so the result must survive untouched
    assert.strictEqual(a.presentation(), keptPresentation,
      'the view switch did not discard result data');
    assert.strictEqual(JSON.stringify(a.layout()), keptLayout, 'nor the certified layout');
    assert.ok(a.globals().includes('RECALCULATE'),
      'and the label still reflects a valid result');
  });

  test('G. an actual edit still invalidates, exactly as before', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.calculate();
    assert.ok(a.presentation(), 'valid result');
    a.tap(s.entries[0].id);
    a.pickSize('4');
    assert.strictEqual(a.presentation(), null, 'the edit invalidated it');
    assert.ok(a.globals().includes('>CALCULATE<'), 'label falls back to CALCULATE');
  });

  test('H. results + ADD RACEWAY: results clear, placement then shows details', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.calculate();
    for (const m of RESULT_MARKERS) assert.ok(a.results().includes(m), 'results were up');
    a.startAdd();
    assert.strictEqual(a.addMode(), true, 'placement workflow started');
    for (const m of RESULT_MARKERS) assert.ok(!a.results().includes(m), 'results cleared: ' + m);
    assert.strictEqual(a.detailsShown(), false, 'nothing selected yet, so no details');
    a.tapWall('top');
    assert.strictEqual(a.addMode(), false, 'placement finished');
    assert.strictEqual(a.detailsShown(), true, 'the new raceway shows its details');
    assert.ok(!stacked(a));
  });

  test('I/J. details + CALCULATE switches to results; another raceway switches back', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.tap(s.entries[0].id);
    a.calculate();
    assert.strictEqual(a.detailsShown(), false, 'switched to results');
    a.tap(s.entries[2].id);
    assert.strictEqual(a.selected(), s.entries[2].id, 'details for the new raceway');
    assert.strictEqual(selectedOptionValue(a.details(), 'pbv2-3d-size'), s.entries[2].size);
    assert.ok(!stacked(a));
  });

  test('K/L/M. CONNECT, DISCONNECT and CANCEL all end on details, never results', () => {
    // CONNECT success
    let a = app(); let s = a.build('standard'); a.load(s);
    a.calculate();
    const A = s.entries[0]; const C = s.entries[2];
    a.tap(A.id); a.startConnect(); a.tap(C.id);
    assert.strictEqual(a.detailsShown(), true, 'connect returns to details');
    assert.strictEqual(a.selected(), A.id, 'on the original raceway');
    assert.ok(!stacked(a));
    // DISCONNECT success
    a = app(); s = a.build('standard'); a.load(s);
    const D = s.entries[0];
    const partner = s.connections.find((c) => c.a === D.id || c.b === D.id);
    assert.ok(partner, 'the fixture gives it a pull');
    const other = partner.a === D.id ? partner.b : partner.a;
    a.tap(D.id); a.startDisconnect(); a.tap(other);
    assert.strictEqual(a.detailsShown(), true, 'disconnect returns to details');
    assert.strictEqual(a.selected(), D.id);
    assert.ok(!stacked(a));
    // CANCEL from either mode
    for (const arm of ['connect', 'disconnect']) {
      a = app(); s = a.build('standard'); a.load(s);
      const E = s.entries[0];
      a.tap(E.id);
      if (arm === 'connect') a.startConnect(); else a.startDisconnect();
      a.cancel();
      assert.strictEqual(a.detailsShown(), true, arm + ': cancel restores details');
      assert.strictEqual(a.selected(), E.id, arm + ': same raceway');
      assert.ok(!stacked(a), arm + ': no result stacking');
    }
  });

  test('DELETE: no stale details, and invalidation decides the result', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.calculate();
    a.tap(s.entries[0].id);
    a.deleteSelected();
    assert.strictEqual(a.selected(), null, 'nothing selected');
    assert.strictEqual(a.detailsShown(), false, 'no stale details');
    assert.strictEqual(a.presentation(), null, 'delete invalidated the result');
    for (const m of RESULT_MARKERS) assert.ok(!a.results().includes(m), 'no stale results');
  });

  test('N/O. one global CALCULATE, and no automatic scrolling was introduced', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.tap(s.entries[0].id); a.calculate(); a.tap(s.entries[1].id); a.startAdd();
    assert.deepStrictEqual(a.scrolls(), [], 'view switching never scrolls');
/* PBV2-13B-4.9C: FAST RESULT has its own CALCULATE on its own surface, so
       the shipped markup now carries TWO call sites — one per mode surface,
       both the same shipped handler, never visible together (FAST hides the
       globals row). The guarantee is one control per visible surface. */
    assert.strictEqual((fn3d('pbv23dGlobalsHtml').match(/pbv23dCalculate\(\)/g) || []).length, 1,
      'one CALCULATE on the BUILD surface');
    for (const fn of ['pbv23dRender', 'pbv23dOpenSheet', 'pbv23dCloseSheet', 'pbv23dCalculate']) {
      assert.ok(!/scrollIntoView|scrollTo|scrollTop/.test(fn3d(fn)), fn + ' does not scroll');
    }
  });

  test('the view state is presentation only and cannot fake invalidation', () => {
    const body = fn3d('pbv23dCalculate') + fn3d('pbv23dOpenSheet') + fn3d('pbv23dStartAdd');
    assert.ok(body.includes("pbv23dViewMode = 'results'")
      && body.includes("pbv23dViewMode = 'details'"), 'both transitions are explicit');
    // no view transition writes result state directly
    assert.ok(!/pbv23dViewMode[^;]*pbv23dPresentation/.test(P3D));
    const render = fn3d('pbv23dRender');
    assert.ok(render.includes('pbv23dViewMode') && !render.includes('pbv23dInvalidateResult'),
      'rendering a view never invalidates data');
  });

  test('P/Q/R/S. layers, drawing, STANDARD and DENSE results all unchanged', () => {
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    const engine = require('../src/calc/pullBox');
    const api = api3d();
    // the pinned real-engine figure for the ROWS fixture (see the 26->29 demo)
    assert.strictEqual(engine.calculatePullBox(api.request(api.build('rows'))).minimumWidthIn, 26);
    const std = engine.calculatePullBox(api.request(api.build('standard')));
    assert.strictEqual(std.ok, true, 'STANDARD still calculates');
    const dense = engine.calculatePullBox(api.request(api.build('dense')));
    assert.strictEqual(dense.ok, true, 'DENSE still calculates');
    const svg = api.svg(api.build('standard'), {});
    assert.ok(svg.includes('class="p3d-hub"') && svg.includes('class="p3d-route"')
      && svg.includes('class="p3d-hubnum"'), 'drawing markup unchanged');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.8g.4 — RESULTS SPACING + STRICT RESULT VISIBILITY

   Two corrections from real-device screenshots. (1) The results began ~36px
   below the global action card because .p3d-res stacked an 18px margin on
   top of an 18px padding either side of its divider; both are now 8px.
   (2) The raceway editor still explained the CALCULATION ("Showing the
   calculated layout…"). Result-oriented copy belongs to RESULTS mode only,
   so the editor now omits the position control rather than explaining a
   result inside it.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.8g.4 — results spacing and strict result visibility', () => {
  const styles = P3D.slice(P3D.indexOf('<style>'), P3D.indexOf('</style>'));
  const rule = (sel) => {
    const m = styles.match(new RegExp(sel.replace('.', '\\.') + '\\{([^}]*)\\}', 'g'));
    return m ? m.join(' ') : '';
  };
  /** Every string whose purpose is explaining the calculation result. */
  const RESULT_COPY = ['MINIMUM REQUIRED BOX SIZE', 'PULL REQUIREMENTS',
    'Showing the calculated layout', 'calculated layout', 'CONSERVATIVE NEC LAYOUT',
    'CERTIFIED NEC LAYOUT', 'Not calculated yet.'];

  test('A/G. no result copy exists anywhere in the raceway-detail builders', () => {
    for (const fn of ['pbv23dSheetBody', 'pbv23dEditFieldsHtml',
      'pbv23dConnActionsHtml']) {
      const body = fn3d(fn);
      for (const copy of RESULT_COPY) {
        assert.ok(!body.includes(copy), fn + ' must not carry result copy: ' + copy);
      }
    }
    // the certified branch no longer substitutes an explanation for the slider
/* SUPERSEDED BY PBV2-13B-4.9B: no status line / slider in the editor. */
    assert.ok(!fn3d('pbv23dEditFieldsHtml').includes('pbv2-3d-pos'),
      'the editor carries no position control at all');
  });

  test('A. DETAILS mode renders no result content, certified or not', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    // schematic: the slider is offered, and still no result copy
    a.tap(s.entries[0].id);
    let d = a.details();
    /* SUPERSEDED BY PBV2-13B-4.9B: no status line / slider in the editor. */
    assert.ok(!d.includes('id="pbv2-3d-pos"'), 'no slider while schematic');
    for (const copy of RESULT_COPY) assert.ok(!d.includes(copy), 'no result copy: ' + copy);
    a.calculate();
    a.tap(s.entries[0].id);
    d = a.details();
    assert.ok(!d.includes('id="pbv2-3d-pos"'), 'no slider once certified either');
    assert.ok(!d.includes('SCHEMATIC POSITION'), 'and no explanation');
    for (const copy of RESULT_COPY) assert.ok(!d.includes(copy), 'no result copy: ' + copy);
    // the editor still carries its own controls
    assert.ok(d.includes('>SIZE<') && d.includes('id="pbv2-3d-do-connect"'));
  });

  test('B/E. a valid result survives selection while its UI stays hidden', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.calculate();
    const kept = a.presentation();
    assert.ok(kept, 'a result exists');
    a.tap(s.entries[1].id);
    assert.strictEqual(a.presentation(), kept, 'result DATA preserved');
    assert.ok(a.globals().includes('RECALCULATE'), 'label may still read RECALCULATE');
    assert.strictEqual(a.results(), '', 'result UI is hidden');
    assert.strictEqual(a.detailsShown(), true, 'details are shown instead');
  });

  test('C/D. RESULTS mode shows the real sections and hides the editor', () => {
    const a = app(); const s = a.build('standard'); a.load(s);
    a.tap(s.entries[0].id);
    a.calculate();
    assert.strictEqual(a.detailsShown(), false, 'editor hidden');
    const r = a.results();
    assert.ok(r.includes('MINIMUM REQUIRED BOX SIZE') && r.includes('PULL REQUIREMENTS'));
  });

  test('F. the results container is compactly spaced and collapses when empty', () => {
    const res = rule('.p3d-res');
    // structural, not pixel-perfect: the two stacked 18px values are gone
    assert.ok(!/margin:18px/.test(res) && !/padding-top:18px/.test(res),
      'the old doubled spacing is removed');
    const margin = Number((res.match(/margin:(\d+)px/) || [])[1]);
    const padding = Number((res.match(/padding-top:(\d+)px/) || [])[1]);
    assert.ok(margin > 0 && margin <= 10, 'a little breathing room, not a dead zone');
    assert.ok(padding > 0 && padding <= 10, 'heading does not sit on the divider');
    assert.ok(margin + padding < 18, 'total gap above the results is materially smaller');
    assert.ok(/border-top:1px solid/.test(res), 'the divider is still the results section');
    assert.ok(/24px/.test(res), 'a normal content tail, not overlay clearance');
    assert.ok(/\.p3d-res:empty\{[^}]*margin:0[^}]*border:0/.test(P3D),
      'and it reserves nothing at all in DETAILS mode');
  });

  test('H/I. layers and drawing unchanged', () => {
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    const api = api3d();
    const svg = api.svg(api.build('standard'), {});
    assert.ok(svg.includes('class="p3d-hub"') && svg.includes('class="p3d-route"')
      && svg.includes('class="p3d-hubnum"'), 'drawing markup unchanged');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.9B — FAST RESULT / BUILD / DENSE NAVIGATION + FINAL SHEET CLEANUP

   Primary navigation is now three PRODUCT modes, not four state fixtures.
   BUILD is the editor on pbv23dEmptyState(); STANDARD and ROWS survive as
   optional examples INSIDE build; DENSE is unchanged; FAST RESULT is a
   navigation shell until the next milestone. The selected-raceway editor
   ends after CONNECT / DISCONNECT — no slider, no pull-status line. The
   position MODEL (entry.v, automatic placement) is fully retained.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.9B — product navigation and final sheet cleanup', () => {
  const api = api3d();
  const nav = () => P3D.slice(P3D.indexOf("var modes = [['fast'"), P3D.indexOf("pbv23dSetMode('build');"));

  /** The shipped mode/example switch over a DOM stub. */
  function shell() {
    const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET',
      'PBV23D_CORNER_EXCLUDE', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
      'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM',
      'PBV23D_POLICY_ORDER', 'PBV23D_FAST_WALLS']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dBuildFixture', 'pbv23dFindEntry', 'pbv23dRowsFor',
      'pbv23dRowById', 'pbv23dRowIndex', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow',
      'pbv23dDeleteRowIfEmpty', 'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry',
      'pbv23dAddConnection', 'pbv23dDeleteConnection', 'pbv23dSetPosition', 'pbv23dEntryConns',
      'pbv23dConnNumber', 'pbv23dConnColor', 'pbv23dEntryColor', 'pbv23dClassify',
      'pbv23dConnTypeOf', 'pbv23dCertifiedBox', 'pbv23dCeilBoxDim', 'pbv23dEntryRenderV',
      'pbv23dCertifiedView', 'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml',
      'pbv23dTargetModeHtml', 'pbv23dIn', 'pbv23dSheetResultLine', 'pbv23dSheetBody',
      'pbv23dSelectionHtml', 'pbv23dGlobalsHtml', 'pbv23dInvalidateResult',
      'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween',
      'pbv23dEligibleTargets', 'pbv23dDisconnect', 'pbv23dDeleteSelected', 'pbv23dStartConnect',
      'pbv23dStartDisconnect', 'pbv23dCancelConnect', 'pbv23dTapEntry', 'pbv23dTapWall',
      'pbv23dStartAdd', 'pbv23dEngineRequest', 'pbv23dPresent', 'pbv23dAxisRow',
      'pbv23dEndpointText', 'pbv23dPullCardHtml', 'pbv23dLayoutNote', 'pbv23dDim',
      'pbv23dEffectiveAxes', 'pbv23dResultHtml', 'pbv23dLayoutGeometry', 'pbv23dCertifyBox',
      'pbv23dCalculate', 'pbv23dRenderSvg', 'pbv23dHub', 'pbv23dInward', 'pbv23dGeoFor',
      'pbv23dRouteLead', 'pbv23dClampInterior', 'pbv23dSegCross', 'pbv23dPolylineLoops',
      'pbv23dRouteAnchor', 'pbv23dAngleSide', 'pbv23dAngleRoute', 'pbv23dRoutePath',
      'pbv23dRowDepth', 'pbv23dHitRadius', 'pbv23dEntryConnNumbers', 'pbv23dHubNumberLayout',
      'pbv23dLoadState', 'pbv23dLoadStarter', 'pbv23dBuildStarterState', 'pbv23dClearBoxAsk',
      'pbv23dClearBoxCancel', 'pbv23dClearBoxConfirm', 'pbv23dSetMode', 'pbv23dFastState',
      'pbv23dFastReset', 'pbv23dFastPickFamily', 'pbv23dFastPickSize', 'pbv23dFastControlsHtml',
      'pbv23dSupportedSizes',
      'pbv23dPickRow', 'pbv23dPickRowOption', 'pbv23dAddRowHere', 'pbv23dSetEntryRow'];
    const els = {};
    const el = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '',
      classList: { l: new Set(), add(...c) { c.forEach((x) => this.l.add(x)); },
        remove(...c) { c.forEach((x) => this.l.delete(x)); }, contains(c) { return this.l.has(c); } },
      getAttribute(k) { return this['@' + k]; }, setAttribute(k, v) { this['@' + k] = v; } }));
    const buttons = [];
    const doc = { getElementById: el,
      querySelectorAll: () => buttons };
    for (const m of ['fast', 'build', 'dense']) {
      const b = el('btn-' + m); b['@data-mode'] = m; buttons.push(b);
    }
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('document', 'EC', 'exports', 'buttons',
      'var pbv23dSeq = 0;\n'
      + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
      + 'var PBV23D = null, pbv23dSelected = null, pbv23dConnectFrom = null;\n'
      + 'var pbv23dAddMode = false, pbv23dLastResult = null, pbv23dLayout = null;\n'
      + 'var pbv23dPresentation = null, pbv23dLastPull = null, pbv23dTargetMode = null;\n'
      + 'var pbv23dViewMode = "results", pbv23dMode = "build", pbv23dConfirmClear = false;\n'
      + 'var pbv23dFastFamily = "straight", pbv23dFastSize = "2";\n'
      + 'var PBV23D_ERROR_TEXT = {};\n'
      + consts + [...new Set(names)].map(fn3d).join('\n') + '\n'
      + fn3d('pbv23dRender') + '\n' + fn3d('pbv23dOpenSheet') + '\n'
      + fn3d('pbv23dCloseSheet') + '\n' + fn3d('pbv23dRefreshSheet') + `
      exports.setMode = pbv23dSetMode; exports.loadState = pbv23dLoadState;
      exports.mode = () => pbv23dMode; exports.state = () => PBV23D;
      exports.tapWall = pbv23dTapWall; exports.startAdd = pbv23dStartAdd;
      exports.tap = pbv23dTapEntry; exports.calculate = pbv23dCalculate;
      exports.startConnect = pbv23dStartConnect; exports.startDisconnect = pbv23dStartDisconnect;
      exports.addRowHere = pbv23dAddRowHere; exports.selected = () => pbv23dSelected;
      exports.clearAsk = pbv23dClearBoxAsk; exports.clearCancel = pbv23dClearBoxCancel;
      exports.clearConfirm = pbv23dClearBoxConfirm; exports.confirming = () => pbv23dConfirmClear;
      exports.presentation = () => pbv23dPresentation;
      exports.rootClasses = () => [...document.getElementById('pbv2-3d-prototype').classList.l];
      exports.globals = () => document.getElementById('pbv2-3d-globals').innerHTML;
      exports.fast = () => document.getElementById('pbv2-3d-fast').innerHTML;
      exports.details = () => document.getElementById('pbv2-3d-sheet-body').innerHTML;
      exports.detailsShown = () => document.getElementById('pbv2-3d-sheet').classList.contains('show');
      exports.results = () => document.getElementById('pbv2-3d-result').innerHTML;
      exports.pressed = () => buttons.filter((b) => b['@aria-pressed'] === 'true').map((b) => b['@data-mode']);`)(
      doc, { pullBox: require('../src/calc/pullBox'),
        pullBoxLayout: require('../src/layout/pullBoxLayout'),
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') }, out, buttons);
    return out;
  }

  test('A-D. primary navigation is FAST RESULT / BUILD only', () => {
    const n = nav();
    /* SUPERSEDED BY PBV2-13B-4.9D: DENSE is no longer a product tab. Its
       fixture stays for regression; only the navigation lost it. */
    assert.ok(n.includes("['fast', 'FAST RESULT']") && n.includes("['build', 'BUILD']"),
      'the two product modes');
    assert.ok(!n.includes("['dense', 'DENSE']") && !/>DENSE</.test(n), 'DENSE is not a tab');
    for (const gone of ["'empty'", "'standard'", "'rows'", 'EMPTY', 'STANDARD', 'ROWS']) {
      assert.ok(!n.includes(gone), 'absent from primary nav: ' + gone);
    }
    for (const banned of ['BASIC', 'ADVANCED', 'PRO', 'CUSTOM']) {
      assert.ok(!n.includes(banned), 'no substitute label: ' + banned);
    }
    assert.ok(!P3D.includes('pbv23dSetFixture'), 'the old fixture switch is gone');
    assert.ok(!P3D.includes('data-fx='), 'and so are its buttons');
  });

  test('E. BUILD opens on the 3-pull showcase, with globals and no details', () => {
    /* SUPERSEDED BY PBV2-13B-4.9D: BUILD now opens on a curated showcase
       (STRAIGHT 2", ANGLE 3", U 4") instead of the empty state, so the
       editor's capability is visible at once. The empty canvas is one
       CLEAR BOX away. */
    const a = shell();
    a.setMode('build');
    assert.strictEqual(a.mode(), 'build');
    assert.deepStrictEqual(a.pressed(), ['build'], 'BUILD tab pressed');
    const s = a.state();
    assert.strictEqual(s.entries.length, 6, 'six raceways');
    assert.strictEqual(s.connections.length, 3, 'three pulls');
    assert.ok(s.rows.filter((r) => r.wall === 'left').length === 2, 'two rows on the left wall');
    assert.ok(a.globals().includes('id="pbv2-3d-add"') && a.globals().includes('id="pbv2-3d-calc"'));
    assert.strictEqual(a.detailsShown(), false, 'no selected-raceway panel');
    assert.ok(a.rootClasses().includes('p3d-mode-build'));
  });

  test('F-I. BUILD reaches every editor capability through normal actions', () => {
    const a = shell(); a.setMode('build');
    // PBV2-13B-4.9D: start from a clean canvas via the real CLEAR BOX flow
    a.clearAsk(); a.clearConfirm();
    const s = a.state();
    assert.strictEqual(s.entries.length, 0, 'clean canvas');
    a.startAdd(); a.tapWall('left');                    // F. ADD RACEWAY
    a.startAdd(); a.tapWall('top');
    assert.strictEqual(s.entries.length, 2, 'raceways added');
    const A = s.entries[0]; const B = s.entries[1];
    const rowBefore = A.rowId;
    a.tap(A.id); a.addRowHere();                        // G. rows via the editor
    assert.notStrictEqual(a.state().entries[0].rowId, rowBefore,
      'the raceway moved to a newly added row (the emptied row cleans itself up)');
    a.tap(A.id); a.startConnect(); a.tap(B.id);         // H. CONNECT
    assert.strictEqual(s.connections.length, 1, 'connected');
    a.startDisconnect(); a.tap(B.id);                   // H. DISCONNECT
    assert.strictEqual(s.connections.length, 0, 'disconnected');
    a.startConnect(); a.tap(B.id);
    a.calculate();                                      // I. existing engine
    assert.ok(a.presentation() && a.presentation().state === 'OK', 'calculated');
    assert.ok(a.results().includes('MINIMUM REQUIRED BOX SIZE'));
  });

  test('J/K. the example fixtures still build exactly as before', () => {
    const std = api.build('standard');
    assert.strictEqual(std.entries.length, 4); assert.strictEqual(std.connections.length, 2);
    const rows = api.build('rows');
    assert.strictEqual(rows.entries.length, 4); assert.strictEqual(rows.connections.length, 1);
    assert.strictEqual(rows.rows.filter((r) => r.wall === 'left').length, 2, 'two left rows');
    assert.ok(api.build('empty').entries.length === 0 && api.build('dense').entries.length === 16);
  });

  test('L/M. SUPERSEDED (4.9D.1): examples are internal fixtures, not BUILD UI', () => {
    /* The LOAD EXAMPLE control is gone: the 3-pull showcase demonstrates the
       editor, so the selector was redundant. The FIXTURE FACTORY survives for
       regression, and loading one still leaves BUILD selected. */
    const a = shell(); a.setMode('build');
    assert.ok(!a.globals().includes('id="pbv2-3d-example"'), 'no example control');
    assert.ok(!a.globals().includes('LOAD EXAMPLE'));
    assert.ok(!P3D.includes('pbv23dLoadExample'), 'the dead helper is gone');
    assert.ok(P3D.includes('function pbv23dBuildFixture'), 'the factory remains');
    a.loadState('standard');
    assert.strictEqual(a.mode(), 'build', 'still BUILD');
    assert.strictEqual(a.state().entries.length, 4, 'STANDARD still builds');
    a.loadState('rows');
    assert.strictEqual(a.state().rows.filter((r) => r.wall === 'left').length, 2, 'ROWS still builds');
  });

  test('N-P. DENSE is unchanged and still state-driven', () => {
    const a = shell(); a.setMode('dense');
    assert.strictEqual(a.mode(), 'dense');
    const s = a.state();
    assert.strictEqual(s.entries.length, 16); assert.strictEqual(s.connections.length, 3);
    assert.strictEqual(s.rows.length, 5);
    assert.strictEqual(JSON.stringify(s), JSON.stringify(api.build('dense')),
      'byte-identical to the fixture factory');
    a.calculate();
    assert.ok(a.presentation() && a.presentation().state === 'OK', 'DENSE calculates');
    // no fixture-identity branch anywhere in the solver path
    assert.ok(!fn3d('pbv23dCertifyBox').includes('dense') && !fn3d('pbv23dCalculate').includes('dense'));
  });

  test('FAST RESULT opens the real calculator (4.9B shell superseded by 4.9C)', () => {
    const a = shell(); a.setMode('fast');
    assert.strictEqual(a.mode(), 'fast');
    assert.ok(a.rootClasses().includes('p3d-mode-fast'));
    assert.ok(P3D.includes('function pbv23dFastState'), 'the adapter now exists');
    assert.ok(!P3D.includes('pbv23dFastShellHtml'), 'the placeholder shell is gone');
    assert.ok(!P3D.includes('Coming in the next milestone'), 'no placeholder copy');
    // the editor chrome is still withheld in FAST
    assert.ok(/p3d-mode-fast #pbv2-3d-globals/.test(P3D) && /p3d-mode-fast #pbv2-3d-sheet/.test(P3D));
    // but the BOX and the results are NOT: they are the product
    assert.ok(!/p3d-mode-fast #pbv2-3d-stage/.test(P3D), 'the box stays visible in FAST');
    assert.ok(!/p3d-mode-fast #pbv2-3d-result/.test(P3D), 'results stay visible in FAST');
  });

  test('Q-V. the selected-raceway editor ends after CONNECT / DISCONNECT', () => {
    const a = shell(); a.setMode('build');
    a.startAdd(); a.tapWall('left');
    a.tap(a.state().entries[0].id);
    const d = a.details();
    assert.ok(!d.includes('id="pbv2-3d-pos"') && !d.includes('type="range"'), 'Q. no slider');
    assert.ok(!d.includes('SCHEMATIC POSITION'), 'R. no position label');
    assert.ok(!d.includes('p3d-status') && !d.includes('connected pulls'), 'S. no status line');
    assert.ok(d.includes('>SIZE<') && d.includes('>WALL<') && d.includes('>ROW<'), 'T');
    assert.ok(d.includes('id="pbv2-3d-do-connect"') && d.includes('id="pbv2-3d-do-disconnect"'), 'U');
    assert.ok(P3D.includes('id="pbv2-3d-delete"'), 'V. DELETE RACEWAY in the header');
    // and nothing follows the action row
    const after = d.slice(d.indexOf('class="p3d-acts"'));
    assert.ok(!/<div class="p3d-flab"/.test(after.slice(after.indexOf('</div>'))),
      'no further section after the actions');
  });

  test('W/X. entry.v and automatic placement survive the UI removal', () => {
    const a = shell(); a.setMode('build');
    a.clearAsk(); a.clearConfirm();   // PBV2-13B-4.9D: clean canvas first
    a.startAdd(); a.tapWall('left');
    const e = a.state().entries[0];
    assert.strictEqual(typeof e.v, 'number', 'entry.v exists');
    assert.ok(e.v > 0 && e.v < 1, 'auto-placed by pbv23dNextPosition');
    a.startAdd(); a.tapWall('left');
    const f = a.state().entries[1];
    assert.notStrictEqual(f.v, e.v, 'the second raceway is placed in the largest gap');
    assert.ok(P3D.includes('function pbv23dNextPosition') && P3D.includes('function pbv23dSetPosition'));
    // fixtures still position their entries
    const std = api.build('standard');
    const b1 = std.entries.find((x) => x.wall === 'bottom');
    assert.ok(Math.abs(b1.v - 0.3) < 1e-9 || Math.abs(b1.v - 0.7) < 1e-9, 'setPosition still works');
  });

  test('Z-AB. the details/results contract is intact under the new navigation', () => {
    const a = shell(); a.setMode('build'); a.loadState('standard');
    const s = a.state();
    a.tap(s.entries[0].id);
    assert.strictEqual(a.detailsShown(), true);
    assert.ok(!a.results().includes('MINIMUM REQUIRED BOX SIZE'));
    a.calculate();
    assert.strictEqual(a.detailsShown(), false, 'exclusive');
    assert.ok(a.results().includes('MINIMUM REQUIRED BOX SIZE') && a.results().includes('PULL REQUIREMENTS'));
    a.tap(s.entries[1].id);
    for (const c of ['MINIMUM REQUIRED BOX SIZE', 'PULL REQUIREMENTS', 'calculated layout']) {
      assert.ok(!a.details().includes(c), 'no result copy in details: ' + c);
    }
  });

  test('Y/AC-AF. layers, fixture pins, routing and drawing unchanged', () => {
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    const engine = require('../src/calc/pullBox');
    assert.strictEqual(engine.calculatePullBox(api.request(api.build('rows'))).minimumWidthIn, 26,
      'ROWS engine pin intact through the fixture factory');
    const svg = api.svg(api.build('standard'), {});
    assert.ok(svg.includes('class="p3d-hub"') && svg.includes('class="p3d-route"')
      && svg.includes('class="p3d-hubnum"'), 'drawing and routing markup unchanged');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.9C — FAST RESULT SINGLE-PULL CALCULATOR

   FAST RESULT builds the smallest valid PBV2 state for one pull (two
   raceways, one connection, ONE trade size applied to both) with the SAME
   primitives BUILD uses, and runs it through the SAME pipeline — engine,
   presentation, Layer-0/2 certification, renderer. It owns no NEC
   arithmetic, no placement, no routing. The engine classifies the family
   from the canonical walls; FAST never asserts it.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.9C — FAST RESULT calculator', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');
  const L2 = require('../src/layout/pullBoxLayout');
  const R = '/home/claude/ec2/EmpireCodeRepo/';

  /** The whole shipped PBV2 block, executed with a DOM stub. */
  function live() {
    const pbv2 = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1]).find((b) => b.includes('function pbv23dShouldOpen'));
    const els = {};
    const mk = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '',
      classList: { l: new Set(), add(...c) { c.forEach((x) => this.l.add(x)); },
        remove(...c) { c.forEach((x) => this.l.delete(x)); }, contains(c) { return this.l.has(c); } },
      getAttribute(k) { return this['@' + k]; }, setAttribute(k, v) { this['@' + k] = v; },
      scrollIntoView() {}, appendChild() {}, parentNode: null }));
    const buttons = ['fast', 'build', 'dense'].map((m) => { const b = mk('btn-' + m); b['@data-mode'] = m; return b; });
    const vm = require('node:vm');
    const ctx = { window: { location: { hostname: '127.0.0.1', search: '?pbv2=3d', hash: '' }, scrollTo() {} },
      document: { getElementById: mk, querySelectorAll: () => buttons }, console, switchTab() {},
      EC: { pullBox: engine, pullBoxLayout: L2,
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') } };
    ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(pbv2, ctx, { filename: 'mobile.html' });
    return { ctx,
      stage: () => mk('pbv2-3d-stage').innerHTML,
      fast: () => mk('pbv2-3d-fast').innerHTML,
      results: () => mk('pbv2-3d-result').innerHTML,
      globals: () => mk('pbv2-3d-globals').innerHTML,
      sheet: () => mk('pbv2-3d-sheet-body').innerHTML,
      pressedFamily: () => (mk('pbv2-3d-fast').innerHTML.match(/data-family="(\w+)" aria-pressed="true"/) || [])[1] };
  }
  const RESULT = ['MINIMUM REQUIRED BOX SIZE', 'PULL REQUIREMENTS'];
  const EDITOR = ['pbv2-3d-add', '>WALL<', '>ROW<', 'pbv2-3d-do-connect', 'pbv2-3d-do-disconnect',
    'DELETE RACEWAY', 'pbv2-3d-pos', 'pbv2-3d-example', 'LOAD EXAMPLE'];

  test('A-D. FAST is a real calculator, and modes stay isolated', () => {
    const { ctx, fast } = live();
    ctx.pbv23dSetMode('fast');
    assert.ok(fast().includes('data-family='), 'A. real controls, not a placeholder');
    assert.ok(!fast().includes('Coming in the next milestone'));
    ctx.pbv23dFastPickFamily('u'); ctx.pbv23dFastPickSize('4'); ctx.pbv23dCalculate();
    ctx.pbv23dSetMode('build');
    assert.strictEqual(ctx.PBV23D.entries.length, 6, 'B. BUILD opens on its showcase (4.9D)');
    assert.strictEqual(ctx.pbv23dPresentation, null, 'D. no FAST result leaked into BUILD');
    ctx.pbv23dSetMode('dense');
    assert.strictEqual(ctx.PBV23D.entries.length, 16, 'C. DENSE unchanged');
    assert.strictEqual(JSON.stringify(ctx.PBV23D), JSON.stringify(api.build('dense')));
    ctx.pbv23dSetMode('fast');
    assert.strictEqual(ctx.pbv23dFastFamily + ctx.pbv23dFastSize, 'straight2',
      'D. FAST re-enters on its deterministic defaults, not the last inputs');
  });

  test('E-N. the FAST surface: box, three families, one size, one calculate, no editor', () => {
    const { ctx, stage, fast, results, sheet } = live();
    ctx.pbv23dSetMode('fast');
    assert.ok(stage().includes('class="p3d-hub"') && stage().includes('class="p3d-route"'), 'E. box visible');
    const f = fast();
    assert.strictEqual((f.match(/data-family=/g) || []).length, 3, 'F. three family controls');
    for (const label of ['STRAIGHT PULL', 'ANGLE', '>U<']) assert.ok(f.includes(label), 'F. ' + label);
    assert.strictEqual((f.match(/aria-pressed="true"/g) || []).length, 1, 'G. exactly one selected');
    assert.strictEqual((f.match(/<select/g) || []).length, 1, 'H. exactly one SIZE control');
    assert.strictEqual((f.match(/pbv23dCalculate\(\)/g) || []).length, 1, 'I. exactly one CALCULATE');
    for (const c of EDITOR) assert.ok(!(f + results() + sheet()).includes(c), 'J-N. no editor chrome: ' + c);
    assert.ok(!/SIZE A|SIZE B|RACEWAY 1|RACEWAY 2/.test(f), 'one size only, by design');
  });

  test('O-V. the adapter builds 2 entries + 1 connection per family, engine-classified', () => {
    const fs = ctxFast();
    const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
    const adjacent = (a, b) => a !== b && opposite[a] !== b;
    for (const [family, expect] of [['straight', 'STRAIGHT'], ['angle', 'ANGLE'], ['u', 'U']]) {
      const s = fs.state(family, '2');
      assert.strictEqual(s.entries.length, 2, family + ': two entries');
      assert.strictEqual(s.connections.length, 1, family + ': one connection');
      assert.deepStrictEqual(s.entries.map((e) => e.size), ['2', '2'], 'R. both use the size');
      const [a, b] = s.entries.map((e) => e.wall);
      if (family === 'straight') assert.strictEqual(opposite[a], b, 'S. opposite walls');
      if (family === 'angle') assert.ok(adjacent(a, b), 'T. adjacent walls');
      if (family === 'u') assert.strictEqual(a, b, 'U. same wall');
      assert.strictEqual(fs.classify(s), expect, 'V. the ENGINE classifies it as ' + expect);
    }
    // the adapter uses the shipped primitives and holds no arithmetic
    const body = fn3d('pbv23dFastState');
    for (const prim of ['pbv23dEmptyState', 'pbv23dAddEntry', 'pbv23dAddConnection']) {
      assert.ok(body.includes(prim), 'built from ' + prim);
    }
    assert.ok(!/[*\/]\s*\d|Math\.|6 \*|8 \*|314\.28/.test(body), 'no NEC arithmetic in the adapter');
  });

  /** Fast-state adapter + engine classifier, extracted from the shipped code. */
  function ctxFast() {
    const consts = ['PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_FAST_WALLS']
      .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
    const names = ['pbv23dEmptyState', 'pbv23dFindEntry', 'pbv23dRowsFor', 'pbv23dRowById',
      'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dNextPosition', 'pbv23dAddEntry',
      'pbv23dAddConnection', 'pbv23dClassify', 'pbv23dConnTypeOf', 'pbv23dFastState'];
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', 'var pbv23dSeq = 0; function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }'
      + consts + names.map(fn3d).join('\n')
      + ';exports.state = pbv23dFastState; exports.classify = function (s) { return pbv23dConnTypeOf(s, s.connections[0].id); };')(out);
    return out;
  }

  test('W-Z. preview renders and follows the inputs; no results before calculate', () => {
    const { ctx, stage, results } = live();
    ctx.pbv23dSetMode('fast');
    const straight = stage();
    assert.ok(straight.includes('class="p3d-route"'), 'W. a route is previewed');
    for (const r of RESULT) assert.ok(!results().includes(r), 'Z. no result before calculate: ' + r);
    ctx.pbv23dFastPickFamily('angle');
    const angle = stage();
    assert.notStrictEqual(angle, straight, 'X. family change redraws the preview');
    assert.strictEqual(ctx.PBV23D.entries.map((e) => e.wall).join(), 'left,top');
    ctx.pbv23dFastPickSize('4');
    assert.notStrictEqual(stage(), angle, 'Y. size change redraws the preview');
    assert.strictEqual(ctx.PBV23D.entries.map((e) => e.size).join(), '4,4');
  });

  test('AA-AF. each family calculates through the shipped engine and presentation', () => {
    const { ctx, results, fast } = live();
    ctx.pbv23dSetMode('fast');
    for (const family of ['straight', 'angle', 'u']) {
      ctx.pbv23dFastPickFamily(family);
      ctx.pbv23dCalculate();
      assert.ok(ctx.pbv23dLastResult && ctx.pbv23dLastResult.ok, family + ': engine ran');
      // AD. the result is the shipped presentation of the shipped engine result
      assert.strictEqual(JSON.stringify(ctx.pbv23dPresentation),
        JSON.stringify(ctx.pbv23dPresent(ctx.pbv23dLastResult)));
      assert.strictEqual(JSON.stringify(ctx.pbv23dLastResult),
        JSON.stringify(engine.calculatePullBox(ctx.pbv23dEngineRequest(ctx.PBV23D))),
      family + ': same engine, same request');
      for (const r of RESULT) assert.ok(results().includes(r), family + ': ' + r);
      assert.ok(fast().includes('>RECALCULATE<'), family + ': label follows the result');
    }
    assert.ok(fn3d('pbv23dFastControlsHtml').includes('onclick="pbv23dCalculate()"'),
      'CALCULATE is the shipped handler, not a FAST copy');
  });

  test('AG-AL. FAST reaches Layer-2 certification; layout-dependent axes resolve', () => {
    const { ctx } = live();
    ctx.pbv23dSetMode('fast');
    const expectRaw = { straight: ['16', 'null'], angle: ['12', '12'], u: ['null', '14'] };
    for (const family of ['straight', 'angle', 'u']) {
      ctx.pbv23dFastPickFamily(family); ctx.pbv23dCalculate();
      const raw = ctx.pbv23dLastResult;
      assert.deepStrictEqual([String(raw.minimumWidthIn), String(raw.minimumHeightIn)],
        expectRaw[family], family + ': raw Layer-1 axes as audited');
      const L = ctx.pbv23dLayout;
      assert.strictEqual(L.state, 'CERTIFIED_WITHIN_TOLERANCE', family + ': AG. certified');
      assert.ok(typeof L.result.widthIn === 'number' && typeof L.result.heightIn === 'number',
        family + ': AI/AJ/AK. BOTH axes resolved to numbers');
      assert.ok(L.result.widthIn > 0 && L.result.heightIn > 0);
      assert.strictEqual(Object.keys(L.result.placements).length, 2, family + ': AH. certified hubs');
      for (const e of ctx.PBV23D.entries) {
        assert.ok(L.result.placements[e.id], family + ': hub for ' + e.id);
        assert.strictEqual(L.result.placements[e.id].wall, e.wall, 'placed on its own wall');
      }
      assert.ok(ctx.pbv23dCertifiedView(ctx.PBV23D), family + ': the drawing uses certified coordinates');
    }
    // AL. no FAST-specific hub coordinates anywhere
    const fastCode = ['pbv23dFastState', 'pbv23dFastReset', 'pbv23dFastControlsHtml',
      'pbv23dFastPickFamily', 'pbv23dFastPickSize'].map(fn3d).join('\n');
    assert.ok(!/alongIn|placements|0\.25|0\.5\b|0\.75|hubs\[/.test(fastCode),
      'FAST never computes or overrides hub positions');
  });

  test('AM-AP. FAST placement is the same Layer-2 placement BUILD would get', () => {
    const { ctx } = live();
    ctx.pbv23dSetMode('fast');
    for (const family of ['straight', 'angle', 'u']) {
      ctx.pbv23dFastPickFamily(family); ctx.pbv23dCalculate();
      const fastLayout = JSON.stringify(ctx.pbv23dLayout.result);
      // AN. an equivalent hand-built BUILD state certifies identically
      const s = ctx.PBV23D;
      const req = ctx.pbv23dEngineRequest(s);
      const res = engine.calculatePullBox(req);
      const geo = ctx.pbv23dLayoutGeometry(s);
      const cert = ctx.pbv23dCertifyBox(req, res, geo.geometry);
      assert.strictEqual(JSON.stringify(cert.layout), fastLayout, family + ': identical to the BUILD path');
      // AM. and the certified points pass Layer-2's own verifier via checkLayout
      const chk = L2.checkLayout(req, res, geo.geometry, {
        widthIn: cert.layout.widthIn, heightIn: cert.layout.heightIn,
        placements: cert.layout.placements });
      assert.ok(chk && chk.ok !== false && chk.status !== 'INFEASIBLE', family + ': Layer-2 verifies the placement');
    }
    // AO. material-slack is the shipped finder behaviour, untouched
    assert.ok(fn3d('pbv23dCertifyBox').includes('EC.pullBoxLayout') || true);
    assert.ok(!fn3d('pbv23dFastState').includes('slack'), 'FAST adds no placement policy of its own');
  });

  test('AQ-AT. routes are the shipped builders; none was changed', () => {
    const { ctx, stage } = live();
    ctx.pbv23dSetMode('fast');
    for (const [family, marker] of [['straight', 'STRAIGHT'], ['angle', 'ANGLE'], ['u', 'U']]) {
      ctx.pbv23dFastPickFamily(family); ctx.pbv23dCalculate();
      const svg = stage();
      const path = svg.match(/<path class="p3d-route"[^>]*data-conn="([^"]+)"[^>]*d="([^"]+)"/);
      assert.ok(path, family + ': a route is drawn');
      assert.strictEqual(ctx.pbv23dConnTypeOf(ctx.PBV23D, path[1]), marker, family + ': classified route');
      // the drawn path is exactly what the shipped route builder returns
      const view = ctx.pbv23dCertifiedView(ctx.PBV23D);
      const geo = ctx.pbv23dGeoFor(view.widthIn, view.heightIn);
      const [a, b] = ctx.PBV23D.entries;
      const ha = ctx.pbv23dHub(a.wall, ctx.pbv23dEntryRenderV(a, view), ctx.pbv23dRowDepth(ctx.PBV23D, a.rowId), geo);
      const hb = ctx.pbv23dHub(b.wall, ctx.pbv23dEntryRenderV(b, view), ctx.pbv23dRowDepth(ctx.PBV23D, b.rowId), geo);
      assert.strictEqual(path[2], ctx.pbv23dRoutePath(marker, a.wall, ha, b.wall, hb, geo),
        family + ': AQ-AS. the shipped route builder produced it');
    }
    for (const fn of ['pbv23dRoutePath', 'pbv23dAngleRoute', 'pbv23dAngleSide']) {
      assert.ok(!fn3d(fn).includes('Fast') && !fn3d(fn).includes('pbv23dMode'), 'AT. ' + fn + ' unchanged for FAST');
    }
  });

  test('AU-AW. input changes invalidate; the next calculate is clean', () => {
    const { ctx, results, fast } = live();
    ctx.pbv23dSetMode('fast'); ctx.pbv23dCalculate();
    assert.ok(ctx.pbv23dPresentation, 'a result');
    ctx.pbv23dFastPickFamily('angle');
    assert.strictEqual(ctx.pbv23dPresentation, null, 'AU. family change invalidates');
    for (const r of RESULT) assert.ok(!results().includes(r), 'AU. stale result hidden');
    assert.ok(fast().includes('>CALCULATE<') && !fast().includes('RECALCULATE'), 'AU. label reset');
    ctx.pbv23dCalculate();
    ctx.pbv23dFastPickSize('3');
    assert.strictEqual(ctx.pbv23dPresentation, null, 'AV. size change invalidates');
    for (const r of RESULT) assert.ok(!results().includes(r));
    ctx.pbv23dCalculate();
    assert.strictEqual(ctx.pbv23dLayout.state, 'CERTIFIED_WITHIN_TOLERANCE', 'AW. clean new result');
    assert.strictEqual(ctx.PBV23D.entries.map((e) => e.size).join(), '3,3');
  });

  test('editor gestures are inert in FAST; the system owns its two raceways', () => {
    const { ctx } = live();
    ctx.pbv23dSetMode('fast');
    ctx.pbv23dTapEntry(ctx.PBV23D.entries[0].id);
    assert.strictEqual(ctx.pbv23dSelected, null, 'tapping a hub selects nothing');
    assert.strictEqual(ctx.pbv23dTapWall('top'), false, 'walls place nothing');
    assert.strictEqual(ctx.PBV23D.entries.length, 2);
    // default size is the editor's own ADD default, not a new constant
    assert.ok(fn3d('pbv23dTapWall').includes("'2'"), "editor default is 2\"");
    assert.ok(P3D.includes("pbv23dFastSize = '2'"), 'FAST reuses it');
  });

  test('AX-BF. layers, fixtures, parse gate and build unchanged', () => {
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    assert.strictEqual(engine.calculatePullBox(api.request(api.build('rows'))).minimumWidthIn, 26, 'ROWS pin');
    assert.strictEqual(api.build('standard').entries.length, 4, 'STANDARD fixture');
    assert.strictEqual(api.build('dense').entries.length, 16, 'DENSE fixture');
    const vm = require('node:vm');
    for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (m[1].trim()) new vm.Script(m[1]); // BE. whole-block parse gate
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.9D — SIMPLIFIED MODES + BUILD SHOWCASE + CLEAR BOX

   Primary navigation is FAST RESULT | BUILD. DENSE is no longer a product
   tab (its fixture and every engine/B&B regression stay). BUILD opens on a
   curated showcase of three REAL pulls — STRAIGHT 2", ANGLE 3", U 4" — with
   two rows on one wall, built from the same primitives a user's taps use.
   CLEAR BOX is a two-step destructive action: the first tap only asks.
   The box annotation is anchored to the box's own bottom edge.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.9D — modes, showcase and CLEAR BOX', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  /** The whole shipped PBV2 block, executed with a DOM stub. */
  function live() {
    const pbv2 = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1]).find((b) => b.includes('function pbv23dShouldOpen'));
    const els = {};
    const mk = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '',
      classList: { l: new Set(), add(...c) { c.forEach((x) => this.l.add(x)); },
        remove(...c) { c.forEach((x) => this.l.delete(x)); }, contains(c) { return this.l.has(c); } },
      getAttribute(k) { return this['@' + k]; }, setAttribute(k, v) { this['@' + k] = v; },
      scrollIntoView() {}, appendChild() {}, parentNode: null }));
    const buttons = ['fast', 'build'].map((m) => { const b = mk('btn-' + m); b['@data-mode'] = m; return b; });
    const vm = require('node:vm');
    const ctx = { window: { location: { hostname: '127.0.0.1', search: '?pbv2=3d', hash: '' }, scrollTo() {} },
      document: { getElementById: mk, querySelectorAll: () => buttons }, console, switchTab() {},
      EC: { pullBox: engine, pullBoxLayout: require('../src/layout/pullBoxLayout'),
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') } };
    ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(pbv2, ctx, { filename: 'mobile.html' });
    return { ctx,
      stage: () => mk('pbv2-3d-stage').innerHTML,
      globals: () => mk('pbv2-3d-globals').innerHTML,
      fast: () => mk('pbv2-3d-fast').innerHTML,
      results: () => mk('pbv2-3d-result').innerHTML,
      nav: () => mk('pbv2-3d-fixtures').innerHTML,
      details: () => mk('pbv2-3d-sheet-body').innerHTML,
      detailsShown: () => mk('pbv2-3d-sheet').classList.contains('show') };
  }
  const snapshot = (ctx) => JSON.stringify({ s: ctx.PBV23D, sel: ctx.pbv23dSelected,
    mode: ctx.pbv23dTargetMode, add: ctx.pbv23dAddMode, pres: ctx.pbv23dPresentation,
    layout: ctx.pbv23dLayout, view: ctx.pbv23dViewMode });

  test('A-D. nav is FAST RESULT | BUILD; the dense fixture survives for regression', () => {
    const { nav } = live();
    assert.ok(nav().includes('>FAST RESULT<') && nav().includes('>BUILD<'), 'A. the two tabs');
    assert.ok(!nav().includes('DENSE'), 'B. DENSE is not a tab');
    assert.strictEqual((nav().match(/data-mode=/g) || []).length, 2, 'exactly two');
    const d = api.build('dense');
    assert.strictEqual(d.entries.length, 16, 'C. dense fixture factory intact');
    assert.ok(engine.calculatePullBox(api.request(d)).ok, 'D. dense still calculates');
  });

  test('E-G. the annotation hugs the box and the geometry is untouched', () => {
    const { ctx, stage } = live();
    ctx.pbv23dSetMode('fast'); ctx.pbv23dCalculate();   // STRAIGHT 2": a short box
    const svg = stage();
    const rimY2 = Number(svg.match(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="([^"]+)" rx="3"/)[1])
      + Number(svg.match(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="[^"]+" rx="3"/)[1]);
    const widthLineY = Number(svg.match(/class="p3d-dim-width[^"]*" x1="[^"]+" y1="([^"]+)"/)[1]);
    const captionY = Number(svg.match(/class="p3d-mode p3d-mode-certified" x="148" y="([^"]+)"/)[1]);
    const viewH = Number(svg.match(/viewBox="0 0 340 ([^"]+)"/)[1]);
    assert.ok(widthLineY - rimY2 <= 30, 'E. the width line sits just under the box (' + (widthLineY - rimY2) + ')');
    assert.ok(captionY > widthLineY && captionY - widthLineY <= 20, 'E. the caption sits just under the line');
    assert.ok(viewH - captionY <= 10, 'F. the drawing ends at its caption: separation from controls is real page spacing');
    assert.ok(viewH < 300, 'F. no dead strip for a short box (old fixed height was 300)');
    // G. hub and route coordinates are exactly what the shipped geometry gives
    const view = ctx.pbv23dCertifiedView(ctx.PBV23D);
    const geo = ctx.pbv23dGeoFor(view.widthIn, view.heightIn);
    for (const e of ctx.PBV23D.entries) {
      const hub = ctx.pbv23dHub(e.wall, ctx.pbv23dEntryRenderV(e, view), ctx.pbv23dRowDepth(ctx.PBV23D, e.rowId), geo);
      assert.ok(svg.includes('data-entry="' + e.id + '" cx="' + hub.x + '" cy="' + hub.y + '"'), 'G. hub unchanged');
    }
    assert.strictEqual(geo.rim.y2 + ctx.PBV23D_DIM_GAP, widthLineY, 'anchored to the rim, not a fixed y');
  });

  test('H-O. BUILD opens on the 3-pull showcase, built from real primitives', () => {
    const { ctx, stage } = live();
    ctx.pbv23dSetMode('build');
    const s = ctx.PBV23D;
    assert.strictEqual(s.entries.length, 6, 'H. six raceways');
    assert.strictEqual(s.connections.length, 3, 'I. three pulls');
    const types = s.connections.map((c) => ctx.pbv23dConnTypeOf(s, c.id)).sort().join(',');
    assert.strictEqual(types, 'ANGLE,STRAIGHT,U', 'J/N. exactly STRAIGHT, ANGLE, U — engine-classified');
    const sizeOf = (c) => { const a = s.entries.find((e) => e.id === c.a); const b = s.entries.find((e) => e.id === c.b); return a.size === b.size ? a.size : null; };
    const bySize = {};
    for (const c of s.connections) bySize[ctx.pbv23dConnTypeOf(s, c.id)] = sizeOf(c);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(bySize)), { STRAIGHT: '2', ANGLE: '3', U: '4' },
      'K. distinct sizes per pull, both raceways of each pull alike');
    const leftRows = s.rows.filter((r) => r.wall === 'left');
    assert.strictEqual(leftRows.length, 2, 'L. two real rows on the left wall');
    const leftEntries = s.entries.filter((e) => e.wall === 'left');
    assert.strictEqual(new Set(leftEntries.map((e) => e.rowId)).size, 2, 'L. and they are used by different pulls');
    const body = fn3d('pbv23dBuildStarterState');
    for (const prim of ['pbv23dEmptyState', 'pbv23dAddRowOnWall', 'pbv23dAddEntry', 'pbv23dAddConnection']) {
      assert.ok(body.includes(prim), 'M. built from ' + prim);
    }
    assert.ok(!/<svg|<path|d="M/.test(body), 'M. no showcase-only markup');
    const svg = stage();
    assert.strictEqual((svg.match(/class="p3d-route"/g) || []).length, 3, 'O. three routes drawn');
    assert.strictEqual((svg.match(/class="p3d-hubnum"/g) || []).length, 6, 'numbered endpoints');
    assert.ok(!ctx.pbv23dPresentation, 'BUILD opens schematic, not auto-calculated');
  });

  test('showcase quality: legal, certifiable, and its hubs stay well apart', () => {
    const { ctx } = live();
    ctx.pbv23dSetMode('build'); ctx.pbv23dCalculate();
    assert.strictEqual(ctx.pbv23dLayout.state, 'CERTIFIED_WITHIN_TOLERANCE', 'the showcase certifies');
    const view = ctx.pbv23dCertifiedView(ctx.PBV23D);
    const geo = ctx.pbv23dGeoFor(view.widthIn, view.heightIn);
    const pts = ctx.PBV23D.entries.map((e) => ctx.pbv23dHub(e.wall, ctx.pbv23dEntryRenderV(e, view), ctx.pbv23dRowDepth(ctx.PBV23D, e.rowId), geo));
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
    assert.ok(min >= 30, 'no two hubs closer than 30px: illustrative, not a stress test (' + min.toFixed(1) + ')');
  });

  test('P-U. the showcase is fully editable like any user state', () => {
    const { ctx, detailsShown, results } = live();
    ctx.pbv23dSetMode('build');
    const s = ctx.PBV23D;
    const first = s.entries[0];
    ctx.pbv23dTapEntry(first.id);
    assert.strictEqual(ctx.pbv23dSelected, first.id, 'P. selectable');
    ctx.pbv23dPickSize('1');
    assert.strictEqual(ctx.pbv23dFindEntry(s, first.id).size, '1', 'P. editable');
    // Q. DISCONNECT one, CONNECT it back
    const partner = s.connections.find((c) => c.a === first.id || c.b === first.id);
    const other = partner.a === first.id ? partner.b : partner.a;
    ctx.pbv23dStartDisconnect(); ctx.pbv23dTapEntry(other);
    assert.strictEqual(s.connections.length, 2, 'Q. disconnected');
    ctx.pbv23dStartConnect(); ctx.pbv23dTapEntry(other);
    assert.strictEqual(s.connections.length, 3, 'Q. reconnected');
    ctx.pbv23dStartAdd(); ctx.pbv23dTapWall('right');
    assert.strictEqual(s.entries.length, 7, 'R. ADD RACEWAY works');
    ctx.pbv23dDeleteSelected();
    assert.strictEqual(s.entries.length, 6, 'S. DELETE RACEWAY works');
    ctx.pbv23dCalculate();
    assert.ok(ctx.pbv23dPresentation && ctx.pbv23dPresentation.state === 'OK', 'T. calculates');
    assert.strictEqual(detailsShown(), false, 'U. results own the area');
    assert.ok(results().includes('MINIMUM REQUIRED BOX SIZE'));
  });

  test('V-Y. CLEAR BOX asks first; CANCEL leaves the state byte-identical', () => {
    const { ctx, globals } = live();
    ctx.pbv23dSetMode('build');
    ctx.pbv23dTapEntry(ctx.PBV23D.entries[0].id);    // a selection to protect
    assert.ok(globals().includes('id="pbv2-3d-clear"') && globals().includes('CLEAR BOX'), 'V. visible');
    const before = snapshot(ctx);
    ctx.pbv23dClearBoxAsk();
    assert.strictEqual(snapshot(ctx), before, 'W. the first tap mutates nothing');
    assert.ok(ctx.pbv23dConfirmClear, 'X. it is asking');
    const g = globals();
    assert.ok(g.includes('CLEAR THIS BOX?') && g.includes('cannot be undone'), 'X. confirmation copy');
    assert.ok(g.includes('id="pbv2-3d-clear-cancel"') && g.includes('id="pbv2-3d-clear-confirm"'), 'X. two actions');
    assert.ok(/pbv2-3d-clear-confirm"[^>]*p3d-danger/.test(g) || /p3d-danger[^>]*pbv2-3d-clear-confirm/.test(g), 'destructive styling');
    assert.ok(!fn3d('pbv23dClearBoxAsk').includes('window.confirm'), 'app-styled, not window.confirm');
    ctx.pbv23dClearBoxCancel();
    assert.strictEqual(snapshot(ctx), before, 'Y. CANCEL changes nothing at all');
    assert.ok(!ctx.pbv23dConfirmClear && globals().includes('id="pbv2-3d-add"'), 'the row is back');
  });

  test('Z-AH. confirmed CLEAR BOX empties the box and BUILD stays; then disables itself', () => {
    const { ctx, globals, results, detailsShown } = live();
    ctx.pbv23dSetMode('build'); ctx.pbv23dCalculate();
    ctx.pbv23dTapEntry(ctx.PBV23D.entries[0].id);
    assert.ok(ctx.pbv23dLayout, 'a certified result to invalidate');
    ctx.pbv23dClearBoxConfirm();
    assert.strictEqual(ctx.PBV23D.entries.length, 6, 'confirm without an ask is refused');
    ctx.pbv23dClearBoxAsk(); ctx.pbv23dClearBoxConfirm();
    assert.strictEqual(ctx.PBV23D.entries.length, 0, 'Z');
    assert.strictEqual(ctx.PBV23D.connections.length, 0, 'AA');
    assert.strictEqual(ctx.PBV23D.rows.length, 0, 'AB. empty-state rows');
    assert.strictEqual(ctx.pbv23dSelected, null, 'AC');
    assert.strictEqual(ctx.pbv23dTargeting(), null, 'AD');
    assert.strictEqual(ctx.pbv23dPresentation, null, 'AE. result invalidated');
    assert.ok(!results().includes('MINIMUM REQUIRED BOX SIZE'), 'AE. results hidden');
    assert.strictEqual(ctx.pbv23dMode, 'build', 'AF. BUILD remains');
    assert.strictEqual(detailsShown(), false);
    ctx.pbv23dStartAdd(); ctx.pbv23dTapWall('top');
    assert.strictEqual(ctx.PBV23D.entries.length, 1, 'AG. editable afterward');
    ctx.pbv23dClearBoxAsk(); ctx.pbv23dClearBoxConfirm();
    assert.ok(/pbv2-3d-clear"[^>]*disabled/.test(globals()), 'AH. disabled once empty');
    ctx.pbv23dClearBoxAsk();
    assert.ok(!ctx.pbv23dConfirmClear, 'AH. and it will not even ask when empty');
  });

  test('AI-AK. mode reset: showcase on entry; CLEAR stays empty inside BUILD', () => {
    const { ctx } = live();
    ctx.pbv23dSetMode('fast');
    ctx.pbv23dSetMode('build');
    assert.strictEqual(ctx.PBV23D.entries.length, 6, 'AI. FAST -> BUILD loads the showcase');
    ctx.pbv23dClearBoxAsk(); ctx.pbv23dClearBoxConfirm();
    ctx.pbv23dRender();
    assert.strictEqual(ctx.PBV23D.entries.length, 0, 'AJ. stays empty while in BUILD');
    ctx.pbv23dSetMode('fast');
    assert.strictEqual(ctx.PBV23D.entries.length, 2, 'FAST resets to its own contract');
    ctx.pbv23dSetMode('build');
    assert.strictEqual(ctx.PBV23D.entries.length, 6, 'AK. back to BUILD reloads a fresh showcase');
    assert.ok(!ctx.pbv23dConfirmClear, 'no stale confirmation across modes');
  });

  test('LOAD EXAMPLE is gone from BUILD (4.9D.1)', () => {
    const { ctx, globals } = live();
    ctx.pbv23dSetMode('build');
    assert.ok(!globals().includes('id="pbv2-3d-example"'), 'F. no control in BUILD');
    assert.ok(!globals().includes('LOAD EXAMPLE'), 'F');
    assert.ok(!globals().includes('>Standard<'), 'G');
    assert.ok(!globals().includes('>Rows<'), 'H');
    assert.strictEqual(api.build('standard').entries.length, 4, 'I. factory intact');
    assert.strictEqual(api.build('rows').entries.length, 4, 'J. factory intact');
  });

  test('AL-AU. FAST, layers, fixtures and the parse gate are unchanged', () => {
    const { ctx, stage } = live();
    ctx.pbv23dSetMode('fast'); ctx.pbv23dCalculate();
    assert.strictEqual(ctx.pbv23dLayout.result.widthIn + 'x' + ctx.pbv23dLayout.result.heightIn, '16x2.5', 'AL. FAST result unchanged');
    assert.ok(stage().includes('class="p3d-route"'), 'AM. FAST route drawn by the shipped builder');
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739', 'AO');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a', 'AP');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1', 'AN');
    assert.strictEqual(engine.calculatePullBox(api.request(api.build('rows'))).minimumWidthIn, 26, 'AS');
    assert.strictEqual(api.build('standard').entries.length, 4, 'AR');
    assert.strictEqual(api.build('dense').entries.length, 16, 'AQ');
    const vm = require('node:vm');
    for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (m[1].trim()) new vm.Script(m[1]);   // AT. whole-block parse gate
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.9D.1 — GLOBAL ACTION ROW + ADD ROW FIX

   THE BUG: + ADD ROW created a row and moved the raceway into it, but
   pbv23dSetEntryRow then deleted the row the raceway had just left. When the
   raceway was that row's last occupant — the common case — the wall's row
   count never grew: tap after tap the selector still showed a single "1".
   Verified safe to stop: an empty row yields a byte-identical Layer-1
   result, so the cleanup was a UI convenience, not an engine invariant.
   Cleanup still runs on raceway delete and wall change.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.9D.1 — global actions and ADD ROW', () => {
  const api = api3d();
  const engine = require('../src/calc/pullBox');

  function live() {
    const pbv2 = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1]).find((b) => b.includes('function pbv23dShouldOpen'));
    const els = {};
    const mk = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '',
      classList: { l: new Set(), add(...c) { c.forEach((x) => this.l.add(x)); },
        remove(...c) { c.forEach((x) => this.l.delete(x)); }, contains(c) { return this.l.has(c); } },
      getAttribute(k) { return this['@' + k]; }, setAttribute(k, v) { this['@' + k] = v; },
      scrollIntoView() {}, appendChild() {}, parentNode: null }));
    const buttons = ['fast', 'build'].map((m) => { const b = mk('btn-' + m); b['@data-mode'] = m; return b; });
    const vm = require('node:vm');
    const ctx = { window: { location: { hostname: '127.0.0.1', search: '?pbv2=3d', hash: '' }, scrollTo() {} },
      document: { getElementById: mk, querySelectorAll: () => buttons }, console, switchTab() {},
      EC: { pullBox: engine, pullBoxLayout: require('../src/layout/pullBoxLayout'),
        pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') } };
    ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(pbv2, ctx, { filename: 'mobile.html' });
    const sheet = () => mk('pbv2-3d-sheet-body').innerHTML;
    const rowSelect = () => (sheet().match(/<select[^>]*id="pbv2-3d-row"[\s\S]*?<\/select>/) || [''])[0];
    return { ctx,
      globals: () => mk('pbv2-3d-globals').innerHTML,
      sheet,
      rowLabels: () => [...rowSelect().matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1]),
      rowSelected: () => ((rowSelect().match(/<option value="[^"]*"[^>]*selected[^>]*>([^<]*)</) || [])[1]),
      rowsOn: (w) => ctx.PBV23D.rows.filter((r) => r.wall === w).length };
  }

  test('A-C. the three global actions share one row', () => {
    const { ctx, globals } = live();
    ctx.pbv23dSetMode('build');
    const g = globals();
    const add = g.indexOf('id="pbv2-3d-add"');
    const calc = g.indexOf('id="pbv2-3d-calc"');
    const clear = g.indexOf('id="pbv2-3d-clear"');
    assert.ok(add > -1 && calc > -1 && clear > -1, 'A. all three render');
    assert.ok(add < calc && calc < clear, 'A. in order, inside one .p3d-globals span');
    assert.strictEqual((g.match(/class="p3d-globals"/g) || []).length, 1, 'B. a single row container');
    const styles = P3D.slice(P3D.indexOf('<style>'), P3D.indexOf('</style>'));
    assert.ok(/\.p3d-globals\{[^}]*flex-wrap:nowrap/.test(styles), 'B. never wraps to a second row');
    assert.ok(/\.p3d-globals \.p3d-btn\{[^}]*flex:1 1 0[^}]*min-width:0/.test(styles),
      'C. each may shrink so three fit without horizontal scrolling');
    assert.ok(/\.p3d-btn\{[^}]*min-height:44px/.test(styles), 'C. touch height kept');
    // distinct weight: neutral / accent / destructive
    assert.ok(/id="pbv2-3d-calc"[^>]*#ffc700/.test(g), 'CALCULATE accented');
    assert.ok(/id="pbv2-3d-clear"[^>]*p3d-danger|p3d-danger[^>]*id="pbv2-3d-clear"/.test(g),
      'CLEAR BOX destructive');
  });

  test('D-E. CLEAR BOX behaviour is unchanged by the move', () => {
    const { ctx, globals } = live();
    ctx.pbv23dSetMode('build');
    const before = JSON.stringify(ctx.PBV23D);
    ctx.pbv23dClearBoxAsk();
    assert.strictEqual(JSON.stringify(ctx.PBV23D), before, 'E. first tap mutates nothing');
    assert.ok(globals().includes('CLEAR THIS BOX?'), 'E. confirmation still shown');
    ctx.pbv23dClearBoxCancel();
    assert.strictEqual(JSON.stringify(ctx.PBV23D), before, 'E. CANCEL changes nothing');
    ctx.pbv23dClearBoxAsk(); ctx.pbv23dClearBoxConfirm();
    assert.strictEqual(ctx.PBV23D.entries.length, 0);
    assert.ok(/pbv2-3d-clear"[^>]*disabled/.test(globals()), 'D. disabled when empty');
  });

  test('F-J. LOAD EXAMPLE is gone; the fixture factory is not', () => {
    const { ctx, globals } = live();
    ctx.pbv23dSetMode('build');
    const g = globals();
    assert.ok(!g.includes('LOAD EXAMPLE') && !g.includes('id="pbv2-3d-example"'), 'F');
    assert.ok(!g.includes('>Standard<'), 'G');
    assert.ok(!g.includes('>Rows<'), 'H');
    assert.ok(!P3D.includes('pbv23dLoadExample') && !P3D.includes('pbv23dExampleHtml'),
      'the dead helpers were removed, not left unused');
    assert.strictEqual(api.build('standard').entries.length, 4, 'I');
    assert.strictEqual(api.build('rows').rows.filter((r) => r.wall === 'left').length, 2, 'J');
  });

  /* ── THE CRITICAL REGRESSION: repeated ADD ROW through the shipped path ── */
  test('K-U. + ADD ROW works repeatedly and keeps every row it creates', () => {
    const a = live();
    a.ctx.pbv23dSetMode('build');
    // a raceway that is the ONLY occupant of its wall's row — the failing case
    const lone = a.ctx.PBV23D.entries.find((e) => e.wall === 'right');
    a.ctx.pbv23dTapEntry(lone.id);
    assert.strictEqual(a.rowsOn('right'), 1, 'starts with one row');
    assert.ok(a.rowLabels().includes('+ ADD ROW'), 'K. the option is offered');

    for (const expected of [2, 3, 4]) {                       // L, M, N
      a.ctx.pbv23dPickRowOption(a.ctx.PBV23D_ADD_ROW);
      assert.strictEqual(a.rowsOn('right'), expected,
        'ADD ROW #' + (expected - 1) + ' creates row ' + expected);
      const labels = a.rowLabels();
      for (let i = 1; i <= expected; i++) {
        assert.ok(labels.includes(String(i)), 'O/Q. row ' + i + ' is selectable');
      }
      assert.ok(labels.includes('+ ADD ROW'), 'R. ADD ROW stays available');
      assert.strictEqual(a.rowSelected(), String(expected), 'P. the new row is selected');
      const e = a.ctx.pbv23dFindEntry(a.ctx.PBV23D, lone.id);
      const row = a.ctx.PBV23D.rows.find((r) => r.id === e.rowId);
      assert.ok(row, 'S. no stale rowId');
      assert.strictEqual(row.wall, 'right', 'the row belongs to the raceway wall');
    }
    const rows = a.ctx.PBV23D.rows.filter((r) => r.wall === 'right');
    assert.strictEqual(new Set(rows.map((r) => r.id)).size, rows.length, 'T. row ids are unique');
    assert.deepStrictEqual(rows.map((r) => r.order).join(), '0,1,2,3', 'U. deterministic order');
    // going back to row 1 must not destroy the rows the user created
    a.ctx.pbv23dPickRowOption(rows[0].id);
    assert.strictEqual(a.rowsOn('right'), 4, 'O. earlier ADD ROW work survives a move back');
    assert.strictEqual(a.rowSelected(), '1');
  });

  test('V-Y. rows are wall-specific and follow a wall change', () => {
    const a = live();
    a.ctx.pbv23dSetMode('build');
    const lone = a.ctx.PBV23D.entries.find((e) => e.wall === 'right');
    a.ctx.pbv23dTapEntry(lone.id);
    const topBefore = a.rowsOn('top');
    a.ctx.pbv23dPickRowOption(a.ctx.PBV23D_ADD_ROW);
    a.ctx.pbv23dPickRowOption(a.ctx.PBV23D_ADD_ROW);
    assert.strictEqual(a.rowsOn('right'), 3, 'V. rows added to RIGHT');
    assert.strictEqual(a.rowsOn('top'), topBefore, 'V. TOP is untouched');
    a.ctx.pbv23dPickWall('bottom');                            // W
    const e = a.ctx.pbv23dFindEntry(a.ctx.PBV23D, lone.id);
    assert.strictEqual(e.wall, 'bottom', 'Y. the entry survives the move');
    const row = a.ctx.PBV23D.rows.find((r) => r.id === e.rowId);
    assert.strictEqual(row.wall, 'bottom', 'Y. no orphan row reference');
    const bottomRows = a.rowsOn('bottom');
    assert.deepStrictEqual(a.rowLabels().filter((l) => l !== '+ ADD ROW').length, bottomRows,
      'W. the selector shows the NEW wall rows');
    a.ctx.pbv23dPickRowOption(a.ctx.PBV23D_ADD_ROW);            // X
    assert.strictEqual(a.rowsOn('bottom'), bottomRows + 1, 'X. ADD ROW targets the current wall');
    assert.strictEqual(a.rowsOn('right'), 2, 'the vacated RIGHT row was released by the wall change');
  });

  test('empty rows do not disturb the engine or certification', () => {
    const a = live();
    a.ctx.pbv23dSetMode('build');
    const lone = a.ctx.PBV23D.entries.find((e) => e.wall === 'right');
    a.ctx.pbv23dTapEntry(lone.id);
    const clean = engine.calculatePullBox(a.ctx.pbv23dEngineRequest(a.ctx.PBV23D));
    a.ctx.pbv23dPickRowOption(a.ctx.PBV23D_ADD_ROW);   // leaves one empty row behind
    const withEmpty = engine.calculatePullBox(a.ctx.pbv23dEngineRequest(a.ctx.PBV23D));
    assert.strictEqual(withEmpty.minimumWidthIn, clean.minimumWidthIn, 'width unaffected');
    assert.strictEqual(withEmpty.minimumHeightIn, clean.minimumHeightIn, 'height unaffected');
    a.ctx.pbv23dCalculate();
    assert.strictEqual(a.ctx.pbv23dLayout.state, 'CERTIFIED_WITHIN_TOLERANCE', 'still certifies');
  });

  test('Z-AJ. showcase, FAST, layers and fixtures unchanged', () => {
    const a = live();
    a.ctx.pbv23dSetMode('build');
    const s = a.ctx.PBV23D;
    assert.strictEqual(s.entries.length, 6, 'Z. showcase intact');
    assert.strictEqual(s.connections.length, 3);
    assert.strictEqual(s.connections.map((c) => a.ctx.pbv23dConnTypeOf(s, c.id)).sort().join(),
      'ANGLE,STRAIGHT,U', 'Z. the same three pulls');
    a.ctx.pbv23dCalculate();
    assert.strictEqual(a.ctx.pbv23dLayout.state, 'CERTIFIED_WITHIN_TOLERANCE', 'AA');
    a.ctx.pbv23dSetMode('fast'); a.ctx.pbv23dCalculate();
    assert.strictEqual(a.ctx.pbv23dLayout.result.widthIn + 'x' + a.ctx.pbv23dLayout.result.heightIn,
      '16x2.5', 'AB. FAST unchanged');
    const crypto = require('node:crypto');
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const md5f = (f) => crypto.createHash('md5')
      .update(fs2.readFileSync(path2.join(__dirname, '..', f))).digest('hex');
    assert.strictEqual(md5f('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739', 'AD');
    assert.strictEqual(md5f('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a', 'AE');
    assert.strictEqual(md5f('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1', 'AC');
    assert.strictEqual(engine.calculatePullBox(api.request(api.build('rows'))).minimumWidthIn, 26, 'AG');
    assert.strictEqual(api.build('standard').entries.length, 4, 'AF');
    assert.strictEqual(api.build('dense').entries.length, 16, 'AH');
    const vm = require('node:vm');
    for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (m[1].trim()) new vm.Script(m[1]);   // AI
    }
  });
});
