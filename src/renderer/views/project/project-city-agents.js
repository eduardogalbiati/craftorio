// The agents at work on the project city (#374), an overlay of the City view (project-city.js) built
// on its overlay API, so the city's own module does not grow. attach(city, { projectId }) adds a card
// to the city (data-testid="city-agents") and polls architecture:agents: the project's runs in
// progress, each agent session's last file, each run's trail of changed files and its uncommitted
// files (src/shared/city-agents.js places them on the layout). On the city: a layer
// (ProjectCity.overlay) lights each run's trail in the run's colour and the files two runs change in
// red, with a pin in the run's colour on each building an agent is on and on each crane. On the card:
// one entry per agent ("<agent> · <step>", its robot as the run lists draw it, robotAvatar of
// run-list.js), a click opens its run (showRun); the collision risks with the Conflict map link
// (ProjectConflictMap.linkHtml); the new files as buildings under construction, with their district;
// "No agent is working on this project" when no run of this project is in progress.
// "Replay on the map" (replay(projectId, runId), the run screen's button): the project's City view
// opens and plays that run's file touches (CityAgents.CityReplay) with a timeline, play/pause and a
// speed; Close goes back to the live view. Never starts a run, answers a gate or calls a model.
// Uses app.js globals at call time: api, esc, errMsg, showRun. Browser: window.ProjectCityAgents.
(() => {
  const POLL_MS = 5000;
  const LAYER = 'agents';
  const COLLISION = '#d7263d';
  const CRANE = '#f2a541';
  const TICK_MS = 100;
  // a replay plays the run in about a minute at 1×, whatever its length
  const REPLAY_MS = 60e3;
  const REPLAY_COLOUR = '#4c9be8';
  const handles = new Set();
  let pending = null; // { projectId, runId }: the replay asked from a run's screen

  const short = (id) => String(id || '').slice(-8);
  const clock = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const robotOf = (a, workflow) => (typeof robotAvatar === 'function' && a.provider
    ? robotAvatar(a.provider, a.model, a.kind === 'change' ? 'writing' : 'thinking', workflow, a.agent) : '');

  // The city's layer: the trails in their run's colour, the collisions in red, a pin per robot and crane
  function layerOf(scene) {
    const highlight = {};
    for (const t of scene.trails) for (const p of t.paths) highlight[p] = t.colour;
    for (const c of scene.collisions) highlight[c.path] = COLLISION;
    const markers = [
      ...scene.robots.map((r) => ({ colour: r.colour, label: r.label, path: r.path })),
      ...scene.cranes.map((p) => ({ colour: CRANE, label: 'Uncommitted changes', path: p })),
    ];
    return { highlight, markers };
  }

  function agentHtml(a, run) {
    const what = a.kind === 'change' ? 'changes' : 'reads';
    return `<li><button type="button" class="pca-agent" data-testid="city-agent" data-pca-run="${esc(run.id)}" title="${esc(`Open its run · ${what} ${a.path}`)}">`
      + `<span class="pca-robot" aria-hidden="true">${robotOf(a, run.workflow)}</span>`
      + `<span class="pca-who"><b>${esc(`${a.agent || 'agent'} · ${a.step || '?'}`)}</b><small class="muted">${what} <code>${esc(a.path)}</code></small></span>`
      + `<span class="r3d-dot" style="--c:${esc(run.colour)}" title="${esc(`Run ${run.id}`)}"></span></button></li>`;
  }

  // the card's body: agents, collision risks, buildings under construction, cranes
  function bodyHtml(data, scene, projectId) {
    const runs = data.runs || [];
    if (!runs.length) return '<p class="pca-empty muted" data-testid="city-agents-empty">No agent is working on this project</p>';
    const agents = runs.flatMap((r) => (r.agents || []).map((a) => agentHtml(a, r))).join('');
    const district = (id) => (window.ProjectCity?.current()?.layout?.districts || []).find((d) => d.id === id)?.name || id;
    return `${agents ? `<ul class="pca-list">${agents}</ul>` : '<p class="muted small">The runs in progress have not touched a file yet.</p>'}
      ${(data.collisions || []).map((c) => `<div class="pca-collision" data-testid="city-collision" role="alert"><b>Collision risk</b> <code title="${esc(c.path)}">${esc(c.path)}</code><small class="muted">changed by ${c.runs.length} runs in progress: ${c.runs.map((id) => esc(short(id))).join(', ')}</small>${window.ProjectConflictMap ? ProjectConflictMap.linkHtml(projectId) : ''}</div>`).join('')}
      ${scene.building.length ? `<p class="small pca-new" data-testid="city-under-construction"><b>Under construction</b> ${scene.building.map((b) => `<code title="${esc(`A new file in ${district(b.district)}`)}">${esc(b.path)}</code>`).join(' ')}</p>` : ''}
      ${scene.cranes.length ? `<p class="small muted">${scene.cranes.length} building${scene.cranes.length === 1 ? '' : 's'} with uncommitted changes (cranes)</p>` : ''}`;
  }

  function attach(city, { projectId }) {
    const el = document.createElement('div');
    el.className = 'r3d-card pca';
    el.setAttribute('data-testid', 'city-agents');
    el.setAttribute('aria-live', 'polite');
    city.el.appendChild(el);
    let answer = null;
    let error = null;
    let seq = 0;
    let replay = null; // { runId, player, scale, timer }
    let layered = ''; // the layer set on the city (JSON), '' for none
    let destroyed = false;
    const layout = () => city.layout || window.ProjectCity?.current()?.layout || null;

    // the live answer, or the replay's frame as a single run on the city
    function data() {
      if (!replay) return answer;
      const f = replay.player.frame();
      return { projectId, runs: [{ id: replay.runId, colour: REPLAY_COLOUR, agents: f.last, trail: CityAgents.trailOf(f.touches), dirty: [] }], collisions: [] };
    }

    // `tick`: a replay's frame, the controls kept (a drag on the timeline, an open speed list)
    function draw(tick = false) {
      if (destroyed) return;
      const d = data();
      const scene = CityAgents.placeAgents(layout() || { buildings: [], districts: [] }, d || { runs: [] });
      // nobody at work: the city keeps its colours; the city repaints only when the layer changes
      const key = d && d.runs.length ? JSON.stringify(layerOf(scene)) : '';
      if (key !== layered) {
        ProjectCity.overlay(LAYER, key ? JSON.parse(key) : null);
        layered = key;
      }
      const seek = tick && replay && el.querySelector('[data-pca-seek]');
      if (seek) {
        if (document.activeElement !== seek) seek.value = String(replay.player.time);
        el.querySelector('[data-pca-clock]').textContent = `${clock(replay.player.time / replay.scale)} / ${clock(replay.player.duration / replay.scale)}`;
        el.querySelector('[data-pca-play]').textContent = replay.player.playing ? 'Pause' : 'Play';
        el.querySelector('.pca-body').innerHTML = bodyHtml(d, scene, projectId);
        return;
      }
      const head = replay
        ? `<div class="pca-head"><b>Replay of run ${esc(short(replay.runId))}</b><button type="button" class="link-btn" data-pca-close data-testid="city-replay-close">Close</button></div>
          <div class="pca-replay">
            <button type="button" class="btn sm" data-pca-play data-testid="city-replay-play">${replay.player.playing ? 'Pause' : 'Play'}</button>
            <input type="range" min="0" max="${replay.player.duration}" value="${replay.player.time}" data-pca-seek data-testid="city-replay-timeline" aria-label="Replay timeline">
            <select data-pca-speed data-testid="city-replay-speed" aria-label="Replay speed">${CityAgents.SPEEDS.map((s) => `<option value="${s}"${s === replay.player.speed ? ' selected' : ''}>${s}×</option>`).join('')}</select>
            <small class="muted" data-pca-clock>${clock(replay.player.time / replay.scale)} / ${clock(replay.player.duration / replay.scale)}</small>
          </div>`
        : `<div class="pca-head"><b>Agents at work</b>${answer && answer.runs.length ? `<small class="muted">${answer.runs.length} run${answer.runs.length === 1 ? '' : 's'} in progress</small>` : ''}</div>`;
      const body = error ? `<p class="small" role="alert">Could not read the agents: ${esc(error)}</p>`
        : d ? bodyHtml(d, scene, projectId) : '<p class="muted small">Looking for agents at work…</p>';
      el.innerHTML = `${head}<div class="pca-body">${body}</div>`;
    }

    function stopReplay() {
      if (replay) clearInterval(replay.timer);
      replay = null;
    }

    function startReplay(answerReplay) {
      stopReplay();
      const player = new CityAgents.CityReplay(answerReplay.touches);
      replay = { runId: answerReplay.runId, player, scale: Math.max(1, player.duration / REPLAY_MS), timer: null };
      const r = replay;
      r.timer = setInterval(() => {
        if (el.isConnected === false) return stopReplay(); // the card left the screen
        if (!r.player.playing) return;
        r.player.tick(TICK_MS * r.scale);
        draw(true);
      }, TICK_MS);
      r.timer?.unref?.();
      player.play();
    }

    async function refresh() {
      if (destroyed) return;
      const mine = ++seq;
      const want = pending && pending.projectId === projectId ? pending.runId : null;
      try {
        const next = await api.architectureAgents(want ? { projectId, runId: want } : { projectId });
        if (destroyed || mine !== seq) return;
        if (want && next.replay) {
          pending = null;
          startReplay(next.replay);
        }
        answer = next;
        error = null;
      } catch (e) {
        if (destroyed || mine !== seq) return;
        if (want) pending = null;
        error = errMsg(e);
      }
      draw();
    }

    el.addEventListener('click', (e) => {
      if (window.ProjectConflictMap?.onLinkClick(e)) return;
      const run = e.target.closest('[data-pca-run]');
      if (run) { showRun(run.dataset.pcaRun); return; }
      if (!replay) return;
      if (e.target.closest('[data-pca-close]')) { stopReplay(); refresh(); return; }
      if (e.target.closest('[data-pca-play]')) {
        if (replay.player.playing) replay.player.pause(); else replay.player.play();
        draw();
      }
    });
    el.addEventListener('input', (e) => {
      if (replay && e.target.matches('[data-pca-seek]')) { replay.player.seek(+e.target.value); draw(true); }
    });
    el.addEventListener('change', (e) => {
      if (replay && e.target.matches('[data-pca-speed]')) { replay.player.setSpeed(+e.target.value); draw(); }
    });

    // live: polled while the city is on screen; a replay plays on its own clock
    const poll = setInterval(() => { if (el.isConnected && !replay) refresh(); }, POLL_MS);
    poll?.unref?.(); // under Node (the renderer's tests) the poll never keeps the process alive
    const handle = {
      el,
      projectId,
      refresh,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearInterval(poll);
        stopReplay();
        handles.delete(handle);
        if (layered) ProjectCity.overlay(LAYER, null);
        el.remove();
      },
    };
    handles.add(handle);
    draw();
    refresh();
    return handle;
  }

  /** "Replay on the map": opens the project's City view and plays the run's file touches over it. */
  function replay(projectId, runId) {
    pending = { projectId, runId };
    for (const h of handles) if (h.projectId === projectId) h.refresh();
    window.ProjectArchitecture?.openCity(projectId);
  }

  window.ProjectCityAgents = {
    attach,
    replay,
  };
})();
