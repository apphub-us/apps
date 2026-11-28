'use strict';
/**
 * CONVERTER-WH-1 — executes the SHIPPED "Wh / Runtime" adapter of a mobile.html against a stub DOM.
 *
 * The functions are extracted verbatim from the given file and run on the engine injected into that same
 * file, so the suite proves what the page does, not what this helper thinks it does. Initial field values
 * are read from the static markup. Used for core/mobile.html (core suite) and for
 * candidate/browser/workspace/mobile.html (root suite) so both copies face identical expectations.
 */
const fs = require('node:fs');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const START = '<!-- EC-CALC:START';
const END = '<!-- EC-CALC:END -->';
const TOOLS = ['power', 'battery', 'torque', 'wire', 'temp', 'length'];
const FUNCTIONS = ['cvTool', 'cvGetVoltage', 'cvGetPF', 'cvGetPhase', 'cvCalc', 'cvRow', 'cvClear', 'cvReset', 'tqCalc',
  'btEsc', 'btTabKey', 'btRead', 'btFill', 'btSyncUnit', 'btCalc', 'btModeChanged', 'btExample', 'btReset'];

function bootEngine(html) {
  let block = html.slice(html.indexOf(START), html.indexOf(END));
  block = block.slice(block.indexOf('<script>') + 8, block.lastIndexOf('</script>'));
  const win = {};
  new Function('window', block)(win); // eslint-disable-line no-new-func
  return win.EC;
}

function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found in the shipped page: ' + name);
  let depth = 0; let started = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; } else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unterminated function: ' + name);
}

const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : null; };
const panelMarkup = (html) => { const s = html.indexOf('<div id="cvt-battery"'); return s < 0 ? '' : html.slice(s, html.indexOf('<!-- ══ TORQUE ══ -->', s)); };
const tabsMarkup = (html) => { const s = html.indexOf('id="cvToolTabs"'); return html.slice(s, html.indexOf('<div id="cvt-power">', s)); };

function buildHarness(html) {
  const EC = bootEngine(html);
  const hand = html.slice(html.indexOf(END));
  const panel = panelMarkup(html);
  const els = {};
  const node = (init) => Object.assign({
    value: '', textContent: '', innerHTML: '', placeholder: '', style: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
  }, init);
  const mk = (id, init) => (els[id] = node(init));

  for (const m of panel.matchAll(/<input\b[^>]*>/g)) mk(attr(m[0], 'id'), { value: attr(m[0], 'value') || '', placeholder: attr(m[0], 'placeholder') || '' });
  const options = [...(/<select id="bt-mode"[^>]*>([\s\S]*?)<\/select>/.exec(panel) || ['', ''])[1].matchAll(/<option value="([^"]*)"( selected)?>/g)];
  mk('bt-mode', { value: options.length ? (options.find((o) => o[2]) || options[0])[1] : '' });
  mk('bt-consumption-label', { textContent: (/id="bt-consumption-label"[^>]*>([^<]*)</.exec(panel) || ['', ''])[1] });
  mk('bt-status', { textContent: (/id="bt-status"[^>]*>([^<]*)</.exec(panel) || ['', ''])[1] });
  mk('bt-result', { style: { display: 'none' } });
  TOOLS.forEach((t) => mk('cvt-' + t, { style: { display: t === 'power' ? '' : 'none' } }));
  ['cv-amps', 'cv-watts', 'cv-kw', 'cv-va', 'cv-kva', 'cv-hp', 'cv-voltage-custom', 'cv-result', 'cv-result-rows', 'cv-voltage-custom-group',
    'tq-lbft', 'tq-lbin', 'tq-nm', 'tq-note'].forEach((id) => mk(id));
  mk('cv-voltage', { value: '208' }); mk('cv-phase', { value: '1' }); mk('cv-pf', { value: '0.85' });

  const tabs = [...tabsMarkup(html).matchAll(/<div class="conduit-tab( active)?"([^>]*)>([^<]*)<\/div>/g)].map((m) => {
    const t = node({ label: m[3], tool: (/cvTool\('([a-z]+)'/.exec(m[2]) || [])[1] });
    if (m[1]) t.classList.add('active');
    for (const a of m[2].matchAll(/\s([a-z-]+)="([^"]*)"/g)) t.attrs[a[1]] = a[2];
    if (t.attrs.id) els[t.attrs.id] = t;
    return t;
  });

  const document = { getElementById: (id) => els[id] || null, querySelectorAll: (sel) => (sel === '#cvToolTabs .conduit-tab' ? tabs : []) };
  const calls = { wcInit: 0, lnInitTable: 0 };
  const api = {};
  const source = 'var cvUpdating = false;\n' + (/var BT_FIELDS = \{[^}]*\};/.exec(hand) || [''])[0] + '\n'
    + FUNCTIONS.map((n) => fnBody(hand, n)).join('\n') + '\n' + FUNCTIONS.map((n) => 'api.' + n + ' = ' + n + ';').join('');
  // eslint-disable-next-line no-new-func
  new Function('document', 'EC', 'wcInit', 'lnInitTable', 'api', source)(document, EC, () => { calls.wcInit++; }, () => { calls.lnInitTable++; }, api);

  const h = {
    EC, els, tabs, api, calls, panel, source,
    tab: (tool) => tabs.find((t) => t.tool === tool),
    open: (tool) => api.cvTool(tool, h.tab(tool)),
    type: (id, text) => { els[id].value = text; api.btCalc(); }, //          what oninput="btCalc()" does
    mode: (value) => { els['bt-mode'].value = value; api.btModeChanged(); }, // what onchange="btModeChanged()" does
    shown: () => (els['bt-result'].style.display === 'none' ? null : els['bt-result'].innerHTML),
    status: () => (els['bt-status'].style.display === 'none' ? '' : els['bt-status'].textContent),
  };
  return h;
}

