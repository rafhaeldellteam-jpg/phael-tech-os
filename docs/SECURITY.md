# Segurança e privacidade

## Medidas implementadas (Fase 1)

| Área | Medida | Onde |
|---|---|---|
| Autenticação | Supabase Auth (e-mail + senha), recuperação por link, sessão com renovação automática | `core/auth` |
| Sessão expirada | Erros 401/JWT expirado encerram a sessão local e levam ao login com aviso | `app/query-client.ts`, `lib/errors.ts` |
| Autorização | RLS em todas as tabelas; verificação por `private.has_permission` usando `auth.uid()` | migração `…120500_rls.sql` |
| Privilégios | `anon` não lê nenhuma tabela nem executa nenhuma função; colunas editáveis concedidas uma a uma | idem; testado em `01_tenancy_isolation.sql` |
| Isolamento | Testes provam que um usuário não lê, altera nem se insere em outra empresa | `supabase/tests/sql/01_*.sql` |
| Escalada de privilégio | Membros não se promovem nem se concedem permissões; empresa nunca fica sem admin | `02_permissions.sql` |
| Convites | Token de 256 bits, guardado só como hash SHA-256, uso único, validade de 1–30 dias, vinculado ao e-mail, limite de 20/dia | `…120400_company_rpcs.sql`, `03_invitations.sql` |
| Auditoria | Trilha imutável (nem o dono altera), com CPF/CNPJ e tokens ocultos | `…120300_audit_and_counters.sql`, `04_*.sql` |
| Validação | Zod no frontend + constraints no banco (CPF/CNPJ com dígito verificador, e-mail, tamanhos) | `lib/tax-id.ts`, `private.is_valid_tax_id` |
| Injeção | Sem SQL dinâmico com entrada do usuário; PostgREST parametriza; funções com `search_path = ''` | todas as funções |
| Segredos | Só a chave pública vai ao navegador; `.env*` no `.gitignore` | `.env.example` |
| Redirecionamento | Destino pós-login só aceita caminhos internos (`/…`, nunca `//…`) | `RequireAuth.tsx` |

## Configurações obrigatórias no painel do Supabase (produção)

Estas não ficam no código e precisam ser feitas por você:

1. **Auth → Providers → Email:** manter confirmação de e-mail **ligada**;
   tamanho mínimo de senha 10 (igual à validação da interface).
2. **Auth → URL Configuration:** `Site URL` = domínio de produção; incluir
   `https://SEU-DOMINIO/redefinir-senha` e `https://SEU-DOMINIO/convite` nas Redirect URLs.
3. **Auth → SMTP:** configurar um provedor de e-mail próprio (o SMTP padrão do
   Supabase tem limite baixo e não serve para produção).
4. **Auth → Rate limits:** revisar limites de login, cadastro e recuperação.
5. **Auth → Attack Protection:** ativar proteção contra senhas vazadas e CAPTCHA
   se houver cadastro aberto.
6. **Database → Backups:** confirmar backups diários e testar uma restauração
   (o plano gratuito tem retenção limitada; PITR exige plano pago).
7. Projetos **separados** para desenvolvimento e produção; nunca usar a
   `service_role` key no frontend.

## LGPD — medidas de apoio (não é declaração de conformidade)

Ter estes recursos **não** torna o sistema automaticamente conforme à LGPD.
A conformidade depende também de processos, contratos e da forma de uso.

O sistema já oferece ou prevê:
- **Minimização:** CPF/CNPJ só quando necessário; acesso restrito por permissão
  (`clients.read_sensitive` na Fase 2) e oculto na auditoria.
- **Controle de acesso** por papel e por pessoa, com registro de quem fez o quê.
- **Isolamento** entre empresas (requisito para o modo SaaS).
- **Exportação controlada** de dados de clientes (permissão `clients.export`, Fase 2).
- **Anexos privados** com URLs assinadas de curta duração (Fase 2).

Pendências de processo para o controlador (Phael Tech Support):
- Definir base legal para cada dado de cliente e registrar consentimentos
  quando a base for consentimento (campo previsto no cadastro de clientes).
- Política de retenção e descarte (ex.: anexos de OS após X anos) — o
  mecanismo de expurgo será implementado na Fase 4 conforme a política definida.
- Canal para titulares solicitarem acesso, correção e exclusão.
- Contrato/DPA com o Supabase e demais operadores; verificar região de
  hospedagem dos dados.
- Procedimento de resposta a incidentes.

## Logs
- O frontend não registra dados pessoais, senhas ou tokens no console
  (`no-console` no ESLint, permitindo apenas `warn`/`error` sem dados sensíveis).
- O token de convite aparece uma única vez na tela de quem o gerou e nunca é
  persistido em texto puro.

## Pagamentos
- O sistema nunca armazenará dados de cartão. Cobranças eletrônicas futuras
  usarão provedores especializados (tokenização no provedor).

## Portal do cliente
- Acesso sem login autorizado só por token aleatório de 32 bytes (base64url) entregue uma vez; o banco
  guarda `sha256(token)` e a coluna não é legível pela equipe.
- Links expiram (máx. 180 dias) e podem ser revogados; cada acesso atualiza `view_count`/`last_viewed_at`.
- Funções anônimas: `portal_order` (leitura de uma OS, campos selecionados) e `portal_decide`
  (aprovar/recusar orçamento, só em `awaiting_approval`, com nome do cliente na linha do tempo).

