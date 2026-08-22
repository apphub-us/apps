'use strict';
/**
 * Wire Map image pipeline — the PURE half.
 *
 * These prove the policy: dimension maths, MIME rules, quota arithmetic, record
 * shape. They prove nothing about decoding, canvas or encoding — that needs a
 * real engine and is covered by the Chromium suite. iOS remains a manual gate.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const img = require('../src/wiremap/image');

describe('WM-3 image — constants', () => {
  test('the resize target and quality are single named constants', () => {
    assert.strictEqual(img.MAX_IMAGE_DIMENSION, 2000);
    assert.strictEqual(img.JPEG_QUALITY, 0.82);
  });

  test('supported input types are JPEG, PNG and WebP — no PDF', () => {
    assert.deepStrictEqual(img.SUPPORTED_INPUT_MIME, ['image/jpeg', 'image/png', 'image/webp']);
    assert.strictEqual(img.isSupportedMime('application/pdf'), false);
  });
});

describe('WM-3 image — target dimensions', () => {
  const t = (w, h, max) => img.computeTargetDimensions(w, h, max);

  test('an iPhone photo comes down to the documented size', () => {
    assert.deepStrictEqual(t(4032, 3024), { width: 2000, height: 1500, resized: true, scale: 2000 / 4032 });
  });

  test('a smaller image is never upscaled', () => {
    assert.deepStrictEqual(t(1200, 900), { width: 1200, height: 900, resized: false, scale: 1 });
    assert.deepStrictEqual(t(50, 20), { width: 50, height: 20, resized: false, scale: 1 });
  });

  test('exactly the maximum is left alone', () => {
    const r = t(2000, 1000);
    assert.strictEqual(r.resized, false);
    assert.strictEqual(r.width, 2000);
  });

  test('one pixel over the maximum does resize', () => {
    assert.strictEqual(t(2001, 1000).resized, true);
    assert.strictEqual(t(2001, 1000).width, 2000);
  });

  test('portrait scales on its longer side too', () => {
    const r = t(3024, 4032);
    assert.strictEqual(r.height, 2000);
    assert.strictEqual(r.width, 1500);
  });

  test('aspect ratio is preserved to within a pixel of rounding', () => {
    for (const [w, h] of [[4032, 3024], [3000, 1000], [999, 4000], [1234, 5678], [8000, 8000]]) {
      const r = t(w, h);
      const before = w / h;
      const after = r.width / r.height;
      assert.ok(Math.abs(before - after) / before < 0.002,
        `ratio drifted for ${w}x${h}: ${before} -> ${after}`);
    }
  });

  test('an extreme panorama keeps at least one pixel on the short side', () => {
    const r = t(20000, 5);
    assert.strictEqual(r.width, 2000);
    assert.ok(r.height >= 1, 'the short side rounded away to zero');
  });

  test('a custom maximum is honoured', () => {
    assert.strictEqual(t(4000, 2000, 500).width, 500);
  });

  test('nonsense dimensions return null rather than NaN', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-5, 5], [NaN, 100], [Infinity, 10]]) {
      assert.strictEqual(t(w, h), null, `${w}x${h} should be rejected`);
    }
  });
});

describe('WM-3 image — output format policy', () => {
  test('a PNG that needs no resize stays PNG', () => {
    assert.strictEqual(img.chooseOutputMime('image/png', false), 'image/png');
  });

  test('a PNG that must be resized is re-encoded as JPEG', () => {
    // Documented explicitly: resizing means re-encoding, and JPEG is far
    // smaller for a scaled plan than PNG.
    assert.strictEqual(img.chooseOutputMime('image/png', true), 'image/jpeg');
  });

  test('JPEG input always yields JPEG', () => {
    assert.strictEqual(img.chooseOutputMime('image/jpeg', false), 'image/jpeg');
    assert.strictEqual(img.chooseOutputMime('image/jpeg', true), 'image/jpeg');
  });

  test('WebP is normalised to JPEG so retrieval never needs WebP decode', () => {
    assert.strictEqual(img.chooseOutputMime('image/webp', false), 'image/jpeg');
  });

  test('case and padding in the MIME do not change the decision', () => {
    assert.strictEqual(img.chooseOutputMime('  IMAGE/PNG ', false), 'image/png');
  });

  test('quality applies to lossy formats only', () => {
    assert.strictEqual(img.qualityFor('image/jpeg'), 0.82);
    assert.strictEqual(img.qualityFor('image/png'), undefined);
  });
});

describe('WM-3 image — quota arithmetic', () => {
  test('a comfortable write is allowed', () => {
    const v = img.assessQuota({ quota: 1_000_000, usage: 100_000 }, 50_000);
    assert.strictEqual(v.known, true);
    assert.strictEqual(v.fits, true);
  });

  test('a write beyond the safety margin is refused', () => {
    // 90% of 1 MB is 900 KB; 850 KB already used leaves 50 KB.
    const v = img.assessQuota({ quota: 1_000_000, usage: 850_000 }, 200_000);
    assert.strictEqual(v.fits, false);
    assert.strictEqual(v.remaining, 50_000);
  });

  test('headroom is left rather than filling the quota completely', () => {
    assert.strictEqual(img.QUOTA_SAFETY_MARGIN, 0.9);
    const v = img.assessQuota({ quota: 1000, usage: 0 }, 950);
    assert.strictEqual(v.fits, false, 'a write must not be allowed to fill the last 10%');
  });

  test('an unavailable estimate does NOT block the write', () => {
    for (const bad of [null, undefined, {}, { quota: NaN, usage: 0 }]) {
      const v = img.assessQuota(bad, 1_000_000);
      assert.strictEqual(v.known, false);
      assert.strictEqual(v.fits, true, 'a missing estimate must not stop storage');
    }
  });

  test('remaining never reports a negative figure', () => {
    const v = img.assessQuota({ quota: 1000, usage: 5000 }, 10);
    assert.strictEqual(v.remaining, 0);
  });
});

describe('WM-3 image — record construction', () => {
  const blob = { size: 12345, type: 'image/jpeg' };

  test('a record carries every field store.js persists', () => {
    const r = img.buildImageRecord({
      id: 'img1', blob, mime: 'image/jpeg', width: 2000, height: 1500,
      bytes: 12345, createdAt: 1700,
    });
    assert.deepStrictEqual(Object.keys(r).sort(),
      ['blob', 'bytes', 'createdAt', 'height', 'id', 'mime', 'width'].sort());
    assert.strictEqual(r.bytes, 12345);
  });

  test('bytes fall back to the blob size', () => {
    assert.strictEqual(img.buildImageRecord({ id: 'i', blob }).bytes, 12345);
  });

  test('an id and a blob are both required', () => {
    assert.throws(() => img.buildImageRecord({ blob }), (e) => e.code === img.IMG_ERR.BAD_ARGUMENT);
    assert.throws(() => img.buildImageRecord({ id: 'i' }), (e) => e.code === img.IMG_ERR.BAD_ARGUMENT);
  });

  test('the record satisfies the store contract', async () => {
    const store = require('../src/wiremap/store');
    const { createMemoryDriver } = require('./wiremapMemoryDriver');
    const db = store.createStore({ driver: createMemoryDriver() });
    await db.openDatabase();
    const record = img.buildImageRecord({ id: 'img1', blob, width: 2000, height: 1500, createdAt: 1 });
    await db.putImage(record);
    const got = await db.getImage('img1');
    assert.strictEqual(got.width, 2000);
    assert.strictEqual(got.bytes, 12345);
    await db.deleteImage('img1');
    assert.strictEqual(await db.getImage('img1'), null);
    db.closeDatabase();
  });
});

describe('WM-3 image — unsupported input', () => {
  test('a PDF is refused with a clear, actionable message', async () => {
    await assert.rejects(
      () => img.processImage({ size: 100, type: 'application/pdf' }),
      (e) => {
        assert.strictEqual(e.code, img.IMG_ERR.UNSUPPORTED_TYPE);
        assert.ok(/JPEG, PNG or WebP/.test(e.message), e.message);
        assert.deepStrictEqual(e.detail.supported, img.SUPPORTED_INPUT_MIME);
        return true;
      },
    );
  });

  test('an empty file is refused', async () => {
    await assert.rejects(() => img.processImage({ size: 0, type: 'image/jpeg' }),
      (e) => e.code === img.IMG_ERR.EMPTY_INPUT);
    await assert.rejects(() => img.processImage(null),
      (e) => e.code === img.IMG_ERR.EMPTY_INPUT);
  });

  test('a file with no type is refused rather than guessed at', async () => {
    await assert.rejects(() => img.processImage({ size: 100, type: '' }),
      (e) => e.code === img.IMG_ERR.UNSUPPORTED_TYPE);
  });
});

describe('WM-3 image — capability probes degrade safely', () => {
  test('no navigator.storage yields an unknown estimate, not a throw', async () => {
    assert.deepStrictEqual(await img.getStorageEstimate({ navigator: {} }), { known: false });
  });

  test('a throwing estimate is treated as unknown', async () => {
    const nav = { storage: { estimate: () => Promise.reject(new Error('denied')) } };
    assert.deepStrictEqual(await img.getStorageEstimate({ navigator: nav }), { known: false });
  });

  test('assertQuotaFor allows the write when the estimate is unknown', async () => {
    const v = await img.assertQuotaFor(999_999_999, { navigator: {} });
    assert.strictEqual(v.fits, true);
  });

  test('assertQuotaFor throws before writing when it clearly will not fit', async () => {
    const nav = { storage: { estimate: async () => ({ quota: 1000, usage: 900 }) } };
    await assert.rejects(() => img.assertQuotaFor(5000, { navigator: nav }), (e) => {
      assert.strictEqual(e.code, img.IMG_ERR.QUOTA_EXCEEDED);
      assert.ok(/not enough storage/i.test(e.message));
      return true;
    });
  });

  test('persistence is reported, never forced', async () => {
    assert.deepStrictEqual(await img.requestPersistentStorage({ navigator: {} }),
      { supported: false, persisted: false });
    let asked = false;
    const nav = { storage: { persist: async () => { asked = true; return true; } } };
    assert.deepStrictEqual(await img.requestPersistentStorage({ navigator: nav }),
      { supported: true, persisted: true });
    assert.strictEqual(asked, true);
  });

  test('isStoragePersisted checks without prompting', async () => {
    const nav = { storage: { persisted: async () => false, persist: () => { throw new Error('must not prompt'); } } };
    assert.deepStrictEqual(await img.isStoragePersisted({ navigator: nav }),
      { supported: true, persisted: false });
  });

  test('orientation support is probed, not assumed', async () => {
    assert.strictEqual(await img.supportsImageOrientation({ createImageBitmap: undefined }), false);
    // An engine that ignores the option must be reported as unsupported.
    const ignores = async () => ({ width: 1, height: 1, close() {} });
    assert.strictEqual(await img.supportsImageOrientation({ createImageBitmap: ignores }), false);
  });

  test('REGRESSION: createImageBitmap is bound to its owner', async () => {
    // Reading it off globalThis and calling it as a property of another object
    // throws "Illegal invocation" in Chromium and WebKit. That failure is
    // caught internally, so the only visible symptom is a silent fall back to
    // the non-orientation path — a sideways iPhone photo with no error.
    let receivedThis = 'never called';
    const fakeGlobal = {
      createImageBitmap(...args) { receivedThis = this; return Promise.resolve({ width: 1, height: 1, close() {} }); },
    };
    const saved = globalThis.createImageBitmap;
    globalThis.createImageBitmap = fakeGlobal.createImageBitmap;
    try {
      await img.supportsImageOrientation();
      assert.strictEqual(receivedThis, globalThis,
        'createImageBitmap was invoked with the wrong `this`');
    } finally {
      if (saved === undefined) delete globalThis.createImageBitmap;
      else globalThis.createImageBitmap = saved;
    }
  });

  test('an explicit override still wins over the global', async () => {
    assert.strictEqual(await img.supportsImageOrientation({ createImageBitmap: undefined }), false);
  });

  test('decoding without any decoder fails clearly', async () => {
    await assert.rejects(
      () => img.decodeImage({ size: 10 }, { createImageBitmap: undefined, URL: undefined, Image: undefined }),
      (e) => e.code === img.IMG_ERR.DECODE_FAILED,
    );
  });
});
