'use strict';
/**
 * Empire Code — STAGE5 conversational calculator registry (docs/conversation-tools-contract.md).
 *
 * A narrow, typed ALLOWLIST between an interpreted conversation and the existing deterministic engines.
 * The conversation side may only state INPUT changes for a named tool; this module validates them against a
 * closed schema, merges them into an immutable draft, and — when nothing required is missing — calls the ONE
 * canonical engine export for that tool. Every number, decision, warning and reference in a result is taken
 * from the engine's own return value; nothing is recalculated here and no formula is copied.
 *
 * Pure: no DOM, no storage, no network, no clock, no randomness — at import or at execution.
 * Not here, by contract: persistence, record creation, installation approval, the stage-4 adoption helper
 * (adoptPlannedConductorDeclaration is never called or exposed), free-form JSON/JS/endpoint execution.
 *
 * Dependencies are local calc modules only ('./x' — resolved by the tools/build-calc.js shim without any alias).
 */
const T = require('./tables');
const batteryRuntime = require('./batteryRuntime');
const ampacity = require('./ampacity');
const voltageDrop = require('./voltageDrop');
const wireSizing = require('./wireSizing');
const conduitFill = require('./conduitFill');
const boxFill = require('./boxFill');
const motor = require('./motor');
const grounding = require('./grounding');
const pullBox = require('./pullBox');
const facade = require('./loadCalcFacade.js');
const serviceSizing = require('./loadCalcServiceSizing.js');

const CONTRACT_REVISION = 1;
const DRAFT_KIND = 'ec.conversationTool.draft';
const RESULT_KIND = 'ec.conversationTool.result';
const FINGERPRINT_DOMAIN = 'empire-code/stage5-conversation-tool-input/1';
const FINGERPRINT_ALGORITHM = 'ct1 = two FNV-1a 32-bit passes + length over canonical JSON text; a NON-cryptographic change detector, not a signature';
const PROVIDER_TOOL_PREFIX = 'ec_calc_';
const OPEN_TOOL_NAME = 'ec_open_tool';
const CONTEXT_ACTION = 'run_with_imported_context';
const ORIGINS = Object.freeze(['conversation', 'current_form']);
const STATUS = Object.freeze({
  COMPLETE: 'complete', PARTIAL: 'partial', PRELIMINARY: 'preliminary', NEEDS_INPUT: 'needs_input', INVALID_INPUT: 'invalid_input',
  UNSUPPORTED: 'unsupported', BLOCKED: 'blocked', NAVIGATION_ONLY: 'navigation_only', ERROR: 'error',
});
const STATUS_VALUES = Object.freeze(Object.keys(STATUS).map((k) => STATUS[k]));
const STATUS_LABEL = Object.freeze({
  complete: { pl: 'WYNIK', en: 'RESULT' },
  partial: { pl: 'WYNIK CZĘŚCIOWY — nie jest to pełny wynik', en: 'PARTIAL RESULT — not a full result' },
  preliminary: { pl: 'WSTĘPNE — nie jest to wynik końcowy', en: 'PRELIMINARY — not a final result' },
  needs_input: { pl: 'BRAK DANYCH — nic nie policzono', en: 'INPUT NEEDED — nothing was calculated' },
  invalid_input: { pl: 'BŁĘDNE DANE — nic nie policzono', en: 'INVALID INPUT — nothing was calculated' },
  unsupported: { pl: 'POZA ZAKRESEM NARZĘDZIA — brak wyniku', en: 'OUTSIDE THE TOOL SCOPE — no result' },
  blocked: { pl: 'ZABLOKOWANE — brak wyniku końcowego', en: 'BLOCKED — no final result' },
  navigation_only: { pl: 'TYLKO NAWIGACJA — asystent tego nie liczy', en: 'NAVIGATION ONLY — the assistant does not calculate this' },
  error: { pl: 'BŁĄD SILNIKA — brak wyniku', en: 'ENGINE FAULT — no result' },
});

// ── small pure helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bi = (pl, en) => ({ pl, en });
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const LIMITS = Object.freeze({ stringMax: 64, jsonDepth: 24, jsonNodes: 60000, jsonString: 8000, jsonArray: 5000, problemsListed: 50 });

function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}
/**
 * Structural copy of an engine return value (plain objects and arrays; undefined members kept). The engine's own object is never frozen or kept.
 * Only an own '__proto__' key is left out (assigning it would set a prototype, not data). 'constructor' and 'prototype' are ordinary DATA keys
 * in a result — flags.prototype is one — and are copied; INPUT keys are policed separately by ownKeysChecked (FORBIDDEN_KEYS).
 */
function snapshot(v, depth) {
  const d = depth === undefined ? 0 : depth;
  if (v === null || typeof v !== 'object' || d > 64) return v;
  if (Array.isArray(v)) return v.map((x) => snapshot(x, d + 1));
  if (!isPlain(v)) return v;
  const out = {};
  for (const k of Object.keys(v)) if (k !== '__proto__') out[k] = snapshot(v[k], d + 1);
  return out;
}
/**
 * Deep-frozen copy of a re-hydrated (stored, unfrozen) result — member for member, nothing dropped — or null when it cannot be copied whole:
 * an own '__proto__' key, a non-plain object, a function / symbol / bigint, or nesting beyond 64. A result that is not whole is never attached.
 */
function hydrateStoredResult(r) {
  let whole = true;
  const copy = (v, d) => {
    if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return v;
    if (typeof v !== 'object' || d > 64) { whole = false; return null; }
    if (Array.isArray(v)) return v.map((x) => copy(x, d + 1));
    if (!isPlain(v)) { whole = false; return null; }
    const out = {};
    for (const k of Object.keys(v)) { if (k === '__proto__') { whole = false; continue; } out[k] = copy(v[k], d + 1); }
    return out;
  };
  const out = copy(r, 0);
  return whole ? deepFreeze(out) : null;
}
/** Canonical JSON text: object keys sorted, undefined members omitted, -0 kept distinct. */
function canonicalText(v, depth) {
  const d = depth === undefined ? 0 : depth;
  if (d > 80) throw new RangeError('canonical text: nesting exceeds 80');
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? '-0' : String(v)) : JSON.stringify(`[number ${String(v)}]`);
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => canonicalText(x, d + 1)).join(',')}]`;
  if (t === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalText(v[k], d + 1)}`).join(',')}}`;
  return JSON.stringify(`[${t}]`);
}
function fnv1a32(text, seed) { let h = seed >>> 0; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
const hex8 = (n) => `00000000${(n >>> 0).toString(16)}`.slice(-8);
const fingerprintOfText = (text) => `ct1-${hex8(fnv1a32(text, 2166136261))}${hex8(fnv1a32(text, (0x9747b28c ^ text.length) >>> 0))}-${text.length.toString(16)}`;
const fingerprintOf = (toolId, input) => fingerprintOfText(`${FINGERPRINT_DOMAIN}\n${toolId}\n${canonicalText(input)}`);

const ERROR_TEXT = {
  UNKNOWN_TOOL: bi('Nieznane narzędzie.', 'Unknown tool.'),
  TOOL_NOT_EXECUTABLE: bi('To narzędzie nie ma czystego modułu obliczeniowego — tylko nawigacja.', 'This tool has no pure calculation module — navigation only.'),
  PATCH_NOT_OBJECT: bi('Zmiana musi być zwykłym obiektem { set, clear }.', 'The change must be a plain { set, clear } object.'),
  NOT_PLAIN_OBJECT: bi('Oczekiwano zwykłego obiektu.', 'A plain object was expected.'),
  UNKNOWN_FIELD: bi('Nieznane pole — odrzucono.', 'Unknown field — rejected.'),
  PROTOTYPE_KEY: bi('Niedozwolony klucz prototypu.', 'Prototype key not allowed.'),
  SYMBOL_KEY: bi('Klucze-symbole są niedozwolone.', 'Symbol keys are not allowed.'),
  ACCESSOR_NOT_ALLOWED: bi('Właściwości z getterem/setterem są niedozwolone.', 'Accessor properties are not allowed.'),
  WRONG_TYPE: bi('Zły typ wartości (bez cichej konwersji).', 'Wrong value type (no silent coercion).'),
  NOT_FINITE: bi('Liczba musi być skończona.', 'The number must be finite.'),
  NOT_INTEGER: bi('Wymagana liczba całkowita.', 'An integer is required.'),
  OUT_OF_RANGE: bi('Wartość poza dozwolonym zakresem.', 'Value outside the permitted range.'),
  NOT_IN_ENUM: bi('Wartość spoza zamkniętej listy.', 'Value is not in the closed list.'),
  STRING_LENGTH: bi('Tekst pusty albo zbyt długi.', 'Text is empty or too long.'),
  ARRAY_LENGTH: bi('Liczba elementów listy poza limitem.', 'List length outside the limit.'),
  MISSING_NESTED_FIELD: bi('Brak wymaganego pola w obiekcie.', 'A required member of the object is missing.'),
  JSON_LIMIT: bi('Dane kontekstu przekraczają limity (głębokość/rozmiar).', 'Context data exceeds the limits (depth/size).'),
  CONTEXT_ONLY_FIELD: bi('To pole może pochodzić wyłącznie z jawnie zaimportowanego formularza, nie z rozmowy.', 'This field may only come from an explicitly imported form, not from the conversation.'),
  CONFLICTING_PATCH: bi('To samo pole jest jednocześnie ustawiane i czyszczone.', 'The same field is both set and cleared.'),
  UNKNOWN_ORIGIN: bi('Nieznane źródło danych.', 'Unknown data origin.'),
  INVALID_DRAFT: bi('Nieprawidłowy szkic narzędzia.', 'Invalid tool draft.'),
  STALE_FINGERPRINT: bi('Odcisk danych nie zgadza się z danymi szkicu.', 'The input fingerprint does not match the draft input.'),
  INVALID_ACTION: bi('Nieprawidłowe wywołanie narzędzia.', 'Invalid tool call.'),
  ENGINE_FAULT: bi('Nieoczekiwany błąd silnika obliczeń.', 'Unexpected calculation engine fault.'),
  UNCLASSIFIED_RESULT: bi('Odpowiedź silnika ma nieznany kształt lub status — nie potraktowano jej jako wyniku.', 'The engine answer has an unknown shape or status — it was not treated as a result.'),
};
const err = (code, field, detail) => ({ code, field: field === undefined ? null : field, source: 'registry', message: ERROR_TEXT[code] || bi(code, code), detail: detail === undefined ? null : detail });

// ── closed value descriptors ────────────────────────────────────────────────────────────────────────────────────────
const num = (o) => Object.assign({ kind: 'number' }, o || {});
const int = (o) => Object.assign({ kind: 'number', integer: true }, o || {});
const en = (values, o) => Object.assign({ kind: 'enum', values: Object.freeze(values.slice()) }, o || {});
const bool = () => ({ kind: 'boolean' });
const str = (o) => Object.assign({ kind: 'string', maxLength: LIMITS.stringMax }, o || {});
const obj = (fields) => ({ kind: 'object', fields });
const arr = (item, minItems, maxItems) => ({ kind: 'array', item, minItems, maxItems });
const json = () => ({ kind: 'json' });
/** Top-level tool field. opts.req: true (default) | false | (input) => boolean. opts.origin: 'any' (default) | 'context'. */
function field(type, opts, label, question) {
  const o = opts || {};
  return Object.assign({}, type, {
    required: o.req === undefined ? true : o.req, requiredWhen: o.when || null, origin: o.origin || 'any', unit: o.unit || null, label, question,
  });
}

function ownKeysChecked(o, path, errors) {
  const keys = []; let ok = true;
  for (const k of Reflect.ownKeys(o)) {
    const p = path ? `${path}.${String(k)}` : String(k);
    if (typeof k !== 'string') { errors.push(err('SYMBOL_KEY', path || null)); ok = false; continue; }
    if (FORBIDDEN_KEYS.includes(k)) { errors.push(err('PROTOTYPE_KEY', p)); ok = false; continue; }
    const d = Object.getOwnPropertyDescriptor(o, k);
    if (!d || typeof d.get === 'function' || typeof d.set === 'function' || !own(d, 'value')) { errors.push(err('ACCESSOR_NOT_ALLOWED', p)); ok = false; continue; }
    keys.push(k);
  }
  return ok ? keys : null;
}

/** Bounded plain-JSON copy for context-only fields (the engine's own boundary validates the meaning). */
function readJson(v, path, errors, budget, depth) {
  if (depth > LIMITS.jsonDepth || (budget.nodes += 1) > LIMITS.jsonNodes) { if (!budget.failed) { budget.failed = true; errors.push(err('JSON_LIMIT', path)); } return undefined; }
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) { errors.push(err('NOT_FINITE', path)); return undefined; } return v; }
  if (typeof v === 'string') { if (v.length > LIMITS.jsonString) { errors.push(err('STRING_LENGTH', path)); return undefined; } return v; }
  if (Array.isArray(v)) {
    if (v.length > LIMITS.jsonArray) { errors.push(err('ARRAY_LENGTH', path)); return undefined; }
    const out = [];
    for (let i = 0; i < v.length; i++) out.push(readJson(v[i], `${path}[${i}]`, errors, budget, depth + 1));
    return out;
  }
  if (!isPlain(v)) { errors.push(err(typeof v === 'object' ? 'NOT_PLAIN_OBJECT' : 'WRONG_TYPE', path)); return undefined; }
  const keys = ownKeysChecked(v, path, errors);
  if (!keys) return undefined;
  const out = {};
  for (const k of keys) out[k] = readJson(v[k], `${path}.${k}`, errors, budget, depth + 1);
  return out;
}

/** Validate one value against a closed descriptor. Returns the normalized copy, or undefined after pushing errors. Never coerces. */
function readValue(d, v, path, errors) {
  const bad = (code, detail) => { errors.push(err(code, path, detail)); return undefined; };
  if (d.kind === 'number') {
    if (typeof v !== 'number') return bad('WRONG_TYPE', 'number expected');
    if (!Number.isFinite(v)) return bad('NOT_FINITE');
    if (d.integer && !Number.isInteger(v)) return bad('NOT_INTEGER');
    if (d.min !== undefined && (d.exclusiveMin ? !(v > d.min) : v < d.min)) return bad('OUT_OF_RANGE', `${d.exclusiveMin ? '>' : '>='} ${d.min}`);
    if (d.max !== undefined && v > d.max) return bad('OUT_OF_RANGE', `<= ${d.max}`);
    return v === 0 ? 0 : v;
  }
  if (d.kind === 'boolean') return typeof v === 'boolean' ? v : bad('WRONG_TYPE', 'boolean expected');
  if (d.kind === 'string') {
    if (typeof v !== 'string') return bad('WRONG_TYPE', 'string expected');
    return v.length >= 1 && v.length <= d.maxLength ? v : bad('STRING_LENGTH');
  }
  if (d.kind === 'enum') {
    if (typeof v !== typeof d.values[0]) return bad('WRONG_TYPE', `${typeof d.values[0]} expected`);
    if (d.deferToEngine) {   // the engine owns this enum and its precise refusal reason; only the shape is bounded here
      if (typeof v === 'string' && (v.length < 1 || v.length > LIMITS.stringMax)) return bad('STRING_LENGTH');
      if (typeof v === 'number' && !Number.isFinite(v)) return bad('NOT_FINITE');
      return v;
    }
    return d.values.includes(v) ? v : bad('NOT_IN_ENUM', d.values.join(' | '));
  }
  if (d.kind === 'object') {
    if (!isPlain(v)) return bad('NOT_PLAIN_OBJECT');
    const keys = ownKeysChecked(v, path, errors);
    if (!keys) return undefined;
    let ok = true; const out = {};
    for (const k of keys) if (!own(d.fields, k)) { errors.push(err('UNKNOWN_FIELD', `${path}.${k}`)); ok = false; }
    for (const k of Object.keys(d.fields)) {
      if (!own(v, k) || v[k] === null || v[k] === undefined) { errors.push(err('MISSING_NESTED_FIELD', `${path}.${k}`)); ok = false; continue; }
      const before = errors.length; const x = readValue(d.fields[k], v[k], `${path}.${k}`, errors);
      if (errors.length !== before) ok = false; else out[k] = x;
    }
    return ok ? out : undefined;
  }
  if (d.kind === 'array') {
    if (!Array.isArray(v)) return bad('WRONG_TYPE', 'array expected');
    if (v.length < d.minItems || v.length > d.maxItems) return bad('ARRAY_LENGTH', `${d.minItems}..${d.maxItems}`);
    let ok = true; const out = [];
    for (let i = 0; i < v.length; i++) {
      const before = errors.length; const x = readValue(d.item, v[i], `${path}[${i}]`, errors);
      if (errors.length !== before) ok = false; else out.push(x);
    }
    return ok ? out : undefined;
  }
  if (d.kind === 'json') {
    const before = errors.length; const x = readJson(v, path, errors, { nodes: 0, failed: false }, 0);
    return errors.length === before ? x : undefined;
  }
  return bad('WRONG_TYPE');
}

// ── enum sources: read from the engines' own tables/exports, never retyped ──────────────────────────────────────────
const unionKeys = (...objs) => { const out = []; for (const o of objs) for (const k of Object.keys(o)) if (!out.includes(k)) out.push(k); return out; };
const AWG_ORDER = ['18', '16', '14', '12', '10', '8', '6', '4', '3', '2', '1', '1/0', '2/0', '3/0', '4/0'];
const sizeRank = (s) => (AWG_ORDER.includes(s) ? AWG_ORDER.indexOf(s) : 100 + Number(s));
const bySize = (keys) => keys.slice().sort((a, b) => sizeRank(a) - sizeRank(b));
const fractionValue = (s) => { const m = /^(\d+)\/(\d+)$/.exec(s); return m ? Number(m[1]) / Number(m[2]) : Number(s); };
const MATERIALS = ['cu', 'al'];
/** ampacity.js documents exactly these; any other string would silently read the 90 °C column, so the registry closes the list. */
const INSULATIONS = ['tw', 'thw', 'thhn', 'xhhw'];
const AMPACITY_SIZES = bySize(unionKeys(T.AMP_CU, T.AMP_AL));
const VD_SIZES = voltageDrop.ASCENDING_SIZES.slice();
const CONDUIT_TYPES = Object.keys(T.CF_AREA);
const CONDUIT_SIZES = unionKeys(...CONDUIT_TYPES.map((k) => T.CF_AREA[k])).sort((a, b) => Number(a) - Number(b));
const CF_WIRE_TYPES = Object.keys(T.CF_WIRE);
const CF_WIRE_SIZES = bySize(unionKeys(...CF_WIRE_TYPES.map((k) => T.CF_WIRE[k])));
const WW_WIRE_TYPES = Object.keys(T.WW_AREAS);
const WW_WIRE_SIZES = bySize(unionKeys(...WW_WIRE_TYPES.map((k) => T.WW_AREAS[k])));
const BOX_KEYS = Object.keys(T.BF_BOXES);
const BOX_WIRE_SIZES = bySize(Object.keys(T.BF_VOL));
const MOTOR_HP = unionKeys(T.MT_FLC_1PH, T.MT_FLC_3PH).sort((a, b) => fractionValue(a) - fractionValue(b));
const MOTOR_VOLTS = unionKeys(Object.fromEntries(T.MT_V_1PH.map((v) => [v, 1])), Object.fromEntries(T.MT_V_3PH.map((v) => [v, 1]))).map(Number).sort((a, b) => a - b);
const MOTOR_TYPES = Object.keys(T.MT_PCT);
const MOTOR_OCPD_TYPES = unionKeys(...MOTOR_TYPES.map((k) => T.MT_PCT[k]));
const GROUND_SIZES = bySize(Object.keys(T.GND_CM));
/** grounding.js validates the electrode itself (INVALID_ELECTRODE); its list is not exported, so this mirrors its documented input. */
const ELECTRODES = ['water', 'rod', 'ufer', 'ring'];
const GROUND_RING_VALUES = Object.values(grounding.GROUND_RING);

const sizeLabel = (s) => (/^\d{3,4}$/.test(String(s)) ? `${s} kcmil` : (String(s).includes('/') ? `${s} AWG` : `#${s} AWG`));
const upper = (s) => String(s).toUpperCase();
const enNum = (s) => String(s).replace(/,/g, '.');
const pick = (input, keys) => { const out = {}; for (const k of keys) if (own(input, k)) out[k] = input[k]; return out; };

