# ScanPro AI — V1 : fonctionnalités livrées & limitations exactes

> Règle appliquée : **rien n'est présenté comme fonctionnel sans avoir été implémenté et testé**
> dans un navigateur (voir `GUIDE-TEST.md`, section 3, et les captures dans `docs/screens/`).

## A. Fonctionnalités opérationnelles en V1

### Capture & import
| Fonction | État | Détail |
|---|---|---|
| Caméra live (`getUserMedia`) | ✅ | Aperçu plein écran, cadre de visée, bouton rond, flash visuel, vibration, torche si l'appareil l'expose |
| Import depuis la galerie | ✅ | Photos multiples, ou appareil photo natif Android (attribut `capture`) — fonctionne même sans permission caméra |
| Import d'un PDF existant | ✅ | Lu via pdf.js : nombre de pages + vignette de la 1re page ; le fichier est conservé **intact** |
| Multi-pages | ✅ | Captures successives, indicateur de nombre de pages, vignettes, ajout/suppression/duplication |
| Messages d'erreur caméra | ✅ | Refus, absence de caméra, caméra occupée, contexte non HTTPS → message explicite + repli galerie |
| Détection automatique des contours | ❌ **V2** | Aucun contour n'est détecté automatiquement ; le cadre affiché est un guide visuel (non actif) |
| Correction de perspective | ❌ **V2** | Seul le recadrage rectangulaire (4 poignées) est disponible |

