-- =============================================================================
-- Phael Tech OS — Migração 0001: fundação
-- Esquemas, extensões, tipos e utilitários compartilhados.
-- =============================================================================

-- Funções internas ficam no esquema "private", que NÃO é exposto pela API REST
-- do Supabase. Políticas RLS podem chamá-las; o navegador não.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- pgcrypto: geração de tokens aleatórios e hashes (convites, links seguros).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.member_role as enum ('admin', 'technician', 'finance', 'attendant');
comment on type public.member_role is
  'Perfis base: admin (administrador), technician (técnico), finance (financeiro), attendant (atendente).';

create type public.member_status as enum ('active', 'suspended');

-- -----------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Defesa em profundidade: por padrão, nenhuma tabela nova do esquema public
-- concede privilégios a anon/authenticated. Cada migração concede apenas o
-- necessário, e o RLS filtra as linhas.
-- -----------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
