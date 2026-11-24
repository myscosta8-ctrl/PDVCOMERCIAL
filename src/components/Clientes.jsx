import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { dinheiro } from '../lib/formato.js'
import { Botao, Etiqueta, Icone, TelaSuspensa, Vazio, useAviso } from './ui.jsx'

export async function carregarSituacao(clienteId) {
  const { data } = await supabase.rpc('situacao_cliente', { p_cliente: clienteId })
  return data
}

// Janela padrão para localizar um cliente por nome, CPF/CNPJ ou telefone
export function SeletorCliente({ aberta, onFechar, onEscolher, titulo = 'Identificar cliente' }) {
  const avisar = useAviso()
  const [termo, setTermo] = useState('')
  const [lista, setLista] = useState([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => { if (aberta) { setTermo(''); setLista([]) } }, [aberta])

  const buscar = async (e) => {
    e?.preventDefault()
    const t = termo.trim().replace(/[%,()]/g, '')
    if (!t) return
    setBuscando(true)
    const digitos = t.replace(/\D/g, '')
    let q = supabase.from('clientes').select('id, nome, cpf_cnpj, telefone, limite_credito, bloqueado, convenio:convenios(nome)').eq('ativo', true).order('nome').limit(30)
    q = digitos.length >= 3 ? q.or(`cpf_cnpj.ilike.%${digitos}%,telefone.ilike.%${digitos}%,nome.ilike.%${t}%`) : q.ilike('nome', `%${t}%`)
    const { data, error } = await q
    setBuscando(false)
    if (error) avisar(mensagemErro(error), 'erro')
    else setLista(data)
  }

  const escolher = async (c) => onEscolher({ ...c, situacao: await carregarSituacao(c.id) })

  return (
    <TelaSuspensa aberta={aberta} titulo={titulo} subtitulo="Busque por nome, CPF/CNPJ ou telefone" onFechar={onFechar} largura="max-w-2xl">
      <form onSubmit={buscar} className="flex gap-2">
        <input className="campo" value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus placeholder="Ex.: Maria, 123.456.789-09 ou 91 99999-0000" aria-label="Buscar cliente" />
        <Botao type="submit" icone="busca" carregando={buscando}>Buscar</Botao>
      </form>
      <ul className="-mx-2 mt-3 divide-y divide-papel-200 dark:divide-noite-700">
        {lista.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-3 text-left hover:bg-caixa-50 dark:hover:bg-noite-700" onClick={() => escolher(c)}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.nome}</span>
                <span className="text-sm text-tinta-400">{[c.cpf_cnpj && `CPF/CNPJ ${c.cpf_cnpj}`, c.telefone, c.convenio && `Convênio ${c.convenio.nome}`].filter(Boolean).join(', ') || 'Sem documento informado'}</span>
              </span>
              {c.bloqueado ? <Etiqueta tom="critico">Bloqueado</Etiqueta> : Number(c.limite_credito) > 0 && <Etiqueta>Limite {dinheiro(c.limite_credito)}</Etiqueta>}
            </button>
          </li>
        ))}
      </ul>
      {!lista.length && termo && !buscando && <Vazio icone="usuario" titulo="Nenhum cliente listado" texto="Digite o nome ou documento e clique em Buscar. Para cadastrar um cliente novo, use a tela Clientes." />}
    </TelaSuspensa>
  )
}

// Quadro com a situação financeira do cliente (limite, atraso, vale, convênio)
export function SituacaoCliente({ cliente, onRemover, compacto }) {
  const s = cliente.situacao ?? {}
  const atraso = Number(s.em_atraso) > 0
  return (
    <div className={`rounded-xl border p-3 ${atraso || s.bloqueado ? 'border-rubro-300 bg-rubro-50 dark:border-rubro-600 dark:bg-rubro-600/10' : 'border-papel-200 dark:border-noite-700'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icone nome="usuario" className="h-5 w-5 shrink-0 text-tinta-400" />
          <span className="truncate font-semibold">{cliente.nome}</span>
        </div>
        {onRemover && <button className="rounded p-0.5 text-tinta-400 hover:text-rubro-600" onClick={onRemover} aria-label="Remover cliente da venda"><Icone nome="fechar" className="h-4 w-4" /></button>}
      </div>
      {(atraso || s.bloqueado) && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-rubro-600 dark:text-rubro-300">
          <Icone nome="alerta" className="h-4 w-4" />
          {s.bloqueado ? 'Cliente bloqueado para venda a prazo' : `${dinheiro(s.em_atraso)} em atraso há ${s.dias_atraso} dia(s)`}
        </p>
      )}
      <dl className={`mt-2 grid gap-x-4 gap-y-1 text-sm ${compacto ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        <div><dt className="text-tinta-400">Limite disponível</dt><dd className="num font-semibold">{dinheiro(s.disponivel)}</dd></div>
        <div><dt className="text-tinta-400">Saldo devedor</dt><dd className="num font-semibold">{dinheiro(s.saldo_devedor)}</dd></div>
        <div><dt className="text-tinta-400">Vale-troca</dt><dd className="num font-semibold">{dinheiro(s.vale)}</dd></div>
        <div><dt className="text-tinta-400">Convênio</dt><dd className="font-semibold">{s.convenio ? `${s.convenio.nome}${Number(s.convenio.desconto) > 0 ? `, ${String(s.convenio.desconto).replace('.', ',')}% de desconto` : ''}` : 'Nenhum'}</dd></div>
      </dl>
    </div>
  )
}
