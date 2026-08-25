'use strict';
/**
 * Wire Map — wire label search (WM-7).
 *
 * Pure. No DOM, no IndexedDB, no viewport.
 *
 * Takes plain wire-label annotations plus their sheet metadata and returns
 * ranked, stably ordered results. The caller does the store reads and the
 * navigation; nothing here knows how either works.
 *
 * Label normalization is NOT reimplemented: model.toLabelKey owns it, so a
 * query typed as "hr 07", "HR_07" or "HR-07" matches the same labels the model
 * already considers equivalent.
 */

const model = require('./model');

/** How many results the caller should render. The total is reported separately. */
const MAX_VISIBLE_RESULTS = 50;

/**
 * Match tiers, highest first. Exact label identity always outranks anything
 * found in metadata — an electrician searching HR-07 wants HR-07, not every
 * wire that happens to run to the same room.
 */
const RANK = {
  EXACT_LABEL: 100,
  LABEL_PREFIX: 80,
  LABEL_SUBSTRING: 60,
  FROM: 40,
  TO: 38,
  CABLE: 36,
  ROOM: 34,
  NOTES: 20,
};

/** Fields searched beyond the label itself, in descending priority. */
const METADATA_FIELDS = [
  { key: 'from', rank: RANK.FROM },
  { key: 'to', rank: RANK.TO },
  { key: 'cable', rank: RANK.CABLE },
  { key: 'room', rank: RANK.ROOM },
  { key: 'notes', rank: RANK.NOTES },
];

function asText(value) {
  return typeof value === 'string' ? value : '';
}

/** Case-insensitive comparison form for free-text fields. */
function fold(value) {
  return asText(value).trim().toLowerCase();
}

/**
 * Normalize a raw query.
 * @returns {{raw:string, folded:string, labelKey:string}|null} null when empty.
 */
function normalizeQuery(raw) {
  const text = asText(raw).trim();
  if (!text) return null;
  return { raw: text, folded: text.toLowerCase(), labelKey: model.toLabelKey(text) };
}

/**
 * Classify one wire label against a normalized query.
 * @returns {{rank:number, field:string}|null}
 */
function classify(annotation, query) {
  if (!annotation || annotation.type !== 'wireLabel' || !query) return null;
  const data = annotation.data || {};

  // The stored labelKey is model-derived; fall back to deriving it so a record
  // written before that guarantee still matches.
  const labelKey = asText(data.labelKey) || model.toLabelKey(asText(data.label));
  const labelFolded = fold(data.label);

  if (labelKey && query.labelKey && labelKey === query.labelKey) {
    return { rank: RANK.EXACT_LABEL, field: 'label' };
  }
  if (labelFolded && query.folded) {
    if (labelFolded.indexOf(query.folded) === 0) return { rank: RANK.LABEL_PREFIX, field: 'label' };
    if (labelFolded.indexOf(query.folded) > 0) return { rank: RANK.LABEL_SUBSTRING, field: 'label' };
  }
  // A normalized-key prefix catches "hr 0" against "HR-07" too.
  if (query.labelKey && labelKey && labelKey.indexOf(query.labelKey) === 0) {
    return { rank: RANK.LABEL_PREFIX, field: 'label' };
  }

  for (const spec of METADATA_FIELDS) {
    const value = fold(data[spec.key]);
    if (value && query.folded && value.indexOf(query.folded) !== -1) {
      return { rank: spec.rank, field: spec.key };
    }
  }
  return null;
}

/**
 * Rank wire labels against a query.
 *
 * @param {string} rawQuery
 * @param {Array} annotations wire-label annotations, any sheet
 * @param {Array} sheets [{id, name, order}] providing display names and order
 * @param {object} [options] { limit }
 * @returns {{query:object|null, results:Array, total:number, truncated:boolean}}
 */
function search(rawQuery, annotations, sheets, options) {
  const limit = (options && Number.isFinite(options.limit) && options.limit > 0)
    ? options.limit : MAX_VISIBLE_RESULTS;
  const query = normalizeQuery(rawQuery);
  if (!query) return { query: null, results: [], total: 0, truncated: false };

  const sheetById = new Map();
  (sheets || []).forEach((s, i) => {
    if (s && s.id) sheetById.set(s.id, { name: asText(s.name), order: Number.isFinite(s.order) ? s.order : i });
  });

  const matched = [];
  (annotations || []).forEach((a) => {
    const hit = classify(a, query);
    if (!hit) return;
    const sheet = sheetById.get(a.sheetId) || { name: '', order: Number.MAX_SAFE_INTEGER };
    const data = a.data || {};
    matched.push({
      annotationId: a.id,
      sheetId: a.sheetId,
      sheetName: sheet.name,
      sheetOrder: sheet.order,
      label: asText(data.label),
      labelKey: asText(data.labelKey) || model.toLabelKey(asText(data.label)),
      from: asText(data.from),
      to: asText(data.to),
      cable: asText(data.cable),
      room: asText(data.room),
      notes: asText(data.notes),
      at: a.at,
      rank: hit.rank,
      matchedField: hit.field,
    });
  });

  // Deterministic: score, then sheet order, then label, then id. Two genuine
  // labels sharing a name are BOTH kept — HR-07 can legitimately exist on two
  // sheets and hiding one would be a lie about the job.
  matched.sort((a, b) => (b.rank - a.rank)
    || (a.sheetOrder - b.sheetOrder)
    || (a.labelKey < b.labelKey ? -1 : a.labelKey > b.labelKey ? 1 : 0)
    || (a.annotationId < b.annotationId ? -1 : a.annotationId > b.annotationId ? 1 : 0));

  return {
    query,
    results: matched.slice(0, limit),
    total: matched.length,
    truncated: matched.length > limit,
  };
}

/** Short human summary of the result count, for the caller to display. */
function summarize(outcome, limit) {
  const cap = Number.isFinite(limit) && limit > 0 ? limit : MAX_VISIBLE_RESULTS;
  if (!outcome || !outcome.query) return 'Enter a wire label or related term.';
  if (outcome.total === 0) return 'No matching wire labels.';
  if (outcome.truncated) return cap + '+ results \u2014 refine your search';
  return outcome.total === 1 ? '1 result' : outcome.total + ' results';
}

module.exports = {
  MAX_VISIBLE_RESULTS,
  RANK,
  METADATA_FIELDS,
  normalizeQuery,
  classify,
  search,
  summarize,
  fold,
};
