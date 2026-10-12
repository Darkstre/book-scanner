// Book Scanner: a capture form for the desktop. Scan or type an ISBN (a free Open Library lookup confirms the book),
// add what only the owner can see (format, grade, jacket, printing, edition, photo), and append it to queue.jsonl in
// the owner's GitHub queue repo with Status "new". The Book Collection desktop program prepares new items (Google
// lookup, your other copies, genre, eBay value, floors, rarity) and completes them. No keys live in this page.
import { GRADES, FORMATS, EDITIONS, DETAILS, conditionBuild, quickCondition, takesJacket, buildDraft, isbnValid, suggestedFormat,
  printingText, digits, isNewsstandUpc, isbnFromPrintedText, issueDateFromText } from './rules.js';
import { lookupIsbn } from './lookup.js';
import { readPrintedIsbn } from './ocr.js';
import { GitHub } from './github.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = '') => { try { return localStorage.getItem('bs.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('bs.' + k, v); } catch { /* private mode: settings last this visit */ } },
};
const settings = () => ({
  owner: store.get('owner').trim(), token: store.get('token').trim(), queue: store.get('queue', 'book-queue').trim() || 'book-queue',
});

let record = null;          // Open Library record, when found
let photoBlob = null;
const state = { grade: '', jacket: '', flags: new Set() };

function status(text, ok = false) { const s = $('status'); s.textContent = text; s.className = 'status' + (ok ? ' ok' : ''); }

// ---------- settings ----------

function showSettings(show) {
  $('settings').hidden = !show;
  if (show) { const s = settings(); $('sOwner').value = s.owner; $('sToken').value = s.token; $('sQueue').value = s.queue; }
}
function saveSettings() {
  store.set('owner', $('sOwner').value.trim());
  store.set('token', $('sToken').value.trim());
  store.set('queue', $('sQueue').value.trim() || 'book-queue');
  renderWho();
}
function renderWho() {
  const s = settings();
  $('who').textContent = s.owner && s.token ? `${s.owner} · queue: ${s.queue}` : 'Not set up yet - tap ⚙';
}

// ---------- form ----------

function fillOptions() {
  $('format').innerHTML = '<option value="">Choose…</option>' + FORMATS.map((f) => `<option>${f}</option>`).join('');
  $('jacketGrade').innerHTML = '<option value=""></option>' + GRADES.map((g) => `<option>${g}</option>`).join('');
  const printing = [['(not checked)', ''], ...Array.from({ length: 20 }, (_, i) => [`${i + 1}${i === 0 ? ' (first printing)' : ''}`, String(i + 1)]),
    ['Later printing (stated, no number)', '0'], ['No number line', '-1']];
  $('printing').innerHTML = printing.map(([t, v]) => `<option value="${v}">${t}</option>`).join('');
  $('edition').innerHTML = EDITIONS.map((e) => `<option value="${e}">${e || '(none stated)'}</option>`).join('');
  $('grades').innerHTML = GRADES.map((g) => `<button data-v="${g}">${g}</button>`).join('');
  $('flags').innerHTML = DETAILS.map((d) => `<button data-v="${d}">${d}</button>`).join('');
}

function chipGroup(id, onPick, multi = false) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (multi) b.classList.toggle('on');
    else [...$(id).children].forEach((c) => c.classList.toggle('on', c === b));
    onPick(b.dataset.v, b.classList.contains('on'));
    update();
  });
}

function condition() {
  if (!state.grade) return '';
  const details = [...state.flags].map((f) => f.toLowerCase());
  if ($('notes').value.trim()) details.push($('notes').value.trim());
  return conditionBuild(state.grade, $('jacketGrade').value || null, state.jacket || null, details.join('; '));
}

function input() {
  const p = $('printing').value;
  const typed = $('isbn').value.trim();
  return { format: $('format').value, condition: condition(), edition: $('edition').value, printing: p === '' ? null : +p,
    signed: $('signed').checked, isbn: record?.isbn || (typed && isbnValid(typed) ? typed : ''),
    title: $('hTitle').value.trim(), author: $('hAuthor').value.trim() };
}

