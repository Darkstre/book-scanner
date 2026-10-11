// Free ISBN lookups (Open Library, then Google Books), same order and matching rules as the desktop's IsbnLookup:
// Google results are used only when the volume carries this exact ISBN (its "isbn:" search operator is unreliable).
import { isbnTo13, isbnTo10, digits, titleCase, normalizeSeries, firstLast, yearOf } from './rules.js';

const get = async (url, ms = 8000) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
};

export async function lookupIsbn(isbn, googleKey = '') {
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

  // Edition details (binding, edition name, series) can take many seconds on Open Library's side: run them alongside
  // Google with a short limit; they only refine the format suggestion.
  const details = (async () => {
    try {
      const e = await get(`https://openlibrary.org/isbn/${d13}.json`, 2500);
      rec.physicalFormat = e.physical_format || '';
      rec.editionName = e.edition_name || '';
      if (Array.isArray(e.series) && e.series.length) rec.series = normalizeSeries(e.series[0]);
    } catch { /* optional */ }
  })();
  await Promise.all([details, fromGoogle(rec, d13, d10, googleKey)]);

  rec.title = titleCase(rec.title);
  rec.subtitle = titleCase(rec.subtitle);
  rec.fullTitle = rec.subtitle && !rec.title.includes(':') ? `${rec.title}: ${rec.subtitle}` : rec.title;
  return rec;
}

// Google Books: bare number, then title + author; only a volume with this exact ISBN counts
async function fromGoogle(rec, d13, d10, googleKey) {
  const keyPart = googleKey ? `&key=${encodeURIComponent(googleKey)}` : '';
  const queries = [d13];
  if (rec.title) queries.push(`intitle:"${rec.title}"` + (rec.authors[0] ? ` inauthor:${rec.authors[0].split(' ').pop()}` : ''));
  for (const q of queries) {
    try {
      const data = await get(`https://www.googleapis.com/books/v1/volumes?maxResults=40&country=US&q=${encodeURIComponent(q)}${keyPart}`);
      const hit = (data.items || []).find((it) => (it.volumeInfo.industryIdentifiers || [])
        .map((i) => digits(i.identifier)).some((id) => id === d13 || (d10 && id === d10)));
      if (!hit) continue;
      const vi = hit.volumeInfo;
      const pick = (cur, inc) => cur || inc || '';
      if ((vi.title || '').toLowerCase() === rec.title.toLowerCase()) rec.title = vi.title;   // Google capitalises properly
      if ((vi.subtitle || '').toLowerCase() === rec.subtitle.toLowerCase()) rec.subtitle = vi.subtitle || '';
      rec.title = pick(rec.title, vi.title);
      rec.subtitle = pick(rec.subtitle, vi.subtitle);
      if (!rec.authors.length && vi.authors) rec.authors = vi.authors.map(firstLast);
      rec.publisher = pick(rec.publisher, vi.publisher);
      rec.year = pick(rec.year, yearOf(vi.publishedDate));
      rec.pages = pick(rec.pages, vi.pageCount > 0 ? String(vi.pageCount) : '');
      rec.subjects = [...new Set([...rec.subjects, ...(vi.categories || [])])];
      if (hit.saleInfo?.saleability === 'FOR_SALE' && !hit.saleInfo?.isEbook) rec.forSale = true;
      rec.sources.push('Google Books');
      return;
    } catch (e) {
      if (e.message === '429' || e.message === '403') return;   // no quota for this key (or none): Open Library is enough
    }
  }
}
