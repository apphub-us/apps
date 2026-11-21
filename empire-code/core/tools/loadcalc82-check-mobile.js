#!/usr/bin/env node
'use strict';
/**
 * tools/loadcalc82-check-mobile.js — LC-22082-B0-UI-INTEGRATION-1 real-browser gate for the bounded 220.82 route.
 *
 * Runs the ACTUAL mobile.html in Chromium (Playwright, headless) at 320/375/390/430 px portrait + desktop:
 *   A. the 82 section at every viewport: no horizontal overflow, ≥16 px fields, cards inside the viewport, screenshots
 *   B. real typing into a load card: caret and focus stay in place through evaluations; bad text is kept and cleared on correction
 *   C. B0-like case entered through real controls: COMPLETE 23,680 VA / 98.7 A; coverage rendered; stale after "basis changed"
 *   D. storage: Save (real prompt dialog) → real document reload → row click restores the lcv-3 record; old lcv-2 record restores
 *      as an unconfirmed import; explicit confirmation; legacy record import; unknown version refused
 *   E. source clicks: NEC 2020 and NYCEC 2025 references dispatch once each to the real open-reference function
 *
 * Limits (reported, not hidden): Chromium emulation of mobile viewports is NOT WebKit/iOS Safari; "iPhone" widths are
 * viewport sizes only. BLOCKED = environment limit. Nothing here touches the released app.
 *
 * Usage: node tools/loadcalc82-check-mobile.js [mobile.html] [--out DIR] [--verbose]
 */
const fs = require('fs');
const path = require('path');
const base = require('./loadcalc-check-mobile');

const VIEWPORTS = [[320, 568, 'narrow 320 portrait'], [375, 812, 'iPhone 375 portrait'], [390, 844, 'iPhone 390 portrait'], [430, 932, 'iPhone 430 portrait'], [1280, 800, 'desktop 1280']];
const lcState = (page) => page.evaluate(() => lcExportState());
const resultText = (page) => page.evaluate(() => (document.getElementById('lcResult') || { innerText: '' }).innerText);
const setField = base.setField;
const cardCtl = (i, role) => `#lcLoads .lc-load:nth-of-type(${i + 1}) [data-role="${role}"]`;

