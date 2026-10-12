// Reads the ISBN printed on a cover ("ISBN 0-380-71922-3") from the camera, in the page: for mass market paperbacks
// whose barcode is a newsstand (price) code, and books with no barcode. Uses Tesseract.js, loaded only the first time
// it's needed (a few MB, then cached by the browser). Only the band inside the guide box is read, as a block of text
// limited to ISBN characters (tested on real covers: a single-line read trips over the barcode bars); frames alternate
// plain grey and high-contrast. A result must pass the check digit and be read the same twice in a row.
import { isbnFromPrintedText } from './rules.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('The text reader did not load - check the connection.'));
    document.head.append(s);
  });
}

function worker(onStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      onStatus('Loading the text reader (first time only)…');
      await loadScript(TESSERACT);
      const w = await window.Tesseract.createWorker('eng', 1, {
        logger: (m) => { if (m.status === 'loading language traineddata' && m.progress < 1) onStatus(`Loading the text reader… ${Math.round(m.progress * 100)}%`); },
      });
      await w.setParameters({ tessedit_char_whitelist: '0123456789Xx-ISBN: ', tessedit_pageseg_mode: '6' });
      return w;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** The guide band, as a share of the video frame (centred). */
const BAND = { x: 0.06, w: 0.88, h: 0.2 };

/** The band, about 1700 px wide, grey; with contrast = black and white (Otsu threshold). What the reader sees. */
function band(video, contrast) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const sx = vw * BAND.x, sw = vw * BAND.w, sh = vh * BAND.h, sy = (vh - sh) / 2;
  const scale = Math.max(1, Math.min(3, 1700 / sw));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), p = img.data, hist = new Array(256).fill(0);
  for (let i = 0; i < p.length; i += 4) { const y = Math.round(0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]); p[i] = y; hist[y]++; }
  let t = -1;
  if (contrast) {
    const total = p.length / 4; let sum = 0, sB = 0, wB = 0, best = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += i * hist[i];
      const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2; if (v > best) { best = v; t = i; }
    }
  }
  for (let i = 0; i < p.length; i += 4) { const y = t >= 0 ? (p[i] > t ? 255 : 0) : p[i]; p[i] = p[i + 1] = p[i + 2] = y; }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Reads frames from `video` until the same ISBN is read twice within a few frames, or `isCancelled()` turns true.
 * Resolves with the ISBN (as printed, hyphenated) or null when cancelled.
 */
export async function readPrintedIsbn(video, onStatus, isCancelled) {
  const w = await worker(onStatus);
  onStatus('Fit the "ISBN …" line inside the box and hold still.');
  const recent = [];   // the last few reads; the same ISBN twice among them confirms it
  let n = 0;
  while (!isCancelled()) {
    const c = band(video, n++ % 2 === 1);
    if (!c) { await new Promise((r) => setTimeout(r, 200)); continue; }
    const { data } = await w.recognize(c);
    if (isCancelled()) return null;
    const found = isbnFromPrintedText(data.text);
    if (found && recent.includes(found)) return found;
    recent.push(found || ''); if (recent.length > 3) recent.shift();
    if (found) onStatus(`Read ${found} - hold still to confirm…`);
  }
  return null;
}

/** For tests: recognize one image or canvas (no camera). */
export async function readPrintedIsbnFromImage(source, onStatus = () => {}) {
  const w = await worker(onStatus);
  const { data } = await w.recognize(source);
  return { text: data.text, isbn: isbnFromPrintedText(data.text) };
}
