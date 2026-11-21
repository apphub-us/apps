'use strict';
/**
 * EC-SAFE-1 — HTML-injection regressions for the three audited sinks.
 *
 * These tests extract the ACTUAL functions from mobile.html (never a copied
 * "safe" renderer) and run them in Node with a minimal recording DOM. They
 * are the fast, always-on layer. They do NOT replace the real-browser gate:
 * tools/security-check-mobile.js runs the same file in Chromium against
 * the same payloads, and is the authority on "no code executed". Both must
 * be green.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '..', 'mobile.html');
const html = fs.readFileSync(APP, 'utf8');

/** Extract a top-level function body by name (the whole-inline-script parse gate guarantees balance). */
function fn(name) {
  const i = html.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
/** A minimal recording DOM: enough for the three renderers, honest about attributes. */
function makeDoc() {
  const mk = (tag) => {
    const el = { tagName: tag.toUpperCase(), attrs: {}, children: [], style: {}, _text: '', _title: '', _type: '', className: '', listeners: {},
      set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
      set title(v) { this._title = v; }, get title() { return this._title; }, set type(v) { this._type = v; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }, get firstChild() { return this.children[0] || null; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      set innerHTML(v) { this._html = v; this.children = []; }, get innerHTML() { return this._html === undefined ? '' : this._html; },
      querySelectorAll() { return []; } };
    return el;
  };
  const byId = {};
  return { byId, mk, createElement: mk, createTextNode: (t) => ({ tagName: '#text', textContent: String(t), children: [], attrs: {} }),
    getElementById: (id) => byId[id] || null };
}
/** Flatten a node tree into [tag, attrs] pairs and concatenated text. */
function walk(node, out) { out = out || []; out.push(node); (node.children || []).forEach((c) => walk(c, out)); return out; }
const hasExecutable = (nodes) => nodes.some((n) => n.tagName === 'SCRIPT' || Object.keys(n.attrs || {}).some((k) => /^on/i.test(k)) || Object.keys(n.listeners || {}).length && false);

/* ── the shipped chat formatter, verbatim ───────────────────────────────── */
// EC-UI-LAYOUT-REFS-1: inlineFormat now emits source-aware reference spans through the shared refSpanHtml (data-ref + delegated handler)
const editions = (html.match(/var EC_NEC_EDITION = '[^']+', EC_NYCEC_EDITION = '[^']+';/) || [''])[0] + (html.match(/var EC_REF_TOKEN_RE = .*;/) || [''])[0];   // UI-r1: + the shared one-pass linkifier (exposure only)
const chat = new Function('necLink', editions + fn('refAttr') + fn('refSpanHtml') + fn('refLinkifyHtml') + fn('escapeHtml') + fn('inlineFormat') + fn('buildTable') + fn('formatResponse') + '; return { formatResponse, inlineFormat, buildTable, escapeHtml };')(() => {});

const BUMP = 'window.x=(window.x?window.x+1:1)';
const HOSTILE = [`<img src=x onerror="${BUMP}">`, `<svg onload="${BUMP}"></svg>`, `<script>${BUMP}</script>`, `<a href="javascript:${BUMP}">x</a>`];

describe('EC-SAFE-1 — chat tables render cells through the escaping path', () => {
  test('hostile markup in table cells becomes literal text, never tags', () => {
    const out = chat.formatResponse(['| a | b |', '|---|---|', '| ' + HOSTILE[0] + ' | ' + HOSTILE[1] + ' |', '| ' + HOSTILE[2] + ' | ' + HOSTILE[3] + ' |'].join('\n'));
    // real TAGS, not escaped text: the literal string href="javascript:…" may
    // legitimately survive as text inside an &lt;a …&gt; that is no longer a tag
    assert.ok(!/<(img|svg|script|a)\b/i.test(out), 'no active markup: ' + out);
    assert.ok(out.includes('&lt;img src=x onerror='), 'escaped as text');
    // inspect REAL tags only (escaped text may legitimately contain "onerror=" as words)
    const tags = out.match(/<[a-zA-Z][^>]*>/g) || [];
    // EC-UI-LAYOUT-REFS-1 (old -> new): the NEC auto-link used an inline onclick string; it now carries data-ref/data-src and is handled by one delegated listener, so NO tag may carry an on* attribute
    assert.ok(tags.every((t) => !/\son\w+=/i.test(t)), 'no on* attribute in any tag: ' + tags.filter((t) => /\son\w+=/i.test(t)).join(' '));
    assert.ok(/<table><tr><th>a<\/th><th>b<\/th><\/tr>/.test(out), 'structure intact');
  });
  test('table cells now take the SAME path as list items: buildTable calls inlineFormat', () => {
    assert.ok(fn('buildTable').includes('inlineFormat(cells[j].trim())'), 'cells are escaped by the shared formatter');
    assert.ok(!/<'\+tag\+'>'\+cells\[j\]\.trim\(\)/.test(fn('buildTable')), 'the raw interpolation is gone');
  });
  test('quotes, apostrophes, ampersands and angle brackets are preserved as text', () => {
    const out = chat.buildTable(['| Tom\'s "quoted" & <b>bold</b> |']);
    assert.ok(out.includes('Tom\'s "quoted" &amp; &lt;b&gt;bold&lt;/b&gt;'));
  });
  test('entity-like input is not decoded into markup; rendering twice does not double-decode into tags', () => {
    const once = chat.buildTable(['| &lt;img src=x onerror=alert(1)&gt; &#60;script&#62; |']);
    assert.ok(once.includes('&amp;lt;img') && once.includes('&amp;#60;script'), 'entities are escaped, so they stay literal');
    const twice = chat.formatResponse(chat.formatResponse('| &lt;script&gt; |').replace(/<[^>]+>/g, ''));
    assert.ok(!/<script/.test(twice));
  });
  test('inline Markdown and NEC auto-links still work INSIDE table cells', () => {
    const out = chat.buildTable(['| **bold** *it* `code` NEC 314.28(A) |']);
    assert.ok(/<strong[^>]*>bold<\/strong>/.test(out) && /<em[^>]*>it<\/em>/.test(out) && /<code[^>]*>code<\/code>/.test(out));
    // EC-UI-LAYOUT-REFS-1 (old -> new): the click contract is now a source-aware data-ref span (delegated), not an inline handler
    assert.ok(out.includes(`<span class="nec-link" role="button" tabindex="0" data-ref="NEC 314.28(A)" data-src="nec" data-ed="2020" data-sec="314.28(A)"`), 'the NEC reference contract: ' + out);
    const nyc = chat.buildTable(['| NYCEC 210.19(A) |']);
    assert.ok(nyc.includes(`<span class="nycec-link" role="button" tabindex="0" data-ref="NYCEC 210.19(A)" data-src="nycec" data-ed="2025" data-sec="210.19(A)"`), 'the NYCEC reference contract (blue, separate source): ' + nyc);
  });
  test('the NEC auto-link handler cannot be poisoned: its capture excludes quotes and brackets', () => {
    for (const evil of ['NEC 3.1\'); alert(1);(\'', 'NEC 3.1"onclick="x', 'NEC 3.1<img onerror=1>']) {
      const out = chat.inlineFormat(evil);
      // EC-UI-LAYOUT-REFS-1 (old -> new): there is no inline handler to poison; the data attributes are attribute-escaped and the capture excludes quotes and brackets
      const realTags = out.match(/<[a-zA-Z][^>]*>/g) || [];
      assert.ok(realTags.every((t) => !/\son\w+=/i.test(t)), 'no inline handler in any real tag (escaped text may contain the word): ' + out);
      const refs = out.match(/data-(?:ref|sec)="[^"]*"/g) || [];
      assert.ok(refs.length > 0 && refs.every((h) => /^data-(?:ref|sec)="(?:NEC )?[\d.\w()]+"$/.test(h)), 'only well-formed reference attributes: ' + refs.join(' '));
      assert.ok(!/<img/.test(out));
    }
  });
  test('ordinary Markdown: code blocks, headings, lists and a plain table', () => {
    const out = chat.formatResponse(['# Title', '- item **b**', '1. one', '```', 'const x = "<b>";', '```', '| h |', '|---|', '| 1 |'].join('\n'));
    assert.ok(/<pre[^>]*>const x = &quot;|<pre[^>]*>const x = "&lt;b&gt;";<\/pre>|<pre[^>]*>const x = "&lt;b&gt;";/.test(out) || out.includes('&lt;b&gt;'), 'code block escaped');
    assert.ok(out.includes('Title') && /<strong[^>]*>b<\/strong>/.test(out) && /<table><tr><th>h<\/th>/.test(out) && /<td>1<\/td>/.test(out));
  });
});

/* ── the shipped trending renderer, verbatim ────────────────────────────── */
describe('EC-SAFE-1 — trending renders untrusted records as text and binds by value', () => {
  const doc = makeDoc();
  const trend = new Function('document', fn('buildTrendingButton') + fn('renderTrending') + fn('trendingFallback') + '; return { buildTrendingButton, renderTrending, trendingFallback };')(doc);
  const hostile = [
    { label: HOSTILE[0], count: HOSTILE[1], sample: HOSTILE[2] },
    { label: 'Panel <b>sizing</b> & "quotes"', count: 42, sample: 'How do I size a 200A panel?' },
  ];
  test('hostile label/count/sample never become markup or handlers', () => {
    const c = doc.mk('div'); const asked = [];
    trend.renderTrending(c, hostile, (s) => asked.push(s));
    const nodes = walk(c);
    assert.ok(!hasExecutable(nodes), 'no scripts / on* attributes');
    assert.ok(nodes.filter((n) => n.tagName !== '#text').every((n) => n.innerHTML === ''), 'innerHTML is never used');
    const btn = c.children[0];
    assert.ok(btn.textContent.includes('<img src=x onerror='), 'label is literal text');
    assert.strictEqual(btn.children[1].textContent, '', 'a non-numeric count renders blank, not markup');
    assert.strictEqual(c.children[1].children[1].textContent, '42');
  });
  test('the click passes the sample as a closure VALUE; nothing external is interpolated', () => {
    const c = doc.mk('div'); const asked = [];
    trend.renderTrending(c, hostile, (s) => asked.push(s));
    c.children[1].listeners.click[0](); c.children[0].listeners.click[0]();
    assert.deepStrictEqual(asked, ['How do I size a 200A panel?', HOSTILE[2]], 'the sample reaches the action untouched, as data');
    assert.ok(!/innerHTML|onclick\s*=|\+\s*data\.(label|count|sample)/.test(fn('buildTrendingButton')), 'no string-building from record fields');
  });
  test('malformed records are skipped without taking the panel down', () => {
    const c = doc.mk('div');
    const shown = trend.renderTrending(c, [null, 7, { label: 7 }, { label: '  ' }, { count: 3 }, { label: 'ok', count: 'x<img>' }], () => {});
    assert.strictEqual(shown, 1); assert.strictEqual(c.children.length, 1);
    assert.strictEqual(c.children[0].children[1].textContent, '', 'bad count blank');
  });
  test('fallback states are text nodes, and the remote gate is OFF by default (temporary containment)', () => {
    const c = doc.mk('div'); trend.trendingFallback(c, 'Trending is temporarily unavailable');
    assert.strictEqual(c.children[0].textContent, 'Trending is temporarily unavailable'); assert.strictEqual(c.children[0].innerHTML, '');
    assert.ok(/var TRENDING_REMOTE_ENABLED = false;/.test(html), 'default-off gate');
    assert.ok(fn('trackQuestion').includes('if (!TRENDING_REMOTE_ENABLED) return;'), 'upload path gated');
    const initFb = html.slice(html.indexOf('window.initFirebase = async function'), html.indexOf('window._fbReady || _fbLoading'));
    assert.ok(/if \(typeof TRENDING_REMOTE_ENABLED !== 'undefined' && !TRENDING_REMOTE_ENABLED\) \{\s*if \(typeof loadTrending === 'function'\) loadTrending\(\);\s*return;\s*\}/.test(initFb), 'SDK download gated, fallback rendered');
    const lt = html.slice(html.indexOf('window.loadTrending = async function'), html.indexOf('async function trackQuestion'));
    assert.ok(lt.includes("if (!TRENDING_REMOTE_ENABLED) { trendingFallback(container, 'Trending is temporarily unavailable'); return; }"), 'read path gated with a calm fallback');
    assert.ok(!/container\.innerHTML|btn\.innerHTML/.test(lt), 'no innerHTML left in the read path');
  });
});

/* ── the shipped favorites renderer, verbatim ───────────────────────────── */
describe('EC-SAFE-1 — saved presets render as text with value-bound handlers', () => {
  function favEnv(stored) {
    const doc = makeDoc(); const list = doc.mk('div'); doc.byId['cf-fav-list'] = list;
    const calls = { load: [], del: [] };
    const store = { data: JSON.stringify(stored) };
    const env = new Function('document', 'localStorage', 'favLoad', 'favDelete',
      "var FAV_KEY = 'sparky_favorites';" + fn('favGetAll') + fn('favRender') + '; return { favRender };')(
      doc, { getItem: () => store.data, setItem: (k, v) => { store.data = v; } }, (t, id) => calls.load.push([t, id]), (t, id) => calls.del.push([t, id]));
    return { doc, list, calls, env };
  }
  const evilId = '1002);' + BUMP + ';void(0';
  const stored = { cf: [{ name: HOSTILE[0] + ' Kitchen', vals: { a: 1 }, id: 1001 }, { name: 'O\'Brien "run" & <b>x</b>', vals: { a: 2 }, id: evilId }, { name: 'Good', vals: { a: 3 }, id: 1003 }, { name: 12, vals: {}, id: 1004 }, null] };

  test('names are text; ids and types travel as values; no inline handlers; null entries skipped', () => {
    const { list, env } = favEnv(stored); env.favRender('cf');
    assert.strictEqual(list.children.length, 4, 'four renderable entries, the null skipped');
    const nodes = walk(list);
    assert.ok(!hasExecutable(nodes), 'no on* attributes anywhere');
    assert.ok(nodes.filter((n) => n.tagName !== '#text').every((n) => n.innerHTML === ''), 'innerHTML never used');
    assert.ok(list.children[0].textContent.includes('<img src=x onerror='), 'hostile name is literal text');
    assert.ok(list.children[1].textContent.includes('O\'Brien "run" & <b>x</b>'));
    assert.strictEqual(list.children[3].children[1].textContent, '', 'a non-string name renders blank, not as code');
  });
  test('row click loads by value (even a crafted string id); delete stops propagation and never loads', () => {
    const { list, calls, env } = favEnv(stored); env.favRender('cf');
    list.children[1].listeners.click[0]();
    assert.deepStrictEqual(calls.load, [['cf', evilId]], 'the crafted id is passed as an inert string value');
    let stopped = false;
    list.children[0].children[2].listeners.click[0]({ stopPropagation: () => { stopped = true; } });
    assert.ok(stopped, 'delete stops propagation'); assert.deepStrictEqual(calls.del, [['cf', 1001]]); assert.strictEqual(calls.load.length, 1, 'delete did not also load');
  });
  test('the shipped source has no interpolated onclick and re-renders lists after Fill content swaps', () => {
    assert.ok(!/onclick="favLoad|onclick="event\.stopPropagation\(\);favDelete/.test(fn('favRender')), 'no inline handlers built from stored data');
    assert.ok(/wrapper\.innerHTML = FILL_CONTENT\[mode\];[\s\S]{0,200}favRender\('cf'\); favRender\('ww'\);/.test(html), 'lists rebuilt with live handlers after a swap');
  });
  test('favLoad / favDelete tolerate a malformed (null) stored entry', () => {
    const doc = makeDoc(); const store = { data: JSON.stringify(stored) }; const applied = [];
    const env = new Function('document', 'localStorage', 'favSetValues', 'favRender',
      "var FAV_KEY = 'sparky_favorites';" + fn('favGetAll') + fn('favSaveAll') + fn('favLoad') + fn('favDelete') + '; return { favLoad, favDelete };')(
      doc, { getItem: () => store.data, setItem: (k, v) => { store.data = v; } }, (t, v) => applied.push(v), () => {});
    env.favLoad('cf', 1003); assert.deepStrictEqual(applied, [{ a: 3 }]);
    env.favDelete('cf', 1001);
    const now = JSON.parse(store.data).cf;
    assert.strictEqual(now.length, 4, 'exactly one removed'); assert.ok(now.includes(null), 'the malformed entry is left alone, not silently repaired');
    assert.ok(!now.some((f) => f && f.id === 1001));
  });
});

describe('EC-SAFE-1 — scope guards', () => {
  test('no new bare innerHTML sinks fed by external/stored data in the three paths', () => {
    for (const f of ['buildTable', 'buildTrendingButton', 'renderTrending', 'favRender']) assert.ok(!/innerHTML/.test(fn(f)), f);
  });
  test('the harness is a Node tool, not reachable from the app', () => {
    assert.ok(!html.includes('security-check-mobile'), 'no route/reference in mobile.html');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'tools', 'security-check-mobile.js')));
  });
});
