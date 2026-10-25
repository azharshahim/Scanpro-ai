// Générateur de relevés bancaires FICTIFS (PDF texte natif, pdf-lib) pour les tests V2.22.
// Aucune donnée réelle : tous les noms, comptes et montants sont inventés.
// Les coordonnées x sont des fractions de la largeur de page (comme les wordBoxes normalisées de l'app).
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export async function buildPdf(lines, { width = 595.28, height = 841.89, pages = 1 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cols = lines.cols || { date: 0.05, label: 0.18, debit: 0.60, credit: 0.74, solde: 0.90 };
  const pageObjs = [];
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([width, height]);
    pageObjs.push({ page, y: height - 60 });
    page.drawText(lines.bank || 'BANQUE FICTIVE D’ESSAI', { x: 40, y: height - 40, size: 14, font, color: rgb(0.05, 0.1, 0.25) });
    page.drawText((lines.title || 'RELEVE DE COMPTE') + (pages > 1 ? ' — page ' + (p + 1) + '/' + pages : ''), { x: 40, y: height - 58, size: 10, font });
    if (lines.iban) page.drawText('IBAN ' + lines.iban, { x: 40, y: height - 74, size: 9, font });
    const head = lines.headers || ['Date', 'Libellé', 'Débit', 'Crédit', 'Solde'];
    const headAt = [cols.date, cols.label, cols.debit, cols.credit, cols.solde];
    head.forEach((h, i) => page.drawText(h, { x: headAt[i] * width, y: height - 100, size: 9, font }));
    pageObjs[p].y = height - 122;
  }
  const put = (pageIdx, text, xFrac, size = 9) => {
    const po = pageObjs[pageIdx];
    po.page.drawText(text, { x: xFrac * width, y: po.y, size, font });
  };
  for (const row of lines.rows) {
    const pi = row.page || 0; const po = pageObjs[pi];
    const y = po.y;
    if (row.kind === 'header') { ['Date', 'Libellé', 'Débit', 'Crédit', 'Solde'].forEach((h, i) => po.page.drawText(h, { x: [cols.date, cols.label, cols.debit, cols.credit, cols.solde][i] * width, y, size: 9, font })); }
    else if (row.kind === 'raw') { po.page.drawText(row.text, { x: (row.x ?? cols.date) * width, y, size: 9, font }); }
    else if (row.kind === 'continuation') { po.page.drawText(row.text, { x: cols.label * width, y, size: 9, font }); }
    else if (row.kind === 'cells') { for (const cell of row.cells) po.page.drawText(cell.t, { x: cell.x * width, y, size: 9, font }); }
    else {
      if (row.date) po.page.drawText(row.date, { x: cols.date * width, y, size: 9, font });
      if (row.label) po.page.drawText(row.label, { x: cols.label * width, y, size: 9, font });
      if (row.debit != null) po.page.drawText(row.debit, { x: cols.debit * width, y, size: 9, font });
      if (row.credit != null) po.page.drawText(row.credit, { x: cols.credit * width, y, size: 9, font });
      if (row.solde != null) po.page.drawText(row.solde, { x: cols.solde * width, y, size: 9, font });
    }
    po.y -= 18;
  }
  if (lines.totals) for (const t of lines.totals) {
    const po = pageObjs[t.page || 0];
    po.page.drawText(t.text, { x: (t.x ?? 0.18) * width, y: po.y, size: 9, font }); po.y -= 18;
  }
  return doc.save();
}

// Relevé nominal : colonnes nettes, débits et crédits, soldes ligne à ligne cohérents.
export function normalLines() {
  return {
    bank: 'BANQUE FICTIVE DU NORD', title: 'RELEVE DE COMPTE COURANT', iban: 'FR76 1234 5678 9012 3456 7890 123',
    rows: [
      { date: '01/10', label: 'SOLDE INITIAL', solde: '1000,00' },
      { date: '02/10', label: 'PRLV SEPA EDF ENERGIE', debit: '89,10', solde: '910,90' },
      { date: '03/10', label: 'CB SUPERMARCHE FICTIF', debit: '45,50', solde: '865,40' },
      { date: '04/10', label: 'VIR SALAIRE OCTOBRE M DUPONT', credit: '1500,00', solde: '2365,40' },
      { date: '05/10', label: 'PRLV SEPA SFR MOBILE', debit: '29,99', solde: '2335,41' },
      { date: '06/10', label: 'VIR CLIENT EXEMPLE FACTURE 7', credit: '700,00', solde: '3035,41' },
      { date: '07/10', label: 'RETRAIT DAB AGENCE FICTIVE', debit: '100,00', solde: '2935,41' }
    ],
    totals: [
      { text: 'TOTAL DES OPERATIONS débit 264,59 crédit 2200,00' },
      { text: 'NOUVEAU SOLDE 2935,41' }
    ]
  };
}

