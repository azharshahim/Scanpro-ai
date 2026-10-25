# V2.20 — Imputation comptable intelligente et validation par lots (26/10/2026)

Branche : `feature/imputation-lots-v220` (depuis `main` = V2.19.0). **Non fusionnée.**

## 1. Problèmes constatés
- L'écran de vérification alignait les opérations en longues listes de champs avec
  « à vérifier » : aucune vue d'ensemble, aucune validation groupée, aucune progression.
- Les propositions existaient (compte, confiance, explication) mais sans **tiers**
  explicite, sans **niveau** de confiance lisible (élevé/moyen/faible), et sans action
  de validation individuelle tracée.
- Impossible de désactiver une règle apprise sans la supprimer ; impossible de couper
  l'application automatique des règles ; seuils de confiance codés en dur.
- Rien n'empêchait formellement un traitement par lot de toucher des écritures déjà
  validées, et les changements d'imputation n'étaient pas historisés ligne par ligne.

## 2. Modifications réalisées
- `Acc.bankProposals()` enrichi : **tiers/bénéficiaire identifié**, **niveau de
  confiance** (élevé/moyen/faible selon des **seuils configurables**), statut
  « validée par l'utilisateur », et respect de l'**automatisation désactivable**
  (règle apprise → suggestion à confirmer quand elle est coupée).
- `Acc.bankGroups()` (nouveau) : regroupement **tiers exact + sens + nature + compte
  proposé** ; une autre nature n'entre jamais dans le groupe (salaire/avance/
  remboursement du même salarié = groupes distincts) ; les validées sont exclues.
- Écran **« Imputations à valider »** dans la vue relevé : progression (x/y validées,
  restantes, sans proposition), filtres par niveau, cartes de groupe (tiers, nature,
  nombre, total, compte + intitulé, confiance, explication, origine, détail dépliable
  des opérations), correction du compte du groupe, trois actions : **Valider le
  groupe**, **Valider + créer une règle**, **Corriger le compte du groupe**.
  Validation individuelle par ligne également ajoutée.
- **Traçabilité** : chaque validation/correction de lot écrit dans l'historique du
  document (ancienne → nouvelle imputation, règle/nature, origine utilisateur ou
  validation groupée) ; modifier une imputation déjà validée lève le drapeau
  « validée » ; un lot ne modifie **jamais** une opération déjà validée (comptée
  comme écartée).
- **Règles désactivables** (sans suppression) depuis la section Règles apprises ;
  automatisation activable/désactivable et seuils éditables depuis l'écran
  d'imputations (réglages `Settings`, source unique).

## 3. Exemple avant / après
Avant : 3 lignes « PRLV SEPA EDF ENERGIE … à vérifier » à traiter une par une.
Après : une carte « Edf Energie — 3 opérations · sorties · total 268,30 € ·
proposition **606100 — Fournitures non stockables** · confiance élevée (85 %) ·
origine règle du dossier » avec le détail dépliable et **Valider le groupe (3)**.
Un salaire du même salarié que son avance et son remboursement forme **trois
cartes distinctes** (421000 proposé seulement pour le salaire).

## 4. Tests réellement exécutés
| Suite | Résultat |
|---|---|
| `e2e-v222-lots.mjs` (nouveau : regroupement fournisseur, salarié 3 natures, inconnu, règle corrigée/réutilisée, règle désactivée puis réactivée, automatisation off, seuils, validation groupée UI, historique, écritures validées intouchées, conservation, 320/390/430 px) | **20/20** |
| Non-régressions | nature 18/18 · apprentissage 20/20 · UX 56/56 · relevé réel 11/11 · synth 16/16 · L3 23/23 · fiabilité 13/13 |

## 5. Limites restantes
- Le regroupement repose sur le bénéficiaire extrait du libellé bancaire et la
  nature détectée/classée : un libellé pauvre laisse l'opération en décision
  individuelle (comportement voulu, jamais d'affectation forcée).
- La validation reste une action de l'utilisateur : aucune écriture n'est marquée
  validée automatiquement ; « Valider + créer une règle » est explicite.
- 421000 & consorts restent des propositions à confirmer par le comptable ;
  vérifié en émulation Chromium (Pixel 7), pas sur Android physique.
