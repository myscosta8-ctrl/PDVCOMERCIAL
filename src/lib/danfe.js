import JsBarcode from 'jsbarcode'
import { imprimirHtml, esc } from './impressao.js'

// Lê o XML autorizado da NF-e (nfeProc) e devolve os dados que vão no DANFE
export function lerNfe55(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const um = (el, nome) => el?.getElementsByTagNameNS('*', nome)[0]?.textContent?.trim() ?? ''
  const el = (nome, pai = doc) => pai.getElementsByTagNameNS('*', nome)[0]
  const n = (v) => Number(v || 0)
  const inf = el('infNFe')
  if (!inf) return null
  const ide = el('ide', inf), emit = el('emit', inf), dest = el('dest', inf), tot = el('ICMSTot', inf), transp = el('transp', inf), prot = el('protNFe')
  const end = (e) => ({ lgr: um(e, 'xLgr'), nro: um(e, 'nro'), cpl: um(e, 'xCpl'), bairro: um(e, 'xBairro'), mun: um(e, 'xMun'), uf: um(e, 'UF'), cep: um(e, 'CEP'), fone: um(e, 'fone') })
  return {
    chave: (inf.getAttribute('Id') || '').replace(/^NFe/, ''),
    numero: um(ide, 'nNF'), serie: um(ide, 'serie'), emissao: um(ide, 'dhEmi'), saida: um(ide, 'dhSaiEnt'), natureza: um(ide, 'natOp'),
    tpNF: um(ide, 'tpNF'), ambiente: um(ide, 'tpAmb'), finalidade: um(ide, 'finNFe'),
    emit: { nome: um(emit, 'xNome'), fantasia: um(emit, 'xFant'), cnpj: um(emit, 'CNPJ'), ie: um(emit, 'IE'), end: end(el('enderEmit', emit)) },
    dest: dest ? { nome: um(dest, 'xNome'), doc: um(dest, 'CNPJ') || um(dest, 'CPF'), ie: um(dest, 'IE'), end: end(el('enderDest', dest)) } : null,
    itens: Array.from(inf.getElementsByTagNameNS('*', 'det')).map((det) => {
      const p = el('prod', det), icms = el('ICMS', det)?.children?.[0]
      return {
        codigo: um(p, 'cProd'), descricao: um(p, 'xProd'), ncm: um(p, 'NCM'), cfop: um(p, 'CFOP'), un: um(p, 'uCom'),
        qtd: n(um(p, 'qCom')), unit: n(um(p, 'vUnCom')), total: n(um(p, 'vProd')), desc: n(um(p, 'vDesc')),
        cst: (um(icms, 'orig') || '0') + (um(icms, 'CST') || um(icms, 'CSOSN')), bc: n(um(icms, 'vBC')), icms: n(um(icms, 'vICMS')), aliq: n(um(icms, 'pICMS')),
      }
    }),
    tot: { vBC: n(um(tot, 'vBC')), vICMS: n(um(tot, 'vICMS')), vProd: n(um(tot, 'vProd')), vFrete: n(um(tot, 'vFrete')), vSeg: n(um(tot, 'vSeg')),
      vDesc: n(um(tot, 'vDesc')), vOutro: n(um(tot, 'vOutro')), vIPI: n(um(tot, 'vIPI')), vNF: n(um(tot, 'vNF')), vPIS: n(um(tot, 'vPIS')), vCOFINS: n(um(tot, 'vCOFINS')) },
    frete: um(transp, 'modFrete'),
    vol: { q: um(transp, 'qVol'), esp: um(transp, 'esp'), pb: um(transp, 'pesoB'), pl: um(transp, 'pesoL') },
    pagamentos: Array.from(inf.getElementsByTagNameNS('*', 'detPag')).map((p) => ({ tPag: um(p, 'tPag'), valor: n(um(p, 'vPag')) })),
    info: um(el('infAdic', inf), 'infCpl'),
    protocolo: um(prot, 'nProt'), dhRecbto: um(prot, 'dhRecbto'),
  }
}

const v2 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const v4 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
const horaBR = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
const docFmt = (d) => (d?.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d?.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d ?? '')
const chaveFmt = (c) => String(c || '').replace(/(\d{4})/g, '$1 ').trim()
const FRETE = { 0: '0 - Por conta do emitente', 1: '1 - Por conta do destinatário', 2: '2 - Por conta de terceiros', 9: '9 - Sem frete' }

