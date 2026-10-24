/* =============================================================================
 * ScanPro AI — interactions : navigation, capture caméra, éditeur de pages,
 * actions documents, OCR, export PDF, assistant local.
 * ========================================================================== */
'use strict';

/* ------------------------------------------------------------ navigation -- */
const NAV = { home: 'Accueil', docs: 'Documents', tools: 'Outils', settings: 'Paramètres' };

async function go(route, param = null, { push = true, focusSearch = false } = {}) {
  if (App.route === 'capture') closeCamera();
  App.route = route; App.param = param;
  App._focusSearch = focusSearch;
  if (route === 'detail') {
    App.doc = await Repo.doc(param);
    App.docPages = App.doc ? await Repo.pages(param) : [];
    App.detailPage = 0;
    App.detailTab = App.detailTab || 'preview';
  }
  $('#bottomNav').style.display = (route === 'capture' || App.route === 'editor') ? 'none' : 'flex';
  if (push) {
    try { history.pushState({ route, param }, '', '#' + route + (param ? '/' + param : '')); } catch (e) {}
  }
  await render();
}

window.addEventListener('popstate', (e) => {
  const st = e.state || { route: 'home' };
  if (App.route === 'capture' || $('#editorScreen')) { closeCamera(); $('#captureRoot').innerHTML = ''; App.draft = null; }
  go(st.route || 'home', st.param || null, { push: false });
});

/* ================================================================ CAMÉRA == */
function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function openCamera() {
  const root = $('#captureRoot');
  App.draft = App.draft || { name: 'Scan ' + new Date().toLocaleDateString('fr-FR'), pages: [], active: 0 };
  App.route = 'capture';
  $('#bottomNav').style.display = 'none';
  root.innerHTML = `
  <div class="capture" id="cameraScreen">
    <div class="cam-stage">
      <video id="camVideo" playsinline autoplay muted></video>
      <div class="cam-topbar">
        <button class="icon-btn" data-act="camera-close" aria-label="Fermer">${ICON('i-x')}</button>
        <span class="spacer"></span>
        <span class="pill" id="camPagesPill">${plural(App.draft.pages.length, 'page', 'pages')}</span>
        <button class="icon-btn" data-act="camera-torch" aria-label="Torche" id="torchBtn">${ICON('i-sun')}</button>
      </div>
      <div class="cam-overlay" id="camOverlay">
        <div class="cam-frame"><i></i><i></i><i></i><i></i></div>
      </div>
      <button class="burst-toggle" id="burstToggle" data-act="burst-toggle" aria-pressed="false">
        ${ICON('i-burst', 'ico sm')} <span>Rafale</span>
      </button>
      <div class="cam-hint" id="camHint">Placez le document dans le cadre — restez stable</div>
    </div>
    <div class="cam-bottom">
      <div id="camPages" class="cam-pages" style="display:none"></div>
      <div id="camError"></div>
      <div class="shutter-row">
        <button class="side-action" data-act="camera-import-gallery">
          <span class="sa-btn">${ICON('i-image', 'ico sm')}</span>Galerie
        </button>
        <button class="shutter" data-act="camera-shoot" aria-label="Prendre une photo"><i></i></button>
        <button class="side-action" data-act="camera-done">
          <span class="sa-btn">${ICON('i-check', 'ico sm')}</span>Terminer
        </button>
      </div>
    </div>
  </div>`;
  updateCamPages();
  await startStream();
}

async function startStream() {
  const video = $('#camVideo');
  const errBox = $('#camError');
  const overlay = $('#camOverlay');
  if (!cameraSupported()) {
    overlay.style.display = 'none';
    errBox.innerHTML = `<div class="cam-warn">${ICON('i-alert', 'ico sm')}
      <span>Ce navigateur ne permet pas l'accès direct à la caméra (API absente).
      Utilisez <b>Galerie</b> pour photographier via l'application Appareil photo, ou ouvrez l'app en HTTPS.</span></div>`;
    return;
  }
  if (!window.isSecureContext) {
    overlay.style.display = 'none';
    errBox.innerHTML = `<div class="cam-warn">${ICON('i-alert', 'ico sm')}
      <span><b>Contexte non sécurisé :</b> la caméra n'est autorisée qu'en <b>HTTPS</b> (ou localhost).
      Utilisez le bouton <b>Galerie</b> en attendant.</span></div>`;
    return;
  }
  try {
    const constraints = {
      audio: false,
      video: App.camera.facing === 'environment'
        ? { facingMode: { ideal: 'environment' }, width: { ideal: 2048 }, height: { ideal: 1536 } }
        : { facingMode: 'user', width: { ideal: 1280 } }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    App.camera.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    $('#torchBtn').style.display = caps.torch ? 'grid' : 'none';
    errBox.innerHTML = '';
    overlay.style.display = 'grid';
  } catch (err) {
    overlay.style.display = 'none';
    const map = {
      NotAllowedError: "L'accès à la caméra a été refusé. Autorisez la caméra dans les réglages du navigateur (icône cadenas → Autorisations), puis réessayez.",
      PermissionDeniedError: "L'accès à la caméra a été refusé par le système.",
      NotFoundError: 'Aucune caméra détectée sur cet appareil.',
      NotReadableError: "La caméra est déjà utilisée par une autre application.",
      OverconstrainedError: 'La caméra ne prend pas en charge la résolution demandée.'
    };
    errBox.innerHTML = `<div class="cam-warn">${ICON('i-alert', 'ico sm')}
      <span>${escapeHtml(map[err.name] || ('Caméra indisponible : ' + err.message))}<br>
      Vous pouvez importer une photo avec <b>Galerie</b>.</span></div>`;
  }
}

function closeCamera() {
  if (Burst.active) toggleBurst();
  clearInterval(Burst.timer); Burst.timer = null; Burst.active = false;
  if (App.camera.stream) {
    App.camera.stream.getTracks().forEach(t => t.stop());
    App.camera.stream = null;
  }
  const v = $('#camVideo'); if (v) v.srcObject = null;
  App.route = App.route === 'capture' ? 'home' : App.route;
  $('#bottomNav').style.display = 'flex';
}

function updateCamPages() {
  const box = $('#camPages'); if (!box) return;
  const pages = App.draft ? App.draft.pages : [];
  box.style.display = pages.length ? 'flex' : 'none';
  box.innerHTML = pages.map((p, i) =>
    `<div class="cam-page"><b>${i + 1}</b><img src="${p.thumb || p.src}" alt=""></div>`).join('');
  const pill = $('#camPagesPill');
  if (pill) pill.textContent = pages.length ? plural(pages.length, 'page', 'pages') : 'Aucune page';
  const hint = $('#camHint');
  if (hint) hint.textContent = pages.length
    ? plural(pages.length, 'page capturée', 'pages capturées') + ' — continuez ou appuyez sur Terminer'
    : 'Placez le document dans le cadre — restez stable';
}

/* ---------------------------------------------------------- mode rafale -- */
const Burst = { active: false, count: 0, timer: null, lastShot: 0, saved: 'none' };

function toggleBurst() {
  const btn = $('#burstToggle');
  if (!App.camera.stream) { toast('La caméra doit être active pour la rafale', 'err'); return; }
  Burst.active = !Burst.active;
  if (btn) {
    btn.classList.toggle('on', Burst.active);
    btn.setAttribute('aria-pressed', String(Burst.active));
    btn.querySelector('span').textContent = Burst.active ? 'Arrêter' : 'Rafale';
  }
  const hint = $('#camHint');
  if (Burst.active) {
    toast('Rafale : une photo toutes les 1,2 s — appuyez sur Arrêter', 'ok', 3000);
    const before = Settings.get('defaultFilter');
    Burst.saved = before;
    Settings.set('defaultFilter', before || 'doc');   // la rafale privilégie un rendu net
    Burst.count = 0;
    let busy = false;
    Burst.timer = setInterval(async () => {
      if (!Burst.active) return;
      if (busy) return;
      if (!App.camera.stream) { toggleBurst(); return; }
      busy = true;
      try {
        await capturePhoto({ quiet: true });
        Burst.count++;
        if (hint) hint.textContent = `Rafale en cours — ${plural(Burst.count, 'page capturée', 'pages capturées')}`;
        if (Burst.count >= 20) { toggestionBurstLimit(); }
      } finally { busy = false; }
    }, 1200);
  } else {
    clearInterval(Burst.timer); Burst.timer = null;
    Settings.set('defaultFilter', Burst.saved || 'doc');
    if (hint) hint.textContent = 'Placez le document dans le cadre — restez stable';
    if (Burst.count) toast(plural(Burst.count, 'page capturée en rafale', 'pages capturées en rafale'), 'ok');
    Burst.count = 0;
  }
}
function toggestionBurstLimit() {
  Burst.active = true;
  toggleBurst();
  toast('Limite de 20 pages atteinte — rafale arrêtée', 'err', 3000);
}

async function capturePhoto(opts = {}) {
  const video = $('#camVideo');
  if (!video || !video.videoWidth) {
    toast('La caméra n\'est pas encore prête', 'err');
    return;
  }
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', 0.92);
  const page = await addPageFromDataUrl(dataUrl, { detect: opts.detect !== false });
  if (page && page.detected && !opts.quiet) toast('Document détecté et redressé', 'ok', 1600);
  if (opts.quiet) return page;
  // flash visuel
  const app = $('#cameraScreen');
  if (app) {
    const fl = document.createElement('div');
    fl.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:70;opacity:.85;transition:opacity .35s';
    document.body.appendChild(fl);
    requestAnimationFrame(() => { fl.style.opacity = '0'; setTimeout(() => fl.remove(), 400); });
  }
  if (navigator.vibrate) navigator.vibrate(18);
}

async function addPageFromDataUrl(src, { detect = true, source = 'camera' } = {}) {
  const norm = await normalizeSource(src);
  const page = {
    id: uid('pg'), src: norm, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0,
    quad: null, deskew: 0, detected: false,
    filter: Settings.get('defaultFilter') || 'none', thumb: null, adj: { b: 1, c: 1 }
  };

  // V2 : détection automatique des contours du document
  if (detect && Settings.get('autoDetect') !== false) {
    try {
      const canvas = await ImageOps.render(page, { maxPx: 1200, skipQuad: true });
      const det = Vision.detectQuad(canvas);
      if (det && Vision.acceptQuad(det, source)) {
        page.quad = det.quad;
        page.detected = true;
        // redressement seulement si le gain d'alignement est net (évite de pivoter un document déjà droit)
        try {
          const warped = Vision.warp(canvas, det.quad, { maxPx: 900 });
          const est = Vision.deskewAngleDetailed(warped);
          page.deskew = (Math.abs(est.angle) >= 1 && est.improvement >= 0.15) ? est.angle : 0;
        } catch (e) { page.deskew = 0; }
      }
    } catch (e) { console.warn('[ScanPro] détection', e); }
  }
  page.thumb = await ImageOps.thumb(await ImageOps.render(page, { maxPx: 400, quality: 0.7 }).then(c => c.toDataURL('image/jpeg', 0.7)));
  App.draft.pages.push(page);
  App.draft.active = App.draft.pages.length - 1;
  updateCamPages();
  return page;
}
async function normalizeSource(src) {
  const img = await ImageOps.load(src);
  const maxPx = 2400;
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && src.length < 2.5e6) return src;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

async function importImagesToDraft(files) {
  if (!files || !files.length) return 0;
  let added = 0;
  for (const f of files) {
    try {
      const { dataUrl } = await ImageOps.fileToDataUrl(f, 2400, 0.9);
      await addPageFromDataUrl(dataUrl, { source: 'import' });
      added++;
    } catch (e) {
      toast(e.message || 'Import impossible', 'err');
    }
  }
  return added;
}

/* =============================================================== ÉDITEUR == */
function renderEditor() {
  const d = App.draft;
  if (!d) return;
  const p = d.pages[d.active] || null;
  const root = $('#captureRoot');
  $('#bottomNav').style.display = 'none';
  root.innerHTML = `
  <div id="editorScreen" style="position:fixed;inset:0;z-index:60;background:var(--bg);display:flex;
       flex-direction:column;max-width:600px;margin:0 auto;overflow:hidden">
    <header class="appbar plain" style="border-radius:0;padding-bottom:14px">
      <div class="appbar-row">
        <button class="icon-btn" data-act="editor-exit" aria-label="Fermer">${ICON('i-x')}</button>
        <div class="grow" style="min-width:0">
          <input id="draftName" value="${escapeHtml(d.name)}" aria-label="Nom du document"
            style="width:100%;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);
            color:#fff;border-radius:11px;min-height:38px;padding:0 11px;font-size:14px;font-weight:650">
          <div class="tiny" style="color:#A9BFDF;margin-top:5px">${plural(d.pages.length, 'page', 'pages')} · traitement local</div>
        </div>
        <button class="icon-btn" data-act="editor-save" aria-label="Enregistrer">${ICON('i-check')}</button>
      </div>
    </header>

    <div class="editor-wrap">
      <div class="editor-stage" id="editorStage">
        ${p ? `<div class="detect-badge ${p.quad ? 'on' : ''}">${p.quad ? '✓ Perspective corrigée' : 'Contours non détectés'}</div>` : ''}
        ${p ? `<div id="cropHost" style="position:relative;display:inline-block;line-height:0">
            <canvas id="editorCanvas"></canvas>
            <div id="cropLayer"><div id="cropRect">
              <i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i>
            </div></div>
          </div>`
        : `<div class="stage-empty">Aucune page pour le moment.<br>Ajoutez une photo pour commencer.</div>`}
      </div>
      <div class="crop-toolbar" id="cropToolbar" style="display:none">
        <button class="btn" data-act="crop-cancel">Annuler</button>
        <button class="btn" data-act="crop-full">Toute l'image</button>
        <button class="btn go" data-act="crop-apply">Valider le recadrage</button>
      </div>
    </div>

    <div style="flex:1;overflow:auto;background:var(--bg);padding-bottom:8px;display:flex;flex-direction:column">
      <div class="filters" id="filterRow">
        ${[['doc', 'Document', '#fff'], ['color', 'Couleur', '#F87171'], ['gray', 'Gris', '#9CA3AF'],
           ['bw', 'Noir & blanc', '#111827'], ['shadow', 'Anti-ombre', '#E5E7EB'],
           ['vivid', 'Vif', '#34D399'], ['none', 'Original', '#BFD3F6']]
          .map(([k, l, c]) => `<button class="chip sm ${(p && p.filter) === k ? 'on' : ''}"
            data-act="editor-filter" data-f="${k}"><span class="dot" style="background:${c}"></span>${l}</button>`).join('')}
      </div>
      <div class="tool-row">
        <button class="tool" data-act="editor-crop">${ICON('i-crop')}Recadrer</button>
        <button class="tool" data-act="editor-corners">${ICON('i-corners')}4 coins</button>
        <button class="tool" data-act="editor-rotate">${ICON('i-rotate')}Pivoter</button>
        <button class="tool" data-act="editor-deskew">${ICON('i-straighten')}Redresser</button>
        <button class="tool" data-act="editor-adjust">${ICON('i-sun')}Luminosité</button>
        <button class="tool" data-act="editor-ocr-zone">${ICON('i-zone')}Zone OCR</button>
        <button class="tool" data-act="editor-clean">${ICON('i-sparkles')}Nettoyage</button>
        <button class="tool" data-act="editor-modes">${ICON('i-folder')}Modes</button>
        <button class="tool" data-act="editor-find-dup">${ICON('i-copy')}Doublons</button>
        <button class="tool" data-act="editor-duplicate">${ICON('i-copy')}Dupliquer</button>
        <button class="tool" data-act="editor-delete-page">${ICON('i-trash')}Supprimer</button>
      </div>
      <div class="section-head" style="margin:12px 18px 0">
        <h2 style="font-size:13px">Pages</h2>
        <span class="tiny muted">Glissez pour défiler</span>
      </div>
      <div class="pages-strip" id="pagesStrip">
        ${d.pages.map((pg, i) => `
          <div class="page-thumb ${i === d.active ? 'on' : ''}" data-act="editor-select-page" data-i="${i}">
            <div class="pt-img"><img src="${pg.thumb || pg.src}" alt="Page ${i + 1}">
              ${d.pages.length > 1 ? `<button class="del" data-act="editor-remove-page" data-i="${i}"
                aria-label="Supprimer la page ${i + 1}">${ICON('i-x')}</button>` : ''}
            </div>
            <span>Page ${i + 1}</span>
          </div>`).join('')}
        <button class="add-page" data-act="editor-add-page" aria-label="Ajouter une page">${ICON('i-plus')}</button>
      </div>
      <div class="sticky-actions">
        <button class="btn ghost" data-act="editor-ocr">${ICON('i-text', 'ico sm')} Texte (OCR)</button>
        <button class="btn primary" data-act="editor-pdf">${ICON('i-pdf', 'ico sm')} Générer le PDF</button>
      </div>
    </div>
  </div>`;
  drawEditorCanvas();
  initPageReorder();
}

let editorRenderToken = 0;
async function drawEditorCanvas() {
  const d = App.draft;
  const canvas = $('#editorCanvas');
  if (!d || !canvas) return;
  const p = d.pages[d.active];
  if (!p) return;
  const token = ++editorRenderToken;
  const tmp = d.cropMode
    ? Object.assign({}, p, { crop: { x: 0, y: 0, w: 1, h: 1 } })
    : p;
  const c = await ImageOps.render(tmp, { maxPx: 1400, quality: 0.9 });
  if (token !== editorRenderToken) return;
  canvas.width = c.width; canvas.height = c.height;
  canvas.getContext('2d').drawImage(c, 0, 0);
  canvas.style.maxHeight = '38dvh';
  if (d.cropMode) mountCropUI();
}

/* ------------------------------------------------------------ recadrage -- */
function mountCropUI() {
  const d = App.draft;
  const layer = $('#cropLayer'), rectEl = $('#cropRect'), host = $('#cropHost');
  if (!layer || !rectEl || !host) return;
  layer.classList.add('on');
  layer.style.cssText = 'position:absolute;inset:0;touch-action:none;overflow:hidden';
  const r = d.cropRect || Object.assign({}, d.pages[d.active].crop);
  const paint = () => {
    rectEl.style.cssText = `position:absolute;left:${r.x * 100}%;top:${r.y * 100}%;
      width:${r.w * 100}%;height:${r.h * 100}%;border:2px solid #7FB2FF;
      box-shadow:0 0 0 9999px rgba(2,6,16,.55);box-sizing:border-box;cursor:move`;
    $$('#cropRect i').forEach(h => {
      const pos = h.dataset.h;
      h.style.cssText = `position:absolute;width:22px;height:22px;background:#fff;border:2px solid #2563EB;
        border-radius:6px;${pos.includes('n') ? 'top:-11px' : 'bottom:-11px'};
        ${pos.includes('w') ? 'left:-11px' : 'right:-11px'};cursor:${pos === 'nw' || pos === 'se' ? 'nwse-resize' : 'nesw-resize'}`;
    });
  };
  paint();
  const box = layer.getBoundingClientRect();
  let mode = null, start = null, base = null;
  const px = (v) => v / ((host.querySelector('canvas') || {}).clientWidth || box.width);
  const py = (v) => v / ((host.querySelector('canvas') || {}).clientHeight || box.height);

  layer.onpointerdown = (e) => {
    const cw = host.querySelector('canvas').clientWidth || box.width;
    const ch = host.querySelector('canvas').clientHeight || box.height;
    const rect = host.querySelector('canvas').getBoundingClientRect();
    mode = e.target.dataset.h || (e.target === rectEl ? 'move' : null);
    if (!mode) return;
    e.preventDefault();
    layer.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, cw, ch, rect };
    base = Object.assign({}, r);
  };
  layer.onpointermove = (e) => {
    if (!mode) return;
    const dx = (e.clientX - start.x) / start.cw;
    const dy = (e.clientY - start.y) / start.ch;
    const min = 0.06;
    if (mode === 'move') {
      r.x = clamp(base.x + dx, 0, 1 - r.w);
      r.y = clamp(base.y + dy, 0, 1 - r.h);
    } else {
      let x1 = base.x, y1 = base.y, x2 = base.x + base.w, y2 = base.y + base.h;
      if (mode.includes('w')) x1 = clamp(base.x + dx, 0, x2 - min);
      if (mode.includes('e')) x2 = clamp(base.x + base.w + dx, x1 + min, 1);
      if (mode.includes('n')) y1 = clamp(base.y + dy, 0, y2 - min);
      if (mode.includes('s')) y2 = clamp(base.y + base.h + dy, y1 + min, 1);
      r.x = x1; r.y = y1; r.w = x2 - x1; r.h = y2 - y1;
    }
    paint();
  };
  layer.onpointerup = () => { mode = null; };
  d.cropRect = r;
  $('#cropToolbar').style.display = 'flex';
  const cancel = () => { d.cropMode = false; delete d.cropRect; $('#cropToolbar').style.display = 'none';
    $('#cropLayer').classList.remove('on'); drawEditorCanvas(); };
  Actions['crop-cancel'] = cancel;
  Actions['crop-full'] = () => { d.cropRect = { x: 0, y: 0, w: 1, h: 1 }; paint(); };
  Actions['crop-apply'] = async () => {
    const pg = d.pages[d.active];
    pg.crop = Object.assign({}, d.cropRect);
    pg.thumb = await ImageOps.thumb(await ImageOps.render(pg, { maxPx: 400, quality: 0.7 }).then(c => c.toDataURL('image/jpeg', 0.7)));
    d.cropMode = false; d.cropRect = null;
    $('#cropToolbar').style.display = 'none';
    renderEditor();
  };
}

/* --------------------------------------- réorganisation des pages (V2.1) -- */
function initPageReorder() {
  const strip = $('#pagesStrip');
  if (!strip) return;
  let dragEl = null, dragIndex = -1, startX = 0, startY = 0, longPress = null, active = false;

  const thumbs = () => Array.from(strip.querySelectorAll('.page-thumb'));

  strip.addEventListener('pointerdown', (e) => {
    const th = e.target.closest('.page-thumb, .add-page');
    if (!th) return;
    if (e.target.closest('.del')) return;              // bouton supprimer
    startX = e.clientX; startY = e.clientY;
    if (!th.classList.contains('page-thumb')) return;  // pas de drag sur « + »
    longPress = setTimeout(() => {
      dragEl = th;
      dragIndex = +th.dataset.i;
      active = true;
      th.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(12);
      strip.classList.add('reordering');
    }, 260);
  });

  strip.addEventListener('pointermove', (e) => {
    if (!dragEl && longPress) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
        clearTimeout(longPress); longPress = null;      // simple défilement horizontal
      }
      return;
    }
    if (!dragEl) return;
    e.preventDefault();
    moveGhost(e.clientX);
  });

  /* Sur mobile, un appui long suivi d'un déplacement déclenche un pointercancel
     (le navigateur veut faire défiler). On suit donc aussi les événements touch,
     avec preventDefault pour conserver la main. */
  let touchDrag = false, touchIndex = -1;
  strip.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const th = e.target.closest('.page-thumb');
    if (!th || e.target.closest('.del')) return;
    touchIndex = +th.dataset.i;
  }, { passive: true });
  strip.addEventListener('touchmove', (e) => {
    if (!dragEl) return;
    if (e.cancelable) e.preventDefault();
    const t = e.touches[0];
    if (t && dragEl) moveGhost(t.clientX);
    touchDrag = true;
  }, { passive: false });
  strip.addEventListener('touchend', () => { if (dragEl) finish(); });

  const moveGhost = (clientX) => {
    const others = thumbs().filter(el => el !== dragEl);
    if (!others.length) return;
    const boxes = others.map(el => ({ el, r: el.getBoundingClientRect() })).sort((a, b) => a.r.left - b.r.left);
    let target = null;
    for (const b of boxes) if (clientX < b.r.left + b.r.width / 2) { target = b.el; break; }
    if (target) { if (dragEl.nextElementSibling !== target) strip.insertBefore(dragEl, target); }
    else {
      const last = boxes[boxes.length - 1].el;
      if (dragEl !== last.nextElementSibling && dragEl !== last) strip.insertBefore(dragEl, last.nextSibling);
    }
    const sr = strip.getBoundingClientRect();
    if (clientX > sr.right - 40) strip.scrollLeft += 12;
    else if (clientX < sr.left + 40) strip.scrollLeft -= 12;
  };

  const finish = () => {
    clearTimeout(longPress); longPress = null;
    if (!dragEl) { strip.classList.remove('reordering'); return; }
    dragEl.classList.remove('dragging');
    dragEl = null; active = false;
    strip.classList.remove('reordering');
    const order = thumbs().map(el => +el.dataset.i);
    const d = App.draft;
    if (!d) return;
    const reordered = order.map(i => d.pages[i]).filter(Boolean);
    const changed = order.some((v, i) => v !== i);
    d.pages = reordered;
    d.active = 0;
    if (changed) {
      toast('Ordre des pages mis à jour', 'ok', 1600);
      renderEditor();
    }
  };
  strip.addEventListener('pointerup', finish);
  // le navigateur peut annuler le pointeur (défilement) : on termine proprement,
  // la position du doigt restant suivie par les événements touch ci-dessous.
  strip.addEventListener('pointercancel', () => { if (dragEl) finish(); });
}

/* ------------------------------------------------ ajustement des 4 coins -- */
async function editorCorners() {
  const d = App.draft;
  const page = d.pages[d.active];
  if (!page) return;
  const canvas = await ImageOps.render(page, { maxPx: 1100, skipQuad: true });
  const stage = $('#editorStage');
  if (!stage) return;
  d.cropMode = false;
  $('#cropLayer')?.classList.remove('on');
  $('#cropToolbar').style.display = 'none';

  // quadrilatère de départ : détecté, sinon bords de l'image
  let q = page.quad ? JSON.parse(JSON.stringify(page.quad))
    : { tl: { x: 0.03, y: 0.03 }, tr: { x: 0.97, y: 0.03 }, br: { x: 0.97, y: 0.97 }, bl: { x: 0.03, y: 0.97 } };

  const host = document.createElement('div');
  host.id = 'cornerHost';
  host.style.cssText = 'position:relative;display:inline-block;line-height:0;max-width:100%';
  const frame = document.createElement('div');
  frame.style.cssText = 'position:relative;line-height:0;width:min(620px,100%);margin:0 auto';
  const cv = document.createElement('canvas');
  cv.width = canvas.width; cv.height = canvas.height;
  cv.style.cssText = 'width:100%;height:auto;max-height:none;border-radius:8px;display:block';
  cv.getContext('2d').drawImage(canvas, 0, 0);
  frame.appendChild(cv);
  host.style.display = 'block';
  host.style.width = '100%';
  host.appendChild(frame);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('fill', 'rgba(37,99,235,.18)');
  poly.setAttribute('stroke', '#3B82F6');
  poly.setAttribute('stroke-width', '0.7');
  svg.appendChild(poly);
  frame.appendChild(svg);

  const order = ['tl', 'tr', 'br', 'bl'];
  const handles = {};
  const paint = () => {
    poly.setAttribute('points', order.map(n => `${q[n].x * 100},${q[n].y * 100}`).join(' '));
    order.forEach(n => {
      handles[n].style.left = (q[n].x * 100) + '%';
      handles[n].style.top = (q[n].y * 100) + '%';
    });
  };
  order.forEach(n => {
    const h = document.createElement('div');
    h.className = 'corner-handle';
    h.style.transform = 'translate(-50%,-50%)';
    h.style.left = (q[n].x * 100) + '%';
    h.style.top = (q[n].y * 100) + '%';
    h.dataset.corner = n;
    h.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      h.setPointerCapture(ev.pointerId);
      h.classList.add('active');
      const rect = cv.getBoundingClientRect();
      const move = (e2) => {
        q[n] = {
          x: clamp((e2.clientX - rect.left) / rect.width, 0, 1),
          y: clamp((e2.clientY - rect.top) / rect.height, 0, 1)
        };
        paint();
      };
      const up = () => {
        h.classList.remove('active');
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
    });
    handles[n] = h;
    frame.appendChild(h);
  });
  paint();

  const bar = document.createElement('div');
  bar.className = 'crop-toolbar';
  bar.style.display = 'flex';
  bar.innerHTML = `
    <button class="btn" data-c="reset">Réinitialiser</button>
    <button class="btn" data-c="auto">Détecter</button>
    <button class="btn go" data-c="apply">Valider la perspective</button>`;
  host.appendChild(bar);

  stage.innerHTML = '';
  stage.appendChild(host);

  bar.querySelector('[data-c="reset"]').onclick = () => {
    q = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
    paint();
  };
  bar.querySelector('[data-c="auto"]').onclick = async () => {
    const det = Vision.detectQuad(canvas);
    if (det && Vision._quadValid(det.quad)) { q = det.quad; paint(); toast('Contours détectés', 'ok'); }
    else toast('Aucun contour détecté sur cette image', 'err');
  };
  bar.querySelector('[data-c="apply"]').onclick = async () => {
    const ordered = Vision._orderQuad({ tl: q.tl, tr: q.tr, br: q.br, bl: q.bl });
    if (Vision.quadArea(ordered) < 0.05) { toast('Zone trop petite — ajustez les coins', 'err'); return; }
    page.quad = ordered;
    page.detected = true;
    page.crop = { x: 0, y: 0, w: 1, h: 1 };
    try {
      const warped = Vision.warp(canvas, ordered, { maxPx: 900 });
      const est = Vision.deskewAngleDetailed(warped);
      page.deskew = (Math.abs(est.angle) >= 1 && est.improvement >= 0.15) ? est.angle : 0;
    } catch (e) {}
    page.thumb = await ImageOps.thumb(await ImageOps.render(page, { maxPx: 400, quality: 0.7 }).then(c => c.toDataURL('image/jpeg', 0.7)));
    toast('Perspective appliquée', 'ok');
    renderEditor();
  };
}

/* ------------------------------------------------------------ OCR de zone -- */
/**
 * Ouvre un sélecteur rectangulaire sur une image et lance l'OCR de la zone.
 * @param {{src:string,label?:string}} source image à analyser
 */
async function ocrZone(source) {
  if (!source || !source.src) return;
  const img = await ImageOps.load(source.src);
  const scale = Math.min(1, 620 / Math.max(img.naturalWidth, img.naturalHeight));
  const dispW = Math.round(img.naturalWidth * scale);
  const dispH = Math.round(img.naturalHeight * scale);

  const sheet = openSheet({
    title: 'OCR d\'une zone',
    sub: 'Dessinez un rectangle autour du texte à reconnaître.',
    body: `<div id="zoneWrap" style="position:relative;display:inline-block;max-width:100%;margin:2px auto 6px;
            border-radius:10px;overflow:hidden;background:#0B1B34;touch-action:none">
        <img id="zoneImg" src="${source.src}" style="width:${dispW}px;max-width:100%;display:block;user-select:none;-webkit-user-drag:none">
        <div id="zoneRect" style="position:absolute;border:2px solid #3B82F6;background:rgba(37,99,235,.15);
          box-shadow:0 0 0 9999px rgba(2,6,16,.45);display:none;pointer-events:none"></div>
      </div>
      <p class="tiny muted text-center" style="margin:0">Astuce : appuyez et glissez pour tracer la zone.</p>`,
    actions: [{ label: 'Annuler', cls: 'ghost' },
              { label: 'Lire la zone', cls: 'primary', act: 'zone-go' }]
  });

  const wrap = $('#zoneWrap', sheet);
  const rectEl = $('#zoneRect', sheet);
  let start = null, zone = null;   // zone en coordonnées pixels de l'image affichée

  const setRect = (z) => {
    zone = z;
    rectEl.style.display = 'block';
    rectEl.style.left = z.x + 'px'; rectEl.style.top = z.y + 'px';
    rectEl.style.width = z.w + 'px'; rectEl.style.height = z.h + 'px';
  };
  wrap.addEventListener('pointerdown', (e) => {
    const b = wrap.getBoundingClientRect();
    start = { x: clamp(e.clientX - b.left, 0, b.width), y: clamp(e.clientY - b.top, 0, b.height) };
    wrap.setPointerCapture(e.pointerId);
    setRect({ x: start.x, y: start.y, w: 0, h: 0 });
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!start) return;
    const b = wrap.getBoundingClientRect();
    const cx = clamp(e.clientX - b.left, 0, b.width), cy = clamp(e.clientY - b.top, 0, b.height);
    setRect({ x: Math.min(start.x, cx), y: Math.min(start.y, cy), w: Math.abs(cx - start.x), h: Math.abs(cy - start.y) });
  });
  wrap.addEventListener('pointerup', () => { start = null; });
  wrap.addEventListener('pointercancel', () => { start = null; });

  const goBtn = $('[data-act="zone-go"]', sheet);
  goBtn.addEventListener('click', async () => {
    if (!zone || zone.w < 12 || zone.h < 8) { toast('Tracez une zone plus grande', 'err'); return; }
    // conversion vers les coordonnées de l'image source
    const b = wrap.getBoundingClientRect();
    const ratio = img.naturalWidth / b.width;
    const crop = {
      x: (zone.x / b.width), y: (zone.y / b.height),
      w: (zone.w / b.width), h: (zone.h / b.height)
    };
    closeSheet();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, Math.round(img.naturalWidth * crop.w));
    canvas.height = Math.max(8, Math.round(img.naturalHeight * crop.h));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img,
      crop.x * img.naturalWidth, crop.y * img.naturalHeight,
      crop.w * img.naturalWidth, crop.h * img.naturalHeight,
      0, 0, canvas.width, canvas.height);
    const zoom = Math.min(3, Math.max(1, 1600 / Math.max(canvas.width, canvas.height)));
    let finalCanvas = canvas;
    if (zoom > 1) {
      finalCanvas = document.createElement('canvas');
      finalCanvas.width = Math.round(canvas.width * zoom);
      finalCanvas.height = Math.round(canvas.height * zoom);
      const c2 = finalCanvas.getContext('2d');
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(canvas, 0, 0, finalCanvas.width, finalCanvas.height);
    }
    let results;
    try { results = await runOcr([finalCanvas.toDataURL('image/jpeg', 0.96)]); }
    catch (e) { return; }
    if (!results) return;
    const txt = (results[0] && results[0].text) || '';
    const conf = (results[0] && results[0].confidence) || 0;
    showZoneResult(txt, conf, finalCanvas.toDataURL('image/jpeg', 0.8));
  });
}

