'use strict';
/**
 * EC-CALC-2 / B1-r1 — bounded corrections for the independent review findings
 * R-B1-01..04 (see docs/load-calc-b1.md §9). Class R1: explicit executable
 * assertions against the actual engine / input / state modules. The same cases
 * run against disposable mutants in tools/loadcalc-core-check.js --mutants.
 * "B1 before" behaviour is recorded in each case title and in
 * review/logs/r1-cases-before-on-B1.log of the B1-r1 review bundle.
 */
const { test, describe } = require('node:test');
const { CASES } = require('./helpers/loadCalcR1Cases');

const mods = { engine: require('../src/calc/loadCalc'), input: require('../src/calc/loadCalcInput'), state: require('../src/calc/loadCalcState') };
for (const finding of ['R-B1-01', 'R-B1-02', 'R-B1-03', 'R-B1-04']) {
  describe(`R1 — ${finding}`, () => {
    for (const c of CASES.filter((x) => x.finding === finding)) test(`${c.id} — ${c.title}`, () => c.check(mods));
  });
}
