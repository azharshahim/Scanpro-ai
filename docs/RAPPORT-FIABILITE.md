# Rapport de fiabilité — ScanPro AI (audit « V2.8 » demandé, base réelle 2.12.0)

- Date : 24 octobre 2026 · Branche : `fix/fiabilite-comptable` (depuis `main` 2.12.0, `1915e64`)
- Version publiée auditée : **2.12.0** (le dépôt ne contient aucune « V2.8 comptable » distincte : les livraisons comptables sont les versions 2.8.0→2.12.0, toutes fusionnées dans `main` et taguées).
- Méthode : code réel `src/`, `index.html` régénéré par `build.py`, application publiée, suites Playwright (navigateur émulé), validation externe des fichiers (Python : zip/XML, csv, PyMuPDF). **Aucun test sur Android physique.**

## A. Stockage et pertes de données

| # | Défaut trouvé | Gravité | Correction | Retest |
|---|---|---|---|---|
| A1 | Repli mémoire IndexedDB **silencieux** (simple `console.warn`) : l'utilisateur croyait ses documents sauvegardés, ils disparaissaient à la fermeture | **Critique** | `Store._notifyStorage()` (src/core.js) : bandeau persistant « Stockage durable indisponible… perdus à la fermeture », fonctions indisponibles nommées, bouton **« Exporter une sauvegarde de secours »** ; affiché dès l'init si `Store.isFallback` | e2e-fiabilite : bandeau + bouton présents, doc en session puis absent après rechargement **avec** avertissement ✅ |
| A2 | Échec d'écriture (quota) : `Store.put` rejetait la promesse, risque de faux succès affiché par l'UI | **Élevée** | `put` capture l'erreur (ouverture de transaction incluse), renseigne `Store._writeError` (« Quota de stockage dépassé »), affiche le bandeau, **retourne `false`** au lieu de laisser croire à un enregistrement | Écriture simulée en échec : retour `false`, erreur nommée, bandeau visible ✅ |
| A3 | Persistance normale à revalider bout en bout | — | Aucun changement nécessaire | Création → rechargement → document présent, aucun bandeau, 0 erreur console ✅ |

## B. Fonctionnalités annoncées vs réelles (version principale uniquement)

