import { chromium, devices } from 'playwright';
const APP=process.env.APP_URL||'http://localhost:8080/index.html'; const OUT='/home/user/scanpro/tests/out';
const ok=[],ko=[]; const check=(l,c,e='')=>{(c?ok:ko).push(l);console.log((c?'✅':'❌')+' '+l+(e?' — '+e:''));};
const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
const ctx=await b.newContext({...devices['Pixel 7'],locale:'fr-FR',permissions:['camera'],acceptDownloads:true}); const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))});
await p.goto(APP,{waitUntil:'load',timeout:60000}); await p.waitForTimeout(1300); await p.locator('.sheet .btn.primary').click().catch(()=>{});
// crée un document pour les outils
await p.evaluate(async()=>{const c=document.createElement('canvas');c.width=700;c.height=1000;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,700,1000);x.fillStyle='#111';x.font='bold 44px Arial';x.fillText('OUTILS V26',70,160);x.font='30px Arial';x.fillText('Document de test',70,260);const src=c.toDataURL('image/jpeg',.92);const pg={id:'v26p',src,crop:{x:0,y:0,w:1,h:1},rotate:0,quad:null,deskew:0,filter:'none',adj:{b:1,c:1},cleanup:null,eraser:[]};pg.thumb=await window.ScanPro.ImageOps.thumb(src);const d=await window.ScanPro.Repo.create({name:'Outils V26',pages:[pg],source:'scan'});d.text='OUTILS V26\nDocument de test';await window.ScanPro.Repo.update(d);});
await p.locator('[data-nav="tools"]').click(); await p.waitForTimeout(800);
check('Menu Outils accessible depuis la navigation', await p.locator('h1').first().innerText().then(t=>t.includes('Outils')));
for(const [act,label] of [['scan-camera','Scanner'],['tool-doc-pdf','Document en PDF'],['tool-doc-clean','Nettoyage magique'],['tool-pdf-signature','Signature / filigrane'],['backup-export','Sauvegarder']]) check('Outil présent : '+label, await p.locator(`[data-act="${act}"]`).count()>=1);
await p.screenshot({path:OUT+'/104-v26-outils.png'});
// un outil réel : picker puis génération PDF
await p.locator('[data-act="tool-doc-pdf"]').click(); await p.waitForTimeout(600);
check('Sélecteur de document des outils', await p.locator('[data-tool-doc]').count()>=1);
const dl=p.waitForEvent('download',{timeout:30000}); await p.locator('[data-tool-doc]').first().click(); const pdf=await dl; await pdf.saveAs(OUT+'/v26-outil.pdf');
check('Outil PDF génère un fichier', (await import('fs')).statSync(OUT+'/v26-outil.pdf').size>5000);
// nuit : couleurs calculées au milieu de page
await p.locator('[data-nav="tools"]').click(); await p.waitForTimeout(500);
await p.locator('[data-act="toggle-theme"]').first().click(); await p.waitForTimeout(600);
const colors=await p.evaluate(()=>{const cs=(sel)=>{const e=document.querySelector(sel);return e?getComputedStyle(e).backgroundColor:'absent'};return {theme:document.documentElement.dataset.theme,app:cs('#app'),content:cs('.content'),card:cs('.tool-ico'),nav:cs('.bottom-nav'),body:cs('body')};});
console.log('couleurs nuit',JSON.stringify(colors));
check('Mode nuit : fond de page sombre', colors.app.includes('7, 13, 24')||colors.app.includes('7,13,24'), colors.app);
check('Mode nuit : milieu de page sombre', colors.content.includes('7, 13, 24')||colors.content.includes('7,13,24'), colors.content);
await p.evaluate(()=>window.scrollTo(0,650)); await p.waitForTimeout(400); await p.screenshot({path:OUT+'/105-v26-nuit-milieu.png'});
await p.locator('[data-act="toggle-theme"]').first().click(); await p.waitForTimeout(500);
check('Retour mode jour', await p.evaluate(()=>document.documentElement.dataset.theme==='light'&&getComputedStyle(document.querySelector('#app')).backgroundColor.includes('243')));
check('Aucune erreur console',errs.length===0,errs.slice(0,2).join('|'));
console.log(`\n===== V2.6 : ${ok.length} OK / ${ko.length} échec(s) =====`); await b.close(); process.exit(ko.length?1:0);
