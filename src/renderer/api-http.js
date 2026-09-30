// window.api for the browser: the same methods as src/preload.js, over the engine server's HTTP +
// WebSocket API (src/server). In the desktop app the preload has already defined window.api and
// this file does nothing. A test keeps both method lists identical.
(() => {
  if (window.api) return;

  async function call(channel, arg) {
    const res = await fetch(`/api/${channel}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ arg: arg === undefined ? null : arg }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `The server answered HTTP ${res.status}.`);
    return body.result;
  }

  // Pushed channels (run:event, term:data, term:exit, auth:changed) and fire-and-forget messages.
  // Reconnects when the connection drops (server restart, network).
  const listeners = new Map();
  const outbox = [];
  let socket = null;
  function connect() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    socket.onopen = () => { while (outbox.length && socket.readyState === WebSocket.OPEN) socket.send(outbox.shift()); };
    socket.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      for (const cb of listeners.get(msg.channel) || []) cb(msg.payload);
    };
    socket.onclose = () => setTimeout(connect, 1500);
  }
  connect();
  const subscribe = (channel) => (cb) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(cb);
    return () => listeners.get(channel).delete(cb);
  };
  const notify = (channel, arg) => {
    const msg = JSON.stringify({ channel, arg });
    if (socket?.readyState === WebSocket.OPEN) socket.send(msg); else outbox.push(msg);
  };
  // Actions on the machine running the app (native dialogs, file explorer, console windows)
  const desktopOnly = (what) => async () => { throw new Error(`${what} is only available in the desktop app.`); };

  window.api = {
    listWorkflows: () => call('workflows:list'),
    restoreWorkflow: (file) => call('workflows:restore', file),
    loadBuilderWorkflow: (file) => call('builder:load', file),
    saveBuilderWorkflow: (file, spec) => call('builder:save', { file, spec }),
    cloneWorkflow: (file) => call('builder:clone', file),
    checkEnv: () => call('env:check'),
    envDetails: () => call('env:details'),
    appInfo: () => call('app:info'),
    openPath: desktopOnly('Opening folders'),
    getSettings: () => call('settings:get'),
    setSettings: (patch) => call('settings:set', patch),
    listProjects: () => call('projects:list'),
    createProject: (data) => call('projects:create', data),
    updateProject: (id, patch) => call('projects:update', { id, patch }),
    removeProject: (id) => call('projects:remove', id),
    getBacklog: (projectId) => call('backlog:get', { projectId }),
    syncBacklog: (projectId, platform) => call('backlog:sync', { projectId, platform }),
    assignWorkflow: (projectId, numbers, workflow, inputs, mock, group) => call('backlog:assign', { projectId, numbers, workflow, inputs, mock, group }),
    unqueueIssue: (projectId, number, cancelGroup) => call('backlog:unqueue', { projectId, number, cancelGroup }),
    pauseQueue: (projectId, paused) => call('backlog:pause', { projectId, paused }),
    listSkills: () => call('skills:list'),
    createSkill: (data) => call('skills:create', data),
    saveSkill: (id, data) => call('skills:save', { id, data }),
    removeSkill: (id) => call('skills:remove', id),
    listAgents: () => call('agents:list'),
    createAgent: (data) => call('agents:create', data),
    saveAgent: (id, data) => call('agents:save', { id, data }),
    removeAgent: (id) => call('agents:remove', id),
    // no native folder picker in the browser: the path is typed (a folder on the server)
    pickFolder: async () => window.prompt('Folder path on the server:')?.trim() || null,
    getWorkspace: () => call('workspace:get'),
    changeWorkspace: desktopOnly('Changing the workspace'),
    openWorkspace: desktopOnly('Opening the workspace folder'),
    startRun: (payload) => call('run:start', payload),
    stopRun: (runId) => call('run:stop', { runId }),
    listActiveRuns: () => call('runs:active'),
    resolveApproval: (id, answer, feedback, runId) => call('approval:resolve', { id, answer, feedback, runId }),
    openRunDir: desktopOnly('Opening the log folder'),
    getUsage: (scope) => call('usage:get', { scope }),
    openSessionTerminal: desktopOnly('External terminal windows'),
    listProjectRuns: (id) => call('projects:runs', { id }),
    listRuns: () => call('runs:list'),
    runEvents: (runId, opts = {}) => call('runs:events', { runId, activity: !!opts.activity }),
    setBudget: (provider, budget, scope) => call('usage:setBudget', { provider, budget, scope }),
    setPrice: (model, price, scope) => call('usage:setPrice', { model, price, scope }),
    getActionsUsage: (force) => call('usage:actions', { force }),
    askSupervisor: (runId, question) => call('supervisor:analyze', { runId, question }),
    resumeRun: (runId, step, instruction) => call('supervisor:resume', { runId, step, instruction }),
    listArtifacts: (opts) => call('artifacts:list', opts || {}),
    readArtifact: (path) => call('artifacts:read', { path }),
    openArtifact: desktopOnly('Opening files with their app'),
    listCliSessions: () => call('cliSessions:list'),
    renameCliSession: (provider, id, title) => call('cliSessions:rename', { provider, id, title }),
    termOpen: (opts) => call('term:open', opts),
    termInput: (id, data) => notify('term:input', { id, data }),
    termResize: (id, cols, rows) => notify('term:resize', { id, cols, rows }),
    termKill: (id) => call('term:kill', { id }),
    onTermData: subscribe('term:data'),
    onTermExit: subscribe('term:exit'),
    clipboardRead: () => navigator.clipboard.readText(),
    clipboardWrite: async (text) => { await navigator.clipboard.writeText(String(text ?? '')); return true; },
    authState: () => call('auth:state'),
    authRefresh: () => call('auth:refresh'),
    signIn: (provider) => call('auth:signIn', provider),
    cancelSignIn: () => call('auth:cancel'),
    signOut: () => call('auth:signOut'),
    onAuthChange: subscribe('auth:changed'),
    // desktop notifications are shown by the desktop app only; the browser never gets a click
    setNotifyContext: (ctx) => notify('notify:context', ctx),
    onNotificationClick: subscribe('notify:open'),
    platform: 'browser',
    onEvent: subscribe('run:event'),
  };
})();
