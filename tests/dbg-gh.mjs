import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,200)));
const urls = [
  'https://raw.githack.com/azharshahim/Scanpro-ai/main/index.html',
  'https://rawcdn.githack.com/azharshahim/Scanpro-ai/main/index.html',
  'https://cdn.statically.io/gh/azharshahim/Scanpro-ai/main/index.html'
];
for (const u of urls) {
  try {
    const r = await ctx.request.get(u, { timeout: 30000 });
    const body = await r.body();
    const txt = body.toString('utf8');
    console.log('\n---', u);
    console.log('status', r.status(), '| headers ct:', r.headers()['content-type'], '| len:', body.length,
      '| fins de balise:', /<\/html>\s*$/.test(txt), '| scripts:', (txt.match(/<script/g)||[]).length);
  } catch (e) { console.log('\n---', u, 'ERREUR', e.message.slice(0,120)); }
}
// puis rendu réel de la 1re URL
const p2 = await ctx.newPage();
p2.on('pageerror', e => console.log('[pageerror2]', e.message.slice(0,200)));
await p2.goto(urls[0], { waitUntil: 'load', timeout: 60000 });
await p2.waitForTimeout(2000);
console.log('\nrendu githack → #view:', await p2.evaluate(() => !!document.querySelector('#view')),
  '| scripts DOM:', await p2.evaluate(() => document.querySelectorAll('script').length),
  '| html len:', await p2.evaluate(() => document.documentElement.outerHTML.length),
  '| content-type vu:', await p2.evaluate(() => document.contentType));
await b.close();
