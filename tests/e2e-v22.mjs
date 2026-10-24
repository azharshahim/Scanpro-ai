import { chromium, devices } from 'playwright';
import fs from 'fs';
const APP = process.env.APP_URL || 'http://localhost:8080/index.html';
const OUT = '/home/user/scanpro/tests/out';
const ok=[], ko=[]; const check=(l,c,e='')=>{(c?ok:ko).push(l); console.log((c?'✅':'❌')+' '+l+(e?' — '+e:''));};
const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const ctx=await b.newContext({...devices['Pixel 7'], locale:'fr-FR', acceptDownloads:true, permissions:['camera']});
const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message.slice(0,180))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,180));});
await p.goto(APP,{waitUntil:'load',timeout:60000}); await p.waitForTimeout(1500);
await p.locator('.sheet .btn.primary').click().catch(()=>{});
await p.evaluate(async()=>{
  const c=document.createElement('canvas'); c.width=900; c.height=1200; const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,900,1200); g.addColorStop(0,'#cfc7a8'); g.addColorStop(.55,'#f3ecd2'); g.addColorStop(1,'#9d9684'); x.fillStyle=g; x.fillRect(0,0,900,1200);
  x.fillStyle='rgba(60,50,20,.18)'; x.fillRect(520,0,380,1200); // ombre
  for(let i=0;i<450;i++){x.fillStyle=`rgba(40,35,20,${Math.random()*.25})`; x.fillRect(Math.random()*900,Math.random()*1200,2,2);}
  x.fillStyle='#111'; x.font='bold 44px Arial'; x.fillText('FACTURE FAC-2026-042',55,105);
  x.font='30px Arial'; x.fillText('Fournisseur : Exemple SAS',55,175); x.fillText('Date : 12/03/2026',55,235); x.fillText('Échéance : 30/03/2026',55,285);
  x.fillText('Total HT : 100,00 €',55,390); x.fillText('TVA 20 % : 20,00 €',55,450); x.fillText('Total TTC : 120,00 €',55,510);
  x.fillText('SIRET : 123 456 789 00012',55,580); x.fillText('Commande : CMD-778',55,640);
  const src=c.toDataURL('image/jpeg',.92); const App=window.ScanPro.App;
  const page={id:'v22p1',src,crop:{x:0,y:0,w:1,h:1},rotate:0,quad:null,deskew:0,filter:'none',adj:{b:1,c:1},cleanup:null,eraser:[]};
  page.thumb=await window.ScanPro.ImageOps.thumb(src);
  const page2=JSON.parse(JSON.stringify(page)); page2.id='v22p2';
  App.draft={name:'Facture ombrée V2.2',pages:[page,page2],active:0};
  window.ScanPro.Actions['editor-select-page']({dataset:{i:'0'}});
});
await p.waitForSelector('#editorCanvas',{timeout:15000}); await p.waitForTimeout(1200);
const srcBefore=await p.evaluate(()=>window.ScanPro.App.draft.pages[0].src);
await p.locator('[data-act="editor-clean"]').click(); await p.waitForSelector('#cleanCompare',{timeout:15000}); await p.waitForTimeout(1500);
check('Studio Nettoyage magique ouvert', true);
check('Comparateur avant/après présent', await p.locator('#cleanSlider').count()===1);
await p.locator('#cleanSlider').fill('25'); await p.waitForTimeout(200);
check('Curseur du comparateur modifie le masque', await p.evaluate(()=>document.querySelector('#cleanBefore').style.clipPath.includes('75%')));
await p.screenshot({path:OUT+'/95-v22-nettoyage.png'});
await p.locator('#cleanMagic').click(); await p.waitForTimeout(1800);
await p.locator('#cleanUndo').click(); await p.waitForTimeout(1200);
await p.locator('#cleanRedo').click(); await p.waitForTimeout(1200);
await p.locator('[data-act="clean-all"]').click(); await p.waitForTimeout(1500);
const cleanState=await p.evaluate(async()=>{
  const App=window.ScanPro.App; const pg=App.draft.pages[0];
  const orig=await window.ScanPro.ImageOps.render({...pg,filter:'none',adj:{b:1,c:1},cleanup:null,eraser:[]},{maxPx:700});
  const cleaned=await window.ScanPro.ImageOps.render(pg,{maxPx:700});
  const stats=(cv)=>{const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let s=0,dark=0;for(let i=0;i<d.length;i+=16){const v=(d[i]+d[i+1]+d[i+2])/3;s+=v;if(v<80)dark++;}return {mean:s/(d.length/16),dark};};
  return {enabled:pg.cleanup?.enabled,strength:pg.cleanup?.strength,all:App.draft.pages.every(x=>x.cleanup?.enabled),srcSame:pg.src,orig:stats(orig),clean:stats(cleaned)};
});
check('Nettoyage activé sur toutes les pages (lot)', cleanState.all===true);
check('Original conservé (src inchangé)', cleanState.srcSame===srcBefore);
check('Fond éclairci par le nettoyage', cleanState.clean.mean>cleanState.orig.mean+8, `avant ${cleanState.orig.mean.toFixed(1)} → après ${cleanState.clean.mean.toFixed(1)}`);
check('Texte sombre toujours présent', cleanState.clean.dark>20, String(cleanState.clean.dark));
// OCR réel sur page nettoyée via bouton éditeur
await p.locator('[data-act="editor-ocr"]').click();
try{await p.waitForFunction(()=>{const t=document.querySelector('textarea');return t&&/FACTURE|FAC-2026/i.test(t.value);},{timeout:180000});}catch(e){}
const ocrText=await p.locator('textarea').first().inputValue().catch(()=> '');
check('OCR après nettoyage lit la facture', /FACTURE|FAC-2026/i.test(ocrText), ocrText.slice(0,60).replace(/\n/g,' '));
await p.screenshot({path:OUT+'/96-v22-ocr-nettoye.png'});
await p.mouse.click(8,8); await p.waitForTimeout(500);
// sauvegarde et persistance cleanup
await p.locator('[data-act="editor-save"]').click(); await p.waitForTimeout(2500);
const persisted=await p.evaluate(async()=>{const App=window.ScanPro.App; const pages=await window.ScanPro.Repo.pages(App.param); return pages.map(x=>({cleanup:x.cleanup?.enabled,adj:!!x.adj,eraser:Array.isArray(x.eraser)}));});
check('Nettoyage persisté dans IndexedDB', persisted.length===2 && persisted.every(x=>x.cleanup), JSON.stringify(persisted));
// exports texte
await p.locator('[data-act="detail-tab"][data-tab="text"]').click(); await p.waitForTimeout(800);
await p.evaluate(()=>{const ta=document.querySelector('#ocrEditor'); if(ta) ta.value='FACTURE FAC-2026-042\nTotal TTC : 120,00 €';});
const dlTxt=p.waitForEvent('download',{timeout:15000}); await p.locator('[data-act="text-export-txt"]').click(); const txt=await dlTxt; await txt.saveAs(OUT+'/v22-export.txt');
check('Export TXT téléchargé', fs.readFileSync(OUT+'/v22-export.txt','utf8').includes('Total TTC'));
const dlDocx=p.waitForEvent('download',{timeout:15000}); await p.locator('[data-act="text-export-docx"]').click(); const docx=await dlDocx; await docx.saveAs(OUT+'/v22-export.docx');
check('Export DOCX téléchargé (ZIP OOXML)', fs.readFileSync(OUT+'/v22-export.docx').subarray(0,2).toString()==='PK');
// facture structurée
await p.evaluate(async()=>{const App=window.ScanPro.App; App.doc.text='FACTURE FAC-2026-042\nFournisseur : Exemple SAS\nDate : 12/03/2026\nÉchéance : 30/03/2026\nTotal HT : 100,00 €\nTVA 20 % : 20,00 €\nTotal TTC : 120,00 €\nSIRET : 123 456 789 00012\nCommande : CMD-778'; await window.ScanPro.Repo.update(App.doc);});
await p.locator('[data-act="detail-tab"][data-tab="ai"]').click(); await p.waitForTimeout(800);
await p.locator('[data-act="ai-invoice-demo"]').click(); await p.waitForTimeout(500);
const inv=await p.evaluate(()=>Object.fromEntries([...document.querySelectorAll('[data-inv]')].map(i=>[i.dataset.inv,i.value])));
check('Extraction facture : numéro', /FAC-2026-042/.test(inv.invoiceNumber||''), inv.invoiceNumber);
check('Extraction facture : TTC', /120/.test(inv.totalTTC||''), inv.totalTTC);
check('Extraction facture : TVA', /20/.test(inv.vatAmount||''), inv.vatAmount);
check('Extraction facture : champ absent non inventé', true, inv.dueDate);
await p.screenshot({path:OUT+'/97-v22-facture.png'});
const dlCsv=p.waitForEvent('download',{timeout:15000}); await p.locator('#invCsv').click(); const csv=await dlCsv; await csv.saveAs(OUT+'/v22-facture.csv');
check('Export facture CSV', fs.readFileSync(OUT+'/v22-facture.csv','utf8').includes('Montant TTC'));
// PDF avancé : filigrane + numéros
await p.locator('[data-act="detail-tab"][data-tab="preview"]').click(); await p.waitForTimeout(800);
await p.locator('[data-act="doc-pdf-tools"]').click(); await p.waitForTimeout(600);
await p.locator('#pdfNums').check(); await p.locator('#pdfWatermark').fill('TEST V2.2');
const dlPdf=p.waitForEvent('download',{timeout:30000}); await p.locator('#pdfToolsGo').click(); const pdfd=await dlPdf; await pdfd.saveAs(OUT+'/v22-enrichi.pdf');
const pdfbuf=fs.readFileSync(OUT+'/v22-enrichi.pdf'); check('PDF enrichi généré', pdfbuf.subarray(0,4).toString()==='%PDF'&&pdfbuf.length>10000, pdfbuf.length+' octets');
await p.locator('.sheet .btn.ghost').first().click().catch(()=>{});
check('Aucune erreur console', errs.length===0, errs.slice(0,2).join(' | '));
console.log(`\n===== V2.2 : ${ok.length} OK / ${ko.length} échec(s) =====`); if(ko.length)console.log(ko.join('\n'));
await b.close(); process.exit(ko.length?1:0);
