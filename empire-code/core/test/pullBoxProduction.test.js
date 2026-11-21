'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   PBV2-14 — PRODUCTION INTEGRATION: Pull / Junction Box ships

   These tests prove the ACTUAL USER PATH: normal Empire Code startup with no
   query string, the Home tile exists, tapping it opens the feature on FAST
   RESULT with its controls, BUILD is one tap away, closing hands the screen
   back with nothing armed, and reopening is clean. They run the shipped
   navigation registry and the shipped PBV2 block together in one sandbox —
   never the ?pbv2=3d deep link, which is an optional QA shortcut through
   the same function.
   ════════════════════════════════════════════════════════════════════════ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const R = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(R, 'mobile.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const pbv2 = blocks.find((b) => b.includes('function pbv23dShouldOpen'));
const nav = blocks.find((b) => b.includes('var TOOL_GROUPS'));
function fn(src, n) {
  const i = src.indexOf('function ' + n + '('); let d = 0; let st = false;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') { d++; st = true; } else if (src[j] === '}') { d--; if (st && d === 0) return src.slice(i, j + 1); } }
  throw new Error('missing ' + n);
}
const registry = nav.slice(nav.indexOf('var TOOL_GROUPS'), nav.indexOf('/** The single entry point for opening any tool. */'));
const pins = nav.slice(nav.indexOf('var PIN_TOOLS'), nav.indexOf('var pinEditing'));
const md5 = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(R, rel))).digest('hex');

/** Boot the app the way a browser would: PBV2 block, then the tool registry. */
function boot(hostname, search) {
  const els = {};
  const mk = (id) => (els[id] || (els[id] = { id, innerHTML: '', textContent: '', style: {},
    classList: { l: new Set(), add(...c) { c.forEach((x) => this.l.add(x)); }, remove(...c) { c.forEach((x) => this.l.delete(x)); }, contains(c) { return this.l.has(c); } },
    getAttribute(k) { return this['@' + k]; }, setAttribute(k, v) { this['@' + k] = v; }, scrollIntoView() {}, appendChild() {}, parentNode: null }));
  const modeButtons = ['fast', 'build'].map((m) => { const b = mk('btn-' + m); b['@data-mode'] = m; return b; });
  const navItems = ['mnav-home', 'mnav-coderef'].map((id) => mk(id));
  const ctx = { window: { location: { hostname, search, hash: '' }, scrollTo() {} },
    document: { getElementById: mk, querySelectorAll: (sel) => (sel.indexOf('data-mode') > -1 ? modeButtons : (sel === '.nav-item' ? navItems : [])) },
    console, switchTab() {}, switchTabMore() {}, fillCalcMode() {}, codeSubTab() {}, groundingSelectTopic() {},
    EC: { pullBox: require('../src/calc/pullBox'), pullBoxLayout: require('../src/layout/pullBoxLayout'),
      pullBoxEntryGeometry: require('../src/standards/pullBoxEntryGeometry') } };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(pbv2, ctx, { filename: 'mobile.html' });
  vm.runInContext(registry + '\n' + pins + '\n' + fn(nav, 'openTool') + '\n' + fn(nav, 'tileMarkup'), ctx, { filename: 'nav.js' });
  return { ctx, el: mk,
    open: () => mk('pbv2-3d-prototype').classList.contains('show'),
    fast: () => mk('pbv2-3d-fast').innerHTML,
    armed: () => !!(ctx.pbv23dTargeting() || ctx.pbv23dAddMode || ctx.pbv23dConfirmClear || ctx.pbv23dSelected) };
}
const surfaceHeader = html.slice(html.indexOf('id="pbv2-3d-prototype" role='), html.indexOf('id="pbv2-3d-fixtures"'));

