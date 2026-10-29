-- Financeiro: parcelas exatas, pagamentos parciais, estornos, cancelamento, relatórios, conciliação, permissões.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Um"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Não liga"}', :'cli', :'eq')::jsonb) as os \gset
insert into public.service_catalog (company_id, name, category, price_cents) values (:'company_a', 'Formatação', 'software', 15000) returning id as svc \gset
select public.add_order_item(:'os', format('{"kind":"service","catalog_id":"%s"}', :'svc')::jsonb);
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

-- ---------------------------------------------------------------- parcelamento
select tests.ok(private.split_installments(10000, 3) = array[3334, 3333, 3333]::bigint[], 'R$ 100 em 3x: 33,34 + 33,33 + 33,33');
select tests.ok((select sum(x) from unnest(private.split_installments(99999, 7)) x) = 99999, 'parcelas sempre somam o total');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select public.seed_finance_defaults(:'company_a');
select public.seed_finance_defaults(:'company_a');
select tests.ok((select count(*) from public.finance_accounts) = 2, 'contas iniciais criadas uma vez');
select id as caixa from public.finance_accounts where name = 'Caixa' \gset
select id as banco from public.finance_accounts where name = 'Conta bancária' \gset
select id as cat_serv from public.finance_categories where name = 'Serviços de assistência' \gset
select id as cat_aluguel from public.finance_categories where name = 'Aluguel' \gset
update public.finance_accounts set opening_balance_cents = 50000 where id = :'caixa';

select public.create_finance_entry(:'company_a', format(
  '{"direction":"in","description":"Formatação","order_id":"%s","category_id":"%s","amount_cents":10000,"installments":3,"first_due_date":"2026-01-31","issue_date":"2026-01-10"}',
  :'os', :'cat_serv')::jsonb) as grp \gset
select tests.ok((select count(*) from public.finance_entries where group_id = :'grp') = 3, 'gera 3 parcelas');
select tests.ok((select array_agg(due_date order by installment_no) from public.finance_entries where group_id = :'grp')
  = array['2026-01-31','2026-02-28','2026-03-31']::date[], 'vencimentos mensais respeitam fim de mês');
select tests.ok((select bool_and(client_id = :'cli'::uuid) from public.finance_entries where group_id = :'grp'), 'cobrança da OS herda o cliente');
select tests.ok((select description from public.finance_entries where group_id = :'grp' and installment_no = 2) = 'Formatação (2/3)', 'descrição numera a parcela');
select id as p1 from public.finance_entries where group_id = :'grp' and installment_no = 1 \gset
select id as p2 from public.finance_entries where group_id = :'grp' and installment_no = 2 \gset

select tests.throws(format($q$select public.create_finance_entry(%L, '{"direction":"out","description":"x y","amount_cents":100,"category_id":"%s"}')$q$, :'company_a', :'cat_serv'),
  '23514', 'categoria de receita não serve para despesa');
select tests.throws(format($q$select public.create_finance_entry(%L, '{"direction":"in","description":"zero","amount_cents":0}')$q$, :'company_a'),
  '23514', 'valor zero é rejeitado');
select tests.throws(format($q$select public.create_finance_entry(%L, '{"direction":"out","description":"OS a pagar","amount_cents":100,"order_id":"%s"}')$q$, :'company_a', :'os'),
  '23514', 'OS não gera conta a pagar');

-- ---------------------------------------------------------------- pagamentos parciais
select public.register_payment(:'p1', format('{"account_id":"%s","method":"pix","amount_cents":2000,"paid_at":"2026-01-20"}', :'banco')::jsonb) as pay1 \gset
select tests.ok((select status from public.finance_entries where id = :'p1') = 'partial', 'pagamento parcial marca a parcela como parcial');
select tests.throws(format($q$select public.register_payment(%L, '{"account_id":"%s","amount_cents":1335}')$q$, :'p1', :'banco'),
  '23514', 'não recebe mais que o saldo em aberto (13,34)');
select public.register_payment(:'p1', format('{"account_id":"%s","method":"cash","amount_cents":1334,"paid_at":"2026-01-25"}', :'caixa')::jsonb);
select tests.ok((select status from public.finance_entries where id = :'p1') = 'paid', 'quitada ao completar o valor');
select tests.throws(format($q$select public.register_payment(%L, '{"account_id":"%s","amount_cents":1}')$q$, :'p1', :'banco'),
  '23514', 'parcela quitada não recebe mais');
