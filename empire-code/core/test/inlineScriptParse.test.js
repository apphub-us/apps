'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   INLINE-SCRIPT PARSE GATE

   mobile.html ships its JavaScript inline. Every other test in this suite
   reaches that code by extracting INDIVIDUAL functions by name (fn3d) and
   evaluating them in isolation — which means a parse-time SyntaxError at
   script top level (an orphaned `return`, an extra `}`, a function boundary
   left unbalanced by a bulk edit) is invisible to the whole suite while the
   browser refuses to run the block at all. That is exactly what shipped
   after PBV2-13B-4.9B: "Uncaught SyntaxError: Illegal return statement" at
   the tail of a deleted builder, so ?pbv2=3d silently opened the normal app.

   This test parses EVERY inline <script> block with V8 (no execution), so a
   whole-block syntax regression fails here even when every extracted
   function is individually valid. Location-independent by design: it
   reports the offending line but asserts nothing about line numbers.
   ════════════════════════════════════════════════════════════════════════ */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = path.join(__dirname, '..', 'mobile.html');
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : null;
const skipAll = html ? false : 'mobile.html not found in the repository root';

/** Every inline <script> body with its 1-based starting line in the HTML. */
function inlineScripts(source) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(source))) {
    if (m[1] && /\ssrc=/.test(m[1])) continue;            // external script
    const body = m[2];
    if (!body.trim()) continue;
    const before = source.slice(0, m.index + m[0].indexOf('>') + 1);
    out.push({ body, startLine: before.split('\n').length });
  }
  return out;
}

/** Parse one script body; returns null or { message, htmlLine }. */
function parseError(script) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(script.body, { filename: 'mobile.html' });
    return null;
  } catch (e) {
    const at = (String(e.stack).match(/mobile\.html:(\d+)/) || [])[1];
    return { message: e.message,
      htmlLine: at ? Number(at) + script.startLine - 1 : null };
  }
}

describe('mobile.html inline scripts parse as a browser would run them', { skip: skipAll }, () => {
  const scripts = inlineScripts(html);

  test('the file has inline scripts to check', () => {
    assert.ok(scripts.length > 0, 'no inline <script> blocks found');
  });

  test('every inline <script> block is syntactically valid', () => {
    const failures = scripts.map((s, i) => ({ i, err: parseError(s) })).filter((r) => r.err);
    assert.deepStrictEqual(failures.map((f) => `block ${f.i + 1}: ${f.err.message}`
      + (f.err.htmlLine ? ` (mobile.html line ~${f.err.htmlLine})` : '')), [],
    'a SyntaxError here means the browser will refuse the whole block');
  });

  test('the PBV2 3D block specifically parses, so ?pbv2=3d can activate', () => {
    const pbv2 = scripts.filter((s) => s.body.includes('function pbv23dShouldOpen'));
    assert.strictEqual(pbv2.length, 1, 'exactly one PBV2 3D script block');
    assert.strictEqual(parseError(pbv2[0]), null, 'PBV2 block must parse');
    // and the activation sequence is intact in source form
    const b = pbv2[0].body;
    assert.ok(b.includes('pbv23dShouldOpen(window.location)'), 'QA gate present');
    assert.ok(b.includes("classList.add('show')"), 'reveals the surface');
    // PBV2-14: production opens through openPullBox() on the FAST default
    assert.ok(b.includes('function openPullBox()') && b.includes("pbv23dSetMode('fast')"), 'opens FAST via openPullBox');
  });

  test('a top-level return is rejected by this gate (self-check)', () => {
    // prove the gate detects the exact class of bug it exists for
    const broken = { body: 'function ok() { return 1; }\n  return "orphan";\n}\n', startLine: 1 };
    const err = parseError(broken);
    assert.ok(err && /Illegal return/.test(err.message), 'would catch an orphaned return');
  });
});
