// Livraison 3 : relevés bancaires — transactions, contrôles de soldes, doublons, exports.
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
const stmt = `Banque : Banque Fictive Test
Titulaire : Entreprise Exemple SARL
IBAN : FR76 1234 5678 9000 1234 5678 943
Relevé bancaire du 01/10/2026 au 31/10/2026
Solde initial : 1 000,00 €
01/10 Salaire octobre 2 500,00
02/10 CB Supermarche Exemple 120,50
03/10 PRLV EDF ref : EDF-991 60,00
05/10 VIR Client ABC +800,00 4 119,50
05/10 VIR Client ABC +800,00 4 919,50
06/10 Operation diverse 10,00
Solde final : 4 909,50 €`;
const bank = await p.evaluate((txt) => window.ScanPro.Acc.extractBank(txt), stmt);
check('Type relevé reconnu', bank.docType === 'releve_bancaire');
check('IBAN préservé comme texte sans espaces', bank.fields.iban.value === 'FR7612345678900012345678943', bank.fields.iban.value);
check('Titulaire et banque reconnus', /Entreprise Exemple/.test(bank.fields.holder.value) && /Banque Fictive/.test(bank.fields.bank.value));
check('Soldes ouverture/clôture', bank.fields.openingBalance.value === '1000' && bank.fields.closingBalance.value === '4909.5', bank.fields.openingBalance.value + '/' + bank.fields.closingBalance.value);
check('Transactions extraites (6 lignes, ordre préservé)', bank.transactions.length === 6 && bank.transactions[0].label.includes('Salaire'), '' + bank.transactions.length);
check('Crédit distinct du débit : salaire en crédit', bank.transactions[0].credit === 2500 && bank.transactions[0].debit === null);
check('Débit distinct : CB et PRLV en débit', bank.transactions[1].debit === 120.5 && bank.transactions[2].debit === 60);
check('Référence d\'opération extraite', bank.transactions[2].reference === 'EDF-991', String(bank.transactions[2].reference));
check('Solde après opération conservé', bank.transactions[3].balance === 4119.5);
check('Doublon potentiel détecté (même date/libellé/montant)', bank.duplicates.length === 1 && bank.transactions[4].duplicate === true, JSON.stringify(bank.duplicates));
check('Sens inconnu marqué À vérifier, pas deviné', bank.transactions[5].status === 'a-verifier' && bank.transactions[5].debit === null && bank.transactions[5].credit === null);
check('Contrôle ouverture+crédits−débits signalé avec opérations à vérifier', bank.controls.some(c => /ouverture/.test(c.label) && c.ok === false));
check('Avertissement non-rapprochement affiché', /pas un rapprochement bancaire/.test(bank.disclaimer));
// UI
await p.evaluate(async (txt) => {
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'bank1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Relevé test', pages: [pg], source: 'scan' });
  d.text = txt; await window.ScanPro.Repo.update(d);
}, stmt);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
await p.locator('[data-act="acc-analyze"]').click(); await p.waitForTimeout(900);
const ui = await p.locator('body').innerText();
check('UI : tableau des opérations affiché', ui.includes('Opérations (6)') && ui.includes('doublon'), ui.slice(ui.indexOf('Opérations'), ui.indexOf('Opérations') + 40));
check('UI : champs débit/crédit éditables', await p.locator('[data-acc-tx="0:credit"]').count() === 1 && await p.locator('[data-acc-tx="1:debit"]').count() === 1);
await p.locator('[data-acc-tx="5:debit"]').fill('10');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
const persisted = await p.evaluate(async () => { const d = window.ScanPro.App.docs.find(x => x.name.includes('Relevé')); return d && d.acc ? d.acc.data.transactions[5] : null; });
check('Correction d\'opération persistée', !!persisted && persisted.debit === 10, JSON.stringify(persisted));
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
for (const fmt of ['csv', 'xlsx', 'json']) {
  const dlp = p.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await p.locator(`[data-act="acc-export"][data-fmt="${fmt}"]`).click();
  const dl = await dlp; if (dl) await dl.saveAs(OUT + '/bank-export.' + fmt);
  check('Export relevé ' + fmt.toUpperCase(), !!dl && fs.existsSync(OUT + '/bank-export.' + fmt));
}
const csv = fs.readFileSync(OUT + '/bank-export.csv', 'utf8');
check('CSV : une ligne par opération, débit/crédit séparés', csv.split('\n').length >= 7 && csv.includes('Débit') && csv.includes('Salaire'), csv.split('\n')[1]);
const js = JSON.parse(fs.readFileSync(OUT + '/bank-export.json', 'utf8'));
check('JSON : transactions structurées', Array.isArray(js.transactions) && js.transactions.length === 6 && js.fields.iban.value.startsWith('FR76'));
check('XLSX relevé OOXML', fs.readFileSync(OUT + '/bank-export.xlsx').subarray(0, 2).toString() === 'PK');
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== COMPTABILITÉ L3 RELEVÉS : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
