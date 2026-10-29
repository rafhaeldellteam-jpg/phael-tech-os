# Arquitetura do Phael Tech OS

## Visão geral

```
Navegador (React SPA)                         Supabase
┌───────────────────────────┐    HTTPS     ┌──────────────────────────────────┐
│ React Router (rotas)      │ ───────────► │ Auth (JWT)                       │
│ TanStack Query (cache)    │              │ PostgREST ── RLS ── PostgreSQL   │
│ RHF + Zod (formulários)   │ ◄─────────── │ RPCs SECURITY DEFINER (regras)   │
│ chave pública (anon) only │              │ Storage privado (Fase 2)         │
└───────────────────────────┘              │ Edge Functions (integrações)     │
                                           └──────────────────────────────────┘
```

O navegador só conhece a chave pública. **Toda autorização é decidida no banco**:
o frontend esconde o que o usuário não pode usar apenas por conveniência.

## Decisões arquiteturais

### ADR-001 — Supabase como backend, regras críticas no PostgreSQL
- **Contexto:** a equipe é pequena e o sistema precisa de autenticação, RLS e
  armazenamento privado desde o início.
- **Decisão:** usar Supabase (Postgres + Auth + Storage). Regras que não podem ser
  burladas (permissões, transições de status, estoque, dinheiro) ficam em
  políticas RLS, constraints, triggers e funções `SECURITY DEFINER`.
- **Consequência:** a mesma regra vale para a interface, para scripts e para
  futuras integrações. Testes de banco são obrigatórios (`scripts/test-db.sh`).

### ADR-002 — Multiempresa desde o primeiro dia
- Toda tabela de negócio tem `company_id` com FK para `companies`.
- O `company_id` enviado pelo navegador é só um filtro: o RLS verifica a
  associação ativa do usuário (`auth.uid()`) em `company_members`.
- A empresa ativa é escolhida na interface e guardada no navegador; trocar de
  empresa limpa o cache do TanStack Query.

### ADR-003 — Permissões por papel + exceções por membro
- Papéis base: administrador, técnico, financeiro e atendente.
- `role_permissions` define o padrão de cada papel;
  `member_permission_overrides` concede ou revoga permissões por pessoa.
- Administrador sempre tem tudo (evita a empresa ficar sem acesso) e a empresa
  nunca pode ficar sem um administrador ativo.
- Fonte única da verdade: `private.has_permission(company_id, permissão)`.

### ADR-004 — Escritas sensíveis só por RPC
- Membros, papéis, convites e permissões não aceitam INSERT/UPDATE direto:
  passam por funções que validam permissão, aplicam limites e auditam.
- Funções internas ficam no esquema `private` (não exposto pela API REST).

### ADR-005 — Auditoria imutável por trigger
- `private.audit_row_change()` grava inserções, alterações (só os campos que
  mudaram) e exclusões em `audit_log`.
- Campos sensíveis (CPF/CNPJ, hash de token) são gravados como `[redacted]`.
- Um trigger impede UPDATE/DELETE em `audit_log`, inclusive pelo dono.

### ADR-006 — Numeração sequencial por empresa
- `private.next_number(company_id, chave)` usa `INSERT … ON CONFLICT DO UPDATE`,
  que trava a linha do contador: chamadas simultâneas recebem números
  distintos e consecutivos (testado com 8 conexões × 50 chamadas).
- Será usado pela OS (Fase 2), orçamentos e demais documentos numerados.

### ADR-007 — Valores monetários (Fase 3)
- Dinheiro será armazenado como `bigint` em centavos (ou `numeric(14,2)` com
  arredondamento explícito em funções do banco). Nunca `float`.
- Cálculos de totais serão feitos no banco e espelhados no frontend apenas
  para pré-visualização, com testes dos dois lados.

### ADR-008 — Módulos futuros visíveis, porém marcados
- Itens do menu de fases futuras aparecem com "Fase N" e abrem uma página
  explicando que o módulo ainda não existe. Nenhum número é simulado.

## Estrutura de pastas

```
phael-tech-os/
├── .github/workflows/ci.yml        CI: banco, frontend, Supabase real + e2e
├── docs/                           arquitetura, modelo de dados, segurança, roadmap
├── e2e/                            testes Playwright (público e fluxo completo)
├── scripts/
│   ├── test-db.sh                  roda migrações (opcional) + testes SQL
│   └── test-db-concurrency.sh      teste de concorrência da numeração
├── supabase/
│   ├── migrations/                 migrações versionadas (ordem pelo timestamp)
│   └── tests/
│       ├── sql/                    testes de RLS, permissões, convites, auditoria
│       └── stub/                   stub do Supabase para PostgreSQL puro (CI)
└── src/
    ├── app/                        providers, rotas, QueryClient
    ├── core/                       auth, empresa ativa, permissões, tema
    ├── components/ui/              componentes compartilhados acessíveis
    ├── layout/                     AppShell, menu lateral, cabeçalho
    ├── lib/                        cliente Supabase, env, erros, CPF/CNPJ, tipos
    └── modules/                    um diretório por módulo de negócio
        ├── auth/  onboarding/  dashboard/  settings/  unavailable/
        └── (Fase 2) clients/ equipment/ orders/ diagnostics/ quotes/
```

### Convenções para novos módulos
1. Migração nova em `supabase/migrations/` com: tabela com `company_id`,
   RLS habilitado, políticas usando `private.has_permission`, triggers de
   auditoria e o bloco final de `revoke/grant execute` das funções.
2. Teste SQL em `supabase/tests/sql/NN_modulo.sql` cobrindo isolamento entre
   empresas e cada papel.
3. Tipos atualizados (`npm run db:types`).
4. Pasta `src/modules/<modulo>` com `queries.ts` (TanStack Query), páginas e
   testes; rota registrada em `app/router.tsx` atrás de `RequirePermission`.
5. Mudar a `phase` do item em `core/permissions/navigation.ts`.
