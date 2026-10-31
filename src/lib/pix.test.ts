import { describe, expect, it } from 'vitest'
import { buildPixPayload, crc16, normalizePixKey, pixText } from './pix'

describe('Pix copia e cola', () => {
  it('reproduz o exemplo do manual do Banco Central (CRC 1D3D)', () => {
    const payload = buildPixPayload({ key: '123e4567-e12b-12d1-a456-426655440000', name: 'Fulano de Tal', city: 'BRASILIA' })
    expect(payload).toBe('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D')
  })

  it('inclui valor com duas casas e txid', () => {
    const p = buildPixPayload({ key: '+5511913347390', name: 'Phael Tech Support', city: 'São Paulo', amountCents: 25000, txid: 'LANC-000123' })
    expect(p).toContain('5406250.00')
    expect(p).toContain('0114+5511913347390')
    expect(p).toContain('6009Sao Paulo')
    expect(p).toContain('62140510LANC000123')
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)))
  })

  it('normaliza chaves', () => {
    expect(normalizePixKey('phone', '(11) 91334-7390')).toBe('+5511913347390')
    expect(normalizePixKey('phone', '+55 11 91334-7390')).toBe('+5511913347390')
    expect(normalizePixKey('phone', '1234')).toBeNull()
    expect(normalizePixKey('email', 'Phael.TechSuporte@gmail.com')).toBe('phael.techsuporte@gmail.com')
    expect(normalizePixKey('cpf', '529.982.247-25')).toBe('52998224725')
    expect(normalizePixKey('random', 'nao-e-uuid')).toBeNull()
  })

  it('limpa textos para o padrão do banco', () => {
    expect(pixText('Ação & Cia — São João', 25)).toBe('Acao Cia Sao Joao')
    expect(pixText('x'.repeat(40), 25)).toHaveLength(25)
  })
})
