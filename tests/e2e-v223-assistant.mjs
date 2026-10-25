// V2.23 — Assistant comptable intelligent : apprentissage CONTRÔLÉ (aperçu avant
// mémorisation, choix explicite, annulation sans effet), tri fiables/incertaines/
// non reconnues, journal de banque CSV avec colonne Tiers et virgule décimale.
// Données 100 % fictives. Aucun service externe, aucune donnée réelle.
import { chromium, devices } from 'playwright';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 780 }, locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});

// ═══════════════════ PARTIE MOTEUR (pures fonctions, via la page) ═══════════════════
const engine = await p.evaluate(() => {
  const A = window.ScanPro.Acc, P = window.ScanPro.Precompta;
  localStorage.removeItem(P.LEARNED_KEY); localStorage.removeItem(P.BANK_RULES_KEY); localStorage.removeItem(P.KEYS.chart);
  // Règle apprise : la variante sans nature établie deviendra une suggestion (incertaine)
  const learn = P.learnFromLabel('Vir Inst vers Karim Benali', '421000', { direction: 'sortie', nature: 'salaire' });
  const txs = [
    { date: '02/10/2026', label: 'PRLV SEPA EDF ENERGIE', debit: 45.9, credit: null },                 // fiable (règle dossier 606100)
    { date: '03/10/2026', label: 'Virement Web Karim Benali', debit: 100, credit: null },             // incertaine (suggestion 421000)
    { date: '04/10/2026', label: 'OPERATION INCONNUE XYZ 99', debit: 77, credit: null },              // non reconnue
    { date: '05/10/2026', label: 'PRLV SEPA SFR MOBILE', debit: 30, credit: null, validated: true, account: '626000' } // validée
  ];
  const data = { transactions: JSON.parse(JSON.stringify(txs)) };
  const props = A.bankProposals(data);
  const tri = A.bankTriage(data);
  const g = A.bankGroups(data);
  const snapshotBefore = JSON.stringify(data.transactions);
  const ex = A.bankEntriesCsv(data, { name: 'test-v223' });
  const untouched = JSON.stringify(data.transactions) === snapshotBefore;
  const lines = ex.csv.split('\n');
  const header = lines[0].split(';').map(c => c.replace(/^"|"$/g, ''));
  const findRow = (needle) => lines.slice(1).map(l => l.split(';').map(c => c.replace(/^"|"$/g, ''))).find(r => r.some(c => c.includes(needle)));
  const edfRow = findRow('EDF');
  const salaireRow = findRow('SALAIRE PAYE');
  // Cas séparé : opération exportable sans tiers identifiable (jetons tous génériques)
  const ex2 = A.bankEntriesCsv({ transactions: [{ date: '06/10/2026', label: 'VIR SALAIRE PAYE', debit: 1800, credit: null }] });
  const rowNoTiers = ex2.csv.split('\n')[1].split(';').map(c => c.replace(/^"|"$/g, ''));
  return {
    learnOk: learn.ok,
    props: props.map(x => ({ i: x.index, counter: x.counterAccount, sugg: x.suggestion ? (x.suggestion.account || x.suggestion.accounts) : null, level: x.confLevel, tiers: x.tiers, validated: x.validated })),
    tri, g: { pending: g.pending, groupIndexes: g.groups.flatMap(x => x.indexes), validated: g.validated },
    csv: { columns: ex.columns, header, balanced: ex.balanced, totalDebit: ex.totalDebit, totalCredit: ex.totalCredit, problems: ex.problems, untouched,
      edfTiers: edfRow ? edfRow[header.indexOf('Tiers')] : null, edfDebit: edfRow ? edfRow[header.indexOf('Débit')] : null,
      noTiersCell: rowNoTiers[header.indexOf('Tiers')], noTiersAccount: rowNoTiers[header.indexOf('Compte')],
      rowCount: lines.length - 1, ex2RowCount: ex2.csv.split('\n').length - 1 }
  };
});

