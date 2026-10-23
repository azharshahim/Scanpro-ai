/* Validation du moteur de vision V2 sur une photo de document inclinée.
   Cible : quad détecté proche de la vérité terrain, warp -> rectangle droit,
   deskew proche de l'angle injecté. */
import { chromium } from 'playwright';
import fs from 'fs';

const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

const res = await p.evaluate(async () => {
  // --- vérité terrain : document incliné sur un fond sombre
  const TRUTH = { tl: { x: 0.16, y: 0.10 }, tr: { x: 0.87, y: 0.19 }, br: { x: 0.82, y: 0.88 }, bl: { x: 0.11, y: 0.80 } };
  const W = 1000, H = 1300;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const ctx = src.getContext('2d');
  // fond (bureau) avec léger dégradé
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#3b3b46'); grad.addColorStop(1, '#20222c');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  // contenu du document, dessiné droit puis mappé par perspective inverse
  const doc = document.createElement('canvas'); doc.width = 700; doc.height = 990;
  const d = doc.getContext('2d');
  d.fillStyle = '#fff'; d.fillRect(0, 0, 700, 990);
  d.fillStyle = '#111'; d.font = 'bold 42px Georgia'; d.fillText('FACTURE 2026-042', 40, 80);
  d.font = '24px Georgia';
  let y = 140;
  for (const line of ['Client : Monsieur Jean Martin', 'Date : 12/10/2026', 'Total HT : 2 500,00 EUR', 'TVA 20 % : 500,00 EUR', 'Total TTC : 3 000,00 EUR', 'Paiement a reception', 'Merci de votre confiance']) {
    d.fillText(line, 40, y); y += 44;
  }
  d.strokeStyle = '#888'; d.strokeRect(38, 100, 620, 340);

  // mapping homographique doc -> quadrilatère cible
  const dstPts = [ { x: TRUTH.tl.x * W, y: TRUTH.tl.y * H }, { x: TRUTH.tr.x * W, y: TRUTH.tr.y * H },
                   { x: TRUTH.br.x * W, y: TRUTH.br.y * H }, { x: TRUTH.bl.x * W, y: TRUTH.bl.y * H } ];
  const srcPts = [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 700, y: 990 }, { x: 0, y: 990 }];
  const M = Vision._homography(dstPts, srcPts); // scène -> doc (mapping inverse pour le rendu)
  const [a, bb, c, dd, e, f, g, h] = M;
  const sw = doc.width, sh = doc.height;
  const sd = d.getImageData(0, 0, sw, sh).data;
  const out = ctx.getImageData(0, 0, W, H);
  const od = out.data;
  for (let y2 = 0; y2 < H; y2++) {
    let nu = c + bb * y2, nv = f + e * y2, den = 1 + h * y2;
    for (let x2 = 0; x2 < W; x2++) {
      const u = nu / den, v = nv / den; nu += a; nv += dd; den += g;
      if (u < 0 || v < 0 || u >= sw || v >= sh) continue;
      const si = ((v | 0) * sw + (u | 0)) * 4, oi = (y2 * W + x2) * 4;
      od[oi] = sd[si]; od[oi + 1] = sd[si + 1]; od[oi + 2] = sd[si + 2]; od[oi + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const photo = src.toDataURL('image/jpeg', 0.92);

  // --- détection
  const t0 = performance.now();
  const det = Vision.detectQuad(src);
  const tDetect = performance.now() - t0;

  const errOf = (q) => Math.max(
    Math.hypot(q.tl.x - TRUTH.tl.x, q.tl.y - TRUTH.tl.y),
    Math.hypot(q.tr.x - TRUTH.tr.x, q.tr.y - TRUTH.tr.y),
    Math.hypot(q.br.x - TRUTH.br.x, q.br.y - TRUTH.br.y),
    Math.hypot(q.bl.x - TRUTH.bl.x, q.bl.y - TRUTH.bl.y));

  // --- warp
  let warpOk = null, warped = null, angle = null, deskewedAngle = null, finalCanvas = null;
  if (det) {
    const t1 = performance.now();
    warped = Vision.warp(src, det.quad, { maxPx: 1600 });
    const tWarp = performance.now() - t1;
    const ratio = warped.height / warped.width;
    warpOk = { w: warped.width, h: warped.height, ratio: +ratio.toFixed(3), ms: Math.round(tWarp) };
    angle = Vision.deskewAngle(warped);
    // vérifie qu'il ne reste quasi plus d'inclinaison
    finalCanvas = Vision.rotate(warped, -angle, { maxPx: 1600 });
    deskewedAngle = Vision.deskewAngle(finalCanvas);
  }
  return {
    detection: det ? { quad: det.quad, areaFrac: +det.areaFrac.toFixed(3), errNorm: +errOf(det.quad).toFixed(4), ms: Math.round(tDetect) } : null,
    truth: TRUTH, warpOk, angleAfterWarp: angle, angleAfterDeskew: deskewedAngle,
    warpedUrl: warped ? warped.toDataURL('image/jpeg', 0.85) : null,
    finalUrl: finalCanvas ? finalCanvas.toDataURL('image/jpeg', 0.85) : null,
    photoUrl: photo
  };
});

fs.writeFileSync('/home/user/scanpro/tests/out/70-v2-photo.jpg', Buffer.from(res.photoUrl.split(',')[1], 'base64'));
if (res.warpedUrl) fs.writeFileSync('/home/user/scanpro/tests/out/71-v2-warp.jpg', Buffer.from(res.warpedUrl.split(',')[1], 'base64'));
if (res.finalUrl) fs.writeFileSync('/home/user/scanpro/tests/out/72-v2-deskew.jpg', Buffer.from(res.finalUrl.split(',')[1], 'base64'));
console.log(JSON.stringify({ ...res, warpedUrl: undefined, finalUrl: undefined, photoUrl: undefined }, null, 1));
await b.close();