/** Registers the behavioural suite for one shipped file. */
function defineUiSuite(label, file) {
  const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const fresh = () => { const h = buildHarness(html); h.open('battery'); return h; };
  const hiddenAndExplained = (h, what) => {
    assert.strictEqual(h.shown(), null, what + ': a result is still visible');
    assert.strictEqual(h.els['bt-result'].innerHTML, '', what + ': stale result markup was kept');
    assert.ok(h.status().length > 10, what + ': no explanation shown');
    assert.ok(!/NaN|Infinity|undefined|null/.test(h.status()), what + ': raw value leaked into the message');
  };

  describe('CONVERTER-WH-1 — Wh / Runtime tab in ' + label, { skip: html ? false : 'file not found: ' + file }, () => {
    test('markup: tab sits next to Power, Power stays the default, fields are labelled 16px decimal text inputs with the required defaults', () => {
      const h = buildHarness(html);
      assert.deepStrictEqual(h.tabs.map((t) => t.tool), TOOLS, 'tab order');
      assert.strictEqual(h.tabs[1].label, 'Wh / Runtime');
      assert.deepStrictEqual(h.tabs.filter((t) => t.classList.contains('active')).map((t) => t.tool), ['power'], 'Power is the only active tab');
      assert.strictEqual(h.tabs[1].attrs.role, 'button'); assert.strictEqual(h.tabs[1].attrs.tabindex, '0');
      assert.ok(/^<div id="cvt-battery" style="display:none">/.test(h.panel), 'the new panel is hidden until its tab is chosen');
      assert.ok(/<div id="cvt-power">/.test(html), 'the Power panel is still the visible default');
      const inputs = [...h.panel.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
      assert.deepStrictEqual(inputs.map((t) => attr(t, 'id')), ['bt-capacity', 'bt-consumption', 'bt-charge', 'bt-usable']);
      for (const t of inputs) {
        assert.strictEqual(attr(t, 'type'), 'text'); assert.strictEqual(attr(t, 'inputmode'), 'decimal');
        assert.ok(/font-size:16px/.test(attr(t, 'style')), 'no iOS focus zoom: ' + attr(t, 'id'));
        assert.ok(new RegExp('<label [^>]*for="' + attr(t, 'id') + '"').test(h.panel), 'label for ' + attr(t, 'id'));
      }
      assert.ok(/<label [^>]*for="bt-mode"/.test(h.panel), 'label for the mode select');
      assert.deepStrictEqual(inputs.map((t) => attr(t, 'value')), [null, null, '100', '85'], 'capacity and consumption are blank; 100% / 85%');
      assert.deepStrictEqual(h.api.btRead(), { ...h.EC.batteryRuntime.DEFAULTS }, 'static markup and module defaults agree');
      assert.ok(/id="bt-status" role="status" aria-live="polite"/.test(h.panel));
      assert.strictEqual((h.panel.match(/<button type="button"/g) || []).length, 2, 'Example and Reset are real buttons');
      for (const phrase of ['How long will the battery last?', 'Power bank or power station', 'Battery capacity (Wh)', 'not the output power (W)',
        'Numbers without thousands separators: 1000. Decimals: 1.2 or 1,2.', 'kWh/day', 'kWh/year',
        'Example: refrigerator', 'are not the daily average', 'not a certified efficiency and not a universal constant',
        'a suitable AC output', 'continuous and start-up (surge) power', 'Wh alone do not confirm that the refrigerator will start']) {
        assert.ok(h.panel.includes(phrase), 'missing text: ' + phrase);
      }
      assert.ok(!/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(h.panel), 'the panel markup is English');
      assert.ok(!/mAh/.test(h.panel), 'no mAh conversion in this release');
      const adapter = h.source.slice(h.source.indexOf('function btEsc('));
      assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\./.test(adapter), 'the adapter is offline and stores nothing');
      assert.ok(!/[*/]\s*(24|365|8760|1000)\b|parseFloat|Number\(/.test(adapter), 'no formula or parsing in the adapter');
    });

    test('opening the tab shows only its panel, asks for the two blank values and shows no result; going back restores Power', () => {
      const h = buildHarness(html);
      h.open('battery');
      assert.deepStrictEqual(TOOLS.filter((t) => h.els['cvt-' + t].style.display !== 'none'), ['battery']);
      assert.strictEqual(h.tab('battery').attrs['aria-pressed'], 'true'); assert.ok(h.tab('battery').classList.contains('active'));
      assert.strictEqual(h.shown(), null);
      assert.ok(/battery capacity in Wh/.test(h.status()) && /consumption in W\./.test(h.status()), h.status());
      h.open('power');
      assert.deepStrictEqual(TOOLS.filter((t) => h.els['cvt-' + t].style.display !== 'none'), ['power']);
      assert.strictEqual(h.tab('battery').attrs['aria-pressed'], 'false'); assert.ok(!h.tab('battery').classList.contains('active'));
      h.open('wire'); h.open('length'); assert.deepStrictEqual(h.calls, { wcInit: 1, lnInitTable: 1 }, 'the other tools still initialise');
    });

    test('keyboard: Enter and Space open the tab, other keys do nothing', () => {
      for (const [key, opens] of [['Enter', true], [' ', true], ['a', false], ['Tab', false]]) {
        const h = buildHarness(html); let prevented = 0;
        h.api.btTabKey({ key, preventDefault() { prevented++; } }, h.tab('battery'));
        assert.strictEqual(h.els['cvt-battery'].style.display !== 'none', opens, JSON.stringify(key));
        assert.strictEqual(prevented, opens ? 1 : 0);
      }
    });

    test('W mode: 1000 Wh at 100 W gives 10 h at 100% usable and 8 h 30 min at the default 85%', () => {
      const h = fresh();
      h.type('bt-capacity', '1000'); assert.strictEqual(h.shown(), null, 'one field alone is not a result');
      h.type('bt-consumption', '100');
      assert.ok(h.shown().includes('About 8 h 30 min') && h.shown().includes('850 Wh') && h.shown().includes('100 W'), h.shown());
      assert.ok(h.shown().includes('1000 Wh × 100% × 85%') && h.shown().includes('usable energy 85%'), 'assumptions are visible in the result');
      assert.strictEqual(h.status(), '');
      h.type('bt-usable', '100'); assert.ok(h.shown().includes('About 10 h 0 min') && h.shown().includes('1000 Wh'));
      h.type('bt-charge', '50'); assert.ok(h.shown().includes('About 5 h 0 min') && h.shown().includes('500 Wh'));
    });

    test('changing the unit clears the typed consumption and the result instead of re-reading the number in the new unit', () => {
      const h = fresh();
      h.type('bt-capacity', '1000'); h.type('bt-consumption', '100'); assert.ok(h.shown());
      h.mode('kwh_day');
      assert.strictEqual(h.els['bt-consumption'].value, '', '100 W must not become 100 kWh/day');
      hiddenAndExplained(h, 'after a unit change'); assert.ok(/consumption in kWh\/day/.test(h.status()), h.status());
      assert.strictEqual(h.els['bt-consumption-label'].textContent, 'Consumption (kWh/day)'); assert.strictEqual(h.els['bt-consumption'].placeholder, 'kWh/day');
      assert.strictEqual(h.els['bt-capacity'].value, '1000', 'the capacity is kept');
      h.type('bt-consumption', '1,2'); const comma = h.shown();
      assert.ok(comma.includes('About 17 h 0 min') && comma.includes('50 W') && comma.includes('1.2 kWh/day × 1000 ÷ 24 h'), comma);
      h.type('bt-consumption', '1.2'); assert.strictEqual(h.shown(), comma, 'decimal dot and decimal comma agree');
      h.mode('kwh_year'); assert.strictEqual(h.els['bt-consumption-label'].textContent, 'Consumption (kWh/year)'); hiddenAndExplained(h, 'second unit change');
      h.type('bt-consumption', '438'); assert.ok(h.shown().includes('About 17 h 0 min') && h.shown().includes('50 W'), '438 kWh/year is the same 50 W');
    });

    test('a valid result never survives an invalid edit, whichever field breaks', () => {
      const bad = { 'bt-capacity': ['', '   ', '0', '-1', 'abc', '1000x', '1e3', '1 000', '1,2,3', 'Infinity', 'NaN', '99999999999'],
        'bt-consumption': ['', ' ', '0', '0,0', '-5', '12W', '1.', ',', 'Infinity', 'NaN', '1000001'],
        'bt-charge': ['', '-1', '100,1', '101', '50%', 'NaN'], 'bt-usable': ['', '0', '-85', '100.5', '85 %', 'Infinity'] };
      for (const [id, values] of Object.entries(bad)) {
        for (const v of values) {
          const h = fresh(); h.type('bt-capacity', '1000'); h.type('bt-consumption', '100');
          assert.ok(h.shown(), 'precondition: a visible valid result');
          h.type(id, v); hiddenAndExplained(h, id + '=' + JSON.stringify(v));
          if (v.trim() !== '') assert.strictEqual(h.els[id].attrs['aria-invalid'], 'true', id + '=' + JSON.stringify(v) + ' is flagged');
          h.type(id, id === 'bt-capacity' ? '1000' : id === 'bt-consumption' ? '100' : id === 'bt-charge' ? '100' : '85');
          assert.ok(h.shown().includes('About 8 h 30 min'), 'recovers after the value is corrected');
          assert.strictEqual(h.els[id].attrs['aria-invalid'], 'false');
        }
      }
    });

    test('0% charge is a valid 0 h; a tiny positive runtime is shown as under one minute, never as 0 h', () => {
      const h = fresh(); h.type('bt-capacity', '1000'); h.type('bt-consumption', '100'); h.type('bt-charge', '0');
      assert.ok(h.shown().includes('0 h — battery empty') && h.shown().includes('>0 Wh<'), h.shown());
      h.type('bt-charge', '100'); h.type('bt-capacity', '1'); h.type('bt-consumption', '1000');
      assert.ok(h.shown().includes('Less than 1 min') && !/About 0|>0 h/.test(h.shown()), h.shown());
    });

    test('Example fills the illustrative fridge case (20 h 24 min) and says it is an example; Reset restores only this calculator', () => {
      const h = fresh();
      h.els['cv-watts'].value = '1500'; h.api.cvCalc('watts'); const power = JSON.stringify(['cv-amps', 'cv-watts', 'cv-kw', 'cv-hp', 'cv-result-rows'].map((id) => h.els[id].value + h.els[id].innerHTML));
      h.api.btExample();
      assert.deepStrictEqual(h.api.btRead(), { capacityWh: '1000', consumptionMode: 'kwh_year', consumption: '365', chargePercent: '100', usablePercent: '85' });
      assert.strictEqual(h.els['bt-consumption-label'].textContent, 'Consumption (kWh/year)');
      assert.ok(h.shown().includes('About 20 h 24 min') && h.shown().includes('850 Wh') && h.shown().includes('41.67 W'), h.shown());
      assert.ok(h.shown().includes('Illustrative example'), 'labelled as an example');
      h.open('power'); h.open('battery');
      assert.ok(h.shown().includes('Illustrative example') && h.shown().includes('About 20 h 24 min'), 'untouched example data is still called an example after leaving the tab and coming back');
      h.type('bt-capacity', '2000'); assert.ok(!h.shown().includes('Illustrative example') && h.shown().includes('About 40 h 48 min'), 'own numbers are no longer called an example');
      h.open('power'); h.open('battery');
      assert.ok(!h.shown().includes('Illustrative example') && h.shown().includes('About 40 h 48 min'), 'tab navigation never brings the example label back after an edit');
      h.api.btReset();
      assert.deepStrictEqual(h.api.btRead(), { capacityWh: '', consumptionMode: 'w', consumption: '', chargePercent: '100', usablePercent: '85' });
      assert.strictEqual(h.els['bt-consumption-label'].textContent, 'Consumption (W)'); hiddenAndExplained(h, 'after Reset');
      assert.strictEqual(JSON.stringify(['cv-amps', 'cv-watts', 'cv-kw', 'cv-hp', 'cv-result-rows'].map((id) => h.els[id].value + h.els[id].innerHTML)), power, 'Power fields untouched by Example / Reset');
    });

    test('Power and Torque still compute as before and do not touch the battery fields', () => {
      const h = fresh(); h.type('bt-capacity', '1000'); h.type('bt-consumption', '100'); const before = h.shown();
      h.els['cv-watts'].value = '1000'; h.api.cvCalc('watts'); // 208 V, single phase, PF 0.85
      assert.strictEqual(h.els['cv-amps'].value, '5.66'); assert.strictEqual(h.els['cv-va'].value, 1176); assert.strictEqual(h.els['cv-hp'].value, '1.340');
      assert.ok(h.els['cv-result-rows'].innerHTML.includes('5.66 A') && h.els['cv-result'].style.display === '');
      h.els['tq-lbft'].value = '10'; h.api.tqCalc('lbft');
      assert.strictEqual(h.els['tq-lbin'].value, '120.00'); assert.strictEqual(h.els['tq-nm'].value, '13.56');
      h.api.cvReset(); assert.strictEqual(h.els['cv-watts'].value, ''); assert.strictEqual(h.els['cv-result'].style.display, 'none');
      assert.strictEqual(h.shown(), before, 'Power Reset leaves the battery result alone');
      assert.deepStrictEqual([h.els['bt-capacity'].value, h.els['bt-consumption'].value], ['1000', '100']);
    });

    test('BEHAVIOURAL GUARD: the tab renders what the shared engine returns, escaped, and decides nothing itself', () => {
      const h = fresh(); const real = h.EC.batteryRuntime.calculateBatteryRuntime; let seen = null; let seenLang = null;
      try {
        h.EC.batteryRuntime.calculateBatteryRuntime = (input, lang) => { seen = input; seenLang = lang; return { ok: true, errors: [], data: { text: { duration: 'SYNTH <A>', availableWh: 'SYNTH B', availableBasis: 'SYNTH C', averageW: 'SYNTH & D', averageBasis: 'SYNTH E', assumptions: 'SYNTH F' } } }; };
        h.type('bt-capacity', ' 7,5 ');
        assert.deepStrictEqual(seen, { capacityWh: ' 7,5 ', consumptionMode: 'w', consumption: '', chargePercent: '100', usablePercent: '85' }, 'raw field text goes to the engine unparsed');
        assert.strictEqual(seenLang, 'en', 'the form asks the engine for its English text and translates nothing itself');
        for (const m of ['SYNTH &lt;A&gt;', 'SYNTH B', 'SYNTH C', 'SYNTH &amp; D', 'SYNTH E', 'SYNTH F']) assert.ok(h.shown().includes(m), m);
        h.EC.batteryRuntime.calculateBatteryRuntime = () => ({ ok: false, data: null, errors: [{ field: 'capacityWh', code: 'SYNTH', message: 'SYNTH MESSAGE' }] });
        h.type('bt-capacity', '1000'); assert.strictEqual(h.shown(), null); assert.strictEqual(h.status(), 'SYNTH MESSAGE');
      } finally { h.EC.batteryRuntime.calculateBatteryRuntime = real; }
    });
  });
}

module.exports = { START, END, bootEngine, buildHarness, defineUiSuite };
