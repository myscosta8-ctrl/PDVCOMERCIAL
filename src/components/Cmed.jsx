import { useEffect, useRef, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro, dataHora, lerNumero } from '../lib/formato.js'
import { lerPlanilha } from '../lib/planilha.js'
import { interpretarCmed } from '../lib/cmed.js'
import { Botao, Campo, Confirmacao, Etiqueta, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from './ui.jsx'

// Tabela de preços máximos de medicamentos (CMED/ANVISA): importação, conferência e ajuste de preços
export function TabelaCmed() {
  const avisar = useAviso()
  const arquivo = useRef(null)
  const [conf, setConf] = useState(null)
  const [leitura, setLeitura] = useState(null) // { tabela, coluna, nome }
  const [progresso, setProgresso] = useState(null)
  const [limitar, setLimitar] = useState(false)
  const [igualar, setIgualar] = useState(null)
  const [enviando, setEnviando] = useState(false)

  const conferir = async () => {
    const { data, error } = await supabase.rpc('conferir_cmed')
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    setConf(data)
  }
  useEffect(() => { conferir() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ler = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setEnviando(true)
    try {
      const tabela = interpretarCmed(await lerPlanilha(f))
      if (!tabela.colunas.length) throw new Error('A planilha não tem colunas de PMC.')
      setLeitura({ tabela, nome: f.name, coluna: tabela.colunas.includes(conf?.coluna) ? conf.coluna : null })
    } catch (err) { avisar(err.message || 'Não foi possível ler a planilha.', 'erro') }
    setEnviando(false)
  }

  const importar = async () => {
    if (!leitura.coluna) { avisar('Escolha a coluna do PMC da alíquota de ICMS do seu estado.', 'erro'); return }
    let registros
    try { registros = leitura.tabela.registros(leitura.coluna) } catch (err) { avisar(err.message, 'erro'); return }
    if (!registros.length) { avisar('Nenhum medicamento com código de barras na planilha.', 'erro'); return }
    setEnviando(true)
    for (let k = 0; k < registros.length; k += 1000) {
      setProgresso(Math.round((k / registros.length) * 100))
      const { error } = await supabase.rpc('importar_cmed', { p_linhas: registros.slice(k, k + 1000), p_coluna: leitura.coluna, p_reiniciar: k === 0 })
      if (error) { setEnviando(false); setProgresso(null); avisar(mensagemErro(error), 'erro'); return }
    }
    setProgresso(null); setEnviando(false); setLeitura(null)
    avisar(`${registros.length.toLocaleString('pt-BR')} apresentações importadas.`)
    conferir()
  }

  const aplicar = async (acao, desconto = 0) => {
    setEnviando(true)
    const { data, error } = await supabase.rpc('aplicar_cmed', { p_acao: acao, p_desconto: desconto })
    setEnviando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(`${data} preço(s) atualizado(s).`); setLimitar(false); setIgualar(null); conferir()
  }

  const acima = conf?.acima ?? []
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Apresentações na tabela" icone="nota" valor={(conf?.tabela ?? 0).toLocaleString('pt-BR')} detalhe={conf?.atualizada_em ? `Importada em ${dataHora(conf.atualizada_em)}` : 'Ainda não importada'} />
        <Indicador titulo="Produtos com PMC" icone="produtos" valor={conf?.ligados ?? 0} detalhe={conf?.coluna ? `Coluna ${conf.coluna}` : 'Ligados pelo código de barras'} />
        <Indicador titulo="Acima do PMC" icone="alerta" tom={acima.length ? 'critico' : 'positivo'} valor={acima.length} detalhe="Venda acima do PMC é proibida" />
        <Indicador titulo="Medicamentos sem PMC" icone="busca" tom={conf?.sem_ean_medicamento ? 'alerta' : 'neutro'} valor={conf?.sem_ean_medicamento ?? 0} detalhe="Com registro, mas sem código na tabela" />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-papel-200 px-4 py-3 dark:border-noite-700">
          <div><p className="font-semibold">Preço máximo ao consumidor</p><p className="text-sm text-tinta-400">Baixe a lista de preços de medicamentos (PMC) no portal da ANVISA, em XLSX ou CSV, e importe aqui todo mês.</p></div>
          <div className="flex gap-2">
            <input ref={arquivo} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={ler} />
            {acima.length > 0 && <Botao variante="secundario" onClick={() => setLimitar(true)}>Ajustar {acima.length} ao PMC</Botao>}
            {(conf?.ligados ?? 0) > 0 && <Botao variante="secundario" onClick={() => setIgualar({ desconto: '' })}>Praticar PMC com desconto</Botao>}
            <Botao icone="nota" onClick={() => arquivo.current?.click()} carregando={enviando && !leitura}>Importar planilha da CMED</Botao>
          </div>
        </div>
        {!conf ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : !conf.tabela ? (
          <Vazio icone="nota" titulo="Tabela ainda não importada" texto="Com a tabela, o sistema liga cada medicamento ao seu PMC pelo código de barras, preenche o registro na ANVISA e aponta preços acima do permitido." />
        ) : acima.length === 0 ? (
          <Vazio icone="ok" titulo="Nenhum preço acima do PMC" texto={`${conf.ligados} produto(s) com PMC, ${conf.abaixo} vendido(s) abaixo do teto.`} />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Produto</th><th>Código de barras</th><th className="text-right">Preço atual</th><th className="text-right">PMC</th><th className="text-right">Acima</th></tr></thead>
              <tbody>
                {acima.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.descricao}</td>
                    <td className="num text-tinta-400">{p.ean}</td>
                    <td className="num text-right">{dinheiro(p.preco_venda)}</td>
                    <td className="num text-right">{dinheiro(p.pmc)}</td>
                    <td className="num text-right"><Etiqueta tom="critico">+{dinheiro(p.preco_venda - p.pmc)}</Etiqueta></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TelaSuspensa aberta={!!leitura} titulo="Importar tabela da CMED" subtitulo={leitura?.nome} onFechar={() => !enviando && setLeitura(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setLeitura(null)} disabled={enviando}>Cancelar</Botao>
          <Botao onClick={importar} carregando={enviando}>{progresso != null ? `Importando ${progresso}%` : 'Importar'}</Botao>
        </>}>
        {leitura && (
          <div className="space-y-3">
            <Campo rotulo="Coluna do PMC" ajuda="Use a alíquota interna de ICMS do seu estado para medicamentos (o contador confirma)">
              <Lista valor={leitura.coluna} opcoes={leitura.tabela.colunas.map((c) => ({ valor: c, texto: c }))} onMudar={(v) => setLeitura((l) => ({ ...l, coluna: v }))} />
            </Campo>
            <p className="text-sm text-tinta-400">A importação substitui a tabela anterior. Os preços de venda só mudam quando você usar os botões de ajuste.</p>
          </div>
        )}
      </TelaSuspensa>
      <Confirmacao aberta={limitar} titulo="Ajustar preços ao PMC" mensagem={`${acima.length} produto(s) passam a custar exatamente o PMC. Os demais não mudam.`} textoConfirmar="Ajustar preços" carregando={enviando} onCancelar={() => setLimitar(false)} onConfirmar={() => aplicar('limitar')} />
      <TelaSuspensa aberta={!!igualar} titulo="Praticar o PMC com desconto" subtitulo={`Todos os ${conf?.ligados ?? 0} produto(s) com PMC passam a custar o PMC menos o desconto`} onFechar={() => setIgualar(null)}
        rodape={<>
          <Botao variante="secundario" onClick={() => setIgualar(null)}>Cancelar</Botao>
          <Botao onClick={() => { const d = igualar.desconto === '' ? 0 : lerNumero(igualar.desconto); if (Number.isNaN(d) || d < 0 || d >= 100) { avisar('Desconto inválido.', 'erro'); return } aplicar('igualar', d) }} carregando={enviando}>Atualizar preços</Botao>
        </>}>
        {igualar && <Campo rotulo="Desconto sobre o PMC (%)" ajuda="0 = vender pelo PMC"><input className="campo num" inputMode="decimal" value={igualar.desconto} onChange={(e) => setIgualar({ desconto: e.target.value })} placeholder="0" autoFocus /></Campo>}
      </TelaSuspensa>
    </>
  )
}
