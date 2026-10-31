-- Importação do relatório do Provision e controle de uso da IA.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"company","name":"Escritório X"}') as cli \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Outro"}') as cli2 \gset
reset role;
insert into public.company_members (company_id, user_id, role) values (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select '{"type":"notebook","file_name":"Provisionamento-DESKTOP-1-20261029-1435.txt","provisioned_at":"2026-10-29T14:35:00","hostname":"DESKTOP-1","summary":{"board":"Dell 0T7V1P"},"log":"[14:01] Office instalado","fields":{"manufacturer":"Dell","model":"Latitude 5440","serial_number":"7XK2LM3","processor":"i5-1335U","memory":"16 GB","storage":"512 GB","operating_system":"Windows 11 Pro"}}' as rep \gset

-- ---------------------------------------------------------------- Provision
select tests.login('00000000-0000-0000-0000-0000000000a1');
select equipment_id as eq, created as c1 from public.import_provision_report(:'company_a', :'cli', :'rep') \gset
select tests.ok(:'c1'::boolean, 'cria o equipamento novo');
select tests.ok((select manufacturer = 'Dell' and model = 'Latitude 5440' and processor = 'i5-1335U' and client_id = :'cli'::uuid and type = 'notebook'
  from public.equipment where id = :'eq'), 'ficha preenchida com os dados do relatório');
select tests.ok((select count(*) = 1 and min(hostname) = 'DESKTOP-1' from public.equipment_provisionings where equipment_id = :'eq'), 'provisionamento registrado');

select created as c2 from public.import_provision_report(:'company_a', :'cli', :'rep') \gset
select tests.ok(not :'c2'::boolean, 'mesmo número de série atualiza o equipamento existente');
select tests.ok((select count(*) from public.equipment_provisionings where equipment_id = :'eq') = 1, 'reimportar o mesmo relatório não duplica');
select public.import_provision_report(:'company_a', :'cli', jsonb_set(jsonb_set(:'rep'::jsonb, '{provisioned_at}', '"2026-11-15T10:00:00"'), '{fields,memory}', '"32 GB"'));
select tests.ok((select memory from public.equipment where id = :'eq') = '32 GB', 'novo provisionamento atualiza a memória');
select tests.ok((select count(*) from public.equipment_provisionings where equipment_id = :'eq') = 2, 'histórico com os dois provisionamentos');
select tests.throws(format('select * from public.import_provision_report(%L, %L, %L)', :'company_a', :'cli2', :'rep'), '23505', 'série de outro cliente é recusada');
select tests.throws(format($q$select * from public.import_provision_report(%L, %L, '{"fields":{}}')$q$, :'company_a', :'cli'), '23514', 'relatório sem série é recusado');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.throws(format('select * from public.import_provision_report(%L, %L, %L)', :'company_a', :'cli', :'rep'), '42501', 'financeiro não importa equipamento');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select * from public.import_provision_report(%L, %L, %L)', :'company_a', :'cli', :'rep'), '42501', 'Empresa B não importa na A');
select tests.ok((select count(*) from public.equipment_provisionings) = 0, 'Empresa B não vê provisionamentos da A');

-- ---------------------------------------------------------------- IA
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Lento"}', :'cli', :'eq')::jsonb) as os \gset
select public.ai_begin(:'company_a', 'diagnosis', :'os') as r1 \gset
select public.ai_finish(:'r1', true, 800, 200, null);
select tests.ok((select ok and input_tokens = 800 and finished_at is not null from public.ai_requests where id = :'r1'), 'uso registrado');
reset role;
update public.companies set ai_daily_limit = 1 where id = :'company_a';
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format('select public.ai_begin(%L, %L, %L)', :'company_a', 'client_message', :'os'), '23514', 'limite diário respeitado');
select tests.throws(format('select public.ai_begin(%L, %L, %L)', :'company_a', 'invalida', :'os'), '23514', 'tarefa desconhecida é rejeitada');
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.throws(format('select public.ai_begin(%L, %L, %L)', :'company_a', 'diagnosis', :'os'), '42501', 'sem permissão de diagnóstico não pede laudo à IA');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select public.ai_begin(%L, %L, %L)', :'company_a', 'client_message', :'os'), '42501', 'Empresa B não usa a IA da A');
select tests.login_anon();
select tests.throws(format('select public.ai_begin(%L, %L, %L)', :'company_a', 'client_message', :'os'), '42501', 'anônimo não usa a IA');
reset role;

rollback;
