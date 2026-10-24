# V2.19 — Refonte UX/UI mobile (25/10/2026)

Branche : `feature/ux-mobile-v219` (depuis `main` = V2.18.0). **Non fusionnée.**
Audit préalable : `docs/AUDIT-UX-V219.md`. Captures avant/après (360×740, émulation
Chromium — pas un téléphone Android physique) : `docs/screenshots-v219/`.

## Changements
1. **Bouton Scan intégré à la barre** : suppression du FAB en `margin-top:-26px`
   (58×58, anneau débordant). La barre compte **4 destinations + Scan intégré** :
   Accueil · Documents · **Scan** (pastille bleu nuit 48×34 dans la barre, zone
   tactile du slot ≥ 48 px) · Comptabilité · Outils. Aucune marge négative, aucun
   débordement vertical, libellés jamais tronqués (contrôle automatisé ; la rubrique
   « Documents », plus longue, reçoit un flex légèrement supérieur).
2. **Paramètres : un seul accès** — l'engrenage de l'en-tête Accueil. Supprimés :
   la rubrique Paramètres de la barre, l'engrenage Outils et la tuile Paramètres.
   **Thème : source unique** dans Paramètres → Apparence (bascules Accueil et
   Outils « Nuit/Jour » retirées). Langues OCR : accès unique dans Paramètres.
3. **Paramètres réorganisés en 7 sections numérotées** : Apparence · Scan et caméra ·
   OCR et langues · Stockage local et sauvegardes · Confidentialité et permissions ·
   Comptabilité et plan comptable (lien vers l'écran Comptabilité — source unique,
   rien de dupliqué) · Aide et version. Toutes les options existantes sont conservées.
4. **Accueil allégé** : rangée de statistiques et double badge « local » remplacés par
   une ligne sobre ; tuile « Mes documents » (doublon de la rubrique) remplacée par
   « Outils ». Actions principales inchangées (caméra, import image/PDF, fusion).
5. **Icônes distinctes** : calculatrice pour Comptabilité (Outils garde la grille).
6. Anciens tests adaptés au seul endroit où la navigation changeait volontairement
   (accès Paramètres via l'Accueil : e2e-pages, e2e-v23, e2e-audit-v27).

## Tests réellement exécutés
| Suite | Résultat |
|---|---|
| `e2e-v221-ux.mjs` (nouveau : 320/360/390/430/768/1024 px — débordement horizontal, Scan dans la barre, superpositions, libellés tronqués, unicité Paramètres, thèmes, navigation, parcours Scan) | **56/56** |
| Comptabilité/apprentissage | V2.18 nature 18/18 · V2.17 20/20 · L3 23/23 · L2 30/30 · V2.15 20/20 · banque 18/18 |
| Relevé réel (85 ops) | 11/11 |
| Autres | fiabilité 13/13 · V2.13 17/17 · V2.16 synth 16/16 · audit V2.7 16/16 · pages 19/19 · V2.3 8/8 |

## Limites restantes
- Vérifié en **émulation Chromium (Pixel 7)** uniquement — pas de téléphone Android
  physique ; les zones de sécurité reposent sur `env(safe-area-inset-bottom)` existant.
- L'écran de capture et l'éditeur n'ont pas été redessinés (leurs commandes étaient
  déjà au pouce) ; seuls la navigation et les écrans principaux ont été refondus.
- La rubrique active n'est pas surlignée sur l'écran Paramètres (atteint depuis
  l'Accueil, dont l'engrenage est le point d'entrée unique).
