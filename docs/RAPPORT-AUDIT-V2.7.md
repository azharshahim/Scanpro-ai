# Rapport d'audit qualité — ScanPro AI V2.7

- **Date** : 24 octobre 2026
- **Version auditée (production)** : 2.7.0 — https://azharshahim.github.io/Scanpro-ai/ (`main` = `c8bb3a0`, tag `v2.7.0`)
- **Branche de correction** : `fix/audit-qualite-v2.7` (créée depuis `origin/main`, **non fusionnée**)
- **Environnement de test** : Chromium émulé « Pixel 7 » en 360×740 via Playwright, serveur local, données fictives.
- **Non exécuté** : aucun test sur téléphone Android physique (voir §5). Aucun résultat non exécuté n'est déclaré réussi.

## 1. Résultats chiffrés (navigateur simulé)

| Suite | Résultat |
|---|---|
| `tests/e2e-audit-v27.mjs` (nouvelle, régression coins + filigrane) | **16/16** |
| `tests/e2e-audit-extra.mjs` (nouvelle : hors-ligne, SW, zones tactiles, refus caméra, requêtes externes) | **8/8** |
| `tests/e2e-v27.mjs` | **10/10** |
| `tests/e2e-v26.mjs` | **12/12** |
| `tests/e2e-v25.mjs` | **8/8** |
| `tests/e2e-v24.mjs` | **8/8** |
| `tests/e2e-v23.mjs` | **8/8** |
| `tests/e2e-v22.mjs` + `tests/pdf-tools-v22.mjs` | **18/18** + extraction PDF OK |
| `tests/e2e-v21.mjs` | **13/13** |
| `tests/e2e-v2.mjs` | **16/16** |
| `tests/e2e.mjs`, `tests/e2e2.mjs`, `vision-test*.mjs`, `perf-v2.mjs`, `desktop.mjs` | OK, zéro erreur console |

**Total : 117 vérifications comptées réussies, 0 échec, 0 erreur console, 0 requête échouée sur l'ensemble des suites exécutées.**
Non exécutés : tests sur appareil Android réel, caméra réelle, feuille de partage native, impression — listés au §5.

## 2. Problèmes confirmés et corrigés

### A-01 — Choix manuel des 4 coins : image déformée — **Gravité : élevée**
- **Fonctionnalité** : Éditeur → ajustement manuel des 4 coins, validation de la perspective.
- **Reproduction** : importer une image portrait, ouvrir les 4 coins, placer les poignées, valider → l'aperçu est écrasé verticalement, les poignées ne suivent pas le doigt et le résultat ressort pivoté/déformé (capture utilisateur du 24/10/2026).
- **Attendu** : aperçu au ratio réel, poignées et polygone exactement sous le doigt, perspective fidèle au quadrilatère choisi.
- **Observé (avant)** : aperçu écrasé ; décalage vertical des poignées ; rotation supplémentaire après validation.
- **Cause technique** : (1) le canevas des coins héritait de `.editor-stage canvas{max-height:38dvh}` qui l'écrasait ; (2) poignées et SVG étaient positionnés en % d'un conteneur incluant la barre d'outils, alors que le toucher est calculé sur le canevas ; (3) un redressement automatique (deskew) était appliqué systématiquement après une perspective pourtant choisie à la main.
- **Fichiers** : `src/ui.js` (`editorCorners()`, validation), `src/style.css` (règle contournée localement).
- **Correction** : cadre dédié positionné sur le seul canevas, `width:100%;height:auto;max-height:none`, SVG et poignées dans ce cadre, barre d'outils hors cadre ; deskew post-validation rendu conditionnel via `Vision.deskewAngleDetailed()` (|angle| ≥ 1° **et** gain de confiance ≥ 15 %).
- **Retest** : ratio affiché 0,74 = ratio source 0,74 ; poignée bas-droite mesurée à 97 %/97 % ; validation sans rotation abusive (deskew 0 sur le cas de test) — `e2e-audit-v27.mjs` 16/16, capture `tests/out/108-audit-coins.png`.

### A-02 — Aucune option pour les filigranes (« SPECIMEN ») — **Gravité : moyenne**
- **Fonctionnalité** : Nettoyage magique (Studio).
- **Reproduction** : scanner un document portant un filigrane clair → aucun réglage ne permet de l'atténuer.
- **Attendu** : un choix explicite d'atténuation, sans dégrader le texte.
- **Observé (avant)** : option absente.
- **Cause technique** : `Vision.magicClean()` ne traitait que l'éclairage, le bruit et la netteté.
- **Fichiers** : `src/vision.js` (`magicClean`, option `cleanup.watermark`), `src/ui.js` (bouton « Atténuer le filigrane » du Studio).
- **Correction** : bouton dédié ; les pixels clairs/grisés ou faiblement teintés (luminance > 100, faible écart chromatique) sont poussés vers le blanc, l'encre sombre est préservée. Traitement local, non destructif (l'original reste conservé, Annuler/Rétablir inchangés).
- **Retest** : même page rendue avec/sans option : luminance moyenne **204,4 → 238,0**, pixels d'encre sombre préservés (4 987 → 4 983 au seuil mesuré).
- **Limite honnête** : il s'agit d'une **atténuation des filigranes clairs**, pas d'une suppression générative. Un filigrane foncé, coloré saturé ou recouvrant le texte ne peut pas être effacé de façon fiable hors-ligne, et le texte masqué ne peut pas être reconstruit.