function update() {
  $('jacketGradeRow').hidden = !(state.jacket === 'hasDJ' || state.jacket === 'protectedDJ');
  $('condPreview').textContent = condition() || '-';
  const typedIsbn = isbnValid($('isbn').value.trim());
  const identified = !!record?.title || !!$('hTitle').value.trim() || typedIsbn;
  $('details').hidden = !identified;
  $('queueBtn').disabled = !(identified && $('format').value && state.grade);
}

// ---------- identify ----------

async function lookup(raw) {
  const isbn = raw.trim();
  if (!isbnValid(isbn)) { status(digits(isbn).length >= 10 ? 'That number fails the ISBN check digit - check for a typo.' : 'Enter a 10- or 13-digit ISBN.'); return; }
  $('isbn').value = isbn;
  status('Looking up…');
  record = await lookupIsbn(isbn);
  if (!record.title) {
    $('record').hidden = true;
    $('noIsbn').open = true;
    status('Not found on Open Library. You can still queue it (the PC looks it up again); a title below helps.');
  } else {
    const r = record;
    $('record').hidden = false;
    $('record').innerHTML = '<div class="t"></div><div class="m"></div>';
    $('record').querySelector('.t').textContent = r.fullTitle;
    $('record').querySelector('.m').textContent = [r.authors.join(' & '), [r.publisher, r.year, r.pages && r.pages + ' pp'].filter(Boolean).join(' · ')]
      .filter(Boolean).join('\n');
    if (!$('format').value) $('format').value = suggestedFormat(r.physicalFormat);
    status('');
  }
  update();
  $('details').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- photo ----------

async function shrink(file, maxSide = 1024) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
}

// ---------- queue ----------

function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function addToQueue() {
  const s = settings();
  if (!s.owner || !s.token) { showSettings(true); status('Set your GitHub username and token first.'); return; }
  const draft = buildDraft(record, input());
  const label = draft.book.Title || draft.book.ISBN || 'book';
  const id = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  const item = {
    Id: id, Captured: localStamp(), Device: 'web', Status: 'new',     // "new": the desktop prepares it
    Book: draft.book, Sources: draft.sources, Notes: [],
    Photo: '', ValueBasis: '', ValueWeak: false, BatchId: '',
  };
  const gh = new GitHub(s.owner, s.token);
  $('queueBtn').disabled = true;
  try {
    if (photoBlob) {
      status('Uploading the photo…');
      await gh.putBytes(s.queue, `photos/${id}.jpg`, new Uint8Array(await photoBlob.arrayBuffer()), `Photo: ${label}`);
      item.Photo = `photos/${id}.jpg`;
    }
    status('Adding to the queue…');
    await gh.appendLine(s.queue, 'queue.jsonl', JSON.stringify(item), `Queued (web): ${label}`);
    status(`Queued: ${label}. Scan the next one.`, true);
    reset(true);
  } catch (e) {
    status(`Couldn't add it: ${e.message}`);
    $('queueBtn').disabled = false;
  }
}

