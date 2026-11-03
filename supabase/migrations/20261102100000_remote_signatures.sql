-- =============================================================================
-- Assinatura do cliente à distância (link)
-- A equipe gera um link para o comprovante (entrada ou entrega). O cliente abre
-- sem login, vê o documento, assina na tela e envia. Só pode assinar uma vez
-- (índice único de order_signatures por OS, documento e papel). A assinatura
-- entra no mesmo lugar das colhidas no balcão, então aparece no documento e no
-- PDF. Guardamos o canal, o IP e o navegador de quem assinou pelo link.
-- O token tem 256 bits; só o SHA-256 fica no banco.
-- =============================================================================

alter table public.order_signatures
  add column channel text not null default 'in_person' check (channel in ('in_person', 'remote_link')),
  add column signer_ip text check (signer_ip is null or char_length(signer_ip) <= 100),
  add column signer_user_agent text check (signer_user_agent is null or char_length(signer_user_agent) <= 300);

create table public.signature_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  order_id      uuid not null,
  document      public.signature_document not null,
  token_hash    bytea not null unique,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  signed_at     timestamptz,
  signature_id  uuid references public.order_signatures (id) on delete restrict,
  view_count    int not null default 0,
  last_viewed_at timestamptz,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict,
  check (expires_at > created_at)
);
create index signature_requests_order_idx on public.signature_requests (order_id, created_at desc);
create trigger signature_requests_audit after insert or update on public.signature_requests
  for each row execute function private.audit_row_change('company_id', 'token_hash');

-- -----------------------------------------------------------------------------
-- Equipe: gerar e revogar link
-- -----------------------------------------------------------------------------
create or replace function public.create_signature_request(p_order_id uuid, p_document public.signature_document, p_days int default 7)
returns table (request_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  v_token text;
  v_id uuid;
  v_exp timestamptz;
begin
  if not (private.has_permission(v.company_id, 'orders.update') or private.has_permission(v.company_id, 'orders.deliver')) then
    raise exception 'Sem permissão para colher assinaturas' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Validade de 1 a 30 dias' using errcode = '23514';
  end if;
  if p_document = 'delivery' and v.delivered_at is null then
    raise exception 'A assinatura de entrega só pode ser colhida depois de registrar a entrega' using errcode = '23514';
  end if;
  if exists (select 1 from public.order_signatures s where s.order_id = v.id and s.document = p_document and s.signer_role = 'client') then
    raise exception 'O cliente já assinou este documento' using errcode = '23505';
  end if;

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_exp := now() + make_interval(days => p_days);
  insert into public.signature_requests (company_id, order_id, document, token_hash, expires_at, created_by)
  values (v.company_id, v.id, p_document, extensions.digest(v_token, 'sha256'), v_exp, auth.uid())
  returning id into v_id;
  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', auth.uid(),
          format('Link de assinatura do comprovante de %s gerado (válido até %s)',
                 case p_document when 'intake' then 'entrada' else 'entrega' end,
                 to_char(v_exp at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')));
  return query select v_id, v_token, v_exp;
end;
$$;

create or replace function public.revoke_signature_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.signature_requests;
  v public.service_orders;
begin
  select * into r from public.signature_requests where id = p_request_id for update;
  if not found then
    raise exception 'Link não encontrado' using errcode = 'P0002';
  end if;
  v := private.lock_order(r.order_id);
  if not (private.has_permission(v.company_id, 'orders.update') or private.has_permission(v.company_id, 'orders.deliver')) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if r.revoked_at is null and r.signed_at is null then
    update public.signature_requests set revoked_at = now() where id = r.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cliente (sem login, com o token)
-- -----------------------------------------------------------------------------
create or replace function private.signature_request_for(p_token text)
returns public.signature_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.signature_requests;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,60}$' then
    raise exception 'Link inválido ou expirado' using errcode = 'P0002';
  end if;
  select * into r from public.signature_requests where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found or r.revoked_at is not null or r.expires_at <= now() then
    raise exception 'Link inválido ou expirado' using errcode = 'P0002';
  end if;
  return r;
end;
$$;

-- Tudo o que o cliente precisa para ler o documento antes de assinar e baixar
-- o PDF depois: dados da OS, itens, totais, garantias, termos e assinaturas.
-- Não expõe custos, notas internas, senha do equipamento nem CPF/CNPJ do cliente.
create or replace function public.signature_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.signature_requests := private.signature_request_for(p_token);
  o public.service_orders;
  res jsonb;
begin
  update public.signature_requests set view_count = view_count + 1, last_viewed_at = now() where id = r.id;
  select * into o from public.service_orders where id = r.order_id;

  select jsonb_build_object(
    'document', r.document,
    'expires_at', r.expires_at,
    'company', (select jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'tax_id', c.tax_id, 'phone', c.phone,
                  'email', c.email, 'intake_terms', c.intake_terms, 'delivery_terms', c.delivery_terms)
                from public.companies c where c.id = o.company_id),
    'order', jsonb_build_object(
      'number', o.number, 'mode', o.mode, 'status_label', (select s.label from public.service_order_statuses s where s.key = o.status),
      'received_at', o.received_at, 'delivered_at', o.delivered_at, 'due_at', o.due_at,
      'reported_problem', o.reported_problem, 'intake_condition', o.intake_condition,
      'intake_accessories', to_jsonb(o.intake_accessories)),
    'client', (select jsonb_build_object('name', cl.name, 'whatsapp', cl.whatsapp, 'phone', cl.phone, 'email', cl.email)
               from public.clients cl where cl.id = o.client_id),
    'equipment', (select jsonb_build_object(
                    'title', coalesce(nullif(concat_ws(' ', e.manufacturer, e.model), ''), t.label),
                    'serial', e.serial_number)
                  from public.equipment e left join public.equipment_types t on t.key = e.type
                  where e.id = o.equipment_id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('kind', i.kind, 'description', i.description, 'qty', i.qty,
        'unit_price_cents', i.unit_price_cents, 'discount_cents', i.discount_cents) order by i.created_at)
      from public.service_order_items i where i.order_id = o.id and i.returned_at is null
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'services_cents', coalesce(sum(qty * unit_price_cents) filter (where kind = 'service'), 0),
        'parts_cents', coalesce(sum(qty * unit_price_cents) filter (where kind = 'part'), 0),
        'discount_cents', coalesce(sum(discount_cents), 0),
        'total_cents', coalesce(sum(qty * unit_price_cents - discount_cents), 0))
      from public.service_order_items i where i.order_id = o.id and i.returned_at is null),
    'warranties', coalesce((
      select jsonb_agg(jsonb_build_object('description', i.description, 'warranty_days', i.warranty_days,
        'expires_on', private.item_warranty_end(o.delivered_at, i.warranty_days)) order by i.created_at)
      from public.service_order_items i
      where i.order_id = o.id and i.returned_at is null and coalesce(i.warranty_days, 0) > 0 and o.delivered_at is not null
    ), '[]'::jsonb),
    'signatures', coalesce((
      select jsonb_agg(jsonb_build_object('signer_role', s.signer_role, 'signer_name', s.signer_name,
        'image_data', s.image_data, 'signed_at', s.signed_at, 'channel', s.channel) order by s.signed_at)
      from public.order_signatures s where s.order_id = o.id and s.document = r.document
    ), '[]'::jsonb)
  ) into res;
  return res;
