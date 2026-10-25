// V2.18 : apprentissage par bénéficiaire ET par nature — salaire ≠ remboursement.
import { chromium, devices } from 'playwright';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR' });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const SAL = 'Karim Benali'; // salarié fictif
const TXS = [
  { date: '02/10', label: 'VIR SALAIRE OCTOBRE ' + SAL, debit: 1500, credit: null },
  { date: '03/10', label: 'Virement Web ' + SAL, debit: 1500, credit: null },
  { date: '04/10', label: 'REMBOURSEMENT FRAIS ' + SAL, debit: 120, credit: null },
  { date: '05/10', label: 'AVANCE SUR SALAIRE ' + SAL, debit: 300, credit: null },
  { date: '06/10', label: 'Vir Inst vers Karim Bensaid', debit: 800, credit: null },
  { date: '07/10', label: 'VIR ' + SAL, debit: null, credit: 1500 },
  { date: '08/10', label: 'VIREMENT', debit: 50, credit: null },
  { date: '09/10', label: 'Vir Benali Karim SALAIRE NOVEMBRE', debit: 1500, credit: null }
];
const r = await p.evaluate((txs) => {
  const A = window.ScanPro.Acc, P = window.ScanPro.Precompta;
  localStorage.removeItem(P.LEARNED_KEY); localStorage.removeItem(P.BANK_RULES_KEY); localStorage.removeItem(P.KEYS.chart);
  const data = { transactions: JSON.parse(JSON.stringify(txs)) };
  const out = {};
  // A. Correction explicite classée « salaire » → règle salaire
  out.learnSalaire = P.learnFromLabel(txs[0].label, '421000', { direction: 'sortie', nature: 'salaire' });
  out.props = A.bankProposals(data);
  // B/G. Même salarié, nature remboursement : règle distincte qui coexiste
  out.learnRemb = P.learnFromLabel(txs[2].label, '467000', { direction: 'sortie', nature: 'remboursement/avance' });
  out.rulesAfter2 = P.learnedRules().map(x => ({ account: x.account, nature: x.nature, key: x.key, conflict: x.conflictAccounts }));
  out.props2 = A.bankProposals(data);
  // Export J/K
  const dataAff = { transactions: txs.map((x, i) => i === 3 ? { ...x, account: '421000' } : x) };
  const ex = A.bankEntriesCsv(data, { name: 't' });
  out.exportRows = ex.csv.split('\n').length - 1; out.exportBalanced = ex.balanced && Math.abs(ex.totalDebit - ex.totalCredit) <= 0.01;
  out.exportProblems = ex.problems.length;
  // Compte inactif : pas d'écriture exportable
  const chart = P.chart(); chart.find(a => a.num === '421000').active = false; P.saveChart(chart);
  out.inactiveProp = A.bankProposals({ transactions: [{ ...txs[0] }] })[0];
  out.inactiveEntries = out.inactiveProp.entries.length;
  const chart2 = P.chart(); chart2.find(a => a.num === '421000').active = true; P.saveChart(chart2);
  // L (mécanisme accSave testé en UI ci-dessous) + ancien format de règle
  const legacy = {}; legacy['sortie|ancien benef'] = '606100'; localStorage.setItem(P.LEARNED_KEY, JSON.stringify(legacy));
  out.legacyRules = P.learnedRules().map(x => x.account);
  out.legacyProp = A.bankProposals({ transactions: [{ date: '01/10', label: 'ANCIEN BENEF SORTIE', debit: 10, credit: null }] })[0].counterAccount;
  return out;
}, TXS);
const pr = r.props, pr2 = r.props2;
check('A. Salaire classé : variante SALAIRE du même salarié (ordre inversé) → 421000 automatique appris', pr[7].counterAccount === '421000' && pr[7].learned === true, JSON.stringify([pr[7].counterAccount, pr[7].nature]));
check('A2. Variante sans nature dans le libellé → suggestion 421000 à confirmer, pas d\u2019automatisme', pr[1].counterAccount == null && pr[1].suggestion && pr[1].suggestion.account === '421000', JSON.stringify(pr[1].suggestion));
check('B. Remboursement du même salarié : 421000 JAMAIS appliqué automatiquement', pr[2].counterAccount !== '421000' && pr2[2].counterAccount === '467000', JSON.stringify([pr[2].counterAccount, pr2[2].counterAccount]));
check('C. Avance du même salarié : pas de 421000 automatique', pr[3].counterAccount !== '421000' && pr2[3].counterAccount !== '421000', String(pr2[3].counterAccount));
check('D. Salarié au nom proche (Karim Bensaid) : aucune fusion automatique', pr[5 - 1].counterAccount !== '421000' && pr[4].counterAccount == null, String(pr[4].counterAccount));
check('E. Entrée du même bénéficiaire : règle « sortie » non réutilisée', pr[5].counterAccount !== '421000', String(pr[5].counterAccount));
check('F. Libellé trop générique : aucune identité inventée, en attente', pr[6].counterAccount == null && !pr[6].learned);
check('G. Deux règles même bénéficiaire, natures différentes : coexistence sans conflit artificiel', r.rulesAfter2.length === 2 && r.rulesAfter2.every(x => !x.conflict) && new Set(r.rulesAfter2.map(x => x.nature)).size === 2, JSON.stringify(r.rulesAfter2.map(x => x.nature + ':' + x.account)));
check('J/K. Export : lignes uniquement pour opérations affectées, aucun montant pour les ambiguës, équilibré', r.exportBalanced && r.exportProblems > 0, 'lignes=' + r.exportRows + ' problèmes=' + r.exportProblems);
check('Compte 421000 inactif du plan : proposition signalée et AUCUNE écriture exportable', r.inactiveProp.counterActive === false && r.inactiveEntries === 0 && r.inactiveProp.issues.some(s => /inactif/.test(s)));
check('Anciennes règles (format chaîne V2.16) relues sans erreur', r.legacyRules[0] === '606100');

