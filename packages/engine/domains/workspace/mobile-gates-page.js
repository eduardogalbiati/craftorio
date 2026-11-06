// Phone gates' self-contained HTML: fixed interface text follows the workspace's language,
// while gate content stays verbatim. Only the small client and its translated strings are inlined.
const crypto = require('crypto');
const I18n = require('@multiagent/shared/i18n');
const { continueText } = require('../session/session-cache');
const { displayName } = require('@multiagent/shared/display-name');
const { firstSentences } = require('../../engine/gate-summary');
const { phoneGatesClient } = require('./mobile-gates-client');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const securityHeaders = (nonce) => ({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'${nonce ? `; script-src 'nonce-${nonce}'` : ''}`,
});
const STYLE = `*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6;color-scheme:dark}
main{max-width:640px;margin:0 auto;padding:16px;overflow-wrap:anywhere}h1{font-size:22px;line-height:1.3;margin:4px 0 16px}h2{font-size:18px;margin:0 0 8px}
.card{border:1px solid #2a2f3a;border-left:3px solid #f5a524;border-radius:10px;padding:16px;margin:0 0 16px;background:#161a22}
.brief-body{white-space:pre-line}.muted{color:#aab3c2;font-size:14px}.rec{border:1px solid #2a2f3a;border-radius:8px;padding:12px;margin:12px 0;background:#11151c}
.btns{display:grid;gap:8px;margin-top:16px}a{color:#a9c9ff}a.btn,button{display:block;min-height:44px;width:100%;text-align:center;padding:12px;border-radius:8px;border:1px solid #3a4150;background:#222837;color:#e6e6e6;font:inherit;text-decoration:none;white-space:normal;overflow-wrap:anywhere}
a.primary,button.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}.help{display:block;font-size:14px;color:#c3cad6;margin-top:4px}
.error{color:#fca5a5}label{display:block;margin-bottom:8px}input{width:100%;min-height:44px;padding:12px;border-radius:8px;border:1px solid #3a4150;background:#11151c;color:#e6e6e6;font:inherit}
button:disabled{opacity:.6}a:focus-visible,button:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:3px solid #a9c9ff;outline-offset:3px}
.full-message{white-space:pre-wrap;font:inherit}summary{min-height:44px;padding:12px 0;cursor:pointer}summary:focus-visible{outline:3px solid #a9c9ff}.decision-warning{border-left:3px solid #f5a524;padding:12px;background:#11151c}[hidden]{display:none!important}ul{padding-left:20px}#msg{margin:16px 0}#msg:empty{margin:0}p{margin:12px 0}`;

function translator(language) {
  const lang = I18n.resolveLanguage(language);
  return { lang, t: (key, params) => I18n.t(`phone_page.${key}`, params, lang) };
}

function page(title, body, language, client = false) {
  const { lang, t } = translator(language);
  const nonce = crypto.randomBytes(12).toString('base64');
  // '<' is escaped for script context, even if a future translation contains </script>.
  const strings = Object.fromEntries([
    'open', 'loading', 'list_ready', 'empty', 'refresh', 'retry', 'unpaired', 'pair_invalid',
    'storage_unavailable', 'pairing', 'pair_limited', 'pair_refused', 'pair_failed', 'storage_failed', 'list_failed',
    'sending', 'answered', 'answer_invalid', 'answer_unknown', 'link_invalid', 'ended', 'all',
  ].map((key) => [key, t(key)]));
  const data = JSON.stringify(strings).replace(/</g, '\\u003c');
  const script = client ? `<script nonce="${nonce}">(${phoneGatesClient.toString()})(${data});</script>` : '';
  return {
    html: `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main data-testid="phone-gates-page">${body}</main>${script}</body></html>`,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders(client ? nonce : null) },
  };
}

const message = () => '<p id="msg" role="status" aria-live="polite" tabindex="-1"></p>';

function gatesPage(language) {
  const { t } = translator(language);
  return page(t('title'), `<h1>${esc(t('heading'))}</h1>${message()}
    <section id="pairing" class="card" hidden><p>${esc(t('pair_help'))}</p>
      <form id="pf"><label for="pc">${esc(t('code'))}</label><input id="pc" autocomplete="off" autocapitalize="characters" spellcheck="false" required maxlength="32">
      <p><button id="pair-submit" class="primary" type="submit">${esc(t('pair'))}</button></p></form></section>
    <div id="gates"></div><button id="retry" type="button" hidden>${esc(t('retry'))}</button>`, language, true);
}

