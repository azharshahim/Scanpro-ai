// Livraison 2 Comptabilité : extraction structurée champ par champ + parcours UI.
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

// ---- Mesures champ par champ sur l'extracteur réel (textes fictifs, OCR parfait simulé)
const bench = await p.evaluate(() => {
  const Acc = window.ScanPro.Acc;
  const cas = {
    simple: `Fournisseur : Dupont SARL\nFacture n° FAC-2026-0142\nDate : 12/10/2026\nÉchéance : 12/11/2026\nSIRET : 812 345 678 00012\nPrestation conseil 10 x 250,00 = 2 500,00\nTotal HT : 2 500,00 €\nTVA 20 % : 500,00 €\nTotal TTC : 3 000,00 €`,
    multi: `Fournisseur : Martin SAS\nFacture n° F-2026-88\nDate : 01/10/2026\nLigne A 10 x 60,00 = 600,00\nLigne B 8 x 50,00 = 400,00\nTotal HT : 1 000,00 €\nTVA 20 % : 120,00 €\nTVA 5,5 % : 22,00 €\nTotal TTC : 1 142,00 €`,
    avoir: `Fournisseur : Martin SAS\nAVOIR n° AV-2026-03\nDate : 02/10/2026\nTotal HT : -250,00 €\nTVA 20 % : -50,00 €\nTotal TTC : -300,00 €`,
    partiel: `Facture\nTotal TTC : 99,99 €\nMerci de votre confiance`
  };
  const out = {}; for (const [k, v] of Object.entries(cas)) out[k] = Acc.extractInvoice(v);
  return out;
});
const F = (c, k) => bench[c].fields[k].value;
check('Facture simple : fournisseur labellisé', F('simple', 'supplier') === 'Dupont SARL', F('simple', 'supplier'));
check('Facture simple : numéro FAC-2026-0142', F('simple', 'invoiceNumber') === 'FAC-2026-0142');
check('Facture simple : SIRET 14 chiffres préservé', F('simple', 'siret') === '81234567800012', F('simple', 'siret'));
check('Facture simple : SIREN déduit du SIRET (9 chiffres)', F('simple', 'siren') === '812345678');
check('Facture simple : montants FR (espaces + virgule)', F('simple', 'totalHT') === '2500' && F('simple', 'totalTTC') === '3000', F('simple', 'totalHT') + '/' + F('simple', 'totalTTC'));
check('Facture simple : ligne d\'article extraite', bench.simple.lines.length === 1 && bench.simple.lines[0].qty === 10 && bench.simple.lines[0].amount === 2500, JSON.stringify(bench.simple.lines));
check('Facture simple : contrôle HT+TVA=TTC OK', bench.simple.controls.some(c => c.ok && /HT \+ TVA/.test(c.label)));
check('Multi-TVA : les 2 taux et montants (C-01)', bench.multi.vat.length === 2 && bench.multi.vat.some(v => v.rate === 5.5 && v.amount === 22), JSON.stringify(bench.multi.vat));
check('Multi-TVA : numéro F-2026-88 reconnu (C-02)', F('multi', 'invoiceNumber').includes('2026'), F('multi', 'invoiceNumber'));
check('Multi-TVA : 2 lignes extraites', bench.multi.lines.length === 2, '' + bench.multi.lines.length);
check('Avoir : type Avoir distingué (C-02)', bench.avoir.docType === 'avoir' && F('avoir', 'docType') === 'Avoir');
check('Avoir : montants négatifs préservés', F('avoir', 'totalTTC') === '-300', F('avoir', 'totalTTC'));
check('Partielle : fournisseur NON inventé (C-03)', F('partiel', 'supplier') === 'Non reconnu', F('partiel', 'supplier'));
check('Partielle : échéance NON devinée (C-04)', F('partiel', 'dueDate') === 'Non reconnu', F('partiel', 'dueDate'));
check('Confiance par champ présente (C-05)', bench.simple.fields.totalTTC.confidence >= 80 && bench.partiel.fields.supplier.confidence === 0);

