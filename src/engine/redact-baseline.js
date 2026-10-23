// Baseline redaction of run recordings (#475, SEC-10): the secrets the Recorder (src/engine/recorder.js)
// removes from every recorded string before the workflow's own `observability.capture.redact`
// rules, so a workflow that declares nothing still records no well-known secret. Also redacts the
// `env` values of a spawn's `--mcp-config` JSON (`redactMcpConfig`) and the output of a
// `printenv` / `env` tool call (`isEnvDump`, `redactEnvDump`). src/findings.js TOKEN_SHAPE scrubs
// finding bundles with the same kind of patterns.

'use strict';

const REDACTED = '[REDACTED]';

// One pattern per line: what it matches, and what of the match it keeps (the name, the header)
const BASELINE = [
  // PEM private key blocks, whole
  { name: 'pem', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: REDACTED },
  // `Authorization: Bearer <token>`: the scheme stays
  { name: 'bearer', re: /\b(Bearer\s+)[^\s"'\\]{8,}/gi, replace: `$1${REDACTED}` },
  // `AWS_SECRET_ACCESS_KEY=…`, `NPM_TOKEN=…`: the variable name stays
  { name: 'env-pair', re: /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*=)[^\s"'\\]+/g, replace: `$1${REDACTED}` },
  // GitHub fine-grained tokens
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]+/g, replace: REDACTED },
  // GitHub classic tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replace: REDACTED },
  // OpenAI / Anthropic style API keys
  { name: 'sk-key', re: /\bsk-[A-Za-z0-9_-]{8,}/g, replace: REDACTED },
  // Slack tokens
  { name: 'slack', re: /\bxox[abprs]-[A-Za-z0-9-]+/g, replace: REDACTED },
];

/** The string with every baseline pattern redacted. */
function redactBaseline(s) {
  return BASELINE.reduce((acc, { re, replace }) => acc.replace(re, replace), s);
}

/**
 * A spawn's argv with the `env` values of the JSON after `--mcp-config` replaced (the names stay);
 * an argument that is not JSON is redacted whole.
 */
function redactMcpConfig(args) {
  if (!Array.isArray(args)) return args;
  return args.map((a, i) => {
    if (i === 0 || args[i - 1] !== '--mcp-config' || typeof a !== 'string') return a;
    let cfg;
    try { cfg = JSON.parse(a); } catch { return a.trim().startsWith('{') ? REDACTED : a; } // a file path stays
    for (const srv of Object.values(cfg?.mcpServers || {})) {
      if (srv && srv.env && typeof srv.env === 'object') srv.env = Object.fromEntries(Object.keys(srv.env).map((k) => [k, REDACTED]));
    }
    return JSON.stringify(cfg);
  });
}

/** True when a shell command dumps the environment (`printenv`, `env`, alone or piped). */
function isEnvDump(command) {
  return /^\s*(?:printenv|env)\s*(?:$|[|;&>])/.test(String(command || ''));
}

/** The output of an environment dump: the variable names only. */
function redactEnvDump(output) {
  if (typeof output !== 'string') return REDACTED;
  return output.split('\n').map((l) => l.replace(/^([A-Za-z_][A-Za-z0-9_]*)=.*$/, `$1=${REDACTED}`)).join('\n');
}

module.exports = {
  BASELINE,
  isEnvDump,
  redactBaseline,
  redactEnvDump,
  redactMcpConfig,
};
