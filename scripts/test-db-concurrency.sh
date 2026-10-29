#!/usr/bin/env bash
# Teste de concorrência da numeração sequencial: várias conexões simultâneas
# pedem números para a mesma empresa; nenhum número pode repetir ou faltar.
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL}"

WORKERS=8
PER_WORKER=50
TOTAL=$((WORKERS * PER_WORKER))
COMPANY="00000000-0000-0000-0000-0000000c0c01"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; psql "$DATABASE_URL" -q -X -c "delete from public.company_counters where company_id = '\''$COMPANY'\''" -c "alter table public.audit_log disable trigger audit_log_no_update" -c "delete from public.audit_log where company_id = '\''$COMPANY'\''" -c "alter table public.audit_log enable trigger audit_log_no_update" -c "delete from public.companies where id = '\''$COMPANY'\''" >/dev/null 2>&1 || true' EXIT

echo "==> concorrência: $WORKERS conexões x $PER_WORKER números"
psql "$DATABASE_URL" -q -X -v ON_ERROR_STOP=1 \
  -c "insert into public.companies (id, name) values ('$COMPANY', 'Teste concorrência')" >/dev/null

for w in $(seq 1 "$WORKERS"); do
  (
    for _ in $(seq 1 "$PER_WORKER"); do
      echo "select private.next_number('$COMPANY', 'service_order');"
    done | psql "$DATABASE_URL" -q -X -t -A -v ON_ERROR_STOP=1 > "$TMP/w$w.txt"
  ) &
done
wait

sort -n "$TMP"/w*.txt > "$TMP/all.txt"
count=$(wc -l < "$TMP/all.txt")
unique=$(sort -u "$TMP/all.txt" | wc -l)
first=$(head -1 "$TMP/all.txt")
last=$(tail -1 "$TMP/all.txt")

if [[ $count -eq $TOTAL && $unique -eq $TOTAL && $first -eq 1 && $last -eq $TOTAL ]]; then
  echo "  ok - $TOTAL números únicos e consecutivos (1..$TOTAL) sob concorrência"
else
  echo "  not ok - obtidos=$count únicos=$unique primeiro=$first último=$last (esperado $TOTAL, 1..$TOTAL)"
  exit 1
fi
