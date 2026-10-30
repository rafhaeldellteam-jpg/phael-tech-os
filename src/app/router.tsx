import { createBrowserRouter, Navigate } from 'react-router'
import { RedirectIfAuthenticated, RequireAuth } from '@/core/auth/RequireAuth'
import { RequireCompany } from '@/core/company/RequireCompany'
import { navigation } from '@/core/permissions/navigation'
import { RequirePermission } from '@/core/permissions/RequirePermission'
import { AppShell } from '@/layout/AppShell'
import { AcceptInvitePage } from '@/modules/auth/AcceptInvitePage'
import { ForgotPasswordPage } from '@/modules/auth/ForgotPasswordPage'
import { LoginPage } from '@/modules/auth/LoginPage'
import { ResetPasswordPage } from '@/modules/auth/ResetPasswordPage'
import { SignUpPage } from '@/modules/auth/SignUpPage'
import { DashboardPage } from '@/modules/dashboard/DashboardPage'
import { NotFoundPage } from '@/modules/NotFoundPage'
import { CatalogPage } from '@/modules/catalog/CatalogPage'
import { FinancePage } from '@/modules/finance/FinancePage'
import { ProductDetailPage } from '@/modules/inventory/ProductDetailPage'
import { ProductListPage } from '@/modules/inventory/ProductListPage'
import { CreateCompanyPage } from '@/modules/onboarding/CreateCompanyPage'
import { SuppliersPage } from '@/modules/suppliers/SuppliersPage'
import { OrderDetailPage } from '@/modules/orders/OrderDetailPage'
import { OrderFormPage } from '@/modules/orders/OrderFormPage'
import { OrderListPage } from '@/modules/orders/OrderListPage'
import { ClientDetailPage } from '@/modules/clients/ClientDetailPage'
import { ClientFormPage } from '@/modules/clients/ClientFormPage'
import { ClientListPage } from '@/modules/clients/ClientListPage'
import { EquipmentDetailPage } from '@/modules/equipment/EquipmentDetailPage'
import { EquipmentFormPage } from '@/modules/equipment/EquipmentFormPage'
import { EquipmentListPage } from '@/modules/equipment/EquipmentListPage'
import { AuditPage } from '@/modules/settings/AuditPage'
import { CompanySettingsPage } from '@/modules/settings/CompanySettingsPage'
import { MembersPage } from '@/modules/settings/MembersPage'
import { ContractsPage } from '@/modules/digital/ContractsPage'
import { DigitalPage } from '@/modules/digital/DigitalPage'
import { ReportsPage } from '@/modules/reports/ReportsPage'
import { SchedulePage } from '@/modules/schedule/SchedulePage'
import { WarrantiesPage } from '@/modules/warranties/WarrantiesPage'
import { ModuleUnavailablePage } from '@/modules/unavailable/ModuleUnavailablePage'

const futureModulePaths = navigation
  .flatMap((s) => s.items)
  .filter((i) => !i.ready)
  .map((i) => i.path)

export const router = createBrowserRouter([
  {
    element: <RedirectIfAuthenticated />,
    children: [
      { path: '/entrar', element: <LoginPage /> },
      { path: '/cadastro', element: <SignUpPage /> },
      { path: '/recuperar-senha', element: <ForgotPasswordPage /> },
    ],
  },
  // Fora dos guardas: o link de recuperação cria uma sessão temporária.
  { path: '/redefinir-senha', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/bem-vindo', element: <CreateCompanyPage /> },
      { path: '/convite', element: <AcceptInvitePage /> },
      {
        element: <RequireCompany />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <DashboardPage /> },
              {
                element: <RequirePermission anyOf={['company.read']} />,
                children: [{ path: '/empresa', element: <CompanySettingsPage /> }],
              },
              {
                element: <RequirePermission anyOf={['members.read']} />,
                children: [{ path: '/equipe', element: <MembersPage /> }],
              },
              {
                element: <RequirePermission anyOf={['orders.read_all', 'orders.read_assigned']} />,
                children: [
                  { path: '/ordens', element: <OrderListPage /> },
                  { path: '/ordens/:id', element: <OrderDetailPage /> },
                ],
              },
              {
                element: <RequirePermission anyOf={['orders.create']} />,
                children: [{ path: '/ordens/nova', element: <OrderFormPage /> }],
              },
              {
                element: <RequirePermission anyOf={['orders.update']} />,
                children: [{ path: '/ordens/:id/editar', element: <OrderFormPage /> }],
              },
              {
                element: <RequirePermission anyOf={['clients.read']} />,
                children: [
                  { path: '/clientes', element: <ClientListPage /> },
                  { path: '/clientes/:id', element: <ClientDetailPage /> },
                ],
              },
              {
                element: <RequirePermission anyOf={['clients.write']} />,
                children: [
                  { path: '/clientes/novo', element: <ClientFormPage /> },
                  { path: '/clientes/:id/editar', element: <ClientFormPage /> },
                ],
              },
              {
                element: <RequirePermission anyOf={['equipment.read']} />,
                children: [
                  { path: '/equipamentos', element: <EquipmentListPage /> },
                  { path: '/equipamentos/:id', element: <EquipmentDetailPage /> },
                ],
              },
              {
                element: <RequirePermission anyOf={['equipment.write']} />,
                children: [
                  { path: '/equipamentos/novo', element: <EquipmentFormPage /> },
                  { path: '/equipamentos/:id/editar', element: <EquipmentFormPage /> },
                ],
              },
              {
                element: <RequirePermission anyOf={['catalog.read']} />,
                children: [{ path: '/servicos', element: <CatalogPage /> }],
              },
              {
                element: <RequirePermission anyOf={['inventory.read']} />,
                children: [
                  { path: '/estoque', element: <ProductListPage /> },
                  { path: '/estoque/:id', element: <ProductDetailPage /> },
                ],
              },
              {
                element: <RequirePermission anyOf={['suppliers.write', 'inventory.write']} />,
                children: [{ path: '/fornecedores', element: <SuppliersPage /> }],
              },
              {
                element: <RequirePermission anyOf={['finance.read']} />,
                children: [{ path: '/financeiro', element: <FinancePage /> }],
              },
              {
                element: <RequirePermission anyOf={['reports.operational', 'reports.financial']} />,
                children: [{ path: '/relatorios', element: <ReportsPage /> }],
              },
              {
                element: <RequirePermission anyOf={['clients.read']} />,
                children: [{ path: '/sites', element: <DigitalPage /> }],
              },
              {
                element: <RequirePermission anyOf={['finance.read']} />,
                children: [{ path: '/contratos', element: <ContractsPage /> }],
              },
              {
                element: <RequirePermission anyOf={['schedule.read']} />,
                children: [{ path: '/agenda', element: <SchedulePage /> }],
              },
              {
                element: <RequirePermission anyOf={['orders.read_all', 'orders.read_assigned']} />,
                children: [{ path: '/garantias', element: <WarrantiesPage /> }],
              },
              {
                element: <RequirePermission anyOf={['audit.read']} />,
                children: [{ path: '/auditoria', element: <AuditPage /> }],
              },
              ...futureModulePaths.map((path) => ({ path, element: <ModuleUnavailablePage /> })),
            ],
          },
        ],
      },
    ],
  },
  { path: '/login', element: <Navigate to="/entrar" replace /> },
  { path: '*', element: <NotFoundPage /> },
])
