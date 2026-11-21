#!/usr/bin/env node
'use strict';
/**
 * tools/loadcalc-service-ui-check-mobile.cjs — LC-SERVICE-UI-1 browser gate (SERVICE SIZING — DESIGN PREVIEW).
 *
 * Runs the ACTUAL mobile.html in an already-available Playwright Chromium at 320/375/390/430 px and on a desktop
 * viewport, with the real B0 records entered through the real controls. It checks:
 *   fields   every service design control computes >= 16px, keeps min-width:0, is not wider than the panel, has no
 *            opacity on the input itself, and the example placeholders keep the Load Calc italic grey style
 *   gate     before Calculate no rating/conductor is shown; after Calculate the blank controls and the Assess button
 *   states   minimum with the rating missing, 200 A general Cu candidate, 310.12 100 A Cu conditional table reference,
 *            a load edit hides every service number with the exact text, 120/208 current-only is an unavailable note
 *   layout   no horizontal offset of the document or the panel and no clipped visible element in the panel
 *
 * Storage is synthetic in a disposable browser context; no user profile, Favorites or private data is used; every
 * non-file request is aborted. No dependency is installed: if Playwright or its browser is missing this exits
 * BLOCKED (exit 3) with the reason. Chromium viewport emulation is NOT native Safari/iPhone; no device acceptance.
 *
 * Usage: node tools/loadcalc-service-ui-check-mobile.cjs [mobile.html] [--out DIR] [--verbose]
 */
const fs = require('fs');
const path = require('path');

const VIEWPORTS = [[320, 568, 'narrow 320'], [375, 812, 'iPhone 375'], [390, 844, 'iPhone 390'], [430, 932, 'iPhone 430'], [1280, 800, 'desktop 1280']];
const cardCtl = (i, role) => `#lcLoads .lc-load:nth-of-type(${i + 1}) [data-role="${role}"]`;
const SVC_FIELDS = ['lcSvcIntent', 'lcSvcOneMainDisconnect', 'lcSvcNoAdditionalSources', 'lcSvcWholeDwelling', 'lcSvcSingleConductorSet', 'lcSvcSelectedRating', 'lcSvcSizingPath', 'lcSvcMaterial', 'lcSvcTermTemp', 'lcSvcTermCompatible', 'lcSvcInsulTemp', 'lcSvcAmbient', 'lcSvcCcc', 'lcSvcWiringMethod', 'lcSvcNoOtherAdj'];
const PLAN = [['lcSvcIntent', 'new_design_candidate'], ['lcSvcOneMainDisconnect', 'yes'], ['lcSvcNoAdditionalSources', 'yes'], ['lcSvcWholeDwelling', 'yes'], ['lcSvcSingleConductorSet', 'yes']];
const COND = (p, m) => [['lcSvcSizingPath', p], ['lcSvcMaterial', m], ['lcSvcTermTemp', '75'], ['lcSvcTermCompatible', 'yes'], ['lcSvcInsulTemp', '75'], ['lcSvcAmbient', '30'], ['lcSvcCcc', '3'], ['lcSvcWiringMethod', 'single_insulated_conductors_in_raceway'], ['lcSvcNoOtherAdj', 'yes']];

async function setField(page, id, value) {
  const isSelect = await page.evaluate((i) => document.getElementById(i).tagName === 'SELECT', id);
  if (isSelect) await page.selectOption('#' + id, value); else await page.fill('#' + id, value);
  await page.waitForTimeout(15);
}
async function fill(page, pairs) { for (const [id, v] of pairs) await setField(page, id, v); }

