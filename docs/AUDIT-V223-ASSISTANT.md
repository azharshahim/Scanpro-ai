# Audit préalable V2.23 — Assistant comptable intelligent

*Réalisé sur `main` au commit `d6b2ed5` (V2.22 publiée), avant toute modification. Branche de travail : `feature/v2.23-assistant-comptable`.*

## 1. Périmètre audité (fichiers)

- `src/ui.js` (3 956 l.) : moteurs `Precompta` (plan/journaux/règles/apprentissage/tiers), `Acc` (extraction bancaire, propositions, export), actions UI.
- `src/views.js` (748 l.) : écran Comptabilité (`viewAcc`), cartes de groupes, liste des propositions, règles apprises.
- `src/app.js` : mécanique des fiches de confirmation (`openSheet`), actions, version.
- Tests : 34 suites Playwright, noyau CI de 12 suites (`tests/run-ci.sh`), toutes vertes sur `main`.

## 2. Ce qui fonctionne déjà — à conserver, non réécrit

| Domaine | Existant démontré | Garde-fous déjà en place |
|---|---|---|
| Lecture des relevés | `extractBank` (texte) + `bankFromPositions` (géométrie pdf.js), fusion, `bnpBal`/`amtAt` V2.22 | ambiguïté → `Non reconnu` / `a-verifier` ; jamais de montant pris sur une ligne voisine ; contrôles de soldes, totaux imprimés, détection doublons |
| Plan comptable | 27 comptes PCG (`DEFAULT_CHART`) avec catégorie, actif/inactif, ajout de compte, réinitialisation, 5 journaux, taux de TVA | comptes inactifs exclus des écritures ; règles toutes configurables, rien de figé |
| Propositions de compte (`bankProposals`) | 12 règles dossier regex (compte, confiance, justification `why`, alternatives) + règles apprises bénéficiaire+sens+nature | pas de compte inventé (`En attente d'affectation`) ; conflits explicites non résolus automatiquement ; comptes sensibles 421/425/467 soumis à nature établie ; niveau `élevé/moyen/faible` + seuils réglables |
| Apprentissage (`learnFromLabel`) | clé = jetons bénéficiaires normalisés triés + sens + nature ; persistance locale | libellés génériques refusés ; conflit conservé et exposé ; désactiver / corriger / supprimer ; automatisation désactivable ; dossier comptable isolé |
| Non-confusion des tiers | identité par jetons exacts, sous-ensemble ≥ 2, ordre des mots indifférent ; homonymes partiels → simple suggestion | verrouillé par les tests V2.17/V2.18 (Benali vs Bensaid, natures distinctes) |
| Liste « À vérifier » | chips `à vérifier` / `doublon ?`, centre de contrôle « à vérifier en priorité », `pending` (sans proposition), filtres par niveau de confiance | une opération sans compte n'entre dans aucun groupe validable |
| Actions groupées | récapitulatif avant action (compte + libellé, nombre d'opérations, validées épargnées, motif, confiance), annulation, 3 modes (valider / valider+règle / corriger) | les écritures validées ne sont jamais touchées ; champ vidé = erreur explicite, pas de repli silencieux |
| Exports | `bankEntriesCsv` (UTF-8 BOM, séparateur `;`, équilibre calculé, `problems`), écritures factures avec Tiers, XLSX, JSON, CSV relevé brut | les propositions incertaines et les comptes absents/inactifs ne sont pas exportés ; aucune donnée source modifiée |

## 3. Écarts démontrés par rapport au besoin V2.23

| # | Écart | Preuve dans le code | Conséquence |
|---|---|---|---|
| **E1** | La mémorisation d'une règle n'est **pas optionnelle** dans le parcours individuel : `accSave` appelle `learnFromLabel` pour toute correction, et `accAcceptSuggestion` apprend aussitôt — sans aperçu préalable de la règle | `src/ui.js` `accSave` (boucle d'apprentissage automatique) et `accAcceptSuggestion` | Contradiction avec « s'il le souhaite » et « afficher la règle avant sa mémorisation ». Seul le flux de groupe `Valider + créer une règle` affiche déjà un aperçu (conserver) |
| **E2** | Le CSV du journal de banque (`bankEntriesCsv`) n'a **pas de colonne Tiers** alors que chaque proposition porte déjà `pr.tiers` ; les montants utilisent le point décimal | en-tête actuel : `Date;Journal;Pièce;Compte;Libellé;Référence;Débit;Crédit;Statut validation` | Le besoin impose « tiers si connu » ; le CSV factures utilise déjà la virgule décimale (cohérence Excel FR à aligner) |
| **E3** | Pas de synthèse explicite **fiables / incertaines / non reconnues** au niveau des opérations | les trois états existent dans les données (`counterAccount` / `suggestion` / aucun) mais seuls les groupes ont des filtres, par niveau de confiance | L'utilisateur ne dispose pas d'un tri dédié de sa liste « À vérifier » |
| **E4** | Le niveau verbal de confiance n'apparaît pas sur chaque ligne de proposition (seul le pourcentage est affiché) | `viewAcc`, bloc « Propositions comptables » | Lecture moins immédiate sur petit écran |

## 4. Décisions de conception (amélioration ciblée, pas de réécriture)

1. **E1** : introduire une fiche d'aperçu *avant* mémorisation, listant chaque règle candidate (bénéficiaire, sens, nature, compte, libellé source), avec trois issues : Annuler (rien n'est enregistré), **Enregistrer sans mémoriser**, **Enregistrer et mémoriser**. Si aucune règle n'est candidate, l'enregistrement reste direct comme aujourd'hui. Le flux de groupe existant n'est pas modifié.
2. **E2** : ajouter la colonne `Tiers` (vide quand le tiers est inconnu — jamais inventé) et passer les deux colonnes montants en virgule décimale, BOM conservé.
3. **E3** : nouveau helper pur `Acc.bankTriage(data)` + trois filtres dédiés dans l'écran Comptabilité.
4. **E4** : afficher le niveau (`élevé/moyen/faible`) à côté du pourcentage sur chaque ligne.
5. Le moteur d'extraction V2.22, `bankProposals`, `bankGroups`, la mécanique des règles apprises et les exports XLSX/JSON ne sont pas modifiés dans leur fond.

## 5. Risques de régression identifiés

- `tests/e2e-v219-apprentissage.mjs` clique sur `Enregistrer les corrections` et attend une règle apprise : il doit être adapté au nouveau bouton « Enregistrer et mémoriser » (le comportement par choix explicite reste identique).
- Les tests qui lisent `bankEntriesCsv` comptent des lignes, pas des colonnes (`split('\n').length`) : l'ajout de colonne est sans impact, mais chaque appel sera revérifié.
- La fiche d'aperçu s'ajoute à un écran déjà dense : présentation repliable, largeurs mobiles 360 px testées.
- Aucun changement du moteur de lecture : les 608 vérifications V2.22 doivent repasser intégralement.

## 6. État de référence avant développement

- Noyau CI rejoué sur la branche vierge : **12 suites OK, 0 échec** (`PORT=8093 bash tests/run-ci.sh`).
- Aucune dépendance nouvelle prévue (100 % local, pas de service externe).
- Données de test exclusivement fictives ; aucun relevé réel dans le dépôt.
