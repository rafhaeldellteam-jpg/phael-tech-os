-- =============================================================================
-- Fase 4: Portal do cliente
-- Link sem login para o cliente acompanhar UMA OS. O token (256 bits) só é
-- mostrado na criação; o banco guarda o SHA-256. Link tem validade, pode ser
-- revogado e registra acessos. Pelo portal o cliente vê só dados não sensíveis
-- (sem notas internas, custos, senhas, responsável) e, quando a OS está
-- "Aguardando aprovação", aprova ou recusa o orçamento.
-- =============================================================================

create table public.portal_links (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  order_id        uuid not null,
  token_hash      bytea not null unique,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_viewed_at  timestamptz,
  view_count      int not null default 0,
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict,
  check (expires_at > created_at)
);
create index portal_links_order_idx on public.portal_links (order_id);

create trigger portal_links_audit after insert or update of revoked_at on public.portal_links
  for each row execute function private.audit_row_change('company_id', 'token_hash');

-- -----------------------------------------------------------------------------
-- Gerar e revogar links (equipe)
-- -----------------------------------------------------------------------------
create or replace function public.create_portal_link(p_order_id uuid, p_days int default 30)
returns table (link_id uuid, token text, expires_at timestamptz)
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
  if not (private.has_permission(v.company_id, 'orders.update')
          or private.has_permission(v.company_id, 'orders.create')
          or private.has_permission(v.company_id, 'orders.deliver')) then
    raise exception 'Sem permissão para compartilhar a OS' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 180 then
    raise exception 'Validade de 1 a 180 dias' using errcode = '23514';
  end if;
  -- 32 bytes aleatórios em base64url (sem +, / e =), seguro para URL.
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_exp := now() + make_interval(days => p_days);
  insert into public.portal_links (company_id, order_id, token_hash, expires_at, created_by)
  values (v.company_id, v.id, extensions.digest(v_token, 'sha256'), v_exp, auth.uid())
  returning id into v_id;
  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', auth.uid(), format('Link de acompanhamento gerado (válido até %s)', to_char(v_exp at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')));
  return query select v_id, v_token, v_exp;
end;
$$;

create or replace function public.revoke_portal_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.portal_links;
begin
  select * into l from public.portal_links where id = p_link_id for update;
  if not found then
    raise exception 'Link não encontrado' using errcode = 'P0002';
  end if;
  perform private.lock_order(l.order_id);
  if not (private.has_permission(l.company_id, 'orders.update') or private.has_permission(l.company_id, 'orders.create')) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update public.portal_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Acesso público pelo token
-- -----------------------------------------------------------------------------
create or replace function private.portal_link_for(p_token text)
returns public.portal_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.portal_links;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,60}$' then
    raise exception 'Link inválido ou expirado' using errcode = 'P0002';
  end if;
  select * into l from public.portal_links where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found or l.revoked_at is not null or l.expires_at <= now() then
    raise exception 'Link inválido ou expirado' using errcode = 'P0002';
  end if;
  return l;
end;
$$;

