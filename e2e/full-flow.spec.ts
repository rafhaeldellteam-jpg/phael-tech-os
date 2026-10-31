import { readFileSync } from 'node:fs'
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
  const pdf = page.waitForEvent('download')
  await page.getByRole('button', { name: 'PDF de entrada' }).click()
  const file = await pdf
  expect(file.suggestedFilename()).toBe('OS-0001-entrada.pdf')
  const bytes = readFileSync(await file.path())
  expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
  expect(bytes.toString('latin1')).toContain('/DCTDecode')

  // Portal do cliente: link sem login, só dados não sensíveis.
  await page.getByRole('button', { name: 'Gerar link' }).click()
  const portalUrl = await page.getByRole('textbox', { name: 'Link de acompanhamento' }).inputValue()
  expect(portalUrl).toMatch(/\/acompanhar\/[A-Za-z0-9_-]{43}$/)
  const browser = page.context().browser()
  if (!browser) throw new Error('navegador indisponível')
  const visitor = await browser.newContext()
  const portal = await visitor.newPage()
  await portal.goto(portalUrl)
  await expect(portal.getByRole('heading', { name: /OS-0001/ })).toBeVisible()
  await expect(portal.getByText('Olá, Maria.')).toBeVisible()
  await expect(portal.getByText('529.982.247-25')).toHaveCount(0)
  await portal.goto(portalUrl.replace(/[A-Za-z0-9_-]{43}$/, 'x'.repeat(43)))
  await expect(portal.getByText('Link inválido ou expirado')).toBeVisible()
  await visitor.close()
  // Também abre com a equipe logada no mesmo navegador (sessão não interfere no portal).
  const backTo = page.url()
  await page.goto(portalUrl)
  await expect(page.getByRole('heading', { name: /OS-0001/ })).toBeVisible()
  await page.goto(backTo)

  // Assinatura eletrônica do cliente no comprovante de entrada.
  await page.getByRole('button', { name: 'Colher assinatura do cliente' }).click()
  const signatureBox = page.getByRole('img', { name: /área para desenhar a assinatura/ })
  const box = await signatureBox.boundingBox()
  if (!box) throw new Error('quadro de assinatura não encontrado')
  await page.mouse.move(box.x + 30, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + 30 + i * 12, box.y + box.height / 2 + Math.sin(i) * 25)
  await page.mouse.up()
  await page.getByRole('checkbox', { name: /Confirmo que entreguei o equipamento/ }).check()
  await page.getByRole('button', { name: 'Confirmar assinatura' }).click()
  await expect(page.getByRole('img', { name: 'Assinatura de Maria Souza' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Colher assinatura do cliente' })).toHaveCount(0)
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
  await page.getByLabel('Garantia (dias)').fill('90')
  await page.getByRole('button', { name: 'Lançar e baixar do estoque' }).click()
  await expect(page.getByText('R$ 220,00').first()).toBeVisible()

  await page.goto('/estoque')
  await expect(page.getByRole('row', { name: /SSD 240 GB/ })).toContainText('2 un')

  // Financeiro: contas sugeridas, cobrança gerada pela OS e recebimento.
  await page.goto('/financeiro?aba=configuracoes')
  await page.getByRole('button', { name: 'Criar contas e categorias sugeridas' }).click()
  await expect(page.getByRole('region', { name: 'Contas' }).getByRole('listitem')).toHaveCount(2)
  await page.goto(orderUrl)
  await page.getByRole('button', { name: 'Gerar cobrança' }).click()
  await page.getByRole('button', { name: 'Lançar' }).click()
  await page.getByRole('button', { name: /À vista, vence/ }).click()
  await page.getByRole('button', { name: 'Registrar recebimento' }).click()
  await expect(page.getByText('Quitado', { exact: true })).toBeVisible()
  await page.goto('/financeiro')
  await expect(page.getByText('Recebimentos')).toBeVisible()

  // Garantia: entrega da OS, prazo da peça, acionamento com OS de retorno e aceite.
  await page.goto(orderUrl)
  for (const next of ['Em reparo', 'Pronto para retirada', 'Entregue']) {
    await page.getByRole('button', { name: 'Mudar status' }).click()
    await page.getByRole('radio', { name: next, exact: true }).check()
    await page.getByRole('button', { name: 'Confirmar mudança' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
  const garantia = page.getByRole('region', { name: 'Garantia' })
  await expect(garantia.getByText('90 dias restantes')).toBeVisible()
  await garantia.getByRole('button', { name: 'Acionar garantia' }).click()
  await page.getByLabel('Defeito relatado pelo cliente').fill('SSD não é reconhecido')
  await page.getByRole('button', { name: 'Abrir OS de retorno' }).click()
  await expect(page.getByText('OS de retorno em garantia aberta.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /OS-0002/ })).toBeVisible()
  await page.getByRole('region', { name: 'Garantia' }).getByRole('button', { name: 'Aceitar' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Aceitar garantia' }).click()
  await expect(page.getByRole('region', { name: 'Garantia' }).getByText('Aceita', { exact: true })).toBeVisible()
  await page.goto('/garantias?aba=acionamentos')
  await expect(page.getByRole('link', { name: 'Retorno: OS-0002' })).toBeVisible()

  await page.goto('/')
  // OS-0001 foi entregue; segue aberta só a OS de retorno (garantia).
  await expect(page.getByRole('link', { name: /1\s*Em andamento/ })).toBeVisible()
  await expect(page.getByText(/1 acionamento\(s\) de garantia em andamento/)).toBeVisible()
  await page.goto('/equipamentos')
  await page.getByRole('link', { name: 'Dell Inspiron 15' }).click()

  // Pesquisa global encontra o equipamento.
  await page.getByLabel('Pesquisar clientes e equipamentos').fill('inspiron')
  await expect(page.getByRole('option', { name: /Dell Inspiron 15/ })).toBeVisible()

  // Agenda: agendamento na semana atual, confirmação e conversão em OS.
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const startLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T23:00`
  await page.goto('/agenda')
  await page.getByRole('button', { name: 'Novo agendamento' }).click()
  await page.getByLabel('Assunto').fill('Visita: impressora travando')
  await page.getByRole('combobox', { name: 'Cliente' }).fill('maria')
  await page.getByRole('option', { name: /Maria Souza/ }).click()
  await page.getByLabel('Início').fill(startLocal)
  await page.getByLabel('Local').fill('Rua das Flores, 100')
  await page.getByRole('button', { name: 'Agendar' }).click()
  await page.getByRole('button', { name: /Visita: impressora travando/ }).click()
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await page.getByRole('button', { name: /Visita: impressora travando/ }).click()
  await expect(page.getByRole('dialog').getByText('Confirmado', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Converter em OS' }).click()
  await page.getByRole('button', { name: 'Abrir OS' }).click()
  await expect(page.getByRole('heading', { name: /OS-0003/ })).toBeVisible()
  await expect(page.getByText('Atendimento externo')).toBeVisible()

  // Fase 4: site do cliente e contrato recorrente que gera cobranças sem duplicar.
  await page.goto('/sites')
  await page.getByRole('button', { name: 'Novo serviço digital' }).click()
  await page.getByRole('combobox', { name: 'Cliente' }).fill('maria')
  await page.getByRole('option', { name: /Maria Souza/ }).click()
  await page.getByLabel('Nome', { exact: true }).fill('Site da Maria')
  await page.getByLabel('Endereço (URL)').fill('https://maria.example.com')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByRole('button', { name: 'Site da Maria' })).toBeVisible()
  await page.goto('/contratos')
  await page.getByRole('button', { name: 'Novo contrato' }).click()
  await page.getByRole('combobox', { name: 'Cliente' }).fill('maria')
  await page.getByRole('option', { name: /Maria Souza/ }).click()
  await page.getByLabel('Descrição').fill('Manutenção mensal do site')
  await page.getByLabel('Serviço digital (opcional)').selectOption({ label: 'Site da Maria' })
  await page.getByLabel('Valor por cobrança (R$)').fill('150,00')
  await page.getByLabel('Dia do vencimento').fill('5')
  await page.getByRole('button', { name: 'Criar contrato' }).click()
  await expect(page.getByRole('button', { name: 'Manutenção mensal do site' })).toBeVisible()
  await page.getByLabel('Vencimentos até').fill(`${now.getFullYear() + 1}-${pad(now.getMonth() + 1)}-01`)
  await page.getByRole('button', { name: 'Gerar agora' }).click()
  await expect(page.getByText(/cobrança\(s\) criada\(s\) no financeiro/)).toBeVisible()
  await page.getByRole('button', { name: 'Gerar agora' }).click()
  await expect(page.getByText('Tudo em dia: nenhuma cobrança nova.')).toBeVisible()

  // Financeiro abre com dados reais; módulo futuro aparece como indisponível.
  await page.goto('/relatorios')
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Contas a receber por atraso' })).toBeVisible()
  await page.goto('/conhecimento')
  await expect(page.getByText('Módulo ainda não disponível')).toBeVisible()
})
