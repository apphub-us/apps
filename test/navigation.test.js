'use strict';
/**
 * UX-1 — Home and navigation architecture, tested against the SHIPPED
 * mobile.html. Structural assertions plus execution of the real routing
 * functions against a stub DOM.
 *
 * These tests cover navigation only. They must not assert anything about
 * calculation results — that is the job of the calculator suites.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

/** Only the hand-written part; the generated engine block is not markup. */
function appMarkup() {
  const end = html.indexOf('<!-- EC-CALC:END -->');
  return html.slice(0, html.indexOf('<!-- EC-CALC:START')) + html.slice(end);
}

/** Load the routing layer with a stub DOM and record where it navigates. */
function bootRouter() {
  const calls = [];
  const nav = {};
  const elements = {};
  const mk = (id) => (elements[id] = {
    id, innerHTML: '', style: {},
    classList: {
      s: new Set(),
      add(x) { this.s.add(x); }, remove(x) { this.s.delete(x); },
      toggle(x, o) { o ? this.s.add(x) : this.s.delete(x); },
      contains(x) { return this.s.has(x); },
    },
  });
  ['homeGroups', 'mnav-home', 'mnav-chat', 'mnav-coderef',
    'pinnedWrap', 'pinnedList', 'pinnedPicker', 'pinnedOptions', 'pinnedEditBtn'].forEach(mk);

  const navItems = ['mnav-home', 'mnav-chat', 'mnav-coderef'].map((id) => elements[id]);
  const store = {};

  const sandbox = {
    document: {
      getElementById: (id) => elements[id] || null,
      querySelectorAll: (sel) => (sel === '.nav-item' ? navItems : []),
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    },
    window: { addEventListener() {} },
    localStorage: {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = v; },
    },
    switchTab: (name) => calls.push(['switchTab', name]),
    switchTabMore: (name) => calls.push(['switchTabMore', name]),
    fillCalcMode: (mode) => calls.push(['fillCalcMode', mode]),
    codeSubTab: (name) => calls.push(['codeSubTab', name]),
    groundingSelectTopic: (id) => calls.push(['groundingSelectTopic', id]),
  };

  const start = html.indexOf('// ══ HOME — TOOL CATALOGUE');
  const end = html.indexOf('// ── COLLAPSIBLE RULES BARS');
  const src = html.slice(start, end);

  const fn = new Function('document', 'window', 'localStorage', 'switchTab', 'switchTabMore',
    'fillCalcMode', 'codeSubTab', 'groundingSelectTopic', 'exports',
    src + ';Object.assign(exports,{openTool,homeRender,TOOLS,TOOL_GROUPS,PIN_TOOLS,pinGet,pinRender,pinToggle});');
  const api = {};
  fn(sandbox.document, sandbox.window, sandbox.localStorage, sandbox.switchTab,
    sandbox.switchTabMore, sandbox.fillCalcMode, sandbox.codeSubTab,
    sandbox.groundingSelectTopic, api);

  return { api, calls, elements, store };
}

describe('UX-1 — initial state', { skip: skipAll }, () => {
  test('Home is the initial active panel', () => {
    assert.ok(/<div class="panel active" id="panel-home">/.test(html),
      'panel-home is not the active panel on load');
  });

  test('AI Chat is no longer the default active panel', () => {
    assert.ok(!/<div class="panel active" id="panel-chat">/.test(html),
      'panel-chat must not carry the active class');
  });

  test('exactly one panel is active in the shipped markup', () => {
    const actives = appMarkup().match(/class="panel active"/g) || [];
    assert.strictEqual(actives.length, 1);
  });

  test('the initial active bottom-nav item is Home', () => {
    assert.ok(/<div class="nav-item active" id="mnav-home"/.test(html));
  });
});

