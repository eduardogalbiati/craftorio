// The English texts left on a part of a screen read in another language (#847): the steps that say "shows
// none of these English texts:" give it the part's locator and the texts, one per row of their table.
// A text is looked for in what the owner reads there: each element's text, its title, aria-label and
// placeholder, and the options of its selects (a closed select's too). A short text (SHORT or fewer characters, e.g. "On", "Trust
// auto") is found only as the whole text of an element, an option or an attribute, so "On" never matches
// inside a Portuguese word; a longer one is found anywhere in the part's text.
const SHORT = 12;

/** The texts of `texts` found in the element of `locator` (resolved, visible). */
async function englishTextsIn(locator, texts) {
  return locator.evaluate((root, { list, short }) => {
    const nodes = [root, ...root.querySelectorAll('*')];
    const whole = new Set();
    for (const n of nodes) {
      whole.add((n.textContent || '').trim());
      for (const a of ['title', 'aria-label', 'placeholder']) if (n.getAttribute(a)) whole.add(n.getAttribute(a).trim());
    }
    const all = `${root.textContent || ''} ${[...whole].join(' ')}`;
    return list.filter((t) => (t.length <= short ? whole.has(t) : all.includes(t)));
  }, { list: texts, short: SHORT });
}

/** The texts of a Gherkin table of one text per row (no header). */
const tableTexts = (table) => table.raw().map((r) => String(r[0] || '').trim()).filter(Boolean);

module.exports = { englishTextsIn, tableTexts };
