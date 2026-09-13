import { getCollection } from 'astro:content';

export interface TickerItem {
  href: string;
  title: string;
}

// Shared "most read" ticker pool, identical on every page that shows it --
// same 5 newest articles + 3 newest Pikauutiset for a given lang, merged by
// date, regardless of which page is rendering. Pikauutiset have no per-entry
// URL/anchor (they're collapsible cards on one shared listing page), so every
// pikauutinen ticker item links to the listing page itself.
export async function getTickerItems(lang: 'fi' | 'en'): Promise<TickerItem[]> {
  const articles = (await getCollection('articles', (entry) =>
    entry.id.startsWith(`${lang}/`) && !entry.data.draft
  )).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  const slugFor = (a: (typeof articles)[number]) =>
    lang === 'fi'
      ? `/fi/aikakone/${a.id.replace(/^fi\//, '')}`
      : `/en/time-machine/${a.id.replace(/^en\//, '')}`;

  const articleItems = articles.slice(0, 5).map((a) => ({
    href: slugFor(a),
    title: a.data.title,
    _date: a.data.date,
  }));

  // Pikauutiset are now locale-scoped too (Decap i18n, multiple_folders), so
  // they need the same `${lang}/` id filter the articles use. EN translations
  // are opt-in per entry, so the EN pool is simply smaller until editors add
  // them -- no special-casing needed.
  const pikauutisetHref = lang === 'fi' ? '/fi/pikauutiset' : '/en/in-brief';
  const pikauutiset = (await getCollection('pikauutiset', (entry) =>
    entry.id.startsWith(`${lang}/`) && !entry.data.draft
  ))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
    .slice(0, 3);

  return [
    ...articleItems,
    ...pikauutiset.map((p) => ({
      href: pikauutisetHref,
      title: p.data.title,
      _date: p.data.date,
    })),
  ]
    .sort((a, b) => b._date.getTime() - a._date.getTime())
    .map(({ href, title }) => ({ href, title }));
}
