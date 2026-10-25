// AUDIT INDÉPENDANT V2.21 — validation par lots : scénarios A → E sur données 100 % FICTIVES.
// Ne se contente pas de relire un rapport : il clique réellement les trois actions
// (« Valider le groupe », « Corriger le compte du groupe », « Valider + créer une règle »),
// revérifie l'état IndexedDB après rechargement et mesure les largeurs mobiles 320/360/390/430.
import { chromium, devices } from 'playwright';

const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = [];
const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 800 }, locale: 'fr-FR' });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await p.goto(APP, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});

// ── environnement propre : aucun document résiduel, règles apprises remises à zéro ──
await p.evaluate(async () => {
  localStorage.clear();
  const Repo = window.ScanPro.Repo;
  for (const d of await Repo.list()) await Repo.remove(d.id);
});

const makeBankDoc = (name, txs) => p.evaluate(async ({ name, txs }) => {
  const { Repo, ImageOps } = window.ScanPro;
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .9);
  const pg = { id: 'pg-' + name, src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await ImageOps.thumb(src);
  const d = await Repo.create({ name, pages: [pg], source: 'scan' });
  const debit = Math.round(txs.reduce((s, t) => s + (t.debit || 0), 0) * 100) / 100;
  const credit = Math.round(txs.reduce((s, t) => s + (t.credit || 0), 0) * 100) / 100;
  d.acc = { at: Date.now(), edited: false, data: { docType: 'releve_bancaire', kind: 'bank', fields: {}, transactions: JSON.parse(JSON.stringify(txs)), totals: { debit, credit, count: txs.length }, controls: [], disclaimer: '' } };
  await Repo.update(d);
  return d.id;
}, { name, txs });

const snap = (docId) => p.evaluate(async (id) => {
  const d = await window.ScanPro.Repo.doc(id);
  return {
    txs: d.acc.data.transactions.map(t => ({ account: t.account || null, validated: !!t.validated, validatedAt: t.validatedAt || null, nature: t.nature || null, label: t.label })),
    history: d.acc.history || [], docHistory: d.history || []
  };
}, docId);

const lastToast = () => p.evaluate(() => { const el = document.querySelector('#toasts .toast:last-child span'); return el ? el.textContent : ''; });
const progress = async () => {
  const t = await p.locator('body').innerText();
  const m = t.match(/(\d+)\/(\d+) opération\(s\) validée\(s\)[^·]*· (\d+) restante/);
  return m ? { validated: +m[1], total: +m[2], remaining: +m[3] } : null;
};
const openAcc = async (docId) => {
  await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(500);
  await p.locator(`[data-act="acc-select"][data-id="${docId}"]`).click(); await p.waitForTimeout(700);
};
// V2.22 : toute action groupée passe par un récapitulatif à confirmer
const confirmGroup = async (expectedCount) => {
  await p.waitForSelector('.sheet [data-act="acc-group-confirm"]', { timeout: 5000 });
  const recap = await p.locator('.sheet').innerText();
  if (expectedCount != null) check('Récapitulatif : ' + expectedCount + ' opération(s) annoncée(s) avant application', new RegExp('\\b' + expectedCount + '\\b').test(recap), recap.slice(0, 120));
  await p.locator('.sheet [data-act="acc-group-confirm"]').click();
  await p.waitForTimeout(800);
};
const cancelGroup = async () => {
  await p.waitForSelector('.sheet', { timeout: 5000 });
  await p.locator('.sheet button.ghost').first().click();
  await p.waitForTimeout(500);
};

