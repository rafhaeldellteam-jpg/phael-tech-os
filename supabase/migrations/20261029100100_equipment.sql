-- =============================================================================
-- Phael Tech OS — Migração 0008: equipamentos e pesquisa global
-- O equipamento pertence a um cliente da MESMA empresa (FK composta).
-- O QR Code da etiqueta aponta para /equipamentos/<id>: abrir exige login e
-- permissão; nenhum dado privado é gravado no QR.
-- =============================================================================

create table public.equipment_types (
  key    text primary key check (key ~ '^[a-z_]+$'),
  label  text not null,
  sort   int not null
);
insert into public.equipment_types (key, label, sort) values
  ('notebook',  'Notebook', 1),
  ('desktop',   'Computador de mesa', 2),
  ('all_in_one','All-in-one', 3),
  ('server',    'Servidor', 4),
  ('monitor',   'Monitor', 5),
  ('printer',   'Impressora', 6),
  ('tablet',    'Tablet', 7),
  ('phone',     'Celular', 8),
  ('network',   'Equipamento de rede', 9),
  ('console',   'Videogame', 10),
  ('other',     'Outro', 99);

create table public.equipment (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  client_id         uuid not null,
  code              bigint not null,
  type              text not null references public.equipment_types (key),
  manufacturer      text check (manufacturer is null or char_length(manufacturer) <= 80),
  model             text check (model is null or char_length(model) <= 120),
  serial_number     text check (serial_number is null or char_length(serial_number) <= 80),
  asset_tag         text check (asset_tag is null or char_length(asset_tag) <= 80),
  processor         text check (processor is null or char_length(processor) <= 120),
  memory            text check (memory is null or char_length(memory) <= 60),
  storage           text check (storage is null or char_length(storage) <= 120),
  graphics          text check (graphics is null or char_length(graphics) <= 120),
  operating_system  text check (operating_system is null or char_length(operating_system) <= 80),
  condition_notes   text check (condition_notes is null or char_length(condition_notes) <= 2000),
  accessories       text[] not null default '{}' check (cardinality(accessories) <= 30),
  search_text       text generated always as (
                      private.normalize_text(
                        coalesce(manufacturer, '') || ' ' || coalesce(model, '') || ' ' ||
                        coalesce(serial_number, '') || ' ' || coalesce(asset_tag, '') || ' ' || code::text
                      )
                    ) stored,
  archived_at       timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, code),
  foreign key (company_id, client_id) references public.clients (company_id, id) on delete restrict
);
create index equipment_client_idx on public.equipment (company_id, client_id);
create index equipment_search_trgm_idx on public.equipment using gin (search_text extensions.gin_trgm_ops);
create unique index equipment_serial_uq on public.equipment (company_id, lower(serial_number))
  where serial_number is not null and archived_at is null;

create trigger equipment_set_updated_at
  before update on public.equipment
  for each row execute function private.set_updated_at();