// H/I/L — parcours interface : similaires revérifiés, sauvegarde sans correction, persistance
await p.evaluate(async (txs) => {
  const P = window.ScanPro.Precompta; localStorage.removeItem(P.LEARNED_KEY);
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'nat1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Relevé natures test', pages: [pg], source: 'scan' });
  d.acc = { at: Date.now(), edited: false, data: { docType: 'releve_bancaire', kind: 'bank', fields: {}, transactions: JSON.parse(JSON.stringify(txs)), totals: { debit: 4270, credit: 1500, count: txs.length }, controls: [], disclaimer: '' } };
  await window.ScanPro.Repo.update(d);
}, TXS);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(600);
// L. Sauvegarde sans aucune correction : aucune règle créée
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
const noLearn = await p.evaluate(() => window.ScanPro.Precompta.learnedRules().length);
check('L. Sauvegarde sans correction explicite : aucune règle apprise', noLearn === 0, 'règles=' + noLearn);
// Correction classée salaire sur la ligne 0, puis application aux similaires
await p.locator('[data-acc-tx="0:nature"]').selectOption('salaire');
await p.locator('[data-acc-tx="0:account"]').fill('421000');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(700);
// V2.23 : confirmation explicite sur la fiche d'aperçu de la règle
await p.locator('.sheet [data-act="acc-save-memo"]').click(); await p.waitForTimeout(900);
const afterSave = await p.evaluate(async () => {
  const d = window.ScanPro.App.docs.find(x => x.name.includes('natures'));
  return { rules: window.ScanPro.Precompta.learnedRules().map(r => r.account + '/' + r.nature), tx: d.acc.data.transactions.map(t => t.account || null) };
});
check('Correction classée salaire enregistrée → 1 règle (421000/salaire)', afterSave.rules.length === 1 && afterSave.rules[0] === '421000/salaire', JSON.stringify(afterSave.rules));
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(600);
const applyBtn = p.locator('[data-act="acc-apply-similar"]').first();
check('H. Bouton « Appliquer aux similaires » présent avec aperçu des lignes concernées', await applyBtn.count() === 1);
await applyBtn.click(); await p.waitForTimeout(900);
const afterApply = await p.evaluate(async () => {
  const d = window.ScanPro.App.docs.find(x => x.name.includes('natures'));
  return d.acc.data.transactions.map(t => t.account || null);
});
check('H. Similaires appliqués : seule la variante SALAIRE de même nature reçoit 421000', afterApply[7] === '421000', JSON.stringify(afterApply));
check('H2. Aucune propagation : remboursement, avance, entrée, homonyme et générique NON modifiés', !afterApply[2] && !afterApply[3] && !afterApply[4] && !afterApply[5] && !afterApply[6] && !afterApply[1], JSON.stringify(afterApply));
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
const persisted = await p.evaluate(() => window.ScanPro.Precompta.learnedRules().map(r => r.account + '/' + r.nature));
check('I. Règle persistante après rechargement (poste local uniquement)', persisted.length === 1 && persisted[0] === '421000/salaire', JSON.stringify(persisted));
check('Aucune erreur page', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.18 APPRENTISSAGE PAR NATURE : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
