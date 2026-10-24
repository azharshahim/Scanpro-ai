/* =============================================================================
 * ScanPro AI — interactions : navigation, capture caméra, éditeur de pages,
 * actions documents, OCR, export PDF, assistant local.
 * ========================================================================== */
'use strict';

/* ------------------------------------------------------------ navigation -- */
const NAV = { home: 'Accueil', docs: 'Documents', settings: 'Paramètres' };

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

async function addPageFromDataUrl(src, { detect = true } = {}) {
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
      if (det && Vision._quadValid(det.quad)) {
        page.quad = det.quad;
        page.detected = true;
        // redressement estimé sur l'image redressée
        try {
          const warped = Vision.warp(canvas, det.quad, { maxPx: 900 });
          page.deskew = Vision.deskewAngle(warped);
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
      await addPageFromDataUrl(dataUrl);
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
  const cv = document.createElement('canvas');
  cv.width = canvas.width; cv.height = canvas.height;
  const k = Math.min(1, 620 / Math.max(canvas.width, canvas.height));
  cv.style.cssText = `width:${Math.round(canvas.width * k)}px;height:${Math.round(canvas.height * k)}px;border-radius:8px;display:block`;
  cv.getContext('2d').drawImage(canvas, 0, 0);
  host.appendChild(cv);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  poly.setAttribute('fill', 'rgba(37,99,235,.18)');
  poly.setAttribute('stroke', '#3B82F6');
  poly.setAttribute('stroke-width', '0.7');
  svg.appendChild(poly);
  host.appendChild(svg);

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
    host.appendChild(h);
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
      page.deskew = Vision.deskewAngle(warped);
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
  bind('doc-share', () => docSharePdf(doc.id));
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
    let results;
    try { results = await runOcr(rendered.map(r => ({ src: r.canvas.toDataURL('image/jpeg', 0.95) }))); }
    catch (e) { return; }
    if (!results) return;
    const text = results.map((r, i) => `— Page ${i + 1} —\n${r.text}`).join('\n\n').trim();
    const avg = Math.round(results.reduce((s, r) => s + r.confidence, 0) / Math.max(1, results.length));
    doc.text = text;
    doc.ocr = { status: text ? 'done' : 'empty', at: Date.now(), confidence: avg };
    doc.ocrUncertain = results.flatMap(r => r.uncertain || []);
    await Repo.update(doc);
    App.doc = doc; App.detailTab = 'text';
    await render();
    toast(text ? 'OCR terminé · confiance ' + avg + ' %' : 'Aucun texte détecté', text ? 'ok' : 'err', 5000);
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
    pages[i].text = results[i].text; pages[i].ocrConf = results[i].confidence;
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
      ${[['fra+eng', 'Français + Anglais', 'recommandé'], ['fra', 'Français', ''], ['eng', 'Anglais', '']].map(([k, l, tag]) =>
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
  'doc-share-pdf': () => docSharePdf(App.doc.id),
  'doc-print': () => docPrint(App.doc.id),
  'doc-export-images': () => docExportImages(App.doc.id),
  'doc-ocr': () => docRunOcr(App.doc.id),
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
  Settings.load();
  document.documentElement.dataset.theme = Settings.get('theme') || 'light';
  await Store.open();
  App.docs = await Repo.list();
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
