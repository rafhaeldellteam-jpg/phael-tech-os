# Phael Tech OS

Sistema de gestão para assistência técnica, manutenção de computadores e serviços
digitais da Phael Tech Support — preparado para virar SaaS multiempresa.

> **Status: Fase 1 (fundação).** Acesso, empresas, equipe, permissões e auditoria.
> Os módulos de operação (clientes, OS, orçamentos…) chegam na Fase 2 e aparecem
> no menu marcados como indisponíveis. Veja [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentação
- [Arquitetura e decisões](docs/ARCHITECTURE.md)
- [Modelo de dados](docs/DATA_MODEL.md)
- [Segurança e LGPD](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)

## Requisitos
- Node.js 20.19+ (recomendado 22)
- Docker Desktop (para o Supabase local)

## Rodando localmente

```bash
npm install
npx supabase init          # só na primeira vez: cria supabase/config.toml (não mexe nas migrações)
npx supabase start         # sobe Postgres, Auth e Studio; aplica as migrações
cp .env.example .env.local # cole API URL e anon key exibidas pelo comando acima
npm run dev                # http://localhost:5173
```

No ambiente local a confirmação de e-mail vem desligada e os e-mails (recuperação
de senha) aparecem no Inbucket/Mailpit, cujo endereço o `supabase start` mostra.

Primeiro acesso: **Criar conta → Criar empresa**. Você vira administrador e pode
convidar a equipe em **Equipe e permissões** (o link do convite é copiado e
enviado por você; envio automático por e-mail é uma etapa futura).

## Testes

| Comando | O que cobre |
|---|---|
| `npm test` | Unitários (Vitest): validações, CPF/CNPJ, permissões, mensagens de erro, login |
| `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db` | RLS, isolamento entre empresas, papéis, convites, auditoria e concorrência — no Supabase local |
| `npm run test:e2e` | Playwright: rotas protegidas, formulários, responsividade |
| `E2E_SUPABASE=1 npm run test:e2e` | Fluxo completo com Supabase local: cadastro → empresa → convite → auditoria |
| `npm run lint` / `npm run typecheck` | ESLint e TypeScript strict |

O CI (`.github/workflows/ci.yml`) roda tudo isso a cada push.

## Implantação (resumo)
1. Crie um projeto Supabase de **produção** separado do de desenvolvimento.
2. `npx supabase link --project-ref <ref>` e `npx supabase db push` para aplicar as migrações.
3. Siga a checklist de configuração em [docs/SECURITY.md](docs/SECURITY.md).
4. Publique o frontend (ex.: Vercel) com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
   e configure o fallback de SPA (todas as rotas → `index.html`).

## Tipos do banco
`src/lib/database.types.ts` foi escrito à mão na Fase 1. Depois do `supabase start`,
gere a versão oficial com `npm run db:types`.
