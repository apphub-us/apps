'use strict';
/**
 * Stub DOM / storage for executing the shipped Load Calc adapter (mobile.html)
 * in Node. Supports exactly what the adapter uses: createElement, createTextNode,
 * getElementById, querySelector(All) with simple selectors, appendChild /
 * removeChild / firstChild, textContent, value / checked / validity, classList,
 * style, setAttribute, addEventListener + a dispatch helper. Text is only ever
 * text: there is no HTML parser, so an innerHTML write would be visible as a
 * property, never as nodes.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'mobile.html'), 'utf8');

function fnBody(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function not found: ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { depth++; started = true; } else if (html[j] === '}') { depth--; if (started && depth === 0) return html.slice(i, j + 1); } }
  throw new Error('unbalanced: ' + name);
}
function adapterSource() {
  const i = html.indexOf('// ── LOAD CALCULATION — EC-CALC-2 / B2 thin adapter');
  const j = html.indexOf('// ── FAVORITES SYSTEM', i);
  if (i === -1 || j === -1) throw new Error('adapter block not found');
  return html.slice(i, j);
}
function generatedEC() {
  const s = html.indexOf('<!-- EC-CALC:START'); const e = html.indexOf('<!-- EC-CALC:END -->');
  let block = html.slice(s, e); block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  const win = {}; new Function('window', block)(win); return win.EC;   // eslint-disable-line no-new-func
}

function makeDocument() {
  const byId = {}; const root = { children: [] };
  const matchSimple = (el, sel) => {
    const m = /^([a-z]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(sel.trim()); if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const c of (m[2] || '').split('.').filter(Boolean)) if (!el._classes.has(c)) return false;
    for (const a of (m[3] || '').match(/\[[^\]]+\]/g) || []) { const [k, v] = a.slice(1, -1).split('='); const val = v ? v.replace(/^["']|["']$/g, '') : undefined; if (k === 'type' ? el.type !== val : (el.attrs[k] === undefined || (val !== undefined && el.attrs[k] !== val))) return false; }
    return true;
  };
  const walk = (el, out) => { for (const c of el.children) { if (c.tagName !== '#text') { out.push(c); walk(c, out); } } return out; };
  const query = (from, selector) => { const all = walk(from, []); const parts = selector.split(',').map((p) => p.trim()); return all.filter((el) => parts.some((p) => { const chain = p.split(/\s+/); return matchSimple(el, chain[chain.length - 1]); })); };
  function mkEl(tag) {
    const el = { tagName: tag.toUpperCase(), _id: '', className: '', _classes: new Set(), children: [], parent: null, style: {}, attrs: {}, listeners: {}, value: '', checked: false, validity: { badInput: false }, type: tag === 'input' ? 'text' : undefined, title: '', innerHTMLWrites: 0 };
    Object.defineProperty(el, 'id', { get() { return el._id; }, set(v) { el._id = v; if (v) byId[v] = el; } });
    Object.defineProperty(el, 'textContent', { get() { return el.tagName === '#text' ? el._text : el.children.map((c) => c.textContent).join(''); }, set(v) { el.children = []; if (v !== '') el.children.push(mkText(String(v))); } });
    Object.defineProperty(el, 'innerText', { get() { return el.textContent; } });
    Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; } });
    Object.defineProperty(el, 'parentNode', { get() { return el.parent; } });
    Object.defineProperty(el, 'innerHTML', { get() { return ''; }, set() { el.innerHTMLWrites++; } });
    el.classList = { add: (c) => { el._classes.add(c); }, remove: (c) => { el._classes.delete(c); }, toggle: (c, on) => { if (on === undefined) on = !el._classes.has(c); if (on) el._classes.add(c); else el._classes.delete(c); return on; }, contains: (c) => el._classes.has(c) };
    Object.defineProperty(el, 'className', { get() { return [...el._classes].join(' '); }, set(v) { el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); } });
    el.appendChild = (c) => { if (c.parent) c.parent.removeChild(c); c.parent = el; el.children.push(c); return c; };
    el.removeChild = (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parent = null; return c; };
    el.remove = () => { if (el.parent) el.parent.removeChild(el); };
    el.setAttribute = (k, v) => { el.attrs[k] = String(v); if (k === 'type') el.type = String(v); };
    el.getAttribute = (k) => (el.attrs[k] === undefined ? null : el.attrs[k]);
    el.removeAttribute = (k) => { delete el.attrs[k]; };
    el.contains = (other) => { for (let n = other; n; n = n.parent) if (n === el) return true; return false; };
    el.addEventListener = (t, f) => { (el.listeners[t] = el.listeners[t] || []).push(f); };
    el.matches = (sel) => matchSimple(el, sel);
    el.closest = (sel) => { let cur = el; while (cur && cur.tagName) { if (cur.tagName !== '#text' && matchSimple(cur, sel)) return cur; cur = cur.parent; } return null; };
    el.hasAttribute = (k) => el.attrs[k] !== undefined;
    // EC-UI-LAYOUT-REFS-1: dispatch runs the document's CAPTURE listeners first (the shipped delegated reference
    // handler lives there); a listener that stops propagation prevents the element's own listeners, like a browser
    el.dispatch = (t, ev) => {
      let stopped = false; const event = Object.assign({ target: el, key: undefined, preventDefault() {}, stopPropagation() { stopped = true; } }, ev || {});
      for (const f of docListeners.capture[t] || []) { f.call(document, event); if (stopped) return; }
      for (const f of el.listeners[t] || []) f.call(el, event);
    };
    el.querySelectorAll = (sel) => query(el, sel); el.querySelector = (sel) => query(el, sel)[0] || null;
    // LC-UI-CALCULATE-1: focus / scroll are recorded so tests can assert the target (and that normal edits never scroll)
    el.scrollIntoView = (o) => { focusLog.scrolls.push(el); focusLog.scrollOpts.push(o); }; el.click = () => el.dispatch('click');
    el.focus = () => { focusLog.active = el; focusLog.focuses.push(el); };
    return el;
  }
  function mkText(t) { return { tagName: '#text', _text: t, children: [], get textContent() { return this._text; }, parent: null }; }
  const docListeners = { capture: {}, bubble: {} };
  const focusLog = { active: null, focuses: [], scrolls: [], scrollOpts: [] };
  const document = { createElement: (t) => mkEl(t), createTextNode: (t) => mkText(String(t)), getElementById: (id) => byId[id] || null, querySelectorAll: (sel) => query(root, sel), querySelector: (sel) => query(root, sel)[0] || null, body: root,
    addEventListener: (t, f, capture) => { const bag = capture ? docListeners.capture : docListeners.bubble; (bag[t] = bag[t] || []).push(f); }, listeners: docListeners, focusLog };
  Object.defineProperty(document, 'activeElement', { get() { return focusLog.active; } });
  const container = mkEl('div'); container.id = 'lcContent'; root.children.push(container); container.parent = root;
  return { document, byId, root, container, mkEl, walk: (el) => walk(el, []) };
}

function makeStorage(initial, byKey) {
  // LC-SERVICE-RESULT-STORE-1: data remains the old writable Favorites alias; other keys have separate bytes.
  const store = { data: initial === undefined ? null : initial, byKey: Object.assign(Object.create(null), byKey || {}), failNextSet: null, sets: 0 };
  const keys = () => (store.data === null ? [] : ['sparky_favorites']).concat(Object.keys(store.byKey).filter((k) => k !== 'sparky_favorites'));
  const localStorage = {
    getItem: (k) => k === 'sparky_favorites' ? store.data : Object.hasOwn(store.byKey, k) ? store.byKey[k] : null,
    setItem: (k, v) => { store.sets++; if (store.failNextSet) { const e = store.failNextSet; store.failNextSet = null; throw e; } if (k === 'sparky_favorites') store.data = String(v); else Object.defineProperty(store.byKey, k, { value: String(v), writable: true, configurable: true, enumerable: true }); },
    key: (i) => keys()[i] === undefined ? null : keys()[i],
    removeItem: () => {},
    clear: () => { store.data = null; store.byKey = Object.create(null); }
  };
  Object.defineProperty(localStorage, 'length', { get: () => keys().length });
  return { store, localStorage };
}

/**
 * Execute the real adapter + Favorites functions.
 *   `opts.facade(EC)` may return a replacement for EC.loadCalcFacade (counting / poisoning / throwing at the
 *   REAL call site the adapter uses: loadCalcFacade.evaluateV2). Applied to a copy of the generated EC.
 *   `opts.engine(EC)` (historical A hook, LC-22082-B0-UI-INTEGRATION-1 ledger L-1): the adapter no longer
 *   calls EC.loadCalc.evaluate directly, so this hook is kept only as a facade wrapper that hands the
 *   accepted facade's A envelope projection to the replacement A engine for non-82 routes — a test
 *   scaffold, never production dispatch. Prefer `facade`.
 *   `opts.missing` (array of EC module ids) removes modules from the copy to test the clear-failure path.
 */
