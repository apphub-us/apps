'use strict';
/**
 * EC-UI-FOCUS-1 — real-browser field-policy check for mobile.html.
 *
 *   NODE_PATH=<global node_modules> node tools/ui-focus-check-mobile.js [path/to/mobile.html]
 *
 * Policy: every LIVE editable field (select, numeric/text/password entry, the
 * AI Chat composer) computes to >= 16 CSS px at normal scale, unfocused, focused
 * and blurred, at 375 / 390 / 414 px portrait, 844x390 phone landscape and
 * 1280 px desktop — so iOS Safari has no reason to zoom into a focused control.
 * The harness drives the ACTUAL shipped application: real navigation
 * (switchTab / openTool / switchTabMore / codeSubTab), the real chat handlers
 * (autoResize, handleKey — Shift+Enter only, never a send with a key), the real
 * API-key route (sendMessage without a stored key opens the modal and returns
 * before any transport; only dummy text is typed, nothing is saved), and a
 * mutant self-test that proves the measurement actually detects a too-small
 * field. External network is blocked before the page loads; storage is fresh.
 *
 * What this cannot prove: iOS Safari's native focus zoom, keyboard open/dismiss
 * and residual pan. Those remain a physical-iPhone check. Desktop Chromium here
 * measures the CSS the phone will receive, nothing more. Every check is
 * null-tolerant so the same file records FAILs against the pre-task app.
 * Node tool only — not referenced by the app.
 */
const path = require('path');
const fs = require('fs');
const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mobile.html'));
if (!fs.existsSync(target)) { console.error('no such file: ' + target); process.exit(2); }

