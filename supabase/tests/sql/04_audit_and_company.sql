-- Auditoria imutável, redação de campos sensíveis, validações e onboarding.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');

-- Sem login não cria empresa
select tests.login_anon();
reset role;
select tests.throws($q$select public.create_company('Sem login')$q$, '28000',
  'create_company exige usuário autenticado');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset

select tests.throws($q$select public.create_company('X')$q$, '23514', 'nome muito curto é rejeitado');

update public.companies set tax_id = '11222333000181', name = 'Empresa A Ltda' where id = :'company_a';
select tests.throws(
  format($q$update public.companies set tax_id = '11222333000182' where id = %L$q$, :'company_a'),
  '23514', 'CNPJ com dígito verificador errado é rejeitado');
select tests.throws(
  format($q$update public.companies set tax_id = '11111111111' where id = %L$q$, :'company_a'),
  '23514', 'CPF com dígitos repetidos é rejeitado');
select tests.throws(
  format($q$update public.companies set created_by = null where id = %L$q$, :'company_a'),
  '42501', 'created_by não é alterável pelo navegador');

select tests.ok(
  exists (select 1 from public.audit_log
           where company_id = :'company_a' and entity = 'companies' and action = 'insert'
             and actor_id = '00000000-0000-0000-0000-0000000000a1'),
  'criação da empresa foi auditada com o autor');
select tests.ok(
  exists (select 1 from public.audit_log
           where company_id = :'company_a' and entity = 'company_members' and action = 'insert'),
  'entrada do admin foi auditada');
select tests.ok(
  (select changes -> 'tax_id' ->> 'new' from public.audit_log
    where company_id = :'company_a' and entity = 'companies' and action = 'update'
    order by id desc limit 1) = '[redacted]',
  'CPF/CNPJ aparece como [redacted] na auditoria');
select tests.ok(
  (select changes -> 'name' ->> 'new' from public.audit_log
    where company_id = :'company_a' and entity = 'companies' and action = 'update'
    order by id desc limit 1) = 'Empresa A Ltda',
  'campos comuns aparecem com old/new');

select tests.throws('delete from public.audit_log', '42501', 'navegador não apaga auditoria');
select tests.throws('update public.audit_log set action = $$x$$', '42501', 'navegador não altera auditoria');
reset role;

-- Nem o superusuário altera a auditoria (trigger de imutabilidade)
select tests.throws('update public.audit_log set action = $$x$$', '42501', 'auditoria é imutável até para o dono');

-- Limite de empresas por usuário
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa 2');
select public.create_company('Empresa 3');
select tests.throws($q$select public.create_company('Empresa 4')$q$, '54000',
  'limite de 3 empresas por usuário');

-- Perfil: atualiza o próprio nome, não o de outros
select tests.ok(
  tests.affected($q$update public.profiles set full_name = 'Admin A' where id = '00000000-0000-0000-0000-0000000000a1'$q$) = 1,
  'usuário edita o próprio nome');
reset role;

rollback;
