-- =============================================================================
-- Diagnóstico com checklist e orçamento com versões
-- Checklist: modelos por tipo de equipamento; cada diagnóstico guarda uma cópia
--   dos itens (o modelo pode mudar sem alterar diagnósticos antigos). Depois de
--   concluído, o diagnóstico não muda.
-- Orçamento: rascunho editável -> enviado (travado) -> aprovado/recusado.
--   Mudança depois de enviado = nova versão; a anterior vira "substituída".
--   Aprovação pela equipe ou pelo portal do cliente. Itens aprovados podem ser
--   lançados na OS uma única vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Checklists
-- -----------------------------------------------------------------------------
create table public.checklist_templates (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 2 and 80),
  equipment_type  text references public.equipment_types (key),
  items           text[] not null check (cardinality(items) between 1 and 60),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, id)
);
create unique index checklist_templates_name_uidx on public.checklist_templates (company_id, lower(name));
create trigger checklist_templates_set_updated_at before update on public.checklist_templates
  for each row execute function private.set_updated_at();

create table public.order_diagnostics (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  order_id        uuid not null,
  template_name   text,
  results         jsonb not null check (jsonb_typeof(results) = 'array'),
  summary         text check (summary is null or char_length(summary) <= 4000),
  technician_id   uuid references auth.users (id) on delete set null,
  finalized_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict
);
create index order_diagnostics_order_idx on public.order_diagnostics (order_id);
create trigger order_diagnostics_set_updated_at before update on public.order_diagnostics
  for each row execute function private.set_updated_at();
create trigger order_diagnostics_audit after insert or update on public.order_diagnostics
  for each row execute function private.audit_row_change('company_id');

