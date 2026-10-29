-- Garantias: prazo por item a partir da entrega, acionamento com OS de retorno, cortesia, decisão, permissões e isolamento.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Garantia"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook","manufacturer":"Dell","model":"Inspiron"}', :'cli')::jsonb) as eq \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Tela quebrada"}', :'cli', :'eq')::jsonb) as os \gset
insert into public.service_catalog (company_id, name, category, price_cents, warranty_days)
values (:'company_a', 'Troca de tela', 'hardware', 35000, 90) returning id as svc \gset
insert into public.products (company_id, sku, name, price_cents, warranty_days) values (:'company_a', 'TELA-15', 'Tela 15,6"', 40000, 180) returning id as tela \gset
select public.adjust_stock(:'tela', 'adjustment_in', 2, 'saldo inicial');
select public.add_order_item(:'os', format('{"kind":"service","catalog_id":"%s"}', :'svc')::jsonb) as it_svc \gset
select public.add_order_item(:'os', format('{"kind":"part","product_id":"%s","warranty_days":30}', :'tela')::jsonb) as it_part \gset
select public.add_order_item(:'os', '{"kind":"service","description":"Limpeza","unit_price_cents":5000}'::jsonb) as it_clean \gset

select tests.ok((select warranty_days from public.service_order_items where id = :'it_svc') = 90, 'serviço herda a garantia do catálogo');
select tests.ok((select warranty_days from public.service_order_items where id = :'it_part') = 30, 'garantia informada na inclusão substitui a do produto');
select tests.ok((select warranty_days from public.service_order_items where id = :'it_clean') is null, 'item avulso sem garantia fica sem prazo');

reset role;
insert into public.company_members (company_id, user_id, role) values (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.assign_service_order(:'os', '00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.list_warranties(:'company_a', '')) = 0, 'OS não entregue não tem garantia vigente');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"reason":"Tela piscando"}')$q$, :'os'),
  '23514', 'não aciona garantia de OS não entregue');

select public.change_service_order_status(:'os', 'triage');
select public.change_service_order_status(:'os', 'in_repair');
select public.change_service_order_status(:'os', 'ready');
select public.change_service_order_status(:'os', 'delivered');

select tests.ok((select count(*) from public.list_warranties(:'company_a', 'active')) = 2, 'dois itens com garantia vigente após a entrega');
select tests.ok((select expires_on from public.list_warranties(:'company_a', 'active') where item_id = :'it_svc')
  = (now() at time zone 'America/Sao_Paulo')::date + 90, 'garantia vence 90 dias após a entrega');
select tests.ok((select days_left from public.list_warranties(:'company_a', 'active') where item_id = :'it_part') = 30, 'dias restantes calculados');
select tests.ok((select count(*) from public.list_warranties(:'company_a', 'expiring')) = 0, 'nenhuma vence nos próximos 15 dias');
select tests.ok((select count(*) from public.list_warranties(:'company_a', 'active', 'inspiron')) = 0, 'busca não casa por modelo (só cliente, item e série)');
select tests.ok((select count(*) from public.list_warranties(:'company_a', 'active', 'garantia')) = 2, 'busca pelo nome do cliente, sem acento/caixa');
select tests.ok((select equipment_label from public.list_warranties(:'company_a', 'active') limit 1) = 'Dell Inspiron', 'mostra o equipamento');
select tests.throws(format($q$select * from public.list_warranties(%L, 'qualquer')$q$, :'company_a'), '22023', 'filtro inválido é rejeitado');

-- ---------------------------------------------------------------- permissões
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.list_warranties(:'company_a', 'active')) = 2, 'técnico vê garantias das OS atribuídas a ele');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"reason":"Tela piscando"}')$q$, :'os'),
  '42501', 'técnico sem orders.create não abre acionamento');
select tests.throws(format($q$insert into public.warranty_claims (company_id, number, original_order_id, return_order_id, reason, covered)
  values (%L, 1, %L, %L, 'direto pela API', true)$q$, :'company_a', :'os', :'os'), '42501', 'acionamento não é gravado direto na tabela');

-- ---------------------------------------------------------------- acionamento coberto
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"reason":"x"}')$q$, :'os'), '23514', 'motivo é obrigatório');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"item_id":"%s","reason":"Sem garantia"}')$q$, :'os', :'it_clean'),
  '23514', 'item sem garantia exige cortesia');
select claim_id as c1, return_order_id as ret1
from public.open_warranty_claim(:'os', format('{"item_id":"%s","reason":"Tela voltou a piscar"}', :'it_svc')::jsonb) \gset
select tests.ok((select covered and status = 'open' and courtesy_reason is null from public.warranty_claims where id = :'c1'), 'acionamento dentro do prazo fica coberto e aberto');
select tests.ok((select warranty_of = :'os'::uuid and status = 'received' and priority = 'high' and client_id = :'cli'::uuid and equipment_id = :'eq'::uuid
  from public.service_orders where id = :'ret1'), 'OS de retorno nasce vinculada, recebida, com prioridade alta e mesmo cliente/equipamento');
