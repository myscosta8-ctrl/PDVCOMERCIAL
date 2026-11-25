import { describe, it, expect } from 'vitest'
import { gerarTxid, brCodeDinamico, validarConfig, corpoCobranca, situacao, crc16 } from '../../supabase/functions/pix/pix.ts'
import { crc16 as crcLoja } from './pix.js'

describe('PIX dinâmico', () => {
  it('txid com 30 letras e números', () => {
    const t = gerarTxid()
    expect(t).toMatch(/^[A-Za-z0-9]{30}$/)
    expect(gerarTxid()).not.toBe(t)
  })
  it('BR Code dinâmico com location, sem valor fixo e CRC correto', () => {
    const c = brCodeDinamico('https://pix.banco.com.br/qr/v2/cobv/9d36b84f', 'Loja Teste', 'Breves')
    expect(c.startsWith('000201010212')).toBe(true)
    expect(c).toContain('25' + String('pix.banco.com.br/qr/v2/cobv/9d36b84f'.length).padStart(2, '0') + 'pix.banco.com.br/qr/v2/cobv/9d36b84f')
    expect(c).not.toContain('5406')
    expect(c.slice(-4)).toBe(crcLoja(c.slice(0, -4)))
    expect(crc16('123456789')).toBe('29B1')
  })
  it('valida a configuração do banco', () => {
    expect(() => validarConfig({ url_api: 'http://x', chave: '' })).toThrow(/endereço da API Pix.*token.*chave/)
    expect(validarConfig({ url_api: 'https://api.banco/v2/', url_token: 'https://api.banco/oauth/token', chave: 'a@b.com' }))
      .toEqual({ url_api: 'https://api.banco/v2', url_token: 'https://api.banco/oauth/token', chave: 'a@b.com', expiracao: 600 })
  })
  it('monta a cobrança e lê a situação', () => {
    expect(corpoCobranca(12.5, 'chave', 300, 'Loja São João')).toEqual({ calendario: { expiracao: 300 }, valor: { original: '12.50' }, chave: 'chave', solicitacaoPagador: 'Loja Sao Joao' })
    expect(() => corpoCobranca(0, 'c', 300)).toThrow()
    expect(situacao('CONCLUIDA')).toBe('concluida')
    expect(situacao('ATIVA')).toBe('ativa')
    expect(situacao('REMOVIDA_PELO_PSP')).toBe('cancelada')
  })
})
