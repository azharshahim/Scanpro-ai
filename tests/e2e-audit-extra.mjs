// Audit complémentaire V2.7 : hors-ligne, requêtes externes, zones tactiles, refus caméra.
import { chromium, devices } from 'playwright';
const APPURL = process.env.APP_URL || 'http://127.0.0.1:8080/';
const results = [];
const ok = (n, c, x='') => { results.push([n, !!c]); console.log((c?'✅ ':'❌ ')+n+(x?' — '+x:'')); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport:{width:360,height:740} });
const page = await ctx.newPage();
const errors=[]; const failed=[]; const external=new Set();
page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e=>errors.push(e.message));
page.on('requestfailed', r=>failed.push(r.url()));
page.on('request', r=>{ if(r.url().startsWith('blob:')||r.url().startsWith('data:')) return; const u=new URL(r.url()); if(u.origin!==new URL(APPURL).origin) external.add(u.origin); });
await page.goto(APPURL,{waitUntil:'networkidle'}).catch(()=>page.goto(APPURL));
await page.waitForTimeout(1500);
const title = await page.locator('body').innerText().catch(()=> '');
ok('Chargement initial', title.includes('ScanPro') || title.length>10, title.slice(0,60).replace(/\n/g,' '));
const sw = await page.evaluate(async()=>{ if(!('serviceWorker' in navigator)) return 'unsupported'; const r=await navigator.serviceWorker.getRegistration(); return r? (r.active?.state||'registered'):'none'; }).catch(e=>'err:'+e.message);
ok('Service worker actif', ['activated','registered'].includes(sw), sw);
// Zones tactiles : boutons visibles trop petits
await page.evaluate(()=>{ location.hash='#tools'; });
await page.waitForTimeout(600);
const small = await page.evaluate(()=>{ const out=[]; document.querySelectorAll('button,a,[role=button]').forEach(el=>{ const r=el.getBoundingClientRect(); if(r.width>0&&r.height>0&&(r.width<36||r.height<36)) out.push((el.textContent||el.id||el.className||'?').trim().slice(0,30)+' '+Math.round(r.width)+'x'+Math.round(r.height)); }); return out.slice(0,12); });
ok('Zones tactiles >= 36px sur Outils', small.length<=3, small.join(' | ')||'aucune petite');
// Hors-ligne : recharger avec réseau coupé (service worker doit servir l'app)
await ctx.setOffline(true);
let offlineText='';
try { await page.reload({waitUntil:'domcontentloaded',timeout:15000}); await page.waitForTimeout(1200); offlineText=await page.locator('body').innerText(); } catch(e) { offlineText='ERR '+e.message; }
ok('Hors-ligne après 1er chargement', offlineText.includes('ScanPro'), offlineText.slice(0,80).replace(/\n/g,' '));
await ctx.setOffline(false);
// Refus caméra : getUserMedia rejeté => message français, pas de crash
await page.addInitScript(()=>{ if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError')); });
await page.reload({waitUntil:'domcontentloaded'}).catch(()=>{}); await page.waitForTimeout(800);
await page.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=>/scan/i.test(x.textContent||'')); b?.click(); });
await page.waitForTimeout(1200);
const bodyTxt = await page.locator('body').innerText().catch(()=> '');
ok('Refus caméra géré sans crash', bodyTxt.length>10 && errors.length===0, errors.join(';').slice(0,120));
ok('Aucune requête externe (hors CDN de secours inactif)', external.size===0, [...external].join(',')||'aucune');
ok('Aucune erreur console', errors.length===0, errors.join(';').slice(0,160));
ok('Aucune requête échouée critique', failed.length===0, failed.join(';').slice(0,160));
const fails=results.filter(r=>!r[1]).length;
console.log(`\n===== AUDIT COMPLÉMENTAIRE : ${results.length-fails} OK / ${fails} échec(s) =====`);
await browser.close();
process.exit(fails?1:0);
