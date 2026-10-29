import { useContext } from 'react'
import { CompanyContext, type CompanyContextValue, type Membership } from './CompanyProvider'

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext)
  if (!ctx) throw new Error('useCompany deve ser usado dentro de <CompanyProvider>')
  return ctx
}

/** Empresa ativa garantida (use apenas dentro de rotas protegidas por RequireCompany). */
export function useActiveCompany(): Membership {
  const { active } = useCompany()
  if (!active) throw new Error('Nenhuma empresa ativa')
  return active
}
