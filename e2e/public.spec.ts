import { expect, test } from '@playwright/test'

// Não dependem de backend: verificam proteção de rotas, formulários e responsividade.

test('visitante é levado ao login ao abrir uma rota protegida', async ({ page }) => {
  await page.goto('/equipe')
  await expect(page).toHaveURL(/\/entrar$/)
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
})

test('login valida os campos antes de enviar', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Informe o e-mail')).toBeVisible()
})

test('links entre login, cadastro e recuperação funcionam', async ({ page }) => {
  await page.goto('/entrar')
  await page.getByRole('link', { name: 'Criar conta' }).click()
  await expect(page.getByRole('heading', { name: 'Criar conta' })).toBeVisible()
  await page.getByRole('link', { name: 'Já tenho conta' }).click()
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click()
  await expect(page.getByRole('heading', { name: 'Recuperar senha' })).toBeVisible()
})

test('página inexistente mostra 404', async ({ page }) => {
  await page.goto('/nao-existe')
  await expect(page.getByText('Esta página não existe')).toBeVisible()
})

test('login não tem rolagem horizontal (responsividade)', async ({ page }) => {
  await page.goto('/entrar')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
