// Free ISBN lookup on Open Library, only to confirm the right book before it's queued. The desktop does the full
// lookup (Open Library + Google) when it prepares the queue.
import { isbnTo13, isbnTo10, titleCase, normalizeSeries, firstLast, yearOf } from './rules.js';

const get = async (url, ms = 8000) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
};

export async function lookupIsbn(isbn) {
  const d13 = isbnTo13(isbn), d10 = isbnTo10(d13);
  const rec = { isbn, title: '', subtitle: '', authors: [], publisher: '', place: '', year: '', pages: '', series: '',
    editionName: '', physicalFormat: '', subjects: [], forSale: false, sources: [] };
  if (!d13) return rec;

  // Open Library: names resolved by jscmd=data; binding, edition name and series from /isbn/
  try {
    const keys = d10 ? `ISBN:${d13},ISBN:${d10}` : `ISBN:${d13}`;
    const data = await get(`https://openlibrary.org/api/books?bibkeys=${keys}&jscmd=data&format=json`);
    const b = Object.values(data)[0];
    if (b) {
      rec.title = b.title || '';
      rec.subtitle = b.subtitle || '';
      rec.authors = (b.authors || []).map((a) => firstLast(a.name)).filter(Boolean);
      rec.publisher = (b.publishers || [])[0]?.name || '';
      rec.place = (b.publish_places || [])[0]?.name || '';
      rec.year = yearOf(b.publish_date);
      rec.pages = b.number_of_pages > 0 ? String(b.number_of_pages) : '';
      rec.subjects = (b.subjects || []).map((s) => s.name).filter(Boolean).slice(0, 25);
      rec.sources.push('Open Library');
    }
  } catch { /* one source down shouldn't stop the other */ }

  // Edition details (binding, edition name, series) can take many seconds on Open Library's side: short limit,
  // they only refine the format suggestion.
  try {
    const e = await get(`https://openlibrary.org/isbn/${d13}.json`, 2500);
    rec.physicalFormat = e.physical_format || '';
    rec.editionName = e.edition_name || '';
    if (Array.isArray(e.series) && e.series.length) rec.series = normalizeSeries(e.series[0]);
  } catch { /* optional */ }

  rec.title = titleCase(rec.title);
  rec.subtitle = titleCase(rec.subtitle);
  rec.fullTitle = rec.subtitle && !rec.title.includes(':') ? `${rec.title}: ${rec.subtitle}` : rec.title;
  return rec;
}
