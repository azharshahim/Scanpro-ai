# ScanPro AI — V2.5 (en-tête mobile, langues OCR, nuit/jour)

Scanner de documents pour Android (web app installable) : caméra, **détection automatique des
contours**, **correction de perspective**, redressement, recadrage, filtres avancés,
**OCR réel français/anglais**, texte éditable, **export PDF**, fusion de PDF, OCR des PDF importés,
assistant local — **100 % sur l'appareil, sans compte ni serveur**.

**Versions** — V2 : `docs/V2-NOUVEATURES.md` · V2.1 : `docs/V2.1-NOUVEATURES.md` · V2.2 : `docs/V2.2-NOUVEATURES.md` · V2.3 : `docs/V2.3-NOUVEATURES.md` · V2.4 : `docs/V2.4-NOUVEATURES.md`.

👉 **Tester maintenant :** ouvrez la prévisualisation live du workspace (dossier `scanpro`),
ou `docs/GUIDE-TEST.md` pour la procédure pas à pas sur téléphone.

## Hébergement

**Application en ligne : https://azharshahim.github.io/Scanpro-ai/**

| Élément | État |
|---|---|
| GitHub Pages (déploiement par GitHub Actions) | ✅ actif, HTTPS forcé |
| Workflow `.github/workflows/pages.yml` | ✅ déploie `main` à chaque push |
| Service worker + manifeste PWA | ✅ installable sur l'écran d'accueil Android |
| Fichiers `vendor/` servis localement | ✅ (repli automatique sur le CDN du dépôt en cas de blocage) |

Tests exécutés sur cette URL :
- V1 `tests/e2e-pages.mjs` : **19/19 OK**
- V2 `tests/e2e-v2.mjs` : **16/16 OK** (contours, perspective, 4 coins, redressement, filtres,
  OCR de PDF importé, conversion PDF → pages)
- V2.1 `tests/e2e-v21.mjs` : **13/13 OK** (rafale, réorganisation des pages, OCR de zone, balayage)
- V2.2 `tests/e2e-v22.mjs` : **18/18 OK** (nettoyage magique, avant/après, OCR après nettoyage, facture, DOCX, PDF enrichi)
- V2.3 `tests/e2e-v23.mjs` : **8/8 OK** (modes, doublons, assistant local, mode sombre)
(caméra HTTPS 2048×1536, multi-pages, recadrage, rotation, filtre N&B, PDF, OCR, assistant,
persistance, recherche, paramètres, zéro erreur console/réseau).

Les modèles OCR et bibliothèques sont servis localement (`vendor/`). Si un hébergeur bloque les
fichiers binaires lourds, l'app bascule automatiquement sur le CDN jsDelivr du dépôt (tag `v1.0.0`,
fichiers immuables) — et instancie alors le Worker OCR via Blob pour rester compatible CORS.

## Démarrage rapide

```bash
cd scanpro
python3 -m http.server 8080 --bind 0.0.0.0
# puis http://localhost:8080/  (la caméra exige HTTPS ou localhost)
```

## Contenu

| Fichier / dossier | Rôle |
|---|---|
| `index.html` | **Application complète** (CSS + JS inlinés, segments lisibles) |
| `vendor/` | Tesseract.js + moteur WASM + modèles `fra`/`eng`, jsPDF, pdf-lib, pdf.js, JSZip |
| `sw.js`, `manifest.webmanifest` | Cache hors-ligne et installation sur l'écran d'accueil Android |
| `src/` | Sources séparées : `style.css`, `core.js`, `vision.js` (V2), `app.js`, `views.js`, `ui.js`, `shell.html` |
| `build.py` | Réassemble `index.html` depuis `src/` |
| `android/` | Spécifications Kotlin/CameraX/ML Kit + manifest + gradle (V4) |
| `docs/` | Guide de test, fonctionnalités & limites détaillées, captures d'écran |
| `tests/` | Scénarios Playwright (caméra simulée, OCR, PDF, fusion, recadrage) |

## État réel des fonctions

✅ Caméra live · import galerie/PDF · **détection automatique des contours** · **correction de
perspective (4 coins ajustables)** · **redressement automatique** · recadrage · rotation ·
luminosité · **6 modes de traitement** (Document, Couleur, Gris, N&B, Anti-ombre, Vif) ·
multi-pages · **OCR Tesseract fra+eng** · **OCR des PDF importés** · **conversion PDF → pages** ·
texte éditable/copiable/partageable · **PDF A4** · téléchargement · partage · impression ·
export images (ZIP) · recherche (nom + texte) · renommage · suppression · **fusion de PDF** ·
persistance IndexedDB · quota · assistant heuristique hors-ligne.

✅ V2.1 : **rafale** (20 pages max) · **réorganisation des pages par glisser** · **OCR de zone** ·
**balayage entre les pages**.

✅ V2.2 (branche `feature/v2.2`) : **Nettoyage magique réel appliqué à l’export**, studio avant/après,
gomme tactile, annuler/rétablir, traitement par lots, OCR avec mots incertains, exports TXT/DOCX,
extraction de pages PDF, filigrane/signature/numéros de page, extraction facture locale modifiable (CSV/JSON).

❌ / ⚠️ Résumé IA génératif distant (non configuré, aucune clé navigateur), reconstruction générative,
APK natif, OCR multi-zones, lasso incliné, mode livre/courbure.
Détail complet : `docs/FONCTIONNALITES-ET-LIMITES.md`.

## Régénérer l'application

```bash
python3 build.py        # src/ -> index.html
```

Aucune clé API n'est présente dans le code. Aucun document n'est transmis à un serveur.
Licences des composants tiers : Tesseract.js (Apache-2.0), jsPDF (MIT), pdf-lib (MIT),
pdf.js (Apache-2.0), JSZip (MIT/GPLv3).

- V2.4 `tests/e2e-v24.mjs` : **8/8 OK** (sauvegarde/restauration ZIP, doublons de documents, sélection multiple, tri)

- V2.5 `tests/e2e-v25.mjs` : **8/8 OK** (en-tête non fixe, mode nuit/jour, OCR espagnol réel)
