// V2.22 — Moteur d'importation : dispositions de colonnes, frontière de date xc < 0,45,
// en-têtes répétés, pieds de page, lignes sans montant, orientation débit/crédit.
// Entièrement synthétique (boîtes de mots fictives) ; assertions fortes sur les valeurs.
import { chromium, devices } from 'playwright';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = [];
const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const p = await b.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' }).then(c => c.newPage());
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(APP, { waitUntil: 'load' });
await p.waitForTimeout(1000);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const r = await p.evaluate(() => {
  const A = window.ScanPro.Acc;
  const W = (t, x, y, w = 0.06) => ({ t, x, y, w, h: 0.02, c: 90 });
  const head = (dateX, debitX, creditX, soldeX) => [
    W('Date', dateX, 0.05), W('Libellé', dateX + 0.12, 0.05),
    W('Débit', debitX, 0.05), W('Crédit', creditX, 0.05), W('Solde', soldeX, 0.05)
  ];
  const row = (d, lab, amt, x, y, col = 'debit') => {
    const cells = [W(d, x, y), ...lab.split(' ').map((w, i) => W(w, x + 0.1 + i * 0.07, y))];
    cells.push(W(amt, { debit: 0.6, credit: 0.76, solde: 0.9 }[col], y, 0.08));
    return cells;
  };
  const R = {};
  R.standard = A.bankFromPositions([[...head(0.05, 0.6, 0.76, 0.9), ...row('02/10', 'PRLV FICTIF UN', '45,90', 0.05, 0.1)]])[0];
  R.date030 = A.bankFromPositions([[
    W('Date', 0.3, 0.05), W('Référence', 0.05, 0.05), W('Libellé', 0.4, 0.05), W('Débit', 0.62, 0.05), W('Crédit', 0.78, 0.05), W('Solde', 0.9, 0.05),
    W('REF998', 0.05, 0.1), W('02/10', 0.3, 0.1), W('VIR', 0.4, 0.1), W('1 500,00', 0.78, 0.1, 0.08)
  ]])[0];
  R.datelikeMilieu = A.bankFromPositions([[...head(0.05, 0.6, 0.76, 0.9), W('02/10', 0.55, 0.1), W('LIBELLE', 0.15, 0.1), W('45,90', 0.6, 0.1, 0.08)]]);
  R.footer = A.bankFromPositions([[...head(0.05, 0.6, 0.76, 0.9), ...row('02/10', 'PRLV FICTIF', '45,90', 0.05, 0.1), W('Page', 0.82, 0.95), W('2/4', 0.89, 0.95)]]);
  R.date042 = A.bankFromPositions([[
    W('Date', 0.42, 0.05), W('Libellé', 0.5, 0.05), W('Débit', 0.62, 0.05), W('Crédit', 0.78, 0.05), W('Solde', 0.9, 0.05),
    W('02/10', 0.42, 0.1), W('PRLV', 0.5, 0.1), W('45,90', 0.62, 0.1, 0.08)
  ]]);
  R.date048 = A.bankFromPositions([[
    W('Date', 0.48, 0.05), W('Libellé', 0.55, 0.05), W('Débit', 0.66, 0.05), W('Crédit', 0.8, 0.05), W('Solde', 0.9, 0.05),
    W('02/10', 0.48, 0.1), W('PRLV', 0.55, 0.1), W('45,90', 0.66, 0.1, 0.08)
  ]]);
  const pages = [];
  for (let pg = 0; pg < 3; pg++) pages.push([...head(0.05, 0.6, 0.76, 0.9), ...row('0' + (pg + 2) + '/10', 'OP PAGE ' + pg, (10 + pg) + ',00', 0.05, 0.1)]);
  R.troisPages = A.bankFromPositions(pages);
  R.sansMontant = A.bankFromPositions([[...head(0.05, 0.6, 0.76, 0.9), W('05/10', 0.05, 0.1), W('OPERATION', 0.15, 0.1), W('SANS MONTANT', 0.25, 0.1)]])[0];
  R.credit = A.bankFromPositions([[...head(0.05, 0.6, 0.76, 0.9), ...row('06/10', 'VIR SALAIRE FICTIF', '1 500,00', 0.05, 0.1, 'credit')]])[0];
  // Date dont le CENTRE de cellule frôle la frontière (xc = 0,4425 < 0,45) : acceptée.
  // La règle porte sur xc (centre), pas sur le bord gauche ; une boîte étroite simule un token réel.
  const Wn = (t, x, y) => ({ t, x, y, w: 0.045, h: 0.02, c: 90 });
  R.date044 = A.bankFromPositions([[
    Wn('Date', 0.42, 0.05), Wn('Libellé', 0.52, 0.05), Wn('Débit', 0.64, 0.05), Wn('Crédit', 0.8, 0.05), Wn('Solde', 0.92, 0.05),
    Wn('02/10', 0.42, 0.1), Wn('PRLV', 0.52, 0.1), Wn('45,90', 0.64, 0.1)
  ]]);
  // Date en 3e cellule (deux cellules de référence à gauche, toutes x < 0,45)
  R.dateCellule2 = A.bankFromPositions([[
    W('Réf1', 0.03, 0.05), W('Réf2', 0.12, 0.05), W('Date', 0.22, 0.05), W('Libellé', 0.32, 0.05), W('Débit', 0.6, 0.05), W('Crédit', 0.76, 0.05), W('Solde', 0.9, 0.05),
    W('AB1', 0.03, 0.1), W('XY2', 0.12, 0.1), W('02/10', 0.22, 0.1), W('PRLV', 0.32, 0.1), W('45,90', 0.6, 0.1, 0.08)
  ]]);
  // Lignes de solde/total/pied de page via le chemin POSITIONS : aucune ne doit devenir une opération
  R.lignesSolde = A.bankFromPositions([[
    ...head(0.05, 0.6, 0.76, 0.9),
    W('02/10', 0.05, 0.1), W('PRLV', 0.18, 0.1), W('45,90', 0.6, 0.1, 0.08),
    W('TOTAL', 0.18, 0.16), W('DES', 0.27, 0.16), W('OPERATIONS', 0.33, 0.16), W('45,90', 0.6, 0.16, 0.08), W('0,00', 0.76, 0.16, 0.08),
    W('ANCIEN', 0.18, 0.22), W('SOLDE', 0.27, 0.22), W('1 000,00', 0.9, 0.22, 0.08),
    W('NOUVEAU', 0.18, 0.28), W('SOLDE', 0.29, 0.28), W('954,10', 0.9, 0.28, 0.08),
    W('Page', 0.82, 0.95), W('1', 0.88, 0.95), W('/', 0.9, 0.95), W('4', 0.92, 0.95)
  ]]);
  // Montant à la frontière débit/crédit : opération conservée mais non affectée, exclue des totaux
  const headAmbig = [W('Date', 0.05, 0.05), W('Libellé', 0.18, 0.05), W('Débit', 0.6, 0.05), W('Crédit', 0.74, 0.05), W('Solde', 0.9, 0.05)];
  const wordsAmbig = [[...headAmbig,
    W('02/10', 0.05, 0.1), W('VIR', 0.18, 0.1), W('RECU', 0.24, 0.1), W('AMBIGU', 0.3, 0.1), W('9,99', 0.657, 0.1, 0.05), W('389,99', 0.9, 0.1, 0.08),
    W('03/10', 0.05, 0.18), W('PRLV', 0.18, 0.18), W('NET', 0.24, 0.18), W('60,00', 0.6, 0.18, 0.08), W('329,99', 0.9, 0.18, 0.08)
  ]];
  const dataAmbig = A.extractBank('', wordsAmbig);
  R.ambigu = { tx: dataAmbig.transactions, totals: dataAmbig.totals, controls: dataAmbig.controls };
  return R;
});

