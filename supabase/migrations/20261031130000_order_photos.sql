-- =============================================================================
-- Fotos da OS
-- Arquivos no Supabase Storage (bucket privado "order-photos"), no caminho
-- <empresa>/<os>/<uuid>.jpg. A tabela order_photos registra cada foto (etapa,
-- legenda, se o cliente vê no portal). Quem acessa a OS vê as fotos; o portal
-- mostra só as marcadas para o cliente (o caminho é um UUID aleatório que só
-- o portal revela).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-photos', 'order-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create type public.photo_stage as enum ('intake', 'repair', 'delivery', 'other');

create table public.order_photos (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  order_id           uuid not null,
  storage_path       text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  stage              public.photo_stage not null default 'intake',
  caption            text check (caption is null or char_length(caption) <= 200),
  visible_to_client  boolean not null default false,
  width              int check (width is null or width between 1 and 10000),
  height             int check (height is null or height between 1 and 10000),
  size_bytes         int check (size_bytes is null or size_bytes between 1 and 5242880),
  uploaded_by        uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict,
  check (storage_path like company_id::text || '/' || order_id::text || '/%')
);
create index order_photos_order_idx on public.order_photos (order_id, created_at);
create trigger order_photos_audit after insert or update or delete on public.order_photos
  for each row execute function private.audit_row_change('company_id');

-- Pode enviar foto quem trabalha na OS.
create or replace function private.can_upload_order_photo(p_company_id uuid, p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_access_order(o.company_id, o.assigned_to)
       and (private.has_permission(o.company_id, 'orders.update')
            or private.has_permission(o.company_id, 'orders.create')
            or private.has_permission(o.company_id, 'diagnostics.write'))
    from public.service_orders o where o.id = p_order_id and o.company_id = p_company_id
  ), false);
$$;

create or replace function private.can_view_order_files(p_company_id uuid, p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.can_access_order(o.company_id, o.assigned_to)
    from public.service_orders o where o.id = p_order_id and o.company_id = p_company_id
  ), false);
$$;

-- Usado pela política do portal (visitante sem login): só diz se a foto está liberada.
create or replace function private.is_client_visible_photo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.order_photos p where p.storage_path = p_path and p.visible_to_client);
$$;

-- Primeira e segunda pastas do caminho como uuid (null se não forem).
create or replace function private.path_uuid(p_name text, p_index int)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when (storage.foldername(p_name))[p_index] ~ '^[0-9a-f-]{36}$' then (storage.foldername(p_name))[p_index]::uuid end;
$$;

-- -----------------------------------------------------------------------------
-- Políticas do Storage
-- -----------------------------------------------------------------------------
drop policy if exists order_photos_upload on storage.objects;
drop policy if exists order_photos_read on storage.objects;
drop policy if exists order_photos_portal_read on storage.objects;
drop policy if exists order_photos_delete on storage.objects;

create policy order_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'order-photos'
              and private.can_upload_order_photo(private.path_uuid(name, 1), private.path_uuid(name, 2)));
create policy order_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'order-photos'
         and private.can_view_order_files(private.path_uuid(name, 1), private.path_uuid(name, 2)));
create policy order_photos_portal_read on storage.objects for select to anon
  using (bucket_id = 'order-photos' and private.is_client_visible_photo(name));
create policy order_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'order-photos'
         and private.can_upload_order_photo(private.path_uuid(name, 1), private.path_uuid(name, 2))
         and not exists (select 1 from public.order_photos p where p.storage_path = name));

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------
create or replace function public.register_order_photo(p_order_id uuid, p_path text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  v_id uuid;
begin
  if not private.can_upload_order_photo(v.company_id, v.id) then
    raise exception 'Sem permissão para enviar fotos nesta OS' using errcode = '42501';
  end if;
  if p_path is null or p_path not like v.company_id::text || '/' || v.id::text || '/%' then
    raise exception 'Caminho da foto inválido' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'order-photos' and o.name = p_path) then
    raise exception 'Arquivo não encontrado no armazenamento' using errcode = 'P0002';
  end if;
  if (select count(*) from public.order_photos where order_id = v.id) >= 40 then
    raise exception 'Limite de 40 fotos por OS' using errcode = '23514';
  end if;
  insert into public.order_photos (company_id, order_id, storage_path, stage, caption, visible_to_client, width, height, size_bytes, uploaded_by)
  values (v.company_id, v.id, p_path,
          coalesce(nullif(p_data ->> 'stage', ''), 'intake')::public.photo_stage,
          private.clean(p_data ->> 'caption'),
          coalesce((p_data ->> 'visible_to_client')::boolean, false),
          nullif(p_data ->> 'width', '')::int, nullif(p_data ->> 'height', '')::int, nullif(p_data ->> 'size_bytes', '')::int,
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_order_photo(p_photo_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.order_photos;
begin
  select * into p from public.order_photos where id = p_photo_id for update;
  if not found or not private.can_upload_order_photo(p.company_id, p.order_id) then
    raise exception 'Foto não encontrada' using errcode = 'P0002';
  end if;
  update public.order_photos set
    caption = case when p_data ? 'caption' then private.clean(p_data ->> 'caption') else caption end,
    stage = coalesce(nullif(p_data ->> 'stage', ''), stage::text)::public.photo_stage,
    visible_to_client = coalesce((p_data ->> 'visible_to_client')::boolean, visible_to_client)
  where id = p.id;
end;
$$;

-- Remove o registro (fica na auditoria); o arquivo é apagado em seguida pelo app.
create or replace function public.delete_order_photo(p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.order_photos;
begin
  select * into p from public.order_photos where id = p_photo_id for update;
  if not found or not private.can_upload_order_photo(p.company_id, p.order_id) then
    raise exception 'Foto não encontrada' using errcode = 'P0002';
  end if;
  if not private.has_permission(p.company_id, 'orders.update') then
    raise exception 'Sem permissão para apagar fotos' using errcode = '42501';
  end if;
  delete from public.order_photos where id = p.id;
  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (p.company_id, p.order_id, 'note', auth.uid(), 'Foto removida' || coalesce(': ' || p.caption, ''));
  return p.storage_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Portal: inclui as fotos liberadas ao cliente
-- -----------------------------------------------------------------------------
create or replace function public.portal_photos(p_token text)
returns table (path text, stage public.photo_stage, caption text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.portal_links := private.portal_link_for(p_token);
begin
  return query
  select p.storage_path, p.stage, p.caption from public.order_photos p
  where p.order_id = l.order_id and p.visible_to_client
  order by p.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
alter table public.order_photos enable row level security;
create policy order_photos_select on public.order_photos for select to authenticated
  using (private.can_view_order_files(company_id, order_id));
revoke insert, update, delete on public.order_photos from authenticated, anon;
grant select on public.order_photos to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.register_order_photo(uuid, text, jsonb) to authenticated;
grant execute on function public.update_order_photo(uuid, jsonb) to authenticated;
grant execute on function public.delete_order_photo(uuid) to authenticated;
grant execute on function private.can_upload_order_photo(uuid, uuid) to authenticated;
grant execute on function private.can_view_order_files(uuid, uuid) to authenticated;
-- As políticas do Storage avaliadas para visitantes chamam estas duas funções (só retornam booleano/uuid).
grant usage on schema private to anon;
grant execute on function private.path_uuid(text, int) to anon, authenticated;
grant execute on function private.is_client_visible_photo(text) to anon, authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.portal_photos(text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