create or replace function public.portal_order(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.portal_links := private.portal_link_for(p_token);
  o public.service_orders;
  r jsonb;
begin
  update public.portal_links set last_viewed_at = now(), view_count = view_count + 1 where id = l.id;
  select * into o from public.service_orders where id = l.order_id;

  select jsonb_build_object(
    'company', (select jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email, 'delivery_terms', c.delivery_terms)
                from public.companies c where c.id = o.company_id),
    'order', jsonb_build_object(
      'number', o.number,
      'status', o.status,
      'status_label', s.label,
      'stage', s.stage,
      'mode', o.mode,
      'reported_problem', o.reported_problem,
      'received_at', o.received_at,
      'due_at', o.due_at,
      'ready_at', o.ready_at,
      'delivered_at', o.delivered_at,
      'can_decide', o.status = 'awaiting_approval'
    ),
    'client_name', (select split_part(cl.name, ' ', 1) from public.clients cl where cl.id = o.client_id),
    'equipment', (select nullif(concat_ws(' ', e.manufacturer, e.model), '') from public.equipment e where e.id = o.equipment_id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'description', i.description, 'qty', i.qty,
        'unit_price_cents', i.unit_price_cents, 'discount_cents', i.discount_cents,
        'total_cents', i.qty * i.unit_price_cents - i.discount_cents, 'warranty_days', i.warranty_days
      ) order by i.created_at)
      from public.service_order_items i where i.order_id = o.id and i.returned_at is null
    ), '[]'::jsonb),
    'total_cents', (select coalesce(sum(i.qty * i.unit_price_cents - i.discount_cents), 0)
                    from public.service_order_items i where i.order_id = o.id and i.returned_at is null),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('at', ev.created_at, 'label', st.label) order by ev.created_at, ev.id)
      from public.service_order_events ev
      join public.service_order_statuses st on st.key = coalesce(ev.to_status, 'received')
      where ev.order_id = o.id and ev.kind in ('created', 'status')
    ), '[]'::jsonb),
    'warranties', coalesce((
      select jsonb_agg(jsonb_build_object('description', i.description,
        'until', private.item_warranty_end(o.delivered_at, i.warranty_days)) order by i.created_at)
      from public.service_order_items i
      where i.order_id = o.id and i.returned_at is null and coalesce(i.warranty_days, 0) > 0 and o.delivered_at is not null
    ), '[]'::jsonb),
    'link_expires_at', l.expires_at
  ) into r
  from public.service_order_statuses s where s.key = o.status;
  return r;
end;
$$;

-- Aprovação/recusa do orçamento pelo cliente.
create or replace function public.portal_decide(p_token text, p_approve boolean, p_name text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.portal_links := private.portal_link_for(p_token);
  o public.service_orders;
  v_to text := case when p_approve then 'in_repair' else 'quote_refused' end;
  v_name text := btrim(coalesce(p_name, ''));
  v_note text := private.clean(p_note);
begin
  if p_approve is null then
    raise exception 'Escolha aprovar ou recusar' using errcode = '23514';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Informe seu nome' using errcode = '23514';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Observação muito longa' using errcode = '23514';
  end if;
  select * into o from public.service_orders where id = l.order_id for update;
  if o.status <> 'awaiting_approval' then
    raise exception 'Esta OS não está aguardando aprovação' using errcode = '23514';
  end if;
  if not exists (select 1 from public.service_order_transitions where from_status = o.status and to_status = v_to) then
    raise exception 'Mudança de status não permitida' using errcode = '23514';
  end if;

  update public.service_orders set status = v_to where id = o.id;
  insert into public.service_order_events (company_id, order_id, kind, from_status, to_status, reason, note, actor_id)
  values (o.company_id, o.id, 'status', o.status, v_to,
          case when p_approve then null else coalesce(v_note, 'Recusado pelo cliente no portal') end,
          format('%s pelo cliente no portal: %s%s', case when p_approve then 'Orçamento aprovado' else 'Orçamento recusado' end,
                 v_name, coalesce(E'\n' || v_note, '')),
          null);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS e permissões
-- -----------------------------------------------------------------------------
alter table public.portal_links enable row level security;
create policy portal_links_select on public.portal_links
  for select to authenticated
  using (exists (
    select 1 from public.service_orders o
    where o.id = order_id and private.can_access_order(o.company_id, o.assigned_to)
  ));
revoke all on public.portal_links from anon;
revoke insert, update, delete on public.portal_links from authenticated;
-- token_hash nunca sai do banco.
revoke select on public.portal_links from authenticated;
grant select (id, company_id, order_id, expires_at, revoked_at, created_by, created_at, last_viewed_at, view_count)
  on public.portal_links to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.create_portal_link(uuid, int) to authenticated;
grant execute on function public.revoke_portal_link(uuid) to authenticated;
-- As duas únicas funções abertas a visitantes sem login: exigem o token.
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
