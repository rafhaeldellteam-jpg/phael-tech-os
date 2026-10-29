-- =============================================================================
-- Phael Tech OS — Migração 0005: operações privilegiadas (RPCs) e convites
-- Toda escrita em membros/permissões passa por estas funções, que validam
-- a permissão no servidor e registram auditoria.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Criar empresa (onboarding). Quem cria vira administrador.
-- -----------------------------------------------------------------------------
create or replace function public.create_company(p_name text, p_legal_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_company_id uuid;
  v_created int;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '28000';
  end if;

  -- Limite simples contra abuso. Ajustável quando os planos SaaS existirem.
  select count(*) into v_created from public.companies where created_by = v_uid;
  if v_created >= 3 then
    raise exception 'Limite de empresas criadas por usuário atingido' using errcode = '54000';
  end if;

  insert into public.companies (name, legal_name, created_by)
  values (btrim(p_name), nullif(btrim(p_legal_name), ''), v_uid)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_uid, 'admin');

  return v_company_id;
end;
$$;
grant execute on function public.create_company(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Alterar papel ou status de um membro
-- -----------------------------------------------------------------------------
create or replace function public.update_member(
  p_member_id uuid,
  p_role      public.member_role,
  p_status    public.member_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.company_members;
  v_active_admins int;
begin
  select * into v_member from public.company_members where id = p_member_id for update;
  if not found then
    raise exception 'Membro não encontrado' using errcode = 'P0002';
  end if;

  perform private.require_permission(v_member.company_id, 'members.manage');

  -- Nunca deixar a empresa sem um administrador ativo.
  if v_member.role = 'admin' and v_member.status = 'active'
     and (p_role <> 'admin' or p_status <> 'active') then
    select count(*) into v_active_admins
    from public.company_members
    where company_id = v_member.company_id and role = 'admin' and status = 'active';
    if v_active_admins <= 1 then
      raise exception 'A empresa precisa de pelo menos um administrador ativo' using errcode = '23514';
    end if;
  end if;

  update public.company_members
  set role = p_role, status = p_status
  where id = p_member_id;
end;
$$;
grant execute on function public.update_member(uuid, public.member_role, public.member_status) to authenticated;

-- -----------------------------------------------------------------------------
-- Permissões adicionais/revogadas por membro (p_granted null = voltar ao padrão)
-- -----------------------------------------------------------------------------
create or replace function public.set_member_permission(
  p_member_id      uuid,
  p_permission_key text,
  p_granted        boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.company_members;
begin
  select * into v_member from public.company_members where id = p_member_id;
  if not found then
    raise exception 'Membro não encontrado' using errcode = 'P0002';
  end if;

  perform private.require_permission(v_member.company_id, 'members.manage');

  if v_member.role = 'admin' then
    raise exception 'Administradores já possuem todas as permissões' using errcode = '22023';
  end if;
  if not exists (select 1 from public.permissions where key = p_permission_key) then
    raise exception 'Permissão inexistente: %', p_permission_key using errcode = '22023';
  end if;

  if p_granted is null then
    delete from public.member_permission_overrides
    where member_id = p_member_id and permission_key = p_permission_key;
  else
    insert into public.member_permission_overrides (member_id, company_id, permission_key, granted, created_by)
    values (p_member_id, v_member.company_id, p_permission_key, p_granted, auth.uid())
    on conflict (member_id, permission_key)
    do update set granted = excluded.granted, created_by = excluded.created_by, created_at = now();
  end if;
end;
$$;
grant execute on function public.set_member_permission(uuid, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Convites
-- O token só é devolvido uma vez; no banco fica apenas o hash SHA-256.
-- Envio por e-mail depende de integração futura: hoje o administrador copia
-- o link e envia pelo canal que preferir.
-- -----------------------------------------------------------------------------
create table public.company_invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  role         public.member_role not null,
  token_hash   bytea not null unique,
  invited_by   uuid references auth.users (id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index company_invitations_company_idx on public.company_invitations (company_id, created_at desc);

create trigger company_invitations_audit
  after insert or update on public.company_invitations
  for each row execute function private.audit_row_change('company_id', 'token_hash');

create or replace function public.create_invitation(
  p_company_id uuid,
  p_email      text,
  p_role       public.member_role,
  p_valid_days int default 7
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_email text := lower(btrim(p_email));
  v_recent int;
begin
  perform private.require_permission(p_company_id, 'members.manage');

  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 30 then
    raise exception 'Validade do convite deve ser de 1 a 30 dias' using errcode = '22023';
  end if;

  -- Limite de requisições: no máximo 20 convites por empresa a cada 24h.
  select count(*) into v_recent
  from public.company_invitations
  where company_id = p_company_id and created_at > now() - interval '24 hours';
  if v_recent >= 20 then
    raise exception 'Limite diário de convites atingido' using errcode = '54000';
  end if;

  if exists (
    select 1 from public.company_members m
    join auth.users u on u.id = m.user_id
    where m.company_id = p_company_id and lower(u.email) = v_email
  ) then
    raise exception 'Este e-mail já pertence a um membro da empresa' using errcode = '23505';
  end if;

  -- Revoga convites pendentes anteriores para o mesmo e-mail.
  update public.company_invitations
  set revoked_at = now()
  where company_id = p_company_id and email = v_email
    and accepted_at is null and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.company_invitations (company_id, email, role, token_hash, invited_by, expires_at)
  values (
    p_company_id, v_email, p_role,
    extensions.digest(v_token, 'sha256'),
    auth.uid(),
    now() + make_interval(days => p_valid_days)
  );

  return v_token;
end;
$$;
grant execute on function public.create_invitation(uuid, text, public.member_role, int) to authenticated;

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id from public.company_invitations where id = p_invitation_id;
  if not found then
    raise exception 'Convite não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company_id, 'members.manage');
  update public.company_invitations
  set revoked_at = now()
  where id = p_invitation_id and accepted_at is null and revoked_at is null;
end;
$$;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- Aceitar convite: o e-mail da conta autenticada precisa ser o convidado.
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.company_invitations;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Convite inválido ou expirado' using errcode = '22023';
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;

  select * into v_inv
  from public.company_invitations
  where token_hash = extensions.digest(p_token, 'sha256')
  for update;

  -- Mensagem única para todos os casos, para não revelar detalhes.
  if not found
     or v_inv.accepted_at is not null
     or v_inv.revoked_at is not null
     or v_inv.expires_at <= now()
     or v_inv.email <> v_email then
    raise exception 'Convite inválido ou expirado' using errcode = '22023';
  end if;

  insert into public.company_members (company_id, user_id, role)
  values (v_inv.company_id, v_uid, v_inv.role)
  on conflict (company_id, user_id) do nothing;

  update public.company_invitations
  set accepted_at = now(), accepted_by = v_uid
  where id = v_inv.id;

  return v_inv.company_id;
end;
$$;
grant execute on function public.accept_invitation(text) to authenticated;
