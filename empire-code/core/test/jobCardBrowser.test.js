'use strict';
/** Native browser acceptance stays distinct from the IDB transaction simulator. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../tools/check-job-card-browser');

test('native job-card IndexedDB: concurrency, abort, restart and versionchange', { timeout: 60000 }, async (t) => {
  const report = await run();
  if (report.status === 'SKIP') { t.skip(report.reason); return; }
  assert.equal(report.status, 'PASS', JSON.stringify(report));
  assert.equal(report.native, true);
  assert.ok(report.results.length >= 10, 'the complete native contract sequence must execute');
  assert.equal(report.results.filter((r) => !r.ok).length, 0, JSON.stringify(report));
});
