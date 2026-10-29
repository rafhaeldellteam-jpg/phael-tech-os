-- Catálogo, fornecedores, estoque (saldo, custo médio, ajustes), compras e itens da OS.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Cliente Um"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

-- ---------------------------------------------------------------- catálogo
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok(public.seed_service_catalog(:'company_a') = 16, 'serviços sugeridos são criados');
select tests.ok(public.seed_service_catalog(:'company_a') = 0, 'repetir não duplica os sugeridos');
select tests.ok((select bool_and(price_cents = 0) from public.service_catalog), 'sugeridos nascem sem preço (cada empresa define)');
insert into public.service_catalog (company_id, name, category, price_cents, cost_cents, warranty_days)
values (:'company_a', 'Troca de tela', 'hardware', 35000, 0, 90) returning id as svc \gset
select tests.throws(format($q$insert into public.service_catalog (company_id, name) values (%L, 'troca de TELA')$q$, :'company_a'),
  '23505', 'nome de serviço não se repete (sem diferenciar maiúsculas)');
select tests.throws(format($q$update public.service_catalog set price_cents = -1 where id = %L$q$, :'svc'),
  '23514', 'preço negativo é rejeitado');

-- ---------------------------------------------------------------- fornecedor e produtos
insert into public.suppliers (company_id, name, tax_id) values (:'company_a', 'Distribuidora X', '11222333000181') returning id as sup \gset
insert into public.products (company_id, sku, name, supplier_id, price_cents, min_qty, cost_cents)
values (:'company_a', 'SSD-240', 'SSD 240 GB', :'sup', 22000, 2, 0) returning id as ssd \gset
insert into public.products (company_id, sku, name, price_cents, tracks_serial)
values (:'company_a', 'RAM-8', 'Memória 8 GB', 18000, true) returning id as ram \gset
select tests.throws(format($q$insert into public.products (company_id, sku, name) values (%L, 'ssd-240', 'Duplicado')$q$, :'company_a'),
  '23505', 'SKU não se repete');
select tests.throws(format($q$insert into public.products (company_id, sku, name, qty_on_hand) values (%L, 'X1', 'Com saldo', 10)$q$, :'company_a'),
  '42501', 'produto não nasce com saldo pelo navegador');
select tests.throws(format($q$update public.products set qty_on_hand = 99 where id = %L$q$, :'ssd'),
  '42501', 'saldo não é editável pelo navegador');
select tests.throws(format($q$update public.products set cost_cents = 1 where id = %L$q$, :'ssd'),
  '42501', 'custo médio não é editável pelo navegador');

-- ---------------------------------------------------------------- compra e custo médio
select public.save_purchase(:'company_a', null, format(
  '{"supplier_id":"%s","items":[{"product_id":"%s","qty":2,"unit_cost_cents":10000},{"product_id":"%s","qty":3,"unit_cost_cents":9000}]}',
  :'sup', :'ssd', :'ram')::jsonb) as p1 \gset
select tests.ok((select qty_on_hand from public.products where id = :'ssd') = 0, 'rascunho de compra não mexe no estoque');
select public.receive_purchase(:'p1');
select tests.ok((select qty_on_hand from public.products where id = :'ssd') = 2, 'receber compra dá entrada no estoque');
select tests.ok((select cost_cents from public.products where id = :'ssd') = 10000, 'custo médio inicial = custo da compra');
select tests.throws(format('select public.receive_purchase(%L)', :'p1'), '23514', 'compra não é recebida duas vezes');
select tests.throws(format($q$select public.save_purchase(%L, %L, '{"supplier_id":"%s","items":[{"product_id":"%s","qty":1,"unit_cost_cents":1}]}')$q$,
  :'company_a', :'p1', :'sup', :'ssd'), '23514', 'compra recebida não pode ser alterada');
select tests.throws(format('select public.cancel_purchase(%L)', :'p1'), '23514', 'compra recebida não é cancelada');

select public.save_purchase(:'company_a', null, format('{"supplier_id":"%s","items":[{"product_id":"%s","qty":2,"unit_cost_cents":13000}]}', :'sup', :'ssd')::jsonb) as p2 \gset
select public.receive_purchase(:'p2');
select tests.ok((select cost_cents from public.products where id = :'ssd') = 11500, 'custo médio ponderado: (2×100 + 2×130) / 4 = 115,00');
select tests.ok((select qty_on_hand from public.products where id = :'ssd') = 4, 'saldo acumula as compras');

-- ---------------------------------------------------------------- ajustes
select tests.throws(format($q$select public.adjust_stock(%L, 'adjustment_out', 1, '')$q$, :'ssd'), '23514', 'ajuste exige motivo');
select tests.throws(format($q$select public.adjust_stock(%L, 'adjustment_out', 99, 'perda')$q$, :'ssd'), '23514', 'não deixa o saldo negativo');
select tests.throws(format($q$select public.adjust_stock(%L, 'purchase_in', 5, 'fura compra')$q$, :'ssd'), '22023', 'entrada só por compra');
select public.adjust_stock(:'ssd', 'adjustment_out', 1, 'Chegou com defeito');
select tests.ok((select qty_on_hand from public.products where id = :'ssd') = 3, 'ajuste de saída baixa o saldo');
select tests.ok((select cost_cents from public.products where id = :'ssd') = 11500, 'saída não altera custo médio');
select tests.ok((select balance_after from public.stock_movements where product_id = :'ssd' order by id desc limit 1) = 3,
  'movimentação guarda o saldo após');
