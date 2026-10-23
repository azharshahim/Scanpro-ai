import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['Pixel 7'],
  locale: 'fr-FR',
  acceptDownloads: true,
  permissions: []
});
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

// --- 1. Charge un "document" de test (image réaliste) pour l'import
const gen = await ctx.newPage();
await gen.setViewportSize({ width: 1000, height: 1400 });
await gen.setContent(`<!doctype html><html lang="fr"><body style="margin:0;font-family:Georgia,serif;background:#fff">
<div style="width:1000px;height:1400px;padding:70px;box-sizing:border-box;background:#fff;color:#111">
  <div style="display:flex;justify-content:space-between;align-items:start;border-bottom:3px solid #111;padding-bottom:18px">
    <div><div style="font-size:38px;font-weight:bold;letter-spacing:2px">ATELIER DUPONT</div>
    <div style="font-size:20px;color:#333">12 rue des Lilas, 95000 Cergy</div></div>
    <div style="text-align:right;font-size:20px">Facture N° FAC-2026-0142<br>Date : 12/10/2026<br>Échéance : 12/11/2026</div>
  </div>
  <h1 style="font-size:44px;margin:40px 0 10px">FACTURE</h1>
  <p style="font-size:22px;line-height:1.6">Client : Monsieur Jean Martin, 8 avenue Victor Hugo, 75016 Paris.<br>
  SIRET : 812 345 678 00012 — TVA intracom : FR32812345678</p>
  <table style="width:100%;border-collapse:collapse;margin-top:36px;font-size:21px">
    <tr style="background:#eee"><th align="left" style="padding:12px;border:1px solid #999">Désignation</th>
      <th style="padding:12px;border:1px solid #999">Qté</th><th style="padding:12px;border:1px solid #999">Prix</th>
      <th style="padding:12px;border:1px solid #999">Total HT</th></tr>
    <tr><td style="padding:12px;border:1px solid #999">Prestation de conseil</td><td align="center" style="border:1px solid #999">10 h</td>
      <td align="center" style="border:1px solid #999">85,00 €</td><td align="center" style="border:1px solid #999">850,00 €</td></tr>
    <tr><td style="padding:12px;border:1px solid #999">Développement application</td><td align="center" style="border:1px solid #999">2</td>
      <td align="center" style="border:1px solid #999">600,00 €</td><td align="center" style="border:1px solid #999">1 200,00 €</td></tr>
    <tr><td style="padding:12px;border:1px solid #999">Maintenance annuelle</td><td align="center" style="border:1px solid #999">1</td>
      <td align="center" style="border:1px solid #999">450,00 €</td><td align="center" style="border:1px solid #999">450,00 €</td></tr>
  </table>
  <div style="margin-top:30px;font-size:22px;text-align:right;line-height:1.8">
    Total HT : 2 500,00 €<br>TVA 20 % : 500,00 €<br><b>Total TTC : 3 000,00 €</b></div>
  <p style="margin-top:50px;font-size:20px">Paiement par virement — IBAN FR76 3000 4008 2800 0123 4567 890.
  Merci de votre confiance. Cordialement, Monsieur Dupont.</p>
  <p style="margin-top:16px;font-size:18px;color:#555">Règlement à réception — pénalités de retard 10 %.
  Référence dossier : DOS-2026-77</p>
</div></body></html>`);
await gen.screenshot({ path: path.join(OUT, 'document-test.png') });
await gen.close();
log('✔ image de test générée');

// --- 2. Accueil
await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, '01-accueil-onboarding.png') });
const startBtn = page.locator('.sheet .btn.primary');
if (await startBtn.count()) await startBtn.click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, '02-accueil.png') });
log('✔ accueil rendu');

// --- 3. Import d'image -> éditeur
page.on('filechooser', async fc => { await fc.setFiles(path.join(OUT, 'document-test.png')); });
await page.locator('[data-act="import-image"]').click();
await page.waitForSelector('#editorScreen', { timeout: 15000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '03-editeur.png') });
log('✔ éditeur ouvert après import');

