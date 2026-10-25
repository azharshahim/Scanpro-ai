# Rapport de livraison V2.22 — Fiabilité des relevés et sécurisation des lots (25/10/2026)

Branche : `feature/v2.22-fiabilite-releves` (base `main` = `634c3d6`, V2.21).
Méthode : exécution réelle dans Chromium automatisé (Playwright, émulation Pixel 7,
largeurs 320/360/390/430 px), données **100 % fictives** dans tous les tests automatisés.
Aucune donnée réelle n'est enregistrée dans le dépôt ni dans les tests.

---

## 1. Fichiers modifiés et créés

| Fichier | Nature | Contenu V2.22 |
|---|---|---|
| `src/ui.js` | Modifié | Moteur de relevés (`Acc.extractBank`, `bankFromPositions`) : correctifs M1/M2/M3 ; nouveau `accGroupConfirm` (récapitulatif avant action groupée) ; statuts de contrôles normalisés |
| `index.html` | Modifié | Rebuild bundle (`python3 build.py`) — seul artefact servi par le serveur statique |
| `tests/helpers/fake-releve.mjs` | **Créé** | Générateur pdf-lib de relevés fictifs : 5 jeux (`normal`, `hard`, `multipage`, `bnp`, `bnp` glyphes espacés) |
| `tests/e2e-v222-releves-fiabilite.mjs` | **Créé** | 36 assertions : moteur + parcours UI complet d'import PDF natif |
| `tests/audit-v221-lots-independant.mjs` | Modifié | Adaptation au récap (2ᵉ clic de confirmation), anti-double-clic durci, +4 checks mobile 320 px du sheet (58 → 62 assertions) |
| `tests/e2e-v222-lots.mjs` | Modifié | Parcours récap + assertion de contenu du sheet |
| `tests/e2e-v24.mjs`, `e2e-v25.mjs`, `e2e-v26.mjs`, `e2e-v27.mjs` | Modifiés | Correctifs de sélecteurs/imports de la section 1 (aucun test supprimé) |
| `.gitignore` | Modifié | Ajout du symlink `node_modules` (le motif `node_modules/` ne couvre pas un lien) |

---

## 2. Anomalies démontrées et corrigées

### M1 — Fuite d'en-têtes de page 2 dans un libellé de la page 1 (multipage)
`bankFromPositions` rattachait toute ligne sans date à l'opération précédente, y compris
les en-têtes répétés d'une nouvelle page. **Correctif :** une ligne sans date ne peut plus
se rattacher à une opération d'une autre page (`if (cur && r.page !== cur.page) { cur = null; continue; }`).
Preuve : sonde multipage, libellé `CB BOULANGERIE FICTIVE` désormais propre ; test M3 de la nouvelle suite.

### M2 — Relevés type BNP : soldes non reconnus, puis valeurs inventées
Le libellé `SOLDE CREDITEUR/DEBITEUR AU <date> <montant>` (parfois fragmenté `SOLDE C REDITEUR AU`)
n'était reconnu ni comme solde d'ouverture/clôture, ni comme ligne à exclure des opérations.
Une première version de la reconnaissance renvoyait un montant faux (`2,60` pris sur une ligne
voisine) — non acceptable. **Correctif conservateur :**
- première occurrence = ouverture, dernière = clôture ; solde débiteur = négatif ;
- le montant doit être sur la **même ligne** que le libellé (jamais récupéré sur une ligne voisine) ;
- les fragments de milliers (`3 3 88,42`) sont refusionnés via une regex dédiée (`fragRe`) ;
- structure ambiguë → `null` et champ `Non reconnu` : **aucune valeur n'est inventée**.
Preuve : tests B1–B10 (jeux `bnp` et `bnp2`), et B8 sur solde débiteur (`-250` / `-280`).