// ══════════════════════════════ DONNÉES FICTIVES ══════════════════════════════
const DOC = 'Relevé fictif audit A-E';
const TXS = [
  { date: '02/10', label: 'PRLV SEPA EDF ENERGIE', debit: 89.10, credit: null },          // 0-2 groupe EDF (606100)
  { date: '03/10', label: 'PRLV SEPA EDF ENERGIE', debit: 91.20, credit: null },          // 1
  { date: '04/10', label: 'PRLV SEPA EDF ENERGIE', debit: 88.00, credit: null },          // 2
  { date: '05/10', label: 'PRLV SEPA SFR MOBILE', debit: 45.00, credit: null },           // 3-4 groupe SFR (626000)
  { date: '06/10', label: 'PRLV SEPA SFR MOBILE', debit: 49.99, credit: null },           // 4
  { date: '07/10', label: 'VIR SALAIRE OCTOBRE Karim Benali', debit: 1500, credit: null },// 5 salaire 421000
  { date: '08/10', label: 'AVANCE SUR SALAIRE Karim Benali', debit: 300, credit: null },  // 6 avance (jamais 421)
  { date: '09/10', label: 'REMBOURSEMENT FRAIS Karim Benali', debit: 95, credit: null },  // 7 remboursement (jamais 421)
  { date: '10/10', label: 'OPERATION INCONNUE ZZZ', debit: 42, credit: null },            // 8 inconnu → en attente
  { date: '11/10', label: 'VIR CLIENT EXEMPLE FACTURE 9', debit: null, credit: 700 },     // 9 client 411000
  { date: '12/10', label: 'PRLV SEPA VEOLIA EAU', debit: 60.00, credit: null },           // 10-11 veolia → règle apprise
  { date: '13/10', label: 'PRLV SEPA VEOLIA EAU', debit: 62.50, credit: null },           // 11
  { date: '14/10', label: 'PRLV SEPA', debit: 10, credit: null }                          // 12 bénéficiaire vide → en attente
];
const docId = await makeBankDoc(DOC, TXS);

// État de référence des propositions (pur calcul, sans toucher aux données)
const ref = await p.evaluate((txs) => {
  const { Acc } = window.ScanPro;
  const g = Acc.bankGroups({ transactions: txs });
  return { groups: g.groups.map(x => ({ tiers: x.tiers, nature: x.nature, account: x.account, idxs: x.indexes, n: x.indexes.length })), pending: g.pending, remaining: g.remaining, total: g.total };
}, TXS);
console.log('Groupes calculés :', JSON.stringify(ref.groups));
check('Référence : 2+ groupes distincts affichés simultanément (multi-groupes)', ref.groups.length >= 3, String(ref.groups.length));
check('Référence : les libellés inconnu et sans bénéficiaire restent en attente (jamais de compte inventé)', ref.pending.includes(8) && ref.pending.includes(12), JSON.stringify(ref.pending));

await openAcc(docId);
const prog0 = await progress();
check('Progression initiale affichée : 0/' + TXS.length + ', reste ' + TXS.length, prog0 && prog0.validated === 0 && prog0.total === TXS.length && prog0.remaining === TXS.length, JSON.stringify(prog0));

// ══════════════════════════════ SCÉNARIO A — validation simple ══════════════════════════════
const edfCard = p.locator('.grp-card', { hasText: 'Edf Energie' });
await edfCard.locator('button[data-act="acc-group-validate"]').click();
await p.waitForTimeout(400);
check('A0 : le récap s’ouvre et aucune opération n’est encore validée', (await snap(docId)).txs.slice(0, 3).every(t => !t.validated));
await cancelGroup();
check('A0b : annuler le récap ne modifie rien', (await snap(docId)).txs.slice(0, 3).every(t => !t.validated) && await p.locator('.sheet').count() === 0);
await edfCard.locator('button[data-act="acc-group-validate"]').click();
await confirmGroup(3);
let s = await snap(docId);
check('A1 : les 3 prélèvements EDF sont validés', s.txs.slice(0, 3).every(t => t.validated), JSON.stringify(s.txs.slice(0, 3)));
check('A2 : les 3 sont au compte cohérent 606100', s.txs.slice(0, 3).every(t => t.account === '606100'), JSON.stringify(s.txs.slice(0, 3).map(t => t.account)));
check('A3 : les 10 autres opérations ne sont ni validées ni affectées par le lot', s.txs.slice(3).every(t => !t.validated && t.account === null), JSON.stringify(s.txs.slice(3).map(t => [t.account, t.validated])));
const progA = await progress();
check('A4 : progression immédiatement actualisée (3/' + TXS.length + ', reste ' + (TXS.length - 3) + ')', progA && progA.validated === 3 && progA.remaining === TXS.length - 3, JSON.stringify(progA));
const histoA = s.history.filter(h => h.field === 'imputation' && h.origin === 'validation groupée (utilisateur)');
check('A5 : 3 entrées d’historique tracées avec origine et règle', histoA.length === 3 && histoA.every(h => h.new === '606100' && h.old === 'en attente'), String(histoA.length));
check('A6 : le message indique le nombre réellement traité (3 opérations)', /3 opération\(s\) validée/.test(await lastToast()), await lastToast());
check('A7 : la carte EDF validée a disparu des lots à traiter', await p.locator('.grp-card', { hasText: 'Edf Energie' }).count() === 0);