function showZoneResult(txt, conf, thumbUrl) {
  const s = openSheet({
    title: txt ? 'Texte de la zone' : 'Aucun texte détecté',
    sub: txt ? `Confiance ${conf} % · ${txt.trim().split(/\s+/).filter(Boolean).length} mot(s)` : 'Essayez une zone plus large ou un meilleur contraste.',
    body: `${thumbUrl ? `<img src="${thumbUrl}" style="max-width:100%;border-radius:10px;border:1px solid var(--line);margin-bottom:10px">` : ''}
      <textarea class="textarea" id="zoneText" style="min-height:140px">${escapeHtml(txt)}</textarea>`,
    actions: [{ label: 'Fermer', cls: 'ghost' },
              { label: 'Copier', cls: 'soft', act: 'zone-copy' },
              { label: 'Ajouter au texte du document', cls: 'primary', act: 'zone-append' }]
  });
  const ta = $('#zoneText', s);
  $('[data-act="zone-copy"]', s).addEventListener('click', () => copyText(ta.value));
  $('[data-act="zone-append"]', s).addEventListener('click', async () => {
    const add = ta.value.trim();
    closeSheet();
    if (!add) return;
    if (App.doc) {
      App.doc.text = (App.doc.text ? App.doc.text.replace(/\s*$/, '') + '\n\n' : '') + add;
      App.doc.modified = true;
      if (!App.doc.ocr || App.doc.ocr.status !== 'done') {
        App.doc.ocr = { status: 'done', at: Date.now(), confidence: conf };
      }
      await Repo.update(App.doc);
      App.detailTab = 'text';
      await render();
      toast('Ajouté au texte du document', 'ok');
    } else if (App.draft) {
      App.draft.zoneText = (App.draft.zoneText ? App.draft.zoneText + '\n\n' : '') + add;
      toast('Texte conservé pour ce scan', 'ok');
    }
  });
}

/* --------------------------------------------------- redressement (deskew) -- */
async function editorDeskew() {
  const page = App.draft.pages[App.draft.active];
  if (!page) return;
  busyBar(true);
  try {
    const canvas = await ImageOps.render(page, { maxPx: 1200 });
    const angle = Vision.deskewAngle(canvas);
    busyBar(false);
    // même sans inclinaison détectée, l'utilisateur peut ajuster finement à la main
    const span = Math.max(3, Math.abs(angle) + 1);
    const s = openSheet({
      title: 'Redressement',
      sub: angle ? `Inclinaison détectée : ${angle > 0 ? '+' : ''}${angle}°` : 'Aucune inclinaison notable détectée — ajustez si besoin.',
      body: `<div class="field"><label>Correction appliquée : <b id="dkVal">${(-angle).toFixed(1)}°</b></label>
        <input id="dkRange" type="range" min="${(-span).toFixed(1)}" max="${span.toFixed(1)}"
          step="0.1" value="${(-angle).toFixed(1)}" style="min-height:32px"></div>
        <p class="tiny muted">Déplacez le curseur pour affiner, puis validez.</p>`,
      actions: [{ label: 'Annuler', cls: 'ghost' }, { label: 'Appliquer', cls: 'primary', act: 'dk-ok', close: true }]
    });
    const range = $('#dkRange', s);
    page.deskew = -angle;
    $('#dkVal', s).textContent = (-angle).toFixed(1) + '°';
    range.addEventListener('input', () => {
      page.deskew = -parseFloat(range.value);
      $('#dkVal', s).textContent = (-parseFloat(range.value)).toFixed(1) + '°';
      drawEditorCanvas();
    });
    $('[data-act="dk-ok"]', s)?.addEventListener('click', () => { closeSheet(); renderEditor(); });
    drawEditorCanvas();
  } catch (e) { busyBar(false); toast('Redressement impossible', 'err'); }
}

/* ------------------------------------------------- Studio Nettoyage V2.2 -- */
function cleanSettingsOf(p) {
  return JSON.parse(JSON.stringify({
    filter: p.filter || 'none', adj: p.adj || { b: 1, c: 1 }, cleanup: p.cleanup || null,
    eraser: p.eraser || [], rotate: p.rotate || 0, deskew: p.deskew || 0,
    crop: p.crop || { x: 0, y: 0, w: 1, h: 1 }, quad: p.quad || null
  }));
}
function applyCleanSettings(p, st) { Object.assign(p, JSON.parse(JSON.stringify(st))); }

async function openCleanStudio() {
  const d = App.draft; if (!d) return;
  const page = d.pages[d.active]; if (!page) return;
  let candidate = Object.assign({}, page, cleanSettingsOf(page));
  const undoStack = [], redoStack = [];
  const snap = () => JSON.stringify(cleanSettingsOf(candidate));
  const pushHistory = () => { undoStack.push(snap()); if (undoStack.length > 30) undoStack.shift(); redoStack.length = 0; };
  let eraserOn = false, drawing = null;

  const sheet = openSheet({
    title: 'Nettoyage magique',
    sub: 'Traitement local réel : il sera appliqué à l’image exportée en PDF. L’original reste conservé.',
    body: `
      <div class="clean-compare" id="cleanCompare">
        <canvas id="cleanAfter"></canvas><canvas id="cleanBefore"></canvas>
        <canvas id="cleanErase"></canvas>
        <span class="clean-label before">Avant</span><span class="clean-label after">Après</span>
      </div>
      <label class="tiny muted" style="display:block;margin-top:8px">Comparer avant / après
        <input id="cleanSlider" type="range" min="0" max="100" value="55" style="width:100%;min-height:34px"></label>
      <div class="row wrap" style="gap:7px;margin:8px 0">
        <button class="btn xs soft" id="cleanAuto">Amélioration automatique</button>
        <button class="btn xs primary" id="cleanMagic">Nettoyage magique</button>
        <button class="btn xs soft" id="cleanBW">Noir et blanc</button>
        <button class="btn xs ghost" id="cleanRestore">Restaurer l'original</button>
        <button class="btn xs soft" id="cleanWatermark">Atténuer le filigrane</button>
      </div>
      <div class="row wrap" style="gap:7px;margin:8px 0">
        <button class="btn xs ghost" id="cleanUndo">↩ Annuler</button>
        <button class="btn xs ghost" id="cleanRedo">↪ Rétablir</button>
        <button class="btn xs ghost" id="cleanEraseBtn">Gomme tactile</button>
        <button class="btn xs ghost" id="cleanZoom">Zoom 150 %</button>
      </div>
      <label class="tiny muted" style="display:block">Intensité du nettoyage <b id="cleanStrengthVal">${Math.round(((candidate.cleanup && candidate.cleanup.strength) || 0.7) * 100)} %</b>
        <input id="cleanStrength" type="range" min="10" max="100" value="${Math.round(((candidate.cleanup && candidate.cleanup.strength) || 0.7) * 100)}" style="width:100%;min-height:34px"></label>
      <button class="btn xs soft" id="cleanOcrCompare" style="margin-top:8px">Comparer l’OCR avant / après</button>
      <div id="cleanOcrOut" class="ai-out" style="display:none;margin-top:8px"></div>
      <div class="banner info" style="margin-top:8px">${ICON('i-info','ico sm')}<span>La gomme masque en blanc de petits éléments parasites. Elle ne reconstruit pas un texte masqué ou illisible.</span></div>`,
    actions: [{ label: 'Fermer', cls: 'ghost' }, { label: 'Appliquer à toutes les pages', cls: 'soft', act: 'clean-all', close: false },
              { label: 'Enregistrer une copie', cls: 'soft', act: 'clean-copy', close: true }, { label: 'Appliquer', cls: 'primary', act: 'clean-apply', close: true }],
    onMount: (sh) => { setTimeout(() => refresh(), 30); }
  });

  const before = $('#cleanBefore', sheet), after = $('#cleanAfter', sheet), erase = $('#cleanErase', sheet);
  const compare = $('#cleanCompare', sheet), slider = $('#cleanSlider', sheet);
  async function refresh() {
    if (!before || !document.body.contains(before)) return;
    const original = Object.assign({}, candidate, { filter: 'none', adj: { b: 1, c: 1 }, cleanup: null, eraser: [] });
    const [cb, ca] = await Promise.all([ImageOps.render(original, { maxPx: 1100 }), ImageOps.render(candidate, { maxPx: 1100 })]);
    for (const [el, src] of [[before, cb], [after, ca]]) { el.width = src.width; el.height = src.height; el.getContext('2d').drawImage(src, 0, 0); }
    erase.width = after.width; erase.height = after.height;
    updateClip();
  }
  function updateClip() { before.style.clipPath = `inset(0 ${100 - (+slider.value)}% 0 0)`; }
  slider.addEventListener('input', updateClip);
  const mutate = (fn) => { pushHistory(); fn(); refresh(); };
  $('#cleanAuto', sheet).addEventListener('click', () => mutate(() => { candidate.filter = 'doc'; candidate.cleanup = { enabled: true, strength: 0.45, denoise: true, sharpen: true, illumination: true }; }));
  $('#cleanMagic', sheet).addEventListener('click', () => mutate(() => { candidate.filter = 'doc'; candidate.cleanup = { enabled: true, strength: +($('#cleanStrength', sheet).value) / 100, denoise: true, sharpen: true, illumination: true }; }));
  $('#cleanBW', sheet).addEventListener('click', () => mutate(() => { candidate.filter = 'bw'; candidate.cleanup = { enabled: true, strength: 0.35, denoise: true, sharpen: true, illumination: true }; }));
  $('#cleanRestore', sheet).addEventListener('click', () => mutate(() => { candidate.filter = 'none'; candidate.adj = { b: 1, c: 1 }; candidate.cleanup = null; candidate.eraser = []; }));
  const wmBtn = $('#cleanWatermark', sheet); if (wmBtn) wmBtn.addEventListener('click', () => mutate(() => { candidate.filter = 'doc'; candidate.cleanup = { enabled: true, strength: +($('#cleanStrength', sheet).value) / 100, denoise: true, sharpen: true, illumination: true, watermark: true }; }));
  $('#cleanStrength', sheet).addEventListener('input', (e) => { $('#cleanStrengthVal', sheet).textContent = e.target.value + ' %'; if (candidate.cleanup) { candidate.cleanup.strength = e.target.value / 100; refresh(); } });
  $('#cleanUndo', sheet).addEventListener('click', () => { if (!undoStack.length) return toast('Rien à annuler'); redoStack.push(snap()); applyCleanSettings(candidate, JSON.parse(undoStack.pop())); refresh(); });
  $('#cleanRedo', sheet).addEventListener('click', () => { if (!redoStack.length) return toast('Rien à rétablir'); undoStack.push(snap()); applyCleanSettings(candidate, JSON.parse(redoStack.pop())); refresh(); });
  let zoomed = false;
  $('#cleanZoom', sheet).addEventListener('click', (e) => { zoomed = !zoomed; compare.style.width = zoomed ? '160%' : '100%'; e.target.textContent = zoomed ? 'Zoom 100 %' : 'Zoom 150 %'; });
  const eraseBtn = $('#cleanEraseBtn', sheet);
  eraseBtn.addEventListener('click', () => { eraserOn = !eraserOn; erase.style.pointerEvents = eraserOn ? 'auto' : 'none'; eraseBtn.classList.toggle('primary', eraserOn); toast(eraserOn ? 'Gomme active : touchez les éléments à masquer' : 'Gomme désactivée'); });
  const pos = (e) => { const r = erase.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
  erase.addEventListener('pointerdown', (e) => { if (!eraserOn) return; pushHistory(); drawing = { radius: 0.028, points: [pos(e)] }; erase.setPointerCapture(e.pointerId); });
  erase.addEventListener('pointermove', (e) => { if (!drawing) return; drawing.points.push(pos(e)); const preview = Object.assign({}, candidate, { eraser: [...(candidate.eraser || []), drawing] }); ImageOps.render(preview, { maxPx: 1100 }).then(c => { after.getContext('2d').drawImage(c, 0, 0); }); });
  erase.addEventListener('pointerup', () => { if (!drawing) return; candidate.eraser = [...(candidate.eraser || []), drawing]; drawing = null; refresh(); });

  $('#cleanOcrCompare', sheet).addEventListener('click', async () => {
    const out = $('#cleanOcrOut', sheet); out.style.display = 'block'; out.textContent = 'OCR en cours sur les deux versions…';
    try {
      const original = Object.assign({}, candidate, { filter: 'none', adj: { b: 1, c: 1 }, cleanup: null, eraser: [] });
      const [co, cc] = await Promise.all([ImageOps.render(original, { maxPx: 1600 }), ImageOps.render(candidate, { maxPx: 1600 })]);
      const results = await runOcr([co.toDataURL('image/jpeg', .95), cc.toDataURL('image/jpeg', .95)]);
      if (!results) { out.textContent = 'Comparaison annulée.'; return; }
      const words = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;
      out.innerHTML = `<b>Avant :</b> ${words(results[0].text)} mots · confiance ${results[0].confidence} %<br><b>Après nettoyage :</b> ${words(results[1].text)} mots · confiance ${results[1].confidence} %<br><span class="tiny muted">Comparaison mesurée sur cette page, pas une garantie générale.</span>`;
    } catch (e) { out.textContent = 'Comparaison OCR impossible : ' + e.message; }
  });
  $('[data-act="clean-apply"]', sheet).addEventListener('click', async () => {
    applyCleanSettings(page, cleanSettingsOf(candidate));
    page.thumb = await ImageOps.thumb(await ImageOps.render(page, { maxPx: 400 }).then(c => c.toDataURL('image/jpeg', 0.7)));
    closeSheet(); renderEditor(); toast('Nettoyage appliqué à la page (original conservé)', 'ok');
  });
  $('[data-act="clean-copy"]', sheet).addEventListener('click', async () => {
    const copy = Object.assign({}, page, cleanSettingsOf(candidate), { id: uid('pg') });
    copy.thumb = await ImageOps.thumb(await ImageOps.render(copy, { maxPx: 400 }).then(c => c.toDataURL('image/jpeg', 0.7)));
    d.pages.splice(d.active + 1, 0, copy); d.active++;
    closeSheet(); renderEditor(); toast('Copie nettoyée ajoutée après la page', 'ok');
  });
  $('[data-act="clean-all"]', sheet).addEventListener('click', () => {
    const st = cleanSettingsOf(candidate); d.pages.forEach(p => applyCleanSettings(p, st));
    toast('Traitement appliqué à ' + plural(d.pages.length, 'page', 'pages'), 'ok'); closeSheet(); renderEditor();
  });
}

/* -------------------------------------------------------------- éditeur -- */
async function editorSetFilter(f) {
  const d = App.draft, p = d.pages[d.active];
  p.filter = f;
  renderEditor();
}
async function editorRotate() {
  const d = App.draft, p = d.pages[d.active];
  p.rotate = ((p.rotate || 0) + 90) % 360;
  // le recadrage reste cohérent : on repart de l'image complète si rotation
  p.crop = { x: 0, y: 0, w: 1, h: 1 };
  p.thumb = await ImageOps.thumb(await ImageOps.render(p, { maxPx: 400, quality: 0.7 }).then(c => c.toDataURL('image/jpeg', 0.7)));
  renderEditor();
}
function editorAdjust() {
  const p = App.draft.pages[App.draft.active];
  p.adj = p.adj || { b: 1, c: 1 };
  const s = openSheet({
    title: 'Réglages de l\'image',
    sub: 'Ajustez la luminosité et le contraste, puis validez.',
    body: `
      <div class="field"><label>Luminosité <b id="bv">${Math.round((p.adj.b - 1) * 100)}</b></label>
        <input id="adjB" type="range" min="60" max="150" value="${Math.round(p.adj.b * 100)}" style="min-height:32px"></div>
      <div class="field"><label>Contraste <b id="cv">${Math.round((p.adj.c - 1) * 100)}</b></label>
        <input id="adjC" type="range" min="60" max="180" value="${Math.round(p.adj.c * 100)}" style="min-height:32px"></div>`,
    actions: [{ label: 'Réinitialiser', cls: 'ghost', act: 'adj-reset' },
              { label: 'Appliquer', cls: 'primary', act: 'adj-apply', close: true }]
  });
  const b = $('#adjB', s), c = $('#adjC', s);
  const upd = () => {
    $('#bv', s).textContent = b.value - 100;
    $('#cv', s).textContent = c.value - 100;
    p.adj = { b: b.value / 100, c: c.value / 100 };
    drawEditorCanvas();
  };
  b.addEventListener('input', upd); c.addEventListener('input', upd);
  $('[data-act="adj-reset"]', s).addEventListener('click', () => {
    p.adj = { b: 1, c: 1 }; b.value = 100; c.value = 100; upd();
  });
  $('[data-act="adj-apply"]', s).addEventListener('click', () => { closeSheet(); renderEditor(); });
}

async function editorAddPage() {
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length) return;
  const n = await importImagesToDraft(files);
  if (n) { renderEditor(); toast(plural(n, 'page ajoutée', 'pages ajoutées'), 'ok'); }
}

async function saveDraft({ silent = false } = {}) {
  const d = App.draft;
  if (!d || !d.pages.length) { toast('Ajoutez au moins une page', 'err'); return null; }
  d.name = ($('#draftName') && $('#draftName').value.trim()) || d.name || 'Document';
  // recalcule les vignettes à jour
  for (const p of d.pages) {
    if (!p.thumb) p.thumb = await ImageOps.thumb(await ImageOps.render(p, { maxPx: 400, quality: 0.7 }).then(c => c.toDataURL('image/jpeg', 0.7)));
  }
  let doc;
  if (d.docId) {
    doc = await Repo.doc(d.docId);
    doc.name = d.name;
    doc.modified = true;
    doc.thumb = d.pages[0].thumb;
    doc.bytes = await Repo.replacePages(d.docId, d.pages);
    doc.pageCount = d.pages.length;
    doc.ocr = { status: 'none', at: null, confidence: 0 };
    doc.text = '';
    await Repo.update(doc);
  } else {
    doc = await Repo.create({ name: d.name, pages: d.pages, source: 'scan' });
  }
  if (!silent) toast('Document enregistré dans « Mes documents »', 'ok');
  return doc;
}

async function editorExit() {
  const d = App.draft;
  if (d && d.pages.length) {
    confirmSheet({
      title: 'Quitter le scan ?',
      sub: 'Enregistrez votre travail pour retrouver les pages dans « Mes documents ».',
      okLabel: 'Enregistrer et quitter',
      onOk: async () => {
        await saveDraft({ silent: true });
        App.draft = null;
        $('#captureRoot').innerHTML = '';
        go('home');
        toast('Document enregistré', 'ok');
      }
    });
    const sheet = $('#modalRoot .sheet');
    if (sheet) {
      const cancel = document.createElement('button');
      cancel.className = 'btn danger wide';
      cancel.textContent = 'Abandonner le scan';
      cancel.addEventListener('click', () => {
        closeSheet();
        App.draft = null;
        $('#captureRoot').innerHTML = '';
        go('home');
      });
      sheet.querySelector('.sheet-actions').after(cancel);
    }
  } else {
    App.draft = null;
    $('#captureRoot').innerHTML = '';
    go('home');
  }
}

async function editorGeneratePdf({ save = true, download = true } = {}) {
  const d = App.draft;
  if (!d || !d.pages.length) { toast('Aucune page à exporter', 'err'); return null; }
  let doc = null;
  try {
    busyBar(true);
    const quality = Settings.get('quality') === 'high' ? 0.92 : 0.8;
    const maxPx = Settings.get('quality') === 'high' ? 2400 : 1600;
    d.name = ($('#draftName') && $('#draftName').value.trim()) || d.name;
    const { blob } = await PDF.build(d.pages, {
      name: d.name, quality, maxPx,
      onProgress: (p, label) => { const hint = $('#draftName'); if (hint && label) hint.setAttribute('aria-label', label); }
    });
    if (download) downloadBlob(blob, slugify(d.name) + '.pdf');
    if (save) doc = await saveDraft({ silent: true });
    busyBar(false);
    toast('PDF généré (' + plural(d.pages.length, 'page', 'pages') + ', ' + fmtBytes(blob.size) + ')', 'ok');
    App.draft = null;
    $('#captureRoot').innerHTML = '';
    if (doc) go('detail', doc.id);
    else go('home');
    return blob;
  } catch (err) {
    busyBar(false);
    console.error(err);
    toast('Génération PDF impossible : ' + (err.message || 'erreur'), 'err', 5000);
    return null;
  }
}

async function editorOcr() {
  const d = App.draft;
  if (!d || !d.pages.length) return;
  let results;
  try {
    results = await runOcr(d.pages);
  } catch (e) { return; }
  if (!results) return;
  const full = results.map((r, i) => `— Page ${i + 1} —\n${r.text}`).join('\n\n').trim();
  const avg = Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length);
  const s = openSheet({
    title: 'Texte reconnu',
    sub: `${plural(results.length, 'page analysée', 'pages analysées')} · confiance moyenne ${avg} %`,
    body: `<textarea class="textarea" id="draftOcrText" style="min-height:200px">${escapeHtml(full)}</textarea>
      <div class="btn-row mt10">
        <button class="btn ghost" data-act="draft-ocr-copy">${ICON('i-copy', 'ico sm')} Copier</button>
        <button class="btn ghost" data-act="draft-ocr-share">${ICON('i-share', 'ico sm')} Partager</button>
      </div>`,
    actions: [{ label: 'Fermer', cls: 'ghost' }, { label: 'Enregistrer le document', cls: 'primary', act: 'draft-ocr-save' }]
  });
  const ta = $('#draftOcrText', s);
  $('[data-act="draft-ocr-copy"]', s).addEventListener('click', () => copyText(ta.value));
  $('[data-act="draft-ocr-share"]', s).addEventListener('click', () => shareText(ta.value));
  $('[data-act="draft-ocr-save"]', s).addEventListener('click', async () => {
    const text = ta.value;
    closeSheet();
    const doc = await saveDraft({ silent: true });
    if (!doc) return;
    await Repo.update(Object.assign(doc, {
      text, ocr: { status: 'done', at: Date.now(), confidence: avg }
    }));
    App.draft = null;
    $('#captureRoot').innerHTML = '';
    toast('Document enregistré avec le texte', 'ok');
    App.detailTab = 'text';
    go('detail', doc.id);
  });
}

/* ------------------------------------------- partage Word / Excel / Texte -- */
async function makeXlsxBlob(doc) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible pour Excel');
  const esc = (x) => String(x ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inv = doc.text && /facture|total|tva/i.test(doc.text) ? AI.extractInvoice(doc.text) : null;
  let rows;
  if (inv) rows = [['Champ','Valeur'], ...Object.entries(inv).filter(([k])=>k!=='disclaimer').map(([k,v])=>[k,v])];
  else rows = [['Document', doc.name], ['Texte reconnu',''], ...String(doc.text||'').split('\n').map(l=>[l])];
  const sheet = rows.map((r,i)=>`<row r="${i+1}">${r.map((c,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`).join('')}</row>`).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.folder('_rels').file('.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.folder('xl').file('workbook.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Document" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.folder('xl').folder('_rels').file('workbook.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.folder('xl').folder('worksheets').file('sheet1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`);
  return zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
async function shareDocumentAs(docId, format) {
  const doc = await Repo.doc(docId); if (!doc) return;
  try {
    busyBar(true);
    let blob, filename;
    if (format === 'pdf') { const built = await buildDocPdf(doc); blob = built.blob; filename = pdfName(doc); }
    else {
      if (!doc.text || !doc.text.trim()) { busyBar(false); toast('Aucun texte OCR : lancez d’abord l’extraction du texte pour partager en Word, Excel ou Texte.', 'err', 6000); App.detailTab='text'; await render(); return; }
      if (format === 'docx') { blob = await makeDocxBlob(doc.text, doc.name); filename = slugify(doc.name)+'.docx'; }
      else if (format === 'xlsx') { blob = await makeXlsxBlob(doc); filename = slugify(doc.name)+'.xlsx'; }
      else { blob = new Blob([doc.text], {type:'text/plain;charset=utf-8'}); filename = slugify(doc.name)+'.txt'; }
    }
    busyBar(false);
    try { await shareFile(blob, filename, doc.name); toast('Partage ouvert : ' + filename, 'ok'); }
    catch (e) { downloadBlob(blob, filename); toast('Partage direct indisponible : fichier téléchargé ('+filename+')', 'ok', 5000); }
  } catch (e) { busyBar(false); toast('Partage impossible : ' + e.message, 'err', 6000); }
}
function openShareSheet(docId) {
  const doc = App.doc && App.doc.id===docId ? App.doc : App.docs.find(d=>d.id===docId);
  const s = openSheet({ title:'Partager le document', sub:'Choisissez le format. Word, Excel et Texte utilisent le texte OCR ; lancez l’OCR si nécessaire.', body:`<div class="sheet-list">
    <button data-share-fmt="pdf">${ICON('i-pdf')}<span class="grow">PDF</span></button>
    <button data-share-fmt="docx">${ICON('i-file')}<span class="grow">Word (.docx)</span></button>
    <button data-share-fmt="xlsx">${ICON('i-grid')}<span class="grow">Excel (.xlsx)</span></button>
    <button data-share-fmt="txt">${ICON('i-text')}<span class="grow">Texte (.txt)</span></button></div>`, actions:[{label:'Annuler',cls:'ghost'}] });
  $$('[data-share-fmt]', s).forEach(b=>b.addEventListener('click',()=>{ const f=b.dataset.shareFmt; closeSheet(); setTimeout(()=>shareDocumentAs(docId,f),30); }));
}

/* ====================================================== ACTIONS DOCUMENTS = */
async function openDocMenu(id) {
  const doc = App.docs.find(d => d.id === id) || await Repo.doc(id);
  if (!doc) return;
  const s = openSheet({
    title: doc.name,
    sub: `${plural(doc.pageCount, 'page', 'pages')} · ${fmtBytes(doc.bytes)} · ${doc.kind === 'pdf' ? 'PDF importé' : 'Scan'}`,
    body: `<div class="sheet-list">
      <button data-act="doc-open"><svg class="ico"><use href="#i-eye"/></svg>Ouvrir</button>
      <button data-act="doc-download"><svg class="ico"><use href="#i-download"/></svg>Télécharger le PDF</button>
      <button data-act="doc-share"><svg class="ico"><use href="#i-share"/></svg>Partager le PDF</button>
      <button data-act="doc-print-sheet"><svg class="ico"><use href="#i-printer"/></svg>Imprimer</button>
      <button data-act="doc-images"><svg class="ico"><use href="#i-image"/></svg>Exporter les images</button>
      <button data-act="doc-rename-sheet"><svg class="ico"><use href="#i-edit"/></svg>Renommer</button>
      <button data-act="doc-edit-sheet"><svg class="ico"><use href="#i-crop"/></svg>Modifier les pages</button>
      <button data-act="doc-ocr-sheet"><svg class="ico"><use href="#i-text"/></svg>${doc.ocr && doc.ocr.status === 'done' ? 'Relancer l\'OCR' : 'Extraire le texte (OCR)'}</button>
      <button class="danger" data-act="doc-delete-sheet"><svg class="ico"><use href="#i-trash"/></svg>Supprimer</button>
    </div>`
  });
  const bind = (act, fn) => $(`[data-act="${act}"]`, s).addEventListener('click', () => { closeSheet(); setTimeout(fn, 10); });
  bind('doc-open', () => { App.detailTab = 'preview'; go('detail', doc.id); });
  bind('doc-download', () => docDownloadPdf(doc.id));
  bind('doc-share', () => openShareSheet(doc.id));
  bind('doc-print-sheet', () => docPrint(doc.id));
  bind('doc-images', () => docExportImages(doc.id));
  bind('doc-rename-sheet', () => docRename(doc.id));
  bind('doc-edit-sheet', () => docEdit(doc.id));
  bind('doc-ocr-sheet', () => docRunOcr(doc.id));
  bind('doc-delete-sheet', () => docDelete(doc.id));
}

async function withPdf(docId) {
  const doc = await Repo.doc(docId);
  if (!doc) throw new Error('Document introuvable');
  busyBar(true);
  try {
    const { blob, original } = await buildDocPdf(doc);
    return { doc, blob, original };
  } finally { busyBar(false); }
}