| Fonction | Source | Entrée UI | Test reproductible | État |
|---|---|---|---|---|
| Extraction factures structurée | `src/ui.js` `Acc.extractInvoice` | Onglet Compta → Analyser | `tests/e2e-compta-l2.mjs` 30/30 | ✅ main |
| Relevés, paie, bilans/CR, prêts, immobilisations, frais | `src/ui.js` `Acc.extract*` | Compta (type auto/choisi) | L3 23/23, L4 19/19, L5 18/18, L6 13/13 | ✅ main |
| Exports CSV/JSON/DOCX/XLSX | `Acc.toCsv/toBankCsv`, `accXlsxBlob`, `makeDocxBlob` | Compta → Exports ; document → Partager | `tests/validate-exports.py` TOUT OK | ✅ main, **validés par ouverture** (§D) |
| Nettoyage magique dans le PDF exporté | `Vision.magicClean` + `ImageOps.render` (pipeline d'export) | Studio Nettoyage → PDF | e2e-fiabilite : luminance du rendu d'export 229→247 avec nettoyage+filigrane ; suite V2.2 PDF enrichi ouvrable | ✅ main |
| Fusion / extraction de pages PDF | `src/ui.js` outils PDF, pdf-lib | Outils / document | e2e2 (fusion), pdf-tools-v22 (extraction) | ✅ main |
| Partage Android | `shareFile()` (Web Share API + repli téléchargement) | Document → Partager | Suites navigateur (repli téléchargement) ; **feuille native Android non testée physiquement** | ⚠️ partiel (émulé) |
| OCR des PDF importés | `PDF.renderPages` + `OCR.run` (positions conservées) | Document PDF → OCR | e2e-v2 16/16 | ✅ main |
| Hors connexion | `src/sw.js` + `src/core.js` Store | PWA installée | e2e-fiabilite + e2e-audit-extra 8/8 | ✅ corrigé (§C) |
| Caméra, contours, 4 coins, filtres | `src/vision.js`, `src/ui.js` | Scan / éditeur | audit-v27 16/16, V2 16/16 | ✅ main |

Incohérence corrigée : le **README annonçait encore « V2.7 »** et des modèles OCR `fra/eng` seuls. Il est aligné sur la 2.12.0 (Comptabilité, 6 langues, confidentialité précise). Aucune fonction de branche secondaire n'est présentée comme livrée : toutes les branches `feature/comptabilite-*` et `fix/*` ont été fusionnées dans `main` avant annonce.

## C. Service worker

| # | Défaut | Gravité | Correction | Retest |
|---|---|---|---|---|
| C1 | `activate` supprimait **tous** les caches ≠ CACHE, y compris ceux d'autres applications hébergées sur la même origine GitHub Pages | **Élevée** | Suppression limitée aux clés `scanpro-ai-*` (hors cache courant et `scanpro-ai-meta`) | Test code déployé + hors-ligne OK ✅ |
| C2 | `cache.addAll().catch(()=>{})` : échec de mise en cache **ignoré silencieusement**, hors-ligne incomplet sans que personne le sache | **Élevée** | Cache ressource par ressource, échecs collectés, état JSON écrit dans `scanpro-ai-meta` (`__offline_status`), `postMessage` aux clients ; l'app vérifie la complétude à l'init et affiche un message clair si des ressources manquent | État lu en test : `complete: true, failed: []` en local ; rechargement hors-ligne OK ✅ |
| C3 | Mise à jour post-déploiement non signalée | Moyenne | À l'init : `registration.update()` + écoute `updatefound` → toast « Nouvelle version disponible : rechargez » (le HTML reste « réseau d'abord », donc l'update est immédiat dès rechargement) | Inclus au code ; comportement réseau-d'abord déjà prouvé par les publications 2.7.1→2.12.0 ✅ |
| C4 | Nom de cache figé par version | — | Déjà versionné (`scanpro-ai-v2.12.0`), conservé | ✅ |

## D. Validation des exports (`tests/validate-exports.py` — tout OK)

- **XLSX** : fichiers ouverts comme archives OOXML, XML analysé : structure complète, **montants en cellules numériques typées** (40 cellules), décimales au point préservées. Le XLSX est donc un **véritable classeur**, pas un CSV renommé.
- **DOCX** : archive OOXML avec `word/document.xml` bien formé.
- **CSV** : écritures équilibrées débits = crédits (1 200 = 1 200), accents UTF-8, relevé une ligne par opération avec colonnes Débit/Crédit distinctes.
- **JSON** : SIRET conservé **en texte intégral** `81234567800012` (aucun zéro initial perdu), champs et lignes structurés.
- **PDF** : `v22-enrichi.pdf` ouvert par PyMuPDF — 2 pages valides.
- Noms de fichiers : `slugify` (accents retirés des noms, contenu intact), dates et signes négatifs vérifiés dans les suites comptables (avoir −300 € conservé).

## E. Confidentialité

- Pendant toutes les suites instrumentées : **aucune requête externe**, aucun envoi de document/image/PDF/texte OCR. Traitement 100 % local (Tesseract, jsPDF, pdf-lib dans `vendor/`).
- **Repli CDN documenté honnêtement** (README + écran Paramètres corrigés) : si l'hébergeur bloque les gros fichiers locaux, les **bibliothèques et modèles OCR publics** sont téléchargés depuis jsDelivr (tag figé `v1.0.0`). Aucune donnée utilisateur n'est transmise, mais l'app n'est « entièrement autonome » qu'après chargement et mise en cache de ces fichiers ; hors-ligne complet vérifié ensuite.
- Aucun secret dans le code client (`git grep` vérifié à chaque publication) ; jetons GitHub jamais versionnés.

## F. Suite de tests comptables (précision champ par champ)

Exemples **anonymisés et fictifs** déjà en place, exécutés à cette livraison : factures simple/multi-TVA/avoir/partielle (L2), relevé avec doublon et sens inconnu (L3), bulletin de paie aux trois nets distincts + bilan + compte de résultat (L4), échéancier de prêt volontairement faux + immobilisations (L5), note de frais + écritures (L6). La précision est mesurée **valeur par valeur** (montants HT/TVA par taux/TTC, dates, SIRET, débits/crédits, soldes, colonnes N/N-1), pas par la seule réponse des boutons. Résultats : L2 30/30 · L3 23/23 · L4 19/19 · L5 18/18 · L6 13/13 · fiabilité 13/13 · exports TOUT OK · non-régressions V2 16/16, audit 16/16.

## G. Livraison

1. **Défauts** : A1, A2, C1, C2, C3 + README obsolète (ci-dessus).
2. **Corrections** : `src/core.js` (Store averti + erreurs d'écriture), `src/sw.js` (caches propres + état hors-ligne), `src/ui.js` (init : état stockage/SW), `src/views.js` + `README.md` (confidentialité précise), `tests/e2e-fiabilite.mjs`, `tests/validate-exports.py`, ce rapport.
3. **Tests réels** : fiabilité 13/13 ; validation exports TOUT OK ; compta 30+23+19+18+13 ; V2/audit 16+16. Tous en **navigateur émulé Pixel 7**.
4. **Problèmes ouverts** : partage natif Android et caméra réelle jamais testés physiquement ; écritures comptables = propositions à valider ; OCR de tableaux très dégradés perfectible ; pas de FEC.
5. **Reproduction** :
   ```bash
   cd scanpro && python3 build.py && python3 -m http.server 8080
   NODE_PATH=/home/user/node_modules node tests/e2e-fiabilite.mjs
   NODE_PATH=/home/user/node_modules node tests/e2e-compta-l2.mjs   # …l3, l4, l5, l6
   python3 tests/validate-exports.py   # après les suites qui produisent tests/out/*
   ```
6. **Non implémenté** (jamais annoncé comme tel) : rapprochement bancaire complet, FEC, validation comptable officielle, assistant IA distant, APK natif, chiffrement des sauvegardes ZIP.
