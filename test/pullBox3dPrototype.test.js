'use strict';
/**
 * PBV2-10A3D — light 3D prototype (DEV-only, disposable).
 *
 * These tests pin the spatial object model and the prototype's isolation from
 * the working PBV2 editor. They deliberately do NOT test interaction: this
 * milestone is a visual evaluation whose real gate is the physical iPhone.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
const P3D = html.slice(html.indexOf('PULL BOX V2 — LIGHT 3D PROTOTYPE'),
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

/** Execute the shipped pure builders. */
function api3d() {
  const geo = html.match(/var PBV23D_GEO = \{[\s\S]*?\n\};/)[0];
  const fixtures = html.match(/var PBV23D_FIXTURES = \{[\s\S]*?\n\};/)[0];
  const src = [fn3d('pbv23dHub'), fn3d('pbv23dInward'), fn3d('pbv23dRoutePath'),
    fn3d('pbv23dRenderSvg'), fn3d('pbv23dResultHtml'), fn3d('pbv23dDevHost'),
    fn3d('pbv23dShouldOpen')].join('\n');
  const out = {};
  // eslint-disable-next-line no-new-func
  new Function('exports', geo + fixtures + src + `
    exports.GEO = PBV23D_GEO; exports.FIXTURES = PBV23D_FIXTURES;
    exports.hub = pbv23dHub; exports.routePath = pbv23dRoutePath;
    exports.svg = pbv23dRenderSvg; exports.resultHtml = pbv23dResultHtml;
    exports.devHost = pbv23dDevHost; exports.shouldOpen = pbv23dShouldOpen;`)(out);
  return out;
}

