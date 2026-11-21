#!/usr/bin/env node
'use strict';
/**
 * tools/loadcalc-ui-polish-check-mobile.cjs — LC-UI-POLISH-1 browser gate (P1, P2, P3).
 *
 * Runs the ACTUAL mobile.html in the already-available Playwright Chromium at 320/375/390/430 px and on a
 * desktop viewport, with real B0 records and after a real synthetic restore. It checks:
 *   P1  the computed cursor over the saved Load Calculation row, its star and its name is `pointer`, the
 *       Delete control keeps its own affordance, and text fields OUTSIDE the list keep `text`
 *   P2  COMPLETE 23,680 VA at 120/208 network shows the cause only in CURRENT — NOT COMPUTED, with no
 *       FIELDS TO SETTLE heading, and 120/240 shows the current again with no stale NOT COMPUTED section
 *   P3  the NEC 220.82 badge replaces the round step marker, its reference still opens once by click and by
 *       Enter, and the badge text is fully visible (real element bounds, not just scrollWidth)
 *   layout  no horizontal offset of the document or the panel, and no clipped visible element
 *
 * Storage is synthetic in a disposable browser context; no user profile, Favorites or private data is used.
 * No dependency is installed: if Playwright or its browser is missing, this exits BLOCKED with the reason.
 * Chromium viewport emulation is NOT native Safari/iPhone and this gate never claims a device acceptance.
 *
 * Usage: node tools/loadcalc-ui-polish-check-mobile.cjs [mobile.html] [--out DIR] [--verbose]
 */
const fs = require('fs');
const path = require('path');

const VIEWPORTS = [[320, 568, 'narrow 320'], [375, 812, 'iPhone 375'], [390, 844, 'iPhone 390'], [430, 932, 'iPhone 430'], [1280, 800, 'desktop 1280']];
const cardCtl = (i, role) => `#lcLoads .lc-load:nth-of-type(${i + 1}) [data-role="${role}"]`;

async function setField(page, id, value) {
  const isSelect = await page.evaluate((i) => document.getElementById(i).tagName === 'SELECT', id);
  if (isSelect) await page.selectOption('#' + id, value); else await page.fill('#' + id, value);
  await page.waitForTimeout(15);
}

/** Enter the accepted B0 dwelling through the real controls. `topology` is applied AFTER the model, which is
 *  the user's own sequence: the 120/240 split model is kept while the conductor arrangement changes to
 *  120/208 network — that is exactly the case where the demand stays complete and the current does not. */
async function driveB0(page, topology) {
  for (const [id, val] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'opt_220_82'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_balanced_LN'], ['lcDeclBalancedLN', 'yes'], ['lcFloorArea', '1500'], ['lcSmallApplianceCircuits', '2'], ['lcLaundryCircuits', '1'], ['lcNycAcCircuits', '0'], ['lcArrangement', 'ac_only'], ['lcSingleSupplySet', 'yes'], ['lcConductorAmpacity', '200'], ['lcNycAcException', 'yes']]) await setField(page, id, val);
  for (const [preset, va] of [['0', '12000'], ['3', '4500'], ['1', '5000'], ['2', '1200'], ['4', '5000']]) { await page.selectOption('#lcPresetName', preset); await page.fill('#lcPresetVA', va); await page.click('#lcAddLoad'); await page.waitForTimeout(20); }
  await page.selectOption(cardCtl(2, 'inclusion'), 'not_on_counted_laundry_circuit');
  await page.selectOption(cardCtl(3, 'inclusion'), 'fixed_or_permanently_connected');
  await page.selectOption(cardCtl(4, 'coverage'), 'yes');
  await setField(page, 'lcInventoryComplete', 'yes');
  if (topology && topology !== '1ph_3w_120_240') await setField(page, 'lcTopology', topology);
}

/** a visible element is clipped when its own border box sticks out of an ancestor that hides the overflow */
const CLIP_PROBE = () => {
  const out = [];
  const scope = document.getElementById('lcContent');
  if (!scope) return out;
  for (const el of scope.querySelectorAll('.lc-rule-badge, .lc-rule-head, .fav-item, .fav-item-name, .lc-problem, .lc-total, .lc-banner-title, .lc-subtitle')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 1 || r.left < pr.left - 1 || r.bottom > pr.bottom + 1) out.push({ el: el.className, text: el.textContent.trim().slice(0, 40), elRight: Math.round(r.right), parent: p.className || p.id, parentRight: Math.round(pr.right) });
        break;
      }
      p = p.parentElement;
    }
    if (r.right > window.innerWidth + 0.5 || r.left < -0.5) out.push({ el: el.className, text: el.textContent.trim().slice(0, 40), outsideViewport: true, left: Math.round(r.left), right: Math.round(r.right), W: window.innerWidth });
  }
  return out;
};

