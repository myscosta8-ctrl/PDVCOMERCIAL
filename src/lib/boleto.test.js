import { describe, expect, it } from 'vitest'
import { dataDoFator, lerBoleto, linhaDoCodigoBanco, modulo10, modulo11Arrecadacao, modulo11Banco } from './boleto.js'

// Monta um código de barras bancário válido: banco 237, fator 2000, R$ 1.234,56
function codigoBanco(fator = '2000', valor = '0000123456') {
  const semDv = '2379' + fator + valor + '1234567890123456789012345'
  const dv = modulo11Banco(semDv)
  return semDv.slice(0, 4) + dv + semDv.slice(4)
}

describe('boleto', () => {
  it('módulo 10 e 11 conferem exemplos conhecidos', () => {
    expect(modulo10('001905009')).toBe(5)
  })

  it('fator de vencimento considera o reinício de 2025', () => {
    const hoje = new Date(2026, 10, 24)
    expect(dataDoFator('1000', hoje)).toBe('2025-02-22')
    expect(dataDoFator('2000', hoje)).toBe('2027-11-19')
    expect(dataDoFator('9999', new Date(2025, 0, 10))).toBe('2025-02-21')
    expect(dataDoFator('0000', hoje)).toBeNull()
  })

  it('lê a linha digitável bancária com pontuação', () => {
    const cb = codigoBanco()
    const l = linhaDoCodigoBanco(cb)
    const formatada = `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`
    const r = lerBoleto(formatada, new Date(2026, 10, 24))
    expect(r).toMatchObject({ tipo: 'bancario', banco: '237', valor: 1234.56, vencimento: '2027-11-19', valido: true, codigoBarras: cb })
  })

  it('acusa dígito errado', () => {
    const l = linhaDoCodigoBanco(codigoBanco())
    const errada = l.slice(0, 12) + ((Number(l[12]) + 1) % 10) + l.slice(13)
    expect(lerBoleto(errada).valido).toBe(false)
  })

  it('lê o código de barras de 44 dígitos', () => {
    expect(lerBoleto(codigoBanco('1500', '0000005000'), new Date(2026, 10, 24))).toMatchObject({ valor: 50, vencimento: '2026-07-07', valido: true })
  })

  it('lê a guia de concessionária de 48 dígitos', () => {
    const semDv = '858' + '00000015990' + '0123' + '4567890123456789012345678'
    const cb = semDv.slice(0, 3) + modulo11Arrecadacao(semDv) + semDv.slice(3)
    expect(cb).toHaveLength(44)
    const linha = [0, 1, 2, 3].map((k) => { const b = cb.slice(k * 11, k * 11 + 11); return b + modulo11Arrecadacao(b) }).join('')
    expect(lerBoleto(linha)).toMatchObject({ tipo: 'arrecadacao', valor: 159.9, valido: true })
  })

  it('ignora textos que não são boleto', () => {
    expect(lerBoleto('123')).toBeNull()
  })
})
