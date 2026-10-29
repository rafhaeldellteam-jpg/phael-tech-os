-- Papéis, permissões efetivas, exceções por membro e proteção do último admin.
begin;

select tests.create_user('00000000-0000-0000-0000-0000000000a1', 'admin@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a2', 'tecnico@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a3', 'financeiro@a.test');
select tests.create_user('00000000-0000-0000-0000-0000000000a4', 'atendente@a.test');

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.create_company('Empresa A') as company_a \gset
reset role;

-- Membros inseridos diretamente (como superusuário) só para montar o cenário.
insert into public.company_members (company_id, user_id, role) values
  (:'company_a', '00000000-0000-0000-0000-0000000000a2', 'technician'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a3', 'finance'),
  (:'company_a', '00000000-0000-0000-0000-0000000000a4', 'attendant');

select id as tech_member from public.company_members
 where user_id = '00000000-0000-0000-0000-0000000000a2' \gset
select id as admin_member from public.company_members
 where user_id = '00000000-0000-0000-0000-0000000000a1' \gset

-- ---------------------------------------------------------------- admin
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.ok(
  (select count(*) from public.my_permissions(:'company_a')) = (select count(*) from public.permissions),
  'admin tem todas as permissões');
select tests.ok((select count(*) from public.list_company_members(:'company_a')) = 4,
  'admin lista os 4 membros com e-mail');
reset role;

-- ---------------------------------------------------------------- técnico
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok(private.has_permission(:'company_a', 'diagnostics.write'), 'técnico registra diagnósticos');
select tests.ok(private.has_permission(:'company_a', 'orders.read_assigned'), 'técnico vê OS atribuídas');
select tests.ok(not private.has_permission(:'company_a', 'orders.read_all'), 'técnico não vê todas as OS');
select tests.ok(not private.has_permission(:'company_a', 'finance.read'), 'técnico não vê financeiro');
select tests.ok(not private.has_permission(:'company_a', 'audit.read'), 'técnico não lê auditoria');
select tests.ok((select count(*) from public.audit_log) = 0, 'técnico não recebe linhas de auditoria');
select tests.ok(
  tests.affected(format($q$update public.companies set name = 'X' where id = %L$q$, :'company_a')) = 0,
  'técnico não altera dados da empresa');
select tests.throws(
  format($q$select public.update_member(%L, 'admin', 'active')$q$, :'tech_member'),
  '42501', 'técnico não se promove a admin');
select tests.throws(
  format($q$select public.set_member_permission(%L, 'finance.read', true)$q$, :'tech_member'),
  '42501', 'técnico não concede permissões a si mesmo');
reset role;

-- ---------------------------------------------------------------- financeiro
select tests.login('00000000-0000-0000-0000-0000000000a3');
select tests.ok(private.has_permission(:'company_a', 'finance.write'), 'financeiro lança pagamentos');
select tests.ok(private.has_permission(:'company_a', 'reports.financial'), 'financeiro vê relatórios financeiros');
select tests.ok(not private.has_permission(:'company_a', 'members.manage'), 'financeiro não gerencia membros');
reset role;

-- ---------------------------------------------------------------- atendente
select tests.login('00000000-0000-0000-0000-0000000000a4');
select tests.ok(private.has_permission(:'company_a', 'orders.create'), 'atendente abre OS');
select tests.ok(private.has_permission(:'company_a', 'schedule.write'), 'atendente agenda');
select tests.ok(not private.has_permission(:'company_a', 'clients.read_sensitive'), 'atendente não vê CPF/CNPJ');
select tests.ok(not private.has_permission(:'company_a', 'finance.read'), 'atendente não vê financeiro');
reset role;

-- ---------------------------------------------------------------- exceções por membro
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.set_member_permission(:'tech_member', 'inventory.write', true);
select public.set_member_permission(:'tech_member', 'diagnostics.write', false);
select tests.throws(
  format($q$select public.set_member_permission(%L, 'nao.existe', true)$q$, :'tech_member'),
  '22023', 'permissão inexistente é rejeitada');
select tests.throws(
  format($q$select public.set_member_permission(%L, 'finance.read', false)$q$, :'admin_member'),
  '22023', 'não é possível revogar permissões de um admin');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok(private.has_permission(:'company_a', 'inventory.write'), 'concessão extra vale para o técnico');
select tests.ok(not private.has_permission(:'company_a', 'diagnostics.write'), 'revogação vale para o técnico');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.set_member_permission(:'tech_member', 'diagnostics.write', null);
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok(private.has_permission(:'company_a', 'diagnostics.write'), 'null restaura o padrão do papel');
reset role;

-- ---------------------------------------------------------------- suspensão
select tests.login('00000000-0000-0000-0000-0000000000a1');
select public.update_member(:'tech_member', 'technician', 'suspended');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
select tests.ok(not private.is_member(:'company_a'), 'membro suspenso perde o acesso');
select tests.ok((select count(*) from public.companies) = 0, 'membro suspenso não vê a empresa');
reset role;

-- ---------------------------------------------------------------- último admin
select tests.login('00000000-0000-0000-0000-0000000000a1');
select tests.throws(
  format($q$select public.update_member(%L, 'technician', 'active')$q$, :'admin_member'),
  '23514', 'o último admin não pode ser rebaixado');
select tests.throws(
  format($q$select public.update_member(%L, 'admin', 'suspended')$q$, :'admin_member'),
  '23514', 'o último admin não pode ser suspenso');
reset role;

rollback;
