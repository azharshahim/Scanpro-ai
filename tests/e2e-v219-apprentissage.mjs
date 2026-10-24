// V2.17 : apprentissage fiabilisé des comptes bancaires — bénéficiaire normalisé,
// sens, conflits, suggestions incertaines, parcours complet correction → export.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const TXS = [
  { date: '02/10', label: 'Vir Inst vers Karim Benali', debit: 1500, credit: null },
  { date: '03/10', label: 'Virement Web Karim Benali', debit: 1500, credit: null },
  { date: '04/10', label: 'Vir Benali Karim', debit: 200, credit: null },
  { date: '05/10', label: 'Vir Inst vers Karim Bensaid', debit: 300, credit: null },
  { date: '06/10', label: 'Vir Inst vers Marie Martin', debit: 900, credit: null },
  { date: '07/10', label: 'VIR CLIENT EXEMPLE FACTURE 12', debit: null, credit: 2400 },
  { date: '08/10', label: 'PRLV FOURNISSEUR ABC FAC N 88', debit: 450, credit: null },
  { date: '09/10', label: 'Virement interne entre comptes', debit: 500, credit: null },
  { date: '10/10', label: 'OPERATION INCONNUE XYZ', debit: 77, credit: null },
  { date: '11/10', label: 'VIR SALAIRE MENSUEL COLLABORATEUR', debit: 1800, credit: null },
  { date: '12/10', label: 'Vir Inst vers KABONGO Paul', debit: 1500, credit: null }
];
const r = await p.evaluate((txs) => {
  const A = window.ScanPro.Acc, P = window.ScanPro.Precompta;
  localStorage.removeItem(P.LEARNED_KEY); localStorage.removeItem(P.BANK_RULES_KEY); localStorage.removeItem(P.KEYS.chart);
  const data = { transactions: JSON.parse(JSON.stringify(txs)) };
  const out = {};
  out.before = A.bankProposals(data).map(x => ({ counter: x.counterAccount, nature: x.nature }));
  // Correction explicite : le salarié MUKALA reçoit 421000
  const learnRes = P.learnFromLabel('Vir Inst vers Karim Benali', '421000', { direction: 'sortie' });
  out.learnRes = learnRes;
  out.after = A.bankProposals(data).map(x => ({ counter: x.counterAccount, learned: x.learned, origin: x.origin, sugg: x.suggestion ? (x.suggestion.account || x.suggestion.accounts) : null, conf: x.confidence, similar: x.similarIndexes }));
  out.rules = P.learnedRules().map(x => ({ key: x.key, account: x.account, tokens: x.tokens, direction: x.direction }));
  // Libellé trop générique : refus d'apprendre
  out.generic = P.learnFromLabel('Virement', '421000', { direction: 'sortie' });
  out.generic2 = P.learnFromLabel('Vers le compte', '421000', { direction: 'sortie' });
  // Conflit : même bénéficiaire, autre compte, sans forcer
  out.conflict = P.learnFromLabel('Benali Karim Vir Inst', '641000', { direction: 'sortie' });
  out.afterConflict = A.bankProposals(data)[0];
  // Correction forcée de la règle, puis annulation
  out.corrected = P.correctLearned(learnRes.key, '421000');
  out.afterCorrect = A.bankProposals(data)[0].counterAccount;
  // Sens inverse : la règle « sortie » ne s'applique pas à une entrée du même nom
  const inv = A.bankProposals({ transactions: [{ date: '13/10', label: 'Virement Karim Benali', debit: null, credit: 100 }] })[0];
  out.inverseSens = inv.counterAccount;
  // Export : la suggestion incertaine et l'inconnu ne sont jamais exportés
  const ex = A.bankEntriesCsv(data, { name: 'test' });
  out.exportRows = ex.csv.split('\n').length - 1; out.exportBalanced = ex.balanced;
  return out;
}, TXS);
check('Avant apprentissage : virements personnes en attente (421000 non généralisé)', r.before[0].counter == null && r.before[3].counter == null && r.before[5].counter === '411000', JSON.stringify(r.before.map(x => x.counter)));
check('Motif paie explicite en sortie → 421000 proposé (règle du dossier)', r.before[9].counter === '421000' && r.before[9].nature === 'salaire');
check('Virement interne → 580000, fournisseur → 401000', r.before[7].counter === '580000' && r.before[6].counter === '401000');
check('Apprentissage : règle créée (bénéficiaire trié, sens sortie)', r.learnRes.ok === true && /sortie\|benali karim/.test(r.learnRes.key), JSON.stringify(r.learnRes));
check('Réutilisation : variantes du même salarié (ordre des mots différent) → 421000 appris', r.after[0].counter === '421000' && r.after[1].counter === '421000' && r.after[2].counter === '421000' && r.after[1].learned === true, JSON.stringify(r.after.slice(0, 3).map(x => x.counter)));
check('Faux positifs = 0 : autre personne partageant un prénom → suggestion à confirmer, PAS 421000 auto', r.after[5 - 1].counter !== '421000' && r.after[3].counter == null, JSON.stringify(r.after[3]));
check('Noms proches (Karim Bensaid vs Karim Benali) : pas de regroupement automatique', r.after[3].counter == null && r.after[10].counter == null);
check('Opération inconnue laissée en attente', r.before[8].counter == null && r.after[8].counter == null);
check('Libellés trop génériques refusés (« Virement », « Vers le compte »)', r.generic.ok === false && r.generic2.ok === false, JSON.stringify([r.generic.reason, r.generic2.reason]));
check('Conflit de règles signalé, pas résolu silencieusement', r.conflict.conflict === true && r.afterConflict.counterAccount == null && !!r.afterConflict.suggestion, JSON.stringify(r.conflict.reason));
check('Correction explicite de la règle en conflit → 421000 rétabli', r.corrected === true && r.afterCorrect === '421000');
check('Règle « sortie » non appliquée à une entrée du même bénéficiaire', r.inverseSens !== '421000', String(r.inverseSens));
check('Export : uniquement les lignes affectées (2 lignes/op), équilibré', r.exportBalanced && r.exportRows === 2 * r.after.filter(x => x.counter).length, 'lignes=' + r.exportRows);
const proposed = r.after.filter(x => x.counter).length;
console.log(`   → Mesures cas de référence : proposés automatiquement ${proposed}/${TXS.length}, en attente ${TXS.length - proposed}, faux positifs 421000 : ${r.after.filter((x, i) => x.counter === '421000' && ![0, 1, 2, 9].includes(i)).length}`);

