# ScanPro AI — V1 · Comment tester en 2 minutes

## 1. Sur votre téléphone Android (le plus rapide)

1. Ouvrez l'application dans le navigateur du téléphone (Chrome recommandé) :
   **la prévisualisation live affichée dans cet environnement** (bouton « aperçu » du workspace)
   ou `index.html` servi en HTTPS.
2. Au premier lancement, un écran de bienvenue s'affiche → **Commencer**.
3. Appuyez sur **Scanner avec la caméra** → autorisez la caméra → prenez 1 ou plusieurs photos
   (bouton rond) → **Terminer** (✓).
   *Si la caméra est refusée ou indisponible, utilisez **Galerie** dans l'écran de capture : Android
   ouvre l'appareil photo natif.*
4. Dans l'éditeur : choisissez un mode (**Document**, **Couleur**, **Gris**, **Noir & blanc**),
   utilisez **Recadrer** (glissez les poignées), **Pivoter**, **Luminosité**.
5. **Générer le PDF** → le PDF est téléchargé et le document est enregistré.
6. Depuis la fiche du document : **Extraire le texte (OCR)** → le texte français/anglais apparaît
   dans une zone modifiable → **Copier**, **Partager**, **Enregistrer**.
7. Onglet **Documents** : recherche par nom **ou par texte reconnu**, renommage, suppression,
   téléchargement, partage, impression, export en images (ZIP si plusieurs pages).
8. **Fusionner des PDF** (accueil) : sélectionnez 2 PDF ou plus → fusion → le PDF fusionné
   est enregistré et téléchargeable.
9. Onglet **Paramètres** : langues OCR, qualité d'export, OCR automatique, quota de stockage,
   suppression totale des données.

> **Attention au double-clic sur `index.html` (protocole `file://`)** : l'app s'ouvre et tout
> fonctionne (import, recadrage, filtres, PDF, documents, assistant local) **sauf l'OCR** : le
> navigateur interdit alors la lecture des fichiers de langue (`fetch` sur `file://`). L'app
> l'explique par un message explicite. Pour l'OCR et la caméra, servez la page en HTTP/HTTPS.
>
> Sans la prévisualisation : `cd scanpro && python3 -m http.server 8080` puis
> `http://localhost:8080/`. **La caméra exige HTTPS ou localhost** ; sinon utilisez l'import galerie.

## 2. Sur ordinateur

Ouvrez l'URL dans Chrome puis `F12` → mode mobile (Pixel 7). Toutes les fonctions sauf la caméra
(utilisez l'import d'image) sont utilisables ; le téléchargement du PDF se fait dans le dossier
« Téléchargements ».

## 3. Ce qui a été vérifié automatiquement

Tests Playwright (Chromium, profil Pixel 7), dans `tests/` — exécutés avec succès :

| Vérification | Résultat |
|---|---|
| Chargement de l'app sans erreur console | ✅ aucune erreur |
| Caméra (périphérique simulé, 2048×1536) | ✅ flux vidéo actif, 2 captures |
| Import d'image → éditeur | ✅ |
| Recadrage par glissement (4 poignées) | ✅ `crop = {x:0, y:0, w:0.70, h:0.46}` (sur la page de test) |
| Rotation 90/180/270 | ✅ |
| Filtres Document / Couleur / Gris / N&B | ✅ (seuillage adaptatif vérifié visuellement) |
| Export PDF (1 page et multi-pages) | ✅ signature `%PDF-`, 308 Ko / 66 Ko |
| OCR réel Tesseract (fra+eng) | ✅ 604 caractères, confiance **93 %** sur une facture de test |
| Copie / édition du texte (sauvegarde auto) | ✅ |
| Import PDF (pdf.js) | ✅ nb de pages + vignette |
| Fusion de 2 PDF (pdf-lib) | ✅ 2 pages, fichier téléchargeable |
| Recherche nom + texte OCR | ✅ |
| Persistance après rechargement (IndexedDB) | ✅ |
| Assistant local (classement, entités, résumé, recherche) | ✅ « Facture » détectée, montants/dates/SIRET/IBAN extraits |
| Navigation basse, FAB, retour navigateur | ✅ |

## 4. Structure du livrable

```
scanpro/
├─ index.html               ← application complète (CSS + JS inlinés, ~157 Ko)
├─ sw.js, manifest.webmanifest, assets/icon.svg
├─ vendor/                  ← bibliothèques locales (Tesseract, jsPDF, pdf-lib, pdf.js, JSZip)
│  └─ lang/fra.traineddata.gz, eng.traineddata.gz
├─ src/                     ← sources lisibles (style.css, core.js, app.js, views.js, ui.js, shell.html)
├─ build.py                 ← réassemble index.html depuis src/
├─ android/                 ← specs Kotlin/CameraX/ML Kit + manifest + gradle
├─ docs/                    ← ce guide, fonctionnalités & limites, captures d'écran
└─ tests/                   ← scripts Playwright de validation
```

Après une modification des sources : `python3 build.py` → `index.html` régénéré.
