// V2.15 : espace de pré-comptabilité — plan configurable, journaux, tiers, TVA, validation.
import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html'; const OUT = '/home/user/scanpro/tests/out';
fs.mkdirSync(OUT, { recursive: true });
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR', acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(() => {});
await p.evaluate(() => localStorage.clear());

const FAC = `Fournisseur : Martin SAS\nSIRET : 12345678900012\nFacture n° F-2026-88\nDate : 01/10/2026\nPrestation 2 x 500,00 = 1 000,00\nTotal HT : 1 000,00 €\nTVA 20 % : 200,00 €\nTotal TTC : 1 200,00 €`;

// 1) Comptes NON figés : règles modifiées -> écritures modifiées
const custom = await p.evaluate((txt) => {
  const S = window.ScanPro;
  const d = S.Acc.extractInvoice(txt);
  const def = S.Acc.journalEntries(d, { name: 'Facture test' });
  const R = S.Precompta.rules(); R.achatCharge = '601000'; R.fournisseur = '401000'; S.Precompta.saveRules(R);
  const cust = S.Acc.journalEntries(d, { name: 'Facture test' });
  return { defCharge: def.rows[0].account, custCharge: cust.rows[0].account, journal: cust.rows[0].journal, piece: cust.rows[0].piece, tiers: cust.rows[0].tiers, source: cust.rows[0].source, status: cust.rows[0].status, issues: S.Precompta.validateEntries(cust, d) };
}, FAC);
check('Plan configurable : défaut PCG 607000 proposé', custom.defCharge === '607000', custom.defCharge);
check('Plan configurable : règle modifiée -> compte 601000 utilisé (rien de figé)', custom.custCharge === '601000', custom.custCharge);
check('Écriture enrichie : journal/pièce/tiers/source/statut présents', custom.journal === 'HA' && custom.piece === 'F-2026-88' && /Martin/.test(custom.tiers) && custom.source === 'Facture test' && /non validée/.test(custom.status), JSON.stringify(custom));
check('Validation écriture conforme : aucun point ouvert', custom.issues.length === 0, custom.issues.join('|'));

// 2) Contrôles d'écritures : déséquilibre, date, compte inconnu/inactif, débit+crédit
const ctl = await p.evaluate(() => {
  const S = window.ScanPro; const base = { date: '01/10/2026', journal: 'HA', piece: 'F-1', account: '601000', debit: 100, credit: 0 };
  const bad = { rows: [base, { ...base, account: '999999', debit: 10, credit: 10, date: '32/13/2026' }], balanced: false, totalDebit: 110, totalCredit: 10 };
  const issues = S.Precompta.validateEntries(bad, {});
  const c = S.Precompta.chart(); c.find(a => a.num === '601000').active = false; S.Precompta.saveChart(c);
  const inactive = S.Precompta.validateEntries({ rows: [base], balanced: true, totalDebit: 100, totalCredit: 100 }, {});
  return { issues, inactive };
});
check('Contrôles : écriture déséquilibrée détectée', ctl.issues.some(i => /déséquilibrée/.test(i)), ctl.issues.join('|'));
check('Contrôles : date invalide + compte absent + débit/crédit simultanés détectés', ctl.issues.some(i => /date/.test(i)) && ctl.issues.some(i => /absent du plan/.test(i)) && ctl.issues.some(i => /simultanés/.test(i)));
check('Contrôles : compte inactif signalé', ctl.inactive.some(i => /inactif/.test(i)), ctl.inactive.join('|'));
await p.evaluate(() => localStorage.clear());