const VIEWPORTS = [[375, 812, 'iPhone 375 portrait'], [390, 844, 'iPhone 390 portrait'], [414, 896, 'iPhone 414 portrait'], [844, 390, 'iPhone 390 landscape'], [1280, 800, 'desktop 1280']];
// every route that reveals editable controls in the main app (inventory-driven; see docs/ui-focus-policy.md)
const ROUTES = ['home', 'chat', 'vdrop', 'wiresizer', 'ampacity', 'loadcalc', 'conduit', 'wireway', 'boxfill', 'pullbox', 'motor', 'grounding', 'outlets', 'bender', 'converter', 'more/coderef/gfci', 'more/coderef/grounding'];
// non-field typography that must NOT move with the field policy (desktop literals from the pre-task app)
const NON_FIELD = { '#panel-vdrop .ctrl-lbl': 9, '#panel-vdrop .pill': 11, '#panel-vdrop .rule-txt': 11, '#panel-vdrop .result-title': 11, '#panel-boxfill .tbl-title': 12, '.cf-table td, .cf-table th': 10, '.send-btn': 20, '.reset-btn': 12, 'body': 16, '.code-subtab': 11 };

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const results = []; const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const goRoute = async (page, name) => {
    await page.evaluate((n) => {
      const parts = n.split('/');
      if (n === 'home') switchTab('home', null); else if (n === 'chat') switchTab('chat', null); else if (n === 'vdrop') switchTab('vdrop', null);
      else if (parts[0] === 'more') { switchTab('more', null); switchTabMore(parts[1]); if (parts[2] && typeof codeSubTab === 'function') codeSubTab(parts[2]); }
      else openTool(n);
    }, name);
    await page.waitForTimeout(90);
  };
  const fields = (page) => page.evaluate(() => [...document.querySelectorAll('select, input, textarea')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && !e.disabled && !e.readOnly && !['button', 'submit', 'checkbox', 'radio', 'range', 'file', 'hidden'].includes(e.type)).map((e) => ({ id: e.id || (e.tagName.toLowerCase() + '@' + (e.closest('[id]') || {}).id), fontPx: parseFloat(getComputedStyle(e).fontSize), right: Math.round(e.getBoundingClientRect().right), clipped: e.tagName === 'INPUT' && e.scrollWidth > e.clientWidth + 1 })));
  const pageGeometry = (page) => page.evaluate(() => { const W = window.innerWidth; const act = document.querySelector('.panel.active'); return { W, docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, active: act && act.id, panelScrollW: act ? act.scrollWidth : null, panelClientW: act ? act.clientWidth : null, tables: [...document.querySelectorAll('.panel.active .tbl-wrap')].map((t) => ({ overflowX: getComputedStyle(t).overflowX, inside: t.getBoundingClientRect().right <= W + 0.5 })) }; });

  for (const [w, h, vpName] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
    let blocked = 0;
    await page.route('**/*', (route) => { if (route.request().url().startsWith('file://')) return route.continue(); blocked++; return route.abort(); });
    await page.addInitScript(() => { window._db = null; try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* fresh storage */ } });
    await page.goto('file://' + target, { waitUntil: 'load' }); await page.waitForTimeout(250);

    // ── 1. inventory-driven: every live field on every route, unfocused / focused / blurred ─────
    let minAll = 99; const small = []; const overflow = []; const clipped = []; let counted = 0; const badGeo = [];
    for (const route of ROUTES) {
      await goRoute(page, route);
      const list = await fields(page); counted += list.length;
      for (const f of list) { if (f.fontPx < 16) small.push(route + ':' + f.id + '=' + f.fontPx); minAll = Math.min(minAll, f.fontPx); if (f.right > w + 0.5) overflow.push(route + ':' + f.id + '@' + f.right); if (f.clipped) clipped.push(route + ':' + f.id); }
      // focus / blur every live field on this route with the real element (no synthetic style)
      const fb = await page.evaluate(() => { const out = []; for (const e of [...document.querySelectorAll('select, input, textarea')].filter((e) => e.offsetParent !== null && !e.disabled && !['button', 'submit', 'checkbox', 'radio', 'range', 'file', 'hidden'].includes(e.type))) { e.focus(); const f = parseFloat(getComputedStyle(e).fontSize); e.blur(); const b = parseFloat(getComputedStyle(e).fontSize); if (f < 16 || b < 16) out.push((e.id || e.tagName) + ':' + f + '/' + b); } return out; });
      for (const s of fb) small.push(route + ':focus/blur ' + s);
      const g = await pageGeometry(page);
      if (g.docScrollW > g.W || g.bodyScrollW > g.W) badGeo.push(route + ':doc ' + g.docScrollW + '>' + g.W);
      if (!g.tables.every((t) => t.overflowX === 'auto' && t.inside)) badGeo.push(route + ':table ' + JSON.stringify(g.tables));
    }
    check(vpName + ': every live field on every route computes to >= 16 CSS px unfocused, focused and blurred (' + counted + ' fields, min ' + minAll + 'px)', small.length === 0 && counted >= 60, small.slice(0, 12).join(' | '));
    check(vpName + ': no live field extends past the viewport; no clipped number/text input', overflow.length === 0 && clipped.length === 0, JSON.stringify({ overflow, clipped }));
    check(vpName + ': no page-level horizontal overflow on any route; wide reference tables scroll inside their own container', badGeo.length === 0, badGeo.join(' | '));

    // ── 2. AI Chat composer: size, real handlers, growth, internal scroll, send button ───────────
    await goRoute(page, 'chat');
    const before = await page.evaluate(() => { const t = document.getElementById('userInput'); return t ? parseFloat(getComputedStyle(t).fontSize) : null; });
    await page.focus('#userInput'); const focused = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('userInput')).fontSize));
    await page.evaluate(() => document.getElementById('userInput').blur()); const blurred = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('userInput')).fontSize));
    check(vpName + ': AI Chat #userInput >= 16px before / focus / blur', before >= 16 && focused >= 16 && blurred >= 16, JSON.stringify({ before, focused, blurred }));
    const handlers = await page.evaluate(() => { const t = document.getElementById('userInput'); return { oninput: t.getAttribute('oninput'), onkeydown: t.getAttribute('onkeydown'), rows: t.rows, sendBtn: !!document.querySelector('.send-btn') }; });
    check(vpName + ': composer handlers unchanged (oninput=autoResize(this), onkeydown=handleKey(event)) and send button present', handlers.oninput === 'autoResize(this)' && handlers.onkeydown === 'handleKey(event)' && handlers.sendBtn, JSON.stringify(handlers));
    await page.focus('#userInput'); await page.keyboard.type('sample line one');
    const h1 = await page.evaluate(() => document.getElementById('userInput').getBoundingClientRect().height);
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type('sample line two'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('sample line three');
    const g3 = await page.evaluate(() => { const t = document.getElementById('userInput'), b = document.querySelector('.send-btn'); const r = t.getBoundingClientRect(), s = b.getBoundingClientRect(); return { h: r.height, lines: t.value.split('\n').length, tRight: Math.round(r.right), sLeft: Math.round(s.left), sRight: Math.round(s.right), sW: Math.round(s.width), sH: Math.round(s.height), W: window.innerWidth, maxH: parseFloat(getComputedStyle(t).maxHeight) }; });
    check(vpName + ': composer grows with multiline text via the real autoResize (3 lines taller than 1) and stays within its CSS max-height', g3.lines === 3 && g3.h > h1 && g3.h <= g3.maxH + 0.5, JSON.stringify({ h1, g3 }));
    check(vpName + ': send button stays usable beside the composer (46px, inside the viewport, not overlapped)', g3.sW >= 44 && g3.sH >= 44 && g3.sRight <= g3.W + 0.5 && g3.tRight <= g3.sLeft + 0.5, JSON.stringify(g3));
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Shift+Enter'); await page.keyboard.type('more'); }
    const g11 = await page.evaluate(() => { const t = document.getElementById('userInput'); return { h: t.getBoundingClientRect().height, maxH: parseFloat(getComputedStyle(t).maxHeight), scrolls: t.scrollHeight > t.clientHeight + 1, lines: t.value.split('\n').length }; });
    check(vpName + ': a long draft (11 lines) is capped at max-height and keeps its internal scroll', g11.lines === 11 && Math.abs(g11.h - g11.maxH) < 1 && g11.scrolls, JSON.stringify(g11));
    await page.evaluate(() => { const t = document.getElementById('userInput'); t.value = ''; autoResize(t); });

    // ── 3. API-key modal through its REAL route: sendMessage without a stored key opens it and returns ───
    await page.evaluate(() => { document.getElementById('userInput').value = 'field-policy check (never sent)'; });
    const blockedBeforeEnter = blocked;   // the app's own (blocked) resource loads happened at startup; the Enter route must add none
    await page.focus('#userInput'); await page.keyboard.press('Enter');   // real handleKey -> sendMessage -> no API key -> modal, no transport
    await page.waitForTimeout(120);
    const modal = await page.evaluate(() => { const m = document.getElementById('apiModal'), i = document.getElementById('apiKeyInput'); if (!m || !i) return { missing: true }; i.focus(); const f = parseFloat(getComputedStyle(i).fontSize); i.blur(); return { shown: getComputedStyle(m).display !== 'none', unfocused: parseFloat(getComputedStyle(i).fontSize), focused: f, type: i.type, inside: i.getBoundingClientRect().right <= window.innerWidth + 0.5 && i.getBoundingClientRect().width > 0, blockedBefore: null }; });
    if (!modal.missing && modal.shown) { await page.focus('#apiKeyInput'); await page.keyboard.type('dummy-not-a-key'); }
    const afterType = await page.evaluate(() => { const i = document.getElementById('apiKeyInput'); const stored = localStorage.getItem('nec_ai_key'); const v = i ? i.value : null; if (i) i.value = ''; const m = document.getElementById('apiModal'); if (m) m.style.display = 'none'; document.getElementById('userInput').value = ''; return { typedLen: v ? v.length : 0, stored }; });
    check(vpName + ': API-key entry (real route, dummy text only) >= 16px unfocused / focused, inside the viewport; nothing stored, nothing sent', !modal.missing && modal.shown && modal.unfocused >= 16 && modal.focused >= 16 && modal.type === 'password' && modal.inside && afterType.typedLen === 15 && afterType.stored === null && blocked === blockedBeforeEnter, JSON.stringify({ modal, afterType, blocked, blockedBeforeEnter }));

    // ── 4. real navigation: HOME -> AI Chat -> focus / type / blur -> HOME -> Box Fill ───────────
    await goRoute(page, 'home');
    const homeA = await page.evaluate(() => { const W = window.innerWidth; const els = [...document.querySelectorAll('#panel-home *')].filter((e) => e.getBoundingClientRect().width > 0); return { W, doc: document.documentElement.scrollWidth, maxRight: Math.max(...els.map((e) => Math.round(e.getBoundingClientRect().right))), n: els.length, headerRight: Math.round((document.querySelector('.header') || document.body).getBoundingClientRect().right) }; });
    await goRoute(page, 'chat'); await page.focus('#userInput'); await page.keyboard.type('navigation check'); await page.evaluate(() => document.getElementById('userInput').blur());
    await goRoute(page, 'home');
    const homeB = await page.evaluate(() => { const W = window.innerWidth; const els = [...document.querySelectorAll('#panel-home *')].filter((e) => e.getBoundingClientRect().width > 0); return { W, doc: document.documentElement.scrollWidth, maxRight: Math.max(...els.map((e) => Math.round(e.getBoundingClientRect().right))), n: els.length, active: document.querySelector('.panel.active').id, draft: document.getElementById('userInput').value }; });
    check(vpName + ': HOME -> AI Chat (focus, type, blur) -> HOME: HOME header/cards stay within the normal-scale viewport, no horizontal overflow, geometry unchanged, draft kept', homeA.doc <= homeA.W && homeB.doc <= homeB.W && homeA.maxRight <= homeA.W + 0.5 && homeB.maxRight <= homeB.W + 0.5 && homeA.maxRight === homeB.maxRight && homeA.n === homeB.n && homeB.active === 'panel-home' && homeB.draft === 'navigation check', JSON.stringify({ homeA, homeB }));
    await page.evaluate(() => { document.getElementById('userInput').value = ''; });
    await goRoute(page, 'boxfill');
    const bf = await page.evaluate(() => { const sel = document.getElementById('bfBoxType'); sel.value = 'sq_4x1_5'; sel.dispatchEvent(new Event('change')); const acc = document.getElementById('bfAccessory'); acc.value = 'raco_4sq_1g_050'; acc.dispatchEvent(new Event('change')); const items = [...document.querySelectorAll('#bfResultGrid .result-item')].map((i) => [i.querySelector('.result-item-label').textContent, i.querySelector('.result-item-value').textContent]); return { total: (items.find((r) => r[0] === 'Total Volume') || [])[1], egcPx: parseFloat(getComputedStyle(document.getElementById('bfEgcCount')).fontSize), active: document.querySelector('.panel.active').id }; });
    check(vpName + ': ... then Box Fill still resolves the catalog (4" sq + RACO 772 -> 24.50 in³ (+3.5 added · RACO 772/8772)) at 16px', bf.active === 'panel-boxfill' && bf.total === '24.50 in³ (+3.5 added · RACO 772/8772)' && bf.egcPx >= 16, JSON.stringify(bf));
    await page.evaluate(() => bfReset());

    // ── 5. classification: legacy unreachable Pull Box v1; dev-gated 3D prototype selectors ──────
    const legacy = await page.evaluate(() => { const s = document.getElementById('sub-pullbox'); const sels = s ? [...s.querySelectorAll('select')] : []; return { exists: !!s, display: s ? getComputedStyle(s).display : null, inline12: sels.filter((e) => /font-size:\s*12px/.test(e.getAttribute('style') || '')).length, anyVisible: sels.some((e) => e.offsetParent !== null), inMore: typeof switchTabMore === 'function' && /pullbox/.test(switchTabMore.toString()), inOpenTool: typeof openTool === 'function' && /sub-pullbox/.test(openTool.toString()) }; });
    check(vpName + ': legacy Pull Box v1 (#sub-pullbox, inline 12px selects) is never displayed by any route — classified unreachable, left as-is', legacy.exists && legacy.display === 'none' && !legacy.anyVisible && !legacy.inMore && !legacy.inOpenTool, JSON.stringify(legacy));
    const p3d = await page.evaluate(() => { const sheet = document.getElementById('pbv2-3d-sheet'); if (!sheet) return { missing: true }; const proto = document.getElementById('pbv2-3d-prototype'); const gate = typeof pbv23dShouldOpen === 'function' ? pbv23dShouldOpen(location) : null; sheet.classList.add('show'); if (proto) proto.style.display = 'block'; const sels = [...document.querySelectorAll('.p3d-sel')]; const px = sels.map((e) => parseFloat(getComputedStyle(e).fontSize)); const inside = sels.every((e) => e.offsetParent === null || e.getBoundingClientRect().right <= window.innerWidth + 0.5); sheet.classList.remove('show'); if (proto) proto.style.display = ''; return { gateHere: gate, n: sels.length, minPx: px.length ? Math.min(...px) : null, inside }; });
    check(vpName + ': Pull Box v2 3D prototype selectors (.p3d-sel; opens only on a dev host with pbv2=3d — forced here for measurement) >= 16px and inside the viewport', !p3d.missing && p3d.n >= 1 && p3d.minPx >= 16 && p3d.inside && p3d.gateHere === false, JSON.stringify(p3d));

    // ── 6. non-field typography unchanged (desktop literals) ─────────────────────────────────────
    if (w === 1280) {
      await goRoute(page, 'vdrop'); await page.evaluate(() => { switchTab('more', null); switchTabMore('coderef'); switchTab('vdrop', null); });
      const nf = await page.evaluate((NF) => Object.fromEntries(Object.entries(NF).map(([sel, exp]) => { const e = document.querySelector(sel); return [sel, e ? parseFloat(getComputedStyle(e).fontSize) : null]; })), NON_FIELD);
      const bad = Object.entries(NON_FIELD).filter(([sel, exp]) => nf[sel] !== exp);
      check('desktop 1280: labels, pills, rule text, result titles, table text, buttons, body and More sub-tabs keep their pre-task sizes (the policy is field-only)', bad.length === 0, JSON.stringify(nf));
      await goRoute(page, 'boxfill');
      const bfRule = await page.evaluate(() => ['bfBoxType', 'bfAccessory', 'bfEgcCount', 'bfExtension'].map((i) => parseFloat(getComputedStyle(document.getElementById(i)).fontSize)));
      check('desktop 1280: the accepted Box Fill 16px scoped rule still applies (bfBoxType/bfAccessory/bfEgcCount/bfExtension)', bfRule.every((v) => v === 16), JSON.stringify(bfRule));
    }

    // ── 7. mutant self-test: the measurement must actually catch a too-small field ────────────────
    if (w === 390) {
      await goRoute(page, 'chat');
      const mutant = await page.evaluate(() => { const st = document.createElement('style'); st.id = '__mutant'; st.textContent = '#userInput{font-size:15px}'; document.head.appendChild(st); const bad = parseFloat(getComputedStyle(document.getElementById('userInput')).fontSize); st.remove(); const restored = parseFloat(getComputedStyle(document.getElementById('userInput')).fontSize); return { bad, restored }; });
      check('self-test: an injected 15px mutant on #userInput is detected (<16) and the shipped value is restored after removal', mutant.bad === 15 && mutant.restored >= 16, JSON.stringify(mutant));
      const mutant2 = await page.evaluate(() => { openTool('vdrop'); const st = document.createElement('style'); st.textContent = '#panel-vdrop select{font-size:14px}'; document.head.appendChild(st); const bad = parseFloat(getComputedStyle(document.getElementById('vdMaxPct')).fontSize); st.remove(); return bad; });
      check('self-test: an injected 14px mutant on a V-Drop select is detected (<16)', mutant2 === 14, String(mutant2));
    }

    check(vpName + ': no page errors; every non-file request blocked before initialization (' + blocked + ' blocked)', pageErrors.length === 0, pageErrors.join(' | '));
    await ctx.close();
  }
  await browser.close();

  console.log('EC-UI-FOCUS-1 field-policy browser check — ' + target);
  for (const r of results) console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  [' + (r.detail || '') + ']'));
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? failed + ' of ' + results.length + ' CHECKS FAILED' : 'ALL ' + results.length + ' CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
