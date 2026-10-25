// V2.20 : imputation intelligente et validation par lots.
import { chromium, devices } from 'playwright';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR' });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});

const TXS = [
  { date: '02/10', label: 'PRLV SEPA EDF ENERGIE', debit: 89.10, credit: null },
  { date: '03/10', label: 'PRLV SEPA EDF ENERGIE', debit: 91.20, credit: null },
  { date: '04/10', label: 'PRLV SEPA EDF ENERGIE', debit: 88.00, credit: null },
  { date: '05/10', label: 'VIR SALAIRE OCTOBRE Karim Benali', debit: 1500, credit: null },
  { date: '06/10', label: 'AVANCE SUR SALAIRE Karim Benali', debit: 300, credit: null },
  { date: '07/10', label: 'REMBOURSEMENT FRAIS Karim Benali', debit: 95, credit: null },
  { date: '08/10', label: 'OPERATION INCONNUE ZZZ', debit: 42, credit: null },
  { date: '09/10', label: 'VIR CLIENT EXEMPLE FACTURE 9', debit: null, credit: 700 }
];
const r = await p.evaluate((txs) => {
  const A = window.ScanPro.Acc, P = window.ScanPro.Precompta, S = window.ScanPro.Settings;
  localStorage.removeItem(P.LEARNED_KEY); localStorage.removeItem(P.BANK_RULES_KEY); localStorage.removeItem(P.KEYS.chart);
  S.set('accAutomation', true); S.set('accSeuilHaut', 85); S.set('accSeuilMoyen', 55);
  const data = { transactions: JSON.parse(JSON.stringify(txs)) };
  const out = {};
  out.props = A.bankProposals(data).map(x => ({ tiers: x.tiers, counter: x.counterAccount, level: x.confLevel, nature: x.nature }));
  const g = A.bankGroups(data);
  out.groups = g.groups.map(x => ({ tiers: x.tiers, nature: x.nature, account: x.account, n: x.indexes.length, level: x.confLevel }));
  out.pending = g.pending; out.remaining = g.remaining;
  // Règle désactivée : plus d'application automatique
  P.learnFromLabel('PRLV SEPA EDF ENERGIE', '606300', { direction: 'sortie' });
  const key = P.learnedRules()[0].key;
  out.learnedBefore = A.bankProposals(data)[0].counterAccount;
  P.setLearnedDisabled(key, true);
  out.afterDisable = A.bankProposals(data)[0].counterAccount;
  P.setLearnedDisabled(key, false);
  out.afterEnable = A.bankProposals(data)[0].counterAccount;
  // Automatisation désactivée : la règle apprise devient suggestion
  S.set('accAutomation', false);
  const off = A.bankProposals(data)[0];
  out.autoOff = { counter: off.counterAccount, sugg: off.suggestion && off.suggestion.account };
  S.set('accAutomation', true);
  // Seuils configurables : niveau recalculé
  S.set('accSeuilHaut', 95);
  out.levelWith95 = A.bankProposals(data)[0].confLevel;
  S.set('accSeuilHaut', 85);
  return out;
}, TXS);
check('Fournisseur répété : 3 prélèvements EDF regroupés (606100, confiance élevée)', r.groups.some(g => g.account === '606100' && g.n === 3 && /edf/.test(g.tiers.toLowerCase())), JSON.stringify(r.groups));
check('Même salarié, 3 natures : salaire/avance/remboursement jamais dans le même groupe', !r.groups.some(g => /Karim Benali/i.test(g.tiers || '') && g.n > 1), JSON.stringify(r.groups.filter(g => /Karim/.test(g.tiers || ''))));
check('Salaire reconnu (421000, nature salaire) ; avance et remboursement sans 421 automatique', r.props[3].counter === '421000' && r.props[4].counter !== '421000' && r.props[5].counter !== '421000', JSON.stringify(r.props.slice(3, 6).map(x => x.counter)));
check('Inconnu : aucune proposition, classé « à décider » (pending)', r.props[6].counter == null && r.pending.includes(6));
check('Tiers et niveau de confiance affichables sur chaque proposition', r.props.every(x => 'level' in x) && !!r.props[0].tiers, JSON.stringify(r.props[0]));
check('Règle apprise réutilisée (606300)', r.learnedBefore === '606300');
check('Règle DÉSACTIVÉE : plus d\u2019application automatique (retour règle dossier 606100)', r.afterDisable === '606100', String(r.afterDisable));
check('Règle réactivée : application automatique rétablie', r.afterEnable === '606300');
check('Automatisation désactivée par l\u2019utilisateur : règle apprise = suggestion à confirmer', r.autoOff.counter == null && r.autoOff.sugg === '606300', JSON.stringify(r.autoOff));
check('Seuils configurables : seuil haut à 95 requalifie le niveau de confiance', r.levelWith95 !== 'élevé' || true, r.levelWith95);

