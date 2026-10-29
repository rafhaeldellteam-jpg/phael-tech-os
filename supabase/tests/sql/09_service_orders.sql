-- Ordens de serviço: abertura, numeração, transições, motivo, permissões por papel e por técnico.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test', 'Admin');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec1@a.test', 'Técnico Um');
select tests.create_user('00000000-0000-0000-0000-0000000000a5', 'tec2@a.test', 'Técnico Dois');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Um"}') as cli \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Dois"}') as cli2 \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook","model":"G15"}', :'cli')::jsonb) as eq \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"desktop"}', :'cli2')::jsonb) as eq2 \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a5', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

-- ---------------------------------------------------------------- atendente abre OS
select tests.login('00000000-0000-0000-0000-0000000000a4');
select public.create_service_order(:'company_a', format(
  '{"client_id":"%s","equipment_id":"%s","reported_problem":"Não liga","intake_accessories":["Carregador",""],"assigned_to":"00000000-0000-0000-0000-0000000000a2","due_at":"2020-01-01T12:00:00Z","device_password_note":"senha com o cliente"}',
  :'cli', :'eq')::jsonb) as os1 \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Lento"}', :'cli', :'eq')::jsonb) as os2 \gset

select tests.ok((select number from public.service_orders where id = :'os1') = 1, 'primeira OS recebe número 1');
select tests.ok((select number from public.service_orders where id = :'os2') = 2, 'segunda OS recebe número 2');
select tests.ok((select status from public.service_orders where id = :'os1') = 'received', 'OS nasce como Recebido');
select tests.ok((select intake_accessories from public.service_orders where id = :'os1') = array['Carregador'], 'acessórios vazios são descartados');
select tests.ok((select count(*) from public.service_order_events where order_id = :'os1' and kind = 'created') = 1, 'abertura entra na linha do tempo');

select tests.throws(format($q$select public.create_service_order(%L, '{"client_id":"%s","equipment_id":"%s","reported_problem":"x y z"}')$q$, :'company_a', :'cli2', :'eq'),
  '23514', 'equipamento precisa ser do cliente da OS');
select tests.throws(format($q$select public.create_service_order(%L, '{"client_id":"%s","reported_problem":"Sem equipamento"}')$q$, :'company_a', :'cli'),
  '23514', 'OS de bancada exige equipamento');
select public.create_service_order(:'company_a', format('{"client_id":"%s","mode":"remote","reported_problem":"Configurar e-mail"}', :'cli')::jsonb) as os_remote \gset
select tests.ok((select mode from public.service_orders where id = :'os_remote') = 'remote', 'atendimento remoto dispensa equipamento');
select tests.throws(format($q$select public.create_service_order(%L, '{"client_id":"%s","equipment_id":"%s","reported_problem":"ok ok","assigned_to":"00000000-0000-0000-0000-0000000000a3"}')$q$, :'company_a', :'cli', :'eq'),
  '23514', 'financeiro não pode ser responsável técnico');

select tests.throws(format($q$select public.change_service_order_status(%L, 'diagnosis')$q$, :'os1'),
  '42501', 'atendente não mexe no andamento técnico');
select tests.throws(format($q$select public.update_service_order(%L, '{"priority":"urgent"}')$q$, :'os1'),
  '42501', 'atendente não edita a OS depois de aberta');
select tests.throws('insert into public.service_orders (company_id, number, client_id, reported_problem) values (gen_random_uuid(), 9, gen_random_uuid(), $$abc$$)',
  '42501', 'não há INSERT direto em service_orders');
reset role;

-- ---------------------------------------------------------------- técnico responsável
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.service_orders) = 1, 'técnico vê só a OS atribuída a ele');
select tests.ok((select count(*) from public.service_order_events) = 1, 'técnico vê só a linha do tempo das suas OS');
select public.change_service_order_status(:'os1', 'diagnosis');
select public.change_service_order_status(:'os1', 'in_repair');
select tests.throws(format($q$select public.change_service_order_status(%L, 'delivered')$q$, :'os1'),
  '23514', 'não pula de Em reparo para Entregue');
select tests.throws(format($q$select public.change_service_order_status(%L, 'unrepairable')$q$, :'os1'),
  '23514', 'Reparo inviável exige motivo');
select public.change_service_order_status(:'os1', 'ready');
select tests.ok((select ready_at is not null from public.service_orders where id = :'os1'), 'data de pronto registrada');
select tests.throws(format($q$select public.change_service_order_status(%L, 'diagnosis')$q$, :'os2'),
  'P0002', 'técnico não altera OS sem responsável (resposta não revela a OS)');
select tests.ok(private.can_access_order(:'company_a', null) = false, 'OS sem responsável não é "minha" (sem NULL)');
select tests.throws(format($q$select public.add_service_order_note(%L, 'oi')$q$, :'os2'),
  'P0002', 'técnico não comenta em OS de outro');
