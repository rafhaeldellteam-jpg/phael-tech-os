-- Diagnóstico com checklist e orçamento com versões (equipe e portal).
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atend@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Carlos Orçamento"}') as cli \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'cli')::jsonb) as eq \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Não carrega","assigned_to":"00000000-0000-0000-0000-0000000000a2"}', :'cli', :'eq')::jsonb) as os \gset

-- ---------------------------------------------------------------- checklist
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok(public.seed_checklist_templates(:'company_a') = 4, 'modelos sugeridos criados');
select tests.ok(public.seed_checklist_templates(:'company_a') = 0, 'repetir não duplica');
select id as tpl from public.checklist_templates where name = 'Notebook' \gset
select public.start_diagnostic(:'os', :'tpl') as dg \gset
select tests.ok((select jsonb_array_length(results) = 15 and template_name = 'Notebook' from public.order_diagnostics where id = :'dg'), 'diagnóstico copia os itens do modelo');

select tests.throws(format($q$select public.save_diagnostic(%L, %L, 'Laudo', true)$q$, :'dg',
  (select results::text from public.order_diagnostics where id = :'dg')), '23514', 'não conclui com itens sem resultado');
select tests.throws(format($q$select public.save_diagnostic(%L, '[{"label":"X","result":"talvez"}]', null)$q$, :'dg'), '23514', 'resultado inválido é rejeitado');

-- Marca tudo ok, exceto bateria (defeito) e bluetooth (não se aplica)
select jsonb_agg(jsonb_build_object('label', x ->> 'label',
  'result', case x ->> 'label' when 'Bateria segura carga' then 'fail' when 'Bluetooth' then 'na' else 'ok' end,
  'note', case x ->> 'label' when 'Bateria segura carga' then 'Desliga em 5 min' end)) as res
from public.order_diagnostics, jsonb_array_elements(results) x where id = :'dg' \gset
select public.save_diagnostic(:'dg', :'res', null);
select tests.throws(format($q$select public.save_diagnostic(%L, %L, '', true)$q$, :'dg', :'res'), '23514', 'laudo obrigatório para concluir');
select public.save_diagnostic(:'dg', :'res', 'Bateria viciada; trocar bateria.', true);
select tests.ok((select finalized_at is not null from public.order_diagnostics where id = :'dg'), 'diagnóstico concluído');
select tests.ok(exists (select 1 from public.service_order_events where order_id = :'os' and note like 'Diagnóstico concluído (Notebook, 1 item(ns) com defeito)%'), 'linha do tempo resume o diagnóstico');
select tests.throws(format($q$select public.save_diagnostic(%L, %L, 'mudar', false)$q$, :'dg', :'res'), '23514', 'diagnóstico concluído não muda');

select tests.login('00000000-0000-0000-0000-0000000000a4');
select tests.throws(format('select public.start_diagnostic(%L, %L)', :'os', :'tpl'), '42501', 'atendente sem diagnostics.write não diagnostica');

-- ---------------------------------------------------------------- orçamento
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.throws(format($q$select public.save_quote(%L, null, '{"items":[]}')$q$, :'os'), '42501', 'técnico sem quotes.write não orça');
select tests.ok((select count(*) from public.quotes) = 0, 'técnico com quotes.read vê orçamentos (nenhum ainda)');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.save_quote(:'os', null, '{"items":[{"kind":"service","description":"Troca de bateria","qty":1,"unit_price_cents":12000,"warranty_days":90},{"kind":"part","description":"Bateria compatível","qty":1,"unit_price_cents":28000,"discount_cents":3000}],"delivery_days":3,"notes":"Peça a pedir"}'::jsonb) as q1 \gset
select tests.ok((select version = 1 and status = 'draft' and total_cents = 37000 from public.quotes where id = :'q1'), 'rascunho v1 com total = 120 + 280 − 30');
select tests.throws(format($q$select public.save_quote(%L, null, '{"items":[]}')$q$, :'os'), '23505', 'um rascunho por vez');
select tests.throws(format($q$select public.save_quote(%L, %L, '{"items":[{"description":"X","qty":1,"unit_price_cents":100,"discount_cents":200}]}')$q$, :'os', :'q1'), '23514', 'desconto maior que o valor é rejeitado');
select public.save_quote(:'os', :'q1', '{"items":[{"kind":"service","description":"Troca de bateria","qty":1,"unit_price_cents":12000,"warranty_days":90},{"kind":"part","description":"Bateria compatível","qty":1,"unit_price_cents":28000}],"delivery_days":3}'::jsonb);
select tests.ok((select total_cents from public.quotes where id = :'q1') = 40000, 'rascunho editável');

