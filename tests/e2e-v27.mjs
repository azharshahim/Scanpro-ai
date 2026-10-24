import { chromium, devices } from 'playwright'; import fs from 'fs';
const APP=process.env.APP_URL||'http://localhost:8080/index.html'; const OUT='/home/user/scanpro/tests/out';
const ok=[],ko=[]; const check=(l,c,e='')=>{(c?ok:ko).push(l);console.log((c?'✅':'❌')+' '+l+(e?' — '+e:''));};
const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const ctx=await b.newContext({...devices['Pixel 7'],locale:'fr-FR',permissions:['camera'],acceptDownloads:true}); const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))});
await p.goto(APP,{waitUntil:'load',timeout:60000}); await p.waitForTimeout(1300); await p.locator('.sheet .btn.primary').click().catch(()=>{});
// fabrique une image document déjà droite, avec tableau interne et filigrane diagonal (cas réel signalé)
const dataUrl=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=1371;c.height=1929;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1371,1929);x.strokeStyle='#333';x.lineWidth=4;x.strokeRect(90,260,1120,760);x.beginPath();x.moveTo(90,430);x.lineTo(1210,430);x.moveTo(620,260);x.lineTo(620,1020);x.stroke();x.fillStyle='#111';x.font='bold 58px Arial';x.fillText('FACTURE DROITE',110,150);x.font='36px Arial';x.fillText('Montant à régler : 893,63 €',110,1180);x.save();x.translate(650,950);x.rotate(-.65);x.fillStyle='rgba(80,90,110,.35)';x.font='bold 150px Arial';x.fillText('SPECIMEN',-430,50);x.restore();return c.toDataURL('image/jpeg',.95);});
fs.writeFileSync(OUT+'/v27-doc-droit.jpg', Buffer.from(dataUrl.split(',')[1],'base64'));
const fcP=p.waitForEvent('filechooser',{timeout:15000}); await p.locator('[data-act="import-image"]').first().click(); const fc=await fcP; await fc.setFiles(OUT+'/v27-doc-droit.jpg');
await p.waitForSelector('#editorCanvas',{timeout:20000}); await p.waitForTimeout(1800);
const st=await p.evaluate(()=>{const pg=window.ScanPro.App.draft.pages[0];return {quad:pg.quad,deskew:pg.deskew,detected:pg.detected};});
check('Import droit : pas de perspective inventée', !st.quad, JSON.stringify(st.quad));
check('Import droit : pas de rotation automatique abusive', Math.abs(st.deskew||0)<0.6, 'deskew='+st.deskew);
await p.screenshot({path:OUT+'/106-v27-import-droit.png'});
// FAB centré et neutre
await p.locator('[data-act="editor-exit"]').click(); await p.waitForTimeout(400); const cancelBtn=p.locator('.sheet button').filter({hasText:'Abandonner'}); if(await cancelBtn.count()) await cancelBtn.first().click();
await p.waitForTimeout(800);
const fab=await p.evaluate(()=>{const nav=document.querySelector('.bottom-nav').getBoundingClientRect();const f=document.querySelector('#fabScan').getBoundingClientRect();const cs=getComputedStyle(document.querySelector('#fabScan'));return {center:f.left+f.width/2, navCenter:nav.left+nav.width/2, bg:cs.backgroundColor, order:[...document.querySelectorAll('.bottom-nav > *')].map(e=>e.className||e.dataset.nav)};});
check('Bouton Scan au centre de la barre', Math.abs(fab.center-fab.navCenter)<28, `centre ${fab.center.toFixed(0)} vs barre ${fab.navCenter.toFixed(0)}`);
check('Bouton Scan sans fond bleu vif', fab.bg.includes('11, 27, 52'), fab.bg);
await p.screenshot({path:OUT+'/107-v27-barre.png'});
// partage Excel / Word / Texte
await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=700;c.height=1000;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,700,1000);x.fillStyle='#111';x.font='bold 40px Arial';x.fillText('FACTURE',70,140);const src=c.toDataURL('image/jpeg',.92);const pg={id:'v27share',src,crop:{x:0,y:0,w:1,h:1},rotate:0,quad:null,deskew:0,filter:'none',adj:{b:1,c:1}};pg.thumb=await window.ScanPro.ImageOps.thumb(src);const d=await window.ScanPro.Repo.create({name:'Partage V27',pages:[pg],source:'scan'});d.text='FACTURE FAC-2026-042\nTotal TTC : 120,00 €\nTVA 20 % : 20,00 €';await window.ScanPro.Repo.update(d);});
await p.locator('[data-nav="docs"]').click(); await p.waitForTimeout(800); await p.locator('.doc-item').first().click(); await p.waitForTimeout(900);
await p.locator('[data-act="doc-share-pdf"]').first().click(); await p.waitForTimeout(500);
check('Choix de partage PDF/Word/Excel/Texte', await p.locator('[data-share-fmt]').count()===4);
for(const [fmt,ext] of [['xlsx','xlsx'],['docx','docx'],['txt','txt']]){
  if(fmt!=='xlsx'){ await p.locator('[data-act="doc-share-pdf"]').first().click(); await p.waitForTimeout(400); }
  const dlp=p.waitForEvent('download',{timeout:20000}).catch(()=>null); await p.locator(`[data-share-fmt="${fmt}"]`).click(); const dl=await dlp; if(dl) await dl.saveAs(OUT+'/v27-partage.'+ext);
  check('Partage '+fmt.toUpperCase()+' produit un fichier', !!dl && fs.existsSync(OUT+'/v27-partage.'+ext));
}
check('XLSX est un classeur OOXML (PK)', fs.readFileSync(OUT+'/v27-partage.xlsx').subarray(0,2).toString()==='PK');
check('Aucune erreur console',errs.length===0,errs.slice(0,2).join('|'));
console.log(`\n===== V2.7 : ${ok.length} OK / ${ko.length} échec(s) =====`); await b.close(); process.exit(ko.length?1:0);