select tests.throws(format($q$select public.update_finance_entry(%L, '{"amount_cents":5000}')$q$, :'p1'),
  '23514', 'valor não muda depois de pagamento');

-- ---------------------------------------------------------------- estorno
select tests.throws(format($q$select public.reverse_payment(%L, '')$q$, :'pay1'), '23514', 'estorno exige motivo');
select public.reverse_payment(:'pay1', 'Pix devolvido pelo banco') as rev1 \gset
select tests.ok((select paid_cents from public.finance_entries where id = :'p1') = 1334, 'estorno desconta do pago');
select tests.ok((select status from public.finance_entries where id = :'p1') = 'partial', 'volta a parcial após estorno');
select tests.ok((select amount_cents from public.finance_payments where id = :'rev1') = -2000, 'estorno é lançamento inverso (negativo)');
select tests.ok((select count(*) from public.finance_payments where entry_id = :'p1') = 3, 'pagamento original continua registrado');
select tests.throws(format($q$select public.reverse_payment(%L, 'de novo')$q$, :'pay1'), '23514', 'pagamento não é estornado duas vezes');
select tests.throws(format($q$select public.reverse_payment(%L, 'estorno do estorno')$q$, :'rev1'), '23514', 'estorno não é estornado');

-- ---------------------------------------------------------------- cancelamento
select tests.throws(format($q$select public.cancel_finance_entry(%L, 'erro')$q$, :'p1'), '23514', 'não cancela lançamento com pagamento');
select tests.throws(format($q$select public.cancel_finance_entry(%L, '')$q$, :'p2'), '23514', 'cancelamento exige motivo');
select public.cancel_finance_entry(:'p2', 'Cliente quitou à vista na 1ª parcela');
select tests.ok((select status from public.finance_entries where id = :'p2') = 'canceled', 'parcela cancelada');
select tests.throws(format($q$select public.register_payment(%L, '{"account_id":"%s","amount_cents":100}')$q$, :'p2', :'banco'),
  '23514', 'cancelado não recebe pagamento');

-- ---------------------------------------------------------------- despesa e relatórios
select public.create_finance_entry(:'company_a', format('{"direction":"out","description":"Aluguel janeiro","category_id":"%s","amount_cents":120000,"first_due_date":"2026-01-05","issue_date":"2026-01-05"}', :'cat_aluguel')::jsonb) as g_alug \gset
select id as alug from public.finance_entries where group_id = :'g_alug' \gset
select public.register_payment(:'alug', format('{"account_id":"%s","method":"transfer","amount_cents":120000,"paid_at":"2026-01-05"}', :'banco')::jsonb);

select tests.ok((select billed_cents from public.finance_summary(:'company_a', '2026-01-01', '2026-01-31')) = 6667,
  'faturamento ignora a parcela cancelada (33,34 + 33,33)');
select tests.ok((select expenses_cents from public.finance_summary(:'company_a', '2026-01-01', '2026-01-31')) = 120000, 'despesas do período');
select tests.ok((select estimated_result_cents from public.finance_summary(:'company_a', '2026-01-01', '2026-01-31')) = 6667 - 120000,
  'resultado estimado = faturamento − despesas');
-- O estorno entra no caixa na data em que acontece (hoje), não na data do pagamento original.
select tests.ok((select received_cents from public.finance_summary(:'company_a', '2026-01-01', '2026-01-31')) = 2000 + 1334,
  'recebimentos de janeiro: o estorno não altera o passado');
select tests.ok((select received_cents from public.finance_summary(:'company_a', current_date, current_date)) = -2000,
  'estorno aparece no dia em que foi feito');
select tests.ok((select paid_cents from public.finance_summary(:'company_a', '2026-01-01', '2026-01-31')) = 120000, 'pagamentos do período');
select tests.ok((select balance_cents from public.finance_summary(:'company_a', '2026-01-01', '2026-01-31')) = 50000 + 1334 - 120000,
  'saldo = saldo inicial + entradas − saídas');
select tests.ok((select receivable_open_cents from public.finance_summary(:'company_a', '2026-01-01', '2026-01-31')) = 3334 - 1334 + 3333,
  'a receber em aberto: restante da 1ª + 3ª parcela');
