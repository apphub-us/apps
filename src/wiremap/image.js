'use strict';
/**
 * Wire Map — image ingestion.
 *
 * Turns a camera capture or picked file into a resized, compressed Blob that
 * store.js can persist. Processing lives here; persistence lives in store.js.
 * The two never overlap.
 *
 * The module is split deliberately:
 *
 *   PURE      dimension policy, MIME validation, quota arithmetic, record
 *             construction. Runs in Node, fully unit-tested.
 *   BROWSER   decode, canvas resize, encode. Needs a real engine; covered by
 *             the Chromium suite, and iOS behaviour still needs a device.
 *
 * A 4032x3024 iPhone photo is 3-5 MB. Ten of those would exhaust the storage
 * budget on their own, so resizing is not an optimisation here — it is what
 * makes the feature usable at all.
 */

/** Longer side of a stored image, in pixels. Enough to read a plan. */
const MAX_IMAGE_DIMENSION = 2000;

/** JPEG quality. Readable plan over photographic fidelity. */
const JPEG_QUALITY = 0.82;

const MIME_JPEG = 'image/jpeg';
const MIME_PNG = 'image/png';
const MIME_WEBP = 'image/webp';

/** Input types accepted for MVP. PDF is explicitly out of scope. */
const SUPPORTED_INPUT_MIME = [MIME_JPEG, MIME_PNG, MIME_WEBP];

/** Leave headroom rather than filling the origin's quota to the brim. */
const QUOTA_SAFETY_MARGIN = 0.9;

class ImageError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ImageError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const IMG_ERR = {
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  EMPTY_INPUT: 'EMPTY_INPUT',
  DECODE_FAILED: 'DECODE_FAILED',
  ENCODE_FAILED: 'ENCODE_FAILED',
  NO_CANVAS: 'NO_CANVAS',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  BAD_ARGUMENT: 'BAD_ARGUMENT',
};

// ── Pure policy ───────────────────────────────────────────────────────────

function isSupportedMime(mime) {
  return typeof mime === 'string'
    && SUPPORTED_INPUT_MIME.indexOf(mime.toLowerCase().trim()) !== -1;
}

/**
 * Target dimensions for a source image.
 *
 * Never upscales: a 1200x900 plan stays 1200x900 rather than being blown up to
 * 2000px of invented detail. Aspect ratio is preserved, and rounding keeps both
 * sides at least 1px so a sliver of an image cannot round away to zero.
 *
 * @returns {{width:number,height:number,resized:boolean,scale:number}|null}
 */
function computeTargetDimensions(sourceWidth, sourceHeight, maxDimension) {
  const max = Number.isFinite(maxDimension) && maxDimension > 0
    ? maxDimension : MAX_IMAGE_DIMENSION;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0 || sourceHeight <= 0) return null;

  const longer = Math.max(sourceWidth, sourceHeight);
  if (longer <= max) {
    return { width: sourceWidth, height: sourceHeight, resized: false, scale: 1 };
  }
  const scale = max / longer;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    resized: true,
    scale,
  };
}

/**
 * Which MIME to encode as.
 *
 * A PNG that needs no resize is kept byte-for-byte: re-encoding a crisp
 * screenshot of a panel schedule only makes the text worse. Everything else
 * becomes JPEG, which is far smaller for photographs. WebP input is normalised
 * to JPEG so retrieval never depends on WebP decode support.
 *
 * No content sniffing — the rule is the file type and whether a resize happened.
 */
function chooseOutputMime(inputMime, willResize) {
  const mime = typeof inputMime === 'string' ? inputMime.toLowerCase().trim() : '';
  if (mime === MIME_PNG && !willResize) return MIME_PNG;
  return MIME_JPEG;
}

/** Encoder quality for a target MIME. PNG is lossless and takes none. */
function qualityFor(mime) {
  return mime === MIME_JPEG || mime === MIME_WEBP ? JPEG_QUALITY : undefined;
}

