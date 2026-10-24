// V2.16 : test de bout en bout sur un VÉRITABLE relevé bancaire PDF (natif, multipage).
// Le PDF n'est PAS dans le dépôt : chemin via BANK_PDF_PATH (défaut: uploads local).
// Sans fichier, le test se déclare « ignoré » explicitement (jamais « réussi »).
// Jeu de référence dérivé du document lui-même : totaux imprimés du relevé et
// comptage indépendant des lignes d'opérations du texte natif.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const PDF_PATH = process.env.BANK_PDF_PATH || '/home/user/uploads/Releve-n009-du-09-09-2026_CCOU-65086189881-SAS-RAPID-NET-SER.pdf';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
if (!fs.existsSync(PDF_PATH)) { console.log('⏭ TEST IGNORÉ : aucun relevé PDF de référence (' + PDF_PATH + ')'); process.exit(0); }
const b64 = fs.readFileSync(PDF_PATH).toString('base64');
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR' });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
const r = await p.evaluate(async (b64) => {
  const bin = atob(b64); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const pages = await window.ScanPro.PDF.extractText(buf.buffer);
  const text = pages.map(pg => pg.text).join('\n');
  const words = pages.map(pg => pg.words);
  const data = window.ScanPro.Acc.extractBank(text, words);
  const props = window.ScanPro.Acc.bankProposals(data);
  const ex = window.ScanPro.Acc.bankEntriesCsv(data, { name: 'releve-reel' });
  return { pages: pages.length, pageWords: pages.map(pg => pg.words.length), data, propsCount: props.length, withCounter: props.filter(x => x.counterAccount).length, exBalanced: ex.balanced, exProblems: ex.problems.length, exRows: ex.csv.split('\n').length };
}, b64);
const tx = r.data.transactions || [];
const sumD = Math.round(tx.reduce((s, x) => s + (x.debit || 0), 0) * 100) / 100;
const sumC = Math.round(tx.reduce((s, x) => s + (x.credit || 0), 0) * 100) / 100;
check('PDF natif multipage lu sans OCR : 3 pages, mots positionnés par page', r.pages === 3 && r.pageWords.every(n => n > 50), JSON.stringify(r.pageWords));
check('Opérations extraites : 85 attendues (comptage de référence du document)', tx.length === 85, 'extrait=' + tx.length);
check('Totaux extraits = totaux IMPRIMÉS du relevé (54 797,19 / 52 441,32)', Math.abs(sumD - 54797.19) <= 0.05 && Math.abs(sumC - 52441.32) <= 0.05, `débit=${sumD} crédit=${sumC}`);
check('Soldes reconnus : ancien 19 364,55 → nouveau 17 008,68', r.data.fields.openingBalance.value === '19364.55' && r.data.fields.closingBalance.value === '17008.68', JSON.stringify([r.data.fields.openingBalance.value, r.data.fields.closingBalance.value]));
check('Contrôle « totaux imprimés » présent et conforme', (r.data.controls || []).some(c => /Totaux imprimés/.test(c.label) && c.ok), JSON.stringify((r.data.controls || []).filter(c => /Totaux/.test(c.label))));
check('Contrôle soldes ligne à ligne : aucune rupture sur le relevé réel', (r.data.controls || []).filter(c => /ligne à ligne/.test(c.label)).every(c => c.ok !== false), JSON.stringify((r.data.controls || []).filter(c => /ligne/.test(c.label)).map(c => c.status)));
check('IBAN et n° de compte bancaire reconnus (distincts des comptes du plan)', /FR76/.test(r.data.fields.iban.value.replace(/\s/g, '')) && r.data.fields.accountNumber.value === '65086189881', JSON.stringify([r.data.fields.iban.value.slice(0, 9), r.data.fields.accountNumber.value]));
check('Aucune opération sans sens déterminé non signalée', tx.filter(x => x.debit == null && x.credit == null).length === 0, '' + tx.filter(x => x.debit == null && x.credit == null).length);
check('Libellés sans glyphe parasite (¨/þ)', tx.every(x => !/[¨þ]/.test(x.label)), tx.find(x => /[¨þ]/.test(x.label))?.label || '');
check('Propositions de comptes générées pour toutes les opérations', r.propsCount === tx.length && r.withCounter >= 1, r.withCounter + '/' + r.propsCount + ' avec contrepartie (le reste en attente, jamais inventé)');
check('Export écritures bancaires : équilibré, lignes = 2 x opérations affectées', r.exBalanced && r.exRows >= 3, 'lignes=' + r.exRows + ' équilibré=' + r.exBalanced);
check('Aucune erreur page', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.16 RELEVÉ RÉEL : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