/** Engine reasons that mean "outside what the tool/table covers" (honest unsupported), not "your input is malformed". */
const UNSUPPORTED_REASONS = new Set(['SIZE_NOT_IN_TABLE', 'NOT_IN_TABLE', 'CONDUIT_NOT_IN_TABLE', 'WIRE_NOT_IN_TABLE', 'BOX_NOT_IN_TABLE',
  'TABLE_FACTOR_UNAVAILABLE_FOR_RATING', 'AMBIENT_ABOVE_TABLE', 'BAND_MISSING_FROM_TABLE', 'OCPD_ABOVE_TABLE', 'NO_ROW', 'UNKNOWN_DEVICE',
  'UNSUPPORTED_SURFACE', 'CONNECTION_ARITY', 'UNSUPPORTED_CONTRACT', 'UNSUPPORTED_RULE_BASIS']);
function engineFailure(core, source) {
  const reason = core && typeof core.reason === 'string' ? core.reason : 'ENGINE_REFUSED';
  const out = {
    status: UNSUPPORTED_REASONS.has(reason) ? STATUS.UNSUPPORTED : STATUS.INVALID_INPUT, coreStatus: reason,
    errors: [{ code: reason, field: core && typeof core.field === 'string' ? core.field : null, source: 'engine', message: bi(`Silnik odmówił wyniku: ${reason}.`, `The calculator refused: ${reason}.`), detail: null }],
    summary: [bi(`Brak wyniku — powód silnika: ${reason}.`, `No result — engine reason: ${reason}.`)],
    warnings: [],
  };
  if (core && typeof core.note === 'string') out.warnings.push({ code: 'ENGINE_NOTE', source, text: core.note });
  if (core && typeof core.detail === 'string') out.warnings.push({ code: 'ENGINE_DETAIL', source, text: core.detail });
  return out;
}
const NOT_APPROVAL = bi('To wynik obliczeń modelu, nie zatwierdzenie instalacji.', 'This is a model calculation result, not an installation approval.');

// ── tool definitions ────────────────────────────────────────────────────────────────────────────────────────────────
const matField = (pl, en2) => field(en(MATERIALS), {}, bi(pl, en2), bi(`${pl}: miedź (cu) czy aluminium (al)?`, `${en2}: copper (cu) or aluminium (al)?`));
const FORM_Q = (pl, en2) => bi(`${pl} Asystent nie tworzy tych danych — otwórz formularz i zaimportuj bieżące dane.`, `${en2} The assistant does not author this data — open the form and import its current data.`);

const ESTIMATE_WHEN = 'the application context has not switched on the documented estimates (useDocumentedEstimates is context-only: the model cannot opt in — pass the value the user stated, or null so that the user is asked)';

const TOOLS = {};
function defineTool(def) { TOOLS[def.id] = def; }

defineTool({
  id: 'battery_runtime', title: bi('Czas pracy baterii (Wh)', 'Battery runtime (Wh)'),
  engine: { module: 'batteryRuntime', fn: 'calculateBatteryRuntime' }, form: { panelId: null, name: 'Converter — Wh runtime' },
  fields: {
    capacityWh: field(num(), { unit: 'Wh' }, bi('Pojemność baterii', 'Battery capacity'), bi('Jaka jest pojemność baterii w Wh?', 'What is the battery capacity in Wh?')),
    consumptionMode: field(en(batteryRuntime.MODES), {}, bi('Jednostka zużycia', 'Consumption unit'),
      bi('W jakiej jednostce podajesz zużycie: W (średnia moc), kWh/dobę czy kWh/rok? Nie zgaduję jednostki.', 'Which unit is the consumption in: W (average power), kWh/day or kWh/year? The unit is never guessed.')),
    consumption: field(num(), { unit: 'W | kWh/day | kWh/year (per consumptionMode)' }, bi('Zużycie', 'Consumption'), bi('Jakie jest zużycie (liczba w wybranej jednostce)?', 'What is the consumption (a number in the chosen unit)?')),
    chargePercent: field(num(), { unit: '%', req: (i) => i.useDocumentedEstimates !== true, when: ESTIMATE_WHEN }, bi('Naładowanie', 'State of charge'),
      bi('Jaki jest poziom naładowania w %? (Asystent sam nie przyjmuje 100%: udokumentowany szacunek można włączyć tylko wyraźnym potwierdzeniem w aplikacji.)',
        'What is the state of charge in %? (The assistant never assumes 100%: the documented estimate can be switched on only by an explicit confirmation in the app.)')),
    usablePercent: field(num(), { unit: '%', req: (i) => i.useDocumentedEstimates !== true, when: ESTIMATE_WHEN }, bi('Energia użyteczna', 'Usable energy'),
      bi('Jaki procent energii jest użyteczny (straty)? (Asystent sam nie przyjmuje 85%: edytowalny szacunek można włączyć tylko wyraźnym potwierdzeniem w aplikacji.)',
        'What percentage of the energy is usable (losses)? (The assistant never assumes 85%: the editable estimate can be switched on only by an explicit confirmation in the app.)')),
    // CONTEXT-ONLY: the opt-in is not a model argument. Only an explicit application / user-context import (origin 'current_form') may set, change or clear it.
    useDocumentedEstimates: field(bool(), { req: false, origin: 'context' }, bi('Użyj udokumentowanych szacunków', 'Use the documented estimates'),
      bi('Czy przyjąć udokumentowane szacunki: naładowanie 100% i energia użyteczna 85%? (Potwierdza użytkownik w aplikacji, nie asystent.)', 'Accept the documented estimates: 100% charge and 85% usable energy? (Confirmed by the user in the app, not by the assistant.)')),
  },
  prepare: (i) => ({ args: [pick(i, ['capacityWh', 'consumptionMode', 'consumption', 'chargePercent', 'usablePercent'])] }),
  call: (a) => batteryRuntime.calculateBatteryRuntime(a[0]),
  interpret(core, i) {
    if (!core.ok) {
      return {
        status: STATUS.INVALID_INPUT, coreStatus: core.errors[0] ? core.errors[0].code : 'INVALID',
        errors: core.errors.map((e) => ({ code: e.code, field: e.field, source: 'engine', message: bi(e.message, `${e.field}: ${e.code}`), detail: null })),
        summary: [bi('Brak wyniku — popraw wskazane pola.', 'No result — correct the listed fields.')],
      };
    }
    const d = core.data; const x = d.duration;
    const durEn = x.kind === 'zero' ? '0 h — battery empty' : x.kind === 'under_minute' ? 'Less than 1 min'
      : x.kind === 'hours_minutes' ? (x.hours === 0 ? `About ${x.minutes} min` : `About ${x.hours} h ${x.minutes} min`) : `About ${x.days} d ${x.hours} h`;
    const assumptions = [];
    for (const f of ['chargePercent', 'usablePercent']) {
      if (!own(i, f)) {
        assumptions.push({ field: f, value: d[f], unit: '%', source: 'batteryRuntime.DEFAULTS', basis: 'documented_editable_estimate', userStated: false,
          note: bi(`${f}: przyjęto udokumentowany, edytowalny szacunek ${d[f]}% (wyraźne włączenie w kontekście aplikacji, nie przez asystenta) — to nie jest wartość zmierzona.`,
            `${f}: the documented editable estimate ${d[f]}% was used (explicit opt-in from the application context, not by the assistant) — it is not a measured value.`) });
      }
    }
    assumptions.push({ field: null, value: null, unit: null, source: 'batteryRuntime.calculateBatteryRuntime', basis: 'engine_stated', userStated: false,
      note: bi(d.text.assumptions, `Assumptions: charge ${d.chargePercent}%, usable energy ${d.usablePercent}% (editable loss estimate), constant average draw ${enNum(d.text.averageW)}.`) });
    return {
      status: STATUS.COMPLETE, coreStatus: 'OK', assumptions,
      warnings: [{ code: 'RUNTIME_ONLY_NOT_STARTUP', source: 'batteryRuntime', text: 'Answers "how long", never "will it start": output type, continuous power and start-up surge are outside this tool.' }],
      summary: [
        bi(`Czas pracy: ${d.text.duration}`, `Runtime: ${durEn}`),
        bi(`Energia dostępna: ${d.text.availableWh} (${d.text.availableBasis})`, `Available energy: ${enNum(d.text.availableWh)} (${enNum(d.text.availableBasis)})`),
        bi(`Średni pobór: ${d.text.averageW} (${d.text.averageBasis})`, `Average draw: ${enNum(d.text.averageW)} (${d.consumptionMode === 'w' ? 'stated average power' : `${d.consumption} ${d.consumptionMode === 'kwh_day' ? 'kWh/day × 1000 ÷ 24 h' : 'kWh/year × 1000 ÷ 8760 h'}`})`),
      ],
    };
  },
});