// ══════════════════════════════ SCÉNARIO B — correction du compte du groupe ══════════════════════════════
const sfrCard = p.locator('.grp-card', { hasText: 'Sfr Mobile' });
await sfrCard.locator('input[id^="grpacc-"]').fill('622600');
await sfrCard.locator('button[data-act="acc-group-correct"]').click();
await confirmGroup(2);
s = await snap(docId);
check('B1 : le compte corrigé 622600 est appliqué aux 2 seules opérations SFR', s.txs[3].account === '622600' && s.txs[4].account === '622600', JSON.stringify([s.txs[3].account, s.txs[4].account]));
check('B2 : une correction ne valide PAS les opérations', !s.txs[3].validated && !s.txs[4].validated);
check('B3 : les opérations EDF validées et les autres groupes sont intacts', s.txs[0].validated && s.txs[0].account === '606100' && s.txs[5].account === null && s.txs[10].account === null);
const histoB1 = s.history.filter(h => h.field === 'imputation' && h.origin === 'correction de groupe (utilisateur)');
check('B4 : historique de correction tracé (ancienne valeur « en attente » → 622600)', histoB1.length === 2 && histoB1.every(h => h.old === 'en attente' && h.new === '622600'), String(histoB1.length));
check('B5 : le message annonce 2 opérations corrigées', /2 opération\(s\) corrigée/.test(await lastToast()), await lastToast());
// Seconde correction : l'ancien compte (622600) doit être conservé dans l'historique
const sfrCard2 = p.locator('.grp-card', { hasText: 'Sfr Mobile' });
check('B6 : la carte de groupe s’est recalculée avec le nouveau compte 622600', await sfrCard2.locator('input[id^="grpacc-"]').inputValue() === '622600');
await sfrCard2.locator('input[id^="grpacc-"]').fill('606300');
await sfrCard2.locator('button[data-act="acc-group-correct"]').click();
await confirmGroup(2);
s = await snap(docId);
const histoB2 = s.history.filter(h => h.field === 'imputation' && h.origin === 'correction de groupe (utilisateur)');
check('B7 : seconde correction — l’historique conserve l’ANCIEN compte 622600 → 606300', s.txs[3].account === '606300' && s.txs[4].account === '606300' && histoB2.some(h => h.old === '622600' && h.new === '606300'), JSON.stringify(histoB2.map(h => [h.old, h.new])));
check('B8 : toujours aucune validation après correction', !s.txs[3].validated && !s.txs[4].validated);

