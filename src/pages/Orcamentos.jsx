import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro, dataHora } from '../lib/formato.js'
import { Botao, Cabecalho, Confirmacao, Etiqueta, Icone, Indicador, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const FILTROS = [
  { id: 'aberto', nome: 'Em aberto' },
  { id: 'convertido', nome: 'Convertidos em venda' },
  { id: 'cancelado', nome: 'Cancelados' },
]
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dataBR = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '')
const nomeTipo = (t) => (t === 'pedido' ? 'Pedido' : 'Orçamento')

function imprimir(pv, empresa) {
  const linhas = pv.itens.map((i) => `<tr><td>${i.descricao}</td><td class="r">${Number(i.quantidade)}</td><td class="r">${dinheiro(i.preco_unitario)}</td><td class="r">${dinheiro(i.quantidade * i.preco_unitario - (i.desconto || 0))}</td></tr>`).join('')
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${nomeTipo(pv.tipo)} ${pv.numero}</title>
<style>body{font-family:Arial,sans-serif;font-size:13px;max-width:720px;margin:24px auto;color:#16252D}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:6px;border-bottom:1px solid #D5DBD4;text-align:left}.r{text-align:right}.t{font-size:16px;font-weight:bold}</style></head><body>
<h1>${empresa.nome_fantasia || empresa.razao_social}</h1>
<p>${nomeTipo(pv.tipo)} nº ${pv.numero}, emitido em ${dataHora(pv.criado_em)}${pv.validade ? `, válido até ${dataBR(pv.validade)}` : ''}</p>
${pv.cliente_nome ? `<p>Cliente: ${pv.cliente_nome}</p>` : ''}
<table><thead><tr><th>Produto</th><th class="r">Qtd.</th><th class="r">Unitário</th><th class="r">Total</th></tr></thead><tbody>${linhas}</tbody></table>
<p class="r t">Total: ${dinheiro(pv.total)}</p>
${pv.observacao ? `<p>Observação: ${pv.observacao}</p>` : ''}
<p style="margin-top:32px;font-size:11px">Documento sem valor fiscal. Preços sujeitos a alteração após a validade.</p>
<script>window.onload=()=>{window.print()}</script></body></html>`
  const j = window.open('', '_blank', 'width=800,height=900')
  if (j) { j.document.write(html); j.document.close() }
}

export default function Orcamentos({ irPara }) {
  const perfil = useSessao()
  const avisar = useAviso()
  const [filtro, setFiltro] = useState('aberto')
  const [lista, setLista] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  const [cancelar, setCancelar] = useState(null)

  const carregar = async () => {
    const { data, error } = await supabase.from('pre_vendas').select('*, criador:usuarios!pre_vendas_criado_por_fkey(nome)').order('criado_em', { ascending: false }).limit(500)
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hoje = hojeISO()
  const abertos = (lista ?? []).filter((p) => p.status === 'aberto')
  const vencidos = abertos.filter((p) => p.validade && p.validade < hoje)
  const mes = hoje.slice(0, 7)
  const doMes = (lista ?? []).filter((p) => p.criado_em.slice(0, 7) === mes)
  const conversao = doMes.length ? Math.round((doMes.filter((p) => p.status === 'convertido').length / doMes.length) * 100) : 0
  const visiveis = (lista ?? []).filter((p) => p.status === filtro)

  const abrirNoCaixa = (pv) => {
    try { sessionStorage.setItem('carregar_pre_venda', pv.id) } catch {}
    irPara('pdv')
  }

  const confirmarCancelamento = async () => {
    const { error } = await supabase.from('pre_vendas').update({ status: 'cancelado' }).eq('id', cancelar.id)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`${nomeTipo(cancelar.tipo)} nº ${cancelar.numero} cancelado.`)
    setCancelar(null); setDetalhe(null); carregar()
  }

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Orçamentos e pedidos" descricao="Pré-vendas salvas na frente de caixa, prontas para virar venda">
        <Botao icone="pdv" onClick={() => irPara('pdv')}>Criar na frente de caixa</Botao>
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Em aberto" icone="vendas" valor={abertos.length} detalhe={`${dinheiro(abertos.reduce((s, p) => s + Number(p.total), 0))} em negociação`} />
        <Indicador titulo="Validade vencida" icone="relogio" valor={vencidos.length} tom={vencidos.length ? 'alerta' : 'neutro'} detalhe="Confira os preços antes de vender" />
        <Indicador titulo="Pedidos em aberto" icone="caixa" valor={abertos.filter((p) => p.tipo === 'pedido').length} detalhe="Aguardando retirada ou entrega" />
        <Indicador titulo="Conversão no mês" icone="ok" tom={conversao >= 50 ? 'positivo' : 'neutro'} valor={`${conversao}%`} detalhe={`${doMes.length} criado(s) neste mês`} />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="border-b border-papel-200 p-3 dark:border-noite-700">
          <div className="inline-flex gap-1 rounded-lg bg-papel-200 p-1 dark:bg-noite-700" role="tablist">
            {FILTROS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filtro === f.id} onClick={() => setFiltro(f.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${filtro === f.id ? 'bg-white shadow-sm dark:bg-noite-800' : 'text-tinta-600 dark:text-tinta-300'}`}>{f.nome}</button>
            ))}
          </div>
        </div>
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : visiveis.length === 0 ? (
          <Vazio icone="vendas" titulo="Nada por aqui" texto="Na frente de caixa, monte a venda e use Salvar orçamento (F6) para guardar um orçamento ou pedido." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Número</th><th>Cliente</th><th>Criado</th><th>Validade</th><th className="text-right">Itens</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>
                {visiveis.map((p) => (
                  <tr key={p.id} onClick={() => setDetalhe(p)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                    <td><span className="font-semibold">{nomeTipo(p.tipo)} nº {p.numero}</span></td>
                    <td>{p.cliente_nome || <span className="text-tinta-400">Não informado</span>}</td>
                    <td>{dataHora(p.criado_em)}<span className="block text-xs text-tinta-400">{p.criador?.nome}</span></td>
                    <td>{p.validade ? (p.status === 'aberto' && p.validade < hoje ? <Etiqueta tom="alerta">Venceu em {dataBR(p.validade)}</Etiqueta> : dataBR(p.validade)) : '—'}</td>
                    <td className="num text-right">{p.itens.length}</td>
                    <td className="num text-right font-semibold">{dinheiro(p.total)}</td>
                    <td className="text-right">{p.status === 'aberto' && <Botao variante="discreto" className="px-2 py-1" onClick={(e) => { e.stopPropagation(); abrirNoCaixa(p) }}>Vender</Botao>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TelaSuspensa
        aberta={!!detalhe}
        titulo={detalhe ? `${nomeTipo(detalhe.tipo)} nº ${detalhe.numero}` : ''}
        subtitulo={detalhe ? `Criado em ${dataHora(detalhe.criado_em)}${detalhe.cliente_nome ? ` para ${detalhe.cliente_nome}` : ''}` : ''}
        onFechar={() => setDetalhe(null)}
        largura="max-w-2xl"
        rodape={<>
          <Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>
          <Botao variante="secundario" icone="impressora" onClick={() => imprimir(detalhe, perfil.empresa)}>Imprimir</Botao>
          {detalhe?.status === 'aberto' && <Botao variante="perigo" onClick={() => setCancelar(detalhe)}>Cancelar</Botao>}
          {detalhe?.status === 'aberto' && <Botao icone="pdv" onClick={() => abrirNoCaixa(detalhe)}>Abrir na frente de caixa</Botao>}
        </>}
      >
        {detalhe && (
          <div className="space-y-3">
            <table className="tabela -mx-4 w-[calc(100%+2rem)] text-[0.95rem]">
              <thead><tr><th>Produto</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {detalhe.itens.map((i, n) => (
                  <tr key={n}><td>{i.descricao}</td><td className="num text-right">{Number(i.quantidade)}</td><td className="num text-right">{dinheiro(i.preco_unitario)}</td><td className="num text-right">{dinheiro(i.quantidade * i.preco_unitario - (i.desconto || 0))}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between text-lg font-semibold"><span>Total</span><span className="num">{dinheiro(detalhe.total)}</span></div>
            {detalhe.observacao && <p className="rounded-lg bg-papel px-3 py-2 text-sm dark:bg-noite-700">{detalhe.observacao}</p>}
            {detalhe.status === 'aberto' && <p className="flex items-center gap-2 text-sm text-tinta-400"><Icone nome="alerta" className="h-4 w-4" />Ao abrir na frente de caixa, os preços são atualizados para os valores atuais do cadastro.</p>}
            {detalhe.status === 'convertido' && <Etiqueta tom="positivo">Convertido em venda</Etiqueta>}
          </div>
        )}
      </TelaSuspensa>

      <Confirmacao aberta={!!cancelar} titulo="Cancelar orçamento" mensagem="O orçamento deixará de aparecer entre os abertos. Deseja continuar?" textoConfirmar="Cancelar orçamento" variante="perigo"
        onCancelar={() => setCancelar(null)} onConfirmar={confirmarCancelamento} />
    </div>
  )
}