defineTool({
  id: 'wire_sizing', title: bi('Dobór przewodu (Wire Sizer)', 'Conductor selection (Wire Sizer)'),
  engine: { module: 'wireSizing', fn: 'selectConductor' }, form: { panelId: 'panel-wiresizer', name: 'Wire Sizer' },
  fields: {
    noncontinuousLoadA: field(num({ min: 0, max: 100000 }), { unit: 'A' }, bi('Obciążenie nieciągłe', 'Noncontinuous load'),
      bi('Ile amperów obciążenia jest NIECIĄGŁE (0, jeśli całe jest ciągłe)? Bez tej podstawy nie dobieram przewodu.', 'How many amperes of the load are NONCONTINUOUS (0 if all of it is continuous)? Without this basis no conductor is selected.')),
    continuousLoadA: field(num({ min: 0, max: 100000 }), { unit: 'A' }, bi('Obciążenie ciągłe', 'Continuous load'),
      bi('Ile amperów obciążenia jest CIĄGŁE (3 h lub dłużej; 0, jeśli żadne)? Nie doliczam sam żadnego współczynnika.', 'How many amperes of the load are CONTINUOUS (3 h or more; 0 if none)? No factor is added by the assistant.')),
    material: matField('Materiał przewodu', 'Conductor material'),
    insulation: field(en(INSULATIONS), {}, bi('Izolacja', 'Insulation'), bi('Jaka izolacja: tw, thw, thhn czy xhhw?', 'Which insulation: tw, thw, thhn or xhhw?')),
    ambientF: field(num({ min: -100, max: 400 }), { unit: '°F' }, bi('Temperatura otoczenia', 'Ambient temperature'), bi('Jaka jest temperatura otoczenia w °F?', 'What is the ambient temperature in °F?')),
    adjustmentFactor: field(num({ min: 0, exclusiveMin: true, max: 1 }), { unit: 'factor' }, bi('Współczynnik liczby przewodów', 'Adjustment factor'),
      bi('Jaki współczynnik z Table 310.15(C)(1) dla liczby przewodów przewodzących prąd (1.0, jeśli do 3)?', 'Which Table 310.15(C)(1) adjustment factor for the number of current-carrying conductors (1.0 for up to 3)?')),
    terminalRatingC: field(en([60, 75]), { unit: '°C' }, bi('Temperatura zacisków', 'Terminal rating'), bi('Jaka jest temperatura znamionowa zacisków: 60 czy 75 °C?', 'What is the terminal temperature rating: 60 or 75 °C?')),
    circuitType: field(en(['BRANCH_CIRCUIT', 'FEEDER']), {}, bi('Rodzaj obwodu', 'Circuit type'), bi('To obwód odbiorczy (BRANCH_CIRCUIT) czy zasilający (FEEDER)?', 'Is this a branch circuit (BRANCH_CIRCUIT) or a feeder (FEEDER)?')),
    jurisdiction: field(en(['NYC', 'NEC']), {}, bi('Jurysdykcja', 'Jurisdiction'), bi('Stosować poprawki NYC (NYC) czy sam kod bazowy (NEC)?', 'Apply the NYC amendments (NYC) or the base code only (NEC)?')),
    feet: field(num({ min: 0, max: 100000 }), { unit: 'ft one-way' }, bi('Długość w jedną stronę', 'One-way length'),
      bi('Jaka jest długość w jedną stronę w stopach? (0 = świadomie bez sprawdzania spadku napięcia.)', 'What is the one-way length in feet? (0 = deliberately no voltage-drop check.)')),
    voltage: field(num({ min: 0, exclusiveMin: true, max: 100000 }), { unit: 'V', req: (i) => i.feet > 0, when: 'feet > 0' }, bi('Napięcie', 'Voltage'), bi('Jakie jest napięcie obwodu w V?', 'What is the circuit voltage in V?')),
    phase: field(en([1, 3]), { req: (i) => i.feet > 0, when: 'feet > 0' }, bi('Liczba faz', 'Phase'), bi('Obwód jednofazowy (1) czy trójfazowy (3)?', 'Single-phase (1) or three-phase (3)?')),
    maxVoltDropPercent: field(num({ min: 0, exclusiveMin: true, max: 100 }), { unit: '%', req: (i) => i.feet > 0, when: 'feet > 0' }, bi('Limit spadku napięcia', 'Voltage-drop limit'),
      bi('Jaki limit spadku napięcia w % przyjąć dla tego odcinka?', 'Which voltage-drop limit in % applies to this run?')),
    feedsDwellingUnit: field(bool(), { req: (i) => i.jurisdiction === 'NYC' && i.circuitType === 'FEEDER', when: 'jurisdiction NYC and circuitType FEEDER' }, bi('Zasila lokal mieszkalny', 'Feeds a dwelling unit'),
      bi('Czy ten feeder zasila lokal mieszkalny (minimum NYCEC 215.2(A)(1))?', 'Does this feeder supply a dwelling unit (NYCEC 215.2(A)(1) minimum)?')),
    assemblyRatedFor100PercentContinuousOperation: field(bool(), { req: false }, bi('Zespół 100% (wyjątek)', '100%-rated assembly (exception)'),
      bi('Czy cały zespół wraz z zabezpieczeniami jest wymieniony (listed) do pracy przy 100% wartości znamionowej?', 'Is the complete assembly, including the overcurrent devices, listed for operation at 100% of its rating?')),
    proposedOcpd: field(num({ min: 0, exclusiveMin: true, max: 100000 }), { unit: 'A', req: false }, bi('Proponowane zabezpieczenie', 'Proposed overcurrent device'), bi('Jakie zabezpieczenie nadprądowe (A) jest proponowane?', 'Which overcurrent device rating (A) is proposed?')),
  },
  prepare(i) {
    const a = pick(i, ['continuousLoadA', 'noncontinuousLoadA', 'feet', 'material', 'insulation', 'ambientF', 'adjustmentFactor', 'terminalRatingC', 'circuitType', 'jurisdiction',
      'voltage', 'phase', 'maxVoltDropPercent', 'assemblyRatedFor100PercentContinuousOperation', 'proposedOcpd']);
    a.feedsDwellingUnit = own(i, 'feedsDwellingUnit') ? i.feedsDwellingUnit : null;   // the engine's explicit "not stated" value
    return { args: [a] };
  },
  call: (a) => wireSizing.selectConductor(a[0]),
  interpret(core, i) {
    if (!core.ok) return engineFailure(core, 'wireSizing.selectConductor');
    const warnings = [
      { code: 'ENGINE_NOTE', source: 'wireSizing.selectConductor', text: core.note },
      { code: 'LOAD_BASIS_AS_STATED', source: 'registry', text: 'Sized for the continuous / noncontinuous amperes exactly as stated. The registry adds no factor and infers no continuity, phase or voltage; any multiplier in coreResult is the engine\'s own, applied to the stated continuous amperes only.' },
    ];
    if (!(i.feet > 0)) warnings.push({ code: 'VOLTAGE_DROP_NOT_CHECKED', source: 'registry', text: 'feet = 0: voltage drop was NOT evaluated. voltage / phase / maxVoltDropPercent echoed in coreResult are unused engine placeholders unless stated in normalizedInput.' });
    const assumptions = [];
    if (!own(i, 'assemblyRatedFor100PercentContinuousOperation')) {
      assumptions.push({ field: 'assemblyRatedFor100PercentContinuousOperation', value: core.hundredPercentRatedExceptionApplied, unit: null, source: 'wireSizing.selectConductor', basis: 'engine_default_exception_never_inferred', userStated: false,
        note: bi('Wyjątek dla zespołu 100% nie został podany — silnik go nie stosuje (nigdy nie jest domniemany).', 'The 100%-rated assembly exception was not stated — the engine does not apply it (never inferred).') });
    }
    if (!own(i, 'proposedOcpd') && core.recommended) {
      assumptions.push({ field: 'proposedOcpd', value: core.recommended.derivedOcpdForSizing, unit: 'A', source: 'wireSizing.selectConductor', basis: 'engine_check_basis_only', userStated: false,
        note: bi('Nie podano zabezpieczenia: silnik wyprowadził najmniejsze standardowe wyłącznie jako podstawę testu 240.4(D) — to nie jest dobór wyłącznika.', 'No overcurrent device was stated: the engine derived the smallest standard one solely as the 240.4(D) check basis — this is not a breaker selection.') });
    }
    // What the engine ACTUALLY did with the stated continuous amperes is read from its own result fields (never recomputed here).
    const mult = core.continuousLoadRuleApplied === true && typeof core.continuousLoadMultiplier === 'number' ? core.continuousLoadMultiplier : null;
    if (mult !== null) {
      warnings.push({ code: 'ENGINE_CONTINUOUS_LOAD_MULTIPLIER', source: 'wireSizing.selectConductor',
        text: `The engine applied its own continuous-load multiplier ×${mult} to the stated ${core.continuousLoadA} A continuous (coreResult.continuousLoadMultiplier / continuousLoadSizingRequirementA = ${core.continuousLoadSizingRequirementA} A). The result fields are authoritative; the generic sentence "Continuous-load factors are not applied" in the engine note does not describe this result.` });
    }
    const load = bi(`Obciążenie (jak podano): ciągłe ${core.continuousLoadA} A + nieciągłe ${core.noncontinuousLoadA} A; wymagana obciążalność wg silnika ${core.requiredConductorAmpacityA} A${mult !== null ? ` (silnik zastosował własny mnożnik ×${mult} do obciążenia ciągłego)` : ''}.`,
      `Load (as stated): continuous ${core.continuousLoadA} A + noncontinuous ${core.noncontinuousLoadA} A; engine-required ampacity ${core.requiredConductorAmpacityA} A${mult !== null ? ` (the engine applied its own ×${mult} multiplier to the continuous amperes)` : ''}.`);
    if (typeof core.finalSelectedConductor !== 'string' || core.finalSelectedConductor === '') {
      return { status: STATUS.UNSUPPORTED, coreStatus: 'NO_CONDUCTOR_QUALIFIES', warnings, assumptions, references: core.codeReferences,
        unresolved: [{ code: 'NO_CONDUCTOR_QUALIFIES', field: null, source: 'engine', message: bi('Żaden pojedynczy przewód z tabeli nie spełnia wszystkich warunków.', 'No single conductor in the table satisfies every condition.') }],
        summary: [bi('Brak doboru: żaden pojedynczy przewód nie spełnia warunków.', 'No selection: no single conductor qualifies.'), load] };
    }
    const w = core.recommended; const s = core.finalSelectedConductor;
    const summary = [
      bi(`Przewód: ${sizeLabel(s)} ${upper(core.material)} (czynnik decydujący: ${core.governingConstraint}).`, `Conductor: ${sizeLabel(s)} ${upper(core.material)} (governing constraint: ${core.governingConstraint}).`),
      load,
    ];
    if (w && typeof w.voltDropPercent === 'number') {
      summary.push(bi(`Spadek napięcia: ${w.voltDropPercent.toFixed(2)}% (limit ${core.maxVoltDropPercent}%), ${core.feet} ft, ${core.voltage} V, ${core.phase}-faz.`,
        `Voltage drop: ${w.voltDropPercent.toFixed(2)}% (limit ${core.maxVoltDropPercent}%), ${core.feet} ft, ${core.voltage} V, ${core.phase}-phase.`));
    }
    summary.push(NOT_APPROVAL);
    return { status: STATUS.COMPLETE, coreStatus: 'OK', warnings, assumptions, references: core.codeReferences, summary };
  },
});

defineTool({
  id: 'ampacity', title: bi('Obciążalność przewodu', 'Conductor ampacity'),
  engine: { module: 'ampacity', fn: 'calculateAmpacity' }, form: { panelId: 'panel-ampacity', name: 'Ampacity' },
  fields: {
    size: field(en(AMPACITY_SIZES), {}, bi('Rozmiar przewodu', 'Conductor size'), bi('Jaki jest rozmiar przewodu (AWG/kcmil)?', 'What is the conductor size (AWG/kcmil)?')),
    material: matField('Materiał przewodu', 'Conductor material'),
    insulation: field(en(INSULATIONS), {}, bi('Izolacja', 'Insulation'), bi('Jaka izolacja: tw, thw, thhn czy xhhw?', 'Which insulation: tw, thw, thhn or xhhw?')),
    ambientF: field(num({ min: -100, max: 400 }), { unit: '°F' }, bi('Temperatura otoczenia', 'Ambient temperature'), bi('Jaka jest temperatura otoczenia w °F?', 'What is the ambient temperature in °F?')),
    adjustmentFactor: field(num({ min: 0, exclusiveMin: true, max: 1 }), { unit: 'factor' }, bi('Współczynnik liczby przewodów', 'Adjustment factor'),
      bi('Jaki współczynnik z Table 310.15(C)(1) (1.0, jeśli do 3 przewodów przewodzących prąd)?', 'Which Table 310.15(C)(1) adjustment factor (1.0 for up to 3 current-carrying conductors)?')),
    terminalRatingC: field(en([60, 75]), { unit: '°C' }, bi('Temperatura zacisków', 'Terminal rating'), bi('Jaka jest temperatura znamionowa zacisków: 60 czy 75 °C?', 'What is the terminal temperature rating: 60 or 75 °C?')),
    onOrAboveRoof: field(bool(), {}, bi('Na dachu lub nad dachem', 'On or above a roof'), bi('Czy przewody biegną na dachu lub nad dachem?', 'Is the raceway/cable on or above a roof?')),
    rooftopDirectSunlight: field(bool(), { req: (i) => i.onOrAboveRoof === true, when: 'onOrAboveRoof is true' }, bi('Bezpośrednie nasłonecznienie', 'Direct sunlight'), bi('Czy są wystawione na bezpośrednie słońce?', 'Is it exposed to direct sunlight?')),
    rooftopClearanceInches: field(num({ min: 0, max: 1000 }), { unit: 'in', req: (i) => i.onOrAboveRoof === true && i.rooftopDirectSunlight === true, when: 'onOrAboveRoof and rooftopDirectSunlight are true' },
      bi('Odstęp od dachu', 'Clearance above the roof'), bi('Jaki jest odstęp od powierzchni dachu do spodu korytka/rury w calach?', 'What is the clearance from the roof surface to the bottom of the raceway, in inches?')),
  },
  prepare(i) {
    const a = pick(i, ['size', 'material', 'insulation', 'ambientF', 'adjustmentFactor', 'terminalRatingC']);
    // A clearance is passed only when stated: the engine reads a missing one as CLEARANCE_UNKNOWN, never as 0 in.
    a.rooftop = i.onOrAboveRoof === true ? Object.assign({ onOrAboveRoof: true, directSunlight: i.rooftopDirectSunlight === true }, pick(i, ['rooftopClearanceInches']).rooftopClearanceInches === undefined ? {} : { clearanceInches: i.rooftopClearanceInches }) : null;
    return { args: [a] };
  },
  call: (a) => ampacity.calculateAmpacity(a[0]),
  interpret(core) {
    const refs = ['NEC Table 310.16', 'NEC Table 310.15(B)(1)', 'NEC Table 310.15(C)(1)', 'NEC 110.14(C)'];
    if (core.rooftopAdjustmentApplied) refs.push(core.rooftopRule);
    if (!core.ok) return Object.assign(engineFailure(core, 'ampacity.calculateAmpacity'), { references: refs });
    return {
      status: STATUS.COMPLETE, coreStatus: 'OK', references: refs,
      warnings: [{ code: 'AMPACITY_ONLY_NOT_OCPD', source: 'registry', text: 'This is the conductor ampacity only. Overcurrent-device limits (240.4, including 240.4(D) for small conductors) and load suitability are not decided here.' }],
      summary: [
        bi(`Obciążalność: ${core.finalAmpacity} A — ${sizeLabel(core.size)} ${upper(core.material)} ${upper(core.insulation)}.`, `Ampacity: ${core.finalAmpacity} A — ${sizeLabel(core.size)} ${upper(core.material)} ${upper(core.insulation)}.`),
        bi(`Tabela ${core.baseAmpacity} A × korekcja ${core.correctionFactor} (${core.effectiveAmbientF} °F) × współczynnik ${core.adjustmentFactor} = ${core.afterAdjustment} A; limit zacisków ${core.terminalLimit} A${core.terminalLimitGoverns ? ' (decyduje)' : ''}.`,
          `Table ${core.baseAmpacity} A × correction ${core.correctionFactor} (${core.effectiveAmbientF} °F) × adjustment ${core.adjustmentFactor} = ${core.afterAdjustment} A; terminal limit ${core.terminalLimit} A${core.terminalLimitGoverns ? ' (governs)' : ''}.`),
        bi(`Dach: ${core.rooftopAdjustmentReason}${core.rooftopAdjustmentApplied ? ` (+${core.rooftopAdderF} °F)` : ''}.`, `Rooftop: ${core.rooftopAdjustmentReason}${core.rooftopAdjustmentApplied ? ` (+${core.rooftopAdderF} °F)` : ''}.`),
      ],
    };
  },
});

defineTool({
  id: 'voltage_drop', title: bi('Spadek napięcia (podany przewód)', 'Voltage drop (stated conductor)'),
  engine: { module: 'voltageDrop', fn: 'calculateVoltageDrop' }, form: { panelId: 'panel-vdrop', name: 'Voltage Drop' },
  fields: {
    amps: field(num({ min: 0, exclusiveMin: true, max: 100000 }), { unit: 'A' }, bi('Prąd', 'Current'), bi('Jaki prąd płynie w obwodzie (A)?', 'What current flows in the circuit (A)?')),
    feet: field(num({ min: 0, exclusiveMin: true, max: 100000 }), { unit: 'ft one-way' }, bi('Długość w jedną stronę', 'One-way length'), bi('Jaka jest długość w jedną stronę w stopach?', 'What is the one-way length in feet?')),
    voltage: field(num({ min: 0, exclusiveMin: true, max: 100000 }), { unit: 'V' }, bi('Napięcie', 'Voltage'), bi('Jakie jest napięcie obwodu w V?', 'What is the circuit voltage in V?')),
    phase: field(en([1, 3]), {}, bi('Liczba faz', 'Phase'), bi('Obwód jednofazowy (1) czy trójfazowy (3)?', 'Single-phase (1) or three-phase (3)?')),
    material: matField('Materiał przewodu', 'Conductor material'),
    size: field(en(VD_SIZES), {}, bi('Rozmiar przewodu', 'Conductor size'),
      bi('Dla jakiego KONKRETNEGO rozmiaru przewodu policzyć spadek? (Dobór przewodu to osobne narzędzie Wire Sizer.)', 'For which SPECIFIC conductor size should the drop be calculated? (Selecting a conductor is the separate Wire Sizer tool.)')),
  },
  prepare: (i) => ({ args: [pick(i, ['amps', 'feet', 'voltage', 'phase', 'material', 'size'])] }),
  call: (a) => voltageDrop.calculateVoltageDrop(a[0]),
  interpret(core, i) {
    if (!core.ok) return engineFailure(core, 'voltageDrop.calculateVoltageDrop');
    return {
      status: STATUS.COMPLETE, coreStatus: 'OK',
      references: ['NEC 210.19(A) / 215.2(A) informational notes', 'NYCEC 210.19(A) / 215.2(A)(1) (5% total, feeder + branch combined)'],
      warnings: [{ code: 'EXPLICIT_CONDUCTOR_ONLY', source: 'registry', text: 'Voltage drop of the one stated conductor. No limit was judged, no conductor was selected, and ampacity / overcurrent protection were not checked — this is not a wire sizing.' }],
      summary: [
        bi(`Spadek napięcia: ${core.voltageDrop} V = ${core.percentDropExact.toFixed(2)}% dla ${sizeLabel(i.size)} ${upper(i.material)}; napięcie na odbiorze ${core.voltageAtLoad} V.`,
          `Voltage drop: ${core.voltageDrop} V = ${core.percentDropExact.toFixed(2)}% for ${sizeLabel(i.size)} ${upper(i.material)}; voltage at the load ${core.voltageAtLoad} V.`),
        bi('Tylko spadek dla podanego przewodu — bez oceny limitu i bez doboru przewodu.', 'Drop for the stated conductor only — no limit verdict and no conductor selection.'),
      ],
    };
  },
});

const conduitRefs = (core) => ['NEC Chapter 9 Table 1', 'NEC Chapter 9 Table 4', 'NEC Chapter 9 Table 5'].concat(core && core.note7Applied ? ['NEC Chapter 9 Note 7'] : []);
const fillLine = (core, what) => bi(`${what.pl}: ${core.fillPercentUsed}% przekroju; zajęte ${core.usedArea} in² przy dopuszczalnych ${core.allowedArea} in² — ${core.fits ? 'MIEŚCI SIĘ w limicie modelu' : 'PRZEKRACZA limit'}.`,
  `${what.en}: ${core.fillPercentUsed}% of the cross-section; used ${core.usedArea} in² against ${core.allowedArea} in² allowed — ${core.fits ? 'WITHIN the modeled limit' : 'EXCEEDS the limit'}.`);
const conduitTypeField = () => field(en(CONDUIT_TYPES), {}, bi('Typ rury', 'Conduit type'), bi(`Jaki typ rury (${CONDUIT_TYPES.join(', ')})?`, `Which conduit type (${CONDUIT_TYPES.join(', ')})?`));
const conduitSizeField = () => field(en(CONDUIT_SIZES), { unit: 'trade size, decimal inches' }, bi('Rozmiar rury', 'Conduit trade size'), bi('Jaki rozmiar handlowy rury (np. 0.5, 0.75, 1)?', 'Which conduit trade size (e.g. 0.5, 0.75, 1)?'));

