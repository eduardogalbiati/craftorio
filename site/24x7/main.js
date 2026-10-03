// The 24x7 page: the day clock, reveal on scroll, videos that play while on screen, the newsletter.
// The form calls public.join_newsletter (supabase/migrations/20261003000000_newsletter.sql) with the
// publishable key, the same public settings as src/auth-config.js: row level security keeps the
// list unreadable from here.

const SUPABASE_URL = 'https://grguuqxwdqxighfzurgh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AyKeR5ap4awlLc2d7OBCQw_sQp_lwV7';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  const parts = ['page=24x7'];
  for (const [k, v] of new URLSearchParams(location.search)) if (k.startsWith('utm_')) parts.push(`${k}=${v}`);
  try { if (document.referrer) parts.push(`ref=${new URL(document.referrer).host}`); } catch { /* ignore */ }
  return parts.join('&').slice(0, 500);
}

function validate(form) {
  const errors = {};
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  if (name && name.length < 2) errors.name = 'Nome muito curto.';
  if (!EMAIL_RE.test(email)) errors.email = 'Esse e-mail não parece válido.';
  if (!form.consent.checked) errors.consent = 'Marque para eu poder te mandar os capítulos.';
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
    label.textContent = 'Enviando…';
    button.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>');
    try {
      await subscribe(data);
      form.hidden = true;
      done.hidden = false;
    } catch (err) {
      if (err.field) {
        showErrors(form, { [err.field]: 'Confira este campo.' });
        form.elements[err.field].focus();
      } else {
        msg.textContent = 'Não consegui registrar agora. Tente de novo em instantes.';
      }
    } finally {
      button.disabled = false;
      label.textContent = 'Assinar';
      button.querySelector('.spinner')?.remove();
    }
  });
}

drawClock();
startReveal();
startVideos();
startForm();
