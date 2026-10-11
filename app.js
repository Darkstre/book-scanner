// Book Scanner: a capture form for the desktop. Scan or type an ISBN (a free Open Library lookup confirms the book),
// add what only the owner can see (format, grade, jacket, printing, edition, photo), and append it to queue.jsonl in
// the owner's GitHub queue repo with Status "new". The Book Collection desktop program prepares new items (Google
// lookup, your other copies, genre, eBay value, floors, rarity) and completes them. No keys live in this page.
import { GRADES, FORMATS, EDITIONS, DETAILS, conditionBuild, buildDraft, isbnValid, suggestedFormat, digits } from './rules.js';
import { lookupIsbn } from './lookup.js';
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

function pileScan(text) {
  const d = digits(text);
  if (!/^97[89]\d{10}$/.test(d)) { beep(false); return; }
  const now = Date.now();
  if (d === pileLast && now - pileLastAt < 4000) return;   // still pointing at the same book
  pileLast = d; pileLastAt = now;
  beep(true);
  const s = settings();
  const id = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  const item = { Id: id, Captured: localStamp(), Device: 'web', Status: 'new',
    Book: { ISBN: d, Status: 'Own' }, Sources: { ISBN: 'owner', Status: 'owner' },
    Notes: ['Scanned in a pile: set format, condition and printing when you review it.'],
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
  beep(true);   // unlocks sound on iPhone (it must start from a tap)
  await startScan();
}

async function startScan() {
  $('reader').hidden = false; $('stopScan').hidden = false; $('scanBtn').hidden = true; $('pileBtn').hidden = true;
  const done = async (text) => {
    if (pile) { pileScan(text); return; }
    await stopScan();
    const d = digits(text);
    if (/^97[89]\d{10}$/.test(d)) lookup(d); else status('That barcode is not an ISBN (it should start 978 or 979).');
  };
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
        if (hit) await done(hit.rawValue);
        if (scanning) requestAnimationFrame(tick);
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
  if (scanner) { try { await scanner.stop(); } catch { /* already stopped */ } scanner = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  $('reader').hidden = true; $('reader').replaceChildren(); $('stopScan').hidden = true; $('scanBtn').hidden = false; $('pileBtn').hidden = false;
  if (pile) {
    pile = false; $('pileInfo').hidden = true;
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
$('lookupBtn').addEventListener('click', () => lookup($('isbn').value));
$('isbn').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup($('isbn').value); });
$('scanBtn').addEventListener('click', startScan);
$('pileBtn').addEventListener('click', startPile);
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
