# Rapport d'audit — ScanPro AI vers un assistant documentaire comptable

**Phase A — audit de l'existant (avant toute évolution comptable)**
- Date : 24 octobre 2026 · Version auditée : **2.7.1 publiée** (`main` `7bfb408`, tag `v2.7.1`, https://azharshahim.github.io/Scanpro-ai/ — HTTP 200)
- Branche de travail : `audit/comptabilite-phase-a` (créée depuis la production ; `main` intacte)
- Méthodes : lecture du code réel (`src/*.js`), relance des suites Playwright (Chromium émulé Pixel 7, 360×740, serveur local), mesures champ par champ de l'extraction facture sur textes fictifs contrôlés via `ScanPro.AI.extractInvoice`.
- **Aucun test sur appareil Android physique n'a été réalisé pour cet audit.** Les tests automatisés sont des tests navigateur émulé ; ils ne valent pas validation sur téléphone réel.

## 1. Audit fonction par fonction

| Fonction | État constaté | Preuve / test | Anomalie | Risque | Correction proposée | Après correction |
|---|---|---|---|---|---|---|
| Caméra, rafale, import photos/PDF | ✅ Réel | Suites V2 (16/16), V2.1 (13/13), audit (16/16) ; refus caméra simulé sans crash (extra 8/8) | Caméra réelle non testée ici | Écart émulé/réel | Test physique Android (Phase J) | — |
| Contours, perspective, rotation, recadrage, filtres | ✅ Réel | `e2e-v2`, `vision-test*`, audit coins A-01 (ratio 0,74=0,74, poignée 97 %/97 %) | Deskew volontairement conservateur | Document très incliné à corriger à la main | Conserver ; réglage manuel fiable | Corrigé en 2.7.1 |
| Nettoyage magique + original conservé | ✅ Réel | Suite V2.2 ; pipeline conserve `page.src`, filtres non destructifs, Annuler/Rétablir testés | — | — | Ajout filigrane fait (2.7.1) | ✅ |
| OCR FR/EN (+ES/DE/IT/PT), édition, sauvegarde du texte | ✅ Réel | OCR réel testé FR/ES (V2, V2.5) ; éditeur de texte et persistance IndexedDB testés | Confiance OCR **globale** seulement ; les positions de mots (`bbox` Tesseract) sont **jetées** (`src/core.js` ne conserve que texte/confiance/mots incertains) | Impossible de relier un champ extrait à sa zone sur la page (exigence Phase C/H) | Conserver `bbox` des mots/lignes dans le résultat OCR et le persister par page | À faire (Livraison 2) |
| OCR des PDF importés | ✅ Réel | V2 : OCR d'un PDF importé, conversion PDF→pages éditables | Idem bbox | Idem | Idem | À faire |
| Extraction facture actuelle (`AI.extractInvoice`) | ⚠️ **Partielle** | Mesures §2 : facture simple 12/12 champs présents corrects ; multi-TVA et avoir défaillants | Voir §2 (C-01→C-05) | Erreurs silencieuses en comptabilité | Refonte structurée Phase C | À faire (Livraison 2) |
| Panneau facture éditable + CSV/JSON | ⚠️ Partiel | `renderInvoicePanel` : champs éditables, export CSV (`Champ;Valeur`) et JSON plats | Corrections **non persistées** (relues du DOM à l'export, perdues à la fermeture) ; pas de lignes d'articles ; CSV 2 colonnes inexploitable en écritures | Perte de corrections ; pas d'import logiciel comptable | Modèle de données persisté par document + CSV/XLSX structurés | À faire (Livraison 2) |
| Classification de documents | ⚠️ Basique | `AI.classify` : mots-clés, 5 types (Facture, Contrat, Identité, Bulletin de paie, Courrier) | Ne couvre **aucun des 14 types comptables** demandés sauf facture/paie approximative ; score heuristique présenté en « confiance % » | Mauvais aiguillage dans l'espace Comptabilité | Nouveau classifieur 14 types + proposition modifiable par l'utilisateur | À faire (Livraison 2) |
| Relevés bancaires | ❌ Absent | Aucun code d'extraction de transactions (recherche `solde/transaction` : rien) | — | — | Phase D | À faire (Livraison 3) |
| Bulletins de salaire structurés | ❌ Absent | Seule la classification par mots-clés existe | Risque de confusion brut/net si extraction naïve future | Élevé (données sensibles) | Phase E, champs distincts, local uniquement | À faire (Livraison 4) |
| Bilans / comptes de résultat | ❌ Absent | Aucune conservation de structure tabulaire OCR | OCR texte linéaire perd lignes/colonnes | Totaux faux | Phase F, aperçu tabulaire éditable | À faire (Livraison 4) |
| Prêts / amortissements | ❌ Absent | Aucun code | — | — | Phase G, distinguer reconnu vs recalculé | À faire (Livraison 5) |
| Documents : recherche, renommage, suppression, persistance | ✅ Réel | Suites V1→V2.6 relancées : 0 échec, 0 erreur console ; restauration ZIP 3→6 docs | Suppression : vérifier la confirmation systématique (testée par suites existantes) | Faible | — | — |
| Fusion, export, partage, impression PDF | ✅ Réel | V2/V2.2 : fusion, PDF enrichi 483 Ko, impression via `docPrint` | — | — | — | — |
| Exports TXT, DOCX, XLSX | ✅ Réels | Partages testés 2.7.0/2.7.1 (XLSX OOXML « PK » vérifié) | XLSX facture = paires champ/valeur, pas de lignes ni montants typés (tout est texte inlineStr) | Montants non numériques dans Excel | Cellules numériques typées (Livraison 2) | À faire |
| Export CSV / JSON | ⚠️ Limité facture | `AI.invoiceCsv`, bouton JSON du panneau facture | CSV non tabulaire ; aucun CSV/JSON pour les autres types ni par opération | Intégrations impossibles | Exports par type (Phases C→G) | À faire |
| Hors-ligne, PWA, service worker | ✅ Réel | Extra 8/8 : SW `activated`, rechargement hors-ligne OK, cache `scanpro-ai-v2.7.1`, 6 langues OCR pré-cachées | — | — | — | Corrigé en 2.7.1 |
| Android mobile, erreurs | ⚠️ Émulé seulement | 360×740 sans débordement, zones tactiles ≥36 px, messages en français | **Aucun test sur appareil réel** | Inconnu (caméra, partage natif, mémoire) | Campagne Android réel (Phase J) | Non exécuté |
| Sécurité / confidentialité | ✅ Conforme | 0 requête externe observée en audit ; tout est local ; aucun secret dans le dépôt (`git grep` vérifié à la publication) ; repli CDN = bibliothèques publiques uniquement, sans envoi de document | Sauvegarde ZIP locale non chiffrée (à documenter clairement) | Fuite si fichier de sauvegarde partagé | Documenter ; chiffrement optionnel à étudier | Documentation à aligner |

## 2. Mesures champ par champ de l'extraction facture actuelle

Protocole : textes OCR fictifs parfaits (aucune erreur OCR) injectés dans `AI.extractInvoice` — on mesure donc uniquement l'extracteur, pas l'OCR.

| Cas | Résultat mesuré |
|---|---|
| Facture simple (1 TVA 20 %, SIRET, échéance) | ✅ 12/12 champs corrects, virgules FR et espaces milliers gérés (`2 500,00 €` → `2500.00`) |
| Multi-TVA (20 % + 5,5 %) | ❌ **C-01** : seul le 1ᵉʳ taux/montant TVA est retourné (120,00) ; le 2ᵉ (22,00) est **perdu**. Numéro `F-2026-88` **non reconnu** (formats acceptés trop étroits). Aucune ligne d'article extraite. |
| Avoir (−250/−50/−300 €) | ⚠️ **C-02** : signes négatifs **préservés** ✅, mais numéro `AV-2026-03` non reconnu et **type « avoir » non distingué** d'une facture. |
| Facture partielle (seul TTC lisible) | ❌ **C-03** : fournisseur « déduit » = **« Merci »** (dernière ligne du texte prise comme émetteur) — **information inventée**, contraire à l'exigence « Non reconnu ». Échéance par défaut = 2ᵉ date trouvée (**C-04**, heuristique dangereuse). |

**Anomalies à corriger en Livraison 2 :**
- **C-01** (élevée) : TVA multiples et lignes d'articles absentes du modèle de données.
- **C-02** (moyenne) : type de document (facture/avoir/devis…) non détecté ; formats de numéros trop restrictifs.
- **C-03** (élevée) : repli « première/dernière ligne » invente un fournisseur → supprimer, retourner « Non reconnu ».
- **C-04** (moyenne) : échéance devinée depuis la 2ᵉ date → ne remplir que si libellé explicite.
- **C-05** (élevée, transverse) : **aucune confiance par champ, aucun lien champ→page/zone, corrections non persistées**. L'OCR jette les `bbox` Tesseract : il faut les conserver dès la Livraison 2.

## 3. Comparaison aux références du marché (sources web, 24/10/2026)

| Critère | Adobe Scan | CamScanner | ScanPro AI 2.7.1 |
|---|---|---|---|
| Scan, perspective, filtres | ✅ [3](https://droidlore.com/productivity/productivity-apps-documents) | ✅ | ✅ équivalent local |
| OCR multilingue | ✅ cloud, compte Adobe [5](https://avis-services.fr/en/blog/best-document-scanning-services/) | ✅ quotas gratuits [10](https://apps.apple.com/fr/app/camscanner-pdf-scanner-app/id388627783) | ✅ 6 langues, **local, sans compte** |
| Exports Word/Excel | Payant (Acrobat) [1](https://www.papperclass.com/fr/blog/adobe-scan-camscanner-papperclass-comparatif-2026) | Premium [6](https://zapier.com/blog/best-mobile-scanning-ocr-apps/) | ✅ gratuit (DOCX/XLSX/TXT/PDF) |
| Hébergement / vie privée | Cloud Adobe (US) [1](https://www.papperclass.com/fr/blog/adobe-scan-camscanner-papperclass-comparatif-2026) | Cloud hors UE [1](https://www.papperclass.com/fr/blog/adobe-scan-camscanner-papperclass-comparatif-2026) | ✅ **100 % local, aucun envoi** — avantage différenciant pour paie/comptabilité |
| Extraction comptable structurée (TVA multiples, lignes, relevés, paie) | ❌ | ❌ | ❌ **aujourd'hui — c'est l'objet des Livraisons 2→5** |
| Filigrane / publicités | Aucun / aucune (gratuit limité) [4](https://docuguru.ch/blog/adobe-scan-vs-camscanner) | Filigrane + pubs en gratuit [3](https://droidlore.com/productivity/productivity-apps-documents) | ✅ aucun |

Conclusion : le socle « scanner » est au niveau des références pour un usage local ; l'écart est entièrement sur la **structuration comptable**, absente aussi chez ces deux références grand public — la différenciation visée est donc crédible, à condition de ne pas surestimer la fiabilité : chaque champ devra porter sa confiance et rester corrigeable.

## 4. Risques majeurs identifiés avant évolution

1. **Fiabilité comptable** : une extraction silencieusement fausse (C-01/C-03) est pire qu'aucune extraction. Règle : « Non reconnu » plutôt qu'une déduction, confiance par champ obligatoire.
2. **Traçabilité** : sans `bbox` OCR conservées, impossible de prouver l'origine d'un montant (exigence Phases C/H).
3. **Données de paie** : traitement local uniquement, aucun journal technique contenant des données personnelles ; suppression complète déjà possible (documents + OCR dans IndexedDB) — à re-vérifier à chaque livraison.
4. **Précision numérique** : formats FR (`1 234,56`), signes, zéros initiaux des identifiants (SIRET, IBAN, références) à préserver en texte ; montants exportés en cellules numériques typées, jamais reformattés en chaîne.
5. **Pas de rapprochement bancaire** tant que la comparaison écritures/opérations n'existe pas (Phase D : contrôles de soldes uniquement).

## 5. Plan validé par l'audit (inchangé, séquencé)

- **Livraison 1 (celle-ci)** : rapport, aucune fonction importante modifiée. Corrections déjà livrées en 2.7.1 (coins, filigrane, cache SW).
- **Livraison 2** : espace **Comptabilité** (nouvel onglet, navigation existante conservée), modèle de données comptable persisté, OCR avec `bbox`, extraction facture refondue (types, lignes, multi-TVA, avoirs, confiance par champ, lien page/zone, correction persistée), exports CSV tabulaire + XLSX typé + JSON.
- **Livraison 3** : relevés bancaires (transactions, débit/crédit distincts, contrôles d'ouverture/clôture, doublons potentiels, exports ligne par opération).
- **Livraison 4** : bulletins de salaire (champs nets distincts), bilans/comptes de résultat (tableaux éditables, contrôles arithmétiques).
- **Livraison 5** : prêts et amortissements (reconnu vs recalculé explicitement distingués), traçabilité complète.
- Chaque livraison : branche dédiée, jeux de tests anonymisés, mesures champ par champ, rapport mis à jour, **aucun test Android réel déclaré s'il n'a pas eu lieu**.

## 6. Tests relancés pour cet audit (navigateur émulé, 24/10/2026)

| Suite | Résultat |
|---|---|
| e2e-audit-v27 / e2e-audit-extra | 16/16 · 8/8 |
| e2e-v27 / e2e-v26 | 10/10 · 12/12 |
| e2e-v22 / e2e-v2 / e2e / e2e2 | 18/18 · 16/16 · OK (0 erreur console) · OK (0 erreur console) |
| Mesures extraction facture (§2) | Simple ✅ · Multi-TVA ❌ · Avoir ⚠️ · Partielle ❌ |

**Non exécutés** : Android physique, caméra réelle, partage natif, gros volumes, stockage plein — à couvrir en Phase J, jamais déclarés réussis par avance.

---

## Livraison 2 — Espace Comptabilité et extraction facture structurée (24/10/2026)

Branche `feature/comptabilite-livraison2`, version **2.8.0**. `main` fusionnée après tests (voir publication).

### Réalisé et testé (`tests/e2e-compta-l2.mjs` : **30/30**, navigateur émulé)
- **Onglet « Compta »** ajouté à la navigation (Accueil, Documents, Scan, Outils, Paramètres inchangés) ; vue liste + analyse par document, sans débordement à 360 px.
- **OCR traçable (C-05)** : `OCR.run` retourne les positions relatives des mots (`wordBoxes`) ; persistées par page (`ocrWords`, y compris à la création/remplacement de pages — bug corrigé pendant les tests) et par document PDF importé (`ocrWordBoxes`).
- **Extraction refondue `Acc.extractInvoice`** : type parmi 14 types comptables (proposé, modifiable), émetteur uniquement labellisé (**C-03 corrigé** : plus jamais la dernière ligne), échéance uniquement labellisée (**C-04**), numéros élargis `F-2026-88`/`AV-2026-03` (**C-02**, avoir distingué, signes négatifs préservés), SIREN/SIRET séparés en texte, **TVA multiples et lignes d'articles** (**C-01**), confiance par champ, zone d'origine avec bouton « Voir p.N » et surlignage sur la page.
- **Corrections persistées** dans IndexedDB (`doc.acc`, statut « corrigé », vérifié après rechargement).
- **Contrôles** : HT+TVA=TTC, somme des lignes=HT, avoir positif signalé ; les valeurs recalculées sont affichées à part et ne remplacent jamais les montants reconnus.
- **Exports** : CSV tabulaire (champs + lignes + TVA), XLSX avec montants en cellules numériques, JSON structuré. Originaux, OCR et pages restent accessibles depuis le document.
- Non-régressions : V2.7 10/10, audit 16/16 + 8/8, V2.6 12/12, V2 16/16, V2.2 18/18.

### Reste partiel / limites
- Sens achat/vente proposé par heuristique et toujours modifiable ; pas de validation comptable officielle.
- Lignes reconnues sur le motif « description quantité × prix = total » ; d'autres présentations (tableaux à colonnes séparées par l'OCR) seront couvertes avec les tableaux des Livraisons 3-4.
- Relevés, paie, bilans, amortissements : **non implémentés** (Livraisons 3→5), l'onglet les annoncera comme types sans extraction dédiée tant qu'ils ne sont pas livrés.
- Aucun test sur Android physique.

---

## Livraison 3 — Relevés bancaires (24/10/2026)

Branche `feature/comptabilite-livraison3`, version **2.9.0**.

### Réalisé et testé (`tests/e2e-compta-l3.mjs` : **23/23**, navigateur émulé)
- **Extraction `Acc.extractBank`** (déclenchée si le type « Relevé bancaire » est choisi ou détecté) : banque, titulaire, **IBAN préservé comme texte** (zéros et format conservés à l'export), BIC, devise, soldes d'ouverture/clôture.
- **Transactions ligne par ligne, ordre préservé** : date, date de valeur si présente, libellé, référence, **débit et crédit dans des champs distincts**, solde après opération lorsqu'il est imprimé. Sens déterminé par signe ou mots-clés (CB/PRLV/paiement… en débit ; salaire/remise/remboursement… en crédit) ; **sens indéterminé = « à vérifier », jamais deviné**, exclu des totaux avec avertissement.
- **Contrôles** : ouverture + crédits − débits vs clôture, dernier solde de ligne vs clôture, **doublons potentiels** (même date/libellé/montant) signalés et jamais supprimés automatiquement.
- **UI Comptabilité** : tableau d'opérations éditable (date, libellé, débit, crédit, solde), badges « doublon ? » et « à vérifier », totaux reconnus, corrections **persistées** (vérifié).
- **Exports** : CSV une ligne par opération (débit/crédit séparés), XLSX montants numériques, JSON structuré (compte + opérations).
- Avertissement explicite : contrôles de cohérence uniquement, **pas un rapprochement bancaire complet**.
- Non-régressions : Compta L2 30/30, V2.7 10/10, audit 16/16, V2 16/16.

### Limites honnêtes
- Sur un OCR de relevé réel, les colonnes débit/crédit imprimées peuvent être fusionnées par l'OCR texte : le sens repose alors sur le signe et les mots-clés, d'où le statut « à vérifier » plutôt qu'une affectation inventée.
- Formats de dates sans année conservés tels quels (jj/mm).
- Aucun test sur Android physique ; aucun rapprochement avec des écritures comptables (non implémenté, non annoncé).
