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

## Fase 3 — Gestão (em andamento)

### Entregue: catálogo, estoque, fornecedores, compras e itens da OS
- Catálogo de serviços com preço, custo de referência, duração, garantia e condições (sem preços fixos no código;
  serviços sugeridos nascem sem preço).
- Produtos/peças com SKU único, estoque mínimo e alerta de reposição no painel, controle opcional de número de série.
- Saldo só muda por movimentação registrada (compra, ajuste com motivo, devolução ao fornecedor, uso/devolução em OS),
  com trava de linha: testado com 8 conexões disputando o mesmo saldo.
- Custo médio ponderado recalculado a cada compra recebida; compra recebida não é editada nem cancelada.
- Na OS: serviços do catálogo ou avulsos e peças do estoque; peça lançada baixa o estoque na mesma transação;
  remover devolve ao estoque e mantém o registro. Custo real separado do preço cobrado; margem visível só para
  financeiro e quem gerencia estoque.

### Entregue: financeiro
- Contas (caixa, banco, digital) com saldo inicial e categorias de receita/despesa (sugeridas sob demanda).
- Contas a receber e a pagar com parcelamento exato em centavos, pagamentos parciais, estornos por lançamento
  inverso, cancelamento com motivo; pagamentos imutáveis.
- Cobrança gerada a partir da OS (total dos itens) e conta a pagar a partir da compra recebida.
- Resumo por período separando competência (faturamento, despesas, resultado estimado) e caixa (recebimentos,
  pagamentos, saldo), em aberto e vencidos, fluxo de caixa com gráfico e tabela, margem por OS e por categoria.
- Conciliação por importação de extrato CSV com sugestão automática e sem duplicar reimportações.
- Fórmulas documentadas em `docs/FINANCE.md`.

### Entregue: garantias
- Prazo por item da OS (serviço herda do catálogo, peça do produto, ambos ajustáveis ao lançar), contado a partir
  da entrega no fuso de São Paulo; lista de vigentes, a vencer em 15 dias e vencidas.
- Acionamento abre OS de retorno vinculada (mesmo cliente, equipamento e técnico, prioridade alta) e segue
  em análise -> aceita -> resolvida, ou negada com motivo. Fora do prazo, só como cortesia com motivo registrado.
- Prazos impressos no comprovante de entrega; acionamentos em andamento no painel.

### Entregue: agenda
- Agendamentos (visita, remoto, cliente traz equipamento, retirada/entrega) com responsável, local e
  observações; visão semanal com filtro por responsável e resumo do dia no painel.
- O mesmo técnico não fica em dois atendimentos ativos ao mesmo tempo (constraint de exclusão no banco).
- Situações agendado -> confirmado -> realizado / não compareceu / cancelado (com motivo); o técnico
  responsável registra o resultado do próprio atendimento.
- Conversão em OS com cliente, equipamento, modo e técnico do agendamento.

### Entregue: diagnóstico e orçamento (pendências da Fase 2)
- Modelos de checklist por tipo de equipamento (4 sugeridos); diagnóstico na OS com OK/defeito/não se
  aplica e observação por item, laudo obrigatório para concluir; concluído não muda.
- Orçamento com versões: rascunho editável, envio trava e leva a OS a "Aguardando aprovação", nova versão
  substitui a anterior; decisão pela equipe ou pelo portal (com nome); orçamento vencido não é aprovado;
  itens aprovados lançados na OS uma vez; PDF do orçamento com o logo.
- Portal mostra o laudo e a versão enviada do orçamento.

### Entregue: fotos da OS
- Envio pelo celular (câmera ou galeria), comprimido no aparelho (JPEG, 1600 px, sem EXIF/GPS), para o
  bucket privado `order-photos` no caminho `<empresa>/<os>/<uuid>.jpg`; etapa (entrada, reparo, entrega),
  legenda e "mostrar ao cliente". Políticas do Storage: envia quem trabalha na OS, vê quem acessa a OS,
  visitante do portal só lê as fotos liberadas; arquivo com registro não é apagado direto.

## Fase 4 — Expansão

### Entregue: sites, serviços digitais e contratos recorrentes
- Cadastro de sites, lojas, landing pages, hospedagens, domínios e e-mails por cliente, com repositório,
  hospedagem, data no ar e vencimento do domínio (alerta no painel 30 dias antes).
- Contratos mensais, bimestrais, trimestrais, semestrais ou anuais, com dia de vencimento (1 a 28), início,
  fim opcional, categoria de receita e vínculo opcional ao serviço digital.
- Geração de cobranças idempotente: cada vencimento de cada contrato vira no máximo uma conta a receber
  (índice único `(contract_id, period_date)`); rodar de novo não duplica e cobrança cancelada não volta.
  Reajuste vale para as próximas; calendário fica fixo depois da primeira cobrança.
- PDF da OS (entrada e entrega) com o logo da Phael Tech Support no cabeçalho e no rodapé.
- Assinatura eletrônica (desenho na tela) do cliente e da empresa em cada comprovante, impressa no PDF
  com data e hora; imutável, com SHA-256 da imagem e registro na linha do tempo. Cada membro pode salvar
  a própria assinatura para reutilizar. É assinatura eletrônica simples (Lei 14.063/2020), não ICP-Brasil.

### Entregue: relatórios
- OS do período (abertas, entregues, em andamento, tempo médio e mediana de reparo, no prazo, retornos em
  garantia), desempenho por técnico, itens mais vendidos com margem, clientes que mais faturaram,
  contas a receber por atraso e série de 12 meses. Fórmulas em `docs/REPORTS.md`.

### Entregue: portal do cliente
- Link por OS com token de 256 bits (só o SHA-256 fica no banco), validade de 7 a 180 dias, revogação e
  contagem de acessos. Página pública `/acompanhar/<token>` com etapas, itens e total, garantia,
  histórico de status e botão de WhatsApp; aprovação ou recusa do orçamento quando a OS está em
  "Aguardando aprovação". Não expõe custos, notas internas, senha do equipamento nem CPF/CNPJ.
- Só `portal_order` e `portal_decide` são executáveis por visitantes sem login (teste de regressão).

### Entregue: automações
- Cobrança automática dos contratos (liga/desliga, antecedência configurável): agendador do banco
  (pg_cron, 06:17 de Brasília) e, como garantia, a primeira abertura do painel no dia. Índice único por
  empresa/tarefa/dia impede execução dupla; a geração continua idempotente por contrato e vencimento.
- Avisos no painel calculados na hora e filtrados por permissão: contas a receber vencidas, contas a pagar
  em até 3 dias, domínios em até 30 dias, OS paradas (prazo configurável), prontas sem retirada há mais de
  3 dias e garantias acabando em até 15 dias.
- Histórico imutável de execuções em `/atividade`, com "Rodar cobrança agora".

### Entregue: cobrança por e-mail com Pix
- Chave Pix da empresa (celular, e-mail, CPF, CNPJ ou aleatória), nome e cidade do recebedor, com QR de teste.
- Em cada conta a receber em aberto: "Cobrar por e-mail com Pix" monta a mensagem (valor em aberto,
  vencimento, Pix copia e cola e link) e abre no Gmail para o usuário enviar; o envio fica registrado.
- Página pública `/cobranca/<token>` com QR Code e copia e cola gerados no padrão BR Code do Banco Central
  (CRC16 conferido com o exemplo oficial), valor sempre atualizado e aviso de "Pago".

### Próximos incrementos
1. Integração com o Phael Tech Provision e camada opcional de IA.

## Fase 5 — Preparação comercial
Onboarding de outras assistências, planos e limites, cobrança por assinatura,
monitoramento e suporte.
