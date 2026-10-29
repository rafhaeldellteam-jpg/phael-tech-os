-- Clientes: cadastro, validação, duplicidade, dados sensíveis, papéis, isolamento, exportação.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tecnico@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'financeiro@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atendente@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'admin@b.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
select public.create_company('Empresa B') as company_b \gset
reset role;
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');

-- ---------------------------------------------------------------- atendente cadastra
select tests.login('00000000-0000-0000-0000-0000000000a4');
select public.save_client(:'company_a', null,
  '{"kind":"person","name":"  Maria Souza ","email":"Maria@Exemplo.com","phone":"(11) 98765-4321","whatsapp":"11987654321","zip_code":"01310-100","state":"sp","marketing_consent":true}',
  '{"tax_id":"529.982.247-25"}') as maria \gset

select tests.ok((select name from public.clients where id = :'maria') = 'Maria Souza', 'nome é aparado');
select tests.ok((select email from public.clients where id = :'maria') = 'maria@exemplo.com', 'e-mail em minúsculas');
select tests.ok((select phone from public.clients where id = :'maria') = '11987654321', 'telefone só com dígitos');
select tests.ok((select state from public.clients where id = :'maria') = 'SP', 'UF em maiúsculas');
select tests.ok((select code from public.clients where id = :'maria') = 1, 'primeiro cliente recebe código 1');
select tests.ok((select has_tax_id from public.clients where id = :'maria'), 'has_tax_id indica CPF sem revelar');
select tests.ok((select consent_updated_at is not null from public.clients where id = :'maria'), 'data do consentimento registrada');
select tests.ok((select count(*) from public.client_sensitive) = 0, 'atendente NÃO lê CPF/CNPJ');

select tests.throws(format($q$select public.save_client(%L, null, '{"kind":"person","name":"Outra"}', '{"tax_id":"52998224725"}')$q$, :'company_a'),
  '23505', 'CPF duplicado na mesma empresa é bloqueado');
select tests.throws(format($q$select public.save_client(%L, null, '{"kind":"person","name":"X Y"}', '{"tax_id":"52998224724"}')$q$, :'company_a'),
  '23514', 'CPF inválido é rejeitado');
select tests.throws(format($q$select public.save_client(%L, null, '{"kind":"company","name":"Loja"}', '{"tax_id":"52998224725"}')$q$, :'company_a'),
  '23514', 'pessoa jurídica exige CNPJ');
select tests.throws(format($q$select public.save_client(%L, null, '{"kind":"person","name":"Z"}')$q$, :'company_a'),
  '23514', 'nome curto demais é rejeitado');
select tests.throws(format($q$select public.save_client(%L, null, '{"kind":"person","name":"Com email ruim","email":"nao-e-email"}')$q$, :'company_a'),
  '23514', 'e-mail inválido é rejeitado');
select tests.throws(format($q$select public.save_client(%L, %L, '{"kind":"person","name":"Maria Souza"}', '{"tax_id":"11144477735"}')$q$, :'company_a', :'maria'),
  '42501', 'atendente não altera CPF já cadastrado');
select tests.throws(format($q$select public.save_client(%L, %L, '{"kind":"person","name":"Maria Souza"}', '{"internal_notes":"x"}')$q$, :'company_a', :'maria'),
  '42501', 'atendente não grava observações internas');

select tests.ok(
  (select reason from public.find_client_duplicates(:'company_a', 'maria souza') limit 1) = 'Mesmo nome',
  'duplicidade por nome (sem acento/caixa)');
select tests.ok(
  (select reason from public.find_client_duplicates(:'company_a', 'Fulano', null, '11 98765-4321') limit 1) = 'Mesmo telefone',
  'duplicidade por telefone');
select tests.ok(
  (select reason from public.find_client_duplicates(:'company_a', 'Fulano', null, null, '529.982.247-25') limit 1) = 'Mesmo CPF/CNPJ',
  'duplicidade por CPF sem devolver o CPF');
select tests.ok(
  not exists (select 1 from public.find_client_duplicates(:'company_a', 'Maria Souza', null, null, null, :'maria')),
  'o próprio cliente é ignorado na edição');

select tests.throws('insert into public.clients (company_id, code, name) values (gen_random_uuid(), 1, $$Direto$$)',
  '42501', 'não há INSERT direto em clients');
select tests.throws(format($q$select * from public.export_clients(%L)$q$, :'company_a'), '42501', 'atendente não exporta clientes');
reset role;

