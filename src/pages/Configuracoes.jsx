import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { chamarNfce } from '../lib/nfce.js'
import { dataHora, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Lista, Confirmacao, Icone, useAviso } from '../components/ui.jsx'

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map((u) => ({ valor: u, texto: u }))
const REGIMES = [
  { valor: 'simples', texto: 'Simples Nacional' },
  { valor: 'simples_excesso', texto: 'Simples Nacional – excesso de sublimite' },
  { valor: 'mei', texto: 'MEI' },
  { valor: 'normal', texto: 'Regime normal' },
]
const SEGMENTOS = [
  { valor: 'varejo', texto: 'Varejo em geral' }, { valor: 'farmacia', texto: 'Farmácia' },
  { valor: 'mercado', texto: 'Mercado' }, { valor: 'restaurante', texto: 'Restaurante / lanchonete' },
  { valor: 'vestuario', texto: 'Vestuário' }, { valor: 'materiais', texto: 'Materiais de construção' },
  { valor: 'servicos', texto: 'Serviços' }, { valor: 'outro', texto: 'Outro' },
]
const AMBIENTES = [{ valor: 2, texto: 'Homologação (testes, sem valor fiscal)' }, { valor: 1, texto: 'Produção (valor fiscal)' }]

function paraBase64(arquivo) {
  return new Promise((ok, falha) => {
    const leitor = new FileReader()
    leitor.onload = () => ok(String(leitor.result).split(',')[1])
    leitor.onerror = falha
    leitor.readAsDataURL(arquivo)
  })
}

