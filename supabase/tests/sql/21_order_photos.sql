-- Fotos da OS: políticas do armazenamento, registro, portal, permissões e isolamento.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Foto"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Tela trincada","assigned_to":"00000000-0000-0000-0000-0000000000a2"}', :'cli', :'eq')::jsonb) as os \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Outra"}', :'cli', :'eq')::jsonb) as os_other \gset

select format('%s/%s/%s.jpg', :'company_a', :'os', gen_random_uuid()) as p1 \gset
select format('%s/%s/%s.jpg', :'company_a', :'os', gen_random_uuid()) as p2 \gset
select format('%s/%s/%s.jpg', :'company_a', :'os_other', gen_random_uuid()) as p_other \gset

-- Upload pelo Storage obedece às políticas
select tests.login('00000000-0000-0000-0000-0000000000a2');
insert into storage.objects (bucket_id, name) values ('order-photos', :'p1');
select tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('order-photos', %L)$q$, :'p_other'), '42501', 'técnico não envia foto para OS de outro');
select public.register_order_photo(:'os', :'p1', '{"stage":"intake","caption":"Tela trincada na entrada","width":1600,"height":1200,"size_bytes":250000}') as ph1 \gset
select tests.ok((select stage = 'intake' and not visible_to_client and uploaded_by = '00000000-0000-0000-0000-0000000000a2'::uuid from public.order_photos where id = :'ph1'), 'foto registrada pelo técnico');
select tests.throws(format($q$select public.register_order_photo(%L, %L, '{}')$q$, :'os', :'p2'), 'P0002', 'registro exige o arquivo no armazenamento');
select tests.throws(format($q$select public.register_order_photo(%L, %L, '{}')$q$, :'os', :'p_other'), '23514', 'caminho precisa ser da própria OS');
select tests.ok((select count(*) from storage.objects where name = :'p1') = 1, 'técnico lê a foto da OS dele');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select count(*) from storage.objects where name = :'p1') = 1, 'financeiro com acesso à OS vê a foto');
select tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('order-photos', %L)$q$, :'p2'), '42501', 'financeiro não envia foto');
select tests.throws(format($q$select public.delete_order_photo(%L)$q$, :'ph1'), 'P0002', 'financeiro não apaga foto');

-- Portal: só fotos liberadas, e o visitante só lê essas
select tests.login('00000000-0000-0000-0000-0000000000a1');
select token as tk from public.create_portal_link(:'os', 30) \gset
select tests.login_anon();
select tests.ok((select count(*) from public.portal_photos(:'tk')) = 0, 'portal sem fotos liberadas');
select tests.ok((select count(*) from storage.objects where name = :'p1') = 0, 'visitante não lê foto não liberada');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.update_order_photo(:'ph1', '{"visible_to_client":true}');
select tests.login_anon();
select tests.ok((select path from public.portal_photos(:'tk')) = :'p1', 'portal lista a foto liberada');
select tests.ok((select count(*) from storage.objects where name = :'p1') = 1, 'visitante lê só a foto liberada');
select tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('order-photos', %L)$q$, :'p2'), '42501', 'visitante não envia arquivo');

-- Apagar: primeiro o registro, depois o arquivo
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok(tests.affected(format($q$delete from storage.objects where name = %L$q$, :'p1')) = 0, 'arquivo com registro não é apagado direto');
select tests.ok(public.delete_order_photo(:'ph1') = :'p1', 'apagar devolve o caminho do arquivo');
select tests.ok(tests.affected(format($q$delete from storage.objects where name = %L$q$, :'p1')) = 1, 'depois do registro, o arquivo pode ser apagado');
select tests.ok(exists (select 1 from public.audit_log where entity = 'order_photos' and action = 'delete'), 'remoção fica na auditoria');

-- Isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format($q$insert into storage.objects (bucket_id, name) values ('order-photos', %L)$q$, :'p2'), '42501', 'Empresa B não envia foto para OS da A');
select tests.ok((select count(*) from storage.objects) = 0 and (select count(*) from public.order_photos) = 0, 'Empresa B não vê fotos da A');
reset role;

rollback;
