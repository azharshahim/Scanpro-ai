/* =============================================================================
 * ScanPro AI — état global, dépôt de documents, UI shell (toasts, feuilles)
 * ========================================================================== */
'use strict';

/* ------------------------------------------------------------- préférences -- */
const Settings = {
  k: 'scanpro.settings.v1',
  defaults: { ocrLangs: 'fra+eng', quality: 'high', defaultFilter: 'doc', autoOcr: false, autoDetect: true, seenOnboarding: false, theme: 'light' },
  data: null,
  load() {
    try { this.data = Object.assign({}, this.defaults, JSON.parse(localStorage.getItem(this.k) || '{}')); }
    catch (e) { this.data = Object.assign({}, this.defaults); }
    return this.data;
  },
  get(key) { if (!this.data) this.load(); return this.data[key]; },
  set(key, val) {
    if (!this.data) this.load();
    this.data[key] = val;
    try { localStorage.setItem(this.k, JSON.stringify(this.data)); } catch (e) {}
  }
};

/* ------------------------------------------------------------------- état -- */
const App = {
  route: 'home',
  param: null,
  docs: [],            // métadonnées
  search: '',
  docFilter: 'all', docSort: 'date-desc', selectionMode: false, selectedDocs: new Set(),
  draft: null,         // {docId?, name, pages:[{id,src,crop,rotate,filter}], active, cropMode, cropRect}
  doc: null,           // document ouvert
  docPages: [],
  detailTab: 'preview',
  detailPage: 0,
  camera: { stream: null, facing: 'environment', torch: false },
  ocrText: {},
  ready: false
};

/* ------------------------------------------------------- toasts / overlay -- */
function toast(msg, type = '', ms = 2600) {
  const host = $('#toasts');
  const icons = { ok: 'i-check', err: 'i-alert' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<svg class="ico sm"><use href="#${icons[type] || 'i-info'}"/></svg><span>${escapeHtml(msg)}</span>`;
  host.appendChild(el);
  while (host.children.length > 2) host.firstElementChild.remove();
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
  return el;
}
const busyBar = (on) => $('#progress').classList.toggle('on', !!on);

function openSheet({ title = '', sub = '', body = '', actions = [], onMount = null, full = false }) {
  closeSheet();
  const root = $('#modalRoot');
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title || 'Dialogue')}">
      <div class="grab"></div>
      ${title ? `<h3>${escapeHtml(title)}</h3>` : ''}
      ${sub ? `<p class="sub">${sub}</p>` : ''}
      <div class="sheet-body">${body}</div>
      ${actions.length ? `<div class="sheet-actions">
        ${actions.map(a => `<button class="btn ${a.cls || 'ghost'}" ${a.act ? `data-act="${a.act}"` : ''}
          ${a.close !== false ? 'data-close="1"' : ''}>${a.label}</button>`).join('')}
      </div>` : ''}
    </div>`;
  root.appendChild(back);
  back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
  back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  if (onMount) onMount(back.querySelector('.sheet'));
  return back.querySelector('.sheet');
}
function closeSheet() { const r = $('#modalRoot'); if (r) r.innerHTML = ''; }

function confirmSheet({ title, sub, okLabel = 'Confirmer', danger = false, onOk }) {
  openSheet({
    title, sub,
    actions: [
      { label: 'Annuler', cls: 'ghost' },
      { label: okLabel, cls: danger ? 'danger' : 'primary', act: 'confirm-ok', close: true }
    ],
    onMount: (sheet) => {
      const b = $('[data-act="confirm-ok"]', sheet);
      b.addEventListener('click', () => setTimeout(() => onOk && onOk(), 0), { once: true });
    }
  });
}
function promptSheet({ title, label = 'Nom', value = '', sub = '', okLabel = 'Enregistrer', onOk }) {
  const s = openSheet({
    title, sub,
    body: `<div class="field"><label for="__p">${escapeHtml(label)}</label>
      <input id="__p" value="${escapeHtml(value)}" autocomplete="off" enterkeyhint="done"></div>`,
    actions: [{ label: 'Annuler', cls: 'ghost' }, { label: okLabel, cls: 'primary', act: 'prompt-ok', close: true }],
    onMount: (sheet) => {
      const inp = $('#__p', sheet);
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
      const go = () => { const v = inp.value.trim(); if (v) onOk && onOk(v); };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); closeSheet(); } });
      $('[data-act="prompt-ok"]', sheet).addEventListener('click', () => setTimeout(go, 0), { once: true });
    }
  });
  return s;
}