/**
 * Decide whether a write of `bytes` fits.
 * An absent estimate is not a reason to refuse: plenty of engines omit it.
 */
function assessQuota(estimate, bytes) {
  if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) {
    return { known: false, fits: true, reason: 'ESTIMATE_UNAVAILABLE' };
  }
  const budget = estimate.quota * QUOTA_SAFETY_MARGIN;
  const remaining = budget - estimate.usage;
  return {
    known: true,
    fits: bytes <= remaining,
    usage: estimate.usage,
    quota: estimate.quota,
    remaining: Math.max(0, remaining),
    required: bytes,
  };
}

/** Build the record store.js persists. Timestamp supplied, never read here. */
function buildImageRecord(input) {
  const i = input || {};
  if (!i.id) throw new ImageError(IMG_ERR.BAD_ARGUMENT, 'an image record requires an id');
  if (!i.blob) throw new ImageError(IMG_ERR.BAD_ARGUMENT, 'an image record requires a blob');
  return {
    id: i.id,
    blob: i.blob,
    mime: i.mime || MIME_JPEG,
    width: i.width,
    height: i.height,
    bytes: Number.isFinite(i.bytes) ? i.bytes : (i.blob.size || 0),
    createdAt: Number.isFinite(i.createdAt) ? i.createdAt : 0,
  };
}

// ── Browser capabilities ──────────────────────────────────────────────────

function env(overrides) {
  const o = overrides || {};
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  // createImageBitmap must stay bound to its owner. Reading it off globalThis
  // and calling it as a property of some other object throws "Illegal
  // invocation", which would silently push every decode onto the fallback path
  // and lose EXIF orientation — the very problem this module exists to solve.
  const cib = Object.prototype.hasOwnProperty.call(o, 'createImageBitmap')
    ? o.createImageBitmap
    : (typeof g.createImageBitmap === 'function' ? g.createImageBitmap.bind(g) : undefined);
  return {
    createImageBitmap: cib,
    URL: o.URL || g.URL,
    document: o.document || g.document,
    Image: o.Image || g.Image,
    navigator: o.navigator || g.navigator,
    OffscreenCanvas: o.OffscreenCanvas || g.OffscreenCanvas,
  };
}

/**
 * Whether createImageBitmap honours imageOrientation.
 *
 * Not every WebKit build that exposes createImageBitmap supports the option,
 * and one that ignores it silently returns a sideways iPhone photo. Probing is
 * cheap; assuming is not.
 */
async function supportsImageOrientation(overrides) {
  const e = env(overrides);
  if (typeof e.createImageBitmap !== 'function') return false;
  let honoured = false;
  try {
    const probe = {
      get imageOrientation() { honoured = true; return 'from-image'; },
    };
    // A 1x1 transparent GIF is the smallest thing that decodes anywhere.
    const bytes = Uint8Array.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
      0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
      0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
    ]);
    const bmp = await e.createImageBitmap(new Blob([bytes], { type: 'image/gif' }), probe);
    if (bmp && typeof bmp.close === 'function') bmp.close();
  } catch (_) {
    return false;
  }
  return honoured;
}

/**
 * Decode a Blob to something drawable.
 *
 * Preferred path is createImageBitmap with imageOrientation:'from-image', which
 * applies EXIF rotation during decode. The fallback is an HTMLImageElement over
 * an object URL — modern browsers apply EXIF there too, but the URL must be
 * revoked or every import leaks a blob for the life of the page.
 *
 * @returns {{source:*, width:number, height:number, release:Function, path:string}}
 */
