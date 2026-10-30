-- Fase 4: serviços digitais, contratos recorrentes e geração idempotente de cobranças.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"company","name":"Loja Cliente"}') as cli \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Outro Cliente"}') as cli2 \gset
select public.seed_finance_defaults(:'company_a');
select id as cat_in from public.finance_categories where company_id = :'company_a' and direction = 'in' limit 1 \gset
select id as cat_out from public.finance_categories where company_id = :'company_a' and direction = 'out' limit 1 \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

-- ---------------------------------------------------------------- serviços digitais
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.save_digital_service(:'company_a', null, format(
  '{"client_id":"%s","kind":"ecommerce","name":"Loja virtual","url":"https://loja.example.com","status":"active","domain_expires_on":"%s"}',
  :'cli', current_date + 10)::jsonb) as site \gset
select tests.ok((select number = 1 and kind = 'ecommerce' and status = 'active' from public.digital_services where id = :'site'), 'serviço digital criado');
select tests.throws(format($q$select public.save_digital_service(%L, null, '{"client_id":"%s","name":"Site","url":"loja sem protocolo"}')$q$, :'company_a', :'cli'),
  '23514', 'URL precisa começar com http(s)://');
select tests.ok((select count(*) from public.expiring_domains(:'company_a', 30)) = 1, 'domínio que vence em 10 dias aparece no alerta');
select tests.ok((select count(*) from public.expiring_domains(:'company_a', 5)) = 0, 'janela menor não mostra');
select public.save_digital_service(:'company_a', :'site', format(
  '{"client_id":"%s","kind":"ecommerce","name":"Loja virtual 2.0","url":"https://loja.example.com","status":"active"}', :'cli')::jsonb);
select tests.ok((select name = 'Loja virtual 2.0' and domain_expires_on is null from public.digital_services where id = :'site'), 'edição substitui os campos enviados');

select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.digital_services) = 1, 'técnico com clients.read vê serviços digitais');
select tests.throws(format($q$select public.save_digital_service(%L, null, '{"client_id":"%s","name":"Técnico cria"}')$q$, :'company_a', :'cli'),
  '42501', 'técnico não cadastra serviço digital');
select tests.login('00000000-0000-0000-0000-0000000000a4');
select public.save_digital_service(:'company_a', null, format('{"client_id":"%s","kind":"domain","name":"loja.com.br"}', :'cli')::jsonb) as dom \gset
select tests.ok(:'dom' is not null, 'atendente cadastra serviço digital');

-- ---------------------------------------------------------------- contratos
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format($q$select public.save_contract(%L, null, '{"client_id":"%s","digital_service_id":"%s","description":"Manutenção","amount_cents":15000,"billing_day":10,"start_date":"2026-01-01"}')$q$,
  :'company_a', :'cli2', :'site'), '23514', 'serviço digital precisa ser do mesmo cliente');
select tests.throws(format($q$select public.save_contract(%L, null, '{"client_id":"%s","description":"Manutenção","amount_cents":15000,"billing_day":10,"start_date":"2026-01-01","category_id":"%s"}')$q$,
  :'company_a', :'cli', :'cat_out'), '23514', 'categoria precisa ser de receita');
select tests.throws(format($q$select public.save_contract(%L, null, '{"client_id":"%s","description":"Dia 31","amount_cents":15000,"billing_day":31,"start_date":"2026-01-01"}')$q$,
  :'company_a', :'cli'), '23514', 'dia de vencimento até 28 (existe em todo mês)');
select tests.throws(format($q$select public.save_contract(%L, null, '{"client_id":"%s","description":"Semanal","amount_cents":15000,"billing_day":5,"interval_months":4,"start_date":"2026-01-01"}')$q$,
  :'company_a', :'cli'), '23514', 'periodicidade só 1, 2, 3, 6 ou 12 meses');

-- Mensal desde 15/01/2026, vence dia 10: primeiro vencimento possível é 10/02 (10/01 é antes do início).
select public.save_contract(:'company_a', null, format(
  '{"client_id":"%s","digital_service_id":"%s","description":"Manutenção da loja","amount_cents":15000,"billing_day":10,"start_date":"2026-01-15","category_id":"%s"}',
  :'cli', :'site', :'cat_in')::jsonb) as ct \gset
select tests.ok((select next_due from public.contract_overview(:'company_a') where contract_id = :'ct') = '2026-02-10', 'próximo vencimento respeita a data de início');

select tests.ok(public.generate_contract_charges(:'company_a', '2026-05-31') = 4, 'gera fevereiro a maio (4 cobranças)');
select tests.ok(public.generate_contract_charges(:'company_a', '2026-05-31') = 0, 'rodar de novo não duplica (idempotente)');
select tests.ok((select array_agg(due_date order by due_date) from public.finance_entries where contract_id = :'ct')
  = array['2026-02-10','2026-03-10','2026-04-10','2026-05-10']::date[], 'vencimentos no dia 10 de cada mês');
select tests.ok((select bool_and(amount_cents = 15000 and client_id = :'cli'::uuid and category_id = :'cat_in'::uuid and direction = 'in')
  from public.finance_entries where contract_id = :'ct'), 'cobranças com valor, cliente e categoria do contrato');
