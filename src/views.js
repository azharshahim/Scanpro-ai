/* =============================================================================
 * ScanPro AI — vues : Accueil, Documents, Paramètres, Détail document
 * ========================================================================== */
'use strict';

const ICON = (id, cls = 'ico') => `<svg class="${cls}"><use href="#${id}"/></svg>`;

function emptyState({ icon = 'i-folder', title, text, action = '' }) {
  return `<div class="empty"><div class="e-ico">${ICON(icon, 'ico lg')}</div>
    <h3>${escapeHtml(title)}</h3><p>${text}</p>${action}</div>`;
}

function docCard(doc, { compact = false } = {}) {
  const ocrTag = doc.ocr && doc.ocr.status === 'done'
    ? `<span class="tag ok">${ICON('i-check', 'ico sm')} OCR</span>`
    : (doc.ocr && doc.ocr.status === 'failed' ? `<span class="tag warn">OCR échoué</span>` : '');
  const kindTag = doc.kind === 'pdf' ? `<span class="tag blue">PDF importé</span>` : '';
  const thumb = doc.thumb
    ? `<img src="${doc.thumb}" alt="">`
    : `<svg class="ico lg muted"><use href="#i-file"/></svg>`;
  return `<button class="doc-item" data-act="open-doc" data-id="${doc.id}">
    <div class="doc-thumb">${thumb}</div>
    <div class="doc-meta">
      <b>${escapeHtml(doc.name)}</b>
      <div class="meta-line">
        <span>${fmtDate(doc.createdAt)}</span>
        <span>·</span>
        <span>${plural(doc.pageCount || 0, 'page', 'pages')}</span>
        ${compact ? '' : `<span>·</span><span>${fmtBytes(doc.bytes)}</span>`}
      </div>
      <div class="meta-line" style="margin-top:5px">${kindTag}${ocrTag}</div>
    </div>
    <span class="doc-row-actions" role="button" aria-label="Actions" data-act="doc-menu" data-id="${doc.id}">
      ${ICON('i-more', 'ico')}
    </span>
  </button>`;
}

