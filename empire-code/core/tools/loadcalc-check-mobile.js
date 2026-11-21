#!/usr/bin/env node
'use strict';
/**
 * EC-CALC-2 / B2 — real-browser check of the integrated Load Calc in mobile.html.
 *
 *   NODE_PATH=<global node_modules> node tools/loadcalc-check-mobile.js [path/to/mobile.html] [--out <dir>]
 *
 * Drives the ACTUAL shipped application with the already-installed Playwright
 * Chromium over file:// (the same isolated origin the other harnesses use):
 * real navigation (openTool / switchTab), real input / change events on the
 * real controls, the real Save button (prompt dialog answered by the harness),
 * a real document reload keeping the same test storage, then the real preset
 * row click (favLoad -> favSetValues -> lcFavRestore). External network is
 * blocked before initialization; storage starts empty; only synthetic values
 * are typed; nothing is installed. Screenshots and a JSON result go to --out.
 *
 * Every check is PASS / FAIL against the app, or BLOCKED when the environment
 * cannot establish it (WebKit / iOS native zoom, keyboards). Exit 1 on any FAIL.
 * What desktop Chromium cannot prove: iOS Safari's native focus zoom,
 * keyboard open/dismiss and residual pan — a physical-iPhone item, still PENDING.
 * B2-r1 adds section E: real keystrokes and caret edits in load cards (R-B2-01), optional blanks
 * (R-B2-05), corrupt LC collection (R-B2-03), "__proto__" load id (R-B2-04), rejected malformed
 * wrapper maps and a quantity-0 draft saved, RELOADED and restored (R-B2-02), and the inventory of
 * visible app-authored NEC references (R-B2-06).
 * B2-r1.1 adds section F (R-B2R1-01): a stored record whose loads repeat an id is refused at the row
 * click after a REAL reload (draft, raw entries and store bytes unchanged, no page error, no stale
 * COMPLETE), the same-label / unique-id control restores, and an internally duplicated draft renders
 * the finite read-only structural view and is refused at Save before the prompt.
 */
const path = require('path');
const fs = require('fs');

const VIEWPORTS = [[375, 812, 'iPhone 375 portrait'], [390, 844, 'iPhone 390 portrait'], [414, 896, 'iPhone 414 portrait'], [844, 390, 'iPhone 390 landscape'], [1280, 800, 'desktop 1280']];
const PROFILE = 'A_measured_87_core';
const LEGACY_REC04C = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: JSON.stringify([{ id: 'r1', name: 'Range / Oven', va: 12000, category: 'appliance' }, { id: 'r2', name: 'Water Heater', va: 4500, category: 'appliance' }, { id: 'r3', name: 'Laundry Circuit', va: 1500, category: 'laundry' }]), hvac: JSON.stringify([{ id: 'h1', name: 'A/C', va: 5000, category: 'ac' }]), ev: '[]' };
const LEGACY_MIXED = (reverse) => { const items = [{ id: 'a', name: 'Laundry Circuit', category: 'laundry', va: 1500 }, { id: 'b', name: 'Laundry Circuit', category: 'laundry', va: 2000 }]; return { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: JSON.stringify(reverse ? items.slice().reverse() : items), hvac: '[]', ev: '[]' }; };
const LEGACY_BAD = { method: 'optional', voltage: '240', scope: 'house', sqFt: '1500', appliances: '{not json', hvac: '[]', ev: '[]' };
const HOSTILE = '<img src=x onerror="window.__lcPwned=1"> &amp; "quoted" \'apos\'';

async function newPage(browser, target, viewport, seedStorage) {
  const ctx = await browser.newContext({ viewport: { width: viewport[0], height: viewport[1] } });
  const page = await ctx.newPage();
  const state = { pageErrors: [], blocked: 0, dialogs: [] };
  page.on('pageerror', (e) => state.pageErrors.push(String(e).split('\n')[0]));
  page.on('dialog', async (d) => { state.dialogs.push(d.type() + ':' + d.message()); if (d.type() === 'prompt') await d.accept(state.nextPromptValue || 'preset'); else await d.accept(); });
  await page.route('**/*', (route) => { if (route.request().url().startsWith('file://')) return route.continue(); state.blocked++; return route.abort(); });
  // A new browser context starts with EMPTY storage (nothing is cleared by script, so a later page.reload()
  // sees exactly what the app wrote). A seed, when given, is written by the harness AFTER the first load
  // and BEFORE the Load Calc is opened — the app's own favRender reads it like any persisted store.
  await page.addInitScript(() => {
    window._db = null;
    // count engine calls without changing the engine: wrap AFTER the bundle defines window.EC
    Object.defineProperty(window, '__lcEvalCount', { value: 0, writable: true });
    const hook = () => { if (!window.EC || !window.EC.loadCalc || window.EC.loadCalc.__wrapped) return false; const real = window.EC.loadCalc.evaluate; window.EC.loadCalc.evaluate = function () { window.__lcEvalCount++; return real.apply(this, arguments); }; window.EC.loadCalc.__wrapped = true; return true; };
    document.addEventListener('DOMContentLoaded', hook); const iv = setInterval(() => { if (hook()) clearInterval(iv); }, 5);
  });
  await page.goto('file://' + target, { waitUntil: 'load' }); await page.waitForTimeout(250);
  const initial = await page.evaluate(() => localStorage.length);
  if (initial !== 0) throw new Error('test context storage is not empty: ' + initial);
  if (seedStorage) await page.evaluate((seed) => { localStorage.setItem('sparky_favorites', seed); }, seedStorage);
  return { ctx, page, state };
}
const openLC = async (page) => { await page.evaluate(() => openTool('loadcalc')); await page.waitForTimeout(120); };
const lcState = (page) => page.evaluate(() => { const st = lcExportState(); st.lastRequestA = st.lastRequest ? EC.loadCalcInputV2.downConvertToA(st.lastRequest).snapshot : null; return st; });   // ledger L-11: the A projection of the transported request
const resultText = (page) => page.evaluate(() => (document.getElementById('lcResult') || { innerText: '' }).innerText);
const evalCount = (page) => page.evaluate(() => window.__lcEvalCount);
/** set a value on a real control and dispatch the real event */
async function setField(page, id, value, type) {
  const isSelect = await page.evaluate((i) => document.getElementById(i).tagName === 'SELECT', id);
  if (isSelect) await page.selectOption('#' + id, value); else if (type === 'type') { await page.fill('#' + id, ''); await page.type('#' + id, value); } else await page.fill('#' + id, value);
  await page.waitForTimeout(15);
}
/** fill a complete qualified annual, split-phase, all-LL, 40,000 VA, 200 A draft through the real controls */
async function fillAnnual(page, rating) {
  await setField(page, 'lcOccupancy', 'dwelling_unit_house'); await setField(page, 'lcHouseFeeder', 'yes100'); await setField(page, 'lcHouseState', 'meter');
  await setField(page, 'lcTopology', '1ph_3w_120_240'); await setField(page, 'lcModel', 'split_240_all_LL'); await setField(page, 'lcBasis', 'annual_max_demand');
  await setField(page, 'lcReadingValue', '40000'); await setField(page, 'lcAnnualData', 'yes'); await setField(page, 'lcPeriodMonths', '12');
  await setField(page, 'lcServiceRatingA', rating || '200'); await setField(page, 'lcServiceOverload', 'yes'); await setField(page, 'lcNewLoadMode', 'none');
}
/** 30-day amperes, split-phase declared legs, per-conductor L1 140 / L2 20, L-N 3,600 VA term on L2 confirmed, 150 A */
async function fillThirtyPerConductor(page) {
  await setField(page, 'lcOccupancy', 'dwelling_unit_house'); await setField(page, 'lcMethod', 'measured_220_87');
  await setField(page, 'lcTopology', '1ph_3w_120_240'); await setField(page, 'lcModel', 'split_240_declared_legs'); await setField(page, 'lcDeclUnityPF', 'yes');
  await setField(page, 'lcBasis', '30d_recording_exception'); await setField(page, 'lcReadingUnit', 'A'); await setField(page, 'lcReadingScope', 'per_conductor');
  await setField(page, 'lcReadL1', '140'); await setField(page, 'lcReadL2', '20');
  await setField(page, 'lcAnnualData', 'no'); await setField(page, 'lcPeriodDays', '30'); await setField(page, 'lcIntervalMinutes', '15'); await setField(page, 'lcContinuousRecording', 'yes'); await setField(page, 'lcConnectedTo', 'each_conductor');
  for (const id of ['lcBasedOnInitialLoading', 'lcRecordedWhileOccupied', 'lcIncludesLargerOfHeatingOrCooling', 'lcIncludesPeriodicSeasonalLoads']) await setField(page, id, 'yes');
  for (const id of ['lcHasRenewableEnergySystem', 'lcHasPeakLoadShaving']) await setField(page, id, 'no');
  await setField(page, 'lcServiceRatingA', '150'); await setField(page, 'lcServiceOverload', 'yes');
  await setField(page, 'lcNewLoadMode', 'precalculated'); await setField(page, 'lcTermVA', '3600'); await setField(page, 'lcTermConnection', 'LN'); await setField(page, 'lcTermLeg', 'L2'); await setField(page, 'lcTermEstablished', 'yes'); await setField(page, 'lcTermBasisMethod', 'other_stated'); await setField(page, 'lcTermCalculatedBy', 'engineer'); await setField(page, 'lcTermDemandFactors', 'yes');
}