describe('UX-1 — fixed bottom navigation', { skip: skipAll }, () => {
  test('exactly one bottom navigation row is present', () => {
    const rows = appMarkup().match(/<nav class="bottom-nav"/g) || [];
    assert.strictEqual(rows.length, 1, `found ${rows.length} nav rows`);
  });

  test('the row contains exactly Home, AI Chat and Code', () => {
    const m = appMarkup().match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/);
    assert.ok(m, 'nav row not found');
    const ids = (m[1].match(/id="(mnav-[\w-]+)"/g) || [])
      .map((x) => x.replace(/id="|"/g, ''));
    assert.deepStrictEqual(ids, ['mnav-home', 'mnav-chat', 'mnav-coderef']);
  });

  test('no arrow or secondary row remains user-facing', () => {
    const markup = appMarkup();
    assert.ok(!/id="secondary-nav"/.test(markup), 'secondary nav row is back');
    assert.ok(!/mnav-more-arrow|mnav-back-arrow/.test(markup), 'arrow items are back');
    assert.ok(!/toggleMoreNav/.test(html), 'the arrow toggle is still reachable');
  });

  test('no calculator shortcuts leaked into the bottom nav', () => {
    const m = appMarkup().match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/);
    for (const id of ['wiresizer', 'ampacity', 'boxfill', 'conduit', 'motor',
      'bender', 'converter', 'loadcalc', 'outlets']) {
      assert.ok(!m[1].includes(`mnav-${id}`), `${id} must not be in the bottom nav`);
    }
  });

  test('no Last Used, Recent or Pinned bottom-nav item', () => {
    const m = appMarkup().match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/);
    assert.ok(!/Last Used|Recent|>Pinned</i.test(m[1]));
  });
});

describe('UX-1 — Home tiles', { skip: skipAll }, () => {
  const EXPECTED = {
    'CONDUCTORS & CIRCUITS': ['wiresizer', 'ampacity', 'loadcalc'],
    'RACEWAYS & BOXES': ['conduit', 'wireway', 'boxfill'],
    'EQUIPMENT & GROUNDING': ['motor', 'grounding', 'outlets'],
    'FIELD TOOLS': ['bender', 'converter'],
  };

  test('the four approved groups exist, in order, and nothing else', () => {
    const { api } = bootRouter();
    assert.deepStrictEqual(api.TOOL_GROUPS.map((g) => g.title), Object.keys(EXPECTED));
  });

  test('each group contains exactly the approved tools', () => {
    const { api } = bootRouter();
    for (const g of api.TOOL_GROUPS) {
      assert.deepStrictEqual(g.tools, EXPECTED[g.title], `group ${g.title}`);
    }
  });

  test('every approved tile is rendered exactly once', () => {
    const { api, elements } = bootRouter();
    api.homeRender();
    const rendered = (elements.homeGroups.innerHTML.match(/data-tool="([\w]+)"/g) || [])
      .map((x) => x.slice(11, -1));
    const expected = Object.values(EXPECTED).flat();
    assert.deepStrictEqual(rendered.slice().sort(), expected.slice().sort());
    assert.strictEqual(new Set(rendered).size, rendered.length, 'a tile is duplicated');
  });

  test('tiles carry full readable labels, not truncated ones', () => {
    const { api } = bootRouter();
    assert.strictEqual(api.TOOLS.loadcalc.label, 'Load Calculator');
    assert.strictEqual(api.TOOLS.bender.label, 'Conduit Bender');
    assert.strictEqual(api.TOOLS.converter.label, 'Electrical Converter');
    assert.strictEqual(api.TOOLS.outlets.label, 'NEMA Plugs & Receptacles');
    assert.strictEqual(api.TOOLS.grounding.label, 'EGC / GEC Calculator');
  });

  test('groups render without any expand or category page', () => {
    const { api, elements } = bootRouter();
    api.homeRender();
    const h = elements.homeGroups.innerHTML;
    for (const title of Object.keys(EXPECTED)) assert.ok(h.includes(title), `${title} missing`);
    assert.ok(!/onclick="[^"]*expand|categoryPage/i.test(h), 'tiles must not be behind an expander');
  });
});