/* =============================== ACCUEIL ================================= */
function viewHome() {
  const docs = App.docs;
  const recent = docs.slice(0, 4);
  const totalPages = docs.reduce((s, d) => s + (d.pageCount || 0), 0);
  const firstName = Settings.get('userName') || '';
  return `
  <header class="appbar">
    <div class="appbar-row">
      <div class="brand">
        <div class="brand-mark"><svg viewBox="0 0 24 24" class="ico"><use href="#i-scan"/></svg></div>
        <div>
          <div class="brand-name">ScanPro AI</div>
          <div class="brand-sub">Scanner & OCR</div>
        </div>
      </div>
      <button class="icon-btn" data-act="go-settings" aria-label="Paramètres">${ICON('i-settings')}</button>
    </div>
    <div class="hello">
      <h2>${firstName ? 'Bonjour ' + escapeHtml(firstName) : 'Prêt à numériser'}</h2>
      <p>Scannez, reconnaissez le texte et exportez en PDF.</p>
    </div>
    <div class="stat-row">
      <div class="stat"><b>${docs.length}</b><span>${docs.length > 1 ? 'documents' : 'document'}</span></div>
      <div class="stat"><b>${totalPages}</b><span>${totalPages > 1 ? 'pages scannées' : 'page scannée'}</span></div>
      <div class="stat"><b>100 %</b><span>local & privé</span></div>
    </div>
    <div class="local-chip">${ICON('i-shield', 'ico sm')} Traitement sur l'appareil</div>
  </header>

  <div class="content">
    <section class="scan-cta">
      <div class="cta-top">
        <div class="cta-badge">${ICON('i-camera', 'ico')}</div>
        <div>
          <h3>Nouveau scan</h3>
          <p>Caméra live, multi-pages, OCR et PDF</p>
        </div>
      </div>
      <button class="btn btn-camera" data-act="scan-camera">
        ${ICON('i-camera', 'ico')} Scanner avec la caméra
      </button>
      <div class="mini-row">
        <button class="btn" data-act="import-image">${ICON('i-image', 'ico sm')} Importer une image</button>
        <button class="btn" data-act="import-pdf">${ICON('i-pdf', 'ico sm')} Importer un PDF</button>
      </div>
    </section>

    <div class="quick-grid">
      <button class="quick" data-act="merge-pdfs">
        <span class="q-ico">${ICON('i-merge', 'ico sm')}</span>
        <span><b>Fusionner des PDF</b><span>2 fichiers ou plus</span></span>
      </button>
      <button class="quick" data-act="go-docs">
        <span class="q-ico">${ICON('i-folder', 'ico sm')}</span>
        <span><b>Mes documents</b><span>${plural(docs.length, 'fichier', 'fichiers')}</span></span>
      </button>
    </div>

    <div class="section-head">
      <h2>Rechercher</h2>
    </div>
    <label class="search">
      ${ICON('i-search')}
      <input id="homeSearch" type="search" placeholder="Nom du document ou texte reconnu…"
        value="${escapeHtml(App.search)}" enterkeyhint="search" autocomplete="off">
      ${App.search ? `<button class="clear" data-act="clear-search" aria-label="Effacer">${ICON('i-x', 'ico sm')}</button>` : ''}
    </label>
    <div id="searchResults">${App.search ? searchResultsHtml(App.search) : ''}</div>

    <div class="section-head">
      <h2>Derniers documents</h2>
      ${docs.length > 4 ? `<button class="link" data-act="go-docs">Tout voir</button>` : ''}
    </div>
    <div class="doc-list">
      ${recent.length
        ? recent.map(d => docCard(d)).join('')
        : emptyState({
            icon: 'i-scan',
            title: 'Aucun document pour l\'instant',
            text: 'Scannez une page ou importez une image pour commencer. Tout reste sur votre téléphone.',
            action: `<button class="btn primary" data-act="scan-camera">${ICON('i-camera', 'ico sm')} Commencer</button>`
          })}
    </div>
    ${docs.length > 4 ? `<button class="btn ghost mt14" data-act="go-docs">Voir les ${docs.length} documents</button>` : ''}
  </div>`;
}

function searchResultsHtml(q) {
  const needle = q.toLowerCase();
  const hits = App.docs.filter(d =>
    (d.name || '').toLowerCase().includes(needle) ||
    (d.text || '').toLowerCase().includes(needle));
  if (!hits.length) {
    return `<div class="banner info mt10">${ICON('i-info', 'ico sm')}
      <span>Aucun résultat pour « ${escapeHtml(q)} ». La recherche porte sur le nom et sur le texte reconnu (OCR).</span></div>`;
  }
  return `<div class="doc-list mt10">${hits.slice(0, 6).map(d => docCard(d, { compact: true })).join('')}</div>`;
}

