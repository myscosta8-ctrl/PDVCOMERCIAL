// Nomes das formas de pagamento usados em todas as telas
export const NOMES_FORMAS = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  crediario: 'Crediário',
  convenio: 'Convênio',
  vale: 'Vale-troca',
  outro: 'Outros',
}
export const nomeForma = (f) => NOMES_FORMAS[f] ?? f
