// Phael Tech OS — assistente de IA (Supabase Edge Function, Deno).
// Tarefas:
//   diagnosis       sugere o laudo a partir do problema relatado e do checklist
//   client_message  escreve uma mensagem curta de WhatsApp sobre a situação da OS
// Segurança: usa o token de quem chamou (as regras de acesso do banco valem
// aqui também); a chave da IA fica só nos segredos do Supabase
// (ANTHROPIC_API_KEY). Cada uso passa por ai_begin/ai_finish (limite diário).
// Deploy: Supabase > Edge Functions > Deploy a new function > Via Editor,
// nome "ai-assist", cole este arquivo. Depois: Secrets > ANTHROPIC_API_KEY.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const MODEL = Deno.env.get('AI_MODEL') ?? 'claude-haiku-5-5'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

interface CheckItem {
  label: string
  result: 'ok' | 'fail' | 'na' | null
  note: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'IA não configurada: cadastre ANTHROPIC_API_KEY nos segredos do Supabase.' }, 503)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Faça login para usar a IA.' }, 401)

  let body: { task?: string; company_id?: string; order_id?: string; checklist?: CheckItem[] }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Pedido inválido' }, 400)
  }
  const { task, company_id, order_id } = body
  if ((task !== 'diagnosis' && task !== 'client_message') || !company_id || !order_id) return json({ error: 'Pedido inválido' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })

  // Dados da OS com as permissões de quem pediu.
  const { data: o, error: oErr } = await sb
    .from('service_orders')
    .select('number, status, reported_problem, symptoms, intake_condition, due_at, client:clients(name), equipment:equipment(type, manufacturer, model, processor, memory, storage, operating_system), status_info:service_order_statuses(label)')
    .eq('id', order_id)
    .eq('company_id', company_id)
    .maybeSingle()
  if (oErr || !o) return json({ error: 'OS não encontrada' }, 404)
  const { data: company } = await sb.from('companies').select('name').eq('id', company_id).single()

  const begin = await sb.rpc('ai_begin', { p_company_id: company_id, p_task: task, p_order_id: order_id })
  if (begin.error) return json({ error: begin.error.message }, begin.error.code === '42501' ? 403 : 429)
  const requestId = begin.data as number

  const eq = (o as any).equipment
  const equipment = eq ? [eq.manufacturer, eq.model].filter(Boolean).join(' ') || eq.type : 'sem equipamento'
  const specs = eq ? [eq.processor, eq.memory, eq.storage, eq.operating_system].filter(Boolean).join(', ') : ''
  const clientFirst = String((o as any).client?.name ?? '').split(' ')[0]

  let system: string
  let user: string
  if (task === 'diagnosis') {
    const list = (body.checklist ?? []).slice(0, 60)
    const lines = list.map((i) => `- ${i.label}: ${i.result === 'ok' ? 'OK' : i.result === 'fail' ? 'DEFEITO' : i.result === 'na' ? 'não se aplica' : 'não testado'}${i.note ? ` (${i.note})` : ''}`)
    system =
      'Você é técnico sênior de uma assistência técnica de informática no Brasil. Escreva o laudo técnico de diagnóstico em português, ' +
      'objetivo, em 3 a 6 frases: o que foi constatado, a causa provável e a recomendação. Baseie-se SOMENTE nos dados fornecidos; ' +
      'se algo não foi testado, diga que precisa ser verificado. Não invente valores, peças ou preços. Sem saudações, sem markdown.'
    user = `Equipamento: ${equipment}${specs ? ` (${specs})` : ''}\nProblema relatado pelo cliente: ${o.reported_problem}\n` +
      (o.symptoms ? `Sintomas observados: ${o.symptoms}\n` : '') +
      (o.intake_condition ? `Condição na entrada: ${o.intake_condition}\n` : '') +
      (lines.length ? `Checklist:\n${lines.join('\n')}` : 'Checklist ainda não preenchido.')
  } else {
    const { data: q } = await sb.from('quotes').select('version, status, total_cents, valid_until').eq('order_id', order_id).order('version', { ascending: false }).limit(1)
    const quote = q?.[0]
    system =
      `Você escreve mensagens de WhatsApp em nome da ${company?.name ?? 'assistência técnica'}, em português do Brasil, tom cordial e profissional, ` +
      'no máximo 5 linhas, sem markdown, com no máximo um emoji. Informe a situação atual da OS e o próximo passo para o cliente. ' +
      'Use SOMENTE os dados fornecidos; não invente prazos, valores ou diagnósticos. Não inclua links.'
    user = `Cliente: ${clientFirst || 'cliente'}\nOS número ${o.number}\nEquipamento: ${equipment}\nSituação atual: ${(o as any).status_info?.label ?? o.status}\n` +
      `Problema relatado: ${o.reported_problem}\n` +
      (o.due_at ? `Previsão: ${new Date(o.due_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n` : '') +
      (quote ? `Orçamento v${quote.version}: ${quote.status}, total R$ ${(quote.total_cents / 100).toFixed(2).replace('.', ',')}${quote.valid_until ? `, válido até ${quote.valid_until.split('-').reverse().join('/')}` : ''}\n` : '')
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 600, system, messages: [{ role: 'user', content: user }] }),
    })
    const out = await r.json()
    if (!r.ok) throw new Error(out?.error?.message ?? `HTTP ${r.status}`)
    const text = (out.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
    await sb.rpc('ai_finish', { p_request_id: requestId, p_ok: true, p_input_tokens: out.usage?.input_tokens ?? null, p_output_tokens: out.usage?.output_tokens ?? null, p_error: null })
    return json({ text })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await sb.rpc('ai_finish', { p_request_id: requestId, p_ok: false, p_input_tokens: null, p_output_tokens: null, p_error: msg })
    return json({ error: `A IA não respondeu: ${msg}` }, 502)
  }
})
