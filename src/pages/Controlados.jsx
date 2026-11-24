import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dataHora } from '../lib/formato.js'
import { nomeTipoReceita } from '../components/Receita.jsx'
import { Botao, Cabecalho, Campo, Etiqueta, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../components/ui.jsx'

const qtd = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '')
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const mesAtual = () => { const h = new Date(); return [iso(new Date(h.getFullYear(), h.getMonth(), 1)), iso(h)] }
const trimestre = () => { const h = new Date(); const q = Math.floor(h.getMonth() / 3) * 3; return [iso(new Date(h.getFullYear(), q, 1)), iso(new Date(h.getFullYear(), q + 3, 0))] }
const TIPOS_MOV = { entrada: 'Entrada (compra)', saida_venda: 'Saída (venda)', estorno_venda: 'Venda cancelada', devolucao: 'Devolução', perda: 'Perda', ajuste: 'Ajuste', inventario: 'Inventário', transferencia_saida: 'Transferência enviada', transferencia_entrada: 'Transferência recebida' }

function baixarCsv(nome, cab, linhas) {
  const csv = [cab, ...linhas].map((l) => l.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = nome; a.click(); URL.revokeObjectURL(a.href)
}

export default function Controlados() {
  const [aba, setAba] = useState('receitas')
  return (
    <div className="mx-auto max-w-7xl">
      <Cabecalho titulo="Medicamentos controlados" descricao="Receitas retidas, livro de registro e balanço (Portaria 344/98 e antimicrobianos)" />
      <div className="mb-4 inline-flex abas" role="tablist">
        {[['receitas', 'Receitas'], ['livro', 'Livro de registro'], ['balanco', 'Balanço']].map(([id, nome]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            className={`aba ${aba === id ? 'aba-ativa' : ''}`}>{nome}</button>
        ))}
      </div>
      {aba === 'receitas' && <Receitas />}
      {aba === 'livro' && <Livro />}
      {aba === 'balanco' && <Balanco />}
      <p className="mt-3 text-sm text-tinta-400">Controle interno da farmácia. A transmissão ao SNGPC depende do sistema da ANVISA e não é feita por aqui.</p>
    </div>
  )
}

function Periodo({ valor, onMudar, children }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-3">
      <div className="w-40"><Campo rotulo="De"><input type="date" className="campo" value={valor[0]} onChange={(e) => onMudar([e.target.value, valor[1]])} /></Campo></div>
      <div className="w-40"><Campo rotulo="Até"><input type="date" className="campo" value={valor[1]} onChange={(e) => onMudar([valor[0], e.target.value])} /></Campo></div>
      {children}
    </div>
  )
}