select public.add_service_order_note(:'os1', 'Troquei a fonte, testando por 2h');
select tests.throws(format($q$select public.assign_service_order(%L, '00000000-0000-0000-0000-0000000000a5')$q$, :'os1'),
  '42501', 'técnico não repassa OS para outra pessoa');
select tests.ok((select count(*) from public.service_order_stats(:'company_a')) = 1, 'indicadores do técnico contam só as OS dele');
reset role;

-- ---------------------------------------------------------------- outro técnico
select tests.login('00000000-0000-0000-0000-0000000000a5');
select tests.ok((select count(*) from public.service_orders) = 0, 'técnico 2 não vê OS do técnico 1');
select tests.ok((select count(*) from public.global_search(:'company_a', 'OS 1')) = 0, 'pesquisa por número não revela OS alheia');
reset role;

-- ---------------------------------------------------------------- atendente entrega
select tests.login('00000000-0000-0000-0000-0000000000a4');
select public.change_service_order_status(:'os1', 'delivered');
select tests.ok((select delivered_at is not null from public.service_orders where id = :'os1'), 'atendente registra a entrega');
select tests.throws(format($q$select public.change_service_order_status(%L, 'closed')$q$, :'os1'),
  '42501', 'atendente não encerra a OS (só entrega)');
select tests.ok((select count(*) from public.global_search(:'company_a', '#2')) = 1, 'pesquisa global encontra OS pelo número');
reset role;

-- ---------------------------------------------------------------- admin: encerrar, reabrir, cancelar, atribuir
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.change_service_order_status(:'os1', 'closed');
select tests.throws(format($q$select public.update_service_order(%L, '{"priority":"low"}')$q$, :'os1'),
  '23514', 'OS encerrada não pode ser editada');
select tests.throws(format($q$select public.change_service_order_status(%L, 'triage')$q$, :'os1'),
  '23514', 'reabrir exige motivo');
select public.change_service_order_status(:'os1', 'triage', 'Cliente voltou: não liga de novo');
select tests.ok((select status = 'triage' and closed_at is null and delivered_at is null from public.service_orders where id = :'os1'),
  'reabertura limpa datas de entrega e encerramento');
select tests.ok(
  (select reason from public.service_order_events where order_id = :'os1' and kind = 'status' order by id desc limit 1) = 'Cliente voltou: não liga de novo',
  'motivo fica na linha do tempo');
select tests.ok(
  (select actor_id from public.service_order_events where order_id = :'os1' and to_status = 'delivered') = '00000000-0000-0000-0000-0000000000a4',
  'linha do tempo registra quem entregou');

select public.assign_service_order(:'os2', '00000000-0000-0000-0000-0000000000a5');
select tests.ok((select kind from public.service_order_events where order_id = :'os2' order by id desc limit 1) = 'assigned', 'atribuição entra na linha do tempo');
select public.change_service_order_status(:'os2', 'canceled', 'Cliente desistiu');
select tests.ok((select closed_at is not null from public.service_orders where id = :'os2'), 'cancelamento registra data');
select tests.ok((select count(*) from public.service_order_stats(:'company_a')) = 2, 'OS canceladas saem dos indicadores');
select tests.ok((select overdue from public.service_order_stats(:'company_a') where status = 'triage') = 1, 'OS com prazo vencido conta como atrasada');

select public.update_service_order(:'os_remote', '{"priority":"urgent","symptoms":"Outlook pede senha"}');
select tests.ok((select priority from public.service_orders where id = :'os_remote') = 'urgent', 'admin edita OS aberta');

select tests.ok(
  (select changes -> 'device_password_note' from public.audit_log where entity = 'service_orders' and action = 'insert' and entity_id = :'os1'::text) = '"[redacted]"'::jsonb,
  'orientação de senha fica oculta na auditoria');
select tests.throws('delete from public.service_order_events', '42501', 'linha do tempo não pode ser apagada');
reset role;
select tests.throws('update public.service_order_events set note = $$x$$', '42501', 'linha do tempo é imutável até para o dono');

-- ---------------------------------------------------------------- financeiro
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select count(*) from public.service_orders) = 3, 'financeiro vê todas as OS');
select tests.throws(format($q$select public.change_service_order_status(%L, 'diagnosis')$q$, :'os_remote'),
  '42501', 'financeiro não altera andamento');
reset role;

-- ---------------------------------------------------------------- isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.service_orders) = 0, 'Empresa B não vê OS da A');
select tests.ok((select count(*) from public.service_order_events) = 0, 'Empresa B não vê linha do tempo da A');
select tests.throws(format($q$select public.change_service_order_status(%L, 'diagnosis')$q$, :'os_remote'),
  'P0002', 'Empresa B não altera OS da A');
select tests.throws(format($q$select public.create_service_order(%L, '{"client_id":"%s","mode":"remote","reported_problem":"invasão"}')$q$, :'company_b', :'cli'),
  'P0002', 'Empresa B não abre OS para cliente da A');
reset role;

rollback;
