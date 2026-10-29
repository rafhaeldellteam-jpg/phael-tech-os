# Roadmap

## Fase 1 — Fundação ✅ (verificada no CI: banco, frontend e fluxo completo com Supabase)
- Estrutura do frontend (React, TS strict, Vite, Tailwind, Router, TanStack Query, RHF + Zod, Radix).
- Banco multiempresa: empresas, perfis, membros, papéis, permissões, exceções por pessoa.
- Convites com token seguro, auditoria imutável, numeração sequencial concorrente.
- RLS em tudo + 80 asserções de teste de banco e teste de concorrência.
- Login, cadastro, recuperação e redefinição de senha, sessão expirada.
- Criação da empresa, troca de empresa, layout responsivo com menu recolhível e tema claro/escuro.
- Telas reais: painel (primeiros passos + atividade), dados da empresa, equipe e permissões, auditoria.
- CI com PostgreSQL, frontend e Supabase local + Playwright.

### Depende de configuração externa
- Projeto Supabase (dev e produção) e variáveis `.env.local`.
- SMTP para e-mails de confirmação/recuperação em produção.
- Envio automático de convites por e-mail (hoje: link copiado pelo admin).
- Hospedagem do frontend (ex.: Vercel) com as Redirect URLs cadastradas.

## Fase 2 — Operação principal (em andamento)

### Entregue: clientes e equipamentos
- Clientes PF/PJ com código sequencial, CPF/CNPJ validado e restrito (tabela separada, só com `clients.read_sensitive`),
  observações internas, consentimento de comunicações com data, endereço com preenchimento por CEP (ViaCEP),
  aviso de duplicidade (nome, e-mail, telefone, CPF/CNPJ), busca sem acento, filtros, paginação, arquivamento
  e exportação CSV controlada e auditada.
- Equipamentos vinculados a cliente da mesma empresa (FK composta), número de série único entre ativos,
  configuração para computadores, condições físicas, acessórios e etiqueta com QR Code (só leva à ficha; exige login).
- Pesquisa global no cabeçalho (Ctrl+K) respeitando permissões.

### Entregue: ordens de serviço
- Numeração sequencial por empresa, balcão / remoto / externo, prioridade, prazo, técnico responsável.
- 14 status com transições válidas (sem passar por todas as etapas), motivo obrigatório para cancelar,
  reabrir, recusa e reparo inviável; reabertura limpa datas de entrega/encerramento.
- Linha do tempo imutável (abertura, status, atribuição, observações, edições) com autor e data.
- Técnico vê e altera só as OS atribuídas a ele; atendente abre e registra entrega; financeiro só consulta.
- Comprovantes de entrada e de entrega para imprimir e assinar, com termos editáveis em Dados da empresa.
- Indicadores reais no painel (em andamento, diagnóstico, aguardando aprovação/peça, em reparo, prontas, atrasadas).
- Sistema travado para uso exclusivo de uma empresa (novas contas só por convite).

### Próximos incrementos
Ordem sugerida, cada item com migração + testes SQL + telas + testes:
4. Diagnósticos e checklists (inicial/final, evidências, comparação).
5. Orçamentos (itens, versões, aprovação/recusa registrada, imutabilidade após aprovação).
6. PDFs (orçamento, relatório técnico, termos) e anexos em Storage privado.

## Fase 3 — Gestão
Catálogo de serviços, estoque transacional, fornecedores e compras, financeiro
(centavos, parciais, estornos por lançamento inverso), garantias, agenda.

## Fase 4 — Expansão
Contratos recorrentes, sites e serviços digitais, relatórios com fórmulas
documentadas, portal do cliente (token com escopo e validade), automações
idempotentes, camada opcional de IA, integração com o Phael Tech Provision.

## Fase 5 — Preparação comercial
Onboarding de outras assistências, planos e limites, cobrança por assinatura,
monitoramento e suporte.
