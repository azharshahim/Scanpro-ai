# ScanPro AI — V2 : capture avancée

> Version publiée : **2.0.0** · https://azharshahim.github.io/Scanpro-ai/

## Ce qui arrive en V2 (implémenté et testé)

| Fonctionnalité | Détail technique | Mesure |
|---|---|---|
| **Détection automatique des contours** | Niveaux de gris → flou moyen → gradient de Sobel → seuil d'Otsu (3 passes) → dilatation → *flood fill* du fond → plus grande région fermée → coins extrêmes en (x+y) / (x−y) | Précision **1,2 % de la diagonale** sur photo inclinée ; 150–240 ms |
| **Correction de perspective** | Homographie 4 points (résolution 8×8) + interpolation bilinéaire, taille de sortie déduite des côtés | 176–282 ms pour 2400 px |
| **Ajustement manuel des 4 coins** | Poignées déplaçables au doigt sur l'aperçu, « Détecter » relance l'auto, « Réinitialiser » remet les bords | — |
| **Redressement (deskew)** | Projection du masque de texte sur l'axe vertical, balayage −10°…+10° par pas de 0,5°, maximisation de la variance + réglage fin au curseur | 75–83 ms ; **6° détecté → 0° résiduel** |
| **Suppression des ombres / éclairage inégal** | Fond estimé par flou moyen sur une copie 320 px puis division (« division de fond »), ré-échantillonné | 201/150/117 → **244/243/235** de luminosité ; **158 ms** (optimisé de 565 ms) |
| **Filtre « Vif »** | Saturation ×1,35 + auto-niveaux + anti-ombre | — |
| **OCR des PDF importés** | pdf.js rend chaque page en canvas 2000 px, puis Tesseract page par page | Texte reconnu avec en-tête « — Page n — » |
| **Conversion PDF → pages modifiables** | Les pages rendues remplacent le PDF importé : recadrage, perspective, filtres, nouvel export | 2 pages converties, binaire libéré |
| **Réglage** | Interrupteur « Détection automatique des contours » dans Paramètres | — |

## Pipeline complet d'une page

```
photo → [détection du quadrilatère] → [warp perspective] → [recadrage] → [rotation 90°]
      → [redressement] → [filtre : Document / Couleur / Gris / N&B / Anti-ombre / Vif]
      → vignette + export PDF A4 / OCR
```

Les données sont stockées par page : `src`, `quad` (4 coins normalisés), `deskew` (degrés),
`crop`, `rotate`, `filter`, `thumb`. Le rendu est **non destructif** : toute correction peut être
rejouée à une autre résolution (aperçu 400 px, export 2400 px, OCR 2000 px).

## Performances mesurées (Chromium, 3000×4000 px, profil Pixel 7)

| Étape | Durée |
|---|---|
| Détection des contours | ~240 ms |
| Correction de perspective | ~280 ms |
| Redressement (estimation) | ~75 ms |
| Anti-ombre | ~160 ms |
| Seuillage adaptatif N&B | ~130 ms |
| **Rendu complet d'une page** | **~740 ms** |

## Limites connues de la V2

1. La détection suppose **un document contrasté sur un fond plus sombre ou différent**. Sur fond
   identique (feuille blanche sur table blanche) ou avec des ombres très dures, elle peut échouer :
   le badge indique alors « Contours non détectés » et le bouton **4 coins** permet de corriger à la main.
2. Le contour détecté est **quadrilatère** : un document froissé ou courbé n'est pas « déplié »
   (pas de modèle de courbure — envisagé plus tard).
3. La perspective recadre sur le document : une **marge extérieure** volontaire (bord de page) est perdue.
4. Le redressement repose sur l'alignement des lignes de texte : peu fiable sur des images sans texte
   (photos, dessins) — d'où le réglage manuel au curseur.
5. L'anti-ombre éclaircit les fonds mais peut **effacer un filigrane très clair**.
6. L'OCR des PDF importés **n'extrait pas le texte natif** du PDF : il photographie la page
   (utile pour un PDF scanné, inutile pour un PDF texte où la sélection suffirait).
7. Toujours pas de : réorganisation des pages par glisser-déposer, OCR de zone, mode rafale.
