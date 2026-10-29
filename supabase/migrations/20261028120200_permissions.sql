-- =============================================================================
-- Phael Tech OS — Migração 0003: catálogo de permissões e verificação no banco
-- =============================================================================
-- Modelo:
--   permissão efetiva = admin
--                     OU (padrão do papel E não revogada para o membro)
--                     OU concedida explicitamente ao membro
-- O administrador sempre tem todas as permissões (evita a empresa ficar sem acesso).

create table public.permissions (
  key          text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  module       text not null,
  description  text not null
);

create table public.role_permissions (
  role            public.member_role not null,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role, permission_key)
);

create table public.member_permission_overrides (
  member_id       uuid not null references public.company_members (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete restrict,
  permission_key  text not null references public.permissions (key) on delete cascade,
  granted         boolean not null,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (member_id, permission_key)
);
create index member_permission_overrides_company_idx
  on public.member_permission_overrides (company_id);

-- -----------------------------------------------------------------------------
-- Catálogo (inclui permissões das fases seguintes para que os papéis já
-- nasçam corretos; módulos ainda não implementados simplesmente não as usam).
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module, description) values
  ('company.read',            'company',        'Ver dados da empresa'),
  ('company.update',          'company',        'Alterar dados da empresa'),
  ('members.read',            'members',        'Ver membros da equipe'),
  ('members.manage',          'members',        'Convidar membros, alterar papéis e permissões'),
  ('audit.read',              'audit',          'Consultar a trilha de auditoria'),
  ('clients.read',            'clients',        'Ver clientes'),
  ('clients.write',           'clients',        'Cadastrar e editar clientes'),
  ('clients.read_sensitive',  'clients',        'Ver CPF/CNPJ e observações internas'),
  ('clients.export',          'clients',        'Exportar dados de clientes'),
  ('equipment.read',          'equipment',      'Ver equipamentos'),
  ('equipment.write',         'equipment',      'Cadastrar e editar equipamentos'),
  ('orders.read_all',         'orders',         'Ver todas as ordens de serviço'),
  ('orders.read_assigned',    'orders',         'Ver ordens de serviço atribuídas a si'),
  ('orders.create',           'orders',         'Abrir ordens de serviço'),
  ('orders.update',           'orders',         'Atualizar ordens de serviço e status'),
  ('diagnostics.write',       'diagnostics',    'Registrar diagnósticos e checklists'),
  ('quotes.read',             'quotes',         'Ver orçamentos'),
  ('quotes.write',            'quotes',         'Criar e revisar orçamentos'),
  ('quotes.record_decision',  'quotes',         'Registrar aprovação ou recusa do cliente'),
  ('catalog.read',            'catalog',        'Ver catálogo de serviços e preços'),
  ('catalog.write',           'catalog',        'Alterar catálogo de serviços e preços'),
  ('inventory.read',          'inventory',      'Ver estoque'),
  ('inventory.write',         'inventory',      'Movimentar estoque'),
  ('suppliers.write',         'inventory',      'Cadastrar fornecedores e compras'),
  ('finance.read',            'finance',        'Ver contas, pagamentos e fluxo de caixa'),
  ('finance.write',           'finance',        'Lançar pagamentos, despesas e estornos'),
  ('schedule.read',           'schedule',       'Ver agenda'),
  ('schedule.write',          'schedule',       'Criar e alterar agendamentos'),
  ('reports.operational',     'reports',        'Relatórios operacionais'),
  ('reports.financial',       'reports',        'Relatórios financeiros'),
  ('knowledge.read',          'knowledge',      'Consultar base de conhecimento');

-- Administrador: tudo.
insert into public.role_permissions (role, permission_key)
select 'admin', key from public.permissions;

-- Técnico
insert into public.role_permissions (role, permission_key) values
  ('technician', 'company.read'),
  ('technician', 'members.read'),
  ('technician', 'clients.read'),
  ('technician', 'equipment.read'),
  ('technician', 'equipment.write'),
  ('technician', 'orders.read_assigned'),
  ('technician', 'orders.update'),
  ('technician', 'diagnostics.write'),
  ('technician', 'quotes.read'),
  ('technician', 'catalog.read'),
  ('technician', 'inventory.read'),
  ('technician', 'schedule.read'),
  ('technician', 'knowledge.read');

-- Financeiro
insert into public.role_permissions (role, permission_key) values
  ('finance', 'company.read'),
  ('finance', 'members.read'),
  ('finance', 'clients.read'),
  ('finance', 'clients.read_sensitive'),
  ('finance', 'orders.read_all'),
  ('finance', 'quotes.read'),
  ('finance', 'catalog.read'),
  ('finance', 'inventory.read'),
  ('finance', 'finance.read'),
  ('finance', 'finance.write'),
  ('finance', 'reports.financial');

-- Atendente
insert into public.role_permissions (role, permission_key) values
  ('attendant', 'company.read'),
  ('attendant', 'members.read'),
  ('attendant', 'clients.read'),
  ('attendant', 'clients.write'),
  ('attendant', 'equipment.read'),
  ('attendant', 'equipment.write'),
  ('attendant', 'orders.read_all'),
  ('attendant', 'orders.create'),
  ('attendant', 'quotes.read'),
  ('attendant', 'quotes.record_decision'),
  ('attendant', 'catalog.read'),
  ('attendant', 'schedule.read'),
  ('attendant', 'schedule.write'),
  ('attendant', 'knowledge.read');

-- -----------------------------------------------------------------------------
-- Verificação de permissão (fonte única da verdade)
-- -----------------------------------------------------------------------------
create or replace function private.has_permission(p_company_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      case
        when m.role = 'admin' then true
        when o.granted is not null then o.granted
        else exists (
          select 1 from public.role_permissions rp
          where rp.role = m.role and rp.permission_key = p_permission
        )
      end
    from public.company_members m
    left join public.member_permission_overrides o
      on o.member_id = m.id and o.permission_key = p_permission
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  ), false);
$$;
grant execute on function private.has_permission(uuid, text) to authenticated;

-- Lança erro padronizado quando a permissão não existe para o usuário atual.
create or replace function private.require_permission(p_company_id uuid, p_permission text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '28000';
  end if;
  if not private.has_permission(p_company_id, p_permission) then
    raise exception 'Permissão negada: %', p_permission using errcode = '42501';
  end if;
end;
$$;

-- RPC usada pela interface para decidir o que exibir.
-- Exibir/ocultar é apenas conveniência: o banco aplica as mesmas regras.
create or replace function public.my_permissions(p_company_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.key
  from public.permissions p
  where private.has_permission(p_company_id, p.key)
  order by p.key;
$$;
grant execute on function public.my_permissions(uuid) to authenticated;