/* ============================== DOCUMENTS ================================ */
function viewDocs() {
  const filters = [['all', 'Tous'], ['scan', 'Scans'], ['pdf', 'PDF importés'], ['ocr', 'Avec OCR']];
  let docs = App.docs.slice();
  if (App.docFilter === 'scan') docs = docs.filter(d => d.kind !== 'pdf');
  if (App.docFilter === 'pdf') docs = docs.filter(d => d.kind === 'pdf');
  if (App.docFilter === 'ocr') docs = docs.filter(d => d.ocr && d.ocr.status === 'done');
  if (App.search) {
    const n = App.search.toLowerCase();
    docs = docs.filter(d => (d.name || '').toLowerCase().includes(n) || (d.text || '').toLowerCase().includes(n));
  }
  const totalBytes = App.docs.reduce((s, d) => s + (d.bytes || 0), 0);
  return `
  <header class="appbar">
    <div class="appbar-row">
      <h1 style="margin-left:2px">Documents</h1>
      <button class="icon-btn" data-act="merge-pdfs" aria-label="Fusionner des PDF">${ICON('i-merge')}</button>
      <button class="icon-btn" data-act="scan-camera" aria-label="Nouveau scan">${ICON('i-plus')}</button>
    </div>
    <label class="search">${ICON('i-search')}
      <input id="docsSearch" type="search" placeholder="Rechercher un document…" value="${escapeHtml(App.search)}"
        autocomplete="off">
      ${App.search ? `<button class="clear" data-act="clear-search" aria-label="Effacer">${ICON('i-x', 'ico sm')}</button>` : ''}
    </label>
    <div class="filters" id="docFilters" style="padding:12px 0 0">
      ${filters.map(([k, l]) => `<button class="chip sm ${App.docFilter === k ? 'on' : ''}"
        data-act="filter-docs" data-key="${k}">${l}</button>`).join('')}
    </div>
  </header>
  <div class="content">
    <div class="row small muted" style="margin:0 2px 10px">
      <span class="grow">${plural(docs.length, 'document', 'documents')} · ${fmtBytes(totalBytes)}</span>
    </div>
    <div class="doc-list">
      ${docs.length ? docs.map(d => docCard(d)).join('')
        : emptyState({
            icon: App.search ? 'i-search' : 'i-folder',
            title: App.search ? 'Aucun résultat' : 'Votre bibliothèque est vide',
            text: App.search ? 'Essayez un autre mot-clé (nom ou texte reconnu).' : 'Les documents que vous scannez apparaissent ici.',
            action: App.search ? `<button class="btn ghost" data-act="clear-search">Effacer la recherche</button>`
              : `<button class="btn primary" data-act="scan-camera">${ICON('i-camera', 'ico sm')} Scanner un document</button>`
          })}
    </div>
  </div>`;
}

/* ============================== PARAMÈTRES =============================== */
async function viewSettings() {
  const st = await storageInfo();
  const pct = st.quota ? clamp((st.usage / st.quota) * 100, 0.1, 100) : 0;
  const langs = Settings.get('ocrLangs');
  const langLabel = { 'fra+eng': 'Français + Anglais', fra: 'Français', eng: 'Anglais' }[langs];
  const q = Settings.get('quality');
  return `
  <header class="appbar">
    <div class="appbar-row"><h1 style="margin-left:2px">Paramètres</h1></div>
    <div class="hello" style="margin-top:8px">
      <h2 style="font-size:20px">Préférences</h2>
      <p>Confidentialité, OCR et stockage local.</p>
    </div>
  </header>
  <div class="content">
    <div class="banner ok">${ICON('i-shield', 'ico sm')}
      <span><b>Aucun envoi vers un serveur.</b> Les images, le texte et les PDF restent dans le stockage
      du navigateur sur cet appareil. Aucun compte n'est requis.</span></div>

    <div class="set-group">
      <h3>Reconnaissance de texte</h3>
      <button class="set-row" data-act="set-langs">
        <span class="s-ico">${ICON('i-text', 'ico sm')}</span>
        <span class="s-body"><b>Langues OCR</b><span>${langLabel}</span></span>
        <span class="chev">${ICON('i-chevron', 'ico sm')}</span>
      </button>
      <button class="set-row" data-act="set-quality">
        <span class="s-ico">${ICON('i-image', 'ico sm')}</span>
        <span class="s-body"><b>Qualité des exports</b><span>${q === 'high' ? 'Élevée (2400 px)' : 'Standard (1600 px)'}</span></span>
        <span class="chev">${ICON('i-chevron', 'ico sm')}</span>
      </button>
      <div class="set-row">
        <span class="s-ico">${ICON('i-sparkles', 'ico sm')}</span>
        <span class="s-body"><b>OCR automatique</b><span>Lancer l'OCR après chaque scan</span></span>
        <button class="switch ${Settings.get('autoOcr') ? 'on' : ''}" data-act="toggle-autoocr"
          role="switch" aria-checked="${Settings.get('autoOcr')}" aria-label="OCR automatique"></button>
      </div>
    </div>

    <div class="set-group">
      <h3>Stockage local</h3>
      <div class="set-row" style="align-items:flex-start;flex-direction:column;gap:4px">
        <div class="row" style="width:100%">
          <span class="s-ico">${ICON('i-folder', 'ico sm')}</span>
          <span class="s-body">
            <b>${fmtBytes(App.docs.reduce((s, d) => s + (d.bytes || 0), 0))} utilisés</b>
            <span>${st.quota ? 'Sur ' + fmtBytes(st.quota) + ' disponibles' : 'Quota navigateur inconnu'}
            ${st.fallback ? ' — mode mémoire (non persistant)' : ''}</span>
          </span>
        </div>
        <div class="meter" style="width:100%"><i style="width:${pct}%"></i></div>
        <span class="tiny muted">${pct < 1 ? 'moins de 1' : pct.toFixed(1)} % du quota du navigateur utilisé.</span>
      </div>
      <button class="set-row" data-act="clear-all">
        <span class="s-ico" style="color:#B91C1C;background:#FDECEC">${ICON('i-trash', 'ico sm')}</span>
        <span class="s-body"><b>Supprimer tous les documents</b><span>Efface tout du stockage local</span></span>
        <span class="chev">${ICON('i-chevron', 'ico sm')}</span>
      </button>
    </div>

    <div class="set-group">
      <h3>À propos & fonctionnalités à venir</h3>
      <button class="set-row" data-act="show-permissions">
        <span class="s-ico">${ICON('i-lock', 'ico sm')}</span>
        <span class="s-body"><b>Permissions utilisées</b><span>Caméra, fichiers — à la demande</span></span>
        <span class="chev">${ICON('i-chevron', 'ico sm')}</span>
      </button>
      <button class="set-row" data-act="show-roadmap">
        <span class="s-ico">${ICON('i-sparkles', 'ico sm')}</span>
        <span class="s-body"><b>Feuille de route V2 → V4</b><span>IA, détection de contours, APK Android</span></span>
        <span class="chev">${ICON('i-chevron', 'ico sm')}</span>
      </button>
      <button class="set-row" data-act="show-help">
        <span class="s-ico">${ICON('i-info', 'ico sm')}</span>
        <span class="s-body"><b>Aide & bonnes pratiques</b><span>Conseils pour un bon OCR</span></span>
        <span class="chev">${ICON('i-chevron', 'ico sm')}</span>
      </button>
    </div>
    <div class="about">
      <b>ScanPro AI</b> — version 1.0.0 (Web)<br>
      OCR Tesseract.js · PDF jsPDF &amp; pdf-lib · 100 % hors-ligne après le premier chargement<br>
      ${st.fallback ? '<br><b style="color:#B45309">Attention :</b> IndexedDB indisponible (navigation privée) — les documents ne survivront pas à la fermeture.' : ''}
    </div>
  </div>`;
}

