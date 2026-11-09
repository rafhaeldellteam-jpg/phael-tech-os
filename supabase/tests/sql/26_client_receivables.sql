-- Clientes devendo: agrupamento por cobrança, forma combinada, marcar/desmarcar parcela e cobrança inteira.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'fin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Ana Devedora","whatsapp":"11988887777"}') as ana \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Bruno Pagador"}') as bruno \gset
select public.save_equipment(:'company_a', null, format('{"client_id":"%s","type":"notebook"}', :'ana')::jsonb) as eq \gset
select public.create_service_order(:'company_a', format('{"client_id":"%s","equipment_id":"%s","reported_problem":"Tela"}', :'ana', :'eq')::jsonb) as os \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select tests.login('00000000-0000-0000-0000-0000000000a3');
select public.seed_finance_defaults(:'company_a');
select id as banco from public.finance_accounts where name = 'Conta bancária' \gset

-- Ana: troca de tela em 3x no cartão de crédito (1ª vencida); Bruno: à vista no Pix.
select public.create_finance_entry(:'company_a', format(
  '{"direction":"in","description":"Troca de tela","order_id":"%s","amount_cents":30000,"installments":3,"first_due_date":"%s","payment_method":"credit"}',
  :'os', (current_date - 10)::text)::jsonb) as g_ana \gset
select public.create_finance_entry(:'company_a', format(
  '{"direction":"in","description":"Formatação","client_id":"%s","amount_cents":15000,"first_due_date":"%s","payment_method":"pix"}',
  :'bruno', (current_date + 5)::text)::jsonb) as g_bruno \gset
select public.create_finance_entry(:'company_a', '{"direction":"out","description":"Aluguel","amount_cents":90000}');
select tests.throws(format($q$select public.create_finance_entry(%L, '{"direction":"in","description":"X yz","amount_cents":100,"payment_method":"bitcoin"}')$q$, :'company_a'),
  '22P02', 'forma de pagamento inválida é recusada');
select tests.ok((select bool_and(payment_method = 'credit') from public.finance_entries where group_id = :'g_ana'), 'forma combinada gravada em todas as parcelas');

-- ---------------------------------------------------------------- visão por cliente
select tests.ok((select count(*) from public.receivables_by_client(:'company_a')) = 2, 'duas cobranças em aberto (a pagar não entra)');
select tests.ok((select client_name = 'Ana Devedora' and client_phone = '11988887777' and description = 'Troca de tela'
                   and installment_count = 3 and total_cents = 30000 and open_cents = 30000 and overdue_cents = 10000
                   and paid_installments = 0 and payment_method = 'credit' and order_number is not null
                   and jsonb_array_length(installments) = 3
                 from public.receivables_by_client(:'company_a') where group_id = :'g_ana'), 'Ana: 3x no cartão, R$ 100 vencidos');
select tests.ok((select installment_count = 1 and overdue_cents = 0 and payment_method = 'pix'
                 from public.receivables_by_client(:'company_a') where group_id = :'g_bruno'), 'Bruno: à vista no Pix, em dia');
select tests.ok((select group_id from public.receivables_by_client(:'company_a') limit 1) = :'g_ana'::uuid, 'quem tem atraso aparece primeiro');

-- ---------------------------------------------------------------- marcar parcela
select id as a1 from public.finance_entries where group_id = :'g_ana' and installment_no = 1 \gset
select id as a2 from public.finance_entries where group_id = :'g_ana' and installment_no = 2 \gset
select public.pay_installment(:'a1', format('{"account_id":"%s","paid_at":"%s"}', :'banco', current_date)::jsonb);
select tests.ok((select status = 'paid' from public.finance_entries where id = :'a1'), 'parcela 1 paga');
select tests.ok((select method = 'credit' and amount_cents = 10000 from public.finance_payments where entry_id = :'a1'), 'pagamento usa a forma combinada e o saldo da parcela');
select tests.throws(format('select public.pay_installment(%L, %L)', :'a1', format('{"account_id":"%s"}', :'banco')), '23514', 'não paga duas vezes');
select tests.ok((select paid_installments = 1 and open_cents = 20000 and overdue_cents = 0
                 from public.receivables_by_client(:'company_a') where group_id = :'g_ana'), 'resumo: 1 de 3 paga, sem atraso');
