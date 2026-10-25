# Rapport de livraison — V2.24 : correction R11 (traçabilité des pages PDF)

*Branche `fix/r11-page-origin`, base `main` @ `4ed6733` (V2.23.0). Correctif minimal, aucune dépendance ajoutée, aucune donnée réelle.*

## 1. Cause racine (démontrée, voir `docs/DIAGNOSTIC-R11.md`)

`PDF.extractText` (`src/core.js:628`) préserve la pagination page par page, et `docRunOcr` (`src/ui.js:1357/1378/1094`) assemble `doc.text` en insérant des marqueurs `— Page N —` tout en conservant les boîtes de mots indexées par page (`doc.ocrWordBoxes`).

Le chemin **texte** de `Acc.extractBank` découpaît ce texte en lignes sans tenir compte des marqueurs et créait chaque opération avec **`page: 0` codé en dur**. Le seul rattrapage (`findZone`) exige des boîtes de mots ; sans géométrie (`[]`, `[[], []]`), toutes les opérations — y compris celles des pages 2 et 3 — héritaient de la page 0. Le chemin **positions** (`bankFromPositions` → `positionRows`) n'était pas affecté : son numéro de page est l'index du tableau de pages.

Effet adjacent constaté lors de la preuve « avant » : les marqueurs `— Page N —` pouvaient aussi polluer les libellés (`PRLV FICTIF UN — Page 2`).

## 2. Changement exact (deux blocs, `src/ui.js`, chemin texte uniquement)

1. La boucle d'agrégation reconnaît la ligne marqueur `— Page N —` (regex tolérante `—/–/-`, insensible à la casse), met à jour `currentPage = N − 1` (base 0, convention projet), et détache l'opération en cours (`curOp = null`) pour qu'un marqueur ne soit jamais rattaché à un libellé. Chaque opération enregistre `page: currentPage` (null tant qu'aucun marqueur n'a été vu).
2. La résolution finale de page suit un ordre strict, sans jamais inventer :
   1. marqueur textuel (origine certaine) ;
   2. une seule page physique connue (`pagesWords.length === 1`) → `0` ;
   3. `findZone` sur la géométrie si elle existe (comportement historique conservé) ;
   4. sinon **`null`** = origine explicitement inconnue.

Non touchés : chemin positions, fusion texte/positions, dates, libellés, références, montants, soldes, sens, statuts, classification, UI et exports (les transactions n'exposent pas `.page` dans les vues ; `null` n'y est jamais rendu comme une page certaine).

## 3. Tests (100 % fictifs)

Nouvelle suite `tests/e2e-v24-r11-pages.mjs` (16 assertions) :
- **A** : 3 pages sans géométrie, 1 + 2 + 1 opérations → pages `[0,1,1,2]`, 4 transactions uniques, aucune perte ni doublon, marqueurs absents des libellés.
- **B** : chemin avec positions → `[0,1,1]` historique, source `positions OCR` confirmée.
- **C** : document d'une page (deux formes : page physique unique, marqueur unique) → `0`.
- **D** : origine indéterminable (deux pages vides, aucune info de pagination, opération orpheline avant premier marqueur) → `null`, jamais `0`.
- **E** : snapshot exact des 9 champs métier sur les 4 opérations, totaux 68,30 débit / 100,00 crédit, chaîne des soldes cohérente.

Adaptations de tests existants (comportement objet de la correction, pas un affaiblissement) :
- `e2e-v222-dispositions.mjs` R11b : `[0,0,0]` → `[null,null,null]` (origine inconnue explicite) ; R11a `[0,1,1]` inchangé.
- `audit-bank-repro.mjs` R11 : le défaut n'est plus reproduit → audit global `0 défaut / 14 hypothèses non confirmées`.

**Preuve avant/après** : correctif mis de côté (`git stash`) → 6 échecs ciblés (A2, A5, D1, D2, D3, E1, dont la pollution de libellé) ; correctif réappliqué → 16/16.

## 4. Compteurs réels d'exécution

- Noyau CI `tests/run-ci.sh` (14 suites, nouvelle suite en tête) : **367 assertions, 0 échec** (351 en V2.23 + 16 nouvelles).
- Suites hors noyau revérifiées : audit-bank-repro (0 défaut/14), e2e-v216-banque 18/0, e2e-v214 15/0, e2e-compta-l3 23/0.
- Build `python3 build.py` OK, version `2.24.0` dans `src/app.js`, `src/sw.js`, `sw.js`, `index.html` reconstruit.
- Aucune erreur JavaScript `pageerror` dans les suites.

## 5. Limites (inchangées, honnêtement documentées)

- `page: null` est émis chaque fois que l'origine ne peut être démontrée (texte sans marqueur et sans géométrie) : l'application n'affiche jamais ce `null` comme une page certaine.
- Relevé réel non testé (`BANK_PDF_PATH`, interdit par les contraintes) ; les suites OCR Tesseract (v218, v25) et scripts hérités restent hors noyau CI ; échecs préexistants de `main` non liés à R11 (e2e.mjs timeout, e2e-gh tiers cassé, validate-exports.py PyMuPDF absent).
- Fusion et déploiement réalisés **après accord explicite** : PR #14 fusionnée par merge commit `6c58651`, déploiement GitHub Pages run `40226815090` *success*.

## 6. Preuves de mise en production (live https://azharshahim.github.io/Scanpro-ai/)

- Version affichée `2.24.0`, `sw.js` live en cache `scanpro-ai-v2.24.0`.
- SHA-256 de `index.html` live identique à celui du commit fusionné `6c58651` : `dbfac3ea7d510c2959be32d3d4ff7601b00aec827d47c93207d562efa9342bff`.
- Tests exécutés contre l'URL publique : `e2e-v24-r11-pages` **16/16**, `e2e-v223-assistant` **38/38**, 0 erreur JavaScript.
- Check distant « Tests Playwright » sur la PR : *success* avant fusion.

## 7. Correctif d'affichage « À propos » (PR #15, merge `3e3b84d`, déploiement run `40232703436`)

- Constats après mise en production : le panneau Paramètres → « Aide et version » affichait encore **2.23.0**. Cause : chaîne codée en dur dans `src/views.js` (`version 2.23.0 (Web)`) non couverte par le bump, alors que la version canonique `window.ScanPro.version` et le cache du service worker étaient déjà en 2.24.0. Ce n'était pas un problème de cache (SW network-first pour les pages, `skipWaiting` + `clients.claim`).
- Correction : le libellé utilise désormais `${ScanPro.version}` (source unique, divergence impossible à l'avenir).
- Garde-fou : assertion de non-régression dans `e2e-v221-ux.mjs` sur 6 largeurs (suite 56 → 62 assertions). Noyau CI : **14 suites, 373 assertions, 0 échec**.
- Vérification live : `index.html` byte-identique au commit `3e3b84d` (SHA-256 `3e0b3ee8…f078d52c`), une seule occurrence `2.24.0` dans le bundle, sonde navigateur sur l'URL publique = « ScanPro AI — version 2.24.0 (Web) », suites live `e2e-v221-ux` 62/62 et `e2e-v24-r11-pages` 16/16.
