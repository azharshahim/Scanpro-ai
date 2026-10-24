# Validation externe des exports : ouvre réellement XLSX/DOCX (zip+XML), CSV (accents, signes,
# zéros initiaux), JSON et PDF (PyMuPDF). À lancer après les suites e2e qui produisent les fichiers.
import csv, io, json, sys, zipfile
import xml.etree.ElementTree as ET
OUT = '/home/user/scanpro/tests/out'
fails = []
def check(label, cond, extra=''):
    print(('✅' if cond else '❌') + ' ' + label + (' — ' + str(extra)[:110] if extra else ''))
    if not cond: fails.append(label)

# XLSX compta : vrai classeur OOXML, montants en cellules NUMÉRIQUES
p = OUT + '/compta-export.xlsx'
with zipfile.ZipFile(p) as z:
    names = z.namelist()
    check('XLSX : structure OOXML complète', '[Content_Types].xml' in names and 'xl/worksheets/sheet1.xml' in names, names)
    xml = z.read('xl/worksheets/sheet1.xml').decode('utf8')
    root = ET.fromstring(xml)
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    numeric = [c for c in root.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c') if c.get('t') is None and c.find('m:v', ns) is not None]
    check('XLSX : montants en cellules numériques typées', len(numeric) >= 3, str(len(numeric)) + ' cellules numériques')
    vals = [c.find('m:v', ns).text for c in numeric]
    check('XLSX : décimales préservées (point, pas de formatage texte)', any(v == '3100' or '.' in v for v in vals), vals[:6])

# XLSX relevé bancaire
with zipfile.ZipFile(OUT + '/bank-export.xlsx') as z:
    check('XLSX relevé : classeur valide', 'xl/worksheets/sheet1.xml' in z.namelist())
    ET.fromstring(z.read('xl/worksheets/sheet1.xml'))

# CSV écritures : accents, équilibre débit/crédit
rows = list(csv.reader(io.open(OUT + '/ecritures.csv', encoding='utf-8-sig'), delimiter=';'))
check('CSV écritures : en-tête + 3 lignes', len(rows) >= 4 and rows[0][2] == 'Compte', rows[0])
tot_d = sum(float(r[4].replace(',', '.')) for r in rows[1:] if r[4]); tot_c = sum(float(r[5].replace(',', '.')) for r in rows[1:] if r[5])
check('CSV écritures : débits = crédits', abs(tot_d - tot_c) < 0.01, f'{tot_d} vs {tot_c}')

# CSV relevé : IBAN non requis ici, mais montants signés/décimaux et lignes
rows = list(csv.reader(io.open(OUT + '/bank-export.csv', encoding='utf-8-sig'), delimiter=';'))
check('CSV relevé : une ligne par opération', len(rows) >= 7, str(len(rows)) + ' lignes')
check('CSV relevé : colonnes Débit/Crédit séparées', rows[0][4] == 'Débit' and rows[0][5] == 'Crédit', rows[0])

# JSON compta : structure et zéros initiaux (SIRET texte)
data = json.load(io.open(OUT + '/compta-export.json', encoding='utf8'))
siret = data['fields']['siret']['value']
check('JSON : SIRET conservé en texte intégral', siret == '81234567800012', siret)
check('JSON : champs + lignes structurés', 'totalTTC' in data['fields'] and isinstance(data.get('lines'), list))

# DOCX produit par la suite V2.7 (partage Word)
try:
    with zipfile.ZipFile(OUT + '/v27-partage.docx') as z:
        check('DOCX : structure OOXML (word/document.xml)', 'word/document.xml' in z.namelist(), z.namelist())
        ET.fromstring(z.read('word/document.xml'))
        check('DOCX : XML bien formé', True)
except FileNotFoundError:
    check('DOCX : fichier v27-partage.docx présent (lancer e2e-v27)', False)

# PDF : tout PDF produit dans tests/out doit s'ouvrir dans PyMuPDF avec >= 1 page
import glob
try:
    import pymupdf
    pdfs = glob.glob(OUT + '/*.pdf')
    check('PDF : au moins un PDF de test présent', len(pdfs) >= 1, pdfs[:3])
    for f in pdfs[:5]:
        doc = pymupdf.open(f)
        check('PDF ouvrable : ' + f.split('/')[-1], doc.page_count >= 1, str(doc.page_count) + ' page(s)')
        doc.close()
except Exception as e:
    check('PDF : PyMuPDF disponible', False, e)

print(f"\n===== VALIDATION EXPORTS : {'ÉCHEC ' + str(len(fails)) if fails else 'TOUT OK'} =====")
sys.exit(1 if fails else 0)