### A-03 — Service worker : cache figé et OCR hors-ligne incomplet — **Gravité : faible**
- **Fonctionnalité** : PWA / fonctionnement hors-ligne.
- **Reproduction** : inspection de `src/sw.js` : nom de cache `scanpro-ai-v1` inchangé depuis la V1 ; seuls les packs OCR FR/EN étaient pré-cachés.
- **Attendu** : invalidation du cache à chaque évolution et OCR ES/DE/IT/PT disponible hors-ligne après premier chargement.
- **Observé (avant)** : risque de bibliothèques périmées servies en « cache d'abord » ; langues V2.5 absentes du pré-cache.
- **Cause technique** : constante `CACHE` jamais incrémentée ; liste `ASSETS` non mise à jour en V2.5.
- **Fichiers** : `src/sw.js` (et `sw.js` régénéré par `build.py`).
- **Correction** : cache renommé `scanpro-ai-v2.7-audit1` (purge l'ancien à l'activation) ; ajout des packs `spa`, `deu`, `ita`, `por` au pré-cache.
- **Retest** : `e2e-audit-extra.mjs` — service worker `activated`, rechargement **hors-ligne** de l'application réussi (8/8).

## 3. Points vérifiés sans anomalie

- Navigation Accueil / Documents / Outils (25 tuiles) / Paramètres / retour : aucun débordement horizontal à 360 px, aucune modale impossible à fermer (fermeture au toucher extérieur vérifiée), zones tactiles ≥ 36 px sur l'écran Outils.
- Parcours couverts par les suites : scan simulé et rafale, import galerie et PDF, recadrage/rotation/filtres, OCR FR et ES réel, réorganisation des pages, fusion de PDF, PDF enrichi, exports/partages PDF-DOCX-XLSX-TXT, sauvegarde/restauration ZIP, recherche, renommage, suppression, thèmes clair/sombre.
- **Confidentialité** : pendant tout l'audit, **aucune requête vers un domaine externe** n'a été observée ; tout le traitement (OCR, PDF, nettoyage) est local. Le repli CDN jsDelivr ne charge que des bibliothèques publiques, uniquement si un fichier local échoue, et n'envoie aucun document.
- **Refus caméra** : `getUserMedia` rejeté (`NotAllowedError`) → l'application reste stable, sans erreur console (message d'erreur français affiché par le parcours existant).
- Persistance IndexedDB, restauration ZIP sans écrasement et PDF générés : validés par les suites V2→V2.4 relancées sans modification.

## 4. Limites et risques résiduels (non corrigés, assumés)

- Filigrane : atténuation des filigranes clairs uniquement (voir A-02).
- Le redressement automatique reste volontairement conservateur : un document volontairement photographié très incliné peut exiger l'ajustement manuel des coins (comportement V2.7 préservé).
- Assistant IA génératif distant : toujours reporté (aucune clé API utilisateur) — décision déjà actée.
- XLSX : champs facture ou lignes OCR, sans mise en forme comptable ; DOCX simple ; PDF chiffrés refusés.

## 5. À valider sur un vrai téléphone Android (non exécuté)

1. Caméra réelle : autorisation, refus depuis les réglages système, capture multi-pages, netteté en basse lumière.
2. Glisser des poignées des 4 coins au doigt sur petit écran (le test simulé utilise des événements pointeur émulés).
3. Feuille de partage native Android (PDF/DOCX/XLSX/TXT) vers WhatsApp/Gmail/Drive, et repli téléchargement.
4. Hors-ligne réel en mode avion après installation PWA, puis mise à jour vers la version corrigée (bascule de cache A-03).
5. Gros documents (20+ pages, photos 12 Mpx) : mémoire, temps d'OCR, comportement en cas de stockage plein.
6. Bouton retour physique Android dans l'éditeur et les modales.

## 6. Livraison

- Branche `fix/audit-qualite-v2.7` : corrections A-01/A-02/A-03 + tests `tests/e2e-audit-v27.mjs` et `tests/e2e-audit-extra.mjs` + présent rapport.
- **Aucune fusion dans `main`** : la production reste en 2.7.0 tant que l'utilisateur n'a pas validé.
- Publication de la branche : nécessite un jeton GitHub valide au moment du push (le précédent n'est plus disponible côté environnement) ; à révoquer après usage, comme d'habitude.