### M3 — Transactions fantômes et pieds de page pris pour des dates
Un pied de page `Page 1/4` voyait son `1/4` interprété comme une date et créait une opération
sans montant (constaté sur un relevé réel : 47 lignes dont 1 fantôme). **Correctifs :**
- exclusion par texte compacté des lignes de solde BNP et de pagination (`page n/n`) ;
- la date d'une opération doit occuper une cellule de gauche (`xc < 0,45`), jamais la zone
  montants/pied de page.
Preuve : B1/B2/B9 ; sur relevé réel exploratoire, le compteur retombe de 47 à 46 transactions
et la ligne sans montant disparaît.

### M4 — Actions groupées appliquées sans récapitulatif
Les trois actions de groupe (`validate`, `validate-rule`, `correct`) écrivaient immédiatement.
**Correctif :** `accGroupConfirm` ouvre un bottom-sheet qui montre, avant tout effet :
compte appliqué (et libellé du plan), nombre d'opérations traitées / déjà validées non touchées,
motif, origine (règle dossier / apprentissage / affectation utilisateur), niveau de confiance,
échantillon d'opérations, alerte spécifique pour la mémorisation de règle. Annulation = zéro
écriture (test A0/A0b) ; confirmation = application via `accGroupApply` inchangé.
Garde-fous : lot entièrement validé refusé avec toast d'**erreur** précis (jamais de faux
succès), champ compte vide refusé, compte introuvable refusé.

### M5 — Contrôles de relevé sans statut explicite
`extractBank` renvoyait des contrôles bruts (`ok` booléen sans `status`), rendant l'API
incohérente selon le chemin. **Correctif :** `Acc._finishControls(controls)` systématisé :
`conforme` / `ecart` / `impossible` / `a-controler` sur tous les contrôles.

### Principe conservé : une opération incertaine ne va jamais dans un compte ni dans un total
Montant à la frontière débit/crédit → non affecté, `a-verifier`, exclu des totaux (tests H2/H4),
valeur brute conservée dans `source`. Ligne incomplète conservée avec montants `null` (H6),
rien n'est inventé. Doublon strict signalé (`duplicate:true`) jamais supprimé automatiquement (H1).

---

## 3. Commandes et résultats (exécutés, non supposés)

Commande type : `node tests/<suite>.mjs` (serveur `http://127.0.0.1:8080`, bundle reconstruit
après chaque édition de source via `python3 build.py`).

### 3.1 Suites maintenues — 545 assertions, 0 échec (28 suites)

| Suite | Résultat | | Suite | Résultat |
|---|---|---|---|---|
| e2e-v24 | 9/9 | | e2e-compta-l2 | 30/30 |
| e2e-v25 (OCR Tesseract réel) | 9/9 | | e2e-compta-l3 | 23/23 |
| e2e-v26 | 13/13 | | e2e-compta-l4 | 19/19 |
| e2e-v27 | 10/10 | | e2e-compta-l5 | 18/18 |
| e2e-audit-v27 | 16/16 | | e2e-compta-l6 | 14/14 |
| **e2e-v222-releves-fiabilite** | **36/36** | | e2e-v215 | 20/20 |
| e2e-v222-lots | 22/22 | | e2e-v216-banque | 18/18 |
| audit-v221-lots-independant | 62/62 | | e2e-v218-synth | 16/16 |
| e2e-v219-apprentissage | 20/20 | | e2e-v220-nature | 18/18 |
| e2e-v221-ux | 56/56 | | e2e-v213 | 17/17 |
| e2e-fiabilite | 13/13 | | e2e-v214 | 15/15 |
| e2e-audit-extra | 8/8 | | e2e-v2141 | 8/8 |
| e2e-v2 / v21 / v22 / v23 | 16/16, 13/13, 18/18, 8/8 | | pdf-tools-v22, e2e-pages, desktop, perf-v2 | sortie 0, aucune erreur |

### 3.2 Scripts historiques non maintenus (défauts **anciens**, identiques sur la baseline V2.21)