function noticePage(kind, language, status = 200) {
  const { t } = translator(language);
  const body = `<div class="card"><h1>${esc(t(kind))}</h1><p>${esc(t(`${kind}_help`))}</p></div><p><a class="btn" href="/">${esc(t('all'))}</a></p>`;
  return { ...page(t('title'), body, language), status };
}

function briefHtml(brief, t) {
  const rec = brief.recommendation;
  const label = typeof rec === 'string' ? rec : rec?.label || rec?.answer || '';
  const reason = typeof rec === 'object' && rec ? rec.reason || rec.why || '' : '';
  const recommendation = rec ? `<div class="rec"><b>${esc(t('recommended'))}</b> ${esc(label)}${reason ? `<p>${esc(reason)}</p>` : ''}</div>` : '';
  const body = brief.body ? `<p class="brief-body">${esc(brief.body)}</p>` : '';
  const options = Array.isArray(brief.options) ? `<ul>${brief.options.map((option) => `<li>${esc(option)}</li>`).join('')}</ul>` : '';
  const action = brief.user_action ? `<p><b>${esc(t('owner_action'))}</b> ${esc(brief.user_action)}</p>` : '';
  return body + recommendation + options + action;
}

function gatePage({ run, gate }, token, chosen, language, choices) {
  const { t } = translator(language);
  const brief = gate.brief || {};
  const head = `<div class="muted">${esc(run.title || run.workflow || run.runId)} · ${esc(gate.step_id || '')}</div><h1>${esc(brief.headline || firstSentences(gate.message) || t('approval'))}</h1>`;
  const self = `/gates/${encodeURIComponent(run.runId)}/${encodeURIComponent(gate.approval_id)}?t=${encodeURIComponent(token)}`;

  const rec = briefHtml(brief, t);
  const evidence = (brief.evidence || []).filter((x) => x && /^https:\/\//.test(x.url || ''));
  const links = evidence.length ? `<ul>${evidence.map((x) => `<li><a href="${esc(x.url)}" rel="noreferrer">${esc(x.label || x.url)}</a></li>`).join('')}</ul>` : '';
  const details = gate.message ? `<details><summary>${esc(t('details'))}</summary><div class="full-message">${esc(gate.message)}</div></details>` : '';
  const context = rec + links + details;
  if (chosen) return confirmationPage({ head, context, recommendation: brief.recommendation, self, token, chosen, language });
  const turns = Array.isArray(run.nextTurns) ? `<p class="muted">${esc(continueText(run.nextTurns, (a) => displayName(a, run.agent_names), (key) => t(`turn_${key}`)))}</p>` : '';
  const buttons = choices.map((c) => `<a class="btn" href="${esc(`${self}&answer=${encodeURIComponent(c.id)}`)}">${esc(c.label || c.id)}${c.help ? `<span class="help">${esc(c.help)}</span>` : ''}</a>`).join('');
  return page(run.title || t('title'), `<div class="card">${head}${context}${turns}<div class="btns">${buttons}</div></div><p><a class="btn" href="/">${esc(t('all'))}</a></p>`, language);
}

function confirmationPage({ head, context, recommendation, self, token, chosen, language }) {
  const { t } = translator(language);
  const post = self.split('?')[0] + '/answer';
  const against = recommendation?.answer && recommendation.answer !== chosen.id;
  const warning = against ? `<p class="decision-warning" role="note">${esc(t('against_recommendation', { recommended: recommendation.label || recommendation.answer, chosen: chosen.label || chosen.id }))}</p>` : '';
  return page(t('confirm_title'), `<div class="card">${head}${context}${warning}<p>${esc(t('chosen', { choice: chosen.label || chosen.id }))}</p>${chosen.help ? `<p class="rec">${esc(chosen.help)}</p>` : ''}
    <form id="confirm" data-post="${esc(post)}" data-t="${esc(token)}" data-answer="${esc(chosen.id)}">
      <p><label for="fb">${esc(t(chosen.feedback_required ? 'note_required' : 'note_optional'))}</label><input id="fb" maxlength="2000" ${chosen.feedback_required ? 'required' : ''}></p>
      <button id="answer-submit" class="primary" type="submit">${esc(t('confirm', { choice: chosen.label || chosen.id }))}</button></form>
    ${message()}<p><a id="recover" class="btn" href="${esc(self)}" hidden>${esc(t('check_gate'))}</a></p>
    <p><a class="btn" href="${esc(self)}">${esc(t('back'))}</a></p></div>`, language, true);
}

module.exports = {
  gatePage,
  gatesPage,
  noticePage,
  securityHeaders,
  translator,
};