defineTool({
  id: 'conduit_fill', title: bi('Wypełnienie rury (jednakowe przewody)', 'Conduit fill (uniform conductors)'),
  engine: { module: 'conduitFill', fn: 'calculateConduitFill' }, form: { panelId: 'panel-conduit', name: 'Conduit Fill' },
  fields: {
    conduitType: conduitTypeField(), conduitSize: conduitSizeField(),
    wireType: field(en(CF_WIRE_TYPES), {}, bi('Typ przewodu', 'Wire type'), bi(`Jaki typ izolacji przewodów (${CF_WIRE_TYPES.join(', ')})?`, `Which wire insulation type (${CF_WIRE_TYPES.join(', ')})?`)),
    wireSize: field(en(CF_WIRE_SIZES), {}, bi('Rozmiar przewodu', 'Wire size'), bi('Jaki rozmiar przewodów?', 'Which wire size?')),
    numConductors: field(int({ min: 1, max: 1000 }), {}, bi('Liczba przewodów', 'Number of conductors'), bi('Ile przewodów jest w rurze?', 'How many conductors are in the conduit?')),
  },
  prepare: (i) => ({ args: [pick(i, ['conduitType', 'conduitSize', 'wireType', 'wireSize', 'numConductors'])] }),
  call: (a) => conduitFill.calculateConduitFill(a[0]),
  interpret(core) {
    if (!core.ok) return engineFailure(core, 'conduitFill.calculateConduitFill');
    return { status: STATUS.COMPLETE, coreStatus: 'OK', references: conduitRefs(core),
      summary: [fillLine(core, bi('Wypełnienie rury', 'Conduit fill')),
        bi(`Reguła ${core.fillRulePercent}% (Table 1); maks. ${core.maxConductors} takich przewodów${core.note7Applied ? ' (Note 7 zastosowana)' : ''}.`, `${core.fillRulePercent}% rule (Table 1); max ${core.maxConductors} such conductors${core.note7Applied ? ' (Note 7 applied)' : ''}.`)] };
  },
});

defineTool({
  id: 'conduit_fill_mixed', title: bi('Wypełnienie rury (różne przewody)', 'Conduit fill (mixed conductors)'),
  engine: { module: 'conduitFill', fn: 'calculateConduitFillMixed' }, form: { panelId: 'panel-conduit', name: 'Conduit Fill' },
  fields: {
    conduitType: conduitTypeField(), conduitSize: conduitSizeField(),
    conductors: field(arr(obj({ wireType: en(CF_WIRE_TYPES), wireSize: en(CF_WIRE_SIZES), qty: int({ min: 1, max: 1000 }) }), 1, 20), { unit: 'list of { wireType, wireSize, qty }, 1..20 groups' },
      bi('Grupy przewodów', 'Conductor groups'), bi('Podaj każdą grupę przewodów: typ, rozmiar i liczbę sztuk.', 'State every conductor group: type, size and quantity.')),
  },
  prepare: (i) => ({ args: [{ conduitType: i.conduitType, conduitSize: i.conduitSize, conductors: snapshot(i.conductors) }] }),
  call: (a) => conduitFill.calculateConduitFillMixed(a[0]),
  interpret(core) {
    if (!core.ok) return engineFailure(core, 'conduitFill.calculateConduitFillMixed');
    return { status: STATUS.COMPLETE, coreStatus: 'OK', references: conduitRefs(null),
      summary: [fillLine(core, bi('Wypełnienie rury (mieszane)', 'Conduit fill (mixed)')),
        bi(`Reguła ${core.fillRulePercent}% dla ${core.totalConductors} przewodów (Table 1).`, `${core.fillRulePercent}% rule for ${core.totalConductors} conductors (Table 1).`)] };
  },
});

defineTool({
  id: 'wireway_fill', title: bi('Wypełnienie korytka (wireway)', 'Wireway fill'),
  engine: { module: 'conduitFill', fn: 'calculateWirewayFill' }, form: { panelId: 'panel-conduit', name: 'Conduit Fill — Wireway' },
  fields: {
    width: field(num({ min: 0, exclusiveMin: true, max: 1000 }), { unit: 'in' }, bi('Szerokość wewnętrzna', 'Interior width'), bi('Jaka jest wewnętrzna szerokość korytka w calach?', 'What is the interior width of the wireway in inches?')),
    height: field(num({ min: 0, exclusiveMin: true, max: 1000 }), { unit: 'in' }, bi('Wysokość wewnętrzna', 'Interior height'), bi('Jaka jest wewnętrzna wysokość korytka w calach?', 'What is the interior height of the wireway in inches?')),
    wireType: field(en(WW_WIRE_TYPES), {}, bi('Typ przewodu', 'Wire type'), bi(`Jaki typ izolacji przewodów (${WW_WIRE_TYPES.join(', ')})?`, `Which wire insulation type (${WW_WIRE_TYPES.join(', ')})?`)),
    wireSize: field(en(WW_WIRE_SIZES), {}, bi('Rozmiar przewodu', 'Wire size'), bi('Jaki rozmiar przewodów?', 'Which wire size?')),
    numConductors: field(int({ min: 1, max: 100000 }), {}, bi('Liczba przewodów', 'Number of conductors'), bi('Ile przewodów jest w korytku?', 'How many conductors are in the wireway?')),
  },
  prepare: (i) => ({ args: [pick(i, ['width', 'height', 'wireType', 'wireSize', 'numConductors'])] }),
  call: (a) => conduitFill.calculateWirewayFill(a[0]),
  interpret(core) {
    if (!core.ok) return engineFailure(core, 'conduitFill.calculateWirewayFill');
    return { status: STATUS.COMPLETE, coreStatus: 'OK', references: ['NEC 376.22(A)'],
      summary: [fillLine(core, bi('Wypełnienie korytka (limit 20%)', 'Wireway fill (20% limit)')),
        bi(`Przekrój wewnętrzny ${core.interiorArea} in²; maks. ${core.maxConductors} takich przewodów.`, `Interior area ${core.interiorArea} in²; max ${core.maxConductors} such conductors.`)] };
  },
});