export default function Configuracoes() {
  const avisar = useAviso()
  const [emp, setEmp] = useState(null)
  const [cred, setCred] = useState({})
  const [arquivo, setArquivo] = useState(null)
  const [senha, setSenha] = useState('')
  const [csc, setCsc] = useState('')
  const [salvando, setSalvando] = useState('')
  const [teste, setTeste] = useState(null)
  const [confirmarProducao, setConfirmarProducao] = useState(false)

  const carregar = async () => {
    const [{ data }, { data: c }] = await Promise.all([
      supabase.from('empresas').select('*').single(),
      supabase.rpc('credenciais_configuradas'),
    ])
    setEmp({ ...data, endereco: { logradouro: '', numero: '', bairro: '', municipio: '', cep: '', fone: '', ...(data.endereco || {}) } })
    setCred(c || {})
  }
  useEffect(() => { carregar() }, [])

  if (!emp) return <p className="text-sm text-tinta-400">Carregando…</p>

  const m = (c) => (e) => setEmp((x) => ({ ...x, [c]: e.target.value }))
  const me = (c) => (e) => setEmp((x) => ({ ...x, endereco: { ...x.endereco, [c]: e.target.value } }))

  const salvarEmpresa = async () => {
    setSalvando('empresa')
    const { id, criado_em, ativa, certificado_titular, certificado_validade, certificado_atualizado_em, ...dados } = emp
    dados.cnpj = dados.cnpj?.replace(/\D/g, '') || null
    dados.inscricao_estadual = dados.inscricao_estadual?.replace(/\D/g, '') || null
    dados.municipio_ibge = dados.municipio_ibge?.replace(/\D/g, '') || null
    dados.markup_padrao = lerNumero(dados.markup_padrao)
    if (Number.isNaN(dados.markup_padrao) || dados.markup_padrao < 0) { setSalvando(''); avisar('Markup padrão inválido.', 'erro'); return }
    const { error } = await supabase.from('empresas').update(dados).eq('id', id)
    setSalvando('')
    if (error) avisar(mensagemErro(error), 'erro')
    else avisar('Dados da empresa salvos.')
  }

  const salvarCredenciais = async () => {
    if (arquivo && !senha) { avisar('Informe a senha do certificado.', 'erro'); return }
    if (!arquivo && !senha && !csc && !emp.nfce_csc_id) { avisar('Nada para salvar.', 'erro'); return }
    setSalvando('cred')
    try {
      const pfx = arquivo ? await paraBase64(arquivo) : null
      const { error } = await supabase.rpc('salvar_credenciais_fiscais', {
        p_pfx_base64: pfx, p_senha: senha || null, p_csc_id: emp.nfce_csc_id || null, p_csc: csc || null,
      })
      if (error) throw error
      avisar('Credenciais guardadas no cofre.')
      setArquivo(null); setSenha(''); setCsc('')
      carregar()
    } catch (e) {
      avisar(mensagemErro(e), 'erro')
    } finally {
      setSalvando('')
    }
  }

  const testar = async () => {
    setSalvando('teste'); setTeste(null)
    const r = await chamarNfce({ acao: 'testar' })
    setSalvando('')
    if (r.erro) { avisar(r.erro, 'erro'); return }
    setTeste(r.dados)
    carregar()
  }

  const mudarAmbiente = (v) => (v === 1 ? setConfirmarProducao(true) : setEmp((x) => ({ ...x, nfce_ambiente: 2 })))

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Cabecalho titulo="Configurações" descricao="Dados da empresa, emissão de NFC-e e certificado digital" />
      <section className="cartao space-y-4 p-5">
        <h2 className="titulo-secao">Dados da empresa</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Campo rotulo="Razão social"><input className="campo" value={emp.razao_social ?? ''} onChange={m('razao_social')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Nome fantasia"><input className="campo" value={emp.nome_fantasia ?? ''} onChange={m('nome_fantasia')} /></Campo></div>
          <Campo rotulo="CNPJ"><input className="campo" inputMode="numeric" value={emp.cnpj ?? ''} onChange={m('cnpj')} /></Campo>
          <Campo rotulo="Inscrição estadual"><input className="campo" inputMode="numeric" value={emp.inscricao_estadual ?? ''} onChange={m('inscricao_estadual')} /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="Regime tributário"><Lista valor={emp.regime_tributario} opcoes={REGIMES} onMudar={(v) => setEmp((x) => ({ ...x, regime_tributario: v }))} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Segmento"><Lista valor={emp.segmento} opcoes={SEGMENTOS} onMudar={(v) => setEmp((x) => ({ ...x, segmento: v }))} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Logradouro"><input className="campo" value={emp.endereco.logradouro} onChange={me('logradouro')} /></Campo></div>
          <Campo rotulo="Número"><input className="campo" value={emp.endereco.numero} onChange={me('numero')} /></Campo>
          <Campo rotulo="Bairro"><input className="campo" value={emp.endereco.bairro} onChange={me('bairro')} /></Campo>
          <Campo rotulo="Município"><input className="campo" value={emp.endereco.municipio} onChange={me('municipio')} /></Campo>
          <Campo rotulo="Código IBGE do município"><input className="campo" inputMode="numeric" maxLength={7} value={emp.municipio_ibge ?? ''} onChange={m('municipio_ibge')} /></Campo>
          <Campo rotulo="UF"><Lista valor={emp.uf} opcoes={UFS} onMudar={(v) => setEmp((x) => ({ ...x, uf: v }))} /></Campo>
          <Campo rotulo="CEP"><input className="campo" inputMode="numeric" value={emp.endereco.cep} onChange={me('cep')} /></Campo>
          <Campo rotulo="Telefone"><input className="campo" inputMode="tel" value={emp.endereco.fone} onChange={me('fone')} /></Campo>
          <Campo rotulo="Markup padrão (%)" ajuda="Usado para sugerir preço de venda quando o produto não tem markup próprio"><input className="campo num" inputMode="decimal" value={String(emp.markup_padrao ?? '').replace('.', ',')} onChange={(e) => setEmp((x) => ({ ...x, markup_padrao: e.target.value }))} /></Campo>
        </div>

        <h3 className="titulo-secao border-t border-papel-200 pt-4 dark:border-noite-700">Emissão de NFC-e</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Campo rotulo="Ambiente de emissão"><Lista valor={Number(emp.nfce_ambiente)} opcoes={AMBIENTES} onMudar={mudarAmbiente} /></Campo></div>
          <Campo rotulo="Série"><input className="campo" inputMode="numeric" value={emp.nfce_serie ?? 1} onChange={m('nfce_serie')} /></Campo>
          <Campo rotulo="ID do CSC"><input className="campo" inputMode="numeric" value={emp.nfce_csc_id ?? ''} onChange={m('nfce_csc_id')} placeholder="ex.: 000001" /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="Endereço do QR Code (homologação)"><input className="campo" value={emp.nfce_url_qrcode ?? ''} onChange={m('nfce_url_qrcode')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Endereço de consulta pela chave"><input className="campo" value={emp.nfce_url_consulta ?? ''} onChange={m('nfce_url_consulta')} /></Campo></div>
        </div>
        <div className="flex justify-end"><Botao onClick={salvarEmpresa} carregando={salvando === 'empresa'}>Salvar dados</Botao></div>
      </section>

      <section className="cartao space-y-4 p-5">
        <h2 className="titulo-secao">Certificado digital e CSC</h2>
        <p className="text-sm text-tinta-400">Ficam guardados no cofre criptografado do servidor. Ninguém consegue visualizá-los depois de salvos.</p>
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <Situacao ok={cred.certificado} texto="Certificado A1" />
          <Situacao ok={cred.senha} texto="Senha do certificado" />
          <Situacao ok={cred.csc} texto="CSC" />
        </div>
        {emp.certificado_titular && (
          <p className="text-sm">Titular: <strong>{emp.certificado_titular}</strong>, válido até {dataHora(emp.certificado_validade)}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Arquivo do certificado (.pfx)">
            <label className="campo flex cursor-pointer items-center justify-between">
              <span className={arquivo ? '' : 'text-tinta-300'}>{arquivo ? arquivo.name : 'Selecionar arquivo…'}</span>
              <input type="file" accept=".pfx,.p12" className="hidden" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
          </Campo>
          <Campo rotulo="Senha do certificado"><input type="password" className="campo" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" /></Campo>
          <Campo rotulo="CSC (token)"><input type="password" className="campo" value={csc} onChange={(e) => setCsc(e.target.value)} autoComplete="off" /></Campo>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Botao variante="secundario" icone="nota" onClick={testar} carregando={salvando === 'teste'}>Testar comunicação com a SEFAZ</Botao>
          <Botao onClick={salvarCredenciais} carregando={salvando === 'cred'}>Salvar no cofre</Botao>
        </div>
        {teste && (
          <div className="rounded-xl border border-papel-200 p-4 text-[0.95rem] dark:border-noite-700">
            <p>Certificado: <strong>{teste.titular}</strong> (válido até {dataHora(teste.validade)})</p>
            <p>SEFAZ: <strong>{teste.sefaz.codigo}</strong> – {teste.sefaz.mensagem}</p>
          </div>
        )}
      </section>

      <Confirmacao
        aberta={confirmarProducao}
        titulo="Emitir em produção"
        mensagem="A partir de agora as NFC-e terão valor fiscal. Só mude depois de concluir os testes em homologação. Salve os dados para confirmar."
        textoConfirmar="Mudar para produção"
        variante="perigo"
        onCancelar={() => setConfirmarProducao(false)}
        onConfirmar={() => { setEmp((x) => ({ ...x, nfce_ambiente: 1 })); setConfirmarProducao(false) }}
      />
    </div>
  )
}

function Situacao({ ok, texto }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${ok ? 'bg-caixa-50 text-caixa-700 dark:bg-caixa-700/20 dark:text-caixa-300' : 'bg-ambar-50 text-ambar-600 dark:bg-ambar-600/10 dark:text-ambar-300'}`}>
      <Icone nome={ok ? 'ok' : 'alerta'} className="h-4 w-4" />{texto}: {ok ? 'configurado' : 'pendente'}
    </div>
  )
}
