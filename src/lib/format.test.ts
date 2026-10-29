import { formatCode, formatPhone, formatZip, whatsappLink } from './format'

describe('formatPhone', () => {
  it('celular', () => expect(formatPhone('11987654321')).toBe('(11) 98765-4321'))
  it('fixo', () => expect(formatPhone('1134567890')).toBe('(11) 3456-7890'))
  it('com DDI 55', () => expect(formatPhone('5511987654321')).toBe('(11) 98765-4321'))
  it('vazio', () => expect(formatPhone(null)).toBe(''))
  it('fora do padrão volta igual', () => expect(formatPhone('123')).toBe('123'))
})

describe('outros formatos', () => {
  it('CEP', () => expect(formatZip('01310100')).toBe('01310-100'))
  it('WhatsApp adiciona 55', () => expect(whatsappLink('(11) 98765-4321')).toBe('https://wa.me/5511987654321'))
  it('WhatsApp mantém DDI informado', () => expect(whatsappLink('5511987654321')).toBe('https://wa.me/5511987654321'))
  it('código com zeros', () => expect(formatCode('CL', 7)).toBe('CL-0007'))
  it('código grande', () => expect(formatCode('EQ', 12345)).toBe('EQ-12345'))
})