select tests.ok((select count(*) from public.cash_flow(:'company_a', '2026-01-01', '2026-01-31', 'day')) = 3, 'fluxo diário só com dias com movimento');
select tests.ok((select balance_cents from public.cash_flow(:'company_a', '2026-01-01', '2026-01-31', 'month')) = 50000 + 3334 - 120000,
  'saldo acumulado de janeiro (antes do estorno)');
select tests.ok(
  (select balance_cents from public.cash_flow(:'company_a', '2026-01-01', current_date, 'day') order by period desc limit 1)
    = (select balance_cents from public.finance_summary(:'company_a', '2026-01-01', current_date)),
  'saldo final do fluxo bate com o saldo do resumo');
select tests.throws(format($q$select * from public.cash_flow(%L, '2026-01-01', '2026-01-31', 'year')$q$, :'company_a'), '22023', 'agrupamento inválido');

-- ---------------------------------------------------------------- conciliação
select * from public.import_statement(:'banco', '[
  {"date":"2026-01-05","description":"TED ALUGUEL","amount_cents":-120000},
  {"date":"2026-01-06","description":"TARIFA","amount_cents":-1500},
  {"date":"2026-01-06","description":"TARIFA","amount_cents":-1500}
]'::jsonb);
select tests.ok((select count(*) from public.bank_statement_lines) = 3, 'importa linhas, inclusive duas iguais no mesmo dia');
select tests.ok((select skipped from public.import_statement(:'banco', '[{"date":"2026-01-05","description":"TED ALUGUEL","amount_cents":-120000}]'::jsonb)) = 1,
  'reimportar o mesmo extrato não duplica');
select id as linha from public.bank_statement_lines where description = 'TED ALUGUEL' \gset
select payment_id as sug from public.statement_suggestions(:'linha') limit 1 \gset
select tests.ok(:'sug' = (select id::text from public.finance_payments where entry_id = :'alug'), 'sugere o pagamento do aluguel (mesmo valor e conta)');
select public.match_statement_line(:'linha', :'sug');
select tests.ok((select matched_payment_id is not null from public.bank_statement_lines where id = :'linha'), 'linha conciliada');
select id as tarifa from public.bank_statement_lines where description = 'TARIFA' limit 1 \gset
select tests.throws(format('select public.match_statement_line(%L, %L)', :'tarifa', :'sug'), '23514', 'não concilia valores diferentes');
reset role;

-- ---------------------------------------------------------------- relatórios de margem
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.change_service_order_status(:'os', 'in_repair');
select public.change_service_order_status(:'os', 'ready');
select public.change_service_order_status(:'os', 'delivered');
select tests.ok((select revenue_cents from public.order_margins(:'company_a', current_date - 1, current_date + 1)) = 15000, 'margem por OS: receita dos itens');
select tests.ok((select received_cents from public.order_margins(:'company_a', current_date - 1, current_date + 1)) = 1334, 'margem por OS: quanto já entrou');
select tests.ok((select label from public.service_category_results(:'company_a', current_date - 1, current_date + 1)) = 'Sistema e software',
  'resultado por categoria de serviço');
reset role;

-- ---------------------------------------------------------------- permissões
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.finance_entries) = 0, 'técnico não vê o financeiro');
select tests.throws(format($q$select * from public.finance_summary(%L, '2026-01-01', '2026-01-31')$q$, :'company_a'), '42501', 'técnico não vê resumo');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a4');
select tests.throws(format($q$select public.register_payment(%L, '{"account_id":"%s","amount_cents":100}')$q$, :'p1', :'banco'),
  '42501', 'atendente não registra pagamento');
reset role;
select tests.throws('update public.finance_payments set amount_cents = 1', '42501', 'pagamentos são imutáveis até para o dono');

select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.finance_entries) = 0, 'Empresa B não vê lançamentos da A');
select tests.ok((select count(*) from public.finance_payments) = 0, 'Empresa B não vê pagamentos da A');
select tests.throws(format($q$select public.register_payment(%L, '{"account_id":"%s","amount_cents":100}')$q$, :'p1', :'banco'),
  '42501', 'Empresa B não paga título da A');
select tests.throws(format($q$select * from public.finance_summary(%L, '2026-01-01', '2026-01-31')$q$, :'company_a'), '42501', 'Empresa B não vê resumo da A');
reset role;

rollback;