-- ---------------------------------------------------------------- admin: sensível + exportação
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok((select tax_id from public.client_sensitive where client_id = :'maria') = '52998224725', 'admin lê CPF');
select public.save_client(:'company_a', :'maria', '{"kind":"person","name":"Maria Souza","marketing_consent":true}', '{"internal_notes":"Prefere atendimento à tarde"}');
select tests.ok((select tax_id from public.client_sensitive where client_id = :'maria') = '52998224725', 'gravar notas preserva o CPF');
select tests.ok(
  (select changes -> 'internal_notes' ->> 'new' from public.audit_log where entity = 'client_sensitive' and action = 'update' order by id desc limit 1) = '[redacted]',
  'observações internas ficam ocultas na auditoria');
select tests.ok(
  (select changes ->> 'tax_id' from public.audit_log where entity = 'client_sensitive' and action = 'insert' limit 1) = '[redacted]',
  'CPF fica oculto na auditoria');
select tests.ok(
  (select count(*) from public.audit_log where entity = 'client_sensitive' and entity_id = :'maria'::text) = 2,
  'histórico de dados sensíveis fica ligado ao cliente');
select tests.ok(
  not exists (select 1 from public.audit_log where changes ? 'search_text'),
  'coluna técnica search_text não polui a auditoria');
select tests.ok((select count(*) from public.export_clients(:'company_a')) = 1, 'admin exporta clientes');
select tests.ok((select tax_id from public.export_clients(:'company_a')) = '52998224725', 'exportação do admin inclui CPF');
select tests.ok(exists (select 1 from public.audit_log where action = 'export' and entity = 'clients'), 'exportação é auditada');

select public.save_client(:'company_a', null, '{"kind":"company","name":"Loja Azul Ltda","trade_name":"Loja Azul"}', '{"tax_id":"11.222.333/0001-81"}') as loja \gset
select tests.ok((select code from public.clients where id = :'loja') = 2, 'segundo cliente recebe código 2');

select public.set_client_archived(:'loja', true);
select tests.ok((select archived_at is not null from public.clients where id = :'loja'), 'cliente arquivado');
select tests.ok((select count(*) from public.export_clients(:'company_a')) = 1, 'exportação ignora arquivados por padrão');
select tests.ok((select count(*) from public.export_clients(:'company_a', true)) = 2, 'exportação pode incluir arquivados');
select public.set_client_archived(:'loja', false);
reset role;

-- ---------------------------------------------------------------- financeiro
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok((select count(*) from public.clients) = 2, 'financeiro lê clientes');
select tests.ok((select count(*) from public.client_sensitive) = 2, 'financeiro lê CPF/CNPJ');
select tests.throws(format($q$select public.save_client(%L, null, '{"kind":"person","name":"Novo"}')$q$, :'company_a'),
  '42501', 'financeiro não cadastra clientes');
reset role;

-- ---------------------------------------------------------------- técnico
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok((select count(*) from public.clients) = 2, 'técnico lê clientes');
select tests.ok((select count(*) from public.client_sensitive) = 0, 'técnico não lê CPF/CNPJ');
reset role;

-- ---------------------------------------------------------------- isolamento
select tests.login('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select count(*) from public.clients) = 0, 'Empresa B não vê clientes da A');
select tests.ok((select count(*) from public.client_sensitive) = 0, 'Empresa B não vê CPF da A');
select tests.throws(format($q$select public.save_client(%L, %L, '{"kind":"person","name":"Invadido"}')$q$, :'company_a', :'maria'),
  '42501', 'B não edita cliente da A (passando o id da A)');
select tests.throws(format($q$select public.save_client(%L, %L, '{"kind":"person","name":"Invadido"}')$q$, :'company_b', :'maria'),
  'P0002', 'B não edita cliente da A (pela própria empresa)');
select tests.throws(format('select public.set_client_archived(%L, true)', :'maria'), '42501', 'B não arquiva cliente da A');
select tests.throws(format($q$select * from public.find_client_duplicates(%L, 'Maria')$q$, :'company_a'), '42501',
  'B não consulta duplicidades da A');
select public.save_client(:'company_b', null, '{"kind":"person","name":"Maria Souza"}', '{"tax_id":"52998224725"}') as maria_b \gset
select tests.ok((select code from public.clients where id = :'maria_b') = 1, 'mesmo CPF pode existir em outra empresa, com numeração própria');
reset role;

rollback;