// ══════════════════════════════ SCÉNARIO C — règle apprise, réimport, désactivation ══════════════════════════════
const veoCard = p.locator('.grp-card', { hasText: 'Veolia Eau' });
await veoCard.locator('input[id^="grpacc-"]').fill('606300');
await veoCard.locator('button[data-act="acc-group-validate-rule"]').click();
await confirmGroup(2);
s = await snap(docId);
check('C1 : Valider + règle → les 2 Veolia sont validées au 606300', s.txs[10].validated && s.txs[11].validated && s.txs[10].account === '606300' && s.txs[11].account === '606300');
const learned = await p.evaluate(() => {
  const r = window.ScanPro.Precompta.learnedRules().find(x => (x.tokens || []).includes('veolia'));
  return r ? { key: r.key, account: r.account, direction: r.direction, nature: r.nature, tokens: r.tokens } : null;
});
check('C2 : la règle mémorise le bon compte (606300), le bon sens (sortie) et les bons tokens bénéficiaires', learned && learned.account === '606300' && learned.direction === 'sortie' && learned.tokens.includes('veolia'), JSON.stringify(learned));
check('C2b : la nature non établie de Veolia reste honnêtement « inconnue » (jamais inventée)', learned && learned.nature === 'inconnue', String(learned && learned.nature));
const ruleKey = learned ? learned.key : null;
check('C3 : le message confirme validation ET apprentissage', /validée/.test(await lastToast()) && /Règle apprise/.test(await lastToast()), await lastToast());
// « Réimport » : nouvelles opérations correspondant à la règle, dans un nouveau document
const DOC2 = 'Relevé fictif réimport C';
const NEW = [
  { date: '20/10', label: 'PRLV VEOLIA EAU FACT 12', debit: 55.0, credit: null },
  { date: '21/10', label: 'VEOLIA EAU PRELEVEMENT', debit: 57.0, credit: null }
];
const doc2Id = await makeBankDoc(DOC2, NEW);
const reused = await p.evaluate((id) => {
  const doc2 = window.ScanPro.App.docs.find(x => x.id === id);
  const props = window.ScanPro.Acc.bankProposals(doc2.acc.data);
  return props.map(x => ({ counter: x.counterAccount, origin: x.origin, level: x.confLevel }));
}, doc2Id);
check('C4 : les nouvelles opérations réimportées récupèrent automatiquement le compte 606300 (règle retrouvée)', reused.every(x => x.counter === '606300' && x.origin === 'apprentissage'), JSON.stringify(reused));
// Règle désactivée : elle ne doit plus s'appliquer automatiquement
const afterDisable = await p.evaluate((key) => {
  const { Precompta, Acc, App } = window.ScanPro;
  Precompta.setLearnedDisabled(key, true);
  const doc2 = App.docs.find(x => x.name === 'Relevé fictif réimport C');
  const props = Acc.bankProposals(doc2.acc.data).map(x => ({ counter: x.counterAccount, origin: x.origin }));
  const disabled = Precompta.learnedRules().find(r => r.key === key).disabled;
  Precompta.setLearnedDisabled(key, false);
  return { props, disabled };
}, ruleKey);
check('C5 : une règle désactivée ne s’applique plus (retour règle dossier 606100, pas 606300)', afterDisable.disabled === true && afterDisable.props.every(x => x.counter !== '606300'), JSON.stringify(afterDisable));

