// V2.16 (suite) : PDF synthétiques multipages (natif / scanné / mixte),
// propositions de comptes configurables + apprentissage, export comptable contrôlé.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const r = await p.evaluate(async () => {
  const A = window.ScanPro.Acc, P = window.ScanPro.Precompta; const out = {};
  // --- Propositions de comptes sur opérations types ---
  const stmt = `Banque : Test\nSolde initial 5 000,00
02/10 PRLV SEPA EDF ENERGIE 120,00 4 880,00
03/10 PRLV SFR MOBILE 29,99 4 850,01
04/10 PRLV URSSAF COTISATIONS 450,00 4 400,01
05/10 PRLV ALLIANZ ASSURANCE PRO 89,00 4 311,01
06/10 FRAIS TENUE DE COMPTE 12,50 4 298,51
07/10 LOYER LOCAL COMMERCIAL 900,00 3 398,51
08/10 OPERATION INCONNUE XYZ 33,00 3 365,51
09/10 VIR RECU REGLEMENT FACTURE CLIENT DURAND 1 500,00 4 865,51
Nouveau solde 4 865,51`;
  const data = A.extractBank(stmt);
  out.props = A.bankProposals(data).map(x => ({ label: x.label, counter: x.counterAccount, conf: x.confidence, issues: x.issues, entries: x.entries.length, bank: x.bankAccount, journal: x.journal }));
  // Règle apprise prioritaire
  P.learnFromLabel('PRLV SEPA EDF ENERGIE', '606300');
  out.learnedProp = A.bankProposals(data)[0];
  localStorage.removeItem(P.LEARNED_KEY);
  // Compte inactif signalé
  const chart = P.chart(); const a6061 = chart.find(a => a.num === '606100'); if (a6061) a6061.active = false; P.saveChart(chart);
  out.inactiveProp = A.bankProposals(data)[0];
  if (a6061) a6061.active = true; P.saveChart(chart);
  // Règle pointant un compte absent du plan
  P.saveBankRules([{ pattern: 'xyz inconnu', account: '999999', conf: 50, why: 'test' }]);
  out.missingProp = A.bankProposals(A.extractBank('08/10 OPERATION XYZ INCONNU 33,00 100,00'))[0];
  localStorage.removeItem(P.BANK_RULES_KEY); localStorage.removeItem(P.LEARNED_KEY);
  // --- Export comptable contrôlé ---
  const ex = A.bankEntriesCsv(data, { name: 'test' });
  out.ex = { balanced: ex.balanced, rows: ex.csv.split('\n').length, problems: ex.problems, firstRows: ex.csv.split('\n').slice(1, 3) };
  const dupEx = A.bankEntriesCsv(A.extractBank('02/10 PRLV SEPA EDF 45,90 954,10\n02/10 PRLV SEPA EDF 45,90 954,10'));
  out.dupProblems = dupEx.problems;
  // --- PDF natif multipage synthétique (texte positionné par jsPDF) ---
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const lines1 = ['Releve de compte', 'Solde initial 1 000,00', '02/10 PRLV SEPA EDF 45,90 954,10', '03/10 VIR RECU SALAIRE 2 000,00 2 954,10', 'Nouveau solde 2 954,10'];
  lines1.forEach((l, i) => doc.text(l, 40, 60 + i * 22));
  doc.addPage();
  const lines2 = ['Releve de compte (suite)', '04/10 CB BOULANGERIE 12,40 2 941,70', '05/10 FRAIS BANCAIRES 5,00 2 936,70', 'Nouveau solde 2 936,70'];
  lines2.forEach((l, i) => doc.text(l, 40, 60 + i * 22));
  const natPages = await window.ScanPro.PDF.extractText(doc.output('arraybuffer'));
  const natData = A.extractBank(natPages.map(x => x.text).join('\n'), natPages.map(x => x.words));
  out.nativePdf = { pages: natPages.length, words: natPages.map(x => x.words.length), tx: natData.transactions.length, sumD: natData.totals.debit, sumC: natData.totals.credit };
  // --- PDF mixte : page 1 native, page 2 image seule ---
  const doc2 = new jsPDF({ unit: 'pt', format: 'a4' });
  doc2.text('Page native avec du texte releve bancaire 02/10 PRLV EDF 45,90', 40, 60);
  doc2.addPage();
  const cv = document.createElement('canvas'); cv.width = 800; cv.height = 400; const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, 800, 400); cx.fillStyle = '#000'; cx.font = '28px sans-serif';
  cx.fillText('03/10 CB BOULANGERIE 12,40', 30, 80); cx.fillText('04/10 VIR SALAIRE 2 000,00', 30, 140);
  doc2.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, 595, 298);
  const mixPages = await window.ScanPro.PDF.extractText(doc2.output('arraybuffer'));
  out.mixedPdf = { pages: mixPages.length, nativeChars: mixPages.map(x => x.text.replace(/\s/g, '').length) };
  // --- PDF scanné : rendu + vrai OCR Tesseract sur l'image ---
  try {
    const rendered = await window.ScanPro.PDF.renderPages(new File([doc2.output('blob')], 'mixte.pdf', { type: 'application/pdf' }), { maxPx: 1600 });
    const imgPage = rendered[1];
    const ocr = await Tesseract.recognize(imgPage.canvas, 'fra');
    const words = (ocr.data.words || []).filter(w => (w.text || '').trim() && w.bbox).map(w => ({ t: w.text, c: Math.round(w.confidence || 0), x: +(w.bbox.x0 / imgPage.canvas.width).toFixed(4), y: +(w.bbox.y0 / imgPage.canvas.height).toFixed(4), w: +((w.bbox.x1 - w.bbox.x0) / imgPage.canvas.width).toFixed(4), h: +((w.bbox.y1 - w.bbox.y0) / imgPage.canvas.height).toFixed(4) }));
    const scanData = A.extractBank(ocr.data.text, [words]);
    out.scanned = { textStart: ocr.data.text.slice(0, 60), tx: scanData.transactions.length, labels: scanData.transactions.map(t => t.label), amounts: scanData.transactions.map(t => t.debit ?? t.credit) };
  } catch (e) { out.scanned = { error: String(e && e.message).slice(0, 120) }; }
  return out;
});
const byLabel = (frag) => r.props.find(x => x.label.includes(frag));
check('Proposition électricité -> 606100 (règle configurable, confiance + justification)', byLabel('EDF')?.counter === '606100' && byLabel('EDF').conf >= 80, JSON.stringify(byLabel('EDF')));
check('Proposition télécom -> 626000', byLabel('SFR')?.counter === '626000', JSON.stringify(byLabel('SFR')?.counter));
check('Proposition cotisations URSSAF -> 645000', byLabel('URSSAF')?.counter === '645000', JSON.stringify(byLabel('URSSAF')?.counter));
check('Proposition assurance -> 616000, frais bancaires -> 627000, loyer -> 613000', byLabel('ALLIANZ')?.counter === '616000' && byLabel('FRAIS')?.counter === '627000' && byLabel('LOYER')?.counter === '613000');
check('Opération inconnue : compte EN ATTENTE (jamais inventé), signalée', byLabel('INCONNUE')?.counter === null && byLabel('INCONNUE').issues.length >= 1, JSON.stringify(byLabel('INCONNUE')));
check('Journal BQ et compte banque 512000 (jamais l’IBAN)', r.props.every(x => x.journal === 'BQ' && x.bank === '512000'));
check('Apprentissage : correction validée réutilisée (606300 appris)', r.learnedProp.counterAccount === '606300' && r.learnedProp.learned === true, JSON.stringify(r.learnedProp.counterAccount));
check('Compte inactif du plan : signalé dans les points à vérifier', r.inactiveProp.issues.some(i => /inactif/.test(i)), JSON.stringify(r.inactiveProp.issues));
check('Compte absent du plan : signalé, pas d’écriture générée', r.missingProp.issues.some(i => /absent du plan/.test(i)), JSON.stringify(r.missingProp.issues));
check('Export écritures : équilibré et 2 lignes par opération affectée', r.ex.balanced && r.ex.rows === 1 + r.props.filter(x => x.entries === 2).length * 2, 'rows=' + r.ex.rows);
check('Export : l’opération inconnue est listée dans les problèmes (pas d’écriture silencieuse)', r.ex.problems.some(x => /INCONNUE/.test(x)), JSON.stringify(r.ex.problems).slice(0, 160));
check('Export : doublons détectés avant export', r.dupProblems.some(x => /Doublon/.test(x)), JSON.stringify(r.dupProblems));
check('PDF natif synthétique multipage : 2 pages, 4 opérations, totaux exacts', r.nativePdf.pages === 2 && r.nativePdf.tx === 4 && Math.abs(r.nativePdf.sumD - 63.3) < 0.01 && Math.abs(r.nativePdf.sumC - 2000) < 0.01, JSON.stringify(r.nativePdf));
check('PDF mixte : page native lue, page image détectée sans texte (OCR requis)', r.mixedPdf.pages === 2 && r.mixedPdf.nativeChars[0] > 20 && r.mixedPdf.nativeChars[1] === 0, JSON.stringify(r.mixedPdf));
check('PDF scanné : OCR réel sur page image -> opérations retrouvées (≥1, libellés lus)', !r.scanned.error && r.scanned.tx >= 1 && /BOULANGERIE|SALAIRE/.test(r.scanned.labels.join(' ')), JSON.stringify(r.scanned).slice(0, 220));
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.16 SYNTHÉTIQUES + PROPOSITIONS : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
