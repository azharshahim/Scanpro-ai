// V2.19 : responsive et navigation — largeurs 320→1024, Scan intégré sans
// débordement, accès Paramètres unique, thèmes, navigation complète, 0 erreur JS.
import { chromium, devices } from 'playwright';
const APP = process.env.APP_URL || 'http://127.0.0.1:8080/index.html';
const ok = [], ko = []; const check = (l, c, e = '') => { (c ? ok : ko).push(l); console.log((c ? '✅' : '❌') + ' ' + l + (e ? ' — ' + e : '')); };
const WIDTHS = [320, 360, 390, 430, 768, 1024];
const b = await chromium.launch();
for (const w of WIDTHS) {
  const ctx = await b.newContext({ viewport: { width: w, height: 740 }, locale: 'fr-FR', isMobile: w < 768, hasTouch: true });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1300);
  await p.locator('.sheet .btn.primary').click().catch(() => {});
  const m = await p.evaluate(() => {
    const de = document.documentElement;
    const nav = document.querySelector('#bottomNav').getBoundingClientRect();
    const scan = document.querySelector('#fabScan').getBoundingClientRect();
    const items = [...document.querySelectorAll('#bottomNav .nav-item')].map(el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; });
    const overlap = items.some((a, i) => items.some((c, j) => j > i && a.l < c.r - 1 && c.l < a.r - 1));
    return { sw: de.scrollWidth, iw: window.innerWidth, nav: { l: nav.left, r: nav.right, t: nav.top, b: nav.bottom, h: nav.height },
      scan: { l: scan.left, r: scan.right, t: scan.top, b: scan.bottom, w: scan.width, h: scan.height },
      items: items.length, overlap, settingsNav: document.querySelectorAll('[data-nav="settings"]').length,
      labelsCut: [...document.querySelectorAll('#bottomNav .nav-item span:last-child')].filter(s => s.scrollWidth > s.clientWidth + 1).map(s => s.textContent) };
  });
  check(`[${w}px] Aucun débordement horizontal (scrollWidth ≤ innerWidth)`, m.sw <= m.iw + 1, `sw=${m.sw} iw=${m.iw}`);
  check(`[${w}px] Scan intégré DANS la barre (aucun débordement vertical)`, m.scan.t >= m.nav.t - 1 && m.scan.b <= m.nav.b + 1 && m.scan.l >= m.nav.l && m.scan.r <= m.nav.r + 1, JSON.stringify({ scanT: Math.round(m.scan.t), navT: Math.round(m.nav.t), scanB: Math.round(m.scan.b), navB: Math.round(m.nav.b) }));
  check(`[${w}px] 5 rubriques sans superposition, zones tactiles ≥ 44 px`, m.items === 5 && !m.overlap && m.scan.w >= 44 && m.scan.h >= 44, `items=${m.items} scan=${Math.round(m.scan.w)}x${Math.round(m.scan.h)}`);
  check(`[${w}px] Paramètres : aucune rubrique dans la barre principale`, m.settingsNav === 0);
  check(`[${w}px] Aucun libellé de navigation tronqué`, m.labelsCut.length === 0, m.labelsCut.join(','));
  check(`[${w}px] Aucune erreur JS`, errs.length === 0, errs.slice(0, 2).join('|'));
  // Navigation complète
  for (const nav of ['docs', 'acc', 'tools', 'home']) {
    await p.locator(`[data-nav="${nav}"]`).click(); await p.waitForTimeout(450);
    const route = await p.evaluate(() => window.ScanPro.App.route);
    if (route !== nav) check(`[${w}px] Navigation → ${nav}`, false, 'route=' + route);
  }
  check(`[${w}px] Navigation Accueil/Documents/Compta/Outils OK`, true);
  // Paramètres via l'accès unique (Accueil)
  await p.locator('[data-nav="home"]').click(); await p.waitForTimeout(450);
  const gearCount = await p.locator('[data-act="go-settings"]').count();
  await p.locator('[data-act="go-settings"]').first().click(); await p.waitForTimeout(600);
  const sRoute = await p.evaluate(() => window.ScanPro.App.route);
  const sections = await p.locator('.set-group h3').allInnerTexts();
  check(`[${w}px] Paramètres accessible une seule fois (Accueil) et sections organisées`, gearCount === 1 && sRoute === 'settings' && sections.some(s => /apparence/i.test(s)) && sections.some(s => /comptabilit/i.test(s)) && sections.some(s => /ocr/i.test(s)), sections.join(' · ').slice(0, 90));
  // Thème sombre cohérent + retour clair
  await p.locator('[data-act="toggle-theme"]').click(); await p.waitForTimeout(400);
  const dark = await p.evaluate(() => document.documentElement.dataset.theme === 'dark');
  const darkOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(`[${w}px] Thème sombre cohérent, sans débordement`, dark && darkOverflow);
  await p.locator('[data-act="toggle-theme"]').click(); await p.waitForTimeout(300);
  await ctx.close();
}
// Parcours Scan : le bouton ouvre bien le parcours (caméra/import), retour propre
{
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 740 }, locale: 'fr-FR' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  await p.goto(APP, { waitUntil: 'load', timeout: 60000 }); await p.waitForTimeout(1300);
  await p.locator('.sheet .btn.primary').click().catch(() => {});
  await p.locator('#fabScan').click(); await p.waitForTimeout(1200);
  const camVisible = await p.evaluate(() => !!document.querySelector('.capture, #captureRoot .sheet, .cam-stage, video'));
  const importVisible = await p.locator('body').innerText().then(t => /caméra|galerie|Importer|photo/i.test(t));
  check('Parcours Scan : le bouton Scan ouvre le parcours de capture/import', camVisible || importVisible);
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(() => { const x = document.querySelector('[data-act="camera-close"], [data-act="close-sheet"], .capture [data-act]'); if (x) x.click(); });
  await p.waitForTimeout(600);
  check('Parcours Scan : aucune erreur JS', errs.length === 0, errs.slice(0, 2).join('|'));
  await ctx.close();
}
console.log(`\n===== V2.19 UX RESPONSIVE : ${ok.length} OK / ${ko.length} échec(s) =====`);
await b.close(); process.exit(ko.length ? 1 : 0);