defineTool({
  id: 'box_fill', title: bi('Wypełnienie puszki (Box Fill)', 'Box fill'),
  engine: { module: 'boxFill', fn: 'calculateBoxFill' }, form: { panelId: 'panel-boxfill', name: 'Box Fill' },
  fields: {
    boxKey: field(en(BOX_KEYS), {}, bi('Puszka (klucz katalogu)', 'Box (catalog key)'), bi('Która puszka? Podaj typ/wymiar albo wybierz ją w formularzu Box Fill.', 'Which box? State its type/size or pick it in the Box Fill form.')),
    largestWireSize: field(en(BOX_WIRE_SIZES), { unit: 'AWG' }, bi('Największy przewód (rozmiar decydujący)', 'Largest conductor (governing size)'), bi('Jaki jest największy przewód w puszce (AWG)?', 'What is the largest conductor in the box (AWG)?')),
    numConductors: field(int({ min: 0, max: 100000 }), {}, bi('Liczone przewody', 'Counted conductors'), bi('Ile przewodów liczy się do wypełnienia (bez EGC)?', 'How many conductors count toward the fill (excluding EGCs)?')),
    numDevices: field(int({ min: 0, max: 100000 }), {}, bi('Osprzęt (jarzma)', 'Device yokes'), bi('Ile jarzm osprzętu (gniazda/łączniki)? 0, jeśli żadnego.', 'How many device yokes (receptacles/switches)? 0 if none.')),
    numSupportFittings: field(int({ min: 0, max: 100000 }), {}, bi('Złączki wsporcze', 'Support fittings'), bi('Ile złączek wsporczych (studs/hickeys)? 0, jeśli żadnej.', 'How many support fittings (studs/hickeys)? 0 if none.')),
    hasClamps: field(bool(), {}, bi('Zaciski wewnętrzne', 'Internal clamps'), bi('Czy puszka ma wewnętrzne zaciski kablowe?', 'Does the box have internal cable clamps?')),
    egcCount: field(int({ min: 0, max: 100000 }), {}, bi('Liczba wchodzących EGC / mostków', 'Entering EGCs / bonding jumpers'),
      bi('Ile przewodów ochronnych (EGC) i mostków wyrównawczych wchodzi do puszki? Brak odpowiedzi to nie zero.', 'How many equipment grounding conductors and bonding jumpers enter the box? A missing answer is not zero.')),
    egcSize: field(en(BOX_WIRE_SIZES), { unit: 'AWG', req: (i) => i.egcCount > 0, when: 'egcCount > 0' }, bi('Największy EGC', 'Largest EGC'), bi('Jaki jest rozmiar największego wchodzącego EGC / mostka (AWG)?', 'What is the size of the largest entering EGC / bonding jumper (AWG)?')),
    extensionVolume: field(num({ min: 0, max: 100000 }), { unit: 'in³' }, bi('Dodatkowa objętość (pierścień/nadstawka)', 'Added volume (ring / extension)'),
      bi('Jaka dodatkowa oznaczona objętość pierścienia/nadstawki w in³? 0, jeśli brak. (Pozycję katalogową wybierz w formularzu Box Fill.)', 'What marked added volume of a ring/extension in in³? 0 if none. (Pick a catalog accessory in the Box Fill form.)')),
  },
  prepare(i) {
    return { args: [Object.assign({ contract: boxFill.CONTRACT, ruleBasis: boxFill.RULE_BASIS },
      pick(i, ['boxKey', 'largestWireSize', 'numConductors', 'numDevices', 'numSupportFittings', 'hasClamps', 'egcCount', 'egcSize', 'extensionVolume']))] };
  },
  call: (a) => boxFill.calculateBoxFill(a[0]),
  interpret(core) {
    const refs = ['NEC 2020 314.16(A)', 'NEC 2020 314.16(B)', 'NEC 2020 314.16(B)(5)', 'NEC 2020 Table 314.16(B)'];
    if (!core.ok) return Object.assign(engineFailure(core, 'boxFill.calculateBoxFill'), { references: refs });
    return {
      status: STATUS.COMPLETE, coreStatus: 'OK', references: refs,
      warnings: [{ code: 'BOUNDED_MODEL', source: 'boxFill', text: 'Answers one bounded question: does the modeled fill fit the modeled volume? One governing size prices every non-EGC allowance; mixed sizes, 4 AWG+, conduit bodies and partitioned boxes are unsupported. Not an approval of the installation, device depth/compatibility or box material.' }],
      summary: [
        bi(`Wymagane ${core.display.required} in³ przy dostępnych ${core.display.available} in³ — ${core.fits ? 'MIEŚCI SIĘ w modelowanej objętości' : 'PRZEKROCZONE'} (pozostaje ${core.display.remaining} in³).`,
          `Required ${core.display.required} in³ against ${core.display.available} in³ available — ${core.fits ? 'FITS the modeled volume' : 'OVER'} (remaining ${core.display.remaining} in³).`),
        bi(`EGC: ${core.egc.count} szt.${core.egc.size ? `, największy #${core.egc.size}` : ''} → ${core.egcVolume} in³ (314.16(B)(5)); kontrakt ${core.contract}, ${core.ruleBasis}.`,
          `EGC: ${core.egc.count}${core.egc.size ? `, largest #${core.egc.size}` : ''} → ${core.egcVolume} in³ (314.16(B)(5)); contract ${core.contract}, ${core.ruleBasis}.`),
      ],
    };
  },
});

defineTool({
  id: 'motor_circuit', title: bi('Obwód silnika (Art. 430)', 'Motor circuit (Art. 430)'),
  engine: { module: 'motor', fn: 'calculateMotorCircuit' }, form: { panelId: null, name: 'Motor' },
  fields: {
    hp: field(en(MOTOR_HP), { unit: 'hp (table key)' }, bi('Moc silnika', 'Motor horsepower'), bi('Jaka jest moc silnika w hp (np. 1/2, 1.5, 10)?', 'What is the motor horsepower (e.g. 1/2, 1.5, 10)?')),
    volts: field(en(MOTOR_VOLTS), { unit: 'V' }, bi('Napięcie silnika', 'Motor voltage'), bi(`Jakie napięcie silnika (${MOTOR_VOLTS.join(', ')} V)?`, `Which motor voltage (${MOTOR_VOLTS.join(', ')} V)?`)),
    phase: field(en([1, 3]), {}, bi('Liczba faz', 'Phase'), bi('Silnik jednofazowy (1) czy trójfazowy (3)?', 'Single-phase (1) or three-phase (3) motor?')),
    motorType: field(en(MOTOR_TYPES), {}, bi('Typ silnika', 'Motor type'), bi(`Jaki typ silnika (${MOTOR_TYPES.join(', ')})?`, `Which motor type (${MOTOR_TYPES.join(', ')})?`)),
    ocpdType: field(en(MOTOR_OCPD_TYPES), {}, bi('Typ zabezpieczenia', 'Protective device type'), bi(`Jaki typ zabezpieczenia zwarciowego (${MOTOR_OCPD_TYPES.join(', ')})?`, `Which short-circuit protective device type (${MOTOR_OCPD_TYPES.join(', ')})?`)),
    material: matField('Materiał przewodu', 'Conductor material'),
    nameplateFLA: field(num({ min: 0, exclusiveMin: true, max: 100000 }), { unit: 'A', req: false }, bi('FLA z tabliczki', 'Nameplate FLA'),
      bi('Jaki jest prąd FLA z tabliczki znamionowej? (Potrzebny tylko do zabezpieczenia przeciążeniowego 430.32.)', 'What is the nameplate FLA? (Needed only for the 430.32 overload figure.)')),
    serviceFactorMultiplier: field(en([1.15, 1.25]), { req: (i) => own(i, 'nameplateFLA'), when: 'nameplateFLA is stated' }, bi('Mnożnik przeciążeniowy', 'Overload multiplier'),
      bi('Mnożnik 430.32: 1.25 (SF ≥ 1.15 lub przyrost temp. ≤ 40 °C) czy 1.15 (pozostałe)?', '430.32 multiplier: 1.25 (SF ≥ 1.15 or temperature rise ≤ 40 °C) or 1.15 (all others)?')),
  },
  prepare: (i) => ({ args: [pick(i, ['hp', 'volts', 'phase', 'motorType', 'ocpdType', 'material', 'nameplateFLA', 'serviceFactorMultiplier'])] }),
  call: (a) => motor.calculateMotorCircuit(a[0]),
  interpret(core, i) {
    if (!core.ok) return engineFailure(core, 'motor.calculateMotorCircuit');
    const refs = [core.tableRef, 'NEC 430.6(A)(1)', 'NEC 430.22', 'NEC 430.32', 'NEC 430.52', 'NEC 430.110'];
    const warnings = [{ code: 'TABLE_FLC_BASIS', source: 'motor', text: 'Conductors, branch protection and disconnect use the TABLE full-load current (430.6(A)(1)), not the nameplate; only the overload figure uses the nameplate FLA. The conductor is a 75 °C-column baseline before any derating.' }];
    if (core.nameplateDiffersFromTable) warnings.push({ code: 'NAMEPLATE_DIFFERS_FROM_TABLE', source: 'motor', text: `Nameplate FLA ${i.nameplateFLA} A differs from the table FLC ${core.tableFLC} A; the table value still governs conductors and protection.` });
    const summary = [
      bi(`FLC z tabeli: ${core.tableFLC} A (${core.tableRef}).`, `Table FLC: ${core.tableFLC} A (${core.tableRef}).`),
      bi(`Przewody: min. ${core.minConductorAmpacity} A → ${core.conductorSize === null ? 'brak rozmiaru w tabeli' : sizeLabel(core.conductorSize)} ${upper(i.material)} (kolumna 75 °C, przed korektami).`,
        `Conductors: min ${core.minConductorAmpacity} A → ${core.conductorSize === null ? 'no size in the table' : sizeLabel(core.conductorSize)} ${upper(i.material)} (75 °C column, before derating).`),
      bi(`Zabezpieczenie zwarciowe: ${core.protectionPercent}% → maks. ${core.maxProtection} A, standardowe ${core.standardProtection} A; rozłącznik ${core.disconnectRating} A.`,
        `Short-circuit protection: ${core.protectionPercent}% → max ${core.maxProtection} A, standard ${core.standardProtection} A; disconnect ${core.disconnectRating} A.`),
    ];
    if (!core.nameplateProvided) {
      summary.push(bi('Zabezpieczenie przeciążeniowe: NIE policzono — wymaga FLA z tabliczki (nigdy z tabeli).', 'Overload protection: NOT calculated — it requires the nameplate FLA (never the table value).'));
      warnings.push({ code: 'OVERLOAD_ECHO_PLACEHOLDER', source: 'registry', text: 'overloadPercentApplied / serviceFactorMultiplier echoed in coreResult are unused engine placeholders: no nameplate FLA was stated and overloadMax is null.' });
      return { status: STATUS.PARTIAL, coreStatus: 'OK_WITHOUT_OVERLOAD', references: refs, warnings, summary,
        parts: [{ id: 'branch', label: bi('Przewody / zabezpieczenie / rozłącznik (FLC z tabeli)', 'Conductors / protection / disconnect (table FLC)'), state: 'available', coreStatus: 'OK', value: core.conductorSize },
          { id: 'overload', label: bi('Przeciążeniowe 430.32 (tabliczka)', 'Overload 430.32 (nameplate)'), state: 'unresolved', coreStatus: 'NAMEPLATE_NOT_PROVIDED', value: null }],
        unresolved: [{ code: 'OVERLOAD_REQUIRES_NAMEPLATE_FLA', field: 'nameplateFLA', source: 'engine', message: bi('Bez FLA z tabliczki zabezpieczenie przeciążeniowe nie jest policzone.', 'Without the nameplate FLA the overload figure is not calculated.') }],
        needsInput: [{ field: 'nameplateFLA', reason: 'OPTIONAL_FOR_OVERLOAD', directTo: null, question: TOOLS_QUESTION('motor_circuit', 'nameplateFLA') }] };
    }
    summary.push(bi(`Zabezpieczenie przeciążeniowe: maks. ${core.overloadMax} A (${core.overloadPercentApplied}% FLA z tabliczki).`, `Overload protection: max ${core.overloadMax} A (${core.overloadPercentApplied}% of the nameplate FLA).`));
    return { status: STATUS.COMPLETE, coreStatus: 'OK', references: refs, warnings, summary };
  },
});

defineTool({
  id: 'grounding', title: bi('Uziemienie: EGC i GEC', 'Grounding: EGC and GEC'),
  engine: { module: 'grounding', fn: 'calculateGrounding' }, form: { panelId: null, name: 'Grounding' },
  fields: {
    ocpdRating: field(num({ min: 0, exclusiveMin: true, max: 100000 }), { unit: 'A' }, bi('Zabezpieczenie (podstawa EGC)', 'Overcurrent device (EGC basis)'), bi('Jaka jest wartość zabezpieczenia nadprądowego obwodu (A)?', 'What is the circuit overcurrent device rating (A)?')),
    egcMaterial: matField('Materiał EGC', 'EGC material'),
    requiredPhaseSize: field(en(GROUND_SIZES), {}, bi('Minimalny przewód fazowy', 'Minimum ungrounded conductor'), bi('Jaki jest minimalny wymagany rozmiar przewodu fazowego?', 'What is the minimum required ungrounded conductor size?')),
    installedPhaseSize: field(en(GROUND_SIZES), {}, bi('Zainstalowany przewód fazowy', 'Installed ungrounded conductor'), bi('Jaki rozmiar przewodu fazowego jest faktycznie instalowany?', 'What ungrounded conductor size is actually installed?')),
    serviceSize: field(en(GROUND_SIZES), {}, bi('Największy przewód zasilania (podstawa GEC)', 'Largest service conductor (GEC basis)'), bi('Jaki jest największy przewód przyłącza/zasilania?', 'What is the largest service conductor?')),
    serviceMaterial: matField('Materiał przewodu zasilania', 'Service conductor material'),
    electrode: field(en(ELECTRODES), {}, bi('Uziom', 'Grounding electrode'), bi('Jaki uziom: water (rura wodna), rod (pręt), ufer (w betonie) czy ring (otok)?', 'Which electrode: water (pipe), rod, ufer (concrete-encased) or ring?')),
    groundRing: field(en(GROUND_RING_VALUES), { req: false, when: 'only read when electrode is ring; absent = the engine\'s "unknown" (no final GEC size)' }, bi('Stan otoku (ring)', 'Ground ring condition'),
      bi(`Czy otok jest POTWIERDZONY jako #2 AWG Cu, a wymiarowany odcinek GEC jest jedynym połączeniem z nim (${grounding.GROUND_RING.CONFIRMED_CU_2AWG_SOLE})? Inny lub niepotwierdzony otok nie daje wyniku końcowego.`,
        `Is the ring CONFIRMED as #2 AWG copper with the sized GEC portion as its sole connection (${grounding.GROUND_RING.CONFIRMED_CU_2AWG_SOLE})? Any other or unconfirmed ring yields no final size.`)),
  },
  prepare: (i) => ({ args: [pick(i, ['ocpdRating', 'egcMaterial', 'requiredPhaseSize', 'installedPhaseSize', 'serviceSize', 'serviceMaterial', 'electrode', 'groundRing'])] }),
  call: (a) => grounding.calculateGrounding(a[0]),
  interpret(core) {
    if (!core.ok) return engineFailure(core, 'grounding.calculateGrounding');
    const e = core.egc; const g = core.gec;
    const refs = [e.tableReference, g.tableReference].concat(e.rule ? [e.rule] : [], g.capReference ? [g.capReference] : []);
    const egcOk = e.finalSize !== null && !e.exceedsAvailableSizes;
    const parts = [
      { id: 'egc', label: bi('EGC — przewód ochronny urządzeń (Table 250.122), niezależny od GEC', 'EGC — equipment grounding conductor (Table 250.122), independent of the GEC'), state: egcOk ? 'available' : 'unresolved', coreStatus: egcOk ? 'OK' : 'EXCEEDS_AVAILABLE_SIZES', value: e.finalSize },
      { id: 'gec', label: bi('GEC — przewód uziomowy (Table 250.66)', 'GEC — grounding electrode conductor (Table 250.66)'), state: g.resolved ? 'available' : 'unresolved', coreStatus: g.resolved ? 'OK' : g.condition.code, value: g.finalCopper },
    ];
    const unresolved = []; const needsInput = [];
    if (!egcOk) unresolved.push({ code: 'EGC_EXCEEDS_AVAILABLE_SIZES', field: 'installedPhaseSize', source: 'engine', message: bi('Proporcjonalne powiększenie EGC (250.122(B)) przekracza obsługiwane rozmiary — brak rozmiaru.', 'The proportional EGC increase (250.122(B)) exceeds every supported size — no size.') });
    if (!g.resolved) {
      unresolved.push({ code: g.condition.code, field: g.condition.field, source: 'engine',
        message: bi('GEC nierozstrzygnięty: otok nie jest potwierdzonym #2 AWG Cu z jedynym połączeniem — brak rozmiaru końcowego (wiersz tabeli tylko referencyjnie).', 'GEC unresolved: the ring is not the confirmed #2 AWG Cu sole-connection case — no final size (the table row is a reference only).') });
      if (g.condition.code === 'GROUND_RING_UNCONFIRMED') needsInput.push({ field: 'groundRing', reason: 'GROUND_RING_UNCONFIRMED', directTo: null, question: TOOLS_QUESTION('grounding', 'groundRing') });
    }
    const egcLine = egcOk
      ? bi(`EGC (osobny wynik, Table 250.122): ${sizeLabel(e.finalSize)} ${upper(e.material)} dla ${e.ocpdRating} A${e.upsizeApplied ? ` — powiększony wg 250.122(B) z ${sizeLabel(e.baseSize)}` : ''}.`,
        `EGC (separate result, Table 250.122): ${sizeLabel(e.finalSize)} ${upper(e.material)} for ${e.ocpdRating} A${e.upsizeApplied ? ` — increased per 250.122(B) from ${sizeLabel(e.baseSize)}` : ''}.`)
      : bi('EGC: brak rozmiaru — wymagane powiększenie przekracza obsługiwany zakres.', 'EGC: no size — the required increase exceeds the supported range.');
    const gecLine = g.resolved
      ? bi(`GEC (Table 250.66): ${sizeLabel(g.finalCopper)} Cu${g.capApplied ? ` — ograniczony wg ${g.capReference}` : ''} (wiersz tabeli: ${g.copper} Cu / ${g.aluminum} Al).`,
        `GEC (Table 250.66): ${sizeLabel(g.finalCopper)} Cu${g.capApplied ? ` — limited per ${g.capReference}` : ''} (table row: ${g.copper} Cu / ${g.aluminum} Al).`)
      : bi(`GEC: NIEROZSTRZYGNIĘTY (${g.condition.code}) — brak rozmiaru końcowego. Wiersz Table 250.66 (${g.copper} Cu / ${g.aluminum} Al) jest wyłącznie referencją, nie wynikiem.`,
        `GEC: UNRESOLVED (${g.condition.code}) — no final size. The Table 250.66 row (${g.copper} Cu / ${g.aluminum} Al) is a reference only, not a result.`);
    const done = egcOk && g.resolved;
    return { status: done ? STATUS.COMPLETE : STATUS.PARTIAL, coreStatus: done ? 'OK' : (g.resolved ? 'EGC_UNRESOLVED' : g.condition.code), parts, unresolved, needsInput, references: refs, summary: [egcLine, gecLine] };
  },
});

const PB_NOTE = {
  SPACING_VERIFY_IN_LAYOUT: 'Entry-spacing minimums are calculated, but entry positions are not modeled: physical compliance must be verified in the actual box layout.',
  NO_WIDTH_CANDIDATES: 'No pull rule produced a width requirement for the supplied connections; minimumWidthIn is null, not zero.',
  NO_HEIGHT_CANDIDATES: 'No pull rule produced a height requirement for the supplied connections; minimumHeightIn is null, not zero.',
  DEPTH_NOT_CALCULATED: 'Box depth is not calculated by this model.',
  A3_NOT_EVALUATED: 'The 314.28(A)(3) listed-product exception is not evaluated.',
};
defineTool({
  id: 'pull_box', title: bi('Puszka przelotowa (Pull Box)', 'Pull box'),
  engine: { module: 'pullBox', fn: 'calculatePullBox' }, form: { panelId: 'panel-pullbox', name: 'Pull Box' },
  fields: {
    geometry: field(obj({
      rows: arr(obj({ id: str(), wall: en(pullBox.WALL_ORDER, { deferToEngine: true }), order: num() }), 0, 32),
      entries: arr(obj({ id: str(), rowId: str(), tradeSize: en(pullBox.TRADE_SIZE_KEYS, { deferToEngine: true }) }), 0, 128),
      connections: arr(obj({ id: str(), entryIds: arr(str(), 0, 8) }), 0, 128),
    }), { unit: 'explicit existing geometry: rows (id, wall, order), entries (id, rowId, tradeSize), connections (id, entryIds[2]); replaced as a whole' },
    bi('Geometria puszki', 'Pull box geometry'),
    bi('Podaj jawnie istniejący układ: ściany/rzędy, każde wejście z rozmiarem rury i każde połączenie (które wejście z którym) — albo zaimportuj go z formularza Pull Box. Układu nie wymyślam.',
      'State the existing layout explicitly: walls/rows, every entry with its trade size and every connection (which entry to which) — or import it from the Pull Box form. A layout is never invented.')),
  },
  prepare: (i) => ({ args: [snapshot(i.geometry)] }),
  call: (a) => pullBox.calculatePullBox(a[0]),
  interpret(core) {
    const refs = ['NEC 314.28(A)(1)', 'NEC 314.28(A)(2)'];
    if (!core.ok) return Object.assign(engineFailure(core, 'pullBox.calculatePullBox'), { references: refs });
    const warnings = []; const unresolved = [];
    for (const w of core.warnings) {
      warnings.push({ code: w.code, source: 'pullBox', text: `${w.code}: ${Array.isArray(w.entryIds) ? w.entryIds.join(', ') : ''}` });
      unresolved.push({ code: w.code, field: 'geometry.connections', source: 'engine', message: bi(`Wejścia bez połączenia: ${Array.isArray(w.entryIds) ? w.entryIds.join(', ') : '?'} — nie wynika z nich żaden wymiar.`, `Unconnected entries: ${Array.isArray(w.entryIds) ? w.entryIds.join(', ') : '?'} — they produce no dimension.`) });
    }
    for (const n of core.scopeNotes) warnings.push({ code: n.code, source: 'pullBox', text: PB_NOTE[n.code] || n.code });
    const parts = ['width', 'height'].map((axis) => {
      const value = axis === 'width' ? core.minimumWidthIn : core.minimumHeightIn; const ds = core.dimensionStatus[axis];
      if (value === null) unresolved.push({ code: axis === 'width' ? 'NO_WIDTH_CANDIDATES' : 'NO_HEIGHT_CANDIDATES', field: 'geometry.connections', source: 'engine', message: bi(`Brak wymagania dla wymiaru ${axis} — wartość nieokreślona (nie zero).`, `No requirement for the ${axis} dimension — undetermined (not zero).`) });
      if (ds.status !== 'RESOLVED') unresolved.push({ code: `${upper(axis)}_${ds.status}`, field: 'geometry', source: 'engine', message: bi(`Wymiar ${axis} zależy od układu wejść (${ds.status}); minimalny odstęp wejść ${ds.minimumEntrySpacingIn} in to nie wymiar puszki.`, `The ${axis} dimension is ${ds.status}; the ${ds.minimumEntrySpacingIn} in entry spacing is a constraint, not a box dimension.`) });
      return { id: axis, label: bi(axis === 'width' ? 'Minimalna szerokość' : 'Minimalna wysokość', axis === 'width' ? 'Minimum width' : 'Minimum height'), state: value !== null && ds.status === 'RESOLVED' ? 'available' : 'unresolved', coreStatus: value === null ? 'NO_CANDIDATE' : ds.status, value };
    });
    if (core.completeForRequest !== true) unresolved.push({ code: 'REQUEST_NOT_COMPLETE', field: 'geometry', source: 'engine', message: bi('Silnik nie oznaczył tego żądania jako w pełni policzonego.', 'The engine did not mark this request as fully evaluated.') });
    const dim = (v) => (v === null ? bi('nieokreślona (brak wymagania z podanych połączeń)', 'undetermined (no requirement from the supplied connections)') : bi(`${v} in`, `${v} in`));
    const wd = dim(core.minimumWidthIn); const hd = dim(core.minimumHeightIn);
    return {
      status: unresolved.length ? STATUS.PARTIAL : STATUS.COMPLETE, coreStatus: 'EVALUATED_FOR_REQUEST', parts, unresolved, warnings, references: refs,
      summary: [
        bi(`Minimalna szerokość: ${wd.pl}; minimalna wysokość: ${hd.pl}.`, `Minimum width: ${wd.en}; minimum height: ${hd.en}.`),
        bi(`Odstępy wejść do sprawdzenia w układzie: ${core.spacingRequirements.length}. Głębokość i 314.28(A)(3) nie są liczone.`, `Entry-spacing requirements to verify in the layout: ${core.spacingRequirements.length}. Depth and 314.28(A)(3) are not evaluated.`),
        bi('Policzono reguły modelu dla podanej geometrii — to nie weryfikacja fizycznej instalacji.', 'The model rules were evaluated for the supplied geometry — this is not a verification of the physical installation.'),
      ],
    };
  },
});

// ── Load Calc / Service Sizing: context-bound (the canonical request comes from the existing form; the engine boundary validates it) ──
const LC_STATUS = { COMPLETE: STATUS.COMPLETE, PARTIAL: STATUS.PARTIAL, INCOMPLETE_INPUT: STATUS.NEEDS_INPUT, EMPTY: STATUS.NEEDS_INPUT, INVALID_INPUT: STATUS.INVALID_INPUT,
  UNSUPPORTED_SCOPE: STATUS.UNSUPPORTED, CAPABILITY_DISABLED: STATUS.UNSUPPORTED, RULE_PENDING: STATUS.UNSUPPORTED };
const LC_FORM = { panelId: null, name: 'Load Calc' };
const SS_FORM = { panelId: null, name: 'Load Calc — Service Sizing preview' };
const requestField = () => field(json(), { origin: 'context', unit: 'canonical Load Calc V2 request (apiVersion 2), exactly as produced by the existing form' }, bi('Żądanie Load Calc (z formularza)', 'Load Calc request (from the form)'),
  FORM_Q('Potrzebne jest kompletne żądanie z formularza Load Calc (topologia, inwentarz, oświadczenia).', 'The complete request of the Load Calc form is required (topology, inventory, attestations).'));
const designField = () => field(json(), { origin: 'context', req: false, unit: 'service design { selectedMainRatingA, plan{…}, conductor{…} } exactly as held by the Service Sizing form; absent = no design' },
  bi('Projekt przyłącza (z formularza)', 'Service design (from the form)'), FORM_Q('Dane projektu przyłącza (wybrany główny, przesłanki, warunki przewodów) pochodzą z podglądu Service Sizing.', 'The service design (chosen main, premises, conductor conditions) comes from the Service Sizing preview.'));
function envelopeCall(fn) {
  return (a) => {
    try { return fn(...a); } catch (e) {
      if (!e || e.name !== 'LoadCalcEnvelopeError') throw e;
      return { __requestInvalid: true, name: e.name, errors: Array.isArray(e.errors) ? e.errors.slice(0, 20).map(String) : [String(e.message)] };
    }
  };
}
function requestInvalid(core) {
  return { status: STATUS.INVALID_INPUT, coreStatus: 'REQUEST_STRUCTURALLY_INVALID',
    errors: core.errors.map((m) => ({ code: 'REQUEST_STRUCTURALLY_INVALID', field: 'request', source: 'engine', message: bi(m, m), detail: null })),
    summary: [bi('Żądanie nie przeszło granicy V2 silnika Load Calc — nic nie policzono.', 'The request failed the Load Calc V2 boundary — nothing was calculated.')] };
}
const problemsOf = (r) => (r && Array.isArray(r.problems) ? r.problems.slice(0, LIMITS.problemsListed) : []);
const problemQuestion = (p, form) => ({ field: typeof p.field === 'string' ? p.field : null, reason: String(p.code), directTo: form.name,
  question: bi(`Uzupełnij lub popraw w formularzu ${form.name}: ${p.field || p.code}${p.message ? ` — ${p.message}` : ''}`, `Complete or correct in the ${form.name} form: ${p.field || p.code}${p.message ? ` — ${p.message}` : ''}`) });
const problemUnresolved = (p) => ({ code: String(p.code), field: typeof p.field === 'string' ? p.field : null, source: 'engine', message: bi(String(p.message || p.code), String(p.message || p.code)) });
function demandText(r) {
  const s = r.display && r.display.strings ? r.display.strings : {};
  return {
    total: typeof s.totalVA === 'string' && s.totalVA ? s.totalVA : (r.demand && typeof r.demand.totalVA === 'number' ? `${r.demand.totalVA} VA` : null),
    line: typeof s.lineA === 'string' && s.lineA ? s.lineA : (r.current && typeof r.current.lineA === 'number' ? `${r.current.lineA} A` : null),
  };
}
const refsOf = (r) => (Array.isArray(r.references) ? r.references.slice(0, 40).map((x) => (typeof x === 'string' ? x : canonicalText(x))) : []);

defineTool({
  id: 'load_calc', title: bi('Load Calc (zwykłe obliczenie)', 'Load Calc (ordinary calculation)'),
  engine: { module: 'loadCalcFacade', fn: 'evaluateV2' }, form: LC_FORM, fields: { request: requestField() },
  prepare: (i) => ({ args: [i.request] }),
  call: envelopeCall((request) => facade.evaluateV2(request)),
  interpret(core) {
    if (core.__requestInvalid) return requestInvalid(core);
    // Only an OWN, known engine status is mapped; anything else (a new status, a non-string, an inherited key such as 'constructor') is 'blocked'.
    const r = core.result; const f = core.facade; const status = typeof r.status === 'string' && own(LC_STATUS, r.status) ? LC_STATUS[r.status] : STATUS.BLOCKED; const t = demandText(r); const problems = problemsOf(r);
    const flags = { engine: f.engine, engineProfileId: f.engineProfileId, importGuard: f.importGuard, ruleBasis: r.ruleBasis === undefined ? null : r.ruleBasis };
    const codes = problems.map((p) => p.code).join(', ') || '—';
    if (status === STATUS.COMPLETE) {
      return { status, coreStatus: r.status, flags, references: refsOf(r),
        summary: [bi(`Obliczone zapotrzebowanie: ${t.total}; prąd linii: ${t.line} (silnik ${f.engine}).`, `Calculated demand: ${t.total}; line current: ${t.line} (engine ${f.engine}).`),
          bi('To wynik obliczenia obciążenia — nie dobór przyłącza i nie zatwierdzenie instalacji.', 'This is a load calculation result — not a service selection and not an installation approval.')] };
    }
    return { status, coreStatus: r.status, flags, references: refsOf(r),
      needsInput: status === STATUS.NEEDS_INPUT ? problems.map((p) => problemQuestion(p, LC_FORM)) : [],
      unresolved: status === STATUS.NEEDS_INPUT ? [] : problems.map(problemUnresolved),
      summary: [bi(`Status silnika: ${r.status} — brak wyniku końcowego. Kody: ${codes}.`, `Engine status: ${r.status} — no final result. Codes: ${codes}.`)]
        .concat(status === STATUS.PARTIAL && t.total ? [bi(`Wartość częściowa (NIE suma końcowa): ${t.total}.`, `Partial value (NOT the final total): ${t.total}.`)] : []) };
  },
});

defineTool({
  id: 'load_calc_preliminary', title: bi('Load Calc — wstępne dla nowego projektu', 'Load Calc — preliminary for a new design'),
  engine: { module: 'loadCalcFacade', fn: 'evaluatePreliminaryV2' }, form: LC_FORM, fields: { request: requestField() },
  prepare: (i) => ({ args: [i.request] }),
  call: envelopeCall((request) => facade.evaluatePreliminaryV2(request)),
  interpret(core) {
    if (core.__requestInvalid) return requestInvalid(core);
    const r = core.result; const f = core.facade; const P = facade.PRELIMINARY_STATUS; const t = demandText(r); const problems = problemsOf(r);
    const flags = { preliminary: true, engine: f.engine, resultKind: f.resultKind, ordinaryResult: r.ordinaryResult, qualificationEstablished: r.qualificationEstablished, core: { operative: r.operative } };
    const next = r.nextAction ? snapshot(r.nextAction) : null;
    const deferred = Array.isArray(r.deferred) ? r.deferred : [];
    if (r.status === P.PENDING) {
      return { status: STATUS.PRELIMINARY, coreStatus: r.status, flags, references: refsOf(r), nextAction: next,
        unresolved: deferred.map((d) => ({ code: String(d.code), field: typeof d.field === 'string' ? d.field : null, source: 'engine', message: bi(String(d.message), String(d.message)) })),
        summary: [bi(`Obliczenie WSTĘPNE (nowy projekt): ${t.total}; ${t.line}.`, `PRELIMINARY calculation (new design): ${t.total}; ${t.line}.`),
          bi('Kwalifikacja 220.82(A) (obciążalność przewodów) jest odroczona — to NIE jest zwykły ani końcowy wynik i nie można go zapisać.', 'The 220.82(A) qualification (conductor ampacity) is deferred — this is NOT an ordinary or final result and cannot be saved.')] };
    }
    const notApplicable = r.status === P.NOT_APPLICABLE;
    const status = notApplicable ? STATUS.UNSUPPORTED : (r.blockingStatus === 'INCOMPLETE_INPUT' ? STATUS.NEEDS_INPUT : STATUS.BLOCKED);
    return { status, coreStatus: r.status, flags, references: refsOf(r), nextAction: next,
      needsInput: status === STATUS.NEEDS_INPUT ? problems.map((p) => problemQuestion(p, LC_FORM)) : [],
      unresolved: status === STATUS.NEEDS_INPUT ? [] : problems.map(problemUnresolved),
      summary: [notApplicable
        ? bi('Tryb wstępny nie ma zastosowania: obciążalność przewodów jest już podana — użyj zwykłego obliczenia.', 'The preliminary route does not apply: a conductor ampacity is already present — use the ordinary calculation.')
        : bi(`Obliczenie wstępne zablokowane (${r.blockingStatus}): ${problems.map((p) => p.code).join(', ') || '—'}.`, `Preliminary calculation blocked (${r.blockingStatus}): ${problems.map((p) => p.code).join(', ') || '—'}.`)] };
  },
});

const STAGE_LABEL = {
  minimumService: bi('Minimalny standardowy kandydat rozłącznika głównego', 'Minimum standard service-disconnect candidate'),
  chosenMain: bi('Wybrany główny', 'Chosen main rating'),
  ungroundedConductors: bi('Przewody fazowe (tabela)', 'Ungrounded conductors (table)'),
};
const STAGE_POSITIVE = { minimumService: 'experimental_candidate', chosenMain: 'meets_prototype_minimum', ungroundedConductors: 'experimental_candidate' };
const STAGE_IDS = ['minimumService', 'chosenMain', 'ungroundedConductors'];
/** Shared reading of an ordinary or preliminary sizing analysis; nothing is decided here beyond classifying the engine's own stage statuses. */
function readSizing(a) {
  const parts = []; const needsInput = []; const unresolved = [];
  for (const id of STAGE_IDS) {
    const s = a[id]; const positive = s.status === STAGE_POSITIVE[id];
    const value = id === 'minimumService' ? s.ratingA : id === 'chosenMain' ? s.selectedRatingA : s.size;
    parts.push({ id, label: STAGE_LABEL[id], state: positive ? 'available' : (s.status === 'not_evaluated' || s.status === 'not_computed' ? 'not_evaluated' : 'unresolved'), coreStatus: s.status, value: value === undefined ? null : value });
    if (positive) continue;
    for (const r of (Array.isArray(s.reasons) ? s.reasons : [])) {
      if (s.status === 'waiting_input' || r.code === 'PREMISE_UNANSWERED' || r.code === 'SELECTED_RATING_MISSING') needsInput.push(problemQuestion(r, SS_FORM));
      else unresolved.push(Object.assign(problemUnresolved(r), { stage: id }));
    }
    const qc = s.qualificationConsistency;
    if (qc && Array.isArray(qc.reasons)) for (const r of qc.reasons) unresolved.push(Object.assign(problemUnresolved(r), { stage: 'qualificationConsistency', qualificationStatus: qc.status }));
  }
  for (const p of (Array.isArray(a.designProblems) ? a.designProblems : [])) unresolved.push(Object.assign(problemUnresolved(p), { stage: 'design' }));
  return { parts, needsInput, unresolved };
}
function sizingSummary(a) {
  const m = a.minimumService; const c = a.chosenMain; const u = a.ungroundedConductors; const lines = [];
  lines.push(bi(`Minimalny standardowy kandydat: ${m.ratingA === null || m.ratingA === undefined ? '—' : `${m.ratingA} A`} (${m.status}).`, `Minimum standard candidate: ${m.ratingA === null || m.ratingA === undefined ? '—' : `${m.ratingA} A`} (${m.status}).`));
  lines.push(bi(`Wybrany główny: ${c.selectedRatingA === null || c.selectedRatingA === undefined ? '—' : `${c.selectedRatingA} A`} (${c.status}).`, `Chosen main: ${c.selectedRatingA === null || c.selectedRatingA === undefined ? '—' : `${c.selectedRatingA} A`} (${c.status}).`));
  const tc = u.tableCandidate; const qc = u.qualificationConsistency;
  if (u.recommendationAvailable === true) {
    lines.push(bi(`Przewody fazowe — kandydat prototypowy (nieoperacyjny): ${u.material} ${u.size} ${u.sizeUnit}, ${u.ampacity75CA} A @ 75 °C.`, `Ungrounded conductors — prototype candidate (non-operative): ${u.material} ${u.size} ${u.sizeUnit}, ${u.ampacity75CA} A @ 75 °C.`));
  } else if (tc) {
    lines.push(bi(`Przewody fazowe — WARUNKOWY fakt tabelaryczny, NIE rekomendacja: ${tc.material} ${tc.size} ${tc.sizeUnit}, ${tc.ampacity75CA} A @ 75 °C (${tc.table}); kwalifikacja: ${qc ? qc.status : '—'}.`,
      `Ungrounded conductors — CONDITIONAL table fact, NOT a recommendation: ${tc.material} ${tc.size} ${tc.sizeUnit}, ${tc.ampacity75CA} A @ 75 °C (${tc.table}); qualification: ${qc ? qc.status : '—'}.`));
  } else {
    lines.push(bi(`Przewody fazowe: brak kandydata (${u.status}).`, `Ungrounded conductors: no candidate (${u.status}).`));
  }
  lines.push(bi('Prototyp nieoperacyjny: brak zatwierdzenia instalacji, zgodność z przepisami niezweryfikowana, pozostają kontrole z remainingChecks.', 'Non-operative prototype: no installation approval, code compliance not verified, the remainingChecks stay open.'));
  return lines;
}
const sizingFlags = (a, extra) => Object.assign({ prototype: true, core: { prototypeId: a.prototypeId, operative: a.operative, installationApproved: a.installationApproved, globalCodeCompliance: a.globalCodeCompliance, ruleReview: a.ruleReview } }, extra || {});
const sizingReferences = (a) => { const out = []; for (const id of STAGE_IDS) for (const r of (Array.isArray(a[id].reasons) ? a[id].reasons : [])) for (const s of (Array.isArray(r.sections) ? r.sections : [])) if (!out.includes(s)) out.push(s); return out; };
const sizingWarnings = (a) => [{ code: 'SOURCE_REVIEW', source: 'loadCalcServiceSizing', text: a.sourceReview && typeof a.sourceReview.warning === 'string' ? a.sourceReview.warning : 'Prototype source review open.' },
  { code: 'REMAINING_CHECKS', source: 'loadCalcServiceSizing', text: Array.isArray(a.remainingChecks) ? a.remainingChecks.join('; ') : '' }];

defineTool({
  id: 'service_sizing', title: bi('Service Sizing — analiza prototypowa', 'Service Sizing — prototype analysis'),
  engine: { module: 'loadCalcServiceSizing', fn: 'analyzePrototype' }, form: SS_FORM, fields: { request: requestField(), design: designField() },
  prepare: (i) => ({ args: [i.request, own(i, 'design') ? i.design : null] }),
  call: (a) => serviceSizing.analyzePrototype(a[0], a[1]),
  interpret(a) {
    const flags = sizingFlags(a); const s = readSizing(a); const base = { coreStatus: a.status, flags, parts: s.parts, references: sizingReferences(a), warnings: sizingWarnings(a) };
    if (a.status !== 'EVALUATED') {   // the two known refusals are invalid input; a status this registry does not know is 'blocked', never a result
      const refused = a.status === 'REQUEST_INVALID' || a.status === 'DESIGN_INVALID';
      return Object.assign(base, { status: refused ? STATUS.INVALID_INPUT : STATUS.BLOCKED, unresolved: s.unresolved, needsInput: [],
        summary: [refused ? bi(`Analiza odrzucona (${a.status}) — nic nie dobrano.`, `Analysis refused (${a.status}) — nothing was sized.`)
          : bi(`Nieznany status analizy (${a.status}) — brak wyniku, nic nie dobrano.`, `Unknown analysis status (${a.status}) — no result, nothing was sized.`)] });
    }
    const allPositive = s.parts.every((p) => p.state === 'available');
    const minimumOk = s.parts[0].state === 'available';
    const status = allPositive ? STATUS.COMPLETE : (minimumOk ? STATUS.PARTIAL : (a.minimumService.status === 'waiting_input' ? STATUS.NEEDS_INPUT : STATUS.UNSUPPORTED));
    return Object.assign(base, { status, needsInput: s.needsInput, unresolved: s.unresolved, summary: sizingSummary(a) });
  },
});

defineTool({
  id: 'service_sizing_preliminary', title: bi('Service Sizing — wstępne dla nowego projektu', 'Service Sizing — preliminary for a new design'),
  engine: { module: 'loadCalcServiceSizing', fn: 'analyzePreliminaryPrototype' }, form: SS_FORM, fields: { request: requestField(), design: designField() },
  prepare: (i) => ({ args: [i.request, own(i, 'design') ? i.design : null] }),
  call: (a) => serviceSizing.analyzePreliminaryPrototype(a[0], a[1]),
  interpret(a) {
    const S = serviceSizing.PRELIMINARY_ANALYSIS_STATUS; const s = readSizing(a);
    const flags = sizingFlags(a, { preliminary: true, resultKind: a.kind, qualificationPending: a.qualificationPending, fullResultRecordEligible: a.fullResultRecordEligible });
    const deferred = Array.isArray(a.deferredConditions) ? a.deferredConditions.map(problemUnresolved) : [];
    // The explicit adoption helper is NEVER called here. It is reported as a later, user-reviewed UI step only.
    const nextAction = Object.assign(snapshot(a.nextAction), {
      adoption: { availableInEngine: a.adoption.available === true, code: a.adoption.code, candidateAmpacityA: a.adoption.candidateAmpacityA, performedHere: false, modelCallable: false,
        requires: 'explicit user review and confirmation in the application UI (stage-4 helper); never an automatic or model-initiated step' },
    });
    const base = { coreStatus: a.status, flags, parts: s.parts, references: sizingReferences(a), nextAction,
      warnings: sizingWarnings(a).concat([{ code: 'ADOPTION_NOT_A_MODEL_TOOL', source: 'registry', text: 'A conditional candidate is not adopted here. Adoption of a planned conductor declaration is an explicit, user-confirmed UI action; this registry neither performs nor exposes it.' }]) };
    if (a.status === S.REQUEST_INVALID || a.status === S.DESIGN_INVALID) {
      return Object.assign(base, { status: STATUS.INVALID_INPUT, unresolved: s.unresolved, needsInput: [], summary: [bi(`Analiza wstępna odrzucona (${a.status}) — nic nie dobrano.`, `Preliminary analysis refused (${a.status}) — nothing was sized.`)] });
    }
    if (a.status === S.NOT_APPLICABLE) {
      return Object.assign(base, { status: STATUS.UNSUPPORTED, unresolved: s.unresolved, needsInput: [], summary: [bi('Tryb wstępny nie ma zastosowania: obciążalność przewodów jest już podana — użyj zwykłej analizy.', 'The preliminary route does not apply: a conductor ampacity is already present — use the ordinary analysis.')] });
    }
    if (a.status === S.BLOCKED) {
      const calc = a.preliminaryCalculation; const problems = problemsOf(calc); const ask = calc && calc.blockingStatus === 'INCOMPLETE_INPUT';
      return Object.assign(base, { status: ask ? STATUS.NEEDS_INPUT : STATUS.BLOCKED, needsInput: ask ? problems.map((p) => problemQuestion(p, LC_FORM)) : [], unresolved: ask ? s.unresolved : problems.map(problemUnresolved).concat(s.unresolved),
        summary: [bi(`Analiza wstępna zablokowana (${calc ? calc.blockingStatus : '—'}): ${problems.map((p) => p.code).join(', ') || '—'}.`, `Preliminary analysis blocked (${calc ? calc.blockingStatus : '—'}): ${problems.map((p) => p.code).join(', ') || '—'}.`)] });
    }
    if (a.status !== S.EVALUATED) {   // a status this registry does not know is 'blocked' — never presented as a preliminary result
      return Object.assign(base, { status: STATUS.BLOCKED, needsInput: [], unresolved: s.unresolved,
        summary: [bi(`Nieznany status analizy wstępnej (${a.status}) — brak wyniku, nic nie dobrano.`, `Unknown preliminary analysis status (${a.status}) — no result, nothing was sized.`)] });
    }
    const b = a.calcBasis || {};
    return Object.assign(base, { status: STATUS.PRELIMINARY, needsInput: s.needsInput, unresolved: deferred.concat(s.unresolved),
      summary: [bi(`WSTĘPNE (nowy projekt): ${b.totalVADisplay || (typeof b.totalVA === 'number' ? `${b.totalVA} VA` : '—')}; ${b.lineADisplay || '—'}. Kwalifikacja 220.82(A) odroczona.`,
        `PRELIMINARY (new design): ${b.totalVADisplay || (typeof b.totalVA === 'number' ? `${b.totalVA} VA` : '—')}; ${b.lineADisplay || '—'}. 220.82(A) qualification deferred.`)]
        .concat(sizingSummary(a)).concat([bi('Wynik wstępny: bez rekomendacji, bez zapisu, bez adopcji — adopcja deklaracji to osobny, jawny krok użytkownika w aplikacji.', 'Preliminary result: no recommendation, no save, no adoption — adopting a declaration is a separate explicit user step in the app.')]) });
  },
});

function TOOLS_QUESTION(toolId, fieldName) { return TOOLS[toolId].fields[fieldName].question; }

/** Tools that exist in the app but have NO pure calculation module: truthful navigation metadata only, never an execution. */
const NAVIGATION_ONLY = Object.freeze([
  { id: 'power', title: bi('Moc / prawo Ohma', 'Power / Ohm\'s law') },
  { id: 'torque', title: bi('Momenty dokręcania', 'Terminal torque') },
  { id: 'bender', title: bi('Gięcie rur (Bender)', 'Conduit bender') },
].map((n) => Object.freeze(Object.assign({ kind: 'navigation_only', executable: false, reason: 'NO_PURE_MODULE', form: { panelId: null, name: n.title.en },
  message: bi(`${n.title.pl}: asystent nie ma czystego modułu obliczeniowego dla tego narzędzia i niczego tu nie liczy — otwórz je w aplikacji.`, `${n.title.en}: the assistant has no pure calculation module for this tool and calculates nothing — open it in the app.`) }, n))));

const TOOL_IDS = Object.freeze(Object.keys(TOOLS));
const BASE_FLAGS = Object.freeze({ deterministicCore: true, numbersFromCoreOnly: true, installationApproved: false, approval: 'none', codeComplianceVerified: false,
  serviceSizingRecord: false, persistence: 'conversation_only', prototype: false, preliminary: false });

// ── catalogue and strict provider schemas ───────────────────────────────────────────────────────────────────────────
const modelFieldsOf = (tool) => Object.keys(tool.fields).filter((k) => tool.fields[k].origin === 'any');
const contextFieldsOf = (tool) => Object.keys(tool.fields).filter((k) => tool.fields[k].origin === 'context');
const requirementOf = (f) => (typeof f.required === 'function' ? 'conditional' : (f.required ? 'always' : 'optional'));
function describeType(d) {
  if (d.kind === 'number') return { type: d.integer ? 'integer' : 'number', min: d.min === undefined ? null : d.min, exclusiveMin: d.exclusiveMin === true, max: d.max === undefined ? null : d.max };
  if (d.kind === 'enum') return { type: 'enum', values: d.values.slice(), validatedBy: d.deferToEngine ? 'engine' : 'registry' };
  if (d.kind === 'object') return { type: 'object', fields: Object.fromEntries(Object.keys(d.fields).map((k) => [k, describeType(d.fields[k])])) };
  if (d.kind === 'array') return { type: 'array', minItems: d.minItems, maxItems: d.maxItems, item: describeType(d.item) };
  if (d.kind === 'string') return { type: 'string', maxLength: d.maxLength };
  if (d.kind === 'json') return { type: 'context_json', validatedBy: 'engine boundary' };
  return { type: d.kind };
}
function catalogueEntry(tool) {
  const fields = {};
  for (const k of Object.keys(tool.fields)) {
    const f = tool.fields[k];
    fields[k] = Object.assign(describeType(f), { requirement: requirementOf(f), requiredWhen: f.requiredWhen, origin: f.origin, unit: f.unit, label: f.label, question: f.question });
  }
  const model = modelFieldsOf(tool);
  return { id: tool.id, kind: 'calculator', executable: true, title: tool.title, engine: Object.assign({}, tool.engine), form: Object.assign({}, tool.form),
    providerToolName: PROVIDER_TOOL_PREFIX + tool.id, inputMode: model.length ? 'typed_patch' : 'imported_context_only', modelFields: model, contextOnlyFields: contextFieldsOf(tool), fields };
}
const CATALOGUE = deepFreeze(TOOL_IDS.map((id) => catalogueEntry(TOOLS[id])).concat(NAVIGATION_ONLY.map((n) => snapshot(n))));
/** Every tool the conversation may name: executable calculators first, then navigation-only capabilities. Deep-frozen. */
function listTools() { return CATALOGUE; }
function getTool(id) { return typeof id === 'string' ? (CATALOGUE.find((t) => t.id === id) || null) : null; }

const nullableSchema = (s) => (typeof s.type === 'string' && !s.enum && s.type !== 'object' && s.type !== 'array'
  ? Object.assign({}, s, { type: [s.type, 'null'] }) : { anyOf: [s, { type: 'null' }], description: s.description });
function schemaOfType(d) {
  if (d.kind === 'number') return { type: d.integer ? 'integer' : 'number' };
  if (d.kind === 'boolean') return { type: 'boolean' };
  if (d.kind === 'string') return { type: 'string' };
  if (d.kind === 'enum') return { type: typeof d.values[0] === 'number' ? 'number' : 'string', enum: d.values.slice() };
  if (d.kind === 'object') {
    const keys = Object.keys(d.fields);
    return { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, schemaOfType(d.fields[k])])), required: keys, additionalProperties: false };
  }
  if (d.kind === 'array') return { type: 'array', items: schemaOfType(d.item) };
  throw new RangeError(`no provider schema for kind ${d.kind}`);
}
function fieldDescription(f) {
  const t = describeType(f); const bits = [f.label.en];
  if (f.unit) bits.push(`Unit: ${f.unit}.`);
  if (t.type === 'number' || t.type === 'integer') bits.push(`Range: ${t.min === null ? '' : `${t.exclusiveMin ? '>' : '>='} ${t.min}`}${t.max === null ? '' : ` <= ${t.max}`}.`.replace('Range: .', ''));
  if (t.type === 'array') bits.push(`Items: ${t.minItems}..${t.maxItems}.`);
  bits.push(requirementOf(f) === 'always' ? 'Required before the tool runs.' : requirementOf(f) === 'conditional' ? `Required when ${f.requiredWhen}.` : `Optional${f.requiredWhen ? ` (${f.requiredWhen})` : ''}.`);
  bits.push('Use null when the user has not stated it; never guess or default.');
  return bits.filter(Boolean).join(' ');
}
/**
 * Strict provider schema for one tool's model-facing input: root object, every property required, absent = null,
 * additionalProperties false everywhere, no top-level anyOf, no if/then/allOf/not. Bounds are stated in descriptions and
 * enforced by validatePatch (the application validation always runs, whatever the provider enforced).
 */