select public.change_service_order_status(:'os', 'triage');
select public.change_service_order_status(:'os', 'diagnosis');
select public.send_quote(:'q1');
select tests.ok((select status = 'sent' and valid_until = current_date + 7 and sent_at is not null from public.quotes where id = :'q1'), 'enviado com validade padrão de 7 dias');
select tests.ok((select status from public.service_orders where id = :'os') = 'awaiting_approval', 'enviar leva a OS para aguardando aprovação');
select tests.throws(format($q$select public.save_quote(%L, %L, '{"items":[]}')$q$, :'os', :'q1'), '23514', 'enviado não pode ser alterado');

-- Nova versão substitui a enviada
select public.new_quote_version(:'q1') as q2 \gset
select tests.ok((select version = 2 and status = 'draft' and total_cents = 40000 from public.quotes where id = :'q2'), 'nova versão copia os itens');
select public.save_quote(:'os', :'q2', '{"items":[{"kind":"service","description":"Troca de bateria","qty":1,"unit_price_cents":12000,"warranty_days":90},{"kind":"part","description":"Bateria compatível","qty":1,"unit_price_cents":25000}],"valid_until":"2099-12-31"}'::jsonb);
select public.send_quote(:'q2');
select tests.ok((select status from public.quotes where id = :'q1') = 'superseded' and (select status from public.quotes where id = :'q2') = 'sent', 'v1 substituída pela v2');

-- Portal mostra a v2 e a decisão vale para ela
select token as tk from public.create_portal_link(:'os', 30) \gset
select tests.login_anon();
select public.portal_order(:'tk') as doc \gset
select tests.ok((:'doc'::jsonb #>> '{quote,version}')::int = 2 and (:'doc'::jsonb #>> '{quote,total_cents}')::int = 37000, 'portal mostra a versão enviada');
select tests.ok((:'doc'::jsonb #>> '{diagnosis,summary}') like 'Bateria viciada%' and (:'doc'::jsonb #> '{diagnosis,fails}') ? 'Bateria segura carga', 'portal mostra o laudo e os itens com defeito');
select public.portal_decide(:'tk', true, 'Carlos Lima', 'Pode trocar');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select status = 'approved' and decided_via = 'portal' and decided_by_name = 'Carlos Lima' from public.quotes where id = :'q2'), 'aprovado pelo portal com nome');
select tests.ok((select status from public.service_orders where id = :'os') = 'in_repair', 'OS vai para em reparo');

-- Lançar itens aprovados na OS (uma vez)
select tests.ok(public.apply_quote_items(:'q2') = 2, 'itens aprovados lançados na OS');
select tests.ok((select count(*) = 2 and sum(qty * unit_price_cents - discount_cents) = 37000 from public.service_order_items where order_id = :'os'), 'OS com os mesmos valores do orçamento');
select tests.ok((select warranty_days from public.service_order_items where order_id = :'os' and description = 'Troca de bateria') = 90, 'garantia do orçamento vai para o item');
select tests.throws(format('select public.apply_quote_items(%L)', :'q2'), '23505', 'não lança duas vezes');
select tests.throws(format('select public.apply_quote_items(%L)', :'q1'), '23514', 'versão substituída não é lançada');

-- Recusa registrada pela equipe em outra OS, e orçamento vencido
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Tela"}', :'cli', :'eq')::jsonb) as os2 \gset
select public.change_service_order_status(:'os2', 'triage');
select public.save_quote(:'os2', null, '{"items":[{"description":"Troca de tela","qty":1,"unit_price_cents":60000}],"valid_until":"2000-01-01"}'::jsonb) as q3 \gset
select public.send_quote(:'q3');
select tests.throws(format($q$select public.decide_quote_staff(%L, true, 'Carlos')$q$, :'q3'), '23514', 'orçamento vencido não é aprovado');
select tests.login('00000000-0000-0000-0000-0000000000a4');
select tests.throws(format($q$select public.decide_quote_staff(%L, false, '')$q$, :'q3'), '23514', 'nome de quem decidiu é obrigatório');
select public.decide_quote_staff(:'q3', false, 'Carlos (por telefone)', 'Achou caro');
select tests.ok((select status = 'refused' and decided_via = 'staff' from public.quotes where id = :'q3'), 'atendente registra a recusa');
select tests.ok((select status from public.service_orders where id = :'os2') = 'quote_refused', 'OS vai para orçamento recusado');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok(exists (select 1 from public.audit_log where entity = 'quotes' and entity_id = :'q3'), 'orçamento fica na auditoria');

-- ---------------------------------------------------------------- isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.quotes) + (select count(*) from public.order_diagnostics) + (select count(*) from public.checklist_templates) = 0, 'Empresa B não vê dados da A');
select tests.throws(format('select public.send_quote(%L)', :'q2'), 'P0002', 'Empresa B não mexe em orçamento da A');
select tests.throws(format('select public.start_diagnostic(%L, %L)', :'os', :'tpl'), 'P0002', 'Empresa B não diagnostica OS da A');
reset role;

rollback;