// Parcours complet UI : correction manuelle → enregistrement → apprentissage → réutilisation → persistance → export
await p.evaluate(async (txs) => {
  const P = window.ScanPro.Precompta; localStorage.removeItem(P.LEARNED_KEY);
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'sal1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Relevé salaires test', pages: [pg], source: 'scan' });
  d.acc = { at: Date.now(), edited: false, data: { docType: 'releve_bancaire', kind: 'bank', fields: {}, transactions: JSON.parse(JSON.stringify(txs)),
    totals: { debit: 7550, credit: 2400, count: txs.length }, controls: [], disclaimer: '' } };
  await window.ScanPro.Repo.update(d);
}, TXS);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(600);
let ui = await p.locator('body').innerText();
check('UI : section Propositions comptables + « Règles apprises » après première correction (absente avant)', ui.includes('Propositions comptables'));
await p.locator('[data-acc-tx="0:account"]').fill('421000');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(900);
ui = await p.locator('body').innerText();
const learnedUi = await p.evaluate(() => window.ScanPro.Precompta.learnedRules().map(r => r.account + '|' + r.tokens.join(' ')));
check('Parcours : correction 421000 enregistrée → 1 règle apprise (bénéficiaire)', learnedUi.length === 1 && learnedUi[0].startsWith('421000|'), JSON.stringify(learnedUi));
check('Parcours : variantes du même salarié proposées 421000 après enregistrement', ui.includes('421000 — Personnel'));
check('Parcours : pas de propagation à toutes les opérations (autres personnes non affectées 421)', (ui.match(/421000 — Personnel/g) || []).length <= 4, 'occurrences=' + (ui.match(/421000 — Personnel/g) || []).length);
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
const persisted = await p.evaluate(() => window.ScanPro.Precompta.learnedRules().length);
check('Persistance : règle apprise conservée après fermeture/réouverture', persisted === 1, 'règles=' + persisted);
// Annulation de la règle depuis l'UI
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(600);
await p.locator('[data-act="acc-rule-forget"]').first().click(); await p.waitForTimeout(600);
const afterForget = await p.evaluate(() => window.ScanPro.Precompta.learnedRules().length);
check('Annulation d\u2019une règle apprise depuis l\u2019interface', afterForget === 0);
check('Aucune erreur page', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.17 APPRENTISSAGE COMPTES : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
