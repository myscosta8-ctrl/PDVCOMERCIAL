import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { useCaixaAberto } from '../lib/caixa.js'
import { adicionar, alterarQuantidade, remover, totais, totalItem, paraEnvio, lerCodigo, trocarLote } from '../lib/carrinho.js'
import { dinheiro, lerNumero, arred } from '../lib/formato.js'
import { Botao, Campo, Confirmacao, Etiqueta, Icone, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'
import { chamarNfce, imprimirDanfe } from '../lib/nfce.js'
import { SeletorCliente, SituacaoCliente, carregarSituacao } from '../components/Clientes.jsx'
import { Lista } from '../components/ui.jsx'

const FORMAS = [
  { forma: 'dinheiro', texto: 'Dinheiro', tecla: '1' },
  { forma: 'pix', texto: 'PIX', tecla: '2' },
  { forma: 'debito', texto: 'Cartão de débito', tecla: '3' },
  { forma: 'credito', texto: 'Cartão de crédito', tecla: '4' },
  { forma: 'crediario', texto: 'Crediário', tecla: '5', cliente: true },
  { forma: 'convenio', texto: 'Convênio', tecla: '6', cliente: true },
  { forma: 'vale', texto: 'Vale-troca', tecla: '7', cliente: true },
]
const PARCELAS = Array.from({ length: 12 }, (_, i) => ({ valor: i + 1, texto: i === 0 ? '1 parcela' : `${i + 1} parcelas` }))
const TIPOS_PRE = [{ valor: 'orcamento', texto: 'Orçamento' }, { valor: 'pedido', texto: 'Pedido de venda' }]
const nomeForma = (f) => FORMAS.find((x) => x.forma === f)?.texto ?? f
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dataBR = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '')
const venceEmBreve = (d) => d && d <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)

async function lotesDisponiveis(produtoId) {
  const { data } = await supabase.from('lotes').select('id, numero, validade, quantidade').eq('produto_id', produtoId).gt('quantidade', 0).order('validade', { nullsFirst: false })
  return data ?? []
}

function Tecla({ children }) {
  return <kbd className="num rounded border border-papel-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-tinta-600 dark:border-noite-600 dark:bg-noite-700 dark:text-tinta-300">{children}</kbd>
}