function codigoBarras(chave) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  try { JsBarcode(svg, chave, { format: 'CODE128C', height: 38, width: 1, margin: 0, displayValue: false }) } catch { return '' }
  return svg.outerHTML
}

// DANFE em folha A4 retrato. extra: { cancelada, cces }
export function htmlDanfe(d, extra = {}) {
  const c = (rot, val, cls = '') => `<div class="c ${cls}"><span>${esc(rot)}</span><b>${val}</b></div>`
  const linhas = d.itens.map((i) => `<tr><td>${esc(i.codigo)}</td><td class="l">${esc(i.descricao)}</td><td>${esc(i.ncm)}</td><td>${esc(i.cst)}</td><td>${esc(i.cfop)}</td><td>${esc(i.un)}</td>
    <td class="r">${v4(i.qtd)}</td><td class="r">${v4(i.unit)}</td><td class="r">${v2(i.total)}</td><td class="r">${v2(i.desc)}</td><td class="r">${v2(i.bc)}</td><td class="r">${v2(i.icms)}</td><td class="r">${i.aliq ? v2(i.aliq) : ''}</td></tr>`).join('')
  const homolog = d.ambiente === '2'
  const de = d.dest?.end ?? {}
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE ${esc(d.numero)}</title><style>
  @page { size: A4; margin: 7mm }
  * { box-sizing: border-box } body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #000; margin: 0 }
  .bx { border: 0.6pt solid #000; } .row { display: flex } .row > * { flex: 1 } .c { border: 0.6pt solid #000; padding: 1mm 1.3mm; min-height: 9mm; margin: -0.3pt 0 0 -0.3pt }
  .c span { display: block; font-size: 5.5pt; text-transform: uppercase } .c b { font-size: 8.5pt; font-weight: bold; word-break: break-word }
  h3 { font-size: 7pt; margin: 2.5mm 0 0.6mm; text-transform: uppercase }
  table { width: 100%; border-collapse: collapse; } th, td { border: 0.6pt solid #000; padding: 0.6mm 0.8mm; font-size: 6.8pt; text-align: center; vertical-align: top }
  th { font-size: 5.5pt; } td.l { text-align: left } td.r { text-align: right }
  .canhoto { display: flex; border: 0.6pt solid #000; margin-bottom: 1.5mm } .canhoto > div { padding: 1mm; border-left: 0.6pt solid #000 } .canhoto > div:first-child { border: 0; flex: 3 }
  .marca { position: fixed; top: 45%; left: 0; right: 0; text-align: center; font-size: 40pt; font-weight: bold; color: rgba(180,0,0,.18); transform: rotate(-20deg) }
  .tit { text-align: center } .tit .grande { font-size: 15pt; font-weight: bold } .cb svg { width: 100%; height: 12mm }
  </style></head><body>
  ${extra.cancelada ? '<div class="marca">NF-e CANCELADA</div>' : homolog ? '<div class="marca">SEM VALOR FISCAL</div>' : ''}
  <div class="canhoto"><div>RECEBEMOS DE ${esc(d.emit.nome)} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO<br><br>DATA DE RECEBIMENTO ________________ IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR ______________________________</div>
    <div class="tit"><b>NF-e</b><br>Nº ${esc(d.numero)}<br>Série ${esc(d.serie)}</div></div>
  <div class="row">
    <div class="c" style="flex:2.2"><b style="font-size:10pt">${esc(d.emit.nome)}</b><br>${esc(d.emit.end.lgr)}, ${esc(d.emit.end.nro)} - ${esc(d.emit.end.bairro)}<br>${esc(d.emit.end.mun)}/${esc(d.emit.end.uf)} - CEP ${esc(d.emit.end.cep)}${d.emit.end.fone ? `<br>Fone ${esc(d.emit.end.fone)}` : ''}</div>
    <div class="c tit" style="flex:1"><div class="grande">DANFE</div>Documento Auxiliar da Nota Fiscal Eletrônica<br><b>${d.tpNF === '0' ? '0 - Entrada' : '1 - Saída'}</b><br>Nº ${esc(d.numero)} · Série ${esc(d.serie)}<br>Folha 1/1</div>
    <div class="c" style="flex:2.2"><div class="cb">${codigoBarras(d.chave)}</div><span>Chave de acesso</span><b>${chaveFmt(d.chave)}</b><br><span>Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da SEFAZ autorizadora</span></div>
  </div>
  <div class="row">${c('Natureza da operação', esc(d.natureza))}${c('Protocolo de autorização de uso', d.protocolo ? `${esc(d.protocolo)} - ${dataBR(d.dhRecbto)} ${horaBR(d.dhRecbto)}` : '')}</div>
  <div class="row">${c('Inscrição estadual', esc(d.emit.ie))}${c('CNPJ', docFmt(d.emit.cnpj))}</div>
  <h3>Destinatário / remetente</h3>
  <div class="row">${c('Nome / razão social', esc(d.dest?.nome))}${c('CNPJ / CPF', docFmt(d.dest?.doc))}${c('Data da emissão', dataBR(d.emissao))}</div>
  <div class="row">${c('Endereço', `${esc(de.lgr)}, ${esc(de.nro)}${de.cpl ? ` ${esc(de.cpl)}` : ''}`)}${c('Bairro', esc(de.bairro))}${c('CEP', esc(de.cep))}${c('Data da saída', dataBR(d.saida))}</div>
  <div class="row">${c('Município', esc(de.mun))}${c('UF', esc(de.uf))}${c('Fone', esc(de.fone))}${c('Inscrição estadual', esc(d.dest?.ie))}${c('Hora da saída', horaBR(d.saida))}</div>
  ${d.pagamentos.length ? `<h3>Pagamento</h3><div class="row">${d.pagamentos.map((p) => c({ '01': 'Dinheiro', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja', '15': 'Boleto', '17': 'PIX', '18': 'Transferência', '90': 'Sem pagamento' }[p.tPag] ?? 'Outros', `R$ ${v2(p.valor)}`)).join('')}</div>` : ''}
  <h3>Cálculo do imposto</h3>
  <div class="row">${c('Base de cálculo do ICMS', v2(d.tot.vBC))}${c('Valor do ICMS', v2(d.tot.vICMS))}${c('Valor total dos produtos', v2(d.tot.vProd))}${c('Valor do PIS', v2(d.tot.vPIS))}${c('Valor da COFINS', v2(d.tot.vCOFINS))}</div>
  <div class="row">${c('Valor do frete', v2(d.tot.vFrete))}${c('Valor do seguro', v2(d.tot.vSeg))}${c('Desconto', v2(d.tot.vDesc))}${c('Outras despesas', v2(d.tot.vOutro))}${c('Valor do IPI', v2(d.tot.vIPI))}${c('Valor total da nota', v2(d.tot.vNF))}</div>
  <h3>Transportador / volumes transportados</h3>
  <div class="row">${c('Modalidade do frete', FRETE[d.frete] ?? esc(d.frete))}${c('Quantidade', esc(d.vol.q))}${c('Espécie', esc(d.vol.esp))}${c('Peso bruto', esc(d.vol.pb))}${c('Peso líquido', esc(d.vol.pl))}</div>
  <h3>Dados dos produtos / serviços</h3>
  <table><thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>CST</th><th>CFOP</th><th>Un.</th><th>Qtd.</th><th>Valor unit.</th><th>Valor total</th><th>Desconto</th><th>BC ICMS</th><th>Valor ICMS</th><th>Alíq. ICMS</th></tr></thead><tbody>${linhas}</tbody></table>
  <h3>Dados adicionais</h3>
  <div class="row"><div class="c" style="min-height:22mm;flex:2"><span>Informações complementares</span>${esc(d.info)}${(extra.cces ?? []).map((x) => `<br><b>Carta de correção ${x.sequencia}:</b> ${esc(x.correcao)} (protocolo ${esc(x.protocolo)})`).join('')}</div><div class="c" style="min-height:22mm"><span>Reservado ao fisco</span></div></div>
  </body></html>`
}

export function imprimirDanfeNfe(xml, extra) {
  const d = lerNfe55(xml)
  if (!d) return { erro: 'XML da NF-e inválido.' }
  return imprimirHtml(htmlDanfe(d, extra))
}