function getToolInputSchema(id) {
  const tool = own(TOOLS, id) ? TOOLS[id] : null;
  if (!tool) return null;
  const model = modelFieldsOf(tool);
  if (!model.length) {
    return deepFreeze({ type: 'object', additionalProperties: false, required: ['action'],
      properties: { action: { type: 'string', enum: [CONTEXT_ACTION], description: 'Run the calculator on the data the application explicitly imported from its own form. The model cannot author or edit this data.' } } });
  }
  const props = {};
  for (const k of model) props[k] = Object.assign(nullableSchema(schemaOfType(tool.fields[k])), { description: fieldDescription(tool.fields[k]) });
  return deepFreeze({ type: 'object', additionalProperties: false, required: ['set', 'clear'], properties: {
    set: { type: 'object', additionalProperties: false, required: model.slice(), properties: props, description: 'Input values the user stated in this turn. null = not stated / unchanged.' },
    clear: { type: 'array', items: { type: 'string', enum: model.slice() }, description: 'Fields the user explicitly withdrew. Usually empty.' },
  } });
}
/** Closed provider tool definitions (one typed function per calculator + one navigation function). No free-form JSON anywhere. */
function getToolDefinitions() {
  const defs = TOOL_IDS.map((id) => {
    const tool = TOOLS[id]; const contextOnly = modelFieldsOf(tool).length === 0;
    return { name: PROVIDER_TOOL_PREFIX + id, strict: true, input_schema: getToolInputSchema(id),
      description: `${tool.title.en}. ${contextOnly
        ? 'Runs only on data explicitly imported from the application form; you cannot supply or alter that data.'
        : 'Pass ONLY input values the user explicitly stated (set) — never results, formulas, defaults or guesses.'} The application validates the input, runs the deterministic ${tool.engine.module}.${tool.engine.fn} engine and returns the authoritative numbers; missing values come back as questions to ask the user. Quote results from the returned summary only.` };
  });
  defs.push({ name: OPEN_TOOL_NAME, strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['tool'], properties: { tool: { type: 'string', enum: CATALOGUE.map((t) => t.id), description: 'Catalogue id of the app tool to point the user to.' } } },
    description: `Point the user to a tool inside the app. Navigation only: nothing is calculated. Use it for ${NAVIGATION_ONLY.map((n) => n.id).join(', ')} (no calculation module exists for them) or when a form must be filled in by the user.` });
  return deepFreeze(defs);
}

