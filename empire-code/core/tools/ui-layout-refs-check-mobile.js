#!/usr/bin/env node
'use strict';
/**
 * EC-UI-LAYOUT-REFS-1 — real-browser checks for the two bounded UI items.
 *
 *   A. LAYOUT — where the Load Calc panel's horizontal movement could come from.
 *      Measures, at 320/375/390/414 portrait, 844x390 landscape and 1280x800:
 *      document.scrollWidth vs innerWidth, #panel-more client/scroll width and
 *      scrollLeft, .content scrollLeft, every descendant's box against the
 *      panel's client box, visualViewport scale/offsets — in EMPTY, annual
 *      COMPLETE, complete+load+term+saved preset, INCOMPLETE, UNSUPPORTED and
 *      restore-fault states, before and after input focus / typing / dismiss,
 *      and after a programmatic pan attempt of the panel and of .content.
 *      Positive checks: nested table containers keep their own horizontal
 *      scroll (.tbl-wrap overflow-x: auto), editable text stays >= 16 px.
 *      This is desktop Chromium over file:// — it documents what Chromium
 *      renders. It is NOT iOS Safari: the native iPhone mechanism is a
 *      separate, explicitly reported limitation.
 *
 *   B. REFERENCES — one source-aware convention: base NEC 2020 target orange
 *      (.nec-link), NYCEC 2025 amendment target blue (.nycec-link), separate
 *      targets where both are presented, exact source/edition/section in the
 *      prepared question, exactly one send per activation (only sendMessage is
 *      stubbed — the real necLink route, panel switch and delegated handler
 *      run), header badges as keyboard/touch entry points, AI message
 *      formatting, GFCI note (necify), CODE grounding sections, NYC topic
 *      badges, outlet cards, Pull Box structured buttons, static pills,
 *      repeated rerenders, double activation, hostile and user-supplied text.
 *
 *   C. UI-r1 — compound citations keep every displayed section (genuine visible clicks on the
 *      CODE GFCI boiler / pool and grounding basics routes), explicit current-edition and
 *      mixed-source chat samples (two targets each, click-through questions), the Ampacity
 *      Max Breaker note as a target, and a visible-reference inventory across the reachable
 *      result/help renderers (0 unlinked app-authored citations expected).
 *
 * Exit 1 on any FAIL. Playwright/Chromium must already be installed.
 */
const path = require('path');
const fs = require('fs');

const results = []; let outDir = null;
function check(name, ok, detail) { results.push({ name, ok, detail: detail === undefined ? null : detail }); if (process.env.UI_HARNESS_QUIET !== '1') console.log(`  ${ok === true ? 'PASS ' : ok === 'BLOCKED' ? 'BLOCK' : 'FAIL '} ${name}${ok === true ? '' : detail !== undefined ? ' — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500) : ''}`); }

const ANNUAL = [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcReadingValue', '40000'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes'], ['lcNewLoadMode', 'none']];
const ORANGE = 'rgb(255, 107, 26)', BLUE = 'rgb(74, 158, 255)';

async function newPage(browser, target, size, extra) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: size[0], height: size[1] }, isMobile: size[0] < 900, hasTouch: size[0] < 900, deviceScaleFactor: 2 }, extra || {}));
  const page = await ctx.newPage(); const state = { pageErrors: [], dialogs: [], sends: [], nextPromptValue: 'preset' };
  page.on('pageerror', (e) => state.pageErrors.push(String(e && e.message || e)));
  page.on('dialog', async (d) => { state.dialogs.push(d.type()); if (d.type() === 'prompt') await d.accept(state.nextPromptValue); else await d.accept(); });
  await page.route('**/*', (r) => r.request().url().startsWith('file://') ? r.continue() : r.abort());
  await page.addInitScript(() => { window._db = null; });
  await page.goto('file://' + target, { waitUntil: 'load' }); await page.waitForTimeout(200);
  // transport-only stub: the real necLink route, panel switch and delegated handler run; only the network send is replaced
  await page.evaluate(() => { window.__sent = []; window.sendMessage = async function () { const v = document.getElementById('userInput').value; window.__sent.push(v); document.getElementById('userInput').value = ''; }; });
  return { ctx, page, state };
}
const openLC = async (page) => { await page.evaluate(() => { const m = document.getElementById('apiModal'); if (m) m.style.display = 'none'; openTool('loadcalc'); }); await page.waitForTimeout(80); };
async function setField(page, id, v) { const l = page.locator('#' + id); if ((await l.evaluate((e) => e.tagName)) === 'SELECT') await l.selectOption(v); else await l.fill(v); }
async function fillAnnual(page) { for (const [id, v] of ANNUAL) await setField(page, id, v); }
const sent = (page) => page.evaluate(() => window.__sent.slice());
const clearSent = (page) => page.evaluate(() => { window.__sent = []; });
const wait = (page, ms) => page.waitForTimeout(ms);

