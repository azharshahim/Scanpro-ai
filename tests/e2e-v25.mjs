import { chromium, devices } from 'playwright';
import fs from 'fs';
const APP=process.env.APP_URL||'http://localhost:8080/index.html'; const OUT=new URL('./out/', import.meta.url).pathname; fs.mkdirSync(OUT,{recursive:true});
const ok=[],ko=[]; const check=(l,c,e='')=>{(c?ok:ko).push(l);console.log((c?'✅':'❌')+' '+l+(e?' — '+e:''));};
const b=await chromium.launch(); const ctx=await b.newContext({...devices['Pixel 7'],locale:'fr-FR'}); const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))});
await p.goto(APP,{waitUntil:'load',timeout:60000}); await p.waitForTimeout(1300); await p.locator('.sheet .btn.primary').click().catch(()=>{});
check('En-tête non fixe (ne masque plus la vue)', await p.evaluate(()=>getComputedStyle(document.querySelector('.appbar')).position==='relative'));
await p.evaluate(()=>window.scrollTo(0,900)); await p.waitForTimeout(500);
check('En-tête défile avec la page', await p.evaluate(()=>document.querySelector('.appbar').getBoundingClientRect().bottom<80));
await p.evaluate(()=>window.scrollTo(0,0)); await p.waitForTimeout(300);
// V2.22 : le basculeur de thème vit dans l'appbar Documents (et dans Paramètres) depuis la refonte V2.19
await p.locator('[data-nav="docs"]').click(); await p.waitForTimeout(600);
await p.locator('[data-act="toggle-theme"]').first().click(); await p.waitForTimeout(300);
check('Bouton nuit en haut active le mode nuit', await p.evaluate(()=>document.documentElement.dataset.theme==='dark'));
await p.screenshot({path:OUT+'/102-v25-nuit.png'});
await p.locator('[data-act="toggle-theme"]').first().click(); await p.waitForTimeout(300);
check('Bouton jour réactive le mode clair', await p.evaluate(()=>document.documentElement.dataset.theme==='light'));
// V2.22 : Paramètres centralisés accessibles depuis l'Accueil
await p.locator('[data-nav="home"]').click(); await p.waitForTimeout(500);
await p.locator('[data-act="go-settings"]').click(); await p.waitForTimeout(700);
check('Écran Paramètres affiché', await p.locator('[data-act="set-langs"]').count()>=1);
await p.locator('[data-act="set-langs"]').click(); await p.waitForTimeout(500);
const langs=await p.locator('[data-lang]').evaluateAll(es=>es.map(e=>e.dataset.lang));
check('Langues OCR FR/EN/ES/DE/IT/PT disponibles', ['fra','eng','spa','deu','ita','por'].every(l=>langs.includes(l)), langs.join(','));
await p.locator('[data-lang="spa"]').click(); await p.waitForTimeout(500);
check('Espagnol sélectionné et persisté', await p.evaluate(()=>window.ScanPro.Settings.get('ocrLangs')==='spa'));
await p.evaluate(async()=>{
 const c=document.createElement('canvas');c.width=1000;c.height=650;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,1000,650);x.fillStyle='#111';x.font='bold 54px Arial';x.fillText('DOCUMENTO DE PRUEBA',70,130);x.font='40px Arial';x.fillText('Nombre y dirección del cliente',70,250);x.fillText('Importe total a pagar',70,350);x.fillText('Muchas gracias por su visita',70,450);
 const src=c.toDataURL('image/jpeg',.95); const App=window.ScanPro.App; const pg={id:'v25es',src,crop:{x:0,y:0,w:1,h:1},rotate:0,quad:null,deskew:0,filter:'none',adj:{b:1,c:1},cleanup:null,eraser:[]}; pg.thumb=await window.ScanPro.ImageOps.thumb(src); App.draft={name:'Prueba ES',pages:[pg],active:0}; window.ScanPro.Actions['editor-select-page']({dataset:{i:'0'}});
});
await p.waitForSelector('#editorCanvas'); await p.waitForTimeout(800);
await p.locator('[data-act="editor-ocr"]').click();
try{await p.waitForFunction(()=>{const t=document.querySelector('textarea');return t&&/DOCUMENTO|PRUEBA|Importe/i.test(t.value)},{timeout:180000});}catch(e){}
const txt=await p.locator('textarea').first().inputValue().catch(()=> '');
check('OCR espagnol réel', /DOCUMENTO|PRUEBA|Importe/i.test(txt), txt.slice(0,70).replace(/\n/g,' '));
await p.screenshot({path:OUT+'/103-v25-espagnol.png'});
check('Aucune erreur console',errs.length===0,errs.slice(0,2).join('|'));
console.log(`\n===== V2.5 : ${ok.length} OK / ${ko.length} échec(s) =====`); await b.close(); process.exit(ko.length?1:0);
