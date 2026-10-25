// V2.22 — Fiabilité des relevés bancaires réels (PDF fictifs générés, 100 % données inventées).
// Couvre : extraction date/libellé/montant/sens, débit vs crédit vs solde, montants mal alignés,
// doublons, lignes incomplètes, libellé multi-ligne, multipage, totaux non silencieux, et le
// parcours d'importation PDF complet de l'UI (texte natif pdf.js, sans OCR Tesseract).
import { chromium, devices } from 'playwright';
import fs from 'fs';
import path from 'path';
import { buildPdf, normalLines, hardLines, multipageLines, bnpLines, bnpSpacedLines } from './helpers/fake-releve.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const OUT = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const ok = [], ko = [];
const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };

// Génération des PDF fictifs sur le serveur local (dossier servi, non versionné)
for (const [name, lines, pages] of [['normal', normalLines(), 1], ['hard', hardLines(), 1], ['multi', multipageLines(), 2], ['bnp', bnpLines(), 1], ['bnp2', bnpSpacedLines(), 1]]) {
  fs.writeFileSync(path.join(OUT, 'releve-' + name + '.pdf'), await buildPdf(lines, { pages }));
}

const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 800 }, locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
await p.goto(APP, { waitUntil: 'load', timeout: 60000 });
await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});
await p.evaluate(async () => {
  localStorage.clear();
  const Repo = window.ScanPro.Repo;
  for (const d of await Repo.list()) await Repo.remove(d.id);
});

const extract = async (name) => p.evaluate(async (name) => {
  const resp = await fetch('/tests/out/releve-' + name + '.pdf');
  const file = new File([await resp.blob()], 'releve-' + name + '.pdf', { type: 'application/pdf' });
  const native = await window.ScanPro.PDF.extractText(file);
  const text = native.map(pg => pg.text).join('\n');
  const data = window.ScanPro.Acc.extractBank(text, native.map(pg => pg.words));
  return { pages: native.length, data };
}, name);

// ═════════════ NIVEAU MOTEUR — relevé nominal ═════════════
const normal = await extract('normal');
const ntx = normal.data.transactions;
check('N1 : toutes les opérations sont extraites (7)', ntx.length === 7, String(ntx.length));
check('N2 : dates et libellés conservés à l’identique', ntx[1].date === '02/10' && /EDF ENERGIE/.test(ntx[1].label), ntx[1].label);
check('N3 : débits et crédits jamais inversés (débit 89,10 / crédit salaire 1500)', ntx[1].debit === 89.10 && ntx[1].credit === null && ntx[3].credit === 1500 && ntx[3].debit === null, JSON.stringify([ntx[1], ntx[3]].map(t => [t.debit, t.credit])));
check('N4 : les soldes ligne à ligne sont conservés', ntx[1].balance === 910.9 && ntx[6].balance === 2935.41, JSON.stringify(ntx.map(t => t.balance)));
check('N5 : totaux cohérents (débit 264,59 / crédit 2200)', normal.data.totals.debit === 264.59 && normal.data.totals.credit === 2200, JSON.stringify(normal.data.totals));
check('N6 : les trois contrôles de cohérence sont conformes', normal.data.controls.every(c => c.ok !== false), JSON.stringify(normal.data.controls.map(c => c.label)));
check('N7 : aucune opération laissée « à vérifier » sur le relevé nominal', ntx.every(t => t.status !== 'a-verifier'), JSON.stringify(ntx.map(t => t.status)));

// ═════════════ NIVEAU MOTEUR — relevé difficile ═════════════
const hard = await extract('hard');
const htx = hard.data.transactions;
check('H1 : doublon strict détecté (même date/libellé/montant)', htx.filter(t => t.duplicate).length === 1 && htx[2].duplicate === true, JSON.stringify(htx.map(t => !!t.duplicate)));
const ambigu = htx.find(t => /AMBIGU/.test(t.label));
check('H2 : montant à la frontière débit/crédit laissé NON affecté (pas de sens deviné)', ambigu && ambigu.debit === null && ambigu.credit === null && ambigu.status === 'a-verifier', JSON.stringify([ambigu?.debit, ambigu?.credit, ambigu?.status]));
check('H3 : la valeur brute du montant ambigu reste lisible dans la source (contrôle conservé)', ambigu && /9,99/.test(ambigu.source || ''), ambigu?.source);
check('H4 : le montant ambigu n’entre pas silencieusement dans les totaux', hard.data.totals.debit === 240 && hard.data.totals.credit === 75, JSON.stringify(hard.data.totals));
check('H5 : ligne de continuation rattachée au libellé de l’opération précédente', /FOURNISSEUR ABC/.test(htx.find(t => /FACTURE N 2026-44/.test(t.label))?.label || ''), htx.map(t => t.label).join(' | '));
const incomplete = htx.find(t => /SANS MONTANT/.test(t.label));
check('H6 : ligne incomplète conservée, sans montant inventé', incomplete && incomplete.debit === null && incomplete.credit === null && incomplete.balance === null, JSON.stringify(incomplete));
check('H7 : un écart est signalé dans les contrôles (opérations à vérifier)', hard.data.controls.some(c => c.ok === false), JSON.stringify(hard.data.controls.map(c => c.label + (c.ok ? '' : ' [écart]'))));
const abo = htx.find(t => /FOURNISSEUR ABC/.test(t.label));
check('H8 : débit normalement aligné toujours bien affecté (120,00)', abo && abo.debit === 120 && abo.status === 'reconnu', JSON.stringify([abo?.debit, abo?.status]));

