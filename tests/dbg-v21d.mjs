import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const p = await ctx.newPage();
p.on('console', m => console.log('[c]', m.text().slice(0, 240)));
await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
await p.waitForTimeout(1000);
await p.locator('.sheet .btn.primary').click().catch(() => {});
await p.evaluate(async () => {
  const App = window.ScanPro.App;
  const mk = async (n) => {
    const c = document.createElement('canvas'); c.width = 700; c.height = 990;
    const x = c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,700,990);
    x.fillStyle='#111'; x.font='bold 200px Georgia'; x.fillText(String(n),280,560);
    const src = c.toDataURL('image/jpeg',0.9);
    const page = { id:'pg'+n, src, crop:{x:0,y:0,w:1,h:1}, rotate:0, quad:null, deskew:0, filter:'none', adj:{b:1,c:1} };
    page.thumb = await window.ScanPro.ImageOps.thumb(src);
    return page;
  };
  App.draft = { name:'Test', pages:[await mk(1),await mk(2),await mk(3)], active:0 };
  window.ScanPro.Actions['editor-select-page']({ dataset:{ i:'0' } });
});
await p.waitForTimeout(1200);
await p.evaluate(() => {
  const strip = document.querySelector('#pagesStrip');
  const log = (t) => (e) => console.log(t, 'x=', Math.round(e.clientX), 'target=', (e.target.className||e.target.tagName).toString().slice(0,18), 'cls=', strip.className);
  strip.addEventListener('pointermove', log('PM'), true);
  strip.addEventListener('pointercancel', log('CANCEL'), true);
  document.addEventListener('pointermove', log('DOC-PM'), true);
});
const th1 = await p.locator('.page-thumb[data-i="0"]').boundingBox();
await p.mouse.move(th1.x + 30, th1.y + 40);
await p.mouse.down();
await p.waitForTimeout(420);
for (const x of [60, 100, 150, 200]) { await p.mouse.move(x, th1.y + 40); await p.waitForTimeout(100); }
console.log('DOM:', await p.evaluate(() => [...document.querySelectorAll('.page-thumb')].map(e=>e.dataset.i).join(',')));
await p.mouse.up();
await b.close();
