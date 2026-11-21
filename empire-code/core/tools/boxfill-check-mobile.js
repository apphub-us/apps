'use strict';
/**
 * EC-CALC-1 / EC-CALC-1B — real-browser Box Fill check for mobile.html.
 *
 *   NODE_PATH=<global node_modules> node tools/boxfill-check-mobile.js [path/to/mobile.html]
 *
 * Drives the ACTUAL Box Fill controls in the full application (never a copied
 * calculator) in headless Chromium: real DOM events on the real inputs and
 * selects, Reset, navigation out and back, invalidation/recovery, the
 * literal audit fixtures, and the clickable references with the downstream
 * AI/Code action stubbed. External network is blocked before the page loads.
 * EC-CALC-1B adds: the Ring / raised cover catalog selector (verified RACO
 * records resolved by tap, same-height proof, multigang covers, extension
 * rings, the RACO 821 conflict note, box-change resets including Custom), the
 * ⓘ field help (tap, keyboard, aria) with real necLink routing, and the
 * 375 / 390 px validation-message wrap measurements. Every check is
 * null-tolerant so the same file records FAILs against the pre-task app.
 * Node tool only — not referenced by the app.
 */
const path = require('path');
const fs = require('fs');
const target = path.resolve(process.argv[2] || path.join(__dirname, '..', 'mobile.html'));
if (!fs.existsSync(target)) { console.error('no such file: ' + target); process.exit(2); }

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
  let blocked = 0;
  await page.route('**/*', (route) => { if (route.request().url().startsWith('file://')) return route.continue(); blocked++; return route.abort(); });
  await page.addInitScript(() => { window._db = null; window.__ecNec = []; });
  await page.goto('file://' + target, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__realNecLink = window.necLink; window.necLink = (ref) => { window.__ecNec.push(ref); }; });   // record citations; the REAL necLink is restored for the routing check

  const results = []; const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  // null-tolerant so the same harness can run against the pre-task app (which lacks the new controls) and record FAILs
  const set = async (id, value) => { await page.evaluate(([i, v]) => { const el = document.getElementById(i); if (!el) return; el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, value]); };
  const setViaKeys = async (id, value) => {
    const tag = await page.evaluate((i) => { const el = document.getElementById(i); return el ? el.tagName : null; }, id);
    if (tag !== 'INPUT') return set(id, value);           // pre-task app: some of these are selects
    await page.fill('#' + id, ''); if (value !== '') await page.type('#' + id, value);
  };
  const state = () => page.evaluate(() => {
    const box = document.getElementById('bfResultBox'); const grid = document.getElementById('bfResultGrid');
    const items = [...grid.querySelectorAll('.result-item')].map((i) => [i.querySelector('.result-item-label').textContent, i.querySelector('.result-item-value').textContent]);
    const val = (lbl) => (items.find((r) => r[0].startsWith(lbl)) || [])[1] || null;
    const note = document.getElementById('bfNote');
    return { ready: box.classList.contains('ready'), fail: box.classList.contains('fail'), status: val('Status'), required: val('Volume Required') || val('Volume Used'), remaining: val('Remaining'), total: val('Total Volume'), egc: val('EGC / bonding'), max: val('Max #'), incomplete: val('INCOMPLETE'), error: val('CHECK INPUT'), items: items.length, note: note ? note.textContent : null };
  });
  const goBoxFill = async () => { await page.evaluate(() => openTool('boxfill')); await page.waitForTimeout(100); };
  await goBoxFill();

  // ── controls exist and are generated from the canonical table ──────────
  const controls = await page.evaluate(() => ({
    options: [...document.querySelectorAll('#bfBoxType option')].map((o) => o.value), groups: [...document.querySelectorAll('#bfBoxType optgroup')].map((g) => g.label),
    labels: [...document.querySelectorAll('#panel-boxfill .ctrl-lbl')].map((l) => l.textContent), oldEgc: !!document.getElementById('bfEgc'), ext: document.getElementById('bfExtension').tagName, extStep: document.getElementById('bfExtension').getAttribute('step'),
    acc: (document.getElementById('bfAccessory') || {}).tagName || null, racoGroups: [...document.querySelectorAll('#bfBoxType optgroup')].map((g) => g.label).filter((l) => /^RACO Multigang/.test(l)),
    raco: [...document.querySelectorAll('#bfBoxType option')].filter((o) => /^raco_/.test(o.value)).map((o) => [o.value, o.textContent, o.parentElement.label]),
    sq15: ([...document.querySelectorAll('#bfBoxType option')].find((o) => o.value === 'sq_4x1_5') || {}).textContent || '' }));
  check('controls: Box Type options generated from BF_BOXES (37 keys: 27 accepted + 10 RACO multigang, grouped)', controls.options.length === 37 && controls.groups.length >= 9 && controls.options[0] === 'sq_4x1_25', controls.options.length + ' options');
  check('controls: "1 or more" EGC select is gone; explicit count + size controls exist', !controls.oldEgc && controls.labels.some((l) => /Entering EGCs/.test(l)) && controls.labels.some((l) => /Largest entering EGC/.test(l)));
  check('controls: Ring / raised cover selector exists; the decimal input is its Custom fallback ("Custom extra volume (in³)")', controls.acc === 'SELECT' && controls.ext === 'INPUT' && controls.extStep === 'any' && controls.labels.some((l) => /Ring \/ raised cover/.test(l)) && controls.labels.some((l) => /Custom extra volume \(in³\)/.test(l)) && !controls.labels.some((l) => /Added marked\/listed volume/.test(l)));
  check('1B base boxes: RACO 951–955 (1-5/8") then 941–945 (2-1/2"), sorted by depth then gang, brand/catalog/depth/capacity visible', controls.racoGroups.length === 2 && controls.raco.map((r) => r[0]).join() === 'raco_951,raco_952,raco_953,raco_954,raco_955,raco_941,raco_942,raco_943,raco_944,raco_945' && controls.raco.every((r) => /-Gang · .*" deep · RACO \d{3} \(\d+\.\d in³\)$/.test(r[1])) && controls.raco[0][1] === '2-Gang · 1-5/8" deep · RACO 951 (47.0 in³)' && controls.raco[9][1] === '6-Gang · 2-1/2" deep · RACO 945 (150.0 in³)', JSON.stringify(controls.raco));
  check('capacity: 4" Square 1-1/2" option shows the corrected 21.0 in³', /21\.0 in³/.test(controls.sq15) && !/25\.5/.test(controls.sq15));

  // ── initial valid state (Reset defaults: 3 x #12, 1 device, no EGC) ─────
  await page.evaluate(() => bfReset());
  let s = await state();
  check('initial: valid FITS with green class after Reset', s.ready && !s.fail && s.status === '✓ FITS' && s.egc === '0 entering · — · factor 0 × 0');

  // ── audit fixture B/C on the real controls: 14 x #14 + 7 entering #14 EGCs in sq_4x2_125 ──
  await set('bfBoxType', 'sq_4x2_125'); await set('bfWireSize', '14'); await setViaKeys('bfConductors', '14'); await setViaKeys('bfDevices', '0'); await set('bfClamps', '0'); await setViaKeys('bfEgcCount', '7');
  s = await state();
  check('EGC: count entered but size missing -> neutral error, no stale FITS', !s.ready && !s.fail && /largest entering EGC size/i.test(s.error || ''));
  await set('bfEgcSize', '14'); s = await state();
  check('EGC fixture n=7: OVER, required 31.50, remaining -1.20, max 13, factor 1.75', s.fail && !s.ready && s.status === '✗ OVER' && s.required === '31.50 in³' && s.remaining === '-1.20 in³' && s.max === '13' && /factor 1\.75 × 2/.test(s.egc), JSON.stringify(s));
  await setViaKeys('bfEgcCount', '4'); s = await state();
  check('EGC fixture n=4: FITS, required 30.00', s.ready && s.status === '✓ FITS' && s.required === '30.00 in³');
  await setViaKeys('bfEgcCount', '5'); s = await state();
  check('EGC fixture n=5: OVER, required 30.50', s.fail && s.required === '30.50 in³');
  // EGC larger than governing size -> structured inconsistency, not a guess
  await set('bfEgcSize', '10'); s = await state();
  check('EGC larger than governing wire size -> clear correction message, no result', !s.ready && !s.fail && /larger than the governing/i.test(s.error || ''));
  await set('bfEgcSize', '14');

  // ── invalidation: every bad input after a valid FITS clears the result ──
  await set('bfBoxType', 'sq_4x2_125'); await setViaKeys('bfEgcCount', '0'); await set('bfEgcSize', ''); await setViaKeys('bfConductors', '3'); s = await state();
  check('setup: valid FITS before invalidation cases', s.ready && s.status === '✓ FITS');
  // Each case is initialised from ITS OWN verified valid FITS (3 x #12, 1 device,
  // sq_4x2_125, no EGC, 0 added) and then changes exactly ONE field, so a failure
  // can never be an artifact of an earlier invalid case (EC-CALC-1 R3).
  const baseline = async () => {
    await set('bfBoxType', 'sq_4x2_125'); await set('bfWireSize', '12'); await setViaKeys('bfConductors', '3'); await setViaKeys('bfDevices', '1');
    await set('bfClamps', '0'); await setViaKeys('bfEgcCount', '0'); await set('bfEgcSize', ''); await set('bfAccessory', 'none'); await set('bfExtension', '0');   // 1B: selector None; the (hidden) Custom input is zeroed by evaluate
    await page.evaluate(() => { const sel = document.getElementById('bfBoxType'); [...sel.options].filter((o) => o.value === '__proto__').forEach((o) => o.remove()); });
    const b = await state(); if (!(b.ready && b.status === '✓ FITS')) throw new Error('baseline is not a valid FITS: ' + JSON.stringify(b));
    return b;
  };
  const cases = [
    ['empty count', async () => setViaKeys('bfConductors', ''), 'incomplete'],
    ['whitespace count', async () => set('bfConductors', '   '), 'incomplete'],
    ['negative count', async () => set('bfConductors', '-1'), 'error'],
    ['fractional count', async () => set('bfConductors', '2.5'), 'error'],
    ['badInput count (typed "e": value "" + validity.badInput)', async () => { await page.fill('#bfConductors', ''); await page.type('#bfConductors', 'e'); const v = await page.evaluate(() => { const el = document.getElementById('bfConductors'); return { value: el.value, bad: el.validity.badInput }; }); if (!(v.value === '' && v.bad === true)) throw new Error('badInput not produced: ' + JSON.stringify(v)); }, 'error'],
    ['invalid select value', async () => page.evaluate(() => { const sel = document.getElementById('bfBoxType'); const o = document.createElement('option'); o.value = '__proto__'; o.textContent = 'x'; sel.appendChild(o); sel.value = '__proto__'; bfUpdateCalc(); }), 'error'],
    ['missing EGC size with count 2', async () => { await setViaKeys('bfEgcCount', '2'); }, 'error'],
    ['invalid extension (-1) in Custom mode', async () => { await set('bfAccessory', 'custom'); await set('bfExtension', '-1'); }, 'error'],
    ['empty extension in Custom mode', async () => { await set('bfAccessory', 'custom'); await setViaKeys('bfExtension', ''); }, 'incomplete'],
  ];
  for (const [name, act, kind] of cases) {
    const before = await baseline();
    await act(); s = await state();
    const cleared = !s.ready && !s.fail && s.status === null && s.required === null && s.items === 1 && (kind === 'incomplete' ? s.incomplete : s.error);
    // classification for the pre-task app (read in the BEFORE log): stale FITS retained / recalculated / NaN / control missing
    const classify = s.ready && s.status === before.status && s.required === before.required ? 'STALE-FITS-RETAINED' : (s.ready || s.fail) ? ('RECALCULATED status=' + s.status + ' required=' + s.required) : 'no-result';
    check('invalidation: ' + name + ' -> no stale FITS / class / totals; ' + kind + ' message shown', cleared, 'old-app behaviour: ' + classify + ' ' + JSON.stringify(s));
  }
  await baseline(); await set('bfAccessory', 'custom');
  await setViaKeys('bfExtension', ''); await setViaKeys('bfExtension', '0'); await setViaKeys('bfConductors', '-2'); await setViaKeys('bfConductors', '3'); s = await state();
  check('recovery: correcting the fields returns a valid result', s.ready && s.status === '✓ FITS');
  // explicit zero is not blank
  await setViaKeys('bfConductors', '0'); await setViaKeys('bfDevices', '0'); s = await state();
  check('explicit zero counts calculate (0 required), distinct from blank', s.ready && s.required === '0.00 in³');

  // ── R1: boundary presentation on the real controls — Total AND Required AND Remaining ──
  const boundary = async (egc, ext) => { await set('bfBoxType', 'pl_sg_22'); await set('bfWireSize', '12'); await setViaKeys('bfConductors', '10'); await setViaKeys('bfDevices', '0'); await set('bfClamps', '0'); await setViaKeys('bfEgcCount', egc); await set('bfEgcSize', '12'); await set('bfAccessory', 'custom'); await setViaKeys('bfExtension', ext); return state(); };   // 1B: the accepted decimal cases run THROUGH Custom mode
  s = await boundary('5', '3.31');
  check('R1 original trap (5 EGC, +3.31): OVER; Total 25.3100, Required 25.3125, Remaining -0.0025 — one shared precision', s.fail && s.status === '✗ OVER' && s.total === '25.3100 in³ (+3.31 added)' && s.required === '25.3125 in³' && s.remaining === '-0.0025 in³', JSON.stringify(s));
  s = await boundary('7', '4.437');
  check('R1 reviewer case (7 EGC, +4.437): OVER; Total 26.4370 never reads above Required 26.4375; Remaining -0.0005', s.fail && s.status === '✗ OVER' && s.total === '26.4370 in³ (+4.437 added)' && s.required === '26.4375 in³' && s.remaining === '-0.0005 in³', JSON.stringify(s));
  s = await boundary('7', '4.43749');
  check('R1 finer boundary (+4.43749): OVER; Total 26.43749 vs Required 26.43750; Remaining -0.00001, never "-0.0000"', s.fail && s.status === '✗ OVER' && s.total === '26.43749 in³ (+4.43749 added)' && s.required === '26.43750 in³' && s.remaining === '-0.00001 in³', JSON.stringify(s));
  s = await boundary('7', '4.4375');
  check('R1 exact equality (+4.4375): FITS; Total 26.44 == Required 26.44; Remaining 0.00', s.ready && s.status === '✓ FITS' && s.total === '26.44 in³ (+4.4375 added)' && s.required === '26.44 in³' && s.remaining === '0.00 in³', JSON.stringify(s));
  s = await boundary('7', '4.4374999');
  check('R1 sub-micro excess (+4.4374999): OVER shown with 7 decimals; the decimal domain is not restricted', s.fail && s.total === '26.4374999 in³ (+4.4374999 added)' && s.required === '26.4375000 in³' && s.remaining === '-0.0000001 in³', JSON.stringify(s));

  // ── capacity-only false FITS on the real controls ───────────────────────
  await set('bfBoxType', 'sq_4x1_5'); await setViaKeys('bfConductors', '10'); await setViaKeys('bfEgcCount', '0'); await set('bfEgcSize', ''); await set('bfAccessory', 'none'); await set('bfExtension', '0'); s = await state();
  check('capacity: 10 x #12 in 4" sq 1-1/2" is OVER at the corrected 21.0 (was FITS at 25.5)', s.fail && s.total === '21.00 in³' && s.required === '22.50 in³');

  // ── Reset recovers from an invalid state and includes the new controls ─
  await set('bfConductors', '-4'); await setViaKeys('bfEgcCount', '9'); await set('bfEgcSize', '12'); await set('bfAccessory', 'custom'); await set('bfExtension', '-2');
  await page.click('#panel-boxfill .reset-btn'); s = await state();
  const after = await page.evaluate(() => { const g = (i) => (document.getElementById(i) || {}).value; const w = document.getElementById('bfCustomWrap'); return { c: g('bfConductors'), e: g('bfEgcCount'), es: g('bfEgcSize'), x: g('bfExtension'), b: g('bfBoxType'), a: g('bfAccessory'), customHidden: w ? getComputedStyle(w).display === 'none' : null }; });
  check('Reset: every control returns to defaults (ring/cover None, Custom hidden) and the result is valid again', s.ready && after.c === '3' && after.e === '0' && after.es === '' && after.x === '0' && after.b === 'sq_4x1_25' && after.a === 'none' && after.customHidden === true, JSON.stringify(after));

  // ── navigation out and back keeps state and a coherent result ──────────
  await setViaKeys('bfEgcCount', '6'); await set('bfEgcSize', '12'); const before = await state();
  await page.evaluate(() => switchTab('home', null)); await page.waitForTimeout(80); await goBoxFill(); s = await state();
  check('navigation: Home and back keeps the entered EGC state and result', JSON.stringify(s) === JSON.stringify(before) && /6 entering/.test(s.egc));
  await setViaKeys('bfConductors', ''); await page.evaluate(() => switchTab('home', null)); await goBoxFill(); s = await state();
  check('navigation: leaving in an incomplete state comes back incomplete, not stale', !s.ready && s.incomplete);
  await setViaKeys('bfConductors', '3');

  // ── R2: citation inventory — EVERY 314.16 reference in the Box Fill regions must sit inside a .nec-link ─
  const inventory = () => page.evaluate(() => {
    const out = []; const re = /(NEC\s+2020\s+)?(Table\s+)?314\.16(\([A-Z]\)(\(\d+\))?)?/g;
    const walker = document.createTreeWalker(document.getElementById('panel-boxfill'), NodeFilter.SHOW_TEXT);
    // "linked" = inside a .nec-link OR inside an element whose own onclick calls necLink (the NEC pill)
    let n; while ((n = walker.nextNode())) { let m; re.lastIndex = 0; while ((m = re.exec(n.textContent))) out.push({ text: m[0], linked: !!(n.parentElement && n.parentElement.closest('.nec-link, [onclick^="necLink("]')), where: (n.parentElement.closest('.ctrl-help') && 'help') || (n.parentElement.closest('.result-title') && 'result-title') || (n.parentElement.closest('#bfNote') && 'note') || (n.parentElement.closest('.tbl-title') && 'table-heading') || (n.parentElement.closest('.pill') && 'pill') || 'other' }); }
    return out;
  });
  const cite = async (label, minRefs) => { const inv = await inventory(); const plain = inv.filter((c) => !c.linked); check('R2 citation inventory ' + label + ': ' + inv.length + ' references, ' + plain.length + ' left as plain text', inv.length >= minRefs && plain.length === 0, JSON.stringify(plain)); return inv; };
  const inv1 = await cite('(valid result)', 10);
  check('R2 covers the five previously plain references: help 314.16(A), result-title, (B) heading, presets Table 314.16(A), note 314.16 amendment', ['help', 'result-title', 'table-heading', 'note'].every((w) => inv1.some((c) => c.where === w && c.linked)) && inv1.filter((c) => c.where === 'table-heading' && c.linked).length >= 3 && inv1.filter((c) => c.where === 'note' && c.linked).length >= 3);
  await setViaKeys('bfConductors', ''); s = await state(); await cite('(invalidated: note cleared, the 7 static references still linked)', 7);
  await setViaKeys('bfConductors', '3'); await cite('(recovered / re-rendered)', 10);
  // real necLink routing: only the network-sending action (sendMessage) is stubbed
  const routed = await page.evaluate(async () => {
    const stub = window.necLink; window.necLink = window.__realNecLink;           // the REAL necLink
    window.__ecSent = 0; window.sendMessage = () => { window.__ecSent++; };       // only the network-sending action is stubbed
    const target = [...document.querySelectorAll('#bfNote .nec-link')].find((el) => el.textContent === '314.16(B)(5)');
    if (!target) { window.necLink = stub; return { missing: true }; }              // pre-task app: the note does not exist
    document.querySelector('#panel-boxfill').classList.add('active');
    target.click(); await new Promise((r) => setTimeout(r, 300));
    const out = { chatActive: document.getElementById('panel-chat').classList.contains('active'), boxfillActive: document.getElementById('panel-boxfill').classList.contains('active'), navChat: document.getElementById('mnav-chat').classList.contains('active'), question: document.getElementById('userInput').value, sent: window.__ecSent };
    window.necLink = stub; return out;
  });
  check('R2 real necLink routing: Chat opens, Box Fill panel deactivates, the question carries the citation, sendMessage called once', !routed.missing && routed.chatActive && !routed.boxfillActive && routed.navChat && /Explain NEC 2020 .*Section 314\.16\(B\)\(5\)/.test(routed.question) && /NYCEC 2025 amends/.test(routed.question) && routed.sent === 1, JSON.stringify(routed));   // EC-UI-LAYOUT-REFS-1 (old -> new): the prepared question names NEC 2020 + the section and asks about the NYCEC 2025 amendment (was: "Explain NEC 314.16(B)(5) … Include NYC amendment")
  await goBoxFill();
  const refs = await page.evaluate(() => { window.__ecNec = []; document.querySelectorAll('#panel-boxfill .nec-link').forEach((el) => el.click()); return window.__ecNec; });
  check('references: every Box Fill .nec-link routes through necLink with a distinct citation context', refs.length >= 8 && new Set(refs).size >= 7 && refs.some((r) => /314\.16\(B\)\(5\)/.test(r)) && refs.some((r) => /Table 314\.16\(A\)/.test(r)) && refs.some((r) => /314\.16\(A\)\(2\)/.test(r)) && refs.some((r) => /no amendment to 314\.16/.test(r)) && refs.some((r) => /Table 314\.16\(B\)/.test(r)), JSON.stringify(refs));
  const noInline = await page.evaluate(() => [...document.querySelectorAll('#bfNote *, #bfResultGrid *')].every((el) => [...el.attributes].every((a) => !/^on/i.test(a.name))));
  check('references: new note/result markup carries no inline handlers (EC-SAFE-1 style)', noInline);

  // ═══ EC-CALC-1B — field catalog, 821 conflict, box-change resets, help, iPhone wrap ═══
  const safe = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, 'threw: ' + String(e).split('\n')[0]); } };
  const acc = () => page.evaluate(() => { const sel = document.getElementById('bfAccessory'); if (!sel) return null; const w = document.getElementById('bfCustomWrap'); const note = document.getElementById('bfAccessoryNote');
    return { value: sel.value, options: [...sel.options].map((o) => o.value), labels: [...sel.options].map((o) => o.textContent), groups: [...sel.querySelectorAll('optgroup')].map((g) => g.label), ext: document.getElementById('bfExtension').value,
      customVisible: !!w && getComputedStyle(w).display !== 'none' && document.getElementById('bfExtension').offsetParent !== null, note: note && !note.hidden && getComputedStyle(note).display !== 'none' ? note.textContent : null }; });
  const setup1B = async (box) => { await page.evaluate(() => bfReset()); await set('bfBoxType', box); await set('bfWireSize', '12'); await setViaKeys('bfConductors', '3'); await setViaKeys('bfDevices', '1'); await set('bfClamps', '0'); await setViaKeys('bfEgcCount', '0'); await set('bfEgcSize', ''); };
  // acceptance 1 — same height, different volume (RACO 772 vs 778 on a 4" square)
  await safe('1B same-height', async () => {
    await setup1B('sq_4x1_5'); let a = await acc();
    check('1B selector (4" square): None · 1-device / 2-device mud rings · extension ring · Other/Custom, generated from BF_ACCESSORIES', !!a && a.options[0] === 'none' && a.options[a.options.length - 1] === 'custom' && a.options.length === 19 && a.groups.join('|') === '1-device mud rings|2-device mud rings|Extension rings', JSON.stringify(a && { n: a.options.length, g: a.groups }));
    check('1B labels lead with opening count · raised height · auto-added in³ · catalog number', !!a && a.labels.includes('1-device · 1/2" raised · +3.5 in³ · RACO 772/8772') && a.labels.includes('2-device · 1/2" raised · +5.5 in³ · RACO 778/8778') && a.labels.includes('Extension ring · 1-1/2" deep · +22.5 in³ · RACO 201'), JSON.stringify(a && a.labels));
    check('1B None: Custom input hidden, no note, nothing added', !!a && a.value === 'none' && a.customVisible === false && a.note === null && (await state()).total === '21.00 in³');
    await set('bfAccessory', 'raco_4sq_1g_050'); s = await state(); a = await acc();
    check('1B 4" square + RACO 772 (1-device 1/2") -> +3.5: Total 24.50 in³ (+3.5 added · RACO 772/8772); Custom input stays hidden', s.ready && s.total === '24.50 in³ (+3.5 added · RACO 772/8772)' && a.customVisible === false, JSON.stringify(s));
    await set('bfAccessory', 'raco_4sq_2g_050'); s = await state();
    check('1B same base + RACO 778 (2-device 1/2") -> +5.5: Total 26.50 in³ — same 1/2" height, different volume', s.ready && s.total === '26.50 in³ (+5.5 added · RACO 778/8778)', JSON.stringify(s));
    await set('bfAccessory', 'raco_4sq_ext_201_150'); s = await state();
    check('1B acceptance 5: 4" square + RACO 201 extension ring -> +22.5 (Total 43.50 in³)', s.ready && s.total === '43.50 in³ (+22.5 added · RACO 201)', JSON.stringify(s));
  });
  // acceptance 2/3 — base boxes 2–6 gang and the multigang raised covers (exact base models only)
  await safe('1B multigang', async () => {
    const mg = [['raco_951', '47.00', null, null], ['raco_952', '60.00', 'raco_mg_822_075', '75.30 in³ (+15.3 added · RACO 822)'], ['raco_953', '72.80', 'raco_mg_823_075', '93.10 in³ (+20.3 added · RACO 823)'], ['raco_954', '85.80', 'raco_mg_824_075', '111.30 in³ (+25.5 added · RACO 824)'], ['raco_955', '98.50', 'raco_mg_825_075', '129.00 in³ (+30.5 added · RACO 825)'],
      ['raco_941', '70.00', null, null], ['raco_942', '90.00', 'raco_mg_822_075', '105.30 in³ (+15.3 added · RACO 822)'], ['raco_943', '110.00', 'raco_mg_823_075', '130.30 in³ (+20.3 added · RACO 823)'], ['raco_944', '130.00', 'raco_mg_824_075', '155.50 in³ (+25.5 added · RACO 824)'], ['raco_945', '150.00', 'raco_mg_825_075', '180.50 in³ (+30.5 added · RACO 825)']];
    let boxesOk = true, coversOk = true, detail = [];
    for (const [box, vol, cover, total] of mg) {
      await setup1B(box); s = await state(); const a = await acc();
      if (!(s.ready && s.total === vol + ' in³')) { boxesOk = false; detail.push(box + ':' + s.total); }
      if (cover) {
        if (!(a.options.join() === 'none,' + cover + ',custom')) { coversOk = false; detail.push(box + ' options ' + a.options.join()); }
        await set('bfAccessory', cover); s = await state(); if (s.total !== total) { coversOk = false; detail.push(box + '+' + cover + ':' + s.total); }
      }
    }
    check('1B acceptance 2: every RACO 951–955 / 941–945 key resolves to the literal seed volume (47/60/72.8/85.8/98.5 · 70/90/110/130/150)', boxesOk, detail.join(' | '));
    check('1B acceptance 3: 952/942+822 -> +15.3 · 953/943+823 -> +20.3 · 954/944+824 -> +25.5 · 955/945+825 -> +30.5; each cover offered ONLY for its exact base models', coversOk, detail.join(' | '));
  });
  // acceptance 4 — RACO 821 conflict: never auto-added, note shown, Custom offered
  await safe('1B 821', async () => {
    for (const box of ['raco_951', 'raco_941']) {
      await setup1B(box); const a = await acc(); s = await state();
      check('1B acceptance 4 (' + box + '): only None / Other-Custom offered (no 821 record), conflict note visible', !!a && a.options.join() === 'none,custom' && a.note === 'RACO 821 3/4" cover: automatic volume unavailable because current manufacturer sources conflict. Verify the actual product data and use Custom.' && s.total === (box === 'raco_951' ? '47.00 in³' : '70.00 in³'), JSON.stringify(a));
      await set('bfAccessory', 'custom'); const b = await acc(); s = await state();
      check('1B ' + box + ' + Other/Custom: decimal input appears with 0, nothing auto-added (no 10.0 / 10.3 anywhere)', b.customVisible === true && b.ext === '0' && s.total === (box === 'raco_951' ? '47.00 in³' : '70.00 in³') && !/10\.0|10\.3/.test(s.total), JSON.stringify(b));
    }
    await setup1B('raco_952'); const c = await acc(); check('1B the 821 note is shown only for the 2-gang base boxes (hidden for RACO 952)', !!c && c.note === null);
  });
  // acceptance 6 — compatibility invalidation, plus the product decision: Custom never carries across a box change
  await safe('1B box-change resets', async () => {
    await setup1B('sq_4x1_5'); await set('bfAccessory', 'raco_4sq_1g_050'); s = await state(); const before1 = s.total;
    await set('bfBoxType', 'sq_4_11_16x1_5'); s = await state(); let a = await acc();
    check('1B acceptance 6: 4" mud ring then base -> 4-11/16": ring/volume disappear (None, 0), result recalculated on 29.50 in³, only 4-11/16" items offered', before1 === '24.50 in³ (+3.5 added · RACO 772/8772)' && a.value === 'none' && s.ready && s.total === '29.50 in³' && !a.options.includes('raco_4sq_1g_050') && a.options.includes('raco_41116_1g_050') && a.options.includes('raco_41116_ext_250_150'), JSON.stringify({ before1, total: s.total, a: a.value }));
    await setup1B('sq_4x1_5'); await set('bfAccessory', 'custom'); await setViaKeys('bfExtension', '4.5'); s = await state(); const before2 = s.total; const vis2 = (await acc()).customVisible;
    await set('bfBoxType', 'sq_4x2_125'); s = await state(); a = await acc();
    check('1B regression (product decision): Other/Custom +4.5 then Box Type change -> accessory None, custom volume 0 and hidden, immediate recalculation with extensionVolume 0 (Total 30.30 in³)', before2 === '25.50 in³ (+4.5 added)' && vis2 === true && a.value === 'none' && a.ext === '0' && a.customVisible === false && s.ready && s.total === '30.30 in³', JSON.stringify({ before2, a, total: s.total }));
    await setup1B('sq_4x1_25'); await set('bfAccessory', 'raco_4sq_2g_100'); s = await state(); const before3 = s.total;
    await set('bfBoxType', 'sq_4x1_5'); s = await state(); a = await acc();
    check('1B a still-compatible ring is also dropped on a same-family box change (no silent carry-over; still offered, not pre-selected)', before3 === '30.00 in³ (+12 added · RACO 780)' && a.value === 'none' && s.total === '21.00 in³' && a.options.includes('raco_4sq_2g_100'), JSON.stringify({ before3, total: s.total, a: a.value }));
    await setup1B('dev_3x2x2'); a = await acc(); check('1B device / handy / plastic boxes: only None / Other-Custom (no starter accessory)', !!a && a.options.join() === 'none,custom');
  });
  // help — tap, keyboard, aria; one open at a time; no hover requirement
  await safe('1B help', async () => {
    const keys = ['gang', 'yoke', 'clamps', 'egc', 'ring', 'custom'];
    const helpState = () => page.evaluate((ks) => ks.map((k) => { const b = document.getElementById('bfHelpBtn-' + k), h = document.getElementById('bfHelp-' + k); return { k, btn: !!b, tag: b && b.tagName, type: b && b.getAttribute('type'), controls: b && b.getAttribute('aria-controls'), expanded: b && b.getAttribute('aria-expanded'), label: b && b.getAttribute('aria-label'), open: !!h && !h.hidden && getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 0, text: h ? h.textContent.trim() : '' }; }), keys);
    let hs = await helpState();
    check('1B help: six real <button type="button"> controls with aria-label, aria-controls -> existing block, aria-expanded="false", all closed initially', hs.every((x) => x.btn && x.tag === 'BUTTON' && x.type === 'button' && x.controls === 'bfHelp-' + x.k && x.expanded === 'false' && x.label && !x.open && x.text.length > 40), JSON.stringify(hs.map((x) => [x.k, x.btn, x.expanded, x.open])));
    await page.evaluate(() => { document.getElementById('panel-boxfill').scrollTop = 0; });
    await set('bfAccessory', 'custom');   // so the Custom help button is visible for a real click
    let okTap = true, okOne = true, detail = [];
    for (const k of keys) {
      await page.click('#bfHelpBtn-' + k); hs = await helpState();
      const me = hs.find((x) => x.k === k); if (!(me.open && me.expanded === 'true')) { okTap = false; detail.push(k + ' did not open'); }
      if (hs.filter((x) => x.open).length !== 1 || hs.filter((x) => x.expanded === 'true').length !== 1) { okOne = false; detail.push(k + ': ' + hs.filter((x) => x.open).map((x) => x.k).join('+')); }
    }
    check('1B help: each ⓘ opens its own inline block on a real click/tap with aria-expanded="true"', okTap, detail.join(' | '));
    check('1B help: only one help block is open at a time (opening the next closes the previous)', okOne, detail.join(' | '));
    await page.click('#bfHelpBtn-custom'); hs = await helpState();
    check('1B help: a second tap closes the block and returns aria-expanded to "false"', hs.every((x) => !x.open && x.expanded === 'false'));
    await page.focus('#bfHelpBtn-egc'); await page.keyboard.press('Enter'); hs = await helpState(); const enterOpen = hs.find((x) => x.k === 'egc').open;
    await page.keyboard.press('Space'); hs = await helpState(); const spaceClosed = !hs.find((x) => x.k === 'egc').open;
    check('1B help: keyboard activation — Enter opens, Space closes (native button semantics, no hover needed)', enterOpen && spaceClosed);
    const contents = await page.evaluate(() => ({ egc: document.getElementById('bfHelp-egc').textContent, yoke: document.getElementById('bfHelp-yoke').textContent, clamps: document.getElementById('bfHelp-clamps').textContent, gang: document.getElementById('bfHelp-gang').textContent, links: [...document.querySelectorAll('#panel-boxfill .bf-help .nec-link')].map((l) => l.textContent) }));
    check('1B help: spec wording present offline (EGC / yoke / clamps / gang) and NEC citations are .nec-link controls', /Do not count a grounding pigtail located entirely inside the box/.test(contents.egc) && /Enter the number of yokes in the box/.test(contents.yoke) && /Do not count external connectors as internal clamps/.test(contents.clamps) && /It is not the number of conductors/.test(contents.gang) && contents.links.join() === 'NEC 314.16(A),NEC 314.16(A),NEC 314.16(B)(4),NEC 314.16(B)(2),NEC 314.16(B)(5)', JSON.stringify(contents.links));   // R1 DOM order: ring, custom, yoke, clamps, egc
    // real necLink routing from a help citation — only the network-sending action is stubbed
    await page.click('#bfHelpBtn-yoke');
    const routedHelp = await page.evaluate(async () => {
      const stub = window.necLink; window.necLink = window.__realNecLink; window.__ecSent = 0; window.sendMessage = () => { window.__ecSent++; };
      const target = document.querySelector('#bfHelp-yoke .nec-link'); if (!target) { window.necLink = stub; return { missing: true }; }
      target.click(); await new Promise((r) => setTimeout(r, 300));
      const out = { chatActive: document.getElementById('panel-chat').classList.contains('active'), boxfillActive: document.getElementById('panel-boxfill').classList.contains('active'), question: document.getElementById('userInput').value, sent: window.__ecSent };
      window.necLink = stub; return out;
    });
    check('1B help: tapping NEC 314.16(B)(4) inside the yoke help routes through the REAL necLink — Chat opens, the question carries the citation, sendMessage called once', !routedHelp.missing && routedHelp.chatActive && !routedHelp.boxfillActive && /Explain NEC 2020 .*Section 314\.16\(B\)\(4\)/.test(routedHelp.question) && routedHelp.sent === 1, JSON.stringify(routedHelp));   // EC-UI-LAYOUT-REFS-1 (old -> new): source/edition/section wording
    await goBoxFill(); await page.evaluate(() => bfHelpToggle(null));
    const noInlineHelp = await page.evaluate(() => [...document.querySelectorAll('#bfAccessory *, #bfAccessoryNote *, #bfListedTable *')].every((el) => [...el.attributes].every((a) => !/^on/i.test(a.name))));
    check('1B generated selector / note / listed-table markup carries no inline handlers (EC-SAFE-1 style)', noInlineHelp);
  });
  // iPhone 375 / 390 — CHECK INPUT and INCOMPLETE wrap inside the result card, no horizontal overflow
  await safe('1B iPhone wrap', async () => {
    const measure = () => page.evaluate(() => { const box = document.getElementById('bfResultBox'), item = document.querySelector('#bfResultGrid .result-item'), val = item && item.querySelector('.result-item-value'), panel = document.getElementById('panel-boxfill');
      const b = box.getBoundingClientRect(), i = item.getBoundingClientRect(), v = val.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(val).lineHeight) || 16;
      return { label: item.querySelector('.result-item-label').textContent, inside: i.right <= b.right + 0.5 && i.left >= b.left - 0.5 && v.right <= b.right + 0.5, noPageScroll: document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth, noPanelScroll: panel.scrollWidth <= panel.clientWidth + 1, noClip: val.scrollWidth <= val.clientWidth + 1, lines: Math.round(v.height / lh), width: window.innerWidth, text: val.textContent }; });
    for (const [w, h] of [[375, 812], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await setup1B('sq_4x2_125'); await setViaKeys('bfEgcCount', '2'); await set('bfEgcSize', '10');   // EGC larger than governing -> the longest CHECK INPUT message
      let m = await measure();
      check('1B ' + w + 'px CHECK INPUT (long message) wraps inside the result card: no clipping, no page/panel horizontal scroll', m.label === 'CHECK INPUT' && m.inside && m.noPageScroll && m.noPanelScroll && m.noClip && m.lines >= 2, JSON.stringify(m));
      await set('bfEgcSize', '12'); await setViaKeys('bfConductors', ''); m = await measure();
      check('1B ' + w + 'px INCOMPLETE wraps inside the result card: no clipping, no page/panel horizontal scroll', m.label === 'INCOMPLETE' && m.inside && m.noPageScroll && m.noPanelScroll && m.noClip, JSON.stringify(m));
      const ctl = await page.evaluate(() => { const p = document.getElementById('panel-boxfill'); const els = [...p.querySelectorAll('.controls select, .controls input, .controls .bf-help, .controls .bf-note')]; return els.every((el) => el.getBoundingClientRect().right <= window.innerWidth + 0.5) && document.documentElement.scrollWidth <= window.innerWidth; });
      await page.click('#bfHelpBtn-ring'); const helpFit = await page.evaluate(() => { const h = document.getElementById('bfHelp-ring').getBoundingClientRect(); return h.height > 0 && h.right <= window.innerWidth + 0.5 && h.left >= 0 && document.documentElement.scrollWidth <= window.innerWidth; }); await page.click('#bfHelpBtn-ring');
      check('1B ' + w + 'px controls, selector and an open help block fit the viewport width (no horizontal overflow)', ctl && helpFit);
      await setViaKeys('bfConductors', '3');
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  // Focus-zoom (phone gate) — computed font-size of every Box Fill control is >= 16 CSS px in every state at every
  // phone viewport; layout stays inside the viewport; wide reference tables still scroll inside their own container;
  // no other panel's controls are restyled. Desktop Chromium measures the CSS the phone will get; it cannot execute
  // iOS Safari's native focus zoom itself — that stays a physical-iPhone check.
  await safe('1B focus-zoom', async () => {
    const IDS = ['bfBoxType', 'bfAccessory', 'bfExtension', 'bfWireSize', 'bfConductors', 'bfDevices', 'bfClamps', 'bfEgcCount', 'bfEgcSize'];
    const fontSizes = () => page.evaluate((ids) => Object.fromEntries(ids.map((i) => { const el = document.getElementById(i); return [i, el ? parseFloat(getComputedStyle(el).fontSize) : null]; })), IDS);
    const viewports = [[375, 812, 'iPhone 375 portrait'], [390, 844, 'iPhone 390 portrait'], [414, 896, 'iPhone 414 portrait'], [844, 390, 'iPhone 390 landscape']];
    for (const [w, h, name] of viewports) {
      await page.setViewportSize({ width: w, height: h }); await setup1B('sq_4x1_5'); await set('bfAccessory', 'custom');   // Custom revealed so #bfExtension is rendered
      const before = await fontSizes(); const focused = {}; const blurred = {};
      for (const id of IDS) { await page.focus('#' + id); focused[id] = (await fontSizes())[id]; await page.evaluate((i) => document.getElementById(i).blur(), id); blurred[id] = (await fontSizes())[id]; }
      const all = IDS.every((id) => before[id] >= 16 && focused[id] >= 16 && blurred[id] >= 16);
      check('1B focus-zoom ' + name + ': all nine BF selects/number inputs compute to >= 16 CSS px unfocused, focused and blurred (Custom revealed)', all, JSON.stringify({ unfocused: before, focused, blurred }));
      const layout = await page.evaluate(() => { const p = document.getElementById('panel-boxfill'); const W = window.innerWidth;
        const ctl = [...p.querySelectorAll('.controls select, .controls input, .controls .bf-help-btn, .controls .reset-btn')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.className, right: Math.round(r.right), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 }; });
        const clipped = [...p.querySelectorAll('.controls input[type=number]')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.id);
        const tbl = [...p.querySelectorAll('.tbl-wrap')].map((t) => ({ scrolls: t.scrollWidth > t.clientWidth, overflowX: getComputedStyle(t).overflowX, inside: t.getBoundingClientRect().right <= W + 0.5 }));
        return { ok: ctl.every((c) => c.right <= W + 0.5 && c.h >= 20), visible: ctl.filter((c) => c.visible).length, noPageScroll: document.documentElement.scrollWidth <= W && document.body.scrollWidth <= W, noPanelScroll: p.scrollWidth <= p.clientWidth + 1, clipped, tbl, W }; });
      check('1B focus-zoom ' + name + ': controls, help buttons and Reset fit the viewport at normal scale; no page/panel horizontal scroll; no clipped number input', layout.ok && layout.noPageScroll && layout.noPanelScroll && layout.clipped.length === 0 && layout.visible >= 16, JSON.stringify(layout));
      check('1B focus-zoom ' + name + ': the wide reference tables scroll inside their own container and stay inside the viewport', layout.tbl.length >= 1 && layout.tbl.every((t) => t.overflowX === 'auto' && t.inside && (t.scrolls || layout.W >= 628)), JSON.stringify(layout.tbl));
      await setup1B('sq_4x2_125'); await setViaKeys('bfEgcCount', '2'); await set('bfEgcSize', '10'); const m1 = await page.evaluate(() => { const box = document.getElementById('bfResultBox').getBoundingClientRect(), it = document.querySelector('#bfResultGrid .result-item').getBoundingClientRect(); return { label: document.querySelector('#bfResultGrid .result-item-label').textContent, inside: it.right <= box.right + 0.5, noPageScroll: document.documentElement.scrollWidth <= window.innerWidth }; });
      check('1B focus-zoom ' + name + ': CHECK INPUT still wraps inside the result card, no page scroll', m1.label === 'CHECK INPUT' && m1.inside && m1.noPageScroll, JSON.stringify(m1));
      await set('bfEgcSize', '12'); await setViaKeys('bfConductors', '3');
    }
    await page.setViewportSize({ width: 1280, height: 800 }); await setup1B('sq_4x1_5');
    const desk = await page.evaluate((ids) => { const bf = Object.fromEntries(ids.map((i) => [i, parseFloat(getComputedStyle(document.getElementById(i)).fontSize)]));
      const others = Object.fromEntries(['ampWireSize', 'ampInsul', 'cfConduitType', 'vdWireSize', 'wsLoad', 'mtHp'].filter((i) => document.getElementById(i)).map((i) => [i, parseFloat(getComputedStyle(document.getElementById(i)).fontSize)]));
      const lbl = parseFloat(getComputedStyle(document.querySelector('#panel-boxfill .ctrl-lbl')).fontSize), title = parseFloat(getComputedStyle(document.querySelector('#panel-boxfill .result-title')).fontSize), pill = parseFloat(getComputedStyle(document.querySelector('#panel-boxfill .pill')).fontSize);
      return { bf, others, lbl, title, pill }; }, IDS);
    // EC-UI-FOCUS-1 supersedes the historical "other calculators keep 14px" expectation: the shared field policy now
    // makes every live editable control >= 16px (see docs/ui-focus-policy.md). Labels / result title / pills stay as before.
    check('1B focus-zoom desktop 1280px: Box Fill controls 16px; other calculators\' fields follow the shared >= 16px field policy (EC-UI-FOCUS-1); BF labels (9px), result title and pills untouched', Object.values(desk.bf).every((v) => v >= 16) && Object.keys(desk.others).length >= 3 && Object.values(desk.others).every((v) => v >= 16) && desk.lbl === 9 && desk.title === 11 && desk.pill === 11, JSON.stringify(desk));
    await page.setViewportSize({ width: 390, height: 844 });
  });
  // R1 — DOM order on the real panel: Box Type -> Ring / raised cover (+ note, help, Custom) -> Wire Size -> Conductors -> Devices -> Clamps -> EGC
  await safe('1B R1 order', async () => {
    const order = await page.evaluate(() => { const ids = ['bfBoxType', 'bfHelp-gang', 'bfAccessory', 'bfAccessoryNote', 'bfHelp-ring', 'bfCustomWrap', 'bfHelp-custom', 'bfWireSize', 'bfConductors', 'bfDevices', 'bfClamps', 'bfEgcCount', 'bfEgcSize'];
      const els = ids.map((i) => document.getElementById(i)); if (els.some((e) => !e)) return { missing: ids.filter((i, k) => !els[k]) };
      let ok = true; for (let k = 1; k < els.length; k++) if (!(els[k - 1].compareDocumentPosition(els[k]) & Node.DOCUMENT_POSITION_FOLLOWING)) ok = false;
      const sel = document.getElementById('bfAccessory'), box = document.getElementById('bfBoxType'); return { ok, boxTop: box.getBoundingClientRect().top, accTop: sel.getBoundingClientRect().top, wireTop: document.getElementById('bfWireSize').getBoundingClientRect().top }; });
    check('1B R1: real DOM order is Box Type -> Ring / raised cover (+ note, help, Custom) -> Wire Size -> Conductors -> Devices -> Clamps -> EGC', !order.missing && order.ok && order.boxTop <= order.accTop && order.accTop <= order.wireTop, JSON.stringify(order));
  });
  // R2 — the Custom help closes whenever Custom mode disappears; unrelated help stays open
  await safe('1B R2 help state', async () => {
    const cust = () => page.evaluate(() => { const h = document.getElementById('bfHelp-custom'), b = document.getElementById('bfHelpBtn-custom'), w = document.getElementById('bfCustomWrap'); return { open: !!h && !h.hidden && getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 0, aria: b && b.getAttribute('aria-expanded'), wrapHidden: !!w && getComputedStyle(w).display === 'none', egcOpen: !document.getElementById('bfHelp-egc').hidden, gangOpen: !document.getElementById('bfHelp-gang').hidden }; });
    const openCustomHelp = async () => { await set('bfAccessory', 'custom'); if (!(await cust()).open) await page.click('#bfHelpBtn-custom'); const c = await cust(); if (!(c.open && c.aria === 'true' && !c.wrapHidden)) throw new Error('precondition failed: ' + JSON.stringify(c)); };
    await setup1B('sq_4x1_5'); await openCustomHelp(); await set('bfAccessory', 'none'); let c = await cust();
    check('1B R2-A: Custom help open -> None: help hidden, aria-expanded=false, Custom input hidden', !c.open && c.aria === 'false' && c.wrapHidden, JSON.stringify(c));
    await openCustomHelp(); await set('bfAccessory', 'raco_4sq_1g_050'); c = await cust(); s = await state();
    check('1B R2-B: Custom help open -> catalog ring (772): help hidden, aria-expanded=false, catalog volume used', !c.open && c.aria === 'false' && c.wrapHidden && s.total === '24.50 in³ (+3.5 added · RACO 772/8772)', JSON.stringify(c));
    await openCustomHelp(); await setViaKeys('bfExtension', '2.5'); await set('bfBoxType', 'sq_4x2_125'); c = await cust(); s = await state(); const a = await acc();
    check('1B R2-C: Custom help open -> Box Type change: help hidden, aria-expanded=false, selector None, custom 0, Total 30.30 in³', !c.open && c.aria === 'false' && c.wrapHidden && a.value === 'none' && a.ext === '0' && s.total === '30.30 in³', JSON.stringify({ c, a: a.value, ext: a.ext, total: s.total }));
    await setup1B('sq_4x1_5'); await openCustomHelp(); await page.click('#panel-boxfill .reset-btn'); c = await cust(); s = await state();
    check('1B R2-D: Reset from Custom help open: help hidden, aria-expanded=false, selector None, valid default result', !c.open && c.aria === 'false' && c.wrapHidden && s.ready && s.total === '18.00 in³', JSON.stringify(c));
    await setup1B('sq_4x1_5'); await page.click('#bfHelpBtn-egc'); await set('bfAccessory', 'custom'); let e1 = await cust(); await set('bfAccessory', 'raco_4sq_2g_050'); let e2 = await cust(); await set('bfAccessory', 'custom'); let e3 = await cust();
    check('1B R2: choosing Custom / a catalog ring / Custom again never closes unrelated help (EGC stays open) and does not reopen the Custom help by itself', e1.egcOpen && e2.egcOpen && e3.egcOpen && !e3.open && e3.aria === 'false', JSON.stringify({ e1, e2, e3 }));
    await page.evaluate(() => bfHelpToggle(null));
  });
  // Reset and HOME -> Box Fill still work with the selector in play
  await safe('1B reset/navigation', async () => {
    await setup1B('raco_953'); await set('bfAccessory', 'raco_mg_823_075'); const b1 = await state();
    await page.evaluate(() => switchTab('home', null)); await page.waitForTimeout(80); await goBoxFill(); s = await state(); const a = await acc();
    check('1B HOME -> Box Fill keeps the selected RACO 953 + 823 and its result (no stale/foreign capacity)', JSON.stringify(s) === JSON.stringify(b1) && s.total === '93.10 in³ (+20.3 added · RACO 823)' && a.value === 'raco_mg_823_075', JSON.stringify({ s, a: a.value }));
    await page.click('#panel-boxfill .reset-btn'); s = await state(); const r = await acc();
    check('1B Reset after a catalog selection: ring/cover None, 0 added, Custom hidden, valid default result', s.ready && s.total === '18.00 in³' && r.value === 'none' && r.ext === '0' && r.customVisible === false, JSON.stringify(r));
  });
  // reference tables: the listed products sit in their own table
  const listed = await page.evaluate(() => ({ n: document.querySelectorAll('#bfListedTable tr').length, r953: (() => { const tr = [...document.querySelectorAll('#bfListedTable tr')].find((t) => /RACO 953/.test(t.children[0].textContent)); return tr ? [tr.children[1].textContent, tr.children[3].textContent] : null; })() }));
  check('1B reference: listed RACO products in their own table (10 rows; 953 = 72.8 in³, 32 × #12), never inside the Table 314.16(A) table', listed.n === 10 && !!listed.r953 && listed.r953[0] === '72.8' && listed.r953[1] === '32', JSON.stringify(listed));

  // ── reference tables: metal vs marked, corrected rows, EGC quarter column ─
  const tables = await page.evaluate(() => ({
    metal: [...document.querySelectorAll('#bfBoxTable tr')].map((tr) => [...tr.children].map((td) => td.textContent)),
    marked: document.querySelectorAll('#bfMarkedTable tr').length,
    egc12: (() => { const tr = [...document.querySelectorAll('#bfRefTable tr')].find((r) => r.children[0].textContent === '#12 AWG'); return tr && tr.children[4] ? tr.children[4].textContent : null; })(),
    hdr: [...document.querySelectorAll('#panel-boxfill th')].map((th) => th.textContent) }));
  check('reference: metal table holds only Table 314.16(A) rows with corrected volumes; presets are separate', tables.metal.length === 16 && tables.marked === 11 && tables.metal.some((r) => r[0] === '4" Square 1-1/2"' && r[1] === '21.0') && tables.metal.some((r) => r[0] === '4" Octagon 2-1/8"' && r[1] === '21.5'));
  check('reference: "Clamp/EGC (x1)" is gone; quarter-allowance column present (#12 = 0.5625)', !tables.hdr.some((h) => /Clamp\/EGC/.test(h)) && tables.egc12 === '0.5625 in³', tables.egc12);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  check('external network blocked before load (' + blocked + ' aborted)', true);
  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log('EC-CALC-1 / EC-CALC-1B Box Fill browser check — ' + target);
  for (const r of results) console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  [' + (r.detail || '') + ']'));
  console.log(fails.length ? fails.length + ' of ' + results.length + ' CHECKS FAILED' : 'ALL ' + results.length + ' CHECKS PASSED');
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(3); });
