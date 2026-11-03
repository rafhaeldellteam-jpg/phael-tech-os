-- Apagar a assinatura da empresa (só pela função), cliente continua imutável, assinatura salva.
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

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.sign_order(:'os', 'intake', 'company', 'Rafhael Santos', :'png');
select public.sign_order(:'os', 'intake', 'client', 'Cliente Um', :'png');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.throws(format('select public.remove_order_signature(%L, %L, %L)', :'os', 'intake', 'company'), '42501', 'financeiro não apaga assinatura');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select public.remove_order_signature(%L, %L, %L)', :'os', 'intake', 'company'), 'P0002', 'outra empresa não apaga');

reset role;
select tests.throws(format($q$delete from public.order_signatures where order_id = %L and signer_role = 'company'$q$, :'os'), '42501', 'nem o dono do banco apaga direto');
select tests.throws(format($q$delete from public.order_signatures where order_id = %L and signer_role = 'client'$q$, :'os'), '42501', 'assinatura do cliente segue imutável');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format($q$delete from public.order_signatures where order_id = %L$q$, :'os'), '42501', 'equipe não apaga pela tabela');
select public.remove_order_signature(:'os', 'intake', 'company');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and signer_role = 'company') = 0, 'assinatura da empresa apagada');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and signer_role = 'client') = 1, 'assinatura do cliente mantida');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os' and note like 'Assinatura da empresa apagada do comprovante de entrada (era de Rafhael Santos%'), 'linha do tempo registra');
select tests.ok(exists (select 1 from public.audit_log where entity = 'order_signatures' and action = 'delete'), 'auditoria registra');
select tests.throws(format('select public.remove_order_signature(%L, %L, %L)', :'os', 'intake', 'company'), 'P0002', 'sem assinatura para apagar');
select public.sign_order(:'os', 'intake', 'company', 'Rafhael Santos', :'png');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and signer_role = 'company') = 1, 'pode assinar de novo');
reset role;
select tests.ok(current_setting('phael.removing_company_signature', true) is distinct from (select id::text from public.order_signatures where order_id = :'os' and signer_role = 'company'),
  'liberação não fica valendo depois da função');

-- Assinatura salva
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.save_my_signature(:'company_a', 'Rafhael Santos', :'png');
select tests.ok((select count(*) from public.member_signatures) = 1, 'assinatura salva');
select public.delete_my_signature(:'company_a');
select tests.ok((select count(*) from public.member_signatures) = 0, 'assinatura salva apagada');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select public.delete_my_signature(%L)', :'company_a'), '42501', 'só membro apaga');
reset role;

rollback;
