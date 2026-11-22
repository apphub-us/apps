'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { egcSize, egcUpsized, gecSize, gecWithElectrodeCap } = require('../src/calc/grounding');

describe('EGC — NEC Table 250.122', () => {
  test('60 A device: #10 Cu, #8 Al', () => {
    assert.strictEqual(egcSize(60, 'cu'), '10');
    assert.strictEqual(egcSize(60, 'al'), '8');
  });
  test('100 A device: #8 Cu, #6 Al', () => {
    assert.strictEqual(egcSize(100, 'cu'), '8');
    assert.strictEqual(egcSize(100, 'al'), '6');
  });
  test('200 A device: #6 Cu', () => {
    assert.strictEqual(egcSize(200, 'cu'), '6');
  });
  test('a rating between rows takes the next row up, never down', () => {
    assert.strictEqual(egcSize(90, 'cu'), '8');  // 61-100 band
    assert.strictEqual(egcSize(61, 'cu'), '8');
  });
  test('1000 A device: 2/0 Cu', () => {
    assert.strictEqual(egcSize(1000, 'cu'), '2/0');
  });
});

describe('EGC proportional upsize — NEC 250.122(B)', () => {
  test('upsizing 4/0 to 300 kcmil on a 200 A feeder raises the EGC from #6 to #4', () => {
    const r = egcUpsized(200, '4/0', '300');
    assert.strictEqual(r.baseSize, '6');
    assert.strictEqual(r.upsizeApplied, true);
    assert.ok(Math.abs(r.ratio - 1.418) < 0.001);
    assert.strictEqual(r.finalSize, '4');
  });
  test('no upsize when the installed conductor equals the required one', () => {
    const r = egcUpsized(200, '3/0', '3/0');
    assert.strictEqual(r.upsizeApplied, false);
    assert.strictEqual(r.finalSize, '6');
  });
  test('the ratio is by circular mils, not by AWG step count', () => {
    const r = egcUpsized(100, '8', '4');
    assert.ok(Math.abs(r.ratio - (41740 / 16510)) < 0.001);
  });
});

describe('GEC — NEC Table 250.66', () => {
  test('#2 Cu service: #8 Cu GEC', () => {
    assert.strictEqual(gecSize('2', 'cu').copper, '8');
  });
  test('3/0 Cu service: #4 Cu GEC', () => {
    assert.strictEqual(gecSize('3/0', 'cu').copper, '4');
  });
  test('600 kcmil sits on the boundary and stays at 1/0', () => {
    assert.strictEqual(gecSize('600', 'cu').copper, '1/0');
  });
  test('750 kcmil crosses into the next band: 2/0', () => {
    assert.strictEqual(gecSize('750', 'cu').copper, '2/0');
  });
  test('250.66(A): to a rod the GEC need not exceed #6', () => {
    const r = gecWithElectrodeCap('3/0', 'cu', 'rod');
    assert.strictEqual(r.capApplied, true);
    assert.strictEqual(r.finalCopper, '6');
  });
  test('250.66(B): to a concrete-encased electrode the cap is #4', () => {
    const r = gecWithElectrodeCap('500', 'cu', 'ufer');
    assert.strictEqual(r.finalCopper, '4');
  });
  test('the cap is not applied when the table already asks for less', () => {
    const r = gecWithElectrodeCap('2', 'cu', 'rod'); // table says #8, cap is #6
    assert.strictEqual(r.capApplied, false);
    assert.strictEqual(r.finalCopper, '8');
  });
});