// Relevé difficile : ambiguïté de colonne, VRAI doublon (même date/libellé/montant),
// ligne incomplète, libellé multi-ligne. Colonnes à espacement normal sauf une ligne piégée.
export function hardLines() {
  return {
    bank: 'BANQUE FICTIVE DE L’OUEST', title: 'RELEVE DE COMPTE',
    cols: { date: 0.05, label: 0.18, debit: 0.60, credit: 0.74, solde: 0.90 },
    rows: [
      { date: '01/10', label: 'SOLDE INITIAL', solde: '500,00' },
      { date: '02/10', label: 'PRLV SEPA EDF ENERGIE', debit: '60,00', solde: '440,00' },
      { date: '02/10', label: 'PRLV SEPA EDF ENERGIE', debit: '60,00', solde: '380,00' }, // doublon strict du précédent
      // Montant placé à la frontière des colonnes débit (0,60) et crédit (0,74), frontière ~0,67
      { kind: 'cells', cells: [{ t: '04/10', x: 0.05 }, { t: 'VIR', x: 0.18 }, { t: 'RECU', x: 0.23 }, { t: 'AMBIGU', x: 0.28 }, { t: '9,99', x: 0.657 }, { t: '389,99', x: 0.90 }] },
      { date: '05/10', label: 'CB FOURNISSEUR ABC', debit: '120,00', solde: '269,99' },
      { kind: 'continuation', text: 'FACTURE N 2026-44 MONTANT NEGOCIE' }, // ligne de continuation rattachée au 05/10
      { date: '06/10', label: 'OPERATION SANS MONTANT' }, // ligne incomplète : aucun montant, rien ne doit être inventé
      { date: '07/10', label: 'VIR REMBOURSEMENT FRAIS M DUPONT', credit: '75,00', solde: '344,99' }
    ],
    totals: [{ text: 'NOUVEAU SOLDE 344,99' }]
  };
}

// Relevé multipage : en-têtes répétés, opérations sur les deux pages.
export function multipageLines() {
  return {
    bank: 'BANQUE FICTIVE DU SUD', title: 'RELEVE MULTIPAGE', pages: 2,
    rows: [
      { page: 0, date: '01/10', label: 'SOLDE INITIAL', solde: '2000,00' },
      { page: 0, kind: 'header' },
      { page: 0, date: '02/10', label: 'PRLV ASSURANCE FICTIVE', debit: '110,00', solde: '1890,00' },
      { page: 0, date: '03/10', label: 'CB BOULANGERIE FICTIVE', debit: '12,40', solde: '1877,60' },
      { page: 1, kind: 'header' },
      { page: 1, date: '04/10', label: 'VIR SALAIRE NOVEMBRE M DUPONT', credit: '1600,00', solde: '3477,60' },
      { page: 1, date: '05/10', label: 'PRLV LOYER LOCAL FICTIF', debit: '500,00', solde: '2977,60' }
    ],
    totals: [{ page: 1, text: 'NOUVEAU SOLDE 2977,60' }]
  };
}

// Format type BNP : libellé de solde 'SOLDE CREDITEUR AU <date> <montant>' identique en
// ouverture et clôture, dates JJ.MM, pas de colonne solde ligne à ligne, pied de page 'Page 1/4'.
// Arithmétique : 500,00 + 1500,00 (crédit) − 60,00 − 40,00 (débits) = 1900,00.
export function bnpLines() {
  return {
    bank: 'BANQUE NATIONALE FICTIVE', title: 'EXTRAIT DE COMPTE',
    headers: ['Date', 'Libellé', 'Débit', 'Crédit'], // format BNP : pas de colonne solde
    cols: { date: 0.05, label: 0.18, debit: 0.71, credit: 0.87, solde: 0.90 },
    rows: [
      { kind: 'raw', x: 0.05, text: 'SOLDE CREDITEUR AU 01.10.26 500,00' },
      { date: '02.10', label: 'PRLV SEPA EDF ENERGIE', debit: '60,00' },
      { date: '03.10', label: 'CB SUPERMARCHE FICTIF', debit: '40,00' },
      { date: '04.10', label: 'VIR SALAIRE OCTOBRE M DUPONT', credit: '1500,00' },
      { kind: 'raw', x: 0.86, text: 'Page 1/4' }, // piège : '1/4' ressemble à une date
      { kind: 'raw', x: 0.05, text: 'SOLDE CREDITEUR AU 31.10.26 1900,00' }
    ],
    totals: []
  };
}

// Variante BNP à glyphes fragmentés (observé sur des PDF réels) : 'SOLDE C REDITEUR AU'
// et pied de page 'Page 1 / 4'. Même arithmétique que bnpLines : 500 + 1500 − 100 = 1900.
export function bnpSpacedLines() {
  const base = bnpLines();
  base.bank = 'BANQUE NATIONALE FICTIVE (GLYPHES ESPACES)';
  base.rows = [
    { kind: 'raw', x: 0.05, text: 'SOLDE C REDITEUR AU 01.10.26 500,00' },
    { date: '02.10', label: 'PRLV SEPA EDF ENERGIE', debit: '60,00' },
    { date: '03.10', label: 'CB SUPERMARCHE FICTIF', debit: '40,00' },
    { date: '04.10', label: 'VIR SALAIRE OCTOBRE M DUPONT', credit: '1500,00' },
    { kind: 'raw', x: 0.86, text: 'Page 1 / 4' },
    { kind: 'raw', x: 0.05, text: 'SOLDE C REDITEUR AU 31.10.26 1900,00' }
  ];
  return base;
}
