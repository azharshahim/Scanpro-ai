import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
         '--allow-file-access-from-files', '--unsafely-treat-insecure-origin-as-secure=http://localhost:8080']
});
const ctx = await browser.newContext({
  ...devices['Pixel 7'], locale: 'fr-FR', acceptDownloads: true,
  permissions: ['camera', 'microphone'],
  baseURL: 'http://localhost:8080'
});
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('.sheet .btn.primary').click().catch(() => {});
await page.waitForTimeout(300);

/* ---------- 1. Caméra avec périphérique simulé ---------- */
await page.locator("[data-act=\"scan-camera\"]").first().click();
await page.waitForSelector('#camVideo', { timeout: 10000 });
await page.waitForTimeout(2500);
const vid = await page.evaluate(() => {
  const v = document.querySelector('#camVideo');
  return { w: v.videoWidth, h: v.videoHeight, paused: v.paused, stream: !!v.srcObject };
});
log('✔ caméra simulée:', JSON.stringify(vid));
await page.screenshot({ path: path.join(OUT, '20-camera.png') });
await page.locator('[data-act="camera-shoot"]').click();
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, '21-camera-1page.png') });
const pill = await page.locator('#camPagesPill').innerText();
log('✔ après déclenchement, indicateur:', pill);
await page.locator('[data-act="camera-shoot"]').click();
await page.waitForTimeout(900);
await page.locator('[data-act="camera-done"]').click();
await page.waitForSelector('#editorScreen', { timeout: 10000 });
await page.waitForTimeout(1200);
const nbPages = await page.locator('.page-thumb').count();
log('✔ éditeur multi-pages, vignettes:', nbPages);

/* ---------- 2. Recadrage interactif ---------- */
await page.locator('[data-act="editor-crop"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, '22-recadrage.png') });
const box = await page.locator('#cropRect').boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 120, box.y + box.height - 160, { steps: 8 });
  await page.mouse.up();
}
await page.locator('[data-act="crop-apply"]').click();
await page.waitForTimeout(1200);
const crop = await page.evaluate(() => {
  const d = window.ScanPro && window.ScanPro.App.draft;
  return d ? d.pages[d.active].crop : null;
});
log('✔ recadrage appliqué:', JSON.stringify(crop));
await page.screenshot({ path: path.join(OUT, '23-recadrage-applique.png') });

/* ---------- 3. Pivoter + filtre + export ---------- */
await page.locator('[data-act="editor-rotate"]').click();
await page.waitForTimeout(900);
const rot = await page.evaluate(() => window.ScanPro.App.draft.pages[window.ScanPro.App.draft.active].rotate);
log('✔ rotation:', rot);
await page.locator('[data-act="editor-rotate"]').click();
await page.locator('[data-act="editor-rotate"]').click();
await page.locator('[data-act="editor-rotate"]').click();
await page.waitForTimeout(700);
await page.locator('[data-act="editor-filter"][data-f="gray"]').click();
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(OUT, '24-filtre-gris.png') });

const dlP = page.waitForEvent('download', { timeout: 60000 });
await page.locator('[data-act="editor-pdf"]').click();
const dl = await dlP;
await dl.saveAs(path.join(OUT, 'multi.pdf'));
log('✔ PDF multi-pages:', dl.suggestedFilename(), fs.statSync(path.join(OUT, 'multi.pdf')).size, 'octets');
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '25-detail-multipage.png') });

/* ---------- 4. Éditeur d'image existant + ajout de page ---------- */
await page.locator('[data-nav="docs"]').click();
await page.waitForTimeout(600);
const nbDocs = await page.locator('.doc-item').count();
log('✔ documents en bibliothèque:', nbDocs);

/* ---------- 5. Fusion de PDF (2 fichiers préparés) ---------- */
const mkPdf = async (name, text) => {
  const buf = await page.evaluate(async ({ text }) => {
    const { jsPDF } = window.jspdf;
    const d = new jsPDF();
    d.setFontSize(28); d.text('Document : ' + text, 20, 40);
    d.setFontSize(12);
    for (let i = 0; i < 12; i++) d.text('Ligne ' + (i + 1) + ' — contenu de test pour la fusion PDF.', 20, 60 + i * 8);
    const arr = new Uint8Array(d.output('arraybuffer'));
    return Array.from(arr);
  }, { text });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(buf) };
};
const f1 = await mkPdf('annexe-1.pdf', 'Annexe 1');
const f2 = await mkPdf('annexe-2.pdf', 'Annexe 2');
page.once('filechooser', async fc => { await fc.setFiles([f1, f2]); });
await page.locator('[data-act="merge-pdfs"]').first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, '26-fusion-feuille.png') });
await page.locator('[data-act="merge-go"]').click();
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, '27-fusion-resultat.png') });
const mergeInfo = await page.evaluate(async () => {
  const docs = await window.ScanPro.Repo.list();
  return docs.map(d => ({ name: d.name, pages: d.pageCount, kind: d.kind }));
});
log('✔ après fusion, documents:', JSON.stringify(mergeInfo));

/* ---------- 6. Import d'un PDF existant ---------- */
page.once('filechooser', async fc => { await fc.setFiles([f1]); });
await page.locator('[data-nav="home"]').click();
await page.waitForTimeout(400);
await page.locator('[data-act="import-pdf"]').click();
await page.waitForTimeout(2200);
await page.screenshot({ path: path.join(OUT, '28-pdf-importe.png') });
const imported = await page.evaluate(async () => {
  const docs = await window.ScanPro.Repo.list();
  const d = docs.find(x => x.name && x.name.includes('annexe'));
  return d ? { name: d.name, pages: d.pageCount, kind: d.kind, thumb: !!d.thumb } : null;
});
log('✔ PDF importé:', JSON.stringify(imported));

log('\n--- erreurs console ---');
log(errors.length ? errors.join('\n') : 'aucune');
await browser.close();
