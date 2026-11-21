'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   EC-UI — DESIGN SYSTEM STRUCTURAL SAFETY

   Part 1 (written BEFORE the Phase-1 visual edits, and green on the
   untouched build): structural counts for the shell, Home and every
   calculator panel. A visual migration must never remove a control,
   a tile, a heading or a nav item, and these tests are how that is proven
   rather than eyeballed. No pixels are asserted anywhere in this file.

   Part 2 (Phase 1): the shared tokens and primitives exist once, Home and
   the shell consume them, and nothing else was restyled by accident.
   ════════════════════════════════════════════════════════════════════════ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const R = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(R, 'mobile.html'), 'utf8');
const cnt = (s, re) => (s.match(re) || []).length;
const md5 = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(R, rel))).digest('hex');

const HEADER = html.slice(html.indexOf('<!-- ── HEADER ── -->'), html.indexOf('<!-- ── CONTENT ── -->'));
const NAV = (html.match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/) || ['', ''])[1];
const HOME = html.slice(html.indexOf('<!-- ══ HOME ══ -->'), html.indexOf('<!-- ══', html.indexOf('<!-- ══ HOME ══ -->') + 10));
const GLOBAL_CSS = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const P3D_CSS = (() => { const i = html.indexOf('PULL / JUNCTION BOX — PRODUCTION FEATURE'); return html.slice(html.indexOf('<style>', i), html.indexOf('</style>', i)); })();
const panel = (id) => { const i = html.indexOf('id="' + id + '"'); const j = html.indexOf('<div class="panel"', i + 10); return html.slice(i, j < 0 ? i + 60000 : j); };
const rule = (css, sel) => { const i = css.indexOf(sel); return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1); };

/** Boot the tool registry the way navigation.test.js does: real code, DOM stub. */
function bootRegistry() {
  const nav = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).find((b) => b.includes('var TOOL_GROUPS'));
  const fn = (n) => { const i = nav.indexOf('function ' + n + '('); let d = 0; let st = false; for (let j = i; j < nav.length; j++) { if (nav[j] === '{') { d++; st = true; } else if (nav[j] === '}') { d--; if (st && d === 0) return nav.slice(i, j + 1); } } };
  const registry = nav.slice(nav.indexOf('var TOOL_GROUPS'), nav.indexOf('/** The single entry point for opening any tool. */'));
  const pins = nav.slice(nav.indexOf('var PIN_TOOLS'), nav.indexOf('var pinEditing'));
  const els = {}; const mk = (id) => (els[id] || (els[id] = { id, innerHTML: '', classList: { l: new Set(), add(c) { this.l.add(c); }, remove(c) { this.l.delete(c); }, contains(c) { return this.l.has(c); } } }));
  const ctx = { document: { getElementById: mk, querySelectorAll: () => [] }, console, switchTab() {}, switchTabMore() {}, fillCalcMode() {}, codeSubTab() {}, groundingSelectTopic() {}, openPullBox() { return true; } };
  vm.createContext(ctx);
  vm.runInContext(registry + '\n' + pins + '\n' + fn('openTool') + '\n' + fn('tileMarkup') + '\n' + fn('homeRender'), ctx);
  ctx.homeRender();
  return { ctx, homeHtml: mk('homeGroups').innerHTML };
}

/* ── PART 1 — structural baseline (recorded on the pre-Phase-1 build) ─── */
const BASELINE = {
  shell: { editions: 2, logo: 1, headerButtons: 0, navItems: 3, navLabels: 'Jobs/Tools/Code', navSvgs: 3 },
  home: { tools: 12, ids: 'wiresizer,ampacity,loadcalc,conduit,wireway,boxfill,pullbox,motor,grounding,outlets,bender,converter', pinTools: 12, groups: 4, staticButtons: 5 },
  panels: {
    'panel-wiresizer': [10, 3, 1], 'panel-conduit': [5, 0, 5], 'panel-ampacity': [8, 0, 3], 'panel-boxfill': [5, 4, 7],   // EC-CALC-1: EGC select -> count input + size select; ring select -> decimal input. EC-CALC-1B: + ring/raised-cover select, + 6 ⓘ help buttons (Reset makes 7)
    'sub-loadcalc': [16, 17, 11], 'sub-motor': [12, 17, 3], 'sub-bender': [6, 16, 2], 'sub-converter': [4, 16, 1],
    'sub-outlets': [13, 17, 3], 'sub-coderef': [14, 17, 9], 'panel-chat': [0, 0, 4],
  },
};

