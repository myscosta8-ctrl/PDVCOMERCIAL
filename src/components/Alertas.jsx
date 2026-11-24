import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useSessao } from '../lib/sessao.js'
import { dinheiro } from '../lib/formato.js'
import { gruposAlertas, totalAlertas } from '../lib/alertas.js'
import { Botao, Etiqueta, Icone, TelaSuspensa } from './ui.jsx'

const INTERVALO = 30 * 60 * 1000

// Carrega os alertas ao entrar, a cada 30 minutos e quando a configuração muda
export function useAlertas() {
  const perfil = useSessao()
  const [grupos, setGrupos] = useState(null)
  useEffect(() => {
    let vivo = true
    const carregar = () => supabase.rpc('alertas_vencimento').then(({ data, error }) => {
      if (vivo && !error) setGrupos(gruposAlertas(data, perfil.papel))
    })
    carregar()
    const t = setInterval(carregar, INTERVALO)
    window.addEventListener('alertas:recarregar', carregar)
    return () => { vivo = false; clearInterval(t); window.removeEventListener('alertas:recarregar', carregar) }
  }, [perfil.papel])
  return grupos
}

// Notificação do navegador: no máximo uma por dia, só com alerta crítico
function notificar(grupos) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const criticos = grupos.filter((g) => g.nivel === 'critico')
    if (!criticos.length) return
    const hoje = new Date().toLocaleDateString('sv-SE')
    if (localStorage.getItem('alertas:notificado') === hoje) return
    localStorage.setItem('alertas:notificado', hoje)
    new Notification('PDV Comercial: vencimentos', { body: criticos.map((g) => g.titulo).join('\n'), tag: 'alertas-vencimento' })
  } catch { /* navegador sem suporte */ }
}

export function BotaoAlertas({ irPara }) {
  const grupos = useAlertas()
  const [aberta, setAberta] = useState(false)
  const [permissao, setPermissao] = useState(() => (typeof Notification === 'undefined' ? 'indisponivel' : Notification.permission))
  useEffect(() => { if (grupos) notificar(grupos) }, [grupos])
  if (!grupos) return null
  const total = totalAlertas(grupos)

  const pedirPermissao = async () => {
    try { setPermissao(await Notification.requestPermission()) } catch { setPermissao('indisponivel') }
  }
  const ir = (tela) => { setAberta(false); irPara(tela) }

  return (
    <>
      <button onClick={() => setAberta(true)} className={`relative flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-papel-100 dark:hover:bg-noite-700 ${total.critico ? 'text-rubro-600 dark:text-rubro-300' : total.qtd ? 'text-ambar-600 dark:text-ambar-300' : 'text-tinta-400'}`}
        aria-label={total.qtd ? `${total.qtd} alerta(s) de vencimento` : 'Nenhum alerta de vencimento'} title="Alertas de vencimento">
        <Icone nome="sino" className="h-4 w-4" />
        {total.qtd > 0 ? <span className="num font-semibold">{total.qtd}</span> : <span>Sem alertas</span>}
      </button>
      <TelaSuspensa aberta={aberta} titulo="Alertas de vencimento" subtitulo={total.qtd ? 'Os mais urgentes aparecem primeiro' : 'Nada vencido ou perto de vencer'} onFechar={() => setAberta(false)} largura="max-w-2xl"
        rodape={<Botao variante="secundario" onClick={() => setAberta(false)}>Fechar</Botao>}>
        {grupos.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-tinta-400"><Icone nome="ok" className="h-5 w-5 text-caixa-600" />Nenhuma conta, lote ou certificado vencido ou perto de vencer.</p>
        ) : (
          <div className="space-y-4">
            {grupos.map((g) => (
              <section key={g.id} className={`rounded-lg border p-3 ${g.nivel === 'critico' ? 'border-rubro-300/60 dark:border-rubro-600/40' : 'border-papel-200 dark:border-noite-700'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Etiqueta tom={g.nivel}><Icone nome="alerta" className="h-3.5 w-3.5" />{g.nivel === 'critico' ? 'Atenção' : 'Aviso'}</Etiqueta>
                  <p className="min-w-0 flex-1 font-semibold">{g.titulo}</p>
                  {g.valor != null && <span className="num font-semibold">{dinheiro(g.valor)}</span>}
                </div>
                {g.itens.length > 0 && (
                  <ul className="mt-2 divide-y divide-papel-200 text-sm dark:divide-noite-700">
                    {g.itens.map((i) => (
                      <li key={i.id} className="flex items-baseline gap-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate">{i.texto}</span>
                        <span className="shrink-0 text-tinta-400">{i.data}</span>
                        <span className="num w-24 shrink-0 text-right">{i.valor != null ? dinheiro(i.valor) : i.quantidade}</span>
                      </li>
                    ))}
                    {g.qtd > g.itens.length && <li className="py-1.5 text-tinta-400">e mais {g.qtd - g.itens.length}</li>}
                  </ul>
                )}
                <div className="mt-2 flex justify-end"><Botao variante="secundario" onClick={() => ir(g.tela)}>{g.acao}</Botao></div>
              </section>
            ))}
          </div>
        )}
        {permissao === 'default' && (
          <p className="mt-4 text-sm text-tinta-400">
            Quer ser avisado também fora do sistema? <button className="font-semibold text-caixa-600 hover:underline dark:text-caixa-300" onClick={pedirPermissao}>Ativar notificações do navegador</button> (uma por dia, só para itens críticos).
          </p>
        )}
      </TelaSuspensa>
    </>
  )
}
