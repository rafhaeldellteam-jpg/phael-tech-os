-- =============================================================================
-- Cobrança com Pix
-- - Dados Pix da empresa (chave, nome e cidade do recebedor).
-- - Link público da cobrança (mesmo modelo do portal: token de 256 bits, só o
--   SHA-256 no banco, validade, revogação). A página mostra valor em aberto,
--   vencimento e o QR Code / copia e cola gerados a partir desses dados.
-- - Registro de envio (quem enviou, quando, para qual e-mail).
-- =============================================================================

alter table public.companies
  add column pix_key_type text check (pix_key_type in ('phone', 'email', 'cpf', 'cnpj', 'random')),
  add column pix_key text check (pix_key is null or char_length(pix_key) between 5 and 77),
  add column pix_merchant_name text check (pix_merchant_name is null or char_length(pix_merchant_name) between 2 and 25),
  add column pix_city text check (pix_city is null or char_length(pix_city) between 2 and 15),
  add constraint companies_pix_complete check ((pix_key is null) = (pix_key_type is null));
grant update (pix_key_type, pix_key, pix_merchant_name, pix_city) on public.companies to authenticated;

create table public.charge_links (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  entry_id        uuid not null,
  token_hash      bytea not null unique,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  sent_to         text check (sent_to is null or char_length(sent_to) <= 200),
  sent_at         timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_viewed_at  timestamptz,
  view_count      int not null default 0,
  foreign key (company_id, entry_id) references public.finance_entries (company_id, id) on delete restrict,
  check (expires_at > created_at)
);
create index charge_links_entry_idx on public.charge_links (entry_id);

create trigger charge_links_audit after insert or update of revoked_at, sent_at on public.charge_links
  for each row execute function private.audit_row_change('company_id', 'token_hash');

-- Gera o link da cobrança (só contas a receber em aberto).
create or replace function public.create_charge_link(p_entry_id uuid, p_days int default 30)
returns table (link_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.finance_entries;
  v_token text;
  v_id uuid;
  v_exp timestamptz;
begin
  select * into e from public.finance_entries where id = p_entry_id;
  if not found or not private.is_member(e.company_id) then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(e.company_id, 'finance.write');
  if e.direction <> 'in' then
    raise exception 'Só contas a receber geram cobrança' using errcode = '23514';
  end if;
  if e.canceled_at is not null or e.paid_cents >= e.amount_cents then
    raise exception 'Este lançamento não tem valor em aberto' using errcode = '23514';
  end if;
  if not exists (select 1 from public.companies c where c.id = e.company_id and c.pix_key is not null) then
    raise exception 'Cadastre a chave Pix em Dados da empresa antes de enviar cobranças' using errcode = '23514';
  end if;
  if p_days is null or p_days < 1 or p_days > 180 then
    raise exception 'Validade de 1 a 180 dias' using errcode = '23514';
  end if;
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  v_exp := now() + make_interval(days => p_days);
  insert into public.charge_links (company_id, entry_id, token_hash, expires_at, created_by)
  values (e.company_id, e.id, extensions.digest(v_token, 'sha256'), v_exp, auth.uid())
  returning id into v_id;
  return query select v_id, v_token, v_exp;
end;
$$;

-- Registra que a cobrança foi enviada (o envio em si é feito pelo e-mail de quem envia).
create or replace function public.mark_charge_sent(p_link_id uuid, p_sent_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.charge_links;
begin
  select * into l from public.charge_links where id = p_link_id for update;
  if not found or not private.is_member(l.company_id) then
    raise exception 'Link não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(l.company_id, 'finance.write');
  update public.charge_links set sent_to = left(btrim(coalesce(p_sent_to, '')), 200), sent_at = now() where id = l.id;
end;
$$;

create or replace function public.revoke_charge_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.charge_links;
begin
  select * into l from public.charge_links where id = p_link_id for update;
  if not found or not private.is_member(l.company_id) then
    raise exception 'Link não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(l.company_id, 'finance.write');
  update public.charge_links set revoked_at = coalesce(revoked_at, now()) where id = l.id;
end;
$$;

-- Página pública da cobrança.
create or replace function public.charge_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.charge_links;
  e public.finance_entries;
  c public.companies;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,60}$' then
    raise exception 'Link inválido ou expirado' using errcode = 'P0002';
  end if;
  select * into l from public.charge_links where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found or l.revoked_at is not null or l.expires_at <= now() then
    raise exception 'Link inválido ou expirado' using errcode = 'P0002';
  end if;
  update public.charge_links set last_viewed_at = now(), view_count = view_count + 1 where id = l.id;
  select * into e from public.finance_entries where id = l.entry_id;
  select * into c from public.companies where id = e.company_id;
  return jsonb_build_object(
    'company', jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email),
    'pix', case when c.pix_key is null then null else jsonb_build_object(
      'key', c.pix_key, 'key_type', c.pix_key_type,
      'name', coalesce(c.pix_merchant_name, left(c.name, 25)), 'city', coalesce(c.pix_city, 'BRASIL')) end,
    'entry', jsonb_build_object(
      'number', e.number,
      'description', e.description,
      'due_date', e.due_date,
      'amount_cents', e.amount_cents,
      'paid_cents', e.paid_cents,
      'open_cents', greatest(e.amount_cents - e.paid_cents, 0),
      'status', e.status
    ),
    'client_name', (select split_part(cl.name, ' ', 1) from public.clients cl where cl.id = e.client_id),
    'link_expires_at', l.expires_at
  );
end;
$$;

alter table public.charge_links enable row level security;
create policy charge_links_select on public.charge_links
  for select to authenticated using (private.has_permission(company_id, 'finance.read'));
revoke all on public.charge_links from anon;
revoke insert, update, delete, select on public.charge_links from authenticated;
grant select (id, company_id, entry_id, expires_at, revoked_at, sent_to, sent_at, created_by, created_at, last_viewed_at, view_count)
  on public.charge_links to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.create_charge_link(uuid, int) to authenticated;
grant execute on function public.mark_charge_sent(uuid, text) to authenticated;
grant execute on function public.revoke_charge_link(uuid) to authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
