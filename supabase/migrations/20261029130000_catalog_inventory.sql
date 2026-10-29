-- =============================================================================
-- Phael Tech OS — Migração 0011: catálogo de serviços, fornecedores, estoque,
-- compras e itens (serviços/peças) da OS.
-- Dinheiro sempre em CENTAVOS (bigint). Quantidades inteiras.
-- Saldo de estoque só muda dentro de funções que travam a linha do produto
-- (SELECT ... FOR UPDATE) e registram a movimentação, na mesma transação.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catálogo de serviços
-- -----------------------------------------------------------------------------
create table public.service_categories (
  key    text primary key,
  label  text not null,
  sort   int not null
);
insert into public.service_categories (key, label, sort) values
  ('maintenance', 'Manutenção e limpeza', 1),
  ('software',    'Sistema e software', 2),
  ('hardware',    'Hardware e upgrades', 3),
  ('diagnosis',   'Diagnóstico', 4),
  ('data',        'Backup e recuperação', 5),
  ('support',     'Suporte remoto e presencial', 6),
  ('web',         'Sites e serviços digitais', 7),
  ('other',       'Outros', 99);

create table public.service_catalog (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  name              text not null check (char_length(btrim(name)) between 2 and 120),
  category          text not null default 'other' references public.service_categories (key),
  description       text check (description is null or char_length(description) <= 2000),
  price_cents       bigint not null default 0 check (price_cents >= 0),
  cost_cents        bigint not null default 0 check (cost_cents >= 0),
  duration_minutes  int check (duration_minutes is null or duration_minutes between 1 and 10080),
  warranty_days     int check (warranty_days is null or warranty_days between 0 and 3650),
  conditions        text check (conditions is null or char_length(conditions) <= 2000),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, id)
);
create unique index service_catalog_name_uq on public.service_catalog (company_id, lower(name));

create trigger service_catalog_set_updated_at before update on public.service_catalog
  for each row execute function private.set_updated_at();
create trigger service_catalog_audit after insert or update on public.service_catalog
  for each row execute function private.audit_row_change('company_id');

-- Serviços sugeridos (sem preço: cada empresa define o seu).
create or replace function public.seed_service_catalog(p_company_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform private.require_permission(p_company_id, 'catalog.write');
  insert into public.service_catalog (company_id, name, category)
  select p_company_id, s.name, s.category
  from (values
    ('Formatação com backup', 'software'),
    ('Instalação de Windows', 'software'),
    ('Instalação de Linux', 'software'),
    ('Limpeza interna', 'maintenance'),
    ('Troca de pasta térmica', 'maintenance'),
    ('Upgrade de memória RAM', 'hardware'),
    ('Instalação de SSD', 'hardware'),
    ('Montagem de computador', 'hardware'),
    ('Diagnóstico técnico', 'diagnosis'),
    ('Recuperação de sistema', 'software'),
    ('Backup de dados', 'data'),
    ('Suporte remoto (hora)', 'support'),
    ('Atendimento presencial (visita)', 'support'),
    ('Criação de site', 'web'),
    ('Manutenção de site (mensal)', 'web'),
    ('Automação e solução digital', 'web')
  ) as s(name, category)
  on conflict (company_id, lower(name)) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fornecedores
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 2 and 160),
  tax_id      text check (tax_id is null or private.is_valid_tax_id(tax_id)),
  contact     text check (contact is null or char_length(contact) <= 120),
  email       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text check (phone is null or phone ~ '^[0-9]{10,13}$'),
  website     text check (website is null or char_length(website) <= 200),
  notes       text check (notes is null or char_length(notes) <= 2000),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id)
);
create unique index suppliers_name_uq on public.suppliers (company_id, lower(name));

create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function private.set_updated_at();
create trigger suppliers_audit after insert or update on public.suppliers
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- Produtos e peças
-- -----------------------------------------------------------------------------
create table public.products (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  sku              text not null check (sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  name             text not null check (char_length(btrim(name)) between 2 and 160),
  category         text check (category is null or char_length(category) <= 60),
  manufacturer     text check (manufacturer is null or char_length(manufacturer) <= 80),
  supplier_id      uuid,
  unit             text not null default 'un' check (unit in ('un', 'cx', 'm', 'kg', 'l', 'kit')),
  cost_cents       bigint not null default 0 check (cost_cents >= 0),
  price_cents      bigint not null default 0 check (price_cents >= 0),
  min_qty          int not null default 0 check (min_qty >= 0),
  qty_on_hand      int not null default 0 check (qty_on_hand >= 0),
  tracks_serial    boolean not null default false,
  active           boolean not null default true,
  search_text      text generated always as (
                     private.normalize_text(sku || ' ' || name || ' ' || coalesce(manufacturer, '') || ' ' || coalesce(category, ''))
                   ) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id) on delete restrict
);
comment on column public.products.cost_cents is 'Custo médio ponderado, recalculado a cada entrada por compra.';
comment on column public.products.qty_on_hand is 'Saldo. Só muda por private.move_stock (com trava de linha).';
create unique index products_sku_uq on public.products (company_id, upper(sku));
create index products_search_trgm_idx on public.products using gin (search_text extensions.gin_trgm_ops);

