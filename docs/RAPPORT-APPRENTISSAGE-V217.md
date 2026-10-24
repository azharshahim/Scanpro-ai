# V2.17 — Apprentissage fiabilisé des comptes bancaires (24/10/2026)

Branche : `feature/apprentissage-comptes-v217` (depuis `main` = V2.16.0). **Non fusionnée.**
Le système existant (`Precompta.learnFromLabel/learnKey/learned`, `Acc.bankProposals`) a été
**audited puis amélioré**, pas remplacé. Aucune donnée bancaire personnelle dans le dépôt :
le salarié des tests est fictif ; le relevé réel n'est ni commité ni cité nominativement.

## 1. Audit du mécanisme V2.16 (défauts prouvés par les tests)
1. `accSave()` apprenait à partir de **toute** valeur `tx.account` présente — y compris les
   propositions automatiques pré-remplies dans le formulaire : enregistrer sans rien corriger
   « apprenait » les règles du dossier comme si c'étaient des corrections de l'utilisateur.
2. `learnKey()` = 3 premiers mots significatifs **ordonnés** : « Virement Web Karim Benali » et
   « Vir Benali Karim » donnaient des clés différentes (aucune réutilisation), et un libellé
   commençant par un mot partagé pouvait regrouper des personnes différentes.
3. `learnFromLabel()` **écrasait silencieusement** une règle existante, sans sens (débit/crédit),
   sans nature, sans conflit, sans possibilité d'annulation ciblée.
4. La règle générique « salaire → 421000 » s'appliquait aussi aux **entrées**.
5. L'export écrivait des écritures même avec une contrepartie **absente/inactive** du plan.

## 2. Mécanisme V2.17
- **Bénéficiaire normalisé** : `Precompta.beneficiaryTokens()` — jetons triés (ordre prénom/nom
  indifférent), mots génériques (« virement », « vers », « carte »…) et mots de nature
  (« salaire », « remboursement », « avance »…) exclus de l'identité. Libellé trop générique
  (« Virement », « Vers le compte ») → **apprentissage refusé** avec motif.
- Règle apprise = bénéficiaire + **sens** (sortie/entrée) + nature détectée + compte + libellé
  d'exemple + dossier (journal BQ/banque) ; persistance localStorage (clé existante conservée,
  ancien format chaîne toujours lu).
- Appariement : **exact** (mêmes jetons ou inclusion complète ≥ 2 jetons) → proposition
  confiance 90, origine « apprentissage » ; **partiel** (un seul jeton commun, noms proches) →
  **suggestion à confirmer** (confiance 40, jamais exportée sans acceptation explicite) ;
  **conflits** (même bénéficiaire, comptes différents ou règles concurrentes) → signalés,
  aucun compte appliqué automatiquement.
- **Apprentissage uniquement sur correction explicite** : `accSave()` recalcule la proposition
  automatique de référence (sans les affectations) et n'apprend que si le compte saisi en
  diffère. Résultat historisé dans le document.
- Salaires : 421000 proposé seulement si motif de paie reconnu **en sortie**, ou règle apprise
  pour ce salarié précis. Un virement vers une personne sans motif reste en attente.
- Interface : origine de chaque proposition (correction utilisateur / apprentissage / règle du
  dossier), nature, compte + intitulé, confiance, alternatives, **opérations similaires du
  relevé avec aperçu**, bouton « Appliquer aux similaires », bouton « Accepter la suggestion »,
  et section **Règles apprises** (corriger une règle, annuler une règle — sans toucher aux autres).
- Export : aucune écriture si la contrepartie ou le compte banque 512 est absent/inactif ;
  les lignes exclues sont listées dans les problèmes pré-export. 512000 et BQ configurables,
  jamais confondus avec l'IBAN.

## 3. Mesures (cas de référence synthétiques de la suite V2.17)
11 opérations témoins (3 variantes du même salarié fictif, noms proches, client, fournisseur,
virement interne, inconnue, salaire explicite) : **7 proposées automatiquement et correctes,
4 laissées en attente, 0 faux positif 421000**. Après correction d'une ligne en 421000 :
les 3 variantes du salarié sont proposées 421000 ; l'homonyme partiel n'obtient qu'une
suggestion à confirmer. Sur le **relevé réel** (85 opérations) : extraction inchangée 85/85,
totaux et soldes exacts, 9 propositions automatiques (organismes/frais identifiables),
76 en attente — taux volontairement non gonflé ; l'apprentissage se construit au fil des
corrections de l'utilisateur (simulation sur le relevé réel : une règle apprise est réutilisée
uniquement sur les lignes du même bénéficiaire).

## 4. Tests réellement exécutés
| Suite | Résultat |
|---|---|
| `e2e-v219-apprentissage.mjs` (nouveau : apprentissage, variantes, noms proches, conflits, persistance, annulation, parcours UI complet correction→enregistrement→apprentissage→réutilisation) | **20/20** |
| `e2e-v217-releve-reel.mjs` (relevé réel 85 ops) | **11/11** |
| `e2e-v218-synth.mjs` | **16/16** |
| Non-régressions | banque V2.15.1 18/18 · L3 23/23 · V2.15 20/20 · L2 30/30 · V2.13 17/17 · V2.14 15/15 · fiabilité 13/13 · exports TOUT OK |

## 5. Limites restantes
- Les règles apprises vivent dans le navigateur (localStorage) du poste : pas de partage
  multi-postes ; le « dossier » est le plan comptable local courant.
- L'appariement partiel (suggestion) repose sur les jetons du libellé bancaire : un salarié
  payé sous un libellé sans son nom restera en attente (comportement voulu).
- 421000 reste une proposition à valider par le comptable (net via 421 suppose l'écriture de
  paie 641/645 déjà comptabilisée) ; aucune validation automatique n'est prétendue.
- Android physique non testé (émulation Chromium), comme les versions précédentes.
