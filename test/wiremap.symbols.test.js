'use strict';
/**
 * WM-9A — symbol library contract.
 * Pure data: the definitions the plan renderer AND the picker both resolve.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const lib = require('../src/wiremap/symbols');

const EXPECTED = [
  ['outlet.simplex', 'Simplex Receptacle', 'Outlets'],
  ['outlet.duplex', 'Duplex Receptacle', 'Outlets'],
  ['outlet.gfci', 'GFCI Receptacle', 'Outlets'],
  ['outlet.dedicated', 'Dedicated Receptacle', 'Outlets'],
  ['switch.single', 'Single-Pole Switch', 'Switches'],
  ['switch.threeWay', '3-Way Switch', 'Switches'],
  ['switch.fourWay', '4-Way Switch', 'Switches'],
  ['light.ceiling', 'Ceiling Light', 'Lighting'],
  ['light.recessed', 'Recessed Light', 'Lighting'],
  ['device.smoke', 'Smoke Detector', 'Devices'],
  ['device.thermostat', 'Thermostat', 'Devices'],
];

describe('WM-9A symbol library', () => {
  test('exactly the eleven WM-9A symbols, in permanent order', () => {
    assert.deepStrictEqual(lib.list().map((s) => [s.key, s.name, s.category]), EXPECTED);
  });

  test('all keys are unique', () => {
    const keys = lib.list().map((s) => s.key);
    assert.strictEqual(new Set(keys).size, keys.length);
  });

  test('all display names are non-empty and unique', () => {
    const names = lib.list().map((s) => s.name);
    assert.ok(names.every((n) => typeof n === 'string' && n.trim().length > 0));
    assert.strictEqual(new Set(names).size, names.length);
  });

  test('every category is one of the four picker sections', () => {
    assert.deepStrictEqual(lib.categories(), ['Outlets', 'Switches', 'Lighting', 'Devices']);
    for (const s of lib.list()) {
      assert.ok(lib.categories().indexOf(s.category) !== -1, s.key);
    }
  });

  test('category iteration is deterministic and covers all eleven', () => {
    const flat = [];
    lib.categories().forEach((c) => lib.inCategory(c).forEach((s) => flat.push(s.key)));
    assert.deepStrictEqual(flat, EXPECTED.map((e) => e[0]));
    // called twice, byte-identical order
    const again = [];
    lib.categories().forEach((c) => lib.inCategory(c).forEach((s) => again.push(s.key)));
    assert.deepStrictEqual(again, flat);
  });

  test('lookup: known keys resolve, unknown keys return null', () => {
    assert.strictEqual(lib.get('outlet.duplex').name, 'Duplex Receptacle');
    assert.strictEqual(lib.get('outlet.notyet'), null);
    assert.strictEqual(lib.isKnown('device.smoke'), true);
    assert.strictEqual(lib.isKnown(''), false);
  });

  test('forRender never returns null: unknown keys get the placeholder', () => {
    assert.strictEqual(lib.forRender('outlet.duplex').key, 'outlet.duplex');
    const ph = lib.forRender('made.up.key');
    assert.strictEqual(ph, lib.PLACEHOLDER);
    assert.ok(ph.primitives.some((p) => p.t === 'text' && p.text === '?'),
      'the placeholder shows a neutral ? glyph');
  });

  test('every definition has the fixed 24×24 viewBox', () => {
    for (const s of lib.list().concat([lib.PLACEHOLDER])) {
      assert.strictEqual(s.viewBox, '0 0 24 24', s.key);
    }
  });

  test('every primitive is a valid shape with finite geometry', () => {
    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    for (const s of lib.list().concat([lib.PLACEHOLDER])) {
      assert.ok(s.primitives.length > 0, s.key);
      for (const p of s.primitives) {
        if (p.t === 'circle') {
          assert.ok(finite(p.cx) && finite(p.cy) && finite(p.r) && p.r > 0, s.key);
        } else if (p.t === 'line') {
          assert.ok(finite(p.x1) && finite(p.y1) && finite(p.x2) && finite(p.y2), s.key);
        } else if (p.t === 'rect') {
          assert.ok(finite(p.x) && finite(p.y) && finite(p.w) && finite(p.h)
            && p.w > 0 && p.h > 0, s.key);
        } else if (p.t === 'path') {
          assert.ok(typeof p.d === 'string' && p.d.length > 0, s.key);
        } else if (p.t === 'text') {
          assert.ok(finite(p.x) && finite(p.y) && finite(p.size) && p.size > 0, s.key);
          assert.ok(typeof p.text === 'string' && p.text.length > 0
            && p.text.length <= 4, s.key + ': fixed internal identifiers only');
        } else {
          assert.fail(s.key + ': unknown primitive kind ' + p.t);
        }
        // geometry must sit inside the 24×24 box (with stroke margin)
        for (const k of ['cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'x', 'y']) {
          if (p[k] !== undefined) assert.ok(p[k] >= -1 && p[k] <= 25, s.key + '.' + k);
        }
      }
    }
  });

  test('the revised keys exist alongside every previously persisted key', () => {
    for (const k of ['outlet.simplex', 'outlet.dedicated', 'switch.fourWay',
      'outlet.duplex', 'outlet.gfci', 'switch.single', 'switch.threeWay']) {
      assert.ok(lib.isKnown(k), k);
    }
  });

  test('outlet convention: one mark, two marks, GF-only circle, D-only circle', () => {
    const marks = (k) => lib.get(k).primitives.filter((p) => p.t === 'line').length;
    const texts = (k) => lib.get(k).primitives.filter((p) => p.t === 'text');
    assert.strictEqual(marks('outlet.simplex'), 1);
    assert.strictEqual(texts('outlet.simplex').length, 0);
    assert.strictEqual(marks('outlet.duplex'), 2);
    assert.strictEqual(texts('outlet.duplex').length, 0);
    // GFCI and Dedicated are ONLY circle + identifier — no receptacle bars
    for (const [k, glyph] of [['outlet.gfci', 'GF'], ['outlet.dedicated', 'D']]) {
      assert.strictEqual(marks(k), 0, k);
      const prims = lib.get(k).primitives;
      assert.strictEqual(prims.length, 2, k);
      assert.strictEqual(prims.filter((p) => p.t === 'circle').length, 1, k);
      assert.strictEqual(texts(k).length, 1, k);
      assert.strictEqual(texts(k)[0].text, glyph, k);
    }
  });

  test('switch convention: S-family glyphs S, S3, S4 — never a $ character', () => {
    const glyphs = (k) => lib.get(k).primitives
      .filter((p) => p.t === 'text').map((p) => p.text);
    assert.deepStrictEqual(glyphs('switch.single'), ['S']);
    assert.deepStrictEqual(glyphs('switch.threeWay'), ['S', '3']);
    assert.deepStrictEqual(glyphs('switch.fourWay'), ['S', '4']);
    for (const s of lib.list()) {
      for (const p of s.primitives) {
        if (p.t === 'text') assert.ok(p.text.indexOf('$') === -1, s.key);
      }
    }
  });

  test('preview and plan resolve the SAME definition object', () => {
    for (const s of lib.list()) {
      assert.strictEqual(lib.forRender(s.key), lib.get(s.key),
        s.key + ': one definition, one source of truth');
    }
  });
});
