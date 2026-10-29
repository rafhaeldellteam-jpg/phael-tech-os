import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { AuthContext, type AuthContextValue } from '@/core/auth/AuthProvider'
import { LoginPage } from './LoginPage'

function renderLogin(overrides: Partial<AuthContextValue> = {}) {
  const value: AuthContextValue = {
    session: null,
    user: null,
    loading: false,
    sessionExpired: false,
    passwordRecovery: false,
    signOut: async () => {},
    markSessionExpired: async () => {},
    clearRecovery: () => {},
    ...overrides,
  }
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('LoginPage', () => {
  it('valida campos antes de chamar o servidor', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Informe o e-mail')).toBeInTheDocument()
    expect(screen.getByText('Informe a senha')).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true')
  })

  it('rejeita e-mail malformado', async () => {
    renderLogin()
    await userEvent.type(screen.getByLabelText('E-mail'), 'nao-e-email')
    await userEvent.type(screen.getByLabelText('Senha'), 'qualquer')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('E-mail inválido')).toBeInTheDocument()
  })

  it('avisa quando a sessão expirou', () => {
    renderLogin({ sessionExpired: true })
    expect(screen.getByText('Sua sessão expirou')).toBeInTheDocument()
  })
})
