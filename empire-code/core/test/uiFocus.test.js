'use strict';
/**
 * EC-UI-FOCUS-1 — field-only focus-zoom policy: source-level audit of the shipped mobile.html.
 *
 * Policy: every LIVE editable field (select, numeric / text / password entry, the AI Chat composer) is styled
 * to >= 16 CSS px so iOS Safari has no reason to zoom into a focused control. This file audits the stylesheets
 * and the classification of every sub-16px field rule that remains; the computed-style proof on the real app
 * (unfocused / focused / blurred, five viewports, every route) is tools/ui-focus-check-mobile.js.
 * Exception ledger (kept in sync with docs/ui-focus-policy.md):
 *   - `.ec-select, .ec-control select, .ec-control input` — EC-UI-2 primitive at var(--ec-font-lg); NO live element
 *     matches it on any route (Pull Box v2 uses buttons); the token is shared display typography and is not changed.
 *   - `pbSizeSelect()` inline font-size:12px — legacy Pull Box v1, rendered only inside #sub-pullbox, which is
 *     display:none and reachable from no navigation function (classified unreachable, left as-is).
 *   - `.p3d-sel` 13px shorthand — Pull Box v2 3D prototype (dev host + pbv2=3d only); overridden to 16px right after it.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'mobile.html'), 'utf8');
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = styles.flatMap((css, sheet) => [...stripComments(css).matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sheet, selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] })));
const fieldRule = (r) => /(^|[\s,>+~])(select|input|textarea)(\b|\[)|\.p3d-sel|\.ec-select|\.modal input/.test(r.selector) && !/::placeholder|:focus\b|:disabled|\[type=(button|submit|checkbox|radio|range|file)\]/.test(r.selector);
const fontPx = (body) => { const m = /font-size:\s*([0-9.]+)px/.exec(body) || /\bfont:\s*[^;]*?\b([0-9.]+)px/.exec(body); return m ? parseFloat(m[1]) : null; };

describe('EC-UI-FOCUS-1 field policy — stylesheet audit', () => {
  test('the shared select / number rule, the AI Chat composer and the modal (API-key) entry are 16px; the Box Fill scoped rule is untouched', () => {
    const shared = rules.find((r) => r.selector === 'select, input[type=number]'); assert.ok(shared); assert.strictEqual(fontPx(shared.body), 16);
    assert.ok(/height: 44px/.test(shared.body) && /padding: 10px 12px/.test(shared.body) && /font-family: 'IBM Plex Mono', monospace/.test(shared.body), 'other declarations intact');
    const ta = rules.find((r) => r.selector === 'textarea'); assert.ok(ta); assert.strictEqual(fontPx(ta.body), 16); assert.ok(/min-height: 46px/.test(ta.body) && /max-height: 120px/.test(ta.body) && /line-height: 1.5/.test(ta.body), 'composer geometry intact');
    const modal = rules.find((r) => r.selector === '.modal input'); assert.ok(modal); assert.strictEqual(fontPx(modal.body), 16);
    const bf = rules.find((r) => r.selector === '#panel-boxfill .controls select, #panel-boxfill .controls input[type=number]'); assert.ok(bf); assert.strictEqual(fontPx(bf.body), 16);
    assert.ok(html.includes("#panel-boxfill .controls select, #panel-boxfill .controls input[type=number] { font-size: 16px; }"), 'the accepted Box Fill rule text is unchanged');
  });
  test('every field rule that sets a size below 16px is on the exception ledger (no live element, legacy-unreachable, or overridden right after)', () => {
    const small = rules.filter((r) => fieldRule(r) && fontPx(r.body) !== null && fontPx(r.body) < 16);
    const ledger = ['.ec-select, .ec-control select, .ec-control input', '.p3d-sel'];
    for (const r of small) assert.ok(ledger.includes(r.selector), 'unlisted sub-16px field rule: ' + r.selector + ' -> ' + fontPx(r.body) + 'px');
    // .p3d-sel: the 13px shorthand must be followed by the 16px override in the same sheet (later rule wins)
    const p3d = rules.filter((r) => r.selector === '.p3d-sel'); assert.ok(p3d.length >= 2, '.p3d-sel base + override');
    const last = p3d[p3d.length - 1]; assert.strictEqual(fontPx(last.body), 16); assert.ok(p3d.slice(0, -1).some((r) => fontPx(r.body) === 13), 'the original compact shorthand is preserved');
    // .ec-control: no live element anywhere in the document markup or in generated markup strings
    assert.ok(!/class="[^"]*\bec-control\b/.test(html) && !/class="[^"]*\bec-select\b/.test(html), 'no element uses the EC-UI-2 control primitive (rule stays as documented exception)');
    assert.ok(/--ec-font-lg: 13px;/.test(html), 'the shared EC-UI-2 typography token is not changed by the field policy');
  });
  test('the only inline sub-16px field size is the legacy Pull Box v1 renderer, which is unreachable (#sub-pullbox display:none, no navigation route)', () => {
    const inline = [...html.matchAll(/<(select|input|textarea)[^>]*style="[^"]*font-size:\s*([0-9.]+)px/g)].map((m) => [m[1], parseFloat(m[2])]).filter((x) => x[1] < 16);
    assert.deepStrictEqual(inline, [['select', 12]], 'exactly one legacy inline size');
    assert.ok(/function pbSizeSelect\(val, side, idx\) \{\n  var sel = '<select style="[^']*font-size:12px/.test(html));
    assert.ok(/<div id="sub-pullbox" style="display:none;/.test(html), '#sub-pullbox is hidden markup');
    const tabs = /function switchTabMore\(name\) \{([\s\S]*?)\n\}/.exec(html)[1]; assert.ok(!/pullbox/.test(tabs), 'switchTabMore never shows sub-pullbox');
    const openTool = /function openTool\(toolId\) \{([\s\S]*?)\n\}/.exec(html)[1]; assert.ok(!/sub-pullbox/.test(openTool), 'openTool never shows sub-pullbox');
    const renderer = /function pbRenderRacewayList\(side\)\{([\s\S]*?)\n\}/.exec(html); assert.ok(renderer, 'legacy renderer present');
    assert.ok(/pbSizeSelect\(/.test(renderer[1]) && /Raceways/.test(renderer[1]), 'pbSizeSelect output lands only in the #pb…Raceways containers (inside #sub-pullbox)');
    const callers = [...html.matchAll(/pbSizeSelect\(/g)].length; assert.strictEqual(callers, 2, 'pbSizeSelect: its definition and the one legacy renderer call only');
  });
  test('the policy narrowed only field containers: V-Drop / Wire Sizer select caps and the Load Calc VA padding; nothing global', () => {
    assert.ok(rules.some((r) => r.selector === '#panel-vdrop .controls select, #panel-wiresizer .controls select' && /max-width: 100%/.test(r.body)));
    assert.ok(rules.some((r) => r.selector === '#panel-vdrop .controls .ctrl, #panel-wiresizer .controls .ctrl' && /max-width: 100%/.test(r.body) && /min-width: 0/.test(r.body)));
    assert.ok(rules.some((r) => r.selector === '#panel-more input[id^="lcPick_"][id$="_va"]' && /padding-left: 8px/.test(r.body) && !/width|font/.test(r.body)));
    const global = rules.filter((r) => /^(html|body|\*)$/.test(r.selector) && /font-size|zoom|transform/.test(r.body));
    assert.ok(global.every((r) => !/font-size: 16px !important|zoom|transform/.test(r.body)), 'no blanket size/zoom/transform rule');
    assert.ok(!/!important/.test(styles.map(stripComments).join('').match(/font-size:[^;]*/g).join(' ')), 'no !important font-size anywhere');
  });
});