check('D1 disposition standard : débit 45,90 affecté, page 0', r.standard.debit === 45.9 && r.standard.credit === null && r.standard.page === 0, JSON.stringify(r.standard));
check('D2 date décalée à x=0,30 (colonne référence à gauche) : opération conservée avec sa référence', r.date030.date === '02/10' && r.date030.credit === 1500 && r.date030.reference === 'REF998', JSON.stringify(r.date030));
check('D3 token date-like en zone médiane (x=0,55) : aucune fausse transaction', r.datelikeMilieu === null, String(r.datelikeMilieu));
check('D4 pied de page "Page 2/4" : 1 seule vraie transaction, zéro fantôme', Array.isArray(r.footer) && r.footer.length === 1 && r.footer[0].date === '02/10', String(r.footer && r.footer.length));
check('D5 date à x=0,42 (juste sous la frontière 0,45) : acceptée', Array.isArray(r.date042) && r.date042.length === 1 && r.date042[0].debit === 45.9, JSON.stringify(r.date042));
check('D6 date à x=0,48 (au-delà de 0,45) : rejetée (frontière documentée, pas de devinette)', r.date048 === null, String(r.date048));
check('D7 trois pages, en-têtes répétés : 3 opérations, pages 0/1/2 exactes, aucun libellé pollué', r.troisPages.length === 3 && r.troisPages.every((t, i) => t.page === i) && r.troisPages.every(t => !/Date|Débit|Crédit|Solde/.test(t.label)), JSON.stringify(r.troisPages.map(t => [t.date, t.page])));
check('D8 ligne sans montant conservée avec débit/crédit/solde nulls (rien inventé)', r.sansMontant.label === 'OPERATION SANS MONTANT' && r.sansMontant.debit === null && r.sansMontant.credit === null && r.sansMontant.balance === null, JSON.stringify(r.sansMontant));
check('D9 crédit orienté correctement dans une disposition décalée (1 500,00)', r.credit.credit === 1500 && r.credit.debit === null, JSON.stringify([r.credit.debit, r.credit.credit]));
check('D10 date à x=0,44 (frontière exacte) : opération conservée, pas éliminée à tort', Array.isArray(r.date044) && r.date044.length === 1 && r.date044[0].debit === 45.9, JSON.stringify(r.date044));
check('D11 date en 3e cellule (deux références à gauche) : reconnue tant que x < 0,45', Array.isArray(r.dateCellule2) && r.dateCellule2.length === 1 && r.dateCellule2[0].date === '02/10' && r.dateCellule2[0].debit === 45.9, JSON.stringify(r.dateCellule2));
check('D12 lignes TOTAL/ANCIEN SOLDE/NOUVEAU SOLDE et pied de page espacé « Page 1 / 4 » : aucune transaction fantôme (1 seule op.)',
  Array.isArray(r.lignesSolde) && r.lignesSolde.length === 1 && r.lignesSolde[0].date === '02/10' && r.lignesSolde.every(t => !/SOLDE|TOTAL|Page/i.test(t.label)),
  JSON.stringify(r.lignesSolde && r.lignesSolde.map(t => [t.date, t.label])));
