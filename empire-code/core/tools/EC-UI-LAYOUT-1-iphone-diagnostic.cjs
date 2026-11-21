#!/usr/bin/env node
'use strict';
/**
 * EC-UI-LAYOUT-REFS-1 — read-only iPhone LAYOUT DIAGNOSTIC launcher (one targeted follow-up).
 * Usage: node tools/EC-UI-LAYOUT-1-iphone-diagnostic.cjs /absolute/path/to/mobile.html
 *
 * Why: the owner reported the Load Calc panel moving horizontally on a physical iPhone
 * (content shifted left, blank space on the right, header and bottom nav at rest). Desktop
 * Chromium reproduces no horizontal overflow at 320/375/390/414 in any Load Calc state, and
 * WebKit is not available to the executor. This launcher shows the SAME pinned app in the same
 * iframe shell as the previous preview and adds a measurement strip that records, continuously
 * and on scroll / touch / focus / visualViewport events, WHICH element actually moved and WHETHER
 * anything is horizontally scrollable:
 *   - document.scrollWidth vs innerWidth, document scrollLeft
 *   - #panel-more clientWidth / scrollWidth / scrollLeft (the Load Calc scroll container;
 *     it computes overflow-x: auto), .content scrollLeft (overflow: hidden ancestor)
 *   - every element with scrollLeft > 0 (the mover), the widest elements past the viewport
 *   - visualViewport scale / offsetLeft / pageLeft / width / height (zoom vs. scroll)
 *   - the focused element (keyboard states)
 * "Copy report" places a JSON log on the clipboard (or in a text box) for the executor.
 *
 * It is READ-ONLY: it never fills inputs, seeds or clears storage, moves focus, blurs, scrolls
 * or changes zoom/CSS in the app document; it only reads and adds passive listeners. Only the
 * network send (sendMessage) is left untouched too — this launcher does not stub anything.
 * No dependencies, installation, Git commands, source writes or public tunnel. Serves the EXACT
 * pinned mobile.html bytes. CSP blocks remote resources/connections/workers. Trusted private
 * LAN only; HTTP is unencrypted and a random session path is not authentication. Ctrl+C stops it.
 * It does not modify or replace the previous pinned preview launcher.
 *
 * UI-r1 (R-UI-03): the measurement now records the OUTER (shell) visualViewport and the iframe's
 * bounding rect next to the INNER (app) visualViewport, so retained zoom or a frame-level offset is
 * observable and distinguishable from an app-level scroll; scroll offsets are SIGNED (a negative
 * scrollLeft is movement too); a height-only visualViewport change with scale 1 and no offset is
 * reported as "keyboard?" and not as movement; exactly ONE polling timer exists across reloads
 * (the previous one is cleared and the listeners are re-armed on every iframe load).
 * Two explicitly identified sources are accepted: the current Mac build (B2-r1.1, 119 files, the
 * version on which the movement was reported) and the UI-r1 FINAL build. Any other file is refused.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

// Explicitly identified sources only (no arbitrary hash is ever accepted):
const KNOWN_SOURCES = {
  '989b7079fd1f8cd3b98107d99647c19b34187bd6ed5c1071d70a86def1d8a28d': 'CURRENT Mac build — EC-CALC-2 B2-r1.1 (119 files), the version on which the movement was reported',
  '4cb3dd43cae71232e7c6fff1f45c34cfc0e960d8ddbc0df5547f61851aacc6e8': 'EC-UI-LAYOUT-REFS-1 UI-r1 FINAL mobile.html'
};
const ICONS = { 'icon-192.png': 'f9aa5c645762411770d6ada29e79de67681cf1d94a2a37fb412d36de51084df6', 'icon-512.png': '6075c1c1ba62a096034d8c71f7c1edbb4ab767ff193117fe61978e088c9d5e47' };
const sha = (data) => createHash('sha256').update(data).digest('hex');
function privateIPv4(s) { if (typeof s !== 'string' || !/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return false; const a = s.split('.').map(Number); if (a.some((n) => n > 255)) return false; return a[0] === 10 || (a[0] === 192 && a[1] === 168) || (a[0] === 172 && a[1] >= 16 && a[1] <= 31); }
function chooseHost() {
  const entries = Object.entries(os.networkInterfaces()).flatMap(([name, list]) => (list || []).filter((x) => x.family === 'IPv4' || x.family === 4).map((x) => ({ name, ...x })));
  const selected = process.env.EC_PREVIEW_HOST;
  if (selected) { if (!entries.some((x) => x.address === selected) || !(privateIPv4(selected) || selected === '127.0.0.1')) throw new Error('EC_PREVIEW_HOST nie jest lokalnym prywatnym adresem IPv4.'); return selected; }
  const eligible = entries.filter((x) => !x.internal && privateIPv4(x.address));
  if (!eligible.length) throw new Error('Brak prywatnego adresu IPv4 w sieci lokalnej (ustaw EC_PREVIEW_HOST=127.0.0.1 dla testu lokalnego).');
  return eligible[0].address;
}
function readPinned(file, pin, max) {
  const st = fs.lstatSync(file); if (st.isSymbolicLink() || !st.isFile()) throw new Error('Nie jest zwykłym plikiem: ' + file);
  if (st.size > max) throw new Error('Plik za duży: ' + file);
  const data = fs.readFileSync(file); const actual = sha(data);
  if (actual !== pin) throw new Error('SHA-256 nie zgadza się dla ' + path.basename(file) + '\n  oczekiwano ' + pin + '\n  jest       ' + actual);
  return data;
}
/** the app file must be one of the explicitly identified sources */
function readKnownSource(file, max) {
  const st = fs.lstatSync(file); if (st.isSymbolicLink() || !st.isFile()) throw new Error('Nie jest zwykłym plikiem: ' + file);
  if (st.size > max) throw new Error('Plik za duży: ' + file);
  const data = fs.readFileSync(file); const actual = sha(data);
  if (!Object.prototype.hasOwnProperty.call(KNOWN_SOURCES, actual)) throw new Error('SHA-256 pliku ' + path.basename(file) + ' nie jest jednym ze znanych źródeł:\n  jest ' + actual + '\n  znane: ' + Object.keys(KNOWN_SOURCES).map((k) => k.slice(0, 12) + '… (' + KNOWN_SOURCES[k] + ')').join('; '));
  return { data, pin: actual, label: KNOWN_SOURCES[actual] };
}
function controllerSource() {
  return String.raw`(function () {
  'use strict';
  var iframe = document.getElementById('app'), status = document.getElementById('status'), line = document.getElementById('line'), box = document.getElementById('report');
  var log = [], last = null, ua = navigator.userAgent, pin = document.body.getAttribute('data-pin'), pollTimer = null, armedDoc = null, armCount = 0;
  function say(t) { status.textContent = t; }
  function inner() { try { return iframe.contentWindow; } catch (e) { return null; } }
  function desc(el) { if (!el) return null; return (el.tagName || '').toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''); }
  function vvOf(v) { return v ? { scale: +Number(v.scale).toFixed(3), offsetLeft: Math.round(v.offsetLeft), offsetTop: Math.round(v.offsetTop), pageLeft: Math.round(v.pageLeft), width: Math.round(v.width), height: Math.round(v.height) } : null; }
  function measure(trigger) {
    var w = inner(); if (!w || !w.document || !w.document.body) return null;
    var d = w.document, de = d.documentElement, panel = d.getElementById('panel-more'), content = d.querySelector('.content'), lc = d.getElementById('lcContent');
    var movers = [], widest = [], all = d.getElementsByTagName('*'), iw = w.innerWidth;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.scrollLeft !== 0 && movers.length < 8) movers.push({ el: desc(el), scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: w.getComputedStyle(el).overflowX });   // SIGNED: a negative offset is movement too
      var r = el.getBoundingClientRect(); if (r.width > 0 && (r.right > iw + 1 || r.left < -1)) widest.push({ el: desc(el), right: Math.round(r.right), width: Math.round(r.width), left: Math.round(r.left) });
    }
    widest.sort(function (a, b) { return Math.max(b.right - iw, -b.left) - Math.max(a.right - iw, -a.left); }); widest = widest.slice(0, 8);
    var fr = iframe.getBoundingClientRect();
    var m = {
      t: new Date().toISOString(), trigger: trigger, innerWidth: iw, innerHeight: w.innerHeight, docScrollWidth: de.scrollWidth, docScrollLeft: de.scrollLeft, bodyScrollLeft: d.body.scrollLeft,
      outer: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, docScrollLeft: document.documentElement.scrollLeft, bodyScrollLeft: document.body.scrollLeft },
      outerVV: vvOf(window.visualViewport),
      frame: { left: Math.round(fr.left), top: Math.round(fr.top), width: Math.round(fr.width), height: Math.round(fr.height) },
      panel: panel ? { clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth, scrollLeft: panel.scrollLeft, scrollTop: panel.scrollTop, overflowX: w.getComputedStyle(panel).overflowX, active: panel.classList.contains('active') } : null,
      content: content ? { scrollLeft: content.scrollLeft, scrollWidth: content.scrollWidth, clientWidth: content.clientWidth } : null,
      lcContent: lc ? { scrollWidth: lc.scrollWidth, clientWidth: lc.clientWidth } : null,
      vv: vvOf(w.visualViewport),
      active: desc(d.activeElement), movers: movers, widest: widest
    };
    var innerZoom = !!(m.vv && (m.vv.scale !== 1 || m.vv.offsetLeft !== 0 || m.vv.pageLeft !== 0));
    var outerZoom = !!(m.outerVV && (m.outerVV.scale !== 1 || m.outerVV.offsetLeft !== 0 || m.outerVV.pageLeft !== 0));
    var frameShift = m.frame.left !== 0 || Math.abs(m.frame.width - m.outer.innerWidth) > 1;
    var scrolled = movers.length > 0 || m.docScrollLeft !== 0 || m.bodyScrollLeft !== 0 || m.outer.docScrollLeft !== 0 || m.outer.bodyScrollLeft !== 0;
    var overflow = (m.panel && m.panel.scrollWidth > m.panel.clientWidth) || m.docScrollWidth > iw;
    m.keyboardLikely = !!(m.vv && !innerZoom && !outerZoom && m.vv.height < m.innerHeight - 100);   // height-only change at scale 1: keyboard, not movement
    m.classification = { innerZoom: innerZoom, outerZoom: outerZoom, frameShift: frameShift, scrolled: scrolled, overflow: overflow };
    m.moved = innerZoom || outerZoom || frameShift || scrolled || overflow;
    return m;
  }
  function render(m) {
    if (!m) { line.textContent = 'brak dokumentu'; return; }
    var c = m.classification; var why = [c.innerZoom ? 'zoom-app' : '', c.outerZoom ? 'zoom-shell' : '', c.frameShift ? 'ramka' : '', c.scrolled ? 'scroll' : '', c.overflow ? 'przepełnienie' : ''].filter(Boolean).join('+');
    var s = (m.moved ? 'RUCH (' + why + ') — ' : 'ok — ') + 'doc ' + m.docScrollWidth + '/' + m.innerWidth + ' sL' + m.docScrollLeft
      + (m.panel ? ' | panel ' + m.panel.scrollWidth + '/' + m.panel.clientWidth + ' sL' + m.panel.scrollLeft : '')
      + (m.content ? ' | content sL' + m.content.scrollLeft : '')
      + (m.vv ? ' | vv-app x' + m.vv.scale + ' off' + m.vv.offsetLeft + ' ' + m.vv.width + 'x' + m.vv.height : '')
      + (m.outerVV ? ' | vv-shell x' + m.outerVV.scale + ' off' + m.outerVV.offsetLeft + ' w' + m.outerVV.width : '')
      + ' | ramka ' + m.frame.left + '/' + m.frame.width + ' (' + m.outer.innerWidth + ')'
      + (m.keyboardLikely ? ' | klawiatura?' : '')
      + (m.movers.length ? ' | mover ' + m.movers[0].el + ' sL' + m.movers[0].scrollLeft : '')
      + (m.widest.length ? ' | poza ' + m.widest[0].el + ' l' + m.widest[0].left + ' r' + m.widest[0].right : '')
      + (m.active ? ' | focus ' + m.active : '');
    line.textContent = s; line.className = m.moved ? 'moved' : '';
  }
  function tick(trigger) {
    var m = measure(trigger); if (!m) return;
    var key = JSON.stringify([m.moved, m.keyboardLikely, m.docScrollLeft, m.panel && m.panel.scrollLeft, m.panel && m.panel.scrollWidth, m.content && m.content.scrollLeft, m.vv, m.outerVV, m.frame, m.active, m.movers.length, m.widest.length]);
    if (key !== last || trigger === 'snapshot') { log.push(m); if (log.length > 150) log.shift(); last = key; }
    render(m);
  }
  function disarm() { if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; } armedDoc = null; }   // the previous document's listeners die with it; only the shell-owned timer must be cleared
  function arm() {
    var w = inner(); if (!w || !w.document) return;
    if (armedDoc === w.document && pollTimer !== null) return;   // already measuring this document (the WindowProxy survives a reload, the document does not)
    disarm(); armedDoc = w.document; armCount++;
    var d = w.document;
    ['scroll', 'touchend', 'touchcancel', 'focusin', 'focusout', 'resize', 'orientationchange'].forEach(function (ev) { try { (ev === 'resize' || ev === 'orientationchange' ? w : d).addEventListener(ev, function () { tick(ev); }, { capture: true, passive: true }); } catch (e) {} });
    if (w.visualViewport) { w.visualViewport.addEventListener('resize', function () { tick('vv.resize'); }); w.visualViewport.addEventListener('scroll', function () { tick('vv.scroll'); }); }
    if (window.visualViewport && !window.__ecOuterVVArmed) { window.__ecOuterVVArmed = true; window.visualViewport.addEventListener('resize', function () { tick('outer.vv.resize'); }); window.visualViewport.addEventListener('scroll', function () { tick('outer.vv.scroll'); }); }
    pollTimer = setInterval(function () { tick('poll'); }, 500);   // exactly one polling timer at any time
    say('Pomiar aktywny (' + armCount + '). Otwórz Load Calc, odtwórz gest (przewiń, wpisz w etykietę, zamknij klawiaturę, przesuń palcem w bok), potem "Kopiuj raport".');
    tick('armed');
  }
  iframe.addEventListener('load', function () { var w = inner(); if (w && w.document && armedDoc === w.document && pollTimer !== null) return; disarm(); setTimeout(arm, 300); });   // every NEW document (including Odśwież) re-arms exactly once
  document.getElementById('open').addEventListener('click', function () { var w = inner(); if (!w) return; try { var mod = w.document.getElementById('apiModal'); if (mod) mod.style.display = 'none'; w.openTool('loadcalc'); } catch (e) { say('Nie udało się otworzyć Load Calc: ' + e.message); } setTimeout(function () { tick('open'); }, 200); });
  document.getElementById('snap').addEventListener('click', function () { tick('snapshot'); say('Zapisano migawkę ' + log.length + '.'); });
  document.getElementById('reload').addEventListener('click', function () { disarm(); last = null; iframe.contentWindow.location.reload(); });
  document.getElementById('copy').addEventListener('click', function () {
    var report = JSON.stringify({ launcher: 'EC-UI-LAYOUT-1-iphone-diagnostic (UI-r1)', pin: pin, source: document.body.getAttribute('data-source'), userAgent: ua, screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio }, armCount: armCount, activeTimers: pollTimer === null ? 0 : 1, current: measure('copy'), log: log }, null, 1);
    box.value = report; box.style.display = 'block';
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(report).then(function () { say('Raport skopiowany do schowka (' + report.length + ' znaków); jest też w polu poniżej.'); }, function () { say('Schowek niedostępny — skopiuj tekst z pola poniżej.'); });
    else say('Schowek niedostępny — skopiuj tekst z pola poniżej.');
  });
  var appUrl = document.body.getAttribute('data-app'); iframe.src = appUrl;
  say('Ładowanie lokalnej aplikacji (pin ' + pin.slice(0, 8) + '…)…');
})();`;
}
function main() {
  const file = process.argv[2];
  if (!file || !path.isAbsolute(file)) { console.error('Użycie: node EC-UI-LAYOUT-1-iphone-diagnostic.cjs /absolute/path/to/mobile.html'); process.exit(2); }
  const known = readKnownSource(file, 8 * 1024 * 1024); const html = known.data; const EXPECTED = known.pin;
  const prefix = '/' + randomBytes(12).toString('hex') + '/';
  const resources = new Map();
  resources.set(prefix + 'mobile.html', ['text/html; charset=utf-8', html]);
  for (const [name, pin] of Object.entries(ICONS)) { const f = path.join(path.dirname(file), name); if (!fs.existsSync(f)) continue; try { resources.set(prefix + name, ['image/png', readPinned(f, pin, 2 * 1024 * 1024)]); } catch (e) { console.error('Ikona pominięta: ' + e.message.split('\n')[0]); } }
  resources.set(prefix + 'controller.js', ['text/javascript; charset=utf-8', Buffer.from(controllerSource())]);
  const shell = `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>EC-UI-LAYOUT-1 — diagnostyka układu (iPhone)</title>
<style>
html,body{margin:0;height:100%;background:#111;color:#eee;font:12px system-ui,sans-serif}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
header{flex:none;padding:6px max(10px,env(safe-area-inset-right)) 6px max(10px,env(safe-area-inset-left));border-bottom:1px solid #555}
.bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.bar strong{margin-right:auto;font-size:12px}
button{min-height:40px;padding:6px 9px;background:#282828;border:1px solid #666;border-radius:6px;color:#fff;font:inherit}
#status{display:block;margin-top:3px;overflow-wrap:anywhere;font-size:11px;color:#bbb}
#line{display:block;margin-top:3px;font:11px ui-monospace,Menlo,monospace;overflow-wrap:anywhere;color:#9f9}
#line.moved{color:#ff8a4d;font-weight:700}
#report{display:none;width:100%;height:90px;margin-top:4px;font:10px ui-monospace,monospace;background:#000;color:#ccc;border:1px solid #444}
iframe{flex:1;width:100%;min-height:0;border:0;background:#0a0a0a}
</style></head><body data-pin="${EXPECTED}" data-source="${known.label.replace(/"/g, '&quot;')}" data-app="${prefix}mobile.html">
<header><div class="bar"><strong>EC-UI-LAYOUT-1 · diagnostyka</strong><button id="open">Load Calc</button><button id="snap">Migawka</button><button id="copy">Kopiuj raport</button><button id="reload">Odśwież</button></div>
<span id="status" role="status">Uruchamianie…</span><span id="line">—</span><textarea id="report" readonly></textarea></header>
<iframe id="app" title="Empire Code — lokalna wersja diagnostyczna"></iframe>
<script src="controller.js"></script></body></html>`;
  resources.set(prefix, ['text/html; charset=utf-8', Buffer.from(shell)]);
  const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-src 'self'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'";
  const host = chooseHost();
  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    const hit = resources.get(url);
    if (!hit || req.method !== 'GET') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': hit[0], 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(hit[1]);
  });
  server.listen(0, host, () => {
    const url = 'http://' + host + ':' + server.address().port + prefix;
    console.log('EC-UI-LAYOUT-1 diagnostic preview (read-only, UI-r1)\n  mobile.html SHA-256 ' + EXPECTED + ' (verified: ' + known.label + ')\n  open on the iPhone: ' + url + '\n  Load Calc -> reproduce the gesture -> "Kopiuj raport" -> send the JSON to the executor. Ctrl+C stops the server.');
  });
}
try { main(); } catch (e) { console.error('STOP: ' + e.message); process.exit(1); }