function reset(keepStatus = false) {
  record = null; photoBlob = null;
  state.grade = ''; state.jacket = ''; state.flags.clear();
  for (const id of ['isbn', 'hTitle', 'hAuthor', 'notes', 'photo']) $(id).value = '';
  for (const id of ['format', 'jacketGrade', 'printing', 'edition']) $(id).selectedIndex = 0;
  $('signed').checked = false;
  [...document.querySelectorAll('.chips button')].forEach((b) => b.classList.toggle('on', b.dataset.v === '' && b.parentElement.id === 'jacket'));
  $('record').hidden = true; $('photoPreview').hidden = true; $('noIsbn').open = false;
  if (!keepStatus) status('');
  update();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** An ISBN from typed or Scan Text input; null unless the check digit passes. */
function readIsbn(v) {
  const d = digits(v);
  if ((d.length === 10 || d.length === 13) && isbnValid(d) && !/[A-WYZa-wyz]/.test(v)) return v.trim().toUpperCase();
  return isbnFromPrintedText(/isbn/i.test(v) ? v : 'ISBN ' + v);
}

/** A newsstand barcode was scanned (single scan): explain, and get the box ready for Scan Text or typing. */
function newsstand() {
  status('Newsstand barcode (mass market paperback): it holds the price, not the ISBN. Reading the ISBN printed near it…');
  $('isbn').value = '';
  $('isbn').inputMode = 'text';   // the full keyboard (iPhone also offers Scan Text there)
  readPrinted('box');
}

// ---------- the printed ISBN, read by the camera (ocr.js) ----------

let ocrActive = false, ocrStream = null;

/** Reads the printed "ISBN …" line; target 'box' (look it up) or 'quick' (the pile's details box). */
async function readPrinted(target) {
  if (ocrActive) return;
  ocrActive = true;
  let video = $('reader').querySelector('video');
  try {
    if (!video) {   // no camera running: open one just for this
      $('reader').hidden = false; $('stopScan').hidden = false;
      for (const id of ['scanBtn', 'pileBtn', 'ocrBtn']) $(id).hidden = true;
      video = document.createElement('video'); video.setAttribute('playsinline', ''); video.muted = true;
      $('reader').replaceChildren(video);
      ocrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
      video.srcObject = ocrStream; await video.play();
    }
  } catch (e) {
    ocrActive = false; await stopScan();
    status(e.name === 'NotAllowedError' ? 'Camera permission was refused - allow it in the browser settings, or type the ISBN.' : `Camera: ${e.message}`);
    return;
  }
  if (target === 'quick') $('quick').hidden = true;   // the box would cover the camera
  const guide = document.createElement('div'); guide.className = 'ocrband';
  $('reader').append(guide);
  // While reading for a newsstand barcode in a pile, it may be a magazine (no ISBN at all).
  let toMagazine = false;
  const magBtn = Object.assign(document.createElement('button'), { className: 'ocrmag', textContent: "📰 It's a magazine" });
  magBtn.addEventListener('click', () => { toMagazine = true; ocrActive = false; });
  if (target === 'quick' && quickNeedsIsbn) $('reader').append(magBtn);
  window.scrollTo({ top: $('reader').offsetTop - 60, behavior: 'smooth' });
  let isbn = null;
  try { isbn = await readPrintedIsbn(video, (t) => status(t), () => !ocrActive); }
  catch (e) { status(e.message); }
  guide.remove(); magBtn.remove();
  const wasActive = ocrActive; ocrActive = false;
  if (target === 'quick') {
    if (quickOpen) $('quick').hidden = false;
    if (toMagazine && quickOpen) { magazineMode(true); return; }
    if (isbn) { beep(true); $('qIsbn').value = isbn; $('qIsbn').dispatchEvent(new Event('input')); status(`Read ISBN ${isbn}.`); }
    if (ocrStream) await stopScan();
    return;
  }
  if (isbn) { beep(true); await stopScan(); lookup(isbn); }
  else if (wasActive) { await stopScan(); }
}

// ---------- barcode ----------

let scanner = null, stream = null, scanning = false;

// ---------- pile mode: every scan goes straight to the queue ----------

let pile = false, pileSent = 0, pileLast = '', pileLastAt = 0, sendChain = Promise.resolve();
let audio = null;

function beep(ok) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1760 : 220;
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + (ok ? 0.09 : 0.3));
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.1 : 0.3));
    if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 60, 80]);
  } catch { /* no sound: scanning still works */ }
}

// Quick details between scans: format, grade, jacket (+ book club / ex-library / signed). The box starts on the last
// book's answers, so a matching pile is one tap per book; with "Ask after every scan" off, every scan gets the last
// answers until they're changed. Never a guess: nothing is filled unless picked.
let quickIsbn = '', quickOpen = false, quickNeedsIsbn = false, formatTouched = false;
let quickMagazine = false, quickUpc = '';
const lookedUp = {};   // ISBN digits -> { title, author } from the box's look-up: sent with the scan

// Magazines seen on this device, by newsstand barcode (every issue of a magazine carries the same UPC).
const magazines = () => { try { return JSON.parse(store.get('magazines', '{}')); } catch { return {}; } };
const upcKey = (u) => { const d = digits(u); return d.length === 13 && d[0] === '0' ? d.slice(1) : d; };
function rememberMagazine(upc, title) { const m = magazines(); m[upcKey(upc)] = title; store.set('magazines', JSON.stringify(m)); }