// ═════════════ NIVEAU MOTEUR — multipage ═════════════
const multi = await extract('multi');
const mtx = multi.data.transactions;
check('M1 : opérations des deux pages extraites (5)', mtx.length === 5, String(mtx.length));
check('M2 : page d’origine correcte (0 puis 1)', mtx[0].page === 0 && mtx[3].page === 1 && mtx[4].page === 1, JSON.stringify(mtx.map(t => t.page)));
check('M3 : aucun en-tête de page 2 n’a fuité dans un libellé', mtx.every(t => !/BANQUE FICTIVE DU SUD|page 2\/2/.test(t.label) || /SOLDE INITIAL/.test(t.label) === false && !/RELEVE MULTIPAGE/.test(t.label)), mtx.map(t => t.label).join(' | '));
check('M4 : contrôles de cohérence conformes en multipage', multi.data.controls.every(c => c.ok !== false), JSON.stringify(multi.data.controls.map(c => c.label)));

// ═════════════ NIVEAU MOTEUR — format BNP (soldes « SOLDE CREDITEUR/DEBITEUR AU », pied de page) ═════════════
const bnp = await extract('bnp');
const btx = bnp.data.transactions;
check('B1 : 3 vraies opérations extraites — les lignes SOLDE et le pied de page Page 1/4 ne créent pas de transaction', btx.length === 3, String(btx.length));
check('B2 : aucune transaction fantôme issue du pied de page (date 1/4)', btx.every(t => !/^1\/4$/.test(t.date) && !/page/i.test(t.label)), btx.map(t => t.date + ':' + t.label).join(' | '));
check('B3 : débits et crédits BNP correctement orientés (60,00 + 40,00 débit ; 1500 crédit)', btx[0].debit === 60 && btx[1].debit === 40 && btx[2].credit === 1500 && btx[2].debit === null, JSON.stringify(btx.map(t => [t.debit, t.credit])));
check('B4 : aucun solde de ligne (format BNP sans colonne solde) et totaux exacts', btx.every(t => t.balance == null) && bnp.data.totals.debit === 100 && bnp.data.totals.credit === 1500, JSON.stringify(bnp.data.totals));
check('B5 : solde d’ouverture et de clôture reconnus via le libellé créditeur (500,00 → 1900,00)', bnp.data.fields.openingBalance.value === '500' && bnp.data.fields.closingBalance.value === '1900', JSON.stringify([bnp.data.fields.openingBalance, bnp.data.fields.closingBalance]));
const recon = bnp.data.controls.find(c => /ouverture/i.test(c.label));
check('B6 : le contrôle de rapprochement devient POSSIBLE et conforme (500 + 1500 − 100 = 1900)', recon && recon.ok === true && recon.status === 'conforme', JSON.stringify(recon));
check('B7 : pas de contrôle écart ni « à vérifier » sur ce relevé cohérent', bnp.data.controls.every(c => c.status === 'conforme' || c.status === 'impossible') && btx.every(t => t.status !== 'a-verifier'), JSON.stringify(bnp.data.controls.map(c => c.status)));
// Solde débiteur (texte synthétique 100 % fictif) : signe négatif respecté, jamais présenté en positif
const deb = await p.evaluate(() => {
  const text = ['SOLDE DEBITEUR AU 01.10.26 250,00', '02.10  PRLV SEPA FOURNISSEUR FICTIF  30,00', 'SOLDE DEBITEUR AU 31.10.26 280,00'].join('\n');
  const d = window.ScanPro.Acc.extractBank(text, []);
  return { open: d.fields.openingBalance.value, close: d.fields.closingBalance.value, status: d.controls.map(c => c.status) };
});
check('B8 : solde débiteur reconnu comme négatif à l’ouverture comme à la clôture', deb.open === '-250' && deb.close === '-280', JSON.stringify(deb));