/** the accepted B0 dwelling (23,680 VA) through the real controls; `topology` is applied after the model */
async function driveB0(page, topology) {
  for (const [id, val] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'opt_220_82'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_balanced_LN'], ['lcDeclBalancedLN', 'yes'], ['lcFloorArea', '1500'], ['lcSmallApplianceCircuits', '2'], ['lcLaundryCircuits', '1'], ['lcNycAcCircuits', '0'], ['lcArrangement', 'ac_only'], ['lcSingleSupplySet', 'yes'], ['lcConductorAmpacity', '200'], ['lcNycAcException', 'yes']]) await setField(page, id, val);
  for (const [preset, va] of [['0', '12000'], ['3', '4500'], ['1', '5000'], ['2', '1200'], ['4', '5000']]) { await page.selectOption('#lcPresetName', preset); await page.fill('#lcPresetVA', va); await page.click('#lcAddLoad'); await page.waitForTimeout(20); }
  await page.selectOption(cardCtl(2, 'inclusion'), 'not_on_counted_laundry_circuit');
  await page.selectOption(cardCtl(3, 'inclusion'), 'fixed_or_permanently_connected');
  await page.selectOption(cardCtl(4, 'coverage'), 'yes');
  await setField(page, 'lcInventoryComplete', 'yes');
  if (topology && topology !== '1ph_3w_120_240') await setField(page, 'lcTopology', topology);
}
const svcText = (page) => page.evaluate(() => ['lcSvcGate', 'lcSvcStatus', 'lcSvcResult'].map((i) => document.getElementById(i).innerText).join(' | '));

/** field metrics of every service control (computed styles of the real element) */
const FIELD_PROBE = (ids) => ids.map((id) => {
  const el = document.getElementById(id); const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const panel = document.getElementById('lcSvc').getBoundingClientRect();
  const ph = el.tagName === 'INPUT' ? getComputedStyle(el, '::placeholder') : null;
  return { id, font: parseFloat(cs.fontSize), minWidth: cs.minWidth, opacity: cs.opacity, width: Math.round(r.width), right: Math.round(r.right), panelRight: Math.round(panel.right), visible: r.width > 0 && r.height > 0,
    label: !!document.querySelector('label[for="' + id + '"]'), placeholder: el.getAttribute('placeholder'), phStyle: ph ? ph.fontStyle : null, phColor: ph ? ph.color : null };
});
const CLIP_PROBE = () => {
  const out = []; const scope = document.getElementById('lcSvc'); if (!scope) return out;
  for (const el of scope.querySelectorAll('.lc-banner-title, .lc-subtitle, .lc-line, .lc-total, .lc-note, .lc-svc-title, .lc-svc-cell, label, select, input, button')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const pr = p.getBoundingClientRect(); if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push({ el: el.className || el.id, text: (el.textContent || '').trim().slice(0, 40), elRight: Math.round(r.right), parent: p.className || p.id, parentRight: Math.round(pr.right) }); break; }
      p = p.parentElement;
    }
    if (r.right > window.innerWidth + 0.5 || r.left < -0.5) out.push({ el: el.className || el.id, outsideViewport: true, right: Math.round(r.right), W: window.innerWidth });
  }
  return out;
};

