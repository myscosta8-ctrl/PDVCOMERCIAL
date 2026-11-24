import { useEffect, useMemo, useState } from 'react'
import { supabase, mensagemErro } from '../../lib/supabase.js'
import { dinheiro, lerNumero } from '../../lib/formato.js'
import { contaPorPalavra } from '../../lib/financeiro.js'
import { Botao, Campo, Confirmacao, Etiqueta, Indicador, Lista, TelaSuspensa, Vazio, useAviso } from '../../components/ui.jsx'
import { hojeISO, dataBR, reais, nomeMes, somaMes, MESES } from './comum.js'

const opcoesMeses = (de, ate, base) => Array.from({ length: ate - de + 1 }, (_, i) => { const m = somaMes(base, de + i); return { valor: m, texto: mesCurto(m) } })
const mesCurto = (m) => `${MESES[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
const DIAS = Array.from({ length: 31 }, (_, i) => ({ valor: i + 1, texto: `Dia ${i + 1}` }))

// Despesas que se repetem todo mês: a conta a pagar de cada mês é lançada sozinha
export function DespesasFixas({ cad, lancs, recarregarLancamentos }) {
  const avisar = useAviso()
  const [fixas, setFixas] = useState(null)
  const [form, setForm] = useState(null)
  const [apagar, setApagar] = useState(null)
  const [enviando, setEnviando] = useState(false)
  const [gerando, setGerando] = useState(false)
  const mesAtual = hojeISO().slice(0, 7)

  const carregar = async () => {
    const { data, error } = await supabase.from('despesas_fixas')
      .select('*, plano:plano_contas(codigo, nome), fornecedor:fornecedores(razao_social, nome_fantasia), centro:centros_custo(nome)')
      .order('dia_vencimento')
    if (error) avisar(mensagemErro(error), 'erro')
    setFixas(data ?? [])
  }
  useEffect(() => { carregar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Conta lançada no mês atual para cada fixa
  const doMes = useMemo(() => {
    const m = new Map()
    for (const l of lancs ?? []) if (l.despesa_fixa_id && l.competencia.slice(0, 7) === mesAtual) m.set(l.despesa_fixa_id, l)
    return m
  }, [lancs, mesAtual])

  const ativas = (fixas ?? []).filter((f) => f.ativo && (!f.fim || f.fim >= `${mesAtual}-01`))
  const totalMes = ativas.reduce((s, f) => s + Number(f.valor), 0)
  const pagasMes = ativas.filter((f) => doMes.get(f.id)?.status === 'pago')
  const planos = cad.planos.filter((p) => p.ativo && p.tipo === 'despesa')

  const novo = () => setForm({ descricao: '', plano_conta_id: null, centro_custo_id: cad.centros.find((c) => c.ativo)?.id ?? null, fornecedor_id: null,
    valor: '', valor_variavel: false, dia_vencimento: 10, inicio: mesAtual, fim: '', ativo: true, observacao: '' })
  const editar = (f) => setForm({ ...f, valor: reais(f.valor), inicio: f.inicio.slice(0, 7), fim: f.fim ? f.fim.slice(0, 7) : '', observacao: f.observacao ?? '' })
  const mudar = (c) => (e) => setForm((f) => ({ ...f, [c]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }))

  const salvar = async () => {
    const valor = lerNumero(form.valor)
    if (!form.descricao.trim()) { avisar('Informe a descrição.', 'erro'); return }
    if (!form.plano_conta_id) { avisar('Escolha a conta do plano de contas.', 'erro'); return }
    if (!(valor > 0)) { avisar('Informe um valor maior que zero.', 'erro'); return }
    if (form.fim && form.fim < form.inicio) { avisar('O último mês não pode ser antes do primeiro.', 'erro'); return }
    const dados = {
      descricao: form.descricao.trim(), plano_conta_id: form.plano_conta_id, centro_custo_id: form.centro_custo_id, fornecedor_id: form.fornecedor_id,
      valor, valor_variavel: form.valor_variavel, dia_vencimento: Number(form.dia_vencimento), inicio: `${form.inicio}-01`,
      fim: form.fim ? `${form.fim}-01` : null, ativo: form.ativo, observacao: form.observacao.trim() || null,
    }
    setEnviando(true)
    const r = form.id ? await supabase.from('despesas_fixas').update(dados).eq('id', form.id) : await supabase.from('despesas_fixas').insert(dados)
    if (r.error) { setEnviando(false); avisar(mensagemErro(r.error), 'erro'); return }
    // Já lança a conta deste mês, se ainda não existir
    const g = await supabase.rpc('gerar_despesas_fixas')
    setEnviando(false)
    avisar(g.data > 0 ? 'Despesa fixa salva e conta deste mês lançada.' : 'Despesa fixa salva.')
    setForm(null); carregar(); recarregarLancamentos()
  }

  const confirmarApagar = async () => {
    setEnviando(true)
    // Com contas já lançadas, só encerra (o histórico continua); sem contas, apaga
    const usada = (lancs ?? []).some((l) => l.despesa_fixa_id === apagar.id)
    const r = usada
      ? await supabase.from('despesas_fixas').update({ ativo: false }).eq('id', apagar.id)
      : await supabase.from('despesas_fixas').delete().eq('id', apagar.id)
    setEnviando(false)
    if (r.error) { avisar(mensagemErro(r.error), 'erro'); return }
    avisar(usada ? 'Despesa fixa encerrada. As contas já lançadas continuam.' : 'Despesa fixa apagada.')
    setApagar(null); setForm(null); carregar()
  }

  const gerarProximo = async () => {
    setGerando(true)
    const { data, error } = await supabase.rpc('gerar_despesas_fixas', { p_mes: `${somaMes(mesAtual, 1)}-01` })
    setGerando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar(data > 0 ? `${data} conta(s) lançada(s) para ${nomeMes(somaMes(mesAtual, 1))}.` : `As contas de ${nomeMes(somaMes(mesAtual, 1))} já estavam lançadas.`)
    recarregarLancamentos()
  }

  const nomeFornecedor = (f) => f.fornecedor?.nome_fantasia || f.fornecedor?.razao_social

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Indicador titulo="Despesas fixas por mês" icone="relogio" valor={dinheiro(totalMes)} detalhe={`${ativas.length} despesa(s) ativa(s)`} />
        <Indicador titulo={`Pagas em ${nomeMes(mesAtual)}`} icone="ok" tom="positivo" valor={`${pagasMes.length} de ${ativas.length}`} detalhe={dinheiro(pagasMes.reduce((s, f) => s + Number(doMes.get(f.id)?.valor ?? 0), 0))} />
        <Indicador titulo="Com valor variável" icone="alerta" tom={ativas.some((f) => f.valor_variavel) ? 'alerta' : 'neutro'} valor={ativas.filter((f) => f.valor_variavel).length} detalhe="Lançadas com valor estimado para conferir" />
      </div>

      <div className="mt-4 cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-papel-200 p-3 dark:border-noite-700">
          <p className="mr-auto text-sm text-tinta-400">A conta de cada mês é lançada sozinha ao abrir o Financeiro. Cancelar a conta de um mês não faz ela voltar.</p>
          <Botao variante="secundario" onClick={gerarProximo} carregando={gerando}>Lançar {nomeMes(somaMes(mesAtual, 1))}</Botao>
          <Botao icone="mais" onClick={novo}>Nova despesa fixa</Botao>
        </div>
        {fixas === null ? <p className="p-5 text-sm text-tinta-400">Carregando…</p> : fixas.length === 0 ? (
          <Vazio icone="relogio" titulo="Nenhuma despesa fixa" texto="Cadastre aluguel, energia, internet, salários, contador e sistemas. Todo mês a conta a pagar aparece sozinha, sem precisar lembrar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela w-full text-[0.95rem]">
              <thead className="bg-papel/70 dark:bg-noite/40"><tr><th>Vence</th><th>Descrição</th><th>Conta</th><th className="text-right">Valor</th><th>Neste mês</th></tr></thead>
              <tbody>
                {fixas.map((f) => {
                  const l = doMes.get(f.id)
                  const encerrada = !f.ativo || (f.fim && f.fim < `${mesAtual}-01`)
                  return (
                    <tr key={f.id} onClick={() => editar(f)} className={`cursor-pointer hover:bg-papel/60 dark:hover:bg-noite-700/40 ${encerrada ? 'opacity-60' : ''}`}>
                      <td className="num whitespace-nowrap">Dia {f.dia_vencimento}</td>
                      <td className="font-medium">{f.descricao}
                        <span className="block text-xs font-normal text-tinta-400">{[nomeFornecedor(f), f.centro?.nome, f.fim ? `até ${nomeMes(f.fim.slice(0, 7))}` : null].filter(Boolean).join(', ')}</span></td>
                      <td><span className="text-tinta-400">{f.plano?.codigo}</span> {f.plano?.nome}</td>
                      <td className="num text-right">{dinheiro(f.valor)}{f.valor_variavel && <span className="block text-xs text-tinta-400">estimado</span>}</td>
                      <td>{encerrada ? <Etiqueta>Encerrada</Etiqueta>
                        : !l ? <Etiqueta tom="alerta">Não lançada</Etiqueta>
                        : l.status === 'pago' ? <Etiqueta tom="positivo">Paga</Etiqueta>
                        : l.status === 'cancelado' ? <Etiqueta>Cancelada</Etiqueta>
                        : <Etiqueta tom={l.vencimento < hojeISO() ? 'critico' : 'neutro'}>{l.vencimento < hojeISO() ? 'Vencida' : `Vence ${dataBR(l.vencimento)}`}</Etiqueta>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TelaSuspensa aberta={!!form} titulo={form?.id ? 'Editar despesa fixa' : 'Nova despesa fixa'} subtitulo="Mudanças valem para os próximos meses; contas já lançadas não mudam" onFechar={() => setForm(null)} largura="max-w-2xl"
        rodape={form && <>
          {form.id && <Botao variante="secundario" className="mr-auto" onClick={() => setApagar(form)}>{(lancs ?? []).some((l) => l.despesa_fixa_id === form.id) ? 'Encerrar' : 'Apagar'}</Botao>}
          <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
          <Botao onClick={salvar} carregando={enviando}>Salvar</Botao>
        </>}>
        {form && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Descrição"><input className="campo" value={form.descricao} onChange={mudar('descricao')} autoFocus placeholder="Ex.: Aluguel da loja"
                onBlur={() => setForm((f) => (f.plano_conta_id ? f : { ...f, plano_conta_id: contaPorPalavra(f.descricao, cad.planos, 'pagar') }))} /></Campo>
              <Campo rotulo="Fornecedor (opcional)"><Lista valor={form.fornecedor_id} opcoes={[{ valor: null, texto: 'Nenhum' }, ...cad.fornecedores.map((f) => ({ valor: f.id, texto: f.nome_fantasia || f.razao_social }))]} onMudar={mudar('fornecedor_id')} /></Campo>
              <Campo rotulo="Plano de contas"><Lista valor={form.plano_conta_id} opcoes={planos.map((p) => ({ valor: p.id, texto: `${p.codigo} ${p.nome}` }))} onMudar={mudar('plano_conta_id')} /></Campo>
              <Campo rotulo="Centro de custo"><Lista valor={form.centro_custo_id} opcoes={[{ valor: null, texto: 'Nenhum' }, ...cad.centros.filter((c) => c.ativo).map((c) => ({ valor: c.id, texto: c.nome }))]} onMudar={mudar('centro_custo_id')} /></Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo rotulo="Valor"><input className="campo num" inputMode="decimal" value={form.valor} onChange={mudar('valor')} placeholder="0,00" /></Campo>
              <Campo rotulo="Vencimento"><Lista valor={Number(form.dia_vencimento)} opcoes={DIAS} onMudar={mudar('dia_vencimento')} /></Campo>
              <Campo rotulo="A partir de"><Lista valor={form.inicio} opcoes={[...new Map([...opcoesMeses(-12, 12, mesAtual), { valor: form.inicio, texto: mesCurto(form.inicio) }].map((o) => [o.valor, o])).values()].sort((a, b) => a.valor.localeCompare(b.valor))} onMudar={mudar('inicio')} /></Campo>
              <Campo rotulo="Até"><Lista valor={form.fim || null} opcoes={[{ valor: null, texto: 'Sem prazo' }, ...(form.fim && form.fim < mesAtual ? [{ valor: form.fim, texto: mesCurto(form.fim) }] : []), ...opcoesMeses(0, 36, form.inicio > mesAtual ? form.inicio : mesAtual)]} onMudar={(v) => setForm((f) => ({ ...f, fim: v ?? '' }))} /></Campo>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={form.valor_variavel} onChange={mudar('valor_variavel')} />
              O valor muda todo mês (energia, água): lançar como estimado para conferir a fatura</label>
            {form.id && <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={form.ativo} onChange={mudar('ativo')} /> Ativa</label>}
            <Campo rotulo="Observação"><input className="campo" value={form.observacao} onChange={mudar('observacao')} placeholder="Ex.: código do cliente na concessionária" /></Campo>
            {Number(form.dia_vencimento) > 28 && <p className="text-sm text-tinta-400">Nos meses mais curtos, vence no último dia do mês.</p>}
          </div>
        )}
      </TelaSuspensa>
      <Confirmacao aberta={!!apagar} titulo={(lancs ?? []).some((l) => l.despesa_fixa_id === apagar?.id) ? 'Encerrar despesa fixa' : 'Apagar despesa fixa'}
        mensagem={apagar ? `"${apagar.descricao}" deixa de ser lançada nos próximos meses. As contas já lançadas continuam no financeiro.` : ''}
        textoConfirmar={(lancs ?? []).some((l) => l.despesa_fixa_id === apagar?.id) ? 'Encerrar' : 'Apagar'} variante="perigo" carregando={enviando} onCancelar={() => setApagar(null)} onConfirmar={confirmarApagar} />
    </>
  )
}
