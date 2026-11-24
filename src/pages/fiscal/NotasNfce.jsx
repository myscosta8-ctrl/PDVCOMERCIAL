import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../../lib/supabase.js'
import { chamarNfce, imprimirDanfe } from '../../lib/nfce.js'
import { dinheiro, dataHora } from '../../lib/formato.js'
import { Botao, Campo, Etiqueta, Icone, Indicador, TelaSuspensa, Vazio, useAviso } from '../../components/ui.jsx'

const horasDesde = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000

// Contingência, números para inutilizar, inutilizações feitas e notas canceladas
export function NotasNfce({ empresa }) {
  const avisar = useAviso()
  const [pendentes, setPendentes] = useState(null)
  const [faixas, setFaixas] = useState(null)
  const [inutilizadas, setInutilizadas] = useState([])
  const [canceladas, setCanceladas] = useState([])
  const [transmitindo, setTransmitindo] = useState(false)
  const [inutilizar, setInutilizar] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const nfceAtiva = Boolean(empresa.certificado_titular)

  const carregar = async () => {
    const [p, f, i, c] = await Promise.all([
      supabase.from('nfce_documentos').select('id, venda_id, numero, serie, status, motivo, codigo_status, dh_contingencia, emitida_em, criado_em, chave, venda:vendas(numero, total)')
        .in('status', ['contingencia', 'pendente']).order('numero'),
      supabase.rpc('numeros_nfce_sem_nota'),
      supabase.from('nfce_inutilizacoes').select('*').order('criado_em', { ascending: false }).limit(20),
      supabase.from('nfce_documentos').select('id, numero, serie, cancelada_em, protocolo_cancelamento, justificativa_cancelamento, venda:vendas(numero, total)')
        .eq('status', 'cancelada').order('cancelada_em', { ascending: false }).limit(20),
    ])
    if (f.error) avisar(mensagemErro(f.error), 'erro')
    setPendentes(p.data ?? []); setFaixas(f.data ?? { faixas: [] }); setInutilizadas(i.data ?? []); setCanceladas(c.data ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const transmitir = async () => {
    setTransmitindo(true)
    const r = await chamarNfce({ acao: 'transmitir' })
    setTransmitindo(false)
    if (r.erro) { avisar(r.erro, 'erro'); return }
    const d = r.dados
    avisar(d.sem_comunicacao ? 'A SEFAZ continua sem responder. As notas seguem em contingência.' : `${d.autorizadas} autorizada(s), ${d.rejeitadas} rejeitada(s).`, d.sem_comunicacao || d.rejeitadas ? 'erro' : undefined)
    for (const m of d.mensagens ?? []) avisar(m, 'erro')
    window.dispatchEvent(new Event('nfce:atualizar'))
    carregar()
  }

  const confirmarInutilizacao = async () => {
    setEnviando(true)
    const r = await chamarNfce({ acao: 'inutilizar', serie: faixas.serie, inicio: Number(inutilizar.inicio), fim: Number(inutilizar.fim), justificativa: inutilizar.justificativa })
    setEnviando(false)
    if (r.erro) { avisar(r.erro, 'erro'); return }
    avisar(`Números ${inutilizar.inicio} a ${inutilizar.fim} inutilizados. Protocolo ${r.dados.protocolo}.`)
    setInutilizar(null); carregar()
  }

  const contingencias = (pendentes ?? []).filter((d) => d.status === 'contingencia')
  const vencendo = contingencias.filter((d) => horasDesde(d.dh_contingencia ?? d.criado_em) > 20)
  const lista = faixas?.faixas ?? []
  const totalSemNota = lista.reduce((s, f) => s + f.qtd, 0)

  return (
    <div className="space-y-4">
      {!nfceAtiva && <p className="flex items-center gap-2 rounded-lg bg-ambar-50 px-3 py-2 text-sm text-ambar-600 dark:bg-ambar-600/20 dark:text-ambar-300"><Icone nome="alerta" className="h-4 w-4" />Configure e teste o certificado digital e o CSC em Configurações para transmitir, cancelar e inutilizar.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador titulo="Em contingência" icone="alerta" tom={vencendo.length ? 'critico' : contingencias.length ? 'alerta' : 'neutro'} valor={contingencias.length}
          detalhe={vencendo.length ? `${vencendo.length} perto do prazo de 24 horas` : 'Emitidas sem a SEFAZ, aguardando envio'} />
        <Indicador titulo="Números sem nota válida" icone="nota" tom={totalSemNota ? 'alerta' : 'neutro'} valor={totalSemNota} detalhe={`Série ${faixas?.serie ?? empresa.nfce_serie}, até o nº ${faixas?.ultimo ?? 0}`} />
        <Indicador titulo="Canceladas na SEFAZ" icone="fechar" valor={canceladas.length} detalhe="Últimas 20" />
      </div>

      <div className="cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <div className="mr-auto"><p className="font-semibold">Contingência e notas sem resposta</p>
            <p className="text-sm text-tinta-400">O sistema transmite sozinho a cada 5 minutos e quando a internet volta. O prazo legal é de 24 horas após a emissão.</p></div>
          <Botao onClick={transmitir} carregando={transmitindo} disabled={!pendentes?.length || !nfceAtiva}>Transmitir agora</Botao>
        </div>
        {pendentes === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !pendentes.length ? (
          <Vazio icone="ok" titulo="Nada aguardando a SEFAZ" texto="Quando a SEFAZ não responder na hora da venda, a nota sai em contingência e aparece aqui até ser autorizada." />
        ) : (
          <table className="tabela w-full text-[0.95rem]">
            <thead><tr><th>NFC-e</th><th>Venda</th><th>Emitida</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {pendentes.map((d) => {
                const h = horasDesde(d.dh_contingencia ?? d.criado_em)
                return (
                  <tr key={d.id}>
                    <td className="font-semibold">Nº {d.numero}</td>
                    <td>Nº {d.venda?.numero} <span className="text-tinta-400">{dinheiro(d.venda?.total)}</span></td>
                    <td>{dataHora(d.dh_contingencia ?? d.criado_em)}</td>
                    <td>{d.status === 'contingencia'
                      ? <Etiqueta tom={h > 20 ? 'critico' : 'alerta'}>{h > 24 ? 'Prazo de 24 h vencido' : `Contingência, faltam ${Math.max(0, Math.floor(24 - h))} h`}</Etiqueta>
                      : <Etiqueta tom="alerta">Enviada, sem resposta</Etiqueta>}
                      {d.motivo && <span className="block text-xs text-tinta-400">{d.motivo}</span>}</td>
                    <td className="text-right">{d.status === 'contingencia' && <button className="text-sm font-medium text-caixa-600 hover:underline dark:text-caixa-300" onClick={async () => { const x = await imprimirDanfe(d.venda_id); if (x.erro) avisar(x.erro, 'erro') }}>DANFE</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="cartao overflow-hidden">
        <div className="border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <p className="font-semibold">Números para inutilizar</p>
          <p className="text-sm text-tinta-400">Números da série que foram usados ou pulados e não viraram nota válida. Todo número precisa terminar autorizado, cancelado ou inutilizado.</p>
        </div>
        {faixas === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !lista.length ? (
          <Vazio icone="ok" titulo="Numeração em dia" texto="Nenhum número sem nota válida nesta série." />
        ) : (
          <table className="tabela w-full text-[0.95rem]">
            <thead><tr><th>Números</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {lista.map((f) => (
                <tr key={`${f.inicio}-${f.situacao}`}>
                  <td className="font-semibold">{f.inicio === f.fim ? `Nº ${f.inicio}` : `Nº ${f.inicio} a ${f.fim}`} <span className="font-normal text-tinta-400">({f.qtd})</span></td>
                  <td>{f.situacao === 'rejeitada'
                    ? <>Rejeitada{f.venda_numero ? `, venda nº ${f.venda_numero}` : ''}{f.pode_reenviar && <span className="block text-xs text-tinta-400">Dá para reenviar pela tela Vendas; se não for reenviar, inutilize.</span>}</>
                    : 'Número sem nota'}</td>
                  <td className="text-right"><Botao variante="secundario" className="py-1" disabled={!nfceAtiva}
                    onClick={() => setInutilizar({ inicio: f.inicio, fim: f.fim, justificativa: f.situacao === 'rejeitada' ? 'Nota rejeitada pela SEFAZ e não reenviada' : 'Numeração não utilizada por falha no sistema emissor' })}>Inutilizar</Botao></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="cartao overflow-hidden">
          <p className="border-b border-papel-200 px-4 py-3 font-semibold dark:border-noite-700">Inutilizações feitas</p>
          {!inutilizadas.length ? <p className="p-4 text-sm text-tinta-400">Nenhuma ainda.</p> : (
            <ul className="divide-y divide-papel-200 text-[0.95rem] dark:divide-noite-700">
              {inutilizadas.map((i) => <li key={i.id} className="px-4 py-2"><span className="font-semibold">Nº {i.inicio === i.fim ? i.inicio : `${i.inicio} a ${i.fim}`}</span> <span className="text-tinta-400">série {i.serie}, {dataHora(i.criado_em)}, protocolo {i.protocolo}</span><span className="block text-sm text-tinta-400">{i.justificativa}</span></li>)}
            </ul>
          )}
        </div>
        <div className="cartao overflow-hidden">
          <p className="border-b border-papel-200 px-4 py-3 font-semibold dark:border-noite-700">Canceladas na SEFAZ</p>
          {!canceladas.length ? <p className="p-4 text-sm text-tinta-400">Nenhuma ainda. O cancelamento é feito na tela Vendas, no detalhe da venda.</p> : (
            <ul className="divide-y divide-papel-200 text-[0.95rem] dark:divide-noite-700">
              {canceladas.map((c) => <li key={c.id} className="px-4 py-2"><span className="font-semibold">NFC-e nº {c.numero}</span> <span className="text-tinta-400">venda nº {c.venda?.numero}, {dataHora(c.cancelada_em)}, protocolo {c.protocolo_cancelamento}</span><span className="block text-sm text-tinta-400">{c.justificativa_cancelamento}</span></li>)}
            </ul>
          )}
        </div>
      </div>

      <TelaSuspensa aberta={!!inutilizar} titulo="Inutilizar numeração" subtitulo="Comunica à SEFAZ que estes números não serão usados. Não dá para desfazer." onFechar={() => setInutilizar(null)}
        rodape={<><Botao variante="secundario" onClick={() => setInutilizar(null)}>Voltar</Botao>
          <Botao variante="perigo" onClick={confirmarInutilizacao} carregando={enviando} disabled={(inutilizar?.justificativa ?? '').trim().length < 15}>Inutilizar</Botao></>}>
        {inutilizar && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Do número"><input className="campo num" inputMode="numeric" value={inutilizar.inicio} onChange={(e) => setInutilizar((x) => ({ ...x, inicio: e.target.value.replace(/\D/g, '') }))} /></Campo>
              <Campo rotulo="Até o número"><input className="campo num" inputMode="numeric" value={inutilizar.fim} onChange={(e) => setInutilizar((x) => ({ ...x, fim: e.target.value.replace(/\D/g, '') }))} /></Campo>
            </div>
            <Campo rotulo="Justificativa" ajuda={`${inutilizar.justificativa.trim().length} de no mínimo 15 caracteres`}>
              <textarea className="campo" rows={2} maxLength={255} value={inutilizar.justificativa} onChange={(e) => setInutilizar((x) => ({ ...x, justificativa: e.target.value }))} />
            </Campo>
          </div>
        )}
      </TelaSuspensa>
    </div>
  )
}