// ══════════════════════════════ SCÉNARIO D — sécurité comptable ══════════════════════════════
const d = await p.evaluate((txs) => {
  const { Acc } = window.ScanPro;
  const props = Acc.bankProposals({ transactions: txs });
  const groups = Acc.bankGroups({ transactions: txs }).groups;
  const karimGroups = groups.filter(g => /Karim Benali/i.test(g.tiers || ''));
  return {
    props: props.map(x => ({ idx: x.index, counter: x.counterAccount, nature: x.nature, tiers: x.tiers })),
    karimGroups: karimGroups.map(g => ({ nature: g.nature, account: g.account, idxs: g.indexes }))
  };
}, TXS);
check('D1 : salaire / avance / remboursement du même salarié ne sont jamais confondus (groupes distincts)', d.karimGroups.length >= 2 && d.karimGroups.every(g => g.idxs.length === 1), JSON.stringify(d.karimGroups));
check('D2 : seul le salaire reçoit 421000 ; avance et remboursement ne l’obtiennent pas', d.props[5].counter === '421000' && d.props[6].counter !== '421000' && d.props[7].counter !== '421000', JSON.stringify([d.props[5].counter, d.props[6].counter, d.props[7].counter]));
check('D3 : le libellé inconnu reste sans compte (à confirmer)', d.props[8].counter === null, String(d.props[8].counter));
// Opération pré-validée sur un compte différent : un lot ne doit pas la retoucher
const DOC3 = 'Relevé fictif protection D';
const doc3Id = await makeBankDoc(DOC3, TXS.slice(0, 3));
await p.evaluate(async (id) => {
  const { Repo, App, Actions } = window.ScanPro;
  const d3 = await Repo.doc(id);
  d3.acc.data.transactions[0].account = '626000'; // compte différent de la proposition 606100
  await Repo.update(d3);
  App.accDocId = id;
  await Actions['acc-validate-tx']({ dataset: { idx: '0' } });
}, doc3Id);
const stampD4 = await p.evaluate(async (id) => (await window.ScanPro.Repo.doc(id)).acc.data.transactions[0].validatedAt, doc3Id);
await openAcc(doc3Id);
// Lot obsolète par index (inclut la ligne déjà validée) alors que tx1/tx2 ne le sont pas encore :
// le récap doit annoncer 2 lignes à traiter et 1 déjà validée non touchée
await p.evaluate((id) => { window.ScanPro.App.accDocId = id; window.ScanPro.Actions['acc-group-validate']({ dataset: { idxs: '0,1,2' } }); }, doc3Id);
await p.waitForTimeout(400);
const recapSkip = await p.locator('.sheet').innerText().catch(() => '');
check('D4-récap : lot avec index obsolète → 1 opération déjà validée explicitement signalée', /\b1\b/.test(recapSkip) && /déjà validée/.test(recapSkip), recapSkip.slice(0, 160));
await p.locator('.sheet button.ghost').first().click().catch(() => {}); // annulation : aucun nouvel effet
await p.waitForTimeout(400);
// Parcours carte réel : la carte ne contient que les 2 lignes non validées ; récap puis confirmation
const d3Card = p.locator('.grp-card', { hasText: 'Edf Energie' });
await d3Card.locator('button[data-act="acc-group-validate"]').click();
await p.waitForTimeout(400);
const recapD4 = await p.locator('.sheet').innerText();
check('D4-récap : 2 opérations à traiter annoncées, la ligne validée étant exclue du groupe', /\b2\b/.test(recapD4) && !/1 déjà validée/.test(recapD4), recapD4.slice(0, 160));
await p.locator('.sheet [data-act="acc-group-confirm"]').click();
await p.waitForTimeout(800);
// Lot obsolète confirmé après validation complète : toutes les lignes sont validées → refus explicite, sans écriture
const histBefore = (await snap(doc3Id)).history.filter(h => h.field === 'imputation').length;
await p.evaluate((id) => { window.ScanPro.App.accDocId = id; window.ScanPro.Actions['acc-group-validate']({ dataset: { idxs: '0,1,2' } }); }, doc3Id);
await p.waitForTimeout(400);
const staleToast = await lastToast();
const prot = await p.evaluate(async ({ id, stamp }) => {
  const after = await window.ScanPro.Repo.doc(id);
  return {
    tx0: { account: after.acc.data.transactions[0].account, validated: after.acc.data.transactions[0].validated, stampKept: after.acc.data.transactions[0].validatedAt === stamp },
    others: after.acc.data.transactions.slice(1).map(t => [t.account, t.validated]),
    histo: (after.acc.history || []).filter(h => h.field === 'imputation').length,
    toast: (document.querySelector('#toasts .toast:last-child span') || {}).textContent || ''
  };
}, { id: doc3Id, stamp: stampD4 });
check('D6a : le lot entièrement validé est refusé avec un message d’erreur explicite (pas de faux succès)', /déjà validée/.test(staleToast) && /toast err/.test(await p.locator('#toasts .toast:last-child').getAttribute('class')), staleToast);
check('D6b : aucune écriture d’historique ajoutée par la demande refusée', prot.histo === histBefore, prot.histo + ' vs ' + histBefore);
check('D4 : l’opération pré-validée (626000) n’est pas modifiée par le lot', prot.tx0.account === '626000' && prot.tx0.validated && prot.tx0.stampKept, JSON.stringify(prot.tx0));
check('D5 : les 2 opérations non validées du lot reçoivent bien 606100', prot.others.length === 2 && prot.others.every(([a, v]) => a === '606100' && v), JSON.stringify(prot.others));

