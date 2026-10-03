// The 24x7 site's script (the homes and the chapter pages, Portuguese and English: the messages
// follow <html lang>): the day clock, reveal on scroll, videos that play while on screen, the newsletter.
// The form calls public.join_newsletter (supabase/migrations/20261003000000_newsletter.sql) with the
// publishable key, the same public settings as src/auth-config.js: row level security keeps the
// list unreadable from here.

const SUPABASE_URL = 'https://grguuqxwdqxighfzurgh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AyKeR5ap4awlLc2d7OBCQw_sQp_lwV7';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LANG = document.documentElement.lang.startsWith('en') ? 'en' : 'pt';
const T = {
  pt: {
    shortName: 'Nome muito curto.', badEmail: 'Esse e-mail não parece válido.', consent: 'Marque para eu poder te mandar os capítulos.',
    check: 'Confira este campo.', failed: 'Não consegui registrar agora. Tente de novo em instantes.', sending: 'Enviando…', subscribe: 'Assinar',
  },
  en: {
    shortName: 'Name too short.', badEmail: 'That email does not look right.', consent: 'Tick this so I can send you the chapters.',
    check: 'Check this field.', failed: 'Could not sign you up right now. Try again in a moment.', sending: 'Sending…', subscribe: 'Subscribe',
  },
}[LANG];

// ---------------------------------------------------------------- the day clock
// 24 blocks: the agents' hours, and the owner's two (08:00 and 09:00); the current hour is outlined
function drawClock() {
  const bar = document.getElementById('clock');
  if (!bar) return;
  const now = new Date().getHours();
  bar.innerHTML = Array.from({ length: 24 }, (_, h) => {
    const cls = [h === 8 || h === 9 ? 'me' : '', h === now ? 'now' : ''].filter(Boolean).join(' ');
    return `<i class="${cls}" style="animation-delay:${h * 30}ms" title="${String(h).padStart(2, '0')}:00"></i>`;
  }).join('');
}

// ---------------------------------------------------------------- reveal and videos
function startReveal() {
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12 });
  document.querySelectorAll('.timeline li, .day > div, .lessons article, .frame, .nums div').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
}

// a video plays while at least half of it is on screen
function startVideos() {
  const videos = document.querySelectorAll('video[data-autoplay]');
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) e.target.play().catch(() => { /* autoplay refused: the poster stays */ });
      else e.target.pause();
    }
  }, { threshold: 0.5 });
  videos.forEach((v) => io.observe(v));
}

// ---------------------------------------------------------------- newsletter
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// where the sign-up came from: utm_* parameters and the referrer's host (no personal data)
function sourceTag() {
  const parts = ['page=24x7', `lang=${LANG}`, `path=${location.pathname}`];
  for (const [k, v] of new URLSearchParams(location.search)) if (k.startsWith('utm_')) parts.push(`${k}=${v}`);
  try { if (document.referrer) parts.push(`ref=${new URL(document.referrer).host}`); } catch { /* ignore */ }
  return parts.join('&').slice(0, 500);
}

function validate(form) {
  const errors = {};
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  if (name && name.length < 2) errors.name = T.shortName;
  if (!EMAIL_RE.test(email)) errors.email = T.badEmail;
  if (!form.consent.checked) errors.consent = T.consent;
  return { errors, data: { name, email } };
}

function showErrors(form, errors) {
  for (const el of form.querySelectorAll('.err')) {
    const key = el.dataset.for;
    el.textContent = errors[key] || '';
    const input = form.elements[key];
    if (input && input.type !== 'checkbox') input.setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
  }
}

async function subscribe({ name, email }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_newsletter`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: name || null, p_email: email, p_source: sourceTag() }),
  });
  if (res.ok) return;
  let message = '';
  try { message = (await res.json()).message || ''; } catch { /* not JSON */ }
  const err = new Error(message || `HTTP ${res.status}`);
  err.field = { invalid_name: 'name', invalid_email: 'email' }[message];
  throw err;
}

function startForm() {
  const form = document.getElementById('news-form');
  const done = document.getElementById('news-done');
  const msg = document.getElementById('news-msg');
  const button = document.getElementById('news-submit');
  const label = button.querySelector('.btn-label');

  form.addEventListener('input', (e) => {
    const err = form.querySelector(`.err[data-for="${e.target.name}"]`);
    if (err) { err.textContent = ''; e.target.removeAttribute('aria-invalid'); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const { errors, data } = validate(form);
    showErrors(form, errors);
    const first = Object.keys(errors)[0];
    if (first) return form.elements[first].focus();
    // a bot filled the hidden field: pretend it worked
    if (form.company.value) { form.hidden = true; done.hidden = false; return; }

    button.disabled = true;
    label.textContent = T.sending;
    button.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>');
    try {
      await subscribe(data);
      // Google Analytics (the page's head): a subscription the database accepted
      track('newsletter_signup', { page_path: location.pathname });
      form.hidden = true;
      done.hidden = false;
    } catch (err) {
      if (err.field) {
        showErrors(form, { [err.field]: T.check });
        form.elements[err.field].focus();
      } else {
        msg.textContent = T.failed;
      }
    } finally {
      button.disabled = false;
      label.textContent = T.subscribe;
      button.querySelector('.spinner')?.remove();
    }
  });
}

// ---------------------------------------------------------------- analytics
// Google Analytics 4 (loaded in each page's head); every event carries the page's language.
function track(name, params = {}) {
  window.gtag?.('event', name, { lang: LANG, ...params });
}

function startTracking() {
  // the PT/EN switch in the top bar
  document.querySelectorAll('a.lang').forEach((a) => a.addEventListener('click', () => {
    track('language_switch', { from: LANG, to: LANG === 'en' ? 'pt' : 'en', page_path: location.pathname });
  }));
  // a chapter read to the end: its closing block (next chapter, back link) came into view, once
  const article = document.querySelector('.prose[data-chapter]');
  const end = document.querySelector('.post-foot');
  if (article && end && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      track('chapter_read', { chapter: Number(article.dataset.chapter), page_path: location.pathname });
    });
    io.observe(end);
  }
}

drawClock();
startTracking();
startReveal();
startVideos();
startForm();
