// V2.24 — R11 : traçabilité de la page d'origine des opérations bancaires.
// Entièrement synthétique (textes et boîtes de mots fictifs, aucun relevé réel).
// Convention projet : pages numérotées depuis 0 ; null = origine explicitement inconnue.
//  A — texte 3 pages sans géométrie, marqueurs « — Page N — » → pages [0,1,1,2], aucune perte/doublon
//  B — chemin avec positions (non régressé) → [0,1,1]
//  C — document d'une page → 0 (deux formes : marqueur unique / une seule page physique)
//  D — origine indéterminable → null (jamais de fausse certitude, jamais 0 inventé)
//  E — intégrité comptable : tous les champs métier inchangés, snapshot exact
import { chromium, devices } from 'playwright';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = [];
const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const p = await b.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' }).then(c => c.newPage());
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(APP, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(1000);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const r = await p.evaluate(() => {
  const A = window.ScanPro.Acc;
  const W = (t, x, y) => ({ t, x, y, w: 0.06, h: 0.02, c: 90 });
  const head = () => [W('Date', 0.05, 0.05), W('Libellé', 0.18, 0.05), W('Débit', 0.6, 0.05), W('Crédit', 0.74, 0.05), W('Solde', 0.9, 0.05)];
  const out = {};

  // Cas A — 3 pages assemblées exactement comme docRunOcr, aucune boîte de mots
  const textA = [
    '— Page 1 —', 'Solde initial 1 000,00', '02/10 PRLV FICTIF UN 45,90 954,10',
    '— Page 2 —', '03/10 PRLV FICTIF DEUX 10,00 944,10', '04/10 VIR RECU FICTIF 100,00 1 044,10',
    '— Page 3 —', '05/10 CB FICTIF TROIS 12,40 1 031,70'
  ].join('\n');
  out.A = A.extractBank(textA, []).transactions;

  // Cas B — positions sur 2 pages (chemin historique, texte sans marqueur)
  const words = [
    [...head(), W('02/10', 0.05, 0.1), W('PRLV', 0.18, 0.1), W('45,90', 0.6, 0.1), W('954,10', 0.9, 0.1)],
    [...head(), W('03/10', 0.05, 0.1), W('PRLV', 0.18, 0.1), W('10,00', 0.6, 0.1), W('944,10', 0.9, 0.1),
      W('04/10', 0.05, 0.2), W('VIR', 0.18, 0.2), W('100,00', 0.74, 0.2), W('1 044,10', 0.9, 0.2)]
  ];
  const textB = ['Solde initial 1 000,00', '02/10 PRLV FICTIF UN 45,90 954,10', '03/10 PRLV FICTIF DEUX 10,00 944,10', '04/10 VIR RECU FICTIF 100,00 1 044,10'].join('\n');
  out.B = A.extractBank(textB, words).transactions;

  // Cas C — une page : une seule page physique avec géométrie, puis marqueur unique sans géométrie
  out.Cgeo = A.extractBank('02/10 PRLV FICTIF 45,90 954,10', [[W('02/10', 0.05, 0.1), W('PRLV', 0.18, 0.1), W('45,90', 0.6, 0.1), W('954,10', 0.9, 0.1)]]).transactions;
  out.Cmark = A.extractBank('— Page 1 —\n02/10 PRLV FICTIF 45,90 954,10', []).transactions;

  // Cas D — origine indéterminable : 2 pages physiques vides, puis aucune info de pagination
  out.Dempty = A.extractBank('02/10 PRLV SEPA EDF 45,90 1 100,00', [[], []]).transactions;
  out.Dnone = A.extractBank('02/10 PRLV SEPA EDF 45,90 1 100,00').transactions;
  // opération orpheline AVANT le premier marqueur : aucune origine démontrable → null
  out.Dorphan = A.extractBank('01/10 OP ORPHELINE 5,00 995,00\n— Page 1 —\n02/10 PRLV FICTIF 45,90 949,10', []).transactions;
  return out;
});

// ---------- Cas A ----------
const aPages = r.A.map(t => t.page);
check('A1 : 4 transactions extraites (1 + 2 + 1), aucune perte', r.A.length === 4, 'n=' + r.A.length);
check('A2 : pages d\'origine exactes [0,1,1,2] en base 0', JSON.stringify(aPages) === '[0,1,1,2]', JSON.stringify(aPages));
check('A3 : aucune transaction ne porte un numéro de page invalide', r.A.every(t => Number.isInteger(t.page) && t.page >= 0 && t.page <= 2), JSON.stringify(aPages));
const keys = r.A.map(t => `${t.date}|${t.label}|${t.debit ?? ''}|${t.credit ?? ''}`);
check('A4 : aucune transaction dupliquée (clés date+libellé+montants uniques)', new Set(keys).size === keys.length, JSON.stringify(keys));
check('A5 : les marqueurs « — Page N — » ne polluent aucun libellé', r.A.every(t => !/page/i.test(t.label)), JSON.stringify(r.A.map(t => t.label)));

// ---------- Cas B ----------
const bPages = r.B.map(t => t.page);
check('B1 : chemin avec positions non régressé → [0,1,1]', JSON.stringify(bPages) === '[0,1,1]', JSON.stringify(bPages));
check('B2 : les positions restent la source (3 opérations, source « positions OCR »)', r.B.length === 3 && r.B.every(t => /positions/.test(t.source)), r.B.map(t => t.source).join(' | '));

// ---------- Cas C ----------
check('C1 : une seule page physique → page 0 certaine', r.Cgeo.length === 1 && r.Cgeo[0].page === 0, JSON.stringify(r.Cgeo.map(t => t.page)));
check('C2 : marqueur unique « — Page 1 — » sans géométrie → page 0', r.Cmark.length === 1 && r.Cmark[0].page === 0, JSON.stringify(r.Cmark.map(t => t.page)));

// ---------- Cas D ----------
check('D1 : 2 pages physiques sans géométrie → origine inconnue explicite (null)', r.Dempty.length === 1 && r.Dempty[0].page === null, 'page=' + r.Dempty[0].page);
check('D2 : aucune information de pagination → null, jamais 0 inventé', r.Dnone.length === 1 && r.Dnone[0].page === null, 'page=' + r.Dnone[0].page);
check('D3 : opération orpheline avant premier marqueur → null, la suivante reste tracée (0)', r.Dorphan.length === 2 && r.Dorphan[0].page === null && r.Dorphan[1].page === 0, JSON.stringify(r.Dorphan.map(t => t.page)));

// ---------- Cas E : intégrité comptable, snapshot exact du Cas A ----------
const expected = [
  { date: '02/10', valueDate: null, label: 'PRLV FICTIF UN', reference: null, debit: 45.9, credit: null, balance: 954.1, page: 0, status: 'reconnu' },
  { date: '03/10', valueDate: null, label: 'PRLV FICTIF DEUX', reference: null, debit: 10, credit: null, balance: 944.1, page: 1, status: 'reconnu' },
  { date: '04/10', valueDate: null, label: 'VIR RECU FICTIF', reference: null, debit: null, credit: 100, balance: 1044.1, page: 1, status: 'reconnu' },
  { date: '05/10', valueDate: null, label: 'CB FICTIF TROIS', reference: null, debit: 12.4, credit: null, balance: 1031.7, page: 2, status: 'reconnu' }
];
const fields = ['date', 'valueDate', 'label', 'reference', 'debit', 'credit', 'balance', 'page', 'status'];
let integrity = r.A.length === expected.length;
const diffs = [];
r.A.forEach((t, i) => fields.forEach(f => { if (t[f] !== expected[i][f]) { integrity = false; diffs.push(`#${i}.${f}: ${JSON.stringify(t[f])} ≠ ${JSON.stringify(expected[i][f])}`); } }));
check('E1 : intégrité comptable intégrale (dates, libellés, réf., débit/crédit, soldes, statut, page)', integrity, diffs.join(' ; '));
const totalDebit = r.A.reduce((s, t) => s + (t.debit || 0), 0);
const totalCredit = r.A.reduce((s, t) => s + (t.credit || 0), 0);
check('E2 : totaux débiteurs/créditeurs exacts (68,30 débit / 100,00 crédit)', totalDebit === 68.3 && totalCredit === 100, `${totalDebit} / ${totalCredit}`);
const balanceChain = r.A.every((t, i) => i === 0 || Math.abs((r.A[i - 1].balance + (t.credit || 0) - (t.debit || 0)) - t.balance) < 1e-9);
check('E3 : chaîne des soldes cohérente (solde précédent + crédit − débit)', balanceChain, JSON.stringify(r.A.map(t => t.balance)));

check('Aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
console.log(`\n===== V2.24 R11 PAGES : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close();
process.exit(ko.length ? 1 : 0);
