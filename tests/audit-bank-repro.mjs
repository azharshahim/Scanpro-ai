// AUDIT relevés bancaires (V2.15) — tests de REPRODUCTION des défauts.
// Chaque check RÉUSSIT quand le défaut suspecté est bien reproduit sur le code actuel.
// Ces tests documentent l'état avant correction ; ils devront être adaptés après le fix.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html'; const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const repro = [], clean = [];
const check = (id, label, bugPresent, detail = '') => { (bugPresent ? repro : clean).push(id); console.log((bugPresent ? '🐛 REPRODUIT ' : '✔ non reproduit ') + id + ' ' + label + (detail ? ' — ' + detail : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR' });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const r = await p.evaluate(() => {
  const A = window.ScanPro.Acc; const out = {};
  // R1 : libellé sur 2 lignes (texte) — la suite du libellé est-elle conservée ?
  out.r1 = A.extractBank('Relevé de compte\n02/10 CB SUPERMARCHÉ\nCARTE 1234 PARIS CENTRE 45,90 954,10\nSolde initial 1 000,00\nNouveau solde 954,10').transactions;
  // R2 : montant avec espace fine insécable (U+202F) comme séparateur de milliers
  out.r2 = A.extractBank('02/10 VIR RECU SALAIRE 1\u202f234,56 2\u202f234,56').transactions;
  // R3 : sens déterminé uniquement par mots-clés (libellé neutre, colonne Montant signée absente)
  out.r3 = A.extractBank('02/10 DEPOT ESPECES 200,00 1 200,00\n03/10 OPERATION DIVERSE 50,00 1 150,00').transactions;
  // R4 : montant = avant-dernier nombre : ligne sans solde mais avec un montant dans le libellé
  out.r4 = A.extractBank('02/10 REMBOURSEMENT FORFAIT 12,50 SUR 45,90\n03/10 PRLV SEPA EDF 45,90 1 100,00').transactions;
  // R5 : positions — en-tête répété page 2 : les opérations de la page 1 survivent-elles ?
  const W = (t, x, y, w = 0.06) => ({ t, x, y, w, h: 0.02, c: 90 });
  const header = [W('Date', 0.02, 0.05), W('Libellé', 0.15, 0.05), W('Débit', 0.58, 0.05), W('Crédit', 0.74, 0.05), W('Solde', 0.90, 0.05)];
  const row = (d, lab, amt, x, y) => [W(d, 0.02, y), ...lab.split(' ').map((w, i) => W(w, 0.15 + i * 0.08, y)), W(amt, x, y, 0.08)];
  out.r5 = A.bankFromPositions([[...header, ...row('02/10', 'VIR SALAIRE', '1 500,00', 0.72, 0.10)], [...header, ...row('03/10', 'PRLV EDF', '45,90', 0.56, 0.10)]]);
  // R6 : positions remplacent TOUT le texte même si elles trouvent moins d'opérations
  const txt6 = '01/10 VIR RECU A 100,00 100,00\n02/10 VIR RECU B 100,00 200,00\n03/10 VIR RECU C 100,00 300,00\n04/10 VIR RECU D 100,00 400,00\n05/10 VIR RECU E 100,00 500,00';
  out.r6 = A.extractBank(txt6, [[...header, ...row('02/10', 'VIR SALAIRE', '1 500,00', 0.72, 0.10)]]).transactions;
  // R7 : positions — libellé multi-ligne (suite sans date) fusionné ou perdu ?
  out.r7 = A.bankFromPositions([[...header, ...row('02/10', 'CB SUPERMARCHÉ', '45,90', 0.56, 0.10), W('CARTE', 0.15, 0.13), W('1234', 0.22, 0.13), W('PARIS', 0.29, 0.13)]]);
  // R8 : positions — date pas en première cellule (colonne Référence avant la date)
  out.r8 = A.bankFromPositions([[...header, W('REF998', 0.02, 0.10), W('02/10', 0.10, 0.10), W('VIR', 0.20, 0.10), W('SALAIRE', 0.27, 0.10), W('1 500,00', 0.72, 0.10, 0.08)]]);
  // R9 : positions — colonnes Débit/Crédit proches : petit montant crédit centré entre les ancres
  const header9 = [W('Date', 0.02, 0.05), W('Libellé', 0.15, 0.05), W('Débit', 0.60, 0.05, 0.05), W('Crédit', 0.72, 0.05, 0.05), W('Solde', 0.90, 0.05)];
  out.r9 = A.bankFromPositions([[...header9, W('02/10', 0.02, 0.10), W('VIR', 0.15, 0.10), W('RECU', 0.22, 0.10), W('9,99', 0.645, 0.10, 0.05)]]);
  // R10 : CSV — les doublons détectés sont-ils signalés dans l'export ?
  const dup = A.extractBank('02/10 PRLV SEPA EDF 45,90 1 100,00\n02/10 PRLV SEPA EDF 45,90 1 100,00');
  out.r10 = { n: dup.transactions.length, dupFlag: dup.transactions.map(t => !!t.duplicate), csv: A.toBankCsv(dup) };
  // R11 : texte multi-pages — la page d'origine des opérations texte
  out.r11 = A.extractBank('02/10 PRLV SEPA EDF 45,90 1 100,00', [[], []]).transactions;
  // R13 : ligne contenant « SOLDE » dans le libellé : filtrée comme une ligne de total ?
  out.r13 = A.extractBank('02/10 SOLDE INTERETS CREDITEURS 25,00 1 025,00').transactions;
  // R14 : positions — pas d'en-tête « Solde » mais une colonne solde imprimée : où va le dernier montant ?
  const header14 = [W('Date', 0.02, 0.05), W('Libellé', 0.15, 0.05), W('Débit', 0.58, 0.05), W('Crédit', 0.74, 0.05)];
  out.r14 = A.bankFromPositions([[...header14, W('02/10', 0.02, 0.10), W('VIR', 0.15, 0.10), W('SALAIRE', 0.22, 0.10), W('100,00', 0.72, 0.10, 0.07), W('1 100,00', 0.90, 0.10, 0.07)]]);
  // R12 : format colonne unique « Montant » signé SANS solde ligne à ligne
  out.r12 = A.extractBank('02/10 CB BOULANGERIE -12,40\n03/10 VIR SALAIRE +2 100,00').transactions;
  return out;
});
check('R1', 'Libellé multi-ligne (texte) : opération ENTIÈREMENT perdue (montant sur la ligne de suite, sans date)', r.r1.length === 0, JSON.stringify(r.r1.map(t => t.label)));
check('R2', 'Espace fine U+202F : montant tronqué (1 234,56 -> 234,56)', r.r2.length === 1 && r.r2[0].credit === 234.56, JSON.stringify(r.r2.map(t => [t.credit, t.balance])));
check('R3', 'Sens par mots-clés : libellés neutres non classés (a-verifier)', r.r3.length === 2 && r.r3.every(t => t.status === 'a-verifier' && t.debit == null && t.credit == null), JSON.stringify(r.r3.map(t => t.status)));
check('R4', 'Avant-dernier nombre = montant : le montant DANS le libellé (12,50) est pris, le vrai (45,90) devient « solde »', r.r4.length >= 1 && r.r4[0].credit === 12.5 && r.r4[0].balance === 45.9, JSON.stringify(r.r4[0]));
check('R5', 'Positions multi-pages : en-tête répété -> opérations page 1 ignorées', Array.isArray(r.r5) && r.r5.length === 1 && /EDF/.test(r.r5[0].label), JSON.stringify((r.r5 || []).map(t => t.label)));
check('R6', 'Positions (1 op.) REMPLACENT le texte (5 ops) : perte nette', r.r6.length === 1, 'texte=5 positions=1 -> final=' + r.r6.length);
check('R7', 'Positions : ligne de continuation (sans date) écartée du libellé', Array.isArray(r.r7) && r.r7.length === 1 && !/PARIS/.test(r.r7[0].label), JSON.stringify((r.r7 || []).map(t => t.label)));
check('R8', 'Positions : date non en 1re cellule -> opération entièrement ignorée', !r.r8 || r.r8.length === 0, JSON.stringify(r.r8));
check('R9', 'Positions : montant crédit entre deux ancres proches -> affecté au débit', Array.isArray(r.r9) && r.r9.length === 1 && r.r9[0].debit === 9.99, JSON.stringify(r.r9));
check('R10', 'Doublon détecté en interne mais NON signalé dans le CSV', r.r10.dupFlag[1] === true && !/Doublon|À vérifier.*oui/i.test(r.r10.csv.split('\n')[2] || ''), JSON.stringify(r.r10.dupFlag));
check('R11', 'Texte : page d’origine toujours 0 (multi-pages non tracé)', r.r11.length === 1 && r.r11[0].page === 0, 'page=' + (r.r11[0] && r.r11[0].page));
check('R12', 'Colonne Montant signée sans solde : gérée ou non', !(r.r12.length === 2 && r.r12[0].debit === 12.4 && r.r12[1].credit === 2100), JSON.stringify(r.r12.map(t => [t.debit, t.credit, t.status])));
check('R13', 'Libellé contenant « SOLDE » : opération filtrée comme un total', r.r13.length === 0, JSON.stringify(r.r13));
check('R14', 'Positions sans en-tête Solde : le solde (1 100) écrase le crédit (100)', Array.isArray(r.r14) && r.r14.length === 1 && r.r14[0].credit === 1100, JSON.stringify(r.r14));
console.log('Erreurs page :', errs.length, errs.slice(0, 2).join('|'));
console.log(`\n===== AUDIT RELEVÉS : ${repro.length} défaut(s) reproduit(s) / ${clean.length} hypothèse(s) non confirmée(s) =====`);
await b.close();
