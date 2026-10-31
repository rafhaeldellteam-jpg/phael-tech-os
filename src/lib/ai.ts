import { requireSupabase } from './supabase'

export type AiTask = 'diagnosis' | 'client_message'

/** Chama a função "ai-assist" do Supabase. A chave da IA fica no servidor. */
export async function askAi(task: AiTask, companyId: string, orderId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await requireSupabase().functions.invoke<{ text?: string; error?: string }>('ai-assist', {
    body: { task, company_id: companyId, order_id: orderId, ...extra },
  })
  if (error) {
    // Corpo da resposta de erro da função, quando houver.
    const ctx = (error as { context?: Response }).context
    let msg: string | undefined
    try {
      msg = ctx ? ((await ctx.clone().json()) as { error?: string }).error : undefined
    } catch {
      msg = undefined
    }
    if (!msg && /Failed to send|not found|404/i.test(error.message)) {
      msg = 'IA ainda não configurada: publique a função "ai-assist" no Supabase e cadastre a chave (veja docs/IA.md).'
    }
    throw new Error(msg ?? error.message)
  }
  if (!data?.text) throw new Error(data?.error ?? 'A IA não retornou texto.')
  return data.text
}
