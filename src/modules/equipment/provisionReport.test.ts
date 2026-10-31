import { describe, expect, it } from 'vitest'
import { parseProvisionReport, splitMakerModel, toEquipmentFields } from './provisionReport'

// Mesmo formato de core/provision.py:write_report (Phael Tech Provision 2).
const sample = [
  '﻿PHAEL TECH PROVISION — Relatório de provisionamento (29/10/2026 14:35)',
  '='.repeat(72),
  'Computador ........ DESKTOP-ABC123',
  'Fabricante/Modelo . Dell Inc. Latitude 5440',
  'Service Tag       : 7XK2LM3',
  'Patrimônio ........ —',
  'Sistema ........... Microsoft Windows 11 Pro 24H2 (build 26100.2314)',
  'Processador ....... 13th Gen Intel(R) Core(TM) i5-1335U',
  'Placa-mãe ......... Dell Inc. 0T7V1P',
  'Memória ........... 16 GB em 2 pente(s) de 2 slot(s)',
  'Áudio ............. Realtek Audio',
  'Vídeo ............. Intel(R) Iris(R) Xe Graphics',
  'Disco ............. KIOXIA KBG50ZNV512G — 512 GB — Healthy',
  '',
  'LOG DA SESSÃO',
  '-'.repeat(72),
  '[14:01] Office instalado',
  '[14:20] Drivers Dell atualizados (12)',
].join('\r\n')

describe('relatório do Provision', () => {
  it('lê os campos da máquina', () => {
    const r = parseProvisionReport(sample)
    expect(r.generatedAt).toBe('2026-10-29T14:35:00')
    expect(r.hostname).toBe('DESKTOP-ABC123')
    expect(r.manufacturer).toBe('Dell')
    expect(r.model).toBe('Latitude 5440')
    expect(r.serial).toBe('7XK2LM3')
    expect(r.assetTag).toBeNull()
    expect(r.os).toBe('Microsoft Windows 11 Pro 24H2')
    expect(r.memory).toBe('16 GB (2 pentes, 2 slots)')
    expect(r.disks).toEqual(['KIOXIA KBG50ZNV512G — 512 GB — Healthy'])
    expect(r.log).toEqual(['[14:01] Office instalado', '[14:20] Drivers Dell atualizados (12)'])
  })

  it('aceita o rótulo de série de Lenovo/HP', () => {
    const r = parseProvisionReport(sample.replace('Service Tag       : 7XK2LM3', 'Número de série (S/N): PF3ABCDE'))
    expect(r.serial).toBe('PF3ABCDE')
  })

  it('recusa arquivo que não é do Provision', () => {
    expect(() => parseProvisionReport('qualquer coisa')).toThrow(/Phael Tech Provision/)
  })

  it('separa fabricante e modelo', () => {
    expect(splitMakerModel('LENOVO 21JK0061BR')).toEqual({ manufacturer: 'LENOVO', model: '21JK0061BR' })
    expect(splitMakerModel('Positivo Tecnologia SA Master N4340')).toEqual({ manufacturer: 'Positivo Tecnologia SA', model: 'Master N4340' })
    expect(splitMakerModel('Fabricante Desconhecido X1')).toEqual({ manufacturer: 'Fabricante', model: 'Desconhecido X1' })
  })

  it('gera os campos da ficha do equipamento', () => {
    const f = toEquipmentFields(parseProvisionReport(sample))
    expect(f.serial_number).toBe('7XK2LM3')
    expect(f.storage).toBe('KIOXIA KBG50ZNV512G — 512 GB')
    expect(f.operating_system).toBe('Microsoft Windows 11 Pro 24H2')
  })
})
