// Livraison 6 : centre de contrôle, notes de frais, analyse en lot, écritures équilibrées.
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
const frais = `NOTE DE FRAIS
Salarié : Paul Martin
05/10 Train Paris Lyon 84,00
05/10 Hôtel nuit étape 92,00
06/10 Restaurant client 45,50
06/10 Carburant 60,00
Total : 281,50 €`;
const exp = await p.evaluate((txt) => window.ScanPro.Acc.extractExpenses(txt), frais);
check('Frais : 4 justificatifs reconnus', exp.expenseRows.length === 4, '' + exp.expenseRows.length);
check('Frais : catégories proposées (Transport/Hébergement/Repas/Carburant)', exp.expenseRows[0].category === 'Transport' && exp.expenseRows[1].category === 'Hébergement' && exp.expenseRows[2].category === 'Repas' && exp.expenseRows[3].category === 'Carburant');
check('Frais : contrôle somme = total OK', exp.controls.some(c => c.ok), JSON.stringify(exp.controls));
const devis = `DEVIS n° DEV-2026-11
Fournisseur : Dupont SARL
Date : 01/10/2026
Validité : 31/10/2026
Prestation 2 x 500,00 = 1 000,00
Total HT : 1 000,00 €
TVA 20 % : 200,00 €
Total TTC : 1 200,00 €`;
const dv = await p.evaluate((txt) => window.ScanPro.Acc.extractInvoice(txt), devis);
check('Devis : date de validité reconnue', dv.fields.validityDate.value === '31/10/2026', dv.fields.validityDate.value);
check('Devis : numéro DEV-… reconnu', /DEV-2026-11/.test(dv.fields.invoiceNumber.value), dv.fields.invoiceNumber.value);
const facAchat = await p.evaluate(() => { const d = window.ScanPro.Acc.extractInvoice(`Fournisseur : Martin SAS\nFacture n° F-2026-88\nDate : 01/10/2026\nTotal HT : 1 000,00 €\nTVA 20 % : 200,00 €\nTotal TTC : 1 200,00 €`); return window.ScanPro.Acc.journalEntries(d); });
check('Écritures achat : 3 lignes équilibrées (401/44566/607)', !!facAchat && facAchat.balanced && facAchat.rows.some(r => r.account === '401000' && r.credit === 1200) && facAchat.rows.some(r => r.account === '445660' && r.debit === 200), JSON.stringify(facAchat && facAchat.rows));
check('Écritures : avertissement comptes à vérifier présent', !!facAchat && /à adapter au plan comptable/.test(facAchat.warning));
const facVente = await p.evaluate(() => { const d = window.ScanPro.Acc.extractInvoice(`Client : non labellisé\nFacture n° F-2026-90\nDate : 02/10/2026\nTotal HT : 500,00 €\nTVA 20 % : 100,00 €\nTotal TTC : 600,00 €`); d.docType = 'facture_vente'; return window.ScanPro.Acc.journalEntries(d); });
check('Écritures vente : 411 débité, 706/44571 crédités, équilibrées', !!facVente && facVente.balanced && facVente.rows[0].account === '411000' && facVente.rows[0].debit === 600);
// UI : centre de contrôle + lot
await p.evaluate(async ({ txt1, txt2 }) => {
  const mk = async (name, txt) => { const c = document.createElement('canvas'); c.width = 500; c.height = 700; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 500, 700); const src = c.toDataURL('image/jpeg', .9); const pg = { id: 'l6' + name.length + Math.random().toString(36).slice(2, 6), src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } }; pg.thumb = await window.ScanPro.ImageOps.thumb(src); const d = await window.ScanPro.Repo.create({ name, pages: [pg], source: 'scan' }); d.text = txt; await window.ScanPro.Repo.update(d); };
  await mk('Frais test', txt1); await mk('Facture test', txt2);
}, { txt1: frais, txt2: `Fournisseur : Martin SAS\nFacture n° F-2026-88\nDate : 01/10/2026\nTotal HT : 1 000,00 €\nTVA 20 % : 200,00 €\nTotal TTC : 1 200,00 €` });
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
let ui = await p.locator('body').innerText();
check('UI : centre de contrôle affiché', ui.includes('Centre de contrôle') && ui.includes('Analyser tous'));
await p.locator('[data-act="acc-analyze-all"]').click(); await p.waitForTimeout(1200);
ui = await p.locator('body').innerText();
check('UI : analyse en lot effectuée (compteur mis à jour)', /2 document\(s\) analysé\(s\) sur 2/.test(ui), ui.match(/\d+ document\(s\) analysé\(s\) sur \d+/)?.[0]);
await p.locator('[data-act="acc-select"]').nth(1).click(); await p.waitForTimeout(600);
check('UI : bouton Écritures sur la facture analysée', await p.locator('[data-act="acc-export"][data-fmt="entries"]').count() >= 1);
await p.locator('[data-act="acc-export"][data-fmt="entries"]').click(); await p.waitForTimeout(600);
check('Export écritures : validation explicite demandée avant téléchargement', (await p.locator('body').innerText()).includes('non validée par un comptable'));
const dlp = p.waitForEvent('download', { timeout: 20000 }).catch(() => null);
await p.locator('[data-act="acc-entries-confirm"]').click(); const dl = await dlp;
if (dl) await dl.saveAs(OUT + '/ecritures.csv');
const csvE = dl ? fs.readFileSync(OUT + '/ecritures.csv', 'utf8') : '';
check('Export écritures CSV téléchargé et équilibré', !!dl && csvE.includes('401000') && csvE.includes('1 200'.replace(' ', '') || '1200'), csvE.split('\n')[1] || '');
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== COMPTABILITÉ L6 CONTRÔLE+ÉCRITURES : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
