// PIX com QR Code fixo (BR Code estático, padrão do Banco Central). Não confirma o pagamento sozinho.

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-/]/g, '').trim()
const campo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor

export function crc16(texto) {
  let crc = 0xffff
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function cpfValido(d) {
  if (/^(\d)\1{10}$/.test(d)) return false
  const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += Number(d[i]) * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

// Aceita CPF, CNPJ, e-mail, celular (+55...) ou chave aleatória
export function normalizarChave(chave) {
  const c = String(chave ?? '').trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return c.toLowerCase()
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) return c.toLowerCase()
  const d = c.replace(/\D/g, '')
  if (c.startsWith('+')) return `+${d}`
  if (d.length === 11) {
    if (c.includes('(')) return `+55${d}`
    if (cpfValido(d)) return d
    return d[2] === '9' ? `+55${d}` : null
  }
  if (d.length === 14) return d
  if (d.length === 13 && d.startsWith('55')) return `+${d}`
  return null
}

export function gerarPix({ chave, nome, cidade, valor, txid = '***', descricao }) {
  const k = normalizarChave(chave)
  if (!k) throw new Error('Chave PIX inválida. Use CPF, CNPJ, e-mail, celular com +55 ou chave aleatória.')
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', k) + (descricao ? campo('02', semAcento(descricao).slice(0, 40)) : '')
  const id = (String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***'
  let p = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986') +
    (valor > 0 ? campo('54', Number(valor).toFixed(2)) : '') + campo('58', 'BR') +
    campo('59', (semAcento(nome) || 'LOJA').slice(0, 25)) + campo('60', (semAcento(cidade) || 'BRASIL').slice(0, 15)) +
    campo('62', campo('05', txid === '***' ? '***' : id)) + '6304'
  return p + crc16(p)
}