describe('PBV2-10A3D — isolation from the working PBV2', () => {
  test('the prototype is a separate object; current PBV2 remains intact', () => {
    assert.ok(html.includes('id="pbv2-3d-prototype"'), 'prototype exists');
    // the working editor and every capability it owns are still present
    assert.ok(html.includes('id="pbv2-overlay"'), 'current PBV2 panel intact');
    for (const marker of ['function pbv2ShouldOpen', 'function pbv2Calculate',
      'function pbv2RenderResults', 'function pbv2DrawConnections',
      'function pbv2AxisBlock', 'ecRenderCodeRef', 'EC.pullBox.calculatePullBox']) {
      assert.ok(html.includes(marker), 'working PBV2 lost: ' + marker);
    }
    // legacy pull box still present and hidden, as always
    assert.ok(html.includes('id="sub-pullbox"') && /function pbUpdate/.test(html));
    assert.ok(!/openTool\('pullbox/.test(html), 'no production route');
  });

  test('dev-only gate: ?pbv2=3d on local hosts only, production blocked', () => {
    const api = api3d();
    for (const host of ['empirecode.app', 'www.empirecode.app', 'apphub-us.github.io',
      '172.32.0.1', '11.0.0.1']) {
      assert.strictEqual(api.devHost(host), false, host);
      assert.strictEqual(api.shouldOpen({ hostname: host, search: '?pbv2=3d', hash: '' }),
        false, host + ' must never open the prototype');
    }
    for (const host of ['localhost', '127.0.0.1', '10.0.0.7', '192.168.1.23', '172.16.0.2']) {
      assert.strictEqual(api.shouldOpen({ hostname: host, search: '?pbv2=3d', hash: '' }), true, host);
      assert.strictEqual(api.shouldOpen({ hostname: host, search: '?pbv2=1', hash: '' }), false,
        'the existing editor flow must not open the prototype');
      assert.strictEqual(api.shouldOpen({ hostname: host, search: '', hash: '' }), false);
    }
  });

  test('the prototype gate is self-contained, so the block stays deletable', () => {
    assert.ok(fn3d('pbv23dShouldOpen').includes('pbv23dDevHost'),
      'uses its own host check, not the editor helper');
    assert.ok(!P3D.includes('EC.pullBox'), 'no engine call in the prototype');
    assert.ok(!P3D.includes('calculatePullBox'), 'static fixtures only');
  });

  test('no 3D engine: SVG/CSS only', () => {
    // scan from the first <style> so the block's own header comment (which
    // names what it avoids) isn't mistaken for usage
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const banned of ['<canvas', 'WebGL', 'three.js', 'THREE.', 'getContext(',
      'perspective(', 'rotate3d', 'OrbitControls']) {
      assert.ok(!code.includes(banned), 'forbidden 3D machinery: ' + banned);
    }
    assert.ok(P3D.includes('<svg'), 'SVG-based');
  });
});

describe('PBV2-10A3D — the enclosure as one physical object', () => {
  const api = api3d();

  test('exactly one enclosure: rim, four wall surfaces, one interior back plane', () => {
    const s = api.svg('standard');
    assert.strictEqual((s.match(/<svg/g) || []).length, 1, 'one drawing');
    assert.strictEqual((s.match(/class="p3d-wall"/g) || []).length, 4, 'four wall surfaces');
    for (const wall of ['top', 'left', 'right', 'bottom']) {
      assert.ok(s.includes('data-wall="' + wall + '"'), wall + ' surface');
    }
    assert.strictEqual((s.match(/class="p3d-back"/g) || []).length, 1, 'one back plane');
    // wall surfaces are trapezoids between the front opening and the back plane
    assert.ok(/<polygon class="p3d-wall" data-wall="left" points="52,34 96,60 96,148 52,182"/.test(s),
      'left wall recedes from the front opening to the back plane');
    // the back plane sits inside the front opening = visible depth
    const G = api.GEO;
    assert.ok(G.back.x1 > G.front.x1 && G.back.x2 < G.front.x2
      && G.back.y1 > G.front.y1 && G.back.y2 < G.front.y2, 'back plane is inset');
    assert.ok(G.rim.x1 < G.front.x1 && G.rim.y1 < G.front.y1, 'rim gives wall thickness');
    // wall names are labels on the object, not card headers
    for (const name of ['TOP', 'BOTTOM', 'LEFT', 'RIGHT']) {
      assert.ok(s.includes('>' + name + '</text>'), name + ' label');
    }
  });

  test('raceways penetrate the walls: exterior stub, through-wall run, hub opening', () => {
    const s = api.svg('standard');
    assert.strictEqual((s.match(/class="p3d-hub"/g) || []).length, 4, 'four openings');
    assert.strictEqual((s.match(/class="p3d-through"/g) || []).length, 4, 'through-wall runs');
    // hubs sit ON the wall surface, between the front opening and the back plane
    const G = api.GEO;
    const left = api.hub('left', 0.5, G.hubDepth);
    assert.ok(left.x > G.front.x1 && left.x < G.back.x1,
      'left hub lies on the left wall surface, not floating in the interior');
    const bottom = api.hub('bottom', 0.3, G.hubDepth);
    assert.ok(bottom.y < G.front.y2 && bottom.y > G.back.y2, 'bottom hub on the bottom wall');
    // trade size labels readable outside the box
    for (const size of ['2', '3']) assert.ok(s.includes('>' + size + '&#8243;</text>'));
    // 44px hit targets exist structurally for later interaction
    assert.strictEqual((s.match(/class="p3d-hit"[^>]*width="44" height="44"/g) || []).length, 4);
    assert.ok(s.includes('rx="4.5" ry="6.5"') || s.includes('rx="6.5" ry="4.5"'),
      'openings are foreshortened ellipses, sized independently of the touch target');
  });
});

describe('PBV2-10A3D — pull routes travel inside the volume', () => {
  const api = api3d();
  const G = api.GEO;
  const insideBack = (x, y) => x >= G.back.x1 && x <= G.back.x2
    && y >= G.back.y1 && y <= G.back.y2;

  test('ANGLE enters one wall, turns inside the enclosure, exits the adjacent wall', () => {
    const s = api.svg('standard');
    const d = s.match(/data-type="ANGLE" d="([^"]+)"/)[1];
    assert.ok(d.includes(' Q '), 'rounded interior turn, not a square corner');
    assert.strictEqual((d.match(/ Q /g) || []).length, 1, 'exactly one turn');
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    // the turn point must land inside the interior, over the back plane
    const qi = d.indexOf(' Q ');
    const corner = d.slice(qi + 3).trim().split(/\s+/).slice(0, 2).map(Number);
    assert.ok(insideBack(corner[0], corner[1]),
      'the bend happens inside the box volume, not on a wall surface');
    assert.ok(!/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/.test(d), 'not a diagonal connector');
    assert.ok(nums.length > 6);
  });

  test('U is a hairpin: in, 180-degree return INSIDE, back out the same wall', () => {
    const s = api.svg('standard');
    const d = s.match(/data-type="U" d="([^"]+)"/)[1];
    assert.ok(d.includes(' A '), 'true 180-degree arc return, not a decorative curve');
    const parts = d.split(/\s+/);
    const startY = Number(parts[2]);
    const legEndY = Number(parts[5]);
    assert.ok(legEndY < startY - 40,
      'the legs run deep INTO the enclosure before turning');
    // arc apex must sit inside the back plane region = visibly inside the box
    const radius = Number(d.slice(d.indexOf(' A ') + 3).trim().split(/\s+/)[0]);
    const apexY = legEndY - radius;
    assert.ok(apexY > G.back.y1 && apexY < G.back.y2,
      'the turnaround happens inside the enclosure volume');
    // both ends terminate on the same wall (bottom hubs, equal y)
    const endY = Number(parts[parts.length - 1]);
    assert.strictEqual(endY, startY, 'returns to the same wall');
  });

  test('STRAIGHT passes through the volume, offset entries still straight', () => {
    const s = api.svg('straight');
    const d = s.match(/data-type="STRAIGHT" d="([^"]+)"/)[1];
    assert.ok(d.includes(' C '), 'gentle transition for offset entries');
    assert.ok(!d.includes(' A '), 'no hairpin');
    assert.strictEqual((d.match(/ Q /g) || []).length, 0, 'no angle-style turn');
    const fx = api.FIXTURES.straight;
    assert.notStrictEqual(fx.entries[0].v, fx.entries[1].v,
      'the fixture deliberately offsets the two opposite-wall entries');
    assert.strictEqual(fx.entries[0].wall, 'left');
    assert.strictEqual(fx.entries[1].wall, 'right');
  });

  test('all route families share one neutral conductor style', () => {
    const s = api.svg('dense');
    const group = s.slice(s.indexOf('class="p3d-routes"'), s.indexOf('class="p3d-dims"'));
    assert.ok(group.includes('stroke="#9a9a9a"'), 'one neutral stroke for every pull type');
    assert.ok(!/stroke="#(?!9a9a9a)[0-9a-f]{6}"/i.test(group), 'no per-type color coding');
  });
});

