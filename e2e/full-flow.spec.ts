import { expect, test } from '@playwright/test'

// Fluxo completo contra um Supabase local real (supabase start).
// Requer confirmação de e-mail desligada (padrão do ambiente local).
// Rodar com: E2E_SUPABASE=1 npm run test:e2e
test.skip(!process.env.E2E_SUPABASE, 'Defina E2E_SUPABASE=1 com o Supabase local rodando')

test('cadastro, criação de empresa, convite e auditoria', async ({ page }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}`
  const email = `admin-${stamp}@teste.local`

  await page.goto('/cadastro')
  await page.getByLabel('Nome completo').fill('Admin Teste')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha', { exact: true }).fill('SenhaTeste2026')
  await page.getByLabel('Confirmar senha').fill('SenhaTeste2026')
  await page.getByRole('button', { name: 'Criar conta' }).click()

  await expect(page.getByRole('heading', { name: 'Criar sua empresa' })).toBeVisible()
  await page.getByLabel('Nome da empresa').fill(`Assistência ${stamp}`)
  await page.getByRole('button', { name: 'Criar empresa' }).click()

  await expect(page.getByRole('heading', { name: /Olá, Admin/ })).toBeVisible()
  await expect(page.getByText('Empresa criada')).toBeVisible()

  await page.goto('/equipe')
  await page.getByLabel('E-mail').fill(`tecnico-${stamp}@teste.local`)
  await page.getByRole('button', { name: 'Gerar convite' }).click()
  await expect(page.getByText(/Convite criado para/)).toBeVisible()
  await expect(page.locator('code', { hasText: '/convite?token=' })).toBeVisible()

  await page.goto('/auditoria')
  await expect(page.getByText(/criou convite/i).first()).toBeVisible()

  // Módulo futuro aparece como indisponível, sem dados simulados.
  await page.goto('/financeiro')
  await expect(page.getByText('Módulo ainda não disponível')).toBeVisible()
})
