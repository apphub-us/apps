'use strict';
/**
 * EC-02 — what Empire Code can truthfully show for a code reference.
 *
 * A reference link or edition badge used to open the legacy AI Chat with a
 * prepared question; without a stored provider key that ended in a key prompt
 * with no way out. The app does not contain the code text and must not invent
 * an explanation, so a reference now resolves to exactly this: the precise
 * citation, a plain statement that the text is not included, and the official
 * publisher sources. Static data only — no network, no storage, no AI.
 *
 * `info` is the object built by necRefInfo() in mobile.html:
 *   { source: 'nec' | 'nycec', section, head, title, kind: 'section' | 'edition' }
 * The NYC URLs are the official NYC Department of Buildings pages cited in the
 * PRIVATE-PILOT-4 audit (S1, S3); the NFPA URL is the publisher's page for NFPA 70.
 */
const EDITIONS = Object.freeze({ nec: '2020', nycec: '2025' });
const LINKS = Object.freeze({
  nec: Object.freeze([
    Object.freeze({ label: 'NFPA 70 (NEC) — publisher page, nfpa.org', url: 'https://www.nfpa.org/70' }),
  ]),
  nycec: Object.freeze([
    Object.freeze({ label: 'NYC Department of Buildings — Electrical Code', url: 'https://www.nyc.gov/site/buildings/codes/electrical-code.page' }),
    Object.freeze({ label: '2025 NYC Electrical Code — amendments (PDF)', url: 'https://www.nyc.gov/assets/buildings/codes-pdf/2025electrical_code.pdf' }),
  ]),
});

/** "Section 215.2(A)(1)", "Table 250.66", "Article 250", or the full compound head ("210.19(A) and 215.2(A)(1)"). */
function sectionLabel(info) {
  const section = info && typeof info.section === 'string' ? info.section : '';
  const head = info && typeof info.head === 'string' ? info.head : '';
  if (section && (head === section || !head)) return /^(Article|Chapter|Table)\b/.test(section) ? section : 'Section ' + section;
  return head || section;
}

function describe(info) {
  const i = info && typeof info === 'object' ? info : {};
  const source = i.source === 'nycec' ? 'nycec' : 'nec';
  const what = i.kind === 'edition' ? '' : sectionLabel(i);
  const title = typeof i.title === 'string' ? i.title.trim() : '';
  const nec = 'NFPA 70, National Electrical Code (NEC), 2020 edition';
  const notes = [];
  let heading; let citation;
  if (source === 'nycec') {
    heading = what ? 'NYCEC 2025 amendment — NEC ' + what : 'NYCEC 2025';
    citation = what
      ? '2025 New York City Electrical Code — New York City amendment to NEC 2020 ' + what + '.'
      : '2025 New York City Electrical Code (NYCEC): the NEC 2020 as adopted by New York City with local amendments.';
    notes.push('The New York City amendments change only the sections they list. They do not replace the base NEC 2020 text, which is published by NFPA.');
    notes.push('NYC DOB lists the 2025 code as fully in effect from December 21, 2025. Which edition governs a particular job can depend on its filing or permit — confirm with DOB.');
  } else {
    heading = what ? 'NEC 2020 — ' + what : 'NEC 2020';
    citation = what ? nec + ' — ' + what + '.' : nec + '.';
    notes.push('In New York City the NEC 2020 applies as amended by the 2025 NYC Electrical Code. This panel does not determine whether this particular section is amended — check the NYC amendments.');
  }
  const links = (source === 'nycec' ? LINKS.nycec.concat(LINKS.nec) : LINKS.nec.concat(LINKS.nycec)).map((l) => ({ label: l.label, url: l.url }));
  return {
    source,
    edition: EDITIONS[source],
    heading,
    citation,
    appNote: title && i.kind !== 'edition' ? 'Cited in this app for: ' + title : '',
    availability: 'The code text is not included in Empire Code, and no explanation is generated here. Read the wording that applies at the official source below.',
    notes,
    links,
    offline: 'Official sources open outside the app and need an internet connection. Closing this panel returns to the tool exactly as you left it.',
  };
}

module.exports = { EDITIONS, LINKS, sectionLabel, describe };