describe('UX-1 — routing', { skip: skipAll }, () => {
  const route = (id) => { const b = bootRouter(); b.api.openTool(id); return b.calls; };

  test('Wire Sizer, Ampacity and Box Fill open their existing panels', () => {
    assert.deepStrictEqual(route('wiresizer'), [['switchTab', 'wiresizer']]);
    assert.deepStrictEqual(route('ampacity'), [['switchTab', 'ampacity']]);
    assert.deepStrictEqual(route('boxfill'), [['switchTab', 'boxfill']]);
  });

  test('Load Calculator, Motor, Bender, Converter and NEMA open their subpanels', () => {
    assert.deepStrictEqual(route('loadcalc'), [['switchTabMore', 'loadcalc']]);
    assert.deepStrictEqual(route('motor'), [['switchTabMore', 'motor']]);
    assert.deepStrictEqual(route('bender'), [['switchTabMore', 'bender']]);
    assert.deepStrictEqual(route('converter'), [['switchTabMore', 'converter']]);
    assert.deepStrictEqual(route('outlets'), [['switchTabMore', 'outlets']]);
  });

  test('Conduit Fill opens the Fill Calc panel in Conduit mode', () => {
    assert.deepStrictEqual(route('conduit'),
      [['switchTab', 'conduit'], ['fillCalcMode', 'conduit']]);
  });

  test('Wireway Fill opens the SAME panel in Wireway mode, not Conduit', () => {
    const calls = route('wireway');
    assert.deepStrictEqual(calls, [['switchTab', 'conduit'], ['fillCalcMode', 'wireway']]);
    assert.ok(!calls.some((c) => c[0] === 'fillCalcMode' && c[1] === 'conduit'),
      'Wireway must not land in Conduit mode');
  });

  test('EGC/GEC deep-links into the existing grounding calculator', () => {
    assert.deepStrictEqual(route('grounding'), [
      ['switchTabMore', 'coderef'],
      ['codeSubTab', 'grounding'],
      ['groundingSelectTopic', 'calc'],
    ]);
  });

  test('EGC/GEC does not create a second grounding container', () => {
    // The container lives inside the CSR_CONTENT string, so it appears escaped.
    const containers = (html.match(/id=\\?"groundingContent\\?"/g) || []).length;
    assert.strictEqual(containers, 1, `expected one grounding container, found ${containers}`);
    assert.strictEqual((html.match(/function gndRenderCalc/g) || []).length, 1,
      'the grounding calculator was duplicated');
  });

  test('Code in the bottom nav opens the existing Code Reference', () => {
    assert.deepStrictEqual(route('coderef'), [['switchTabMore', 'coderef']]);
  });

  test('an unknown tool id is rejected rather than navigating somewhere odd', () => {
    const b = bootRouter();
    assert.strictEqual(b.api.openTool('nope'), false);
    assert.deepStrictEqual(b.calls, []);
  });

  test('Home stays the highlighted section for tools opened from Home', () => {
    const b = bootRouter();
    b.api.openTool('motor');
    assert.ok(b.elements['mnav-home'].classList.contains('active'));
    assert.ok(!b.elements['mnav-coderef'].classList.contains('active'));
  });

  test('Code owns its own highlight', () => {
    const b = bootRouter();
    b.api.openTool('coderef');
    assert.ok(b.elements['mnav-coderef'].classList.contains('active'));
    assert.ok(!b.elements['mnav-home'].classList.contains('active'));
  });
});

