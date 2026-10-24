// Livraison 4 : bulletins de salaire + bilans / comptes de résultat.
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
const paie = `BULLETIN DE PAIE
Employeur : Cabinet Exemple SAS
Salarié : Marie Dupont
Période de paie : Octobre 2026
Salaire de base : 2 800,00
151,67 heures travaillées
Prime exceptionnelle : 200,00
Salaire brut : 3 000,00
Cotisations salariales : 650,00
Cotisations patronales : 1 260,00
Net social : 2 350,00
Net imposable : 2 410,00
Net à payer : 2 280,00
Montant versé : 2 280,00`;
const pay = await p.evaluate((txt) => window.ScanPro.Acc.extractPayroll(txt), paie);
const PF = (k) => pay.fields[k].value;
check('Paie : salarié et employeur distincts', /Marie Dupont/.test(PF('employee')) && /Cabinet Exemple/.test(PF('employer')));
check('Paie : période reconnue', /Octobre 2026/.test(PF('period')), PF('period'));
check('Paie : base, heures, primes', PF('baseSalary') === '2800' && PF('hours') === '151.67' && PF('bonuses') === '200', PF('baseSalary') + '/' + PF('hours') + '/' + PF('bonuses'));
check('Paie : brut et cotisations salariales/patronales', PF('gross') === '3000' && PF('employeeContributions') === '650' && PF('employerContributions') === '1260');
check('Paie : net imposable ≠ net social ≠ net à payer (non confondus)', PF('netTaxable') === '2410' && PF('netSocial') === '2350' && PF('netPayable') === '2280', PF('netTaxable') + '/' + PF('netSocial') + '/' + PF('netPayable'));
check('Paie : contrôle Brut − cotisations ≈ Net social OK', pay.controls.some(c => c.ok && /Net social/.test(c.label)));
check('Paie : avertissement sensibilité présent', pay.sensitive === true && /100 % local/.test(pay.disclaimer));
const paiePartielle = await p.evaluate(() => window.ScanPro.Acc.extractPayroll('Bulletin de paie\nNet à payer : 1 500,00'));
check('Paie partielle : nets absents = Non reconnu, jamais inventés', paiePartielle.fields.netSocial.value === 'Non reconnu' && paiePartielle.fields.netTaxable.value === 'Non reconnu' && paiePartielle.fields.gross.value === 'Non reconnu');
const bilanTxt = `BILAN COMPTABLE
Exercice 2026
ACTIF
401 Immobilisations 50 000,00 45 000,00
411 Stocks 10 000,00 8 000,00
512 Banque 5 000,00 4 000,00
Total actif 65 000,00 57 000,00
PASSIF
101 Capital 40 000,00 40 000,00
401 Dettes fournisseurs 25 000,00 17 000,00
Total passif 65 000,00 57 000,00`;
const bilan = await p.evaluate((txt) => window.ScanPro.Acc.extractFinancial(txt, 'bilan'), bilanTxt);
check('Bilan : lignes structurées avec comptes et N/N-1', bilan.statementRows.length >= 7 && bilan.statementRows[0].account === '401' && bilan.statementRows[0].amountN === 50000 && bilan.statementRows[0].amountN1 === 45000, '' + bilan.statementRows.length);
check('Bilan : sections actif/passif distinguées', bilan.statementRows.some(r => r.section === 'actif') && bilan.statementRows.some(r => r.section === 'passif'));
check('Bilan : contrôle Total actif = Total passif OK', bilan.controls.some(c => c.ok && /Total actif = Total passif/.test(c.label)), JSON.stringify(bilan.controls.map(c => c.label)));
const crTxt = `COMPTE DE RESULTAT
CHARGES
601 Achats marchandises 30 000,00
641 Charges de personnel 20 000,00
Total charges 50 000,00
PRODUITS
701 Ventes 80 000,00
Total produits 80 000,00
Résultat net 30 000,00`;
const cr = await p.evaluate((txt) => window.ScanPro.Acc.extractFinancial(txt, 'compte_resultat'), crTxt);
check('Compte de résultat : charges/produits distingués', cr.statementRows.some(r => r.section === 'charges') && cr.statementRows.some(r => r.section === 'produits'));
check('Compte de résultat : résultat recalculé affiché à part (30 000)', cr.controls.some(c => c.recalculated === 30000), JSON.stringify(cr.controls));
// UI paie
await p.evaluate(async (txt) => {
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'paie1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Bulletin test', pages: [pg], source: 'scan' });
  d.text = txt; await window.ScanPro.Repo.update(d);
}, paie);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
await p.locator('#accTypeSel').selectOption('bulletin_salaire');
await p.locator('[data-act="acc-analyze"]').click(); await p.waitForTimeout(900);
const ui = await p.locator('body').innerText();
check('UI paie : bannière sensible + nets affichés', ui.includes('Document sensible') && ui.includes('Net imposable') && ui.includes('Net à payer'));
await p.locator('[data-acc-field="netPayable"]').fill('2290');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
const persisted = await p.evaluate(async () => { const d = window.ScanPro.App.docs.find(x => x.name.includes('Bulletin')); return d && d.acc ? d.acc.data.fields.netPayable.value : null; });
check('UI paie : correction du net à payer persistée', persisted === '2290', String(persisted));
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
for (const fmt of ['csv', 'xlsx', 'json']) {
  const dlp = p.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await p.locator(`[data-act="acc-export"][data-fmt="${fmt}"]`).click();
  const dl = await dlp; if (dl) await dl.saveAs(OUT + '/paie-export.' + fmt);
  check('Export paie ' + fmt.toUpperCase(), !!dl && fs.existsSync(OUT + '/paie-export.' + fmt));
}
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== COMPTABILITÉ L4 PAIE+ÉTATS : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
