import { expect, test } from '@playwright/test'

// Fluxo completo contra um Supabase local real (supabase start).
// Requer confirmação de e-mail desligada (padrão do ambiente local).
// Rodar com: E2E_SUPABASE=1 npm run test:e2e
test.skip(!process.env.E2E_SUPABASE, 'Defina E2E_SUPABASE=1 com o Supabase local rodando')
// Sistema de uso exclusivo: só a primeira empresa pode ser criada, então este fluxo
// roda uma vez por banco limpo e não pode ser repetido automaticamente.
test.describe.configure({ retries: 0 })

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

  // OS a partir do equipamento: abertura, status com motivo obrigatório e linha do tempo.
  await page.getByRole('link', { name: 'Abrir OS' }).click()
  await page.getByLabel('Problema relatado pelo cliente').fill('Não liga depois de queda')
  await page.getByRole('button', { name: 'Abrir OS' }).click()
  await expect(page.getByText('OS aberta.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /OS-0001/ })).toBeVisible()
  await page.getByRole('button', { name: 'Mudar status' }).click()
  await page.getByRole('radio', { name: 'Cancelado' }).check()
  await expect(page.getByRole('button', { name: 'Confirmar mudança' })).toBeDisabled()
  await page.getByRole('radio', { name: 'Diagnóstico', exact: true }).check()
  await page.getByRole('button', { name: 'Confirmar mudança' }).click()
  await expect(page.getByText(/mudou de Recebido para Diagnóstico/)).toBeVisible()
  await page.getByLabel('Nova observação').fill('Fonte queimada, testando outra')
  await page.getByRole('button', { name: 'Registrar observação' }).click()
  await expect(page.getByText('Fonte queimada, testando outra')).toBeVisible()

  const orderUrl = page.url()

  // Estoque: fornecedor, produto, compra recebida e peça lançada na OS.
  await page.goto('/fornecedores')
  await page.getByRole('button', { name: 'Novo fornecedor' }).click()
  await page.getByLabel('Nome', { exact: true }).fill('Distribuidora Teste')
  await page.getByRole('button', { name: 'Cadastrar fornecedor' }).click()
  await expect(page.getByText('Distribuidora Teste')).toBeVisible()

  await page.goto('/estoque')
  await page.getByRole('button', { name: 'Novo produto' }).click()
  await page.getByLabel('Código (SKU)').fill('SSD-240')
  await page.getByLabel('Nome', { exact: true }).fill('SSD 240 GB')
  await page.getByLabel('Preço de venda (R$)').fill('220,00')
  await page.getByRole('button', { name: 'Cadastrar produto' }).click()
  await expect(page.getByRole('heading', { name: 'SSD 240 GB' })).toBeVisible()

  await page.goto('/fornecedores?aba=compras')
  await page.getByRole('button', { name: 'Nova compra' }).click()
  await page.getByLabel('Fornecedor').selectOption({ label: 'Distribuidora Teste' })
  await page.getByLabel('Produto 1').fill('ssd')
  await page.getByRole('option', { name: /SSD 240 GB/ }).click()
  await page.getByLabel('Qtd.').fill('3')
  await page.getByLabel('Custo un. (R$)').fill('100,00')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await page.getByRole('button', { name: 'Receber' }).click()
  await page.getByRole('button', { name: 'Receber e dar entrada' }).click()
  await expect(page.getByText('Recebida', { exact: true })).toBeVisible()

  await page.goto(orderUrl)
  await page.getByRole('button', { name: 'Peça' }).click()
  await page.getByLabel('Peça', { exact: true }).fill('ssd')
  await page.getByRole('option', { name: /SSD 240 GB/ }).click()
  await page.getByRole('button', { name: 'Lançar e baixar do estoque' }).click()
  await expect(page.getByText('R$ 220,00').first()).toBeVisible()

  await page.goto('/estoque')
  await expect(page.getByRole('row', { name: /SSD 240 GB/ })).toContainText('2 un')

  await page.goto('/')
  await expect(page.getByRole('link', { name: /1\s*Em diagnóstico/ })).toBeVisible()
  await page.goto('/equipamentos')
  await page.getByRole('link', { name: 'Dell Inspiron 15' }).click()

  // Pesquisa global encontra o equipamento.
  await page.getByLabel('Pesquisar clientes e equipamentos').fill('inspiron')
  await expect(page.getByRole('option', { name: /Dell Inspiron 15/ })).toBeVisible()

  // Módulo futuro aparece como indisponível, sem dados simulados.
  await page.goto('/financeiro')
  await expect(page.getByText('Módulo ainda não disponível')).toBeVisible()
})
