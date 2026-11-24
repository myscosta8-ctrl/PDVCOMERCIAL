import { useState } from 'react'
import { dinheiro } from '../lib/formato.js'
import { MODELOS_ETIQUETA, imprimirEtiquetas } from '../lib/etiquetas.js'
import { Botao, Campo, Lista, TelaSuspensa, useAviso } from './ui.jsx'

// produtos: [{ id, descricao, preco_venda, ean, codigo, unidade, quantidade? }]
export function JanelaEtiquetas({ produtos, onFechar }) {
  const avisar = useAviso()
  const [modelo, setModelo] = useState(() => { try { return localStorage.getItem('modelo_etiqueta') || 'gondola' } catch { return 'gondola' } })
  const [qtds, setQtds] = useState(() => Object.fromEntries(produtos.map((p) => [p.id, String(p.quantidade ?? 1)])))
  const total = Object.values(qtds).reduce((s, v) => s + (parseInt(v, 10) || 0), 0)

  const imprimir = () => {
    try { localStorage.setItem('modelo_etiqueta', modelo) } catch {}
    const r = imprimirEtiquetas(produtos.map((p) => ({ descricao: p.descricao, preco: p.preco_venda, ean: p.ean, codigo: p.codigo, unidade: p.unidade, quantidade: parseInt(qtds[p.id], 10) || 0 })), modelo)
    if (r.erro) avisar(r.erro, 'erro')
    else onFechar()
  }

  return (
    <TelaSuspensa aberta titulo="Imprimir etiquetas" subtitulo={`${produtos.length} produto(s), ${total} etiqueta(s)`} onFechar={onFechar} largura="max-w-2xl"
      rodape={<>
        <Botao variante="secundario" onClick={onFechar}>Cancelar</Botao>
        <Botao icone="impressora" onClick={imprimir} disabled={!total}>Imprimir {total} etiqueta(s)</Botao>
      </>}>
      <div className="space-y-4">
        <Campo rotulo="Modelo de etiqueta"><Lista valor={modelo} opcoes={MODELOS_ETIQUETA} onMudar={setModelo} /></Campo>
        <div className="max-h-80 overflow-auto rounded-xl border border-papel-200 dark:border-noite-700">
          <table className="tabela w-full text-[0.95rem]">
            <thead className="sticky top-0 bg-papel dark:bg-noite-800"><tr><th>Produto</th><th className="text-right">Preço</th><th className="text-right">Etiquetas</th></tr></thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.id}>
                  <td><span className="block truncate">{p.descricao}</span><span className="text-xs text-tinta-400">{p.ean || p.codigo || 'Sem código de barras'}</span></td>
                  <td className="num text-right">{dinheiro(p.preco_venda)}</td>
                  <td className="text-right"><input className="campo num ml-auto w-20 py-1 text-right" inputMode="numeric" value={qtds[p.id]} onChange={(e) => setQtds((x) => ({ ...x, [p.id]: e.target.value }))} aria-label={`Etiquetas de ${p.descricao}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </TelaSuspensa>
  )
}