// ── draft: validation, merge, fingerprint ───────────────────────────────────────────────────────────────────────────
const DRAFT_KEYS = ['kind', 'revision', 'tool', 'input', 'origins', 'fingerprint', 'result', 'resultFingerprint'];
function orderedInput(tool, input) { const out = {}; for (const k of Object.keys(tool.fields)) if (own(input, k)) out[k] = input[k]; return out; }
function buildDraft(tool, input, origins, result) {
  const ordered = orderedInput(tool, input); const fingerprint = fingerprintOf(tool.id, ordered);
  return deepFreeze({ kind: DRAFT_KIND, revision: CONTRACT_REVISION, tool: tool.id, input: ordered, origins: orderedInput(tool, origins), fingerprint,
    result: result || null, resultFingerprint: result ? fingerprint : null });
}
function resolveTool(id, errors) {
  if (typeof id !== 'string' || !own(TOOLS, id)) {
    errors.push(err(NAVIGATION_ONLY.some((n) => n.id === id) ? 'TOOL_NOT_EXECUTABLE' : 'UNKNOWN_TOOL', 'tool', typeof id === 'string' ? id.slice(0, LIMITS.stringMax) : typeof id));
    return null;
  }
  return TOOLS[id];
}
/** New empty draft for an executable tool. → { ok, draft, errors } */
function createDraft(toolId) {
  const errors = []; const tool = resolveTool(toolId, errors);
  return tool ? { ok: true, draft: buildDraft(tool, {}, {}, null), errors } : { ok: false, draft: null, errors };
}
/** Re-validate a draft from any source (in-memory or re-hydrated JSON). Internal: returns { tool, input, origins, result } or pushes errors. */
function checkDraft(draft, errors) {
  if (!isPlain(draft)) { errors.push(err('INVALID_DRAFT', 'draft')); return null; }
  const keys = ownKeysChecked(draft, 'draft', errors);
  if (!keys) return null;
  for (const k of keys) if (!DRAFT_KEYS.includes(k)) { errors.push(err('UNKNOWN_FIELD', `draft.${k}`)); return null; }
  if (draft.kind !== DRAFT_KIND || draft.revision !== CONTRACT_REVISION) { errors.push(err('INVALID_DRAFT', 'draft.kind')); return null; }
  const tool = resolveTool(draft.tool, errors);
  if (!tool) return null;
  if (!isPlain(draft.input) || !isPlain(draft.origins)) { errors.push(err('INVALID_DRAFT', 'draft.input')); return null; }
  const before = errors.length; const input = {}; const origins = {};
  const inKeys = ownKeysChecked(draft.input, 'input', errors); const orKeys = ownKeysChecked(draft.origins, 'origins', errors);
  if (!inKeys || !orKeys) return null;
  for (const k of inKeys) {
    if (!own(tool.fields, k)) { errors.push(err('UNKNOWN_FIELD', `input.${k}`)); continue; }
    const v = readValue(tool.fields[k], draft.input[k], k, errors);
    if (v !== undefined) input[k] = v;
    const o = draft.origins[k];
    if (!ORIGINS.includes(o)) errors.push(err('UNKNOWN_ORIGIN', `origins.${k}`));
    else if (tool.fields[k].origin === 'context' && o !== 'current_form') errors.push(err('CONTEXT_ONLY_FIELD', `origins.${k}`));   // provenance is re-checked on every draft, stored or not
    else origins[k] = o;
  }
  for (const k of orKeys) if (!own(draft.input, k)) errors.push(err('UNKNOWN_FIELD', `origins.${k}`));
  if (errors.length !== before) return null;
  const ordered = orderedInput(tool, input); const fingerprint = fingerprintOf(tool.id, ordered);
  if (draft.fingerprint !== fingerprint) { errors.push(err('STALE_FINGERPRINT', 'draft.fingerprint')); return null; }
  const r = draft.result;
  const attached = isPlain(r) && draft.resultFingerprint === fingerprint && r.kind === RESULT_KIND && r.revision === CONTRACT_REVISION && r.tool === tool.id
    && r.inputFingerprint === fingerprint && STATUS_VALUES.includes(r.status);
  // A stored result is re-hydrated member for member (hydrateStoredResult drops nothing; a result it cannot copy whole is not attached).
  return { tool, input: ordered, origins: orderedInput(tool, origins), fingerprint, result: attached ? (Object.isFrozen(r) ? r : hydrateStoredResult(r)) : null, hadResult: r !== null && r !== undefined };
}
/**
 * Validate a typed change { set: { field: value | null }, clear: [field] } for a tool, without applying it.
 * options.origin: 'conversation' (default; may not touch context-only fields) | 'current_form' (explicit import by the caller).
 * → { ok, errors, set (normalized copy), clear }
 */
