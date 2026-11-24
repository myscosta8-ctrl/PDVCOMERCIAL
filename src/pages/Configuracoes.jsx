import { useEffect, useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { chamarNfce } from '../lib/nfce.js'
import { normalizarChave } from '../lib/pix.js'
import { configImpressao, htmlTeste, imprimirHtml } from '../lib/impressao.js'
import { dataHora, lerNumero } from '../lib/formato.js'
import { Botao, Cabecalho, Campo, Lista, Confirmacao, Icone, useAviso } from '../components/ui.jsx'
import { JanelaAliquotasUF } from '../components/AliquotasUF.jsx'

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
  const [verAliquotas, setVerAliquotas] = useState(false)

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

  const balanca = { ativo: false, digitos_codigo: 5, tipo: 'preco', ...(emp.balanca || {}) }
  const mb = (c) => (v) => setEmp((x) => ({ ...x, balanca: { ...balanca, [c]: v } }))
  const salvarPixBalanca = async () => {
    if (emp.pix_chave && !normalizarChave(emp.pix_chave)) { avisar('Chave PIX inválida. Use CPF, CNPJ, e-mail, celular ou chave aleatória.', 'erro'); return }
    setSalvando('pix')
    const { error } = await supabase.from('empresas').update({
      pix_chave: emp.pix_chave?.trim() || null, pix_nome: emp.pix_nome?.trim() || null, pix_cidade: emp.pix_cidade?.trim() || null, balanca,
    }).eq('id', emp.id)
    setSalvando('')
    if (error) avisar(mensagemErro(error), 'erro')
    else avisar('PIX e balança salvos.')
  }

  const impressao = configImpressao(emp)
  const mi = (c) => (v) => setEmp((x) => ({ ...x, impressao: { ...impressao, [c]: v } }))
  const alertas = { dias_pagar: 5, dias_validade: 60, dias_certificado: 30, ...(emp.alertas || {}) }
  const ma = (c) => (e) => setEmp((x) => ({ ...x, alertas: { ...alertas, [c]: e.target.value } }))
  const salvarImpressaoAlertas = async () => {
    const dias = {}
    for (const [c, max] of [['dias_pagar', 60], ['dias_validade', 365], ['dias_certificado', 120]]) {
      const n = parseInt(alertas[c], 10)
      if (!(n >= 0 && n <= max)) { avisar(`Informe de 0 a ${max} dias.`, 'erro'); return }
      dias[c] = n
    }
    setSalvando('impressao')
    const { error } = await supabase.from('empresas').update({
      impressao: { ...impressao, mensagem: String(impressao.mensagem || '').trim().slice(0, 200) }, alertas: dias,
    }).eq('id', emp.id)
    setSalvando('')
    if (error) avisar(mensagemErro(error), 'erro')
    else { avisar('Impressão e alertas salvos.'); window.dispatchEvent(new Event('alertas:recarregar')) }
  }
  const imprimirTeste = () => {
    const x = imprimirHtml(htmlTeste({ ...emp, endereco: emp.endereco }, impressao))
    if (x.erro) avisar(x.erro, 'erro')
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
          <Campo rotulo="Série da NFC-e"><input className="campo" inputMode="numeric" value={emp.nfce_serie ?? 1} onChange={m('nfce_serie')} /></Campo>
          <Campo rotulo="Série da NF-e"><input className="campo" inputMode="numeric" value={emp.nfe_serie ?? 1} onChange={m('nfe_serie')} /></Campo>
          <Campo rotulo="ID do CSC"><input className="campo" inputMode="numeric" value={emp.nfce_csc_id ?? ''} onChange={m('nfce_csc_id')} placeholder="ex.: 000001" /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="Endereço do QR Code (homologação)"><input className="campo" value={emp.nfce_url_qrcode ?? ''} onChange={m('nfce_url_qrcode')} /></Campo></div>
          <div className="sm:col-span-2"><Campo rotulo="Endereço de consulta pela chave"><input className="campo" value={emp.nfce_url_consulta ?? ''} onChange={m('nfce_url_consulta')} /></Campo></div>
          <div className="sm:col-span-4 grid gap-3 rounded-xl border border-papel-200 p-3 sm:grid-cols-4 dark:border-noite-700">
            <p className="text-sm text-tinta-400 sm:col-span-4">Responsável técnico (opcional): algumas UFs exigem na NF-e os dados de quem fornece o sistema. Preencha só se a SEFAZ pedir.</p>
            {[['cnpj', 'CNPJ'], ['contato', 'Nome do contato'], ['email', 'E-mail'], ['fone', 'Telefone']].map(([c, r]) => (
              <Campo key={c} rotulo={r}><input className="campo" value={emp.resp_tecnico?.[c] ?? ''} onChange={(e) => setEmp((x) => ({ ...x, resp_tecnico: { ...(x.resp_tecnico || {}), [c]: e.target.value } }))} /></Campo>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-papel-200 p-3 sm:col-span-4 dark:border-noite-700">
            <p className="text-sm text-tinta-400">
              {['normal', 'simples_excesso'].includes(emp.regime_tributario)
                ? `DIFAL na NF-e para consumidor final de outro estado: ${Object.keys(emp.aliquotas_uf || {}).length ? `${Object.keys(emp.aliquotas_uf).length} UF ajustada(s)` : 'tabela padrão de novembro de 2026'}.`
                : 'DIFAL: no Simples Nacional e no MEI a NF-e para consumidor final de outro estado sai sem o DIFAL.'}
            </p>
            {['normal', 'simples_excesso'].includes(emp.regime_tributario) && <Botao variante="secundario" onClick={() => setVerAliquotas(true)}>ICMS por UF (DIFAL)</Botao>}
          </div>
          <label className="flex items-start gap-2 sm:col-span-4"><input type="checkbox" className="mt-1 h-4 w-4 accent-caixa-600" checked={emp.nfce_contingencia !== false} onChange={(e) => setEmp((x) => ({ ...x, nfce_contingencia: e.target.checked }))} />
            <span>Emitir em contingência quando a SEFAZ não responder<span className="block text-sm text-tinta-400">A venda não para: sai o DANFE em duas vias e a nota é transmitida sozinha quando a conexão voltar (prazo de 24 horas).</span></span></label>
        </div>
        <div className="flex justify-end"><Botao onClick={salvarEmpresa} carregando={salvando === 'empresa'}>Salvar dados</Botao></div>
        <JanelaAliquotasUF aberta={verAliquotas} empresa={emp} onFechar={() => setVerAliquotas(false)}
          onSalvo={(a) => { setEmp((x) => ({ ...x, aliquotas_uf: a })); setVerAliquotas(false) }} />
      </section>

      <section className="cartao space-y-4 p-5">
        <h2 className="titulo-secao">PIX e balança</h2>
        <p className="text-sm text-tinta-400">O caixa mostra um QR Code PIX com o valor da venda. A confirmação é feita olhando o aplicativo do banco antes de concluir.</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Campo rotulo="Chave PIX" ajuda={emp.pix_chave ? (normalizarChave(emp.pix_chave) ? `Será usada: ${normalizarChave(emp.pix_chave)}` : 'Chave não reconhecida') : 'CPF, CNPJ, e-mail, celular ou chave aleatória'}><input className="campo" value={emp.pix_chave ?? ''} onChange={m('pix_chave')} /></Campo></div>
          <Campo rotulo="Nome do recebedor" ajuda="Até 25 letras, sem acentos no QR"><input className="campo" value={emp.pix_nome ?? ''} onChange={m('pix_nome')} placeholder={emp.nome_fantasia || emp.razao_social} /></Campo>
          <Campo rotulo="Cidade"><input className="campo" value={emp.pix_cidade ?? ''} onChange={m('pix_cidade')} placeholder={emp.endereco.municipio} /></Campo>
        </div>
        <div className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-4 dark:border-noite-700">
          <label className="flex items-center gap-2 sm:col-span-4"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={balanca.ativo} onChange={(e) => mb('ativo')(e.target.checked)} /> Ler etiquetas de balança (código de barras começando com 2)</label>
          {balanca.ativo && <>
            <Campo rotulo="Dígitos do código do produto"><Lista valor={Number(balanca.digitos_codigo)} opcoes={[4, 5, 6].map((n) => ({ valor: n, texto: `${n} dígitos` }))} onMudar={mb('digitos_codigo')} /></Campo>
            <Campo rotulo="A etiqueta traz"><Lista valor={balanca.tipo} opcoes={[{ valor: 'preco', texto: 'O preço total' }, { valor: 'peso', texto: 'O peso' }]} onMudar={mb('tipo')} /></Campo>
            <p className="self-end pb-2 text-sm text-tinta-400 sm:col-span-2">Cadastre o código da balança em cada produto vendido por peso (tela Produtos). Confira o formato no manual da balança.</p>
          </>}
        </div>
        <div className="flex justify-end"><Botao onClick={salvarPixBalanca} carregando={salvando === 'pix'}>Salvar PIX e balança</Botao></div>
      </section>

      <section className="cartao space-y-4 p-5">
        <h2 className="titulo-secao">Impressão e alertas</h2>
        <p className="text-sm text-tinta-400">Cupom na impressora térmica pelo próprio navegador. Para imprimir sem a janela de confirmação, veja a ajuda ao lado do botão de teste.</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo rotulo="Largura da bobina"><Lista valor={Number(impressao.largura)} opcoes={[{ valor: 80, texto: '80 mm' }, { valor: 58, texto: '58 mm' }]} onMudar={mi('largura')} /></Campo>
          <Campo rotulo="Vias do crediário" ajuda="Com linha para o cliente assinar"><Lista valor={Number(impressao.vias_crediario)} opcoes={[1, 2, 3].map((n) => ({ valor: n, texto: n === 1 ? '1 via' : `${n} vias` }))} onMudar={mi('vias_crediario')} /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="Mensagem no fim do cupom (opcional)"><input className="campo" maxLength={200} value={impressao.mensagem ?? ''} onChange={(e) => mi('mensagem')(e.target.value)} placeholder="Ex.: Obrigado pela preferência!" /></Campo></div>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={!!impressao.automatica} onChange={(e) => mi('automatica')(e.target.checked)} /> Imprimir automaticamente (cupom, sangria, suprimento, fechamento e recebimento)</label>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-caixa-600" disabled={!impressao.automatica} checked={!!impressao.comprovante} onChange={(e) => mi('comprovante')(e.target.checked)} /> Imprimir comprovante não fiscal quando a NFC-e não for emitida</label>
        </div>
        <div className="grid gap-3 border-t border-papel-200 pt-4 sm:grid-cols-4 dark:border-noite-700">
          <Campo rotulo="Contas a pagar: avisar com" ajuda="dias de antecedência"><input className="campo num" inputMode="numeric" value={alertas.dias_pagar} onChange={ma('dias_pagar')} /></Campo>
          <Campo rotulo="Validade dos lotes: avisar com" ajuda="dias de antecedência"><input className="campo num" inputMode="numeric" value={alertas.dias_validade} onChange={ma('dias_validade')} /></Campo>
          <Campo rotulo="Certificado digital: avisar com" ajuda="dias de antecedência"><input className="campo num" inputMode="numeric" value={alertas.dias_certificado} onChange={ma('dias_certificado')} /></Campo>
          <p className="self-end pb-6 text-sm text-tinta-400">Contas a receber, crediário e lotes vencidos aparecem sempre.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto max-w-xl text-sm text-tinta-400">Impressão direta: no atalho do Chrome do caixa, acrescente <span className="font-mono">--kiosk-printing</span> e deixe a térmica como impressora padrão.</p>
          <Botao variante="secundario" icone="impressora" onClick={imprimirTeste}>Imprimir teste</Botao>
          <Botao onClick={salvarImpressaoAlertas} carregando={salvando === 'impressao'}>Salvar impressão e alertas</Botao>
        </div>
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
