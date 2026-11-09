-- Marcar como pago sem conta: usa a conta Caixa (criada se não existir).
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Ana"}') as ana \gset
select public.create_finance_entry(:'company_a', format(
  '{"direction":"in","description":"Formatação","client_id":"%s","amount_cents":20000,"installments":2,"payment_method":"pix"}', :'ana')::jsonb) as g \gset
select id as e1 from public.finance_entries where group_id = :'g' and installment_no = 1 \gset

select tests.ok((select count(*) from public.finance_accounts) = 0, 'empresa ainda sem nenhuma conta');
select public.pay_installment(:'e1', '{}');
select tests.ok((select count(*) = 1 and bool_and(name = 'Caixa' and kind = 'cash' and active) from public.finance_accounts), 'cria a conta Caixa sozinha');
select tests.ok((select status = 'paid' from public.finance_entries where id = :'e1'), 'parcela paga sem escolher conta');
select tests.ok((select method = 'pix' and paid_at = current_date from public.finance_payments where entry_id = :'e1'), 'forma combinada e data de hoje');

select public.pay_entry_group(:'g', format('{"method":"credit","paid_at":"%s"}', current_date - 1)::jsonb);
select tests.ok((select count(*) from public.finance_accounts) = 1, 'reaproveita a mesma conta');
select tests.ok((select method = 'credit' and paid_at = current_date - 1 from public.finance_payments p join public.finance_entries e on e.id = p.entry_id
                 where e.group_id = :'g' and e.installment_no = 2), 'forma e data informadas valem');

select public.create_finance_entry(:'company_a', format('{"direction":"in","description":"Backup","client_id":"%s","amount_cents":8000}', :'ana')::jsonb) as g3 \gset
select id as e3 from public.finance_entries where group_id = :'g3' \gset
select public.register_payment(:'e3', '{"amount_cents":3000,"method":"cash"}');
select tests.ok((select status = 'partial' and paid_cents = 3000 from public.finance_entries where id = :'e3'), 'pagamento parcial sem conta também funciona');

-- Conta Caixa desativada é reativada em vez de duplicar.
reset role;
update public.finance_accounts set active = false;
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_finance_entry(:'company_a', format('{"direction":"in","description":"Limpeza","client_id":"%s","amount_cents":5000}', :'ana')::jsonb) as g2 \gset
select public.pay_entry_group(:'g2', '{}');
select tests.ok((select count(*) = 1 and bool_and(active) from public.finance_accounts), 'reativa a Caixa');
reset role;

rollback;