select tests.ok(public.low_stock_count(:'company_a') = 0, 'acima do mínimo não alerta');
reset role;
select tests.throws('update public.stock_movements set qty = 1', '42501', 'movimentações são imutáveis');

-- ---------------------------------------------------------------- itens da OS
select tests.login('00000000-0000-0000-0000-0000000000a4');
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Lento","assigned_to":"00000000-0000-0000-0000-0000000000a2"}', :'cli', :'eq')::jsonb) as os \gset
select tests.throws(format($q$select public.add_order_item(%L, '{"kind":"service","description":"x y","unit_price_cents":100}')$q$, :'os'),
  '42501', 'atendente não lança serviços na OS');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
select public.add_order_item(:'os', format('{"kind":"service","catalog_id":"%s"}', :'svc')::jsonb) as item_svc \gset
select tests.ok((select unit_price_cents from public.service_order_items where id = :'item_svc') = 35000, 'serviço do catálogo traz o preço');
select tests.ok((select warranty_days from public.service_order_items where id = :'item_svc') = 90, 'serviço do catálogo traz a garantia');
select public.add_order_item(:'os', format('{"kind":"part","product_id":"%s","qty":2,"discount_cents":4000}', :'ssd')::jsonb) as item_ssd \gset
select tests.ok((select qty_on_hand from public.products where id = :'ssd') = 1, 'peça lançada na OS baixa o estoque');
select tests.ok((select unit_cost_cents from public.service_order_items where id = :'item_ssd') = 11500, 'item guarda o custo real do momento');
select tests.ok((select unit_price_cents from public.service_order_items where id = :'item_ssd') = 22000, 'item guarda o preço cobrado');
select tests.ok(public.low_stock_count(:'company_a') = 1, 'abaixo do mínimo gera alerta de reposição');
select tests.throws(format($q$select public.add_order_item(%L, '{"kind":"part","product_id":"%s","qty":5}')$q$, :'os', :'ssd'),
  '23514', 'não lança mais peças do que há em estoque');
select tests.ok((select count(*) from public.service_order_items where order_id = :'os') = 2, 'falha de estoque não deixa item órfão');
select tests.throws(format($q$select public.add_order_item(%L, '{"kind":"part","product_id":"%s"}')$q$, :'os', :'ram'),
  '23514', 'peça controlada por série exige o número de série');
select public.add_order_item(:'os', format('{"kind":"part","product_id":"%s","serial_number":"RAM-SN-1"}', :'ram')::jsonb);

select tests.ok((select total_cents from public.service_order_totals(:'os')) = 35000 + 44000 - 4000 + 18000, 'total = serviços + peças - desconto');
select tests.ok((select cost_cents from public.service_order_totals(:'os')) is null, 'técnico não vê custo nem margem');

select tests.throws(format($q$select public.remove_order_item(%L, '')$q$, :'item_ssd'), '23514', 'remover item exige motivo');
select public.remove_order_item(:'item_ssd', 'Cliente preferiu HD');
select tests.ok((select qty_on_hand from public.products where id = :'ssd') = 3, 'peça removida volta ao estoque');
select tests.ok((select returned_at is not null from public.service_order_items where id = :'item_ssd'), 'item removido fica registrado (não é apagado)');
select tests.throws(format($q$select public.remove_order_item(%L, 'de novo')$q$, :'item_ssd'), '23514', 'item não é removido duas vezes');
select tests.ok((select total_cents from public.service_order_totals(:'os')) = 35000 + 18000, 'total ignora itens removidos');
select tests.throws('insert into public.products (company_id, sku, name) values (gen_random_uuid(), $$T1$$, $$Técnico$$)', '42501',
  'técnico não cadastra produtos');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select cost_cents from public.service_order_totals(:'os')) = 9000, 'financeiro vê o custo real (memória)');
select tests.ok((select margin_cents from public.service_order_totals(:'os')) = 53000 - 9000, 'margem = total - custo');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.change_service_order_status(:'os', 'canceled', 'Desistiu');
select tests.throws(format($q$select public.add_order_item(%L, '{"kind":"service","description":"depois","unit_price_cents":1}')$q$, :'os'),
  '23514', 'OS encerrada não aceita itens');
reset role;

-- ---------------------------------------------------------------- isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.products) = 0, 'Empresa B não vê produtos da A');
select tests.ok((select count(*) from public.service_catalog) = 0, 'Empresa B não vê catálogo da A');
select tests.ok((select count(*) from public.stock_movements) = 0, 'Empresa B não vê movimentações da A');
select tests.ok((select count(*) from public.service_order_items) = 0, 'Empresa B não vê itens de OS da A');
select tests.throws(format($q$select public.adjust_stock(%L, 'adjustment_out', 1, 'roubo')$q$, :'ssd'), '42501', 'Empresa B não mexe no estoque da A');
select tests.throws(format($q$insert into public.products (company_id, sku, name) values (%L, 'INV', 'Invasão')$q$, :'company_a'),
  '42501', 'Empresa B não cadastra produto na A');
reset role;

rollback;