select tests.ok((select assigned_to = '00000000-0000-0000-0000-0000000000a2'::uuid from public.service_orders where id = :'ret1'), 'retorno vai para o mesmo técnico');
select tests.ok((select reported_problem like 'Garantia da OS %: Tela voltou a piscar' from public.service_orders where id = :'ret1'), 'problema relatado cita a OS original');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os' and note like 'Garantia acionada:%'), 'histórico da OS original registra o acionamento');
select tests.ok((select open_claims from public.list_warranties(:'company_a', 'active') where item_id = :'it_svc') = 1, 'lista mostra acionamento em andamento');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"item_id":"%s","reason":"De novo a tela"}')$q$, :'os', :'it_svc'),
  '23505', 'não duplica acionamento em andamento do mesmo item');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"reason":"Retorno do retorno"}')$q$, :'ret1'),
  '23514', 'retorno de garantia não gera outro retorno');
select tests.ok((select open_claims from public.warranty_stats(:'company_a')) = 1, 'painel conta acionamento em andamento');

-- ---------------------------------------------------------------- decisão
select tests.throws(format($q$select public.decide_warranty_claim(%L, 'denied', '')$q$, :'c1'), '23514', 'negar exige motivo');
select tests.throws(format($q$select public.decide_warranty_claim(%L, 'resolved')$q$, :'c1'), '23514', 'não resolve sem aceitar antes');
select public.decide_warranty_claim(:'c1', 'accepted', 'Defeito na peça trocada');
select tests.ok((select status = 'accepted' and decided_at is not null from public.warranty_claims where id = :'c1'), 'acionamento aceito');
select tests.throws(format($q$select public.decide_warranty_claim(%L, 'denied', 'mudou de ideia')$q$, :'c1'), '23514', 'aceito não volta para negado');
select public.decide_warranty_claim(:'c1', 'resolved', 'Tela substituída sem custo');
select tests.ok((select status = 'resolved' and resolution = 'Tela substituída sem custo' from public.warranty_claims where id = :'c1'), 'acionamento resolvido com registro');
select tests.ok((select open_claims from public.warranty_stats(:'company_a')) = 0, 'resolvido sai da contagem');
select tests.ok(exists (select 1 from public.audit_log where entity = 'warranty_claims' and entity_id = :'c1'), 'acionamento fica na auditoria');

-- ---------------------------------------------------------------- vencida e cortesia
reset role;
update public.service_orders set delivered_at = now() - interval '100 days' where id = :'os';
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select count(*) from public.list_warranties(:'company_a', 'expired')) = 2, 'após 100 dias as duas garantias venceram');
select tests.ok((select count(*) from public.list_warranties(:'company_a', 'active')) = 0, 'nada vigente');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"item_id":"%s","reason":"Tela piscando de novo"}')$q$, :'os', :'it_svc'),
  '23514', 'fora do prazo sem cortesia é recusado');
select claim_id as c2 from public.open_warranty_claim(:'os',
  format('{"item_id":"%s","reason":"Tela piscando de novo","courtesy_reason":"Cliente antigo, atender sem custo"}', :'it_svc')::jsonb) \gset
select tests.ok((select not covered and courtesy_reason is not null and expires_on is not null from public.warranty_claims where id = :'c2'), 'cortesia fica registrada como não coberta');
select public.decide_warranty_claim(:'c2', 'denied', 'Dano por queda, não coberto');
select tests.ok((select status from public.warranty_claims where id = :'c2') = 'denied', 'acionamento negado com motivo');

-- ---------------------------------------------------------------- isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format($q$select * from public.list_warranties(%L)$q$, :'company_a'), '42501', 'Empresa B não lista garantias da A');
select tests.throws(format($q$select * from public.warranty_stats(%L)$q$, :'company_a'), '42501', 'Empresa B não vê contagem da A');
select tests.ok((select count(*) from public.warranty_claims) = 0, 'Empresa B não enxerga acionamentos da A');
select tests.throws(format($q$select * from public.open_warranty_claim(%L, '{"reason":"Invasão"}')$q$, :'os'), 'P0002', 'Empresa B não aciona garantia da A');
select tests.throws(format($q$select public.decide_warranty_claim(%L, 'accepted')$q$, :'c2'), 'P0002', 'Empresa B não decide acionamento da A');

select tests.login_anon();
select tests.throws(format($q$select * from public.list_warranties(%L)$q$, :'company_a'), '42501', 'anônimo não executa list_warranties');
reset role;

rollback;