export default function PDV() {
  const perfil = useSessao()
  const { caixa } = useCaixaAberto()
  const avisar = useAviso()
  const busca = useRef(null)
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState([])
  const [itens, setItens] = useState([])
  const [destaque, setDestaque] = useState(null)
  const [pagamentoAberto, setPagamentoAberto] = useState(false)
  const [limparAberto, setLimparAberto] = useState(false)
  const [ultima, setUltima] = useState(null)
  const [cliente, setCliente] = useState(null)
  const [escolherCliente, setEscolherCliente] = useState(false)
  const [salvarPre, setSalvarPre] = useState(false)
  const [preVenda, setPreVenda] = useState(null)
  const [escolhaLote, setEscolhaLote] = useState(null)
  const t = useMemo(() => totais(itens), [itens])

  // Orçamento ou pedido aberto a partir da tela Orçamentos
  useEffect(() => {
    let id
    try { id = sessionStorage.getItem('carregar_pre_venda'); sessionStorage.removeItem('carregar_pre_venda') } catch {}
    if (!id) return
    ;(async () => {
      const { data: pv } = await supabase.from('pre_vendas').select('*').eq('id', id).maybeSingle()
      if (!pv || pv.status !== 'aberto') { avisar('Orçamento não está mais disponível.', 'erro'); return }
      const ids = pv.itens.map((i) => i.produto_id)
      const { data: prods } = await supabase.from('produtos').select('id, descricao, unidade, preco_venda, estoque_atual, ean, codigo, controlado, ativo, e_kit, controla_lote').in('id', ids)
      let novos = []
      const fora = []
      for (const i of pv.itens) {
        const p = prods?.find((x) => x.id === i.produto_id)
        if (!p || !p.ativo) { fora.push(i.descricao); continue }
        novos = adicionar(novos, p, Number(i.quantidade))
      }
      setItens(novos)
      setPreVenda(pv)
      if (pv.cliente_id) {
        const { data: c } = await supabase.from('clientes').select('id, nome, cpf_cnpj, telefone').eq('id', pv.cliente_id).maybeSingle()
        if (c) setCliente({ ...c, situacao: await carregarSituacao(c.id) })
      }
      avisar(`${pv.tipo === 'pedido' ? 'Pedido' : 'Orçamento'} nº ${pv.numero} carregado com os preços atuais.${fora.length ? ` Itens indisponíveis: ${fora.join(', ')}.` : ''}`, fora.length ? 'erro' : 'sucesso')
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const qtdItens = itens.reduce((s, i) => s + i.quantidade, 0)

  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'F2') { e.preventDefault(); busca.current?.focus() }
      if (e.key === 'F4' && itens.length) { e.preventDefault(); setPagamentoAberto(true) }
      if (e.key === 'F8' && itens.length) { e.preventDefault(); setLimparAberto(true) }
      if (e.key === 'F3') { e.preventDefault(); setEscolherCliente(true) }
      if (e.key === 'F6' && itens.length) { e.preventDefault(); setSalvarPre(true) }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [itens.length])

  if (caixa === undefined) return <p className="text-sm text-tinta-400">Carregando…</p>
  if (!caixa) {
    return (
      <div className="cartao mx-auto max-w-lg">
        <Vazio icone="caixa" titulo="O caixa está fechado" texto="Para registrar vendas, abra o caixa deste terminal na tela Caixa, informando o fundo de troco." />
      </div>
    )
  }

  const incluir = async (p, qtd) => {
    let lote = null
    if (p.controla_lote && !p.e_kit) {
      const lotes = await lotesDisponiveis(p.id)
      const hoje = hojeISO()
      const validos = lotes.filter((l) => !l.validade || l.validade >= hoje)
      if (lotes.length && !validos.length) { avisar(`Todos os lotes de ${p.descricao} com saldo estão vencidos. Venda bloqueada.`, 'erro'); return }
      lote = validos[0] ?? null
    }
    setItens((c) => adicionar(c, p, qtd, lote))
    setDestaque({ ...p, qtdIncluida: qtd, lote })
  }

  const abrirLotes = async (item) => setEscolhaLote({ item, lotes: await lotesDisponiveis(item.produto_id) })

  const pesquisar = async (e) => {
    e.preventDefault()
    const { quantidade, termo: q } = lerCodigo(termo)
    if (!q) return
    if (!(quantidade > 0)) { avisar('Quantidade inválida.', 'erro'); return }
    const limpo = q.replace(/[%,()]/g, '')
    const soNumeros = /^\d{6,14}$/.test(limpo)
    let consulta = supabase.from('produtos').select('id, descricao, unidade, preco_venda, estoque_atual, ean, codigo, controlado, controla_lote, e_kit').eq('ativo', true).limit(20)
    consulta = soNumeros ? consulta.or(`ean.eq.${limpo},codigo.eq.${limpo}`) : consulta.or(`descricao.ilike.%${limpo}%,codigo.eq.${limpo}`)
    const { data, error } = await consulta
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    if (data.length === 1) {
      incluir(data[0], quantidade)
      setTermo(''); setResultados([])
    } else if (data.length === 0) {
      avisar(`Nenhum produto encontrado para "${q}".`, 'erro')
    } else {
      setResultados(data.map((p) => ({ ...p, _qtd: quantidade })))
    }
  }

  const escolher = (p) => {
    incluir(p, p._qtd)
    setResultados([]); setTermo(''); busca.current?.focus()
  }

  const concluida = async (r) => {
    setUltima({ ...r, nfce: null }); setItens([]); setDestaque(null); setPagamentoAberto(false); setCliente(null)
    if (preVenda) {
      await supabase.from('pre_vendas').update({ status: 'convertido', venda_id: r.venda_id }).eq('id', preVenda.id)
      setPreVenda(null)
    }
    avisar(`Venda nº ${r.numero} concluída.`)
    busca.current?.focus()
    // Emite a NFC-e automaticamente quando a configuração fiscal já foi testada
    const { data: emp } = await supabase.from('empresas').select('certificado_titular, nfce_csc_id').single()
    if (!emp?.certificado_titular || !emp?.nfce_csc_id) return
    setUltima((u) => ({ ...u, nfce: 'emitindo' }))
    const n = await chamarNfce({ acao: 'emitir', venda_id: r.venda_id })
    if (n.erro) {
      setUltima((u) => ({ ...u, nfce: 'erro', nfceErro: n.erro }))
      avisar(n.erro, 'erro')
      return
    }
    setUltima((u) => ({ ...u, nfce: 'autorizada', nfceNumero: n.dados.numero }))
    const imp = await imprimirDanfe(r.venda_id)
    if (imp.erro) avisar(imp.erro, 'erro')
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[1fr_380px]">
      <section className="min-w-0 space-y-4">
        <form onSubmit={pesquisar} className="cartao flex items-center gap-3 p-3 pl-4">
          <Icone nome="busca" className="h-6 w-6 shrink-0 text-tinta-400" />
          <input
            ref={busca}
            className="min-w-0 flex-1 bg-transparent py-2 text-xl outline-none placeholder:text-tinta-300"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            autoFocus
            placeholder="Leia o código de barras ou digite o nome do produto"
            aria-label="Buscar produto"
          />
          <Botao type="submit">Incluir</Botao>
        </form>

        {destaque && (
          <div className="cartao flex flex-wrap items-center gap-x-8 gap-y-2 border-l-4 border-l-caixa-500 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-tinta-400">Último item incluído</p>
              <p className="truncate text-xl font-semibold">{destaque.descricao}</p>
              <p className="text-sm text-tinta-400">Código {destaque.ean || destaque.codigo || 'não informado'}{destaque.lote ? `, lote ${destaque.lote.numero}${destaque.lote.validade ? ` com validade ${dataBR(destaque.lote.validade)}` : ''}` : ''}{destaque.e_kit ? ', kit' : ''}</p>
            </div>
            <div className="num text-right">
              <p className="font-sans text-sm text-tinta-400">Preço unitário</p>
              <p className="text-2xl font-semibold">{dinheiro(destaque.preco_venda)}</p>
            </div>
            <div className="num text-right">
              <p className="font-sans text-sm text-tinta-400">Em estoque</p>
              <p className={`text-2xl font-semibold ${!destaque.e_kit && Number(destaque.estoque_atual) - destaque.qtdIncluida < 0 ? 'text-rubro-600' : ''}`}>{destaque.e_kit ? 'Kit' : `${Number(destaque.estoque_atual)} ${destaque.unidade}`}</p>
            </div>
            {destaque.controlado && <Etiqueta tom="critico">Medicamento controlado: confira a receita</Etiqueta>}
            {venceEmBreve(destaque.lote?.validade) && <Etiqueta tom="alerta">Lote vence em até 30 dias</Etiqueta>}
          </div>
        )}

        <div className="cartao overflow-hidden">
          {itens.length === 0 ? (
            <Vazio icone="pdv" titulo="Nenhum item nesta venda" texto="Leia o código de barras do produto. Para várias unidades, digite a quantidade, um asterisco e o código (ex.: 3*7891234567895)." />
          ) : (
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40">
                <tr><th className="w-12">Item</th><th>Produto</th><th className="text-right">Quantidade</th><th className="text-right">Unitário</th><th className="text-right">Total</th><th className="w-12" /></tr>
              </thead>
              <tbody>
                {itens.map((i, n) => (
                  <tr key={i.chave} className={n === itens.length - 1 ? 'bg-caixa-50/60 dark:bg-caixa-700/10' : ''}>
                    <td className="num text-tinta-400">{n + 1}</td>
                    <td>
                      <span className="font-medium">{i.descricao}</span>
                      {i.lote_id && (
                        <button className={`block text-xs hover:underline ${venceEmBreve(i.lote_validade) ? 'text-ambar-600 dark:text-ambar-300' : 'text-tinta-400'}`} onClick={() => abrirLotes(i)}>
                          Lote {i.lote_numero}{i.lote_validade ? `, validade ${dataBR(i.lote_validade)}` : ''} (trocar)
                        </button>
                      )}
                      {i.e_kit && <span className="block text-xs text-tinta-400">Kit: baixa os componentes</span>}
                    </td>
                    <td className="text-right">
                      <input
                        key={i.quantidade}
                        className="campo num w-20 py-1 text-right"
                        inputMode="decimal"
                        aria-label={`Quantidade de ${i.descricao}`}
                        defaultValue={String(i.quantidade).replace('.', ',')}
                        onBlur={(e) => {
                          const q = lerNumero(e.target.value)
                          setItens((c) => alterarQuantidade(c, i.chave, Number.isNaN(q) ? i.quantidade : q))
                        }}
                      />
                    </td>
                    <td className="num text-right">{dinheiro(i.preco_unitario)}</td>
                    <td className="num text-right font-semibold">{dinheiro(totalItem(i))}</td>
                    <td className="text-right">
                      <button className="rounded p-1 text-tinta-400 hover:bg-rubro-50 hover:text-rubro-600" onClick={() => setItens((c) => remover(c, i.chave))} title="Remover item" aria-label={`Remover ${i.descricao}`}>
                        <Icone nome="lixo" className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-tinta-400">
          <span><Tecla>F2</Tecla> buscar produto</span>
          <span><Tecla>F4</Tecla> finalizar venda</span>
          <span><Tecla>F3</Tecla> identificar cliente</span>
          <span><Tecla>F6</Tecla> salvar orçamento</span>
          <span><Tecla>F8</Tecla> cancelar venda</span>
          <span><Tecla>1</Tecla> a <Tecla>7</Tecla> forma de pagamento</span>
          <span><Tecla>Esc</Tecla> fechar janela</span>
        </div>
      </section>

      <aside className="space-y-4">
        {/* Cupom: a peça central da tela */}
        <div className="drop-shadow-[0_8px_16px_rgba(22,37,45,0.12)]">
          <div className="rounded-t-xl bg-white px-5 pb-4 pt-5 dark:bg-noite-800">
            <div className="text-center">
              <p className="font-semibold">{perfil.empresa.nome_fantasia || perfil.empresa.razao_social}</p>
              <p className="text-sm text-tinta-400">Terminal {caixa.numero_terminal}, operador {perfil.nome.split(' ')[0]}</p>
            </div>
            <div className="my-4 border-t border-dashed border-papel-300 dark:border-noite-600" />
            <div className="max-h-56 space-y-1.5 overflow-auto text-sm">
              {itens.length === 0 && <p className="text-center text-tinta-400">Aguardando o primeiro item</p>}
              {itens.map((i) => (
                <div key={i.chave} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{String(i.quantidade).replace('.', ',')} × {i.descricao}</span>
                  <span className="num shrink-0">{dinheiro(totalItem(i))}</span>
                </div>
              ))}
            </div>
            <div className="my-4 border-t border-dashed border-papel-300 dark:border-noite-600" />
            <p className="text-sm text-tinta-400">{itens.length} {itens.length === 1 ? 'produto' : 'produtos'}, {String(qtdItens).replace('.', ',')} {qtdItens === 1 ? 'unidade' : 'unidades'}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className="text-[0.95rem] font-medium">Total a pagar</span>
              <span className="num text-[2.9rem] font-bold leading-none text-caixa-600 dark:text-caixa-300">{dinheiro(t.total)}</span>
            </div>
          </div>
          <div className="serrilha h-2 rotate-180" />
        </div>

        {preVenda && <p className="text-sm text-tinta-400">Venda originada do {preVenda.tipo === 'pedido' ? 'pedido' : 'orçamento'} nº {preVenda.numero}</p>}
        {cliente
          ? <SituacaoCliente cliente={cliente} compacto onRemover={() => setCliente(null)} />
          : <Botao variante="secundario" icone="usuario" className="w-full" onClick={() => setEscolherCliente(true)}>Identificar cliente (F3)</Botao>}

        <div className="grid grid-cols-2 gap-2">
          <Botao variante="secundario" disabled={!itens.length} onClick={() => setSalvarPre(true)}>Salvar orçamento</Botao>
          <Botao variante="secundario" disabled={!itens.length} onClick={() => setLimparAberto(true)}>Cancelar venda</Botao>
          <Botao variante="sucesso" className="col-span-2 py-3 text-base" disabled={!itens.length} onClick={() => setPagamentoAberto(true)}>Finalizar venda (F4)</Botao>
        </div>

        {ultima && (
          <div className="cartao p-4 text-[0.95rem]">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Venda nº {ultima.numero} concluída</span>
              <span className="num">{dinheiro(ultima.total)}</span>
            </div>
            {Number(ultima.troco) > 0 && (
              <p className="mt-2 flex items-baseline justify-between rounded-lg bg-caixa-50 px-3 py-2 text-caixa-700 dark:bg-caixa-700/20 dark:text-caixa-300">
                <span>Troco a devolver</span><span className="num text-2xl font-bold">{dinheiro(ultima.troco)}</span>
              </p>
            )}
            {ultima.nfce === 'emitindo' && <p className="mt-2 text-tinta-400">Emitindo NFC-e…</p>}
            {ultima.nfce === 'autorizada' && (
              <div className="mt-2 flex items-center justify-between"><Etiqueta tom="positivo">NFC-e nº {ultima.nfceNumero} autorizada</Etiqueta>
                <button className="flex items-center gap-1 text-sm font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => imprimirDanfe(ultima.venda_id)}><Icone nome="impressora" className="h-4 w-4" />Reimprimir</button></div>
            )}
            {ultima.nfce === 'erro' && <p className="mt-2 text-sm text-rubro-600">NFC-e não emitida: {ultima.nfceErro} Reenvie pela tela Vendas.</p>}
          </div>
        )}
      </aside>

      <TelaSuspensa aberta={resultados.length > 0} titulo="Selecione o produto" subtitulo={`${resultados.length} produtos encontrados`} onFechar={() => setResultados([])} largura="max-w-2xl">
        <ul className="-mx-2 divide-y divide-papel-200 dark:divide-noite-700">
          {resultados.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center justify-between gap-4 rounded-lg px-2 py-3 text-left hover:bg-caixa-50 dark:hover:bg-noite-700" onClick={() => escolher(p)}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.descricao}</span>
                  <span className="text-sm text-tinta-400">Código {p.ean || p.codigo || 'não informado'}, estoque {Number(p.estoque_atual)} {p.unidade}</span>
                </span>
                <strong className="num text-lg">{dinheiro(p.preco_venda)}</strong>
              </button>
            </li>
          ))}
        </ul>
      </TelaSuspensa>

      <Confirmacao
        aberta={limparAberto}
        titulo="Cancelar venda em andamento"
        mensagem="Todos os itens serão removidos desta venda. Deseja continuar?"
        textoConfirmar="Cancelar venda"
        variante="perigo"
        onCancelar={() => setLimparAberto(false)}
        onConfirmar={() => { setItens([]); setDestaque(null); setLimparAberto(false); setCliente(null); setPreVenda(null) }}
      />

      <TelaSuspensa aberta={!!escolhaLote} titulo="Escolher lote" subtitulo={escolhaLote?.item.descricao} onFechar={() => setEscolhaLote(null)}>
        {escolhaLote && (
          <ul className="-mx-2 divide-y divide-papel-200 dark:divide-noite-700">
            {escolhaLote.lotes.map((l) => {
              const vencido = l.validade && l.validade < hojeISO()
              return (
                <li key={l.id}>
                  <button disabled={vencido} className="flex w-full items-center justify-between rounded-lg px-2 py-3 text-left hover:bg-caixa-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-noite-700"
                    onClick={() => { setItens((c) => trocarLote(c, escolhaLote.item.chave, l)); setEscolhaLote(null) }}>
                    <span><span className="font-medium">Lote {l.numero}</span><span className="block text-sm text-tinta-400">Validade {l.validade ? dataBR(l.validade) : 'não informada'}, saldo {Number(l.quantidade)}</span></span>
                    {vencido ? <Etiqueta tom="critico">Vencido</Etiqueta> : l.id === escolhaLote.item.lote_id ? <Etiqueta tom="positivo">Atual</Etiqueta> : venceEmBreve(l.validade) ? <Etiqueta tom="alerta">Vence em breve</Etiqueta> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </TelaSuspensa>

      <SeletorCliente aberta={escolherCliente} onFechar={() => setEscolherCliente(false)} onEscolher={(c) => { setCliente(c); setEscolherCliente(false); busca.current?.focus() }} />

      {salvarPre && (
        <SalvarPreVenda itens={itens} cliente={cliente} onFechar={() => setSalvarPre(false)}
          onSalvo={(pv) => { setSalvarPre(false); setItens([]); setDestaque(null); setCliente(null); avisar(`${pv.tipo === 'pedido' ? 'Pedido' : 'Orçamento'} nº ${pv.numero} salvo.`) }} />
      )}

      {pagamentoAberto && (
        <Pagamento caixa={caixa} itens={itens} cliente={cliente} onFechar={() => setPagamentoAberto(false)} onConcluir={concluida} />
      )}
    </div>
  )
}

function Pagamento({ caixa, itens, cliente, onFechar, onConcluir }) {
  const avisar = useAviso()
  const [desconto, setDesconto] = useState('')
  const [cpf, setCpf] = useState('')
  const [pagamentos, setPagamentos] = useState([])
  const [valor, setValor] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [parcelas, setParcelas] = useState(1)
  const amanha30 = new Date(Date.now() + 30 * 864e5 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [primeiroVenc, setPrimeiroVenc] = useState(amanha30)
  const desc = lerNumero(desconto) || 0
  const t = totais(itens, desc, pagamentos)
  const sit = cliente?.situacao ?? {}
  const usado = (f) => pagamentos.filter((p) => p.forma === f).reduce((s, p) => s + p.valor, 0)
  const valeDisponivel = arred(Number(sit.vale ?? 0) - usado('vale'))
  const limiteDisponivel = arred(Number(sit.disponivel ?? 0) - usado('crediario'))

  const motivoBloqueio = (f) => {
    if (!f.cliente) return null
    if (!cliente) return 'Identifique o cliente'
    if (sit.bloqueado) return 'Cliente bloqueado'
    if (f.forma === 'crediario' && limiteDisponivel <= 0) return 'Sem limite disponível'
    if (f.forma === 'convenio' && !sit.convenio) return 'Cliente sem convênio'
    if (f.forma === 'vale' && valeDisponivel <= 0) return 'Sem vale-troca'
    return null
  }

  const incluir = (forma) => {
    const f = FORMAS.find((x) => x.forma === forma)
    const bloqueio = motivoBloqueio(f)
    if (bloqueio) { avisar(`${f.texto}: ${bloqueio.toLowerCase()}.`, 'erro'); return }
    let v = valor === '' ? t.falta : lerNumero(valor)
    if (valor === '' && forma === 'vale') v = Math.min(t.falta, valeDisponivel)
    if (!(v > 0)) { avisar('Informe um valor válido.', 'erro'); return }
    if (forma !== 'dinheiro' && v > t.falta) { avisar('Somente o pagamento em dinheiro pode gerar troco.', 'erro'); return }
    if (forma === 'vale' && v > valeDisponivel) { avisar(`Saldo de vale-troca: ${dinheiro(valeDisponivel)}.`, 'erro'); return }
    if (forma === 'crediario' && v > limiteDisponivel) { avisar(`Limite disponível: ${dinheiro(limiteDisponivel)}.`, 'erro'); return }
    const pg = { forma, valor: arred(v) }
    if (forma === 'crediario') { pg.parcelas = parcelas; pg.primeiro_vencimento = primeiroVenc }
    setPagamentos((p) => [...p, pg])
    setValor('')
  }

  useEffect(() => {
    const tecla = (e) => {
      if (e.target.tagName === 'INPUT' && e.target.dataset.valor !== 'sim') return
      const f = FORMAS.find((x) => x.tecla === e.key)
      if (f && t.falta > 0) { e.preventDefault(); incluir(f.forma) }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  const finalizar = async () => {
    setEnviando(true)
    const { data, error } = await supabase.rpc('finalizar_venda', {
      p_caixa: caixa.id,
      p_itens: paraEnvio(itens),
      p_pagamentos: pagamentos,
      p_desconto: desc,
      p_cliente: cliente?.id ?? null,
      p_cpf: cpf.replace(/\D/g, '') || null,
    })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    onConcluir(data)
  }

  const podeFinalizar = t.falta === 0 && t.trocoValido && t.total >= 0

  return (
    <TelaSuspensa
      aberta
      titulo="Pagamento"
      subtitulo={`${itens.length} ${itens.length === 1 ? 'produto' : 'produtos'}, subtotal ${dinheiro(t.subtotal)}`}
      onFechar={onFechar}
      largura="max-w-2xl"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Voltar à venda</Botao>
        <Botao variante="sucesso" onClick={finalizar} disabled={!podeFinalizar} carregando={enviando}>Concluir venda</Botao>
      </>}
    >
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-papel-200 text-center dark:border-noite-700">
        <div className="p-3"><p className="text-sm text-tinta-400">Total</p><p className="num text-2xl font-semibold">{dinheiro(t.total)}</p></div>
        <div className={`border-x border-papel-200 p-3 dark:border-noite-700 ${t.falta > 0 ? 'bg-ambar-50 dark:bg-ambar-600/10' : ''}`}><p className="text-sm text-tinta-400">Falta receber</p><p className={`num text-2xl font-semibold ${t.falta > 0 ? 'text-ambar-600' : 'text-tinta-300'}`}>{dinheiro(t.falta)}</p></div>
        <div className={`p-3 ${t.troco > 0 ? 'bg-caixa-50 dark:bg-caixa-700/20' : ''}`}><p className="text-sm text-tinta-400">Troco</p><p className={`num text-2xl font-semibold ${t.troco > 0 ? 'text-caixa-600' : 'text-tinta-300'}`}>{dinheiro(t.troco)}</p></div>
      </div>

      {t.falta > 0 && (
        <div className="mt-5">
          <Campo rotulo="Valor recebido" ajuda="Deixe vazio para receber exatamente o valor que falta. Depois escolha a forma de pagamento.">
            <input className="campo num text-lg" inputMode="decimal" data-valor="sim" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={dinheiro(t.falta)} autoFocus />
          </Campo>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FORMAS.map((f) => {
              const bloqueio = motivoBloqueio(f)
              return (
                <button key={f.forma} onClick={() => incluir(f.forma)} disabled={!!bloqueio} title={bloqueio ?? ''}
                  className="flex flex-col items-center gap-1 rounded-xl border border-papel-300 px-2 py-3 text-sm font-medium transition hover:border-caixa-500 hover:bg-caixa-50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-papel-300 disabled:hover:bg-transparent dark:border-noite-600 dark:hover:bg-noite-700">
                  <Tecla>{f.tecla}</Tecla>{f.texto}
                  {bloqueio ? <span className="text-xs font-normal text-tinta-400">{bloqueio}</span>
                    : f.forma === 'vale' ? <span className="num text-xs font-normal text-tinta-400">saldo {dinheiro(valeDisponivel)}</span>
                    : f.forma === 'crediario' ? <span className="num text-xs font-normal text-tinta-400">limite {dinheiro(limiteDisponivel)}</span> : null}
                </button>
              )
            })}
          </div>
          {cliente && !motivoBloqueio(FORMAS[4]) && (
            <div className="mt-3 grid gap-3 rounded-xl border border-papel-200 p-3 sm:grid-cols-2 dark:border-noite-700">
              <Campo rotulo="Crediário: número de parcelas"><Lista valor={parcelas} opcoes={PARCELAS} onMudar={setParcelas} /></Campo>
              <Campo rotulo="Vencimento da 1ª parcela"><input type="date" className="campo" value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} /></Campo>
            </div>
          )}
        </div>
      )}

      {pagamentos.length > 0 && (
        <ul className="mt-4 divide-y divide-papel-200 rounded-xl border border-papel-200 dark:divide-noite-700 dark:border-noite-700">
          {pagamentos.map((p, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-2.5">
              <span>{nomeForma(p.forma)}{p.parcelas > 1 ? ` em ${p.parcelas}× de ${dinheiro(p.valor / p.parcelas)}` : ''}</span>
              <span className="flex items-center gap-3">
                <strong className="num">{dinheiro(p.valor)}</strong>
                <button className="rounded p-1 text-tinta-400 hover:text-rubro-600" onClick={() => setPagamentos((x) => x.filter((_, j) => j !== i))} aria-label="Remover pagamento"><Icone nome="fechar" className="h-4 w-4" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!t.trocoValido && <p className="mt-2 text-sm text-rubro-600">O troco só pode sair de pagamento em dinheiro.</p>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Desconto na venda (R$)" ajuda={sit.convenio && Number(sit.convenio.desconto) > 0 ? <button type="button" className="font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => setDesconto(String(arred(t.subtotal * Number(sit.convenio.desconto) / 100)).replace('.', ','))}>Aplicar desconto do convênio ({String(sit.convenio.desconto).replace('.', ',')}%)</button> : undefined}>
          <input className="campo num" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" />
        </Campo>
        <Campo rotulo="CPF ou CNPJ na nota (opcional)"><input className="campo num" inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} /></Campo>
      </div>
    </TelaSuspensa>
  )
}

function SalvarPreVenda({ itens, cliente, onFechar, onSalvo }) {
  const avisar = useAviso()
  const [tipo, setTipo] = useState('orcamento')
  const [nome, setNome] = useState(cliente?.nome ?? '')
  const validadePadrao = new Date(Date.now() + 7 * 864e5 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [validade, setValidade] = useState(validadePadrao)
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const t = totais(itens)

  const salvar = async () => {
    setEnviando(true)
    const { data, error } = await supabase.from('pre_vendas').insert({
      tipo, cliente_id: cliente?.id ?? null, cliente_nome: nome.trim() || null,
      itens: itens.map((i) => ({ produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: i.desconto || 0 })),
      total: t.total, validade: validade || null, observacao: obs.trim() || null,
    }).select('numero, tipo').single()
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    onSalvo(data)
  }

  return (
    <TelaSuspensa aberta titulo="Salvar orçamento ou pedido" subtitulo={`${itens.length} produto(s), total ${dinheiro(t.total)}. A venda em andamento será limpa.`} onFechar={onFechar}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Voltar à venda</Botao>
        <Botao onClick={salvar} carregando={enviando}>Salvar {tipo === 'pedido' ? 'pedido' : 'orçamento'}</Botao>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Tipo"><Lista valor={tipo} opcoes={TIPOS_PRE} onMudar={setTipo} /></Campo>
        <Campo rotulo="Válido até"><input type="date" className="campo" value={validade} onChange={(e) => setValidade(e.target.value)} /></Campo>
        <div className="sm:col-span-2"><Campo rotulo="Nome do cliente" ajuda={cliente ? 'Cliente identificado na venda' : 'Opcional, para localizar depois'}><input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!!cliente} /></Campo></div>
        <div className="sm:col-span-2"><Campo rotulo="Observação"><textarea className="campo" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: separar para retirada amanhã" /></Campo></div>
      </div>
    </TelaSuspensa>
  )
}