describe('EC-UI structural safety — global shell', () => {
  test('P/Q/R. header and bottom-nav markup keep every element', () => {
    assert.strictEqual(cnt(HEADER, /class="edition /g), BASELINE.shell.editions, 'edition badges');
    assert.strictEqual(cnt(HEADER, /class="logo"/g), BASELINE.shell.logo, 'one brand');
    assert.ok(HEADER.includes('NYCEC 2025') && HEADER.includes('NEC 2020') && /class="logo">Empire Code</.test(HEADER));
    assert.strictEqual(cnt(NAV, /class="nav-item/g), BASELINE.shell.navItems, 'nav items');
    assert.strictEqual([...NAV.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]).join('/'), BASELINE.shell.navLabels, 'R. HOME / AI CHAT / CODE');
    assert.strictEqual(cnt(NAV, /<svg/g), BASELINE.shell.navSvgs, 'icons intact');
    assert.ok(NAV.includes("switchTab('home',this)") && NAV.includes("ecJobsOpen()") && NAV.includes("openTool('coderef')"), 'S. routing unchanged');
  });
  test('T/U. header stays compact with its safe-area rule', () => {
    const header = rule(GLOBAL_CSS, '  header {');
    assert.ok(/height:\s*36px/.test(header), 'T. 36px, not taller');
    assert.ok(/padding-top:\s*env\(safe-area-inset-top\)/.test(header), 'U. notch clearance');
    assert.ok(/padding-bottom:\s*env\(safe-area-inset-bottom\)/.test(rule(GLOBAL_CSS, '.bottom-nav {')), 'U. nav safe area');
    assert.ok(/height:\s*var\(--nav-h\)/.test(rule(GLOBAL_CSS, '.bottom-nav {')), 'nav height unchanged');
  });
});

describe('EC-UI structural safety — Home', () => {
  test('J/K/L/M. tool count, ids, order, grouping, routing and pins are unchanged', () => {
    const { ctx, homeHtml } = bootRegistry();
    const ids = ctx.TOOL_GROUPS.flatMap((g) => g.tools);
    assert.strictEqual(ids.length, BASELINE.home.tools, 'J.');
    assert.strictEqual(ids.join(','), BASELINE.home.ids, 'K. same ids in the same order');
    assert.strictEqual(ctx.TOOL_GROUPS.length, BASELINE.home.groups, 'four groups');
    assert.strictEqual(ctx.PIN_TOOLS.length, BASELINE.home.pinTools, 'M. pinnable set');
    for (const id of ids) assert.ok(homeHtml.includes(`onclick="openTool('${id}')"`), 'L. ' + id + ' routes through openTool');
    assert.strictEqual(cnt(homeHtml, /<button/g), BASELINE.home.tools, 'every tool is one tappable tile');
    assert.strictEqual(cnt(homeHtml, /class="home-section-label"/g), BASELINE.home.groups, 'one heading per group');
    assert.strictEqual(cnt(HOME, /<button/g), BASELINE.home.staticButtons, 'static Home buttons (pin controls) intact');
    assert.ok(html.includes('id="pinnedList"') && html.includes('id="homeGroups"'), 'hosts intact');
  });
});

describe('EC-UI structural safety — untouched surfaces', () => {
  test('Z/AA/AB. every calculator, Chat and Code keep their control counts', () => {
    for (const [id, [sel, inp, btn]] of Object.entries(BASELINE.panels)) {
      const p = panel(id);
      assert.strictEqual(cnt(p, /<select/g), sel, id + ' selects');
      assert.strictEqual(cnt(p, /<input/g), inp, id + ' inputs');
      assert.strictEqual(cnt(p, /<button/g), btn, id + ' buttons');
    }
    assert.ok(/\.msg\.ai\s+\.msg-bubble \{[^}]*border-radius: 18px 18px 18px 4px/.test(html), 'AA. Chat bubble shape untouched');
  });
  test('V/X/Y. Pull Box visual classes intact and its results unchanged', () => {
    for (const cls of ['.p3d-btn{', '.p3d-act{', '.p3d-field{', '.p3d-flab{', '.p3d-fx{', '.p3d-tier{', '.p3d-card{', '.p3d-res{', '.p3d-fastcalc{', '.p3d-boxsize{']) {
      assert.ok(P3D_CSS.includes(cls), 'V. ' + cls);
    }
    assert.strictEqual(cnt(P3D_CSS, /var\(--ec-/g), 0, 'V. Pull Box is the reference, not a consumer yet (Phase 6)');
  });
  test('AD/AE/AF. layer hashes; AG. parse gate', () => {
    assert.strictEqual(md5('src/standards/pullBoxEntryGeometry.js'), '25dee66f99299394d97400e003d2ddd1');
    assert.strictEqual(md5('src/calc/pullBox.js'), 'bdd49316a39ebadd3e43718a31e01739');
    assert.strictEqual(md5('src/layout/pullBoxLayout.js'), '8696e6e41cf688e09bf9bac154d4098a');
    for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) new vm.Script(m[1]);
  });
});

/* ── PART 2 — EC-UI-2: shared tokens + primitives; Home and shell consume ── */
describe('EC-UI-2 — shared design tokens', () => {
  const ROOT = (() => { const i = GLOBAL_CSS.indexOf(':root {'); return GLOBAL_CSS.slice(i, GLOBAL_CSS.indexOf('}', i) + 1); })();
  const EXPECTED = {
    '--ec-radius-sm': '8px', '--ec-radius-md': '10px', '--ec-control-h': '46px', '--ec-control-h-compact': '36px',
    '--ec-font-xs': '10px', '--ec-font-sm': '11px', '--ec-font-md': '12px', '--ec-font-lg': '13px',
    '--ec-weight': '600', '--ec-tracking': '1px', '--ec-gap-xs': '6px', '--ec-gap-sm': '8px', '--ec-gap-md': '10px',
    '--ec-surface-raised': '#181818', '--ec-surface-card': '#111111', '--ec-border-active': 'var(--accent)',
    '--ec-border-danger': '#3a2422', '--ec-text-muted': '#7a7a7a',
  };
  test('A. every --ec-* token exists with its accepted value', () => {
    for (const [k, v] of Object.entries(EXPECTED)) {
      const m = new RegExp(k.replace(/-/g, '\\-') + ':\\s*([^;]+);').exec(ROOT);
      assert.ok(m, k + ' defined'); assert.strictEqual(m[1].trim(), v, k);
    }
  });
  test('B/C. defined exactly once, inside the one existing :root block', () => {
    assert.strictEqual(cnt(GLOBAL_CSS, /:root\s*\{/g), 1, 'C. one root block, no second theme');
    for (const k of Object.keys(EXPECTED)) assert.strictEqual(cnt(html, new RegExp(k.replace(/-/g, '\\-') + ':', 'g')), 1, 'B. ' + k + ' defined once');
    // existing colour tokens are reused, not duplicated under new names
    assert.ok(ROOT.includes('--ec-border-active: var(--accent)'), 'accent reused');
    assert.ok(!/--ec-bg|--ec-accent|--ec-border:|--ec-danger/.test(ROOT), 'no duplicate colour tokens');
  });
});

describe('EC-UI-2 — shared primitives', () => {
  test('D-I. the component vocabulary exists as explicit classes', () => {
    for (const cls of ['.ec-control', '.ec-select', '.ec-btn', '.ec-btn-primary', '.ec-btn-danger', '.ec-btn-danger-fill',
      '.ec-segmented', '.ec-card', '.ec-result', '.ec-result-hero', '.ec-result-item', '.ec-label', '.ec-value', '.ec-section']) {
      assert.ok(new RegExp(cls.replace('.', '\\.') + '[\\s,{:]').test(GLOBAL_CSS), cls + ' defined');
    }
    const btn = rule(GLOBAL_CSS, '.ec-btn {');
    assert.ok(/min-height:\s*44px/.test(btn), 'F. buttons keep a 44px target');
    assert.ok(/border-radius:\s*var\(--ec-radius-sm\)/.test(btn) && /font-weight:\s*var\(--ec-weight\)/.test(btn), 'radius + weight from tokens');
    assert.ok(/\.ec-btn\[disabled\][^{]*\{[^}]*#5a5a5a/.test(GLOBAL_CSS), 'disabled is muted but readable');
    assert.ok(/\.ec-btn-danger \{[^}]*var\(--danger\)/.test(GLOBAL_CSS), 'danger uses the one --danger');
    assert.ok(/\.ec-btn\[aria-pressed="true"\]/.test(GLOBAL_CSS), 'selected state is explicit');
    assert.ok(/\.ec-control \{[^}]*min-height:\s*var\(--ec-control-h\)/.test(GLOBAL_CSS), 'D. boxed control at 46px');
  });
  test('AC. no element-wide wildcard restyle was introduced', () => {
    // the pre-existing element rules are unchanged in number: nothing new targets bare button/select/input
    const bare = (GLOBAL_CSS.match(/^\s*(button|select|input(?:\[type=[a-z]+\])?)(\s*,\s*(button|select|input(?:\[type=[a-z]+\])?))*\s*\{/gm) || []);
    // exactly the two rules that existed BEFORE EC-UI-2 (verified against the
    // PBV2-14.1 build) — the design system added none
    assert.deepStrictEqual(bare.map((r) => r.trim()), ['select, input[type=number] {', 'input[type=number] {'],
      'only the pre-existing element rules remain; the design system added none');
    assert.ok(!/^\s*button\s*\{/m.test(GLOBAL_CSS), 'no global button rule');
    // every primitive is scoped by an .ec- class
    const ec = GLOBAL_CSS.slice(GLOBAL_CSS.lastIndexOf('/*', GLOBAL_CSS.indexOf('EC-UI-2 — SHARED PRIMITIVES')), GLOBAL_CSS.indexOf('/* ── HOME ── */'));
    for (const sel of ec.match(/^\s*[^{}/*]+\{/gm) || []) assert.ok(/\.ec-/.test(sel), 'scoped: ' + sel.trim());
    const ecCode = ec.replace(/\/\*[\s\S]*?\*\//g, '');   // selectors and declarations, not prose
    assert.ok(!/\.p3d-/.test(ecCode), 'primitives never depend on .p3d-*');
  });
});

describe('EC-UI-2 — Home and shell consume the system', () => {
  test('N. tool tiles use the shared card tokens; tap target preserved', () => {
    const tile = rule(GLOBAL_CSS, '  .tile {');
    assert.ok(/background:\s*var\(--ec-surface-card\)/.test(tile), 'flat card surface');
    assert.ok(/border-radius:\s*var\(--ec-radius-md\)/.test(tile), '10px radius');
    assert.ok(/border:\s*1px solid var\(--border\)/.test(tile), 'one 1px border');
    assert.ok(/min-height:\s*56px/.test(tile), 'touch target kept');
    assert.ok(!/border-radius:\s*4px/.test(tile), 'old 4px radius gone');
    assert.ok(/\.tile-name \{[^}]*font-weight:\s*var\(--ec-weight\)/.test(GLOBAL_CSS), '600 weight name');
    assert.ok(/\.tile:active \{[^}]*var\(--ec-border-active\)/.test(GLOBAL_CSS), 'active state is the shared accent border');
  });
  test('O. category headings use the quiet section language; pinned stays distinct', () => {
    const h = rule(GLOBAL_CSS, '.home-section-label {');
    assert.ok(/color:\s*var\(--ec-text-muted\)/.test(h) && /font-weight:\s*var\(--ec-weight\)/.test(h) && /letter-spacing:\s*var\(--ec-tracking\)/.test(h));
    assert.ok(!/var\(--accent\)/.test(h), 'accent reserved for actions');
    assert.ok(/\.home-pinned-label \{[^}]*var\(--text\)/.test(GLOBAL_CSS), 'pinned heading bright');
    assert.ok(/\.tile-pinned \{[^}]*rgba\(255,199,0[^}]*border-left:\s*3px solid var\(--accent\)/.test(GLOBAL_CSS), 'pinned tint + rail');
  });
  test('T. header typography converged without changing its accepted size or height', () => {
    const logo = rule(GLOBAL_CSS, '.logo {'); const edition = rule(GLOBAL_CSS, '.edition {');
    assert.ok(/font-size:\s*9px/.test(logo) && /font-size:\s*9px/.test(edition), 'sizes unchanged (9px)');
    assert.ok(/font-weight:\s*var\(--ec-weight\)/.test(edition), 'editions on the shared weight');
    assert.ok(/height:\s*36px/.test(rule(GLOBAL_CSS, '  header {')), 'not taller');
    assert.ok(/font-weight:\s*600/.test(rule(GLOBAL_CSS, '  .nav-item {')), 'nav labels at 600');
  });
  test('W. the Pull Box entry still opens through the tile', () => {
    const { homeHtml } = bootRegistry();
    assert.ok(homeHtml.includes("openTool('pullbox')") && homeHtml.includes('Pull / Junction Box'));
  });
});