select tests.ok((select description from public.finance_entries where contract_id = :'ct' and due_date = '2026-03-10') = 'Manutenção da loja - 03/2026',
  'descrição traz a competência');

-- Cancelar uma cobrança não a recria.
select id as mar from public.finance_entries where contract_id = :'ct' and due_date = '2026-03-10' \gset
select public.cancel_finance_entry(:'mar', 'Cliente ganhou o mês de cortesia');
select tests.ok(public.generate_contract_charges(:'company_a', '2026-05-31') = 0, 'cobrança cancelada não é recriada');
select tests.ok((select open_cents from public.contract_overview(:'company_a') where contract_id = :'ct') = 45000, 'em aberto ignora a cancelada');

-- Calendário fixo depois de cobrar
select tests.throws(format($q$select public.save_contract(%L, %L, '{"client_id":"%s","description":"Manutenção da loja","amount_cents":15000,"billing_day":15,"interval_months":1,"start_date":"2026-01-15"}')$q$,
  :'company_a', :'ct', :'cli'), '23514', 'dia de vencimento não muda depois de cobrar');
select public.save_contract(:'company_a', :'ct', format(
  '{"client_id":"%s","digital_service_id":"%s","description":"Manutenção da loja","amount_cents":18000,"billing_day":10,"interval_months":1,"start_date":"2026-01-15","category_id":"%s"}',
  :'cli', :'site', :'cat_in')::jsonb);
select tests.ok(public.generate_contract_charges(:'company_a', '2026-06-30') = 1, 'reajuste vale para as próximas cobranças');
select tests.ok((select amount_cents from public.finance_entries where contract_id = :'ct' and due_date = '2026-06-10') = 18000, 'nova cobrança com valor reajustado');
select tests.ok((select amount_cents from public.finance_entries where contract_id = :'ct' and due_date = '2026-05-10') = 15000, 'cobranças antigas mantêm o valor');

-- Trimestral com fim
select public.save_contract(:'company_a', null, format(
  '{"client_id":"%s","description":"Hospedagem trimestral","amount_cents":9000,"billing_day":5,"interval_months":3,"start_date":"2026-01-01","end_date":"2026-08-31"}',
  :'cli2')::jsonb) as ct3 \gset
select public.generate_contract_charges(:'company_a', '2026-12-31', :'ct3');
select tests.ok((select array_agg(due_date order by due_date) from public.finance_entries where contract_id = :'ct3')
  = array['2026-01-05','2026-04-05','2026-07-05']::date[], 'trimestral para no fim do contrato');

-- Pausa e encerramento
select public.set_contract_status(:'ct', 'paused', 'Cliente pediu pausa');
select tests.ok(public.generate_contract_charges(:'company_a', '2026-09-30') = 0, 'pausado não gera cobrança');
select tests.throws(format($q$select public.set_contract_status(%L, 'ended')$q$, :'ct'), '23514', 'encerrar exige motivo');
select public.set_contract_status(:'ct', 'ended', 'Cliente cancelou a manutenção');
select tests.ok((select status = 'ended' and end_date is not null from public.contracts where id = :'ct'), 'encerrado com data de fim');
select tests.throws(format($q$select public.set_contract_status(%L, 'active')$q$, :'ct'), '23514', 'encerrado não volta a ativo');
select tests.throws(format($q$select public.generate_contract_charges(%L, current_date + 500)$q$, :'company_a'), '23514', 'antecedência máxima de 400 dias');
select tests.throws(format($q$update public.finance_entries set contract_id = null where id = %L$q$, :'mar'), '42501', 'vínculo com contrato não é editável pelo navegador');
select tests.ok(exists (select 1 from public.audit_log where entity = 'contracts' and entity_id = :'ct'), 'contrato fica na auditoria');

-- ---------------------------------------------------------------- permissões e isolamento
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select count(*) from public.contracts) = 2, 'financeiro vê contratos');
select tests.ok(public.generate_contract_charges(:'company_a', '2026-12-31') >= 0, 'financeiro gera cobranças');

select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.contracts) = 0, 'técnico não vê contratos');
select tests.throws(format('select public.generate_contract_charges(%L)', :'company_a'), '42501', 'técnico não gera cobranças');

select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.digital_services) = 0, 'Empresa B não vê serviços digitais da A');
select tests.ok((select count(*) from public.contracts) = 0, 'Empresa B não vê contratos da A');
select tests.throws(format('select public.generate_contract_charges(%L)', :'company_a'), '42501', 'Empresa B não gera cobranças da A');
select tests.throws(format($q$select public.save_contract(%L, null, '{"client_id":"%s","description":"Invasão","amount_cents":100,"billing_day":1,"start_date":"2026-01-01"}')$q$,
  :'company_b', :'cli'), 'P0002', 'Empresa B não usa cliente da A');
select tests.throws(format($q$select public.set_contract_status(%L, 'paused', 'x')$q$, :'ct3'), 'P0002', 'Empresa B não altera contrato da A');

select tests.login_anon();
select tests.throws(format('select * from public.expiring_domains(%L)', :'company_a'), '42501', 'anônimo não executa funções novas');
reset role;

rollback;
