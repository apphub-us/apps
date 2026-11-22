/*
 * Empire Code — STAGE5 assistant form bridge (docs/conversation-form-bridge.md).
 *
 * Iframe-local, synchronous, same-origin API for the parent conversation shell: window.ECAssistantBridge.
 *   getState()                                  -> readiness, generation token, active tool / mode, read-only job identity
 *   capture(toolId?)                            -> the CURRENT form input of one registry tool, mapped to registry fields
 *   apply({ toolId, expectedGeneration, patch }) -> validated, atomic correction of the SAME current form + its own render
 *   navigate(toolId)                            -> opens the existing app tool through the app's own entry function
 *   invalidate(reason?)                         -> explicit generation bump (parent cancels / starts a new turn)
 *   describe()                                  -> static tool -> form mapping
 *
 * Boundaries (by contract):
 *   - No formula, table or electrical default lives here. Values are read from real controls or from the page's own
 *     canonical reader functions; schema and validation come from the registry (window.EC.conversationTools).
 *   - Rendered result text is never read. An empty control is "not stated", never the form reader's fallback number.
 *   - Imported-context tools (Load Calc, Service Sizing, ordinary and preliminary) are read-only here; a conversation
 *     patch cannot write them. Their request is projected NOW from the form's live draft through the canonical
 *     projection the form itself uses (EC.loadCalcStateV2.toRequestV2); a previously calculated request or a held
 *     result is never captured as current. The workflow mode (existing / new design) is read, never switched.
 *   - Job context is the open job's saved head (identity + current saved revision) and two draft indicators, read only.
 *   - No network, storage, message channel, dynamic code or job write. Missing registry / reader / readiness fails closed.
 *   - Objects handed to apply() must be plain objects of THIS window's realm: a caller in the parent window clones the
 *     whole request through this window's JSON (see the docs); foreign prototypes are refused, not adapted.
 *
 * Loading: a classic script placed AFTER the calculator markup and scripts of workspace/mobile.html (and after the
 * generated EC bundle that carries conversationTools). In Node the factory is exported and nothing is installed.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && typeof module.exports === 'object') module.exports = api;
  if (root && root.window === root && root.document && typeof root.document.getElementById === 'function') api.autoInstall(root);
})(typeof window === 'object' ? window : null, function () {
  'use strict';

  var BRIDGE_REVISION = 1;
  var REGISTRY_REVISION = 1;
  var REGISTRY_FUNCTIONS = ['getTool', 'createDraft', 'validatePatch', 'mergeDraft', 'importFormInput', 'validateDraft'];
  /** Page globals the bridge may read or call. Nothing outside this list is ever looked up. */
  var PAGE_NAMES = ['openTool', 'cvTool', 'currentMoreTab', 'selectedGroundingTopic', 'currentCfConduit', 'cfRenderTable',
    'wsCalc', 'ampRoofChanged', 'ampUpdateCalc', 'cfUpdateCalc', 'wwCalc', 'bfUpdateCalc', 'bfReadAccessory', 'mtCalc', 'mtPhaseChanged', 'gndCalc',
    'btRead', 'btCalc', 'btSyncUnit', 'PBV23D', 'pbv23dEngineRequest', 'pbv23dMode', 'pbv23dTargetMode',
    'lcDraft', 'lcExportState', 'lcSvcDesignObject', 'lcIs82', 'lcCalcFresh', 'LC_PRE', 'LC_JOB'];
  var PANELS = ['home', 'jobs', 'chat', 'ampacity', 'conduit', 'vdrop', 'boxfill', 'wiresizer', 'more', 'pullbox'];
  var CONVERTER_SUBS = ['power', 'battery', 'torque', 'wire', 'temp', 'length'];
  var LOADCALC_IDS = ['load_calc', 'load_calc_preliminary', 'service_sizing', 'service_sizing_preliminary'];

  /**
   * Registry tool id -> the existing app form. appTool is the id the app's own openTool() accepts; null = no reachable form.
   * effects: what the app's own entry function does to that form when it is opened from elsewhere.
   */
  var FORMS = {
    battery_runtime: { appTool: 'converter', mode: 'battery', name: 'Converter — Wh / Runtime', effects: [] },
    wire_sizing: { appTool: 'wiresizer', mode: null, name: 'Wire Sizer', effects: [] },
    ampacity: { appTool: 'ampacity', mode: null, name: 'Ampacity', effects: [] },
    voltage_drop: { appTool: null, reason: 'NO_REACHABLE_FORM', name: null,
      note: 'The app catalogue has no voltage-drop tool. The legacy panel-vdrop is not reachable through openTool, has no conductor-size control and runs a minimum-size analysis, not the stated-conductor calculation of this registry tool. It is not opened or read.' },
    conduit_fill: { appTool: 'conduit', mode: 'conduit', name: 'Conduit Fill', effects: ['FORM_RECREATED_WITH_DEFAULTS'] },
    conduit_fill_mixed: { appTool: null, reason: 'NO_FORM_FOR_MIXED_CONDUCTORS', name: null,
      note: 'The Conduit Fill form holds one uniform conductor group; no form holds a list of mixed groups.' },
    wireway_fill: { appTool: 'wireway', mode: 'wireway', name: 'Conduit Fill — Wireway', effects: ['FORM_RECREATED_WITH_DEFAULTS'] },
    box_fill: { appTool: 'boxfill', mode: null, name: 'Box Fill', effects: [] },
    motor_circuit: { appTool: 'motor', mode: null, name: 'Motor 430', effects: [] },
    grounding: { appTool: 'grounding', mode: 'calc', name: 'Grounding — EGC / GEC calculator', effects: ['FORM_RECREATED_WITH_DEFAULTS'] },
    pull_box: { appTool: 'pullbox', mode: null, name: 'Pull / Junction Box', effects: ['EDITOR_RESET_TO_FAST_DEFAULT'] },
    load_calc: { appTool: 'loadcalc', mode: null, name: 'Load Calc', effects: [] },
    load_calc_preliminary: { appTool: 'loadcalc', mode: null, workflowMode: 'new_design', name: 'Load Calc — new-design workflow', effects: [] },
    service_sizing: { appTool: 'loadcalc', mode: null, name: 'Load Calc — Service Sizing preview', effects: [] },
    service_sizing_preliminary: { appTool: 'loadcalc', mode: null, workflowMode: 'new_design', name: 'Load Calc — Service Sizing preview, new-design workflow', effects: [] },
  };
  /** The two values of the page's conductor workflow mode (LC_PRE.mode). Read only; the bridge never selects a mode. */
  var WORKFLOW_MODES = ['existing', 'new_design'];
  /** Navigation-only capabilities: an existing screen is opened, nothing is calculated, captured or applied. */
  var NAVIGATION_ONLY = {
    power: { appTool: 'converter', mode: 'power', name: 'Converter — Power', effects: [] },
    torque: { appTool: 'converter', mode: 'torque', name: 'Converter — Torque', effects: [] },
    bender: { appTool: 'bender', mode: null, name: 'Conduit Bender', effects: [] },
  };

  // ── small pure helpers ────────────────────────────────────────────────────────────────────────────────────────────
  function own(o, k) { return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
  function isPlain(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    var p = Object.getPrototypeOf(v); return p === Object.prototype || p === null;
  }
  /** Stable text of plain data (sorted keys, undefined members omitted, -0 as 0). Used for equality, never as the stale guard. */
  function stable(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return v === 0 ? '0' : String(v);
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  /** True when a value holds at least one non-null leaf (shape-agnostic: no member name of any form is known here). */
  function hasAnswer(v) {
    if (v === null || v === undefined) return false;
    if (typeof v !== 'object') return true;
    return Object.keys(v).some(function (k) { return hasAnswer(v[k]); });
  }
  var NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  var INT_RE = /^[+-]?\d+$/;
  /** Strict text -> number. '' is "empty" (not stated), anything that is not a plain decimal is "invalid". No fallback value exists. */
  function parseNum(text, integer) {
    if (text === null || text === undefined) return { state: 'absent' };
    var t = String(text).trim();
    if (t === '') return { state: 'empty' };
    if (!(integer ? INT_RE : NUM_RE).test(t)) return { state: 'invalid' };
    var n = Number(t);
    return Number.isFinite(n) ? { state: 'ok', value: n === 0 ? 0 : n } : { state: 'invalid' };
  }
  function parseReason(n) { return n.state === 'absent' ? 'CONTROL_MISSING' : n.state === 'empty' ? 'EMPTY_CONTROL' : 'INVALID_CONTROL_VALUE'; }
  /** Number -> control text, only when it is a plain decimal (no exponent form is ever typed into a field). */
  function numText(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    var s = String(v === 0 ? 0 : v);
    return /^-?\d+(?:\.\d+)?$/.test(s) ? s : null;
  }
  function optionValues(el) {
    var o = el ? el.options : null;
    if (!o || typeof o.length !== 'number') return null;
    var out = [];
    for (var i = 0; i < o.length; i++) out.push(String(o[i].value));
    return out;
  }
  /** The option text to write for a value: an exact option, or the single option whose number equals the value ("0.8" vs "0.80"). */
  function matchOption(el, type, text, value) {
    var opts = optionValues(el);
    if (!opts) return { error: 'CONTROL_OPTIONS_UNREADABLE' };
    if (opts.indexOf(text) >= 0) return { value: text };
    if ((type === 'num' || type === 'int') && typeof value === 'number') {
      var hit = opts.filter(function (o) { var n = parseNum(o, false); return n.state === 'ok' && n.value === value; });
      if (hit.length === 1) return { value: hit[0] };
    }
    return { error: 'VALUE_NOT_AN_OPTION', allowed: opts.slice(0, 60) };
  }
  var S = function (f, id, kind, type, extra) { var s = { f: f, id: id, kind: kind, type: type }; if (extra) for (var k in extra) if (own(extra, k)) s[k] = extra[k]; return s; };
  var K = function (f, value, note) { return { f: f, type: 'const', value: value, note: note }; };

  /**
   * Bridge factory. env:
   *   document           the iframe document (getElementById, querySelectorAll, addEventListener, readyState)
   *   registry()         -> window.EC.conversationTools | null
   *   ec()               -> window.EC | null (engine tables, the battery module's own text parser, the Load Calc
   *                         draft -> request projection, the job-head validator; never a formula or an engine run)
   *   page(name)         -> a page global from PAGE_NAMES | undefined
   *   host()             -> window.ecHostBridge | null (only its read-only hasDraft() is ever called)
   *   bootId             opaque per-document token part
   */
  function createBridge(env) {
    var doc = env.document;
    var counter = 1;
    var lastInvalidation = 'boot';
    var activeKey = null;
    var lastCaptures = {};
    var listening = false;
    var bootId = typeof env.bootId === 'string' && env.bootId ? env.bootId : 'b0';

    function generation() { return 'g' + bootId + '.' + counter; }
    function bump(reason) { counter += 1; lastCaptures = {}; lastInvalidation = String(reason || 'unspecified').slice(0, 80); }

    // Event-based invalidation: every user input / change / click in this document makes earlier answers stale,
    // including an edit that is later reverted to the same values.
    if (doc && typeof doc.addEventListener === 'function') {
      var onUser = function (ev) { bump('user_' + (ev && typeof ev.type === 'string' ? ev.type : 'event')); };
      doc.addEventListener('input', onUser, true);
      doc.addEventListener('change', onUser, true);
      doc.addEventListener('click', onUser, true);
      listening = true;
    }

    function page(name) { return PAGE_NAMES.indexOf(name) >= 0 ? env.page(name) : undefined; }
    function el(id) { return doc.getElementById(id) || null; }
    function hasClass(id, cls) { var e = el(id); return !!(e && e.classList && typeof e.classList.contains === 'function' && e.classList.contains(cls)); }
    function shown(id) { var e = el(id); return !!(e && e.style && e.style.display !== 'none'); }

    function readiness() {
      var reasons = [];
      if (!doc || typeof doc.getElementById !== 'function') reasons.push('NO_DOCUMENT');
      else if (doc.readyState !== 'interactive' && doc.readyState !== 'complete') reasons.push('DOM_NOT_READY');
      if (!listening) reasons.push('NO_EVENT_SOURCE');
      var reg = null;
      try { reg = env.registry(); } catch (e) { reg = null; }
      if (!reg || typeof reg !== 'object') reasons.push('REGISTRY_MISSING');
      else {
        if (reg.CONTRACT_REVISION !== REGISTRY_REVISION) reasons.push('REGISTRY_REVISION_UNSUPPORTED');
        if (!Array.isArray(reg.TOOL_IDS)) reasons.push('REGISTRY_INCOMPLETE');
        for (var i = 0; i < REGISTRY_FUNCTIONS.length; i++) if (typeof reg[REGISTRY_FUNCTIONS[i]] !== 'function') { reasons.push('REGISTRY_INCOMPLETE'); break; }
      }
      return { ready: reasons.length === 0, reasons: reasons, registry: reasons.length === 0 ? reg : null };
    }

    // ── active tool / mode ──────────────────────────────────────────────────────────────────────────────────────────
    function detectActive() {
      var out = { panelId: null, appTool: null, mode: null, toolIds: [], navigationOnlyIds: [], primaryToolId: null, note: null };
      var act = PANELS.filter(function (p) { return hasClass('panel-' + p, 'active'); });
      if (act.length !== 1) { out.note = act.length ? 'MULTIPLE_ACTIVE_PANELS' : 'NO_ACTIVE_PANEL'; return out; }
      var p = act[0]; out.panelId = 'panel-' + p;
      var set = function (appTool, mode, toolIds, navIds, note) {
        out.appTool = appTool; out.mode = mode; out.toolIds = toolIds || []; out.navigationOnlyIds = navIds || []; out.note = note || null;
        out.primaryToolId = out.toolIds.length ? out.toolIds[0] : null;
      };
      if (p === 'wiresizer') set('wiresizer', null, ['wire_sizing']);
      else if (p === 'ampacity') set('ampacity', null, ['ampacity']);
      else if (p === 'boxfill') set('boxfill', null, ['box_fill']);
      else if (p === 'vdrop') set(null, null, [], [], 'LEGACY_PANEL_NOT_A_CATALOGUE_TOOL');
      else if (p === 'conduit') {
        // One shared panel; the mode swaps the whole form markup, so the controls that exist decide the mode.
        var cf = !!el('cfConduitType'); var ww = !!el('wwWidth');
        var btnC = hasClass('mode-conduit', 'active'); var btnW = hasClass('mode-wireway', 'active');
        if (cf && !ww && !btnW) set('conduit', 'conduit', ['conduit_fill']);
        else if (ww && !cf && !btnC) set('wireway', 'wireway', ['wireway_fill']);
        else set('conduit', 'unknown', [], [], 'CONDUIT_MODE_UNRESOLVED');
      } else if (p === 'pullbox') {
        var open = hasClass('pbv2-3d-prototype', 'show');
        var mode = typeof page('pbv23dMode') === 'string' ? page('pbv23dMode') : null;
        if (open) set('pullbox', mode, ['pull_box']); else set('pullbox', mode, [], [], 'PULL_BOX_SURFACE_NOT_SHOWN');
      } else if (p === 'more') {
        var sub = page('currentMoreTab');
        if (typeof sub !== 'string' || !shown('sub-' + sub)) set(null, null, [], [], 'MORE_SECTION_UNRESOLVED');
        else if (sub === 'loadcalc') { if (el('lcForm')) set('loadcalc', null, LOADCALC_IDS.slice()); else set('loadcalc', null, [], [], 'LOAD_CALC_FORM_NOT_BUILT'); }
        else if (sub === 'motor') set('motor', null, ['motor_circuit']);
        else if (sub === 'bender') set('bender', null, [], ['bender']);
        else if (sub === 'converter') {
          var vis = CONVERTER_SUBS.filter(function (t) { return shown('cvt-' + t); });
          if (vis.length !== 1) set('converter', 'unknown', [], [], 'CONVERTER_TOOL_UNRESOLVED');
          else if (vis[0] === 'battery') set('converter', 'battery', ['battery_runtime']);
          else if (vis[0] === 'power' || vis[0] === 'torque') set('converter', vis[0], [], [vis[0]]);
          else set('converter', vis[0], []);
        } else if (sub === 'coderef') {
          if (page('selectedGroundingTopic') === 'calc' && el('gnd-ocpd') && shown('groundingDetailView')) set('grounding', 'calc', ['grounding']);
          else set('coderef', null, []);
        } else set(sub, null, []);
      } else set(p, null, []);
      return out;
    }
    /** Observe the active tool; a change since the last observation (by any route, with or without events) invalidates. */
    function syncActive() {
      var a = detectActive(); var key = stable(a);
      if (key !== activeKey) { if (activeKey !== null) bump('active_tool_changed'); activeKey = key; }
      return a;
    }
    function isActiveFor(a, toolId) { return a.toolIds.indexOf(toolId) >= 0 || a.navigationOnlyIds.indexOf(toolId) >= 0; }

    // ── read-only job context ───────────────────────────────────────────────────────────────────────────────────────
    function hostDraft() {
      var h = null;
      try { h = env.host ? env.host() : null; } catch (e) { h = null; }
      if (!h || typeof h.hasDraft !== 'function') return null;
      try { return h.hasDraft() === true; } catch (e2) { return null; }
    }
    /**
     * The open job as the page holds it: LC_JOB.current = { head, revision }, the pair the job store returned when this
     * page last opened or saved the job (core/src/jobs/jobCardStore.js: head = { kind, recordVersion, jobId,
     * currentRevisionId, revisionNumber }, head.currentRevisionId === revision.revisionId).
     *   jobId             job identity — constant over every revision of the job
     *   currentRevisionId the latest SAVED revision as this page last read or wrote it (another window may have saved a
     *                     newer one since; the store then answers CONFLICT — this value is not live)
     *   revisionNumber    ordinal of that saved revision
     *   jobCardDraftOpen  LC_JOB.editor is set: unsaved job-card edits (or a new job being typed) exist on screen; the
     *                     ids above still name the last saved revision, a draft has no revision id
     *   hasUnsavedDraft   ecHostBridge.hasDraft(): ANY job-side draft or busy job operation (job card, measurement,
     *                     material, photo, archive, restore); null without the host bridge
     * Anything unreadable or inconsistent is reported as unavailable with nulls. No title, address, note or link is copied.
     */
    var JOB_HEAD_MEMBERS = ['kind', 'recordVersion', 'jobId', 'currentRevisionId', 'revisionNumber'];
    function jobContext() {
      var out = { available: false, reason: null, jobId: null, currentRevisionId: null, revisionNumber: null, head: null, headValidation: null, jobCardDraftOpen: null, hasUnsavedDraft: hostDraft() };
      var J = page('LC_JOB');
      if (!J || typeof J !== 'object') { out.reason = 'JOB_STATE_UNAVAILABLE'; return out; }
      out.jobCardDraftOpen = J.editor !== null && J.editor !== undefined;
      var cur = J.current;
      if (cur === null || cur === undefined) { out.reason = out.jobCardDraftOpen ? 'NEW_JOB_NOT_SAVED' : 'NO_OPEN_JOB'; return out; }
      var head = typeof cur === 'object' && cur.head && typeof cur.head === 'object' ? cur.head : null;
      var rev = typeof cur === 'object' && cur.revision && typeof cur.revision === 'object' ? cur.revision : null;
      var text = function (v) { return typeof v === 'string' && v.length > 0 && v.length <= 200; };
      if (!head || !text(head.jobId) || !text(head.currentRevisionId) || !Number.isSafeInteger(head.revisionNumber) || head.revisionNumber < 1) { out.reason = 'JOB_HEAD_UNREADABLE'; return out; }
      // The job model's own validator decides when it is loaded; without it only the member types above are known.
      var ec = null; try { ec = env.ec ? env.ec() : null; } catch (e) { ec = null; }
      var model = ec && ec.jobCard && typeof ec.jobCard.validateHead === 'function' ? ec.jobCard : null;
      if (model) {
        var problems = null; try { problems = model.validateHead(head); } catch (e2) { problems = ['validator fault']; }
        if (!Array.isArray(problems) || problems.length) { out.reason = 'JOB_HEAD_INVALID'; return out; }
      }
      // The store hands out head and revision as one consistent pair; a pair that disagrees names no current revision.
      if (!rev || rev.jobId !== head.jobId || rev.revisionId !== head.currentRevisionId || rev.revisionNumber !== head.revisionNumber) { out.reason = 'JOB_HEAD_REVISION_MISMATCH'; return out; }
      var copy = {};
      JOB_HEAD_MEMBERS.forEach(function (k) { var v = head[k]; if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) copy[k] = v; });
      out.available = true; out.head = copy; out.headValidation = model ? 'canonical' : 'member_types_only';
      out.jobId = head.jobId; out.currentRevisionId = head.currentRevisionId; out.revisionNumber = head.revisionNumber;
      return out;
    }

    // ── form reading ────────────────────────────────────────────────────────────────────────────────────────────────
    /** overlay: planned control texts for a dry run (the DOM is not touched). */
    function makeReader(overlay) {
      return {
        overlay: overlay || null,
        real: function (id) { var e = el(id); return e ? String(e.value === null || e.value === undefined ? '' : e.value) : null; },
        raw: function (id) { return overlay && own(overlay, id) ? overlay[id] : this.real(id); },
      };
    }
    function collector() {
      var c = { input: {}, fields: [] };
      c.put = function (field, value, source, controlIds, note) { c.input[field] = value; c.fields.push({ field: field, state: 'captured', source: source, controlIds: controlIds || [], reason: null, note: note || null }); };
      c.miss = function (field, state, reason, controlIds, note) { c.fields.push({ field: field, state: state, source: null, controlIds: controlIds || [], reason: reason, note: note || null }); };
      return c;
    }
    function readSpec(s, R, c) {
      if (s.type === 'const') { c.put(s.f, s.value, 'form_constant', [], s.note); return; }
      var raw = R.raw(s.id);
      if (raw === null) { c.miss(s.f, 'missing', 'CONTROL_MISSING', [s.id]); return; }
      if (s.type === 'str') { if (raw === '') c.miss(s.f, 'missing', 'EMPTY_CONTROL', [s.id]); else c.put(s.f, raw, 'control', [s.id]); return; }
      if (s.type === 'yesno' || s.type === 'flag01') {
        var yes = s.type === 'yesno' ? 'yes' : '1'; var no = s.type === 'yesno' ? 'no' : '0';
        if (raw === yes) c.put(s.f, true, 'control', [s.id]);
        else if (raw === no) c.put(s.f, false, 'control', [s.id]);
        else c.miss(s.f, raw === '' ? 'missing' : 'invalid', raw === '' ? 'EMPTY_CONTROL' : 'INVALID_CONTROL_VALUE', [s.id]);
        return;
      }
      var n = parseNum(raw, s.type === 'int');
      if (n.state === 'ok') c.put(s.f, n.value, 'control', [s.id]);
      else c.miss(s.f, n.state === 'invalid' ? 'invalid' : 'missing', parseReason(n), [s.id], n.state === 'empty' ? (s.emptyNote || null) : null);
    }

    // ── planning control writes (nothing is written here) ───────────────────────────────────────────────────────────
    function writeFor(s, value, P, list, deferred) {
      if (s.type === 'const') return;   // no control: the dry run decides whether the form already holds this value
      var e = el(s.id);
      if (!e) { P.refuse(s.f, 'CONTROL_MISSING', s.id); return; }
      var text;
      if (value === undefined) text = '';
      else if (s.type === 'str') text = String(value);
      else if (s.type === 'yesno') text = value ? 'yes' : 'no';
      else if (s.type === 'flag01') text = value ? '1' : '0';
      else text = numText(value);
      if (text === null) { P.refuse(s.f, 'UNREPRESENTABLE_NUMBER', s.id); return; }
      if (s.kind === 'select' && !deferred) {
        var m = matchOption(e, s.type, text, value);
        if (m.error) { P.refuse(s.f, value === undefined ? 'CANNOT_CLEAR_SELECT' : m.error, s.id, m.allowed); return; }
        text = m.value;
      }
      list.push({ id: s.id, value: text, field: s.f, kind: s.kind, type: s.type, target: value, deferred: !!(deferred && s.kind === 'select') });
    }
    function genericWrites(a, P, list, skip) {
      P.changed.forEach(function (f) {
        if ((skip && skip.indexOf(f) >= 0) || (a.custom && a.custom.indexOf(f) >= 0)) return;
        var s = null;
        for (var i = 0; i < a.specs.length; i++) if (a.specs[i].f === f) s = a.specs[i];
        if (!s) { P.refuse(f, 'NO_FORM_CONTROL', null); return; }
        writeFor(s, P.value(f), P, list, false);
      });
    }

    // ── per-tool form adapters ──────────────────────────────────────────────────────────────────────────────────────
    var WS_DWELLING = S('feedsDwellingUnit', 'wsDwelling', 'select', 'yesno');
    var AMP_SUN = S('rooftopDirectSunlight', 'ampRoofSun', 'select', 'yesno');
    var AMP_CLEAR = S('rooftopClearanceInches', 'ampRoofClearance', 'select', 'num');
    var BF_BOX = S('boxKey', 'bfBoxType', 'select', 'str');
    var BF_EGC_SIZE = S('egcSize', 'bfEgcSize', 'select', 'str');
    var MT_PHASE = S('phase', 'mt-phase', 'select', 'num');
    var MT_VOLTS = S('volts', 'mt-volts', 'select', 'num');
    var MT_HP = S('hp', 'mt-hp', 'select', 'str');
    var GND_RING = S('groundRing', 'gnd-ring', 'select', 'str');
    var BT_IDS = { capacityWh: 'bt-capacity', consumptionMode: 'bt-mode', consumption: 'bt-consumption', chargePercent: 'bt-charge', usablePercent: 'bt-usable' };
    var BT_NUMERIC = ['capacityWh', 'consumption', 'chargePercent', 'usablePercent'];

    // ── Load Calc / Service Sizing: the CURRENT draft, never the last calculated request ───────────────────────────────
    var LC_REQUEST_NOTE = 'Projected now from the form\'s live draft by the canonical draft-to-request projection (the one the form uses for Calculate and for its preliminary check). It is not the request of an earlier calculation, and no result is read.';
    /** The page's conductor workflow mode (stage 4): 'existing' | 'new_design' | null when the page exposes no such state. */
    function lcWorkflow() {
      var pre = page('LC_PRE');
      if (!pre || typeof pre !== 'object' || WORKFLOW_MODES.indexOf(pre.mode) < 0) return { mode: null, held: null };
      return { mode: pre.mode, held: pre.result !== null && pre.result !== undefined };   // only WHETHER a preliminary result is held; its content is never read
    }
    /**
     * -> { request, details, key } for the form as it is NOW, or { requiresForm | unavailable, details }.
     * Reader: lcDraft() (the page's live five-field draft) -> EC.loadCalcStateV2.toRequestV2 (pure, works on a copy).
     * lcExportState() is consulted only for the form's own fault flag and to say whether the last evaluated request still
     * equals the current one; its lastRequest / result are never forwarded.
     */
    function lcCurrent(toolId, preliminary) {
      var flow = lcWorkflow();
      var details = { tool: toolId, requestSource: 'current_draft', workflowMode: flow.mode, optional82Route: typeof page('lcIs82') === 'function' ? page('lcIs82')() === true : null };
      if (preliminary) {
        if (flow.mode === null) return { unavailable: ['LC_PRE.mode'], details: details };
        if (flow.mode !== 'new_design') return { requiresForm: 'NEW_DESIGN_MODE_NOT_SELECTED', details: details };
        details.preliminaryResultHeld = flow.held;
      }
      var ec = env.ec ? env.ec() : null; var SV = ec ? ec.loadCalcStateV2 : null;
      if (!SV || typeof SV.toRequestV2 !== 'function') return { unavailable: ['EC.loadCalcStateV2.toRequestV2'], details: details };
      var s = page('lcExportState')();
      if (!s || typeof s !== 'object') return { requiresForm: 'FORM_STATE_UNREADABLE', details: details };
      if (s.fault) {   // the form shows a controlled error instead of a result; what its controls show may not be what its draft holds
        details.fault = { kind: typeof s.fault.kind === 'string' ? s.fault.kind.slice(0, 40) : null, message: typeof s.fault.message === 'string' ? s.fault.message.slice(0, 300) : null };
        details.message = details.fault.message;
        return { requiresForm: 'FORM_REPORTS_FAULT', details: details };
      }
      var draft = page('lcDraft')();
      if (!draft || typeof draft !== 'object' || draft.snapshot === null || draft.snapshot === undefined) return { requiresForm: 'NO_CURRENT_DRAFT', details: details };
      var req = SV.toRequestV2(draft);
      if (!req || req.ok !== true || req.request === null || typeof req.request !== 'object') {
        details.problems = req && Array.isArray(req.problems) ? req.problems.slice(0, 6).map(function (p) { return String(p).slice(0, 200); }) : [];
        return { requiresForm: 'DRAFT_NOT_PROJECTABLE', details: details };
      }
      details.evaluations = typeof s.evaluations === 'number' ? s.evaluations : null;
      details.matchesLastEvaluatedRequest = s.lastRequest !== null && typeof s.lastRequest === 'object' ? stable(s.lastRequest) === stable(req.request) : false;
      details.calculateFresh = typeof page('lcCalcFresh') === 'function' ? page('lcCalcFresh')() === true : null;
      return { request: req.request, details: details, key: { workflowMode: flow.mode } };
    }
    /** asHeld: forward the design object exactly as the form holds it (the form's preliminary check sends it that way, blank or not). */
    function lcReadDesign(c, asHeld) {
      var d = page('lcSvcDesignObject')();
      if (d === null || typeof d !== 'object' || Array.isArray(d)) { c.miss('design', 'invalid', 'DESIGN_UNREADABLE', []); return; }
      var copy = JSON.parse(JSON.stringify(d)); var answered = hasAnswer(copy);
      if (answered) c.put('design', copy, 'form_reader', [], 'The design answers held now by the Service Sizing preview (unanswered members stay null).');
      else if (asHeld) c.put('design', copy, 'form_reader', [], 'No design answer has been given yet; the object is forwarded with every answer null, exactly as the form\'s own preliminary check would send it.');
      else c.miss('design', 'not_stated', 'DESIGN_BLANK', [], 'No design answer has been given in the Service Sizing preview.');
    }
    function lcAdapter(toolId, preliminary, design) {
      return { requires: design ? ['lcDraft', 'lcExportState', 'lcSvcDesignObject'] : ['lcDraft', 'lcExportState'], controls: [],
        read: function (R, c) {
          var r = lcCurrent(toolId, preliminary);
          if (!r.request) return r;
          c.put('request', r.request, 'form_reader', [], LC_REQUEST_NOTE);
          if (design) lcReadDesign(c, preliminary);
          return { details: r.details, key: r.key };
        } };
    }

    var ADAPTERS = {
      wire_sizing: {
        requires: ['wsCalc'], calls: ['wsCalc'], extraControls: ['wsLoad', 'wsContinuous', 'wsDwelling'],
        custom: ['noncontinuousLoadA', 'continuousLoadA', 'feedsDwellingUnit'],
        specs: [
          S('material', 'wsMaterial', 'select', 'str'), S('insulation', 'wsInsul', 'select', 'str'), S('ambientF', 'wsTemp', 'select', 'num'),
          S('adjustmentFactor', 'wsBundle', 'select', 'num'),
          K('terminalRatingC', 75, 'The Wire Sizer form has no terminal-rating control; its engine request always carries 75 °C.'),
          S('circuitType', 'wsCircuitType', 'select', 'str'),
          K('jurisdiction', 'NYC', 'The Wire Sizer form has no jurisdiction control; its engine request always carries NYC.'),
          S('feet', 'wsFeet', 'input', 'num', { emptyNote: 'The form reads an empty distance as 0 ft (no voltage-drop check). That fallback is not imported as a stated value.' }),
          S('voltage', 'wsVoltage', 'select', 'num'), S('phase', 'wsPhase', 'select', 'num'), S('maxVoltDropPercent', 'wsMaxVD', 'select', 'num'),
          S('assemblyRatedFor100PercentContinuousOperation', 'wsHundredPct', 'select', 'yesno'),
        ],
        readExtra: function (R, c) {
          // The form holds a TOTAL load and the continuous PORTION; the registry holds the two parts.
          var load = parseNum(R.raw('wsLoad'), false); var cont = parseNum(R.raw('wsContinuous'), false);
          if (cont.state === 'ok') c.put('continuousLoadA', cont.value, 'control', ['wsContinuous']);
          else c.miss('continuousLoadA', cont.state === 'invalid' ? 'invalid' : 'missing', parseReason(cont), ['wsContinuous'], cont.state === 'empty' ? 'The form reads an empty continuous portion as 0 A. That fallback is not imported as a stated value.' : null);
          if (load.state !== 'ok') c.miss('noncontinuousLoadA', load.state === 'invalid' ? 'invalid' : 'missing', parseReason(load), ['wsLoad']);
          else if (cont.state !== 'ok') c.miss('noncontinuousLoadA', 'missing', 'DEPENDS_ON_UNSTATED_CONTROL', ['wsLoad', 'wsContinuous'], 'The form holds a total load of ' + load.value + ' A; the noncontinuous part is that total minus the continuous portion, which is not stated.');
          else if (cont.value > load.value) c.miss('noncontinuousLoadA', 'invalid', 'CONTINUOUS_EXCEEDS_TOTAL', ['wsLoad', 'wsContinuous']);
          else c.put('noncontinuousLoadA', load.value - cont.value, 'form_derived', ['wsLoad', 'wsContinuous'], 'Total load minus the continuous portion — the same split the form\'s engine request resolves to.');
          if (c.input.circuitType === 'FEEDER') readSpec(WS_DWELLING, R, c);   // the control is shown for feeders only
        },
        planExtra: function (P, list) {
          if (P.changed.indexOf('continuousLoadA') >= 0 || P.changed.indexOf('noncontinuousLoadA') >= 0) {
            var cont = P.value('continuousLoadA'); var non = P.value('noncontinuousLoadA');
            if (typeof cont !== 'number' || typeof non !== 'number') P.refuse(typeof cont !== 'number' ? 'continuousLoadA' : 'noncontinuousLoadA', 'LOAD_PAIR_REQUIRED', 'wsLoad');
            else {
              var total = numText(non + cont); var part = numText(cont);
              if (total === null || part === null) P.refuse('noncontinuousLoadA', 'UNREPRESENTABLE_NUMBER', 'wsLoad');
              else { list.push({ id: 'wsLoad', value: total, field: 'noncontinuousLoadA', kind: 'input' }); list.push({ id: 'wsContinuous', value: part, field: 'continuousLoadA', kind: 'input' }); }
            }
          }
          if (P.changed.indexOf('feedsDwellingUnit') >= 0) writeFor(WS_DWELLING, P.value('feedsDwellingUnit'), P, list, false);
        },
      },
      ampacity: {
        requires: ['ampRoofChanged', 'ampUpdateCalc'], calls: ['ampRoofChanged'], extraControls: ['ampRoofSun', 'ampRoofClearance'],
        custom: ['terminalRatingC', 'rooftopDirectSunlight', 'rooftopClearanceInches'],
        specs: [
          S('size', 'ampWireSize', 'select', 'str'), S('material', 'ampMaterial', 'select', 'str'), S('insulation', 'ampInsul', 'select', 'str'),
          S('ambientF', 'ampTemp', 'select', 'num'), S('adjustmentFactor', 'ampBundle', 'select', 'num'), S('onOrAboveRoof', 'ampRoof', 'select', 'yesno'),
        ],
        readExtra: function (R, c) {
          if (own(c.input, 'insulation')) c.put('terminalRatingC', c.input.insulation === 'tw' ? 60 : 75, 'form_derived', ['ampInsul'], 'The Ampacity form has no terminal-rating control; its reader sends 60 °C for TW and 75 °C otherwise.');
          if (c.input.onOrAboveRoof === true) { readSpec(AMP_SUN, R, c); readSpec(AMP_CLEAR, R, c); }   // both controls are shown only on a roof
        },
        planExtra: function (P, list) {
          // Off a roof the form does not read the two rooftop controls, so withdrawing those answers needs no write there.
          [AMP_SUN, AMP_CLEAR].forEach(function (s) {
            if (P.changed.indexOf(s.f) < 0 || (P.value(s.f) === undefined && P.value('onOrAboveRoof') !== true)) return;
            writeFor(s, P.value(s.f), P, list, false);
          });
        },
      },
      conduit_fill: {
        requires: ['cfUpdateCalc'], calls: ['cfUpdateCalc'],
        specs: [S('conduitType', 'cfConduitType', 'select', 'str'), S('conduitSize', 'cfConduitSize', 'select', 'str'), S('wireType', 'cfWireType', 'select', 'str'),
          S('wireSize', 'cfWireSize', 'select', 'str'), S('numConductors', 'cfNumWires', 'select', 'int')],
        after: function (P) {   // what the wire-type control's own change handler does besides the calculation
          if (P.changed.indexOf('wireType') >= 0 && typeof page('cfRenderTable') === 'function' && typeof page('currentCfConduit') === 'string') page('cfRenderTable')(page('currentCfConduit'));
        },
      },
      wireway_fill: {
        // Integration prerequisite (docs section 7): the shipped wwCalc routes to EC.conduitFill.calculateWirewayFill,
        // the engine of the registry tool, so form and registry results come from one implementation.
        requires: ['wwCalc'], calls: ['wwCalc'],
        specs: [S('width', 'wwWidth', 'select', 'num'), S('height', 'wwHeight', 'select', 'num'), S('wireType', 'wwWireType', 'select', 'str'),
          S('wireSize', 'wwWireSize', 'select', 'str'), S('numConductors', 'wwNumWires', 'select', 'int')],
      },
      box_fill: {
        requires: ['bfUpdateCalc', 'bfReadAccessory'], calls: ['bfUpdateCalc'], extraControls: ['bfAccessory', 'bfExtension', 'bfEgcSize'],
        custom: ['boxKey', 'extensionVolume', 'egcSize', 'numSupportFittings'],
        specs: [BF_BOX, S('largestWireSize', 'bfWireSize', 'select', 'str'), S('numConductors', 'bfConductors', 'input', 'int'), S('numDevices', 'bfDevices', 'input', 'int'),
          S('hasClamps', 'bfClamps', 'select', 'flag01'), S('egcCount', 'bfEgcCount', 'input', 'int')],
        readExtra: function (R, c) {
          c.miss('numSupportFittings', 'missing', 'NO_FORM_CONTROL', [], 'The Box Fill form has no support-fitting control and sends no such count to the engine; the user must state it.');
          if (c.input.egcCount > 0) readSpec(BF_EGC_SIZE, R, c);
          // Ring / raised cover. A base-box change resets the selection to None in the form itself (product rule of the page).
          var ov = R.overlay || {};
          var boxChanges = own(ov, 'bfBoxType') && ov.bfBoxType !== R.real('bfBoxType');
          var mode = own(ov, 'bfAccessory') ? ov.bfAccessory : (boxChanges ? 'none' : R.raw('bfAccessory'));
          if (mode === null) c.miss('extensionVolume', 'missing', 'CONTROL_MISSING', ['bfAccessory']);
          else if (mode === 'none') c.put('extensionVolume', 0, 'control', ['bfAccessory'], 'Ring / raised cover: None.');
          else if (mode === 'custom') {
            var n = parseNum(own(ov, 'bfExtension') ? ov.bfExtension : (boxChanges ? '0' : R.raw('bfExtension')), false);
            if (n.state === 'ok' && n.value >= 0) c.put('extensionVolume', n.value, 'control', ['bfAccessory', 'bfExtension'], 'Other / Custom marked volume.');
            else c.miss('extensionVolume', n.state === 'empty' || n.state === 'absent' ? 'missing' : 'invalid', n.state === 'ok' ? 'INVALID_CONTROL_VALUE' : parseReason(n), ['bfExtension']);
          } else {
            var acc = page('bfReadAccessory')(c.input.boxKey);   // the page's own catalog resolver; the bridge holds no catalog
            if (acc && acc.mode === 'catalog' && typeof acc.volume === 'number' && Number.isFinite(acc.volume)) c.put('extensionVolume', acc.volume, 'form_reader', ['bfAccessory'], 'Catalog ring / cover resolved by the form\'s own reader.');
            else c.miss('extensionVolume', 'invalid', 'INVALID_ACCESSORY', ['bfAccessory']);
          }
        },
        plan: function (P) {
          var first = []; var rest = [];
          var boxChanged = P.changed.indexOf('boxKey') >= 0; var extStated = own(P.patchSet, 'extensionVolume');
          if (boxChanged) writeFor(BF_BOX, P.value('boxKey'), P, first, false);
          genericWrites(this, P, rest, null);
          if (P.changed.indexOf('numSupportFittings') >= 0) P.refuse('numSupportFittings', 'NO_FORM_CONTROL', null);
          if (P.changed.indexOf('egcSize') >= 0) writeFor(BF_EGC_SIZE, P.value('egcSize'), P, rest, false);
          if (boxChanged && !extStated && P.current.extensionVolume !== 0) P.refuse('extensionVolume', 'BOX_CHANGE_RESETS_RING_VOLUME', 'bfAccessory');
          if (P.changed.indexOf('extensionVolume') >= 0 || (boxChanged && extStated)) {
            var v = P.value('extensionVolume'); var text = numText(v);
            if (text === null || v < 0) P.refuse('extensionVolume', v === undefined ? 'CANNOT_CLEAR_SELECT' : 'UNREPRESENTABLE_NUMBER', 'bfAccessory');
            else {
              rest.push({ id: 'bfAccessory', value: v === 0 ? 'none' : 'custom', field: 'extensionVolume', kind: 'select', type: 'str', target: v === 0 ? 'none' : 'custom', deferred: true });
              if (v !== 0) rest.push({ id: 'bfExtension', value: text, field: 'extensionVolume', kind: 'input' });
            }
          }
          return boxChanged ? [{ writes: first, call: ['bfUpdateCalc'] }, { writes: rest, call: ['bfUpdateCalc'] }] : [{ writes: rest, call: ['bfUpdateCalc'] }];
        },
      },
      motor_circuit: {
        requires: ['mtCalc', 'mtPhaseChanged'], calls: ['mtCalc'], restoreCalls: ['mtPhaseChanged'], extraControls: ['mt-nameplate'],
        custom: ['nameplateFLA', 'phase', 'volts', 'hp'],
        specs: [MT_HP, MT_VOLTS, MT_PHASE, S('motorType', 'mt-type', 'select', 'str'), S('ocpdType', 'mt-ocpd', 'select', 'str'),
          K('material', 'cu', 'The Motor form has no material control; its result is stated for copper and its engine request carries no material.'),
          S('serviceFactorMultiplier', 'mt-sf', 'select', 'num')],
        readExtra: function (R, c) {
          var n = parseNum(R.raw('mt-nameplate'), false);
          if (n.state === 'ok') c.put('nameplateFLA', n.value, 'control', ['mt-nameplate']);
          else c.miss('nameplateFLA', n.state === 'invalid' ? 'invalid' : 'not_stated', parseReason(n), ['mt-nameplate']);
        },
        plan: function (P) {
          var first = []; var rest = [];
          var phaseChanged = P.changed.indexOf('phase') >= 0;
          if (phaseChanged) {
            // The phase select rebuilds the voltage / horsepower options from the engine tables; check against the same tables first.
            var ec = env.ec ? env.ec() : null; var T = ec && ec.tables ? ec.tables : null; var ph = P.value('phase');
            var volts = T ? (ph === 1 ? T.MT_V_1PH : T.MT_V_3PH) : null; var flc = T ? (ph === 1 ? T.MT_FLC_1PH : T.MT_FLC_3PH) : null;
            if (!Array.isArray(volts) || !flc || typeof flc !== 'object') P.refuse('phase', 'ENGINE_TABLES_UNAVAILABLE', 'mt-phase');
            else {
              if (volts.map(String).indexOf(String(P.value('volts'))) < 0) P.refuse('volts', 'NOT_AVAILABLE_FOR_PHASE', 'mt-volts', volts.map(String));
              if (typeof P.value('hp') !== 'string' || !own(flc, P.value('hp'))) P.refuse('hp', 'NOT_AVAILABLE_FOR_PHASE', 'mt-hp', Object.keys(flc));
            }
            writeFor(MT_PHASE, ph, P, first, false);
            writeFor(MT_VOLTS, P.value('volts'), P, rest, true);
            writeFor(MT_HP, P.value('hp'), P, rest, true);
          } else {
            if (P.changed.indexOf('volts') >= 0) writeFor(MT_VOLTS, P.value('volts'), P, rest, false);
            if (P.changed.indexOf('hp') >= 0) writeFor(MT_HP, P.value('hp'), P, rest, false);
          }
          genericWrites(this, P, rest, null);
          if (P.changed.indexOf('nameplateFLA') >= 0) {
            var v = P.value('nameplateFLA'); var text = v === undefined ? '' : numText(v);
            if (text === null) P.refuse('nameplateFLA', 'UNREPRESENTABLE_NUMBER', 'mt-nameplate'); else rest.push({ id: 'mt-nameplate', value: text, field: 'nameplateFLA', kind: 'input' });
          }
          return phaseChanged ? [{ writes: first, call: ['mtPhaseChanged'] }, { writes: rest, call: ['mtCalc'] }] : [{ writes: rest, call: ['mtCalc'] }];
        },
      },
      grounding: {
        requires: ['gndCalc'], calls: ['gndCalc'], extraControls: ['gnd-ring'], custom: ['groundRing'],
        specs: [S('ocpdRating', 'gnd-ocpd', 'select', 'num'), S('egcMaterial', 'gnd-egc-mat', 'select', 'str'), S('requiredPhaseSize', 'gnd-req', 'select', 'str'),
          S('installedPhaseSize', 'gnd-inst', 'select', 'str'), S('serviceSize', 'gnd-svc', 'select', 'str'), S('serviceMaterial', 'gnd-svc-mat', 'select', 'str'),
          S('electrode', 'gnd-electrode', 'select', 'str')],
        readExtra: function (R, c) { if (c.input.electrode === 'ring') readSpec(GND_RING, R, c); },   // the ring question exists for "Ground ring only" and is never preselected
        planExtra: function (P, list) {
          // For any other electrode the form itself puts the ring question back to "not confirmed" and does not read it.
          if (P.changed.indexOf('groundRing') < 0 || (P.value('groundRing') === undefined && P.value('electrode') !== 'ring')) return;
          writeFor(GND_RING, P.value('groundRing'), P, list, false);
        },
      },
      battery_runtime: {
        requires: ['btRead', 'btCalc', 'btSyncUnit'], calls: ['btSyncUnit', 'btCalc'], controls: ['bt-capacity', 'bt-mode', 'bt-consumption', 'bt-charge', 'bt-usable'],
        read: function (R, c) {
          // Canonical reader: the page's btRead() (raw field text). Numbers are parsed by the battery module's own strict parser.
          var canonical = R.overlay ? null : page('btRead')();
          var raw = function (f) { return R.overlay ? R.raw(BT_IDS[f]) : (canonical && typeof canonical[f] === 'string' ? canonical[f] : null); };
          var ec = env.ec ? env.ec() : null; var parse = ec && ec.batteryRuntime && typeof ec.batteryRuntime.parseDecimal === 'function' ? ec.batteryRuntime.parseDecimal : null;
          var mode = raw('consumptionMode');
          if (typeof mode === 'string' && mode !== '') c.put('consumptionMode', mode, 'form_reader', [BT_IDS.consumptionMode]);
          else c.miss('consumptionMode', 'missing', mode === null ? 'CONTROL_MISSING' : 'EMPTY_CONTROL', [BT_IDS.consumptionMode]);
          BT_NUMERIC.forEach(function (f) {
            var t = raw(f);
            if (t === null) { c.miss(f, 'missing', 'CONTROL_MISSING', [BT_IDS[f]]); return; }
            if (!parse) { c.miss(f, 'missing', 'CANONICAL_PARSER_UNAVAILABLE', [BT_IDS[f]]); return; }
            var r = parse(t);
            if (r && r.ok === true && typeof r.value === 'number') c.put(f, r.value, 'form_reader', [BT_IDS[f]]);
            else c.miss(f, r && r.code === 'REQUIRED' ? 'missing' : 'invalid', r && r.code === 'REQUIRED' ? 'EMPTY_CONTROL' : 'INVALID_CONTROL_VALUE', [BT_IDS[f]]);
          });
          return {};
        },
        plan: function (P) {
          var list = [];
          if (P.changed.indexOf('consumptionMode') >= 0) {
            // The form never re-reads a typed number in a new unit; the same rule applies to a correction.
            if (!own(P.patchSet, 'consumption')) P.refuse('consumptionMode', 'UNIT_CHANGE_REQUIRES_CONSUMPTION', BT_IDS.consumptionMode);
            writeFor(S('consumptionMode', BT_IDS.consumptionMode, 'select', 'str'), P.value('consumptionMode'), P, list, false);
          }
          BT_NUMERIC.forEach(function (f) {
            if (P.changed.indexOf(f) < 0) return;
            var v = P.value(f); var text = v === undefined ? '' : numText(v);
            if (text === null) P.refuse(f, 'UNREPRESENTABLE_NUMBER', BT_IDS[f]); else list.push({ id: BT_IDS[f], value: text, field: f, kind: 'input' });
          });
          return [{ writes: list, call: ['btSyncUnit', 'btCalc'] }];
        },
      },
      pull_box: {
        requires: ['pbv23dEngineRequest'], controls: [],
        read: function (R, c) {
          var state = page('PBV23D');
          if (!state || typeof state !== 'object' || !Array.isArray(state.rows) || !Array.isArray(state.entries) || !Array.isArray(state.connections)) return { requiresForm: 'NO_EDITOR_STATE' };
          if (page('pbv23dTargetMode') !== null && page('pbv23dTargetMode') !== undefined) return { requiresForm: 'EDIT_IN_PROGRESS' };
          var req = page('pbv23dEngineRequest')(state);   // the editor's own canonical engine request
          var counts = { rows: req && Array.isArray(req.rows) ? req.rows.length : 0, entries: req && Array.isArray(req.entries) ? req.entries.length : 0, connections: req && Array.isArray(req.connections) ? req.connections.length : 0 };
          var details = { editorMode: typeof page('pbv23dMode') === 'string' ? page('pbv23dMode') : null, counts: counts };
          // Only a layout that really holds rows, entries and connections is a geometry. Nothing is completed or invented.
          if (!counts.rows || !counts.entries || !counts.connections) { c.miss('geometry', 'missing', 'LAYOUT_INCOMPLETE', [], 'The editor holds ' + counts.rows + ' row(s), ' + counts.entries + ' entr(y/ies) and ' + counts.connections + ' connection(s).'); return { details: details }; }
          c.put('geometry', JSON.parse(JSON.stringify({ rows: req.rows, entries: req.entries, connections: req.connections })), 'form_reader', [], 'Rows, entries and connections exactly as the Pull Box editor sends them to its engine.');
          return { details: details };
        },
      },
      // Imported context only. The two preliminary tools belong to the page's new-design workflow (LC_PRE.mode === 'new_design');
      // in the default existing-conductor workflow they answer needs_form. No preliminary result has to be held, and none is read.
      load_calc: lcAdapter('load_calc', false, false),
      load_calc_preliminary: lcAdapter('load_calc_preliminary', true, false),
      service_sizing: lcAdapter('service_sizing', false, true),
      service_sizing_preliminary: lcAdapter('service_sizing_preliminary', true, true),
    };
    Object.keys(ADAPTERS).forEach(function (id) {
      var a = ADAPTERS[id];
      if (!a.controls) a.controls = a.specs.filter(function (s) { return s.type !== 'const'; }).map(function (s) { return s.id; }).concat(a.extraControls || []);
    });

    /** Read one tool's current form. overlay = dry run of planned writes. Never throws; never returns a value the form does not hold. */
    function captureInternal(reg, toolId, active, overlay) {
      var out = { status: 'needs_form', capture: 'requires_form', reason: null, formInput: null, fields: [], needsInput: [], details: {}, warnings: [], errors: [], rawKey: null };
      var form = FORMS[toolId];
      if (!form.appTool) { out.status = 'needs_input'; out.capture = 'unsupported'; out.reason = form.reason; out.details = { note: form.note }; return out; }
      if (active.toolIds.indexOf(toolId) < 0) { out.reason = 'FORM_NOT_ACTIVE'; return out; }
      var a = ADAPTERS[toolId];
      var absent = a.requires.filter(function (n) { return typeof page(n) !== 'function'; });
      if (absent.length) { out.status = 'not_ready'; out.capture = 'none'; out.reason = 'PAGE_FUNCTION_MISSING'; out.details = { missing: absent }; return out; }
      var R = makeReader(overlay); var c = collector(); var extra;
      try {
        if (a.read) extra = a.read(R, c) || {};
        else { a.specs.forEach(function (s) { readSpec(s, R, c); }); if (a.readExtra) a.readExtra(R, c); extra = {}; }
      } catch (e) { out.status = 'error'; out.capture = 'none'; out.reason = 'FORM_READER_FAULT'; out.errors = [{ code: 'FORM_READER_FAULT', detail: e && typeof e.message === 'string' ? e.message.slice(0, 200) : null }]; return out; }
      if (extra.details) out.details = extra.details;
      if (extra.unavailable) { out.status = 'not_ready'; out.capture = 'none'; out.reason = 'PAGE_READER_MISSING'; out.details.missing = extra.unavailable.slice(); return out; }
      if (extra.requiresForm) { out.reason = extra.requiresForm; return out; }
      if (a.warnings) out.warnings = a.warnings.slice();
      // Every captured value passes the registry's own field validation; a refused value is reported, never coerced or silently dropped.
      var input = {};
      Object.keys(c.input).forEach(function (f) {
        var patch = { set: {}, clear: [] }; patch.set[f] = c.input[f];
        var vp = reg.validatePatch(toolId, patch, { origin: 'current_form' });
        if (vp.ok && own(vp.set, f)) { input[f] = vp.set[f]; return; }
        c.fields.forEach(function (x) { if (x.field === f) { x.state = 'invalid'; x.reason = 'REGISTRY_REJECTED_FORM_VALUE'; x.registryErrors = (vp.errors || []).map(function (e) { return e.code; }); } });
      });
      var made = reg.createDraft(toolId); var imp = made.ok ? reg.importFormInput(made.draft, input) : made;
      if (!imp.ok || !imp.draft) { out.status = 'error'; out.capture = 'none'; out.reason = 'REGISTRY_IMPORT_REFUSED'; out.errors = imp.errors || []; return out; }
      var vd = reg.validateDraft(imp.draft);
      out.fields = c.fields; out.formInput = imp.draft.input; out.draft = imp.draft;
      out.needsInput = (vd.missing || []).map(function (m) { return { field: m.field, reason: m.reason, question: m.question }; });
      var open = c.fields.some(function (x) { return x.state === 'missing' || x.state === 'invalid'; });
      var full = vd.ok && vd.state === 'ready' && !open;
      out.status = full ? 'captured' : 'needs_input'; out.capture = full ? 'full' : 'incomplete'; out.reason = full ? null : 'FORM_INPUT_INCOMPLETE';
      var rawNow = {}; a.controls.forEach(function (id) { rawNow[id] = R.raw(id); });
      out.rawKey = stable({ controls: rawNow, input: out.formInput, state: extra.key || null });
      return out;
    }

    function envelope(ok, status, extra) {
      var out = { ok: ok, status: status, bridgeRevision: BRIDGE_REVISION, generation: generation(), active: detectActive() };
      if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
      return out;
    }
    function notReady(r, toolId) { return { ok: false, status: 'not_ready', bridgeRevision: BRIDGE_REVISION, generation: null, active: null, toolId: toolId === undefined ? null : toolId, formInput: null, reasons: r.reasons }; }
    function resolveTool(reg, id) {
      if (typeof id !== 'string') return 'unknown_tool';
      if (own(NAVIGATION_ONLY, id)) return 'navigation_only';
      return own(FORMS, id) && reg.TOOL_IDS.indexOf(id) >= 0 ? 'calculator' : 'unknown_tool';
    }

    // ── public API ──────────────────────────────────────────────────────────────────────────────────────────────────
    function getState() {
      var r = readiness();
      if (!r.ready) return { ok: false, status: 'not_ready', ready: false, reasons: r.reasons, bridgeRevision: BRIDGE_REVISION, generation: null, active: null, job: null };
      var active = syncActive();
      return { ok: true, status: 'ready', ready: true, reasons: [], bridgeRevision: BRIDGE_REVISION, registryRevision: REGISTRY_REVISION, generation: generation(), lastInvalidation: lastInvalidation, active: active, job: jobContext() };
    }

    function capture(toolId) {
      var r = readiness();
      if (!r.ready) return notReady(r, toolId);
      var active = syncActive();
      var id = toolId === undefined || toolId === null ? active.primaryToolId : toolId;
      if (id === null) return envelope(false, 'needs_form', { toolId: null, capture: 'requires_form', reason: 'NO_ACTIVE_CALCULATOR', formInput: null, fields: [], needsInput: [], job: jobContext() });
      var kind = resolveTool(r.registry, id);
      if (kind === 'unknown_tool') return envelope(false, 'unknown_tool', { toolId: typeof id === 'string' ? id.slice(0, 64) : null, capture: 'none', reason: 'UNKNOWN_TOOL', formInput: null, fields: [], needsInput: [] });
      if (kind === 'navigation_only') return envelope(false, 'navigation_only', { toolId: id, capture: 'none', reason: 'NO_CALCULATION_FOR_THIS_TOOL', executable: false, formInput: null, fields: [], needsInput: [] });
      var cap = captureInternal(r.registry, id, active, null);
      if (cap.rawKey !== null) lastCaptures[id] = { generation: generation(), rawKey: cap.rawKey };
      return envelope(cap.formInput !== null, cap.status, { toolId: id, capture: cap.capture, reason: cap.reason, formInput: cap.formInput, fingerprint: cap.draft ? cap.draft.fingerprint : null,
        fields: cap.fields, needsInput: cap.needsInput, details: cap.details, warnings: cap.warnings, errors: cap.errors,
        form: { appTool: FORMS[id].appTool, mode: FORMS[id].mode, name: FORMS[id].name, workflowMode: FORMS[id].workflowMode || null }, job: jobContext() });
    }

    function restoreControls(a, snapshot) {
      var calls = a.restoreCalls || a.calls || [];
      for (var pass = 0; pass < 2; pass++) {   // twice: the first pass rebuilds dependent option lists, the second restores values that depend on them
        a.controls.forEach(function (id) { var e = el(id); if (e && typeof snapshot[id] === 'string') e.value = snapshot[id]; });
        calls.forEach(function (fn) { try { page(fn)(); } catch (e) { /* reported through the verification below */ } });
      }
    }

    function apply(request) {
      var r = readiness();
      if (!r.ready) return notReady(r, isPlain(request) ? request.toolId : null);
      var reg = r.registry;
      var refuse = function (status, reason, extra) { var x = { toolId: isPlain(request) && typeof request.toolId === 'string' ? request.toolId.slice(0, 64) : null, applied: false, reason: reason, changedFields: [], written: [] }; if (extra) Object.keys(extra).forEach(function (k) { x[k] = extra[k]; }); return envelope(false, status, x); };
      // Strict on purpose: only a plain object of THIS window's realm. An object built in the parent window has the parent's
      // Object.prototype and is refused like any other non-plain object; the caller clones the whole request through this
      // window's JSON instead (docs section 6). Nothing is read from a refused request.
      if (!isPlain(request)) return refuse('invalid_request', 'REQUEST_SHAPE', { detail: request !== null && typeof request === 'object' && !Array.isArray(request) ? 'NOT_A_PLAIN_OBJECT_OF_THIS_WINDOW' : 'NOT_AN_OBJECT' });
      if (Object.keys(request).some(function (k) { return ['toolId', 'expectedGeneration', 'patch'].indexOf(k) < 0; })) return refuse('invalid_request', 'REQUEST_SHAPE', { detail: 'UNKNOWN_MEMBER' });
      var toolId = request.toolId; var kind = resolveTool(reg, toolId);
      if (kind !== 'calculator') return refuse(kind === 'navigation_only' ? 'navigation_only' : 'unknown_tool', kind === 'navigation_only' ? 'NO_CALCULATION_FOR_THIS_TOOL' : 'UNKNOWN_TOOL');
      // 1. Stale-response guard, before anything is read for writing.
      if (typeof request.expectedGeneration !== 'string' || request.expectedGeneration === '') return refuse('stale', 'GENERATION_REQUIRED');
      var active = syncActive();
      if (request.expectedGeneration !== generation()) return refuse('stale', 'GENERATION_CHANGED', { lastInvalidation: lastInvalidation });
      if (active.toolIds.indexOf(toolId) < 0) return refuse('stale', 'TOOL_NOT_ACTIVE');
      var seen = lastCaptures[toolId];
      if (!seen || seen.generation !== generation()) return refuse('stale', 'CAPTURE_REQUIRED');
      // 2. The whole patch is validated by the registry as a conversation-origin change before any field is considered.
      var vp = reg.validatePatch(toolId, request.patch, { origin: 'conversation' });
      if (!vp.ok) return refuse('invalid_patch', 'REGISTRY_REJECTED_PATCH', { errors: vp.errors });
      var before = captureInternal(reg, toolId, active, null);
      if (before.formInput === null || !before.draft) return refuse(before.status, before.reason, { errors: before.errors });
      if (before.rawKey !== seen.rawKey) { bump('form_changed_without_event'); return refuse('stale', 'FORM_CHANGED_SINCE_CAPTURE', { lastInvalidation: lastInvalidation }); }
      var merged = reg.mergeDraft(before.draft, request.patch, { origin: 'conversation' });
      if (!merged.ok || !merged.draft) return refuse('invalid_patch', 'REGISTRY_REJECTED_PATCH', { errors: merged.errors });
      if (!merged.changedFields.length) return envelope(true, 'no_change', { toolId: toolId, applied: false, reason: 'PATCH_MATCHES_CURRENT_FORM', changedFields: [], written: [], formInput: before.formInput });
      // 3. Plan every control write; one unrepresentable field refuses the whole patch.
      var a = ADAPTERS[toolId]; var refusals = [];
      var target = merged.draft.input;
      var P = { changed: merged.changedFields.slice(), merged: target, current: before.formInput, patchSet: vp.set,
        value: function (f) { return own(target, f) ? target[f] : undefined; },
        refuse: function (field, reason, controlId, allowed) { refusals.push({ field: field, reason: reason, controlId: controlId || null, allowed: allowed || null }); } };
      var steps = [];
      if (!a.specs && !a.plan) refusals.push({ field: null, reason: 'FORM_IS_NOT_PATCHABLE', controlId: null, allowed: null });
      else if (a.plan) steps = a.plan(P);
      else { var list = []; genericWrites(a, P, list, null); if (a.planExtra) a.planExtra(P, list); steps = [{ writes: list, call: a.calls }]; }
      if (refusals.length) return refuse('unrepresentable', 'FORM_CANNOT_REPRESENT_PATCH', { fields: refusals });
      // 4. Dry run: with the planned texts in place the form must read back exactly the merged input — no other field may move.
      var overlay = {}; steps.forEach(function (s) { s.writes.forEach(function (w) { overlay[w.id] = w.value; }); });
      var dry = captureInternal(reg, toolId, active, overlay);
      var differing = function (got) {
        var keys = Object.keys(target).concat(Object.keys(got || {})).filter(function (k, i, all) { return all.indexOf(k) === i; });
        return keys.filter(function (k) { return stable(own(target, k) ? target[k] : undefined) !== stable(got && own(got, k) ? got[k] : undefined); });
      };
      var diff = dry.formInput === null ? Object.keys(target) : differing(dry.formInput);
      if (diff.length) {
        return refuse('unrepresentable', 'FORM_CANNOT_REPRESENT_PATCH', { fields: diff.map(function (f) {
          return { field: f, reason: P.changed.indexOf(f) >= 0 ? (dry.formInput && own(dry.formInput, f) ? 'FORM_FIXES_THIS_VALUE' : 'FORM_CANNOT_HOLD_VALUE') : 'PATCH_WOULD_CHANGE_ANOTHER_FIELD', controlId: null, allowed: null, formValue: dry.formInput && own(dry.formInput, f) ? dry.formInput[f] : null };
        }) });
      }
      // 5. Guard again immediately before the first write.
      if (request.expectedGeneration !== generation() || stable(detectActive()) !== activeKey) return refuse('stale', 'GENERATION_CHANGED');
      var snapshot = {}; a.controls.forEach(function (id) { snapshot[id] = makeReader(null).real(id); });
      var written = []; var fault = null;
      try {
        for (var i = 0; i < steps.length && !fault; i++) {
          for (var j = 0; j < steps[i].writes.length && !fault; j++) {
            var w = steps[i].writes[j]; var e = el(w.id); var text = w.value;
            if (!e) { fault = { field: w.field, reason: 'CONTROL_MISSING', controlId: w.id }; break; }
            if (w.deferred) { var m = matchOption(e, w.type, w.value, w.target); if (m.error) { fault = { field: w.field, reason: m.error, controlId: w.id }; break; } text = m.value; }
            var from = String(e.value === null || e.value === undefined ? '' : e.value);
            e.value = text;
            if (String(e.value) !== text) { fault = { field: w.field, reason: 'CONTROL_REJECTED_VALUE', controlId: w.id }; break; }
            if (from !== text) written.push({ controlId: w.id, field: w.field, from: from, to: text });
          }
          if (!fault) steps[i].call.forEach(function (fn) { page(fn)(); });   // the form's own calculator / renderer
        }
        if (!fault && a.after) a.after(P);
      } catch (err) { fault = { field: null, reason: 'FORM_FUNCTION_FAULT', controlId: null, detail: err && typeof err.message === 'string' ? err.message.slice(0, 200) : null }; }
      // 6. Verify against the real form; anything else is rolled back.
      var after = fault ? null : captureInternal(reg, toolId, detectActive(), null);
      if (!fault && (after.formInput === null || differing(after.formInput).length)) fault = { field: null, reason: 'FORM_DID_NOT_HOLD_PATCH', controlId: null, fields: after.formInput === null ? [] : differing(after.formInput) };
      if (fault) {
        restoreControls(a, snapshot);
        var back = captureInternal(reg, toolId, detectActive(), null);
        var restored = back.formInput !== null && stable(back.formInput) === stable(before.formInput);
        bump('apply_rolled_back');
        return refuse(restored ? 'unrepresentable' : 'error', restored ? 'FORM_CANNOT_REPRESENT_PATCH' : 'ROLLBACK_NOT_VERIFIED', { fields: [fault], rolledBack: true, formRestored: restored });
      }
      var previous = generation();
      bump('applied_patch');
      activeKey = stable(detectActive());
      lastCaptures[toolId] = { generation: generation(), rawKey: after.rawKey };
      return envelope(true, 'applied', { toolId: toolId, applied: true, reason: null, changedFields: merged.changedFields.slice(), written: written, rendered: steps.reduce(function (all, s) { return all.concat(s.call); }, []),
        previousGeneration: previous, formInput: after.formInput, fingerprint: after.draft ? after.draft.fingerprint : null, capture: after.capture, captureStatus: after.status, needsInput: after.needsInput, fields: after.fields, warnings: after.warnings });
    }

    function converterTab(mode) {
      if (mode === 'battery') return el('cvTabBattery');
      var tabs = typeof doc.querySelectorAll === 'function' ? doc.querySelectorAll('#cvToolTabs .conduit-tab') : [];
      for (var i = 0; i < tabs.length; i++) {
        var h = tabs[i] && typeof tabs[i].getAttribute === 'function' ? tabs[i].getAttribute('onclick') : null;
        if (typeof h === 'string' && h.indexOf("cvTool('" + mode + "'") >= 0) return tabs[i];
      }
      return null;
    }
    function navigate(toolId) {
      var r = readiness();
      if (!r.ready) return notReady(r, toolId);
      var kind = resolveTool(r.registry, toolId);
      var reply = function (ok, status, reason, extra) {
        var x = { toolId: typeof toolId === 'string' ? toolId.slice(0, 64) : null, reason: reason, navigationOnly: kind === 'navigation_only', executable: kind === 'calculator', calculated: false };
        if (extra) Object.keys(extra).forEach(function (k) { x[k] = extra[k]; });
        return envelope(ok, status, x);
      };
      if (kind === 'unknown_tool') return reply(false, 'unknown_tool', 'UNKNOWN_TOOL');
      var entry = kind === 'navigation_only' ? NAVIGATION_ONLY[toolId] : FORMS[toolId];
      // workflowMode: the page mode a tool's capture additionally needs. Navigation opens the form only; that mode stays the user's choice.
      var form = { appTool: entry.appTool, mode: entry.mode || null, name: entry.name, workflowMode: entry.workflowMode || null };
      if (!entry.appTool) return reply(false, 'unsupported', entry.reason, { form: form, note: entry.note });
      var before = syncActive();
      if (isActiveFor(before, toolId)) return reply(true, 'already_active', null, { form: form, effects: [] });
      if (hostDraft() === true) return reply(false, 'blocked', 'UNSAVED_JOB_DRAFT', { form: form });
      var openTool = page('openTool'); var cvTool = null; var tab = null;
      if (typeof openTool !== 'function') return reply(false, 'unsupported', 'ENTRY_FUNCTION_MISSING', { form: form });
      if (entry.appTool === 'converter') {
        cvTool = page('cvTool'); tab = converterTab(entry.mode);
        if (typeof cvTool !== 'function' || !tab) return reply(false, 'unsupported', 'ENTRY_FUNCTION_MISSING', { form: form });
      }
      var opened = false; var thrown = null;
      try { opened = openTool(entry.appTool) === true; if (opened && cvTool) cvTool(entry.mode, tab); } catch (e) { thrown = e && typeof e.message === 'string' ? e.message.slice(0, 200) : 'error'; }
      bump('navigate');
      var after = detectActive(); activeKey = stable(after);
      if (thrown !== null) return reply(false, 'failed', 'ENTRY_FUNCTION_FAULT', { form: form, detail: thrown });
      if (!opened) return reply(false, 'unsupported', 'APP_TOOL_NOT_IN_CATALOGUE', { form: form });
      if (!isActiveFor(after, toolId)) return reply(false, 'failed', 'TOOL_NOT_ACTIVE_AFTER_NAVIGATION', { form: form });
      return reply(true, 'navigated', null, { form: form, effects: entry.effects.slice() });
    }

    function invalidate(reason) {
      bump('explicit:' + (typeof reason === 'string' ? reason : 'unspecified'));
      return { ok: true, status: 'invalidated', bridgeRevision: BRIDGE_REVISION, generation: generation() };
    }

    return Object.freeze({ revision: BRIDGE_REVISION, getState: getState, capture: capture, apply: apply, navigate: navigate, invalidate: invalidate, describe: describe });
  }

  /** Static mapping, independent of any document: which form (if any) stands behind each tool id. */
  function describe() {
    var out = { bridgeRevision: BRIDGE_REVISION, registryRevision: REGISTRY_REVISION, tools: [] };
    Object.keys(FORMS).forEach(function (id) {
      var f = FORMS[id]; var context = LOADCALC_IDS.indexOf(id) >= 0;
      out.tools.push({ toolId: id, kind: 'calculator', appTool: f.appTool, mode: f.mode || null, workflowMode: f.workflowMode || null, formName: f.name, navigable: f.appTool !== null,
        capture: f.appTool === null ? 'unsupported' : 'form',
        apply: f.appTool === null || context || id === 'pull_box' ? 'refused' : 'typed_patch', reason: f.reason || null, navigationEffects: (f.effects || []).slice() });
    });
    Object.keys(NAVIGATION_ONLY).forEach(function (id) {
      var n = NAVIGATION_ONLY[id];
      out.tools.push({ toolId: id, kind: 'navigation_only', appTool: n.appTool, mode: n.mode || null, workflowMode: null, formName: n.name, navigable: true, capture: 'none', apply: 'refused', reason: 'NO_CALCULATION_FOR_THIS_TOOL', navigationEffects: [] });
    });
    return out;
  }

  /** Real-iframe environment. Page globals are looked up by allowlisted name only. */
  function browserEnv(win) {
    var stamp = String(typeof win.Date === 'function' ? win.Date.now().toString(36) : '0');
    var salt = '';
    try { var a = new win.Uint32Array(1); win.crypto.getRandomValues(a); salt = a[0].toString(36); } catch (e) { salt = String(Math.floor(Math.random() * 1e9).toString(36)); }
    return {
      document: win.document,
      registry: function () { return win.EC && win.EC.conversationTools ? win.EC.conversationTools : null; },
      ec: function () { return win.EC || null; },
      page: function (name) { return PAGE_NAMES.indexOf(name) >= 0 ? win[name] : undefined; },
      host: function () { return win.ecHostBridge || null; },
      bootId: stamp + salt,
    };
  }
  /** Installs window.ECAssistantBridge once. Readiness (DOM, registry, page readers) is re-checked on every call. */
  function autoInstall(win) {
    if (win.ECAssistantBridge) return win.ECAssistantBridge;
    var bridge = createBridge(browserEnv(win));
    Object.defineProperty(win, 'ECAssistantBridge', { value: bridge, writable: false, configurable: false, enumerable: true });
    return bridge;
  }

  return { BRIDGE_REVISION: BRIDGE_REVISION, REGISTRY_REVISION: REGISTRY_REVISION, PAGE_NAMES: PAGE_NAMES.slice(), FORMS: FORMS, NAVIGATION_ONLY: NAVIGATION_ONLY,
    createBridge: createBridge, describe: describe, browserEnv: browserEnv, autoInstall: autoInstall };
});
