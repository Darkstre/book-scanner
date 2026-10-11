// The capture rules shared with the desktop and Android apps (ported from ConditionStandard / Isbn / FieldEngine /
// IsbnLookup). Tested against ../shared-tests/rules-cases.json by tests/rules.test.mjs, like both apps' test suites.

// ---------- ISBN ----------

export const digits = (s) => (s || '').toUpperCase().replace(/[^0-9X]/g, '');

function valid10(d) {
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] === 'X' ? 10 : +d[i]) * (10 - i);
  return sum % 11 === 0;
}

function valid13(d) {
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += +d[i] * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function isbnValid(s) {
  const d = digits(s);
  return d.length === 10 ? valid10(d) : d.length === 13 ? valid13(d) : false;
}

export function isbnTo13(s) {
  const d = digits(s);
  if (d.length === 13 && valid13(d)) return d;
  if (d.length !== 10 || !valid10(d)) return '';
  const core = '978' + d.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +core[i] * (i % 2 === 0 ? 1 : 3);
  return core + ((10 - (sum % 10)) % 10);
}

export function isbnTo10(s) {
  const d = digits(s);
  if (d.length === 10 && valid10(d)) return d;
  if (d.length !== 13 || !valid13(d) || !d.startsWith('978')) return '';
  const core = d.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +core[i] * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

// ---------- Condition (book-trade standard: "Grade[ / Jacket grade] | token: details") ----------

export const GRADES = ['As New', 'Fine', 'Near Fine', 'Very Good', 'Good', 'Fair', 'Poor'];
export const FORMATS = ['Hardcover', 'Trade Paperback', 'Mass Market Paperback', 'Paperback', 'Leather',
  'Slipcased Hardcover', 'Boxed Set', 'Library Binding', 'Ledger', 'Other'];
export const EDITIONS = ['', 'First Edition', 'First American Edition', 'First UK Edition', 'Book Club Edition',
  'First Edition Thus', 'Reprint', 'Second Edition'];
export const DETAILS = ['Book club edition', 'Limited edition', 'Proof / advance copy', 'Association copy',
  'Presentation copy', 'Bookplate', 'Ex-library', 'Light foxing', 'Moderate foxing', 'Heavy foxing', 'Bumped corners',
  'Spine lean', 'Text block issues'];

export function conditionBuild(grade, jacketGrade, djToken, detail) {
  const left = !jacketGrade || !djToken || djToken === 'noDJ' ? grade : `${grade} / ${jacketGrade}`;
  const d = (detail || '').trim().replace(/^[;,]+|[;,]+$/g, '').trim();
  if (djToken) return d ? `${left} | ${djToken}: ${d}` : `${left} | ${djToken}`;
  return d ? `${left} | ${d}` : left;
}

/** Formats that take a dust jacket (hardcovers; not slipcased, leather, boxed or paperback). */
export function takesJacket(format) {
  const f = (format || '').toLowerCase();
  if (/slipcase|leather|boxed|ledger|paperback|softcover/.test(f)) return false;
  return /hard(cover|back)|dust jacket/.test(f);
}

/**
 * The condition from the quick details asked between pile scans (same rule as the desktop and Android apps):
 * jacket is hasDJ / protectedDJ / noDJ, or 'jacketless' for a hardcover issued without one; it only counts for formats
 * that take a jacket (or when no format was given). No grade → '' (left for the review).
 */
export function quickCondition(format, grade, jacket, details = []) {
  if (!grade) return '';
  const parts = details.filter((d) => d && d.trim()).map((d) => d.trim().toLowerCase());
  let token = null;
  if (jacket && (!format || takesJacket(format))) {
    if (jacket === 'jacketless') parts.unshift('issued jacketless'); else token = jacket;
  }
  return conditionBuild(grade, null, token, parts.join('; '));
}

// ---------- Printing ----------

const ORDINALS = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth',
  'Twentieth'];

/** Lowest number in the number line → "Third Printing"; 0 = later printing (stated, no number); -1/null = not checked. */
export function printingText(n) {
  if (n === null || n === undefined || n === -1) return '';
  if (n === 0) return 'Later Printing';
  if (n < ORDINALS.length) return ORDINALS[n] + ' Printing';
  const suffix = [11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix} Printing`;
}

// ---------- Record helpers ----------

const SMALL = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'from', 'with', 'as', 'vs']);

/** Sentence-case titles from Open Library ("Desolation island") → "Desolation Island". */
export function titleCase(title) {
  if (!title) return title || '';
  const words = title.split(' ');
  let startOfPart = true;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const letters = w.replace(/^["'(\[“‘]+/, '');
    const core = letters.replace(/[,:;.]+$/, '');
    if (letters && /[a-z]/.test(letters[0]) && (startOfPart || letters.length < w.length || !SMALL.has(core.toLowerCase()))) {
      const at = w.length - letters.length;
      words[i] = w.slice(0, at) + letters[0].toUpperCase() + letters.slice(1);
    }
    startOfPart = w.endsWith(':') || w.endsWith('.') || w === '-' || w === '—';
  }
  return words.join(' ');
}

/** "The Dark Tower ; 1", "Dark Tower (1)", "Dune #2" → "Name, Book N". */
export function normalizeSeries(s) {
  s = (s || '').split(';')[0].replace(/\s*-{2,}\s*/g, ' ').trim().replace(/,+$/, '');
  if (!s) return '';
  const m = /^(.*?)[\s,;:#(]+(?:book|bk\.?|vol\.?|volume|no\.?)?\s*(\d+(?:\.\d+)?)\)?\s*$/i.exec(s.trim());
  return m && m[1].trim() ? `${titleCase(m[1].trim().replace(/[,;]+$/, ''))}, Book ${m[2]}` : titleCase(s.trim());
}

/** "King, Stephen, 1947-" → "Stephen King". */
export function firstLast(name) {
  const n = (name || '').replace(/,?\s*\d{4}-(\d{4})?\.?$/, '').trim().replace(/[.,]+$/, '');
  const parts = n.split(',');
  return parts.length === 2 ? `${parts[1].trim()} ${parts[0].trim()}` : n;
}

export const yearOf = (date) => ((date || '').match(/\b(1[5-9]|20)\d{2}\b/) || [''])[0];

/** Format suggestion from the record's binding; the owner's choice always wins. */
export function suggestedFormat(physical) {
  const f = (physical || '').toLowerCase();
  if (f.includes('mass market')) return 'Mass Market Paperback';
  if (f.includes('trade')) return 'Trade Paperback';
  if (f.includes('leather')) return 'Leather';
  if (f.includes('library')) return 'Library Binding';
  if (f.includes('hard') || f.includes('cloth')) return 'Hardcover';
  if (f.includes('paper') || f.includes('soft')) return 'Paperback';
  return '';
}

// ---------- The capture sent to the desktop ----------

/**
 * The owner's details plus what the free lookup confirmed. Everything else (Google, your other copies, genre, eBay
 * value, floors, rarity, research) is done by the desktop when it prepares the queue (FieldEngine.PrepareAsync).
 */
export function buildDraft(record, input) {
  const book = {}, sources = {};
  const set = (field, value, source) => {
    if (!value || !String(value).trim()) return;
    book[field] = String(value).trim();
    sources[field] = source;
  };
  set('Format', input.format, 'owner');
  set('Condition', input.condition, 'owner');
  set('Signed', input.signed ? 'Yes' : '', 'owner');
  set('Edition', input.edition, 'owner');
  set('Printing', printingText(input.printing), 'owner');
  book.Status = 'Own'; sources.Status = 'owner';
  if (record && record.title) {
    set('Title', record.fullTitle, 'record');
    set('Author', record.authors.join(' & '), 'record');
    set('Year', record.year, 'record');
    set('Publisher', record.place && record.publisher ? `${record.publisher}, ${record.place}` : record.publisher, 'record');
    set('Pages', record.pages, 'record');
    set('Series', record.series, 'record');
  } else {
    set('Title', input.title, 'owner');
    set('Author', input.author, 'owner');
  }
  if (input.isbn) set('ISBN', input.isbn, record && record.title ? 'record' : 'owner');
  return { book, sources };
}
