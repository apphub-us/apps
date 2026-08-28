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

  test('tiles carry the approved UX-2 presentation labels', () => {
    const { api } = bootRouter();
    const expected = {
      wiresizer: 'Wire Sizer', ampacity: 'Ampacity', loadcalc: 'Load Calc',
      conduit: 'Conduit Fill', wireway: 'Wireway Fill', boxfill: 'Box Fill',
      motor: 'Motor 430', grounding: 'Grounding', outlets: 'NEMA',
      bender: 'Conduit Bender', converter: 'Converter',
    };
    for (const [id, label] of Object.entries(expected)) {
      assert.strictEqual(api.TOOLS[id].label, label, `label for ${id}`);
    }
  });

  test('NEMA is not relabelled "Outlets" — an outlet is not a plug or receptacle', () => {
    const { api } = bootRouter();
    assert.strictEqual(api.TOOLS.outlets.label, 'NEMA');
    // Check the rendered tile, not the file: the phrase also appears in a
    // source comment explaining why it is wrong.
    const { api: a2, elements } = bootRouter();
    a2.homeRender();
    assert.ok(!/NEMA Outlets/.test(elements.homeGroups.innerHTML),
      'the inaccurate label is rendered to the user');
  });

  test('every Home tile carries a one-line description', () => {
    const { api } = bootRouter();
    const expected = {
      wiresizer: 'Ampacity + voltage drop', ampacity: 'Derating + terminal limits',
      loadcalc: 'Service & feeder demand', conduit: 'NEC Ch. 9 fill',
      wireway: '20% raceway fill', boxfill: 'NEC 314.16 volume',
      motor: 'Conductors + protection', grounding: 'EGC & GEC sizing',
      outlets: 'Plugs & receptacles', bender: '90s, offsets & saddles',
      converter: 'Power, torque & units',
    };
    for (const [id, desc] of Object.entries(expected)) {
      assert.strictEqual(api.TOOLS[id].desc, desc, `description for ${id}`);
    }
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

describe('UX-2 — presentation', { skip: skipAll }, () => {
  test('the header is a single row with two edition badges and no status dots', () => {
    const h = appMarkup().match(/<header>([\s\S]*?)<\/header>/);
    assert.ok(h, 'header not found');
    assert.ok(/class="edition edition-nycec">NYCEC 2025</.test(h[1]), 'NYCEC badge missing');
    assert.ok(/class="edition edition-nec">NEC 2020</.test(h[1]), 'NEC badge missing');
    assert.ok(!/status-dot/.test(h[1]), 'a decorative status dot is back in the header');
  });

  test('both code editions keep their blue and orange identity', () => {
    assert.ok(/\.edition-nycec\s*\{[^}]*var\(--nycec\)/.test(html));
    assert.ok(/\.edition-nec\s*\{[^}]*var\(--nec\)/.test(html));
  });

  test('secondary text meets AA on the darkest surface it sits on', () => {
    const m = html.match(/--text-dimmer:\s*(#[0-9a-fA-F]{6})/);
    assert.ok(m, '--text-dimmer not found');
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const l1 = lum(a); const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    assert.ok(ratio(m[1], '#222222') >= 4.5,
      `--text-dimmer ${m[1]} is ${ratio(m[1], '#222222').toFixed(2)}:1 on --surface2`);
  });

  test('tiles are at least a 56px touch target with a two-line anatomy', () => {
    assert.ok(/\.tile\s*\{[^}]*min-height:\s*56px/.test(html), 'tile min-height is not 56px');
    assert.ok(/\.tile-name\s*\{[^}]*font-size:\s*14px/.test(html), 'tile name is not 14px');
    assert.ok(/\.tile-desc\s*\{[^}]*font-size:\s*10px/.test(html), 'tile description is not 10px');
    assert.ok(/\.tile-desc\s*\{[^}]*IBM Plex Mono/.test(html), 'descriptions should be monospace');
  });

  test('PINNED is visually distinct: bright heading, tinted tiles, divider', () => {
    assert.ok(/\.home-pinned-label\s*\{[^}]*var\(--text\)/.test(html),
      'the PINNED heading must not use the category accent');
    assert.ok(/\.home-section-label\s*\{[^}]*var\(--accent\)/.test(html),
      'category headings should keep the accent');
    assert.ok(/\.tile-pinned\s*\{[^}]*rgba\(255,199,0/.test(html), 'pinned tint missing');
    assert.ok(/id="pinnedDivider"/.test(appMarkup()), 'divider below PINNED missing');
  });

  test('the PINNED heading shows a count', () => {
    assert.ok(/heading\.textContent = pinned\.length \? 'PINNED/.test(html),
      'the heading does not render a count');
  });

  test('NO per-category colour coding was introduced', () => {
    // The brief rejected green/blue/grey category accents: they imply
    // conductor and grounding semantics.
    const groups = html.slice(html.indexOf('var TOOL_GROUPS'), html.indexOf('var TOOLS = {'));
    assert.ok(!/color|#[0-9a-fA-F]{6}|rgba\(/.test(groups),
      'a per-category colour leaked into the group definitions');
    assert.ok(!/tile-conductors|tile-raceways|tile-grounding|tile-fieldtools/.test(html),
      'per-category tile classes were introduced');
  });

  test('bottom nav has one local inline SVG icon per item and no network request', () => {
    const m = appMarkup().match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/);
    assert.strictEqual((m[1].match(/<svg /g) || []).length, 3, 'expected exactly three icons');
    assert.ok(!/https?:|<img|url\(/.test(m[1]), 'the nav must not fetch anything');
    assert.ok(/\.nav-item svg\s*\{[^}]*currentColor/.test(html),
      'icons should inherit the active/inactive colour');
  });

  test('the Code icon reads as an open book, not a rectangle', () => {
    const m = appMarkup().match(/id="mnav-coderef"[\s\S]*?<\/svg>/);
    assert.ok(m, 'Code nav item not found');
    const paths = m[0].match(/<path /g) || [];
    assert.strictEqual(paths.length, 2,
      'an open book needs two page shapes; one path renders as a plain rectangle');
    assert.ok(!/M5 3h11a3 3/.test(m[0]), 'the old phone-like rounded rectangle is back');
    assert.ok(!/<rect/.test(m[0]), 'the Code icon must not be a bare rectangle');
  });

  test('Home and AI Chat icons were not touched', () => {
    const nav = appMarkup().match(/<nav class="bottom-nav">([\s\S]*?)<\/nav>/)[1];
    assert.ok(/id="mnav-home"[\s\S]*?M3 11\.2 12 4l9 7\.2/.test(nav), 'Home icon changed');
    assert.ok(/id="mnav-chat"[\s\S]*?M4 4h16a1 1 0 0 1 1 1v11/.test(nav), 'AI Chat icon changed');
  });

  test('the active yellow state and top indicator survive', () => {
    assert.ok(/\.nav-item\.active\s*\{[^}]*var\(--accent\)/.test(html));
    assert.ok(/\.nav-item\.active\s*\{[^}]*border-top-color/.test(html));
  });

  test('spacing follows the compact system', () => {
    assert.ok(/\.home-grid\s*\{[^}]*gap:\s*8px/.test(html), 'tile gap should be 8px');
    assert.ok(/\.home-group \+ \.home-group\s*\{\s*margin-top:\s*20px/.test(html),
      'groups should be 20px apart');
    assert.ok(/id="panel-home"[\s\S]{0,200}padding:14px/.test(html),
      'page padding should be 14px');
  });

  test('Home keeps two columns — no three-column grid', () => {
    // Scoped to the Home styles and renderer. Other calculators have their own
    // grids and are out of scope for UX-2.
    assert.ok(/\.home-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr[;\s}]/.test(html));
    const render = html.slice(html.indexOf('function tileMarkup'), html.indexOf('window.addEventListener(\'DOMContentLoaded\', homeRender)'));
    assert.ok(!/1fr 1fr 1fr/.test(render), 'Home renderer introduced a third column');
  });
});
