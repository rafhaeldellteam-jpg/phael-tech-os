-- Isolamento entre empresas e bloqueio de acesso direto.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'ana@empresa-a.test', 'Ana');
select tests.create_user('00000000-0000-0000-0000-0000000000b1', 'bruno@empresa-b.test', 'Bruno');
select tests.create_user('00000000-0000-0000-0000-0000000000c1', 'carla@sem-empresa.test', 'Carla');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
reset role;

select tests.create_company_as('00000000-0000-0000-0000-0000000000b1', 'Empresa B') as company_b \gset

-- ---------------------------------------------------------------- Ana (A)
select tests.login('00000000-0000-0000-0000-0000000000a1');

select tests.ok((select count(*) from public.companies) = 1, 'Ana vê apenas 1 empresa');
select tests.ok((select id from public.companies) = :'company_a', 'a empresa visível para Ana é a Empresa A');
select tests.ok(not exists (select 1 from public.company_members where company_id = :'company_b'),
  'Ana não vê membros da Empresa B');
select tests.ok(not exists (select 1 from public.audit_log where company_id = :'company_b'),
  'Ana não vê auditoria da Empresa B');
select tests.ok(not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'Ana não vê o perfil de Bruno (sem empresa em comum)');

select tests.ok(
  tests.affected(format('update public.companies set name = %L where id = %L', 'Invadida', :'company_b')) = 0,
  'Ana não consegue alterar a Empresa B (0 linhas)');

select tests.ok(not private.is_member(:'company_b'),
  'is_member(B) é falso para Ana mesmo informando o id de B');
select tests.ok((select count(*) from public.my_permissions(:'company_b')) = 0,
  'my_permissions(B) é vazio para Ana');

select tests.throws(
  format($q$insert into public.company_members (company_id, user_id, role)
            values (%L, '00000000-0000-0000-0000-0000000000a1', 'admin')$q$, :'company_b'),
  '42501', 'Ana não consegue se inserir diretamente na Empresa B');

select tests.throws(
  format('select public.list_company_members(%L)', :'company_b'),
  '42501', 'list_company_members(B) é negado para Ana');

select tests.throws('select * from public.company_counters',
  '42501', 'contadores não são legíveis diretamente');

select tests.throws(
  format($q$select public.create_invitation(%L, 'x@y.test', 'admin')$q$, :'company_b'),
  '42501', 'Ana não consegue convidar para a Empresa B');

select tests.throws(
  format($q$select private.next_number(%L, 'service_order')$q$, :'company_a'),
  '42501', 'next_number não é executável pelo navegador');

reset role;

-- ---------------------------------------------------------------- Carla (sem empresa)
select tests.login('00000000-0000-0000-0000-0000000000c1');
select tests.ok((select count(*) from public.companies) = 0, 'usuário sem empresa não vê empresas');
select tests.ok((select count(*) from public.company_members) = 0, 'usuário sem empresa não vê membros');
select tests.ok((select count(*) from public.audit_log) = 0, 'usuário sem empresa não vê auditoria');
reset role;

-- ---------------------------------------------------------------- anon
select tests.login_anon();
select tests.throws('select * from public.companies', '42501', 'anon não lê empresas');
select tests.throws('select * from public.profiles', '42501', 'anon não lê perfis');
select tests.throws($q$select public.create_company('X')$q$, '42501', 'anon não executa create_company');
reset role;

-- Regressão: só as duas funções do portal do cliente (que exigem token) são executáveis por anon.
select tests.ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('anon', p.oid, 'execute')
      and not (n.nspname = 'public' and p.proname in ('portal_order', 'portal_decide', 'portal_photos', 'charge_view'))
      and not (n.nspname = 'private' and p.proname in ('path_uuid', 'is_client_visible_photo'))
  ),
  'nenhuma função de public/private é executável por anon (exceto portal e cobrança, que exigem token)');

-- Regressão: todas as tabelas de public têm RLS habilitado.
select tests.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ),
  'todas as tabelas de public têm RLS habilitado');

rollback;