create trigger equipment_audit
  after insert or update on public.equipment
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- Criar ou atualizar equipamento
-- -----------------------------------------------------------------------------
create or replace function public.save_equipment(p_company_id uuid, p_equipment_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_equipment_id;
  v_client uuid := (p_data ->> 'client_id')::uuid;
  v_serial text := private.clean(p_data ->> 'serial_number');
  v_acc text[];
begin
  perform private.require_permission(p_company_id, 'equipment.write');

  if not exists (select 1 from public.clients where id = v_client and company_id = p_company_id) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;

  if v_serial is not null and exists (
    select 1 from public.equipment e
    where e.company_id = p_company_id and lower(e.serial_number) = lower(v_serial)
      and e.archived_at is null and e.id is distinct from v_id
  ) then
    raise exception 'Já existe um equipamento ativo com este número de série' using errcode = '23505';
  end if;

  select coalesce(array_agg(btrim(a)) filter (where btrim(a) <> ''), '{}')
  into v_acc
  from jsonb_array_elements_text(coalesce(p_data -> 'accessories', '[]'::jsonb)) a;

  if v_id is null then
    insert into public.equipment (
      company_id, client_id, code, type, manufacturer, model, serial_number, asset_tag,
      processor, memory, storage, graphics, operating_system, condition_notes, accessories, created_by
    ) values (
      p_company_id, v_client, private.next_number(p_company_id, 'equipment'),
      coalesce(nullif(p_data ->> 'type', ''), 'other'),
      private.clean(p_data ->> 'manufacturer'), private.clean(p_data ->> 'model'), v_serial,
      private.clean(p_data ->> 'asset_tag'), private.clean(p_data ->> 'processor'),
      private.clean(p_data ->> 'memory'), private.clean(p_data ->> 'storage'),
      private.clean(p_data ->> 'graphics'), private.clean(p_data ->> 'operating_system'),
      private.clean(p_data ->> 'condition_notes'), v_acc, auth.uid()
    )
    returning id into v_id;
  else
    update public.equipment set
      client_id = v_client,
      type = coalesce(nullif(p_data ->> 'type', ''), 'other'),
      manufacturer = private.clean(p_data ->> 'manufacturer'),
      model = private.clean(p_data ->> 'model'),
      serial_number = v_serial,
      asset_tag = private.clean(p_data ->> 'asset_tag'),
      processor = private.clean(p_data ->> 'processor'),
      memory = private.clean(p_data ->> 'memory'),
      storage = private.clean(p_data ->> 'storage'),
      graphics = private.clean(p_data ->> 'graphics'),
      operating_system = private.clean(p_data ->> 'operating_system'),
      condition_notes = private.clean(p_data ->> 'condition_notes'),
      accessories = v_acc
    where id = v_id and company_id = p_company_id;
    if not found then
      raise exception 'Equipamento não encontrado' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.set_equipment_archived(p_equipment_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.equipment where id = p_equipment_id;
  if not found then
    raise exception 'Equipamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company, 'equipment.write');
  update public.equipment
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_equipment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Pesquisa global (cabeçalho). Só devolve o que o usuário pode ver.
-- -----------------------------------------------------------------------------
create or replace function public.global_search(p_company_id uuid, p_query text)
returns table (kind text, id uuid, code bigint, title text, subtitle text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := private.normalize_text(btrim(p_query));
begin
  if not private.is_member(p_company_id) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;

  if private.has_permission(p_company_id, 'clients.read') then
    return query
      select 'client'::text, c.id, c.code, c.name,
             coalesce(nullif(concat_ws(', ', c.whatsapp, c.email), ''), 'Cliente')
      from public.clients c
      where c.company_id = p_company_id and c.archived_at is null
        and c.search_text like '%' || v_q || '%'
      order by c.name
      limit 6;
  end if;

  if private.has_permission(p_company_id, 'equipment.read') then
    return query
      select 'equipment'::text, e.id, e.code,
             coalesce(nullif(concat_ws(' ', e.manufacturer, e.model), ''), t.label),
             c.name
      from public.equipment e
      join public.equipment_types t on t.key = e.type
      join public.clients c on c.id = e.client_id
      where e.company_id = p_company_id and e.archived_at is null
        and e.search_text like '%' || v_q || '%'
      order by e.code desc
      limit 6;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.equipment_types enable row level security;
alter table public.equipment enable row level security;

grant select on public.equipment_types to authenticated;
grant select on public.equipment to authenticated;

create policy equipment_types_select on public.equipment_types
  for select to authenticated using (true);

create policy equipment_select on public.equipment
  for select to authenticated
  using (private.has_permission(company_id, 'equipment.read'));

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.save_equipment(uuid, uuid, jsonb) to authenticated;
grant execute on function public.set_equipment_archived(uuid, boolean) to authenticated;
grant execute on function public.global_search(uuid, text) to authenticated;
