'use strict';
/**
 * EC-UI-LAYOUT-REFS-1 — source-aware code references (Node layer).
 *
 * Every function below is the SHIPPED one, extracted verbatim from mobile.html
 * (never a copied "safe" renderer). Real Chromium checks (computed colours,
 * keyboard activation, one send with the real necLink route, rerenders) live
 * in tools/ui-layout-refs-check-mobile.js; this file is the fast, always-on
 * layer for the pure helpers, the generated markup, the delegated handler and
 * the Load Calc two-target rendering.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildHarness, fnBody, html } = require('./helpers/loadCalcDom');

const editions = (html.match(/var EC_NEC_EDITION = '[^']+', EC_NYCEC_EDITION = '[^']+';/) || [''])[0] + (html.match(/var EC_REF_TOKEN_RE = .*;/) || [''])[0];
const layer = new Function(editions + ['necRefInfo', 'necQuestion', 'refAttr', 'refSpanHtml', 'refSpanFromText', 'refLinkifyHtml', 'necify', 'escapeHtml', 'inlineFormat', 'mtRow', 'gndRow'].map(fnBody).join('\n') + '; return { necRefInfo, necQuestion, refAttr, refSpanHtml, refSpanFromText, refLinkifyHtml, necify, inlineFormat, escapeHtml, mtRow, gndRow };')();   // eslint-disable-line no-new-func
const ORANGE = 'var(--nec)'; const BLUE = 'var(--nycec)';
const tagsOf = (out) => out.match(/<[a-zA-Z][^>]*>/g) || [];

describe('UI-REFS — necRefInfo / necQuestion: exact source, edition and section', () => {
  test('legacy one-argument strings derive their source from the text; NYCEC never degrades to a generic NEC question', () => {
    const nec = layer.necRefInfo('NEC 314.16 — Box Fill Calculations');
    assert.deepStrictEqual([nec.source, nec.edition, nec.section, nec.title], ['nec', '2020', '314.16', 'Box Fill Calculations']);
    assert.ok(/^Explain NEC 2020 \(National Electrical Code, 2020 edition, NFPA 70\) Section 314\.16 — Box Fill Calculations in detail\./.test(layer.necQuestion(nec)) && /NYCEC 2025 amends this section/.test(layer.necQuestion(nec)));
    const nyc = layer.necRefInfo('NYCEC 334.12 — NM Cable not permitted in buildings exceeding 3 floors');
    assert.deepStrictEqual([nyc.source, nyc.edition, nyc.section], ['nycec', '2025', '334.12']);
    assert.ok(/^Explain the NYCEC 2025 \(New York City Electrical Code, 2025 edition, which adopts NEC 2020 with local amendments\) amendment to NEC Section 334\.12 — NM Cable/.test(layer.necQuestion(nyc)) && /compared with the base NEC 2020 text/.test(layer.necQuestion(nyc)));
    assert.strictEqual(layer.necRefInfo('NEC 314.16 — NYC 2025 Electrical Code adopts NEC 2020 with no amendment to 314.16').source, 'nec', 'a NEC section whose title merely mentions NYC stays a NEC target');
    assert.strictEqual(layer.necRefInfo('NEC 220.87(2) as amended by NYCEC 2025 — Load Calc').source, 'nycec');
  });
  test('several sections, tables, articles and chapters keep their full citation; explicit opts win', () => {
    assert.ok(/NFPA 70\) 310\.15 and 310\.16 — Ampacity Calculations in detail/.test(layer.necQuestion(layer.necRefInfo('NEC 310.15 and 310.16 — Ampacity Calculations'))));
    assert.ok(/NFPA 70\) Table 314\.16\(A\) — Metal Boxes/.test(layer.necQuestion(layer.necRefInfo('NEC Table 314.16(A) — Metal Boxes minimum volumes'))));
    assert.ok(/NFPA 70\) Article 250 — Grounding in detail/.test(layer.necQuestion(layer.necRefInfo('NEC Article 250 — Grounding'))));
    assert.ok(/NFPA 70\) Chapter 9 Tables 1,4,5 — Conduit Fill rules/.test(layer.necQuestion(layer.necRefInfo('NEC Chapter 9 Tables 1,4,5 — Conduit Fill rules'))));
    assert.ok(/amendment to NEC 210\.19\(A\) and 215\.2\(A\)\(1\) — NYC voltage drop/.test(layer.necQuestion(layer.necRefInfo('NYCEC 210.19(A) and 215.2(A)(1) — NYC voltage drop is a mandatory 5% total limit'))));
    const ex = layer.necRefInfo('anything', { source: 'nycec', section: '220.87(2)', title: 'Load Calc' });
    assert.ok(/amendment to NEC Section 220\.87\(2\) — Load Calc in detail/.test(layer.necQuestion(ex)));
    assert.strictEqual(layer.necRefInfo('NEC 210.8(A)(1)').section, '210.8(A)(1)');
  });
  test('edition-level questions (header badges): independent destinations, no rule switch language', () => {
    const a = layer.necQuestion(layer.necRefInfo('NYCEC 2025 — New York City Electrical Code, 2025 edition', { source: 'nycec', kind: 'edition' }));
    const b = layer.necQuestion(layer.necRefInfo('NEC 2020 — National Electrical Code, 2020 edition', { source: 'nec', kind: 'edition' }));
    assert.ok(/^Explain the NYCEC 2025 \(New York City Electrical Code, 2025 edition/.test(a) && /Department of Buildings/.test(a) && /Do not recompute anything/.test(a));
    assert.ok(/^Explain the NEC 2020 \(National Electrical Code, 2020 edition, NFPA 70\)/.test(b) && /NYCEC 2025 amendments/.test(b) && /Do not recompute anything/.test(b));
    assert.notStrictEqual(a, b);
    assert.ok(/^Explain the NYCEC 2025/.test(layer.necQuestion(layer.necRefInfo('NYCEC 2025 — New York City Electrical Code current edition amendments and local requirements'))), 'a NYCEC reference without a section is an edition-level question, never "amendment to NEC <prose>"');
  });
});

describe('UI-REFS — generated markup: one pass, attribute-escaped, no inline handlers', () => {
  test('refSpanHtml: class by source, data attributes, escaped values, no on* attribute', () => {
    const out = layer.refSpanHtml('nycec', '210.19(A)', 'NYCEC 210.19(A)', 'NYCEC 210.19(A) — x"y<z>&');
    assert.ok(out.startsWith('<span class="nycec-link" role="button" tabindex="0" data-ref="NYCEC 210.19(A) — x&quot;y&lt;z&gt;&amp;" data-src="nycec" data-ed="2025" data-sec="210.19(A)"'), out);
    assert.ok(!/onclick|onkey/.test(out));
    assert.ok(/^<span class="nec-link" /.test(layer.refSpanHtml('nec', '250.50', 'NEC 250.50', 'NEC 250.50')));
    assert.ok(/^<span class="nec-link" /.test(layer.refSpanFromText('NEC 406.4(D) — receptacle replacements')) && /^<span class="nycec-link" /.test(layer.refSpanFromText('NYCEC 210.19(A) — voltage drop')));
  });
  test('necify: NYCEC blue, NEC orange, Article orange, single pass (generated markup is never re-matched); inert unknown text', () => {
    const out = layer.necify('See NEC 210.8(A)(1), NYCEC 210.19(A) and Article 680; NECESSARY text and NYC 2025 stay inert.');
    const tags = tagsOf(out);
    assert.strictEqual(tags.length, 3, out);
    assert.ok(/^<span class="nec-link" role="button" tabindex="0" data-ref="NEC 210\.8\(A\)\(1\)" data-src="nec" data-ed="2020" data-sec="210\.8\(A\)\(1\)"/.test(tags[0]));
    assert.ok(/^<span class="nycec-link" role="button" tabindex="0" data-ref="NYCEC 210\.19\(A\)" data-src="nycec" data-ed="2025" data-sec="210\.19\(A\)"/.test(tags[1]));
    assert.ok(/data-ref="NEC Article 680" data-src="nec"/.test(tags[2]) && />Article 680<\/span>/.test(out));
    assert.ok(out.includes('NECESSARY text and NYC 2025 stay inert') && tags.every((t) => !/\son\w+=/i.test(t)));
    assert.strictEqual((out.match(/<span/g) || []).length, (out.match(/<\/span>/g) || []).length, 'no nested or unbalanced links');
  });
  test('inlineFormat (AI messages): escaped text, source-aware spans, malicious text cannot create a handler or a tag', () => {
    const out = layer.inlineFormat('per NEC 210.52(C) and NYCEC 220.14(N) <img src=x onerror="x">');
    assert.ok(out.includes('&lt;img src=x onerror="x"&gt;') && !/<img/.test(out));
    assert.ok(/<span class="nec-link"[^>]*data-sec="210\.52\(C\)"/.test(out) && /<span class="nycec-link"[^>]*data-sec="220\.14\(N\)"/.test(out));
    for (const evil of ['NEC 3.1\'); alert(1);(\'', 'NEC 3.1"onclick="x', 'NYCEC 3.1<svg onload=1>', 'NEC 3.1&quot;onclick=&quot;x']) {
      const o = layer.inlineFormat(evil);
      assert.ok(tagsOf(o).every((t) => !/\son\w+=/i.test(t)), evil + ' -> ' + o);
      assert.ok((o.match(/data-(?:ref|sec)="[^"]*"/g) || []).every((a) => /^data-(?:ref|sec)="(?:NYCEC |NEC )?[\d.\w()]+"$/.test(a)), o);
      assert.ok(!/<(img|svg|script)/.test(o));
    }
  });
});

describe('UI-REFS — Load Calc: two separate targets for an amended reference, inert user text, delegated single send', () => {
  function annual(h) { h.api.lcInit(); for (const [id, v] of [['lcOccupancy', 'dwelling_unit_house'], ['lcMethod', 'measured_220_87'], ['lcTopology', '1ph_3w_120_240'], ['lcModel', 'split_240_all_LL'], ['lcBasis', 'annual_max_demand'], ['lcReadingValue', '40000'], ['lcAnnualData', 'yes'], ['lcPeriodMonths', '12'], ['lcServiceRatingA', '225'], ['lcServiceOverload', 'yes'], ['lcNewLoadMode', 'none']]) h.set(id, v); }
  const links = (h) => h.nodes().filter((n) => n._classes.has('nec-link') || n._classes.has('nycec-link'));
  test('lcRich: "220.87 (NYC 2025 amended)" -> orange 220.87 + blue "(NYC 2025 amended)"; "as amended by NYCEC 2025" -> blue phrase; a bare 220.87(2) gets a compact blue "NYC 2025" target; 230.90 / 240.4 / 220.61 stay NEC-only; every link has data-ref/data-src and NO per-element listener', () => {
    const h = buildHarness(); annual(h);
    const all = links(h); assert.ok(all.length >= 12, String(all.length));
    assert.ok(all.every((n) => typeof n.attrs['data-ref'] === 'string' && (n.attrs['data-src'] === 'nec') === n._classes.has('nec-link') && (n.attrs['data-src'] === 'nycec') === n._classes.has('nycec-link') && (n.listeners.click || []).length === 0 && n.attrs.onclick === undefined && n.attrs.role === 'button' && n.attrs.tabindex === '0'));
    const phrase = all.find((n) => n.textContent === '(NYC 2025 amended)'); assert.ok(phrase && phrase._classes.has('nycec-link') && phrase.attrs['data-sec'] === '220.87');
    const asAmended = all.find((n) => n.textContent === 'as amended by NYCEC 2025'); assert.ok(asAmended && asAmended._classes.has('nycec-link'));
    const compact = all.filter((n) => n._classes.has('lc-ref-amend')); assert.ok(compact.length >= 1 && compact.every((n) => n._classes.has('nycec-link') && n.textContent === 'NYC 2025' && /^220\.87/.test(n.attrs['data-sec'])), 'compact NYC 2025 targets only on 220.87 references');
    for (const sec of ['230.90', '240.4', '220.61']) { const n = all.filter((x) => x.attrs['data-sec'] === sec); assert.ok(n.length >= 1 && n.every((x) => x._classes.has('nec-link')), sec + ' is NEC-only'); }
    // a pair inside one text run: the orange and blue targets are siblings, never nested
    assert.ok(!all.some((n) => n.parent && (n.parent._classes.has('nec-link') || n.parent._classes.has('nycec-link'))), 'no link nested in a link');
  });
  test('rule-basis pairs and problem rows: NEC 2020 target plus NYCEC 2025 amendment target when the engine marks the reference amended', () => {
    const h = buildHarness(); annual(h);
    const pairs = h.nodes().filter((n) => n._classes.has('lc-ref-pair'));
    assert.ok(pairs.length >= 2, 'demand lines / capacity / rule basis');
    for (const p of pairs) { const kids = p.children.filter((c) => c.tagName === 'SPAN'); assert.ok(kids[0]._classes.has('nec-link') && /^NEC 2020 /.test(kids[0].textContent)); if (kids[1]) assert.ok(kids[1]._classes.has('nycec-link') && kids[1].textContent === 'NYCEC 2025 amendment' && kids[1].attrs['data-sec'] === kids[0].attrs['data-sec']); }
    assert.ok(pairs.some((p) => p.children.filter((c) => c.tagName === 'SPAN').length === 2), 'the amended 220.87(2) reference renders both targets');
  });
  test('activation is delegated: a click on the orange target prepares the NEC 2020 question, the blue one the NYCEC 2025 amendment question; a keydown Enter/Space activates; Escape/other keys do not; a nested load label with "NEC 220.87 <b>x</b>" is inert text', () => {
    const h = buildHarness(); annual(h);
    h.$('lcPresetName').value = '0'; h.$('lcPresetVA').value = '12000'; h.$('lcAddLoad').dispatch('click');
    const lbl = h.$('lcLoads').querySelector('input[type=text]'); lbl.value = 'NEC 220.87 <b>x</b> NYCEC 210.19'; lbl.dispatch('input');
    const all = links(h);
    assert.ok(!all.some((n) => /<b>|NYCEC 210\.19/.test(n.attrs['data-ref'])), 'no link built from user text'); assert.strictEqual(h.state().snapshot.loads[0].label, 'NEC 220.87 <b>x</b> NYCEC 210.19');
    const orange = all.find((n) => n._classes.has('nec-link') && n.attrs['data-sec'] === '220.87(2)'); const blue = all.find((n) => n._classes.has('nycec-link') && n.attrs['data-sec'] === '220.87(2)');
    orange.dispatch('click'); assert.strictEqual(h.necCallsFull.length, 1); assert.ok(/^Explain NEC 2020 \(National Electrical Code, 2020 edition, NFPA 70\) Section 220\.87\(2\) — Load Calc, existing service or feeder capacity \(220\.87\) in detail/.test(h.necCallsFull[0].question), h.necCallsFull[0].question);
    blue.dispatch('click'); assert.strictEqual(h.necCallsFull.length, 2); assert.ok(/^Explain the NYCEC 2025 \(New York City Electrical Code, 2025 edition, which adopts NEC 2020 with local amendments\) amendment to NEC Section 220\.87\(2\) — Load Calc/.test(h.necCallsFull[1].question), h.necCallsFull[1].question);
    blue.dispatch('keydown', { key: 'Enter' }); orange.dispatch('keydown', { key: ' ' }); assert.strictEqual(h.necCallsFull.length, 4);
    blue.dispatch('keydown', { key: 'Escape' }); blue.dispatch('keydown', { key: 'a' }); assert.strictEqual(h.necCallsFull.length, 4);
    for (let i = 0; i < 25; i++) h.api.lcUpdate();   // rerenders: the delegated handler is installed once; a fresh link still fires exactly once
    links(h).find((n) => n._classes.has('nec-link') && n.attrs['data-sec'] === '230.90').dispatch('click'); assert.strictEqual(h.necCallsFull.length, 5);
    assert.strictEqual((h.dom.document.listeners.capture.click || []).length, 1); assert.strictEqual((h.dom.document.listeners.capture.keydown || []).length, 1);
  });
});

describe('UI-REFS — necLink route (EC-02): a reference opens the source panel, never AI Chat or a key prompt', () => {
  // Was: "one prepared question, exactly one send". That route switched to the legacy chat and, with no stored provider
  // key, ended in the "API Key Required" modal with no exit (audit E08/C1A–C1B). The SHIPPED necLink / ecSourceOpen /
  // ecSourceClose run here; reaching sendMessage, the network, the chat input, the chat panel or the key modal fails.
  test('legacy string and explicit opts open the panel with the exact citation and official links; Close returns focus; nothing else is touched', () => {
    const touched = []; let doc = null;
    const mk = (tag) => ({ tagName: tag, nodeType: 1, tabIndex: -1, children: [], style: {}, attrs: {}, textContent: '', focused: 0, appendChild(c) { this.children.push(c); return c; }, removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; }, get firstChild() { return this.children[0] || null; }, focus() { this.focused++; doc.activeElement = this; }, setAttribute(k, v) { this.attrs[k] = String(v); }, hasAttribute(k) { return Object.hasOwn(this.attrs, k); } });
    const byId = { ecSourcePanel: mk('div'), ecSourceBody: mk('div'), ecSourceTitle: mk('h2'), ecSourceClose: mk('button') };
    doc = { activeElement: null, body: mk('body'), createElement: mk, contains: () => true, getElementById: (id) => { if (!byId[id]) { touched.push(id); return null; } return byId[id]; } };
    const moves = []; const history = { state: null, pushState(s) { moves.push(s); this.state = s; }, back() { moves.push('back'); this.state = null; } };
    const src = editions + fnBody('necRefInfo') + fnBody('necLink') + 'var EC_SOURCE = { open: false, returnTo: null, pushed: false };' + fnBody('ecSourceOpen') + fnBody('ecSourceClose') + '; return { necLink, ecSourceClose };';
    const api = new Function('document', 'EC', 'history', 'sendMessage', 'fetch', src)(doc, { codeSources: require('../src/refs/codeSources') }, history, () => { throw new Error('sendMessage reached'); }, () => { throw new Error('network reached'); });   // eslint-disable-line no-new-func
    const trigger = mk('span');
    api.necLink('NYCEC 210.19(A) and 215.2(A)(1) — NYC mandatory 5% total voltage drop limit', undefined, trigger);
    assert.strictEqual(byId.ecSourcePanel.style.display, 'flex');
    assert.strictEqual(byId.ecSourceTitle.textContent, 'NYCEC 2025 amendment — NEC 210.19(A) and 215.2(A)(1)');
    const text = byId.ecSourceBody.children.map((c) => c.textContent).join('\n');
    assert.ok(/New York City amendment to NEC 2020 210\.19\(A\) and 215\.2\(A\)\(1\)\./.test(text), text);
    assert.ok(/Cited in this app for: NYC mandatory 5% total voltage drop limit/.test(text) && /not included in Empire Code/.test(text) && /no explanation is generated/.test(text));
    const links = byId.ecSourceBody.children.filter((c) => c.tagName === 'a');
    assert.ok(links.length === 3 && links.every((a) => /^https:\/\/www\.(nyc\.gov|nfpa\.org)\//.test(a.href) && a.target === '_blank' && a.rel === 'noopener noreferrer'), JSON.stringify(links.map((a) => a.href)));
    assert.strictEqual(links[0].href, 'https://www.nyc.gov/site/buildings/codes/electrical-code.page', 'a NYCEC reference lists the NYC source first');
    assert.deepStrictEqual(touched, [], 'the chat input, chat panel and key modal are never looked up'); assert.strictEqual(byId.ecSourceClose.focused, 1, 'focus moves into the dialog');
    api.necLink('NEC 314.16 — Box Fill', { source: 'nec', section: '314.16', title: 'Box Fill' }, mk('span'));   // a second reference while open replaces the content
    assert.strictEqual(byId.ecSourceTitle.textContent, 'NEC 2020 — Section 314.16'); assert.strictEqual(moves.length, 1, 'still one history entry');
    assert.ok(byId.ecSourceBody.children.every((c) => !/215\.2/.test(c.textContent)), 'the earlier reference is not left in the panel');
    api.ecSourceClose();
    assert.strictEqual(byId.ecSourcePanel.style.display, 'none'); assert.strictEqual(trigger.focused, 1, 'focus returns to the reference that opened the panel');
    assert.deepStrictEqual(moves, [{ ecSourcePanel: true }, 'back'], 'the panel history entry is unwound, nothing else');
    api.ecSourceClose(); assert.strictEqual(moves.length, 2, 'closing twice is a no-op');
  });
  test('static inventory, both shipped pages: no reference route reaches the legacy chat, provider or key prompt; the panel is an accessible dialog; hosted entry points are guarded', () => {
    for (const name of ['necLink', 'ecSourceOpen', 'ecSourceClose', 'installRefDelegation']) assert.ok(!/sendMessage|userInput|apiModal|panel-chat|necQuestion|switchTab|fetch\(|localStorage/.test(fnBody(name)), name);
    const hosted = path.join(__dirname, '..', '..', 'candidate', 'browser', 'workspace', 'mobile.html');
    for (const file of [path.join(__dirname, '..', 'mobile.html'), hosted].filter((f) => fs.existsSync(f))) {
      const page = fs.readFileSync(file, 'utf8');
      assert.ok(/<div class="modal-overlay" id="ecSourcePanel" style="display:none;z-index:10000" role="dialog" aria-modal="true" aria-labelledby="ecSourceTitle" aria-describedby="ecSourceBody">/.test(page), file);
      assert.ok(page.includes('<button class="modal-btn" type="button" id="ecSourceClose" onclick="ecSourceClose()">CLOSE</button>'), file);
      assert.ok(!page.includes('necLinkPending') && !/input\.value = necQuestion\(/.test(page), file + ': the chat hand-off is removed from the reference route');
      assert.strictEqual((page.match(/\bnecQuestion\(/g) || []).length, 2, file + ': necQuestion is only its own definition and its internal edition fallback — nothing calls it');
      assert.ok(page.includes("if (!API_KEY) { if (window.ecHostBridge) return;"), file + ': the hosted build never opens the key prompt');
      assert.ok(page.includes("if (window.ecHostBridge) { ecSourceOpen(necRefInfo(String(item.codeRef.code) + ' ' + String(item.codeRef.section)), document.activeElement); return; }"), file + ': hosted Pull Box code references open the source panel');
      assert.ok(page.includes("if (window.ecHostBridge) return;   // EC-02: a hosted tap is never routed into the legacy chat / key prompt"), file + ': hosted outlet cards do not open the legacy chat');
      assert.ok(page.includes('id="apiModalCancel" onclick="ecApiModalClose()"'), file + ': the legacy key prompt can be dismissed');
      assert.ok(/ev\.key === 'Escape'[\s\S]{0,200}ecSourceClose\(\)/.test(page) && /addEventListener\('popstate', function \(\) \{ if \(EC_SOURCE\.open\) ecSourceClose\(true\); \}\)/.test(page), file + ': Escape and Back close the panel');
    }
  });
});

describe('UI-REFS — shipped markup and styles', () => {
  test('header badges are separate keyboard/touch entry points with independent, edition-level destinations and no inline handler; classes and colours unchanged', () => {
    const header = html.match(/<header>([\s\S]*?)<\/header>/)[1];
    assert.ok(/class="edition edition-nycec" role="button" tabindex="0" data-ref="NYCEC 2025 — [^"]+" data-src="nycec" data-ed="2025" data-kind="edition" aria-label="[^"]+">NYCEC 2025</.test(header));
    assert.ok(/class="edition edition-nec" role="button" tabindex="0" data-ref="NEC 2020 — [^"]+" data-src="nec" data-ed="2020" data-kind="edition" aria-label="[^"]+">NEC 2020</.test(header));
    assert.ok(!/onclick=/.test(header));
    assert.ok(/\.edition-nycec\s*\{[^}]*var\(--nycec\)/.test(html) && /\.edition-nec\s*\{[^}]*var\(--nec\)/.test(html));
    assert.ok(/\.edition\[role="button"\]:focus-visible/.test(html) && /\.edition\[role="button"\]\s*\{\s*cursor: pointer;/.test(html));
  });
  test('link tokens: .nec-link orange, .nycec-link blue, underline kept, hover/active same hue, focus-visible outline; a NYCEC pill stays blue', () => {
    assert.ok(/\.nec-link \{ color: var\(--nec\); \}/.test(html) && /\.nycec-link \{ color: var\(--nycec\); \}/.test(html));
    assert.ok(/\.nec-link, \.nycec-link \{ text-decoration: underline;/.test(html));
    assert.ok(/\.nec-link:hover, \.nec-link:active \{ color: #ff8a4d; \}/.test(html) && /\.nycec-link:hover, \.nycec-link:active \{ color: #7ab8ff; \}/.test(html));
    assert.ok(/\.nec-link:focus-visible, \.nycec-link:focus-visible, \.edition\[role="button"\]:focus-visible \{ outline: 2px solid currentColor;/.test(html));
    assert.ok(/\.pill-nyc \{[^}]*var\(--nycec\)/.test(html) && /\.pill-nec \{[^}]*var\(--nec\)/.test(html));
    assert.ok(/\.ec-coderef\[data-src="nec"\]\{[^}]*var\(--nec\)/.test(html) && /\.ec-coderef\[data-src="nycec"\]\{[^}]*var\(--nycec\)/.test(html), 'Pull Box structured buttons follow the convention');
  });
  test('inventory: no JavaScript-built reference markup uses an inline onclick string any more; static NYCEC pills call necLink with a NYCEC-prefixed text (derived source); the delegated handler is installed once', () => {
    for (const name of ['necify', 'inlineFormat', 'refSpanHtml', 'refSpanFromText', 'refSpanNode', 'lcRefNode', 'lcRefLink', 'lcRich', 'renderOutlets', 'groundingSelectTopic', 'nycSelectTopic']) assert.ok(!/onclick=\\?"necLink/.test(fnBody(name)), name + ' builds no inline necLink handler');
    assert.ok(/onclick="necLink\('NYCEC 334\.12 — /.test(html) && /onclick="necLink\('NYCEC 210\.19\(A\) and 215\.2\(A\)\(1\) — /.test(html), 'static pills keep their legacy calls (source derived from the NYCEC prefix)');
    assert.strictEqual((html.match(/function installRefDelegation\(\)/g) || []).length, 1);
    assert.ok(/window\.__ecRefDelegation/.test(fnBody('installRefDelegation')) && /addEventListener\('click'/.test(fnBody('installRefDelegation')) && /addEventListener\('keydown'/.test(fnBody('installRefDelegation')));
    const layerPos = html.indexOf('// ── CODE REFERENCE LINK SYSTEM'); assert.ok(layerPos > 0 && layerPos < html.indexOf('function inlineFormat(') && layerPos < html.indexOf("var ref = function (label, cite) { var info = necRefInfo"), 'the shared layer is defined before its first callers (script order)');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', 'ui-layout-refs-1.md')));
  });
});

describe('UI-r1 R-UI-01 — compound citations keep every displayed section', () => {
  const attrs = (h) => Object.fromEntries([...h.matchAll(/ (data-[a-z]+|title)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  test('refSpanFromText: a compound head ("210.8(A)(5) / 210.8(A)(7)", "250.4(A) and 250.4(B)") carries no single data-sec, its title shows the whole head, and the delegate-derived question names every section (candidate before: only the first section)', () => {
    for (const [refText, a, z] of [['NEC 210.8(A)(5) / 210.8(A)(7) — Boiler room', '210.8(A)(5)', '210.8(A)(7)'], ['NEC 680.22(A) / 680.74 — Pool', '680.22(A)', '680.74'], ['NEC 250.4(A) and 250.4(B) — Purpose', '250.4(A)', '250.4(B)']]) {
      const html = layer.refSpanFromText(refText, refText); const at = attrs(html);
      assert.strictEqual(at['data-sec'], undefined, refText + ': no truncating data-sec'); assert.strictEqual(at['data-ref'], refText); assert.ok(at.title.includes(a) && at.title.includes(z), at.title);
      // what the delegated handler passes: data-ref, data-src, data-ed, (no data-sec) -> necRefInfo re-derives the full head
      const q = layer.necQuestion(layer.necRefInfo(at['data-ref'], { source: at['data-src'], edition: at['data-ed'] }));
      assert.ok(q.includes(a) && q.includes(z) && /^Explain NEC 2020 /.test(q), q);
    }
    const single = attrs(layer.refSpanFromText('NEC 406.4(D) — receptacle replacements')); assert.strictEqual(single['data-sec'], '406.4(D)', 'a single section keeps its data-sec');
  });
});

describe('UI-r1 R-UI-02 — explicit current-edition and mixed-source forms; visible app-authored citations', () => {
  const spans = (h) => [...h.matchAll(/<span class="(nec-link|nycec-link)"[^>]*data-ref="([^"]*)"[^>]*data-sec="([^"]*)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({ cls: m[1], ref: m[2], sec: m[3], text: m[4] }));
  test('"NEC 2020 220.87(2) and NYCEC 2025 220.87(2)" -> two targets (orange NEC 2020, blue NYCEC 2025), both Section 220.87(2) (candidate before: 0 links)', () => {
    const out = layer.refLinkifyHtml('NEC 2020 220.87(2) and NYCEC 2025 220.87(2)'); const sp = spans(out);
    assert.deepStrictEqual(sp.map((x) => [x.cls, x.sec, x.text]), [['nec-link', '220.87(2)', 'NEC 2020 220.87(2)'], ['nycec-link', '220.87(2)', 'NYCEC 2025 220.87(2)']]);
    assert.ok(/^Explain NEC 2020 .* Section 220\.87\(2\) in detail/.test(layer.necQuestion(layer.necRefInfo(sp[0].ref, { source: 'nec', section: sp[0].sec }))));
    assert.ok(/^Explain the NYCEC 2025 .* amendment to NEC Section 220\.87\(2\) in detail/.test(layer.necQuestion(layer.necRefInfo(sp[1].ref, { source: 'nycec', section: sp[1].sec }))));
  });
  test('"NEC 220.87(2) as amended by NYCEC 2025" -> orange NEC target + a separate blue target on the amendment phrase; "(NYC 2025 amended)" likewise; the phrase keeps its leading space outside the link (candidate before: NEC only)', () => {
    const out = layer.refLinkifyHtml('NEC 220.87(2) as amended by NYCEC 2025.'); const sp = spans(out);
    assert.deepStrictEqual(sp.map((x) => [x.cls, x.sec, x.text]), [['nec-link', '220.87(2)', 'NEC 220.87(2)'], ['nycec-link', '220.87(2)', 'as amended by NYCEC 2025']]);
    assert.ok(/<\/span> <span class="nycec-link"/.test(out) && out.endsWith('</span>.'), out);
    assert.ok(/amendment to NEC Section 220\.87\(2\)/.test(layer.necQuestion(layer.necRefInfo(sp[1].ref, { source: 'nycec', section: sp[1].sec }))));
    assert.deepStrictEqual(spans(layer.refLinkifyHtml('NEC 220.87 (NYC 2025 amended) applies')).map((x) => [x.cls, x.text]), [['nec-link', 'NEC 220.87'], ['nycec-link', '(NYC 2025 amended)']]);
  });
  test('no inference: a bare NEC number gets no NYC target; other edition years (NEC 2023, NYCEC 2020) stay plain text; a sentence-ending period is not part of the section; the simple positive control is unchanged', () => {
    assert.deepStrictEqual(spans(layer.refLinkifyHtml('per NEC 220.87(2) only')).map((x) => x.cls), ['nec-link']);
    assert.strictEqual(layer.refLinkifyHtml('NEC 2023 210.8 and NYCEC 2020 210.19'), 'NEC 2023 210.8 and NYCEC 2020 210.19');
    assert.deepStrictEqual(spans(layer.refLinkifyHtml('see NEC 680.26. Next')).map((x) => [x.sec, x.text]), [['680.26', 'NEC 680.26']]); assert.ok(layer.refLinkifyHtml('see NEC 680.26. Next').includes('</span>. Next'));
    assert.deepStrictEqual(spans(layer.refLinkifyHtml('NEC 210.8(A)(1) and NYCEC 220.14(N)')).map((x) => [x.cls, x.sec]), [['nec-link', '210.8(A)(1)'], ['nycec-link', '220.14(N)']]);
    assert.deepStrictEqual(spans(layer.refLinkifyHtml('NEC Table 430.250 — 10 HP')).map((x) => [x.cls, x.sec, x.text]), [['nec-link', 'Table 430.250', 'NEC Table 430.250']]);
    assert.strictEqual(layer.inlineFormat('NEC 2020 220.87(2) as amended by NYCEC 2025 <b>x</b>').match(/<span class="(nec|nycec)-link"/g).length, 2); assert.ok(layer.inlineFormat('<b>x</b>').includes('&lt;b&gt;'));
  });
  test('visible app-authored citations are targets: Ampacity title / temp-correction title (static markup), the Max Breaker note (NEC 240.4(B)), Wireway title, Motor and Grounding-calc row notes (necify), GFCI NYC text and CODE bodies (necify) — the numeric rules are untouched', () => {
    assert.ok(/AMPACITY — <span class="nec-link" role="button" tabindex="0" data-ref="NEC 310\.15 — [^"]+" data-src="nec" data-ed="2020" data-sec="310\.15"/.test(html));
    assert.ok(/TEMP CORRECTION — <span class="nec-link" role="button" tabindex="0" data-ref="NEC 310\.15\(B\)\(1\) — [^"]+" data-src="nec" data-ed="2020" data-sec="310\.15\(B\)\(1\)"/.test(html));
    const amp = fnBody('ampUpdateCalc'); assert.ok(/var breakerNote = isDerating \? ' \(derated — protect at or below\)' : ' \(' \+ refSpanFromText\('NEC 240\.4\(B\) — [^']+', 'NEC 240\.4\(B\)'\) \+ '\)';/.test(amp), 'breaker note is a target');
    assert.ok(/WIREWAY FILL — ' \+ refSpanFromText\('NEC 376\.22 — /.test(html));
    assert.ok(spans(layer.mtRow('Overload setting', 'x', 'NEC 430.32 uses the nameplate, not the table')).length === 1 && spans(layer.gndRow('Base EGC', '8', 'NEC Table 250.122 — from the 100 A device', 'x')).length === 1);
    assert.ok(/necify\(data\.nyc\)/.test(fnBody('gfciUpdate')) && /necify\(sec\.heading\)/.test(fnBody('groundingSelectTopic')) && /necify\(sec\.content\)/.test(fnBody('groundingSelectTopic')) && /necify\(item\.content\)/.test(fnBody('nycSelectTopic')));
    assert.ok(!/necify\(/.test(fnBody('lcBuildLoadCard')) && !/necify\(|refLinkifyHtml\(/.test(fnBody('lcNote')), 'user-supplied Load Calc text never reaches the linkifier');
  });
});
