# Audit de bout en bout — relevés bancaires et intégration comptable (V2.16, 24/10/2026)

Branche : `feature/releve-bancaire-complet` (depuis `main` = V2.15.1). Aucune fusion sans validation.
**Confidentialité : le relevé de référence fourni par l'utilisateur n'est ni dans le dépôt, ni dans ce
rapport (aucun nom, IBAN complet ou donnée personnelle) ; seuls des agrégats et des libellés génériques
d'organismes (EDF, SFR, URSSAF…) sont cités.**

## 1. Test sur le véritable relevé PDF (référence indépendante)

Document : relevé bancaire réel, **3 pages, texte natif** (banque française, compte professionnel).
Vérité de référence établie par un parseur indépendant (PyMuPDF, positions) et recoupée avec les
**totaux imprimés dans le document lui-même** :

| Mesure | Attendu (référence) | Extrait par ScanPro AI | Écart |
|---|---|---|---|
| Pages | 3 | 3 (texte natif, sans OCR) | 0 |
| Opérations | **85** | **85** | 0 |
| Total débits | 54 797,19 (imprimé) | 54 797,19 | 0,00 |
| Total crédits | 52 441,32 (imprimé) | 52 441,32 | 0,00 |
| Solde initial (« Ancien solde ») | 19 364,55 | 19 364,55 | 0 |
| Solde final (« Nouveau solde ») | 17 008,68 | 17 008,68 | 0 |
| Comparaison opération par opération (date + débit + crédit) | 85 clés | 85/85 identiques | 0 |
| Libellés divergents | — | **0 / 85** | — |
| Cohérence arithmétique | 19 364,55 + 52 441,32 − 54 797,19 = 17 008,68 | contrôle « Totaux imprimés » = **Conforme** | — |

Corrections nécessaires découvertes par ce test réel (toutes testées) : milliers séparés dans le PDF
(« 1 » + « 477,95 » refusionnés dans `positionRows`), glyphes marqueurs (¨/þ) exclus des libellés,
« Ancien solde » reconnu, montant de solde cherché hors des dates et sur la ligne suivante,
lignes « Total des opérations » jamais rattachées à la dernière opération, références embarquées
(n° de chèque, références SEPA) extraites, champs banque/titulaire/n° de compte/période ajoutés.
Le relevé ne fournit pas de solde ligne par ligne : le contrôle d'enchaînement ne s'applique donc pas
(il reste « sans objet » plutôt que déclaré conforme sans comparaison — aucun faux positif).

**Écarts restants sur ce document** : dates de valeur présentes et récupérées ; 4 opérations sur 85
sans référence embarquée identifiable (signalées « Non reconnu », jamais inventées) ; le sens est
déterminé par les colonnes Débit/Crédit du document (positions), pas par mots-clés.

## 2. Propositions de comptes comptables (nouveau)

`Acc.bankProposals()` relie le relevé au plan configurable (V2.15) : journal **BQ** du dossier,
compte banque **512000** des règles (jamais confondu avec l'IBAN/n° de compte bancaire, testé),
contrepartie par règles configurables (`Precompta.bankRules()`, localStorage) puis **règles apprises**
des corrections validées (`learnFromLabel`, clé de stockage distincte — une collision de clés
détectée par les tests a été corrigée). Comptes ajoutés au plan par défaut : 606100, 616000, 627000,
641000, 645000, 421000, 580000, 218000. Chaque proposition donne : compte + intitulé du plan,
confiance, explication, alternatives éventuelles, et signale compte absent/inactif. **Inconnu =
en attente**, aucune affectation inventée.

Exemples (relevé réel + cas synthétiques, tous exécutés) :
- « PRLV SEPA EDF… » (sortie) → **606100** Fournitures non stockables, confiance 85 — écriture : 606100 débit / 512000 crédit.
- « PRLV SFR… » → **626000** télécommunications (85). « PRLV URSSAF… » → **645000** charges sociales (80, alternative 431000 signalée comme non présente au plan par défaut si absente).
- « Cotis… Offre Compte… Pro » → **627000** frais bancaires (75). Assurance → **616000**.
- Virements à des personnes sans motif reconnu → **en attente** (aucune invention) ; sur le relevé réel, 10/85 opérations obtiennent une contrepartie automatique, les autres restent à affecter — comportement voulu et affiché.

## 3. Export comptable

`Acc.bankEntriesCsv()` : CSV **générique documenté** — colonnes
`Date;Journal;Pièce;Compte;Libellé;Référence;Débit;Crédit;Statut validation`, une ligne par mouvement
(2 par opération : contrepartie + banque 512), statut toujours « proposée (non validée) ».
**Logiciel cible : tout logiciel acceptant un import CSV paramétrable** (mapping de colonnes à
définir dans le logiciel : journal BQ, comptes, débit/crédit séparés) — aucune compatibilité
universelle n'est prétendue ; un format natif (Sage, EBP…) exigerait sa spécification d'import.
Avant export, l'écran de confirmation liste : doublons, opérations sans contrepartie, comptes
absents/inactifs, sens/montants inconnus, et l'équilibre débit = crédit calculé. L'export CSV des
opérations bancaires originales (`toBankCsv`) est inchangé.

Exemple d'export (données fictives) :
```
"02/10";"BQ";"";"606100";"PRLV SEPA EDF ENERGIE";"";"";"120";"proposée (non validée)"
"02/10";"BQ";"";"512000";"PRLV SEPA EDF ENERGIE";"";"120";"";"proposée (non validée)"
```

## 4. Tests réellement exécutés

| Suite | Résultat |
|---|---|
| `e2e-v217-releve-reel.mjs` (véritable PDF, 85 ops, totaux imprimés) | **12/12** (ignoré proprement si le PDF est absent) |
| `e2e-v218-synth.mjs` (PDF natifs/mixtes/scannés OCR réel, propositions, apprentissage, export, cas négatifs) | **16/16** |
| Non-régressions | L2 30/30 · L3 23/23 · L4 19/19 · L5 18/18 · L6 14/14 · V2.13 17/17 · V2.14 15/15 · V2.14.1 8/8 · V2.15 20/20 · V2.15.1 banque 18/18 · fiabilité 13/13 · exports TOUT OK |

Un incident de développement (remplacement global ayant injecté un bloc « soldes » dans d'autres
extracteurs) a été détecté par ces suites, corrigé et revérifié — d'où l'importance de les exécuter
toutes. Limites restantes : PDF scannés dépendants de la qualité OCR (testé sur image nette
synthétique, pas sur un relevé scanné réel) ; sens par mots-clés en repli texte seul (les colonnes
par positions priment) ; aucun test Android physique.
