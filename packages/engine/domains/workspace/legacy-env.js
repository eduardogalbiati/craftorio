// The environment variables before the rename to Craftorio (T2b): MULTIAGENT_<NAME> was the name of
// every CRAFTORIO_<NAME>. A MULTIAGENT_<NAME> set without its CRAFTORIO_<NAME> is copied to it, once
// per process, and the copy is reported once on stderr, so a shell, a script or a CI job written for
// the old name keeps working (the simulation guard first: MULTIAGENT_SIMULATION_ONLY=1 still refuses
// real providers). Required for its effect at the top of every entry point (the engine's bin, the
// desktop app's main process, the scripts) and of packages/engine/engine/providers.js, which spawns
// the agents' CLIs. Accepted for one major version; then this file goes.
//   bridgeLegacyEnv(env = process.env, { warn }) → [names copied]
const OLD = 'MULTIAGENT_';
const NEW = 'CRAFTORIO_';

function bridgeLegacyEnv(env = process.env, { warn = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const copied = [];
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith(OLD) || v == null) continue;
    const name = NEW + k.slice(OLD.length);
    if (env[name] !== undefined) continue;
    env[name] = v;
    copied.push(k);
  }
  if (copied.length && warn) warn(`[craftorio] ${copied.sort().join(', ')}: the old name of ${copied.length === 1 ? 'a variable' : 'these variables'}; use CRAFTORIO_* (the MULTIAGENT_* names are accepted for one major version).`);
  return copied;
}

if (!globalThis.__craftorioLegacyEnvBridged) {
  globalThis.__craftorioLegacyEnvBridged = true;
  bridgeLegacyEnv();
}

module.exports = { bridgeLegacyEnv };
