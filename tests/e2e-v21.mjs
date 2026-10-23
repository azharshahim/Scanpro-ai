/* V2.1 : réorganisation des pages, OCR de zone, mode rafale, gestes. */
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
await p.waitForTimeout(1600);
await p.locator('.sheet .btn.primary').click().catch(() => {});
await p.waitForTimeout(300);

/* ---------- 1. Rafale ---------- */
await p.locator('[data-act="scan-camera"]').first().click();
await p.waitForSelector('#camVideo', { timeout: 15000 });
await p.waitForTimeout(2200);
check('Bouton rafale visible', (await p.locator('#burstToggle').count()) === 1);
await p.locator('#burstToggle').click();
await p.waitForTimeout(600);
check('Rafale activée (état pressé)', (await p.locator('#burstToggle').getAttribute('aria-pressed')) === 'true');
await p.waitForTimeout(5200);   // ~4 photos espacées de 1,2 s
const burstPages = await p.evaluate(() => window.ScanPro.App.draft.pages.length);
check('Captures automatiques en rafale', burstPages >= 3, burstPages + ' pages');
await p.locator('#burstToggle').click();
await p.waitForTimeout(800);
const burstOff = await p.evaluate(() => window.ScanPro.App.draft.pages.length);
await p.waitForTimeout(2200);
check('Rafale arrêtée (plus de capture)', (await p.evaluate(() => window.ScanPro.App.draft.pages.length)) === burstOff);
await p.screenshot({ path: OUT + '/90-v21-rafale.png' });
await p.locator('[data-act="camera-done"]').click();
await p.waitForSelector('#editorScreen', { timeout: 15000 });
await p.waitForTimeout(1500);

/* ---------- 2. Réorganisation des pages ---------- */
await p.evaluate(async () => {
  const App = window.ScanPro.App;
  // pages repères avec un numéro visible
  const mk = async (n, color) => {
    const c = document.createElement('canvas'); c.width = 700; c.height = 990;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 990);
    x.fillStyle = color; x.font = 'bold 260px Georgia'; x.fillText(String(n), 250, 540);
    x.fillStyle = '#111'; x.font = '30px Georgia'; x.fillText('PAGE ' + n, 60, 90);
    const src = c.toDataURL('image/jpeg', 0.9);
    const page = { id: 'pgm' + n, src, crop: {x:0,y:0,w:1,h:1}, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: {b:1,c:1} };
    page.thumb = await window.ScanPro.ImageOps.thumb(src);
    return page;
  };
  const pages = [await mk(1, '#DC2626'), await mk(2, '#2563EB'), await mk(3, '#059669')];
  App.draft.pages = pages;
  App.draft.active = 0;
  window.ScanPro.Actions['editor-select-page']({ dataset: { i: '0' } });
});
await p.waitForTimeout(1500);
const before = await p.evaluate(() => window.ScanPro.App.draft.pages.map(x => x.id));
check('3 pages de test prêtes', before.length === 3, before.join(','));

// glisser-déposer tactile : appui long sur la page 1 puis déplacement au-delà de la page 3
const th1 = await p.locator('.page-thumb[data-i="0"]').boundingBox();
const th3 = await p.locator('.page-thumb[data-i="2"]').boundingBox();
if (th1 && th3) {
  const cdp = await ctx.newCDPSession(p);
  const x0 = th1.x + th1.width / 2, y0 = th1.y + th1.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await p.waitForTimeout(450);                                   // appui long
  const xEnd = th3.x + th3.width / 2 + 15;
  for (let i = 1; i <= 8; i++) {
    const x = x0 + (xEnd - x0) * i / 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 }] });
    await p.waitForTimeout(70);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
