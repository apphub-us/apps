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
    'pbv23dConnColor', 'pbv23dEntryConns', 'pbv23dEntryColor', 'pbv23dHitRadius',
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
    exports.hitRadius = pbv23dHitRadius;`)(out);
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

  test('calculation-free and deletable in one cut', () => {
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const banned of ['EC.pullBox', 'calculatePullBox', 'validatePullBoxRequest',
      'localStorage', 'sessionStorage', 'indexedDB', '<canvas', 'WebGL', 'THREE.',
      'getContext(']) {
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
    assert.deepStrictEqual(Object.keys(e).sort(), ['id', 'size', 'v', 'wall']);
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
    assert.strictEqual((svg.match(/class="p3d-add"/g) || []).length, 4, 'add affordances');
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

  test('fixture dimension values are static and vanish on the first edit', () => {
    const s = api.build('standard');
    assert.strictEqual(s.showDims, true);
    let svg = api.svg(s, {});
    assert.ok(svg.includes('NOT FULLY DETERMINED'), 'safety framing preserved');
    assert.ok(!/>12&#8243;</.test(svg) && !/>12"</.test(svg),
      'a 12 inch width is never presented as final');
    api.add(s, 'left', '2', api.nextId('e'));
    assert.strictEqual(s.showDims, false, 'editing clears the preset values');
    svg = api.svg(s, {});
    assert.ok(!svg.includes('p3d-dim-width'), 'no stale dimensions after an edit');
    // empty and dense fixtures never show them at all
    assert.strictEqual(api.build('empty').showDims, false);
    assert.strictEqual(api.build('dense').showDims, false);
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
    for (const e of dense.entries) hubs[e.id] = api.hub(e.wall, e.v, G.hubDepth);
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