select tests.ok((select (installments -> 0 ->> 'last_method') = 'credit' and (installments -> 0 ->> 'last_paid_at') = current_date::text
                 from public.receivables_by_client(:'company_a') where group_id = :'g_ana'), 'parcela mostra quando e como foi paga');

-- Pagamento parcial anterior + marcar paga quita só o saldo.
select public.register_payment(:'a2', format('{"account_id":"%s","method":"pix","amount_cents":4000}', :'banco')::jsonb);
select public.pay_installment(:'a2', format('{"account_id":"%s","method":"pix"}', :'banco')::jsonb);
select tests.ok((select sum(amount_cents) = 10000 and count(*) = 2 from public.finance_payments where entry_id = :'a2'), 'quita só o que faltava');

-- ---------------------------------------------------------------- desmarcar
select public.unpay_installment(:'a2');
select tests.ok((select status = 'open' and paid_cents = 0 from public.finance_entries where id = :'a2'), 'desmarcar volta a parcela para em aberto');
select tests.ok((select count(*) = 2 and bool_and(notes = 'Desmarcado como pago') from public.finance_payments where entry_id = :'a2' and reversal_of is not null),
  'cada pagamento vira um estorno registrado');
select tests.throws(format('select public.unpay_installment(%L)', :'a2'), '23514', 'nada para desmarcar');

-- ---------------------------------------------------------------- cobrança inteira
select tests.ok(public.pay_entry_group(:'g_ana', format('{"account_id":"%s","method":"debit"}', :'banco')::jsonb) = 2, 'paga as 2 parcelas restantes');
select tests.ok((select bool_and(status = 'paid') from public.finance_entries where group_id = :'g_ana'), 'cobrança da Ana quitada');
select tests.ok(not exists (select 1 from public.receivables_by_client(:'company_a') where group_id = :'g_ana'), 'some da lista de devedores');
select tests.ok(exists (select 1 from public.receivables_by_client(:'company_a', false) where group_id = :'g_ana' and paid_installments = 3), 'aparece em "todas"');
select tests.throws(format('select public.pay_entry_group(%L, %L)', :'g_ana', format('{"account_id":"%s"}', :'banco')), '23514', 'cobrança já paga');

-- ---------------------------------------------------------------- forma combinada
select public.set_entry_group_method(:'g_bruno', 'cash');
select tests.ok((select payment_method = 'cash' from public.receivables_by_client(:'company_a') where group_id = :'g_bruno'), 'troca a forma combinada');

-- Cancelada não aparece.
select id as b1 from public.finance_entries where group_id = :'g_bruno' \gset
select public.cancel_finance_entry(:'b1', 'Cliente desistiu');
select tests.ok(not exists (select 1 from public.receivables_by_client(:'company_a', false) where group_id = :'g_bruno'), 'cancelada não aparece');

-- ---------------------------------------------------------------- permissões e isolamento
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.throws(format('select * from public.receivables_by_client(%L)', :'company_a'), '42501', 'técnico não vê devedores');
select tests.throws(format('select public.unpay_installment(%L)', :'a1'), '42501', 'técnico não desmarca');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select * from public.receivables_by_client(%L)', :'company_a'), '42501', 'outra empresa não vê');
select tests.throws(format('select public.pay_entry_group(%L, %L)', :'g_ana', '{}'), '42501', 'outra empresa não paga');
select tests.throws(format('select public.set_entry_group_method(%L, %L)', :'g_bruno', 'pix'), '42501', 'outra empresa não altera');
select tests.login_anon();
select tests.throws(format('select * from public.receivables_by_client(%L)', :'company_a'), '42501', 'anônimo não vê');
reset role;

rollback;