/* ============================ DÉTAIL DOCUMENT ============================ */
function viewDocDetail() {
  const doc = App.doc;
  if (!doc) return emptyState({ icon: 'i-alert', title: 'Document introuvable', text: 'Il a peut-être été supprimé.' });
  const pages = App.docPages;
  const p = pages[App.detailPage] || pages[0];
  const tab = App.detailTab;
  const text = doc.text || '';
  return `
  <header class="appbar">
    <div class="appbar-row">
      <button class="icon-btn" data-act="go-back" aria-label="Retour">${ICON('i-back')}</button>
      <h1>${escapeHtml(doc.name)}</h1>
      <button class="icon-btn" data-act="doc-menu" data-id="${doc.id}" aria-label="Actions du document">${ICON('i-more')}</button>
    </div>
    <div class="row small" style="margin-top:10px;color:#A9BFDF;gap:8px">
      <span>${plural(doc.pageCount || pages.length, 'page', 'pages')}</span><span>·</span>
      <span>${fmtDate(doc.createdAt)}</span><span>·</span>
      <span>${fmtBytes(doc.bytes)}</span>
    </div>
  </header>
  <div class="content">
    <div class="detail-tabs">
      <button class="${tab === 'preview' ? 'on' : ''}" data-act="detail-tab" data-tab="preview">${ICON('i-eye')} Aperçu</button>
      <button class="${tab === 'text' ? 'on' : ''}" data-act="detail-tab" data-tab="text">${ICON('i-text')} Texte OCR</button>
      <button class="${tab === 'ai' ? 'on' : ''}" data-act="detail-tab" data-tab="ai">${ICON('i-sparkles')} Assistant IA</button>
    </div>

    ${tab === 'preview' ? previewTab(doc, pages, p) : ''}
    ${tab === 'text' ? textTab(doc, text) : ''}
    ${tab === 'ai' ? aiTab(doc) : ''}
  </div>`;
}