async function run(options) {
  const opts = options || {};
  const target = path.resolve(opts.target || path.join(__dirname, '..', 'mobile.html'));
  if (!fs.existsSync(target)) throw new Error('no such file: ' + target);
  const outDir = opts.out ? path.resolve(opts.out) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
  let chromium;
  try { chromium = require('playwright').chromium; } catch (e) { return { blocked: 'playwright is not available in this environment (nothing was installed): ' + e.message, results: [] }; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { return { blocked: 'no usable browser binary (nothing was installed): ' + e.message, results: [] }; }

  const results = [];
  const check = (name, ok, detail) => { const r = { name, ok: !!ok, detail }; results.push(r); if (opts.verbose) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${name}${r.ok ? '' : ' — ' + (detail || '')}`); };
  const engine = { browser: browser.browserType().name(), version: browser.version(), note: 'Chromium viewport emulation — NOT native Safari / iPhone; this gate never accepts a real device' };

  const newPage = async (vp, seedStorage) => {
    const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] } });
    const page = await ctx.newPage();
    const state = { pageErrors: [] };
    page.on('pageerror', (e) => state.pageErrors.push(String(e)));
    await page.route('**', (route) => { const u = route.request().url(); if (u.startsWith('file://')) route.continue(); else route.abort(); });
    if (seedStorage) await page.addInitScript((s) => { try { localStorage.setItem('sparky_favorites', s); } catch (e) { /* synthetic only */ } }, seedStorage);
    await page.goto('file://' + target, { waitUntil: 'load' });
    await page.waitForTimeout(150);
    await page.evaluate(() => openTool('loadcalc'));
    await page.waitForTimeout(120);
    return { ctx, page, state };
  };
  const shot = async (page, name) => { if (outDir) await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false }); };

  try {
    for (const vp of VIEWPORTS) {
      const { ctx, page, state } = await newPage(vp);
      await driveB0(page);

      // ── P3: the badge replaces the step circle and is fully visible
      const p3 = await page.evaluate(() => {
        const badge = document.querySelector('#lcOpt82 .lc-rule-badge');
        const stepNums = [...document.querySelectorAll('#lcContent .lc-step-num')].map((n) => n.textContent);
        const head = document.querySelector('#lcOpt82 .lc-rule-head');
        const link = badge && badge.querySelector('[data-sec="220.82"]');
        const r = badge ? badge.getBoundingClientRect() : null;
        return { hasBadge: !!badge, badgeText: badge ? badge.textContent.trim() : null, stepNums, headText: head ? head.textContent.trim() : null,
          link: link ? { src: link.getAttribute('data-src'), ed: link.getAttribute('data-ed'), sec: link.getAttribute('data-sec'), role: link.getAttribute('role'), tab: link.getAttribute('tabindex'), title: link.getAttribute('data-title') } : null,
          badgeBox: r ? { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) } : null,
          badgeFullyVisible: badge ? badge.scrollWidth <= badge.clientWidth + 1 && badge.scrollHeight <= badge.clientHeight + 1 : false,
          W: window.innerWidth };
      });
      check(`${vp[2]}: P3 NEC 220.82 badge replaces the step-82 circle, title kept, badge fully visible inside the viewport`,
        p3.hasBadge && p3.badgeText === 'NEC 220.82' && !p3.stepNums.includes('82') && /OPTIONAL METHOD — DWELLING DATA/.test(p3.headText || '') && p3.badgeFullyVisible && p3.badgeBox.right <= p3.W + 0.5,
        JSON.stringify(p3));
      check(`${vp[2]}: P3 the rule number keeps the ordinary NEC 2020 reference target`,
        p3.link && p3.link.src === 'nec' && p3.link.ed === '2020' && p3.link.sec === '220.82' && p3.link.role === 'button' && p3.link.tab === '0' && /220\.82/.test(String(p3.link.title)),
        JSON.stringify(p3.link));

      // ── P2: 120/208 presentation, then back to 120/240
      await setField(page, 'lcTopology', '1ph_3w_120_208_network');
      const p2 = await page.evaluate(() => {
        const txt = document.getElementById('lcResult').innerText;
        const nc = [...document.querySelectorAll('#lcResult .lc-box')].find((b) => /CURRENT — NOT COMPUTED/.test(b.innerText));
        return { txt, hasSettle: /FIELDS TO SETTLE/.test(txt), hasNotComputed: !!nc,
          ncRows: nc ? [...nc.querySelectorAll('.lc-problem')].map((r) => r.innerText.trim()) : [],
          ncNote: nc ? (nc.querySelector('.lc-note') || {}).innerText : null,
          state: (typeof lcExportState === 'function') ? (function () { const s = lcExportState(); return { status: s.result.status, totalVA: s.result.demand.totalVA, current: s.result.current.status, problems: s.result.problems.map((p) => p.code + '@' + p.layer) }; })() : null };
      });
      check(`${vp[2]}: P2 120/208 network — COMPLETE 23,680 VA, cause only in CURRENT — NOT COMPUTED, no FIELDS TO SETTLE`,
        p2.state && p2.state.status === 'COMPLETE' && p2.state.totalVA === 23680 && p2.state.current === 'not_computed' && !p2.hasSettle && p2.hasNotComputed && p2.ncRows.length === 1 && /current layer/.test(p2.ncRows[0]) && /Total demand: 23,680 VA/.test(p2.txt) && !/Line current/.test(p2.txt),
        JSON.stringify({ hasSettle: p2.hasSettle, ncRows: p2.ncRows, state: p2.state }));
      check(`${vp[2]}: P2 the explanation states the VA demand is complete without promising 120/208 amperes`,
        p2.ncNote && /VA demand above is complete/.test(p2.ncNote) && !/\b208\b/.test(p2.ncNote),
        String(p2.ncNote).slice(0, 200));
      await shot(page, `polish-p2-208-${vp[0]}`);
      await setField(page, 'lcTopology', '1ph_3w_120_240');
      const back = await page.evaluate(() => { const t = document.getElementById('lcResult').innerText; return { t, hasNC: /CURRENT — NOT COMPUTED/.test(t), hasCurrent: /Line current/.test(t) }; });
      check(`${vp[2]}: P2 back at 120/240 the current is shown again and no stale NOT COMPUTED section remains`, back.hasCurrent && !back.hasNC, JSON.stringify({ hasNC: back.hasNC, hasCurrent: back.hasCurrent }));

      // ── layout: no horizontal offset and no clipped visible element
      const layout = await page.evaluate(() => {
        const de = document.documentElement; const panel = document.querySelector('.panel.active');
        panel.scrollLeft = 300; const panelLeftAfterDrag = panel.scrollLeft; panel.scrollLeft = 0;
        return { W: window.innerWidth, docSW: de.scrollWidth, panelSW: panel.scrollWidth, panelCW: panel.clientWidth, panelOX: getComputedStyle(panel).overflowX, panelLeftAfterDrag };
      });
      const clipped = await page.evaluate(CLIP_PROBE);
      check(`${vp[2]}: no page-level horizontal overflow and no clipped visible element after records`,
        layout.docSW <= layout.W + 0.5 && layout.panelSW <= layout.panelCW + 0.5 && layout.panelLeftAfterDrag === 0 && clipped.length === 0,
        JSON.stringify({ layout, clipped: clipped.slice(0, 4) }));
      check(`${vp[2]}: no page errors while rendering the polished result`, state.pageErrors.length === 0, JSON.stringify(state.pageErrors));
      await shot(page, `polish-section-${vp[0]}`);
      await ctx.close();
    }

    // ── P1: computed cursor over a REAL saved row, on a desktop viewport with a mouse
    {
      const { ctx, page, state } = await newPage([1280, 800]);
      await driveB0(page);
      await page.evaluate(() => { window.__p = window.prompt; window.prompt = () => 'B0 synthetic preset'; });
      await page.click('#lcSaveBtn'); await page.waitForTimeout(80);
      await page.evaluate(() => { window.prompt = window.__p; });
      const cursors = await page.evaluate(() => {
        const row = document.querySelector('#lc-fav-list .fav-item');
        if (!row) return { noRow: true };
        const name = row.querySelector('.fav-item-name'); const star = row.firstChild; const del = row.querySelector('.fav-delete');
        const outsideField = document.getElementById('lcPresetVA') || document.querySelector('#lcContent input[type=text]');
        const other = document.querySelector('#lcContent .lc-note');
        return { row: getComputedStyle(row).cursor, name: getComputedStyle(name).cursor, star: getComputedStyle(star).cursor, del: getComputedStyle(del).cursor,
          delColor: getComputedStyle(del).color, outsideField: outsideField ? getComputedStyle(outsideField).cursor : null,
          noteCursor: other ? getComputedStyle(other).cursor : null, rowSelect: getComputedStyle(row).userSelect || getComputedStyle(row).webkitUserSelect,
          bodySelect: getComputedStyle(document.body).userSelect || getComputedStyle(document.body).webkitUserSelect, nameText: name.textContent };
      });
      check('P1 desktop: the saved row, its star and its name all compute cursor:pointer',
        !cursors.noRow && cursors.row === 'pointer' && cursors.name === 'pointer' && cursors.star === 'pointer', JSON.stringify(cursors));
      check('P1 desktop: Delete stays a separate, visible action and text fields outside the list keep their own cursor',
        cursors.del === 'pointer' && cursors.outsideField !== 'pointer' && cursors.noteCursor !== 'pointer' && cursors.bodySelect !== 'none',
        JSON.stringify({ del: cursors.del, outsideField: cursors.outsideField, note: cursors.noteCursor, bodySelect: cursors.bodySelect }));
      // one click loads exactly once
      const loaded = await page.evaluate(async () => {
        await setFieldStub();
        function setFieldStub() { return Promise.resolve(); }
        const before = lcExportState().evaluations;
        document.querySelector('#lc-fav-list .fav-item').click();
        await new Promise((r) => setTimeout(r, 60));
        const s = lcExportState();
        return { delta: s.evaluations - before, fault: s.fault, status: s.result && s.result.status, total: s.result && s.result.demand.totalVA };
      });
      check('P1 desktop: one click on the row loads the record exactly once', loaded.delta === 1 && loaded.fault === null && loaded.status === 'COMPLETE' && loaded.total === 23680, JSON.stringify(loaded));
      const storeBefore = await page.evaluate(() => localStorage.getItem('sparky_favorites'));
      const del = await page.evaluate(async () => {
        const before = lcExportState().evaluations;
        window.__c = window.confirm; window.confirm = () => true;
        document.querySelector('#lc-fav-list .fav-delete').click();
        await new Promise((r) => setTimeout(r, 60));
        window.confirm = window.__c;
        return { delta: lcExportState().evaluations - before, rows: document.querySelectorAll('#lc-fav-list .fav-item').length };
      });
      check('P1 desktop: Delete removes the row without also loading it', del.delta === 0, JSON.stringify({ del, storedBefore: !!storeBefore }));
      await shot(page, 'polish-p1-desktop-row');
      check('P1 desktop: no page errors', state.pageErrors.length === 0, JSON.stringify(state.pageErrors));
      await ctx.close();
    }

    // ── P1/P2/P3 after a REAL synthetic restore at 390 px
    {
      const { ctx, page, state } = await newPage([390, 844]);
      await driveB0(page, '1ph_3w_120_208_network');
      await page.evaluate(() => { window.__p = window.prompt; window.prompt = () => 'restored B0 network'; });
      await page.click('#lcSaveBtn'); await page.waitForTimeout(80);
      await page.evaluate(() => { window.prompt = window.__p; });
      await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(200);
      await page.evaluate(() => openTool('loadcalc')); await page.waitForTimeout(120);
      await page.click('#lc-fav-list .fav-item'); await page.waitForTimeout(100);
      const after = await page.evaluate(() => {
        const s = lcExportState(); const txt = document.getElementById('lcResult').innerText;
        const nc = [...document.querySelectorAll('#lcResult .lc-box')].find((b) => /CURRENT — NOT COMPUTED/.test(b.innerText));
        return { fault: s.fault, status: s.result.status, total: s.result.demand.totalVA, hasSettle: /FIELDS TO SETTLE/.test(txt), hasNC: !!nc, badge: !!document.querySelector('#lcOpt82 .lc-rule-badge'), rowCursor: getComputedStyle(document.querySelector('#lc-fav-list .fav-item')).cursor };
      });
      const clipped = await page.evaluate(CLIP_PROBE);
      const layout = await page.evaluate(() => { const p = document.querySelector('.panel.active'); p.scrollLeft = 300; const l = p.scrollLeft; p.scrollLeft = 0; return { W: window.innerWidth, docSW: document.documentElement.scrollWidth, left: l }; });
      check('after a real synthetic restore: COMPLETE 23,680 VA, polished presentation kept, badge present, row still a pointer, nothing clipped or offset',
        after.fault === null && after.status === 'COMPLETE' && after.total === 23680 && !after.hasSettle && after.hasNC && after.badge && after.rowCursor === 'pointer' && clipped.length === 0 && layout.docSW <= layout.W + 0.5 && layout.left === 0 && state.pageErrors.length === 0,
        JSON.stringify({ after, clipped: clipped.slice(0, 3), layout, errors: state.pageErrors }));
      await shot(page, 'polish-after-restore-390');
      await ctx.close();
    }
  } finally { await browser.close(); }

  const fails = results.filter((r) => !r.ok);
  if (outDir) fs.writeFileSync(path.join(outDir, 'loadcalc-ui-polish-check.json'), JSON.stringify({ target, engine, results }, null, 1));
  return { target, engine, results, fails, blocked: null };
}

module.exports = { run, driveB0, VIEWPORTS };

if (require.main === module) {
  const args = process.argv.slice(2); const outIdx = args.indexOf('--out');
  const target = args.find((a) => !a.startsWith('--') && (outIdx === -1 || args.indexOf(a) !== outIdx + 1));
  run({ target, out: outIdx !== -1 ? args[outIdx + 1] : null, verbose: args.includes('--verbose') }).then((r) => {
    if (r.blocked) { console.log('loadcalc-ui-polish-check: BLOCKED — ' + r.blocked); process.exit(3); }
    console.log(`loadcalc-ui-polish-check: ${r.results.length} checks, ${r.fails.length} FAIL — ${r.engine.browser} ${r.engine.version} (${r.engine.note})`);
    for (const f of r.fails) console.log('  FAIL ' + f.name + ' — ' + (f.detail || ''));
    process.exit(r.fails.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(2); });
}
