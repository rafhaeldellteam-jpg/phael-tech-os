import { isAuthError, toUserMessage } from './errors'

describe('isAuthError', () => {
  it('detecta JWT expirado do PostgREST', () => expect(isAuthError({ code: 'PGRST301' })).toBe(true))
  it('detecta status 401', () => expect(isAuthError({ status: 401 })).toBe(true))
  it('não confunde permissão negada com sessão expirada', () =>
    expect(isAuthError({ code: '42501', message: 'Permissão negada: members.manage' })).toBe(false))
})

describe('toUserMessage', () => {
  it('traduz permissão negada', () =>
    expect(toUserMessage({ code: '42501', message: 'Permissão negada: x' })).toMatch(/não tem permissão/))
  it('repassa mensagens de regra de negócio do banco', () =>
    expect(toUserMessage({ code: '23514', message: 'A empresa precisa de pelo menos um administrador ativo' })).toBe(
      'A empresa precisa de pelo menos um administrador ativo',
    ))
  it('esconde mensagens técnicas de constraint', () =>
    expect(toUserMessage({ code: '23514', message: 'new row violates check constraint "x"' })).toMatch(/Revise/))
  it('traduz credenciais inválidas', () =>
    expect(toUserMessage({ message: 'Invalid login credentials' })).toBe('E-mail ou senha incorretos.'))
  it('tem mensagem genérica para o resto', () => expect(toUserMessage(new Error('???'))).toMatch(/Algo deu errado/))
})
