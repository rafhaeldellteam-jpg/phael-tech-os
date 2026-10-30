-- Relatórios: fórmulas com dados controlados, permissões e isolamento.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test', 'Admin A');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test', 'Técnico A');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Grande"}') as cli1 \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Pequeno"}') as cli2 \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli1')::jsonb) as eq1 \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli2')::jsonb) as eq2 \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select tests.login('00000000-0000-0000-0000-0000000000a1');
insert into public.service_catalog (company_id, name, category, price_cents, cost_cents) values (:'company_a', 'Formatação', 'software', 15000, 2000) returning id as svc \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Lento","assigned_to":"00000000-0000-0000-0000-0000000000a2"}', :'cli1', :'eq1')::jsonb) as os1 \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Vírus","assigned_to":"00000000-0000-0000-0000-0000000000a2"}', :'cli2', :'eq2')::jsonb) as os2 \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Ainda aberta"}', :'cli1', :'eq1')::jsonb) as os3 \gset
select public.add_order_item(:'os1', format('{"kind":"service","catalog_id":"%s","qty":2,"discount_cents":5000}', :'svc')::jsonb);
select public.add_order_item(:'os2', format('{"kind":"service","catalog_id":"%s"}', :'svc')::jsonb);
select public.add_order_item(:'os2', '{"kind":"service","description":"Limpeza","unit_price_cents":4000}'::jsonb) as clean \gset
select public.remove_order_item(:'clean', 'Cliente desistiu');
do $$ declare o uuid; begin
  for o in select id from public.service_orders where reported_problem in ('Lento', 'Vírus') loop
    perform public.change_service_order_status(o, 'triage');
    perform public.change_service_order_status(o, 'in_repair');
    perform public.change_service_order_status(o, 'ready');
    perform public.change_service_order_status(o, 'delivered');
  end loop;
end $$;

-- Datas controladas: OS1 levou 24 h (no prazo), OS2 levou 72 h (atrasou). Ambas entregues em 15/10/2026.
reset role;
update public.service_orders set received_at = '2026-10-14 12:00-03', delivered_at = '2026-10-15 12:00-03', due_at = '2026-10-16 18:00-03' where id = :'os1';
update public.service_orders set received_at = '2026-10-12 12:00-03', delivered_at = '2026-10-15 12:00-03', due_at = '2026-10-13 18:00-03' where id = :'os2';
update public.service_orders set received_at = '2026-10-20 09:00-03' where id = :'os3';

select tests.login('00000000-0000-0000-0000-0000000000a1');
select * from public.report_orders_summary(:'company_a', '2026-10-01', '2026-10-31') \gset r_
select tests.ok(:r_opened = 3, 'abertas no período');
select tests.ok(:r_delivered = 2, 'entregues no período');
select tests.ok(:r_open_now = 1, 'em andamento agora');
select tests.ok(:r_avg_turnaround_hours = 48.0, 'tempo médio de reparo = (24 + 72) / 2 = 48 h');
select tests.ok(:r_median_turnaround_hours = 48.0, 'mediana do tempo de reparo');
select tests.ok(:r_due_tracked = 2 and :r_on_time = 1, 'uma de duas no prazo');
select tests.ok((select delivered from public.report_orders_summary(:'company_a', '2026-10-16', '2026-10-31')) = 0, 'período é por data local inclusiva');
select tests.ok((select delivered from public.report_orders_summary(:'company_a', '2026-10-15', '2026-10-15')) = 2, 'um único dia inclui o dia inteiro');

select tests.ok((select delivered = 2 and avg_turnaround_hours = 48.0 and revenue_cents = 40000 and name = 'Técnico A'
  from public.report_by_technician(:'company_a', '2026-10-01', '2026-10-31')), 'por técnico: 2 OS, 48 h, R$ 400 (2x150−50 + 150)');

select tests.ok((select qty = 3 and orders = 2 and revenue_cents = 40000 and cost_cents = 6000
  from public.report_top_items(:'company_a', '2026-10-01', '2026-10-31') where description = 'Formatação'), 'mais vendidos: quantidade, receita e custo');
