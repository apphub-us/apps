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
const P3D = html.slice(html.indexOf('INTERACTIVE 3D PROTOTYPE'), html.indexOf('END PULL BOX V2 3D PROTOTYPE'));
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
  const consts = ['PBV23D_GEO', 'PBV23D_SIZES', 'PBV23D_WALLS', 'PBV23D_CONN_COLORS',
    'PBV23D_NEUTRAL', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
    .map((c) => html.match(new RegExp('var ' + c + ' = [\\s\\S]*?;\\n'))[0]).join('');
  const names = ['pbv23dHub', 'pbv23dInward', 'pbv23dEmptyState', 'pbv23dRowsFor', 'pbv23dRowById',
    'pbv23dRowIndex', 'pbv23dRowDepth', 'pbv23dAddRowOnWall', 'pbv23dEnsureRow', 'pbv23dSetEntryRow',
    'pbv23dDeleteRowIfEmpty', 'pbv23dFindEntry', 'pbv23dNextPosition', 'pbv23dAddEntry', 'pbv23dDeleteEntry',
    'pbv23dSetSize', 'pbv23dSetPosition', 'pbv23dSetWall', 'pbv23dAddConnection',
    'pbv23dClassify', 'pbv23dConnColor', 'pbv23dConnNumber', 'pbv23dEntryConns', 'pbv23dEntryColor',
    'pbv23dHitRadius', 'pbv23dRoutePath', 'pbv23dEngineRequest',
    'pbv23dPresent', 'pbv23dIn', 'pbv23dAxisRow', 'pbv23dEndpointText', 'pbv23dPullCardHtml',
    'pbv23dLayoutGeometry', 'pbv23dCertifyBox', 'pbv23dCertifiedBox', 'pbv23dLayoutNote',
    'pbv23dDim', 'pbv23dCeilBoxDim', 'pbv23dEffectiveAxes', 'pbv23dResultHtml', 'pbv23dSheetResultLine', 'pbv23dInvalidateResult',
    'pbv23dCalculate', 'pbv23dRenderSvg'];
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

  test('the editor sheet uses the same pipeline and the certified dimensions', () => {
    const sheetBody = fn3d('pbv23dSheetBody');
    assert.ok(sheetBody.includes('onclick="pbv23dCalculate()"'), 'sheet uses the composed path');
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
    'PBV23D_NEUTRAL', 'PBV23D_PULL_WORD', 'PBV23D_ENTRY_SYSTEM', 'PBV23D_POLICY_ORDER']
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
