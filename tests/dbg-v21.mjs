import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' });
const p = await ctx.newPage();
p.on('console', m => console.log('[c]', m.text().slice(0, 200)));
p.on('pageerror', e => console.log('[err]', e.message.slice(0, 200)));
await p.goto('http://localhost:8080/index.html', { waitUntil: 'load' });
await p.waitForTimeout(1200);
await p.locator('.sheet .btn.primary').click().catch(() => {});
// fabrique 3 pages puis entre dans l'éditeur
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
  // appelle directement le rendu de l'éditeur via une action existante
  window.ScanPro.Actions['editor-select-page']({ dataset: { i: '0' } });
});
await p.waitForTimeout(1500);
console.log('thumbs:', await p.locator('.page-thumb').count(), '| reorder init:', await p.evaluate(() => !!document.querySelector('#pagesStrip')));
const th1 = await p.locator('.page-thumb[data-i="0"]').boundingBox();
const th3 = await p.locator('.page-thumb[data-i="2"]').boundingBox();
console.log('box1', JSON.stringify(th1), 'box3', JSON.stringify(th3));
await p.mouse.move(th1.x + th1.width/2, th1.y + th1.height/2);
await p.mouse.down();
await p.waitForTimeout(500);
console.log('après appui long — dragging:', await p.locator('.page-thumb.dragging').count());
await p.mouse.move(th3.x + th3.width/2, th3.y + th3.height/2, { steps: 10 });
await p.waitForTimeout(300);
console.log('après move — ordre DOM:', await p.evaluate(() => [...document.querySelectorAll('.page-thumb')].map(e => e.dataset.i).join(',')));
await p.mouse.up();
await p.waitForTimeout(1200);
console.log('après up — ordre App:', await p.evaluate(() => window.ScanPro.App.draft.pages.map(x => x.id).join(',')));
await b.close();