// ══════════════════════════════ SCÉNARIO E — persistance après rechargement ══════════════════════════════
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
const persisted = await p.evaluate(async ({ docId, doc2Id, doc3Id, ruleKey, TXS, NEW }) => {
  const { Repo, Precompta } = window.ScanPro;
  const docs = await Repo.list();
  const d1 = await Repo.doc(docId), d2 = await Repo.doc(doc2Id), d3 = await Repo.doc(doc3Id);
  const rule = Precompta.learnedRules().find(r => r.key === ruleKey);
  return {
    docCount: docs.length,
    d1Labels: d1.acc.data.transactions.map(t => t.label),
    d1: d1.acc.data.transactions.map(t => [t.account || null, !!t.validated]),
    d1Histo: (d1.acc.history || []).filter(h => h.field === 'imputation').length,
    d2Count: d2.acc.data.transactions.length,
    d2Labels: d2.acc.data.transactions.map(t => t.label),
    d3tx0: [d3.acc.data.transactions[0].account, d3.acc.data.transactions[0].validated],
    rulePersisted: !!rule && rule.account === '606300' && rule.disabled === false,
    learnedCount: Precompta.learnedRules().length,
    sameTxCount: d1.acc.data.transactions.length === TXS.length && d2.acc.data.transactions.length === NEW.length,
    sameLabels: JSON.stringify(d1.acc.data.transactions.map(t => t.label)) === JSON.stringify(TXS.map(t => t.label))
  };
}, { docId, doc2Id, doc3Id, ruleKey, TXS, NEW });
check('E1 : les 3 documents fictifs sont tous conservés', persisted.docCount === 3, String(persisted.docCount));
check('E2 : aucune opération perdue (même nombre, mêmes libellés, même ordre)', persisted.sameTxCount && persisted.sameLabels, JSON.stringify(persisted.d1Labels));
check('E3 : validations et comptes conservés (EDF×3 validés 606100, SFR corrigés 606300 non validés, Veolia validés 606300)',
  persisted.d1.slice(0, 3).every(([a, v]) => a === '606100' && v) &&
  persisted.d1[3][0] === '606300' && persisted.d1[3][1] === false && persisted.d1[4][0] === '606300' && persisted.d1[4][1] === false &&
  persisted.d1[10][0] === '606300' && persisted.d1[10][1] && persisted.d1[11][0] === '606300' && persisted.d1[11][1], JSON.stringify(persisted.d1));
check('E4 : l’historique des imputations est conservé', persisted.d1Histo >= 7, String(persisted.d1Histo));
check('E5 : la règle apprise est persistée après rechargement', persisted.rulePersisted, JSON.stringify({ learned: persisted.learnedCount }));
check('E6 : l’écriture protégée du document D reste validée à 626000', persisted.d3tx0[0] === '626000' && persisted.d3tx0[1] === true, JSON.stringify(persisted.d3tx0));