/** The details box as a magazine issue: magazine name and cover date instead of the book rows. */
function magazineMode(on, title = '') {
  quickMagazine = on;
  $('qMagRow').hidden = !on; $('qBookRows').hidden = on; $('qBookRows2').hidden = on;
  if (on) {
    ocrActive = false;   // stop looking for an ISBN
    $('qIsbnRow').hidden = true;
    $('qTitle').textContent = 'Magazine issue';
    $('qMagTitle').value = title; $('qMagIssue').value = '';
    $('magTitles').replaceChildren(...[...new Set(Object.values(magazines()))].sort().map((t) => Object.assign(document.createElement('option'), { value: t })));
    $('qBare').hidden = true;
    (title ? $('qMagIssue') : $('qMagTitle')).focus();
  }
}
const SIZE_TIP = 'Mass market = pocket size, about 4¼ × 7 in; trade = bigger, usually hardcover size.';
const PER_BOOK = ['signed', 'firstEdition'];   // never carried to the next book (nor is printing)
const quickLast = () => { try { return JSON.parse(store.get('quick', '{}')); } catch { return {}; } };
const quickAsk = () => store.get('quickAsk', '1') === '1';

const editionOf = (q) => (q.bookClub ? 'Book Club Edition' : q.firstEdition ? 'First Edition' : '');
const printingOf = (q) => (q.printing === '' || q.printing == null ? '' : printingText(Number(q.printing)));

function describe(q) {
  const cond = quickCondition(q.format || '', q.grade || '', q.jacket || null, q.exLibrary ? ['Ex-library'] : []);
  const parts = [q.format, cond, editionOf(q).toLowerCase(), printingOf(q).toLowerCase(), q.signed && 'signed'].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'ISBN only';
}

function renderUsing() {
  $('pileUsing').hidden = !pile;
  $('pileUsing').textContent = quickAsk() ? `Asks after every scan (starts on: ${describe(quickLast())})`
    : `Every scan gets: ${describe(quickLast())}`;
  $('qChange').hidden = !pile;
}

function pick(groupId, value) { [...$(groupId).children].forEach((b) => b.classList.toggle('on', b.dataset.v === value)); }
function picked(groupId) { return [...$(groupId).children].find((b) => b.classList.contains('on'))?.dataset.v || ''; }
function showQuickJacket() { const f = picked('qFormat'); $('qJacket').hidden = !!f && !takesJacket(f); }

/** isbn = null: just change the details used for every scan. needIsbn: a newsstand barcode; ask for the printed ISBN. */
function openQuick(isbn, needIsbn = false) {
  const q = quickLast();
  quickIsbn = isbn || ''; quickOpen = true; quickNeedsIsbn = needIsbn;
  if (!needIsbn) quickUpc = '';
  magazineMode(false);
  $('qIsbnRow').hidden = !needIsbn; $('qIsbn').value = '';
  const scan = !!isbn || needIsbn;
  $('qAdd').textContent = scan ? 'Add' : 'Use these';
  $('qBare').hidden = !scan; $('qSkip').textContent = scan ? 'Not this one' : 'Cancel';
  // A newsstand barcode means a mass market paperback, almost always: start there.
  pick('qFormat', needIsbn ? 'Mass Market Paperback' : q.format || ''); pick('qGrade', q.grade || ''); pick('qJacket', q.jacket || '');
  for (const b of $('qExtra').children) b.classList.toggle('on', !PER_BOOK.includes(b.dataset.v) && !!q[b.dataset.v]);
  pick('qPrinting', ''); $('qPrintingOther').value = ''; formatTouched = false;
  $('qFormatHint').textContent = needIsbn ? 'Newsstand barcode: almost always a mass market paperback.' : SIZE_TIP;
  $('qAsk').checked = quickAsk();
  showQuickJacket();
  $('qTitle').textContent = isbn ? `ISBN ${isbn}` : needIsbn ? 'Newsstand barcode' : 'Details for every scan';
  $('quick').hidden = false;
  if (isbn) showQuickTitle(isbn);
}

