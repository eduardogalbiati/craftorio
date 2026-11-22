// Service area: the Monitor (#634, spec R12), production errors become intents. Each project's
// error sources (a log file, a log URL, Sentry) are polled (packages/engine/domains/monitor/connectors.js),
// their events deduplicated by id across polls and grouped with no model (grouping.js), the state kept
// in <workspace>/monitor/<project>.json (monitor-store.js). A group's diagnosis is a rule-based
// intent.md filed as an `intent` card in the project's Discovery Inbox (domains/discovery/intents.js,
// from workflow 'monitor'); "Propose fix" starts the bundled `fix` workflow with approve_before_merge,
// so the run stops at its human gate (validate) before anything lands. Automation: diagnose and fix
// are ask | on | off; 'on' diagnoses new groups at poll time, at most dailyCap a day.
// Tokens (Sentry) live in the system keychain: `host.secrets` ({ get(key), set(key, value) }, the
// desktop app's safeStorage file, apps/desktop/host/secrets.js); without it (tests, the bin) in this
// process's memory only. A token is never written to a workspace file nor returned by a channel.
// The sources are polled every POLL_MS once the Monitor was used in this session (an unref'd timer,
// stopped by shutdown through stopMonitorWatch). Channels: packages/engine/fronts/ai/channels/monitor.js.
// The webhook (after the security review #466–#470): monitor:webhook turns it on with a new random
// key (in the keychain, shown once in its URL) or off; the engine server's POST /hooks/monitor/<project>
// ?key=… (packages/engine/server/index.js, outside the token gate) calls monitorWebhookIngest, which
// checks the key in constant time and ingests the pushed events like a poll (source 'webhook').
// #650: monitor:diagnose with an `item` (a work item of the project's docs/work) also records the error
// in that item's maintain.md and opens a new intent item linking back (ctx.recordDocIncident); the
// group's fix run, once it succeeds, writes the post-mortem there (ctx.writeDocPostMortem).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const connectors = require('@craftorio/engine/domains/monitor/connectors');
const grouping = require('@craftorio/engine/domains/monitor/grouping');
const store = require('@craftorio/engine/domains/monitor/monitor-store');
const intents = require('@craftorio/engine/domains/discovery/intents');
const { AUTOMATION_MODES } = require('@craftorio/engine/domains/discovery/discovery');
const projects = require('@craftorio/engine/domains/project/projects');
const simulation = require('@craftorio/engine/engine/simulation');
const TimeZone = require('@craftorio/engine/domains/analytics/time-zone');

const FIX_WORKFLOW = 'fix.yaml';
const POLL_MS = 5 * 60 * 1000;
// each source type's own fields (the token is never one: it goes to the keychain)
const SOURCE_FIELDS = { 'log-file': ['path'], 'log-url': ['url'], sentry: ['org', 'project'] };
const SOURCE_TYPES = Object.keys(SOURCE_FIELDS);
// the pushed events' source id (never a saved source's: those are src-<hex>)
const WEBHOOK_SOURCE = 'webhook';
const hookPath = (projectId, key) => `/hooks/monitor/${encodeURIComponent(projectId)}?key=${key}`;

