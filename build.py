#!/usr/bin/env python3
"""Assemble ScanPro AI en un index.html autonome (CSS/JS inlinés, libs vendor locales)."""
import pathlib, re, datetime

R = pathlib.Path(__file__).parent
css = (R/'src/style.css').read_text(encoding='utf-8')
core = (R/'src/core.js').read_text(encoding='utf-8')
vision = (R/'src/vision.js').read_text(encoding='utf-8')
app = (R/'src/app.js').read_text(encoding='utf-8')
views = (R/'src/views.js').read_text(encoding='utf-8')
ui = (R/'src/ui.js').read_text(encoding='utf-8')
sw = (R/'src/sw.js').read_text(encoding='utf-8')
shell = (R/'src/shell.html').read_text(encoding='utf-8')

html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=5">
<meta name="theme-color" content="#0B1B34">
<meta name="description" content="ScanPro AI — scanner de documents Android : caméra, OCR français/anglais, PDF, 100 % local.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>ScanPro AI — Scanner &amp; OCR</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/icon.svg">
<style>
{css}
</style>
</head>
<body>
{shell}
<script src="vendor/tesseract.min.js"></script>
<script src="vendor/jspdf.umd.min.js"></script>
<script src="vendor/pdf-lib.min.js"></script>
<script src="vendor/pdf.min.js"></script>
<script src="vendor/jszip.min.js"></script>
<script>
{core}
</script>
<script>
{vision}
</script>
<script>
{app}
</script>
<script>
{views}
</script>
<script>
{ui}
</script>
<script>
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {{
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {{}}));
}}
</script>
</body>
</html>
"""
(R/'index.html').write_text(html, encoding='utf-8')
(R/'sw.js').write_text(sw, encoding='utf-8')
print('index.html', len(html), 'octets —', datetime.datetime.now().strftime('%H:%M:%S'))
