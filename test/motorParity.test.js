'use strict';
/**
 * Motor migration parity harness.
 *
 * `legacyDecision()` is the electrical decision logic of the PRE-MIGRATION
 * production `mtCalc()` (mobile.html), transcribed verbatim minus DOM: table
 * FLC lookup by phase/voltage/HP, 430.22 conductor requirement and the
 * copper-75C size scan, 430.52 percentage and next-standard-up device,
 * 430.110 disconnect at 115%, and the 430.32 nameplate x SF overload.
 *
 * PURPOSE: migration guard only — proves the shared engine reproduces every
 * shipped decision across the complete supported domain before production is
 * switched. NOT proof of NEC correctness; the code rules are hard-tested in
 * motor.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  MT_FLC_1PH, MT_V_1PH, MT_FLC_3PH, MT_V_3PH, MT_PCT, MT_STD, AMP_CU,
} = require('../src/calc/tables');
const { calculateMotorCircuit } = require('../src/calc/motor');

/** The pre-migration mtCalc decision, DOM stripped. Do not "improve" it. */
function legacyDecision(input) {
  const ph = String(input.phase);
  const vList = ph === '1' ? MT_V_1PH : MT_V_3PH;
  const table = ph === '1' ? MT_FLC_1PH : MT_FLC_3PH;
  const row = table[String(input.hp)];
  const flc = row ? row[vList.indexOf(String(input.volts))] : null;
  if (flc === null || flc === undefined) return { listed: false };

  const minAmp = flc * 1.25;
  let wire = null;
  const sizes = ['14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0',
    '3/0', '4/0', '250', '300', '350', '400', '500', '600', '700', '750'];
  for (const s of sizes) {
    const r = AMP_CU[s];
    if (r && r.t75 >= minAmp) { wire = s; break; }
  }

  const pct = MT_PCT[input.type][input.dev];
  const raw = (flc * pct) / 100;
  const nextStd = (x) => { for (const s of MT_STD) if (s >= x) return s; return null; };
  const std = nextStd(raw);
  const disc = nextStd(flc * 1.15);

  let overload = null;
  const np = parseFloat(input.nameplate);
  if (!Number.isNaN(np) && np > 0) overload = np * input.sf;

  return { listed: true, flc, minAmp, wire, pct, raw, std, disc, overload };
}

function engineDecision(input) {
  return calculateMotorCircuit({
    hp: input.hp,
    volts: input.volts,
    phase: Number(input.phase),
    motorType: input.type,
    ocpdType: input.dev,
    nameplateFLA: input.nameplate === '' ? null : parseFloat(input.nameplate),
    serviceFactorMultiplier: input.sf,
  });
}

const near = (a, b, label) => {
  if (a === null || b === null) {
    assert.strictEqual(a, b, label);
  } else {
    // The engine rounds to 2 dp for display; legacy carried raw floats and
    // formatted with toFixed(1). A raw x.xx5 rounds exactly 0.005 away, and
    // IEEE-754 puts that a hair over 0.005 — so the bound is 0.0051, still
    // 20x tighter than the 0.1 A resolution either path ever displayed.
    assert.ok(Math.abs(a - b) <= 0.0051, `${label}: legacy ${a} vs engine ${b}`);
  }
};

function compareCase(input, label) {
  const legacy = legacyDecision(input);
  const eng = engineDecision(input);
  if (!legacy.listed) {
    assert.strictEqual(eng.ok, false, label + ': engine must reject unlisted cell');
    assert.strictEqual(eng.reason, 'NOT_IN_TABLE', label);
    return;
  }
  assert.strictEqual(eng.ok, true, label + ': engine rejected: ' + eng.reason);
  assert.strictEqual(eng.tableFLC, legacy.flc, label + ' tableFLC');
  near(legacy.minAmp, eng.minConductorAmpacity, label + ' minConductorAmpacity');
  assert.strictEqual(eng.conductorSize, legacy.wire, label + ' conductorSize');
  assert.strictEqual(eng.protectionPercent, legacy.pct, label + ' protectionPercent');
  near(legacy.raw, eng.maxProtection, label + ' maxProtection');
  assert.strictEqual(eng.standardProtection, legacy.std, label + ' standardProtection');
  assert.strictEqual(eng.disconnectRating, legacy.disc, label + ' disconnectRating');
  near(legacy.overload, eng.overloadMax, label + ' overloadMax');
}

describe('Motor migration parity — legacy production decision vs shared engine', () => {
  const TYPES = Object.keys(MT_PCT);                    // designB, other, wound, dc
  const DEVS = Object.keys(MT_PCT.designB);             // nontd, dual, inst, inverse

  test('the COMPLETE table domain agrees: every phase x voltage x HP cell', () => {
    let cells = 0;
    for (const [phase, table, vList] of [['1', MT_FLC_1PH, MT_V_1PH],
      ['3', MT_FLC_3PH, MT_V_3PH]]) {
      for (const hp of Object.keys(table)) {
        for (const volts of vList) {
          compareCase({ phase, hp, volts, type: 'designB', dev: 'inverse',
            nameplate: '', sf: 1.25 }, `${phase}ph/${hp}HP/${volts}V`);
          cells++;
        }
      }
    }
    assert.ok(cells >= 170, 'full domain should be swept: ' + cells);
  });

  test('every motor type x device type combination agrees', () => {
    for (const type of TYPES) {
      for (const dev of DEVS) {
        compareCase({ phase: '3', hp: '10', volts: '208', type, dev,
          nameplate: '', sf: 1.25 }, `${type}/${dev}`);
        compareCase({ phase: '1', hp: '2', volts: '230', type, dev,
          nameplate: '', sf: 1.25 }, `1ph/${type}/${dev}`);
      }
    }
  });

  test('nameplate variants agree: absent, equal, differing, negative, zero', () => {
    for (const nameplate of ['', '30.8', '28.5', '-4', '0']) {
      for (const sf of [1.25, 1.15]) {
        compareCase({ phase: '3', hp: '10', volts: '208', type: 'designB',
          dev: 'dual', nameplate, sf }, `np=${nameplate || 'absent'}/sf${sf}`);
      }
    }
  });

  test('seeded random sweep across all axes agrees', () => {
    let seed = 0x430430;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const hps1 = Object.keys(MT_FLC_1PH);
    const hps3 = Object.keys(MT_FLC_3PH);
    for (let i = 0; i < 300; i++) {
      const phase = pick(['1', '3']);
      const input = {
        phase,
        hp: phase === '1' ? pick(hps1) : pick(hps3),
        volts: phase === '1' ? pick(MT_V_1PH) : pick(MT_V_3PH),
        type: pick(TYPES),
        dev: pick(DEVS),
        nameplate: pick(['', '3.3', '12', '28.5', '96']),
        sf: pick([1.25, 1.15]),
      };
      compareCase(input, 'random#' + i + ' ' + JSON.stringify(input));
    }
  });
});