// Variante glyphes fragmentés ('SOLDE C REDITEUR AU', 'Page 1 / 4')
const bnp2 = await extract('bnp2');
const b2tx = bnp2.data.transactions;
const recon2 = bnp2.data.controls.find(c => /ouverture/i.test(c.label));
check('B9 : glyphes espacés — 3 opérations sans transaction fantôme', b2tx.length === 3 && b2tx.every(t => !/^1\/4$/.test(t.date)), String(b2tx.length));
check('B10 : glyphes espacés — soldes et rapprochement néanmoins reconnus et conformes', bnp2.data.fields.openingBalance.value === '500' && bnp2.data.fields.closingBalance.value === '1900' && recon2 && recon2.status === 'conforme', JSON.stringify([bnp2.data.fields.openingBalance.value, bnp2.data.fields.closingBalance.value, recon2 && recon2.status]));

// ═════════════ PARCOURS UI COMPLET — import PDF → texte natif → analyse comptable ═════════════
const fileChooser = p.waitForEvent('filechooser', { timeout: 15000 });
await p.locator('[data-act="import-pdf"]').first().click();
(await fileChooser).setFiles(path.join(OUT, 'releve-normal.pdf'));
await p.waitForSelector('#editorScreen, .doc-detail, [data-act="doc-ocr"]', { timeout: 30000 });
await p.waitForTimeout(1200);
await p.locator('[data-act="doc-ocr"]').first().click();
await p.waitForFunction(() => { const d = window.ScanPro.App.docs.find(x => /releve-normal/i.test(x.name)); return d && d.text && /PRLV SEPA EDF/.test(d.text); }, { timeout: 60000 });
const importedName = await p.evaluate(() => window.ScanPro.App.docs.find(x => /releve-normal/i.test(x.name)).name);
check('UI1 : PDF importé et texte natif extrait sans OCR Tesseract', /releve-normal/i.test(importedName), importedName);
await p.evaluate(() => { const d = window.ScanPro.App.docs.find(x => /releve-normal/i.test(x.name)); window.ScanPro.App.accDocId = d.id; });
await p.evaluate(() => window.ScanPro.Actions['acc-analyze']({ dataset: {} }));
await p.waitForTimeout(1200);
const uiData = await p.evaluate(async () => {
  const d = await window.ScanPro.Repo.doc(window.ScanPro.App.accDocId);
  return {
    type: d.acc && d.acc.data.docType,
    count: d.acc && d.acc.data.transactions.length,
    sample: d.acc && d.acc.data.transactions[1] && { label: d.acc.data.transactions[1].label, debit: d.acc.data.transactions[1].debit },
    source: d.ocrSource || ''
  };
});
check('UI2 : analyse comptable du PDF importé (type relevé, 7 opérations)', uiData.type === 'releve_bancaire' && uiData.count === 7, JSON.stringify(uiData));
check('UI3 : la source indique le texte natif du PDF', /natif/i.test(uiData.source), uiData.source);

// ═════════════ VUE « À VÉRIFIER » — regroupements et origine des propositions ═════════════
const vue = await p.evaluate(() => {
  const d = window.ScanPro.App.docs.find(x => /releve-normal/i.test(x.name));
  const doc = window.ScanPro.App.docs;
  const g = window.ScanPro.Acc.bankGroups(d.acc ? d.acc.data : doc);
  const props = window.ScanPro.Acc.bankProposals(d.acc.data);
  return {
    total: g.total, remaining: g.remaining, validated: g.validated,
    groups: g.groups.map(x => ({ tiers: x.tiers, n: x.indexes.length, account: x.account, level: x.confLevel, origin: x.origin })),
    origins: [...new Set(props.map(x => x.origin).filter(Boolean))],
    everyHasReason: props.every(x => x.explanation && x.explanation.length > 5)
  };
});
check('V1 : la vue expose le total et le reste à traiter', vue.total === 7 && typeof vue.remaining === 'number', JSON.stringify({ total: vue.total, remaining: vue.remaining }));
check('V2 : des groupes similaires existent avec compte, effectif et confiance', vue.groups.some(g => g.n >= 1 && g.account && g.level), JSON.stringify(vue.groups));
check('V3 : chaque proposition affiche une origine (règle dossier / apprentissage / affectation)', vue.origins.length >= 1 && vue.everyHasReason, JSON.stringify(vue.origins));

check('Aucune erreur JavaScript pendant tout le parcours', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n===== V2.22 RELEVES FIXTIFS : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close();
process.exit(ko.length ? 1 : 0);
