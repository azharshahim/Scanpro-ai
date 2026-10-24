// V2.15.1 (audit relevés) : les 14 reproductions deviennent des non-régressions.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html'; const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const r = await p.evaluate(async () => {
  const A = window.ScanPro.Acc; const out = {};
  out.r1 = A.extractBank('Relevé de compte\n02/10 CB SUPERMARCHÉ\nCARTE 1234 PARIS CENTRE 45,90 954,10\nSolde initial 1 000,00\nNouveau solde 954,10').transactions;
  out.r2 = A.extractBank('02/10 VIR RECU SALAIRE 1\u202f234,56 2\u202f234,56').transactions;
  out.r3 = A.extractBank('02/10 DEPOT ESPECES 200,00 1 200,00\n03/10 OPERATION DIVERSE 50,00 1 150,00').transactions;
  out.r4 = A.extractBank('02/10 REMBOURSEMENT FORFAIT 12,50 SUR 45,90\n03/10 PRLV SEPA EDF 45,90 1 100,00').transactions;
  const W = (t, x, y, w = 0.06) => ({ t, x, y, w, h: 0.02, c: 90 });
  const header = [W('Date', 0.02, 0.05), W('Libellé', 0.15, 0.05), W('Débit', 0.58, 0.05), W('Crédit', 0.74, 0.05), W('Solde', 0.90, 0.05)];
  const row = (d, lab, amt, x, y) => [W(d, 0.02, y), ...lab.split(' ').map((w, i) => W(w, 0.15 + i * 0.08, y)), W(amt, x, y, 0.08)];
  out.r5 = A.bankFromPositions([[...header, ...row('02/10', 'VIR SALAIRE', '1 500,00', 0.72, 0.10)], [...header, ...row('03/10', 'PRLV EDF', '45,90', 0.56, 0.10)]]);
  const txt6 = '01/10 VIR RECU A 100,00 100,00\n02/10 VIR RECU B 100,00 200,00\n03/10 VIR RECU C 100,00 300,00\n04/10 VIR RECU D 100,00 400,00\n05/10 VIR RECU E 100,00 500,00';
  out.r6 = A.extractBank(txt6, [[...header, ...row('02/10', 'VIR SALAIRE', '1 500,00', 0.72, 0.10)]]).transactions;
  out.r7 = A.bankFromPositions([[...header, ...row('02/10', 'CB SUPERMARCHÉ', '45,90', 0.56, 0.10), W('CARTE', 0.15, 0.13), W('1234', 0.22, 0.13), W('PARIS', 0.29, 0.13)]]);
  out.r8 = A.bankFromPositions([[...header, W('REF998', 0.02, 0.10), W('02/10', 0.10, 0.10), W('VIR', 0.20, 0.10), W('SALAIRE', 0.27, 0.10), W('1 500,00', 0.72, 0.10, 0.08)]]);
  const header9 = [W('Date', 0.02, 0.05), W('Libellé', 0.15, 0.05), W('Débit', 0.60, 0.05, 0.05), W('Crédit', 0.72, 0.05, 0.05), W('Solde', 0.90, 0.05)];
  out.r9 = A.bankFromPositions([[...header9, W('02/10', 0.02, 0.10), W('VIR', 0.15, 0.10), W('RECU', 0.22, 0.10), W('9,99', 0.645, 0.10, 0.05)]]);
  const dup = A.extractBank('02/10 PRLV SEPA EDF 45,90 1 100,00\n02/10 PRLV SEPA EDF 45,90 1 100,00');
  out.r10 = { n: dup.transactions.length, csv: A.toBankCsv(dup) };
  out.r11 = A.extractBank('02/10 PRLV SEPA EDF 45,90 1 100,00', [[{ t: 'EDF', x: 0.2, y: 0.1, w: 0.05, h: 0.02, c: 90 }]]).transactions;
  out.r12 = A.extractBank('02/10 CB BOULANGERIE -12,40\n03/10 VIR SALAIRE +2 100,00').transactions;
  out.r13 = A.extractBank('02/10 SOLDE INTERETS CREDITEURS 25,00 1 025,00').transactions;
  const header14 = [W('Date', 0.02, 0.05), W('Libellé', 0.15, 0.05), W('Débit', 0.58, 0.05), W('Crédit', 0.74, 0.05)];
  out.r14 = A.bankFromPositions([[...header14, W('02/10', 0.02, 0.10), W('VIR', 0.15, 0.10), W('SALAIRE', 0.22, 0.10), W('100,00', 0.72, 0.10, 0.07), W('1 100,00', 0.90, 0.10, 0.07)]]);
  // Cohérence des soldes : enchaînement juste vs rupture volontaire
  const good = A.extractBank('Solde initial 1 000,00\n02/10 PRLV SEPA EDF 100,00 900,00\n03/10 VIR RECU SALAIRE 500,00 1 400,00\nNouveau solde 1 400,00');
  const bad = A.extractBank('Solde initial 1 000,00\n02/10 PRLV SEPA EDF 100,00 900,00\n03/10 VIR RECU SALAIRE 500,00 1 999,00\nNouveau solde 1 400,00');
  out.soldes = { good: good.controls.find(c => /ligne à ligne/.test(c.label)), bad: bad.controls.find(c => /ligne à ligne/.test(c.label)) };
  // PDF natif : génération d'un vrai PDF texte via jsPDF, lecture sans OCR
  try {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.text('Releve de compte - VIR SALAIRE 1500,00 euros - PRLV EDF 45,90 euros', 10, 20);
    const buf = doc.output('arraybuffer');
    const pages = await window.ScanPro.PDF.extractText(buf);
    out.pdf = pages && pages[0] ? { text: pages[0].text, words: pages[0].words.length } : null;
  } catch (e) { out.pdf = { error: String(e && e.message) }; }
  return out;
});
check('R1 corrigé : libellé multi-ligne -> opération conservée avec libellé complet', r.r1.length === 1 && /PARIS/.test(r.r1[0].label) && r.r1[0].debit === 45.9, JSON.stringify(r.r1));
check('R2 corrigé : espace fine U+202F -> montant exact 1234,56', r.r2.length === 1 && r.r2[0].credit === 1234.56, JSON.stringify(r.r2.map(t => t.credit)));
check('R3 corrigé : DEPOT ESPECES classé crédit ; libellé inconnu toujours « à vérifier » (jamais deviné)', r.r3.length === 2 && r.r3[0].credit === 200 && r.r3[1].status === 'a-verifier', JSON.stringify(r.r3.map(t => [t.credit, t.status])));
check('R4 corrigé : le montant du libellé reste dans le libellé, vrai montant 45,90', r.r4.length >= 1 && r.r4[0].credit === 45.9 && r.r4[0].balance == null && /12,50/.test(r.r4[0].label), JSON.stringify(r.r4[0]));
check('R5 corrigé : en-tête répété -> opérations des 2 pages conservées', Array.isArray(r.r5) && r.r5.length === 2, JSON.stringify((r.r5 || []).map(t => t.label)));
check('R6 corrigé : fusion texte+positions sans perte (≥ 5 opérations)', r.r6.length >= 5, 'final=' + r.r6.length);
check('R7 corrigé : continuation rattachée au libellé (positions)', Array.isArray(r.r7) && r.r7.length === 1 && /PARIS/.test(r.r7[0].label) && r.r7[0].balance == null, JSON.stringify(r.r7));
check('R8 corrigé : colonne Référence avant la date -> opération lue, référence conservée', Array.isArray(r.r8) && r.r8.length === 1 && r.r8[0].credit === 1500 && /REF998/.test(r.r8[0].reference || ''), JSON.stringify(r.r8));
check('R9 corrigé : montant entre deux colonnes -> jamais affirmé au débit, signalé à vérifier', Array.isArray(r.r9) && r.r9.length === 1 && r.r9[0].status === 'a-verifier', JSON.stringify(r.r9));
check('R10 corrigé : doublon signalé dans le CSV exporté', /doublon \?/.test(r.r10.csv), r.r10.csv.split('\n')[2] || '');
check('R11 corrigé : page d’origine retrouvée via les positions des mots', r.r11.length === 1 && r.r11[0].page === 0 && r.r11[0].label.length > 0, JSON.stringify(r.r11[0]));
check('R12 conservé : colonne Montant signée sans solde toujours gérée', r.r12.length === 2 && r.r12[0].debit === 12.4 && r.r12[1].credit === 2100, JSON.stringify(r.r12.map(t => [t.debit, t.credit])));
check('R13 corrigé : « SOLDE INTERETS » n’est plus filtré comme un total', r.r13.length === 1 && r.r13[0].credit === 25, JSON.stringify(r.r13));
check('R14 corrigé : sans en-tête Solde, le solde ne remplace plus le crédit (100 ≠ 1100)', Array.isArray(r.r14) && r.r14.length === 1 && r.r14[0].credit === 100 && r.r14[0].balance === 1100, JSON.stringify(r.r14));
check('Soldes ligne à ligne : enchaînement cohérent -> contrôle Conforme (comparaison réelle)', !!r.soldes.good && r.soldes.good.ok === true && r.soldes.good.status === 'conforme', JSON.stringify(r.soldes.good));
check('Soldes ligne à ligne : rupture volontaire -> Écart détecté', !!r.soldes.bad && r.soldes.bad.ok === false, JSON.stringify(r.soldes.bad));
check('P3 : couche texte native d’un PDF numérique lue sans OCR (mots + positions)', !!r.pdf && /VIR SALAIRE/.test(r.pdf.text || '') && r.pdf.words > 5, JSON.stringify(r.pdf).slice(0, 160));
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.15.1 RELEVÉS BANCAIRES : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