async function docDownloadPdf(docId) {
  try {
    const { doc, blob } = await withPdf(docId);
    downloadBlob(blob, pdfName(doc));
    toast('PDF téléchargé (' + fmtBytes(blob.size) + ')', 'ok');
  } catch (e) { toast('Export impossible : ' + e.message, 'err', 5000); }
}
async function docSharePdf(docId) {
  try {
    const { doc, blob } = await withPdf(docId);
    await shareFile(blob, pdfName(doc), doc.name);
    toast('PDF partagé', 'ok');
  } catch (e) {
    if (String(e.name) === 'AbortError') return;
    toast(e.message + ' — utilisez « Télécharger ».', 'err', 5000);
  }
}
async function docPrint(docId) {
  try {
    const { blob } = await withPdf(docId);
    printPdf(blob);
  } catch (e) { toast('Impression impossible : ' + e.message, 'err', 5000); }
}
async function docExportImages(docId) {
  try {
    const doc = await Repo.doc(docId);
    const pages = await Repo.pages(docId);
    if (!pages.length) throw new Error('aucune page');
    busyBar(true);
    if (pages.length === 1) {
      const c = await ImageOps.render(pages[0], { maxPx: 2400 });
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
      downloadBlob(blob, slugify(doc.name) + '-page1.jpg');
    } else if (typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      for (let i = 0; i < pages.length; i++) {
        const c = await ImageOps.render(pages[i], { maxPx: 2400 });
        const data = c.toDataURL('image/jpeg', 0.92).split(',')[1];
        zip.file(`${slugify(doc.name)}-page${String(i + 1).padStart(2, '0')}.jpg`, data, { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, slugify(doc.name) + '-images.zip');
    } else {
      for (let i = 0; i < pages.length; i++) {
        const c = await ImageOps.render(pages[i], { maxPx: 2400 });
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
        downloadBlob(blob, `${slugify(doc.name)}-page${i + 1}.jpg`);
        await sleep(250);
      }
    }
    busyBar(false);
    toast(plural(pages.length, 'image exportée', 'images exportées') + (pages.length > 1 ? ' (ZIP)' : ''), 'ok');
  } catch (e) { busyBar(false); toast('Export images impossible : ' + e.message, 'err', 5000); }
}
async function docRename(docId) {
  const doc = await Repo.doc(docId);
  if (!doc) return;
  promptSheet({
    title: 'Renommer le document', label: 'Nom du fichier', value: doc.name,
    onOk: async (v) => {
      doc.name = v;
      await Repo.update(doc);
      if (App.route === 'detail' && App.param === docId) App.doc = doc;
      await render();
      toast('Document renommé', 'ok');
    }
  });
}
async function docDelete(docId) {
  const doc = await Repo.doc(docId);
  if (!doc) return;
  confirmSheet({
    title: 'Supprimer « ' + doc.name + ' » ?',
    sub: 'Cette action est définitive : les pages et le texte associé sont effacés du stockage local de cet appareil.',
    okLabel: 'Supprimer', danger: true,
    onOk: async () => {
      await Repo.remove(docId);
      toast('Document supprimé', 'ok');
      go('docs');
    }
  });
}
async function refreshPdfPageCount(docId) {
  try {
    const doc = await Repo.doc(docId);
    if (!doc || doc.kind !== 'pdf') return doc;
    const blob = await Repo.file(docId);
    if (!blob) return doc;
    const f = new File([blob], doc.name + '.pdf', { type: 'application/pdf' });
    const info = await PDF.inspect(f);
    if (info.pageCount) { doc.pageCount = info.pageCount; await Repo.update(doc); }
    return doc;
  } catch (e) { return null; }
}

async function docEdit(docId) {
  const doc = await Repo.doc(docId);
  const pages = await Repo.pages(docId);
  if (!doc) return;
  if (!pages.length) { toast('Ce PDF importé ne peut pas être modifié page par page', 'err', 4500); return; }
  App.draft = { docId, name: doc.name, pages: pages.map(p => Object.assign({}, p)), active: 0 };
  renderEditor();
}
async function docRunOcr(docId) {
  const doc = await Repo.doc(docId);
  const pages = await Repo.pages(docId);
  if (!doc) return;

  /* V2 — OCR d'un PDF importé : les pages sont rendues à la volée par pdf.js. */
  if (!pages.length && doc.fileId) {
    const blob = await Repo.file(docId);
    if (!blob) { toast('Fichier PDF introuvable', 'err'); return; }
    const file = new File([blob], (doc.name || 'document') + '.pdf', { type: 'application/pdf' });
    let rendered;
    try {
      busyBar(true);
      rendered = await PDF.renderPages(file, { maxPx: 2000 });
      busyBar(false);
    } catch (e) {
      busyBar(false);
      toast('Lecture du PDF impossible : ' + e.message, 'err', 5000);
      return;
    }
    // P3 (audit relevés) : couche texte NATIVE du PDF d'abord — texte exact et
    // positions réelles, sans OCR. L'OCR ne sert que pour les pages sans texte
    // exploitable (PDF scannés en image). Traitement toujours 100 % local.
    let native = null;
    try { native = await PDF.extractText(file); } catch (e) { native = null; }
    const nativePages = native ? native.map(pg => ((pg.text || '').replace(/\s/g, '').length >= 40 ? pg : null)) : [];
    let results;
    if (nativePages.some(Boolean)) {
      results = [];
      for (let i = 0; i < rendered.length; i++) {
        const np = nativePages[i];
        if (np) results.push({ text: np.text, confidence: 100, words: np.words.length, lines: 0, uncertain: [], wordBoxes: np.words, lineBoxes: [], source: 'texte natif PDF' });
        else {
          const one = await runOcr([{ src: rendered[i].canvas.toDataURL('image/jpeg', 0.95) }]).catch(() => null);
          results.push(one && one[0] ? one[0] : { text: '', confidence: 0, words: 0, lines: 0, uncertain: [], wordBoxes: [], lineBoxes: [] });
        }
      }
      doc.ocrSource = 'Texte natif du PDF (pages numériques) + OCR local (pages image)';
      toast('Texte natif du PDF utilisé — aucun OCR nécessaire pour les pages numériques', 'ok', 4500);
    } else {
      try { results = await runOcr(rendered.map(r => ({ src: r.canvas.toDataURL('image/jpeg', 0.95) }))); }
      catch (e) { return; }
      if (!results) return;
    }
    const text = results.map((r, i) => `— Page ${i + 1} —\n${r.text}`).join('\n\n').trim();
    const avg = Math.round(results.reduce((s, r) => s + r.confidence, 0) / Math.max(1, results.length));
    doc.text = text;
    doc.ocr = { status: text ? 'done' : 'empty', at: Date.now(), confidence: avg };
    doc.ocrUncertain = results.flatMap(r => r.uncertain || []);
    doc.ocrWordBoxes = results.map(r => r.wordBoxes || []);
    await Repo.update(doc);
    App.doc = doc; App.detailTab = 'text';
    await render();
    toast(text ? 'Extraction terminée · confiance ' + avg + ' %' : 'Aucun texte détecté', text ? 'ok' : 'err', 5000);
    return;
  }

  if (!pages.length) { toast('Aucune page à analyser', 'err'); return; }
  let results;
  try { results = await runOcr(pages); } catch (e) {
    doc.ocr = { status: 'failed', at: Date.now(), confidence: 0 };
    await Repo.update(doc);
    return;
  }
  if (!results) return;
  const text = results.map((r, i) => (pages.length > 1 ? `— Page ${i + 1} —\n` : '') + r.text).join('\n\n').trim();
  const avg = Math.round(results.reduce((s, r) => s + r.confidence, 0) / Math.max(1, results.length));
  doc.text = text;
  doc.ocr = { status: text ? 'done' : 'empty', at: Date.now(), confidence: avg };
  doc.ocrUncertain = results.flatMap(r => r.uncertain || []);
  await Repo.update(doc);
  for (let i = 0; i < pages.length; i++) {
    pages[i].text = results[i].text; pages[i].ocrConf = results[i].confidence; pages[i].ocrWords = results[i].wordBoxes || []; pages[i].ocrLines = results[i].lineBoxes || [];
    await Store.put('pages', pages[i]);
  }
  App.doc = doc; App.docPages = pages; App.detailTab = 'text';
  await render();
  if (text) toast('OCR terminé · ' + plural(text.split(/\s+/).filter(Boolean).length, 'mot', 'mots') + ' · confiance ' + avg + ' %', 'ok', 4500);
  else toast("OCR terminé mais aucun texte détecté. Essayez un meilleur éclairage ou le mode « Document ».", 'err', 6000);
}

/* ------------------------------------- conversion d'un PDF en pages éditables -- */
async function docToImages(docId) {
  const doc = await Repo.doc(docId);
  if (!doc) return;
  const blob = await Repo.file(docId);
  if (!blob) { toast('Ce document ne contient pas de PDF', 'err'); return; }
  const file = new File([blob], (doc.name || 'document') + '.pdf', { type: 'application/pdf' });
  let rendered;
  try {
    busyBar(true);
    rendered = await PDF.renderPages(file, { maxPx: 2400 });
    busyBar(false);
  } catch (e) { busyBar(false); toast('Conversion impossible : ' + e.message, 'err', 5000); return; }
  if (!rendered.length) return;
  confirmSheet({
    title: 'Convertir en pages modifiables ?',
    sub: `Les ${rendered.length} page(s) seront rendues en images et remplaceront le PDF importé. ` +
         `Vous pourrez alors recadrer, redresser, filtrer et exporter un nouveau PDF. L'original reste téléchargeable jusqu'à la conversion.`,
    okLabel: 'Convertir',
    onOk: async () => {
      busyBar(true);
      const pages = [];
      for (let i = 0; i < rendered.length; i++) {
        const src = rendered[i].canvas.toDataURL('image/jpeg', 0.92);
        const page = { id: uid('pg'), src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none' };
        page.thumb = await ImageOps.thumb(await ImageOps.render(page, { maxPx: 400, quality: 0.7 }).then(c => c.toDataURL('image/jpeg', 0.7)));
        pages.push(page);
      }
      const bytes = await Repo.replacePages(docId, pages);
      if (doc.fileId) await Store.del('files', docId);
      doc.fileId = null; doc.kind = 'scan'; doc.modified = true;
      doc.thumb = pages[0].thumb; doc.pageCount = pages.length; doc.bytes = bytes;
      await Repo.update(doc);
      busyBar(false);
      toast(plural(pages.length, 'page convertie', 'pages converties'), 'ok');
      App.doc = await Repo.doc(docId);
      App.docPages = await Repo.pages(docId);
      App.detailTab = 'preview';
      await render();
    }
  });
}

/* ------------------------------------------------- import / fusion PDF -- */
async function importImages() {
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length) return;
  App.draft = { name: 'Scan ' + new Date().toLocaleDateString('fr-FR'), pages: [], active: 0 };
  const n = await importImagesToDraft(files);
  if (!n) { App.draft = null; return; }
  if (n === 1) toast('Image importée — recadrez ou ajustez', 'ok');
  else toast(plural(n, 'image importée', 'images importées'), 'ok');
  renderEditor();
}

async function importPdf() {
  const files = await pickFiles({ accept: 'application/pdf,.pdf', multiple: false });
  if (!files.length) return;
  const f = files[0];
  if (f.size > 40 * 1024 * 1024) { toast('PDF trop volumineux (limite 40 Mo)', 'err'); return; }
  busyBar(true);
  const info = await PDF.inspect(f);
  busyBar(false);
  const name = f.name.replace(/\.pdf$/i, '') || 'PDF importé';
  const doc = await Repo.create({
    name, pages: [], file: f, thumb: info.thumb, source: 'import-pdf'
  });
  doc.pageCount = info.pageCount || doc.pageCount;
  doc.kind = 'pdf';
  await Repo.update(doc);
  if (!doc.pageCount) await refreshPdfPageCount(doc.id);
  toast('PDF importé (' + plural(info.pageCount || 0, 'page', 'pages') + ', ' + fmtBytes(f.size) + ')', 'ok', 4000);
  App.detailTab = 'preview';
  go('detail', doc.id);
}

async function mergePdfs() {
  const files = await pickFiles({ accept: 'application/pdf,.pdf', multiple: true });
  if (!files.length) return;
  if (files.length < 2) { toast('Sélectionnez au moins 2 PDF pour fusionner', 'err'); return; }
  busyBar(true);
  const list = [];
  for (const f of files) {
    try { list.push({ file: f, name: f.name.replace(/\.pdf$/i, ''), bytes: new Uint8Array(await f.arrayBuffer()) }); }
    catch (e) { toast('Lecture impossible : ' + f.name, 'err'); }
  }
  busyBar(false);
  if (list.length < 2) { toast('Il faut au moins 2 PDF valides', 'err'); return; }
  const s = openSheet({
    title: 'Fusionner ' + list.length + ' PDF',
    sub: 'Les documents seront assemblés dans cet ordre.',
    body: `<div class="sheet-list">${list.map((f, i) =>
        `<div class="row" style="padding:9px 6px"><span class="tag blue">${i + 1}</span>
          <span class="grow small" style="font-weight:600">${escapeHtml(f.name)}</span>
          <span class="tiny muted">${fmtBytes(f.file.size)}</span></div>`).join('')}</div>
      <div class="field"><label>Nom du fichier fusionné</label>
        <input id="mergeName" value="${escapeHtml('Fusion ' + new Date().toLocaleDateString('fr-FR'))}"></div>`,
    actions: [{ label: 'Annuler', cls: 'ghost' }, { label: 'Fusionner', cls: 'primary', act: 'merge-go', close: true }],
    onMount: (sheet) => {
      $('[data-act="merge-go"]', sheet).addEventListener('click', async () => {
        const name = ($('#mergeName').value || 'Fusion').trim();
        try {
          busyBar(true);
          const { blob, pageCount } = await PDF.merge(list.map(l => ({ bytes: l.bytes, name: l.name })), { name });
          busyBar(false);
          const file = new File([blob], slugify(name) + '.pdf', { type: 'application/pdf' });
          const info = await PDF.inspect(file);
          const doc = await Repo.create({ name, pages: [], file, thumb: info.thumb || null, source: 'merge' });
          doc.kind = 'pdf'; doc.pageCount = pageCount;
          await Repo.update(doc);
          await refreshPdfPageCount(doc.id);
          toast('Fusion réussie : ' + plural(pageCount, 'page', 'pages') + ' · ' + fmtBytes(blob.size), 'ok', 4500);
          App.detailTab = 'preview';
          setTimeout(() => go('detail', doc.id), 120);
        } catch (e) {
          busyBar(false);
          toast('Fusion impossible : ' + e.message, 'err', 6000);
        }
      });
    }
  });
}

/* --------------------------------------- comptabilité : extraction structurée -- */
/* Règles (audit Phase A) : ne jamais inventer une information absente (« Non reconnu »),
   confiance par champ, TVA multiples, lignes d'articles, lien champ -> zone de la page. */
/* ================= V2.15 : espace de pré-comptabilité française =================
   Plan comptable personnalisable (base PCG), journaux configurables, tiers locaux,
   règles de TVA paramétrables. Tout est local (localStorage), modifiable par le
   comptable, et aucune proposition n'est jamais considérée comme validée sans
   action humaine explicite. */
const Precompta = {
  KEYS: { chart: 'scanproAi.planComptable.v1', journals: 'scanproAi.journaux.v1', rules: 'scanproAi.reglesCompta.v1', vat: 'scanproAi.tauxTva.v1', tiers: 'scanproAi.tiers.v1' },
  DEFAULT_CHART: [
    ['101000', 'Capital', 'Capitaux'], ['401000', 'Fournisseurs', 'Tiers'], ['411000', 'Clients', 'Tiers'],
    ['445660', 'TVA déductible sur biens et services', 'TVA'], ['445710', 'TVA collectée', 'TVA'],
    ['512000', 'Banque', 'Trésorerie'], ['531000', 'Caisse', 'Trésorerie'],
    ['601000', 'Achats de matières premières', 'Charge'], ['604000', "Achats d'études et prestations", 'Charge'],
    ['606300', 'Fournitures et petit équipement', 'Charge'], ['607000', 'Achats de marchandises', 'Charge'],
    ['613000', 'Locations', 'Charge'], ['622600', 'Honoraires', 'Charge'], ['625100', 'Voyages et déplacements', 'Charge'],
    ['626000', 'Frais postaux et télécommunications', 'Charge'],
    ['606100', 'Fournitures non stockables (électricité, eau, gaz)', 'Charge'], ['616000', 'Primes d’assurance', 'Charge'],
    ['627000', 'Services bancaires et assimilés (frais)', 'Charge'], ['641000', 'Rémunérations du personnel', 'Charge'],
    ['645000', 'Charges de sécurité sociale et de prévoyance', 'Charge'], ['421000', 'Personnel — rémunérations dues', 'Tiers'],
    ['580000', 'Virements internes', 'Trésorerie'], ['218000', 'Matériel (immobilisation)', 'Immobilisation'],
    ['701000', 'Ventes de produits finis', 'Produit'], ['706000', 'Prestations de services', 'Produit'],
    ['707000', 'Ventes de marchandises', 'Produit']
  ].map(([num, label, cat]) => ({ num, label, cat, active: true })),
  DEFAULT_JOURNALS: [
    { code: 'HA', label: 'Achats', active: true }, { code: 'VT', label: 'Ventes', active: true },
    { code: 'BQ', label: 'Banque', active: true }, { code: 'CA', label: 'Caisse', active: true },
    { code: 'OD', label: 'Opérations diverses', active: true }
  ],
  DEFAULT_RULES: { achatCharge: '607000', achatTva: '445660', fournisseur: '401000', venteProduit: '706000', venteTva: '445710', client: '411000', banque: '512000', caisse: '531000', journalAchat: 'HA', journalVente: 'VT', journalBanque: 'BQ' },
  RULE_LABELS: { achatCharge: 'Compte de charge (achats)', achatTva: 'TVA déductible (achats)', fournisseur: 'Compte fournisseur', venteProduit: 'Compte de produit (ventes)', venteTva: 'TVA collectée (ventes)', client: 'Compte client', banque: 'Compte banque', caisse: 'Compte caisse', journalAchat: "Journal d'achat", journalVente: 'Journal de vente', journalBanque: 'Journal de banque' },
  DEFAULT_VAT_RATES: [20, 10, 5.5, 2.1, 0],
  _load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? JSON.parse(JSON.stringify(fallback)) : v; } catch (e) { return JSON.parse(JSON.stringify(fallback)); } },
  _save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} },
  chart() { return Precompta._load(Precompta.KEYS.chart, Precompta.DEFAULT_CHART); },
  saveChart(c) { Precompta._save(Precompta.KEYS.chart, c); },
  account(num) { return Precompta.chart().find(a => a.num === String(num)) || null; },
  accountLabel(num) { const a = Precompta.account(num); return a ? a.label : 'Compte non référencé (à créer ou corriger)'; },
  journals() { return Precompta._load(Precompta.KEYS.journals, Precompta.DEFAULT_JOURNALS); },
  saveJournals(j) { Precompta._save(Precompta.KEYS.journals, j); },
  rules() { return Object.assign({}, Precompta.DEFAULT_RULES, Precompta._load(Precompta.KEYS.rules, {})); },
  saveRules(r) { Precompta._save(Precompta.KEYS.rules, r); },
  vatRates() { const v = Precompta._load(Precompta.KEYS.vat, Precompta.DEFAULT_VAT_RATES); return Array.isArray(v) && v.length ? v : Precompta.DEFAULT_VAT_RATES.slice(); },
  saveVatRates(r) { Precompta._save(Precompta.KEYS.vat, r); },
  manualTiers() { return Precompta._load(Precompta.KEYS.tiers, []); },
  saveManualTiers(t) { Precompta._save(Precompta.KEYS.tiers, t); },
  normName(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); },
  /* Tiers construits depuis les documents analysés (+ tiers manuels).
     Aucun identifiant n'est inventé : absent = « Non reconnu ». */
  buildTiers(docs) {
    const map = new Map();
    const push = (name, kind, siret, docName) => {
      const key = Precompta.normName(name); if (!key) return;
      if (!map.has(key)) map.set(key, { name, kind, siret: siret || null, account: kind === 'client' ? Precompta.rules().client : Precompta.rules().fournisseur, docs: [] });
      const t = map.get(key);
      if (siret && !t.siret) t.siret = siret;
      if (docName && !t.docs.includes(docName)) t.docs.push(docName);
    };
    for (const d of docs || []) {
      if (!d.acc || !d.acc.data) continue;
      const f = d.acc.data.fields || {};
      const party = f.supplier && f.supplier.value !== Acc.NR ? f.supplier.value : null;
      if (!party) continue;
      const kind = d.acc.data.docType === 'facture_vente' ? 'client' : 'fournisseur';
      push(party, kind, f.siret && f.siret.value !== Acc.NR ? f.siret.value : null, d.name);
    }
    for (const t of Precompta.manualTiers()) push(t.name, t.kind || 'fournisseur', t.siret || null, null);
    const tiers = [...map.values()];
    // Doublons potentiels : même SIRET sous des noms différents, ou noms quasi identiques.
    const dups = [];
    for (let i = 0; i < tiers.length; i++) for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i], b = tiers[j];
      if (a.siret && b.siret && a.siret === b.siret) dups.push([a.name, b.name, 'même SIRET ' + a.siret]);
      else {
        const ta = new Set(Precompta.normName(a.name).split(' ')), tb = new Set(Precompta.normName(b.name).split(' '));
        const inter = [...ta].filter(x => tb.has(x)).length, union = new Set([...ta, ...tb]).size;
        if (union && inter / union >= 0.6) dups.push([a.name, b.name, 'noms très proches']);
      }
    }
    return { tiers, duplicates: dups };
  },
  BANK_RULES_KEY: '[REDACTED:CREDENTIAL]',
  LEARNED_KEY: 'scanproAi.' + 'apprentissagesBanque.v1',
  DEFAULT_BANK_RULES: [
    { pattern: 'edf|engie|électricité|electricite|énergie|energie|veolia|suez', account: '606100', conf: 85, why: 'Libellé énergie/électricité reconnu' },
    { pattern: 'sfr|free|orange|bouygues|télécom|telecom|mobile', account: '626000', conf: 85, why: 'Libellé télécommunications reconnu' },
    { pattern: 'urssaf|ag2r|retraite|cotisation|mutuelle santé|secu|securite sociale', account: '645000', conf: 80, why: 'Cotisation sociale reconnue (compte de charges sociales du plan)', alternatives: ['431000'] },
    { pattern: 'allianz|maif|axa|macif|assurance|gan\b|matmut', account: '616000', conf: 80, why: 'Prime d’assurance reconnue' },
    { pattern: 'frais|commission|cotis.*compte|offre compte|tenue de compte|carte.*frais|agios|intérêts débiteurs', account: '627000', conf: 75, why: 'Frais bancaires reconnus' },
    { pattern: 'loyer|bail|location(?!.*véhicule)', account: '613000', conf: 75, why: 'Loyer/location reconnu', alternatives: ['612000'] },
    { pattern: 'salaire|paie du|paye|bulletin', sens: 'sortie', account: '421000', conf: 70, why: 'Salaire net présumé (à confirmer : 641 brut / 421 net selon écriture de paie)', alternatives: ['641000'] },
    { pattern: 'matériel|materiel|équipement|equipement|ordinateur|machine', account: '607000', conf: 45, why: 'Achat de matériel : charge ou immobilisation selon montant/durée — arbitrage requis', alternatives: ['218000'] },
    { pattern: 'fac\s*n|facture.*fournisseur|prlv.*fournisseur', sens: 'sortie', account: '401000', conf: 55, why: 'Paiement fournisseur présumé' },
    { pattern: 'r[èe]glement.*facture|facture.*client|encaissement|vir.*client|client.*facture', sens: 'entree', account: '411000', conf: 55, why: 'Encaissement client présumé', alternatives: ['706000'] },
    { pattern: 'virement interne|vir interne|entre comptes|alimentation compte', account: '580000', conf: 60, why: 'Virement entre comptes présumé — vérifier le compte d’arrivée' },
    { pattern: 'remboursement', account: '401000', conf: 40, why: 'Remboursement : nature exacte à déterminer', alternatives: ['411000', '467000'] }
  ],
  bankRules() { const v = Precompta._load(Precompta.BANK_RULES_KEY, Precompta.DEFAULT_BANK_RULES); return Array.isArray(v) ? v : Precompta.DEFAULT_BANK_RULES.slice(); },
  saveBankRules(r) { Precompta._save(Precompta.BANK_RULES_KEY, r); },
  learned() { const v = Precompta._load(Precompta.LEARNED_KEY, {}); return v && !Array.isArray(v) && typeof v === 'object' ? v : {}; },
  /* V2.17 — Apprentissage fiabilisé. Une règle apprise est rattachée à un
     BÉNÉFICIAIRE normalisé (jetons triés : l'ordre prénom/nom est indifférent),
     au SENS de l'opération et à la nature détectée. Les mots génériques
     (« virement », « vers », « carte »…) et les mots de nature (« salaire »,
     « remboursement »…) ne font jamais partie de l'identité du bénéficiaire :
     impossible d'apprendre une règle « tous les virements ». */
  LEARN_STOP: new Set('vir virement inst instantane web carte cb prlv prelevement sepa vers de du des la le les pour par ref reference n numero eur chez au aux en'.split(' ')),
  LEARN_NATURE: new Set('salaire salaires paie paye remuneration appointements remboursement rembourse avance acompte pret facture reglement encaissement fournisseur client interne alimentation compte frais cotisation loyer prime echeance'.split(' ')),
  beneficiaryTokens(label) {
    return [...new Set(Precompta.normName(label).split(' ')
      .filter(w => w.length >= 2 && !/^\d+$/.test(w) && !Precompta.LEARN_STOP.has(w) && !Precompta.LEARN_NATURE.has(w)))].slice(0, 5);
  },
  learnKey(label, direction) {
    const toks = Precompta.beneficiaryTokens(label).slice().sort();
    if (!toks.length) return '';
    if (toks.length === 1 && toks[0].length < 3) return ''; // identité trop faible
    return (direction || 'tout-sens') + '|' + toks.join(' ');
  },
  detectNature(label, sens) {
    const s = ' ' + Precompta.normName(label) + ' ';
    if (/salaire|paie|paye|remuneration|appointements/.test(s)) return 'salaire';
    if (/virement interne|vir interne|entre comptes|alimentation/.test(s)) return 'virement interne';
    if (/remboursement|avance|acompte|note de frais/.test(s)) return 'remboursement/avance';
    if (sens === 'entree' && /facture|reglement|encaissement|client/.test(s)) return 'encaissement client';
    if (sens === 'sortie' && /fournisseur|facture/.test(s)) return 'paiement fournisseur';
    return 'inconnue';
  },
  learnedRules() {
    // Normalise l'ancien format (chaîne) et le format V2.17 (objet).
    return Object.entries(Precompta.learned()).map(([key, v]) => {
      if (typeof v === 'string') return { key, account: v, direction: null, tokens: key.split('|').slice(1).join(' ').split(' ').filter(Boolean), nature: null, legacy: true };
      return { key, account: v.account || null, direction: v.direction || null, tokens: v.tokens || [], nature: v.nature || null, label: v.label || '', conflictAccounts: v.conflictAccounts || null };
    });
  },
  _saveLearned(map) { Precompta._save(Precompta.LEARNED_KEY, map); },
  learnFromLabel(label, account, opts = {}) {
    const direction = opts.direction || null;
    const toks = Precompta.beneficiaryTokens(label);
    const key = Precompta.learnKey(label, direction);
    if (!account) return { ok: false, reason: 'compte absent' };
    if (!key) return { ok: false, reason: 'bénéficiaire non identifiable (libellé trop générique) : règle non apprise' };
    const map = Precompta.learned();
    const prev = map[key];
    const prevAccount = typeof prev === 'string' ? prev : (prev && prev.account);
    if (prevAccount && prevAccount !== String(account) && !opts.force) {
      // Conflit signalé, jamais résolu silencieusement : l'ancienne règle est conservée
      // et le conflit est exposé dans les propositions tant qu'il n'est pas corrigé.
      const base = typeof prev === 'object' ? prev : { account: prevAccount, tokens: toks, direction };
      map[key] = Object.assign({}, base, { conflictAccounts: [...new Set([prevAccount, String(account)])] });
      Precompta._saveLearned(map);
      return { ok: false, conflict: true, key, reason: 'conflit avec la règle apprise existante (' + prevAccount + ' ≠ ' + account + ') : correction explicite requise' };
    }
    map[key] = { account: String(account), direction, tokens: toks.slice().sort(), nature: opts.nature || Precompta.detectNature(label, direction), label: String(label || '').slice(0, 90), updatedAt: Date.now(), dossier: (Precompta.rules().journalBanque || 'BQ') + '/' + Precompta.rules().banque };
    Precompta._saveLearned(map);
    return { ok: true, key };
  },
  forgetLearned(key) { const map = Precompta.learned(); if (map[key] !== undefined) { delete map[key]; Precompta._saveLearned(map); return true; } return false; },
  correctLearned(key, account) {
    const map = Precompta.learned(); const prev = map[key]; if (prev === undefined || !account) return false;
    const base = typeof prev === 'object' ? prev : { tokens: key.split('|').slice(1).join(' ').split(' ').filter(Boolean), direction: null };
    map[key] = Object.assign({}, base, { account: String(account), conflictAccounts: null, updatedAt: Date.now() });
    Precompta._saveLearned(map); return true;
  },
  validateEntries(j, data) {
    const issues = [];
    if (!j || !j.rows || !j.rows.length) return ['Aucune ligne d\u2019écriture proposée'];
    const chart = Precompta.chart(), journals = Precompta.journals();
    for (const [i, r] of j.rows.entries()) {
      const n = i + 1;
      if (!r.date || !/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(r.date) || isNaN(Date.parse(r.date.replace(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/, '$3-$2-$1')))) issues.push('Ligne ' + n + ' : date absente ou invalide');
      if (!r.journal || !journals.some(x => x.code === r.journal && x.active)) issues.push('Ligne ' + n + ' : journal inconnu ou inactif (' + (r.journal || 'absent') + ')');
      const acc = chart.find(a => a.num === r.account);
      if (!acc) issues.push('Ligne ' + n + ' : compte ' + r.account + ' absent du plan comptable du dossier');
      else if (!acc.active) issues.push('Ligne ' + n + ' : compte ' + r.account + ' inactif dans le plan du dossier');
      if (!(r.debit >= 0) || !(r.credit >= 0)) issues.push('Ligne ' + n + ' : montant négatif ou invalide');
      if (r.debit > 0 && r.credit > 0) issues.push('Ligne ' + n + ' : débit et crédit simultanés');
      if (!r.piece) issues.push('Ligne ' + n + ' : numéro de pièce manquant (à compléter, jamais inventé)');
    }
    if (!j.balanced) issues.push('Écriture déséquilibrée : débits ' + j.totalDebit + ' ≠ crédits ' + j.totalCredit);
    if (j.needsHuman) issues.push('Validation humaine requise : ' + j.needsHuman);
    return issues;
  }
};

