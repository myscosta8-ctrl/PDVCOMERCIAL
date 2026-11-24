import { useEffect, useState } from 'react'
import { NOMES_FORMAS as FORMAS } from '../lib/formas.js'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro } from '../lib/formato.js'
import { Barra, Botao, Cabecalho, Etiqueta, Icone, Indicador, Vazio, useAviso } from '../components/ui.jsx'


function variacao(hoje, ontem) {
  if (!ontem) return hoje > 0 ? 'Sem vendas ontem para comparar' : 'Nenhuma venda ontem'
  const p = Math.round(((hoje - ontem) / ontem) * 100)
  return `${p >= 0 ? '+' : ''}${p}% em relação a ontem`
}

export default function Inicio({ irPara }) {
  const perfil = useSessao()
  const avisar = useAviso()
  const [p, setP] = useState(null)
  const [lotes, setLotes] = useState(null)

  useEffect(() => {
    supabase.rpc('painel_dia').then(({ data, error }) => {
      if (error) avisar(mensagemErro(error), 'erro')
      else setP(data)
    })
    supabase.rpc('lotes_alerta').then(({ data }) => setLotes(data))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  const hora = new Date().getHours()
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'

  if (!p) return <p className="text-sm text-tinta-400">Carregando resumo do dia…</p>

  const ticket = p.qtd ? p.total / p.qtd : 0
  const maxHora = Math.max(...p.por_hora.map(Number), 0)
  const horasComVenda = p.por_hora.map((v, h) => ({ h, v: Number(v) })).filter((x, i, arr) => x.v > 0 || (i >= 7 && i <= 21))
  const formas = Object.entries(p.formas).sort((a, b) => b[1] - a[1])
  const alertas = [
    p.caixas_abertos === 0 && { tom: 'alerta', texto: 'Nenhum caixa aberto agora.', acao: 'Abrir caixa', tela: 'caixa' },
    p.qtd_estoque_baixo > 0 && { tom: 'alerta', texto: `${p.qtd_estoque_baixo} produto(s) no estoque mínimo ou abaixo dele.`, acao: 'Ver produtos', tela: 'produtos' },
    p.sem_ncm > 0 && { tom: 'critico', texto: `${p.sem_ncm} produto(s) sem NCM válido: não podem sair em NFC-e.`, acao: 'Corrigir cadastro', tela: 'produtos' },
    p.nfce.pendentes > 0 && { tom: 'critico', texto: `${p.nfce.pendentes} NFC-e pendente(s) ou rejeitada(s).`, acao: 'Ver vendas', tela: 'vendas' },
    !perfil.empresa.certificado_titular && perfil.papel === 'administrador' && { tom: 'alerta', texto: 'NFC-e ainda não configurada.', acao: 'Configurar', tela: 'configuracoes' },
    lotes?.vencidos > 0 && { tom: 'critico', texto: `${lotes.vencidos} lote(s) vencido(s) ainda com saldo em estoque: retire da área de venda e registre a perda.`, acao: 'Ver produtos', tela: 'produtos' },
    lotes?.vencendo > 0 && { tom: 'alerta', texto: `${lotes.vencendo} lote(s) vencem nos próximos 30 dias.`, acao: 'Ver produtos', tela: 'produtos' },
    p.produtos_ativos === 0 && { tom: 'alerta', texto: 'Nenhum produto cadastrado ainda.', acao: 'Cadastrar produtos', tela: 'produtos' },
  ].filter(Boolean)

  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo={`${saudacao}, ${perfil.nome.split(' ')[0]}`} descricao={`Resumo de ${hoje}`}>
        <Botao icone="pdv" onClick={() => irPara('pdv')}>Ir para a frente de caixa</Botao>
      </Cabecalho>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Faturamento do dia" icone="dinheiro" valor={dinheiro(p.total)} tom={p.total >= p.ontem_total ? 'positivo' : 'neutro'} detalhe={variacao(Number(p.total), Number(p.ontem_total))} />
        <Indicador titulo="Vendas concluídas" icone="vendas" valor={p.qtd} detalhe={p.canceladas ? `${p.canceladas} cancelada(s) hoje` : `${p.ontem_qtd} ontem`} />
        <Indicador titulo="Ticket médio" icone="caixa" valor={dinheiro(ticket)} detalhe={`${Number(p.itens).toLocaleString('pt-BR')} itens vendidos`} />
        <Indicador titulo="Descontos concedidos" icone="alerta" valor={dinheiro(p.descontos)} tom={p.descontos > 0 ? 'alerta' : 'neutro'} detalhe={p.total > 0 ? `${((p.descontos / (Number(p.total) + Number(p.descontos))) * 100).toFixed(1).replace('.', ',')}% do valor bruto` : 'Nenhum desconto hoje'} />
      </div>

      {alertas.length > 0 && (
        <div className="cartao mt-4 divide-y divide-papel-200 dark:divide-noite-700">
          {alertas.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Etiqueta tom={a.tom}><Icone nome="alerta" className="h-3.5 w-3.5" />{a.tom === 'critico' ? 'Atenção' : 'Aviso'}</Etiqueta>
              <span className="flex-1 text-[0.95rem]">{a.texto}</span>
              <button className="text-sm font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => irPara(a.tela)}>{a.acao}</button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="cartao p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="titulo-secao">Vendas por hora</h2>
            <span className="text-sm text-tinta-400">pico: {maxHora > 0 ? `${p.por_hora.map(Number).indexOf(maxHora)}h` : 'sem vendas'}</span>
          </div>
          <div className="mt-4 flex h-44 gap-1.5">
            {horasComVenda.map(({ h, v }) => (
              <div key={h} className="group flex flex-1 flex-col items-center gap-1">
                <div className="relative w-full flex-1">
                  <div
                    className={`absolute bottom-0 w-full rounded-t ${v === maxHora && v > 0 ? 'bg-caixa-600' : 'bg-caixa-100 dark:bg-caixa-700/50'}`}
                    style={{ height: maxHora ? `${Math.max(v > 0 ? 4 : 1, (v / maxHora) * 100)}%` : '1%' }}
                    title={`${h}h: ${dinheiro(v)}`}
                  />
                </div>
                <span className="num text-[0.7rem] text-tinta-400">{h}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="cartao p-5">
          <h2 className="titulo-secao">Recebido por forma de pagamento</h2>
          {formas.length === 0 ? (
            <p className="mt-4 text-sm text-tinta-400">Nenhum recebimento hoje.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {formas.map(([f, v]) => (
                <li key={f}>
                  <div className="mb-1 flex justify-between text-[0.95rem]"><span>{FORMAS[f] ?? f}</span><span className="num font-semibold">{dinheiro(v)}</span></div>
                  <Barra parte={Number(v)} total={Number(p.total)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="cartao">
          <h2 className="titulo-secao px-5 pt-4">Mais vendidos hoje</h2>
          {p.mais_vendidos.length === 0 ? <Vazio icone="produtos" titulo="Sem vendas ainda" texto="Os produtos mais vendidos do dia aparecem aqui." /> : (
            <ul className="mt-2 divide-y divide-papel-200 dark:divide-noite-700">
              {p.mais_vendidos.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="min-w-0 truncate">{m.descricao}</span>
                  <span className="num shrink-0 text-right"><span className="font-semibold">{dinheiro(m.total)}</span><span className="block text-xs text-tinta-400">{Number(m.quantidade)} un.</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao">
          <div className="flex items-baseline justify-between px-5 pt-4">
            <h2 className="titulo-secao">Estoque baixo</h2>
            {p.qtd_estoque_baixo > 0 && <Etiqueta tom="alerta">{p.qtd_estoque_baixo}</Etiqueta>}
          </div>
          {p.estoque_baixo.length === 0 ? <Vazio icone="estoque" titulo="Estoque em dia" texto="Nenhum produto abaixo do mínimo definido." /> : (
            <ul className="mt-2 divide-y divide-papel-200 dark:divide-noite-700">
              {p.estoque_baixo.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="min-w-0 truncate">{e.descricao}</span>
                  <span className="num shrink-0 text-right text-sm"><span className={`font-semibold ${Number(e.estoque_atual) <= 0 ? 'text-rubro-600' : 'text-ambar-600'}`}>{Number(e.estoque_atual)} {e.unidade}</span><span className="block text-xs text-tinta-400">mínimo {Number(e.estoque_minimo)}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao">
          <div className="flex items-baseline justify-between px-5 pt-4">
            <h2 className="titulo-secao">Últimas vendas</h2>
            <span className="text-sm text-tinta-400">{p.nfce.autorizadas} com NFC-e</span>
          </div>
          {p.ultimas.length === 0 ? <Vazio icone="vendas" titulo="Nenhuma venda hoje" texto="Abra o caixa e registre a primeira venda na frente de caixa." /> : (
            <ul className="mt-2 divide-y divide-papel-200 dark:divide-noite-700">
              {p.ultimas.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-5 py-2.5">
                  <span>Venda nº {u.numero}<span className="block text-xs text-tinta-400">{new Date(u.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></span>
                  <span className="num font-semibold">{dinheiro(u.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