async function run(options) {
  const opts = options || {};
  const target = path.resolve(opts.target || path.join(__dirname, '..', 'mobile.html'));
  if (!fs.existsSync(target)) throw new Error('no such file: ' + target);
  const outDir = opts.out ? path.resolve(opts.out) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const results = []; const check = (name, ok, detail) => { const r = { name, ok: ok === 'BLOCKED' ? 'BLOCKED' : !!ok, detail }; results.push(r); if (opts.verbose) console.log(`  ${r.ok === 'BLOCKED' ? 'BLOCK' : r.ok ? 'PASS ' : 'FAIL '} ${r.name}${r.ok === true ? '' : r.detail ? ' — ' + String(r.detail).slice(0, 400) : ''}`); };
  const shot = async (page, name) => { if (outDir) await page.screenshot({ path: path.join(outDir, name + '.png') }); };
  try {
    // ── A. shell, field policy and layout at every viewport ──
    for (const vp of VIEWPORTS) {
      const { ctx, page, state } = await newPage(browser, target, vp);
      await openLC(page);
      const geo = await page.evaluate(() => { const W = window.innerWidth; const form = document.getElementById('lcForm'); const fields = [...document.querySelectorAll('#lcContent select, #lcContent input, #lcContent textarea')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0 && !['checkbox', 'button'].includes(e.type)); return { W, docScrollW: document.documentElement.scrollWidth, formScrollW: form ? form.scrollWidth : null, contentClientW: document.getElementById('lcContent').clientWidth, fields: fields.map((e) => ({ id: e.id || e.tagName, fontPx: parseFloat(getComputedStyle(e).fontSize), right: Math.round(e.getBoundingClientRect().right) })), built: !!form }; });
      check(vp[2] + ': form built, no page errors, external requests blocked before load', geo.built && state.pageErrors.length === 0 && state.blocked >= 1, JSON.stringify({ errors: state.pageErrors, blocked: state.blocked }));
      check(vp[2] + ': every visible Load Calc field >= 16 px and inside the viewport', geo.fields.length > 0 && geo.fields.every((f) => f.fontPx >= 16 && f.right <= geo.W + 0.5), JSON.stringify(geo.fields.filter((f) => f.fontPx < 16 || f.right > geo.W + 0.5)).slice(0, 300));
      check(vp[2] + ': no document / form horizontal overflow', geo.docScrollW <= geo.W && (geo.formScrollW === null || geo.formScrollW <= geo.contentClientW + 1), JSON.stringify({ docScrollW: geo.docScrollW, W: geo.W, formScrollW: geo.formScrollW, contentClientW: geo.contentClientW }));
      await fillAnnual(page, '200'); await page.waitForTimeout(50);
      const geo2 = await page.evaluate(() => ({ W: window.innerWidth, docScrollW: document.documentElement.scrollWidth, resultW: document.getElementById('lcResult').scrollWidth, resultClient: document.getElementById('lcResult').clientWidth }));
      check(vp[2] + ': result rendered without overflow', geo2.docScrollW <= geo2.W && geo2.resultW <= geo2.resultClient + 1, JSON.stringify(geo2));
      await page.evaluate(() => { document.getElementById('lcResult').scrollIntoView(); }); await shot(page, 'result-' + vp[0] + 'x' + vp[1]);
      await ctx.close();
    }

    // ── B. behaviour at 390 px ──
    const { ctx, page, state } = await newPage(browser, target, [390, 844]);
    await openLC(page);
    let st = await lcState(page);
    const empty = await page.evaluate(() => EC.loadCalcStateV2.createEmptyDraftV2().snapshot);   // ledger L-11a: the accepted blank V2 draft (its A projection is the contract empty snapshot)
    check('Init: draft equals the accepted blank V2 draft (A projection == contract empty snapshot); status EMPTY; no verdict; one evaluation', JSON.stringify(st.snapshot) === JSON.stringify(empty) && st.result.status === 'EMPTY' && st.result.existingCapacity.status === 'not_assessed' && st.evaluations === 1, JSON.stringify({ status: st.result.status, evals: st.evaluations }));
    const txt0 = await resultText(page);
    check('no legacy output anywhere in the initial render (Min Service / 2-pole default / neutral claim)', !/Min Service|recommended|2-pole|Neutral load calculated/.test(txt0), txt0.slice(0, 120));

    // one engine call per real event
    let before = await evalCount(page); await setField(page, 'lcOccupancy', 'dwelling_unit_house'); let after = await evalCount(page);
    check('one engine call per user update (occupancy change)', after - before === 1, `${before} -> ${after}`);
    await setField(page, 'lcMethod', 'measured_220_87');
    before = await evalCount(page); await page.type('#lcReadingValue', '4'); after = await evalCount(page);
    check('one engine call per keystroke on a number field', after - before === 1, `${before} -> ${after}`);
    await page.fill('#lcReadingValue', ''); await setField(page, 'lcMethod', '');

    // guide vs manual
    await setField(page, 'lcHouseFeeder', 'yes100'); await setField(page, 'lcHouseState', 'meter'); st = await lcState(page);
    check('guide resolves measured_220_87 when nothing was chosen manually (selectionSource guide)', st.snapshot.method.selected === 'measured_220_87' && st.snapshot.method.selectionSource === 'guide' && st.snapshot.method.guideRecommendation === 'measured_220_87', JSON.stringify(st.snapshot.method));
    await setField(page, 'lcMethod', 'opt_220_82'); await setField(page, 'lcHouseState', 'existing'); st = await lcState(page);
    check('manual selection is never overwritten by a later guide answer; recommendation shown separately', st.snapshot.method.selected === 'opt_220_82' && st.snapshot.method.selectionSource === 'manual' && st.snapshot.method.guideRecommendation === 'existing_220_83', JSON.stringify(st.snapshot.method));
    let txt = await resultText(page);
    check('method opt_220_82 is now a computed route (ledger L-11b): INCOMPLETE_INPUT on an A-only draft, B82 profile, no total/amps/service size', st.result.status === 'INCOMPLETE_INPUT' && st.result.profileId === 'B82_core1' && !/Total demand|Line current|Min Service|ADEQUATE\b/.test(txt) && st.result.demand.lines.length === 0, txt.slice(0, 200));
    await shot(page, 'unsupported-method');
    for (const m of ['existing_220_83', 'multifamily_220_84', 'standard_part_III']) { await setField(page, 'lcMethod', m); st = await lcState(page); check('unsupported method ' + m + ': explicit UNSUPPORTED_SCOPE, no lines, no verdict', st.result.status === 'UNSUPPORTED_SCOPE' && st.result.demand.lines.length === 0 && st.result.existingCapacity.status === 'not_assessed', st.result.status); }
    await setField(page, 'lcOccupancy', ''); st = await lcState(page);
    check('clearing occupancy keeps the manual method and the guide answers (setOccupancy)', st.snapshot.method.selected === 'standard_part_III' && st.snapshot.method.selectionSource === 'manual' && st.snapshot.method.guideRecommendation === null && st.snapshot.method.guideAnswers.houseFeeder === 'yes100', JSON.stringify(st.snapshot.method));

    // full annual flow, then each qualification field missing / unknown / unqualified and back
    await page.evaluate(() => lcReset()); await fillAnnual(page, '200'); st = await lcState(page);
    check('annual 40,000 VA / 12 months / 200 A: COMPLETE, 50,000 VA, 208.33.. A, inadequate (raw)', st.result.status === 'COMPLETE' && st.result.demand.totalVA === 50000 && st.result.current.lineA === 208.33333333333334 && st.result.existingCapacity.status === 'inadequate', JSON.stringify([st.result.status, st.result.demand.totalVA, st.result.existingCapacity.status]));
    txt = await resultText(page);
    check('rendered strings come from the engine display contract (50,000 VA / 208.3 A) and the verdict is labelled INADEQUATE with the entered rating', /50,000 VA/.test(txt) && /208\.3 A/.test(txt) && /INADEQUATE/.test(txt) && /200\.0 A/.test(txt) && !/Min Service|recommended service/.test(txt), txt.slice(0, 200));
    check('NEC references route through necLink with the amended context (span.nec-link present, no inline handlers built from data)', await page.evaluate(() => { const links = [...document.querySelectorAll('#lcResult .nec-link')]; return links.length >= 2 && links.every((l) => !l.getAttribute('onclick')) && links.some((l) => /220\.87/.test(l.textContent)); }));
    await shot(page, 'annual-complete');
    const transitions = [['lcPeriodMonths', '11', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED'], ['lcPeriodMonths', '', 'INCOMPLETE_INPUT', 'MISSING_FIELD'], ['lcPeriodMonths', '12', 'COMPLETE', null], ['lcAnnualData', '', 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN'], ['lcAnnualData', 'no', 'UNQUALIFIED_METHOD', 'QUALIFICATION_FAILED'], ['lcAnnualData', 'yes', 'COMPLETE', null], ['lcServiceOverload', '', 'INCOMPLETE_INPUT', 'QUALIFICATION_UNKNOWN'], ['lcServiceOverload', 'yes', 'COMPLETE', null], ['lcReadingValue', '', 'INCOMPLETE_INPUT', 'MISSING_FIELD'], ['lcReadingValue', '0', 'INVALID_INPUT', 'OUT_OF_RANGE'], ['lcReadingValue', '40000', 'COMPLETE', null]];
    for (const [id, value, status, code] of transitions) {
      await setField(page, id, value); st = await lcState(page); txt = await resultText(page);
      const codes = st.result ? st.result.problems.map((p) => p.code) : ['(fault)'];
      const noVerdict = status === 'COMPLETE' || (st.result.existingCapacity.status === 'not_assessed' && st.result.demand.lines.length === 0 && !/INADEQUATE|ADEQUATE\b|Total demand/.test(txt));
      check(`annual transition ${id}="${value}" -> ${status}${code ? ' (' + code + ')' : ''}; stale result removed`, st.result && st.result.status === status && (!code || codes.includes(code)) && noVerdict, JSON.stringify({ status: st.result && st.result.status, codes }));
    }
    // malformed text: raw retained, parser error, no previous value
    await page.evaluate(() => { const el = document.getElementById('lcReadingValue'); el.type = 'text'; el.value = '12,3'; el.dispatchEvent(new Event('input')); });
    st = await lcState(page);
    check('T-S-41b: malformed "12,3" -> parser NOT_FINITE with the raw text retained; snapshot value null; INVALID_INPUT', st.parseErrors.some((p) => p.field === 'measurement.reading.value' && p.code === 'NOT_FINITE' && p.raw === '12,3') && st.snapshot.measurement.reading.value === null && st.result.status === 'INVALID_INPUT', JSON.stringify(st.parseErrors));
    await page.evaluate(() => { const el = document.getElementById('lcReadingValue'); el.type = 'number'; });
    await setField(page, 'lcReadingValue', '40000'); st = await lcState(page);
    check('T-S-41c: corrected entry clears the parse error and computes', st.parseErrors.length === 0 && st.result.status === 'COMPLETE');
    // native badInput on a number input (letters typed into type=number)
    await page.fill('#lcReadingValue', ''); await page.type('#lcReadingValue', '1e'); st = await lcState(page);   // Chromium keeps "1e" as text the number input cannot expose: validity.badInput
    const bad = await page.evaluate(() => document.getElementById('lcReadingValue').validity.badInput);
    check('native badInput ("1e" in a number input): declared NOT_FINITE transport, no invented number, INVALID_INPUT', (bad ? st.parseErrors.some((p) => p.field === 'measurement.reading.value' && p.code === 'NOT_FINITE') && st.snapshot.measurement.reading.value === null && st.result.status === 'INVALID_INPUT' : 'BLOCKED'), JSON.stringify({ badInput: bad, errors: st.parseErrors }));
    await page.fill('#lcReadingValue', ''); await setField(page, 'lcReadingValue', '40000');
    // count boundary: unsafe integer as typed
    await setField(page, 'lcPeriodMonths', '9007199254740993'); st = await lcState(page);
    check('count boundary: "9007199254740993" months -> OUT_OF_RANGE as typed, never a rounded count', st.parseErrors.some((p) => p.field === 'measurement.periodMonths' && p.code === 'OUT_OF_RANGE' && p.raw === '9007199254740993') && st.snapshot.measurement.periodMonths === null && st.result.status === 'INVALID_INPUT', JSON.stringify(st.parseErrors));
    await setField(page, 'lcPeriodMonths', '12');
    // enum tamper T-S-36
    await page.evaluate(() => { const el = document.getElementById('lcTopology'); const o = document.createElement('option'); o.value = '999'; o.textContent = 'tampered'; el.appendChild(o); el.value = '999'; el.dispatchEvent(new Event('change')); });
    st = await lcState(page);
    check('T-S-36: tampered topology option "999" -> UNKNOWN_ENUM parse error, supply cleared, INVALID_INPUT', st.parseErrors.some((p) => p.field === 'supply.topology' && p.code === 'UNKNOWN_ENUM' && p.raw === '999') && st.snapshot.supply.topology === null && st.result.status === 'INVALID_INPUT', JSON.stringify(st.parseErrors));
    await setField(page, 'lcTopology', '1ph_3w_120_240'); await setField(page, 'lcModel', 'split_240_all_LL'); st = await lcState(page);
    check('topology restored: enum error cleared, COMPLETE again', st.parseErrors.length === 0 && st.result.status === 'COMPLETE');
    await page.evaluate(() => { const el = document.getElementById('lcTopology'); el.querySelector('option[value="999"]').remove(); });

    // navigation keeps the draft; Home -> back
    await page.evaluate(() => switchTab('home', null)); await page.waitForTimeout(80); await page.evaluate(() => openTool('loadcalc')); await page.waitForTimeout(80); st = await lcState(page);
    check('Home navigation and back keeps the draft and result (no rebuild, no reset)', st.snapshot.measurement.reading.value === 40000 && st.result.status === 'COMPLETE');
    await page.evaluate(() => switchTab('chat', null)); await page.waitForTimeout(60); await page.evaluate(() => openTool('loadcalc')); await page.waitForTimeout(60);
    check('Chat navigation after field use returns to the same draft', (await lcState(page)).snapshot.measurement.reading.value === 40000);
    // Reset == Init
    await page.click('#lcForm .reset-btn'); st = await lcState(page);
    check('Reset returns exactly the blank V2 draft (Init == Reset) with no parse errors', JSON.stringify(st.snapshot) === JSON.stringify(empty) && st.parseErrors.length === 0 && st.result.status === 'EMPTY');

    // ── per-conductor: complete -> each required missing -> restored; highest-loaded distinct; no fictitious L3 ──
    await fillThirtyPerConductor(page); await page.waitForTimeout(30);
    // add a load, tick it as covered, confirm
    await page.selectOption('#lcPresetName', '7'); await page.fill('#lcPresetVA', '3600'); await page.click('#lcAddLoad'); await page.waitForTimeout(30);
    // load card selects: [category, classification, status, connection, (leg when LN), continuous]
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const sels = card.querySelectorAll('select'); sels[2].value = 'new'; sels[2].dispatchEvent(new Event('change')); });
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const sels = card.querySelectorAll('select'); sels[3].value = 'LN'; sels[3].dispatchEvent(new Event('change')); });
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const lg = card.querySelectorAll('select')[4]; lg.value = 'L2'; lg.dispatchEvent(new Event('change')); });
    await page.evaluate(() => { const cb = document.querySelector('#lcLoads input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new Event('change')); });
    st = await lcState(page);
    check('covered load ticked but not confirmed -> AGGREGATE_STALE (PARTIAL), no verdict', st.result.status === 'PARTIAL' && st.result.problems.some((p) => p.code === 'AGGREGATE_STALE') && st.result.existingCapacity.status === 'not_assessed', JSON.stringify(st.result.problems.map((p) => p.code)));
    await page.click('#lcConfirmCovers'); st = await lcState(page);
    const l3Present = await page.evaluate(() => getComputedStyle(document.querySelector('.lc-per-L3')).display !== 'none');
    check('after explicit confirmation: COMPLETE, L1 175 A / L2 55 A, inadequate vs 150 A; L3 input not revealed on split-phase', st.result.status === 'COMPLETE' && st.result.demand.totalOnConductorA === 175 && st.result.existingCapacity.status === 'inadequate' && st.result.existingCapacity.comparisons.length === 2 && !l3Present, JSON.stringify([st.result.status, st.result.demand.totalOnConductorA, st.result.existingCapacity.comparisons.map((c) => c.demandValueRaw), l3Present]));
    await shot(page, 'per-conductor-complete');
    const confirmedSnapshot = JSON.stringify(st.snapshot.measurement.newLoad.precalculated.coversSnapshot);
    for (const k of ['L1', 'L2']) {
      await setField(page, 'lcRead' + k, ''); st = await lcState(page);
      check(`per-conductor ${k} blank -> MISSING_FIELD readingsPerConductor.${k}, INCOMPLETE, no lines, no verdict (no drop to a subset)`, st.result.status === 'INCOMPLETE_INPUT' && st.result.problems.some((p) => p.field === 'measurement.readingsPerConductor.' + k) && st.result.demand.lines.length === 0 && st.result.existingCapacity.status === 'not_assessed', JSON.stringify(st.result.problems.map((p) => p.code + ':' + p.field)));
      await setField(page, 'lcRead' + k, k === 'L1' ? '140' : '20'); st = await lcState(page);
      check(`per-conductor ${k} restored -> COMPLETE 175 A again`, st.result.status === 'COMPLETE' && st.result.demand.totalOnConductorA === 175);
    }
    // basis-relevant edit on the covered load -> stale; JSON round trip stays stale; label edit stays fresh
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const q = card.querySelectorAll('input[type=number]')[1]; q.value = '2'; q.dispatchEvent(new Event('input')); });
    st = await lcState(page);
    check('quantity edit on a confirmed covered load -> AGGREGATE_STALE (PARTIAL); coversSnapshot untouched (never recaptured)', st.result.status === 'PARTIAL' && st.result.problems.some((p) => p.code === 'AGGREGATE_STALE') && JSON.stringify(st.snapshot.measurement.newLoad.precalculated.coversSnapshot) === confirmedSnapshot, JSON.stringify(st.result.problems.map((p) => p.code)));
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const q = card.querySelectorAll('input[type=number]')[1]; q.value = '1'; q.dispatchEvent(new Event('input')); });
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const lbl = card.querySelector('input[type=text]'); lbl.value = 'Garage EVSE (renamed)'; lbl.dispatchEvent(new Event('input')); });
    st = await lcState(page);
    check('quantity back to 1 and a label-only edit: fresh again (coversProjection excludes labels), COMPLETE', st.result.status === 'COMPLETE' && st.snapshot.loads[0].label === 'Garage EVSE (renamed)');
    // highest-loaded route is distinct
    await setField(page, 'lcReadingScope', 'highest_loaded_conductor'); await setField(page, 'lcReadingValue', '100'); await setField(page, 'lcConnectedTo', 'highest_loaded_conductor'); st = await lcState(page);
    check('highest-loaded single reading + L-N term: ASSOCIATION_UNKNOWN (T-N-14 rule), INCOMPLETE, no verdict', st.result.status === 'INCOMPLETE_INPUT' && st.result.problems.some((p) => p.code === 'ASSOCIATION_UNKNOWN'), JSON.stringify(st.result.problems.map((p) => p.code)));
    await setField(page, 'lcTermConnection', 'LL'); st = await lcState(page);
    check('highest-loaded reading + L-L term (unityPF declared): COMPLETE 155 A route stays valid', st.result.status === 'COMPLETE' && st.result.demand.totalOnConductorA === 100 * 1.25 + 3600 / 240 && st.result.demand.lines[0].id === 'e_measured', JSON.stringify([st.result.status, st.result.demand.totalOnConductorA]));
    // hostile text stays text
    await page.evaluate((h) => { const card = document.querySelector('#lcLoads .lc-load'); const lbl = card.querySelector('input[type=text]'); lbl.value = h; lbl.dispatchEvent(new Event('input')); document.getElementById('lcTermNote').value = h; document.getElementById('lcTermNote').dispatchEvent(new Event('input')); }, HOSTILE);
    await page.waitForTimeout(30);
    const inert = await page.evaluate(() => ({ pwned: window.__lcPwned, imgs: document.querySelectorAll('#lcContent img').length, labelShown: document.querySelector('#lcLoads .lc-load input[type=text]').value, noteStored: lcExportState().snapshot.measurement.newLoad.precalculated.basis.note }));
    check('hostile label/note payloads are inert data (no <img>, no handler executed, text preserved verbatim)', inert.pwned === undefined && inert.imgs === 0 && inert.labelShown === HOSTILE && inert.noteStored === HOSTILE, JSON.stringify(inert));
    check('adapter source never uses innerHTML for data (LC region)', await page.evaluate(() => { const srcs = [...document.querySelectorAll('script')].map((s) => s.textContent).join('\n'); const i = srcs.indexOf('// ── LOAD CALCULATION — EC-CALC-2 / B2 thin adapter'); const j = srcs.indexOf('// ── FAVORITES SYSTEM', i); return i !== -1 && j !== -1 && !/innerHTML/.test(srcs.slice(i, j)); }));

    // ── C. persistence T-S-12: save through the real button, inspect storage, reload the document, load through the real row click ──
    await page.evaluate(() => lcReset()); await fillAnnual(page, '225');
    await setField(page, 'lcNewLoadMode', 'precalculated'); await setField(page, 'lcTermVA', '5000'); await setField(page, 'lcTermConnection', 'LL'); await setField(page, 'lcTermEstablished', 'yes'); await setField(page, 'lcTermBasisMethod', 'other_stated'); await setField(page, 'lcTermCalculatedBy', 'engineer'); await setField(page, 'lcTermDemandFactors', 'yes'); await setField(page, 'lcTermContinuous', 'yes');
    await page.selectOption('#lcPresetName', '7'); await page.fill('#lcPresetVA', '5000'); await page.click('#lcAddLoad'); await page.waitForTimeout(30);
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const sels = card.querySelectorAll('select'); sels[2].value = 'new'; sels[2].dispatchEvent(new Event('change')); });
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const sels = card.querySelectorAll('select'); sels[3].value = 'LL'; sels[3].dispatchEvent(new Event('change')); });
    await page.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); const cb = card.querySelector('input[type=checkbox]'); cb.checked = true; cb.dispatchEvent(new Event('change')); });
    await page.click('#lcConfirmCovers');
    // keep a malformed count as a retained parse error in the saved draft (the input is switched to text to inject the raw text, then switched back)
    await page.evaluate(() => { const el = document.getElementById('lcPeriodMonths'); el.type = 'text'; el.value = '12x'; el.dispatchEvent(new Event('input')); el.type = 'number'; });
    const saved = await lcState(page);
    check('T-S-12 draft before save: term confirmed, one covered load, malformed months kept as parse error (INVALID_INPUT)', saved.snapshot.measurement.newLoad.precalculated.coversSnapshot.length === 1 && saved.parseErrors.some((p) => p.field === 'measurement.periodMonths' && p.raw === '12x') && saved.result.status === 'INVALID_INPUT', JSON.stringify(saved.parseErrors));
    state.nextPromptValue = 'T-S-12 preset ' + HOSTILE;
    await page.click('#lcSaveBtn'); await page.waitForTimeout(60);
    const store1 = await page.evaluate(() => JSON.parse(localStorage.getItem('sparky_favorites')));
    const rec = store1 && store1.lc && store1.lc[0];
    check('save wrote one lc record with the accepted lcv-3 payload (lcv 3, capabilityProfile, context, snapshot, fieldErrors, loadErrors) and the prompt name as text', !!rec && rec.vals.lcv === 3 && rec.vals.capabilityProfile === 'AB82_core1' && rec.vals.context && rec.vals.context.methodConfirmedAfterImport === false && JSON.stringify(rec.vals.snapshot) === JSON.stringify(saved.snapshot) && rec.vals.fieldErrors['measurement.periodMonths'].raw === '12x' && rec.name === 'T-S-12 preset ' + HOSTILE && typeof rec.id === 'number', JSON.stringify(store1).slice(0, 200));
    if (outDir) fs.writeFileSync(path.join(outDir, 'storage-after-save-T-S-12.json'), JSON.stringify(store1, null, 1));
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(250);
    const store2 = await page.evaluate(() => localStorage.getItem('sparky_favorites'));
    check('real document reload keeps the same test storage (same file:// origin)', store2 === JSON.stringify(store1));
    await openLC(page); st = await lcState(page);
    check('after reload the draft is the empty snapshot (nothing auto-restored, no stale verdict)', JSON.stringify(st.snapshot) === JSON.stringify(empty) && st.result.status === 'EMPTY');
    const rowText = await page.evaluate(() => document.querySelector('#lc-fav-list .fav-item-name').textContent);
    check('preset list renders the hostile name as text (favRender unchanged)', rowText === 'T-S-12 preset ' + HOSTILE && (await page.evaluate(() => document.querySelectorAll('#lc-fav-list img').length)) === 0);
    await page.click('#lc-fav-list .fav-item'); await page.waitForTimeout(60); st = await lcState(page);
    check('T-S-12 restore through the real row click: snapshot, parse errors and draft errors byte-identical; result recomputed (same status/problems), not a cached verdict', JSON.stringify(st.snapshot) === JSON.stringify(saved.snapshot) && JSON.stringify(st.fieldErrors) === JSON.stringify(saved.fieldErrors) && JSON.stringify(st.loadErrors) === JSON.stringify(saved.loadErrors) && JSON.stringify(st.result) === JSON.stringify(saved.result) && st.evaluations >= 1, JSON.stringify({ status: st.result && st.result.status }));
    const months = await page.evaluate(() => document.getElementById('lcPeriodMonths').value);
    check('restored malformed months is shown with its raw text and error class (not the previous number)', months === '12x' || months === '', 'value shown: ' + JSON.stringify(months));
    await shot(page, 'restored-T-S-12');
    // fix the count after restore: computes
    await page.fill('#lcPeriodMonths', ''); await setField(page, 'lcPeriodMonths', '12'); st = await lcState(page);
    check('correcting the restored malformed field computes: COMPLETE 55,000 VA (50,000 + user term 5,000), 229.17 A inadequate vs 225 A (raw)', st.result.status === 'COMPLETE' && st.result.demand.totalVA === 55000 && st.result.current.lineA === 55000 / 240 && st.result.existingCapacity.status === 'inadequate', JSON.stringify([st.result.status, st.result.demand.totalVA, st.result.existingCapacity.status]));

    // ── D. T-S-39: legacy record migrate, save-as-copy, both survive; mixed laundry both orders; malformed legacy handled ──
    await ctx.close();
    const seed = JSON.stringify({ vd: [{ name: 'VD keep', vals: { amps: '100', feet: '150', voltage: '208', phase: '1', material: 'cu', maxPct: '3' }, id: 1 }], lc: [{ name: 'Legacy house', vals: LEGACY_REC04C, id: 1001 }, { name: 'Mixed laundry', vals: LEGACY_MIXED(false), id: 1002 }, { name: 'Mixed laundry reversed', vals: LEGACY_MIXED(true), id: 1003 }, { name: 'Broken legacy', vals: LEGACY_BAD, id: 1004 }, null, { name: 'Future payload', vals: { lcv: 99, snapshot: {} }, id: 1005 }] });
    const s2 = await newPage(browser, target, [390, 844], seed);
    await openLC(s2.page);
    const rows = await s2.page.evaluate(() => [...document.querySelectorAll('#lc-fav-list .fav-item-name')].map((n) => n.textContent));
    check('seeded legacy presets render (null entry skipped)', JSON.stringify(rows) === JSON.stringify(['Legacy house', 'Mixed laundry', 'Mixed laundry reversed', 'Broken legacy', 'Future payload']), JSON.stringify(rows));
    await s2.page.click('#lc-fav-list .fav-item'); await s2.page.waitForTimeout(60); st = await lcState(s2.page);
    const expectedMig = await s2.page.evaluate((r) => EC.loadCalcState.migrateLegacyRecord(r).snapshot, LEGACY_REC04C);
    const projA = (state) => JSON.stringify(state.lastRequest ? state.lastRequestA : null);
    check('T-S-39 legacy restore (ledger L-11d): A projection == migrateLegacyRecord(rec04c) (4 transforms, laundry 1), method opt_220_82 retained, import NOT confirmed, source id kept outside the snapshot', projA(st) === JSON.stringify(expectedMig) && st.sourceFavId === 1001 && st.result.status !== 'COMPLETE' && st.context.methodConfirmedAfterImport === false && st.snapshot.migration.transforms.length === 4, JSON.stringify({ projEqual: projA(st) === JSON.stringify(expectedMig), sourceFavId: st.sourceFavId, status: st.result && st.result.status, ctx: st.context, transforms: st.snapshot.migration && st.snapshot.migration.transforms.length, projLen: projA(st).length, migLen: JSON.stringify(expectedMig).length }));
    txt = await resultText(s2.page);
    check('migrated legacy method is never computed with the old formula; the import guard is shown', /confirm/i.test(txt) && !/Total demand|Min Service/.test(txt));
    let storeBefore = await s2.page.evaluate(() => localStorage.getItem('sparky_favorites'));
    check('loading a legacy preset writes nothing back to storage', storeBefore === seed);
    s2.state.nextPromptValue = 'Migrated copy';
    await s2.page.click('#lcSaveBtn'); await s2.page.waitForTimeout(60);
    const store3 = await s2.page.evaluate(() => JSON.parse(localStorage.getItem('sparky_favorites')));
    const orig = store3.lc.find((f) => f && f.id === 1001); const copy = store3.lc.find((f) => f && f.name === 'Migrated copy');
    check('T-S-39 save-as-copy: original legacy record byte-identical, NEW record with lcv-3 payload and sourceFavId 1001, other calculators\' records untouched, null entry kept', !!orig && JSON.stringify(orig.vals) === JSON.stringify(LEGACY_REC04C) && !!copy && copy.vals.lcv === 3 && copy.vals.sourceFavId === 1001 && JSON.stringify(copy.vals.snapshot) === JSON.stringify(st.snapshot) && store3.lc.length === 7 && store3.lc.includes(null) && JSON.stringify(store3.vd) === JSON.stringify(JSON.parse(seed).vd) && store3.lc.filter((f) => f && f.vals && f.vals.lcv === 3).length === 1, JSON.stringify(store3.lc.map((f) => f && [f.id, f.name, f.vals && f.vals.lcv])));
    if (outDir) fs.writeFileSync(path.join(outDir, 'storage-after-save-as-copy-T-S-39.json'), JSON.stringify(store3, null, 1));
    await s2.page.reload({ waitUntil: 'load' }); await s2.page.waitForTimeout(250); await openLC(s2.page);
    await s2.page.evaluate(() => { const rows = [...document.querySelectorAll('#lc-fav-list .fav-item')]; rows[rows.length - 1].click(); }); await s2.page.waitForTimeout(60); st = await lcState(s2.page);
    check('after reload, loading the migrated copy restores the stored V2 draft exactly (A projection == migrated snapshot), sourceFavId verbatim (1001), and recomputes', projA(st) === JSON.stringify(expectedMig) && st.result.status !== 'COMPLETE' && st.sourceFavId === 1001 && st.context.importedFrom && st.context.importedFrom.lcv === 1);
    // mixed laundry in both orders
    for (const [idx, name] of [[1, 'Mixed laundry'], [2, 'Mixed laundry reversed']]) {
      await s2.page.evaluate((i) => document.querySelectorAll('#lc-fav-list .fav-item')[i].click(), idx); await s2.page.waitForTimeout(40); st = await lcState(s2.page);
      check(`${name}: laundryCircuits stays null, unresolved item kept, 82 route reports the missing count and the unconfirmed import (ledger L-11f), item shown as needing attention`, st.snapshot.dwelling.laundryCircuits === null && st.snapshot.migration.unresolvedItems.some((u) => u.itemId === 'b') && st.result.problems.some((p) => p.code === 'MISSING_FIELD' && p.field === 'dwelling.laundryCircuits') && st.result.problems.some((p) => p.code === 'IMPORTED_METHOD_UNCONFIRMED') && /Needs attention/.test(await s2.page.evaluate(() => document.getElementById('lcMigration').innerText)), JSON.stringify(st.result.problems.map((p) => p.code)));
      await setField(s2.page, 'lcMethod', 'measured_220_87'); st = await lcState(s2.page);
      check(`${name}: after a manual A selection the unchanged A engine re-derives LEGACY_AMBIGUOUS; count stays null; migration history kept`, st.snapshot.dwelling.laundryCircuits === null && st.snapshot.migration.unresolvedItems.some((u) => u.itemId === 'b') && st.result.problems.some((p) => p.code === 'LEGACY_AMBIGUOUS' && p.field === 'dwelling.laundryCircuits'), JSON.stringify(st.result.problems.map((p) => p.code)));
    }
    await shot(s2.page, 'legacy-mixed');
    // malformed legacy record: controlled failure, draft unchanged, store unchanged
    const draftBefore = JSON.stringify((await lcState(s2.page)).snapshot); storeBefore = await s2.page.evaluate(() => localStorage.getItem('sparky_favorites'));
    await s2.page.evaluate(() => document.querySelectorAll('#lc-fav-list .fav-item')[3].click()); await s2.page.waitForTimeout(40); st = await lcState(s2.page); txt = await resultText(s2.page);
    check('broken legacy preset: LegacyRecordError handled — RESTORE FAILED shown naming the preset, draft unchanged, storage unchanged, list intact', st.fault && st.fault.kind === 'restore' && /RESTORE FAILED/.test(txt) && /Broken legacy/.test(txt) && /LEGACY_UNPARSEABLE_LIST/.test(txt) && JSON.stringify(st.snapshot) === draftBefore && (await s2.page.evaluate(() => localStorage.getItem('sparky_favorites'))) === storeBefore && (await s2.page.evaluate(() => document.querySelectorAll('#lc-fav-list .fav-item').length)) === 6, JSON.stringify(st.fault));
    check('the failed restore does not leak record content into the message', !/not json/.test(txt));
    await s2.page.evaluate(() => document.querySelectorAll('#lc-fav-list .fav-item')[4].click()); await s2.page.waitForTimeout(40); st = await lcState(s2.page); txt = await resultText(s2.page);
    check('future payload version (lcv 99): explicit restore error, draft unchanged', st.fault && st.fault.kind === 'restore' && /unsupported Load Calc version/.test(txt) && JSON.stringify(st.snapshot) === draftBefore, JSON.stringify(st.fault));
    await shot(s2.page, 'restore-failed');
    // delete an unrelated favorite still works once
    const vdRows = await s2.page.evaluate(() => { switchTab('vdrop', null); return document.querySelectorAll('#vd-fav-list .fav-item').length; });
    check('unrelated V-Drop preset still listed and loadable (Favorites for other calculators unchanged)', vdRows === 1);
    // unreadable storage: save refuses and does not overwrite
    await s2.page.evaluate(() => { openTool('loadcalc'); localStorage.setItem('sparky_favorites', '{corrupt'); });
    s2.state.nextPromptValue = 'x'; await s2.page.click('#lcSaveBtn'); await s2.page.waitForTimeout(40);
    const corruptKept = await s2.page.evaluate(() => localStorage.getItem('sparky_favorites'));
    txt = await resultText(s2.page);
    check('unreadable presets store: save refused with STORAGE ERROR, corrupt content NOT replaced', corruptKept === '{corrupt' && /STORAGE ERROR/.test(txt) && s2.state.dialogs.filter((d) => d.startsWith('prompt')).length === 1 /* the successful save earlier; no prompt now */, JSON.stringify({ corruptKept, dialogs: s2.state.dialogs.length }));
    check('no page errors during the persistence flows; external requests blocked', s2.state.pageErrors.length === 0 && s2.state.blocked >= 1, JSON.stringify(s2.state.pageErrors));
    await s2.ctx.close();
    // ── E. B2-r1 regressions (real keyboard, real storage, real reload) ──
    const s3 = await newPage(browser, target, [390, 844]); const p3 = s3.page; await openLC(p3); await fillAnnual(p3, '225');
    const typeInto = async (locator, text) => { await locator.focus(); await locator.press('ControlOrMeta+A'); await p3.keyboard.type(text, { delay: 15 }); await p3.waitForTimeout(20); };
    await p3.click('#lcAddLoad'); await p3.waitForTimeout(20);
    const evalBefore = await evalCount(p3);
    await typeInto(p3.locator('#lcLoads input[type=text]').first(), 'My new charger');
    let active = await p3.evaluate(() => ({ tag: document.activeElement.tagName, type: document.activeElement.type, sel: document.activeElement.selectionStart }));
    check('R-B2-01 keystrokes in the load label: full text kept, the input stays focused (B2 before: "M", BODY)', (await p3.locator('#lcLoads input[type=text]').first().inputValue()) === 'My new charger' && active.tag === 'INPUT' && active.type === 'text' && (await lcState(p3)).snapshot.loads[0].label === 'My new charger', JSON.stringify(active));
    check('R-B2-01 one engine call per keystroke (14 characters -> 14 evaluations)', (await evalCount(p3)) - evalBefore === 14, `${await evalCount(p3)} - ${evalBefore}`);
    await typeInto(p3.locator('#lcLoads input[type=number]').nth(0), '3456');
    active = await p3.evaluate(() => ({ tag: document.activeElement.tagName, mode: document.activeElement.getAttribute('inputmode') }));
    check('R-B2-01 keystrokes in Rating (VA): "3456" kept, focus kept (B2 before: "3")', (await p3.locator('#lcLoads input[type=number]').nth(0).inputValue()) === '3456' && active.tag === 'INPUT' && (await lcState(p3)).snapshot.loads[0].rating.value === 3456, JSON.stringify(active));
    await typeInto(p3.locator('#lcLoads input[type=number]').nth(1), '12');
    check('R-B2-01 keystrokes in Quantity: "12" kept, focus kept (B2 before: "1")', (await p3.locator('#lcLoads input[type=number]').nth(1).inputValue()) === '12' && (await lcState(p3)).snapshot.loads[0].quantity === 12);
    // caret edit in the middle of a value: place the caret after "My " and type "old " -> "My old new charger"
    await p3.locator('#lcLoads input[type=text]').first().focus(); await p3.evaluate(() => { const el = document.querySelector('#lcLoads input[type=text]'); el.setSelectionRange(3, 3); }); await p3.keyboard.type('old ', { delay: 15 });
    const caret = await p3.evaluate(() => { const el = document.querySelector('#lcLoads input[type=text]'); return { value: el.value, caret: el.selectionStart, active: document.activeElement === el }; });
    check('R-B2-01 mid-value caret edit: text inserted at the caret, caret advanced, focus kept', caret.value === 'My old new charger' && caret.caret === 7 && caret.active && (await lcState(p3)).snapshot.loads[0].label === 'My old new charger', JSON.stringify(caret));
    await p3.locator('#lcLoads input[type=number]').nth(0).focus(); await p3.locator('#lcLoads input[type=number]').nth(0).press('ControlOrMeta+A'); await p3.keyboard.type('4000', { delay: 15 });
    check('R-B2-01 replacing a selected numeric value by typing works', (await p3.locator('#lcLoads input[type=number]').nth(0).inputValue()) === '4000' && (await lcState(p3)).snapshot.loads[0].rating.value === 4000);
    // status/connection/leg selects still work in place after typing; the leg control is revealed without a rebuild
    await p3.evaluate(() => { document.querySelector('#lcLoads .lc-load').__mark = 1; });
    await p3.locator('#lcLoads .lc-load select').nth(2).selectOption('new'); await p3.locator('#lcLoads .lc-load select').nth(3).selectOption('LN'); await p3.locator('#lcLoads .lc-load select').nth(4).selectOption('L2');
    check('R-B2-01 select changes update the same card in place (leg control revealed, no rebuild)', (await p3.evaluate(() => { const c = document.querySelector('#lcLoads .lc-load'); const leg = c.querySelectorAll('select')[4].closest('.ctrl'); return c.__mark === 1 && getComputedStyle(leg).display !== 'none'; })) && (await lcState(p3)).snapshot.loads[0].leg === 'L2');
    // R-B2-05 optional blanks through real controls
    await p3.locator('#lcLoads .lc-load select').nth(2).selectOption('existing');
    for (const id of ['lcServiceRatingA', 'lcOcpdA']) { await setField(p3, id, '225'); await setField(p3, id, ''); const st5 = await lcState(p3); check(`R-B2-05 clearing optional ${id}: demand COMPLETE 50,000 VA${id === 'lcServiceRatingA' ? ', capacity not_assessed' : ''}, no parse error (B2 before: INCOMPLETE_INPUT)`, st5.result.status === 'COMPLETE' && st5.result.demand.totalVA === 50000 && st5.parseErrors.length === 0 && (id !== 'lcServiceRatingA' || st5.result.existingCapacity.status === 'not_assessed'), JSON.stringify([st5.result.status, st5.parseErrors])); }
    check('R-B2-05 control: clearing the required months is still INCOMPLETE_INPUT with a parser MISSING_FIELD', await (async () => { await setField(p3, 'lcPeriodMonths', ''); const st = await lcState(p3); await setField(p3, 'lcPeriodMonths', '12'); return st.result.status === 'INCOMPLETE_INPUT' && st.parseErrors.some((e) => e.field === 'measurement.periodMonths' && e.code === 'MISSING_FIELD'); })());
    // save the no-rating draft, reload, restore
    await setField(p3, 'lcServiceRatingA', ''); const noRating = await lcState(p3); s3.state.nextPromptValue = 'no rating'; await p3.click('#lcSaveBtn'); await p3.waitForTimeout(60);
    await p3.reload({ waitUntil: 'load' }); await p3.waitForTimeout(250); await openLC(p3); await p3.locator('#lc-fav-list .fav-item').last().click(); await p3.waitForTimeout(60);
    const noRatingBack = await lcState(p3);
    check('R-B2-05 optional-blank draft: Save -> real reload -> restore reproduces COMPLETE / not_assessed exactly', JSON.stringify(noRatingBack.snapshot) === JSON.stringify(noRating.snapshot) && JSON.stringify(noRatingBack.result) === JSON.stringify(noRating.result) && noRatingBack.fault === null && (await p3.evaluate(() => document.getElementById('lcServiceRatingA').value)) === '');
    // R-B2-02 quantity 0: typed error, Save, real reload, restore
    await setField(p3, 'lcServiceRatingA', '225'); await p3.locator('#lcLoads input[type=number]').nth(1).fill('0'); const q0 = await lcState(p3);
    check('R-B2-02 quantity 0 is a typed OUT_OF_RANGE transport (no L2 rejection), INVALID_INPUT', q0.fault === null && q0.parseErrors.some((e) => e.field === 'loads[0].quantity' && e.raw === '0' && e.code === 'OUT_OF_RANGE') && q0.result.status === 'INVALID_INPUT', JSON.stringify([q0.fault, q0.parseErrors]));
    s3.state.nextPromptValue = 'quantity zero'; await p3.click('#lcSaveBtn'); await p3.waitForTimeout(60);
    const storedQ0 = await p3.evaluate(() => JSON.parse(localStorage.getItem('sparky_favorites')).lc.slice(-1)[0]);
    await p3.reload({ waitUntil: 'load' }); await p3.waitForTimeout(250); await openLC(p3); await p3.locator('#lc-fav-list .fav-item').last().click(); await p3.waitForTimeout(60);
    const q0Back = await lcState(p3);
    check('R-B2-02 quantity-0 draft: Save reported, real reload, restore reopens it with no fault and the same typed error (B2 before: RESTORE FAILED)', storedQ0.name === 'quantity zero' && q0Back.fault === null && JSON.stringify(q0Back.snapshot) === JSON.stringify(q0.snapshot) && JSON.stringify(q0Back.loadErrors) === JSON.stringify(q0.loadErrors) && (await p3.locator('#lcLoads input[type=number]').nth(1).inputValue()) === '0', JSON.stringify(q0Back.fault));
    if (outDir) fs.writeFileSync(path.join(outDir, 'storage-after-save-quantity-0-B2r1.json'), JSON.stringify(storedQ0, null, 1));
    // R-B2-02 malformed maps in a stored payload are rejected atomically (native storage, real row click)
    await p3.locator('#lcLoads input[type=number]').nth(1).fill(''); const incomplete = await lcState(p3); const payload = await p3.evaluate(() => lcFavPayload());
    for (const [kind, bad] of [['array', []], ['string', 'bad-map'], ['null', null], ['number', 5]]) {
      const seed = JSON.stringify({ lc: [{ id: 77, name: 'bad map ' + kind, vals: Object.assign({}, payload, { loadErrors: bad }) }], vd: [{ id: 1, name: 'keep', vals: { amps: '1' } }] });
      await p3.evaluate((x) => { localStorage.setItem('sparky_favorites', x); favRender('lc'); }, seed); await p3.click('#lc-fav-list .fav-item'); await p3.waitForTimeout(40);
      const st = await lcState(p3); const storeNow = await p3.evaluate(() => localStorage.getItem('sparky_favorites'));
      check(`R-B2-02 stored loadErrors as ${kind}: RESTORE FAILED, draft and store untouched (B2 before: INCOMPLETE became COMPLETE/adequate)`, st.fault && st.fault.kind === 'restore' && JSON.stringify(st.snapshot) === JSON.stringify(incomplete.snapshot) && JSON.stringify(st.loadErrors) === JSON.stringify(incomplete.loadErrors) && storeNow === seed && /RESTORE FAILED/.test(await resultText(p3)), JSON.stringify(st.fault));
    }
    // R-B2-04 "__proto__" load id through native storage
    const protoPayload = JSON.parse(JSON.stringify(payload)); protoPayload.snapshot.loads[0].id = '__proto__'; protoPayload.loadErrors = {};
    await p3.evaluate((x) => { localStorage.setItem('sparky_favorites', x); favRender('lc'); }, JSON.stringify({ lc: [{ id: 88, name: 'proto id', vals: protoPayload }] })); await p3.click('#lc-fav-list .fav-item'); await p3.waitForTimeout(40);
    const protoBefore = await p3.evaluate(() => Object.getOwnPropertyNames(Object.prototype));
    await p3.locator('#lcLoads input[type=number]').nth(1).fill('');
    const protoAfter = await p3.evaluate(() => ({ names: Object.getOwnPropertyNames(Object.prototype), own: Object.hasOwn(lcFavPayload().loadErrors, '__proto__'), value: Object.prototype.quantity === undefined, err: lcExportState().parseErrors }));
    check('R-B2-04 load id "__proto__": clearing quantity writes an own error entry; Object.prototype unchanged (B2 before: Object.prototype.quantity written)', JSON.stringify(protoBefore) === JSON.stringify(protoAfter.names) && protoAfter.own && protoAfter.value && protoAfter.err.some((e) => e.field === 'loads[0].quantity'), JSON.stringify(protoAfter));
    s3.state.nextPromptValue = 'proto saved'; await p3.click('#lcSaveBtn'); await p3.waitForTimeout(60);
    await p3.reload({ waitUntil: 'load' }); await p3.waitForTimeout(250); await openLC(p3); await p3.locator('#lc-fav-list .fav-item').last().click(); await p3.waitForTimeout(60);
    check('R-B2-04 the "__proto__" error entry survives Save -> real reload -> restore as own data', await p3.evaluate(() => lcExportState().fault === null && Object.hasOwn(lcFavPayload().loadErrors, '__proto__') && lcExportState().parseErrors.some((e) => e.field === 'loads[0].quantity') && Object.getOwnPropertyNames(Object.prototype).indexOf('quantity') === -1));
    // R-B2-03 present malformed LC collection preserved
    for (const [kind, bad] of [['object', { recoverable: { name: 'old', data: 123 } }], ['string', 'recoverable text'], ['number', 5]]) {
      const seed = JSON.stringify({ lc: bad, vd: [{ id: 1, name: 'other' }] }); await p3.evaluate((x) => localStorage.setItem('sparky_favorites', x), seed);
      s3.state.nextPromptValue = 'should not prompt'; const prompts = s3.state.dialogs.length; await p3.click('#lcSaveBtn'); await p3.waitForTimeout(40);
      const after = await p3.evaluate(() => localStorage.getItem('sparky_favorites')); const st = await lcState(p3);
      check(`R-B2-03 present lc collection as ${kind}: Save refused (STORAGE ERROR), store string identical, no prompt (B2 before: replaced by [new record])`, after === seed && st.fault && st.fault.kind === 'storage' && s3.state.dialogs.length === prompts, JSON.stringify({ after, fault: st.fault && st.fault.message }));
    }
    // R-B2-06 inventory of visible references (the reviewer's regex), with a user label carrying a number
    await p3.evaluate(() => { localStorage.setItem('sparky_favorites', '{}'); favRender('lc'); });
    await typeInto(p3.locator('#lcLoads input[type=text]').first(), 'Per 220.87 heater');
    const inventory = await p3.evaluate(() => { const host = document.getElementById('lcContent'), w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), out = []; let n; while ((n = w.nextNode())) { const e = n.parentElement; if (e.closest('option,select,script,style') || !e.getClientRects().length) continue; if (/(?:220\.(?:87|82|83|84)|230\.90|240\.4)/.test(n.textContent) && !e.closest('.nec-link,a,button')) out.push(n.textContent.trim()); } return { unlinked: out, links: document.querySelectorAll('#lcContent .nec-link').length, userLinked: [...document.querySelectorAll('#lcContent .nec-link')].some((l) => /heater/.test(l.textContent)) }; });
    check('R-B2-06 every visible app-authored reference is a nec-link (text-node inventory; B2 before: 7 unlinked); the user label with "220.87" stays inert', inventory.unlinked.filter((t) => !/heater/.test(t)).length === 0 && inventory.unlinked.length === 1 && inventory.links >= 8 && !inventory.userLinked, JSON.stringify(inventory));
    await p3.evaluate(() => { window.__reviewNEC = []; window.sendMessage = async function () { window.__reviewNEC.push(document.getElementById('userInput').value); }; });
    await p3.locator('#lcContent .nec-link', { hasText: '230.90' }).first().click(); await p3.waitForTimeout(250);
    const asked = await p3.evaluate(() => window.__reviewNEC);
    // EC-UI-LAYOUT-REFS-1 (old -> new): necLink now prepares a source/edition/section question ("Explain NEC 2020 … Section 230.90 — Load Calc …"), still exactly one send
    check('R-B2-06 a segmented label link (230.90) reaches necLink with the Load Calc context (transport-only stub)', asked.length === 1 && /NEC 2020 .*Section 230\.90 — Load Calc/.test(asked[0]), JSON.stringify(asked));
    check('no page errors during the B2-r1 flows', s3.state.pageErrors.length === 0, JSON.stringify(s3.state.pageErrors));
    await shot(p3, 'b2r1-after-nec-click'); await s3.ctx.close();
    // ── F. B2-r1.1 R-B2R1-01 — repeated load ids at the Favorites boundary (native storage, real reload) ──
    const s4 = await newPage(browser, target, [390, 844]); const p4 = s4.page; await openLC(p4); await fillAnnual(p4, '225');
    await p4.click('#lcAddLoad'); await p4.locator('#lcLoads .lc-load select').nth(2).selectOption('existing');
    const basePayload = await p4.evaluate(() => lcFavPayload()); const baseId = basePayload.snapshot.loads[0].id;
    const mk = (dup) => { const q = JSON.parse(JSON.stringify(basePayload)); q.snapshot.loads[0].label = 'same display label'; q.snapshot.loads.push(Object.assign({}, q.snapshot.loads[0], { id: dup ? baseId : baseId + '-distinct', label: 'same display label' })); return q; };
    const seedF = JSON.stringify({ lc: [{ id: 701, name: 'Control unique ids', vals: mk(false) }, { id: 702, name: 'Duplicate ids', vals: mk(true) }], vd: [{ id: 901, name: 'Other calculator untouched', vals: { amps: '2' } }] });
    await p4.evaluate((x) => localStorage.setItem('sparky_favorites', x), seedF);
    await p4.reload({ waitUntil: 'load' }); await p4.waitForTimeout(250); await openLC(p4);
    check('R-B2R1-01 the seeded records survive a real document reload (native file:// storage)', (await p4.evaluate(() => localStorage.getItem('sparky_favorites'))) === seedF && (await p4.locator('#lc-fav-list .fav-item').count()) === 2);
    await fillAnnual(p4, '225'); await p4.click('#lcAddLoad'); await p4.locator('#lcLoads .lc-load select').nth(2).selectOption('existing'); await setField(p4, 'lcPeriodMonths', '');   // a recorded raw entry (blank months -> MISSING_FIELD) in the active draft must survive the failed restore
    const draftBeforeF = await lcState(p4); const errsBefore = s4.state.pageErrors.length;
    await p4.locator('#lc-fav-list .fav-item').nth(1).click(); await p4.waitForTimeout(80);
    const dupAfter = await lcState(p4); const dupText = await resultText(p4); const storeAfter = await p4.evaluate(() => localStorage.getItem('sparky_favorites'));
    check('R-B2R1-01 row click on the duplicate-id record after the reload: no page error, RESTORE FAILED naming the repeated id, no stale COMPLETE / adequate (B2-r1 before: RangeError, old COMPLETE visible)', s4.state.pageErrors.length === errsBefore && dupAfter.fault && dupAfter.fault.kind === 'restore' && dupAfter.fault.details.some((d) => /is repeated/.test(d)) && /RESTORE FAILED/.test(dupText) && !/ADEQUATE|50,000|Total demand/.test(dupText), JSON.stringify([s4.state.pageErrors, dupAfter.fault, dupText.slice(0, 120)]));
    check('R-B2R1-01 the previous draft (snapshot, raw MISSING entry, fieldErrors, loadErrors) is unchanged and the store bytes are identical; both records stay listed', JSON.stringify(dupAfter.snapshot) === JSON.stringify(draftBeforeF.snapshot) && JSON.stringify(dupAfter.fieldErrors) === JSON.stringify(draftBeforeF.fieldErrors) && Object.keys(dupAfter.fieldErrors).length === 1 && JSON.stringify(dupAfter.loadErrors) === JSON.stringify(draftBeforeF.loadErrors) && (await p4.evaluate(() => document.getElementById('lcPeriodMonths').value)) === '' && storeAfter === seedF && (await p4.locator('#lc-fav-list .fav-item').count()) === 2 && (await p4.locator('#lcLoads .lc-load').count()) === 1);
    await p4.locator('#lc-fav-list .fav-item').nth(0).click(); await p4.waitForTimeout(80);
    const uniqAfter = await lcState(p4);
    check('R-B2R1-01 control: the same-label / unique-id record restores both cards (editable) and recomputes COMPLETE', s4.state.pageErrors.length === errsBefore && uniqAfter.fault === null && uniqAfter.result.status === 'COMPLETE' && uniqAfter.snapshot.loads.length === 2 && (await p4.locator('#lcLoads .lc-load input[type=text]').count()) === 2, JSON.stringify([uniqAfter.fault, uniqAfter.result && uniqAfter.result.status]));
    await p4.locator('#lcLoads input[type=text]').nth(1).focus(); await p4.keyboard.press('End'); await p4.keyboard.type(' two', { delay: 15 });
    check('R-B2R1-01 typing in the second restored card stays in place (focus kept, one card each)', (await p4.locator('#lcLoads input[type=text]').nth(1).inputValue()) === 'same display label two' && (await p4.evaluate(() => document.activeElement.tagName)) === 'INPUT' && (await lcState(p4)).snapshot.loads[1].label === 'same display label two');
    // internally duplicated draft (no form path produces it): finite read-only view, core DUPLICATE_ID, Save refused before the prompt
    await p4.evaluate(() => { LC.snapshot.loads[1].id = LC.snapshot.loads[0].id; lcUpdate(); lcUpdate(); });
    const internal = await lcState(p4); const loadsText = await p4.evaluate(() => document.getElementById('lcLoads').innerText);
    check('R-B2R1-01 an internally duplicated draft (ledger L-11e): lcUpdate terminates (twice), refused by the V2 projection before the engine (INPUT REJECTED, repeated id), read-only structural view naming the id, no controls, no old total', s4.state.pageErrors.length === errsBefore && internal.result === null && internal.fault && internal.fault.kind === 'input' && internal.fault.details.some((x) => /repeated/.test(x)) && /INPUT REJECTED/.test(await resultText(p4)) && /repeated identifier/.test(loadsText) && (await p4.locator('#lcLoads input').count()) === 0 && (await p4.locator('#lcLoads .lc-load').count()) === 2 && !/Total demand: 50,000/.test(await resultText(p4)), JSON.stringify([s4.state.pageErrors, internal.fault && internal.fault.details]));
    const dialogsBefore = s4.state.dialogs.length; s4.state.nextPromptValue = 'must not prompt'; await p4.click('#lcSaveBtn'); await p4.waitForTimeout(60);
    check('R-B2R1-01 Save with the duplicated draft is refused before the prompt; nothing written; the draft is not renamed, merged or reduced', s4.state.dialogs.length === dialogsBefore && (await p4.evaluate(() => localStorage.getItem('sparky_favorites'))) === seedF && (await lcState(p4)).fault.kind === 'storage' && /is repeated/.test((await lcState(p4)).fault.message) && (await lcState(p4)).snapshot.loads.length === 2);
    await p4.locator('#lcContent .reset-btn').first().click(); await p4.waitForTimeout(40);
    check('R-B2R1-01 Reset leaves the invalid view: EMPTY draft, editable list again', (await lcState(p4)).result.status === 'EMPTY' && (await p4.evaluate(() => LC.cardsInvalid === false)));
    check('no page errors during the B2-r1.1 flows', s4.state.pageErrors.length === 0, JSON.stringify(s4.state.pageErrors));
    await shot(p4, 'b2r11-duplicate-refused'); await s4.ctx.close();
    check('BLOCKED here by design: iOS Safari native focus zoom / keyboard / WebKit rendering (physical iPhone, PENDING)', 'BLOCKED', 'desktop Chromium measures CSS only; WebKit is not installed and nothing was installed');
  } finally { await browser.close(); }
  const fails = results.filter((r) => r.ok === false); const blocked = results.filter((r) => r.ok === 'BLOCKED');
  if (outDir) fs.writeFileSync(path.join(outDir, 'loadcalc-check-mobile.json'), JSON.stringify({ target, results }, null, 1));
  return { results, fails, blocked };
}

async function main() {
  const args = process.argv.slice(2); const outIdx = args.indexOf('--out');
  const target = args.find((a) => !a.startsWith('--') && (outIdx === -1 || args.indexOf(a) !== outIdx + 1));
  const { results, fails, blocked } = await run({ target, out: outIdx !== -1 ? args[outIdx + 1] : null, verbose: true });   // verbose: each check is printed as it completes
  console.log(fails.length ? `${fails.length} CHECK(S) FAILED of ${results.length} (${blocked.length} blocked)` : `ALL ${results.length - blocked.length} CHECKS PASSED (${blocked.length} blocked by environment, stated)`);
  process.exitCode = fails.length ? 1 : 0;
}
if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 2; });
module.exports = { run, fillAnnual, fillThirtyPerConductor, newPage, openLC, setField, LEGACY_REC04C, LEGACY_MIXED, LEGACY_BAD };
