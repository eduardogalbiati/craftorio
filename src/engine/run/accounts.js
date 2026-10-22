// @ts-check
// Several accounts per provider (#312): Settings' `providers.<provider>.accounts` ([{ name, dir,
// enabled }], the constructor's `accounts`) are the provider's config folders, in order. A new
// session of an agent runs on the first enabled account that is not out (`turnAccount`), given to
// the CLI process through its config-folder variable (`sessionAccountEnv`, providers.accountEnv),
// never through the prompt. A turn that hits the account's usage limit marks it out until the reset
// time its message gives (the adapter's quotaReset) or for Settings' cooldown, and is repeated at
// once in a fresh session on the next account of the SAME provider (`agent.account_switch`); only
// after the provider's last account does the agent's #262 fallback chain apply (`nextFallback`),
// and with no chain the step waits for credits (`run.waiting_credits`) until an account is back.
// A provider without accounts behaves as before #312 (no account, a quota error with no chain fails).

'use strict';

const {
  accountEnv,
  isQuotaError,
  quotaResetAt,
  sleep,
} = require('../providers');

// how long an account stays out when its limit message gives no reset time (Settings' accountCooldownMinutes)
const DEFAULT_COOLDOWN_MS = 60 * 60e3;
// setTimeout's longest delay: a longer wait for credits is waited in several parts
const MAX_SLEEP_MS = 2 ** 31 - 1;

const methods = {
  // the constructor's options (kept out of it: its complexity is at its limit)
  setupAccounts(accounts, cooldownMs) {
    this.providerAccounts = accounts && typeof accounts === 'object' ? accounts : {};
    this.accountCooldownMs = Number(cooldownMs) > 0 ? Number(cooldownMs) : DEFAULT_COOLDOWN_MS;
    this.accountOut = new Map(); // `${provider}|${name}` -> epoch ms the account is back
  },

  // the provider's usable accounts, in order: enabled unless `enabled: false`, with a name and a folder
  enabledAccounts(provider) {
    const list = this.providerAccounts[provider];
    return (Array.isArray(list) ? list : []).filter((a) => a && a.enabled !== false && a.name && a.dir);
  },

  accountBackAt(provider, name) {
    return this.accountOut.get(`${provider}|${name}`) || 0;
  },

  // the first enabled account of the provider that is not out, or null
  firstAccount(provider) {
    return this.enabledAccounts(provider).find((a) => this.accountBackAt(provider, a.name) <= Date.now()) || null;
  },

  // The account a new session of the agent runs on: null when its provider has no accounts; when
  // every account is out, the step waits for credits first.
  async turnAccount(agentName, agent, stepId) {
    if (!this.enabledAccounts(agent.provider).length) return null;
    for (;;) {
      const account = this.firstAccount(agent.provider);
      if (account) return account;
      await this.waitForCredits(agentName, agent.provider, stepId);
    }
  },

  // the CLI process's variables for the session's account ({} without one)
  sessionAccountEnv(session, providerType) {
    return accountEnv(providerType, session.account ? { dir: session.accountDir } : null);
  },

  // Marks the session's account out (until its reset time when the message gives one in the future,
  // else for the cooldown: a simulated reset in the past counts as none) and returns the next
  // account of the provider, recording the switch; null when none is left (or no account).
  nextAccount(agentName, agent, session, providerType, err) {
    if (!session.account) return null;
    const reset = quotaResetAt(providerType, err.message);
    const until = reset && reset > Date.now() ? reset : Date.now() + this.accountCooldownMs;
    this.accountOut.set(`${agent.provider}|${session.account}`, until);
    const next = this.firstAccount(agent.provider);
    if (!next) return null;
    this.emitEvent('agent.account_switch', {
      agent: agentName, step_id: session.stepId || null, provider: agent.provider, from: session.account, to: next.name,
      reason: err.message, until: new Date(until).toISOString(),
    });
    return next;
  },

  // No account of the provider left: the run waits (the orchestrator `waiting`) until the first one
  // is back; stop() ends the wait (Cancelled). Gates are not involved: a gate still waits for its answer.
  async waitForCredits(agentName, provider, stepId) {
    const enabled = this.enabledAccounts(provider);
    const back = Math.min(...enabled.map((a) => this.accountBackAt(provider, a.name)));
    this.emitEvent('run.waiting_credits', {
      agent: agentName, step_id: stepId || null, provider, until: Number.isFinite(back) && back > 0 ? new Date(back).toISOString() : null,
    });
    this.setStatus(this.orchestrator, 'waiting');
    await sleep(Math.min(MAX_SLEEP_MS, Math.max(0, back - Date.now())), this.abort.signal);
    this.setStatus(this.orchestrator, 'active');
  },

  // #262: the next entry of the agent's fallback chain, taken: the agent stays there for the run and
  // its next session records what it fell back from. false when the chain has none left.
  takeFallback(agentName, agent, def, stepId, err) {
    const next = this.nextFallback(agentName, agent);
    if (!next) return false;
    const from = `${agent.provider}:${agent.model}`;
    Object.assign(def, { provider: next.provider, model: next.model });
    this.ctx.agents[agentName] = { provider: next.provider, model: next.model };
    this.fallbackAt.get(agentName).pending = { from, reason: err.message };
    this.emitEvent('agent.fallback', { agent: agentName, step_id: stepId, from, to: `${next.provider}:${next.model}`, reason: err.message });
    return true;
  },

  // A failed turn of agentTurn. Out of credits / past its usage limit: the next account of the same
  // provider, else the next entry of the fallback chain (#262), else (a provider with accounts) a
  // wait for credits; each repeats the turn in a fresh session (from the agent's handoff note).
  // Anything else fails the turn as before.
  async recoverTurn(err, t) {
    const { session, persistent, agentName, agent, def, providerType, stepId } = t;
    const quota = !this.abort.signal.aborted && isQuotaError(providerType, err.message);
    const moved = quota && (!!this.nextAccount(agentName, agent, session, providerType, err) || this.takeFallback(agentName, agent, def, stepId, err));
    const wait = quota && !moved && !!session.account;
    if (!moved && !wait) {
      if (persistent) this.setStatus(session, 'error');
      else this.closeSession(session, 'failed');
      throw err;
    }
    this.closeSession(session, 'failed');
    if (persistent) this.agentSessions.delete(agentName);
    if (wait) await this.waitForCredits(agentName, agent.provider, stepId);
    return this.agentTurn(agentName, t.prompt, t.turnOpts);
  },
};

module.exports = {
  DEFAULT_COOLDOWN_MS,
  methods,
};