/* ------------------------------------------------------------ dépôt docs -- */
const Repo = {
  async list() {
    const docs = await Store.all('docs');
    return docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  async create({ name = 'Document', pages = [], file = null, thumb = null, source = 'scan' }) {
    const now = Date.now();
    const doc = {
      id: uid('doc'), name, createdAt: now, updatedAt: now,
      pageCount: pages.length, thumb: thumb || (pages[0] ? pages[0].thumb : null),
      text: '', ocr: { status: pages.length ? 'none' : 'none', at: null, confidence: 0 },
      bytes: 0, source, modified: false, kind: file ? 'pdf' : 'scan', favorite: false, category: '', tags: [], history: [{ at: now, action: 'Création' }]
    };
    let bytes = 0;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const rec = {
        id: p.id || uid('pg'), docId: doc.id, index: i, src: p.src,
        crop: p.crop || { x: 0, y: 0, w: 1, h: 1 }, rotate: p.rotate || 0,
        quad: p.quad || null, deskew: p.deskew || 0,
        filter: p.filter || 'none', adj: p.adj || { b: 1, c: 1 }, cleanup: p.cleanup || null, eraser: p.eraser || [], thumb: p.thumb || null, text: p.text || '', ocrConf: p.ocrConf || 0, ocrWords: p.ocrWords || null, ocrLines: p.ocrLines || null
      };
      bytes += (rec.src ? rec.src.length * 0.75 : 0) + (rec.thumb ? rec.thumb.length * 0.75 : 0);
      await Store.put('pages', rec);
    }
    if (file) {
      await Store.put('files', { id: doc.id, name: name + '.pdf', blob: file });
      bytes += file.size || 0;
      doc.fileId = doc.id;
    }
    doc.bytes = Math.round(bytes);
    await Store.put('docs', doc);
    App.docs = await this.list();
    return doc;
  },
  async pages(docId) {
    const ps = await Store.byDoc(docId);
    return ps.sort((a, b) => a.index - b.index);
  },
  async doc(id) { return Store.get('docs', id); },
  async update(doc) {
    doc.updatedAt = Date.now();
    const ps = await this.pages(doc.id);
    // les PDF importés conservent le nombre de pages lu par pdf.js
    if (doc.kind !== 'pdf' || ps.length) doc.pageCount = ps.length;
    await Store.put('docs', doc);
    App.docs = await this.list();
    return doc;
  },
  async replacePages(docId, pages) {
    const old = await this.pages(docId);
    for (const p of old) await Store.del('pages', p.id);
    let bytes = 0;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const rec = {
        id: p.id || uid('pg'), docId, index: i, src: p.src, crop: p.crop || { x: 0, y: 0, w: 1, h: 1 },
        rotate: p.rotate || 0, quad: p.quad || null, deskew: p.deskew || 0,
        filter: p.filter || 'none', adj: p.adj || { b: 1, c: 1 }, cleanup: p.cleanup || null, eraser: p.eraser || [], thumb: p.thumb || null,
        text: p.text || '', ocrConf: p.ocrConf || 0, ocrWords: p.ocrWords || null, ocrLines: p.ocrLines || null
      };
      bytes += (rec.src || '').length * 0.75 + (rec.thumb || '').length * 0.75;
      await Store.put('pages', rec);
    }
    return Math.round(bytes);
  },
  async file(docId) {
    const f = await Store.get('files', docId);
    return f ? f.blob : null;
  },
  async remove(docId) {
    const ps = await this.pages(docId);
    for (const p of ps) await Store.del('pages', p.id);
    await Store.del('files', docId);
    await Store.del('docs', docId);
    App.docs = await this.list();
  },
  async totalBytes() {
    const docs = await Store.all('docs');
    return docs.reduce((s, d) => s + (d.bytes || 0), 0);
  }
};

