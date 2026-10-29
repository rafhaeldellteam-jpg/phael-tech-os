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
import { CreateCompanyPage } from '@/modules/onboarding/CreateCompanyPage'
import { AuditPage } from '@/modules/settings/AuditPage'
import { CompanySettingsPage } from '@/modules/settings/CompanySettingsPage'
import { MembersPage } from '@/modules/settings/MembersPage'
import { ModuleUnavailablePage } from '@/modules/unavailable/ModuleUnavailablePage'

const futureModulePaths = navigation
  .flatMap((s) => s.items)
  .filter((i) => i.phase > 1)
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
