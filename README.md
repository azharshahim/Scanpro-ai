# ScanPro AI — V1 fonctionnelle

Scanner de documents pour Android (web app installable) : caméra, recadrage, filtres,
**OCR réel français/anglais**, texte éditable, **export PDF**, fusion de PDF, assistant local
de classification — **100 % sur l'appareil, sans compte ni serveur**.

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

Test de bout en bout exécuté sur cette URL (`tests/e2e-pages.mjs`) : **19/19 vérifications OK**
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
| `src/` | Sources séparées : `style.css`, `core.js`, `app.js`, `views.js`, `ui.js`, `shell.html` |
| `build.py` | Réassemble `index.html` depuis `src/` |
| `android/` | Spécifications Kotlin/CameraX/ML Kit + manifest + gradle (V4) |
| `docs/` | Guide de test, fonctionnalités & limites détaillées, captures d'écran |
| `tests/` | Scénarios Playwright (caméra simulée, OCR, PDF, fusion, recadrage) |

## État réel des fonctions

✅ Caméra live · import galerie/PDF · recadrage · rotation · luminosité · 4 modes de traitement ·
multi-pages · **OCR Tesseract fra+eng** · texte éditable/copiable/partageable · **PDF A4** ·
téléchargement · partage · impression · export images (ZIP) · recherche (nom + texte) · renommage ·
suppression · **fusion de PDF** · persistance IndexedDB · quota · assistant heuristique hors-ligne.

❌ / ⚠️ Détection automatique des contours, correction de perspective, deskew, OCR des PDF importés,
résumé IA génératif et extraction fiable de factures (marqués « serveur / API requis »), APK natif.
Détail complet : `docs/FONCTIONNALITES-ET-LIMITES.md`.

## Régénérer l'application

```bash
python3 build.py        # src/ -> index.html
```

Aucune clé API n'est présente dans le code. Aucun document n'est transmis à un serveur.
Licences des composants tiers : Tesseract.js (Apache-2.0), jsPDF (MIT), pdf-lib (MIT),
pdf.js (Apache-2.0), JSZip (MIT/GPLv3).
