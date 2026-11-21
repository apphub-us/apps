'use strict';
/**
 * Guard against literal `\uXXXX` text reaching the user.
 *
 * `\u2014` is a valid escape inside a JavaScript string — the engine converts
 * it before the text is inserted. It is NOT valid as literal text in static
 * HTML, where it renders verbatim as the six characters "\u2014".
 *
 * This suite therefore separates three cases:
 *   1. static HTML (outside <script>)  — an escape here is always a bug
 *   2. a DOUBLED backslash anywhere    — always emits literal text at runtime
 *   3. HTML held in JS string literals — evaluated, then checked
 *
 * Legitimate single-backslash escapes inside JavaScript must never fail here.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'mobile.html');
const skipAll = fs.existsSync(APP) ? false : 'mobile.html not found in the repository root';
const html = fs.existsSync(APP) ? fs.readFileSync(APP, 'utf8') : '';

const ESCAPE = /\\u[0-9a-fA-F]{4}/g;
const DOUBLE_ESCAPE = /\\\\u[0-9a-fA-F]{4}/g;

/** Byte mask marking every character that sits inside a <script> block. */
function scriptMask(src) {
  const mask = new Uint8Array(src.length);
  const re = /<script[^>]*>[\s\S]*?<\/script>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = 1;
  }
  return mask;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

describe('No literal Unicode escapes in user-facing HTML', { skip: skipAll }, () => {
  test('static HTML contains no \\uXXXX escape text', () => {
    const mask = scriptMask(html);
    const offenders = [];
    let m;
    ESCAPE.lastIndex = 0;
    while ((m = ESCAPE.exec(html)) !== null) {
      if (mask[m.index] === 1) continue; // inside JS — valid, skip
      offenders.push(`line ${lineOf(html, m.index)}: ${m[0]} …${
        html.slice(Math.max(0, m.index - 45), m.index + 25).replace(/\s+/g, ' ').trim()}…`);
    }
    assert.deepStrictEqual(offenders, [],
      `literal escapes in static HTML render verbatim to the user:\n  ${offenders.join('\n  ')}`);
  });

  test('no doubled backslash escape anywhere — those always emit literal text', () => {
    const offenders = [];
    let m;
    DOUBLE_ESCAPE.lastIndex = 0;
    while ((m = DOUBLE_ESCAPE.exec(html)) !== null) {
      offenders.push(`line ${lineOf(html, m.index)}: ${m[0]}`);
    }
    assert.deepStrictEqual(offenders, [],
      `a doubled backslash produces the characters, not the glyph:\n  ${offenders.join('\n  ')}`);
  });

  test('HTML held in CSR_CONTENT string literals renders without escape text', () => {
    const offenders = [];
    for (const line of html.split('\n')) {
      const m = line.match(/^CSR_CONTENT\['(\w+)'\] = ("[\s\S]*");?$/);
      if (!m) continue;
      let rendered;
      try {
        // eslint-disable-next-line no-new-func
        rendered = new Function('return ' + m[2])();
      } catch (e) {
        offenders.push(`CSR_CONTENT['${m[1]}'] did not evaluate: ${e.message}`);
        continue;
      }
      const left = rendered.match(ESCAPE);
      if (left) offenders.push(`CSR_CONTENT['${m[1]}'] still contains ${left.join(', ')}`);
    }
    assert.deepStrictEqual(offenders, []);
  });

  test('the specific characters that regressed before are written as entities or glyphs', () => {
    // Every one of these was rendered literally in a previous deployment.
    const samples = [
      ['All rooms', /(&lsaquo;|‹|&#8249;)\s*All rooms/],
      ['Tap to pin or unpin', /Tap to pin or unpin\s*(&mdash;|—)/],
      ['Size from TABLE FLC', /Size from TABLE FLC\s*(&mdash;|—)/],
      ['Squirrel cage', /Squirrel cage\s*(&mdash;|—)/],
      ['Inverse time breaker', /Inverse time breaker\s*(&mdash;|—)/],
      ['Overload only', /Overload only\s*(&mdash;|—)/],
      ['SF 1.15', /rise\s*(&le;|≤)\s*40(&deg;|°)C/],
    ];
    for (const [label, re] of samples) {
      assert.ok(re.test(html), `"${label}" is not written as a rendered character or entity`);
    }
  });

  test('POSITIVE CONTROL: the static-HTML check would catch a planted escape', () => {
    // Guards the guard. If the detector silently stopped working, this fails.
    const planted = html.replace('<div class="content">',
      '<div class="content"><span>\\u2014 planted</span>');
    const mask = scriptMask(planted);
    let caught = false;
    let m;
    ESCAPE.lastIndex = 0;
    while ((m = ESCAPE.exec(planted)) !== null) {
      if (mask[m.index] === 0) { caught = true; break; }
    }
    assert.strictEqual(caught, true, 'the detector failed to see a planted escape');
  });

  test('legitimate JavaScript escapes are NOT reported', () => {
    // The file genuinely contains single-backslash escapes inside JS strings.
    // They must be present and must not be treated as offenders.
    const mask = scriptMask(html);
    let inJs = 0;
    let m;
    ESCAPE.lastIndex = 0;
    while ((m = ESCAPE.exec(html)) !== null) if (mask[m.index] === 1) inJs++;
    assert.ok(inJs > 0,
      'expected some valid JS escapes; if this is zero the mask is broken, not the file');
  });
});