/** the layout measurement: what actually moves, and whether anything can move */
async function measure(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('panel-more'); const content = document.querySelector('.content'); const lc = document.getElementById('lcContent');
    const pr = panel.getBoundingClientRect(); const over = [];
    for (const el of panel.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width === 0 && b.height === 0) continue; if (b.right > pr.right + 0.5 || b.left < pr.left - 0.5) over.push({ tag: el.tagName, id: el.id || null, cls: String(el.className || '').slice(0, 40), left: Math.round(b.left), right: Math.round(b.right) }); }
    const vv = window.visualViewport;
    return { innerWidth: window.innerWidth, docScrollWidth: document.documentElement.scrollWidth, docScrollLeft: document.documentElement.scrollLeft + document.body.scrollLeft, panel: { clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth, scrollLeft: panel.scrollLeft, overflowX: getComputedStyle(panel).overflowX, overflowY: getComputedStyle(panel).overflowY }, content: { scrollLeft: content.scrollLeft, scrollWidth: content.scrollWidth, clientWidth: content.clientWidth, overflow: getComputedStyle(content).overflow }, lcContent: { scrollWidth: lc.scrollWidth, clientWidth: lc.clientWidth }, over: over.slice(0, 10), overCount: over.length, vv: vv ? { scale: vv.scale, offsetLeft: vv.offsetLeft, pageLeft: vv.pageLeft, width: vv.width } : null, active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null };
  });
}
const stable = (m) => m.docScrollWidth === m.innerWidth && m.docScrollLeft === 0 && m.panel.scrollWidth === m.panel.clientWidth && m.panel.scrollLeft === 0 && m.content.scrollLeft === 0 && m.lcContent.scrollWidth === m.lcContent.clientWidth && m.overCount === 0 && (!m.vv || (m.vv.scale === 1 && m.vv.offsetLeft === 0 && m.vv.pageLeft === 0));

