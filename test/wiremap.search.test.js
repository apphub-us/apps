'use strict';
/** Wire label search — WM-7. Pure ranking and normalization, run in Node. */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const S = require('../src/wiremap/search');
const model = require('../src/wiremap/model');

const SHEETS = [
  { id: 's1', name: 'Kitchen Plan', order: 0 },
  { id: 's2', name: 'Bedroom Plan', order: 1 },
  { id: 's3', name: 'Roof Plan', order: 2 },
];
const label = (id, sheetId, data) => model.createAnnotation({ id, sheetId, type: 'wireLabel',
  at: { x: 0.4, y: 0.5 }, now: 1, data });

const HR07_K = label('a1', 's1', { label: 'HR-07', from: 'Panel A', to: 'Kitchen',
  cable: '12/2 MC', room: 'Kitchen', notes: 'home run above ceiling' });
const HR08_B = label('a2', 's2', { label: 'HR-08', from: 'Panel A', to: 'Bedroom',
  cable: '12/2 MC', room: 'Bedroom' });
const HR07_R = label('a3', 's3', { label: 'HR-07', from: 'Panel B', to: 'Roof',
  cable: '10/2 MC', room: 'Roof' });
const ALL = [HR07_K, HR08_B, HR07_R];
const run = (q, anns, opts) => S.search(q, anns || ALL, SHEETS, opts);

describe('WM-7 query normalization', () => {
  test('an empty or blank query yields nothing and prompts', () => {
    for (const q of ['', '   ', null, undefined]) {
      const r = run(q);
      assert.strictEqual(r.query, null);
      assert.deepStrictEqual(r.results, []);
      assert.strictEqual(r.total, 0);
      assert.match(S.summarize(r), /Enter a wire label/);
    }
  });

  test('the query is trimmed', () => {
    assert.strictEqual(S.normalizeQuery('  HR-07  ').raw, 'HR-07');
  });

  test('THE SAME NORMALIZER AS THE MODEL — no second set of rules', () => {
    for (const q of ['HR-07', 'hr 07', 'HR_07', 'hr-07', '  HR 07 ']) {
      assert.strictEqual(S.normalizeQuery(q).labelKey, model.toLabelKey(q));
      assert.strictEqual(S.normalizeQuery(q).labelKey, 'hr-07');
    }
  });

  test('all three documented variants find the same labels', () => {
    const ids = (q) => run(q).results.map((r) => r.annotationId);
    assert.deepStrictEqual(ids('HR-07'), ['a1', 'a3']);
    assert.deepStrictEqual(ids('hr 07'), ['a1', 'a3']);
    assert.deepStrictEqual(ids('HR_07'), ['a1', 'a3']);
  });

  test('search is case-insensitive on metadata too', () => {
    assert.strictEqual(run('kitchen').total, run('KITCHEN').total);
    assert.ok(run('kitchen').total > 0);
  });
});

describe('WM-7 ranking', () => {
  test('an exact label match scores highest', () => {
    const r = run('HR-07');
    assert.strictEqual(r.results[0].rank, S.RANK.EXACT_LABEL);
    assert.strictEqual(r.results[0].matchedField, 'label');
  });

  test('EXACT LABEL OUTRANKS EVERY METADATA HIT', () => {
    // "Kitchen" is both a room and part of no label; add a label literally
    // named Kitchen so the two compete directly.
    const named = label('a9', 's2', { label: 'Kitchen', from: 'Panel C' });
    const r = run('Kitchen', ALL.concat([named]));
    assert.strictEqual(r.results[0].annotationId, 'a9');
    assert.strictEqual(r.results[0].rank, S.RANK.EXACT_LABEL);
    assert.ok(r.results.slice(1).every((x) => x.rank < S.RANK.EXACT_LABEL));
  });

  test('prefix beats substring, substring beats metadata', () => {
    const a = label('p1', 's1', { label: 'HR-071' });          // prefix of query? no: query prefix of it
    const b = label('p2', 's1', { label: 'XHR-07X' });         // substring
    const c = label('p3', 's1', { label: 'ZZ-1', room: 'HR-07 area' });
    const r = S.search('HR-07', [a, b, c], SHEETS);
    assert.strictEqual(r.results[0].annotationId, 'p1');
    assert.strictEqual(r.results[1].annotationId, 'p2');
    assert.strictEqual(r.results[2].annotationId, 'p3');
    assert.ok(r.results[0].rank > r.results[1].rank);
    assert.ok(r.results[1].rank > r.results[2].rank);
  });

  test('each metadata field is reachable and reports which one matched', () => {
    const cases = { 'Panel A': 'from', Bedroom: 'to', '12/2': 'cable',
      Roof: 'to', 'above ceiling': 'notes' };
    for (const [q, expected] of Object.entries(cases)) {
      const r = run(q);
      assert.ok(r.total > 0, `no result for ${q}`);
      assert.ok(r.results.some((x) => x.matchedField === expected),
        `${q} should match via ${expected}`);
    }
  });

  test('from outranks to, cable, room and notes', () => {
    assert.ok(S.RANK.FROM > S.RANK.TO);
    assert.ok(S.RANK.TO > S.RANK.CABLE);
    assert.ok(S.RANK.CABLE > S.RANK.ROOM);
    assert.ok(S.RANK.ROOM > S.RANK.NOTES);
  });

  test('ties break deterministically by sheet order, then label, then id', () => {
    const first = run('HR-07').results.map((r) => r.annotationId);
    for (let i = 0; i < 5; i++) {
      // Shuffling the input must not change the output order.
      const shuffled = [HR07_R, HR08_B, HR07_K];
      assert.deepStrictEqual(S.search('HR-07', shuffled, SHEETS).results
        .map((r) => r.annotationId), first);
    }
    assert.deepStrictEqual(first, ['a1', 'a3'], 'Kitchen (order 0) before Roof (order 2)');
  });

  test('a non-matching query returns a clean zero state', () => {
    const r = run('nonexistent-value');
    assert.strictEqual(r.total, 0);
    assert.deepStrictEqual(r.results, []);
    assert.match(S.summarize(r), /No matching wire labels/);
  });
});

