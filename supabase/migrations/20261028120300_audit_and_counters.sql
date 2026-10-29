-- =============================================================================
-- Phael Tech OS — Migração 0004: auditoria e numeração sequencial por empresa
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Trilha de auditoria (somente inserção)
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies (id) on delete restrict,
  actor_id     uuid references auth.users (id) on delete set null,
  action       text not null check (char_length(action) between 1 and 60),
  entity       text not null check (char_length(entity) between 1 and 60),
  entity_id    text,
  changes      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_log_company_created_idx on public.audit_log (company_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (company_id, entity, entity_id);

comment on table public.audit_log is
  'Registros imutáveis de operações relevantes. Nunca contém senhas, tokens ou valores marcados como sensíveis.';

-- Impede alteração ou exclusão, inclusive por funções SECURITY DEFINER.
create or replace function private.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A trilha de auditoria é imutável' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- Registro manual de eventos de negócio (ex.: convite aceito).
create or replace function private.write_audit(
  p_company_id uuid,
  p_action     text,
  p_entity     text,
  p_entity_id  text,
  p_changes    jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, changes)
  values (p_company_id, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_changes, '{}'::jsonb));
$$;

-- Trigger genérico de auditoria.
--   TG_ARGV[0]: nome da coluna que contém o company_id ('id' para companies)
--   TG_ARGV[1..]: colunas sensíveis cujo valor é substituído por "[redacted]"
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_col text := tg_argv[0];
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_sensitive text[] := coalesce(tg_argv[1:], array[]::text[]);
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key in ('updated_at') then
        continue;
      end if;
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_changes := v_changes || jsonb_build_object(
          v_key,
          case when v_key = any (v_sensitive)
            then jsonb_build_object('old', '[redacted]', 'new', '[redacted]')
            else jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key)
          end
        );
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new; -- nada mudou de fato
    end if;
  else
    v_changes := v_row;
    for v_key in select unnest(v_sensitive) loop
      if v_changes ? v_key then
        v_changes := jsonb_set(v_changes, array[v_key], '"[redacted]"'::jsonb);
      end if;
    end loop;
  end if;

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, changes)
  values (
    (v_row ->> v_company_col)::uuid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    v_changes
  );
  return coalesce(new, old);
end;
$$;

create trigger companies_audit
  after insert or update on public.companies
  for each row execute function private.audit_row_change('id', 'tax_id');

create trigger company_members_audit
  after insert or update or delete on public.company_members
  for each row execute function private.audit_row_change('company_id');

create trigger member_permission_overrides_audit
  after insert or update or delete on public.member_permission_overrides
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- Numeração sequencial por empresa (OS, orçamentos, etc.)
-- A instrução INSERT ... ON CONFLICT DO UPDATE trava a linha do contador,
-- então chamadas simultâneas recebem números distintos e consecutivos.
-- -----------------------------------------------------------------------------
create table public.company_counters (
  company_id  uuid not null references public.companies (id) on delete restrict,
  key         text not null check (key ~ '^[a-z_]+$'),
  last_value  bigint not null default 0 check (last_value >= 0),
  primary key (company_id, key)
);

create or replace function private.next_number(p_company_id uuid, p_key text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.company_counters as c (company_id, key, last_value)
  values (p_company_id, p_key, 1)
  on conflict (company_id, key)
  do update set last_value = c.last_value + 1
  returning c.last_value;
$$;
-- Não é concedida a authenticated: só triggers/RPCs do próprio banco a usam.
