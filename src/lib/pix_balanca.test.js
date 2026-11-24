import { describe, expect, it } from 'vitest'
import { crc16, gerarPix, normalizarChave } from './pix.js'
import { digitoEan13, lerEtiquetaBalanca, quantidadeDaEtiqueta } from './balanca.js'

describe('PIX com QR fixo', () => {
  it('reproduz o exemplo do manual do BR Code', () => {
    expect(gerarPix({ chave: '123e4567-e12b-12d1-a456-426655440000', nome: 'Fulano de Tal', cidade: 'BRASILIA' }))
      .toBe('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D')
  })
  it('inclui valor, tira acentos e fecha com o CRC', () => {
    const p = gerarPix({ chave: '12345678000195', nome: 'Farmácia São João', cidade: 'Breves', valor: 19.9 })
    expect(p).toContain('540519.90')
    expect(p).toContain('5917Farmacia Sao Joao')
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)))
  })
  it('normaliza chaves', () => {
    expect(normalizarChave('(91) 99876-1122')).toBe('+5591998761122')
    expect(normalizarChave('123.456.789-09')).toBe('12345678909')
    expect(normalizarChave('Loja@Exemplo.com')).toBe('loja@exemplo.com')
    expect(normalizarChave('abc')).toBeNull()
  })
})

describe('etiqueta de balança', () => {
  const etiqueta = (corpo) => corpo + digitoEan13(corpo)
  it('lê preço com 5 dígitos de código', () => {
    expect(lerEtiquetaBalanca(etiqueta('212345001990'), { ativo: true, digitos_codigo: 5, tipo: 'preco' })).toEqual({ plu: '12345', tipo: 'preco', valor: 19.9 })
  })
  it('lê peso com 4 dígitos de código', () => {
    expect(lerEtiquetaBalanca(etiqueta('200420001250'), { ativo: true, digitos_codigo: 4, tipo: 'peso' })).toEqual({ plu: '42', tipo: 'peso', peso: 1.25 })
  })
  it('recusa dígito errado e ignora códigos comuns', () => {
    expect(lerEtiquetaBalanca('2123450019900', { ativo: true, digitos_codigo: 5, tipo: 'preco' }).erro).toMatch(/dígito/)
    expect(lerEtiquetaBalanca('7896004700120', { ativo: true })).toBeNull()
    expect(lerEtiquetaBalanca(etiqueta('212345001990'), { ativo: false })).toBeNull()
  })
  it('converte valor em quilos pelo preço', () => {
    expect(quantidadeDaEtiqueta({ tipo: 'preco', valor: 19.9 }, 39.8)).toBe(0.5)
  })
})
