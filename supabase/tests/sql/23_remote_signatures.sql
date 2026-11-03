-- Assinatura do cliente pelo link: gerar, ver, assinar uma única vez, permissões, isolamento e anon.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Maria Cliente","tax_id":null}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook","manufacturer":"Dell","model":"Vostro"}', :'cli')::jsonb) as eq \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Tela azul","device_password_note":"segredo123","internal_notes":"nota interna x"}', :'cli', :'eq')::jsonb) as os \gset
reset role;
insert into public.company_members (company_id, user_id, role) values (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select 'data:image/png;base64,' || repeat('iVBORw0KGgo', 30) as png \gset

-- ---------------------------------------------------------------- equipe gera o link
select tests.login('00000000-0000-0000-0000-0000000000a1');
select request_id as r1, token as t1 from public.create_signature_request(:'os', 'intake', 7) \gset
select tests.ok(length(:'t1') between 40 and 60, 'token em base64url de 256 bits');
select tests.ok((select expires_at > now() + interval '6 days' and signed_at is null from public.signature_requests where id = :'r1'), 'link com validade e pendente');
select tests.throws(format($q$select token_hash from public.signature_requests where id = %L$q$, :'r1'), '42501', 'hash do token não é legível pela equipe');
select tests.throws(format('select * from public.create_signature_request(%L, %L, 60)', :'os', 'intake'), '23514', 'validade máxima de 30 dias');
select tests.throws(format('select * from public.create_signature_request(%L, %L, 7)', :'os', 'delivery'), '23514', 'entrega só depois de entregar');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os' and note like 'Link de assinatura do comprovante de entrada gerado%'), 'linha do tempo registra o link');

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.throws(format('select * from public.create_signature_request(%L, %L, 7)', :'os', 'intake'), '42501', 'financeiro não gera link de assinatura');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select * from public.create_signature_request(%L, %L, 7)', :'os', 'intake'), 'P0002', 'outra empresa não gera link');
select tests.ok((select count(*) from public.signature_requests) = 0, 'outra empresa não vê os links');

-- ---------------------------------------------------------------- cliente sem login
select tests.login_anon();
select public.signature_view(:'t1') as doc \gset
select tests.ok((:'doc'::jsonb ->> 'document') = 'intake', 'documento de entrada');
select tests.ok((:'doc'::jsonb #>> '{client,name}') = 'Maria Cliente' and (:'doc'::jsonb #>> '{order,reported_problem}') = 'Tela azul', 'cliente vê os dados da OS');
select tests.ok((:'doc'::jsonb #>> '{equipment,title}') = 'Dell Vostro', 'cliente vê o equipamento');
select tests.ok(:'doc' not like '%segredo123%' and :'doc' not like '%cost%' and :'doc' not like '%nota interna x%', 'não expõe senha, custos nem notas internas');
select tests.ok(jsonb_array_length(:'doc'::jsonb -> 'signatures') = 0, 'ainda sem assinaturas');
select tests.throws('select public.signature_view(''nao-existe-token-invalido-com-tamanho-ok-1234'')', 'P0002', 'token inexistente');
select tests.throws($q$select public.signature_view('curto')$q$, 'P0002', 'token mal formado');
select tests.throws(format($q$select public.sign_by_link(%L, 'M', %L)$q$, :'t1', :'png'), '23514', 'nome obrigatório');
select tests.throws(format($q$select public.sign_by_link(%L, 'Maria Cliente', 'data:image/png;base64,abc')$q$, :'t1'), '23514', 'assinatura vazia é rejeitada');
select tests.throws(format($q$select public.sign_by_link(%L, 'Maria Cliente', %L)$q$, :'t1', 'data:image/svg+xml;base64,' || repeat('A', 300)), '23514', 'só PNG');
select tests.throws('select * from public.signature_requests', '42501', 'anon não lê os links');
select tests.throws('select * from public.order_signatures', '42501', 'anon não lê assinaturas direto');

select public.sign_by_link(:'t1', 'Maria Cliente', :'png') is not null as ok \gset
select tests.ok(:'ok'::boolean, 'cliente assina pelo link');
select tests.throws(format($q$select public.sign_by_link(%L, 'Maria Cliente', %L)$q$, :'t1', :'png'), '23505', 'não assina de novo pelo mesmo link');
select public.signature_view(:'t1') as doc2 \gset
select tests.ok((:'doc2'::jsonb #>> '{signatures,0,signer_role}') = 'client' and (:'doc2'::jsonb #>> '{signatures,0,channel}') = 'remote_link',
  'documento já mostra a assinatura do cliente');
reset role;

select tests.ok((select channel = 'remote_link' and recorded_by is null and length(image_sha256) = 64
  from public.order_signatures where order_id = :'os' and signer_role = 'client'), 'assinatura gravada como remota, com hash');
select tests.ok((select signed_at is not null and signature_id is not null from public.signature_requests where id = :'r1'), 'link marcado como assinado');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os' and note = 'Cliente assinou o comprovante de entrada pelo link: Maria Cliente'), 'linha do tempo registra a assinatura');

-- ---------------------------------------------------------------- equipe depois da assinatura
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format('select * from public.create_signature_request(%L, %L, 7)', :'os', 'intake'), '23505', 'não gera link para documento já assinado');
select tests.throws(format('select public.sign_order(%L, %L, %L, %L, %L)', :'os', 'intake', 'client', 'Outra', :'png'), '23505', 'nem colhe no balcão de novo');
select public.sign_order(:'os', 'intake', 'company', 'Rafhael Santos (Phael Tech Support)', :'png');
select tests.ok((select count(*) from public.order_signatures where order_id = :'os' and document = 'intake') = 2, 'empresa assina o mesmo documento');
reset role;
select tests.throws(format($q$update public.order_signatures set signer_name = 'Trocado' where order_id = %L$q$, :'os'), '42501', 'assinatura continua imutável');

-- ---------------------------------------------------------------- revogar e vencer
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Lento"}', :'cli', :'eq')::jsonb) as os2 \gset
select request_id as r2, token as t2 from public.create_signature_request(:'os2', 'intake', 1) \gset
select public.revoke_signature_request(:'r2');
select tests.login_anon();
select tests.throws(format('select public.signature_view(%L)', :'t2'), 'P0002', 'link revogado não abre');
select tests.throws(format($q$select public.sign_by_link(%L, 'Maria Cliente', %L)$q$, :'t2', :'png'), 'P0002', 'link revogado não assina');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
select request_id as r3, token as t3 from public.create_signature_request(:'os2', 'intake', 1) \gset
reset role;
alter table public.signature_requests disable trigger signature_requests_audit;
update public.signature_requests set created_at = now() - interval '3 days', expires_at = now() - interval '1 minute' where id = :'r3';
alter table public.signature_requests enable trigger signature_requests_audit;
select tests.login_anon();
select tests.throws(format('select public.signature_view(%L)', :'t3'), 'P0002', 'link vencido não abre');
reset role;

rollback;
