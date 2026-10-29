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

  // Clientes: cadastro com validação, aviso de duplicidade e ficha.
  await page.goto('/clientes/novo')
  await page.getByLabel('Nome completo').fill('Maria Souza')
  await page.getByLabel('CPF (opcional)').fill('529.982.247-24')
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await expect(page.getByText('CPF inválido')).toBeVisible()
  await page.getByLabel('CPF (opcional)').fill('529.982.247-25')
  await page.getByLabel('WhatsApp').fill('(11) 98765-4321')
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await expect(page.getByRole('heading', { name: 'Maria Souza' })).toBeVisible()
  await expect(page.getByText('529.982.247-25')).toBeVisible()

  await page.goto('/clientes/novo')
  await page.getByLabel('Nome completo').fill('maria souza')
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click()
  await expect(page.getByText('Já existem clientes parecidos')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()

  // Equipamento a partir da ficha do cliente, com etiqueta QR.
  await page.goto('/clientes')
  await page.getByRole('link', { name: 'Maria Souza' }).click()
  await page.getByRole('tab', { name: /Equipamentos/ }).click()
  await page.getByRole('link', { name: 'Novo equipamento' }).click()
  await page.getByLabel('Fabricante').fill('Dell')
  await page.getByLabel('Modelo').fill('Inspiron 15')
  await page.getByLabel('Número de série').fill(`SN-${stamp}`)
  await page.getByLabel('Acessórios recebidos').fill('Carregador, mochila')
  await page.getByRole('button', { name: 'Cadastrar equipamento' }).click()
  await expect(page.getByRole('heading', { name: 'Dell Inspiron 15' })).toBeVisible()
  await expect(page.getByRole('img', { name: /QR Code da ficha EQ-0001/ })).toBeVisible()

  // Pesquisa global encontra o equipamento.
  await page.getByLabel('Pesquisar clientes e equipamentos').fill('inspiron')
  await expect(page.getByRole('option', { name: /Dell Inspiron 15/ })).toBeVisible()

  // Módulo futuro aparece como indisponível, sem dados simulados.
  await page.goto('/financeiro')
  await expect(page.getByText('Módulo ainda não disponível')).toBeVisible()
})