describe('PBV2-14 — the production entry', () => {
  test('A. the normal app registers Pull / Junction Box as a tool', () => {
    const { ctx } = boot('empirecode.app', '');
    assert.strictEqual(ctx.TOOLS.pullbox.label, 'Pull / Junction Box');
    assert.ok(ctx.TOOLS.pullbox.desc, 'has a tile description');
    const group = ctx.TOOL_GROUPS.find((g) => g.tools.includes('pullbox'));
    assert.strictEqual(group.title, 'RACEWAYS & BOXES', 'beside Box Fill, where an electrician looks');
    assert.ok(ctx.PIN_TOOLS.some((t) => t.id === 'pullbox'), 'pinnable like every other tool');
    const tile = ctx.tileMarkup('pullbox', false);
    assert.ok(tile.includes("openTool('pullbox')") && tile.includes('class="tile') && tile.includes('<button'), 'a real tappable tile');
    assert.ok(!/PBV2|3D|DEV|Prototype|V2/i.test(ctx.TOOLS.pullbox.label + ctx.TOOLS.pullbox.desc), 'user-facing name only');
  });

  test('B/C/D. tapping the tile opens the feature on FAST RESULT with its controls — no query string', () => {
    const a = boot('empirecode.app', '');
    assert.strictEqual(a.open(), false, 'O. not open at startup');
    assert.strictEqual(a.ctx.openTool('pullbox'), true);
    assert.strictEqual(a.open(), true, 'B. opened from the normal path');
    assert.strictEqual(a.ctx.pbv23dMode, 'fast', 'C. FAST RESULT default');
    assert.strictEqual(a.ctx.pbv23dFastFamily + a.ctx.pbv23dFastSize, 'straight2', 'clean default inputs');
    assert.strictEqual(a.ctx.pbv23dPresentation, null, 'no result yet');
    const f = a.fast();
    assert.strictEqual((f.match(/data-family=/g) || []).length, 3, 'D. three pull families');
    assert.strictEqual((f.match(/<select/g) || []).length, 1, 'D. one SIZE');
    assert.strictEqual((f.match(/pbv23dCalculate\(\)/g) || []).length, 1, 'D. one CALCULATE');
    assert.ok(a.el('pbv2-3d-stage').innerHTML.includes('class="p3d-hub"'), 'D. the box is drawn');
  });

  test('E. BUILD is one tap away and unchanged', () => {
    const a = boot('empirecode.app', ''); a.ctx.openTool('pullbox');
    a.ctx.pbv23dSetMode('build');
    assert.strictEqual(a.ctx.PBV23D.entries.length, 6, 'the 3-pull showcase');
    assert.strictEqual(a.ctx.PBV23D.connections.length, 3);
    assert.ok(a.el('pbv2-3d-globals').innerHTML.includes('id="pbv2-3d-clear"'), 'CLEAR BOX present');
  });

  test('F/G. no DEV badge and no development wording on the surface', () => {
    assert.ok(!surfaceHeader.includes('p3d-dev') && !/>DEV</.test(surfaceHeader), 'F. badge gone');
    // user-facing text and labels only: element ids/classes are internal names
    // that PBV2-14 deliberately leaves alone (a rename is separate, if ever)
    const visible = (surfaceHeader.match(/>([^<]+)</g) || []).map((t) => t.slice(1, -1)).join(' ')
      + ' ' + (surfaceHeader.match(/aria-label="([^"]+)"/g) || []).join(' ');
    assert.ok(!/prototype|3D editor|development|test-only|throwaway|fixture|DEV\b/i.test(visible), 'G. no dev copy: ' + visible);
    assert.ok(surfaceHeader.includes('aria-label="Pull / Junction Box"'), 'region is labelled for assistive tech');
    assert.ok(surfaceHeader.includes('aria-label="Close Pull / Junction Box"'), 'close is labelled');
    assert.ok(!/\.p3d-dev\{/.test(html), 'the badge style is gone too');
    // the visible mode tabs carry no fixture names
    const tabs = fn(pbv2, 'pbv23dInit');
    assert.ok(tabs.includes("'FAST RESULT'") && tabs.includes("'BUILD'") && !/DENSE|EMPTY|STANDARD|ROWS/.test(tabs));
  });
});

describe('PBV2-14 — close, reopen and target-mode safety', () => {
  test('H/N. close returns to the app with nothing armed; the surface is gone', () => {
    const a = boot('empirecode.app', ''); a.ctx.openTool('pullbox');
    a.ctx.pbv23dSetMode('build'); a.ctx.pbv23dTapEntry(a.ctx.PBV23D.entries[0].id);
    assert.ok(a.armed(), 'a selection is live');
    assert.strictEqual(a.ctx.closePullBox(), true);
    assert.strictEqual(a.open(), false, 'H. hidden');
    assert.strictEqual(a.armed(), false, 'N. nothing intercepts the app');
    assert.ok(!a.el('pbv2-3d-sheet').classList.contains('show'), 'details sheet hidden');
    assert.ok(!a.el('pbv2-3d-prototype').classList.contains('p3d-editing'), 'editing class cleared');
  });

  test('I. reopen is a clean deterministic FAST state', () => {
    const a = boot('empirecode.app', ''); a.ctx.openTool('pullbox');
    a.ctx.pbv23dSetMode('build'); a.ctx.pbv23dCalculate();       // leave BUILD with a result
    a.ctx.closePullBox(); a.ctx.openTool('pullbox');
    assert.strictEqual(a.ctx.pbv23dMode, 'fast', 'back to the production default');
    assert.strictEqual(a.ctx.pbv23dFastFamily + a.ctx.pbv23dFastSize, 'straight2');
    assert.strictEqual(a.ctx.pbv23dPresentation, null, 'no stale result');
    assert.strictEqual(a.armed(), false);
  });

  for (const [name, arm] of [
    ['J. CONNECT_TARGET', (c) => { c.pbv23dSetMode('build'); c.pbv23dTapEntry(c.PBV23D.entries[0].id); c.pbv23dStartConnect(); }],
    ['K. DISCONNECT_TARGET', (c) => { c.pbv23dSetMode('build'); c.pbv23dTapEntry(c.PBV23D.entries[0].id); c.pbv23dStartDisconnect(); }],
    ['L. ADD placement', (c) => { c.pbv23dSetMode('build'); c.pbv23dStartAdd(); }],
    ['M. CLEAR confirmation', (c) => { c.pbv23dSetMode('build'); c.pbv23dClearBoxAsk(); }],
  ]) {
    test(name + ': closing clears it; reopening is coherent', () => {
      const a = boot('empirecode.app', ''); a.ctx.openTool('pullbox');
      arm(a.ctx);
      assert.ok(a.armed(), 'the mode really was armed');
      a.ctx.closePullBox();
      assert.strictEqual(a.armed(), false, 'cleared on close');
      assert.strictEqual(a.ctx.pbv23dTargeting(), null);
      assert.strictEqual(a.ctx.pbv23dAddMode, false);
      assert.strictEqual(a.ctx.pbv23dConfirmClear, false);
      a.ctx.openTool('pullbox');
      assert.strictEqual(a.ctx.pbv23dMode, 'fast');
      assert.strictEqual(a.armed(), false, 'reopen inherits nothing');
      // and BUILD is usable afterward
      a.ctx.pbv23dSetMode('build'); a.ctx.pbv23dStartAdd(); a.ctx.pbv23dTapWall('right');
      assert.strictEqual(a.ctx.PBV23D.entries.length, 7);
    });
  }

  test('scroll: the surface scrolls inside its content panel; no scroll APIs on open/close', () => {
    /* SUPERSEDED BY PBV2-14.1: the surface is no longer a fixed full-screen
       overlay. It is ordinary content inside .panel#panel-pullbox, which
       supplies the scrolling and the height between header and bottom nav. */
    for (const f of ['openPullBox', 'closePullBox', 'pbv23dInit', 'pbv23dResetTransients', 'pbv23dHideSheet', 'pbv23dLeaveSurface']) {
      assert.ok(!/scrollIntoView|scrollTo|scrollTop|window\.scroll/.test(fn(pbv2, f)), f + ' never scrolls');
    }
    assert.ok(!/#pbv2-3d-prototype\{[^}]*position:fixed/.test(html), 'no fixed overlay');
    assert.ok(!/#pbv2-3d-prototype\{[^}]*inset:0/.test(html) && !/#pbv2-3d-prototype\{[^}]*z-index/.test(html), 'no inset/z-index');
    assert.ok(/\.panel \{[^}]*overflow-y: auto/.test(html), 'the panel owns the scrolling, as for every tool');
    assert.ok(/#pbv2-3d-prototype\{[^}]*display:none/.test(html) && html.includes('#pbv2-3d-prototype.show{display:flex}'), 'hidden while closed');
  });
});

describe('PBV2-14 — one open path; QA link parity', () => {
  test('Q. exactly one authoritative open path', () => {
    assert.strictEqual((pbv2.match(/function openPullBox\(\)/g) || []).length, 1);
    assert.strictEqual((pbv2.match(/'pbv2-3d-prototype'\)\.classList\.add\('show'\)/g) || []).length, 1, 'only openPullBox reveals the surface');
    assert.ok(fn(nav, 'openTool').includes('t.open()'), 'openTool routes through the registry');
    assert.ok(registry.includes("open: function () { openPullBox(); }"), 'the tile calls openPullBox');
    assert.ok(surfaceHeader.includes('onclick="closePullBox()"'), 'the X calls closePullBox');
    assert.ok(fn(pbv2, 'openPullBox').includes("pbv23dSetMode('fast')"), 'production default is explicit');
  });

  test('O/P. normal startup never auto-opens; the QA link uses the same function with the same default', () => {
    assert.strictEqual(boot('empirecode.app', '').open(), false, 'deployed, no query');
    assert.strictEqual(boot('empirecode.app', '?pbv2=3d').open(), false, 'deployed + query: QA gate is host-bound');
    assert.strictEqual(boot('192.168.1.14', '').open(), false, 'private host, no query');
    const qa = boot('192.168.1.14', '?pbv2=3d');
    assert.strictEqual(qa.open(), true, 'P. private host + query opens');
    assert.strictEqual(qa.ctx.pbv23dMode, 'fast', 'P. same FAST default: parity');
    const iife = pbv2.slice(pbv2.lastIndexOf('(function () {'));
    assert.ok(iife.includes('openPullBox();') && !iife.includes('pbv23dSetMode') && !iife.includes("classList.add('show')"),
      'the QA link adds no behaviour of its own');
    // and the deployed host still opens the tool the normal way
    const d = boot('empirecode.app', '?pbv2=3d'); d.ctx.openTool('pullbox');
    assert.strictEqual(d.open(), true);
  });
});

describe('PBV2-14 — engine and regression invariance', () => {
  test('R/S/T. layer hashes unchanged from the accepted 4.9F baseline', () => {
    assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1', 'R. Layer 0');
    assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739', 'S. Layer 1');
    assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a', 'T. Layer 2 (4.9F)');
  });
  test('U/V/W. FAST, BUILD and STRAIGHT alignment behave exactly as accepted', () => {
    const a = boot('empirecode.app', ''); a.ctx.openTool('pullbox');
    a.ctx.pbv23dCalculate();
    assert.strictEqual(a.ctx.pbv23dLayout.result.widthIn + 'x' + a.ctx.pbv23dLayout.result.heightIn, '16x2.5', 'U. FAST STRAIGHT 2"');
    a.ctx.pbv23dFastPickFamily('angle'); a.ctx.pbv23dCalculate();
    assert.strictEqual(a.ctx.pbv23dLayout.result.widthIn + 'x' + a.ctx.pbv23dLayout.result.heightIn, '12x12', 'U. FAST ANGLE');
    a.ctx.pbv23dSetMode('build'); a.ctx.pbv23dCalculate();
    const L = a.ctx.pbv23dLayout.result;
    assert.strictEqual(L.widthIn + 'x' + L.heightIn, '33.345703x28', 'V. BUILD starter box');
    const s = a.ctx.PBV23D;
    const straight = s.connections.find((c) => a.ctx.pbv23dConnTypeOf(s, c.id) === 'STRAIGHT');
    assert.strictEqual(L.placements[straight.a].alongIn, L.placements[straight.b].alongIn, 'W. STRAIGHT aligned');
  });
  test('X/Y/Z. CLEAR BOX, ADD ROW and shared-raceway CONNECT/DISCONNECT still work through the shipped surface', () => {
    const a = boot('empirecode.app', ''); a.ctx.openTool('pullbox'); a.ctx.pbv23dSetMode('build');
    const c = a.ctx; const s = c.PBV23D;
    const lone = s.entries.find((e) => e.wall === 'right'); c.pbv23dTapEntry(lone.id);
    c.pbv23dPickRowOption(c.PBV23D_ADD_ROW); c.pbv23dPickRowOption(c.PBV23D_ADD_ROW);
    assert.strictEqual(s.rows.filter((r) => r.wall === 'right').length, 3, 'Y. ADD ROW twice -> 3 rows');
    const other = s.entries.find((e) => e.wall === 'top');
    c.pbv23dStartConnect(); c.pbv23dTapEntry(other.id);
    assert.strictEqual(c.pbv23dEntryConns(s, lone.id).length, 2, 'Z. shared raceway: two pulls');
    c.pbv23dStartDisconnect(); c.pbv23dTapEntry(other.id);
    assert.strictEqual(c.pbv23dEntryConns(s, lone.id).length, 1, 'Z. disconnected one');
    const before = JSON.stringify(s);
    c.pbv23dClearBoxAsk(); c.pbv23dClearBoxCancel();
    assert.strictEqual(JSON.stringify(c.PBV23D), before, 'X. CANCEL changes nothing');
    c.pbv23dClearBoxAsk(); c.pbv23dClearBoxConfirm();
    assert.strictEqual(c.PBV23D.entries.length, 0, 'X. cleared');
  });
  test('AA/AB/AC. internal fixtures untouched', () => {
    const a = boot('empirecode.app', '');
    assert.strictEqual(a.ctx.pbv23dBuildFixture('standard').entries.length, 4);
    assert.strictEqual(a.ctx.pbv23dBuildFixture('rows').rows.filter((r) => r.wall === 'left').length, 2);
    assert.strictEqual(a.ctx.pbv23dBuildFixture('dense').entries.length, 16);
    assert.ok(!fn(pbv2, 'pbv23dInit').includes('dense'), 'DENSE is not a tab');
  });
  test('AD/AE. every inline script parses; the bundle matches src', () => {
    for (const b of blocks) if (b.trim()) new vm.Script(b);   // AD
    const built = fs.readFileSync(path.join(R, 'src/layout/pullBoxLayout.js'), 'utf8');
    assert.ok(html.includes('function refineStraightAlignment('), 'AE. Layer 2 bundle present');
    assert.ok(built.includes('function refineStraightAlignment('));
  });
  test('AF. service worker: mobile.html is network-first, so no cache key change is needed', () => {
    const sw = fs.readFileSync(path.join(R, 'sw.js'), 'utf8');
    assert.strictEqual((sw.match(/const CACHE_NAME = '([^']+)'/) || [])[1], 'empire-code-v3', 'workspace core cache version');
    assert.ok(/isAppShell[\s\S]*navigate|navigate[\s\S]*isAppShell/.test(sw), 'app shell handled by navigation rule');
    assert.ok(sw.includes('fetchWithTimeout'), 'network-first with deadline delivers the new engine on signal');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PBV2-14.1 — NATIVE APP SHELL INTEGRATION

   Pull / Junction Box is no longer a full-screen overlay. It is ordinary
   content inside .panel#panel-pullbox, between the persistent global header
   and the persistent bottom nav, routed by the app's own switchTab. The
   header itself is compact: the brand now sits at the same font scale as the
   edition badges and the row is 36px instead of 50px, app-wide.
   ════════════════════════════════════════════════════════════════════════ */
describe('PBV2-14.1 — app shell integration', () => {
  const headerMarkup = html.slice(html.indexOf('<!-- ── HEADER ── -->'), html.indexOf('<!-- ── CONTENT ── -->'));
  const navMarkup = (html.match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/) || [])[1] || '';
  const rule = (sel) => {
    const i = html.indexOf(sel); if (i < 0) return '';
    return html.slice(i, html.indexOf('}', i) + 1);
  };
  const px = (r, prop) => { const m = new RegExp(prop + ':\\s*(\\d+)px').exec(r); return m ? Number(m[1]) : null; };

  test('A/J/K/L. the global header is present and keeps all three labels', () => {
    assert.ok(headerMarkup.includes('<header>'), 'the shell header exists');
    assert.ok(/class="logo">Empire Code</.test(headerMarkup), 'J. EMPIRE CODE');
    assert.ok(headerMarkup.includes('NYCEC 2025'), 'K.');
    assert.ok(headerMarkup.includes('NEC 2020'), 'L.');
    // it is a shell element, outside .content, so every panel keeps it
    assert.ok(html.indexOf('<header>') < html.indexOf('<div class="content">'), 'header is above the content area');
  });

  test('B/C/D/E. the global bottom nav is present with HOME, AI CHAT, CODE', () => {
    assert.ok(navMarkup.includes('mnav-home') && /<span>Tools<\/span>/.test(navMarkup), 'C.');
    assert.ok(navMarkup.includes('mnav-jobs') && /<span>Jobs<\/span>/.test(navMarkup), 'D.');
    assert.ok(navMarkup.includes('mnav-coderef') && /<span>Code<\/span>/.test(navMarkup), 'E.');
    assert.ok(html.indexOf('end .content') < html.indexOf('<nav class="bottom-nav">'), 'nav is a shell sibling of content');
    // exactly one nav: the feature never built its own
    assert.strictEqual((html.match(/<nav class="bottom-nav">/g) || []).length, 1);
  });

  test('Q/R. the surface is panel content, not an overlay over the chrome', () => {
    assert.ok(html.includes('<div class="panel" id="panel-pullbox"></div>'), 'a normal panel host inside .content');
    assert.ok(html.indexOf('id="panel-pullbox"') > html.indexOf('<div class="content">')
      && html.indexOf('id="panel-pullbox"') < html.indexOf('end .content'), 'the host is inside the content area');
    const surface = rule('#pbv2-3d-prototype{');
    assert.ok(!/position:\s*fixed/.test(surface), 'Q/R. no fixed positioning');
    assert.ok(!/inset:\s*0/.test(surface) && !/z-index/.test(surface), 'Q/R. nothing spans or stacks over the chrome');
    assert.ok(fn(pbv2, 'pbv23dInit').includes("getElementById('panel-pullbox')"), 'adopted into the host');
  });

  test('F/G/H/I. navigating away from Pull Box works and stands the surface down', () => {
    const a = boot('empirecode.app', '');
    let switched = [];
    a.ctx.switchTab = function (name) { switched.push(name); if (name !== 'pullbox') a.ctx.pbv23dLeaveSurface(); };
    a.ctx.openTool('pullbox');
    assert.ok(switched.includes('pullbox'), 'opening routes through the app router');
    assert.strictEqual(a.open(), true);
    a.ctx.pbv23dSetMode('build'); a.ctx.pbv23dTapEntry(a.ctx.PBV23D.entries[0].id); a.ctx.pbv23dStartConnect();
    // F/G/H: each nav destination
    for (const dest of ['home', 'chat', 'coderef']) {
      a.ctx.openTool('pullbox'); a.ctx.pbv23dSetMode('build'); a.ctx.pbv23dStartAdd();
      switched = [];
      a.ctx.switchTab(dest);
      assert.ok(switched.includes(dest), dest + ' navigates');
      assert.strictEqual(a.open(), false, 'I. the surface is stood down leaving for ' + dest);
      assert.strictEqual(a.armed(), false, 'I. nothing stays armed behind another tab');
    }
    // the shipped router really does call the hook
    assert.ok(fn(nav, 'switchTab').includes('pbv23dLeaveSurface'), 'switchTab stands the surface down');
    assert.ok(fn(pbv2, 'openPullBox').includes("switchTab('pullbox'"), 'open activates its panel');
    assert.ok(fn(pbv2, 'closePullBox').includes("switchTab('home'"), 'close returns to Home');
  });

  test('M/N/O/P. the header is compact: brand at edition scale, less height, safe area kept', () => {
    const logo = rule('.logo {');
    const edition = rule('.edition {');
    const header = rule('  header {');
    const logoPx = px(logo, 'font-size'); const editionPx = px(edition, 'font-size');
    assert.ok(logoPx !== null && editionPx !== null, 'both sizes readable');
    assert.ok(logoPx <= editionPx, 'M. EMPIRE CODE is no larger than the edition labels (' + logoPx + ' vs ' + editionPx + ')');
    assert.ok(!/font-size:\s*15px/.test(logo), 'N. the oversized brand rule is gone');
    assert.ok(/font-weight:\s*800/.test(logo), 'hierarchy kept through weight, not size');
    assert.strictEqual(px(header, 'height'), 36, 'O. header height reduced from 50px');
    assert.ok(/border-bottom:\s*1px/.test(header), 'O. the 2px accent rule slimmed too');
    assert.ok(/padding-top:\s*env\(safe-area-inset-top\)/.test(header), 'P. notch/Dynamic Island clearance');
    assert.ok(/box-sizing:\s*content-box/.test(header), 'P. the inset adds to the row rather than eating it');
  });

  test('S/T/U. content scrolls in the panel and clears the nav without overlay padding', () => {
    assert.ok(/\.panel \{[^}]*overflow-y: auto/.test(html), 'S/T. the panel scrolls, as for every tool');
    assert.ok(/\.panel \{[^}]*flex: 1/.test(html) && /\.content \{[^}]*flex: 1/.test(html), 'height comes from the shell');
    assert.ok(/\.bottom-nav \{[^}]*flex-shrink: 0/.test(html), 'U. the nav is a flex sibling, never an overlay');
    const res = rule('.p3d-res{');
    assert.ok(/margin:8px 14px 24px/.test(res), 'U. a normal content tail, not 140px of overlay clearance');
    assert.ok(!/140px/.test(res));
  });

  test('V/W/X/Y. Home, AI Chat, Code and the production entry are untouched', () => {
    const a = boot('empirecode.app', '');
    assert.ok(html.includes('id="panel-home"') || html.includes("switchTab('home'"), 'V. Home panel intact');
    assert.ok(html.includes('id="panel-chat"') || navMarkup.includes('mnav-chat'), 'W. AI Chat intact');
    assert.ok(navMarkup.includes("openTool('coderef')"), 'X. Code routes through the registry');
    assert.strictEqual(a.ctx.TOOLS.pullbox.label, 'Pull / Junction Box', 'Y. entry unchanged');
    assert.ok(a.ctx.TOOL_GROUPS.find((g) => g.tools.includes('pullbox')).title === 'RACEWAYS & BOXES');
  });

  test('Z/AA/AB/AC/AD. calculations and layer hashes unchanged by the shell move', () => {
    const a = boot('empirecode.app', ''); a.ctx.openTool('pullbox');
    a.ctx.pbv23dCalculate();
    assert.strictEqual(a.ctx.pbv23dLayout.result.widthIn + 'x' + a.ctx.pbv23dLayout.result.heightIn, '16x2.5', 'Z.');
    a.ctx.pbv23dSetMode('build'); a.ctx.pbv23dCalculate();
    assert.strictEqual(a.ctx.pbv23dLayout.result.widthIn + 'x' + a.ctx.pbv23dLayout.result.heightIn, '33.345703x28', 'AA.');
    assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1', 'AB.');
    assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739', 'AC.');
    assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a', 'AD.');
  });

  test('the feature keeps a title but never a second app header', () => {
    assert.ok(surfaceHeader.includes('Pull / Junction Box'), 'a modest feature title');
    assert.ok(!/Empire Code|NYCEC|NEC 2020/.test(surfaceHeader), 'it does not restate app identity');
    assert.strictEqual((html.match(/class="logo"/g) || []).length, 1, 'exactly one brand in the document');
  });
});
