/* Tests V2 : détection auto des contours, perspective, redressement, filtres avancés,
   OCR d'un PDF importé, conversion PDF -> pages. */
import { chromium, devices } from 'playwright';
import fs from 'fs';
const APP = process.env.APP_URL || 'http://localhost:8080/index.html';
const OUT = '/home/user/scanpro/tests/out';
const ok = [], ko = [];
const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };

const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'fr-FR', acceptDownloads: true, permissions: ['camera'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });

console.log('URL :', APP);
await p.goto(APP, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
await p.waitForTimeout(300);

// --- crée une photo de document incliné et l'injecte via le sélecteur de fichiers
const photoPath = OUT + '/80-v2-photo-inclinee.jpg';
const made = await p.evaluate(async () => {
  const TRUTH = { tl: { x: 0.16, y: 0.10 }, tr: { x: 0.87, y: 0.19 }, br: { x: 0.82, y: 0.88 }, bl: { x: 0.11, y: 0.80 } };
  const W = 1000, H = 1300;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const ctx = src.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#3b3b46'); grad.addColorStop(1, '#20222c');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  const doc = document.createElement('canvas'); doc.width = 700; doc.height = 990;
  const d = doc.getContext('2d');
  d.fillStyle = '#fff'; d.fillRect(0, 0, 700, 990);
  d.fillStyle = '#111'; d.font = 'bold 40px Georgia'; d.fillText('DEVIS 2026-77', 40, 80);
  d.font = '23px Georgia';
  ['Client : Monsieur Jean Martin', 'Date : 12/10/2026', 'Total HT : 2 500,00 EUR',
   'TVA : 500,00 EUR', 'Total TTC : 3 000,00 EUR', 'Merci de votre confiance'].forEach((l, i) => d.fillText(l, 40, 150 + i * 46));
  const dstPts = [{ x: TRUTH.tl.x*W, y: TRUTH.tl.y*H }, { x: TRUTH.tr.x*W, y: TRUTH.tr.y*H },
                  { x: TRUTH.br.x*W, y: TRUTH.br.y*H }, { x: TRUTH.bl.x*W, y: TRUTH.bl.y*H }];
  const srcPts = [{x:0,y:0},{x:700,y:0},{x:700,y:990},{x:0,y:990}];
  const M = Vision._homography(dstPts, srcPts);
  const [a, bb, c, dd, e, f, g, h] = M;
  const sd = d.getImageData(0, 0, 700, 990).data;
  const out = ctx.getImageData(0, 0, W, H); const od = out.data;
  for (let y = 0; y < H; y++) {
    let nu = c + bb*y, nv = f + e*y, den = 1 + h*y;
    for (let x = 0; x < W; x++) {
      const u = nu/den, v = nv/den; nu += a; nv += dd; den += g;
      if (u < 0 || v < 0 || u >= 700 || v >= 990) continue;
      const si = ((v|0)*700 + (u|0))*4, oi = (y*W + x)*4;
      od[oi]=sd[si]; od[oi+1]=sd[si+1]; od[oi+2]=sd[si+2]; od[oi+3]=255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return src.toDataURL('image/jpeg', 0.92);
});
fs.writeFileSync(photoPath, Buffer.from(made.split(',')[1], 'base64'));

// --- import -> détection automatique
p.once('filechooser', async fc => await fc.setFiles(photoPath));
await p.locator('[data-act="import-image"]').click();
await p.waitForSelector('#editorScreen', { timeout: 30000 });
await p.waitForTimeout(2500);
const st = await p.evaluate(() => {
  const pg = window.ScanPro.App.draft.pages[0];
  return { quad: pg.quad, deskew: pg.deskew, detected: pg.detected };
});
check('Contours détectés automatiquement', !!st.quad, st.quad ? JSON.stringify({
  tl: [+st.quad.tl.x.toFixed(2), +st.quad.tl.y.toFixed(2)],
  tr: [+st.quad.tr.x.toFixed(2), +st.quad.tr.y.toFixed(2)],
  br: [+st.quad.br.x.toFixed(2), +st.quad.br.y.toFixed(2)],
  bl: [+st.quad.bl.x.toFixed(2), +st.quad.bl.y.toFixed(2)]
}) : 'aucun');
const TRUTH = { tl: { x: 0.16, y: 0.10 }, tr: { x: 0.87, y: 0.19 }, br: { x: 0.82, y: 0.88 }, bl: { x: 0.11, y: 0.80 } };
if (st.quad) {
  const err = Math.max(...['tl','tr','br','bl'].map(k => Math.hypot(st.quad[k].x - TRUTH[k].x, st.quad[k].y - TRUTH[k].y)));
  check('Précision des coins (< 2 % de l\'image)', err < 0.02, 'écart max ' + (err * 100).toFixed(1) + ' %');
}
check('Badge « Perspective corrigée » affiché', (await p.locator('.detect-badge.on').count()) === 1);
await p.screenshot({ path: OUT + '/81-v2-editeur-autocrop.png' });

// l'aperçu doit être redressé : ratio proche d'une page A4 et texte droit
const geo = await p.evaluate(() => {
  const c = document.querySelector('#editorCanvas');
  return { w: c.width, h: c.height, ratio: +(c.height / c.width).toFixed(3) };
});
check('Aperçu redressé (ratio ≈ page)', geo.ratio > 1.15 && geo.ratio < 1.65, JSON.stringify(geo));

// --- ajustement manuel des 4 coins
await p.locator('[data-act="editor-corners"]').click();
await p.waitForTimeout(600);
check('Éditeur 4 coins ouvert', (await p.locator('.corner-handle').count()) === 4);
const h0 = await p.locator('.corner-handle').first().boundingBox();
if (h0) {
  await p.mouse.move(h0.x + h0.width/2, h0.y + h0.height/2);
  await p.mouse.down();
  await p.mouse.move(h0.x + h0.width/2 + 25, h0.y + h0.height/2 + 18, { steps: 6 });
  await p.mouse.up();
}
await p.screenshot({ path: OUT + '/82-v2-quatre-coins.png' });
await p.locator('[data-c="apply"]').click();
await p.waitForTimeout(1500);
check('Perspective validée (quad mis à jour)', (await p.evaluate(() => JSON.stringify(window.ScanPro.App.draft.pages[0].quad))) !== JSON.stringify(st.quad));
await p.screenshot({ path: OUT + '/83-v2-perspective-appliquee.png' });

// --- filtres avancés
for (const f of ['shadow', 'vivid', 'bw', 'doc']) {
  await p.locator(`[data-act="editor-filter"][data-f="${f}"]`).click();
  await p.waitForTimeout(1100);
}
check('Filtres V2 (anti-ombre, vif) disponibles', (await p.locator('[data-act="editor-filter"][data-f="shadow"]').count()) === 1);
await p.screenshot({ path: OUT + '/84-v2-filtre-doc.png' });

// --- redressement : page réellement inclinée de 6°
await p.evaluate(async () => {
  const doc = document.createElement('canvas'); doc.width = 800; doc.height = 1100;
  const d = doc.getContext('2d');
  d.fillStyle = '#fff'; d.fillRect(0, 0, 800, 1100);
  d.fillStyle = '#111'; d.font = 'bold 34px Georgia'; d.fillText('CONTRAT DE LOCATION', 50, 90);
  d.font = '20px Georgia';
  for (let i = 0; i < 16; i++) d.fillText('Clause numero ' + (i + 1) + ' — les parties conviennent', 50, 150 + i * 44);
  const tilt = document.createElement('canvas'); tilt.width = 800; tilt.height = 1100;
  const t = tilt.getContext('2d');
  t.fillStyle = '#c9ccd4'; t.fillRect(0, 0, 800, 1100);
  t.translate(400, 550); t.rotate(6 * Math.PI / 180);
  t.drawImage(doc, -400, -550);
  const App = window.ScanPro.App;
  const page = { id: 'pg_tilt', src: tilt.toDataURL('image/jpeg', 0.92), crop: { x: 0, y: 0, w: 1, h: 1 },
    rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  page.thumb = await window.ScanPro.ImageOps.thumb(page.src);
  App.draft.pages.push(page);
  App.draft.active = App.draft.pages.length - 1;
});
await p.evaluate(() => window.ScanPro.Actions['editor-select-page']({ dataset: { i: String(window.ScanPro.App.draft.pages.length - 1) } }));
await p.waitForTimeout(1500);
await p.locator('[data-act="editor-deskew"]').click();
await p.waitForTimeout(1500);
const sheetOpen = await p.locator('.sheet #dkRange').count();
const dkSub = await p.locator('.sheet p.sub').innerText().catch(() => '');
check('Redressement automatique proposé', sheetOpen === 1, dkSub.slice(0, 40));
check('Angle d\'inclinaison détecté (≈6°)', /[5-7](\.|\s?°)/.test(dkSub), dkSub.slice(0, 30));
await p.locator('[data-act="dk-ok"]').click().catch(() => {});
await p.waitForTimeout(1200);
const dkApplied = await p.evaluate(() => window.ScanPro.App.draft.pages[window.ScanPro.App.draft.active].deskew);
check('Correction de redressement appliquée', Math.abs(dkApplied) > 2, dkApplied + '°');
await p.screenshot({ path: OUT + '/84b-v2-redresse.png' });
// retour à la première page pour la suite du test
await p.evaluate(() => window.ScanPro.Actions['editor-select-page']({ dataset: { i: '0' } }));
await p.waitForTimeout(1200);

// --- PDF avec perspective corrigée
const dlP = p.waitForEvent('download', { timeout: 60000 });
await p.locator('[data-act="editor-pdf"]').click();
const dl = await dlP;
const pdfPath = OUT + '/85-v2-perspective.pdf';
await dl.saveAs(pdfPath);
check('PDF généré (perspective appliquée)', fs.statSync(pdfPath).size > 20000, fs.statSync(pdfPath).size + ' octets');

// --- OCR du document redressé
await p.locator('[data-act="doc-ocr"]').first().click();
let txt = '';
try {
  await p.waitForFunction(() => (document.querySelector('#ocrEditor')?.value || '').trim().length > 30, { timeout: 180000 });
  txt = await p.locator('#ocrEditor').inputValue();
} catch (e) {}
check('OCR sur image redressée', txt.includes('3 000') || txt.includes('3000') || /Total TTC/i.test(txt), JSON.stringify(txt.slice(0, 70)));
await p.screenshot({ path: OUT + '/86-v2-ocr-redresse.png' });

// --- PDF importé -> OCR + conversion en pages
const pdfBytes = await p.evaluate(async () => {
  const { jsPDF } = window.jspdf;
  const d = new jsPDF();
  d.setFontSize(26); d.text('FACTURE IMPORTEE 2026-900', 20, 40);
  d.setFontSize(14);
  d.text('Client : Societe Exemple', 20, 70);
  d.text('Montant total TTC : 1 234,56 EUR', 20, 90);
  d.addPage(); d.setFontSize(26); d.text('PAGE DEUX', 20, 40);
  return Array.from(new Uint8Array(d.output('arraybuffer')));
});
fs.writeFileSync(OUT + '/87-v2-import.pdf', Buffer.from(pdfBytes));
await p.locator('[data-nav="home"]').click();
await p.waitForTimeout(500);
p.once('filechooser', async fc => await fc.setFiles(OUT + '/87-v2-import.pdf'));
await p.locator('[data-act="import-pdf"]').click();
await p.waitForTimeout(2500);
check('PDF importé (2 pages)', (await p.locator('.appbar .row').innerText()).includes('2'));
await p.locator('[data-act="doc-ocr"]').first().click();
let pdfTxt = '';
try {
  await p.waitForFunction(() => (document.querySelector('#ocrEditor')?.value || '').trim().length > 20, { timeout: 180000 });
  pdfTxt = await p.locator('#ocrEditor').inputValue();
} catch (e) {}
check('OCR d\'un PDF importé', /1 234|1234|FACTURE/i.test(pdfTxt), JSON.stringify(pdfTxt.slice(0, 60)));
await p.screenshot({ path: OUT + '/88-v2-ocr-pdf.png' });
await p.locator('[data-act="detail-tab"][data-tab="preview"]').click();
await p.waitForTimeout(600);
await p.locator('[data-act="doc-to-images"]').click();
await p.waitForTimeout(700);
await p.locator('[data-action="x"]').count();
await p.locator('.sheet [data-act="confirm-ok"]').click().catch(async () => {
  await p.locator('.sheet .btn.primary').click();
});
await p.waitForTimeout(3000);
const conv = await p.evaluate(async () => {
  const d = await window.ScanPro.Repo.doc(window.ScanPro.App.param);
  const pages = await window.ScanPro.Repo.pages(window.ScanPro.App.param);
  return { kind: d.kind, pages: pages.length, hasFile: !!d.fileId };
});
check('Conversion PDF -> pages modifiables', conv.kind === 'scan' && conv.pages === 2 && !conv.hasFile, JSON.stringify(conv));
await p.screenshot({ path: OUT + '/89-v2-pdf-converti.png' });

check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n===== V2 :', ok.length, 'OK /', ko.length, 'échec(s) =====');
if (ko.length) console.log(ko.join('\n'));
await b.close();
process.exit(ko.length ? 1 : 0);
