// Etiqueta de balança (EAN-13 começando com 2): 2 + código do produto + valor (preço ou peso) + dígito verificador.
// Ex. com 5 dígitos de código: 2 12345 001990 D -> produto 12345, R$ 19,90 (ou 1,990 kg se a etiqueta for de peso).

export function digitoEan13(doze) {
  let s = 0
  for (let i = 0; i < 12; i++) s += Number(doze[i]) * (i % 2 ? 3 : 1)
  return (10 - (s % 10)) % 10
}

export function lerEtiquetaBalanca(codigo, config) {
  if (!config?.ativo) return null
  const c = String(codigo ?? '').trim()
  if (!/^2\d{12}$/.test(c)) return null
  if (digitoEan13(c.slice(0, 12)) !== Number(c[12])) return { erro: 'Etiqueta da balança com dígito verificador inválido. Leia de novo.' }
  const n = Number(config.digitos_codigo) || 5
  const plu = c.slice(1, 1 + n).replace(/^0+(?=\d)/, '')
  const bruto = Number(c.slice(1 + n, 12))
  return config.tipo === 'peso'
    ? { plu, tipo: 'peso', peso: bruto / 1000 }
    : { plu, tipo: 'preco', valor: bruto / 100 }
}

// Quantidade a lançar no carrinho: o peso da etiqueta ou o valor dividido pelo preço por quilo
export function quantidadeDaEtiqueta(etiqueta, precoKg) {
  if (etiqueta.tipo === 'peso') return Math.round(etiqueta.peso * 1000) / 1000
  if (!(precoKg > 0)) return null
  return Math.round((etiqueta.valor / precoKg) * 1000) / 1000
}
