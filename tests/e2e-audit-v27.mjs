import { chromium, devices } from 'playwright';
const APP=process.env.APP_URL||'http://localhost:8080/index.html'; const OUT='/home/user/scanpro/tests/out';
const ok=[],ko=[]; const check=(l,c,e='')=>{(c?ok:ko).push(l);console.log((c?'✅':'❌')+' '+l+(e?' — '+e:''));};
const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const ctx=await b.newContext({...devices['Pixel 7'],viewport:{width:360,height:740},locale:'fr-FR',permissions:['camera'],acceptDownloads:true});
const p=await ctx.newPage(); const errs=[], failed=[];
p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))}); p.on('requestfailed',r=>failed.push(r.url().slice(-60)));
await p.goto(APP,{waitUntil:'load',timeout:60000}); await p.waitForTimeout(1200); await p.locator('.sheet .btn.primary').click().catch(()=>{});
for(const nav of ['docs','tools','settings','home']){ await p.locator(`[data-nav="${nav}"]`).click(); await p.waitForTimeout(450); check('Navigation '+nav, await p.evaluate(r=>window.ScanPro.App.route===r,nav)); }
check('Petit écran 360px sans débordement horizontal', await p.evaluate(()=>document.documentElement.scrollWidth<=365), await p.evaluate(()=>document.documentElement.scrollWidth+'px'));
await p.locator('[data-nav="tools"]').click(); await p.waitForTimeout(600);
check('Outils : tuiles visibles', await p.locator('.tool-item').count()>=15, await p.locator('.tool-item').count()+' tuiles');
await p.locator('[data-act="set-langs"]').click(); await p.waitForTimeout(400); check('Modale langues ouverte', await p.locator('[data-lang]').count()>=6);
await p.mouse.click(8,8); await p.waitForTimeout(400); check('Modale fermable au toucher extérieur', await p.locator('[data-lang]').count()===0);
// document incliné + filigrane
await p.evaluate(async()=>{
 const c=document.createElement('canvas');c.width=1000;c.height=1350;const x=c.getContext('2d');x.fillStyle='#ddd6c2';x.fillRect(0,0,1000,1350);
 x.save();x.translate(500,675);x.rotate(-0.045);x.fillStyle='#fff';x.fillRect(-390,-560,780,1120);x.fillStyle='#111';x.font='bold 46px Arial';x.fillText('DOCUMENT AUDIT',-330,-450);x.font='30px Arial';x.fillText('Texte noir de contrôle',-330,-360);x.save();x.translate(0,60);x.rotate(-.6);x.fillStyle='rgba(100,110,130,.55)';x.font='bold 110px Arial';x.fillText('SPECIMEN',-360,40);x.restore();x.restore();
 const src=c.toDataURL('image/jpeg',.93); const pg={id:'audit1',src,crop:{x:0,y:0,w:1,h:1},rotate:0,quad:null,deskew:0,filter:'none',adj:{b:1,c:1},cleanup:null,eraser:[]}; pg.thumb=await window.ScanPro.ImageOps.thumb(src);
 const App=window.ScanPro.App; App.draft={name:'Audit coins',pages:[pg],active:0}; window.ScanPro.Actions['editor-select-page']({dataset:{i:'0'}});
});
await p.waitForSelector('#editorCanvas'); await p.waitForTimeout(900);
await p.locator('[data-act="editor-corners"]').click(); await p.waitForTimeout(1200);
const geom=await p.evaluate(()=>{const cv=document.querySelector('#cornerHost canvas');const h=document.querySelector('.corner-handle[data-corner="br"]');const f=cv.parentElement.getBoundingClientRect();const r=cv.getBoundingClientRect();const hr=h.getBoundingClientRect();return {ratio:r.width/r.height, srcRatio:cv.width/cv.height, handleCx:(hr.left+hr.width/2-f.left)/f.width, handleCy:(hr.top+hr.height/2-f.top)/f.height};});
check('4 coins : aperçu au ratio réel (pas écrasé)', Math.abs(geom.ratio-geom.srcRatio)<0.08, `affiché ${geom.ratio.toFixed(2)} vs source ${geom.srcRatio.toFixed(2)}`);
check('4 coins : poignée alignée sur le polygone (97%)', Math.abs(geom.handleCx-.97)<.04 && Math.abs(geom.handleCy-.97)<.04, `${geom.handleCx.toFixed(2)},${geom.handleCy.toFixed(2)}`);
await p.screenshot({path:OUT+'/108-audit-coins.png'});
await p.locator('[data-c="apply"]').click(); await p.waitForTimeout(1500);
const after=await p.evaluate(()=>{const pg=window.ScanPro.App.draft.pages[0];const cv=document.querySelector('#editorCanvas');return {quad:!!pg.quad,deskew:pg.deskew,w:cv?.width,h:cv?.height};});
check('Validation perspective sans rotation abusive', Math.abs(after.deskew||0)<3, JSON.stringify(after));
// filigrane
await p.locator('[data-act="editor-clean"]').click(); await p.waitForTimeout(1300);
check('Bouton Atténuer le filigrane présent', await p.locator('#cleanWatermark').count()===1);
await p.locator('#cleanWatermark').click(); await p.waitForTimeout(1500);
await p.locator('[data-act="clean-apply"]').click(); await p.waitForTimeout(1200);
const pix=await p.evaluate(async()=>{const pg=window.ScanPro.App.draft.pages[0];const off=await window.ScanPro.ImageOps.render({...pg,cleanup:{...pg.cleanup,watermark:false}},{maxPx:800});const on=await window.ScanPro.ImageOps.render(pg,{maxPx:800});const mean=cv=>{const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let s=0,dark=0;for(let i=0;i<d.length;i+=16){const v=(d[i]+d[i+1]+d[i+2])/3;s+=v;if(v<70)dark++;}return {m:s/(d.length/16),dark}};return {on:pg.cleanup?.watermark===true,sans:mean(off),avec:mean(on)};});
check('Option filigrane enregistrée dans le traitement', pix.on===true);
check('Filigrane atténué, encre préservée', pix.avec.m>pix.sans.m+2 && pix.avec.dark>30, JSON.stringify(pix));
await p.evaluate(()=>{window.scrollTo(0,0)});
check('Erreurs console', errs.length===0, errs.slice(0,2).join('|'));
check('Requêtes échouées', failed.length===0, failed.slice(0,2).join('|'));
console.log(`\n===== AUDIT V2.7 : ${ok.length} OK / ${ko.length} échec(s) =====`); await b.close(); process.exit(ko.length?1:0);
