import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', m => console.log('[c]', m.text().slice(0,200)));
await p.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const out = await p.evaluate(async () => {
  const img = new Image();
  img.src = 'data:image/jpeg;base64,' + (window.__photo || '');
  return 'need photo';
});
// on repart de l'image sauvegardée : on la charge via fetch local
const dbg = await p.evaluate(async () => {
  const blob = await (await fetch('/tests/out/70-v2-photo.jpg')).blob();
  const url = URL.createObjectURL(blob);
  const im = new Image(); im.src = url; await im.decode();
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);

  const { g, w, h } = Vision._gray(c, 520);
  const blur = Vision._boxBlur(g, w, h, 2);
  const mag = Vision._sobel(blur, w, h);
  let maxMag = 0, sumMag = 0;
  for (let i = 0; i < mag.length; i++) { if (mag[i] > maxMag) maxMag = mag[i]; sumMag += mag[i]; }
  const hist = new Uint32Array(256), k = 255 / maxMag;
  for (let i = 0; i < mag.length; i++) hist[Math.min(255, Math.round(mag[i]*k))]++;
  const otsu = Vision._otsu(hist, w*h) / k;

  const res = [];
  for (const factor of [0.5, 0.75, 1, 1.4, 2]) {
    const thr = Math.max(8, otsu*factor);
    let e1 = new Uint8Array(w*h);
    for (let i=0;i<mag.length;i++) e1[i] = mag[i] > thr ? 1 : 0;
    const e2 = Vision._dilate(Vision._dilate(e1, w, h), w, h);
    const q = Vision._quadFromEdges(e2, w, h);
    res.push({ factor, thr: Math.round(thr), edges: e1.reduce((s,v)=>s+v,0), quad: q ? { area: +q.areaFrac.toFixed(3), valid: Vision._quadValid(q.quad), quad: q.quad } : null });
  }
  return { size: [w,h], maxMag: Math.round(maxMag), avgMag: Math.round(sumMag/mag.length), otsu: Math.round(otsu), res };
});
console.log(JSON.stringify(dbg, null, 1).slice(0, 3000));
await b.close();
