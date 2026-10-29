# Financeiro: regras e fórmulas

Todos os valores são guardados e calculados em **centavos inteiros** (`bigint`), nunca em ponto flutuante.

## Conceitos (não confundir)

| Indicador | Fórmula | Função |
|---|---|---|
| **Faturamento** | soma dos títulos **a receber** emitidos no período (`issue_date`), exceto cancelados | `finance_summary.billed_cents` |
| **Despesas** | soma dos títulos **a pagar** emitidos no período, exceto cancelados | `finance_summary.expenses_cents` |
| **Resultado estimado** | faturamento − despesas (competência) | `estimated_result_cents` |
| **Recebimentos** | soma dos pagamentos de títulos a receber com `paid_at` no período; estornos entram negativos **na data do estorno** | `received_cents` |
| **Pagamentos** | idem para títulos a pagar | `paid_cents` |
| **Resultado de caixa** | recebimentos − pagamentos | `cash_result_cents` |
| **A receber / a pagar em aberto** | Σ (valor − pago) dos títulos não cancelados, hoje | `receivable_open_cents`, `payable_open_cents` |
| **Vencido** | o mesmo, só com `due_date` anterior a hoje | `*_overdue_cents` |
| **Saldo financeiro** | Σ saldos iniciais das contas + Σ entradas − Σ saídas (todos os pagamentos) | `balance_cents` |
| **Fluxo de caixa** | entradas e saídas por dia/mês, saldo acumulado a partir do saldo anterior ao período | `cash_flow` |
| **Margem por OS** | Σ (qtd × preço − desconto) − Σ (qtd × custo real) dos itens ativos de OS entregues no período | `order_margins` |
| **Resultado por categoria** | o mesmo, agrupado pela categoria do serviço no catálogo (avulsos em "outros") | `service_category_results` |

## Regras

- **Parcelas** somam exatamente o total; a diferença de centavos fica na 1ª parcela
  (R$ 100 em 3× = 33,34 + 33,33 + 33,33). Vencimentos mensais respeitam o fim do mês (31/01 → 28/02 → 31/03).
- **Pagamento parcial**: o título fica "parcial" até completar o valor. Não se recebe mais que o saldo em aberto.
- **Estorno** é um pagamento negativo que referencia o original (lançamento inverso). Cada pagamento só pode ser
  estornado uma vez; nada é apagado. Pagamentos são imutáveis no banco (nem o dono altera).
- **Cancelamento** exige motivo e só é permitido sem pagamentos líquidos (estorne antes).
- **Valor** de um título só muda enquanto não houver pagamento.
- **Conciliação**: o extrato (CSV) é importado com impressão digital por linha, então reimportar o mesmo arquivo não
  duplica. Uma linha só concilia com um pagamento da mesma conta e do mesmo valor (sinal pelo tipo).

## Fora do escopo (preparado para depois)
- Emissão fiscal (NFS-e) e integração bancária automática: dependem de provedores reais e serão interfaces separadas.
  Nada é simulado.