function previewTab(doc, pages, p) {
  if (!pages.length) {
    // PDF importé / fusionné : pas de pages rendues, on affiche la vignette de la 1re page
    return `
    ${doc.thumb
      ? `<div class="preview-box"><img id="previewImg" src="${doc.thumb}" alt="Première page du PDF"></div>
         <div class="preview-nav"><span>Aperçu de la 1<sup>re</sup> page</span>
           <span>${plural(doc.pageCount || 0, 'page', 'pages')}</span></div>`
      : `<div class="banner info">${ICON('i-info', 'ico sm')}
          <span>Ce PDF de ${plural(doc.pageCount || 0, 'page', 'pages')} est conservé intact.
          Son aperçu n'a pas pu être généré sur cet appareil, mais le fichier reste téléchargeable,
          partageable et imprimable.</span></div>`}
    <div class="btn-col mt14">
      <button class="btn primary" data-act="doc-pdf-download">${ICON('i-download', 'ico sm')} Télécharger le PDF</button>
      <div class="btn-row">
        <button class="btn ghost" data-act="doc-share-pdf">${ICON('i-share', 'ico sm')} Partager</button>
        <button class="btn ghost" data-act="doc-print">${ICON('i-printer', 'ico sm')} Imprimer</button>
      </div>
      <button class="btn ghost" data-act="doc-rename">${ICON('i-edit', 'ico sm')} Renommer</button>
      <button class="btn danger" data-act="doc-delete">${ICON('i-trash', 'ico sm')} Supprimer le document</button>
    </div>
    <div class="banner warn mt14">${ICON('i-alert', 'ico sm')}
      <span><b>PDF importé :</b> il est conservé tel quel (l'original n'est pas réencodé).
      L'OCR page par page des PDF importés et la modification de leurs pages arrivent en V2.</span></div>`;
  }
  return `
  <div class="preview-box">
    <img id="previewImg" src="${p.thumb || p.src}" alt="Aperçu de la page ${App.detailPage + 1}">
  </div>
  <div class="preview-nav">
    <button class="btn xs ghost" data-act="preview-prev" ${App.detailPage <= 0 ? 'disabled' : ''}>${ICON('i-back', 'ico sm')} Préc.</button>
    <span>Page ${App.detailPage + 1} / ${pages.length}</span>
    <button class="btn xs ghost" data-act="preview-next" ${App.detailPage >= pages.length - 1 ? 'disabled' : ''}>Suiv. ${ICON('i-chevron', 'ico sm')}</button>
  </div>
  <div class="btn-col mt14">
    <button class="btn primary" data-act="doc-pdf-download">${ICON('i-download', 'ico sm')} Télécharger le PDF</button>
    <div class="btn-row">
      <button class="btn ghost" data-act="doc-share-pdf">${ICON('i-share', 'ico sm')} Partager</button>
      <button class="btn ghost" data-act="doc-print">${ICON('i-printer', 'ico sm')} Imprimer</button>
    </div>
    <div class="btn-row">
      <button class="btn soft" data-act="doc-export-images">${ICON('i-image', 'ico sm')} Exporter en images</button>
      <button class="btn soft" data-act="doc-edit">${ICON('i-edit', 'ico sm')} Modifier</button>
    </div>
    <button class="btn ghost" data-act="doc-ocr">${ICON('i-text', 'ico sm')} ${doc.ocr && doc.ocr.status === 'done' ? 'Relancer l\'OCR' : 'Extraire le texte (OCR)'}</button>
    <button class="btn ghost" data-act="doc-rename">${ICON('i-edit', 'ico sm')} Renommer</button>
    <button class="btn danger" data-act="doc-delete">${ICON('i-trash', 'ico sm')} Supprimer le document</button>
  </div>`;
}

