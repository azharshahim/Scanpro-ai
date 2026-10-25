#!/usr/bin/env bash
# Noyau de tests automatisés (CI GitHub Actions et exécution locale).
# Suites 100 % fictives, portables (chemins relatifs), sans OCR Tesseract réel.
# Les suites OCR (e2e-v25, e2e-v218) et les scripts V2.0 obsolètes restent hors CI.
set -uo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-8080}"
BASE="http://127.0.0.1:${PORT}/index.html"

python3 -m http.server "${PORT}" --bind 0.0.0.0 >/tmp/scanpro-http.log 2>&1 &
SRV=$!
cleanup() { kill "${SRV}" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 30); do
  if curl -sf "${BASE}" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "${BASE}" >/dev/null || { echo "Le serveur de test n'a pas démarré sur ${BASE}"; exit 1; }

SUITES=(
  e2e-v222-releves-fiabilite
  e2e-v222-soldes-bnp
  e2e-v222-dispositions
  e2e-v222-lots
  audit-v221-lots-independant
  e2e-v219-apprentissage
  e2e-v220-nature
  e2e-v221-ux
  e2e-audit-extra
  e2e-v24
  e2e-v26
  e2e-v27
)

FAIL=0
for t in "${SUITES[@]}"; do
  echo "==================== ${t} ===================="
  if ! APP_URL="${BASE}" node "tests/${t}.mjs"; then
    echo "ÉCHEC de la suite ${t}"
    FAIL=1
  fi
done

if [ "${FAIL}" -ne 0 ]; then
  echo "===== NOYAU CI : AU MOINS UNE SUITE EN ÉCHEC ====="
  exit 1
fi
echo "===== NOYAU CI : ${#SUITES[@]} SUITES OK, 0 ÉCHEC ====="