describe('EC-UI-FOCUS-1 — behaviour and workarounds untouched', () => {
  test('chat composer markup and its handlers are the originals; Enter sends, Shift+Enter is a newline; autoResize caps at 140/scrollHeight', () => {
    assert.ok(/<textarea id="userInput"[^>]*onkeydown="handleKey\(event\)"[^>]*oninput="autoResize\(this\)"/.test(html) || /<textarea id="userInput"[^>]*oninput="autoResize\(this\)"[^>]*onkeydown="handleKey\(event\)"/.test(html));
    assert.ok(html.includes("function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }"));
    assert.ok(html.includes("function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }"));
    assert.ok(/<input type="password" id="apiKeyInput"/.test(html) || /<input[^>]*id="apiKeyInput"[^>]*type="password"/.test(html), 'API-key entry is still a password field');
  });
  test('no zoom lock, viewport change, text-size-adjust, CSS zoom/scale trick or JavaScript zoom reset was added', () => {
    assert.strictEqual((html.match(/name="viewport"/g) || []).length, 1, 'exactly one (unchanged, legacy) viewport meta — its user-scalable=no is separate accessibility debt');
    assert.ok(!/text-size-adjust/.test(html), 'no text-size-adjust');
    assert.ok(!/visualViewport/.test(html), 'no VisualViewport-based zoom reset');
    const css = styles.map(stripComments).join('\n');
    assert.ok(!/\bzoom\s*:\s*[0-9]/.test(css.replace(/\.p3d[^{]*\{[^}]*\}/g, '')) && !/transform:\s*scale\(/.test(css.replace(/\.p3d[^{]*\{[^}]*\}/g, '')), 'no CSS zoom/scale used on fields');
    assert.ok(!/touchmove[^;]*preventDefault/.test(html), 'no global touchmove preventDefault');
    assert.ok(!/\.blur\(\)[^\n]*(scrollTo|zoom)/.test(html) && !/(scrollTo|zoom)[^\n]*\.blur\(\)/.test(html), 'no blur+scroll workaround');
  });
});
