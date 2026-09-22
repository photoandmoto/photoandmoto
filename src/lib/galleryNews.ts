// "New photos" logic for the gallery index (FI + EN).
//
// Per-photo 14-day window: every photo counts as new for 14 days after its
// own added_at date, independently of other photos. A chip shows how many of a
// gallery's photos are currently inside their window, dated by the newest one.
// Example: 1 photo on 22.9 + 1 on 23.9 -> "+2" until 6.10, "+1" on 7.10,
// gone on 8.10.
//
// The build only pre-filters to photos that were new at build time (keeps the
// page light); the browser re-checks each photo's date on every page view
// (see GalleryNewsStrip.astro), so counts drop and chips disappear on time
// without a rebuild.

export const NEWS_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const todayHelsinki = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Helsinki' });

export interface GalleryNews<T> {
  newCount: number;
  latest: string;  // YYYY-MM-DD of the newest photo
  newImages: T[];  // photos inside their window at build time, newest first
}

export function getGalleryNews<T extends { added_at?: string }>(images: T[]): GalleryNews<T> | null {
  const today = toMs(todayHelsinki());
  const newImages = images
    .filter(i => {
      if (!i.added_at) return false;
      const days = (today - toMs(i.added_at)) / DAY_MS;
      return days >= 0 && days <= NEWS_WINDOW_DAYS;
    })
    .sort((a, b) => b.added_at!.localeCompare(a.added_at!));
  if (newImages.length === 0) return null;
  return { newCount: newImages.length, latest: newImages[0].added_at!, newImages };
}

// Comma-separated added dates (newest first) for the browser-side re-check.
export const newsDates = (news: GalleryNews<{ added_at?: string }>) =>
  news.newImages.map(i => i.added_at).join(',');

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Keep in sync with the label function in GalleryNewsStrip.astro's script.
export function newsLabel(news: { newCount: number; latest: string }, lang: 'fi' | 'en'): string {
  const [, m, d] = news.latest.split('-').map(Number);
  return lang === 'fi'
    ? `+${news.newCount} uutta · ${d}.${m}.`
    : `+${news.newCount} new · ${d} ${EN_MONTHS[m - 1]}`;
}