/** Title - author and the recorded binding for the box (Open Library). */
function showQuickTitle(isbn) {
  // Which book it is (quick Open Library look-up), so a mis-scan is easy to spot; and its binding when recorded.
  fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${digits(isbn)}&jscmd=details&format=json`, { signal: AbortSignal.timeout?.(4000) })
    .then((r) => r.json()).then((j) => {
      const b = j[`ISBN:${digits(isbn)}`]?.details;
      if (!b || quickIsbn !== isbn) return;
      lookedUp[digits(isbn)] = { title: b.title || '', author: b.authors?.[0]?.name || '' };
      if (b.title) $('qTitle').textContent = b.title + (b.authors?.[0]?.name ? ` - ${b.authors[0].name}` : '');
      const f = suggestedFormat(b.physical_format);
      if (!f || formatTouched || (quickNeedsIsbn && f === 'Paperback')) return;   // the newsstand default stands
      const hint = (t) => { $('qFormatHint').textContent = t; };
      if ([...$('qFormat').children].some((c) => c.dataset.v === f)) { pick('qFormat', f); showQuickJacket(); hint(`Format from the book's record: ${b.physical_format}`); }
      else if (f === 'Paperback') {
        if (picked('qFormat') === 'Hardcover') { pick('qFormat', ''); showQuickJacket(); }
        hint(`The record says paperback: trade or mass market? ${SIZE_TIP}`);
      } else hint(`The record says: ${b.physical_format}`);
    }).catch(() => {});
}

/** Adds the magazine issue in the box to the queue (and remembers the magazine for its barcode). */
function addMagazine() {
  const title = $('qMagTitle').value.trim();
  const issue = issueDateFromText($('qMagIssue').value) || $('qMagIssue').value.trim();
  const grade = picked('qGrade');
  if (!title) { status('Name the magazine first.'); $('qMagTitle').focus(); return; }
  const missing = [!issue && 'issue date', !grade && 'grade'].filter(Boolean);
  if (missing.length && !confirm(`Not chosen: ${missing.join(', ')}.\n\nAdd it anyway and set ${missing.length === 1 ? 'it' : 'them'} when you review it on the PC?`)) return;
  rememberMagazine(quickUpc, title);
  if (grade) store.set('quick', JSON.stringify({ ...quickLast(), grade }));
  const year = (issue.match(/\b(19|20)\d{2}\b/) || [''])[0];
  const book = { Title: issue ? `${title}, ${issue}` : title, Series: title, Format: 'Magazine', Status: 'Own' };
  if (issue) book.Edition = issue;
  if (year) book.Year = year;
  const cond = quickCondition('Magazine', grade, null, []);
  if (cond) book.Condition = cond;
  const sources = Object.fromEntries(Object.keys(book).map((k) => [k, 'owner']));
  const id = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  const item = { Id: id, Captured: localStamp(), Device: 'web', Status: 'new', Book: book, Sources: sources,
    Notes: [`Magazine issue (newsstand barcode ${quickUpc}): research the editor, contents and cover artist (ISFDB indexes science fiction magazines issue by issue).`],
    Photo: '', ValueBasis: '', ValueWeak: false, BatchId: '' };
  const s = settings();
  sendChain = sendChain.then(() => new GitHub(s.owner, s.token).appendLine(s.queue, 'queue.jsonl', JSON.stringify(item), `Queued (web pile): ${book.Title}`))
    .then(() => { pileSent++; $('pileCount').textContent = `${pileSent} item(s) queued`; })
    .catch((e) => { beep(false); status(`Couldn't queue ${book.Title}: ${e.message}`); });
  magazineMode(false); quickOpen = false; quickNeedsIsbn = false; $('quick').hidden = true;
  pileLast = quickUpc; pileLastAt = Date.now();
  renderUsing();
}

