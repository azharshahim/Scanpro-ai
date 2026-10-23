/* =============================================================================
 * ScanPro AI — noyau applicatif
 * Stockage IndexedDB, traitement d'image, OCR (Tesseract.js), PDF (jsPDF / pdf-lib)
 * Aucune donnée n'est envoyée à un serveur : tout reste dans le navigateur.
 * ========================================================================== */
'use strict';

/* ----------------------------------------------------------------- utils -- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtBytes(b) {
  if (!b && b !== 0) return '—';
  if (b < 1024) return b + ' o';
  if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' Ko';
  return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' Mo';
}
function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return "Aujourd'hui, " + hm;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Hier, ' + hm;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + hm;
}
function slugify(s) {
  return (s || 'scan').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'scan';
}
const plural = (n, s, p) => n + ' ' + (n > 1 ? p : s);

/* --------------------------------------------------------------- stockage -- */
const DB_NAME = 'scanpro-ai', DB_VER = 1;
const Store = {
  _db: null,
  _mem: { docs: new Map(), pages: new Map(), kv: new Map(), files: new Map() },
  _fallback: false,

  async open() {
    if (this._db) return this._db;
    try {
      this._db = await new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('pages')) {
            const ps = db.createObjectStore('pages', { keyPath: 'id' });
            ps.createIndex('docId', 'docId');
          }
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
        req.onblocked = () => rej(new Error('IndexedDB bloquée (autre onglet ouvert ?)'));
      });
      return this._db;
    } catch (e) {
      console.warn('[Store] IndexedDB indisponible, mode mémoire :', e);
      this._fallback = true;
      return null;
    }
  },
  async tx(storeName, mode = 'readonly') {
    const db = await this.open();
    if (!db) return null;
    return db.transaction(storeName, mode).objectStore(storeName);
  },
  async put(storeName, value) {
    const os = await this.tx(storeName, 'readwrite');
    if (!os) { this._mem[storeName].set(value[storeName === 'kv' ? 'k' : 'id'], value); return; }
    await new Promise((res, rej) => {
      const r = os.put(value);
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
  },
  async get(storeName, key) {
    const os = await this.tx(storeName);
    if (!os) return this._mem[storeName].get(key);
    return new Promise((res, rej) => {
      const r = os.get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  },
  async del(storeName, key) {
    const os = await this.tx(storeName, 'readwrite');
    if (!os) { this._mem[storeName].delete(key); return; }
    return new Promise((res, rej) => {
      const r = os.delete(key);
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
  },
  async all(storeName) {
    const os = await this.tx(storeName);
    if (!os) return Array.from(this._mem[storeName].values());
    return new Promise((res, rej) => {
      const r = os.getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
  },
  async byDoc(docId) {
    const os = await this.tx('pages');
    if (!os) return Array.from(this._mem.pages.values()).filter(p => p.docId === docId);
    return new Promise((res, rej) => {
      const r = os.index('docId').getAll(docId);
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
  },
  async clearAll() {
    for (const s of ['docs', 'pages', 'kv', 'files']) {
      const os = await this.tx(s, 'readwrite');
      if (os) await new Promise(res => { const r = os.clear(); r.onsuccess = r.onerror = () => res(); });
      else this._mem[s].clear();
    }
  },
  get isFallback() { return this._fallback; }
};

/* ---------------------------------------------------------- image helpers -- */
const ImageOps = {
  load(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Image illisible ou format non pris en charge"));
      im.src = src;
    });
  },
  /** Redimensionne un fichier image en dataURL JPEG (limite de mémoire). */
  async fileToDataUrl(file, maxPx = 2400, quality = 0.9) {
    if (!file) throw new Error('Fichier manquant');
    if (file.type && !/^image\//.test(file.type)) throw new Error('Format non pris en charge : ' + (file.type || 'inconnu'));
    let src;
    try { src = URL.createObjectURL(file); } catch (e) { src = await this.fileToDataUrlLegacy(file); }
    const img = await this.load(src);
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(src);
    return { dataUrl: c.toDataURL('image/jpeg', quality), w: c.width, h: c.height };
  },
  fileToDataUrlLegacy(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('Lecture du fichier impossible'));
      fr.readAsDataURL(file);
    });
  },
  /** Rendu d'une page du brouillon / document : crop + rotation + filtre. */
  async render(page, { maxPx = 2400, quality = 0.9 } = {}) {
    const img = await this.load(page.src);
    const crop = page.crop || { x: 0, y: 0, w: 1, h: 1 };
    const sx = clamp(crop.x, 0, 1) * img.naturalWidth;
    const sy = clamp(crop.y, 0, 1) * img.naturalHeight;
    const sw = Math.max(2, clamp(crop.w, 0.02, 1) * img.naturalWidth);
    const sh = Math.max(2, clamp(crop.h, 0.02, 1) * img.naturalHeight);
    const rot = ((Math.round((page.rotate || 0) / 90) * 90) % 360 + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const scale = Math.min(1, maxPx / Math.max(sw, sh));
    const cw = Math.max(1, Math.round(sw * scale));
    const ch = Math.max(1, Math.round(sh * scale));
    const c = document.createElement('canvas');
    c.width = swap ? ch : cw;
    c.height = swap ? cw : ch;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(img, sx, sy, sw, sh, -cw / 2, -ch / 2, cw, ch);
    ctx.restore();
    const f = page.filter || 'none';
    if (f !== 'none' && f !== 'original') this.filter(c, f);
    return c;
  },
  dataUrl(canvas, quality = 0.9) { return canvas.toDataURL('image/jpeg', quality); },

  /* ---------- filtres pixel ---------- */
  filter(canvas, mode) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const W = canvas.width, H = canvas.height;
    const id = ctx.getImageData(0, 0, W, H);
    const d = id.data;
    const n = W * H;
    const gray = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      gray[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    }
    if (mode === 'gray') {
      for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = gray[j]; d[i] = d[i + 1] = d[i + 2] = v; }
    } else if (mode === 'color') {
      // auto-niveaux par canal (2 % / 98 %)
      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      for (let i = 0; i < d.length; i += 4) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; }
      const lo = [], hi = [];
      for (let k = 0; k < 3; k++) {
        let acc = 0, l = 0, h = 255;
        const lim = n * 0.02;
        for (; l < 256; l++) { acc += hist[k][l]; if (acc > lim) break; }
        acc = 0;
        for (h = 255; h > 0; h--) { acc += hist[k][h]; if (acc > lim) break; }
        lo[k] = l; hi[k] = h;
      }
      for (let i = 0; i < d.length; i += 4) {
        d[i]     = clamp((d[i] - lo[0]) * 255 / Math.max(1, hi[0] - lo[0]), 0, 255);
        d[i + 1] = clamp((d[i + 1] - lo[1]) * 255 / Math.max(1, hi[1] - lo[1]), 0, 255);
        d[i + 2] = clamp((d[i + 2] - lo[2]) * 255 / Math.max(1, hi[2] - lo[2]), 0, 255);
      }
      this._sharpen(d, W, H, 0.35);
    } else if (mode === 'doc') {
      // niveaux + contraste doux sur niveaux de gris, rendu "photocopie propre"
      const hist = new Uint32Array(256);
      for (let j = 0; j < n; j++) hist[gray[j]]++;
      let acc = 0, lo = 0, hi = 255; const lim = n * 0.03;
      for (; lo < 256; lo++) { acc += hist[lo]; if (acc > lim) break; }
      acc = 0;
      for (hi = 255; hi > 0; hi--) { acc += hist[hi]; if (acc > lim) break; }
      const span = Math.max(1, hi - lo);
      for (let j = 0, i = 0; j < n; j++, i += 4) {
        let v = (gray[j] - lo) * 255 / span;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        v = 255 * Math.pow(v / 255, 1.28);           // courbe : blancs plus blancs
        v = clamp(v, 0, 255);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      this._sharpen(d, W, H, 0.55);
    } else if (mode === 'bw') {
      // seuillage adaptatif (moyenne locale via image intégrale)
      const integ = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        let rowSum = 0;
        for (let x = 0; x < W; x++) {
          rowSum += gray[y * W + x];
          integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + rowSum;
        }
      }
      const r = Math.max(6, Math.round(Math.min(W, H) * 0.045));
      const C = 12;
      for (let y = 0; y < H; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
        for (let x = 0; x < W; x++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
          const area = (x1 - x0 + 1) * (y1 - y0 + 1);
          const sum = integ[(y1 + 1) * (W + 1) + (x1 + 1)] - integ[y0 * (W + 1) + (x1 + 1)]
                    - integ[(y1 + 1) * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
          const mean = sum / area;
          const i = (y * W + x) * 4;
          const v = gray[y * W + x] < mean - C ? 0 : 255;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
    }
    ctx.putImageData(id, 0, 0);
  },
  _sharpen(d, W, H, amount) {
    const src = new Uint8ClampedArray(d.length);
    src.set(d);
    const k = amount;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const p = i + c;
          const center = src[p] * (1 + 4 * k);
          const around = (src[p - 4] + src[p + 4] + src[p - W * 4] + src[p + W * 4]) * k;
          d[p] = clamp(center - around, 0, 255);
        }
      }
    }
  },
  /** Redimensionne un dataURL en vignette carrée (pour les listes). */
  async thumb(src, w = 140, h = 180) {
    try {
      const img = await this.load(src);
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
  }
};

/* -------------------------------------------------------------------- OCR -- */
/* Certains hébergeurs (aperçus GitHub, githack, etc.) bloquent les gros fichiers
   binaires. On sonde les fichiers locaux puis on bascule, si besoin, sur le CDN
   jsDelivr du dépôt public. En local (http://localhost) rien ne change. */
const CDN_VENDOR = 'https://cdn.jsdelivr.net/gh/azharshahim/Scanpro-ai@main/vendor/';
const Assets = {
  _base: null,
  localBase() { return new URL('vendor/', location.href).href; },
  async base() {
    if (this._base) return this._base;
    const local = this.localBase();
    if (location.protocol === 'file:' || navigator.onLine === false) return (this._base = local);
    try {
      const r = await fetch(local + 'lang/fra.traineddata.gz', { method: 'HEAD', cache: 'no-store' });
      this._base = r.ok ? local : CDN_VENDOR;
    } catch (e) { this._base = CDN_VENDOR; }
    if (this._base === CDN_VENDOR) console.info('[Assets] fichiers locaux indisponibles → CDN jsDelivr');
    return this._base;
  },
  async ensureLoaded() {
    await this.base();
    const onCdn = this._base === CDN_VENDOR;
    const needed = [
      ['tesseract.min.js', () => OCR.available()],
      ['jspdf.umd.min.js', () => PDF.hasJsPDF()],
      ['pdf-lib.min.js', () => PDF.hasPdfLib()],
      ['pdf.min.js', () => typeof pdfjsLib !== 'undefined'],
      ['jszip.min.js', () => typeof JSZip !== 'undefined']
    ];
    for (const [file, ok] of needed) {
      if (ok()) continue;
      await new Promise((res) => {
        const sc = document.createElement('script');
        sc.src = (onCdn ? CDN_VENDOR : this.localBase()) + file;
        sc.onload = sc.onerror = () => res();
        document.head.appendChild(sc);
      });
    }
  }
};

const OCR = {
  worker: null, langs: null, busy: false,
  available: () => typeof Tesseract !== 'undefined',
  corePath() { return Assets._base || this.localCore(); },
  localCore() { return new URL('vendor/', location.href).href; },
  langPath() { return (Assets._base || this.localCore()) + 'lang'; },
  workerPath() { return (Assets._base || this.localCore()) + 'tesseract-worker.min.js'; },

  async ensure(langs = 'fra+eng', onProgress) {
    if (!this.available()) await Assets.ensureLoaded();
    if (!this.available()) throw new Error("Le moteur OCR n'a pas pu être chargé (tesseract.min.js absent ou bloqué).");
    if (this.worker && this.langs === langs) return this.worker;
    if (this.worker) { try { await this.worker.terminate(); } catch (e) {} this.worker = null; }
    onProgress && onProgress({ status: 'initialisation du moteur OCR', progress: 0.02 });
    this.worker = await Tesseract.createWorker(langs, 1, {
      workerPath: this.workerPath(),
      corePath: this.corePath(),
      langPath: this.langPath(),
      workerBlobURL: false,
      logger: (m) => onProgress && onProgress(m),
      errorHandler: (e) => console.warn('[OCR]', e)
    });
    try {
      await this.worker.setParameters({ preserve_interword_spaces: '1' });
    } catch (e) { /* non bloquant */ }
    this.langs = langs;
    return this.worker;
  },
  /** '@@' : moteur OCR indisponible, message clair côté UI. */
  async run(dataUrl, langs, onProgress) {
    const w = await this.ensure(langs, onProgress);
    const { data } = await w.recognize(dataUrl);
    const text = (data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text, confidence: Math.round(data.confidence || 0), words: (data.words || []).length, lines: (data.lines || []).length };
  },
  async terminate() { if (this.worker) { try { await this.worker.terminate(); } catch (e) {} this.worker = null; this.langs = null; } }
};

/* -------------------------------------------------------------------- PDF -- */
const PDF = {
  hasJsPDF: () => !!(window.jspdf && window.jspdf.jsPDF),
  hasPdfLib: () => typeof window.PDFLib !== 'undefined',

  /** Construit un PDF A4 à partir des pages (image par page). */
  async build(pages, { name = 'scan', quality = 0.88, maxPx = 2400, onProgress } = {}) {
    if (!this.hasJsPDF()) await Assets.ensureLoaded();
    if (!this.hasJsPDF()) throw new Error('La bibliothèque PDF (jsPDF) est indisponible.');
    if (!pages.length) throw new Error('Aucune page à exporter.');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true, orientation: 'portrait' });
    const PW = 210, PH = 297, M = 8;
    for (let i = 0; i < pages.length; i++) {
      onProgress && onProgress((i) / pages.length, `Mise en page ${i + 1}/${pages.length}`);
      const canvas = await ImageOps.render(pages[i], { maxPx, quality: 0.95 });
      const data = canvas.toDataURL('image/jpeg', quality);
      const availW = PW - M * 2, availH = PH - M * 2;
      const ratio = canvas.width / canvas.height;
      let w = availW, h = w / ratio;
      if (h > availH) { h = availH; w = h * ratio; }
      if (i > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(data, 'JPEG', (PW - w) / 2, (PH - h) / 2, w, h, 'p' + i, 'FAST');
    }
    onProgress && onProgress(1, 'Finalisation');
    return { blob: pdf.output('blob'), base64: null };
  },

  /** Fusionne plusieurs PDF (octets) en un seul. */
  async merge(files, { name = 'fusion' } = {}) {
    if (!this.hasPdfLib()) await Assets.ensureLoaded();
    if (!this.hasPdfLib()) throw new Error('La bibliothèque pdf-lib est indisponible.');
    const { PDFDocument } = window.PDFLib;
    const out = await PDFDocument.create();
    let added = 0;
    for (const f of files) {
      const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
      let src;
      try { src = await PDFDocument.load(bytes, { ignoreEncryption: true }); }
      catch (e) { throw new Error('PDF illisible ou protégé : ' + (f.name || 'fichier')); }
      const idx = await out.copyPages(src, src.getPageIndices());
      idx.forEach(p => { out.addPage(p); added++; });
    }
    if (!added) throw new Error('Aucune page PDF trouvée.');
    out.setTitle(name);
    out.setProducer('ScanPro AI');
    const bytes = await out.save();
    return { blob: new Blob([bytes], { type: 'application/pdf' }), pageCount: added };
  },

  /** Lit un PDF (nb de pages) et rend la 1re page en vignette. */
  async inspect(file) {
    if (typeof pdfjsLib === 'undefined') await Assets.ensureLoaded();
    if (typeof pdfjsLib === 'undefined') return { pageCount: 0, thumb: null };
    try {
      const buf = await file.arrayBuffer();
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href;
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      let thumb = null;
      const p = await doc.getPage(1);
      const vp = p.getViewport({ scale: 1 });
      const scale = 320 / Math.max(vp.width, vp.height);
      const v = p.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(v.width); c.height = Math.round(v.height);
      await p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
      thumb = c.toDataURL('image/jpeg', 0.75);
      return { pageCount: doc.numPages, thumb };
    } catch (e) {
      console.warn('[PDF] inspect', e);
      return { pageCount: 0, thumb: null, error: e.message };
    }
  }
};

/* ---------------------------------------------------------- file helpers -- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function shareFile(blob, filename, title = 'ScanPro AI') {
  if (!navigator.share) throw new Error("Le partage natif n'est pas disponible sur ce navigateur.");
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title, text: title });
    return 'shared';
  }
  throw new Error("Ce navigateur ne peut pas partager ce type de fichier. Utilisez « Télécharger ».");
}
function pickFiles({ accept = 'image/*', multiple = true, capture = null } = {}) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    if (capture) inp.capture = capture;
    inp.style.position = 'fixed'; inp.style.left = '-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []);
      inp.remove();
      res(files);
    }, { once: true });
    // si l'utilisateur annule, on nettoie au prochain focus
    window.addEventListener('focus', () => setTimeout(() => { if (document.body.contains(inp)) inp.remove(); }, 1500), { once: true });
    inp.click();
  });
}

/* ----------------------------------------------------------- stockage info -- */
async function storageInfo() {
  let usage = null, quota = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage || 0; quota = est.quota || 0;
    }
  } catch (e) {}
  return { usage, quota, fallback: Store.isFallback };
}