end;
$$;

create or replace function public.sign_by_link(p_token text, p_signer_name text, p_image_data text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.signature_requests := private.signature_request_for(p_token);
  v public.service_orders := private.lock_order_unchecked(r.order_id);
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}');
  v_id uuid;
  v_at timestamptz;
begin
  if char_length(btrim(coalesce(p_signer_name, ''))) < 2 or char_length(btrim(p_signer_name)) > 120 then
    raise exception 'Informe o seu nome completo' using errcode = '23514';
  end if;
  if p_image_data is null or char_length(p_image_data) < 200 or p_image_data !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
     or char_length(p_image_data) > 400000 then
    raise exception 'Assinatura vazia ou inválida' using errcode = '23514';
  end if;
  if r.document = 'delivery' and v.delivered_at is null then
    raise exception 'Este documento ainda não pode ser assinado' using errcode = '23514';
  end if;
  if exists (select 1 from public.order_signatures s where s.order_id = v.id and s.document = r.document and s.signer_role = 'client') then
    raise exception 'Este documento já foi assinado' using errcode = '23505';
  end if;

  insert into public.order_signatures (company_id, order_id, document, signer_role, signer_name, image_data, image_sha256,
                                       recorded_by, channel, signer_ip, signer_user_agent)
  values (v.company_id, v.id, r.document, 'client', btrim(p_signer_name), p_image_data,
          encode(extensions.digest(convert_to(p_image_data, 'UTF8'), 'sha256'), 'hex'),
          null, 'remote_link',
          left(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'x-real-ip', ''), ',', 1)), 100),
          left(v_headers ->> 'user-agent', 300))
  returning id, signed_at into v_id, v_at;

  update public.signature_requests set signed_at = v_at, signature_id = v_id where id = r.id;
  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', null,
          format('Cliente assinou o comprovante de %s pelo link: %s',
                 case r.document when 'intake' then 'entrada' else 'entrega' end, btrim(p_signer_name)));
  return v_at;
end;
$$;

-- Trava da OS sem checar permissão (o acesso já foi validado pelo token).
create or replace function private.lock_order_unchecked(p_order_id uuid)
returns public.service_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders;
begin
  select * into v from public.service_orders where id = p_order_id for update;
  if not found then
    raise exception 'Link inválido ou expirado' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
alter table public.signature_requests enable row level security;
create policy signature_requests_select on public.signature_requests
  for select to authenticated
  using (exists (
    select 1 from public.service_orders o
    where o.id = order_id and private.can_access_order(o.company_id, o.assigned_to)
  ));
revoke all on public.signature_requests from authenticated, anon;
grant select (id, company_id, order_id, document, expires_at, revoked_at, signed_at, signature_id, view_count, last_viewed_at, created_by, created_at)
  on public.signature_requests to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.create_signature_request(uuid, public.signature_document, int) to authenticated;
grant execute on function public.revoke_signature_request(uuid) to authenticated;
-- Funções abertas a visitantes sem login: todas exigem um token válido.
grant execute on function public.signature_view(text) to anon, authenticated;
grant execute on function public.sign_by_link(text, text, text) to anon, authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.portal_photos(text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
grant execute on function private.path_uuid(text, int) to anon, authenticated;
grant execute on function private.is_client_visible_photo(text) to anon, authenticated;
