import { useState } from 'react'
import { supabase, mensagemErro } from '../lib/supabase.js'
import { lerNumero } from '../lib/formato.js'
import { ALIQUOTAS_UF_PADRAO } from '../../supabase/functions/nfce/nfe55.ts'
import { Botao, TelaSuspensa, useAviso } from './ui.jsx'

const fmt = (v) => String(v ?? '').replace('.', ',')

// Tabela de ICMS por UF usada no DIFAL da NF-e (venda a consumidor final não contribuinte de outro estado).
// Guarda só o que difere da tabela padrão.
export function JanelaAliquotasUF({ aberta, empresa, onFechar, onSalvo }) {
  const avisar = useAviso()
  const inicial = () => Object.fromEntries(Object.entries(ALIQUOTAS_UF_PADRAO).map(([uf, p]) => {
    const a = { ...p, ...(empresa?.aliquotas_uf?.[uf] || {}) }
    return [uf, { interna: fmt(a.interna), fcp: fmt(a.fcp), base_dupla: !!a.base_dupla }]
  }))
  const [linhas, setLinhas] = useState(inicial)
  const [salvando, setSalvando] = useState(false)
  const [aberto, setAberto] = useState(aberta)
  if (aberta !== aberto) { setAberto(aberta); if (aberta) setLinhas(inicial()) }

  const mudar = (uf, c, v) => setLinhas((x) => ({ ...x, [uf]: { ...x[uf], [c]: v } }))

  const salvar = async () => {
    const ajustes = {}
    for (const [uf, l] of Object.entries(linhas)) {
      const interna = lerNumero(l.interna), fcp = lerNumero(l.fcp || '0')
      if (!(interna > 0 && interna < 40) || Number.isNaN(fcp) || fcp < 0 || fcp > 4) { avisar(`Confira as alíquotas de ${uf}.`, 'erro'); return }
      const p = ALIQUOTAS_UF_PADRAO[uf]
      if (interna !== p.interna || fcp !== p.fcp || l.base_dupla !== p.base_dupla) ajustes[uf] = { interna, fcp, base_dupla: l.base_dupla }
    }
    setSalvando(true)
    const { error } = await supabase.from('empresas').update({ aliquotas_uf: ajustes }).eq('id', empresa.id)
    setSalvando(false)
    if (error) { avisar(mensagemErro(error), 'erro'); return }
    avisar('Alíquotas por UF salvas.')
    onSalvo?.(ajustes)
  }

  const restaurar = () => setLinhas(Object.fromEntries(Object.entries(ALIQUOTAS_UF_PADRAO).map(([uf, p]) =>
    [uf, { interna: fmt(p.interna), fcp: fmt(p.fcp), base_dupla: p.base_dupla }])))

  return (
    <TelaSuspensa aberta={aberta} onFechar={onFechar} largura="max-w-2xl" titulo="ICMS por UF de destino (DIFAL)"
      subtitulo="Usado na NF-e para consumidor final não contribuinte de outro estado"
      rodape={<>
        <Botao variante="secundario" onClick={restaurar}>Restaurar padrão</Botao>
        <Botao variante="secundario" onClick={onFechar}>Cancelar</Botao>
        <Botao onClick={salvar} carregando={salvando}>Salvar alíquotas</Botao>
      </>}>
      <p className="mb-3 text-sm text-tinta-400">
        Alíquota interna geral de cada estado (novembro de 2026). O FCP só incide sobre produtos listados na lei do estado de destino.
        Base dupla: marque nos estados que a exigem. Confirme com o seu contador antes de emitir em produção.
      </p>
      <div className="max-h-[55vh] overflow-auto rounded-xl border border-papel-200 dark:border-noite-700">
        <table className="tabela w-full text-[0.95rem]">
          <thead><tr><th>UF</th><th className="text-right">Alíquota interna (%)</th><th className="text-right">FCP (%)</th><th className="text-center">Base dupla</th></tr></thead>
          <tbody>
            {Object.entries(linhas).sort(([a], [b]) => a.localeCompare(b)).map(([uf, l]) => (
              <tr key={uf}>
                <td className="font-semibold">{uf}</td>
                <td className="text-right"><input className="campo num ml-auto w-24 py-1.5" inputMode="decimal" value={l.interna} onChange={(e) => mudar(uf, 'interna', e.target.value)} aria-label={`Alíquota interna de ${uf}`} /></td>
                <td className="text-right"><input className="campo num ml-auto w-20 py-1.5" inputMode="decimal" value={l.fcp} onChange={(e) => mudar(uf, 'fcp', e.target.value)} aria-label={`FCP de ${uf}`} /></td>
                <td className="text-center"><input type="checkbox" className="h-4 w-4 accent-caixa-600" checked={l.base_dupla} onChange={(e) => mudar(uf, 'base_dupla', e.target.checked)} aria-label={`Base dupla em ${uf}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TelaSuspensa>
  )
}
