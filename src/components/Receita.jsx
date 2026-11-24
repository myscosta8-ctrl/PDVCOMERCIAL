import { useState } from 'react'
import { Botao, Campo, Lista, TelaSuspensa, useAviso } from './ui.jsx'

export const TIPOS_RECEITA = [
  { valor: 'notificacao_a', texto: 'Notificação de receita A (amarela)' },
  { valor: 'notificacao_b', texto: 'Notificação de receita B (azul)' },
  { valor: 'notificacao_b2', texto: 'Notificação de receita B2 (azul, anorexígenos)' },
  { valor: 'notificacao_especial', texto: 'Notificação de receita especial (retinoides, talidomida)' },
  { valor: 'controle_especial', texto: 'Receita de controle especial (2 vias)' },
  { valor: 'antimicrobiano', texto: 'Receita de antimicrobiano (2 vias, validade 10 dias)' },
]
export const nomeTipoReceita = (t) => TIPOS_RECEITA.find((x) => x.valor === t)?.texto ?? t

// Tipo de receita exigido por lista da Portaria 344 (e antimicrobianos)
export const tipoPorLista = (lista) => ({
  A1: 'notificacao_a', A2: 'notificacao_a', A3: 'notificacao_a', B1: 'notificacao_b', B2: 'notificacao_b2',
  C2: 'notificacao_especial', C3: 'notificacao_especial', C1: 'controle_especial', C4: 'controle_especial', C5: 'controle_especial',
  AM: 'antimicrobiano',
}[lista] ?? null)

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map((u) => ({ valor: u, texto: u }))
const CONSELHOS = [{ valor: 'CRM', texto: 'CRM (médico)' }, { valor: 'CRO', texto: 'CRO (dentista)' }, { valor: 'CRMV', texto: 'CRMV (veterinário)' }]
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)

