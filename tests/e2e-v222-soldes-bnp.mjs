// V2.22 — Audit approfondi de la reconnaissance des soldes type BNP ('SOLDE CREDITEUR/DEBITEUR AU').
// 100 % synthétique : aucun relevé réel. Chaque assertion est une vérification forte de valeur,
// y compris les tests NÉGATIFS : une structure ambiguë doit rester 'Non reconnu', jamais inventée.
import { chromium, devices } from 'playwright';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = [];
const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const NR = 'Non reconnu';
const b = await chromium.launch();
const p = await b.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' }).then(c => c.newPage());
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(APP, { waitUntil: 'load' });
await p.waitForTimeout(1000);
await p.locator('.sheet .btn.primary').click().catch(() => {});

// Extraction d'un bloc de lignes 100 % fictif via le moteur réel (chemin texte, pas de positions).
const run = (lines) => p.evaluate((lines) => {
  const d = window.ScanPro.Acc.extractBank(lines.join('\n'), []);
  return { open: d.fields.openingBalance.value, close: d.fields.closingBalance.value, tx: d.transactions.length };
}, lines);

// ── Cas positifs : le montant exact doit être reconnu ──
let r = await run(['SOLDE CREDITEUR AU 01.10.26 500,00', '02.10 PRLV FICTIF 30,00', 'SOLDE CREDITEUR AU 31.10.26 470,00']);
check('S1 créditeur positif simple (ouverture 500 / clôture 470)', r.open === '500' && r.close === '470', JSON.stringify(r));
r = await run(['SOLDE DEBITEUR AU 01.10.26 250,00', '02.10 PRLV FICTIF 30,00', 'SOLDE DEBITEUR AU 31.10.26 280,00']);
check('S2 débiteur négatif des deux côtés (-250 / -280)', r.open === '-250' && r.close === '-280', JSON.stringify(r));
r = await run(['SOLDE CREDITEUR AU 01.10.26 3 388,42']);
check('S3 milliers groupés "3 388,42" → 3388,42', r.open === '3388.42', r.open);
r = await run(['SOLDE CREDITEUR AU 22.04.2024 3 3 88,42']);
check('S4 milliers fragmentés par le PDF "3 3 88,42" → 3388,42', r.open === '3388.42', r.open);
r = await run(['SOLDE C REDITEUR AU 22.04.2024 3 3 88,42']);
check('S5 libellé à glyphes espacés "SOLDE C REDITEUR AU" reconnu', r.open === '3388.42', r.open);
r = await run(['SOLDE D EBITEUR AU 01.10.26 250,00']);
check('S6 débiteur à glyphes espacés → -250', r.open === '-250', r.open);
r = await run(['SOLDE CREDITEUR AU 01/10/2026 500,00']);
check('S7 date avec séparateurs slash', r.open === '500', r.open);
r = await run(['SOLDE CREDITEUR AU 2026-10-01 500,00']);
check('S8 date ISO avec tirets neutralisée, montant conservé', r.open === '500', r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 500,00 EUR']);
check('S9 devise EUR terminale acceptée', r.open === '500', r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 500,00 €']);
check('S10 symbole € terminal accepté', r.open === '500', r.open);
r = await run(['SOLDE DEBITEUR AU 01.10.26 -250,00']);
check('S11 montant explicitement signé négatif', r.open === '-250', r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 12 345 678,90']);
check('S12 groupement canonique long (12 345 678,90)', r.open === '12345678.9', r.open);
r = await run([
  'SOLDE CREDITEUR AU 01.10.26 500,00',
  'SOLDE CREDITEUR AU 15.10.26 600,00',
  'SOLDE CREDITEUR AU 31.10.26 700,00'
]);
check('S13 occurrences intermédiaires : 1re = ouverture, dernière = clôture', r.open === '500' && r.close === '700', JSON.stringify(r));

// ── Cas négatifs : aucune valeur ne doit être inventée ──
r = await run(['SOLDE CREDITEUR AU 01.10.26', '02.10 PRLV FICTIF 30,00']);
check('N1 montant absent : NON reconnu, jamais pris sur la ligne voisine (30,00)', r.open === NR && r.tx === 1, JSON.stringify(r));
r = await run(['SOLDE CREDITEUR AU 01.10.26 120,00 500,00']);
check('N2 deux montants décimaux sur la ligne : ambigu → Non reconnu', r.open === NR, r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 CPTE 4567 500,00']);
check('N3 texte alphabétique mêlé aux chiffres (référence) : Non reconnu (pas 4 567 500)', r.open === NR, r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 REF 48889252 500,00']);
check('N4 longue référence + montant : Non reconnu (pas 48 889 252 500)', r.open === NR, r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 500']);
check('N5 entier sans décimale : Non reconnu (les soldes FR ont 2 décimales)', r.open === NR, r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 123 4 500,00']);
check('N6 groupement de milliers inversé/non canonique : Non reconnu', r.open === NR, r.open);
r = await run(['SOLDE CREDITEUR AU 01.10.26 500,00 BLOQUE']);
check('N7 mot après le montant (solde bloqué) : Non reconnu, à vérifier', r.open === NR, r.open);
r = await run(['SOLDE CREDITEUR 01.10.26 500,00']);
check('N8 libellé sans le mot-clé "AU" : non traité par le chemin BNP', r.open === NR, r.open);
r = await run(['SOLDE DEBITEUR AU 01.10.26 (250,00)']);
check('N9 solde entre parenthèses : non interprété par le chemin BNP (limite conservatrice)', r.open === NR, r.open);

// ── Garde-fou global : une ligne de solde BNP ne devient jamais une opération ──
r = await run(['SOLDE CREDITEUR AU 01.10.26 500,00', '02.10 PRLV FICTIF 30,00', 'SOLDE CREDITEUR AU 31.10.26 470,00', 'Page 1/4']);
check('N10 ni les lignes de solde ni le pied de page "Page 1/4" ne créent de transaction (1 seule op.)', r.tx === 1, String(r.tx));

check('Aucune erreur JavaScript pendant la campagne', errs.length === 0, errs.join(' | '));
console.log(`\n===== V2.22 SOLDES BNP : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close();
process.exit(ko.length ? 1 : 0);