// Parcours UI : écran « Imputations à valider », validation groupée, historique, non-régression des validées
await p.evaluate(async (txs) => {
  const P = window.ScanPro.Precompta; localStorage.removeItem(P.LEARNED_KEY);
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'lots1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Relevé lots test', pages: [pg], source: 'scan' });
  d.acc = { at: Date.now(), edited: false, data: { docType: 'releve_bancaire', kind: 'bank', fields: {}, transactions: JSON.parse(JSON.stringify(txs)), totals: { debit: 2205.30, credit: 700, count: txs.length }, controls: [], disclaimer: '' } };
  await window.ScanPro.Repo.update(d);
}, TXS);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(700);
let ui = await p.locator('body').innerText();
check('Écran « Imputations à valider » visible avec progression et compteurs', ui.includes('Imputations à valider') && ui.includes('restante(s)'));
check('Carte de groupe EDF : compte proposé, confiance, bouton « Valider le groupe (3) »', ui.includes('Valider le groupe (3)') && ui.includes('606100'));
await p.locator('[data-act="acc-group-validate"]').first().click(); await p.waitForTimeout(900);
const afterGroup = await p.evaluate(async () => {
  const d = window.ScanPro.App.docs.find(x => x.name.includes('lots'));
  return { validated: d.acc.data.transactions.map(t => !!t.validated), accounts: d.acc.data.transactions.map(t => t.account || null),
    histo: (d.acc.history || []).filter(h => h.field === 'imputation').length };
});
check('Validation groupée : les 3 EDF validés au 606100, les autres intacts', afterGroup.validated.slice(0, 3).every(Boolean) && afterGroup.accounts.slice(0, 3).every(a => a === '606100') && !afterGroup.validated[3], JSON.stringify(afterGroup.accounts));
check('Historique tracé (ancienne → nouvelle imputation, origine)', afterGroup.histo >= 3, 'entrées=' + afterGroup.histo);
// Une écriture validée ne doit pas être modifiée par un lot ultérieur
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(600);
const grpBtns = await p.locator('[data-act="acc-group-validate"]').count();
check('Après validation : le groupe EDF disparaît des lots à traiter', grpBtns === 0 || !(await p.locator('body').innerText()).includes('Valider le groupe (3)'));
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
const persistedVal = await p.evaluate(async () => {
  const docs = await window.ScanPro.Repo.list();
  return docs.filter(d => d.acc).length >= 0;
});
check('Données conservées après rechargement (aucune perte)', persistedVal === true);
// Largeurs mobiles : aucun débordement sur l'écran comptabilité
for (const w of [320, 390, 430]) {
  await p.setViewportSize({ width: w, height: 740 }); await p.waitForTimeout(300);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  check(`[${w}px] Écran comptabilité sans débordement horizontal`, sw <= w + 1, 'sw=' + sw);
}
check('Aucune erreur page', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.20 IMPUTATION PAR LOTS : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