-- Valida e normaliza o array [{label, result, note}] (result: ok | fail | na | null).
create or replace function private.clean_checklist(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  r jsonb := '[]';
  it jsonb;
  v_label text;
  v_result text;
  v_note text;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 60 then
    raise exception 'Checklist inválido' using errcode = '23514';
  end if;
  for it in select * from jsonb_array_elements(p) loop
    v_label := btrim(coalesce(it ->> 'label', ''));
    v_result := nullif(it ->> 'result', '');
    v_note := nullif(btrim(coalesce(it ->> 'note', '')), '');
    if char_length(v_label) < 1 or char_length(v_label) > 120 then
      raise exception 'Item de checklist sem nome' using errcode = '23514';
    end if;
    if v_result is not null and v_result not in ('ok', 'fail', 'na') then
      raise exception 'Resultado inválido: %', v_result using errcode = '23514';
    end if;
    if v_note is not null and char_length(v_note) > 500 then
      raise exception 'Observação do item muito longa' using errcode = '23514';
    end if;
    r := r || jsonb_build_array(jsonb_build_object('label', v_label, 'result', v_result, 'note', v_note));
  end loop;
  return r;
end;
$$;

create or replace function public.seed_checklist_templates(p_company_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  perform private.require_permission(p_company_id, 'diagnostics.write');
  insert into public.checklist_templates (company_id, name, equipment_type, items)
  values
    (p_company_id, 'Notebook', 'notebook', array[
      'Liga e dá vídeo', 'Tela sem manchas ou linhas', 'Teclado', 'Touchpad', 'Bateria segura carga', 'Carregador original funcionando',
      'Wi-Fi', 'Bluetooth', 'Portas USB', 'Áudio (alto-falante e fone)', 'Webcam e microfone', 'Saúde do armazenamento (SMART)',
      'Temperatura em uso', 'Dobradiças', 'Sistema inicia sem erros']),
    (p_company_id, 'Computador de mesa', 'desktop', array[
      'Liga e dá vídeo', 'Fonte (tensões estáveis)', 'Memória (teste)', 'Saúde do armazenamento (SMART)', 'Temperatura em uso',
      'Ventoinhas', 'Portas USB frontais e traseiras', 'Rede cabeada', 'Áudio', 'Sistema inicia sem erros']),
    (p_company_id, 'Impressora', 'printer', array[
      'Liga sem erros', 'Puxa papel', 'Qualidade de impressão', 'Cabeça/toner', 'Conexão USB', 'Conexão Wi-Fi/rede', 'Scanner']),
    (p_company_id, 'Celular', 'phone', array[
      'Liga', 'Tela e touch', 'Bateria segura carga', 'Conector de carga', 'Câmeras', 'Microfone e alto-falante', 'Wi-Fi e Bluetooth', 'Chip/operadora', 'Biometria'])
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- p_data: name, equipment_type, items[], active
create or replace function public.save_checklist_template(p_company_id uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_items text[];
begin
  perform private.require_permission(p_company_id, 'diagnostics.write');
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into v_items
  from jsonb_array_elements_text(coalesce(p_data -> 'items', '[]')) x;
  if cardinality(v_items) = 0 then
    raise exception 'Inclua pelo menos um item' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(v_items) i where char_length(i) > 120) then
    raise exception 'Item com mais de 120 caracteres' using errcode = '23514';
  end if;
  if p_id is null then
    insert into public.checklist_templates (company_id, name, equipment_type, items)
    values (p_company_id, btrim(coalesce(p_data ->> 'name', '')), nullif(p_data ->> 'equipment_type', ''), v_items)
    returning id into v_id;
  else
    update public.checklist_templates set
      name = btrim(coalesce(p_data ->> 'name', name)),
      equipment_type = nullif(p_data ->> 'equipment_type', ''),
      items = v_items,
      active = coalesce((p_data ->> 'active')::boolean, active)
    where id = p_id and company_id = p_company_id;
    if not found then
      raise exception 'Modelo não encontrado' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.start_diagnostic(p_order_id uuid, p_template_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  t public.checklist_templates;
  v_id uuid;
begin
  perform private.require_permission(v.company_id, 'diagnostics.write');
  if v.status in (select key from public.service_order_statuses where stage in ('done', 'stopped')) then
    raise exception 'OS concluída ou encerrada não recebe diagnóstico' using errcode = '23514';
  end if;
  select * into t from public.checklist_templates where id = p_template_id and company_id = v.company_id and active;
  if not found then
    raise exception 'Modelo de checklist não encontrado' using errcode = 'P0002';
  end if;
  insert into public.order_diagnostics (company_id, order_id, template_name, results, technician_id)
  values (v.company_id, v.id, t.name,
          (select jsonb_agg(jsonb_build_object('label', i, 'result', null, 'note', null) order by n) from unnest(t.items) with ordinality u(i, n)),
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.save_diagnostic(p_diagnostic_id uuid, p_results jsonb, p_summary text, p_finalize boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.order_diagnostics;
  v public.service_orders;
  v_results jsonb := private.clean_checklist(p_results);
  v_summary text := private.clean(p_summary);
  v_fails int;
begin
  select * into d from public.order_diagnostics where id = p_diagnostic_id for update;
  if not found then
    raise exception 'Diagnóstico não encontrado' using errcode = 'P0002';
  end if;
  v := private.lock_order(d.order_id);
  perform private.require_permission(v.company_id, 'diagnostics.write');
  if d.finalized_at is not null then
    raise exception 'Diagnóstico concluído não pode ser alterado' using errcode = '23514';
  end if;
  if p_finalize then
    if exists (select 1 from jsonb_array_elements(v_results) x where x ->> 'result' is null) then
      raise exception 'Marque todos os itens antes de concluir (use "não se aplica" quando for o caso)' using errcode = '23514';
    end if;
    if v_summary is null then
      raise exception 'Escreva o laudo (conclusão) antes de concluir' using errcode = '23514';
    end if;
  end if;
  update public.order_diagnostics set
    results = v_results,
    summary = v_summary,
    technician_id = coalesce(technician_id, auth.uid()),
    finalized_at = case when p_finalize then now() else null end
  where id = d.id;

  if p_finalize then
    select count(*) into v_fails from jsonb_array_elements(v_results) x where x ->> 'result' = 'fail';
    insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
    values (v.company_id, v.id, 'note', auth.uid(),
            format('Diagnóstico concluído (%s, %s item(ns) com defeito): %s', coalesce(d.template_name, 'checklist'), v_fails, v_summary));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Orçamentos
-- -----------------------------------------------------------------------------
create type public.quote_status as enum ('draft', 'sent', 'approved', 'refused', 'superseded', 'canceled');

create table public.quotes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  order_id          uuid not null,
  version           int not null check (version >= 1),
  status            public.quote_status not null default 'draft',
  items             jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  total_cents       bigint not null default 0 check (total_cents >= 0),
  valid_until       date,
  delivery_days     int check (delivery_days is null or delivery_days between 0 and 365),
  notes             text check (notes is null or char_length(notes) <= 2000),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  sent_at           timestamptz,
  decided_at        timestamptz,
  decided_via       text check (decided_via in ('staff', 'portal')),
  decided_by_name   text check (decided_by_name is null or char_length(decided_by_name) <= 120),
  decision_note     text check (decision_note is null or char_length(decision_note) <= 1000),
  applied_at        timestamptz,
  unique (order_id, version),
  unique (company_id, id),
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict
);
create index quotes_order_idx on public.quotes (order_id, version desc);
-- No máximo um orçamento "vivo" (rascunho ou enviado) por OS de cada vez.
create unique index quotes_one_draft_uidx on public.quotes (order_id) where status = 'draft';
create unique index quotes_one_sent_uidx on public.quotes (order_id) where status = 'sent';

create trigger quotes_set_updated_at before update on public.quotes
  for each row execute function private.set_updated_at();
create trigger quotes_audit after insert or update on public.quotes
  for each row execute function private.audit_row_change('company_id');

-- Valida itens [{kind, description, qty, unit_price_cents, discount_cents, warranty_days}] e calcula o total.
create or replace function private.clean_quote_items(p jsonb, out items jsonb, out total bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  it jsonb;
  v_kind text;
  v_desc text;
  v_qty int;
  v_price bigint;
  v_disc bigint;
  v_war int;
begin
  items := '[]';
  total := 0;
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 80 then
    raise exception 'Itens do orçamento inválidos' using errcode = '23514';
  end if;
  for it in select * from jsonb_array_elements(p) loop
    v_kind := coalesce(it ->> 'kind', 'service');
    v_desc := btrim(coalesce(it ->> 'description', ''));
    v_qty := coalesce((it ->> 'qty')::int, 1);
    v_price := (it ->> 'unit_price_cents')::bigint;
    v_disc := coalesce((it ->> 'discount_cents')::bigint, 0);
    v_war := nullif(it ->> 'warranty_days', '')::int;
    if v_kind not in ('service', 'part') then
      raise exception 'Tipo de item inválido' using errcode = '23514';
    end if;
    if char_length(v_desc) < 2 or char_length(v_desc) > 200 then
      raise exception 'Descreva cada item (2 a 200 caracteres)' using errcode = '23514';
    end if;
    if v_qty < 1 or v_qty > 9999 or v_price is null or v_price < 0 or v_disc < 0 or v_disc > v_qty * v_price then
      raise exception 'Quantidade, valor ou desconto inválido em "%"', v_desc using errcode = '23514';
    end if;
    if v_war is not null and (v_war < 0 or v_war > 3650) then
      raise exception 'Garantia inválida em "%"', v_desc using errcode = '23514';
    end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'kind', v_kind, 'description', v_desc, 'qty', v_qty, 'unit_price_cents', v_price,
      'discount_cents', v_disc, 'warranty_days', v_war,
      'product_id', nullif(it ->> 'product_id', ''), 'catalog_id', nullif(it ->> 'catalog_id', '')));
    total := total + v_qty * v_price - v_disc;
  end loop;
end;
$$;

-- Cria ou edita o rascunho. p_quote_id nulo = novo rascunho (próxima versão).
-- p_data: items[], valid_until, delivery_days, notes
create or replace function public.save_quote(p_order_id uuid, p_quote_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
  q public.quotes;
  c record;
  v_id uuid := p_quote_id;
begin
  perform private.require_permission(v.company_id, 'quotes.write');
  if v.status in (select key from public.service_order_statuses where stage in ('done', 'stopped')) then
    raise exception 'OS concluída ou encerrada não recebe orçamento' using errcode = '23514';
  end if;
  select * into c from private.clean_quote_items(coalesce(p_data -> 'items', '[]'));
  if p_quote_id is null then
    if exists (select 1 from public.quotes where order_id = v.id and status = 'draft') then
      raise exception 'Já existe um rascunho de orçamento nesta OS' using errcode = '23505';
    end if;
    insert into public.quotes (company_id, order_id, version, items, total_cents, valid_until, delivery_days, notes, created_by)
    values (v.company_id, v.id, coalesce((select max(version) from public.quotes where order_id = v.id), 0) + 1,
            c.items, c.total, nullif(p_data ->> 'valid_until', '')::date,
            nullif(p_data ->> 'delivery_days', '')::int, private.clean(p_data ->> 'notes'), auth.uid())
    returning id into v_id;
  else
    select * into q from public.quotes where id = p_quote_id and order_id = v.id for update;
    if not found then
      raise exception 'Orçamento não encontrado' using errcode = 'P0002';
    end if;
    if q.status <> 'draft' then
      raise exception 'Orçamento enviado não pode ser alterado: crie uma nova versão' using errcode = '23514';
    end if;
    update public.quotes set
      items = c.items, total_cents = c.total,
      valid_until = nullif(p_data ->> 'valid_until', '')::date,
      delivery_days = nullif(p_data ->> 'delivery_days', '')::int,
      notes = private.clean(p_data ->> 'notes')
    where id = q.id;
  end if;
  return v_id;
end;
$$;

-- Nova versão a partir de uma anterior (copia itens para um rascunho).
create or replace function public.new_quote_version(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Orçamento não encontrado' using errcode = 'P0002';
  end if;
  return public.save_quote(q.order_id, null, jsonb_build_object(
    'items', q.items, 'valid_until', greatest(q.valid_until, current_date + 7), 'delivery_days', q.delivery_days, 'notes', q.notes));
end;
$$;

-- Envia (trava) o rascunho; a versão enviada anterior vira "substituída" e a OS vai para "Aguardando aprovação".
create or replace function public.send_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v public.service_orders;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Orçamento não encontrado' using errcode = 'P0002';
  end if;
  v := private.lock_order(q.order_id);
  perform private.require_permission(v.company_id, 'quotes.write');
  if q.status <> 'draft' then
    raise exception 'Só rascunhos podem ser enviados' using errcode = '23514';
  end if;
  if jsonb_array_length(q.items) = 0 then
    raise exception 'Inclua ao menos um item no orçamento' using errcode = '23514';
  end if;
  update public.quotes set status = 'superseded' where order_id = q.order_id and status = 'sent';
  update public.quotes set status = 'sent', sent_at = now(),
    valid_until = coalesce(valid_until, current_date + 7) where id = q.id;

  if v.status <> 'awaiting_approval' and exists (
    select 1 from public.service_order_transitions where from_status = v.status and to_status = 'awaiting_approval'
  ) then
    update public.service_orders set status = 'awaiting_approval' where id = v.id;
    insert into public.service_order_events (company_id, order_id, kind, from_status, to_status, actor_id)
    values (v.company_id, v.id, 'status', v.status, 'awaiting_approval', auth.uid());
  end if;
  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', auth.uid(),
          format('Orçamento v%s enviado: %s', q.version, to_char(q.total_cents / 100.0, 'FM999G999G990D00')));
end;
$$;

-- Decisão (núcleo): aplica no orçamento e no status da OS.
create or replace function private.decide_quote(q public.quotes, p_approve boolean, p_via text, p_name text, p_note text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders;
  v_to text := case when p_approve then 'in_repair' else 'quote_refused' end;
begin
  if q.status <> 'sent' then
    raise exception 'Este orçamento não está aguardando decisão' using errcode = '23514';
  end if;
  if q.valid_until is not null and q.valid_until < (now() at time zone 'America/Sao_Paulo')::date and p_approve then
    raise exception 'Orçamento vencido em %. Peça uma nova versão.', to_char(q.valid_until, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  update public.quotes set status = case when p_approve then 'approved'::public.quote_status else 'refused'::public.quote_status end,
    decided_at = now(), decided_via = p_via, decided_by_name = left(p_name, 120), decision_note = left(p_note, 1000)
  where id = q.id;

  select * into v from public.service_orders where id = q.order_id for update;
  if v.status = 'awaiting_approval' and exists (
    select 1 from public.service_order_transitions where from_status = v.status and to_status = v_to
  ) then
    update public.service_orders set status = v_to where id = v.id;
    insert into public.service_order_events (company_id, order_id, kind, from_status, to_status, reason, actor_id)
    values (v.company_id, v.id, 'status', v.status, v_to,
            case when p_approve then null else coalesce(p_note, 'Orçamento recusado') end, p_actor);
  end if;
  insert into public.service_order_events (company_id, order_id, kind, actor_id, note)
  values (v.company_id, v.id, 'note', p_actor,
          format('Orçamento v%s %s %s: %s%s', q.version, case when p_approve then 'aprovado' else 'recusado' end,
                 case p_via when 'portal' then 'pelo cliente no portal' else 'registrado pela equipe' end,
                 p_name, coalesce(E'\n' || p_note, '')));
end;
$$;

create or replace function public.decide_quote_staff(p_quote_id uuid, p_approve boolean, p_name text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Orçamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.lock_order(q.order_id);
  perform private.require_permission(q.company_id, 'quotes.record_decision');
  if char_length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'Informe quem aprovou ou recusou (nome do cliente)' using errcode = '23514';
  end if;
  perform private.decide_quote(q, p_approve, 'staff', btrim(p_name), private.clean(p_note), auth.uid());
end;
$$;

-- Lança os itens aprovados na OS (uma vez). Peças com produto baixam estoque como no lançamento normal.
create or replace function public.apply_quote_items(p_quote_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  it jsonb;
  n int := 0;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Orçamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.lock_order(q.order_id);
  perform private.require_permission(q.company_id, 'orders.update');
  if q.status <> 'approved' then
    raise exception 'Só orçamentos aprovados podem ser lançados na OS' using errcode = '23514';
  end if;
  if q.applied_at is not null then
    raise exception 'Os itens deste orçamento já foram lançados na OS' using errcode = '23505';
  end if;
  for it in select * from jsonb_array_elements(q.items) loop
    if it ->> 'kind' = 'part' and it ->> 'product_id' is null then
      -- Peça sem cadastro no estoque entra como serviço/avulso com a mesma descrição e valor.
      perform public.add_order_item(q.order_id, (it - 'product_id' - 'catalog_id') || jsonb_build_object('kind', 'service'));
    else
      perform public.add_order_item(q.order_id, it);
    end if;
    n := n + 1;
  end loop;
  update public.quotes set applied_at = now() where id = q.id;
  return n;
end;
$$;

create or replace function public.cancel_quote(p_quote_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  select * into q from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Orçamento não encontrado' using errcode = 'P0002';
  end if;
  perform private.lock_order(q.order_id);
  perform private.require_permission(q.company_id, 'quotes.write');
  if q.status not in ('draft', 'sent') then
    raise exception 'Este orçamento não pode ser cancelado' using errcode = '23514';
  end if;
  update public.quotes set status = 'canceled' where id = q.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Portal: mostra o orçamento enviado e decide sobre ele
-- -----------------------------------------------------------------------------
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
  qt public.quotes;
begin
  update public.portal_links set last_viewed_at = now(), view_count = view_count + 1 where id = l.id;
  select * into o from public.service_orders where id = l.order_id;
  select * into qt from public.quotes where order_id = o.id and status in ('sent', 'approved', 'refused')
  order by version desc limit 1;

  select jsonb_build_object(
    'company', (select jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email, 'delivery_terms', c.delivery_terms)
                from public.companies c where c.id = o.company_id),
    'order', jsonb_build_object(
      'number', o.number, 'status', o.status, 'status_label', s.label, 'stage', s.stage, 'mode', o.mode,
      'reported_problem', o.reported_problem, 'received_at', o.received_at, 'due_at', o.due_at,
      'ready_at', o.ready_at, 'delivered_at', o.delivered_at,
      'can_decide', o.status = 'awaiting_approval' and (qt.id is null or qt.status = 'sent')
    ),
    'quote', case when qt.id is null then null else jsonb_build_object(
      'version', qt.version, 'status', qt.status, 'items', qt.items, 'total_cents', qt.total_cents,
      'valid_until', qt.valid_until, 'delivery_days', qt.delivery_days, 'notes', qt.notes,
      'decided_at', qt.decided_at, 'decided_by_name', qt.decided_by_name) end,
    'diagnosis', (select jsonb_build_object('summary', d.summary, 'finalized_at', d.finalized_at,
                    'fails', (select coalesce(jsonb_agg(x ->> 'label'), '[]') from jsonb_array_elements(d.results) x where x ->> 'result' = 'fail'))
                  from public.order_diagnostics d where d.order_id = o.id and d.finalized_at is not null
                  order by d.finalized_at desc limit 1),
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

create or replace function public.portal_decide(p_token text, p_approve boolean, p_name text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.portal_links := private.portal_link_for(p_token);
  o public.service_orders;
  qt public.quotes;
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

  -- Com orçamento enviado, a decisão vale para ele (e move a OS).
  select * into qt from public.quotes where order_id = o.id and status = 'sent' for update;
  if found then
    perform private.decide_quote(qt, p_approve, 'portal', v_name, v_note, null);
    return;
  end if;

  -- Sem orçamento formal: decide sobre os itens atuais da OS (comportamento anterior).
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
alter table public.checklist_templates enable row level security;
alter table public.order_diagnostics enable row level security;
alter table public.quotes enable row level security;

create policy checklist_templates_select on public.checklist_templates
  for select to authenticated using (private.is_member(company_id));
create policy order_diagnostics_select on public.order_diagnostics
  for select to authenticated
  using (exists (select 1 from public.service_orders o where o.id = order_id and private.can_access_order(o.company_id, o.assigned_to)));
create policy quotes_select on public.quotes
  for select to authenticated
  using (private.has_permission(company_id, 'quotes.read')
         and exists (select 1 from public.service_orders o where o.id = order_id and private.can_access_order(o.company_id, o.assigned_to)));

revoke insert, update, delete on public.checklist_templates, public.order_diagnostics, public.quotes from authenticated, anon;
grant select on public.checklist_templates, public.order_diagnostics, public.quotes to authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
grant execute on function public.seed_checklist_templates(uuid) to authenticated;
grant execute on function public.save_checklist_template(uuid, uuid, jsonb) to authenticated;
grant execute on function public.start_diagnostic(uuid, uuid) to authenticated;
grant execute on function public.save_diagnostic(uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.save_quote(uuid, uuid, jsonb) to authenticated;
grant execute on function public.new_quote_version(uuid) to authenticated;
grant execute on function public.send_quote(uuid) to authenticated;
grant execute on function public.decide_quote_staff(uuid, boolean, text, text) to authenticated;
grant execute on function public.apply_quote_items(uuid) to authenticated;
grant execute on function public.cancel_quote(uuid) to authenticated;
grant execute on function public.portal_order(text) to anon, authenticated;
grant execute on function public.portal_decide(text, boolean, text, text) to anon, authenticated;
grant execute on function public.charge_view(text) to anon, authenticated;
