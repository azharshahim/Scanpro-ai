import { chromium, devices } from 'playwright';
const b=await chromium.launch(); const ctx=await b.newContext({...devices['Pixel 7']}); const p=await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto(process.env.APP_URL||'http://localhost:8080/index.html'); await p.waitForTimeout(1200); await p.locator('.sheet .btn.primary').click().catch(()=>{});
const r=await p.evaluate(async()=>{
  const mk=(n)=>{const c=document.createElement('canvas');c.width=500;c.height=700;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,500,700);x.fillStyle='#111';x.font='bold 60px Arial';x.fillText('Page '+n,100,350);return {src:c.toDataURL('image/jpeg',.9),crop:{x:0,y:0,w:1,h:1},filter:'none'};};
  const {blob}=await window.ScanPro.PDF.build([mk(1),mk(2),mk(3)],{name:'test'});
  const sel=window.ScanPro.PDF.parsePageSelection('1,3-3',3);
  const ext=await window.ScanPro.PDF.extractPages(blob,sel,{name:'extrait'});
  const info=await window.ScanPro.PDF.inspect(new File([ext.blob],'extrait.pdf',{type:'application/pdf'}));
  return {sel,pageCount:ext.pageCount,inspect:info.pageCount,size:ext.blob.size};
});
console.log(JSON.stringify(r)); console.log('erreurs',errs.length);
const ok=r.sel.join(',')==='0,2'&&r.pageCount===2&&r.inspect===2&&!errs.length;
console.log(ok?'✅ Extraction PDF V2.2 OK':'❌ Extraction PDF V2.2 KO'); await b.close(); process.exit(ok?0:1);
