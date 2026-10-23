import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const p = await ctx.newPage();
p.on('console', m => console.log('[c]', m.text().slice(0, 200)));
await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});
await p.evaluate(async () => {
  const App = window.ScanPro.App;
  const mk = async (n) => {
    const c = document.createElement('canvas'); c.width = 700; c.height = 990;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,700,990);
    x.fillStyle = '#111'; x.font = 'bold 200px Georgia'; x.fillText(String(n), 280, 560);
    const src = c.toDataURL('image/jpeg', 0.9);
    const page = { id: 'pg'+n, src, crop:{x:0,y:0,w:1,h:1}, rotate:0, quad:null, deskew:0, filter:'none', adj:{b:1,c:1} };
    page.thumb = await window.ScanPro.ImageOps.thumb(src);
    return page;
  };
  App.draft = { name: 'Test', pages: [await mk(1), await mk(2), await mk(3)], active: 0 };
  window.ScanPro.Actions['editor-select-page']({ dataset: { i: '0' } });
  // instrumentation
  const strip = document.querySelector('#pagesStrip');
  ['pointerdown','pointermove','pointerup'].forEach(t =>
    strip.addEventListener(t, ev => console.log('EV', t, Math.round(ev.clientX), Math.round(ev.clientY), ev.target.className), true));
});
await p.waitForTimeout(1500);
const th1 = await p.locator('.page-thumb[data-i="0"]').boundingBox();
const th3 = await p.locator('.page-thumb[data-i="2"]').boundingBox();
await p.mouse.move(th1.x + th1.width/2, th1.y + th1.height/2);
await p.mouse.down();
await p.waitForTimeout(500);
await p.mouse.move(th1.x + th1.width/2 + 30, th1.y + th1.height/2, { steps: 4 });
await p.waitForTimeout(200);
console.log('DOM après petit move:', await p.evaluate(() => [...document.querySelectorAll('.page-thumb')].map(e=>e.dataset.i).join(',')));
await p.mouse.move(th3.x + th3.width/2 + 10, th3.y + th3.height/2, { steps: 6 });
await p.waitForTimeout(300);
console.log('DOM après move final:', await p.evaluate(() => [...document.querySelectorAll('.page-thumb')].map(e=>e.dataset.i).join(',')));
await p.mouse.up();
await p.waitForTimeout(800);
console.log('App:', await p.evaluate(() => window.ScanPro.App.draft.pages.map(x=>x.id).join(',')));
await b.close();
