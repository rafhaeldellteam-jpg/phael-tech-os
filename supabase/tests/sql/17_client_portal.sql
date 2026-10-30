-- Portal do cliente: token só na criação, validade, revogação, dados expostos, aprovação/recusa e acesso anônimo.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Maria Portal Souza"}', '{"tax_id":"52998224725","internal_notes":"cliente difícil"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook","manufacturer":"Dell","model":"G15"}', :'cli')::jsonb) as eq \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Tela azul","device_password_note":"senha 1234"}', :'cli', :'eq')::jsonb) as os \gset
select public.add_order_item(:'os', '{"kind":"service","description":"Reinstalação do sistema","unit_price_cents":18000,"discount_cents":3000}'::jsonb);
select public.add_service_order_note(:'os', 'Nota interna: cliente não pode saber disso');
reset role;
insert into public.company_members (company_id, user_id, role) values (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select tests.login('00000000-0000-0000-0000-0000000000a1');
select link_id as l1, token as t1 from public.create_portal_link(:'os', 30) \gset
select tests.ok(length(:'t1') = 43 and :'t1' ~ '^[A-Za-z0-9_-]+$', 'token de 256 bits em base64url');
select tests.ok((select expires_at::date = (now() + interval '30 days')::date from public.portal_links where id = :'l1'), 'validade de 30 dias');
select tests.throws(format($q$select token_hash from public.portal_links where id = %L$q$, :'l1'), '42501', 'hash do token não é legível pela equipe');
select tests.ok(not exists (select 1 from public.portal_links where id = :'l1' and created_at is null), 'equipe lista os links da OS');
select tests.throws(format('select * from public.create_portal_link(%L, 365)', :'os'), '23514', 'validade máxima de 180 dias');

-- ---------------------------------------------------------------- acesso anônimo
select tests.login_anon();
select public.portal_order(:'t1') as doc \gset
select tests.ok((:'doc'::jsonb #>> '{order,number}')::int = 1, 'portal mostra a OS');
select tests.ok((:'doc'::jsonb ->> 'total_cents')::int = 15000, 'portal mostra o total (180 − 30)');
select tests.ok((:'doc'::jsonb ->> 'client_name') = 'Maria', 'portal mostra só o primeiro nome do cliente');
select tests.ok((:'doc'::jsonb ->> 'equipment') = 'Dell G15', 'portal mostra o equipamento');
select tests.ok(:'doc' not like '%1234%' and :'doc' not like '%Nota interna%' and :'doc' not like '%52998224725%' and :'doc' not like '%difícil%'
  and :'doc' not like '%cost%', 'portal não expõe senha, notas internas, CPF nem custos');
select tests.ok(jsonb_array_length(:'doc'::jsonb -> 'timeline') = 1, 'linha do tempo só com mudanças de status');
select tests.throws('select public.portal_order(''nao-existe-token-invalido-com-tamanho-ok-1234'')', 'P0002', 'token inexistente');
select tests.throws($q$select public.portal_order('curto')$q$, 'P0002', 'token mal formado');
select tests.throws(format($q$select public.portal_decide(%L, true, 'Maria')$q$, :'t1'), '23514', 'não decide fora de "aguardando aprovação"');
select tests.throws('select count(*) from public.portal_links', '42501', 'anônimo não lê a tabela de links');
select tests.throws(format('select * from public.create_portal_link(%L)', :'os'), '42501', 'anônimo não gera link');
select tests.throws(format($q$select * from public.service_orders where id = %L$q$, :'os'), '42501', 'anônimo não lê OS direto');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select view_count = 1 and last_viewed_at is not null from public.portal_links where id = :'l1'), 'acesso registrado');

-- ---------------------------------------------------------------- aprovação
select public.change_service_order_status(:'os', 'triage');
select public.change_service_order_status(:'os', 'awaiting_approval');
select tests.login_anon();
select tests.ok((public.portal_order(:'t1') #>> '{order,can_decide}')::boolean, 'portal oferece a decisão');
select tests.throws(format($q$select public.portal_decide(%L, true, '')$q$, :'t1'), '23514', 'nome obrigatório para decidir');
select public.portal_decide(:'t1', true, 'Maria Souza', 'Pode fazer');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select status from public.service_orders where id = :'os') = 'in_repair', 'aprovação leva para "Em reparo"');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os' and note like 'Orçamento aprovado pelo cliente no portal: Maria Souza%' and actor_id is null),
  'aprovação registrada na linha do tempo, sem usuário da equipe');
select tests.login_anon();
select tests.throws(format($q$select public.portal_decide(%L, false, 'Maria')$q$, :'t1'), '23514', 'não decide duas vezes');

-- Recusa em outra OS
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Teclado"}', :'cli', :'eq')::jsonb) as os2 \gset
select public.change_service_order_status(:'os2', 'triage');
select public.change_service_order_status(:'os2', 'awaiting_approval');
select token as t2, link_id as l2 from public.create_portal_link(:'os2', 7) \gset
select tests.login_anon();
select public.portal_decide(:'t2', false, 'Maria', 'Ficou caro');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select status from public.service_orders where id = :'os2') = 'quote_refused', 'recusa leva para "Orçamento recusado"');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os2' and to_status = 'quote_refused' and reason = 'Ficou caro'), 'motivo da recusa registrado');

-- ---------------------------------------------------------------- revogação e validade
select public.revoke_portal_link(:'l2');
select tests.login_anon();
select tests.throws(format('select public.portal_order(%L)', :'t2'), 'P0002', 'link revogado deixa de funcionar');
select tests.ok(public.portal_order(:'t1') is not null, 'outros links continuam valendo');
reset role;
update public.portal_links set expires_at = now() - interval '1 second', created_at = now() - interval '2 days' where id = :'l1';
select tests.login_anon();
select tests.throws(format('select public.portal_order(%L)', :'t1'), 'P0002', 'link vencido deixa de funcionar');

-- ---------------------------------------------------------------- permissões e isolamento
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.throws(format('select * from public.create_portal_link(%L)', :'os'), '42501', 'financeiro não compartilha OS');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select * from public.create_portal_link(%L)', :'os'), 'P0002', 'Empresa B não gera link de OS da A');
select tests.throws(format('select public.revoke_portal_link(%L)', :'l2'), 'P0002', 'Empresa B não revoga link da A');
select tests.ok((select count(*) from public.portal_links) = 0, 'Empresa B não vê links da A');
reset role;

rollback;
