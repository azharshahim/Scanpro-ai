# Diagnostic R11 — perte de la page d'origine (chemin texte sans géométrie)

*Branche `fix/r11-page-origin`, dérivée de `main` @ `4ed6733` (V2.23). Aucune modification de code avant la fin de ce diagnostic.*

## Chaîne d'extraction réelle (prouvée par lecture du code)

1. `PDF.extractText(file)` (`src/core.js:628`) lit le PDF page par page avec pdf.js et **préserve la pagination** : `pages = [{ text, words }, …]`, tableau indexé par page.
2. `docRunOcr` (`src/ui.js:1357` natif, `:1378` OCR, `:1094` éditeur) concatène en une seule chaîne :
   ``doc.text = results.map((r, i) => `— Page ${i + 1} —\n${r.text}`).join('\n\n')``.
   Les marqueurs `— Page N —` existent donc dans le texte, et les boîtes de mots restent indexées par page dans `doc.ocrWordBoxes`.
3. `accAnalyze` appelle `Acc.extractBank(doc.text, pagesWords)`.
   - **Chemin positions** (`bankFromPositions` → `positionRows`, `src/ui.js:2076`) : `(pagesWords).forEach((words, page) => …)` — le numéro est l'index du tableau, donc exact. Aucun défaut (tests R11a `[0,1,1]`, M2 `[0,1,1]`).
   - **Chemin texte** (`src/ui.js`, boucle `rawOps` puis `txo`) : il découpe `text.split('\n')` sans tenir compte des marqueurs `— Page N —`, et crée chaque opération avec **`page: 0` codé en dur** (`src/ui.js:2394`).
4. Le seul rattrapage possible est `Acc.findZone(pagesWords, label)` qui recherche une boîte de mots approchante. Quand la géométrie est absente (`pagesWords = []` ou `[[], []]`), il retourne `null` : toutes les opérations gardent `page: 0`, y compris celles des pages 2 et 3.

## Cause racine exacte

`Acc.extractBank` ignore les marqueurs de pagination déjà présents dans le texte assemblé et applique un `page: 0` constant dans le chemin texte. L'information de page n'est pas perdue à la source (elle est dans `doc.text` et dans l'index de `ocrWordBoxes`) : elle est **jetée au moment du parsing des lignes**.

## Correctif minimal retenu (chemin texte uniquement)

- Suivre la page courante pendant l'itération des lignes dès qu'un marqueur `— Page N —` est rencontré (regex tolérante `—/–/-`, insensible à la casse), en base **0** (convention actuelle du projet).
- Détacher l'opération en cours au changement de page : un marqueur ne doit jamais être rattaché comme libellé de continuation.
- À la construction de chaque opération, résoudre la page dans cet ordre :
  1. marqueur textuel (origine certaine, structurelle) ;
  2. une seule page physique connue (`pagesWords.length === 1`) → `0` (certitude structurelle) ;
  3. `findZone` sur la géométrie si elle existe (comportement historique conservé) ;
  4. sinon **`null`** : origine explicitement inconnue, jamais une fausse page 0.
- Le chemin positions, la fusion texte/positions, les montants, dates, libellés, références, soldes, sens, statuts et la classification ne sont pas modifiés.

## Comportement documenté pour l'origine inconnue (Cas D)

`page: null` (et non `0`) signale honnêtement que l'origine ne peut être démontrée : texte sans marqueur de page et sans géométrie exploitable. Aucun écran n'affiche cette valeur comme une page certaine (les transactions n'exposent pas `.page` dans les vues ; seules les zones de champs utilisent `zone.page` qui provient d'une boîte réelle).
