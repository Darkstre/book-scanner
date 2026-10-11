// Book Scanner: scan or type an ISBN, add what only the owner knows (format, grade, jacket, printing), and append the
// book to queue.jsonl in the owner's GitHub queue repo - the same item format as the phone and desktop apps, which
// finish queued books (research, values, saving to the collection). No keys live in this page.
import { GRADES, FORMATS, EDITIONS, DETAILS, conditionBuild, buildDraft, isbnTo13, isbnValid, suggestedFormat, digits } from './rules.js';
import { lookupIsbn } from './lookup.js';
import { GitHub } from './github.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = '') => { try { return localStorage.getItem('bs.' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('bs.' + k, v); } catch { /* private mode: settings last this visit */ } },
};
const settings = () => ({
  owner: store.get('owner').trim(), token: store.get('token').trim(), queue: store.get('queue', 'book-queue').trim() || 'book-queue',
  books: store.get('books', 'book-collection').trim(), google: store.get('google').trim(),
});

let record = null;          // ISBN record from the lookup
let owned = null;           // the owner's books.csv rows (for "you already have…"), loaded once
let photoBlob = null;
const state = { grade: '', jacket: '', flags: new Set() };

// ---------- status ----------

function status(text, ok = false) { const s = $('status'); s.textContent = text; s.className = 'status' + (ok ? ' ok' : ''); }

// ---------- settings ----------

function showSettings(show) {
  $('settings').hidden = !show;
  if (show) {
    const s = settings();
    $('sOwner').value = s.owner; $('sToken').value = s.token; $('sQueue').value = s.queue; $('sBooks').value = s.books; $('sGoogle').value = s.google;
  }
}
function saveSettings() {
  store.set('owner', $('sOwner').value.trim()); store.set('token', $('sToken').value.trim());
  store.set('queue', $('sQueue').value.trim() || 'book-queue'); store.set('books', $('sBooks').value.trim());
  store.set('google', $('sGoogle').value.trim());
  owned = null;
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
    else { [...$(id).children].forEach((c) => c.classList.toggle('on', c === b)); }
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
  return { format: $('format').value, condition: condition(), edition: $('edition').value, printing: p === '' ? null : +p,
    signed: $('signed').checked, notes: '', isbn: record?.isbn || ($('isbn').value.trim() && isbnValid($('isbn').value) ? $('isbn').value.trim() : ''),
    title: $('hTitle').value.trim(), author: $('hAuthor').value.trim() };
}

function update() {
  $('jacketGradeRow').hidden = !(state.jacket === 'hasDJ' || state.jacket === 'protectedDJ');
  $('condPreview').textContent = condition() || '-';
  const identified = !!record?.title || !!$('hTitle').value.trim();
  $('details').hidden = !identified;
  $('queueBtn').disabled = !(identified && $('format').value && state.grade);
  showVerdict();
}

// ---------- identify ----------

async function lookup(raw) {
  const isbn = raw.trim();
  if (!isbnValid(isbn)) { status(digits(isbn).length >= 10 ? 'That number fails the ISBN check digit - check for a typo.' : 'Enter a 10- or 13-digit ISBN.'); return; }
  $('isbn').value = isbn;
  status('Looking up…');
  record = await lookupIsbn(isbn, settings().google);
  if (!record.title) {
    $('record').hidden = true;
    $('noIsbn').open = true;
    status('No record found for this ISBN. Type the title (and author) below; the PC will research the rest.');
  } else {
    const r = record;
    $('record').hidden = false;
    $('record').innerHTML = `<div class="t"></div><div class="m"></div>`;
    $('record').querySelector('.t').textContent = r.fullTitle;
    $('record').querySelector('.m').textContent = [r.authors.join(' & '), [r.publisher, r.year, r.pages && r.pages + ' pp'].filter(Boolean).join(' · '),
      r.forSale ? 'in print' : '', 'Source: ' + r.sources.join(', ')].filter(Boolean).join('\n');
    $('record').querySelector('.m').style.whiteSpace = 'pre-line';
    if (!$('format').value) $('format').value = suggestedFormat(r.physicalFormat);
    status('');
  }
  await checkOwned();
  update();
  $('details').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- copies already owned (reads books.csv when the token can) ----------

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function checkOwned() {
  $('notice').textContent = '';
  const s = settings();
  if (!s.owner || !s.token || !s.books) return;
  try {
    if (!owned) {
      const { text } = await new GitHub(s.owner, s.token).getText(s.books, 'books.csv');
      if (!text) return;
      const [header, ...rows] = parseCsv(text);
      owned = rows.filter((r) => r.length > 3).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] || ''])));
    }
    const title = (record?.fullTitle || $('hTitle').value).split(':')[0].trim().toLowerCase();
    const surname = ((record?.authors || [])[0] || $('hAuthor').value).trim().split(' ').pop().toLowerCase();
    const isbn = isbnTo13(record?.isbn || $('isbn').value);
    const copies = owned.filter((b) => (isbn && isbnTo13(b.ISBN) === isbn) ||
      (title && b.Title.split(':')[0].trim().toLowerCase() === title && surname && b.Author.toLowerCase().includes(surname)));
    if (copies.length) {
      $('notice').textContent = `You already have ${copies.length}:\n` + copies.slice(0, 3)
        .map((c) => [c.Edition, c.Printing, c.Format, c.Condition.split('|')[0].trim(), c.Value].filter(Boolean).join(' · ')).join('\n');
    }
  } catch { /* token can't read the book repo: no notice, nothing else changes */ }
}

// ---------- verdict (free sources only: scripted floors or your own copy's value) ----------