const Acc = {
  TYPES: [
    ['facture_achat', "Facture d'achat"], ['facture_vente', 'Facture de vente'], ['avoir', 'Avoir'],
    ['releve_bancaire', 'Relevé bancaire'], ['bulletin_salaire', 'Bulletin de salaire'],
    ['bilan', 'Bilan comptable'], ['compte_resultat', 'Compte de résultat'], ['devis', 'Devis'],
    ['bon_commande', 'Bon de commande'], ['pret_echeancier', 'Plan de remboursement de prêt'],
    ['amort_emprunt', "Tableau d'amortissement d'emprunt"], ['amort_immobilisation', 'Amortissement des immobilisations'],
    ['note_frais', 'Note de frais / justificatif'], ['autre_comptable', 'Autre état comptable']
  ],
  NR: 'Non reconnu',
  // Statuts de contrôle V2.13 : un contrôle n'est « conforme » que si la comparaison a réellement eu lieu.
  ctl(label, status, detail, recalculated = null) { return { label, status, ok: status === 'conforme', detail, recalculated }; },
  _finishControls(controls) { for (const c of controls) if (!c.status) c.status = c.ok ? 'conforme' : 'ecart'; return controls; },
  parseAmount(v) {
    if (v == null) return null;
    let s = String(v).trim().replace(/\s|€|EUR/gi, '').replace(/\(([^)]+)\)/, '-$1');
    if (!s) return null;
    if (/,/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  },
  fmt(n) { return n == null || n === '' ? Acc.NR : String(n); },
  classifyType(text) {
    const t = String(text || '').toLowerCase();
    const rules = [
      ['avoir', ['avoir', 'note de crédit', 'credit note']],
      ['releve_bancaire', ['relevé bancaire', 'releve bancaire', 'solde précédent', 'extrait de compte', 'iban']],
      ['bulletin_salaire', ['bulletin de paie', 'bulletin de salaire', 'salaire brut', 'net à payer', 'cotisations salariales']],
      ['bilan', ['bilan', 'actif immobilisé', 'capitaux propres', 'total actif', 'total passif']],
      ['compte_resultat', ['compte de résultat', 'charges d\'exploitation', 'produits d\'exploitation', 'résultat net']],
      ['amort_immobilisation', ['amortissements cumulés', 'valeur nette comptable', 'dotation aux amortissements']],
      ['pret_echeancier', ['capital restant dû', 'échéancier', 'mensualité', 'taux nominal']],
      ['amort_emprunt', ['tableau d\'amortissement', 'capital amorti', 'intérêts cumulés']],
      ['devis', ['devis', 'validité de l\'offre', 'bon pour accord']],
      ['bon_commande', ['bon de commande', 'purchase order', 'commande n°']],
      ['note_frais', ['note de frais', 'frais de déplacement', 'justificatif']],
      ['facture_achat', ['facture d\'achat', 'fournisseur :', 'émetteur']],
      ['facture_vente', ['facture de vente', 'client :', 'facturé à']]
    ];
    let best = { type: 'autre_comptable', score: 0 };
    for (const [type, words] of rules) {
      let s = 0; for (const w of words) if (t.includes(w)) s += w.length > 8 ? 2 : 1;
      if (s > best.score) best = { type, score: s };
    }
    if (/facture/.test(t) && best.score === 0) best = { type: 'facture_achat', score: 1 };
    const label = (Acc.TYPES.find(x => x[0] === best.type) || [])[1] || 'Autre état comptable';
    return { type: best.type, label, confidence: best.score >= 3 ? 85 : best.score >= 1 ? 55 : 25, proposed: true };
  },
  _norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/gi, ''); },
  findZone(pagesWords, needle) {
    if (!pagesWords || !needle) return null;
    const target = Acc._norm(needle).slice(0, 18);
    if (target.length < 2) return null;
    for (let p = 0; p < pagesWords.length; p++) {
      const words = pagesWords[p] || [];
      for (const w of words) {
        const wt = Acc._norm(w.t);
        if (wt && (wt === target || (target.includes(wt) && wt.length >= 3) || (wt.includes(target) && target.length >= 3))) {
          return { page: p, x: w.x, y: w.y, w: Math.max(w.w, 0.03), h: Math.max(w.h, 0.015) };
        }
      }
    }
    return null;
  },
  extractInvoice(text, pagesWords) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const F = (value, confidence, needle) => {
      const v = value == null || value === '' ? Acc.NR : value;
      const zone = v !== Acc.NR ? Acc.findZone(pagesWords, needle != null ? needle : v) : null;
      return { value: v, confidence: v === Acc.NR ? 0 : confidence, page: zone ? zone.page : 0, zone, status: v === Acc.NR ? 'non-reconnu' : 'reconnu' };
    };
    const labeled = (re) => { for (const l of lines) { const m = l.match(re); if (m && m[1] && m[1].trim()) return m[1].trim().slice(0, 120); } return ''; };
    const money = (re) => { const m = t.match(re); return m ? Acc.parseAmount(m[1]) : null; };
    const cls = Acc.classifyType(t);
    const isAvoir = cls.type === 'avoir' || /\bavoir\b/i.test(t);
    // émetteur : uniquement si libellé explicite (correction C-03 : jamais la 1re/dernière ligne)
    const supplier = labeled(/(?:fournisseur|émetteur|emetteur|émettrice|de la part de)\s*[:\-]\s*(.+)$/i)
      || labeled(/(?:société|entreprise)\s+émettrice\s*[:\-]\s*(.+)$/i);
    const address = supplier ? (lines[lines.findIndex(l => l.includes(supplier.slice(0, 12))) + 1] || '') : '';
    const sirenM = t.match(/\bsiren\s*:?\s*(\d[\d ]{8,12})/i);
    const siretM = t.match(/\bsiret\s*:?\s*(\d[\d ]{12,17})/i);
    const cleanId = (s) => s ? s.replace(/\s/g, '') : '';
    const numLabeled = labeled(/(?:facture|avoir|devis|commande)\s*(?:n[°o]?|numéro|numero|réf\.?|ref\.?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,24})/i)
      || labeled(/n[°o]\s*(?:de\s*)?(?:facture|avoir|document)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,24})/i);
    const numPattern = (t.match(/\b(?:FAC|FACT|AV|F|INV)[-\/]?\d{2,4}[-\/][A-Z0-9][A-Z0-9\-\/]{1,20}\b/i) || [''])[0];
    const issueDate = labeled(/(?:date\s*d['’]?(?:émission|emission|facturation)|date\s*de\s*facture|date)\s*[:\-]\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
    // échéance : libellé explicite uniquement (correction C-04)
    const dueDate = labeled(/(?:échéance|echeance|à régler avant|payable avant|date\s*d['’]?échéance)\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
    const orderRef = labeled(/(?:référence\s*(?:de\s*)?commande|bon de commande|commande\s*n[°o]?|référence client|votre référence)\s*[:#\-]?\s*([A-Z0-9\-\/]{3,30})/i);
    const paymentTerms = labeled(/(?:conditions\s*de\s*(?:règlement|paiement)|règlement\s*[:\-]|paiement\s*(?:à|a)\s*(\d+\s*jours?.*))$/i)
      || labeled(/(paiement\s*à\s*\d+\s*jours?.*)$/i);
    const totalHT = money(/total\s*(?:ht|hors\s*taxe)[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i);
    const totalTTC = money(/total\s*(?:ttc|à\s*payer|a\s*payer)[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i)
      ?? money(/net\s*à\s*payer[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i);
    const deposit = money(/(?:acompte|arrhes)[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i);
    // TVA : tous les taux et montants (correction C-01)
    const vatMap = new Map();
    const vatRes = [/(?:tva|TVA)\s*(?:à|a)?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*[:\-]?\s*(-?[\d ]+(?:[.,]\d{2})?)/g,
                    /(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*[:\-]?\s*(-?[\d ]+(?:[.,]\d{2})?)\s*(?:€|EUR)?\s*(?:de\s*)?tva/gi];
    for (const re of vatRes) { let m; while ((m = re.exec(t))) { const rate = Acc.parseAmount(m[1]); const amt = Acc.parseAmount(m[2]); if (rate != null && amt != null && rate > 0 && rate <= 30 && !vatMap.has(rate)) vatMap.set(rate, amt); } }
    const vat = [...vatMap.entries()].map(([rate, amount]) => ({ rate, amount }));
    const vatTotal = vat.length ? vat.reduce((s, v) => s + v.amount, 0) : money(/(?:montant\s*)?tva\s*(?:\d+[.,]?\d*\s*%)?[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i);
    // lignes d'articles : « description  qté x PU  [=] total » (correction C-01)
    const items = [];
    for (const l of lines) {
      const m = l.match(/^(.{2,60}?)\s+(\d+(?:[.,]\d+)?)\s*[x×]\s*(-?[\d ]+(?:[.,]\d{2})?)\s*(?:€|EUR)?\s*(?:=|\s)\s*(-?[\d ]+(?:[.,]\d{2})?)\s*(?:€|EUR)?\s*(?:\((\d{1,2}(?:[.,]\d{1,2})?)\s*%\))?/);
      if (m && !/total|tva|facture/i.test(m[1])) {
        const qty = Acc.parseAmount(m[2]), pu = Acc.parseAmount(m[3]), amt = Acc.parseAmount(m[4]);
        if (qty != null && pu != null && amt != null) items.push({ description: m[1].trim(), qty, unitPrice: pu, discount: null, vatRate: m[5] ? Acc.parseAmount(m[5]) : null, amount: amt, confidence: 70 });
      }
    }
    const currency = /€|EUR/.test(t) ? 'EUR' : (/\$|USD/.test(t) ? 'USD' : '');
    const fields = {
      docType: F(isAvoir ? 'Avoir' : cls.label, cls.confidence),
      supplier: F(supplier, supplier ? 90 : 0),
      address: F(address && /\d/.test(address) ? address : '', address ? 45 : 0),
      siren: F(cleanId(sirenM && sirenM[1]) || (cleanId(siretM && siretM[1]).length === 14 ? cleanId(siretM[1]).slice(0, 9) : ''), 88),
      siret: F(cleanId(siretM && siretM[1]), 88),
      invoiceNumber: F(numLabeled || numPattern, numLabeled ? 90 : 72),
      issueDate: F(issueDate, issueDate ? 88 : 0),
      dueDate: F(dueDate, dueDate ? 85 : 0),
      validityDate: F(labeled(/(?:validité|valable jusqu['’]au|date de validité)\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i), 80),
      orderRef: F(orderRef, orderRef ? 85 : 0),
      paymentTerms: F(paymentTerms, paymentTerms ? 70 : 0),
      deposit: F(deposit != null ? String(deposit) : '', 75),
      totalHT: F(totalHT != null ? String(totalHT) : '', 85),
      vatAmount: F(vatTotal != null ? String(Math.round(vatTotal * 100) / 100) : '', 80),
      totalTTC: F(totalTTC != null ? String(totalTTC) : '', 85),
      currency: F(currency, currency ? 80 : 0)
    };
    // contrôles de cohérence (valeurs reconnues uniquement, jamais recalculées à la place)
    const controls = [];
    if (totalHT != null && totalTTC != null && vatTotal != null) {
      const calc = Math.round((totalHT + vatTotal) * 100) / 100;
      const okCtl = Math.abs(calc - totalTTC) <= Math.max(0.05, Math.abs(totalTTC) * 0.005);
      controls.push({ label: 'HT + TVA = TTC', status: okCtl ? 'conforme' : 'ecart', ok: okCtl, detail: `Reconnu : ${totalHT} + ${Math.round(vatTotal * 100) / 100} = ${calc} · TTC reconnu : ${totalTTC}`, recalculated: calc });
    }
    if (totalHT == null || totalTTC == null || vatTotal == null) controls.push(Acc.ctl('HT + TVA = TTC', 'impossible', `Données indispensables manquantes (HT : ${totalHT == null ? 'non reconnu' : totalHT} · TVA : ${vatTotal == null ? 'non reconnue' : vatTotal} · TTC : ${totalTTC == null ? 'non reconnu' : totalTTC}) : aucune comparaison effectuée, aucune TVA inventée.`));
    if (items.length && totalHT != null) {
      const sum = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
      controls.push({ label: 'Somme des lignes = Total HT', ok: Math.abs(sum - totalHT) <= Math.max(0.05, Math.abs(totalHT) * 0.01), detail: `Lignes : ${sum} · HT reconnu : ${totalHT}`, recalculated: sum });
    }
    if (isAvoir && totalTTC != null && totalTTC > 0) controls.push({ label: 'Avoir à montants positifs', ok: false, detail: 'Un avoir comporte habituellement des montants négatifs : à vérifier, aucune correction automatique appliquée.', recalculated: null });
    // V2.15 : règles de TVA paramétrables — en cas de doute, validation humaine, jamais de décision fiscale automatique.
    const allowedRates = (typeof Precompta !== 'undefined') ? Precompta.vatRates() : [20, 10, 5.5, 2.1, 0];
    if (vat.length) {
      const odd = vat.filter(v => !allowedRates.includes(v.rate));
      if (odd.length) controls.push(Acc.ctl('Taux de TVA hors liste paramétrée', 'a-controler', 'Taux reconnu(s) : ' + odd.map(v => v.rate + ' %').join(', ') + ' — liste admise du dossier : ' + allowedRates.join(', ') + '. Régime et déductibilité à valider par le comptable ; aucune correction automatique.'));
      const sumRates = Math.round(vat.reduce((s, v) => s + v.amount, 0) * 100) / 100;
      if (totalHT != null && vatTotal != null) controls.push(Acc.ctl('Ventilation TVA par taux', Math.abs(sumRates - Math.round(vatTotal * 100) / 100) <= 0.05 ? 'conforme' : 'ecart', 'Somme des TVA par taux : ' + sumRates + ' · TVA totale reconnue : ' + Math.round(vatTotal * 100) / 100 + ' (' + vat.map(v => v.rate + ' %').join(' + ') + ')'));
    }
    if (!vat.length && totalHT != null && totalTTC != null && Math.abs(totalHT - totalTTC) <= 0.01) controls.push(Acc.ctl('Facture sans TVA', 'a-controler', 'HT = TTC et aucune TVA reconnue : facture possiblement sans TVA (franchise, exonération, autoliquidation). Traitement fiscal à valider par le comptable — aucune TVA inventée.'));
    Acc._finishControls(controls);
    return { docType: isAvoir ? 'avoir' : cls.type, proposedType: cls, fields, lines: items, vat, controls,
      disclaimer: 'Extraction locale à vérifier champ par champ. Les valeurs recalculées (contrôles) ne remplacent jamais les montants reconnus.' };
  },
  extractPayroll(text, pagesWords) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const F = (value, confidence, needle) => {
      const v = value == null || value === '' ? Acc.NR : value;
      return { value: v, confidence: v === Acc.NR ? 0 : confidence, page: 0, zone: v !== Acc.NR ? Acc.findZone(pagesWords, needle || v) : null, status: v === Acc.NR ? 'non-reconnu' : 'reconnu' };
    };
    const money = (res) => { for (const re of res) { const m = t.match(re); if (m) return Acc.parseAmount(m[1] || m[2]); } return null; };
    const labeled = (re) => { for (const l of lines) { const m = l.match(re); if (m && m[1]) return m[1].trim().slice(0, 90); } return ''; };
    // Chaque notion de net a son propre motif : ne jamais les confondre.
    const gross = money([/salaire\s*brut[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i, /total\s*brut[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const netTaxable = money([/net\s*(?:fiscal\s*)?imposable[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i, /cumul\s*imposable[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const netSocial = money([/net\s*social[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const netPayable = money([/net\s*(?:à|a)\s*payer[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const paid = money([/(?:montant\s*(?:versé|verse)|virement\s*(?:de|du))[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const empContrib = money([/(?:total\s*)?cotisations?\s*(?:et\s*contributions?\s*)?salariales?[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i, /charges\s*salariales[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const erContrib = money([/(?:total\s*)?cotisations?\s*(?:et\s*contributions?\s*)?patronales?[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i, /charges\s*patronales[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const base = money([/salaire\s*de\s*base[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const bonuses = money([/(?:prime[s]?\s*(?:exceptionnelle|d['’]ancienneté|diverses)?|primes?)[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i]);
    const hoursM = t.match(/(\d{2,3}[.,]?\d{0,2})\s*(?:h|heures?)\s*(?:travaillées|mensuelles|payées)?/i);
    const absM = t.match(/absence[s]?\s*[:\-]?\s*(\d+[.,]?\d{0,2})\s*(?:h|heures?|jour)/i);
    const period = labeled(/(?:période\s*de\s*paie|période|mois\s*de)\s*[:\-]?\s*([A-Za-zÀ-ÿ]+\s*\d{4}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\s*(?:au|-|à)\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i);
    const employee = labeled(/(?:salarié|salariée|employé|employée|nom\s*et\s*prénom)\s*[:\-]\s*(.+)$/i);
    const employer = labeled(/(?:employeur|raison\s*sociale|entreprise)\s*[:\-]\s*(.+)$/i);
    const fields = {
      employee: F(employee, 80), employer: F(employer, 80), period: F(period, 80),
      baseSalary: F(base != null ? String(base) : '', 80), hours: F(hoursM ? hoursM[1].replace(',', '.') : '', 60),
      bonuses: F(bonuses != null ? String(bonuses) : '', 65), absences: F(absM ? absM[1].replace(',', '.') : '', 60),
      gross: F(gross != null ? String(gross) : '', 85),
      employeeContributions: F(empContrib != null ? String(empContrib) : '', 80),
      employerContributions: F(erContrib != null ? String(erContrib) : '', 80),
      netTaxable: F(netTaxable != null ? String(netTaxable) : '', 85),
      netSocial: F(netSocial != null ? String(netSocial) : '', 85),
      netPayable: F(netPayable != null ? String(netPayable) : '', 90),
      amountPaid: F(paid != null ? String(paid) : '', 70)
    };
    const controls = [];
    if (gross != null && empContrib != null && netSocial != null) {
      const calc = Math.round((gross - Math.abs(empContrib)) * 100) / 100;
      controls.push({ label: 'Brut − cotisations salariales ≈ Net social', ok: Math.abs(calc - netSocial) <= Math.max(0.05, gross * 0.01), detail: `Reconnu : ${gross} − ${Math.abs(empContrib)} = ${calc} · Net social reconnu : ${netSocial}`, recalculated: calc });
    }
    if (netPayable != null && gross != null && netPayable > gross) controls.push({ label: 'Net à payer supérieur au brut', ok: false, detail: 'Le net à payer reconnu dépasse le salaire brut reconnu : confusion possible entre les nets, à vérifier sur le bulletin.', recalculated: null });
    if (netTaxable != null && netPayable != null && Math.abs(netTaxable - netPayable) < 0.005) controls.push({ label: 'Net imposable = net à payer', ok: false, detail: 'Valeurs identiques reconnues : ces deux notions sont distinctes, vérifier qu\'il ne s\'agit pas d\'une confusion de lignes.', recalculated: null });
    return { docType: 'bulletin_salaire', kind: 'payroll', fields, controls, sensitive: true,
      disclaimer: "Document de paie sensible : traitement 100 % local, aucune télémétrie, aucun envoi externe. Brut, net imposable, net social et net à payer sont des notions distinctes, extraites séparément et jamais confondues." };
  },
  extractFinancial(text, kind, pagesWords) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const isBilan = kind !== 'compte_resultat';
    let section = isBilan ? 'actif' : 'charges';
    const rows = [];
    const amountRe = /-?\(?[\d]{1,3}(?:[ \u00a0\u202f][\d]{3})*(?:[.,]\d{2})\)?|-?\d+(?:[.,]\d{2})/g;
    for (const l of lines) {
      const low = l.toLowerCase();
      if (/^actif\b|total\s*actif/.test(low)) section = 'actif';
      else if (/^passif\b|capitaux propres|total\s*passif/.test(low)) section = 'passif';
      else if (/charges/.test(low) && !/sociales|salariales/.test(low)) section = 'charges';
      else if (/produits/.test(low)) section = 'produits';
      const amounts = [...l.matchAll(amountRe)].map(m => Acc.parseAmount(m[0])).filter(x => x != null);
      if (!amounts.length) continue;
      if (/^(actif|passif|charges|produits)\s*$/.test(low)) continue;
      const acctM = l.match(/\b(\d{3,6})\b/);
      let label = l.replace(amountRe, ' ').replace(/\b\d{3,6}\b/, ' ').replace(/\s{2,}/g, ' ').replace(/[-–—|:]+$/, '').trim();
      if (!label || label.length < 2) continue;
      if (/^(total|résultat|resultat)/i.test(label) || amounts.length) {
        const isResult = /^(résultat|resultat)/i.test(label);
        rows.push({ section: isResult ? 'resultat' : section, account: acctM ? acctM[1] : '', label, amountN: amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0], amountN1: amounts.length >= 2 ? amounts[amounts.length - 1] : null, isTotal: /^total/i.test(label) || isResult, confidence: 65 });
      }
    }
    const posRows = Acc.financialFromPositions(pagesWords);
    if (posRows && posRows.length) { rows.length = 0; rows.push(...posRows); }
    const totalOf = (sec) => { const r = [...rows].reverse().find(x => x.section === sec && x.isTotal); return r ? r.amountN : null; };
    const controls = [];
    if (isBilan) {
      const ta = totalOf('actif'), tp = totalOf('passif');
      if (ta != null && tp != null) controls.push(Acc.ctl('Total actif = Total passif', Math.abs(ta - tp) <= 0.05 ? 'conforme' : 'ecart', `Actif reconnu : ${ta} · Passif reconnu : ${tp}`));
      else controls.push(Acc.ctl('Total actif = Total passif', 'impossible', `Données indispensables manquantes (total actif : ${ta == null ? 'non reconnu' : ta} · total passif : ${tp == null ? 'non reconnu' : tp}) : aucune comparaison effectuée.`));
    } else {
      const tc = totalOf('charges'), tp = totalOf('produits');
      const printed = (() => { const r = [...rows].reverse().find(x => x.section === 'resultat'); return r ? r.amountN : null; })();
      if (tc != null && tp != null) {
        const calc = Math.round((tp - tc) * 100) / 100;
        if (printed != null) controls.push(Acc.ctl('Résultat recalculé vs résultat imprimé', Math.abs(calc - printed) <= Math.max(0.05, Math.abs(printed) * 0.005) ? 'conforme' : 'ecart', `Recalculé (produits ${tp} − charges ${tc}) : ${calc} · Résultat imprimé reconnu : ${printed}`, calc));
        else controls.push(Acc.ctl('Résultat recalculé vs résultat imprimé', 'a-controler', `Résultat recalculé : ${calc} (produits ${tp} − charges ${tc}), mais aucun résultat imprimé n'a été reconnu : comparaison impossible, valeur recalculée non certaine.`, calc));
      } else controls.push(Acc.ctl('Résultat recalculé vs résultat imprimé', 'impossible', `Totaux indispensables manquants (charges : ${tc == null ? 'non reconnues' : tc} · produits : ${tp == null ? 'non reconnus' : tp}) : aucune comparaison effectuée.`));
    }
    for (const sec of (isBilan ? ['actif', 'passif'] : ['charges', 'produits'])) {
      const tot = totalOf(sec); if (tot == null) continue;
      const details = rows.filter(x => x.section === sec && !x.isTotal);
      if (details.length >= 2) {
        const sum = Math.round(details.reduce((s, x) => s + (x.amountN || 0), 0) * 100) / 100;
        controls.push(Acc.ctl('Somme des lignes ' + sec + ' vs total ' + sec, Math.abs(sum - tot) <= Math.max(0.05, Math.abs(tot) * 0.01) ? 'conforme' : 'a-controler', `Lignes reconnues : ${sum} · Total ${sec} reconnu : ${tot} (si des lignes n'ont pas été reconnues, l'écart ne prouve pas une erreur du document)`, sum));
      } else controls.push(Acc.ctl('Somme des lignes ' + sec + ' vs total ' + sec, 'impossible', `Lignes de détail insuffisantes (${details.length}) pour vérifier le total ${sec} reconnu : ${tot}.`));
    }
    return { docType: kind, kind: 'financial', fields: {}, statementRows: rows, controls,
      disclaimer: "Aperçu tabulaire reconnu par OCR : vérifiez lignes, signes et colonnes N / N-1 avant export. Les contrôles arithmétiques n'ont de valeur que si toutes les lignes ont été reconnues." };
  },
  toFinancialCsv(data) {
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['Section', 'Compte', 'Libellé', 'Exercice N', 'Exercice N-1', 'Total']];
    for (const r of data.statementRows || []) rows.push([r.section, r.account, r.label, r.amountN ?? '', r.amountN1 ?? '', r.isTotal ? 'oui' : '']);
    return rows.map(r => r.map(esc).join(';')).join('\n');
  },
  extractLoan(text, pagesWords) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const F = (value, confidence) => ({ value: value == null || value === '' ? Acc.NR : value, confidence: value == null || value === '' ? 0 : confidence, page: 0, zone: value ? Acc.findZone(pagesWords, value) : null, status: value ? 'reconnu' : 'non-reconnu' });
    const labeledMoney = (re) => { const m = t.match(re); return m ? Acc.parseAmount(m[1]) : null; };
    const loanAmount = labeledMoney(/(?:montant\s*(?:du\s*)?(?:prêt|pret|emprunt|capital\s*emprunté)|capital\s*initial)[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i);
    const rateM = t.match(/(?:taux\s*(?:nominal|fixe|d['’]intérêt)?)[^%\d\n]*(\d{1,2}(?:[.,]\d{1,3})?)\s*%/i);
    const fields = {
      lender: F((t.match(/(?:prêteur|preteur|banque|établissement)\s*[:\-]\s*(.+)/i) || [])[1] || '', 70),
      borrower: F((t.match(/(?:emprunteur|client)\s*[:\-]\s*(.+)/i) || [])[1] || '', 70),
      loanAmount: F(loanAmount != null ? String(loanAmount) : '', 85),
      rate: F(rateM ? rateM[1].replace(',', '.') + ' %' : '', 80),
      duration: F((t.match(/(\d{1,3})\s*(?:mois|mensualités|echeances|échéances)/i) || [])[1] || '', 60)
    };
    const amountRe = /-?\(?[\d]{1,3}(?:[ \u00a0\u202f][\d]{3})*(?:[.,]\d{2})\)?|-?\d+(?:[.,]\d{2})/g;
    const rows = [];
    for (const l of lines) {
      const dm = l.match(/^(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\s+(.+)$/);
      if (!dm) continue;
      const amounts = [...dm[2].matchAll(amountRe)].map(m => Acc.parseAmount(m[0])).filter(x => x != null);
      if (amounts.length < 3) continue;
      // Colonnes usuelles : échéance totale, capital, intérêts, [assurance], capital restant dû
      const [total, capital, interest] = amounts;
      const insurance = amounts.length >= 5 ? amounts[3] : 0;
      const remaining = amounts[amounts.length - 1];
      rows.push({ date: dm[1], total, capital, interest, insurance, remaining, confidence: 65 });
    }
    // Capital restant recalculé, conservé À PART : il ne remplace jamais la valeur reconnue.
    let run = loanAmount;
    for (const r of rows) { if (run != null) { run = Math.round((run - r.capital) * 100) / 100; r.computedRemaining = run; } }
    const controls = [];
    rows.forEach((r, i) => {
      const sum = Math.round((r.capital + r.interest + (r.insurance || 0)) * 100) / 100;
      if (Math.abs(sum - r.total) > 0.05) controls.push({ label: 'Échéance ligne ' + (i + 1) + ' incohérente', ok: false, detail: `Capital ${r.capital} + intérêts ${r.interest} + assurance ${r.insurance || 0} = ${sum} ≠ échéance reconnue ${r.total}`, recalculated: sum });
      if (r.computedRemaining != null && Math.abs(r.computedRemaining - r.remaining) > 0.05) controls.push({ label: 'Capital restant ligne ' + (i + 1) + ' différent du recalculé', ok: false, detail: `Reconnu : ${r.remaining} · Recalculé (montant du prêt − capitaux remboursés) : ${r.computedRemaining} — la valeur reconnue est conservée.`, recalculated: r.computedRemaining });
    });
    if (loanAmount != null && rows.length) {
      const sumCap = Math.round(rows.reduce((s, r) => s + r.capital, 0) * 100) / 100;
      controls.push({ label: 'Somme des capitaux remboursés vs montant du prêt', ok: Math.abs(sumCap - loanAmount) <= Math.max(0.05, loanAmount * 0.01), detail: `Capitaux reconnus : ${sumCap} · Montant du prêt reconnu : ${loanAmount} (écart normal si l'échéancier reconnu est partiel)`, recalculated: sumCap });
    }
    const dec = rows.every((r, i) => i === 0 || r.remaining <= rows[i - 1].remaining);
    if (rows.length > 1) controls.push({ label: 'Capital restant décroissant', ok: dec, detail: dec ? 'Le capital restant dû diminue à chaque échéance reconnue.' : 'Une échéance fait augmenter le capital restant : à vérifier.', recalculated: null });
    return { docType: 'pret_echeancier', kind: 'loan', fields, scheduleRows: rows, controls,
      disclaimer: "Échéancier reconnu dans le document. La colonne « recalculé » est une vérification de l'application : elle ne remplace jamais le capital restant imprimé." };
  },
  extractAssets(text, pagesWords) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const amountRe = /-?\(?[\d]{1,3}(?:[ \u00a0\u202f][\d]{3})*(?:[.,]\d{2})\)?|-?\d+(?:[.,]\d{2})/g;
    const rows = [];
    for (const l of lines) {
      if (/total|libellé|designation|valeur d['’]origine/i.test(l) && !/\d{3,}/.test(l)) continue;
      const amounts = [...l.matchAll(amountRe)].map(m => Acc.parseAmount(m[0])).filter(x => x != null);
      if (amounts.length < 3) continue;
      const dateM = l.match(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
      const durM = l.match(/(\d{1,2})\s*(?:ans|années|annees)/i);
      const rateM = l.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
      let label = l.replace(amountRe, ' ').replace(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/, ' ').replace(/(\d{1,2})\s*(?:ans|années|annees)/i, ' ').replace(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/, ' ').replace(/\s{2,}/g, ' ').trim();
      if (!label || label.length < 2 || /^total/i.test(label)) continue;
      // Colonnes usuelles : valeur d'origine, dotation annuelle, cumul, VNC (les 4 derniers montants)
      const a = amounts.slice(-4);
      rows.push({ label, originalValue: a.length >= 4 ? a[0] : null, serviceDate: dateM ? dateM[1] : '', durationYears: durM ? Number(durM[1]) : null, rate: rateM ? Acc.parseAmount(rateM[1]) : null, annualDepreciation: a.length >= 4 ? a[1] : amounts[amounts.length - 3], accumulated: a.length >= 2 ? a[a.length - 2] : null, netBookValue: a[a.length - 1], confidence: 60 });
    }
    const controls = [];
    rows.forEach((r, i) => {
      if (r.originalValue != null && r.accumulated != null && r.netBookValue != null) {
        const sum = Math.round((r.accumulated + r.netBookValue) * 100) / 100;
        controls.push({ label: 'Immobilisation ligne ' + (i + 1) + ' : cumul + VNC = valeur d\'origine', ok: Math.abs(sum - r.originalValue) <= Math.max(0.05, r.originalValue * 0.01), detail: `Reconnu : cumul ${r.accumulated} + VNC ${r.netBookValue} = ${sum} · Valeur d'origine reconnue : ${r.originalValue}`, recalculated: sum });
      }
    });
    return { docType: 'amort_immobilisation', kind: 'assets', fields: {}, assetRows: rows, controls,
      disclaimer: "Tableau d'amortissement des immobilisations reconnu par OCR. Dotations et VNC reconnues conservées telles quelles ; tout recalcul est signalé dans les contrôles, jamais substitué." };
  },
  toTableCsv(headers, rows) {
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    return [headers, ...rows].map(r => r.map(esc).join(';')).join('\n');
  },
  /* --- Reconstruction par positions OCR (V2.14) : aucune coordonnée fabriquée.
     Si les positions sont absentes, ces fonctions renvoient null et les extracteurs
     retombent sur l'analyse des lignes de texte. */
  groupWordLines(words) {
    const ws = (words || []).filter(w => w && w.t && w.w > 0).slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const lines = [];
    for (const w of ws) {
      const cy = w.y + (w.h || 0.02) / 2;
      let line = lines.find(l => Math.abs(l.cy - cy) <= Math.max(0.012, (w.h || 0.02) * 0.8));
      if (!line) { line = { cy, words: [], y: w.y }; lines.push(line); }
      line.words.push(w);
    }
    for (const l of lines) { l.words.sort((a, b) => a.x - b.x); l.text = l.words.map(w => w.t).join(' '); }
    return lines.sort((a, b) => a.cy - b.cy);
  },
  positionRows(pagesWords) {
    const out = [];
    (pagesWords || []).forEach((words, page) => {
      for (const l of Acc.groupWordLines(words)) {
        const cells = l.words.map(w => ({ t: w.t, x: w.x, w: w.w, c: w.c, xc: w.x + w.w / 2 }));
        // Milliers séparés par une espace dans le PDF (« 1 » + « 477,95 », fréquent
        // dans les relevés bancaires) : refusionner en une seule cellule montant.
        const merged = [];
        for (let i = 0; i < cells.length; i++) {
          const c = cells[i], n = cells[i + 1];
          if (n && /^\d{1,3}$/.test(c.t) && /^\d{3}[.,]\d{2}$/.test(n.t) && (n.x - (c.x + c.w)) < 0.03) {
            merged.push({ t: c.t + ' ' + n.t, x: c.x, w: (n.x + n.w) - c.x, c: c.c, xc: c.x + ((n.x + n.w) - c.x) / 2 }); i++;
          } else merged.push(c);
        }
        out.push({ page, y: l.y, text: l.text, cells: merged });
      }
    });
    return out;
  },
  _amountOf(s) { const v = Acc.parseAmount(String(s || '').replace(/[€]/g, '')); return (v != null && /\d/.test(String(s))) ? v : null; },
  bankFromPositions(pagesWords) {
    // Reconstruction par page : en-tête propre à chaque page (jamais un index global),
    // colonnes par INTERVAILLES (frontières entre ancres), date cherchée dans les
    // premières cellules, lignes de continuation rattachées à l'opération précédente,
    // aucun écrasement de montant, affectation ambiguë signalée « à vérifier ».
    if (!pagesWords || !pagesWords.some(w => w && w.length)) return null;
    const rows = Acc.positionRows(pagesWords);
    if (!rows.length) return null;
    const dateRe = /^\d{1,2}[\\/.\-]\d{1,2}/;
    const tx = [];
    let anchors = null, cur = null;
    const zonesOf = (a) => {
      const cols = Object.entries(a).sort((x, y) => x[1] - y[1]);
      return cols.map(([k, xc], i) => ({
        k, xc,
        lo: i === 0 ? xc - ((cols[1] ? cols[1][1] : xc + 0.1) - xc) / 2 : (cols[i - 1][1] + xc) / 2,
        hi: i === cols.length - 1 ? xc + (xc - (cols[i - 1] ? cols[i - 1][1] : xc - 0.1)) / 2 : (xc + cols[i + 1][1]) / 2
      }));
    };
    const assign = (target, cell, amt, labelCells) => {
      const zones = zonesOf(anchors);
      const z = zones.find(z2 => cell.xc >= z2.lo && cell.xc < z2.hi);
      if (!z) {
        if ((target.debit != null || target.credit != null) && target.balance == null) { target.balance = amt; target.status = 'a-verifier'; target.confidence = Math.min(target.confidence, 50); target.source += ' · colonne droite sans en-tête : solde supposé, à vérifier'; }
        else labelCells.push(cell.t);
        return;
      }
      const nearBorder = Math.min(Math.abs(cell.xc - z.lo), Math.abs(cell.xc - z.hi)) < 0.02;
      const col = z.k;
      if (target[col] != null) {
        if (col !== 'balance' && target.balance == null) { target.balance = amt; target.status = 'a-verifier'; target.source += ' · second montant dans la colonne ' + col + ' : reporté en solde, à vérifier'; }
        else labelCells.push(cell.t);
        return;
      }
      target[col] = col === 'balance' ? amt : Math.abs(amt);
      if (nearBorder) { target.status = 'a-verifier'; target.confidence = Math.min(target.confidence, 45); target.source += ' · colonne ambiguë (montant entre deux colonnes)'; }
    };
    let lastPage = -1;
    for (const r of rows) {
      if (r.page !== lastPage) { lastPage = r.page; }
      const low = r.text.toLowerCase();
      if (/débit|debit/.test(low) && /crédit|credit/.test(low)) {
        const a = {};
        for (const c of r.cells) { const lt = c.t.toLowerCase(); if (/débit|debit/.test(lt)) a.debit = c.xc; if (/crédit|credit/.test(lt)) a.credit = c.xc; if (/solde/.test(lt)) a.balance = c.xc; }
        if (a.debit != null && a.credit != null) { anchors = a; continue; }
      }
      if (!anchors) continue;
      const dateIdx = r.cells.findIndex((c, idx) => idx < 3 && dateRe.test(c.t));
      if (dateIdx < 0) {
        if (/total\s+des\s+opérations|nouveau\s+solde|ancien\s+solde/i.test(r.text)) { cur = null; continue; }
        // Ligne de continuation : elle appartient à l'opération précédente (libellé multi-ligne).
        if (cur) {
          const labelCells = [];
          for (const c of r.cells) {
            const amt = /[.,]\d{2}/.test(c.t) ? Acc._amountOf(c.t) : null;
            if (amt == null) { if (/[0-9A-Za-zÀ-ÿ]/.test(c.t)) labelCells.push(c.t); }
            else if (cur.debit == null && cur.credit == null) assign(cur, c, amt, labelCells);
            else if (cur.balance == null) cur.balance = amt;
            else labelCells.push(c.t);
          }
          cur.label = (cur.label + ' ' + labelCells.join(' ')).replace(/\s{2,}/g, ' ').trim();
        }
        continue;
      }
      const labelCells = [];
      cur = { date: r.cells[dateIdx].t, valueDate: null, label: '', reference: dateIdx > 0 ? r.cells.slice(0, dateIdx).map(c => c.t).join(' ') : null, debit: null, credit: null, balance: null, page: r.page, confidence: 78, status: 'reconnu', source: 'positions OCR (colonnes par intervalles)' };
      tx.push(cur);
      let skippedValueDate = false;
      for (const c of r.cells.slice(dateIdx + 1)) {
        if (!skippedValueDate && cur.valueDate == null && dateRe.test(c.t)) { cur.valueDate = c.t; skippedValueDate = true; continue; }
        const amt = Acc._amountOf(c.t);
        if (amt == null) { if (/[0-9A-Za-zÀ-ÿ]/.test(c.t)) labelCells.push(c.t); continue; }
        assign(cur, c, amt, labelCells);
      }
      cur.label = labelCells.join(' ').trim() || Acc.NR;
    }
    for (const x of tx) if (!x.label) x.label = Acc.NR;
    return tx.length ? tx : null;
  },
  financialFromPositions(pagesWords) {
    const rows = Acc.positionRows(pagesWords);
    if (!rows.length) return null;
    let anchors = null, headerIdx = -1;
    rows.forEach((r, i) => {
      const years = r.cells.filter(c => /^(19|20)\d{2}$/.test(c.t) || /^n(-|−)?1$/i.test(c.t.replace(/\s/g, '')));
      if (years.length >= 2) {
        const sorted = years.slice().sort((a, b) => a.xc - b.xc);
        // L'en-tête décide : la colonne de gauche est celle imprimée en premier (souvent N, parfois N-1)
        const leftIsN1 = /n(-|−)?1/i.test(sorted[0].t) || (sorted[1] && /^(19|20)\d{2}$/.test(sorted[0].t) && /^(19|20)\d{2}$/.test(sorted[1].t) && Number(sorted[0].t) < Number(sorted[1].t));
        anchors = leftIsN1 ? { n1: sorted[0].xc, n: sorted[sorted.length - 1].xc } : { n: sorted[0].xc, n1: sorted[sorted.length - 1].xc };
        headerIdx = i;
      }
    });
    if (!anchors) return null;
    const out = [];
    let section = 'actif';
    rows.forEach((r, i) => {
      if (i <= headerIdx) return;
      const low = r.text.toLowerCase();
      if (/^actif/.test(low)) section = 'actif'; else if (/^passif|capitaux/.test(low)) section = 'passif';
      else if (/charges/.test(low) && !/sociales/.test(low)) section = 'charges'; else if (/produits/.test(low)) section = 'produits';
      let amountN = null, amountN1 = null; const labelCells = [];
      for (const c of r.cells) {
        const amt = Acc._amountOf(c.t);
        if (amt == null) { labelCells.push(c.t); continue; }
        const dN = Math.abs(anchors.n - c.xc), dN1 = Math.abs(anchors.n1 - c.xc);
        if (Math.min(dN, dN1) <= 0.18) { if (dN <= dN1) amountN = amt; else amountN1 = amt; } else labelCells.push(c.t);
      }
      const label = labelCells.join(' ').replace(/\\b\d{3,6}\\b/, '').trim();
      if ((amountN == null && amountN1 == null) || label.length < 2) return;
      const acctM = r.text.match(/\\b(\d{3,6})\\b/);
      const isResult = /^(résultat|resultat)/i.test(label);
      out.push({ section: isResult ? 'resultat' : section, account: acctM ? acctM[1] : '', label, amountN, amountN1, isTotal: /^total/i.test(label) || isResult, confidence: 72, source: 'positions OCR (colonnes en-tête)' });
    });
    return out.length ? out : null;
  },
  extractExpenses(text, pagesWords) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const cats = [[/train|sncf|taxi|avion|transport|péage|peage|parking/i, 'Transport'], [/hôtel|hotel|hébergement|hebergement|nuit/i, 'Hébergement'], [/restaurant|repas|déjeuner|dejeuner|dîner/i, 'Repas'], [/carburant|essence|gasoil|diesel/i, 'Carburant'], [/fourniture|bureau|logiciel|abonnement/i, 'Fournitures']];
    const amountRe = /-?\(?[\d]{1,3}(?:[ \u00a0\u202f][\d]{3})*(?:[.,]\d{2})\)?|-?\d+(?:[.,]\d{2})/g;
    const rows = [];
    for (const l of lines) {
      if (/^total|note de frais|salarié|date|libellé/i.test(l)) continue;
      const amounts = [...l.matchAll(amountRe)].map(m => Acc.parseAmount(m[0])).filter(x => x != null);
      if (!amounts.length) continue;
      const dm = l.match(/^(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\s+/);
      let label = l.replace(amountRe, ' ').replace(/^(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\s+/, '').replace(/\s{2,}/g, ' ').trim();
      if (!label || label.length < 2) continue;
      const cat = (cats.find(([re]) => re.test(label)) || [])[1] || 'Divers';
      rows.push({ date: dm ? dm[1] : '', label, category: cat, amount: amounts[amounts.length - 1], vat: amounts.length >= 2 ? amounts[amounts.length - 2] : null, confidence: 60 });
    }
    const total = (() => { const m = t.match(/total[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i); return m ? Acc.parseAmount(m[1]) : null; })();
    const sum = Math.round(rows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;
    const controls = [];
    if (total != null && rows.length) controls.push({ label: 'Somme des justificatifs vs total de la note', ok: Math.abs(sum - total) <= 0.05, detail: `Justificatifs reconnus : ${sum} · Total reconnu : ${total}`, recalculated: sum });
    const F = (v, c) => ({ value: v == null || v === '' ? Acc.NR : v, confidence: v == null || v === '' ? 0 : c, page: 0, zone: null, status: v ? 'reconnu' : 'non-reconnu' });
    const fields = { employee: F((t.match(/(?:salarié|collaborateur|nom)\s*[:\-]\s*(.+)/i) || [])[1] || '', 75), expenseTotal: F(total != null ? String(total) : '', 85), expenseCount: F(rows.length ? String(rows.length) : '', 90), currency: F(/€|EUR/.test(t) ? 'EUR' : '', 80) };
    return { docType: 'note_frais', kind: 'expenses', fields, expenseRows: rows, controls, disclaimer: "Note de frais reconnue localement : catégories proposées par mots-clés, à vérifier avant remboursement." };
  },
  journalEntries(data, docMeta = {}) {
    // Écritures PROPOSÉES depuis le plan comptable et les règles du dossier (PCG par
    // défaut, entièrement configurables dans l'espace Pré-comptabilité). Aucun compte
    // n'est figé dans la logique : seuls les défauts le sont, et ils sont modifiables.
    const R = Precompta.rules();
    const num = (k) => { const f = (data.fields || {})[k]; const n = f ? Acc.parseAmount(f.value) : null; return n; };
    const ht = num('totalHT'), vat = num('vatAmount'), ttc = num('totalTTC');
    if (ht == null || ttc == null) return null;
    if (vat == null && Math.abs(ttc - ht) > 0.01) return null; // TVA absente et HT != TTC : on n'invente pas de TVA
    const vatAmt = vat != null ? vat : 0;
    const date = (data.fields.issueDate && data.fields.issueDate.value !== Acc.NR) ? data.fields.issueDate.value : '';
    const party = (data.fields.supplier && data.fields.supplier.value !== Acc.NR) ? data.fields.supplier.value : 'Non reconnu';
    const piece = (data.fields.invoiceNumber && data.fields.invoiceNumber.value !== Acc.NR) ? data.fields.invoiceNumber.value : '';
    const source = docMeta && docMeta.name ? docMeta.name : 'Document source non identifié';
    const isSale = data.docType === 'facture_vente';
    const isAvoir = data.docType === 'avoir';
    const sign = ttc < 0 ? -1 : 1;
    const A = (n) => Math.round(Math.abs(n) * sign * 100) / 100;
    const base = { date, piece, tiers: party, source, status: 'proposée (non validée)' };
    const vatLines = (acct, isDebit) => {
      if (Array.isArray(data.vat) && data.vat.length > 1) return data.vat.map(v => ({ ...base, journal: isSale ? R.journalVente : R.journalAchat, account: acct, label: Precompta.accountLabel(acct) + ' ' + v.rate + ' %', debit: isDebit ? A(v.amount) : 0, credit: isDebit ? 0 : A(v.amount) }));
      return vatAmt ? [{ ...base, journal: isSale ? R.journalVente : R.journalAchat, account: acct, label: Precompta.accountLabel(acct), debit: isDebit ? A(vatAmt) : 0, credit: isDebit ? 0 : A(vatAmt) }] : [];
    };
    const rows = isSale ? [
      { ...base, journal: R.journalVente, account: R.client, label: Precompta.accountLabel(R.client) + ' — ' + party, debit: A(ttc), credit: 0 },
      { ...base, journal: R.journalVente, account: R.venteProduit, label: Precompta.accountLabel(R.venteProduit), debit: 0, credit: A(ht) },
      ...vatLines(R.venteTva, false)
    ] : [
      { ...base, journal: R.journalAchat, account: R.achatCharge, label: Precompta.accountLabel(R.achatCharge), debit: A(ht), credit: 0 },
      ...vatLines(R.achatTva, true),
      { ...base, journal: R.journalAchat, account: R.fournisseur, label: Precompta.accountLabel(R.fournisseur) + ' — ' + party, debit: 0, credit: A(ttc) }
    ];
    if (isAvoir) for (const r of rows) { const d = r.debit; r.debit = r.credit; r.credit = d; r.label = 'Avoir — ' + r.label; }
    const sd = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100, sc = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;
    const allowed = Precompta.vatRates();
    let needsHuman = null;
    if (Array.isArray(data.vat) && data.vat.some(v => !allowed.includes(v.rate))) needsHuman = 'taux de TVA hors liste paramétrée (' + data.vat.map(v => v.rate).join(', ') + ' %) — régime et déductibilité à valider par le comptable';
    else if (!vatAmt && ht === ttc) needsHuman = 'facture sans TVA reconnue — vérifier le régime (franchise, exonération, autoliquidation) avant validation';
    else if (Array.isArray(data.vat) && data.vat.length > 1) needsHuman = 'plusieurs taux de TVA : la ventilation du HT par taux n’est pas reconnue — à compléter par le comptable';
    const accList = [...new Set(rows.map(r => r.account))].join('/');
    return { rows, balanced: Math.abs(sd - sc) <= 0.01, totalDebit: sd, totalCredit: sc, needsHuman,
      warning: 'Écriture PROPOSÉE et ' + (Math.abs(sd - sc) <= 0.01 ? 'équilibrée' : 'DÉSÉQUILIBRÉE') + ' — un équilibre arithmétique ne signifie pas validée par un comptable. Comptes (' + accList + ') issus du plan comptable configurable, à adapter au plan comptable du dossier et à valider explicitement avant tout import.' };
  },
  extractBank(text, pagesWords) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const F = (value, confidence) => ({ value: value == null || value === '' ? Acc.NR : value, confidence: value == null || value === '' ? 0 : confidence, page: 0, zone: value ? Acc.findZone(pagesWords, value) : null, status: value ? 'reconnu' : 'non-reconnu' });
    const labeled = (re) => { for (const l of lines) { const m = l.match(re); if (m && m[1]) return m[1].trim(); } return ''; };
    const moneyAfter = (re) => { const m = t.match(re); return m ? Acc.parseAmount(m[1]) : null; };
    const ibanM = t.match(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?\d{1,3})?\b/);
    const iban = ibanM ? ibanM[0].replace(/\s/g, '') : '';
    const opening0 = moneyAfter(/solde\s*(?:initial|précédent|precedent|d['’]ouverture|de départ)[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i);
    const closing0 = moneyAfter(/(?:nouveau\s*solde|solde\s*final|solde\s*(?:au|de clôture|de cloture))[^-\d\n]*(-?[\d ]+(?:[.,]\d{2})?)/i);
    const currency = /€|EUR/.test(t) ? 'EUR' : (/\$|USD/.test(t) ? 'USD' : '');
    const creditWords = /vir\s*reçu|vir\s*recu|crédit|credit|remise|salaire|remboursement|versement reçu|encaissement|d[ée]p[ôo]t|esp[èe]ces/i;
    const debitWords = /\bcb\b|carte|prlv|prélèvement|prelevement|vir\s*émis|vir\s*emis|paiement|retrait|chèque|cheque|frais|facture\s*n|loyer/i;
    const amountRe = /-?\(?[\d]{1,3}(?:[ \u00a0\u202f][\d]{3})*(?:[.,]\d{2})\)?|-?\d+(?:[.,]\d{2})/g;
    const lastAmountOfLine = (re) => { for (let li = 0; li < lines.length; li++) { if (!re.test(lines[li])) continue; for (const cand of [lines[li], lines[li + 1] || '']) { const clean = cand.replace(/\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}/g, ' '); const ms = [...clean.matchAll(amountRe)].map(m => Acc.parseAmount(m[0])).filter(x => x != null); if (ms.length) return ms[ms.length - 1]; } } return null; };
    const opening = lastAmountOfLine(/ancien\s+solde|solde\s*(?:initial|précédent|precedent|d['’]ouverture|de départ)/i) ?? opening0;
    const closing = lastAmountOfLine(/nouveau\s+solde|solde\s*(?:final|de clôture|de cloture)/i) ?? closing0;
    const printedTotals = (() => { for (const l of lines) { if (/total\s+des\s+opérations/i.test(l)) { const ms = [...l.matchAll(amountRe)].map(m => Acc.parseAmount(m[0])).filter(x => x != null); if (ms.length >= 2) return { debit: ms[ms.length - 2], credit: ms[ms.length - 1] }; } } return null; })();
    const transactions = [];
    // Regroupement préalable : une opération peut s'étaler sur plusieurs lignes
    // (libellé multi-ligne). Les lignes sans date qui suivent une opération lui
    // sont rattachées au lieu d'être perdues.
    const isTotalLine = (l) => /^(?:solde|total|nouveau solde)\b/i.test(l) || /(solde|total)\s*(initial|final|d['’]ouverture|de cl[oô]ture|pr[ée]c[ée]dent)/i.test(l);
    const rawOps = []; let curOp = null;
    for (const l of lines) {
      const dm = l.match(/^(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\s+(?:(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\s+)?(.+)$/);
      if (dm) { curOp = { date: dm[1], valueDate: dm[2] || null, parts: [dm[3]] }; rawOps.push(curOp); continue; }
      if (!curOp) continue;
      if (isTotalLine(l) || /^(iban|bic|swift|titulaire|banque|relevé|extrait|page\s+\d)/i.test(l)) { curOp = null; continue; }
      if (/^(date|libellé|opération|operation)\b/i.test(l) && /(débit|crédit|libellé|montant|solde)/i.test(l)) continue;
      curOp.parts.push(l);
    }
    for (const op of rawOps) {
      const rest = op.parts.join(' ');
      const matches = [...rest.matchAll(amountRe)].map(m => ({ raw: m[0], start: m.index, end: m.index + m[0].length, v: Acc.parseAmount(m[0]) })).filter(x => x.v != null);
      if (!matches.length) continue;
      // Choix du montant d'opération et du solde : JAMAIS « avant-dernier par défaut »
      // sans contrôle. Si un nombre est suivi de texte dans le libellé, il appartient
      // au libellé ; le dernier nombre peut être un solde seulement s'il suit le montant.
      let amountM = null, balanceM = null;
      if (matches.length >= 2) {
        const last = matches[matches.length - 1], prev = matches[matches.length - 2];
        const between = rest.slice(prev.end, last.start).trim();
        if (matches.length === 2 && between.length > 0) { amountM = last; }
        else { amountM = prev; balanceM = last; }
      } else amountM = matches[0];
      const amount = amountM.v, balance = balanceM ? balanceM.v : null;
      let label = rest;
      for (const m of [balanceM, amountM]) if (m) label = label.slice(0, m.start) + ' ' + label.slice(m.end);
      label = label.replace(/[¨þ]/g, ' ').replace(/\s{2,}/g, ' ').replace(/[-–—|:]+$/, '').trim();
      const refM = rest.match(/(?:réf\.?|ref\.?|référence)\s*[:#]?\s*([A-Z0-9\-\/]{3,30})/i);
      const refEmb = !refM ? rest.match(/\b(FR\d{2}ZZZ\d{6,}|[A-Z]{1,4}\d{2,}-[A-Z0-9-]{4,}|\d{7,})\b/) : null;
      let debit = null, credit = null, conf = 70, status = 'reconnu';
      const signed = /-\s?[\d]/.test(rest) || /\([\d ]+[.,]\d{2}\)/.test(rest);
      if (signed || debitWords.test(label)) debit = Math.abs(amount);
      else if (creditWords.test(label) || /\+\s?[\d]/.test(rest)) credit = Math.abs(amount);
      else { status = 'a-verifier'; conf = 40; }
      const normDate = (d) => { const pr = d.replace(/[.\-]/g, '/').split('/'); if (pr.length === 3 && pr[2].length === 2) pr[2] = '20' + pr[2]; return pr.join('/'); };
      const txo = { date: normDate(op.date), valueDate: op.valueDate ? normDate(op.valueDate) : null, label: label || Acc.NR, reference: refM ? refM[1] : (refEmb ? refEmb[1] : null), debit, credit, balance, page: 0, confidence: conf, status };
      if (pagesWords && pagesWords.length) { const z = Acc.findZone(pagesWords, txo.label); if (z) txo.page = z.page; }
      transactions.push(txo);
    }
    const posTx = Acc.bankFromPositions(pagesWords);
    if (posTx && posTx.length) {
      // Fusion (jamais de remplacement perdant) : les positions priment quand elles
      // couvrent au moins autant d'opérations ; sinon on ajoute celles du texte
      // absentes des positions (même date + même montant).
      if (!transactions.length || posTx.length >= transactions.length) { transactions.length = 0; transactions.push(...posTx); }
      else {
        const key = (x) => x.date + '|' + (x.debit ?? x.credit ?? x.balance ?? '');
        const seen = new Set(posTx.map(key));
        transactions.push(...posTx);
        // les opérations texte déjà couvertes par les positions sont retirées au profit des positions
        for (let i = transactions.length - posTx.length - 1; i >= 0; i--) if (seen.has(key(transactions[i]))) transactions.splice(i, 1);
      }
    }
    // doublons potentiels : même date + même libellé + même montant
    const seen = new Map(); const duplicates = [];
    transactions.forEach((tx, i) => {
      const key = [tx.date, Acc._norm(tx.label), tx.debit ?? tx.credit ?? ''].join('|');
      if (seen.has(key)) { duplicates.push({ index: i, with: seen.get(key) }); tx.duplicate = true; }
      else seen.set(key, i);
    });
    const sumC = transactions.reduce((s, x) => s + (x.credit || 0), 0);
    const sumD = transactions.reduce((s, x) => s + (x.debit || 0), 0);
    const unknown = transactions.filter(x => x.status === 'a-verifier').length;
    const controls = [];
    if (opening != null && closing != null) {
      const calc = Math.round((opening + sumC - sumD) * 100) / 100;
      controls.push({ label: 'Solde d\'ouverture + crédits − débits = clôture', ok: unknown === 0 && Math.abs(calc - closing) <= 0.05, detail: `Ouverture ${opening} + crédits ${Math.round(sumC * 100) / 100} − débits ${Math.round(sumD * 100) / 100} = ${calc} · Clôture reconnue : ${closing}` + (unknown ? ` · ${unknown} opération(s) sans sens déterminé exclue(s) du calcul` : ''), recalculated: calc });
    }
    if (opening == null || closing == null) controls.push(Acc.ctl('Solde d\'ouverture + crédits − débits = clôture', 'impossible', `Solde d'ouverture : ${opening == null ? 'non reconnu' : opening} · Solde de clôture : ${closing == null ? 'non reconnu' : closing} : aucune comparaison effectuée.`));
    if (!transactions.length) controls.push(Acc.ctl('Transactions présentes', 'impossible', 'Aucune opération reconnue : relevé non vérifiable.'));
    const lastBal = [...transactions].reverse().find(x => x.balance != null);
    if (lastBal && closing != null) controls.push({ label: 'Dernier solde de ligne = clôture', ok: Math.abs(lastBal.balance - closing) <= 0.05, detail: `Dernier solde reconnu : ${lastBal.balance} · Clôture : ${closing}`, recalculated: lastBal.balance });
    const withBal = transactions.filter(x => x.balance != null);
    if (withBal.length >= 2) {
      let steps = 0, breaks = 0;
      for (let i = 1; i < withBal.length; i++) {
        const prev = withBal[i - 1], x = withBal[i];
        if (x.debit == null && x.credit == null) continue;
        const expected = Math.round((prev.balance + (x.credit || 0) - (x.debit || 0)) * 100) / 100;
        steps++; if (Math.abs(expected - x.balance) > 0.05) breaks++;
      }
      if (steps) controls.push(Acc.ctl('Cohérence des soldes ligne à ligne', breaks ? 'ecart' : 'conforme', breaks ? breaks + ' rupture(s) de solde sur ' + steps + ' enchaînement(s) vérifié(s) : un montant, un sens ou un solde est probablement mal lu.' : steps + ' enchaînement(s) de solde vérifié(s) sans rupture (solde précédent + crédit − débit = solde de la ligne).'));
    }
    if (printedTotals) controls.push(Acc.ctl('Totaux imprimés du relevé vs opérations extraites', (Math.abs(sumD - printedTotals.debit) <= 0.05 && Math.abs(sumC - printedTotals.credit) <= 0.05) ? 'conforme' : 'ecart', 'Imprimé : débits ' + printedTotals.debit + ' · crédits ' + printedTotals.credit + ' — Extrait : débits ' + Math.round(sumD * 100) / 100 + ' · crédits ' + Math.round(sumC * 100) / 100 + (Math.abs(sumD - printedTotals.debit) > 0.05 || Math.abs(sumC - printedTotals.credit) > 0.05 ? ' : des opérations manquent ou des montants/sens sont erronés.' : '')));
    if (duplicates.length) controls.push({ label: 'Doublons potentiels', ok: false, detail: duplicates.length + ' opération(s) avec même date, libellé et montant : signalées, jamais supprimées automatiquement.', recalculated: null });
    if (unknown) controls.push({ label: 'Opérations à vérifier', ok: false, detail: unknown + ' opération(s) sans sens (débit/crédit) déterminé : à classer manuellement.', recalculated: null });
    const acctNum = (t.match(/compte\s*(?:courant\s*)?n°\s*(\d[\d ]{5,}\d)/i) || [])[1] || '';
    const holderLine = lines.find(l => /compte\s+courant/i.test(l) && / - /.test(l));
    const knownBank = (t.match(/(Crédit Agricole|Credit Agricole|BNP Paribas|Société Générale|Societe Generale|Banque Populaire|Caisse d['’]Epargne|Crédit Mutuel|Credit Mutuel|La Banque Postale|LCL|Qonto|Boursorama)/i) || [])[1] || '';
    const fields = {
      bank: F(knownBank || labeled(/(?:banque|établissement|etablissement)\s*[:\-]\s*(.+)$/i), 75),
      holder: F(labeled(/(?:titulaire|nom du compte|compte de)\s*[:\-]\s*(.+)$/i), 75),
      iban: F(iban, 90), bic: F(labeled(/\b(?:bic|swift)\s*[:\-]?\s*([A-Z]{6}[A-Z0-9]{2,5})/i), 85),
      openingBalance: F(opening != null ? String(opening) : '', 85), closingBalance: F(closing != null ? String(closing) : '', 85),
      currency: F(currency, 80),
      accountNumber: F(acctNum.replace(/\s/g, ''), 85),
      holder2: F(holderLine ? holderLine.split(/\s+-\s+\s*Compte/i)[0].trim() : '', 70),
      period: { value: transactions.length ? transactions[0].date + ' → ' + transactions[transactions.length - 1].date : Acc.NR, confidence: transactions.length ? 60 : 0, page: 0, zone: null, status: transactions.length ? 'calcule' : 'non-reconnu' }
    };
    return { docType: 'releve_bancaire', kind: 'bank', fields, transactions, duplicates, controls,
      totals: { credit: Math.round(sumC * 100) / 100, debit: Math.round(sumD * 100) / 100, count: transactions.length },
      disclaimer: "Relevé reconnu localement. Contrôles de cohérence uniquement : ceci n'est pas un rapprochement bancaire complet (aucune comparaison avec des écritures comptables)." };
  },
  /* Propositions de comptes pour un relevé bancaire (V2.16) : journal BQ du dossier,
     compte banque 512 configurable (JAMAIS confondu avec l'IBAN), contrepartie par
     règles configurables + apprentissage des corrections validées. Inconnu = en
     attente, jamais d'affectation inventée. */
  bankProposals(data) {
    const R = Precompta.rules(); const chart = Precompta.chart(); const rules = Precompta.bankRules(); const learnedRules = Precompta.learnedRules();
    const acctOf = (num) => chart.find(a => a.num === String(num)) || null;
    const fmtA = (num) => { const a = acctOf(num); return a ? num + ' — ' + a.label : num + ' (absent du plan du dossier : à créer ou corriger)'; };
    const txs = data.transactions || [];
    const benef = txs.map(tx => Precompta.beneficiaryTokens(tx.label || ''));
    const sensOf = (tx) => tx.debit != null ? 'sortie' : (tx.credit != null ? 'entree' : null);
    // Appariement bénéficiaire : exact (mêmes jetons, ordre indifférent) = certain ;
    // recouvrement partiel d'un seul jeton ou recouvrement croisé = INCERTAIN (à confirmer).
    const matchLearned = (i) => {
      const toks = benef[i], sens = sensOf(txs[i]); const exact = [], partial = [];
      for (const r of learnedRules) {
        if (r.direction && sens && r.direction !== sens) continue;
        const rt = new Set(r.tokens || []); if (!rt.size || !toks.length) continue;
        const inter = toks.filter(x => rt.has(x));
        const isExact = inter.length === rt.size && inter.length === toks.length;
        const isSubset = inter.length === rt.size || inter.length === toks.length;
        if (isExact || (isSubset && inter.length >= 2)) exact.push(r);
        else if (inter.length >= 1) partial.push(r);
      }
      return { exact, partial };
    };
    return txs.map((tx, i) => {
      const sens = sensOf(tx);
      const amount = tx.debit ?? tx.credit ?? null;
      const nature = Precompta.detectNature(tx.label || '', sens);
      // Opérations similaires dans CE relevé : même bénéficiaire exact qu'une autre ligne.
      const similar = txs.map((o, j) => j).filter(j => j !== i && benef[j].length && benef[i].length
        && benef[j].slice().sort().join(' ') === benef[i].slice().sort().join(' ') && sensOf(txs[j]) === sens);
      let counter = tx.account || null, conf = counter ? 65 : 0, why = counter ? 'Compte affecté/corrigé explicitement par l\u2019utilisateur' : null,
        alternatives = [], learnedHit = false, origin = counter ? 'utilisateur' : null, suggestion = null;
      const { exact, partial } = counter ? { exact: [], partial: [] } : matchLearned(i);
      if (!counter && exact.length) {
        const accounts = [...new Set(exact.map(r => r.account))];
        const conflictRule = exact.find(r => r.conflictAccounts && r.conflictAccounts.length > 1);
        if (conflictRule || accounts.length > 1) {
          suggestion = { account: null, accounts: (conflictRule ? conflictRule.conflictAccounts : accounts), confidence: 30, reason: 'Conflit entre règles apprises pour ce bénéficiaire : choisir explicitement le bon compte (aucune résolution automatique).' };
        } else {
          counter = exact[0].account; conf = 90; learnedHit = true; origin = 'apprentissage';
          why = 'Règle apprise de vos corrections validées (bénéficiaire « ' + (exact[0].tokens || []).join(' ') + ' »' + (exact[0].direction ? ', sens ' + exact[0].direction : '') + ')';
        }
      }
      if (!counter && !suggestion) for (const r of rules) {
        if (r.sens && sens && r.sens !== sens) continue;
        let re; try { re = new RegExp(r.pattern, 'i'); } catch (e) { continue; }
        if (re.test(tx.label || '')) { counter = r.account; conf = r.conf || 50; why = r.why || 'Règle configurable du dossier'; alternatives = r.alternatives || []; origin = 'règle du dossier'; break; }
      }
      if (!counter && !suggestion && partial.length) {
        const accounts = [...new Set(partial.map(r => r.account))];
        suggestion = { account: accounts.length === 1 ? accounts[0] : null, accounts, confidence: 40, reason: 'Correspondance incertaine avec une règle apprise (nom partiellement commun : « ' + (partial[0].tokens || []).join(' ') + ' ») : proposition à confirmer explicitement, jamais appliquée automatiquement.' };
      }
      const acct = counter ? acctOf(counter) : null;
      const issues = [];
      if (!sens || amount == null) issues.push('sens ou montant non reconnu');
      if (!counter && !suggestion) issues.push('aucune contrepartie proposée : à affecter manuellement');
      if (suggestion) issues.push('proposition incertaine à confirmer (non exportée tant qu\u2019elle n\u2019est pas acceptée)');
      if (counter && !acct) issues.push('compte ' + counter + ' absent du plan du dossier');
      if (counter && acct && !acct.active) issues.push('compte ' + counter + ' inactif dans le plan du dossier');
      const bankNum = R.banque, bankAcct = acctOf(bankNum);
      if (!bankAcct) issues.push('compte banque ' + bankNum + ' absent du plan du dossier');
      else if (!bankAcct.active) issues.push('compte banque ' + bankNum + ' inactif dans le plan du dossier');
      // Écriture : sortie = contrepartie débitée / 512 crédité ; entrée = inverse.
      // Jamais d'écriture si la contrepartie ou la banque est absente/inactive du plan.
      const usable = counter && acct && acct.active && bankAcct && bankAcct.active;
      const entries = (usable && sens && amount != null) ? (sens === 'sortie'
        ? [{ account: counter, debit: amount, credit: 0 }, { account: bankNum, debit: 0, credit: amount }]
        : [{ account: bankNum, debit: amount, credit: 0 }, { account: counter, debit: 0, credit: amount }]) : [];
      return { index: i, date: tx.date, valueDate: tx.valueDate || null, label: tx.label, reference: tx.reference || null, sens, amount, nature,
        journal: R.journalBanque || 'BQ', bankAccount: bankNum, bankAccountLabel: fmtA(bankNum),
        counterAccount: counter, counterLabel: counter ? fmtA(counter) : 'En attente d\u2019affectation',
        counterExists: !!acct, counterActive: acct ? !!acct.active : false,
        confidence: conf, explanation: why || 'Aucune règle reconnue pour ce libellé : compte laissé en attente (jamais inventé).',
        alternatives: alternatives.map(fmtA), learned: learnedHit, origin, suggestion,
        similarIndexes: similar, similarLabels: similar.map(j => txs[j].label),
        issues, entries,
        status: 'proposée (non validée)' };
    });
  },
  bankEntriesCsv(data, docMeta = {}) {
    // Export d'écritures PROPOSÉES au format CSV générique documenté (une ligne par
    // mouvement comptable) : Date;Journal;Pièce;Compte;Libellé;Référence;Débit;Crédit;Statut.
    // Aucune compatibilité universelle n'est prétendue : voir le format documenté
    // dans docs/RAPPORT-RELEVE-COMPLET.md (logiciel cible et mapping de colonnes).
    const props = Acc.bankProposals(data);
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['Date', 'Journal', 'Pièce', 'Compte', 'Libellé', 'Référence', 'Débit', 'Crédit', 'Statut validation']];
    const problems = [];
    const seen = new Map();
    for (const pr of props) {
      const key = [pr.date, Acc._norm(pr.label), pr.amount].join('|');
      if (seen.has(key)) problems.push('Doublon potentiel : ' + pr.date + ' ' + pr.label + ' (' + pr.amount + ')');
      seen.set(key, true);
      if (pr.issues.length) problems.push(pr.date + ' ' + pr.label + ' : ' + pr.issues.join(' · '));
      if (!pr.entries.length) { if (pr.counterAccount && (!pr.counterExists || !pr.counterActive)) problems.push(pr.date + ' ' + pr.label + ' : NON exportée (contrepartie absente ou inactive du plan)'); continue; }
      for (const e of pr.entries) rows.push([pr.date, pr.journal, pr.reference || (docMeta.invoiceNumber || ''), e.account, pr.label, pr.reference || '', e.debit || '', e.credit || '', pr.status]);
    }
    const td = rows.slice(1).reduce((s, r) => s + (parseFloat(String(r[6]).replace(',', '.')) || 0), 0);
    const tc = rows.slice(1).reduce((s, r) => s + (parseFloat(String(r[7]).replace(',', '.')) || 0), 0);
    return { csv: rows.map(r => r.map(esc).join(';')).join('\n'), problems, balanced: Math.abs(td - tc) <= 0.01, totalDebit: Math.round(td * 100) / 100, totalCredit: Math.round(tc * 100) / 100, proposals: props };
  },
  toBankCsv(data) {
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['Date', 'Date de valeur', 'Libellé', 'Référence', 'Débit', 'Crédit', 'Solde', 'Confiance %', 'À vérifier']];
    for (const x of data.transactions || []) rows.push([x.date, x.valueDate || '', x.label, x.reference || '', x.debit ?? '', x.credit ?? '', x.balance ?? '', x.confidence, x.duplicate ? 'doublon ?' : (x.status === 'a-verifier' ? 'oui' : '')]);
    return rows.map(r => r.map(esc).join(';')).join('\n');
  },
  toCsv(data) {
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [['Type', data.docType || ''], ['Champ', 'Valeur', 'Confiance %', 'Page']];
    for (const [k, f] of Object.entries(data.fields || {})) rows.push([k, f.value, f.confidence, (f.page || 0) + 1]);
    rows.push([]);
    rows.push(['Description', 'Quantité', 'Prix unitaire HT', 'Remise', 'TVA %', 'Montant HT']);
    for (const l of data.lines || []) rows.push([l.description, l.qty, l.unitPrice, l.discount ?? '', l.vatRate ?? '', l.amount]);
    rows.push([]);
    rows.push(['Taux TVA %', 'Montant TVA']);
    for (const v of data.vat || []) rows.push([v.rate, v.amount]);
    return rows.map(r => r.map(esc).join(';')).join('\n');
  }
};

/* --------------------------------------------------------- assistant local -- */
const AI = {
  extractInvoice(text) {
    const t = String(text || '');
    const lines = t.split(/\n/).map(x => x.trim()).filter(Boolean);
    const cleanNum = (v) => { const m = String(v || '').replace(/\s/g, '').match(/-?\d+(?:[.,]\d{1,2})?/); return m ? m[0].replace(',', '.') : ''; };
    const findMoney = (patterns) => { for (const re of patterns) { const m = t.match(re); if (m) return cleanNum(m[1] || m[0]); } return ''; };
    const labeled = (labels) => { for (const line of lines) { const m = line.match(new RegExp('(?:' + labels + ')\\s*[:#-]\\s*(.+)$', 'i')); if (m && m[1].trim()) return m[1].trim().slice(0, 90); } return ''; };
    const totalTTC = findMoney([/total\s*(?:ttc|à payer|a payer)[^\d-]*(-?[\d .]+(?:[,.]\d{2})?)/i, /net\s*à payer[^\d-]*(-?[\d .]+(?:[,.]\d{2})?)/i]);
    const totalHT = findMoney([/total\s*(?:ht|hors taxe)[^\d-]*(-?[\d .]+(?:[,.]\d{2})?)/i, /montant\s*ht[^\d-]*(-?[\d .]+(?:[,.]\d{2})?)/i]);
    const tvaAmt = findMoney([/(?:montant\s*)?tva\s*(?:\d+[,.]?\d*\s*%)?[^\d-]*(-?[\d .]+(?:[,.]\d{2})?)\s*(?:€|EUR)?/i]);
    const tvaRateM = t.match(/tva\s*(?:à|a)?\s*(\d{1,2}(?:[,.]\d{1,2})?)\s*%/i);
    const dates = [...t.matchAll(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/g)].map(m => m[1]);
    const due = labeled('date d.?échéance|échéance|à régler avant|payable avant');
    const invoiceNo = (t.match(/\bFAC-\d{4}-\d+\b/i) || [''])[0] || labeled('facture\s*(?:n[°o]?|numéro)|n[°o]\s*de facture|numéro de facture|invoice\s*(?:no|number)') || (t.match(/\b(?:FAC|FACT)[- ]\d[A-Z0-9-]{2,20}\b/i) || [''])[0];
    const siretM = t.match(/\b(?:siret|siren)\s*:?\s*(\d[\d ]{8,20})/i);
    const supplier = labeled('fournisseur|émetteur|emetteur|société|entreprise') || (lines.find(l => l.length > 2 && !/facture|devis|date|total|tva/i.test(l)) || '');
    const currency = /€|EUR/.test(t) ? 'EUR' : (/\$|USD/.test(t) ? 'USD' : '');
    const orderRef = labeled('référence\s*(?:de\s*)?commande|bon de commande|commande\s*n[°o]?|référence client');
    const nd = 'Non détecté'; const val = (v) => v && String(v).trim() ? String(v).trim() : nd;
    return { supplier: val(supplier), company: val(supplier), invoiceNumber: val(invoiceNo), issueDate: val(labeled('date') || dates[0]), dueDate: val(due || (dates.length > 1 ? dates[1] : '')), totalHT: val(totalHT), vatRate: val(tvaRateM ? tvaRateM[1].replace(',', '.') + ' %' : ''), vatAmount: val(tvaAmt), totalTTC: val(totalTTC), currency: val(currency), siret: val(siretM ? siretM[1].replace(/\s+/g, ' ') : ''), orderRef: val(orderRef), disclaimer: 'Extraction locale à vérifier. Ce n’est pas une validation comptable officielle.' };
  },
  invoiceCsv(inv) {
    const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const labels = { supplier: 'Fournisseur', company: 'Entreprise', invoiceNumber: 'Numéro de facture', issueDate: "Date d'émission", dueDate: "Date d'échéance", totalHT: 'Montant HT', vatRate: 'Taux TVA', vatAmount: 'Montant TVA', totalTTC: 'Montant TTC', currency: 'Devise', siret: 'SIREN/SIRET', orderRef: 'Référence commande' };
    return 'Champ;Valeur\n' + Object.keys(labels).map(k => esc(labels[k]) + ';' + esc(inv[k])).join('\n');
  },
  classify(text) {
    const t = (text || '').toLowerCase();
    const rules = [
      { key: 'Facture', icon: 'i-pdf', words: ['facture', 'invoice', 'total ttc', 'tva', 'montant ht', 'à payer', 'échéance', 'numéro de facture', 'siret', 'paiement'] },
      { key: 'Contrat', icon: 'i-file', words: ['contrat', 'clause', 'signataire', 'les parties', 'engagement', 'durée du contrat', 'résiliation', 'bail'] },
      { key: 'Identité', icon: 'i-shield', words: ['passeport', 'carte nationale', 'identité', 'date de naissance', 'nationalité', 'prénom', 'né le', 'permis de conduire', 'séjour'] },
      { key: 'Bulletin de paie', icon: 'i-docs', words: ['bulletin de paie', 'salaire brut', 'net à payer', 'cotisations', 'urssaf', 'cumul imposable', 'employeur', 'salaire net'] },
      { key: 'Courrier', icon: 'i-folder', words: ['madame', 'monsieur', 'objet :', 'cordialement', 'nous vous informons', 'lettre', 'cher client'] }
    ];
    const scores = rules.map(r => {
      let hits = 0; const found = [];
      for (const w of r.words) if (t.includes(w)) { hits += (w.length > 8 ? 2 : 1); found.push(w); }
      return { key: r.key, icon: r.icon, score: hits, found };
    }).sort((a, b) => b.score - a.score);
    const best = scores[0];
    const total = scores.reduce((s, x) => s + x.score, 0) || 1;
    if (best.score < 2) return { label: 'Autre', icon: 'i-file', confidence: Math.min(60, 25 + total * 3), found: [] };
    return {
      label: best.key, icon: best.icon,
      confidence: clamp(Math.round((best.score / total) * 100), 35, 97),
      found: best.found.slice(0, 6),
      others: scores.slice(1, 3).filter(s => s.score > 0)
    };
  },
  entities(text) {
    const t = text || '';
    const grab = (re, transform = (m) => m[0]) => {
      const out = new Set(); let m;
      const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let guard = 0;
      while ((m = r.exec(t)) && guard++ < 200) { const v = transform(m); if (v) out.add(String(v).trim()); }
      return Array.from(out).slice(0, 8);
    };
    const dates = grab(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/);
    grab(/\b(\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{4})\b/i,
      m => m[0]).forEach(d => dates.push(d));
    const amounts = grab(/(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[.,]\d{2})?\s?(?:€|EUR|euros?|\$|USD)/i, m => m[0]);
    const refs = grab(/\b(?:fact(?:ure)?|fac|ref|réf|ref|devis|commande|cmd|dossier|contrat|police)[\s:#\-]*([A-Z0-9][A-Z0-9\-\/]{3,20})/gi,
      m => m[0]);
    const siret = grab(/\b(?:siret|siren)\s*:?\s*(\d[\d ]{8,20})/gi, m => m[0]);
    const iban = grab(/\bFR\d{2}(?:[ ]?\d{4}){5}[ ]?\d{3}\b/gi, m => m[0]);
    const mails = grab(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/gi, m => m[0]);
    const phones = grab(/\b(?:0\d(?:[ .\-]?\d{2}){4})\b/g, m => m[0]);
    const names = (() => {
      const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
      const cands = [];
      for (const l of lines) {
        const m = l.match(/\b(?:M\.|Mme|Monsieur|Madame|Client|Nom|Destinataire)\s*:?\s*([A-ZÉÈÀÂÎÔÛ][\wéèàâîôûç'\-]+(?:\s+[A-ZÉÈÀÂÎÔÛ][\wéèàâîôûç'\-]+){0,2})/);
        if (m) cands.push(m[1]);
      }
      return Array.from(new Set(cands)).slice(0, 5);
    })();
    return { dates, amounts, refs, siret, iban, mails, phones, names };
  },
  summary(text, maxSentences = 4) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    const sentences = clean.split(/(?<=[.!?])\s+/).filter(s => s.length > 25);
    if (!sentences.length) return clean.slice(0, 400) + (clean.length > 400 ? '…' : '');
    const stop = new Set(('le la les de des du un une et en à au aux pour par sur avec dans est sont a ont ce cette ces que qui quoi dont où il elle ils elles nous vous se sa son ses leur leurs plus moins très être avoir fait comme tout tous toute toutes mais ou donc or ni car si ne pas y d l qu c j n s t m').split(' '));
    const freq = new Map();
    for (const w of clean.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœæ]{4,}/g) || []) {
      if (stop.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    const top = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(e => e[0]);
    const scored = sentences.map((s, i) => {
      const lw = s.toLowerCase();
      let sc = top.reduce((acc, w) => acc + (lw.includes(w) ? 1 : 0), 0);
      sc += Math.max(0, 6 - i) * 0.6;                    // début de document
      sc += /facture|total|montant|date|contrat|objet|référence/i.test(s) ? 1.5 : 0;
      return { s, sc, i };
    }).sort((a, b) => b.sc - a.sc).slice(0, maxSentences).sort((a, b) => a.i - b.i);
    return scored.map(x => '• ' + x.s.trim()).join('\n');
  },
  search(text, q) {
    if (!q || q.trim().length < 2) return [];
    const t = text || '';
    const needle = q.trim().toLowerCase();
    const out = [];
    let idx = t.toLowerCase().indexOf(needle), guard = 0;
    while (idx !== -1 && guard++ < 25) {
      const start = Math.max(0, idx - 60), end = Math.min(t.length, idx + needle.length + 60);
      out.push({ before: t.slice(start, idx), match: t.substr(idx, needle.length), after: t.slice(idx + needle.length, end) });
      idx = t.toLowerCase().indexOf(needle, idx + needle.length);
    }
    return out;
  }
};

function rerenderAiPanels() {
  const doc = App.doc;
  if (!doc) return;
  const text = doc.text || '';
  const hasText = text.trim().length > 20;
  if (!hasText) return;
  const c = AI.classify(text);
  const elC = $('#aiClass');
  if (elC) elC.innerHTML = `
    <div class="row" style="gap:9px;align-items:center">
      <span class="tag blue" style="font-size:12px;padding:5px 10px">${ICON(c.icon, 'ico sm')} ${escapeHtml(c.label)}</span>
      <span class="tiny muted">confiance estimée ${c.confidence} %</span>
    </div>
    ${c.found && c.found.length ? `<p class="tiny muted mt6 mb0">Indices : ${c.found.map(escapeHtml).join(', ')}</p>` : ''}`;
  const e = AI.entities(text);
  const elE = $('#aiEntities');
  if (elE) {
    const block = (label, arr) => arr && arr.length
      ? `<div class="mt10"><div class="tiny muted mb6" style="font-weight:700;text-transform:uppercase;letter-spacing:.4px">${label}</div>
         <div class="row wrap" style="gap:6px">${arr.map(v => `<span class="tag" style="font-size:11px;padding:4px 8px">${escapeHtml(v)}</span>`).join('')}</div></div>`
      : '';
    const html = block('Dates', e.dates) + block('Montants', e.amounts) + block('Références', e.refs) +
      block('Noms', e.names) + block('E-mails', e.mails) + block('Téléphones', e.phones) +
      block('SIRET / SIREN', e.siret) + block('IBAN', e.iban);
    elE.innerHTML = html || '<p class="small muted mb0">Aucune entité détectée automatiquement dans ce texte.</p>';
  }
  const elS = $('#aiSummary');
  if (elS) elS.innerHTML = `<div class="ai-out">${escapeHtml(AI.summary(text) || '—')}</div>`;
}

/* ============================================================= PARAMÈTRES == */
function settingLangs() {
  const s = openSheet({
    title: 'Langues OCR',
    sub: 'Choisissez les langues à reconnaître. Le pack de langue est téléchargé une seule fois.',
    body: `<div class="sheet-list">
      ${[['fra+eng', 'Français + Anglais', 'recommandé'], ['fra', 'Français', ''], ['eng', 'Anglais', ''], ['spa', 'Espagnol', 'nouveau'], ['deu', 'Allemand', 'nouveau'], ['ita', 'Italien', 'nouveau'], ['por', 'Portugais', 'nouveau'], ['fra+eng+spa', 'Français + Anglais + Espagnol', 'multi'], ['fra+eng+deu', 'Français + Anglais + Allemand', 'multi']].map(([k, l, tag]) =>
        `<button data-lang="${k}"><svg class="ico"><use href="#i-text"/></svg>
          <span class="grow">${l}</span>${tag ? `<span class="tag blue">${tag}</span>` : ''}
          ${Settings.get('ocrLangs') === k ? `<span class="tag ok">actif</span>` : ''}</button>`).join('')}
      </div>`,
    actions: [{ label: 'Fermer', cls: 'ghost' }]
  });
  $$('[data-lang]', s).forEach(b => b.addEventListener('click', async () => {
    Settings.set('ocrLangs', b.dataset.lang);
    closeSheet();
    await render();
    toast('Langues OCR mises à jour', 'ok');
  }));
}
function settingQuality() {
  const s = openSheet({
    title: 'Qualité des exports',
    sub: 'Elle influe sur la netteté du PDF et la taille du fichier.',
    body: `<div class="sheet-list">
      ${[['high', 'Élevée', '2400 px · fichiers plus lourds'], ['standard', 'Standard', '1600 px · plus rapide']].map(([k, l, d]) =>
        `<button data-q="${k}"><svg class="ico"><use href="#i-image"/></svg>
          <span class="grow"><b>${l}</b><br><span class="tiny muted">${d}</span></span>
          ${Settings.get('quality') === k ? `<span class="tag ok">actif</span>` : ''}</button>`).join('')}
      </div>`,
    actions: [{ label: 'Fermer', cls: 'ghost' }]
  });
  $$('[data-q]', s).forEach(b => b.addEventListener('click', async () => {
    Settings.set('quality', b.dataset.q); closeSheet(); await render();
    toast('Qualité enregistrée', 'ok');
  }));
}
function showInfoSheet(kind) {
  const content = {
    roadmap: `<h3 style="font-size:15px">V2 — Capture avancée</h3>
      <p class="small muted">Détection automatique des contours (vision), correction de perspective à 4 points,
      filtres avancés, réorganisation des pages par glisser-déposer.</p>
      <h3 style="font-size:15px">V3 — Assistant IA</h3>
      <p class="small muted">Résumé par modèle de langage, extraction structurée de factures, classement automatique
      et recherche sémantique. <b>Nécessite un backend</b> : la clé API ne doit jamais être dans le navigateur.</p>
      <h3 style="font-size:15px">V4 — Application Android native</h3>
      <p class="small muted">Kotlin + CameraX + ML Kit Text Recognition + PdfDocument/Ghostscript, APK signé,
      stockage scoped, partage Android, mode hors-ligne complet.</p>`,
    permissions: `<div class="sheet-list" style="gap:10px">
      <div><b>Caméra</b><span class="tiny muted">Demandée uniquement au clic sur « Scanner avec la caméra ».
      Refus possible : l'import depuis la galerie reste disponible.</span></div>
      <div><b>Fichiers</b><span class="tiny muted">Le sélecteur du navigateur ne donne accès qu'aux fichiers
      que vous choisissez explicitement.</span></div>
      <div><b>Presse-papiers</b><span class="tiny muted">Uniquement lors d'un clic sur « Copier ».</span></div>
      <div><b>Réseau</b><span class="tiny muted">Nécessaire au premier chargement des bibliothèques et du pack de
      langue OCR. Aucun document n'est transmis.</span></div></div>`,
    help: `<ul class="small" style="padding-left:18px;margin:0;line-height:1.7">
      <li>Éclairez uniformément, évitez les ombres et les reflets.</li>
      <li>Cadrez le document entier, sans doigts sur le texte.</li>
      <li>Utilisez le mode <b>Document</b> pour un contraste net.</li>
      <li>Gardez le téléphone parallèle à la feuille (moins de perspective).</li>
      <li>Pour les factures, un scan droit améliore beaucoup l'extraction.</li>
      <li>Le français et l'anglais sont reconnus ; les autres langues ne sont pas encore incluses.</li></ul>`,
    ia: `<p class="small">Pour activer l'assistant IA avancé, il faut :</p>
      <ul class="small" style="padding-left:18px;line-height:1.7">
        <li>un backend (Node, Python ou serverless) qui détient la clé API ;</li>
        <li>une politique claire de consentement affichée avant tout envoi ;</li>
        <li>un mode « traitement local uniquement » par défaut.</li></ul>
      <p class="small muted">Aucune clé API n'est intégrée dans cette version.</p>`
  }[kind] || '';
  const titles = { roadmap: 'Feuille de route', permissions: 'Permissions', help: 'Aide & bonnes pratiques', ia: 'Activer l\'IA avancée' };
  openSheet({ title: titles[kind], body: content, actions: [{ label: 'Fermer', cls: 'ghost' }] });
}

/* ================================================================ ACTIONS == */
Object.assign(Actions, {
  /* navigation */
  'go-home': () => go('home'),
  'go-docs': () => { App.search = ''; go('docs'); },
  'go-settings': () => go('settings'),
  'go-back': () => {
    if (App.route === 'detail') go('docs'); else go('home');
  },
  'filter-docs': (el) => { App.docFilter = el.dataset.key; render(); },
  'clear-search': () => { App.search = ''; render(); },
  'open-doc': (el) => { if (App.selectionMode) { const id=el.dataset.id; App.selectedDocs.has(id) ? App.selectedDocs.delete(id) : App.selectedDocs.add(id); render(); return; } App.detailTab = 'preview'; go('detail', el.dataset.id); },
  'doc-menu': (el, e) => { e.stopPropagation(); openDocMenu(el.dataset.id); },

  /* scan */
  'scan-camera': () => openCamera(),
  'import-image': () => importImages(),
  'import-pdf': () => importPdf(),
  'merge-pdfs': () => mergePdfs(),

  /* caméra */
  'camera-close': () => { closeCamera(); $('#captureRoot').innerHTML = ''; App.draft = null; go('home'); },
  'camera-shoot': () => capturePhoto(),
  'burst-toggle': () => toggleBurst(),
  'camera-done': async () => {
    closeCamera();
    if (!App.draft || !App.draft.pages.length) { toast('Aucune page capturée', 'err'); $('#captureRoot').innerHTML = ''; go('home'); return; }
    renderEditor();
  },
  'camera-import-gallery': async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    if (!files.length) return;
    const n = await importImagesToDraft(files);
    if (n) toast(plural(n, 'page ajoutée', 'pages ajoutées'), 'ok');
  },
  'camera-torch': async () => {
    const track = App.camera.stream && App.camera.stream.getVideoTracks()[0];
    if (!track) return;
    try {
      App.camera.torch = !App.camera.torch;
      await track.applyConstraints({ advanced: [{ torch: App.camera.torch }] });
      $('#torchBtn').style.background = App.camera.torch ? 'rgba(255,255,255,.35)' : '';
    } catch (e) { toast('Torche non disponible sur cet appareil', 'err'); }
  },

  /* éditeur */
  'editor-exit': () => editorExit(),
  'editor-save': async () => {
    const doc = await saveDraft();
    if (!doc) return;
    App.draft = null;
    $('#captureRoot').innerHTML = '';
    App.detailTab = 'preview';
    go('detail', doc.id);
  },
  'editor-select-page': (el) => { App.draft.active = +el.dataset.i; App.draft.cropMode = false; renderEditor(); },
  'editor-remove-page': async (el, e) => {
    e.stopPropagation();
    const i = +el.dataset.i;
    App.draft.pages.splice(i, 1);
    App.draft.active = clamp(App.draft.active, 0, Math.max(0, App.draft.pages.length - 1));
    renderEditor();
  },
  'editor-delete-page': async () => {
    const d = App.draft;
    if (d.pages.length <= 1) { toast('Un document doit conserver au moins une page', 'err'); return; }
    d.pages.splice(d.active, 1);
    d.active = clamp(d.active, 0, d.pages.length - 1);
    renderEditor();
  },
  'editor-add-page': () => editorAddPage(),
  'editor-rotate': () => editorRotate(),
  'editor-corners': () => editorCorners(),
  'editor-deskew': () => editorDeskew(),
  'editor-crop': () => {
    App.draft.cropMode = true;
    App.draft.cropRect = Object.assign({}, App.draft.pages[App.draft.active].crop);
    drawEditorCanvas();
  },
  'editor-adjust': () => editorAdjust(),
  'editor-clean': () => openCleanStudio(),
  'editor-modes': () => openScanModes(),
  'editor-find-dup': () => findDraftDuplicates(),
  'toggle-theme': async (el) => { const next = (Settings.get('theme') === 'dark') ? 'light' : 'dark'; Settings.set('theme', next); document.documentElement.dataset.theme = next; el.classList.toggle('on', next==='dark'); el.setAttribute('aria-checked', next==='dark'); toast('Mode ' + (next==='dark'?'sombre':'clair') + ' activé', 'ok'); },
  'ai-ask': () => answerLocalAssistant(),
  'ai-chip': (el) => { const i=$('#aiAsk'); if(i){ i.value=el.dataset.q || ''; } answerLocalAssistant(); },
  'doc-history': () => { const h=(App.doc.history||[]); openSheet({ title:'Historique des modifications', body: h.length ? h.slice().reverse().map(x=>`<div class="row" style="justify-content:space-between;padding:7px 0"><span>${escapeHtml(x.action)}</span><span class="tiny muted">${fmtDate(x.at)}</span></div>`).join('') : '<p class="small muted">Aucun historique enregistré pour ce document.</p>', actions:[{label:'Fermer',cls:'ghost'}] }); },
  'editor-filter': (el) => editorSetFilter(el.dataset.f),
  'editor-duplicate': async () => {
    const d = App.draft, p = d.pages[d.active];
    d.pages.splice(d.active + 1, 0, Object.assign({}, p, { id: uid('pg') }));
    d.active++;
    renderEditor();
    toast('Page dupliquée', 'ok');
  },
  'editor-ocr': () => editorOcr(),
  'editor-pdf': () => editorGeneratePdf(),

  /* détail */
  'detail-tab': async (el) => {
    App.detailTab = el.dataset.tab;
    await render();
    if (App.detailTab === 'ai') rerenderAiPanels();
  },
  'preview-prev': async () => { App.detailPage = Math.max(0, App.detailPage - 1); await render(); showFullPreview(); },
  'preview-next': async () => { App.detailPage = Math.min(App.docPages.length - 1, App.detailPage + 1); await render(); showFullPreview(); },
  'doc-pdf-download': () => docDownloadPdf(App.doc.id),
  'doc-share-pdf': () => openShareSheet(App.doc.id),
  'doc-share-as': (el) => shareDocumentAs(App.doc.id, el.dataset.fmt),
  'doc-print': () => docPrint(App.doc.id),
  'doc-export-images': () => docExportImages(App.doc.id),
  'doc-ocr': () => docRunOcr(App.doc.id),
  'acc-select': async (el) => { App.accDocId = el.dataset.id; const d = (App.docs||[]).find(x=>x.id===el.dataset.id); if (d) { const full = await Repo.doc(d.id); if (full) { const i = App.docs.findIndex(x=>x.id===d.id); App.docs[i]=full; } } await render(); const anchor = document.querySelector('#accDetail'); if (anchor && anchor.textContent.trim()) { anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); anchor.style.transition = 'box-shadow .3s'; anchor.style.boxShadow = '0 0 0 2px var(--go, #2563eb)'; setTimeout(() => { anchor.style.boxShadow = ''; }, 1600); } },
  'acc-analyze': () => accAnalyze(App.accDocId),
  'acc-reanalyze-confirm': () => accAnalyze(App.accDocId, { confirmed: true }),
  'acc-entries-confirm': () => { window.__accEntriesConfirmed = true; accExport(App.accDocId, 'entries'); },
  'acc-bankentries-confirm': () => { window.__accBankConfirmed = true; accExport(App.accDocId, 'bankentries'); },
  'acc-accept-suggestion': (el) => accAcceptSuggestion(App.accDocId, +el.dataset.idx, el.dataset.account),
  'acc-apply-similar': (el) => accApplySimilar(App.accDocId, +el.dataset.idx),
  'acc-rule-forget': (el) => { Precompta.forgetLearned(el.dataset.key); render(); toast('Règle apprise annulée (les autres règles sont conservées)', 'ok'); },
  'acc-rule-correct': (el) => { const inp = document.getElementById('learnfix-' + el.dataset.key.replace(/[^a-z0-9]+/gi, '_')); if (inp && inp.value.trim()) { Precompta.correctLearned(el.dataset.key, inp.value.trim()); render(); toast('Règle corrigée : ' + el.dataset.key + ' → ' + inp.value.trim(), 'ok'); } },
  'acc-save': () => accSave(App.accDocId),
  'acc-export': (el) => accExport(App.accDocId, el.dataset.fmt),
  'acc-zone': (el) => accShowZone(el),
  'acc-analyze-all': () => accAnalyzeAll(),
  'acc-verify': () => accVerify(App.accDocId),
  'acc-validate': () => accSetValidation(App.accDocId, 'validée'),
  'acc-reject': () => accSetValidation(App.accDocId, 'rejetée'),
  'pc-toggle': (el) => { const c = Precompta.chart(); const a = c.find(x => x.num === el.dataset.num); if (a) { a.active = !a.active; Precompta.saveChart(c); render(); } },
  'pc-rules': () => pcEditRules(),
  'pc-add': () => pcAddAccount(),
  'pc-reset': () => { localStorage.removeItem(Precompta.KEYS.chart); localStorage.removeItem(Precompta.KEYS.rules); localStorage.removeItem(Precompta.KEYS.journals); localStorage.removeItem(Precompta.KEYS.vat); render(); toast('Plan comptable, journaux et règles réinitialisés aux propositions PCG par défaut', 'ok'); },
  'pc-rules-save': () => pcSaveRules(),
  'pc-add-save': () => pcSaveAccount(),
  'acc-open-doc': async () => { if (App.accDocId) { App.detailTab = 'preview'; go('detail', App.accDocId); } },
  'doc-rename': () => docRename(App.doc.id),
  'doc-delete': () => docDelete(App.doc.id),
  'doc-edit': () => docEdit(App.doc.id),
  'doc-to-images': () => docToImages(App.doc.id),
  'doc-ocr-zone': async () => {
    const p = App.docPages[App.detailPage];
    if (!p) { toast('Aucune page affichable', 'err'); return; }
    const c = await ImageOps.render(p, { maxPx: 2000 });
    ocrZone({ src: c.toDataURL('image/jpeg', 0.95) });
  },
  'editor-ocr-zone': async () => {
    const p = App.draft.pages[App.draft.active];
    if (!p) return;
    const c = await ImageOps.render(p, { maxPx: 2000 });
    ocrZone({ src: c.toDataURL('image/jpeg', 0.95) });
  },
  'toggle-autodetect': async (el) => {
    const v = !(Settings.get('autoDetect') !== false);
    Settings.set('autoDetect', v);
    el.classList.toggle('on', v);
    el.setAttribute('aria-checked', v);
    toast('Détection des contours ' + (v ? 'activée' : 'désactivée'), 'ok');
  },

  /* texte */
  'text-copy': () => copyText(($('#ocrEditor') || {}).value || App.doc.text || ''),
  'text-share': () => shareText(($('#ocrEditor') || {}).value || App.doc.text || ''),
  'text-save': async () => {
    const ta = $('#ocrEditor');
    if (!ta) return;
    App.doc.text = ta.value;
    if (App.doc.ocr && App.doc.ocr.status === 'done') App.doc.ocr.at = App.doc.ocr.at || Date.now();
    await Repo.update(App.doc);
    toast('Texte enregistré', 'ok');
  },
  'text-find': () => {
    const ta = $('#ocrEditor');
    const q = prompt('Rechercher dans le texte :');
    if (!q) return;
    const hay = (ta.value || '').toLowerCase();
    const i = hay.indexOf(q.toLowerCase());
    if (i === -1) { toast('« ' + q + ' » introuvable dans ce texte', 'err'); return; }
    ta.focus();
    ta.setSelectionRange(i, i + q.length);
    const line = ta.value.slice(0, i).split('\n').length;
    ta.scrollTop = Math.max(0, (line - 3) * 22);
    toast('Trouvé (ligne ' + line + ')', 'ok');
  },

  /* IA locale */
  'ai-classify': () => { rerenderAiPanels(); toast('Analyse locale effectuée', 'ok'); },
  'ai-entities': () => { rerenderAiPanels(); toast('Entités extraites', 'ok'); },
  'ai-summary': () => {
    const el = $('#aiSummary');
    if (el) el.innerHTML = `<div class="ai-out">${escapeHtml(AI.summary(App.doc.text) || '—')}</div>`;
    toast('Résumé généré (extractif, hors-ligne)', 'ok');
  },
  'ai-search': () => {
    const q = ($('#aiQuery') || {}).value || '';
    const out = $('#aiSearchOut');
    const hits = AI.search(App.doc.text || '', q);
    if (!out) return;
    if (!hits.length) { out.innerHTML = `<div class="banner info">${ICON('i-info', 'ico sm')}
      <span>Aucune occurrence${q ? ' pour « ' + escapeHtml(q) + ' »' : ''}.</span></div>`; return; }
    out.innerHTML = `<div class="tiny muted mb6">${plural(hits.length, 'occurrence', 'occurrences')}</div>` +
      hits.slice(0, 8).map(h => `<div class="ai-out" style="margin-bottom:6px;font-size:12.5px">…${escapeHtml(h.before)}
        <b style="background:#FEF3C7">${escapeHtml(h.match)}</b>${escapeHtml(h.after)}…</div>`).join('');
  },
  'text-export-txt': () => exportDocText('txt'),
  'text-export-docx': () => exportDocText('docx'),
  'doc-pdf-tools': () => openPdfTools(),
  'doc-favorite': async () => { App.doc.favorite = !App.doc.favorite; App.doc.history = [...(App.doc.history||[]), { at: Date.now(), action: App.doc.favorite ? 'Ajouté aux favoris' : 'Retiré des favoris' }]; await Repo.update(App.doc); await render(); },
  'doc-meta': () => { const d = App.doc; promptSheet({ title: 'Catégorie et étiquettes', label: 'Catégorie', value: d.category || '', sub: 'Après validation, modifiez les étiquettes via le champ suivant.', onOk: async (v) => { d.category = v; d.history=[...(d.history||[]),{at:Date.now(),action:'Catégorie modifiée'}]; await Repo.update(d); await render(); setTimeout(() => promptSheet({ title:'Étiquettes', label:'Étiquettes séparées par des virgules', value:(d.tags||[]).join(', '), onOk: async (tv) => { d.tags = tv.split(',').map(x=>x.trim()).filter(Boolean); await Repo.update(d); await render(); } }), 80); } }); },
  'ai-invoice-demo': () => renderInvoicePanel(),
  'show-ia-requirements': () => showInfoSheet('ia'),

  'docs-sort': () => { const order=['date-desc','date-asc','name','pages','size','type']; App.docSort=order[(order.indexOf(App.docSort)+1)%order.length]; render(); },
  'docs-select-mode': () => { App.selectionMode=!App.selectionMode; if(!App.selectionMode) App.selectedDocs.clear(); render(); },
  'docs-duplicates': () => findDocumentDuplicates(),
  'docs-batch-rename': () => { const docs=selectedDocs(); if(!docs.length) return toast('Sélectionnez au moins un document','err'); promptSheet({ title:'Renommer par lots', label:'Préfixe commun', value:'Document', sub:'Les documents seront nommés Préfixe 01, Préfixe 02…', onOk: async (v) => { for(let i=0;i<docs.length;i++){ docs[i].name=v+' '+String(i+1).padStart(2,'0'); docs[i].history=[...(docs[i].history||[]),{at:Date.now(),action:'Renommé par lots'}]; await Repo.update(docs[i]); } App.selectionMode=false; App.selectedDocs.clear(); await render(); toast('Renommage par lots terminé','ok'); } }); },
  'docs-batch-fav': async () => { const docs=selectedDocs(); if(!docs.length) return toast('Sélectionnez au moins un document','err'); for(const d of docs){ d.favorite=true; await Repo.update(d); } await render(); toast('Favoris mis à jour','ok'); },
  'docs-batch-cat': () => { const docs=selectedDocs(); if(!docs.length) return toast('Sélectionnez au moins un document','err'); promptSheet({ title:'Catégorie par lots', label:'Catégorie', value:'', onOk: async (v) => { for(const d of docs){ d.category=v; await Repo.update(d); } App.selectionMode=false; App.selectedDocs.clear(); await render(); } }); },
  'docs-batch-delete': () => { const docs=selectedDocs(); if(!docs.length) return toast('Sélectionnez au moins un document','err'); confirmSheet({ title:'Supprimer '+docs.length+' document(s) ?', sub:'Suppression définitive du stockage local.', okLabel:'Supprimer', danger:true, onOk: async () => { for(const d of docs) await Repo.remove(d.id); App.selectedDocs.clear(); App.selectionMode=false; await render(); toast('Documents supprimés','ok'); } }); },
  'backup-export': () => exportLibraryBackup(),
  'backup-import': () => importLibraryBackup(),

  'go-tools': () => go('tools'),
  'tool-burst': async () => { await openCamera(); setTimeout(() => { if (!Burst.active) toggleBurst(); }, 1800); },
  'tool-modes': async () => { if (App.draft && App.draft.pages.length) openScanModes(); else { toast('Scannez ou importez une page, puis choisissez un mode', 'err', 4500); await openCamera(); } },
  'tool-doc-pdf': () => openToolDocPicker('pdf', 'Convertir en PDF'),
  'tool-doc-images': () => openToolDocPicker('images', 'Exporter en images'),
  'tool-doc-docx': () => openToolDocPicker('docx', 'Exporter au format Word'),
  'tool-doc-txt': () => openToolDocPicker('txt', 'Exporter le texte'),
  'tool-pdf-pages': () => openToolDocPicker('pdf-tools', 'Extraire des pages PDF'),
  'tool-pdf-signature': () => openToolDocPicker('pdf-tools', 'Signature et filigrane'),
  'tool-doc-clean': () => openToolDocPicker('clean', 'Nettoyage magique'),
  'tool-doc-edit': () => openToolDocPicker('edit', 'Modifier et réorganiser'),
  'tool-doc-zone': () => openToolDocPicker('zone', 'OCR d’une zone'),
  'tool-doc-ocr': () => openToolDocPicker('ocr', 'Extraire le texte OCR'),
  'tool-doc-print': () => openToolDocPicker('print', 'Imprimer un document'),
  'tool-assistant': () => openToolDocPicker('assistant', 'Assistant documentaire local'),

  /* paramètres */
  'set-langs': () => settingLangs(),
  'set-quality': () => settingQuality(),
  'toggle-autoocr': async (el) => {
    Settings.set('autoOcr', !Settings.get('autoOcr'));
    el.classList.toggle('on', Settings.get('autoOcr'));
    el.setAttribute('aria-checked', Settings.get('autoOcr'));
    toast('OCR automatique ' + (Settings.get('autoOcr') ? 'activé' : 'désactivé'), 'ok');
  },
  'clear-all': () => confirmSheet({
    title: 'Tout supprimer ?',
    sub: 'Tous les documents, pages et textes stockés dans ce navigateur seront effacés définitivement.',
    okLabel: 'Tout supprimer', danger: true,
    onOk: async () => {
      await Store.clearAll();
      App.docs = [];
      toast('Stockage local vidé', 'ok');
      go('home');
    }
  }),
  'show-permissions': () => showInfoSheet('permissions'),
  'show-roadmap': () => showInfoSheet('roadmap'),
  'show-help': () => showInfoSheet('help')
});

/* ------------------------------------------- modes de scan et doublons -- */
const SCAN_MODES = {
  facture: { label: 'Facture / reçu', apply: p => { p.filter = 'doc'; p.cleanup = { enabled: true, strength: .65, denoise: true, sharpen: true, illumination: true }; } },
  carte: { label: 'Carte de visite', apply: p => { p.filter = 'vivid'; p.cleanup = { enabled: true, strength: .3, denoise: true, sharpen: true, illumination: true }; p.adj = { b: 1.02, c: 1.12 }; } },
  tableau: { label: 'Tableau blanc', apply: p => { p.filter = 'shadow'; p.cleanup = { enabled: true, strength: .45, denoise: true, sharpen: true, illumination: true }; } },
  admin: { label: 'Document administratif', apply: p => { p.filter = 'doc'; p.cleanup = { enabled: true, strength: .4, denoise: true, sharpen: true, illumination: true }; } },
  photo: { label: 'Photo / couleur', apply: p => { p.filter = 'vivid'; p.cleanup = null; } }
};
function openScanModes() {
  const d = App.draft, p = d && d.pages[d.active]; if (!p) return;
  const s = openSheet({ title: 'Modes de numérisation', sub: 'Applique un préréglage réel à la page active. Le mode livre avec correction de courbure n’est pas disponible.', body: `<div class="sheet-list">${Object.entries(SCAN_MODES).map(([k,v])=>`<button data-mode="${k}"><span class="grow">${v.label}</span>${ICON('i-chevron','ico sm')}</button>`).join('')}</div>`, actions: [{ label: 'Fermer', cls: 'ghost' }] });
  $$('[data-mode]', s).forEach(b => b.addEventListener('click', async () => { SCAN_MODES[b.dataset.mode].apply(p); p.thumb = await ImageOps.thumb(await ImageOps.render(p,{maxPx:400}).then(c=>c.toDataURL('image/jpeg',.7))); closeSheet(); renderEditor(); toast('Mode appliqué : ' + SCAN_MODES[b.dataset.mode].label, 'ok'); }));
}
async function findDraftDuplicates() {
  const d = App.draft; if (!d || d.pages.length < 2) { toast('Ajoutez au moins deux pages pour détecter les doublons'); return; }
  busyBar(true);
  const fps = [];
  for (const p of d.pages) fps.push(await Vision.fingerprint(p.src));
  busyBar(false);
  const pairs = [];
  for (let i=0;i<fps.length;i++) for (let j=i+1;j<fps.length;j++) { const dist = Vision.hamming(fps[i].bits, fps[j].bits); if (dist <= 10) pairs.push({ i, j, dist }); }
  const s = openSheet({ title: 'Pages en double', sub: pairs.length ? 'Pages visuellement très proches détectées. Vérifiez avant suppression.' : 'Aucune page en double détectée.', body: pairs.length ? pairs.map(x=>`<div class="row" style="justify-content:space-between;padding:8px 0"><span>Page ${x.i+1} ≈ Page ${x.j+1} <span class="tiny muted">(distance ${x.dist})</span></span><button class="btn xs danger" data-del-dup="${x.j}">Supprimer la page ${x.j+1}</button></div>`).join('') : '<p class="small muted">Les empreintes perceptuelles des pages ne correspondent pas.</p>', actions: [{ label: 'Fermer', cls: 'ghost' }] });
  $$('[data-del-dup]', s).forEach(b => b.addEventListener('click', () => { const idx=+b.dataset.delDup; d.pages.splice(idx,1); d.active=clamp(d.active,0,d.pages.length-1); closeSheet(); renderEditor(); toast('Page en double supprimée', 'ok'); }));
}
async function answerLocalAssistant() {
  const q = ($('#aiAsk') || {}).value || ''; const doc = App.doc; if (!doc) return;
  const out = $('#aiAnswer'); if (!out) return;
  const text = doc.text || ''; const low = q.toLowerCase();
  if (!text.trim()) { out.innerHTML = 'Lancez d’abord l’OCR : l’assistant local travaille uniquement sur le texte réellement extrait.'; return; }
  if (/tradu|translate|anglais|english/.test(low)) { out.innerHTML = '<b>Traduction non disponible localement.</b> Elle nécessiterait un service distant avec consentement explicite ; aucun texte n’a été envoyé.'; return; }
  if (/facture|numéro|numero|montant|tva|total/.test(low)) { const inv = AI.extractInvoice(text); out.innerHTML = `<b>Extraction facture locale :</b><br>` + Object.entries(inv).filter(([k])=>k!=='disclaimer').map(([k,v])=>`${escapeHtml(k)} : ${escapeHtml(v)}`).join('<br>'); return; }
  if (/date|échéance|echeance/.test(low)) { const e = AI.entities(text); out.innerHTML = '<b>Dates détectées :</b> ' + escapeHtml(e.dates.join(', ') || 'Non détecté'); return; }
  if (/résume|resume|synthèse|synthese/.test(low)) { out.innerHTML = '<b>Résumé local extractif :</b><br>' + escapeHtml(AI.summary(text)); return; }
  if (/classe|type|catégorie|categorie/.test(low)) { const c = AI.classify(text); out.innerHTML = `<b>Classification locale :</b> ${escapeHtml(c.label)} (confiance estimée ${c.confidence} %)`; return; }
  const hits = AI.search(text, q.replace(/^(trouve|recherche|cherche|où est|ou est)\s+/i,''));
  out.innerHTML = hits.length ? hits.slice(0,5).map(h=>`…${escapeHtml(h.before)}<b>${escapeHtml(h.match)}</b>${escapeHtml(h.after)}…`).join('<br><br>') : 'Aucun passage correspondant trouvé dans le texte OCR.';
}

/* --------------------------------------- V2.4 sauvegarde / bibliothèque -- */
async function blobToDataUrl(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); }); }
async function exportLibraryBackup() {
  if (typeof JSZip === 'undefined') { toast('JSZip indisponible pour la sauvegarde', 'err'); return; }
  try {
    busyBar(true);
    const docs = await Store.all('docs'); const pages = await Store.all('pages'); const rawFiles = await Store.all('files');
    const files = [];
    for (const f of rawFiles) if (f.blob) files.push({ id: f.id, name: f.name, dataUrl: await blobToDataUrl(f.blob) });
    const manifest = { app: 'ScanPro AI', kind: 'scanpro-backup', version: 1, exportedAt: new Date().toISOString(), docs, pages, files };
    const zip = new JSZip(); zip.file('scanpro-backup.json', JSON.stringify(manifest));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    busyBar(false); downloadBlob(blob, 'scanpro-sauvegarde-' + new Date().toISOString().slice(0,10) + '.zip');
    toast('Sauvegarde exportée : ' + plural(docs.length, 'document', 'documents'), 'ok');
  } catch (e) { busyBar(false); toast('Sauvegarde impossible : ' + e.message, 'err', 6000); }
}
async function importLibraryBackup() {
  const files = await pickFiles({ accept: '.zip,application/zip', multiple: false });
  if (!files.length) return;
  try {
    if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible');
    busyBar(true);
    const zip = await JSZip.loadAsync(files[0]);
    const entry = zip.file('scanpro-backup.json');
    if (!entry) throw new Error('archive invalide : scanpro-backup.json introuvable');
    const manifest = JSON.parse(await entry.async('string'));
    if (manifest.kind !== 'scanpro-backup' || !Array.isArray(manifest.docs) || !Array.isArray(manifest.pages)) throw new Error('archive ScanPro non reconnue');
    const idMap = new Map();
    for (const d of manifest.docs) idMap.set(d.id, uid('doc'));
    let imported = 0;
    for (const old of manifest.docs) {
      const doc = { ...old, id: idMap.get(old.id), history: [...(old.history || []), { at: Date.now(), action: 'Restauré depuis une sauvegarde' }] };
      await Store.put('docs', doc); imported++;
    }
    for (const pg of manifest.pages) if (idMap.has(pg.docId)) await Store.put('pages', { ...pg, id: uid('pg'), docId: idMap.get(pg.docId) });
    for (const f of manifest.files || []) if (idMap.has(f.id) && f.dataUrl) await Store.put('files', { id: idMap.get(f.id), name: f.name, blob: dataUrlToBlob(f.dataUrl) });
    App.docs = await Repo.list(); busyBar(false);
    toast('Sauvegarde restaurée : ' + plural(imported, 'document ajouté', 'documents ajoutés'), 'ok', 5000);
    go('docs');
  } catch (e) { busyBar(false); toast('Restauration impossible : ' + e.message, 'err', 7000); }
}
async function findDocumentDuplicates() {
  const entries = [];
  busyBar(true);
  for (const d of App.docs) {
    const ps = await Repo.pages(d.id);
    const src = ps[0]?.src || d.thumb;
    if (src) { try { entries.push({ doc: d, fp: await Vision.fingerprint(src) }); } catch (e) {} }
  }
  busyBar(false);
  const pairs = [];
  for (let i=0;i<entries.length;i++) for (let j=i+1;j<entries.length;j++) { const dist=Vision.hamming(entries[i].fp.bits, entries[j].fp.bits); if (dist<=10) pairs.push({a:entries[i].doc,b:entries[j].doc,dist}); }
  const sh = openSheet({ title:'Documents en double', sub:pairs.length?'Documents dont la première page est visuellement très proche.':'Aucun document en double détecté.', body:pairs.length?pairs.map((x,i)=>`<div class="row" style="justify-content:space-between;gap:8px;padding:8px 0"><span>« ${escapeHtml(x.a.name)} » ≈ « ${escapeHtml(x.b.name)} » <span class="tiny muted">(distance ${x.dist})</span></span><button class="btn xs danger" data-del-doc-dup="${i}">Supprimer le 2e</button></div>`).join(''):'<p class="small muted">Comparaison effectuée sur la première page de chaque document.</p>', actions:[{label:'Fermer',cls:'ghost'}] });
  $$('[data-del-doc-dup]', sh).forEach(b=>b.addEventListener('click', async () => { const x=pairs[+b.dataset.delDocDup]; await Repo.remove(x.b.id); App.selectedDocs.delete(x.b.id); closeSheet(); await render(); toast('Document en double supprimé', 'ok'); }));
}
function selectedDocs() { return App.docs.filter(d => App.selectedDocs.has(d.id)); }

/* ------------------------------------------------------- menu Outils V2.6 -- */
function openToolDocPicker(kind, title) {
  if (!App.docs.length) { toast('Créez ou importez d’abord un document', 'err'); go('docs'); return; }
  const sh = openSheet({ title, sub:'Choisissez le document à traiter. L’original reste conservé.', body:`<div class="sheet-list">${App.docs.map(d=>`<button data-tool-doc="${escapeHtml(d.id)}"><span class="grow">${escapeHtml(d.name)}</span><span class="tiny muted">${plural(d.pageCount||0,'page','pages')}</span></button>`).join('')}</div>`, actions:[{label:'Annuler',cls:'ghost'}] });
  $$('[data-tool-doc]', sh).forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.toolDoc; closeSheet();
    const doc = await Repo.doc(id); if (!doc) return;
    if (kind === 'pdf') return docDownloadPdf(id);
    if (kind === 'images') return docExportImages(id);
    if (kind === 'print') return docPrint(id);
    if (kind === 'ocr') return docRunOcr(id);
    if (kind === 'edit' || kind === 'modes') { await docEdit(id); if (kind === 'modes') setTimeout(() => openScanModes(), 450); return; }
    if (kind === 'docx' || kind === 'txt') {
      App.doc = doc; App.detailTab = 'text'; await go('detail', id);
      if (!doc.text || !doc.text.trim()) { toast('Lancez d’abord l’OCR depuis l’onglet Texte', 'err', 4500); return; }
      return exportDocText(kind);
    }
    await go('detail', id);
    setTimeout(async () => {
      if (kind === 'clean') { await docEdit(id); setTimeout(() => openCleanStudio(), 450); }
      else if (kind === 'pdf-tools') openPdfTools();
      else if (kind === 'zone') { const el = document.querySelector('[data-act="doc-ocr-zone"]'); if (el) el.click(); }
      else if (kind === 'assistant') { App.detailTab = 'ai'; await render(); }
    }, 80);
  }));
}

/* ---------------------------------------------- exports texte / facture -- */
async function makeDocxBlob(text, title = 'Document ScanPro AI') {
  if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible pour le DOCX');
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = String(text || '').split(/\n/).map(line => `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:b/><w:t>${esc(title)}</w:t></w:r></w:p>${paras}</w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
async function exportDocText(format) {
  const text = ($('#ocrEditor') || {}).value || (App.doc && App.doc.text) || '';
  if (!text.trim()) { toast('Aucun texte à exporter', 'err'); return; }
  const base = slugify((App.doc && App.doc.name) || 'document');
  try {
    if (format === 'docx') downloadBlob(await makeDocxBlob(text, App.doc ? App.doc.name : 'Document'), base + '.docx');
    else downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), base + '.txt');
    toast('Export ' + format.toUpperCase() + ' téléchargé', 'ok');
  } catch (e) { toast('Export impossible : ' + e.message, 'err'); }
}
function renderInvoicePanel() {
  const out = $('#aiInvoiceOut'); if (!out || !App.doc) return;
  const inv = AI.extractInvoice(App.doc.text || '');
  const labels = { supplier: 'Fournisseur', company: 'Entreprise', invoiceNumber: 'Numéro de facture', issueDate: "Date d'émission", dueDate: "Date d'échéance", totalHT: 'Montant HT', vatRate: 'Taux TVA', vatAmount: 'Montant TVA', totalTTC: 'Montant TTC', currency: 'Devise', siret: 'SIREN / SIRET', orderRef: 'Référence commande' };
  out.innerHTML = `<div class="invoice-grid">${Object.keys(labels).map(k => `<label>${labels[k]}<input data-inv="${k}" value="${escapeHtml(inv[k])}"></label>`).join('')}</div>
    <p class="tiny muted">${escapeHtml(inv.disclaimer)} Les champs absents affichent « Non détecté » et ne sont jamais inventés.</p>
    <div class="btn-row"><button class="btn xs soft" id="invCsv">Exporter CSV</button><button class="btn xs soft" id="invJson">Exporter JSON</button></div>`;
  const read = () => Object.fromEntries($$('[data-inv]', out).map(i => [i.dataset.inv, i.value]));
  $('#invCsv', out).addEventListener('click', () => downloadBlob(new Blob([AI.invoiceCsv(read())], { type: 'text/csv;charset=utf-8' }), slugify(App.doc.name) + '-facture.csv'));
  $('#invJson', out).addEventListener('click', () => downloadBlob(new Blob([JSON.stringify(read(), null, 2)], { type: 'application/json' }), slugify(App.doc.name) + '-facture.json'));
}

async function accLoadPagesWords(doc) {
  try {
    const pages = await Repo.pages(doc.id);
    if (pages && pages.length && pages.some(p => p.ocrWords)) return pages.map(p => p.ocrWords || []);
  } catch (e) {}
  return doc.ocrWordBoxes || null;
}
function accSnapshot(doc) { return String(doc.text || '').slice(0, 400); }
function accMergeCorrections(oldData, newData) {
  if (!oldData || !newData) return newData;
  for (const [k, f] of Object.entries(oldData.fields || {})) {
    if (f && f.status === 'corrige' && newData.fields && newData.fields[k]) newData.fields[k] = { ...newData.fields[k], value: f.value, status: 'corrige', confidence: f.confidence };
  }
  return newData;
}
async function accAnalyze(docId, opts = {}) {
  const doc = await Repo.doc(docId);
  if (doc && doc.acc && !opts.confirmed && !opts.batch) {
    const sh = openSheet({ title: 'Réanalyser ce document ?', sub: 'La reconnaissance sera relancée. Les champs que vous avez corrigés manuellement seront conservés ; les autres seront recalculés.',
      body: '<p class="small muted">Dernière analyse : ' + (doc.acc.at ? new Date(doc.acc.at).toLocaleString('fr-FR') : 'Non reconnu') + (doc.acc.edited ? ' · contient des corrections manuelles' : '') + '</p>',
      actions: [{ label: 'Annuler', cls: 'ghost' }, { label: 'Réanalyser', cls: 'go', act: 'acc-reanalyze-confirm', close: true }] });
    return;
  }
  if (!doc) return;
  if (!doc.text || !doc.text.trim()) { toast("Lancez d'abord l'OCR depuis le document (onglet Texte OCR), puis revenez dans Comptabilité.", 'err', 5000); App.accDocId = docId; await render(); return; }
  const pagesWords = await accLoadPagesWords(doc);
  const typeSel = $('#accTypeSel'); const forced = (typeSel && typeSel.value !== 'auto') ? typeSel.value : (App.accType && App.accType !== 'auto' ? App.accType : null);
  const autoType = Acc.classifyType(doc.text).type;
  const effType = forced || autoType;
  let data;
  if (effType === 'releve_bancaire') data = Acc.extractBank(doc.text, pagesWords);
  else if (effType === 'bulletin_salaire') data = Acc.extractPayroll(doc.text, pagesWords);
  else if (effType === 'bilan' || effType === 'compte_resultat') data = Acc.extractFinancial(doc.text, effType, pagesWords);
  else if (effType === 'pret_echeancier' || effType === 'amort_emprunt') data = Acc.extractLoan(doc.text, pagesWords);
  else if (effType === 'amort_immobilisation') data = Acc.extractAssets(doc.text, pagesWords);
  else if (effType === 'note_frais') data = Acc.extractExpenses(doc.text, pagesWords);
  else data = Acc.extractInvoice(doc.text, pagesWords);
  data.requestedType = effType;
  if (!data.fields) data.fields = {};
  if (!data.fields.docType && data.docType) data.fields.docType = { value: (Acc.TYPES.find(x => x[0] === data.docType) || [])[1] || data.docType, confidence: data.proposedType ? data.proposedType.confidence : 70, page: 0, zone: null, status: 'reconnu' };
  if (forced) {
    data.docType = forced;
    data.fields.docType = { value: (Acc.TYPES.find(x => x[0] === forced) || [])[1] || forced, confidence: 100, page: 0, zone: null, status: 'corrige' };
  }
  for (const f of Object.values(data.fields || {})) if (f && !f.source) f.source = 'OCR Tesseract (local)';
  const merged = doc.acc ? accMergeCorrections(doc.acc.data, data) : data;
  doc.acc = { version: 2, firstAt: doc.acc ? (doc.acc.firstAt || doc.acc.at) : Date.now(), at: Date.now(), edited: !!(doc.acc && doc.acc.edited), textSnapshot: accSnapshot(doc), data: merged };
  doc.history = doc.history || []; doc.history.push({ at: Date.now(), action: 'Analyse comptable (' + ((Acc.TYPES.find(x => x[0] === data.docType) || [])[1] || data.docType) + ')' });
  await Repo.update(doc);
  App.docs = await Repo.list();
  App.accDocId = docId;
  await render();
  toast('Reconnaissance structurée terminée — vérifiez les champs avant export', 'ok', 4000);
}
async function accReadForm(doc) {
  const data = JSON.parse(JSON.stringify(doc.acc.data));
  $$('[data-acc-field]').forEach(i => {
    const k = i.dataset.accField;
    const prev = data.fields[k] || {};
    const v = i.value.trim();
    data.fields[k] = { ...prev, value: v ? v : Acc.NR, status: v ? 'corrige' : 'non-reconnu', confidence: v ? Math.max(prev.confidence || 0, 0) : 0 };
    if (k !== 'docType' && prev.zone) data.fields[k].zone = prev.zone;
  });
  const sel = $('#accTypeSel'); if (sel) { data.docType = sel.value; data.fields.docType.value = (Acc.TYPES.find(x => x[0] === sel.value) || [])[1] || sel.value; }
  $$('[data-acc-loan]').forEach(i => {
    const [idx, field] = i.dataset.accLoan.split(':');
    const r = (data.scheduleRows || [])[+idx]; if (!r) return;
    r[field] = field === 'date' ? i.value : Acc.parseAmount(i.value); r.status = 'corrige';
  });
  $$('[data-acc-asset]').forEach(i => {
    const [idx, field] = i.dataset.accAsset.split(':');
    const r = (data.assetRows || [])[+idx]; if (!r) return;
    r[field] = (field === 'label' || field === 'serviceDate') ? i.value : Acc.parseAmount(i.value); r.status = 'corrige';
  });
  $$('[data-acc-fin]').forEach(i => {
    const [idx, field] = i.dataset.accFin.split(':');
    const r = (data.statementRows || [])[+idx]; if (!r) return;
    r[field] = (field === 'label' || field === 'account' || field === 'section') ? i.value : Acc.parseAmount(i.value);
    r.status = 'corrige';
  });
  $$('[data-acc-tx]').forEach(i => {
    const [idx, field] = i.dataset.accTx.split(':');
    const x = (data.transactions || [])[+idx]; if (!x) return;
    x[field] = (field === 'label' || field === 'date' || field === 'valueDate' || field === 'account') ? i.value : Acc.parseAmount(i.value);
    x.status = 'corrige';
  });
  $$('[data-acc-line]').forEach(i => {
    const [idx, field] = i.dataset.accLine.split(':');
    const l = data.lines[+idx]; if (!l) return;
    l[field] = field === 'description' ? i.value : Acc.parseAmount(i.value);
    l.status = 'corrige';
  });
  return data;
}
async function accSave(docId) {
  const doc = await Repo.doc(docId);
  if (!doc || !doc.acc) return;
  const prevType = doc.acc.data.docType;
  const prevFields = JSON.parse(JSON.stringify((doc.acc.data && doc.acc.data.fields) || {}));
  const prevDataSnapshot = JSON.parse(JSON.stringify(doc.acc.data || {}));
  const learnLog = [];
  doc.acc.data = await accReadForm(doc);
  // Historique des corrections (V2.15) : ancienne -> nouvelle valeur, daté, par champ.
  doc.acc.history = doc.acc.history || [];
  for (const [k, f] of Object.entries(doc.acc.data.fields || {})) {
    const before = prevFields[k] ? prevFields[k].value : undefined;
    if (before !== undefined && String(before) !== String(f.value)) doc.acc.history.push({ at: Date.now(), field: k, old: before, new: f.value });
  }
  if (doc.acc.history.length > 200) doc.acc.history = doc.acc.history.slice(-200);
  // Apprentissage (V2.17) : UNIQUEMENT sur correction explicite de l'utilisateur,
  // c'est-à-dire un compte différent de la proposition automatique recalculée sans
  // ses affectations. Une valeur déjà proposée par une règle n'est jamais ré-apprise
  // aveuglément ; le résultat (appris / refusé / conflit) est historisé.
  if (doc.acc.data && doc.acc.data.kind === 'bank') {
    const baseline = Acc.bankProposals(Object.assign({}, prevDataSnapshot, { transactions: (prevDataSnapshot.transactions || []).map(x => Object.assign({}, x, { account: undefined })) }));
    const results = [];
    (doc.acc.data.transactions || []).forEach((tx, i) => {
      if (!tx.account) return;
      const auto = baseline[i] && baseline[i].counterAccount;
      if (auto && String(auto) === String(tx.account)) return; // simple confirmation d'une proposition : pas un nouvel apprentissage
      const direction = tx.debit != null ? 'sortie' : (tx.credit != null ? 'entree' : null);
      results.push(Precompta.learnFromLabel(tx.label, tx.account, { direction }));
    });
    for (const r of results) if (r && (r.ok || r.conflict)) learnLog.push(r);
  }
  if (prevType && doc.acc.data.docType !== prevType) toast('Type modifié : pensez à « Réanalyser » pour recalculer les champs compatibles avec le nouveau type.', 'err', 6000);
  doc.acc.edited = true;
  doc.acc.savedAt = Date.now();
  if (learnLog.length) { doc.acc.history = doc.acc.history || []; for (const r of learnLog) doc.acc.history.push({ at: Date.now(), field: 'apprentissage', old: '', new: (r.conflict ? 'CONFLIT ' : 'règle apprise ') + r.key }); }
  doc.history = doc.history || []; doc.history.push({ at: Date.now(), action: 'Correction comptable enregistrée' });
  await Repo.update(doc);
  App.docs = await Repo.list();
  await render();
  toast('Corrections comptables enregistrées' + (learnLog.length ? ' — ' + learnLog.filter(r => r.ok).length + ' règle(s) apprise(s)' + (learnLog.some(r => r.conflict) ? ', conflit signalé à corriger' : '') : ''), 'ok', 5000);
}


async function accAcceptSuggestion(docId, idx, account) {
  const doc = await Repo.doc(docId); if (!doc || !doc.acc || !account) return;
  const tx = (doc.acc.data.transactions || [])[idx]; if (!tx) return;
  tx.account = account;
  const direction = tx.debit != null ? 'sortie' : (tx.credit != null ? 'entree' : null);
  const r = Precompta.learnFromLabel(tx.label, account, { direction });
  doc.acc.edited = true; doc.history = doc.history || [];
  doc.history.push({ at: Date.now(), action: 'Suggestion comptable acceptée explicitement (' + account + ')' + (r && r.ok ? ' et apprise' : '') });
  await Repo.update(doc); App.docs = await Repo.list(); await render();
  toast('Suggestion acceptée : ' + account + ' affecté' + (r && r.ok ? ' et règle apprise pour ce bénéficiaire' : ''), 'ok', 5000);
}
async function accApplySimilar(docId, idx) {
  const doc = await Repo.doc(docId); if (!doc || !doc.acc) return;
  const props = Acc.bankProposals(doc.acc.data); const pr = props[idx];
  if (!pr || !pr.counterAccount || !pr.similarIndexes.length) return;
  let n = 0;
  for (const j of pr.similarIndexes) { const tx = doc.acc.data.transactions[j]; if (tx && !tx.account) { tx.account = pr.counterAccount; n++; } }
  doc.acc.edited = true; doc.history = doc.history || [];
  doc.history.push({ at: Date.now(), action: 'Règle appliquée à ' + n + ' opération(s) similaire(s) de ce relevé (' + pr.counterAccount + ')' });
  await Repo.update(doc); App.docs = await Repo.list(); await render();
  toast('Compte ' + pr.counterAccount + ' appliqué à ' + n + ' opération(s) similaire(s) de ce relevé (aperçu affiché avant application)', 'ok', 5000);
}
async function accSetValidation(docId, status) {
  const doc = await Repo.doc(docId);
  if (!doc || !doc.acc) return;
  const j = Acc.journalEntries(doc.acc.data, doc);
  const issues = j ? Precompta.validateEntries(j, doc.acc.data) : ['Écritures impossibles à générer'];
  doc.acc.validation = { status, at: Date.now(), issues };
  doc.acc.history = doc.acc.history || [];
  doc.acc.history.push({ at: Date.now(), field: 'validation', old: 'proposée (non validée)', new: status });
  doc.history = doc.history || []; doc.history.push({ at: Date.now(), action: 'Proposition comptable ' + status + ' par le comptable' });
  await Repo.update(doc); App.docs = await Repo.list(); await render();
  toast(status === 'validée' ? 'Proposition marquée VALIDÉE par vous' + (issues.length ? ' — points ouverts : ' + issues[0] : '') : 'Proposition rejetée', status === 'validée' ? (issues.length ? 'err' : 'ok') : 'err', 6000);
}
function pcEditRules() {
  const R = Precompta.rules(), chart = Precompta.chart(), journals = Precompta.journals();
  const opts = (sel, list, val, lab) => '<option value="">—</option>' + list.map(a => '<option value="' + val(a) + '"' + (val(a) === sel ? ' selected' : '') + '>' + lab(a) + '</option>').join('');
  openSheet({ title: 'Règles de proposition du dossier', sub: 'Comptes et journaux proposés automatiquement (modifiables, jamais imposés).',
    body: Object.keys(Precompta.RULE_LABELS).map(k => '<label class="small muted">' + Precompta.RULE_LABELS[k] + '<select id="pcr-' + k + '">' + (/journal/.test(k) ? opts(R[k], journals, j => j.code, j => j.code + ' — ' + j.label) : opts(R[k], chart, a => a.num, a => a.num + ' — ' + a.label)) + '</select></label>').join('') +
      '<label class="small muted">Taux de TVA admis (%, séparés par des virgules)<input id="pcr-vat" value="' + Precompta.vatRates().join(', ') + '"></label>' +
      '<p class="tiny muted">Un taux reconnu hors de cette liste déclenche une demande de validation humaine, jamais une correction automatique.</p>',
    actions: [{ label: 'Annuler', cls: 'ghost' }, { label: 'Enregistrer les règles', cls: 'go', act: 'pc-rules-save', close: false }] });
}
function pcSaveRules() {
  const R = Precompta.rules();
  for (const k of Object.keys(Precompta.RULE_LABELS)) { const el = document.querySelector('#pcr-' + k); if (el && el.value) R[k] = el.value; }
  Precompta.saveRules(R); closeSheet();
  const vatEl = document.querySelector('#pcr-vat');
  if (vatEl) { const rates = vatEl.value.split(',').map(x => parseFloat(x.replace('%', '').trim().replace(',', '.'))).filter(x => !isNaN(x) && x >= 0 && x <= 40); if (rates.length) Precompta.saveVatRates(rates); }
  render(); toast('Règles du dossier enregistrées', 'ok');
}
function pcAddAccount() {
  openSheet({ title: 'Ajouter un compte au plan du dossier', sub: 'Base PCG proposée, adaptable à chaque dossier client.',
    body: '<label class="small muted">Numéro de compte<input id="pca-num" placeholder="ex : 615000"></label><label class="small muted">Libellé<input id="pca-label" placeholder="ex : Entretien et réparations"></label><label class="small muted">Catégorie<input id="pca-cat" placeholder="Charge, Produit, Tiers, TVA, Trésorerie…"></label>',
    actions: [{ label: 'Annuler', cls: 'ghost' }, { label: 'Ajouter le compte', cls: 'go', act: 'pc-add-save', close: false }] });
}
function pcSaveAccount() {
  const num = (document.querySelector('#pca-num') || {}).value, label = (document.querySelector('#pca-label') || {}).value, cat = (document.querySelector('#pca-cat') || {}).value;
  if (!num || !/^\d{3,}$/.test(num.trim())) { toast('Numéro de compte invalide (chiffres uniquement)', 'err'); return; }
  const c = Precompta.chart();
  if (c.some(a => a.num === num.trim())) { toast('Ce compte existe déjà dans le plan du dossier', 'err'); return; }
  c.push({ num: num.trim(), label: (label || '').trim() || 'Compte sans libellé (à compléter)', cat: (cat || '').trim() || 'À classer', active: true });
  Precompta.saveChart(c); closeSheet(); render(); toast('Compte ' + num.trim() + ' ajouté au plan du dossier', 'ok');
}
async function accExport(docId, fmt) {
  const doc = await Repo.doc(docId);
  if (!doc || !doc.acc) return;
  const data = await accReadForm(doc);
  const base = slugify(doc.name) + '-comptabilite';
  try {
    if (fmt === 'bankentries') {
      const ex = Acc.bankEntriesCsv(data, doc);
      if (!window.__accBankConfirmed) {
        openSheet({ title: 'Exporter les écritures bancaires proposées ?', sub: 'Journal BQ du dossier · compte banque ' + Precompta.rules().banque + ' · format CSV générique documenté (voir rapport)', body: '<p class="small">Écritures <b>proposées, non validées</b> : équilibre débit/crédit ' + (ex.balanced ? 'OK (' + ex.totalDebit + ')' : 'NON ATTEINT') + '.<br>' + (ex.problems.length ? '<b>' + ex.problems.length + ' point(s) à traiter avant import :</b><br>' + ex.problems.slice(0, 8).map(escapeHtml).join('<br>') : 'Aucun problème détecté (doublons, comptes, complétude).') + '</p><p class="tiny muted">Export CSV générique (Date;Journal;Pièce;Compte;Libellé;Référence;Débit;Crédit;Statut) : mappez ces colonnes dans l’import de votre logiciel — aucune compatibilité universelle n’est prétendue.</p>', actions: [{ label: 'Annuler', cls: 'ghost' }, { label: 'Exporter ces propositions', cls: 'go', act: 'acc-bankentries-confirm', close: true }] });
        return;
      }
      window.__accBankConfirmed = false;
      downloadBlob(new Blob(['\ufeff' + ex.csv], { type: 'text/csv;charset=utf-8' }), base + '-ecritures-banque.csv');
      toast('Écritures bancaires proposées exportées — ' + ex.proposals.filter(x => x.entries.length).length + ' opération(s), équilibré : ' + (ex.balanced ? 'oui' : 'NON'), ex.balanced ? 'ok' : 'err', 5000); return;
    }
    if (fmt === 'entries') {
      const j = Acc.journalEntries(data, doc);
      if (!j) { toast("Écritures impossibles : TVA non reconnue ou totaux HT/TTC insuffisants (aucune TVA n'est inventée)", 'err', 6000); return; }
      if (!window.__accEntriesConfirmed) {
        openSheet({ title: 'Exporter des écritures proposées ?', sub: j.warning, body: '<p class="small">Cette écriture est <b>équilibrée</b> (débits = crédits : ' + j.totalDebit + '), mais <b>non validée par un comptable</b>. Elle ne doit pas être importée comme écriture définitive sans votre validation explicite.</p>', actions: [{ label: 'Annuler', cls: 'ghost' }, { label: 'Je valide cet export proposé', cls: 'go', act: 'acc-entries-confirm', close: true }] });
        return;
      }
      window.__accEntriesConfirmed = false;
      const issuesE = Precompta.validateEntries(j, data);
      const statutExp = (doc.acc && doc.acc.validation && doc.acc.validation.status) || 'proposée (non validée)';
      const csvE = ['Date;Journal;Pièce;Compte;Libellé;Tiers;Débit;Crédit;Document source;Statut validation;Points à vérifier', ...j.rows.map(r => [r.date, r.journal, r.piece || '', r.account, '"' + String(r.label).replace(/"/g, '""') + '"', '"' + String(r.tiers || '').replace(/"/g, '""') + '"', String(r.debit).replace('.', ','), String(r.credit).replace('.', ','), '"' + String(r.source || '').replace(/"/g, '""') + '"', statutExp, '"' + issuesE.join(' · ').replace(/"/g, '""') + '"'].join(';'))].join('\n');
      downloadBlob(new Blob(['\ufeff' + csvE], { type: 'text/csv;charset=utf-8' }), base + '-ecritures.csv');
      toast('Écritures proposées exportées (à vérifier) — équilibrées : ' + (j.balanced ? 'oui' : 'NON'), j.balanced ? 'ok' : 'err', 5000); return;
    }
    if (fmt === 'csv') downloadBlob(new Blob(['\ufeff' + ((data.transactions && data.transactions.length) ? Acc.toBankCsv(data) : (data.statementRows && data.statementRows.length) ? Acc.toFinancialCsv(data) : (data.scheduleRows && data.scheduleRows.length) ? Acc.toTableCsv(['Date','Échéance totale','Capital remboursé','Intérêts','Assurance','Capital restant dû (reconnu)','Capital restant (recalculé)','Confiance %'], data.scheduleRows.map(r => [r.date, r.total, r.capital, r.interest, r.insurance, r.remaining, r.computedRemaining ?? '', r.confidence])) : (data.assetRows && data.assetRows.length) ? Acc.toTableCsv(['Immobilisation','Valeur d\'origine','Date de mise en service','Durée (ans)','Taux %','Dotation annuelle','Amortissements cumulés','Valeur nette comptable'], data.assetRows.map(r => [r.label, r.originalValue, r.serviceDate, r.durationYears, r.rate, r.annualDepreciation, r.accumulated, r.netBookValue])) : Acc.toCsv(data))], { type: 'text/csv;charset=utf-8' }), base + '.csv');
    else if (fmt === 'json') downloadBlob(new Blob([JSON.stringify({ document: doc.name, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' }), base + '.json');
    else if (fmt === 'xlsx') downloadBlob(await accXlsxBlob(doc, data), base + '.xlsx');
    toast('Export ' + fmt.toUpperCase() + ' téléchargé', 'ok');
  } catch (e) { toast('Export impossible : ' + e.message, 'err'); }
}
async function accBuildXlsx(rows, esc) {
  const cell = (v, r, c) => {
    const ref = String.fromCharCode(65 + c) + r;
    return (typeof v === 'number' && Number.isFinite(v)) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const sheet = rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cell(c, i + 1, j)).join('')}</row>`).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.folder('xl').file('workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Comptabilite" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.folder('xl').folder('worksheets').file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
async function accXlsxBlob(doc, data) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip indisponible');
  const esc = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cell = (v, r, c) => {
    const ref = String.fromCharCode(65 + c) + r;
    return (typeof v === 'number' && Number.isFinite(v)) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  if (data.scheduleRows && data.scheduleRows.length) {
    const rowsL = [['Document', doc.name], ['Type', 'Échéancier de prêt'], [], ['Date', 'Échéance totale', 'Capital remboursé', 'Intérêts', 'Assurance', 'Capital restant dû (reconnu)', 'Capital restant (recalculé)']];
    for (const r of data.scheduleRows) rowsL.push([r.date, r.total, r.capital, r.interest, r.insurance, r.remaining, r.computedRemaining]);
    return accBuildXlsx(rowsL, esc);
  }
  if (data.assetRows && data.assetRows.length) {
    const rowsA = [['Document', doc.name], ['Type', 'Amortissement des immobilisations'], [], ['Immobilisation', "Valeur d'origine", 'Mise en service', 'Durée (ans)', 'Taux %', 'Dotation annuelle', 'Cumulés', 'VNC']];
    for (const r of data.assetRows) rowsA.push([r.label, r.originalValue, r.serviceDate, r.durationYears, r.rate, r.annualDepreciation, r.accumulated, r.netBookValue]);
    return accBuildXlsx(rowsA, esc);
  }
  if (data.statementRows && data.statementRows.length) {
    const rowsF = [['Document', doc.name], ['Type', data.docType], [], ['Section', 'Compte', 'Libellé', 'Exercice N', 'Exercice N-1']];
    for (const r of data.statementRows) rowsF.push([r.section, r.account, r.label, r.amountN, r.amountN1]);
    return accBuildXlsx(rowsF, esc);
  }
  if (data.transactions && data.transactions.length) {
    const rowsB = [['Document', doc.name], ['Type', 'Relevé bancaire'], ['IBAN', data.fields.iban ? data.fields.iban.value : ''], [],
      ['Date', 'Date de valeur', 'Libellé', 'Référence', 'Débit', 'Crédit', 'Solde', 'Confiance %']];
    for (const x of data.transactions) rowsB.push([x.date, x.valueDate || '', x.label, x.reference || '', x.debit, x.credit, x.balance, x.confidence]);
    return accBuildXlsx(rowsB, esc);
  }
  const rows = [['Document', doc.name], ['Type', data.docType], [], ['Champ', 'Valeur', 'Confiance %', 'Page']];
  const numKeys = new Set(['totalHT', 'vatAmount', 'totalTTC', 'deposit']);
  for (const [k, f] of Object.entries(data.fields || {})) rows.push([k, numKeys.has(k) && Acc.parseAmount(f.value) != null ? Acc.parseAmount(f.value) : f.value, f.confidence, (f.page || 0) + 1]);
  rows.push([]); rows.push(['Description', 'Quantité', 'Prix unitaire HT', 'Remise', 'TVA %', 'Montant HT']);
  for (const l of data.lines || []) rows.push([l.description, l.qty, l.unitPrice, l.discount, l.vatRate, l.amount]);
  rows.push([]); rows.push(['Taux TVA %', 'Montant TVA']);
  for (const v of data.vat || []) rows.push([v.rate, v.amount]);
  return accBuildXlsx(rows, esc);
}
async function accAnalyzeAll() {
  let done = 0, skipped = 0;
  for (const meta of (App.docs || [])) {
    const doc = await Repo.doc(meta.id);
    if (!doc || !doc.text || !doc.text.trim()) { skipped++; continue; }

    const pagesWords = await accLoadPagesWords(doc);
    const type = Acc.classifyType(doc.text).type;
    let data;
    if (type === 'releve_bancaire') data = Acc.extractBank(doc.text, pagesWords);
    else if (type === 'bulletin_salaire') data = Acc.extractPayroll(doc.text, pagesWords);
    else if (type === 'bilan' || type === 'compte_resultat') data = Acc.extractFinancial(doc.text, type, pagesWords);
    else if (type === 'pret_echeancier' || type === 'amort_emprunt') data = Acc.extractLoan(doc.text, pagesWords);
    else if (type === 'amort_immobilisation') data = Acc.extractAssets(doc.text, pagesWords);
    else if (type === 'note_frais') data = Acc.extractExpenses(doc.text, pagesWords);
    else data = Acc.extractInvoice(doc.text, pagesWords);
    if (!data.fields) data.fields = {};
    if (!data.fields.docType) data.fields.docType = { value: (Acc.TYPES.find(x => x[0] === data.docType) || [])[1] || data.docType, confidence: 60, page: 0, zone: null, status: 'reconnu' };
    for (const f of Object.values(data.fields || {})) if (f && !f.source) f.source = 'OCR Tesseract (local)';
  const merged = doc.acc ? accMergeCorrections(doc.acc.data, data) : data;
  doc.acc = { version: 2, firstAt: doc.acc ? (doc.acc.firstAt || doc.acc.at) : Date.now(), at: Date.now(), edited: !!(doc.acc && doc.acc.edited), textSnapshot: accSnapshot(doc), data: merged };
    doc.history = doc.history || []; doc.history.push({ at: Date.now(), action: 'Analyse comptable en lot' });
    await Repo.update(doc); done++;
  }
  App.docs = await Repo.list();
  await render();
  toast(done + ' document(s) analysé(s)/réanalysé(s) (corrections conservées), ' + skipped + ' ignoré(s) (sans OCR)', 'ok', 5000);
}
async function accVerify(docId) {
  const doc = await Repo.doc(docId);
  if (!doc || !doc.acc) { toast("Lancez d'abord la reconnaissance", 'err'); return; }
  const data = doc.acc.data;
  const pages = await Repo.pages(docId);
  const fields = Object.entries(data.fields || {});
  const uncertain = fields.filter(([, f]) => !f || f.value === Acc.NR || (f.confidence || 0) < 80);
  const corrected = fields.filter(([, f]) => f && f.status === 'corrige');
  const sh = openSheet({ title: 'Vérification — ' + doc.name, sub: 'Document original et données extraites. Touchez un champ pour retrouver sa zone (quand les coordonnées OCR existent).', full: true,
    body: `
    <div class="zone-wrap" id="verifyWrap" style="margin-bottom:10px">${pages.length && pages[0].src ? `<img src="${pages[0].src}" style="width:100%;border-radius:8px"><div class="zone-box" id="verifyBox" style="display:none"></div>` : '<p class="small muted">Page d\'origine non disponible pour ce document.</p>'}</div>
    <p class="tiny muted" id="verifyPage">${pages.length ? 'Page 1 sur ' + pages.length : ''}</p>
    <h4>Champs incertains (${uncertain.length})</h4>
    ${uncertain.length ? uncertain.map(([k, f]) => `<button class="btn xs ${f && f.zone ? 'soft' : 'ghost'}" data-verify-field="${k}" style="margin:2px">${k} : ${escapeHtml(f ? f.value : 'Non reconnu')} (${f ? f.confidence : 0} %)${f && f.zone ? ' · zone p.' + (f.zone.page + 1) : ' · pas de zone'}</button>`).join('') : '<p class="small muted">Aucun champ incertain.</p>'}
    <h4>Tous les champs</h4>
    ${fields.map(([k, f]) => `<button class="btn xs ghost" data-verify-field="${k}" style="margin:2px">${k} : ${escapeHtml(f ? f.value : 'Non reconnu')}${f && f.status === 'corrige' ? ' (corrigé)' : ''}</button>`).join('')}
    <h4>Contrôles arithmétiques</h4>
    ${(data.controls || []).map(c => `<div class="banner ${c.status === 'conforme' ? 'ok' : c.status === 'ecart' ? 'err' : 'warn'}"><span><b>${escapeHtml(c.label)}</b> — ${escapeHtml(c.detail)}</span></div>`).join('') || '<p class="small muted">Aucun contrôle.</p>'}
    <h4>Corrections manuelles (${corrected.length})</h4>
    ${corrected.length ? corrected.map(([k, f]) => `<div class="row"><span class="grow">${k}</span><b>${escapeHtml(f.value)}</b></div>`).join('') : '<p class="small muted">Aucune correction manuelle enregistrée.</p>'}`,
    actions: [{ label: 'Fermer', cls: 'go' }] });
  const box = $('#verifyBox', sh), wrap = $('#verifyWrap', sh), pageLbl = $('#verifyPage', sh);
  $$('[data-verify-field]', sh).forEach(btn => btn.addEventListener('click', async () => {
    const f = (data.fields || {})[btn.dataset.verifyField];
    if (!f || !f.zone) { toast('Aucune coordonnée OCR pour ce champ : zone non fabricable', 'err', 3500); return; }
    const pg = pages[f.zone.page || 0];
    if (!pg || !pg.src) { toast("Page d'origine introuvable", 'err'); return; }
    const img = wrap.querySelector('img'); if (img) img.src = pg.src;
    if (pageLbl) pageLbl.textContent = 'Page ' + ((f.zone.page || 0) + 1) + ' sur ' + pages.length + ' — zone du champ « ' + btn.dataset.verifyField + ' »';
    if (box) { box.style.display = 'block'; box.style.left = (f.zone.x * 100) + '%'; box.style.top = (f.zone.y * 100) + '%'; box.style.width = (f.zone.w * 100) + '%'; box.style.height = (f.zone.h * 100) + '%'; }
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}
async function accShowZone(el) {
  const doc = await Repo.doc(App.accDocId);
  if (!doc) return;
  const pages = await Repo.pages(doc.id);
  const pg = pages[+el.dataset.page || 0];
  const src = pg ? pg.src : doc.thumb;
  if (!src) { toast("Page d'origine introuvable pour cette zone", 'err'); return; }
  openSheet({ title: 'Zone reconnue — page ' + ((+el.dataset.page || 0) + 1), sub: "Le cadre rouge indique la zone de la page d'origine ayant produit la valeur.",
    body: `<div class="zone-wrap"><img src="${src}" style="width:100%;border-radius:8px"><div class="zone-box" style="left:${(+el.dataset.x * 100).toFixed(1)}%;top:${(+el.dataset.y * 100).toFixed(1)}%;width:${(+el.dataset.w * 100).toFixed(1)}%;height:${(+el.dataset.h * 100).toFixed(1)}%"></div></div>`,
    actions: [{ label: 'Fermer', cls: 'ghost' }] });
}

/* ---------------------------------------------------- outils PDF avancés -- */
function openPdfTools() {
  const doc = App.doc; if (!doc) return;
  let signature = '';
  const s = openSheet({
    title: 'Outils PDF avancés', sub: 'Les originaux sont conservés. Les options ci-dessous créent un nouveau PDF.',
    body: `<label class="row" style="gap:8px"><input type="checkbox" id="pdfNums"> Ajouter les numéros de page</label>
      <div class="field"><label>Compression PDF</label><select id="pdfQuality"><option value="low">Légère (fichier plus petit)</option><option value="med" selected>Équilibrée</option><option value="high">Qualité maximale</option></select><span class="tiny muted" id="pdfSizeHint">La taille réelle sera affichée après génération.</span></div>
      <div class="field"><label>Filigrane (optionnel)</label><input id="pdfWatermark" placeholder="Ex. CONFIDENTIEL"></div>
      <div class="field"><label>Signature manuscrite</label><canvas id="sigCanvas" width="520" height="160" style="width:100%;background:#fff;border:1px solid var(--line);border-radius:10px;touch-action:none"></canvas></div>
      <div class="btn-row"><button class="btn xs ghost" id="sigClear">Effacer la signature</button><button class="btn xs primary" id="pdfToolsGo">Créer le PDF enrichi</button></div>
      ${doc.kind === 'pdf' && doc.fileId ? `<hr><div class="field"><label>Extraire des pages du PDF importé</label><input id="pdfExtractSel" placeholder="Ex. 1-2, 4"><span class="tiny muted">Crée un nouveau document, sans modifier l'original.</span></div><button class="btn xs soft" id="pdfExtractGo">Extraire ces pages</button>` : '<p class="tiny muted">Pour extraire des pages d’un PDF importé, ouvrez un document de type PDF importé.</p>'}
      <hr><div class="field"><label>Extraire des pages d’un scan</label><input id="scanExtractSel" placeholder="Ex. 1, 3"><span class="tiny muted">Crée un nouveau document à partir des pages choisies, sans modifier l’original.</span></div><button class="btn xs soft" id="scanExtractGo">Extraire les pages du scan</button>`,
    actions: [{ label: 'Fermer', cls: 'ghost' }]
  });
  const cv = $('#sigCanvas', s); let drawing = false;
  if (cv) { const ctx = cv.getContext('2d'); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#123';
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX-r.left)*cv.width/r.width, y: (e.clientY-r.top)*cv.height/r.height }; };
    cv.addEventListener('pointerdown', e => { drawing = true; const p = pt(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pt(e); ctx.lineTo(p.x,p.y); ctx.stroke(); });
    cv.addEventListener('pointerup', () => { drawing = false; signature = cv.toDataURL('image/png'); });
    $('#sigClear', s).addEventListener('click', () => { ctx.clearRect(0,0,cv.width,cv.height); signature=''; });
  }
  $('#pdfToolsGo', s).addEventListener('click', async () => {
    try { const pages = await Repo.pages(doc.id); if (!pages.length) throw new Error('Convertissez d’abord ce PDF en pages modifiables pour appliquer ces options.');
      const qv=$('#pdfQuality', s).value; const qmap={low:{quality:.62,maxPx:1200},med:{quality:.82,maxPx:1800},high:{quality:.94,maxPx:2600}}; busyBar(true); const { blob } = await PDF.build(pages, { name: doc.name, ...qmap[qv], pageNumbers: $('#pdfNums', s).checked, watermark: $('#pdfWatermark', s).value.trim(), signature }); busyBar(false); const hint=$('#pdfSizeHint', s); if(hint) hint.textContent='Taille générée : '+fmtBytes(blob.size); downloadBlob(blob, slugify(doc.name) + '-enrichi.pdf'); toast('PDF enrichi téléchargé ('+fmtBytes(blob.size)+')', 'ok');
    } catch (e) { busyBar(false); toast(e.message, 'err', 5000); }
  });
  const scanEx = $('#scanExtractGo', s);
  if (scanEx) scanEx.addEventListener('click', async () => {
    try { const pages = await Repo.pages(doc.id); if (!pages.length) throw new Error('Ce document n’a pas de pages image extractibles.');
      const idx = PDF.parsePageSelection($('#scanExtractSel', s).value, pages.length); if (!idx.length) throw new Error('Sélection de pages vide ou invalide.');
      const chosen = idx.map(i => ({ ...pages[i], id: uid('pg') }));
      const nd = await Repo.create({ name: doc.name + ' — pages extraites', pages: chosen, source: 'extract-pages' });
      toast('Document créé avec ' + chosen.length + ' page(s)', 'ok'); closeSheet(); go('detail', nd.id);
    } catch (e) { toast('Extraction impossible : ' + e.message, 'err', 6000); }
  });
  const ex = $('#pdfExtractGo', s);
  if (ex) ex.addEventListener('click', async () => {
    try { const blob0 = await Repo.file(doc.id); if (!blob0) throw new Error('PDF original introuvable');
      const info = await PDF.inspect(new File([blob0], doc.name + '.pdf', { type: 'application/pdf' }));
      const idx = PDF.parsePageSelection($('#pdfExtractSel', s).value, info.pageCount || doc.pageCount);
      busyBar(true); const { blob, pageCount } = await PDF.extractPages(blob0, idx, { name: doc.name + ' extrait' }); busyBar(false);
      const file = new File([blob], slugify(doc.name) + '-extrait.pdf', { type: 'application/pdf' });
      const inf2 = await PDF.inspect(file); const nd = await Repo.create({ name: doc.name + ' — extrait', pages: [], file, thumb: inf2.thumb, source: 'extract' }); nd.kind='pdf'; nd.pageCount=pageCount; await Repo.update(nd); toast('Extraction créée : ' + pageCount + ' page(s)', 'ok'); closeSheet(); go('detail', nd.id);
    } catch (e) { busyBar(false); toast('Extraction impossible : ' + e.message, 'err', 6000); }
  });
}

/* aperçu : rendu HD (recadrage + filtre appliqués) */
async function showFullPreview() {
  const p = App.docPages[App.detailPage];
  const img = $('#previewImg');
  if (!img || !p) return;
  try {
    const token = (App._previewToken = (App._previewToken || 0) + 1);
    const c = await ImageOps.render(p, { maxPx: 1300, quality: 0.92 });
    if (token !== App._previewToken) return;
    img.src = c.toDataURL('image/jpeg', 0.92);
  } catch (e) { img.src = p.src || p.thumb; }
}

/* ============================================================== RECHERCHE == */
let searchTimer = null;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t || (t.id !== 'homeSearch' && t.id !== 'docsSearch')) return;
  App.search = t.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (App.route === 'home') {
      const box = $('#searchResults');
      if (box) box.innerHTML = App.search ? searchResultsHtml(App.search) : '';
    } else {
      render();
      const inp = $('#docsSearch');
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }, 220);
});

/* ============================================ navigation inférieure / FAB == */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    App.search = '';
    App.detailTab = 'preview';
    go(nav.dataset.nav);
    return;
  }
  if (e.target.closest('#fabScan')) { e.preventDefault(); openCamera(); }
});

/* =================================================================== INIT == */
async function init() {
  window.__scanproBackupExport = () => exportLibraryBackup();
  Settings.load();
  document.documentElement.dataset.theme = Settings.get('theme') || 'light';
  await Store.open();
  if (Store.isFallback || Store._writeError) Store._notifyStorage();
  App.docs = await Repo.list();
  // Service worker : vérifier activement les mises à jour et signaler l'état hors-ligne
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        reg.update().catch(() => {});
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Nouvelle version de ScanPro AI disponible : rechargez la page pour l\'appliquer.', 'ok', 7000); });
        });
      }
      // Complétude du cache hors-ligne : inspecter le VRAI cache de version
      // (jamais 'scanpro-ai-meta', qui ne contient que l'état), puis réparer
      // automatiquement en ligne ce qui manque avant d'alerter.
      if ('caches' in window) {
        const keys = await caches.keys();
        const versionCaches = keys.filter(k => /^scanpro-ai-v/.test(k));
        if (versionCaches.length) {
          let cache = null, cacheName = null;
          for (const name of versionCaches.slice().reverse()) {
            const c = await caches.open(name);
            if (await c.match('./', { ignoreSearch: true })) { cache = c; cacheName = name; break; }
          }
          if (!cache) { cacheName = versionCaches[versionCaches.length - 1]; cache = await caches.open(cacheName); }
          const needed = ['./', './vendor/tesseract.min.js', './vendor/jspdf.umd.min.js', './vendor/lang/fra.traineddata.gz'];
          const findMissing = async () => { const m = []; for (const n of needed) { if (!(await cache.match(n, { ignoreSearch: true }))) m.push(n); } return m; };
          let missing = await findMissing();
          if (missing.length && navigator.onLine) {
            for (const n of missing) {
              try { const res = await fetch(n, { cache: 'reload' }); if (res && res.ok) await cache.put(n, res.clone()); } catch (e) {}
            }
            missing = await findMissing();
            if (!missing.length) toast('Mode hors-ligne complété automatiquement : toutes les ressources essentielles sont en cache.', 'ok', 5000);
          }
          if (missing.length) toast('Mode hors-ligne incomplet (' + missing.length + ' ressource(s) essentielle(s) manquante(s)) : vérifiez votre connexion puis rechargez la page.', 'err', 8000);
        }
      }
    } catch (e) {}
  }
  if (!location.hash) { try { history.replaceState({ route: 'home' }, '', '#home'); } catch (e) {} }
  await go('home', null, { push: false });
  App.ready = true;

  if (!Settings.get('seenOnboarding')) {
    Settings.set('seenOnboarding', true);
    openSheet({
      title: 'Bienvenue dans ScanPro AI',
      sub: 'Votre scanner de documents, 100 % sur cet appareil.',
      body: `<div class="sheet-list">
        <div class="row" style="align-items:flex-start;gap:10px;padding:6px 2px">
          ${ICON('i-camera', 'ico')}<span class="small"><b>Scannez ou importez</b><br>
          Caméra live, galerie ou PDF existant.</span></div>
        <div class="row" style="align-items:flex-start;gap:10px;padding:6px 2px">
          ${ICON('i-text', 'ico')}<span class="small"><b>Extrayez le texte (OCR)</b><br>
          Français et anglais, exécuté localement par Tesseract.</span></div>
        <div class="row" style="align-items:flex-start;gap:10px;padding:6px 2px">
          ${ICON('i-pdf', 'ico')}<span class="small"><b>Exportez en PDF</b><br>
          Téléchargement, partage ou impression.</span></div>
        <div class="row" style="align-items:flex-start;gap:10px;padding:6px 2px">
          ${ICON('i-shield', 'ico')}<span class="small"><b>Aucun compte, aucun serveur</b><br>
          Vos documents restent dans le stockage du navigateur.</span></div>
      </div>`,
      actions: [{ label: 'Commencer', cls: 'primary' }]
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
