# Audit prioritaire — extraction des relevés bancaires (V2.15, 24/10/2026)

Branche : `audit/releves-bancaires` (depuis `main` = V2.15.0 `dfa0d2d`). Aucune modification de `main`.
Méthode : lecture complète du code, puis **tests de reproduction exécutés** (`tests/audit-bank-repro.mjs`,
Chromium mobile émulé, code actuel sans correction). Résultat : **13 défauts reproduits, 1 hypothèse écartée**.
Baseline existante : `tests/e2e-compta-l3.mjs` (relevés) = **23/23** — les formats simples mono-ligne couverts
par cette suite fonctionnent ; les défauts ci-dessous concernent des formats réels non couverts.

## 1. Fichiers concernés

| Fichier | Rôle dans la chaîne |
|---|---|
| `src/core.js` (`OCR.run`, `PDF.renderPages`) | OCR Tesseract : `wordBoxes`/`lineBoxes` normalisés 0–1, plafond 3 000 mots ; PDF **rasterisés** en images puis OCR |
| `src/app.js` (`runOcr`, listes blanches pages) | OCR page par page sur l'image **rendue** (recadrage/perspective/rotation appliqués) ; `ocrWords`/`ocrLines` persistés |
| `src/ui.js` (`Acc.extractBank`, `bankFromPositions`, `positionRows`, `groupWordLines`, `toBankCsv`, `findZone`) | Extraction texte + positions, contrôles, export CSV |
| `src/views.js` | Relecture des opérations (champs éditables date/libellé/débit/crédit/solde) — **l'affichage n'est pas en cause** |

## 2. À quel endroit les libellés sont perdus (chaîne prouvée)

1. **OCR initial (PDF)** : la couche texte native du PDF n'est **jamais lue** (`getTextContent` absent de tout le
   code) : tout PDF, même numérique parfait, est rasterisé (≤ 2 400 px) puis OCRisé → erreurs OCR évitables
   sur libellés et montants, et positions approximatives au lieu des positions exactes du PDF.
2. **Regroupement des mots en lignes** (`groupWordLines`) : regroupe par ordonnée (tolérance ≈ 1,2 % de la
   hauteur) — correct pour des lignes franches, mais **une ligne de continuation de libellé forme une ligne
   séparée**, que l'étape suivante écarte (R7).
3. **Reconstruction des colonnes** (`bankFromPositions`) : voir B-05 à B-09, B-14.
4. **Analyse des montants / lignes de texte** (`extractBank`) : voir B-01 à B-04, B-13.
5. **Fusion texte/positions** : le résultat « positions », même partiel, **remplace intégralement** le texte (B-06).
6. **Affichage/export** : fidèles aux données extraites, sauf le signalement des doublons absent du CSV (B-10).

## 3. Défauts prouvés (tests `audit-bank-repro.mjs` exécutés le 24/10/2026)