describe('Grounding migration — boundary and structured-result contracts', () => {
  const {
    calculateGrounding, ELECTRODE_CAP,
  } = require('../src/calc/grounding');
  const { GND_EGC, GND_CM, GND_SIZES } = require('../src/calc/tables');

  const base = {
    ocpdRating: 100, egcMaterial: 'cu', requiredPhaseSize: '3/0',
    installedPhaseSize: '3/0', serviceSize: '3/0', serviceMaterial: 'cu',
    electrode: 'water',
  };

  test('Table 250.122 boundaries: every threshold row, both materials, exact and just-over', () => {
    for (const [rating, cu, al] of GND_EGC) {
      const atCu = calculateGrounding({ ...base, ocpdRating: rating });
      assert.strictEqual(atCu.egc.baseSize, cu, `exact ${rating} A cu`);
      const atAl = calculateGrounding({ ...base, ocpdRating: rating, egcMaterial: 'al' });
      assert.strictEqual(atAl.egc.baseSize, al, `exact ${rating} A al`);
    }
    // one amp above a threshold lands on the NEXT row
    const over = calculateGrounding({ ...base, ocpdRating: 61 });
    assert.strictEqual(over.egc.baseSize, '8', '61 A is the 100 A row');
    // smallest and largest supported ratings
    assert.strictEqual(calculateGrounding({ ...base, ocpdRating: 1 }).egc.baseSize, '14');
    assert.strictEqual(calculateGrounding({ ...base, ocpdRating: 6000 }).egc.baseSize, '800');
    // above the table: structured failure, never a silent size
    const above = calculateGrounding({ ...base, ocpdRating: 6001 });
    assert.strictEqual(above.ok, false);
    assert.strictEqual(above.reason, 'OCPD_ABOVE_TABLE');
  });

  test('Table 250.66 boundaries: every range transition, both materials', () => {
    // Copper table transitions at 66360 (=#2) and 105600 (=1/0) CM etc.
    const cases = [
      ['2', 'cu', '8', '6'],       // exactly 66,360 stays in row 1
      ['1', 'cu', '6', '4'],       // 83,690 crosses into row 2
      ['1/0', 'cu', '6', '4'],     // exactly 105,600 stays in row 2
      ['2/0', 'cu', '4', '2'],     // 133,100 crosses into row 3
      ['14', 'cu', '8', '6'],      // smallest supported service conductor
      ['750', 'cu', '2/0', '4/0'], // largest supported service conductor
      ['1/0', 'al', '8', '6'],     // Al table: exactly 105,600 stays in row 1
      ['3/0', 'al', '6', '4'],     // Al table: exactly 167,800 stays in row 2
      ['750', 'al', '1/0', '3/0'], // largest, Al table
    ];
    for (const [svc, mat, cu, al] of cases) {
      const r = calculateGrounding({ ...base, serviceSize: svc, serviceMaterial: mat });
      assert.strictEqual(r.gec.copper, cu, `${svc}/${mat} copper`);
      assert.strictEqual(r.gec.aluminum, al, `${svc}/${mat} aluminum`);
    }
  });

  test('electrode caps: every cap value, beneficial and no-benefit directions', () => {
    // EC-01 (audit E08/G1): this assertion used to pin { rod, ufer, ring: '2' } and so
    // certified the defect — a ring cap applied without the ring ever being stated.
    // Only the two FIXED caps are constants now; the ring is an explicit input (below).
    assert.deepStrictEqual(ELECTRODE_CAP, { rod: '6', ufer: '4' });
    // 500 kcmil Cu service -> 1/0 Cu: both fixed caps beneficial.
    for (const [elec, capSize] of Object.entries(ELECTRODE_CAP)) {
      const r = calculateGrounding({ ...base, serviceSize: '500', electrode: elec });
      assert.strictEqual(r.gec.capApplied, true, elec);
      assert.strictEqual(r.gec.finalCopper, capSize, elec);
      assert.strictEqual(r.gec.resolved, true, elec);
      assert.strictEqual(r.gec.groundRing, null, elec + ': no ring fact outside the ring electrode');
      assert.ok(r.gec.capReference.includes('250.66'), elec);
    }
    // #14 service -> #8 Cu: rod cap (#6) is LARGER, no benefit, table stands.
    const noBen = calculateGrounding({ ...base, serviceSize: '14', electrode: 'rod' });
    assert.strictEqual(noBen.gec.capApplied, false);
    assert.strictEqual(noBen.gec.finalCopper, '8');
    // water: no cap concept at all
    const water = calculateGrounding({ ...base, serviceSize: '500' });
    assert.strictEqual(water.gec.capSize, null);
    assert.strictEqual(water.gec.capApplied, false);
    assert.strictEqual(water.gec.finalCopper, '1/0');
  });

  describe('EC-01 — ground ring: the reduction needs an explicitly stated ring', () => {
    const { GROUND_RING, GROUND_RING_CONFIRMED_SIZE, gecWithElectrodeCap: cap } = require('../src/calc/grounding');
    const ring = (extra) => calculateGrounding({ ...base, serviceSize: '500', electrode: 'ring', ...extra });

    test('audit case G1: 500 kcmil Cu + "Ground ring only" with NO stated ring gives no reduction and no final size', () => {
      // Independent reference: Table 250.66, copper service over 350 through 600 kcmil -> 1/0 Cu GEC.
      for (const input of [{}, { groundRing: undefined }, { groundRing: null }, { groundRing: 'unknown' }]) {
        const r = ring(input);
        assert.strictEqual(r.ok, true, JSON.stringify(input));
        assert.strictEqual(r.gec.copper, '1/0', 'the table row is still reported, as a reference');
        assert.strictEqual(r.gec.finalCopper, null, 'no final size without the ring fact');
        assert.strictEqual(r.gec.capApplied, false);
        assert.strictEqual(r.gec.capSize, null, 'no cap value is invented');
        assert.strictEqual(r.gec.resolved, false);
        assert.deepStrictEqual(r.gec.condition, { field: 'groundRing', code: 'GROUND_RING_UNCONFIRMED' });
        assert.strictEqual(r.gec.groundRing, 'unknown');
        assert.notStrictEqual(r.gec.finalCopper, '2', 'the old silent #2 must never come back');
      }
    });

    test('a larger / different / unverified ring is unsupported: never #2, never the table value presented as final', () => {
      const r = ring({ groundRing: GROUND_RING.OTHER });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.gec.finalCopper, null);
      assert.strictEqual(r.gec.capApplied, false);
      assert.strictEqual(r.gec.resolved, false);
      assert.deepStrictEqual(r.gec.condition, { field: 'groundRing', code: 'GROUND_RING_UNSUPPORTED' });
      assert.strictEqual(r.gec.copper, '1/0');
      assert.strictEqual(r.gec.aluminum, '3/0');
    });

    test('explicitly confirmed #2 AWG copper ring, sole connection: the existing reduction applies', () => {
      assert.strictEqual(GROUND_RING_CONFIRMED_SIZE, '2');
      const r = ring({ groundRing: GROUND_RING.CONFIRMED_CU_2AWG_SOLE });
      assert.strictEqual(r.gec.copper, '1/0');
      assert.strictEqual(r.gec.capSize, '2');
      assert.strictEqual(r.gec.capApplied, true);
      assert.strictEqual(r.gec.finalCopper, '2');
      assert.strictEqual(r.gec.resolved, true);
      assert.strictEqual(r.gec.condition, null);
      assert.strictEqual(r.gec.capReference, 'NEC 250.66(C)');
    });

    test('confirmed #2 ring on a small service: the table already asks for less, so #8 stays #8', () => {
      const r = calculateGrounding({ ...base, serviceSize: '14', electrode: 'ring', groundRing: 'cu_2awg_sole' });
      assert.strictEqual(r.gec.copper, '8');
      assert.strictEqual(r.gec.capApplied, false);
      assert.strictEqual(r.gec.finalCopper, '8');
      assert.strictEqual(r.gec.resolved, true);
    });

    test('every service size: an unconfirmed or unsupported ring never resolves, a confirmed one never exceeds the table row', () => {
      for (const svc of GND_SIZES) for (const mat of ['cu', 'al']) {
        const table = calculateGrounding({ ...base, serviceSize: svc, serviceMaterial: mat }).gec.copper;
        for (const g of ['unknown', 'other']) {
          const r = calculateGrounding({ ...base, serviceSize: svc, serviceMaterial: mat, electrode: 'ring', groundRing: g });
          assert.strictEqual(r.gec.finalCopper, null, `${svc}/${mat}/${g}`);
          assert.strictEqual(r.gec.copper, table, `${svc}/${mat}/${g} reference row`);
        }
        const ok = calculateGrounding({ ...base, serviceSize: svc, serviceMaterial: mat, electrode: 'ring', groundRing: 'cu_2awg_sole' });
        assert.ok(GND_CM[ok.gec.finalCopper] <= GND_CM[table], `${svc}/${mat} confirmed ring is never larger than the table`);
        assert.ok(GND_CM[ok.gec.finalCopper] <= GND_CM['2'] || ok.gec.finalCopper === table, `${svc}/${mat}`);
      }
    });

    test('an invalid ring value is refused with the field named; the ring input is ignored for other electrodes', () => {
      for (const bad of ['2', '4/0', 'yes', true, 2, {}]) {
        const r = ring({ groundRing: bad });
        assert.strictEqual(r.ok, false, String(bad));
        assert.strictEqual(r.reason, 'INVALID_GROUND_RING');
        assert.strictEqual(r.field, 'groundRing');
      }
      assert.strictEqual(cap('500', 'cu', 'ring', 'banana').reason, 'INVALID_GROUND_RING');
      assert.strictEqual(cap('500', 'cu', 'ring').finalCopper, null, 'the direct helper has no silent default either');
      // rod / ufer / water are untouched by any ring value, valid or not
      for (const g of [undefined, 'unknown', 'cu_2awg_sole', 'other', 'banana']) {
        assert.strictEqual(calculateGrounding({ ...base, serviceSize: '500', electrode: 'rod', groundRing: g }).gec.finalCopper, '6');
        assert.strictEqual(calculateGrounding({ ...base, serviceSize: '500', electrode: 'ufer', groundRing: g }).gec.finalCopper, '4');
        assert.strictEqual(calculateGrounding({ ...base, serviceSize: '500', electrode: 'water', groundRing: g }).gec.finalCopper, '1/0');
      }
    });

    test('the EGC section is independent of the ring fact', () => {
      const a = ring({}); const b = ring({ groundRing: 'cu_2awg_sole' }); const c = calculateGrounding({ ...base, serviceSize: '500' });
      assert.deepStrictEqual(a.egc, c.egc);
      assert.deepStrictEqual(b.egc, c.egc);
    });
  });

  test('250.122(B) boundaries: exact CM, between sizes, reversed, unmeetable', () => {
    // equal sizes: ratio 1, no upsize, final === base (no-downsize pin)
    const same = calculateGrounding(base);
    assert.strictEqual(same.egc.upsizeApplied, false);
    assert.strictEqual(same.egc.finalSize, same.egc.baseSize);
    // reversed (installed < required): ratio < 1 -> no upsize, never smaller
    const rev = calculateGrounding({ ...base, requiredPhaseSize: '4/0',
      installedPhaseSize: '1/0' });
    assert.strictEqual(rev.egc.upsizeApplied, false);
    assert.strictEqual(rev.egc.finalSize, rev.egc.baseSize);
    // one supported size larger: 1/0 -> 2/0 at 100 A cu: ratio 1.26042,
    // need = 16510 x (133100/105600) = 20809.47 -> rounds to 20809 -> #6
    // (26240) since #8 is 16510 < need.
    const oneUp = calculateGrounding({ ...base, requiredPhaseSize: '1/0',
      installedPhaseSize: '2/0' });
    assert.strictEqual(oneUp.egc.upsizeApplied, true);
    assert.strictEqual(oneUp.egc.finalSize, '6');
    assert.strictEqual(oneUp.egc.requiredCM, 20809);
    // exact CM landing: ratio 250->500 kcmil is exactly 2.0; 100 A base #8
    // needs 33020 CM — between #4 (41740) and #6 (26240) -> #4; and a true
    // exact hit: base #14 (15 A) with ratio x2 needs 8220 -> between #12
    // (6530)?? no: 8220 > 6530 -> #10 (10380). Pin the arithmetic verbatim.
    const dbl = calculateGrounding({ ...base, ocpdRating: 15,
      requiredPhaseSize: '250', installedPhaseSize: '500' });
    assert.strictEqual(dbl.egc.ratio, 2);
    assert.strictEqual(dbl.egc.requiredCM, 8220);
    assert.strictEqual(dbl.egc.finalSize, '10');
    // required CM exactly equal to a supported size is accepted, not skipped:
    // craft via ratio 66360/26240 on #6 req: base #8 (100 A) x 2.529 = 41752
    // is just ABOVE #4 41740 -> #3. Instead use base #14 with inst/req giving
    // integer landing: #14 base 4110; ratio 500/250 = 2 -> 8220 (already
    // pinned above as between). Exact-equality is pinned in the harness's
    // 25,830-case sweep; here pin the >= semantics explicitly:
    assert.ok(GND_CM['10'] >= 8220 && GND_CM['12'] < 8220,
      'selection is the FIRST size with CM >= required, never an earlier one');
    // unmeetable: explicit, never silently the base size
    const noFit = calculateGrounding({ ...base, ocpdRating: 2000,
      requiredPhaseSize: '4', installedPhaseSize: '750' });
    assert.strictEqual(noFit.egc.upsizeApplied, true);
    assert.strictEqual(noFit.egc.finalSize, null);
    assert.strictEqual(noFit.egc.exceedsAvailableSizes, true);
    // largest supported everything still terminates deterministically
    const big = calculateGrounding({ ...base, ocpdRating: 6000,
      requiredPhaseSize: '14', installedPhaseSize: '750' });
    assert.strictEqual(big.ok, true);
    assert.ok(big.egc.finalSize === null || GND_SIZES.includes(big.egc.finalSize));
  });

  test('invalid inputs fail with structured reasons — no silent Cu fallback, no NaN', () => {
    for (const bad of [0, -20, NaN, Infinity, '100']) {
      assert.strictEqual(calculateGrounding({ ...base, ocpdRating: bad })
        .reason, 'INVALID_OCPD', String(bad));
    }
    const badMat = calculateGrounding({ ...base, egcMaterial: 'steel' });
    assert.strictEqual(badMat.reason, 'INVALID_MATERIAL');
    assert.strictEqual(badMat.field, 'egcMaterial');
    const badSvcMat = calculateGrounding({ ...base, serviceMaterial: 'brass' });
    assert.strictEqual(badSvcMat.field, 'serviceMaterial');
    assert.strictEqual(calculateGrounding({ ...base, electrode: 'antenna' })
      .reason, 'INVALID_ELECTRODE');
    for (const field of ['requiredPhaseSize', 'installedPhaseSize', 'serviceSize']) {
      const r = calculateGrounding({ ...base, [field]: '9/0' });
      assert.strictEqual(r.reason, 'SIZE_NOT_IN_TABLE', field);
      assert.strictEqual(r.field, field);
    }
    assert.strictEqual(calculateGrounding({}).reason, 'INVALID_OCPD');
    assert.strictEqual(calculateGrounding(null).reason, 'INVALID_OCPD');
  });

  test('the structured result carries no HTML and no NaN anywhere', () => {
    const r = calculateGrounding({ ...base, requiredPhaseSize: '1/0',
      installedPhaseSize: '4/0', electrode: 'rod' });
    assert.ok(!JSON.stringify(r).includes('<'));
    const walk = (o) => Object.values(o).forEach((v) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v));
      else if (v && typeof v === 'object') walk(v);
    });
    walk(r);
  });
});