| Script | Constats V2.22 | Constats identiques sur baseline V2.21 |
|---|---|---|
| `tests/e2e.mjs` | Timeout sur `[data-nav="settings"]` | Même échec (sélecteur pré-refonte V2.19) |
| `tests/e2e2.mjs` | Aucun résumé au format maintenu (flux caméra V2.0) | Identique |
| `tests/e2e-gh.mjs` | `ReferenceError: Assets is not defined` | Identique (global supprimé avant V2.21) |

Ces trois scripts V2.0 ne sont pas supprimés (consigne : ne pas supprimer un test qui échoue)
mais sont remplacés dans la couverture par les suites numérotées maintenues, toutes vertes.
`audit-bank-repro` (audit V2.15 de reproduction) : 13/14 défauts historiques non reproduits ;
**R11 reste reproduit à l'identique sur V2.21 et V2.22** (page d'origine forcée à 0 dans le chemin
texte sans mots positionnés) — défaut ancien, hors périmètre des correctifs V2.22, documenté.

### 3.3 Test sur relevé réel

`tests/e2e-v217-releve-reel.mjs` est **IGNORÉ** par construction tant qu'aucun relevé
anonymisé n'est fourni via `BANK_PDF_PATH` (le chemin par défaut n'existe pas) ; il ne peut
jamais réussir par défaut et aucune donnée réelle n'est dans le dépôt.
Des sondes exploratoires locales ont été lancées sur trois PDF fournis par l'utilisateur
(hors tests, hors dépôt, seules des métriques agrégées ont été lues) :
- relevé A (3 pages, 85 op.) : contrôles ouverture=clôture et totaux imprimés **conformes**, 0 à vérifier ;
- relevé B (5 pages) : après M3, 46 op. sans fantôme ni ligne sans montant ; 1 doublon légitimement
  signalé ; l'écart de solde existant est **maintenu visible** (jamais transformé en succès) ;
- relevé C type BNP (5 pages) : ouverture reconstituée (fragments refusionnés), clôture honnêtement
  `Non reconnue` plutôt qu'une valeur inventée ; les écarts réels restent affichés.

---

## 4. Couverture des 7 livrables demandés

1. **Réparation des suites legacy** — fait : v24/v25/v26/v27 vertes, assertions faibles remplacées
   par de vraies vérifications, distinction défauts anciens / régressions (§3.2), aucun test supprimé.
2. **Fiabilité PDF** — fait et testé sur PDF fictifs natifs (date/libellé/montant/sens, débit/crédit/solde,
   montants ambigus, anti-doublons, lignes incomplètes, multipage, formats BNP). Test sur relevé réel :
   **non automatisé** (sonde exploratoire uniquement, §3.3).
3. **Vue « à vérifier » + action groupée à récap** — fait : compteurs restants, groupes avec compte/effectif/
   confiance/origine, récap obligatoire avant application (tests A0–D6, L3, mobile 320 px).
4. **Apprentissage** — couvert par e2e-v219 (20/20), e2e-v220 (18/18), e2e-v222-lots : règle désactivée
   inopérante puis réactivée, automatisation coupée = suggestion, salaire/avance/remboursement d'un même
   salarié jamais confondus, ambigu laissé à confirmer, écriture validée jamais modifiée sans action,
   origine affichée.
5. **Contrôles comptables** — pas d'inversion silencieuse (N3/B3), montants/soldes conservés (N4/H6),
   une seule validation par opération (L3a), seconde demande refusée (L3b/D6a), historique ancien→nouveau
   (B7 du test indépendant), doublons signalés et jamais supprimés, écart jamais présenté comme succès.
6. **Android 320/360/390/430** — pas de débordement, cibles tactiles mesurées (boutons 56 px de haut,
   ≥120 px de large à 320 px), montants lisibles (15,5 px), sheet sans scroll horizontal, Paramètres
   centralisés. **Émulation viewport uniquement : aucun téléphone physique disponible.**