describe('WM-7 duplicates and scope', () => {
  test('DUPLICATE LABELS ON TWO SHEETS BOTH APPEAR', () => {
    const r = run('hr 07');
    assert.strictEqual(r.total, 2);
    assert.deepStrictEqual(r.results.map((x) => x.sheetId), ['s1', 's3']);
    assert.deepStrictEqual(r.results.map((x) => x.sheetName), ['Kitchen Plan', 'Roof Plan']);
  });

  test('each result carries the sheet and annotation it belongs to', () => {
    const first = run('HR-07').results[0];
    assert.strictEqual(first.annotationId, 'a1');
    assert.strictEqual(first.sheetId, 's1');
    assert.deepStrictEqual(first.at, { x: 0.4, y: 0.5 });
  });

  test('only wire labels are searched', () => {
    const text = model.createAnnotation({ id: 'tx', sheetId: 's1', type: 'text',
      at: { x: 0.1, y: 0.1 }, data: { text: 'HR-07' }, now: 1 });
    const arrow = model.createAnnotation({ id: 'ar', sheetId: 's1', type: 'arrow',
      a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, now: 1 });
    const r = S.search('HR-07', [text, arrow], SHEETS);
    assert.strictEqual(r.total, 0, 'sketch text and arrows are out of scope for WM-7');
  });

  test('an unknown sheet id degrades gracefully rather than throwing', () => {
    const orphan = label('o1', 'missing', { label: 'HR-07' });
    const r = S.search('HR-07', [orphan], SHEETS);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.results[0].sheetName, '');
  });
});

describe('WM-7 result limit', () => {
  const many = (n, lbl) => Array.from({ length: n }, (_, i) =>
    label('m' + String(i).padStart(3, '0'), 's1', { label: lbl }));

  test('the visible list is capped but the total is preserved', () => {
    const r = S.search('HR-07', many(120, 'HR-07'), SHEETS);
    assert.strictEqual(r.results.length, S.MAX_VISIBLE_RESULTS);
    assert.strictEqual(r.total, 120);
    assert.strictEqual(r.truncated, true);
    assert.match(S.summarize(r), /50\+ results/);
  });

  test('EXACT MATCHES ARE NEVER DISPLACED BY THE CAP', () => {
    const metadata = many(80, 'ZZ-1').map((a) => ({ ...a,
      data: { label: 'ZZ-1', room: 'HR-07 zone' } }));
    const exact = label('exact', 's1', { label: 'HR-07' });
    const r = S.search('HR-07', metadata.concat([exact]), SHEETS);
    assert.strictEqual(r.results[0].annotationId, 'exact');
    assert.strictEqual(r.results[0].rank, S.RANK.EXACT_LABEL);
  });

  test('a custom limit is honoured', () => {
    const r = S.search('HR-07', many(10, 'HR-07'), SHEETS, { limit: 3 });
    assert.strictEqual(r.results.length, 3);
    assert.strictEqual(r.total, 10);
  });

  test('exactly at the cap is not reported as truncated', () => {
    const r = S.search('HR-07', many(50, 'HR-07'), SHEETS);
    assert.strictEqual(r.truncated, false);
    assert.match(S.summarize(r), /50 results/);
  });
});

describe('WM-7 robustness', () => {
  test('missing optional fields never throw or produce undefined ranks', () => {
    const bare = label('b1', 's1', { label: 'HR-07' });
    const r = S.search('HR-07', [bare], SHEETS);
    assert.strictEqual(r.results[0].from, '');
    assert.strictEqual(r.results[0].notes, '');
    assert.ok(Number.isFinite(r.results[0].rank));
  });

  test('malformed annotations are skipped rather than crashing', () => {
    const junk = [null, undefined, {}, { type: 'wireLabel' }, { type: 'wireLabel', data: null }];
    assert.strictEqual(S.search('HR-07', junk, SHEETS).total, 0);
  });

  test('every result carries a finite rank', () => {
    const r = run('12/2');
    assert.ok(r.total > 0);
    assert.ok(r.results.every((x) => Number.isFinite(x.rank)));
  });

  test('Unicode and punctuation search literally', () => {
    const uni = label('u1', 's1', { label: 'Zasilanie', room: 'kuchnia \u2013 pi\u0119tro' });
    assert.strictEqual(S.search('kuchnia', [uni], SHEETS).total, 1);
    assert.strictEqual(S.search('\u2013 pi\u0119tro', [uni], SHEETS).total, 1);
  });

  test('HTML-looking text is matched as a literal string, never interpreted', () => {
    const xss = label('x1', 's1', { label: 'HR-99', notes: '<script>alert(1)</script>' });
    const r = S.search('<script>', [xss], SHEETS);
    assert.strictEqual(r.total, 1);
    assert.strictEqual(r.results[0].notes, '<script>alert(1)</script>');
  });

  test('the module touches no DOM, storage or viewport', () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'src', 'wiremap', 'search.js'), 'utf8');
    assert.ok(!/document|window|indexedDB|innerHTML|require\('\.\/(store|viewport|app)/.test(src));
  });
});
