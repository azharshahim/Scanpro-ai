# Audit UX/UI V2.19 — avant modification (25/10/2026)

## Navigation principale (src/shell.html, src/style.css)
- Barre inférieure : 5 rubriques **plus** un bouton Scan en `margin-top:-26px` (58×58 px,
  anneau `0 0 0 6px var(--bg)`) qui **déborde verticalement** de la barre et peut masquer
  le contenu ; largeur fixe 64 px du conteneur + libellés (« Paramètres » ≈ 64 px à 11,5 px)
  => à 320 px, la somme des largeurs minimales dépasse l'écran, libellés rognés possibles.
- Icône `i-grid` utilisée à la fois pour « Compta » et « Outils » : ambigu.

## Paramètres : 4 accès concurrents
1. Rubrique « Paramètres » de la barre inférieure (shell.html) ;
2. Engrenage dans l'en-tête de l'Accueil (views.js:56) ;
3. Engrenage dans l'en-tête Outils (views.js:513) ;
4. Tuile « Paramètres » de la grille Outils (views.js:546).
- Le thème (mode sombre) possède **3 interrupteurs** : Accueil, Outils (tuile « Nuit/Jour »),
  Paramètres. La langue OCR a 2 accès (Outils + Paramètres).

## Accueil
- Rangée de statistiques + badge « 100 % local » + chip « Traitement sur l'appareil » :
  informations redondantes empilées avant le contenu utile.
- Tuile « Mes documents » = doublon de la rubrique Documents ; « Fusionner » côtoie les
  documents récents, recherche en doublon fonctionnel avec l'écran Documents.

## Paramètres
- Sections présentes mais ordre dispersé, pas de section « Comptabilité » alors que le
  plan comptable et les journaux vivent dans l'écran Comptabilité (source unique à lier,
  pas à dupliquer).

## Décisions V2.19
- **Barre à 4 destinations + Scan intégré** : Accueil · Documents · **Scan** (dans la barre,
  48 px, aucun débordement, aucun margin négatif) · Comptabilité · Outils.
- **Paramètres : un seul accès** — l'engrenage de l'en-tête Accueil (même logique partout :
  aucun engrenage ni tuile Paramètres ailleurs, aucune rubrique Paramètres dans la barre).
- **Thème : source unique** dans Paramètres → Apparence (retrait des bascules Accueil/Outils).
- Paramètres réorganisés : Apparence · Scan et caméra · OCR et langues · Stockage local et
  sauvegardes · Confidentialité et permissions · Comptabilité et plan comptable (lien vers
  l'écran Comptabilité, source unique) · Aide et version.
- Accueil allégé : suppression des statistiques redondantes et de la tuile « Mes documents »,
  ajout d'une tuile « Outils » ; actions principales (caméra, imports) inchangées.
- Tests responsive 320→1024 px : débordement horizontal, géométrie de la barre, unicité
  de l'accès Paramètres, thèmes clair/sombre, navigation complète.