check('M1 : apprentissage initial possible (règle de référence créée)', engine.learnOk === true);
check('M2 : tri fiables — EDF reçoit une contrepartie automatique', engine.tri.cats.fiables.includes(0) && engine.props[0].counter === '606100', JSON.stringify(engine.props[0]));
check('M3 : tri incertaines — la variante Karim est en suggestion, jamais affectée seule', engine.tri.cats.incertaines.includes(1) && engine.props[1].counter == null && engine.props[1].sugg === '421000', JSON.stringify(engine.props[1]));
check('M4 : tri non reconnues — l’opération inconnue reste sans compte ni suggestion', engine.tri.cats.nonReconnues.includes(2) && engine.props[2].counter == null && engine.props[2].sugg == null);
check('M5 : les opérations validées sont comptées à part', engine.tri.cats.validees.includes(3) && engine.tri.counts.validees === 1);
check('M6 : comptages et reste à traiter exacts', engine.tri.counts.fiables === 1 && engine.tri.counts.incertaines === 1 && engine.tri.counts.nonReconnues === 1 && engine.tri.pending === 2, JSON.stringify(engine.tri.counts));
check('M7 : une opération incertaine n’entre dans aucun groupe validable (jamais de validation automatique)', engine.g.pending.includes(1) && !engine.g.groupIndexes.includes(1), JSON.stringify(engine.g));
check('M8 : chaque proposition porte un niveau de confiance verbalisé', engine.props.every(x => ['élevé', 'moyen', 'faible'].includes(x.level)), JSON.stringify(engine.props.map(x => x.level)));
check('M9 : en-tête CSV V2.23 avec colonne Tiers (10 colonnes)', JSON.stringify(engine.csv.header) === JSON.stringify(engine.csv.columns) && engine.csv.columns.length === 10 && engine.csv.columns.includes('Tiers'), JSON.stringify(engine.csv.header));
check('M10 : le tiers connu est exporté sur la ligne EDF', /edf/i.test(engine.csv.edfTiers || ''), String(engine.csv.edfTiers));
check('M11 : décimales en virgule pour Excel (45,9 et non 45.9)', engine.csv.edfDebit === '45,9', String(engine.csv.edfDebit));
check('M12 : tiers vide quand il n’est pas identifiable (jamais inventé)', engine.csv.noTiersCell === '' && engine.csv.noTiersAccount === '421000', JSON.stringify([engine.csv.noTiersCell, engine.csv.noTiersAccount]));
check('M13 : le journal est équilibré (débit = crédit)', engine.csv.balanced && engine.csv.totalDebit === engine.csv.totalCredit, JSON.stringify([engine.csv.totalDebit, engine.csv.totalCredit]));
check('M14 : l’opération non reconnue est signalée dans les anomalies, pas exportée en silence', engine.csv.problems.some(x => /INCONNUE|aucune contrepartie|à vérifier/i.test(x)), JSON.stringify(engine.csv.problems).slice(0, 150));
check('M15 : la génération du journal ne modifie jamais les données du relevé', engine.csv.untouched === true);

// ═══════════════════ PARCOURS UI : mémorisation contrôlée ═══════════════════
const docId = await p.evaluate(async () => {
  const P = window.ScanPro.Precompta; localStorage.removeItem(P.LEARNED_KEY);
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'v223-1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Releve fictif V223', pages: [pg], source: 'scan' });
  d.acc = { at: Date.now(), edited: false, data: { docType: 'releve_bancaire', kind: 'bank', fields: {}, transactions: [
    { date: '02/10/2026', label: 'PRLV FOURNISSEUR ABC FAC N 88', debit: 450, credit: null },
    { date: '03/10/2026', label: 'OPERATION INCONNUE XYZ 99', debit: 77, credit: null },
    { date: '04/10/2026', label: 'CB BOULANGERIE DU PORT', debit: 12.4, credit: null }
  ], totals: { debit: 539.4, credit: 0, count: 3 }, controls: [], disclaimer: '' } };
  await window.ScanPro.Repo.update(d);
  return d.id;
});
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator(`[data-act="acc-select"][data-id="${docId}"]`).first().click(); await p.waitForTimeout(700);

