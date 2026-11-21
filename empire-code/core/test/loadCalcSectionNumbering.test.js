'use strict';
/** LC-SECTION-NUMBERING-1: actual adapter, simulated DOM; not native Safari acceptance. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHarness, fnBody } = require('./helpers/loadCalcDom.js');

function fresh() { const h = buildHarness(); h.api.lcInit(); return h; }
function steps(h) { const form = h.$('lcForm'); return form ? form.querySelectorAll('.lc-step') : []; }
function visibleWithinForm(h, node) {
  const form = h.$('lcForm');
  if (!form || !form.contains(node)) return false;
  for (let p = node; p && p !== form; p = p.parentNode) {
    if (p.style.display === 'none' || p.hasAttribute('hidden')) return false;
  }
  return true;
}
function numbers(h) {
  return steps(h).filter((el) => visibleWithinForm(h, el)).map((el) => el.querySelector('.lc-step-num').textContent);
}
function loads(h) { return steps(h).find((el) => el.querySelector('.lc-step-title').textContent === 'LOADS'); }
function renumber(h) {
  // Execute the shipped helper without exposing a new public API or modifying the test harness.
  return new Function('document', fnBody('lcRenumberVisibleSections') + '\nreturn lcRenumberVisibleSections;')(h.dom.document)();
}
function syntheticHeading(h, initial) {
  const step = h.dom.document.createElement('div'); step.className = 'lc-step';
  const badge = h.dom.document.createElement('div'); badge.className = 'lc-step-num'; badge.textContent = initial;
  step.appendChild(badge); return step;
}

test('visible sections: empty form is numbered 1, 2, 3', () => {
  const h = fresh();
  assert.deepEqual(numbers(h), ['1', '2', '3']);
  assert.equal(loads(h).querySelector('.lc-step-num').textContent, '3');
  assert.equal(h.$('lcMeasurement').style.display, 'none');
  assert.equal(h.$('lcNewLoad').style.display, 'none');
});

test('visible sections: 220.82 shows Loads 3 and leaves the NEC rule badge unnumbered', () => {
  const h = fresh(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', 'opt_220_82');
  assert.deepEqual(numbers(h), ['1', '2', '3']);
  assert.equal(h.$('lcOpt82').style.display, '');
  const rule = h.$('lcOpt82').querySelector('.lc-rule-badge');
  assert.ok(rule); assert.match(rule.textContent, /220\.82/);
  assert.equal(h.$('lcOpt82').querySelectorAll('.lc-step-num').length, 0);
});

test('visible sections: 220.87 retains all five numbered sections in their original order', () => {
  const h = fresh(); h.set('lcMethod', 'measured_220_87');
  assert.deepEqual(numbers(h), ['1', '2', '3', '4', '5']);
  assert.equal(h.$('lcMeasurement').querySelector('.lc-step-num').textContent, '3');
  assert.equal(h.$('lcNewLoad').querySelector('.lc-step-num').textContent, '4');
  assert.equal(loads(h).querySelector('.lc-step-num').textContent, '5');
});

test('visible sections: repeated method changes have no stale or duplicated numbering', () => {
  const h = fresh();
  for (const method of ['measured_220_87', 'opt_220_82', 'measured_220_87', '', 'standard_part_III', 'opt_220_82']) {
    h.set('lcMethod', method);
    assert.deepEqual(numbers(h), method === 'measured_220_87' ? ['1', '2', '3', '4', '5'] : ['1', '2', '3']);
    assert.equal(steps(h).length, 5, 'no heading is removed or cloned');
  }
});

test('visible sections: reset returns Loads to 3 without recreating its heading', () => {
  const h = fresh(); h.set('lcMethod', 'measured_220_87'); const heading = loads(h);
  h.api.lcReset();
  assert.deepEqual(numbers(h), ['1', '2', '3']); assert.equal(loads(h), heading);
});

test('visible sections: preset restore renumbers for the restored method, not the previous one', () => {
  for (const method of ['opt_220_82', 'measured_220_87']) {
    const h = fresh(); h.set('lcOccupancy', 'dwelling_unit_house'); h.set('lcMethod', method);
    assert.equal(h.api.lcFavSave(), true); const savedBytes = h.store.data;
    h.set('lcMethod', method === 'opt_220_82' ? 'measured_220_87' : 'opt_220_82');
    h.$('lc-fav-list').querySelectorAll('.fav-item')[0].dispatch('click');
    assert.deepEqual(numbers(h), method === 'measured_220_87' ? ['1', '2', '3', '4', '5'] : ['1', '2', '3']);
    assert.equal(h.store.data, savedBytes, 'restoring does not rewrite stored preset bytes');
  }
});

test('renumber only updates badge text: no state, evaluation, storage, job draft, focus or heading changes', () => {
  const h = fresh(); h.set('lcMethod', 'opt_220_82'); h.set('lcFloorArea', '1500');
  h.api.lcJobNew(); h.set('lcJobTitle', 'Keep this unsaved job');
  const job = h.api.LC_JOB.editor; const jobFields = JSON.stringify(job.fields);
  const before = JSON.stringify(h.state()); const draft = JSON.stringify(h.api.lcDraft());
  const payload = JSON.stringify(h.api.lcFavPayload()); const writes = h.store.sets;
  const refs = h.necCalls.length; const focuses = h.dom.document.focusLog.focuses.length;
  const scrolls = h.dom.document.focusLog.scrolls.length; const headings = steps(h).slice();
  const titles = headings.map((node) => node.querySelector('.lc-step-title'));
  const methodControl = h.$('lcMethod'); const methodListeners = methodControl.listeners.change.slice();
  const badge = loads(h).querySelector('.lc-step-num'); badge.textContent = '99';
  const descriptor = Object.getOwnPropertyDescriptor(h.api.LC, 'snapshot');
  Object.defineProperty(h.api.LC, 'snapshot', { configurable: true, get() { throw new Error('Presentation must not read calculator state'); } });
  try { renumber(h); } finally { Object.defineProperty(h.api.LC, 'snapshot', descriptor); }
  assert.equal(badge.textContent, '3');
  assert.equal(JSON.stringify(h.state()), before); assert.equal(JSON.stringify(h.api.lcDraft()), draft);
  assert.equal(JSON.stringify(h.api.lcFavPayload()), payload); assert.equal(h.store.sets, writes);
  assert.equal(h.api.LC_JOB.editor, job); assert.equal(JSON.stringify(job.fields), jobFields);
  assert.equal(h.dom.document.focusLog.focuses.length, focuses); assert.equal(h.dom.document.focusLog.scrolls.length, scrolls);
  assert.equal(h.necCalls.length, refs); assert.equal(h.$('lcMethod'), methodControl);
  assert.deepEqual(methodControl.listeners.change, methodListeners);
  steps(h).forEach((node, i) => { assert.equal(node, headings[i]); assert.equal(node.querySelector('.lc-step-title'), titles[i]); });
});

test('renumber is idempotent and does not replace already-correct badge text nodes', () => {
  const h = fresh(); h.set('lcMethod', 'measured_220_87'); renumber(h);
  const textNodes = steps(h).map((node) => node.querySelector('.lc-step-num').firstChild);
  for (let i = 0; i < 5; i++) renumber(h);
  steps(h).forEach((node, i) => assert.equal(node.querySelector('.lc-step-num').firstChild, textNodes[i]));
});

test('renumber skips a hidden ancestor and reacts to a hidden heading without assuming a particular method', () => {
  const h = fresh(); h.set('lcMethod', 'measured_220_87');
  h.$('lcMeasurement').setAttribute('hidden', ''); renumber(h);
  assert.deepEqual(numbers(h), ['1', '2', '3', '4']);
  const supply = steps(h)[1]; supply.style.display = 'none'; renumber(h);
  assert.deepEqual(numbers(h), ['1', '2', '3']);
  h.$('lcMeasurement').removeAttribute('hidden'); supply.style.display = ''; renumber(h);
  assert.deepEqual(numbers(h), ['1', '2', '3', '4', '5']);
});

test('renumber skips a nested hidden wrapper; a missing badge does not consume a number', () => {
  const h = fresh(); const form = h.$('lcForm'); const heading = loads(h);
  const wrapper = h.dom.document.createElement('div'); wrapper.style.display = 'none';
  form.appendChild(wrapper); wrapper.appendChild(heading); renumber(h);
  assert.deepEqual(numbers(h), ['1', '2']);
  wrapper.style.display = ''; renumber(h); assert.deepEqual(numbers(h), ['1', '2', '3']);
  const incomplete = h.dom.document.createElement('div'); incomplete.className = 'lc-step';
  form.appendChild(incomplete); const additional = syntheticHeading(h, '99'); form.appendChild(additional);
  renumber(h); assert.equal(additional.querySelector('.lc-step-num').textContent, '4');
});

test('renumber ignores headings outside the form and preserves numbers while the entire form is hidden', () => {
  const h = fresh(); const external = syntheticHeading(h, '42'); h.$('lcJobHub').appendChild(external);
  const form = h.$('lcForm'); form.style.display = 'none'; form.setAttribute('hidden', '');
  renumber(h); assert.deepEqual(numbers(h), ['1', '2', '3']);
  assert.equal(external.querySelector('.lc-step-num').textContent, '42');
});

test('renumber follows current document order instead of permanent creation-time ordinals', () => {
  const h = fresh(); const form = h.$('lcForm'); const first = steps(h)[0];
  form.appendChild(first); renumber(h);
  assert.deepEqual(numbers(h), ['1', '2', '3']);
  assert.equal(loads(h).querySelector('.lc-step-num').textContent, '2');
  assert.equal(first.querySelector('.lc-step-num').textContent, '3');
});

test('renumber is safe before initialization and when a missing core prevents form construction', () => {
  const h = buildHarness(); assert.doesNotThrow(() => renumber(h));
  const g = buildHarness({ missing: ['loadCalcFacade'] }); g.api.lcInit();
  assert.equal(g.$('lcForm'), undefined); assert.doesNotThrow(() => renumber(g));
  assert.equal(g.store.sets, 0);
});
