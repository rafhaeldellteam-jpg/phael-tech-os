-- =============================================================================
-- Assinatura eletrônica nos comprovantes da OS
-- Cliente e empresa assinam na tela (desenho). Cada documento (entrada/entrega)
-- aceita uma assinatura do cliente e uma da empresa; depois de gravada ela não
-- muda nem é apagada (trigger de imutabilidade + auditoria). Guardamos quem
-- registrou, quando, o nome do signatário e o SHA-256 da imagem.
-- Observação: é assinatura eletrônica simples (Lei 14.063/2020, art. 4º, I),
-- não certificado ICP-Brasil.
-- =============================================================================

create type public.signature_document as enum ('intake', 'delivery');
create type public.signature_role as enum ('client', 'company');

create table public.order_signatures (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  order_id      uuid not null,
  document      public.signature_document not null,
  signer_role   public.signature_role not null,
  signer_name   text not null check (char_length(btrim(signer_name)) between 2 and 120),
  image_data    text not null check (image_data ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and char_length(image_data) <= 400000),
  image_sha256  text not null,
  recorded_by   uuid references auth.users (id) on delete set null,
  signed_at     timestamptz not null default now(),
  unique (order_id, document, signer_role),
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict
);
create index order_signatures_order_idx on public.order_signatures (order_id);

create trigger order_signatures_immutable
  before update or delete on public.order_signatures
  for each row execute function private.audit_log_immutable();
-- A imagem não vai para a auditoria (só os metadados).
create trigger order_signatures_audit
  after insert on public.order_signatures
  for each row execute function private.audit_row_change('company_id', 'image_data');

-- Assinatura salva de cada membro (para a empresa assinar sem desenhar toda vez).
create table public.member_signatures (
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  signer_name text not null check (char_length(btrim(signer_name)) between 2 and 120),
  image_data  text not null check (image_data ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and char_length(image_data) <= 400000),
  updated_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Registrar assinatura
-- -----------------------------------------------------------------------------
create or replace function public.sign_order(
  p_order_id uuid,
  p_document public.signature_document,
  p_role public.signature_role,
  p_signer_name text,
  p_image_data text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  v_id uuid;
begin
  if not (private.has_permission(v.company_id, 'orders.update') or private.has_permission(v.company_id, 'orders.deliver')) then
    raise exception 'Sem permissão para colher assinaturas' using errcode = '42501';
  end if;
  if p_document = 'delivery' and v.delivered_at is null then
    raise exception 'A assinatura de entrega só pode ser colhida depois de registrar a entrega' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_signer_name, ''))) < 2 then
    raise exception 'Informe o nome de quem assina' using errcode = '23514';
  end if;
  if p_image_data is null or char_length(p_image_data) < 200 or p_image_data !~ '^data:image/png;base64,' then
    raise exception 'Assinatura vazia' using errcode = '23514';
  end if;
  if exists (select 1 from public.order_signatures where order_id = v.id and document = p_document and signer_role = p_role) then
    raise exception 'Este documento já foi assinado por %', case p_role when 'client' then 'cliente' else 'empresa' end
      using errcode = '23505';
  end if;

  insert into public.order_signatures (company_id, order_id, document, signer_role, signer_name, image_data, image_sha256, recorded_by)
  values (
    v.company_id, v.id, p_document, p_role, btrim(coalesce(p_signer_name, '')), p_image_data,
    encode(extensions.digest(convert_to(p_image_data, 'UTF8'), 'sha256'), 'hex'),
    auth.uid()
  )
  returning id into v_id;

  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', auth.uid(),
          format('Assinatura %s colhida no comprovante de %s: %s',
                 case p_role when 'client' then 'do cliente' else 'da empresa' end,
                 case p_document when 'intake' then 'entrada' else 'entrega' end,
                 btrim(p_signer_name)));
  return v_id;
end;
$$;

create or replace function public.save_my_signature(p_company_id uuid, p_signer_name text, p_image_data text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_company_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  insert into public.member_signatures (company_id, user_id, signer_name, image_data)
  values (p_company_id, auth.uid(), btrim(coalesce(p_signer_name, '')), p_image_data)
  on conflict (company_id, user_id) do update
    set signer_name = excluded.signer_name, image_data = excluded.image_data, updated_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.order_signatures enable row level security;
alter table public.member_signatures enable row level security;

create policy order_signatures_select on public.order_signatures
  for select to authenticated
  using (exists (
    select 1 from public.service_orders o
    where o.id = order_id and private.can_access_order(o.company_id, o.assigned_to)
  ));
create policy member_signatures_select_own on public.member_signatures
  for select to authenticated
  using (user_id = auth.uid() and private.is_member(company_id));

revoke insert, update, delete on public.order_signatures, public.member_signatures from authenticated, anon;
grant select on public.order_signatures, public.member_signatures to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.sign_order(uuid, public.signature_document, public.signature_role, text, text) to authenticated;
grant execute on function public.save_my_signature(uuid, text, text) to authenticated;
