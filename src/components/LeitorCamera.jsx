import { useEffect, useRef, useState } from 'react'
import { lerBoleto } from '../lib/boleto.js'
import { Botao, Icone, TelaSuspensa } from './ui.jsx'

// Detector de código de barras ITF (padrão dos boletos). Usa o leitor nativo do
// navegador quando existe; senão, o leitor embutido (carregado só na primeira vez).
async function criarDetector() {
  try {
    if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('itf')) {
      const d = new window.BarcodeDetector({ formats: ['itf'] })
      return async (fonte) => (await d.detect(fonte)).map((r) => r.rawValue)
    }
  } catch { /* cai no leitor embutido */ }
  const [{ prepareZXingModule, readBarcodes }, { default: wasm }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({ overrides: { locateFile: (p, prefixo) => (p.endsWith('.wasm') ? wasm : prefixo + p) } })
  return async (_fonte, imagem) => (await readBarcodes(imagem, { formats: ['ITF'], tryHarder: true, maxNumberOfSymbols: 1 })).map((r) => r.text)
}

// Janela que lê o código de barras do boleto pela câmera. onLido recebe o resultado de lerBoleto.
export function LeitorBoleto({ aberta, onFechar, onLido }) {
  const video = useRef(null)
  const lido = useRef(onLido)
  lido.current = onLido
  const [estado, setEstado] = useState('iniciando')
  const [erro, setErro] = useState('')
  const [lanterna, setLanterna] = useState(null)

  useEffect(() => {
    if (!aberta) return
    let fluxo = null, parar = false, timer = null
    setEstado('iniciando'); setErro(''); setLanterna(null)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const iniciar = async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não permite usar a câmera. Use o Chrome ou digite a linha.')
      fluxo = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
      if (parar) return
      const v = video.current
      v.srcObject = fluxo
      await v.play()
      const trilha = fluxo.getVideoTracks()[0]
      if (trilha?.getCapabilities?.().torch) setLanterna({ trilha, ligada: false })
      const detectar = await criarDetector()
      if (parar) return
      setEstado('lendo')
      const ciclo = async () => {
        if (parar) return
        try {
          const w = v.videoWidth, h = v.videoHeight
          if (w && h) {
            // Só a faixa central, onde fica a guia: mais rápido e com menos ruído
            const fh = Math.round(h * 0.5), fy = Math.round((h - fh) / 2)
            canvas.width = w; canvas.height = fh
            ctx.drawImage(v, 0, fy, w, fh, 0, 0, w, fh)
            const textos = await detectar(canvas, ctx.getImageData(0, 0, w, fh))
            for (const t of textos) {
              const b = lerBoleto(t)
              if (b?.valido && String(t).replace(/\D/g, '').length === 44) {
                parar = true
                navigator.vibrate?.(80)
                lido.current(b)
                return
              }
            }
          }
        } catch { /* quadro ilegível: tenta o próximo */ }
        timer = setTimeout(ciclo, 200)
      }
      ciclo()
    }
    iniciar().catch((e) => {
      setEstado('erro')
      setErro(e?.name === 'NotAllowedError' ? 'Permissão da câmera negada. Libere a câmera para este site nas configurações do navegador.'
        : e?.name === 'NotFoundError' ? 'Nenhuma câmera encontrada neste aparelho.'
        : e?.message || 'Não foi possível abrir a câmera.')
    })
    return () => { parar = true; clearTimeout(timer); fluxo?.getTracks().forEach((t) => t.stop()) }
  }, [aberta])

  const alternarLanterna = async () => {
    try {
      await lanterna.trilha.applyConstraints({ advanced: [{ torch: !lanterna.ligada }] })
      setLanterna((l) => ({ ...l, ligada: !l.ligada }))
    } catch { setLanterna(null) }
  }

  return (
    <TelaSuspensa aberta={aberta} titulo="Ler boleto pela câmera" subtitulo="Enquadre o código de barras na faixa, com o boleto deitado e bem iluminado" onFechar={onFechar} largura="max-w-2xl"
      rodape={<>
        {lanterna && <Botao variante="secundario" onClick={alternarLanterna}>{lanterna.ligada ? 'Desligar lanterna' : 'Ligar lanterna'}</Botao>}
        <Botao variante="secundario" onClick={onFechar}>Cancelar</Botao>
      </>}>
      {estado === 'erro' ? (
        <p className="flex items-start gap-2 rounded-lg bg-rubro-50 p-3 text-rubro-600 dark:bg-rubro-600/20 dark:text-rubro-300"><Icone nome="alerta" className="mt-0.5 h-5 w-5 shrink-0" />{erro}</p>
      ) : (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={video} className="block aspect-video w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-x-[4%] top-1/4 h-1/2 rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,.45)]" />
          <div className="pointer-events-none absolute inset-x-[4%] top-1/2 h-0.5 bg-rubro-600/80" />
          <p className="absolute inset-x-0 bottom-2 text-center text-sm text-white">{estado === 'iniciando' ? 'Abrindo a câmera…' : 'Procurando o código de barras…'}</p>
        </div>
      )}
      <p className="mt-3 text-sm text-tinta-400">Os dígitos são conferidos antes de preencher. Se a câmera não focar, aproxime e afaste devagar ou digite a linha.</p>
    </TelaSuspensa>
  )
}