function closeQuick(choice) {
  if (quickMagazine && choice === 'add') { addMagazine(); return; }
  if (quickMagazine) { magazineMode(false); quickOpen = false; quickNeedsIsbn = false; $('quick').hidden = true; pileLastAt = Date.now(); renderUsing(); return; }
  if (quickNeedsIsbn && choice !== 'skip' && !quickIsbn) {
    status('Scan or type the ISBN printed near the barcode first (or tap Not this one).');
    $('qIsbn').focus();
    return;
  }
  const wasNewsstand = quickNeedsIsbn;
  const isbn = quickIsbn; quickIsbn = ''; quickOpen = false; quickNeedsIsbn = false;
  $('quick').hidden = true;
  if (!isbn && choice === 'skip') { renderUsing(); return; }   // cancelled the change
  store.set('quickAsk', $('qAsk').checked ? '1' : '0');
  if (isbn && !wasNewsstand) { pileLast = isbn; pileLastAt = Date.now(); }   // the camera is still on this book: ignore it for a moment
  if (wasNewsstand) pileLastAt = Date.now();   // same for its newsstand barcode
  if (choice === 'skip') { renderUsing(); return; }
  let q = {};
  if (choice === 'add' && isbn) {
    // Add with something not chosen: say what, and let the owner add anyway (set it at review) or go back.
    const missing = [!picked('qFormat') && 'format', !picked('qGrade') && 'grade',
      !$('qJacket').hidden && !picked('qJacket') && 'jacket'].filter(Boolean);
    if (missing.length && !confirm(`Not chosen: ${missing.join(', ')}.

Add it anyway and set ${missing.length === 1 ? 'it' : 'them'} when you review the book on the PC?`)) {
      quickIsbn = isbn; quickOpen = true; quickNeedsIsbn = wasNewsstand; $('quick').hidden = false;   // go back
      return;
    }
  }
  if (choice === 'add') {
    q = { format: picked('qFormat'), grade: picked('qGrade'), jacket: $('qJacket').hidden ? '' : picked('qJacket') };
    for (const b of $('qExtra').children) q[b.dataset.v] = b.classList.contains('on');
    const other = parseInt($('qPrintingOther').value, 10);
    q.printing = other > 0 ? String(other) : picked('qPrinting');
    store.set('quick', JSON.stringify({ ...q, signed: false, firstEdition: false, printing: '' }));
  }
  if (isbn) queuePile(isbn, q);
  renderUsing();
}

function pileScan(text) {
  if (quickOpen) return;   // the details box is open
  const d = digits(text);
  if (isNewsstandUpc(d)) {
    if (d === pileLast && Date.now() - pileLastAt < 4000) return;
    pileLast = d; pileLastAt = Date.now();
    beep(true);
    quickUpc = d;
    const known = magazines()[upcKey(d)];
    openQuick('', true);   // ask for the ISBN printed near the barcode
    if (known) magazineMode(true, known); else readPrinted('quick');
    return;
  }
  if (!/^97[89]\d{10}$/.test(d)) { beep(false); return; }
  const now = Date.now();
  if (d === pileLast && now - pileLastAt < 4000) return;   // still pointing at the same book
  pileLast = d; pileLastAt = now;
  beep(true);
  if (quickAsk()) openQuick(d); else queuePile(d, quickLast());
}

function queuePile(d, q) {
  const s = settings();
  const id = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  const book = { ISBN: d, Status: 'Own' };
  const rec = lookedUp[digits(d)];   // the box's look-up (the PC checks everything again)
  const condition = quickCondition(q.format || '', q.grade || '', q.jacket || null, q.exLibrary ? ['Ex-library'] : []);
  if (q.format) book.Format = q.format;
  if (condition) book.Condition = condition;
  if (editionOf(q)) book.Edition = editionOf(q);
  if (printingOf(q)) book.Printing = printingOf(q);
  if (q.signed) book.Signed = 'Yes';
  const sources = Object.fromEntries(Object.keys(book).map((k) => [k, 'owner']));
  if (rec?.title) { book.Title = rec.title; sources.Title = 'record'; }
  if (rec?.author) { book.Author = rec.author; sources.Author = 'record'; }
  const item = { Id: id, Captured: localStamp(), Device: 'web', Status: 'new', Book: book, Sources: sources,
    Notes: [q.format && condition
      ? `Scanned in a pile with quick details: check ${printingOf(q) ? '' : 'printing, '}edition and condition notes when you review it.`
      : 'Scanned in a pile: set format, condition and printing when you review it.'],
    Photo: '', ValueBasis: '', ValueWeak: false, BatchId: '' };
  // One at a time, in order, so the queue file never conflicts with itself.
  sendChain = sendChain.then(() => new GitHub(s.owner, s.token).appendLine(s.queue, 'queue.jsonl', JSON.stringify(item), `Queued (web pile): ${d}`))
    .then(() => { pileSent++; $('pileCount').textContent = `${pileSent} book(s) queued`; })
    .catch((e) => { beep(false); status(`Couldn't queue ${d}: ${e.message}`); });
}

