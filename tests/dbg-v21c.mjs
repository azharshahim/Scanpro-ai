import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'] });
const p = await ctx.newPage();
p.on('console', m => console.log('[c]', m.text().slice(0, 220)));
await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);
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
// instrumentation interne
await p.evaluate(() => {
  const strip = document.querySelector('#pagesStrip');
  const r = strip.getBoundingClientRect();
  console.log('strip rect', JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}));
  strip.addEventListener('pointerdown', e => console.log('PD target=', e.target.tagName, e.target.className, 'x=', Math.round(e.clientX)));
  strip.addEventListener('pointermove', e => console.log('PM x=', Math.round(e.clientX), 'buttons=', e.buttons));
});
const th1 = await p.locator('.page-thumb[data-i="0"]').boundingBox();
const th3 = await p.locator('.page-thumb[data-i="2"]').boundingBox();
console.log('th1', JSON.stringify(th1), 'th3', JSON.stringify(th3));
await p.mouse.move(th1.x + 30, th1.y + 40);
await p.mouse.down();
await p.waitForTimeout(420);
console.log('dragging?', await p.locator('.page-thumb.dragging').count());
for (const x of [60, 90, 120, 150, 180, 200]) {
  await p.mouse.move(x, th1.y + 40);
  await p.waitForTimeout(120);
}
console.log('DOM:', await p.evaluate(() => [...document.querySelectorAll('.page-thumb')].map(e=>e.dataset.i).join(',')));
await p.mouse.up();
await p.waitForTimeout(600);
console.log('App:', await p.evaluate(() => window.ScanPro.App.draft.pages.map(x=>x.id).join(',')));
await b.close();
