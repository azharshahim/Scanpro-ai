# ScanPro AI — préparation de l'application Android native (V4)

La V1 livrée est une **web app PWA** immédiatement testable (voir `../docs/GUIDE-TEST.md`).
Ce dossier décrit l'architecture Kotlin prévue pour l'APK, afin que la V4 démarre sans dette
technique. Aucun APK n'est compilé ici : ce sont des **spécifications prêtes à implémenter**
(rien n'a été téléchargé ni compilé dans cet environnement).

## 1. Choix techniques

| Besoin             | Bibliothèque recommandée                                   | Pourquoi |
|--------------------|------------------------------------------------------------|----------|
| Aperçu caméra      | **CameraX** (`camera-camera2`, `camera-lifecycle`, `camera-view`) | Rétrocompatibilité, rotation/torche, `ImageAnalysis` pour les contours |
| OCR                | **ML Kit Text Recognition v2** + `text-recognition-french` | Sur l'appareil, hors ligne, latence faible |
| Traitement d'image | **OpenCV Android** (V2)                                     | Contours + homographie 4 points (perspective) |
| PDF                | `android.graphics.pdf.PdfDocument` (natif), iText7 CE pour la fusion | PdfDocument suffit pour image → A4 |
| Stockage           | Room + `filesDir` + MediaStore (export)                     | Pages JPEG, métadonnées en base, export via `MediaStore.Downloads` |
| Partage            | `FileProvider` + `ShareCompat.IntentBuilder`                | Partage PDF/images vers Drive, Gmail, WhatsApp |
| Permissions        | `CAMERA`, `READ_MEDIA_IMAGES` (API 33+), `READ_EXTERNAL_STORAGE` ≤ 32 | Demandes à la volée avec explication préalable |

## 2. Architecture (MVVM + UseCases)

```
app/
 ├─ data/
 │   ├─ local/  AppDatabase(Room) · DocumentDao · PageDao · FileStore
 │   ├─ repo/   DocumentRepository (CRUD, export, fusion)
 │   └─ ocr/    MlKitOcrEngine (TextRecognizer, blocs/paragraphes)
 ├─ domain/
 │   ├─ model/  Document(id, name, pages, text, ocrStatus, createdAt…)
 │   │           ScanPage(uri, quad, filter)
 │   └─ usecase/ CreatePdfUseCase · MergePdfUseCase · EnhanceImageUseCase · ClassifyDocumentUseCase
 ├─ ui/
 │   ├─ home/     HomeScreen · HomeViewModel
 │   ├─ capture/  CaptureScreen (CameraX PreviewView) · CaptureViewModel
 │   ├─ editor/   EditorScreen (crop / rotate / filtres) · EditorViewModel
 │   ├─ detail/   DetailScreen (aperçu / texte / assistant) · DetailViewModel
 │   └─ settings/ SettingsScreen (DataStore Preferences)
 └─ di/ AppModule (Hilt)
```

## 3. Équivalences fonctionnelles avec la V1 Web

| Fonction V1 (web)        | Implémentation Android |
|--------------------------|------------------------|
| `getUserMedia`           | CameraX `ProcessCameraProvider` + `Preview` |
| filtres `<canvas>`       | `ColorMatrix` sur `Bitmap` (ou OpenCV pour le seuillage adaptatif) |
| Tesseract.js (fra+eng)   | ML Kit `TextRecognition` + `FrenchTextRecognizerOptions` |
| jsPDF (image → A4)       | `PdfDocument` + `PageInfo` A4 (595 × 842 pt) |
| pdf-lib (fusion)         | `PdfRenderer` (lecture) + iText `PdfMerger` (fusion) |
| IndexedDB                | Room (recherche plein texte via FTS4) |
| `navigator.share`        | `ShareCompat` + `FileProvider` |
| `window.print()`         | `PrintManager` + `PrintDocumentAdapter` |
| Service worker (offline) | 100 % hors ligne par nature |

## 4. Ordre de mise en œuvre conseillé

1. Squelette Compose + navigation (Accueil / Documents / Paramètres, FAB scan).
2. CameraX : capture, multi-pages, rotation, torche.
3. Éditeur : recadrage manuel (perspective en V2 via OpenCV), filtres ColorMatrix.
4. `PdfDocument` : export A4 multi-pages + partage + `PrintManager`.
5. ML Kit : OCR page → texte éditable, statut « OCR indisponible » explicite.
6. Room : persistance + recherche.
7. Fusion de PDF (iText), export ZIP des images.
8. Assistant IA : appels à un backend détenu par l'éditeur (jamais de clé dans l'APK).

## 5. Points de vigilance

- **Ne jamais embarquer de clé API** dans l'APK : elle est extractible du binaire.
- Android 10+ : écrire dans `Downloads` via `MediaStore`, pas de permission stockage globale.
- Compression : JPEG qualité 85, côté long 2400 px ≈ 400–700 Ko par page (identique à la V1).
- ML Kit ≈ 20 Mo si modèles embarqués : possible en bundle Play Feature Delivery.
- Prévoir un mode « appareils photo faibles » : 1600 px, qualité 80.