async function startPile() {
  const s = settings();
  if (!s.owner || !s.token) { showSettings(true); status('Set your GitHub username and token first.'); return; }
  pile = true; pileSent = 0; pileLast = '';
  $('pileInfo').hidden = false; $('pileCount').hidden = false; $('pileCount').textContent = '0 books queued';
  renderUsing();
  beep(true);   // unlocks sound on iPhone (it must start from a tap)
  await startScan();
}

async function startScan() {
  $('reader').hidden = false; $('stopScan').hidden = false; $('scanBtn').hidden = true; $('pileBtn').hidden = true; $('ocrBtn').hidden = true;
  const done = async (text) => {
    if (ocrActive) return;   // reading the printed ISBN
    if (pile) { pileScan(text); return; }
    const d = digits(text);
    if (isNewsstandUpc(d)) { newsstand(); return; }   // keep the camera on for the printed line
    await stopScan();
    if (/^97[89]\d{10}$/.test(d)) lookup(d);
    else status('That barcode is not an ISBN (it should start 978 or 979).');
  };
  try {
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('ean_13')) {
      // Built-in detector (Chrome on Android): fast and light.
      const video = document.createElement('video'); video.setAttribute('playsinline', ''); video.muted = true;
      $('reader').replaceChildren(video);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      const formats = (await BarcodeDetector.getSupportedFormats()).filter((f) => ['ean_13', 'upc_a', 'upc_e'].includes(f));
      const det = new BarcodeDetector({ formats });
      scanning = true;
      const tick = async () => {
        if (!scanning) return;
        const codes = await det.detect(video).catch(() => []);
        const hit = codes.find((c) => /^97[89]/.test(c.rawValue)) || codes.find((c) => isNewsstandUpc(c.rawValue));
        if (hit) await done(hit.rawValue);
        if (scanning) requestAnimationFrame(tick);
      };
      tick();
    } else {
      // iPhone Safari: the html5-qrcode library.
      if (!window.Html5Qrcode) throw new Error('The barcode reader did not load - check the connection, or type the ISBN.');
      scanner = new Html5Qrcode('reader', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E], verbose: false });
      await scanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.9, 340), height: Math.min(h * 0.45, 160) }) },
        (text) => { if (/^97[89]/.test(text) || isNewsstandUpc(text)) done(text); }, () => {});
    }
    status('Point the camera at the barcode on the back cover.');
  } catch (e) {
    await stopScan();
    status(e.name === 'NotAllowedError' ? 'Camera permission was refused - allow it in the browser settings, or type the ISBN.' : `Camera: ${e.message}`);
  }
}

