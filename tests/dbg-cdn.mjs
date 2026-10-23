import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext();
const targets = [
  'https://cdn.statically.io/gh/azharshahim/Scanpro-ai/main/index.html',
  'https://htmlpreview.github.io/?https://github.com/azharshahim/Scanpro-ai/blob/main/index.html'
];
for (const u of targets) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0,120)));
  try {
    await p.goto(u, { waitUntil: 'load', timeout: 45000 });
    await p.waitForTimeout(4000);
    const info = await p.evaluate(() => ({
      app: typeof window.ScanPro,
      view: !!document.querySelector('#view'),
      scripts: document.querySelectorAll('script').length,
      assets: window.Assets ? 'Assets ok' : 'Assets absent'
    }));
    console.log(u.slice(0, 62), '→', JSON.stringify(info), '| err:', errs.slice(0,2));
    if (info.app === 'object') {
      console.log('   base assets:', await p.evaluate(() => Assets.base()));
      await p.screenshot({ path: 'tests/out/50-cdn-' + (u.includes('htmlpreview') ? 'htmlpreview' : 'statically') + '.png' });
    }
  } catch (e) { console.log(u.slice(0, 62), '→ ERREUR', e.message.slice(0, 90)); }
  await p.close();
}
await b.close();