| ID | Étape | Défaut | Preuve (résultat réel) |
|---|---|---|---|
| B-01 | Texte | Libellé multi-ligne : si le montant est sur la ligne de suite (sans date), **l'opération entière est perdue** | R1 : 0 opération extraite |
| B-02 | Texte | Séparateur de milliers U+202F/U+00A0 non reconnu par `amountRe` (`[ ]` seul) : `1 234,56` lu **234,56** | R2 : crédit = 234,56 |
| B-03 | Texte | Sens débit/crédit **uniquement par mots-clés** : libellés neutres (« DEPOT ESPECES », « OPERATION DIVERSE ») non classés, exclus des contrôles de solde | R3 : 2 × `a-verifier`, débit/crédit nuls |
| B-04 | Texte | Hypothèse « montant = avant-dernier nombre » : un montant **dans le libellé** est pris comme montant d'opération, le vrai montant devient « solde » | R4 : crédit = 12,50 (libellé), « solde » = 45,90 |
| B-05 | Positions | En-tête répété à chaque page : `headerIdx` ne retient que le **dernier** en-tête → toutes les opérations des pages précédentes sont ignorées (`i <= headerIdx` sur la liste concaténée) | R5 : 1 seule opération (page 2) sur 2 pages |
| B-06 | Fusion | `bankFromPositions` non vide **remplace** le texte sans fusion ni comparaison | R6 : 5 opérations texte → 1 conservée |
| B-07 | Positions | Ligne de continuation sans date jamais rattachée au libellé précédent | R7 : libellé « CB SUPERMARCHÉ » sans « CARTE 1234 PARIS » |
| B-08 | Positions | Date obligatoirement en **première cellule** : une colonne Référence avant la date fait ignorer toute l'opération | R8 : `null` |
| B-09 | Positions | Affectation à l'ancre la plus proche (tolérance fixe 0,18) : un petit montant **crédit** entre deux colonnes proches est affecté au **débit** (les ancres sont les centres des mots d'en-tête, pas les centres de colonnes) | R9 : 9,99 au débit, source affichée « colonnes débit » |
| B-10 | Export | Doublons détectés (`duplicate: true`, chip à l'écran) **non signalés dans le CSV** (`toBankCsv` ne lit que `status`) | R10 : CSV sans mention pour la ligne doublon |
| B-11 | Texte | Page d'origine toujours `0` pour les opérations issues du texte (multi-pages non tracé) | R11 : `page = 0` |
| B-12 | Pipeline | Plafond **3 000 mots/page** silencieux (`slice(0, 3000)`) : un relevé dense perd sa fin sans signal ; couche texte PDF jamais exploitée (voir §2.1) | Lecture de code `src/core.js:490` + absence de `getTextContent` |
| B-13 | Texte | Filtre anti-total trop large : toute ligne contenant « solde » est écartée, y compris une opération légitime (« SOLDE INTERETS CREDITEURS ») | R13 : 0 opération |
| B-14 | Positions | Sans en-tête « Solde » mais avec colonne solde imprimée : le solde, plus proche de l'ancre Crédit, **écrase le vrai crédit** (affectations successives sans garde) | R14 : crédit = 1 100 (le solde) au lieu de 100 |

**Hypothèse écartée** (R12) : la colonne unique « Montant » signée sans solde ligne à ligne est correctement
traitée par le chemin texte (`-12,40` → débit, `+2 100,00` → crédit). À conserver tel quel.

## 4. Coordonnées : ce qui est réellement utilisé

- `wordBoxes`/`lineBoxes` : coordonnées **normalisées 0–1** par rapport à l'image **rendue pour l'OCR**
  (`ImageOps.render` : perspective, recadrage, rotation, filtres déjà appliqués). Cohérentes entre PDF et photo
  *dans ce repère rendu*, mais **pas** dans le repère de l'image d'origine affichée : après redressement de
  perspective, une zone 0–1 du rendu ne désigne la même zone de l'original que si l'affichage utilise la même
  image rendue. C'est une limite de traçabilité à documenter, pas un décalage mesuré dans cet audit.
- `groupWordLines` suppose des lignes horizontales dans le repère rendu : un document incliné **après**
  redressement insuffisant mélange les lignes (tolérance fixe) ; aucun regroupement par blocs/colonnes
  verticales du tableau n'est tenté. Les ancres sont les centres des **mots** d'en-tête (B-09).
- Dates de valeur : gérées par le chemin texte (2ᵉ date en début de ligne) mais **jamais par le chemin
  positions** (`valueDate: null` en dur), et la première cellule doit être la date (B-08).

## 5. Formats pris en charge / non pris en charge (état actuel)

| Format | Texte | Positions | Verdict |
|---|---|---|---|
| Colonnes Débit/Crédit/Solde, mono-ligne, en-tête unique | ✔ (par mots-clés) | ✔ | Couvert (L3 23/23) |
| Idem, en-tête répété par page | ✔ | ✘ B-05 | **Cassé en positions** |
| Libellés multi-lignes | ✘ B-01 | ✘ B-07 | **Perte d'opérations/libellés** |
| Colonne unique Montant signée, sans solde | ✔ (R12) | ✘ (null → repli texte) | OK via texte |
| Montant + solde, libellé contenant un montant | ✘ B-04 | partiel | **Montant faux** |
| Colonne Référence avant la date | partiel | ✘ B-08 | **Opération ignorée** |
| Dates de valeur | ✔ | ✘ (`null`) | Incomplet en positions |
| Opérations sans solde ligne à ligne | ✔ si 1 montant | ✔ | OK |
| Colonne solde sans en-tête « Solde » | — | ✘ B-14 | **Solde pris pour un crédit** |
| PDF numérique (texte natif) | OCR raster | OCR raster | **Texte exact jamais exploité (B-12)** |

## 6. Plan de correction proposé (à valider avant implémentation)

**P1 — Ne plus perdre d'opérations (fusion et rattachement)**
1. Rattacher les lignes sans date à l'opération précédente (texte **et** positions) au lieu de les écarter (B-01, B-07).
2. Fusionner texte et positions au lieu du remplacement intégral : conserver la source la plus complète
   par opération, ne jamais réduire le nombre d'opérations sans signal explicite (B-06).
3. En-têtes **par page** : traiter chaque page avec son propre en-tête (B-05) ; accepter la date dans les
   premières cellules (recherche du motif date dans la ligne) plutôt qu'en cellule 0 (B-08).

**P2 — Montants et sens fiables**
4. Étendre `amountRe` aux espaces U+00A0/U+202F (B-02) et restreindre le filtre « solde » aux lignes de
   total (mot en début de ligne ou suivi d'un signe/deux-points) (B-13).
5. Colonnes par **intervalles** (frontières à mi-distance entre ancres) au lieu du plus-proche avec tolérance
   fixe ; refuser l'affectation si le montant tombe hors de tout intervalle de colonne connue (B-09) ;
   ne jamais laisser un second montant écraser un montant déjà affecté à la même colonne (B-14).
6. Chemin texte : lorsque ≥ 3 nombres sont présents, ne plus supposer « avant-dernier = montant » sans
   contrôle de cohérence avec le solde précédent/suivant ; à défaut, marquer `à vérifier` (B-04).
7. Signaler les doublons dans le CSV (B-10) et tracer la vraie page des opérations texte quand le texte
   par page est disponible (B-11).

**P3 — Pipeline PDF**
8. Lire la couche texte native des PDF numériques (pdf.js `getTextContent`, positions incluses) et ne
   rasteriser/OCRiser que les pages sans texte exploitable (B-12) ; signaler toute troncature du plafond
   de mots au lieu de la taire.

Chaque correction sera accompagnée de tests convertissant ces reproductions en contrôles de non-régression
(les R1–R14 deviendront des attentes de comportement corrigé), en plus des 23 tests L3 existants.
Aucune autre fonction (scanner, autres extracteurs, exports) ne doit être modifiée au passage.

---

## Addendum — corrections appliquées (24/10/2026, branche `audit/releves-bancaires`)

Plan P1→P3 implémenté ; les 14 reproductions sont converties en non-régressions dans
`tests/e2e-v216-banque.mjs` (**18/18**, exécuté). La suite d'audit d'origine, réexécutée après
correction, ne reproduit plus que **2 constats résiduels documentés** :
- R9 : un montant physiquement entre deux colonnes reste rangé du côté le plus proche mais
  **n'est plus affirmé** : statut « à vérifier », confiance 45, source « colonne ambiguë ».
  Aucune affectation certaine n'est possible sans information supplémentaire — c'est le
  comportement honnête attendu.
- R11 : sans aucune position de mot (texte seul), la page d'origine reste 0 ; dès que les
  positions existent, la page est retrouvée via `findZone` (testé).

Non-régressions après correction : L3 relevés 23/23, L2 30/30, L4 19/19, L5 18/18, L6 14/14,
V2.13 17/17, V2.14 15/15, V2.14.1 8/8, V2.15 20/20, fiabilité 13/13, validateur d'exports TOUT OK.
Corrections livrées : opérations multi-lignes (texte et positions), en-têtes par page, date
dans les premières cellules, colonnes par intervalles sans écrasement, espaces U+00A0/U+202F,
montant de libellé distingué du montant d'opération, filtre « solde » restreint, fusion
texte+positions sans perte, contrôle de cohérence des soldes ligne à ligne, doublons signalés
dans le CSV, et lecture de la couche texte native des PDF numériques (OCR uniquement pour
les pages image). Limite inchangée : aucun test sur appareil Android physique.
