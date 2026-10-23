/* Validation deskew + ombres + filtres avancés */
import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

const r = await p.evaluate(async () => {
  const mkDoc = (w = 900, h = 1200) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#111'; x.font = 'bold 46px Georgia'; x.fillText('BULLETIN DE PAIE', 60, 110);
    x.font = '26px Georgia';
    for (let i = 0; i < 14; i++) x.fillText('Ligne de texte numero ' + (i + 1) + ' — salaire et cotisations', 60, 190 + i * 56);
    return c;
  };

  // --- A. deskew : texte incliné de +7°
  const doc = mkDoc();
  const tilted = document.createElement('canvas'); tilted.width = doc.width; tilted.height = doc.height;
  const tx = tilted.getContext('2d');
  tx.fillStyle = '#fff'; tx.fillRect(0, 0, tilted.width, tilted.height);
  tx.translate(tilted.width / 2, tilted.height / 2); tx.rotate(7 * Math.PI / 180);
  tx.drawImage(doc, -doc.width / 2, -doc.height / 2);
  const t0 = performance.now();
  const angle = Vision.deskewAngle(tilted);
  const ms = Math.round(performance.now() - t0);
  const fixed = Vision.rotate(tilted, -angle, { maxPx: 1200 });
  const residual = Vision.deskewAngle(fixed);

  // --- B. ombres : dégradé vertical violent sur un document
  const shadowed = mkDoc();
  const sx = shadowed.getContext('2d');
  const g = sx.createLinearGradient(0, 0, shadowed.width, shadowed.height);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0.7)');
  sx.fillStyle = g; sx.fillRect(0, 0, shadowed.width, shadowed.height);
  const measure = (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    // luminosité moyenne des zones « papier » (pixels clairs) en haut vs bas
    const sample = (yFrac) => {
      let sum = 0, n = 0;
      const y0 = Math.floor(cv.height * yFrac), y1 = Math.floor(cv.height * (yFrac + 0.12));
      for (let y = y0; y < y1; y++) for (let x = 0; x < cv.width; x += 3) {
        const i = (y * cv.width + x) * 4;
        if (d[i] > 90) { sum += d[i]; n++; }
      }
      return n ? Math.round(sum / n) : 0;
    };
    return { top: sample(0.05), mid: sample(0.45), bottom: sample(0.78) };
  };
  const before = measure(shadowed);
  Vision.shadowRemove(shadowed);
  const after = measure(shadowed);

  // --- C. filtres avancés
  const vividC = mkDoc(600, 400); Vision.vivid(vividC);

  return { deskew: { detected: angle, residual, ms }, shadow: { before, after },
    urls: { tilted: tilted.toDataURL('image/jpeg', 0.85), fixed: fixed.toDataURL('image/jpeg', 0.85), shadowed: shadowed.toDataURL('image/jpeg', 0.85) } };
});
for (const [k, v] of Object.entries(r.urls)) fs.writeFileSync(`/home/user/scanpro/tests/out/73-${k}.jpg`, Buffer.from(v.split(',')[1], 'base64'));
console.log(JSON.stringify({ deskew: r.deskew, shadow: r.shadow }, null, 1));
await b.close();
