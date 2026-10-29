-- =============================================================================
-- Phael Tech OS — Migração 0009: uso exclusivo de uma empresa
-- O sistema é de uso interno da Phael Tech Support. O modelo multiempresa e o
-- RLS continuam (isolamento e defesa em profundidade), mas só a PRIMEIRA
-- empresa pode ser criada pelo onboarding. Depois disso, novas pessoas só
-- entram por convite do administrador.
-- Para reabrir o modo SaaS no futuro, basta trocar private.allow_new_companies().
-- =============================================================================

create or replace function private.allow_new_companies()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.companies);
$$;

-- A interface usa para decidir entre "Criar empresa" e "Aguardando convite".
create or replace function public.can_create_company()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and private.allow_new_companies();
$$;

create or replace function public.create_company(p_name text, p_legal_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '28000';
  end if;

  -- Trava contra duas criações simultâneas no primeiro acesso.
  lock table public.companies in share row exclusive mode;

  if not private.allow_new_companies() then
    raise exception 'Este sistema é de uso exclusivo da empresa já cadastrada. Peça um convite ao administrador.'
      using errcode = '42501';
  end if;

  insert into public.companies (name, legal_name, created_by)
  values (btrim(p_name), nullif(btrim(p_legal_name), ''), v_uid)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_uid, 'admin');

  return v_company_id;
end;
$$;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.can_create_company() to authenticated;
grant execute on function public.create_company(text, text) to authenticated;
