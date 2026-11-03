// Intents (#633, spec R9): a finding of a run (the Night watch, analyze-project) enters the project's
// Discovery Inbox as an `intent` card (discovery.js createCard), links.from { workflow, runId, finding }.
// Called by service/channels/nightwatch.js and domains/refactor/refactor-proposals-run.js.
const discovery = require('./discovery');

/**
 * Creates the intent card of a finding and returns it, or null when it cannot be written (a project
 * id that is no plain name, a full disk): the finding stays where its run keeps it.
 */
function createIntent(dir, projectId, { workflow, runId = null, finding = null, title, text = '', author }) {
  try {
    return discovery.createCard(dir, projectId, { title, text, type: 'intent', author: author || workflow, from: { workflow, runId, finding } });
  } catch { return null; }
}

module.exports = {
  createIntent,
};
