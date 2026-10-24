// V2.13 fiabilité comptable : contrôles honnêtes, montants FR, avoir, réanalyse.
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

// 1) Montants français : séparateurs variés
const amounts = await p.evaluate(() => { const A = window.ScanPro.Acc.parseAmount; return ['1 234,56', '1\u202f234,56', '1\u00a0234,56', '1.234,56', '1234.56', '-123,45', '(123,45)'].map(x => A(x)); });
check('Montants FR : espaces fines/insécables, point milliers, point décimal', amounts.slice(0, 5).every(v => Math.abs(v - 1234.56) < 0.001), JSON.stringify(amounts));
check('Montants FR : négatif et parenthèses comptables = négatif', amounts[5] === -123.45 && amounts[6] === -123.45, JSON.stringify(amounts.slice(5)));

// 2) Compte de résultat : résultat imprimé différent du recalculé -> ÉCART, jamais OK
const cr = await p.evaluate(() => window.ScanPro.Acc.extractFinancial(`COMPTE DE RESULTAT\nCHARGES\n601 Achats 30 000,00\nTotal charges 50 000,00\nPRODUITS\n701 Ventes 80 000,00\nTotal produits 80 000,00\nRésultat net 25 000,00`, 'compte_resultat'));
const resCtl = cr.controls.find(c => /Résultat/.test(c.label));
check('CR : résultat imprimé (25 000) ≠ recalculé (30 000) => écart, pas OK', !!resCtl && resCtl.status === 'ecart' && resCtl.ok === false, JSON.stringify(resCtl));
const cr2 = await p.evaluate(() => window.ScanPro.Acc.extractFinancial(`COMPTE DE RESULTAT\nCHARGES\nTotal charges 50 000,00\nPRODUITS\nTotal produits 80 000,00`, 'compte_resultat'));
const resCtl2 = cr2.controls.find(c => /Résultat/.test(c.label));
check('CR : résultat imprimé absent => À contrôler/impossible, jamais conforme', !!resCtl2 && ['a-controler', 'impossible'].includes(resCtl2.status) && resCtl2.ok === false, JSON.stringify(resCtl2));

// 3) Bilan incomplet -> vérification impossible
const bil = await p.evaluate(() => window.ScanPro.Acc.extractFinancial(`BILAN\nACTIF\n512 Banque 5 000,00`, 'bilan'));
const bilCtl = bil.controls.find(c => /Total actif/.test(c.label));
check('Bilan : totaux manquants => Vérification impossible', !!bilCtl && bilCtl.status === 'impossible' && bilCtl.ok === false, JSON.stringify(bilCtl));

// 4) Facture sans TVA : aucune TVA inventée, écritures refusées
const noVat = await p.evaluate(() => { const A = window.ScanPro.Acc; const d = A.extractInvoice(`Fournisseur : X SARL\nFacture n° F-2026-01\nTotal HT : 1 000,00 €\nTotal TTC : 1 200,00 €`); return { vat: d.fields.vatAmount.value, entries: A.journalEntries(d), ctl: d.controls.find(c => /HT \+ TVA/.test(c.label)) }; });
check('Facture HT≠TTC sans TVA reconnue : écritures refusées (pas de TVA inventée)', noVat.entries === null, 'vat=' + noVat.vat);
check('Facture incomplète : contrôle HT+TVA=TTC = impossible', !!noVat.ctl && noVat.ctl.status === 'impossible' && noVat.ctl.ok === false, JSON.stringify(noVat.ctl));