function buildHarness(opts) {
  const o = opts || {};
  const dom = makeDocument(); const st = makeStorage(o.storage, o.storageByKey);
  const baseEC = generatedEC();
  let EC = baseEC;
  if (o.engine) {
    const engine = o.engine(baseEC);
    const wrapped = Object.assign({}, baseEC.loadCalcFacade, { evaluateV2: (request) => {
      if (request && request.snapshot && request.snapshot.method && request.snapshot.method.selected === 'opt_220_82') return baseEC.loadCalcFacade.evaluateV2(request);
      baseEC.loadCalcInputV2.assertRequestV2(request);
      const envA = baseEC.loadCalcInputV2.downConvertToA(request);
      return { facade: { apiVersion: 2, capabilityProfile: 'AB82_core1', engine: 'A', engineProfileId: baseEC.loadCalc.PROFILE.id, engineRuleStatus: null, importGuard: 'not_applicable', testHook: 'engine' }, result: engine.evaluate(envA) };
    } });
    EC = Object.assign({}, baseEC, { loadCalc: engine, loadCalcFacade: wrapped });
  }
  if (o.facade) EC = Object.assign({}, EC, { loadCalcFacade: o.facade(EC) });
  if (o.missing) { EC = Object.assign({}, EC); for (const id of o.missing) delete EC[id]; }
  // LC-JOB-CARD-1: optional controlled async seam; ordinary tests keep the actual generated factory.
  if (typeof o.jobStoreFactory === 'function') EC = Object.assign({}, EC, { jobCardStore: { createJobStore: o.jobStoreFactory } });
  if (typeof o.measurementStoreFactory === 'function') EC = Object.assign({}, EC, { jobMeasurementStore: { createMeasurementStore: o.measurementStoreFactory } });
  if (typeof o.materialStoreFactory === 'function') EC = Object.assign({}, EC, { jobMaterialStore: { createMaterialStore: o.materialStoreFactory } });
  if (typeof o.photoStoreFactory === 'function') EC = Object.assign({}, EC, { jobPhotoStore: { createPhotoStore: o.photoStoreFactory } });
  if (o.archiveCapture) EC = Object.assign({}, EC, { jobArchiveSource: Object.assign({}, EC.jobArchiveSource, { capture: o.archiveCapture }) });
  if (o.archiveDecode) EC = Object.assign({}, EC, { jobArchiveFile: Object.assign({}, EC.jobArchiveFile, { decode: o.archiveDecode }) });
  if (o.restoreStoreFactory) EC = Object.assign({}, EC, { jobRestoreStore: { createRestoreStore: o.restoreStoreFactory } });
  const necCalls = []; const prompts = { answer: o.promptAnswer === undefined ? 'preset' : o.promptAnswer, calls: [] };
  // EC-UI-LAYOUT-REFS-1: the shared source-aware reference layer (used by the adapter) and its delegated handler run verbatim too
  const editions = (html.match(/var EC_NEC_EDITION = '[^']+', EC_NYCEC_EDITION = '[^']+';/) || [''])[0];
  const refLayer = editions + '\n' + ['necRefInfo', 'necQuestion', 'refAttr', 'refSpanHtml', 'refSpanFromText', 'refSpanNode'].map(fnBody).join('\n') + '\n(' + fnBody('installRefDelegation') + ')();\n';
  const src = refLayer + adapterSource() + "\nvar FAV_KEY = 'sparky_favorites';\n" + ['favState', 'favStorage', 'favEnv', 'favRead', 'favGetAll', 'favRefresh', 'favSettle', 'favExport', 'favRetry', 'favReset', 'favStatusNode', 'favGetValues', 'favSetValues', 'favGetLabel', 'favSave', 'favLoad', 'favDelete', 'favRender'].map(fnBody).join('\n')
    + '\nexports.api = { lcDraft, lcTxn, lcAllocLoadId, lcAllocBasisId, lcConfirmMethodAfterImport, lcLegacyContract, LC_FIELDS_LCV2, LC_LOAD_SUBFIELDS_LCV2, LC_CAPABILITY_PROFILE, LC_STORE_VERSION, lcInit, lcUpdate, lcReset, lcExportState, lcFavSave, lcFavRestore, lcFavPayload, lcFavLabel, lcFavValidatePayload, lcFieldActive, lcCalculate, LC_CALC, favGetValues, favSetValues, favGetLabel, favLoad, favDelete, favRender, favGetAll, favSave, lcGuideRecommendation, lcRevealedConductors, lcModelOptions, LC: LC, LC_SVC: LC_SVC, lcSvcAssess, lcSvcDesignObject, LC_RECORD_PREFIX, lcRecordRefresh, lcRecordOpen, lcRecordClose, lcRecordSave, LC_JOB, lcJobNew, lcJobOpen, lcJobRefresh, lcJobSave, lcJobHistory, lcJobHistorical, lcJobLatest, lcJobDiscard, lcJobOpenResult, LC_MEAS, lcMeasRefresh, lcMeasEdit, lcMeasSave, lcMeasOpen, LC_MAT, lcMatRefresh, lcMatEdit, lcMatSave, lcMatOpen, LC_PHOTO, lcPhotoRefresh, lcPhotoEdit, lcPhotoSave, lcPhotoChoose, lcPhotoOpen, lcPhotoOpenOriginal, lcPhotoCloseView, lcPhotoRelease, LC_ARC, lcArcExport, lcArcOpenFile, lcArcCancel, lcArcClear, lcArcRender, LC_RESTORE, lcRestoreRun, lcRestoreRecover, lcRestoreReady };';   // B2-r1: + lcFavValidatePayload, lcFieldActive (exposure only); LC-SERVICE-UI-1: + LC_SVC, lcSvcAssess, lcSvcDesignObject (exposure only)
  const exp = {};
  const necCallsFull = []; const win = {};
  if (o.photoDecode) win.createImageBitmap = o.photoDecode;
  if (o.photoURL) win.URL = o.photoURL;
  if (o.crypto !== null) win.crypto = o.crypto === undefined ? require('node:crypto').webcrypto : o.crypto;
  // LC-JOB-CARD-1: native or simulated IDB is injected only when explicitly requested.
  if (Object.hasOwn(o, 'indexedDB')) win.indexedDB = o.indexedDB;
  // necLink transport stub: records the reference, the explicit opts and the REAL prepared question (necQuestion + necRefInfo are the shipped functions)
  // EC-03: Favorites mutations require a Web Locks manager. This stand-in grants the lock and runs the callback
  // immediately, so the shipped critical section (fresh read, validation, write, read-back) executes inside the call
  // and the long-standing synchronous assertions on the stored bytes stay meaningful. `o.locks: null` removes it.
  const lockLog = { ran: 0, last: undefined };
  const favNavigator = { locks: o.locks === undefined ? { request: (name, opts, cb) => { try { const out = cb({ name }); lockLog.ran++; lockLog.last = out; return Promise.resolve(out); } catch (e) { return Promise.reject(e); } } } : o.locks };
  // EC-03 (Load Calc, stage 3): the shipped lcFavSave() now saves through EC.favoritesStore.add and returns a
  // Promise<boolean>. With the immediate lock stand-in above, the store's whole critical section has already run
  // when add() returns, so for THAT case only add() hands back an already-settled thenable whose then() runs its
  // callback at once: the shipped lcFavSave continuation (status, fault, list refresh) then also completes inside
  // the call, and the long-standing synchronous Load Calc assertions keep describing the shipped behaviour. Nothing
  // of the shipped code is replaced. A test that passes its own `locks` gets the store and lcFavSave untouched
  // (real Promises); api.lcFavSaveAsync is always the unwrapped shipped function.
  const settled = (value) => ({ __ecSettled: true, value, then(onOk) { let next; try { next = typeof onOk === 'function' ? onOk(value) : value; } catch (e) { return Promise.reject(e); } return next && next.__ecSettled ? next : settled(next); } });
  if (o.locks === undefined && EC.favoritesStore) {
    const baseStore = EC.favoritesStore;
    const add = (env, type, row) => { const before = lockLog.ran; const pending = baseStore.add(env, type, row); return lockLog.ran === before + 1 && lockLog.last && typeof lockLog.last.ok === 'boolean' ? settled(lockLog.last) : pending; };
    EC = Object.assign({}, EC, { favoritesStore: Object.assign({}, baseStore, { add }) });
  }
  new Function('navigator', 'confirm', 'document', 'window', 'EC', 'necLink', 'localStorage', 'prompt', 'exports', src +'\nexports.refs = { necRefInfo, necQuestion, refSpanHtml, refSpanFromText };')(favNavigator, () => (typeof o.confirmAnswer === 'function' ? o.confirmAnswer() : o.confirmAnswer === true), dom.document, win, EC, function (ref, opts) { necCalls.push(ref); necCallsFull.push({ ref, opts: opts || null, question: exp.refs ? exp.refs.necQuestion(exp.refs.necRefInfo(ref, opts)) : null }); }, st.localStorage, (msg, def) => { prompts.calls.push([msg, def]); return typeof prompts.answer === 'function' ? prompts.answer(msg, def) : prompts.answer; }, exp);   // eslint-disable-line no-new-func
  const api = exp.api;
  // api.lcFavSaveAsync: the shipped function as shipped (Promise<boolean>). api.lcFavSave: the same call, with the
  // outcome read back synchronously where the stand-in lock made it synchronous (see above). When the shipped
  // function returned before taking the lock (refused store, unsaveable draft, cancelled prompt) its effects are
  // complete and it resolves false; that is still verified — a different value fails the run loudly.
  const shippedSave = api.lcFavSave;
  api.lcFavSaveAsync = shippedSave;
  api.lcFavSave = (...args) => {
    const before = lockLog.ran; const out = shippedSave(...args);
    if (out && out.__ecSettled) return out.value;
    if (o.locks === undefined && lockLog.ran === before && out && typeof out.then === 'function') {
      out.then((v) => { if (v !== false) throw new Error('harness: lcFavSave resolved ' + String(v) + ' without taking the Favorites lock'); });
      return false;
    }
    return out;
  };
  const $ = (id) => dom.byId[id];
  const set = (id, value, evt) => { const el = $(id); if (!el) throw new Error('no element ' + id); el.value = value; el.validity.badInput = false; el.dispatch(evt || (el.tagName === 'SELECT' ? 'change' : 'input')); };
  const state = () => api.lcExportState();
  const text = () => ($('lcResult') ? $('lcResult').textContent : '');
  const nodes = () => dom.walk(dom.container);
  return { dom, api, EC, $, set, state, text, nodes, store: st.store, localStorage: st.localStorage, necCalls, necCallsFull, refs: exp.refs, prompts, adapterSrc: adapterSource() };
}

module.exports = { buildHarness, makeDocument, makeStorage, adapterSource, generatedEC, fnBody, html };