async function decodeImage(blob, overrides) {
  const e = env(overrides);
  if (!blob || !blob.size) throw new ImageError(IMG_ERR.EMPTY_INPUT, 'no image data was supplied');

  if (typeof e.createImageBitmap === 'function') {
    const oriented = await supportsImageOrientation(overrides);
    try {
      const bmp = oriented
        ? await e.createImageBitmap(blob, { imageOrientation: 'from-image' })
        : await e.createImageBitmap(blob);
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        path: oriented ? 'createImageBitmap+orientation' : 'createImageBitmap',
        release() { if (typeof bmp.close === 'function') bmp.close(); },
      };
    } catch (err) {
      // fall through to the element path rather than failing outright
    }
  }

  if (!e.URL || typeof e.URL.createObjectURL !== 'function' || typeof e.Image !== 'function') {
    throw new ImageError(IMG_ERR.DECODE_FAILED, 'no usable image decoder in this environment');
  }

  const url = e.URL.createObjectURL(blob);
  let released = false;
  const revoke = () => {
    if (!released) { released = true; e.URL.revokeObjectURL(url); }
  };
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new e.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageError(IMG_ERR.DECODE_FAILED, 'the image could not be decoded'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      path: 'HTMLImageElement',
      // The URL stays alive only until the caller has drawn from it.
      release() { revoke(); },
    };
  } catch (err) {
    revoke();
    throw err;
  }
}

function makeCanvas(width, height, e) {
  if (e.document && typeof e.document.createElement === 'function') {
    const c = e.document.createElement('canvas');
    c.width = width; c.height = height;
    return c;
  }
  if (typeof e.OffscreenCanvas === 'function') return new e.OffscreenCanvas(width, height);
  throw new ImageError(IMG_ERR.NO_CANVAS, 'no canvas implementation is available');
}

function canvasToBlob(canvas, mime, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mime, quality });
  }
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      // Older WebKit. toDataURL always exists and is the documented fallback.
      try {
        const url = canvas.toDataURL(mime, quality);
        const base64 = url.slice(url.indexOf(',') + 1);
        const bin = atob(base64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        resolve(new Blob([buf], { type: mime }));
      } catch (err) {
        reject(new ImageError(IMG_ERR.ENCODE_FAILED, 'the image could not be encoded'));
      }
      return;
    }
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new ImageError(IMG_ERR.ENCODE_FAILED, 'the image could not be encoded'));
    }, mime, quality);
  });
}

/**
 * Full ingestion: decode, resize if needed, encode.
 *
 * Memory discipline matters here more than anywhere else in Wire Map. iOS
 * Safari kills a page that holds too much canvas at once, so the decoded
 * bitmap is closed as soon as it has been drawn and the canvas is collapsed to
 * 1x1 before being dropped — a released reference alone does not free the
 * backing store promptly on WebKit.
 *
 * @param {Blob|File} file
 * @param {object} [options] maxDimension, quality, mime, now, and env overrides
 */
async function processImage(file, options) {
  const opts = options || {};
  const e = env(opts);

  if (!file || !file.size) throw new ImageError(IMG_ERR.EMPTY_INPUT, 'no image was supplied');
  const inputMime = (file.type || '').toLowerCase();
  if (!isSupportedMime(inputMime)) {
    throw new ImageError(IMG_ERR.UNSUPPORTED_TYPE,
      `${inputMime || 'this file type'} is not supported. Use JPEG, PNG or WebP.`,
      { received: inputMime, supported: SUPPORTED_INPUT_MIME.slice() });
  }

  const maxDimension = Number.isFinite(opts.maxDimension) ? opts.maxDimension : MAX_IMAGE_DIMENSION;

  const decoded = await decodeImage(file, opts);
  const originalWidth = decoded.width;
  const originalHeight = decoded.height;

  const target = computeTargetDimensions(originalWidth, originalHeight, maxDimension);
  if (!target) {
    decoded.release();
    throw new ImageError(IMG_ERR.DECODE_FAILED, 'the image reported no usable dimensions');
  }

  // A PNG that needs no resize is stored untouched — re-encoding a crisp
  // screenshot only degrades the text on it.
  const outputMime = opts.mime || chooseOutputMime(inputMime, target.resized);
  if (!target.resized && outputMime === inputMime && inputMime === MIME_PNG) {
    decoded.release();
    return {
      blob: file,
      mime: MIME_PNG,
      width: originalWidth,
      height: originalHeight,
      bytes: file.size,
      originalWidth,
      originalHeight,
      resized: false,
      reEncoded: false,
      decodePath: decoded.path,
    };
  }

  let canvas = null;
  try {
    canvas = makeCanvas(target.width, target.height, e);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError(IMG_ERR.NO_CANVAS, 'a 2D canvas context is not available');
    ctx.drawImage(decoded.source, 0, 0, target.width, target.height);

    // The source is no longer needed the moment it has been drawn.
    decoded.release();

    const quality = Number.isFinite(opts.quality) ? opts.quality : qualityFor(outputMime);
    const blob = await canvasToBlob(canvas, outputMime, quality);

    return {
      blob,
      mime: blob.type || outputMime,
      width: target.width,
      height: target.height,
      bytes: blob.size,
      originalWidth,
      originalHeight,
      resized: target.resized,
      reEncoded: true,
      decodePath: decoded.path,
    };
  } finally {
    decoded.release();   // idempotent; safe if the draw threw first
    if (canvas) {
      // Collapsing before dropping the reference is what actually frees the
      // backing store on WebKit.
      try { canvas.width = 1; canvas.height = 1; } catch (_) { /* OffscreenCanvas may refuse */ }
      canvas = null;
    }
  }
}