async function run(opts) {
  const target = path.resolve(opts.target || path.join(__dirname, '..', 'mobile.html'));
  outDir = opts.out ? path.resolve(opts.out) : null; if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = require('playwright'); const browser = await chromium.launch();
  const measurements = [];
  try {
    // ── A. LAYOUT ─────────────────────────────────────────────────────────
    for (const [label, size] of [['iPhone SE 320x568', [320, 568]], ['iPhone 375x812', [375, 812]], ['iPhone 390x844', [390, 844]], ['iPhone 414x896', [414, 896]], ['landscape 844x390', [844, 390]], ['desktop 1280x800', [1280, 800]]]) {
      const s = await newPage(browser, target, size); const p = s.page; await openLC(p);
      const record = async (state, m) => { measurements.push({ viewport: label, state, m }); return m; };
      let m = await record('EMPTY', await measure(p)); check(`A ${label} EMPTY: no horizontal overflow anywhere (document, #panel-more, .content, #lcContent), scale 1`, stable(m), m);
      await fillAnnual(p); m = await record('ANNUAL COMPLETE', await measure(p)); check(`A ${label} annual COMPLETE: no horizontal overflow, scale 1`, stable(m), m);
      await p.click('#lcAddLoad'); await p.locator('#lcLoads .lc-load select').nth(2).selectOption('existing'); await setField(p, 'lcNewLoadMode', 'precalculated'); await setField(p, 'lcTermVA', '3456');
      s.state.nextPromptValue = 'LAYOUT ' + label; await p.click('#lcSaveBtn'); await wait(p, 60);
      m = await record('COMPLETE + load + term + saved preset row', await measure(p)); check(`A ${label} with load, precalculated term and a saved preset row: no horizontal overflow`, stable(m), m);
      await setField(p, 'lcPeriodMonths', ''); m = await record('INCOMPLETE', await measure(p)); check(`A ${label} INCOMPLETE (blank months): no horizontal overflow`, stable(m), m); await setField(p, 'lcPeriodMonths', '12');
      await setField(p, 'lcMethod', 'opt_220_82'); m = await record('UNSUPPORTED', await measure(p)); check(`A ${label} UNSUPPORTED method view: no horizontal overflow`, stable(m), m); await setField(p, 'lcMethod', 'measured_220_87');
      await p.evaluate(() => { localStorage.setItem('sparky_favorites', JSON.stringify({ lc: [{ id: 5, name: 'Broken legacy', vals: { method: 'optional', voltage: '240', scope: 'house', sqFt: '1', appliances: '{', hvac: '[]', ev: '[]' } }] })); favRender('lc'); });
      await p.locator('#lc-fav-list .fav-item').first().click(); await wait(p, 60);
      m = await record('RESTORE FAULT', await measure(p)); check(`A ${label} restore-fault view: no horizontal overflow`, stable(m) && (await p.evaluate(() => lcExportState().fault && lcExportState().fault.kind === 'restore')), m);
      // focus / typing / dismiss on the load label, the reading and a select
      await p.locator('#lcLoads input[type=text]').first().focus(); await p.keyboard.type('abc', { delay: 10 }); m = await record('label focused + typed', await measure(p)); check(`A ${label} label input focused and typed: still no horizontal overflow, input keeps focus`, stable(m) && m.active === 'INPUT', m);
      await p.locator('#lcReadingValue').focus(); await p.keyboard.type('1'); await p.keyboard.press('Backspace'); await p.evaluate(() => document.activeElement.blur()); m = await record('after dismiss', await measure(p)); check(`A ${label} after focus/blur (dismiss): still no horizontal overflow`, stable(m), m);
      // programmatic pan attempts must not stick (no scrollable width)
      const pan = await p.evaluate(() => { const panel = document.getElementById('panel-more'); const content = document.querySelector('.content'); panel.scrollLeft = 200; content.scrollLeft = 200; document.documentElement.scrollLeft = 200; return { panel: panel.scrollLeft, content: content.scrollLeft, doc: document.documentElement.scrollLeft }; });
      check(`A ${label} programmatic pan attempt of #panel-more / .content / document stays at 0 (nothing is horizontally scrollable)`, pan.panel === 0 && pan.content === 0 && pan.doc === 0, pan);
      // scroll to the bottom of the form (vertical scrolling preserved) — the panel is the vertical scroller
      const vert = await p.evaluate(() => { const panel = document.getElementById('panel-more'); panel.scrollTop = panel.scrollHeight; return { top: panel.scrollTop, canScroll: panel.scrollHeight > panel.clientHeight, overflowY: getComputedStyle(panel).overflowY }; });
      check(`A ${label} vertical scrolling of the panel is unchanged (overflow-y auto, scrolls to the bottom)`, vert.overflowY === 'auto' && (!vert.canScroll || vert.top > 0), vert);
      if (outDir && size[0] === 390) await p.screenshot({ path: path.join(outDir, 'layout-390-restore-fault.png'), fullPage: false });
      await s.ctx.close();
    }
    // positive checks on nested scrollers and editable text, once at 390
    {
      const s = await newPage(browser, target, [390, 844]); const p = s.page; await openLC(p); await fillAnnual(p);
      const nested = await p.evaluate(() => ({ tblWraps: [...document.querySelectorAll('.tbl-wrap')].length, allAuto: [...document.querySelectorAll('.tbl-wrap')].every((e) => getComputedStyle(e).overflowX === 'auto'), nav: getComputedStyle(document.querySelector('.bottom-nav')).overflowX, panelX: getComputedStyle(document.getElementById('panel-more')).overflowX, panelY: getComputedStyle(document.getElementById('panel-more')).overflowY, contentOverflow: getComputedStyle(document.querySelector('.content')).overflow, viewport: document.querySelector('meta[name="viewport"]').getAttribute('content') }));
      check('A nested wide-table containers keep their own horizontal scroll (.tbl-wrap overflow-x: auto); the bottom nav keeps overflow-x auto; no layout CSS was changed', nested.tblWraps > 0 && nested.allAuto && nested.nav === 'auto' && nested.panelY === 'auto', nested);
      check('A diagnosis record: #panel-more computes overflow-x auto (a latent horizontal scroller with no overflowing content here) and .content is overflow hidden (programmatically scrollable) — documented, not changed', nested.panelX === 'auto' && nested.contentOverflow === 'hidden', nested);
      check('A viewport meta unchanged', nested.viewport === 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no', nested.viewport);
      await p.click('#lcAddLoad');
      const fonts = await p.evaluate(() => [...document.querySelectorAll('#lcContent input:not([type=checkbox]), #lcContent select')].map((e) => parseFloat(getComputedStyle(e).fontSize)));
      check('A every editable Load Calc text/number/select field computes to >= 16 px (focus-zoom policy preserved; checkboxes are not text fields)', fonts.length > 0 && fonts.every((f) => f >= 16), fonts);
      await s.ctx.close();
    }
    if (outDir) fs.writeFileSync(path.join(outDir, 'layout-measurements.json'), JSON.stringify({ mode: 'desktop Chromium, native file:// origin, external requests blocked; NOT iOS Safari', measurements }, null, 1));

    // ── B. REFERENCES ─────────────────────────────────────────────────────
    const s = await newPage(browser, target, [390, 844]); const p = s.page; await openLC(p); await fillAnnual(p);
    const lcLinks = await p.evaluate(() => { const q = (sel) => [...document.querySelectorAll(sel)].map((e) => ({ text: e.textContent, color: getComputedStyle(e).color, deco: getComputedStyle(e).textDecorationLine, ref: e.getAttribute('data-ref'), src: e.getAttribute('data-src'), sec: e.getAttribute('data-sec'), role: e.getAttribute('role'), tab: e.getAttribute('tabindex'), onclick: e.getAttribute('onclick') })); return { nec: q('#lcContent .nec-link'), nyc: q('#lcContent .nycec-link') }; });
    check('B Load Calc: every .nec-link is orange (var(--nec)) and underlined with data-src nec; every .nycec-link is blue (var(--nycec)) and underlined with data-src nycec; role=button, tabindex=0, no inline handler', lcLinks.nec.length >= 8 && lcLinks.nyc.length >= 3 && lcLinks.nec.every((l) => l.color === ORANGE && l.deco.includes('underline') && l.src === 'nec' && l.role === 'button' && l.tab === '0' && l.onclick === null) && lcLinks.nyc.every((l) => l.color === BLUE && l.deco.includes('underline') && l.src === 'nycec' && l.role === 'button' && l.tab === '0' && l.onclick === null), { nec: lcLinks.nec.length, nyc: lcLinks.nyc.length, sample: lcLinks.nec[0], nycSample: lcLinks.nyc[0] });
    const mixed = await p.evaluate(() => { const row = [...document.querySelectorAll('#lcContent .lc-line-label')].find((e) => /Total for the/.test(e.textContent)); const a = row.querySelector('.nec-link'); const b = row.querySelector('.nycec-link'); return { text: row.textContent, a: a && { text: a.textContent, ref: a.getAttribute('data-ref'), color: getComputedStyle(a).color }, b: b && { text: b.textContent, ref: b.getAttribute('data-ref'), color: getComputedStyle(b).color }, nested: !!row.querySelector('.nec-link .nycec-link, .nycec-link .nec-link') }; });
    check('B mixed-source line "Total for the 220.87(2) comparison": two separate targets — orange 220.87(2) (NEC 2020) and blue NYC 2025 (NYCEC 2025 amendment) — with different data-ref, never nested', mixed.a && mixed.b && mixed.a.text === '220.87(2)' && mixed.b.text === 'NYC 2025' && mixed.a.color === ORANGE && mixed.b.color === BLUE && /^NEC 2020 220\.87\(2\)/.test(mixed.a.ref) && /^NYCEC 2025 amendment to NEC 220\.87\(2\)/.test(mixed.b.ref) && !mixed.nested, mixed);
    await clearSent(p); await p.evaluate(() => { const row = [...document.querySelectorAll('#lcContent .lc-line-label')].find((e) => /Total for the/.test(e.textContent)); row.querySelector('.nec-link').click(); }); await wait(p, 250);
    let q = await sent(p); check('B clicking the orange target: chat opens, exactly one send, the question names NEC 2020 Section 220.87(2) and the Load Calc context', q.length === 1 && /^Explain NEC 2020 \(National Electrical Code, 2020 edition, NFPA 70\) Section 220\.87\(2\) — Load Calc, existing service or feeder capacity \(220\.87\) in detail/.test(q[0]) && (await p.evaluate(() => document.getElementById('panel-chat').classList.contains('active') && !document.getElementById('panel-more').classList.contains('active'))), q);
    await openLC(p); await clearSent(p); await p.evaluate(() => { const row = [...document.querySelectorAll('#lcContent .lc-line-label')].find((e) => /Total for the/.test(e.textContent)); row.querySelector('.nycec-link').click(); }); await wait(p, 250);
    q = await sent(p); check('B clicking the blue target: exactly one send, the question asks for the NYCEC 2025 amendment to NEC Section 220.87(2) (never a generic NEC question)', q.length === 1 && /^Explain the NYCEC 2025 \(New York City Electrical Code, 2025 edition, which adopts NEC 2020 with local amendments\) amendment to NEC Section 220\.87\(2\) — Load Calc/.test(q[0]), q);
    await openLC(p); await clearSent(p); await p.evaluate(() => { const el = document.querySelector('#lcContent .nycec-link'); el.click(); el.click(); el.click(); }); await wait(p, 250);
    q = await sent(p); check('B a triple activation inside the send window results in exactly one send (pending guard)', q.length === 1, q);
    await openLC(p); await clearSent(p); await p.evaluate(() => { for (let i = 0; i < 20; i++) lcUpdate(); }); await p.evaluate(() => document.querySelector('#lcContent .nec-link[data-sec="230.90"]').click()); await wait(p, 250);
    q = await sent(p); check('B after 20 rerenders a freshly rendered link still sends exactly once (one delegated handler, no accumulated listeners)', q.length === 1 && /Section 230\.90/.test(q[0]) && (await p.evaluate(() => document.querySelectorAll('#lcContent .nec-link[data-sec="230.90"]').length)) >= 1, q);
    // header badges: separate entry points
    await openLC(p); await clearSent(p); await p.click('header .edition-nycec'); await wait(p, 250); q = await sent(p);
    check('B header NYCEC 2025 badge (click): chat opens with the NYCEC edition-level question, one send, no rule switch', q.length === 1 && /^Explain the NYCEC 2025 \(New York City Electrical Code, 2025 edition/.test(q[0]) && /Do not recompute anything/.test(q[0]) && (await p.evaluate(() => document.getElementById('panel-chat').classList.contains('active'))), q);
    await openLC(p); await clearSent(p); await p.click('header .edition-nec'); await wait(p, 250); q = await sent(p);
    check('B header NEC 2020 badge (click): the NEC edition-level question, one send, a different destination', q.length === 1 && /^Explain the NEC 2020 \(National Electrical Code, 2020 edition, NFPA 70\)/.test(q[0]), q);
    const profileAfter = await p.evaluate(() => { openTool('loadcalc'); return lcExportState().result && lcExportState().result.ruleBasis; });
    check('B header badge activation changes no calculation: the Load Calc result still carries ruleBasis NYCEC-2025 / NEC-2020', profileAfter && profileAfter.code === 'NYCEC-2025' && profileAfter.base === 'NEC-2020', profileAfter);
    await clearSent(p); await p.focus('header .edition-nycec'); await p.keyboard.press('Enter'); await wait(p, 250); q = await sent(p);
    check('B keyboard: Enter on the focused NYCEC badge activates it exactly once', q.length === 1 && /^Explain the NYCEC 2025/.test(q[0]), q);
    await openLC(p); await clearSent(p); await p.focus('header .edition-nec'); await p.keyboard.press('Space'); await wait(p, 250); q = await sent(p);
    check('B keyboard: Space on the focused NEC badge activates it exactly once', q.length === 1 && /^Explain the NEC 2020/.test(q[0]), q);
    await openLC(p); await p.evaluate(() => { document.activeElement && document.activeElement.blur(); }); let fv = null;
    for (let i = 0; i < 20 && !(fv && /edition/.test(fv.id)); i++) { await p.keyboard.press(i === 0 ? 'Tab' : 'Shift+Tab'); fv = await p.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { id: a.className, outline: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, textColor: cs.color }; }); }
    check('B keyboard focus (Tab) reaches a badge and shows the focus-visible outline in the badge\'s own source colour', /edition/.test(fv.id) && fv.outline === 'solid' && fv.width === '2px' && fv.color === fv.textColor && (fv.textColor === BLUE || fv.textColor === ORANGE), fv);
    await clearSent(p); await p.evaluate(() => document.querySelector('#lcContent .nec-link').focus()); await p.keyboard.press('Enter'); await wait(p, 250); q = await sent(p);
    check('B keyboard: Enter on a focused Load Calc reference sends once', q.length === 1 && /^Explain NEC 2020/.test(q[0]), q);
    // AI message formatting
    await openLC(p); await clearSent(p);
    const msg = await p.evaluate(() => { addMessage('assistant', 'Per NEC 210.8(A)(1) and NYCEC 210.19(A) — also <img src=x onerror="window.__x=1"> and NEC 3.1"onclick="window.__y=1'); const area = document.getElementById('chatArea'); const last = area.lastElementChild; return { nec: [...last.querySelectorAll('.nec-link')].map((e) => ({ text: e.textContent, color: getComputedStyle(e).color, sec: e.getAttribute('data-sec') })), nyc: [...last.querySelectorAll('.nycec-link')].map((e) => ({ text: e.textContent, color: getComputedStyle(e).color, sec: e.getAttribute('data-sec') })), img: last.querySelectorAll('img').length, handlers: [...last.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length, x: window.__x, y: window.__y, text: last.textContent }; });
    check('B AI message: NEC 210.8(A)(1) orange, NYCEC 210.19(A) blue, hostile markup stays text, no on* attribute, nothing executed', msg.nec.length === 2 && msg.nyc.length === 1 && msg.nec[0].color === ORANGE && msg.nyc[0].color === BLUE && msg.nyc[0].sec === '210.19(A)' && msg.img === 0 && msg.handlers === 0 && msg.x === undefined && msg.y === undefined && msg.text.includes('<img src=x onerror='), msg);
    await p.evaluate(() => { document.getElementById('chatArea').lastElementChild.querySelector('.nycec-link').click(); }); await wait(p, 250); q = await sent(p);
    check('B AI message NYCEC link: one send with the amendment question for Section 210.19(A)', q.length === 1 && /amendment to NEC Section 210\.19\(A\)/.test(q[0]), q);
    // necify path: GFCI note
    const gfci = await p.evaluate(() => { openTool('gfci'); if (typeof gfciSelectRoom === 'function') gfciSelectRoom('bathroom'); const view = document.getElementById('gfciDetailView'); const links = [...view.querySelectorAll('.nec-link, .nycec-link')].map((e) => ({ cls: e.className, text: e.textContent, color: getComputedStyle(e).color, onclick: e.getAttribute('onclick') })); return { count: links.length, nec: links.filter((l) => l.cls === 'nec-link' && l.color === 'rgb(255, 107, 26)').length, nyc: links.filter((l) => l.cls === 'nycec-link').length, badColor: links.filter((l) => !((l.cls === 'nec-link' && l.color === 'rgb(255, 107, 26)') || (l.cls === 'nycec-link' && l.color === 'rgb(74, 158, 255)'))).length, inline: links.filter((l) => l.onclick).length, sample: links[0] }; });
    check('B GFCI note (necify path): references render as source-coloured spans without inline handlers', gfci.count > 0 && gfci.badColor === 0 && gfci.inline === 0, gfci);
    // CODE panel: grounding sections, NYC topics, outlet cards
    const gnd = await p.evaluate(() => { openTool('coderef'); if (typeof codeSubTab === 'function') codeSubTab('grounding'); groundingSelectTopic('basics'); const host = document.getElementById('groundingDetailView') || document; const links = [...host.querySelectorAll('.nec-link, .nycec-link')].map((e) => ({ cls: e.className.split(' ')[0], text: e.textContent, color: getComputedStyle(e).color, src: e.getAttribute('data-src'), onclick: e.getAttribute('onclick') })); return { count: links.length, mismatch: links.filter((l) => (l.cls === 'nec-link' && (l.src !== 'nec' || l.color !== 'rgb(255, 107, 26)')) || (l.cls === 'nycec-link' && (l.src !== 'nycec' || l.color !== 'rgb(74, 158, 255)'))).length, inline: links.filter((l) => l.onclick).length, sample: links[0] }; });
    check('B CODE panel grounding sections: heading references are source-aware spans (colour follows data-src), no inline handlers', gnd.count > 0 && gnd.mismatch === 0 && gnd.inline === 0, gnd);
    const nyc = await p.evaluate(() => { if (typeof codeSubTab === 'function') codeSubTab('nyc'); nycSelectTopic('wiring'); const badges = [...document.querySelectorAll('#nycDetailView .nycec-link')].map((e) => ({ text: e.textContent, color: getComputedStyle(e).color, ref: e.getAttribute('data-ref'), src: e.getAttribute('data-src'), onclick: e.getAttribute('onclick') })); return { count: badges.length, allBlue: badges.every((b) => b.color === 'rgb(74, 158, 255)' && b.src === 'nycec' && /^NYCEC /.test(b.ref) && !b.onclick), sample: badges[0] }; });
    check('B NYC topic detail: section badges are blue NYCEC targets routed through the delegated handler', nyc.count > 0 && nyc.allBlue, nyc);
    await clearSent(p); await p.evaluate(() => document.querySelector('#nycDetailView .nycec-link').click()); await wait(p, 250); q = await sent(p);
    check('B NYC topic badge click: one send with a NYCEC 2025 amendment question naming the section', q.length === 1 && /^Explain the NYCEC 2025 .* amendment to NEC Section \d/.test(q[0]), q);
    const outlets = await p.evaluate(() => { let n = 0; try { openTool('outlets'); n = 1; } catch (e) { n = 0; } if (typeof renderOutlets === 'function') renderOutlets(); const links = [...document.querySelectorAll('.nec-link[data-sec], .nycec-link[data-sec]')].filter((e) => e.closest('#panel-outlets, #sub-outlets, #outletsGrid, [id*="outlet"]')).map((e) => ({ cls: e.className, color: getComputedStyle(e).color, onclick: e.getAttribute('onclick') })); return { count: links.length, ok: links.every((l) => (l.cls === 'nec-link' ? l.color === 'rgb(255, 107, 26)' : l.color === 'rgb(74, 158, 255)') && !l.onclick) }; });
    check('B outlet reference cards: source-aware spans, no inline handlers', outlets.count > 0 && outlets.ok, outlets);
    // Pull Box structured buttons
    const pb = await p.evaluate(() => { const host = document.createElement('div'); host.innerHTML = ecRenderCodeRef({ code: 'NEC', section: '314.28(A)(2)' }, 'ctx-a') + ecRenderCodeRef({ code: 'NYCEC', section: '110.2(B)' }, 'ctx-b'); document.body.appendChild(host); const b = [...host.querySelectorAll('.ec-coderef')].map((e) => ({ src: e.getAttribute('data-src'), color: getComputedStyle(e).color, border: getComputedStyle(e).borderTopColor, label: e.textContent })); host.remove(); return b; });
    check('B Pull Box structured code-reference buttons (real ecRenderCodeRef, rendered in a scratch container): NEC -> orange, NYCEC -> blue via data-src; the structured prompt/handoff is unchanged', pb.length === 2 && pb[0].src === 'nec' && pb[0].color === ORANGE && pb[0].border === ORANGE && pb[1].src === 'nycec' && pb[1].color === BLUE && pb[1].border === BLUE, pb);
    // static pills (legacy one-argument necLink callers): source derived from the text
    await clearSent(p); const pill = await p.evaluate(() => { const nyc = document.querySelector('.pill-nyc[onclick]'); const nec = document.querySelector('.pill-nec[onclick]'); nyc.click(); return { nycText: nyc.textContent, nycColor: getComputedStyle(nyc).color, necColor: getComputedStyle(nec).color }; }); await wait(p, 250); q = await sent(p);
    check('B a static NYCEC pill (legacy necLink caller) is blue and prepares a NYCEC 2025 amendment question; a static NEC pill is orange', q.length === 1 && /^Explain the NYCEC 2025/.test(q[0]) && pill.nycColor === BLUE && pill.necColor === ORANGE, { q, pill });
    // user-supplied text stays inert
    await openLC(p); await p.click('#lcAddLoad'); await p.locator('#lcLoads input[type=text]').first().fill('NEC 220.87 <b>x</b> NYCEC 210.19');
    const inert = await p.evaluate(() => { const card = document.querySelector('#lcLoads .lc-load'); return { links: card.querySelectorAll('.nec-link, .nycec-link').length, bold: card.querySelectorAll('b').length, value: card.querySelector('input[type=text]').value, label: lcExportState().snapshot.loads[0].label }; });
    check('B a user load label containing reference-like text is data: no link, no markup, value and snapshot verbatim', inert.links === 0 && inert.bold === 0 && inert.value === 'NEC 220.87 <b>x</b> NYCEC 210.19' && inert.label === inert.value, inert);
    const refCount = await p.evaluate(() => { const all = [...document.querySelectorAll('.nec-link, .nycec-link')]; const inline = all.filter((e) => e.getAttribute('onclick')); return { nec: document.querySelectorAll('.nec-link').length, nyc: document.querySelectorAll('.nycec-link').length, inline: inline.length, inlineStaticConsistent: inline.every((e) => /^necLink\('NEC [^']*'\)$/.test(e.getAttribute('onclick')) && e.classList.contains('nec-link') && getComputedStyle(e).color === 'rgb(255, 107, 26)'), inlineSample: inline.map((e) => e.getAttribute('onclick')).slice(0, 3) }; });
    check('B inventory snapshot: the only links with an inline handler are static app-authored NEC spans (Box Fill help markup): each is a constant necLink(\'NEC …\') call, orange, source-consistent; every JS-built link is a data-ref span', refCount.inlineStaticConsistent, refCount);
    // ── C. UI-r1 (R-UI-01/02): compound citations, explicit editions, Ampacity note, visible inventory ──
    const lcBeforeC = await p.evaluate(() => { openTool('loadcalc'); const st = lcExportState(); return { status: st.result.status, total: st.result.demand.totalVA, rule: st.result.ruleBasis }; });
    const ORANGE_HOVER = 'rgb(255, 138, 77)';   // .nec-link:hover — the same hue, brighter (a previous click leaves the pointer over the element)
    const captureVisible = async (selector, text) => { await p.mouse.move(1, 1); const loc = p.locator(selector).filter({ hasText: text }).first(); await loc.scrollIntoViewIfNeeded(); const vis = await loc.isVisible(); const before = await loc.evaluate((e) => ({ text: e.textContent, ref: e.getAttribute('data-ref'), sec: e.getAttribute('data-sec'), src: e.getAttribute('data-src'), color: getComputedStyle(e).color, title: e.title })); before.orange = before.color === ORANGE || before.color === ORANGE_HOVER; await clearSent(p); await loc.click(); await wait(p, 250); return { vis, before, questions: await sent(p) }; };
    for (const [room, text, a, z] of [['boiler', 'NEC 210.8(A)(5) / 210.8(A)(7)', '210.8(A)(5)', '210.8(A)(7)'], ['pool', 'NEC 680.22(A) / 680.74', '680.22(A)', '680.74']]) {
      await p.evaluate((r) => { openTool('coderef'); codeSubTab('gfci'); gfciSelectRoom(r); }, room); await wait(p, 120);
      const d = await captureVisible('#gfciDetailView .nec-link', text);
      check(`C compound citation (CODE → GFCI → ${room}): visible orange target "${text}", genuine click, one send, the question names BOTH sections (candidate before: only ${a})`, d.vis && d.before.orange && d.before.sec === null && d.before.title.includes(a) && d.before.title.includes(z) && d.questions.length === 1 && d.questions[0].includes(a) && d.questions[0].includes(z) && /^Explain NEC 2020 /.test(d.questions[0]), d);
    }
    await p.evaluate(() => { openTool('coderef'); codeSubTab('grounding'); groundingSelectTopic('basics'); }); await wait(p, 120);
    { const d = await captureVisible('#groundingDetailView .nec-link', 'NEC 250.4(A) and 250.4(B)'); check('C compound citation (CODE → grounding → basics): "NEC 250.4(A) and 250.4(B)" — genuine click, one send, both sections in the question', d.vis && d.before.sec === null && d.questions.length === 1 && d.questions[0].includes('250.4(A)') && d.questions[0].includes('250.4(B)'), d); }
    await p.evaluate(() => { openTool('coderef'); codeSubTab('grounding'); groundingSelectTopic('basics'); }); await wait(p, 120);   // the previous click opened AI Chat
    { const d = await captureVisible('#groundingDetailView .nec-link', 'NEC 250.4'); check('C the heading citation "Purpose — NEC 250.4" (necify on app data) is its own single-section target', d.vis && d.before.sec === '250.4' && d.questions.length === 1 && /Section 250\.4 in detail/.test(d.questions[0]), d); }
    await clearSent(p); await p.evaluate(() => { necLink('NYCEC 210.19(A) and 215.2(A)(1) — NYC voltage drop'); }); await wait(p, 250); q = await sent(p);
    check('C control: a plain legacy necLink call with two sections keeps both (unchanged)', q.length === 1 && q[0].includes('210.19(A)') && q[0].includes('215.2(A)(1)'), q);
    for (const [id, txt, expect] of [['simple (control)', 'NEC 210.8(A)(1) and NYCEC 220.14(N)', [['nec-link', '210.8(A)(1)'], ['nycec-link', '220.14(N)']]], ['explicit current editions', 'NEC 2020 220.87(2) and NYCEC 2025 220.87(2)', [['nec-link', '220.87(2)'], ['nycec-link', '220.87(2)']]], ['mixed amendment phrase', 'NEC 220.87(2) as amended by NYCEC 2025', [['nec-link', '220.87(2)'], ['nycec-link', '220.87(2)']]]]) {
      const d = await p.evaluate((t) => { addMessage('ai', t); const m = document.querySelector('#chatArea .msg:last-child'); return [...m.querySelectorAll('.nec-link, .nycec-link')].map((e) => ({ cls: e.className, text: e.textContent, src: e.getAttribute('data-src'), sec: e.getAttribute('data-sec'), color: getComputedStyle(e).color })); }, txt);
      const ok = d.length === expect.length && d.every((l, i) => l.cls === expect[i][0] && l.sec === expect[i][1] && l.color === (expect[i][0] === 'nec-link' ? ORANGE : BLUE));
      check(`C AI message "${txt}" (${id}): ${expect.length} separate source-coloured targets`, ok, d);
      if (ok) { await clearSent(p); await p.evaluate(() => { const m = document.querySelector('#chatArea .msg:last-child'); m.querySelectorAll('.nec-link, .nycec-link')[1].click(); }); await wait(p, 250); q = await sent(p);
        check(`C AI message "${txt}": clicking the second (blue) target sends once with the NYCEC 2025 question for Section ${expect[1][1]}`, q.length === 1 && /^Explain the NYCEC 2025 /.test(q[0]) && q[0].includes('Section ' + expect[1][1]), q); }
    }
    await p.evaluate(() => { openTool('ampacity'); ampUpdateCalc(); }); await wait(p, 450);
    { const d = await captureVisible('#ampResultGrid .nec-link', 'NEC 240.4(B)'); const value = await p.evaluate(() => { const grid = document.getElementById('ampResultGrid'); const item = [...grid.querySelectorAll('.result-item')].find((e) => /Max Breaker/.test(e.textContent)); return item ? item.querySelector('.result-item-value').textContent : null; });
      check('C Ampacity "Max Breaker (NEC 240.4(B))" note: visible orange target, genuine click, one send with the Section 240.4(B) question; the breaker value is still shown (rule untouched)', d.vis && d.before.orange && d.before.sec === '240.4(B)' && d.questions.length === 1 && /Section 240\.4\(B\)/.test(d.questions[0]) && value !== null && /\d/.test(value), { d, value }); }
    // visible-reference inventory across reachable renderers (app-authored citations only; user text is never linkified)
    const steps = [['ampacity', () => { openTool('ampacity'); ampUpdateCalc(); }], ['wiresizer', () => { openTool('wiresizer'); if (typeof wsCalc === 'function') wsCalc(); }], ['conduit', () => { openTool('conduit'); if (typeof cfCalc === 'function') cfCalc(); }], ['wireway', () => { openTool('wireway'); if (typeof wwCalc === 'function') wwCalc(); }], ['boxfill', () => { openTool('boxfill'); bfUpdateCalc(); }], ['motor', () => { openTool('motor'); mtCalc(); }], ['grounding-calc', () => { openTool('grounding'); if (typeof gndCalc === 'function') gndCalc(); }], ['code-gfci-pool', () => { openTool('coderef'); codeSubTab('gfci'); gfciSelectRoom('pool'); }], ['code-grounding-basics', () => { openTool('coderef'); codeSubTab('grounding'); groundingSelectTopic('basics'); }], ['code-nyc-wiring', () => { openTool('coderef'); codeSubTab('nyc'); nycSelectTopic('wiring'); }], ['outlets', () => { openTool('outlets'); if (typeof renderOutlets === 'function') renderOutlets(); }]];
    const inventory = {};
    for (const [name, fn] of steps) { try { await p.evaluate(fn); } catch (e) { inventory[name] = { error: String(e.message).slice(0, 100) }; continue; } await wait(p, 350); inventory[name] = await p.evaluate(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const un = []; let linked = 0; let n; while ((n = w.nextNode())) { const e = n.parentElement; if (!e || e.closest('option,select,script,style,textarea,input') || !e.getClientRects().length) continue; if (!/\b(?:NYCEC|NEC)\s+(?:20\d\d\s+)?(?:\d+\.\d+|Article\s+\d+|Table\s+\d)/.test(n.textContent)) continue; if (e.closest('a,button,[role=button],[onclick],[data-ref]')) linked++; else un.push(n.textContent.trim().slice(0, 80)); } return { linked, unlinked: un }; }); }
    const unlinkedTotal = Object.values(inventory).reduce((a, v) => a + (v.unlinked ? v.unlinked.length : 0), 0); const linkedTotal = Object.values(inventory).reduce((a, v) => a + (v.linked || 0), 0);
    check('C visible-reference inventory over 11 reachable renderers: every visible app-authored NEC/NYCEC citation is a target (candidate before: 15 unlinked)', unlinkedTotal === 0 && linkedTotal >= 30 && Object.values(inventory).every((v) => !v.error), inventory);
    if (outDir) fs.writeFileSync(path.join(outDir, 'visible-reference-inventory-after.json'), JSON.stringify(inventory, null, 1));
    // representative outputs unchanged after reference actions (engine untouched): ampacity + load calc
    const outputs = await p.evaluate(() => { openTool('ampacity'); ampUpdateCalc(); const grid = document.getElementById('ampResultGrid'); const rows = [...grid.querySelectorAll('.result-item')].map((e) => e.querySelector('.result-item-label').textContent.trim() + '=' + e.querySelector('.result-item-value').textContent.trim()); openTool('loadcalc'); const st = lcExportState(); return { amp: rows.slice(0, 4), lc: st.result && { status: st.result.status, total: st.result.demand.totalVA, rule: st.result.ruleBasis } }; });
    check('C representative outputs after all reference actions: Ampacity rows present, the Load Calc result (status/total) is identical to before section C and still carries ruleBasis NYCEC-2025 / NEC-2020 (no reference action touches a calculation)', outputs.amp.length >= 3 && outputs.lc && outputs.lc.status === lcBeforeC.status && outputs.lc.total === lcBeforeC.total && outputs.lc.rule.code === 'NYCEC-2025' && outputs.lc.rule.base === 'NEC-2020', { before: lcBeforeC, after: outputs });
    check('B no page errors during the reference flows', s.state.pageErrors.length === 0, s.state.pageErrors);
    if (outDir) { await openLC(p); await p.screenshot({ path: path.join(outDir, 'refs-390-loadcalc.png'), fullPage: false }); }
    await s.ctx.close();
    check('BLOCKED here by design: iOS Safari (WebKit) horizontal movement, native keyboard, Safari :focus-visible — physical iPhone follow-up, PENDING', 'BLOCKED', 'WebKit is not installed and nothing was installed; the native mechanism is not established by this harness');
  } finally { await browser.close(); }
  const fails = results.filter((r) => r.ok === false); const blocked = results.filter((r) => r.ok === 'BLOCKED');
  if (outDir) fs.writeFileSync(path.join(outDir, 'ui-layout-refs-check-mobile.json'), JSON.stringify({ target, results }, null, 1));
  return { results, fails, blocked };
}

async function main() {
  const args = process.argv.slice(2); const t = args.indexOf('--target'); const o = args.indexOf('--out');
  const { results, fails, blocked } = await run({ target: t !== -1 ? args[t + 1] : undefined, out: o !== -1 ? args[o + 1] : undefined });
  console.log(fails.length ? `${fails.length} of ${results.length} CHECKS FAILED` : `ALL ${results.length - blocked.length} CHECKS PASSED (${blocked.length} blocked by environment, stated)`);
  process.exit(fails.length ? 1 : 0);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
module.exports = { run };