describe('UX-1 — PINNED on Home', { skip: skipAll }, () => {
  test('PINNED markup exists exactly once, inside panel-home', () => {
    const markup = appMarkup();
    assert.strictEqual((markup.match(/<div id="pinnedWrap"/g) || []).length, 1);
    const home = markup.slice(markup.indexOf('id="panel-home"'), markup.indexOf('id="panel-chat"'));
    assert.ok(home.includes('id="pinnedWrap"'), 'PINNED is not inside panel-home');
    assert.ok(home.includes('id="pinnedPicker"'), 'the pin picker is not inside panel-home');
  });

  test('the ec_pinned storage key is unchanged', () => {
    assert.ok(/PIN_KEY\s*=\s*'ec_pinned'/.test(html), 'the storage key changed');
  });

  test('existing user selections remain readable', () => {
    const b = bootRouter();
    b.store.ec_pinned = JSON.stringify(['wiresizer', 'ampacity', 'motor']);
    assert.deepStrictEqual(b.api.pinGet(), ['wiresizer', 'ampacity', 'motor']);
  });

  test('the default pinned set is preserved', () => {
    const b = bootRouter();
    assert.deepStrictEqual(b.api.pinGet(), ['wiresizer', 'conduit', 'ampacity', 'loadcalc']);
  });

  test('pin and unpin still work', () => {
    const b = bootRouter();
    b.api.pinToggle('motor');
    assert.ok(b.api.pinGet().includes('motor'));
    b.api.pinToggle('motor');
    assert.ok(!b.api.pinGet().includes('motor'));
  });

  test('PINNED routing goes through openTool, not a main/more hint', () => {
    assert.ok(!/kind:\s*'(main|more)'/.test(html),
      'the old main/more routing hint is back');
    assert.ok(/function pinGo\(id\)\s*\{\s*openTool\(id\)/.test(html),
      'pinGo must delegate to openTool');
  });

  test('every pinnable tool is a known tool', () => {
    const { api } = bootRouter();
    for (const t of api.PIN_TOOLS) {
      assert.ok(api.TOOLS[t.id], `pinnable tool ${t.id} has no route`);
      assert.strictEqual(t.label, api.TOOLS[t.id].label, `label drift for ${t.id}`);
    }
  });

  test('starting a chat message does not destroy the Home PINNED section', () => {
    // pinHide() is called from addMessage() and showTyping(); with PINNED on
    // Home it must be inert rather than removing the nodes.
    assert.ok(!/function pinHide\(\)\s*\{[\s\S]{0,200}\.remove\(\)/.test(html),
      'pinHide still removes the PINNED nodes');
    assert.ok(/function pinHide\(\)\s*\{\s*\/\*/.test(html),
      'pinHide should be an explicit no-op');
  });
});

describe('UX-1 — exclusions and preservation', { skip: skipAll }, () => {
  test('V-Drop and Pull Box are not exposed on Home or in the nav', () => {
    const { api } = bootRouter();
    const exposed = api.TOOL_GROUPS.flatMap((g) => g.tools);
    for (const id of ['vdrop', 'pullbox']) {
      assert.ok(!exposed.includes(id), `${id} must not be a Home tile`);
      assert.ok(!api.TOOLS[id], `${id} must not be routable`);
    }
    const m = appMarkup().match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/);
    assert.ok(!/vdrop|pullbox/i.test(m[1]), 'a hidden panel leaked into the nav');
  });

  test('their code is preserved, not deleted', () => {
    assert.ok(/id="panel-vdrop"/.test(html), 'the V-Drop panel was deleted');
    assert.ok(/id="sub-pullbox"/.test(html), 'the Pull Box subpanel was deleted');
  });

  test('every calculator panel id survives', () => {
    for (const id of ['panel-chat', 'panel-ampacity', 'panel-conduit', 'panel-boxfill',
      'panel-wiresizer', 'panel-more', 'sub-loadcalc', 'sub-coderef', 'sub-outlets',
      'sub-motor', 'sub-bender', 'sub-converter']) {
      assert.ok(html.includes(`id="${id}"`), `missing panel: ${id}`);
    }
  });

  test('production calculation entry points are intact', () => {
    for (const fn of ['cfUpdateCalc', 'bfUpdateCalc', 'ampUpdateCalc', 'wsCalc',
      'mtCalc', 'lcUpdate', 'gndCalc', 'bdCalc', 'cvCalc', 'wwCalc']) {
      assert.ok(html.includes(`function ${fn}`), `missing entry point: ${fn}`);
    }
  });

  test('the shared engine is still injected and used', () => {
    assert.ok(html.includes('<!-- EC-CALC:START'), 'the engine block is gone');
    assert.ok(/EC\.ampacity\.calculateAmpacity/.test(html));
    assert.ok(/EC\.conduitFill\.calculateConduitFill/.test(html));
  });
});
