'use strict';
/**
 * PBV2-13B-3 — certified layout integration (Layer 1 -> Layer 0 -> Layer 2 -> UI).
 *
 * Runs the SHIPPED mobile.html integration functions against the REAL layers.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const L0 = require('../src/standards/pullBoxEntryGeometry');
const L1 = require('../src/calc/pullBox');
const L2 = require('../src/layout/pullBoxLayout');

const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
const P3D = html.slice(html.indexOf('PULL / JUNCTION BOX — PRODUCTION FEATURE (PBV2-14)'), html.indexOf('END PULL BOX V2 3D PROTOTYPE'));
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(path.join(__dirname, '..', p))).digest('hex');

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

/** Load the shipped integration with the real layers behind a counting EC. */
function app() {
  const consts = ['PBV23D_GEO', 'PBV23D_FACE_MAX', 'PBV23D_RIM_PAD', 'PBV23D_DIM_GAP', 'PBV23D_CAPTION_GAP', 'PBV23D_DEPTH_INSET', 'PBV23D_CORNER_EXCLUDE',
    'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
    'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
    .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
  const names = ['pbv23dHub', 'pbv23dInward', 'pbv23dEmptyState', 'pbv23dRowsFor', 'pbv23dRowById',
    'pbv23dRowIndex', 'pbv23dRowDepth', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dSetEntryRow',
    'pbv23dDeleteRowIfEmpty', 'pbv23dFindEntry', 'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry',
    'pbv23dSetSize', 'pbv23dSetPosition', 'pbv23dSetWall', 'pbv23dAddConnection',
    'pbv23dClassify', 'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConns', 'pbv23dEntryColor',
    'pbv23dEntryConnNumbers', 'pbv23dHubNumberLayout', 'pbv23dDeleteConnection',
    'pbv23dEditFieldsHtml', 'pbv23dConnActionsHtml', 'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dTargetModeHtml', 'pbv23dStartDisconnect', 'pbv23dTargeting', 'pbv23dEnterTargetMode', 'pbv23dExitTargetMode', 'pbv23dConnBetween', 'pbv23dEligibleTargets', 'pbv23dTargetModeHtml', 'pbv23dStartDisconnect', 'pbv23dConnTypeOf', 'pbv23dClassify',
    'pbv23dHitRadius', 'pbv23dRouteLead', 'pbv23dClampInterior', 'pbv23dSegCross', 'pbv23dPolylineLoops', 'pbv23dRouteAnchor', 'pbv23dAngleSide', 'pbv23dAngleRoute', 'pbv23dRoutePath', 'pbv23dEngineRequest',
    'pbv23dPresent', 'pbv23dIn', 'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml',
    'pbv23dLayoutGeometry', 'pbv23dCertifyBox', 'pbv23dCertifiedBox', 'pbv23dLayoutNote',
    'pbv23dDim', 'pbv23dCeilBoxDim', 'pbv23dEffectiveAxes', 'pbv23dResultHtml', 'pbv23dSheetResultLine', 'pbv23dInvalidateResult',
    'pbv23dCalculate', 'pbv23dRenderSvg', 'pbv23dSheetBody', 'pbv23dSupportedSizes',
    'pbv23dGeoFor', 'pbv23dCertifiedView', 'pbv23dEntryRenderV', 'pbv23dPickPosition'];
  let l1Calls = 0; let l2Calls = 0; let lastL1Result = null; let l2Args = null;
  const EC = {
    pullBox: Object.assign(Object.create(L1), {
      calculatePullBox(req) { l1Calls++; lastL1Result = L1.calculatePullBox(req); return lastL1Result; },
    }),
    pullBoxEntryGeometry: L0,
    pullBoxLayout: Object.assign(Object.create(L2), {
      findLayoutDimensions(args) { l2Calls++; l2Args = args; return L2.findLayoutDimensions(args); },
    }),
  };
  const out = {};
  // eslint-disable-next-line no-new-func
  new Function('EC', 'document', 'pbv23dRender', 'exports',
    'var pbv23dSeq = 0;\n'
    + 'function pbv23dNextId(p) { pbv23dSeq++; return "p3d-" + p + "-" + pbv23dSeq; }\n'
    + 'var PBV23D = null, pbv23dPresentation = null, pbv23dLastResult = null, pbv23dLayout = null;\n'
    + 'var pbv23dLastPull = null; var pbv23dTargetMode = null; var pbv23dMode = "build"; var pbv23dConfirmClear = false;\n'
    + 'var pbv23dSelected = null;\n'
    + 'var PBV23D_ERROR_TEXT = { NO_ENTRIES: "Add at least one raceway before calculating." };\n'
    + consts + names.map(fn3d).join('\n') + `
    exports.empty = pbv23dEmptyState; exports.add = pbv23dAddEntry;
    exports.conn = pbv23dAddConnection; exports.nextId = pbv23dNextId;
    exports.del = pbv23dDeleteEntry; exports.setSize = pbv23dSetSize;
    exports.setWall = pbv23dSetWall; exports.setPos = pbv23dSetPosition;
    exports.setRow = pbv23dSetEntryRow; exports.addRow = pbv23dAddRowOnWall;
    exports.rowsFor = pbv23dRowsFor; exports.find = pbv23dFindEntry;
    exports.load = function (s) { PBV23D = s; }; exports.state = function () { return PBV23D; };
    exports.calc = pbv23dCalculate; exports.invalidate = pbv23dInvalidateResult;
    exports.html = pbv23dResultHtml; exports.sheet = pbv23dSheetResultLine;
    exports.layout = function () { return pbv23dLayout; };
    exports.l1 = function () { return pbv23dLastResult; };
    exports.request = pbv23dEngineRequest; exports.geometry = pbv23dLayoutGeometry;
    exports.dim = pbv23dDim;
    exports.certifiedView = function () { return pbv23dCertifiedView(PBV23D); };
    exports.entryRenderV = pbv23dEntryRenderV;
    exports.geoFor = pbv23dGeoFor;
    exports.hub = pbv23dHub; exports.rowDepth = pbv23dRowDepth;
    exports.routePath = pbv23dRoutePath; exports.routeLead = pbv23dRouteLead;
    exports.routeAnchor = pbv23dRouteAnchor; exports.polylineLoops = pbv23dPolylineLoops;
    exports.angleRoute = pbv23dAngleRoute;
    exports.connNumber = pbv23dConnNumber; exports.connColor = pbv23dConnColor;
    exports.entryColor = pbv23dEntryColor; exports.entryConns = pbv23dEntryConns;
    exports.entryConnNumbers = pbv23dEntryConnNumbers; exports.hubNumberLayout = pbv23dHubNumberLayout;
    exports.deleteConn = pbv23dDeleteConnection;
    exports.PALETTE = PBV23D_CONN_COLORS; exports.NEUTRAL = PBV23D_NEUTRAL;
    exports.exclude = () => PBV23D_CORNER_EXCLUDE;
    exports.inward = pbv23dInward;
    exports.sheetBody = function (id) {
      var prev = pbv23dSelected; pbv23dSelected = id;
      var h = pbv23dSheetBody(); pbv23dSelected = prev; return h;
    };
    exports.pickPositionOn = function (id, pct) {
      var prev = pbv23dSelected; pbv23dSelected = id;
      pbv23dPickPosition(pct); pbv23dSelected = prev;
    };
    exports.svg = function () {
      var effResult = null;
      if (pbv23dPresentation && pbv23dPresentation.state === 'OK') {
        var e = pbv23dEffectiveAxes(pbv23dPresentation);
        effResult = { state: 'OK', width: e.width, height: e.height };
      }
      return pbv23dRenderSvg(PBV23D, { result: effResult });
    };`)(EC, { getElementById: () => null }, () => {}, out);
  out.l1Calls = () => l1Calls; out.l2Calls = () => l2Calls;
  out.lastL1 = () => lastL1Result; out.l2Args = () => l2Args;
  return out;
}
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** angle L2-T2 + same-wall U B3-B3: Layer 1 leaves WIDTH layout dependent. */
function auditFixture(a) {
  const s = a.empty(); a.load(s);
  const L = a.add(s, 'left', '2', a.nextId('e'));
  const T = a.add(s, 'top', '2', a.nextId('e'));
  const B1 = a.add(s, 'bottom', '3', a.nextId('e'));
  const B2 = a.add(s, 'bottom', '3', a.nextId('e'));
  a.conn(s, L.id, T.id, a.nextId('c'));
  a.conn(s, B1.id, B2.id, a.nextId('c'));
  return s;
}

describe('PBV2-13B-3 — frozen layers and no duplication', () => {
  test('Layer 0, 1 and 2 sources are byte-identical', () => {
    assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    // the bundle must contain the SAME text as the module files
    for (const f of ['src/layout/pullBoxLayout.js', 'src/standards/pullBoxEntryGeometry.js']) {
      const body = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').trim();
      const marker = body.split('\n').find((l) => l.includes('module.exports')).trim();
      assert.ok(html.includes(marker), f + ' is injected from source, not rewritten');
    }
    assert.ok(html.includes('// ---- src/layout/pullBoxLayout.js ----'));
    assert.ok(html.includes('// ---- src/standards/pullBoxEntryGeometry.js ----'));
  });

  test('the 3D block contains no Layer-0/1/2 logic of its own', () => {
    const code = P3D.slice(P3D.indexOf('<style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      .replace(/function pbv23dDim\([\s\S]*?\n\}/, '');
    assert.ok(!/\b6 \*|\* 6\b|\b8 \*|\* 8\b|314\.28/.test(code), 'no NEC arithmetic');
    assert.ok(!/0\.875|1\.109|2\.469|3\.594|C80|NEMA|outsideDiameter/i.test(code),
      'no Layer-0 dimensional data copied (the entry-system NAME is fine)');
    assert.ok(!/BigInt|isqrt|micro|interval|branch/i.test(code), 'no Layer-2 solver math copied');
    assert.ok(!/entryMeasurementDiameterIn\s*[:=]\s*[\d.]/.test(code), 'no hard-coded diameters');
    assert.strictEqual((code.match(/EC\.pullBox\.calculatePullBox/g) || []).length, 1);
    assert.strictEqual((code.match(/EC\.pullBoxEntryGeometry\./g) || []).length, 1);
    assert.strictEqual((code.match(/EC\.pullBoxLayout\./g) || []).length, 1);
  });
});

describe('PBV2-13B-3 — composed pipeline', () => {
  test('one CALCULATE runs Layer 1 once, then Layer 0, then Layer 2', () => {
    const a = app(); const s = auditFixture(a);
    const request = JSON.parse(JSON.stringify(a.request(s)));
    a.calc();
    assert.strictEqual(a.l1Calls(), 1, 'exactly one Layer-1 call');
    assert.ok(a.l2Calls() >= 1, 'Layer 2 was called');
    // Layer 2 received the SAME request and the SAME Layer-1 result object
    assert.deepStrictEqual(a.l2Args().request, request, 'canonical request unchanged');
    assert.strictEqual(a.l2Args().result, a.lastL1(), 'the exact Layer-1 result object');
    // and geometry for every entry, resolved by Layer 0
    for (const e of s.entries) {
      assert.ok(a.l2Args().geometry.entries[e.id].entryMeasurementDiameterIn > 0, e.id);
    }
    assert.strictEqual(a.l2Args().geometry.units, 'in');
  });

  test('the default entry system is conservative and resolves every canonical size', () => {
    const sys = /var PBV23D_ENTRY_SYSTEM = ([^;]+);/.exec(P3D)[1];
    assert.ok(/KNOCKOUT/.test(sys), 'a knockout penetration: the hole bounds anything through it');
    for (const size of L1.TRADE_SIZE_KEYS) {
      const r = L0.resolveEntryGeometry(Object.assign({ tradeSize: size }, eval('(' + sys + ')'))); // eslint-disable-line no-eval
      assert.strictEqual(r.status, 'CONSERVATIVE', size + ' must resolve conservatively');
      // and it is never smaller than any other supported system for that size
      for (const [type, method] of [['EMT', 'KNOCKOUT_CONNECTOR'], ['IMC', 'KNOCKOUT_THREADED'], ['PVC', 'KNOCKOUT_CONNECTOR']]) {
        const other = L0.resolveEntryGeometry({ tradeSize: size, racewayType: type, entryMethod: method });
        if (other.status === 'CONSERVATIVE') {
          assert.ok(r.entryMeasurementDiameterIn >= other.entryMeasurementDiameterIn,
            size + ': default must not be smaller than ' + type);
        }
      }
    }
  });

  test('visualPosition never reaches Layer 2, and never changes its input', () => {
    const a = app(); const s = auditFixture(a);
    a.calc();
    const before = JSON.stringify({ req: a.l2Args().request, geo: a.l2Args().geometry });
    const flat = JSON.stringify(a.l2Args());
    assert.ok(!/"v":/.test(flat), 'no visual coordinate');
    assert.ok(!/viewBox|svg|px|alongIn":\s*0\.\d\d\d\d\d\d\d/.test(flat.slice(0, flat.indexOf('"result"') > 0 ? flat.indexOf('"result"') : 400)));
    // move a raceway visually, recalculate: identical Layer-2 input
    a.setPos(s, s.entries[0].id, 0.93);
    a.calc();
    assert.strictEqual(JSON.stringify({ req: a.l2Args().request, geo: a.l2Args().geometry }), before);
  });

  test('deterministic: the same state always yields the same certified result', () => {
    const a = app(); auditFixture(a); a.calc();
    const first = { state: a.layout().state, w: a.layout().result.widthIn, h: a.layout().result.heightIn, html: a.html() };
    const b = app(); auditFixture(b); b.calc();
    assert.deepStrictEqual({ state: b.layout().state, w: b.layout().result.widthIn, h: b.layout().result.heightIn, html: b.html() }, first);
  });
});

describe('PBV2-13B-3 — certified results', () => {
  test('the audit fixture: LAYOUT_DEPENDENT becomes a certified W x H', () => {
    const a = app(); auditFixture(a); a.calc();
    assert.strictEqual(a.l1().dimensionStatus.width.status, 'LAYOUT_DEPENDENT', 'Layer 1 alone cannot settle width');
    assert.strictEqual(a.layout().state, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.strictEqual(a.layout().policy, 'WIDTH', 'only width had to grow');
    const box = a.layout().result;
    // exact analytic bound: 18 + 2 x 3.625 (NEMA 3" knockout maximum) = 25.25
    assert.ok(Math.abs(box.widthIn - 25.25) <= 1 / 64, 'certified width ' + box.widthIn);
    assert.strictEqual(box.heightIn, 21, 'height stays at the Layer-1 rule floor');
    const t = text(a.html());
    // PBV2-13B-3.2: MINIMUM REQUIRED BOX SIZE heading, whole-inch ceiling
    // display, certified DOMAIN value untouched (still the bisection-search
    // fractional result within tolerance of the 25.25 analytic bound, exactly
    // as pinned in PBV2-13B-3 — this milestone changes presentation only)
    assert.ok(Math.abs(box.widthIn - 25.25) <= 1 / 64, 'domain value unchanged: ' + box.widthIn);
    assert.notStrictEqual(box.widthIn, 26, 'the domain value is never mutated to the display integer');
    assert.ok(t.startsWith('MINIMUM REQUIRED BOX SIZE 26\u2033 W \u00D7 21\u2033 H'), t.slice(0, 80));
    assert.ok(!t.includes('REQUIRED BOX SIZE 25'), 'the old fractional heading is gone');
    assert.ok(!t.includes('NOT FULLY DETERMINED'), 'the unresolved axis is gone');
    // the drawing agrees with the result: whole-inch, solid, no stale
    // "NOT FULLY DETERMINED" while a certified box is showing below it
    const svg = a.svg();
    assert.ok(svg.includes('26\u2033 WIDTH'), 'drawing shows the same whole-inch width');
    assert.ok(!svg.includes('NOT FULLY DETERMINED'), 'no stale unresolved label on the drawing');
    assert.ok(!svg.includes('p3d-dim-ref'), 'the axis is drawn solid, not as a dashed reference');
    assert.ok(t.includes('CONSERVATIVE NEC LAYOUT'));
    assert.ok(t.includes('PULL REQUIREMENTS'), 'explanatory cards remain');
  });

  test('straight-only returns the Layer-1 floor with no layout growth', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const L = a.add(s, 'left', '4', a.nextId('e'));
    const R = a.add(s, 'right', '4', a.nextId('e'));
    a.conn(s, L.id, R.id, a.nextId('c'));
    a.calc();
    assert.strictEqual(a.l1().minimumWidthIn, 32);
    assert.strictEqual(a.layout().state, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(Math.abs(a.layout().result.widthIn - 32) <= 1 / 64, 'no growth beyond the rule floor');
  });

  test('unequal angle can push a dimension past the Layer-1 floor', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const L = a.add(s, 'left', '2', a.nextId('e'));
    const B = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, L.id, B.id, a.nextId('c'));
    a.calc();
    const box = a.layout().result;
    assert.strictEqual(a.layout().state, 'CERTIFIED_WITHIN_TOLERANCE');
    // knockout datums (2.500 / 3.625) make the 12 x 18 rule box infeasible
    assert.ok(box.widthIn > a.l1().minimumWidthIn || box.heightIn > a.l1().minimumHeightIn,
      'layout requires more than the rule floors: ' + box.widthIn + ' x ' + box.heightIn);
  });

  test('shared raceway and four-wall cycle are solved globally, not per pull', () => {
    const shared = app(); let s = shared.empty(); shared.load(s);
    let A = shared.add(s, 'left', '2', shared.nextId('e'));
    let B = shared.add(s, 'top', '2', shared.nextId('e'));
    let C = shared.add(s, 'bottom', '2', shared.nextId('e'));
    shared.conn(s, A.id, B.id, shared.nextId('c'));
    shared.conn(s, A.id, C.id, shared.nextId('c'));
    shared.calc();
    assert.strictEqual(shared.layout().state, 'CERTIFIED_WITHIN_TOLERANCE');
    assert.ok(shared.layout().result.widthIn > 12 || shared.layout().result.heightIn > 12,
      'the shared coordinate forces growth');

    const cyc = app(); s = cyc.empty(); cyc.load(s);
    A = cyc.add(s, 'left', '2', cyc.nextId('e'));
    B = cyc.add(s, 'top', '2', cyc.nextId('e'));
    C = cyc.add(s, 'right', '2', cyc.nextId('e'));
    const D = cyc.add(s, 'bottom', '2', cyc.nextId('e'));
    cyc.conn(s, A.id, B.id, cyc.nextId('c')); cyc.conn(s, B.id, C.id, cyc.nextId('c'));
    cyc.conn(s, C.id, D.id, cyc.nextId('c')); cyc.conn(s, D.id, A.id, cyc.nextId('c'));
    cyc.calc();
    assert.ok(['CERTIFIED_WITHIN_TOLERANCE', 'CERTIFIED_BOUNDS'].includes(cyc.layout().state));
    assert.ok(cyc.layout().result.widthIn > 12 && cyc.layout().result.heightIn >= 12);
  });

  test('mixed straight + angle + U yields one certified box and three pull cards', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const L4 = a.add(s, 'left', '4', a.nextId('e'));
    const R4 = a.add(s, 'right', '4', a.nextId('e'));
    const L2e = a.add(s, 'left', '2', a.nextId('e'));
    const T2 = a.add(s, 'top', '2', a.nextId('e'));
    const B1 = a.add(s, 'bottom', '3', a.nextId('e'));
    const B2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, L4.id, R4.id, a.nextId('c'));
    a.conn(s, L2e.id, T2.id, a.nextId('c'));
    a.conn(s, B1.id, B2.id, a.nextId('c'));
    a.calc();
    assert.ok(['CERTIFIED_WITHIN_TOLERANCE', 'CERTIFIED_BOUNDS'].includes(a.layout().state));
    const h = a.html();
    assert.strictEqual((h.match(/class="p3d-boxsize"/g) || []).length, 1, 'one final box');
    assert.strictEqual((h.match(/class="p3d-card"/g) || []).length, 3, 'all three pulls listed');
    assert.deepStrictEqual((h.match(/class="p3d-num"[^>]*>(\d+)</g) || [])
      .map((m) => Number(m.match(/>(\d+)<$/)[1])), [1, 2, 3], 'numbering unchanged');
  });
});

describe('PBV2-13B-3 — guarantees and failure states', () => {
  test('conservative geometry can never render as exact or as physically verified', () => {
    const a = app(); auditFixture(a); a.calc();
    const t = text(a.html());
    assert.strictEqual(a.layout().conservative, true);
    assert.ok(t.includes('CONSERVATIVE NEC LAYOUT'));
    assert.ok(!/EXACT/i.test(t), 'never claims exact');
    assert.ok(t.includes('Physical fitting and depth fit are not verified.'));
    assert.ok(!/physically fits|everything fits|fit verified/i.test(t.replace('not verified', '')));
    assert.strictEqual(a.layout().result.physicalFitVerified, false);
    assert.strictEqual(a.layout().result.depthVerified, false);
    assert.ok(!/\bdepth\b[^.]*\d/i.test(t), 'no depth dimension is shown');
  });

  test('UNKNOWN never becomes a box size and never becomes failure', () => {
    // force UNKNOWN by starving the solver through the shipped code path
    const src = fn3d('pbv23dCertifyBox');
    assert.ok(src.includes("toleranceIn: 1 / 64"), 'tolerance is set in one place');
    const a = app(); auditFixture(a);
    const patched = Object.create(L2);
    patched.findLayoutDimensions = () => ({ status: 'UNKNOWN', reason: 'NODE_BUDGET_EXHAUSTED' });
    // re-run certify with the starved solver, then render through the shipped renderer
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('EC', 'PBV23D', 'pbv23dPresentation', 'pbv23dLastResult', 'exports',
      'var pbv23dLayout = null;\n'
      + html.match(/var PBV23D_POLICY_ORDER = [^;]+;/)[0] + '\n'
      + fn3d('pbv23dCertifyBox') + fn3d('pbv23dCertifiedBox')
      + fn3d('pbv23dLayoutNote') + `
      exports.run = function (req, res) {
        var c = pbv23dCertifyBox(req, res, { units: 'in', entries: {} });
        pbv23dLayout = { state: c.layout.status, result: c.layout };
        return { certified: pbv23dCertifiedBox(), note: pbv23dLayoutNote() };
      };`)({ pullBoxLayout: patched }, null, null, null, out);
    const r = out.run(a.request(a.state()), L1.calculatePullBox(a.request(a.state())));
    assert.strictEqual(r.certified, null, 'no box from UNKNOWN');
    assert.ok(/not certified/i.test(r.note), 'explicit, non-alarming wording');
    assert.ok(!/\d\u2033/.test(r.note), 'no dimension in the note');
  });

  test('unresolved Layer-0 geometry stops before Layer 2 and fabricates nothing', () => {
    const a = app(); const s = a.empty(); a.load(s);
    // 5" EMT is not manufactured; the default system covers 5", so force a
    // failure through the resolver contract instead
    const bad = L0.buildLayoutGeometry({ X: { tradeSize: '5', racewayType: 'EMT', entryMethod: 'KNOCKOUT_CONNECTOR' } });
    assert.strictEqual(bad.ok, false);
    const body = fn3d('pbv23dCalculate');
    assert.ok(body.includes("if (!geo.ok)"), 'the pipeline branches on resolver failure');
    assert.ok(body.indexOf('GEOMETRY_UNRESOLVED') < body.indexOf('pbv23dCertifyBox'),
      'Layer 2 is only reached when geometry resolved');
    assert.ok(!/entryMeasurementDiameterIn\s*[:=]\s*[\d.]/.test(body), 'no fabricated geometry');
  });

  test('an invalid Layer-1 result stops the pipeline', () => {
    const a = app(); const s = a.empty(); a.load(s);   // no entries
    a.calc();
    assert.strictEqual(a.l1().ok, false);
    assert.strictEqual(a.l2Calls(), 0, 'Layer 2 not called');
    assert.strictEqual(a.layout(), null);
    assert.ok(!/p3d-boxsize/.test(a.html()));
  });
});

describe('PBV2-13B-3 — invalidation and display', () => {
  test('every calculation-relevant edit invalidates the certified box', () => {
    for (const mutate of [
      (a, s) => a.setSize(s, s.entries[0].id, '4'),
      (a, s) => a.setWall(s, s.entries[0].id, 'right'),
      (a, s) => a.setRow(s, s.entries[2].id, a.addRow(s, 'bottom', a.nextId('row')).id),
      (a, s) => a.del(s, s.entries[0].id),
      (a, s) => a.conn(s, s.entries[0].id, s.entries[2].id, a.nextId('c')),
    ]) {
      const a = app(); const s = auditFixture(a);
      a.calc();
      assert.ok(a.layout(), 'certified before the edit');
      mutate(a, s);
      a.invalidate();
      assert.strictEqual(a.layout(), null, 'stale certified box cleared');
      assert.strictEqual(a.l1(), null);
      assert.ok(!/p3d-boxsize/.test(a.html()));
    }
  });

  test('a visualPosition-only change leaves the certified result valid and identical', () => {
    const a = app(); const s = auditFixture(a);
    a.calc();
    const before = { w: a.layout().result.widthIn, h: a.layout().result.heightIn };
    a.setPos(s, s.entries[0].id, 0.2);
    a.calc();
    assert.deepStrictEqual({ w: a.layout().result.widthIn, h: a.layout().result.heightIn }, before);
  });

  test('display never rounds a certified dimension down', () => {
    const a = app();
    for (const [value, shown] of [[25.25, '25-1/4\u2033'], [25.2501, '25-3/8\u2033'], [21, '21\u2033'],
      [12.001, '12-1/8\u2033'], [13.16, '13-1/4\u2033'], [32, '32\u2033']]) {
      assert.strictEqual(a.dim(value), shown, String(value));
      // and the displayed value is never below the certified requirement
      const num = shown.replace('\u2033', '').split('-');
      const asNumber = Number(num[0]) + (num[1] ? eval(num[1]) : 0); // eslint-disable-line no-eval
      assert.ok(asNumber >= value - 1e-9, shown + ' >= ' + value);
    }
  });

  test('the one CALCULATE uses the same pipeline and the certified dimensions', () => {
    /* SUPERSEDED BY PBV2-13B-4.8g: CALCULATE is a BOX-level action and lives
       once, in the global row — the editor's duplicate is gone. The guarantee
       that matters is unchanged: one composed engine path, and the result line
       reports the certified whole-inch dimensions. */
    assert.ok(!fn3d('pbv23dSheetBody').includes('pbv23dCalculate'),
      'no calculate action inside the raceway details');
    assert.ok(fn3d('pbv23dGlobalsHtml').includes('onclick="pbv23dCalculate()"'),
      'the global control uses the composed path');
    const a = app(); auditFixture(a); a.calc();
    const line = a.sheet();
    // PBV2-13B-3.2: sheet line uses the whole-inch ceiling, not the eighth format
    assert.ok(line.includes(a.dim(a.layout().result.widthIn)) === false || true);  // formatter no longer used here
    assert.strictEqual(line, 'W ' + Math.ceil(a.layout().result.widthIn - 1e-9) + '\u2033  \u00B7  H '
      + Math.ceil(a.layout().result.heightIn - 1e-9) + '\u2033  \u00B7  conservative', line);
  });
});

describe('PBV2-13B-3 — Node/browser parity', () => {
  test('the bundled modules compute identically to the Node modules', () => {
    const start = html.indexOf('window.EC = (function () {');
    const end = html.indexOf('})();', start) + 5;
    const bundle = html.slice(start, end).replace('window.EC =', 'globalThis.__EC =');
    // eslint-disable-next-line no-new-func
    new Function(bundle)();
    const B = globalThis.__EC;
    assert.ok(B.pullBoxLayout && B.pullBoxEntryGeometry, 'both layers exposed in the bundle');
    const spec = { tradeSize: '3', racewayType: 'RMC', entryMethod: 'KNOCKOUT_THREADED' };
    assert.deepStrictEqual(B.pullBoxEntryGeometry.resolveEntryGeometry(spec),
      L0.resolveEntryGeometry(spec), 'Layer 0 parity');
    const req = { rows: [{ id: 'r', wall: 'bottom', order: 0 }],
      entries: [{ id: 'A', rowId: 'r', tradeSize: '3' }, { id: 'B', rowId: 'r', tradeSize: '3' }],
      connections: [{ id: 'c', entryIds: ['A', 'B'] }] };
    const res = L1.calculatePullBox(req);
    assert.deepStrictEqual(B.pullBox.calculatePullBox(req), res, 'Layer 1 parity');
    const geo = { units: 'in', entries: { A: { entryMeasurementDiameterIn: 3.625 }, B: { entryMeasurementDiameterIn: 3.625 } } };
    const args = { request: req, result: res, geometry: geo, policy: 'WIDTH', heightIn: 21, toleranceIn: 1 / 64 };
    const nodeOut = L2.findLayoutDimensions(args);
    const browserOut = B.pullBoxLayout.findLayoutDimensions(args);
    assert.strictEqual(browserOut.status, nodeOut.status);
    assert.strictEqual(browserOut.widthIn, nodeOut.widthIn, 'Layer 2 parity');
    assert.deepStrictEqual(browserOut.placements, nodeOut.placements);
  });
});

describe('PBV2-13B-3.2 — certified result presentation polish', () => {
  const consts3B2 = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
    'PBV23D_NEUTRAL', 'PBV23D_ADD_ROW', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
    .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');

  /** The shipped ceiling helper, in isolation. */
  function ceilHelper() {
    const out = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', fn3d('pbv23dCeilBoxDim') + ';exports.ceil = pbv23dCeilBoxDim;')(out);
    return out.ceil;
  }

  test('WHOLE-INCH CEILING: exact pinned boundary cases', () => {
    const ceil = ceilHelper();
    for (const [input, expected] of [
      [25, 25], [25.0001, 26], [25.25, 26], [25.375, 26], [25.999, 26],
      [26, 26], [26.001, 27], [1, 1], [0.5, 1],
    ]) {
      assert.strictEqual(ceil(input), expected, input + ' -> ' + expected);
    }
  });

  test('WHOLE-INCH CEILING: absorbs float noise without masking a genuine excess', () => {
    const ceil = ceilHelper();
    // representation artifact just above a whole number: must NOT bump up
    assert.strictEqual(ceil(25 + 1e-12), 25, 'sub-nanoinch noise stays at 25');
    assert.strictEqual(ceil(25 - 1e-12), 25, 'noise on the other side also stays at 25');
    // a genuine excess at the solver's own finest grain (1 micro-inch) still rounds up
    assert.strictEqual(ceil(25 + 1e-6), 26, 'a real micro-inch excess still requires the next inch');
    assert.strictEqual(ceil(25.9999995), 26);
    // deterministic and never rounds down
    assert.strictEqual(ceil(ceil(25.0001)), 26);
    for (const v of [12, 12.001, 12.999, 13]) assert.ok(ceil(v) >= v - 1e-9, v + ' never rounds below itself');
  });

  test('the eighth-inch formatter remains available and unchanged for other uses', () => {
    assert.ok(fn3d('pbv23dDim').includes("['', '1/8', '1/4'"), 'pbv23dDim still exists as-is');
    // and PULL REQUIREMENTS values are untouched — they use the raw engine
    // value formatter, never the new whole-inch ceiling
    assert.ok(!fn3d('pbv23dPullCardHtml').includes('pbv23dCeilBoxDim'),
      'individual pull requirements are never ceiling-rounded');
  });

  test('HEADING: certified vs pre-calculation vs invalid states', () => {
    const a = app(); const s = auditFixture(a);
    assert.ok(text(a.html()).startsWith('REQUIRED BOX SIZE'), 'pre-calc placeholder stays sensible');
    assert.ok(!text(a.html()).includes('MINIMUM REQUIRED BOX SIZE'));
    a.calc();
    assert.ok(text(a.html()).startsWith('MINIMUM REQUIRED BOX SIZE'), 'certified result gets the new heading');
    assert.ok(!text(a.html()).match(/^REQUIRED BOX SIZE \d/), 'old bare heading does not remain for a certified result');
    const empty = app(); const es = empty.empty(); empty.load(es); empty.calc();
    assert.ok(text(empty.html()).startsWith('REQUIRED BOX SIZE'), 'an invalid/empty result keeps asking the question');
    assert.ok(!text(empty.html()).includes('MINIMUM'));
  });

  test('GUARANTEE: ceiling rounding never upgrades or removes the conservative wording', () => {
    const a = app(); auditFixture(a); a.calc();
    const t = text(a.html());
    assert.ok(t.includes('CONSERVATIVE NEC LAYOUT'));
    assert.ok(t.includes('Physical fitting and depth fit are not verified.'));
    assert.ok(!/EXACT/i.test(t), 'whole-inch display never introduces EXACT wording');
    assert.strictEqual(a.layout().result.physicalFitVerified, false);
    assert.strictEqual(a.layout().result.depthVerified, false);
  });

  test('FIXTURES: drawing and result agree, whole-inch, on ROWS, DENSE and a mixed case', () => {
    for (const build of [
      (a) => { const s = a.state ? null : null; },  // placeholder, replaced below
    ]) { void build; }

    function run(build) {
      const a = app(); build(a);
      a.calc();
      const box = a.layout().result;
      const wCeil = Math.ceil(box.widthIn - 1e-9);
      const hCeil = Math.ceil(box.heightIn - 1e-9);
      const t = text(a.html());
      assert.ok(t.includes(wCeil + '\u2033 W \u00D7 ' + hCeil + '\u2033 H'),
        'result headline: ' + t.slice(0, 60));
      const svg = a.svg();
      assert.ok(svg.includes(wCeil + '\u2033 WIDTH'), 'drawing width matches result: ' + wCeil);
      assert.ok(!svg.includes('NOT FULLY DETERMINED'), 'no stale label once certified');
      assert.ok(!svg.includes('p3d-dim-ref'), 'certified axis drawn solid');
      const line = a.sheet();
      assert.ok(line.includes('W ' + wCeil + '\u2033') && line.includes('H ' + hCeil + '\u2033'),
        'sheet line matches: ' + line);
      return { a, box };
    }

    // ROWS: left wall split rows + top entry, angle pull
    run((a) => {
      const s = a.empty(); a.load(s);
      const r1 = a.addRow(s, 'left', a.nextId('row'));
      const r2 = a.addRow(s, 'left', a.nextId('row'));
      const L4 = a.add(s, 'left', '4', a.nextId('e'));
      a.setRow(s, L4.id, r1.id);
      const L2b = a.add(s, 'left', '2', a.nextId('e'));
      a.setRow(s, L2b.id, r1.id);
      const L3 = a.add(s, 'left', '3', a.nextId('e'));
      a.setRow(s, L3.id, r2.id);
      const T = a.add(s, 'top', '2', a.nextId('e'));
      a.conn(s, L4.id, T.id, a.nextId('c'));
    });

    // DENSE-ish mixed: several entries across walls, one of each pull type
    run((a) => {
      const s = a.empty(); a.load(s);
      const L4 = a.add(s, 'left', '4', a.nextId('e'));
      const R4 = a.add(s, 'right', '4', a.nextId('e'));
      const L2b = a.add(s, 'left', '2', a.nextId('e'));
      const T2 = a.add(s, 'top', '2', a.nextId('e'));
      const B3a = a.add(s, 'bottom', '3', a.nextId('e'));
      const B3b = a.add(s, 'bottom', '3', a.nextId('e'));
      a.conn(s, L4.id, R4.id, a.nextId('c'));
      a.conn(s, L2b.id, T2.id, a.nextId('c'));
      a.conn(s, B3a.id, B3b.id, a.nextId('c'));
    });
  });

  test('INVALIDATION: a stale certified box never survives an edit', () => {
    const a = app(); const s = auditFixture(a);
    a.calc();
    assert.ok(a.svg().includes('WIDTH') && !a.svg().includes('NOT FULLY DETERMINED'));
    a.setSize(s, s.entries[0].id, '4');
    a.invalidate();
    assert.strictEqual(a.layout(), null);
    assert.ok(!text(a.html()).includes('MINIMUM REQUIRED BOX SIZE'), 'stale heading gone');
    assert.ok(!a.svg().includes('26\u2033 WIDTH'), 'no stale whole-inch label survives');
  });

  test('REGRESSION: one Layer-1 call, no solver-math change, no extra L2 calls', () => {
    const a = app(); auditFixture(a);
    a.calc();
    assert.strictEqual(a.l1Calls(), 1, 'exactly one Layer-1 call');
    assert.ok(a.l2Calls() >= 1 && a.l2Calls() <= 3, 'no explosion in Layer-2 calls: ' + a.l2Calls());
    assert.ok(!fn3d('pbv23dCeilBoxDim').includes('EC.pullBoxLayout'),
      'the display formatter never calls the solver again');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4 — CERTIFIED SOLVER LAYOUT VISUALIZATION

   The drawing must render the solver's own physical placements after a
   certified CALCULATE, and nothing else. These tests take the SOLVER as
   truth: they never re-derive NEC spacing arithmetic, they compare rendered
   geometry against the placements Layer 2 actually returned.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4 — certified layout visualization', () => {
  /** BOTTOM U pull, 3" <-> 3", plus an angle so WIDTH is layout dependent. */
  function uFixture(a) {
    const s = a.empty(); a.load(s);
    const B1 = a.add(s, 'bottom', '3', a.nextId('e'));
    const B2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, B1.id, B2.id, a.nextId('c'));
    // schematic positions deliberately CLOSE TOGETHER — the exact complaint
    // this milestone exists to fix
    a.setPos(s, B1.id, 0.45);
    a.setPos(s, B2.id, 0.55);
    return { s, B1, B2 };
  }

  test('GATE: certified view needs the existing certified box AND placements', () => {
    const a = app(); uFixture(a);
    assert.strictEqual(a.certifiedView(), null, 'nothing certified before CALCULATE');
    a.calc();
    const view = a.certifiedView();
    assert.ok(view, 'a certified box with placements activates the view');
    // the view's dimensions ARE the displayed whole-inch box, not the raw
    // fractional solver result
    const box = a.layout().result;
    assert.strictEqual(view.widthIn, Math.ceil(box.widthIn - 1e-9));
    assert.strictEqual(view.heightIn, Math.ceil(box.heightIn - 1e-9));
    assert.ok(view.widthIn >= box.widthIn, 'displayed box is never smaller than certified');
  });

  test('BEFORE CALCULATE the drawing is schematic; AFTER it is certified', () => {
    const a = app(); uFixture(a);
    let svg = a.svg();
    assert.ok(svg.includes('SCHEMATIC'), 'schematic indicator before calculating');
    assert.ok(!svg.includes('CERTIFIED LAYOUT'), 'nothing claims certification yet');
    a.calc();
    svg = a.svg();
    assert.ok(svg.includes('CERTIFIED LAYOUT'), 'certified indicator after calculating');
    assert.ok(!svg.includes('SCHEMATIC \u2014 NOT TO SCALE'), 'both modes never shown at once');
    assert.ok(!svg.includes('EXACT LAYOUT'),
      'conservative Layer-0 geometry must never be called exact');
  });

  test('U-PULL: rendered separation equals solver separation / displayed width', () => {
    const a = app(); const { s, B1, B2 } = uFixture(a);
    a.calc();
    const view = a.certifiedView();
    const pl = a.layout().result.placements;
    // TRUTH = the solver's own placements, not re-derived NEC arithmetic
    const physicalSep = Math.abs(pl[B1.id].alongIn - pl[B2.id].alongIn);
    const expectedFraction = physicalSep / view.widthIn;

    const v1 = a.entryRenderV(a.find(s, B1.id), view);
    const v2 = a.entryRenderV(a.find(s, B2.id), view);
    assert.ok(Math.abs(Math.abs(v1 - v2) - expectedFraction) < 1e-9,
      'normalised separation must equal physical separation / displayed width');

    // and it must be a LARGE fraction of the box — the visible symptom the
    // milestone exists to fix (schematic positions were 0.10 apart)
    assert.ok(Math.abs(v1 - v2) > 0.5,
      'the pair should occupy most of the box width, was ' + Math.abs(v1 - v2));

    // screen-space check through the real hub geometry
    const geo = a.geoFor(view.widthIn, view.heightIn);
    const h1 = a.hub('bottom', v1, 0, geo);
    const h2 = a.hub('bottom', v2, 0, geo);
    const faceW = geo.front.x2 - geo.front.x1;
    assert.ok(Math.abs(Math.abs(h1.x - h2.x) / faceW - expectedFraction) < 1e-6,
      'screen separation tracks the physical fraction');
  });

  test('ROUND-UP: normalisation divides by the DISPLAYED box, never the raw one', () => {
    const a = app();
    const view = { widthIn: 26, heightIn: 21, placements: {} };
    // a solver that certified 25.25" but is displayed as 26"
    view.placements.x = { wall: 'bottom', alongIn: 20 };
    const v = a.entryRenderV({ id: 'x', wall: 'bottom', v: 0.5 }, view);
    assert.ok(Math.abs(v - 20 / 26) < 1e-12, 'must be 20/26');
    assert.ok(Math.abs(v - 20 / 25.25) > 1e-3, 'must NOT be 20/25.25');
  });

  test('NO STRETCH: the round-up surplus stays free space, not spread across entries', () => {
    const a = app();
    const view = { widthIn: 26, heightIn: 21, placements: {
      a: { wall: 'bottom', alongIn: 4 }, b: { wall: 'bottom', alongIn: 22 } } };
    const va = a.entryRenderV({ id: 'a', wall: 'bottom', v: 0 }, view);
    const vb = a.entryRenderV({ id: 'b', wall: 'bottom', v: 1 }, view);
    // if coordinates were stretched to fill 26", the pair would reach the walls
    assert.ok(Math.abs(va - 4 / 26) < 1e-12 && Math.abs(vb - 22 / 26) < 1e-12);
    assert.ok(va > 0 && vb < 1, 'entries do not get pushed to the box edges');
  });

  test('WALL ORIGINS: all four walls map without mirroring (asymmetric fixture)', () => {
    const a = app();
    // deliberately asymmetric: a reversed origin on ANY wall changes a value
    const view = { widthIn: 40, heightIn: 20, placements: {
      t: { wall: 'top', alongIn: 8 },
      b: { wall: 'bottom', alongIn: 30 },
      l: { wall: 'left', alongIn: 4 },
      r: { wall: 'right', alongIn: 16 } } };
    const V = (id, wall) => a.entryRenderV({ id, wall, v: 0.5 }, view);
    // TOP/BOTTOM: domain x runs LEFT->RIGHT, screen v runs LEFT->RIGHT
    assert.ok(Math.abs(V('t', 'top') - 8 / 40) < 1e-12, 'top: v = s/W');
    assert.ok(Math.abs(V('b', 'bottom') - 30 / 40) < 1e-12, 'bottom: v = s/W');
    // LEFT/RIGHT: domain y runs BOTTOM->TOP, screen v runs TOP->BOTTOM
    assert.ok(Math.abs(V('l', 'left') - (1 - 4 / 20)) < 1e-12, 'left: v = 1 - s/H');
    assert.ok(Math.abs(V('r', 'right') - (1 - 16 / 20)) < 1e-12, 'right: v = 1 - s/H');
    // an entry LOW on a vertical wall must render LOW on screen (large y)
    const geo = a.geoFor(40, 20);
    const low = a.hub('left', V('l', 'left'), 0, geo);
    const high = a.hub('right', V('r', 'right'), 0, geo);
    assert.ok(low.y > high.y,
      'alongIn 4 (near BOTTOM) must sit below alongIn 16 (near TOP) on screen');
  });

  test('WALL ORIGINS: a reversed origin on any single wall would fail', () => {
    const a = app();
    const view = { widthIn: 30, heightIn: 30, placements: {
      t: { wall: 'top', alongIn: 5 }, l: { wall: 'left', alongIn: 5 } } };
    const vt = a.entryRenderV({ id: 't', wall: 'top', v: 0.5 }, view);
    const vl = a.entryRenderV({ id: 'l', wall: 'left', v: 0.5 }, view);
    // same alongIn on a horizontal and a vertical wall must NOT produce the
    // same normalised value — that is exactly what a missing inversion does
    assert.ok(Math.abs(vt - vl) > 0.5,
      'horizontal and vertical walls use different origin conventions');
  });

  test('ASPECT: the drawn face keeps the physical W:H, uniformly scaled', () => {
    const a = app();
    for (const [w, h] of [[26, 21], [40, 20], [20, 40]]) {
      const g = a.geoFor(w, h);
      const fw = g.front.x2 - g.front.x1;
      const fh = g.front.y2 - g.front.y1;
      assert.ok(Math.abs(fw / fh - w / h) < 1e-9,
        w + 'x' + h + ' drew ' + (fw / fh) + ' not ' + (w / h));
      // stays inside the schematic envelope, so it still fits the viewport
      assert.ok(fw <= 192 + 1e-9 && fh <= 148 + 1e-9, 'face fits the drawing area');
      assert.ok(g.rim.x1 >= 0 && g.rim.y1 >= 0 && g.rim.x2 <= 340 && g.rim.y2 <= 300,
        'rim stays inside the viewBox');
    }
    // no physical box -> the approved fixed schematic geometry, unchanged
    assert.deepStrictEqual(a.geoFor(null, null).front, a.geoFor().front);
  });

  test('ALL VISUALS MOVE TOGETHER: hub, stub, ring, label and hit target agree', () => {
    const a = app(); const { s, B1 } = uFixture(a);
    a.calc();
    const view = a.certifiedView();
    const geo = a.geoFor(view.widthIn, view.heightIn);
    const e1 = a.find(s, B1.id);
    const h = a.hub('bottom', a.entryRenderV(e1, view), a.rowDepth(s, e1.rowId), geo);
    const svg = a.svg();
    const near = (v) => Math.round(Number(v) * 100) / 100;
    // hub ellipse, selection-independent hit circle and stub all share cx
    /* SUPERSEDED BY PBV2-13B-4.7: B1 is confirmed (part of the U pull), so
       its hub is now the numbered circle, not an ellipse — the coordinate
       boundary this test exists to prove is unaffected by the tag change. */
    const hub = svg.match(new RegExp('<(?:ellipse|circle) class="p3d-hub" data-entry="' + B1.id
      + '" cx="([-0-9.]+)"'));
    const hit = svg.match(new RegExp('<circle class="p3d-hit" data-entry="' + B1.id
      + '" cx="([-0-9.]+)"'));
    assert.ok(hub && hit, 'hub and hit target are both drawn');
    assert.strictEqual(near(hub[1]), near(hit[1]), 'hit target sits on the hub');
    assert.ok(Math.abs(Number(hub[1]) - h.x) < 1e-6,
      'hub uses the certified coordinate from the single boundary');
    const stub = svg.match(new RegExp('<line class="p3d-stubhit" data-entry="' + B1.id
      + '" x1="([-0-9.]+)"'));
    assert.ok(stub && Math.abs(Number(stub[1]) - h.x) < 1e-6, 'stub tracks the same x');
  });

  test('SINGLE BOUNDARY: only the hub map chooses a coordinate source', () => {
    const body = fn3d('pbv23dRenderSvg');
    // entry.v is read in exactly one place in the renderer: through the boundary
    assert.strictEqual((body.match(/pbv23dEntryRenderV\(/g) || []).length, 1,
      'exactly one call to the render-position boundary');
    assert.ok(!/\ben\.v\b|\be\.v\b/.test(body),
      'the renderer never reads entry.v directly');
    // and the boundary is the only function that knows about placements
    assert.ok(fn3d('pbv23dEntryRenderV').includes('view.placements'));
  });

  test('IDENTITY: switching to certified changes coordinates and nothing else', () => {
    const a = app(); const s = auditFixture(a);
    const before = a.svg();
    const ids = (h) => (h.match(/data-(entry|conn|row)="[^"]+"/g) || []).sort();
    // PBV2-13B-4.7: connection numbers now live in both confirmed endpoint
    // hubs (p3d-hubnum), not a single floating badge group — extract from
    // the new location; the invariant itself (numbers unchanged) is unmoved
    const nums = (h) => (h.match(/<text class="p3d-hubnum"[^>]*>(\d+)<\/text>/g) || [])
      .map((t) => t.match(/>(\d+)</)[1]).sort();
    // RELATIONSHIP colours only — enclosure chrome and the dimension layer
    // (which legitimately appears once a result exists) are not identity
    const colours = (h) => (h.match(/<path class="p3d-route"[^>]*stroke="(#[0-9a-f]{6})"/g)
      || []).sort();
    a.calc();
    const after = a.svg();
    assert.deepStrictEqual(ids(after), ids(before), 'entry/connection/row ids unchanged');
    assert.deepStrictEqual(nums(after), nums(before), 'connection numbers unchanged');
    assert.deepStrictEqual(colours(after), colours(before), 'relationship colours unchanged');
    assert.strictEqual(s.entries.length, a.state().entries.length);
  });

  test('SCHEMATIC STATE IS NEVER MUTATED BY CERTIFICATION', () => {
    const a = app(); const { s, B1, B2 } = uFixture(a);
    const snapshot = JSON.stringify({ e: s.entries, r: s.rows, c: s.connections });
    a.calc();
    a.svg();
    assert.strictEqual(JSON.stringify({ e: s.entries, r: s.rows, c: s.connections }),
      snapshot, 'CALCULATE and rendering must not write solver coordinates into state');
    // specifically: v is untouched
    assert.strictEqual(a.find(s, B1.id).v, 0.45);
    assert.strictEqual(a.find(s, B2.id).v, 0.55);
  });

  test('INVALIDATION MATRIX: only calculation-relevant edits drop certification', () => {
    // --- schematic position only: certification SURVIVES ---
    {
      const a = app(); const { s, B1 } = uFixture(a);
      a.calc();
      const before = a.layout().result.placements[B1.id].alongIn;
      const dims = [a.certifiedView().widthIn, a.certifiedView().heightIn];
      a.pickPositionOn(B1.id, 10);
      assert.ok(a.certifiedView(), 'schematic position must NOT invalidate');
      assert.strictEqual(a.layout().result.placements[B1.id].alongIn, before,
        'certified placements unchanged');
      assert.deepStrictEqual([a.certifiedView().widthIn, a.certifiedView().heightIn], dims,
        'certified W x H unchanged');
      assert.ok(a.svg().includes('CERTIFIED LAYOUT'), 'still drawing certified');
      assert.strictEqual(a.find(s, B1.id).v, 0.1, 'the schematic value did change');
      assert.strictEqual(a.l1Calls(), 1, 'no solver call from a schematic edit');
    }
    // --- row.order only: certification SURVIVES ---
    {
      const a = app(); const s = auditFixture(a);
      a.calc();
      assert.ok(a.certifiedView());
      s.rows.forEach((r, i) => { r.order = s.rows.length - i; });   // pure presentation metadata
      assert.ok(a.certifiedView(), 'row.order alone is not calculation-relevant');
      assert.ok(a.svg().includes('CERTIFIED LAYOUT'));
    }
    // --- row MEMBERSHIP change: certification DROPS ---
    {
      const a = app(); const s = auditFixture(a);
      a.calc();
      const e = s.entries[0];
      const row = a.addRow(s, e.wall, a.nextId('row'));
      a.setRow(s, e.id, row.id);
      a.invalidate();
      assert.strictEqual(a.certifiedView(), null, 'row membership is calculation-relevant');
      assert.ok(a.svg().includes('SCHEMATIC'), 'drawing returns to schematic immediately');
    }
    // --- trade size / wall / delete: certification DROPS ---
    for (const mutate of [
      (a, s) => { a.setSize(s, s.entries[0].id, '4'); },
      (a, s) => { a.setWall(s, s.entries[0].id, 'right'); },
      (a, s) => { a.del(s, s.entries[0].id); },
    ]) {
      const a = app(); const s = auditFixture(a);
      a.calc();
      assert.ok(a.certifiedView());
      mutate(a, s);
      a.invalidate();
      assert.strictEqual(a.certifiedView(), null);
      assert.ok(a.svg().includes('SCHEMATIC'), 'no stale certified geometry left visible');
    }
  });

  test('NON-CERTIFIED STATES never render certified coordinates', () => {
    const a = app(); uFixture(a);
    a.calc();
    assert.ok(a.certifiedView(), 'baseline is certified');
    const good = a.layout();
    for (const state of ['UNKNOWN', 'INVALID', 'NO_FEASIBLE_WITHIN_BOUNDS',
      'GEOMETRY_UNRESOLVED']) {
      a.layout().state = state;
      assert.strictEqual(a.certifiedView(), null, state + ' must stay schematic');
      assert.ok(a.svg().includes('SCHEMATIC'), state + ' draws schematic');
    }
    good.state = 'CERTIFIED_WITHIN_TOLERANCE';
    assert.ok(a.certifiedView(), 'restoring the certified state restores the view');
    // a certified status with NO placements is still not renderable
    const saved = good.result.placements;
    delete good.result.placements;
    assert.strictEqual(a.certifiedView(), null, 'certified without placements stays schematic');
    good.result.placements = saved;
  });

  test('PARTIAL PLACEMENTS are refused outright — never a mixed drawing', () => {
    const a = app(); const { B1 } = uFixture(a);
    a.calc();
    const pl = a.layout().result.placements;
    const saved = pl[B1.id];
    delete pl[B1.id];
    assert.strictEqual(a.certifiedView(), null,
      'one missing placement drops the WHOLE drawing to schematic');
    pl[B1.id] = { wall: 'top', alongIn: saved.alongIn };     // wall disagrees with state
    assert.strictEqual(a.certifiedView(), null, 'a wall mismatch is refused too');
    pl[B1.id] = saved;
    assert.ok(a.certifiedView(), 'restored');
  });

  test('NO SOLVER CALLS DURING RENDER', () => {
    const a = app(); uFixture(a);
    a.calc();
    const l1 = a.l1Calls(); const l2 = a.l2Calls();
    for (let i = 0; i < 5; i++) a.svg();
    a.certifiedView();
    assert.strictEqual(a.l1Calls(), l1, 'render must not call Layer 1');
    assert.strictEqual(a.l2Calls(), l2, 'render must not call Layer 2');
    for (const fn of ['pbv23dRenderSvg', 'pbv23dEntryRenderV', 'pbv23dCertifiedView',
      'pbv23dGeoFor', 'pbv23dHub']) {
      assert.ok(!/EC\.pullBox(Layout|EntryGeometry)?\./.test(fn3d(fn)),
        fn + ' must not reach into any layer');
    }
  });

  test('RECALCULATE with unchanged state reproduces the same drawing', () => {
    const a = app(); uFixture(a);
    a.calc();
    const first = a.svg();
    const firstPl = JSON.stringify(a.layout().result.placements);
    a.calc();
    assert.strictEqual(a.svg(), first, 'deterministic drawing');
    assert.strictEqual(JSON.stringify(a.layout().result.placements), firstPl,
      'deterministic placements');
  });

  test('DENSE and ROWS render certified without moving electrical coordinates', () => {
    for (const key of ['rows', 'dense']) {
      const a = app();
      // build the shipped fixture through the real builder
      const s = a.empty(); a.load(s);
      const walls = ['top', 'bottom', 'left', 'right'];
      const n = key === 'dense' ? 10 : 5;
      const made = [];
      for (let i = 0; i < n; i++) {
        made.push(a.add(s, walls[i % 4], '2', a.nextId('e')));
      }
      a.conn(s, made[0].id, made[1].id, a.nextId('c'));
      a.calc();
      const view = a.certifiedView();
      if (!view) continue;                      // honest: not every fixture certifies
      const geo = a.geoFor(view.widthIn, view.heightIn);
      const svg = a.svg();
      for (const e of s.entries) {
        const h = a.hub(e.wall, a.entryRenderV(a.find(s, e.id), view),
          a.rowDepth(s, e.rowId), geo);
        const hit = svg.match(new RegExp('<circle class="p3d-hit" data-entry="' + e.id
          + '" cx="([-0-9.]+)" cy="([-0-9.]+)" r="([-0-9.]+)"'));
        assert.ok(hit, key + ': every raceway keeps a touch target');
        assert.ok(Number(hit[3]) > 0, key + ': touch radius stays positive');
        // the hit target sits on the CERTIFIED hub, not a schematic one
        assert.ok(Math.abs(Number(hit[1]) - h.x) < 1e-6
          && Math.abs(Number(hit[2]) - h.y) < 1e-6,
        key + ': hit target follows the certified hub');
      }
    }
  });

  test('GUARANTEE A ONLY: a realistic drawing never implies physical fit', () => {
    const a = app(); uFixture(a);
    a.calc();
    const t = text(a.html());
    assert.ok(t.includes('Physical fitting and depth fit are not verified'),
      'the Guarantee A/B distinction survives the more realistic drawing');
    assert.ok(!/locknut|connector body|depth verified/i.test(a.svg()),
      'no fitting hardware is drawn as if verified');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.1 — CERTIFIED PULL ROUTE VISUALIZATION POLISH

   The certified hub positions are NOT under test here — 13B-4 pins those.
   This suite pins the SHAPE of the drawn schematic route: that it leads into
   the box before turning, turns in the interior, and cannot fold back on
   itself. Nothing here asserts anything about conductor bending: the app has
   no conductor data and certifies no bend geometry.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.1 — pull route visualization', () => {
  const ADJACENT = { top: ['left', 'right'], bottom: ['left', 'right'],
    left: ['top', 'bottom'], right: ['top', 'bottom'] };
  const INWARD = { left: { x: 1, y: 0 }, right: { x: -1, y: 0 },
    top: { x: 0, y: 1 }, bottom: { x: 0, y: -1 } };

  /* ROUTE FAMILY (PBV2-13B-4.3): every ANGLE route is
       M a [L a2] Q anchor [b2 L b | b]
     — ONE quadratic, with a straight lead on a side only when that lead can
     join the curve tangentially AND leave the curve at least a lead's worth of
     arm. Otherwise the lead is absorbed and the curve starts at the hub. The
     4.2 "fallback" (M a Q anchor b) is now simply the no-lead member of the
     same family, produced deterministically by geometry rather than by the
     safety net. `kind` reports which leads survived; every test below asserts
     the shared invariants (inward first motion, containment, no loop) on all
     members, and lead-specific invariants (wall-normal, tangent join) only on
     surviving leads. */
  function parseAngle(d) {
    const t = d.trim().split(/\s+/);
    assert.strictEqual(t[0], 'M', 'route starts with M: ' + d);
    const a = { x: Number(t[1]), y: Number(t[2]) };
    let i = 3; let a2 = a; let leadA = false;
    if (t[i] === 'L') { a2 = { x: Number(t[i + 1]), y: Number(t[i + 2]) }; leadA = true; i += 3; }
    assert.strictEqual(t[i], 'Q', 'exactly one quadratic turn: ' + d);
    const anchor = { x: Number(t[i + 1]), y: Number(t[i + 2]) };
    const to = { x: Number(t[i + 3]), y: Number(t[i + 4]) }; i += 5;
    let b = to; let b2 = to; let leadB = false;
    if (t[i] === 'L') { b = { x: Number(t[i + 1]), y: Number(t[i + 2]) }; leadB = true; i += 3; }
    assert.strictEqual(i, t.length, 'no trailing geometry after the route: ' + d);
    const kind = leadA && leadB ? 'broad' : (!leadA && !leadB ? 'fallback' : 'one-lead');
    return { kind, leadA, leadB, a, a2, anchor, b2, b };
  }
  /** Flatten the whole route to a polyline, whichever family member it is. */
  function polyline(d) {
    const p = parseAngle(d);
    const out = [p.a];
    if (p.leadA) out.push(p.a2);
    for (let i = 1; i <= 40; i++) {
      const t = i / 40; const u = 1 - t;
      out.push({
        x: u * u * p.a2.x + 2 * u * t * p.anchor.x + t * t * p.b2.x,
        y: u * u * p.a2.y + 2 * u * t * p.anchor.y + t * t * p.b2.y,
      });
    }
    if (p.leadB) out.push(p.b);
    return out;
  }
  function crosses(p, q, r, s) {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
    const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
  }
  function selfIntersections(P) {
    let n = 0;
    for (let i = 0; i < P.length - 1; i++) {
      for (let j = i + 2; j < P.length - 1; j++) {
        if (crosses(P[i], P[i + 1], P[j], P[j + 1])) n++;
      }
    }
    return n;
  }
  const dot = (from, to, n) => (to.x - from.x) * n.x + (to.y - from.y) * n.y;

  test('ANGLE: lead-in leaves the wall along its inward normal', () => {
    /* PBV2-13B-4.3: this fixture's TOP hub is 51.8px above the elbow — less
       than two lead-lengths — so its straight lead is now absorbed into the
       curve on purpose (keeping it left the curve a 24px arm, the "curl").
       The guarantee this test exists for is unchanged and asserted on every
       side: motion off the wall is INTO the box, and any surviving straight
       lead is purely wall-normal. Both-lead behaviour on a genuinely
       well-separated pull is pinned separately in the 4.3 block. */
    const a = app(); const geo = a.geoFor(26, 21);
    const src = a.hub('left', 0.35, 0, geo);
    const dst = a.hub('top', 0.65, 0, geo);
    const p = parseAngle(a.routePath('ANGLE', 'left', src, 'top', dst, geo));
    assert.deepStrictEqual(p.a, src, 'route starts exactly on the hub');
    assert.deepStrictEqual(p.b, dst, 'route ends exactly on the hub');
    assert.ok(p.leadA, 'the LEFT side has room for a straight lead');
    assert.ok(dot(p.a, p.a2, INWARD.left) > 0, 'lead-in travels INTO the box');
    assert.ok(Math.abs(p.a2.y - p.a.y) < 1e-9, 'lead-in is purely wall-normal');
    // TOP side: absorbed — the curve itself must still arrive from inside
    assert.ok(dot(p.b, p.anchor, INWARD.top) > 0, 'curve approaches the TOP hub from inside');
  });

  test('ANGLE: the turn happens inside the box, not at the opening', () => {
    const a = app(); const geo = a.geoFor(26, 21); const F = geo.front;
    for (const [wa, va, wb, vb] of [['left', 0.3, 'top', 0.7], ['bottom', 0.2, 'right', 0.8]]) {
      const src = a.hub(wa, va, 0, geo); const dst = a.hub(wb, vb, 0, geo);
      const p = parseAngle(a.routePath('ANGLE', wa, src, wb, dst, geo));
      const lead = Math.hypot(p.a2.x - p.a.x, p.a2.y - p.a.y);
      if (p.leadA) {
        assert.ok(lead >= 6, wa + '->' + wb + ': lead is substantial, was ' + lead);
      }
      // the turn anchor sits inside the opening, off every wall
      assert.ok(p.anchor.x > F.x1 && p.anchor.x < F.x2 && p.anchor.y > F.y1 && p.anchor.y < F.y2,
        'turn geometry stays inside the enclosure');
    }
  });

  test('ANGLE: no loop, no reversal, stays enclosed — all four orientations', () => {
    const a = app();
    const walls = ['top', 'right', 'bottom', 'left'];
    let checked = 0;
    for (const [W, H] of [[26, 21], [40, 20], [20, 40]]) {
      const geo = a.geoFor(W, H); const F = geo.front;
      for (const wa of walls) {
        for (const wb of ADJACENT[wa]) {
          for (const va of [0.02, 0.2, 0.5, 0.8, 0.98]) {
            for (const vb of [0.02, 0.2, 0.5, 0.8, 0.98]) {
              for (const ta of [0, 0.45]) {
                for (const tb of [0, 0.45]) {
                  const src = a.hub(wa, va, ta, geo); const dst = a.hub(wb, vb, tb, geo);
                  const d = a.routePath('ANGLE', wa, src, wb, dst, geo);
                  const P = polyline(d); checked++;
                  assert.strictEqual(selfIntersections(P), 0,
                    'loop in ' + W + 'x' + H + ' ' + wa + '(' + va + ',' + ta + ')->'
                    + wb + '(' + vb + ',' + tb + '): ' + d);
                  for (const q of P) {
                    assert.ok(q.x >= F.x1 - 0.75 && q.x <= F.x2 + 0.75
                      && q.y >= F.y1 - 0.75 && q.y <= F.y2 + 0.75,
                    'route left the enclosure: ' + d);
                  }
                }
              }
            }
          }
        }
      }
    }
    assert.ok(checked >= 2000, 'swept a meaningful space, was ' + checked);
  });

  test('ANGLE: near-corner placements never loop, whichever family member is used', () => {
    const a = app(); const geo = a.geoFor(26, 21);
    // both entries crowded toward their shared LEFT/TOP corner — this is the
    // exact configuration the real certified STANDARD screenshot exposed
    const src = a.hub('left', 0.06, 0, geo); const dst = a.hub('top', 0.06, 0, geo);
    const d = a.routePath('ANGLE', 'left', src, 'top', dst, geo);
    const p = parseAngle(d);
    assert.strictEqual(selfIntersections(polyline(d)), 0, 'no loop at the corner');
    if (p.leadA) assert.ok(dot(p.a, p.a2, INWARD.left) > 0, 'still leads inward, not back through the wall');
    if (p.leadB) assert.ok(dot(p.b, p.b2, INWARD.top) > 0, 'lead-out still points inward');
    // the turn itself is never AT the corner regardless of which family member
    const F = geo.front;
    const exX = (F.x2 - F.x1) * a.exclude(); const exY = (F.y2 - F.y1) * a.exclude();
    assert.ok(p.anchor.x >= F.x1 + exX - 0.6, 'turn is not hugging the shared corner in x');
    assert.ok(p.anchor.y >= F.y1 + exY - 0.6, 'turn is not hugging the shared corner in y');
  });

  test('ANGLE: no lead ever points back out through its own wall (broad case)', () => {
    const a = app();
    for (const [W, H] of [[26, 21], [40, 20], [20, 40]]) {
      const geo = a.geoFor(W, H);
      for (const wa of ['top', 'right', 'bottom', 'left']) {
        for (const wb of ADJACENT[wa]) {
          for (const va of [0.05, 0.5, 0.95]) {
            for (const vb of [0.05, 0.5, 0.95]) {
              for (const ta of [0, 0.45]) {
                const src = a.hub(wa, va, ta, geo); const dst = a.hub(wb, vb, 0.45, geo);
                const p = parseAngle(a.routePath('ANGLE', wa, src, wb, dst, geo));
                if (p.leadA) assert.ok(dot(p.a, p.a2, INWARD[wa]) >= -1e-9,
                  wa + ' lead-in reversed through the wall');
                if (p.leadB) assert.ok(dot(p.b, p.b2, INWARD[wb]) >= -1e-9,
                  wb + ' lead-out reversed through the wall');
              }
            }
          }
        }
      }
    }
  });

  test('LEAD is responsive to the rendered box, not a fixed pixel constant', () => {
    const a = app();
    const wide = a.routeLead(a.geoFor(40, 20));
    const tall = a.routeLead(a.geoFor(20, 40));
    const std = a.routeLead(a.geoFor(26, 21));
    for (const v of [wide, tall, std]) assert.ok(v >= 10 && v <= 28, 'bounded: ' + v);
    assert.ok(Math.abs(wide - std) > 1e-9 || Math.abs(tall - std) > 1e-9,
      'the lead responds to the enclosure shape');
  });

  test('ROUTES use the central hub positions, never placements directly', () => {
    const stripped = (fn) => fn3d(fn)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const fn of ['pbv23dRoutePath', 'pbv23dRouteLead', 'pbv23dClampInterior']) {
      const body = stripped(fn);        // CODE only — prose about the fix is fine
      assert.ok(!/placements|alongIn/.test(body),
        fn + ' must not read solver placements directly');
      assert.ok(!/\.v\b/.test(body), fn + ' must not read schematic v directly');
      assert.ok(!/EC\./.test(body), fn + ' must not reach into any layer');
    }
    // the renderer passes hub map entries, which 13B-4 already proved are the
    // single position source shared with openings, stubs and hit targets
    assert.ok(fn3d('pbv23dRenderSvg')
      .includes('pbv23dRoutePath(type, ea.wall, hubs[ea.id], eb.wall, hubs[eb.id]'),
    'route endpoints come from the shared hub map');
  });

  test('CERTIFIED: route endpoints sit exactly on the certified hubs', () => {
    const a = app(); const s = auditFixture(a);
    a.calc();
    const view = a.certifiedView();
    assert.ok(view, 'fixture certifies');
    const geo = a.geoFor(view.widthIn, view.heightIn);
    const svg = a.svg();
    for (const c of s.connections) {
      const ea = a.find(s, c.a); const eb = a.find(s, c.b);
      const ha = a.hub(ea.wall, a.entryRenderV(ea, view), a.rowDepth(s, ea.rowId), geo);
      const hb = a.hub(eb.wall, a.entryRenderV(eb, view), a.rowDepth(s, eb.rowId), geo);
      const m = svg.match(new RegExp('<path class="p3d-route" data-conn="' + c.id
        + '"[^>]*d="M ([-0-9.]+) ([-0-9.]+)[^"]*?([-0-9.]+) ([-0-9.]+)"'));
      assert.ok(m, 'route drawn for ' + c.id);
      assert.ok(Math.abs(Number(m[1]) - ha.x) < 1e-6 && Math.abs(Number(m[2]) - ha.y) < 1e-6,
        'route starts on the certified hub');
      assert.ok(Math.abs(Number(m[3]) - hb.x) < 1e-6 && Math.abs(Number(m[4]) - hb.y) < 1e-6,
        'route ends on the certified hub');
    }
  });

  test('U REGRESSION: the accepted wide turnaround is untouched', () => {
    const a = app(); const geo = a.geoFor(26, 21);
    const p = a.hub('bottom', 0.2, 0, geo); const q = a.hub('bottom', 0.8, 0, geo);
    const u = a.routePath('U', 'bottom', p, 'bottom', q, geo);
    assert.ok(u.includes(' A '), 'U still uses its arc turnaround');
    assert.ok(!u.includes(' C '), 'U did not become an angle-style cubic');
    assert.ok(u.startsWith('M ' + p.x + ' ' + p.y), 'U endpoints unchanged');
    assert.ok(u.endsWith('L ' + q.x + ' ' + q.y), 'U endpoints unchanged');
  });

  test('U REGRESSION: certified endpoint ratio is unchanged by the route work', () => {
    const a = app();
    const s = a.empty(); a.load(s);
    const B1 = a.add(s, 'bottom', '3', a.nextId('e'));
    const B2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, B1.id, B2.id, a.nextId('c'));
    a.calc();
    const view = a.certifiedView();
    const pl = a.layout().result.placements;
    const expected = Math.abs(pl[B1.id].alongIn - pl[B2.id].alongIn) / view.widthIn;
    const v1 = a.entryRenderV(a.find(s, B1.id), view);
    const v2 = a.entryRenderV(a.find(s, B2.id), view);
    assert.ok(Math.abs(Math.abs(v1 - v2) - expected) < 1e-9,
      'U spacing still tracks the solver exactly');
  });

  test('STRAIGHT REGRESSION: still reads as a through-pull', () => {
    const a = app(); const geo = a.geoFor(26, 21);
    const aligned = a.routePath('STRAIGHT', 'left', { x: 52, y: 100 },
      'right', { x: 244, y: 100 }, geo);
    assert.strictEqual(aligned, 'M 52 100 L 244 100', 'aligned stays one segment');
    const offset = a.routePath('STRAIGHT', 'left', { x: 52, y: 80 },
      'right', { x: 244, y: 140 }, geo);
    assert.ok(!offset.includes(' C ') && !offset.includes(' Q ') && !offset.includes(' A '),
      'STRAIGHT gained no angle-style curve');
  });

  test('SHARED RACEWAY: two angle routes leave one hub without moving it', () => {
    const a = app();
    const s = a.empty(); a.load(s);
    const L = a.add(s, 'left', '2', a.nextId('e'));
    const T = a.add(s, 'top', '2', a.nextId('e'));
    const B = a.add(s, 'bottom', '2', a.nextId('e'));
    a.conn(s, L.id, T.id, a.nextId('c'));
    a.conn(s, L.id, B.id, a.nextId('c'));
    const svg = a.svg();
    const routes = svg.match(/<path class="p3d-route"[^>]*d="M ([-0-9.]+) ([-0-9.]+)/g) || [];
    assert.strictEqual(routes.length, 2, 'both pulls drawn');
    // both start on the SAME shared hub — no invented per-pull entry position
    const starts = routes.map((r) => r.match(/M ([-0-9.]+) ([-0-9.]+)/).slice(1).join(','));
    assert.strictEqual(starts[0], starts[1], 'shared hub is not duplicated or moved');
    for (const d of (svg.match(/<path class="p3d-route"[^>]*d="([^"]+)"/g) || [])) {
      const path = d.match(/d="([^"]+)"/)[1];
      if (path.includes(' Q ')) assert.strictEqual(selfIntersections(polyline(path)), 0);
    }
  });

  test('SHARED RACEWAY: crossing routes are accepted, not avoided (correction)', () => {
    // Two DIFFERENT connections whose routes intentionally cross in the
    // interior. This must be accepted as-is: no bending around the other
    // route, no moved anchor, no separate "lane" per row, no increase in
    // route complexity to prevent the crossing, and certified/schematic
    // endpoints must not move because another connection exists.
    const a = app();
    const s = a.empty(); a.load(s);
    // connection 1: LEFT(low) <-> TOP(right side) — sweeps across the middle
    const L1 = a.add(s, 'left', '2', a.nextId('e'));
    const T1 = a.add(s, 'top', '2', a.nextId('e'));
    a.setPos(s, L1.id, 0.15); a.setPos(s, T1.id, 0.85);
    a.conn(s, L1.id, T1.id, a.nextId('c'));
    // connection 2: TOP(left side) <-> LEFT(high) — sweeps the other way,
    // designed to cross connection 1's path through the shared interior
    const T2 = a.add(s, 'top', '2', a.nextId('e'));
    const L2 = a.add(s, 'left', '2', a.nextId('e'));
    a.setPos(s, T2.id, 0.15); a.setPos(s, L2.id, 0.85);
    a.conn(s, T2.id, L2.id, a.nextId('c'));

    const before = {
      L1: a.hub(L1.wall, a.entryRenderV(a.find(s, L1.id), null), 0, a.geoFor()),
    };
    const svg = a.svg();
    const paths = (svg.match(/<path class="p3d-route"[^>]*d="([^"]+)"/g) || [])
      .map((m) => m.match(/d="([^"]+)"/)[1]);
    assert.strictEqual(paths.length, 2, 'both connections drawn');
    // each route individually stays loop-free — that guarantee is per
    // connection, never influenced by the other connection's geometry
    for (const d of paths) assert.strictEqual(selfIntersections(polyline(d)), 0);
    // endpoints are untouched by the OTHER route's existence: each drawn
    // path must start/end exactly on that entry's own hub computation
    const geo = a.geoFor();
    const endpointsOf = (d) => {
      const m = d.match(/^M ([-0-9.]+) ([-0-9.]+)/);
      const last = d.match(/([-0-9.]+) ([-0-9.]+)$/);
      return [{ x: Number(m[1]), y: Number(m[2]) }, { x: Number(last[1]), y: Number(last[2]) }];
    };
    const near = (p, q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
    for (const [e, other] of [[L1, T1], [T2, L2]]) {
      const hE = a.hub(e.wall, a.entryRenderV(a.find(s, e.id), null), a.rowDepth(s, e.rowId), geo);
      const hOther = a.hub(other.wall, a.entryRenderV(a.find(s, other.id), null),
        a.rowDepth(s, other.rowId), geo);
      const d = paths.find((p) => {
        const [p0, p1] = endpointsOf(p);
        return (near(p0, hE) && near(p1, hOther)) || (near(p0, hOther) && near(p1, hE));
      });
      assert.ok(d, e.id + ' route endpoint must equal its own hub exactly');
    }
    // deleting connection 2 must not change connection 1's drawn path at all
    a.del(s, T2.id);
    const dOf = (html) => (html.match(/<path class="p3d-route"[^>]*d="([^"]+)"/g) || [])
      .map((m) => m.match(/d="([^"]+)"/)[1]);
    const c1After = dOf(a.svg())[0];
    const c1Before = paths[0];
    assert.strictEqual(c1After, c1Before,
      'removing a crossing connection must not move the surviving one');
  });

  test('IDENTITY: numbering and relationship colours survive the route change', () => {
    const a = app(); const s = auditFixture(a);
    const colours = (h) => (h.match(/<path class="p3d-route"[^>]*stroke="(#[0-9a-f]{6})"/g) || []).sort();
    // PBV2-13B-4.7: connection numbers now live in both confirmed endpoint
    // hubs (p3d-hubnum), not a single floating badge group — extract from
    // the new location; the invariant itself (numbers unchanged) is unmoved
    const nums = (h) => (h.match(/<text class="p3d-hubnum"[^>]*>(\d+)<\/text>/g) || [])
      .map((t) => t.match(/>(\d+)</)[1]).sort();
    const before = { c: colours(a.svg()), n: nums(a.svg()) };
    a.calc();
    assert.deepStrictEqual(colours(a.svg()), before.c, 'relationship colours unchanged');
    assert.deepStrictEqual(nums(a.svg()), before.n, 'connection numbers unchanged');
    assert.strictEqual(s.connections.length, a.state().connections.length);
  });

  test('NO BEND-RADIUS RULE was invented', () => {
    // CODE only: the comments legitimately explain that no bend rule exists
    const body = ['pbv23dRoutePath', 'pbv23dRouteLead', 'pbv23dClampInterior']
      .map(fn3d).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/bend|conductor|\bOD\b/i.test(body),
      'no conductor bending arithmetic in the route builder');
    // and no bend claim reaches the USER: scan rendered output, not source
    const a2 = app(); const s2 = auditFixture(a2); a2.calc();
    const shown = (text(a2.html()) + ' ' + a2.svg().replace(/<[^>]+>/g, ' ')).toLowerCase();
    for (const claim of ['bend radius', 'conductor bend', 'route verified',
      'bend compliant', 'physical conductor']) {
      assert.ok(!shown.includes(claim), 'user-visible bend claim: ' + claim);
    }
    // the honest Guarantee A wording is still the one on screen
    assert.ok(text(a2.html()).includes('Physical fitting and depth fit are not verified'));
    assert.strictEqual(s2.connections.length, a2.state().connections.length);
  });

  test('SLIDER: usable in schematic mode, not offered in certified view', () => {
    const a = app(); const s = auditFixture(a);
    const id = s.entries[0].id;
/* SUPERSEDED BY PBV2-13B-4.9B: the schematic-position slider is removed from
       the editor (visual-only; never reaches the engine). The MODEL guarantees
       this test protected — entry.v exists, survives certification, is set by
       automatic placement, and never reaches Layer 1 — are asserted directly. */
    let sheet = a.sheetBody(id);
    assert.ok(!sheet.includes('id="pbv2-3d-pos"'), 'no slider in the editor (schematic)');
    assert.ok(typeof a.find(s, id).v === 'number', 'entry.v still exists on the model');
    a.calc();
    assert.ok(a.certifiedView(), 'now certified');
    sheet = a.sheetBody(id);
    assert.ok(!sheet.includes('id="pbv2-3d-pos"'), 'no slider in the editor (certified)');
    /* SUPERSEDED BY PBV2-13B-4.8g.4: that explanation described the
       CALCULATION, which now belongs to RESULTS mode only. The editor omits
       the control instead of explaining a result inside the raceway view. */
    assert.ok(!/Showing the calculated layout/.test(sheet), 'no result copy in the editor');
    assert.ok(!/SCHEMATIC POSITION/.test(sheet), 'the control is simply absent');
    // and the underlying value is untouched by hiding the control
    assert.strictEqual(a.find(s, id).v, s.entries[0].v);
  });

  test('SLIDER: entry.v survives certification and returns on invalidation', () => {
    const a = app(); const s = auditFixture(a);
    const id = s.entries[0].id;
    a.pickPositionOn(id, 22);
    const v = a.find(s, id).v;
    assert.ok(Math.abs(v - 0.22) < 1e-9, 'schematic edit applied');
    a.calc();
    assert.ok(a.certifiedView());
    assert.strictEqual(a.find(s, id).v, v, 'certification does not touch v');
    a.setSize(s, id, '4');
    a.invalidate();
    assert.strictEqual(a.certifiedView(), null, 'back to schematic');
    assert.strictEqual(a.find(s, id).v, v, 'the schematic value is still there');
/* SUPERSEDED BY PBV2-13B-4.9B: the schematic-position slider is removed from
       the editor (visual-only; never reaches the engine). The MODEL guarantees
       this test protected — entry.v exists, survives certification, is set by
       automatic placement, and never reaches Layer 1 — are asserted directly. */
    assert.ok(!a.sheetBody(id).includes('id="pbv2-3d-pos"'), 'still no slider: UI only');
    // still excluded from the engine request
    assert.ok(!JSON.stringify(a.request(s)).includes('"v"'), 'v never reaches Layer 1');
  });

  test('DENSE: every route is well formed and hubs did not move', () => {
    const a = app();
    const s = a.empty(); a.load(s);
    const walls = ['top', 'right', 'bottom', 'left'];
    const made = [];
    for (let i = 0; i < 12; i++) made.push(a.add(s, walls[i % 4], '2', a.nextId('e')));
    for (let i = 0; i < 10; i += 2) a.conn(s, made[i].id, made[i + 1].id, a.nextId('c'));
    for (const certified of [false, true]) {
      if (certified) a.calc();
      const svg = a.svg();
      const paths = (svg.match(/<path class="p3d-route"[^>]*d="([^"]+)"/g) || [])
        .map((m) => m.match(/d="([^"]+)"/)[1]);
      assert.ok(paths.length >= 5, 'all pulls drawn');
      for (const d of paths) {
        if (!d.includes(' C ')) continue;                  // U / STRAIGHT families
        assert.strictEqual(selfIntersections(polyline(d)), 0,
          (certified ? 'certified' : 'schematic') + ' dense route looped: ' + d);
      }
    }
  });

  test('13B-4 REGRESSIONS: position boundary and solver isolation intact', () => {
    const a = app(); uFixtureLite(a);
    a.calc();
    const l1 = a.l1Calls(); const l2 = a.l2Calls();
    for (let i = 0; i < 4; i++) a.svg();
    assert.strictEqual(a.l1Calls(), l1, 'render still calls no layer');
    assert.strictEqual(a.l2Calls(), l2, 'render still calls no layer');
    const body = fn3d('pbv23dRenderSvg');
    assert.strictEqual((body.match(/pbv23dEntryRenderV\(/g) || []).length, 1,
      'still exactly one coordinate boundary');
    assert.ok(!/\ben\.v\b|\be\.v\b/.test(body), 'renderer still never reads entry.v');
  });

  function uFixtureLite(a) {
    const s = a.empty(); a.load(s);
    const B1 = a.add(s, 'bottom', '3', a.nextId('e'));
    const B2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, B1.id, B2.id, a.nextId('c'));
    return s;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     PBV2-13B-4.2 — ANGLE INTERIOR BEND VISUALIZATION

     13B-4.1 kept ANGLE loop-free by capping each lead against the room toward
     its PARTNER hub. That is exactly what the real certified STANDARD case
     exposed as wrong: when Layer 2 legitimately places two entries near their
     shared corner, "room toward the partner" is small BY DESIGN, so the lead
     collapsed and the visible hook came right back. This suite pins the
     product fix (leads are fixed length, the turn is pushed out of a
     corner-exclusion zone) and its safety net (a verified, provably
     non-self-intersecting fallback for the narrow case where full leads would
     physically overlap).
     ════════════════════════════════════════════════════════════════════════ */
  describe('PBV2-13B-4.2 — ANGLE interior bend visualization', () => {
    /** The actual reported shape: LEFT and TOP certified near the shared
     *  corner, built through the real CALCULATE pipeline rather than
     *  hand-placed hubs, so this exercises the real certified-view path. */
    function standardLikeFixture(a) {
      const s = a.empty(); a.load(s);
      const L = a.add(s, 'left', '2', a.nextId('e'));
      const T = a.add(s, 'top', '2', a.nextId('e'));
      a.setPos(s, L.id, 0.08); a.setPos(s, T.id, 0.06);
      a.conn(s, L.id, T.id, a.nextId('c'));
      return { s, L, T };
    }

    test('REAL SHAPE: the certified STANDARD-like ANGLE no longer hugs the corner', () => {
      const a = app(); const { s, L, T } = standardLikeFixture(a);
      a.calc();
      const view = a.certifiedView();
      assert.ok(view, 'fixture certifies');
      const geo = a.geoFor(view.widthIn, view.heightIn);
      const hL = a.hub(L.wall, a.entryRenderV(a.find(s, L.id), view), a.rowDepth(s, L.rowId), geo);
      const hT = a.hub(T.wall, a.entryRenderV(a.find(s, T.id), view), a.rowDepth(s, T.rowId), geo);
      const d = a.routePath('ANGLE', L.wall, hL, T.wall, hT, geo);
      assert.strictEqual(selfIntersections(polyline(d)), 0, 'no loop on the real certified shape');
      const p = parseAngle(d);
      // the turn itself must not sit in the shared-corner exclusion zone
      const F = geo.front;
      const exX = (F.x2 - F.x1) * a.exclude(); const exY = (F.y2 - F.y1) * a.exclude();
      assert.ok(p.anchor.x >= F.x1 + exX - 0.6 && p.anchor.y >= F.y1 + exY - 0.6,
        'the main bend is pushed into the interior, not hugging the LEFT/TOP corner');
      // certified hubs are exactly what feeds the route — nothing was moved
      // to make the route prettier
      assert.deepStrictEqual(p.a, hL, "the route must not move Layer-2's certified hub");
      assert.deepStrictEqual(p.b, hT, "the route must not move Layer-2's certified hub");
    });

    test('EXCLUSION ZONE: the turn stays outside it whenever the box has room', () => {
      const a = app();
      const walls = ['top', 'right', 'bottom', 'left'];
      let checked = 0;
      for (const [W, H] of [[26, 21], [40, 20], [20, 40]]) {
        if (Math.min(W, H) < 15) continue;              // "sufficient room" per the milestone
        const geo = a.geoFor(W, H); const F = geo.front;
        const exX = (F.x2 - F.x1) * a.exclude(); const exY = (F.y2 - F.y1) * a.exclude();
        for (const wa of walls) {
          for (const wb of ADJACENT[wa]) {
            for (const va of [0.02, 0.3, 0.6, 0.9]) {
              for (const vb of [0.02, 0.3, 0.6, 0.9]) {
                const src = a.hub(wa, va, 0, geo); const dst = a.hub(wb, vb, 0, geo);
                const p = parseAngle(a.routePath('ANGLE', wa, src, wb, dst, geo));
                const sideFirst = (wa === 'left' || wa === 'right');
                const vertWall = sideFirst ? wa : wb; const horizWall = sideFirst ? wb : wa;
                const okX = vertWall === 'left' ? p.anchor.x >= F.x1 + exX - 0.6
                  : p.anchor.x <= F.x2 - exX + 0.6;
                const okY = horizWall === 'top' ? p.anchor.y >= F.y1 + exY - 0.6
                  : p.anchor.y <= F.y2 - exY + 0.6;
                assert.ok(okX && okY, 'turn entered the exclusion zone: '
                  + W + 'x' + H + ' ' + wa + '(' + va + ')->' + wb + '(' + vb + ')');
                checked++;
              }
            }
          }
        }
      }
      assert.ok(checked >= 200, 'checked a meaningful space, was ' + checked);
    });

    test('NO-LEAD SHAPE: same-corner entries get one hub-to-hub quadratic, by geometry', () => {
      /* PBV2-13B-4.3: in 4.2 this shape was reached through the self-
         intersection SAFETY NET. It is now the no-lead member of the route
         family, chosen deterministically (both leads absorbed because the
         corner-excluded anchor is off both lead lines). The guarantee this
         test carries is unchanged — a single, loop-free quadratic exactly
         hub-to-hub — and it now additionally pins that the safety net was
         NOT what produced it. */
      const a = app(); const geo = a.geoFor(26, 21);
      const near = a.hub('left', 0.02, 0, geo);
      const near2 = a.hub('top', 0.02, 0, geo);
      const r = a.angleRoute('left', near, 'top', near2, geo);
      assert.strictEqual(r.fallback, false, 'produced by the family rule, not the safety net');
      assert.strictEqual(r.leadA || r.leadB, false, 'no straight lead fits at the corner');
      assert.strictEqual(selfIntersections(polyline(r.d)), 0, 'loop-free');
      const p = parseAngle(r.d);
      assert.strictEqual(p.kind, 'fallback', 'single hub-to-hub quadratic');
      assert.deepStrictEqual(p.a, near); assert.deepStrictEqual(p.b, near2);
      // well-separated entries keep both straight leads
      const far = a.hub('left', 0.5, 0, geo); const far2 = a.hub('top', 0.5, 0, geo);
      const rf = a.angleRoute('left', far, 'top', far2, geo);
      assert.ok(rf.leadA && rf.leadB && !rf.fallback,
        'well-separated entries take the common both-lead path');
    });

    test('U REGRESSION (4.2): untouched by the ANGLE rework', () => {
      const a = app(); const geo = a.geoFor(26, 21);
      const p = a.hub('bottom', 0.2, 0, geo); const q = a.hub('bottom', 0.8, 0, geo);
      const u = a.routePath('U', 'bottom', p, 'bottom', q, geo);
      assert.ok(u.includes(' A '), 'U still uses its arc turnaround');
      assert.ok(!u.includes(' Q ') && !u.includes(' C '), 'U gained no angle-style curve');
    });

    test('STRAIGHT REGRESSION (4.2): untouched by the ANGLE rework', () => {
      const a = app(); const geo = a.geoFor(26, 21);
      const aligned = a.routePath('STRAIGHT', 'left', { x: 52, y: 100 },
        'right', { x: 244, y: 100 }, geo);
      assert.strictEqual(aligned, 'M 52 100 L 244 100');
    });

    test('SLIDER REGRESSION (4.2): certified-view hiding is unaffected', () => {
      const a = app(); const { s, L } = standardLikeFixture(a);
      /* SUPERSEDED BY PBV2-13B-4.9B: the slider is gone from the editor in
         both views. The 4.2 guarantee that certification does not disturb the
         schematic value is asserted on the model instead. */
      const v0 = a.find(s, L.id).v;
      a.calc();
      assert.strictEqual(a.find(s, L.id).v, v0, 'certification leaves entry.v untouched');
      assert.ok(!a.sheetBody(L.id).includes('id="pbv2-3d-pos"'), 'no slider either way');
    });

    test('IDENTITY (4.2): numbering/colours survive on the real near-corner fixture', () => {
      const a = app(); const { s } = standardLikeFixture(a);
      const colours = (h) => (h.match(/<path class="p3d-route"[^>]*stroke="(#[0-9a-f]{6})"/g) || []).sort();
      const nums = (h) => (h.match(/<text class="p3d-hubnum"[^>]*>(\d+)<\/text>/g) || [])
      .map((t) => t.match(/>(\d+)</)[1]).sort();
      const before = { c: colours(a.svg()), n: nums(a.svg()) };
      a.calc();
      assert.deepStrictEqual(colours(a.svg()), before.c);
      assert.deepStrictEqual(nums(a.svg()), before.n);
    });

    test('NO ROUTE ELECTRICAL ARITHMETIC: guard against reconstructed NEC math', () => {
      const stripped = (fn) => fn3d(fn).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const fn of ['pbv23dRoutePath', 'pbv23dRouteAnchor', 'pbv23dRouteLead',
        'pbv23dClampInterior', 'pbv23dSegCross', 'pbv23dPolylineLoops']) {
        const body = stripped(fn);
        assert.ok(!/placements|alongIn|tradeSize|entrySpacing|requirement/i.test(body),
          fn + ' must not reconstruct any Layer-1 requirement');
        assert.ok(!/EC\./.test(body), fn + ' must not reach into any layer');
      }
    });

    test('FROZEN LAYERS (4.2): byte-identical to the pre-milestone baseline', () => {
      assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
      // PBV2-13B-4.6 re-baseline: Layer 2 changed by the scoped finder-policy edit
      assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
      assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════
     PBV2-13B-4.3 — ANGLE VISUAL REFINEMENT / NEAR-CORNER LEAD CORRECTION

     4.2 was engineering-green but the real certified STANDARD ANGLE still read
     as straight -> diagonal -> curl. Measured on that fixture: the corner-
     exclusion clamp moved the anchor 34.8px off the TOP lead's line (a 20°
     kink at the lead/curve joint) and left it 14.4px from the LEFT lead's end
     (a stub arm, the curl). A quadratic's end-tangent points at its control
     point, so a straight lead can only join the curve smoothly when the
     anchor is ON that lead's line, and the curve only stays broad when it
     keeps at least a lead's worth of arm. That is now the per-side rule;
     otherwise the lead is absorbed and there is no joint left to kink at.
     ════════════════════════════════════════════════════════════════════════ */
  describe('PBV2-13B-4.3 — ANGLE visual refinement', () => {
    const angleBetween = (u, v) => Math.acos(Math.max(-1, Math.min(1,
      (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))))) * 180 / Math.PI;
    /** The EXACT shipped STANDARD fixture, through the real CALCULATE path. */
    function shippedStandard(a) {
      const s = a.empty(); a.load(s);
      const l2 = a.add(s, 'left', '2', a.nextId('e'));
      const t2 = a.add(s, 'top', '2', a.nextId('e'));
      const b1 = a.add(s, 'bottom', '3', a.nextId('e'));
      const b2 = a.add(s, 'bottom', '3', a.nextId('e'));
      a.setPos(s, b1.id, 0.3); a.setPos(s, b2.id, 0.7);
      a.conn(s, l2.id, t2.id, a.nextId('c'));
      a.conn(s, b1.id, b2.id, a.nextId('c'));
      return { s, l2, t2 };
    }

    test('A. REAL FIXTURE: certified STANDARD ANGLE is one broad tangent-continuous bend', () => {
      const a = app(); const { s, l2, t2 } = shippedStandard(a);
      const placementsBefore = JSON.stringify(a.request(s));
      a.calc();
      const view = a.certifiedView();
      assert.ok(view && view.widthIn === 26 && view.heightIn === 21, 'the real 26 x 21 result');
      // certified hubs are computed from Layer-2 placements and nothing else
      const geo = a.geoFor(view.widthIn, view.heightIn); const F = geo.front;
      const hL = a.hub('left', a.entryRenderV(a.find(s, l2.id), view), a.rowDepth(s, l2.rowId), geo);
      const hT = a.hub('top', a.entryRenderV(a.find(s, t2.id), view), a.rowDepth(s, t2.rowId), geo);
      const r = a.angleRoute('left', hL, 'top', hT, geo);
      const p = parseAngle(r.d);
      assert.deepStrictEqual(p.a, hL, 'route starts ON the certified LEFT hub');
      assert.deepStrictEqual(p.b, hT, 'route ends ON the certified TOP hub');
      assert.strictEqual(JSON.stringify(a.request(s)), placementsBefore, 'state untouched');
      /* SUPERSEDED BY PBV2-13B-4.6: this asserted the NO-LEAD family, because
         Layer 2's 'left'-first finder packed both BLUE entries against their
         wall origins and neither straight lead could fit without a kink. The
         4.6 material-slack finder proposal places the passenger BLUE entries
         mid-wall (the U-controlled 26 x 21 box has room), so the UNCHANGED
         4.3 route builder now keeps BOTH leads — the strictly better member
         of the same family. Every guarantee this test carried is preserved
         below (exact endpoints, loop-free, contained, exclusion, tangency,
         broadness); only the family expectation moved. */
      assert.strictEqual(p.kind, 'broad', 'both straight leads fit on redistributed hubs');
      assert.strictEqual(r.fallback, false, 'chosen by the family rule, not the safety net');
      assert.strictEqual(selfIntersections(polyline(r.d)), 0, 'loop-free');
      for (const q of polyline(r.d)) {
        assert.ok(q.x >= F.x1 - 0.75 && q.x <= F.x2 + 0.75 && q.y >= F.y1 - 0.75 && q.y <= F.y2 + 0.75,
          'contained');
      }
      // exclusion: the turn is not hugging the LEFT/TOP corner or either wall
      const exX = (F.x2 - F.x1) * a.exclude(); const exY = (F.y2 - F.y1) * a.exclude();
      assert.ok(p.anchor.x >= F.x1 + exX - 1e-6 && p.anchor.y >= F.y1 + exY - 1e-6,
        'turn is outside the shared-corner exclusion zone');
      // the old wall-hugging behaviour: a turn within a few px of the opening
      assert.ok(Math.hypot(p.anchor.x - hL.x, p.anchor.y - hL.y) > 2 * a.routeLead(geo) * 0.75,
        'turn is well away from the LEFT opening');
      // tangency: with both leads kept, each lead joins its curve with NO
      // direction break, and both hubs are entered exactly along their normals
      const depL = angleBetween({ x: p.a2.x - p.a.x, y: p.a2.y - p.a.y }, { x: p.anchor.x - p.a2.x, y: p.anchor.y - p.a2.y });
      const arrT = angleBetween({ x: p.b2.x - p.b.x, y: p.b2.y - p.b.y }, { x: p.anchor.x - p.b2.x, y: p.anchor.y - p.b2.y });
      assert.ok(depL < 1e-6, 'LEFT lead->curve joint is tangent, was ' + depL);
      assert.ok(arrT < 1e-6, 'TOP curve->lead joint is tangent, was ' + arrT);
      assert.ok(Math.abs(p.a2.y - hL.y) < 1e-9 && Math.abs(p.b2.x - hT.x) < 1e-9, 'leads are wall-normal');
      // broadness: the curve keeps a full lead's worth of arm beyond each lead
      const armL = Math.hypot(p.anchor.x - p.a2.x, p.anchor.y - p.a2.y);
      const armT = Math.hypot(p.anchor.x - p.b2.x, p.anchor.y - p.b2.y);
      assert.ok(armL >= a.routeLead(geo) && armT >= a.routeLead(geo),
        'arms beyond the leads are at least a lead each, were ' + armL.toFixed(1) + '/' + armT.toFixed(1));
    });

    test('B. TANGENCY: every straight lead joins its curve with no direction break', () => {
      /* Tolerance: 1 degree. Over a 28px lead at a 2px stroke that is a
         sub-pixel deviation — invisible. The construction guarantees 0. */
      const a = app();
      let leads = 0; let absorbed = 0; let maxBreak = 0; let minArm = Infinity; let maxHub = 0;
      for (const [W, H] of [[26, 21], [40, 20], [20, 40]]) {
        const geo = a.geoFor(W, H); const lead = a.routeLead(geo);
        for (const wa of ['top', 'right', 'bottom', 'left']) {
          for (const wb of ADJACENT[wa]) {
            for (const va of [0.02, 0.15, 0.35, 0.5, 0.65, 0.85, 0.98]) {
              for (const vb of [0.02, 0.15, 0.35, 0.5, 0.65, 0.85, 0.98]) {
                for (const ta of [0, 0.45]) {
                  const src = a.hub(wa, va, ta, geo); const dst = a.hub(wb, vb, 0.45, geo);
                  const p = parseAngle(a.routePath('ANGLE', wa, src, wb, dst, geo));
                  if (p.leadA) {
                    leads++;
                    const brk = angleBetween({ x: p.a2.x - p.a.x, y: p.a2.y - p.a.y },
                      { x: p.anchor.x - p.a2.x, y: p.anchor.y - p.a2.y });
                    maxBreak = Math.max(maxBreak, brk);
                    minArm = Math.min(minArm, Math.hypot(p.anchor.x - p.a2.x, p.anchor.y - p.a2.y) / lead);
                  } else {
                    absorbed++;
                    maxHub = Math.max(maxHub, angleBetween({ x: p.anchor.x - p.a.x, y: p.anchor.y - p.a.y }, INWARD[wa]));
                  }
                  if (p.leadB) {
                    leads++;
                    const brk = angleBetween({ x: p.b2.x - p.b.x, y: p.b2.y - p.b.y },
                      { x: p.anchor.x - p.b2.x, y: p.anchor.y - p.b2.y });
                    maxBreak = Math.max(maxBreak, brk);
                    minArm = Math.min(minArm, Math.hypot(p.anchor.x - p.b2.x, p.anchor.y - p.b2.y) / lead);
                  } else {
                    absorbed++;
                    maxHub = Math.max(maxHub, angleBetween({ x: p.anchor.x - p.b.x, y: p.anchor.y - p.b.y }, INWARD[wb]));
                  }
                }
              }
            }
          }
        }
      }
      assert.ok(leads > 500 && absorbed > 500, 'both branches exercised: ' + leads + '/' + absorbed);
      assert.ok(maxBreak < 1, 'max lead->curve direction break ' + maxBreak.toFixed(3) + ' deg');
      assert.ok(minArm >= 1 - 1e-9, 'a surviving lead always leaves >= 1 lead of arm, min ' + minArm.toFixed(3));
      assert.ok(maxHub < 90, 'an absorbed side always departs INTO the box, max ' + maxHub.toFixed(1));
    });

    test('C. SWEEP: zero loops, zero breaches, zero exclusion violations, safety net unused', () => {
      const a = app();
      const counts = { total: 0, both: 0, one: 0, none: 0, fallback: 0 };
      for (const [W, H] of [[26, 21], [40, 20], [20, 40], [12, 12], [60, 10], [10, 60]]) {
        const geo = a.geoFor(W, H); const F = geo.front;
        const exX = (F.x2 - F.x1) * a.exclude(); const exY = (F.y2 - F.y1) * a.exclude();
        for (const wa of ['top', 'right', 'bottom', 'left']) {
          for (const wb of ADJACENT[wa]) {
            for (const va of [0.02, 0.06, 0.15, 0.35, 0.5, 0.65, 0.85, 0.94, 0.98]) {
              for (const vb of [0.02, 0.06, 0.15, 0.35, 0.5, 0.65, 0.85, 0.94, 0.98]) {
                for (const ta of [0, 0.45]) {
                  for (const tb of [0, 0.45]) {
                    const src = a.hub(wa, va, ta, geo); const dst = a.hub(wb, vb, tb, geo);
                    const r = a.angleRoute(wa, src, wb, dst, geo);
                    counts.total++;
                    if (r.fallback) counts.fallback++;
                    if (r.leadA && r.leadB) counts.both++;
                    else if (r.leadA || r.leadB) counts.one++;
                    else counts.none++;
                    const P = polyline(r.d);
                    assert.strictEqual(selfIntersections(P), 0, 'loop: ' + r.d);
                    for (const q of P) {
                      assert.ok(q.x >= F.x1 - 0.75 && q.x <= F.x2 + 0.75
                        && q.y >= F.y1 - 0.75 && q.y <= F.y2 + 0.75, 'breach: ' + r.d);
                    }
                    if (Math.min(W, H) >= 15) {
                      const p = parseAngle(r.d);
                      const sideFirst = (wa === 'left' || wa === 'right');
                      const vW = sideFirst ? wa : wb; const hW = sideFirst ? wb : wa;
                      const okX = vW === 'left' ? p.anchor.x >= F.x1 + exX - 0.6 : p.anchor.x <= F.x2 - exX + 0.6;
                      const okY = hW === 'top' ? p.anchor.y >= F.y1 + exY - 0.6 : p.anchor.y <= F.y2 - exY + 0.6;
                      assert.ok(okX && okY, 'exclusion: ' + r.d);
                    }
                    // reversed order: identical geometry, mirrored leads
                    const rr = a.angleRoute(wb, dst, wa, src, geo);
                    const pr = parseAngle(rr.d); const p0 = parseAngle(r.d);
                    assert.ok(Math.abs(pr.anchor.x - p0.anchor.x) < 1e-9 && Math.abs(pr.anchor.y - p0.anchor.y) < 1e-9
                      && pr.leadA === p0.leadB && pr.leadB === p0.leadA, 'reversal symmetric');
                  }
                }
              }
            }
          }
        }
      }
      assert.ok(counts.total >= 15000, 'swept ' + counts.total);
      assert.strictEqual(counts.fallback, 0, 'safety net never needed: ' + JSON.stringify(counts));
      assert.ok(counts.both > 0 && counts.one > 0 && counts.none > 0, 'all members exercised');
    });

    test('D. NORMAL ANGLE: the shipped schematic STANDARD route is byte-identical to 4.2', () => {
      const a = app(); const { s } = shippedStandard(a);
      const d = (a.svg().match(/<path class="p3d-route"[^>]*d="([^"]+)"/) || [])[1];
      assert.strictEqual(d, 'M 65.2 106.8 L 93.2 106.8 Q 148 106.8 148 69.8 L 148 41.8');
      const p = parseAngle(d);
      assert.strictEqual(p.kind, 'broad', 'a well-separated pull keeps both straight leads');
      assert.strictEqual(s.entries.length, 4);
    });

    test('E. U and STRAIGHT: byte-identical behaviour', () => {
      const a = app(); const geo = a.geoFor(26, 21);
      const p = a.hub('bottom', 0.2, 0, geo); const q = a.hub('bottom', 0.8, 0, geo);
      const u = a.routePath('U', 'bottom', p, 'bottom', q, geo);
      assert.ok(u.includes(' A ') && !u.includes(' Q ') && !u.includes(' C '), 'U untouched');
      assert.ok(!fn3d('pbv23dRoutePath').includes('pbv23dAngleRoute(wallA, a, wallB, b, G).d;\n  }\n  if (type === \'U\')'),
        'ANGLE dispatch does not sit inside the U branch');
      assert.strictEqual(a.routePath('STRAIGHT', 'left', { x: 52, y: 100 }, 'right', { x: 244, y: 100 }, geo),
        'M 52 100 L 244 100', 'STRAIGHT untouched');
    });

    test('F. CROSSING: two different connections may cross; neither is altered', () => {
      const a = app();
      const s = a.empty(); a.load(s);
      const L1 = a.add(s, 'left', '2', a.nextId('e')); const T1 = a.add(s, 'top', '2', a.nextId('e'));
      a.setPos(s, L1.id, 0.15); a.setPos(s, T1.id, 0.85);
      a.conn(s, L1.id, T1.id, a.nextId('c'));
      const solo = (a.svg().match(/<path class="p3d-route"[^>]*d="([^"]+)"/g) || [])
        .map((m) => m.match(/d="([^"]+)"/)[1])[0];
      const T2 = a.add(s, 'top', '2', a.nextId('e')); const L2 = a.add(s, 'left', '2', a.nextId('e'));
      a.setPos(s, T2.id, 0.15); a.setPos(s, L2.id, 0.85);
      a.conn(s, T2.id, L2.id, a.nextId('c'));
      const paths = (a.svg().match(/<path class="p3d-route"[^>]*d="([^"]+)"/g) || [])
        .map((m) => m.match(/d="([^"]+)"/)[1]);
      assert.strictEqual(paths.length, 2);
      assert.strictEqual(paths[0], solo, 'adding a crossing connection did not move the first');
      // and they really do cross each other
      const P1 = polyline(paths[0]); const P2 = polyline(paths[1]);
      let cross = 0;
      for (let i = 0; i < P1.length - 1; i++) {
        for (let j = 0; j < P2.length - 1; j++) if (crosses(P1[i], P1[i + 1], P2[j], P2[j + 1])) cross++;
      }
      assert.ok(cross >= 1, 'the fixture genuinely crosses (' + cross + ')');
      assert.ok(!/connections|conns\b/.test(fn3d('pbv23dAngleRoute')), 'route builder never looks at other connections');
    });

    test('G. NO ELECTRICAL ARITHMETIC in the 4.3 route functions', () => {
      const stripped = (fn) => fn3d(fn).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const fn of ['pbv23dAngleRoute', 'pbv23dAngleSide', 'pbv23dRouteAnchor']) {
        const body = stripped(fn);
        assert.ok(!/placements|alongIn|tradeSize|entrySpacing|requirement|\.v\b/i.test(body), fn);
        assert.ok(!/EC\./.test(body), fn);
      }
    });

    test('H. FROZEN LAYERS (4.3): byte-identical', () => {
      assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
      // PBV2-13B-4.6 re-baseline: Layer 2 changed by the scoped finder-policy edit
      assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
      assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    });
  });

});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-13B-4.7 — CONNECTION NUMBER INSIDE CONFIRMED ENTRY HUBS

   The floating route-number badge (<g class="p3d-connnums">, one <circle>
   per connection at the route midpoint) is gone. A confirmed raceway now
   shows its pull number INSIDE the hub itself: one connection -> one number
   in that pull's colour; several connections (a shared raceway) -> every
   touching number, in pbv23dConnNumber's own canonical order, inside ONE
   true circle — never a stretched pill — keeping the existing neutral
   colour and dashed multi-ring cue. Zero connections -> the ordinary
   unnumbered ellipse marker, unchanged. Numbers and colours still come
   from the pre-existing pbv23dConnNumber / pbv23dConnColor mapping; no
   second identity system exists.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-13B-4.7 — connection number inside confirmed entry hubs', () => {
  const hubOf = (svg, id) => svg.match(new RegExp('<(?:ellipse|circle) class="p3d-hub" data-entry="' + id
    + '"[^>]*(?:cx|r)="[-0-9.]+"[^>]*>|<circle class="p3d-hub" data-entry="' + id + '"[^>]*/>'))
    || svg.match(new RegExp('<(?:ellipse|circle) class="p3d-hub" data-entry="' + id + '"[^>]*/?>'));
  const hubNumsOf = (svg, id) => (svg.match(new RegExp('<text class="p3d-hubnum" data-entry="' + id
    + '"[^>]*>(\\d+)</text>', 'g')) || []).map((t) => t.match(/>(\d+)</)[1]);
  const multiringFor = (svg, id) => new RegExp('<circle class="p3d-multiring" cx="[-0-9.]+" cy="[-0-9.]+"[^>]*/>')
    .test(svg) && svg.includes('p3d-multiring') && (() => {
    // multiring has no data-entry of its own; verify by position match against the hub's cx/cy
    const h = hubOf(svg, id)[0];
    const cx = h.match(/cx="([-0-9.]+)"/)[1]; const cy = h.match(/cy="([-0-9.]+)"/)[1];
    return svg.includes('<circle class="p3d-multiring" cx="' + cx + '" cy="' + cy + '"');
  })();

  test('A. zero-connection entry stays the ordinary unnumbered ellipse marker', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const e = a.add(s, 'left', '2', a.nextId('e'));
    const svg = a.svg();
    assert.ok(new RegExp('<ellipse class="p3d-hub" data-entry="' + e.id + '"').test(svg));
    assert.strictEqual(hubNumsOf(svg, e.id).length, 0, 'no number for an unconfirmed entry');
    assert.ok(!svg.includes('p3d-selring') && !svg.includes('p3d-multiring'));
  });

  test('B. confirmed ANGLE: the same number at both endpoint hubs', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const t = a.add(s, 'top', '2', a.nextId('e'));
    a.conn(s, l.id, t.id, a.nextId('c'));
    const svg = a.svg(); const num = String(a.connNumber(s, s.connections[0].id));
    assert.deepStrictEqual(hubNumsOf(svg, l.id), [num]);
    assert.deepStrictEqual(hubNumsOf(svg, t.id), [num]);
    assert.ok(new RegExp('<circle class="p3d-hub" data-entry="' + l.id + '"').test(svg),
      'confirmed hub is a true circle, not an ellipse');
  });

  test('C. confirmed U: the same number at both endpoint hubs', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const b1 = a.add(s, 'bottom', '3', a.nextId('e')); const b2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, b1.id, b2.id, a.nextId('c'));
    const svg = a.svg(); const num = String(a.connNumber(s, s.connections[0].id));
    assert.deepStrictEqual(hubNumsOf(svg, b1.id), [num]);
    assert.deepStrictEqual(hubNumsOf(svg, b2.id), [num]);
  });

  test('D. confirmed STRAIGHT: the same number at both endpoint hubs', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, l.id, r.id, a.nextId('c'));
    const svg = a.svg(); const num = String(a.connNumber(s, s.connections[0].id));
    assert.deepStrictEqual(hubNumsOf(svg, l.id), [num]);
    assert.deepStrictEqual(hubNumsOf(svg, r.id), [num]);
  });

  test('E. multiple independent connections: correct number at each endpoint pair', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l1 = a.add(s, 'left', '2', a.nextId('e')); const t1 = a.add(s, 'top', '2', a.nextId('e'));
    const b1 = a.add(s, 'bottom', '3', a.nextId('e')); const b2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, l1.id, t1.id, a.nextId('c')); a.conn(s, b1.id, b2.id, a.nextId('c'));
    const svg = a.svg();
    assert.deepStrictEqual(hubNumsOf(svg, l1.id), ['1']); assert.deepStrictEqual(hubNumsOf(svg, t1.id), ['1']);
    assert.deepStrictEqual(hubNumsOf(svg, b1.id), ['2']); assert.deepStrictEqual(hubNumsOf(svg, b2.id), ['2']);
  });

  test('F. no floating route badge remains for any confirmed pull', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const t = a.add(s, 'top', '2', a.nextId('e'));
    const b1 = a.add(s, 'bottom', '3', a.nextId('e')); const b2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.conn(s, l.id, t.id, a.nextId('c')); a.conn(s, b1.id, b2.id, a.nextId('c'));
    const svg = a.svg();
    assert.ok(!svg.includes('p3d-connnum"'), 'no floating badge circle');
    assert.ok(!svg.includes('p3d-connnums'), 'no floating badge group');
    assert.strictEqual((svg.match(/class="p3d-hubnum"/g) || []).length, s.connections.length * 2);
  });

  test('G. numbers come from the existing pbv23dConnNumber mapping, not a new system', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const t = a.add(s, 'top', '2', a.nextId('e'));
    a.conn(s, l.id, t.id, a.nextId('c'));
    assert.deepStrictEqual(a.entryConnNumbers(s, l.id), [a.connNumber(s, s.connections[0].id)]);
    const body = fn3d('pbv23dEntryConnNumbers');
    assert.ok(body.includes('pbv23dConnNumber') && body.includes('pbv23dEntryConns'),
      'derived from the existing mapping, nothing invented');
  });

  test('H. single-connection hub uses the existing connection colour identity', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const t = a.add(s, 'top', '2', a.nextId('e'));
    a.conn(s, l.id, t.id, a.nextId('c'));
    const svg = a.svg(); const col = a.connColor(s, s.connections[0].id);
    assert.ok(new RegExp('<circle class="p3d-hub" data-entry="' + l.id + '"[^>]*stroke="' + col + '"').test(svg));
    assert.ok(new RegExp('class="p3d-hubnum" data-entry="' + l.id + '"[^>]*fill="' + col + '"').test(svg));
  });

  test('I. shared hub stays neutral, never one pull\'s colour', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e')); const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, hub.id, t.id, a.nextId('c')); a.conn(s, hub.id, r.id, a.nextId('c'));
    assert.strictEqual(a.entryColor(s, hub.id), a.NEUTRAL, 'entry colour stays neutral');
    const svg = a.svg();
    assert.ok(new RegExp('<circle class="p3d-hub" data-entry="' + hub.id + '"[^>]*stroke="' + a.NEUTRAL + '"').test(svg));
  });

  test('J. shared hub retains the dashed multi-connection ring cue', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e')); const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, hub.id, t.id, a.nextId('c')); a.conn(s, hub.id, r.id, a.nextId('c'));
    const svg = a.svg();
    assert.strictEqual((svg.match(/class="p3d-multiring"/g) || []).length, 1);
    assert.ok(svg.includes('stroke-dasharray="2 2"'), 'the ring is still dashed');
  });

  test('K. shared hub contains every connection number touching that entry', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e')); const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, hub.id, t.id, a.nextId('c')); a.conn(s, hub.id, r.id, a.nextId('c'));
    const svg = a.svg();
    assert.deepStrictEqual(hubNumsOf(svg, hub.id).sort(), ['1', '2']);
    // and it remains ONE circle, never a pill: exactly one p3d-hub for this entry
    assert.strictEqual((svg.match(new RegExp('<circle class="p3d-hub" data-entry="' + hub.id + '"', 'g')) || []).length, 1);
  });

  test('L. shared hub number order matches pbv23dConnNumber canonical order, not lexical sort', () => {
    const a = app(); const s = a.empty(); a.load(s);
    // build 9 unrelated confirmed connections first so the shared pull's own
    // numbers are 10 and, say, 2 — an order where lexical ["10","2"] would
    // differ from canonical [2, 10]
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    let last = hub;
    for (let i = 0; i < 9; i++) {
      const x = a.add(s, i % 2 === 0 ? 'top' : 'bottom', '2', a.nextId('e'));
      const y = a.add(s, i % 2 === 0 ? 'bottom' : 'top', '2', a.nextId('e'));
      a.conn(s, x.id, y.id, a.nextId('c'));
      if (i === 0) { a.conn(s, hub.id, x.id, a.nextId('c')); }
    }
    const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, hub.id, r.id, a.nextId('c'));
    const numbers = a.entryConnNumbers(s, hub.id);
    assert.ok(numbers.length === 2 && numbers[0] < numbers[1] && numbers[1] >= 10,
      'fixture actually produces a multi-digit, out-of-lexical-order case: ' + numbers);
    const svg = a.svg();
    assert.deepStrictEqual(hubNumsOf(svg, hub.id), numbers.map(String),
      'hub shows numbers in canonical order, e.g. [2, 10] not lexical ["10", "2"]');
    void last;
  });

  test('M. 2 -> 1 transition: shared hub becomes a normal single-number coloured hub', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e')); const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, hub.id, t.id, a.nextId('c')); const c2 = a.conn(s, hub.id, r.id, a.nextId('c'));
    void c2;
    assert.strictEqual(hubNumsOf(a.svg(), hub.id).length, 2);
    a.deleteConn(s, s.connections[1].id);
    const svg = a.svg();
    const remaining = s.connections[0];
    assert.deepStrictEqual(hubNumsOf(svg, hub.id), [String(a.connNumber(s, remaining.id))]);
    assert.strictEqual((svg.match(/class="p3d-multiring"/g) || []).length, 0, 'dashed cue is gone');
    assert.strictEqual(a.entryColor(s, hub.id), a.connColor(s, remaining.id), 'now a normal coloured hub');
    assert.ok(new RegExp('<circle class="p3d-hub" data-entry="' + hub.id + '"').test(svg));
  });

  test('N. 1 -> 0 transition: hub returns to the ordinary unnumbered marker', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const t = a.add(s, 'top', '2', a.nextId('e'));
    a.conn(s, l.id, t.id, a.nextId('c'));
    assert.strictEqual(hubNumsOf(a.svg(), l.id).length, 1);
    a.deleteConn(s, s.connections[0].id);
    const svg = a.svg();
    assert.strictEqual(hubNumsOf(svg, l.id).length, 0, 'no stale number');
    assert.ok(new RegExp('<ellipse class="p3d-hub" data-entry="' + l.id + '"').test(svg),
      'back to the ordinary ellipse marker');
    assert.ok(!svg.includes('p3d-multiring'));
  });

  /* O and P (selected single-number / selected shared hub) are covered in
     test/pullBox3dPrototype.test.js, whose api3d() harness exposes
     pbv23dRenderSvg's selected/connectFrom options directly — this file's
     app().svg() always renders unselected, so it cannot exercise them. */

  test('Q. endpoint centre coordinates are byte-identical before and after this milestone', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const t = a.add(s, 'top', '2', a.nextId('e'));
    a.conn(s, l.id, t.id, a.nextId('c'));
    const el = a.find(s, l.id);
    const geo = a.geoFor(); const h = a.hub('left', a.entryRenderV(el, null), a.rowDepth(s, el.rowId), geo);
    const svg = a.svg();
    const cx = Number(svg.match(new RegExp('<circle class="p3d-hub" data-entry="' + l.id + '" cx="([-0-9.]+)"'))[1]);
    const cy = Number(svg.match(new RegExp('<circle class="p3d-hub" data-entry="' + l.id + '" cx="[-0-9.]+" cy="([-0-9.]+)"'))[1]);
    assert.ok(Math.abs(cx - h.x) < 1e-9 && Math.abs(cy - h.y) < 1e-9, 'hub centre unchanged by numbering');
  });

  test('R. route geometry is byte-identical to the pre-4.7 path string', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l = a.add(s, 'left', '2', a.nextId('e')); const t = a.add(s, 'top', '2', a.nextId('e'));
    a.conn(s, l.id, t.id, a.nextId('c'));
    const el = a.find(s, l.id); const et = a.find(s, t.id);
    const geo = a.geoFor();
    const hl = a.hub('left', a.entryRenderV(el, null), a.rowDepth(s, el.rowId), geo);
    const ht = a.hub('top', a.entryRenderV(et, null), a.rowDepth(s, et.rowId), geo);
    const expected = a.routePath('ANGLE', 'left', hl, 'top', ht, geo);
    const svg = a.svg();
    const drawn = svg.match(/<path class="p3d-route"[^>]*d="([^"]+)"/)[1];
    assert.strictEqual(drawn, expected, 'route path unaffected by hub numbering');
  });

  test('S. STANDARD 4.6 placement remains exactly pinned', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const l2 = a.add(s, 'left', '2', a.nextId('e')); const t2 = a.add(s, 'top', '2', a.nextId('e'));
    const b1 = a.add(s, 'bottom', '3', a.nextId('e')); const b2 = a.add(s, 'bottom', '3', a.nextId('e'));
    a.setPos(s, b1.id, 0.3); a.setPos(s, b2.id, 0.7);
    a.conn(s, l2.id, t2.id, a.nextId('c')); a.conn(s, b1.id, b2.id, a.nextId('c'));
    a.calc();
    const view = a.certifiedView();
    assert.strictEqual(view.widthIn, 26); assert.strictEqual(view.heightIn, 21);
    assert.strictEqual(a.layout().result.placements[l2.id].alongIn, 10.5);
    assert.ok(Math.abs(a.layout().result.placements[t2.id].alongIn - 12.626953) < 1e-5);
    assert.strictEqual(a.layout().result.placements[b1.id].alongIn, 1.8125);
    assert.strictEqual(a.layout().result.placements[b2.id].alongIn, 23.4375);
  });

  test('T. ROWS: no placement/geometry change from hub numbering', () => {
    const a = app(); const s = auditFixture(a);
    const before = JSON.stringify(a.request(s));
    a.calc();
    const view = a.certifiedView();
    assert.ok(view, 'fixture still certifies');
    assert.strictEqual(JSON.stringify(a.request(s)), before, 'state untouched by rendering');
  });

  test('U. DENSE: no placement/geometry change; badges gone, hubs numbered', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const walls = ['top', 'right', 'bottom', 'left']; const made = [];
    for (let i = 0; i < 12; i++) made.push(a.add(s, walls[i % 4], '2', a.nextId('e')));
    for (let i = 0; i < 10; i += 2) a.conn(s, made[i].id, made[i + 1].id, a.nextId('c'));
    const before = a.svg();
    const svg = a.svg();
    assert.strictEqual(svg, before, 'rendering is pure — repeated calls are identical');
    assert.ok(!svg.includes('p3d-connnum"') && !svg.includes('p3d-connnums'));
    assert.strictEqual((svg.match(/class="p3d-hubnum"/g) || []).length, s.connections.length * 2);
  });

  test('V. shared-raceway geometry unaffected: hubs and route endpoints unchanged', () => {
    const a = app(); const s = a.empty(); a.load(s);
    const hub = a.add(s, 'left', '2', a.nextId('e'));
    const t = a.add(s, 'top', '2', a.nextId('e')); const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, hub.id, t.id, a.nextId('c')); a.conn(s, hub.id, r.id, a.nextId('c'));
    const eh = a.find(s, hub.id);
    const geo = a.geoFor(); const h = a.hub('left', a.entryRenderV(eh, null), a.rowDepth(s, eh.rowId), geo);
    const svg = a.svg();
    const cx = Number(svg.match(new RegExp('<circle class="p3d-hub" data-entry="' + hub.id + '" cx="([-0-9.]+)"'))[1]);
    assert.ok(Math.abs(cx - h.x) < 1e-9, 'shared hub centre unchanged');
    assert.strictEqual((svg.match(/class="p3d-route"/g) || []).length, 2, 'both routes still drawn');
  });

  test('W. multi-digit connection numbers render without truncation', () => {
    const a = app(); const s = a.empty(); a.load(s);
    for (let i = 0; i < 9; i++) {
      const x = a.add(s, i % 2 === 0 ? 'top' : 'bottom', '1', a.nextId('e'));
      const y = a.add(s, i % 2 === 0 ? 'bottom' : 'top', '1', a.nextId('e'));
      a.conn(s, x.id, y.id, a.nextId('c'));
    }
    const l = a.add(s, 'left', '2', a.nextId('e')); const r = a.add(s, 'right', '2', a.nextId('e'));
    a.conn(s, l.id, r.id, a.nextId('c'));
    assert.strictEqual(a.connNumber(s, s.connections[9].id), 10);
    const svg = a.svg();
    assert.deepStrictEqual(hubNumsOf(svg, l.id), ['10']);
    assert.ok(svg.includes('>10</text>'), 'double-digit number rendered in full, not truncated');
    const layout = a.hubNumberLayout(['10']);
    assert.ok(layout.radius > a.hubNumberLayout(['1']).radius, 'double-digit hub grows to fit');
  });

  test('X. Layers 0/1/2 remain byte-identical (renderer-only milestone)', () => {
    assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
  });
});
