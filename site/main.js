// Waitlist landing page: hero animation, reveal on scroll and the sign-up form.
// The form calls public.join_waitlist (supabase/migrations/20260930000000_waitlist.sql) with the
// publishable key, the same public settings as src/auth-config.js: row level security keeps the
// list unreadable from here.

const SUPABASE_URL = 'https://grguuqxwdqxighfzurgh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AyKeR5ap4awlLc2d7OBCQw_sQp_lwV7';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- hero run
const RUN_LOG = [
  'develop → Claude Code implementa a issue #42 no worktree',
  'code_review → Codex revisa o diff: 2 ajustes pedidos',
  'test → Grok escreve e roda os testes: 48 passando',
  'build → build e auditoria de dependências ok',
  'ci · pr → CI verde, PR pronto para merge',
  'approve_merge → aguardando a sua aprovação',
];

function startRun() {
  const steps = [...document.querySelectorAll('#steps li')];
  const log = document.getElementById('run-log');
  const status = document.getElementById('run-status');
  if (!steps.length) return;

  const show = (i) => {
    steps.forEach((li, n) => {
      li.classList.toggle('done', n < i);
      li.classList.toggle('active', n === i);
    });
    const gate = i === steps.length - 1;
    const done = i >= steps.length;
    log.textContent = done ? 'merge aprovado por você → deploy em produção' : RUN_LOG[i];
    status.textContent = done ? 'concluído' : gate ? 'aguardando você' : 'em execução';
    status.className = 'run-status' + (done ? ' done' : gate ? ' wait' : '');
  };

  if (reducedMotion) return show(steps.length - 1);
  let i = 0;
  const tick = () => {
    show(i);
    // the human gate and the final state stay on screen longer
    const delay = i === steps.length - 1 ? 3200 : i >= steps.length ? 2600 : 1500;
    i = i >= steps.length ? 0 : i + 1;
    setTimeout(tick, delay);
  };
  tick();
}

// ---------------------------------------------------------------- the day bar
// 24 blocks: the agents' hours, and the owner's two (08:00 and 09:00); the current hour is outlined
function drawDay() {
  const bar = document.getElementById('day-bar');
  if (!bar) return;
  const now = new Date().getHours();
  bar.innerHTML = Array.from({ length: 24 }, (_, h) => {
    const cls = [h === 8 || h === 9 ? 'you' : '', h === now ? 'now' : ''].filter(Boolean).join(' ');
    return `<i class="${cls}" style="animation-delay:${h * 30}ms" title="${String(h).padStart(2, '0')}:00"></i>`;
  }).join('');
}

// ---------------------------------------------------------------- reveal
function startReveal() {
  const items = document.querySelectorAll('.benefit, .perk, .how li, .facts, .waitlist-grid, .faq details');
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.12 });
  items.forEach((el) => { el.classList.add('reveal'); io.observe(el); });
}

// ---------------------------------------------------------------- feature story
// Desktop: the step in the middle of the viewport lights up and the pinned frame shows its still.
// Narrow screens: each still moves into its own step. Stills only: a video of the app's screens
// looked blurry and could not be used on a phone anyway.