/* --------------------------------------------------- OCR : exécution + UI -- */
function ocrOverlay() {
  const sheet = openSheet({
    title: 'Reconnaissance de texte',
    sub: 'Analyse locale dans votre navigateur — aucune image n\'est envoyée sur Internet.',
    body: `<div class="row" style="gap:12px;align-items:center;margin:4px 0 10px">
        <span class="spinner dark" id="ocrSpin"></span>
        <div class="grow"><b id="ocrStatus" style="font-size:13.5px">Préparation…</b>
        <div class="ocr-bar"><i id="ocrBar"></i></div>
        <div class="tiny muted" id="ocrPct">0 %</div></div>
      </div>
      <div class="banner info"><svg class="ico sm"><use href="#i-info"/></svg>
        <span>Le premier lancement télécharge les données de langue (français + anglais) puis les met en cache.</span></div>`,
    actions: [{ label: 'Annuler', cls: 'ghost', act: 'ocr-cancel' }]
  });
  return {
    sheet,
    status(t) { const e = $('#ocrStatus'); if (e) e.textContent = t; },
    progress(p, t) {
      const pct = Math.round(clamp(p, 0, 1) * 100);
      const bar = $('#ocrBar'); if (bar) bar.style.width = pct + '%';
      const lab = $('#ocrPct'); if (lab) lab.textContent = pct + ' %';
      if (t && $('#ocrStatus')) $('#ocrStatus').textContent = t;
    },
    close: closeSheet
  };
}

/** OCR d'une liste de pages (objets {src,crop,rotate,filter}) → [{text, confidence}] */
async function runOcr(pages, langs = Settings.get('ocrLangs')) {
  if (location.protocol === 'file:') {
    // fetch() est interdit sur file:// : les modèles de langue ne peuvent pas être lus.
    const msg = "L'OCR nécessite que ScanPro AI soit servie en http(s) (la prévisualisation live ou " +
      "un petit serveur local comme « python3 -m http.server 8080 »). Ouvert en double-clic (file://), " +
      "le navigateur interdit la lecture des modèles de langue. Le reste de l'app (import, recadrage, PDF) fonctionne.";
    toast(msg, 'err', 9000);
    const s = openSheet({
      title: 'OCR indisponible en mode fichier',
      sub: "Cette page a été ouverte directement depuis le disque (file://).",
      body: `<div class="banner warn">${ICON('i-alert', 'ico sm')}<span>${escapeHtml(msg)}</span></div>
        <p class="small muted">Solutions : ouvrez l'application via la prévisualisation de l'environnement
        (HTTPS) ou lancez un serveur local dans le dossier du projet.</p>
        <div class="ai-out" style="font-size:12.5px">cd scanpro\npython3 -m http.server 8080\n# puis http://localhost:8080/</div>`,
      actions: [{ label: 'Compris', cls: 'primary' }]
    });
    return null;
  }
  const ui = ocrOverlay();
  let cancelled = false;
  const cancelBtn = $('[data-act="ocr-cancel"]', ui.sheet);
  if (cancelBtn) cancelBtn.addEventListener('click', () => { cancelled = true; OCR.terminate(); });
  const results = [];
  try {
    const label = ({ 'fra+eng':'français + anglais', fra:'français', eng:'anglais', spa:'espagnol', deu:'allemand', ita:'italien', por:'portugais', 'fra+eng+spa':'français + anglais + espagnol', 'fra+eng+deu':'français + anglais + allemand' })[langs] || langs;
    ui.status('Chargement du moteur OCR (' + label + ')…');
    await OCR.ensure(langs, (m) => {
      if (cancelled) return;
      if (m && m.status) {
        const map = {
          'loading tesseract core': 'Chargement du moteur…',
          'initializing tesseract': 'Initialisation…',
          'loading language traineddata': 'Téléchargement de la langue (' + label + ')…',
          'loaded language traineddata': 'Langue prête',
          'initializing api': 'Initialisation de l\'API…',
          'recognizing text': 'Reconnaissance du texte…'
        };
        ui.status(map[m.status] || m.status);
        ui.progress(m.progress || 0);
      }
    });
    for (let i = 0; i < pages.length; i++) {
      if (cancelled) throw new Error('annulé');
      ui.status(`Reconnaissance — page ${i + 1}/${pages.length}`);
      ui.progress(0);
      let dataUrl;
      if (typeof pages[i] === 'string') dataUrl = pages[i];
      else {
        const c = await ImageOps.render(pages[i], { maxPx: 2000, quality: 0.95 });
        dataUrl = c.toDataURL('image/jpeg', 0.95);
      }
      const res = await OCR.run(dataUrl, langs, (m) => {
        if (cancelled || !m) return;
        if (m.status === 'recognizing text') {
          ui.progress((i + (m.progress || 0)) / pages.length);
          ui.status(`Reconnaissance — page ${i + 1}/${pages.length}`);
        }
      });
      results.push(res);
      ui.progress((i + 1) / pages.length);
    }
    ui.close();
    return results;
  } catch (err) {
    ui.close();
    if (String(err && err.message).includes('annulé')) { toast('OCR annulé'); return null; }
    console.error('[OCR]', err);
    toast("L'OCR n'a pas pu être effectué : " + (err.message || 'erreur inconnue'), 'err', 6000);
    throw err;
  }
}

