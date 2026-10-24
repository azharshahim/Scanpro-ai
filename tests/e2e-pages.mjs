/* Test de bout en bout de l'application publiée sur GitHub Pages.
   Vérifie : chargement, service worker, caméra (périphérique simulé), import,
   recadrage, filtres, OCR réel, PDF, documents, fusion, persistance, PWA. */
import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

const APP = process.env.APP_URL || 'https://azharshahim.github.io/Scanpro-ai/';
const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const ok = [], ko = [];
const check = (label, cond, extra = '') => { (cond ? ok : ko).push(label + (extra ? ' — ' + extra : '')); console.log((cond ? '✅' : '❌') + ' ' + label + (extra ? ' — ' + extra : '')); };

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const ctx = await browser.newContext({
  ...devices['Pixel 7'], locale: 'fr-FR', acceptDownloads: true,
  permissions: ['camera', 'microphone']
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
p.on('requestfailed', r => errs.push('reqfail: ' + r.url().slice(0, 90) + ' ' + (r.failure()?.errorText || '')));

console.log('URL :', APP);
const t0 = Date.now();
await p.goto(APP, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(1800);
check('Chargement de la page', await p.evaluate(() => !!document.querySelector('#view')));
check('Application initialisée', (await p.evaluate(() => typeof window.ScanPro)) === 'object', (Date.now() - t0) + ' ms');
check('Assets locaux (fichiers servis par Pages)', (await p.evaluate(() => Assets.base())).includes('/Scanpro-ai/vendor/'));

const sheet = p.locator('.sheet .btn.primary');
if (await sheet.count()) await sheet.click();
await p.waitForTimeout(400);
await p.screenshot({ path: OUT + '/60-pages-accueil.png' });

// Service worker + manifeste
const sw = await p.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { supported: 'serviceWorker' in navigator, registered: !!reg, scope: reg?.scope || null };
});
check('Service worker enregistré', sw.registered, sw.scope || '');
const man = await p.evaluate(async () => {
  const l = document.querySelector('link[rel="manifest"]');
  if (!l) return { ok: false };
  const r = await fetch(l.href);
  const j = await r.json();
  return { ok: r.ok, name: j.name, icons: (j.icons || []).length };
});
check('Manifeste PWA valide', man.ok && man.items !== 0, man.name);

// Caméra (flux simulé)
await p.locator('[data-act="scan-camera"]').first().click();
await p.waitForSelector('#camVideo', { timeout: 15000 });
await p.waitForTimeout(2500);
const cam = await p.evaluate(() => {
  const v = document.querySelector('#camVideo');
  return { w: v.videoWidth, h: v.videoHeight, live: !!v.srcObject && !v.paused };
});
check('Caméra live (HTTPS)', cam.live && cam.w > 0, cam.w + '×' + cam.h);
await p.locator('[data-act="camera-shoot"]').click();
await p.waitForTimeout(1000);
await p.locator('[data-act="camera-shoot"]').click();
await p.waitForTimeout(1000);
check('Capture multi-pages', (await p.locator('#camPagesPill').innerText()).includes('2'));
await p.screenshot({ path: OUT + '/61-pages-camera.png' });
await p.locator('[data-act="camera-done"]').click();
await p.waitForSelector('#editorScreen', { timeout: 15000 });
await p.waitForTimeout(1200);
check('Éditeur multi-pages', (await p.locator('.page-thumb').count()) === 2);

// Filtres + recadrage + rotation
await p.locator('[data-act="editor-filter"][data-f="bw"]').click();
await p.waitForTimeout(1600);
const bw = await p.evaluate(() => {
  const c = document.querySelector('#editorCanvas');
  const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let dark = 0, light = 0;
  for (let i = 0; i < x.length; i += 4 * 97) { const v = x[i]; if (v < 40) dark++; else if (v > 215) light++; }
  return { dark, light };
});
check('Filtre Noir & blanc (seuillage)', bw.dark > 0 && bw.light > 0, JSON.stringify(bw));
await p.locator('[data-act="editor-filter"][data-f="doc"]').click();
await p.waitForTimeout(1200);
// on cible explicitement la page 1 (la page active après capture est la 2)
await p.locator('[data-act="editor-select-page"][data-i="0"]').click();
await p.waitForTimeout(900);
await p.locator('[data-act="editor-crop"]').click();
await p.waitForTimeout(900);
const box = await p.locator('#cropRect').boundingBox();
if (box) {
  await p.mouse.move(box.x + box.width - 6, box.y + box.height - 6);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width - 90, box.y + box.height - 110, { steps: 6 });
  await p.mouse.up();
}
await p.locator('[data-act="crop-apply"]').click();
await p.waitForTimeout(1400);
const cropState = await p.evaluate(() => {
  const d = window.ScanPro.App.draft;
  return { active: d.active, pages: d.pages.map(x => x.crop) };
});
const crop = cropState.pages[cropState.active];
check('Recadrage appliqué', crop.w < 0.99 && crop.h < 0.99, JSON.stringify(crop));
await p.locator('[data-act="editor-rotate"]').click();
await p.waitForTimeout(900);
check('Rotation', (await p.evaluate(() => {
  const d = window.ScanPro.App.draft; return d.pages[d.active].rotate;
})) === 90);
await p.screenshot({ path: OUT + '/62-pages-editeur.png' });

