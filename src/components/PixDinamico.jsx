import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { chamarFuncao } from '../lib/servidor.js'
import { dinheiro } from '../lib/formato.js'
import { Botao, Icone, TelaSuspensa, useAviso } from './ui.jsx'

// Cobrança PIX gerada no banco: o caixa só confirma quando o banco avisa que foi paga
export function JanelaPixDinamico({ valor, caixaId, podeUsarFixo, onPago, onUsarFixo, onFechar }) {
  const avisar = useAviso()
  const [cob, setCob] = useState(null)
  const [img, setImg] = useState(null)
  const [erro, setErro] = useState(null)
  const [restante, setRestante] = useState(null)
  const [cancelando, setCancelando] = useState(false)
  const pago = useRef(false)

  useEffect(() => {
    let vivo = true
    chamarFuncao('pix', { acao: 'cobrar', valor, caixa_id: caixaId }).then(async (r) => {
      if (!vivo) return
      if (r.erro) { setErro(r.erro); return }
      setCob(r.dados)
      setImg(await QRCode.toDataURL(r.dados.copia_e_cola, { margin: 1, width: 280 }))
    })
    return () => { vivo = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Consulta o banco a cada 3 segundos
  useEffect(() => {
    if (!cob || cob.status !== 'ativa') return
    const t = setInterval(async () => {
      const r = await chamarFuncao('pix', { acao: 'consultar', txid: cob.txid })
      if (r.erro || pago.current) return
      if (r.dados.status === 'concluida') { pago.current = true; clearInterval(t); onPago(r.dados); return }
      if (r.dados.status !== 'ativa') { setCob(r.dados); clearInterval(t) }
    }, 3000)
    return () => clearInterval(t)
  }, [cob]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cob?.expira_em) return
    const t = setInterval(() => setRestante(Math.max(0, Math.round((new Date(cob.expira_em) - Date.now()) / 1000))), 1000)
    return () => clearInterval(t)
  }, [cob?.expira_em])

  const cancelar = async () => {
    if (!cob || cob.status !== 'ativa') { onFechar(); return }
    setCancelando(true)
    const r = await chamarFuncao('pix', { acao: 'cancelar', txid: cob.txid })
    setCancelando(false)
    if (r.erro) { avisar(r.erro, 'erro'); return }
    if (r.dados.status === 'concluida') { pago.current = true; onPago(r.dados); return }
    onFechar()
  }

  const encerrada = cob && cob.status !== 'ativa'
  return (
    <TelaSuspensa aberta titulo="PIX" subtitulo={`Cobrança de ${dinheiro(valor)} gerada no banco`} onFechar={cancelar}
      rodape={<>
        {(erro || encerrada) && podeUsarFixo && <Botao variante="secundario" onClick={onUsarFixo}>Usar QR Code fixo</Botao>}
        <Botao variante="secundario" onClick={cancelar} carregando={cancelando}>{erro || encerrada ? 'Fechar' : 'Cancelar cobrança'}</Botao>
      </>}>
      {erro ? (
        <div className="rounded-xl bg-rubro-50 p-4 text-[0.95rem] text-rubro-700 dark:bg-rubro-600/10 dark:text-rubro-300">
          <p className="font-semibold">Não foi possível gerar a cobrança.</p><p className="mt-1">{erro}</p>
        </div>
      ) : !cob ? (
        <p className="py-16 text-center text-sm text-tinta-400">Gerando cobrança no banco…</p>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          {img && <img src={img} alt="QR Code PIX" className={`h-64 w-64 rounded-lg bg-white p-2 ${encerrada ? 'opacity-30' : ''}`} />}
          <p className="num text-3xl font-semibold">{dinheiro(valor)}</p>
          {encerrada ? (
            <p className="font-semibold text-rubro-600">{cob.status === 'expirada' ? 'A cobrança expirou sem pagamento.' : 'A cobrança foi cancelada.'}</p>
          ) : (<>
            <p className="flex items-center gap-2 text-[0.95rem] font-medium text-caixa-700 dark:text-caixa-300">
              <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-caixa-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-caixa-500" /></span>
              Aguardando o pagamento{restante != null ? ` (expira em ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, '0')})` : ''}
            </p>
            <p className="text-sm text-tinta-400">A venda é liberada sozinha quando o banco confirmar. Não é preciso olhar o aplicativo.</p>
            <button type="button" className="inline-flex items-center gap-1.5 text-sm font-medium text-caixa-600 hover:underline dark:text-caixa-300" onClick={() => navigator.clipboard?.writeText(cob.copia_e_cola).then(() => avisar('Código PIX copiado.'))}><Icone nome="copiar" className="h-4 w-4" />Copiar código "copia e cola"</button>
          </>)}
        </div>
      )}
    </TelaSuspensa>
  )
}