// 3) TVA : multi-taux, sans TVA, avoir
const vat = await p.evaluate(() => {
  const S = window.ScanPro;
  const multi = S.Acc.extractInvoice(`Fournisseur : Bio SARL\nFacture n° F-2\nDate : 02/10/2026\nTotal HT : 1 000,00 €\nTVA 20 % : 100,00 €\nTVA 10 % : 50,00 €\nTotal TTC : 1 150,00 €`);
  const jm = S.Acc.journalEntries(multi, { name: 'F-2' });
  const noVat = S.Acc.extractInvoice(`Fournisseur : Auto Micro\nFacture n° F-3\nDate : 03/10/2026\nTotal HT : 500,00 €\nTotal TTC : 500,00 €`);
  const jn = S.Acc.journalEntries(noVat, { name: 'F-3' });
  const avoir = S.Acc.extractInvoice(`Fournisseur : Martin SAS\nAVOIR n° AV-9\nDate : 04/10/2026\nTotal HT : 250,00 €\nTVA 20 % : 50,00 €\nTotal TTC : 300,00 €`);
  const ja = S.Acc.journalEntries(avoir, { name: 'AV-9' });
  return { multiVat: multi.vat, multiTvaLines: jm.rows.filter(r => r.account === '445660').length, multiHuman: jm.needsHuman, multiCtl: multi.controls.map(c => c.label + ':' + c.status), noVatCtl: noVat.controls.map(c => c.label + ':' + c.status), noVatLines: jn.rows.length, noVatHuman: jn.needsHuman, avoirFirst: ja.rows[0] };
});
check('TVA multi-taux : ventilation 20 % + 10 % reconnue', vat.multiVat.length === 2 && vat.multiTvaLines === 2, JSON.stringify(vat.multiVat));
check('TVA multi-taux : validation humaine demandée (HT par taux non reconnu)', /plusieurs taux/.test(vat.multiHuman || ''), vat.multiHuman || '');
check('Facture sans TVA : aucun compte TVA, validation humaine régime', vat.noVatLines === 2 && /sans TVA/.test(vat.noVatHuman || '') && vat.noVatCtl.some(x => /sans TVA/.test(x)), JSON.stringify(vat.noVatCtl));
check('Avoir : sens inversé via le plan configurable', vat.avoirFirst.credit === 250 || vat.avoirFirst.debit === 0, JSON.stringify(vat.avoirFirst));

// 4) UI : plan, règles, tiers/doublons, validation, historique
await p.evaluate(async () => {
  const mk = async (name, supplier, siret) => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 560; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 560);
    const src = c.toDataURL('image/jpeg', .9);
    const pg = { id: 'v215' + Math.random().toString(36).slice(2, 6), src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } };
    pg.thumb = await window.ScanPro.ImageOps.thumb(src);
    const d = await window.ScanPro.Repo.create({ name, pages: [pg], source: 'scan' });
    d.text = 'x';
    const F = (v) => ({ value: v || 'Non reconnu', confidence: v ? 85 : 0, status: v ? 'reconnu' : 'non-reconnu', page: 0, zone: null });
    d.acc = { at: Date.now(), data: { docType: 'facture_achat', fields: { supplier: F(supplier), siret: F(siret), invoiceNumber: F('F-1'), issueDate: F('01/10/2026'), totalHT: F('1000'), vatAmount: F('200'), totalTTC: F('1200') }, controls: [], lines: [], vat: [{ rate: 20, amount: 200 }] } };
    await window.ScanPro.Repo.update(d);
  };
  await mk('Facture Martin', 'Martin SAS', '12345678900012');
  await mk('Facture Martin doublon', 'Martin SAS Distribution', '12345678900012');
});
await p.evaluate(async () => { window.ScanPro.App.docs = await window.ScanPro.Repo.list(); });
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(900);
await p.locator('details.card summary').first().click(); await p.locator('details.card summary').nth(1).click(); await p.waitForTimeout(300);
let body = await p.locator('body').innerText();
check('UI : espace pré-comptabilité (plan + tiers) affiché', body.includes('Plan comptable du dossier') && body.includes('Tiers (fournisseurs / clients)'));
check('UI : doublon potentiel détecté (même SIRET)', body.includes('Doublons potentiels') && body.includes('même SIRET'), '');
check('UI : tiers sans identité inventée (compte associé affiché)', body.includes('Compte associé : 401000'));
await p.locator('[data-act="pc-rules"]').click(); await p.waitForTimeout(500);
check('UI : feuille des règles de proposition ouverte', (await p.locator('body').innerText()).includes('Règles de proposition du dossier'));
await p.locator('#pcr-achatCharge').selectOption('601000');
await p.locator('[data-act="pc-rules-save"]').click(); await p.waitForTimeout(600);
const ruleSaved = await p.evaluate(() => window.ScanPro.Precompta.rules().achatCharge);
check('UI : règle enregistrée (601000) et persistée localement', ruleSaved === '601000', ruleSaved);
// Sélection du document et validation explicite
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(900);
body = await p.locator('body').innerText();
check('UI : bloc Validation comptable (proposée, non validée)', body.includes('Validation comptable') && body.includes('proposée (non validée)'));
await p.locator('[data-act="acc-validate"]').click(); await p.waitForTimeout(800);
body = await p.locator('body').innerText();
check('UI : validation explicite enregistrée', /Statut : validée/.test(body));
// Correction + historique
const ttcInput = p.locator('[data-acc-field="totalTTC"]');
await ttcInput.fill('1250'); await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
body = await p.locator('body').innerText();
check('UI : historique des corrections (ancienne → nouvelle valeur)', body.includes('Historique des corrections') && body.includes('1200') && body.includes('1250'));
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.15 PRÉ-COMPTABILITÉ : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close();
process.exit(ko.length ? 1 : 0);
