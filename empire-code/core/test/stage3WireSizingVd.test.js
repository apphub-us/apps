'use strict';
/**
 * EC-AUDIT-FIX-1 stage 3 — EC-13: the Wire Sizer judges the voltage-drop limit on the UNROUNDED percentage.
 * Reference from the audit: 20 A, Cu, 120 V, 1-phase, 45.56421395348837 ft, 3 % -> #12 is 3.0003999999999995 %,
 * which rounds to 3.000 and used to be accepted.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/calc/wireSizing');
const V = require('../src/calc/voltageDrop');

const FEET = 45.56421395348837;
const base = { load: 20, material: 'cu', voltage: 120, phase: 1, insulation: 'thhn', ambientF: 86, adjustmentFactor: 1, terminalRatingC: 75 };
const row = (r, size) => r.evaluated.find((e) => e.size === size);
const drop12 = (feet) => V.calculateVoltageDrop({ amps: 20, feet, voltage: 120, phase: 1, material: 'cu', size: '12' });

test('EC-13 reference: #12 is 3.0004 % exact / 3.000 % rounded — above the 3 % limit, so it fails and #10 is selected', () => {
  const vd = drop12(FEET);
  assert.equal(vd.percentDrop, 3, 'the rounded display value is exactly the limit');
  assert.ok(vd.percentDropExact > 3 && Math.abs(vd.percentDropExact - 3.0003999999999995) < 1e-9, String(vd.percentDropExact));
  const r = W.selectConductor({ ...base, feet: FEET, maxVoltDropPercent: 3 });
  assert.equal(r.ok, true);
  const twelve = row(r, '12');
  assert.equal(twelve.ampacityOK, true); assert.equal(twelve.ocpdOK, true, 'only voltage drop is in question for #12');
  assert.equal(twelve.vdOK, false); assert.equal(twelve.passes, false); assert.equal(twelve.reason, 'VOLTAGE_DROP_EXCEEDS_LIMIT');
  assert.equal(twelve.voltDropPercent, 3, 'the reported figure is still the rounded display value: rounding formats, it does not decide');
  assert.equal(row(r, '10').vdOK, true); assert.equal(row(r, '10').passes, true);
  assert.equal(r.finalSelectedConductor, '10');
});

test('EC-13 boundary: exactly at the limit passes, a hair above fails, below passes', () => {
  const exact = drop12(FEET).percentDropExact;
  const at = W.selectConductor({ ...base, feet: FEET, maxVoltDropPercent: exact });
  assert.equal(row(at, '12').vdOK, true, 'drop == limit is within the limit'); assert.equal(at.finalSelectedConductor, '12');
  const above = W.selectConductor({ ...base, feet: FEET, maxVoltDropPercent: exact - 1e-9 });
  assert.equal(row(above, '12').vdOK, false); assert.equal(above.finalSelectedConductor, '10');
  const below = W.selectConductor({ ...base, feet: FEET, maxVoltDropPercent: exact + 1e-9 });
  assert.equal(row(below, '12').vdOK, true); assert.equal(below.finalSelectedConductor, '12');
});

test('EC-13: a run clearly inside the limit is unchanged, and a zero distance still skips the check', () => {
  const short = W.selectConductor({ ...base, feet: 45.5, maxVoltDropPercent: 3 });
  assert.ok(drop12(45.5).percentDropExact < 3);
  assert.equal(row(short, '12').vdOK, true); assert.equal(short.finalSelectedConductor, '12');
  const none = W.selectConductor({ ...base, feet: 0, maxVoltDropPercent: 3 });
  assert.equal(row(none, '12').vdOK, true); assert.equal(row(none, '12').voltDropPercent, null); assert.equal(none.finalSelectedConductor, '12');
});
