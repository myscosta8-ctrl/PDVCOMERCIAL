import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { chamarFuncao } from '../lib/servidor.js'
import { normalizarChave } from '../lib/pix.js'
import { Botao, Campo, Icone, Lista, useAviso } from './ui.jsx'

const VALIDADES = [5, 10, 15, 30, 60].map((m) => ({ valor: m * 60, texto: `${m} minutos` }))
const lerTexto = (arquivo) => new Promise((ok, falha) => { const l = new FileReader(); l.onload = () => ok(String(l.result)); l.onerror = falha; l.readAsText(arquivo) })

function cnpjValido(c) {
  const d = String(c || '').replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const dv = (n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * p--; if (p < 2) p = 9 } const r = s % 11; return r < 2 ? 0 : 11 - r }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}

function Situacao({ ok, texto }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${ok ? 'bg-caixa-50 text-caixa-700 dark:bg-caixa-700/20 dark:text-caixa-300' : 'bg-ambar-50 text-ambar-600 dark:bg-ambar-600/10 dark:text-ambar-300'}`}>
      <Icone nome={ok ? 'ok' : 'alerta'} className="h-4 w-4" />{texto}: {ok ? 'configurado' : 'pendente'}
    </div>
  )
}

function Arquivo({ rotulo, ajuda, arquivo, aceitar, onEscolher }) {
  return (
    <Campo rotulo={rotulo} ajuda={ajuda}>
      <span className="campo flex cursor-pointer items-center justify-between">
        <span className={arquivo ? '' : 'text-tinta-300'}>{arquivo ? arquivo.name : 'Selecionar arquivo…'}</span>
        <input type="file" accept={aceitar} className="hidden" onChange={(e) => onEscolher(e.target.files?.[0] ?? null)} />
      </span>
    </Campo>
  )
}

// PIX dinâmico (API Pix do banco) e maquininha de cartão
export function ConfigPixCartao({ emp, onSalvo }) {
  const avisar = useAviso()
  const [cfg, setCfg] = useState({ url_api: '', url_token: '', chave: emp.pix_chave || '', expiracao: 600, ...(emp.pix_dinamico || {}) })
  const [cred, setCred] = useState({})
  const [clientId, setClientId] = useState('')
  const [segredo, setSegredo] = useState('')
  const [cert, setCert] = useState(null)
  const [chavePriv, setChavePriv] = useState(null)
  const [credenciadora, setCredenciadora] = useState(emp.cartao_credenciadora_cnpj || '')
  const [pedir, setPedir] = useState(!!emp.cartao_pedir_dados)
  const [salvando, setSalvando] = useState('')
  const [teste, setTeste] = useState(null)

  const carregarCred = () => supabase.rpc('credenciais_pix_configuradas').then(({ data }) => setCred(data || {}))
  useEffect(() => { carregarCred() }, [])
  const mc = (c) => (e) => setCfg((x) => ({ ...x, [c]: e.target.value }))

  const salvar = async () => {
    const preenchido = cfg.url_api || cfg.url_token
    if (preenchido) {
      if (!/^https:\/\//.test(cfg.url_api) || !/^https:\/\//.test(cfg.url_token)) { avisar('Os endereços do banco começam com https://.', 'erro'); return }
      if (!normalizarChave(cfg.chave)) { avisar('Chave PIX da conta inválida.', 'erro'); return }
    }
    if (credenciadora && !cnpjValido(credenciadora)) { avisar('CNPJ da credenciadora inválido.', 'erro'); return }
    setSalvando('salvar')
    try {
      const pem = async (a, marca) => {
        if (!a) return null
        const t = await lerTexto(a)
        if (!t.includes(marca)) throw new Error(`O arquivo ${a.name} não está no formato PEM (texto começando com -----BEGIN). Peça ao banco o certificado em .crt/.pem e a chave em .key.`)
        return t
      }
      const certPem = await pem(cert, 'BEGIN CERTIFICATE')
      const chavePem = await pem(chavePriv, 'PRIVATE KEY')
      const { error } = await supabase.from('empresas').update({
        pix_dinamico: preenchido ? { url_api: cfg.url_api.trim(), url_token: cfg.url_token.trim(), chave: normalizarChave(cfg.chave), expiracao: Number(cfg.expiracao) || 600 } : null,
        cartao_credenciadora_cnpj: credenciadora.replace(/\D/g, '') || null, cartao_pedir_dados: pedir,
      }).eq('id', emp.id)
      if (error) throw error
      if (clientId || segredo || certPem || chavePem) {
        const { error: e2 } = await supabase.rpc('salvar_credenciais_pix', { p_client_id: clientId || null, p_client_secret: segredo || null, p_certificado: certPem, p_chave_privada: chavePem })
        if (e2) throw e2
      }
      setClientId(''); setSegredo(''); setCert(null); setChavePriv(null)
      carregarCred(); onSalvo?.()
      avisar('PIX dinâmico e cartões salvos.')
    } catch (e) { avisar(mensagemErro(e), 'erro') } finally { setSalvando('') }
  }

  const testar = async () => {
    setSalvando('teste'); setTeste(null)
    const r = await chamarFuncao('pix', { acao: 'testar' })
    setSalvando('')
    setTeste(r.erro ? { ok: false, texto: r.erro } : { ok: true, texto: r.dados.mensagem })
  }

  return (
    <section className="cartao space-y-4 p-5">
      <h2 className="titulo-secao">PIX dinâmico e cartões</h2>
      <p className="text-sm text-tinta-400">Com o PIX dinâmico, cada venda gera uma cobrança no banco e o caixa é liberado sozinho quando o pagamento cai. Os dados de acesso são fornecidos pelo banco na contratação da API Pix. Sem eles, o caixa continua usando o QR Code fixo.</p>
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <Situacao ok={cred.client_id} texto="client_id" />
        <Situacao ok={cred.client_secret} texto="client_secret" />
        <Situacao ok={cred.certificado} texto="Certificado" />
        <Situacao ok={cred.chave} texto="Chave privada" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><Campo rotulo="Endereço da API Pix" ajuda="Ex.: https://api.banco.com.br/pix/v2"><input className="campo" value={cfg.url_api} onChange={mc('url_api')} placeholder="https://" /></Campo></div>
        <div className="sm:col-span-2"><Campo rotulo="Endereço de autenticação (token)" ajuda="Ex.: https://api.banco.com.br/oauth/token"><input className="campo" value={cfg.url_token} onChange={mc('url_token')} placeholder="https://" /></Campo></div>
        <div className="sm:col-span-2"><Campo rotulo="Chave PIX da conta" ajuda="Precisa estar cadastrada na conta que tem a API Pix"><input className="campo" value={cfg.chave} onChange={mc('chave')} /></Campo></div>
        <Campo rotulo="Validade do QR Code"><Lista valor={Number(cfg.expiracao)} opcoes={VALIDADES} onMudar={(v) => setCfg((x) => ({ ...x, expiracao: v }))} /></Campo>
        <div />
        <Campo rotulo="client_id"><input type="password" className="campo" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} autoComplete="off" /></Campo>
        <Campo rotulo="client_secret"><input type="password" className="campo" value={segredo} onChange={(e) => setSegredo(e.target.value.trim())} autoComplete="new-password" /></Campo>
        <Arquivo rotulo="Certificado do banco" ajuda="Arquivo .crt ou .pem" arquivo={cert} aceitar=".crt,.pem,.cer" onEscolher={setCert} />
        <Arquivo rotulo="Chave privada" ajuda="Arquivo .key ou .pem" arquivo={chavePriv} aceitar=".key,.pem" onEscolher={setChavePriv} />
      </div>
      <div className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-4 dark:border-noite-700">
        <Campo rotulo="CNPJ da credenciadora da maquininha" ajuda="Opcional. Vai na NFC-e das vendas no cartão"><input className="campo num" inputMode="numeric" value={credenciadora} onChange={(e) => setCredenciadora(e.target.value)} /></Campo>
        <label className="flex items-center gap-2 self-center sm:col-span-3"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={pedir} onChange={(e) => setPedir(e.target.checked)} /> No caixa, pedir bandeira, autorização e NSU do comprovante da maquininha</label>
      </div>
      {teste && (
        <div className={`rounded-xl px-4 py-3 text-[0.95rem] ${teste.ok ? 'bg-caixa-50 text-caixa-700 dark:bg-caixa-700/20 dark:text-caixa-300' : 'bg-rubro-50 text-rubro-700 dark:bg-rubro-600/10 dark:text-rubro-300'}`}>{teste.texto}</div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Botao variante="secundario" icone="dinheiro" onClick={testar} carregando={salvando === 'teste'}>Testar com o banco</Botao>
        <Botao onClick={salvar} carregando={salvando === 'salvar'}>Salvar PIX dinâmico e cartões</Botao>
      </div>
    </section>
  )
}
