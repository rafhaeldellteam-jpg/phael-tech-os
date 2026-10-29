-- =============================================================================
-- Phael Tech OS — Migração 0006: Row Level Security e privilégios
-- Regra geral: RLS habilitado em todas as tabelas (sem FORCE: as funções
-- SECURITY DEFINER, de propriedade do dono das tabelas, precisam ler sem
-- recursão de políticas); o papel anon não
-- acessa nada; escritas sensíveis só via RPCs da migração 0005.
-- =============================================================================

alter table public.companies                   enable row level security;
alter table public.profiles                    enable row level security;
alter table public.company_members             enable row level security;
alter table public.permissions                 enable row level security;
alter table public.role_permissions            enable row level security;
alter table public.member_permission_overrides enable row level security;
alter table public.audit_log                   enable row level security;
alter table public.company_counters            enable row level security;
alter table public.company_invitations         enable row level security;


revoke all on all tables in schema public from anon, authenticated;

-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------
grant select on public.companies to authenticated;
grant update (name, legal_name, tax_id, email, phone, timezone) on public.companies to authenticated;

create policy companies_select on public.companies
  for select to authenticated
  using (private.is_member(id));

create policy companies_update on public.companies
  for update to authenticated
  using (private.has_permission(id, 'company.update'))
  with check (private.has_permission(id, 'company.update'));

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.shares_company_with(id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- company_members (somente leitura direta; escrita via RPC)
-- -----------------------------------------------------------------------------
grant select on public.company_members to authenticated;

create policy company_members_select on public.company_members
  for select to authenticated
  using (user_id = auth.uid() or private.has_permission(company_id, 'members.read'));

-- -----------------------------------------------------------------------------
-- Catálogo de permissões (leitura pública para usuários autenticados)
-- -----------------------------------------------------------------------------
grant select on public.permissions, public.role_permissions to authenticated;

create policy permissions_select on public.permissions
  for select to authenticated using (true);

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);

grant select on public.member_permission_overrides to authenticated;

create policy member_permission_overrides_select on public.member_permission_overrides
  for select to authenticated
  using (private.has_permission(company_id, 'members.read'));

-- -----------------------------------------------------------------------------
-- audit_log
-- -----------------------------------------------------------------------------
grant select on public.audit_log to authenticated;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (private.has_permission(company_id, 'audit.read'));

-- -----------------------------------------------------------------------------
-- company_counters: nenhum acesso direto (só private.next_number).
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- company_invitations: leitura sem a coluna token_hash
-- -----------------------------------------------------------------------------
grant select (id, company_id, email, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at)
  on public.company_invitations to authenticated;

create policy company_invitations_select on public.company_invitations
  for select to authenticated
  using (private.has_permission(company_id, 'members.manage'));

-- -----------------------------------------------------------------------------
-- RPC de listagem de membros com nome e e-mail (auth.users não é exposto).
-- -----------------------------------------------------------------------------
create or replace function public.list_company_members(p_company_id uuid)
returns table (
  member_id  uuid,
  user_id    uuid,
  full_name  text,
  email      text,
  role       public.member_role,
  status     public.member_status,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_permission(p_company_id, 'members.read');
  return query
    select m.id, m.user_id, p.full_name, u.email::text, m.role, m.status, m.created_at
    from public.company_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.company_id = p_company_id
    order by m.created_at;
end;
$$;
grant execute on function public.list_company_members(uuid) to authenticated;

-- As funções privadas que as RPCs chamam internamente não precisam de
-- grant para authenticated: rodam com os privilégios do dono (SECURITY DEFINER).
revoke execute on function private.require_permission(uuid, text) from public, anon, authenticated;
revoke execute on function private.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.next_number(uuid, text) from public, anon, authenticated;
revoke execute on function private.audit_row_change() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Funções: o PostgreSQL concede EXECUTE a PUBLIC por padrão em toda função nova,
-- e o "alter default privileges ... in schema" não remove esse grant.
-- Por isso revogamos explicitamente e concedemos apenas a authenticated.
-- CONVENÇÃO: toda migração futura que criar funções deve repetir este bloco.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.my_permissions(uuid) to authenticated;
grant execute on function public.create_company(text, text) to authenticated;
grant execute on function public.update_member(uuid, public.member_role, public.member_status) to authenticated;
grant execute on function public.set_member_permission(uuid, text, boolean) to authenticated;
grant execute on function public.create_invitation(uuid, text, public.member_role, int) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.list_company_members(uuid) to authenticated;

grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.member_role(uuid) to authenticated;
grant execute on function private.shares_company_with(uuid) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.is_valid_tax_id(text) to authenticated;
