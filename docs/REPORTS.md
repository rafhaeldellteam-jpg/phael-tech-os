# Relatórios: fórmulas

Todos os relatórios são funções SQL (`supabase/migrations/20261030120000_reports.sql`), testadas em
`supabase/tests/sql/16_reports.sql` com dados controlados. Períodos são datas locais de São Paulo,
inclusivas: de `De 00:00` até `Até 23:59:59`. Dinheiro em centavos, sem arredondamento.

| Indicador | Fórmula | Permissão |
|---|---|---|
| Abertas | OS com `received_at` no período | reports.operational |
| Entregues | OS com `delivered_at` no período, sem retornos de garantia | reports.operational |
| Em andamento agora | OS cujo status não está nas etapas "concluída" ou "parada" | reports.operational |
| Tempo médio / mediana de reparo | média / mediana de `delivered_at − received_at` das entregues, em horas | reports.operational |
| Entregues no prazo | entregues com prazo e `delivered_at ≤ due_at`, sobre entregues com prazo | reports.operational |
| Retornos em garantia | OS com `warranty_of` aberta no período | reports.operational |
| Por técnico | entregues agrupadas por responsável; receita = soma dos itens (só com reports.financial) | reports.operational |
| Receita de item | `qtd × preço unitário − desconto`; itens removidos valem 0 | — |
| Mais vendidos | itens de OS entregues no período, por item do catálogo/produto; custo = `qtd × custo unitário` (só com reports.financial) | reports.operational |
| Clientes que mais faturaram | contas a receber não canceladas com emissão no período: soma do valor, do pago e do em aberto | reports.financial |
| Contas a receber por atraso | em aberto hoje (`valor − pago`) por dias desde o vencimento: a vencer, 1–30, 31–60, 61–90, mais de 90 | reports.financial |
| Série mensal | por mês: OS abertas, entregues; faturado (emissão), recebido e pago (data do pagamento, estornos negativos descontados) | um dos dois |
