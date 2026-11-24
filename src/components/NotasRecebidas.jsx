import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { chamarNfce } from '../lib/nfce.js'
import { dinheiro, dataHora } from '../lib/formato.js'
import { Botao, Campo, Etiqueta, Icone, Lista, TelaSuspensa, Vazio, useAviso } from './ui.jsx'

const formatarCnpj = (c) => String(c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
const chaveFormatada = (c) => String(c || '').replace(/(\d{4})/g, '$1 ').trim()

export const TEXTO_MANIFESTACAO = {
  ciencia: 'Ciência da operação', confirmada: 'Operação confirmada', desconhecida: 'Operação desconhecida', nao_realizada: 'Operação não realizada',
}
const TOM_MANIFESTACAO = { ciencia: 'neutro', confirmada: 'positivo', desconhecida: 'critico', nao_realizada: 'alerta' }
const FILTROS = [
  { valor: 'todas', texto: 'Todas as notas' }, { valor: 'pendentes', texto: 'Sem manifestação' },
  { valor: 'ciencia', texto: 'Com ciência, sem conclusão' }, { valor: 'a_lancar', texto: 'Confirmadas e não lançadas' },
  { valor: 'canceladas', texto: 'Canceladas pelo emitente' },
]

function Situacao({ nota }) {
  if (nota.situacao === 3) return <Etiqueta tom="critico">Cancelada</Etiqueta>
  if (nota.situacao === 2) return <Etiqueta tom="critico">Denegada</Etiqueta>
  return <Etiqueta tom="positivo">Autorizada</Etiqueta>
}

// Notas fiscais emitidas por fornecedores contra o CNPJ da empresa, trazidas da SEFAZ (Ambiente Nacional)
export function JanelaNotasRecebidas({ aberta, onFechar, onLancar }) {
  const avisar = useAviso()
  const [notas, setNotas] = useState(null)
  const [lancadas, setLancadas] = useState(new Set())
  const [empresa, setEmpresa] = useState(null)
  const [filtro, setFiltro] = useState('todas')
  const [buscando, setBuscando] = useState(false)
  const [aberta2, setAberta2] = useState(null)

  const carregar = async () => {
    const [{ data, error }, { data: ent }, { data: emp }] = await Promise.all([
      supabase.from('nfe_recebidas').select('id, chave, cnpj_emitente, nome_emitente, emissao, valor, situacao, protocolo, resumo, manifestacao, manifestada_em').order('emissao', { ascending: false }).limit(500),
      supabase.from('notas_entrada').select('chave').limit(2000),
      supabase.from('empresas').select('dfe_consultado_em, dfe_liberado_em, dfe_ult_nsu, dfe_max_nsu').single(),
    ])
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setNotas(data)
    setLancadas(new Set((ent ?? []).map((n) => n.chave)))
    setEmpresa(emp)
  }
  useEffect(() => { if (aberta) carregar() }, [aberta]) // eslint-disable-line react-hooks/exhaustive-deps

  const buscar = async () => {
    setBuscando(true)
    const { dados, erro } = await chamarNfce({ acao: 'dfe_buscar' })
    setBuscando(false)
    if (erro) { avisar(erro, 'erro'); return }
    avisar(dados.novas ? `${dados.novas} nota(s) nova(s) encontrada(s).` : (dados.aviso || 'Nenhuma nota nova.'))
    carregar()
  }

  const visiveis = (notas ?? []).filter((n) => ({
    todas: true, pendentes: !n.manifestacao && n.situacao === 1, ciencia: n.manifestacao === 'ciencia',
    a_lancar: n.manifestacao === 'confirmada' && !lancadas.has(n.chave), canceladas: n.situacao === 3,
  }[filtro]))
  const liberado = empresa?.dfe_liberado_em && new Date(empresa.dfe_liberado_em) > new Date() ? new Date(empresa.dfe_liberado_em) : null

  return (
    <TelaSuspensa aberta={aberta} onFechar={onFechar} largura="max-w-5xl" titulo="Notas emitidas para o seu CNPJ"
      subtitulo="Trazidas da SEFAZ: confira, manifeste e lance a entrada sem precisar do arquivo do fornecedor"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
        <Botao icone="busca" onClick={buscar} carregando={buscando} disabled={!!liberado}>{liberado ? `Nova busca às ${liberado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Buscar na SEFAZ'}</Botao>
      </>}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-tinta-400">
          {empresa?.dfe_consultado_em ? `Última busca: ${dataHora(empresa.dfe_consultado_em)}.` : 'Nenhuma busca feita ainda.'}
          {' '}A SEFAZ guarda as notas dos últimos 3 meses e permite uma nova busca a cada hora quando não há novidades.
        </p>
        <div className="w-64"><Lista valor={filtro} opcoes={FILTROS} onMudar={setFiltro} /></div>
      </div>
      {notas === null ? <p className="text-sm text-tinta-400">Carregando…</p> : visiveis.length === 0 ? (
        <Vazio icone="nota" titulo={notas.length ? 'Nenhuma nota neste filtro' : 'Nenhuma nota ainda'}
          texto={notas.length ? 'Escolha outro filtro.' : 'Clique em Buscar na SEFAZ para trazer as notas que os fornecedores emitiram para o seu CNPJ.'} />
      ) : (
        <div className="max-h-[55vh] overflow-auto rounded-xl border border-papel-200 dark:border-noite-700">
          <table className="tabela w-full text-[0.95rem]">
            <thead><tr><th>Emissão</th><th>Emitente</th><th className="text-right">Valor</th><th>Situação</th><th>Manifestação</th><th></th></tr></thead>
            <tbody>
              {visiveis.map((n) => (
                <tr key={n.id} className="cursor-pointer" onClick={() => setAberta2(n)}>
                  <td className="whitespace-nowrap">{n.emissao ? new Date(n.emissao).toLocaleDateString('pt-BR') : ''}</td>
                  <td><span className="block font-medium">{n.nome_emitente}</span><span className="text-xs text-tinta-400">{formatarCnpj(n.cnpj_emitente)}</span></td>
                  <td className="num text-right">{dinheiro(n.valor)}</td>
                  <td><Situacao nota={n} /></td>
                  <td>{n.manifestacao ? <Etiqueta tom={TOM_MANIFESTACAO[n.manifestacao]}>{TEXTO_MANIFESTACAO[n.manifestacao]}</Etiqueta> : <span className="text-sm text-tinta-400">Pendente</span>}</td>
                  <td className="text-right">{lancadas.has(n.chave) ? <Etiqueta tom="positivo"><Icone nome="ok" className="h-3.5 w-3.5" />Lançada</Etiqueta> : <Icone nome="mais" className="ml-auto h-4 w-4 text-tinta-400" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DetalheRecebida nota={aberta2} lancada={aberta2 && lancadas.has(aberta2.chave)} onFechar={() => setAberta2(null)}
        onMudou={(n) => { setAberta2(n); carregar() }} onLancar={(xml) => { setAberta2(null); onLancar(xml) }} />
    </TelaSuspensa>
  )
}

function DetalheRecebida({ nota, lancada, onFechar, onMudou, onLancar }) {
  const avisar = useAviso()
  const [fazendo, setFazendo] = useState('')
  const [pedirJust, setPedirJust] = useState(false)
  const [just, setJust] = useState('')
  useEffect(() => { setPedirJust(false); setJust('') }, [nota?.id])
  if (!nota) return null

  const manifestar = async (tipo) => {
    setFazendo(tipo)
    const { dados, erro } = await chamarNfce({ acao: 'dfe_manifestar', chave: nota.chave, tipo, justificativa: tipo === 'nao_realizada' ? just : undefined })
    setFazendo('')
    if (erro) { avisar(erro, 'erro'); return }
    avisar(`${TEXTO_MANIFESTACAO[tipo]} registrada na SEFAZ.`)
    setPedirJust(false)
    onMudou(dados)
  }

  const lancar = async () => {
    setFazendo('lancar')
    let xml = null
    const { data } = await supabase.from('nfe_recebidas').select('xml').eq('id', nota.id).single()
    xml = data?.xml
    if (!xml) {
      const { dados, erro } = await chamarNfce({ acao: 'dfe_baixar', chave: nota.chave })
      if (erro) { setFazendo(''); avisar(erro, 'erro'); return }
      xml = dados.xml
    }
    setFazendo('')
    onLancar(xml)
  }

  const conclusiva = nota.manifestacao && nota.manifestacao !== 'ciencia'
  const ativa = nota.situacao === 1

  return (
    <TelaSuspensa aberta onFechar={onFechar} largura="max-w-3xl" titulo={nota.nome_emitente || 'Nota recebida'}
      subtitulo={`${formatarCnpj(nota.cnpj_emitente)}${nota.emissao ? `, emitida em ${dataHora(nota.emissao)}` : ''}`}
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Fechar</Botao>
        {ativa && !conclusiva && !nota.manifestacao && <Botao variante="secundario" onClick={() => manifestar('ciencia')} carregando={fazendo === 'ciencia'}>Dar ciência</Botao>}
        {ativa && !conclusiva && <Botao variante="secundario" onClick={() => manifestar('desconhecida')} carregando={fazendo === 'desconhecida'}>Desconhecer</Botao>}
        {ativa && !conclusiva && <Botao variante="secundario" onClick={() => setPedirJust(true)}>Não realizada</Botao>}
        {ativa && !conclusiva && <Botao onClick={() => manifestar('confirmada')} carregando={fazendo === 'confirmada'}>Confirmar operação</Botao>}
        {ativa && !lancada && (nota.manifestacao === 'confirmada' || nota.manifestacao === 'ciencia') && <Botao icone="nota" onClick={lancar} carregando={fazendo === 'lancar'}>Lançar entrada</Botao>}
      </>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Situacao nota={nota} />
        {nota.manifestacao ? <Etiqueta tom={TOM_MANIFESTACAO[nota.manifestacao]}>{TEXTO_MANIFESTACAO[nota.manifestacao]}</Etiqueta> : <Etiqueta tom="alerta">Sem manifestação</Etiqueta>}
        {lancada && <Etiqueta tom="positivo">Entrada lançada</Etiqueta>}
        <span className="ml-auto text-2xl font-bold">{dinheiro(nota.valor)}</span>
      </div>
      <p className="mb-3 rounded-xl bg-papel-100 px-3 py-2 font-mono text-sm dark:bg-noite-800">{chaveFormatada(nota.chave)}</p>
      <ul className="space-y-1.5 text-sm text-tinta-500 dark:text-tinta-300">
        {nota.situacao === 3 && <li className="text-rubro-600 dark:text-rubro-300">O fornecedor cancelou esta nota. Não lance a entrada.</li>}
        {!nota.manifestacao && ativa && <li>Dê ciência para liberar o XML completo, ou já confirme se a mercadoria chegou.</li>}
        {nota.manifestacao === 'ciencia' && <li>A ciência não encerra a nota: confirme, desconheça ou informe operação não realizada em até 180 dias da emissão.</li>}
        {nota.manifestada_em && <li>Manifestada em {dataHora(nota.manifestada_em)}.</li>}
        {nota.protocolo && <li>Protocolo de autorização: {nota.protocolo}.</li>}
      </ul>
      {pedirJust && (
        <div className="mt-4 space-y-3 rounded-xl border border-papel-200 p-3 dark:border-noite-700">
          <Campo rotulo="Por que a operação não foi realizada?" ajuda="Pelo menos 15 letras. Vai para a SEFAZ.">
            <textarea className="campo min-h-[5rem]" value={just} onChange={(e) => setJust(e.target.value)} />
          </Campo>
          <div className="flex justify-end gap-2">
            <Botao variante="secundario" onClick={() => setPedirJust(false)}>Cancelar</Botao>
            <Botao variante="perigo" onClick={() => manifestar('nao_realizada')} carregando={fazendo === 'nao_realizada'}>Registrar não realizada</Botao>
          </div>
        </div>
      )}
    </TelaSuspensa>
  )
}
