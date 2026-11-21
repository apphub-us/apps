'use strict';
/**
 * Test-only helpers for the Load Calc B1 suites. Nothing here is runtime code
 * and nothing here computes an expected value: expected objects come from the
 * unchanged r22 fixture bytes or from hand-written literals in the tests.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'loadCalc');
const CASES_FILE = path.join(FIXTURE_DIR, 'EC-CALC-2-A3-test-cases-r22.json');
const CASES_SHA = 'ec9f95f63c680d315dd3e5b827c61e183ee299b8babe73dea604bc884230703e';
const SCHEMA_SHA = 'a0d54e51ce14708544783648ec0edffa329cb261d85c6fafe66a7f0c58939c2f';

let cached = null;
function loadCases() {
  if (cached) return cached;
  const raw = fs.readFileSync(CASES_FILE);
  const sha = crypto.createHash('sha256').update(raw).digest('hex');
  if (sha !== CASES_SHA) throw new Error(`r22 fixture bytes changed: ${sha}`);
  cached = JSON.parse(raw.toString('utf8'));
  return cached;
}
function caseById(id) {
  const c = loadCases().cases.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
}
/** The 128 full envelope/result pairs (114 primary + 14 post-action). */
function enginePairs() {
  const pairs = [];
  for (const c of loadCases().cases) {
    if (c.expected && typeof c.expected === 'object' && 'status' in c.expected && c.kind !== 'math_model' && c.envelope) {
      pairs.push({ id: c.id, kind: c.kind, envelope: c.envelope, expected: c.expected, displayPrecision: c.displayPrecision || null });
    }
    (c.then || []).forEach((t, i) => pairs.push({ id: `${c.id}/then[${i}]`, kind: c.kind, step: t.step, envelope: t.envelope, expected: t.expected, displayPrecision: c.displayPrecision || null }));
  }
  return pairs;
}
function deepDiff(a, b, p, out) {
  const acc = out || [];
  if (typeof a !== typeof b || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) { acc.push({ path: p, actual: a, expected: b }); return acc; }
  if (a && typeof a === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) deepDiff(a[k], b[k], Array.isArray(a) ? `${p}[${k}]` : `${p}.${k}`, acc);
  } else if (!Object.is(a, b)) acc.push({ path: p, actual: a, expected: b });
  return acc;
}
function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze(v[k]); }
  return v;
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
/** Small deterministic PRNG (mulberry32) for bounded property checks. */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
module.exports = { FIXTURE_DIR, CASES_FILE, CASES_SHA, SCHEMA_SHA, loadCases, caseById, enginePairs, deepDiff, deepFreeze, clone, prng };
