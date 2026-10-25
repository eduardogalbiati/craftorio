// The documentation site's behaviour (scripts/docs-site.js): the sidebar's groups and filter, the right column following the
// scroll, the Copy button on code blocks, the menu on narrow screens.
(() => {
  // groups
  document.querySelectorAll('.nav-group-title').forEach((b) => b.addEventListener('click', () => {
    const open = b.parentElement.classList.toggle('open');
    b.setAttribute('aria-expanded', String(open));
  }));

  // filter
  const search = document.getElementById('search');
  const groups = [...document.querySelectorAll('.nav-group')];
  search?.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    groups.forEach((g) => {
      let any = false;
      g.querySelectorAll('li').forEach((li) => {
        const hit = !q || li.textContent.toLowerCase().includes(q);
        li.classList.toggle('hidden', !hit);
        any = any || hit;
      });
      g.classList.toggle('hidden', !any);
      if (q && any) g.classList.add('open');
    });
  });
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.querySelector('.nav-group:not(.hidden) li:not(.hidden) a')?.click();
  });

  // the right column follows the scroll
  const tocLinks = [...document.querySelectorAll('.toc a')];
  if (tocLinks.length) {
    const byId = new Map(tocLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const headings = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const setActive = (id) => tocLinks.forEach((a) => a.classList.toggle('active', a === byId.get(id)));
    const onScroll = () => {
      const top = 52 + 24;
      let current = headings[0];
      for (const h of headings) if (h.getBoundingClientRect().top <= top) current = h; else break;
      if (current) setActive(current.id);
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // copy
  document.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', async () => {
    const code = b.parentElement.querySelector('code')?.textContent || '';
    const label = b.textContent;
    try { await navigator.clipboard.writeText(code); b.textContent = b.dataset.copied; b.classList.add('done'); }
    catch { b.textContent = '!'; }
    setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 1500);
  }));

  // narrow screens
  document.querySelector('.menu')?.addEventListener('click', () => document.body.classList.toggle('nav-open'));
  document.querySelector('.content')?.addEventListener('click', () => document.body.classList.remove('nav-open'));
})();