### Traitement d'image
| Fonction | État | Détail |
|---|---|---|
| Recadrage | ✅ | Poignées aux 4 coins, déplacement du cadre, « Toute l'image » |
| Rotation | ✅ | 90° par appui |
| Luminosité / contraste | ✅ | Réglages en direct (60–150 % / 60–180 %) |
| Mode **Document** | ✅ | Auto-niveaux + courbe de blanchiment + accentuation |
| Mode **Couleur** | ✅ | Auto-niveaux par canal + accentuation légère |
| Mode **Gris** | ✅ | Niveaux de gris |
| Mode **Noir & blanc** | ✅ | Seuillage adaptatif (moyenne locale, fenêtre ≈ 4,5 % de l'image) |
| Mode **Original** | ✅ | Aucun traitement |
| Redressement (deskew) | ❌ **V2** | Non implémenté |

### OCR
| Fonction | État | Détail |
|---|---|---|
| Moteur OCR réel | ✅ | **Tesseract.js 5** exécuté dans un Web Worker, modèles `fra` + `eng` locaux |
| Français + anglais | ✅ | Choix dans Paramètres (`fra+eng` par défaut) |
| Texte éditable | ✅ | Zone de texte, sauvegarde automatique 0,9 s après la frappe + bouton « Enregistrer » |
| Copier / Partager / Rechercher dans le texte | ✅ | Presse-papiers, `navigator.share`, recherche avec surlignage |
| Multi-pages | ✅ | Chaque page est reconnue puis concaténée avec un en-tête « — Page n — » |
| Mise en page | ⚠️ Partielle | Tesseract restitue les retours à la ligne et les espaces inter-mots (`preserve_interword_spaces`) ; les colonnes et tableaux ne sont pas reconstruits fidèlement |
| Indicateur d'échec | ✅ | Bandeau « Aucun texte reconnu » + statut `failed` enregistré ; aucun faux positif |
| Progression | ✅ | Fenêtre dédiée avec étapes et pourcentage (téléchargement du modèle, initialisation, reconnaissance) |
| OCR des PDF importés | ❌ **V2** | Non proposé (les PDF importés conservent leur texte d'origine) |
| Sélection de zone OCR | ❌ **V2** | L'OCR porte sur la page entière |

### Documents & export
| Fonction | État | Détail |
|---|---|---|
| PDF depuis les pages scannées | ✅ | jsPDF, A4 portrait, marge 8 mm, image JPEG 92 %, pages centrées |
| Téléchargement | ✅ | Nom de fichier modifiable (`nom-du-document.pdf`) |
| Partage | ✅ | Web Share API niveau 2 (fichier) ; message de repli si non supporté |
| Impression | ✅ | Ouverture du PDF + `print()` (ou message clair si bloqué par le navigateur) |
| Export en images | ✅ | JPEG 2400 px ; ZIP automatique si plusieurs pages (JSZip) |
| Renommer / Supprimer / Rechercher | ✅ | Recherche sur le nom **et** le texte OCR |
| Fusion de plusieurs PDF | ✅ | pdf-lib, ordre de sélection, nom personnalisable |
| Liste des documents récents | ✅ | Accueil (4 derniers) + bibliothèque complète, filtres (Tous / Scans / PDF / avec OCR) |
| Persistance | ✅ | IndexedDB (documents, pages, fichiers binaires) + repli mémoire signalé si IndexedDB est bloqué |
| Quota & taille | ✅ | Estimation navigateur, usage total, avertissement en navigation privée |

### Assistant IA
| Fonction | État | Détail |
|---|---|---|
| Classification (Facture, Contrat, Identité, Bulletin de paie, Courrier, Autre) | ✅ *hors-ligne* | Score par mots-clés pondérés ; affiche « Autre » et une confiance basse si le texte est insuffisant |
| Extraction dates / montants / références / noms / e-mails / téléphones / SIRET / IBAN | ✅ *hors-ligne* | Expressions régulières + heuristiques, étiquetées comme heuristiques |
| Résumé automatique | ✅ *hors-ligne* | Résumé **extractif** (fréquence des termes + position + phrases-clés), pas un résumé génératif |
| Recherche dans le document | ✅ | Occurrences avec contexte surligné |
| Facture → données structurées fiables | ⚠️ Démo locale | Un aperçu heuristique est proposé ; l'extraction comptable fiable est **marquée « serveur / API requis »** |
| Résumé IA avancé, Q&R, classification fine | ❌ **V3** | Marqué « serveur / API requis », bouton d'explication ; **aucune clé API dans le code** |

## B. Limitations connues de la V1 (à annoncer telles quelles)

1. **Caméra = HTTPS obligatoire.** Sur `http://` non-localhost, `getUserMedia` est bloqué par le
   navigateur : l'app bascule sur un bandeau explicatif + import galerie.
2. **Pas de détection de contours ni de perspective.** Le cadre de visée est un guide, pas une
   analyse d'image. Un scan incliné reste incliné (le recadrage manuel atténue).
3. **Le poids du premier chargement** : modèles OCR `fra` (6 Mo) + `eng` (11 Mo) + moteur WASM
   (~4 Mo), mis en cache par le service worker. Le premier OCR peut prendre 10–30 s sur mobile.
4. **OCR dépendant de la qualité de la photo** : faible lumière, reflets, texte manuscrit,
   colonnes serrées et très petites polices réduisent la précision. Le mode **Document** améliore
   nettement le résultat.
5. **Mise en page non reconstruite** : tableaux et colonnes peuvent être linéarisés.
6. **PDF importés** : conservés intacts (pas de réencodage) ; leurs pages ne peuvent pas être
   recadrées/modifiées et l'OCR ne leur est pas appliqué en V1.
7. **Partage** : nécessite Web Share niveau 2 (Chrome Android ≥ 89, Safari iOS ≥ 15). Sinon,
   seul le téléchargement est proposé, avec un message explicite.
8. **Impression** : passe par le visualiseur PDF du navigateur ; le blocage des fenêtres
   surgissantes empêche l'impression automatique.
9. **Stockage local uniquement** : vider les données du site, la navigation privée ou un changement
   d'appareil supprime tout. Aucune sauvegarde cloud en V1. Quota typique : plusieurs centaines de
   Mo (variable selon l'appareil).
10. **Pas de compte, pas de synchronisation, pas d'API** : aucune donnée ne quitte l'appareil.
11. **Assistant IA** : purement heuristique. Il ne comprend pas le sens du document et peut se
    tromper (classification et entités à vérifier). Les fonctions à modèle de langage sont
    explicitement marquées comme nécessitant un serveur et **ne sont pas branchées**.
12. **Langues** : français et anglais seulement (les autres packs Tesseract ne sont pas inclus).
13. **`index.html` n'est pas 100 % autonome** : le CSS et le JS applicatif sont inlinés, mais les
    bibliothèques et les modèles de langue restent des fichiers voisins (`vendor/`). C'est
    volontaire : cela garde l'app rapide à charger, permet le cache hors-ligne, et évite
    d'intégrer des clés ou du code tiers dans un fichier unique. Le dossier se copie d'un bloc.
14. **APK Android** : non fourni. `android/` contient l'architecture et les fichiers de
    configuration prêts à l'emploi (Kotlin, CameraX, ML Kit, PdfDocument, Room) — voir
    `android/README-ANDROID.md`.
15. **Ouverture en `file://`** (double-clic sur `index.html`) : l'OCR est bloqué par la politique
    de sécurité du navigateur (lecture des modèles de langue impossible) ; un message dédié
    l'explique. Servir la page en http(s) résout le problème.
16. **Tests** : validés sur Chromium (profil Pixel 7) ; non testés sur iPhone/Safari, Firefox
    Android ni sur un appareil physique dans cet environnement. Le code utilise des détections de
    capacité (`navigator.share`, `navigator.mediaDevices`, `indexedDB`) et dégrade l'interface
    avec un message plutôt que d'échouer silencieusement.

## C. Feuille de route

- **V2** — détection automatique des contours (Sobel + transformée de Hough), correction de
  perspective à 4 points (homographie), redressement automatique, réorganisation des pages par
  glisser-déposer, OCR des PDF importés, mode rafale.
- **V3** — backend d'IA (clé côté serveur), résumé génératif, extraction structurée de factures,
  classement automatique, recherche sémantique multi-documents, consentement explicite avant envoi.
- **V4** — application Android native (Kotlin + CameraX + ML Kit + PdfDocument), APK signé,
  hors-ligne complet, partage système, sauvegarde facultative et chiffrée.
