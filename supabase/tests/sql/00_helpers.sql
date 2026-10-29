-- Utilitários de teste (criados pelo runner antes dos testes e removidos depois).
-- Cada arquivo de teste roda em uma transação com ROLLBACK no final.

drop schema if exists tests cascade;
create schema tests;
grant usage on schema tests to authenticated, anon;

-- Cria um usuário em auth.users (o trigger cria o perfil).
create function tests.create_user(p_id uuid, p_email text, p_name text default null)
returns uuid
language sql
as $$
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, jsonb_build_object('full_name', coalesce(p_name, split_part(p_email, '@', 1))))
  returning id;
$$;

-- "Faz login": passa a executar como o papel authenticated com o JWT do usuário.
create function tests.login(p_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.login_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create function tests.ok(p_condition boolean, p_description text)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'not ok - %', p_description;
  end if;
  raise notice 'ok - %', p_description;
end;
$$;

-- Executa SQL e exige que falhe com o SQLSTATE informado.
create function tests.throws(p_sql text, p_sqlstate text, p_description text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'ok - % (SQLSTATE %)', p_description, sqlstate;
      return;
    end if;
    raise exception 'not ok - % (esperado %, obtido %: %)', p_description, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'not ok - % (nenhum erro ocorreu)', p_description;
end;
$$;

-- Executa SQL e devolve quantas linhas foram afetadas (UPDATE/DELETE).
create function tests.affected(p_sql text)
returns bigint
language plpgsql
as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on all functions in schema tests to authenticated, anon;

-- Cria empresa + admin direto como superusuário. Usado para montar cenários de
-- isolamento com várias empresas, que a regra de empresa única não permite pela RPC.
create function tests.create_company_as(p_user uuid, p_name text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.companies (name, created_by) values (p_name, p_user) returning id into v_id;
  insert into public.company_members (company_id, user_id, role) values (v_id, p_user, 'admin');
  return v_id;
end;
$$;
