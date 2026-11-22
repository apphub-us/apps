'use strict';
/**
 * EC-02 — the static code-source registry behind the source panel (src/refs/codeSources.js).
 * The click path through the shipped necLink / ecSourceOpen / ecSourceClose is in uiReferences.test.js.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Sources = require('../src/refs/codeSources');

const OFFICIAL = /^https:\/\/www\.(nyc\.gov|nfpa\.org)\/[\w\-./]*$/;
const flat = (d) => [d.heading, d.citation, d.appNote, d.availability, d.offline, ...d.notes, ...d.links.map((l) => l.label)].join('\n');

describe('codeSources.describe', () => {
  test('NEC section, table, article and compound citations are named exactly; the NFPA source comes first', () => {
    const cases = [
      [{ source: 'nec', section: '314.16', head: '314.16', title: 'Box Fill Calculations' }, 'NEC 2020 — Section 314.16', 'Section 314.16.'],
      [{ source: 'nec', section: 'Table 250.66', head: 'Table 250.66', title: '' }, 'NEC 2020 — Table 250.66', 'Table 250.66.'],
      [{ source: 'nec', section: 'Article 250', head: 'Article 250', title: 'Grounding' }, 'NEC 2020 — Article 250', 'Article 250.'],
      [{ source: 'nec', section: '310.15', head: '310.15 and 310.16', title: 'Ampacity Calculations' }, 'NEC 2020 — 310.15 and 310.16', '310.15 and 310.16.'],
    ];
    for (const [info, heading, tail] of cases) {
      const d = Sources.describe(info);
      assert.equal(d.source, 'nec'); assert.equal(d.edition, '2020'); assert.equal(d.heading, heading);
      assert.ok(d.citation.startsWith('NFPA 70, National Electrical Code (NEC), 2020 edition — ') && d.citation.endsWith(tail), d.citation);
      assert.equal(d.links[0].url, 'https://www.nfpa.org/70'); assert.equal(d.appNote, info.title ? 'Cited in this app for: ' + info.title : '');
    }
  });
  test('a NYCEC reference is an amendment to the named NEC section, lists the NYC DOB sources first and states the scope of the amendments', () => {
    const d = Sources.describe({ source: 'nycec', section: '215.2(A)(1)', head: '215.2(A)(1)', title: 'feeder voltage drop' });
    assert.equal(d.edition, '2025'); assert.equal(d.heading, 'NYCEC 2025 amendment — NEC Section 215.2(A)(1)');
    assert.equal(d.citation, '2025 New York City Electrical Code — New York City amendment to NEC 2020 Section 215.2(A)(1).');
    assert.deepEqual(d.links.map((l) => l.url), ['https://www.nyc.gov/site/buildings/codes/electrical-code.page', 'https://www.nyc.gov/assets/buildings/codes-pdf/2025electrical_code.pdf', 'https://www.nfpa.org/70']);
    assert.ok(d.notes.some((n) => /do not replace the base NEC 2020 text/.test(n)) && d.notes.some((n) => /confirm with DOB/.test(n)));
  });
  test('edition badges describe the edition only; malformed input still yields a truthful, closable description', () => {
    const nyc = Sources.describe({ source: 'nycec', kind: 'edition', section: null, head: 'New York City Electrical Code, 2025 edition', title: 'New York City Electrical Code, 2025 edition' });
    assert.equal(nyc.heading, 'NYCEC 2025'); assert.ok(/NEC 2020 as adopted by New York City with local amendments/.test(nyc.citation)); assert.equal(nyc.appNote, '');
    const nec = Sources.describe({ source: 'nec', kind: 'edition', section: null, head: 'x', title: 'x' });
    assert.equal(nec.heading, 'NEC 2020'); assert.equal(nec.citation, 'NFPA 70, National Electrical Code (NEC), 2020 edition.');
    for (const bad of [undefined, null, 'NEC 1.1', 5, {}, { source: 'other' }]) { const d = Sources.describe(bad); assert.equal(d.source, 'nec'); assert.equal(d.heading, 'NEC 2020'); assert.ok(d.links.length === 3 && d.availability.length > 20); }
  });
  test('every description says the text is not included, generates no explanation, and links only to fixed official https sources', () => {
    for (const info of [{ source: 'nec', section: '250.66(C)', head: '250.66(C)' }, { source: 'nycec', section: '334.12', head: '334.12', title: 'NM cable <b>&"' }, { source: 'nec', kind: 'edition' }]) {
      const d = Sources.describe(info);
      assert.ok(/not included in Empire Code/.test(d.availability) && /no explanation is generated/.test(d.availability));
      assert.ok(/need an internet connection/.test(d.offline) && /returns to the tool/.test(d.offline));
      assert.equal(d.links.length, 3); for (const l of d.links) { assert.ok(OFFICIAL.test(l.url), l.url); assert.ok(l.label.length > 5); }
      assert.ok(!/\bAI\b|API key|Anthropic|sk-ant|chat/i.test(flat(d)), flat(d));
    }
    const a = Sources.describe({ source: 'nec', section: '1.1', head: '1.1' }); a.links[0].url = 'https://example.invalid/'; a.links.push({});
    assert.equal(Sources.describe({ source: 'nec', section: '1.1', head: '1.1' }).links[0].url, 'https://www.nfpa.org/70', 'callers cannot mutate the registry');
    assert.ok(Object.isFrozen(Sources.LINKS) && Object.isFrozen(Sources.LINKS.nec) && Object.isFrozen(Sources.LINKS.nycec[0]));
  });
});