// ══════════════════════════════ CAS LIMITES — seuils invalides, bénéficiaire vide, double clic ══════════════════════════════
const edge = await p.evaluate(async (docId) => {
  const { Settings, Acc, Repo, App, Actions } = window.ScanPro;
  const out = { thresholdOk: true, thresholdErrors: [], emptyBenef: null, doubleClick: null };
  const data = { transactions: [{ date: '01/10', label: 'PRLV SEPA EDF ENERGIE', debit: 50, credit: null }] };
  for (const v of [null, 'abc', 0, -5, 200]) {
    try {
      localStorage.setItem(Settings.k, JSON.stringify({ accSeuilHaut: v, accSeuilMoyen: v }));
      Settings.load();
      const props = Acc.bankProposals(data);
      if (!props.every(x => ['élevé', 'moyen', 'faible'].includes(x.confLevel))) out.thresholdOk = false;
    } catch (e) { out.thresholdOk = false; out.thresholdErrors.push(String(v) + ':' + e.message); }
  }
  localStorage.setItem(Settings.k, JSON.stringify(Settings.defaults)); Settings.load();
  // Bénéficiaire non identifiable : aucun plantage, aucune proposition inventée
  const g = Acc.bankGroups({ transactions: [{ date: '01/10', label: 'PRLV SEPA', debit: 10, credit: null }] });
  out.emptyBenef = { pending: g.pending, groups: g.groups.length };
  const c = document.createElement('canvas'); c.width = 100; c.height = 100;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 100, 100);
  const src = c.toDataURL('image/jpeg', .8);
  const pg = { id: 'pg4', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d4 = await Repo.create({ name: 'Relevé fictif double-clic', pages: [pg], source: 'scan' });
  d4.acc = { at: Date.now(), data: { docType: 'releve_bancaire', kind: 'bank', fields: {}, transactions: [
    { date: '01/10', label: 'PRLV SEPA SFR MOBILE', debit: 10, credit: null },
    { date: '02/10', label: 'PRLV SEPA SFR MOBILE', debit: 20, credit: null }
  ], totals: { debit: 30, credit: 0, count: 2 }, controls: [] } };
  await Repo.update(d4);
  App.accDocId = d4.id;
  out.doc4Id = d4.id;
  return out;
}, docId);
check('L1 : seuils nuls/invalides/null ne font pas planter et replient sur les valeurs par défaut', edge.thresholdOk, JSON.stringify(edge.thresholdErrors));
check('L2 : libellé sans bénéficiaire identifiable → en attente, sans groupe ni compte inventé', edge.emptyBenef.pending.length === 1 && edge.emptyBenef.groups === 0, JSON.stringify(edge.emptyBenef));
// V2.22 : le récap fait écran anti-double-clic ; une seconde demande sur un lot déjà validé est refusée sans écriture
const doc4Id = edge.doc4Id;
await openAcc(doc4Id);
const d4Card = p.locator('.grp-card', { hasText: 'Sfr Mobile' });
await d4Card.locator('button[data-act="acc-group-validate"]').click();
await confirmGroup(2);
const once = await snap(doc4Id);
check('L3a : une seule validation par opération (2 entrées, 2 validations au 626000)', once.history.filter(h => h.field === 'imputation').length === 2 && once.txs.every(t => t.validated && t.account === '626000'), JSON.stringify(once.txs));
// Redemander le même lot : toutes les lignes sont validées → message d'erreur, zéro nouvelle écriture
await p.evaluate((id) => { window.ScanPro.App.accDocId = id; window.ScanPro.Actions['acc-group-validate']({ dataset: { idxs: '0,1' } }); }, doc4Id);
await p.waitForTimeout(500);
const twice = await snap(doc4Id);
check('L3b : seconde demande refusée (déjà validées), aucune entrée d’historique supplémentaire, aucun faux succès', twice.history.filter(h => h.field === 'imputation').length === 2 && /déjà validées|Aucun compte/.test(await lastToast()), await lastToast());

// ══════════════════════════════ SCÉNARIO F — gardes fous du récapitulatif (compte vide, double-clic) ══════════════════════════════
const doc6Id = await makeBankDoc('Relevé fictif gardes fous récap', TXS.slice(0, 3));
await openAcc(doc6Id);
const fCard = p.locator('.grp-card', { hasText: 'Edf Energie' });
// F1 : champ compte volontairement vidé → erreur explicite, pas de sheet, aucune écriture
await fCard.locator('input[id^="grpacc-"]').fill('');
await fCard.locator('button[data-act="acc-group-validate"]').click();
await p.waitForTimeout(400);
const f1 = await snap(doc6Id);
check('F1 : compte vidé → erreur explicite, aucun sheet de confirmation, zéro validation et zéro historique',
  (await p.locator('.sheet [data-act="acc-group-confirm"]').count()) === 0 &&
  /Aucun compte saisi/.test(await lastToast()) &&
  f1.txs.every(t => !t.validated) && f1.history.filter(h => h.field === 'imputation').length === 0, await lastToast());
// F2 : double-clic rapide sur le bouton confirmer → une seule validation par opération
await fCard.locator('input[id^="grpacc-"]').fill('606100');
await fCard.locator('button[data-act="acc-group-validate"]').click();
await p.waitForSelector('.sheet [data-act="acc-group-confirm"]', { timeout: 5000 });
const confirmBtn = p.locator('.sheet [data-act="acc-group-confirm"]');
await confirmBtn.click();
await confirmBtn.click().catch(() => {}); // 2e clic après fermeture du sheet : ne doit rien provoquer
await p.waitForTimeout(800);
const f2 = await snap(doc6Id);
check('F2 : double-clic sur confirmer → exactement 3 validations et 3 entrées d’historique (pas de double écriture)',
  f2.txs.filter(t => t.validated).length === 3 && f2.history.filter(h => h.field === 'imputation').length === 3,
  JSON.stringify({ validations: f2.txs.filter(t => t.validated).length, histo: f2.history.filter(h => h.field === 'imputation').length }));

