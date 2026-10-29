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

# -----------------------------------------------------------------------------
# Estoque sob concorrência: 8 conexões tentam tirar 10 unidades cada (80) de um
# produto com saldo 50. Exatamente 50 devem sair, o saldo final deve ser 0 e a
# soma das movimentações deve bater com o saldo (nunca negativo).
# -----------------------------------------------------------------------------
PRODUCT="00000000-0000-0000-0000-0000000c0c02"
psql "$DATABASE_URL" -q -X -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into public.companies (id, name) values ('$COMPANY', 'Teste concorrência') on conflict (id) do nothing;
insert into public.products (id, company_id, sku, name) values ('$PRODUCT', '$COMPANY', 'CONC-1', 'Peça concorrência');
select private.move_stock('$COMPANY', '$PRODUCT', 'adjustment_in', 50, 100, 'saldo inicial');
SQL

echo "==> concorrência de estoque: 8 conexões x 10 saídas de 1 unidade (saldo 50)"
for w in $(seq 1 "$WORKERS"); do
  (
    for _ in $(seq 1 10); do
      psql "$DATABASE_URL" -q -X -t -A -c "select private.move_stock('$COMPANY', '$PRODUCT', 'adjustment_out', 1, null, 'teste')" >/dev/null 2>&1 \
        && echo ok || echo fail
    done > "$TMP/s$w.txt"
  ) &
done
wait

okc=$(cat "$TMP"/s*.txt | grep -c '^ok$' || true)
read -r bal sum < <(psql "$DATABASE_URL" -q -X -t -A -F ' ' -c \
  "select p.qty_on_hand, coalesce(sum(m.qty * m.direction), 0) from public.products p left join public.stock_movements m on m.product_id = p.id where p.id = '$PRODUCT' group by p.qty_on_hand")

psql "$DATABASE_URL" -q -X >/dev/null 2>&1 <<SQL || true
alter table public.stock_movements disable trigger stock_movements_immutable;
delete from public.stock_movements where company_id = '$COMPANY';
alter table public.stock_movements enable trigger stock_movements_immutable;
alter table public.audit_log disable trigger audit_log_no_update;
delete from public.audit_log where company_id = '$COMPANY';
alter table public.audit_log enable trigger audit_log_no_update;
delete from public.products where company_id = '$COMPANY';
delete from public.companies where id = '$COMPANY';
SQL

if [[ $okc -eq 50 && $bal -eq 0 && $sum -eq 0 ]]; then
  echo "  ok - exatamente 50 saídas aceitas, 30 recusadas, saldo 0 e movimentações conferem"
else
  echo "  not ok - saídas aceitas=$okc (esperado 50), saldo=$bal (esperado 0), soma movimentações=$sum (esperado 0)"
  exit 1
fi
