-- Apagar a assinatura do cliente: cancela links, permite pedir de novo, registra tudo.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Um"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Não liga"}', :'cli', :'eq')::jsonb) as os \gset
reset role;
insert into public.company_members (company_id, user_id, role) values (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select 'data:image/png;base64,' || repeat('iVBORw0KGgo', 30) as png \gset

-- Cliente assina pelo link; há também um segundo link ainda aberto.
select tests.login('00000000-0000-0000-0000-0000000000a1');
select request_id as r1, token as t1 from public.create_signature_request(:'os', 'intake', 7) \gset
select request_id as r2, token as t2 from public.create_signature_request(:'os', 'intake', 7) \gset
select tests.login_anon();
select public.sign_by_link(:'t1', 'Cliente Um', :'png');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.sign_order(:'os', 'intake', 'company', 'Rafhael Santos', :'png');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.throws(format('select public.remove_order_signature(%L, %L, %L)', :'os', 'intake', 'client'), '42501', 'financeiro não apaga a do cliente');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select public.remove_order_signature(%L, %L, %L)', :'os', 'intake', 'client'), 'P0002', 'outra empresa não apaga');
reset role;
select tests.throws(format($q$delete from public.order_signatures where order_id = %L and signer_role = 'client'$q$, :'os'), '42501', 'ninguém apaga direto na tabela');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.remove_order_signature(:'os', 'intake', 'client');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and signer_role = 'client') = 0, 'assinatura do cliente apagada');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and signer_role = 'company') = 1, 'assinatura da empresa mantida');
select tests.ok((select signature_id is null and signed_at is not null and revoked_at is not null from public.signature_requests where id = :'r1'),
  'link usado fica no histórico, sem vínculo e cancelado');
select tests.ok((select revoked_at is not null from public.signature_requests where id = :'r2'), 'link aberto é cancelado');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os'
  and note like 'Assinatura do cliente apagada do comprovante de entrada (era de Cliente Um, assinada em %, pelo link; SHA-256 %'), 'linha do tempo registra com hash');
select tests.ok(exists (select 1 from public.audit_log where entity = 'order_signatures' and action = 'delete'), 'auditoria registra');

-- Links antigos não servem mais.
select tests.login_anon();
select tests.throws(format('select public.signature_view(%L)', :'t1'), 'P0002', 'link usado não abre mais');
select tests.throws(format($q$select public.sign_by_link(%L, 'Cliente Um', %L)$q$, :'t2', :'png'), 'P0002', 'link aberto antigo não assina');

-- Pede de novo com um link novo.
select tests.login('00000000-0000-0000-0000-0000000000a1');
select request_id as r3, token as t3 from public.create_signature_request(:'os', 'intake', 7) \gset
select tests.login_anon();
select public.sign_by_link(:'t3', 'Cliente Um', :'png');
reset role;
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and signer_role = 'client') = 1, 'cliente assina de novo pelo link novo');
select tests.ok((select signature_id is not null from public.signature_requests where id = :'r3'), 'link novo vinculado à nova assinatura');

-- Assinatura colhida no balcão também pode ser apagada.
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.remove_order_signature(:'os', 'intake', 'client');
select public.sign_order(:'os', 'intake', 'client', 'Cliente Um', :'png');
select public.remove_order_signature(:'os', 'intake', 'client');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and signer_role = 'client') = 0, 'assinatura do balcão apagada');
select tests.throws(format('select public.remove_order_signature(%L, %L, %L)', :'os', 'intake', 'client'), 'P0002', 'nada para apagar');
reset role;

rollback;