module.exports = (ctx) => {
  const dir = () => ctx.ws.monitor || path.join(ctx.ws.root, 'monitor');
  const plain = (projectId) => path.basename(String(projectId));
  const read = (projectId) => store.readState(dir(), plain(projectId));
  const write = (projectId, state) => store.writeState(dir(), plain(projectId), state);
  // every read → write of a project's state runs in turn (a poll awaits the network between them:
  // a push or a diagnosis meanwhile would be overwritten)
  const queues = new Map();
  function serial(projectId, work) {
    const key = plain(projectId);
    const next = (queues.get(key) || Promise.resolve()).then(() => work());
    queues.set(key, next.catch(() => {}));
    return next;
  }

  // the keychain: the host's, or this process's memory (never a file)
  const memory = new Map();
  const secrets = () => ctx.host?.secrets || {
    get: async (key) => memory.get(key) ?? null,
    set: async (key, value) => { if (value) memory.set(key, value); else memory.delete(key); },
  };
  const tokenKey = (projectId, sourceId) => `monitor:${plain(projectId)}:${sourceId}`;
  const webhookKey = (projectId) => tokenKey(projectId, WEBHOOK_SOURCE);
  const sameKey = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a || '')).digest(), crypto.createHash('sha256').update(String(b || '')).digest());

  let timer = null;
  function watchMonitor() {
    if (timer) return;
    timer = setInterval(() => { pollAll().catch((e) => console.error('monitor poll:', e.message)); }, POLL_MS);
    timer.unref?.();
  }
  function stopMonitorWatch() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  async function pollAll() {
    let files = [];
    try { files = fs.readdirSync(dir()).filter((f) => f.endsWith('.json')); } catch { return; }
    for (const f of files) {
      const projectId = f.slice(0, -'.json'.length);
      if (read(projectId).sources.length) await monitorPoll({ projectId });
    }
  }

  // the groups of the events read so far, each with its state (new, intent, fix-run)
  function groupsOf(state) {
    const events = Object.values(state.events);
    // each event's fingerprint once: a group's sparkline reads only its own events
    const byFingerprint = new Map();
    for (const ev of events) {
      const fp = grouping.fingerprint(ev);
      if (!byFingerprint.has(fp)) byFingerprint.set(fp, []);
      byFingerprint.get(fp).push(ev);
    }
    return grouping.groupErrors(events).map((g) => {
      const s = state.groups[g.fingerprint] || {};
      // the sparkline of the last hour, ending at the group's last event (the screen's "· 1h")
      const spark = grouping.sparkOf(byFingerprint.get(g.fingerprint) || [], g.fingerprint, { now: Date.parse(g.lastSeen) || Date.now() });
      return { ...g, spark, state: s.state || 'new', cardId: s.cardId || null, runId: s.runId || null, incident: s.incident || null };
    });
  }

  async function monitorState({ projectId }) {
    watchMonitor();
    const state = read(projectId);
    const sources = [];
    for (const s of state.sources) {
      const hasToken = s.type === 'sentry' ? !!(await secrets().get(tokenKey(projectId, s.id))) : false;
      sources.push({ id: s.id, type: s.type, label: s.label, hasToken, polledAt: s.polledAt || null, error: s.error || null, every: POLL_MS / 60000 });
    }
    const webhook = { enabled: !!(await secrets().get(webhookKey(projectId))) };
    return { groups: groupsOf(state), sources, automation: { ...state.automation }, webhook };
  }

  const defaultLabel = (s) => (s.type === 'sentry' ? 'Sentry' : s.type === 'log-file' ? path.basename(String(s.path || 'log')) : (() => { try { return new URL(s.url).host; } catch { return 'log URL'; } })());

  async function monitorSaveSource({ projectId, source }) {
    projects.readProject(ctx.ws.projects, plain(projectId));
    const { token, ...input } = source || {};
    if (!SOURCE_TYPES.includes(input.type)) return { ok: false, error: `A source is ${SOURCE_TYPES.join(', ')}: ${input.type}` };
    if (input.type === 'log-file' && !input.path) return { ok: false, error: 'A log file source needs its path.' };
    if (input.type === 'log-url' && !/^https?:\/\//i.test(String(input.url || ''))) return { ok: false, error: 'A log URL source needs an http(s) URL.' };
    if (input.type === 'sentry' && !(input.org && input.project)) return { ok: false, error: 'A Sentry source needs its organisation and project.' };
    // in the project's queue: a poll waiting for the network would otherwise write over it
    const saved = await serial(projectId, () => {
      const state = read(projectId);
      const id = input.id && state.sources.some((s) => s.id === input.id) ? input.id : `src-${crypto.randomBytes(4).toString('hex')}`;
      const next = { id, type: input.type, label: String(input.label || defaultLabel(input)).slice(0, 80), ...Object.fromEntries(SOURCE_FIELDS[input.type].map((k) => [k, String(input[k])])) };
      state.sources = [...state.sources.filter((s) => s.id !== id), next];
      write(projectId, state);
      return next;
    });
    const { id } = saved;
    if (token) await secrets().set(tokenKey(projectId, id), String(token));
    watchMonitor();
    return { ok: true, source: saved };
  }

  // events into the state (`add` changes it), deduplicated by source and id; the new groups are
  // diagnosed when the automation says 'on'
  async function ingest(projectId, add) {
    const { fresh, auto } = await serial(projectId, async () => {
      const state = read(projectId);
      const before = new Set(groupsOf(state).map((g) => g.fingerprint));
      await add(state);
      write(projectId, state);
      return { fresh: groupsOf(state).filter((g) => !before.has(g.fingerprint) && g.state === 'new'), auto: state.automation.diagnose === 'on' };
    });
    if (auto) await autoDiagnose(projectId, fresh);
  }

  async function monitorPoll({ projectId }) {
    const errors = [];
    await ingest(projectId, async (state) => {
      for (const s of state.sources) {
        const res = await connectors.pollSource(s, { getToken: (id) => secrets().get(tokenKey(projectId, id)), since: s.cursor || null });
        s.polledAt = new Date().toISOString();
        if (!res.ok) { s.error = res.error; errors.push(`${s.label}: ${res.error}`); continue; }
        s.error = null;
        s.cursor = res.cursor || s.cursor || null;
        for (const ev of res.events) if (ev.id != null) state.events[`${s.id}:${ev.id}`] = ev;
      }
    });
    return { ok: true, groups: groupsOf(read(projectId)), errors };
  }

  // { projectId, enable } → on: a new key (the old one stops working), its URL path shown once; off: no key
  async function monitorWebhook({ projectId, enable }) {
    projects.readProject(ctx.ws.projects, plain(projectId));
    if (!enable) {
      await secrets().set(webhookKey(projectId), '');
      return { ok: true, enabled: false, path: null };
    }
    const key = crypto.randomBytes(24).toString('hex');
    await secrets().set(webhookKey(projectId), key);
    return { ok: true, enabled: true, path: hookPath(plain(projectId), key) };
  }

  // the engine server's POST /hooks/monitor/<project>?key=… (never a channel): { ok, received } or
  // { ok: false, status, error }; an unknown project and a wrong key answer the same
  async function monitorWebhookIngest({ projectId, key, payload }) {
    const expected = await secrets().get(webhookKey(projectId)).catch(() => null);
    if (!expected || !key || !sameKey(key, expected)) return { ok: false, status: 401, error: 'Unknown webhook or wrong key.' };
    const events = connectors.webhookEvents(payload, WEBHOOK_SOURCE).filter((ev) => ev.id != null);
    if (!events.length) return { ok: false, status: 400, error: 'No error event in the body: send an event, a list of events or a Sentry webhook.' };
    await ingest(projectId, (state) => { for (const ev of events) state.events[`${WEBHOOK_SOURCE}:${ev.id}`] = ev; });
    return { ok: true, received: events.length };
  }

  // 'on': the new groups are diagnosed, at most dailyCap a day (and a fix run proposed when fix is 'on')
  async function autoDiagnose(projectId, fresh) {
    for (const g of fresh) {
      const state = read(projectId);
      const day = TimeZone.dayKey(new Date());
      const count = state.diagnosed.day === day ? state.diagnosed.count : 0;
      if (count >= state.automation.dailyCap) return;
      const res = await monitorDiagnose({ projectId, fingerprint: g.fingerprint });
      if (!res.ok || res.existing) continue;
      const fix = await serial(projectId, () => {
        const after = read(projectId);
        after.diagnosed = { day, count: (after.diagnosed.day === day ? after.diagnosed.count : 0) + 1 };
        write(projectId, after);
        return after.automation.fix;
      });
      if (fix === 'on') await monitorProposeFix({ projectId, fingerprint: g.fingerprint }).catch((e) => console.error('monitor fix:', e.message));
    }
  }

  // the diagnosis (intent.md): what failed, where, how often, and what to do; no model
  function diagnosisText(g, state) {
    const sources = [...new Set(Object.values(state.events).filter((e) => grouping.fingerprint(e) === g.fingerprint).map((e) => e.source))]
      .map((id) => state.sources.find((s) => s.id === id)?.label || id);
    return [
      `# ${g.title}`,
      '',
      'A production error grouped by the Monitor.',
      '',
      `- Status: ${g.status}`,
      `- Message: ${g.message}`,
      `- Where: ${g.where || 'unknown (no file and line in the events)'}`,
      `- Occurrences: ${g.count}`,
      `- First seen: ${g.firstSeen || 'unknown'}`,
      `- Last seen: ${g.lastSeen || 'unknown'}`,
      `- Sources: ${sources.join(', ') || 'unknown'}`,
      '',
      '## Diagnosis',
      '',
      `${g.title} fails with "${g.message}"${g.where ? ` at ${g.where}` : ''}. Reproduce it with a request like the failing ones, find the root cause and fix it with a regression test that fails before the fix.`,
      '',
    ].join('\n');
  }

  const findGroup = (state, fingerprint) => groupsOf(state).find((g) => g.fingerprint === fingerprint) || null;

  // #650 (spec R16): an error tied to a work item of the project's repository is also an incident of
  // that item: a row in its docs/work/<item>/maintain.md and a new intent item linking back, written by
  // the Documents service (the plan front's area, ctx.recordDocIncident). Once per group and item.
  function recordIncident(projectId, fingerprint, g, state, item) {
    if (!item || g.incident?.item === item) return null;
    if (!ctx.recordDocIncident) return { ok: false, error: 'The Documents service is not installed: the incident was not recorded.' };
    let res;
    try {
      res = ctx.recordDocIncident?.({
        projectId: plain(projectId),
        item,
        date: String(g.lastSeen || new Date().toISOString()).slice(0, 10),
        source: 'monitor',
        title: g.title,
        error: `${g.status} ${g.title}: ${g.message}`,
        diagnosis: `Diagnosed by the Monitor: ${g.count} errors${g.where ? ` at ${g.where}` : ''}, last seen ${g.lastSeen || 'unknown'}.`,
      });
    } catch (e) {
      return { ok: false, error: `The incident was not recorded in ${item}'s maintain.md: ${e.message}` };
    }
    state.groups[fingerprint] = { ...(state.groups[fingerprint] || {}), incident: { item, intent: res.intent.item } };
    return { intent: res.intent };
  }

  // #650: the fix run of a group tied to an item ends: when it succeeded, the item's maintain.md gets its
  // post-mortem (what happened, the impact, the cause, the fix), under Post-mortems (ctx.writeDocPostMortem)
  function writePostMortem(projectId, g, runId, ev) {
    if (!g.incident || ev?.status !== 'success' || !ctx.writeDocPostMortem) return;
    const text = [
      `- What happened: ${g.status} ${g.title}: ${g.message}`,
      `- Impact: ${g.count} errors${g.where ? ` at ${g.where}` : ''}, last seen ${g.lastSeen || 'unknown'}.`,
      `- Cause and fix: see the new intent ${g.incident.intent} and the fix run ${runId}, approved before it landed.`,
    ].join('\n');
    try {
      ctx.writeDocPostMortem?.({ projectId: plain(projectId), item: g.incident.item, intent: g.incident.intent, text });
    } catch (e) { console.error('monitor post-mortem:', e.message); }
  }

  function monitorDiagnose({ projectId, fingerprint, item }) {
    return serial(projectId, () => {
      const state = read(projectId);
      const g = findGroup(state, fingerprint);
      if (!g) return { ok: false, error: `No error group ${fingerprint}.` };
      let cardId = g.cardId;
      if (!cardId) {
        const card = intents.createIntent(ctx.ws.discovery, plain(projectId), { workflow: 'monitor', finding: fingerprint, title: g.title, text: diagnosisText(g, state), author: 'monitor' });
        if (!card) return { ok: false, error: 'The intent card could not be written.' };
        cardId = card.id;
        state.groups[fingerprint] = { ...(state.groups[fingerprint] || {}), state: 'intent', cardId };
        write(projectId, state);
      }
      const incident = recordIncident(projectId, fingerprint, g, state, item);
      if (incident?.ok === false) return incident;
      if (incident) write(projectId, state);
      return { ok: true, cardId, ...(g.cardId && !incident ? { existing: true } : {}), ...(incident ? { intent: incident.intent } : {}) };
    });
  }

  async function monitorProposeFix({ projectId, fingerprint }) {
    let g = findGroup(read(projectId), fingerprint);
    if (!g) return { ok: false, error: `No error group ${fingerprint}.` };
    if (g.state === 'fix-run' && g.runId && ctx.liveRun?.(g.runId)) return { ok: true, runId: g.runId, existing: true };
    if (!g.cardId) {
      const d = await monitorDiagnose({ projectId, fingerprint });
      if (!d.ok) return d;
    }
    const state = read(projectId);
    g = findGroup(state, fingerprint);
    const project = projects.readProject(ctx.ws.projects, plain(projectId));
    if (!project?.folder) return { ok: false, error: 'The project has no folder to fix.' };
    const inputs = { task: diagnosisText(g, state), repo_path: project.folder, mode: 'local', approve_before_merge: true };
    const notices = [{ level: 'info', message: `Started by the Monitor: a fix for "${g.title}" (${g.count} errors). It waits for your approval before it lands.` }];
    const fixed = g;
    let runId = null;
    const onFinished = (ev) => writePostMortem(projectId, fixed, runId || ev?.run_id, ev);
    const started = await ctx.startWorkflowRun({ file: FIX_WORKFLOW, inputs, mock: simulation.simulationOnly(), projectId: project.id, notices, onFinished });
    runId = started.runId;
    await serial(projectId, () => {
      const after = read(projectId);
      after.groups[fingerprint] = { ...(after.groups[fingerprint] || {}), state: 'fix-run', runId: started.runId };
      write(projectId, after);
    });
    return { ok: true, runId: started.runId };
  }

  async function monitorSetAutomation({ projectId, diagnose, fix, dailyCap }) {
    if (!AUTOMATION_MODES.includes(diagnose) || !AUTOMATION_MODES.includes(fix)) return { ok: false, error: `A mode is ${AUTOMATION_MODES.join(', ')}.` };
    if (!Number.isInteger(dailyCap) || dailyCap < 0) return { ok: false, error: 'The daily cap is a whole number, 0 or more.' };
    return serial(projectId, () => {
      const state = read(projectId);
      state.automation = { diagnose, fix, dailyCap };
      write(projectId, state);
      return { ok: true, automation: { ...state.automation } };
    });
  }

  return {
    monitorDiagnose,
    monitorPoll,
    monitorProposeFix,
    monitorSaveSource,
    monitorSetAutomation,
    monitorState,
    monitorWebhook,
    monitorWebhookIngest,
    stopMonitorWatch,
  };
};