function money(s) { const m = /\$\s*([\d,]+(?:\.\d+)?)/.exec(s || ''); return m ? parseFloat(m[1].replace(/,/g, '')) : null; }

function showVerdict() {
  const price = parseFloat(($('price').value || '').replace(/[$,\s]/g, ''));
  const draft = buildDraft(record, input());
  const value = money(draft.book.Value);
  const ownCopy = $('notice').textContent.match(/\$\d[\d,]*/);
  let text = '';
  if (value != null) {
    text = isNaN(price) ? `About $${value} (${draft.valueBasis}).`
      : price <= value * 0.5 ? `Bargain: $${price} vs about $${value}.`
      : price <= value * 0.9 ? `Good price: $${price} vs about $${value}.`
      : price <= value * 1.2 ? `Fair: $${price} vs about $${value}.` : `High: $${price} vs about $${value}.`;
  } else if (ownCopy && !isNaN(price)) {
    text = `Your copy is valued at ${ownCopy[0]}; this one is $${price}.`;
  } else if (!isNaN(price)) {
    text = 'No free value for this copy here; the PC can research it once it is queued.';
  }
  $('verdict').textContent = text;
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
  const id = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  const item = {
    Id: id, Captured: localStamp(), Device: 'web', Status: 'captured',
    Book: draft.book, Sources: draft.sources, Notes: draft.notes,
    Photo: '', ValueBasis: draft.valueBasis, ValueWeak: draft.valueWeak, BatchId: '',
  };
  const gh = new GitHub(s.owner, s.token);
  $('queueBtn').disabled = true;
  try {
    if (photoBlob) {
      status('Uploading the photo…');
      await gh.putBytes(s.queue, `photos/${id}.jpg`, new Uint8Array(await photoBlob.arrayBuffer()), `Photo: ${draft.book.Title || id}`);
      item.Photo = `photos/${id}.jpg`;
    }
    status('Adding to the queue…');
    await gh.appendLine(s.queue, 'queue.jsonl', JSON.stringify(item), `Queued (web): ${draft.book.Title || id}`);
    status(`Queued: ${draft.book.Title}. Scan the next one.`, true);
    reset(true);
  } catch (e) {
    status(`Couldn't add it: ${e.message}`);
    $('queueBtn').disabled = false;
  }
}

function reset(keepStatus = false) {
  record = null; photoBlob = null;
  state.grade = ''; state.jacket = ''; state.flags.clear();
  for (const id of ['isbn', 'hTitle', 'hAuthor', 'notes', 'price', 'photo']) $(id).value = '';
  for (const id of ['format', 'jacketGrade', 'printing', 'edition']) $(id).selectedIndex = 0;
  $('signed').checked = false;
  [...document.querySelectorAll('.chips button')].forEach((b) => b.classList.toggle('on', b.dataset.v === '' && b.parentElement.id === 'jacket'));
  $('record').hidden = true; $('notice').textContent = ''; $('photoPreview').hidden = true; $('noIsbn').open = false;
  if (!keepStatus) status('');
  update();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- barcode ----------

let scanner = null, stream = null, scanning = false;

async function startScan() {
  $('reader').hidden = false; $('stopScan').hidden = false; $('scanBtn').hidden = true;
  const done = async (text) => { await stopScan(); const d = digits(text); if (/^97[89]\d{10}$/.test(d)) lookup(d); else status('That barcode is not an ISBN (it should start 978 or 979).'); };
  try {
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('ean_13')) {
      // Built-in detector (Chrome on Android): fast and light.
      const video = document.createElement('video'); video.setAttribute('playsinline', ''); video.muted = true;
      $('reader').replaceChildren(video);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      const det = new BarcodeDetector({ formats: ['ean_13'] });
      scanning = true;
      const tick = async () => {
        if (!scanning) return;
        const codes = await det.detect(video).catch(() => []);
        const hit = codes.find((c) => /^97[89]/.test(c.rawValue));
        if (hit) done(hit.rawValue); else requestAnimationFrame(tick);
      };
      tick();
    } else {
      // iPhone Safari: the html5-qrcode library.
      if (!window.Html5Qrcode) throw new Error('The barcode reader did not load - check the connection, or type the ISBN.');
      scanner = new Html5Qrcode('reader', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13], verbose: false });
      await scanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.9, 340), height: Math.min(h * 0.45, 160) }) },
        (text) => { if (/^97[89]/.test(text)) done(text); }, () => {});
    }
    status('Point the camera at the barcode on the back cover.');
  } catch (e) {
    await stopScan();
    status(e.name === 'NotAllowedError' ? 'Camera permission was refused - allow it in the browser settings, or type the ISBN.' : `Camera: ${e.message}`);
  }
}

async function stopScan() {
  scanning = false;
  if (scanner) { try { await scanner.stop(); } catch { } scanner = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  $('reader').hidden = true; $('reader').replaceChildren(); $('stopScan').hidden = true; $('scanBtn').hidden = false;
}

// ---------- wire up ----------

fillOptions();
chipGroup('grades', (v) => { state.grade = v; });
chipGroup('jacket', (v) => { state.jacket = v; });
chipGroup('flags', (v, on) => { if (on) state.flags.add(v); else state.flags.delete(v); }, true);
for (const id of ['format', 'jacketGrade', 'printing', 'edition', 'signed']) $(id).addEventListener('change', update);
for (const id of ['notes', 'price', 'hTitle', 'hAuthor']) $(id).addEventListener('input', update);
$('hTitle').addEventListener('change', checkOwned);
$('lookupBtn').addEventListener('click', () => lookup($('isbn').value));
$('isbn').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup($('isbn').value); });
$('scanBtn').addEventListener('click', startScan);
$('stopScan').addEventListener('click', stopScan);
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