async function stopScan() {
  scanning = false;
  if (scanner) { try { await scanner.stop(); } catch { /* already stopped */ } scanner = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  ocrActive = false;
  if (ocrStream) { ocrStream.getTracks().forEach((t) => t.stop()); ocrStream = null; }
  $('reader').hidden = true; $('reader').replaceChildren(); $('stopScan').hidden = true; $('scanBtn').hidden = false; $('pileBtn').hidden = false; $('ocrBtn').hidden = false;
  if (pile) {
    if (quickOpen) closeQuick(quickIsbn ? 'add' : 'skip');   // stopped with the box open: keep that book
    pile = false; $('pileInfo').hidden = true; $('pileUsing').hidden = true; $('qChange').hidden = true;
    await sendChain;
    status(`Pile done: ${pileSent} book(s) in the queue. Open Queue on the PC to finish them.`, true);
  }
}

// ---------- wire up ----------

fillOptions();
chipGroup('grades', (v) => { state.grade = v; });
chipGroup('jacket', (v) => { state.jacket = v; });
chipGroup('flags', (v, on) => { if (on) state.flags.add(v); else state.flags.delete(v); }, true);
for (const id of ['format', 'jacketGrade', 'printing', 'edition', 'signed']) $(id).addEventListener('change', update);
for (const id of ['notes', 'hTitle', 'hAuthor', 'isbn']) $(id).addEventListener('input', update);
$('lookupBtn').addEventListener('click', () => lookup(readIsbn($('isbn').value) || $('isbn').value));
// iPhone Scan Text inserts the printed line ("ISBN 0-812-54600-8"): tidy it and look it up.
$('isbn').addEventListener('input', () => {
  const v = $('isbn').value;
  if (!/[A-Za-z]/.test(v)) return;   // plain typing: wait for Look up / Enter
  const found = readIsbn(v);
  if (found) { $('isbn').value = found; $('isbn').inputMode = 'numeric'; lookup(found); }
});
$('isbn').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup($('isbn').value); });
$('scanBtn').addEventListener('click', startScan);
$('pileBtn').addEventListener('click', startPile);
$('ocrBtn').addEventListener('click', () => { beep(true); readPrinted('box'); });
$('qOcr').addEventListener('click', () => readPrinted('quick'));
$('stopScan').addEventListener('click', stopScan);
for (const g of ['qFormat', 'qGrade', 'qJacket', 'qPrinting']) {
  $(g).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    pick(g, b.classList.contains('on') ? '' : b.dataset.v);   // tap again to clear
    if (g === 'qFormat') { formatTouched = true; showQuickJacket(); }
    if (g === 'qPrinting') $('qPrintingOther').value = '';
  });
}
$('qExtra').addEventListener('click', (e) => { e.target.closest('button')?.classList.toggle('on'); });
$('qPrintingOther').addEventListener('input', () => pick('qPrinting', ''));
$('qAdd').addEventListener('click', () => closeQuick('add'));
$('qBare').addEventListener('click', () => closeQuick('bare'));
$('qSkip').addEventListener('click', () => closeQuick('skip'));
$('qChange').addEventListener('click', () => openQuick(null));
$('qMag').addEventListener('click', () => magazineMode(true));
$('qMagIssue').addEventListener('change', () => { const t = issueDateFromText($('qMagIssue').value); if (t) $('qMagIssue').value = t; });
// The printed ISBN for a newsstand barcode: typed, or inserted by iPhone Scan Text ("ISBN 0-380-71922-3", O for 0...).
$('qIsbn').addEventListener('input', () => {
  const found = readIsbn($('qIsbn').value);
  quickIsbn = found || '';
  $('qTitle').textContent = found ? `ISBN ${found}` : 'Newsstand barcode';
  if (found) { $('qIsbn').value = found; showQuickTitle(found); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && quickOpen) closeQuick('skip'); });   // Esc = Not this one / Cancel
$('photo').addEventListener('change', async () => {
  const f = $('photo').files[0]; if (!f) return;
  photoBlob = await shrink(f);
  $('photoPreview').src = URL.createObjectURL(photoBlob); $('photoPreview').hidden = false;
});
$('queueBtn').addEventListener('click', addToQueue);
$('resetBtn').addEventListener('click', () => reset());
$('openSettings').addEventListener('click', () => showSettings($('settings').hidden));
$('closeSettings').addEventListener('click', () => showSettings(false));
$('saveSettings').addEventListener('click', () => { saveSettings(); $('settingsMsg').textContent = 'Saved on this device.'; });
$('testSettings').addEventListener('click', async () => {
  saveSettings();
  const s = settings();
  if (!s.owner || !s.token) { $('settingsMsg').textContent = 'Enter the username and token first.'; return; }
  $('settingsMsg').textContent = 'Testing…';
  try { $('settingsMsg').textContent = await new GitHub(s.owner, s.token).test(s.queue); }
  catch (e) { $('settingsMsg').textContent = e.message; }
});

renderWho();
update();
if (!settings().token) showSettings(true);
