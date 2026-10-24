# V2.18 — Apprentissage comptable par bénéficiaire ET par nature (25/10/2026)

Branche : `feature/apprentissage-nature-v218` (depuis `main` = V2.17.0). **Non fusionnée.**
Aucune donnée bancaire personnelle dans le dépôt (salarié des tests fictif, relevé réel non commité).

## 1. Défauts confirmés dans la V2.17 (et corrections)
1. **La nature stockée n'était jamais comparée** : `learnFromLabel()` enregistrait `nature`,
   mais `Acc.bankProposals()`/`matchLearned()` appariaient sur bénéficiaire + sens seuls.
   → Une règle « salaire → 421000 » s'appliquait à un remboursement du même salarié.
   **Correction** : appariement bénéficiaire + sens + nature ; natures connues différentes =
   règle incompatible (signalée, jamais appliquée) ; nature inconnue face à une règle typée
   ou à un compte sensible (421/425/467) = **suggestion à confirmer**, jamais d'automatisme.
2. **`detectNature()` testait « salaire » avant « avance »** : « AVANCE SUR SALAIRE » était
   classée salaire et recevait 421000 via la règle générique. **Correction** : remboursement/
   avance d'abord ; garde explicite — la règle salaire ne s'applique jamais à un
   remboursement/avance.
3. **« Appliquer aux similaires » ne vérifiait que bénéficiaire + sens** (et une liste
   calculée avant le compte). **Correction** : similarité recalculée après proposition puis
   **revérifiée ligne par ligne à l'application** (bénéficiaire exact, sens, nature ;
   nature établie exigée pour 421/425/467), aperçu avec nature dans la liste.
4. **`accSave()` persistait les comptes pré-remplis par les propositions** comme des
   affectations « utilisateur ». **Correction** : un compte égal à la proposition
   automatique (sans classification explicite de nature) est retiré de `tx.account` :
   il reste une proposition, son origine n'est plus faussée.
5. **La clé d'apprentissage fusionnait les natures** : même bénéficiaire + même sens +
   natures différentes → conflit artificiel. **Correction** : la nature établie fait partie
   de la clé (`sens|nature|bénéficiaire`) ; salaire et remboursement coexistent en deux
   règles ; le conflit n'existe qu'à bénéficiaire + sens + nature identiques.
6. Les mois (« octobre », « novembre ») polluaient l'identité du bénéficiaire : exclus.
7. Le dossier est pris en compte : une règle apprise sous un autre couple journal/banque
   n'est pas appliquée ; l'interface rappelle que les règles sont **locales au poste**.

## 2. Classification explicite de la nature (nouveau)
Chaque proposition affiche un sélecteur de nature (auto-détectée, salaire,
remboursement/avance, virement interne, encaissement client, paiement fournisseur, autre
virement). Classer explicitement la nature lors d'une correction fonde la règle
bénéficiaire+nature correspondante. Accepter une suggestion confirme aussi sa nature.
Rappel affiché dans les règles : 421000 débité / 512000 crédité suppose la paie déjà
comptabilisée (641/645) — la proposition ne remplace pas cette vérification.

## 3. Scénario salaire contre remboursement (mesuré, suite V2.18)
Salarié fictif, 8 opérations témoins : salaire classé → variante SALAIRE (ordre inversé)
421000 automatique ; variante sans nature → suggestion à confirmer ; **remboursement :
jamais 421000** (règle propre 467000 après apprentissage) ; **avance : jamais 421000** ;
homonyme proche : rien d'automatique ; entrée du même bénéficiaire : règle sortie non
réutilisée ; libellé générique : en attente. Application aux similaires : seule la
variante de même nature est modifiée (revérification : lignes écartées comptées).

## 4. Tests réellement exécutés
| Suite | Résultat |
|---|---|
| `e2e-v220-nature.mjs` (nouveau, cas A–L du cahier des charges) | **18/18** |
| `e2e-v219-apprentissage.mjs` (adapté aux comportements durcis) | **20/20** |
| `e2e-v217-releve-reel.mjs` (relevé réel, 85 ops) | **11/11** |
| `e2e-v218-synth.mjs` | **16/16** |
| Non-régressions | banque 18/18 · L3 23/23 · V2.15 20/20 · L2 30/30 · V2.13 17/17 · fiabilité 13/13 |

Deux vrais bugs ont été trouvés par ces tests pendant le développement et corrigés
(référence `partial` renommée ; mois dans l'identité du bénéficiaire) — suites relancées après.

## 5. Limites restantes
- Une variante de libellé sans aucun indice de nature restera une suggestion à confirmer :
  c'est le comportement demandé (le nom seul ne prouve pas un salaire).
- Règles locales au navigateur/poste (localStorage), pas de partage multi-appareils.
- La classification manuelle de nature n'est pas historisée champ par champ dans
  l'historique du document (seules les règles apprises le sont).
- Android physique non testé (émulation Chromium).
