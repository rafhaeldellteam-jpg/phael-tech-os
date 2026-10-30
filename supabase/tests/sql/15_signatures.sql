-- Assinatura eletrônica da OS: uma por papel e documento, imutável, entrega só após entregar, permissões e isolamento.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Assina"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Não liga"}', :'cli', :'eq')::jsonb) as os \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select 'data:image/png;base64,' || repeat('iVBORw0KGgo', 30) as png \gset

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.sign_order(:'os', 'intake', 'client', 'Cliente Assina', :'png') as s1 \gset
select tests.ok((select signer_role = 'client' and document = 'intake' and length(image_sha256) = 64 and recorded_by = '00000000-0000-0000-0000-0000000000a1'::uuid
  from public.order_signatures where id = :'s1'), 'assinatura do cliente gravada com hash e autor');
select tests.throws(format('select public.sign_order(%L, %L, %L, %L, %L)', :'os', 'intake', 'client', 'Outra pessoa', :'png'), '23505', 'cliente assina o mesmo documento uma vez');
select public.sign_order(:'os', 'intake', 'company', 'Phael Tech Support', :'png');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os') = 2, 'empresa assina o mesmo documento');
select tests.throws(format('select public.sign_order(%L, %L, %L, %L, %L)', :'os', 'delivery', 'client', 'Cliente Assina', :'png'), '23514', 'entrega só depois de entregar');
select tests.throws(format('select public.sign_order(%L, %L, %L, %L, %L)', :'os', 'intake', 'company', 'X', :'png'), '23514', 'nome do signatário obrigatório');
select tests.throws(format($q$select public.sign_order(%L, 'delivery', 'company', 'Nome', 'data:image/png;base64,abc')$q$, :'os'), '23514', 'assinatura vazia é rejeitada');
select tests.throws(format($q$select public.sign_order(%L, 'intake', 'client', 'Nome', %L)$q$, :'os', 'data:image/svg+xml;base64,' || repeat('A', 300)), '23514', 'só PNG é aceito');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os' and note like 'Assinatura do cliente colhida%'), 'linha do tempo registra a assinatura');
select tests.ok((select changes::text not like '%base64%' from public.audit_log where entity = 'order_signatures' limit 1), 'auditoria não guarda a imagem');

reset role;
select tests.throws(format($q$update public.order_signatures set signer_name = 'Trocado' where id = %L$q$, :'s1'), '42501', 'assinatura não pode ser alterada nem pelo dono do banco');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format($q$delete from public.order_signatures where id = %L$q$, :'s1'), '42501', 'assinatura não é apagada pelo navegador');
select tests.throws(format($q$insert into public.order_signatures (company_id, order_id, document, signer_role, signer_name, image_data, image_sha256) values (%L, %L, 'delivery', 'client', 'Direto', %L, 'x')$q$,
  :'company_a', :'os', :'png'), '42501', 'assinatura não é gravada direto na tabela');

-- Entrega
select public.change_service_order_status(:'os', 'triage');
select public.change_service_order_status(:'os', 'in_repair');
select public.change_service_order_status(:'os', 'ready');
select tests.login('00000000-0000-0000-0000-0000000000a4');
select public.change_service_order_status(:'os', 'delivered');
select public.sign_order(:'os', 'delivery', 'client', 'Cliente Assina', :'png');
select tests.ok((select count(*) from public.order_signatures where document = 'delivery') = 1, 'atendente colhe assinatura de entrega');

-- Assinatura salva do membro
select public.save_my_signature(:'company_a', 'Atendente A', :'png');
select public.save_my_signature(:'company_a', 'Atendente A (nova)', :'png');
select tests.ok((select count(*) = 1 and min(signer_name) = 'Atendente A (nova)' from public.member_signatures), 'assinatura salva é única por pessoa e atualiza');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select count(*) from public.member_signatures) = 0, 'cada um só vê a própria assinatura salva');

-- Permissões e isolamento
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.throws(format('select public.sign_order(%L, %L, %L, %L, %L)', :'os', 'delivery', 'company', 'Financeiro', :'png'), '42501', 'financeiro não colhe assinatura');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.order_signatures) = 0, 'Empresa B não vê assinaturas da A');
select tests.throws(format('select public.sign_order(%L, %L, %L, %L, %L)', :'os', 'delivery', 'company', 'Invasor', :'png'), 'P0002', 'Empresa B não assina OS da A');
select tests.throws(format('select public.save_my_signature(%L, %L, %L)', :'company_a', 'Invasor', :'png'), '42501', 'Empresa B não salva assinatura na A');
select tests.login_anon();
select tests.throws(format('select public.sign_order(%L, %L, %L, %L, %L)', :'os', 'delivery', 'company', 'Anon', :'png'), '42501', 'anônimo não assina');
reset role;

rollback;