// ---- Parcours UI espace Comptabilité
check('Onglet Compta dans la navigation', await p.locator('[data-nav="acc"]').count() === 1);
await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 700; c.height = 1000; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 700, 1000); x.fillStyle = '#111'; x.font = '30px Arial'; x.fillText('FACTURE', 60, 100);
  const src = c.toDataURL('image/jpeg', .92);
  const pg = { id: 'compta1', src, crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, quad: null, deskew: 0, filter: 'none', adj: { b: 1, c: 1 },
    ocrWords: [{ t: '3 000,00', c: 96, x: .55, y: .8, w: .2, h: .03 }, { t: 'FAC-2026-0142', c: 93, x: .5, y: .12, w: .25, h: .03 }] };
  pg.thumb = await window.ScanPro.ImageOps.thumb(src);
  const d = await window.ScanPro.Repo.create({ name: 'Facture compta test', pages: [pg], source: 'scan' });
  d.text = `Fournisseur : Dupont SARL\nFacture n° FAC-2026-0142\nDate : 12/10/2026\nÉchéance : 12/11/2026\nSIRET : 812 345 678 00012\nPrestation conseil 10 x 250,00 = 2 500,00\nTotal HT : 2 500,00 €\nTVA 20 % : 500,00 €\nTotal TTC : 3 000,00 €`;
  await window.ScanPro.Repo.update(d);
});
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(700);
check('Vue Comptabilité affichée', (await p.locator('body').innerText()).includes('Comptabilité'));
check('Petit écran 360px sans débordement', await p.evaluate(() => document.documentElement.scrollWidth <= 365), '' + await p.evaluate(() => document.documentElement.scrollWidth));
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
await p.locator('[data-act="acc-analyze"]').click(); await p.waitForTimeout(900);
const uiTxt = await p.locator('body').innerText();
check('Analyse : champs structurés affichés', uiTxt.includes("Date d'échéance") && uiTxt.includes('Lignes'));
check('Analyse : bouton Voir zone (traçabilité)', await p.locator('[data-act="acc-zone"]').count() >= 1, '' + await p.locator('[data-act="acc-zone"]').count());
check('Analyse : contrôle de cohérence affiché', uiTxt.includes('HT + TVA = TTC'));
if (await p.locator('[data-act="acc-zone"]').count()) {
  await p.locator('[data-act="acc-zone"]').first().click(); await p.waitForTimeout(600);
  check('Zone : surlignage affiché sur la page d\'origine', await p.locator('.zone-box').count() === 1);
  await p.locator('.sheet .btn').last().click(); await p.waitForTimeout(300);
}
// correction + persistance
await p.locator('[data-acc-field="totalTTC"]').fill('3100');
await p.locator('[data-act="acc-save"]').click(); await p.waitForTimeout(800);
await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1200);
await p.locator('[data-nav="acc"]').click(); await p.waitForTimeout(600);
const persisted = await p.evaluate(async () => { const docs = window.ScanPro.App.docs; const d = docs.find(x => x.name.includes('compta')); return d && d.acc ? { edited: d.acc.edited, ttc: d.acc.data.fields.totalTTC.value, status: d.acc.data.fields.totalTTC.status } : null; });
check('Corrections persistées après rechargement (C-05)', !!persisted && persisted.edited && persisted.ttc === '3100', JSON.stringify(persisted));
// exports
await p.locator('[data-act="acc-select"]').first().click(); await p.waitForTimeout(500);
for (const fmt of ['csv', 'xlsx', 'json']) {
  const dlp = p.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await p.locator(`[data-act="acc-export"][data-fmt="${fmt}"]`).click();
  const dl = await dlp; if (dl) await dl.saveAs(OUT + '/compta-export.' + fmt);
  check('Export ' + fmt.toUpperCase() + ' produit', !!dl && fs.existsSync(OUT + '/compta-export.' + fmt));
}
const csv = fs.readFileSync(OUT + '/compta-export.csv', 'utf8');
check('CSV structuré : lignes + TVA tabulaires', csv.includes('Description') && csv.includes('Prestation conseil') && csv.includes('Taux TVA'), csv.slice(0, 120).replace(/\n/g, '|'));
check('XLSX OOXML (PK)', fs.readFileSync(OUT + '/compta-export.xlsx').subarray(0, 2).toString() === 'PK');
const js = JSON.parse(fs.readFileSync(OUT + '/compta-export.json', 'utf8'));
check('JSON structuré exporté', js.fields && js.fields.totalTTC && Array.isArray(js.lines));
check('Aucune erreur console', errs.length === 0, errs.slice(0, 2).join('|'));
console.log(`\n===== COMPTABILITÉ L2 : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
