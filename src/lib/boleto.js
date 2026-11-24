// Leitura de boletos: linha digitável bancária (47 dígitos), de arrecadação/concessionárias (48)
// e código de barras (44). Confere os dígitos verificadores e extrai valor e vencimento.

const so = (t) => String(t ?? '').replace(/\D/g, '')

export function modulo10(num) {
  let soma = 0
  let peso = 2
  for (let i = num.length - 1; i >= 0; i--) {
    let r = Number(num[i]) * peso
    if (r > 9) r = Math.floor(r / 10) + (r % 10)
    soma += r
    peso = peso === 2 ? 1 : 2
  }
  return (10 - (soma % 10)) % 10
}

function somaModulo11(num) {
  let soma = 0
  let peso = 2
  for (let i = num.length - 1; i >= 0; i--) {
    soma += Number(num[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  return soma % 11
}

// DV geral do boleto bancário (posição 5 do código de barras)
export function modulo11Banco(num) {
  const dv = 11 - somaModulo11(num)
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv
}

// DV das guias de arrecadação
export function modulo11Arrecadacao(num) {
  const resto = somaModulo11(num)
  return resto < 2 ? 0 : 11 - resto
}

const BASE_ANTIGA = Date.UTC(1997, 9, 7) // data-base 07/10/1997 (fator 1000 = 03/07/2000)
const BASE_NOVA = Date.UTC(2025, 1, 22) // fator voltou a 1000 em 22/02/2025
const DIA = 86400000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

// Converte o fator de vencimento em data. Como o fator reiniciou em 2025, escolhe a data mais próxima de hoje.
export function dataDoFator(fator, hoje = new Date()) {
  const f = Number(fator)
  if (!f || f < 1000) return null
  const ref = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const candidatos = [BASE_ANTIGA + f * DIA, BASE_NOVA + (f - 1000) * DIA]
  candidatos.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref))
  return iso(candidatos[0])
}

// Monta a linha digitável a partir do código de barras bancário (usado também nos testes)
export function linhaDoCodigoBanco(cb) {
  const livre = cb.slice(19)
  const c1 = cb.slice(0, 4) + livre.slice(0, 5)
  const c2 = livre.slice(5, 15)
  const c3 = livre.slice(15, 25)
  return c1 + modulo10(c1) + c2 + modulo10(c2) + c3 + modulo10(c3) + cb[4] + cb.slice(5, 19)
}

function lerBancario(cb, hoje) {
  const dvOk = modulo11Banco(cb.slice(0, 4) + cb.slice(5)) === Number(cb[4])
  const fator = cb.slice(5, 9)
  return {
    tipo: 'bancario',
    banco: cb.slice(0, 3),
    codigoBarras: cb,
    valor: Number(cb.slice(9, 19)) / 100,
    vencimento: dataDoFator(fator, hoje),
    valido: dvOk,
  }
}

function lerArrecadacao(cb) {
  const ref = cb[2]
  const mod = ref === '6' || ref === '7' ? modulo10 : modulo11Arrecadacao
  const valido = mod(cb.slice(0, 3) + cb.slice(4)) === Number(cb[3])
  // Posição 3 = 6 ou 8: valor efetivo em reais; 7 ou 9: valor de referência (não é dinheiro)
  const temValor = ref === '6' || ref === '8'
  return { tipo: 'arrecadacao', banco: null, codigoBarras: cb, valor: temValor ? Number(cb.slice(4, 15)) / 100 : null, vencimento: null, valido }
}

// Aceita a linha com pontos e espaços. Retorna null se não tiver 44, 47 ou 48 dígitos.
export function lerBoleto(texto, hoje = new Date()) {
  const d = so(texto)
  if (d.length === 44) return d[0] === '8' ? lerArrecadacao(d) : lerBancario(d, hoje)
  if (d.length === 47) {
    const campos = [[0, 9], [10, 20], [21, 31]]
    const camposOk = campos.every(([i, f]) => modulo10(d.slice(i, f)) === Number(d[f]))
    const cb = d.slice(0, 4) + d[32] + d.slice(33) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31)
    const r = lerBancario(cb, hoje)
    return { ...r, linha: d, valido: r.valido && camposOk }
  }
  if (d.length === 48 && d[0] === '8') {
    const blocos = [0, 1, 2, 3].map((k) => d.slice(k * 12, k * 12 + 11))
    const ref = d[2]
    const mod = ref === '6' || ref === '7' ? modulo10 : modulo11Arrecadacao
    const blocosOk = blocos.every((b, k) => mod(b) === Number(d[k * 12 + 11]))
    const r = lerArrecadacao(blocos.join(''))
    return { ...r, linha: d, valido: r.valido && blocosOk }
  }
  return null
}

export const NOMES_BANCOS = {
  '001': 'Banco do Brasil', '033': 'Santander', '104': 'Caixa', '237': 'Bradesco', '341': 'Itaú', '356': 'Real',
  '389': 'Mercantil', '399': 'HSBC', '422': 'Safra', '748': 'Sicredi', '756': 'Sicoob', '077': 'Inter', '260': 'Nubank',
  '336': 'C6', '212': 'Original', '070': 'BRB', '004': 'Banco do Nordeste', '037': 'Banpará', '041': 'Banrisul',
}
