import { describe, it, expect, vi } from 'vitest'
vi.mock('./supabase.js', () => ({ supabase: {} }))
import { htmlComprovanteVenda, htmlFechamento, htmlComprovanteRecebimento, paginaBobina } from './impressao.js'

const empresa = { razao_social: 'Loja Teste Ltda', nome_fantasia: 'Loja <Teste>', cnpj: '12345678000195', uf: 'PA', endereco: { logradouro: 'Rua A', numero: '1', municipio: 'Breves', fone: '9199' } }
const venda = { numero: 42, criado_em: '2026-11-24T15:00:00Z', subtotal: 30, desconto: 2, acrescimo: 0, total: 28, troco: 2, status: 'concluida' }
const itens = [{ sequencia: 1, descricao: 'Sabonete', quantidade: 2, preco_unitario: 5, total: 10 }, { sequencia: 2, descricao: 'Shampoo', quantidade: 1, preco_unitario: 20, total: 20 }]

describe('impressão em bobina', () => {
  it('ajusta a largura de 58 e 80 mm', () => {
    expect(paginaBobina('x', '', 58)).toContain('size: 58mm auto')
    expect(paginaBobina('x', '', 80)).toContain('width: 72mm')
  })
  it('comprovante simples tem uma via, avisa que não é fiscal e escapa o HTML', () => {
    const h = htmlComprovanteVenda({ empresa, venda, itens, pagamentos: [{ forma: 'dinheiro', valor: 30 }], config: { mensagem: 'Volte sempre' } })
    expect(h.match(/class="via"/g)).toHaveLength(1)
    expect(h).toContain('NÃO É DOCUMENTO FISCAL')
    expect(h).toContain('Loja &lt;Teste&gt;')
    expect(h).toContain('Troco')
    expect(h).toContain('Volte sempre')
    expect(h).toContain('Tel. 9199')
  })
  it('crediário sai nas vias configuradas com assinatura', () => {
    const h = htmlComprovanteVenda({ empresa, venda, itens, pagamentos: [{ forma: 'crediario', valor: 28 }], cliente: { nome: 'Ana' },
      parcelas: [{ parcela: 1, parcelas: 2, valor: 14, vencimento: '2026-12-24' }, { parcela: 2, parcelas: 2, valor: 14, vencimento: '2027-01-24' }], config: { vias_crediario: 2 } })
    expect(h.match(/class="via"/g)).toHaveLength(2)
    expect(h).toContain('Via do cliente')
    expect(h).toContain('1/2 vence 24/12/2026')
    expect(h).toContain('Reconheço a dívida')
  })
  it('fechamento mostra a falta', () => {
    const h = htmlFechamento({ empresa, caixa: { numero_terminal: 1, aberto_em: '2026-11-24T11:00:00Z', valor_informado: 90, valor_esperado: 100 }, resumo: { formas: { dinheiro: 50 }, abertura: 50, suprimentos: 0, sangrias: 0, qtd_vendas: 1 } })
    expect(h).toMatch(/Falta<\/td><td class="r">R\$\s*10,00/)
  })
  it('recebimento mostra o saldo restante', () => {
    const h = htmlComprovanteRecebimento({ empresa, cliente: { nome: 'Ana' }, valor: 14, forma: 'pix', saldo: 14 })
    expect(h).toContain('Saldo devedor restante')
    expect(h).toContain('PIX')
  })
})