function validatePatch(toolId, patch, options) {
  const errors = []; const tool = resolveTool(toolId, errors);
  const origin = options && options.origin !== undefined ? options.origin : 'conversation';
  if (!ORIGINS.includes(origin)) errors.push(err('UNKNOWN_ORIGIN', 'options.origin'));
  if (!tool || errors.length) return { ok: false, errors, set: {}, clear: [] };
  if (!isPlain(patch)) return { ok: false, errors: [err('PATCH_NOT_OBJECT', 'patch')], set: {}, clear: [] };
  const keys = ownKeysChecked(patch, '', errors);
  if (!keys) return { ok: false, errors, set: {}, clear: [] };
  for (const k of keys) if (k !== 'set' && k !== 'clear') errors.push(err('UNKNOWN_FIELD', k));
  const set = {}; const clear = [];
  const allowed = (k, path) => {
    if (!own(tool.fields, k)) { errors.push(err('UNKNOWN_FIELD', path)); return false; }
    if (tool.fields[k].origin === 'context' && origin !== 'current_form') { errors.push(err('CONTEXT_ONLY_FIELD', path)); return false; }
    return true;
  };
  if (patch.set !== undefined && patch.set !== null) {
    if (!isPlain(patch.set)) errors.push(err('NOT_PLAIN_OBJECT', 'set'));
    else {
      const setKeys = ownKeysChecked(patch.set, 'set', errors) || [];
      for (const k of setKeys) {
        if (patch.set[k] === null || patch.set[k] === undefined) { if (!own(tool.fields, k)) errors.push(err('UNKNOWN_FIELD', `set.${k}`)); continue; }
        if (!allowed(k, `set.${k}`)) continue;
        const v = readValue(tool.fields[k], patch.set[k], k, errors);
        if (v !== undefined) set[k] = v;
      }
    }
  }
  if (patch.clear !== undefined && patch.clear !== null) {
    if (!Array.isArray(patch.clear) || patch.clear.length > Object.keys(tool.fields).length) errors.push(err(Array.isArray(patch.clear) ? 'ARRAY_LENGTH' : 'WRONG_TYPE', 'clear'));
    else {
      for (let n = 0; n < patch.clear.length; n++) {
        const k = patch.clear[n];
        if (typeof k !== 'string') { errors.push(err('WRONG_TYPE', `clear[${n}]`)); continue; }
        if (!allowed(k, `clear[${n}]`)) continue;
        if (own(set, k)) { errors.push(err('CONFLICTING_PATCH', k)); continue; }
        if (!clear.includes(k)) clear.push(k);
      }
    }
  }
  return errors.length ? { ok: false, errors, set: {}, clear: [] } : { ok: true, errors, set: deepFreeze(set), clear };
}
/**
 * Merge a typed change into a draft. Never mutates the draft or the patch; returns a NEW deep-frozen draft with a new
 * input fingerprint. Any applied change removes the held result; an INVALID change applies nothing and also removes
 * the held result (it no longer reflects what the user asked for). A valid no-op keeps the result.
 * → { ok, draft, changedFields, staleResultCleared, errors }
 */
function mergeDraft(draft, patch, options) {
  const errors = []; const c = checkDraft(draft, errors);
  if (!c) return { ok: false, draft: null, changedFields: [], staleResultCleared: false, errors };
  const origin = options && options.origin !== undefined ? options.origin : 'conversation';
  const vp = validatePatch(c.tool.id, patch, { origin });
  if (!vp.ok) return { ok: false, draft: buildDraft(c.tool, c.input, c.origins, null), changedFields: [], staleResultCleared: c.hadResult, errors: vp.errors };
  const input = Object.assign({}, c.input); const origins = Object.assign({}, c.origins); const changed = [];
  for (const k of vp.clear) if (own(input, k)) { delete input[k]; delete origins[k]; changed.push(k); }
  for (const k of Object.keys(vp.set)) {
    if (own(input, k) && canonicalText(input[k]) === canonicalText(vp.set[k])) continue;
    input[k] = vp.set[k]; origins[k] = origin; changed.push(k);
  }
  if (!changed.length) return { ok: true, draft: buildDraft(c.tool, c.input, c.origins, c.result), changedFields: [], staleResultCleared: c.hadResult && !c.result, errors: [] };
  return { ok: true, draft: buildDraft(c.tool, input, origins, null), changedFields: changed, staleResultCleared: c.hadResult, errors: [] };
}
/** Explicit import of the application's current-form input (plain object of this tool's fields). Same rules as mergeDraft with origin 'current_form'. */
function importFormInput(draft, formInput) { return mergeDraft(draft, { set: formInput, clear: [] }, { origin: 'current_form' }); }

function missingFields(tool, input) {
  const out = [];
  for (const k of Object.keys(tool.fields)) {
    const f = tool.fields[k]; const required = typeof f.required === 'function' ? f.required(input) === true : f.required === true;
    if (required && !own(input, k)) out.push({ field: k, reason: typeof f.required === 'function' ? 'REQUIRED_BY_STATED_INPUT' : 'REQUIRED', directTo: f.origin === 'context' ? tool.form.name : null, question: f.question });
  }
  return out;
}
/** → { ok, state: 'ready' | 'needs_input' | 'invalid', tool, fingerprint, missing[], hasCurrentResult, errors } — never runs an engine. */
function validateDraft(draft) {
  const errors = []; const c = checkDraft(draft, errors);
  if (!c) return { ok: false, state: 'invalid', tool: null, fingerprint: null, missing: [], hasCurrentResult: false, errors };
  const missing = missingFields(c.tool, c.input);
  return { ok: true, state: missing.length ? 'needs_input' : 'ready', tool: c.tool.id, fingerprint: c.fingerprint, missing: deepFreeze(missing), hasCurrentResult: c.result !== null, errors };
}
/** Canonical fingerprint of a tool input (validated first). → { ok, fingerprint, errors } */
function fingerprintInput(toolId, input) {
  const made = createDraft(toolId);
  if (!made.ok) return { ok: false, fingerprint: null, errors: made.errors };
  const m = mergeDraft(made.draft, { set: input, clear: [] }, { origin: 'current_form' });
  return m.ok ? { ok: true, fingerprint: m.draft.fingerprint, errors: [] } : { ok: false, fingerprint: null, errors: m.errors };
}

// ── execution ───────────────────────────────────────────────────────────────────────────────────────────────────────
function assemble(tool, input, fingerprint, o) {
  return deepFreeze({
    kind: RESULT_KIND, revision: CONTRACT_REVISION, tool: tool.id, title: tool.title, status: o.status, coreStatus: o.coreStatus === undefined ? null : o.coreStatus,
    inputFingerprint: fingerprint, normalizedInput: input,
    engine: { module: tool.engine ? tool.engine.module : null, fn: tool.engine ? tool.engine.fn : null, called: o.called === true, args: o.args === undefined ? null : o.args },
    coreResult: o.coreResult === undefined ? null : o.coreResult,
    parts: o.parts || [], needsInput: o.needsInput || [], errors: o.errors || [], unresolved: o.unresolved || [], assumptions: o.assumptions || [],
    warnings: o.warnings || [], references: o.references || [], nextAction: o.nextAction === undefined ? null : o.nextAction, navigation: o.navigation === undefined ? null : o.navigation,
    flags: Object.assign({}, BASE_FLAGS, o.flags || {}, { installationApproved: false, approval: 'none', serviceSizingRecord: false, persistence: 'conversation_only' }),
    summary: o.summary || [],
  });
}
function runTool(tool, input, fingerprint) {
  const missing = missingFields(tool, input);
  if (missing.length) {
    return assemble(tool, input, fingerprint, { status: STATUS.NEEDS_INPUT, coreStatus: null, called: false, needsInput: missing,
      summary: [bi(`Nic nie policzono — brakuje: ${missing.map((m) => m.field).join(', ')}.`, `Nothing was calculated — missing: ${missing.map((m) => m.field).join(', ')}.`)] });
  }
  const prep = tool.prepare(input); let core;
  try { core = tool.call(prep.args); } catch (e) {
    return assemble(tool, input, fingerprint, { status: STATUS.ERROR, coreStatus: e && typeof e.name === 'string' ? e.name : 'Error', called: true, args: snapshot(prep.args),
      errors: [err('ENGINE_FAULT', null, e && typeof e.message === 'string' ? e.message.slice(0, 500) : null)], summary: [bi('Błąd silnika — brak wyniku.', 'Engine fault — no result.')] });
  }
  const coreCopy = snapshot(core);
  // An engine answer the tool reader cannot read, or a status outside the closed STATUS list, is an explicit 'error' — never a result by default.
  const unclassified = (coreStatus, detail) => assemble(tool, input, fingerprint, { status: STATUS.ERROR, coreStatus, called: true, args: snapshot(prep.args), coreResult: coreCopy,
    errors: [err('UNCLASSIFIED_RESULT', null, detail)], summary: [bi('Odpowiedź silnika nie została rozpoznana — brak wyniku.', 'The engine answer was not recognised — no result.')] });
  let out;
  try { out = tool.interpret(coreCopy, input, prep); } catch (e) {
    return unclassified('UNREADABLE_ENGINE_RESULT', e && typeof e.message === 'string' ? e.message.slice(0, 500) : null);
  }
  if (!isPlain(out) || !STATUS_VALUES.includes(out.status)) return unclassified('UNKNOWN_RESULT_STATUS', isPlain(out) ? String(out.status).slice(0, LIMITS.stringMax) : null);
  return assemble(tool, input, fingerprint, Object.assign({}, out, { called: true, args: snapshot(prep.args), coreResult: coreCopy }));
}
/**
 * Run the tool for a draft. Missing required input → status 'needs_input' (the engine is NOT called and nothing is
 * defaulted). → { ok, draft (new, with the result attached), result, errors }
 */
function execute(draft) {
  const errors = []; const c = checkDraft(draft, errors);
  if (!c) return { ok: false, draft: null, result: null, errors };
  const result = runTool(c.tool, c.input, c.fingerprint);
  return { ok: true, draft: buildDraft(c.tool, c.input, c.origins, result), result, errors: [] };
}
/** Convenience: new draft + one explicit input object + execute. options.origin as in mergeDraft (default 'conversation'). */
function run(toolId, input, options) {
  const made = createDraft(toolId);
  if (!made.ok) return { ok: false, draft: null, result: null, errors: made.errors };
  const m = mergeDraft(made.draft, { set: input === undefined || input === null ? {} : input, clear: [] }, options);
  return m.ok ? execute(m.draft) : { ok: false, draft: m.draft, result: null, errors: m.errors };
}
/**
 * Re-run a draft and compare with the result it carries (a persisted result is display data; this is the authority).
 * The comparison is the WHOLE result — every number, status, flag, text and list — in persisted-JSON form (key order is irrelevant; a stored -0
 * reads back as 0; undefined members do not exist in JSON). Nothing is exempted: a missing or altered member is a difference.
 * Input provenance (draft.origins) is not part of a result; it is enforced when the draft itself is validated (CONTEXT_ONLY_FIELD).
 * → { ok, current, reason: null | 'NO_STORED_RESULT' | 'STORED_RESULT_NOT_ATTACHED' | 'STORED_RESULT_DIFFERS' | 'INVALID_DRAFT', result (fresh), errors }
 */
function verifyResult(draft) {
  const errors = []; const c = checkDraft(draft, errors);
  if (!c) return { ok: false, current: false, reason: 'INVALID_DRAFT', result: null, errors };
  const fresh = runTool(c.tool, c.input, c.fingerprint);
  const jsonForm = (x) => canonicalText(JSON.parse(JSON.stringify(x)));
  let reason = null;
  if (!c.hadResult) reason = 'NO_STORED_RESULT';
  else if (c.result === null) reason = 'STORED_RESULT_NOT_ATTACHED';
  else { let same = false; try { same = jsonForm(c.result) === jsonForm(fresh); } catch (e) { same = false; } if (!same) reason = 'STORED_RESULT_DIFFERS'; }
  return { ok: true, current: reason === null, reason, result: fresh, errors: [] };
}
function navigationResult(entry) {
  const exec = own(TOOLS, entry.id);
  return assemble({ id: entry.id, title: entry.title, engine: null }, deepFreeze({}), null, {
    status: STATUS.NAVIGATION_ONLY, coreStatus: exec ? null : entry.reason, called: false,
    navigation: { tool: entry.id, form: Object.assign({}, entry.form), executableHere: exec, reason: exec ? 'USER_DIRECTED_TO_FORM' : entry.reason },
    summary: [exec ? bi(`Otwórz narzędzie „${entry.title.pl}” w aplikacji. Nic nie policzono.`, `Open the "${entry.title.en}" tool in the app. Nothing was calculated.`) : entry.message],
  });
}
/**
 * One provider tool call → merge → execute. `name` is a getToolDefinitions() name, `args` the model's arguments (re-validated
 * here whatever the provider enforced), `draft` the conversation's current draft for that tool (or null), `formInput` an
 * OPTIONAL explicit import of the application's current-form input (plain object of the tool's fields).
 * → { ok, draft, result, changedFields, errors }
 */
function handleToolCall(call) {
  const fail = (errors, draft) => ({ ok: false, draft: draft || null, result: null, changedFields: [], errors });
  if (!isPlain(call)) return fail([err('INVALID_ACTION', 'call')]);
  const callKeys = ownKeysChecked(call, 'call', []);
  if (!callKeys || callKeys.some((k) => !['name', 'args', 'draft', 'formInput'].includes(k))) return fail([err('INVALID_ACTION', 'call')]);
  const { name, args } = call;
  if (name === OPEN_TOOL_NAME) {
    const entry = isPlain(args) && Object.keys(args).length === 1 && own(args, 'tool') ? getTool(args.tool) : null;
    return entry ? { ok: true, draft: null, result: navigationResult(entry), changedFields: [], errors: [] } : fail([err('INVALID_ACTION', 'args.tool')]);
  }
  if (typeof name !== 'string' || name.indexOf(PROVIDER_TOOL_PREFIX) !== 0) return fail([err('UNKNOWN_TOOL', 'name')]);
  const errors = []; const tool = resolveTool(name.slice(PROVIDER_TOOL_PREFIX.length), errors);
  if (!tool) return fail(errors);
  let draft = call.draft;
  if (draft === undefined || draft === null) draft = createDraft(tool.id).draft;
  else { const c = checkDraft(draft, errors); if (!c || c.tool !== tool) return fail(errors.length ? errors : [err('INVALID_DRAFT', 'draft.tool')]); }
  let changed = [];
  if (call.formInput !== undefined && call.formInput !== null) {
    const im = importFormInput(draft, call.formInput);
    if (!im.ok) return fail(im.errors, im.draft);
    draft = im.draft; changed = changed.concat(im.changedFields);
  }
  if (modelFieldsOf(tool).length) {
    const m = mergeDraft(draft, args, { origin: 'conversation' });
    if (!m.ok) return fail(m.errors, m.draft);
    draft = m.draft; changed = changed.concat(m.changedFields.filter((k) => !changed.includes(k)));
  } else if (!isPlain(args) || Object.keys(args).length !== 1 || args.action !== CONTEXT_ACTION) {
    return fail([err('INVALID_ACTION', 'args.action')], mergeDraft(draft, { set: {}, clear: [] }).draft);
  }
  const ex = execute(draft);
  return ex.ok ? { ok: true, draft: ex.draft, result: ex.result, changedFields: changed, errors: [] } : fail(ex.errors);
}

// ── concise formatting (derived text only; every number comes from result.summary, i.e. from the engine) ────────────
function formatResult(result, lang) {
  const L = lang === 'en' ? 'en' : 'pl';
  if (!isPlain(result) || result.kind !== RESULT_KIND || !own(STATUS_LABEL, result.status)) return L === 'en' ? 'No calculator result.' : 'Brak wyniku kalkulatora.';
  const text = (x) => (isPlain(x) && typeof x[L] === 'string' ? x[L] : '');
  const lines = [`${text(result.title)} — ${STATUS_LABEL[result.status][L]}`];
  for (const s of result.summary) lines.push(text(s));
  if (result.parts.some((p) => p.state !== 'available') && result.parts.some((p) => p.state === 'available')) {
    for (const p of result.parts) lines.push(`• ${text(p.label)}: ${p.state === 'available' ? (L === 'en' ? 'available' : 'dostępne') : p.state === 'unresolved' ? (L === 'en' ? 'UNRESOLVED' : 'NIEROZSTRZYGNIĘTE') : (L === 'en' ? 'not evaluated' : 'nie oceniono')} (${p.coreStatus})`);
  }
  if (result.needsInput.length) { lines.push(L === 'en' ? 'Needed:' : 'Potrzebne:'); for (const n of result.needsInput) lines.push(`• ${text(n.question)}`); }
  if (result.unresolved.length) { lines.push(L === 'en' ? 'Unresolved:' : 'Nierozstrzygnięte:'); for (const u of result.unresolved) lines.push(`• ${u.code}: ${text(u.message)}`); }
  if (result.errors.length) { lines.push(L === 'en' ? 'Errors:' : 'Błędy:'); for (const e of result.errors) lines.push(`• ${e.field ? `${e.field}: ` : ''}${text(e.message)} [${e.code}]`); }
  if (result.assumptions.length) { lines.push(L === 'en' ? 'Assumptions:' : 'Założenia:'); for (const a of result.assumptions) lines.push(`• ${text(a.note)} (${a.source})`); }
  if (result.warnings.length) lines.push(`${L === 'en' ? 'Notes' : 'Uwagi'}: ${result.warnings.map((w) => w.code).join(', ')}`);
  return lines.filter((x) => x !== '').join('\n');
}

module.exports = {
  CONTRACT_REVISION, DRAFT_KIND, RESULT_KIND, STATUS, STATUS_LABEL, ORIGINS, LIMITS, FINGERPRINT_ALGORITHM,
  PROVIDER_TOOL_PREFIX, OPEN_TOOL_NAME, CONTEXT_ACTION, TOOL_IDS, NAVIGATION_ONLY,
  listTools, getTool, getToolInputSchema, getToolDefinitions,
  createDraft, validatePatch, mergeDraft, importFormInput, validateDraft, fingerprintInput,
  execute, run, verifyResult, handleToolCall, formatResult,
};
