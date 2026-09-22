// "New photos" logic for the gallery index (FI + EN).
//
// Rolling 14-day window: the latest addition opens a window; any earlier
// addition within 14 days of the next one extends the streak backwards, so
// 5 photos on 1.9 + 3 on 10.9 counts as "+8", dated 10.9. The badge shows
// until 14 days after the latest addition. Expiry is checked in the browser
// (see GalleryNewsStrip.astro) so badges disappear on time without a rebuild.

export const NEWS_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export interface GalleryNews<T> {
  newCount: number;
  latest: string; // YYYY-MM-DD
  newImages: T[]; // photos in the current streak, newest first
}

export function getGalleryNews<T extends { added_at?: string }>(images: T[]): GalleryNews<T> | null {
  const dates = [...new Set(images.map(i => i.added_at).filter((d): d is string => !!d))]
    .sort()
    .reverse();
  if (dates.length === 0) return null;

  let streakStart = dates[0];
  for (const d of dates.slice(1)) {
    if ((toMs(streakStart) - toMs(d)) / DAY_MS <= NEWS_WINDOW_DAYS) streakStart = d;
    else break;
  }
  const newImages = images
    .filter(i => i.added_at && i.added_at >= streakStart)
    .sort((a, b) => b.added_at!.localeCompare(a.added_at!));
  return { newCount: newImages.length, latest: dates[0], newImages };
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function newsLabel(news: { newCount: number; latest: string }, lang: 'fi' | 'en'): string {
  const [, m, d] = news.latest.split('-').map(Number);
  return lang === 'fi'
    ? `+${news.newCount} uutta · ${d}.${m}.`
    : `+${news.newCount} new · ${d} ${EN_MONTHS[m - 1]}`;
}
