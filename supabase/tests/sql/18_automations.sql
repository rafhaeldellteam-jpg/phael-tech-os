-- Automações: cobrança diária idempotente, 1x por dia pelo painel, histórico, avisos por permissão.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Contrato"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

-- Contrato mensal que começou há 2 meses, vence dia 5.
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.save_contract(:'company_a', null, format('{"client_id":"%s","description":"Suporte mensal","amount_cents":20000,"billing_day":5,"start_date":"%s"}',
  :'cli', (date_trunc('month', current_date) - interval '2 months')::date)::jsonb) as ct \gset

-- Técnico abre o painel: a cobrança roda como tarefa do sistema, mesmo sem permissão financeira dele.
select tests.login('00000000-0000-0000-0000-0000000000a2');
select public.run_automations(:'company_a') as r1 \gset
select tests.ok((:'r1'::jsonb -> 0 ->> 'created')::int >= 2, 'painel gera as cobranças vencidas e as dos próximos dias');
select tests.ok((select count(*) from public.automation_runs where company_id = :'company_a' and ok and trigger = 'dashboard') = 1, 'execução registrada no histórico');
select public.run_automations(:'company_a') as r2 \gset
select tests.ok((:'r2'::jsonb -> 0 ->> 'skipped') = 'já executada hoje', 'pelo painel roda no máximo uma vez por dia');
select tests.throws(format('select public.run_contract_billing_now(%L)', :'company_a'), '42501', 'técnico não usa "rodar agora"');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((public.run_contract_billing_now(:'company_a') ->> 'created')::int = 0, '"rodar agora" é idempotente: nada novo');
select tests.ok((select count(*) from public.automation_runs where company_id = :'company_a') = 2, 'execução manual também fica no histórico');

-- Agendador percorre todas as empresas, sem duplicar o que o painel já fez hoje.
reset role;
select private.run_scheduled_automations();
select tests.ok((select count(*) from public.automation_runs where company_id = :'company_a' and trigger = 'schedule') = 0, 'agendador não repete a execução do dia');
select tests.ok((select count(*) from public.automation_runs where company_id = :'company_b' and trigger = 'schedule') = 1, 'agendador roda para as outras empresas');
select tests.throws(format($q$delete from public.automation_runs where company_id = %L$q$, :'company_a'), '42501', 'histórico é imutável');

-- Desligar a cobrança automática
update public.companies set auto_billing_enabled = false where id = :'company_a';
select tests.ok((select (private.run_contract_billing(:'company_a', 'schedule') ->> 'skipped')) = 'desativada', 'cobrança automática desligada não roda');
select tests.login('00000000-0000-0000-0000-0000000000a1');

-- ---------------------------------------------------------------- avisos
-- Cobranças de meses anteriores estão vencidas → aviso financeiro.
select tests.ok((select total >= 1 and amount_cents >= 20000 from public.automation_alerts(:'company_a') where kind = 'overdue_receivables'), 'aviso de contas a receber vencidas');
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Parada"}', :'cli', :'eq')::jsonb) as os \gset
reset role;
-- Envelhece o histórico só no teste (a tabela é imutável; o rollback final desfaz tudo).
alter table public.service_order_events disable trigger service_order_events_immutable;
update public.service_order_events set created_at = now() - interval '10 days' where order_id = :'os';
alter table public.service_order_events enable trigger service_order_events_immutable;
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select total = 1 and items -> 0 ->> 'label' = 'OS-0001' from public.automation_alerts(:'company_a') where kind = 'stalled_orders'), 'aviso de OS parada há mais de 7 dias');
reset role;
update public.companies set stalled_order_days = 15 where id = :'company_a';
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok(not exists (select 1 from public.automation_alerts(:'company_a') where kind = 'stalled_orders'), 'limite de dias configurável');

select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok(not exists (select 1 from public.automation_alerts(:'company_a') where kind = 'overdue_receivables'), 'técnico não recebe aviso financeiro');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select * from public.automation_alerts(%L)', :'company_a'), '42501', 'Empresa B não vê avisos da A');
select tests.ok((select count(*) from public.automation_runs) = 1, 'Empresa B vê só o próprio histórico');
select tests.throws(format('select public.run_automations(%L)', :'company_a'), '42501', 'Empresa B não dispara automações da A');
select tests.login_anon();
select tests.throws(format('select public.run_automations(%L)', :'company_a'), '42501', 'anônimo não dispara automações');
reset role;

rollback;