/* Point d'entrée de débogage (console) — n'expose aucune donnée à l'extérieur. */
window.ScanPro = {
  get App() { return App; }, get Repo() { return Repo; }, get Settings() { return Settings; },
  get AI() { return AI; }, get Acc() { return Acc; }, get Precompta() { return Precompta; }, get Actions() { return Actions; }, Store, PDF, ImageOps,
  version: '2.15.1'
};

/* ------------------------------------------------------- exécution d'acte -- */
const Actions = {};   // rempli par views.js / ui.js

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const name = el.dataset.act;
  if (name === 'ocr-cancel' || name === 'confirm-ok' || name === 'prompt-ok') return; // gérés localement
  const fn = Actions[name];
  if (typeof fn === 'function') {
    e.preventDefault();
    fn(el, e);
  }
});

/* ------------------------------------------------------------- impression -- */
function printPdf(blob) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) { toast('PDF ouvert : utilisez le menu du navigateur → Imprimer', 'ok', 5000); return; }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.onload = () => {
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch (err) { toast("Impression directe bloquée — utilisez « Télécharger » puis imprimer.", 'err', 5000); }
    setTimeout(() => f.remove(), 60000);
  };
  f.src = url;
}

/* ------------------------------------------------------------- utilitaires -- */
async function copyText(text) {
  if (!text) { toast('Rien à copier', 'err'); return false; }
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); }
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('Texte copié', 'ok');
    return true;
  } catch (e) { toast('Copie impossible sur ce navigateur', 'err'); return false; }
}

async function shareText(text, title = 'Texte reconnu — ScanPro AI') {
  if (!text) { toast('Aucun texte à partager', 'err'); return; }
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(text);
}

function pdfName(doc, suffix = '') {
  return slugify(doc.name || 'document') + (suffix ? '-' + suffix : '') + '.pdf';
}

/** Génère un PDF pour un document stocké. Retourne {blob, build:boolean} */
async function buildDocPdf(doc, opts = {}) {
  const noMods = !doc.modified;
  if (doc.fileId && noMods) {
    const blob = await Repo.file(doc.id);
    if (blob) return { blob, original: true };
  }
  const pages = await Repo.pages(doc.id);
  if (!pages.length) throw new Error('Ce document ne contient aucune page.');
  const quality = Settings.get('quality') === 'high' ? 0.92 : 0.8;
  const maxPx = Settings.get('quality') === 'high' ? 2400 : 1600;
  const { blob } = await PDF.build(pages, {
    name: doc.name, quality, maxPx,
    onProgress: (p, label) => opts.onProgress && opts.onProgress(p, label)
  });
  return { blob, original: false };
}
