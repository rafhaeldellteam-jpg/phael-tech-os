import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useActiveCompany, useCompany } from '@/core/company/useCompany'
import { EntriesTab } from './EntriesTab'
import { ReconcileTab } from './ReconcileTab'
import { SettingsTab } from './SettingsTab'
import { SummaryTab } from './SummaryTab'

type TabKey = 'resumo' | 'receber' | 'pagar' | 'conciliacao' | 'configuracoes'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'resumo', label: 'Resumo' },
  { key: 'receber', label: 'A receber' },
  { key: 'pagar', label: 'A pagar' },
  { key: 'conciliacao', label: 'Conciliação' },
  { key: 'configuracoes', label: 'Contas e categorias' },
]

export function FinancePage() {
  const { company } = useActiveCompany()
  const { can } = useCompany()
  const canWrite = can(['finance.write'])
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.key === params.get('aba'))?.key ?? 'resumo') as TabKey

  return (
    <div className="grid gap-5">
      <PageHeader title="Financeiro" description="Valores em centavos, sem arredondamento. Nada é apagado: cancelamentos e estornos ficam registrados." />
      <Tabs label="Seções do financeiro" items={TABS} value={tab} onChange={(k) => setParams(k === 'resumo' ? {} : { aba: k }, { replace: true })} />
      {tab === 'resumo' && <SummaryTab companyId={company.id} />}
      {tab === 'receber' && <EntriesTab key="in" companyId={company.id} direction="in" canWrite={canWrite} />}
      {tab === 'pagar' && <EntriesTab key="out" companyId={company.id} direction="out" canWrite={canWrite} />}
      {tab === 'conciliacao' && <ReconcileTab companyId={company.id} canWrite={canWrite} />}
      {tab === 'configuracoes' && <SettingsTab companyId={company.id} canWrite={canWrite} />}
    </div>
  )
}