// Synthèse de tri affichée dans l'interface
const body0 = await p.locator('body').innerText();
check('U1 : l’écran affiche les trois catégories de tri avec leurs comptages', /Fiables \(/.test(body0) && /Incertaines \(/.test(body0) && /Non reconnues \(/.test(body0));
check('U2 : le niveau verbal de confiance est affiché sur les propositions', /niveau (élevé|moyen|faible)/.test(body0));
await p.locator('[data-act="acc-triage"][data-f="non-reconnues"]').click(); await p.waitForTimeout(500);
const filtered = await p.evaluate(() => {
  const heads = [...document.querySelectorAll('h4')].filter(h => /Propositions comptables/.test(h.textContent));
  if (!heads.length) return '';
  let node = heads[heads.length - 1].nextElementSibling, block = null;
  while (node) { if (node.classList && node.classList.contains('acc-lines')) { block = node; break; } node = node.nextElementSibling; }
  return block ? block.innerText : '';
});
check('U3 : le filtre « Non reconnues » montre les opérations sans compte et exclut les fiables', /INCONNUE XYZ/.test(filtered) && /BOULANGERIE/.test(filtered) && !/FOURNISSEUR ABC/.test(filtered), filtered.slice(0, 120));
await p.locator('[data-act="acc-triage"][data-f="all"]').click(); await p.waitForTimeout(500);

// Cas 1 : correction puis ENREGISTRER SANS MÉMORISER (compte différent de la proposition auto 401000)
await p.locator('[data-acc-tx="0:account"]').fill('606300');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(700);
const sheet1 = await p.locator('.sheet').innerText();
check('U4 : une fiche affiche la règle candidate AVANT mémorisation (bénéficiaire, sens, nature, compte)', /Mémoriser une règle/.test(sheet1) && sheet1.includes('606300') && /Bénéficiaire/.test(sheet1) && /sens/.test(sheet1) && /nature/.test(sheet1), sheet1.slice(0, 120));
await p.locator('.sheet [data-act="acc-save-no-memo"]').click(); await p.waitForTimeout(800);
const afterNoMemo = await p.evaluate(async (id) => {
  const full = await window.ScanPro.Repo.doc(id);
  return { account: full.acc.data.transactions[0].account, rules: window.ScanPro.Precompta.learnedRules().length };
}, docId);
check('U5 : « sans mémoriser » enregistre quand même le compte mais ne crée aucune règle', afterNoMemo.account === '606300' && afterNoMemo.rules === 0, JSON.stringify(afterNoMemo));

// Cas 2 : autre correction puis ENREGISTRER ET MÉMORISER
await p.locator(`[data-act="acc-select"][data-id="${docId}"]`).first().click(); await p.waitForTimeout(600);
await p.locator('[data-acc-tx="1:account"]').fill('626000');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(700);
await p.locator('.sheet [data-act="acc-save-memo"]').click(); await p.waitForTimeout(800);
const afterMemo = await p.evaluate(() => window.ScanPro.Precompta.learnedRules().map(r => ({ account: r.account, tokens: r.tokens, direction: r.direction })));
// La fiche repropose aussi la correction 606300 non mémorisée précédemment : les deux règles sont donc créées.
check('U6 : « enregistrer et mémoriser » crée les règles affichées (compte, bénéficiaire, sens)', afterMemo.length === 2 && afterMemo.some(r => r.account === '626000' && r.direction === 'sortie' && r.tokens.includes('xyz')) && afterMemo.some(r => r.account === '606300' && r.tokens.includes('abc')), JSON.stringify(afterMemo));

// Cas 3 : ANNULATION de la fiche = aucun effet persistant
await p.locator(`[data-act="acc-select"][data-id="${docId}"]`).first().click(); await p.waitForTimeout(600);
await p.locator('[data-acc-tx="2:account"]').fill('606300');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(700);
check('U7 : la fiche propose bien une annulation', (await p.locator('.sheet .btn.ghost').count()) >= 1);
await p.locator('.sheet .btn.ghost').first().click(); await p.waitForTimeout(500);
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
const afterCancel = await p.evaluate(async (id) => {
  const full = await window.ScanPro.Repo.doc(id);
  return { account2: full.acc.data.transactions[2].account || null, rules: window.ScanPro.Precompta.learnedRules().length, account0: full.acc.data.transactions[0].account };
}, docId);
check('U8 : après annulation et rechargement, la correction n’est pas persistée et les règles précédentes restent intactes', afterCancel.account2 === null && afterCancel.rules === 2 && afterCancel.account0 === '606300', JSON.stringify(afterCancel));

// ═══════════════════ Parcours : acceptation d'une suggestion (mémorisation également choisie) ═══════════════════
const suggDocId = await p.evaluate(async () => {
  const P = window.ScanPro.Precompta; localStorage.removeItem(P.LEARNED_KEY);
  P.learnFromLabel('Vir Inst vers Karim Benali', '421000', { direction: 'sortie', nature: 'salaire' });
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'v223-2', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Releve fictif suggestions V223', pages: [pg], source: 'scan' });
  d.acc = { at: Date.now(), edited: false, data: { docType: 'releve_bancaire', kind: 'bank', fields: {}, transactions: [
    { date: '05/10/2026', label: 'Virement Web Karim Benali', debit: 100, credit: null }
  ], totals: { debit: 100, credit: 0, count: 1 }, controls: [], disclaimer: '' } };
  await window.ScanPro.Repo.update(d);
  return d.id;
});
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator(`[data-act="acc-select"][data-id="${suggDocId}"]`).first().click(); await p.waitForTimeout(700);
const suggBtn = p.locator('[data-act="acc-accept-suggestion"]').first();
check('U9 : l’opération incertaine présente un bouton d’acceptation de suggestion (et non une affectation automatique)', await suggBtn.count() === 1);
await suggBtn.click(); await p.waitForTimeout(700);
const sheet2 = await p.locator('.sheet').innerText();
check('U10 : l’acceptation affiche l’aperçu de règle avant mémorisation', /Mémoriser cette règle/.test(sheet2) && sheet2.includes('421000'), sheet2.slice(0, 100));
await p.locator('.sheet [data-act="acc-sugg-no-memo"]').click(); await p.waitForTimeout(700);
const afterSugg = await p.evaluate(async (id) => {
  const full = await window.ScanPro.Repo.doc(id);
  return { account: full.acc.data.transactions[0].account, rules: window.ScanPro.Precompta.learnedRules().length };
}, suggDocId);
check('U11 : l’affectation est conservée sans nouvelle règle (choix explicite respecté)', afterSugg.account === '421000' && afterSugg.rules === 1, JSON.stringify(afterSugg));

check('U12 : aucune erreur JavaScript pendant tout le parcours', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n===== V2.23 ASSISTANT COMPTABLE : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
