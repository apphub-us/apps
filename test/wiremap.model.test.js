'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const m = require('../src/wiremap/model');

const NOW = 1_700_000_000_000;

describe('Wire Map model — Job', () => {
  const valid = () => m.createJob({ id: 'j1', name: 'Baylander', address: '1 Pier', now: NOW });

  test('a complete job validates', () => {
    assert.strictEqual(m.validateJob(valid()).valid, true);
  });

  test('a job needs an id and a name', () => {
    assert.deepStrictEqual(m.validateJob({ ...valid(), id: '' }).valid, false);
    assert.strictEqual(m.validateJob({ ...valid(), name: '   ' }).valid, false);
  });

  test('address is optional but must be a string when present', () => {
    assert.strictEqual(m.validateJob({ ...valid(), address: '' }).valid, true);
    const bad = m.validateJob({ ...valid(), address: { street: 'x' } });
    assert.strictEqual(bad.valid, false);
    assert.ok(bad.problems.some((p) => /address/.test(p)));
  });

  test('timestamps are required and must be numbers', () => {
    assert.strictEqual(m.validateJob({ ...valid(), createdAt: '2024' }).valid, false);
    assert.strictEqual(m.validateJob({ ...valid(), updatedAt: -1 }).valid, false);
  });

  test('non-objects are rejected without throwing', () => {
    for (const bad of [null, undefined, 'job', 42, []]) {
      const r = m.validateJob(bad);
      assert.strictEqual(r.valid, false, `${JSON.stringify(bad)} should be invalid`);
      assert.ok(Array.isArray(r.problems));
    }
  });

  test('problems name the offending field', () => {
    const r = m.validateJob({ ...valid(), name: '' });
    assert.ok(r.problems.some((p) => p.includes('name')), r.problems.join('; '));
  });
});

describe('Wire Map model — Sheet', () => {
  const photo = () => m.createSheet({
    id: 's1', jobId: 'j1', name: 'Floor 2', kind: 'photo',
    imageId: 'img1', width: 2000, height: 1500, order: 0, now: NOW,
  });
  const blank = () => m.createSheet({
    id: 's2', jobId: 'j1', name: 'Sketch', kind: 'blank',
    width: 1000, height: 1000, order: 1, now: NOW,
  });

  test('photo and blank sheets both validate', () => {
    assert.strictEqual(m.validateSheet(photo()).valid, true);
    assert.strictEqual(m.validateSheet(blank()).valid, true);
  });

  test('exactly three kinds are allowed', () => {
    assert.deepStrictEqual(m.SHEET_KINDS, ['photo', 'image', 'blank']);
    for (const kind of m.SHEET_KINDS) {
      const s = kind === 'blank' ? blank() : { ...photo(), kind };
      assert.strictEqual(m.validateSheet(s).valid, true, `${kind} should be allowed`);
    }
    assert.strictEqual(m.validateSheet({ ...photo(), kind: 'pdf' }).valid, false);
  });

  test('an image-backed sheet requires an imageId', () => {
    const r = m.validateSheet({ ...photo(), imageId: '' });
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => /imageId/.test(p)));
  });

  test('a blank sheet must not reference an image', () => {
    const r = m.validateSheet({ ...blank(), imageId: 'img9' });
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => /blank sheet/.test(p)));
  });

  test('dimensions are required even for a blank sheet — they define the aspect ratio', () => {
    assert.strictEqual(m.validateSheet({ ...blank(), width: 0 }).valid, false);
    assert.strictEqual(m.validateSheet({ ...blank(), height: -5 }).valid, false);
  });

  test('order must be a non-negative integer', () => {
    assert.strictEqual(m.validateSheet({ ...photo(), order: 1.5 }).valid, false);
    assert.strictEqual(m.validateSheet({ ...photo(), order: -1 }).valid, false);
    assert.strictEqual(m.validateSheet({ ...photo(), order: 0 }).valid, true);
  });

  test('createSheet gives a blank sheet a null imageId', () => {
    assert.strictEqual(m.createSheet({ kind: 'blank' }).imageId, null);
  });
});

describe('Wire Map model — label keys', () => {
  test('the documented example normalises as specified', () => {
    assert.strictEqual(m.toLabelKey('HR-07'), 'hr-07');
  });

  test('case, padding and separators collapse to one form', () => {
    for (const input of ['HR-07', 'hr-07', '  HR-07  ', 'HR 07', 'hr_07', 'HR--07']) {
      assert.strictEqual(m.toLabelKey(input), 'hr-07', `failed for ${JSON.stringify(input)}`);
    }
  });

  test('leading and trailing separators are dropped', () => {
    assert.strictEqual(m.toLabelKey('-HR-07-'), 'hr-07');
  });

  test('non-strings yield an empty key rather than throwing', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      assert.strictEqual(m.toLabelKey(bad), '');
    }
  });

  test('distinct labels keep distinct keys', () => {
    assert.notStrictEqual(m.toLabelKey('HR-07'), m.toLabelKey('HR-7'));
  });
});