select tests.ok(not exists (select 1 from public.report_top_items(:'company_a', '2026-10-01', '2026-10-31') where description = 'Limpeza'),
  'item removido não conta');

-- Financeiro: dois títulos para o Cliente Grande (um pago, um vencido há 40 dias) e um a vencer do Pequeno.
select public.seed_finance_defaults(:'company_a');
select id as acc from public.finance_accounts where company_id = :'company_a' limit 1 \gset
select public.create_finance_entry(:'company_a', format('{"direction":"in","description":"OS 1","amount_cents":25000,"client_id":"%s","issue_date":"2026-10-15","first_due_date":"2026-10-15"}', :'cli1')::jsonb);
select public.create_finance_entry(:'company_a', format('{"direction":"in","description":"Antigo","amount_cents":10000,"client_id":"%s","issue_date":"2026-10-02","first_due_date":"%s"}', :'cli1', current_date - 40)::jsonb);
select public.create_finance_entry(:'company_a', format('{"direction":"in","description":"OS 2","amount_cents":15000,"client_id":"%s","issue_date":"2026-10-15","first_due_date":"%s"}', :'cli2', current_date + 10)::jsonb);
select id as e1 from public.finance_entries where description = 'OS 1' \gset
select public.register_payment(:'e1', format('{"account_id":"%s","method":"pix","amount_cents":25000,"paid_at":"2026-10-15"}', :'acc')::jsonb);

select tests.ok((select billed_cents = 35000 and received_cents = 25000 and open_cents = 10000 and entries = 2
  from public.report_top_clients(:'company_a', '2026-10-01', '2026-10-31') where name = 'Cliente Grande'), 'clientes: faturado, recebido e em aberto');
select tests.ok((select name from public.report_top_clients(:'company_a', '2026-10-01', '2026-10-31') limit 1) = 'Cliente Grande', 'ordenado por faturamento');
select tests.ok((select open_cents from public.report_receivables_aging(:'company_a') where bucket = 'A vencer') = 15000, 'a vencer');
select tests.ok((select open_cents from public.report_receivables_aging(:'company_a') where bucket = '31 a 60 dias') = 10000, 'vencido há 40 dias cai em 31 a 60');
select tests.ok((select count(*) from public.report_receivables_aging(:'company_a')) = 5, 'cinco faixas, mesmo vazias');
select tests.ok((select count(*) from public.report_monthly(:'company_a', 6)) = 6, 'série mensal com 6 meses');
select tests.ok((select sum(received_cents) from public.report_monthly(:'company_a', 36)) = 25000, 'recebimentos somados na série');
select tests.throws(format($q$select * from public.report_orders_summary(%L, '2026-10-31', '2026-10-01')$q$, :'company_a'), '22023', 'período invertido é rejeitado');

-- ---------------------------------------------------------------- permissões
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select count(*) from public.report_top_clients(:'company_a', '2026-10-01', '2026-10-31')) = 2, 'financeiro vê relatórios financeiros');
select tests.throws(format($q$select * from public.report_orders_summary(%L, '2026-10-01', '2026-10-31')$q$, :'company_a'), '42501', 'financeiro sem reports.operational não vê operacional');
select tests.ok((select bool_and(opened is not null and billed_cents is not null) from public.report_monthly(:'company_a', 3)), 'série mensal para quem tem um dos relatórios');

select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.throws(format('select * from public.report_receivables_aging(%L)', :'company_a'), '42501', 'técnico não vê inadimplência');
select tests.throws(format($q$select * from public.report_by_technician(%L, '2026-10-01', '2026-10-31')$q$, :'company_a'), '42501', 'técnico sem permissão de relatórios');

select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select delivered from public.report_orders_summary(:'company_b', '2026-10-01', '2026-10-31')) = 0, 'Empresa B vê só os próprios números');
select tests.throws(format($q$select * from public.report_top_clients(%L, '2026-10-01', '2026-10-31')$q$, :'company_a'), '42501', 'Empresa B não vê relatórios da A');
select tests.login_anon();
select tests.throws(format('select * from public.report_monthly(%L)', :'company_a'), '42501', 'anônimo não executa relatórios');
reset role;

rollback;
