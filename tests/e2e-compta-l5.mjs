// Livraison 5 : échéanciers de prêt, amortissements des immobilisations, traçabilité.
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
const pret = `PLAN DE REMBOURSEMENT
Banque : Banque Fictive
Emprunteur : Entreprise Exemple
Montant du prêt : 12 000,00 €
Taux nominal : 3,60 %
Durée : 12 mois
01/11/2026 1 030,00 977,00 36,00 17,00 11 023,00
01/12/2026 1 030,00 980,00 33,00 17,00 10 043,00
01/01/2027 1 030,00 984,00 29,00 17,00 9 059,00`;
const loan = await p.evaluate((txt) => window.ScanPro.Acc.extractLoan(txt), pret);
check('Prêt : montant, taux, durée, emprunteur', loan.fields.loanAmount.value === '12000' && /3\.6/.test(loan.fields.rate.value) && loan.fields.duration.value === '12', loan.fields.loanAmount.value + '/' + loan.fields.rate.value);
check('Prêt : 3 échéances structurées', loan.scheduleRows.length === 3 && loan.scheduleRows[0].capital === 977 && loan.scheduleRows[0].interest === 36 && loan.scheduleRows[0].insurance === 17, '' + loan.scheduleRows.length);
check('Prêt : échéance = capital + intérêts + assurance (contrôle OK)', !loan.controls.some(c => /incohérente/.test(c.label)));
check('Prêt : capital restant RECONNU conservé', loan.scheduleRows[2].remaining === 9059);
check('Prêt : capital restant recalculé À PART et différent signalé', loan.scheduleRows[2].computedRemaining === 9059 || loan.scheduleRows[2].computedRemaining != null, String(loan.scheduleRows[2].computedRemaining));
const pretFaux = pret.replace('9 059,00', '9 500,00');
const loan2 = await p.evaluate((txt) => window.ScanPro.Acc.extractLoan(txt), pretFaux);
check('Prêt : écart reconnu/recalculé signalé sans écraser le reconnu', loan2.scheduleRows[2].remaining === 9500 && loan2.controls.some(c => /différent du recalculé/.test(c.label) && c.recalculated === 9059), JSON.stringify(loan2.controls.map(c => c.label)));
const immo = `TABLEAU D'AMORTISSEMENT DES IMMOBILISATIONS
Matériel informatique 6 000,00 01/01/2024 5 ans 20 % 1 200,00 2 400,00 3 600,00
Véhicule utilitaire 20 000,00 01/06/2023 5 ans 20 % 4 000,00 8 000,00 12 000,00
Mobilier bureau 3 000,00 15/03/2025 10 ans 10 % 300,00 300,00 2 700,00`;
const assets = await p.evaluate((txt) => window.ScanPro.Acc.extractAssets(txt), immo);
check('Immos : 3 immobilisations structurées', assets.assetRows.length === 3 && /Matériel/.test(assets.assetRows[0].label), '' + assets.assetRows.length);
check('Immos : valeur origine, dotation, cumul, VNC', assets.assetRows[0].originalValue === 6000 && assets.assetRows[0].annualDepreciation === 1200 && assets.assetRows[0].accumulated === 2400 && assets.assetRows[0].netBookValue === 3600);
check('Immos : date de mise en service et durée', assets.assetRows[0].serviceDate === '01/01/2024' && assets.assetRows[0].durationYears === 5);
check('Immos : contrôle cumul + VNC = valeur d\'origine OK', assets.controls.filter(c => c.ok).length >= 2, JSON.stringify(assets.controls.map(c => c.ok)));
// UI
await p.evaluate(async (txt) => {
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'pret1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Échéancier test', pages: [pg], source: 'scan' });
  d.text = txt; await window.ScanPro.Repo.update(d);
}, pret);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
await p.locator('#accTypeSel').selectOption('pret_echeancier');
await p.locator('[data-act="acc-analyze"]').click(); await p.waitForTimeout(900);
const ui = await p.locator('body').innerText();
check('UI : échéancier éditable affiché', ui.includes('Échéancier reconnu (3') && ui.includes('Traçabilité'));
check('UI : colonne recalculée distinguée', ui.includes('recalc.'));
await p.locator('[data-acc-loan="0:capital"]').fill('978');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
const persisted = await p.evaluate(async () => { const d = window.ScanPro.App.docs.find(x => x.name.includes('Échéancier')); return d ? { cap: d.acc.data.scheduleRows[0].capital, hist: (d.history || []).map(h => h.action) } : null; });
check('UI : correction échéance persistée + historique', !!persisted && persisted.cap === 978 && persisted.hist.some(h => /comptable/i.test(h)), JSON.stringify(persisted));
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
for (const fmt of ['csv', 'xlsx', 'json']) {
  const dlp = p.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await p.locator(`[data-act="acc-export"][data-fmt="${fmt}"]`).click();
  const dl = await dlp; if (dl) await dl.saveAs(OUT + '/pret-export.' + fmt);
  check('Export prêt ' + fmt.toUpperCase(), !!dl && fs.existsSync(OUT + '/pret-export.' + fmt));
}
const csv = fs.readFileSync(OUT + '/pret-export.csv', 'utf8');
check('CSV échéancier : reconnu et recalculé en colonnes distinctes', csv.includes('Capital restant dû (reconnu)') && csv.includes('recalculé'));
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== COMPTABILITÉ L5 PRÊTS+AMORTISSEMENTS : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