// ══════════════════════════════ LARGEURS MOBILES 320/360/390/430 ══════════════════════════════
await openAcc(docId);
for (const w of [320, 360, 390, 430]) {
  await p.setViewportSize({ width: w, height: 800 });
  await p.waitForTimeout(350);
  const m = await p.evaluate(() => {
    const de = document.documentElement;
    const btns = [...document.querySelectorAll('.grp-actions button, .grp-card input[id^="grpacc-"]')].map(el => {
      const r = el.getBoundingClientRect();
      return { right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width), text: (el.value || el.textContent || '').slice(0, 24) };
    });
    return { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, btns, overflow: btns.filter(b => b.right > window.innerWidth + 1 || b.left < -1 || b.w < 32) };
  });
  check(`[${w}px] aucun débordement horizontal (scrollWidth ≤ ${w})`, m.scrollWidth <= w + 1, 'sw=' + m.scrollWidth);
  check(`[${w}px] tous les boutons et champs de groupe restent visibles et cliquables`, m.overflow.length === 0, JSON.stringify(m.overflow));
}
await p.setViewportSize({ width: 360, height: 800 });

// ══════════════════════════════ MOBILE 320 px — le récapitulatif V2.22 reste utilisable ══════════════════════════════
// On crée un lot frais non validé (le document doc4Id est entièrement validé) pour rouvrir le sheet.
const doc5Id = await makeBankDoc('Relevé fictif récap mobile', TXS.slice(0, 3));
await p.setViewportSize({ width: 320, height: 800 });
await openAcc(doc5Id);
const mobCard = p.locator('.grp-card', { hasText: 'Edf Energie' });
await mobCard.locator('button[data-act="acc-group-validate"]').click();
await p.waitForSelector('.sheet [data-act="acc-group-confirm"]', { timeout: 5000 });
await p.waitForTimeout(300);
const sheet320 = await p.evaluate(() => {
  const de = document.documentElement;
  const sheet = document.querySelector('.sheet');
  const confirmBtn = document.querySelector('.sheet [data-act="acc-group-confirm"]');
  const ghostBtn = document.querySelector('.sheet button.ghost');
  const r = confirmBtn.getBoundingClientRect();
  const gr = ghostBtn.getBoundingClientRect();
  const sr = sheet.getBoundingClientRect();
  const styles = getComputedStyle(confirmBtn);
  return {
    scrollWidth: de.scrollWidth, innerWidth: window.innerWidth,
    sheetWithinViewport: sr.left >= -1 && sr.right <= window.innerWidth + 1,
    confirm: { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), visible: r.width > 0 && r.height > 0 },
    cancel: { w: Math.round(gr.width), h: Math.round(gr.height) },
    fontSize: styles.fontSize,
    bodyText: sheet.innerText.length,
    // aucun texte de montant/compte ne doit déborder : pas de scroll horizontal interne
    sheetScrollableX: sheet.scrollWidth > sheet.clientWidth + 1
  };
});
check('[320px] le récapitulatif s’ouvre sans débordement horizontal global', sheet320.scrollWidth <= 321, 'sw=' + sheet320.scrollWidth);
check('[320px] le sheet tient dans la largeur de l’écran et ne scrolle pas horizontalement', sheet320.sheetWithinViewport && !sheet320.sheetScrollableX, JSON.stringify({ within: sheet320.sheetWithinViewport, sx: sheet320.sheetScrollableX }));
check('[320px] les boutons confirmer/annuler sont des cibles tactiles suffisantes (≥40 px de haut)', sheet320.confirm.h >= 40 && sheet320.cancel.h >= 40 && sheet320.confirm.w >= 120, JSON.stringify({ confirm: sheet320.confirm, cancel: sheet320.cancel }));
check('[320px] le récap reste lisible (texte ≥12 px, contenu non vide)', Number.parseFloat(sheet320.fontSize) >= 12 && sheet320.bodyText > 80, sheet320.fontSize + 'px / ' + sheet320.bodyText + ' car.');
await p.locator('.sheet button.ghost').first().click();
await p.waitForTimeout(300);
await p.setViewportSize({ width: 360, height: 800 });

check('Aucune erreur JavaScript pendant tout le parcours', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n===== AUDIT INDÉPENDANT V2.21 (lots) : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close();
process.exit(ko.length ? 1 : 0);
