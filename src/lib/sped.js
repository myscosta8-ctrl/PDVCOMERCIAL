// Geração do arquivo da EFD ICMS/IPI (SPED Fiscal) a partir dos dados do sistema.
// Blocos: 0 (cadastros), B, C (NF-e de entrada e NFC-e de saída), D, E (apuração do ICMS), G, H (inventário), K, 1 e 9.
// O arquivo deve ser conferido e assinado no programa validador (PVA) da Receita.

const so = (v) => String(v ?? '').replace(/\D/g, '')
const limpa = (v, max = 255) => String(v ?? '').replace(/[|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const arred = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100
const dec = (v, casas = 2) => (v == null || v === '' ? '' : Number(v).toFixed(casas).replace('.', ','))
const valor = (v) => dec(arred(v || 0))
const data = (d) => { const s = String(d ?? '').slice(0, 10); return s ? `${s.slice(8, 10)}${s.slice(5, 7)}${s.slice(0, 4)}` : '' }

// Data local (Brasília) de um instante ISO
export function diaBrasilia(iso) {
  if (!iso) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10)
}

export const versaoLeiaute = (fim) => String(20 + Number(String(fim).slice(0, 4)) - 2026).padStart(3, '0')

// CFOP da nota do fornecedor (saída dele) convertido para a entrada da loja
export function cfopEntrada(cfop) {
  const c = so(cfop)
  if (c.length !== 4) return ''
  if (['5401', '5402', '5403', '5405'].includes(c)) return '1403'
  if (['6401', '6402', '6403', '6404'].includes(c)) return '2403'
  if (/^510[1-6]$/.test(c)) return '1102'
  if (/^610[1-8]$/.test(c)) return '2102'
  const prim = { 5: '1', 6: '2', 7: '3' }[c[0]]
  return prim ? prim + c.slice(1) : c
}

// CST do ICMS na escrituração (origem + tributação). CSOSN do Simples vira 60 (ST) ou 90 (outras).
export function cstEscrituracao(orig, cst, csosn) {
  const o = String(orig ?? '0').slice(0, 1) || '0'
  if (cst) return o + String(cst).padStart(2, '0').slice(-2)
  if (csosn) return o + (String(csosn) === '500' ? '60' : '90')
  return o + '90'
}

// Lê os valores fiscais do XML autorizado da NFC-e
export function lerNfce(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const um = (el, nome) => el?.getElementsByTagNameNS('*', nome)[0]?.textContent?.trim() ?? null
  const n = (v) => Number(v ?? 0) || 0
  const inf = doc.getElementsByTagNameNS('*', 'infNFe')[0]
  if (!inf) return null
  const tot = inf.getElementsByTagNameNS('*', 'ICMSTot')[0]
  const itens = Array.from(inf.getElementsByTagNameNS('*', 'det')).map((det) => {
    const prod = det.getElementsByTagNameNS('*', 'prod')[0]
    const icms = det.getElementsByTagNameNS('*', 'ICMS')[0]?.children?.[0]
    return {
      cfop: um(prod, 'CFOP'), vProd: n(um(prod, 'vProd')), vDesc: n(um(prod, 'vDesc')),
      orig: um(icms, 'orig'), cst: um(icms, 'CST'), csosn: um(icms, 'CSOSN'),
      vBC: n(um(icms, 'vBC')), pICMS: n(um(icms, 'pICMS')), vICMS: n(um(icms, 'vICMS')), pRedBC: n(um(icms, 'pRedBC')),
    }
  })
  return { emissao: um(inf, 'dhEmi'), vNF: n(um(tot, 'vNF')), vProd: n(um(tot, 'vProd')), vDesc: n(um(tot, 'vDesc')), vBC: n(um(tot, 'vBC')), vICMS: n(um(tot, 'vICMS')), itens }
}

function agrupar(linhas) {
  const g = new Map()
  for (const l of linhas) {
    const k = `${l.cst}|${l.cfop}|${l.aliq}`
    const a = g.get(k) ?? { cst: l.cst, cfop: l.cfop, aliq: l.aliq, opr: 0, bc: 0, icms: 0, bcst: 0, st: 0, red: 0, ipi: 0 }
    a.opr += l.opr; a.bc += l.bc; a.icms += l.icms; a.bcst += l.bcst || 0; a.st += l.st || 0; a.red += l.red || 0; a.ipi += l.ipi || 0
    g.set(k, a)
  }
  return [...g.values()]
}

/**
 * @param dados   resultado da RPC dados_sped
 * @param nfce    documentos NFC-e de produção do período: [{numero, serie, chave, status, emitida_em, xml_autorizado}]
 * @param op      { inicio, fim, finalidade, saldoCredorAnterior, vencimentoIcms, inventario: {data, motivo, conta} | null }
 */
export function gerarSped(dados, nfce, op) {
  const e = dados.empresa
  const end = e.endereco ?? {}
  const ct = e.contador ?? {}
  const avisos = []
  const reg = []
  const L = (...campos) => reg.push(campos)
  const normal = e.regime_tributario === 'normal'
  if (!normal) avisos.push('Empresa do Simples Nacional: na maioria dos estados está dispensada da EFD ICMS/IPI. Confirme com o contador antes de transmitir.')
  if (!so(e.municipio_ibge)) avisos.push('Código do município da empresa não informado (Configurações).')
  if (!so(ct.cpf) || !ct.crc) avisos.push('Dados do contador incompletos (CPF e CRC são obrigatórios no registro 0100).')

  // ---------------- Bloco C: entradas e saídas
  const participantes = new Map()
  const itensUsados = new Set()
  const blocoC = []
  const C = (...campos) => blocoC.push(campos)
  let credito = 0, debito = 0, nEntradas = 0, nSaidas = 0

  for (const nota of dados.notas) {
    const f = nota.fiscal ?? {}
    const forn = nota.fornecedor ?? {}
    const part = `F${so(forn.cnpj)}`
    participantes.set(part, forn)
    if (!so(forn.municipio_ibge)) avisos.push(`Fornecedor ${forn.razao_social} sem código de município (relance o XML da nota ${nota.numero} ou corrija o cadastro).`)
    const semFiscal = !nota.itens.some((i) => i.fiscal && Object.keys(i.fiscal).length)
    if (semFiscal) avisos.push(`NF-e ${nota.numero} foi lançada antes da guarda dos dados fiscais: CST e CFOP estimados, confira.`)
    const dups = nota.duplicatas ?? []
    const indPgto = dups.length === 0 ? '0' : (dups.length === 1 && dups[0].vencimento?.slice(0, 10) === String(nota.emissao).slice(0, 10) ? '0' : '1')
    const frete = { 0: '0', 1: '1', 2: '2', 3: '3', 4: '4', 9: '9' }[f.modFrete] ?? '9'
    C('C100', '0', '1', part, '55', '00', String(nota.serie), String(nota.numero), nota.chave, data(diaBrasilia(nota.emissao)), data(diaBrasilia(nota.entrada)),
      valor(nota.valor_total), indPgto, valor(f.vDesc), valor(0), valor(nota.valor_produtos), frete, valor(f.vFrete), valor(f.vSeg), valor(f.vOutro),
      valor(f.vBC), valor(f.vICMS), valor(f.vBCST), valor(f.vST), valor(f.vIPI), valor(f.vPIS), valor(f.vCOFINS), '', '')
    const linhas190 = []
    nota.itens.forEach((it, k) => {
      const fi = it.fiscal ?? {}
      itensUsados.add(it.cod_item)
      const cst = cstEscrituracao(fi.orig, fi.cst, fi.csosn)
      const cfop = cfopEntrada(fi.cfop) || '1102'
      const vItem = fi.vProd != null ? Number(fi.vProd) : arred(it.quantidade * it.custo_unitario)
      // Crédito só no regime normal e com ICMS destacado
      const bc = normal ? Number(fi.vBC || 0) : 0, icms = normal ? Number(fi.vICMS || 0) : 0, aliq = normal ? Number(fi.pICMS || 0) : 0
      C('C170', String(it.n_item ?? k + 1), it.cod_item, '', dec(it.quantidade, 5), limpa(it.unidade, 6), valor(vItem), valor(fi.vDesc), '0', cst, cfop, '',
        valor(bc), dec(aliq), valor(icms), valor(fi.vBCST), dec(fi.pICMSST || 0), valor(fi.vICMSST), '', '', '', '', '', fi.vIPI ? valor(fi.vIPI) : '',
        '', '', '', '', '', '', '', '', '', '', '', '', '', '')
      linhas190.push({ cst, cfop, aliq: dec(aliq), opr: vItem - Number(fi.vDesc || 0) + Number(fi.vICMSST || 0) + Number(fi.vIPI || 0), bc, icms, bcst: Number(fi.vBCST || 0), st: Number(fi.vICMSST || 0), ipi: Number(fi.vIPI || 0) })
    })
    const grupos = agrupar(linhas190)
    // Frete, seguro e outras despesas entram no valor da operação para fechar com o total da nota
    const dif = arred(Number(nota.valor_total) - grupos.reduce((s, g) => s + arred(g.opr), 0))
    if (grupos.length && dif !== 0) grupos.sort((a, b) => b.opr - a.opr)[0].opr += dif
    for (const g of grupos) {
      C('C190', g.cst, g.cfop, g.aliq, valor(g.opr), valor(g.bc), valor(g.icms), valor(g.bcst), valor(g.st), valor(0), valor(g.ipi), '')
      credito += arred(g.icms)
    }
    nEntradas++
  }

  for (const d of nfce) {
    const serie = String(d.serie), numero = String(d.numero)
    if (d.status === 'cancelada') {
      C('C100', '1', '0', '', '65', '02', serie, numero, d.chave, ...Array(20).fill(''))
      nSaidas++
      continue
    }
    if (d.status !== 'autorizada') continue
    const x = d.xml_autorizado ? lerNfce(d.xml_autorizado) : null
    if (!x) { avisos.push(`NFC-e ${numero} sem XML autorizado guardado; ficou fora do arquivo.`); continue }
    const dia = data(diaBrasilia(x.emissao || d.emitida_em))
    C('C100', '1', '0', '', '65', '00', serie, numero, d.chave, dia, dia, valor(x.vNF), '0', valor(x.vDesc), valor(0), valor(x.vProd), '9',
      valor(0), valor(0), valor(0), valor(x.vBC), valor(x.vICMS), '', '', '', '', '', '', '')
    const grupos = agrupar(x.itens.map((i) => ({
      cst: cstEscrituracao(i.orig, i.cst, i.csosn), cfop: i.cfop, aliq: dec(i.pICMS), opr: i.vProd - i.vDesc, bc: i.vBC, icms: i.vICMS,
      red: i.pRedBC ? (i.vProd - i.vDesc) - i.vBC : 0,
    })))
    for (const g of grupos) {
      C('C190', g.cst, g.cfop, g.aliq, valor(g.opr), valor(g.bc), valor(g.icms), valor(0), valor(0), valor(g.red), valor(0), '')
      debito += arred(g.icms)
    }
    nSaidas++
  }

  // ---------------- Bloco 0
  const inv = op.inventario?.data ? op.inventario : null
  if (inv) for (const i of dados.inventario) itensUsados.add(i.cod_item)
  const produtos = dados.produtos.filter((p) => itensUsados.has(p.cod_item))
  const unidades = [...new Set(produtos.map((p) => limpa(p.unidade, 6) || 'UN'))].sort()
  L('0000', versaoLeiaute(op.fim), op.finalidade || '0', data(op.inicio), data(op.fim), limpa(e.razao_social, 100), so(e.cnpj), '', e.uf, so(e.inscricao_estadual),
    so(e.municipio_ibge), limpa(e.inscricao_municipal), '', e.sped_perfil || 'A', '1')
  L('0001', '0')
  L('0005', limpa(e.nome_fantasia || e.razao_social, 60), so(end.cep), limpa(end.logradouro, 60), limpa(end.numero || 'SN', 10), limpa(end.complemento, 60),
    limpa(end.bairro, 60), so(end.fone).slice(0, 11), '', limpa(e.email, 100))
  L('0100', limpa(ct.nome, 100), so(ct.cpf), limpa(ct.crc, 15), so(ct.cnpj), so(ct.cep), limpa(ct.endereco, 60), limpa(ct.numero, 10), limpa(ct.complemento, 60),
    limpa(ct.bairro, 60), so(ct.fone).slice(0, 11), '', limpa(ct.email, 100), so(ct.municipio_ibge))
  for (const [cod, f] of participantes) {
    const fe = f.endereco ?? {}
    L('0150', cod, limpa(f.razao_social, 100), '01058', so(f.cnpj).length === 14 ? so(f.cnpj) : '', so(f.cnpj).length === 11 ? so(f.cnpj) : '',
      so(f.inscricao_estadual), so(f.municipio_ibge), '', limpa(fe.logradouro, 60), limpa(fe.numero, 10), limpa(fe.complemento, 60), limpa(fe.bairro, 60))
  }
  const NOMES_UN = { UN: 'Unidade', CX: 'Caixa', PCT: 'Pacote', FR: 'Frasco', KG: 'Quilograma', LT: 'Litro', L: 'Litro', M: 'Metro', PC: 'Peça', DZ: 'Dúzia', G: 'Grama', ML: 'Mililitro' }
  for (const u of unidades) L('0190', u, NOMES_UN[u] ?? u)
  for (const p of produtos) {
    const ncm = so(p.ncm)
    if (ncm.length !== 8) avisos.push(`Produto ${p.descricao} sem NCM válido (registro 0200).`)
    L('0200', limpa(p.cod_item, 60), limpa(p.descricao), so(p.ean), '', limpa(p.unidade, 6) || 'UN', '00', ncm, '', ncm.slice(0, 2), '',
      Number(p.aliquota_icms) ? dec(p.aliquota_icms) : '', so(p.cest))
  }
  L('0990', String(reg.length + 1))

  // ---------------- Blocos B, C, D
  L('B001', '1'); L('B990', '2')
  if (blocoC.length) { L('C001', '0'); reg.push(...blocoC); L('C990', String(blocoC.length + 2)) } else { L('C001', '1'); L('C990', '2') }
  L('D001', '1'); L('D990', '2')

  // ---------------- Bloco E: apuração do ICMS próprio
  credito = arred(credito); debito = arred(debito)
  const ant = arred(op.saldoCredorAnterior || 0)
  const saldo = arred(debito - credito - ant)
  const recolher = Math.max(0, saldo)
  const transportar = Math.max(0, -saldo)
  const iniE = reg.length
  L('E001', '0')
  L('E100', data(op.inicio), data(op.fim))
  L('E110', valor(debito), valor(0), valor(0), valor(0), valor(credito), valor(0), valor(0), valor(0), valor(ant), valor(recolher), valor(0), valor(recolher), valor(transportar), valor(0))
  if (recolher > 0) {
    if (!e.cod_receita_icms) avisos.push('Há ICMS a recolher: informe o código de receita do ICMS (dados da escrituração).')
    L('E116', '000', valor(recolher), data(op.vencimentoIcms || op.fim), limpa(e.cod_receita_icms), '', '', '', '', `${op.fim.slice(5, 7)}${op.fim.slice(0, 4)}`)
  }
  L('E990', String(reg.length - iniE + 1))
  L('G001', '1'); L('G990', '2')

  // ---------------- Bloco H: inventário
  if (inv) {
    const iniH = reg.length
    const itens = dados.inventario
    const total = itens.reduce((s, i) => s + arred(Number(i.quantidade) * Number(i.custo)), 0)
    if (!inv.conta) avisos.push('Informe a conta contábil do estoque para o inventário (registro H010).')
    L('H001', '0')
    L('H005', data(inv.data), valor(total), inv.motivo || '01')
    for (const i of itens) {
      const vi = arred(Number(i.quantidade) * Number(i.custo))
      L('H010', limpa(i.cod_item, 60), limpa(i.unidade, 6) || 'UN', dec(i.quantidade, 3), dec(i.custo, 6), valor(vi), '0', '', '', limpa(inv.conta, 255), valor(vi))
    }
    L('H990', String(reg.length - iniH + 1))
  } else { L('H001', '1'); L('H990', '2') }
  L('K001', '1'); L('K990', '2')
  L('1001', '0'); L('1010', ...Array(13).fill('N')); L('1990', '3')

  // ---------------- Bloco 9: contagem
  const contagem = new Map()
  for (const r of reg) contagem.set(r[0], (contagem.get(r[0]) ?? 0) + 1)
  const tipos = [...contagem.keys()]
  const nove = [['9001', '0']]
  const qtd9900 = tipos.length + 4 // + 9001, 9900, 9990, 9999
  for (const t of tipos) nove.push(['9900', t, String(contagem.get(t))])
  nove.push(['9900', '9001', '1'], ['9900', '9900', String(qtd9900)], ['9900', '9990', '1'], ['9900', '9999', '1'])
  nove.push(['9990', String(nove.length + 2)])
  const totalLinhas = reg.length + nove.length + 1
  nove.push(['9999', String(totalLinhas)])
  reg.push(...nove)

  const texto = reg.map((r) => `|${r.join('|')}|`).join('\r\n') + '\r\n'
  return { texto, avisos: [...new Set(avisos)], resumo: { linhas: totalLinhas, entradas: nEntradas, saidas: nSaidas, debito, credito, recolher, transportar } }
}

// O PVA espera o arquivo em ISO-8859-1 (Latin-1)
export function arquivoLatin1(texto) {
  const bytes = new Uint8Array(texto.length)
  for (let i = 0; i < texto.length; i++) { const c = texto.charCodeAt(i); bytes[i] = c < 256 ? c : 63 }
  return new Blob([bytes], { type: 'text/plain;charset=iso-8859-1' })
}
