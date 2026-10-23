/* Test de l'application publiée sur GitHub (raw.githack, HTTPS) :
   chargement, repli CDN des modèles, import d'image, OCR réel, export PDF. */
import { chromium, devices } from 'playwright';
import fs from 'fs';
const URL = process.env.APP_URL || 'https://raw.githack.com/azharshahim/Scanpro-ai/main/index.html';
const OUT = '/home/user/scanpro/tests/out';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage();
const errs = [], logs = [];
p.on('pageerror', e => errs.push(e.message.slice(0,200)));
p.on('console', m => { logs.push(m.type()+': '+m.text().slice(0,160)); });
console.log('URL testée :', URL);
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(()=>{});
await p.waitForTimeout(500);
console.log('app initialisée :', await p.evaluate(() => typeof window.ScanPro));
console.log('base des assets  :', await p.evaluate(() => Assets.base()));
await p.screenshot({ path: OUT + '/40-gh-accueil.png' });

// import d'une image de test puis OCR
p.once('filechooser', async fc => await fc.setFiles(OUT + '/document-test.png'));
await p.locator('[data-act="import-image"]').click();
await p.waitForSelector('#editorScreen', { timeout: 30000 });
await p.waitForTimeout(1500);
console.log('éditeur OK (import depuis la page publiée)');
const dlP = p.waitForEvent('download', { timeout: 90000 });
await p.locator('[data-act="editor-pdf"]').click();
const dl = await dlP;
await dl.saveAs(OUT + '/gh-export.pdf');
console.log('PDF généré :', fs.statSync(OUT + '/gh-export.pdf').size, 'octets');
await p.waitForTimeout(1000);
await p.locator('[data-act="doc-ocr"]').first().click();
console.log('OCR lancé (téléchargement des modèles depuis le CDN si nécessaire)…');
try {
  await p.waitForFunction(() => {
    const ta = document.querySelector('#ocrEditor');
    return ta && ta.value.trim().length > 30;
  }, { timeout: 240000 });
  const txt = await p.locator('#ocrEditor').inputValue();
  console.log('OCR publié ✅', txt.length, 'caractères |', JSON.stringify(txt.slice(0, 90)));
} catch (e) {
  console.log('OCR ❌ non abouti');
  await p.screenshot({ path: OUT + '/41-gh-ocr-echec.png' });
}
await p.screenshot({ path: OUT + '/42-gh-ocr.png' });
console.log('erreurs page :', errs.length ? errs : 'aucune');
console.log('journaux notables :', logs.filter(l => /Assets|CDN|error/i.test(l)).slice(0,6));
await b.close();
