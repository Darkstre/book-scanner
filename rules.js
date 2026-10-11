// Cataloguing rules shared with the desktop and Android apps (ported from FieldEngine / ConditionStandard / Isbn /
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

// ---------- Genre from subject headings (first match wins; same order as the desktop) ----------

const SUBJECT_MAP = [
  [/\btrue crime\b/, 'True Crime'],
  [/\bscience fiction\b|\bsci-fi\b/, 'Science Fiction'],
  [/\bhorror\b|\bghost stories\b|\bvampires?\b/, 'Horror'],
  [/\bfantasy\b|\bmagic.*fiction\b|\bwizards\b|\bdragons\b/, 'Fantasy'],
  [/\bthriller|\bsuspense\b|\bespionage\b|\bspy stories\b/, 'Thriller'],
  [/\bmystery|\bdetective|\bcrime fiction\b|\bpolice procedural/, 'Mystery & Crime'],
  [/\bhistorical fiction\b|\bfiction, historical\b|\bsea stories\b/, 'Historical Fiction'],
  [/\bwestern( stories)?\b/, 'Western'],
  [/\byoung adult\b/, 'Young Adult'],
  [/\bjuvenile\b|\bchildren'?s\b/, "Children's"],
  [/\bbiograph|\bautobiograph|\bmemoir/, 'Biography & Memoir'],
  [/\boccult|\bwitchcraft\b|\bmagic\b|\btarot\b|\bastrology\b|\bparapsychology\b|\bspiritualism\b/, 'Occult & Esoteric'],
  [/\bmythology\b|\bfolklore\b|\blegends\b/, 'Mythology & Folklore'],
  [/\bpoetry\b|\bpoems\b/, 'Poetry'],
  [/\bdrama\b|\bplays\b/, 'Drama'],
  [/\breligion\b|\bchristian|\bbible\b|\btheology\b|\bspiritual/, 'Religion & Spirituality'],
  [/\bphilosophy\b/, 'Philosophy'],
  [/\bpsychology\b/, 'Psychology'],
  [/\bmedicine\b|\bmedical\b|\bhealth\b/, 'Medicine & Health'],
  [/\bastronomy\b|\bscience\b|\bphysics\b|\bbiology\b|\bevolution\b/, 'Science'],
  [/\bhistory\b/, 'History'],
  [/\bart\b|\billustration\b/, 'Art & Illustration'],
  [/\bgames?\b|\bgaming\b|\brole playing\b/, 'Games & Gaming'],
  [/\bbooks and reading\b|\bbibliograph|\bbook collecting\b/, 'Books & Bibliophilia'],
  [/\bclassic/, 'Classic Literature'],
  [/\bfiction\b/, 'Fiction'],
];

export function genreFromSubjects(subjects) {
  const text = (subjects || []).join(' | ').toLowerCase();
  if (!text) return null;
  const hit = SUBJECT_MAP.find(([re]) => re.test(text));
  return hit ? hit[1] : null;
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

// ---------- Value floors and "Common" rarity (only the confident, scripted cases; the rest is research) ----------

function floorByGrade(grade, top, good, fair, poor) {
  if (grade.startsWith('As New') || grade.startsWith('Fine')) return top;
  if (grade.startsWith('Near Fine') || grade.startsWith('Very Good')) return good;
  if (grade.startsWith('Good')) return fair;
  return poor;
}

/**
 * Builds the queue item's book fields, sources and notes from the owner's input and the ISBN record, like the
 * desktop FieldEngine (without eBay, which needs a server, and without Claude, which runs on the desktop).
 */
export function buildDraft(record, input) {
  const book = {}, sources = {}, notes = [];
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
  if (input.notes && input.notes.trim()) notes.push('Owner: ' + input.notes.trim());

  if (record && record.title) {
    set('Title', record.fullTitle, 'record');
    set('Author', record.authors.join(' & '), 'record');
    set('Year', record.year, 'record');
    set('Publisher', record.place && record.publisher ? `${record.publisher}, ${record.place}` : record.publisher, 'record');
    set('Pages', record.pages, 'record');
    set('Series', record.series, 'record');
    if (!book.Edition && record.editionName && !/^\d/.test(record.editionName)) set('Edition', record.editionName, 'record');
    const g = genreFromSubjects(record.subjects);
    if (g) set('Genre', g, 'script');
  } else {
    set('Title', input.title, 'owner');
    set('Author', input.author, 'owner');
  }
  if (input.isbn) set('ISBN', input.isbn, record && record.title ? 'record' : 'owner');

  const grade = (book.Condition || '').split('|')[0].split('/')[0].trim();
  const text = `${book.Edition || ''} ${book.Format || ''} ${book.Condition || ''}`;
  const bookClub = /book club/i.test(`${book.Edition || ''} ${book.Condition || ''}`);
  const special = !!book.Signed || /limited|numbered|signed|slipcase|leather|easton|franklin|folio|deluxe|proof|advance/i.test(text);
  const year = parseInt(book.Year || '0', 10);
  const modernMassMarket = /^Mass Market/i.test(book.Format || '') && year >= 1980;
  let valueBasis = '', valueWeak = false;
  if (bookClub && !special) {
    set('Value', '$' + floorByGrade(grade, 8, 6, 4, 3), 'script');
    valueBasis = 'book-club edition floor ($3-8 by condition)';
  } else if (modernMassMarket && !special) {
    set('Value', '$' + floorByGrade(grade, 6, 5, 4, 3), 'script');
    valueBasis = 'mass-market paperback floor ($3-6 by condition)';
    valueWeak = true;
  }
  if (!special) {
    const reason = bookClub ? 'book club edition, widely available'
      : modernMassMarket ? 'mass-market paperback, large print runs'
      : record && record.forSale ? 'still in print' : null;
    if (reason) set('Rarity', 'Common; ' + reason, 'script');
  }
  return { book, sources, notes, valueBasis, valueWeak };
}