function textTab(doc, text) {
  const ok = doc.ocr && doc.ocr.status === 'done';
  return `
  ${ok ? '' : `<div class="banner warn">${ICON('i-alert', 'ico sm')}
    <span><b>Aucun texte reconnu pour ce document.</b> Lancez l'extraction OCR : elle s'exécute localement
    et peut prendre quelques secondes par page.</span></div>
    <button class="btn primary mb14" data-act="doc-ocr">${ICON('i-text', 'ico sm')} Extraire le texte (OCR)</button>`}
  <textarea class="textarea" id="ocrEditor" spellcheck="false"
    placeholder="Le texte reconnu apparaîtra ici. Vous pourrez le corriger, le copier et le partager.">${escapeHtml(text)}</textarea>
  <div class="text-meta">
    <span>${text ? plural(text.trim().split(/\s+/).filter(Boolean).length, 'mot', 'mots') + ' · ' + plural(text.length, 'caractère', 'caractères') : 'Aucun texte'}
    ${ok && doc.ocr.confidence ? ' · confiance ' + doc.ocr.confidence + ' %' : ''}</span>
    <span id="saveHint" class="tiny"></span>
  </div>
  <div class="btn-row mt10">
    <button class="btn ghost" data-act="text-copy">${ICON('i-copy', 'ico sm')} Copier</button>
    <button class="btn ghost" data-act="text-share">${ICON('i-share', 'ico sm')} Partager</button>
  </div>
  <div class="btn-row mt10">
    <button class="btn soft" data-act="text-save">${ICON('i-check', 'ico sm')} Enregistrer</button>
    <button class="btn soft" data-act="text-find">${ICON('i-search', 'ico sm')} Rechercher</button>
  </div>
  ${ok ? `<div class="row mt14 small muted" style="gap:6px">${ICON('i-info', 'ico sm')}
    <span>Texte extrait le ${fmtDate(doc.ocr.at || doc.createdAt)} · ${doc.ocr.confidence || 0} % de confiance.</span></div>` : ''}`;
}

function aiTab(doc) {
  const text = doc.text || '';
  const hasText = text.trim().length > 40;
  return `
  <div class="ai-note mb14">${ICON('i-alert', 'ico sm')}
    <span><b>Assistant IA — aperçu.</b> Les analyses ci-dessous fonctionnent <b>hors-ligne</b> avec des règles
    déterministes (pas de modèle de langage). Les résumés avancés, l'extraction intelligente de factures et
    la classification fine nécessiteront un serveur ou une clé API : ces fonctions sont marquées
    <span class="soon">À venir</span> et ne prétendent pas fonctionner.</span></div>

  ${hasText ? '' : `<div class="banner warn">${ICON('i-text', 'ico sm')}
    <span>Lancez d'abord l'OCR : l'assistant analyse le texte reconnu.</span></div>
    <button class="btn primary mb14" data-act="doc-ocr">${ICON('i-text', 'ico sm')} Extraire le texte</button>`}

  <div class="ai-card">
    <h4>${ICON('i-sparkles', 'ico sm')} Classification du document
      <span class="tag ok" style="margin-left:auto">Hors-ligne</span></h4>
    <div id="aiClass">${hasText ? '' : '<p class="small muted mb0">Disponible après l\'OCR.</p>'}</div>
    ${hasText ? `<button class="btn xs soft mt10" data-act="ai-classify">Analyser</button>` : ''}
  </div>

  <div class="ai-card">
    <h4>${ICON('i-text', 'ico sm')} Entités détectées
      <span class="tag ok" style="margin-left:auto">Hors-ligne</span></h4>
    <div id="aiEntities">${hasText ? '' : '<p class="small muted mb0">Disponible après l\'OCR.</p>'}</div>
    ${hasText ? `<button class="btn xs soft mt10" data-act="ai-entities">Extraction dates, montants, références</button>` : ''}
  </div>

  <div class="ai-card">
    <h4>${ICON('i-file', 'ico sm')} Résumé automatique
      <span class="tag ok" style="margin-left:auto">Hors-ligne</span></h4>
    <div id="aiSummary">${hasText ? '' : '<p class="small muted mb0">Disponible après l\'OCR.</p>'}</div>
    ${hasText ? `<button class="btn xs soft mt10" data-act="ai-summary">Générer un résumé</button>` : ''}
  </div>

  <div class="ai-card">
    <h4>${ICON('i-search', 'ico sm')} Recherche dans le document</h4>
    <div class="field" style="margin:2px 0 0">
      <input id="aiQuery" placeholder="Ex. : numéro de facture, montant, date…" autocomplete="off">
    </div>
    <button class="btn xs soft mt10" data-act="ai-search">Rechercher</button>
    <div id="aiSearchOut" class="mt10"></div>
  </div>

  <div class="ai-card">
    <h4>${ICON('i-sparkles', 'ico sm')} Facture → données structurées
      <span class="soon" style="margin-left:auto">Serveur / API requis</span></h4>
    <p class="small muted" style="margin:0">Extraction fiable du fournisseur, des lignes d'articles, de la TVA
      et du total avec un modèle de vision. Nécessite un backend ou une clé API côté serveur —
      <b>non implémenté en V1</b>.</p>
    <button class="btn xs ghost mt10" data-act="ai-invoice-demo">Voir l'extraction locale approximative</button>
    <div id="aiInvoiceOut" class="mt10"></div>
  </div>

  <div class="ai-card">
    <h4>${ICON('i-sparkles', 'ico sm')} Résumé IA avancé &amp; questions-réponses
      <span class="soon" style="margin-left:auto">Serveur / API requis</span></h4>
    <p class="small muted" style="margin:0">Requiert un service externe (LLM). ScanPro AI n'envoie
      <b>aucun</b> document à un serveur sans votre accord explicite ; cette connexion n'est pas configurée.</p>
    <button class="btn xs ghost mt10" data-act="show-ia-requirements">Ce qu'il faut pour l'activer</button>
  </div>`;
}