describe('Wire Map model — Annotation', () => {
  const wireLabel = () => m.createAnnotation({
    id: 'a1', sheetId: 's1', type: 'wireLabel', at: { x: 0.42, y: 0.63 }, now: NOW,
    data: {
      label: 'HR-7', from: 'Panel A / Circuit 18', to: 'Master Bedroom receptacles',
      cable: '12/2 MC', room: 'Master Bedroom', notes: 'Home run',
    },
  });
  const arrow = () => m.createAnnotation({
    id: 'a2', sheetId: 's1', type: 'arrow',
    a: { x: 0.1, y: 0.1 }, b: { x: 0.8, y: 0.4 }, now: NOW,
  });

  test('a complete wire label validates', () => {
    assert.strictEqual(m.validateAnnotation(wireLabel()).valid, true);
  });

  test('all five types are accepted', () => {
    assert.deepStrictEqual(m.ANNOTATION_TYPES, ['wireLabel', 'arrow', 'line', 'rect', 'text']);
    for (const type of ['arrow', 'line', 'rect']) {
      assert.strictEqual(m.validateAnnotation({ ...arrow(), type }).valid, true, type);
    }
    const text = m.createAnnotation({
      id: 'a3', sheetId: 's1', type: 'text', at: { x: 0.5, y: 0.5 },
      data: { text: 'Attic access' }, now: NOW,
    });
    assert.strictEqual(m.validateAnnotation(text).valid, true);
  });

  test('an unknown type is rejected', () => {
    const r = m.validateAnnotation({ ...wireLabel(), type: 'polygon' });
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => /type must be one of/.test(p)));
  });

  test('coordinates outside 0..1 are rejected, not silently clamped', () => {
    assert.strictEqual(m.validateAnnotation({ ...wireLabel(), at: { x: 1.2, y: 0.5 } }).valid, false);
    assert.strictEqual(m.validateAnnotation({ ...wireLabel(), at: { x: -0.1, y: 0.5 } }).valid, false);
    assert.strictEqual(m.validateAnnotation({ ...wireLabel(), at: { x: 0, y: 1 } }).valid, true);
  });

  test('non-numeric coordinates are rejected', () => {
    assert.strictEqual(m.validateAnnotation({ ...wireLabel(), at: { x: '0.5', y: 0.5 } }).valid, false);
    assert.strictEqual(m.validateAnnotation({ ...wireLabel(), at: { x: NaN, y: 0.5 } }).valid, false);
  });

  test('two-point shapes need both endpoints', () => {
    assert.strictEqual(m.validateAnnotation({ ...arrow(), b: undefined }).valid, false);
  });

  test('two-point shapes store endpoints, never length and angle', () => {
    const a = arrow();
    assert.ok('a' in a && 'b' in a);
    assert.ok(!('length' in a) && !('angle' in a));
  });

  test('a wire label needs a label', () => {
    const bad = m.createAnnotation({ ...wireLabel(), data: { label: '' } });
    assert.strictEqual(m.validateAnnotation(bad).valid, false);
  });

  test('labelKey is derived automatically and must stay consistent', () => {
    assert.strictEqual(wireLabel().data.labelKey, 'hr-7');
    const tampered = wireLabel();
    tampered.data.labelKey = 'something-else';
    const r = m.validateAnnotation(tampered);
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => /labelKey/.test(p)));
  });

  test('all six wire-label fields are carried', () => {
    const d = wireLabel().data;
    for (const f of ['label', 'from', 'to', 'cable', 'room', 'notes']) {
      assert.ok(f in d, `missing field ${f}`);
    }
    assert.strictEqual(d.cable, '12/2 MC');
    assert.strictEqual(d.room, 'Master Bedroom');
  });

  test('a text annotation requires its text', () => {
    const t = m.createAnnotation({
      id: 'a4', sheetId: 's1', type: 'text', at: { x: 0.5, y: 0.5 }, data: {}, now: NOW,
    });
    assert.strictEqual(m.validateAnnotation(t).valid, false);
  });

  test('sheetId is required — an annotation cannot float free of a sheet', () => {
    assert.strictEqual(m.validateAnnotation({ ...wireLabel(), sheetId: '' }).valid, false);
  });
});