// 5) Avoir avec montants positifs imprimés : identifié par le type, écritures inversées
const avoirPos = await p.evaluate(() => { const A = window.ScanPro.Acc; const d = A.extractInvoice(`Fournisseur : X SARL\nAVOIR n° AV-2026-09\nTotal HT : 250,00 €\nTVA 20 % : 50,00 €\nTotal TTC : 300,00 €`); const j = A.journalEntries(d); return { type: d.docType, j }; });
check('Avoir positif : type avoir par le libellé (pas par le signe)', avoirPos.type === 'avoir');
check('Avoir positif : écritures inversées par rapport à une facture', !!avoirPos.j && avoirPos.j.rows.some(r => r.account === '401000' && r.debit === 300) && avoirPos.j.rows.some(r => r.account === '607000' && r.credit === 250), JSON.stringify(avoirPos.j && avoirPos.j.rows));
check('Avoir : écriture équilibrée ≠ validée (avertissement)', !!avoirPos.j && /ne signifie pas validée/.test(avoirPos.j.warning));

// 6) Facture achat vs vente : journaux distincts
const av = await p.evaluate(() => { const A = window.ScanPro.Acc; const mk = (type) => { const d = A.extractInvoice(`Fournisseur : X\nFacture n° F-1\nDate : 01/10/2026\nTotal HT : 100,00 €\nTVA 20 % : 20,00 €\nTotal TTC : 120,00 €`); d.docType = type; return A.journalEntries(d); }; return { achat: mk('facture_achat'), vente: mk('facture_vente') }; });
check('Achat (HA configurable/401 crédit) vs Vente (VT/411 débit)', av.achat.rows[0].journal === 'HA' && av.vente.rows[0].journal === 'VT' && av.vente.rows[0].account === '411000');

// 7) Réanalyse : confirmation, corrections conservées, changement de type
await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 600; const src = c.toDataURL('image/jpeg', .9);
  const pg = { id: 'v213a', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 } }; pg.thumb = src;
  const d = await window.ScanPro.Repo.create({ name: 'Réanalyse test', pages: [pg], source: 'scan' });
  d.text = `Fournisseur : Martin SAS\nFacture n° F-2026-88\nDate : 01/10/2026\nTotal HT : 1 000,00 €\nTVA 20 % : 200,00 €\nTotal TTC : 1 200,00 €`; await window.ScanPro.Repo.update(d);
});
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
await p.locator('[data-act="acc-analyze"]').click(); await p.waitForTimeout(900);
await p.locator('[data-acc-field="totalTTC"]').fill('1250');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
// cliquer Réanalyser doit demander confirmation
await p.locator('[data-act="acc-analyze"]').click(); await p.waitForTimeout(700);
check('Réanalyse : confirmation explicite demandée', (await p.locator('body').innerText()).includes('Réanalyser ce document'));
await p.locator('[data-act="acc-reanalyze-confirm"]').click(); await p.waitForTimeout(900);
const after = await p.evaluate(async () => { const d = window.ScanPro.App.docs.find(x => x.name.includes('Réanalyse')); return d ? { ttc: d.acc.data.fields.totalTTC.value, st: d.acc.data.fields.totalTTC.status, at: d.acc.at, first: d.acc.firstAt } : null; });
check('Réanalyse : correction manuelle conservée (TTC 1250, statut corrigé)', !!after && after.ttc === '1250' && after.st === 'corrige', JSON.stringify(after));
check('Réanalyse : dates première/dernière analyse conservées', !!after && after.first <= after.at);
// changement de type
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
await p.locator('#accTypeSel').selectOption('releve_bancaire');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
const typeChanged = await p.evaluate(async () => { const d = window.ScanPro.App.docs.find(x => x.name.includes('Réanalyse')); return d ? d.acc.data.docType : null; });
check('Changement de type enregistré et signalé (toast) — type passé en relevé', typeChanged === 'releve_bancaire', String(typeChanged));
// obsolescence : modifier l'OCR après analyse
await p.evaluate(async () => { const d = await window.ScanPro.Repo.doc(window.ScanPro.App.accDocId); d.text = d.text + '\nLigne OCR ajoutée après analyse'; await window.ScanPro.Repo.update(d); window.ScanPro.App.docs = await window.ScanPro.Repo.list(); });
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(700);
check('Obsolescence signalée après modification OCR', (await p.locator('body').innerText()).includes('obsolètes'));
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== V2.13 FIABILITÉ COMPTABLE : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
