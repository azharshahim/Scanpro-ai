# Audit indépendant V2.21 — ScanPro AI (25/10/2026)

Périmètre : imputation intelligente et validation par lots livrées en V2.20. Méthode :
exécution réelle des tests dans un navigateur Chromium automatisé (Playwright, émulation
Pixel 7, données **100 % fictives**), relecture de code ciblée et tests de scénarios A → E
avec assertions fortes. Aucune donnée réelle n'a été utilisée ou modifiée.

## 1. Version publiée et état de la publication (vérifié, pas supposé)

| Vérification | Preuve |
|---|---|
| Dernier commit de `main` | `001ea6d` — « Fusion V2.20 : imputation intelligente et validation par lots (PR #10) » |
| V2.20 intégrée à `main` | Oui (commit `8553d31` fusionné dans `001ea6d`) |
| Version affichée par l'app | `window.ScanPro.version = 2.20.0` et écran « À propos » en 2.20.0 (avant correction) |
| Publication GitHub Pages | Dernier workflow `pages.yml` sur `001ea6dc`, conclusion **success**, déploiement `github-pages` 7306381869 |
| Site live vs `main` | `https://azharshahim.github.io/Scanpro-ai/index.html` **byte-identique (md5 identique)** à l'`index.html` de `main` |
| Service worker | Cache versionné `scanpro-ai-v2.20.0` ; navigation en mode **network-first** (HTML frais immédiatement) ; `activate` supprime les anciens caches `scanpro-ai-*` ; `init()` appelle `reg.update()` et affiche un toast « Nouvelle version disponible » ; cache incomplet réparé en ligne puis signalé |
| `index.html` vs sources | Reconstruction via `python3 build.py` : **aucune divergence** avant modification |

Conclusion : la V2.20 n'était pas seulement un commit ou un test annoncé, elle était bien
**publiée et servie**. Le mécanisme de cache ne peut pas figer silencieusement une ancienne
version de l'interface (network-first + nettoyage de cache + alerte).

## 2. Anomalies trouvées (toutes démontrées par test, jamais supposées)

| # | Sévérité | Anomalie | Preuve |
|---|---|---|---|
| A1 | Moyenne | **Compte de repli d'un lot emprunté à une ligne validée.** `accGroupApply` lisait le compte du lot sur `props[idxs[0]]` ; si la première ligne du lot était déjà validée sur un autre compte, les lignes sœurs héritaient de ce compte (au lieu de la proposition courante du groupe). Non déclenchable par un clic sur une carte rendue (le DOM exclut les lignes validées), mais atteignable par action groupée avec index obsolète/course de re-rendu. | Test indépendant D5 (échec avant correctif : sœurs passées à 626000 au lieu de 606100) |
| A2 | Faible | **Bruit de traçabilité.** Valider un groupe préalablement corrigé écrivait des entrées d'historique d'imputation `old === new` (ex. `606300 → 606300`), sans changement réel. | Sonde UI dédiée : 2 entrées parasites constatées |
| A3 | Faible | **Champ compte vidé = validation silencieuse sur la proposition.** Vider le champ puis cliquer « Valider le groupe » validait quand même au compte proposé, sans avertissement. | Sonde UI : toast de succès alors que l'utilisateur avait vidé le champ |
| A4 (R9) | Moyenne | **Montant à cheval sur deux colonnes (débit/crédit) affecté à un sens deviné.** L'opération était marquée `a-verifier` mais le montant était quand même inscrit dans une colonne, donc potentiellement reprise dans les calculs. | `tests/audit-bank-repro.mjs` R9 : `debit = 9.99` reproduit |
| H1 | Test | **Deux assertions invérifiables dans `e2e-v222-lots.mjs`** : `... || true` (seuils) et `docs.filter(...).length >= 0` (persistance, toujours vrai) — le test annonçait un succès de persistance qu'il ne vérifiait pas. | Lecture du code du test |
| H2 | Test | **Chemins absolus codés en dur** (`/home/user/scanpro/...`) dans la majorité des scripts : la suite n'est pas portable vers un autre clone. | `grep` des scripts |
| H3 | Test | **Dette de tests préexistante (non régressive V2.21)** : `e2e-v24/v25/v26` (et 2 assertions de `e2e-v27`) échouent sur `[data-nav="settings"]` / ancien bouton Scan flottant, supprimés par la refonte UX V2.19. **Échecs identiques reproduits sur `main` pristine.** | Exécution comparée branche V2.21 vs worktree `main` |
| R11 | Documentation | Le repro R11 (« page d'origine toujours 0 ») n'est reproductible qu'avec des pages OCR **vides artificiellement**. Avec des pages de mots réelles, `findZone` trace correctement la page (sonde : EDF → page 2, client → page 1). Aucun code modifié ; comportement réel démontré correct. | `probe-r11` (hors dépôt) |

## 3. Corrections réalisées et fichiers modifiés

Branche **`feature/v2.21-audit-lots`** (créée depuis `main` ; `main` / V2.20 laissés intacts).

| Fichier | Correction |
|---|---|
| `src/ui.js` | **A1** : le compte de repli d'un lot est désormais lu sur la première ligne **non validée** (`fallbackIdx`) ; si tout le lot est déjà validé, aucun enregistrement et message explicite. **A2** : entrée d'historique uniquement si `old !== account`. **A3** : champ rendu puis vidé → toast d'erreur et aucune modification. **A4/R9** : montant à la frontière débit/crédit laissé **non affecté**, statut `a-verifier`, note OCR contenant la valeur brute. |
| `src/app.js`, `src/views.js` | Version portée à **2.21.0** (objet `ScanPro.version` et écran « À propos »). |
| `src/sw.js`, `sw.js` | Cache renommé `scanpro-ai-v2.21.0` : l'activation du nouveau SW évacue l'ancien cache (logique existante vérifiée). |
| `index.html` | Reconstruit par `python3 build.py` (inclut les correctifs et la version 2.21.0). |
| `tests/e2e-v222-lots.mjs` | **H1** : remplacement des deux assertions tautologiques par de vraies assertions (niveau `moyen` au seuil 95 % ; persistance réelle des validations/comptes/historique après rechargement) ; ajout de la largeur 360 px. |
| `tests/audit-v221-lots-independant.mjs` | **Nouveau** test indépendant des scénarios A → E (47 assertions), dont les trois actions groupées réellement cliquées, la persistance forte après rechargement, les seuils invalides, le double-clic et les largeurs 320/360/390/430. |
| `README.md` | Titre passé à V2.21. |

Aucune écriture comptable automatique ne résulte de ces changements : tous les cas ambigus
restent soumis à validation humaine, conformément à la philosophie du dossier.

## 4. Commandes exécutées et résultats (build V2.21 final)

Serveur : `python3 -m http.server 8080` ; navigateur : Chromium Playwright (Pixel 7, fr-FR).

| Suite | Résultat |
|---|---|
| `node tests/audit-v221-lots-independant.mjs` | **47 OK / 0 échec** |
| `node tests/e2e-v222-lots.mjs` (renforcé) | **21 OK / 0 échec** |
| `node tests/e2e-v219-apprentissage.mjs` | **20 OK / 0 échec** |
| `node tests/e2e-v220-nature.mjs` | **18 OK / 0 échec** |
| `node tests/e2e-v221-ux.mjs` | **56 OK / 0 échec** |
| `node tests/e2e-fiabilite.mjs` | **13 OK / 0 échec** |
| `node tests/e2e-compta-l2..l6.mjs` | **30 + 23 + 19 + 18 + 14 OK / 0 échec** |
| `node tests/e2e-v216-banque.mjs` | **18 OK / 0 échec** |
| `node tests/e2e-v218-synth.mjs` | **16 OK / 0 échec** |
| `node tests/e2e-v215 / v2141 / v213 / v214 / v23 / v22 / v21 / v2` | **toutes OK / 0 échec** |
| `node tests/e2e-audit-extra.mjs`, `e2e-audit-v27.mjs` | **8 + 16 OK / 0 échec** |
| `node tests/audit-bank-repro.mjs` | **1 défaut reproduit (R11, artificiel) / 13 non reproduits** — R9 passé de « reproduit » à « non reproduit » |
| `node tests/e2e-v217-releve-reel.mjs` | **Ignoré honnêtement** : aucun PDF de référence (`BANK_PDF_PATH`), donnée réelle volontairement absente du dépôt — jamais annoncé comme réussi |
| `node tests/e2e-v24 / v25 / v26.mjs`, `e2e-v27` (2 assertions) | **Échecs préexistants identiques sur `main`** (sélecteurs UX V2.19), aucune régression V2.21 |

Synthèse : **382 assertions exécutées avec succès sur les périmètres tenus**, 0 échec de
régression imputable à V2.21, 1 défaut OCR historique refermé (R9), 1 repro artificiel
documenté (R11), 4 scripts obsolètes à rafraîchir (dette préexistante).

### Preuves des scénarios A → E (test indépendant)

- **A — Validation simple** : 3 EDF validés au 606100, les 10 autres opérations intactes,
  progression passée immédiatement de `0/13` à `3/13 (reste 10)` sans rechargement, 3 entrées
  d'historique tracées, carte retirée des lots, toast « 3 opération(s) validée(s) ».
- **B — Correction de compte** : 2 SFR passées à 626000 puis 606300 **sans être validées** ;
  seul le groupe concerné change ; historique `en attente → 622600` puis `622600 → 606300`
  (ancien et nouveau conservés) ; la carte se recalcule sur le nouveau compte.
- **C — Apprentissage** : « Valider + créer une règle » crée la règle `sortie|eau veolia →
  606300` ; un nouveau document réimporté propose automatiquement 606300 (origine
  `apprentissage`) ; règle désactivée → retour à la règle dossier 606100, jamais 606300.
- **D — Sécurité comptable** : salaire (421000), avance et remboursement du même salarié
  restent dans des groupes distincts (jamais de 421 automatique sur l'avance/le remboursement) ;
  une opération pré-validée sur un autre compte reste **inchangée, horodatage identique**, et
  le lot signale « 1 déjà validée(s) non touchée(s) » ; le libellé inconnu reste sans compte.
- **E — Persistance** : après rechargement, les 3 documents, les 13 opérations (mêmes libellés
  dans le même ordre), les validations, les comptes, l'historique (≥ 7 imputations) et la
  règle apprise sont tous conservés dans IndexedDB / localStorage.
- **Limites** : seuils `null/'abc'/0/-5/200` ne font rien planter (repli 85/55) ; libellé sans
  bénéficiaire (`PRLV SEPA`) laissé en attente ; double-clic simultané = une seule validation
  par opération (2 écritures, pas de double comptabilisation) ; largeurs 320/360/390/430 :
  aucun débordement, boutons et champs tous dans l'écran et cliquables.

## 5. Limites restant à vérifier sur téléphone physique

1. **Aucun appareil Android physique ni émulateur système** n'était disponible : les vérifications
   mobiles ont été faites en émulation Chromium Pixel 7 (touch, `isMobile`, viewports 320/360/390/430),
   qui prouvent la mise en page mais pas le comportement tactile constructeur (claviers spécifiques,
   gestures, WebView OEM).
2. Le **test de relevé PDF réel** (`e2e-v217`) n'a pas pu être exécuté (fichier de référence absent
   par construction) : fournir un relevé anonymisé via `BANK_PDF_PATH` pour le jouer.
3. Reste à valider sur device : installation PWA depuis l'écran d'accueil, cycle de mise à jour du
   service worker en conditions réseau intermittentes, et comportement de IndexedDB en navigation
   privée (le code affiche déjà un avertissement de repli mémoire, testé en émulation).
4. Les scripts `e2e-v24/v25/v26` et deux assertions `e2e-v27` doivent être rafraîchis pour la
   navigation V2.19 (Paramètres désormais accessibles via `[data-act="go-settings"]`).

## 6. Publication

- La V2.21 est livrée sur la branche **`feature/v2.21-audit-lots`** (commit de livraison référencé
  dans le dépôt). **Aucune fusion dans `main`, aucun déploiement GitHub Pages** : le site live reste
  en V2.20 tant que la V2.21 n'est pas validée. La publication se fera par PR → fusion `main`,
  qui déclenchera `pages.yml` ; le changement de nom du cache SW garantira le remplacement propre.
- Tous les tests essentiels étant au vert, rien ne s'oppose à la revue de PR ; en revanche, ne pas
  publier si la vérification téléphone (point 5) révèle un blocage.