/** enter the B0-like dwelling through real controls (values are parameters; nothing is hard-coded in the app) */
async function driveB0(page, p) {
  const v = Object.assign({ area: '1500', sa: '2', laundry: '1', nyc: '0', ampacity: '200' }, p || {});
  for (const [id, val] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'opt_220_82'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_balanced_LN'], ['lcDeclBalancedLN', 'yes'], ['lcFloorArea', v.area], ['lcSmallApplianceCircuits', v.sa], ['lcLaundryCircuits', v.laundry], ['lcNycAcCircuits', v.nyc], ['lcArrangement', 'ac_only'], ['lcSingleSupplySet', 'yes'], ['lcConductorAmpacity', v.ampacity], ['lcNycAcException', 'yes']]) await setField(page, id, val);
  for (const [preset, va] of [['0', '12000'], ['3', '4500'], ['1', '5000'], ['2', '1200'], ['4', '5000']]) { await page.selectOption('#lcPresetName', preset); await page.fill('#lcPresetVA', va); await page.click('#lcAddLoad'); await page.waitForTimeout(20); }
  await page.selectOption(cardCtl(2, 'inclusion'), 'not_on_counted_laundry_circuit'); await page.selectOption(cardCtl(3, 'inclusion'), 'fixed_or_permanently_connected'); await page.selectOption(cardCtl(4, 'coverage'), 'yes');
  await setField(page, 'lcInventoryComplete', 'yes'); await page.waitForTimeout(30);
}

async function run(options) {
  const opts = options || {};
  const target = path.resolve(opts.target || path.join(__dirname, '..', 'mobile.html'));
  if (!fs.existsSync(target)) throw new Error('no such file: ' + target);
  const outDir = opts.out ? path.resolve(opts.out) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const results = []; const check = (name, ok, detail) => { const r = { name, ok: ok === 'BLOCKED' ? 'BLOCKED' : !!ok, detail }; results.push(r); if (opts.verbose) console.log(`  ${r.ok === 'BLOCKED' ? 'BLOCKED' : r.ok ? 'PASS' : 'FAIL'}  ${name}${r.ok === true ? '' : ' — ' + (detail || '')}`); };
  const shot = async (page, name) => { if (outDir) await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false }); };
  const engine = { browser: browser.browserType().name(), version: browser.version(), note: 'Chromium viewport emulation — NOT WebKit / iOS Safari; iPhone widths are viewport sizes only' };
  try {
    // ── A. layout at every viewport with the 82 section open and a complete result ──
    for (const vp of VIEWPORTS) {
      const { ctx, page, state } = await base.newPage(browser, target, vp);
      await base.openLC(page); await driveB0(page);
      const geo = await page.evaluate(() => {
        const W = window.innerWidth; const els = [...document.querySelectorAll('#lcContent select, #lcContent input, #lcContent button')].filter((e) => e.offsetParent !== null);
        const boxes = els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.getAttribute('data-role') || e.tagName, tag: e.tagName, right: r.right, h: r.height, fontPx: parseFloat(getComputedStyle(e).fontSize), preexisting: e.classList.contains('lc-x') || e.classList.contains('reset-btn') || !!e.closest('#lcFavRow') }; });
        const cards = [...document.querySelectorAll('#lcLoads .lc-load')].map((c) => c.getBoundingClientRect().right);
        return { W, docScrollW: document.documentElement.scrollWidth, opt82: getComputedStyle(document.getElementById('lcOpt82')).display, fields: boxes, cardsRight: cards, resultW: document.getElementById('lcResult').scrollWidth, resultClient: document.getElementById('lcResult').clientWidth };
      });
      const st = await lcState(page);
      check(vp[2] + ': 82 section visible, COMPLETE 23,680 VA, no page errors', geo.opt82 !== 'none' && st.result && st.result.status === 'COMPLETE' && st.result.demand.totalVA === 23680 && state.pageErrors.length === 0, JSON.stringify({ opt82: geo.opt82, status: st.result && st.result.status, errors: state.pageErrors }));
      check(vp[2] + ': no horizontal overflow (document, result box); every visible input/select >= 16 px, every button added by this task >= 24 px tall (pre-existing .lc-x remove buttons are the accepted layout and only counted), all inside the viewport', geo.docScrollW <= geo.W && geo.resultW <= geo.resultClient + 1 && geo.fields.every((f) => f.right <= geo.W + 0.5 && (f.tag === 'BUTTON' ? (f.preexisting || f.h >= 24) : f.fontPx >= 16)) && geo.cardsRight.every((r) => r <= geo.W + 0.5), JSON.stringify({ docScrollW: geo.docScrollW, W: geo.W, bad: geo.fields.filter((f) => f.right > geo.W + 0.5 || (f.tag === 'BUTTON' ? (!f.preexisting && f.h < 24) : f.fontPx < 16)).slice(0, 5), preexistingSmallButtons: geo.fields.filter((f) => f.tag === 'BUTTON' && f.preexisting && f.h < 24).length }));
      await page.evaluate(() => document.getElementById('lcOpt82').scrollIntoView()); await shot(page, 'lc82-section-' + vp[0]);
      await page.evaluate(() => document.getElementById('lcResult').scrollIntoView()); await shot(page, 'lc82-result-' + vp[0]);
      await ctx.close();
    }

    // ── B. typing / caret at 390 ──
    {
      const { ctx, page, state } = await base.newPage(browser, target, [390, 844]);
      await base.openLC(page); await driveB0(page);
      const label = page.locator(cardCtl(4, 'label')); await label.focus(); await page.keyboard.press('End'); await page.keyboard.type(' attic', { delay: 20 });
      const after = await page.evaluate(() => ({ active: document.activeElement && document.activeElement.getAttribute('data-role'), value: document.activeElement && document.activeElement.value, caret: document.activeElement && document.activeElement.selectionStart }));
      const st = await lcState(page);
      check('typing into a load label keeps focus and caret; each keystroke evaluated once; label stored; result still COMPLETE', after.active === 'label' && /attic$/.test(after.value) && after.caret === after.value.length && st.snapshot.loads[4].label === after.value && st.result.status === 'COMPLETE' && st.snapshot.loads[4].basisId === 'bs-L5-1', JSON.stringify([after, st.snapshot.loads[4].label, st.result.status]));
      const rating = page.locator(cardCtl(0, 'rating')); await rating.focus(); await page.keyboard.press('End'); await page.keyboard.type('e', { delay: 20 });   // Chromium refuses letters in type=number entirely; 'e' is accepted and yields badInput
      let s2 = await lcState(page); const badInput = await page.evaluate(() => { const e = document.querySelector('#lcLoads .lc-load:nth-of-type(1) [data-role="rating"]'); return { bad: e.validity.badInput, val: e.value, focused: document.activeElement === e }; });
      check('a bad character in a number input: badInput transported as NOT_FINITE, previous number retained, INVALID_INPUT, focus kept, no old total', badInput.bad && badInput.val === '' && s2.loadErrors.L1 && s2.loadErrors.L1['rating.value'].code === 'NOT_FINITE' && s2.snapshot.loads[0].rating.value === 12000 && s2.result.status === 'INVALID_INPUT' && badInput.focused && !/Total demand: 23,680/.test(await resultText(page)), JSON.stringify([badInput, s2.loadErrors, s2.result.status]));
      await shot(page, 'lc82-rating-badinput-390');
      await page.keyboard.press('Backspace'); await page.waitForTimeout(30); s2 = await lcState(page);
      check('correction clears the error and recomputes COMPLETE', !s2.loadErrors.L1 && s2.result.status === 'COMPLETE' && s2.result.demand.totalVA === 23680 && state.pageErrors.length === 0, JSON.stringify([s2.loadErrors, s2.result.status, state.pageErrors]));
      // stale premise through the real button
      await page.click(cardCtl(4, 'basis-changed')); await page.waitForTimeout(30); s2 = await lcState(page); const txt = await resultText(page);
      check('"basis changed" on the A/C: PREMISE_STALE for the record and for the inventory declaration; old fact retained; no total', s2.snapshot.loads[4].basisId === 'bs-L5-2' && s2.snapshot.loads[4].ratingCoverage82.basis.basisId === 'bs-L5-1' && s2.result.problems.map((p) => p.code).filter((c) => c === 'PREMISE_STALE').length === 2 && /stale/i.test(txt) && !/Total demand/.test(txt), JSON.stringify(s2.result.problems.map((p) => p.code + '@' + p.field)));
      await shot(page, 'lc82-stale-390');
      await page.selectOption(cardCtl(4, 'coverage'), 'yes'); await setField(page, 'lcInventoryComplete', 'yes'); s2 = await lcState(page);
      check('re-answering restores COMPLETE', s2.result.status === 'COMPLETE');
      await page.selectOption(cardCtl(4, 'coverage'), 'no'); s2 = await lcState(page);
      check('negative A/C coverage: PARTIAL with the general-load subtotal 18,680 VA, no total/current', s2.result.status === 'PARTIAL' && s2.result.demand.partialSubtotalVA === 18680 && /GENERAL-LOAD SUBTOTAL/.test(await resultText(page)) && !/Total demand|Line current/.test(await resultText(page)), JSON.stringify([s2.result.status, s2.result.demand.partialSubtotalVA]));
      await shot(page, 'lc82-partial-390');
      // source clicks
      await page.selectOption(cardCtl(4, 'coverage'), 'yes'); await setField(page, 'lcNycAcCircuits', '1'); s2 = await lcState(page);
      await page.evaluate(() => { window.__necCalls = []; window.necLink = function (ref, o) { window.__necCalls.push([ref, o && o.source, o && o.section, o && o.edition, o && o.title]); }; });   // the delegated handler calls the real necLink; stub it so the click is recorded instead of navigating
      const necSel = '#lcResult .nec-link[data-sec="220.82"]'; const nycSel = '#lcResult .nycec-link[data-sec="220.14(N)"]';
      const has = { nec: await page.locator(necSel).count(), nyc: await page.locator(nycSel).count() };
      if (has.nec) await page.locator(necSel).first().click(); if (has.nyc) await page.locator(nycSel).first().click(); await page.waitForTimeout(20);
      const calls = await page.evaluate(() => window.__necCalls);
      check('reference clicks: NEC 2020 220.82 and NYCEC 2025 220.14(N) each dispatch exactly once to the real reference opener with distinct targets', s2.result.status === 'BLOCKED_PENDING_RULE' && has.nec >= 1 && has.nyc >= 1 && calls.length === 2 && /^NEC 2020 220\.82/.test(calls[0][0]) && calls[0][1] === 'nec' && /^NYCEC 2025 amendment to NEC 220\.14\(N\)/.test(calls[1][0]) && calls[1][1] === 'nycec', JSON.stringify({ status: s2.result.status, has, calls }));
      await shot(page, 'lc82-nyc-pending-390');

      // ── R1 / U4: the two NYC provisions in the 220.82 help, the AI context title and the capability label ──
      const helpSel = (src, sec) => `#lcOpt82 .${src}-link[data-sec="${sec}"]`;
      const u4 = { calls: [], counts: {} };
      for (const sec of ['210.11(C)(5)', '210.52(J)']) {
        u4.counts[sec] = { nec: await page.locator(helpSel('nec', sec)).count(), nycec: await page.locator(helpSel('nycec', sec)).count() };
        await page.evaluate(() => { window.__necCalls = []; });
        await page.locator(helpSel('nycec', sec)).first().click(); await page.waitForTimeout(20);
        await page.locator(helpSel('nycec', sec)).first().focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(20);
        u4.calls.push([sec, await page.evaluate(() => window.__necCalls)]);
      }
      const u4ok = u4.calls.every(([sec, calls]) => calls.length === 2 && calls.every((c) => c[1] === 'nycec' && c[2] === sec && c[3] === '2025' && /220\.82/.test(String(c[4])) && !/220\.87/.test(String(c[4])) && /^NYCEC 2025 amendment to NEC /.test(c[0])));
      check('R1/U4 real browser: both NYC 220.82 help provisions offer an NYCEC 2025 target beside the NEC 2020 one; click and Enter each send exactly once with source/edition/section and a 220.82 AI context', u4ok && Object.values(u4.counts).every((c) => c.nec === 1 && c.nycec === 1), JSON.stringify(u4));
      const necOnly = await page.evaluate(() => { window.__necCalls = []; const e = document.querySelector('#lcOpt82 .nec-link[data-sec="220.82(A)"]'); if (e) e.click(); return { found: !!e, calls: window.__necCalls }; });
      check('R1/U4 real browser: a NEC-only controlled reference stays nec/2020 with the 220.82 context and sends once', necOnly.found && necOnly.calls.length === 1 && necOnly.calls[0][1] === 'nec' && necOnly.calls[0][3] === '2020' && /220\.82/.test(String(necOnly.calls[0][4])), JSON.stringify(necOnly));
      const incHelp = await page.evaluate(() => { const c = document.querySelectorAll('#lcLoads .lc-load')[2]; const hints = [...c.querySelectorAll('.lc-hint')].filter((h) => /laundry circuit/.test(h.textContent)); const refs = hints.length ? [...hints[0].querySelectorAll('[data-sec]')] : []; return { hints: hints.length, secs: refs.map((r) => r.getAttribute('data-sec')), roles: refs.map((r) => r.getAttribute('role') + ':' + r.getAttribute('tabindex')), titles: refs.map((r) => r.getAttribute('data-title')) }; });
      check('R1/U4 real browser: the per-record inclusion help renders real keyboard-operable 220.82 targets with the full section written out', incHelp.hints === 1 && JSON.stringify(incHelp.secs.slice().sort()) === JSON.stringify(['220.82(B)(2)', '220.82(B)(3)(c)']) && incHelp.roles.every((r) => r === 'button:0') && incHelp.titles.every((t) => /220\.82/.test(String(t))), JSON.stringify(incHelp));
      const methodLabel = await page.evaluate(() => [...document.getElementById('lcMethod').options].filter((o) => o.value === 'opt_220_82').map((o) => o.textContent)[0]);
      check('R1/U4 real browser: the method menu states the bounded capability instead of "not available in this profile"', /LIMITED/.test(methodLabel) && /one dwelling unit/.test(methodLabel) && !/not available in this profile/.test(methodLabel), methodLabel);
      await shot(page, 'lc82-u4-help-390');

      // ── R1 / U2: a valid explicit answer clears ONLY its own parser error (real controls, real events) ──
      await setField(page, 'lcNycAcCircuits', '0');
      const seeded = await page.evaluate(() => { const p = lcFavPayload(); p.loadErrors.L3 = { inclusion82: { raw: '?', code: 'UNKNOWN_ENUM' } }; p.fieldErrors['optional82.singleSupplySet'] = { raw: '?', code: 'UNKNOWN_ENUM' }; const store = { lc: [{ id: 900, name: 'R1 error draft', vals: p }] }; localStorage.setItem('sparky_favorites', JSON.stringify(store)); favRender('lc'); return JSON.stringify(store); });
      await page.locator('#lc-fav-list .fav-item').first().click(); await page.waitForTimeout(80);
      let u2 = await lcState(page);
      check('R1/U2 real browser: the error-bearing lcv-3 record restores with both parser errors and INVALID_INPUT', u2.fault === null && u2.result.status === 'INVALID_INPUT' && u2.loadErrors.L3 && u2.loadErrors.L3.inclusion82.code === 'UNKNOWN_ENUM' && u2.fieldErrors['optional82.singleSupplySet'].code === 'UNKNOWN_ENUM', JSON.stringify([u2.fault, u2.result && u2.result.status]));
      await page.selectOption(cardCtl(2, 'inclusion'), 'not_on_counted_laundry_circuit'); await page.waitForTimeout(30); u2 = await lcState(page);
      check('R1/U2 real browser: the inclusion answer clears ONLY its own entry; the unrelated declaration error survives and still blocks', !u2.loadErrors.L3 && u2.fieldErrors['optional82.singleSupplySet'] && u2.fieldErrors['optional82.singleSupplySet'].code === 'UNKNOWN_ENUM' && u2.result.status === 'INVALID_INPUT' && !/Total demand/.test(await resultText(page)), JSON.stringify([u2.loadErrors, u2.fieldErrors, u2.result.status]));
      await setField(page, 'lcSingleSupplySet', 'yes'); await page.waitForTimeout(30); u2 = await lcState(page);
      check('R1/U2 real browser: correcting the second slot recovers COMPLETE 23,680 VA with both maps empty', u2.result.status === 'COMPLETE' && u2.result.demand.totalVA === 23680 && Object.keys(u2.loadErrors).length === 0 && Object.keys(u2.fieldErrors).length === 0, JSON.stringify([u2.result.status, u2.loadErrors, u2.fieldErrors]));
      await setField(page, 'lcSingleSupplySet', ''); await page.waitForTimeout(30); u2 = await lcState(page);
      check('R1/U2 real browser: an unanswered declaration is a valid state with its own engine outcome, never auto-certified and never a resurrected parse error', !u2.fieldErrors['optional82.singleSupplySet'] && u2.result.status !== 'COMPLETE' && u2.snapshot.optional82.singleSupplySet.value === null && u2.result.problems.some((p) => p.field === 'optional82.singleSupplySet'), JSON.stringify([u2.result.status, u2.result.problems.map((p) => p.code + '@' + p.field)]));
      await setField(page, 'lcSingleSupplySet', 'yes'); await page.waitForTimeout(20);
      const caret = await page.evaluate(async () => { const el = document.querySelectorAll('#lcLoads .lc-load')[2].querySelector('[data-role="label"]'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); return { role: document.activeElement.getAttribute('data-role'), caret: el.selectionStart, len: el.value.length }; });
      check('R1/U2 real browser: answering a premise does not rebuild the card (focus and caret stay where they were)', caret.role === 'label' && caret.caret === caret.len, JSON.stringify(caret));
      const storeNow = await page.evaluate(() => localStorage.getItem('sparky_favorites'));
      check('R1/U2 real browser: the source Favorite is byte-identical after restore and correction', storeNow === seeded, 'changed');
      state.nextPromptValue = 'R1 corrected copy'; await page.click('#lcSaveBtn'); await page.waitForTimeout(80);
      const storeAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('sparky_favorites')));
      check('R1/U2 real browser: Save appends a NEW clean lcv-3 record; the error-bearing original stays untouched', storeAfter.lc.length === 2 && storeAfter.lc[0].id === 900 && JSON.stringify(storeAfter.lc[0]) === JSON.stringify(JSON.parse(seeded).lc[0]) && storeAfter.lc[1].vals.lcv === 3 && Object.keys(storeAfter.lc[1].vals.loadErrors).length === 0 && Object.keys(storeAfter.lc[1].vals.fieldErrors).length === 0, JSON.stringify(storeAfter.lc.map((f) => [f.id, f.vals.lcv])));
      await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(250); await base.openLC(page);
      await page.locator('#lc-fav-list .fav-item').nth(1).click(); await page.waitForTimeout(80); u2 = await lcState(page);
      check('R1/U2 real browser: after a real document reload the corrected record restores COMPLETE with empty maps', u2.fault === null && u2.result.status === 'COMPLETE' && Object.keys(u2.loadErrors).length === 0 && Object.keys(u2.fieldErrors).length === 0, JSON.stringify([u2.fault, u2.result && u2.result.status]));
      await shot(page, 'lc82-u2-corrected-390');
      if (outDir) fs.writeFileSync(path.join(outDir, 'storage-after-u2-correction.json'), JSON.stringify(storeAfter, null, 1));
      await ctx.close();
    }

    // ── D. storage: save → reload → restore; old lcv-2 import + confirmation; legacy import; unknown version ──
    {
      const { ctx, page, state } = await base.newPage(browser, target, [390, 844]);
      await base.openLC(page); await driveB0(page); const before = await lcState(page);
      state.nextPromptValue = 'B0 house (82)'; await page.click('#lcSaveBtn'); await page.waitForTimeout(80);
      const store1 = await page.evaluate(() => JSON.parse(localStorage.getItem('sparky_favorites')));
      check('Save through the real prompt dialog: one lcv-3 record (capabilityProfile AB82_core1, context, snapshot 3.3.0, maps, sourceFavId null)', store1 && store1.lc && store1.lc.length === 1 && store1.lc[0].vals.lcv === 3 && store1.lc[0].vals.capabilityProfile === 'AB82_core1' && store1.lc[0].vals.snapshot.schemaVersion === '3.3.0' && store1.lc[0].vals.sourceFavId === null && JSON.stringify(store1.lc[0].vals.snapshot) === JSON.stringify(before.snapshot) && state.dialogs.length === 1, JSON.stringify({ dialogs: state.dialogs, keys: store1 && store1.lc && store1.lc[0] && Object.keys(store1.lc[0].vals) }));
      if (outDir) fs.writeFileSync(path.join(outDir, 'storage-after-save-lc82.json'), JSON.stringify(store1, null, 1));
      // seed an old lcv-2 record, a legacy record and an unknown version next to it, then reload the real document
      await page.evaluate((seed) => { const s = JSON.parse(localStorage.getItem('sparky_favorites')); s.lc.push(...seed); localStorage.setItem('sparky_favorites', JSON.stringify(s)); }, [
        { id: 2001, name: 'Old lcv-2 (82 selected)', vals: { lcv: 2, profileId: 'A_measured_87_core', snapshot: await page.evaluate(() => EC.loadCalcInputV2.downConvertToA(LC.lastRequest).snapshot), fieldErrors: {}, loadErrors: {}, sourceFavId: 'old-key' } },
        { id: 2002, name: 'Legacy house', vals: base.LEGACY_REC04C },
        { id: 2003, name: 'Future payload', vals: { lcv: 99, snapshot: {} } }
      ]);
      await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(250); await base.openLC(page);
      const rows = await page.evaluate(() => [...document.querySelectorAll('#lc-fav-list .fav-item-name')].map((n) => n.textContent));
      check('after a real document reload the four records are listed', JSON.stringify(rows) === JSON.stringify(['B0 house (82)', 'Old lcv-2 (82 selected)', 'Legacy house', 'Future payload']), JSON.stringify(rows));
      await setField(page, 'lcOccupancy', 'nondwelling'); await page.locator('#lc-fav-list .fav-item').nth(0).click(); await page.waitForTimeout(80);
      let st = await lcState(page);
      check('row click restores the lcv-3 record exactly (snapshot, context, maps) and recomputes COMPLETE 23,680 VA; sourceFavId null', st.fault === null && JSON.stringify(st.snapshot) === JSON.stringify(before.snapshot) && JSON.stringify(st.context) === JSON.stringify(before.context) && st.result.status === 'COMPLETE' && st.result.demand.totalVA === 23680 && st.sourceFavId === null && (await page.inputValue('#lcOccupancy')) === 'dwelling_unit_house', JSON.stringify([st.fault, st.result && st.result.status]));
      await shot(page, 'lc82-restored-390');
      await page.locator('#lc-fav-list .fav-item').nth(1).click(); await page.waitForTimeout(80); st = await lcState(page); let ftxt = await page.evaluate(() => document.getElementById('lcFavStatus').innerText);
      check('old lcv-2 record: imported as a new unconfirmed draft (IMPORTED_METHOD_UNCONFIRMED, premises unanswered, sourceFavId "old-key"); confirm control shown', st.fault === null && st.context.methodConfirmedAfterImport === false && st.context.importedFrom && st.context.importedFrom.lcv === 2 && st.sourceFavId === 'old-key' && st.result.problems.some((p) => p.code === 'IMPORTED_METHOD_UNCONFIRMED') && st.result.status !== 'COMPLETE' && /NOT confirmed/.test(ftxt) && (await page.locator('#lcConfirmMethod').isVisible()), JSON.stringify([st.fault, st.context, st.result && st.result.status]));
      await shot(page, 'lc82-import-unconfirmed-390');
      await page.click('#lcConfirmMethod'); await page.waitForTimeout(40); st = await lcState(page);
      check('explicit confirmation clears only the import guard; premises stay unanswered', st.context.methodConfirmedAfterImport === true && !st.result.problems.some((p) => p.code === 'IMPORTED_METHOD_UNCONFIRMED') && st.result.status !== 'COMPLETE' && st.snapshot.optional82.inventoryComplete.value === null, JSON.stringify(st.result.problems.map((p) => p.code + '@' + p.field)));
      await page.locator('#lc-fav-list .fav-item').nth(2).click(); await page.waitForTimeout(80); st = await lcState(page); ftxt = await page.evaluate(() => document.getElementById('lcFavStatus').innerText);
      check('legacy (unversioned) record: imported through the accepted upgrade; A projection == unchanged migrator output; sourceFavId 2002; unconfirmed', st.fault === null && st.sourceFavId === 2002 && st.context.importedFrom && st.context.importedFrom.lcv === 1 && st.context.methodConfirmedAfterImport === false && /imported as a new draft/.test(ftxt) && (await page.evaluate((r) => JSON.stringify(EC.loadCalcInputV2.downConvertToA(LC.lastRequest).snapshot) === JSON.stringify(EC.loadCalcState.migrateLegacyRecord(r).snapshot), base.LEGACY_REC04C)), JSON.stringify([st.fault, st.sourceFavId, st.context]));
      const draftBefore = JSON.stringify(st.snapshot); await page.locator('#lc-fav-list .fav-item').nth(3).click(); await page.waitForTimeout(60); st = await lcState(page); const rtxt = await resultText(page);
      check('unknown version (lcv 99): explicit RESTORE FAILED naming the version, draft unchanged, store unchanged, no page error', st.fault && st.fault.kind === 'restore' && /unsupported Load Calc version/.test(rtxt) && JSON.stringify(st.snapshot) === draftBefore && (await page.evaluate(() => JSON.parse(localStorage.getItem('sparky_favorites')).lc.length)) === 4 && state.pageErrors.length === 0, JSON.stringify([st.fault && st.fault.message, state.pageErrors]));
      await shot(page, 'lc82-restore-failed-390');
      const storeEnd = await page.evaluate(() => JSON.parse(localStorage.getItem('sparky_favorites')));
      check('no record was upgraded in place, removed or reordered by the restores', storeEnd.lc.length === 4 && storeEnd.lc[0].vals.lcv === 3 && storeEnd.lc[1].vals.lcv === 2 && storeEnd.lc[2].vals.lcv === undefined && storeEnd.lc[3].vals.lcv === 99, JSON.stringify(storeEnd.lc.map((f) => [f.id, f.vals.lcv])));
      if (outDir) fs.writeFileSync(path.join(outDir, 'storage-after-restores-lc82.json'), JSON.stringify(storeEnd, null, 1));
      await ctx.close();
    }
  } finally { await browser.close(); }
  const fails = results.filter((r) => r.ok === false); const blocked = results.filter((r) => r.ok === 'BLOCKED');
  if (outDir) fs.writeFileSync(path.join(outDir, 'loadcalc82-check-mobile.json'), JSON.stringify({ target, engine, results }, null, 1));
  return { target, engine, results, fails, blocked };
}

module.exports = { run, driveB0, VIEWPORTS };

if (require.main === module) {
  const args = process.argv.slice(2); const outIdx = args.indexOf('--out');
  const target = args.find((a) => !a.startsWith('--') && (outIdx === -1 || args.indexOf(a) !== outIdx + 1));
  run({ target, out: outIdx !== -1 ? args[outIdx + 1] : null, verbose: args.includes('--verbose') }).then((r) => {
    console.log(`loadcalc82-check-mobile: ${r.results.length} checks, ${r.fails.length} FAIL, ${r.blocked.length} BLOCKED — ${r.engine.browser} ${r.engine.version} (${r.engine.note})`);
    for (const f of r.fails) console.log('  FAIL ' + f.name + ' — ' + (f.detail || ''));
    process.exit(r.fails.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(2); });
}
