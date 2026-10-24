// V2.14.1 : correctifs terrain — fausse alerte hors-ligne (mauvais cache inspecté),
// liste « À vérifier en priorité » (débordement + clic Ouvrir sans effet visible).
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html'; const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});

// --- 1) Hors-ligne : attendre l'installation du SW puis recharger ---
await p.waitForFunction(async () => { const k = await caches.keys(); return k.some(x => /^scanpro-ai-v/.test(x)); }, null, { timeout: 60000 }).catch(() => {});
await p.waitForTimeout(8000);
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(2500);
let body = await p.locator('body').innerText();
check('Hors-ligne : aucune fausse alerte « incomplet » après installation complète', !/hors-ligne incomplet/i.test(body));
const cacheState = await p.evaluate(async () => {
  const keys = await caches.keys();
  const vers = keys.filter(k => /^scanpro-ai-v/.test(k));
  let found = {};
  for (const name of vers) { const c = await caches.open(name); for (const n of ['./', './vendor/tesseract.min.js', './vendor/jspdf.umd.min.js', './vendor/lang/fra.traineddata.gz']) found[n] = found[n] || !!(await c.match(n, { ignoreSearch: true })); }
  return { keys, found };
});
check('Hors-ligne : le vrai cache de version contient les 4 ressources essentielles', Object.values(cacheState.found).every(Boolean), JSON.stringify(cacheState.keys));

// --- 2) Auto-réparation : supprimer une ressource du cache, recharger ---
await p.evaluate(async () => {
  const keys = await caches.keys();
  for (const name of keys.filter(k => /^scanpro-ai-v/.test(k))) { const c = await caches.open(name); await c.delete('./vendor/jspdf.umd.min.js', { ignoreSearch: true }); }
});
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(3000);
const repaired = await p.evaluate(async () => {
  const keys = await caches.keys();
  for (const name of keys.filter(k => /^scanpro-ai-v/.test(k))) { const c = await caches.open(name); if (await c.match('./vendor/jspdf.umd.min.js', { ignoreSearch: true })) return true; }
  return false;
});
body = await p.locator('body').innerText();
check('Hors-ligne : ressource manquante réparée automatiquement en ligne', repaired && !/hors-ligne incomplet/i.test(body));

// --- 3) Compta : liste « À vérifier en priorité » (nom très long, mobile 360 px) ---
const LONG = 'DB_aabhjecejeiac0x032B_261020_152224-modifie-protege';
await p.evaluate(async (name) => {
  const c = document.createElement('canvas'); c.width = 500; c.height = 700; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 500, 700);
  const src = c.toDataURL('image/jpeg', .9);
  const pg = { id: 'v141a', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name, pages: [pg], source: 'scan' });
  d.text = 'Facture test';
  d.acc = { at: Date.now(), edited: false, data: { docType: 'facture_achat', fields: { supplier: { value: 'Non reconnu', confidence: 0, status: 'non-reconnu' }, totalTTC: { value: 120, confidence: 40, status: 'reconnu' } }, controls: [{ label: 'HT + TVA = TTC', ok: false, status: 'ecart' }], lines: [] } };
  await window.ScanPro.Repo.update(d);
}, LONG);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(900);
body = await p.locator('body').innerText();
check('À vérifier : le document problématique est listé', body.includes('À vérifier en priorité') && body.includes('point(s) à vérifier'));
const overflow = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
check('À vérifier : aucun débordement horizontal sur 360 px (nom long)', overflow.sw <= overflow.iw + 1, JSON.stringify(overflow));
const btnBox = await p.locator('.card [data-act="acc-select"]').first().boundingBox();
check('À vérifier : bouton « Ouvrir » visible dans la largeur écran', !!btnBox && btnBox.x + btnBox.width <= 361, JSON.stringify(btnBox));
await p.locator('.card [data-act="acc-select"]').first().click(); await p.waitForTimeout(1400);
const detailBox = await p.locator('#accDetail').boundingBox();
const detailText = await p.locator('#accDetail').innerText().catch(() => '');
check('À vérifier : clic « Ouvrir » → détail du document affiché et amené à l’écran', !!detailBox && detailBox.y < 740 && detailText.includes(LONG.slice(0, 20)), JSON.stringify(detailBox));
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.14.1 CORRECTIFS TERRAIN : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close();
process.exit(ko.length ? 1 : 0);