/* -------------------------------------------------- rendu d'une vue (route) -- */
async function render() {
  const view = $('#view');
  document.body.classList.toggle('detail-open', App.route === 'detail');
  $$('.nav-item').forEach(b => b.classList.toggle('active',
    (App.route === 'docs' && b.dataset.nav === 'docs') ||
    (App.route === 'settings' && b.dataset.nav === 'settings') ||
    (['home', 'detail'].includes(App.route) && b.dataset.nav === 'home')));

  if (App.route === 'home') view.innerHTML = viewHome();
  else if (App.route === 'docs') view.innerHTML = viewDocs();
  else if (App.route === 'settings') { view.innerHTML = await viewSettings(); }
  else if (App.route === 'detail') view.innerHTML = viewDocDetail();

  if (App.route === 'home' || App.route === 'docs') {
    const inp = $('#homeSearch') || $('#docsSearch');
    if (inp) {
      const target = inp.id;
      if (App._focusSearch) { setTimeout(() => inp.focus(), 60); App._focusSearch = false; }
      if (inp.value) inp.setSelectionRange(inp.value.length, inp.value.length);
    }
    if (App._focusSearch) { const i = $('#homeSearch') || $('#docsSearch'); if (i) setTimeout(() => i.focus(), 80); }
  }
  if (App.route === 'detail') {
    const bar = $('.appbar .row'); // rien
  }
  // aperçu HD + analyses IA déjà calculées
  if (App.route === 'detail' && App.detailTab === 'preview' && App.docPages.length) showFullPreview();
  if (App.route === 'detail' && App.detailTab === 'ai') rerenderAiPanels();
  // écouteur de saisie OCR
  const ed = $('#ocrEditor');
  if (ed) {
    let t = null;
    ed.addEventListener('input', () => {
      const hint = $('#saveHint');
      if (hint) hint.textContent = 'Modifications non enregistrées';
      clearTimeout(t);
      t = setTimeout(async () => {
        App.doc.text = ed.value;
        App.doc.modified = true;
        await Repo.update(App.doc);
        if (hint) hint.textContent = 'Enregistré automatiquement ✓';
      }, 900);
    });
  }
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}
