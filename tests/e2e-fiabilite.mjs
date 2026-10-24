// Fiabilité : persistance, repli mémoire averti, erreur d'écriture, SW, nettoyage PDF, hors-ligne.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html'; const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
// 1) Persistance normale
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(APP, { waitUntil: 'load' }); await p.waitForTimeout(1300);
  await p.locator('.sheet .btn.primary').click().catch(() => {});
  await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 400; const src = c.toDataURL('image/jpeg', .9); const pg = { id: 'rel1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, filter: 'none', adj: { b: 1, c: 1 } }; pg.thumb = src; const d = await window.ScanPro.Repo.create({ name: 'Fiabilité persistance', pages: [pg], source: 'scan' }); d.text = 'test'; await window.ScanPro.Repo.update(d); });
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
  const found = await p.evaluate(() => window.ScanPro.App.docs.some(d => d.name === 'Fiabilité persistance'));
  check('Persistance après fermeture/rechargement (IndexedDB)', found);
  check('Pas d\'avertissement stockage en mode normal', await p.locator('#storageWarning').count() === 0);
  // 2) Erreur d'écriture simulée (quota)
  const wres = await p.evaluate(async () => { const S = window.ScanPro.Store; const realDb = S._db; S._db = { transaction() { const e = new Error('Quota dépassé simulé'); e.name = 'QuotaExceededError'; throw e; } }; const r = await S.put('docs', { id: 'quota-test', name: 'x' }); S._db = realDb; return { returned: r, err: S._writeError, banner: !!document.getElementById('storageWarning') }; });
  check('Échec d\'écriture signalé (pas de faux succès)', wres.returned === false && !!wres.err, JSON.stringify(wres));
  check('Avertissement visible après échec d\'écriture', wres.banner);
  check('Aucune erreur console en persistance normale', errs.length === 0, errs.slice(0, 2).join('|'));
  await ctx.close();
}
// 3) Repli mémoire : avertissement persistant, perte annoncée au rechargement
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 } });
  await ctx.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: undefined }); } catch (e) {} });
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const banner = await p.locator('#storageWarning').innerText().catch(() => '');
  check('Repli mémoire : avertissement persistant affiché', /Stockage durable indisponible/.test(banner) && /perdus à la fermeture/.test(banner), banner.slice(0, 80));
  check('Repli mémoire : export de secours proposé', await p.locator('#storageExportBtn').count() === 1);
  await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 200; c.height = 300; const src = c.toDataURL('image/jpeg', .9); const pg = { id: 'mem1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, filter: 'none', adj: { b: 1, c: 1 } }; pg.thumb = src; await window.ScanPro.Repo.create({ name: 'Doc mémoire éphémère', pages: [pg], source: 'scan' }); });
  const before = await p.evaluate(() => window.ScanPro.App.docs.some(d => d.name === 'Doc mémoire éphémère'));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
  const after = await p.evaluate(() => window.ScanPro.App.docs.some(d => d.name === 'Doc mémoire éphémère'));
  const banner2 = await p.locator('#storageWarning').count();
  check('Repli mémoire : doc présent en session puis perte annoncée au rechargement', before && !after && banner2 === 1, `avant=${before} après=${after}`);
  await ctx.close();
}
// 4) Service worker : ne supprime que ses caches (lecture du code déployé) + hors-ligne
{
  const sw = fs.readFileSync('/home/user/scanpro/sw.js', 'utf8');
  check('SW : suppression limitée aux caches scanpro-ai-*', /startsWith\('scanpro-ai-'\)/.test(sw) && !/k !== CACHE/.test(sw.replace("k !== CACHE &&", "")));
  check('SW : échecs de cache enregistrés (pas de catch silencieux global)', /failed\.push/.test(sw) && /__offline_status/.test(sw));
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'load' }); await p.waitForTimeout(1800);
  const meta = await p.evaluate(async () => { try { const c = await caches.open('scanpro-ai-meta'); const r = await c.match('./__offline_status'); return r ? await r.json() : null; } catch (e) { return null; } });
  check('SW : état hors-ligne lisible et complet en local', !!meta && meta.complete === true, JSON.stringify(meta && meta.failed));
  await ctx.setOffline(true);
  let txt = ''; try { await p.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); await p.waitForTimeout(1000); txt = await p.locator('body').innerText(); } catch (e) {}
  check('Hors-ligne après installation complète', txt.includes('ScanPro'));
  await ctx.close();
}
// 5) Nettoyage magique réellement reflété dans le rendu d'export (pixels)
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage();
  await p.goto(APP, { waitUntil: 'load' }); await p.waitForTimeout(1300);
  const res = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 560; const x = c.getContext('2d');
    x.fillStyle = '#E8E4DA'; x.fillRect(0, 0, 400, 560); x.fillStyle = '#999'; x.font = 'bold 40px Arial'; x.fillText('SPECIMEN', 60, 300); x.fillStyle = '#111'; x.font = '28px Arial'; x.fillText('Texte facture 100,00', 40, 120);
    const src = c.toDataURL('image/jpeg', .95);
    const mk = (cleanup) => ({ id: 'cl' + Math.random(), src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, filter: cleanup ? 'doc' : 'none', cleanup: cleanup ? { enabled: true, strength: .9, denoise: true, sharpen: true, illumination: true, watermark: true } : null, adj: { b: 1, c: 1 } });
    const mean = async (pg) => { const cv = await window.ScanPro.ImageOps.render(pg, { maxPx: 400 }); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i]; return s / (d.length / 16); };
    return { sans: await mean(mk(false)), avec: await mean(mk(true)) };
  });
  check('Nettoyage + filigrane appliqués au rendu utilisé pour le PDF', res.avec > res.sans + 5, `sans=${res.sans.toFixed(1)} avec=${res.avec.toFixed(1)}`);
  await ctx.close();
}
console.log(`\n===== FIABILITÉ : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