// --- 4. Filtre "Noir & blanc" + pivot (vérifie le rendu)
await page.locator('[data-act="editor-filter"][data-f="bw"]').click();
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '04-editeur-nb.png') });
await page.locator('[data-act="editor-filter"][data-f="color"]').click();
await page.waitForTimeout(1200);

// --- 5. Génération PDF (téléchargement)
const dlPromise = page.waitForEvent('download', { timeout: 45000 });
await page.locator('[data-act="editor-pdf"]').click();
const dl = await dlPromise;
const pdfPath = path.join(OUT, 'export.pdf');
await dl.saveAs(pdfPath);
const st = fs.statSync(pdfPath);
log('✔ PDF téléchargé:', dl.suggestedFilename(), st.size, 'octets');
const head = fs.readFileSync(pdfPath).subarray(0, 5).toString();
log('   signature PDF:', JSON.stringify(head));
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '05-detail.png') });
log('✔ vue détail du document');

// --- 6. OCR réel
await page.locator('[data-act="doc-ocr"]').first().click();
log('   OCR lancé…');
try {
  await page.waitForFunction(() => {
    const ta = document.querySelector('#ocrEditor');
    return ta && ta.value.trim().length > 30;
  }, { timeout: 180000 });
} catch (e) { log('   ⚠ OCR non terminé dans le délai'); }
await page.waitForTimeout(500);
const ocrText = await page.locator('#ocrEditor').inputValue().catch(() => '');
log('✔ OCR — ' + ocrText.length + ' caractères');
log('   aperçu:', JSON.stringify(ocrText.slice(0, 160)));
await page.screenshot({ path: path.join(OUT, '06-ocr-texte.png') });

// --- 7. Assistant IA local (onglet)
await page.locator('[data-act="detail-tab"][data-tab="ai"]').click();
await page.waitForTimeout(500);
await page.locator('[data-act="ai-classify"]').click().catch(() => {});
await page.locator('[data-act="ai-entities"]').click().catch(() => {});
await page.locator('[data-act="ai-summary"]').click().catch(() => {});
await page.locator('#aiQuery').fill('facture');
await page.locator('[data-act="ai-search"]').click();
await page.locator('[data-act="ai-invoice-demo"]').click();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '07-assistant.png'), fullPage: true });
const aiClass = await page.locator('#aiClass').innerText().catch(() => '');
log('✔ IA — classification:', aiClass.replace(/\n/g, ' | ').slice(0, 120));

// --- 8. Navigation : documents, paramètres, recherche
await page.locator('[data-nav="docs"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '08-documents.png') });
await page.locator('#docsSearch').fill('facture');
await page.waitForTimeout(500);
const found = await page.locator('.doc-item').count();
log('✔ recherche "facture" →', found, 'résultat(s)');
await page.locator('[data-act="clear-search"]').first().click().catch(() => {});
await page.locator('[data-nav="settings"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, '09-parametres.png'), fullPage: true });

// --- 9. Persistance après rechargement
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const docsAfter = await page.locator('.doc-item').count();
log('✔ après rechargement, documents listés:', docsAfter);
await page.screenshot({ path: path.join(OUT, '10-accueil-apres-reload.png') });

// --- 10. Menu document + fusion (vérif UI)
await page.locator('.doc-item').first().click();
await page.waitForTimeout(700);
await page.locator('.appbar [data-act="doc-menu"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, '11-menu-doc.png') });
await page.locator('[data-close]').first().click().catch(() => {});

// --- 11. Historique navigation arrière
await page.goBack();
await page.waitForTimeout(600);
log('✔ retour arrière OK, route:', await page.evaluate(() => location.hash));

log('\n--- erreurs console ---');
log(errors.length ? errors.join('\n') : 'aucune');
await browser.close();