function Receitas() {
  const avisar = useAviso()
  const [periodo, setPeriodo] = useState(mesAtual())
  const [lista, setLista] = useState(null)
  const [detalhe, setDetalhe] = useState(null)
  useEffect(() => {
    setLista(null)
    supabase.from('receitas').select('*, venda:vendas(numero, status), itens:receita_itens(quantidade, produto:produtos(descricao), lote:lotes(numero, validade))')
      .gte('criado_em', `${periodo[0]}T00:00:00-03:00`).lte('criado_em', `${periodo[1]}T23:59:59-03:00`).order('criado_em', { ascending: false }).limit(1000)
      .then(({ data, error }) => { if (error) avisar(mensagemErro(error), 'erro'); setLista(data ?? []) })
  }, [periodo]) // eslint-disable-line react-hooks/exhaustive-deps
  const validas = (lista ?? []).filter((r) => r.venda?.status !== 'cancelada')
  const porTipo = (t) => validas.filter((r) => r.tipo === t).length
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Receitas no período" icone="nota" valor={validas.length} detalhe={`${(lista ?? []).length - validas.length} de vendas canceladas`} />
        <Indicador titulo="Notificações A e B" icone="alerta" valor={porTipo('notificacao_a') + porTipo('notificacao_b') + porTipo('notificacao_b2')} detalhe="Amarelas e azuis" />
        <Indicador titulo="Controle especial" icone="nota" valor={porTipo('controle_especial') + porTipo('notificacao_especial')} detalhe="Receitas em 2 vias e especiais" />
        <Indicador titulo="Antimicrobianos" icone="nota" valor={porTipo('antimicrobiano')} detalhe="Validade de 10 dias" />
      </div>
      <div className="mt-4 cartao overflow-hidden">
        <div className="border-b border-papel-200 p-3 dark:border-noite-700"><Periodo valor={periodo} onMudar={setPeriodo} /></div>
        {lista === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : lista.length === 0 ? (
          <Vazio icone="nota" titulo="Nenhuma receita no período" texto="Ao vender um medicamento controlado, o caixa pede os dados da receita e eles ficam registrados aqui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Data</th><th>Tipo</th><th>Prescritor</th><th>Paciente</th><th>Comprador</th><th>Medicamentos</th><th>Venda</th></tr></thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.id} onClick={() => setDetalhe(r)} className="cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40">
                    <td className="num whitespace-nowrap">{dataHora(r.criado_em)}</td>
                    <td>{nomeTipoReceita(r.tipo).split(' (')[0]}{r.numero && <span className="block text-xs text-tinta-400">nº {r.numero}</span>}</td>
                    <td>{r.prescritor_nome}<span className="block text-xs text-tinta-400">{r.prescritor_conselho} {r.prescritor_numero}/{r.prescritor_uf}</span></td>
                    <td>{r.paciente_nome}</td>
                    <td>{r.comprador_nome}</td>
                    <td>{(r.itens ?? []).map((i) => `${qtd(i.quantidade)} × ${i.produto?.descricao}`).join(', ')}</td>
                    <td>{r.venda?.status === 'cancelada' ? <Etiqueta>Cancelada</Etiqueta> : <span className="num">nº {r.venda?.numero}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <TelaSuspensa aberta={!!detalhe} titulo={detalhe ? nomeTipoReceita(detalhe.tipo) : ''} subtitulo={detalhe ? `Venda nº ${detalhe.venda?.numero}, ${dataHora(detalhe.criado_em)}` : ''} onFechar={() => setDetalhe(null)} largura="max-w-2xl"
        rodape={<Botao variante="secundario" onClick={() => setDetalhe(null)}>Fechar</Botao>}>
        {detalhe && (
          <dl className="grid gap-x-6 gap-y-3 text-[0.95rem] sm:grid-cols-2">
            {[['Número', detalhe.numero || '—'], ['Data da receita', dataBR(detalhe.data_emissao)],
              ['Prescritor', `${detalhe.prescritor_nome} (${detalhe.prescritor_conselho} ${detalhe.prescritor_numero}/${detalhe.prescritor_uf})`],
              ['Paciente', `${detalhe.paciente_nome}${detalhe.paciente_idade ? `, ${detalhe.paciente_idade} anos` : ''}${detalhe.paciente_sexo ? `, sexo ${detalhe.paciente_sexo}` : ''}`],
              ['Comprador', detalhe.comprador_nome], ['Documento', `${detalhe.comprador_documento}${detalhe.comprador_orgao ? ` ${detalhe.comprador_orgao}` : ''}`],
              ['Endereço', detalhe.comprador_endereco || '—'], ['Telefone', detalhe.comprador_telefone || '—']].map(([r, v]) => (
              <div key={r}><dt className="text-xs text-tinta-400">{r}</dt><dd>{v}</dd></div>
            ))}
            <div className="sm:col-span-2">
              <dt className="text-xs text-tinta-400">Medicamentos dispensados</dt>
              {(detalhe.itens ?? []).map((i, k) => <dd key={k}>{qtd(i.quantidade)} × {i.produto?.descricao}{i.lote ? `, lote ${i.lote.numero} (val. ${dataBR(i.lote.validade)})` : ''}</dd>)}
            </div>
          </dl>
        )}
      </TelaSuspensa>
    </>
  )
}

function Livro() {
  const avisar = useAviso()
  const [periodo, setPeriodo] = useState(mesAtual())
  const [produtos, setProdutos] = useState([])
  const [produto, setProduto] = useState(null)
  const [dados, setDados] = useState(null)
  useEffect(() => {
    supabase.from('produtos').select('id, descricao').eq('controlado', true).order('descricao').then(({ data }) => setProdutos(data ?? []))
  }, [])
  useEffect(() => {
    setDados(null)
    supabase.rpc('livro_controlados', { p_inicio: periodo[0], p_fim: periodo[1], p_produto: produto }).then(({ data, error }) => {
      if (error) avisar(mensagemErro(error), 'erro')
      setDados(data ?? [])
    })
  }, [periodo, produto]) // eslint-disable-line react-hooks/exhaustive-deps
  const comMov = (dados ?? []).filter((p) => p.movimentos.length || Number(p.inicial))
  const exportar = () => baixarCsv(`livro-controlados-${periodo[0]}-${periodo[1]}.csv`,
    ['Medicamento', 'Lista', 'Registro', 'Data', 'Histórico', 'Documento', 'Lote', 'Validade', 'Entrada', 'Saída', 'Saldo'],
    comMov.flatMap((p) => [[p.descricao, p.lista, p.registro_ms, dataBR(periodo[0]), 'Saldo anterior', '', '', '', '', '', qtd(p.inicial)],
      ...p.movimentos.map((m) => [p.descricao, p.lista, p.registro_ms, dataHora(m.data), TIPOS_MOV[m.tipo] ?? m.tipo, m.documento, m.lote, dataBR(m.validade),
        m.quantidade > 0 ? qtd(m.quantidade) : '', m.quantidade < 0 ? qtd(-m.quantidade) : '', qtd(m.saldo)])]))
  return (
    <>
      <Periodo valor={periodo} onMudar={setPeriodo}>
        <div className="w-72"><Campo rotulo="Medicamento"><Lista valor={produto} opcoes={[{ valor: null, texto: 'Todos os controlados' }, ...produtos.map((p) => ({ valor: p.id, texto: p.descricao }))]} onMudar={setProduto} /></Campo></div>
        <Botao variante="secundario" icone="nota" onClick={exportar} disabled={!comMov.length}>Exportar planilha</Botao>
        <Botao variante="secundario" icone="impressora" onClick={() => window.print()} disabled={!comMov.length}>Imprimir</Botao>
      </Periodo>
      {dados === null ? <p className="text-sm text-tinta-400">Carregando…</p> : comMov.length === 0 ? (
        <div className="cartao"><Vazio icone="nota" titulo="Sem movimento no período" texto="Cadastre os controlados marcando o produto e a lista da Portaria 344 na tela Produtos." /></div>
      ) : comMov.map((p) => (
        <div key={p.produto_id} className="cartao mb-4 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-papel-200 px-4 py-3 dark:border-noite-700">
            <p className="font-semibold">{p.descricao} {p.lista && <Etiqueta tom="critico">Lista {p.lista}</Etiqueta>}</p>
            <p className="text-sm text-tinta-400">Registro {p.registro_ms || 'não informado'} · saldo anterior <strong className="num">{qtd(p.inicial)}</strong> {p.unidade}</p>
          </div>
          {p.movimentos.length === 0 ? <p className="p-4 text-sm text-tinta-400">Sem movimento no período.</p> : (
            <div className="overflow-x-auto">
              <table className="tabela w-full text-[0.9rem]">
                <thead><tr><th>Data</th><th>Histórico</th><th>Documento</th><th>Lote</th><th className="text-right">Entrada</th><th className="text-right">Saída</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {p.movimentos.map((m, k) => (
                    <tr key={k}>
                      <td className="num whitespace-nowrap">{dataHora(m.data)}</td>
                      <td>{TIPOS_MOV[m.tipo] ?? m.tipo}</td>
                      <td className="max-w-md">{m.documento}</td>
                      <td>{m.lote ? <>{m.lote}<span className="block text-xs text-tinta-400">val. {dataBR(m.validade)}</span></> : '—'}</td>
                      <td className="num text-right">{m.quantidade > 0 ? qtd(m.quantidade) : ''}</td>
                      <td className="num text-right">{m.quantidade < 0 ? qtd(-m.quantidade) : ''}</td>
                      <td className="num text-right font-semibold">{qtd(m.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

function Balanco() {
  const avisar = useAviso()
  const [periodo, setPeriodo] = useState(trimestre())
  const [dados, setDados] = useState(null)
  useEffect(() => {
    setDados(null)
    supabase.rpc('balanco_controlados', { p_inicio: periodo[0], p_fim: periodo[1] }).then(({ data, error }) => {
      if (error) avisar(mensagemErro(error), 'erro')
      setDados(data ?? [])
    })
  }, [periodo]) // eslint-disable-line react-hooks/exhaustive-deps
  const linhas = useMemo(() => (dados ?? []).filter((x) => Number(x.inicial) || Number(x.entradas) || Number(x.saidas) || Number(x.perdas) || Number(x.ajustes) || Number(x.final)), [dados])
  const divergentes = linhas.filter((x) => Math.abs(Number(x.inicial) + Number(x.entradas) - Number(x.saidas) - Number(x.perdas) + Number(x.ajustes) - Number(x.final)) > 0.0005)
  const exportar = () => baixarCsv(`balanco-controlados-${periodo[0]}-${periodo[1]}.csv`,
    ['Medicamento', 'Lista', 'Registro', 'Estoque inicial', 'Entradas', 'Saídas', 'Perdas', 'Ajustes', 'Estoque final'],
    linhas.map((x) => [x.descricao, x.lista, x.registro_ms, qtd(x.inicial), qtd(x.entradas), qtd(x.saidas), qtd(x.perdas), qtd(x.ajustes), qtd(x.final)]))
  return (
    <>
      <Periodo valor={periodo} onMudar={setPeriodo}>
        <Botao variante="secundario" icone="nota" onClick={exportar} disabled={!linhas.length}>Exportar planilha</Botao>
        <Botao variante="secundario" icone="impressora" onClick={() => window.print()} disabled={!linhas.length}>Imprimir</Botao>
      </Periodo>
      <div className="cartao overflow-hidden">
        {dados === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : linhas.length === 0 ? (
          <Vazio icone="nota" titulo="Nenhum controlado com estoque ou movimento" texto="O balanço lista, por medicamento, o estoque inicial, as entradas, saídas, perdas e o estoque final do período." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead><tr><th>Medicamento</th><th>Lista</th><th className="text-right">Inicial</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th><th className="text-right">Perdas</th><th className="text-right">Ajustes</th><th className="text-right">Final</th></tr></thead>
              <tbody>
                {linhas.map((x, k) => (
                  <tr key={k}>
                    <td className="font-medium">{x.descricao}<span className="block text-xs font-normal text-tinta-400">Registro {x.registro_ms || 'não informado'}</span></td>
                    <td>{x.lista ?? '—'}</td>
                    <td className="num text-right">{qtd(x.inicial)}</td>
                    <td className="num text-right">{qtd(x.entradas)}</td>
                    <td className="num text-right">{qtd(x.saidas)}</td>
                    <td className="num text-right">{Number(x.perdas) ? qtd(x.perdas) : '—'}</td>
                    <td className="num text-right">{Number(x.ajustes) ? qtd(x.ajustes) : '—'}</td>
                    <td className="num text-right font-semibold">{qtd(x.final)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {divergentes.length > 0 && <p className="mt-2 text-sm text-ambar-600 dark:text-ambar-300">{divergentes.length} medicamento(s) com movimentos de outro tipo (por exemplo, transferências) no período; confira no livro de registro.</p>}
    </>
  )
}