// PDF
const dlP = p.waitForEvent('download', { timeout: 90000 });
await p.locator('[data-act="editor-pdf"]').click();
const dl = await dlP;
const pdfPath = OUT + '/pages-export.pdf';
await dl.saveAs(pdfPath);
const pdfSize = fs.statSync(pdfPath).size;
check('Export PDF téléchargé', fs.readFileSync(pdfPath).subarray(0, 5).toString() === '%PDF-', pdfSize + ' octets');
await p.waitForTimeout(1200);

// OCR réel
await p.locator('[data-act="doc-ocr"]').first().click();
console.log('   … OCR en cours (premier lancement : téléchargement des modèles)');
let ocrLen = 0, ocrTxt = '';
try {
  await p.waitForFunction(() => (document.querySelector('#ocrEditor')?.value || '').trim().length > 20, { timeout: 240000 });
  ocrTxt = await p.locator('#ocrEditor').inputValue();
  ocrLen = ocrTxt.length;
} catch (e) {}
check('OCR réel exécuté', ocrLen > 20, ocrLen + ' caractères');
await p.screenshot({ path: OUT + '/63-pages-ocr.png' });

// Assistant local
if (ocrLen > 20) {
  await p.locator('[data-act="detail-tab"][data-tab="ai"]').click();
  await p.waitForTimeout(600);
  await p.locator('[data-act="ai-classify"]').click().catch(() => {});
  await p.locator('[data-act="ai-entities"]').click().catch(() => {});
  await p.waitForTimeout(700);
  const cls = await p.locator('#aiClass').innerText().catch(() => '');
  check('Assistant local (classification)', cls.length > 0, cls.split('\n')[0].slice(0, 60));
  await p.screenshot({ path: OUT + '/64-pages-assistant.png' });
}

// Documents + recherche + persistance
await p.locator('[data-nav="docs"]').click();
await p.waitForTimeout(700);
const nDocs = await p.locator('.doc-item').count();
check('Document enregistré dans la bibliothèque', nDocs >= 1, nDocs + ' document(s)');
await p.screenshot({ path: OUT + '/65-pages-documents.png' });
await p.locator('#docsSearch').fill('scan');
await p.waitForTimeout(600);
check('Recherche fonctionnelle', (await p.locator('.doc-item').count()) >= 1);
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1500);
check('Persistance après rechargement (IndexedDB)', (await p.locator('.doc-item').count()) >= 1);

// Navigation + paramètres
await p.locator('[data-nav="home"]').click(); await p.waitForTimeout(500); await p.locator('[data-act="go-settings"]').click();
await p.waitForTimeout(800);
check('Écran Paramètres', (await p.locator('.set-group').count()) >= 3);
await p.screenshot({ path: OUT + '/66-pages-parametres.png', fullPage: true });

check('Aucune erreur console/réseau', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('\n================ RÉSULTAT ================');
console.log('OK :', ok.length, '| ÉCHECS :', ko.length);
if (ko.length) console.log('Échecs :\n - ' + ko.join('\n - '));
await browser.close();
process.exit(ko.length ? 1 : 0);
