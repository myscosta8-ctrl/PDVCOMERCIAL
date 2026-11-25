import { useState } from 'react'
import { chamarFuncao } from '../lib/servidor.js'
import { Botao, Etiqueta, Icone } from './ui.jsx'

// Resumo do mês em texto: escrito pela IA quando o servidor tem a chave configurada, ou pelas regras do sistema
export function ResumoMes() {
  const [r, setR] = useState(null)
  const [erro, setErro] = useState(null)
  const [carregando, setCarregando] = useState(false)
  const gerar = async () => {
    setCarregando(true); setErro(null)
    const x = await chamarFuncao('resumo', {})
    setCarregando(false)
    if (x.erro) setErro(x.erro); else setR(x.dados)
  }
  const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' })
  return (
    <section className="cartao mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="titulo-secao">Resumo de {mes}</h2>
          {r && <Etiqueta tom={r.fonte === 'ia' ? 'positivo' : 'neutro'}>{r.fonte === 'ia' ? 'Escrito por IA' : 'Gerado pelas regras do sistema'}</Etiqueta>}
        </div>
        <Botao variante="secundario" icone="grafico" onClick={gerar} carregando={carregando}>{r ? 'Atualizar resumo' : 'Gerar resumo do mês'}</Botao>
      </div>
      {erro && <p className="mt-3 text-sm text-rubro-600">{erro}</p>}
      {!r && !erro && <p className="mt-3 text-sm text-tinta-400">Vendas comparadas ao mês passado, margem, despesas e o que pede atenção, em poucas linhas.</p>}
      {r && (
        <div className="mt-3 max-w-3xl space-y-2.5 text-[0.95rem] leading-relaxed text-tinta-600 dark:text-tinta-200">
          {r.paragrafos.map((t, i) => <p key={i}>{t}</p>)}
          {r.aviso && <p className="flex items-center gap-1.5 text-sm text-ambar-600"><Icone nome="alerta" className="h-4 w-4" />{r.aviso}</p>}
        </div>
      )}
    </section>
  )
}