7. **Livraison** — branche dédiée, tests réellement exécutés, non-régression conservée, rapport +
   procédure manuelle ci-dessous, engagement de non-publication en cas d'échec (toutes les suites
   essentielles sont vertes).

---

## 5. Procédure manuelle sur téléphone Android (à exécuter par l'utilisateur)

1. Héberger le dossier (ou ouvrir `index.html` via un serveur local/intranet en HTTPS de préférence) ;
   dans Chrome Android, ouvrir l'URL.
2. Réglages → vérifier langue FR, thème, seuils de confiance ; noter la version affichée.
3. Importer un relevé PDF **de test** : menu Importer → choisir le PDF → attendre l'extraction du
   texte natif (pas de Tesseract sur un PDF numérique) → lancer l'analyse comptable.
4. Contrôler : nombre d'opérations, totaux débit/crédit, présence des bannières de contrôle
   (conforme / écart / vérification impossible), lignes « à vérifier », doublons signalés.
5. Onglet Comptabilité → ourir un groupe : lire compte proposé, effectif, confiance, origine ;
   cliquer une action de groupe → vérifier le **récapitulatif**, puis **Annuler** (rien ne bouge)
   et de nouveau → **Confirmer** (les lignes validées disparaissent des lots, l'historique est tracé).
6. Répéter aux largeurs réelles des petits appareils et vérifier l'absence de scroll horizontal,
   la taille des boutons et la lisibilité des montants ; tester le mode hors-ligne (service worker).
7. Faire varier un relevé difficile (montant mal aligné, doublon, ligne incomplète) et confirmer
   que l'app signale sans inventer de montant ni d'imputation.

---

## 6. Limites honnêtes

- **Aucun appareil Android physique** : la couverture mobile repose sur l'émulation de viewport
  Playwright (Pixel 7, 4 largeurs) ; les gestes caméra/capteurs et le clavier physique ne sont pas testés.
- **Aucun test automatisé sur relevé réel** : interdiction de versionner des données réelles respectée ;
  seules des sondes ponctuelles à métriques agrégées ont été réalisées (§3.3). Le test dédié reste
  en état « ignoré » en attendant un relevé anonymisé (`BANK_PDF_PATH`).
- Trois scripts V2.0 sont obsolètes (§3.2) et le défaut historique R11 subsiste ; ni l'un ni l'autre
  ne sont des régressions V2.22.
- Le correctif BNP est volontairement conservateur : un solde non lisible sur la même ligne reste
  `Non reconnu` (contrôle « vérification impossible ») plutôt que risquer une valeur fausse.

## 7. État git et publication

- Branche `feature/v2.22-fiabilite-releves`, commits V2.22 listés dans `git log` (cf. hash de tête).
- **Aucune fusion dans `main`, aucun déploiement GitHub Pages** sans accord explicite de l'utilisateur.
- Le site live reste en V2.21.0 au moment de ce rapport.
- Le token GitHub fourni dans la conversation ne doit jamais être écrit dans un fichier ou le dépôt ;
  sa **révocation est recommandée** (rappel déjà fait à plusieurs reprises).

---

# 8. Revue finale pré-fusion (postérieure à l'ouverture de la PR #12)

Revue ciblée demandée avant fusion. Aucune fusion, aucune modification de `main`, aucune nouvelle
version publiée : seuls des correctifs et des tests ont été ajoutés sur la branche de la PR.

## 8.1 Défauts supplémentaires trouvés pendant la revue et corrigés

Tous démontrés par sonde puis verrouillés par des tests négatifs (`tests/e2e-v222-soldes-bnp.mjs`) :

| # | Défaut constaté sur la version de la PR initiale | Comportement après correctif |
|---|---|---|
| F-a | `SOLDE CREDITEUR AU 01.10.26 CPTE 4567 500,00` : un numéro de référence était fusionné au montant → **4 567 500,00** | `Non reconnu` (texte alpha mêlé aux chiffres du montant) |
| F-b | `… REF 48889252 500,00` (structure vue sur un vrai BNP) → **48 889 252 500** | `Non reconnu` |
| F-c | Groupement de milliers non canonique `123 4 500,00` interprétable | `Non reconnu` |
| F-d | Entier sans décimale (`500`) accepté comme solde | `Non reconnu` (les soldes FR imprimés portent 2 décimales) |
| F-e | Date ISO `2026-10-01` non neutralisée → solde non reconnu | Reconnu (séparateurs `-` pris en compte) |
| F-f | Montant ≥ 1 million `12 345 678,90` rejeté à tort par une règle trop stricte | Reconnu (groupement canonique ××× généralisé) |

Principe conservateur confirmé par tests : le montant n'est jamais lu sur une ligne voisine (N1),
deux montants décimaux sur la ligne => `Non reconnu` (N2), un mot après le montant => `Non reconnu` (N7).
Limite assumée et testée (N9) : les soldes entre parenthèses ne passent pas par le chemin BNP
(le format BNP utilise le mot-clé DÉBITEUR ; les parenthèses restent gérées par les chemins de solde génériques).

## 8.2 Tests ajoutés pendant la revue (100 % fictifs, assertions de valeur fortes)

- `tests/e2e-v222-soldes-bnp.mjs` — **24 assertions** : 13 cas positifs (créditeur, débiteur négatif,
  milliers groupés/fragmentés, glyphes espacés, dates variées, devises, occurrences intermédiaires)
  et 10 cas négatifs (référence, double montant, entier sans décimale, groupement inverse, mot en fin,
  ligne voisine, absence du mot-clé AU, parenthèses, pied de page).
- `tests/e2e-v222-dispositions.mjs` — **12 assertions** : la frontière `xc < 0,45` est testée sur
  9 dispositions (date à 0,05 / 0,30 / 0,42 acceptée ; 0,48 et token médian 0,55 rejetés ;
  pied de page `Page 2/4` sans fantôme ; 3 pages avec en-têtes répétés ; ligne sans montant conservée).
- `audit-v221-lots-independant.mjs` renforcé (62 → **65 assertions**) : C2 vérifie désormais le compte,
  le sens et les tokens de la règle mémorisée (+ C2b nature honnêtement `inconnue`), F1 garde-fou
  compte vide (toast d'erreur, aucun sheet, zéro écriture), F2 double-clic sur confirmer (3 validations,
  3 entrées d'historique, jamais de double écriture).

## 8.3 Vérification depuis un environnement propre (simulation de runner)

Séquence identique à la CI, exécutée dans une copie sans `node_modules` ni `.git` :
`npm install` → `npx playwright install chromium` → `python3 build.py` → `PORT=8091 bash tests/run-ci.sh`.
Résultat : **12 suites, 293 assertions, 0 échec, code de sortie 0**.

## 8.4 Bilan complet des exécutions de la revue (tout réellement exécuté)

- Noyau CI (12 suites, dans la simulation runner) : **293 assertions OK**.
- Autres suites maintenues relancées sur le code durci (v25 OCR Tesseract réel, v218 OCR, v215,
  v216, fiabilité, compta L2–L6, v213/v214/v2141, v2/v21/v22/v23, pages, pdf-tools, desktop, perf) :
  toutes sorties 0, **295 assertions ou checks OK supplémentaires**, soit **588 vérifications au total, 0 échec**.
- Scripts V2.0 obsolètes (`e2e`, `e2e2`, `e2e-gh`) : mêmes échecs que sur la baseline V2.21, non régressions.
- `audit-bank-repro` : 13/14 défauts historiques non reproduits ; **R11 reste reproduit à l'identique**.

## 8.5 Périmètre exact du défaut R11 (vérifié par test, ni masqué ni prétendu corrigé)

- Scénario concerné : appel texte sans géométrie (`extractBank(texte, [])` — collage manuel ou OCR
  sans boîtes de mots) : la page d'origine de chaque opération vaut 0 par construction, faute de
  coordonnées pour la localiser. Les montants, libellés, dates, totaux et contrôles ne sont pas affectés.
- Parcours d'importation PDF standard V2.22 : **non concerné** — pdf.js fournit les boîtes de mots,
  `bankFromPositions` renseigne les vraies pages (test R11a : pages 0/1/1 exactes ; R11b documente
  la limite du chemin texte).

## 8.6 Intégration continue GitHub

- Avant cette revue, aucun statut CI n'était attaché aux commits : le seul workflow (`pages.yml`)
  se déclenche sur push `main` (déploiement) et le dépôt n'avait ni workflow de test ni `package.json`
  (Playwright était installé hors dépôt). Les tests locaux ne sont pas des contrôles GitHub.
- Ajout de `.github/workflows/tests.yml` (déclencheurs `pull_request` + manuel), `package.json`
  et `tests/run-ci.sh` : Chromium headless, construction du bundle, 12 suites portables sans donnée
  réelle ni OCR lourd. Les suites OCR (v25, v218) et les scripts obsolètes restent hors CI, exécutés localement.
- **Run réel constaté après poussée** : workflow `Tests Playwright`, exécution
  [40185456966](https://github.com/azharshahim/Scanpro-ai/actions/runs/40185456966),
  déclenchée par l'événement `pull_request` sur le commit `b015e60`, conclusion **success**
  (toutes les étapes au vert, y compris « Noyau de tests E2E » sur runner GitHub Ubuntu). Le check
  « E2E Chromium (données fictives) » est attaché à la PR #12. Les tests locaux et ce check GitHub
  sont deux preuves distinctes ; le check GitHub n'a été vert qu'après exécution réelle.

## 8.7 Relevé réel et confidentialité

- `tests/e2e-v217-releve-reel.mjs` reste **IGNORÉ** tant qu'aucun relevé **anonymisé de test** n'est
  fourni via `BANK_PDF_PATH` (vérifié : message d'ignorance, code 0). Les PDF disponibles dans
  l'environnement sont des relevés personnels réels : ils ne sont pas des fixtures anonymisées et ne
  sont jamais intégrés au dépôt ni à une suite automatisée. La validation sur relevé réel reste donc
  **à effectuer** (procédure manuelle §5 ; sondes exploratoires locales à métriques agrégées seulement).


---

# 9. Verdict de la revue finale

1. **Tests réellement exécutés** : 588 vérifications locales, 0 échec (noyau CI de 12 suites / 293
   assertions validé aussi dans une simulation de runner propre) ; run GitHub Actions **40185456966
   success** sur le commit de tête ; OCR Tesseract réel (v25, v218) vérifié localement.
2. **Défauts trouvés et corrigés pendant la revue** : interprétation arbitraire de numéros de
   référence comme montants de solde (F-a/F-b), entier sans décimale accepté (F-d), groupement de
   milliers trop strict (F-f) ; chacun est verrouillé par un test négatif. Les correctifs M1–M5 de
   la première livraison sont confirmés sans régression.
3. **Points restant à vérifier** : validation sur un **vrai relevé anonymisé** (test v217 ignoré en
   l'absence de `BANK_PDF_PATH`) ; procédure manuelle sur téléphone Android physique (§5, aucun
   appareil disponible en environnement) ; défaut R11 cantonné au chemin texte sans géométrie, documenté.
4. **Contrôles GitHub** : avant la revue, aucun (workflow de test inexistant) ; désormais un check
   E2E automatique et vert est attaché à la PR. `pages.yml` (déploiement) ne se déclenche que sur `main`.
5. **Verdict : PRÊT À FUSIONNER sous réserve de l'accord explicite de l'utilisateur.** Aucune fusion,
   modification de `main` ou publication n'a été effectuée ; le site live reste en V2.21.0.