async function run(options) {
  const opts = options || {};
  const target = path.resolve(opts.target || path.join(__dirname, '..', 'mobile.html'));
  if (!fs.existsSync(target)) throw new Error('no such file: ' + target);
  const outDir = opts.out ? path.resolve(opts.out) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) { return { blocked: 'playwright is not available in this environment (nothing was installed): ' + e.message.split('\n')[0], results: [] }; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { return { blocked: 'no usable browser binary (nothing was installed): ' + e.message.split('\n')[0], results: [] }; }

  const results = [];
  const check = (name, ok, detail) => { const r = { name, ok: !!ok, detail }; results.push(r); if (opts.verbose) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${name}${r.ok ? '' : ' — ' + (detail || '')}`); };
  const engine = { browser: browser.browserType().name(), version: browser.version(), note: 'Chromium viewport emulation — NOT native Safari / iPhone; this gate never accepts a real device' };
  const newPage = async (vp) => {
    const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] } });
    const page = await ctx.newPage(); const state = { pageErrors: [] };
    page.on('pageerror', (e) => state.pageErrors.push(String(e)));
    await page.route('**', (route) => { if (route.request().url().startsWith('file://')) route.continue(); else route.abort(); });
    await page.goto('file://' + target, { waitUntil: 'load' }); await page.waitForTimeout(150);
    await page.evaluate(() => openTool('loadcalc')); await page.waitForTimeout(120);
    return { ctx, page, state };
  };
  const shot = async (page, name) => { if (outDir) await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false }); };
  const layoutOk = async (page) => {
    const layout = await page.evaluate(() => { const de = document.documentElement; const panel = document.querySelector('.panel.active'); panel.scrollLeft = 300; const l = panel.scrollLeft; panel.scrollLeft = 0; return { W: window.innerWidth, docSW: de.scrollWidth, panelSW: panel.scrollWidth, panelCW: panel.clientWidth, left: l }; });
    const clipped = await page.evaluate(CLIP_PROBE);
    return { ok: layout.docSW <= layout.W + 0.5 && layout.panelSW <= layout.panelCW + 0.5 && layout.left === 0 && clipped.length === 0, layout, clipped: clipped.slice(0, 4) };
  };

  try {
    for (const vp of VIEWPORTS) {
      const { ctx, page, state } = await newPage(vp);
      await driveB0(page);
      const before = await svcText(page);
      check(`${vp[2]}: before Calculate the panel shows no rating, current or conductor`, /Press Calculate first/.test(before) && !/Minimum standard-rating|Design-preview|Conditional table reference/.test(before), before.slice(0, 200));
      await page.click('#lcCalcBtn'); await page.waitForTimeout(60);
      const fields = await page.evaluate(FIELD_PROBE, SVC_FIELDS);
      const badFields = fields.filter((f) => !f.visible || f.font < 16 || f.minWidth !== '0px' || f.opacity !== '1' || f.right > f.panelRight + 0.5 || !f.label);
      check(`${vp[2]}: all 15 design controls are visible, labelled, >= 16px, min-width 0, not wider than the panel, no input opacity`, fields.length === 15 && badFields.length === 0, JSON.stringify(badFields.slice(0, 3)));
      const ph = fields.filter((f) => f.placeholder);
      check(`${vp[2]}: the e.g. placeholders keep the Load Calc italic grey placeholder style`, ph.length === 2 && ph.every((f) => /^e\.g\. /.test(f.placeholder) && f.phStyle === 'italic' && /133|0\.52|rgb\(133, 133, 133\)/.test(String(f.phColor))), JSON.stringify(ph));
      const blank = await page.evaluate((ids) => ids.every((i) => document.getElementById(i).value === ''), SVC_FIELDS);
      check(`${vp[2]}: every design control starts unanswered`, blank, '');
      await fill(page, PLAN); await page.click('#lcSvcAssessBtn'); await page.waitForTimeout(40);
      const minOnly = await svcText(page);
      check(`${vp[2]}: minimum 100 A shown while the chosen rating is still missing`, /Minimum standard-rating candidate: 100 A/.test(minOnly) && /Waiting for your choice/.test(minOnly) && !/Design-preview conductor candidate/.test(minOnly), minOnly.slice(0, 300));
      await setField(page, 'lcSvcSelectedRating', '200'); await fill(page, COND('general_table_75C', 'Cu')); await page.click('#lcSvcAssessBtn'); await page.waitForTimeout(40);
      const full = await svcText(page);
      check(`${vp[2]}: 200 A general Cu -> 3/0 AWG preview candidate, premise unchanged, not installation approval`, /Copper \(Cu\) 3\/0 AWG, 75 °C table ampacity 200 A/.test(full) && /Model premise unchanged — not installation approval/.test(full), full.slice(0, 300));
      const lay1 = await layoutOk(page);
      check(`${vp[2]}: no horizontal overflow or clipped element with the full result`, lay1.ok, JSON.stringify(lay1));
      await shot(page, `svc-full-${vp[0]}`);
      await setField(page, 'lcSvcSelectedRating', '100'); await setField(page, 'lcSvcSizingPath', 'dwelling_83pct_310_12'); await page.click('#lcSvcAssessBtn'); await page.waitForTimeout(40);
      const cond = await svcText(page);
      check(`${vp[2]}: 310.12 100 A Cu is a conditional table reference (4 AWG, 85 A), review required, never a selection`, /Conditional table reference — not a selection/.test(cond) && /4 AWG/.test(cond) && /85 A/.test(cond) && /Review required/.test(cond) && !/Design-preview conductor candidate/.test(cond), cond.slice(0, 300));
      await shot(page, `svc-conditional-${vp[0]}`);
      await setField(page, 'lcFloorArea', '1600');
      const stale = await svcText(page);
      check(`${vp[2]}: a load edit hides every service number with the exact text`, stale.includes('Load inputs changed — press Recalculate, then reassess service sizing.') && !/Minimum standard-rating|4 AWG|85 A|3\/0/.test(stale), stale.slice(0, 200));
      await setField(page, 'lcFloorArea', '1500');
      const reverted = await svcText(page);
      check(`${vp[2]}: reverting does not resurrect the service analysis`, !/Minimum standard-rating|4 AWG/.test(reverted), reverted.slice(0, 200));
      await setField(page, 'lcTopology', '1ph_3w_120_208_network'); await page.click('#lcCalcBtn'); await page.waitForTimeout(60);
      const cur = await page.evaluate(() => ({ svc: ['lcSvcGate', 'lcSvcResult'].map((i) => document.getElementById(i).innerText).join(' | '), res: document.getElementById('lcResult').innerText, ctr: getComputedStyle(document.getElementById('lcSvcControls')).display }));
      check(`${vp[2]}: 120/208 current-only — demand complete, service sizing unavailable, no guessed ampere value`, /Total demand: 23,680 VA/.test(cur.res) && /SERVICE SIZING UNAVAILABLE/.test(cur.svc) && !/\b\d+(\.\d+)? A\b/.test(cur.svc) && cur.ctr === 'none', JSON.stringify({ svc: cur.svc.slice(0, 200), ctr: cur.ctr }));
      const lay2 = await layoutOk(page);
      check(`${vp[2]}: no horizontal overflow or clipped element in the unavailable state`, lay2.ok, JSON.stringify(lay2));
      await shot(page, `svc-208-${vp[0]}`);
      check(`${vp[2]}: no page errors`, state.pageErrors.length === 0, JSON.stringify(state.pageErrors));
      await ctx.close();
    }
  } finally { await browser.close(); }

  const fails = results.filter((r) => !r.ok);
  if (outDir) fs.writeFileSync(path.join(outDir, 'loadcalc-service-ui-check.json'), JSON.stringify({ target, engine, results }, null, 1));
  return { target, engine, results, fails, blocked: null };
}

module.exports = { run, driveB0, VIEWPORTS };

if (require.main === module) {
  const args = process.argv.slice(2); const outIdx = args.indexOf('--out');
  const target = args.find((a) => !a.startsWith('--') && (outIdx === -1 || args.indexOf(a) !== outIdx + 1));
  run({ target, out: outIdx !== -1 ? args[outIdx + 1] : null, verbose: args.includes('--verbose') }).then((r) => {
    if (r.blocked) { console.log('loadcalc-service-ui-check: BLOCKED — ' + r.blocked); process.exit(3); }
    console.log(`loadcalc-service-ui-check: ${r.results.length} checks, ${r.fails.length} FAIL — ${r.engine.browser} ${r.engine.version} (${r.engine.note})`);
    for (const f of r.fails) console.log('  FAIL ' + f.name + ' — ' + (f.detail || ''));
    process.exit(r.fails.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(2); });
}
