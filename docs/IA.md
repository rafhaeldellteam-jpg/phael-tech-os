# IA opcional

A IA é desligada por padrão. Sem configuração, os botões "Sugerir laudo com IA" e
"Escrever mensagem de atualização com IA" mostram que a IA não está configurada;
o resto do sistema funciona igual.

## Como funciona

- O navegador chama a Edge Function `ai-assist` com o token de login do usuário.
- A função lê a OS **com as permissões de quem pediu** (RLS) e chama `ai_begin`, que
  confere: membro da empresa, acesso à OS, `diagnostics.write` para laudo e o limite diário.
- A chave da Anthropic fica só em `ANTHROPIC_API_KEY` nos segredos do Supabase.
  Nunca vai para o navegador nem para o repositório.
- Cada chamada fica em `ai_requests` (tarefa, OS, usuário, tokens, erro). Limite padrão: 50 por dia
  por empresa (`companies.ai_daily_limit`, 0 desliga).
- O modelo padrão é `claude-haiku-5-5`; para trocar, crie o segredo `AI_MODEL`.
- A resposta é só sugestão: aparece num campo editável e nada é salvo ou enviado sem o usuário.

## Ativar (feito pelo dono da conta)

1. Em console.anthropic.com, crie uma chave de API (e defina um limite de gasto mensal).
2. Supabase → Edge Functions → Deploy a new function → Via Editor. Nome: `ai-assist`.
   Cole o conteúdo de `supabase/functions/ai-assist/index.ts` e faça o deploy.
   Mantenha "Verify JWT" ligado.
3. Supabase → Edge Functions → Secrets → adicione `ANTHROPIC_API_KEY` com a chave.
4. Abra uma OS → Diagnóstico → "Sugerir laudo com IA".

Para desligar: apague o segredo `ANTHROPIC_API_KEY` (ou ponha o limite diário em 0).