function startStory() {
  const steps = [...document.querySelectorAll('.story-step')];
  const media = [...document.querySelectorAll('.story-media')];
  // the frame's label is the step's tag; one dot per step
  const labels = steps.map((s) => s.querySelector('.tag')?.textContent || '');
  const dotList = document.querySelector('.story-dots');
  dotList.innerHTML = steps.map(() => '<li></li>').join('');
  const dots = [...dotList.children];
  const label = document.getElementById('story-label');
  const stage = document.querySelector('.story-stage .shot-stage');
  if (!steps.length || !('IntersectionObserver' in window)) return;
  const narrow = window.matchMedia('(max-width: 980px)');
  // one frame per step for narrow screens, filled when the layout switches
  const frames = steps.map((s) => {
    const f = document.createElement('figure');
    f.className = 'shot-frame';
    f.innerHTML = '<div class="shot-stage"></div>';
    s.querySelector('.story-slot').append(f);
    return f.firstChild;
  });

  let current = -1;
  const activate = (i) => {
    if (i < 0 || i === current) return;
    current = i;
    steps.forEach((s, n) => s.classList.toggle('active', n === i));
    dots.forEach((d, n) => d.classList.toggle('active', n === i));
    media.forEach((m, n) => m.classList.toggle('active', n === i));
    label.textContent = labels[i];
  };
  const layout = () => media.forEach((m, i) => (narrow.matches ? frames[i] : stage).append(m));

  // wide: the step in the middle of the viewport is the active one
  const byStep = new IntersectionObserver((entries) => {
    if (narrow.matches) return;
    for (const e of entries) if (e.isIntersecting) activate(steps.indexOf(e.target));
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => byStep.observe(s));

  narrow.addEventListener('change', layout);
  layout();
  steps[0].classList.add('active'); // lit before the story is reached
  dots[0]?.classList.add('active');
  label.textContent = labels[0];
  // the next stills load while the first one shows
  if (!narrow.matches) media.forEach((m) => { m.loading = 'eager'; });
}
// ---------------------------------------------------------------- form
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Brazilian mask while typing; a number starting with + is left as typed (other countries).
function maskPhone(value) {
  if (value.trim().startsWith('+')) return value;
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// The same rule as join_waitlist: without +, 10-11 digits are a Brazilian number.
function normalizePhone(value) {
  const digits = value.replace(/\D/g, '');
  const full = value.trim().startsWith('+') ? digits : digits.length === 10 || digits.length === 11 ? '55' + digits : digits;
  return /^[0-9]{10,15}$/.test(full) ? '+' + full : null;
}

// Where the sign-up came from: utm_* parameters and the referrer's host (no personal data).
function sourceTag() {
  const params = new URLSearchParams(location.search);
  const parts = [];
  for (const [k, v] of params) if (k.startsWith('utm_')) parts.push(`${k}=${v}`);
  try { if (document.referrer) parts.push(`ref=${new URL(document.referrer).host}`); } catch { /* ignore */ }
  return parts.join('&').slice(0, 500) || null;
}

function validate(form) {
  const errors = {};
  const name = form.name.value.trim();
  const email = form.email.value.trim().toLowerCase();
  const phone = normalizePhone(form.phone.value);
  if (name.length < 2) errors.name = 'Conta pra gente o seu nome.';
  if (!EMAIL_RE.test(email)) errors.email = 'Esse email não parece válido.';
  if (!phone) errors.phone = 'Informe um telefone com DDD, ex.: (11) 91234-5678.';
  if (!form.consent.checked) errors.consent = 'Precisamos do seu ok para enviar as novidades.';
  return { errors, data: { name, email, phone } };
}

function showErrors(form, errors) {
  for (const el of form.querySelectorAll('.err')) {
    const key = el.dataset.for;
    el.textContent = errors[key] || '';
    const input = form.elements[key];
    if (input && input.type !== 'checkbox') input.setAttribute('aria-invalid', errors[key] ? 'true' : 'false');
  }
}

async function joinWaitlist({ name, email, phone }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/join_waitlist`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_name: name, p_email: email, p_phone: phone, p_source: sourceTag() }),
  });
  if (res.ok) return;
  let message = '';
  try { message = (await res.json()).message || ''; } catch { /* not JSON */ }
  const err = new Error(message || `HTTP ${res.status}`);
  err.field = { invalid_name: 'name', invalid_email: 'email', invalid_phone: 'phone' }[message];
  throw err;
}

function startForm() {
  const form = document.getElementById('waitlist-form');
  const success = document.getElementById('success');
  const msg = document.getElementById('form-msg');
  const button = document.getElementById('submit');
  const label = button.querySelector('.btn-label');

  form.phone.addEventListener('input', () => { form.phone.value = maskPhone(form.phone.value); });
  // clear a field's error as soon as it is edited
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
    if (form.company.value) { form.hidden = true; success.hidden = false; return; }

    button.disabled = true;
    label.textContent = 'Enviando…';
    button.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>');
    try {
      await joinWaitlist(data);
      // Google Analytics (index.html's head): a sign-up the database accepted
      window.gtag?.('event', 'waitlist_signup', { page_path: location.pathname });
      form.hidden = true;
      success.hidden = false;
      success.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    } catch (err) {
      if (err.field) {
        showErrors(form, { [err.field]: 'Confira este campo.' });
        form.elements[err.field].focus();
      } else {
        msg.textContent = 'Não conseguimos registrar agora. Tente de novo em instantes.';
      }
    } finally {
      button.disabled = false;
      label.textContent = 'Entrar na lista de espera';
      button.querySelector('.spinner')?.remove();
    }
  });

  document.getElementById('share').addEventListener('click', async (e) => {
    const url = location.origin + location.pathname;
    try {
      await navigator.clipboard.writeText(url);
      e.target.textContent = 'Link copiado ✓';
    } catch {
      e.target.textContent = url;
    }
  });
}

startRun();
drawDay();
startReveal();
startStory();
startForm();
