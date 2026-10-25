import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP=process.env.APP_URL||'http://localhost:8080/index.html'; const OUT=new URL('./out/', import.meta.url).pathname; fs.mkdirSync(OUT,{recursive:true});
const ok=[],ko=[]; const check=(l,c,e='')=>{(c?ok:ko).push(l);console.log((c?'✅':'❌')+' '+l+(e?' — '+e:''));};
const b=await chromium.launch(); const ctx=await b.newContext({...devices['Pixel 7'],locale:'fr-FR',acceptDownloads:true}); const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))});
await p.goto(APP,{waitUntil:'load',timeout:60000}); await p.waitForTimeout(1300); await p.locator('.sheet .btn.primary').click().catch(()=>{});
await p.evaluate(async()=>{
 const mk=(label,color)=>{const c=document.createElement('canvas');c.width=700;c.height=1000;const x=c.getContext('2d');x.fillStyle='#f4f1e6';x.fillRect(0,0,700,1000);x.fillStyle=color;x.font='bold 64px Arial';x.fillText(label,70,180);x.fillStyle='#111';x.font='28px Arial';x.fillText('FACTURE FAC-2026-042',70,300);x.fillText('Total TTC : 120,00 €',70,380);return c.toDataURL('image/jpeg',.92)};
 const docs=[];
 for(const [name,label,color] of [['Alpha V24','MEME','#c00'],['Beta V24','MEME','#c00'],['Gamma V24','AUTRE','#06c']]){
   const src=mk(label,color); const pg={id:'p'+Math.random(),src,crop:{x:0,y:0,w:1,h:1},rotate:0,quad:null,deskew:0,filter:'none',adj:{b:1,c:1},cleanup:null,eraser:[]}; pg.thumb=await window.ScanPro.ImageOps.thumb(src);
   const d=await window.ScanPro.Repo.create({name,pages:[pg],source:'scan'}); docs.push(d.id);
 }
 localStorage.setItem('v24docs',JSON.stringify(docs));
});
await p.locator('[data-nav="docs"]').click(); await p.waitForTimeout(900);
check('Bibliothèque affiche 3 documents de test', await p.locator('.doc-item').count()>=3);
await p.locator('[data-act="docs-duplicates"]').click(); await p.waitForTimeout(1800);
check('Doublon de documents détecté', await p.locator('[data-del-doc-dup]').count()>=1); await p.screenshot({path:OUT+'/101-v24-doublons-docs.png'});
await p.mouse.click(8,8); await p.waitForTimeout(400);
await p.locator('[data-act="docs-sort"]').click(); await p.waitForTimeout(500);
check('Tri bibliothèque modifiable', await p.evaluate(()=>window.ScanPro.App.docSort!=='date-desc'));
await p.locator('[data-act="docs-select-mode"]').click(); await p.waitForTimeout(500);
await p.locator('.doc-item').first().click(); await p.waitForTimeout(300); await p.locator('.doc-item').nth(1).click(); await p.waitForTimeout(500);
check('Sélection multiple active', await p.evaluate(()=>window.ScanPro.App.selectedDocs.size===2));
await p.locator('[data-act="docs-batch-fav"]').click(); await p.waitForTimeout(700);
check('Favoris par lots appliqués', await p.evaluate(()=>[...window.ScanPro.App.selectedDocs].every(id=>window.ScanPro.App.docs.find(d=>d.id===id)?.favorite)));
// sauvegarde / restauration — V2.22 : Paramètres centralisés (plus de rubrique settings dans la barre depuis V2.19)
await p.locator('[data-act="docs-select-mode"]').click(); await p.waitForTimeout(300);
await p.locator('[data-nav="home"]').click(); await p.waitForTimeout(500);
await p.locator('[data-act="go-settings"]').click(); await p.waitForTimeout(800);
check('Vue Paramètres centralisés ouverte', await p.locator('[data-act="backup-export"]').count() >= 1);
const dl=p.waitForEvent('download',{timeout:20000}); await p.locator('[data-act="backup-export"]').click(); const d=await dl; await d.saveAs(OUT+'/v24-backup.zip');
const zipSize=fs.statSync(OUT+'/v24-backup.zip').size; check('Sauvegarde ZIP exportée', zipSize>10000, zipSize+' octets');
const before=await p.evaluate(()=>window.ScanPro.App.docs.length);
const fcPromise=p.waitForEvent('filechooser',{timeout:15000}); await p.locator('[data-act="backup-import"]').click(); const fc=await fcPromise; await fc.setFiles(OUT+'/v24-backup.zip'); await p.waitForTimeout(2500);
const after=await p.evaluate(()=>window.ScanPro.App.docs.length); check('Restauration ZIP ajoute une copie sans écraser', after===before+3, before+' → '+after+' docs');
check('Aucune erreur console',errs.length===0,errs.slice(0,2).join('|'));
console.log(`\n===== V2.4 : ${ok.length} OK / ${ko.length} échec(s) =====`); await b.close(); process.exit(ko.length?1:0);
