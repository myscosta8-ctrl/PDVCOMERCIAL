import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, dataHora, lerNumero } from '../lib/formato.js'
import { lerXmlNfe } from '../lib/nfe.js'
import { precoSugerido } from '../lib/carrinho.js'
import { Botao, Cabecalho, Etiqueta, Icone, Indicador, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { BuscaProduto } from '../components/BuscaProduto.jsx'
import { JanelaEtiquetas } from '../components/Etiquetas.jsx'

const dataBR = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('pt-BR') : '')
const arred = (v, c = 2) => Math.round(v * 10 ** c) / 10 ** c
const formatarCnpj = (c) => String(c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

export default function Entradas() {
  const perfil = useSessao()
  const avisar = useAviso()
  const gestor = perfil.papel !== 'operador'
  const arquivo = useRef(null)
  const [lista, setLista] = useState(null)
  const [importacao, setImportacao] = useState(null)
  const [detalhe, setDetalhe] = useState(null)

  const carregar = async () => {
    const { data, error } = await supabase.from('notas_entrada')
      .select('*, fornecedor:fornecedores(razao_social, nome_fantasia, cnpj), itens:notas_entrada_itens(count)')
      .order('criado_em', { ascending: false }).limit(300)
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lerArquivo = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const nota = lerXmlNfe(await f.text())
      setImportacao(await prepararImportacao(nota))
    } catch (err) {
      avisar(err.message || 'Não foi possível ler o arquivo.', 'erro')
    }
  }

  const abrirDetalhe = async (n) => {
    const { data } = await supabase.from('notas_entrada_itens').select('*, produto:produtos(descricao, unidade), lote:lotes(numero, validade)').eq('nota_id', n.id)
    setDetalhe({ ...n, linhas: data ?? [] })
  }

  const gerarContas = async () => {
    const { data, error } = await supabase.rpc('gerar_pagar_nota', { p_nota: detalhe.id })
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`${data} conta(s) a pagar gerada(s) no Financeiro.`)
  }

  const mes = new Date().toISOString().slice(0, 7)
  const doMes = (lista ?? []).filter((n) => n.criado_em.slice(0, 7) === mes)

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Entrada de mercadorias" descricao="Lançamento das notas de compra pelo arquivo XML da NF-e">
        {gestor && <>
          <input ref={arquivo} type="file" accept=".xml,text/xml" className="hidden" onChange={lerArquivo} />
          <Botao icone="nota" onClick={() => arquivo.current?.click()}>Importar XML da nota</Botao>
        </>}
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Notas no mês" icone="nota" valor={doMes.length} detalhe={`${(lista ?? []).length} no total`} />
        <Indicador titulo="Compras no mês" icone="dinheiro" valor={dinheiro(doMes.reduce((s, n) => s + Number(n.valor_total), 0))} detalhe="Valor total das notas" />
        <Indicador titulo="Fornecedores no mês" icone="usuario" valor={new Set(doMes.map((n) => n.fornecedor_id)).size} detalhe="Com nota lançada" />
        <Indicador titulo="Duplicatas a vencer" icone="relogio" valor={dinheiro(doMes.flatMap((n) => n.duplicatas ?? []).filter((d) => d.vencimento >= new Date().toISOString().slice(0, 10)).reduce((s, d) => s + Number(d.valor), 0))} detalhe="Das notas lançadas no mês" />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : lista.length === 0 ? (
          <Vazio icone="nota" titulo="Nenhuma nota lançada" texto="Importe o arquivo XML que o fornecedor envia por e-mail. O sistema lê os produtos, quantidades, custos, lotes e validades.">
            {gestor && <Botao icone="nota" onClick={() => arquivo.current?.click()}>Importar o primeiro XML</Botao>}
          </Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Nota</th><th>Fornecedor</th><th>Emissão</th><th>Lançada em</th><th className="text-right">Itens</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {lista.map((n) => (
                  <tr key={n.id} onClick={() => abrirDetalhe(n)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                    <td className="font-semibold">Nº {n.numero}<span className="block text-xs font-normal text-tinta-400">Série {n.serie}</span></td>
                    <td>{n.fornecedor?.nome_fantasia || n.fornecedor?.razao_social}<span className="block text-xs text-tinta-400">CNPJ {formatarCnpj(n.fornecedor?.cnpj)}</span></td>
                    <td>{dataBR(n.emissao)}</td>
                    <td>{dataHora(n.criado_em)}</td>
                    <td className="num text-right">{n.itens?.[0]?.count ?? '—'}</td>
                    <td className="num text-right font-semibold">{dinheiro(n.valor_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importacao && <Importacao dados={importacao} onFechar={() => setImportacao(null)} onConcluir={() => { setImportacao(null); carregar() }} />}

      <TelaSuspensa aberta={!!detalhe} titulo={detalhe ? `NF-e nº ${detalhe.numero}` : ''} subtitulo={detalhe ? `${detalhe.fornecedor?.razao_social}, emitida em ${dataBR(detalhe.emissao)}` : ''}
        onFechar={() => setDetalhe(null)} largura="max-w-3xl" rodape={<>
          {gestor && <Botao variante="secundario" className="mr-auto" onClick={gerarContas}>Gerar contas a pagar</Botao>}
          <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>
        </>}>
        {detalhe && (
          <div className="space-y-4">
            <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
              <thead><tr><th>Produto</th><th>Lote</th><th className="text-right">Quantidade</th><th className="text-right">Custo unitário</th></tr></thead>
              <tbody>
                {detalhe.linhas.map((l) => (
                  <tr key={l.id}>
                    <td>{l.produto?.descricao}<span className="block text-xs text-tinta-400">Na nota: {l.descricao}</span></td>
                    <td>{l.lote ? <>{l.lote.numero}<span className="block text-xs text-tinta-400">validade {dataBR(l.lote.validade)}</span></> : '—'}</td>
                    <td className="num text-right">{Number(l.quantidade)} {l.produto?.unidade}</td>
                    <td className="num text-right">{dinheiro(l.custo_unitario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detalhe.duplicatas?.length > 0 && (
              <div>
                <p className="mb-1 font-semibold">Duplicatas</p>
                {detalhe.duplicatas.map((d, i) => <p key={i} className="flex justify-between text-sm"><span>{d.numero}, vencimento {dataBR(d.vencimento)}</span><span className="num">{dinheiro(d.valor)}</span></p>)}
              </div>
            )}
            <p className="break-all text-xs text-tinta-400">Chave de acesso {detalhe.chave}</p>
          </div>
        )}
      </TelaSuspensa>
    </div>
  )
}

// Monta as linhas da conferência: vínculo já conhecido, código de barras ou produto novo
async function prepararImportacao(nota) {
  const [{ data: emp }, { data: forn }] = await Promise.all([
    supabase.from('empresas').select('cnpj, markup_padrao').single(),
    supabase.from('fornecedores').select('id').eq('cnpj', nota.fornecedor.cnpj).maybeSingle(),
  ])
  const vinculos = forn ? (await supabase.from('produto_fornecedor').select('codigo_fornecedor, fator, produto:produtos(id, descricao, unidade, preco_venda, preco_custo, markup, e_kit, ean)').eq('fornecedor_id', forn.id)).data ?? [] : []
  const eans = nota.itens.map((i) => i.ean).filter(Boolean)
  const porEan = eans.length ? (await supabase.from('produtos').select('id, descricao, unidade, preco_venda, preco_custo, markup, e_kit, ean').in('ean', eans)).data ?? [] : []
  const markupPadrao = Number(emp?.markup_padrao ?? 30)

  const linhas = nota.itens.flatMap((it) => {
    const v = vinculos.find((x) => x.codigo_fornecedor === it.codigo && x.produto && !x.produto.e_kit)
    const e = porEan.find((p) => p.ean === it.ean && !p.e_kit)
    const produto = v?.produto ?? e ?? null
    const fator = Number(v?.fator ?? 1)
    const base = {
      xml: it, produto, fator: String(fator).replace('.', ','),
      origem: v ? 'vinculo' : e ? 'ean' : 'novo',
      novo: { descricao: it.descricao, unidade: it.unidade || 'UN' },
    }
    const partes = it.rastros.length > 1 ? it.rastros : [it.rastros[0] ?? null]
    return partes.map((r, k) => ({
      ...base,
      chave: `${it.item}-${k}`,
      qtdXml: r && it.rastros.length > 1 ? r.quantidade : it.quantidade,
      lote: r?.lote ?? '', validade: r?.validade ?? '', fabricacao: r?.fabricacao ?? '',
      atualizarPreco: null, precoNovo: '',
    }))
  })
  return { nota, linhas, markupPadrao, avisos: [
    nota.destinatario_cnpj && emp?.cnpj && nota.destinatario_cnpj !== String(emp.cnpj).replace(/\D/g, '') && 'O destinatário desta nota não é o CNPJ da empresa cadastrada.',
    !nota.autorizada && 'O arquivo não contém o protocolo de autorização da SEFAZ. Confira se é a nota definitiva.',
  ].filter(Boolean) }
}

function Importacao({ dados, onFechar, onConcluir }) {
  const avisar = useAviso()
  const { nota, markupPadrao, avisos } = dados
  const [linhas, setLinhas] = useState(dados.linhas)
  const [buscando, setBuscando] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [etiquetas, setEtiquetas] = useState(null)

  const calc = (l) => {
    const fator = lerNumero(l.fator) || 1
    const qtd = arred(l.qtdXml * fator, 3)
    const custo = l.xml.custo_unitario / fator
    const markup = l.produto?.markup ?? markupPadrao
    const sugerido = precoSugerido(custo, markup)
    const atual = l.produto ? Number(l.produto.preco_venda) : null
    // custo muito acima do anterior costuma ser fator de conversão errado (ex.: caixa lançada como unidade)
    const suspeito = Boolean(l.produto && Number(l.produto.preco_custo) > 0 && custo > Number(l.produto.preco_custo) * 1.5)
    const atualizar = l.atualizarPreco ?? (!l.produto || (!suspeito && sugerido != null && atual != null && sugerido > atual))
    const novoPreco = l.precoNovo !== '' ? lerNumero(l.precoNovo) : sugerido
    return { fator, qtd, custo, sugerido, atual, atualizar, novoPreco, suspeito }
  }
  const mudar = (chave, campos) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...campos } : l)))
  const resumo = useMemo(() => ({
    novos: linhas.filter((l) => !l.produto).length,
    precos: linhas.filter((l) => l.produto && calc(l).atualizar).length,
  }), [linhas]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmar = async () => {
    for (const l of linhas) {
      const c = calc(l)
      if (!(c.qtd > 0)) { avisar(`Quantidade inválida em ${l.xml.descricao}.`, 'erro'); return }
      if (c.atualizar && !(c.novoPreco > 0)) { avisar(`Informe o preço de venda de ${l.xml.descricao}.`, 'erro'); return }
    }
    const itens = linhas.map((l) => {
      const c = calc(l)
      const item = {
        codigo_fornecedor: l.xml.codigo, descricao: l.xml.descricao, fator: c.fator, quantidade: c.qtd, custo_unitario: arred(c.custo, 4),
        n_item: l.xml.item, fiscal: l.xml.fiscal,
        lote: l.lote || null, validade: l.validade || null, fabricacao: l.fabricacao || null,
      }
      if (l.produto) {
        item.produto_id = l.produto.id
        if (c.atualizar) item.novo_preco_venda = arred(c.novoPreco)
      } else {
        item.novo_produto = { descricao: l.novo.descricao, ean: l.xml.ean, ncm: l.xml.ncm, cest: l.xml.cest, unidade: l.novo.unidade, preco_venda: arred(c.novoPreco) }
      }
      return item
    })
    setEnviando(true)
    const { data, error } = await supabase.rpc('registrar_entrada_nfe', { p_nota: {
      chave: nota.chave, numero: nota.numero, serie: nota.serie, emissao: nota.emissao,
      valor_produtos: nota.valor_produtos, valor_total: nota.valor_total, duplicatas: nota.duplicatas, fornecedor: nota.fornecedor, fiscal: nota.fiscal, itens,
    } })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`Nota nº ${nota.numero} lançada: ${data.itens} item(ns), ${data.produtos_novos} produto(s) novo(s).`)
    // Contas a pagar a partir das duplicatas (ou uma conta em 30 dias se a nota não trouxer)
    const pg = await supabase.rpc('gerar_pagar_nota', { p_nota: data.nota_id })
    if (pg.error) avisar(`Contas a pagar não geradas: ${mensagemErro(pg.error)}`, 'erro')
    else avisar(`${pg.data} conta(s) a pagar gerada(s) no Financeiro.`)
    // Etiquetas dos produtos com preço novo
    const filtros = linhas.filter((l) => !l.produto || calc(l).atualizar)
      .map((l) => (l.produto ? `id.eq.${l.produto.id}` : l.xml.ean ? `ean.eq.${l.xml.ean}` : null)).filter(Boolean)
    if (filtros.length) {
      const { data: prods } = await supabase.from('produtos').select('id, descricao, preco_venda, ean, codigo, unidade').or(filtros.join(','))
      if (prods?.length) { setEtiquetas(prods); return }
    }
    onConcluir()
  }

  // Depois de lançar: oferece as etiquetas dos produtos com preço novo
  if (etiquetas) return <JanelaEtiquetas produtos={etiquetas} onFechar={onConcluir} />

  return (
    <TelaSuspensa aberta titulo={`Conferência da NF-e nº ${nota.numero}`} subtitulo={`${nota.fornecedor.razao_social}, CNPJ ${formatarCnpj(nota.fornecedor.cnpj)}, emitida em ${dataBR(nota.emissao)}, total ${dinheiro(nota.valor_total)}`}
      onFechar={onFechar} largura="max-w-7xl"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Cancelar</Botao>
        <Botao onClick={confirmar} carregando={enviando}>Lançar nota no estoque</Botao>
      </>}>
      <div className="space-y-4">
        {avisos.map((a, i) => <p key={i} className="flex items-center gap-2 rounded-lg bg-ambar-50 px-3 py-2 text-sm text-ambar-600 dark:bg-ambar-600/10 dark:text-ambar-300"><Icone nome="alerta" className="h-4 w-4" />{a}</p>)}
        <div className="flex flex-wrap gap-2 text-sm">
          <Etiqueta>{linhas.length} linha(s)</Etiqueta>
          {resumo.novos > 0 && <Etiqueta tom="alerta">{resumo.novos} produto(s) serão cadastrados</Etiqueta>}
          {resumo.precos > 0 && <Etiqueta tom="positivo">{resumo.precos} preço(s) de venda serão atualizados</Etiqueta>}
          {nota.duplicatas.length > 0 && <Etiqueta>{nota.duplicatas.length} duplicata(s)</Etiqueta>}
        </div>
        <div className="overflow-x-auto rounded-xl border border-papel-200 dark:border-noite-700">
          <table className="tabela w-full min-w-[1100px] text-[0.9rem]">
            <thead className="bg-papel/70 dark:bg-noite/40">
              <tr><th>Item da nota</th><th>Produto da loja</th><th className="text-right">Fator</th><th className="text-right">Entra no estoque</th><th className="text-right">Custo unitário</th><th>Lote e validade</th><th>Preço de venda</th></tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const c = calc(l)
                return (
                  <tr key={l.chave} className="align-top">
                    <td className="max-w-[230px]">
                      <span className="block font-medium">{l.xml.descricao}</span>
                      <span className="text-xs text-tinta-400">Cód. {l.xml.codigo}{l.xml.ean ? `, EAN ${l.xml.ean}` : ''}, {String(l.qtdXml).replace('.', ',')} {l.xml.unidade}</span>
                    </td>
                    <td className="max-w-[260px]">
                      {l.produto ? (
                        <>
                          <span className="block">{l.produto.descricao}</span>
                          <Etiqueta tom={l.origem === 'vinculo' ? 'positivo' : 'neutro'}>{l.origem === 'vinculo' ? 'Vínculo salvo' : l.origem === 'ean' ? 'Mesmo código de barras' : 'Escolhido'}</Etiqueta>
                        </>
                      ) : (
                        <>
                          <input className="campo py-1" value={l.novo.descricao} onChange={(e) => mudar(l.chave, { novo: { ...l.novo, descricao: e.target.value } })} aria-label="Descrição do produto novo" />
                          <Etiqueta tom="alerta">Produto novo</Etiqueta>
                        </>
                      )}
                      <div className="mt-1 flex gap-3 text-xs">
                        <button className="font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => setBuscando(l.chave)}>Vincular a outro</button>
                        {l.produto && <button className="font-semibold text-tinta-600 hover:underline dark:text-tinta-300" onClick={() => mudar(l.chave, { produto: null, origem: 'novo' })}>Cadastrar como novo</button>}
                      </div>
                    </td>
                    <td className="text-right">{c.suspeito && <span className="mb-1 block text-xs font-semibold text-rubro-600 dark:text-rubro-300">Confira o fator</span>}<input className="campo num ml-auto w-16 py-1 text-right" inputMode="decimal" value={l.fator} onChange={(e) => mudar(l.chave, { fator: e.target.value })} title="Unidades da loja em cada unidade da nota (ex.: caixa com 12 = 12)" aria-label="Fator de conversão" /></td>
                    <td className="num text-right font-semibold">{String(c.qtd).replace('.', ',')} {l.produto?.unidade ?? l.novo.unidade}</td>
                    <td className="num text-right">{dinheiro(c.custo)}{l.produto && Number(l.produto.preco_custo) > 0 && Math.abs(c.custo - Number(l.produto.preco_custo)) > 0.009 && (
                      <span className={`block text-xs ${c.custo > Number(l.produto.preco_custo) ? 'text-rubro-600' : 'text-caixa-600'}`}>antes {dinheiro(l.produto.preco_custo)}</span>
                    )}</td>
                    <td>
                      <input className="campo py-1" placeholder="Lote" value={l.lote} onChange={(e) => mudar(l.chave, { lote: e.target.value })} aria-label="Lote" />
                      <input type="date" className="campo mt-1 py-1" value={l.validade ?? ''} onChange={(e) => mudar(l.chave, { validade: e.target.value })} aria-label="Validade" />
                    </td>
                    <td className="min-w-[180px]">
                      {l.produto && <p className="text-xs text-tinta-400">Atual {dinheiro(c.atual)}, sugerido {c.sugerido ? dinheiro(c.sugerido) : '—'}</p>}
                      <label className="mt-1 flex items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={c.atualizar} disabled={!l.produto} onChange={(e) => mudar(l.chave, { atualizarPreco: e.target.checked })} />
                        {l.produto ? 'Atualizar para' : 'Preço de venda'}
                      </label>
                      <input className="campo num mt-1 py-1" inputMode="decimal" disabled={!c.atualizar} value={l.precoNovo !== '' ? l.precoNovo : c.sugerido != null ? c.sugerido.toFixed(2).replace('.', ',') : ''} onChange={(e) => mudar(l.chave, { precoNovo: e.target.value })} aria-label="Novo preço de venda" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-tinta-400">O custo inclui desconto, frete, seguro, IPI e ICMS-ST da nota. O preço sugerido usa o markup do produto ou o markup padrão da empresa ({String(markupPadrao).replace('.', ',')}%). Os vínculos e fatores ficam salvos para as próximas notas deste fornecedor.</p>
      </div>
      {buscando && (
        <BuscaProduto titulo="Vincular a um produto da loja" semKits termoInicial={linhas.find((l) => l.chave === buscando)?.xml.descricao.split(' ')[0] ?? ''}
          onFechar={() => setBuscando(null)}
          onEscolher={(p) => { mudar(buscando, { produto: p, origem: 'escolhido', atualizarPreco: null, precoNovo: '' }); setBuscando(null) }} />
      )}
    </TelaSuspensa>
  )
}
