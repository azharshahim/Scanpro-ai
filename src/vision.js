/* =============================================================================
 * ScanPro AI — V2 : moteur de vision (100 % local, sans dépendance)
 *  - détection automatique du quadrilatère du document (Sobel + Otsu + flood fill)
 *  - correction de perspective par homographie (interpolation bilinéaire)
 *  - redressement (deskew) par maximisation de la variance des projections
 *  - filtres avancés (suppression des ombres, vif, texte noir)
 * ========================================================================== */
'use strict';

const Vision = {
  /* ------------------------------------------------------------------ base -- */

  /** Convertit un canvas en niveaux de gris, redimensionné à maxDim. */
  _gray(canvas, maxDim = 520) {
    const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    const w = Math.max(2, Math.round(canvas.width * scale));
    const h = Math.max(2, Math.round(canvas.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; j < g.length; i += 4, j++) {
      g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return { g, w, h };
  },

  /** Flou moyen séparable (deux passes horizontale + verticale). */
  _boxBlur(src, w, h, r = 2) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const win = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / win;
        const add = row + Math.min(w - 1, x + r + 1);
        const sub = row + Math.max(0, x - r);
        acc += src[add] - src[sub];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / win;
        const add = Math.min(h - 1, y + r + 1) * w + x;
        const sub = Math.max(0, y - r) * w + x;
        acc += tmp[add] - tmp[sub];
      }
    }
    return out;
  },

  /** Magnitude du gradient de Sobel. */
  _sobel(g, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1];
        const d = g[i - 1], f = g[i + 1];
        const p = g[i + w - 1], q = g[i + w], r2 = g[i + w + 1];
        const gx = (c + 2 * f + r2) - (a + 2 * d + p);
        const gy = (p + 2 * q + r2) - (a + 2 * b + c);
        out[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return out;
  },

  /** Seuil d'Otsu sur un histogramme 256 classes. */
  _otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  },

  _dilate(edges, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (edges[i]) { out[i] = 1; continue; }
        let hit = 0;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= w) continue;
            if (edges[yy * w + xx]) { hit = 1; break; }
          }
        }
        out[i] = hit;
      }
    }
    return out;
  },

  /* ------------------------------------------------- quadrilatère détecté -- */

  /**
   * Recherche la plus grande zone fermée par des contours = le document.
   * Retourne {quad, areaFrac} en coordonnées normalisées, ou null.
   */
  _quadFromEdges(edges, w, h) {
    const n = w * h;
    const visited = new Uint8Array(n);
    const stack = new Int32Array(n);
    let sp = 0;
    const pushBg = (i) => { if (!visited[i] && !edges[i]) { visited[i] = 1; stack[sp++] = i; } };
    for (let x = 0; x < w; x++) { pushBg(x); pushBg((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { pushBg(y * w); pushBg(y * w + w - 1); }
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i - x) / w;
      if (x > 0) pushBg(i - 1);
      if (x < w - 1) pushBg(i + 1);
      if (y > 0) pushBg(i - w);
      if (y < h - 1) pushBg(i + w);
    }

    const queue = new Int32Array(n);
    let bestArea = 0, best = null;
    for (let start = 0; start < n; start++) {
      if (visited[start]) continue;
      let head = 0, tail = 0, area = 0;
      queue[tail++] = start; visited[start] = 1;
      let minS = Infinity, maxS = -Infinity, minD = Infinity, maxD = -Infinity;
      let tl = null, br = null, tr = null, bl = null;
      while (head < tail) {
        const i = queue[head++];
        const x = i % w, y = (i - x) / w;
        area++;
        const s = x + y, d = x - y;
        if (s < minS) { minS = s; tl = { x, y }; }
        if (s > maxS) { maxS = s; br = { x, y }; }
        if (d > maxD) { maxD = d; tr = { x, y }; }
        if (d < minD) { minD = d; bl = { x, y }; }
        if (x > 0 && !visited[i - 1]) { visited[i - 1] = 1; queue[tail++] = i - 1; }
        if (x < w - 1 && !visited[i + 1]) { visited[i + 1] = 1; queue[tail++] = i + 1; }
        if (y > 0 && !visited[i - w]) { visited[i - w] = 1; queue[tail++] = i - w; }
        if (y < h - 1 && !visited[i + w]) { visited[i + w] = 1; queue[tail++] = i + w; }
      }
      if (area > bestArea && tl && tr && br && bl) {
        bestArea = area; best = { tl, tr, br, bl, area };
      }
    }
    if (!best) return null;

    const quad = {
      tl: { x: best.tl.x / w, y: best.tl.y / h },
      tr: { x: best.tr.x / w, y: best.tr.y / h },
      br: { x: best.br.x / w, y: best.br.y / h },
      bl: { x: best.bl.x / w, y: best.bl.y / h }
    };
    return { quad, areaFrac: best.area / n };
  },

  quadArea(q) {
    const p = [q.tl, q.tr, q.br, q.bl];
    let a = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      a += p[i].x * p[j].y - p[j].x * p[i].y;
    }
    return Math.abs(a) / 2;
  },

  /** Vérifie qu'un quadrilatère est exploitable (convexe, assez grand, ordonné). */
  _quadValid(q) {
    if (!q || !q.tl || !q.tr || !q.br || !q.bl) return false;
    const pts = [q.tl, q.tr, q.br, q.bl];
    for (const p of pts) {
      if (!isFinite(p.x) || !isFinite(p.y)) return false;
      if (p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02) return false;
    }
    const area = this.quadArea(q);
    if (area < 0.06 || area > 0.995) return false;
    // côtés non dégénérés
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const sides = [dist(q.tl, q.tr), dist(q.tr, q.br), dist(q.br, q.bl), dist(q.bl, q.tl)];
    const diag = Math.hypot(1, 1);
    if (Math.min(...sides) < diag * 0.08) return false;
    // convexité (produits vectoriels de même signe)
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) < 1e-6) continue;
      const s = Math.sign(cr);
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  },

  /**
   * Détecte le document sur un canvas/image.
   * @returns {{quad:{tl,tr,br,bl}, areaFrac:number}|null} quad normalisé (0..1)
   */
  detectQuad(canvas) {
    try {
      const { g, w, h } = this._gray(canvas, 520);
      const blur = this._boxBlur(g, w, h, 2);
      const mag = this._sobel(blur, w, h);

      let maxMag = 0;
      for (let i = 0; i < mag.length; i++) if (mag[i] > maxMag) maxMag = mag[i];
      if (maxMag < 8) return null;                     // image trop uniforme

      const hist = new Uint32Array(256);
      const k = 255 / maxMag;
      for (let i = 0; i < mag.length; i++) hist[Math.min(255, Math.round(mag[i] * k))]++;
      const otsu = this._otsu(hist, w * h) / k;

      let best = null;
      // plusieurs seuils : on garde le meilleur quadrilatère plausible
      for (const factor of [1, 0.75, 1.4]) {
        const thr = Math.max(10, otsu * factor);
        let edges = new Uint8Array(w * h);
        for (let i = 0; i < mag.length; i++) edges[i] = mag[i] > thr ? 1 : 0;
        edges = this._dilate(edges, w, h);
        edges = this._dilate(edges, w, h);
        const res = this._quadFromEdges(edges, w, h);
        if (!res || !this._quadValid(res.quad)) continue;
        if (res.areaFrac > 0.985) continue;             // cadre entier : rien à corriger
        const score = res.areaFrac * (factor === 1 ? 1.15 : 1);
        if (!best || score > best.score) best = { quad: res.quad, areaFrac: res.areaFrac, score };
      }
      if (!best) return null;
      return { quad: this._orderQuad(best.quad), areaFrac: best.areaFrac };
    } catch (e) {
      console.warn('[Vision] detectQuad', e);
      return null;
    }
  },

  /** Force l'ordre TL, TR, BR, BL (par angle autour du centre). */
  _orderQuad(q) {
    const cx = (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4;
    const cy = (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4;
    const pts = [q.tl, q.tr, q.br, q.bl]
      .map(p => ({ x: p.x, y: p.y, a: Math.atan2(p.y - cy, p.x - cx) }))
      .sort((p, r) => p.a - r.a);
    // le premier point est celui de plus petit angle : on décale pour partir du haut-gauche
    let start = 0, bestSum = Infinity;
    pts.forEach((p, i) => { const s = p.x + p.y; if (s < bestSum) { bestSum = s; start = i; } });
    const r = [pts[start], pts[(start + 1) % 4], pts[(start + 2) % 4], pts[(start + 3) % 4]];
    return {
      tl: { x: r[0].x, y: r[0].y }, tr: { x: r[1].x, y: r[1].y },
      br: { x: r[2].x, y: r[2].y }, bl: { x: r[3].x, y: r[3].y }
    };
  },

  /* ------------------------------------------------------------- warp 4 pts -- */

  /** Résolution d'un système linéaire n×n (pivot partiel). */
  _solve(A, b, n) {
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      if (Math.abs(A[p][i]) < 1e-12) return null;
      if (p !== i) { const t = A[p]; A[p] = A[i]; A[i] = t; const tb = b[p]; b[p] = b[i]; b[i] = tb; }
      const piv = A[i][i];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / piv;
        if (!f) continue;
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  },

  /** Homographie qui envoie src[i] sur dst[i] (i = 0..3). Retourne [a,b,c,d,e,f,g,h]. */
  _homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], { x: u, y: v } = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    return this._solve(A, b, 8);
  },

  /**
   * Corrige la perspective : le quadrilatère `quad` (normalisé) devient un
   * rectangle droit. `quad` est exprimé dans le repère du canvas source.
   */
  warp(srcCanvas, quad, { maxPx = 2400 } = {}) {
    const W = srcCanvas.width, H = srcCanvas.height;
    const P = [
      { x: quad.tl.x * W, y: quad.tl.y * H },
      { x: quad.tr.x * W, y: quad.tr.y * H },
      { x: quad.br.x * W, y: quad.br.y * H },
      { x: quad.bl.x * W, y: quad.bl.y * H }
    ];
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const wTop = dist(P[0], P[1]), wBottom = dist(P[3], P[2]);
    const hLeft = dist(P[0], P[3]), hRight = dist(P[1], P[2]);
    let outW = Math.max(8, Math.round(Math.max(wTop, wBottom)));
    let outH = Math.max(8, Math.round(Math.max(hLeft, hRight)));
    const k = Math.min(1, maxPx / Math.max(outW, outH));
    outW = Math.max(8, Math.round(outW * k));
    outH = Math.max(8, Math.round(outH * k));

    // inverse : de la sortie (rectangle) vers la source (quad)
    const dstPts = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];
    const M = this._homography(dstPts, P);
    if (!M || M.some(v => !isFinite(v))) return srcCanvas;
    const [a, b, c, d, e, f, g2, h2] = M;

    const src = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW; outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    const outImg = outCtx.createImageData(outW, outH);
    const o = outImg.data;

    for (let y = 0; y < outH; y++) {
      let nu = c + b * y, nv = f + e * y, den = 1 + h2 * y;
      const du = a, dv = d, dden = g2;
      for (let x = 0; x < outW; x++) {
        const u = nu / den, v = nv / den;
        nu += du; nv += dv; den += dden;
        const oi = (y * outW + x) * 4;
        if (u < 0 || v < 0 || u > W - 1 || v > H - 1) {
          o[oi] = o[oi + 1] = o[oi + 2] = 255; o[oi + 3] = 255;
          continue;
        }
        const x0 = u | 0, y0 = v | 0;
        const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
        const fx = u - x0, fy = v - y0;
        const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4;
        const i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        o[oi]     = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
        o[oi + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
        o[oi + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
        o[oi + 3] = 255;
      }
    }
    outCtx.putImageData(outImg, 0, 0);
    return outCanvas;
  },

  /* ---------------------------------------------------------------- deskew -- */

  /** Angle (degrés) qui redresse le mieux les lignes de texte, ou 0. */
  acceptQuad(det, source = 'camera') {
    if (!det || !det.quad || !this._quadValid(det.quad)) return false;
    const q = det.quad, area = det.areaFrac || this.quadArea(q);
    const lim = source === 'import' ? 0.32 : 0.48;
    const cornersNear = q.tl.x <= lim && q.tl.y <= lim && q.tr.x >= 1-lim && q.tr.y <= lim && q.br.x >= 1-lim && q.br.y >= 1-lim && q.bl.x <= lim && q.bl.y >= 1-lim;
    if (!cornersNear) return false;
    if (source === 'import' && (area < 0.50 || area > 0.985)) return false;
    if (source !== 'import' && (area < 0.28 || area > 0.99)) return false;
    return true;
  },
  deskewAngle(canvas, opts = {}) { return this.deskewAngleDetailed(canvas, opts).angle; },
  deskewAngleDetailed(canvas, { maxAngle = 10, step = 0.5 } = {}) {
    try {
      const { g, w, h } = this._gray(canvas, 480);
      const hist = new Uint32Array(256);
      for (let i = 0; i < g.length; i++) hist[Math.min(255, g[i] | 0)]++;
      const thr = this._otsu(hist, w * h);
      // masque du texte (pixels sombres)
      const bin = new Uint8Array(w * h);
      let ink = 0;
      for (let i = 0; i < g.length; i++) if (g[i] < thr) { bin[i] = 1; ink++; }
      if (ink < w * h * 0.002 || ink > w * h * 0.6) return { angle: 0, improvement: 0, score: 0 };   // pas de texte net

      const cx = w / 2, cy = h / 2;
      let bestAngle = 0, bestScore = -1; const scores = [];
      for (let a = -maxAngle; a <= maxAngle + 1e-9; a += step) {
        const rad = a * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const rows = new Float32Array(h);
        for (let y = 0; y < h; y++) {
          const dy = y - cy;
          let sum = 0;
          for (let x = 0; x < w; x++) {
            const dx = x - cx;
            const sx = Math.round(cx + dx * cos - dy * sin);
            const sy = Math.round(cy + dx * sin + dy * cos);
            if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
            sum += bin[sy * w + sx];
          }
          rows[y] = sum;
        }
        // variance des projections : maximale quand les lignes s'alignent
        let mean = 0;
        for (let y = 0; y < h; y++) mean += rows[y];
        mean /= h;
        let varr = 0;
        for (let y = 0; y < h; y++) { const d2 = rows[y] - mean; varr += d2 * d2; }
        scores.push({ a, varr });
        if (varr > bestScore) { bestScore = varr; bestAngle = a; }
      }
      const zero = scores.reduce((acc, x) => Math.abs(x.a) < Math.abs(acc.a) ? x : acc, scores[0] || { varr: 0 });
      const improvement = zero.varr > 0 ? (bestScore - zero.varr) / zero.varr : 0;
      const angle = (Math.abs(bestAngle) < 0.6 || improvement < 0.08) ? 0 : Math.round(bestAngle * 10) / 10;
      return { angle, improvement, score: bestScore };
    } catch (e) {
      console.warn('[Vision] deskew', e);
      return 0;
    }
  },

  /** Applique une petite rotation et recadre au plus grand rectangle inscrit. */
  rotate(srcCanvas, deg, { maxPx = 2400 } = {}) {
    if (!deg) return srcCanvas;
    const W = srcCanvas.width, H = srcCanvas.height;
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const s = Math.min(W / (W * Math.abs(cos) + H * Math.abs(sin)),
                         H / (H * Math.abs(cos) + W * Math.abs(sin)));
    const outW = Math.max(8, Math.round(W * s));
    const outH = Math.max(8, Math.round(H * s));
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rad);
    ctx.drawImage(srcCanvas, -W / 2, -H / 2);
    const k = Math.min(1, maxPx / Math.max(outW, outH));
    if (k < 1) {
      const c2 = document.createElement('canvas');
      c2.width = Math.round(outW * k); c2.height = Math.round(outH * k);
      c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height);
      return c2;
    }
    return c;
  },

  /* ------------------------------------------------------- filtres avancés -- */

  /** Suppression des ombres / éclairage inégal : division par le fond estimé. */
  shadowRemove(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width: W, height: H } = canvas;
    const id = ctx.getImageData(0, 0, W, H);
    const d = id.data;

    /* Fond estimé sur une copie réduite (≈ 320 px) puis ré-échantillonné : même
       correction visuelle, coût divisé par ~20 (important sur téléphone). */
    const k = Math.min(1, 320 / Math.max(W, H));
    const sw = Math.max(8, Math.round(W * k)), sh = Math.max(8, Math.round(H * k));
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(canvas, 0, 0, sw, sh);
    const sd = sctx.getImageData(0, 0, sw, sh).data;
    const bg = [new Float32Array(sw * sh), new Float32Array(sw * sh), new Float32Array(sw * sh)];
    for (let c = 0; c < 3; c++) for (let i = 0, j = 0; j < sw * sh; i += 4, j++) bg[c][j] = sd[i + c];
    const r = Math.max(4, Math.round(Math.min(sw, sh) * 0.10));
    for (let c = 0; c < 3; c++) bg[c] = this._boxBlur(bg[c], sw, sh, r);

    const gx = sw / W, gy = sh / H;
    for (let y = 0; y < H; y++) {
      const fy = Math.min(sh - 1.001, y * gy);
      const y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
      for (let x = 0; x < W; x++) {
        const fx = Math.min(sw - 1.001, x * gx);
        const x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
        const i00 = y0 * sw + x0, i10 = y0 * sw + x1, i01 = y1 * sw + x0, i11 = y1 * sw + x1;
        const w00 = (1 - wx) * (1 - wy), w10 = wx * (1 - wy), w01 = (1 - wx) * wy, w11 = wx * wy;
        const di = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) {
          const channel = bg[c];
          const b = Math.max(24,
            channel[i00] * w00 + channel[i10] * w10 + channel[i01] * w01 + channel[i11] * w11);
          const v = d[di + c] / b * 232;
          d[di + c] = v > 255 ? 255 : v;
        }
      }
    }
    ctx.putImageData(id, 0, 0);
  },

  /** Saturation + auto-niveaux doux (mode « Vif »). */
  /**
   * Nettoyage magique V2.2 : correction d'éclairage, nettoyage du fond,
   * débruitage léger, normalisation du contraste et netteté.
   * Opère sur le canvas fourni (le pipeline conserve toujours page.src original).
   */
  magicClean(canvas, opts = {}) {
    const strength = clamp(Number(opts.strength ?? 0.7), 0, 1);
    const denoise = opts.denoise !== false;
    const sharpen = opts.sharpen !== false;
    if (opts.illumination !== false) this.shadowRemove(canvas);
    if (opts.watermark) {
      const wctx = canvas.getContext('2d', { willReadFrequently: true });
      const wimg = wctx.getImageData(0, 0, canvas.width, canvas.height); const wd = wimg.data;
      const wf = 0.55 + strength * 0.4;
      for (let i = 0; i < wd.length; i += 4) {
        const mx = Math.max(wd[i], wd[i+1], wd[i+2]), mn = Math.min(wd[i], wd[i+1], wd[i+2]);
        const lum = 0.299*wd[i] + 0.587*wd[i+1] + 0.114*wd[i+2];
        // filigrane clair/grisé ou teinté léger : on le pousse vers le blanc, l'encre sombre est préservée
        if (lum > 100 && (mx - mn) < 70) { wd[i] += (255-wd[i])*wf; wd[i+1] += (255-wd[i+1])*wf; wd[i+2] += (255-wd[i+2])*wf; }
      }
      wctx.putImageData(wimg, 0, 0);
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return canvas;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data, n = W * H;
    const gray = new Float32Array(n);
    const hist = new Uint32Array(256);
    for (let j = 0, i = 0; j < n; j++, i += 4) {
      gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      hist[Math.max(0, Math.min(255, gray[j] | 0))]++;
    }
    // percentiles robustes : le fond devient blanc, l'encre reste lisible
    const pick = (q) => { let acc = 0; const lim = n * q; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= lim) return v; } return 255; };
    const lo = pick(0.015), hi = pick(0.985);
    const span = Math.max(18, hi - lo);
    const gamma = 1 + strength * 0.22;
    for (let j = 0, i = 0; j < n; j++, i += 4) {
      let v = clamp(((gray[j] - lo) * 255) / span, 0, 255);
      v = 255 * Math.pow(v / 255, gamma);
      if (v > 248 && strength > 0.35) v = 255; // fond jauni/gris -> blanc, sans inventer de texte
      gray[j] = v;
    }
    if (denoise) {
      // médiane 3x3 uniquement sur pixels quasi isolés : supprime poussières/taches
      const src = new Float32Array(gray);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const j = y * W + x, vals = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) vals.push(src[j + dy * W + dx]);
        vals.sort((a, b) => a - b);
        const med = vals[4];
        if (Math.abs(src[j] - med) > 52) gray[j] = med;
      }
    }
    if (sharpen) {
      const src = new Float32Array(gray), amt = 0.28 + strength * 0.35;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const j = y * W + x;
        gray[j] = clamp(src[j] * (1 + 4 * amt) - (src[j-1]+src[j+1]+src[j-W]+src[j+W]) * amt, 0, 255);
      }
    }
    for (let j = 0, i = 0; j < n; j++, i += 4) d[i] = d[i+1] = d[i+2] = gray[j];
    ctx.putImageData(img, 0, 0);
    return canvas;
  },

  async fingerprint(src) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data, vals = []; let sum = 0;
    for (let i = 0; i < d.length; i += 4) { const v = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; vals.push(v); sum += v; }
    const mean = sum / vals.length;
    return { bits: vals.map(v => v >= mean ? '1' : '0').join(''), mean };
  },
  hamming(a, b) { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++; return n; },

  vivid(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i]     = clamp(l + (r - l) * 1.35, 0, 255);
      d[i + 1] = clamp(l + (g - l) * 1.35, 0, 255);
      d[i + 2] = clamp(l + (b - l) * 1.35, 0, 255);
    }
    ctx.putImageData(id, 0, 0);
  }
};