// ── Quota and persistence ─────────────────────────────────────────────────

/** Current storage estimate, or an unknown result where unsupported. */
async function getStorageEstimate(overrides) {
  const e = env(overrides);
  const s = e.navigator && e.navigator.storage;
  if (!s || typeof s.estimate !== 'function') return { known: false };
  try {
    const est = await s.estimate();
    return { known: true, usage: est.usage, quota: est.quota };
  } catch (_) {
    return { known: false };
  }
}

/** Throw before writing when the estimate says the write clearly will not fit. */
async function assertQuotaFor(bytes, overrides) {
  const estimate = await getStorageEstimate(overrides);
  const verdict = assessQuota(estimate.known ? estimate : null, bytes);
  if (verdict.known && !verdict.fits) {
    throw new ImageError(IMG_ERR.QUOTA_EXCEEDED,
      'There is not enough storage left on this device for that image.', verdict);
  }
  return verdict;
}

/**
 * Ask the browser to make storage persistent.
 *
 * Exposed, never called on load. Safari evicts IndexedDB after about a week
 * without a visit unless the site is installed, so a later sprint should ask at
 * a moment the request makes sense to the electrician — not on first paint.
 */
async function requestPersistentStorage(overrides) {
  const e = env(overrides);
  const s = e.navigator && e.navigator.storage;
  if (!s || typeof s.persist !== 'function') return { supported: false, persisted: false };
  try {
    return { supported: true, persisted: await s.persist() };
  } catch (_) {
    return { supported: true, persisted: false };
  }
}

/** Whether storage is already persistent, without prompting. */
async function isStoragePersisted(overrides) {
  const e = env(overrides);
  const s = e.navigator && e.navigator.storage;
  if (!s || typeof s.persisted !== 'function') return { supported: false, persisted: false };
  try {
    return { supported: true, persisted: await s.persisted() };
  } catch (_) {
    return { supported: true, persisted: false };
  }
}

module.exports = {
  MAX_IMAGE_DIMENSION,
  JPEG_QUALITY,
  QUOTA_SAFETY_MARGIN,
  SUPPORTED_INPUT_MIME,
  MIME_JPEG,
  MIME_PNG,
  MIME_WEBP,
  ImageError,
  IMG_ERR,
  isSupportedMime,
  computeTargetDimensions,
  chooseOutputMime,
  qualityFor,
  assessQuota,
  buildImageRecord,
  supportsImageOrientation,
  decodeImage,
  processImage,
  getStorageEstimate,
  assertQuotaFor,
  requestPersistentStorage,
  isStoragePersisted,
};