await p.waitForTimeout(1500);
const after = await p.evaluate(() => window.ScanPro.App.draft.pages.map(x => x.id));
check('Ordre modifié par glisser-déposer', JSON.stringify(after) !== JSON.stringify(before), before.join(',') + ' → ' + after.join(','));
check('Les 3 pages sont conservées', after.length === 3 && new Set(after).size === 3);
await p.screenshot({ path: OUT + '/91-v21-reorganisation.png' });

/* ---------- 3. OCR de zone dans l'éditeur ---------- */
await p.locator('[data-act="editor-select-page"]').first().click().catch(() => {});
await p.waitForTimeout(900);
await p.locator('[data-act="editor-ocr-zone"]').click();
await p.waitForTimeout(1200);
check('Sélecteur de zone ouvert', (await p.locator('#zoneWrap').count()) === 1);
const wrapBox = await p.locator('#zoneWrap').boundingBox();
if (wrapBox) {
  // trace un rectangle sur la moitié supérieure (là où se trouve « PAGE n »)
  await p.mouse.move(wrapBox.x + 10, wrapBox.y + 10);
  await p.mouse.down();
  await p.mouse.move(wrapBox.x + wrapBox.width - 10, wrapBox.y + wrapBox.height * 0.35, { steps: 10 });
  await p.mouse.up();
}
await p.waitForTimeout(400);
await p.screenshot({ path: OUT + '/92-v21-zone-selection.png' });
await p.locator('[data-act="zone-go"]').click();
console.log('   … OCR de la zone');
try {
  await p.waitForFunction(() => {
    const ta = document.querySelector('#zoneText');
    return ta && ta.value.trim().length > 0;
  }, { timeout: 180000 });
} catch (e) {}
const zoneTxt = await p.locator('#zoneText').inputValue().catch(() => '');
check('OCR de zone renvoie du texte', /page|p4ge|pase/i.test(zoneTxt), JSON.stringify(zoneTxt.slice(0, 40)));
await p.screenshot({ path: OUT + '/93-v21-zone-resultat.png' });
await p.locator('.sheet .btn.ghost').first().click().catch(() => {});
await p.waitForTimeout(400);

/* ---------- 4. Persistance de l'ordre + gestes dans l'aperçu ---------- */
await p.locator('[data-act="editor-save"]').click();
await p.waitForTimeout(2500);
const savedOrder = await p.evaluate(async () => {
  const App = window.ScanPro.App;
  const pages = await window.ScanPro.Repo.pages(App.param);
  return pages.map(x => x.index);
});
check('Ordre enregistré (index 0..n)', savedOrder.join(',') === '0,1,2', savedOrder.join(','));
const url = await p.evaluate(() => location.hash);
await p.locator('[data-act="detail-tab"][data-tab="preview"]').click().catch(() => {});
await p.waitForTimeout(1200);
const pbox = await p.locator('#previewBox').boundingBox();
if (pbox) {
  const cdp2 = await ctx.newCDPSession(p);
  const y = pbox.y + pbox.height / 2;
  const xa = pbox.x + pbox.width * 0.85, xb = pbox.x + pbox.width * 0.15;
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xa, y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: xa + (xb - xa) * i / 6, y }] });
    await p.waitForTimeout(35);
  }
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
await p.waitForTimeout(900);
const pageIdx = await p.evaluate(() => window.ScanPro.App.detailPage);
check('Balayage → page suivante', pageIdx === 1, 'page ' + (pageIdx + 1));
await p.screenshot({ path: OUT + '/94-v21-geste.png' });

/* ---------- 5. OCR de zone depuis la fiche document ---------- */
await p.locator('[data-act="detail-tab"][data-tab="preview"]').click();
await p.waitForTimeout(800);
check('Bouton « OCR d\'une zone » présent', (await p.locator('[data-act="doc-ocr-zone"]').count()) === 1);

check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n===== V2.1 :', ok.length, 'OK /', ko.length, 'échec(s) =====');
if (ko.length) console.log(ko.join('\n'));
await b.close();
process.exit(ko.length ? 1 : 0);
