// V2.16 : test de bout en bout sur un VÉRITABLE relevé bancaire PDF (natif, multipage).
// Le PDF n'est PAS dans le dépôt (données réelles) : chemin via BANK_PDF_PATH.
// Sans fichier, le test se déclare « ignoré » (jamais « réussi »).
// Jeu de référence INDÉPENDANT, calculé dans le test à partir de la couche texte
// native : comptage des lignes d'opérations et totaux par zones de colonnes —
// aucune valeur du relevé n'est écrite dans ce fichier.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const PDF_PATH = process.env.BANK_PDF_PATH || '/home/user/uploads/releve-reference.pdf';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
if (!fs.existsSync(PDF_PATH)) { console.log('⏭ TEST IGNORÉ : aucun relevé PDF de référence (' + PDF_PATH + '). Fournir un relevé anonymisé via BANK_PDF_PATH.'); process.exit(0); }
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
  // Référence indépendante : lignes reconstruites par y, opérations datées, montants par zone x.
  const A = window.ScanPro.Acc;
  const rowKeys = new Set();
  words.forEach((ws, pi) => { for (const w of ws || []) if (w.x < 0.12 && /^\d{2}\.\d{2}$/.test(w.t)) rowKeys.add(pi + ':' + Math.round(w.y * 120)); });
  const lines = [...rowKeys];
  const printed = (() => { const m = text.replace(/\d{1,2}[.]\d{1,2}[.]\d{4}/g, ' ').match(/Total des opérations\s+([\d ]+,\d{2})\s+([\d ]+,\d{2})/); return m ? { debit: A.parseAmount(m[1]), credit: A.parseAmount(m[2]) } : null; })();
  const data = A.extractBank(text, words);
  const props = A.bankProposals(data);
  const ex = A.bankEntriesCsv(data, { name: 'releve-reel' });
  return { pages: pages.length, pageWords: pages.map(pg => pg.words.length), refCount: lines.length, printed, data, propsCount: props.length, withCounter: props.filter(x => x.counterAccount).length, exBalanced: ex.balanced, exProblems: ex.problems.length, exRows: ex.csv.split('\n').length };
}, b64);
const tx = r.data.transactions || [];
const sumD = Math.round(tx.reduce((s, x) => s + (x.debit || 0), 0) * 100) / 100;
const sumC = Math.round(tx.reduce((s, x) => s + (x.credit || 0), 0) * 100) / 100;
check('PDF natif multipage lu sans OCR : pages et mots positionnés', r.pages >= 2 && r.pageWords.every(n => n > 50), JSON.stringify(r.pageWords));
check('Opérations extraites = comptage de référence du document', tx.length === r.refCount && r.refCount > 30, `extrait=${tx.length} référence=${r.refCount}`);
check('Totaux extraits = totaux IMPRIMÉS du relevé', !!r.printed && Math.abs(sumD - r.printed.debit) <= 0.05 && Math.abs(sumC - r.printed.credit) <= 0.05, `débit=${sumD}/${r.printed?.debit} crédit=${sumC}/${r.printed?.credit}`);
check('Soldes initial et final reconnus (non « Non reconnu »)', r.data.fields.openingBalance.value !== 'Non reconnu' && r.data.fields.closingBalance.value !== 'Non reconnu', JSON.stringify([r.data.fields.openingBalance.value, r.data.fields.closingBalance.value]));
check('Contrôle « totaux imprimés » présent et conforme', (r.data.controls || []).some(c => /Totaux imprimés/.test(c.label) && c.ok), JSON.stringify((r.data.controls || []).filter(c => /Totaux/.test(c.label)).map(c => c.status)));
check('IBAN et n° de compte bancaire reconnus (distincts des comptes du plan)', /FR\d{2}/.test(r.data.fields.iban.value.replace(/\s/g, '')) && /^\d{8,}$/.test(r.data.fields.accountNumber.value), JSON.stringify([r.data.fields.iban.value.slice(0, 4), r.data.fields.accountNumber.value.length]));
check('Aucune opération sans sens déterminé non signalée', tx.filter(x => x.debit == null && x.credit == null).length === 0, '' + tx.filter(x => x.debit == null && x.credit == null).length);
check('Libellés sans glyphe parasite (¨/þ)', tx.every(x => !/[¨þ]/.test(x.label)), tx.find(x => /[¨þ]/.test(x.label))?.label || '');
check('Propositions de comptes générées pour toutes les opérations', r.propsCount === tx.length, r.withCounter + '/' + r.propsCount + ' avec contrepartie automatique (reste en attente, jamais inventé)');
check('Export écritures bancaires : équilibré', r.exBalanced && r.exRows >= 3, 'lignes=' + r.exRows);
check('Aucune erreur page', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.16 RELEVÉ RÉEL : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
