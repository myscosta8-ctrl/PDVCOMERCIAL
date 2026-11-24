// Leitura do XML da NF-e de compra (modelo 55, layout 4.00), no próprio navegador.

const num = (v) => (v == null || v === '' ? 0 : Number(v))
const so = (v) => String(v ?? '').replace(/\D/g, '')

function filho(el, nome) {
  if (!el) return null
  for (const c of el.children) if (c.localName === nome) return c
  return null
}
function caminho(el, ...nomes) {
  let atual = el
  for (const n of nomes) { atual = filho(atual, n); if (!atual) return null }
  return atual
}
const texto = (el, ...nomes) => caminho(el, ...nomes)?.textContent?.trim() ?? null
function todos(el, nome) {
  return el ? Array.from(el.getElementsByTagNameNS('*', nome)) : []
}
// Valor de uma tag dentro de qualquer grupo filho (ex.: ICMS > ICMS10 > vICMSST)
function profundo(el, nome) {
  const e = todos(el, nome)[0]
  return e ? e.textContent.trim() : null
}

export function lerXmlNfe(xmlTexto) {
  const doc = new DOMParser().parseFromString(xmlTexto, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Arquivo XML inválido.')
  const inf = todos(doc, 'infNFe')[0]
  if (!inf) throw new Error('O arquivo não é uma NF-e.')
  const ide = filho(inf, 'ide')
  const modelo = texto(ide, 'mod')
  if (modelo && modelo !== '55') throw new Error(`O arquivo é um documento modelo ${modelo}; envie o XML da NF-e (modelo 55).`)

  const chave = (todos(doc, 'chNFe')[0]?.textContent || inf.getAttribute('Id') || '').replace(/^NFe/, '').trim()
  if (!/^\d{44}$/.test(chave)) throw new Error('Chave de acesso não encontrada no XML.')
  const autorizada = Boolean(todos(doc, 'protNFe').length)

  const emit = filho(inf, 'emit')
  const dest = filho(inf, 'dest')
  const tot = caminho(inf, 'total', 'ICMSTot')

  const itens = todos(inf, 'det').map((det) => {
    const prod = filho(det, 'prod')
    const imp = filho(det, 'imposto')
    const qCom = num(texto(prod, 'qCom'))
    const total = num(texto(prod, 'vProd')) - num(texto(prod, 'vDesc')) + num(texto(prod, 'vFrete')) + num(texto(prod, 'vSeg')) +
      num(texto(prod, 'vOutro')) + num(profundo(caminho(imp, 'IPI'), 'vIPI')) + num(profundo(caminho(imp, 'ICMS'), 'vICMSST')) +
      num(profundo(caminho(imp, 'ICMS'), 'vFCPST'))
    const rastros = Array.from(prod.children).filter((c) => c.localName === 'rastro').map((r) => ({
      lote: texto(r, 'nLote'), quantidade: num(texto(r, 'qLote')), fabricacao: texto(r, 'dFab'), validade: texto(r, 'dVal'),
    }))
    const ean = texto(prod, 'cEAN')
    // Grupo do ICMS (ICMS00, ICMS10, ICMSSN102...) e valores para a escrituração (SPED)
    const grupoIcms = caminho(imp, 'ICMS')?.children?.[0] ?? null
    const icms = (nome) => (grupoIcms ? texto(grupoIcms, nome) : null)
    const fiscal = {
      cfop: texto(prod, 'CFOP'),
      orig: icms('orig'),
      cst: icms('CST') ?? null,
      csosn: icms('CSOSN') ?? null,
      vProd: num(texto(prod, 'vProd')),
      vDesc: num(texto(prod, 'vDesc')),
      vBC: num(icms('vBC')),
      pICMS: num(icms('pICMS')),
      vICMS: num(icms('vICMS')),
      vBCST: num(icms('vBCST')),
      pICMSST: num(icms('pICMSST')),
      vICMSST: num(icms('vICMSST')),
      vIPI: num(profundo(caminho(imp, 'IPI'), 'vIPI')),
    }
    return {
      fiscal,
      item: Number(det.getAttribute('nItem')),
      codigo: texto(prod, 'cProd'),
      ean: ean && /^\d{8,14}$/.test(ean) ? ean : null,
      descricao: texto(prod, 'xProd'),
      ncm: texto(prod, 'NCM'),
      cest: texto(prod, 'CEST'),
      cfop: texto(prod, 'CFOP'),
      unidade: texto(prod, 'uCom'),
      quantidade: qCom,
      valor_unitario: num(texto(prod, 'vUnCom')),
      valor_total: Math.round(total * 100) / 100,
      custo_unitario: qCom > 0 ? total / qCom : 0,
      registro_ms: texto(prod, 'med', 'cProdANVISA'),
      rastros,
    }
  })

  return {
    chave,
    autorizada,
    numero: Number(texto(ide, 'nNF')),
    serie: Number(texto(ide, 'serie') || 1),
    emissao: texto(ide, 'dhEmi') || texto(ide, 'dEmi'),
    natureza: texto(ide, 'natOp'),
    fornecedor: {
      cnpj: so(texto(emit, 'CNPJ') || texto(emit, 'CPF')),
      razao_social: texto(emit, 'xNome'),
      nome_fantasia: texto(emit, 'xFant'),
      inscricao_estadual: texto(emit, 'IE'),
      uf: texto(emit, 'enderEmit', 'UF'),
      telefone: texto(emit, 'enderEmit', 'fone'),
      municipio_ibge: texto(emit, 'enderEmit', 'cMun'),
      endereco: {
        logradouro: texto(emit, 'enderEmit', 'xLgr'), numero: texto(emit, 'enderEmit', 'nro'), complemento: texto(emit, 'enderEmit', 'xCpl'),
        bairro: texto(emit, 'enderEmit', 'xBairro'), municipio: texto(emit, 'enderEmit', 'xMun'), cep: texto(emit, 'enderEmit', 'CEP'),
      },
    },
    fiscal: {
      vBC: num(texto(tot, 'vBC')), vICMS: num(texto(tot, 'vICMS')), vBCST: num(texto(tot, 'vBCST')), vST: num(texto(tot, 'vST')),
      vIPI: num(texto(tot, 'vIPI')), vPIS: num(texto(tot, 'vPIS')), vCOFINS: num(texto(tot, 'vCOFINS')), vFrete: num(texto(tot, 'vFrete')),
      vSeg: num(texto(tot, 'vSeg')), vDesc: num(texto(tot, 'vDesc')), vOutro: num(texto(tot, 'vOutro')),
      modFrete: texto(caminho(inf, 'transp'), 'modFrete'),
    },
    destinatario_cnpj: so(texto(dest, 'CNPJ') || texto(dest, 'CPF')),
    valor_produtos: num(texto(tot, 'vProd')),
    valor_total: num(texto(tot, 'vNF')),
    duplicatas: todos(caminho(inf, 'cobr'), 'dup').map((d) => ({ numero: texto(d, 'nDup'), vencimento: texto(d, 'dVenc'), valor: num(texto(d, 'vDup')) })),
    itens,
  }
}
