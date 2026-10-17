// A test helper (not a test): what the page harnesses (renderer-app-harness.js,
// agent-chat-page-harness.js) give their vm sandbox so src/shared/i18n.js reads its catalogs the way
// it does in the window (#329): a synchronous XMLHttpRequest next to the script, here answered from
// disk, and document.currentScript set to the script being run.
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

/** A synchronous XMLHttpRequest that answers file:// URLs from disk (404 when the file is missing). */
class FileXHR {
  open(method, url) { this.url = String(url); }
  send() {
    try {
      this.responseText = fs.readFileSync(fileURLToPath(this.url), 'utf8');
      this.status = 200;
    } catch {
      this.responseText = '';
      this.status = 404;
    }
  }
}

/** Sets document.currentScript to the file being run, as the browser does while a script runs. */
function setCurrentScript(document, file) {
  document.currentScript = { src: pathToFileURL(file).href };
}

module.exports = { FileXHR, setCurrentScript };