describe('PBV2-10A3D — dimensions stay screen-space annotations', () => {
  const api = api3d();

  test('WIDTH is horizontal below the box, HEIGHT vertical beside it, text upright', () => {
    // the straight fixture carries a resolved WIDTH; the standard one a
    // resolved HEIGHT — between them every dimension form is exercised
    const s = api.svg('straight');
    const dims = s.slice(s.indexOf('class="p3d-dims"'));
    const w = dims.match(/class="p3d-dim-width" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"/);
    assert.ok(w, 'width dimension line present');
    assert.strictEqual(w[2], w[4], 'width line is perfectly horizontal (not projected)');
    assert.ok(Number(w[2]) > api.GEO.rim.y2, 'drawn below the enclosure');
    const sh = api.svg('standard');
    const h = sh.slice(sh.indexOf('class="p3d-dims"'))
      .match(/class="p3d-dim-height" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"/);
    assert.ok(h, 'height dimension line present');
    assert.strictEqual(h[1], h[3], 'height line is perfectly vertical');
    assert.ok(Number(h[1]) > api.GEO.rim.x2, 'drawn beside the enclosure');
    // no rotated or skewed annotation text anywhere
    assert.ok(!/transform="rotate|matrix\(/.test(dims + sh), 'dimension text is never rotated');
  });

  test('LAYOUT-DEPENDENT width never renders a final number', () => {
    const s = api.svg('standard');
    assert.ok(s.includes('p3d-dim-ref'), 'reference-dimension treatment');
    assert.ok(/class="p3d-dim-width p3d-dim-ref"[^>]*stroke-dasharray/.test(s),
      'dashed line marks a not-final dimension');
    assert.ok(s.includes('NOT FULLY DETERMINED'));
    // the pull-rule 12" must NOT appear as the width value on the drawing
    assert.ok(!/>12&#8243;</.test(s) && !/>12"</.test(s),
      'the unsafe 12 inch reading is impossible on the diagram');
    // open arrowheads (stroked, not filled) for the reference dimension
    const refBlock = s.slice(s.indexOf('p3d-dim-ref'), s.indexOf('NOT FULLY DETERMINED'));
    assert.ok(refBlock.includes('fill="none"'), 'open arrowheads');
    // height still reads normally
    assert.ok(s.includes('>21&#8243;</text>') || s.includes('>21"</text>'), 'height 21 shown');
    // and the preview below repeats the honest framing
    const preview = api.resultHtml('standard');
    assert.ok(preview.includes('PULL-RULE MINIMUM DIMENSIONS'));
    assert.ok(preview.includes('NOT FULLY DETERMINED'));
    assert.ok(!/>12"|>12&#8243;/.test(preview));
    assert.ok(/pull rule .*12"/.test(api.FIXTURES.standard.chips)
      && /18"/.test(api.FIXTURES.standard.chips)
      && /fittings/.test(api.FIXTURES.standard.chips), 'constraint chips present');
  });

  test('entry spacing is a measurement layer, distinct from the route layer', () => {
    const s = api.svg('standard');
    const measure = s.slice(s.indexOf('class="p3d-measure"'), s.indexOf('p3d-dim-width'));
    assert.ok(measure.includes('18" MIN'), 'labeled minimum');
    assert.ok(measure.includes('stroke-dasharray'), 'extension lines are dashed');
    assert.ok(measure.includes('stroke-width="1"'), 'thin measurement line');
    // it lives outside the enclosure, below the bottom wall — never over the route
    const dimY = api.GEO.dimSpacingY;
    assert.ok(dimY > api.GEO.rim.y2, 'measurement sits outside the box');
    // routes are heavier and solid; measurement is thinner and dashed
    const routes = s.slice(s.indexOf('class="p3d-routes"'), s.indexOf('class="p3d-dims"'));
    assert.ok(routes.includes('stroke-width="2.5"'));
    assert.ok(!routes.includes('stroke-dasharray'), 'routes are never dashed');
    assert.ok(s.includes('NOT TO SCALE'), 'scale honesty preserved');
  });
});

describe('PBV2-10A3D — density and fixtures', () => {
  const api = api3d();

  test('three fixtures exist and the dense one hides nothing', () => {
    assert.deepStrictEqual(Object.keys(api.FIXTURES).sort(), ['dense', 'standard', 'straight']);
    const dense = api.FIXTURES.dense;
    const byWall = (w) => dense.entries.filter((e) => e.wall === w).length;
    assert.strictEqual(byWall('left'), 6);
    assert.strictEqual(byWall('right'), 3);
    assert.strictEqual(byWall('top'), 3);
    assert.strictEqual(byWall('bottom'), 4);
    const s = api.svg('dense');
    assert.strictEqual((s.match(/class="p3d-hub"/g) || []).length, 16,
      'every raceway is drawn — nothing silently hidden');
    assert.strictEqual((s.match(/class="p3d-hit"/g) || []).length, 16);
    assert.strictEqual((s.match(/class="p3d-route"/g) || []).length, 3);
  });

  test('depth varies per entry, hinting rows without a row UI', () => {
    const dense = api.FIXTURES.dense;
    const leftDepths = new Set(dense.entries.filter((e) => e.wall === 'left').map((e) => e.t));
    assert.ok(leftDepths.size > 1, 'left-wall entries sit at different depths');
    const G = api.GEO;
    for (const e of dense.entries.filter((x) => x.wall === 'left')) {
      const h = api.hub('left', e.v, e.t);
      assert.ok(h.x >= G.front.x1 && h.x <= G.back.x1, 'every hub stays on its wall');
    }
  });

  test('no editor chrome was reproduced in the prototype', () => {
    for (const banned of ['+ Row', 'Quick Straight', 'CALCULATE', 'CONNECT',
      'Reset the box', 'pbv2-connlist']) {
      assert.ok(!P3D.includes(banned), 'editor chrome leaked: ' + banned);
    }
    assert.ok(P3D.includes('STANDARD') && P3D.includes('STRAIGHT') && P3D.includes('DENSE'),
      'only the fixture switch');
  });
});
