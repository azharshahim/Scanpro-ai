// V2.14 : reconstruction par positions OCR (colonnes), écran de vérification, précision mesurée.
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

// Fabrique des mots OCR positionnés (coordonnées relatives), comme Tesseract les fournit.
const built = await p.evaluate(() => {
  const Acc = window.ScanPro.Acc;
  const W = (t, x, y, w = 0.08, c = 92) => ({ t, x, y, w, h: 0.02, c });
  const words = [];
  // En-tête relevé : Date | Libellé | Débit | Crédit | Solde
  words.push(W('Date', .02, .05), W('Libellé', .15, .05), W('Débit', .55, .05, .07), W('Crédit', .72, .05, .07), W('Solde', .89, .05, .06));
  // Ligne 1 : montant sous la colonne Crédit, libellé neutre (aucun mot-clé de sens)
  words.push(W('02/10', .02, .10), W('Operation', .15, .10), W('Alpha', .28, .10), W('450,00', .70, .10, .09));
  // Ligne 2 : montant sous la colonne Débit, libellé neutre
  words.push(W('03/10', .02, .15), W('Operation', .15, .15), W('Beta', .28, .15), W('120,00', .53, .15, .09));
  const bank = Acc.extractBank('Relevé bancaire\nSolde initial : 1 000,00\nSolde final : 1 330,00', [words]);
  // Bilan positionné : en-tête années 2025 (N-1, à gauche) puis 2026 (N)
  const fw = [];
  fw.push(W('Poste', .02, .05), W('2025', .55, .05, .07), W('2026', .78, .05, .07));
  fw.push(W('Immobilisations', .02, .10, .20), W('45 000,00', .52, .10, .12), W('50 000,00', .75, .10, .12));
  fw.push(W('Stocks', .02, .15, .10), W('8 000,00', .52, .15, .12)); // seul le montant N-1 est présent
  const fin = Acc.extractFinancial('BILAN\nACTIF', 'bilan', [fw]);
  // Regroupement en lignes
  const lines = Acc.groupWordLines(words);
  // Aucune coordonnée -> pas de zone fabriquée
  const noZone = Acc.findZone(null, '1200');
  const zone = Acc.findZone([words], '450,00');
  return { bank, fin, linesCount: lines.length, noZone, zone };
});
check('Positions : lignes reconstruites depuis les mots', built.linesCount === 3, '' + built.linesCount);
check('Banque par colonnes : crédit affecté par la POSITION (libellé neutre)', built.bank.transactions[0].credit === 450 && built.bank.transactions[0].debit === null, JSON.stringify(built.bank.transactions[0]));
check('Banque par colonnes : débit affecté par la POSITION', built.bank.transactions[1].debit === 120 && built.bank.transactions[1].credit === null);
check('Banque par colonnes : source positionnée enregistrée', /positions OCR/.test(built.bank.transactions[0].source || ''));
check('États par en-tête : 2026=N et 2025=N-1 (pas « les deux derniers montants »)', built.fin.statementRows[0].amountN === 50000 && built.fin.statementRows[0].amountN1 === 45000, JSON.stringify(built.fin.statementRows[0]));
check('États : montant seul sous 2025 -> N-1 uniquement', built.fin.statementRows[1].amountN1 === 8000 && built.fin.statementRows[1].amountN === null, JSON.stringify(built.fin.statementRows[1]));
check('Coordonnées absentes : aucune zone fabriquée', built.noZone === null);
check('Zone retrouvée depuis les positions (page 0)', !!built.zone && built.zone.page === 0);

// Précision mesurée (champs et lignes) sur un jeu synthétique imparfait
const prec = await p.evaluate(() => {
  const Acc = window.ScanPro.Acc;
  const txt = `Fournisseur : Dupont SARL\nFacture n° FAC-2026-0142\nDate : 12/10/2026\nÉchéance : 12/11/2026\nSIRET : 812 345 678 00012\nPrestation conseil 10 x 250,00 = 2 500,00\nTotal HT : 2 500,00 €\nTVA 20 % : 500,00 €\nTotal TTC : 3 000,00 €`;
  const d = Acc.extractInvoice(txt);
  const expected = { supplier: 'Dupont SARL', invoiceNumber: 'FAC-2026-0142', totalHT: '2500', totalTTC: '3000', siret: '81234567800012' };
  let good = 0; for (const [k, v] of Object.entries(expected)) if (d.fields[k].value === v) good++;
  return { good, total: Object.keys(expected).length, lines: d.lines.length, fields: d.fields };
});
check(`Précision champs mesurée : ${prec.good}/${prec.total} sur facture synthétique`, prec.good === prec.total);
check('Précision lignes mesurée : 1/1 ligne de facture', prec.lines === 1);
check('Statuts de champs : reconnu / source OCR', prec.fields.totalTTC.status === 'reconnu');

// Écran de vérification UI
await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 500; c.height = 700; const src = c.toDataURL('image/jpeg', .9);
  const pg = { id: 'v214a', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 }, ocrWords: [{ t: '3 000,00', c: 95, x: .55, y: .8, w: .2, h: .03 }, { t: 'FAC-2026-0142', c: 93, x: .5, y: .12, w: .25, h: .03 }] };
  pg.thumb = src;
  const d = await window.ScanPro.Repo.create({ name: 'Vérification test', pages: [pg], source: 'scan' });
  d.text = `Fournisseur : Dupont SARL\nFacture n° FAC-2026-0142\nDate : 12/10/2026\nTotal HT : 2 500,00 €\nTVA 20 % : 500,00 €\nTotal TTC : 3 000,00 €`; await window.ScanPro.Repo.update(d);
});
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
await p.locator('[data-act="acc-analyze"]').click(); await p.waitForTimeout(900);
check('Bouton écran de vérification présent', await p.locator('[data-act="acc-verify"]').count() === 1);
await p.locator('[data-act="acc-verify"]').click(); await p.waitForTimeout(800);
const vui = await p.locator('body').innerText();
check('Vérification : original + incertains + contrôles + corrections', vui.includes('Champs incertains') && vui.includes('Contrôles arithmétiques') && vui.includes('Corrections manuelles'));
const zoneBtn = p.locator('[data-verify-field="totalTTC"]').first();
await zoneBtn.click(); await p.waitForTimeout(600);
check('Vérification : clic champ -> zone surlignée sur l\'original', await p.locator('#verifyBox:visible').count() === 1);
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.14 RECONNAISSANCE STRUCTURÉE : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
