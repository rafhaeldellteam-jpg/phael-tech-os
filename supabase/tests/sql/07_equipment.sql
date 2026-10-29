-- Equipamentos: vínculo com cliente da mesma empresa, série única, acessórios, papéis, pesquisa global.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tecnico@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'financeiro@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"João Técnico Cliente"}') as joao \gset
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
select public.create_company('Empresa B') as company_b \gset
select public.save_client(:'company_b', null, '{"kind":"person","name":"Cliente da B"}') as cliente_b \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');

-- ---------------------------------------------------------------- técnico cadastra
select tests.login('00000000-0000-0000-0000-0000000000a2');
select public.save_equipment(:'company_a', null, format(
  '{"client_id":"%s","type":"notebook","manufacturer":"Dell","model":"Inspiron 15","serial_number":"ABC123","memory":"8 GB","accessories":["Carregador"," ","Mochila"]}', :'joao')::jsonb) as note \gset

select tests.ok((select code from public.equipment where id = :'note') = 1, 'primeiro equipamento recebe código 1');
select tests.ok((select accessories from public.equipment where id = :'note') = array['Carregador','Mochila'], 'acessórios vazios são descartados');
select tests.throws(format($q$select public.save_equipment(%L, null, '{"client_id":"%s","type":"desktop","serial_number":"abc123"}')$q$, :'company_a', :'joao'),
  '23505', 'número de série duplicado (sem diferenciar maiúsculas) é bloqueado');
select tests.throws(format($q$select public.save_equipment(%L, null, '{"client_id":"%s","type":"desktop"}')$q$, :'company_a', :'cliente_b'),
  'P0002', 'não vincula equipamento a cliente de outra empresa');
select tests.throws(format($q$select public.save_equipment(%L, null, '{"client_id":"%s","type":"torradeira"}')$q$, :'company_a', :'joao'),
  '23503', 'tipo inexistente é rejeitado');

select tests.ok((select count(*) from public.global_search(:'company_a', 'inspiron')) = 1, 'pesquisa global encontra equipamento pelo modelo');
select tests.ok((select count(*) from public.global_search(:'company_a', 'joao tecnico')) = 1, 'pesquisa global ignora acentos');
select tests.ok((select count(*) from public.global_search(:'company_a', 'a')) = 0, 'pesquisa exige 2+ caracteres');
reset role;

-- ---------------------------------------------------------------- financeiro
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select count(*) from public.equipment) = 0, 'financeiro não vê equipamentos (sem equipment.read)');
select tests.ok((select count(*) from public.global_search(:'company_a', 'inspiron')) = 0, 'pesquisa global respeita permissões');
select tests.ok((select count(*) from public.global_search(:'company_a', 'joao')) = 1, 'financeiro encontra clientes');
select tests.throws(format($q$select public.save_equipment(%L, null, '{"client_id":"%s","type":"desktop"}')$q$, :'company_a', :'joao'),
  '42501', 'financeiro não cadastra equipamentos');
reset role;

-- ---------------------------------------------------------------- arquivar libera a série
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.set_equipment_archived(:'note', true);
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook","serial_number":"ABC123"}', :'joao')::jsonb) as note2 \gset
select tests.ok((select code from public.equipment where id = :'note2') = 2, 'série de equipamento arquivado pode ser reutilizada');
select tests.ok(exists (select 1 from public.audit_log where entity = 'equipment' and action = 'insert'), 'equipamento é auditado');
reset role;

-- ---------------------------------------------------------------- isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.equipment) = 0, 'Empresa B não vê equipamentos da A');
select tests.throws(format('select public.set_equipment_archived(%L, false)', :'note'), '42501', 'B não altera equipamento da A');
select tests.throws(format($q$select * from public.global_search(%L, 'inspiron')$q$, :'company_a'), '42501', 'B não pesquisa na A');
select tests.throws(format($q$select public.save_equipment(%L, %L, '{"client_id":"%s","type":"desktop"}')$q$, :'company_b', :'note2', :'cliente_b'),
  'P0002', 'B não edita equipamento da A pelo id');
reset role;

-- Integridade: FK composta impede equipamento com cliente de outra empresa mesmo por SQL direto.
select tests.throws(format($q$insert into public.equipment (company_id, client_id, code, type) values (%L, %L, 99, 'other')$q$, :'company_a', :'cliente_b'),
  '23503', 'FK composta bloqueia cliente de outra empresa');

rollback;
