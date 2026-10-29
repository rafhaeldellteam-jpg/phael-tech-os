/** Formato mínimo dos erros devolvidos por PostgREST / Supabase Auth. */
export interface BackendError {
  code?: string | undefined
  message?: string | undefined
  status?: number | undefined
}

function asBackendError(error: unknown): BackendError {
  if (typeof error === 'object' && error !== null) return error as BackendError
  return { message: String(error) }
}

/** Erros que indicam sessão inválida/expirada. */
export function isAuthError(error: unknown): boolean {
  const e = asBackendError(error)
  return (
    e.status === 401 ||
    e.code === 'PGRST301' || // JWT expirado
    e.code === 'PGRST303' ||
    e.code === '28000' ||
    /jwt expired|invalid jwt|refresh token/i.test(e.message ?? '')
  )
}

/**
 * Converte erros técnicos em mensagens úteis para o usuário.
 * As mensagens de regra de negócio já vêm em português do banco (RAISE EXCEPTION).
 */
export function toUserMessage(error: unknown): string {
  const e = asBackendError(error)
  if (isAuthError(e)) return 'Sua sessão expirou. Entre novamente para continuar.'
  switch (e.code) {
    case '42501':
      return e.message?.startsWith('Permissão negada')
        ? 'Você não tem permissão para esta ação. Fale com o administrador da empresa.'
        : 'Você não tem permissão para esta ação.'
    case '23505':
      return e.message && !/duplicate key/i.test(e.message)
        ? e.message
        : 'Já existe um registro com esses dados.'
    case '23514':
      return e.message && !/violates check constraint/i.test(e.message)
        ? e.message
        : 'Algum valor informado não é válido. Revise os campos.'
    case '22023':
    case 'P0002':
    case '54000':
      return e.message ?? 'Não foi possível concluir a operação.'
  }
  if (/invalid login credentials/i.test(e.message ?? '')) return 'E-mail ou senha incorretos.'
  if (/email not confirmed/i.test(e.message ?? ''))
    return 'Confirme seu e-mail pelo link enviado antes de entrar.'
  if (/failed to fetch|network/i.test(e.message ?? ''))
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  return 'Algo deu errado. Tente novamente; se continuar, avise o suporte.'
}