// Coleta da receita no caixa. controlados: itens do carrinho com controlado = true
export function JanelaReceita({ controlados, cliente, ufPadrao, inicial, onFechar, onConfirmar }) {
  const avisar = useAviso()
  const exigidos = [...new Set(controlados.map((i) => tipoPorLista(i.lista_controle)).filter(Boolean))]
  const [r, setR] = useState(() => inicial ?? {
    tipo: exigidos[0] ?? null, numero: '', data_emissao: hoje(), prescritor_nome: '', prescritor_conselho: 'CRM', prescritor_numero: '',
    prescritor_uf: ufPadrao ?? 'PA', paciente_nome: '', paciente_idade: '', paciente_sexo: null,
    comprador_nome: cliente?.nome ?? '', comprador_documento: cliente?.cpf_cnpj ?? '', comprador_orgao: '', comprador_endereco: '', comprador_telefone: cliente?.telefone ?? '',
  })
  const m = (c) => (e) => setR((x) => ({ ...x, [c]: e?.target ? e.target.value : e }))
  const anti = r.tipo === 'antimicrobiano'
  const notif = String(r.tipo ?? '').startsWith('notificacao')

  const confirmar = () => {
    if (exigidos.length > 1) { avisar('Os medicamentos exigem receitas de tipos diferentes. Faça uma venda para cada receita.', 'erro'); return }
    if (!r.tipo) { avisar('Escolha o tipo de receita.', 'erro'); return }
    if (notif && !r.numero.trim()) { avisar('Informe o número da notificação.', 'erro'); return }
    if (!r.prescritor_nome.trim() || !r.prescritor_numero.trim()) { avisar('Informe o nome e o registro do prescritor.', 'erro'); return }
    if (!r.paciente_nome.trim()) { avisar('Informe o nome do paciente.', 'erro'); return }
    if (anti && (!r.paciente_idade || !r.paciente_sexo)) { avisar('Antimicrobiano: informe idade e sexo do paciente.', 'erro'); return }
    if (!r.comprador_nome.trim() || !r.comprador_documento.trim()) { avisar('Informe nome e documento do comprador.', 'erro'); return }
    onConfirmar({ ...r, paciente_idade: r.paciente_idade === '' ? null : Number(r.paciente_idade), produtos: [...new Set(controlados.map((i) => i.produto_id))] })
  }

  return (
    <TelaSuspensa aberta titulo="Receita do medicamento controlado" subtitulo={controlados.map((i) => i.descricao).join(', ')} onFechar={onFechar} largura="max-w-3xl"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Cancelar</Botao>
        <Botao onClick={confirmar}>Confirmar receita</Botao>
      </>}>
      <div className="space-y-4">
        {exigidos.length > 1 && <p className="rounded-lg bg-rubro-50 px-3 py-2 text-sm text-rubro-600 dark:bg-rubro-600/20 dark:text-rubro-300">Há medicamentos que exigem receitas de tipos diferentes. Separe em vendas distintas.</p>}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Campo rotulo="Tipo de receita" ajuda={exigidos.length === 1 ? 'Definido pela lista do medicamento' : null}><Lista valor={r.tipo} opcoes={TIPOS_RECEITA} onMudar={m('tipo')} /></Campo></div>
          <Campo rotulo={notif ? 'Número da notificação' : 'Número (opcional)'}><input className="campo num" value={r.numero} onChange={m('numero')} autoFocus /></Campo>
          <Campo rotulo="Data da receita" ajuda={anti ? 'Vale por 10 dias' : 'Vale por 30 dias'}><input type="date" className="campo" value={r.data_emissao} max={hoje()} onChange={m('data_emissao')} /></Campo>
        </div>
        <div>
          <p className="mb-2 font-semibold">Prescritor</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={r.prescritor_nome} onChange={m('prescritor_nome')} /></Campo></div>
            <Campo rotulo="Conselho"><Lista valor={r.prescritor_conselho} opcoes={CONSELHOS} onMudar={m('prescritor_conselho')} /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Número"><input className="campo num" value={r.prescritor_numero} onChange={m('prescritor_numero')} /></Campo>
              <Campo rotulo="UF"><Lista valor={r.prescritor_uf} opcoes={UFS} onMudar={m('prescritor_uf')} /></Campo>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 font-semibold">Paciente</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={r.paciente_nome} onChange={m('paciente_nome')} /></Campo></div>
            <Campo rotulo={anti ? 'Idade (anos)' : 'Idade (opcional)'}><input className="campo num" inputMode="numeric" value={r.paciente_idade} onChange={m('paciente_idade')} /></Campo>
            <Campo rotulo={anti ? 'Sexo' : 'Sexo (opcional)'}><Lista valor={r.paciente_sexo} opcoes={[{ valor: 'F', texto: 'Feminino' }, { valor: 'M', texto: 'Masculino' }]} onMudar={m('paciente_sexo')} /></Campo>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">Comprador</p>
            <button type="button" className="text-sm font-medium text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => setR((x) => ({ ...x, comprador_nome: x.paciente_nome }))}>O comprador é o paciente</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2"><Campo rotulo="Nome"><input className="campo" value={r.comprador_nome} onChange={m('comprador_nome')} /></Campo></div>
            <Campo rotulo="Documento (RG ou CPF)"><input className="campo num" value={r.comprador_documento} onChange={m('comprador_documento')} /></Campo>
            <Campo rotulo="Órgão expedidor"><input className="campo" value={r.comprador_orgao} onChange={m('comprador_orgao')} placeholder="SSP/PA" /></Campo>
            <div className="sm:col-span-3"><Campo rotulo="Endereço"><input className="campo" value={r.comprador_endereco} onChange={m('comprador_endereco')} /></Campo></div>
            <Campo rotulo="Telefone"><input className="campo num" value={r.comprador_telefone} onChange={m('comprador_telefone')} /></Campo>
          </div>
        </div>
        <p className="text-sm text-tinta-400">Retenha a receita (ou a 2ª via, no caso de antimicrobiano e controle especial) e carimbe com os dados da dispensação.</p>
      </div>
    </TelaSuspensa>
  )
}
