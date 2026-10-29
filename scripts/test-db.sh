#!/usr/bin/env bash
# Roda os testes de banco (RLS, permissões, convites, auditoria, contadores).
#
# Uso:
#   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres scripts/test-db.sh
#       -> Supabase local (rode antes: npx supabase db reset)
#
#   DATABASE_URL=postgres://postgres@localhost:5432/phael_test scripts/test-db.sh --vanilla
#       -> PostgreSQL puro: aplica o stub do Supabase + todas as migrações em um
#          banco VAZIO e descartável (usado no CI).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${DATABASE_URL:?Defina DATABASE_URL}"

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X)

if [[ "${1:-}" == "--vanilla" ]]; then
  echo "==> Aplicando stub do Supabase"
  "${PSQL[@]}" -f "$ROOT/supabase/tests/stub/supabase_auth_stub.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "==> Migração $(basename "$f")"
    "${PSQL[@]}" -1 -f "$f"
  done
fi

echo "==> Preparando utilitários de teste"
"${PSQL[@]}" -f "$ROOT/supabase/tests/sql/00_helpers.sql"

failed=0
passed=0
for f in "$ROOT"/supabase/tests/sql/[0-9][0-9]_*.sql; do
  name="$(basename "$f")"
  [[ "$name" == "00_helpers.sql" ]] && continue
  echo "==> $name"
  if out="$("${PSQL[@]}" -f "$f" 2>&1)"; then
    echo "$out" | grep -E '^(psql:.*)?NOTICE:  ok - ' | sed -E 's/^.*NOTICE:  /  /'
    passed=$((passed + $(echo "$out" | grep -c 'NOTICE:  ok - ' || true)))
  else
    echo "$out" | grep -E 'ok - |ERROR' | sed -E 's/^.*(NOTICE|ERROR):  /  /'
    failed=$((failed + 1))
  fi
done

"$ROOT/scripts/test-db-concurrency.sh" || failed=$((failed + 1))

"${PSQL[@]}" -c 'drop schema if exists tests cascade' >/dev/null

echo
echo "Asserções aprovadas: $passed"
if [[ $failed -gt 0 ]]; then
  echo "FALHA: $failed arquivo(s) de teste falharam"
  exit 1
fi
echo "OK: todos os testes de banco passaram"