check('D13 montant frontière : opération conservée en « à vérifier », débit ET crédit nulls (aucun sens deviné)',
  r.ambigu.tx[0].status === 'a-verifier' && r.ambigu.tx[0].debit === null && r.ambigu.tx[0].credit === null,
  JSON.stringify([r.ambigu.tx[0].status, r.ambigu.tx[0].debit, r.ambigu.tx[0].credit]));
check('D14 totaux jamais calculés depuis l’ambigu : seul le 60,00 certain est totalisé (débit 60, pas 69,99)',
  r.ambigu.totals.debit === 60 && r.ambigu.totals.credit === 0 && r.ambigu.controls.some(c => /à vérifier/i.test(c.label) && c.status === 'ecart'),
  JSON.stringify({ totals: r.ambigu.totals, controls: r.ambigu.controls.map(c => c.label + ':' + c.status) }));

// R11 — frontière documentée par test : le défaut historique ne concerne QUE le chemin texte sans positions.
const r11 = await p.evaluate(() => {
  const A = window.ScanPro.Acc;
  const text = ['Solde initial 1 000,00', '02/10 PRLV FICTIF UN 45,90 954,10', '03/10 PRLV FICTIF DEUX 10,00 944,10', '04/10 VIR RECU FICTIF 100,00 1 044,10'].join('\n');
  const texteSeul = A.extractBank(text, []).transactions.map(t => t.page);
  const W = (t, x, y, page) => ({ t, x, y, w: 0.06, h: 0.02, c: 90 });
  const head = (pg) => [W('Date', 0.05, 0.05, pg), W('Libellé', 0.18, 0.05, pg), W('Débit', 0.6, 0.05, pg), W('Crédit', 0.74, 0.05, pg), W('Solde', 0.9, 0.05, pg)];
  const words = [
    [...head(0), W('02/10', 0.05, 0.1, 0), W('PRLV', 0.18, 0.1, 0), W('45,90', 0.6, 0.1, 0), W('954,10', 0.9, 0.1, 0)],
    [...head(1), W('03/10', 0.05, 0.1, 1), W('PRLV', 0.18, 0.1, 1), W('10,00', 0.6, 0.1, 1), W('944,10', 0.9, 0.1, 1), W('04/10', 0.05, 0.2, 1), W('VIR', 0.18, 0.2, 1), W('100,00', 0.74, 0.2, 1), W('1 044,10', 0.9, 0.2, 1)]
  ];
  const avecPositions = A.extractBank(text, words).transactions.map(t => t.page);
  return { texteSeul, avecPositions };
});
check('R11a : import PDF standard (positions pdf.js) → pages d’origine exactes 0/1/1', JSON.stringify(r11.avecPositions) === '[0,1,1]', JSON.stringify(r11.avecPositions));
check('R11b : chemin texte sans géométrie ni marqueur → origine inconnue explicite (null), jamais de fausse page 0 (V2.24 R11)', r11.texteSeul.every(pg => pg === null), JSON.stringify(r11.texteSeul));
check('Aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
console.log(`\n===== V2.22 DISPOSITIONS : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close();
process.exit(ko.length ? 1 : 0);
