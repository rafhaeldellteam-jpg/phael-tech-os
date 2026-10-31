-- Cobrança com Pix: dados Pix da empresa, link público com token, valores expostos, envio, permissões.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tec@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
select public.save_client(:'company_a', null, '{"kind":"person","name":"Joana Pix Lima","email":"joana@example.com"}', '{"tax_id":"52998224725"}') as cli \gset
select public.create_finance_entry(:'company_a', format('{"direction":"in","description":"Formatação","amount_cents":25000,"client_id":"%s","first_due_date":"%s"}', :'cli', current_date + 5)::jsonb);
select id as e1 from public.finance_entries where description = 'Formatação' \gset
select public.create_finance_entry(:'company_a', '{"direction":"out","description":"Aluguel","amount_cents":90000}'::jsonb);
select id as e_out from public.finance_entries where description = 'Aluguel' \gset
reset role;
insert into public.company_members (company_id, user_id, role) values (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician');
select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(format('select * from public.create_charge_link(%L)', :'e1'), '23514', 'sem chave Pix cadastrada não gera cobrança');
select tests.throws(format($q$update public.companies set pix_key = '+5511913347390' where id = %L$q$, :'company_a'), '23514', 'chave exige o tipo');
update public.companies set pix_key_type = 'phone', pix_key = '+5511913347390', pix_merchant_name = 'Phael Tech Support', pix_city = 'Sao Paulo' where id = :'company_a';

select link_id as l1, token as t1 from public.create_charge_link(:'e1', 15) \gset
select tests.ok(length(:'t1') = 43, 'token de 256 bits');
select tests.throws(format('select * from public.create_charge_link(%L)', :'e_out'), '23514', 'conta a pagar não gera cobrança');
select public.mark_charge_sent(:'l1', 'joana@example.com');
select tests.ok((select sent_to = 'joana@example.com' and sent_at is not null from public.charge_links where id = :'l1'), 'envio registrado');
select tests.throws(format('select token_hash from public.charge_links where id = %L', :'l1'), '42501', 'hash do token não é legível');

select tests.login_anon();
select public.charge_view(:'t1') as v \gset
select tests.ok((:'v'::jsonb #>> '{entry,open_cents}')::int = 25000, 'página mostra o valor em aberto');
select tests.ok((:'v'::jsonb #>> '{pix,key}') = '+5511913347390' and (:'v'::jsonb #>> '{pix,city}') = 'Sao Paulo', 'página traz os dados do Pix');
select tests.ok((:'v'::jsonb ->> 'client_name') = 'Joana', 'só o primeiro nome do cliente');
select tests.ok(:'v' not like '%52998224725%' and :'v' not like '%joana@example.com%', 'não expõe CPF nem e-mail do cliente');
select tests.throws(format($q$select public.charge_view(%L)$q$, repeat('y', 43)), 'P0002', 'token inexistente');
select tests.throws('select count(*) from public.charge_links', '42501', 'anônimo não lê a tabela');

-- Pagamento parcial reduz o valor em aberto mostrado; quitado não gera novo link.
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.seed_finance_defaults(:'company_a');
select id as acc from public.finance_accounts where company_id = :'company_a' limit 1 \gset
select public.register_payment(:'e1', format('{"account_id":"%s","method":"pix","amount_cents":10000}', :'acc')::jsonb);
select tests.login_anon();
select tests.ok((public.charge_view(:'t1') #>> '{entry,open_cents}')::int = 15000, 'valor em aberto atualizado após pagamento parcial');
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.register_payment(:'e1', format('{"account_id":"%s","method":"pix","amount_cents":15000}', :'acc')::jsonb);
select tests.throws(format('select * from public.create_charge_link(%L)', :'e1'), '23514', 'quitado não gera cobrança');
select tests.login_anon();
select tests.ok((public.charge_view(:'t1') #>> '{entry,status}') = 'paid', 'página mostra que está pago');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.revoke_charge_link(:'l1');
select tests.login_anon();
select tests.throws(format('select public.charge_view(%L)', :'t1'), 'P0002', 'link revogado deixa de funcionar');

select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.throws(format('select public.mark_charge_sent(%L, %L)', :'l1', 'x@y.z'), '42501', 'técnico não mexe em cobrança');
select tests.ok(tests.affected(format($q$update public.companies set pix_key = 'outra@chave.com', pix_key_type = 'email' where id = %L$q$, :'company_a')) = 0,
  'técnico não altera a chave Pix (RLS bloqueia)');
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.throws(format('select public.revoke_charge_link(%L)', :'l1'), 'P0002', 'Empresa B não mexe em cobrança da A');
select tests.ok((select count(*) from public.charge_links) = 0, 'Empresa B não vê links da A');
reset role;

rollback;