create trigger products_set_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger products_audit after insert or update on public.products
  for each row execute function private.audit_row_change('company_id');

create type public.stock_movement_kind as enum (
  'purchase_in',      -- entrada por compra
  'adjustment_in',    -- ajuste de inventário (sobra)
  'adjustment_out',   -- ajuste de inventário (falta, perda, defeito)
  'supplier_return',  -- devolução ao fornecedor
  'order_consume',    -- peça usada em OS
  'order_return'      -- peça devolvida de OS ao estoque
);

create table public.stock_movements (
  id               bigint generated always as identity primary key,
  company_id       uuid not null,
  product_id       uuid not null,
  kind             public.stock_movement_kind not null,
  qty              int not null check (qty > 0),
  direction        smallint not null check (direction in (1, -1)),
  unit_cost_cents  bigint not null check (unit_cost_cents >= 0),
  balance_after    int not null check (balance_after >= 0),
  serial_number    text check (serial_number is null or char_length(serial_number) <= 80),
  reason           text check (reason is null or char_length(reason) <= 500),
  order_id         uuid,
  purchase_id      uuid,
  actor_id         uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (company_id, product_id) references public.products (company_id, id) on delete restrict
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function private.audit_log_immutable();

-- Único ponto que altera saldo. Trava o produto, valida saldo e registra a movimentação.
create or replace function private.move_stock(
  p_company_id uuid,
  p_product_id uuid,
  p_kind public.stock_movement_kind,
  p_qty int,
  p_unit_cost_cents bigint default null,
  p_reason text default null,
  p_serial text default null,
  p_order_id uuid default null,
  p_purchase_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.products;
  v_dir smallint := case when p_kind in ('purchase_in', 'adjustment_in', 'order_return') then 1 else -1 end;
  v_cost bigint;
  v_new int;
  v_id bigint;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantidade deve ser maior que zero' using errcode = '23514';
  end if;

  select * into v from public.products where id = p_product_id and company_id = p_company_id for update;
  if not found then
    raise exception 'Produto não encontrado' using errcode = 'P0002';
  end if;
  if v_dir = -1 and v.tracks_serial and private.clean(p_serial) is null then
    raise exception 'Informe o número de série da peça' using errcode = '23514';
  end if;

  v_new := v.qty_on_hand + v_dir * p_qty;
  if v_new < 0 then
    raise exception 'Estoque insuficiente de %: disponível %, pedido %', v.name, v.qty_on_hand, p_qty
      using errcode = '23514';
  end if;

  v_cost := coalesce(p_unit_cost_cents, v.cost_cents);
  if v_cost < 0 then
    raise exception 'Custo inválido' using errcode = '23514';
  end if;

  -- Custo médio ponderado só muda com entrada por compra.
  update public.products set
    qty_on_hand = v_new,
    cost_cents = case
      when p_kind = 'purchase_in' and v_new > 0
        then round(((greatest(v.qty_on_hand, 0)::numeric * v.cost_cents) + (p_qty::numeric * v_cost)) / v_new)::bigint
      else cost_cents
    end
  where id = v.id;

  insert into public.stock_movements (
    company_id, product_id, kind, qty, direction, unit_cost_cents, balance_after,
    serial_number, reason, order_id, purchase_id, actor_id
  ) values (
    p_company_id, v.id, p_kind, p_qty, v_dir, v_cost, v_new,
    private.clean(p_serial), private.clean(p_reason), p_order_id, p_purchase_id, auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Ajuste manual de inventário (sobra, falta, perda, devolução ao fornecedor).
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_kind public.stock_movement_kind,
  p_qty int,
  p_reason text,
  p_serial text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.products where id = p_product_id;
  if not found then
    raise exception 'Produto não encontrado' using errcode = 'P0002';
  end if;
  perform private.require_permission(v_company, 'inventory.write');
  if p_kind not in ('adjustment_in', 'adjustment_out', 'supplier_return') then
    raise exception 'Use compras para entradas e a OS para consumo de peças' using errcode = '22023';
  end if;
  if private.clean(p_reason) is null then
    raise exception 'Informe o motivo do ajuste' using errcode = '23514';
  end if;
  return private.move_stock(v_company, p_product_id, p_kind, p_qty, null, p_reason, p_serial);
end;
$$;

-- -----------------------------------------------------------------------------
-- Compras
-- -----------------------------------------------------------------------------
create type public.purchase_status as enum ('draft', 'received', 'canceled');

create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  number          bigint not null,
  supplier_id     uuid not null,
  status          public.purchase_status not null default 'draft',
  invoice_number  text check (invoice_number is null or char_length(invoice_number) <= 60),
  ordered_at      date not null default current_date,
  received_at     timestamptz,
  freight_cents   bigint not null default 0 check (freight_cents >= 0),
  notes           text check (notes is null or char_length(notes) <= 2000),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, supplier_id) references public.suppliers (company_id, id) on delete restrict
);

create table public.purchase_items (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  purchase_id      uuid not null,
  product_id       uuid not null,
  qty              int not null check (qty > 0),
  unit_cost_cents  bigint not null check (unit_cost_cents >= 0),
  foreign key (company_id, purchase_id) references public.purchases (company_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.products (company_id, id) on delete restrict
);
create index purchase_items_purchase_idx on public.purchase_items (purchase_id);

create trigger purchases_set_updated_at before update on public.purchases
  for each row execute function private.set_updated_at();
create trigger purchases_audit after insert or update on public.purchases
  for each row execute function private.audit_row_change('company_id');

-- Salva rascunho de compra (cabeçalho + itens). Compra recebida não muda.
-- p_data: { supplier_id, invoice_number, ordered_at, freight_cents, notes,
--           items: [{ product_id, qty, unit_cost_cents }] }
create or replace function public.save_purchase(p_company_id uuid, p_purchase_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_purchase_id;
  v_status public.purchase_status;
  v_supplier uuid := (p_data ->> 'supplier_id')::uuid;
  v_item jsonb;
begin
  perform private.require_permission(p_company_id, 'suppliers.write');
  if not exists (select 1 from public.suppliers where id = v_supplier and company_id = p_company_id) then
    raise exception 'Fornecedor não encontrado' using errcode = 'P0002';
  end if;
  if jsonb_array_length(coalesce(p_data -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Inclua pelo menos um item na compra' using errcode = '23514';
  end if;

  if v_id is null then
    insert into public.purchases (company_id, number, supplier_id, invoice_number, ordered_at, freight_cents, notes, created_by)
    values (
      p_company_id, private.next_number(p_company_id, 'purchase'), v_supplier,
      private.clean(p_data ->> 'invoice_number'),
      coalesce(nullif(p_data ->> 'ordered_at', '')::date, current_date),
      coalesce(nullif(p_data ->> 'freight_cents', '')::bigint, 0),
      private.clean(p_data ->> 'notes'), auth.uid()
    )
    returning id into v_id;
  else
    select status into v_status from public.purchases where id = v_id and company_id = p_company_id for update;
    if not found then
      raise exception 'Compra não encontrada' using errcode = 'P0002';
    end if;
    if v_status <> 'draft' then
      raise exception 'Compra recebida ou cancelada não pode ser alterada' using errcode = '23514';
    end if;
    update public.purchases set
      supplier_id = v_supplier,
      invoice_number = private.clean(p_data ->> 'invoice_number'),
      ordered_at = coalesce(nullif(p_data ->> 'ordered_at', '')::date, ordered_at),
      freight_cents = coalesce(nullif(p_data ->> 'freight_cents', '')::bigint, 0),
      notes = private.clean(p_data ->> 'notes')
    where id = v_id;
    delete from public.purchase_items where purchase_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_data -> 'items') loop
    if not exists (select 1 from public.products where id = (v_item ->> 'product_id')::uuid and company_id = p_company_id) then
      raise exception 'Produto não encontrado na compra' using errcode = 'P0002';
    end if;
    insert into public.purchase_items (company_id, purchase_id, product_id, qty, unit_cost_cents)
    values (p_company_id, v_id, (v_item ->> 'product_id')::uuid, (v_item ->> 'qty')::int, (v_item ->> 'unit_cost_cents')::bigint);
  end loop;

  return v_id;
end;
$$;

-- Recebe a compra: entrada de todos os itens no estoque, numa única transação.
create or replace function public.receive_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.purchases;
  v_item public.purchase_items;
begin
  select * into v from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'inventory.write');
  if v.status <> 'draft' then
    raise exception 'Esta compra já foi recebida ou cancelada' using errcode = '23514';
  end if;

  for v_item in select * from public.purchase_items where purchase_id = v.id order by product_id loop
    perform private.move_stock(v.company_id, v_item.product_id, 'purchase_in', v_item.qty, v_item.unit_cost_cents,
      format('Compra nº %s', v.number), null, null, v.id);
  end loop;

  update public.purchases set status = 'received', received_at = now() where id = v.id;
end;
$$;

create or replace function public.cancel_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.purchases;
begin
  select * into v from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Compra não encontrada' using errcode = 'P0002';
  end if;
  perform private.require_permission(v.company_id, 'suppliers.write');
  if v.status <> 'draft' then
    raise exception 'Compra recebida não é cancelada: registre a devolução ao fornecedor no estoque' using errcode = '23514';
  end if;
  update public.purchases set status = 'canceled' where id = v.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Itens da OS: serviços e peças. Custo real e preço cobrado ficam separados.
-- Peça lançada = baixa no estoque na mesma transação. Remover = devolução ao
-- estoque (o item fica registrado como devolvido; nada é apagado).
-- -----------------------------------------------------------------------------
create type public.order_item_kind as enum ('service', 'part');

create table public.service_order_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  order_id          uuid not null,
  kind              public.order_item_kind not null,
  catalog_id        uuid,
  product_id        uuid,
  description       text not null check (char_length(btrim(description)) between 2 and 200),
  qty               int not null default 1 check (qty > 0),
  unit_price_cents  bigint not null check (unit_price_cents >= 0),
  unit_cost_cents   bigint not null default 0 check (unit_cost_cents >= 0),
  discount_cents    bigint not null default 0 check (discount_cents >= 0),
  serial_number     text check (serial_number is null or char_length(serial_number) <= 80),
  warranty_days     int check (warranty_days is null or warranty_days between 0 and 3650),
  returned_at       timestamptz,
  returned_reason   text check (returned_reason is null or char_length(returned_reason) <= 500),
  added_by          uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  foreign key (company_id, order_id) references public.service_orders (company_id, id) on delete restrict,
  foreign key (company_id, catalog_id) references public.service_catalog (company_id, id) on delete restrict,
  foreign key (company_id, product_id) references public.products (company_id, id) on delete restrict,
  check ((kind = 'part') = (product_id is not null)),
  check (discount_cents <= qty * unit_price_cents)
);
create index service_order_items_order_idx on public.service_order_items (order_id);

create trigger service_order_items_audit after insert or update on public.service_order_items
  for each row execute function private.audit_row_change('company_id');

-- Garante acesso à OS e que ela ainda aceita itens.
create or replace function private.lock_order_for_items(p_order_id uuid)
returns public.service_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.service_orders := private.lock_order(p_order_id);
begin
  perform private.require_permission(v.company_id, 'orders.update');
  if v.status in (select key from public.service_order_statuses where stage in ('done', 'stopped')) then
    raise exception 'OS concluída ou encerrada não aceita alterações de serviços e peças' using errcode = '23514';
  end if;
  return v;
end;
$$;

-- p_data: { kind, catalog_id | product_id, description, qty, unit_price_cents, discount_cents, serial_number }
create or replace function public.add_order_item(p_order_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.service_orders := private.lock_order_for_items(p_order_id);
  v_kind public.order_item_kind := (p_data ->> 'kind')::public.order_item_kind;
  v_qty int := coalesce(nullif(p_data ->> 'qty', '')::int, 1);
  v_cat public.service_catalog;
  v_prod public.products;
  v_desc text := private.clean(p_data ->> 'description');
  v_price bigint := nullif(p_data ->> 'unit_price_cents', '')::bigint;
  v_cost bigint := 0;
  v_warranty int;
  v_serial text := private.clean(p_data ->> 'serial_number');
  v_id uuid;
begin
  if v_kind = 'service' then
    if nullif(p_data ->> 'catalog_id', '') is not null then
      select * into v_cat from public.service_catalog
      where id = (p_data ->> 'catalog_id')::uuid and company_id = v_order.company_id;
      if not found then
        raise exception 'Serviço não encontrado no catálogo' using errcode = 'P0002';
      end if;
      v_desc := coalesce(v_desc, v_cat.name);
      v_price := coalesce(v_price, v_cat.price_cents);
      v_cost := v_cat.cost_cents;
      v_warranty := v_cat.warranty_days;
    end if;
    if v_desc is null or v_price is null then
      raise exception 'Informe a descrição e o valor do serviço' using errcode = '23514';
    end if;
  else
    select * into v_prod from public.products
    where id = (p_data ->> 'product_id')::uuid and company_id = v_order.company_id;
    if not found then
      raise exception 'Peça não encontrada no estoque' using errcode = 'P0002';
    end if;
    v_desc := coalesce(v_desc, v_prod.name);
    v_price := coalesce(v_price, v_prod.price_cents);
  end if;

  insert into public.service_order_items (
    company_id, order_id, kind, catalog_id, product_id, description, qty,
    unit_price_cents, unit_cost_cents, discount_cents, serial_number, warranty_days, added_by
  ) values (
    v_order.company_id, v_order.id, v_kind, v_cat.id, v_prod.id, v_desc, v_qty,
    v_price, v_cost, coalesce(nullif(p_data ->> 'discount_cents', '')::bigint, 0), v_serial, v_warranty, auth.uid()
  )
  returning id into v_id;

  if v_kind = 'part' then
    -- Baixa no estoque com o custo médio do momento (trava a linha do produto).
    perform private.move_stock(v_order.company_id, v_prod.id, 'order_consume', v_qty, null,
      format('OS nº %s', v_order.number), v_serial, v_order.id);
    update public.service_order_items
    set unit_cost_cents = (select unit_cost_cents from public.stock_movements
                           where order_id = v_order.id and product_id = v_prod.id
                           order by id desc limit 1)
    where id = v_id;
  end if;

  insert into public.service_order_events (company_id, order_id, kind, note, actor_id)
  values (v_order.company_id, v_order.id, 'updated',
          format('Incluiu %s: %s (x%s)', case when v_kind = 'part' then 'peça' else 'serviço' end, v_desc, v_qty),
          auth.uid());
  return v_id;
end;
$$;

-- Remove item: serviço é marcado como removido; peça volta ao estoque.
create or replace function public.remove_order_item(p_item_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.service_order_items;
  v_order public.service_orders;
begin
  select * into v_item from public.service_order_items where id = p_item_id;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002';
  end if;
  v_order := private.lock_order_for_items(v_item.order_id);
  select * into v_item from public.service_order_items where id = p_item_id for update;
  if v_item.returned_at is not null then
    raise exception 'Este item já foi removido' using errcode = '23514';
  end if;
  if private.clean(p_reason) is null then
    raise exception 'Informe o motivo da remoção' using errcode = '23514';
  end if;

  update public.service_order_items set returned_at = now(), returned_reason = private.clean(p_reason) where id = v_item.id;

  if v_item.kind = 'part' then
    perform private.move_stock(v_order.company_id, v_item.product_id, 'order_return', v_item.qty, v_item.unit_cost_cents,
      format('Devolvida da OS nº %s: %s', v_order.number, private.clean(p_reason)), v_item.serial_number, v_order.id);
  end if;

  insert into public.service_order_events (company_id, order_id, kind, note, reason, actor_id)
  values (v_order.company_id, v_order.id, 'updated', format('Removeu: %s (x%s)', v_item.description, v_item.qty),
          private.clean(p_reason), auth.uid());
end;
$$;

-- Totais da OS (itens ativos). Custo e margem só para quem vê o financeiro ou o estoque.
create or replace function public.service_order_totals(p_order_id uuid)
returns table (
  services_cents bigint, parts_cents bigint, discount_cents bigint, total_cents bigint,
  cost_cents bigint, margin_cents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.service_orders;
  v_show_cost boolean;
begin
  select * into v from public.service_orders where id = p_order_id;
  if not found or private.can_access_order(v.company_id, v.assigned_to) is not true then
    raise exception 'Ordem de serviço não encontrada' using errcode = 'P0002';
  end if;
  v_show_cost := private.has_permission(v.company_id, 'finance.read') or private.has_permission(v.company_id, 'inventory.write');

  return query
    with a as (
      select * from public.service_order_items i where i.order_id = p_order_id and i.returned_at is null
    ), t as (
      select
        coalesce(sum(qty * unit_price_cents) filter (where kind = 'service'), 0)::bigint as services,
        coalesce(sum(qty * unit_price_cents) filter (where kind = 'part'), 0)::bigint as parts,
        coalesce(sum(a.discount_cents), 0)::bigint as discount,
        coalesce(sum(qty * unit_cost_cents), 0)::bigint as cost
      from a
    )
    select t.services, t.parts, t.discount, t.services + t.parts - t.discount,
           case when v_show_cost then t.cost end,
           case when v_show_cost then t.services + t.parts - t.discount - t.cost end
    from t;
end;
$$;

-- Produtos com estoque no mínimo ou abaixo (alerta de reposição).
create or replace function public.low_stock_count(p_company_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.has_permission(p_company_id, 'inventory.read') then
    (select count(*) from public.products p
     where p.company_id = p_company_id and p.active and p.min_qty > 0 and p.qty_on_hand <= p.min_qty)
  else 0 end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.service_categories enable row level security;
alter table public.service_catalog enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.service_order_items enable row level security;

grant select on public.service_categories to authenticated;
create policy service_categories_select on public.service_categories for select to authenticated using (true);

-- Catálogo: leitura com catalog.read; escrita direta com catalog.write.
grant select, insert on public.service_catalog to authenticated;
grant update (name, category, description, price_cents, cost_cents, duration_minutes, warranty_days, conditions, active)
  on public.service_catalog to authenticated;
create policy service_catalog_select on public.service_catalog for select to authenticated
  using (private.has_permission(company_id, 'catalog.read'));
create policy service_catalog_insert on public.service_catalog for insert to authenticated
  with check (private.has_permission(company_id, 'catalog.write'));
create policy service_catalog_update on public.service_catalog for update to authenticated
  using (private.has_permission(company_id, 'catalog.write'))
  with check (private.has_permission(company_id, 'catalog.write'));

-- Fornecedores: leitura para quem lê estoque ou cuida de compras; escrita com suppliers.write.
grant select, insert on public.suppliers to authenticated;
grant update (name, tax_id, contact, email, phone, website, notes, active) on public.suppliers to authenticated;
create policy suppliers_select on public.suppliers for select to authenticated
  using (private.has_permission(company_id, 'inventory.read') or private.has_permission(company_id, 'suppliers.write'));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (private.has_permission(company_id, 'suppliers.write'));
create policy suppliers_update on public.suppliers for update to authenticated
  using (private.has_permission(company_id, 'suppliers.write'))
  with check (private.has_permission(company_id, 'suppliers.write'));

-- Produtos: cadastro direto com inventory.write; SALDO e CUSTO MÉDIO nunca pelo navegador.
grant select, insert on public.products to authenticated;
grant update (sku, name, category, manufacturer, supplier_id, unit, price_cents, min_qty, tracks_serial, active)
  on public.products to authenticated;
create policy products_select on public.products for select to authenticated
  using (private.has_permission(company_id, 'inventory.read'));
create policy products_insert on public.products for insert to authenticated
  with check (private.has_permission(company_id, 'inventory.write') and qty_on_hand = 0);
create policy products_update on public.products for update to authenticated
  using (private.has_permission(company_id, 'inventory.write'))
  with check (private.has_permission(company_id, 'inventory.write'));

grant select on public.stock_movements to authenticated;
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (private.has_permission(company_id, 'inventory.read'));

grant select on public.purchases, public.purchase_items to authenticated;
create policy purchases_select on public.purchases for select to authenticated
  using (private.has_permission(company_id, 'suppliers.write') or private.has_permission(company_id, 'inventory.write'));
create policy purchase_items_select on public.purchase_items for select to authenticated
  using (private.has_permission(company_id, 'suppliers.write') or private.has_permission(company_id, 'inventory.write'));

grant select on public.service_order_items to authenticated;
create policy service_order_items_select on public.service_order_items for select to authenticated
  using (exists (
    select 1 from public.service_orders o
    where o.id = order_id and private.can_access_order(o.company_id, o.assigned_to)
  ));

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function public.seed_service_catalog(uuid) to authenticated;
grant execute on function public.adjust_stock(uuid, public.stock_movement_kind, int, text, text) to authenticated;
grant execute on function public.save_purchase(uuid, uuid, jsonb) to authenticated;
grant execute on function public.receive_purchase(uuid) to authenticated;
grant execute on function public.cancel_purchase(uuid) to authenticated;
grant execute on function public.add_order_item(uuid, jsonb) to authenticated;
grant execute on function public.remove_order_item(uuid, text) to authenticated;
grant execute on function public.service_order_totals(uuid) to authenticated;
grant execute on function public.low_stock_count(uuid) to authenticated;
